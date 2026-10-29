'use strict';

/** G1-05 Data Health Gate 单测。 */
const assert = require('assert');
const { STATUS, REASON, REQUIRED_FEATURES, evaluateDataHealth } = require('../src/common/utils/gen1-data-health');

const full = {};
for (const k of REQUIRED_FEATURES) full[k] = k === 'breakout' ? 0 : 1.0;

const main5 = '2026-09-10';

// 1) 全特征 + 基准对齐 → DATA_OK
{
  const r = evaluateDataHealth({ features: full, mainLatestDate: main5, benchmarkLatestDate: main5, historyBars: 200 });
  assert.strictEqual(r.status, STATUS.DATA_OK);
  assert.strictEqual(r.benchmark_aligned, true);
  assert.strictEqual(r.missing_features.length, 0);
}

// 2) 基准缺失（510300）→ BLOCKED / BENCHMARK_MISSING（任务包核心场景）
{
  const r = evaluateDataHealth({ features: full, mainLatestDate: main5, benchmarkLatestDate: null, historyBars: 200 });
  assert.strictEqual(r.status, STATUS.DATA_BLOCKED);
  assert.strictEqual(r.reason_code, REASON.BENCHMARK_MISSING);
}

// 3) 基准日期与 Main5 不一致 → BLOCKED
{
  const r = evaluateDataHealth({ features: full, mainLatestDate: main5, benchmarkLatestDate: '2026-09-09', historyBars: 200 });
  assert.strictEqual(r.status, STATUS.DATA_BLOCKED);
  assert.strictEqual(r.reason_code, REASON.BENCHMARK_MISSING);
  assert.strictEqual(r.benchmark_aligned, false);
}

// 4) 基准缺失导致 rs_20d=null（列存在但值缺失）→ BLOCKED / BENCHMARK_MISSING
{
  const f = Object.assign({}, full, { rs_20d: null });
  const r = evaluateDataHealth({ features: f, mainLatestDate: main5, benchmarkLatestDate: main5, historyBars: 200 });
  assert.strictEqual(r.status, STATUS.DATA_BLOCKED);
  assert.strictEqual(r.reason_code, REASON.BENCHMARK_MISSING);
}

// 5) 个别统计缺失（列存在、值为 NaN）→ DEGRADED / STATISTICAL_MISSING
{
  const f = Object.assign({}, full, { ma20_slope: NaN, bias_20d: NaN });
  const r = evaluateDataHealth({ features: f, mainLatestDate: main5, benchmarkLatestDate: main5, historyBars: 200 });
  assert.strictEqual(r.status, STATUS.DATA_DEGRADED);
  assert.strictEqual(r.reason_code, REASON.STATISTICAL_MISSING);
  assert.deepStrictEqual(r.missing_features.sort(), ['bias_20d', 'ma20_slope']);
}

// 6) 必需特征列整列未生成（key 不存在）→ BLOCKED / PIPELINE_MISSING
{
  const f = Object.assign({}, full);
  delete f.atr20;
  const r = evaluateDataHealth({ features: f, mainLatestDate: main5, benchmarkLatestDate: main5, historyBars: 200 });
  assert.strictEqual(r.status, STATUS.DATA_BLOCKED);
  assert.strictEqual(r.reason_code, REASON.PIPELINE_MISSING);
  assert.deepStrictEqual(r.absent_features, ['atr20']);
}

// 7) 历史不足 → BLOCKED / INSUFFICIENT_HISTORY
{
  const r = evaluateDataHealth({ features: full, mainLatestDate: main5, benchmarkLatestDate: main5, historyBars: 30, minHistoryBars: 60 });
  assert.strictEqual(r.status, STATUS.DATA_BLOCKED);
  assert.strictEqual(r.reason_code, REASON.INSUFFICIENT_HISTORY);
}

