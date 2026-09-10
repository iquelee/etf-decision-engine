'use strict';

/** G1-06 Domain Gate + G1-07 Circuit Breaker + G1-09 Execution Boundary 单测。 */
const assert = require('assert');
const { PERMISSION, evaluateDomainPermission } = require('../src/common/utils/gen1-domain-permission');
const { HEALTH, computeHealthStatus, circuitGate, applyHealthWithRecovery, _resetBreakerState } = require('../src/common/utils/gen1-circuit-breaker');
const { resolveExecution, guardExecutionLabel, AUDIT_CODE } = require('../src/common/utils/gen1-execution-boundary');
const { evaluateGen1Permission } = require('../src/common/utils/gen1-safety-permission');

/* ===== G1-06 Domain ===== */
// IN_DOMAIN → ALLOW
{
  const r = evaluateDomainPermission('biotech', '159570');
  assert.strictEqual(r.status, 'IN_DOMAIN');
  assert.strictEqual(r.permission, PERMISSION.ALLOW);
}
// PARTIAL → CANARY_LIMITED + warning
{
  for (const [cat, code] of [['storage', '513310'], ['ai_network', '515880'], ['semi_equip', '159582']]) {
    const r = evaluateDomainPermission(cat, code);
    assert.strictEqual(r.status, 'PARTIAL_COVERAGE');
    assert.strictEqual(r.permission, PERMISSION.CANARY_LIMITED);
    assert.strictEqual(r.warning, true);
  }
}
// OOD → BLOCK_CANARY
{
  const r = evaluateDomainPermission('gold', '518880');
  assert.strictEqual(r.status, 'OUT_OF_DOMAIN');
  assert.strictEqual(r.permission, PERMISSION.BLOCK_CANARY);
}

// 518880 核心验收：P=0.95 + S2 + Safety PASS → 仍 CANARY BLOCK（reason=OUT_OF_DOMAIN）
{
  const gold = evaluateDomainPermission('gold', '518880');
  const p = evaluateGen1Permission({
    params: { ml_shadow_observe: true, ml_advisory_enabled: true, ml_fast_path_enabled: true, gen1_authority: 'CANARY' },
    signal: { date: '2026-09-10', model_id: 'HVT-A-ET-20260830', calibrated_probability: 0.95, rule_gate: 'PERMIT' },
    baseline: { trend_stage_primary: 'S2', v361_baseline_target: 15 },
    risk: { risk_override: false, risk_flag: 'NORMAL' }, fundamental: { f_state: 'F3' },
    snapshot: { structural_break: false, hard_break: false },
    today: '2026-09-10',
    dataHealth: { status: 'OK' }, domainPermission: gold
  });
  assert.strictEqual(p.safety.permission, 'PERMIT', 'Safety 本身通过');
  assert.strictEqual(p.effective_advisory, true, '域外仍可人工参考');
  assert.strictEqual(p.effective_canary, false, '518880 OOD 必须禁止 Fast Path 改 Stage');
  assert.strictEqual(p.domain.reason_code, 'DOMAIN_OUT_OF_DOMAIN');
}

/* ===== G1-07 Circuit Breaker ===== */
{
  assert.strictEqual(computeHealthStatus({}), HEALTH.OK);
  assert.strictEqual(computeHealthStatus({ incrementalAlpha: -0.01 }), HEALTH.DEGRADED);
  assert.strictEqual(computeHealthStatus({ dataHealth: 'BLOCKED' }), HEALTH.ML_OFF);
  assert.strictEqual(computeHealthStatus({ dataHealth: 'DEGRADED' }), HEALTH.DEGRADED);
  assert.strictEqual(computeHealthStatus({ signalQuality: 'WEAK' }), HEALTH.WARNING);
  assert.strictEqual(computeHealthStatus({ signalQuality: 'BROKEN' }), HEALTH.ML_OFF);
  assert.strictEqual(computeHealthStatus({ killSwitch: true }), HEALTH.ML_OFF);
  assert.strictEqual(computeHealthStatus({ falseFastPathRate: 0.6 }), HEALTH.DEGRADED);
}
{
  const ok = circuitGate(HEALTH.OK);
  assert.strictEqual(ok.allow_advisory, true);
  assert.strictEqual(ok.allow_canary, true);
  assert.strictEqual(ok.immediate_fallback_v361, false);

  const deg = circuitGate(HEALTH.DEGRADED);
  assert.strictEqual(deg.allow_advisory, true, 'DEGRADED 仍允许概率观察');
  assert.strictEqual(deg.allow_canary, false, 'DEGRADED 禁止 Canary');

  const off = circuitGate(HEALTH.ML_OFF);
  assert.strictEqual(off.allow_gen1_timing, false);
  assert.strictEqual(off.immediate_fallback_v361, true, 'ML_OFF 立即回退纯 V3.6.1');
  assert.strictEqual(off.requires_manual_review_to_restore, true);
}
// 恢复须人工复核：DEGRADED → OK 无确认 → 拒绝
{
  _resetBreakerState();
  assert.strictEqual(applyHealthWithRecovery(HEALTH.DEGRADED).accepted, true);
  const denied = applyHealthWithRecovery(HEALTH.OK, false);
  assert.strictEqual(denied.accepted, false, '禁止 auto reopen');
  assert.strictEqual(denied.status, HEALTH.DEGRADED);
  const ok = applyHealthWithRecovery(HEALTH.OK, true);
  assert.strictEqual(ok.accepted, true, '人工确认后可恢复');
  _resetBreakerState();
}

/* ===== G1-09 Execution Boundary ===== */
{
  const r = resolveExecution({ ml_execution_enabled: false });
  assert.strictEqual(r.execution_enabled, false);
  assert.strictEqual(r.auto_execution, false);
  assert.strictEqual(r.audit, null);
}
// 数据库置 true → 仍 false + 审计记录
{
  const r = resolveExecution({ ml_execution_enabled: true });
  assert.strictEqual(r.execution_enabled, false, '即使 config=true 也必须 false');
  assert.strictEqual(r.auto_execution, false);
  assert.ok(r.audit && r.audit.code === AUDIT_CODE, '必须产生 CONFIG_IGNORED_SECURITY_BOUNDARY');
  assert.strictEqual(r.audit.effective_value, false);
}
// UI 文案守卫
{
  assert.strictEqual(guardExecutionLabel('Execution Enabled'), '自动交易：关闭');
  assert.strictEqual(guardExecutionLabel('自动交易：开启'), '自动交易：关闭');
  assert.strictEqual(guardExecutionLabel('自动交易：关闭'), '自动交易：关闭');
}

console.log('gen1 runtime gates tests passed');
