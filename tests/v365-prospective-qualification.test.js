'use strict';

/**
 * V3.6.5 —— PROSPECTIVE PRODUCTION QUALIFICATION · 守卫测试
 *
 * 依据：`docs/V365_PROSPECTIVE_PRODUCTION_QUALIFICATION.md`（owner 裁定阶段设计）
 *
 * 本测试把该设计的**关键不变量**机器化，防止后续无人值守改动把前瞻轨演化为：
 *   ① 复用旧 anchor；② 初始即 qualification_authoritative=true；
 *   ③ 用 synthetic / suggested_position 充当 actual；④ 静默豁免历史 6 个 UNEXPECTED；
 *   ⑤ 把 controlled activation 误当作 general production；⑥ 未授权即放行；
 *   ⑦ 部分通过 Acceptance 即升格 RUN_HISTORY_INDEX。
 *
 * ⛔ 纯本地 · 不连生产 · 不写文件 · 不执行任何 DB 命令。
 */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const G = require(path.join(REPO, 'scripts/lib/v365-prospective-gate.js'));
const { V365_COLLECTIONS } = require(path.join(REPO, 'src/common/utils/v365-contracts.js'));

/* ---------------- P-01 协议登记合法性 ---------------- */
{
  const ok = G.validateProspectiveProtocol({
    protocol_version: 'RFP-V2-PH-PROSPECTIVE',
    replay_semantics: 'PRODUCTION_HISTORICAL_PROSPECTIVE',
    qualification_authoritative: false,
    anchor: null
  });
  assert.strictEqual(ok.ok, true, 'P-01：合法初始登记必须通过');
  assert.strictEqual(G.PROTOCOL.protocol_version, 'RFP-V2-PH-PROSPECTIVE');
  assert.strictEqual(G.PROTOCOL.replay_semantics, 'PRODUCTION_HISTORICAL_PROSPECTIVE');
}

/* ---------------- P-02 ⛔ 不得复用旧 anchor ---------------- */
{
  const legacy = [
    '25ccbfc7e1b73a9a173ec36c17512c6228a2fe42685dcd291bc055ea4ed11723',
    'b87654ab81935731a4173b5f566231f6db62c3d2e2b43f74cd6c8fb93ea78832',
    '0db3193b297d2900aa1b32e359bbe80b80bfbf7a5b10ce0bba17a32f41dbe4f5',
    '5c8fb4ae7223abdc4edb9ba8267c2043d4dd22d6688e000415e1a4f1339b661d'
  ];
  for (const a of legacy) {
    const r = G.validateProspectiveProtocol({
      protocol_version: 'RFP-V2-PH-PROSPECTIVE',
      replay_semantics: 'PRODUCTION_HISTORICAL_PROSPECTIVE',
      qualification_authoritative: false,
      anchor: a
    });
    assert.strictEqual(r.ok, false, `P-02：⛔ 复用旧 anchor ${a.slice(0, 8)}… 必须 FAIL`);
  }
  assert.strictEqual(G.FORBIDDEN_ANCHORS.length, 4, 'P-02：必须登记 4 个禁用旧 anchor');
  // 独立新 anchor 必须被接受
  const okNew = G.validateProspectiveProtocol({
    protocol_version: 'RFP-V2-PH-PROSPECTIVE',
    replay_semantics: 'PRODUCTION_HISTORICAL_PROSPECTIVE',
    qualification_authoritative: false,
    anchor: 'f'.repeat(64)
  });
  assert.strictEqual(okNew.ok, true, 'P-02：独立 anchor 必须被接受');
}

/* ---------------- P-03 ⛔ 初始不得 authoritative ---------------- */
{
  const r = G.validateProspectiveProtocol({
    protocol_version: 'RFP-V2-PH-PROSPECTIVE',
    replay_semantics: 'PRODUCTION_HISTORICAL_PROSPECTIVE',
    qualification_authoritative: true,   // ⛔ 违规
    anchor: null
  });
  assert.strictEqual(r.ok, false, 'P-03：⛔ 初始 qualification_authoritative=true 必须 FAIL');
  assert.ok(r.errors.some((e) => /qualification_authoritative/.test(e)));
}

/* ---------------- P-04 完整门禁事实 → fail-closed（部署身份未验证） ---------------- */
{
  // ★ C-021 §10/§11：G-01~G-25 全绿（含 owner_run_authorization）
  //   但 `deployment_identity_verified = false`（部署前**必须** false）
  //   ⇒ 唯一可能状态为 BLOCKED_ON_DEPLOYMENT_IDENTITY，⛔ 不得放行。
  const allGreenExceptIdentity = {
    hd10_complete: true,
    production_schema_exact_match: true,
    stage_a_pass: true,
    stage_a_to_g_pass: true,
    qualification_gate_pass: true,
    reader_migration_pass: true,
    immutable_pass: true,
    gen1_pass: true,
    gen2_pass: true,
    p12_parity_delta_zero: true,
    protected_domain_clean: true,
    rpg_f2_historical_registered: true,
    rpg_f3_historical_registered: true,
    rpg_f3_historical_unexpected_decision_delta: 6,
    rpg_f3_historical_waived: false,
    run_history_infra_ready: true,
    switch_date_null_before_first: true,
    // ★ C-020 G-17~G-20
    actual_book_authority_frozen: true,
    two_layer_anchor_registered: true,
    cas_history_recovery_registered: true,
    od_p_1_approved_no_auto_lower: true,
    // ★ C-021 G-16 改名：owner **run** 授权
    owner_run_authorization: true,
    // ★ C-021 G-21~G-25 部署身份链
    candidate_source_frozen: true,
    deployment_scope_exact: true,
    rollback_artifact_verified: true,
    production_baseline_verified: true,
    deployment_identity_verified: false      // ⛔ 部署前必须为 false
  };
  const g = G.evaluateControlledActivationGate(allGreenExceptIdentity);
  assert.strictEqual(g.gate_status, 'BLOCKED_ON_DEPLOYMENT_IDENTITY',
    'P-04：⛔ 部署身份未验证 ⇒ 必须 BLOCKED_ON_DEPLOYMENT_IDENTITY（即使 owner 已给运行授权）');
  assert.strictEqual(g.may_activate, false, 'P-04：⛔ 部署身份未验证时 may_activate 必须 false');
  assert.strictEqual(g.ready_for_v365_first_controlled_run, 'BLOCKED_ON_DEPLOYMENT_IDENTITY',
    'P-04：⛔ 首次受控运行必须同为 BLOCKED_ON_DEPLOYMENT_IDENTITY');
  assert.deepStrictEqual(g.failed_items, ['G-25'], 'P-04：唯一未满足项必须是 G-25');
  assert.strictEqual(g.deployment_identity_verified, false);
  assert.strictEqual(g.owner_run_authorization, true, 'P-04：owner 运行授权已给（但不足以放行）');
}

/* ---------------- P-05 ★ §11 owner 运行授权**不**足以放行（旧语义已废除） ---------------- */
{
  const base = {
    hd10_complete: true, production_schema_exact_match: true,
    stage_a_pass: true, stage_a_to_g_pass: true,
    qualification_gate_pass: true, reader_migration_pass: true,
    immutable_pass: true, gen1_pass: true, gen2_pass: true,
    p12_parity_delta_zero: true, protected_domain_clean: true,
    rpg_f2_historical_registered: true, rpg_f3_historical_registered: true,
    rpg_f3_historical_unexpected_decision_delta: 6, rpg_f3_historical_waived: false,
    run_history_infra_ready: true, switch_date_null_before_first: true,
    actual_book_authority_frozen: true, two_layer_anchor_registered: true,
    cas_history_recovery_registered: true, od_p_1_approved_no_auto_lower: true,
    candidate_source_frozen: true, deployment_scope_exact: true,
    rollback_artifact_verified: true, production_baseline_verified: true,
    owner_run_authorization: true, deployment_identity_verified: false
  };

  // ① ⛔ 旧语义已废除：owner_run_authorization = true 且 deployment_identity_verified = false
  //    ⇒ may_activate **必须** 为 false
  const g1 = G.evaluateControlledActivationGate(base);
  assert.strictEqual(g1.may_activate, false,
    'P-05：⛔ owner_run_authorization=true 不再等价于 GRANTED（旧语义 `owner_authorization ⇒ GRANTED` 已废除）');
  assert.strictEqual(g1.gate_status, 'BLOCKED_ON_DEPLOYMENT_IDENTITY');
  // 显式守住「不得仅凭 owner 授权放行」
  assert.notStrictEqual(g1.gate_status, 'GRANTED',
    'P-05：⛔ 部署身份未验证时**绝不得** GRANTED');

  // ② 只有 deployment_identity_verified = true + owner_run_authorization = true + 其余全 PASS
  //    ⇒ 才允许 GRANTED
  const g2 = G.evaluateControlledActivationGate(
    Object.assign({}, base, { deployment_identity_verified: true }));
  assert.strictEqual(g2.gate_status, 'GRANTED', 'P-05：部署身份已验证 + owner 运行授权 ⇒ GRANTED');
  assert.strictEqual(g2.may_activate, true);
  assert.strictEqual(g2.ready_for_v365_first_controlled_run, 'GRANTED');

  // ③ 部署身份已验证但**缺** owner 运行授权 ⇒ PENDING_OWNER_APPROVAL（仍不得放行）
  const g3 = G.evaluateControlledActivationGate(
    Object.assign({}, base, { deployment_identity_verified: true, owner_run_authorization: false }));
  assert.strictEqual(g3.gate_status, 'PENDING_OWNER_APPROVAL',
    'P-05：部署身份已验证但缺 owner 运行授权 ⇒ PENDING_OWNER_APPROVAL');
  assert.strictEqual(g3.ready_for_v365_first_controlled_run, 'PENDING_OWNER_RUN_APPROVAL');
  assert.strictEqual(g3.may_activate, false);
}

/* ---------------- P-05b ★ §7/§8 GATE-D 部署门禁与 GATE-R 运行门禁严格分离 ---------------- */
{
  // ★ C-021.1 §6：新增 D-08/D-09（artifact 链）—— 必须显式提供，否则会落到
  //    BLOCKED_ON_DEPLOYMENT_ARTIFACT（这正是 fail-closed 的预期行为，见 P-40）
  const fullD = {
    candidate_source_frozen: true, deployment_manifest_frozen: true,
    deployment_scope_exact: true, current_production_baseline_verified: true,
    rollback_artifact_verified: true, all_qualification_gates_pass: true,
    protected_domain_clean: true,
    deployment_artifact_materialized: true, deployment_artifact_exact_match: true,
    owner_deployment_authorization: false
  };
  // ① 核心全绿但缺 owner 部署授权 ⇒ PENDING_OWNER_DEPLOYMENT_APPROVAL · ⛔ 不得 deploy
  const d1 = G.evaluateDeploymentGate(fullD);
  assert.strictEqual(d1.gate_status, 'PENDING_OWNER_DEPLOYMENT_APPROVAL',
    'P-05b：缺 owner 部署授权 ⇒ PENDING_OWNER_DEPLOYMENT_APPROVAL');
  assert.strictEqual(d1.may_deploy, false, 'P-05b：⛔ 不得 deploy');
  assert.strictEqual(d1.implies_first_controlled_run, false,
    'P-05b：⛔ 部署门禁**绝不**蕴含运行授权');
  assert.strictEqual(d1.gate_id, 'READY_FOR_V365_CONTROLLED_DEPLOYMENT');

  // ② owner 部署授权 ⇒ 可部署，但 ⛔ 仍不得推导出运行授权
  const d2 = G.evaluateDeploymentGate(Object.assign({}, fullD, { owner_deployment_authorization: true }));
  assert.strictEqual(d2.gate_status, 'GRANTED');
  assert.strictEqual(d2.may_deploy, true);
  assert.strictEqual(d2.implies_first_controlled_run, false,
    'P-05b：⛔ GATE-D GRANTED ≠ GATE-R GRANTED（两次 owner 授权必须严格分离）');

  // ③ 任一核心项缺失 ⇒ ⛔ 不得 deploy（即使 owner 已授权）
  //    · artifact 项（D-08/D-09）缺 ⇒ BLOCKED_ON_DEPLOYMENT_ARTIFACT
  //    · 其它核心项缺 ⇒ BLOCKED_DEPLOYMENT_GATE_INCOMPLETE
  for (const k of Object.keys(fullD)) {
    if (k === 'owner_deployment_authorization') continue;
    const f = Object.assign({}, fullD, { [k]: false, owner_deployment_authorization: true });
    const d = G.evaluateDeploymentGate(f);
    assert.strictEqual(d.may_deploy, false, `P-05b：${k}=false ⇒ ⛔ 不得 deploy`);
    const isArtifactItem = k === 'deployment_artifact_materialized' ||
                           k === 'deployment_artifact_exact_match';
    assert.strictEqual(d.gate_status,
      isArtifactItem ? 'BLOCKED_ON_DEPLOYMENT_ARTIFACT' : 'BLOCKED_DEPLOYMENT_GATE_INCOMPLETE',
      `P-05b：${k}=false ⇒ 状态必须是 ${isArtifactItem ? 'BLOCKED_ON_DEPLOYMENT_ARTIFACT' : 'BLOCKED_DEPLOYMENT_GATE_INCOMPLETE'}`);
  }
}

