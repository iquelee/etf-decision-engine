/**
 * V3.0 v1.1 Defense Engine（P3）
 *
 * DefenseScore 0~100（越高越危险）→ DefensePenalty
 * 与 RiskScore 输入正交：hvD/趋势/滞涨/基本面/事件，不含 ATR 波动率
 *
 * DefenseScore = 0.35·TrendBreak + 0.25·DownVolume + 0.15·Stagnation
 *              + 0.15·Fundamental + 0.10·EventRisk
 *
 * 规格：v1.1 §A3、融合版 §2.4
 */
'use strict';

const { getDefensePenalty } = require('./v3-constants.js');
const { swingHighLow } = require('./trend-stage.js');

const DEFENSE_WEIGHTS = Object.freeze({
  trendBreak: 0.35,
  downVolume: 0.25,
  stagnation: 0.15,
  fundamental: 0.15,
  eventRisk: 0.10
});

const SLOW_BREAK_BONUS = 20;
const SLOW_BREAK_HIGH_MIN_COUNT = 3;
const SLOW_BREAK_WINDOW = 5;

/** SlowBreak 四项计数 → 0/20/50/75/100（与 v3-diag-metrics 一致） */
function calcSlowBreakScore(snapshot) {
  if (!snapshot) return 0;
  let n = 0;
  if (snapshot.high_point_falling === true || snapshot.lower_high === true) n += 1;
  if (snapshot.ma20_slope != null && snapshot.ma20_slope < 0) n += 1;
  if (snapshot.ma60_slope != null && snapshot.ma60_slope < 0) n += 1;
  if (snapshot.d_state === 'D5' || snapshot.h_state === 'H4' || snapshot.h_state === 'H5') n += 1;
  const map = { 0: 0, 1: 20, 2: 50, 3: 75, 4: 100 };
  return map[n] != null ? map[n] : 0;
}

/** v1.1 B5：过去 5 日中 ≥3 日 SlowBreak≥75，且 LH/LL 均 ≥3 日 */
function normalizeSlowBreakEntry(entry) {
  if (entry == null) return { score: 0, lowerHigh: false, lowerLow: false };
  if (typeof entry === 'number') return { score: entry, lowerHigh: false, lowerLow: false };
  return {
    score: entry.score != null ? entry.score : 0,
    lowerHigh: entry.lowerHigh === true,
    lowerLow: entry.lowerLow === true
  };
}

function isSlowBreakHigh(recentEntries) {
  if (!recentEntries || !recentEntries.length) return false;
  const window = recentEntries.slice(-SLOW_BREAK_WINDOW).map(normalizeSlowBreakEntry);
  const highDays = window.filter((e) => e.score >= 75).length;
  if (highDays < SLOW_BREAK_HIGH_MIN_COUNT) return false;
  const lhDays = window.filter((e) => e.lowerHigh).length;
  const llDays = window.filter((e) => e.lowerLow).length;
  return lhDays >= SLOW_BREAK_HIGH_MIN_COUNT && llDays >= SLOW_BREAK_HIGH_MIN_COUNT;
}

function scoreTrendBreak(ctx) {
  const { snapshot = {}, trendStageOverlay, trendStage, bars } = ctx;
  const w = snapshot.w_state || 'W3';
  const overlay = trendStageOverlay || 'normal';
  const swing = bars ? swingHighLow(bars) : { lowerHigh: false };

  if (overlay === 'broken' || w === 'W5') return 100;
  if (w === 'W4') return 75;
  if (swing.lowerHigh && snapshot.ma20_slope != null && snapshot.ma20_slope < 0) return 65;
  if (snapshot.d_state === 'D5') return 60;
  if (snapshot.h_state === 'H4' || snapshot.h_state === 'H5') return 55;
  if (overlay === 'overheated') return 35;
  if (overlay === 'shock') return 40;
  if (trendStage === 'S0') return 50;
  if (trendStage === 'S1') return 25;
  return 10;
}

/** 独占 high_volume_decline（不进 RiskScore） */
function scoreDownVolume(snapshot) {
  if (!snapshot || !snapshot.high_volume_decline) return 0;
  const vol = snapshot.volume_ratio;
  if (vol != null && vol >= 1.5) return 100;
  if (vol != null && vol >= 1.2) return 85;
  return 75;
}

