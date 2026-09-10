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
 *  - 独立事件数优先取 `independentEventCount`（若调用方已按统一口径计算），
 *    否则走 `countIndependentEventsDetailed`：**event_cluster_id 去重 + 真实交易日历 40D 间隔**
 *    （WP-G1.2 G1.2-04；不再用「事件日期自排 index」的近似口径）。
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

/**
 * 事件簇键：沿用 Gen-1 能力审计 / Shadow Ledger 的**唯一**去重口径。
 * 优先使用数据集自带的 `event_cluster_id`（格式 `{code}_{date}`），缺失时按同规则兜底。
 */
function clusterKeyOf(e) {
  const explicit = e && e.event_cluster_id != null ? String(e.event_cluster_id).trim() : '';
  if (explicit) return explicit;
  return `${e && e.code != null ? e.code : '_'}_${String((e && e.date) || '').slice(0, 10)}`;
}

function epochDay(v) {
  const t = Date.parse(`${String(v).slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(t) ? Math.floor(t / 86400000) : null;
}

/**
 * 独立事件计数（WP-G1.2 G1.2-04，复审 P0）。
 *
 * 复审问题：原实现先取「所有事件日期」自排 index，再判断 `index gap >= 40`
 * —— 那是「隔了 40 个发生过事件的日期」，不是「隔了 40 个交易日」。事件稀疏时差异极大。
 *
 * 现口径（**不再重新发明第三套独立事件**）：
 *   ① 事件先按 `event_cluster_id`（能力审计口径）去重 → 每个簇取最早一天；
 *   ② 按 code 分组，在**交易日序**上判断间隔 >= minGapDays；
 *   ③ 交易日序优先取调用方传入的真实交易日历 `tradingCalendar`；
 *      缺失时退化为自然日序 **并按 1.5× 放大阈值**（40 交易日 ≈ 58 自然日，取 60 天更保守），
 *      令自然日口径的计数 **不会多于** 交易日口径 → fail-closed，
 *      并在 `gap_basis = 'CALENDAR_DAYS_FALLBACK_CONSERVATIVE'` 中显式标注。
 *
 * ⚠️ 为什么必须放大阈值：自然日间隔恒 **≥** 交易日间隔，若沿用同一个 40 天阈值，
 * 自然日口径会**多算**独立事件（fail-OPEN）。放大到 1.5× 才能保证 ≤ 交易日口径。
 *
 * @param {Array<object>} events
 * @param {number|object} [opts] 数字 = 兼容旧签名的 minGapDays；对象见下
 * @param {number}   [opts.minGapDays=40]
 * @param {string[]} [opts.tradingCalendar] 真实交易日（YYYY-MM-DD 升序）
 * @returns {number} 独立事件数
 */
function countIndependentEvents(events, opts) {
  return countIndependentEventsDetailed(events, opts).count;
}

/** 自然日兜底阈值倍数：40 交易日 ≈ 58 自然日，取 1.5× 保证不比交易日口径多算。 */
const CALENDAR_FALLBACK_MULTIPLIER = 1.5;

/**
 * `countIndependentEvents` 的详细版（带口径元信息，供 Economic Gate 审计）。
 * @returns {{count, gap_basis, gap_threshold_used, cluster_key, unique_clusters, events_considered, min_gap_days}}
 */
function countIndependentEventsDetailed(events, opts) {
  const o = (typeof opts === 'number' || typeof opts === 'string') ? { minGapDays: num(opts) } : (opts || {});
  const gap = num(o.minGapDays) != null ? num(o.minGapDays) : DEFAULT_MIN_WINDOW_DAYS;
  const list = (Array.isArray(events) ? events : []).filter((e) => e && String(e.date || '').slice(0, 10));

  const calendar = Array.isArray(o.tradingCalendar) ? o.tradingCalendar.map((d) => String(d).slice(0, 10)) : null;
  let idxOf;
  let gapBasis;
  let gapThresholdUsed = gap;
  if (calendar && calendar.length) {
    const calIdx = new Map(calendar.map((d, i) => [d, i]));
    idxOf = (d) => (calIdx.has(d) ? calIdx.get(d) : null);
    gapBasis = 'TRADING_DAYS';
  } else {
    idxOf = (d) => epochDay(d);
    gapBasis = 'CALENDAR_DAYS_FALLBACK_CONSERVATIVE';
    gapThresholdUsed = Math.ceil(gap * CALENDAR_FALLBACK_MULTIPLIER);
  }

  // ① 按事件簇去重 → 每簇取最早一天
  const earliest = new Map();
  for (const e of list) {
    const key = clusterKeyOf(e);
    const day = String(e.date).slice(0, 10);
    if (!earliest.has(key) || day < earliest.get(key).day) {
      earliest.set(key, { key, day, code: String(e.code == null ? '_' : e.code) });
    }
  }

  // ② 按 code 分组，交易日序上判间隔
  const byCode = new Map();
  for (const c of earliest.values()) {
    const i = idxOf(c.day);
    if (i == null) continue;
    if (!byCode.has(c.code)) byCode.set(c.code, []);
    byCode.get(c.code).push(i);
  }
  let count = 0;
  for (const idxs of byCode.values()) {
    idxs.sort((a, b) => a - b);
    let last = -Infinity;
    for (const i of idxs) {
      if (i - last >= gapThresholdUsed) { count += 1; last = i; }
    }
  }

  return {
    count,
    gap_basis: gapBasis,
    gap_threshold_used: gapThresholdUsed,
    cluster_key: 'event_cluster_id || {code}_{date}',
    unique_clusters: earliest.size,
    events_considered: list.length,
    min_gap_days: gap,
    trading_calendar_days: calendar ? calendar.length : 0
  };
}

/**
 * @param {Array<object>} events 事件序列
 * @param {object} [opts]
 * @param {number} [opts.minEvents]      独立事件下限（默认 20）
 * @param {number} [opts.minWindowDays]  独立事件间隔（默认 40，单位=交易日）
 * @param {string[]} [opts.tradingCalendar] 真实交易日历（强烈建议传入；缺失则自然日兜底）
 * @param {number} [opts.falseFastPathThreshold] 假启动率告警阈值（默认 0.35）
 * @param {number} [opts.driftThreshold] 校准漂移告警阈值（默认 0.30）
 * @returns {{status, reason_code, reason, rolling_alpha, false_fast_path_rate,
 *            calibration_drift, event_count, independent_event_count, independent_event_gap_basis,
 *            min_events, evaluated_at}}
 */
function aggregateEconomicHealth(events, opts) {
  const o = opts || {};
  const list = Array.isArray(events) ? events : [];
  const minEvents = num(o.minEvents) != null ? num(o.minEvents) : DEFAULT_MIN_EVENTS;
  const minWindow = num(o.minWindowDays) != null ? num(o.minWindowDays) : DEFAULT_MIN_WINDOW_DAYS;
  const fppThreshold = num(o.falseFastPathThreshold) != null ? num(o.falseFastPathThreshold) : 0.35;
  const driftThreshold = num(o.driftThreshold) != null ? num(o.driftThreshold) : 0.30;

  const detail = num(o.independentEventCount) != null
    ? {
      count: num(o.independentEventCount),
      gap_basis: o.independentEventGapBasis || 'CALLER_PROVIDED',
      gap_threshold_used: minWindow,
      cluster_key: 'caller_provided',
      unique_clusters: null,
      events_considered: list.length,
      min_gap_days: minWindow,
      trading_calendar_days: Array.isArray(o.tradingCalendar) ? o.tradingCalendar.length : 0
    }
    : countIndependentEventsDetailed(list, { minGapDays: minWindow, tradingCalendar: o.tradingCalendar });
  const independent = detail.count;

  const withFwd = list.filter((e) => num(e.fwd_excess_20d) != null);
  const rollingAlpha = mean(withFwd.map((e) => Number(e.fwd_excess_20d)));
  const falseFastPathRate = withFwd.length
    ? withFwd.filter((e) => Number(e.fwd_excess_20d) < 0).length / withFwd.length
    : null;
  const calibrationDrift = num(o.calibrationDrift);
  const basisNote = detail.gap_basis === 'TRADING_DAYS'
    ? `独立事件 ${independent}（${detail.gap_basis}，日历 ${detail.trading_calendar_days} 日）`
    : `独立事件 ${independent}（⚠️ ${detail.gap_basis}：未提供交易日历，按 ${detail.gap_threshold_used} 自然日保守阈值，fail-closed）`;

  const base = {
    rolling_alpha: rollingAlpha,
    false_fast_path_rate: falseFastPathRate,
    calibration_drift: calibrationDrift,
    event_count: list.length,
    independent_event_count: independent,
    independent_event_gap_basis: detail.gap_basis,
    independent_event_detail: detail,
    min_events: minEvents,
    evaluated_at: o.now || new Date().toISOString()
  };

  // ★ 样本不足 → PENDING（不得 OK）
  if (independent < minEvents) {
    return Object.assign(base, {
      status: STATUS.PENDING,
      reason_code: 'ECONOMIC_SAMPLE_INSUFFICIENT',
      reason: `${basisNote} < ${minEvents}，无法判定经济健康（PENDING，不以 OK 冒充）`
    });
  }

  if (rollingAlpha != null && rollingAlpha < 0) {
    return Object.assign(base, {
      status: STATUS.DEGRADED,
      reason_code: 'ECONOMIC_ALPHA_NEGATIVE',
      reason: `${basisNote}；滚动增量 alpha ${rollingAlpha.toFixed(5)} < 0`
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
    reason: `${basisNote} 且滚动增量 alpha 非负`
  });
}

module.exports = {
  STATUS,
  DEFAULT_MIN_EVENTS,
  DEFAULT_MIN_WINDOW_DAYS,
  aggregateEconomicHealth,
  countIndependentEvents,
  countIndependentEventsDetailed,
  clusterKeyOf
};
