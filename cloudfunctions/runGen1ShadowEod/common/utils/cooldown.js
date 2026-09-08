/**
 * 加仓冷静期（公共模块）：runDecisionEngine 与 apiGateway 共用。
 * - runDecisionEngine：决策时计算并写入 decision_result.cooldown_days（决策日口径）
 * - apiGateway：前台展示时用「北京今天」实时重算，避免展示决策快照里的历史值
 *   （决策 data_time 滞后于当前日期时，快照里的冷静期会过期，导致黄条误导）
 */

'use strict';

const { COLLECTIONS, COOLDOWN_DAYS, DEFAULT_PARAMS } = require('../constants');

function daysBetween(a, b) {
  if (!a || !b) return null;
  const da = new Date(a);
  const db = new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return null;
  return Math.round((db.getTime() - da.getTime()) / (24 * 3600 * 1000));
}

/** 上次买入当时的 add_mode（优先 trade_log.add_mode，回退当日决策的 add_mode） */
async function resolveLastBuyAddMode(db, code, lastBuyRow, fallback) {
  if (lastBuyRow && lastBuyRow.add_mode) return lastBuyRow.add_mode;
  const buyDate = lastBuyRow && lastBuyRow.trade_date;
  if (buyDate) {
    const dec = await db.query(COLLECTIONS.DECISION_RESULT, { code, decision_date: buyDate }, { limit: 1 });
    if (dec.length && dec[0].add_mode) return dec[0].add_mode;
  }
  return fallback || '无';
}

/**
 * 距最近一次买入的剩余冷静交易日数。
 * V3.1 A4：冷静期长度看上次买入当时的 add_mode，不看今天探针模式。
 * B6 自适应：普通横盘 2 日 / 突破加仓 5 日 / 默认参数 cooldown_days。
 * @param {object} db db 封装（query/upsert）
 * @param {string} code ETF 代码
 * @param {string} today YYYY-MM-DD（计算口径日：决策用数据日，前台展示用北京今天）
 * @param {object} params 合并后的引擎参数（merged，含 cooldown_days）
 * @param {string} fallbackAddMode 兜底 add_mode（无记录时用）
 */
async function computeCooldownDays(db, code, today, params = {}, fallbackAddMode = '无') {
  const rows = await db.query(COLLECTIONS.TRADE_LOG, { code, action: 'buy' }, {
    orderBy: [{ field: 'trade_date', direction: 'desc' }], limit: 1
  });
  if (rows.length === 0) return 0;
  const addMode = await resolveLastBuyAddMode(db, code, rows[0], fallbackAddMode);
  const cooldownDays = addMode === '突破加仓' ? 5
    : (addMode !== '无' ? 2
      : (params.cooldown_days != null ? params.cooldown_days
        : (DEFAULT_PARAMS.cooldown_days != null ? DEFAULT_PARAMS.cooldown_days : COOLDOWN_DAYS)));
  const lastBuy = rows[0].trade_date;

  const dailyRows = await db.query(COLLECTIONS.ETF_DAILY, { code }, {
    orderBy: [{ field: 'trade_date', direction: 'asc' }]
  });
  if (dailyRows.length === 0) {
    // 无日线数据回退自然日
    const d = daysBetween(lastBuy, today);
    return d == null ? 0 : Math.max(0, cooldownDays - d);
  }
  const tradingDays = new Set();
  for (const r of dailyRows) {
    if (r.trade_date > lastBuy && r.trade_date <= today) tradingDays.add(r.trade_date);
  }
  return Math.max(0, cooldownDays - tradingDays.size);
}

module.exports = { computeCooldownDays, resolveLastBuyAddMode, daysBetween };
