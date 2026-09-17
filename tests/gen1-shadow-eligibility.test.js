'use strict';

/**
 * WP-G1-GE-03 G3-01：`guardedShadowEligible` 派生单测 + §0.3 结构禁令静态守卫。
 *
 * 设计 Gate §0.3 的唯一定义（**6 项合取**）：
 *     authority.gen1_authority === 'CANARY'
 *   ∧ guarded.checks.health_allows_guarded
 *   ∧ guarded.checks.data_ok
 *   ∧ guarded.checks.domain_strict_in_domain
 *   ∧ guarded.checks.safety_pass
 *   ∧ guarded.checks.model_candidate
 *
 * 本测试覆盖：
 *   A. 正控（6 项全真 ⇒ eligible）
 *   B. 逐项负例（任一项假 ⇒ not eligible，且原因码指向该项）
 *   C. fail-closed（信封缺失 / 结构不完整 / 非布尔真值 一律不成立）
 *   D. ⛔ 排除项**不得**进入定义（authority_guarded / freeze_seal_approved / evidence_seal_pass）
 *   E. 结构禁令静态守卫（不新增第 9 个 guardedCheck / 不传入 Selector / 不进 evaluator）
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const el = require(path.join(REPO, 'src/common/utils/gen1-shadow-eligibility.js'));
const { evaluateGen1Permission } = require(path.join(REPO, 'src/common/utils/gen1-safety-permission.js'));

const { deriveGuardedShadowEligibility, SHADOW_COMPONENT_KEYS, SHADOW_REASON } = el;

/* ---- 0) 定义形态：恰为 §0.3 的 6 项，且顺序一致 ---- */
assert.deepStrictEqual(SHADOW_COMPONENT_KEYS,
  ['authority_canary', 'health_allows_guarded', 'data_ok',
    'domain_strict_in_domain', 'safety_pass', 'model_candidate'],
  '★ §0.3 的 6 项定义（顺序即判定顺序），⛔ 不得增减');

/* ---- 0b) ⛔ 排除项必须缺席（P3 期间结构性未满足） ---- */
for (const forbidden of ['authority_guarded', 'freeze_seal_approved', 'evidence_seal_pass']) {
  assert.ok(SHADOW_COMPONENT_KEYS.indexOf(forbidden) < 0,
    `★ P3 阶段 ${forbidden} 必须被排除在 guardedShadowEligible 之外`);
}

/** 构造 permission 信封（只含派生所需的两处结构）。 */
function env(over) {
  const o = over || {};
  return {
    authority: Object.assign({ gen1_authority: 'CANARY' }, o.authority || {}),
    guarded: {
      checks: Object.assign({
        health_allows_guarded: true,
        data_ok: true,
        domain_strict_in_domain: true,
        safety_pass: true,
        model_candidate: true
      }, o.checks || {})
    }
  };
}

/* ---- A) 正控 ---- */
{
  const r = deriveGuardedShadowEligibility(env());
  assert.strictEqual(r.eligible, true, '6 项全真 ⇒ eligible');
  assert.strictEqual(r.reason_code, null, 'eligible 时 reason_code 必须为 null');
  assert.deepStrictEqual(Object.keys(r.components).sort(), SHADOW_COMPONENT_KEYS.slice().sort());
  for (const k of SHADOW_COMPONENT_KEYS) assert.strictEqual(r.components[k], true, `${k} 必须为 true`);
}

/* ---- B) 逐项负例（每项都必须单独打红，且原因码指向该项） ---- */
const NEG = [
  { label: 'authority 非 CANARY', over: { authority: { gen1_authority: 'GUARDED_EFFECTIVE' } }, reason: SHADOW_REASON.AUTHORITY_NOT_CANARY },
  { label: 'authority PRODUCTION', over: { authority: { gen1_authority: 'PRODUCTION' } }, reason: SHADOW_REASON.AUTHORITY_NOT_CANARY },
  { label: 'authority ADVISORY', over: { authority: { gen1_authority: 'ADVISORY' } }, reason: SHADOW_REASON.AUTHORITY_NOT_CANARY },
  { label: 'health_allows_guarded=false', over: { checks: { health_allows_guarded: false } }, reason: SHADOW_REASON.HEALTH_NOT_STRICT_OK },
  { label: 'data_ok=false', over: { checks: { data_ok: false } }, reason: SHADOW_REASON.DATA_NOT_OK },
  { label: 'domain_strict_in_domain=false', over: { checks: { domain_strict_in_domain: false } }, reason: SHADOW_REASON.DOMAIN_NOT_STRICT_IN_DOMAIN },
  { label: 'safety_pass=false', over: { checks: { safety_pass: false } }, reason: SHADOW_REASON.SAFETY_NOT_PASS },
  { label: 'model_candidate=false', over: { checks: { model_candidate: false } }, reason: SHADOW_REASON.MODEL_NOT_CANDIDATE }
];
for (const c of NEG) {
  const r = deriveGuardedShadowEligibility(env(c.over));
  assert.strictEqual(r.eligible, false, `负例必须被拒：${c.label}`);
  assert.strictEqual(r.reason_code, c.reason, `原因码必须指向首个不成立项：${c.label}`);
}

