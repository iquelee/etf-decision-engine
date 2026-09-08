/**
 * V3.2 Bull Participation — 乘法数学引擎（Shadow）
 *
 * Target = Cap × BPM × TM × OM × CCM × BM，且 Target ≥ BullFloor
 * 市场状态先定风险预算，趋势确认后释放；基本面为放大器非入场门槛。
 */
'use strict';

const { round1, applyPositionConstraints, computeDefenseCapS7 } = require('./position-sizing.js');
const { normalizePrimaryStage } = require('./v3-constants.js');
const { computeBullActivationScore } = require('./v3-bull-participation.js');
const { defenseAdjustmentPct } = require('./v3-trend-first-position.js');

/** MR → BPM（规格 §五） */
const V32_MR_BPM = Object.freeze([
  { min: 80, bpm: 1.00, riskBudget: 100 },
  { min: 65, bpm: 0.85, riskBudget: 85 },
  { min: 50, bpm: 0.65, riskBudget: 65 },
  { min: 35, bpm: 0.40, riskBudget: 40 },
  { min: 0, bpm: 0.15, riskBudget: 15 }
]);

/** 主趋势阶段 → TM（规格 §六，S6→S5 / S7→S4 由 normalizePrimaryStage 处理） */
const V32_TM = Object.freeze({
  S0: 0,
  S1: 0.20,
  S2: 0.45,
  S3: 0.70,
  S4: 0.85,
  S5: 1.00
});

const TECH_ETF_CODES = Object.freeze(['513310', '515880', '159582']);

function bpmFromMR(mr, bas) {
  const score = mr != null ? mr : 55;
  let bpm = 0.65;
  for (const row of V32_MR_BPM) {
    if (score >= row.min) {
      bpm = row.bpm;
      break;
    }
  }
  if (bas != null && bas > 70) bpm = Math.min(1.15, bpm * 1.15);
  return round1(bpm * 1000) / 1000;
}

function riskBudgetFromMR(mr) {
  const score = mr != null ? mr : 55;
  for (const row of V32_MR_BPM) {
    if (score >= row.min) return row.riskBudget;
  }
  return 15;
}

/** Opportunity Score → OM（规格 §八）；牛市抬底；组合轨 MR>65 → 0.85 */
function omFromOS(os, mr, opts) {
  const s = os != null ? os : 70;
  let om;
  if (s < 40) om = 0;
  else if (s < 55) om = 0.30;
  else if (s < 65) om = 0.50;
  else if (s < 75) om = 0.70;
  else if (s < 85) om = 0.85;
  else om = 1.00;
  const marketScore = mr != null ? mr : 55;
  const params = opts && opts.params ? opts.params : {};
  const omFloorMr65 = params.v3_2_om_floor_mr65 != null ? params.v3_2_om_floor_mr65 : 0.85;
  const portfolioMode = opts && opts.portfolioMode === true;
  if (marketScore > 65) {
    om = Math.max(om, portfolioMode ? omFloorMr65 : Math.max(0.80, omFloorMr65 - 0.05));
  } else if (marketScore > 50) om = Math.max(om, 0.65);
  return om;
}

/** Core Conviction Multiplier（规格 §十） */
function ccmFromFundamental(fScore) {
  const f = (fScore != null ? fScore : 15) / 25;
  return round1((0.60 + 0.40 * f) * 1000) / 1000;
}

/**
 * 横盘整理加成（规格 §七 Tier 1/2/3）
 * Stage 4 高质量整理 → TM × 1.15
 */
function consolidationMultiplier(cs, sidewayDays, displayStage) {
  const primary = normalizePrimaryStage(displayStage);
  if (primary !== 'S4') return 1.0;
  const score = cs != null ? cs : 0;
  const days = sidewayDays != null ? sidewayDays : 0;
  if (score >= 80 && days >= 15) return 1.15;
  if (score >= 75 && days >= 12) return 1.15;
  if (score >= 65 && days >= 8) return 1.08;
  return 1.0;
}

/**
 * Breakout Score BS = 0.40P + 0.30V + 0.20H + 0.10M（规格 §十五）
 */
