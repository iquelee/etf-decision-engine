'use strict';

/**
 * V3.6.5 发布存储适配器（B1 → 平台对齐版）。
 *
 * 目的：把「candidate 写入 + 单指针 CAS 切换」的存储访问**收敛到一个适配器**，
 *       使同一套发布协议既能跑在真实 CloudBase 上，也能在**不写生产**的前提下被完整测试。
 *
 * ── CAS 机制：为什么不是 transaction（2026-09-24 平台实证后重裁）──────────
 *   任务书 §2/§10 的旧表述把 `REAL_TRANSACTION_API` 当成必要条件；真实平台实测推翻了这一点：
 *     - `{"startTransaction":1}` 经 `tcb.RunCommands` → **`CommandNotFound: no such command`**
 *       ⇒ 该通道**没有**多文档事务命令；
 *     - 更关键：本协议的 atomicity 定义（`v365-atomic-publish.js` §11）**本来就不需要**多文档提交 ——
 *       «消费者可见的 authoritative dataset，只能通过单一 active pointer 从旧完整 run 切到新完整 run»。
 *     - 单文档 `findAndModify + expected-current filter + revision guard` 在真实平台
 *       **八项语义全部 PASS**（见 `docs/V365_PLATFORM_CAS_EVIDENCE.md`）。
 *   ⇒ 正式裁定：`TRANSACTION_REQUIRED = NO` / `PLATFORM_SINGLE_DOCUMENT_CAS_REQUIRED = YES`。
 *     这是 **implementation selection correction**，**不是**放宽安全标准（判据从"用了什么机制"
 *     改为"是否真的原子"，并要求平台级实证 + 实现对齐**两者同时成立**）。
 *
 * ── 本文件的实现选型（single-document conditional CAS）────────────────────
 *   指针文档的 `_id` 由 scope **确定性派生**（`active_run_pointer::<scope>`），因此：
 *     • 更新路径：`where({ _id, scope, run_id: expected.run_id, revision: expected.revision }).update(...)`
 *       —— 条件不匹配则 `updated === 0` ⇒ **拒写**。单文档条件更新在本平台是原子的。
 *     • 首次发布：以确定性 `_id` `add()`，并发重复由**主键唯一性**兜住（第二条必然失败）。
 *     • ⛔ 绝不 fallback 成无条件 `update`；⛔ 绝不用 `multi-command batch` 伪造事务
 *       （平台实证：`[有效写, 非法命令]` 前半**会**生效 ⇒ `MULTI_COMMAND_BATCH_ATOMIC = FALSE`）。
 *   ⇒ 提升的唯一入口 `compareAndSetPointer` 返回**结构化**结果（见 `CAS_REASON`）。
 */

const CONTRACTS = require('./v365-contracts.js');

/**
 * CAS 结果原因码（结构化 —— ⛔ 不得用普通 true/false 丢失原因）。
 * 命名与任务书 §5 对齐：PROMOTED / STALE_EXPECTED_POINTER / NON_MONOTONIC_REVISION /
 * ALREADY_ACTIVE / POINTER_NOT_FOUND / CAS_ERROR（另加 CAS_REJECTED / CAS_UNAVAILABLE）。
 */
const CAS_REASON = Object.freeze({
  PROMOTED: 'PROMOTED',
  ALREADY_ACTIVE: 'ALREADY_ACTIVE',
  STALE_EXPECTED_POINTER: 'STALE_EXPECTED_POINTER',
  NON_MONOTONIC_REVISION: 'NON_MONOTONIC_REVISION',
  POINTER_NOT_FOUND: 'POINTER_NOT_FOUND',
  CAS_REJECTED: 'CAS_REJECTED',
  CAS_UNAVAILABLE: 'CAS_UNAVAILABLE',
  CAS_ERROR: 'CAS_ERROR'
});

/** 向后兼容别名（P-3 轮次的调用方使用 CAS_CODE.*；语义等同 CAS_REASON） */
const CAS_CODE = CAS_REASON;

/** 指针的逻辑身份（用于 CAS 比较；**不含 wall-clock**） */
function pointerIdentity(p) {
  if (p == null) return '∅';
  const rid = p.run_id != null ? String(p.run_id) : '?';
  const rev = Number(p.revision);
  return `${rid}@${Number.isFinite(rev) ? rev : '?'}`;
}

