'use strict';

/** G1-07 Runtime Circuit Breaker（G1-11 Gate G1-F）单测。 */
const assert = require('assert');
const {
  HEALTH, computeHealthStatus, circuitGate, applyHealthWithRecovery, _resetBreakerState
} = require('../src/common/utils/gen1-circuit-breaker');

// 健康度计算
assert.strictEqual(computeHealthStatus({}), HEALTH.OK);
assert.strictEqual(computeHealthStatus({ incrementalAlpha: 0.02 }), HEALTH.OK);
assert.strictEqual(computeHealthStatus({ incrementalAlpha: -0.01 }), HEALTH.DEGRADED);
assert.strictEqual(computeHealthStatus({ dataHealth: 'BLOCKED' }), HEALTH.ML_OFF);
assert.strictEqual(computeHealthStatus({ dataHealth: 'DEGRADED' }), HEALTH.DEGRADED);
assert.strictEqual(computeHealthStatus({ signalQuality: 'WEAK' }), HEALTH.WARNING);
assert.strictEqual(computeHealthStatus({ signalQuality: 'BROKEN' }), HEALTH.ML_OFF);
assert.strictEqual(computeHealthStatus({ killSwitch: true }), HEALTH.ML_OFF);
assert.strictEqual(computeHealthStatus({ falseFastPathRate: 0.6 }), HEALTH.DEGRADED);
assert.strictEqual(computeHealthStatus({ falseFastPathRate: 0.4 }), HEALTH.WARNING);
assert.strictEqual(computeHealthStatus({ calibrationDrift: 0.6 }), HEALTH.DEGRADED);
assert.strictEqual(computeHealthStatus({ calibrationDrift: 0.4 }), HEALTH.WARNING);

// 运行时门
{
  const ok = circuitGate(HEALTH.OK);
  assert.strictEqual(ok.allow_advisory, true);
  assert.strictEqual(ok.allow_canary, true);
  assert.strictEqual(ok.allow_gen1_timing, true);
  assert.strictEqual(ok.immediate_fallback_v361, false);
  assert.strictEqual(ok.requires_manual_review_to_restore, false);

  const warn = circuitGate(HEALTH.WARNING);
  assert.strictEqual(warn.allow_advisory, true);
  assert.strictEqual(warn.allow_canary, true, 'WARNING 允许 canary 但显示警告');

  const deg = circuitGate(HEALTH.DEGRADED);
  assert.strictEqual(deg.allow_advisory, true, 'DEGRADED 仍允许概率观察');
  assert.strictEqual(deg.allow_canary, false, 'DEGRADED 禁止 Canary');

  const off = circuitGate(HEALTH.ML_OFF);
  assert.strictEqual(off.allow_advisory, false);
  assert.strictEqual(off.allow_gen1_timing, false);
  assert.strictEqual(off.immediate_fallback_v361, true, 'ML_OFF 立即回退纯 V3.6.1');
  assert.strictEqual(off.requires_manual_review_to_restore, true);
}

// 恢复须人工复核：禁止 auto reopen
{
  _resetBreakerState();
  assert.strictEqual(applyHealthWithRecovery(HEALTH.DEGRADED).accepted, true);
  const denied = applyHealthWithRecovery(HEALTH.OK, false);
  assert.strictEqual(denied.accepted, false, 'DEGRADED → OK 无人工确认必须拒绝');
  assert.strictEqual(denied.status, HEALTH.DEGRADED, '应维持原降级状态');
  assert.strictEqual(applyHealthWithRecovery(HEALTH.OK, true).accepted, true, '人工确认后可恢复');
  _resetBreakerState();

  // ML_OFF → OK 同理
  assert.strictEqual(applyHealthWithRecovery(HEALTH.ML_OFF).accepted, true);
  assert.strictEqual(applyHealthWithRecovery(HEALTH.WARNING).accepted, false);
  assert.strictEqual(applyHealthWithRecovery(HEALTH.WARNING, true).accepted, true);
  _resetBreakerState();
}

// ML_OFF 导致的 timing 关闭与 safety 组合：params 被降级 → Safety BLOCK
{
  const { evaluateGen1Permission } = require('../src/common/utils/gen1-safety-permission');
  const gate = circuitGate(HEALTH.ML_OFF);
  const p = evaluateGen1Permission({
    params: { ml_shadow_observe: false },   // 熔断后调用方降级
    signal: { date: '2026-09-10', model_id: 'HVT-A-ET-20260830', rule_gate: 'PERMIT' },
    baseline: { trend_stage_primary: 'S2' },
    today: '2026-09-10', healthGate: gate
  });
  assert.strictEqual(p.safety.permission, 'BLOCK');
  assert.strictEqual(p.gen1_health_status, HEALTH.ML_OFF);
  assert.strictEqual(p.effective_advisory, false);
  assert.strictEqual(p.effective_canary, false);
}

console.log('gen1 circuit breaker tests passed');