function computeBreakoutScore(snapshot, portfolio) {
  if (!snapshot) return 0;
  let pScore = 0;
  const pp = snapshot.price_position;
  if (pp != null && pp >= 0.95) pScore = 100;
  else if (pp != null && pp >= 0.85) pScore = 80;
  else if (pp != null && pp >= 0.75) pScore = 55;
  else if (pp != null && pp >= 0.65) pScore = 30;

  let vScore = 0;
  const vr = snapshot.volume_ratio;
  const v = snapshot.v_state || 'V3';
  if (v === 'V5' || (vr != null && vr >= 1.8)) vScore = 100;
  else if (v === 'V4' || (vr != null && vr >= 1.3)) vScore = 75;
  else if (vr != null && vr >= 1.1) vScore = 45;

  const hScore = snapshot.breakout_nd === true ? 100 : 0;

  const mr = portfolio && portfolio.market_score != null ? portfolio.market_score : 55;
  let mScore = 40;
  if (mr >= 80) mScore = 100;
  else if (mr >= 65) mScore = 80;
  else if (mr >= 50) mScore = 60;

  return Math.min(100, Math.round(0.40 * pScore + 0.30 * vScore + 0.20 * hScore + 0.10 * mScore));
}

/** 突破/主升加速系数 BM（规格 §六 Stage5 + §十五 BS≥75） */
function breakoutMultiplier(bs, displayStage, snapshot) {
  const primary = normalizePrimaryStage(displayStage);
  const breakout = snapshot && snapshot.breakout_nd === true;
  if (primary === 'S5' && breakout && bs >= 75) return 1.20;
  if (bs >= 75 && breakout) return 1.10;
  return 1.0;
}

/** Bull Floor（规格 §十二、§十三） */
function bullFloorPct(mr, bas, displayStage, cap, risk) {
  const primary = normalizePrimaryStage(displayStage);
  const stageRank = { S0: 0, S1: 1, S2: 2, S3: 3, S4: 4, S5: 5 };
  if ((stageRank[primary] || 0) < 2) return 0;
  if (risk && risk.risk_override === true) return 0;
  const marketScore = mr != null ? mr : 0;
  const activation = bas != null ? bas : 0;
  if (marketScore > 80 && activation > 70) return round1(0.50 * cap);
  if (marketScore > 65) return round1(0.30 * cap);
  return 0;
}

/** Growth Beta 上限 %（规格 §二十三） */
function growthBetaMaxFromMR(mr) {
  const score = mr != null ? mr : 55;
  if (score >= 80) return 85;
  if (score >= 65) return 70;
  if (score >= 50) return 50;
  if (score >= 35) return 35;
  return 20;
}

function isTechEtfCode(code) {
  return TECH_ETF_CODES.indexOf(code) >= 0;
}

/**
 * @param {object} input 与 computeBullParticipationTargets 兼容，额外 etfCode / consolidationScore / sidewayDays
 */
function computeV32MathTargets(input) {
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
    params = {},
    etfCode,
    consolidationScore,
    sidewayDays,
    profileType,
    portfolioMode
  } = input || {};

  const empty = (binding) => ({
    raw_target_position: 0,
    risk_adjusted_target: 0,
    final_target: 0,
    finalTarget: 0,
    binding_constraint: binding,
    factor_breakdown: { engine: 'v32_math', binding },
    gap: round1(0 - currentPosition),
    defense_cap_s7: null,
    v32_math_breakdown: { binding },
    bull_activation_score: 0,
    effective_market_regime: regime
  });

  if (falsified) return empty('falsified');

  const cap = maxPosition;
  const mr = portfolio.market_score != null ? portfolio.market_score : 55;
  const bas = computeBullActivationScore(snapshot, portfolio, params);
  let bpm = bpmFromMR(mr, bas);

  const isMacro = profileType === 'macro_driven' || profileType === 'macro';
  if (isMacro) bpm = round1(bpm * 0.70 * 1000) / 1000;

  const primary = normalizePrimaryStage(displayStage);
  let tm = V32_TM[primary] != null ? V32_TM[primary] : 0.45;
  const csMult = consolidationMultiplier(
    consolidationScore != null ? consolidationScore : snapshot.consolidation_score,
    sidewayDays != null ? sidewayDays : snapshot.sideway_days,
    displayStage
  );
  tm = round1(tm * csMult * 1000) / 1000;
  const stageRank = { S0: 0, S1: 1, S2: 2, S3: 3, S4: 4, S5: 5 };
  const rank = stageRank[primary] != null ? stageRank[primary] : 0;
  const tmFloor = params.v3_2_tm_floor_stage3 != null ? params.v3_2_tm_floor_stage3 : 0.70;
  if (rank >= 3) tm = Math.max(tm, tmFloor);
  if (bas > 70 && rank >= 3) tm = Math.max(tm, tmFloor);

  const om = omFromOS(opportunityScore, mr, { portfolioMode, params });
  const ccm = ccmFromFundamental(fScore);
  const bs = computeBreakoutScore(snapshot, portfolio);
  const bm = breakoutMultiplier(bs, displayStage, snapshot);

  let product = cap * bpm * tm * om * ccm * bm;
  const floor = bullFloorPct(mr, bas, displayStage, cap, risk);
  let rawTarget = round1(Math.max(product, floor));

  const defAdj = defenseAdjustmentPct(defenseScore);
  rawTarget = round1(Math.max(0, rawTarget - defAdj));

  let preChain = round1(Math.min(rawTarget, cap));

  if (constraints.growthBetaHeadroom != null && isTechEtfCode(etfCode)) {
    preChain = round1(Math.min(preChain, currentPosition + Math.max(0, constraints.growthBetaHeadroom)));
  }

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

  const coreRatio = ccm;

  return {
    raw_target_position: rawTarget,
    risk_adjusted_target: preChain,
    final_target: finalTarget,
    finalTarget,
    binding_constraint: binding,
    factor_breakdown: {
      engine: 'v32_math',
      cap,
      mr,
      bas,
      bpm,
      tm,
      cs_mult: csMult,
      om,
      ccm,
      bs,
      bm,
      floor,
      def_adj: defAdj,
      risk_budget_pct: riskBudgetFromMR(mr),
      core_ratio_hint: coreRatio,
      product_before_floor: round1(product)
    },
    gap: round1(finalTarget - currentPosition),
    defense_cap_s7: defenseCapS7,
    v32_math_breakdown: {
      cap,
      mr,
      bas,
      bpm,
      tm,
      cs_mult: csMult,
      om,
      ccm,
      bs,
      bm,
      floor,
      def_adj: defAdj,
      raw_target: rawTarget,
      pre_chain: preChain,
      binding: binding || 'none'
    },
    bull_activation_score: bas,
    effective_market_regime: regime,
    breakout_score: bs
  };
}

