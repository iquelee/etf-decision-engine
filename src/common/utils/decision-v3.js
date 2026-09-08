/**
 * V3.0 v1.1 P5 生产决策路径（TrendStage + 三阶段仓位 + Defense/Shock + MarketRegime）
 * 由 runDecisionEngine 在 trend_stage_enabled / v3_shadow_enabled 下调用。
 */
'use strict';

const base = require('./decision.js');
const { DEFAULT_PARAMS, TECH_SECTORS, ADD_THRESHOLD_PCT, ADD_STEP_PCT, ADD_TREND_STEP_PCT, ADD_BREAKOUT_MAX_PCT, BUILD_FIRST_LOT_PCT, TREND_CONTEXTS } = require('../constants.js');
const {
  resolveTrendStage, getStageFactor, getStageAcceleration, marketFactor
} = require('./trend-stage.js');
const {
  computePositionTargets, oppFactorFromGrade, riskFactorFromRisk, round1, applyMfSfGradeFloor
} = require('./position-sizing.js');
const { computeTrendFirstTargets, computeTrendFirstCoreTrade } = require('./v3-trend-first-position.js');
const {
  computeBullParticipationTargets,
  computeBullActivationScore,
  resolveEffectiveRegime,
  BULL_TIER
} = require('./v3-bull-participation.js');
const {
  computeV32MathTargets,
  growthBetaMaxFromMR,
  isTechEtfCode,
  evaluateBullModeAction,
  breakoutAddStepPct,
  evaluateBullPullbackHold,
  shouldBlockStrategicReduce
} = require('./v3-2-math-engine.js');
const { computeV33Targets } = require('./v3-3-target-exposure.js');
const { computeV34Targets } = require('./v3-4-stage-position-engine.js');
const { computeV35Targets } = require('./v3-5-structural-engine.js');
const {
  getEtfProfile, isMacroDriven, shouldTacticalReduce, shouldStrategicReduce, profileMaxPosition, addThresholdPct
} = require('./etf-profile.js');
const { computeDefenseScore, computeDefenseStateV3 } = require('./defense.js');
const {
  evaluateShockContext, resolveHighVolumeDeclineAction, findShockIdxFromState
} = require('./shock-filter.js');
const { classifyPremiumTier, downgradeGrade, premiumTierLabel } = require('./v3-premium.js');
const { swingHighLow, rsUpProxy } = require('./trend-stage.js');
const { O3_OPPORTUNITY_FACTORS, midFactor } = require('./v3-shadow.js');

function resolveEffectiveMarketFactor(portfolio, stage, profile) {
  const regime = portfolio.market_regime || 'range';
  let mf = portfolio.market_factor != null
    ? portfolio.market_factor
    : marketFactor(regime);
  if (isMacroDriven(profile) && stage !== 'S0' && stage !== 'S7' && regime !== 'crisis' && regime !== 'defensive') {
    mf = Math.max(mf, 0.95);
  }
  return mf;
}

function profileApplies(code) {
  return code === '518880';
}

/**
 * P0 牛市参与度：仅 V3/Shadow 路径合并参数，不改动 V3.8 生产。
 * v3_first_lot_breakout 默认 true → first_lot_breakout 对 V3 生效。
 */
function resolveV3BullParams(params) {
  const p = params && typeof params === 'object' ? { ...params } : {};
  if (p.v3_first_lot_breakout === false) {
    p.first_lot_breakout = false;
  } else if (p.first_lot_breakout !== true) {
    p.first_lot_breakout = true;
  }
  return p;
}

/** 组合模式：多票 Shadow 走保守轨（单票上限/现金底/Stage Base） */
function isV3PortfolioMode(portfolio, params) {
  if (!params || params.v3_dual_track_enabled === false) return false;
  if (params.v3_force_single_track === true) return false;
  if (params.v3_force_portfolio_track === true) return true;
  if (portfolio && portfolio.multi_etf === true) return true;
  if (portfolio && portfolio.etf_count != null && portfolio.etf_count > 1) return true;
  return false;
}

/** 按单票/组合轨合并有效 Shadow 参数 */
function resolveV3EffectiveParams(params, portfolio) {
  const base = resolveV3BullParams(params);
  if (!isV3PortfolioMode(portfolio, base)) return base;
  const p = { ...base };

  if (base.v3_portfolio_p0_only !== false) {
    const firstLot = base.v3_portfolio_build_first_lot_pct != null
      ? base.v3_portfolio_build_first_lot_pct : 10;
    p.v3_v31_raise_stage_base = false;
    p.v3_build_first_lot_pct = firstLot;
    p.v3_add_breakout_max_pct = ADD_BREAKOUT_MAX_PCT;
    p.v3_add_trend_step_pct = ADD_TREND_STEP_PCT;
    p.v3_momentum_accel_max_pct = 10;
    p.v3_s6_probe_hold_pct = firstLot;
    p.v3_rally_gap_accel_min = 15;
    p.v3_chase_rally_relax = false;
    p.v3_cash_floor_relax = false;
    return p;
  }

  if (base.v3_portfolio_raise_stage_base === false) p.v3_v31_raise_stage_base = false;
  if (base.v3_portfolio_build_first_lot_pct != null) {
    p.v3_build_first_lot_pct = base.v3_portfolio_build_first_lot_pct;
  }
  if (base.v3_portfolio_cash_min_aggressive != null) {
    p.v3_cash_min_aggressive = base.v3_portfolio_cash_min_aggressive;
  }
  return p;
}

function resolveV3SingleMax(params, portfolio) {
  if (isV3PortfolioMode(portfolio, params)) {
    if (params && params.v3_portfolio_p0_only !== false && params.v3_portfolio_p0_single_max != null) {
      return params.v3_portfolio_p0_single_max;
    }
    if (params && params.v3_portfolio_single_etf_max != null) {
      return params.v3_portfolio_single_etf_max;
    }
  }
  if (params && params.v3_single_etf_max != null) return params.v3_single_etf_max;
  return params && params.single_etf_max != null ? params.single_etf_max : DEFAULT_PARAMS.single_etf_max;
}

function resolveV3BuildFirstLot(params) {
  return params && params.v3_build_first_lot_pct != null
    ? params.v3_build_first_lot_pct : BUILD_FIRST_LOT_PCT;
}

function resolveV3AddBreakoutMax(params) {
  if (params && params.v3_add_breakout_max_pct != null) return params.v3_add_breakout_max_pct;
  return params && params.add_breakout_max_pct != null ? params.add_breakout_max_pct : ADD_BREAKOUT_MAX_PCT;
}

function resolveV3AddTrendStep(params) {
  return params && params.v3_add_trend_step_pct != null
    ? params.v3_add_trend_step_pct : ADD_TREND_STEP_PCT;
}

/**
 * Shadow cash_floor：按「当前仓 + 可动用现金」设上限。
 * bull 态现金底更低（5%）；crisis+Recovery 不锁死；无 cash_ratio 时 bull 不额外压仓。
 */
function resolveV3CashFloorMax(portfolio, params, bullScore, regime, currentPosition) {
  if (!params || params.v3_cash_floor_relax === false) return null;
  const r = regime || (portfolio && portfolio.market_regime) || 'range';
  const recovery = bullScore != null && bullScore >= BULL_TIER.recovery;
  if (r === 'crisis' && recovery) return null;

  let cashMin;
  const portfolioMode = isV3PortfolioMode(portfolio, params);
  if (r === 'aggressive' || r === 'structural') {
    if (portfolioMode && params.v3_portfolio_cash_min_aggressive != null) {
      cashMin = params.v3_portfolio_cash_min_aggressive;
    } else {
      cashMin = params.v3_cash_min_aggressive != null ? params.v3_cash_min_aggressive : 5;
    }
  } else if (r === 'recovery') {
    cashMin = params.v3_cash_min_recovery != null ? params.v3_cash_min_recovery : 20;
  } else if (r === 'crisis') {
    cashMin = params.v3_cash_min_crisis != null ? params.v3_cash_min_crisis : 50;
  } else if (r === 'defensive') {
    cashMin = params.v3_cash_min_defensive != null ? params.v3_cash_min_defensive : 30;
  } else {
    cashMin = params.v3_cash_min_range != null ? params.v3_cash_min_range : 15;
  }

  const cashRatio = portfolio && portfolio.cash_ratio != null ? portfolio.cash_ratio : null;
  const cur = currentPosition != null ? currentPosition : 0;
  if (cashRatio == null) {
    // 单票回测无组合账面时：bull 不压；防守/危机用 100−cashMin
    if (r === 'aggressive' || r === 'structural' || r === 'range' || r === 'recovery') return null;
    return round1(100 - cashMin);
  }
  const deployable = Math.max(0, cashRatio - cashMin);
  return round1(cur + deployable);
}