/* ---------------- P-05c ★ §9 Post-Deploy Identity Gate 必须逐项 EXACT_MATCH 才置 true ---------------- */
{
  const manifest = {
    candidate_manifest_sha: 'aaa'.repeat(21) + 'a',
    expected_runtime: 'Nodejs16.13',
    expected_handler: 'index.main',
    deployment_required_files: [{ path: 'index.js', sha256: 'h1' }, { path: 'src/common/schema.js', sha256: 'h2' }]
  };
  const onlineOk = {
    Runtime: 'Nodejs16.13', Handler: 'index.main',
    deployment_candidate_manifest_sha: manifest.candidate_manifest_sha,
    file_hashes: [{ path: 'index.js', sha256: 'h1' }, { path: 'src/common/schema.js', sha256: 'h2' }]
  };

  // ① 完全一致 + diff=0 ⇒ verified=true / EXACT_MATCH / 无 STOP
  const r1 = G.evaluatePostDeployIdentity({ online: onlineOk, manifest, unexpected_package_diff: 0 });
  assert.strictEqual(r1.deployment_identity_verified, true, 'P-05c：完全一致 ⇒ verified=true');
  assert.strictEqual(r1.online_source_parity, 'EXACT_MATCH');
  assert.strictEqual(r1.stop, null, 'P-05c：一致时不停机');

  // ② runtime 不一致 ⇒ STOP（fail-closed）
  const r2 = G.evaluatePostDeployIdentity({
    online: Object.assign({}, onlineOk, { Runtime: 'Nodejs18.15' }), manifest, unexpected_package_diff: 0
  });
  assert.strictEqual(r2.deployment_identity_verified, false, 'P-05c：⛔ runtime 不符 ⇒ verified=false');
  assert.strictEqual(r2.online_source_parity, 'MISMATCH');
  assert.strictEqual(r2.stop, 'STOP', 'P-05c：⛔ 必须 STOP');

  // ③ 单文件内容漂移 ⇒ STOP
  const r3 = G.evaluatePostDeployIdentity({
    online: Object.assign({}, onlineOk, {
      file_hashes: [{ path: 'index.js', sha256: 'DIFF' }, { path: 'src/common/schema.js', sha256: 'h2' }]
    }), manifest, unexpected_package_diff: 0
  });
  assert.strictEqual(r3.deployment_identity_verified, false, 'P-05c：⛔ 单文件漂移 ⇒ verified=false');
  assert.ok(r3.mismatches.some((m) => /index\.js/.test(m)), 'P-05c：须指认漂移文件');

  // ④ ⛔ UNEXPECTED_PACKAGE_DIFF ≠ 0 ⇒ STOP
  const r4 = G.evaluatePostDeployIdentity({ online: onlineOk, manifest, unexpected_package_diff: 1 });
  assert.strictEqual(r4.deployment_identity_verified, false, 'P-05c：⛔ diff≠0 ⇒ verified=false');
  assert.strictEqual(r4.stop, 'STOP');

  // ⑤ ⛔ 缺 online.file_hashes ⇒ fail-closed（不得因"没法比"而放行）
  const r5 = G.evaluatePostDeployIdentity({
    online: { Runtime: 'Nodejs16.13', Handler: 'index.main' }, manifest, unexpected_package_diff: 0
  });
  assert.strictEqual(r5.deployment_identity_verified, false,
    'P-05c：⛔ 缺逐文件哈希 ⇒ verified 必须保持 false（fail-closed）');
  assert.strictEqual(r5.stop, 'STOP');
}

/* ---------------- P-06 ⛔ 任一门禁缺失 ⇒ fail-closed ---------------- */
{
  const base = {
    hd10_complete: true, production_schema_exact_match: true,
    stage_a_pass: true, stage_a_to_g_pass: true,
    qualification_gate_pass: true, reader_migration_pass: true,
    immutable_pass: true, gen1_pass: true, gen2_pass: true,
    p12_parity_delta_zero: true, protected_domain_clean: true,
    rpg_f2_historical_registered: true, rpg_f3_historical_registered: true,
    rpg_f3_historical_unexpected_decision_delta: 6, rpg_f3_historical_waived: false,
    run_history_infra_ready: true, switch_date_null_before_first: true,
    actual_book_authority_frozen: true, two_layer_anchor_registered: true,
    cas_history_recovery_registered: true, od_p_1_approved_no_auto_lower: true,
    // ★ C-021：G-16 改名 + G-21~G-25 补齐
    owner_run_authorization: true,
    candidate_source_frozen: true, deployment_scope_exact: true,
    rollback_artifact_verified: true, production_baseline_verified: true,
    deployment_identity_verified: true
  };
  for (const key of Object.keys(base)) {
    if (key === 'rpg_f3_historical_unexpected_decision_delta' || key === 'rpg_f3_historical_waived') continue;
    const f = Object.assign({}, base); f[key] = false;
    const g = G.evaluateControlledActivationGate(f);
    assert.strictEqual(g.may_activate, false, `P-06：${key}=false ⇒ 必须不得放行`);
  }
  // schema drift 单测
  const g2 = G.evaluateControlledActivationGate(Object.assign({}, base, { production_schema_exact_match: false }));
  assert.strictEqual(g2.gate_status, 'BLOCKED_GATE_INCOMPLETE');
  // ⛔ G-25=false ⇒ 必须报更精确的 BLOCKED_ON_DEPLOYMENT_IDENTITY（而非泛化 BLOCKED_GATE_INCOMPLETE）
  const g3 = G.evaluateControlledActivationGate(Object.assign({}, base, { deployment_identity_verified: false }));
  assert.strictEqual(g3.gate_status, 'BLOCKED_ON_DEPLOYMENT_IDENTITY',
    'P-06：⛔ G-25=false ⇒ 必须是 BLOCKED_ON_DEPLOYMENT_IDENTITY');
}

/* ---------------- P-07 ★★ 历史 Δ 不得被静默豁免 ---------------- */
{
  const base = {
    hd10_complete: true, production_schema_exact_match: true,
    stage_a_pass: true, stage_a_to_g_pass: true,
    qualification_gate_pass: true, reader_migration_pass: true,
    immutable_pass: true, gen1_pass: true, gen2_pass: true,
    p12_parity_delta_zero: true, protected_domain_clean: true,
    rpg_f2_historical_registered: true, rpg_f3_historical_registered: true,
    run_history_infra_ready: true, switch_date_null_before_first: true,
    // ★ C-021：门禁键补齐（历史 Δ 静默豁免必须是**先于**身份判定的 FAIL）
    actual_book_authority_frozen: true, two_layer_anchor_registered: true,
    cas_history_recovery_registered: true, od_p_1_approved_no_auto_lower: true,
    owner_run_authorization: true,
    candidate_source_frozen: true, deployment_scope_exact: true,
    rollback_artifact_verified: true, production_baseline_verified: true,
    deployment_identity_verified: true
  };
  // ① 把历史 Δ 写成 0（伪装消失）⇒ 必须 FAIL
  const w1 = G.evaluateControlledActivationGate(
    Object.assign({}, base, { rpg_f3_historical_unexpected_decision_delta: 0, rpg_f3_historical_waived: false }));
  assert.strictEqual(w1.gate_status, 'BLOCKED_HISTORICAL_DELTA_SILENTLY_WAIVED',
    'P-07：⛔ 历史 Δ 被写成 0 ⇒ 必须 BLOCKED_HISTORICAL_DELTA_SILENTLY_WAIVED');
  assert.strictEqual(w1.may_activate, false);
  // ② 显式豁免 ⇒ 同样 FAIL
  const w2 = G.evaluateControlledActivationGate(
    Object.assign({}, base, { rpg_f3_historical_unexpected_decision_delta: 6, rpg_f3_historical_waived: true }));
  assert.strictEqual(w2.gate_status, 'BLOCKED_HISTORICAL_DELTA_SILENTLY_WAIVED',
    'P-07：⛔ 显式 waive 历史 Δ ⇒ 必须 BLOCKED');
  // ③ 正确登记（=6 且未豁免）⇒ 通过该判据
  const ok = G.evaluateControlledActivationGate(
    Object.assign({}, base, { rpg_f3_historical_unexpected_decision_delta: 6, rpg_f3_historical_waived: false }));
  const g13 = ok.items.find((x) => x.id === 'G-13');
  assert.strictEqual(g13.ok, true, 'P-07：正确登记（=6 未豁免）⇒ G-13 PASS');
}

/* ---------------- P-08 ⛔ controlled activation ≠ general production ---------------- */
{
  const g = G.evaluateControlledActivationGate({
    hd10_complete: true, production_schema_exact_match: true,
    stage_a_pass: true, stage_a_to_g_pass: true,
    qualification_gate_pass: true, reader_migration_pass: true,
    immutable_pass: true, gen1_pass: true, gen2_pass: true,
    p12_parity_delta_zero: true, protected_domain_clean: true,
    rpg_f2_historical_registered: true, rpg_f3_historical_registered: true,
    rpg_f3_historical_unexpected_decision_delta: 6, rpg_f3_historical_waived: false,
    run_history_infra_ready: true, switch_date_null_before_first: true,
    actual_book_authority_frozen: true, two_layer_anchor_registered: true,
    cas_history_recovery_registered: true, od_p_1_approved_no_auto_lower: true,
    owner_run_authorization: true,
    candidate_source_frozen: true, deployment_scope_exact: true,
    rollback_artifact_verified: true, production_baseline_verified: true,
    deployment_identity_verified: true
  });
  assert.strictEqual(g.gate_status, 'GRANTED', 'P-08：前置：全绿 ⇒ GRANTED');
  assert.strictEqual(g.ready_for_general_production, false,
    'P-08：⛔ controlled activation GRANTED 也**不得**推出 READY_FOR_GENERAL_PRODUCTION');
  assert.strictEqual(g.ready_for_production_promotion, 'NOT_ISSUED',
    'P-08：⛔ 不得推出 READY_FOR_PRODUCTION_PROMOTION');
}

/* ---------------- P-09 Acceptance 未跑 ⇒ NOT_RUN + 索引保持 PENDING ---------------- */
{
  const a = G.evaluateFirstNaturalRunAcceptance({ __run_attempted: false });
  assert.strictEqual(a.acceptance_status, 'NOT_RUN');
  assert.strictEqual(a.all_green, false);
  assert.strictEqual(a.run_history_index_transition, 'PENDING',
    'P-09：未跑 ⇒ RUN_HISTORY_INDEX 必须保持 PENDING');
  assert.strictEqual(G.ACCEPTANCE_ITEMS.length, 10, 'P-09：A 判据必须恰为 10 项');
}

/* ---------------- P-10 Acceptance 全绿才升格 ---------------- */
{
  const full = { __run_attempted: true };
  G.ACCEPTANCE_ITEMS.forEach((it) => { full[it.key] = true; });
  const a = G.evaluateFirstNaturalRunAcceptance(full);
  assert.strictEqual(a.acceptance_status, 'PASSED');
  assert.strictEqual(a.all_green, true);
  assert.strictEqual(a.run_history_index_transition, 'ACTIVE/AVAILABLE',
    'P-10：A-01~A-10 全绿 ⇒ 才允许 PENDING → ACTIVE/AVAILABLE');
}

/* ---------------- P-11 ⛔ 部分通过不得升格 ---------------- */
{
  const partial = { __run_attempted: true };
  G.ACCEPTANCE_ITEMS.forEach((it, i) => { partial[it.key] = i < 5; }); // 只有 A-01~A-05
  const a = G.evaluateFirstNaturalRunAcceptance(partial);
  assert.strictEqual(a.acceptance_status, 'FAILED', 'P-11：部分通过 ⇒ FAILED');
  assert.strictEqual(a.run_history_index_transition, 'PENDING',
    'P-11：⛔ 部分通过**不得**升格 RUN_HISTORY_INDEX');
  assert.ok(a.failed_items.includes('A-06'), 'P-11：必须报出 A-06 等未通过项');
  assert.strictEqual(a.failed_items.length, 5);
}

/* ---------------- P-12 ⛔ coverage 禁止 synthetic / suggested 来源 ---------------- */
{
  const base = {
    required_trade_dates: ['2026-10-01', '2026-10-02'],
    available_trade_dates: ['2026-10-01'],
    missing_trade_dates: ['2026-10-02'],
    // ★ C-020 §1：合法 actual book = portfolio_snapshot；execution authority = trade_log
    actual_book_source: 'portfolio_snapshot.positions[].position',
    cooldown_source: 'production computeCooldownDays() as-of-date (execution authority = trade_log)'
  };
  assert.strictEqual(G.validateProspectiveCoverage(base).ok, true, 'P-12：合法来源必须通过');
  for (const bad of ['synthetic', 'suggested_position', 'counterfactual', 'interpolated', 'zero_position']) {
    const r = G.validateProspectiveCoverage(Object.assign({}, base, { actual_book_source: bad }));
    assert.strictEqual(r.ok, false, `P-12：⛔ 来源 "${bad}" 必须 FAIL（Model B）`);
  }
  // missing 与 required-available 不一致 ⇒ FAIL
  const r2 = G.validateProspectiveCoverage(Object.assign({}, base, { missing_trade_dates: [] }));
  assert.strictEqual(r2.ok, false, 'P-12：⛔ 人工裁剪 missing_trade_dates 必须 FAIL');
}

/* ---------------- P-13 ⛔ 生产集合未被新增/篡改 + 设计文档真实引用（结构侧守卫） ---------------- */
{
  // ① prospective 设计**不得**要求新增生产集合：仍恰为 5 个 v365 集合
  const names = Object.values(V365_COLLECTIONS);
  assert.strictEqual(names.length, 5, 'P-13：v365 生产集合必须仍恰为 5 个');

  // ② ★ C-021 §12：删除 vacuous `|| true`。
  //    设计要求：集合同一来源 = `v365-contracts.js`，设计文档必须**真实**登记每个集合名。
  //    设计文档若与契约漂移（改了集合名却没同步文档）⇒ 本断言**必须失败**。
  const contractSrc = fs.readFileSync(
    path.join(REPO, 'src/common/utils/v365-contracts.js'), 'utf8');
  const designDoc = fs.readFileSync(
    path.join(REPO, 'docs/V365_PROSPECTIVE_PRODUCTION_QUALIFICATION.md'), 'utf8');
  for (const n of names) {
    assert.ok(designDoc.includes(n),
      `P-13：设计文档必须真实登记生产集合 "${n}" —— 设计契约与 v365-contracts.js 不许漂移`);
    // 集合名须能在契约源中定位（防止集合名被改名后文档未同步）
    assert.ok(contractSrc.includes(n),
      `P-13：集合名 "${n}" 必须仍存在于 v365-contracts.js（唯一来源）`);
  }
}

