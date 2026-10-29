#!/usr/bin/env node
/**
 * V3.6.5 P-4 —— Pipeline Correlation Gate（任务书 §12）
 *
 * 输出 8 项判定并给出 `P4_PIPELINE_OBSERVABILITY = PASS / FAIL`。
 *
 * ⛔ 只读：不写文件、不联网、不部署、不改云函数。
 * ⛔ 不调子进程（沙箱禁止）——「改动文件清单」由调用方（bash）生成后经 --changed-file 传入。
 *
 * 用法：node scripts/v365-p4-correlation-gate.js --changed-file <path>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const U = (f) => require(path.join(REPO, 'src/common/utils', f));
const L = (f) => require(path.join(REPO, 'scripts/lib', f));

/* ---- 回放依赖集 ----------------------------------------------------------
 * ⚠️ 必须**先于**本 gate 自有模块加载：否则 U('pipeline-correlation.js') 等会被
 *    算进「回放依赖集」，与「改动文件」产生**假交集**（曾踩，详见 MEMORY 的脚本自指坑）。
 * 做法：记录基线缓存 → 只加载 harness → 增量即 harness 的传递闭包。
 * ------------------------------------------------------------------------ */
const SELF = path.relative(REPO, require.main.filename).split(path.sep).join('/');
const _BASE_CACHE = new Set(Object.keys(require.cache));
require(path.join(REPO, 'scripts', 'lib', 'v364-replay-harness.js'));
const REPLAY_DEPS = new Set(
  Object.keys(require.cache)
    .filter((k) => !_BASE_CACHE.has(k))
    .map((p) => path.relative(REPO, p).split(path.sep).join('/'))
    .filter((p) => p && !p.startsWith('..') && p !== SELF)
);

const {
  TRANSPORT_STATUS: T, BUSINESS_STATUS: B, ORIGIN,
  buildPipelineIdentity, buildCallRecord, settleTransport, buildBusinessObservation,
  reconcile, isObs001Shape, deriveBusinessFromTransport, deriveTransportFromBusiness,
  assertDistinctIdentities
} = U('pipeline-correlation.js');
const { createObservationStore } = L('v365-p4-observation-store.js');
const PATCH = L('v365-p4-candidate-patches.js');

const TD = '2026-09-23';
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
}

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const n = argv[i].slice(2);
    const v = argv[i + 1];
    if (v == null || v.startsWith('--')) { a[n] = true; continue; }
    a[n] = v; i += 1;
  }
  return a;
}

