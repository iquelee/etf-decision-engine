/**
 * Gen-1 Guarded Shadow Eligibility（WP-G1-GE-03，设计 Gate §0.3；**P3-only**）。
 *
 * 定性：`guardedShadowEligible` 回答的是「**能不能计算**」——
 *   P3 阶段是否允许对**同一个 immutable V3** 做一次 **audit-only** 的 S4 shadow rerun。
 *   ⛔ 它**不是**「能不能采纳」—— 那是 `effective_guarded`（P3 期间恒 `false`）。
 *   二者**不得互换、不得互相推导**（设计 Gate §3.3 口径三分离）。
 *
 * 唯一输入 = `evaluateGen1Permission()` 的返回信封（⇒ 零改动 evaluator、天然同源）：
 *   信封已含全部组件布尔（`guarded.checks.*` / `authority` / `health` / `domain` /
 *   `data_health` / `model`），因此**不需要**复制任何 threshold / safety / domain 逻辑。
 *
 * 唯一调用点 = `cloudfunctions/runDecisionEngine/index.js`（P3 shadow trigger 之前）。
 *
 * 三条结构禁令（源码不变量；⛔ 任一条被破坏即 GOVERNANCE DEVIATION）：
 *   ① ⛔ 不是 `gen1-safety-permission.js` 的 `guardedChecks` 第 9 项
 *      （该文件 in-code 注释明写「原因码只作可解释性细化，不新增合取项」）。
 *   ② ⛔ 不是 `effective_guarded`（章程 §3.3 的 **8 项**表达式）的组成项。
 *   ③ ⛔ 绝不传入 Guarded Selector —— `selectGuardedResult({ effectiveGuarded })` 的入参
 *      语义是**采纳资格**（selector 内 `guarded_considered: effectiveGuarded`）；
 *      一旦传入 shadow 资格，`guarded_considered` 就会被读成「**已考虑采纳**」。
 *
 * 权限边界（逐条恒真）：
 *   ✅ 只能触发 Guarded Shadow V3 rerun
 *   ✅ 只能驱动 shadow / eligibility audit counters
 *   ⛔ 不得传入 Guarded Selector
 *   ⛔ 不得推导 `gen1_adopted`
 *   ⛔ 不得增加 `gen1_guarded_effective_invocations`
 *   ⛔ 不得增加 Evidence Contract 的 `independent_events`
 *
 * 纯函数、无副作用、无 DB、无 require 循环：便于 Node 单测与 CI。
 *
 * @module gen1-shadow-eligibility
 */
'use strict';

/**
 * 唯一定义（设计 Gate §0.3，**6 项合取**；数组顺序即判定顺序）。
 *
 *     authority.gen1_authority === 'CANARY'
 *   ∧ guarded.checks.health_allows_guarded
 *   ∧ guarded.checks.data_ok
 *   ∧ guarded.checks.domain_strict_in_domain
 *   ∧ guarded.checks.safety_pass
 *   ∧ guarded.checks.model_candidate
 *
 * 明确排除（P3 期间结构性未满足 ⇒ ⛔ 不得纳入）：
 *   `authority_guarded`     ← 要求 `GUARDED_EFFECTIVE` 档 authority；P3 保持 `CANARY`
 *   `freeze_seal_approved`  ← 要求 Freeze Seal `APPROVED`；P3 保持 `PENDING`
 *   `evidence_seal_pass`    ← 要求 Evidence Seal `PASS`；P3 保持 `PENDING`
 *
 * ⚠️ 取**从严** Guarded runtime 口径（§0.3.1，N2 裁定），⛔ 不复用从宽的 `effective_canary`：
 *   health = `health_allows_guarded`（显式 `OK` **且** 显式 `ACTIVE`；缺字段 fail-closed）
 *   domain = `domain_strict_in_domain`（`permission==='ALLOW'` **且** `status==='IN_DOMAIN'`）
 */
