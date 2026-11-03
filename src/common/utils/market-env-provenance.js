/**
 * V3.6.5 Production Integrity —— P-2：market_env 日期 provenance（adapter）
 *
 * 背景（V3.6.5 只读审计 §14 / P-2，判定 = **CLOSED**）：
 *   `market_env` 行的日期**确实存在可取**，只是当前生产路径没读：
 *     - `weekly_bars[].date`   —— 每根周线的日期（首选）
 *     - 行级 `trade_date`      —— 兜底（若存在）
 *   ⚠️ 已知坑：
 *     - 最后一根周线往往是**当周未走完的 partial bar**；
 *     - producer 侧存在「无数据时按当前日期回退」的编造分支；
 *     - `daysBetween()` 算的是**自然日**，却被当 `trade_days` 用。
 *
 * 本模块（P-2 裁定）：
 *   - 用 `weekly_bars[].date` 建立 adapter，推导 `market_env_as_of_date`；
 *   - **显式标记** `market_env_partial_week`（允许 partial，但不得静默）；
 *   - `trade_day_lag` 必须用 `cn-trading-calendar.js` 的**交易日**口径计算；
 *     calendar 不可用时返回 `null` + `lag_basis='UNAVAILABLE'`，
 *     ⛔ **绝不用自然日差冒充交易日差**（自然日差只作为标注清楚的诊断字段）；
 *   - `market_env` 是 **optional** 源 ⇒ 不因此 BLOCK 完整 run。
 *
 * 纯函数模块：无网络、无数据库。
 */
'use strict';

const { countTradeDays, isTradingDay, shiftDate, weekdayOf, loadCalendar } = require('./cn-trading-calendar.js');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isDate(v) {
  return typeof v === 'string' && DATE_RE.test(v);
}

function daysBetween(a, b) {
  if (!isDate(a) || !isDate(b)) return null;
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return null;
  return Math.round((tb - ta) / 86400000);
}

/** 取行内的日期序列（优先 weekly_bars[].date，其次行级 trade_date） */
function extractBarDates(row) {
  const bars = (row && Array.isArray(row.weekly_bars)) ? row.weekly_bars : [];
  const dates = bars
    .map((b) => (b && (b.date != null ? b.date : b.trade_date)))
    .filter(isDate);
  if (dates.length) return { dates, origin: 'weekly_bars[].date' };
  if (row && isDate(row.trade_date)) return { dates: [row.trade_date], origin: 'row.trade_date' };
  return { dates: [], origin: null };
}

/**
 * 该 bar 日期所在周的最后一个交易日（用于判断「当周是否走完」）。
 * 无 calendar 时退化为自然周（周六），并标注 basis。
 */
function weekEndOf(dateStr, calendar) {
  const cal = calendar && calendar.valid !== undefined ? calendar : loadCalendar(calendar);
  let cur = dateStr;
  for (let i = 0; i < 7; i++) {
    const nxt = shiftDate(cur, 1);
    if (!nxt) break;
    const w = weekdayOf(nxt);
    if (cal && cal.valid && cal.coverage && cal.coverage.seeded) {
      // 有权威日历：该周的最后一个交易日
      if (w === 1) return cur;                        // 走到下周一 ⇒ 上一个才是周末边界
    } else if (w === 6 || w === 0) {
      return cur;                                      // 退化：自然周（到周六为止）
    }
    cur = nxt;
  }
  return cur;
}

/**
 * 由 market_env 行集合推导 provenance。
 *
 * @param {Array<object>} envRows market_env 集合行（含 weekly_bars）
 * @param {object} [opts]
 *   - reference_date {string} 参照日（应传 expected/effective as_of_trade_date）
 *   - calendar       {object} CN 交易日历（用于 trade-day lag 与 partial 判定）
 * @returns {object}
 */
function resolveMarketEnvProvenance(envRows, opts) {
  const o = opts || {};
  const rows = Array.isArray(envRows) ? envRows : [];
  const ref = isDate(o.reference_date) ? o.reference_date : null;
  const cal = o.calendar || null;
  const calUsable = !!(cal && cal.valid && countTradeDays('2026-01-01', '2026-01-01', cal) === 0);

  const perIndex = [];
  rows.forEach((row) => {
    const idx = row && row.index_code != null ? String(row.index_code) : null;
    const { dates, origin } = extractBarDates(row);
    const sorted = dates.slice().sort();
    const last = sorted.length ? sorted[sorted.length - 1] : null;

    let partial = null;
    if (last && ref) {
      const wEnd = weekEndOf(last, cal);
      partial = wEnd != null ? wEnd > ref : null;
    }

    const tradeLag = (last && ref && calUsable) ? countTradeDays(last, ref, cal) : null;
    const naturalLag = (last && ref) ? daysBetween(last, ref) : null;

    perIndex.push({
      index_code: idx,
      bar_count: sorted.length,
      date_origin: origin,
      first_bar_date: sorted.length ? sorted[0] : null,
      market_env_as_of_date: last,
      market_env_partial_week: partial,
      trade_day_lag: tradeLag,
      natural_day_lag_diagnostic: naturalLag,
      lag_basis: tradeLag != null ? 'calendar_trade_days' : 'UNAVAILABLE'
    });
  });

  const allLast = perIndex.map((p) => p.market_env_as_of_date).filter(isDate).sort();
  const asOf = allLast.length ? allLast[allLast.length - 1] : null;
  const oldest = allLast.length ? allLast[0] : null;
  const anyPartial = perIndex.some((p) => p.market_env_partial_week === true);
  const tradeLagAgg = (asOf && ref && calUsable) ? countTradeDays(asOf, ref, cal) : null;

  return {
    per_index: perIndex,
    index_count: perIndex.length,
    market_env_as_of_date: asOf,
    oldest_index_as_of_date: oldest,
    market_env_partial_week: anyPartial,
    partial_week_known: perIndex.some((p) => p.market_env_partial_week != null),
    trade_day_lag: tradeLagAgg,
    natural_day_lag_diagnostic: (asOf && ref) ? daysBetween(asOf, ref) : null,
    lag_basis: tradeLagAgg != null ? 'calendar_trade_days' : 'UNAVAILABLE',
    reference_date: ref,
    // ⛔ 自然日差只作诊断，不得作为 freshness policy 依据
    natural_day_lag_usable_for_policy: false,
    optional_source: true,
    blocks_run: false
  };
}

/** 判断某个具体日期在给定日历下是否为交易日（供调用侧自检用） */
function isCalendarTradingDay(dateStr, calendar) {
  return isTradingDay(dateStr, calendar);
}

module.exports = {
  isDate,
  daysBetween,
  extractBarDates,
  weekEndOf,
  resolveMarketEnvProvenance,
  isCalendarTradingDay
};
