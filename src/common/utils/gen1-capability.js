/**
 * Frozen Gen-1 capability and category-coverage metadata.
 *
 * This module is display/audit metadata only.  It must never alter a
 * probability, threshold, rule gate, Stage, target, or execution decision.
 * Counts were read from the three CalibratedClassifierCV submodels in the
 * frozen HVT-A-ET-20260830 artifact during the 2026-09-04 capability audit.
 */
'use strict';

const MODEL_ID = 'HVT-A-ET-20260830';
const CALIBRATION_FOLDS = 3;

const CAPABILITY = Object.freeze({
  model_id: MODEL_ID,
  model_role: 'EARLY_TRANSITION_RANKING_ENGINE',
  model_role_label: '趋势启动排序引擎',
  ranking: 'PASS',
  stability: 'PASS',
  feature_value: 'PASS',
  cross_model_consistency: 'PASS',
  threshold: 'UNPROVEN',
  calibration: 'UNPROVEN',
  economic_live: 'PENDING',
  live_oos: 'PENDING',
  headline: '趋势排序：已验证',
  live_headline: '实时经济验证：进行中',
  note: '概率用于机会排序；0.65 阈值、概率语义与真实经济价值仍待独立 Live OOS 验证。'
});

// A value of 2 means the category was present in two out of the three
// calibration submodels.  It is deliberately not a probability penalty.
const SECTOR_COVERAGE = Object.freeze({
  storage: 2,
  ai_network: 2,
  semi_equip: 2,
  gold: 0,
  biotech: 3
});
const CATEGORY_BY_CODE = Object.freeze({
  '513310': 'storage', '515880': 'ai_network', '159582': 'semi_equip',
  '518880': 'gold', '159570': 'biotech'
});

function normalizeCategory(category) {
  return String(category || '').trim() || 'unknown';
}

function inferCategory(category, code) {
  const normalized = normalizeCategory(category);
  if (normalized !== 'unknown') return normalized;
  return CATEGORY_BY_CODE[String(code || '')] || normalized;
}

function getCategoryCoverage(category) {
  const normalized = normalizeCategory(category);
  const observedFolds = Object.prototype.hasOwnProperty.call(SECTOR_COVERAGE, normalized)
    ? SECTOR_COVERAGE[normalized] : 0;
  let domainStatus = 'IN_DOMAIN';
  let label = '正常';
  let message = '该类别在全部校准子模型中均有训练覆盖。';
  if (observedFolds === 0) {
    domainStatus = 'OUT_OF_DOMAIN';
    label = '域外';
    message = '该资产类别未进入 Gen-1 校准训练分布；概率仅供观察，不改变任何规则。';
  } else if (observedFolds < CALIBRATION_FOLDS) {
    domainStatus = 'PARTIAL_COVERAGE';
    label = '部分覆盖';
    message = '部分校准子模型未见该类别；概率保留原值，仅附带适用性提示。';
  }
  return {
    category: normalized,
    observed_folds: observedFolds,
    total_folds: CALIBRATION_FOLDS,
    coverage_ratio: observedFolds / CALIBRATION_FOLDS,
    domain_status: domainStatus,
    label,
    message
  };
}

function capabilityForApi() {
  return { ...CAPABILITY };
}

module.exports = {
  MODEL_ID,
  CALIBRATION_FOLDS,
  CAPABILITY,
  inferCategory,
  getCategoryCoverage,
  capabilityForApi
};
