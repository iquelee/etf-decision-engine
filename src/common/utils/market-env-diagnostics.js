/**
 * V3.6.1 Safety Hardening R1 —— Market Regime 单一真相诊断（缺陷 #7）
 *
 * 背景（已核实的代码事实）：
 *   1. 决策路径用的 regime = `v3MarketEnv.market_regime`
 *      （`deriveMarketEnvironmentForPortfolio()` → `resolveMarketEnvironment()`），
 *      只在 `trend_stage_enabled=true` 时才被写回 `portfolio.market_regime`
 *      （runDecisionEngine 行 526–529）。
 *   2. 而 `portfolio_snapshot.market_regime` 写的是
 *      `freshPortfolio.market_regime` = `deriveMarketRegime(globalSignals)`，
 *      那是 **V2.1 指数周线打分** 的另一套算法（runDecisionEngine 行 1047 / 1064）。
 *   ⇒ **决策 Regime ≠ Portfolio Snapshot Regime**：同一天两个「市场环境」并存。
 *
 *   3. `market-regime.js::checkCrisisHardTrigger()` 里
 *      `if (indexStates.length >= 5)` 的 W5 多数闸，在线上
 *      `market_env` 只有 3 行（000300 / 000688 / 399006）的前提下
 *      **永远不可达** —— 是一段死逻辑（本轮只加诊断，不改阈值）。
 *
 * 本轮定位：
 *   - 只增加**只读诊断**与**单一对象改造方案**，不改任何阈值、不改生产写入路径。
 *
 * 本文件为**纯函数**。
 */
'use strict';

/** W5 多数闸当前写死需要的最小指数个数（与 market-regime.js 现状一致） */
const W5_MAJORITY_MIN_INDICES = 5;
/** 当前线上宽基指数个数（只读核实：market_env 3 行） */
const LIVE_BROAD_INDEX_COUNT = 3;

/**
 * 评估「W5 多数闸是否可达」。
 * @param {string[]} indexWStates 宽基指数周线 W 序列
 * @param {number} [gateMin] 闸门要求的最小指数数（默认 5，仅作诊断口径）
 */
function diagnoseIndexStateGate(indexWStates, gateMin) {
  const states = Array.isArray(indexWStates) ? indexWStates.filter(Boolean) : [];
  const min = gateMin != null ? gateMin : W5_MAJORITY_MIN_INDICES;
  const w5 = states.filter((w) => w === 'W5').length;
  return {
    index_state_count: states.length,
    w5_count: w5,
    w5_majority_gate_min_indices: min,
    w5_majority_gate_reachable: states.length >= min,
    w5_majority_gate_reason: states.length >= min ? null : 'index_state_count_below_gate_min'
  };
}

/**
 * 诊断两条 regime 路径是否分歧。
 * @param {object} args { decision_regime, snapshot_regime, decision_source, snapshot_source }
 */
function diagnoseRegimeDivergence(args) {
  const a = args || {};
  const decisionRegime = a.decision_regime != null ? a.decision_regime : null;
  const snapshotRegime = a.snapshot_regime != null ? a.snapshot_regime : null;
  return {
    decision_regime: decisionRegime,
    snapshot_regime: snapshotRegime,
    decision_source: a.decision_source || null,
    snapshot_source: a.snapshot_source || null,
    divergent: decisionRegime != null && snapshotRegime != null && decisionRegime !== snapshotRegime
  };
}

/**
 * 单一 MarketEnvironment 对象（**改造方案**，本轮只产出对象，不驱动生产写入）。
 *
 * 设计原则：
 *   - 一天只有一个 regime。产出方 = 决策路径（V3 开启时为 `deriveMarketEnvironmentForPortfolio`，
 *     否则为 `deriveMarketRegime`）。
 *   - `authority` 记录「谁是真源」，`legacy_shadow` 记录被替代的那条路径的计算结果，
 *     便于对照而不产生第二个「当前状态」。
 *   - PortfolioSnapshot 必须直接复用本对象的 `market_regime` / `market_score`，
 *     禁止再自行调用第二套算法。
 *
 * @param {object} args { market_regime, market_factor, market_score, authority, computed_at,
 *                        legacy_shadow, index_state_diagnostics }
 */
function buildSingleMarketEnvironment(args) {
  const a = args || {};
  return {
    market_regime: a.market_regime != null ? a.market_regime : 'range',
    market_factor: a.market_factor != null ? a.market_factor : null,
    market_score: a.market_score != null ? a.market_score : null,
    portfolio_breadth_proxy: a.portfolio_breadth_proxy != null ? a.portfolio_breadth_proxy : null,
    authority: a.authority || 'unknown',
    computed_at: a.computed_at || null,
    legacy_shadow: a.legacy_shadow || null,
    index_state_diagnostics: a.index_state_diagnostics || null
  };
}

module.exports = {
  W5_MAJORITY_MIN_INDICES,
  LIVE_BROAD_INDEX_COUNT,
  diagnoseIndexStateGate,
  diagnoseRegimeDivergence,
  buildSingleMarketEnvironment
};
