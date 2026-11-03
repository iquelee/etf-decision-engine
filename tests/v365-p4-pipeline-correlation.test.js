/**
 * V3.6.5 P-4 —— Pipeline Correlation & Observability 测试
 *
 * 覆盖任务书 §3（缺口只读证据）· §5（状态模型独立性）· §9（P4-T1~T8）
 * · §10（三 ID 区分）· §7/§8（补丁边界）
 *
 * 运行：node tests/v365-p4-pipeline-correlation.test.js
 *
 * ⛔ 只读 + test-only store：不连库、不部署、不改云函数、不接线生产。
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const U = (f) => require(path.join(REPO, 'src/common/utils', f));
const L = (f) => require(path.join(REPO, 'scripts/lib', f));

const {
  TRANSPORT_STATUS: T, BUSINESS_STATUS: B, ORIGIN,
  buildPipelineIdentity, parsePipelineRunId, buildCallRecord,
  classifyTransportError, settleTransport, buildBusinessObservation,
  deriveBusinessFromTransport, deriveTransportFromBusiness,
  reconcile, isObs001Shape, readInboundCorrelation, assertDistinctIdentities, buildForwardPayload
} = U('pipeline-correlation.js');

const { createObservationStore } = L('v365-p4-observation-store.js');
const PATCHES_MOD = L('v365-p4-candidate-patches.js');

let passed = 0;
let failed = 0;
const failures = [];
const asyncCases = [];
function test(name, fn) { asyncCases.push({ name, fn, sync: true }); }
function section(t) { console.log(`\n== ${t} ==`); }

const TD = '2026-09-23';                 // 08:00 那笔的 expected_trade_date（08:00 未过 cutoff ⇒ 前一日）
const TS_START = '2026-09-24T00:00:08.997Z';
const TS_END = '2026-09-24T00:00:38.573Z';

function readCf(name) {
  return fs.readFileSync(path.join(REPO, 'cloudfunctions', name, 'index.js'), 'utf8');
}

/* ================================================================== *
 * §A CURRENT_P4_OBSERVABILITY_GAP（只读证据）
 * ================================================================== */
section('§A 缺口只读证据');

test('A.1【B1 后更新】链式调用已透传 pipeline 关联 id（旧缺口已闭合）', () => {
  const mi = readCf('materializeIndicators');
  const fdd = readCf('fetchDailyData');
  // ⚠️ 原断言「payload 仅 {from}、无 pipeline id」记录的是**修复前缺口**；
  //    B1 接线后该缺口已闭合 ⇒ 断言改为证明新事实（更强，不是放宽）。
  assert.ok(mi.includes('buildForwardPayload'), 'B1：必须用契约模块构造透传载荷（保留 from 语义）');
  assert.ok(mi.includes('pipeline_run_id'), 'B1：必须透传 pipeline_run_id');
  // 残余（明确记录，不掩盖）：链路**起点** fetchDailyData → materializeIndicators 本轮未接线
  assert.ok(fdd.includes("{ name: 'materializeIndicators', data: { from: 'fetchDailyData' } }"),
    '残余：链路起点仍只带 from（本轮未接线 ⇒ 起点无 pipeline_run_id）');
});

test('A.2【B1 后更新】runDecisionEngine 已只读读取 event 关联（旧缺口已闭合）', () => {
  const rde = readCf('runDecisionEngine');
  // ⚠️ 原断言「event.from 从未读取 / 无 pipeline_run_id」记录的是修复前缺口。
  assert.ok(rde.includes('runIntegrity.readInbound(event)'),
    'B1：必须从 event **只读**读取 inbound correlation');
  assert.ok(rde.includes('pipeline_run_id'), 'B1：runDecisionEngine 必须记录 pipeline_run_id');
  // ⛔ 边界仍必须成立：pipeline 字段**不得**进入决策计算路径
  assert.ok(!/decision\.runDecision\([^)]*pipeline/.test(rde),
    '⛔ pipeline 字段不得进入 decision.runDecision 的参数');
});

