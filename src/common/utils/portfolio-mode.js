/**
 * V3.6.1 Safety Hardening R1 —— Portfolio Mode 单一真相 + 只读诊断（缺陷 #3）
 *
 * 背景：
 *   `decision-v3.js::isV3PortfolioMode()` 依赖 `portfolio.multi_etf` 或
 *   `portfolio.etf_count > 1`，但 `runDecisionEngine::getPortfolioSummary()`
 *   **从未返回这两个字段** ⇒ 生产 5 只 ETF 的组合实际一直跑在「单票轨」上
 *   （`v3_dual_track_enabled` 默认 true，但两条判据都拿不到证据 ⇒ 恒 false）。
 *
 * 本轮定位：
 *   - **只加只读诊断**，不改变任何生产行为。
 *   - 诊断字段一律使用 `portfolio_mode_*` / `portfolio_detected_*` 命名，
 *     决策路径**只读** `multi_etf` / `etf_count` 两个 legacy 字段 ⇒
 *     新增诊断字段**不可能**反向驱动生产结果。
 *   - 是否让新的 portfolio flag 驱动生产，必须等 Replay 报告（CURRENT_PATH vs
 *     FORCED_PORTFOLIO_PATH）通过后单独 PR 晋升。
 *
 * 本文件为**纯函数**，不读写任何状态、不触碰生产写入路径。
 */
'use strict';

const REASON = Object.freeze({
  DUAL_TRACK_DISABLED: 'dual_track_disabled',
  FORCED_SINGLE: 'forced_single_track',
  FORCED_PORTFOLIO: 'forced_portfolio_track',
  MULTI_ETF_FLAG: 'multi_etf_flag',
  ETF_COUNT_GT_1: 'etf_count_gt_1',
  NO_PORTFOLIO_EVIDENCE: 'no_portfolio_evidence'
});

/**
 * 读取 portfolio 上的标的数量证据（**只认 legacy 字段**）。
 * @returns {number|null} null = 无从判断
 */
function detectEtfCount(portfolio) {
  if (!portfolio) return null;
  if (typeof portfolio.etf_count === 'number' && Number.isFinite(portfolio.etf_count)) {
    return portfolio.etf_count;
  }
  return null;
}

/**
 * 组合轨判定（与修复前 `isV3PortfolioMode` 完全一致的行为）。
 * ⚠️ 决策语义只允许读 `multi_etf` / `etf_count`，不得读诊断字段。
 */
function resolvePortfolioTrack(portfolio, params) {
  if (!params || params.v3_dual_track_enabled === false) {
    return { effective: false, reason: REASON.DUAL_TRACK_DISABLED };
  }
  if (params.v3_force_single_track === true) {
    return { effective: false, reason: REASON.FORCED_SINGLE };
  }
  if (params.v3_force_portfolio_track === true) {
    return { effective: true, reason: REASON.FORCED_PORTFOLIO };
  }
  if (portfolio && portfolio.multi_etf === true) {
    return { effective: true, reason: REASON.MULTI_ETF_FLAG };
  }
  const count = detectEtfCount(portfolio);
  if (count != null && count > 1) {
    return { effective: true, reason: REASON.ETF_COUNT_GT_1 };
  }
  return { effective: false, reason: REASON.NO_PORTFOLIO_EVIDENCE };
}

function isV3PortfolioMode(portfolio, params) {
  return resolvePortfolioTrack(portfolio, params).effective === true;
}

/**
 * 只读诊断：把「本应为组合轨」与「实际生效轨」并列摆出来，供 Replay / 报告使用。
 * 返回值中的任何字段都**不参与**决策。
 *
 * @param {object} portfolio
 * @param {object} params
 * @param {number} [declaredEtfCount] 由调用方（universe）显式声明的标的数量，仅用于诊断
 * @returns {{portfolio_detected_etf_count:number|null,
 *            portfolio_mode_expected:boolean|null,
 *            portfolio_mode_effective:boolean,
 *            portfolio_mode_expected_reason:string,
 *            portfolio_mode_effective_reason:string,
 *            portfolio_mode_suspected_mismatch:boolean}}
 */
function diagnoseV3PortfolioMode(portfolio, params, declaredEtfCount) {
  const track = resolvePortfolioTrack(portfolio, params);
  const legacyCount = detectEtfCount(portfolio);
  const declared = typeof declaredEtfCount === 'number' && Number.isFinite(declaredEtfCount)
    ? declaredEtfCount : null;
  const detected = legacyCount != null ? legacyCount : declared;

  let expected = null;
  let expectedReason = REASON.NO_PORTFOLIO_EVIDENCE;
  if (params && params.v3_force_portfolio_track === true) {
    expected = true;
    expectedReason = REASON.FORCED_PORTFOLIO;
  } else if (params && params.v3_force_single_track === true) {
    expected = false;
    expectedReason = REASON.FORCED_SINGLE;
  } else if (params && params.v3_dual_track_enabled === false) {
    expected = false;
    expectedReason = REASON.DUAL_TRACK_DISABLED;
  } else if (detected != null) {
    expected = detected > 1;
    expectedReason = 'detected_etf_count';
  } else if (portfolio && portfolio.multi_etf === true) {
    expected = true;
    expectedReason = REASON.MULTI_ETF_FLAG;
  }

  return {
    portfolio_detected_etf_count: detected,
    portfolio_mode_expected: expected,
    portfolio_mode_effective: track.effective,
    portfolio_mode_expected_reason: expectedReason,
    portfolio_mode_effective_reason: track.reason,
    // 仅当「本应为组合轨」但「实际跑在单票轨」时置位；仅诊断，不驱动任何分支
    portfolio_mode_suspected_mismatch: expected === true && track.effective === false
  };
}

module.exports = {
  REASON,
  detectEtfCount,
  resolvePortfolioTrack,
  isV3PortfolioMode,
  diagnoseV3PortfolioMode
};