/** 指针文档的**确定性** `_id`（同一 scope 恒定 ⇒ 可用主键唯一性兜住并发 bootstrap） */
function pointerDocId(scope) {
  return `${CONTRACTS.V365_COLLECTIONS.ACTIVE_POINTER}::${scope == null ? 'production' : String(scope)}`;
}

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * ⚠️ 核心：**机制无关**的指针提升判定（纯函数）。
 *
 * 决策顺序（顺序本身是语义的一部分，不可交换）：
 *   0. 入参结构不合法                        → CAS_REJECTED
 *   1. 当前**无**指针 & expected 也认为无     → PROMOTED（bootstrap）
 *      当前**无**指针 & expected 认为有       → POINTER_NOT_FOUND
 *   2. `next` 与 current **完全同态**         → ALREADY_ACTIVE（幂等；retry 不产生第二 revision）
 *      ⚠️ 必须在「expected 校验」**之前**：retry 时 expected 往往已过期，
 *         但目标态已达成 ⇒ 应报幂等，而非 STALE。
 *   3. expected 与 current 不一致            → STALE_EXPECTED_POINTER（并发者已抢先/快照过期）
 *   4. next.revision <= current.revision     → NON_MONOTONIC_REVISION（较旧 run 不得覆盖较新）
 *   5. 其余                                   → PROMOTED
 *
 * @param {object} input { expected, current, next }
 * @returns {{promoted:boolean, reason:string, idempotent:boolean,
 *            previous_run_id:string|null, previous_revision:number|null,
 *            requested_run_id:string|null, requested_revision:number|null}}
 */
function classifyPointerPromotion(input) {
  const i = input || {};
  const expected = i.expected || null;
  const current = i.current || null;
  const next = i.next || null;

  const prevRun = current && current.run_id != null ? String(current.run_id) : null;
  const prevRev = current ? numOrNull(current.revision) : null;
  const reqRun = next && next.run_id != null ? String(next.run_id) : null;
  const reqRev = next ? numOrNull(next.revision) : null;

  const base = {
    promoted: false,
    reason: null,
    idempotent: false,
    previous_run_id: prevRun,
    previous_revision: prevRev,
    requested_run_id: reqRun,
    requested_revision: reqRev
  };
  const reject = (reason, extra) => Object.assign({}, base, { reason }, extra || {});
  const accept = (extra) => Object.assign({}, base, { promoted: true, reason: CAS_REASON.PROMOTED }, extra || {});

  // 0) 结构
  if (!next || reqRun == null || reqRev == null) {
    return reject(CAS_REASON.CAS_REJECTED, { error: 'malformed_next_pointer' });
  }

  // 1) 无指针
  if (current == null) {
    if (expected != null) {
      return reject(CAS_REASON.POINTER_NOT_FOUND, {
        error: 'expected_pointer_present_but_none_stored'
      });
    }
    return accept();   // bootstrap：首次发布
  }

  // 2) 幂等：请求的目标态**就是**当前态（retry / 同 run 重放）
  if (reqRun === prevRun && reqRev === prevRev) {
    return Object.assign({}, base, { reason: CAS_REASON.ALREADY_ACTIVE, idempotent: true });
  }

  // 3) expected 与 current 必须逐位一致（一人抢先，另一人必被拒）
  const sameIdentity = (expected == null)
    ? false
    : (String(expected.run_id) === prevRun && numOrNull(expected.revision) === prevRev);
  if (!sameIdentity) {
    return reject(CAS_REASON.STALE_EXPECTED_POINTER, {
      error: 'expected_mismatch',
      note: '并发者已抢先，或调用方持有的指针快照已过期'
    });
  }

  // 4) 单调 revision（防「较旧 run 后到覆盖较新 run」）
  if (reqRev <= prevRev) {
    return reject(CAS_REASON.NON_MONOTONIC_REVISION, {
      error: `revision ${reqRev} <= current ${prevRev}`
    });
  }

  return accept();
}

/**
 * 只读探测平台的**单文档条件更新**能力（⛔ 不写任何数据、不建集合）。
 * 机制已裁定为 single-document conditional CAS ⇒ 探测目标从 `runTransaction` 改为 `Query.update`。
 */