/** Bull Participation Rate：牛市期实际敞口 / 目标敞口 */
function computeBPR(days) {
  const bullDays = (days || []).filter((d) => d.is_bull);
  if (!bullDays.length) return { bpr: null, n: 0 };
  let actualSum = 0;
  let targetSum = 0;
  bullDays.forEach((d) => {
    actualSum += d.actual_exposure != null ? d.actual_exposure : 0;
    targetSum += d.target_exposure != null ? d.target_exposure : 0;
  });
  const bpr = targetSum > 0 ? actualSum / targetSum : null;
  return { bpr: bpr != null ? round1(bpr * 1000) / 10 : null, n: bullDays.length };
}

/** Bull Capture Ratio：策略牛市收益 / 基准牛市收益 */
function computeBCR(strategyBullRet, benchmarkBullRet) {
  if (benchmarkBullRet == null || Math.abs(benchmarkBullRet) < 1e-9) return null;
  return round1((strategyBullRet / benchmarkBullRet) * 1000) / 10;
}

/** 突破加仓步长：BS≥75 时 15–25% Cap（规格 §十五） */
function breakoutAddStepPct(cap, bs, params) {
  const c = cap != null ? cap : 30;
  const minPct = params && params.v3_2_breakout_add_min_pct != null ? params.v3_2_breakout_add_min_pct : 15;
  const maxPct = params && params.v3_2_breakout_add_max_pct != null ? params.v3_2_breakout_add_max_pct : 25;
  if (bs == null || bs < 75) return null;
  const t = (bs - 75) / 25;
  const pct = minPct + t * (maxPct - minPct);
  return round1(Math.min(c * maxPct / 100, Math.max(c * minPct / 100, c * pct / 100)));
}

/**
 * V3.2 Bull Mode 动作层：Bull Floor / BS≥75 / MR>65+Stage≥2 时穿透 chase/structure
 */
function evaluateBullModeAction(ctx) {
  const params = ctx && ctx.params ? ctx.params : {};
  const v33Mode = params.v3_3_enabled !== false
    ? String(params.v3_3_mode || 'off').toLowerCase() : 'off';
  const v33On = v33Mode === 'b' || v33Mode === 'c' || v33Mode === 'd';
  const v34On = params.v3_4_enabled === true;
  const v35Mode = params.v3_5_enabled === true
    ? String(params.v3_5_mode || 'off').toLowerCase() : 'off';
  const v35On = v35Mode === 'b' || v35Mode === 'c' || v35Mode === 'd';
  if (!v35On && !v34On && !v33On && (params.v3_2_math_enabled === false || params.v3_2_bull_mode_action === false)) {
    return { active: false, breakoutPrimary: false, floorActive: false, bs: 0, bas: 0, mr: 55 };
  }
  const engine = ctx.enginePath || (ctx.factor_breakdown && ctx.factor_breakdown.engine);
  const engineOk = engine === 'v32_math' || engine === 'v33' || engine === 'v33_target'
    || engine === 'v34' || engine === 'v34_stage'
    || engine === 'v35' || engine === 'v35_structural';
  if (!engineOk) {
    return { active: false, breakoutPrimary: false, floorActive: false, bs: 0, bas: 0, mr: 55 };
  }
  const portfolio = ctx.portfolio || {};
  const snapshot = ctx.snapshot || {};
  const mr = portfolio.market_score != null ? portfolio.market_score : 55;
  const bas = ctx.bull_activation_score != null ? ctx.bull_activation_score
    : computeBullActivationScore(snapshot, portfolio, params);
  const bs = ctx.breakoutScore != null ? ctx.breakoutScore : computeBreakoutScore(snapshot, portfolio);
  const display = ctx.trendStageDisplay || ctx.trendStage || 'S2';
  const primary = normalizePrimaryStage(display);
  const stageRank = { S0: 0, S1: 1, S2: 2, S3: 3, S4: 4, S5: 5 };
  const rank = stageRank[primary] != null ? stageRank[primary] : 0;
  const cap = ctx.maxStrategic != null ? ctx.maxStrategic : 30;
  const floor = bullFloorPct(mr, bas, display, cap, ctx.risk);
  const floorActive = floor > 0;
  const breakoutPrimary = bs >= 75 && snapshot.breakout_nd === true;
  const active = floorActive || breakoutPrimary
    || (mr > 65 && rank >= 2)
    || (mr > 50 && bas >= 55 && rank >= 2);
  return { active, breakoutPrimary, floorActive, bs, bas, mr, floor };
}