/** Shadow：放量+突破高位时 V4/V5 加分（修 924 首日 grade=D 问题） */
function scoreVolumeV3(hState, vState, flags, params) {
  let score = base.scoreVolume(hState, vState, flags);
  if (!params || params.v3_volume_breakout_bonus === false) return score;
  const snap = flags || {};
  if (snap.breakout_nd === true && snap.price_position != null && snap.price_position > 0.8) {
    if (vState === 'V4') score = Math.max(score, 22);
    if (vState === 'V5') score = Math.max(score, 20);
  }
  return score;
}

/** S6 overlay：仅当 sizing 目标相较昨日确实下降时才允许减仓 */
function s6OverlayTargetAllowsReduce(ctx) {
  const params = ctx.params || {};
  if (params.v3_s6_target_consistency === false) return true;
  const prev = ctx.positions && ctx.positions.prev_final_target;
  const cur = ctx.finalTarget != null ? ctx.finalTarget : 0;
  if (prev == null) {
    const current = (ctx.positions && ctx.positions.current_position) || 0;
    return cur < current - 0.5;
  }
  return cur < prev - 0.5;
}

/** S6 overlay 下 primary=S4/S5 主升穿透：目标仍高于持仓时允许继续 ADD */
function allowS6ConfirmedRallyAdd(ctx) {
  const params = ctx.params || {};
  if (params.v3_s6_confirmed_rally_add === false) return false;
  const primary = ctx.trendStage || 'S2';
  const display = ctx.trendStageDisplay || primary;
  if (display !== 'S6') return false;
  if (primary !== 'S4' && primary !== 'S5') return false;
  const w = (ctx.snapshot && ctx.snapshot.w_state) || 'W3';
  if (w !== 'W1' && w !== 'W2' && w !== 'W3') return false;
  const current = (ctx.positions && ctx.positions.current_position) || 0;
  const finalTarget = ctx.finalTarget != null ? ctx.finalTarget : 0;
  return finalTarget > current + 1.5;
}

/** 924 型首仓突破：Shadow 默认允许 V5 爆量（v3_flb_allow_v5） */
function isFirstLotBreakoutV3(snapshot, positions, params) {
  if (params.first_lot_breakout !== true) return false;
  const current = (positions.current_position || 0);
  if (current > 0) return false;
  const w = snapshot.w_state || 'W3';
  const v = snapshot.v_state || 'V3';
  const pp = snapshot.price_position;
  if (w !== 'W3' || snapshot.breakout_nd !== true) return false;
  if (pp == null || pp <= 0.8) return false;
  if (snapshot.trend_context === TREND_CONTEXTS.DOWN) return false;
  const allowV5 = params.v3_flb_allow_v5 !== false;
  return v === 'V4' || (allowV5 && v === 'V5');
}

/** S6 过热 overlay 下空仓 W1/W2 首仓例外（gap≥BUILD_FIRST_LOT_PCT） */
function allowS6EmptyBuild(ctx) {
  const params = ctx.params || {};
  if (params.v3_s6_empty_build === false) return false;
  const current = (ctx.positions && ctx.positions.current_position) || 0;
  if (current > 0) return false;
  const w = (ctx.snapshot && ctx.snapshot.w_state) || 'W3';
  if (w !== 'W1' && w !== 'W2') return false;
  const gap = ctx.gap != null ? ctx.gap : 0;
  const finalTarget = ctx.finalTarget != null ? ctx.finalTarget : 0;
  if (finalTarget <= 0 || gap < resolveV3BuildFirstLot(params)) return false;
  if ((ctx.eligibilityOverall || 'allow') !== 'allow') return false;
  const regime = (ctx.portfolio && ctx.portfolio.market_regime) || 'range';
  if (regime === 'crisis') return false;
  return true;
}

/** 试探仓上限（默认 = 首仓 BUILD 上限 8%） */
function s6ProbeCapPct(params) {
  return params && params.v3_s6_probe_hold_pct != null
    ? params.v3_s6_probe_hold_pct
    : resolveV3BuildFirstLot(params);
}

/** S6 试探仓保护仅在本轮主升/冷启动后急涨（S0/S4/S5 主状态）生效 */
function s6ProbeRallyContext(ctx) {
  const primary = ctx.trendStage || 'S2';
  return primary === 'S0' || primary === 'S4' || primary === 'S5';
}

/** S6 下已有试探小仓（≤8%）— 禁止 TACTICAL_REDUCE，改 HOLD */
function isS6ProbePosition(ctx) {
  const params = ctx.params || {};
  if (params.v3_s6_probe_hold === false) return false;
  if (!s6ProbeRallyContext(ctx)) return false;
  const current = (ctx.positions && ctx.positions.current_position) || 0;
  return current > 0 && current <= s6ProbeCapPct(params);
}

/**
 * S6 下试探仓允许穿透 overlay 走 ADD（W1/W2；W3 仅在 rally gap 加速时）
 */
function allowS6ProbeContinue(ctx) {
  const params = ctx.params || {};
  if (params.v3_s6_probe_hold === false) return false;
  if (!s6ProbeRallyContext(ctx)) return false;
  const current = (ctx.positions && ctx.positions.current_position) || 0;
  if (current <= 0 || current > s6ProbeCapPct(params)) return false;
  const w = (ctx.snapshot && ctx.snapshot.w_state) || 'W3';
  const finalTarget = ctx.finalTarget != null ? ctx.finalTarget : 0;
  const gap = ctx.gap != null ? ctx.gap : Math.max(0, finalTarget - current);
  const minGap = params.v3_rally_gap_accel_min != null ? params.v3_rally_gap_accel_min : 15;
  const rallyGap = params.v3_rally_gap_accel !== false && gap >= minGap;
  if (w !== 'W1' && w !== 'W2' && !(rallyGap && w === 'W3')) return false;
  if (finalTarget <= current) return false;
  const regime = (ctx.portfolio && ctx.portfolio.market_regime) || 'range';
  if (regime === 'crisis') return false;
  return true;
}

/** S6 overlay 下 gap 足够大时强制加速（924：display=S6 但 primary=S4/S5） */
function shouldRallyGapAccelerate(ctx, params) {
  const p = params || ctx.params || {};
  if (p.v3_rally_gap_accel === false) return false;
  const gap = ctx.gap != null ? ctx.gap : 0;
  const minGap = p.v3_rally_gap_accel_min != null ? p.v3_rally_gap_accel_min : 15;
  if (gap < minGap) return false;
  const stage = ctx.trendStage || 'S2';
  const display = ctx.trendStageDisplay || stage;
  if (display !== 'S6') return false;
  return stage === 'S4' || stage === 'S5' || stage === 'S0';
}

function rallyGapAllowsAdd(ctx, eligibilityOverall) {
  if (eligibilityOverall === 'forbid') return false;
  if (!shouldRallyGapAccelerate(ctx, ctx.params)) return false;
  if (eligibilityOverall === 'allow') return true;
  return eligibilityOverall === 'pause';
}

/** P1：主升/突破 + 强周线时抬 MF 下限，避免 range(0.7) 过度压仓 */
function applyBullMfFloor(stage, wState, mf, params) {
  if (!params || params.v3_bull_mf_floor === false) return mf;
  const w = wState || 'W3';
  if (stage === 'S5' && (w === 'W1' || w === 'W2')) {
    const floor = params.v3_bull_mf_floor_value != null ? params.v3_bull_mf_floor_value : 0.85;
    return Math.max(mf != null ? mf : 0, floor);
  }
  return mf != null ? mf : 0;
}

/**
 * P1-B 主升加速器（数学规格书 §32）：S5 强趋势日允许更大 ADD 步长。
 * Shadow 默认开（v3_momentum_acceleration）；Defense>60 / 破坏 overlay / 极端溢价禁。
 */
function evaluateMomentumAcceleration(ctx) {
  const {
    snapshot = {}, fundamental = {}, params = {}, scores = {},
    trendStage, trendStageOverlay, defenseScore
  } = ctx;
  if (!params || params.v3_momentum_acceleration === false) return false;
  if (trendStage !== 'S5') return false;
  if (trendStageOverlay === 'broken' || trendStageOverlay === 'shock') return false;
  if (defenseScore != null && defenseScore > 60) return false;
  if (classifyPremiumTier(snapshot.premium_rate) === 'extreme') return false;

  const trendScore = scores.trend != null ? scores.trend : 0;
  const fundScore = fundamental.f_score != null ? fundamental.f_score : 0;
  const vol = snapshot.volume_ratio;
  const w = snapshot.w_state || 'W3';

  if (trendScore < 22) return false;
  if (fundScore < 20) return false;
  if (snapshot.breakout_nd !== true) return false;
  if (vol == null || vol <= 1.2) return false;
  const rsStrong = w === 'W1' || w === 'W2' || rsUpProxy(snapshot);
  return rsStrong;
}

