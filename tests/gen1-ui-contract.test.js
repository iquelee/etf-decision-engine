'use strict';

/**
 * PR-UI-01：Gen-1 UI 契约测试（UI-G1-01 .. UI-G1-09）。
 *
 * 守卫对象：src/common/utils/gen1-ui-view-model.js + 两个 gateway 的接线。
 * 核心不变量：
 *   - production.* 唯一来源 = decision_result(final_action/final_target/suggested_position)
 *     + portfolio_position.current_position；
 *   - gen1.counterfactual.* 绝不得覆盖 production.*；
 *   - authority 唯一来源 = runtime_status.gen1_authority（禁止 ml_* 参数反推）；
 *   - CANARY 下 production_write / auto_execution / production_fast_path_enabled 恒 false；
 *   - Review 生产来源引擎恒为 V3.6.1。
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const {
  buildSystemRuntime,
  buildHealthTruth,
  buildCanaryLedger,
  buildEtfUiViewModel,
  buildReviewGen1,
  buildLegacyNotice,
  LEGACY_DEPRECATED_FIELDS,
  SIGNAL_STATUS
} = require('../src/common/utils/gen1-ui-view-model');

/* ---------- 共用夹具 ---------- */

function makeRuntime(overrides) {
  return Object.assign({
    key: 'runtime-status',
    production_engine: 'v3.6.1',
    gen1_authority: 'CANARY',
    gen1_authority_label: '灰度反事实',
    gen1_health_status: 'OK',
    gen1_health_gate_status: 'ACTIVE',
    gen1_health_source: 'GEN1_HEALTH_STATE_LATCH',
    gen1_safety_source: 'SAFETY_CORE',
    gen1_counterfactual_canary_active: true,
    gen1_counterfactual_canary_invocations: 0,
    gen1_counterfactual_ledger_ok: true,
    gen1_production_write: false,
    gen1_auto_execution: false,
    gen1_production_fast_path_enabled: false,
    gen1_production_tech_position: 16.2,
    gen1_counterfactual_intended_tech_position: 16.2,
    gen1_counterfactual_tech_cap: 65,
    gen1_counterfactual_target_sum: 48.6
  }, overrides || {});
}

function makeDecision(overrides) {
  return Object.assign({
    code: '513310',
    decision_date: '2026-09-10',
    final_action: 'HOLD',
    final_target: 10,
    suggested_position: 10,
    risk_flag: 'GREEN',
    binding_constraint: 'sector_cap',
    gen1_model_candidate: false,
    gen1_model_threshold_p: 0.65,
    ml_rule_permission: 'PERMIT',
    ml_rule_permission_reason_code: 'SAFETY_OK',
    ml_rule_permission_reason: 'Safety Core 复核通过',
    ml_rule_permission_source: 'SAFETY_CORE',
    gen1_counterfactual_target: 10,
    gen1_counterfactual_suggested_position: 10,
    gen1_counterfactual_delta: 0,
    gen1_counterfactual_stage_changed: false,
    gen1_counterfactual_clamped: false,
    gen1_counterfactual_baseline_floor_breached: false,
    gen1_canary_effective: false,
    gen1_authority: 'CANARY'
  }, overrides || {});
}

function makeSignal(overrides) {
  return Object.assign({
    code: '513310',
    date: '2026-09-10',
    source_trade_date: '2026-09-10',
    benchmark_latest_date: '2026-09-10',
    stage: 'S1',
    calibrated_probability: null,
    ml_probability: null,
    signal_status: 'NO_OPPORTUNITY',
    data_health_status: 'DATA_OK',
    domain_status: 'PARTIAL_COVERAGE',
    domain_permission: 'CANARY_LIMITED',
    domain_status_label: '部分覆盖',
    domain_status_message: '部分 fold 有覆盖'
  }, overrides || {});
}

const POSITION = { code: '513310', current_position: 9.1 };

/* ---------- UI-G1-01：production.action === decision_result.final_action ---------- */
{
  const vm = buildEtfUiViewModel({
    code: '513310', name: '中韩半导体', sector: 'storage',
    decision: makeDecision({ final_action: 'ADD' }),
    position: POSITION, signal: makeSignal(), runtime: makeRuntime()
  });
  assert.strictEqual(vm.production.action_code, 'ADD', 'production.action 必须逐字来自 final_action');
  console.log('[PASS] UI-G1-01 production.action === decision_result.final_action');
}

