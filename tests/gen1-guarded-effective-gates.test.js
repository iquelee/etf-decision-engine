'use strict';

/**
 * WP-G1-GE-02：`effective_guarded` 准入门单测（章程 §3.3 唯一准入表达式）。
 *
 * 覆盖：
 *   A. 封印 fail-closed 矩阵（missing / PENDING / REVOKED / 绑定不匹配 / 绑定不可验证 /
 *      **Evidence 非 POSITIVE** / 事件不足）
 *   A2. ★ Evidence Seal 三态真值表（PASS/false/30 ⇒ false；PASS/true/29 ⇒ false；
 *      PASS/true/30 ⇒ true）—— 复审 P0-2
 *   B. **生产制品不得 APPROVED / PASS / POSITIVE**（GE-02 dormant 硬守卫）
 *   C. 真实生产环境（CANARY + 生产制品）下 effective_guarded 恒 false
 *   D. 即使有人误改 param_config → GUARDED_EFFECTIVE，生产制品仍使 effective_guarded 为 false
 *      （★ 第二层保证：单靠改配置绝不能激活）
 *   E. synthetic 三钥匙 + 运行时门全开 → true（证明真值逻辑可用，不是恒 false 桩）
 *   F. 逐门负例：任一运行时门不成立 → false 且原因码正确
 *      （含 ★ Health gate_status **缺失** 必须 fail-closed —— 复审 P0-1）
 *   G. CANARY 行为逐字段不变（新增档位/封印不得影响 effective_canary）
 */
const assert = require('assert');
const path = require('path');

const { evaluateGen1Permission } = require('../src/common/utils/gen1-safety-permission');
const {
  evaluateGuardedSeal, readProductionSeals, FREEZE_STATUS, EVIDENCE_STATUS,
  GUARDED_CONTRACT_VERSION, GUARDED_THRESHOLD_VERSION, MIN_INDEPENDENT_EVENTS, ARTIFACT_PATHS
} = require('../src/common/utils/gen1-guarded-seal');

const REPO = path.join(__dirname, '..');
const fs = require('fs');

const TO = '2026-09-10';
const TH = 0.65;
const baseParams = {
  ml_shadow_observe: true, ml_advisory_enabled: true, ml_fast_path_enabled: true,
  ml_challenger_model_id: 'HVT-A-ET-20260830', gen1_authority: 'CANARY'
};
const guardedParams = Object.assign({}, baseParams, { gen1_authority: 'GUARDED_EFFECTIVE' });
const goodSignal = {
  date: TO, ml_model_id: 'HVT-A-ET-20260830', ml_fast: true,
  calibrated_probability: 0.82, rule_gate: 'PERMIT', stage: 'S2', signal_run_id: 'gen1-eod-TEST'
};
const s2Baseline = { trend_stage_primary: 'S2', v361_baseline_target: 15 };
const healthOk = {
  health: 'OK', latched_health: 'OK', gate_status: 'ACTIVE',
  allow_advisory: true, allow_canary: true, allow_gen1_timing: true,
  source: 'GEN1_HEALTH_STATE_LATCH', economic_health: 'PENDING'
};
const dataOk = { status: 'OK' };
const domainIn = { status: 'IN_DOMAIN', permission: 'ALLOW' };

function run(over) {
  return evaluateGen1Permission(Object.assign({
    params: baseParams, signal: goodSignal, baseline: s2Baseline, today: TO, thresholdSignalP: TH,
    risk: { risk_override: false, risk_flag: 'NORMAL' }, fundamental: { f_state: 'F3' },
    snapshot: { structural_break: false, hard_break: false },
    dataHealth: dataOk, domainPermission: domainIn, healthGate: healthOk
  }, over || {}));
}

