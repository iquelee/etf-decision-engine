/**
 * Gen-1 决策结果装饰器（WP-G1 / G1-02 + G1-03 + G1-11 No-op）。
 *
 * 把 Safety Core Permission 与 Canary 反事实字段附加到 V3.6.1 的 decision_result 上，
 * 并以**硬不变量**保证生产字段（final_target / final_action）永不因此改变。
 *
 * 抽成纯函数的目的：让「Production No-op」（G1-11 Gate G1-H）可以在无 DB 环境下直接单测：
 *   applyGen1Overlay(x, ...).final_target === x.final_target  恒成立。
 *
 * @module gen1-overlay
 */
'use strict';

const PRODUCTION_FIELDS = Object.freeze(['final_target', 'final_action']);

/**
 * @param {object} result      V3.6.1 decision_result（会被浅拷贝，不原地修改）
 * @param {object} permission  G1-02 evaluateGen1Permission 输出
 * @param {object} canary      G1-03 buildCanaryCounterfactual 输出
 * @returns {object} 装饰后的副本
 */
function applyGen1Overlay(result, permission, canary) {
  const out = Object.assign({}, result || {});
  // 先冻结生产字段（无论后续写入什么，最后强制还原）
  const prodTarget = out.final_target == null ? null : out.final_target;
  const prodAction = out.final_action == null ? null : out.final_action;

  const p = permission || {};
  const s = p.safety || {};
  const e = p.eod_precheck || {};

  // Safety Core Permission（对外唯一许可来源）
  out.ml_rule_permission = s.permission == null ? null : s.permission;
  out.ml_rule_permission_reason_code = s.reason_code || null;
  out.ml_rule_permission_reason = s.reason || null;
  out.ml_rule_permission_source = s.source || 'SAFETY_CORE';
  // EOD 预检单列，避免与 Safety 混淆
  out.eod_precheck_permission = e.permission == null ? null : e.permission;
  out.eod_precheck_reason_code = e.reason_code || null;
  out.eod_precheck_reason = e.reason || null;
  // Gen-1 授权状态
  out.gen1_authority = (p.authority && p.authority.gen1_authority) || null;
  out.ml_advisory_effective = p.effective_advisory === true;
  out.gen1_canary_eligible = p.effective_canary === true;

  // Canary 反事实字段
  const c = canary || {};
  out.gen1_effective_stage = c.gen1_effective_stage != null ? c.gen1_effective_stage : null;
  out.gen1_canary_target = c.gen1_canary_target != null ? c.gen1_canary_target : null;
  out.gen1_canary_action = c.gen1_canary_action != null ? c.gen1_canary_action : null;
  out.gen1_canary_delta = c.gen1_canary_delta != null ? c.gen1_canary_delta : null;
  out.gen1_canary_effective = c.gen1_canary_effective === true;
  out.gen1_canary_reason_code = c.gen1_canary_reason_code != null ? c.gen1_canary_reason_code : null;
  out.v361_baseline_stage = c.v361_baseline_stage != null ? c.v361_baseline_stage : null;
  out.v361_baseline_target = c.v361_baseline_target != null ? c.v361_baseline_target : null;
  out.v361_baseline_action = c.v361_baseline_action != null ? c.v361_baseline_action : null;

  // === 硬不变量：生产字段必须与输入逐字段相同 ===
  out.final_target = prodTarget;
  out.final_action = prodAction;
  return out;
}

/** 校验 overlay 结果是否满足 Production No-op 不变量。 */
function verifyProductionNoop(before, after) {
  const diffs = [];
  for (const key of PRODUCTION_FIELDS) {
    const b = before ? before[key] : undefined;
    const a = after ? after[key] : undefined;
    if (String(b == null ? '' : b) !== String(a == null ? '' : a)) diffs.push(`${key}: ${b} → ${a}`);
  }
  return { ok: diffs.length === 0, diffs };
}

module.exports = { applyGen1Overlay, verifyProductionNoop, PRODUCTION_FIELDS };