// 8) 数据陈旧 → BLOCKED / STALE_DATA
{
  const r = evaluateDataHealth({ features: full, mainLatestDate: main5, benchmarkLatestDate: main5, historyBars: 200, staleDays: 2, maxStaleDays: 0 });
  assert.strictEqual(r.status, STATUS.DATA_BLOCKED);
  assert.strictEqual(r.reason_code, REASON.STALE_DATA);
}

// 9) 仅 DATA_OK 允许 canary（与 safety permission 的组合语义）
{
  const ok = evaluateDataHealth({ features: full, mainLatestDate: main5, benchmarkLatestDate: main5, historyBars: 200 });
  const deg = evaluateDataHealth({ features: Object.assign({}, full, { ret_5d: NaN }), mainLatestDate: main5, benchmarkLatestDate: main5, historyBars: 200 });
  assert.strictEqual(ok.status, 'DATA_OK');
  assert.strictEqual(deg.status, 'DATA_DEGRADED');
}


/* =====================================================================
 * C3-R2（2026-10-03）：硬必填 / 语义可空 两组口径
 *   判据 1  HARD_REQUIRED 值缺失（列存在）        → DATA_DEGRADED / STATISTICAL_MISSING
 *   判据 2  absent（列未生成）                    → DATA_BLOCKED  / PIPELINE_MISSING
 *   判据 3  rs_20d 值缺失                          → DATA_BLOCKED  / BENCHMARK_MISSING
 *   判据 4  SEMANTICALLY_NULLABLE 值 null（列存在）→ 不得判 pipeline missing
 * ===================================================================*/
const {
  HARD_REQUIRED_FEATURES, SEMANTICALLY_NULLABLE_FEATURES
} = require('../src/common/utils/gen1-data-health');

// 10) [T-2 / 判据 4] 语义可空字段值缺失（列存在）→ 不得降级
{
  assert.deepStrictEqual([...SEMANTICALLY_NULLABLE_FEATURES], ['sideway_range'],
    '语义可空集合（本轮）= sideway_range');
  const f = Object.assign({}, full, { sideway_days: 0, sideway_range: null });
  const r = evaluateDataHealth({ features: f, mainLatestDate: main5, benchmarkLatestDate: main5, historyBars: 200 });
  assert.strictEqual(r.status, STATUS.DATA_OK, 'sideway_range 语义空值不得触发降级');
  assert.strictEqual(r.reason_code, null);
  assert.deepStrictEqual(r.missing_features, [], 'missing_features 不得含 sideway_range');
  assert.ok(!r.absent_features.includes('sideway_range'));
}

// 11) [T-3 / 判据 1] 硬必填值缺失（列存在）→ 仍须 DEGRADED / STATISTICAL_MISSING
{
  assert.ok(HARD_REQUIRED_FEATURES.includes('atr20'), 'atr20 属硬必填');
  assert.ok(!SEMANTICALLY_NULLABLE_FEATURES.includes('atr20'), 'atr20 不属语义可空');
  const f = Object.assign({}, full, { atr20: null });
  const r = evaluateDataHealth({ features: f, mainLatestDate: main5, benchmarkLatestDate: main5, historyBars: 200 });
  assert.strictEqual(r.status, STATUS.DATA_DEGRADED);
  assert.strictEqual(r.reason_code, REASON.STATISTICAL_MISSING);
  assert.deepStrictEqual(r.missing_features, ['atr20']);
}

// 12) [T-4 / 判据 2] 硬必填列未生成 → DATA_BLOCKED / PIPELINE_MISSING
{
  const f = Object.assign({}, full);
  delete f.atr20;
  const r = evaluateDataHealth({ features: f, mainLatestDate: main5, benchmarkLatestDate: main5, historyBars: 200 });
  assert.strictEqual(r.status, STATUS.DATA_BLOCKED);
  assert.strictEqual(r.reason_code, REASON.PIPELINE_MISSING);
  assert.deepStrictEqual(r.absent_features, ['atr20']);
}