const SHADOW_COMPONENTS = Object.freeze([
  Object.freeze({ key: 'authority_canary', reason: 'SHADOW_AUTHORITY_NOT_CANARY' }),
  Object.freeze({ key: 'health_allows_guarded', reason: 'SHADOW_HEALTH_NOT_STRICT_OK' }),
  Object.freeze({ key: 'data_ok', reason: 'SHADOW_DATA_NOT_OK' }),
  Object.freeze({ key: 'domain_strict_in_domain', reason: 'SHADOW_DOMAIN_NOT_STRICT_IN_DOMAIN' }),
  Object.freeze({ key: 'safety_pass', reason: 'SHADOW_SAFETY_NOT_PASS' }),
  Object.freeze({ key: 'model_candidate', reason: 'SHADOW_MODEL_NOT_CANDIDATE' })
]);

/**
 * 原因码词表 —— **只作可解释性**。
 * ⛔ 不新增合取项、⛔ 不参与 `eligible` 取值判定（与 §0.3 的 6 项表达式严格一一对应）。
 */
const SHADOW_REASON = Object.freeze({
  AUTHORITY_NOT_CANARY: 'SHADOW_AUTHORITY_NOT_CANARY',
  HEALTH_NOT_STRICT_OK: 'SHADOW_HEALTH_NOT_STRICT_OK',
  DATA_NOT_OK: 'SHADOW_DATA_NOT_OK',
  DOMAIN_NOT_STRICT_IN_DOMAIN: 'SHADOW_DOMAIN_NOT_STRICT_IN_DOMAIN',
  SAFETY_NOT_PASS: 'SHADOW_SAFETY_NOT_PASS',
  MODEL_NOT_CANDIDATE: 'SHADOW_MODEL_NOT_CANDIDATE',
  /** 信封结构不完整（缺 `authority` 或缺 `guarded.checks`）⇒ fail-closed */
  INVALID_PERMISSION: 'SHADOW_PERMISSION_ENVELOPE_INVALID'
});

/** 6 个组件键（供静态守卫 / 单测逐项比对，避免「两人各写一套」）。 */
const SHADOW_COMPONENT_KEYS = Object.freeze(SHADOW_COMPONENTS.map((c) => c.key));

/**
 * 由 permission 信封派生 `guardedShadowEligible`。
 *
 * fail-closed：信封缺失 / 结构不完整 / 任一组件非**严格** `true` ⇒ 一律 `false`。
 *
 * @param {object} permission `evaluateGen1Permission()` 的返回信封
 * @returns {{eligible: boolean, components: object, reason_code: string|null}}
 *   - `eligible`     —— P3 是否允许做 Guarded Shadow V3 rerun
 *   - `components`   —— 6 项逐项布尔（审计 / 判定可解释性）
 *   - `reason_code`  —— 首个不成立的组件对应原因码；全部成立时为 `null`
 */
function deriveGuardedShadowEligibility(permission) {
  const p = permission && typeof permission === 'object' ? permission : {};
  const authority = p.authority && typeof p.authority === 'object' ? p.authority : null;
  const guarded = p.guarded && typeof p.guarded === 'object' ? p.guarded : null;
  const checks = guarded && guarded.checks && typeof guarded.checks === 'object'
    ? guarded.checks
    : null;

  const components = {
    authority_canary: !!(authority
      && String(authority.gen1_authority || '').toUpperCase() === 'CANARY'),
    // 均要求**严格** `=== true`：缺字段 / 非布尔 / 假值一律不成立
    health_allows_guarded: !!(checks && checks.health_allows_guarded === true),
    data_ok: !!(checks && checks.data_ok === true),
    domain_strict_in_domain: !!(checks && checks.domain_strict_in_domain === true),
    safety_pass: !!(checks && checks.safety_pass === true),
    model_candidate: !!(checks && checks.model_candidate === true)
  };

  const envelopeOk = !!authority && !!checks;
  const firstFail = SHADOW_COMPONENTS.find((c) => components[c.key] !== true);
  const eligible = envelopeOk && !firstFail;

  return {
    eligible,
    components,
    reason_code: eligible
      ? null
      : (envelopeOk && firstFail ? firstFail.reason : SHADOW_REASON.INVALID_PERMISSION)
  };
}

/** 便捷布尔视图（⛔ 不得用于推导采纳 / 计数之外的任何语义）。 */
function isGuardedShadowEligible(permission) {
  return deriveGuardedShadowEligibility(permission).eligible === true;
}

module.exports = {
  SHADOW_COMPONENTS,
  SHADOW_COMPONENT_KEYS,
  SHADOW_REASON,
  deriveGuardedShadowEligibility,
  isGuardedShadowEligible
};
