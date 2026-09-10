'use strict';

/**
 * WP-G1.3 G1.3-01/06/07：反事实组合账本静态守卫（复审最终 P0）。
 *
 * 复审问题：账本推进被 `gen1_canary_effective === true` 门控 →
 * 「baseline 自身加仓但无 Gen-1」的科技 ETF 漏记，后续 Candidate 拿到虚假剩余额度。
 *
 * 这些断言把修复变成「改回去就红」的回归门（单测无法覆盖 runDecisionEngine 的 DB 接线，
 * 故对源码做确定性断言）。
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const RDE = fs.readFileSync(path.join(REPO, 'cloudfunctions/runDecisionEngine/index.js'), 'utf8');
const CANARY = fs.readFileSync(path.join(REPO, 'src/common/utils/gen1-canary.js'), 'utf8');

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
const CODE = stripComments(RDE);
const CANARY_CODE = stripComments(CANARY);

/* ---- 1) ★ 核心：账本必须无条件推进（不得被 canary_effective 门控） ---- */
{
  assert.ok(/canarySectorUsed = cfStep\.nextSectorUsed;/.test(CODE),
    '★ 账本必须直接采用 stepCounterfactualLedger 的 nextSectorUsed');
  assert.ok(!/if \(isTechEtf && canary\.gen1_canary_effective === true\)/.test(CODE),
    '★ 禁止再用 gen1_canary_effective 门控账本推进（这正是被修的 P0）');
  assert.ok(!/if \(isTechEtf\) \{\s*if \(canary\.gen1_canary_effective/.test(CODE));
  // 门控只能用于「计数/上报」，不能用于「是否入账」
  assert.ok(/if \(canary\.gen1_canary_effective === true\) canaryInvocationCount \+= 1;/.test(CODE),
    'canary_effective 只允许用于 invocation 计数');
}

/* ---- 2) 非 Candidate 必须按 baseline 推进 ---- */
{
  assert.ok(/baselineSuggested: result\.suggested_position/.test(CODE),
    '★ 非 Candidate 必须把 V3.6.1 baseline 建议执行仓交给账本');
  assert.ok(/baselineTarget,/.test(CODE), '★ 必须传入 baselineTarget 供非 Candidate 分支使用');
  assert.ok(/canaryEffective: canary\.gen1_canary_effective === true/.test(CODE));
  assert.ok(/canaryTarget: canary\.gen1_canary_target/.test(CODE));
  assert.ok(/canarySuggested: canarySuggestedPosition/.test(CODE));
  assert.ok(/sectorRemainingLimit: canarySectorRemaining/.test(CODE),
    '必须复用同一个 limit（保证与 S4 rerun 同值）');
}

/* ---- 3) 唯一实现：canary 模块内部只允许一套 limit / 占用逻辑 ---- */
{
  assert.ok(/function counterfactualSectorRemaining\(/.test(CANARY_CODE));
  assert.ok(/function stepCounterfactualLedger\(/.test(CANARY_CODE));
  assert.ok(/effectiveOccupation = isTech \? occupation : 0;/.test(CANARY_CODE),
    '非科技不得推进科技账本');
  assert.ok(!/Math\.max\(base, sectorRemainingLimit\)/.test(CANARY_CODE),
    '★ 「不得低于 baseline」的地板必须移除（共享 cap 优先）');
  assert.ok(!/clampCanaryCandidate/.test(CANARY_CODE),
    '旧的多套 clamp 函数应已删除，避免第二套语义复活');
  assert.ok(/baselineFloorBreached/.test(CANARY_CODE), '必须显式上报「被 cap 压到 baseline 之下」');
}

/* ---- 4) 终局断言：账本 <= max(seed, cap) ---- */
{
  assert.ok(/const counterfactualLedgerOk = counterfactualTechPosition\s*\n?\s*<= Math\.max\(techPositionSeed, effectiveTechMax\)/.test(CODE),
    '★ 必须有终局断言 counterfactualTechPosition <= max(seed, cap)');
  assert.ok(/GEN1_COUNTERFACTUAL_LEDGER_OVERFLOW/.test(CODE), '越界必须产生 SECURITY 审计记录');
  assert.ok(/gen1_counterfactual_intended_tech_position: counterfactualTechPosition/.test(CODE),
    '★ G1.3-11：必须提供精确名称 intended（账本是 execution/intended ledger）');
  assert.ok(/gen1_counterfactual_tech_position: counterfactualTechPosition/.test(CODE),
    '旧名保留为等价别名（向后兼容）');
  assert.ok(/gen1_production_tech_position: productionTechPosition/.test(CODE));
  assert.ok(/gen1_counterfactual_ledger_ok: counterfactualLedgerOk/.test(CODE));
  // G1.3-11：Σ 战略目标只作信息性上报，且注明不受 cap 约束
  assert.ok(/gen1_counterfactual_target_sum: Math\.round\(counterfactualTargetSum/.test(CODE));
  // 注释类断言要用**原文**（CODE 已剥离注释）
  assert.ok(/不受.{0,8}cap 约束/.test(RDE),
    '★ Σ 战略目标必须显式标注「不受 cap 约束」，避免被误当成不变量');
  assert.ok(/不得用作 cap 合规证据/.test(RDE),
    '★ 必须写明 Σ 目标不得作为 cap 合规证据');
  assert.ok(/gen1_counterfactual_suggested_position/.test(CODE),
    '必须上报每只的反事实建议执行仓（Economic Health 聚合要用 suggested 而非 target）');
}

/* ---- 5) P1：mlMeta 不再用含混 boolean，改为显式 counterfactual_canary_* ---- */
{
  assert.ok(!/canary_enabled: false/.test(CODE), '★ canary_enabled 硬编码必须移除');
  assert.ok(/counterfactual_canary_authorized: cfAuthorized/.test(CODE));
  assert.ok(/counterfactual_canary_health_allowed: cfHealthAllowed/.test(CODE));
  assert.ok(/counterfactual_canary_active: cfActive/.test(CODE));
  assert.ok(/counterfactual_canary_invocations: canaryInvocationCount/.test(CODE));
  assert.ok(/production_fast_path_enabled: false/.test(CODE));
  assert.ok(/const cfAuthorized = authorityAllows\(gen1Authority\.gen1_authority, 'CANARY_OVERRIDE'\)/.test(CODE));
  assert.ok(/const cfHealthAllowed = gen1GlobalGate\.allow_canary === true/.test(CODE));
  assert.ok(/const cfActive = cfAuthorized && cfHealthAllowed && counterfactualLedgerOk/.test(CODE),
    'ledger 越界时不得把反事实标为 active（fail-closed）');
  // 同一组字段也要进 runtime_status（单一真相）
  assert.ok(/gen1_counterfactual_canary_active: cfActive/.test(CODE));
  assert.ok(/gen1_counterfactual_canary_authorized: cfAuthorized/.test(CODE));
}

/* ---- 6) Safety / 生产边界不得被本轮改动触碰 ---- */
{
  assert.ok(/out\.final_target = prodTarget;/.test(
    fs.readFileSync(path.join(REPO, 'src/common/utils/gen1-overlay.js'), 'utf8')));
  assert.ok(/production_write: false/.test(CODE));
  assert.ok(/auto_execution: false/.test(CODE));
}

console.log('gen1 counterfactual ledger static guards passed');
