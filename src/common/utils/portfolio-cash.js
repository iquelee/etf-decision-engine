/**
 * V3.6.1 Safety Hardening R1 —— 真实现金 / 隐性杠杆诊断（缺陷 #8）
 *
 * 背景：
 *   生产 `cash_ratio = max(0, 100 - total_position)`（runDecisionEngine::getPortfolioSummary）。
 *   当 book 超过 100%（隐杠杆、重复计入、用户多笔买入未登记）时，**负现金被夹成 0**，
 *   Safety Core 完全看不到「已经超配」这一事实。
 *   历史口径已记录「含 book>100% 101 天；隐杠杆贡献约 +4.93pp」——这正是被夹掉的部分。
 *
 * 本轮定位：
 *   - 保留 `cash_ratio`（clamp 后）供 UI / 既有消费点继续使用；
 *   - **额外**输出 `cash_ratio_raw` / `leverage_excess` / `overbooked` 三个硬诊断；
 *   - 本轮**不**据此自动触发减仓（不接任何决策分支）。
 *
 * 本文件为**纯函数**。
 */
'use strict';

function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * @param {number} totalPosition 合计仓位%（可能 >100，也可能为负/NaN）
 * @returns {{cash_ratio_raw:number, cash_ratio:number, leverage_excess:number, overbooked:boolean}}
 */
function computeCashDiagnostics(totalPosition) {
  const tp = typeof totalPosition === 'number' && Number.isFinite(totalPosition) ? totalPosition : 0;
  const raw = round1(100 - tp);
  const clamped = Math.max(0, raw);
  const excess = raw < 0 ? round1(-raw) : 0;
  return {
    cash_ratio_raw: raw,
    cash_ratio: clamped,
    leverage_excess: excess,
    overbooked: raw < 0
  };
}

module.exports = {
  computeCashDiagnostics
};