/* ---- B2) 组件**缺失**（删键）⇒ 同样 fail-closed ---- */
for (const k of SHADOW_COMPONENT_KEYS.slice(1)) {
  const e = env();
  delete e.guarded.checks[k];
  const r = deriveGuardedShadowEligibility(e);
  assert.strictEqual(r.eligible, false, `缺 ${k} 必须 fail-closed`);
}
{
  const e = env();
  delete e.authority.gen1_authority;
  assert.strictEqual(deriveGuardedShadowEligibility(e).eligible, false, '缺 gen1_authority 必须 fail-closed');
}

/* ---- C) fail-closed：信封缺失 / 结构不完整 ---- */
for (const bad of [null, undefined, {}, { authority: {} }, { guarded: {} }, { guarded: { checks: {} } }, 'x', 42]) {
  const r = deriveGuardedShadowEligibility(bad);
  assert.strictEqual(r.eligible, false, `非法信封必须 fail-closed：${JSON.stringify(bad)}`);
  assert.strictEqual(r.reason_code, SHADOW_REASON.INVALID_PERMISSION,
    `结构不完整的原因码必须是 INVALID_PERMISSION：${JSON.stringify(bad)}`);
}

/* ---- C2) 非布尔「真值」不得被当作成立（严格 === true） ---- */
for (const truthy of [1, 'true', 'OK', {}, []]) {
  const r = deriveGuardedShadowEligibility(env({ checks: { data_ok: truthy } }));
  assert.strictEqual(r.eligible, false, `非布尔真值不得成立：${JSON.stringify(truthy)}`);
}

