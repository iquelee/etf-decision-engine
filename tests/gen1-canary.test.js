'use strict';

/**
 * G1-03 Gen-1 Canary 反事实链单测。
 * 关键验收：baseline S2 15% + Safety PERMIT → canary S4 25%，而 production 仍 15%。
 */
const assert = require('assert');
const { buildCanaryCounterfactual, assertProductionUntouched } = require('../src/common/utils/gen1-canary');
const { evaluateGen1Permission } = require('../src/common/utils/gen1-safety-permission');

const TO = '2026-09-10';
const params = { ml_shadow_observe: true, ml_advisory_enabled: true, ml_fast_path_enabled: true, gen1_authority: 'CANARY' };
const baseline = { stage: 'S2', target: 15, action: 'WAIT' };
const signal = { date: TO, model_id: 'HVT-A-ET-20260830', calibrated_probability: 0.82, rule_gate: 'PERMIT' };

function perm(over) {
  return evaluateGen1Permission(Object.assign({
    params, signal, baseline: { trend_stage_primary: 'S2', v361_baseline_target: 15 }, today: TO,
    risk: { risk_override: false, risk_flag: 'NORMAL' }, fundamental: { f_state: 'F3' },
    snapshot: { structural_break: false, hard_break: false },
    dataHealth: { status: 'OK' }, domainPermission: { status: 'IN_DOMAIN', permission: 'ALLOW' }
  }, over || {}));
}

// 1) 核心验收：PERMIT → canary S4（重跑后 25%），production 保持 15%
{
  const p = perm();
  const r = buildCanaryCounterfactual({
    permission: p, baseline,
    recomputeCanaryTarget: (stage) => ({ target: stage === 'S4' ? 25 : 15, action: 'BUILD' })
  });
  assert.strictEqual(r.v361_baseline_stage, 'S2');
  assert.strictEqual(r.v361_baseline_target, 15);
  assert.strictEqual(r.gen1_effective_stage, 'S4');
  assert.strictEqual(r.gen1_canary_target, 25);
  assert.strictEqual(r.gen1_canary_action, 'BUILD');
  assert.strictEqual(r.gen1_canary_delta, 10);
  assert.strictEqual(r.gen1_canary_effective, true);
  // 生产必须不动
  assert.strictEqual(r.final_target, 15, 'production final_target must stay V3.6.1 baseline');
  assert.strictEqual(r.final_action, 'WAIT');
  assert.strictEqual(r.production_target_pct, 15);
}

// 2) Safety BLOCK → canary 不生效，target 回落到 baseline
{
  const p = perm({ risk: { risk_override: true, risk_flag: 'RED' } });
  const r = buildCanaryCounterfactual({ permission: p, baseline, recomputeCanaryTarget: () => ({ target: 99 }) });
  assert.strictEqual(r.gen1_canary_effective, false);
  assert.strictEqual(r.gen1_canary_target, 15);
  assert.strictEqual(r.gen1_effective_stage, 'S2');
  assert.strictEqual(r.final_target, 15);
}

// 3) authority = ADVISORY（< CANARY）→ 即使 Safety PERMIT 也不得 canary
{
  const p = perm({ params: { ml_shadow_observe: true, ml_advisory_enabled: true, ml_fast_path_enabled: true, gen1_authority: 'ADVISORY' } });
  const r = buildCanaryCounterfactual({ permission: p, baseline, recomputeCanaryTarget: () => ({ target: 25 }) });
  assert.strictEqual(r.gen1_canary_effective, false, 'ADVISORY 不得生成 canary target');
  assert.strictEqual(r.gen1_canary_target, 15);
}

// 4) 冗余 clamp：canary 不得超过单只上限
{
  const p = perm();
  const r = buildCanaryCounterfactual({
    permission: p, baseline, maxSingleWeight: 25,
    recomputeCanaryTarget: () => ({ target: 40 })
  });
  assert.strictEqual(r.gen1_canary_target, 25, 'canary 必须被单只上限 clamp');
}

// 5) domain OOD → canary 关闭
{
  const p = perm({ domainPermission: { status: 'OUT_OF_DOMAIN', permission: 'BLOCK_CANARY' } });
  const r = buildCanaryCounterfactual({ permission: p, baseline, recomputeCanaryTarget: () => ({ target: 25 }) });
  assert.strictEqual(r.gen1_canary_effective, false);
  assert.strictEqual(r.gen1_canary_target, 15);
}

// 6) 无 recompute 回调时，canary 生效但 target 回落 baseline（保守）
{
  const p = perm();
  const r = buildCanaryCounterfactual({ permission: p, baseline });
  assert.strictEqual(r.gen1_canary_effective, true);
  assert.strictEqual(r.gen1_effective_stage, 'S4');
  assert.strictEqual(r.gen1_canary_target, 15);
}

// 7) assertProductionUntouched 工具
{
  const ok = assertProductionUntouched({ final_target: 15, final_action: 'WAIT' }, { final_target: 15, final_action: 'WAIT' });
  assert.strictEqual(ok.ok, true);
  const bad = assertProductionUntouched({ final_target: 15, final_action: 'WAIT' }, { final_target: 25, final_action: 'BUILD' });
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.diffs.length, 2);
}

console.log('gen1 canary tests passed');
