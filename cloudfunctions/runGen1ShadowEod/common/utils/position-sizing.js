/**
 * V3.0 v1.1 三阶段仓位公式（P2）
 *
 * RawTP        = MaxPosition × MarketFactor × StageFactor × OpportunityFactor
 * RiskAdjusted = RawTP × FundamentalFactor × DefensePenalty × RiskFactor
 * FinalTP      = min(RiskAdjusted, 硬约束链)
 *
 * 规格：V3.0技术改造清单-v1.1-数学纠偏版.md §2.1–§2.4
 */
'use strict';

const { getFundamentalFactor, getDefensePenalty } = require('./v3-constants.js');
const { OPPORTUNITY_FACTORS, RISK_FACTORS } = require('../constants.js');

const CONSTRAINT_ORDER = [
  'etf_max',
  'sector_cap',
  'correlation_cap',
  'portfolio_risk_cap',
  'cash_floor',
  'defense_cap_s7'
];

/** 机会等级 → MF×SF 下限（Shadow 校准：高等级不因阶段冷启动过度压仓） */
const V3_GRADE_MF_SF_FLOOR = Object.freeze({
  'A+': 0.85,
  A: 0.85,
  B: 0.70,
  C: 0.55,
  D: 0.40,
  E: 0.25,
  F: 0
});

/**
 * Phase D：S4/S5 + A/A+ 全链路 MF×SF×OF×FF×DP 托底（不含 RF）
 * 仅在 Shadow/V3 路径启用，默认开。
 */
function applyFullChainGradeFloor(marketFactor, stageFactor, opportunityFactor, ff, dp, stage, grade, params) {
  const base = {
    marketFactor: marketFactor != null ? marketFactor : 1,
    stageFactor: stageFactor != null ? stageFactor : 0,
    opportunityFactor: opportunityFactor != null ? opportunityFactor : 0,
    ff: ff != null ? ff : 1,
    dp: dp != null ? dp : 1,
    floored: false
  };
  if (params && params.v3_full_chain_floor === false) return base;
  if (stage !== 'S4' && stage !== 'S5') return base;
  if (grade !== 'A' && grade !== 'A+') return base;

  const floor = stage === 'S5'
    ? (params && params.v3_full_chain_floor_s5 != null ? params.v3_full_chain_floor_s5 : 0.75)
    : (params && params.v3_full_chain_floor_s4 != null ? params.v3_full_chain_floor_s4 : 0.65);

  let mf = base.marketFactor;
  let sf = base.stageFactor;
  let of = base.opportunityFactor;
  let f = base.ff;
  let d = base.dp;
  let product = mf * sf * of * f * d;
  if (product >= floor - 1e-9) return base;

  const liftOrder = [
    ['stageFactor', () => sf, (v) => { sf = Math.min(1, v); }],
    ['marketFactor', () => mf, (v) => { mf = Math.min(1, v); }],
    ['opportunityFactor', () => of, (v) => { of = Math.min(1, v); }],
    ['ff', () => f, (v) => { f = Math.min(1, v); }],
    ['dp', () => d, (v) => { d = Math.min(1, v); }]
  ];

  for (let pass = 0; pass < 3 && product < floor - 1e-9; pass += 1) {
    for (const [, getVal, setVal] of liftOrder) {
      const cur = getVal();
      if (cur >= 1 - 1e-9) continue;
      const need = floor / (product / cur);
      setVal(Math.max(cur, Math.min(1, need)));
      product = mf * sf * of * f * d;
      if (product >= floor - 1e-9) break;
    }
  }

  return {
    marketFactor: mf,
    stageFactor: sf,
    opportunityFactor: of,
    ff: f,
    dp: d,
    floored: true,
    full_chain_floor: floor
  };
}

/**
 * 按机会等级抬升 MF×SF 乘积下限（仅抬升，不压降）
 * @returns {{ marketFactor: number, stageFactor: number, floored: boolean, mf_sf_floor?: number }}
 */
