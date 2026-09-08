/**
 * V3.5 Structural Engine — 简化仓位骨架（Shadow）
 *
 * 原则：
 *   Regime = 敢不敢买（风险预算上限）
 *   Stage  = 应该有多少仓（主仓位来源）
 *   Setup  = 什么时候加（小幅时机加成，不重算 Target）
 *   Breakout = Stage 跃迁（不是绝对 +15%）
 *   Risk = 仅刹车（Defense / Yellow）
 *   Profit Protection = 不主动压低核心仓（本引擎无 PP penalty）
 *
 * 模式：
 *   b = Regime × Stage
 *   c = B + Setup
 *   d = C + Breakout State Transition（跃迁 Stage，再算 Target）
 *
 * Target = min(RegimeCap, Cap) × StageFactor(+setup)
 * 无 Pyramid / 无 ProfitProtection penalty / 无绝对 BreakoutAdd
 */
'use strict';

const { round1, applyPositionConstraints, computeDefenseCapS7 } = require('./position-sizing.js');
const { normalizePrimaryStage } = require('./v3-constants.js');
const { computeBreakoutScore } = require('./v3-2-math-engine.js');
const { defenseAdjustmentPct } = require('./v3-trend-first-position.js');
const { coreRatioFromFundamental } = require('./v3-3-target-exposure.js');

/** Regime → 最大允许暴露（Permission） */
function regimeCapFromMarket(regime, mr) {
  const score = mr != null ? mr : 55;
  if (regime === 'crisis' || score < 25) return 10;
  if (regime === 'defensive' || score < 35) return 25;
  if (regime === 'range' || score < 55) return 60;
  if (score >= 80 || regime === 'aggressive') return 100;
  return 100; // structural / bull
}

/**
 * Stage → 仓位系数（占 RegimeCap 比例）
 * 对齐 trend-stage：S4=突破 S5=主升
 */
const V35_STAGE_FACTOR = Object.freeze({
  S0: 0.00,
  S1: 0.15,
  S2: 0.30,
  S3: 0.45,
  S4: 0.65,
  S5: 0.80
});

const STAGE_RANK = Object.freeze({ S0: 0, S1: 1, S2: 2, S3: 3, S4: 4, S5: 5 });

function stageFactor(displayStage, overlay) {
  if (overlay === 'broken') return 0.10;
  if (displayStage === 'S6' && overlay !== 'broken') return V35_STAGE_FACTOR.S5;
  if (displayStage === 'S7') return 0.40; // 高位分配示意
  const p = normalizePrimaryStage(displayStage);
  return V35_STAGE_FACTOR[p] != null ? V35_STAGE_FACTOR[p] : V35_STAGE_FACTOR.S2;
}

/**
 * Setup：仅时机加成（占 RegimeCap 的百分点系数）
 * H1 普通整理 = 0；H2 标准横盘 +5%；H3 高质量 +10%
 */
function classifySetupAdd(snapshot) {
  const snap = snapshot || {};
  const days = snap.sideway_days != null ? snap.sideway_days : 0;
  const cs = snap.consolidation_score != null ? snap.consolidation_score : 0;
  const ma20Up = snap.ma20_slope != null && snap.ma20_slope > 0;
  const ma60Ok = snap.ma60 != null && snap.ma20 != null ? snap.ma20 >= snap.ma60 * 0.98 : true;
  const volRatio = snap.volume_ratio != null ? snap.volume_ratio : 1;

  if (days >= 15 && cs >= 75 && ma20Up && ma60Ok && volRatio < 0.95) {
    return { tier: 'H3', addFactor: 0.10 };
  }
  if (days >= 12 && cs >= 65 && ma20Up) {
    return { tier: 'H2', addFactor: 0.05 };
  }
  if (days >= 5 && cs >= 55) {
    return { tier: 'H1', addFactor: 0 };
  }
  return { tier: null, addFactor: 0 };
}

/**
 * Breakout → Stage 跃迁（不叠加绝对仓位）
 * S3 + 突破 → S4；S4 + 强突破确认 → S5
 */
