/**
 * 成交还原（纯函数）：平均成本法依赖时间顺序，查询结果必须先排再算。
 */
'use strict';

function sortTradesAsc(trades) {
  return (trades || []).slice().sort((a, b) => {
    const da = String(a.trade_date || '');
    const dbv = String(b.trade_date || '');
    if (da !== dbv) return da < dbv ? -1 : 1;
    const ca = a.created_at ? new Date(a.created_at).getTime() : 0;
    const cb = b.created_at ? new Date(b.created_at).getTime() : 0;
    if (ca !== cb) return ca - cb;
    return String(a._id || '') < String(b._id || '') ? -1 : 1;
  });
}

/** 按时间正序回放：buy 加权成本，sell 扣份额、成本不变。 */
function replayAverageCost(trades) {
  const holdings = {};
  for (const t of sortTradesAsc(trades)) {
    const shares = Number(t.shares);
    const price = Number(t.price);
    if (!shares || !price || shares <= 0 || price <= 0) continue;
    const h = holdings[t.code] || (holdings[t.code] = { shares: 0, avgCost: 0 });
    if (t.action === 'buy') {
      const totalCost = h.shares * h.avgCost + shares * price;
      h.shares += shares;
      h.avgCost = h.shares > 0 ? totalCost / h.shares : 0;
    } else if (t.action === 'sell') {
      h.shares = Math.max(0, h.shares - shares);
      if (h.shares === 0) h.avgCost = 0;
    }
  }
  return holdings;
}

/** 未实现盈亏：持仓市值 − 成本。缺价的票跳过。 */
function unrealizedPnl(holdings, prices) {
  let total = 0;
  let any = false;
  Object.keys(holdings || {}).forEach((code) => {
    const h = holdings[code];
    if (!h || !(h.shares > 0) || h.avgCost == null) return;
    const px = prices && prices[code];
    if (px == null || !(Number(px) > 0)) return;
    any = true;
    total += h.shares * Number(px) - h.shares * h.avgCost;
  });
  if (!any) return null;
  return Math.round(total * 100) / 100;
}

module.exports = { sortTradesAsc, replayAverageCost, unrealizedPnl };