function applyMfSfGradeFloor(marketFactor, stageFactor, grade) {
  const mf = marketFactor != null ? marketFactor : 1;
  const sf = stageFactor != null ? stageFactor : 0;
  const floor = V3_GRADE_MF_SF_FLOOR[grade];
  if (floor == null || floor <= 0) {
    return { marketFactor: mf, stageFactor: sf, floored: false };
  }
  const product = mf * sf;
  if (product >= floor - 1e-9) {
    return { marketFactor: mf, stageFactor: sf, floored: false };
  }
  let newSf = mf > 0 ? Math.min(1, floor / mf) : sf;
  let newMf = mf;
  if (newSf * newMf < floor - 1e-9 && newSf > 0) {
    newMf = Math.min(1, floor / newSf);
  }
  return { marketFactor: newMf, stageFactor: newSf, floored: true, mf_sf_floor: floor };
}

function round1(n) {
  if (n == null || Number.isNaN(n)) return 0;
  return Math.round(n * 10) / 10;
}

function roundFactor(n) {
  if (n == null || Number.isNaN(n)) return 0;
  return Math.round(n * 1000) / 1000;
}

function oppFactorFromGrade(grade, params) {
  const table = (params && params.opportunity_factors && params.opportunity_factors[grade])
    ? params.opportunity_factors : OPPORTUNITY_FACTORS;
  const fr = table[grade] || [0, 0];
  return (fr[0] + fr[1]) / 2;
}

function riskFactorFromRisk(risk) {
  if (!risk) return 1.0;
  if (risk.risk_override === true) return 0;
  return RISK_FACTORS[risk.risk_flag] != null ? RISK_FACTORS[risk.risk_flag] : 1.0;
}

/** S7 overlay 仓位上限（v1.1 §A6） */
function computeDefenseCapS7({ overlay, defenseScore, wState }) {
  if (overlay !== 'broken') return null;
  if (wState === 'W5') return 5;
  if (defenseScore != null && defenseScore >= 61) return 5;
  if (defenseScore != null && defenseScore >= 41) return 10;
  return null;
}

/**
 * 按 v1.1 优先级顺序施加硬约束，返回第一个绑定约束名
 * @param {number} riskAdjustedTP
 * @param {object} limits 各约束上限（null/undefined 表示不限制）
 */
function applyPositionConstraints(riskAdjustedTP, limits) {
  const chain = [
    { key: 'etf_max', value: limits.etfMax },
    { key: 'sector_cap', value: limits.sectorCap },
    { key: 'correlation_cap', value: limits.correlationCap },
    { key: 'portfolio_risk_cap', value: limits.portfolioRiskCap },
    { key: 'cash_floor', value: limits.cashFloorMax },
    { key: 'defense_cap_s7', value: limits.defenseCapS7 }
  ];

  let final = riskAdjustedTP;
  let binding = null;

  for (const step of chain) {
    if (step.value == null || !Number.isFinite(step.value)) continue;
    const next = Math.min(final, step.value);
    if (next < final - 1e-9 && binding == null) {
      binding = step.key;
    }
    final = next;
  }

  if (binding == null && final < riskAdjustedTP - 1e-9) {
    binding = 'none';
  }

  return {
    finalTarget: round1(final),
    bindingConstraint: binding
  };
}

/**
 * 完整三阶段目标仓计算
 * @param {object} input
 * @returns {object} raw/risk_adjusted/final + factor_breakdown + binding_constraint
 */
