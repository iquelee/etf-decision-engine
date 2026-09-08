/**
 * V3.0 v1.1 Market Regime Engine（P4）
 *
 * MarketScore = MTrend(30) + PortfolioBreadthProxy(25) + MVolume(20) + MGrowth(15) + MRisk(10)
 * Regime/MF 查 v3-constants；Crisis Hard Trigger 可覆盖分数档。
 *
 * v1.1：MBreadth 改称 PortfolioBreadthProxy（五票 W 宽度，非全市场）
 * 规格：V3.0技术改造清单-v1.1-数学纠偏版.md §B2、§B3
 */
'use strict';

const { marketRegimeFromScore, getMarketFactor, V3_CRISIS_SCORE_RELEASE } = require('./v3-constants.js');
const {
  neutralVolumeScore,
  neutralGrowthScore,
  neutralRiskScore,
  resolveScoreComponents,
  fillNeutral
} = require('./market-score-components.js');

const MARKET_WEIGHTS = Object.freeze({
  mTrendMax: 30,
  breadthMax: 25,
  volumeMax: 20,
  growthMax: 15,
  riskMax: 10
});

/** 科技/宽基指数 W → MTrend 0~30（与生产 deriveMarketRegime 同分制扩展） */
function calcMTrendFromWStates(indexWStates, ndxTrend) {
  let score = 0;
  let n = 0;
  (indexWStates || []).forEach((w) => {
    if (!w) return;
    n += 1;
    if (w === 'W1' || w === 'W2') score += 2;
    else if (w === 'W3') score += 1;
  });
  if (ndxTrend === '上') score += 1;
  else if (ndxTrend === '下') score -= 1;
  if (n === 0 && ndxTrend == null) return 15;
  const max = Math.max(1, n * 2 + (ndxTrend != null ? 1 : 0));
  const normalized = Math.max(0, Math.min(max, score));
  return Math.round((normalized / max) * MARKET_WEIGHTS.mTrendMax);
}

/**
 * PortfolioBreadthProxy 0~25 分（v1.1 更名，非全市场 MBreadth）
 * @param {string[]} etfWStates 组合内 ETF 周线 W
 */
function calcPortfolioBreadthScore(etfWStates) {
  const states = (etfWStates || []).filter(Boolean);
  if (!states.length) return Math.round(MARKET_WEIGHTS.breadthMax * 0.5);
  const strong = states.filter((w) => w === 'W1' || w === 'W2').length;
  return Math.round((strong / states.length) * MARKET_WEIGHTS.breadthMax);
}

/**
 * 指数 W 对齐 V38 口径的 breadth 分（Shadow 观察用）
 * W1/W2=1.0 · W3=0.5 · W4/W5=0 — 与 deriveMarketRegime 指数打分同 spirit
 */
function calcIndexAlignedBreadthScore(indexWStates) {
  const states = (indexWStates || []).filter(Boolean);
  if (!states.length) return Math.round(MARKET_WEIGHTS.breadthMax * 0.5);
  let unit = 0;
  states.forEach((w) => {
    if (w === 'W1' || w === 'W2') unit += 1;
    else if (w === 'W3') unit += 0.5;
  });
  return Math.round((unit / states.length) * MARKET_WEIGHTS.breadthMax);
}

/** 0~100%：W1/W2 占比（Crisis Hard Trigger 用，portfolio 口径） */
function calcPortfolioBreadthPct(etfWStates) {
  const states = (etfWStates || []).filter(Boolean);
  if (!states.length) return 50;
  const strong = states.filter((w) => w === 'W1' || w === 'W2').length;
  return Math.round((strong / states.length) * 1000) / 10;
}

/** 指数对齐 breadth %（Crisis 用 index 源时） */
function calcIndexAlignedBreadthPct(indexWStates) {
  const states = (indexWStates || []).filter(Boolean);
  if (!states.length) return 50;
  let unit = 0;
  states.forEach((w) => {
    if (w === 'W1' || w === 'W2') unit += 1;
    else if (w === 'W3') unit += 0.5;
  });
  return Math.round((unit / states.length) * 1000) / 10;
}

function pickBreadthStates(input) {
  const source = (input && input.breadthSource) || 'portfolio';
  if (source === 'index') {
    return {
      source,
      scoreStates: input.indexWStates || [],
      pctStates: input.indexWStates || []
    };
  }
  return {
    source,
    scoreStates: input.etfWStates || [],
    pctStates: input.etfWStates || []
  };
}

/**
 * @param {object} input indexWStates, etfWStates, ndxTrend, mVolume?, mGrowth?, mRisk?, breadthSource?
 *   Phase A: techSnapshots, growthDailyBars/broadDailyBars, growthWeeklyBars/broadWeeklyBars
 * @returns {{ marketScore, components }}
 */
