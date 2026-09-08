/**
 * V3.1 Trend-First 仓位引擎（Shadow）
 *
 * Target = Clamp(BaseStage + TrendBoost + OppAdj - DefenseAdj, 0, MarketCeiling)
 * 不再使用 MF×SF×OF×FF×DP 连续乘法；FF 仅用于 Core/Trading 拆分（见 decision-v3）。
 */
'use strict';

const { round1, applyPositionConstraints, computeDefenseCapS7 } = require('./position-sizing.js');
const { getFundamentalFactor } = require('./v3-constants.js');
const { CORE_RATIOS, F_TO_CORE_GRADE } = require('../constants.js');

/** 展示阶段 → 基础仓位（占组合 %，上限不超过 maxPosition） */
const V31_STAGE_BASE = Object.freeze({
  S0: 0,
  S1: 5,
  S2: 10,
  S3: 20,
  S4: 25,
  S5: 30,
  S6: 25,
  S7: 10
});

/** P2 抬升后 Stage Base（v3_v31_raise_stage_base） */
const V31_STAGE_BASE_RAISED = Object.freeze({
  S0: 0,
  S1: 5,
  S2: 12,
  S3: 25,
  S4: 32,
  S5: 42,
  S6: 35,
  S7: 10
});

/** Regime → 风险天花板（占 maxPosition 的比例） */
const V31_MARKET_CEILING_RATIO = Object.freeze({
  aggressive: 1.0,
  structural: 1.0,
  range: 0.9,
  defensive: 0.7,
  crisis: 0.35
});

const REGIME_RANK = Object.freeze({
  crisis: 0,
  defensive: 1,
  range: 2,
  structural: 3,
  aggressive: 4
});

function stageBasePct(displayStage, params) {
  const s = displayStage || 'S0';
  const raised = params && params.v3_v31_raise_stage_base !== false;
  const table = raised ? V31_STAGE_BASE_RAISED : V31_STAGE_BASE;
  return table[s] != null ? table[s] : table.S2;
}

function marketCeilingPct(maxPosition, regime) {
  const r = V31_MARKET_CEILING_RATIO[regime] != null ? V31_MARKET_CEILING_RATIO[regime] : 0.9;
  return round1(maxPosition * r);
}

function opportunityAdjustmentPct(opportunityScore) {
  const score = opportunityScore != null ? opportunityScore : 70;
  return round1(((score - 70) / 10) * 1.5);
}

function defenseAdjustmentPct(defenseScore) {
  const d = defenseScore != null ? defenseScore : 0;
  if (d < 35) return 0;
  if (d < 50) return 3;
  if (d < 65) return 7;
  if (d < 80) return 12;
  return 20;
}

function breakoutBoostPct(snapshot, params) {
  if (!snapshot || params.v3_v31_breakout_boost === false) return 0;
  const w = snapshot.w_state || 'W3';
  const v = snapshot.v_state || 'V3';
  const pp = snapshot.price_position;
  if (snapshot.breakout_nd !== true) return 0;
  if (pp == null || pp <= 0.8) return 0;
  if (w !== 'W1' && w !== 'W2' && w !== 'W3') return 0;
  const volOk = v === 'V4' || v === 'V5' || (snapshot.volume_ratio != null && snapshot.volume_ratio > 1.2);
  const boost = params && params.v3_v31_raise_stage_base !== false ? 6 : 4;
  return volOk ? boost : 0;
}

function persistenceBoostPct(snapshot, params) {
  if (!snapshot || params.v3_v31_persistence_boost === false) return 0;
  const c5 = snapshot.change_5d;
  const c20 = snapshot.change_20d != null ? snapshot.change_20d : snapshot.bias_20d;
  const slope = snapshot.ma20_slope;
  let hit = 0;
  if (c5 != null && c5 > 8) hit += 1;
  if (c20 != null && c20 > 15) hit += 1;
  if (slope != null && slope > 0) hit += 1;
  if (hit >= 2) return params && params.v3_v31_raise_stage_base !== false ? 5 : 3;
  return 0;
}

function transitionBoostPct(portfolio, params) {
  if (!portfolio || params.v3_v31_transition_boost === false) return 0;
  const cur = portfolio.market_regime || 'range';
  const prev = portfolio.prev_market_regime;
  if (!prev || prev === cur) return 0;
  const curR = REGIME_RANK[cur] != null ? REGIME_RANK[cur] : 2;
  const prevR = REGIME_RANK[prev] != null ? REGIME_RANK[prev] : 2;
  if (curR - prevR >= 1) return params && params.v3_v31_raise_stage_base !== false ? 6 : 5;
  return 0;
}

function trendBoostTotal(snapshot, portfolio, params) {
  return round1(
    breakoutBoostPct(snapshot, params)
    + persistenceBoostPct(snapshot, params)
    + transitionBoostPct(portfolio, params)
  );
}

/**
 * @param {object} input
 * @returns 与 computePositionTargets 兼容的字段 + v31_breakdown
 */