/* ---- D) 与真实 evaluator 同源：健康/域取**从严**口径 ---- */
{
  // 域 PARTIAL_COVERAGE（permission=CANARY_LIMITED）：effective_canary 从宽允许，但 shadow 必须拒
  const p = evaluateGen1Permission({
    params: { ml_shadow_observe: true, ml_advisory_enabled: true, ml_fast_path_enabled: true, ml_challenger_model_id: 'HVT-A-ET-20260830', gen1_authority: 'CANARY' },
    signal: { date: '2026-09-10', model_id: 'HVT-A-ET-20260830', ml_model_id: 'HVT-A-ET-20260830', ml_fast: true, calibrated_probability: 0.82, rule_gate: 'PERMIT', stage: 'S2' },
    baseline: { trend_stage_primary: 'S2', v361_baseline_target: 15 },
    today: '2026-09-10', thresholdSignalP: 0.65,
    risk: { risk_override: false, risk_flag: 'NORMAL' }, fundamental: { f_state: 'F3' },
    snapshot: { structural_break: false, hard_break: false },
    dataHealth: { status: 'OK' },
    domainPermission: { status: 'PARTIAL_COVERAGE', permission: 'CANARY_LIMITED' },
    healthGate: {
      health: 'OK', latched_health: 'OK', gate_status: 'ACTIVE',
      allow_advisory: true, allow_canary: true, allow_gen1_timing: true,
      source: 'GEN1_HEALTH_STATE_LATCH', economic_health: 'PENDING'
    }
  });
  assert.strictEqual(p.effective_canary, true, '从宽口径下 canary 成立（对照）');
  assert.strictEqual(p.guarded.checks.domain_strict_in_domain, false, '从严口径下 domain 不成立');
  const r = deriveGuardedShadowEligibility(p);
  assert.strictEqual(r.eligible, false, '★ 域 PARTIAL_COVERAGE ⇒ shadow 必须拒（从严口径）');
  assert.strictEqual(r.reason_code, SHADOW_REASON.DOMAIN_NOT_STRICT_IN_DOMAIN);
}
{
  // 健康缺失（healthGate=null）：effective_canary 的 healthAllowsCanary 视为允许，但 shadow 必须拒
  const p = evaluateGen1Permission({
    params: { ml_shadow_observe: true, ml_advisory_enabled: true, ml_fast_path_enabled: true, ml_challenger_model_id: 'HVT-A-ET-20260830', gen1_authority: 'CANARY' },
    signal: { date: '2026-09-10', model_id: 'HVT-A-ET-20260830', ml_model_id: 'HVT-A-ET-20260830', ml_fast: true, calibrated_probability: 0.82, rule_gate: 'PERMIT', stage: 'S2' },
    baseline: { trend_stage_primary: 'S2', v361_baseline_target: 15 },
    today: '2026-09-10', thresholdSignalP: 0.65,
    risk: { risk_override: false, risk_flag: 'NORMAL' }, fundamental: { f_state: 'F3' },
    snapshot: { structural_break: false, hard_break: false },
    dataHealth: { status: 'OK' },
    domainPermission: { status: 'IN_DOMAIN', permission: 'ALLOW' },
    healthGate: null
  });
  const r = deriveGuardedShadowEligibility(p);
  assert.strictEqual(r.eligible, false, '★ 健康 latch 缺失 ⇒ shadow 必须拒（缺字段 fail-closed）');
  assert.strictEqual(r.reason_code, SHADOW_REASON.HEALTH_NOT_STRICT_OK);
}
{
  // 全绿 + CANARY ⇒ 真实信封下 eligible 成立
  const p = evaluateGen1Permission({
    params: { ml_shadow_observe: true, ml_advisory_enabled: true, ml_fast_path_enabled: true, ml_challenger_model_id: 'HVT-A-ET-20260830', gen1_authority: 'CANARY' },
    signal: { date: '2026-09-10', model_id: 'HVT-A-ET-20260830', ml_model_id: 'HVT-A-ET-20260830', ml_fast: true, calibrated_probability: 0.82, rule_gate: 'PERMIT', stage: 'S2' },
    baseline: { trend_stage_primary: 'S2', v361_baseline_target: 15 },
    today: '2026-09-10', thresholdSignalP: 0.65,
    risk: { risk_override: false, risk_flag: 'NORMAL' }, fundamental: { f_state: 'F3' },
    snapshot: { structural_break: false, hard_break: false },
    dataHealth: { status: 'OK' },
    domainPermission: { status: 'IN_DOMAIN', permission: 'ALLOW' },
    healthGate: {
      health: 'OK', latched_health: 'OK', gate_status: 'ACTIVE',
      allow_advisory: true, allow_canary: true, allow_gen1_timing: true,
      source: 'GEN1_HEALTH_STATE_LATCH', economic_health: 'PENDING'
    }
  });
  assert.strictEqual(p.effective_guarded, false, 'P3：effective_guarded 仍必须为 false（采纳资格）');
  assert.strictEqual(deriveGuardedShadowEligibility(p).eligible, true,
    '★ 全绿 + CANARY ⇒ 计算资格成立（但不等于采纳资格）');
}

/* ---- E) §0.3 三条结构禁令：静态源码守卫 ---- */
const RDE = fs.readFileSync(path.join(REPO, 'cloudfunctions/runDecisionEngine/index.js'), 'utf8');
/** ⚠️ 定位源码切片必须先剔除注释：注释里也会出现同名调用，会污染 indexOf 的第一处命中。 */
const RDE_CODE = RDE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const PERM_SRC = fs.readFileSync(path.join(REPO, 'src/common/utils/gen1-safety-permission.js'), 'utf8');
const SEL_SRC = fs.readFileSync(path.join(REPO, 'src/common/utils/gen1-guarded-selector.js'), 'utf8');
const ELI_SRC = fs.readFileSync(path.join(REPO, 'src/common/utils/gen1-shadow-eligibility.js'), 'utf8');

