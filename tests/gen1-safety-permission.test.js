'use strict';

/**
 * G1-02 Safety Core Permission + G1.1-01 Model Candidate Gate 单测。
 * 覆盖：任务包 6 组验收 + WP-G1.1 复审要求的 5 组 Model Candidate 负向测试。
 */
const assert = require('assert');
const { evaluateGen1Permission, SAFETY_SOURCE, MODEL_STAGES } = require('../src/common/utils/gen1-safety-permission');

const TODAY = '2026-09-10';
const TH = 0.65;
const baseParams = {
  ml_shadow_observe: true, ml_advisory_enabled: true, ml_fast_path_enabled: true,
  ml_challenger_model_id: 'HVT-A-ET-20260830', gen1_authority: 'CANARY'
};
const goodSignal = {
  date: TODAY, model_id: 'HVT-A-ET-20260830', ml_fast: true,
  calibrated_probability: 0.82, rule_gate: 'PERMIT', stage: 'S2'
};
const s2Baseline = { trend_stage_primary: 'S2', v361_baseline_target: 15 };
const dataOk = { status: 'OK' };
const domainIn = { status: 'IN_DOMAIN', permission: 'ALLOW' };

function run(over) {
  return evaluateGen1Permission(Object.assign({
    params: baseParams, signal: goodSignal, baseline: s2Baseline, today: TODAY, thresholdSignalP: TH,
    risk: { risk_override: false, risk_flag: 'NORMAL' }, fundamental: { f_state: 'F3' },
    snapshot: { structural_break: false, hard_break: false },
    dataHealth: dataOk, domainPermission: domainIn
  }, over || {}));
}

/* ===== Model Candidate Gate（G1.1-01，P0）===== */

// MC-1: S2 + P=0.20 + Safety PERMIT → advisory=false / canary=false
{
  const r = run({ signal: { date: TODAY, model_id: 'HVT-A-ET-20260830', ml_fast: false, calibrated_probability: 0.20, rule_gate: 'PERMIT', stage: 'S2' } });
  assert.strictEqual(r.safety.permission, 'PERMIT', 'Safety 本身通过');
  assert.strictEqual(r.model.model_candidate, false);
  assert.strictEqual(r.model.checks.probability_ge_threshold, false);
  assert.strictEqual(r.effective_advisory, false, 'P=0.20 不得 advisory');
  assert.strictEqual(r.effective_canary, false, 'P=0.20 绝不得 canary');
}

// MC-2: S2 + P=0.64（ml_fast=true）→ false
{
  const r = run({ signal: { date: TODAY, model_id: 'HVT-A-ET-20260830', ml_fast: false, calibrated_probability: 0.64, rule_gate: 'PERMIT', stage: 'S2' } });
  assert.strictEqual(r.effective_advisory, false);
  assert.strictEqual(r.effective_canary, false);
}

// MC-3: S2 + P=0.65 → true
{
  const r = run({ signal: { date: TODAY, model_id: 'HVT-A-ET-20260830', ml_fast: true, calibrated_probability: 0.65, rule_gate: 'PERMIT', stage: 'S2' } });
  assert.strictEqual(r.model.model_candidate, true);
  assert.strictEqual(r.effective_advisory, true);
  assert.strictEqual(r.effective_canary, true);
}

// MC-4: S3 + 无模型概率 → false（v1 严格 S2 only）
{
  const r = run({
    signal: { date: TODAY, model_id: 'HVT-A-ET-20260830', ml_fast: false, calibrated_probability: null, rule_gate: 'PERMIT', stage: 'S3' },
    baseline: { trend_stage_primary: 'S3', v361_baseline_target: 20 }
  });
  assert.strictEqual(r.model.checks.stage_s2_only, false);
  assert.strictEqual(r.model.model_candidate, false);
  assert.strictEqual(r.effective_advisory, false);
  assert.strictEqual(r.effective_canary, false);
}

// MC-5: ml_fast=false + P=0.90 → 信号自相矛盾 → fail-closed BLOCK
{
  const r = run({ signal: { date: TODAY, model_id: 'HVT-A-ET-20260830', ml_fast: false, calibrated_probability: 0.90, rule_gate: 'PERMIT', stage: 'S2' } });
  assert.strictEqual(r.safety.permission, 'BLOCK');
  assert.strictEqual(r.safety.reason_code, 'MODEL_SIGNAL_INCONSISTENT');
  assert.strictEqual(r.effective_advisory, false);
  assert.strictEqual(r.effective_canary, false);
}

// MC-6: MODEL_STAGES 严格为 ['S2']
assert.deepStrictEqual(MODEL_STAGES, ['S2']);

/* ===== 任务包 6 组验收 ===== */

// 1) S2 + 高概率 + NORMAL → PERMIT（source=SAFETY_CORE）
{
  const r = run();
  assert.strictEqual(r.safety.permission, 'PERMIT');
  assert.strictEqual(r.safety.reason_code, 'SAFETY_CORE_PASS');
  assert.strictEqual(r.safety.source, SAFETY_SOURCE);
  assert.strictEqual(r.effective_advisory, true);
  assert.strictEqual(r.effective_canary, true);
}

// 2) RED → BLOCK
{
  const r = run({ risk: { risk_override: false, risk_flag: 'RED' } });
  assert.strictEqual(r.safety.permission, 'BLOCK');
  assert.strictEqual(r.safety.reason_code, 'HARD_RISK_OVERRIDE');
  assert.strictEqual(r.effective_advisory, false);
  assert.strictEqual(r.effective_canary, false);
}
{
  const r = run({ risk: { risk_override: true, risk_flag: 'NORMAL' } });
  assert.strictEqual(r.safety.reason_code, 'HARD_RISK_OVERRIDE');
}