function resolveProfile(etf) {
  const code = (etf && etf.code) || '';
  return profileApplies(code) ? getEtfProfile(etf) : null;
}

/** V3.2 Bull Participation 路径（成长 ETF，非宏观） */
function shouldUseV32(ctx, params, profile) {
  if (params.v3_v32_enabled === false || isMacroDriven(profile)) return false;
  return true;
}

/** V3.2 乘法数学引擎：单票/组合自动分轨 */
function shouldUseV32Math(params, portfolio) {
  if (shouldUseV35(params, portfolio) || shouldUseV34(params, portfolio) || shouldUseV33(params, portfolio)) return false;
  if (!params || params.v3_2_math_enabled === false) return false;
  if (params.v3_2_math_auto_track === false) return true;
  if (isV3PortfolioMode(portfolio, params)) {
    return params.v3_2_math_portfolio_enabled === true;
  }
  return params.v3_2_math_single_enabled !== false;
}

/** V3.3 加法目标敞口：mode=b|c|d */
function shouldUseV33(params, portfolio) {
  if (shouldUseV35(params, portfolio) || shouldUseV34(params, portfolio)) return false;
  if (!params || params.v3_3_enabled === false) return false;
  const mode = String(params.v3_3_mode || 'off').toLowerCase();
  if (mode === 'off' || mode === 'a') return false;
  if (mode !== 'b' && mode !== 'c' && mode !== 'd') return false;
  if (params.v3_3_auto_track !== false && isV3PortfolioMode(portfolio, params)) {
    return params.v3_3_portfolio_enabled === true;
  }
  return true;
}

/** 单票 Alpha 测试：Cap=100% */
function resolveV33Cap(params, portfolio, maxStrategic) {
  if (params && params.v3_5_enabled === true && shouldUseV35(params, portfolio)) {
    if (params.v3_5_single_full_cap !== false && !isV3PortfolioMode(portfolio, params)) {
      return params.v3_5_single_cap != null ? params.v3_5_single_cap : 100;
    }
  }
  if (params && params.v3_4_enabled === true && shouldUseV34(params, portfolio)) {
    if (params.v3_4_single_full_cap !== false && !isV3PortfolioMode(portfolio, params)) {
      return params.v3_4_single_cap != null ? params.v3_4_single_cap : 100;
    }
  }
  if (params && params.v3_3_single_full_cap !== false && !isV3PortfolioMode(portfolio, params)) {
    return params.v3_3_single_cap != null ? params.v3_3_single_cap : 100;
  }
  return maxStrategic;
}

/** V3.4 Stage Position Engine */
function shouldUseV34(params, portfolio) {
  if (shouldUseV35(params, portfolio)) return false;
  if (!params || params.v3_4_enabled !== true) return false;
  if (params.v3_4_auto_track !== false && isV3PortfolioMode(portfolio, params)) {
    return params.v3_4_portfolio_enabled === true;
  }
  return true;
}

/** V3.5 Structural：mode=b|c|d */
function shouldUseV35(params, portfolio) {
  if (!params || params.v3_5_enabled !== true) return false;
  const mode = String(params.v3_5_mode || 'off').toLowerCase();
  if (mode !== 'b' && mode !== 'c' && mode !== 'd') return false;
  if (params.v3_5_auto_track !== false && isV3PortfolioMode(portfolio, params)) {
    return params.v3_5_portfolio_enabled === true;
  }
  return true;
}

/** V3.1 趋势阶段启用；S0 冷启动 + S2 W1/W2 + S3+ */
function shouldUseTrendFirst(ctx, params, profile) {
  if (shouldUseV32(ctx, params, profile)) return true;
  if (params.v3_trend_first_enabled === false || isMacroDriven(profile)) return false;
  const stage = ctx.trendStage || 'S2';
  const display = ctx.trendStageDisplay || stage;
  const w = (ctx.snapshot && ctx.snapshot.w_state) || 'W3';
  const regime = (ctx.portfolio && ctx.portfolio.market_regime) || 'range';
  if (display === 'S7') return false;
  if (display === 'S3' || display === 'S4' || display === 'S5' || display === 'S6') return true;
  if (stage === 'S2' && (w === 'W1' || w === 'W2')) return true;
  if (params.v3_v31_s0_cold_start !== false && (display === 'S0' || stage === 'S0')
    && (w === 'W1' || w === 'W2' || w === 'W3') && regime !== 'crisis') return true;
  return false;
}

/** S0 冷启动在 V3.1 路径下按 S2 基础仓计 */
function v31EffectiveDisplayStage(ctx, params, profile) {
  const stage = ctx.trendStage || 'S2';
  const display = ctx.trendStageDisplay || stage;
  if (params.v3_v31_s0_cold_start !== false && shouldUseTrendFirst(ctx, params, profile)
    && (display === 'S0' || stage === 'S0')) return 'S2';
  return display;
}

