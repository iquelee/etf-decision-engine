/**
 * V3.4 Bull Participation + Stage Position Engine
 *
 * Regime = Permission (risk budget ceiling)
 * Stage  = Position (primary target curve)
 * Setup  = Timing (H1/H2/H3 consolidation adds)
 * Breakout = State machine (B0–B4 additive)
 * Profit Protection = P0–P6 giveback control
 *
 * Target = StagePosition + SetupAdd + BreakoutAdd + PyramidAdd - DefensePenalty - ProfitPenalty
 */
'use strict';

const { round1, applyPositionConstraints, computeDefenseCapS7 } = require('./position-sizing.js');
const { normalizePrimaryStage } = require('./v3-constants.js');
const { computeBreakoutScore } = require('./v3-2-math-engine.js');
const { defenseAdjustmentPct } = require('./v3-trend-first-position.js');
const { coreRatioFromFundamental } = require('./v3-3-target-exposure.js');

/** Stage → 目标仓位区间（对齐 trend-stage.js：S5=主升，非顶部分配） */
const V34_STAGE_CURVE = Object.freeze({
  S0: { min: 0, max: 10 },
  S1: { min: 15, max: 30 },
  S2: { min: 30, max: 50 },
  S3: { min: 40, max: 58 },
  S4: { min: 55, max: 72 },
  S5: { min: 65, max: 85 }
});

/** Regime/MR → 风险预算天花板（Permission，非 Alpha 主驱动） */
function regimeRiskBudgetCap(regime, mr) {
  const score = mr != null ? mr : 55;
  if (regime === 'crisis' || score < 25) return 10;
  if (regime === 'defensive' || score < 35) return 25;
  if (regime === 'range' || score < 55) return 60;
  return 100;
}

function lerpStagePct(stageCurve, trendQuality) {
  const t = trendQuality != null ? Math.min(1, Math.max(0, trendQuality / 25)) : 0.55;
  return stageCurve.min + (stageCurve.max - stageCurve.min) * t;
}

/** Stage 决定基础目标仓（绝对 % × effectiveCap） */
function stagePositionTarget(displayStage, overlay, trendQuality, effectiveCap) {
  const cap = effectiveCap != null ? effectiveCap : 100;
  if (overlay === 'broken') {
    const pct = lerpStagePct({ min: 0, max: 20 }, trendQuality);
    return round1(pct * cap / 100);
  }
  const primary = normalizePrimaryStage(displayStage);
  const curve = V34_STAGE_CURVE[primary] || V34_STAGE_CURVE.S2;
  let pct = lerpStagePct(curve, trendQuality);
  if (displayStage === 'S6' && overlay !== 'broken') {
    const rallyPct = lerpStagePct(V34_STAGE_CURVE.S5, trendQuality);
    pct = Math.max(pct, rallyPct);
  }
  return round1(pct * cap / 100);
}

/** H1/H2/H3 横盘分级加仓 */
function classifyConsolidationSetup(snapshot, displayStage) {
  const snap = snapshot || {};
  const days = snap.sideway_days != null ? snap.sideway_days : 0;
  const cs = snap.consolidation_score != null ? snap.consolidation_score : 0;
  const ma20Up = snap.ma20_slope != null && snap.ma20_slope > 0;
  const volRatio = snap.volume_ratio != null ? snap.volume_ratio : 1;
  const primary = normalizePrimaryStage(displayStage);
  const stageRank = { S0: 0, S1: 1, S2: 2, S3: 3, S4: 4, S5: 5 };
  const rank = stageRank[primary] != null ? stageRank[primary] : 0;

  if (days >= 15 && cs >= 75) return { tier: 'H1', addPct: 12 };
  if (days >= 12 && cs >= 70) return { tier: 'H1', addPct: 10 };
  if (days >= 5 && days <= 10 && ma20Up && cs >= 60 && rank >= 2) return { tier: 'H2', addPct: 7 };
  if (days >= 3 && days <= 5 && ma20Up && volRatio < 0.90 && rank >= 3) return { tier: 'H3', addPct: 5 };
  return { tier: null, addPct: 0 };
}

/** Breakout State Machine B0–B4 */
function evaluateBreakoutState(snapshot, displayStage, bs) {
  const snap = snapshot || {};
  const primary = normalizePrimaryStage(displayStage);
  const w = snap.w_state || 'W3';
  const pp = snap.price_position != null ? snap.price_position : 0.5;
  const c5 = snap.change_5d != null ? snap.change_5d : 0;
  const broke = snap.breakout_nd === true || snap.breakout === true;
  if (!broke && (bs == null || bs < 70)) return { state: 'B0', addPct: 0 };

  if ((primary === 'S3' || primary === 'S4' || primary === 'S5')
    && pp > 0.75 && (w === 'W1' || w === 'W2')) {
    return { state: 'B4', addPct: 0, mainTrend: true };
  }
  if (snap.breakout_nd === true && pp > 0.88 && c5 > 2) {
    return { state: 'B3', addPct: 12 };
  }
  if (snap.breakout_nd === true && pp > 0.55 && pp <= 0.88 && (w === 'W2' || w === 'W3')) {
    return { state: 'B2', addPct: 10 };
  }
  if (broke || (bs != null && bs >= 75)) {
    return { state: 'B1', addPct: 15 };
  }
  return { state: 'B0', addPct: 0 };
}

