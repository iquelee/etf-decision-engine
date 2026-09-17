/**
 * Gen-1 Guarded 权威选择器 + 采纳审计（WP-G1-GE-02，**dormant**）。
 *
 * 章程 §4.3 的执行拓扑要求：`guarded V3 result` 若将来进入生产，必须经由**显式选择器**，
 * 而**不是**让 `applyGen1Overlay` 去改 `final_target`。
 *
 * ⚠️ WP-G1-GE-02 阶段本模块是**休眠件**：
 *   - `selectGuardedResult()` **无条件**返回 baseline（`GE_02_BASELINE_AUTHORITATIVE = true`）。
 *   - 即使 `effectiveGuarded === true` 且传入了 guarded 结果，权威结果仍是 baseline。
 *   - 计算/采用 guarded 结果的影子重跑属 **WP-G1-GE-03**；
 *     翻转选择器属 **WP-G1-GE-04**（须 Evidence Gate PASS + 显式裁决 + 新 runbook）。
 *
 * 本模块为纯函数（除 stableHash 用 crypto 外无副作用），便于单测。
 *
 * @module gen1-guarded-selector
 */
'use strict';

const crypto = require('crypto');

const SELECTOR_SOURCE = Object.freeze({
  BASELINE: 'BASELINE',
  GUARDED: 'GUARDED'
});

/**
 * GE-02 冻结开关：选择器恒 baseline（dormant）。
 * ⚠️ 置为 false **不等于**可以启用 guarded —— 还须 §3.1 三钥匙全过 + Evidence Gate PASS
 *    + 章程 v2.0 重冻结 + WP-G1-GE-04 显式晋升。此处只作「本阶段不得翻转」的硬标记。
 */
const GE_02_BASELINE_AUTHORITATIVE = true;

/** decision_source 词表（章程 §6.1）。 */
const DECISION_SOURCE = Object.freeze({
  V361_ONLY: 'V361_SAFETY_CORE',
  V361_WITH_GEN1: 'V361_SAFETY_CORE_WITH_GEN1'
});

