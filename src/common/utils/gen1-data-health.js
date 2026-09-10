/**
 * Gen-1 Data Health Gate（WP-G1 / G1-05）。
 *
 * 正式 Fast Path 必须 **Fail Closed**：核心特征或基准缺失时，
 * 概率可以保留做诊断，但 advisory / canary **不得生效**。
 *
 * 状态：
 *   DATA_OK        全部必需特征可用 + 基准对齐 → 允许 advisory + canary
 *   DATA_DEGRADED  个别统计缺失（值缺失，列存在）→ 允许 advisory，禁止 canary
 *   DATA_BLOCKED   致命缺失（列未生成 / 基准 / 陈旧 / 历史不足）→ advisory & canary 均关闭
 *
 * 缺失原因分类（关键：区分「管线缺失」与「统计缺失」）：
 *   PIPELINE_MISSING      必需特征**列未生成**（key 在特征行中不存在）→ 管线故障
 *   BENCHMARK_MISSING     基准（510300）缺失 / 与 Main5 日期不一致 / rs_20d 无法计算
 *   STALE_DATA            数据滞后于应到交易日
 *   INSUFFICIENT_HISTORY  历史长度不足（< 模型窗口）
 *   STATISTICAL_MISSING   列存在但个别数值缺失（可由模型 imputer 处理）
 *
 * @module gen1-data-health
 */
'use strict';

const STATUS = Object.freeze({ DATA_OK: 'DATA_OK', DATA_DEGRADED: 'DATA_DEGRADED', DATA_BLOCKED: 'DATA_BLOCKED' });
const REASON = Object.freeze({
  STATISTICAL_MISSING: 'STATISTICAL_MISSING',
  PIPELINE_MISSING: 'PIPELINE_MISSING',
  BENCHMARK_MISSING: 'BENCHMARK_MISSING',
  STALE_DATA: 'STALE_DATA',
  INSUFFICIENT_HISTORY: 'INSUFFICIENT_HISTORY'
});

/** 正式 Fast Path 必需特征（与 frozen-manifest features_core 对齐）。 */
const REQUIRED_FEATURES = Object.freeze([
  'ma20_slope', 'px_ma20', 'px_ma60', 'price_position', 'volume_ratio',
  'sideway_days', 'sideway_range', 'consolidation_score', 'atr20',
  'change_5d', 'bias_20d', 'breakout', 'ret_5d', 'ret_20d', 'rs_20d'
]);

function isNullish(v) {
  return v == null || v === '' || (typeof v === 'number' && Number.isNaN(v));
}

/**
 * @param {object} input
 * @param {object} input.features             当日特征行（key → 值）
 * @param {string[]} [input.requiredFeatures]
 * @param {string} [input.mainLatestDate]     Main5 官方 EOD 最新交易日
 * @param {string} [input.benchmarkLatestDate] 510300 最新交易日
 * @param {number} [input.historyBars]        可用历史 bar 数
 * @param {number} [input.minHistoryBars]     最小历史长度（默认 60）
 * @param {number} [input.staleDays]          数据滞后天数
 * @param {number} [input.maxStaleDays]       允许最大滞后（默认 0）
 * @returns {{status, reason_code, reason, missing_features, absent_features, benchmark_aligned}}
 */
function evaluateDataHealth(input) {
  const src = input || {};
  const features = src.features || {};
  const required = src.requiredFeatures || REQUIRED_FEATURES;
  const minHistory = src.minHistoryBars != null ? Number(src.minHistoryBars) : 60;
  const historyBars = src.historyBars != null ? Number(src.historyBars) : minHistory;
  const maxStale = src.maxStaleDays != null ? Number(src.maxStaleDays) : 0;

  // 列未生成（key 不存在）vs 值缺失（key 存在但 null/NaN）
  const absent = required.filter((k) => !Object.prototype.hasOwnProperty.call(features, k));
  const nullish = required.filter((k) => Object.prototype.hasOwnProperty.call(features, k) && isNullish(features[k]));
  const missing = absent.concat(nullish);

  const result = (status, code, reason, extra) => Object.assign({
    status,
    reason_code: code,
    reason,
    missing_features: missing,
    absent_features: absent,
    benchmark_aligned: null
  }, extra || {});

  // 1) 历史不足 → BLOCKED
  if (historyBars < minHistory) {
    return result(STATUS.DATA_BLOCKED, REASON.INSUFFICIENT_HISTORY,
      `历史长度不足（${historyBars} < ${minHistory}）`);
  }

  // 2) 基准缺失 / 与 Main5 日期不一致 → BLOCKED
  const benchDate = src.benchmarkLatestDate ? String(src.benchmarkLatestDate).slice(0, 10) : null;
  const mainDate = src.mainLatestDate ? String(src.mainLatestDate).slice(0, 10) : null;
  const aligned = !!(benchDate && mainDate && benchDate === mainDate);
  if (!benchDate) {
    return result(STATUS.DATA_BLOCKED, REASON.BENCHMARK_MISSING,
      '基准 510300 缺失，rs_20d 无法计算', { benchmark_aligned: false });
  }
  if (mainDate && benchDate !== mainDate) {
    return result(STATUS.DATA_BLOCKED, REASON.BENCHMARK_MISSING,
      `基准最新日 ${benchDate} 与 Main5 官方 EOD ${mainDate} 不一致`, { benchmark_aligned: false });
  }

  // 3) 数据陈旧 → BLOCKED
  if (src.staleDays != null && Number(src.staleDays) > maxStale) {
    return result(STATUS.DATA_BLOCKED, REASON.STALE_DATA,
      `数据滞后 ${src.staleDays} 天（允许 ${maxStale}）`, { benchmark_aligned: aligned });
  }

  // 4) 列未生成 → PIPELINE_MISSING（管线故障）
  if (absent.length > 0) {
    return result(STATUS.DATA_BLOCKED, REASON.PIPELINE_MISSING,
      `必需特征列未生成（${absent.join(',')}）`, { benchmark_aligned: aligned });
  }

  // 5) rs_20d 值缺失（基准历史不足/对齐失败）→ BENCHMARK_MISSING
  if (nullish.includes('rs_20d')) {
    return result(STATUS.DATA_BLOCKED, REASON.BENCHMARK_MISSING,
      'rs_20d 缺失（基准历史不足或对齐失败）', { benchmark_aligned: aligned });
  }

  // 6) 个别统计缺失 → DEGRADED（允许 advisory，禁止 canary）
  if (nullish.length > 0) {
    return result(STATUS.DATA_DEGRADED, REASON.STATISTICAL_MISSING,
      `个别统计特征缺失（${nullish.join(',')}），由模型 imputer 处理`, { benchmark_aligned: aligned });
  }

  return result(STATUS.DATA_OK, null,
    `全部 ${required.length} 个必需特征可用；基准与 Main5 对齐`, { benchmark_aligned: true });
}

module.exports = { STATUS, REASON, REQUIRED_FEATURES, evaluateDataHealth };