/** Stage3 趋势金字塔：越强越高 */
function trendPyramidAddPct(snapshot, displayStage, effectiveCap) {
  const snap = snapshot || {};
  const primary = normalizePrimaryStage(displayStage);
  if (primary !== 'S3' && primary !== 'S4' && primary !== 'S5') return 0;
  const w = snap.w_state || 'W3';
  const pp = snap.price_position != null ? snap.price_position : 0;
  const ma20s = snap.ma20_slope != null ? snap.ma20_slope : 0;
  const c5 = snap.change_5d != null ? snap.change_5d : 0;
  if (pp < 0.65 || ma20s <= 0 || c5 <= 0) return 0;
  if (w !== 'W1' && w !== 'W2') return 0;
  let add = 5;
  if (pp > 0.80 && c5 > 4) add = 10;
  if (pp > 0.90 && c5 > 6 && snap.volume_ratio != null && snap.volume_ratio < 1.1) add = 15;
  return round1((effectiveCap * add) / 100);
}

function estimateFloatProfitPct(snapshot, positions) {
  if (positions && positions.unrealized_pct != null) return positions.unrealized_pct;
  const snap = snapshot || {};
  const pp = snap.price_position != null ? snap.price_position : 0.5;
  const bias = snap.bias_20d != null ? Math.max(0, snap.bias_20d) : 0;
  return pp * 35 + bias * 0.8;
}

/** P0–P6 利润保护：趋势强则少罚，趋势弱则多罚 */
function profitProtectionPenalty(snapshot, displayStage, overlay, positions, effectiveCap) {
  const snap = snapshot || {};
  const cap = effectiveCap != null ? effectiveCap : 100;
  const floatPct = estimateFloatProfitPct(snap, positions);
  const primary = normalizePrimaryStage(displayStage);
  const w = snap.w_state || 'W3';
  const hvd = snap.high_volume_decline === true;
  const hvs = snap.high_volume_stagnation === true;

  let profitState = 'P0';
  if (floatPct >= 40) profitState = 'P4';
  else if (floatPct >= 30) profitState = 'P3';
  else if (floatPct >= 20) profitState = 'P2';
  else if (floatPct >= 10) profitState = 'P1';

  if (overlay === 'broken') return { penalty: round1(cap * 0.30), profitState: 'P6' };
  if (hvd && (primary === 'S4' || primary === 'S5' || displayStage === 'S6')) {
    return { penalty: round1(cap * 0.22), profitState: 'P5' };
  }

  let penalty = 0;
  if (profitState === 'P2') penalty = cap * 0.05;
  else if (profitState === 'P3') {
    const trendStrong = (primary === 'S4' || primary === 'S5' || displayStage === 'S6')
      && (w === 'W1' || w === 'W2') && !hvs;
    penalty = trendStrong ? cap * 0.03 : cap * 0.12;
  } else if (profitState === 'P4') {
    const trendStrong = (primary === 'S5' || displayStage === 'S6')
      && (w === 'W1' || w === 'W2') && !hvs && !hvd;
    penalty = trendStrong ? cap * 0.05 : cap * 0.18;
  }
  if (hvs && penalty < cap * 0.12) penalty = cap * 0.12;

  return { penalty: round1(penalty), profitState };
}

