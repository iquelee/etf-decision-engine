/**
 * 回测市值重标（对照，不改决策）：同一笔调仓按当时净值买/卖份额，
 * 之后仓位%随行情漂移，现金（元）不随行情变。
 */
'use strict';

function createMtmBook(nav) {
  return { holdings: {}, cash: nav == null ? 100 : nav };
}

function sumHoldings(holdings) {
  let s = 0;
  Object.keys(holdings || {}).forEach((c) => { s += holdings[c] || 0; });
  return s;
}

function mtmNav(book) {
  return sumHoldings(book.holdings) + (book.cash || 0);
}

function mtmBookPct(book) {
  const nav = mtmNav(book);
  if (!(nav > 0)) return 0;
  return (sumHoldings(book.holdings) / nav) * 100;
}

function mtmWeights(book) {
  const nav = mtmNav(book);
  const w = {};
  Object.keys(book.holdings || {}).forEach((c) => {
    w[c] = nav > 0 ? Math.round((book.holdings[c] / nav) * 1000) / 10 : 0;
  });
  return w;
}

/** 按粘性仓位变动 pct（百分点）买卖：花费 pct/100 × 当时净值。 */
function applyMtmTrades(book, trades, nav0) {
  const nav = nav0 != null ? nav0 : mtmNav(book);
  if (!(nav > 0) || !trades || !trades.length) return;
  for (const t of trades) {
    const pct = Number(t.pct);
    if (!t.code || !pct) continue;
    const yuan = (pct / 100) * nav;
    book.holdings[t.code] = (book.holdings[t.code] || 0) + yuan;
    book.cash -= yuan;
  }
}

function markMtmHoldings(holdings, prevCloses, todayCloses) {
  Object.keys(holdings || {}).forEach((code) => {
    const c0 = prevCloses && prevCloses[code];
    const c1 = todayCloses && todayCloses[code];
    if (c0 == null || c1 == null || c0 === 0 || !holdings[code]) return;
    holdings[code] *= c1 / c0;
  });
}

/**
 * 一日：先按与引擎相同的调仓票据买卖，再按收盘/昨收标市值，最后扣日成本（占开盘净值比例）。
 */
function stepMtm(book, trades, prevCloses, todayCloses, dayCost) {
  const nav0 = mtmNav(book);
  applyMtmTrades(book, trades, nav0);
  markMtmHoldings(book.holdings, prevCloses, todayCloses);
  if (dayCost) book.cash -= dayCost * nav0;
  const nav1 = mtmNav(book);
  return {
    nav: nav1,
    book: mtmBookPct(book),
    cash: book.cash,
    weights: mtmWeights(book)
  };
}

module.exports = {
  createMtmBook, mtmNav, mtmBookPct, mtmWeights,
  applyMtmTrades, markMtmHoldings, stepMtm
};