/* ---------- UI-G1-02：production.suggested === decision_result.suggested_position ---------- */
{
  const vm = buildEtfUiViewModel({
    code: '513310', sector: 'storage',
    decision: makeDecision({ suggested_position: 12.5, final_target: 15 }),
    position: POSITION, signal: makeSignal(), runtime: makeRuntime()
  });
  assert.strictEqual(vm.production.suggested_pct, 12.5, 'suggested 必须来自 suggested_position');
  assert.strictEqual(vm.production.final_target_pct, 15, 'final_target 必须来自 decision.final_target');
  assert.strictEqual(vm.production.current_pct, 9.1, 'current 必须来自 portfolio_position.current_position');
  console.log('[PASS] UI-G1-02 production.suggested/final/current 字段来源正确');
}

/* ---------- UI-G1-03：gen1 counterfactual 不得覆盖 production.* ---------- */
{
  const decision = makeDecision({
    final_target: 10, suggested_position: 10,
    gen1_counterfactual_target: 35, gen1_counterfactual_suggested_position: 35,
    gen1_counterfactual_delta: 25, gen1_canary_effective: true, gen1_model_candidate: true
  });
  const vm = buildEtfUiViewModel({
    code: '513310', sector: 'storage',
    decision, position: POSITION,
    signal: makeSignal({ calibrated_probability: 0.72, stage: 'S2' }),
    runtime: makeRuntime()
  });
  assert.strictEqual(vm.production.final_target_pct, 10, '反事实不得污染 production.final_target');
  assert.strictEqual(vm.production.suggested_pct, 10, '反事实不得污染 production.suggested');
  assert.strictEqual(vm.gen1.counterfactual.target_pct, 35);
  assert.strictEqual(vm.gen1.counterfactual.suggested_pct, 35);
  assert.strictEqual(vm.gen1.counterfactual.delta_pct, 25);
  // production 块结构不允许出现任何 gen1_/counterfactual 字段
  for (const k of Object.keys(vm.production)) {
    assert.ok(!/gen1|counterfactual|canary/i.test(k), `production 块出现越界字段 ${k}`);
  }
  console.log('[PASS] UI-G1-03 gen1 counterfactual 不覆盖 production.*');
}

