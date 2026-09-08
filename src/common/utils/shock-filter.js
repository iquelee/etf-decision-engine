/**
 * V3.0 v1.1 Shock Filter（P3）
 *
 * Shock 只能 Reclassify，不能 Override STRUCTURAL_BREAK
 * 插入点：P3 high_volume_decline 之前
 *
 * 规格：v1.1 §A4、§A5
 */
'use strict';

const { SHOCK_THRESHOLDS } = require('./v3-constants.js');
const {
  evaluateShockRecovery,
  resolveShockAction,
  isStructuralBreak
} = require('./shock-recovery.js');

function ret1dPct(bars, idx) {
  if (!bars || idx < 1 || !bars[idx] || !bars[idx - 1]) return null;
  const prev = bars[idx - 1].close;
  if (!prev || prev <= 0) return null;
  return ((bars[idx].close - prev) / prev) * 100;
}

function calcShockScore(retPct, atr20, price) {
  if (retPct == null || atr20 == null || !price || price <= 0) return null;
  const atrPct = (atr20 / price) * 100;
  if (atrPct <= 0) return null;
  return Math.abs(retPct) / atrPct;
}

function shockLabel(score) {
  if (score == null) return 'none';
  if (score >= SHOCK_THRESHOLDS.extreme) return 'extreme';
  if (score >= SHOCK_THRESHOLDS.strong) return 'strong';
  if (score >= SHOCK_THRESHOLDS.abnormal) return 'abnormal';
  return 'normal';
}

function defaultShockThreshold(profile) {
  if (profile && profile.shock_threshold != null) return profile.shock_threshold;
  return SHOCK_THRESHOLDS.strong;
}

/**
 * 检测当日是否 Shock 事件
 */
function detectShockToday(snapshot, bars, todayIdx, profile) {
  if (!snapshot || !bars || todayIdx == null || !bars[todayIdx]) {
    return { shockToday: false, shockScore: null, shockLabel: 'none' };
  }
  const ret = ret1dPct(bars, todayIdx);
  const price = bars[todayIdx].close;
  const score = calcShockScore(ret, snapshot.atr20, price);
  const threshold = defaultShockThreshold(profile);
  return {
    shockToday: score != null && score >= threshold,
    shockScore: score,
    shockLabel: shockLabel(score),
    threshold
  };
}

/**
 * 完整 Shock 上下文（Recovery + Structural + 推荐动作）
 */
function evaluateShockContext(input) {
  const {
    snapshot,
    fundamental,
    bars,
    todayIdx,
    lastShockIdx,
    profile
  } = input || {};

  const structuralBreak = isStructuralBreak(snapshot, fundamental, bars, todayIdx);
  const todayShock = detectShockToday(snapshot, bars, todayIdx, profile);

  // Recovery 针对「最近一次急跌日」；若今日也是 shock 但 lastShockIdx 更早，仍评估那一日的恢复
  let recoveryShockIdx = lastShockIdx;
  if (todayShock.shockToday) {
    if (lastShockIdx == null || lastShockIdx === todayIdx) {
      recoveryShockIdx = todayIdx;
    } else if (lastShockIdx < todayIdx) {
      recoveryShockIdx = lastShockIdx;
    } else {
      recoveryShockIdx = todayIdx;
    }
  }

  let recovery = {
    label: 'unknown',
    ratio: null,
    blocksStrategicReduce: false,
    recovery: false,
    daysSince: null
  };

  if (recoveryShockIdx != null && bars && todayIdx != null && todayIdx > recoveryShockIdx) {
    recovery = evaluateShockRecovery(bars, recoveryShockIdx, todayIdx, snapshot, fundamental);
  } else if (todayShock.shockToday) {
    recovery.label = 'pending';
  }

  const shockActive = (recoveryShockIdx != null && recovery.daysSince != null && recovery.daysSince <= 5)
    || todayShock.shockToday;

  const recommendedAction = resolveShockAction({
    shock: shockActive,
    recoveryLabel: recovery.label,
    structuralBreak
  });

  return {
    shockToday: todayShock.shockToday,
    shockActive,
    shockScore: todayShock.shockScore,
    shockLabel: todayShock.shockLabel,
    recoveryLabel: recovery.label,
    recoveryRatio: recovery.ratio,
    recoveryActive: recovery.recovery === true,
    blocksStrategicReduce: recovery.blocksStrategicReduce === true,
    structuralBreak,
    recommendedAction,
    lastShockIdx: todayShock.shockToday ? todayIdx : lastShockIdx,
    recoveryShockIdx,
    daysSinceShock: recovery.daysSince
  };
}

/**
 * hvD 场景下 Shock 过滤后的状态机动作
 * @returns {{ action: string|null, reason: string, shockContext: object }}
 */
function resolveHighVolumeDeclineAction(ctx) {
  const { snapshot = {}, current = 0 } = ctx;
  if (!snapshot.high_volume_decline) {
    return { action: null, reason: 'no_hvd', shockContext: ctx.shockContext || null };
  }

  const shockContext = ctx.shockContext || evaluateShockContext({
    snapshot: ctx.snapshot,
    fundamental: ctx.fundamental,
    bars: ctx.bars,
    todayIdx: ctx.todayIdx,
    lastShockIdx: ctx.lastShockIdx,
    profile: ctx.etfProfile
  });

  const rec = shockContext.recommendedAction;

  if (rec === 'HOLD') {
    return {
      action: current > 0 ? 'HOLD' : 'WAIT',
      reason: `shock_recovery_${shockContext.recoveryLabel}`,
      shockContext
    };
  }
  if (rec === 'TACTICAL_REDUCE') {
    return {
      action: current > 0 ? 'TACTICAL_REDUCE' : 'WAIT',
      reason: `shock_${shockContext.recoveryLabel}`,
      shockContext
    };
  }
  if (rec === 'STRATEGIC_REDUCE') {
    return {
      action: current > 0 ? 'STRATEGIC_REDUCE' : 'WAIT',
      reason: shockContext.structuralBreak ? 'structural_break' : `shock_${shockContext.recoveryLabel}`,
      shockContext
    };
  }

  return { action: null, reason: 'allow_legacy_hvd', shockContext };
}

function findShockIdxFromState(bars, shockState) {
  if (!bars || !shockState || !shockState.lastShockDate) return null;
  const idx = bars.findIndex((b) => b.trade_date === shockState.lastShockDate);
  return idx >= 0 ? idx : null;
}

module.exports = {
  ret1dPct,
  calcShockScore,
  shockLabel,
  detectShockToday,
  evaluateShockContext,
  resolveHighVolumeDeclineAction,
  findShockIdxFromState,
  defaultShockThreshold
};
