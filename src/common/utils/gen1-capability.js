/**
 * Frozen Gen-1 capability and category-coverage metadata.
 *
 * This module is display/audit metadata only.  It must never alter a
 * probability, threshold, rule gate, Stage, target, or execution decision.
 *
 * --- WP-G1.1 / G1.1-02（sector contract 审计结论，2026-09-10）---
 * 三个 calibration fold 的 categorical encoder **类别集合互不相同**：
 *   fold0: [ai, biotech, comms, growth_broad, semi]
 *   fold1: [ai, ai_network, biotech, comms, growth_broad, semi, semi_equip, storage]
 *   fold2: [ai_network, biotech, growth_broad, semi, semi_equip, storage]
 * 因此运行时 sector 字符串在各 fold 的编码结果不同（未命中 → -1 unknown）。
 *
 * 审计发现：`observed_folds` 恰好等于「认识该字符串的 fold 数」——
 *   storage 2/3、ai_network 2/3、semi_equip 2/3、biotech 3/3、gold 0/3。
 * 即原有声明与 frozen encoder 真实契约**一致**，不存在矛盾。
 *
 * 为避免未来手写漂移，本文件现**由 ENCODER_SECTOR_FOLDS 推导** observed_folds；
 * scripts/audit-gen1-sector-contract.js 作为 CI 门禁断言二者一致（不一致 → FAIL）。
 *
 * 诚实备注（不影响权限）：storage / ai_network / semi_equip 有 1/3 fold 编码为 -1；
 * gold 3/3 均 -1（域外）。这与 PARTIAL / OUT_OF_DOMAIN 标注相符。
 */
'use strict';

const MODEL_ID = 'HVT-A-ET-20260830';
const CALIBRATION_FOLDS = 3;

/**
 * encoder 契约事实（审计产物，勿手改；由 scripts/audit-gen1-sector-contract.js 校验）。
 * 每项 = 三个 fold 的 encoder 是否包含该运行时 sector 字符串。
 */
const ENCODER_SECTOR_FOLDS = Object.freeze({
  biotech: Object.freeze([true, true, true]),
  storage: Object.freeze([false, true, true]),
  ai_network: Object.freeze([false, true, true]),
  semi_equip: Object.freeze([false, true, true]),
  gold: Object.freeze([false, false, false])
});
const SECTOR_CONTRACT_VERSION = 'gen1-sector-contract-v1';

/** 由 encoder 契约推导覆盖数（单一来源，杜绝手写漂移）。 */
const SECTOR_COVERAGE = Object.freeze(
  Object.keys(ENCODER_SECTOR_FOLDS).reduce((acc, k) => {
    acc[k] = ENCODER_SECTOR_FOLDS[k].filter(Boolean).length;
    return acc;
  }, {})
);

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
  const foldsPresent = Object.prototype.hasOwnProperty.call(ENCODER_SECTOR_FOLDS, normalized)
    ? ENCODER_SECTOR_FOLDS[normalized] : [false, false, false];
  const observedFolds = foldsPresent.filter(Boolean).length;
  const encoderPartial = observedFolds > 0 && observedFolds < CALIBRATION_FOLDS;
  const encoderRecognized = observedFolds === CALIBRATION_FOLDS;

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
    message = `部分校准子模型未见该类别（${observedFolds}/${CALIBRATION_FOLDS}）；`
      + '未命中的 fold 将该类编码为 -1（unknown）。概率保留原值，仅附带适用性提示。';
  }
  return {
    category: normalized,
    observed_folds: observedFolds,
    total_folds: CALIBRATION_FOLDS,
    coverage_ratio: observedFolds / CALIBRATION_FOLDS,
    domain_status: domainStatus,
    label,
    message,
    // G1.1-02：encoder 契约（审计事实）
    encoder_recognized: encoderRecognized,
    encoder_partial: encoderPartial,
    encoder_folds_present: foldsPresent.slice(),
    encoder_categories_by_fold_note: '各 fold encoder 类别集合不同；未命中 fold 编码 -1',
    contract_version: SECTOR_CONTRACT_VERSION
  };
}

function capabilityForApi() {
  return {
    ...CAPABILITY,
    encoder_contract: {
      version: SECTOR_CONTRACT_VERSION,
      per_fold_present: ENCODER_SECTOR_FOLDS,
      observed_folds_derived_from_encoder: true,
      status: 'CONSISTENT',
      note: 'observed_folds 由 encoder 契约推导；gold 为 0/3（域外）。'
    }
  };
}

module.exports = {
  MODEL_ID,
  CALIBRATION_FOLDS,
  CAPABILITY,
  ENCODER_SECTOR_FOLDS,
  SECTOR_CONTRACT_VERSION,
  SECTOR_COVERAGE,
  inferCategory,
  getCategoryCoverage,
  capabilityForApi
};