test('A.3【B1 后更新】transport 与 business 已分离（旧缺口已闭合，且未越界）', () => {
  const mi = readCf('materializeIndicators');
  // ⚠️ 本条原为「记录修复前缺口」的断言（catch 只留字符串、全仓无两维状态）。
  //    B1 接线后缺口已闭合 ⇒ 断言改为证明**新事实**。
  // ① 旧语义必须**逐字保留**（这是不许破坏的兼容面）
  assert.ok(mi.includes("chained = { error: String(e.message || e) };"),
    'chained.error 的旧语义必须保留（不得被结构化字段取代）');
  assert.ok(mi.includes('ok: true, version, duration_ms:'),
    'caller 返回体主形态不变（未改控制流）');
  // ② B1 新事实：transport / business 分离 + pipeline_run_id 透传
  assert.ok(mi.includes('transport_status'), 'B1：必须结构化记录 transport_status');
  assert.ok(mi.includes('business_status'), 'B1：必须结构化记录 business_status');
  assert.ok(mi.includes('pipeline_run_id'), 'B1：必须透传 pipeline_run_id');
  assert.ok(mi.includes('buildForwardPayload'), 'B1：必须用契约模块构造透传载荷（保留 from 语义）');
  // ③ 边界：不得顺手引入 retry / 改动 timeout
  assert.ok(!/retry\s*:/.test(mi), '⛔ 不得引入 retry 参数');
  assert.ok(!/timeout\s*:/.test(mi), '⛔ 不得引入 / 修改 timeout 参数');
  // ④ 至少一个云函数含两维状态（旧断言要求 0 处，正是被关闭的缺口）
  const cf = fs.readdirSync(path.join(REPO, 'cloudfunctions'));
  let hits = 0;
  cf.forEach((fn) => {
    const p = path.join(REPO, 'cloudfunctions', fn, 'index.js');
    if (fs.existsSync(p) && fs.readFileSync(p, 'utf8').includes('transport_status')) hits += 1;
  });
  assert.ok(hits >= 1, `B1：cloudfunctions 内应至少 1 处 transport_status（实测 ${hits}）`);
});

test('A.4 全仓有 4 个不同入口进入 runDecisionEngine（关联必须能区分来源）', () => {
  const hits = [];
  const cf = fs.readdirSync(path.join(REPO, 'cloudfunctions'));
  cf.forEach((fn) => {
    const p = path.join(REPO, 'cloudfunctions', fn, 'index.js');
    if (!fs.existsSync(p)) return;
    const src = fs.readFileSync(p, 'utf8');
    const re = /name: 'runDecisionEngine', data: \{ from: '([^']+)' \}/g;
    let m;
    while ((m = re.exec(src)) !== null) hits.push(m[1]);
    if (src.includes("name: 'materializeIndicators', data: { from:")) hits.push('MATERIALIZE_ENTRY');
  });
  assert.ok(hits.length >= 4, `入口数 = ${hits.length}: ${JSON.stringify(hits)}`);
  assert.ok(hits.includes('riskResolve') || hits.includes('riskTrigger') || hits.includes('paramChange'),
    'adminGateway 的人工入口必须被识别为 manual 来源');
});

/* ================================================================== *
 * §B 契约基础
 * ================================================================== */
section('§B pipeline_run_id 契约');

test('B.1 身份不含 wall-clock；同输入 ⇒ 同 id', () => {
  const a = buildPipelineIdentity({ expected_trade_date: TD, origin: ORIGIN.TIMER, entry_function: 'materializeIndicators', attempt: 1 });
  const b = buildPipelineIdentity({ expected_trade_date: TD, origin: ORIGIN.TIMER, entry_function: 'materializeIndicators', attempt: 1 });
  assert.strictEqual(a.pipeline_run_id, b.pipeline_run_id);
  assert.ok(a.pipeline_run_id.includes(TD), 'id 内含 trade date（可读）');
  // ⛔ 身份成分里不得出现时间戳
  assert.ok(!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(a.pipeline_run_id), 'id 不得含 ISO 时间戳');
  assert.ok(a.identity_basis.includes('不含 wall-clock'));
});

