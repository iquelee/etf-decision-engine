'use strict';

/**
 * V3.6.5 发布存储适配器（B1）。
 *
 * 目的：把「candidate 写入 + 单指针 CAS 切换」的存储访问**收敛到一个适配器**，
 *       使同一套发布协议既能跑在真实 CloudBase 上，也能在**不写生产**的前提下被完整测试。
 *
 * ⚠️ 关于 CAS 的诚实边界（任务书 §10）：
 *   - `@cloudbase/node-sdk@2.11.0` 的 `Db` **确实提供** `startTransaction()` / `runTransaction()`
 *     （types/index.d.ts:467-468），`Transaction.collection()` 返回 CollectionReference，
 *     `commit()` / `rollback()` 齐备 ⇒ **API 存在是实证的**。
 *   - 但「并发冲突时的失败语义」与「stale run 绝不可能覆盖 newer run」**尚未在平台上实测**。
 *   - ⇒ 本适配器在缺少事务能力时**一律返回 CAS_UNAVAILABLE（fail-closed）**，绝不降级为
 *     "先读后写"（那会静默破坏原子性）。
 *   - ⇒ 是否允许真正 promotion，由 `v365-contracts.CAS_EVIDENCE.platform_concurrency_tested`
 *     统一裁决（见 `promotionAllowed()`）。
 */

const CONTRACTS = require('./v365-contracts.js');

const CAS_CODE = Object.freeze({
  OK: 'OK',
  CAS_UNAVAILABLE: 'CAS_UNAVAILABLE',
  CAS_REJECTED: 'CAS_REJECTED',
  CAS_ERROR: 'CAS_ERROR'
});

/** 指针的逻辑身份（用于 CAS 比较；不含 wall-clock） */
function pointerIdentity(p) {
  if (p == null) return null;
  const rid = p.run_id != null ? String(p.run_id) : '';
  const rev = Number(p.revision);
  return `${rid}@${Number.isFinite(rev) ? rev : '?'}`;
}

/**
 * 只读探测平台 CAS 能力（⛔ 不写任何数据、不建集合）。
 * @returns {{api_present:boolean, runTransaction_type:string, startTransaction_type:string, reason:string|null}}
 */
function probeCasCapability(dbModule, env) {
  try {
    const raw = dbModule.getDb(env);
    const rt = raw && typeof raw.runTransaction;
    const st = raw && typeof raw.startTransaction;
    return {
      api_present: rt === 'function' && st === 'function',
      runTransaction_type: rt,
      startTransaction_type: st,
      reason: rt === 'function' ? null : 'runTransaction_not_a_function'
    };
  } catch (e) {
    return { api_present: false, runTransaction_type: 'unavailable', startTransaction_type: 'unavailable', reason: String(e.message || e) };
  }
}

/** 是否允许执行 pointer promotion（fail-closed；平台并发证据未取得时恒 false） */
function promotionAllowed() {
  return CONTRACTS.CAS_EVIDENCE.platform_concurrency_tested === true;
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
    const rows = await db.query(C.ACTIVE_POINTER, { scope }, { limit: 1 });
    return rows && rows[0] ? rows[0] : null;
  }

  /**
   * 单指针 CAS。
   * ⛔ 绝不降级：若平台不提供事务 ⇒ CAS_UNAVAILABLE（调用方必须 HOLD）。
   */
  async function compareAndSetPointer(scope, expected, next) {
    let raw;
    try {
      raw = db.getDb(env);
    } catch (e) {
      return { ok: false, code: CAS_CODE.CAS_UNAVAILABLE, reason: 'getDb_failed:' + String(e.message || e) };
    }
    if (!raw || typeof raw.runTransaction !== 'function') {
      return { ok: false, code: CAS_CODE.CAS_UNAVAILABLE, reason: 'runTransaction_missing' };
    }
    try {
      const result = await raw.runTransaction(async (tx) => {
        const col = tx.collection(C.ACTIVE_POINTER);
        const got = await col.where({ scope }).limit(1).get();
        const cur = got && got.data && got.data[0] ? got.data[0] : null;
        if (pointerIdentity(cur) !== pointerIdentity(expected)) {
          // 并发者已抢先（或指针被外部改动）⇒ 事务内返回拒因，由调用方 HOLD
          return { ok: false, code: CAS_CODE.CAS_REJECTED, current: cur };
        }
        const doc = Object.assign({}, next, { scope, updated_at: nowIso() });
        if (cur) await col.doc(cur._id).update(doc);
        else await col.add(doc);
        return { ok: true, code: CAS_CODE.OK, current: doc };
      });
      return result && typeof result === 'object' ? result
        : { ok: false, code: CAS_CODE.CAS_ERROR, reason: 'transaction_returned_non_object' };
    } catch (e) {
      return { ok: false, code: CAS_CODE.CAS_ERROR, reason: String(e.message || e) };
    }
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
  CAS_CODE,
  pointerIdentity,
  probeCasCapability,
  promotionAllowed,
  createCloudbaseStore
};
