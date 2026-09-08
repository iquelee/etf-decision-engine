/**
 * 复盘统计：决策快照与实际成交的日级对照。
 *
 * 每笔成交最多关联一条决策：优先关联同向、最近的可执行建议；没有同向可执行
 * 建议时，才关联最近的日级建议并标为「自主调整」。这样不会把同一笔成交重复
 * 记到连续多天的 HOLD / WAIT 上，也不会把人工参考系统误写成“违背”。
 */
'use strict';

const { daysBetween } = require('./review-position');

const BUY_ACTIONS = ['ADD', 'BUILD'];
const SELL_ACTIONS = ['TACTICAL_REDUCE', 'STRATEGIC_REDUCE', 'EXIT'];
const WINDOW_DAYS = 5;

function isBuyAction(a) { return BUY_ACTIONS.indexOf(a) >= 0; }
function isSellAction(a) { return SELL_ACTIONS.indexOf(a) >= 0; }
function isActionable(a) { return isBuyAction(a) || isSellAction(a); }

function decisionKey(d, index) {
  return d && d._id ? String(d._id) : `${d && d.code}|${d && d.decision_date}|${index}`;
}

function sortNewestFirst(rows) {
  return rows.slice().sort((a, b) => String(b.decision_date).localeCompare(String(a.decision_date)));
}

function firstLink(links, action) {
  const matches = links.filter((link) => !action || link.trade.action === action)
    .sort((a, b) => String(a.trade.trade_date).localeCompare(String(b.trade.trade_date)));
  return matches[0] || null;
}

/**
 * 一笔成交只归属一条建议。没有精确 decision_id 时，先找同向的可执行建议，
 * 避免次日 WAIT/HOLD 覆盖前一日的建仓/减仓指令。
 */
function linkTradesToDecisions(decisions, trades, windowDays) {
  const rows = (decisions || []).map((d, index) => ({ ...d, __review_key: decisionKey(d, index) }));
  const byId = new Map(rows.filter((d) => d._id).map((d) => [String(d._id), d]));
  const links = new Map(rows.map((d) => [d.__review_key, []]));

  (trades || []).filter((t) => t && t.code && t.trade_date && (t.action === 'buy' || t.action === 'sell'))
    .slice()
    .sort((a, b) => String(a.trade_date).localeCompare(String(b.trade_date)))
    .forEach((trade) => {
      let selected = trade.decision_id ? byId.get(String(trade.decision_id)) : null;
      let matchedBy = selected ? 'decision_id' : null;
      if (!selected) {
        const candidates = sortNewestFirst(rows.filter((d) => {
          if (d.code !== trade.code || !d.decision_date) return false;
          const gap = daysBetween(d.decision_date, trade.trade_date);
          return gap != null && gap >= 0 && gap <= windowDays;
        }));
        const sameDirectionActionable = candidates.filter((d) => (
          (trade.action === 'buy' && isBuyAction(d.final_action))
          || (trade.action === 'sell' && isSellAction(d.final_action))
        ));
        selected = sameDirectionActionable[0] || candidates[0] || null;
        matchedBy = selected
          ? (sameDirectionActionable.length ? 'same_direction_actionable' : 'nearest_daily_decision')
          : null;
      }
      if (!selected || !links.has(selected.__review_key)) return;
      links.get(selected.__review_key).push({
        trade,
        days: daysBetween(selected.decision_date, trade.trade_date),
        matched_by: matchedBy
      });
    });
  return { rows, links };
}

function classifyDecision(d, links) {
  const related = links || [];
  const desiredAction = isBuyAction(d.final_action) ? 'buy' : (isSellAction(d.final_action) ? 'sell' : null);
  const same = desiredAction ? firstLink(related, desiredAction) : null;
  const opposite = desiredAction ? firstLink(related, desiredAction === 'buy' ? 'sell' : 'buy') : null;
  const first = firstLink(related);

  if (desiredAction) {
    if (same) return { result: '已执行', days: same.days, link: same, actionable: true };
    if (opposite) return { result: '反向操作', days: opposite.days, link: opposite, actionable: true };
    return { result: '未执行', days: null, link: null, actionable: true };
  }
  if (first) return { result: '自主调整', days: first.days, link: first, actionable: false };
  return { result: null, days: null, link: null, actionable: false };
}

function pct(numerator, denominator) {
  return denominator ? Math.round((numerator / denominator) * 100) : null;
}

function computeReviewStats(decisions, trades, windowDays) {
  const win = windowDays != null ? windowDays : WINDOW_DAYS;
  const { rows, links } = linkTradesToDecisions(decisions, trades, win);
  const deviations = [];
  const classified = rows.map((d) => ({ d, c: classifyDecision(d, links.get(d.__review_key)) }));

  let executed = 0;
  let reversed = 0;
  let unexecuted = 0;
  let independent = 0;
  const responseDays = [];
  const buyRows = classified.filter(({ d }) => isBuyAction(d.final_action));
  const sellRows = classified.filter(({ d }) => isSellAction(d.final_action));

  classified.forEach(({ d, c }) => {
    if (c.result) {
      deviations.push({
        decision_id: d._id,
        code: d.code,
        date: d.decision_date,
        system_action: d.final_action,
        actual_action: c.link && c.link.trade.action ? c.link.trade.action : null,
        operation_date: c.link && c.link.trade.trade_date ? c.link.trade.trade_date : null,
        response_days: c.days,
        matched_by: c.link ? c.link.matched_by : null,
        deviation: c.result
      });
    }
    if (!c.actionable) {
      if (c.result === '自主调整') independent += 1;
      return;
    }
    if (c.result === '已执行') executed += 1;
    if (c.result === '反向操作') reversed += 1;
    if (c.result === '未执行') unexecuted += 1;
    if (c.days != null) responseDays.push(c.days);
  });

  const actionableCount = buyRows.length + sellRows.length;
  const buyExecuted = buyRows.filter(({ c }) => c.result === '已执行').length;
  const sellExecuted = sellRows.filter(({ c }) => c.result === '已执行').length;
  const executionRate = pct(executed, actionableCount);
  const buildExecutionRate = pct(buyExecuted, buyRows.length);
  const defenseExecutionRate = pct(sellExecuted, sellRows.length);
  const avgResponseDays = responseDays.length
    ? Math.round(responseDays.reduce((sum, days) => sum + days, 0) / responseDays.length)
    : null;

  return {
    deviations: deviations.sort((a, b) => String(b.date).localeCompare(String(a.date))),
    stats: {
      decision_snapshot_count: rows.length,
      actionable_count: actionableCount,
      execution_rate: executionRate,
      reverse_operation_count: reversed,
      unexecuted_count: unexecuted,
      independent_operation_count: independent,
      build_execution_rate: buildExecutionRate,
      defense_execution_rate: defenseExecutionRate,
      avg_response_days: avgResponseDays,
      // 保留旧字段供已发布客户端读取；语义与新字段一致，不再将自主调整计为违背。
      signal_count: rows.length,
      follow_rate: executionRate,
      violate_count: reversed,
      add_hit_rate: buildExecutionRate,
      defense_timely_rate: defenseExecutionRate,
      avg_deviation_days: avgResponseDays
    }
  };
}

module.exports = {
  WINDOW_DAYS,
  isBuyAction,
  isSellAction,
  linkTradesToDecisions,
  computeReviewStats
};