/** synthetic 全开封印（**只在单测内构造，绝不落生产制品**）。 */
const ALL_BINDINGS = {
  source_sha256: 's'.repeat(64), model_sha256: 'm'.repeat(64),
  threshold_version: GUARDED_THRESHOLD_VERSION, contract_version: GUARDED_CONTRACT_VERSION
};
const SYNTH_SEAL = evaluateGuardedSeal({
  freeze: Object.assign({ status: FREEZE_STATUS.APPROVED }, ALL_BINDINGS),
  // WP-G1-GE-02 复审 P0-2：synthetic PASS **必须显式写** evidence_positive=true，不得省略。
  evidence: {
    status: EVIDENCE_STATUS.PASS, evidence_positive: true,
    independent_events: MIN_INDEPENDENT_EVENTS
  },
  runtime: ALL_BINDINGS
});

/* ================= A. 封印 fail-closed 矩阵 ================= */
{
  const missing = evaluateGuardedSeal({});
  assert.strictEqual(missing.freeze_seal_approved, false, '缺制品 ⇒ 不通过');
  assert.strictEqual(missing.freeze_seal_status, FREEZE_STATUS.MISSING);
  assert.strictEqual(missing.freeze_seal_reason_code, 'FREEZE_SEAL_MISSING');
  assert.strictEqual(missing.evidence_seal_pass, false);
  assert.strictEqual(missing.evidence_seal_reason_code, 'EVIDENCE_SEAL_MISSING');

  const pending = evaluateGuardedSeal({ freeze: { status: 'PENDING' }, evidence: { status: 'PENDING' } });
  assert.strictEqual(pending.freeze_seal_approved, false);
  assert.strictEqual(pending.freeze_seal_reason_code, 'FREEZE_SEAL_NOT_APPROVED:PENDING');
  assert.strictEqual(pending.evidence_seal_pass, false);
  assert.strictEqual(pending.evidence_seal_reason_code, 'EVIDENCE_SEAL_NOT_PASS:PENDING');

  for (const st of ['REVOKED', 'PENDING', 'BOGUS', '']) {
    const r = evaluateGuardedSeal({
      freeze: { status: st },
      evidence: { status: 'PASS', evidence_positive: true, independent_events: 99 }
    });
    assert.strictEqual(r.freeze_seal_approved, false, `Freeze 状态 ${st} 必须不通过`);
    assert.strictEqual(r.evidence_seal_pass, true, 'Evidence 独立成立时不应被 Freeze 影响（便于归因）');
  }

  // APPROVED 但绑定不匹配
  const mismatch = evaluateGuardedSeal({
    freeze: Object.assign({ status: FREEZE_STATUS.APPROVED }, ALL_BINDINGS, { model_sha256: 'tampered' }),
    evidence: { status: 'PASS', evidence_positive: true, independent_events: 30 },
    runtime: ALL_BINDINGS
  });
  assert.strictEqual(mismatch.freeze_seal_approved, false, '★ 绑定不匹配必须不通过');
  assert.strictEqual(mismatch.freeze_seal_reason_code, 'FREEZE_SEAL_BINDING_MISMATCH');
  assert.deepStrictEqual(mismatch.freeze_binding_mismatched, ['model_sha256']);

  // APPROVED 但运行期无法观测某项 ⇒ 不通过（绝不「假设通过」）
  const unverifiable = evaluateGuardedSeal({
    freeze: Object.assign({ status: FREEZE_STATUS.APPROVED }, ALL_BINDINGS),
    evidence: { status: 'PASS', evidence_positive: true, independent_events: 30 },
    runtime: { contract_version: GUARDED_CONTRACT_VERSION }
  });
  assert.strictEqual(unverifiable.freeze_seal_approved, false,
    '★ 运行期无观测源时必须 UNVERIFIABLE 而非默认通过');
  assert.strictEqual(unverifiable.freeze_seal_reason_code, 'FREEZE_SEAL_BINDING_UNVERIFIABLE');

  // Evidence PASS 但事件不足
  const fewEvents = evaluateGuardedSeal({
    freeze: Object.assign({ status: FREEZE_STATUS.APPROVED }, ALL_BINDINGS),
    evidence: { status: 'PASS', evidence_positive: true, independent_events: MIN_INDEPENDENT_EVENTS - 1 },
    runtime: ALL_BINDINGS
  });
  assert.strictEqual(fewEvents.evidence_seal_pass, false, '★ 独立事件 < 30 不得 PASS');
  assert.strictEqual(fewEvents.evidence_seal_reason_code, 'EVIDENCE_SEAL_INSUFFICIENT_EVENTS');

  // 全开 → 通过（真值逻辑不是恒 false 桩）
  assert.strictEqual(SYNTH_SEAL.freeze_seal_approved, true);
  assert.strictEqual(SYNTH_SEAL.evidence_seal_pass, true);
  assert.strictEqual(SYNTH_SEAL.freeze_seal_reason_code, null);
  assert.strictEqual(SYNTH_SEAL.evidence_seal_reason_code, null);
}

