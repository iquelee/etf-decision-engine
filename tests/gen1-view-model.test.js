'use strict';

const assert = require('assert');
const { buildGen1ViewModel, STATUS } = require('../src/common/utils/gen1-view-model');

const baseDecision = { final_action: 'HOLD', final_target: 0, suggested_position: 8.8, risk_flag: 'NORMAL' };
const basePosition = { current_position: 8.8 };

// 目标仓为 0 但持有时，用户主界面必须表达“维持当前”，不能误导为立即清仓。
const observed = buildGen1ViewModel({
  ml: { enabled: true, has_signal_row: true, is_stale: false, signal_status: 'OBSERVED', probability: 0.42, permission: 'PERMIT' },
  decision: baseDecision,
  position: basePosition
});
assert.strictEqual(observed.status.code, STATUS.OBSERVED);
assert.strictEqual(observed.advisory.target_pct, null);
assert.strictEqual(observed.advisory.target_label, '维持当前 8.8%');
assert.strictEqual(observed.advisory.delta_pct, 0);
assert.strictEqual(observed.signal.probability, 0.42);

const active = buildGen1ViewModel({
  ml: { enabled: true, has_signal_row: true, is_stale: false, signal_status: 'CANDIDATE', advisory_effective: true, model_candidate: true, calibrated_probability: 0.78, permission: 'PERMIT' },
  decision: { ...baseDecision, final_action: 'ADD', gen1_advisory_target: 25, suggested_position: 15 },
  position: basePosition
});
assert.strictEqual(active.status.code, STATUS.FAST_PATH_ACTIVE);
assert.strictEqual(active.advisory.target_pct, 25);
assert.strictEqual(active.signal.fast_path, '已触发');

// G1.1-01：advisory_effective=true 但 model_candidate=false（低概率 S2）绝不得表述为「已触发」
const ruleOnly = buildGen1ViewModel({
  ml: { enabled: true, has_signal_row: true, is_stale: false, signal_status: 'OBSERVED', advisory_effective: true, model_candidate: false, probability: 0.12, permission: 'PERMIT' },
  decision: baseDecision,
  position: basePosition
});
assert.strictEqual(ruleOnly.status.code, STATUS.OBSERVED, 'advisory_effective 但模型未触发 → 必须 OBSERVED');
assert.notStrictEqual(ruleOnly.status.code, STATUS.FAST_PATH_ACTIVE);
assert.strictEqual(ruleOnly.status.label, '观察中 · 模型未触发');
assert.strictEqual(ruleOnly.signal.fast_path, '未触发');
assert.strictEqual(ruleOnly.advisory.source, 'SAFETY_CORE_MAINTENANCE');
assert.strictEqual(ruleOnly.advisory.target_pct, null, '模型未触发不得给出 Gen-1 目标仓');

const stale = buildGen1ViewModel({
  ml: { enabled: true, has_signal_row: true, is_stale: true, signal_status: 'DEGRADED' },
  decision: baseDecision,
  position: basePosition
});
assert.strictEqual(stale.status.code, STATUS.DATA_STALE, '过期数据不得表述为模型异常');

const degraded = buildGen1ViewModel({
  ml: {
    enabled: true,
    has_signal_row: true,
    is_stale: false,
    signal_status: 'DEGRADED',
    signal_status_reason: 'EOD 特征数据缺失'
  },
  decision: baseDecision,
  position: basePosition
});
assert.strictEqual(degraded.status.label, 'EOD 信号降级');
assert.strictEqual(degraded.status.message, 'EOD 特征数据缺失');

const priorEod = buildGen1ViewModel({
  ml: { enabled: true, has_signal_row: true, is_stale: true, data_age_days: 1, signal_status: 'OBSERVED' },
  decision: baseDecision,
  position: basePosition
});
assert.strictEqual(priorEod.status.code, STATUS.EOD_PENDING, '上一交易日信号应等待当日收盘更新');

const blocked = buildGen1ViewModel({
  ml: {
    enabled: true, has_signal_row: true, is_stale: false, signal_status: 'BLOCKED',
    probability: 0.82, permission: 'BLOCK',
    rule_permission_reason: 'Safety Core 风险熔断或硬风险覆盖生效',
    rule_permission_source: 'SAFETY_CORE'
  },
  decision: baseDecision,
  position: basePosition
});
assert.strictEqual(blocked.risk.permission_label, '阻止');
assert.strictEqual(blocked.risk.permission_reason, 'Safety Core 风险熔断或硬风险覆盖生效');

console.log('gen1-view-model tests passed');
