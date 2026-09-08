/**
 * V3.0 v1.1 ShockRecovery + STRUCTURAL_BREAK（P0 公式锁死）
 *
 * RecoveryRatio = (P5 - Ls) / (P0 - Ls)
 *   P0 = 急跌前一交易日收盘价
 *   Ls = 急跌日起至评估日最低价
 *   P5 = 评估窗口内最高收盘价（含评估日）
 *
 * Shock ≠ Override：结构性破位时 Recovery 无效
 * 规格：v1.1 §A4、§A5
 */
'use strict';

const {
  RECOVERY_LOOKBACK_DAYS,
  RECOVERY_FAILED_RATIO,
  STRUCTURAL_MA60_FACTOR,
  classifyRecoveryRatio
} = require('./v3-constants.js');

/**
 * @param {Array<{close:number,low:number}>} bars
 * @param {number} shockIdx 急跌日下标
 * @param {number} todayIdx 评估日下标
 * @returns {{ ratio: number|null, p0: number|null, ls: number|null, p5: number|null }}
 */
function computeRecoveryRatio(bars, shockIdx, todayIdx) {
  if (!bars || shockIdx == null || todayIdx == null) {
    return { ratio: null, p0: null, ls: null, p5: null };
  }
  if (shockIdx < 1 || todayIdx <= shockIdx) {
    return { ratio: null, p0: null, ls: null, p5: null };
  }
  const daysSince = todayIdx - shockIdx;
  if (daysSince > RECOVERY_LOOKBACK_DAYS) {
    return { ratio: null, p0: null, ls: null, p5: null, expired: true };
  }

  const p0 = bars[shockIdx - 1].close;
  let ls = Infinity;
  let p5 = -Infinity;
  for (let i = shockIdx; i <= todayIdx; i++) {
    if (!bars[i]) continue;
    if (bars[i].low < ls) ls = bars[i].low;
    if (bars[i].close > p5) p5 = bars[i].close;
  }
  if (!Number.isFinite(p0) || !Number.isFinite(ls) || !Number.isFinite(p5) || p0 <= ls) {
    return { ratio: null, p0, ls: Number.isFinite(ls) ? ls : null, p5: Number.isFinite(p5) ? p5 : null };
  }
  const ratio = (p5 - ls) / (p0 - ls);
  return {
    ratio: Math.round(ratio * 10000) / 10000,
    p0,
    ls,
    p5
  };
}

function isMa60Broken(snapshot, close) {
  const ma60 = snapshot && snapshot.ma60;
  if (ma60 == null || close == null) return false;
  return close < ma60 * STRUCTURAL_MA60_FACTOR;
}

/**
 * STRUCTURAL_BREAK 硬规则（v1.1 §A5）
 */
function isStructuralBreak(snapshot, fundamental, bars, todayIdx) {
  if (fundamental && fundamental.f_state === 'F5') return true;
  if (snapshot && snapshot.w_state === 'W5') return true;
  const bar = bars && todayIdx != null ? bars[todayIdx] : null;
  const close = bar ? bar.close : null;
  if (isMa60Broken(snapshot, close)) return true;
  const platformLow = snapshot && (snapshot.platform_low_120 != null
    ? snapshot.platform_low_120
    : snapshot.platform_low);
  if (platformLow != null && close != null && close < platformLow) return true;
  return false;
}

/**
 * 完整 ShockRecovery 评估
 * @returns 兼容 v3-diag-metrics：recovery = strong/good 且非 structural
 */
function evaluateShockRecovery(bars, shockIdx, todayIdx, snapshot, fundamental) {
  const computed = computeRecoveryRatio(bars, shockIdx, todayIdx);
  if (computed.expired) {
    return {
      recovery: false,
      ratio: null,
      expired: true,
      label: 'expired',
      structuralBreak: false,
      blocksStrategicReduce: false
    };
  }
  const bar = bars && todayIdx != null ? bars[todayIdx] : null;
  const close = bar ? bar.close : null;
  const structuralBreak = isStructuralBreak(snapshot, fundamental, bars, todayIdx);
  const ma60Broken = isMa60Broken(snapshot, close);
  const classified = classifyRecoveryRatio(computed.ratio, { ma60Broken });
  const daysSince = todayIdx - shockIdx;

  const recovery = !structuralBreak && classified.recoveryActive;

  return {
    recovery,
    ratio: computed.ratio,
    daysSince,
    label: classified.label,
    structuralBreak,
    blocksStrategicReduce: structuralBreak ? false : classified.blocksStrategicReduce,
    p0: computed.p0,
    ls: computed.ls,
    p5: computed.p5,
    ma60Broken
  };
}

/**
 * Shock 决策矩阵（v1.1 §A5）
 * @returns {'HOLD'|'TACTICAL_REDUCE'|'STRATEGIC_REDUCE'|'ALLOW_STRATEGIC'}
 */
function resolveShockAction({ shock, recoveryLabel, structuralBreak }) {
  if (structuralBreak) return 'STRATEGIC_REDUCE';
  if (!shock) return 'ALLOW_STRATEGIC';
  if (recoveryLabel === 'pending') return 'ALLOW_STRATEGIC';
  if (recoveryLabel === 'strong_recovery' || recoveryLabel === 'good_recovery') return 'HOLD';
  if (recoveryLabel === 'neutral') return 'TACTICAL_REDUCE';
  if (recoveryLabel === 'failed' || recoveryLabel === 'weak') return 'STRATEGIC_REDUCE';
  return 'ALLOW_STRATEGIC';
}

module.exports = {
  computeRecoveryRatio,
  isMa60Broken,
  isStructuralBreak,
  evaluateShockRecovery,
  resolveShockAction,
  RECOVERY_LOOKBACK_DAYS,
  RECOVERY_FAILED_RATIO
};