function calcMarketScore(input) {
  const idx = input && input.indexWStates;
  const breadthPick = pickBreadthStates(input);
  const mtrend = calcMTrendFromWStates(idx, input && input.ndxTrend);
  const mbreadth = breadthPick.source === 'index'
    ? calcIndexAlignedBreadthScore(breadthPick.scoreStates)
    : calcPortfolioBreadthScore(breadthPick.scoreStates);
  const resolved = fillNeutral(resolveScoreComponents(input || {}));
  const mvolume = resolved.mVolume;
  const mgrowth = resolved.mGrowth;
  const mrisk = resolved.mRisk;

  const marketScore = Math.max(0, Math.min(100, Math.round(
    mtrend + mbreadth + mvolume + mgrowth + mrisk
  )));

  return {
    marketScore,
    breadth_source: breadthPick.source,
    components: {
      mTrend: mtrend,
      portfolioBreadthProxy: mbreadth,
      mVolume: mvolume,
      mGrowth: mgrowth,
      mRisk: mrisk
    }
  };
}

/** Phase B：Crisis 硬触发专用 tech 票 W 宽度（排除黄金等非科技票） */
function resolveTechBreadthPct(input) {
  const techStates = ((input && input.techWStates) || []).filter(Boolean);
  if (techStates.length) return calcPortfolioBreadthPct(techStates);
  return calcPortfolioBreadthPct((input && input.etfWStates) || []);
}

/**
 * Crisis Hard Trigger（v1.1 §B2 + Phase B）— 任一成立即 crisis
 * breadth 口径：tech-only W1/W2 占比（黄金 518880 不计入分母）
 */
function checkCrisisHardTrigger(input) {
  const breadthPct = input.techBreadthProxy != null
    ? input.techBreadthProxy
    : resolveTechBreadthPct(input);

  if (breadthPct < 20) {
    return { triggered: true, reason: 'tech_breadth_proxy', detail: `${breadthPct}%` };
  }

  const indexStates = input.indexWStates || [];
  if (indexStates.length >= 5) {
    const w5 = indexStates.filter((w) => w === 'W5').length;
    if (w5 >= 3) {
      return { triggered: true, reason: 'index_w5_majority', detail: `${w5}/${indexStates.length}` };
    }
  }

  const risk = input.risk || {};
  if (risk.risk_flag === 'RED' && input.riskEventsActive === true) {
    return { triggered: true, reason: 'red_active_risk_events', detail: 'RED+events' };
  }

  return { triggered: false, reason: null, detail: null };
}

/**
 * 解析市场环境（Score → Regime → MF + Crisis 硬触发）
 */
function resolveMarketEnvironment(input) {
  const scored = calcMarketScore(input || {});
  const breadthPick = pickBreadthStates(input || {});
  const portfolioBreadthProxy = breadthPick.source === 'index'
    ? calcIndexAlignedBreadthPct(breadthPick.pctStates)
    : calcPortfolioBreadthPct(breadthPick.pctStates);
  const techBreadthProxy = resolveTechBreadthPct(input || {});
  const crisis = checkCrisisHardTrigger({
    techBreadthProxy,
    techWStates: input && input.techWStates,
    indexWStates: input && input.indexWStates,
    etfWStates: input && input.etfWStates,
    risk: input && input.risk,
    riskEventsActive: input && input.riskEventsActive
  });

  let regime = marketRegimeFromScore(scored.marketScore, input && input.marketScoreThresholds);
  let crisisOverride = false;
  const releaseScore = (input && input.crisisReleaseScore != null)
    ? input.crisisReleaseScore
    : V3_CRISIS_SCORE_RELEASE;
  const scoreReleasable = crisis.reason === 'tech_breadth_proxy' || crisis.reason === 'index_w5_majority';
  const crisisReleasedByScore = crisis.triggered && scoreReleasable && scored.marketScore >= releaseScore;
  if (crisis.triggered && !crisisReleasedByScore) {
    regime = { regime: 'crisis', factor: getMarketFactor('crisis') };
    crisisOverride = true;
  }

  return {
    market_score: scored.marketScore,
    market_regime: regime.regime,
    market_factor: regime.factor,
    portfolio_breadth_proxy: portfolioBreadthProxy,
    tech_breadth_proxy: techBreadthProxy,
    breadth_source: scored.breadth_source,
    crisis_hard_trigger: { ...crisis, released_by_score: crisisReleasedByScore },
    crisis_override: crisisOverride,
    crisis_released_by_score: crisisReleasedByScore,
    components: scored.components
  };
}

/** 兼容旧回测：科技三票 W → regime（deprecated，仅对照） */
function legacyRegimeFromWStates(states) {
  const env = resolveMarketEnvironment({ indexWStates: states, etfWStates: states });
  return env.market_regime;
}

module.exports = {
  MARKET_WEIGHTS,
  calcMTrendFromWStates,
  calcPortfolioBreadthScore,
  calcIndexAlignedBreadthScore,
  calcPortfolioBreadthPct,
  calcIndexAlignedBreadthPct,
  resolveTechBreadthPct,
  calcMarketScore,
  checkCrisisHardTrigger,
  resolveMarketEnvironment,
  legacyRegimeFromWStates
};