function resolveBreakoutStageTransition(displayStage, overlay, snapshot, bs, mode) {
  const m = (mode || 'b').toLowerCase();
  if (m !== 'd') {
    return {
      effectiveStage: displayStage,
      transition: null,
      bs: bs != null ? bs : 0
    };
  }
  if (overlay === 'broken') {
    return { effectiveStage: displayStage, transition: null, bs: bs != null ? bs : 0 };
  }

  const snap = snapshot || {};
  const primary = normalizePrimaryStage(displayStage);
  const broke = snap.breakout_nd === true || snap.breakout === true;
  const score = bs != null ? bs : 0;
  const w = snap.w_state || 'W3';
  const vol = snap.volume_ratio != null ? snap.volume_ratio : 1;
  const ma20Up = snap.ma20_slope != null && snap.ma20_slope > 0;
  const strong = broke && score >= 75 && vol >= 1.15 && ma20Up
    && (w === 'W1' || w === 'W2' || w === 'W3');

  let effective = primary;
  let transition = null;

  if ((primary === 'S3' || primary === 'S2') && (broke || score >= 75)) {
    effective = 'S4';
    transition = 'S3→S4';
  }
  if ((primary === 'S4' || effective === 'S4') && strong) {
    effective = 'S5';
    transition = transition ? 'S3→S4→S5' : 'S4→S5';
  }
  if (displayStage === 'S6' && overlay !== 'broken') {
    effective = 'S5';
  }
  if (displayStage === 'S5') effective = 'S5';

  return {
    effectiveStage: effective,
    transition,
    bs: score
  };
}

/**
 * @param {object} input
 * @param {string} [input.params.v3_5_mode] 'b'|'c'|'d'
 */
function computeV35Targets(input) {
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
    params = {}
  } = input || {};

  const mode = (params && params.v3_5_mode) ? String(params.v3_5_mode).toLowerCase() : 'b';
  const cap = maxPosition;

  const empty = (binding) => ({
    raw_target_position: 0,
    risk_adjusted_target: 0,
    final_target: 0,
    finalTarget: 0,
    binding_constraint: binding,
    factor_breakdown: { engine: 'v35', mode, binding },
    gap: round1(0 - currentPosition),
    defense_cap_s7: null,
    v35_breakdown: { mode, binding },
    bull_activation_score: 0,
    effective_market_regime: regime
  });

  if (falsified) return empty('falsified');

  const mr = portfolio.market_score != null ? portfolio.market_score : 55;
  const ov = overlay || 'normal';
  const regimeCap = regimeCapFromMarket(regime, mr);
  const effectiveCap = round1(Math.min(cap, regimeCap));

  const bs = computeBreakoutScore(snapshot, portfolio);
  const brk = resolveBreakoutStageTransition(displayStage, ov, snapshot, bs, mode);
  const sf = stageFactor(brk.effectiveStage, ov);

  let setup = { tier: null, addFactor: 0 };
  if (mode === 'c' || mode === 'd') {
    setup = classifySetupAdd(snapshot);
  }

  const stageFactorEff = Math.min(1, sf + setup.addFactor);
  let rawTarget = round1(effectiveCap * stageFactorEff);

  // Risk 仅刹车：Defense 惩罚封顶 10% Cap（比 V3.4 更轻）
  const defensePenalty = round1(Math.min(effectiveCap * 0.10, defenseAdjustmentPct(defenseScore) * 0.5));
  rawTarget = round1(Math.max(0, rawTarget - defensePenalty));

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
      engine: 'v35',
      mode,
      cap,
      effective_cap: effectiveCap,
      regime_cap: regimeCap,
      mr,
      stage_raw: displayStage,
      stage_eff: brk.effectiveStage,
      stage_factor: sf,
      setup_tier: setup.tier,
      setup_add_factor: setup.addFactor,
      stage_factor_eff: stageFactorEff,
      breakout_transition: brk.transition,
      bs: brk.bs,
      defense_penalty: defensePenalty,
      core_ratio_hint: coreRatio
    },
    gap: round1(finalTarget - currentPosition),
    defense_cap_s7: defenseCapS7,
    v35_breakdown: {
      mode,
      cap,
      effective_cap: effectiveCap,
      regime_cap: regimeCap,
      stage_raw: displayStage,
      stage_eff: brk.effectiveStage,
      stage_factor: sf,
      setup,
      stage_factor_eff: stageFactorEff,
      breakout_transition: brk.transition,
      bs: brk.bs,
      defense_penalty: defensePenalty,
      raw_target: rawTarget,
      pre_chain: preChain,
      binding: binding || 'none'
    },
    bull_activation_score: null,
    effective_market_regime: regime,
    breakout_score: brk.bs,
    core_ratio_hint: coreRatio,
    stage_effective: brk.effectiveStage
  };
}

module.exports = {
  V35_STAGE_FACTOR,
  STAGE_RANK,
  regimeCapFromMarket,
  stageFactor,
  classifySetupAdd,
  resolveBreakoutStageTransition,
  computeV35Targets
};