/** 组合 Risk Budget 下单票目标上限 */
function portfolioRiskCapForEtf(currentPos, othersBooked, mr) {
  const rb = riskBudgetFromMR(mr);
  return round1(Math.max(currentPos, rb - othersBooked));
}

/**
 * 牛市急跌保护（规格 §十六）：MR≥65 + Stage≥3 + 趋势未破 → 不 STRATEGIC_REDUCE
 */
function evaluateBullPullbackHold(ctx) {
  const params = ctx && ctx.params ? ctx.params : {};
  if (params.v3_2_bull_pullback_hold === false) return { hold: false, reason: null };

  const portfolio = ctx.portfolio || {};
  const mr = portfolio.market_score != null ? portfolio.market_score : 0;
  if (mr < 65) return { hold: false, reason: null };

  const display = ctx.trendStageDisplay || ctx.trendStage || 'S2';
  const primary = normalizePrimaryStage(display);
  const stageRank = { S0: 0, S1: 1, S2: 2, S3: 3, S4: 4, S5: 5 };
  if ((stageRank[primary] || 0) < 3) return { hold: false, reason: null };

  const shock = ctx.shockContext || {};
  if (shock.structuralBreak === true) return { hold: false, reason: null };

  const snapshot = ctx.snapshot || {};
  if (snapshot.ma20_slope != null && snapshot.ma20_slope < -1) return { hold: false, reason: null };
  if (snapshot.bias_20d != null && snapshot.bias_20d < -5) return { hold: false, reason: null };

  const ma60 = snapshot.ma60;
  const closeApprox = snapshot.ma20 != null && snapshot.bias_20d != null
    ? snapshot.ma20 * (1 + snapshot.bias_20d / 100) : null;
  if (ma60 != null && closeApprox != null && closeApprox < ma60 * 0.96) {
    return { hold: false, reason: null };
  }

  const w = snapshot.w_state || 'W3';
  const recoveryPullback = shock.blocksStrategicReduce === true || shock.recoveryActive === true;
  const hvdPullback = snapshot.high_volume_decline === true
    && (w === 'W1' || w === 'W2' || w === 'W3')
    && (primary === 'S3' || primary === 'S4' || primary === 'S5');
  const shockTodaySoft = shock.shockToday === true && shock.shockLabel !== 'extreme'
    && shock.recoveryLabel !== 'failed';

  if (recoveryPullback || hvdPullback || shockTodaySoft) {
    return { hold: true, reason: recoveryPullback ? 'bull_recovery' : (hvdPullback ? 'bull_hvd' : 'bull_shock') };
  }
  return { hold: false, reason: null };
}

function shouldBlockStrategicReduce(ctx) {
  const bp = evaluateBullPullbackHold(ctx);
  return bp.hold === true;
}

module.exports = {
  V32_MR_BPM,
  V32_TM,
  TECH_ETF_CODES,
  bpmFromMR,
  riskBudgetFromMR,
  omFromOS,
  ccmFromFundamental,
  consolidationMultiplier,
  computeBreakoutScore,
  breakoutMultiplier,
  bullFloorPct,
  growthBetaMaxFromMR,
  isTechEtfCode,
  computeV32MathTargets,
  computeBPR,
  computeBCR,
  breakoutAddStepPct,
  evaluateBullModeAction,
  evaluateBullPullbackHold,
  shouldBlockStrategicReduce,
  portfolioRiskCapForEtf
};
