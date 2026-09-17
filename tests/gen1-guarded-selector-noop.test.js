'use strict';

/**
 * WP-G1-GE-02：Guarded 选择器 dormant 守卫 + overlay production no-op 回归。
 *
 * 覆盖（章程 §4.3 / §8 护栏 C、E、F）：
 *   1. 任何输入下 authoritative selector 都是 BASELINE（含 effectiveGuarded=true + 传入 guarded 结果）
 *   2. overlay + guarded 审计字段：final_target / final_action **逐字段不变**
 *   3. overlay 的 production no-op 硬还原与运行期断言仍在（静态守卫，"改回去就红"）
 *   4. 审计字段的 dormant 取值正确
 *   5. ml_effective 为派生（单向），运行期不再是硬编码字面量
 *   6. 候选哈希稳定 / 顺序无关 / 输入变化即变化
 *   7. 主链静态守卫：selector 恒 BASELINE、不得采纳、Gen-2 目录零改动
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { applyGen1Overlay, verifyProductionNoop } = require('../src/common/utils/gen1-overlay');
const { evaluateGen1Permission } = require('../src/common/utils/gen1-safety-permission');
const {
  selectGuardedResult, buildGuardedAudit, candidateHash,
  SELECTOR_SOURCE, DECISION_SOURCE, GE_02_BASELINE_AUTHORITATIVE
} = require('../src/common/utils/gen1-guarded-selector');
const { evaluateGuardedSeal, FREEZE_STATUS, EVIDENCE_STATUS } = require('../src/common/utils/gen1-guarded-seal');

const REPO = path.join(__dirname, '..');
const RDE = fs.readFileSync(path.join(REPO, 'cloudfunctions/runDecisionEngine/index.js'), 'utf8');
const OVERLAY_SRC = fs.readFileSync(path.join(REPO, 'src/common/utils/gen1-overlay.js'), 'utf8');

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
const RDE_CODE = stripComments(RDE);

const TO = '2026-09-10';
const baseParams = {
  ml_shadow_observe: true, ml_advisory_enabled: true, ml_fast_path_enabled: true,
  ml_challenger_model_id: 'HVT-A-ET-20260830', gen1_authority: 'GUARDED_EFFECTIVE'
};
const signal = {
  date: TO, ml_model_id: 'HVT-A-ET-20260830', ml_fast: true,
  calibrated_probability: 0.82, rule_gate: 'PERMIT', stage: 'S2', signal_run_id: 'gen1-eod-20260910-abcdef'
};
const decision = {
  code: '513310', final_target: 15, final_action: 'WAIT', decision_date: TO, suggested_position: 15
};
const BIND = {
  source_sha256: 's'.repeat(64), model_sha256: 'm'.repeat(64),
  threshold_version: 'shadow-threshold-v1', contract_version: 'WP-G1-GE-CH-1.0'
};
const SYNTH_SEAL = evaluateGuardedSeal({
  freeze: Object.assign({ status: FREEZE_STATUS.APPROVED }, BIND),
  // WP-G1-GE-02 复审 P0-2：synthetic PASS 必须**显式**证明方向为正。
  evidence: { status: EVIDENCE_STATUS.PASS, evidence_positive: true, independent_events: 30 },
  runtime: BIND
});

function perm(over) {
  return evaluateGen1Permission(Object.assign({
    params: baseParams, signal, baseline: { trend_stage_primary: 'S2', v361_baseline_target: 15 },
    today: TO, thresholdSignalP: 0.65,
    risk: { risk_override: false, risk_flag: 'NORMAL' }, fundamental: { f_state: 'F3' },
    snapshot: { structural_break: false, hard_break: false },
    dataHealth: { status: 'OK' }, domainPermission: { status: 'IN_DOMAIN', permission: 'ALLOW' },
    healthGate: {
      health: 'OK', latched_health: 'OK', gate_status: 'ACTIVE',
      allow_advisory: true, allow_canary: true, allow_gen1_timing: true,
      source: 'GEN1_HEALTH_STATE_LATCH'
    },
    guardedSeal: SYNTH_SEAL
  }, over || {}));
}

/* ---- 1) 选择器：任何输入下都选 BASELINE ---- */
{
  const baseline = { final_target: 15, final_action: 'WAIT', stage: 'S2' };
  const guardedFromShadow = { final_target: 99, final_action: 'BUILD', stage: 'S4' };

  const cases = [
    { label: '仅 baseline', input: { baseline } },
    { label: 'guarded 存在但未授权', input: { baseline, guarded: guardedFromShadow, effectiveGuarded: false } },
    { label: 'guarded 存在且全门成立（★ 仍必须选 baseline）', input: { baseline, guarded: guardedFromShadow, effectiveGuarded: true } },
    { label: 'baseline 为 null', input: { baseline: null, guarded: guardedFromShadow, effectiveGuarded: true } }
  ];
  for (const c of cases) {
    const sel = selectGuardedResult(c.input);
    assert.strictEqual(sel.authoritative_source, SELECTOR_SOURCE.BASELINE, `★ ${c.label}：必须 BASELINE`);
    assert.strictEqual(sel.selected_result, c.input.baseline, `★ ${c.label}：选中结果必须就是 baseline 对象本身`);
    assert.strictEqual(sel.frozen_baseline_only, true);
    assert.strictEqual(GE_02_BASELINE_AUTHORITATIVE, true, 'GE-02 冻结开关必须为 true');
  }
  // guarded 结果只作审计镜像，不被丢弃也不被采用
  const sel = selectGuardedResult({ baseline, guarded: guardedFromShadow, effectiveGuarded: true });
  assert.strictEqual(sel.guarded_available, true);
  assert.strictEqual(sel.guarded_considered, true);
  assert.strictEqual(sel.guarded_result, guardedFromShadow);
  assert.notStrictEqual(sel.selected_result.final_target, guardedFromShadow.final_target,
    '★ guarded 的 target 绝不能成为权威结果');
}