function patchGenerateTargetPosition(ctx) {
  const { positions = {}, params = {}, risk = {}, portfolio = {}, etf = {}, fundamental = {}, snapshot = {} } = ctx;
  let grade = base.gradeOpportunity(ctx.opportunityScore);
  const premiumTier = classifyPremiumTier(snapshot.premium_rate);
  if (process.env.V3_ABL_NO_PREM_DOWN !== '1' && premiumTier === 'warning') {
    grade = downgradeGrade(grade);
  }
  const profile = ctx.etfProfile != null ? ctx.etfProfile : resolveProfile(etf);

  if (fundamental.f_state === 'F5') {
    const zero = computePositionTargets({ falsified: true, currentPosition: positions.current_position || 0 });
    return {
      grade: 'F', factor: 0, range: { target_min: 0, target_std: 0, target_max: 0 },
      ...zero,
      gap: zero.gap,
      stage_factor: 0,
      market_factor: 0,
      profile_type: profile ? profile.profile_type : null
    };
  }

  let maxStrategic = positions.max_strategic_position != null ? positions.max_strategic_position
    : (positions.max_position != null ? positions.max_position
      : resolveV3SingleMax(params, portfolio));
  if (profile) maxStrategic = profileMaxPosition(maxStrategic, profile);

  const range = base.computeTargetRange(maxStrategic, grade, params);
  let oppFactor = oppFactorFromGrade(grade, params);
  const riskFactor = riskFactorFromRisk(risk);

  const stage = ctx.trendStage || 'S2';
  const displayStage = ctx.trendStageDisplay || stage;
  const overlay = ctx.trendStageOverlay || 'normal';
  let sf = getStageFactor(stage);
  const regime = portfolio.market_regime || 'range';
  if (params.v3_o3_regime_shadow !== false
    && (regime === 'structural' || regime === 'aggressive')) {
    const o3 = midFactor(O3_OPPORTUNITY_FACTORS, grade);
    if (o3 != null) oppFactor = o3;
  }
  let mf = resolveEffectiveMarketFactor(portfolio, stage, profile);
  mf = applyBullMfFloor(stage, snapshot.w_state, mf, params);
  const gradeFloor = applyMfSfGradeFloor(mf, sf, grade);
  mf = gradeFloor.marketFactor;
  sf = gradeFloor.stageFactor;

  const current = positions.current_position || 0;
  const w = snapshot.w_state || 'W3';
  let singleMax = profile
    ? profileMaxPosition(resolveV3SingleMax(params, portfolio), profile)
    : resolveV3SingleMax(params, portfolio);

  if (shouldUseV33(params, portfolio) || shouldUseV34(params, portfolio) || shouldUseV35(params, portfolio)) {
    const v33Cap = resolveV33Cap(params, portfolio, maxStrategic);
    maxStrategic = v33Cap;
    singleMax = profile ? profileMaxPosition(v33Cap, profile) : v33Cap;
  }

  const isRally = stage === 'S4' || stage === 'S5' || displayStage === 'S6';

  if (isMacroDriven(profile) && !isRally) {
    const cappedPos = {
      ...positions,
      max_strategic_position: maxStrategic,
      max_position: singleMax,
      target_max: singleMax
    };
    const baseline = base.generateTargetPosition({ ...ctx, positions: cappedPos });
    return {
      ...baseline,
      raw_target_position: baseline.finalTarget,
      risk_adjusted_target: baseline.finalTarget,
      final_target: baseline.finalTarget,
      binding_constraint: null,
      factor_breakdown: { mf, sf, of: baseline.factor, ff: 1, dp: 1, rf: riskFactor },
      stage_factor: sf,
      market_factor: mf,
      profile_type: profile.profile_type
    };
  }

  let sectorCap = singleMax;
  const sector = etf.sector || '';
  if (TECH_SECTORS.indexOf(sector) >= 0) {
    const techMax = portfolio.effective_tech_cap != null
      ? portfolio.effective_tech_cap
      : (params.tech_sector_max != null ? params.tech_sector_max : DEFAULT_PARAMS.tech_sector_max);
    const techPos = portfolio.tech_position != null ? portfolio.tech_position : 0;
    sectorCap = ctx.sectorRemainingLimit != null
      ? Math.max(0, ctx.sectorRemainingLimit)
      : Math.max(0, techMax - (techPos - current));
  }

  if (shouldUseTrendFirst(ctx, params, profile)) {
    const v31Display = v31EffectiveDisplayStage(ctx, params, profile);
    const bullScorePre = computeBullActivationScore(snapshot, portfolio, params);
    const cashFloorMax = resolveV3CashFloorMax(
      portfolio, params, bullScorePre, regime, current
    );
    const etfCode = (etf && etf.code) || '';
    const mr = portfolio.market_score != null ? portfolio.market_score : 55;
    let growthBetaHeadroom = null;
    if (isTechEtfCode(etfCode) && portfolio.multi_etf === true) {
      const techPos = portfolio.tech_position != null ? portfolio.tech_position : 0;
      const gbMax = growthBetaMaxFromMR(mr);
      growthBetaHeadroom = Math.max(0, gbMax - techPos);
    }
    const portfolioMode = isV3PortfolioMode(portfolio, params);
    const sizingInput = {
      maxPosition: maxStrategic,
      displayStage: v31Display,
      opportunityScore: ctx.opportunityScore,
      defenseScore: ctx.defenseScore,
      regime,
      currentPosition: current,
      snapshot,
      portfolio,
      constraints: {
        etfMax: singleMax,
        sectorCap,
        correlationCap: ctx.correlationCap,
        portfolioRiskCap: ctx.portfolioRiskCap,
        cashFloorMax,
        growthBetaHeadroom
      },
      risk,
      overlay,
      wState: snapshot.w_state,
      falsified: false,
      fScore: fundamental.f_score,
      params,
      etfCode,
      consolidationScore: snapshot.consolidation_score,
      sidewayDays: snapshot.sideway_days,
      profileType: profile ? profile.profile_type : null,
      portfolioMode,
      trendQualityScore: ctx.trendQualityScore,
      positions
    };
    const v35On = shouldUseV35(params, portfolio);
    const v34On = !v35On && shouldUseV34(params, portfolio);
    const v33On = !v35On && !v34On && shouldUseV33(params, portfolio);
    const v32On = shouldUseV32(ctx, params, profile);
    const v32MathOn = !v35On && !v34On && !v33On && v32On && shouldUseV32Math(params, portfolio);
    const sizing = v35On
      ? computeV35Targets(sizingInput)
      : (v34On
        ? computeV34Targets(sizingInput)
        : (v33On
          ? computeV33Targets(sizingInput)
          : (v32MathOn
            ? computeV32MathTargets(sizingInput)
            : (v32On
              ? computeBullParticipationTargets(sizingInput)
              : computeTrendFirstTargets(sizingInput)))));

    let finalTarget = sizing.final_target;
    const bullScore = sizing.bull_activation_score != null
      ? sizing.bull_activation_score
      : computeBullActivationScore(snapshot, portfolio, params);
    if (v32On && bullScore >= BULL_TIER.recovery && finalTarget > 0) {
      finalTarget = round1(Math.max(finalTarget, 5));
    } else if (stage === 'S2' && (w === 'W1' || w === 'W2') && finalTarget > 0) {
      finalTarget = round1(Math.max(finalTarget, resolveV3BuildFirstLot(params)));
    }

    const breakdown = sizing.v35_breakdown || sizing.v34_breakdown || sizing.v33_breakdown || sizing.v32_math_breakdown || sizing.v32_breakdown || sizing.v31_breakdown;
    const ceiling = breakdown && breakdown.pre_chain != null
      ? breakdown.pre_chain
      : (breakdown && breakdown.ceiling != null ? breakdown.ceiling : maxStrategic);
    const displayRange = {
      target_min: round1(Math.max(0, finalTarget * 0.7)),
      target_std: sizing.raw_target_position,
      target_max: round1(Math.min(maxStrategic, ceiling))
    };

    return {
      grade,
      factor: oppFactor,
      range: displayRange,
      finalTarget,
      gap: round1(finalTarget - current),
      raw_target_position: sizing.raw_target_position,
      risk_adjusted_target: sizing.risk_adjusted_target,
      final_target: finalTarget,
      binding_constraint: sizing.binding_constraint,
      factor_breakdown: sizing.factor_breakdown,
      v31_breakdown: sizing.v31_breakdown,
      v32_breakdown: sizing.v32_breakdown,
      v32_math_breakdown: sizing.v32_math_breakdown,
      v33_breakdown: sizing.v33_breakdown,
      v34_breakdown: sizing.v34_breakdown,
      v35_breakdown: sizing.v35_breakdown,
      core_ratio_hint: sizing.core_ratio_hint,
      bull_activation_score: sizing.bull_activation_score,
      breakout_score: sizing.breakout_score,
      effective_market_regime: sizing.effective_market_regime,
      defense_cap_s7: sizing.defense_cap_s7,
      stage_factor: getStageFactor(stage),
      market_factor: portfolio.market_factor != null ? portfolio.market_factor : 1,
      profile_type: profile ? profile.profile_type : null,
      premium_tier: premiumTier,
      engine_path: v35On ? 'v35_structural' : (v34On ? 'v34_stage' : (v33On ? 'v33_target' : (v32MathOn ? 'v32_math' : (v32On ? 'v32_bull_participation' : 'v31_trend_first'))))
    };
  }

  const sizing = computePositionTargets({
    maxPosition: maxStrategic,
    marketFactor: mf,
    stageFactor: sf,
    opportunityFactor: grade === 'F' ? 0 : oppFactor,
    fScore: fundamental.f_score,
    defenseScore: ctx.defenseScore,
    defensePenalty: ctx.defensePenalty,
    overlay,
    wState: snapshot.w_state,
    stage,
    grade,
    params,
    constraints: {
      etfMax: singleMax,
      sectorCap,
      correlationCap: ctx.correlationCap,
      portfolioRiskCap: ctx.portfolioRiskCap,
      cashFloorMax: resolveV3CashFloorMax(
        portfolio, params, computeBullActivationScore(snapshot, portfolio, params), regime, current
      )
    },
    currentPosition: current,
    regime,
    risk
  });

  let finalTarget = sizing.final_target;
  if (stage === 'S2' && (w === 'W1' || w === 'W2') && finalTarget > 0) {
    finalTarget = round1(Math.max(finalTarget, resolveV3BuildFirstLot(params)));
  }

  const displayRange = isRally
    ? {
      target_min: round1(maxStrategic * sf * mf * 0.7),
      target_std: sizing.raw_target_position,
      target_max: round1(maxStrategic * sf * mf)
    }
    : range;

  const factorBreakdown = { ...sizing.factor_breakdown };
  if (gradeFloor.floored) factorBreakdown.mf_sf_floor = gradeFloor.mf_sf_floor;
  if (sizing.factor_breakdown && sizing.factor_breakdown.full_chain_floor != null) {
    factorBreakdown.full_chain_floor = sizing.factor_breakdown.full_chain_floor;
  }

  return {
    grade,
    factor: oppFactor,
    range: displayRange,
    finalTarget,
    gap: round1(finalTarget - current),
    raw_target_position: sizing.raw_target_position,
    risk_adjusted_target: sizing.risk_adjusted_target,
    final_target: finalTarget,
    binding_constraint: sizing.binding_constraint,
    factor_breakdown: factorBreakdown,
    defense_cap_s7: sizing.defense_cap_s7,
    stage_factor: sf,
    market_factor: mf,
    profile_type: profile ? profile.profile_type : null,
    premium_tier: premiumTier
  };
}

function patchDetermineAddMode(ctx) {
  const { snapshot = {}, crowding = {}, positions = {}, etf = {} } = ctx;
  const stage = ctx.trendStage || 'S2';
  const profile = ctx.etfProfile != null ? ctx.etfProfile : resolveProfile(etf);
  const w = snapshot.w_state || 'W3';
  const v = snapshot.v_state || 'V3';
  const vol = snapshot.volume_ratio;

  if (crowding.premium_flag === '极端溢价') return '无';

  if (shouldUseV32Math(ctx.params, ctx.portfolio) && ctx.breakoutScore != null && ctx.breakoutScore >= 75
    && snapshot.breakout_nd === true) {
    return '突破加仓';
  }

  if (ctx.momentumAcceleration) return '主升加速';

  const grade = ctx.consolidationGrade != null ? ctx.consolidationGrade : base.gradeConsolidation(snapshot);
  if (base.isQualityConsolidation(grade)) return '横盘加仓';

  if ((stage === 'S4' || stage === 'S5') && snapshot.breakout_nd === true && vol != null && vol > 1.15) {
    return '突破加仓';
  }
  if (snapshot.breakout_nd === true && vol != null && vol > 1.2 && (w === 'W1' || w === 'W2')) {
    return '突破加仓';
  }

  if (isMacroDriven(profile)) {
    return base.determineAddMode(ctx);
  }

  if ((stage === 'S2' || stage === 'S5') && (w === 'W1' || w === 'W2') && (positions.current_position || 0) > 0
    && grade == null && v !== 'V5' && snapshot.trend_context !== 'DOWN_CONSOLIDATION') {
    return '趋势延续加仓';
  }

  return base.determineAddMode(ctx);
}

