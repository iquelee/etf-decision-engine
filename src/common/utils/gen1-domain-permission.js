/**
 * Gen-1 Domain Permission（WP-G1 / G1-06）。
 *
 * 把 gen1-capability 的「展示用 domain_status」升级为**有约束力的权限判断**：
 *
 *   IN_DOMAIN        → ALLOW
 *   PARTIAL_COVERAGE → CANARY_LIMITED（附警告；允许 canary 但明确标注覆盖不足）
 *   OUT_OF_DOMAIN    → BLOCK_CANARY（禁止 fast path 改 Stage，仍用 V3.6.1）
 *
 * 注意：域外**不阻断人工建议（ADVISORY）**，只阻断 Canary 覆盖 ——
 * 概率仍可展示供人工参考，但不得由 Gen-1 Fast Path 改变 Stage。
 *
 * @module gen1-domain-permission
 */
'use strict';

const { getCategoryCoverage } = require('./gen1-capability');

const PERMISSION = Object.freeze({
  ALLOW: 'ALLOW',
  CANARY_LIMITED: 'CANARY_LIMITED',
  BLOCK_CANARY: 'BLOCK_CANARY'
});

const REASON = Object.freeze({
  IN_DOMAIN: 'DOMAIN_IN_DOMAIN',
  PARTIAL: 'DOMAIN_PARTIAL_COVERAGE',
  OUT_OF_DOMAIN: 'DOMAIN_OUT_OF_DOMAIN',
  /** G1.1-02：encoder 契约审计发现编码为 -1 的 fold（供审计/展示，不额外降级）。 */
  ENCODER_PARTIAL_ENCODING: 'DOMAIN_ENCODER_PARTIAL_ENCODING'
});

/**
 * @param {string} category  sector / category（gold / biotech / storage ...）
 * @param {string} [code]    兜底用 ETF 代码推断
 *
 * G1.1-02 结论：runtime sector 与 frozen encoder 契约**一致**（observed_folds == 命中 fold 数），
 * 故权限映射保持三档；仅额外标注 encoder 命中情况供审计：
 *   0/3 → OUT_OF_DOMAIN → BLOCK_CANARY（gold）
 *   1–2/3 → PARTIAL_COVERAGE → CANARY_LIMITED（storage / ai_network / semi_equip，附 encoder 告警）
 *   3/3 → IN_DOMAIN → ALLOW（biotech）
 */
function evaluateDomainPermission(category, code) {
  const { inferCategory, getCategoryCoverage } = require('./gen1-capability');
  const cov = getCategoryCoverage(inferCategory(category, code));

  const base = {
    category: cov.category,
    observed_folds: cov.observed_folds,
    total_folds: cov.total_folds,
    coverage_ratio: cov.coverage_ratio,
    encoder_recognized: cov.encoder_recognized,
    encoder_partial: cov.encoder_partial,
    encoder_folds_present: cov.encoder_folds_present,
    contract_version: cov.contract_version
  };

  if (cov.domain_status === 'IN_DOMAIN') {
    return Object.assign(base, {
      status: cov.domain_status, permission: PERMISSION.ALLOW,
      reason_code: REASON.IN_DOMAIN, reason: cov.message, warning: false
    });
  }
  if (cov.domain_status === 'PARTIAL_COVERAGE') {
    return Object.assign(base, {
      status: cov.domain_status, permission: PERMISSION.CANARY_LIMITED,
      reason_code: REASON.PARTIAL, reason: cov.message, warning: true
    });
  }
  return Object.assign(base, {
    status: cov.domain_status, permission: PERMISSION.BLOCK_CANARY,
    reason_code: REASON.OUT_OF_DOMAIN, reason: cov.message, warning: true
  });
}

module.exports = { PERMISSION, REASON, evaluateDomainPermission };
