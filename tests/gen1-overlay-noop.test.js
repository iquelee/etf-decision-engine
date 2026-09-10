'use strict';

/**
 * G1-11 Gate G1-H：Production No-op 单测。
 *
 * ADVISORY（默认）与 CANARY 状态下，Gen-1 overlay 都**不得**改变
 * final_target / final_action —— 即本轮新增的 Gen-1 代码不改变生产结果。
 */
const assert = require('assert');
const { applyGen1Overlay, verifyProductionNoop } = require('../src/common/utils/gen1-overlay');
const { evaluateGen1Permission } = require('../src/common/utils/gen1-safety-permission');
const { buildCanaryCounterfactual } = require('../src/common/utils/gen1-canary');

const TO = '2026-09-10';
const baseParams = { ml_shadow_observe: true, ml_advisory_enabled: true, ml_fast_path_enabled: true };
const signal = { date: TO, model_id: 'HVT-A-ET-20260830', calibrated_probability: 0.82, rule_gate: 'PERMIT' };
const decision = { code: '513310', final_target: 15, final_action: 'WAIT', decision_date: TO, suggested_position: 15 };

function perm(over) {
  return evaluateGen1Permission(Object.assign({
    params: baseParams, signal, baseline: { trend_stage_primary: 'S2', v361_baseline_target: 15 }, today: TO,
    risk: { risk_override: false, risk_flag: 'NORMAL' }, fundamental: { f_state: 'F3' },
    snapshot: { structural_break: false, hard_break: false },
    dataHealth: { status: 'OK' }, domainPermission: { status: 'IN_DOMAIN', permission: 'ALLOW' }
  }, over || {}));
}

// 1) ADVISORY + PERMIT：final_target/final_action 完全不变
{
  const p = perm();
  const canary = buildCanaryCounterfactual({ permission: p, baseline: { stage: 'S2', target: 15, action: 'WAIT' } });
  const out = applyGen1Overlay(decision, p, canary);
  assert.strictEqual(out.final_target, 15, 'ADVISORY overlay 不得改 final_target');
  assert.strictEqual(out.final_action, 'WAIT');
  assert.strictEqual(verifyProductionNoop(decision, out).ok, true);
  // 但 Gen-1 字段已写入
  assert.strictEqual(out.ml_rule_permission, 'PERMIT');
  assert.strictEqual(out.ml_rule_permission_source, 'SAFETY_CORE');
  assert.strictEqual(out.eod_precheck_permission, 'PERMIT');
  assert.strictEqual(out.gen1_authority, 'ADVISORY');
  assert.strictEqual(out.gen1_canary_effective, false, 'ADVISORY 不产生 canary');
}

// 2) CANARY 且 canary target=25：final_target 仍必须为 15（canary 只落 gen1_canary_target）
{
  const p = perm({ params: Object.assign({}, baseParams, { gen1_authority: 'CANARY' }) });
  const canary = buildCanaryCounterfactual({
    permission: p, baseline: { stage: 'S2', target: 15, action: 'WAIT' },
    recomputeCanaryTarget: () => ({ target: 25, action: 'BUILD' })
  });
  const out = applyGen1Overlay(decision, p, canary);
  assert.strictEqual(out.gen1_canary_target, 25);
  assert.strictEqual(out.gen1_canary_effective, true);
  assert.strictEqual(out.final_target, 15, 'canary 绝不能泄漏进 final_target');
  assert.strictEqual(out.final_action, 'WAIT');
  assert.strictEqual(verifyProductionNoop(decision, out).ok, true);
}

// 3) 恶意输入：即便 canary 对象被污染 final_target=99，overlay 仍不得改写
{
  const p = perm({ params: Object.assign({}, baseParams, { gen1_authority: 'CANARY' }) });
  const poisoned = { gen1_canary_target: 40, final_target: 99, final_action: 'EXIT', gen1_canary_effective: true };
  const out = applyGen1Overlay(decision, p, poisoned);
  assert.strictEqual(out.final_target, 15, '被污染的 canary 不得改写 final_target');
  assert.strictEqual(out.final_action, 'WAIT');
  assert.strictEqual(verifyProductionNoop(decision, out).ok, true);
}

// 4) verifyProductionNoop 能检出差异
{
  const bad = Object.assign({}, decision, { final_target: 25 });
  const r = verifyProductionNoop(decision, bad);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.diffs.length, 1);
}

// 5) overlay 不原地修改输入
{
  const p = perm();
  const before = JSON.stringify(decision);
  applyGen1Overlay(decision, p, {});
  assert.strictEqual(JSON.stringify(decision), before, 'overlay 必须是纯函数（不改输入）');
}

console.log('gen1 overlay no-op tests passed');
