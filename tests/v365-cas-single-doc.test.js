/**
 * V3.6.5 —— Writer 单文档条件 CAS 专项测试（Q7 重裁轮）
 *
 * 覆盖：
 *   §A CAS 语义层（classifyPointerPromotion）六种 reason + 结构化字段
 *   §B 实现对齐静态证明（publish-store 不含事务调用、用 where+update、确定性 _id）
 *   §C C1/C2/C3 并发与 TOCTOU
 *   §D FI-15 already-active retry 幂等
 *   §E FI-13 stale expected / FI-14 non-monotonic（CAS 层独立兜底）
 *   §F FI-07/08/09/10 在发布层重跑
 *   §G 顺序约束：所有关键 validation 必须在 promotion **之前**
 *   §H fail-closed 反向证明（能力缺失 ⇒ 拒写，绝不降级为无条件 update）
 *
 * 运行：node tests/v365-cas-single-doc.test.js
 *
 * ⛔ 全程不连数据库、不建生产 collection、不部署、不接线 runDecisionEngine。
 *    §H 用**桩**驱动真实 cloudbase 适配器代码路径（不起网络、不写平台）。
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const U = (f) => require(path.join(REPO, 'src/common/utils', f));
const L = (f) => require(path.join(REPO, 'scripts/lib', f));

const PS = U('v365-publish-store.js');
const RI = U('v365-run-integrity.js');
const AP = U('v365-atomic-publish.js');
const CONTRACTS = U('v365-contracts.js');
const { createMemoryAdapter } = L('v365-p3-memory-adapter.js');

const R = PS.CAS_REASON;
const SCOPE = 'production';
const CODES = ['513310', '515880', '159582', '518880', '159570'];
const TD = '2026-09-23';
const PREV = '2026-09-22';

let passed = 0;
let failed = 0;
const failures = [];
const cases = [];
const test = (name, fn) => cases.push({ name, fn });

/* ------------------------------------------------------------------ *
 * 夹具
 * ------------------------------------------------------------------ */
const PTR = (run_id, revision) => ({ run_id, revision });

function mkManifest(runId, revision, tradeDate) {
  return {
    run_id: runId, revision,
    expected_trade_date: tradeDate || TD,
    expected_codes: CODES.slice(),
    input_hash: 'h-' + runId,
    status: 'CALCULATING'
  };
}
function mkDecisions(okFlags, date) {
  return CODES.map((c, i) => ({
    code: c, ok: okFlags[i],
    // 与生产同形：decision_result.decision_date == snapshot.calc_date（decision.js:936）
    decision_date: date || TD, calc_date: date || TD,
    final_target: 10, final_action: 'HOLD'
  }));
}
const ALL_OK = [true, true, true, true, true];

/** 桩 db 模块：驱动真实 createCloudbaseStore 的单文档条件更新路径 */
function stubDbModule(state) {
  const calls = [];
  const st = state || {};
  const col = {
    where(cond) {
      calls.push({ op: 'where', cond: cond ? Object.assign({}, cond) : cond });
      const q = {
        limit() { return q; },
        async get() { return { data: st.pointer ? [st.pointer] : [] }; },
        async update(payload) {
          // `beforeUpdate` 允许测试在「读」与「条件更新」之间插入竞争者的写入
          // （模拟真正的 TOCTOU 窗口）
          if (typeof st.beforeUpdate === 'function') st.beforeUpdate(st);
          calls.push({ op: 'update', cond: Object.assign({}, cond), payload: Object.assign({}, payload) });
          if (st.updateThrows) throw st.updateThrows;
          const p = st.pointer;
          const match = !!p
            && String(p._id) === String(cond._id)
            && String(p.run_id) === String(cond.run_id)
            && Number(p.revision) === Number(cond.revision);
          if (!match) return { updated: 0 };
          st.pointer = Object.assign({}, p, payload);
          return { updated: 1 };
        }
      };
      return q;
    },
    doc() {
      return { async get() { return { data: st.pointer ? [st.pointer] : [] }; } };
    },
    async add(doc) {
      calls.push({ op: 'add', doc: Object.assign({}, doc) });
      if (st.addThrows) throw st.addThrows;
      if (st.pointer) { const e = new Error('duplicate key error E11000'); throw e; }
      st.pointer = doc;
      return { id: doc._id };
    },
    /**
     * ⚠️ 哨兵：SDK 里 `CollectionReference extends Query`，故**集合句柄本身也有 `update`**。
     * 本桩如实提供它，但把它记为 `update_UNCONDITIONAL` —— 正确实现**永不**走到这里
     * （实现必须经 `where(cond).update()` 下发条件）。测试据此断言"不存在无条件更新"。
     */
    async update() {
      calls.push({ op: 'update_UNCONDITIONAL' });
      return { updated: 0 };
    }
  };
  return {
    calls,
    state: st,
    db: {
      getCollection: () => (st.collectionUnavailable ? null : col),
      getDb: () => ({}),
      query: async () => [],
      upsert: async () => ({ created: true, id: 'x' }),
      isMissingCollection: () => false
    }
  };
}