// 13) [T-5 / 判据 3] rs_20d 值缺失 → DATA_BLOCKED / BENCHMARK_MISSING（环节 ⑤ 先于 ⑥）
{
  const f = Object.assign({}, full, { rs_20d: null });
  const r = evaluateDataHealth({ features: f, mainLatestDate: main5, benchmarkLatestDate: main5, historyBars: 200 });
  assert.strictEqual(r.status, STATUS.DATA_BLOCKED);
  assert.strictEqual(r.reason_code, REASON.BENCHMARK_MISSING);
}

// 14) [T-6 / 判据 2 边界] 语义可空字段**列缺失** → 仍须 PIPELINE_MISSING（只豁免「值缺失」）
{
  const f = Object.assign({}, full);
  delete f.sideway_range;
  const r = evaluateDataHealth({ features: f, mainLatestDate: main5, benchmarkLatestDate: main5, historyBars: 200 });
  assert.strictEqual(r.status, STATUS.DATA_BLOCKED, '列缺失 = 管线故障，不因「语义可空」豁免');
  assert.strictEqual(r.reason_code, REASON.PIPELINE_MISSING);
  assert.deepStrictEqual(r.absent_features, ['sideway_range']);
}

// 15) [E-2] 权威生产者复算：indicators.js 实跑产出 sideway_days=0 ⇒ sideway_range=null
{
  const { computeSnapshot } = require('../src/common/utils/indicators');
  const bars = [];
  let close = 100;
  let d = new Date('2026-01-05T00:00:00Z');
  for (let i = 0; i < 100; i += 1) {
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d = new Date(d.getTime() + 86400000);
    close *= 1.03; // 强势单边上行 ⇒ 非横盘
    bars.push({
      trade_date: d.toISOString().slice(0, 10),
      close: Number(close.toFixed(4)),
      high: Number((close * 1.005).toFixed(4)),
      low: Number((close * 0.995).toFixed(4)),
      volume: 1000000 + i * 1000
    });
    d = new Date(d.getTime() + 86400000);
  }
  const snap = computeSnapshot(bars, {}, { code: 'T', calc_date: bars[bars.length - 1].trade_date });
  assert.strictEqual(snap.sideway_days, 0, '合成序列必须非横盘（生产者口径）');
  assert.strictEqual(snap.sideway_range, null, 'sideway_days=0 ⇒ calcSidewayRange 按构造返回 null');

  const n = bars.length;
  const retN = (k) => (bars[n - 1].close / bars[n - 1 - k].close - 1);
  const row = {
    ma20_slope: snap.ma20_slope,
    px_ma20: bars[n - 1].close / snap.ma20 - 1,
    px_ma60: bars[n - 1].close / snap.ma60 - 1,
    price_position: snap.price_position,
    volume_ratio: snap.volume_ratio,
    sideway_days: snap.sideway_days,
    sideway_range: snap.sideway_range,
    consolidation_score: snap.consolidation_score,
    atr20: snap.atr20,
    change_5d: snap.change_5d,
    bias_20d: snap.bias_20d,
    breakout: snap.breakout === true ? 1 : 0,
    ret_5d: retN(5),
    ret_20d: retN(20),
    rs_20d: 0
  };
  // 反事实：**旧口径**（并集取基数）下，唯一触发源恰为语义空值字段
  const oldNullish = REQUIRED_FEATURES.filter((k) => Object.prototype.hasOwnProperty.call(row, k)
    && (row[k] == null || row[k] === '' || (typeof row[k] === 'number' && Number.isNaN(row[k]))));
  assert.deepStrictEqual(oldNullish, ['sideway_range'], '旧口径的降级触发源恰为语义可空字段');

  const last = bars[n - 1].trade_date;
  const r = evaluateDataHealth({
    features: row, mainLatestDate: last, benchmarkLatestDate: last, historyBars: n
  });
  assert.strictEqual(r.status, STATUS.DATA_OK, '修正后：语义空值不得降级');
  assert.deepStrictEqual(r.missing_features, []);
  assert.ok(!r.missing_features.includes('sideway_range'));
}

console.log('gen1 data health tests passed');