test('B.2 attempt 递增 ⇒ 同一条 pipeline 的 retry 可识别', () => {
  const k = { expected_trade_date: TD, origin: ORIGIN.TIMER, entry_function: 'materializeIndicators' };
  const a1 = buildPipelineIdentity(Object.assign({ attempt: 1 }, k));
  const a2 = buildPipelineIdentity(Object.assign({ attempt: 2 }, k));
  assert.strictEqual(a1.pipeline_key, a2.pipeline_key, '同 pipeline_key');
  assert.notStrictEqual(a1.pipeline_run_id, a2.pipeline_run_id, '不同 run id');
  assert.strictEqual(parsePipelineRunId(a2.pipeline_run_id).attempt, 2);
});

test('B.3 parsePipelineRunId 可反解身份成分', () => {
  const id = buildPipelineIdentity({ expected_trade_date: TD, origin: ORIGIN.MANUAL, entry_function: 'adminGateway', source_detail: 'riskTrigger', attempt: 3 });
  const p = parsePipelineRunId(id.pipeline_run_id);
  assert.strictEqual(p.valid, true);
  assert.strictEqual(p.expected_trade_date, TD);
  assert.strictEqual(p.origin, ORIGIN.MANUAL);
  assert.strictEqual(p.entry_function, 'adminGateway');
  assert.strictEqual(p.source_detail, 'riskTrigger');
  assert.strictEqual(p.attempt, 3);
  assert.strictEqual(parsePipelineRunId('garbage').valid, false);
  assert.strictEqual(parsePipelineRunId(null).valid, false);
});

test('B.4 传输错误分类：ESOCKETTIMEDOUT → CALL_TIMEOUT，其它 → CALL_ERROR', () => {
  assert.strictEqual(classifyTransportError({ message: 'ESOCKETTIMEDOUT' }).transport_status, T.CALL_TIMEOUT);
  assert.strictEqual(classifyTransportError({ code: 'ESOCKETTIMEOUT' }).transport_status, T.CALL_TIMEOUT);
  assert.strictEqual(classifyTransportError({ code: 'ETIMEDOUT', message: 'x' }).transport_status, T.CALL_TIMEOUT);
  assert.strictEqual(classifyTransportError({ message: 'socket hang up' }).transport_status, T.CALL_ERROR);
  assert.strictEqual(classifyTransportError({ code: 'ENOTFOUND', message: 'dns' }).transport_status, T.CALL_ERROR);
});

/* ================================================================== *
 * §C 状态模型独立性（可执行守卫）
 * ================================================================== */
section('§C transport 与 business 必须独立');

test('C.1 settleTransport 携带 business_status ⇒ 抛错', () => {
  const rec = buildCallRecord({ expected_trade_date: TD, origin: ORIGIN.TIMER, entry_function: 'mi', caller_function: 'mi', callee_function: 'rde' });
  assert.throws(() => settleTransport(rec, { transport_status: T.CALL_TIMEOUT, business_status: B.FAILED }),
    /FORBIDDEN_INFERENCE/);
});

test('C.2 ⛔ CALL_TIMEOUT ⇒ business FAILED 被显式禁止（可执行）', () => {
  assert.throws(() => deriveBusinessFromTransport(), /FORBIDDEN_INFERENCE/);
});

test('C.3 ⛔ CALL_RETURNED ⇒ business COMPLETE 被显式禁止（可执行）', () => {
  assert.throws(() => deriveTransportFromBusiness(), /FORBIDDEN_INFERENCE/);
});

test('C.4 CALL_TIMEOUT 且无业务自证 ⇒ NOT_OBSERVED（不是 FAILED）', async () => {
  const store = createObservationStore();
  const id = store.allocateIdentity({ expected_trade_date: TD, origin: ORIGIN.TIMER, entry_function: 'materializeIndicators' });
  let rec = buildCallRecord({ identity: id, caller_function: 'materializeIndicators', callee_function: 'runDecisionEngine', expected_trade_date: TD });
  rec = settleTransport(rec, { transport_status: T.CALL_TIMEOUT, error_code: 'ESOCKETTIMEDOUT' });
  await store.putCallRecord(rec);
  const r = await store.reconcileByRunId(id.pipeline_run_id);
  assert.strictEqual(r.transport_status, T.CALL_TIMEOUT);
  assert.strictEqual(r.business_status, B.NOT_OBSERVED, '⛔ 不得推断为 FAILED');
  assert.strictEqual(r.correlated, false);
});