function computeV34Targets(input) {
  const {
    maxPosition = 100,
    displayStage = 'S2',
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
    params = {},
    trendQualityScore,
    positions = {}
  } = input || {};

  const cap = maxPosition;
  const empty = (binding) => ({
    raw_target_position: 0,
    risk_adjusted_target: 0,
    final_target: 0,
    finalTarget: 0,
    binding_constraint: binding,
    factor_breakdown: { engine: 'v34', binding },
    gap: round1(0 - currentPosition),
    defense_cap_s7: null,
    v34_breakdown: { binding },
    bull_activation_score: 0,
    effective_market_regime: regime
  });

  if (falsified) return empty('falsified');

  const mr = portfolio.market_score != null ? portfolio.market_score : 55;
  const regimeCap = regimeRiskBudgetCap(regime, mr);
  const effectiveCap = round1(Math.min(cap, regimeCap));
  const tq = trendQualityScore != null ? trendQualityScore : 14;
  const ov = overlay || 'normal';

  const stageTarget = stagePositionTarget(displayStage, ov, tq, effectiveCap);
  const setup = classifyConsolidationSetup(snapshot, displayStage);
  const setupAdd = round1((effectiveCap * setup.addPct) / 100);
  const bs = computeBreakoutScore(snapshot, portfolio);
  const brk = evaluateBreakoutState(snapshot, displayStage, bs);
  const breakoutAdd = round1((effectiveCap * brk.addPct) / 100);
  const pyramidAdd = trendPyramidAddPct(snapshot, displayStage, effectiveCap);
  const defensePenalty = round1(Math.min(effectiveCap * 0.15, defenseAdjustmentPct(defenseScore)));
  const profitProt = profitProtectionPenalty(snapshot, displayStage, ov, positions, effectiveCap);

  let rawTarget = round1(Math.max(0,
    stageTarget + setupAdd + breakoutAdd + pyramidAdd - defensePenalty - profitProt.penalty
  ));

  if (brk.mainTrend === true) {
    const primary = normalizePrimaryStage(displayStage);
    if (primary === 'S3' || primary === 'S4' || primary === 'S5') {
      const band = V34_STAGE_CURVE[primary === 'S3' ? 'S4' : primary];
      const sMin = round1(band.min * effectiveCap / 100);
      rawTarget = round1(Math.max(rawTarget, sMin));
    }
  }

  let preChain = round1(Math.min(rawTarget, effectiveCap));

  const defenseCapS7 = constraints.defenseCapS7 != null
    ? constraints.defenseCapS7
    : computeDefenseCapS7({ overlay: ov, defenseScore, wState: wState || snapshot.w_state });

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

  if (risk && risk.risk_override !== true && risk.risk_flag === 'YELLOW') {
    const yellowCap = round1(Math.min(finalTarget, currentPosition));
    if (yellowCap < finalTarget - 1e-9 && binding == null) binding = 'risk_yellow';
    finalTarget = yellowCap;
  }

  const coreRatio = coreRatioFromFundamental(fScore);

  return {
    raw_target_position: rawTarget,
    risk_adjusted_target: preChain,
    final_target: finalTarget,
    finalTarget,
    binding_constraint: binding,
    factor_breakdown: {
      engine: 'v34',
      cap,
      effective_cap: effectiveCap,
      regime_cap: regimeCap,
      mr,
      stage_target: stageTarget,
      setup_tier: setup.tier,
      setup_add: setupAdd,
      breakout_state: brk.state,
      breakout_add: breakoutAdd,
      pyramid_add: pyramidAdd,
      bs,
      defense_penalty: defensePenalty,
      profit_state: profitProt.profitState,
      profit_penalty: profitProt.penalty,
      core_ratio_hint: coreRatio
    },
    gap: round1(finalTarget - currentPosition),
    defense_cap_s7: defenseCapS7,
    v34_breakdown: {
      cap,
      effective_cap: effectiveCap,
      regime_cap: regimeCap,
      stage_target: stageTarget,
      setup,
      setup_add: setupAdd,
      breakout: brk,
      breakout_add: breakoutAdd,
      pyramid_add: pyramidAdd,
      bs,
      defense_penalty: defensePenalty,
      profit_state: profitProt.profitState,
      profit_penalty: profitProt.penalty,
      raw_target: rawTarget,
      pre_chain: preChain,
      binding: binding || 'none'
    },
    bull_activation_score: null,
    effective_market_regime: regime,
    breakout_score: bs,
    core_ratio_hint: coreRatio
  };
}

/** Giveback Ratio：从浮盈峰值回吐比例 */
function computeGivebackRatio(navSeries) {
  if (!navSeries || navSeries.length < 2) return { giveback_ratio: null, peak_profit: null };
  const base = navSeries[0].engine != null ? navSeries[0].engine : 100;
  let peakNav = base;
  let maxGiveback = 0;
  for (const row of navSeries) {
    const nav = row.engine != null ? row.engine : base;
    if (nav > peakNav) peakNav = nav;
    const peakProfit = peakNav - base;
    const curProfit = nav - base;
    if (peakProfit > 1e-6) {
      const gb = (peakProfit - Math.max(0, curProfit)) / peakProfit;
      if (gb > maxGiveback) maxGiveback = gb;
    }
  }
  const peakProfit = peakNav - base;
  return {
    giveback_ratio: Math.round(maxGiveback * 1000) / 10,
    peak_profit_pct: Math.round(peakProfit * 100) / 100
  };
}

module.exports = {
  V34_STAGE_CURVE,
  regimeRiskBudgetCap,
  stagePositionTarget,
  classifyConsolidationSetup,
  evaluateBreakoutState,
  trendPyramidAddPct,
  profitProtectionPenalty,
  computeV34Targets,
  computeGivebackRatio
};