/* 禁令 ①：不新增 gen1-safety-permission.js 的第 9 个 guardedChecks 项 */
{
  const block = PERM_SRC.slice(PERM_SRC.indexOf('const guardedChecks = {'));
  const body = block.slice(block.indexOf('{') + 1, block.indexOf('};'));
  const keys = body.split('\n').map((l) => l.trim()).filter((l) => l && l.indexOf(':') > 0)
    .map((l) => l.slice(0, l.indexOf(':')).trim());
  assert.strictEqual(keys.length, 8, `★ guardedChecks 必须恰为 8 项，实为 ${keys.length}：${keys.join(',')}`);
  assert.deepStrictEqual(keys, ['authority_guarded', 'freeze_seal_approved', 'evidence_seal_pass',
    'health_allows_guarded', 'data_ok', 'domain_strict_in_domain', 'safety_pass', 'model_candidate'],
    '★ guardedChecks 8 项名单不得增减 / 不得改名（章程 §3.3）');
  assert.ok(!/shadow/i.test(body), '★ guardedChecks 内不得出现任何 shadow 项（§0.3 禁令 ①）');
}

/* 禁令 ①b：evaluator 不得 require 本模块（派生只能发生在 runDecisionEngine 调用点） */
assert.ok(!/gen1-shadow-eligibility/.test(PERM_SRC),
  '★ gen1-safety-permission.js 不得引用 gen1-shadow-eligibility（⛔ 派生不进 evaluator）');
assert.ok(!/deriveGuardedShadowEligibility/.test(PERM_SRC), '★ evaluator 不得出现派生调用');

/* 禁令 ②：不是 effective_guarded 的组成项 —— effective_guarded 仍严格等于 8 项 every */
assert.ok(/const effectiveGuarded = Object\.keys\(guardedChecks\)\.every\(\(k\) => guardedChecks\[k\] === true\);/.test(PERM_SRC),
  '★ effective_guarded 必须仍为 guardedChecks 8 项的 every（⛔ 不得掺入 shadow 资格）');

/* 禁令 ③：绝不把 guardedShadowEligible 传给 Guarded Selector */
{
  const call = RDE_CODE.slice(RDE_CODE.indexOf('selectGuardedResult({'));
  const args = call.slice(0, call.indexOf('});'));
  assert.ok(/effectiveGuarded:\s*gen1Permission\.effective_guarded === true/.test(args),
    '★ Selector 的 effectiveGuarded 入参必须仍是**采纳资格** effective_guarded');
  assert.ok(!/shadowEligib/i.test(args), '★ 绝不把 shadow 资格传给 Guarded Selector（§0.3 禁令 ③）');
  assert.ok(!/guardedShadowEligible/.test(SEL_SRC), '★ Selector 模块内不得出现 shadow 资格标识');
  assert.ok(!/gen1-shadow-eligibility/.test(SEL_SRC), '★ Selector 不得引用本模块');
}

/* 禁令 ③b：本模块必须是**纯函数**，且代码中不得实现任何采纳 / 证据语义 */
{
  assert.ok(!/require\(/.test(ELI_SRC), '★ 纯函数模块：不得有任何 require（无 DB / 无循环依赖）');
  const codeLines = ELI_SRC.split('\n')
    .filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l)).join('\n');
  for (const forbidden of ['gen1_adopted', 'gen1_guarded_effective_invocations',
    'independent_event', 'selectGuardedResult', 'decision-v3', 'decision.js',
    'gen1_guarded_shadow_invocations']) {
    assert.ok(codeLines.indexOf(forbidden) < 0,
      `★ 模块**代码**中不得出现 ${forbidden}（仅允许写在禁令注释里）`);
  }
}

/* 接线守卫：runDecisionEngine 已派生，且来源是 permission 信封 */
assert.ok(/deriveGuardedShadowEligibility\(gen1Permission\)/.test(RDE),
  '★ runDecisionEngine 必须由 permission 信封派生 guardedShadowEligible');
assert.ok(/guardedShadowEligibleCount \+= 1/.test(RDE), '★ eligibility 计数必须落地');

/* D12 联动：新持久化字段必须已在 runtime_status schema 登记（登记集合 ⊇ 真实写入集合） */
{
  const { getSchema } = require(path.join(REPO, 'src/common/schema.js'));
  const rs = getSchema('runtime_status');
  assert.ok(rs.fields.gen1_guarded_shadow_eligible_count,
    '★ runtime_status.gen1_guarded_shadow_eligible_count 必须登记（D12 集合相等口径）');
  assert.strictEqual(rs.fields.gen1_guarded_shadow_eligible_count.type, 'number');
}

console.log('gen1 shadow eligibility tests passed（6 项唯一定义 + 逐项负例 + fail-closed + 三条结构禁令）');
