/**
 * V3.0 v1.1 P6 — 科技票相关性 TechCap 折扣（§B1）
 */
'use strict';

const TECH_CORR_PAIRS = [
  ['513310', '159582'],
  ['513310', '515880'],
  ['159582', '515880']
];

const DEFAULT_WINDOW = 60;

function dailyReturns(closes) {
  const rets = [];
  for (let i = 1; i < closes.length; i += 1) {
    const prev = closes[i - 1];
    const cur = closes[i];
    if (prev == null || cur == null || prev <= 0) continue;
    rets.push((cur - prev) / prev);
  }
  return rets;
}

/** Pearson ρ on aligned return series */
function calcCorrelation(returns1, returns2, window) {
  const w = window != null ? window : DEFAULT_WINDOW;
  if (!returns1 || !returns2 || !returns1.length || !returns2.length) return null;
  const n = Math.min(returns1.length, returns2.length, w);
  if (n < 10) return null;
  const r1 = returns1.slice(-n);
  const r2 = returns2.slice(-n);
  const m1 = r1.reduce((s, v) => s + v, 0) / n;
  const m2 = r2.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let d1 = 0;
  let d2 = 0;
  for (let i = 0; i < n; i += 1) {
    const a = r1[i] - m1;
    const b = r2[i] - m2;
    num += a * b;
    d1 += a * a;
    d2 += b * b;
  }
  const den = Math.sqrt(d1 * d2);
  if (!den) return null;
  return num / den;
}

function closesFromBars(bars) {
  if (!bars || !bars.length) return [];
  return bars
    .filter((b) => b && b.close != null)
    .map((b) => b.close);
}

function returnsFromBars(bars, window) {
  return dailyReturns(closesFromBars(bars)).slice(-(window || DEFAULT_WINDOW) - 1);
}

/**
 * @param {number|null} rhoAvg
 * @param {number|null} rhoMax
 * @returns {number} correlation_discount 0.77~1.0
 */
function correlationDiscount(rhoAvg, rhoMax) {
  let discount = 1.0;
  if (rhoAvg != null) {
    if (rhoAvg >= 0.85) discount = Math.min(discount, 0.77);
    else if (rhoAvg >= 0.75) discount = Math.min(discount, 0.92);
    else if (rhoAvg >= 0.65) discount = Math.min(discount, 0.97);
  }
  if (rhoMax != null && rhoMax > 0.90) {
    discount = Math.min(discount, 0.92);
  }
  return discount;
}

/**
 * @param {object} barsMap code → daily bars (ascending)
 * @param {string[]} [pairs] optional pair list
 */
function computeTechCorrelation(barsMap, pairs) {
  const pairList = pairs || TECH_CORR_PAIRS;
  const rhos = [];
  pairList.forEach(([a, b]) => {
    const ra = returnsFromBars(barsMap && barsMap[a]);
    const rb = returnsFromBars(barsMap && barsMap[b]);
    const rho = calcCorrelation(ra, rb, DEFAULT_WINDOW);
    if (rho != null && !Number.isNaN(rho)) rhos.push(rho);
  });
  if (!rhos.length) {
    return { rho_avg: null, rho_max: null, discount: 1.0, pairs: pairList, sample: 0 };
  }
  const rhoAvg = rhos.reduce((s, v) => s + v, 0) / rhos.length;
  const rhoMax = Math.max(...rhos);
  const discount = correlationDiscount(rhoAvg, rhoMax);
  return {
    rho_avg: Math.round(rhoAvg * 1000) / 1000,
    rho_max: Math.round(rhoMax * 1000) / 1000,
    discount,
    pairs: pairList,
    sample: rhos.length
  };
}

function effectiveTechCap(baseCap, barsMap) {
  const base = baseCap != null ? baseCap : 65;
  const corr = computeTechCorrelation(barsMap);
  return {
    ...corr,
    base_cap: base,
    effective_cap: Math.round(base * corr.discount * 10) / 10
  };
}

module.exports = {
  TECH_CORR_PAIRS,
  DEFAULT_WINDOW,
  calcCorrelation,
  correlationDiscount,
  computeTechCorrelation,
  effectiveTechCap,
  returnsFromBars,
  closesFromBars
};