/** 稳定序列化：数值统一 10 位小数（跨端一致），其余按字符串。 */
function tokenValue(v) {
  if (v == null) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? v.toFixed(10) : '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

/**
 * 候选输入稳定哈希（与仓库既有配方一致：`k~v` 行 + 字典序 + `|` 连接 + sha256）。
 * 用于 `decision_result.gen1_candidate_hash` —— 证明「被 V3 读到的那份候选」是哪一份。
 */
function candidateHash(candidate) {
  const c = candidate || {};
  const rows = Object.keys(c)
    .filter((k) => c[k] !== undefined)
    .sort()
    .map((k) => `${k}~${tokenValue(c[k])}`);
  return crypto.createHash('sha256').update(rows.join('|')).digest('hex');
}

/**
 * 权威结果选择（GE-02：恒 baseline）。
 *
 * @param {object} input
 * @param {object} input.baseline          V3.6.1 baseline 结果（权威候选）
 * @param {object} [input.guarded]         guarded V3 重跑结果（GE-02 恒不提供，为 null）
 * @param {boolean} [input.effectiveGuarded] `evaluateGen1Permission().effective_guarded`
 * @returns {{
 *   selected_result: object, authoritative_source: string,
 *   guarded_considered: boolean, guarded_available: boolean, guarded_result: object|null,
 *   frozen_baseline_only: boolean, reason_code: string, delta: number|null
 * }}
 */
function selectGuardedResult(input) {
  const src = input || {};
  const baseline = src.baseline == null ? null : src.baseline;
  const guarded = src.guarded == null ? null : src.guarded;
  const effectiveGuarded = src.effectiveGuarded === true;

  // GE-02：无条件 baseline。guarded 结果（若存在）只作审计镜像，绝不成为权威结果。
  const authoritativeSource = SELECTOR_SOURCE.BASELINE;
  const selected = baseline;

  const out = {
    selected_result: selected,
    authoritative_source: authoritativeSource,
    guarded_considered: effectiveGuarded,
    guarded_available: guarded != null,
    guarded_result: guarded,
    frozen_baseline_only: GE_02_BASELINE_AUTHORITATIVE,
    reason_code: 'DORMANT_BASELINE_AUTHORITATIVE',
    delta: null
  };

  // 硬不变量：GE-02 下权威结果必须**就是** baseline 对象本身（逐引用相等）。
  if (authoritativeSource === SELECTOR_SOURCE.GUARDED) {
    throw new Error('WP-G1-GE-02 selector 必须 baseline-authoritative（不得选 GUARDED）');
  }
  if (selected !== baseline) {
    throw new Error('WP-G1-GE-02 selector 不得替换 baseline 结果');
  }
  return out;
}

/** decision_source：只有权威来源为 GUARDED 时才是 WITH_GEN1（GE-02 恒为纯 V3.6.1）。 */
function decisionSourceOf(selection) {
  return selection && selection.authoritative_source === SELECTOR_SOURCE.GUARDED
    ? DECISION_SOURCE.V361_WITH_GEN1
    : DECISION_SOURCE.V361_ONLY;
}

/**
 * 构造 `decision_result` 的 Guarded 审计字段（章程 §6.1）。
 * ⚠️ **纯审计**：绝不参与任何 production 字段计算。
 *
 * @param {object} input
 * @param {object} input.permission  `evaluateGen1Permission()` 输出
 * @param {object} [input.signal]    `ml_shadow_signal` 行
 * @param {string} [input.code]      ETF 代码（用于候选哈希；缺省时回落到 signal.code）
 * @param {object} input.baseline    `{ target, stage, action }`
 * @param {object} input.selection   `selectGuardedResult()` 输出
 */
function buildGuardedAudit(input) {
  const src = input || {};
  const p = src.permission || {};
  const g = p.guarded || {};
  const signal = src.signal || null;
  const baseline = src.baseline || {};
  const selection = src.selection || null;

  const adopted = (selection && selection.authoritative_source === SELECTOR_SOURCE.GUARDED) === true;
  const baselineTarget = baseline.target == null ? null : baseline.target;
  const guardedTarget = selection && selection.guarded_result
    ? (selection.guarded_result.target == null ? null : selection.guarded_result.target)
    : null;

  // 未采纳原因（按可解释性排序）：
  //   ① 已被采纳 → null
  //   ② 所有守门都成立、仅因选择器仍是休眠态而未采纳 → DORMANT_BASELINE_AUTHORITATIVE
  //   ③ 否则优先报**模型层**原因（最常问的「为什么没触发」），再回落首个不成立的守门原因码
  const modelReason = (p.model && p.model.reason_code) || null;
  let rejectReason;
  if (adopted) rejectReason = null;
  else if (g.effective_guarded === true) rejectReason = 'DORMANT_BASELINE_AUTHORITATIVE';
  else rejectReason = modelReason || g.reason_code || 'GEN1_NOT_ADOPTED';

  return {
    decision_source: decisionSourceOf(selection),
    // 当日 Gen-1 EOD 运行标识（runGen1ShadowEod 写入 ml_shadow_signal.signal_run_id）
    gen1_run_id: signal ? (signal.signal_run_id || null) : null,
    gen1_candidate_hash: signal ? candidateHash({
      code: src.code != null ? src.code : (signal.code != null ? signal.code : null),
      date: signal.date || null,
      model_id: signal.ml_model_id || signal.model_id || null,
      stage: signal.stage || null,
      ml_fast: signal.ml_fast === true,
      calibrated_probability: signal.calibrated_probability == null
        ? null : signal.calibrated_probability,
      threshold_signal_p: p.model ? (p.model.threshold_signal_p == null ? null : p.model.threshold_signal_p) : null,
      authority: (p.authority && p.authority.gen1_authority) || null
    }) : null,
    gen1_adopted: adopted,
    gen1_reject_reason_code: rejectReason,
    // V3 采纳后又被裁剪的原因（如触科技 cap）——GE-02 无采纳路径 ⇒ 恒 null
    gen1_safety_core_adjust_reason: null,
    gen1_guarded_baseline_stage: baseline.stage == null ? null : baseline.stage,
    gen1_guarded_effective_stage: selection && selection.guarded_result
      ? (selection.guarded_result.stage == null ? null : selection.guarded_result.stage)
      : null,
    gen1_guarded_baseline_target: baselineTarget,
    gen1_guarded_result_target: guardedTarget,
    gen1_guarded_delta: (guardedTarget == null || baselineTarget == null)
      ? null : guardedTarget - baselineTarget,
    gen1_guarded_selector_source: selection
      ? selection.authoritative_source : SELECTOR_SOURCE.BASELINE,
    // ---- GE-03（设计 Gate §2.1）：Guarded Shadow 的**并行来源**标识 ----
    // 仅当 shadow 结果确实产出（= 该次 immutable V3 S4 rerun 被认领）时非空。
    // ⛔ 它只标注「这份 shadow 审计结果来自哪条通道」，不参与任何计算、不改变任何既有字段。
    gen1_guarded_shadow_source: selection && selection.guarded_result
      ? 'V361_RERUN_S4_GUARDED_SHADOW' : null
  };
}

module.exports = {
  SELECTOR_SOURCE,
  DECISION_SOURCE,
  GE_02_BASELINE_AUTHORITATIVE,
  candidateHash,
  selectGuardedResult,
  decisionSourceOf,
  buildGuardedAudit
};
