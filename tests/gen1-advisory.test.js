'use strict';

const assert = require('assert');
const { DEFAULT_PARAMS } = require('../src/common/constants');
const createV3 = require('../src/common/utils/decision-v3');
const { mergeShadowOutputs } = require('../src/common/utils/v3-shadow');
const { gen1RulePermission } = require('../src/common/utils/gen1-rule-permission');

assert.strictEqual(DEFAULT_PARAMS.ml_shadow_observe, true);
assert.strictEqual(DEFAULT_PARAMS.ml_advisory_enabled, true);
assert.strictEqual(DEFAULT_PARAMS.ml_fast_path_enabled, true);
assert.strictEqual(DEFAULT_PARAMS.ml_execution_enabled, false);

const v3 = createV3();
const baseline = v3.runDecision(
  { code: '513310', sector: 'semi_equip' },
  { calc_date: '2026-09-01', w_state: 'W3', d_state: 'D3', h_state: 'H3', v_state: 'V3', consolidation_score: 50, sideway_days: 10 },
  { current_position: 0, max_position: 30, target_max: 30 },
  { ...DEFAULT_PARAMS, v3_6_1_enabled: true },
  { portfolio: { tech_position: 0, gold_position: 0, cash_ratio: 100, cash_balance: 100000, total_asset: 100000, multi_etf: true }, fundamental: { f_state: 'F3', f_score: 15, detail: {} }, risk: { risk_flag: 'NORMAL', risk_override: false }, crowding: { c_state: 'C1' } }
);
assert.strictEqual(baseline.trend_stage_primary, 'S2');

const advisory = v3.runDecision(
  { code: '513310', sector: 'semi_equip' },
  { calc_date: '2026-09-01', w_state: 'W3', d_state: 'D3', h_state: 'H3', v_state: 'V3', consolidation_score: 50, sideway_days: 10 },
  { current_position: 0, max_position: 30, target_max: 30 },
  { ...DEFAULT_PARAMS, v3_6_1_enabled: true },
  { portfolio: { tech_position: 0, gold_position: 0, cash_ratio: 100, cash_balance: 100000, total_asset: 100000, multi_etf: true }, fundamental: { f_state: 'F3', f_score: 15, detail: {} }, risk: { risk_flag: 'NORMAL', risk_override: false }, crowding: { c_state: 'C1' }, advisoryStageOverride: 'S4' }
);
assert.strictEqual(advisory.trend_stage_primary, 'S4');
assert.strictEqual(advisory.trend_stage_state.stage, 'S2', 'advisory must not persist S4 as baseline state');

const merged = mergeShadowOutputs({ final_target: 1, final_action: 'HOLD' }, {
  ...advisory,
  v361_baseline_stage: 'S2',
  v361_baseline_target: baseline.final_target,
  v361_baseline_action: baseline.final_action,
  gen1_advisory_target: advisory.final_target,
  gen1_advisory_action: advisory.final_action,
  ml_advisory_effective: true
}, DEFAULT_PARAMS, true);
assert.strictEqual(merged.shadow_targets.v361_baseline_stage, 'S2');
assert.strictEqual(merged.shadow_targets.gen1_advisory_effective, true);

const permissionInput = {
  ml_shadow_observe: true, ml_advisory_enabled: true, ml_fast_path_enabled: true,
  ml_challenger_model_id: 'HVT-A-ET-20260830'
};
const signal = { date: '2026-09-01', model_id: 'HVT-A-ET-20260830', rule_gate: 'PERMIT', fast_path_would_trigger: true };
const permission = gen1RulePermission(
  permissionInput, signal, { trend_stage_primary: 'S2' },
  { risk_flag: 'NORMAL' }, { f_state: 'F3' }, {}, '2026-09-01'
);
assert.strictEqual(permission.permission, 'PERMIT');
assert.strictEqual(permission.source, 'SAFETY_CORE');
const riskBlocked = gen1RulePermission(
  permissionInput, signal, { trend_stage_primary: 'S2' },
  { risk_flag: 'RED', risk_override: true }, { f_state: 'F3' }, {}, '2026-09-01'
);
assert.deepStrictEqual(
  { permission: riskBlocked.permission, code: riskBlocked.reason_code },
  { permission: 'BLOCK', code: 'HARD_RISK_OVERRIDE' }
);

console.log('gen1-advisory tests passed');
