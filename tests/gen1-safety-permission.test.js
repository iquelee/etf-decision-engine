'use strict';

/**
 * G1-02 Safety Core Permission 单测。
 * 覆盖任务包要求的 6 组验收 + authority / stage / data / domain 边界。
 */
const assert = require('assert');
const { evaluateGen1Permission, SAFETY_SOURCE } = require('../src/common/utils/gen1-safety-permission');

const TODAY = '2026-09-10';
const baseParams = { ml_shadow_observe: true, ml_advisory_enabled: true, ml_fast_path_enabled: true, ml_challenger_model_id: 'HVT-A-ET-20260830' };
const goodSignal = { date: TODAY, model_id: 'HVT-A-ET-20260830', calibrated_probability: 0.82, rule_gate: 'PERMIT' };
const s2Baseline = { trend_stage_primary: 'S2', v361_baseline_target: 15 };
const dataOk = { status: 'OK' };
const domainIn = { status: 'IN_DOMAIN', permission: 'ALLOW' };

function run(over) {
  return evaluateGen1Permission(Object.assign({
    params: baseParams, signal: goodSignal, baseline: s2Baseline, today: TODAY,
    risk: { risk_override: false, risk_flag: 'NORMAL' }, fundamental: { f_state: 'F3' },
    snapshot: { structural_break: false, hard_break: false },
    dataHealth: dataOk, domainPermission: domainIn
  }, over || {}));
}

// 1) S2 + 高概率 + NORMAL → PERMIT（source 必须是 SAFETY_CORE）
{
  const r = run();
  assert.strictEqual(r.safety.permission, 'PERMIT');
  assert.strictEqual(r.safety.reason_code, 'SAFETY_CORE_PASS');
  assert.strictEqual(r.safety.source, SAFETY_SOURCE);
  assert.strictEqual(r.effective_advisory, true);
  assert.strictEqual(r.effective_canary, true);
}

// 2) S2 + 高概率 + RED → BLOCK
{
  const r = run({ risk: { risk_override: false, risk_flag: 'RED' } });
  assert.strictEqual(r.safety.permission, 'BLOCK');
  assert.strictEqual(r.safety.reason_code, 'HARD_RISK_OVERRIDE');
  assert.strictEqual(r.effective_advisory, false);
  assert.strictEqual(r.effective_canary, false);
}

// 2b) risk_override = true 同样 BLOCK
{
  const r = run({ risk: { risk_override: true, risk_flag: 'NORMAL' } });
  assert.strictEqual(r.safety.permission, 'BLOCK');
  assert.strictEqual(r.safety.reason_code, 'HARD_RISK_OVERRIDE');
}

// 3) S2 + 高概率 + F5 → BLOCK
{
  const r = run({ fundamental: { f_state: 'F5' } });
  assert.strictEqual(r.safety.permission, 'BLOCK');
  assert.strictEqual(r.safety.reason_code, 'FUNDAMENTAL_F5');
}

// 4) S2 + structural break → BLOCK
{
  const r = run({ snapshot: { structural_break: true, hard_break: false } });
  assert.strictEqual(r.safety.permission, 'BLOCK');
  assert.strictEqual(r.safety.reason_code, 'STRUCTURAL_BREAK');
}
{
  const r = run({ snapshot: { structural_break: false, hard_break: true } });
  assert.strictEqual(r.safety.permission, 'BLOCK');
  assert.strictEqual(r.safety.reason_code, 'STRUCTURAL_BREAK');
}

// 5) stale signal → unavailable（null），fail-closed
{
  const r = run({ signal: { date: '2026-09-09', model_id: 'HVT-A-ET-20260830', rule_gate: 'PERMIT' } });
  assert.strictEqual(r.safety.permission, null);
  assert.strictEqual(r.safety.reason_code, 'SIGNAL_STALE');
  assert.strictEqual(r.effective_advisory, false);
  assert.strictEqual(r.effective_canary, false);
}

// 6) wrong model_id → unavailable（null）
{
  const r = run({ signal: { date: TODAY, model_id: 'HVT-A-ET-99999999', rule_gate: 'PERMIT' } });
  assert.strictEqual(r.safety.permission, null);
  assert.strictEqual(r.safety.reason_code, 'MODEL_ID_MISMATCH');
}

// 7) 缺少信号 → unavailable
{
  const r = run({ signal: null });
  assert.strictEqual(r.safety.permission, null);
  assert.strictEqual(r.safety.reason_code, 'SIGNAL_OR_BASELINE_MISSING');
}

// 8) 基线阶段非 S2/S3 → BLOCK
{
  const r = run({ baseline: { trend_stage_primary: 'S5', v361_baseline_target: 75 } });
  assert.strictEqual(r.safety.permission, 'BLOCK');
  assert.strictEqual(r.safety.reason_code, 'BASELINE_STAGE_NOT_ELIGIBLE');
}

// 9) EOD precheck BLOCK 不得被 Safety 放行
{
  const r = run({ signal: { date: TODAY, model_id: 'HVT-A-ET-20260830', rule_gate: 'BLOCK', rule_permission_reason_code: 'EOD_STAGE_NOT_ELIGIBLE' } });
  assert.strictEqual(r.eod_precheck.permission, 'BLOCK');
  assert.strictEqual(r.safety.permission, 'BLOCK');
  assert.strictEqual(r.safety.reason_code, 'EOD_STAGE_NOT_ELIGIBLE');
}

// 10) authority OFF → BLOCK（即便其它全好）
{
  const r = run({ params: { ml_shadow_observe: false } });
  assert.strictEqual(r.safety.permission, 'BLOCK');
  assert.strictEqual(r.safety.reason_code, 'GEN1_AUTHORITY_NOT_ADVISORY');
}

// 11) data BLOCKED → advisory/canary 均 false（概率仍可诊断）
{
  const r = run({ dataHealth: { status: 'BLOCKED', reason_code: 'BENCHMARK_MISSING' } });
  assert.strictEqual(r.safety.permission, 'PERMIT', 'Safety 本身仍通过');
  assert.strictEqual(r.effective_advisory, false, '数据 BLOCKED 时 advisory 必须关闭');
  assert.strictEqual(r.effective_canary, false);
}

// 12) data DEGRADED → advisory 允许，canary 关闭
{
  const r = run({ dataHealth: { status: 'DEGRADED' } });
  assert.strictEqual(r.safety.permission, 'PERMIT');
  assert.strictEqual(r.effective_advisory, true);
  assert.strictEqual(r.effective_canary, false);
}

// 13) domain OUT_OF_DOMAIN → canary 关闭，advisory 保留
{
  const r = run({ domainPermission: { status: 'OUT_OF_DOMAIN', permission: 'BLOCK_CANARY' } });
  assert.strictEqual(r.safety.permission, 'PERMIT');
  assert.strictEqual(r.effective_advisory, true);
  assert.strictEqual(r.effective_canary, false, 'OOD 必须阻断 canary');
}

// 14) data/domain 未接入（UNKNOWN）→ canary fail-closed 关闭（PR1 独立可用）
{
  const r = run({ dataHealth: null, domainPermission: null });
  assert.strictEqual(r.safety.permission, 'PERMIT');
  assert.strictEqual(r.effective_advisory, true);
  assert.strictEqual(r.effective_canary, false);
}

console.log('gen1 safety permission tests passed');