test('C.5 CALL_RETURNED 但业务只到 RUNNING ⇒ 不得记为 COMPLETE', async () => {
  const store = createObservationStore();
  const id = store.allocateIdentity({ expected_trade_date: TD, origin: ORIGIN.CHAIN, entry_function: 'materializeIndicators' });
  let rec = buildCallRecord({ identity: id, caller_function: 'mi', callee_function: 'rde', expected_trade_date: TD });
  rec = settleTransport(rec, { transport_status: T.CALL_RETURNED });
  await store.putCallRecord(rec);
  await store.putBusinessObservation(buildBusinessObservation({ identity: id, callee_function: 'rde', business_status: B.RUNNING }));
  const r = await store.reconcileByRunId(id.pipeline_run_id);
  assert.strictEqual(r.transport_status, T.CALL_RETURNED);
  assert.strictEqual(r.business_status, B.RUNNING, '⛔ 传输成功 ≠ 业务完成');
});

/* ================================================================== *
 * §D P4-T1 ~ T8
 * ================================================================== */
section('§D P4-T1 ~ T8');

test('P4-T1 Normal success：CALL_RETURNED + COMPLETE，关联正确', async () => {
  const store = createObservationStore();
  const id = store.allocateIdentity({ expected_trade_date: TD, origin: ORIGIN.CHAIN, entry_function: 'fetchDailyData' });
  let rec = buildCallRecord({ identity: id, caller_function: 'materializeIndicators', caller_request_id: 'req-up-1', callee_function: 'runDecisionEngine', expected_trade_date: TD });
  rec = settleTransport(rec, { transport_status: T.CALL_RETURNED, callee_request_id: 'req-down-1', engine_run_id: 'engine-run-1' });
  await store.putCallRecord(rec);
  await store.putBusinessObservation(buildBusinessObservation({ identity: id, callee_function: 'runDecisionEngine', callee_request_id: 'req-down-1', engine_run_id: 'engine-run-1', business_status: B.COMPLETE }));
  const r = await store.reconcileByRunId(id.pipeline_run_id);
  assert.strictEqual(r.correlated, true);
  assert.strictEqual(r.correlation_basis, 'pipeline_run_id_equality');
  assert.strictEqual(r.transport_status, T.CALL_RETURNED);
  assert.strictEqual(r.business_status, B.COMPLETE);
  assert.strictEqual(r.caller_request_id, 'req-up-1');
  assert.strictEqual(r.callee_request_id, 'req-down-1');
  assert.strictEqual(isObs001Shape(r), false);
});

test('P4-T2 Caller timeout / downstream success：CALL_TIMEOUT + COMPLETE 可结构化表达', async () => {
  const store = createObservationStore();
  // 复刻 OBS-001 真实形态：上游 request 1fcaa62f… / 下游 request 804f7202…
  const id = store.allocateIdentity({ expected_trade_date: TD, origin: ORIGIN.TIMER, entry_function: 'materializeIndicators' });
  let rec = buildCallRecord({
    identity: id, caller_function: 'materializeIndicators', caller_request_id: '1fcaa62f-1191-46c7-a986-0e206807d3c7',
    callee_function: 'runDecisionEngine', expected_trade_date: TD, started_at: TS_START
  });
  rec = settleTransport(rec, { transport_status: T.CALL_TIMEOUT, error_code: 'ESOCKETTIMEDOUT', error_message: 'ESOCKETTIMEDOUT', completed_at: '2026-09-24T00:00:30.488Z' });
  await store.putCallRecord(rec);
  // 下游自证（在**另一侧**写入，caller 已放弃等待）
  await store.putBusinessObservation(buildBusinessObservation({
    identity: id, callee_function: 'runDecisionEngine', callee_request_id: '804f7202-…',
    business_status: B.COMPLETE, completed_at: TS_END, detail: { etf_success: 5, etf_expected: 5 }
  }));

  const r = await store.reconcileByRunId(id.pipeline_run_id);
  assert.strictEqual(isObs001Shape(r), true, '必须能判定为 OBS-001 形态');
  assert.strictEqual(r.transport_status, T.CALL_TIMEOUT);
  assert.strictEqual(r.business_status, B.COMPLETE);
  assert.strictEqual(r.correlated, true, '相关性靠 pipeline_run_id，而非时间窗口');
  assert.strictEqual(r.manual_reconstruction_required, 0, '无人工拼接依赖');
});

