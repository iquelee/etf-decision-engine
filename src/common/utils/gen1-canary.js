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
  let canaryEffective = false;
  let canaryReason = canaryAllowed ? null : (permission.safety && permission.safety.reason_code) || 'CANARY_NOT_PERMITTED';

  if (canaryAllowed) {
    effectiveStage = 'S4';
    if (typeof src.recomputeCanaryTarget === 'function') {
      const out = src.recomputeCanaryTarget('S4') || {};
      const t = pct(out.target);
      canaryTarget = t == null ? baselineTarget : t;
      canaryAction = out.action || baselineAction;
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
 * G1.1-05：Canary 组合平价 —— 单只候选的组合层科技额度 clamp（顺序累计，与生产 sectorUsed 同构）。
 *
 * 保证：多个科技 Canary 目标聚合后不超过 effectiveTechMax。
 *
 * @param {object} input
 * @param {boolean} input.isTech            是否科技赛道
 * @param {number}  input.baselineTarget    V3.6.1 基线目标
 * @param {number}  input.canaryTarget      canary 目标（已由 V3.6.1 rerun 得出）
 * @param {boolean} input.canaryEffective   canary 是否生效
 * @param {number}  input.techUsed          之前已占用的科技增量
 * @param {number}  input.effectiveTechMax  科技赛道上限
 * @returns {{canaryTarget, canaryDelta, clamped, techUsed, room}}
 */
function clampCanaryCandidate(input) {
  const x = input || {};
  const numOr = (v, dflt) => (v == null || v === '' || !Number.isFinite(Number(v)) ? dflt : Number(v));
  const base = numOr(x.baselineTarget, 0);
  const max = numOr(x.effectiveTechMax, null);   // 注意：null 不可被 Number() 变成 0
  const used = numOr(x.techUsed, 0);
  let target = numOr(x.canaryTarget, base);
  const effective = x.canaryEffective === true;
  const isTech = x.isTech === true;

  let clamped = false;
  let nextUsed = used;
  const room = max == null ? null : Math.max(0, max - used);

  if (effective && isTech && room != null) {
    const deltaUp = Math.max(0, target - base);
    if (deltaUp > room) {
      target = Math.round((base + room) * 10) / 10;
      clamped = true;
    }
    nextUsed = used + Math.max(0, target - base);
  }

  const delta = Math.round((target - base) * 10) / 10;
  return { canaryTarget: target, canaryDelta: delta, clamped, techUsed: nextUsed, room };
}

module.exports = {
  buildCanaryCounterfactual,
  assertProductionUntouched,
  clampCanaryCandidate
};