/* ---- 2) overlay + 审计字段：production 字段逐字段不变 ---- */
{
  const before = JSON.stringify(decision);
  for (const over of [
    { guardedSeal: SYNTH_SEAL },                    // 全门成立
    { guardedSeal: null },                          // 无封印
    { params: Object.assign({}, baseParams, { gen1_authority: 'CANARY' }), guardedSeal: SYNTH_SEAL },
    { params: Object.assign({}, baseParams, { gen1_authority: 'ADVISORY' }), guardedSeal: SYNTH_SEAL }
  ]) {
    const p = perm(over);
    const sel = selectGuardedResult({
      baseline: { target: 15, action: 'WAIT', stage: 'S2' },
      guarded: { target: 99, action: 'BUILD', stage: 'S4' },
      effectiveGuarded: p.effective_guarded === true
    });
    const audit = buildGuardedAudit({
      permission: p, signal, code: '513310',
      baseline: { target: 15, action: 'WAIT', stage: 'S2' }, selection: sel
    });
    const out = applyGen1Overlay(decision, p, {}, audit);
    assert.strictEqual(out.final_target, 15, '★ overlay 不得改 final_target');
    assert.strictEqual(out.final_action, 'WAIT', '★ overlay 不得改 final_action');
    assert.strictEqual(out.suggested_position, 15, '★ overlay 不得改 suggested_position');
    assert.strictEqual(verifyProductionNoop(decision, out).ok, true);
    // 权威来源与采纳状态必须是 dormant 值
    assert.strictEqual(out.gen1_guarded_selector_source, 'BASELINE');
    assert.strictEqual(out.gen1_adopted, false, '★ GE-02 不得采纳 Gen-1 候选');
    assert.strictEqual(out.decision_source, DECISION_SOURCE.V361_ONLY);
  }
  assert.strictEqual(JSON.stringify(decision), before, 'overlay 必须是纯函数（不改输入）');
}