function patchCheckAddEligibility(ctx) {
  const orig = base.checkAddEligibility(ctx);
  const stage = ctx.trendStage || 'S2';
  const { snapshot = {}, positions = {}, etf = {}, params = {} } = ctx;
  const profile = ctx.etfProfile != null ? ctx.etfProfile : resolveProfile(etf);
  const w = snapshot.w_state || 'W3';
  const pp = snapshot.price_position;
  const addMode = ctx.addMode || '无';
  const items = { ...orig };
  const regime = (ctx.portfolio && ctx.portfolio.market_regime) || 'range';
  const stageDisplay = ctx.trendStageDisplay || stage;

  const chaseStages = isMacroDriven(profile)
    ? (stage === 'S2' || stage === 'S3' || stage === 'S4' || stage === 'S5')
    : (stage === 'S2' || stage === 'S4' || stage === 'S5');
  // P3：主升段 chase 放松 — S4/S5 阈值 0.98；W3 仅 display=S6 或突破日纳入
  const rallyChase = params.v3_chase_rally_relax !== false
    && (stage === 'S4' || stage === 'S5' || stageDisplay === 'S6');
  const w3ChaseOk = rallyChase && w === 'W3'
    && (stageDisplay === 'S6' || snapshot.breakout_nd === true);
  const chaseW = isMacroDriven(profile)
    ? (w === 'W1' || w === 'W2' || w === 'W3')
    : (w === 'W1' || w === 'W2' || w3ChaseOk);
  const rallyPp = params.v3_chase_pp_rally != null ? params.v3_chase_pp_rally : 0.98;
  let chasePp = isMacroDriven(profile) ? 0.96 : 0.92;
  if (stage === 'S4' || stage === 'S5') {
    chasePp = (stageDisplay === 'S6' || params.v3_chase_rally_relax !== false) ? rallyPp : chasePp;
  }

  if (chaseStages && chaseW) {
    const firstLot = (positions.current_position || 0) <= 0;
    const flBreakout = isFirstLotBreakoutV3(snapshot, positions, params);
    const mainRallyClear = rallyChase && (w === 'W1' || w === 'W2' || w3ChaseOk);
    items.chase = (firstLot || flBreakout || pp == null || pp <= chasePp
      || addMode === '突破加仓' || addMode === '趋势延续加仓' || addMode === '主升加速'
      || mainRallyClear) ? 'ok' : 'pause';
  }

  if (isMacroDriven(profile) && addMode === '横盘加仓') {
    items.structure = 'ok';
    items.volume = 'ok';
    items.trend = 'ok';
    items.chase = 'ok';
  }

  if (stage === 'S2' && (positions.current_position || 0) <= 0 && (w === 'W1' || w === 'W2')) {
    items.structure = 'ok';
    items.volume = 'ok';
    items.trend = 'ok';
  }
  const displayStg = ctx.trendStageDisplay || stage;
  if (params.v3_v31_s0_cold_start !== false && (displayStg === 'S0' || stage === 'S0')
    && (w === 'W1' || w === 'W2' || w === 'W3') && regime !== 'crisis') {
    items.structure = 'ok';
    items.volume = 'ok';
    items.trend = 'ok';
    items.regime = 'ok';
  }
  if (isMacroDriven(profile) && (stage === 'S2' || stage === 'S3' || stage === 'S5') && (positions.current_position || 0) <= 0
    && (w === 'W1' || w === 'W2' || w === 'W3')) {
    items.structure = 'ok';
    items.volume = 'ok';
    items.trend = 'ok';
  }

  if (regime === 'defensive' && chaseW && (stage === 'S4' || stage === 'S5' || stage === 'S2' || (isMacroDriven(profile) && stage === 'S3'))) {
    items.regime = 'ok';
  }
  if (isMacroDriven(profile) && regime === 'range' && (stage === 'S3' || stage === 'S5')) {
    items.regime = 'ok';
  }
  if (regime === 'crisis') {
    const tf = params.v3_trend_first_enabled !== false;
    const displayStage = ctx.trendStageDisplay || stage;
    const rallyStage = stage === 'S2' || stage === 'S3' || stage === 'S4' || stage === 'S5'
      || displayStage === 'S6';
    if (!(tf && rallyStage)) items.regime = 'pause';
  }

  const currentPos = (positions.current_position || 0);
  const s6ProbeElig = params.v3_s6_probe_hold !== false && currentPos > 0
    && currentPos <= s6ProbeCapPct(params)
    && (stage === 'S6' || stageDisplay === 'S6')
    && (w === 'W1' || w === 'W2' || w === 'W3')
    && regime !== 'crisis';
  if (s6ProbeElig) {
    items.trend = 'ok';
    items.structure = 'ok';
    items.volume = 'ok';
  }

  if (isFirstLotBreakoutV3(snapshot, positions, params)) {
    items.trend = 'ok';
    items.structure = 'ok';
    items.volume = 'ok';
    items.chase = 'ok';
  }

  // V3.2 Bull Mode：Bull Floor / BS≥75 / MR>65 穿透 chase·structure·volume（仅 v32_math）
  const bullMode = evaluateBullModeAction(ctx);
  if (bullMode.active) {
    items.trend = 'ok';
    items.structure = 'ok';
    items.volume = 'ok';
    items.chase = 'ok';
    const effRegime = resolveEffectiveRegime(regime, bullMode.bas, ctx.portfolio || {});
    if (regime !== 'crisis' || effRegime === 'recovery' || bullMode.mr > 65) items.regime = 'ok';
    if (bullMode.floorActive || bullMode.breakoutPrimary) items.fund = 'ok';
  }
  ctx.bullModeAction = bullMode;

  // V3.2 Trend-First / Recovery：趋势阶段优先；Crisis+Recovery 穿透参与禁令
  if (shouldUseTrendFirst(ctx, params, profile)) {
    const bullScore = computeBullActivationScore(snapshot, ctx.portfolio || {}, params);
    const effRegime = resolveEffectiveRegime(regime, bullScore, ctx.portfolio || {});
    const display = stageDisplay;
    const rallyDisplay = display === 'S3' || display === 'S4' || display === 'S5' || display === 'S6';
    const recoveryOk = shouldUseV32(ctx, params, profile)
      && (effRegime === 'recovery' || bullScore >= BULL_TIER.recovery);
    if (recoveryOk || rallyDisplay || (stage === 'S2' && (w === 'W1' || w === 'W2'))) {
      if (regime !== 'crisis' || recoveryOk) items.regime = 'ok';
      if (w === 'W1' || w === 'W2' || w === 'W3') {
        items.trend = 'ok';
        if (rallyDisplay || recoveryOk) {
          items.structure = 'ok';
          items.volume = 'ok';
          // P3：仅 S4/S5/S6 或 Recovery 清 chase；S3 仍走 pp 阈值
          if (params.v3_chase_rally_relax !== false) {
            const mainStage = stage === 'S4' || stage === 'S5' || display === 'S6' || recoveryOk;
            const clearChase = (w === 'W1' || w === 'W2')
              || (w === 'W3' && (display === 'S6' || snapshot.breakout_nd === true));
            if (mainStage && clearChase) items.chase = 'ok';
          }
        }
      }
    }
    if ((regime === 'crisis' && recoveryOk) || effRegime === 'recovery') items.regime = 'ok';
  }

  const premiumTier = classifyPremiumTier(snapshot.premium_rate);
  if (premiumTier === 'high' || premiumTier === 'extreme') items.chase = 'forbid';

  let overall = 'allow';
  for (const k of ['trend', 'structure', 'volume', 'fund', 'chase', 'limit', 'sector', 'risk', 'cooldown', 'regime']) {
    const st = items[k];
    if (st === 'forbid') { overall = 'forbid'; break; }
    if (st === 'pause') overall = 'pause';
  }
  return { ...items, overall };
}

function bullPullbackHoldOr(action, ctx, current) {
  if (action !== 'STRATEGIC_REDUCE' && action !== 'EXIT') return action;
  if (action === 'EXIT') return action;
  if (shouldBlockStrategicReduce(ctx)) return current > 0 ? 'HOLD' : 'WAIT';
  return action;
}