/* ============ A2. ★ Evidence Seal 三态真值表（复审 P0-2） ============
 * 冻结契约：证据门 = `status==PASS` **且 `evidence_positive==true`** 且 `independent_events>=30`。
 * 只盖章不证明方向（PASS + positive=false）必须 fail-closed。 */
{
  const freezeOk = Object.assign({ status: FREEZE_STATUS.APPROVED }, ALL_BINDINGS);

  // ① PASS + positive=false + 30 ⇒ **FAIL**（自相矛盾的封印必须拒绝）
  const contradictory = evaluateGuardedSeal({
    freeze: freezeOk,
    evidence: { status: 'PASS', evidence_positive: false, independent_events: 30 },
    runtime: ALL_BINDINGS
  });
  assert.strictEqual(contradictory.evidence_seal_pass, false,
    '★ status=PASS 但 evidence_positive=false 必须 fail-closed');
  assert.strictEqual(contradictory.evidence_seal_reason_code, 'EVIDENCE_SEAL_NOT_POSITIVE');
  assert.strictEqual(contradictory.evidence_positive, false);

  // 省略 evidence_positive 字段 ≡ 未证明 ⇒ 同样拒绝（不得「缺省即真」）
  const omitted = evaluateGuardedSeal({
    freeze: freezeOk,
    evidence: { status: 'PASS', independent_events: 30 },
    runtime: ALL_BINDINGS
  });
  assert.strictEqual(omitted.evidence_seal_pass, false, '★ 缺 evidence_positive 字段不得通过');
  assert.strictEqual(omitted.evidence_seal_reason_code, 'EVIDENCE_SEAL_NOT_POSITIVE');

  // 非布尔真值（字符串/数字）不得被当成 true
  for (const v of ['true', 1, 'YES']) {
    const r = evaluateGuardedSeal({
      freeze: freezeOk,
      evidence: { status: 'PASS', evidence_positive: v, independent_events: 30 },
      runtime: ALL_BINDINGS
    });
    assert.strictEqual(r.evidence_seal_pass, false, `evidence_positive=${JSON.stringify(v)} 不得视为 true`);
  }

  // ② PASS + positive=true + 29 ⇒ **FAIL**（事件数硬前置）
  const short = evaluateGuardedSeal({
    freeze: freezeOk,
    evidence: { status: 'PASS', evidence_positive: true, independent_events: MIN_INDEPENDENT_EVENTS - 1 },
    runtime: ALL_BINDINGS
  });
  assert.strictEqual(short.evidence_seal_pass, false);
  assert.strictEqual(short.evidence_seal_reason_code, 'EVIDENCE_SEAL_INSUFFICIENT_EVENTS');

  // ③ PASS + positive=true + 30 ⇒ **PASS**
  const full = evaluateGuardedSeal({
    freeze: freezeOk,
    evidence: { status: 'PASS', evidence_positive: true, independent_events: MIN_INDEPENDENT_EVENTS },
    runtime: ALL_BINDINGS
  });
  assert.strictEqual(full.evidence_seal_pass, true, '★ 三项同时成立才可通过');
  assert.strictEqual(full.evidence_seal_reason_code, null);
  assert.strictEqual(full.evidence_positive, true);

  // 判定顺序：非 PASS 优先于非 POSITIVE（原因码必须指向「状态」而非「方向」）
  const notPass = evaluateGuardedSeal({
    freeze: freezeOk,
    evidence: { status: 'PENDING', evidence_positive: false, independent_events: 0 },
    runtime: ALL_BINDINGS
  });
  assert.strictEqual(notPass.evidence_seal_reason_code, 'EVIDENCE_SEAL_NOT_PASS:PENDING');
}