test('P4-T3 Caller timeout / downstream still running：CALL_TIMEOUT + RUNNING', async () => {
  const store = createObservationStore();
  const id = store.allocateIdentity({ expected_trade_date: TD, origin: ORIGIN.TIMER, entry_function: 'materializeIndicators' });
  let rec = buildCallRecord({ identity: id, caller_function: 'mi', callee_function: 'rde', expected_trade_date: TD });
  rec = settleTransport(rec, { transport_status: T.CALL_TIMEOUT, error_code: 'ESOCKETTIMEDOUT' });
  await store.putCallRecord(rec);
  await store.putBusinessObservation(buildBusinessObservation({ identity: id, callee_function: 'rde', business_status: B.RUNNING }));
  const r = await store.reconcileByRunId(id.pipeline_run_id);
  assert.strictEqual(r.transport_status, T.CALL_TIMEOUT);
  assert.strictEqual(r.business_status, B.RUNNING);
  assert.strictEqual(isObs001Shape(r), false);
});

test('P4-T4 Caller timeout / downstream failed：CALL_TIMEOUT + FAILED', async () => {
  const store = createObservationStore();
  const id = store.allocateIdentity({ expected_trade_date: TD, origin: ORIGIN.TIMER, entry_function: 'materializeIndicators' });
  let rec = buildCallRecord({ identity: id, caller_function: 'mi', callee_function: 'rde', expected_trade_date: TD });
  rec = settleTransport(rec, { transport_status: T.CALL_TIMEOUT, error_code: 'ESOCKETTIMEDOUT' });
  await store.putCallRecord(rec);
  await store.putBusinessObservation(buildBusinessObservation({ identity: id, callee_function: 'rde', business_status: B.FAILED, detail: { reason: 'boom' } }));
  const r = await store.reconcileByRunId(id.pipeline_run_id);
  assert.strictEqual(r.transport_status, T.CALL_TIMEOUT);
  assert.strictEqual(r.business_status, B.FAILED);
  assert.strictEqual(isObs001Shape(r), false);
});

