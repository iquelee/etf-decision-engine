/**
 * 实盘总资产分母：持股市值 + 现金（元）。
 * 现金只随买卖变，不随行情变；行情只改市值。不在这里拒加仓。
 */
'use strict';

function roundMoney(n) {
  if (n == null || Number.isNaN(Number(n))) return null;
  return Math.round(Number(n) * 100) / 100;
}

function tradeAmount(t) {
  if (!t) return 0;
  const amt = Number(t.amount);
  if (amt) return amt;
  return (Number(t.shares) || 0) * (Number(t.price) || 0);
}

/** 一笔成交对现金的影响：买减少、卖增加。 */
function cashDeltaFromTrade(t) {
  if (!t) return 0;
  const amt = tradeAmount(t);
  if (t.action === 'buy') return -amt;
  if (t.action === 'sell') return amt;
  return 0;
}

function snapshotHoldingsMv(snapshot) {
  if (!snapshot) return null;
  if (snapshot.holdings_mv != null && !Number.isNaN(Number(snapshot.holdings_mv))) {
    return Number(snapshot.holdings_mv);
  }
  const pos = snapshot.positions || [];
  let sum = 0;
  let any = false;
  for (const p of pos) {
    if (p && p.value != null && !Number.isNaN(Number(p.value))) {
      sum += Number(p.value);
      any = true;
    }
  }
  return any ? sum : null;
}

/**
 * 还原现金（已含本笔 cashDelta，即成交后现金）。
 * 优先用已落库的 cash_balance（元，粘性）；否则用上次总资产 − 上次持股市值。
 * 两者都没有时：用录入总资产 − 当前市值反推（首次会得到「分母仍等于旧总资产」）。
 */
function resolveCashYuan(input) {
  const seed = input.seedTotalAsset;
  const lastMv = input.lastHoldingsMv;
  const currentMv = input.currentHoldingsMv;
  const cashDelta = input.cashDelta || 0;
  let cash;
  if (input.cashBalance != null && !Number.isNaN(Number(input.cashBalance))) {
    cash = Number(input.cashBalance);
  } else if (seed != null && lastMv != null) {
    cash = Number(seed) - Number(lastMv);
  } else if (seed != null && currentMv != null) {
    cash = Number(seed) - Number(currentMv) - cashDelta;
  } else {
    return null;
  }
  return roundMoney(cash + cashDelta);
}

function holdingsMarketValue(holdings, prices) {
  let total = 0;
  const per = {};
  Object.keys(holdings || {}).forEach((code) => {
    const shares = Math.max(0, (holdings[code] && holdings[code].shares) || 0);
    const price = prices && prices[code] != null ? Number(prices[code]) : 0;
    const value = shares * (price > 0 ? price : 0);
    per[code] = { shares, price: price > 0 ? price : null, value };
    total += value;
  });
  return { total: roundMoney(total), per };
}

function liveTotalAsset(holdingsMv, cashYuan) {
  if (holdingsMv == null || cashYuan == null) return null;
  return roundMoney(Number(holdingsMv) + Number(cashYuan));
}

/** 仓位% = 该票市值 / 活分母 × 100，1 位小数。 */
function positionPct(marketValue, totalAsset) {
  if (totalAsset == null || Number(totalAsset) <= 0) return null;
  return Math.round((Number(marketValue) / Number(totalAsset)) * 1000) / 10;
}

module.exports = {
  roundMoney,
  tradeAmount,
  cashDeltaFromTrade,
  snapshotHoldingsMv,
  resolveCashYuan,
  holdingsMarketValue,
  liveTotalAsset,
  positionPct
};