function computeTrendFirstTargets(input) {
  const {
    maxPosition = 30,
    displayStage = 'S2',
    opportunityScore = 70,
    defenseScore = 0,
    regime = 'range',
    currentPosition = 0,
    snapshot = {},
    portfolio = {},
    constraints = {},
    risk,
    overlay,
    wState,
    falsified = false,
    fScore,
    params = {}
  } = input || {};

  if (falsified) {
    return {
      raw_target_position: 0,
      risk_adjusted_target: 0,
      final_target: 0,
      finalTarget: 0,
      binding_constraint: null,
      factor_breakdown: { engine: 'v31', base: 0, ceiling: 0 },
      gap: round1(0 - currentPosition),
      defense_cap_s7: null,
      v31_breakdown: { base: 0, ceiling: 0, binding: 'falsified' }
    };
  }

  const base = round1(Math.min(stageBasePct(displayStage, params), maxPosition));
  const ceiling = marketCeilingPct(maxPosition, regime);
  const tBoost = trendBoostTotal(snapshot, portfolio, params);
  const oppAdj = opportunityAdjustmentPct(opportunityScore);
  const defAdj = defenseAdjustmentPct(defenseScore);
  const adjusted = round1(Math.max(0, base + tBoost + oppAdj - defAdj));
  let preChain = round1(Math.min(adjusted, ceiling));

  const defenseCapS7 = constraints.defenseCapS7 != null
    ? constraints.defenseCapS7
    : computeDefenseCapS7({ overlay, defenseScore, wState });

  const limited = applyPositionConstraints(preChain, {
    etfMax: constraints.etfMax,
    sectorCap: constraints.sectorCap,
    correlationCap: constraints.correlationCap,
    portfolioRiskCap: constraints.portfolioRiskCap,
    cashFloorMax: constraints.cashFloorMax,
    defenseCapS7
  });

  let finalTarget = limited.finalTarget;
  let binding = limited.bindingConstraint;

  if (preChain > ceiling + 1e-9 && binding == null) binding = 'market_ceiling';

  if (risk && risk.risk_override !== true && risk.risk_flag === 'YELLOW') {
    const yellowCap = round1(Math.min(finalTarget, currentPosition));
    if (yellowCap < finalTarget - 1e-9 && binding == null) binding = 'risk_yellow';
    finalTarget = yellowCap;
  }

  const ff = getFundamentalFactor(fScore);
  const coreRatio = Math.min(1, Math.max(0.25, ff));

  return {
    raw_target_position: adjusted,
    risk_adjusted_target: preChain,
    final_target: finalTarget,
    finalTarget,
    binding_constraint: binding,
    factor_breakdown: {
      engine: 'v31',
      base,
      trend_boost: tBoost,
      opp_adj: oppAdj,
      def_adj: defAdj,
      ceiling,
      core_ratio_hint: round1(coreRatio * 100) / 100
    },
    gap: round1(finalTarget - currentPosition),
    defense_cap_s7: defenseCapS7,
    v31_breakdown: {
      base,
      trend_boost: tBoost,
      breakout: breakoutBoostPct(snapshot, params),
      persistence: persistenceBoostPct(snapshot, params),
      transition: transitionBoostPct(portfolio, params),
      opp_adj: oppAdj,
      def_adj: defAdj,
      adjusted,
      ceiling,
      binding: binding || 'none'
    }
  };
}

/**
 * V3.1 核心/交易仓拆分：FF 只决定 core 占比，trade = finalTarget − core（不因 FF 压总仓）
 */
function computeTrendFirstCoreTrade(ctx, finalTarget) {
  const { fundamental = {}, positions = {}, snapshot = {}, portfolio = {} } = ctx;
  const fState = fundamental.f_state || 'F3';
  const confirmedGrade = positions.core_ratio_grade;
  const tradeGrade = positions.trade_ratio_grade || confirmedGrade || F_TO_CORE_GRADE[fState] || 'C';

  if (fState === 'F5' || finalTarget <= 0) {
    return { core: 0, trade: 0, core_ratio_grade: 'F5', trade_ratio_grade: 'F5' };
  }

  let grade = confirmedGrade || F_TO_CORE_GRADE[fState] || 'C';
  const w = snapshot.w_state || 'W3';
  const regime = portfolio.market_regime || 'range';
  let downgrades = 0;
  if (w === 'W4' || w === 'W5') downgrades += 1;
  if (regime === 'crisis' || regime === 'defensive') downgrades += 1;
  if (downgrades > 0) {
    const order = ['A', 'B', 'C', 'D'];
    const idx = order.indexOf(grade);
    if (idx >= 0) grade = order[Math.min(order.length - 1, idx + downgrades)];
  }

  const coreRatio = CORE_RATIOS[grade] != null ? CORE_RATIOS[grade] : 0.5;
  const core = round1(finalTarget * coreRatio);
  const trade = round1(Math.max(0, finalTarget - core));
  return { core, trade, core_ratio_grade: grade, trade_ratio_grade: tradeGrade };
}

module.exports = {
  V31_STAGE_BASE,
  V31_MARKET_CEILING_RATIO,
  stageBasePct,
  marketCeilingPct,
  opportunityAdjustmentPct,
  defenseAdjustmentPct,
  computeTrendFirstTargets,
  computeTrendFirstCoreTrade
};
