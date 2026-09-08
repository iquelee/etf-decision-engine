/**
 * V3.2 Bull Participation 仓位引擎（Shadow）
 *
 * 战略：进攻快、持有稳、防守慢、清仓狠
 *   Strategic = StageBase × ParticipationFactor
 *   Bull      = Strategic + ActivationBoost + BreakoutBoost + MomentumBoost − DefenseAdj
 *   Final     = Clamp(Bull, 0, ParticipationCeiling)
 *
 * Crisis ≠ 0：Bull Activation ≥60 → Recovery 态，允许 5～15% 恢复仓穿透 crisis 禁令
 */
'use strict';

const { round1, applyPositionConstraints, computeDefenseCapS7 } = require('./position-sizing.js');
const { getFundamentalFactor } = require('./v3-constants.js');
const { CORE_RATIOS, F_TO_CORE_GRADE } = require('../constants.js');
const {
  opportunityAdjustmentPct,
  defenseAdjustmentPct,
  computeTrendFirstCoreTrade
} = require('./v3-trend-first-position.js');

/** V3.2 凸型基础仓阶梯 */
const V32_STAGE_BASE = Object.freeze({
  S0: 5,
  S1: 8,
  S2: 12,
  S3: 20,
  S4: 26,
  S5: 30,
  S6: 25,
  S7: 10
});

/** P2 抬升后 V3.2 Stage Base */
const V32_STAGE_BASE_RAISED = Object.freeze({
  S0: 5,
  S1: 10,
  S2: 14,
  S3: 25,
  S4: 34,
  S5: 42,
  S6: 35,
  S7: 10
});

/** 市场参与度上限（占 maxPosition）— 非乘法压仓 */
const V32_PARTICIPATION_CEILING = Object.freeze({
  aggressive: 1.0,
  structural: 0.95,
  recovery: 0.75,
  range: 0.75,
  defensive: 0.45,
  crisis: 0.20
});

const BULL_TIER = Object.freeze({ recovery: 60, activation: 75, mainRally: 85 });

function stageBaseV32(displayStage, bullScore, params) {
  const raised = params && params.v3_v31_raise_stage_base !== false;
  const table = raised ? V32_STAGE_BASE_RAISED : V32_STAGE_BASE;
  const s = displayStage || 'S0';
  if (s === 'S0') {
    if (bullScore >= BULL_TIER.activation) return table.S1;
    if (bullScore >= BULL_TIER.recovery) return table.S0;
    return 0;
  }
  return table[s] != null ? table[s] : table.S2;
}

/**
 * Bull Activation Score 0～100
 * 价格/动量/量能/W/广度/突破
 */
function computeBullActivationScore(snapshot, portfolio, params) {
  if (!snapshot) return 0;
  let score = 0;
  const w = snapshot.w_state || 'W3';

  const bias20 = snapshot.bias_20d;
  if (bias20 != null && bias20 > 0) score += 20;
  else if (bias20 != null && bias20 > -2) score += 8;

  if (snapshot.ma20_slope != null && snapshot.ma20_slope > 0) score += 15;

  if (snapshot.change_5d != null && snapshot.change_5d > 0) score += 10;
  const c20 = snapshot.change_20d != null ? snapshot.change_20d : bias20;
  if (c20 != null && c20 > 0) score += 10;

  const vr = snapshot.volume_ratio;
  if (vr != null && vr >= 1.3) score += 10;
  else if (vr != null && vr >= 1.1) score += 5;

  if (w === 'W1' || w === 'W2') score += 15;
  else if (w === 'W3') score += 8;

  const breadth = portfolio.tech_breadth_proxy != null
    ? portfolio.tech_breadth_proxy
    : portfolio.portfolio_breadth_proxy;
  if (breadth != null && breadth >= 40) score += 10;
  else if (breadth != null && breadth >= 25) score += 5;

  if (snapshot.breakout_nd === true) score += 10;

  const minScore = params && params.v3_v32_bull_fast_min != null ? params.v3_v32_bull_fast_min : 58;
  if (snapshot.change_5d != null && snapshot.change_5d >= 5 && vr != null && vr >= 1.3) {
    score = Math.max(score, minScore);
  }

  return Math.min(100, Math.round(score));
}

