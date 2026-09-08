/**
 * V3.0 v1.1 数学纠偏版 — 常量与查表函数（P0）
 *
 * 单一事实源：FF / DP / 迟滞 / Recovery / StageFactor / MarketFactor
 * 规格：新版调整方向/V3.0技术改造清单-v1.1-数学纠偏版.md §2、§3 A 级、§11 P0
 *
 * 程序员规则：
 * - FundamentalFactor 与 OpportunityScore 中 Fund 维职责分离（评分排序，因子约束）
 * - DefensePenalty 与 RiskScore 职责分离（见 getDefensePenalty）
 * - StageFactor 仅查主状态 S0~S5（S6/S7 为 overlay，不在此表）
 */
'use strict';

/** 主趋势阶段 → StageFactor（v1.1 §A2，不含 S6/S7） */
const V3_STAGE_FACTORS = Object.freeze({
  S0: 0.00,
  S1: 0.25,
  S2: 0.40,
  S3: 0.70,
  S4: 0.85,
  S5: 1.00
});

const V3_PRIMARY_STAGES = Object.freeze(['S0', 'S1', 'S2', 'S3', 'S4', 'S5']);

/** 5 档 MarketRegime → MarketFactor（v1.1 B1 初版） */
const V3_MARKET_FACTORS = Object.freeze({
  aggressive: 1.00,
  structural: 0.85,
  range: 0.70,
  defensive: 0.50,
  crisis: 0.25
});

/** Crisis 硬触发解除：MarketScore ≥ 此值且触发源为 breadth 类 → 回落到分数档（924 V 反迟滞） */
const V3_CRISIS_SCORE_RELEASE = 55;

/** MarketScore → Regime 阈值（Phase C：Main5 index-proxy + Phase A 标定，2026-08-27） */
const V3_MARKET_SCORE_THRESHOLDS = Object.freeze([
  { min: 75, regime: 'aggressive', factor: 1.00 },
  { min: 55, regime: 'structural', factor: 0.85 },
  { min: 45, regime: 'range', factor: 0.70 },
  { min: 35, regime: 'defensive', factor: 0.50 },
  { min: 0, regime: 'crisis', factor: 0.25 }
]);

/** Phase C 前旧表（对照/回滚） */
const V3_MARKET_SCORE_THRESHOLDS_LEGACY = Object.freeze([
  { min: 80, regime: 'aggressive', factor: 1.00 },
  { min: 70, regime: 'structural', factor: 0.85 },
  { min: 55, regime: 'range', factor: 0.70 },
  { min: 40, regime: 'defensive', factor: 0.50 },
  { min: 0, regime: 'crisis', factor: 0.25 }
]);

/** 迟滞确认天数（v1.1 §A7） */
const STAGE_UP_CONFIRM_DAYS = 2;
const STAGE_DOWN_CONFIRM_DAYS = 3;
const STAGE_HARD_BREAK_DAYS = 1;

/** TrendStage 检测规则版本（变更检测逻辑时递增，触发一次 re-bootstrap） */
const TREND_STAGE_ALGO_VERSION = 3;

/** FundamentalFactor 缓坡表（v1.1 §A1，默认锁死） */
const FUNDAMENTAL_FACTOR_BANDS = Object.freeze([
  { min: 23, ff: 1.00 },
  { min: 20, ff: 0.95 },
  { min: 15, ff: 0.90 },
  { min: 10, ff: 0.75 },
  { min: 0, ff: 0.50 }
]);

/** DefensePenalty 分段（v1.1 §A3） */
const DEFENSE_PENALTY_BANDS = Object.freeze([
  { min: 0, max: 20, dp: 1.00 },
  { min: 21, max: 40, dp: 0.95 },
  { min: 41, max: 60, dp: 0.85 },
  { min: 61, max: 80, dp: 0.70 },
  { min: 81, max: 100, dp: 0.50 }
]);

/** ShockRecovery 分级（v1.1 §A4） */
const RECOVERY_RATIO_BANDS = Object.freeze([
  { min: 0.80, label: 'strong_recovery', blocksStrategicReduce: true },
  { min: 0.70, label: 'good_recovery', blocksStrategicReduce: true },
  { min: 0.50, label: 'neutral', blocksStrategicReduce: false },
  { min: 0, label: 'weak', blocksStrategicReduce: false }
]);

const RECOVERY_LOOKBACK_DAYS = 5;
const RECOVERY_FAILED_RATIO = 0.30;
const STRUCTURAL_MA60_FACTOR = 0.98;

const SHOCK_THRESHOLDS = Object.freeze({ abnormal: 2.0, strong: 2.5, extreme: 3.0 });

/** binding_constraint 枚举（v1.1 §2.4） */
const BINDING_CONSTRAINTS = Object.freeze([
  'etf_max',
  'sector_cap',
  'correlation_cap',
  'portfolio_risk_cap',
  'cash_floor',
  'defense_cap_s7',
  'none'
]);

function getStageFactor(stage) {
  const primary = normalizePrimaryStage(stage);
  return V3_STAGE_FACTORS[primary] != null ? V3_STAGE_FACTORS[primary] : V3_STAGE_FACTORS.S0;
}