function patchRunStateMachine(ctx) {
  const { snapshot = {}, fundamental = {}, risk = {}, crowding = {}, positions = {}, etf = {} } = ctx;
  const profile = ctx.etfProfile != null ? ctx.etfProfile : resolveProfile(etf);
  const w = snapshot.w_state || 'W3';
  const f = fundamental.f_state || 'F3';
  const stage = ctx.trendStage || 'S2';
  const current = positions.current_position || 0;
  const finalTarget = ctx.finalTarget != null ? ctx.finalTarget : 0;
  const gap = ctx.gap != null ? ctx.gap : 0;
  const eligibilityOverall = ctx.eligibilityOverall || 'allow';
  const premiumTier = classifyPremiumTier(snapshot.premium_rate);

  if (risk.risk_override === true || risk.risk_flag === 'RED') {
    return f === 'F5' ? (current > 0 ? 'EXIT' : 'WAIT') : (current > 0 ? 'STRATEGIC_REDUCE' : 'WAIT');
  }
  if (f === 'F5') return current > 0 ? 'EXIT' : 'WAIT';
  if (w === 'W5') return bullPullbackHoldOr(current > 0 ? 'STRATEGIC_REDUCE' : 'WAIT', ctx, current);
  if (w === 'W4' && stage !== 'S2') {
    if (isMacroDriven(profile) && !shouldStrategicReduce(profile) && current > 0) return 'HOLD';
    return bullPullbackHoldOr(current > 0 ? 'STRATEGIC_REDUCE' : 'WAIT', ctx, current);
  }
  if (f === 'F4') {
    if (isMacroDriven(profile) && !shouldStrategicReduce(profile) && current > 0) return 'HOLD';
    return bullPullbackHoldOr(current > 0 ? 'STRATEGIC_REDUCE' : 'WAIT', ctx, current);
  }

  if (snapshot.high_volume_decline) {
    const hvd = resolveHighVolumeDeclineAction({
      snapshot,
      fundamental,
      bars: ctx.bars,
      todayIdx: ctx.todayIdx,
      lastShockIdx: ctx.lastShockIdx,
      shockContext: ctx.shockContext,
      etfProfile: profile,
      current
    });
    if (hvd.action != null && hvd.reason !== 'allow_legacy_hvd') {
      return bullPullbackHoldOr(hvd.action, ctx, current);
    }

    const ma60 = snapshot.ma60;
    const closeApprox = snapshot.ma20 != null && snapshot.bias_20d != null
      ? snapshot.ma20 * (1 + snapshot.bias_20d / 100) : null;
    const wSoft = w === 'W1' || w === 'W2' || (isMacroDriven(profile) && w === 'W3');
    if (shouldBlockStrategicReduce(ctx) && current > 0) return 'HOLD';
    if (wSoft && ma60 != null && closeApprox != null && closeApprox >= ma60 * 0.99) {
      if (isMacroDriven(profile) && !shouldTacticalReduce(profile)) return current > 0 ? 'HOLD' : 'WAIT';
      return current > 0 ? 'TACTICAL_REDUCE' : 'WAIT';
    }
    if (stage === 'S5' && wSoft) return current > 0 ? 'HOLD' : 'WAIT';
    if (isMacroDriven(profile) && current > 0) return 'HOLD';
    return bullPullbackHoldOr(current > 0 ? 'STRATEGIC_REDUCE' : 'WAIT', ctx, current);
  }

  const s6Overlay = stage === 'S6' || ctx.trendStageDisplay === 'S6'
    || (snapshot.high_volume_stagnation && stage !== 'S5' && !isMacroDriven(profile));
  if (s6Overlay && !allowS6EmptyBuild(ctx) && !allowS6ProbeContinue(ctx)) {
    if (allowS6ConfirmedRallyAdd(ctx) && (eligibilityOverall === 'allow' || rallyGapAllowsAdd(ctx, eligibilityOverall))) {
      return current <= 0 ? 'BUILD' : 'ADD';
    }
    if (rallyGapAllowsAdd(ctx, eligibilityOverall)) {
      return current <= 0 ? 'BUILD' : 'ADD';
    }
    if (isS6ProbePosition(ctx)) return 'HOLD';
    if (!s6OverlayTargetAllowsReduce(ctx)) return 'HOLD';
    return current > 0 ? 'TACTICAL_REDUCE' : 'WAIT';
  }
  if (snapshot.high_volume_stagnation && isMacroDriven(profile) && stage === 'S5') {
    return current > 0 ? 'HOLD' : 'WAIT';
  }

  if (crowding.premium_flag === '极端溢价') return current > 0 ? 'HOLD' : 'WAIT';
  if (finalTarget <= 0) {
    if (current > 0 && (w === 'W1' || w === 'W2' || w === 'W3')) return 'HOLD';
    return current > 0 ? 'EXIT' : 'WAIT';
  }

  const addMode = ctx.addMode || '无';
  const addTh = addThresholdPct(profile, ADD_THRESHOLD_PCT);

  if (premiumTier === 'extreme') return current > 0 ? 'HOLD' : 'WAIT';

  if (gap >= addTh) {
    if (premiumTier === 'high') return current > 0 ? 'HOLD' : 'WAIT';
    if (eligibilityOverall === 'allow') return current <= 0 ? 'BUILD' : 'ADD';
    if (allowS6ProbeContinue(ctx)) return current <= 0 ? 'BUILD' : 'ADD';
    const bullMode = ctx.bullModeAction || evaluateBullModeAction(ctx);
    if (bullMode.active && (bullMode.breakoutPrimary || bullMode.floorActive)) {
      return current <= 0 ? 'BUILD' : 'ADD';
    }
    if (isMacroDriven(profile) && addMode === '横盘加仓' && current <= 0 && gap >= resolveV3BuildFirstLot(params) * 0.5) {
      return 'BUILD';
    }
    return current > 0 ? 'HOLD' : 'WAIT';
  }

  const overStatus = ctx.overAllocStatus || base.computeOverAllocStatus(gap);
  if (overStatus === 'normal' || overStatus === '轻度') return 'HOLD';
  if (stage === 'S5' && (w === 'W1' || w === 'W2' || (isMacroDriven(profile) && w === 'W3')) && (overStatus === '中度' || overStatus === '明显')) return 'HOLD';
  if ((stage === 'S5' || w === 'W1' || w === 'W2') && overStatus === '中度') return 'HOLD';
  if (isMacroDriven(profile) && overStatus !== '极端') return 'HOLD';
  return 'TACTICAL_REDUCE';
}

