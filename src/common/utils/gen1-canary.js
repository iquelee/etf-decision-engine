/**
 * Gen-1 Canary 反事实链（WP-G1 / G1-03）。
 *
 * 目的：把「Gen-1 建议在 V3.6.1 安全骨架内会得到什么 target」以反事实方式算出来，
 * 用于观察 / 灰度评估。**不开启生产写权限**。
 *
 *   V3.6.1 Baseline
 *        ↓
 *   Gen-1 Candidate
 *        ↓
 *   Safety PERMIT（G1-02 safety.permission === 'PERMIT'）
 *        ↓
 *   authority >= CANARY
 *        ↓
 *   advisoryStageOverride = S4   （V3.6.1 内部：仅 S2/S3 且无 broken 时生效）
 *        ↓
 *   重跑 V3.6.1（Risk / Fundamental / Cap 继续约束）
 *        ↓
 *   canary_target
 *
 * 禁止路径（本模块以不变量保证）：
 *   ml_counterfactual_target → final_target        ❌
 *   STAGE_W.S4 → final_target                      ❌
 *
 * WP-G1.2 G1.2-03（复审 P0）：A/B 必须**只有一个变量**（advisoryStageOverride）。
 * 调用方必须把基线调用用到的**完整上下文逐字段原样传入** canary 重算：
 *   portfolio / bars / trendStageState / shockState / recentSlowBreakScores /
 *   sectorRemainingLimit / cooldownDays / risk / fundamental
 * 任一项不同（如 `recentSlowBreakScores: []`）都会让「差异」无法归因给 Gen-1。
 *
 * 本模块只产出 canary 字段，并显式回显 final_target = V3.6.1 baseline；
 * 调用方（runDecisionEngine）仍必须把 final_target 维持为 V3.6.1 结果。
 *
 * @module gen1-canary
 */
'use strict';

const { authorityAllows } = require('./gen1-authority');

function num(v) {
  return v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
}

function pct(v) {
  const n = num(v);
  return n == null ? null : Math.round(n * 10) / 10;
}

/**
 * @param {object} input
 * @param {object} input.permission            G1-02 evaluateGen1Permission 结果
 * @param {object} input.baseline              V3.6.1 基线（stage/target/action）
 * @param {Function} [input.recomputeCanaryTarget]  (effectiveStage) => { target, action }
 *         —— 由调用方注入「以 advisoryStageOverride=S4 重跑 V3.6.1」的实现，保证复用真实安全骨架。
 * @param {number} [input.maxSingleWeight]     可选单只上限（默认 25）用于二次 clamp 冗余保护。
 * @returns {object} canary 字段 + 生产字段回显
 */
function buildCanaryCounterfactual(input) {
  const src = input || {};
  const permission = src.permission || {};
  const baseline = src.baseline || {};
  const authority = permission.authority || null;

  const baselineStage = (baseline.stage || baseline.trend_stage_primary || baseline.baseline_stage || null);
  const baselineTarget = pct(baseline.target != null ? baseline.target : baseline.v361_baseline_target);
  const baselineAction = baseline.action || baseline.v361_baseline_action || null;

  const canaryAllowed = permission.effective_canary === true
    && !!authority
    && authorityAllows(authority.gen1_authority, 'CANARY_OVERRIDE');

  let effectiveStage = baselineStage;
  let canaryTarget = baselineTarget;
  let canaryAction = baselineAction;
  let canarySuggested = null;
  let canaryEffective = false;
  let canaryReason = canaryAllowed ? null : (permission.safety && permission.safety.reason_code) || 'CANARY_NOT_PERMITTED';

  if (canaryAllowed) {
    effectiveStage = 'S4';
    if (typeof src.recomputeCanaryTarget === 'function') {
      const out = src.recomputeCanaryTarget('S4') || {};
      const t = pct(out.target);
      canaryTarget = t == null ? baselineTarget : t;
      canaryAction = out.action || baselineAction;
      // WP-G1.2 G1.2-03：带上建议执行仓，供组合层占用按生产口径累计
      canarySuggested = pct(out.suggested_position);
    }
    // 冗余二次 clamp：即使调用方未 clamp，也不得超过单只上限
    const cap = num(src.maxSingleWeight);
    if (cap != null && canaryTarget != null && canaryTarget > cap) canaryTarget = cap;
    canaryEffective = true;
  }

  const delta = (canaryTarget != null && baselineTarget != null)
    ? Math.round((canaryTarget - baselineTarget) * 10) / 10
    : null;

  return {
    // 基线（V3.6.1）
    v361_baseline_stage: baselineStage,
    v361_baseline_target: baselineTarget,
    v361_baseline_action: baselineAction,
    // Gen-1 canary 反事实
    gen1_effective_stage: effectiveStage,
    gen1_canary_target: canaryTarget,
    gen1_canary_action: canaryAction,
    gen1_canary_delta: delta,
    gen1_canary_effective: canaryEffective,
    gen1_canary_reason_code: canaryReason,
    gen1_canary_suggested_position: canarySuggested,
    // 生产字段显式回显（永远 = V3.6.1 baseline，供 No-op 校验）
    production_target_pct: baselineTarget,
    final_target: baselineTarget,
    final_action: baselineAction
  };
}