function computePositionTargets(input) {
  const {
    maxPosition = 0,
    marketFactor: mfIn = 1,
    stageFactor: sfIn = 0,
    opportunityFactor: ofIn = 0,
    fundamentalFactor,
    defensePenalty,
    riskFactor,
    fScore,
    defenseScore,
    constraints = {},
    currentPosition = 0,
    regime,
    risk,
    overlay,
    wState,
    falsified = false,
    stage,
    grade,
    params
  } = input || {};

  if (falsified) {
    return {
      raw_target_position: 0,
      risk_adjusted_target: 0,
      final_target: 0,
      finalTarget: 0,
      binding_constraint: null,
      factor_breakdown: { mf: 0, sf: 0, of: 0, ff: 0, dp: 0, rf: 0 },
      gap: round1(0 - currentPosition),
      defense_cap_s7: null
    };
  }

  const ff0 = fundamentalFactor != null ? fundamentalFactor : getFundamentalFactor(fScore);
  const dp0 = defensePenalty != null ? defensePenalty : getDefensePenalty(defenseScore);
  const rf = riskFactor != null ? riskFactor : 1;

  const chainFloor = applyFullChainGradeFloor(mfIn, sfIn, ofIn, ff0, dp0, stage, grade, params);
  let mf = chainFloor.marketFactor;
  let sf = chainFloor.stageFactor;
  let of = chainFloor.opportunityFactor;
  const ff = chainFloor.ff;
  const dp = chainFloor.dp;

  const rawTP = round1(maxPosition * mf * sf * of);
  const riskAdjustedTP = round1(rawTP * ff * dp * rf);

  const defenseCapS7 = constraints.defenseCapS7 != null
    ? constraints.defenseCapS7
    : computeDefenseCapS7({ overlay, defenseScore, wState });

  const limited = applyPositionConstraints(riskAdjustedTP, {
    etfMax: constraints.etfMax,
    sectorCap: constraints.sectorCap,
    correlationCap: constraints.correlationCap,
    portfolioRiskCap: constraints.portfolioRiskCap,
    cashFloorMax: constraints.cashFloorMax,
    defenseCapS7
  });

  let finalTarget = limited.finalTarget;
  let binding = limited.bindingConstraint;

  if (regime === 'crisis') {
    // Shadow：Recovery / cash_floor 放松时不锁死为当前仓（避免误标 cash_floor）
    const skipCrisisLock = params && params.v3_cash_floor_relax !== false;
    if (!skipCrisisLock) {
      const crisisCap = round1(Math.min(finalTarget, currentPosition));
      if (crisisCap < finalTarget - 1e-9 && binding == null) binding = 'cash_floor';
      finalTarget = crisisCap;
    }
  }
  if (risk && risk.risk_override !== true && risk.risk_flag === 'YELLOW') {
    const yellowCap = round1(Math.min(finalTarget, currentPosition));
    if (yellowCap < finalTarget - 1e-9 && binding == null) binding = 'etf_max';
    finalTarget = yellowCap;
  }

  return {
    raw_target_position: rawTP,
    risk_adjusted_target: riskAdjustedTP,
    final_target: finalTarget,
    finalTarget,
    binding_constraint: binding,
    factor_breakdown: {
      mf: roundFactor(mf),
      sf: roundFactor(sf),
      of: roundFactor(of),
      ff: roundFactor(ff),
      dp: roundFactor(dp),
      rf: roundFactor(rf),
      ...(chainFloor.floored ? { full_chain_floor: chainFloor.full_chain_floor } : {})
    },
    gap: round1(finalTarget - currentPosition),
    defense_cap_s7: defenseCapS7
  };
}

/**
 * 从决策上下文组装 sizing 输入（供 V40 / 未来 decision.js 共用）
 */
function buildSizingInput(ctx, extras) {
  const {
    positions = {}, params = {}, risk = {}, portfolio = {}, fundamental = {}, etf = {}
  } = ctx;
  const ex = extras || {};

  const maxStrategic = ex.maxPosition != null ? ex.maxPosition
    : (positions.max_strategic_position != null ? positions.max_strategic_position
      : (positions.max_position != null ? positions.max_position : 30));

  const current = positions.current_position || 0;
  const singleMax = ex.etfMax != null ? ex.etfMax
    : (params.single_etf_max != null ? params.single_etf_max : 30);

  let sectorCap = singleMax;
  if (ex.sectorCap != null) {
    sectorCap = ex.sectorCap;
  }

  return {
    maxPosition: maxStrategic,
    marketFactor: ex.marketFactor != null ? ex.marketFactor : 1,
    stageFactor: ex.stageFactor != null ? ex.stageFactor : 0,
    opportunityFactor: ex.opportunityFactor != null ? ex.opportunityFactor : 0,
    fScore: fundamental.f_score,
    defenseScore: ex.defenseScore,
    overlay: ex.overlay,
    wState: ex.wState || (ctx.snapshot && ctx.snapshot.w_state),
    constraints: {
      etfMax: singleMax,
      sectorCap,
      correlationCap: ex.correlationCap,
      portfolioRiskCap: ex.portfolioRiskCap,
      cashFloorMax: ex.cashFloorMax,
      defenseCapS7: ex.defenseCapS7
    },
    currentPosition: current,
    regime: portfolio.market_regime,
    risk,
    falsified: fundamental.f_state === 'F5'
  };
}

module.exports = {
  CONSTRAINT_ORDER,
  V3_GRADE_MF_SF_FLOOR,
  round1,
  oppFactorFromGrade,
  riskFactorFromRisk,
  computeDefenseCapS7,
  applyPositionConstraints,
  applyMfSfGradeFloor,
  applyFullChainGradeFloor,
  computePositionTargets,
  buildSizingInput
};
