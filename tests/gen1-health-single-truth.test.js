'use strict';

/**
 * WP-G1.2 G1.2-01：Health 单一真相（复审 P0）。
 *
 * 复审问题：runDecisionEngine 每只 ETF 曾用 `ml_shadow_signal.gen1_health_status`
 * 重新推导权限 → 昨天的信号快照（OK）可以盖过今天持久化 latch（ML_OFF），
 * 形成「运行时说 ML_OFF，某只却 allow_canary=true」的双重真相。
 *
 * 本测试锁定：**权限只由 healthStateToGate() 产出**，
 * signal 侧 health 仅作为 `signal_health_snapshot` 审计字段，不得影响 effective_*。
 */
const assert = require('assert');
const { healthStateToGate, computeLatchedState, defaultHealthState } = require('../src/common/utils/gen1-health-state');
const { HEALTH } = require('../src/common/utils/gen1-circuit-breaker');
const { evaluateGen1Permission } = require('../src/common/utils/gen1-safety-permission');

const TODAY = '2026-09-10';
const baseParams = {
  ml_shadow_observe: true, ml_advisory_enabled: true, ml_fast_path_enabled: true,
  ml_challenger_model_id: 'HVT-A-ET-20260830', gen1_authority: 'CANARY'
};
// 注意：signal 内 health 快照被刻意设为 OK，用来验证它**没有**权限
const goodSignal = {
  date: TODAY, model_id: 'HVT-A-ET-20260830', ml_fast: true,
  calibrated_probability: 0.82, rule_gate: 'PERMIT', stage: 'S2',
  gen1_health_status: 'OK'
};

function run(healthGate, over) {
  return evaluateGen1Permission(Object.assign({
    params: baseParams, signal: goodSignal,
    baseline: { trend_stage_primary: 'S2', v361_baseline_target: 15 },
    today: TODAY, thresholdSignalP: 0.65,
    risk: { risk_override: false, risk_flag: 'NORMAL' }, fundamental: { f_state: 'F3' },
    snapshot: { structural_break: false, hard_break: false },
    dataHealth: { status: 'OK' }, domainPermission: { status: 'IN_DOMAIN', permission: 'ALLOW' },
    healthGate,
    signalHealthSnapshot: goodSignal.gen1_health_status
  }, over || {}));
}

/* ---- 1) latch = OK → 对照组：advisory/canary 均 true ---- */
{
  const gate = healthStateToGate(computeLatchedState(defaultHealthState(), HEALTH.OK, { now: 'T1' }).state);
  assert.strictEqual(gate.gate_status, 'ACTIVE');
  assert.strictEqual(gate.source, 'GEN1_HEALTH_STATE_LATCH');
  const r = run(gate);
  assert.strictEqual(r.model.model_candidate, true);
  assert.strictEqual(r.effective_advisory, true);
  assert.strictEqual(r.effective_canary, true);
  assert.strictEqual(r.health.source, 'GEN1_HEALTH_STATE_LATCH');
  assert.strictEqual(r.gen1_health_status, HEALTH.OK);
}

/* ---- 2) ★ 核心：latch = ML_OFF，但 signal 快照 = OK → 权限必须被 latch 否决 ---- */
{
  const gate = healthStateToGate(computeLatchedState(defaultHealthState(), HEALTH.ML_OFF, { now: 'T2' }).state);
  assert.strictEqual(gate.latched_health, HEALTH.ML_OFF);
  const r = run(gate);
  assert.strictEqual(r.signal_health_snapshot, 'OK', '快照被如实保留（审计用）');
  assert.strictEqual(r.effective_advisory, false, 'ML_OFF latch 必须否决 advisory');
  assert.strictEqual(r.effective_canary, false, 'ML_OFF latch 必须否决 canary');
  assert.strictEqual(r.gen1_health_status, HEALTH.ML_OFF, '对外 health 必须是 latch 值');
}

/* ---- 3) latch = DEGRADED → advisory 保留，canary 关闭 ---- */
{
  const gate = healthStateToGate(computeLatchedState(defaultHealthState(), HEALTH.DEGRADED, { now: 'T3' }).state);
  const r = run(gate);
  assert.strictEqual(r.effective_advisory, true);
  assert.strictEqual(r.effective_canary, false, 'DEGRADED 禁止灰度');
}

/* ---- 4) 未初始化（PENDING）→ advisory 可继续，canary 一律关闭 ---- */
{
  const gate = healthStateToGate(Object.assign(defaultHealthState(), { read_status: 'NOT_INITIALIZED' }));
  assert.strictEqual(gate.gate_status, 'PENDING');
  assert.strictEqual(gate.allow_canary, false);
  const r = run(gate);
  assert.strictEqual(r.effective_advisory, true, 'PENDING 不阻断 ADVISORY');
  assert.strictEqual(r.effective_canary, false, 'PENDING 必须关闭 CANARY');
  assert.strictEqual(r.health.gate_status, 'PENDING');
}

/* ---- 5) 读取异常（READ_ERROR）→ 等同 ML_OFF，全链 fail-closed ---- */
{
  const gate = healthStateToGate(Object.assign(defaultHealthState(), {
    read_status: 'READ_ERROR', read_reason_code: 'HEALTH_STATE_READ_ERROR'
  }));
  assert.strictEqual(gate.gate_status, 'READ_ERROR');
  assert.strictEqual(gate.allow_advisory, false);
  assert.strictEqual(gate.allow_canary, false);
  assert.strictEqual(gate.allow_gen1_timing, false);
  assert.strictEqual(gate.immediate_fallback_v361, true);
  assert.strictEqual(gate.manual_review_required, true);
  const r = run(gate);
  assert.strictEqual(r.effective_advisory, false);
  assert.strictEqual(r.effective_canary, false);
  assert.strictEqual(r.health.read_reason_code, 'HEALTH_STATE_READ_ERROR');
}

/* ---- 6) overlay：health 字段落库且 source 固定 ---- */
{
  const { applyGen1Overlay } = require('../src/common/utils/gen1-overlay');
  const gate = healthStateToGate(computeLatchedState(defaultHealthState(), HEALTH.WARNING, { now: 'T4' }).state);
  const perm = run(gate);
  const out = applyGen1Overlay({ final_target: 15, final_action: '持有' }, perm, {});
  assert.strictEqual(out.final_target, 15, 'No-op 不变量');
  assert.strictEqual(out.gen1_health_source, 'GEN1_HEALTH_STATE_LATCH');
  assert.strictEqual(out.gen1_health_status, HEALTH.WARNING);
  assert.strictEqual(out.gen1_health_gate_status, 'ACTIVE');
  assert.strictEqual(out.gen1_signal_health_snapshot, 'OK', '快照单列落库');
}

console.log('gen1 health single-truth tests passed');