// 3) F5 → BLOCK
{
  const r = run({ fundamental: { f_state: 'F5' } });
  assert.strictEqual(r.safety.permission, 'BLOCK');
  assert.strictEqual(r.safety.reason_code, 'FUNDAMENTAL_F5');
}

// 4) structural break → BLOCK
{
  const r = run({ snapshot: { structural_break: true, hard_break: false } });
  assert.strictEqual(r.safety.reason_code, 'STRUCTURAL_BREAK');
}
{
  const r = run({ snapshot: { structural_break: false, hard_break: true } });
  assert.strictEqual(r.safety.reason_code, 'STRUCTURAL_BREAK');
}

// 5) stale signal → unavailable（null）
{
  const r = run({ signal: { date: '2026-09-09', model_id: 'HVT-A-ET-20260830', ml_fast: true, calibrated_probability: 0.9, rule_gate: 'PERMIT', stage: 'S2' } });
  assert.strictEqual(r.safety.permission, null);
  assert.strictEqual(r.safety.reason_code, 'SIGNAL_STALE');
  assert.strictEqual(r.effective_advisory, false);
  assert.strictEqual(r.effective_canary, false);
}

// 6) wrong model_id → unavailable（null）
{
  const r = run({ signal: { date: TODAY, model_id: 'HVT-A-ET-99999999', ml_fast: true, calibrated_probability: 0.9, rule_gate: 'PERMIT', stage: 'S2' } });
  assert.strictEqual(r.safety.permission, null);
  assert.strictEqual(r.safety.reason_code, 'MODEL_ID_MISMATCH');
}

/* ===== 其它边界 ===== */
{
  const r = run({ signal: null });
  assert.strictEqual(r.safety.reason_code, 'SIGNAL_OR_BASELINE_MISSING');
}
{
  const r = run({ baseline: { trend_stage_primary: 'S5', v361_baseline_target: 75 } });
  assert.strictEqual(r.safety.reason_code, 'BASELINE_STAGE_NOT_ELIGIBLE');
}
{
  const r = run({ signal: { date: TODAY, model_id: 'HVT-A-ET-20260830', ml_fast: true, calibrated_probability: 0.9, rule_gate: 'BLOCK', rule_permission_reason_code: 'EOD_STAGE_NOT_ELIGIBLE', stage: 'S2' } });
  assert.strictEqual(r.eod_precheck.permission, 'BLOCK');
  assert.strictEqual(r.safety.reason_code, 'EOD_STAGE_NOT_ELIGIBLE');
}
{
  const r = run({ params: { ml_shadow_observe: false } });
  assert.strictEqual(r.safety.reason_code, 'GEN1_AUTHORITY_NOT_ADVISORY');
}
// 数据 BLOCKED → advisory/canary 均 false（概率仍诊断）
{
  const r = run({ dataHealth: { status: 'BLOCKED', reason_code: 'BENCHMARK_MISSING' } });
  assert.strictEqual(r.safety.permission, 'PERMIT');
  assert.strictEqual(r.effective_advisory, false);
  assert.strictEqual(r.effective_canary, false);
}
// 数据 DEGRADED → advisory 允许，canary 关闭
{
  const r = run({ dataHealth: { status: 'DEGRADED' } });
  assert.strictEqual(r.effective_advisory, true);
  assert.strictEqual(r.effective_canary, false);
}
// 域 OOD → canary 关闭，advisory 保留
{
  const r = run({ domainPermission: { status: 'OUT_OF_DOMAIN', permission: 'BLOCK_CANARY' } });
  assert.strictEqual(r.effective_advisory, true);
  assert.strictEqual(r.effective_canary, false);
}
// 未接入 data/domain → canary fail-closed
{
  const r = run({ dataHealth: null, domainPermission: null });
  assert.strictEqual(r.effective_advisory, true);
  assert.strictEqual(r.effective_canary, false);
}
// 词表归一化
{
  assert.strictEqual(run({ dataHealth: { status: 'DATA_OK' } }).effective_canary, true);
  assert.strictEqual(run({ dataHealth: { status: 'DATA_DEGRADED' } }).effective_canary, false);
  assert.strictEqual(run({ dataHealth: { status: 'DATA_BLOCKED' } }).effective_advisory, false);
}
// authority < CANARY → canary 恒 false
{
  const r = run({ params: Object.assign({}, baseParams, { gen1_authority: 'ADVISORY' }) });
  assert.strictEqual(r.model.model_candidate, true);
  assert.strictEqual(r.effective_advisory, true);
  assert.strictEqual(r.effective_canary, false, 'ADVISORY 权限不得 canary');
}
// PRODUCTION 被降级 → 不得 canary
{
  const r = run({ params: Object.assign({}, baseParams, { gen1_authority: 'PRODUCTION' }) });
  assert.strictEqual(r.effective_canary, false);
}
// 自定义阈值生效
{
  const r = run({ thresholdSignalP: 0.90, signal: { date: TODAY, model_id: 'HVT-A-ET-20260830', ml_fast: true, calibrated_probability: 0.85, rule_gate: 'PERMIT', stage: 'S2' } });
  assert.strictEqual(r.model.threshold_signal_p, 0.90);
  assert.strictEqual(r.model.model_candidate, false, 'P=0.85 < 阈值 0.90 → 非候选');
}

console.log('gen1 safety permission tests passed');