/** 剥离注释后的源码（静态断言必须看**代码**，不看注释） */
function codeOnly(rel) {
  return fs.readFileSync(path.join(REPO, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** ⛔ 硬约束：正确实现绝不使用**无条件** update（哨兵 op == 'update_UNCONDITIONAL'） */
function assertNoUnconditionalUpdate(calls, label) {
  const bad = calls.filter((c) => c.op === 'update_UNCONDITIONAL');
  assert.strictEqual(bad.length, 0,
    `${label}：⛔ 出现无条件 update ⇒ CAS 会退化为「先读后写」，原子性失效`);
}

/* ================================================================== *
 * §A CAS 语义层
 * ================================================================== */
test('A.1 首次发布（无指针 + expected 亦为空）⇒ PROMOTED', () => {
  const v = PS.classifyPointerPromotion({ expected: null, current: null, next: PTR('A', 1) });
  assert.strictEqual(v.reason, R.PROMOTED);
  assert.strictEqual(v.promoted, true);
  assert.strictEqual(v.idempotent, false);
});

test('A.2 expected 与 current 一致且 revision 单调 ⇒ PROMOTED', () => {
  const v = PS.classifyPointerPromotion({ expected: PTR('A', 3), current: PTR('A', 3), next: PTR('B', 4) });
  assert.strictEqual(v.reason, R.PROMOTED);
  assert.strictEqual(v.previous_run_id, 'A');
  assert.strictEqual(v.previous_revision, 3);
  assert.strictEqual(v.requested_run_id, 'B');
  assert.strictEqual(v.requested_revision, 4);
});

test('A.3 expected 与 current 不一致 ⇒ STALE_EXPECTED_POINTER（不写）', () => {
  const v = PS.classifyPointerPromotion({ expected: PTR('A', 3), current: PTR('B', 4), next: PTR('C', 5) });
  assert.strictEqual(v.reason, R.STALE_EXPECTED_POINTER);
  assert.strictEqual(v.promoted, false);
  assert.strictEqual(v.previous_run_id, 'B');
});

test('A.4 revision 不单调 ⇒ NON_MONOTONIC_REVISION（即使 expected 匹配）', () => {
  const v = PS.classifyPointerPromotion({ expected: PTR('B', 4), current: PTR('B', 4), next: PTR('C', 3) });
  assert.strictEqual(v.reason, R.NON_MONOTONIC_REVISION);
  assert.strictEqual(v.promoted, false);
});

test('A.5 同 revision 亦属非单调 ⇒ NON_MONOTONIC_REVISION（不允许平级覆盖）', () => {
  const v = PS.classifyPointerPromotion({ expected: PTR('B', 4), current: PTR('B', 4), next: PTR('C', 4) });
  assert.strictEqual(v.reason, R.NON_MONOTONIC_REVISION);
});

test('A.6 目标态已是当前态 ⇒ ALREADY_ACTIVE + idempotent（retry 语义）', () => {
  const v = PS.classifyPointerPromotion({ expected: PTR('A', 3), current: PTR('B', 4), next: PTR('B', 4) });
  assert.strictEqual(v.reason, R.ALREADY_ACTIVE);
  assert.strictEqual(v.promoted, false, '不产生第二次 authoritative revision');
  assert.strictEqual(v.idempotent, true);
  assert.strictEqual(v.previous_revision, v.requested_revision);
});

test('A.7 expected 认为有指针但实际无 ⇒ POINTER_NOT_FOUND', () => {
  const v = PS.classifyPointerPromotion({ expected: PTR('A', 1), current: null, next: PTR('B', 2) });
  assert.strictEqual(v.reason, R.POINTER_NOT_FOUND);
});

test('A.8 next 结构不合法 ⇒ CAS_REJECTED（绝不猜）', () => {
  assert.strictEqual(PS.classifyPointerPromotion({ expected: null, current: null, next: null }).reason, R.CAS_REJECTED);
  assert.strictEqual(PS.classifyPointerPromotion({ expected: null, current: null, next: { run_id: 'A' } }).reason, R.CAS_REJECTED);
  assert.strictEqual(PS.classifyPointerPromotion({ expected: null, current: null, next: { revision: 2 } }).reason, R.CAS_REJECTED);
});

test('A.9 结构化返回字段齐全（⛔ 不得用 true/false 丢失原因）', () => {
  const v = PS.classifyPointerPromotion({ expected: PTR('A', 3), current: PTR('B', 4), next: PTR('C', 5) });
  ['promoted', 'reason', 'idempotent', 'previous_run_id', 'previous_revision', 'requested_run_id', 'requested_revision']
    .forEach((k) => assert.ok(Object.prototype.hasOwnProperty.call(v, k), '缺少字段 ' + k));
});

test('A.10 顺序不变式：ALREADY_ACTIVE 判定必须先于 expected 校验（否则 retry 会误报 STALE）', () => {
  // expected 已过期，但目标态已达成 ⇒ 应报幂等而非 STALE
  const stale = PS.classifyPointerPromotion({ expected: PTR('A', 1), current: PTR('B', 4), next: PTR('B', 4) });
  assert.strictEqual(stale.reason, R.ALREADY_ACTIVE);
  const p = PS.pointerIdentity(PTR('B', 4));
  assert.strictEqual(p, 'B@4');
  assert.strictEqual(PS.pointerDocId('production'), 'active_run_pointer::production',
    '指针 _id 必须**确定性派生**（并发 bootstrap 靠主键唯一性兜住）');
});

/* ================================================================== *
 * §B 实现对齐（静态证明）
 * ================================================================== */
test('B.1 publish-store 代码中**不存在** runTransaction / startTransaction 调用', () => {
  const code = codeOnly('src/common/utils/v365-publish-store.js');
  assert.ok(!/runTransaction/.test(code), '⛔ 不得依赖多文档事务');
  assert.ok(!/startTransaction/.test(code), '⛔ 同上');
  assert.ok(!/\.commit\s*\(/.test(code), '⛔ 不得出现事务 commit');
  assert.ok(!/\.rollback\s*\(/.test(code), '⛔ 不得出现事务 rollback');
});

test('B.2 CAS 走单文档条件更新（where + update），且条件含 _id/run_id/revision', () => {
  const code = codeOnly('src/common/utils/v365-publish-store.js');
  assert.ok(/\.where\(cond\)\.update\(/.test(code), '必须是 where(cond).update(payload) 形态');
  assert.ok(/_id: current\._id/.test(code), '条件必须含 _id');
  assert.ok(/run_id: expected/.test(code), '条件必须含 expected.run_id');
  assert.ok(/revision: expected/.test(code), '条件必须含 expected.revision');
  assert.ok(code.includes('conditional_update_matched_0'),
    '命中 0 条必须显式拒绝（⛔ 不得 fallback 为无条件 update）');
});

test('B.3 语义层与适配器**共用**同一分类函数（测试结论可迁移）', () => {
  assert.ok(codeOnly('src/common/utils/v365-publish-store.js').includes('classifyPointerPromotion'));
  assert.ok(codeOnly('scripts/lib/v365-p3-memory-adapter.js').includes('classifyPointerPromotion'),
    '内存适配器必须复用同一语义层');
});

test('B.4 契约层：TRANSACTION_REQUIRED = NO / 单文档 CAS = YES', () => {
  assert.strictEqual(CONTRACTS.CAS_EVIDENCE.transaction_required, false);
  assert.strictEqual(CONTRACTS.CAS_EVIDENCE.platform_single_document_cas_required, true);
  assert.strictEqual(CONTRACTS.CAS_EVIDENCE.platform_single_document_cas_verified, true);
  assert.strictEqual(CONTRACTS.CAS_EVIDENCE.implementation_uses_single_document_cas, true);
});

test('B.5 平台负向事实如实记录：无事务命令 / 批量非原子', () => {
  assert.strictEqual(CONTRACTS.CAS_EVIDENCE.transaction_command_available, false,
    '命令通道无事务命令（CommandNotFound）⇒ 不得标 true');
  assert.strictEqual(CONTRACTS.CAS_EVIDENCE.multi_command_batch_atomic, false,
    'MULTI_COMMAND_BATCH_ATOMIC = FALSE（平台实证：前半生效）');
});

test('B.6 证据文档存在且记录了 envId / 通道 / CAS-1~CAS-7 / 清理 / 零部署', () => {
  const p = path.join(REPO, CONTRACTS.CAS_EVIDENCE.evidence_doc);
  assert.ok(fs.existsSync(p), '证据文档必须入库：' + CONTRACTS.CAS_EVIDENCE.evidence_doc);
  const s = fs.readFileSync(p, 'utf8');
  ['tradingview-etf-d0fa42yy57cbc11b', 'tcb.RunCommands', 'CAS-1', 'CAS-7',
    'MULTI_COMMAND_BATCH_ATOMIC = FALSE', 'CommandNotFound', 'TEST_DATA_CLEANUP = PASS',
    'PRODUCTION_COLLECTIONS_UNCHANGED = PASS', 'ZERO_DEPLOYMENT = PASS']
    .forEach((k) => assert.ok(s.includes(k), '证据文档缺少：' + k));
  // ⛔ 不得记录任何凭据内容
  assert.ok(!/secret(Id|Key)\s*[:=]/i.test(s), '不得记录 secretId/secretKey');
  assert.ok(!/eyJ[A-Za-z0-9_-]{10,}/.test(s), '不得记录 JWT（base64 头 eyJ…）');
  assert.ok(!/Bearer\s+[A-Za-z0-9._-]{20,}/.test(s), '不得记录 access token');
});

/* ================================================================== *
 * §C 并发 / TOCTOU（C1 / C2 / C3）
 * ================================================================== */
test('C.1 两个 writer 同持 A@3 并发争 B@4 / C@4 ⇒ 恰好一个成功', async () => {
  const ad = createMemoryAdapter();
  const boot = await ad.compareAndSetPointer(SCOPE, null, PTR('A', 3));
  assert.strictEqual(boot.ok, true, 'bootstrap 必须成功');

  const [r1, r2] = await Promise.all([
    ad.compareAndSetPointer(SCOPE, PTR('A', 3), PTR('B', 4)),
    ad.compareAndSetPointer(SCOPE, PTR('A', 3), PTR('C', 4))
  ]);
  const wins = [r1, r2].filter((r) => r.ok === true);
  assert.strictEqual(wins.length, 1, '并发同 expected ⇒ 只允许一个成功（无 lost update）');
  const loser = [r1, r2].find((r) => r.ok !== true);
  assert.strictEqual(loser.reason, R.STALE_EXPECTED_POINTER);
  const ptr = await ad.getPointer(SCOPE);
  assert.strictEqual(ptr.revision, 4, '结果 revision 必须为 4（未被覆盖）');
});

test('C.2 新 revision 已成 active 后，旧 run 派生的同 revision 提交 ⇒ STALE_EXPECTED_POINTER', async () => {
  const ad = createMemoryAdapter();
  await ad.compareAndSetPointer(SCOPE, null, PTR('A', 3));
  await ad.compareAndSetPointer(SCOPE, PTR('A', 3), PTR('B', 4));      // B@4 成为 active

  const r = await ad.compareAndSetPointer(SCOPE, PTR('A', 3), PTR('C', 4));   // 旧 run 派生
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, R.STALE_EXPECTED_POINTER);
  assert.strictEqual(r.previous_run_id, 'B');
  assert.strictEqual(r.previous_revision, 4);
  assert.strictEqual((await ad.getPointer(SCOPE)).run_id, 'B', 'active 不得被改写');
});

test('C.3 active=B@4，请求 C@3（expected 被人为构造匹配）⇒ NON_MONOTONIC_REVISION', async () => {
  const ad = createMemoryAdapter();
  await ad.compareAndSetPointer(SCOPE, null, PTR('B', 4));

  const r = await ad.compareAndSetPointer(SCOPE, PTR('B', 4), PTR('C', 3));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, R.NON_MONOTONIC_REVISION,
    '即使 expected 匹配，revision 倒退也必须被拒');
  assert.strictEqual((await ad.getPointer(SCOPE)).run_id, 'B');
});

test('C.4 TOCTOU：持过期 snapshot 的调用方在 executePointerPromotion 层亦被拒', async () => {
  const ad = createMemoryAdapter();
  await ad.compareAndSetPointer(SCOPE, null, PTR('A', 1));
  const staleSnapshot = await ad.getPointer(SCOPE);      // A 看到 A@1
  await ad.compareAndSetPointer(SCOPE, PTR('A', 1), PTR('B2', 2));   // 竞争者先提升

  const plan = { action: AP.POINTER_ACTION.PROMOTE, run_id: 'A3', revision: 2, next_pointer: PTR('A3', 2) };
  const exec = await AP.executePointerPromotion({ adapter: ad, scope: SCOPE, plan, expected_pointer: staleSnapshot });
  assert.strictEqual(exec.promoted, false);
  assert.strictEqual(exec.cas_reason, R.STALE_EXPECTED_POINTER, '拒因必须结构化，不得压成 CAS_REJECTED');
  assert.strictEqual((await ad.getPointer(SCOPE)).run_id, 'B2');
});

/* ================================================================== *
 * §D FI-15 already-active retry 幂等
 * ================================================================== */
test('D.1 FI-15 同一 run_id + revision 重试 ⇒ ALREADY_ACTIVE、不增 revision、不报破坏性错误', async () => {
  const ad = createMemoryAdapter();
  await ad.compareAndSetPointer(SCOPE, null, PTR('A', 1));
  await ad.compareAndSetPointer(SCOPE, PTR('A', 1), PTR('B', 4));

  const before = await ad.getPointer(SCOPE);
  // 重试：目标态与当前态完全一致（expected 可已过期）
  const retry = await ad.compareAndSetPointer(SCOPE, PTR('A', 1), PTR('B', 4));
  assert.strictEqual(retry.promoted, false, '不得产生第二次 authoritative revision');
  assert.strictEqual(retry.reason, R.ALREADY_ACTIVE);
  assert.strictEqual(retry.idempotent, true);
  const after = await ad.getPointer(SCOPE);
  assert.deepStrictEqual(after, before, '指针必须逐字不变');
});

test('D.2 经 executePointerPromotion 的重试同样幂等（不报错、不改指针）', async () => {
  const ad = createMemoryAdapter();
  await ad.compareAndSetPointer(SCOPE, null, PTR('B', 4));
  const plan = { action: AP.POINTER_ACTION.PROMOTE, run_id: 'B', revision: 4, next_pointer: PTR('B', 4) };
  const exec = await AP.executePointerPromotion({
    adapter: ad, scope: SCOPE, plan, expected_pointer: PTR('B', 4)
  });
  assert.strictEqual(exec.promoted, false);
  assert.strictEqual(exec.cas_reason, R.ALREADY_ACTIVE);
  assert.strictEqual(exec.idempotent, true);
  assert.strictEqual((await ad.getPointer(SCOPE)).revision, 4);
});

/* ================================================================== *
 * §E FI-13 / FI-14（CAS 层独立兜底 —— defense in depth）
 * ================================================================== */
test('E.1 FI-13 stale expected pointer 在 CAS 层被拒（不依赖 plan 层的先期拦截）', async () => {
  const ad = createMemoryAdapter();
  await ad.compareAndSetPointer(SCOPE, null, PTR('B', 4));
  const plan = { action: AP.POINTER_ACTION.PROMOTE, run_id: 'C', revision: 5, next_pointer: PTR('C', 5) };
  const exec = await AP.executePointerPromotion({
    adapter: ad, scope: SCOPE, plan, expected_pointer: PTR('A', 3)   // 过期
  });
  assert.strictEqual(exec.promoted, false);
  assert.strictEqual(exec.cas_reason, R.STALE_EXPECTED_POINTER);
  assert.strictEqual(exec.previous_run_id, 'B');
  assert.strictEqual(exec.requested_run_id, 'C');
});

test('E.2 FI-14 non-monotonic revision 在 CAS 层被拒（绕过 plan 层亦无效）', async () => {
  const ad = createMemoryAdapter();
  await ad.compareAndSetPointer(SCOPE, null, PTR('B', 4));
  // 伪造一个 "plan 已放行" 的场景：action=PROMOTE 且 expected 匹配，但 revision 倒退
  const plan = { action: AP.POINTER_ACTION.PROMOTE, run_id: 'C', revision: 3, next_pointer: PTR('C', 3) };
  const exec = await AP.executePointerPromotion({
    adapter: ad, scope: SCOPE, plan, expected_pointer: PTR('B', 4)
  });
  assert.strictEqual(exec.promoted, false);
  assert.strictEqual(exec.cas_reason, R.NON_MONOTONIC_REVISION);
  assert.strictEqual((await ad.getPointer(SCOPE)).run_id, 'B');
});

/* ================================================================== *
 * §F FI-07 / FI-08 / FI-09 / FI-10（发布层重跑）
 * ================================================================== */
test('F.1 FI-07 提升前 crash ⇒ 旧 active 存活（pointer 不变）', async () => {
  const ad = createMemoryAdapter();
  const base = await RI.publishCandidateFirst({
    store: ad, manifest: mkManifest('run-base', 1, TD), decisions: mkDecisions(ALL_OK),
    portfolio: { snapshot_date: TD }, expected_codes: CODES, allowPromotion: true
  });
  assert.strictEqual(base.promoted, true, '基线 run 必须先成为 active');

  ad.injectFailure('compareAndSetPointer', SCOPE, 1);
  let crashed = false;
  try {
    await RI.publishCandidateFirst({
      store: ad, manifest: mkManifest('run-crash', 2, TD), decisions: mkDecisions(ALL_OK),
      portfolio: { snapshot_date: TD }, expected_codes: CODES, allowPromotion: true
    });
  } catch (e) { crashed = true; }
  const ptr = await ad.getPointer(SCOPE);
  assert.strictEqual(ptr.run_id, 'run-base', '旧 active 必须存活');
  assert.strictEqual(crashed, true, '注入的 crash 必须真的抛出（否则用例失去区分力）');
});

test('F.2 FI-08 同 run 重放 ⇒ 幂等，不产生第二 revision', async () => {
  const ad = createMemoryAdapter();
  await RI.publishCandidateFirst({
    store: ad, manifest: mkManifest('run-A', 1, TD), decisions: mkDecisions(ALL_OK),
    portfolio: { snapshot_date: TD }, expected_codes: CODES, allowPromotion: true
  });
  const again = await RI.publishCandidateFirst({
    store: ad, manifest: mkManifest('run-A', 1, TD), decisions: mkDecisions(ALL_OK),
    portfolio: { snapshot_date: TD }, expected_codes: CODES, allowPromotion: true
  });
  const ptr = await ad.getPointer(SCOPE);
  assert.strictEqual(again.promotion_attempted, false, '不得再次尝试提升');
  assert.strictEqual(again.idempotent, true);
  assert.strictEqual(again.cas_reason, R.ALREADY_ACTIVE);
  assert.strictEqual(ptr.revision, 1, 'revision 不得被推进');
});

test('F.3 FI-09 同交易日更大 revision ⇒ 显式 supersedes 且可追溯', async () => {
  const ad = createMemoryAdapter();
  await RI.publishCandidateFirst({
    store: ad, manifest: mkManifest('run-A', 1, TD), decisions: mkDecisions(ALL_OK),
    portfolio: { snapshot_date: TD }, expected_codes: CODES, allowPromotion: true
  });
  const r = await RI.publishCandidateFirst({
    store: ad, manifest: mkManifest('run-B', 2, TD), decisions: mkDecisions(ALL_OK),
    portfolio: { snapshot_date: TD }, expected_codes: CODES, allowPromotion: true
  });
  const ptr = await ad.getPointer(SCOPE);
  assert.strictEqual(r.promoted, true);
  assert.strictEqual(r.cas_reason, R.PROMOTED);
  assert.strictEqual(ptr.run_id, 'run-B');
  assert.strictEqual(r.plan.supersedes_run_id, 'run-A', '同交易日 supersede 必须显式可追溯');
  assert.strictEqual(r.previous_run_id, 'run-A');
  assert.strictEqual(r.previous_revision, 1);
});

test('F.4 FI-10 较旧 run 后完成 ⇒ 不得覆盖较新 active', async () => {
  const ad = createMemoryAdapter();
  await RI.publishCandidateFirst({
    store: ad, manifest: mkManifest('run-B', 2, TD), decisions: mkDecisions(ALL_OK),
    portfolio: { snapshot_date: TD }, expected_codes: CODES, allowPromotion: true
  });
  const old = await RI.publishCandidateFirst({
    store: ad, manifest: mkManifest('run-OLD', 1, TD), decisions: mkDecisions(ALL_OK),
    portfolio: { snapshot_date: TD }, expected_codes: CODES, allowPromotion: true
  });
  const ptr = await ad.getPointer(SCOPE);
  assert.strictEqual(old.promoted, false);
  assert.strictEqual(ptr.run_id, 'run-B', 'active 不得被较旧 run 覆盖');
  assert.strictEqual(ptr.revision, 2);
});

test('F.5 旧 run 且 expected 快照过期（走 CAS 层）⇒ 拒因仍为结构化', async () => {
  const ad = createMemoryAdapter();
  await ad.compareAndSetPointer(SCOPE, null, PTR('NEW', 9));
  const plan = { action: AP.POINTER_ACTION.PROMOTE, run_id: 'OLD', revision: 4, next_pointer: PTR('OLD', 4) };
  const exec = await AP.executePointerPromotion({
    adapter: ad, scope: SCOPE, plan, expected_pointer: PTR('NEW', 9)
  });
  assert.strictEqual(exec.promoted, false);
  assert.strictEqual(exec.cas_reason, R.NON_MONOTONIC_REVISION);
});

/* ================================================================== *
 * §G 顺序约束：validation 必须在 promotion 之前（§9）
 * ================================================================== */
test('G.1 源码顺序：validateCandidateSet → planPointerPromotion → executePointerPromotion', () => {
  const src = codeOnly('src/common/utils/v365-run-integrity.js');
  const iVal = src.indexOf('validateCandidateSet(');
  const iPlan = src.indexOf('planPointerPromotion(');
  const iProm = src.indexOf('executePointerPromotion(');
  assert.ok(iVal > 0 && iPlan > 0 && iProm > 0, '三个调用必须都存在');
  assert.ok(iVal < iPlan, '必须 validate 在 plan 之前');
  assert.ok(iPlan < iProm, '必须 plan 在 promote 之前');
});

test('G.2 行为顺序：validation 失败时**从不调用** CAS（指针零触碰）', async () => {
  const ad = createMemoryAdapter();
  const mixed = mkDecisions(ALL_OK);
  mixed[4].calc_date = PREV;      // 混日期 ⇒ validation 必失败
  mixed[4].decision_date = PREV;
  const r = await RI.publishCandidateFirst({
    store: ad, manifest: mkManifest('run-mixed', 1, TD), decisions: mixed,
    portfolio: { snapshot_date: TD }, expected_codes: CODES, allowPromotion: true
  });
  assert.strictEqual(r.promoted, false);
  assert.strictEqual(r.validation.passed, false);
  assert.strictEqual(r.promotion_attempted, false, 'validation 失败 ⇒ 根本不进入提升');
  const casCalls = ad.getCalls().filter((c) => c.op === 'compareAndSetPointer');
  assert.strictEqual(casCalls.length, 0, '⛔ 绝不允许「先提升 pointer 再做 validation」');
  assert.strictEqual(await ad.getPointer(SCOPE), null);
});

test('G.3 finality 非 COMPLETE 时同样从不调用 CAS', async () => {
  const ad = createMemoryAdapter();
  const r = await RI.publishCandidateFirst({
    store: ad, manifest: mkManifest('run-partial', 1, TD),
    decisions: mkDecisions([true, true, true, true, false]),
    portfolio: { snapshot_date: TD }, expected_codes: CODES, allowPromotion: true
  });
  assert.strictEqual(r.finality.status, RI.RUN_STATUS.PARTIAL);
  assert.strictEqual(r.promotion_attempted, false);
  assert.strictEqual(ad.getCalls().filter((c) => c.op === 'compareAndSetPointer').length, 0);
  assert.strictEqual(await ad.getPointer(SCOPE), null);
});

/* ================================================================== *
 * §H fail-closed 反向证明（桩驱动真实 cloudbase 代码路径）
 * ================================================================== */
test('H.1 条件更新原语缺失 ⇒ CAS_UNAVAILABLE（⛔ 绝不降级为先读后写）', async () => {
  const s = stubDbModule({ collectionUnavailable: true });
  const store = PS.createCloudbaseStore({ db: s.db, env: 'stub' });
  const res = await store.compareAndSetPointer(SCOPE, null, PTR('A', 1));
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, R.CAS_UNAVAILABLE);
  assert.strictEqual(s.calls.filter((c) => c.op === 'update').length, 0, '不得有任何写入');
  assert.strictEqual(s.calls.filter((c) => c.op === 'add').length, 0, '不得有任何写入');
});

test('H.2 条件更新命中 0 条 ⇒ STALE_EXPECTED_POINTER，且**所有 update 都带完整 expected 条件**', async () => {
  // 真实 TOCTOU 窗口：读到的 current 是 A@3（语义层放行），
  // 但在 update 下发前竞争者把它改成了 B@4 ⇒ 条件 {_id, run_id:'A', revision:3} 不再匹配 ⇒ updated:0
  const s = stubDbModule({
    pointer: { _id: 'active_run_pointer::production', scope: SCOPE, run_id: 'A', revision: 3 },
    beforeUpdate: (state) => {
      state.pointer = { _id: 'active_run_pointer::production', scope: SCOPE, run_id: 'B', revision: 4 };
    }
  });
  const store = PS.createCloudbaseStore({ db: s.db, env: 'stub' });

  const res = await store.compareAndSetPointer(SCOPE, PTR('A', 3), PTR('C', 5));
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, R.STALE_EXPECTED_POINTER,
    '语义层放行但条件更新命中 0 条 ⇒ 仍必须被拒（这是真实并发下的最后一道闸）');

  const ups = s.calls.filter((c) => c.op === 'update');
  assert.ok(ups.length >= 1, '必须真的尝试过条件更新');
  ups.forEach((u) => {
    assert.ok(u.cond && u.cond._id != null && u.cond.run_id != null && u.cond.revision != null,
      '⛔ 每一次 update 都必须携带 _id + run_id + revision；不得存在无条件 update');
    assert.strictEqual(u.cond.run_id, 'A', '条件必须绑定**调用方声明的** expected');
    assert.strictEqual(u.cond.revision, 3);
  });
  assertNoUnconditionalUpdate(s.calls, 'H.2');
  assert.strictEqual(s.state.pointer.run_id, 'B', '竞争者的结果必须保留（未被覆盖）');
});

test('H.3 条件命中 ⇒ PROMOTED，且回读一致（read-after-write）', async () => {
  const s = stubDbModule({ pointer: { _id: 'active_run_pointer::production', scope: SCOPE, run_id: 'A', revision: 3 } });
  const store = PS.createCloudbaseStore({ db: s.db, env: 'stub' });
  const res = await store.compareAndSetPointer(SCOPE, PTR('A', 3), PTR('B', 4));
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.reason, R.PROMOTED);
  assert.strictEqual(res.read_after_write_consistent, true, 'CAS-7：写后独立读必须一致');
  assert.strictEqual(res.previous_run_id, 'A');
  assert.strictEqual(res.previous_revision, 3);
  assert.strictEqual(s.state.pointer.run_id, 'B');
  assertNoUnconditionalUpdate(s.calls, 'H.3');
});

test('H.4 语义层拒绝时**根本不下发**写入（零副作用）', async () => {
  const s = stubDbModule({ pointer: { _id: 'active_run_pointer::production', scope: SCOPE, run_id: 'B', revision: 4 } });
  const store = PS.createCloudbaseStore({ db: s.db, env: 'stub' });
  const res = await store.compareAndSetPointer(SCOPE, PTR('B', 4), PTR('C', 3));   // 非单调
  assert.strictEqual(res.reason, R.NON_MONOTONIC_REVISION);
  assert.strictEqual(s.calls.filter((c) => c.op === 'update').length, 0, '语义层已拒 ⇒ 不得下发 update');
  assertNoUnconditionalUpdate(s.calls, 'H.4');
  assert.strictEqual(s.state.pointer.run_id, 'B');
});

test('H.5 bootstrap 用确定性 _id；并发第二条因主键冲突被拒', async () => {
  const s = stubDbModule({ pointer: null });
  const store = PS.createCloudbaseStore({ db: s.db, env: 'stub' });
  const first = await store.compareAndSetPointer(SCOPE, null, PTR('A', 1));
  assert.strictEqual(first.ok, true);
  const adds = s.calls.filter((c) => c.op === 'add');
  assert.strictEqual(adds.length, 1);
  assert.strictEqual(adds[0].doc._id, 'active_run_pointer::production', '_id 必须确定性派生');

  // 第二个 bootstrap 竞争者（仍认为无指针）
  const second = await store.compareAndSetPointer(SCOPE, null, PTR('X', 1));
  assert.strictEqual(second.ok, false, '并发 bootstrap 第二条必须失败');
});

test('H.6 双重门：publishPromotionAllowed 同时依赖平台证据与实现对齐', () => {
  const src = codeOnly('src/common/utils/v365-contracts.js');
  const i = src.indexOf('function publishPromotionAllowed');
  assert.ok(i > 0);
  const body = src.slice(i, src.indexOf('}', i));
  assert.ok(body.includes('platform_single_document_cas_verified'), '必须依赖平台证据');
  assert.ok(body.includes('implementation_uses_single_document_cas'), '必须依赖实现对齐');
  assert.ok(/&&/.test(body), '两者必须是 AND（缺一即 false）');
  assert.strictEqual(CONTRACTS.publishPromotionAllowed(), true, '当前两者都成立');
  // 反向：CAS_EVIDENCE 必须冻结，防止运行期被改写成 true
  assert.ok(Object.isFrozen(CONTRACTS.CAS_EVIDENCE), 'CAS_EVIDENCE 必须 Object.freeze');
});

/* ------------------------------------------------------------------ *
 * 运行
 * ------------------------------------------------------------------ */
(async () => {
  for (const c of cases) {
    try {
      await c.fn();
      passed += 1;
      console.log(`  \u2713 ${c.name}`);
    } catch (e) {
      failed += 1;
      failures.push({ name: c.name, err: e });
      console.log(`  \u2717 ${c.name}`);
      console.log(`      ${e && e.message}`);
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) {
    failures.forEach((f) => console.log(`  \u2717 ${f.name}: ${f.err && f.err.message}`));
    process.exit(1);
  }
})();