/* ---- 3) 恶意污染：guarded 审计对象被投毒也不得改写 production 字段 ---- */
{
  const p = perm({});
  const poisonedAudit = {
    decision_source: 'V361_SAFETY_CORE_WITH_GEN1', gen1_adopted: true,
    final_target: 99, final_action: 'EXIT'
  };
  const out = applyGen1Overlay(decision, p, {}, poisonedAudit);
  assert.strictEqual(out.final_target, 15, '★ 被投毒的审计对象不得改写 final_target');
  assert.strictEqual(out.final_action, 'WAIT');
  assert.strictEqual(verifyProductionNoop(decision, out).ok, true);
  // 注意：审计字段本身如实反映入参（它只是描述），关键是 production 字段不受影响
  assert.strictEqual(out.gen1_adopted, true);
}

/* ---- 4) 审计字段 dormant 取值 ---- */
{
  const p = perm({ guardedSeal: null });   // 生产形态：封印缺失 ⇒ guarded false
  const sel = selectGuardedResult({
    baseline: { target: 15, action: 'WAIT', stage: 'S2' }, guarded: null, effectiveGuarded: false
  });
  const audit = buildGuardedAudit({
    permission: p, signal, code: '513310',
    baseline: { target: 15, action: 'WAIT', stage: 'S2' }, selection: sel
  });
  assert.strictEqual(audit.gen1_run_id, 'gen1-eod-20260910-abcdef', 'run_id 必须取自 signal_run_id');
  assert.strictEqual(audit.gen1_adopted, false);
  assert.strictEqual(audit.gen1_guarded_selector_source, 'BASELINE');
  assert.strictEqual(audit.gen1_guarded_baseline_target, 15);
  assert.strictEqual(audit.gen1_guarded_result_target, null, 'GE-02 不产生 guarded 结果');
  assert.strictEqual(audit.gen1_guarded_delta, null);
  assert.strictEqual(audit.gen1_safety_core_adjust_reason, null);
  assert.ok(typeof audit.gen1_candidate_hash === 'string' && audit.gen1_candidate_hash.length === 64,
    '候选哈希必须是 sha256 十六进制');
  assert.ok(audit.gen1_reject_reason_code, '未采纳必须有原因码');
  const out = applyGen1Overlay(decision, p, {}, audit);
  assert.strictEqual(out.gen1_effective_guarded, false);
  assert.strictEqual(out.gen1_guarded_reason_code, p.guarded.reason_code);
}

/* ---- 5) 候选哈希：稳定 / 顺序无关 / 敏感 ---- */
{
  const a = candidateHash({ code: '513310', date: TO, ml_fast: true, calibrated_probability: 0.82 });
  const b = candidateHash({ calibrated_probability: 0.82, ml_fast: true, date: TO, code: '513310' });
  assert.strictEqual(a, b, '键顺序不得影响哈希');
  assert.notStrictEqual(a, candidateHash({ code: '513310', date: TO, ml_fast: true, calibrated_probability: 0.83 }),
    '输入变化必须改变哈希');
  assert.strictEqual(candidateHash(null), candidateHash({}), '空输入稳定');
  assert.strictEqual(a.length, 64);
}

