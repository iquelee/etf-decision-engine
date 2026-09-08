/**
 * V3 MarketScore 分项：MVolume / MGrowth / MRisk（Phase A）
 * 有数据则算真实分；缺数据返回 null，由 calcMarketScore 回退中性兜底。
 */
'use strict';

const VOLUME_MAX = 20;
const GROWTH_MAX = 15;
const RISK_MAX = 10;

function neutralVolumeScore() {
  return Math.round(VOLUME_MAX * 0.75);
}

function neutralGrowthScore() {
  return Math.round(GROWTH_MAX * 0.5);
}

function neutralRiskScore() {
  return Math.round(RISK_MAX * 0.5);
}

function barClose(bar) {
  if (!bar) return null;
  return bar.close != null ? bar.close : bar.c;
}

function dailyReturn(dailyBars, daysBack) {
  const bars = dailyBars || [];
  if (bars.length < daysBack + 1) return null;
  const c0 = barClose(bars[bars.length - 1 - daysBack]);
  const c1 = barClose(bars[bars.length - 1]);
  if (c0 == null || c1 == null || c0 === 0) return null;
  return (c1 - c0) / c0;
}

function weeklyReturn(weeklyBars, weeksBack) {
  const bars = weeklyBars || [];
  if (bars.length < weeksBack + 1) return null;
  const c0 = barClose(bars[bars.length - 1 - weeksBack]);
  const c1 = barClose(bars[bars.length - 1]);
  if (c0 == null || c1 == null || c0 === 0) return null;
  return (c1 - c0) / c0;
}

/**
 * 科技组合快照聚合 → 0~20（规格书 §五）
 * 结构：volume_ratio 水平分(0~10) + 行为模式分(0~10)
 */
function calcMVolumeScore(input) {
  const snaps = (input && input.techSnapshots) || [];
  if (!snaps.length) return null;

  const vrs = snaps.map((s) => s.volume_ratio).filter((v) => v != null);
  const avgVr = vrs.length ? vrs.reduce((a, b) => a + Number(b), 0) / vrs.length : 1;

  let ratioPts = 5;
  if (avgVr >= 1.25) ratioPts = 10;
  else if (avgVr >= 1.1) ratioPts = 8;
  else if (avgVr >= 1.0) ratioPts = 7;
  else if (avgVr >= 0.9) ratioPts = 5;
  else ratioPts = 3;

  let upVol = 0;
  let shrink = 0;
  let breakout = 0;
  let downHeavy = 0;
  const n = snaps.length;

  snaps.forEach((s) => {
    const ch = s.change_5d != null ? Number(s.change_5d) : 0;
    const vr = s.volume_ratio != null ? Number(s.volume_ratio) : 1;
    if (ch > 0.5 && vr > 1.0) upVol += 1;
    if (Math.abs(ch) <= 2 && vr < 0.95) shrink += 1;
    if (s.breakout_nd === true && vr > 1.1) breakout += 1;
    if (ch < -1 && vr > 1.15) downHeavy += 1;
  });

  let behaviorPts = 0;
  behaviorPts += (upVol / n) * 4;
  behaviorPts += (shrink / n) * 2;
  behaviorPts += (breakout / n) * 3;
  behaviorPts -= (downHeavy / n) * 4;

  const wStrong = snaps.filter((s) => s.w_state === 'W1' || s.w_state === 'W2').length / n;
  if (wStrong >= 0.5 && avgVr >= 1.0) ratioPts = Math.min(10, ratioPts + 1);

  return Math.max(0, Math.min(VOLUME_MAX, Math.round(ratioPts + behaviorPts)));
}

function growthPartialFromSpread(spread) {
  if (spread > 0.08) return 15;
  if (spread > 0.04) return 12;
  if (spread > 0.01) return 10;
  if (spread > -0.02) return 7;
  if (spread > -0.05) return 4;
  return 2;
}

/**
 * 科创/成长 vs 宽基相对强度 → 0~15（规格书 §六）
 */
function calcMGrowthScore(input) {
  if (!input) return null;
  const growthDaily = input.growthDailyBars;
  const broadDaily = input.broadDailyBars;
  const growthWeekly = input.growthWeeklyBars;
  const broadWeekly = input.broadWeeklyBars;

  const useDaily = growthDaily && broadDaily && growthDaily.length > 25 && broadDaily.length > 25;
  const useWeekly = !useDaily && growthWeekly && broadWeekly
    && growthWeekly.length > 5 && broadWeekly.length > 5;
  if (!useDaily && !useWeekly) return null;

  const specs = useDaily
    ? [{ g: 20, b: 20 }, { g: 60, b: 60 }, { g: 120, b: 120 }]
    : [{ g: 4, b: 4 }, { g: 13, b: 13 }, { g: 26, b: 26 }];
  const weights = [0.5, 0.3, 0.2];

  let weighted = 0;
  let wSum = 0;
  for (let i = 0; i < specs.length; i += 1) {
    const spec = specs[i];
    const gRet = useDaily
      ? dailyReturn(growthDaily, spec.g)
      : weeklyReturn(growthWeekly, spec.g);
    const bRet = useDaily
      ? dailyReturn(broadDaily, spec.b)
      : weeklyReturn(broadWeekly, spec.b);
    if (gRet == null || bRet == null) continue;
    weighted += growthPartialFromSpread(gRet - bRet) * weights[i];
    wSum += weights[i];
  }
  if (wSum <= 0) return null;
  return Math.max(0, Math.min(GROWTH_MAX, Math.round(weighted / wSum)));
}

/** 风险分项 → 0~10（对齐 decision.scoreRisk + NDX 趋势） */
function calcMRiskScore(input) {
  if (!input) return null;
  const risk = input.risk || {};
  let score = 10;
  if (risk.risk_override === true) score = 0;
  else if (risk.risk_flag === 'RED') score = 2;
  else if (risk.risk_flag === 'YELLOW') score = 7;
  if (input.ndxTrend === '下') score = Math.max(0, score - 2);
  if (input.riskEventsActive === true && risk.risk_flag === 'RED') {
    score = Math.min(score, 2);
  }
  return Math.max(0, Math.min(RISK_MAX, score));
}

function resolveScoreComponents(input) {
  const src = input || {};
  return {
    mVolume: src.mVolume != null ? src.mVolume : calcMVolumeScore(src),
    mGrowth: src.mGrowth != null ? src.mGrowth : calcMGrowthScore(src),
    mRisk: src.mRisk != null ? src.mRisk : calcMRiskScore(src)
  };
}

function fillNeutral(components) {
  const c = components || {};
  return {
    mVolume: c.mVolume != null ? c.mVolume : neutralVolumeScore(),
    mGrowth: c.mGrowth != null ? c.mGrowth : neutralGrowthScore(),
    mRisk: c.mRisk != null ? c.mRisk : neutralRiskScore()
  };
}

module.exports = {
  VOLUME_MAX,
  GROWTH_MAX,
  RISK_MAX,
  neutralVolumeScore,
  neutralGrowthScore,
  neutralRiskScore,
  calcMVolumeScore,
  calcMGrowthScore,
  calcMRiskScore,
  resolveScoreComponents,
  fillNeutral
};
