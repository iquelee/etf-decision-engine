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

console.log('gen1 data health tests passed');