function patchComputeTargetPosition(ctx, action) {
  const { positions = {}, params = {} } = ctx;
  const current = positions.current_position || 0;
  const finalTarget = ctx.finalTarget != null ? ctx.finalTarget
    : (positions.target_std != null ? positions.target_std : (positions.target_position || 0));
  const stage = ctx.trendStage || 'S2';
  const addMode = ctx.addMode || '无';
  const core = Math.min(positions.core_position != null ? positions.core_position : 0, current);
  const trade = Math.max(0, current - core);

  switch (action) {
    case 'EXIT': return 0;
    case 'STRATEGIC_REDUCE': {
      const w = (ctx.snapshot && ctx.snapshot.w_state) || 'W4';
      if (w === 'W5') return 0;
      return current > core ? core : current;
    }
    case 'TACTICAL_REDUCE': {
      const overStatus = ctx.overAllocStatus || '中度';
      const ratio = overStatus === '极端' ? 1.0 : (overStatus === '明显' ? 0.5 : 0.25);
      return Math.max(core, current - trade * ratio);
    }
    case 'BUILD': {
      const v31 = ctx.enginePath === 'v35_structural' || ctx.enginePath === 'v34_stage' || ctx.enginePath === 'v33_target' || ctx.enginePath === 'v32_math' || ctx.enginePath === 'v32_bull_participation' || ctx.enginePath === 'v31_trend_first'
        || (ctx.factor_breakdown && (ctx.factor_breakdown.engine === 'v35' || ctx.factor_breakdown.engine === 'v34' || ctx.factor_breakdown.engine === 'v33' || ctx.factor_breakdown.engine === 'v32' || ctx.factor_breakdown.engine === 'v31'));
      const firstLotPct = resolveV3BuildFirstLot(params);
      const firstLot = v31
        ? Math.min(finalTarget, Math.max(firstLotPct, 10))
        : firstLotPct;
      return Math.min(finalTarget, firstLot);
    }
    case 'ADD': {
      const gap = Math.max(0, finalTarget - current);
      const accel = getStageAcceleration(stage);
      let step = gap * accel;
      if (shouldRallyGapAccelerate(ctx, params)) {
        step = Math.max(step, Math.min(gap, params.v3_rally_gap_accel_min != null ? params.v3_rally_gap_accel_min : 15));
      }
      if (addMode === '横盘加仓' && isMacroDriven(ctx.etfProfile != null ? ctx.etfProfile : resolveProfile(ctx.etf))) {
        step = Math.max(step, ADD_STEP_PCT);
      }
      if (addMode === '突破加仓') {
        step = Math.max(step, resolveV3AddBreakoutMax(params));
        if ((ctx.enginePath === 'v35_structural' || ctx.enginePath === 'v34_stage') && ctx.breakoutScore != null && ctx.breakoutScore >= 75) {
          const brk = ctx.factor_breakdown && ctx.factor_breakdown.breakout_add;
          const pyr = ctx.factor_breakdown && ctx.factor_breakdown.pyramid_add;
          // V3.5：突破是 Stage 跃迁，目标已在 sizing 中；步长用 gap 加速即可
          if (ctx.enginePath === 'v35_structural') {
            step = Math.max(step, Math.min(gap, resolveV3AddBreakoutMax(params)));
          } else {
            if (brk != null && brk > 0) step = Math.max(step, brk);
            if (pyr != null && pyr > 0) step = Math.max(step, pyr);
          }
        } else if (ctx.enginePath === 'v33_target' && ctx.breakoutScore != null && ctx.breakoutScore >= 75) {
          const brk = ctx.factor_breakdown && ctx.factor_breakdown.breakout_add;
          if (brk != null && brk > 0) step = Math.max(step, brk);
        } else if (ctx.enginePath === 'v32_math' && ctx.breakoutScore != null && ctx.breakoutScore >= 75) {
          const cap = positions.max_strategic_position != null ? positions.max_strategic_position
            : resolveV3SingleMax(params, ctx.portfolio || {});
          const bsStep = breakoutAddStepPct(cap, ctx.breakoutScore, params);
          if (bsStep != null) step = Math.max(step, bsStep);
        }
      }
      const w = (ctx.snapshot && ctx.snapshot.w_state) || 'W3';
      const minStep = (w === 'W1' || w === 'W2') ? resolveV3AddTrendStep(params) : ADD_STEP_PCT;
      step = Math.max(minStep, step);
      if (ctx.momentumAcceleration) {
        const minMa = params.v3_momentum_accel_min_pct != null ? params.v3_momentum_accel_min_pct : 8;
        const maxMa = params.v3_momentum_accel_max_pct != null ? params.v3_momentum_accel_max_pct : 10;
        step = Math.max(step, minMa);
        step = Math.min(step, maxMa);
      } else if (stage === 'S5') step = Math.min(step, 10);
      else step = Math.min(step, 8);
      if (ctx.consolidationGrade === 'B') step = step / 2;
      return Math.min(current + step, finalTarget);
    }
    case 'HOLD':
    case 'WAIT':
      return current;
    default: return current;
  }
}