/**
 * 基础 regime + Bull Score → 有效参与态（含 Recovery 穿透 Crisis）
 */
function resolveEffectiveRegime(baseRegime, bullScore, portfolio) {
  const base = baseRegime || 'range';
  if (base === 'crisis' || base === 'defensive') {
    if (bullScore >= BULL_TIER.recovery) return 'recovery';
    return base;
  }
  if (bullScore >= BULL_TIER.activation && (base === 'range' || base === 'structural')) {
    return base;
  }
  if (portfolio && portfolio.crisis_released_by_score && bullScore >= BULL_TIER.recovery) {
    return 'recovery';
  }
  return base;
}

function participationCeilingPct(maxPosition, effectiveRegime, bullScore) {
  let ratio = V32_PARTICIPATION_CEILING[effectiveRegime];
  if (ratio == null) ratio = 0.75;
  if (effectiveRegime === 'recovery') {
    if (bullScore >= BULL_TIER.mainRally) ratio = 0.80;
    else if (bullScore >= BULL_TIER.activation) ratio = 0.75;
    else ratio = 0.60;
  }
  return round1(maxPosition * ratio);
}

function bullActivationBoostPct(bullScore) {
  if (bullScore >= BULL_TIER.mainRally) return 9;
  if (bullScore >= BULL_TIER.activation) return 6;
  if (bullScore >= BULL_TIER.recovery) return 3;
  return 0;
}

/** 突破 = 一级仓位事件（非 +4% 微调） */
function breakoutBoostV32(snapshot, displayStage, strategic, params) {
  if (!snapshot || params.v3_v32_breakout_primary === false) return 0;
  if (snapshot.breakout_nd !== true) return 0;
  const w = snapshot.w_state || 'W3';
  const v = snapshot.v_state || 'V3';
  const pp = snapshot.price_position;
  if (pp == null || pp <= 0.75) return 0;
  if (w === 'W4' || w === 'W5') return 0;
  const volOk = v === 'V4' || v === 'V5' || (snapshot.volume_ratio != null && snapshot.volume_ratio > 1.15);
  if (!volOk) return 0;
  const stage = displayStage || 'S2';
  const isRally = stage === 'S3' || stage === 'S4' || stage === 'S5' || stage === 'S6';
  const pct = isRally ? 0.35 : 0.25;
  return round1(Math.min(9, Math.max(4, strategic * pct)));
}

function momentumBoostV32(snapshot, bullScore, params) {
  if (!snapshot || params.v3_v32_momentum_boost === false) return 0;
  let boost = 0;
  const c5 = snapshot.change_5d;
  const c20 = snapshot.change_20d != null ? snapshot.change_20d : snapshot.bias_20d;
  if (c5 != null && c5 > 8) boost += 2;
  if (c20 != null && c20 > 12) boost += 2;
  if (bullScore >= BULL_TIER.activation) boost += 2;
  return Math.min(5, boost);
}

function transitionBoostV32(portfolio, params) {
  if (!portfolio || params.v3_v32_transition_boost === false) return 0;
  const cur = portfolio.market_regime || 'range';
  const prev = portfolio.prev_market_regime;
  if (!prev) return 0;
  const rank = { crisis: 0, defensive: 1, range: 2, structural: 3, aggressive: 4, recovery: 2 };
  const curR = rank[cur] != null ? rank[cur] : 2;
  const prevR = rank[prev] != null ? rank[prev] : 2;
  if (curR - prevR >= 1) return 5;
  if (prev === 'crisis' && (cur === 'structural' || cur === 'range' || cur === 'recovery')) return 7;
  return 0;
}

