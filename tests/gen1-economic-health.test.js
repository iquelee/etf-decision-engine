'use strict';

/** G1.1-04 经济健康聚合器单测（核心：样本不足必须 PENDING，不得 OK）。 */
const assert = require('assert');
const { STATUS, aggregateEconomicHealth, countIndependentEvents, countIndependentEventsDetailed } = require('../src/common/utils/gen1-economic-health');

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

/* ===== WP-G1.2 G1.2-04：独立事件契约（event_cluster_id 去重 + 真实交易日历）===== */

// 1) event_cluster_id 去重：同簇多行只算一次
{
  const events = [
    { code: 'A', date: '2024-01-01', event_cluster_id: 'A_2024-01-01' },
    { code: 'A', date: '2024-01-01', event_cluster_id: 'A_2024-01-01' },
    { code: 'A', date: '2024-01-02', event_cluster_id: 'A_2024-01-01' },  // 同簇不同日 → 折叠
    { code: 'A', date: '2024-06-01', event_cluster_id: 'A_2024-06-01' }
  ];
  const d = countIndependentEventsDetailed(events, { minGapDays: 40 });
  assert.strictEqual(d.unique_clusters, 2, '2 个 event_cluster_id');
  assert.strictEqual(d.events_considered, 4);
  assert.strictEqual(d.count, 2, '两簇间隔 >> 阈值 → 2 个独立事件');
}

// 2) ★ 核心：必须用**真实交易日历**，不得用「事件日期自排 index」近似
{
  // 两个事件在自然日上相隔 200 天，但交易日历里只有 3 个交易日 → 不是独立事件
  const calendar = ['2024-01-01', '2024-01-02', '2024-01-03'];
  const events = [
    { code: 'A', date: '2024-01-01' },
    { code: 'A', date: '2024-01-03' }
  ];
  const withCal = countIndependentEventsDetailed(events, { minGapDays: 40, tradingCalendar: calendar });
  assert.strictEqual(withCal.gap_basis, 'TRADING_DAYS');
  assert.strictEqual(withCal.count, 1, '交易日间隔仅 2 → 1 个独立事件');
  assert.strictEqual(withCal.gap_threshold_used, 40);

  // 无日历 → 自然日兜底且阈值放大，不得多算（fail-closed）
  const noCal = countIndependentEventsDetailed([
    { code: 'A', date: '2024-01-01' }, { code: 'A', date: '2024-03-05' }
  ], { minGapDays: 40 });
  assert.strictEqual(noCal.gap_basis, 'CALENDAR_DAYS_FALLBACK_CONSERVATIVE');
  assert.strictEqual(noCal.gap_threshold_used, 60, '40 × 1.5 = 60 自然日（保守）');
}

// 3) ★ 兜底口径不得比交易日口径更宽松（fail-closed 不变量）
{
  const calendar = [];
  for (let d = 0; d < 200; d += 1) {
    const dt = new Date(Date.UTC(2024, 0, 1 + d));
    const dow = dt.getUTCDay();
    if (dow !== 0 && dow !== 6) calendar.push(dt.toISOString().slice(0, 10));
  }
  const events = [];
  for (let i = 0; i < 200; i += 7) {
    const dt = new Date(Date.UTC(2024, 0, 1 + i));
    events.push({ code: 'A', date: dt.toISOString().slice(0, 10) });
  }
  const withCal = countIndependentEventsDetailed(events, { minGapDays: 40, tradingCalendar: calendar }).count;
  const noCal = countIndependentEventsDetailed(events, { minGapDays: 40 }).count;
  assert.ok(noCal <= withCal, `自然日兜底 ${noCal} 不得多于交易日口径 ${withCal}（否则 fail-open）`);
}

// 4) 聚合结果带出口径元信息（供 Economic Gate 审计）
{
  const r = aggregateEconomicHealth([
    { code: 'A', date: '2024-01-01', fwd_excess_20d: 0.02 }
  ], { minEvents: 20, tradingCalendar: ['2024-01-01', '2024-01-02'] });
  assert.strictEqual(r.status, STATUS.PENDING);
  assert.strictEqual(r.independent_event_gap_basis, 'TRADING_DAYS');
  assert.ok(/TRADING_DAYS/.test(r.reason), 'reason 必须显式标注口径');
}

console.log('gen1 economic health tests passed');