function probeCasCapability(dbModule, env) {
  try {
    const raw = dbModule.getDb(env);
    const col = raw && typeof raw.collection === 'function' ? raw.collection('__probe__') : null;
    const condUpdate = col && typeof col.where === 'function' && typeof col.update === 'function';
    return {
      conditional_update_present: !!condUpdate,
      update_type: col ? typeof col.update : 'unavailable',
      where_type: col ? typeof col.where : 'unavailable',
      // 如实标注：事务原语在本通道**不可用**（平台实证 CommandNotFound）
      transaction_command_available: CONTRACTS.CAS_EVIDENCE.transaction_command_available === true,
      reason: condUpdate ? null : 'conditional_update_not_available'
    };
  } catch (e) {
    return {
      conditional_update_present: false,
      update_type: 'unavailable', where_type: 'unavailable',
      transaction_command_available: false,
      reason: String(e.message || e)
    };
  }
}

/**
 * 是否允许执行 pointer promotion。
 *
 * fail-closed **双重门**（⛔ 比旧版更严，不是放宽）：
 *   ① 平台已实证单文档条件 CAS（`platform_single_document_cas_verified`）
 *   ② **实现**确已对齐该机制（`implementation_uses_single_document_cas`）
 * 两者缺一即 false。
 */
function promotionAllowed() {
  return CONTRACTS.CAS_EVIDENCE.platform_single_document_cas_verified === true
    && CONTRACTS.CAS_EVIDENCE.implementation_uses_single_document_cas === true;
}

/** 主键冲突（并发 bootstrap）判定 */
function isDuplicateKey(e) {
  const msg = String((e && e.message) || e || '');
  return /duplicate|DUPLICATE|E11000|已存在|ResourceExist/i.test(msg)
    && !/not exist|不存在/i.test(msg);
}

/**
 * 真实 CloudBase 适配器。
 *
 * 接口（与 scripts/lib/v365-p3-memory-adapter.js 完全一致，保证同一协议可被同一套测试驱动）：
 *   putManifest / getManifest
 *   putCandidate / getCandidate / listCandidates
 *   getPointer / compareAndSetPointer
 *
 * @param {object} opts { db, env }
 */