/* ---- 6) 主链静态守卫（改回去就红） ---- */
{
  // 6.1 overlay 的 production 硬还原仍在（章程 I6）
  assert.ok(/out\.final_target = prodTarget;/.test(OVERLAY_SRC),
    '★ overlay 的 final_target 硬还原不得删除');
  assert.ok(/out\.final_action = prodAction;/.test(OVERLAY_SRC),
    '★ overlay 的 final_action 硬还原不得删除');
  // 6.2 运行期断言仍在
  assert.ok(/verifyProductionNoop/.test(RDE_CODE));
  assert.ok(/Gen-1 overlay violated production No-op/.test(RDE_CODE),
    '★ 生产链必须保留 no-op 违反即抛错的断言');
  // 6.3 主链必须使用 dormant 选择器，且不得采纳
  assert.ok(/selectGuardedResult\(\{/.test(RDE_CODE), '★ 主链必须经显式选择器');
  assert.ok(/guarded: guardedShadowResult,/.test(RDE_CODE),
    '★ GE-03：主链必须把 **shadow 结果对象** 交给显式选择器（设计 Gate §2.1 拓扑 ④）'
    + '；GE-02 的「不得提供 guarded 结果（不重跑）」旧判据已由 GE-03 显式取代**—— GE-03 的授权范围正是做这一次 shadow 重跑**，但「采用」仍被两层断言封死');
  assert.ok(/guardedShadowResult = claimGuardedShadowResult\(/.test(RDE_CODE),
    '★ shadow 结果必须由「认领」产生（⛔ 不得重复计算 / 不得复制 V3）');
  assert.ok(!/guarded:\s*[^,\n]*shadowEligib/i.test(RDE_CODE),
    '★ ⛔ 绝不把 guardedShadowEligible（计算资格）当作 guarded 结果传给选择器（§0.3 禁令 ③）');
  assert.ok(/authoritative_source !== 'BASELINE'/.test(RDE_CODE),
    '★ 主链必须断言 selector 恒 BASELINE');
  assert.ok(/GE-02 不得采纳 Gen-1 候选/.test(RDE), '★ 主链必须断言不得采纳');
  // 6.4 ml_effective 必须是派生（单向），不再是硬编码字面量
  assert.ok(!/ml_effective: false,/.test(RDE_CODE),
    '★ ml_effective 不得再是硬编码 false 字面量（须为单向派生）');
  assert.ok(/ml_effective: guardedEffectiveActive,/.test(RDE_CODE),
    '★ ml_effective 必须派生自 gen1_guarded_effective_active');
  assert.ok(!/guardedEffectiveActive\s*=[^=]*ml_effective/.test(RDE_CODE),
    '★ 严禁反向派生（ml_effective 不得决定 guarded）');
  // 6.5 overlay 只是审计：不得出现「overlay 直接改 production 字段」的新路径
  assert.ok(/gen1_guarded_selector_source/.test(OVERLAY_SRC), 'overlay 必须写入选择器来源审计字段');
  // 6.6 Gen-2 目录零改动（源码级：不得出现 Gen-2 路径被本工作包写入的痕迹）
  assert.ok(!/ml\/gen2/.test(RDE), '★ runDecisionEngine 不得触碰 ml/gen2/**');

  // 6.7 ★ 复审 P1：`gen1_guarded_effective_invocations` 语义 = **真实采纳次数**
  //     （不是资格成立次数）。GE-02 selector 恒 BASELINE ⇒ 结构性恒为 0。
  assert.ok(/const \{ selectGuardedResult, buildGuardedAudit, SELECTOR_SOURCE \}/.test(RDE),
    '★ 主链必须导入 SELECTOR_SOURCE 才能表达「采纳」语义');
  assert.ok(/SELECTOR_SOURCE\.GUARDED[\s\S]{0,60}gen1_adopted === true[\s\S]{0,60}guardedEffectiveInvocations \+= 1;/
    .test(RDE_CODE),
  '★ 采纳计数必须由「selector=GUARDED ∧ gen1_adopted=true」把关（缺一不得计数）');
  assert.ok(!/effective_guarded === true\)\s*\{[^}]*guardedEffectiveInvocations \+= 1;/.test(RDE_CODE),
    '★ 严禁在 effective_guarded=true 分支内计数（那是 eligibility，不是 adoption）');
  // 字段名与落库位置保持不变（冻结契约 §6.2 的口径是「累计真实采纳次数」）
  assert.ok(/gen1_guarded_effective_invocations: guardedEffectiveInvocations,/.test(RDE_CODE),
    '★ 字段名与落库位置不得改动（契约 §6.2）');
}

console.log('gen1 guarded selector noop tests passed');