/* ========== B. ★ 生产制品不得 APPROVED / PASS（GE-02 dormant 守卫） ==========
 * ⚠️ WP-G1-GE-04 真晋升时必须显式改写本段（等同显式审批动作），不得静默删除。 */
{
  const freezeArtifact = JSON.parse(fs.readFileSync(path.join(REPO, ARTIFACT_PATHS.freeze), 'utf8'));
  const evidenceArtifact = JSON.parse(fs.readFileSync(path.join(REPO, ARTIFACT_PATHS.evidence), 'utf8'));
  assert.notStrictEqual(freezeArtifact.status, 'APPROVED',
    '★ GE-02 阶段生产 Freeze 制品**不得**为 APPROVED');
  assert.strictEqual(freezeArtifact.status, 'PENDING');
  assert.strictEqual(freezeArtifact.contract_version, GUARDED_CONTRACT_VERSION);
  assert.notStrictEqual(evidenceArtifact.status, 'PASS',
    '★ GE-02 阶段生产 Evidence 制品**不得**为 PASS');
  assert.strictEqual(evidenceArtifact.status, 'PENDING');
  assert.notStrictEqual(evidenceArtifact.evidence_positive, true,
    '★ GE-02 阶段生产 Evidence 制品**不得**为 evidence_positive=true（复审 P0-2）');
  assert.strictEqual(evidenceArtifact.evidence_positive, false);
  assert.strictEqual(evidenceArtifact.independent_events, 0, '证据样本仍为 0');
  assert.strictEqual(evidenceArtifact.min_independent_events, MIN_INDEPENDENT_EVENTS);
}

/* ========== C. 真实生产环境：effective_guarded 恒 false ========== */
const prodSeals = readProductionSeals({
  contract_version: GUARDED_CONTRACT_VERSION, threshold_version: GUARDED_THRESHOLD_VERSION
});
{
  assert.strictEqual(prodSeals.freeze_seal_approved, false, '生产封印必须不通过');
  assert.strictEqual(prodSeals.evidence_seal_pass, false, '生产证据门必须不通过');
  const r = run({ guardedSeal: prodSeals });
  assert.strictEqual(r.effective_guarded, false, '★ 线上现状（CANARY）下 effective_guarded 恒 false');
  assert.strictEqual(r.guarded.reason_code, 'GUARDED_AUTHORITY_NOT_EFFECTIVE');
  // 无封印参数时同样 false（fail-closed 默认）
  assert.strictEqual(run({}).effective_guarded, false, '未注入封印 ⇒ false');
}

/* ========== D. ★ 单靠改 param_config 绝不能激活（第二层保证） ========== */
{
  const r = run({ params: guardedParams, guardedSeal: prodSeals });
  assert.strictEqual(r.authority.gen1_authority, 'GUARDED_EFFECTIVE', 'Key 1 已（被误）打开');
  assert.strictEqual(r.effective_guarded, false,
    '★ 即使 gen1_authority=GUARDED_EFFECTIVE，生产封印未通过 ⇒ 仍为 false');
  assert.strictEqual(r.guarded.checks.authority_guarded, true);
  assert.strictEqual(r.guarded.checks.freeze_seal_approved, false);
  assert.strictEqual(r.guarded.reason_code, 'GUARDED_FREEZE_SEAL_NOT_APPROVED');
  assert.strictEqual(r.authority.production_write, false);
  assert.strictEqual(r.authority.auto_execution, false);
}