/* ---------- UI-G1-04：authority 唯一来源 = runtime_status.gen1_authority ---------- */
{
  // runtime 缺失 → null（绝不用 ml_shadow_observe / ml_advisory_enabled / ml_fast_path_enabled 兜底）
  const noRuntime = buildEtfUiViewModel({
    code: '513310', sector: 'storage',
    decision: makeDecision(), position: POSITION, signal: makeSignal(), runtime: null
  });
  assert.strictEqual(noRuntime.gen1.authority, null, 'runtime 缺失时 authority 必须为 null，禁止反推');
  const sr = buildSystemRuntime(null);
  assert.strictEqual(sr.gen1.authority, null);

  const withRuntime = buildSystemRuntime(makeRuntime({ gen1_authority: 'CANARY' }));
  assert.strictEqual(withRuntime.gen1.authority, 'CANARY');
  assert.strictEqual(withRuntime.gen1.authority_label, '灰度反事实');

  // 静态守卫：契约模块源码不得读取 ml_shadow_observe / ml_advisory_enabled / ml_fast_path_enabled
  const src = fs.readFileSync(path.join(REPO, 'src/common/utils/gen1-ui-view-model.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  assert.ok(!/ml_shadow_observe|ml_advisory_enabled|ml_fast_path_enabled/.test(src),
    '契约模块禁止引用 ml_* 配置参数反推权限');
  console.log('[PASS] UI-G1-04 runtime authority 唯一来源 runtime_status.gen1_authority');
}

/* ---------- UI-G1-05：CANARY 时 write/auto/fast_path 仍 false ---------- */
{
  const sr = buildSystemRuntime(makeRuntime({ gen1_authority: 'CANARY' }));
  assert.strictEqual(sr.gen1.production_write, false);
  assert.strictEqual(sr.gen1.auto_execution, false);
  assert.strictEqual(sr.gen1.production_fast_path_enabled, false);
  assert.strictEqual(sr.gen2.production_write, false);
  assert.strictEqual(sr.production.status, 'ACTIVE');
  assert.strictEqual(sr.production.engine, 'v3.6.1');
  console.log('[PASS] UI-G1-05 CANARY 下写权限/自动交易/生产 Fast Path 恒 false');
}

/* ---------- UI-G1-06：Health 四字段逐字段映射 ---------- */
{
  const h = buildHealthTruth(makeRuntime({
    gen1_health_status: 'OK',
    gen1_health_gate_status: 'ACTIVE',
    gen1_health_source: 'GEN1_HEALTH_STATE_LATCH',
    gen1_safety_source: 'SAFETY_CORE'
  }));
  assert.strictEqual(h.gen1_health_status, 'OK');
  assert.strictEqual(h.gen1_health_gate_status, 'ACTIVE');
  assert.strictEqual(h.gen1_health_source, 'GEN1_HEALTH_STATE_LATCH');
  assert.strictEqual(h.gen1_safety_source, 'SAFETY_CORE');
  // 四字段独立：改一个不动其它
  const h2 = buildHealthTruth(makeRuntime({ gen1_health_gate_status: 'PENDING' }));
  assert.strictEqual(h2.gen1_health_status, 'OK', 'gate 变化不得影响 status 字段');
  assert.strictEqual(h2.gen1_health_gate_status, 'PENDING');
  console.log('[PASS] UI-G1-06 Health 四字段逐字段独立映射');
}

/* ---------- UI-G1-07：518880（gold）OOD => BLOCK_CANARY / OUT_OF_DOMAIN ---------- */
{
  const vm = buildEtfUiViewModel({
    code: '518880', name: '黄金ETF', sector: 'gold',
    decision: makeDecision({ code: '518880' }),
    position: { code: '518880', current_position: 5 },
    signal: makeSignal({ code: '518880', category: 'gold', domain_status: 'OUT_OF_DOMAIN', domain_permission: 'BLOCK_CANARY' }),
    runtime: makeRuntime()
  });
  assert.strictEqual(vm.gen1.applicability.domain_status, 'OUT_OF_DOMAIN');
  assert.strictEqual(vm.gen1.applicability.domain_permission, 'BLOCK_CANARY');
  console.log('[PASS] UI-G1-07 518880 OOD 映射 BLOCK_CANARY / OUT_OF_DOMAIN');
}

/* ---------- UI-G1-08：candidates=0 => NO_OPPORTUNITY，不得伪造概率/胜率 ---------- */
{
  const vm = buildEtfUiViewModel({
    code: '513310', sector: 'storage',
    decision: makeDecision({ gen1_model_candidate: false }),
    position: POSITION,
    signal: makeSignal({ calibrated_probability: null, ml_probability: null, signal_status: 'NO_OPPORTUNITY' }),
    runtime: makeRuntime()
  });
  assert.strictEqual(vm.gen1.status, SIGNAL_STATUS.NO_OPPORTUNITY);
  assert.strictEqual(vm.gen1.signal.signal_status, 'NO_OPPORTUNITY');
  assert.strictEqual(vm.gen1.signal.probability, null, 'NO_OPPORTUNITY 概率必须为 null，禁止伪造 0% 胜率');
  assert.strictEqual(vm.gen1.signal.model_candidate, false);
  console.log('[PASS] UI-G1-08 candidates=0 => NO_OPPORTUNITY 且概率为 null');
}

/* ---------- UI-G1-09：Review 生产来源永远为 V3.6.1 ---------- */
{
  const sr = buildSystemRuntime(makeRuntime());
  assert.strictEqual(sr.production.engine, 'v3.6.1', 'Review 生产来源引擎必须恒为 V3.6.1');

  const decision = makeDecision({
    suggested_position: 10,
    gen1_counterfactual_suggested_position: 35,
    gen1_counterfactual_delta: 25,
    gen1_model_probability: 0.71,
    gen1_model_candidate: true,
    gen1_canary_effective: true
  });
  const g = buildReviewGen1(decision);
  assert.strictEqual(g.baseline_suggested_pct, 10, 'baseline 必须来自生产 suggested_position');
  assert.strictEqual(g.counterfactual_suggested_pct, 35);
  assert.strictEqual(g.delta_pct, 25);
  assert.strictEqual(g.safety_permission, 'PERMIT');
  // gen1 块不得携带任何“最终建议”语义字段
  for (const k of Object.keys(g)) {
    assert.ok(!/final|action_code/.test(k), `Review gen1 块出现最终建议字段 ${k}`);
  }
  console.log('[PASS] UI-G1-09 Review 生产来源恒 V3.6.1，gen1 块独立于最终建议');
}

/* ---------- 静态守卫：两个 gateway 已接入新契约且保留兼容字段 ---------- */
{
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const api = strip(fs.readFileSync(path.join(REPO, 'cloudfunctions/apiGateway/index.js'), 'utf8'));
  const admin = strip(fs.readFileSync(path.join(REPO, 'cloudfunctions/adminGateway/index.js'), 'utf8'));

  assert.ok(/require\('\.\/common\/utils\/gen1-ui-view-model'\)/.test(api), 'apiGateway 必须引入契约模块');
  assert.ok(/system_runtime:\s*buildSystemRuntime\(runtime\)/.test(api), 'dashboard 必须下发 system_runtime');
  assert.ok(/production:\s*uiVm\.production/.test(api) && /gen1:\s*uiVm\.gen1/.test(api),
    'dashboard/detail 必须下发 production + gen1 分层');
  assert.ok(/ml_shadow/.test(api), 'ml_shadow 兼容字段必须保留一轮');
  assert.ok(/gen1:\s*buildReviewGen1\(d\)/.test(api), 'review 必须附独立 gen1 反事实块');

  assert.ok(/require\('\.\/common\/utils\/gen1-ui-view-model'\)/.test(admin), 'adminGateway 必须引入契约模块');
  assert.ok(/COLLECTIONS\.RUNTIME_STATUS/.test(admin), 'admin health 必须读 runtime_status');
  assert.ok(/COLLECTIONS\.GEN1_HEALTH_STATE/.test(admin), 'admin health 必须读 gen1_health_state');
  assert.ok(/COLLECTIONS\.DECISION_RESULT/.test(admin), 'admin health 必须读 decision_result');
  assert.ok(/buildCanaryLedger\(runtime\)/.test(admin), 'admin health 必须经 buildCanaryLedger 输出账本');
  // 账本字段名守卫钉在契约模块上（admin 只引用 builder）
  const vmSrc = strip(fs.readFileSync(path.join(REPO, 'src/common/utils/gen1-ui-view-model.js'), 'utf8'));
  assert.ok(/gen1_counterfactual_intended_tech_position/.test(vmSrc), '账本必须含 intended 字段');
  assert.ok(!/ledger_ok[^\n]*target_sum/.test(vmSrc), 'ledger_ok 不得用 target_sum 计算');
  console.log('[PASS] 静态守卫：gateway 接线与兼容字段符合 PR-UI-01');
}

/* ---------- UI-G1-10（review-fix P0）：stage 三拆，signal 不得冒充 effective ---------- */
{
  // 真实反例（513310 / 2026-09-10）：模型在 S0 评估并被 EOD 预检拦住，
  // 而 baseline / effective 都是 S1 —— 旧实现会让 signal.stage 显示成 S1，
  // 与紧邻的 Safety 文案「当前阶段 S0 不属于 S2/S3」自相矛盾。
  const vm = buildEtfUiViewModel({
    code: '513310', sector: 'storage',
    decision: makeDecision({
      v361_baseline_stage: 'S1',
      gen1_effective_stage: 'S1',
      ml_rule_permission: 'BLOCK',
      ml_rule_permission_reason_code: 'EOD_STAGE_NOT_ELIGIBLE',
      ml_rule_permission_reason: 'EOD 阶段预检：当前阶段 S0 不属于 S2/S3观察许可范围',
      ml_rule_permission_source: 'SAFETY_CORE'
    }),
    position: POSITION,
    signal: makeSignal({ stage: 'S0', rule_permission_source: 'EOD_STAGE_PRECHECK' }),
    runtime: makeRuntime()
  });
  assert.strictEqual(vm.gen1.stages.signal, 'S0', 'stages.signal 必须来自 ml_shadow_signal.stage');
  assert.strictEqual(vm.gen1.stages.baseline, 'S1', 'stages.baseline 必须来自 v361_baseline_stage');
  assert.strictEqual(vm.gen1.stages.effective, 'S1', 'stages.effective 必须来自 gen1_effective_stage');
  assert.strictEqual(vm.gen1.signal.stage, vm.gen1.stages.signal,
    '兼容字段 signal.stage 必须严格等于 stages.signal');
  assert.notStrictEqual(vm.gen1.signal.stage, vm.gen1.stages.effective,
    'signal.stage 绝不允许冒充 effective stage（本反例 signal=S0 / effective=S1）');
  assert.strictEqual(vm.gen1.safety.evaluated_stage, 'S0', 'Safety 实际评估阶段必须单独输出');
  assert.strictEqual(vm.gen1.safety.stage_source, 'EOD_STAGE_PRECHECK', 'Safety stage 来源必须可追溯');
  // 三 stage 缺数据时不得互相顶替
  const bare = buildEtfUiViewModel({
    code: '513310', sector: 'storage', decision: makeDecision(), position: POSITION,
    signal: null, runtime: makeRuntime()
  });
  assert.strictEqual(bare.gen1.stages.signal, null, '无信号行时 stages.signal 必须为 null，不得用其它 stage 顶替');
  console.log('[PASS] UI-G1-10 stage 三拆：signal / baseline / effective 不串位');
}

/* ---------- UI-G1-11（review-fix P1-1）：canary 权限链可归因 ---------- */
{
  // authority 未授权
  const a = buildSystemRuntime(makeRuntime({
    gen1_counterfactual_canary_authorized: false,
    gen1_counterfactual_canary_health_allowed: true,
    gen1_counterfactual_canary_active: false
  }));
  assert.strictEqual(a.gen1.counterfactual_authorized, false);
  assert.strictEqual(a.gen1.counterfactual_health_allowed, true);
  assert.strictEqual(a.gen1.counterfactual_inactive_reason, 'NOT_AUTHORIZED');
  // health gate 不允许
  const b = buildSystemRuntime(makeRuntime({
    gen1_counterfactual_canary_authorized: true,
    gen1_counterfactual_canary_health_allowed: false,
    gen1_counterfactual_canary_active: false
  }));
  assert.strictEqual(b.gen1.counterfactual_inactive_reason, 'HEALTH_NOT_ALLOWED');
  // 都允许但未激活 → 其它条件
  const c = buildSystemRuntime(makeRuntime({
    gen1_counterfactual_canary_authorized: true,
    gen1_counterfactual_canary_health_allowed: true,
    gen1_counterfactual_canary_active: false
  }));
  assert.strictEqual(c.gen1.counterfactual_inactive_reason, 'OTHER_CONDITIONS');
  // 已激活 → 无归因
  const d = buildSystemRuntime(makeRuntime({
    gen1_counterfactual_canary_authorized: true,
    gen1_counterfactual_canary_health_allowed: true,
    gen1_counterfactual_canary_active: true
  }));
  assert.strictEqual(d.gen1.counterfactual_inactive_reason, null);
  assert.strictEqual(d.gen1.counterfactual_active, true);
  // 缺字段 → 一律 false（不猜测、不从 legacy 兜底）
  const e = buildSystemRuntime({});
  assert.strictEqual(e.gen1.counterfactual_authorized, false);
  assert.strictEqual(e.gen1.counterfactual_health_allowed, false);
  assert.strictEqual(e.gen1.counterfactual_active, false);
  assert.strictEqual(e.gen1.counterfactual_inactive_reason, 'NOT_AUTHORIZED');
  console.log('[PASS] UI-G1-11 canary authorized / health_allowed / active 三真值可归因');
}

/* ---------- UI-G1-12（review-fix P1-2）：legacy 双真相隔离 ---------- */
{
  const notice = buildLegacyNotice();
  assert.strictEqual(notice.deprecated, true);
  assert.strictEqual(notice.do_not_use_for_authority, true);
  assert.deepStrictEqual(notice.fields.slice().sort(), LEGACY_DEPRECATED_FIELDS.slice().sort(),
    'legacy.fields 必须与契约常量逐项一致');
  for (const f of ['ml_shadow', 'ml_shadow.ui_phase', 'ml_shadow.production_permission',
    'ml_shadow.fast_path_enabled', 'advisory_enabled', 'fast_path_enabled']) {
    assert.ok(notice.fields.indexOf(f) >= 0, `legacy.fields 必须包含 ${f}`);
  }

  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const vmSrc = strip(fs.readFileSync(path.join(REPO, 'src/common/utils/gen1-ui-view-model.js'), 'utf8'));
  // 契约模块不得依赖 ml-shadow 构建器（legacy 语义的唯一来源）
  assert.ok(!/require\(.*ml-shadow/.test(vmSrc), '契约模块禁止引用 ml-shadow 模块');
  // authority 只认 runtime_status.gen1_authority
  assert.ok(/runtime\.gen1_authority|rt\.gen1_authority/.test(vmSrc), 'authority 必须取自 runtime_status');
  assert.ok(!/authority[\s\S]{0,80}(ui_phase|production_permission|advisory_enabled|fast_path_enabled)/.test(vmSrc),
    'authority 推导不得引用 legacy 字段');

  const api = strip(fs.readFileSync(path.join(REPO, 'cloudfunctions/apiGateway/index.js'), 'utf8'));
  const admin = strip(fs.readFileSync(path.join(REPO, 'cloudfunctions/adminGateway/index.js'), 'utf8'));
  assert.ok(/legacy:\s*buildLegacyNotice\(\)/.test(api), 'dashboard/detail 必须下发 legacy 禁用声明');
  assert.ok(/legacy:\s*buildLegacyNotice\(\)/.test(admin), 'admin health 必须下发 legacy 禁用声明');

  // production / gen1 块内不得出现 legacy 语义键（结构守卫：真实样例 + 契约输出）
  const vm = buildEtfUiViewModel({
    code: '513310', sector: 'storage', decision: makeDecision({ v361_baseline_stage: 'S1', gen1_effective_stage: 'S2' }),
    position: POSITION, signal: makeSignal(), runtime: makeRuntime()
  });
  const FORBIDDEN = /^(ml_shadow|advisory_enabled|fast_path_enabled|ui_phase|production_permission|advisory)$/;
  const walk = (obj, path) => {
    if (!obj || typeof obj !== 'object') return;
    for (const [k, v] of Object.entries(obj)) {
      assert.ok(!FORBIDDEN.test(k), `production/gen1 块出现 legacy 字段 ${path}.${k}`);
      walk(v, `${path}.${k}`);
    }
  };
  walk(vm.production, 'production');
  walk(vm.gen1, 'gen1');
  console.log('[PASS] UI-G1-12 legacy deprecated 声明 + production/gen1 无 legacy 语义字段');
}

/* ---------- UI-G1-13（review-fix）：Review 行分层，可直出「生产 | 反事实 | 实操」 ---------- */
{
  const d = makeDecision({
    suggested_position: 8.1,
    v361_baseline_stage: 'S1', gen1_effective_stage: 'S1',
    gen1_counterfactual_suggested_position: 12.3,
    gen1_counterfactual_delta: 4.2,
    gen1_model_probability: 0.71,
    gen1_model_candidate: true,
    gen1_canary_effective: true   // CANDIDATE 判定条件之一（candidate ∧ canary_effective）
  });
  const g = buildReviewGen1(d);
  assert.strictEqual(g.authority, 'CANARY');
  assert.strictEqual(g.status, 'CANDIDATE');
  assert.strictEqual(g.signal_status, g.status, 'signal_status 兼容别名必须严格等于 status');
  assert.strictEqual(g.counterfactual.suggested_pct, 12.3);
  assert.strictEqual(g.counterfactual.delta_pct, 4.2);
  assert.strictEqual(g.counterfactual_suggested_pct, g.counterfactual.suggested_pct, '平铺别名必须一致');
  assert.strictEqual(g.delta_pct, g.counterfactual.delta_pct);
  assert.strictEqual(g.baseline_suggested_pct, 8.1, 'baseline 必须来自生产 suggested_position');
  assert.strictEqual(g.stages.signal, null, 'Review 无信号联表，stages.signal 必须显式 null');
  assert.strictEqual(g.stages.baseline, 'S1');
  assert.strictEqual(g.stages.effective, 'S1');
  for (const k of Object.keys(g)) {
    assert.ok(!/final|action_code/.test(k), `Review gen1 块出现最终建议字段 ${k}`);
  }
  console.log('[PASS] UI-G1-13 Review 行 production/gen1 分层，gen1 不冒充最终建议');
}

/* ---------- 静态守卫：review 行下发 production 块（review-fix） ---------- */
{
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const api = strip(fs.readFileSync(path.join(REPO, 'cloudfunctions/apiGateway/index.js'), 'utf8'));
  assert.ok(/production:\s*\{[\s\S]{0,200}?action:\s*d\.final_action/.test(api),
    'review 行必须下发 production 块（action 来自 final_action）');
  assert.ok(/production:\s*\{[\s\S]{0,200}?suggested:\s*d\.suggested_position/.test(api),
    'review 行 production.suggested 必须来自 suggested_position');
  console.log('[PASS] 静态守卫：review 行 production 块来源正确');
}

console.log('\n全部 UI-G1-01..13 + 静态守卫 PASS');
