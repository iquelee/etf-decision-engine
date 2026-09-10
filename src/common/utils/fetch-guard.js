/**
 * 抓取闸门纯函数（无 DB / 无 cloudbase），供云函数与单测共用。
 *
 * V3.1：`isIntraday` 禁止在测试里复制函数体。
 *
 * WP-G1-DATA-02：**把「字段完整」与「已收盘定稿」拆成两个概念** ——
 *   ① `isStructurallyValidDailyBar()` 结构有效（volume>0 && close>0）
 *   ② `isFinalizedDailyBar()`         可当正式 EOD 使用（结构有效 + 交易日已定稿）
 * 腾讯 `fqkline` 在**盘中**就会返回当日 bar 且 volume>0，所以「有成交量」**不能**证明
 * 「已收盘定稿」。旧名 `isOfficialDailyBar` 只是 ① 的名字，保留为别名，**不得**再用于
 * 「定稿」语义。
 *
 * 定稿规则：
 *   - `trade_date < today`  → 历史 bar，天然定稿
 *   - `trade_date == today` → 必须带落库时写入的 `is_final === true` 标记
 *     （只有过了 `DAILY_BAR_FINALIZATION_CUTOFF` 才允许写当日 bar 并打这个标记，
 *      因此**盘中误写入的当日 bar 永远不会被当作定稿**，会被下一次抓取覆盖）
 *
 * @module fetch-guard
 */
'use strict';

function beijingNow() { return new Date(Date.now() + 8 * 3600 * 1000); }
function beijingDateStr(d) { return (d || beijingNow()).toISOString().slice(0, 10); }

/**
 * 判断是否盘中（9:00-15:05 北京时间）。
 * beijingNow() 已 +8h，Date 内部 UTC 字段即北京时间，只读 getUTCHours()。
 */
function isIntraday(d) {
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const t = h * 60 + m;
  return t >= 9 * 60 && t <= 15 * 60 + 5;
}

/** A 股日线定稿时点（北京时间 HH:MM）——早于它认为当日 bar 尚未定稿。 */
const DAILY_BAR_FINALIZATION_CUTOFF = '15:30';

/** '15:30' → 930（分钟数）；非法输入回退 15:30。 */
function cutoffMinutes(value) {
  const s = String(value == null ? DAILY_BAR_FINALIZATION_CUTOFF : value);
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 15 * 60 + 30;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 北京时间的当日分钟数（beijingNow 的 UTC 字段即北京时间）。 */
function beijingMinutes(d) {
  const x = d || beijingNow();
  return x.getUTCHours() * 60 + x.getUTCMinutes();
}

/** 结构有效：必须有成交量与收盘价。**注意：这不代表当日 bar 已收盘定稿。** */
function isStructurallyValidDailyBar(row) {
  if (!row) return false;
  const vol = Number(row.volume);
  const close = Number(row.close);
  return Number.isFinite(vol) && vol > 0 && Number.isFinite(close) && close > 0;
}

/** @deprecated 旧名，等价于 `isStructurallyValidDailyBar`；「是否定稿」请用 `isFinalizedDailyBar`。 */
const isOfficialDailyBar = isStructurallyValidDailyBar;

/**
 * 该行是否可当**正式（已定稿）**日线使用。
 *
 * @param {object} row
 * @param {object} [opts]
 * @param {string} [opts.today]  北京当日 YYYY-MM-DD（默认取当前）
 * @returns {boolean}
 */
function isFinalizedDailyBar(row, opts) {
  if (!isStructurallyValidDailyBar(row)) return false;
  const date = row.trade_date == null ? '' : String(row.trade_date).slice(0, 10);
  if (!date) return false;
  const today = (opts && opts.today) ? String(opts.today).slice(0, 10) : beijingDateStr(beijingNow());
  if (date < today) return true;                 // 历史 bar 天然定稿
  if (date === today) return row.is_final === true; // 当日必须有落库定稿标记
  return false;                                  // 未来日期不认
}

/**
 * 该 bar 现在是否允许写入 etf_daily。
 *   - 历史（trade_date < today）→ 允许（盘中也可安全回补历史）
 *   - 当日（trade_date == today）→ 仅当已过 `DAILY_BAR_FINALIZATION_CUTOFF`
 *
 * @param {object} bar  形如 { trade_date, ... }
 * @param {object} [opts]
 * @param {string} [opts.today]
 * @param {number} [opts.nowMinutes] 北京当日分钟数（默认取当前）
 * @param {string|number} [opts.cutoff] 定稿时点（'15:30' 或分钟数）
 * @returns {boolean}
 */
function isBarWritable(bar, opts) {
  const o = opts || {};
  const date = bar && bar.trade_date != null ? String(bar.trade_date).slice(0, 10) : '';
  if (!date) return false;
  const today = o.today ? String(o.today).slice(0, 10) : beijingDateStr(beijingNow());
  if (date < today) return true;
  if (date > today) return false;
  const nowMin = o.nowMinutes != null ? Number(o.nowMinutes) : beijingMinutes(beijingNow());
  const cut = typeof o.cutoff === 'number' ? o.cutoff : cutoffMinutes(o.cutoff);
  return Number.isFinite(nowMin) && nowMin >= cut;
}

function clampConfidence(v, fallback = 0.6) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

module.exports = {
  beijingNow,
  beijingDateStr,
  isIntraday,
  DAILY_BAR_FINALIZATION_CUTOFF,
  cutoffMinutes,
  beijingMinutes,
  isStructurallyValidDailyBar,
  isOfficialDailyBar,
  isFinalizedDailyBar,
  isBarWritable,
  clampConfidence
};