/* ---------------- P-14 ★ 设计文档必须含 §16 规定的 12 节 ---------------- */
{
  const doc = fs.readFileSync(
    path.join(REPO, 'docs/V365_PROSPECTIVE_PRODUCTION_QUALIFICATION.md'), 'utf8');
  const requiredSections = [
    'Deadlock Statement',
    'Historical vs Prospective Split',
    'RFP-V2-PH-PROSPECTIVE',
    'Controlled Production Activation Gate',
    'V365_FIRST_NATURAL_RUN_ACCEPTANCE',
    'Prospective Qualification Window',
    'Prospective Protocol 的真实数据源',
    'Prospective RPG-F2-B / F2-C 关闭规则',
    'Prospective RPG-F3 Attribution Rule',
    'Rollback / Fail-Closed Rules',
    'Owner Decisions',
    'Exact Next Execution Sequence'
  ];
  for (const s of requiredSections) {
    assert.ok(doc.includes(s), `P-14：设计文档必须含 "${s}"`);
  }
  // ⛔ 必须声明只设计不执行
  assert.ok(/PROSPECTIVE_DESIGN_FINAL\s*=\s*READY_FOR_OWNER_ACTIVATION_DECISION/.test(doc),
    'P-14：必须声明 PROSPECTIVE_DESIGN_FINAL = READY_FOR_OWNER_ACTIVATION_DECISION');
  assert.ok(/PRODUCTION_ACTIVATION_AUTHORIZATION/.test(doc), 'P-14：必须声明激活授权状态');
}