test('P4-T5 Call error before downstream starts：CALL_ERROR + NOT_OBSERVED', async () => {
  const store = createObservationStore();
  const id = store.allocateIdentity({ expected_trade_date: TD, origin: ORIGIN.TIMER, entry_function: 'materializeIndicators' });
  let rec = buildCallRecord({ identity: id, caller_function: 'mi', callee_function: 'rde', expected_trade_date: TD });
  const cls = classifyTransportError({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND' });
  rec = settleTransport(rec, { transport_status: cls.transport_status, error_code: cls.error_code, error_message: cls.error_message });
  await store.putCallRecord(rec);
  const r = await store.reconcileByRunId(id.pipeline_run_id);
  assert.strictEqual(r.transport_status, T.CALL_ERROR);
  assert.strictEqual(r.business_status, B.NOT_OBSERVED);
  assert.strictEqual(r.correlation_basis, 'business_not_observed');
});

test('P4-T6 Same pipeline retry：同 pipeline_key、attempt 递增、不被误认为两次独立决策', async () => {
  const store = createObservationStore();
  const base = { expected_trade_date: TD, origin: ORIGIN.TIMER, entry_function: 'materializeIndicators' };
  const id1 = store.allocateIdentity(base);
  const id2 = store.allocateIdentity(base);
  for (const id of [id1, id2]) {
    let rec = buildCallRecord({ identity: id, caller_function: 'mi', callee_function: 'rde', expected_trade_date: TD });
    rec = settleTransport(rec, { transport_status: T.CALL_TIMEOUT, error_code: 'ESOCKETTIMEDOUT' });
    await store.putCallRecord(rec);
  }
  assert.strictEqual(id1.pipeline_key, id2.pipeline_key, '同一逻辑 pipeline');
  assert.strictEqual(id1.attempt, 1);
  assert.strictEqual(id2.attempt, 2);
  const attempts = await store.listAttempts(id1.pipeline_key);
  assert.strictEqual(attempts.length, 2);
  assert.deepStrictEqual(attempts.map((r) => r.attempt), [1, 2]);
  assert.notStrictEqual(attempts[0].pipeline_run_id, attempts[1].pipeline_run_id);
});

test('P4-T7 Different pipeline runs, same trade date：可区分', async () => {
  const store = createObservationStore();
  const a = store.allocateIdentity({ expected_trade_date: TD, origin: ORIGIN.TIMER, entry_function: 'materializeIndicators' });
  const b = store.allocateIdentity({ expected_trade_date: TD, origin: ORIGIN.MANUAL, entry_function: 'adminGateway', source_detail: 'riskTrigger' });
  assert.notStrictEqual(a.pipeline_key, b.pipeline_key, '同交易日但来源不同 ⇒ 必须可区分');
  assert.strictEqual(parsePipelineRunId(a.pipeline_run_id).expected_trade_date,
    parsePipelineRunId(b.pipeline_run_id).expected_trade_date, '同日');
  // 同日、同源、不同 attempt 也可区分
  const c = store.allocateIdentity({ expected_trade_date: TD, origin: ORIGIN.TIMER, entry_function: 'materializeIndicators' });
  assert.strictEqual(c.pipeline_key, a.pipeline_key);
  assert.notStrictEqual(c.pipeline_run_id, a.pipeline_run_id);
});

test('P4-T8 Manual run：origin=manual + 明确来源，仍满足契约', async () => {
  const store = createObservationStore();
  const id = store.allocateIdentity({
    expected_trade_date: TD, origin: ORIGIN.MANUAL, entry_function: 'adminGateway', source_detail: 'paramChange'
  });
  const rec = buildCallRecord({
    identity: id, caller_function: 'adminGateway', caller_request_id: 'req-admin-1',
    callee_function: 'runDecisionEngine', expected_trade_date: TD
  });
  await store.putCallRecord(rec);
  assert.strictEqual(rec.origin, ORIGIN.MANUAL);
  assert.strictEqual(parsePipelineRunId(rec.pipeline_run_id).source_detail, 'paramChange');
  assert.strictEqual(rec.caller_request_id, 'req-admin-1');
  const r = await store.reconcileByRunId(id.pipeline_run_id);
  assert.strictEqual(r.transport_status, T.CALL_STARTED, '（未结算 ⇒ 仍是 CALL_STARTED）');
  assert.strictEqual(r.business_status, B.NOT_OBSERVED);
});

/* ================================================================== *
 * §E 三 ID 语义区分 / 与 P-3 共存
 * ================================================================== */
section('§E 三 ID 不得混用');

test('E.1 ⛔ pipeline 身份被当作 engine/active 身份复用 ⇒ 抛错', () => {
  assert.throws(() => assertDistinctIdentities({ pipeline_run_id: 'x', engine_run_id: 'x' }),
    /FORBIDDEN_IDENTITY_CONFLATION/);
  assert.throws(() => assertDistinctIdentities({ pipeline_run_id: 'x', active_run_id: 'x' }),
    /FORBIDDEN_IDENTITY_CONFLATION/);
  // ✅ engine == active **不**抛错：active pointer 本就指向某个 run_id（见 E.2）
  assert.doesNotThrow(() => assertDistinctIdentities({ engine_run_id: 'x', active_run_id: 'x' }));
});

test('E.2 与 P-3 共存：pipeline 身份独立；engine==active 合法（pointer 指向该 run）', () => {
  const store = createObservationStore();
  const id = store.allocateIdentity({ expected_trade_date: TD, origin: ORIGIN.TIMER, entry_function: 'materializeIndicators' });
  const out = assertDistinctIdentities({
    pipeline_run_id: id.pipeline_run_id,
    engine_run_id: 'run-A',      // ← P-3 的 candidate run_id
    active_run_id: 'run-A'       // ← P-3 的 pointer 指向的 run（== engine 是**合法**的）
  });
  assert.strictEqual(out.pointer_targets_run, true, 'active pointer 指向该 run ⇒ 合法，不是混用');
  assert.notStrictEqual(out.pipeline_run_id, out.engine_run_id, 'pipeline 身份必须独立于 engine 身份');
  assert.strictEqual(out.semantics.pipeline_run_id, '整条任务链身份');
  assert.strictEqual(out.semantics.engine_run_id.includes('P-3'), true);
  assert.strictEqual(out.semantics.active_run_id.includes('P-3'), true);
});

test('E.4 记录继承 identity 成分（不会退化成 unknown）', () => {
  const id = buildPipelineIdentity({
    expected_trade_date: TD, origin: ORIGIN.MANUAL, entry_function: 'adminGateway', source_detail: 'riskTrigger', attempt: 1
  });
  const rec = buildCallRecord({ identity: id, caller_function: 'adminGateway', callee_function: 'runDecisionEngine' });
  assert.strictEqual(rec.origin, ORIGIN.MANUAL, '必须继承 identity.origin，而非退化为 unknown');
  assert.strictEqual(rec.entry_function, 'adminGateway');
  assert.strictEqual(rec.source_detail, 'riskTrigger');
  assert.strictEqual(rec.expected_trade_date, TD);
});

test('E.3 callee 只读读取：老 caller 不传字段 ⇒ present=false，不猜不伪造', () => {
  const none = readInboundCorrelation({ from: 'materializeIndicators' });
  assert.strictEqual(none.present, false);
  assert.strictEqual(none.pipeline_run_id, null);
  assert.strictEqual(none.attempt, null);
  const ok = readInboundCorrelation(buildForwardPayload({
    identity: buildPipelineIdentity({ expected_trade_date: TD, origin: ORIGIN.CHAIN, entry_function: 'fetchDailyData', attempt: 1 }),
    caller_function: 'materializeIndicators', origin: ORIGIN.CHAIN, entry_function: 'fetchDailyData', expected_trade_date: TD
  }));
  assert.strictEqual(ok.present, true);
  assert.strictEqual(ok.expected_trade_date, TD);
  assert.strictEqual(ok.from, 'materializeIndicators', 'from 语义不变');
});

/* ================================================================== *
 * §F 补丁边界
 * ================================================================== */
section('§F 候选补丁边界');

test('F.1 两个补丁均通过 additive-only 校验', () => {
  PATCHES_MOD.PATCHES.forEach((p) => {
    const r = PATCHES_MOD.assertPatchIsAdditiveOnly(p);
    assert.strictEqual(r.ok, true, `${p.id}: ${JSON.stringify(r)}`);
  });
});

test('F.2 MATERIALIZE_CHANGE_REQUIRED = YES；冻结件补丁需授权', () => {
  assert.strictEqual(PATCHES_MOD.MATERIALIZE_CHANGE_REQUIRED, true);
  assert.strictEqual(PATCHES_MOD.PATCH_RUN_DECISION_ENGINE.frozen, true);
  assert.strictEqual(PATCHES_MOD.PATCH_APPLICATION_REQUIRES_AUTHORIZATION, true);
});

test('F.3 补丁未引入 retry / timeout / 控制流变更', () => {
  PATCHES_MOD.PATCHES.forEach((p) => {
    assert.strictEqual(p.retry_added, false);
    assert.strictEqual(p.timeout_changed, false);
    assert.strictEqual(p.business_control_flow_changed, false);
    assert.ok(p.strictly_forbidden.length >= 3, `${p.id} 必须显式列出禁止项`);
  });
});

test('F.4【B1 后更新】补丁已在授权范围内落盘（旧"只描述不落盘"约束已被 B1 授权取代）', () => {
  const cf = fs.readdirSync(path.join(REPO, 'cloudfunctions'));
  const wired = [];
  cf.forEach((fn) => {
    const p = path.join(REPO, 'cloudfunctions', fn, 'index.js');
    if (fs.existsSync(p) && fs.readFileSync(p, 'utf8').includes('pipeline_run_id')) wired.push(fn);
  });
  // ⚠️ 原断言要求「云函数仍不含 pipeline_run_id」（记录"补丁只描述、未落盘"）。
  //    B1 轮次已显式授权落盘 ⇒ 断言改为**精确限定落盘范围**（更强，不是放宽）。
  assert.deepStrictEqual(wired.sort(), ['materializeIndicators', 'runDecisionEngine'],
    'B1 只允许 materializeIndicators + runDecisionEngine 被接线；实得 ' + JSON.stringify(wired));
});

/* ------------------------------------------------------------------ *
 * 执行 + 汇总
 * ------------------------------------------------------------------ */
(async () => {
  for (const c of asyncCases) {
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