function runDecisionV3(etf, snapshot, positions, params, extra) {
  const portfolio = extra.portfolio || { tech_position: 0, gold_position: 0, cash_ratio: 100 };
  params = resolveV3EffectiveParams(params, portfolio);
  const fundamental = extra.fundamental || { f_state: 'F3', f_score: 15, detail: {} };
  const risk = extra.risk || { risk_flag: 'NORMAL', risk_override: false };
  const crowding = extra.crowding || base.computeCrowding({ etf, snapshot, params });
  const cooldownDays = extra.cooldownDays != null ? extra.cooldownDays : 0;

  const consolidationGrade = base.gradeConsolidation(snapshot);
  const currentPos = positions.current_position || 0;
  const etfProfile = resolveProfile(etf);
  const stageState = extra.trendStageState || {};
  const bars = extra.bars || null;
  const todayIdx = bars ? bars.length - 1 : null;
  const lastShockIdx = findShockIdxFromState(bars, extra.shockState);

  let stageResolved = resolveTrendStage(snapshot, fundamental, stageState, {
    consolidationGrade,
    bars,
    currentPosition: currentPos,
    profile: etfProfile || undefined,
    shockActive: extra.shockActive === true,
    todayIdx,
    v3_stage_down_one_step: params.v3_stage_down_one_step,
    v3_6_persistence: params.v3_6_persistence === true,
    params
  });
  // Gen-1 Advisory Active：仅允许在无硬破位的 S2/S3 上提议 S4；
  // 风险、基本面、组合上限仍由本函数后续硬规则继续约束。
  const advisoryOverride = extra.advisoryStageOverride === 'S4'
    && (stageResolved.primaryStage === 'S2' || stageResolved.primaryStage === 'S3')
    && stageResolved.overlay !== 'broken';
  if (advisoryOverride) {
    stageResolved = {
      ...stageResolved,
      primaryStage: 'S4',
      displayStage: stageResolved.overlay === 'normal' ? 'S4' : stageResolved.displayStage,
      advisory_override: true,
      advisory_base_stage: stageResolved.primaryStage
    };
  }
  const primaryStage = stageResolved.primaryStage || stageResolved.stage;
  const displayStage = stageResolved.displayStage || primaryStage;
  const trendStage = primaryStage;

  const defenseResult = computeDefenseScore({
    snapshot,
    fundamental,
    risk,
    bars,
    trendStage,
    trendStageOverlay: stageResolved.overlay || 'normal',
    riskEvents: extra.riskEvents || []
  }, {
    recentSlowBreakScores: extra.recentSlowBreakScores || []
  });

  const shockContext = evaluateShockContext({
    snapshot,
    fundamental,
    bars,
    todayIdx,
    lastShockIdx,
    profile: etfProfile
  });

  const shockState = shockContext.shockToday && snapshot.calc_date
    ? { lastShockDate: snapshot.calc_date }
    : (extra.shockState || null);

  const w = snapshot.w_state || 'W3';
  const f = fundamental.f_state || 'F3';
  const swing = bars ? swingHighLow(bars) : { lowerHigh: false, lowerLow: false };
  const scores = {
    trend: process.env.V3_ABL_LEGACY_TREND === '1'
      ? base.scoreTrend(w)
      : base.scoreTrendForOpportunity(stageResolved.trendQualityScore, w, stageResolved.overlay),
    volume: scoreVolumeV3(snapshot.h_state || 'H3', snapshot.v_state || 'V3', snapshot, params),
    fundamental: base.scoreFundamental(f),
    crowding: base.scoreCrowding(crowding.c_state || 'C1'),
    risk: base.scoreRisk(risk.risk_flag, risk.risk_override === true)
  };
  scores.total = scores.trend + scores.volume + scores.fundamental + scores.crowding + scores.risk;

  const weights = extra.weights || params.opportunity_weights;
  const opportunityScore = base.calcOpportunityScore(scores, weights, risk.risk_override === true);

  let ctx = {
    etf, snapshot, fundamental, risk, positions, portfolio, crowding, params, scores, opportunityScore, cooldownDays,
    sectorRemainingLimit: extra.sectorRemainingLimit != null ? extra.sectorRemainingLimit : null,
    consolidationGrade, trendStage, trendStageDisplay: displayStage, trendStageOverlay: stageResolved.overlay,
    trendQualityScore: stageResolved.trendQualityScore, etfProfile,
    defenseScore: defenseResult.defense_score,
    defensePenalty: defenseResult.defense_penalty,
    defenseResult,
    shockContext,
    bars,
    todayIdx,
    lastShockIdx: shockContext.lastShockIdx,
    correlationCap: extra.correlationCap,
    portfolioRiskCap: extra.portfolioRiskCap
  };

  const target = patchGenerateTargetPosition(ctx);
  ctx.momentumAcceleration = evaluateMomentumAcceleration(ctx);
  ctx.enginePath = target.engine_path;
  ctx.factor_breakdown = target.factor_breakdown;
  ctx.breakoutScore = target.breakout_score;
  ctx.bull_activation_score = target.bull_activation_score;
  ctx.maxStrategic = (() => {
    let cap = positions.max_strategic_position != null ? positions.max_strategic_position
      : resolveV3SingleMax(params, portfolio);
    if (shouldUseV33(params, portfolio) || shouldUseV34(params, portfolio) || shouldUseV35(params, portfolio)) cap = resolveV33Cap(params, portfolio, cap);
    return cap;
  })();
  const addMode = patchDetermineAddMode(ctx);
  const coreTrade = (target.engine_path === 'v35_structural' || target.engine_path === 'v34_stage' || target.engine_path === 'v33_target' || target.engine_path === 'v32_math' || target.engine_path === 'v32_bull_participation' || target.engine_path === 'v31_trend_first')
    ? computeTrendFirstCoreTrade(ctx, target.finalTarget)
    : base.computeCoreTrade(ctx, target.finalTarget);
  ctx = { ...ctx, grade: target.grade, factor: target.factor, finalTarget: target.finalTarget, gap: target.gap, addMode, ...coreTrade };

  const eligibility = patchCheckAddEligibility(ctx);
  const overAllocStatus = base.computeOverAllocStatus(target.gap);
  ctx = { ...ctx, eligibilityOverall: eligibility.overall, overAllocStatus };

  const ruleHits = base.applyHardRules(ctx);
  let finalAction = patchRunStateMachine(ctx);
  let suggestedPosition = patchComputeTargetPosition(ctx, finalAction);
  const sectorCap = base.applySectorHardCap(ctx, finalAction, suggestedPosition);
  if (sectorCap.hit) {
    finalAction = sectorCap.action;
    suggestedPosition = sectorCap.suggested;
  }

  // V3.6.1：S5 Pullback/Risk 禁止激进加仓
  if (stageResolved.block_aggressive_add === true
    && (finalAction === 'ADD' || finalAction === 'BUILD')) {
    finalAction = 'HOLD';
    suggestedPosition = currentPos;
  }

  const explainChain = base.buildExplainChain(ctx, finalAction, suggestedPosition);
  const nextAddCondition = base.buildNextAddCondition(ctx);
  const maxPosition = positions.max_strategic_position != null ? positions.max_strategic_position
    : (positions.max_position != null ? positions.max_position : (params.single_etf_max != null ? params.single_etf_max : DEFAULT_PARAMS.single_etf_max));

  const allowedMax = target.finalTarget;
  const current = positions.current_position || 0;
  const sur = (primaryStage === 'S5' && stageResolved.overlay !== 'broken' && allowedMax > 0)
    ? current / allowedMax : null;

  const _seen = new Set();
  const ruleHitsArr = [];
  [w, snapshot.h_state, snapshot.v_state, f, crowding.c_state || 'C1']
    .concat(ruleHits.map((r) => (r.name === 'H1V1' ? 'H1' : r.name)))
    .forEach((code) => {
      if (code && !_seen.has(code)) { _seen.add(code); ruleHitsArr.push(code); }
    });

  return {
    code: etf.code || snapshot.code || '',
    decision_date: snapshot.calc_date || '',
    w_state: w,
    d_state: snapshot.d_state || 'D3',
    h_state: snapshot.h_state || 'H3',
    v_state: snapshot.v_state || 'V3',
    f_state: f,
    c_state: crowding.c_state || 'C1',
    risk_flag: risk.risk_flag || 'NORMAL',
    risk_override: risk.risk_override === true,
    premium_flag: crowding.premium_flag || '正常',
    scores,
    opportunity_score: opportunityScore,
    opportunity_grade: target.grade,
    opportunity_factor: target.factor,
    target_min: target.range.target_min,
    target_std: target.range.target_std,
    target_max: target.range.target_max,
    max_position: maxPosition,
    final_target: target.finalTarget,
    position_gap: Math.round((suggestedPosition - current) * 10) / 10,
    core_position: coreTrade.core,
    trade_position: coreTrade.trade,
    suggested_position: suggestedPosition,
    add_mode: addMode,
    add_eligibility: eligibility,
    cooldown_days: cooldownDays,
    over_alloc_status: overAllocStatus,
    defense_state: computeDefenseStateV3(ctx, defenseResult),
    defense_score: defenseResult.defense_score,
    defense_penalty: defenseResult.defense_penalty,
    slow_break_score: defenseResult.slow_break_score,
    slow_break_high: defenseResult.slow_break_high,
    shock_context: {
      shock_active: shockContext.shockActive,
      recovery_label: shockContext.recoveryLabel,
      recovery_ratio: shockContext.recoveryRatio,
      structural_break: shockContext.structuralBreak,
      recommended_action: shockContext.recommendedAction
    },
    shock_state: shockState,
    action: finalAction,
    action_label: base.ACTION_LABELS ? (base.ACTION_LABELS[finalAction] || finalAction) : finalAction,
    consolidation_grade: consolidationGrade,
    final_action: finalAction,
    target_position: target.finalTarget,
    next_add_condition: nextAddCondition,
    explain_chain: explainChain,
    rule_hits: ruleHitsArr,
    trend_stage: displayStage,
    trend_stage_primary: primaryStage,
    trend_stage_overlay: stageResolved.overlay || 'normal',
    trend_quality_score: stageResolved.trendQualityScore,
    trend_stage_raw: stageResolved.rawStage,
    advisory_stage_override: advisoryOverride,
    advisory_base_stage: stageResolved.advisory_base_stage || null,
    trend_stage_label: stageResolved.label,
    trend_stage_state: {
      // 持久化状态仍记录 V3.6.1 基线；Advisory S4 只作用于本次建议输出。
      stage: stageResolved.advisory_base_stage || primaryStage,
      overlay: stageResolved.overlay || 'normal',
      displayStage,
      pendingStage: stageResolved.pendingStage || null,
      pendingDays: stageResolved.pendingDays || 0,
      initialized: true,
      stage_algo_version: stageResolved.stage_algo_version || require('./v3-constants.js').TREND_STAGE_ALGO_VERSION,
      breakout_level: stageResolved.breakout_level != null ? stageResolved.breakout_level : null,
      days_in_stage: stageResolved.days_in_stage != null ? stageResolved.days_in_stage : 0,
      soft_down_days: stageResolved.soft_down_days != null ? stageResolved.soft_down_days : 0,
      s5_risk_days: stageResolved.s5_risk_days != null ? stageResolved.s5_risk_days : 0,
      s4_origin: stageResolved.s4_origin || null,
      persistence_overlay: stageResolved.persistence_overlay || null,
      persistence_reason: stageResolved.persistence_reason || null,
      downgrade_score: stageResolved.downgrade_score != null ? stageResolved.downgrade_score : null,
      s5_integrity_score: stageResolved.s5_integrity_score != null ? stageResolved.s5_integrity_score : null,
      block_aggressive_add: stageResolved.block_aggressive_add === true,
      post_s5_grace: stageResolved.post_s5_grace === true
    },
    stage_factor: target.stage_factor,
    market_factor: target.market_factor,
    raw_target_position: target.raw_target_position,
    risk_adjusted_target: target.risk_adjusted_target,
    binding_constraint: target.binding_constraint != null ? target.binding_constraint : 'none',
    factor_breakdown: target.factor_breakdown,
    v32_breakdown: target.v32_breakdown,
    v32_math_breakdown: target.v32_math_breakdown,
    v33_breakdown: target.v33_breakdown,
    v34_breakdown: target.v34_breakdown,
    v35_breakdown: target.v35_breakdown,
    bull_activation_score: target.bull_activation_score,
    breakout_score: target.breakout_score,
    bull_mode_action: ctx.bullModeAction || null,
    bull_pullback_hold: evaluateBullPullbackHold(ctx),
    effective_market_regime: target.effective_market_regime,
    main_rally_utilization: sur != null ? Math.round(sur * 1000) / 1000 : null,
    momentum_acceleration: ctx.momentumAcceleration === true,
    profile_type: etfProfile ? etfProfile.profile_type : null,
    engine_path: target.engine_path || 'v3'
  };
}

module.exports = function createV3Decision() {
  const patched = { ...base };
  patched.generateTargetPosition = patchGenerateTargetPosition;
  patched.determineAddMode = patchDetermineAddMode;
  patched.checkAddEligibility = patchCheckAddEligibility;
  patched.runStateMachine = patchRunStateMachine;
  patched.computeTargetPosition = patchComputeTargetPosition;
  patched.runDecision = runDecisionV3;
  patched.resolveTrendStage = resolveTrendStage;
  patched.resolveV3BullParams = resolveV3BullParams;
  patched.isFirstLotBreakoutV3 = isFirstLotBreakoutV3;
  patched.allowS6EmptyBuild = allowS6EmptyBuild;
  patched.isS6ProbePosition = isS6ProbePosition;
  patched.allowS6ProbeContinue = allowS6ProbeContinue;
  patched.shouldRallyGapAccelerate = shouldRallyGapAccelerate;
  patched.applyBullMfFloor = applyBullMfFloor;
  patched.evaluateMomentumAcceleration = evaluateMomentumAcceleration;
  patched.s6OverlayTargetAllowsReduce = s6OverlayTargetAllowsReduce;
  patched.allowS6ConfirmedRallyAdd = allowS6ConfirmedRallyAdd;
  patched.scoreVolumeV3 = scoreVolumeV3;
  patched.resolveV3SingleMax = resolveV3SingleMax;
  patched.resolveV3CashFloorMax = resolveV3CashFloorMax;
  patched.isV3PortfolioMode = isV3PortfolioMode;
  patched.resolveV3EffectiveParams = resolveV3EffectiveParams;
  patched.shouldUseV32Math = shouldUseV32Math;
  patched._v3 = true;
  return patched;
};
