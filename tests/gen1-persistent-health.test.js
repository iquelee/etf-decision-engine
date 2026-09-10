'use strict';

/** G1.1-03 持久化健康 latch 单测（模拟跨冷启动：状态只来自传入的 prevState）。 */
const assert = require('assert');
const {
  HEALTH_STATE_KEY, defaultHealthState, computeLatchedState, healthStateToGate
} = require('../src/common/utils/gen1-health-state');
const { HEALTH } = require('../src/common/utils/gen1-circuit-breaker');

// 默认态
{
  const s = defaultHealthState();
  assert.strictEqual(s.key, HEALTH_STATE_KEY);
  assert.strictEqual(s.latched_health, HEALTH.OK);
  assert.strictEqual(s.manual_review_required, false);
  assert.strictEqual(s.economic_health, 'PENDING');
}

// OK → OK
{
  const r = computeLatchedState(defaultHealthState(), HEALTH.OK, { now: 'T1' });
  assert.strictEqual(r.state.latched_health, HEALTH.OK);
  assert.strictEqual(r.recovery_rejected, false);
}

// 正常降级：OK → DEGRADED
{
  const r = computeLatchedState(defaultHealthState(), HEALTH.DEGRADED, { now: 'T2' });
  assert.strictEqual(r.state.latched_health, HEALTH.DEGRADED);
  assert.strictEqual(r.state.manual_review_required, true);
  assert.strictEqual(r.state.degraded_at, 'T2');
}

// ★ 核心：DEGRADED 后「冷启动」——状态从持久化读，不依赖进程内变量
{
  const persisted = computeLatchedState(defaultHealthState(), HEALTH.DEGRADED, { now: 'T2' }).state;
  // 模拟新进程：只有 persisted，没有内存状态
  const r = computeLatchedState(persisted, HEALTH.OK, { now: 'T3' });
  assert.strictEqual(r.recovery_rejected, true, '无人工确认必须拒绝恢复');
  assert.strictEqual(r.state.latched_health, HEALTH.DEGRADED, '冷启动后仍保持 DEGRADED');
  assert.strictEqual(r.state.manual_review_required, true);
}

// 人工确认后才恢复
{
  const persisted = computeLatchedState(defaultHealthState(), HEALTH.ML_OFF, { now: 'T4' }).state;
  assert.strictEqual(persisted.latched_health, HEALTH.ML_OFF);
  assert.strictEqual(persisted.ml_off_at, 'T4');
  const denied = computeLatchedState(persisted, HEALTH.OK, { now: 'T5' });
  assert.strictEqual(denied.recovery_rejected, true);
  const ok = computeLatchedState(persisted, HEALTH.OK, { now: 'T5', manualReviewConfirmed: true, reviewedBy: '李' });
  assert.strictEqual(ok.recovery_applied, true);
  assert.strictEqual(ok.state.latched_health, HEALTH.OK);
  assert.strictEqual(ok.state.manual_review_required, false);
  assert.strictEqual(ok.state.reviewed_at, 'T5');
  assert.strictEqual(ok.state.reviewed_by, '李');
  assert.strictEqual(ok.state.ml_off_at, null, '恢复后清除 ml_off_at');
}

// 下行未结束：DEGRADED + incoming ML_OFF → 取更差者
{
  const persisted = computeLatchedState(defaultHealthState(), HEALTH.DEGRADED, { now: 'T6' }).state;
  const r = computeLatchedState(persisted, HEALTH.ML_OFF, { now: 'T7' });
  assert.strictEqual(r.state.latched_health, HEALTH.ML_OFF);
  assert.strictEqual(r.state.manual_review_required, true);
}

// 门导出：latched 决定运行时门
{
  const persisted = computeLatchedState(defaultHealthState(), HEALTH.ML_OFF, { now: 'T8' }).state;
  const gate = healthStateToGate(persisted);
  assert.strictEqual(gate.allow_gen1_timing, false);
  assert.strictEqual(gate.immediate_fallback_v361, true);
  assert.strictEqual(gate.manual_review_required, true);
  assert.strictEqual(gate.economic_health, 'PENDING');
}

// 经济健康写入状态（G1.1-04 联动）
{
  const r = computeLatchedState(defaultHealthState(), HEALTH.OK, {
    now: 'T9', economic: { status: 'PENDING', independent_event_count: 3 }, runtimeDataHealth: 'DATA_OK'
  });
  assert.strictEqual(r.state.economic_health, 'PENDING');
  assert.strictEqual(r.state.economic.independent_event_count, 3);
  assert.strictEqual(r.state.runtime_data_health, 'DATA_OK');
}

console.log('gen1 persistent health tests passed');
