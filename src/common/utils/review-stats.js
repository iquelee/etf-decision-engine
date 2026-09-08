/**
 * 复盘统计：系统建议 vs 成交。
 * 可执行信号（建仓/加仓/减仓/清仓）用 5 日窗，与加仓命中、防守及时同一口径。
 * 等待/持有当天的成交，若已被更早的可执行信号认领，不再单独记一笔「未执行」。
 */
const { daysBetween } = require('./review-position');

const BUY_ACTIONS = ['ADD', 'BUILD'];
const SELL_ACTIONS = ['TACTICAL_REDUCE', 'STRATEGIC_REDUCE', 'EXIT'];
const WINDOW_DAYS = 5;

function isBuyAction(a) { return BUY_ACTIONS.indexOf(a) >= 0; }
function isSellAction(a) { return SELL_ACTIONS.indexOf(a) >= 0; }
function isActionable(a) { return isBuyAction(a) || isSellAction(a); }

function tradesInWindow(trades, code, date, windowDays) {
  return (trades || []).filter((t) => {
    if (!t || t.code !== code || !t.trade_date) return false;
    const diff = daysBetween(date, t.trade_date);
    return diff != null && diff >= 0 && diff <= windowDays;
  });
}

function firstMatchDays(related, action, date) {
  const hits = related.filter((t) => t.action === action)
    .slice()
    .sort((a, b) => String(a.trade_date).localeCompare(String(b.trade_date)));
  if (!hits.length) return null;
  return daysBetween(date, hits[0].trade_date);
}

function claimedByPriorActionable(d, decisions, trades, windowDays) {
  return (decisions || []).some((o) => {
    if (!o || o.code !== d.code || !o.decision_date || o.decision_date >= d.decision_date) return false;
    const gap = daysBetween(o.decision_date, d.decision_date);
    if (gap == null || gap > windowDays) return false;
    const related = tradesInWindow(trades, o.code, o.decision_date, windowDays);
    if (isSellAction(o.final_action) && related.some((t) => t.action === 'sell')) return true;
    if (isBuyAction(o.final_action) && related.some((t) => t.action === 'buy')) return true;
    return false;
  });
}

function classifyDecision(d, decisions, trades, windowDays) {
  const related = tradesInWindow(trades, d.code, d.decision_date, windowDays);
  const hasBuy = related.some((t) => t.action === 'buy');
  const hasSell = related.some((t) => t.action === 'sell');
  if (isBuyAction(d.final_action)) {
    if (hasBuy) return { deviation: '跟随', days: firstMatchDays(related, 'buy', d.decision_date), include: true, actionable: true };
    if (hasSell) return { deviation: '违背', days: firstMatchDays(related, 'sell', d.decision_date), include: true, actionable: true };
    return { deviation: '未执行', days: null, include: true, actionable: true };
  }
  if (isSellAction(d.final_action)) {
    if (hasSell) return { deviation: '跟随', days: firstMatchDays(related, 'sell', d.decision_date), include: true, actionable: true };
    if (hasBuy) return { deviation: '违背', days: firstMatchDays(related, 'buy', d.decision_date), include: true, actionable: true };
    return { deviation: '未执行', days: null, include: true, actionable: true };
  }
  if ((hasBuy || hasSell) && !claimedByPriorActionable(d, decisions, trades, windowDays)) {
    const want = hasBuy ? 'buy' : 'sell';
    return { deviation: '违背', days: firstMatchDays(related, want, d.decision_date), include: true, actionable: false };
  }
  return { deviation: null, days: null, include: false, actionable: false };
}

function hitRate(decisions, trades, pred, action, windowDays) {
  const rows = (decisions || []).filter((d) => pred(d.final_action));
  if (!rows.length) return null;
  const hit = rows.filter((d) => tradesInWindow(trades, d.code, d.decision_date, windowDays)
    .some((t) => t.action === action));
  return Math.round((hit.length / rows.length) * 100);
}

function computeReviewStats(decisions, trades, windowDays) {
  const win = windowDays != null ? windowDays : WINDOW_DAYS;
  const rows = decisions || [];
  const deviations = [];
  let followed = 0;
  let violated = 0;
  const daySamples = [];
  rows.forEach((d) => {
    const c = classifyDecision(d, rows, trades, win);
    if (c.include) {
      deviations.push({
        decision_id: d._id,
        code: d.code,
        date: d.decision_date,
        system_action: d.final_action,
        trade_count: tradesInWindow(trades, d.code, d.decision_date, win).length,
        deviation: c.deviation
      });
    }
    if (c.actionable && c.deviation === '跟随') followed += 1;
    if (c.deviation === '违背') violated += 1;
    if (c.include && c.days != null) daySamples.push(c.days);
  });
  const actionableN = rows.filter((d) => isActionable(d.final_action)).length;
  return {
    deviations,
    stats: {
      signal_count: rows.length,
      follow_rate: actionableN ? Math.round((followed / actionableN) * 100) : null,
      violate_count: violated,
      add_hit_rate: hitRate(rows, trades, isBuyAction, 'buy', win),
      defense_timely_rate: hitRate(rows, trades, isSellAction, 'sell', win),
      avg_deviation_days: daySamples.length
        ? Math.round(daySamples.reduce((s, x) => s + x, 0) / daySamples.length)
        : null
    }
  };
}

module.exports = {
  WINDOW_DAYS,
  isBuyAction,
  isSellAction,
  computeReviewStats
};