/**
 * 生产 No-op 断言工具（G1-11）：ADVISORY 状态下前后 final_target/final_action 必须一致。
 * @returns {{ok: boolean, diffs: string[]}}
 */
function assertProductionUntouched(before, after) {
  const diffs = [];
  const b = before || {};
  const a = after || {};
  for (const key of ['final_target', 'final_action']) {
    const bv = b[key] == null ? null : b[key];
    const av = a[key] == null ? null : a[key];
    if (String(bv) !== String(av)) diffs.push(`${key}: ${bv} → ${av}`);
  }
  return { ok: diffs.length === 0, diffs };
}

/**
 * WP-G1.2 G1.2-03：**唯一的**赛道占用算法 —— 生产与 Canary 共用。
 *
 * 语义与 `runDecisionEngine` 生产路径逐字一致：
 *   occupyTarget = suggested_position 存在 → min(suggested_position, final_target)
 *                  否则                   → final_target（缺失按 0）
 *   占用增量     = max(0, occupyTarget - currentPosition)
 *
 * @param {number} currentPosition   当前实际仓位
 * @param {number} suggestedPosition 建议执行仓（可为 null）
 * @param {number} finalTarget       最终目标（可为 null）
 * @returns {number} 本次新增的赛道占用
 */
function sectorOccupation(currentPosition, suggestedPosition, finalTarget) {
  const cur = num(currentPosition);
  const sug = num(suggestedPosition);
  const fin = num(finalTarget);
  const occupyTarget = sug != null
    ? Math.min(sug, fin != null ? fin : sug)
    : (fin != null ? fin : 0);
  return Math.max(0, occupyTarget - (cur == null ? 0 : cur));
}

/**
 * WP-G1.2 G1.2-03：Canary 组合平价 —— 单只候选的组合层科技额度 clamp。
 *
 * 复审修正：不再自己发明第二套「可用新增额度」语义。直接用**生产同款**口径：
 *
 *   sectorRemainingLimit = max(0, effectiveTechMax - (sectorUsed - currentPosition))
 *
 * 其中 sectorUsed 是**组合科技总仓位**（种子 = portfolio.tech_position，逐只累加），
 * 因此真实持仓已被计入 —— 这是上一版把 `effectiveTechMax` 误当「新增额度」的修复。
 *
 * @param {object} input
 * @param {boolean} input.isTech              是否科技赛道
 * @param {number}  input.baselineTarget      V3.6.1 基线目标
 * @param {number}  input.canaryTarget        canary 目标（已由 V3.6.1 rerun 得出）
 * @param {boolean} input.canaryEffective     canary 是否生效
 * @param {number}  input.sectorUsed          组合科技总仓位（含现任持仓，本 ETF 之前）
 * @param {number}  input.currentPosition     本 ETF 当前实际仓位
 * @param {number}  input.effectiveTechMax    科技赛道总仓上限
 * @returns {{canaryTarget, canaryDelta, clamped, sectorRemainingLimit}}
 */
function clampCanaryCandidate(input) {
  const x = input || {};
  const numOr = (v, dflt) => (v == null || v === '' || !Number.isFinite(Number(v)) ? dflt : Number(v));
  const base = numOr(x.baselineTarget, 0);
  const max = numOr(x.effectiveTechMax, null);     // 注意：null 不可被 Number() 变成 0
  const used = numOr(x.sectorUsed, numOr(x.techUsed, 0));  // 兼容旧字段名 techUsed
  const current = numOr(x.currentPosition, 0);
  let target = numOr(x.canaryTarget, base);
  const effective = x.canaryEffective === true;
  const isTech = x.isTech === true;

  const sectorRemainingLimit = max == null ? null : Math.max(0, max - (used - current));
  let clamped = false;

  if (effective && isTech && sectorRemainingLimit != null) {
    // 上限 clamp，但**不得低于 baseline**：Canary 只允许「不差于生产 / 不高于 cap」，
    // 绝不因组合记账把目标压到生产基线之下（下限 = baselineTarget）。
    const upper = Math.max(base, sectorRemainingLimit);
    if (target > upper) {
      target = Math.round(upper * 10) / 10;
      clamped = true;
    }
  }

  const delta = Math.round((target - base) * 10) / 10;
  return { canaryTarget: target, canaryDelta: delta, clamped, sectorRemainingLimit };
}

module.exports = {
  buildCanaryCounterfactual,
  assertProductionUntouched,
  clampCanaryCandidate,
  sectorOccupation
};
