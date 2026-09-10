'use strict';

/** G1.1-04 经济健康聚合器单测（核心：样本不足必须 PENDING，不得 OK）。 */
const assert = require('assert');
const { STATUS, aggregateEconomicHealth, countIndependentEvents } = require('../src/common/utils/gen1-economic-health');

// 样本不足（3 个独立事件）→ PENDING，即使全部为正
{
  const events = [
    { code: '513310', date: '2023-05-30', fwd_excess_20d: 0.20 },
    { code: '159582', date: '2025-12-23', fwd_excess_20d: 0.15 },
    { code: '515880', date: '2023-06-01', fwd_excess_20d: 0.10 }
  ];
  const r = aggregateEconomicHealth(events, { minEvents: 20 });
  assert.strictEqual(r.status, STATUS.PENDING, '独立事件不足必须 PENDING');
  assert.strictEqual(r.reason_code, 'ECONOMIC_SAMPLE_INSUFFICIENT');
  assert.notStrictEqual(r.status, STATUS.OK, '绝不允许 OK 冒充');
  assert.ok(r.independent_event_count < 20);
}

// 空事件 → PENDING
{
  const r = aggregateEconomicHealth([], {});
  assert.strictEqual(r.status, STATUS.PENDING);
  assert.strictEqual(r.rolling_alpha, null);
  assert.strictEqual(r.false_fast_path_rate, null);
}

// 样本充足且 alpha 为负 → DEGRADED
{
  const events = [];
  for (let i = 0; i < 25; i += 1) {
    events.push({ code: '513310', date: `2024-${String(Math.floor(i / 2) + 1).padStart(2, '0')}-0${(i % 2) + 1}`,
      _idx: i, fwd_excess_20d: -0.02 });
  }
  // 直接指定独立事件数，跳过日期去重叠的近似
  const r = aggregateEconomicHealth(events, { minEvents: 20, independentEventCount: 25 });
  assert.strictEqual(r.status, STATUS.DEGRADED);
  assert.strictEqual(r.reason_code, 'ECONOMIC_ALPHA_NEGATIVE');
}

// 样本充足 + alpha 正 + 假启动率高 → DEGRADED
{
  const events = [];
  for (let i = 0; i < 30; i += 1) events.push({ code: '513310', date: `2024-01-${String(i + 1).padStart(2, '0')}`, fwd_excess_20d: i < 18 ? -0.03 : 0.05 });
  const r = aggregateEconomicHealth(events, { minEvents: 20, independentEventCount: 30 });
  assert.strictEqual(r.status, STATUS.DEGRADED);
  assert.strictEqual(r.reason_code, 'ECONOMIC_FALSE_FAST_PATH_HIGH');
}

// 样本充足 + alpha 正 + 低假启动率 → OK
{
  const events = [];
  for (let i = 0; i < 30; i += 1) events.push({ code: '513310', date: `2024-01-${String(i + 1).padStart(2, '0')}`, fwd_excess_20d: i < 3 ? -0.01 : 0.06 });
  const r = aggregateEconomicHealth(events, { minEvents: 20, independentEventCount: 30 });
  assert.strictEqual(r.status, STATUS.OK);
  assert.strictEqual(r.reason_code, 'ECONOMIC_HEALTHY');
}

// 独立事件计数：同 code 间隔 >= 40 交易日
{
  const events = [
    { code: 'A', date: '2024-01-01' }, { code: 'A', date: '2024-01-05' },
    { code: 'A', date: '2024-03-01' }, { code: 'B', date: '2024-03-01' }
  ];
  const n = countIndependentEvents(events, 3);
  assert.ok(n >= 2, `independent count = ${n}`);
}

console.log('gen1 economic health tests passed');