/* ========== E. synthetic 三钥匙 + 运行时门全开 → true ========== */
{
  const r = run({ params: guardedParams, guardedSeal: SYNTH_SEAL });
  assert.strictEqual(r.effective_guarded, true, '全部门成立时必须为 true（否则就是恒 false 桩）');
  assert.strictEqual(r.guarded.reason_code, null);
  assert.deepStrictEqual(r.guarded.checks, {
    authority_guarded: true, freeze_seal_approved: true, evidence_seal_pass: true,
    health_allows_guarded: true, data_ok: true, domain_strict_in_domain: true,
    safety_pass: true, model_candidate: true
  });
  // 即使 effective_guarded 成立，仍无生产写权限（★ 语义边界）
  assert.strictEqual(r.authority.production_write, false);
  assert.strictEqual(r.authority.auto_execution, false);
}

/* ========== F. 逐门负例 ========== */
const synthBase = { params: guardedParams, guardedSeal: SYNTH_SEAL };
{
  // Health：缺失 / 非 OK / gate 非 ACTIVE
  assert.strictEqual(run(Object.assign({}, synthBase, { healthGate: null })).guarded.reason_code,
    'GUARDED_HEALTH_NOT_ALLOWED', '★ 无持久化 latch ⇒ 不视为允许');
  assert.strictEqual(run(Object.assign({}, synthBase, {
    healthGate: Object.assign({}, healthOk, { health: 'DEGRADED', latched_health: 'DEGRADED' })
  })).guarded.reason_code, 'GUARDED_HEALTH_NOT_ALLOWED');
  assert.strictEqual(run(Object.assign({}, synthBase, {
    healthGate: Object.assign({}, healthOk, { gate_status: 'PENDING' })
  })).guarded.reason_code, 'GUARDED_HEALTH_NOT_ALLOWED');

  // ★ 复审 P0-1：health=OK 但 gate_status **缺失/空串/null** 一律 fail-closed。
  // 这是本修复的核心反例 —— 缺字段**不得**被默认成 ACTIVE。
  for (const missing of [undefined, null, '']) {
    const hg = Object.assign({}, healthOk);
    if (missing === undefined) delete hg.gate_status; else hg.gate_status = missing;
    const r = run(Object.assign({}, synthBase, { healthGate: hg }));
    assert.strictEqual(r.guarded.checks.health_allows_guarded, false,
      `★ gate_status=${JSON.stringify(missing)} 缺失时必须 health_allows_guarded=false`);
    assert.strictEqual(r.effective_guarded, false,
      `★ gate_status=${JSON.stringify(missing)} 缺失时必须 effective_guarded=false`);
    assert.strictEqual(r.guarded.reason_code, 'GUARDED_HEALTH_NOT_ALLOWED');
  }
  // 对照：显式 ACTIVE 时该门成立（证明上面的反例不是因为「Health 恒 false」）
  assert.strictEqual(run(Object.assign({}, synthBase, {
    healthGate: Object.assign({}, healthOk, { gate_status: 'ACTIVE' })
  })).guarded.checks.health_allows_guarded, true);
  // 小写/带空格仍应被接受（词表归一化），但**空值不在此列**
  assert.strictEqual(run(Object.assign({}, synthBase, {
    healthGate: Object.assign({}, healthOk, { gate_status: 'active' })
  })).guarded.checks.health_allows_guarded, true);

  // Data：DEGRADED / BLOCKED / UNKNOWN 全拒
  for (const st of ['DEGRADED', 'BLOCKED', 'UNKNOWN', 'DATA_DEGRADED']) {
    assert.strictEqual(run(Object.assign({}, synthBase, { dataHealth: { status: st } })).guarded.reason_code,
      'GUARDED_DATA_NOT_OK', `data=${st} 必须拒绝`);
  }

  // Domain：严格 IN_DOMAIN（PARTIAL_COVERAGE 在 guarded 下必须拒绝）
  const partial = run(Object.assign({}, synthBase, {
    domainPermission: { status: 'PARTIAL_COVERAGE', permission: 'CANARY_LIMITED' }
  }));
  assert.strictEqual(partial.effective_guarded, false, '★ PARTIAL_COVERAGE 在 guarded 下必须拒绝');
  assert.strictEqual(partial.guarded.reason_code, 'GUARDED_DOMAIN_NOT_IN_DOMAIN');
  assert.strictEqual(partial.effective_canary, true, '★ 但 canary 语义不得被收紧（仍是允许）');
  const ood = run(Object.assign({}, synthBase, {
    domainPermission: { status: 'OUT_OF_DOMAIN', permission: 'BLOCK_CANARY' }
  }));
  assert.strictEqual(ood.guarded.reason_code, 'GUARDED_DOMAIN_NOT_IN_DOMAIN');
  assert.strictEqual(ood.effective_canary, false);

  // Safety：RED / F5 / 结构破坏 ⇒ BLOCK
  for (const over of [
    { risk: { risk_override: true, risk_flag: 'NORMAL' } },
    { risk: { risk_override: false, risk_flag: 'RED' } },
    { fundamental: { f_state: 'F5' } },
    { snapshot: { structural_break: true, hard_break: false } },
    { baseline: { trend_stage_primary: 'S5', v361_baseline_target: 75 } }
  ]) {
    assert.strictEqual(run(Object.assign({}, synthBase, over)).guarded.reason_code,
      'GUARDED_SAFETY_NOT_PASS', `${JSON.stringify(over)} 必须报 Safety 否决`);
  }

  // 不可用（信号缺失 / 过期 / model_id 不符）：与 Safety BLOCK 分开报
  assert.strictEqual(run(Object.assign({}, synthBase, { signal: null })).guarded.reason_code,
    'GUARDED_SIGNAL_UNAVAILABLE');
  assert.strictEqual(run(Object.assign({}, synthBase, {
    signal: Object.assign({}, goodSignal, { date: '2026-09-09' })
  })).guarded.reason_code, 'GUARDED_SIGNAL_UNAVAILABLE');
  assert.strictEqual(run(Object.assign({}, synthBase, {
    signal: Object.assign({}, goodSignal, { ml_model_id: 'HVT-A-ET-99999999' })
  })).guarded.reason_code, 'GUARDED_SIGNAL_UNAVAILABLE');

  // Candidate：P<阈值 / ml_fast=false / 非 S2
  assert.strictEqual(run(Object.assign({}, synthBase, {
    signal: Object.assign({}, goodSignal, { ml_fast: false, calibrated_probability: 0.64 })
  })).guarded.reason_code, 'GUARDED_MODEL_CANDIDATE_NOT_PASS');
  assert.strictEqual(run(Object.assign({}, synthBase, {
    signal: Object.assign({}, goodSignal, { stage: 'S3' }),
    baseline: { trend_stage_primary: 'S3', v361_baseline_target: 20 }
  })).guarded.reason_code, 'GUARDED_MODEL_CANDIDATE_NOT_PASS');

  // Authority：CANARY 不足以 guarded
  assert.strictEqual(run({ params: baseParams, guardedSeal: SYNTH_SEAL }).guarded.reason_code,
    'GUARDED_AUTHORITY_NOT_EFFECTIVE');
}

/* ========== G. CANARY 行为不得被本轮改动（逐字段） ========== */
{
  const a = run({ guardedSeal: null });
  const b = run({ guardedSeal: prodSeals });
  for (const k of ['effective_advisory', 'effective_canary']) {
    assert.strictEqual(a[k], b[k], `${k} 不得因注入封印而变化`);
  }
  assert.strictEqual(a.effective_canary, true);
  assert.strictEqual(a.effective_advisory, true);
  // 既有 canary 的宽松域/健康语义保持原样
  assert.strictEqual(run({ guardedSeal: null, dataHealth: { status: 'DEGRADED' } }).effective_canary, false);
  assert.strictEqual(run({ guardedSeal: null, dataHealth: { status: 'DEGRADED' } }).effective_advisory, true);
  // PRODUCTION 请求被降级 ⇒ canary/guarded 均 false
  const prod = run({ params: Object.assign({}, baseParams, { gen1_authority: 'PRODUCTION' }), guardedSeal: SYNTH_SEAL });
  assert.strictEqual(prod.effective_canary, false);
  assert.strictEqual(prod.effective_guarded, false);
}

console.log('gen1 guarded effective gates tests passed');