function createCloudbaseStore(opts) {
  const o = opts || {};
  const db = o.db;
  const env = o.env;
  if (!db) throw new Error('createCloudbaseStore: db 必需');
  const C = CONTRACTS.V365_COLLECTIONS;
  const nowIso = () => new Date().toISOString();

  function reject(reason, extra) {
    return Object.assign({
      ok: false,
      promoted: false,
      reason,
      idempotent: false
    }, extra || {});
  }

  async function putManifest(manifest) {
    return db.upsert(C.RUN_MANIFEST, Object.assign({}, manifest, { updated_at: nowIso() }),
      { run_id: manifest.run_id });
  }

  async function getManifest(runId) {
    const rows = await db.query(C.RUN_MANIFEST, { run_id: runId }, { limit: 1 });
    return rows && rows[0] ? rows[0] : null;
  }

  async function putCandidate(colName, runId, key, payload) {
    return db.upsert(colName, Object.assign({}, payload, {
      run_id: runId, candidate_key: String(key), written_at: nowIso()
    }), { run_id: runId, candidate_key: String(key) });
  }

  async function getCandidate(colName, runId, key) {
    const rows = await db.query(colName, { run_id: runId, candidate_key: String(key) }, { limit: 1 });
    return rows && rows[0] ? rows[0] : null;
  }

  async function listCandidates(colName, runId) {
    return db.query(colName, { run_id: runId }, { limit: 200 });
  }

  async function getPointer(scope) {
    try {
      const rows = await db.query(C.ACTIVE_POINTER, { scope }, { limit: 1 });
      return rows && rows[0] ? rows[0] : null;
    } catch (e) {
      if (db.isMissingCollection && db.isMissingCollection(e)) return null;
      throw e;
    }
  }

  /**
   * **单文档条件 CAS** —— 唯一把 candidate 变成 authoritative 的入口。
   *
   * 1) 读当前指针（用于语义分类与审计）；
   * 2) `classifyPointerPromotion` 给出结构化判定；非 PROMOTED ⇒ 直接返回，**不写**；
   * 3) 真正的原子性在**条件更新**上：`where({_id, scope, run_id: expected.run_id, revision: expected.revision})`
   *    —— 条件不再匹配则 `updated === 0` ⇒ 拒写（并发抢先）；
   * 4) 写后独立回读确认（read-after-write）。
   *
   * ⛔ 绝不降级为无条件 update；⛔ 平台能力缺失时返回 CAS_UNAVAILABLE 而**不是**"先读后写"。
   */
  async function compareAndSetPointer(scope, expected, next) {
    const sc = scope == null ? 'production' : String(scope);
    let col;
    try {
      col = db.getCollection(C.ACTIVE_POINTER, env);
    } catch (e) {
      return reject(CAS_REASON.CAS_UNAVAILABLE, { error: 'getCollection_failed:' + String(e.message || e) });
    }
    if (!col || typeof col.where !== 'function' || typeof col.update !== 'function') {
      // fail-closed：没有条件更新原语 ⇒ 宁可不提升
      return reject(CAS_REASON.CAS_UNAVAILABLE, { error: 'conditional_update_missing' });
    }

    const docId = pointerDocId(sc);

    // ---- 1) 读当前指针 ----
    let current = null;
    try {
      const got = await col.where({ scope: sc }).limit(1).get();
      current = got && got.data && got.data[0] ? got.data[0] : null;
    } catch (e) {
      if (!(db.isMissingCollection && db.isMissingCollection(e))) {
        return reject(CAS_REASON.CAS_ERROR, { error: 'read_pointer_failed:' + String(e.message || e) });
      }
      current = null;
    }

    // ---- 2) 语义分类（机制无关）----
    const verdict = classifyPointerPromotion({ expected, current, next });
    if (verdict.promoted !== true) {
      return Object.assign({ ok: false, current, cas_reason: verdict.reason }, verdict);
    }

    const payload = Object.assign({}, next, { scope: sc, updated_at: nowIso() });

    // ---- 3) 单文档条件更新（原子 compare-and-set）----
    try {
      if (current) {
        const cond = {
          _id: current._id != null ? current._id : docId,
          scope: sc,
          run_id: expected && expected.run_id != null ? expected.run_id : null,
          revision: expected ? numOrNull(expected.revision) : null
        };
        const res = await col.where(cond).update(payload);
        const updated = res && Number(res.updated);
        if (!(updated >= 1)) {
          // 条件不再匹配 ⇒ 并发者已抢先（分类阶段的 current 已过期）
          return Object.assign({
            ok: false, current, cas_reason: CAS_REASON.STALE_EXPECTED_POINTER,
            error: 'conditional_update_matched_0'
          }, verdict, { promoted: false, reason: CAS_REASON.STALE_EXPECTED_POINTER });
        }
      } else {
        // 首次发布：确定性 `_id` ⇒ 并发第二条必因主键冲突失败
        await col.add(Object.assign({ _id: docId }, payload));
      }
    } catch (e) {
      if (isDuplicateKey(e)) {
        return Object.assign({
          ok: false, cas_reason: CAS_REASON.STALE_EXPECTED_POINTER, error: 'bootstrap_race_duplicate_id'
        }, verdict, { promoted: false, reason: CAS_REASON.STALE_EXPECTED_POINTER });
      }
      return reject(CAS_REASON.CAS_ERROR, { error: 'conditional_update_failed:' + String(e.message || e) });
    }

    // ---- 4) 写后独立回读（CAS-7 语义）----
    let confirmed = null;
    try {
      const after = await col.doc(docId).get();
      confirmed = after && after.data && after.data[0] ? after.data[0] : null;
    } catch (e) {
      confirmed = null;   // 回读失败不否定已成功的条件更新，但如实标记
    }
    const consistent = !!confirmed
      && String(confirmed.run_id) === String(payload.run_id)
      && numOrNull(confirmed.revision) === numOrNull(payload.revision);

    return {
      ok: true,
      promoted: true,
      reason: CAS_REASON.PROMOTED,
      idempotent: false,
      previous_run_id: verdict.previous_run_id,
      previous_revision: verdict.previous_revision,
      requested_run_id: verdict.requested_run_id,
      requested_revision: verdict.requested_revision,
      current: payload,
      pointer: payload,
      read_after_write_consistent: consistent
    };
  }

  return {
    kind: 'cloudbase',
    putManifest, getManifest,
    putCandidate, getCandidate, listCandidates,
    getPointer, compareAndSetPointer,
    capabilities: () => probeCasCapability(db, env)
  };
}

module.exports = {
  CAS_REASON,
  CAS_CODE,
  pointerIdentity,
  pointerDocId,
  classifyPointerPromotion,
  probeCasCapability,
  promotionAllowed,
  createCloudbaseStore
};