/**
 * @param {object} input 与 computeTrendFirstTargets 兼容
 */
function computeBullParticipationTargets(input) {
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
      factor_breakdown: { engine: 'v32', base: 0, ceiling: 0 },
      gap: round1(0 - currentPosition),
      defense_cap_s7: null,
      v32_breakdown: { base: 0, ceiling: 0, binding: 'falsified', bull_score: 0 }
    };
  }

  const bullScore = computeBullActivationScore(snapshot, portfolio, params);
  const effectiveRegime = resolveEffectiveRegime(regime, bullScore, portfolio);
  const stageBase = round1(Math.min(stageBaseV32(displayStage, bullScore, params), maxPosition));
  const partFactor = participationCeilingPct(maxPosition, effectiveRegime, bullScore) / maxPosition;
  const strategic = round1(Math.min(stageBase, maxPosition * partFactor));

  const actBoost = bullActivationBoostPct(bullScore);
  const brkBoost = breakoutBoostV32(snapshot, displayStage, strategic, params);
  const momBoost = momentumBoostV32(snapshot, bullScore, params);
  const transBoost = transitionBoostV32(portfolio, params);
  const oppAdj = opportunityAdjustmentPct(opportunityScore);
  const defAdj = defenseAdjustmentPct(defenseScore);

  const bullTarget = round1(Math.max(0, strategic + actBoost + brkBoost + momBoost + transBoost + oppAdj - defAdj));
  const ceiling = participationCeilingPct(maxPosition, effectiveRegime, bullScore);
  let preChain = round1(Math.min(bullTarget, ceiling));

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

  if (preChain > ceiling + 1e-9 && binding == null) binding = 'participation_ceiling';

  // V3.2：Crisis 不锁死为 0（Recovery 穿透已在 effectiveRegime + stageBase 体现）
  // 不再套用旧路径 crisis → min(target, current)

  if (risk && risk.risk_override !== true && risk.risk_flag === 'YELLOW') {
    const yellowCap = round1(Math.min(finalTarget, currentPosition));
    if (yellowCap < finalTarget - 1e-9 && binding == null) binding = 'risk_yellow';
    finalTarget = yellowCap;
  }

  const ff = getFundamentalFactor(fScore);
  const coreRatio = Math.min(1, Math.max(0.25, ff));

  return {
    raw_target_position: bullTarget,
    risk_adjusted_target: preChain,
    final_target: finalTarget,
    finalTarget,
    binding_constraint: binding,
    factor_breakdown: {
      engine: 'v32',
      base: stageBase,
      strategic,
      participation_factor: round1(partFactor * 100) / 100,
      effective_regime: effectiveRegime,
      bull_score: bullScore,
      act_boost: actBoost,
      brk_boost: brkBoost,
      mom_boost: momBoost,
      trans_boost: transBoost,
      opp_adj: oppAdj,
      def_adj: defAdj,
      ceiling,
      core_ratio_hint: round1(coreRatio * 100) / 100
    },
    gap: round1(finalTarget - currentPosition),
    defense_cap_s7: defenseCapS7,
    v32_breakdown: {
      stage_base: stageBase,
      strategic,
      effective_regime: effectiveRegime,
      bull_score: bullScore,
      act_boost: actBoost,
      brk_boost: brkBoost,
      mom_boost: momBoost,
      trans_boost: transBoost,
      opp_adj: oppAdj,
      def_adj: defAdj,
      bull_target: bullTarget,
      ceiling,
      binding: binding || 'none'
    },
    bull_activation_score: bullScore,
    effective_market_regime: effectiveRegime
  };
}

module.exports = {
  V32_STAGE_BASE,
  V32_PARTICIPATION_CEILING,
  BULL_TIER,
  computeBullActivationScore,
  resolveEffectiveRegime,
  stageBaseV32,
  participationCeilingPct,
  computeBullParticipationTargets,
  computeTrendFirstCoreTrade
};