function scoreStagnation(snapshot) {
  if (!snapshot || !snapshot.high_volume_stagnation) return 0;
  const pp = snapshot.price_position;
  if (pp != null && pp > 0.75) return 90;
  if (pp != null && pp > 0.65) return 75;
  return 60;
}

function scoreFundamentalDefense(fundamental) {
  if (!fundamental) return 20;
  const f = fundamental.f_state || 'F3';
  const fs = fundamental.f_score != null ? fundamental.f_score : 15;
  if (f === 'F5') return 100;
  if (f === 'F4') return 80;
  if (fs < 10) return 70;
  if (fs < 15) return 50;
  if (fs < 20) return 35;
  return 15;
}

/** 风险事件 / 熔断标记（不含 ATR 波动率） */
function scoreEventRisk(ctx) {
  const { risk = {}, riskEvents = [] } = ctx;
  if (risk.risk_override === true) return 100;
  if (risk.risk_flag === 'RED') return 90;
  if (risk.risk_flag === 'YELLOW') return 40;
  if (Array.isArray(riskEvents) && riskEvents.length > 0) {
    return Math.min(100, 50 + riskEvents.length * 15);
  }
  return 0;
}

function defenseLevelFromScore(score) {
  if (score >= 80) return 4;
  if (score >= 65) return 3;
  if (score >= 50) return 2;
  if (score >= 35) return 1;
  if (score >= 20) return 1;
  return 0;
}

function defenseReasonFromComponents(components) {
  const ranked = Object.entries(components).sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  if (!top || top[1] < 30) return '无显著防守信号';
  const labels = {
    trendBreak: '趋势破坏',
    downVolume: '放量下跌',
    stagnation: '高位滞涨',
    fundamental: '基本面恶化',
    eventRisk: '风险事件'
  };
  return labels[top[0]] || '综合防守';
}

/**
 * @param {object} ctx decision context
 * @param {object} [opts] { slowBreakHigh, recentSlowBreakScores }
 */
function computeDefenseScore(ctx, opts) {
  const components = {
    trendBreak: scoreTrendBreak(ctx),
    downVolume: scoreDownVolume(ctx.snapshot),
    stagnation: scoreStagnation(ctx.snapshot),
    fundamental: scoreFundamentalDefense(ctx.fundamental),
    eventRisk: scoreEventRisk(ctx)
  };

  let score = 0;
  score += components.trendBreak * DEFENSE_WEIGHTS.trendBreak;
  score += components.downVolume * DEFENSE_WEIGHTS.downVolume;
  score += components.stagnation * DEFENSE_WEIGHTS.stagnation;
  score += components.fundamental * DEFENSE_WEIGHTS.fundamental;
  score += components.eventRisk * DEFENSE_WEIGHTS.eventRisk;
  score = Math.round(score);

  const slowBreakScore = calcSlowBreakScore(ctx.snapshot);
  const slowBreakHigh = (opts && opts.slowBreakHigh != null)
    ? opts.slowBreakHigh
    : isSlowBreakHigh(opts && opts.recentSlowBreakScores);

  if (slowBreakHigh) {
    score = Math.min(100, score + SLOW_BREAK_BONUS);
  }

  const defensePenalty = getDefensePenalty(score);
  const level = defenseLevelFromScore(score);

  return {
    defense_score: score,
    defense_penalty: defensePenalty,
    defense_level: level,
    defense_reason: defenseReasonFromComponents(components),
    slow_break_score: slowBreakScore,
    slow_break_high: slowBreakHigh,
    components
  };
}

/** 兼容 V3.8 computeDefenseState 展示 */
function computeDefenseStateV3(ctx, defenseResult) {
  const d = defenseResult || computeDefenseScore(ctx);
  return {
    level: d.defense_level,
    reason: d.defense_reason,
    score: d.defense_score,
    factor: d.defense_penalty
  };
}

module.exports = {
  DEFENSE_WEIGHTS,
  SLOW_BREAK_BONUS,
  SLOW_BREAK_HIGH_MIN_COUNT,
  SLOW_BREAK_WINDOW,
  calcSlowBreakScore,
  isSlowBreakHigh,
  normalizeSlowBreakEntry,
  scoreTrendBreak,
  scoreDownVolume,
  scoreStagnation,
  scoreFundamentalDefense,
  scoreEventRisk,
  computeDefenseScore,
  computeDefenseStateV3,
  defenseLevelFromScore
};
