/**
 * V3.0 v1.1 B4 — 溢价三级（5% / 8% / 12%）
 */
'use strict';

const V3_PREMIUM_THRESHOLDS = Object.freeze({
  warning: 5,
  high: 8,
  extreme: 12
});

const GRADE_ORDER = Object.freeze(['A', 'B', 'C', 'D', 'E', 'F']);

function classifyPremiumTier(premiumRate) {
  if (premiumRate == null || Number.isNaN(Number(premiumRate))) return 'normal';
  const p = Math.abs(Number(premiumRate));
  if (p > V3_PREMIUM_THRESHOLDS.extreme) return 'extreme';
  if (p > V3_PREMIUM_THRESHOLDS.high) return 'high';
  if (p > V3_PREMIUM_THRESHOLDS.warning) return 'warning';
  return 'normal';
}

function downgradeGrade(grade) {
  const i = GRADE_ORDER.indexOf(grade);
  if (i < 0) return grade;
  return GRADE_ORDER[Math.min(GRADE_ORDER.length - 1, i + 1)];
}

function premiumTierLabel(tier) {
  const map = {
    normal: '正常',
    warning: '轻度溢价>5%',
    high: '明显溢价>8%',
    extreme: '极端溢价>12%'
  };
  return map[tier] || tier;
}

module.exports = {
  V3_PREMIUM_THRESHOLDS,
  classifyPremiumTier,
  downgradeGrade,
  premiumTierLabel
};