/* ---------------- P-15 ⛔ 脚本不得含生产写入命令 ---------------- */
{
  const preflight = fs.readFileSync(
    path.join(REPO, 'scripts/v365-prospective-preflight.js'), 'utf8');
  const codeOnly = preflight
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const forbidden = [/\binsert\b/i, /\bdelete\b/i, /\bdrop\b/i, /\bdropIndex\b/i,
    /\bcreateIndexes\b/i, /\bexecFileSync\b/, /\bexecSync\(['"]tcb/, /tcb['"],\s*['"]db/];
  for (const re of forbidden) {
    assert.ok(!re.test(codeOnly),
      `P-15：⛔ prospective preflight 含生产写入/连接痕迹（${re}）—— 必须纯只读`);
  }
}

/* ---------------- P-16 ⛔ Δ 命名拆分（历史 vs P12） ---------------- */
{
  const doc = fs.readFileSync(
    path.join(REPO, 'docs/V365_PROSPECTIVE_PRODUCTION_QUALIFICATION.md'), 'utf8');
  assert.ok(/RPG_F3_HISTORICAL_UNEXPECTED_DECISION_DELTA\s*=\s*6/.test(doc),
    'P-16：必须显式登记 RPG_F3_HISTORICAL_UNEXPECTED_DECISION_DELTA = 6');
  assert.ok(/RPG_F3_PROSPECTIVE_UNEXPECTED_DECISION_DELTA/.test(doc),
    'P-16：必须登记 prospective Δ 字段');
  const state = JSON.parse(fs.readFileSync(
    path.join(REPO, 'deliverables/v365-production-history/prospective/prospective-state.json'), 'utf8'));
  assert.strictEqual(state.historical.rpg_f3_historical_unexpected_decision_delta, 6);
  assert.strictEqual(state.historical.rpg_f2_b, 'PARTIAL / BLOCKED_ON_EXECUTION_COVERAGE');
  assert.strictEqual(state.historical.rpg_f2_c, 'BLOCKED_ON_ACTUAL_BOOK_COVERAGE');
  assert.strictEqual(state.historical.rfp_v2_ph_full_window_available, false);
}

/* ---------------- P-17 ⛔ 状态件必须声明零生产副作用 ---------------- */
{
  const state = JSON.parse(fs.readFileSync(
    path.join(REPO, 'deliverables/v365-production-history/prospective/prospective-state.json'), 'utf8'));
  assert.strictEqual(state.production_write_performed, false);
  assert.strictEqual(state.production_run_triggered, false);
  assert.strictEqual(state.pointer_initialized, false);
  assert.strictEqual(state.final_state.PRODUCTION_ACTIVATION_AUTHORIZATION, 'NOT_GRANTED');
  assert.strictEqual(state.final_state.READY_FOR_GENERAL_PRODUCTION, false);
  assert.strictEqual(state.final_state.V365_ENFORCE_SWITCH_DATE, null);
  assert.strictEqual(state.final_state.RUN_HISTORY_INDEX, 'PENDING');
  assert.strictEqual(state.prospective.qualification_authoritative, false);
  assert.strictEqual(state.prospective.prospective_epoch, 'NOT_STARTED');
}

/* ================================================================
 * ★ C-020 修正（owner §1~§8）：authority / 两层 anchor / CAS-history 恢复 / OD-P-1~P-5
 * ================================================================ */

/* ---------------- P-18 ★ §1 ⛔ run_candidate_portfolio 不得用于 actual-book ---------------- */
{
  assert.strictEqual(G.ACTUAL_BOOK_AUTHORITY.execution_authority, 'trade_log',
    'P-18：execute authority 必须为 trade_log');
  assert.strictEqual(G.ACTUAL_BOOK_AUTHORITY.actual_position_book_authority,
    'portfolio_snapshot.positions[].position',
    'P-18：actual position-book authority 必须为 portfolio_snapshot.positions[].position');
  assert.strictEqual(G.ACTUAL_BOOK_AUTHORITY.run_candidate_portfolio_role,
    'candidate_intended_portfolio_provenance',
    'P-18：run_candidate_portfolio 仅作 candidate/intended provenance');
  assert.strictEqual(G.ACTUAL_BOOK_AUTHORITY.run_candidate_portfolio_may_qualify_actual_book, false,
    'P-18：⛔ run_candidate_portfolio 不得用于 actual-book qualification');

  // coverage 校验必须**拒绝** run_candidate_portfolio 作为 actual_book_source
  const bad = G.validateProspectiveCoverage({
    required_trade_dates: [], available_trade_dates: [], missing_trade_dates: [],
    actual_book_source: 'run_candidate_portfolio (ACTUAL_EXECUTION_LEDGER)',
    cooldown_source: 'production computeCooldownDays() as-of-date'
  });
  assert.strictEqual(bad.ok, false, 'P-18：⛔ coverage 必须拒绝 run_candidate_portfolio 作为 actual book');
  assert.ok(bad.errors.some((e) => /run_candidate_portfolio/.test(e)),
    'P-18：错误信息须显式指认 run_candidate_portfolio');

  // 正确来源必须通过
  const good = G.validateProspectiveCoverage({
    required_trade_dates: [], available_trade_dates: [], missing_trade_dates: [],
    actual_book_source: 'portfolio_snapshot.positions[].position',
    cooldown_source: 'production computeCooldownDays() as-of-date (execution authority = trade_log)'
  });
  assert.strictEqual(good.ok, true, 'P-18：正确 authority 应通过校验');
}

/* ---------------- P-19 §1 审计证据件必须存在且结论一致 ---------------- */
{
  const audit = JSON.parse(fs.readFileSync(path.join(REPO,
    'deliverables/v365-production-history/prospective/actual-book-authority-audit.json'), 'utf8'));
  assert.strictEqual(audit.answer, 'NOT_PROVEN', 'P-19：审计结论必须为 NOT_PROVEN');
  assert.strictEqual(audit.verdict, 'CANDIDATE_INTENDED_PORTFOLIO_PROVENANCE_ONLY');
  assert.ok(Array.isArray(audit.evidence) && audit.evidence.length >= 5, 'P-19：须有 ≥5 条取证');
  assert.ok(audit.run_candidate_portfolio.must_not_be_used_for
    .includes('RPG-F2-C-PROSPECTIVE actual-book qualification'),
    'P-19：须显式禁止用于 RPG-F2-C-PROSPECTIVE');
  assert.strictEqual(audit.production_writes_performed, false, 'P-19：审计为只读');
}

/* ---------------- P-20 ★ §2 result_sequence_sha 不得单独作 qualification anchor ---------------- */
{
  const r = G.validateProspectiveAnchor({ result_sequence_sha: 'deadbeef'.repeat(8), prospective_qualification_anchor: null });
  assert.strictEqual(r.ok, false, 'P-20：⛔ 仅给 result_sequence_sha 必须 FAIL');
  assert.ok(r.errors.some((e) => /result_sequence_sha 不得单独/.test(e)), 'P-20：须显式报错');
  assert.strictEqual(r.result_sequence_sha_standalone_forbidden, true);
}

/* ---------------- P-21 ★ §2/§5 PROSPECTIVE_QUALIFICATION_ANCHOR 必须绑定全部必需字段 ---------------- */
{
  const REQUIRED = G.ANCHOR_BINDINGS;
  assert.ok(REQUIRED.length >= 12, 'P-21：至少 12 个绑定');
  for (const k of ['protocol_version', 'replay_semantics', 'prospective_epoch',
    'window_start', 'window_end', 'trade_log_dataset_sha', 'portfolio_snapshot_dataset_sha',
    'run_history_manifest_sha', 'production_code_sha', 'replay_harness_sha',
    'coverage_manifest_sha', 'result_sequence_sha']) {
    assert.ok(REQUIRED.includes(k), `P-21：必须绑定 ${k}`);
  }

  // 完整绑定 ⇒ PASS（protocol 字段须取真实值）
  const full = {};
  for (const k of REQUIRED) full[k] = 'x';
  full.protocol_version = G.PROTOCOL.protocol_version;
  full.replay_semantics = G.PROTOCOL.replay_semantics;
  assert.strictEqual(G.validateProspectiveAnchor({ prospective_qualification_anchor: { bindings: full } }).ok, true,
    'P-21：完整绑定应 PASS');

  // 逐一缺失 ⇒ 均须 FAIL（⛔ 不得减少绑定）
  for (const k of REQUIRED) {
    const partial = { ...full };
    delete partial[k];
    const r = G.validateProspectiveAnchor({ prospective_qualification_anchor: { bindings: partial } });
    assert.strictEqual(r.ok, false, `P-21：缺少 ${k} 时必须 FAIL`);
  }

  // ⛔ anchor sha 不得复用旧协议
  const reused = { ...full, protocol_version: 'RFP-V2-PH-PROSPECTIVE', replay_semantics: 'PRODUCTION_HISTORICAL_PROSPECTIVE' };
  const rr = G.validateProspectiveAnchor({
    prospective_qualification_anchor: { bindings: reused, sha256: G.FORBIDDEN_ANCHORS[0] }
  });
  assert.strictEqual(rr.ok, false, 'P-21：⛔ anchor 复用旧值必须 FAIL');
}

/* ---------------- P-22 ★ §3 A. CAS_REJECTED 语义 ---------------- */
{
  const r = G.evaluateCasHistoryRecovery({ cas_result: 'REJECTED' });
  assert.strictEqual(r.state, 'CAS_REJECTED', 'P-22：状态必须为 CAS_REJECTED');
  assert.strictEqual(r.may_advance, false, 'P-22：不得前进');
  assert.strictEqual(r.switch_date, null, 'P-22：switch date 必须为 null');
  assert.ok(r.actions.some((a) => /pointer 不变/.test(a)), 'P-22：须声明 pointer 不变');
  assert.ok(r.actions.some((a) => /NOT_STARTED/.test(a)), 'P-22：须声明 EPOCH = NOT_STARTED');
  assert.ok(r.actions.some((a) => /STOP/.test(a)), 'P-22：须 STOP');
}

/* ---------------- P-23 ★ §3 B. CAS 成功 + history 失败 ⇒ PROMOTED_HISTORY_INCOMPLETE ---------------- */
{
  const base = { cas_result: 'SUCCESS', run_history_append_result: 'FAILED', this_run_id: 'R1', pointer_run_id: 'R1' };

  // ⛔ 不得声明"不写 pointer"
  const a = G.evaluateCasHistoryRecovery(base);
  assert.strictEqual(a.state, 'PROMOTED_HISTORY_INCOMPLETE', 'P-23：状态必须为 PROMOTED_HISTORY_INCOMPLETE');
  assert.ok(a.actions.some((x) => /不得声明.*不写 pointer/.test(x)),
    'P-23：必须显式禁止"不写 pointer"声明（promotion 已发生）');
  assert.strictEqual(a.may_advance, false, 'P-23：恢复前不得前进');
  assert.strictEqual(a.switch_date, null, 'P-23：switch date 保持 null');

  // 5a 无 history ⇒ 幂等补写
  assert.ok(a.actions.some((x) => /5a\.\s*无 history/.test(x)), 'P-23：须含 5a 幂等补写');

  // 5b exact-match ⇒ RECOVERED
  const b = G.evaluateCasHistoryRecovery({
    ...base, existing_history: { run_id: 'R1', status: 'COMPLETE' }, expected_history: { run_id: 'R1', status: 'COMPLETE' }
  });
  assert.strictEqual(b.state, 'RECOVERED', 'P-23：5b exact-match ⇒ RECOVERED');

  // 5c 冲突 ⇒ HISTORY_IMMUTABILITY_CONFLICT + HARD STOP
  const c = G.evaluateCasHistoryRecovery({
    ...base, existing_history: { run_id: 'R1', status: 'COMPLETE' }, expected_history: { run_id: 'R1', status: 'PARTIAL' }
  });
  assert.strictEqual(c.state, 'HISTORY_IMMUTABILITY_CONFLICT', 'P-23：5c 冲突 ⇒ HARD STOP');
  assert.strictEqual(c.may_advance, false, 'P-23：冲突时不得前进');
  assert.ok(c.actions.some((x) => /不得自动回滚 pointer/.test(x)), 'P-23：⛔ 须禁止自动回滚 pointer');

  // pointer != 本 run ⇒ 矛盾 ⇒ HARD STOP
  const d = G.evaluateCasHistoryRecovery({ ...base, pointer_run_id: 'R2' });
  assert.ok(d.errors.length > 0, 'P-23：pointer 不一致必须报错');
  assert.strictEqual(d.may_advance, false, 'P-23：pointer 不一致 ⇒ 不得前进');
}

/* ---------------- P-24 ★ §3 未知 CAS 结果 ⇒ fail-closed ---------------- */
{
  const r = G.evaluateCasHistoryRecovery({ cas_result: 'MAYBE' });
  assert.strictEqual(r.may_advance, false, 'P-24：未知结果不得前进');
  assert.ok(r.errors.length > 0, 'P-24：未知结果必须报错（fail-closed）');
}

/* ---------------- P-25 ★ §4 OD-P-1 = APPROVED（120 / 250） ---------------- */
{
  assert.strictEqual(G.WINDOW_POLICY.minimum_trading_days, 120, 'P-25：MIN 必须为 120');
  assert.strictEqual(G.WINDOW_POLICY.maximum_trading_days, 250, 'P-25：MAX 必须为 250');
  assert.strictEqual(G.WINDOW_POLICY.may_auto_lower_standard, false, 'P-25：⛔ 不得自动降低资格标准');
  assert.strictEqual(G.WINDOW_POLICY.on_insufficient_at_max, 'STOP_OWNER_REVIEW_REQUIRED');

  const dimsOk = { regime_count: 2, actions_covered: ['BUILD', 'ADD', 'REDUCE', 'HOLD'], cooldown_triggered: true, cap_triggered: true };

  // < 120 ⇒ ACCUMULATING
  assert.strictEqual(G.evaluateProspectiveWindow({ trading_days: 119, dimensions: dimsOk }).status, 'ACCUMULATING');
  // ≥120 且维度全满足 ⇒ SATISFIED
  assert.strictEqual(G.evaluateProspectiveWindow({ trading_days: 120, dimensions: dimsOk }).status, 'WINDOW_SATISFIED');
  // ≥120 但维度不足 ⇒ 自动延长
  assert.strictEqual(G.evaluateProspectiveWindow({ trading_days: 200, dimensions: { regime_count: 1 } }).status, 'ACCUMULATING_EXTENDED');
  // 达 250 仍不足 ⇒ STOP + OWNER_REVIEW_REQUIRED
  const atMax = G.evaluateProspectiveWindow({ trading_days: 250, dimensions: { regime_count: 1 } });
  assert.strictEqual(atMax.status, 'STOP_OWNER_REVIEW_REQUIRED', 'P-25：250 仍不足 ⇒ STOP');
  assert.strictEqual(atMax.may_qualify, false, 'P-25：⛔ 不得自动降标通过');
}

/* ---------------- P-26 ★ §7 OD-P-5 ⛔ agent 不得自行升格 qualification_authoritative ---------------- */
{
  // 全条件满足 ⇒ 仅"有资格进入 owner 裁定"，仍不得由 agent 置 true
  const full = G.evaluateQualificationAuthoritativePromotion({
    window_trading_days: 120, dynamic_coverage_satisfied: true,
    rpg_f2_b_prospective: 'COMPLETE', rpg_f2_c_prospective: 'COMPLETE',
    rpg_f3_prospective_unexpected_decision_delta: 0, full_requalification_pass: true
  });
  assert.strictEqual(full.eligible_for_owner_promotion_decision, true);
  assert.strictEqual(full.requires_owner_decision, true, 'P-26：必须由 owner 单独裁定');
  assert.strictEqual(full.may_agent_set_authoritative, false, 'P-26：⛔ agent 不得自行升格');

  // 任一条不满足 ⇒ 不得进入 owner 裁定
  const partial = G.evaluateQualificationAuthoritativePromotion({
    window_trading_days: 119, dynamic_coverage_satisfied: true,
    rpg_f2_b_prospective: 'COMPLETE', rpg_f2_c_prospective: 'COMPLETE',
    rpg_f3_prospective_unexpected_decision_delta: 0, full_requalification_pass: true
  });
  assert.strictEqual(partial.eligible_for_owner_promotion_decision, false, 'P-26：窗口不足 ⇒ 不合格');

  const nonzero = G.evaluateQualificationAuthoritativePromotion({
    window_trading_days: 200, dynamic_coverage_satisfied: true,
    rpg_f2_b_prospective: 'COMPLETE', rpg_f2_c_prospective: 'COMPLETE',
    rpg_f3_prospective_unexpected_decision_delta: 3, full_requalification_pass: true
  });
  assert.strictEqual(nonzero.eligible_for_owner_promotion_decision, false,
    'P-26：前瞻 Δ ≠ 0 ⇒ 不合格');
}

/* ---------------- P-27 ★ §6 OD-P-4 时点规则 ---------------- */
{
  const doc = fs.readFileSync(path.join(REPO, 'docs/V365_PROSPECTIVE_PRODUCTION_QUALIFICATION.md'), 'utf8');
  assert.ok(/OD-P-4/.test(doc), 'P-27：须登记 OD-P-4');
  assert.ok(/第一个正常计划执行且市场数据完整的自然交易日/.test(doc),
    'P-27：须登记 epoch 时点定义');
  for (const banned of ['回溯日期', '历史表现好', '测试日期', '设计日期']) {
    assert.ok(doc.includes(banned), `P-27：须显式禁止「${banned}」`);
  }
}

/* ---------------- P-28 ★ §8/§14 OD-P-3 = NOT_YET_GRANTED + 部署身份 fail-closed ---------------- */
{
  const state = JSON.parse(fs.readFileSync(path.join(REPO,
    'deliverables/v365-production-history/prospective/prospective-state.json'), 'utf8'));
  assert.strictEqual(state.final_state.PRODUCTION_ACTIVATION_AUTHORIZATION, 'NOT_GRANTED');
  // ★★ C-021.2：状态断言必须**分阶段**（部署前 / 部署后）——
  //    ⛔ 不得写死「部署前」的期望值，否则部署成功后测试必然变红（那是**假红**）。
  const deployed = state.final_state.DEPLOYMENT_IDENTITY_VERIFIED === true;
  if (deployed) {
    // ── 部署后（C-021.2 §7/§9 已执行单次授权部署）──
    assert.strictEqual(state.final_state.CONTROLLED_DEPLOYMENT, 'COMPLETE',
      'P-28：部署后 CONTROLLED_DEPLOYMENT 必须 COMPLETE');
    assert.strictEqual(state.final_state.CURRENT_PRODUCTION_DEPLOYMENT_IDENTITY, 'V3.6.5',
      'P-28：部署后线上身份必须是 V3.6.5');
    assert.strictEqual(state.final_state.ONLINE_SOURCE_PARITY, 'EXACT_MATCH',
      'P-28：⛔ 部署后 ONLINE_SOURCE_PARITY 必须 EXACT_MATCH');
    assert.strictEqual(state.final_state.POST_DEPLOY_UNEXPECTED_PACKAGE_DIFF, 0,
      'P-28：⛔ 部署后 UNEXPECTED_PACKAGE_DIFF 必须 0');
    assert.strictEqual(state.final_state.READY_FOR_V365_FIRST_CONTROLLED_RUN,
      'PENDING_OWNER_RUN_APPROVAL',
      'P-28：部署后首次受控运行必须等 owner 单独授权');
    // ★ 部署后 activation 状态：核心全绿时 = PENDING_OWNER_APPROVAL（等 owner 运行授权）
    //   ⛔ 不写死 —— 日志未刷新时会是 BLOCKED_GATE_INCOMPLETE（过渡态），由收口检查器强制终值
    assert.ok(['PENDING_OWNER_APPROVAL', 'BLOCKED_GATE_INCOMPLETE']
      .includes(state.final_state.READY_FOR_CONTROLLED_PRODUCTION_ACTIVATION),
      `P-28：部署后 activation 必须落在 {PENDING_OWNER_APPROVAL, BLOCKED_GATE_INCOMPLETE}，实得 ${state.final_state.READY_FOR_CONTROLLED_PRODUCTION_ACTIVATION}`);
  } else {
    // ── 部署前 ──
    assert.strictEqual(state.final_state.READY_FOR_CONTROLLED_PRODUCTION_ACTIVATION,
      'BLOCKED_ON_DEPLOYMENT_IDENTITY',
      'P-28：⛔ 部署身份未验证 ⇒ 必须是 BLOCKED_ON_DEPLOYMENT_IDENTITY（不再 PENDING_OWNER_APPROVAL）');
    assert.strictEqual(state.final_state.READY_FOR_V365_FIRST_CONTROLLED_RUN,
      'BLOCKED_ON_DEPLOYMENT_IDENTITY', 'P-28：⛔ 首次受控运行被部署身份阻塞');
    assert.strictEqual(state.final_state.CONTROLLED_DEPLOYMENT, 'NOT_EXECUTED',
      'P-28：部署前 CONTROLLED_DEPLOYMENT 必须 NOT_EXECUTED');
  }
  // ★ 恒不变式（两阶段都成立）：⛔ 运行授权永不由部署授权推导
  assert.strictEqual(state.final_state.OWNER_RUN_AUTHORIZATION, false,
    'P-28：⛔ OWNER_RUN_AUTHORIZATION 必须 false（本消息不授权 first run）');
  assert.notStrictEqual(state.final_state.READY_FOR_V365_FIRST_CONTROLLED_RUN, 'GRANTED',
    'P-28：⛔ 首次受控运行不得 GRANTED');
  assert.strictEqual(state.final_state.PROSPECTIVE_DESIGN_FINAL, 'READY_FOR_OWNER_ACTIVATION_DECISION');
  assert.strictEqual(state.final_state.OD_P_1, 'APPROVED');
  assert.strictEqual(state.final_state.OD_P_2, 'APPROVED_WITH_CORRECTION');
  assert.strictEqual(state.final_state.OD_P_3, 'NOT_YET_GRANTED');
  assert.strictEqual(state.final_state.CANDIDATE_FREEZE_DESIGN, 'COMPLETE');
  assert.strictEqual(state.gate.may_activate, false, 'P-28：⛔ 仍不得激活');
  assert.strictEqual(state.deployment_gate.may_deploy, false, 'P-28：⛔ 仍不得部署');
  // ★ C-021.2：部署授权是**一次性**的 ⇒ 已消耗后不得再次部署
  assert.strictEqual(state.deployment_gate.deployment_authorization_consumed, deployed,
    'P-28：部署授权消耗标志必须与部署事实一致');

  // ★★ C-021.1 §9：GATE-D 的 status 断言必须避免「自指」
  //    ⛔ 循环：测试套件产出 stage-all 日志 → preflight 读日志 → state json → 本测试断言 state json。
  //    其中 D-06 `all_qualification_gates_pass` 由该日志推导 ⇒ **不可**无条件断言 status。
  //    ⇒ 改断言「**facts 与 status 的一致性**」（非循环），并对日志干净时的期望值做**显式前置条件**断言。
  const dg = state.deployment_gate;
  const byId = Object.fromEntries(dg.items.map((i) => [i.id, i.ok]));
  // ① 与日志无关的身份链 + 基线项：必须全绿
  for (const id of ['D-01', 'D-02', 'D-03', 'D-04', 'D-05', 'D-07', 'D-08', 'D-09']) {
    assert.strictEqual(byId[id], true, `P-28：${id} 必须 PASS（身份链/基线项与日志无关）`);
  }
  assert.strictEqual(byId['D-10'], false, 'P-28：⛔ owner 部署授权必须尚未给出');
  // ② status 必须与 items 一致（按 §6 的 fail-closed 优先级重算）
  const coreIds = ['D-01', 'D-02', 'D-03', 'D-04', 'D-05', 'D-06', 'D-07', 'D-08', 'D-09'];
  const artifactFailed = ['D-08', 'D-09'].filter((id) => !byId[id]);
  const coreFailed = coreIds.filter((id) => !byId[id]);
  const expectedStatus = artifactFailed.length ? 'BLOCKED_ON_DEPLOYMENT_ARTIFACT'
    : coreFailed.length ? 'BLOCKED_DEPLOYMENT_GATE_INCOMPLETE'
    : 'PENDING_OWNER_DEPLOYMENT_APPROVAL';
  assert.strictEqual(dg.status, expectedStatus,
    'P-28：⛔ GATE-D status 必须与 items 逐项一致（facts ↔ status 一致性）');
  assert.strictEqual(dg.implies_first_controlled_run, false,
    'P-28：⛔ 部署门禁恒不推导运行门禁');
  // ③ 日志干净时（非循环前置条件成立）⇒ 必须精确等于 PENDING_OWNER_DEPLOYMENT_APPROVAL
  const gli = state.gate_log_integrity;
  const logsClean = !!(gli && gli.logs_fresh && gli.stage_a_log.count_matches_truth
    && gli.stage_all_log.parsed_summary && gli.stage_all_log.parsed_summary.failed === 0);
  if (logsClean) {
    assert.strictEqual(dg.status, 'PENDING_OWNER_DEPLOYMENT_APPROVAL',
      'P-28：⛔ 日志干净时部署门禁必须为 PENDING_OWNER_DEPLOYMENT_APPROVAL（只等 owner 授权）');
    assert.deepStrictEqual(dg.failed_items, ['D-10'],
      'P-28：⛔ 日志干净时唯一失败项必须是 D-10（owner 部署授权）');
  } else {
    // ⛔ 日志尚未刷新（中间态）：不得静默跳过 —— 但真正的不变式是「**不得可部署**」。
    //    允许的状态：BLOCKED_ON_DEPLOYMENT_ARTIFACT / BLOCKED_DEPLOYMENT_GATE_INCOMPLETE /
    //               PENDING_OWNER_DEPLOYMENT_APPROVAL（D-06 已过、只差 owner 授权）
    //    ⛔ 唯一绝对禁止：GRANTED（= 未经 owner 授权即可部署）
    assert.notStrictEqual(dg.status, 'GRANTED',
      'P-28：⛔ 任何情况下都不得 GRANTED（未获 owner 部署授权）');
    assert.ok(['BLOCKED_ON_DEPLOYMENT_ARTIFACT', 'BLOCKED_DEPLOYMENT_GATE_INCOMPLETE',
      'PENDING_OWNER_DEPLOYMENT_APPROVAL'].includes(dg.status),
      `P-28：状态必须落在允许集合内，实得 ${dg.status}`);
  }

  assert.strictEqual(state.deployment_gate.implies_first_controlled_run, false,
    'P-28：⛔ 部署门禁不得蕴含运行授权');
  assert.strictEqual(state.production_run_triggered, false, 'P-28：⛔ 未触发生产 run');
  assert.strictEqual(state.production_write_performed, false, 'P-28：⛔ 无生产写入');
  assert.strictEqual(state.pointer_initialized, false, 'P-28：⛔ 未初始化 pointer');
}

/* ---------------- P-29 ★ §1/§2 状态件含修正后的 authority 与两层 anchor ---------------- */
{
  const state = JSON.parse(fs.readFileSync(path.join(REPO,
    'deliverables/v365-production-history/prospective/prospective-state.json'), 'utf8'));
  const ab = state.prospective.actual_book_authority;
  assert.strictEqual(ab.execution_authority, 'trade_log');
  assert.strictEqual(ab.actual_position_book_authority, 'portfolio_snapshot.positions[].position');
  assert.strictEqual(ab.run_candidate_portfolio_may_qualify_actual_book, false);

  const an = state.prospective.anchors;
  assert.strictEqual(an.result_sequence_sha.standalone_forbidden, true, 'P-29：sha 禁止单独使用');
  assert.ok(an.prospective_qualification_anchor.required_bindings.length >= 12, 'P-29：锚须 ≥12 绑定');
  assert.ok(/same qualification anchor/.test(an.invariant), 'P-29：须登记 anchor 不变量');

  // ⛔ 状态件不得再声明 run_candidate_portfolio 为 actual book
  const raw = fs.readFileSync(path.join(REPO,
    'deliverables/v365-production-history/prospective/prospective-state.json'), 'utf8');
  assert.ok(!/actual_book_source":\s*"run_candidate_portfolio/.test(raw),
    'P-29：⛔ 状态件不得再以 run_candidate_portfolio 作 actual_book_source');
}

/* ---------------- P-30 ★ §3 恢复协议已登记在状态件 ---------------- */
{
  const state = JSON.parse(fs.readFileSync(path.join(REPO,
    'deliverables/v365-production-history/prospective/prospective-state.json'), 'utf8'));
  const rp = state.prospective.recovery_protocol;
  assert.ok(rp, 'P-30：须登记 recovery_protocol');
  assert.strictEqual(rp.cas_rejected.state, 'CAS_REJECTED');
  assert.strictEqual(rp.cas_rejected.switch_date, null);
  assert.strictEqual(rp.promoted_history_incomplete.state, 'PROMOTED_HISTORY_INCOMPLETE');
  assert.strictEqual(rp.promoted_history_incomplete.must_not_claim_pointer_not_written, true);
  assert.strictEqual(rp.promoted_history_incomplete.auto_pointer_rollback_forbidden, true,
    'P-30：⛔ 禁止自动回滚 pointer');
  assert.ok(rp.od_2_frozen_sequence.join('→').includes('run_history append'),
    'P-30：须保持冻结 OD-2 时序');
}

/* ---------------- P-31 ★ §2 anchor 字段名不得回退为单一 sha ---------------- */
{
  const gateSrc = fs.readFileSync(path.join(REPO, 'scripts/lib/v365-prospective-gate.js'), 'utf8');
  assert.ok(/PROSPECTIVE_QUALIFICATION_ANCHOR/.test(gateSrc), 'P-31：须实现 PROSPECTIVE_QUALIFICATION_ANCHOR');
  assert.ok(/ANCHOR_BINDINGS/.test(gateSrc), 'P-31：须有绑定清单');
  // ⛔ 不得把 RESULT_SEQUENCE_SHA 当作 anchor 常量名导出
  assert.ok(!/RESULT_SEQUENCE_SHA\s*=/.test(gateSrc),
    'P-31：⛔ 不得以 RESULT_SEQUENCE_SHA 作为独立 qualification anchor 常量');
}

/* ================================================================
 * ★ C-021（owner §2~§10）：DEPLOYMENT IDENTITY & CANDIDATE FREEZE
 * ================================================================ */

/* ---------------- P-32 ★ §2 生产部署基线审计证据件必须存在且零漂移 ---------------- */
{
  const audit = JSON.parse(fs.readFileSync(path.join(REPO,
    'deliverables/v365-production-history/c021/deployment-identity-audit.json'), 'utf8'));

  // ⛔ 不得假设线上已是 V3.6.5；必须实测
  assert.strictEqual(audit.read_only, true, 'P-32：审计必须为只读');
  assert.strictEqual(audit.deployment_performed, false, 'P-32：⛔ 不得有任何部署动作');
  assert.strictEqual(audit.production_writes_performed, false, 'P-32：⛔ 审计为只读，无生产写入');
  assert.strictEqual(audit.verdict.production_baseline_verified, true,
    'P-32：线上必须与台账 D-006 基线一致');
  assert.strictEqual(audit.verdict.ledger_baseline_matches_online, true);
  assert.strictEqual(audit.verdict.checks.online_source_parity, 'EXACT_MATCH',
    'P-32：逐文件 parity 必须 EXACT_MATCH');
  assert.strictEqual(audit.online_source_parity.diff_count, 0, 'P-32：⛔ 包差异必须为 0');
  assert.strictEqual(audit.online_source_parity.parity, 'EXACT_MATCH');
  assert.strictEqual(audit.verdict.stop, null,
    'P-32：零漂移 ⇒ 不得 STOP（若漂移应为 PRODUCTION_DEPLOYMENT_DRIFT）');
  assert.strictEqual(audit.online_source_parity.frozen_commit,
    'aa634e264270f26207c59c19ef3e1c31dde01e64',
    'P-32：线上源码 commit 必须为 V3.6.4 冻结 commit');
  // ★ 关键区分：current production identity ≠ 本轮 candidate → 正是本轮缺口
  assert.strictEqual(audit.verdict.deployment_identity_verified, false,
    'P-32：⛔ 线上 = V3.6.4，**尚未**是 V3.6.5 candidate ⇒ deployment_identity_verified 必须 false');
  assert.strictEqual(audit.observed.FunctionId, 'lam-eiye285p', 'P-32：FunctionId 必须登记');
  assert.strictEqual(audit.observed.ModTime, '2026-09-22 16:29:48',
    'P-32：ModTime 必须等于台账 D-006（证明线上自 V3.6.4 部署后未变）');
  assert.strictEqual(audit.observed.CodeSize, 4013498, 'P-32：CodeSize 必须等于台账 D-006');
}

/* ---------------- P-33 ★ §3/§4/§6 部署范围闭包 / 候选冻结 / 回滚件 三件一致 ---------------- */
{
  const c021 = (f) => JSON.parse(fs.readFileSync(
    path.join(REPO, 'deliverables/v365-production-history/c021', f), 'utf8'));
  const scope = c021('deployment-scope.json');
  const manifest = c021('deployment-candidate-manifest.json');
  const rollback = c021('rollback-artifact.json');
  const audit = c021('deployment-identity-audit.json');
  const auditFrozenCommit = () => audit.online_source_parity.frozen_commit;

  /* ① §3 部署范围必须精确 —— ⛔ 不得因 worktree 有 74 个变更就全量部署 */
  assert.strictEqual(scope.verdict.V365_DEPLOYMENT_SCOPE, 'EXACT',
    'P-33：部署范围必须判定为 EXACT');
  assert.strictEqual(scope.verdict.deploy_all_74_changed_files, false,
    'P-33：⛔ 明确禁止全量部署 74 个变更');
  assert.strictEqual(scope.closure_summary.changed_total, 76,
    'P-33：worktree 变更总数登记为 76（`-uall` 展开；对照用）');
  // ⛔ 关键判据：**改动**文件中只有 7 件进包 —— 这才是「不得全量部署」的真实含义
  assert.strictEqual(scope.closure_summary.changed_in_closure_count, 7,
    'P-33：⛔ 真正进包的**改动**文件必须恰为 7（杜绝「74/76 全量部署」）');
  assert.ok(scope.closure_summary.changed_in_closure_count
    < scope.closure_summary.changed_total,
    'P-33：⛔ 进包改动数必须远小于 worktree 变更数');
  assert.strictEqual(scope.closure_summary.required_file_count, 91,
    'P-33：部署闭包必须恰为 91 个文件');
  assert.strictEqual(scope.closure_summary.changed_outside_closure_count, 69,
    'P-33：不进包改动文件必须恰为 69');
  assert.strictEqual(scope.red_line_checks.materializeIndicators_touched, false,
    'P-33：⛔ materializeIndicators 必须零触碰（不得修改/部署）');
  assert.strictEqual(scope.red_line_checks.materializeIndicators_in_closure, false,
    'P-33：⛔ materializeIndicators 不得进入部署闭包');
  assert.deepStrictEqual(scope.red_line_checks.calibration_files_touched_in_closure, [],
    'P-33：⛔ 部署闭包内不得含任何被改动的 CALC 冻结文件');
  // 闭包必须显式分成三段：函数自身源码 / canonical common / extra frozen artifacts
  assert.strictEqual(scope.closure_parts.function_own_source.count, 2,
    'P-33：函数自身源码必须恰为 2 件（index.js + package.json）');
  assert.strictEqual(scope.closure_parts.canonical_common.count, 87,
    'P-33：canonical common 必须恰为 87 件');
  assert.strictEqual(scope.closure_parts.extra_frozen_artifacts.count, 2,
    'P-33：extra frozen artifacts 必须恰为 2 件');
  assert.ok(scope.V365_DEPLOYMENT_EXCLUDED_FILES.length > 0, 'P-33：必须显式登记排除件');

  /* ② §4 候选冻结：同一 manifest ⇒ 同一源码字节 */
  assert.strictEqual(manifest.deployed, false, 'P-33：⛔ manifest 生成期间无部署');
  assert.strictEqual(manifest.mutable_working_tree_deploy_forbidden, true,
    'P-33：⛔ 必须显式禁止直接从 mutable working tree 部署');
  assert.strictEqual(manifest.base_head_sha, 'c6bd006fd76ffc5358cddd07347df8ed23d9e61d',
    'P-33：base HEAD 必须登记');
  assert.strictEqual(manifest.candidate_manifest_sha,
    '8c53f93fa66bbc2768f23843530f3997e2c9d38030e58b65c2bc0d7497c501c1',
    'P-33：candidate_manifest_sha 必须与冻结值一致');
  for (const k of ['candidate_content_sha', 'production_code_sha', 'common_closure_sha',
    'extra_artifacts_sha', 'dependency_closure_sha', 'expected_runtime', 'expected_handler',
    'build_method', 'build_tool_versions']) {
    assert.ok(manifest[k] != null && manifest[k] !== '',
      `P-33：candidate manifest 必须绑定 ${k}`);
  }
  assert.strictEqual(manifest.expected_runtime, 'Nodejs16.13', 'P-33：runtime 必须登记');
  assert.strictEqual(manifest.expected_handler, 'index.main', 'P-33：handler 必须登记');
  assert.ok(/same deployment_candidate_manifest_sha/.test(manifest.invariant),
    'P-33：必须登记不变量「同一 manifest sha ⇒ 同一源码字节」');
  // 逐文件 sha256 必须齐备
  assert.strictEqual(manifest.deployment_required_files.length, 91,
    'P-33：manifest 必须逐文件登记 91 件');
  assert.strictEqual(manifest.deployment_required_files.length,
    scope.closure_summary.required_file_count,
    'P-33：manifest 逐文件哈希数必须等于部署闭包大小');
  assert.ok(manifest.deployment_required_files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256)),
    'P-33：每个进包文件必须有合法 sha256');
  assert.strictEqual(manifest.excluded_files_count, 69, 'P-33：排除件数必须登记为 69');
  assert.strictEqual(manifest.candidate_content_sha, manifest.dependency_closure_sha,
    'P-33：candidate_content_sha 必须等于闭包 sha（同源）');

  /* ③ §6 回滚件必须**独立验证**（⛔ 非仅存下载链接） */
  assert.strictEqual(rollback.independently_verified, true,
    'P-33：⛔ 回滚件必须独立验证通过（下载 + 本地复算双 SHA == 台账）');
  assert.ok(rollback.binding.package_sha256 || rollback.ledger_baseline.package_sha256,
    'P-33：回滚件必须绑定 package_sha256');
  assert.ok(rollback.binding.function_metadata, 'P-33：回滚件必须绑定 function metadata');
  assert.strictEqual(rollback.binding.index_sha256_lf,
    rollback.ledger_baseline.index_sha256_lf_expected,
    'P-33：本地复算 index.js LF sha 必须等于台账记录值');
  assert.strictEqual(rollback.binding.index_sha256_raw,
    rollback.ledger_baseline.index_sha256_raw_expected,
    'P-33：本地复算 index.js raw sha 必须等于台账记录值');
  assert.strictEqual(rollback.deployed, false, 'P-33：⛔ 回滚件为 dry-run，无部署');
  assert.strictEqual(rollback.read_only, true, 'P-33：⛔ 回滚件为只读');

  /* ④ 三件互相一致：范围件与 manifest 的闭包 sha 必须一致（跨件逐项一致断言） */
  assert.strictEqual(scope.dependency_closure_sha, manifest.dependency_closure_sha,
    'P-33：⛔ 跨件一致：deployment-scope 与 candidate-manifest 的闭包 sha 必须相同');
  assert.strictEqual(scope.dependency_closure_sha, manifest.candidate_content_sha,
    'P-33：⛔ 跨件一致：闭包 sha == candidate_content_sha');
  assert.strictEqual(scope.V365_DEPLOYMENT_REQUIRED_FILES.length,
    manifest.deployment_required_files.length,
    'P-33：⛔ 跨件一致：两件的进包文件数必须相同');
  // 逐路径集合必须完全相同（不只是数量）
  const scopeSet = [...scope.V365_DEPLOYMENT_REQUIRED_FILES].sort();
  const manifestSet = manifest.deployment_required_files.map((f) => f.path).sort();
  assert.deepStrictEqual(manifestSet, scopeSet,
    'P-33：⛔ 跨件一致：进包**路径集合**必须完全相同');
  // 回滚件所指 = 当前线上件 = 冻结 V3.6.4（≠ 本轮 candidate）
  assert.strictEqual(rollback.ledger_baseline.frozen_source_commit,
    auditFrozenCommit(manifest),
    'P-33：回滚件与 manifest 必须指向同一冻结 commit');
}

