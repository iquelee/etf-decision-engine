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
  OUT_OF_DOMAIN: 'DOMAIN_OUT_OF_DOMAIN'
});

/**
 * @param {string} category  secctor / category（gold / biotech / storage ...）
 * @param {string} [code]    兜底用 ETF 代码推断
 * @returns {{status, permission, reason_code, reason, warning, observed_folds, total_folds}}
 */
function evaluateDomainPermission(category, code) {
  // 复用 gen1-capability 的 inferCategory（含 code → category 兜底）
  let cov;
  try {
    const { inferCategory } = require('./gen1-capability');
    cov = getCategoryCoverage(inferCategory(category, code));
  } catch (e) {
    cov = getCategoryCoverage(category);
  }

  const status = cov.domain_status;
  let permission;
  let reasonCode;
  let warning = false;
  if (status === 'IN_DOMAIN') {
    permission = PERMISSION.ALLOW;
    reasonCode = REASON.IN_DOMAIN;
  } else if (status === 'PARTIAL_COVERAGE') {
    permission = PERMISSION.CANARY_LIMITED;
    reasonCode = REASON.PARTIAL;
    warning = true;
  } else {
    permission = PERMISSION.BLOCK_CANARY;
    reasonCode = REASON.OUT_OF_DOMAIN;
    warning = true;
  }

  return {
    category: cov.category,
    status,
    permission,
    reason_code: reasonCode,
    reason: cov.message,
    warning,
    observed_folds: cov.observed_folds,
    total_folds: cov.total_folds,
    coverage_ratio: cov.coverage_ratio
  };
}

module.exports = { PERMISSION, REASON, evaluateDomainPermission };