function getMarketFactor(regime) {
  return V3_MARKET_FACTORS[regime] != null ? V3_MARKET_FACTORS[regime] : V3_MARKET_FACTORS.range;
}

function marketRegimeFromScore(marketScore, thresholds) {
  const score = marketScore != null ? marketScore : 55;
  const table = Array.isArray(thresholds) && thresholds.length
    ? thresholds
    : V3_MARKET_SCORE_THRESHOLDS;
  for (const row of table) {
    if (score >= row.min) {
      return { regime: row.regime, factor: row.factor };
    }
  }
  return { regime: 'crisis', factor: 0.25 };
}

/**
 * @param {number|null|undefined} fScore 0~25
 * @returns {number} FundamentalFactor 0.5~1.0
 */
function getFundamentalFactor(fScore) {
  const s = fScore != null ? fScore : 15;
  for (const band of FUNDAMENTAL_FACTOR_BANDS) {
    if (s >= band.min) return band.ff;
  }
  return 0.50;
}

/**
 * @param {number|null|undefined} defenseScore 0~100
 * @returns {number} DefensePenalty 0.5~1.0
 */
function getDefensePenalty(defenseScore) {
  const s = defenseScore != null ? defenseScore : 0;
  for (const band of DEFENSE_PENALTY_BANDS) {
    if (s >= band.min && s <= band.max) return band.dp;
  }
  if (s > 100) return 0.50;
  return 1.00;
}

/**
 * 迟滞所需确认天数
 * @param {{ direction: 'up'|'down'|'same', hardBreak?: boolean }} opts
 */
function getStageConfirmDays(opts) {
  const hardBreak = opts && opts.hardBreak;
  const direction = opts && opts.direction;
  if (hardBreak) return STAGE_HARD_BREAK_DAYS;
  if (direction === 'up') return STAGE_UP_CONFIRM_DAYS;
  if (direction === 'down') return STAGE_DOWN_CONFIRM_DAYS;
  return 0;
}

/** S6/S7 展示标签映射到主状态（v1.1 §A6） */
function normalizePrimaryStage(stage) {
  if (!stage) return 'S0';
  if (stage === 'S6') return 'S5';
  if (stage === 'S7') return 'S4';
  if (V3_STAGE_FACTORS[stage] != null) return stage;
  return 'S0';
}

/**
 * RecoveryRatio 分级
 * @param {number|null} ratio 0~1+
 * @param {{ ma60Broken?: boolean }} ctx
 */
function classifyRecoveryRatio(ratio, ctx) {
  if (ratio == null || Number.isNaN(ratio)) {
    return { label: 'unknown', blocksStrategicReduce: false, recoveryActive: false };
  }
  const ma60Broken = ctx && ctx.ma60Broken;
  if (ratio < RECOVERY_FAILED_RATIO && ma60Broken) {
    return { label: 'failed', blocksStrategicReduce: false, recoveryActive: false };
  }
  for (const band of RECOVERY_RATIO_BANDS) {
    if (ratio >= band.min) {
      const recoveryActive = band.label === 'strong_recovery' || band.label === 'good_recovery';
      return {
        label: band.label,
        blocksStrategicReduce: band.blocksStrategicReduce,
        recoveryActive
      };
    }
  }
  return { label: 'weak', blocksStrategicReduce: false, recoveryActive: false };
}

/** Core 建立硬规则（v1.1 §A1，与 FF 分离） */
function canEstablishCore(fScore, ctx) {
  const trendBroken = ctx && ctx.trendBroken;
  if (fScore != null && fScore < 10 && trendBroken) return false;
  return true;
}

/** f_score < 10 时禁止新建 Core（不含 overlay 破坏条件时由调用方传入 trendBroken） */
function isCoreBlockedByFundamental(fScore, ctx) {
  return !canEstablishCore(fScore, ctx);
}

module.exports = {
  V3_STAGE_FACTORS,
  V3_PRIMARY_STAGES,
  V3_MARKET_FACTORS,
  V3_MARKET_SCORE_THRESHOLDS,
  V3_MARKET_SCORE_THRESHOLDS_LEGACY,
  V3_CRISIS_SCORE_RELEASE,
  STAGE_UP_CONFIRM_DAYS,
  STAGE_DOWN_CONFIRM_DAYS,
  STAGE_HARD_BREAK_DAYS,
  TREND_STAGE_ALGO_VERSION,
  FUNDAMENTAL_FACTOR_BANDS,
  DEFENSE_PENALTY_BANDS,
  RECOVERY_RATIO_BANDS,
  RECOVERY_LOOKBACK_DAYS,
  RECOVERY_FAILED_RATIO,
  STRUCTURAL_MA60_FACTOR,
  SHOCK_THRESHOLDS,
  BINDING_CONSTRAINTS,
  getStageFactor,
  getMarketFactor,
  marketRegimeFromScore,
  getFundamentalFactor,
  getDefensePenalty,
  getStageConfirmDays,
  normalizePrimaryStage,
  classifyRecoveryRatio,
  canEstablishCore,
  isCoreBlockedByFundamental
};