(async () => {
  const a = parseArgs(process.argv);
  console.log('== P-4 Pipeline Correlation Gate ==\n');

  /* ---- 1. PIPELINE_CORRELATION_ID ---- */
  {
    const store = createObservationStore();
    const id = store.allocateIdentity({ expected_trade_date: TD, origin: ORIGIN.TIMER, entry_function: 'materializeIndicators' });
    const again = buildPipelineIdentity({ expected_trade_date: TD, origin: ORIGIN.TIMER, entry_function: 'materializeIndicators', attempt: 1 });
    const noClock = !/\d{4}-\d{2}-\d{2}T\d{2}/.test(id.pipeline_run_id);
    check('PIPELINE_CORRELATION_ID = PASS',
      id.pipeline_run_id === again.pipeline_run_id && noClock && id.pipeline_run_id.includes(TD),
      `id=${id.pipeline_run_id}（可复现、不含 wall-clock）`);
  }

  /* ---- 2. TRANSPORT_BUSINESS_STATUS_SEPARATED ---- */
  {
    let sep = true; let why = '';
    try { settleTransport(buildCallRecord({ expected_trade_date: TD, origin: ORIGIN.TIMER, entry_function: 'mi' }),
      { transport_status: T.CALL_TIMEOUT, business_status: B.FAILED }); sep = false; why = 'settleTransport 未拒绝 business_status'; }
    catch (e) { why = 'settleTransport 拒绝携带 business_status'; }
    let g1 = false; let g2 = false;
    try { deriveBusinessFromTransport(); } catch (e) { g1 = /FORBIDDEN_INFERENCE/.test(e.message); }
    try { deriveTransportFromBusiness(); } catch (e) { g2 = /FORBIDDEN_INFERENCE/.test(e.message); }
    check('TRANSPORT_BUSINESS_STATUS_SEPARATED = PASS', sep && g1 && g2,
      `${why}；两条禁止推断守卫均生效`);
  }

  /* ---- 3. TIMEOUT_SUCCESS_CASE_EXPRESSIBLE（OBS-001 形态）---- */
  {
    const store = createObservationStore();
    const id = store.allocateIdentity({ expected_trade_date: TD, origin: ORIGIN.TIMER, entry_function: 'materializeIndicators' });
    let rec = buildCallRecord({ identity: id, caller_function: 'materializeIndicators', caller_request_id: '1fcaa62f-…', callee_function: 'runDecisionEngine', expected_trade_date: TD });
    rec = settleTransport(rec, { transport_status: T.CALL_TIMEOUT, error_code: 'ESOCKETTIMEDOUT' });
    await store.putCallRecord(rec);
    await store.putBusinessObservation(buildBusinessObservation({ identity: id, callee_function: 'runDecisionEngine', callee_request_id: '804f7202-…', business_status: B.COMPLETE, detail: { etf_success: 5, etf_expected: 5 } }));
    const r = await store.reconcileByRunId(id.pipeline_run_id);
    check('TIMEOUT_SUCCESS_CASE_EXPRESSIBLE = PASS',
      isObs001Shape(r) && r.correlation_basis === 'pipeline_run_id_equality' && r.manual_reconstruction_required === 0,
      `transport=${r.transport_status} business=${r.business_status} basis=${r.correlation_basis}`);
  }

  /* ---- 4/5/6. RETRY / TIMEOUT / CONTROL_FLOW —— 静态证明 ---- */
  // 最强证据：cloudfunctions/ 相对 origin/master **零改动**。
  let changed = [];
  if (a['changed-file'] && fs.existsSync(a['changed-file'])) {
    changed = fs.readFileSync(a['changed-file'], 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
      .map((s) => s.split(path.sep).join('/'));
  }
  const cfChanged = changed.filter((f) => f.startsWith('cloudfunctions/'));
  check('RETRY_NOT_ENABLED = PASS',
    cfChanged.length === 0
      && PATCH.PATCHES.every((p) => p.retry_added === false)
      && !/setTimeout|retry\s*\(/i.test(fs.readFileSync(path.join(REPO, 'src/common/utils/pipeline-correlation.js'), 'utf8')),
    `cloudfunctions 改动 ${cfChanged.length} 个；补丁 retry_added 全为 false；本模块无重试逻辑`);

  check('TIMEOUT_NOT_CHANGED = PASS',
    cfChanged.length === 0 && PATCH.PATCHES.every((p) => p.timeout_changed === false),
    'cloudfunctions 零改动 ⇒ 任何 timeout 参数均不可能被改');
  check('CONTROL_FLOW_UNCHANGED = PASS',
    cfChanged.length === 0 && PATCH.PATCHES.every((p) => p.business_control_flow_changed === false),
    'cloudfunctions 零改动 ⇒ materializeIndicators → runDecisionEngine 链式控制流逐字未变');

  /* ---- 7. SAME_PIPELINE_RETRY_DISTINGUISHABLE ---- */
  {
    const store = createObservationStore();
    const base = { expected_trade_date: TD, origin: ORIGIN.TIMER, entry_function: 'materializeIndicators' };
    const i1 = store.allocateIdentity(base);
    const i2 = store.allocateIdentity(base);
    for (const id of [i1, i2]) {
      let rec = buildCallRecord({ identity: id, caller_function: 'materializeIndicators', callee_function: 'runDecisionEngine' });
      rec = settleTransport(rec, { transport_status: T.CALL_TIMEOUT, error_code: 'ESOCKETTIMEDOUT' });
      await store.putCallRecord(rec);          // ⚠️ 必须真的落记录，否则 listAttempts 恒为空
    }
    const attempts = await store.listAttempts(i1.pipeline_key);
    const sameKey = i1.pipeline_key === i2.pipeline_key;
    const a1 = i1.attempt; const a2 = i2.attempt;
    const diffRunId = i1.pipeline_run_id !== i2.pipeline_run_id;
    // 明细必须**由实际值派生**（⛔ 不得写静态成功文案）
    const detail = `same_key=${sameKey} attempt=${a1}→${a2} run_id_differs=${diffRunId} records=${attempts.length}`;
    check('SAME_PIPELINE_RETRY_DISTINGUISHABLE = PASS',
      sameKey && a1 === 1 && a2 === 2 && diffRunId && attempts.length === 2, detail);
  }

  /* ---- 8. NORMAL_PATH_DECISION_DELTA = 0 ---- */
  {
    const overlap = changed.filter((f) => REPLAY_DEPS.has(f));
    const CORE = ['src/common/utils/decision.js', 'src/common/utils/decision-v3.js', 'src/common/utils/trend-stage.js',
      'src/common/utils/correlation.js', 'src/common/utils/defense.js', 'src/common/utils/swing-structure.js',
      'src/common/utils/market-regime.js', 'src/common/utils/indicators.js',
      'cloudfunctions/runDecisionEngine/index.js', 'cloudfunctions/materializeIndicators/index.js'];
    const touched = changed.filter((f) => CORE.includes(f));
    check('NORMAL_PATH_DECISION_DELTA = 0', overlap.length === 0 && touched.length === 0,
      `改动 ∩ 回放依赖集(${REPLAY_DEPS.size}) = ${JSON.stringify(overlap)}；决策核心被改动 = ${JSON.stringify(touched)}`);
  }

  /* ---- 附加：三 ID 守卫可用 ---- */
  {
    let ok = true; let detail = '';
    try {
      const store = createObservationStore();
      const id = store.allocateIdentity({ expected_trade_date: TD, origin: ORIGIN.TIMER, entry_function: 'mi' });
      const out = assertDistinctIdentities({ pipeline_run_id: id.pipeline_run_id, engine_run_id: 'run-A', active_run_id: 'run-A' });
      ok = out.pointer_targets_run === true;
      detail = `pipeline 独立、engine==active 记为 pointer_targets_run=${out.pointer_targets_run}`;
    } catch (e) { ok = false; detail = e.message; }
    console.log(`  [INFO] 三 ID 语义：${detail}`);
  }

  const bad = results.filter((r) => !r.ok);
  console.log('\n== 结论 ==');
  if (bad.length === 0) {
    console.log('  P4_PIPELINE_OBSERVABILITY = PASS');
    console.log(`  MATERIALIZE_CHANGE_REQUIRED = ${PATCH.MATERIALIZE_CHANGE_REQUIRED ? 'YES' : 'NO'}`);
    console.log(`  PATCH_APPLICATION_REQUIRES_AUTHORIZATION = ${PATCH.PATCH_APPLICATION_REQUIRES_AUTHORIZATION ? 'true' : 'false'}`);
    process.exit(0);
  }
  console.log(`  P4_PIPELINE_OBSERVABILITY = FAIL（${bad.map((b) => b.name).join('; ')}）`);
  process.exit(1);
})();
