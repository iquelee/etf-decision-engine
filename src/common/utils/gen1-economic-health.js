/**
 * Gen-1 经济健康聚合器（WP-G1.1 / G1.1-04）。
 *
 * 解决复审 P0-4：原 `computeHealthStatus` 在线上只收到 `dataHealth`，
 * 因此 `gen1_health_status` 实际只表达「数据是否正常」，**不是**「Gen-1 经济表现是否失效」。
 *
 * 本模块从 Shadow 结果的真实事件序列计算经济健康，并**明确区分**：
 *   runtime_data_health  —— 数据是否正常（运行时，gen1-data-health）
 *   economic_health      —— 经济表现是否失效（本模块；**样本不足 = PENDING**）
 *
 * 关键纪律：`independent_event_count < minEvents` → `status = PENDING`，
 * **绝不允许**用 OK 冒充「经济模型正常」。
 *
 * 输入：事件数组（每项至少 { date, canary_target_delta?, fwd_excess_20d?, probability?, realized? }）
 *  - 独立事件数优先取 `independent_event_count`（若调用方已按 40D 去重叠计算），否则按日期间隔估算。
 *
 * @module gen1-economic-health
 */
'use strict';

const DEFAULT_MIN_EVENTS = 20;
const DEFAULT_MIN_WINDOW_DAYS = 40;

const STATUS = Object.freeze({
  PENDING: 'PENDING',
  OK: 'OK',
  WARNING: 'WARNING',
  DEGRADED: 'DEGRADED',
  ML_OFF: 'ML_OFF'
});

function num(v) {
  return v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
}

function mean(list) {
  const xs = list.filter((v) => Number.isFinite(v));
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
}

/** 按交易日间隔（默认 40）去重叠，估算独立事件数。 */
function countIndependentEvents(events, minGapDays) {
  const gap = minGapDays || DEFAULT_MIN_WINDOW_DAYS;
  const days = [...new Set(events.map((e) => String(e.date || '').slice(0, 10)))].filter(Boolean).sort();
  const dayIndex = new Map(days.map((d, i) => [d, i]));
  const byCode = {};
  for (const e of events) {
    const c = String(e.code || '_');
    (byCode[c] = byCode[c] || []).push(e);
  }
  let count = 0;
  for (const list of Object.values(byCode)) {
    list.sort((a, b) => (String(a.date) < String(b.date) ? -1 : 1));
    let last = -Infinity;
    for (const e of list) {
      const gi = dayIndex.get(String(e.date || '').slice(0, 10));
      if (gi == null) continue;
      if (gi - last >= gap) { count += 1; last = gi; }
    }
  }
  return count;
}

/**
 * @param {Array<object>} events 事件序列
 * @param {object} [opts]
 * @param {number} [opts.minEvents]      独立事件下限（默认 20）
 * @param {number} [opts.minWindowDays]  独立事件间隔（默认 40）
 * @param {number} [opts.falseFastPathThreshold] 假启动率告警阈值（默认 0.35）
 * @param {number} [opts.driftThreshold] 校准漂移告警阈值（默认 0.30）
 * @returns {{status, reason_code, reason, rolling_alpha, false_fast_path_rate,
 *            calibration_drift, event_count, independent_event_count, min_events, evaluated_at}}
 */
function aggregateEconomicHealth(events, opts) {
  const o = opts || {};
  const list = Array.isArray(events) ? events : [];
  const minEvents = num(o.minEvents) != null ? num(o.minEvents) : DEFAULT_MIN_EVENTS;
  const minWindow = num(o.minWindowDays) != null ? num(o.minWindowDays) : DEFAULT_MIN_WINDOW_DAYS;
  const fppThreshold = num(o.falseFastPathThreshold) != null ? num(o.falseFastPathThreshold) : 0.35;
  const driftThreshold = num(o.driftThreshold) != null ? num(o.driftThreshold) : 0.30;

  const independent = num(o.independentEventCount) != null
    ? num(o.independentEventCount)
    : countIndependentEvents(list, minWindow);

  const withFwd = list.filter((e) => num(e.fwd_excess_20d) != null);
  const rollingAlpha = mean(withFwd.map((e) => Number(e.fwd_excess_20d)));
  const falseFastPathRate = withFwd.length
    ? withFwd.filter((e) => Number(e.fwd_excess_20d) < 0).length / withFwd.length
    : null;
  const calibrationDrift = num(o.calibrationDrift);

  const base = {
    rolling_alpha: rollingAlpha,
    false_fast_path_rate: falseFastPathRate,
    calibration_drift: calibrationDrift,
    event_count: list.length,
    independent_event_count: independent,
    min_events: minEvents,
    evaluated_at: o.now || new Date().toISOString()
  };

  // ★ 样本不足 → PENDING（不得 OK）
  if (independent < minEvents) {
    return Object.assign(base, {
      status: STATUS.PENDING,
      reason_code: 'ECONOMIC_SAMPLE_INSUFFICIENT',
      reason: `独立事件 ${independent} < ${minEvents}，无法判定经济健康（PENDING，不以 OK 冒充）`
    });
  }

  if (rollingAlpha != null && rollingAlpha < 0) {
    return Object.assign(base, {
      status: STATUS.DEGRADED,
      reason_code: 'ECONOMIC_ALPHA_NEGATIVE',
      reason: `滚动增量 alpha ${rollingAlpha.toFixed(5)} < 0`
    });
  }
  if (falseFastPathRate != null && falseFastPathRate > 0.5) {
    return Object.assign(base, {
      status: STATUS.DEGRADED,
      reason_code: 'ECONOMIC_FALSE_FAST_PATH_HIGH',
      reason: `假启动率 ${falseFastPathRate} > 0.50`
    });
  }
  if (calibrationDrift != null && calibrationDrift > 0.5) {
    return Object.assign(base, {
      status: STATUS.DEGRADED,
      reason_code: 'ECONOMIC_CALIBRATION_DRIFT',
      reason: `校准漂移 ${calibrationDrift} > 0.50`
    });
  }
  if ((falseFastPathRate != null && falseFastPathRate > fppThreshold)
      || (calibrationDrift != null && calibrationDrift > driftThreshold)) {
    return Object.assign(base, {
      status: STATUS.WARNING,
      reason_code: 'ECONOMIC_WARNING',
      reason: `假启动率 ${falseFastPathRate} / 漂移 ${calibrationDrift} 触及告警阈值`
    });
  }
  return Object.assign(base, {
    status: STATUS.OK,
    reason_code: 'ECONOMIC_HEALTHY',
    reason: `独立事件 ${independent} 且滚动增量 alpha 非负`
  });
}

module.exports = { STATUS, DEFAULT_MIN_EVENTS, DEFAULT_MIN_WINDOW_DAYS, aggregateEconomicHealth, countIndependentEvents };
