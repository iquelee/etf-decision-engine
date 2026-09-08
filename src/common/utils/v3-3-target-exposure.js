/**
 * V3.3 Target Exposure — 加法饱和模型（Shadow）
 *
 * Target = BasePosition + SetupAdd + BreakoutAdd - RiskPenalty
 * BasePosition = Cap × RegimeBase(MR) × StageParticipation
 *
 * 模式：b=加法 | c=+BullBase | d=+BreakoutAccelerator
 * 基本面仅影响 core/trade 拆分，不折扣目标仓。
 */
'use strict';

const { round1, applyPositionConstraints, computeDefenseCapS7 } = require('./position-sizing.js');
const { normalizePrimaryStage } = require('./v3-constants.js');
const { computeBreakoutScore } = require('./v3-2-math-engine.js');
const { defenseAdjustmentPct } = require('./v3-trend-first-position.js');

/** MR → 基础风险预算（占 Cap 比例，规格 §八） */
function regimeBaseFromMR(mr) {
  const s = mr != null ? mr : 55;
  if (s >= 80) return 0.70;
  if (s >= 65) return 0.50;
  if (s >= 50) return 0.30;
  if (s >= 35) return 0.15;
  return 0.05;
}

/** Stage → 释放比例（规格 §九） */
const V33_STAGE_PARTICIPATION = Object.freeze({
  S0: 0,
  S1: 0.20,
  S2: 0.60,
  S3: 0.85,
  S4: 0.95,
  S5: 1.00
});

function stageParticipation(displayStage) {
  const p = normalizePrimaryStage(displayStage);
  return V33_STAGE_PARTICIPATION[p] != null ? V33_STAGE_PARTICIPATION[p] : 0.60;
}

function consolidationAddPct(cap, cs, sidewayDays, displayStage, params) {
  const primary = normalizePrimaryStage(displayStage);
  if (primary !== 'S4' && primary !== 'S5') return 0;
  const score = cs != null ? cs : 0;
  const days = sidewayDays != null ? sidewayDays : 0;
  if (score >= 80 && days >= 15) return round1(cap * 0.10);
  if (score >= 75 && days >= 12) return round1(cap * 0.08);
  if (score >= 65 && days >= 8) return round1(cap * 0.05);
  return 0;
}

function breakoutAddPct(cap, bs, mode, params) {
  if (bs == null || bs < 75) return 0;
  const m = (mode || 'b').toLowerCase();
  if (m === 'd') {
    const minPct = params && params.v3_3_breakout_add_min_pct != null ? params.v3_3_breakout_add_min_pct : 15;
    const maxPct = params && params.v3_3_breakout_add_max_pct != null ? params.v3_3_breakout_add_max_pct : 25;
    const t = (bs - 75) / 25;
    return round1(cap * (minPct + t * (maxPct - minPct)) / 100);
  }
  return round1(cap * 0.10);
}

/** Bull Base 底（模式 c/d：MR>65→50%Cap，MR>80→70%Cap × StageParticipation） */
function bullBaseTarget(cap, mr, stagePart, mode) {
  const m = (mode || 'b').toLowerCase();
  if (m !== 'c' && m !== 'd') return 0;
  if (stagePart < 0.60) return 0;
  const marketScore = mr != null ? mr : 0;
  let basePct = 0;
  if (marketScore > 80) basePct = 0.70;
  else if (marketScore > 65) basePct = 0.50;
  else return 0;
  return round1(cap * basePct * stagePart);
}

/** 基本面 → 核心仓比例（不折扣 Target） */
function coreRatioFromFundamental(fScore) {
  const f = (fScore != null ? fScore : 15) / 25;
  return round1(Math.min(1, Math.max(0.25, 0.60 + 0.40 * f)) * 1000) / 1000;
}

/**
 * @param {object} input 与 v32 sizing 兼容；params.v3_3_mode = 'b'|'c'|'d'
 */
function computeV33Targets(input) {
  const {
    maxPosition = 45,
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
    consolidationScore,
    sidewayDays
  } = input || {};

  const mode = (params && params.v3_3_mode) ? String(params.v3_3_mode).toLowerCase() : 'b';
  const cap = maxPosition;

  const empty = (binding) => ({
    raw_target_position: 0,
    risk_adjusted_target: 0,
    final_target: 0,
    finalTarget: 0,
    binding_constraint: binding,
    factor_breakdown: { engine: 'v33', mode, binding },
    gap: round1(0 - currentPosition),
    defense_cap_s7: null,
    v33_breakdown: { mode, binding },
    bull_activation_score: 0,
    effective_market_regime: regime
  });

  if (falsified) return empty('falsified');

  const mr = portfolio.market_score != null ? portfolio.market_score : 55;
  const stagePart = stageParticipation(displayStage);
  const regimeBase = regimeBaseFromMR(mr);

  let basePosition = round1(cap * regimeBase * stagePart);
  const setupAdd = consolidationAddPct(
    cap,
    consolidationScore != null ? consolidationScore : snapshot.consolidation_score,
    sidewayDays != null ? sidewayDays : snapshot.sideway_days,
    displayStage,
    params
  );
  const bs = computeBreakoutScore(snapshot, portfolio);
  const brkAdd = snapshot.breakout_nd === true ? breakoutAddPct(cap, bs, mode, params) : 0;
  const riskPenalty = round1(Math.min(cap * 0.20, defenseAdjustmentPct(defenseScore)));

  let rawTarget = round1(Math.max(0, basePosition + setupAdd + brkAdd - riskPenalty));

  const bullFloor = bullBaseTarget(cap, mr, stagePart, mode);
  if (bullFloor > 0) rawTarget = round1(Math.max(rawTarget, bullFloor));

  let preChain = round1(Math.min(rawTarget, cap));

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
      engine: 'v33',
      mode,
      cap,
      mr,
      regime_base: regimeBase,
      stage_part: stagePart,
      base_position: basePosition,
      setup_add: setupAdd,
      breakout_add: brkAdd,
      bs,
      risk_penalty: riskPenalty,
      bull_floor: bullFloor,
      core_ratio_hint: coreRatio
    },
    gap: round1(finalTarget - currentPosition),
    defense_cap_s7: defenseCapS7,
    v33_breakdown: {
      mode,
      cap,
      mr,
      regime_base: regimeBase,
      stage_part: stagePart,
      base_position: basePosition,
      setup_add: setupAdd,
      breakout_add: brkAdd,
      bs,
      risk_penalty: riskPenalty,
      bull_floor: bullFloor,
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

module.exports = {
  V33_STAGE_PARTICIPATION,
  regimeBaseFromMR,
  stageParticipation,
  computeV33Targets,
  coreRatioFromFundamental
};