/* ---------------- P-34 ★ §12 ⛔ prospective 测试不得残留 vacuous assertion ---------------- */
{
  const self = fs.readFileSync(path.join(REPO,
    'tests/v365-prospective-qualification.test.js'), 'utf8');
  const code = self
    .replace(/\/\*[\s\S]*?\*\//g, '')          // 去块注释
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');     // 去行注释

  // ★ 断言模式由碎片拼装 —— 避免「检查器自身的字面量」被自己当成违规（自指陷阱）
  const reOkTrue = new RegExp(['assert', '\\.ok\\(\\s*true\\b'].join(''));
  const reAssertTrue = new RegExp(['assert', '\\(\\s*true\\s*\\)'].join(''));
  const OR_TRUE = ['|', '|', ' ', 'true'].join('');
  const reOrTrue = new RegExp(OR_TRUE.replace(/[|]/g, '\\|'));

  assert.ok(!reOrTrue.test(code),
    'P-34：⛔ 不得残留永真 OR-true vacuous assertion（C-021 §12）');
  assert.ok(!reOkTrue.test(code), 'P-34：⛔ 不得残留「恒定真值」ok 断言');
  assert.ok(!reAssertTrue.test(code), 'P-34：⛔ 不得残留「恒定真值」断言');

  // 并且必须真实覆盖 C-021 新增判据
  for (const t of ['BLOCKED_ON_DEPLOYMENT_IDENTITY', 'deployment_identity_verified',
    'owner_run_authorization', 'evaluateDeploymentGate', 'evaluatePostDeployIdentity',
    'candidate_source_frozen', 'rollback_artifact_verified']) {
    assert.ok(code.includes(t), `P-34：必须覆盖 C-021 判据 ${t}`);
  }
}

/* ============================================================
 * ★ C-021.1 §1~§10 —— PRE_DEPLOY_ARTIFACT_MATERIALIZATION
 * ============================================================ */
const C021_DIR = path.join(REPO, 'deliverables', 'v365-production-history', 'c021');
function readC021(name) {
  const p = path.join(C021_DIR, name);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

const deploymentArtifact = readC021('deployment-artifact.json');
const preDeployDiff = readC021('pre-deploy-package-diff.json');
const rollbackBinding = readC021('deployment-rollback-binding.json');
const candidateManifest = readC021('deployment-candidate-manifest.json');

const BUNDLE_SHA_RE = /^[0-9a-f]{64}$/;

/* ---------------- P-35 ★ §2 deployment artifact identity ---------------- */
{
  assert.ok(deploymentArtifact, 'P-35：deployment-artifact.json 必须存在');
  const a = deploymentArtifact;

  // 只读 + 未部署（⛔ 本轮不得 deploy）
  assert.strictEqual(a.read_only_source, true, 'P-35：artifact 必须标记 read_only_source');
  assert.strictEqual(a.deployed, false, 'P-35：⛔ 不得 deploy');
  assert.strictEqual(a.production_writes_performed, false, 'P-35：⛔ 不得写生产');
  assert.strictEqual(a.deployment_performed, false, 'P-35：⛔ 不得执行部署');
  assert.strictEqual(a.production_run_performed, false, 'P-35：⛔ 不得执行 production run');

  // bundle identity
  assert.ok(BUNDLE_SHA_RE.test(a.bundle_sha256), 'P-35：bundle_sha256 必须是 64 位 hex');
  assert.ok(BUNDLE_SHA_RE.test(a.bundle_content_manifest_sha),
    'P-35：bundle_content_manifest_sha 必须是 64 位 hex');
  assert.ok(a.bundle_size > 0, 'P-35：bundle_size 必须 > 0');
  assert.ok(/\.tar$/.test(a.bundle_path), 'P-35：bundle 必须是 .tar（确定性格式）');
  assert.ok(/ustar-deterministic/.test(a.bundle_format),
    'P-35：bundle 必须是确定性 ustar（mtime/uid/gid/mode 固定）');
  assert.ok(a.created_at && !Number.isNaN(Date.parse(a.created_at)), 'P-35：created_at 必须可解析');

  // 继承 C-021 §4 的 source-side identity（⛔ 必须逐位一致）
  assert.strictEqual(a.candidate_manifest_sha, candidateManifest.candidate_manifest_sha,
    'P-35：candidate_manifest_sha 必须继承 C-021 §4 值');
  assert.strictEqual(a.candidate_content_sha, candidateManifest.candidate_content_sha,
    'P-35：candidate_content_sha 必须继承');
  assert.strictEqual(a.dependency_closure_sha, candidateManifest.dependency_closure_sha,
    'P-35：dependency_closure_sha 必须继承');
  assert.strictEqual(a.production_code_sha, candidateManifest.production_code_sha,
    'P-35：production_code_sha 必须继承');

  // runtime contract
  assert.strictEqual(a.runtime, candidateManifest.expected_runtime, 'P-35：runtime 必须一致');
  assert.strictEqual(a.handler, candidateManifest.expected_handler, 'P-35：handler 必须一致');
  assert.strictEqual(a.build_method, candidateManifest.build_method, 'P-35：build_method 必须一致');
  assert.deepStrictEqual(a.build_tool_versions, candidateManifest.build_tool_versions,
    'P-35：build_tool_versions 必须一致');

  // 文件清单
  assert.strictEqual(a.required_file_count, 91, 'P-35：必须进包 91 个文件');
  assert.strictEqual(a.required_files.length, 91, 'P-35：required_files 必须逐条列出');
  for (const f of a.required_files) {
    assert.ok(f.path && BUNDLE_SHA_RE.test(f.sha256) && f.bytes > 0,
      `P-35：required_files 条目必须完整（${JSON.stringify(f).slice(0, 80)}）`);
  }

  // 不变量
  assert.ok(/same deployment_bundle_sha256/.test(a.invariant),
    'P-35：必须声明 same deployment_bundle_sha256 ⇒ same deployable bytes');
  assert.strictEqual(a.mutable_working_tree_deploy_forbidden, true,
    'P-35：⛔ 必须声明禁止从 mutable working tree 部署');
}

/* ---------------- P-36 ★ §1 source verification（⛔ 不得漂移） ---------------- */
{
  const sv = deploymentArtifact.source_verification;
  assert.ok(sv, 'P-36：source_verification 必须存在');
  assert.strictEqual(sv.drift_count, 0, 'P-36：⛔ 源码不得漂移（否则 STOP = CANDIDATE_SOURCE_DRIFT）');
  assert.strictEqual(sv.verified_ok, 91, 'P-36：91/91 逐文件 sha 必须全部匹配 manifest');
  assert.strictEqual(sv.required_count, 91, 'P-36：required 必须为 91');
  assert.strictEqual(sv.scope_manifest_set_equal, true,
    'P-36：scope 与 manifest 的 required 集合必须 SET_EQUAL');
  assert.deepStrictEqual(sv.drift, [], 'P-36：drift 明细必须为空');

  // ★ 逐文件独立重算：current sha == manifest expected sha（⛔ 不信 artifact 自述）
  const manifest = candidateManifest;
  for (const e of manifest.deployment_required_files) {
    const full = path.join(REPO, e.path);
    assert.ok(fs.existsSync(full), `P-36：required 文件必须存在：${e.path}`);
    const h = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
    assert.strictEqual(h, e.sha256,
      `P-36：⛔ 逐文件 sha 必须匹配 manifest（${e.path}）`);
  }
}

/* ---------------- P-37 ★ §3 bundle 独立复核（BUNDLE_SOURCE_PARITY） ---------------- */
{
  const iv = deploymentArtifact.independent_verification;
  assert.ok(iv, 'P-37：independent_verification 必须存在');
  assert.strictEqual(iv.reused_build_memory, false,
    'P-37：⛔ 独立复核不得复用 build 阶段内存数据');
  assert.strictEqual(iv.bundle_source_parity, 'EXACT_MATCH',
    'P-37：BUNDLE_SOURCE_PARITY 必须为 EXACT_MATCH');
  assert.strictEqual(iv.missing_required_file, 0, 'P-37：MISSING_REQUIRED_FILE 必须为 0');
  assert.strictEqual(iv.unexpected_file, 0, 'P-37：UNEXPECTED_FILE 必须为 0');
  assert.strictEqual(iv.content_diff, 0, 'P-37：CONTENT_DIFF 必须为 0');
  assert.deepStrictEqual(iv.content_diff_items, [], 'P-37：content diff 明细必须为空');
  assert.strictEqual(iv.totals.expected_files, 91, 'P-37：期望文件数必须为 91');
  assert.strictEqual(iv.totals.parsed_files, 91, 'P-37：解包文件数必须为 91');
  assert.deepStrictEqual(iv.online_irrelevant_artifact_files, [],
    'P-37：ONLINE_IRRELEVANT_ARTIFACT_DIFF 必须为空（按冻结 ignore policy）');

  // ★ 独立复算：从磁盘重读 bundle 字节并重算 sha（⛔ 不信 artifact 自述）
  const bundleBytes = fs.readFileSync(deploymentArtifact.bundle_path);
  const recomputed = crypto.createHash('sha256').update(bundleBytes).digest('hex');
  assert.strictEqual(recomputed, deploymentArtifact.bundle_sha256,
    'P-37：⛔ bundle 字节重算 sha 必须等于声明的 bundle_sha256');

  // index.js 双 SHA 必须与线上 V3.6.4 基线不同（证明确实是新 candidate）
  assert.ok(iv.index_sha256_raw && BUNDLE_SHA_RE.test(iv.index_sha256_raw),
    'P-37：必须记录 bundle 内 index.js raw sha');
  assert.ok(iv.index_sha256_lf && BUNDLE_SHA_RE.test(iv.index_sha256_lf),
    'P-37：必须记录 bundle 内 index.js LF sha');
  assert.notStrictEqual(iv.index_sha256_lf,
    '77f7d50042cee0a9a7e5f84c7769dd95de92f8091b7547307b6f325f8fe01529',
    'P-37：⛔ 新 bundle 的 index.js 不得等于线上 V3.6.4 的 index.js（否则等于没变）');
}

/* ---------------- P-38 ★ §4 pre-deploy package diff ---------------- */
{
  assert.ok(preDeployDiff, 'P-38：pre-deploy-package-diff.json 必须存在');
  const d = preDeployDiff;
  assert.strictEqual(d.read_only, true, 'P-38：diff 必须只读');
  assert.strictEqual(d.deployed, false, 'P-38：⛔ 不得 deploy');
  assert.strictEqual(d.production_writes_performed, false, 'P-38：⛔ 不得写生产');

  // PREVIOUS 必须是已独立验证的线上 V3.6.4
  assert.ok(/V3\.6\.4/.test(d.previous.identity),
    'P-38：PREVIOUS 必须是 CURRENT_PRODUCTION_DEPLOYMENT_IDENTITY = V3.6.4');
  assert.strictEqual(d.previous.frozen_source_commit,
    'aa634e264270f26207c59c19ef3e1c31dde01e64',
    'P-38：PREVIOUS 冻结 commit 必须为 aa634e2');

  // 核心要求
  assert.strictEqual(d.unexpected_package_diff, 0, 'P-38：⛔ UNEXPECTED_PACKAGE_DIFF 必须为 0');
  assert.deepStrictEqual(d.unexpected_details, [], 'P-38：unexpected 明细必须为空');

  // 分类计数
  const c = d.diff.counts;
  assert.strictEqual(c.added, 15, 'P-38：added 必须为 15');
  assert.strictEqual(c.modified, 4, 'P-38：modified 必须为 4');
  assert.strictEqual(c.deleted, 0, 'P-38：⛔ deleted 必须为 0（不得删文件）');
  assert.strictEqual(c.unchanged, 72, 'P-38：unchanged 必须为 72');
  assert.strictEqual(c.added + c.modified + c.deleted + c.unchanged, 91,
    'P-38：四类之和必须等于进包文件数 91');

  // 红线三项
  const rl = d.red_line_checks;
  assert.strictEqual(rl.materializeIndicators_changed, false,
    'P-38：⛔ materializeIndicators changed 必须为 false');
  assert.strictEqual(rl.param_config_semantic_change, false,
    'P-38：⛔ param_config semantic change 必须为 false');
  assert.strictEqual(rl.protected_calc_unexpected_change, false,
    'P-38：⛔ protected CALC files unexpected change 必须为 false');
  assert.deepStrictEqual(rl.protected_calc_files_changed, [],
    'P-38：protected CALC 改动明细必须为空');

  // 交叉验证：bundle delta == 源码 delta（逐项 SET_EQUAL）
  const cv = d.cross_validation.bundle_delta_vs_source_delta;
  assert.strictEqual(cv.added_set_equal, true, 'P-38：added 集合必须与源码 delta 一致');
  assert.strictEqual(cv.modified_set_equal, true, 'P-38：modified 集合必须与源码 delta 一致');
  assert.strictEqual(cv.deleted_set_equal, true, 'P-38：deleted 集合必须与源码 delta 一致');
  assert.strictEqual(d.cross_validation.bundle_vs_candidate_manifest.mismatch, 0,
    'P-38：bundle 内容与 candidate manifest 必须零不一致');

  // ★ 计数对账：19 = 7 working-tree + 12 committed-since-aa634e2（包含关系，非矛盾）
  const wt = d.cross_validation.c021_working_tree_closure;
  assert.strictEqual(wt.working_tree_closure_count, 7,
    'P-38：C-021 §3 的 working-tree 闭包必须为 7');
  assert.strictEqual(wt.is_subset_of_delta, true,
    'P-38：⛔ working-tree 闭包必须是本 delta 的子集');
  assert.strictEqual(wt.committed_delta_count, 12,
    'P-38：aa634e2→HEAD 的已提交闭包内变更必须为 12');
  assert.strictEqual(wt.working_tree_closure_count + wt.committed_delta_count, 19,
    'P-38：7 + 12 必须等于 19（对账成立）');
}

/* ---------------- P-39 ★ §5 deployment rollback binding ---------------- */
{
  assert.ok(rollbackBinding, 'P-39：deployment-rollback-binding.json 必须存在');
  const b = rollbackBinding;
  assert.strictEqual(b.read_only, true, 'P-39：binding 必须只读');
  assert.strictEqual(b.deployed, false, 'P-39：⛔ 不得 deploy');
  assert.strictEqual(b.production_writes_performed, false, 'P-39：⛔ 不得写生产');

  // 六项必需绑定
  assert.ok(BUNDLE_SHA_RE.test(b.previous.package_sha256),
    'P-39：previous_package_sha 必须是 64 位 hex');
  assert.strictEqual(b.previous.package_sha256,
    'aa576c20599528a66737f154b31b8cca87f25c1cf50068093bc243ed7084caea',
    'P-39：previous_package_sha 必须为线上 V3.6.4 台账值');
  assert.ok(b.previous.runtime, 'P-39：previous_runtime 必须存在');
  assert.ok(b.previous.handler, 'P-39：previous_handler 必须存在');
  assert.ok(BUNDLE_SHA_RE.test(b.new.bundle_sha256), 'P-39：new_bundle_sha 必须是 64 位 hex');
  assert.ok(BUNDLE_SHA_RE.test(b.new.candidate_manifest_sha),
    'P-39：new_candidate_manifest_sha 必须是 64 位 hex');
  assert.ok(BUNDLE_SHA_RE.test(b.rollback_artifact_sha),
    'P-39：rollback_artifact_sha 必须是 64 位 hex');

  // ★ PREVIOUS 与 NEW 必须同处一个 plan，且 sha 必须不同（否则回滚无意义）
  assert.notStrictEqual(b.previous.package_sha256, b.new.bundle_sha256,
    'P-39：⛔ previous 与 new 的 sha 不得相同');

  // new 侧必须等于本轮 bundle（跨件一致）
  assert.strictEqual(b.new.bundle_sha256, deploymentArtifact.bundle_sha256,
    'P-39：new_bundle_sha 必须等于 deployment-artifact 的 bundle_sha256');
  assert.strictEqual(b.new.candidate_manifest_sha, candidateManifest.candidate_manifest_sha,
    'P-39：new_candidate_manifest_sha 必须等于 candidate manifest sha');

  // 回滚件独立验证 + 双 SHA 匹配台账
  assert.strictEqual(b.rollback_artifact_independently_verified, true,
    'P-39：回滚件必须 independently_verified');
  assert.strictEqual(b.previous.index_sha256_matches_ledger.raw, true,
    'P-39：rollback index.js raw sha 必须匹配台账 D-006');
  assert.strictEqual(b.previous.index_sha256_matches_ledger.lf, true,
    'P-39：rollback index.js LF sha 必须匹配台账 D-006');

  // 一致性断言
  assert.strictEqual(b.consistency.previous_runtime_equals_new_runtime, true,
    'P-39：previous/new runtime 必须一致');
  assert.strictEqual(b.consistency.previous_handler_equals_new_handler, true,
    'P-39：previous/new handler 必须一致');
  assert.strictEqual(b.consistency.rollback_bundle_parity, 'EXACT_MATCH',
    'P-39：rollback bundle 独立复核必须 EXACT_MATCH');
  assert.strictEqual(b.consistency.rollback_index_matches_ledger, true,
    'P-39：rollback index.js 必须匹配台账');
}

/* ---------------- P-40 ★ §6 GATE-D D-08/D-09/D-10 + BLOCKED_ON_DEPLOYMENT_ARTIFACT ---------------- */
{
  const G = require('../scripts/lib/v365-prospective-gate.js');

  // 判据清单必须含 D-08/D-09/D-10（顺序：artifact 在前，owner 授权在后）
  const ids = G.DEPLOYMENT_GATE_ITEMS.map((x) => x.id);
  assert.deepStrictEqual(ids, ['D-01', 'D-02', 'D-03', 'D-04', 'D-05', 'D-06',
    'D-07', 'D-08', 'D-09', 'D-10'], 'P-40：GATE-D 必须为 D-01~D-10');
  assert.strictEqual(G.DEPLOYMENT_GATE_ITEMS.find((x) => x.id === 'D-08').key,
    'deployment_artifact_materialized', 'P-40：D-08 必须为 deployment_artifact_materialized');
  assert.strictEqual(G.DEPLOYMENT_GATE_ITEMS.find((x) => x.id === 'D-09').key,
    'deployment_artifact_exact_match', 'P-40：D-09 必须为 deployment_artifact_exact_match');
  assert.strictEqual(G.DEPLOYMENT_GATE_ITEMS.find((x) => x.id === 'D-10').key,
    'owner_deployment_authorization', 'P-40：D-10 必须为 owner_deployment_authorization');
  assert.deepStrictEqual(G.DEPLOYMENT_ARTIFACT_ITEMS, ['D-08', 'D-09'],
    'P-40：artifact 判据集合必须为 D-08/D-09');

  const allCore = {
    candidate_source_frozen: true, deployment_manifest_frozen: true,
    deployment_scope_exact: true, current_production_baseline_verified: true,
    rollback_artifact_verified: true, all_qualification_gates_pass: true,
    protected_domain_clean: true, deployment_artifact_materialized: true,
    deployment_artifact_exact_match: true
  };

  // ① bundle 未物化 ⇒ BLOCKED_ON_DEPLOYMENT_ARTIFACT（★ 关键 fail-closed 分支）
  const g1 = G.evaluateDeploymentGate({ ...allCore, deployment_artifact_materialized: false });
  assert.strictEqual(g1.gate_status, 'BLOCKED_ON_DEPLOYMENT_ARTIFACT',
    'P-40：⛔ D-08 FAIL ⇒ BLOCKED_ON_DEPLOYMENT_ARTIFACT');
  assert.strictEqual(g1.may_deploy, false, 'P-40：⛔ 不得 deploy');
  assert.deepStrictEqual(g1.failed_items, ['D-08', 'D-10'],
    'P-40：失败项必须含 D-08');

  // ①′ parity 未 exact match ⇒ 同样 BLOCKED_ON_DEPLOYMENT_ARTIFACT
  const g1b = G.evaluateDeploymentGate({ ...allCore, deployment_artifact_exact_match: false });
  assert.strictEqual(g1b.gate_status, 'BLOCKED_ON_DEPLOYMENT_ARTIFACT',
    'P-40：⛔ D-09 FAIL ⇒ BLOCKED_ON_DEPLOYMENT_ARTIFACT');

  // ①″ 即使 owner 已授权，artifact 未完成也**不得**放行
  const g1c = G.evaluateDeploymentGate({
    ...allCore, deployment_artifact_materialized: false, owner_deployment_authorization: true
  });
  assert.strictEqual(g1c.gate_status, 'BLOCKED_ON_DEPLOYMENT_ARTIFACT',
    'P-40：⛔ owner 授权**不能**越过 artifact fail-closed');
  assert.strictEqual(g1c.may_deploy, false, 'P-40：⛔ 仍不得 deploy');

  // ② 其它核心项缺 ⇒ BLOCKED_DEPLOYMENT_GATE_INCOMPLETE
  const g2 = G.evaluateDeploymentGate({ ...allCore, deployment_scope_exact: false });
  assert.strictEqual(g2.gate_status, 'BLOCKED_DEPLOYMENT_GATE_INCOMPLETE',
    'P-40：非 artifact 核心项缺 ⇒ BLOCKED_DEPLOYMENT_GATE_INCOMPLETE');

  // ③ artifact 全绿 + owner 未授权 ⇒ PENDING_OWNER_DEPLOYMENT_APPROVAL（语义收紧）
  const g3 = G.evaluateDeploymentGate({ ...allCore });
  assert.strictEqual(g3.gate_status, 'PENDING_OWNER_DEPLOYMENT_APPROVAL',
    'P-40：artifact 全绿 + owner 未授权 ⇒ PENDING_OWNER_DEPLOYMENT_APPROVAL');
  assert.strictEqual(g3.may_deploy, false, 'P-40：⛔ 不得 deploy');
  assert.strictEqual(g3.deployment_artifact_materialized, true,
    'P-40：该状态下 deployment_artifact_materialized 必须为 true');
  assert.ok(/已存在.*bundle/.test(g3.pending_semantics || ''),
    'P-40：★ PENDING 语义必须说明「已存在具体、不可变、SHA 唯一标识的 bundle」');
  assert.strictEqual(g3.implies_first_controlled_run, false,
    'P-40：⛔ 部署门禁恒不推导运行门禁');

  // ④ 全绿 ⇒ GRANTED
  const g4 = G.evaluateDeploymentGate({ ...allCore, owner_deployment_authorization: true });
  assert.strictEqual(g4.gate_status, 'GRANTED', 'P-40：全绿 ⇒ GRANTED');
  assert.strictEqual(g4.may_deploy, true, 'P-40：GRANTED 才 may_deploy');
  assert.strictEqual(g4.implies_first_controlled_run, false,
    'P-40：⛔ 即使 GRANTED 也不推导运行授权');

  // 状态常量必须存在
  assert.strictEqual(G.GATE_STATUS.BLOCKED_ON_DEPLOYMENT_ARTIFACT,
    'BLOCKED_ON_DEPLOYMENT_ARTIFACT', 'P-40：必须定义 BLOCKED_ON_DEPLOYMENT_ARTIFACT');
}

/* ---------------- P-41 ★ §7 owner 部署授权必须绑定 bundle（三层 identity） ---------------- */
{
  const G = require('../scripts/lib/v365-prospective-gate.js');
  assert.deepStrictEqual(G.DEPLOYMENT_AUTHORIZATION_BINDING_FIELDS,
    ['base_head_sha', 'candidate_manifest_sha', 'deployment_bundle_sha',
      'production_env', 'function_name'],
    'P-41：授权必须绑定五元组（三层 identity + env + function）');

  const expected = {
    base_head_sha: 'c6bd006fd76ffc5358cddd07347df8ed23d9e61d',
    candidate_manifest_sha: candidateManifest.candidate_manifest_sha,
    deployment_bundle_sha: deploymentArtifact.bundle_sha256,
    production_env: 'tradingview-etf-d0fa42yy57cbc11b',
    function_name: 'runDecisionEngine'
  };

  // ① 完整五元组 ⇒ bound
  const ok = G.evaluateDeploymentAuthorizationBinding({ ...expected }, expected);
  assert.strictEqual(ok.bound, true, 'P-41：完整五元组必须 bound = true');
  assert.deepStrictEqual(ok.missing, [], 'P-41：不得缺字段');
  assert.deepStrictEqual(ok.mismatches, [], 'P-41：不得有不一致');

  // ② ⛔ 仅绑 HEAD SHA ⇒ 必须 REJECTED（★ 核心要求）
  const headOnly = G.evaluateDeploymentAuthorizationBinding(
    { base_head_sha: expected.base_head_sha }, expected);
  assert.strictEqual(headOnly.bound, false, 'P-41：⛔ 仅绑 HEAD SHA 必须 REJECTED');
  assert.strictEqual(headOnly.head_only_authorization_rejected, true,
    'P-41：必须显式标记 head_only_authorization_rejected');

  // ③ bundle sha 不匹配 ⇒ REJECTED（防止「授权 A 包、部署 B 包」）
  const wrongBundle = G.evaluateDeploymentAuthorizationBinding(
    { ...expected, deployment_bundle_sha: 'f'.repeat(64) }, expected);
  assert.strictEqual(wrongBundle.bound, false, 'P-41：⛔ bundle sha 不符必须 REJECTED');
  assert.strictEqual(wrongBundle.mismatches.length, 1, 'P-41：必须报告 1 处 mismatch');
  assert.strictEqual(wrongBundle.mismatches[0].field, 'deployment_bundle_sha',
    'P-41：mismatch 字段必须是 deployment_bundle_sha');

  // ④ candidate_manifest_sha 不符 ⇒ REJECTED
  const wrongManifest = G.evaluateDeploymentAuthorizationBinding(
    { ...expected, candidate_manifest_sha: 'a'.repeat(64) }, expected);
  assert.strictEqual(wrongManifest.bound, false, 'P-41：⛔ manifest sha 不符必须 REJECTED');

  // ⑤ 缺 env / function ⇒ 不得 bound（作用域必须限定）
  assert.strictEqual(G.evaluateDeploymentAuthorizationBinding(
    { ...expected, production_env: undefined }, expected).bound, false,
    'P-41：缺 production_env 必须 REJECTED');
  assert.strictEqual(G.evaluateDeploymentAuthorizationBinding(
    { ...expected, function_name: undefined }, expected).bound, false,
    'P-41：缺 function_name 必须 REJECTED');
}

/* ---------------- P-42 ★ §6/§8/§9 文档 current-state 守卫 ---------------- */
{
  const docs = {
    compression: fs.readFileSync(path.join(REPO, 'docs/V365_CONTEXT_COMPRESSION.md'), 'utf8'),
    ledger: fs.readFileSync(path.join(REPO, 'docs/V365_PRODUCTION_READINESS_LEDGER.md'), 'utf8'),
    freeze: fs.readFileSync(path.join(REPO, 'docs/V365_FREEZE_REVIEW.md'), 'utf8'),
    prospective: fs.readFileSync(path.join(REPO, 'docs/V365_PROSPECTIVE_PRODUCTION_QUALIFICATION.md'), 'utf8')
  };

  // §8：Prospective 机器状态**不得**残留 PENDING_OWNER_APPROVAL 作为 activation 状态
  //     （该旧行必须作废；须保持 BLOCKED_ON_DEPLOYMENT_IDENTITY）
  assert.ok(!/READY_FOR_CONTROLLED_PRODUCTION_ACTIVATION\s*=\s*PENDING_OWNER_APPROVAL/.test(
    docs.prospective),
    'P-42：⛔ Prospective 不得残留 READY_FOR_CONTROLLED_PRODUCTION_ACTIVATION = PENDING_OWNER_APPROVAL');
  assert.ok(/READY_FOR_CONTROLLED_PRODUCTION_ACTIVATION\s*=\s*BLOCKED_ON_DEPLOYMENT_IDENTITY/.test(
    docs.prospective),
    'P-42：Prospective 必须声明 READY_FOR_CONTROLLED_PRODUCTION_ACTIVATION = BLOCKED_ON_DEPLOYMENT_IDENTITY');

  // §8：controlled-run 不得再写「explicit HEAD SHA binding」为唯一绑定
  assert.ok(!/explicit HEAD SHA binding/.test(docs.prospective),
    'P-42：⛔ controlled-run 不得再把 HEAD SHA 当唯一绑定');
  assert.ok(/three-layer identity binding|三层 identity/.test(docs.prospective),
    'P-42：controlled-run 必须改为三层 identity binding');

  // §9：不得残留「25 个 tracked 文件」这类 stale current value
  //     ⚠️ 必须排除「**纠正句**」—— 写「原写『25 个 tracked 文件』⇒ 更正为 84」是正确的纠正，
  //        朴素正则会把它当违规（本项目已记录的同类陷阱，见 MEMORY §12.3）。
  const CORRECTIVE = /原写|已作废|更正为|旧口径|历史旧口径|stale|不得残留|残留「/;
  for (const [k, txt] of Object.entries(docs)) {
    const badLines = txt.split('\n').filter((ln) =>
      /\*\*25 个 tracked 文件\*\*/.test(ln) && !CORRECTIVE.test(ln));
    assert.deepStrictEqual(badLines, [],
      `P-42：⛔ ${k} 不得把「25 个 tracked 文件」当作 current state 陈述`);
  }
  // §9：历史段必须显式标注 [HISTORICAL SNAPSHOT]
  assert.ok(/\[HISTORICAL SNAPSHOT\]/.test(docs.ledger),
    'P-42：ledger 历史段必须标注 [HISTORICAL SNAPSHOT]');
  assert.ok(/\[HISTORICAL SNAPSHOT\]/.test(docs.prospective),
    'P-42：prospective 历史段必须标注 [HISTORICAL SNAPSHOT]');

  // C-021.1 关键 token 必须出现在三份收口文档
  for (const k of ['compression', 'ledger', 'freeze']) {
    for (const t of ['DEPLOYMENT_ARTIFACT_MATERIALIZED', 'DEPLOYMENT_BUNDLE_SHA',
      'BUNDLE_SOURCE_PARITY', 'UNEXPECTED_PACKAGE_DIFF', 'BLOCKED_ON_DEPLOYMENT_ARTIFACT',
      'deployment_artifact_materialized']) {
      assert.ok(docs[k].includes(t), `P-42：${k} 必须含 C-021.1 token "${t}"`);
    }
  }
}

/* ---------------- P-43 ★ §10 本轮不得 deploy（preflight 最终状态） ---------------- */
{
  const statePath = path.join(REPO,
    'deliverables/v365-production-history/prospective/prospective-state.json');
  assert.ok(fs.existsSync(statePath), 'P-43：prospective-state.json 必须存在');
  const st = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const fs2 = st.final_state;

  assert.strictEqual(fs2.DEPLOYMENT_ARTIFACT_MATERIALIZED, true,
    'P-43：DEPLOYMENT_ARTIFACT_MATERIALIZED 必须为 true');
  assert.strictEqual(fs2.DEPLOYMENT_BUNDLE_SHA, deploymentArtifact.bundle_sha256,
    'P-43：DEPLOYMENT_BUNDLE_SHA 必须等于 artifact 的 bundle_sha256');
  assert.strictEqual(fs2.BUNDLE_SOURCE_PARITY, 'EXACT_MATCH',
    'P-43：BUNDLE_SOURCE_PARITY 必须为 EXACT_MATCH');
  assert.strictEqual(fs2.UNEXPECTED_PACKAGE_DIFF, 0, 'P-43：UNEXPECTED_PACKAGE_DIFF 必须为 0');

  // ★★ C-021.2：分阶段断言（⛔ 不得写死部署前的期望值 —— 否则部署成功后必然假红）
  const deployed43 = fs2.DEPLOYMENT_IDENTITY_VERIFIED === true;
  if (deployed43) {
    assert.strictEqual(fs2.CONTROLLED_DEPLOYMENT, 'COMPLETE', 'P-43：部署后必须 COMPLETE');
    assert.strictEqual(fs2.CURRENT_PRODUCTION_DEPLOYMENT_IDENTITY, 'V3.6.5', 'P-43：部署后必须 V3.6.5');
    assert.strictEqual(fs2.ONLINE_SOURCE_PARITY, 'EXACT_MATCH', 'P-43：部署后 parity 必须 EXACT_MATCH');
    assert.strictEqual(fs2.POST_DEPLOY_UNEXPECTED_PACKAGE_DIFF, 0, 'P-43：部署后 diff 必须 0');
    assert.strictEqual(fs2.READY_FOR_V365_FIRST_CONTROLLED_RUN, 'PENDING_OWNER_RUN_APPROVAL',
      'P-43：部署后首次受控运行必须等 owner 单独授权');
    assert.ok(['PENDING_OWNER_APPROVAL', 'BLOCKED_GATE_INCOMPLETE']
      .includes(fs2.READY_FOR_CONTROLLED_PRODUCTION_ACTIVATION),
      `P-43：部署后 activation 必须落在允许集合，实得 ${fs2.READY_FOR_CONTROLLED_PRODUCTION_ACTIVATION}`);
  } else {
    assert.strictEqual(fs2.READY_FOR_CONTROLLED_PRODUCTION_ACTIVATION,
      'BLOCKED_ON_DEPLOYMENT_IDENTITY',
      'P-43：activation 必须保持 BLOCKED_ON_DEPLOYMENT_IDENTITY');
    assert.strictEqual(fs2.READY_FOR_V365_FIRST_CONTROLLED_RUN,
      'BLOCKED_ON_DEPLOYMENT_IDENTITY',
      'P-43：first controlled run 必须 BLOCKED_ON_DEPLOYMENT_IDENTITY');
  }
  // ★ 恒不变式（两阶段都成立）
  assert.strictEqual(fs2.PRODUCTION_ACTIVATION_AUTHORIZATION, 'NOT_GRANTED',
    'P-43：PRODUCTION_ACTIVATION_AUTHORIZATION 必须 NOT_GRANTED');
  assert.strictEqual(fs2.OWNER_RUN_AUTHORIZATION, false,
    'P-43：⛔ OWNER_RUN_AUTHORIZATION 必须 false（本消息不授权 first run）');
  assert.notStrictEqual(fs2.READY_FOR_V365_FIRST_CONTROLLED_RUN, 'GRANTED',
    'P-43：⛔ 首次受控运行不得 GRANTED');

  // ★★ C-021.1 §9：避免自指 —— GATE-D 的 status 由日志推导 ⇒ 只断言**恒不变式 + facts↔status 一致性**
  //    （精确的 PENDING_OWNER_DEPLOYMENT_APPROVAL 期望值由一致性检查器在日志刷新后强制）
  assert.strictEqual(st.deployment_gate.may_deploy, false, 'P-43：⛔ may_deploy 必须 false');
  assert.strictEqual(st.deployment_gate.implies_first_controlled_run, false,
    'P-43：⛔ 部署门禁不得推导运行门禁');
  const byId = Object.fromEntries(st.deployment_gate.items.map((i) => [i.id, i.ok]));
  assert.strictEqual(byId['D-08'], true, 'P-43：D-08 必须 PASS（与日志无关）');
  assert.strictEqual(byId['D-09'], true, 'P-43：D-09 必须 PASS（与日志无关）');
  assert.strictEqual(byId['D-10'], false, 'P-43：⛔ D-10 owner 部署授权必须尚未给出');
  const artifactFailed = ['D-08', 'D-09'].filter((id) => !byId[id]);
  const coreFailed = ['D-01', 'D-02', 'D-03', 'D-04', 'D-05', 'D-06', 'D-07', 'D-08', 'D-09']
    .filter((id) => !byId[id]);
  const expectedStatus = artifactFailed.length ? 'BLOCKED_ON_DEPLOYMENT_ARTIFACT'
    : coreFailed.length ? 'BLOCKED_DEPLOYMENT_GATE_INCOMPLETE'
    : 'PENDING_OWNER_DEPLOYMENT_APPROVAL';
  assert.strictEqual(st.deployment_gate.status, expectedStatus,
    'P-43：⛔ GATE-D status 必须与 items 一致');
  // ⛔ 无论如何都不得处于可部署状态
  assert.notStrictEqual(st.deployment_gate.status, 'GRANTED',
    'P-43：⛔ 未获 owner 授权前不得 GRANTED');
}

/* ---------------- P-44 ★ C-021.1 §9 门禁日志完整性（机制 + 独立真值） ---------------- */
{
  // ★★ 关键设计：本测试**只**断言「守卫机制存在 + 独立真值一致」。
  //    ⛔ **不**断言 `logs_fresh === true` 或日志 `failed === 0` —— 那会构成**自指**：
  //       测试套件产出日志 → preflight 读日志 → state json → 本测试断言 state json。
  //       日志干净与否的**最终**强制，交由 `scripts/v365-final-state-consistency-check.js`
  //       （在日志刷新后作为收口步骤运行，不在测试套件内 ⇒ 无循环）。
  const statePath = path.join(REPO,
    'deliverables/v365-production-history/prospective/prospective-state.json');
  const st = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const gli = st.gate_log_integrity;
  assert.ok(gli, 'P-44：prospective-state 必须含 gate_log_integrity（§9 加固已接线）');

  // ① 独立真值：tests/*.test.js 实际文件数
  const truth = fs.readdirSync(path.join(REPO, 'tests')).filter((f) => f.endsWith('.test.js')).length;
  assert.strictEqual(gli.test_file_count, truth,
    'P-44：test_file_count 必须等于 tests/*.test.js 实际文件数（独立真值）');

  // ② 解析器必须真实工作：Stage A 计数必须来自真实日志（而非硬编码）
  //    ⛔ 只断言 `total`（= 文件数，**与测试是否全过无关** ⇒ 非循环）。
  //    ⛔ **不**断言 `count_matches_truth === true`（那要求 passed==total ⇒ 又变循环）；
  //       该值由一致性检查器在收口时强制。
  assert.ok(gli.stage_a_log.parsed_count, 'P-44：必须能从日志解析出 Stage A 计数');
  assert.strictEqual(gli.stage_a_log.parsed_count.total, truth,
    'P-44：⛔ Stage A 日志 total 必须等于真实 test 文件数（⛔ 过期日志不得静默通过）');
  assert.ok(typeof gli.stage_a_log.count_matches_truth === 'boolean',
    'P-44：必须暴露 count_matches_truth（boolean），供收口强制');
  assert.ok(typeof gli.stage_a_log.passed_count_matches === 'undefined' ||
            typeof gli.stage_a_log.passed_count_matches === 'boolean',
    'P-44：字段形态必须稳定');

  // ③ 新鲜度必须被**计算并暴露**（其值由一致性检查器在收口时强制为 true）
  assert.ok(typeof gli.logs_fresh === 'boolean',
    'P-44：必须暴露 logs_fresh（boolean），供收口强制');
  // ★ 新鲜度必须用**内容指纹**而非 mtime（篡改后逐字节还原的测试会假报过期）
  assert.ok(/content-hash/.test(gli.freshness_method || ''),
    'P-44：⛔ 新鲜度必须基于内容指纹（freshness_method 应含 content-hash）');
  assert.ok(gli.source_tree_sha && /^[0-9a-f]{64}$/.test(gli.source_tree_sha),
    'P-44：必须暴露源树内容指纹 source_tree_sha（64 位 hex）');
  assert.ok(gli.stage_a_log.recorded_source_tree_sha,
    'P-44：必须记录日志旁的内容指纹（.source-sha256）');
  // ★ 三份门禁日志（stage-a / stage-all / p12）都必须纳入指纹化范围
  assert.ok(gli.p12_log && gli.p12_log.path && /p12-parity-current\.log/.test(gli.p12_log.path),
    'P-44：⛔ p12 日志也必须纳入指纹化（同属「读日志 → 出结论」）');
  assert.ok(typeof gli.p12_log.fresh === 'boolean',
    'P-44：必须暴露 p12_log.fresh（boolean），供收口强制');
  // ⛔ 不断言「state 记录的指纹 == 当前指纹」—— 那会循环（改测试本身即改指纹）。
  //    「新鲜度 == true」的最终强制由一致性检查器在收口时完成。
  const STS = require('../scripts/v365-source-tree-sha.js');
  assert.ok(/^[0-9a-f]{64}$/.test(STS.sourceTreeSha().sha256),
    'P-44：源树指纹计算器必须可用且输出稳定形态');

  // ④ 守卫必须真的接在 gate 判定上（⛔ 防止日后退回纯形态匹配）
  const src = fs.readFileSync(path.join(REPO, 'scripts/v365-prospective-preflight.js'), 'utf8');
  assert.ok(src.includes('count_matches_truth'),
    'P-44：preflight 必须实现计数绑定真值的判定');
  assert.ok(/stage_a_pass:[\s\S]{0,400}stageACountOk/.test(src),
    'P-44：⛔ stage_a_pass 必须依赖 stageACountOk（不得退回纯形态匹配）');
  assert.ok(/stage_a_to_g_pass:[\s\S]{0,600}stageAllMeta\.fresh/.test(src),
    'P-44：⛔ stage_a_to_g_pass 必须依赖新鲜度（不得退回纯形态匹配）');
}

console.log('[PASS] v365-prospective-qualification.test.js（P-01~P-44）');
