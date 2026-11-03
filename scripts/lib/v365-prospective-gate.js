'use strict';

/**
 * V3.6.5 —— PROSPECTIVE PRODUCTION QUALIFICATION · 机器门禁（纯函数 · 零 IO）
 *
 * 设计依据：`docs/V365_PROSPECTIVE_PRODUCTION_QUALIFICATION.md`
 *
 * ⛔ 本模块**纯函数、无 IO、无生产写入**。
 *    它做四件事：
 *      ① 判定 `READY_FOR_CONTROLLED_PRODUCTION_ACTIVATION` 是否可置位
 *      ② 判定 First Natural Run Acceptance（A-01~A-10）是否全绿
 *      ③ ★ C-020：两层 anchor（result_sequence_sha / PROSPECTIVE_QUALIFICATION_ANCHOR）
 *      ④ ★ C-020：CAS-success / history-failure 恢复语义
 *
 * ★ 铁律：
 *   - `READY_FOR_CONTROLLED_PRODUCTION_ACTIVATION` ≠ `READY_FOR_PRODUCTION_PROMOTION`
 *     ≠ `READY_FOR_GENERAL_PRODUCTION`
 *   - 历史 6 个 UNEXPECTED 必须**显式登记且未被静默豁免**（≠ 要求它变成 0）
 *   - ★ execute authority = `trade_log`；actual position-book authority =
 *     `portfolio_snapshot.positions[].position`；⛔ `run_candidate_portfolio`
 *     **仅** 为 candidate/intended provenance（见 actual-book-authority-audit.json）
 *   - 任何不确定/缺数据 ⇒ fail-closed
 */

/** 协议常量（⛔ 不得复用旧 anchor） */
const PROTOCOL = Object.freeze({
  protocol_version: 'RFP-V2-PH-PROSPECTIVE',
  replay_semantics: 'PRODUCTION_HISTORICAL_PROSPECTIVE',
  qualification_authoritative: false
});

/** ★ C-020 §1：actual-book authority 冻结（owner 裁定） */
const ACTUAL_BOOK_AUTHORITY = Object.freeze({
  execution_authority: 'trade_log',
  actual_position_book_authority: 'portfolio_snapshot.positions[].position',
  /** ⛔ run_candidate_portfolio 仅作 candidate/intended provenance，⛔ 不得用于 actual-book qualification */
  run_candidate_portfolio_role: 'candidate_intended_portfolio_provenance',
  run_candidate_portfolio_may_qualify_actual_book: false,
  audit_evidence: 'deliverables/v365-production-history/prospective/actual-book-authority-audit.json'
});

/**
 * ★ C-020 §2/§5：PROSPECTIVE_QUALIFICATION_ANCHOR 的必需绑定字段。
 *   ⛔ 不得减少；如需更多数据源可增加。
 *   result_sequence_sha 只是**其中一个**输入，⛔ 不得单独作为 qualification anchor。
 */
const ANCHOR_BINDINGS = Object.freeze([
  'protocol_version',
  'replay_semantics',
  'prospective_epoch',
  'window_start',
  'window_end',
  'trade_log_dataset_sha',
  'portfolio_snapshot_dataset_sha',
  'run_history_manifest_sha',
  'production_code_sha',
  'replay_harness_sha',
  'coverage_manifest_sha',
  'result_sequence_sha'
]);

/**
 * ★ C-020 §3：CAS / history 恢复状态常量。
 */
const RECOVERY = Object.freeze({
  CAS_REJECTED: 'CAS_REJECTED',
  PROMOTED_HISTORY_INCOMPLETE: 'PROMOTED_HISTORY_INCOMPLETE',
  HISTORY_IMMUTABILITY_CONFLICT: 'HISTORY_IMMUTABILITY_CONFLICT',
  RECOVERED: 'RECOVERED'
});

/** OD-P-1（owner APPROVED）：窗口边界 */
const WINDOW_POLICY = Object.freeze({
  minimum_trading_days: 120,
  maximum_trading_days: 250,
  on_insufficient_at_max: 'STOP_OWNER_REVIEW_REQUIRED',
  may_auto_lower_standard: false
});

/**
 * ★ C-021 §7/§9：部署身份状态常量。
 *   ⛔ 部署授权与运行授权必须严格分离 —— 任一不得推导另一个。
 */
const DEPLOYMENT = Object.freeze({
  /** 部署前必须为 false；只有 §9 post-deploy EXACT_MATCH 才能置 true */
  IDENTITY_VERIFIED_FALSE: false,
  /** §9 逐项比较结论 */
  ONLINE_SOURCE_PARITY: Object.freeze({
    EXACT_MATCH: 'EXACT_MATCH',
    MISMATCH: 'MISMATCH'
  }),
  /** 部署前/后的两个独立 owner Gate */
  GATE_D: 'READY_FOR_V365_CONTROLLED_DEPLOYMENT',
  GATE_R: 'READY_FOR_V365_FIRST_CONTROLLED_RUN'
});

/** ⛔ §10：部署身份未验证时的 fail-closed 状态（比 PENDING_OWNER_APPROVAL 更精确） */
const GATE_STATUS = Object.freeze({
  BLOCKED_ON_DEPLOYMENT_IDENTITY: 'BLOCKED_ON_DEPLOYMENT_IDENTITY',
  /** ★ C-021.1 §6：bundle 尚未物化 / 未通过 exact match 时的 fail-closed 状态 */
  BLOCKED_ON_DEPLOYMENT_ARTIFACT: 'BLOCKED_ON_DEPLOYMENT_ARTIFACT',
  PENDING_OWNER_APPROVAL: 'PENDING_OWNER_APPROVAL',
  PENDING_OWNER_DEPLOYMENT_APPROVAL: 'PENDING_OWNER_DEPLOYMENT_APPROVAL',
  GRANTED: 'GRANTED',
  BLOCKED_GATE_INCOMPLETE: 'BLOCKED_GATE_INCOMPLETE',
  BLOCKED_HISTORICAL_DELTA_SILENTLY_WAIVED: 'BLOCKED_HISTORICAL_DELTA_SILENTLY_WAIVED',
  BLOCKED_DEPLOYMENT_GATE_INCOMPLETE: 'BLOCKED_DEPLOYMENT_GATE_INCOMPLETE'
});

/** ⛔ 禁用的旧 anchor（若新协议引用其一 ⇒ 直接 FAIL） */
const FORBIDDEN_ANCHORS = Object.freeze([
  '25ccbfc7e1b73a9a173ec36c17512c6228a2fe42685dcd291bc055ea4ed11723', // RFP-V1
  'b87654ab81935731a4173b5f566231f6db62c3d2e2b43f74cd6c8fb93ea78832', // RFP-V2-CF
  '0db3193b297d2900aa1b32e359bbe80b80bfbf7a5b10ce0bba17a32f41dbe4f5', // RFP-V2-CF-COOLDOWN
  '5c8fb4ae7223abdc4edb9ba8267c2043d4dd22d6688e000415e1a4f1339b661d'  // RFP-V2-AE
]);

/** Controlled Activation Gate 的 16 项判据（G-01~G-16） */
const GATE_ITEMS = Object.freeze([
  { id: 'G-01', key: 'hd10_complete', desc: 'HD-10 = COMPLETE' },
  { id: 'G-02', key: 'production_schema_exact_match', desc: 'production schema exact-match = true' },
  { id: 'G-03', key: 'stage_a_pass', desc: 'Stage A = PASS' },
  { id: 'G-04', key: 'stage_a_to_g_pass', desc: 'Stage A~G = PASS' },
  { id: 'G-05', key: 'qualification_gate_pass', desc: 'qualification gate = PASS' },
  { id: 'G-06', key: 'reader_migration_pass', desc: 'reader migration = PASS' },
  { id: 'G-07', key: 'immutable_pass', desc: 'immutable = PASS' },
  { id: 'G-08', key: 'gen1_pass', desc: 'Gen-1 = PASS' },
  { id: 'G-09', key: 'gen2_pass', desc: 'Gen-2 = PASS' },
  { id: 'G-10', key: 'p12_parity_delta_zero', desc: 'P12_PARITY_UNEXPECTED_DECISION_DELTA = 0' },
  { id: 'G-11', key: 'protected_domain_clean', desc: 'protected domain = clean' },
  { id: 'G-12', key: 'rpg_f2_historical_registered', desc: 'RPG-F2 historical limitations explicitly registered' },
  { id: 'G-13', key: 'rpg_f3_historical_registered_not_waived', desc: 'RPG_F3_HISTORICAL_UNEXPECTED_DECISION_DELTA explicitly registered AND NOT silently waived' },
  { id: 'G-14', key: 'run_history_infra_ready', desc: 'RUN_HISTORY infrastructure = READY' },
  { id: 'G-15', key: 'switch_date_null_before_first', desc: 'V365_ENFORCE_SWITCH_DATE = null before first successful activation' },
  { id: 'G-16', key: 'owner_run_authorization', desc: 'FIRST CONTROLLED RUN authorization = explicit owner authorization' },
  // ★ C-020 新增判据
  { id: 'G-17', key: 'actual_book_authority_frozen', desc: 'actual-book authority = portfolio_snapshot.positions[].position (⛔ not run_candidate_portfolio)' },
  { id: 'G-18', key: 'two_layer_anchor_registered', desc: 'PROSPECTIVE_QUALIFICATION_ANCHOR registered (two-layer; ⛔ not single result_sequence_sha)' },
  { id: 'G-19', key: 'cas_history_recovery_registered', desc: 'CAS_REJECTED + PROMOTED_HISTORY_INCOMPLETE recovery protocol registered' },
  { id: 'G-20', key: 'od_p_1_approved_no_auto_lower', desc: 'OD-P-1 APPROVED (MIN=120 / MAX=250) AND may_auto_lower_standard = false' },
  // ★ C-021 新增判据（§10）—— 部署身份链
  { id: 'G-21', key: 'candidate_source_frozen', desc: 'candidate source frozen (deployment_candidate_manifest_sha present)' },
  { id: 'G-22', key: 'deployment_scope_exact', desc: 'deployment scope exact (required/excluded files精确，⛔ 非 74 全量)' },
  { id: 'G-23', key: 'rollback_artifact_verified', desc: 'CURRENT_PRODUCTION_ROLLBACK_ARTIFACT independently verified' },
  { id: 'G-24', key: 'production_baseline_verified', desc: 'current production baseline verified against deployment ledger' },
  { id: 'G-25', key: 'deployment_identity_verified', desc: 'DEPLOYMENT_IDENTITY_VERIFIED = true (⛔ 部署前必须为 false)' }
]);

/**
 * ★ C-021 §8 / C-021.1 §6：GATE-D —— 部署门禁判据（在 run gate 之前的**独立**门禁）。
 *
 *   C-021.1 §6 修正：原 D-08（owner 授权）后移为 D-10，并在其**之前**插入
 *   D-08 deployment_artifact_materialized / D-09 deployment_artifact_exact_match。
 *   ⇒ bundle 生成前 `READY_FOR_V365_CONTROLLED_DEPLOYMENT = BLOCKED_ON_DEPLOYMENT_ARTIFACT`；
 *      bundle + parity 全通过后才可能变为 `PENDING_OWNER_DEPLOYMENT_APPROVAL`。
 *
 *   ⛔ `PENDING_OWNER_DEPLOYMENT_APPROVAL` 的语义被收紧为：
 *      「已经存在一个具体、不可变、可用 SHA 唯一标识的 deployment bundle，
 *        owner 只差决定『是否把这一包上传生产』」。
 */
const DEPLOYMENT_GATE_ITEMS = Object.freeze([
  { id: 'D-01', key: 'candidate_source_frozen', desc: 'candidate source frozen' },
  { id: 'D-02', key: 'deployment_manifest_frozen', desc: 'deployment manifest frozen' },
  { id: 'D-03', key: 'deployment_scope_exact', desc: 'deployment scope exact' },
  { id: 'D-04', key: 'current_production_baseline_verified', desc: 'current production baseline verified' },
  { id: 'D-05', key: 'rollback_artifact_verified', desc: 'rollback artifact verified' },
  { id: 'D-06', key: 'all_qualification_gates_pass', desc: 'all qualification gates PASS' },
  { id: 'D-07', key: 'protected_domain_clean', desc: 'protected domain clean' },
  // ★ C-021.1 §6 新增
  { id: 'D-08', key: 'deployment_artifact_materialized', desc: 'deployment bundle materialized (canonical, deterministic)' },
  { id: 'D-09', key: 'deployment_artifact_exact_match', desc: 'BUNDLE_SOURCE_PARITY = EXACT_MATCH AND UNEXPECTED_PACKAGE_DIFF = 0' },
  { id: 'D-10', key: 'owner_deployment_authorization', desc: 'owner deployment authorization' }
]);

/** ★ C-021.1 §6：artifact 相关判据（未满足 ⇒ BLOCKED_ON_DEPLOYMENT_ARTIFACT） */
const DEPLOYMENT_ARTIFACT_ITEMS = Object.freeze(['D-08', 'D-09']);

/** ★ C-021.1 §7：owner 部署授权必须绑定的 identity 字段（⛔ 不得只绑 HEAD） */
const DEPLOYMENT_AUTHORIZATION_BINDING_FIELDS = Object.freeze([
  'base_head_sha',
  'candidate_manifest_sha',
  'deployment_bundle_sha',
  'production_env',
  'function_name'
]);

/** First Natural Run Acceptance 的 10 项判据（A-01~A-10） */
const ACCEPTANCE_ITEMS = Object.freeze([
  { id: 'A-01', key: 'run_manifest_exists', desc: 'run_manifest exists' },
  { id: 'A-02', key: 'candidate_decisions_complete', desc: 'candidate decisions complete' },
  { id: 'A-03', key: 'candidate_portfolio_complete', desc: 'candidate portfolio complete' },
  { id: 'A-04', key: 'active_run_pointer_correct', desc: 'active_run_pointer correct' },
  { id: 'A-05', key: 'run_history_exists', desc: 'run_history exists' },
  { id: 'A-06', key: 'promoted_true', desc: 'promoted = true' },
  { id: 'A-07', key: 'promoted_at_non_null', desc: 'promoted_at non-null' },
  { id: 'A-08', key: 'revision_correct', desc: 'revision correct' },
  { id: 'A-09', key: 'supersedes_run_id_correct', desc: 'supersedes_run_id correct' },
  { id: 'A-10', key: 'read_after_write_consistent', desc: 'read_after_write_consistent = true' }
]);

/**
 * 判定 Controlled Activation Gate。
 *
 * ★ C-021 §10/§11 关键修正：
 *   ⛔ 旧语义 `owner_authorization = true ⇒ GRANTED` **已废除**。
 *   现在必须**同时**满足：
 *     · `deployment_identity_verified = true`（§9 post-deploy EXACT_MATCH 之后的结论）
 *     · `owner_run_authorization = true`（**运行**授权，非部署授权）
 *     · 其余所有 Gate（G-01~G-25）均 PASS
 *   否则 ⇒ fail-closed。
 *
 *   特别地：G-25（deployment_identity_verified）在**部署前必须为 false**
 *   ⇒ 当前状态为 `BLOCKED_ON_DEPLOYMENT_IDENTITY`（比 PENDING_OWNER_APPROVAL 更精确）。
 *
 * @param {object} facts 事实快照（全部来自只读 evidence / 门禁输出）
 * @returns {{
 *   gate_status: string,          // BLOCKED_ON_DEPLOYMENT_IDENTITY | PENDING_OWNER_APPROVAL | GRANTED | BLOCKED_*
 *   may_activate: boolean,
 *   ready_for_controlled_production_activation: string,
 *   ready_for_v365_first_controlled_run: string,
 *   ready_for_general_production: boolean,
 *   failed_items: string[],
 *   items: Array<{id,key,desc,ok,value}>
 * }}
 */
function evaluateControlledActivationGate(facts) {
  const f = facts || {};

  // ⛔ 防御：历史 6 个 UNEXPECTED 不得被"静默豁免"
  //   即：若声明 historical delta = 0，或多报了 waiver，则直接 FAIL（先于常规判据）。
  const histDelta = f.rpg_f3_historical_unexpected_decision_delta;
  const histWaived = f.rpg_f3_historical_waived === true;
  const silentWaiver = (histDelta === 0) || histWaived;

  const items = GATE_ITEMS.map((it) => {
    let ok = f[it.key] === true;
    // G-13 特殊语义：不仅要求"已登记"，还要求 delta 为 6 且未被豁免
    if (it.id === 'G-13' && !silentWaiver) {
      ok = f.rpg_f3_historical_registered === true && histDelta === 6;
    }
    if (it.id === 'G-13' && silentWaiver) ok = false; // fail-closed
    return { id: it.id, key: it.key, desc: it.desc, ok, value: f[it.key] };
  });

  const failed = items.filter((x) => !x.ok).map((x) => x.id);
  // ★ C-021：只有 G-16（owner **run** 授权）属"等 owner 一句话"的项；
  //          G-21~G-25 属**必须先后达成**的部署身份链，不得并入 G-16。
  const ownerOnly = ['G-16'];
  const coreFailed = failed.filter((id) => !ownerOnly.includes(id));

  const identityOk = items.find((x) => x.id === 'G-25').ok;
  const ownerRunOk = items.find((x) => x.id === 'G-16').ok;

  let gate_status;
  let mayActivate = false;
  if (silentWaiver) {
    gate_status = GATE_STATUS.BLOCKED_HISTORICAL_DELTA_SILENTLY_WAIVED;
  } else if (coreFailed.length > 0) {
    // 部署身份链未完成 ⇒ 更精确的 fail-closed 状态（§10）
    gate_status = !identityOk
      ? GATE_STATUS.BLOCKED_ON_DEPLOYMENT_IDENTITY
      : GATE_STATUS.BLOCKED_GATE_INCOMPLETE;
  } else if (!identityOk) {
    // ★ §11：即使 owner 已给运行授权，若部署身份未验证 ⇒ 仍不得激活
    gate_status = GATE_STATUS.BLOCKED_ON_DEPLOYMENT_IDENTITY;
  } else if (!ownerRunOk) {
    gate_status = GATE_STATUS.PENDING_OWNER_APPROVAL;
  } else {
    gate_status = GATE_STATUS.GRANTED;
    mayActivate = true;
  }

  return {
    gate_status,
    may_activate: mayActivate,
    ready_for_controlled_production_activation: gate_status,
    // ★ C-021 §10/§13：第一笔受控运行的独立门禁
    ready_for_v365_first_controlled_run: gate_status === GATE_STATUS.GRANTED
      ? 'GRANTED' : (identityOk ? 'PENDING_OWNER_RUN_APPROVAL' : 'BLOCKED_ON_DEPLOYMENT_IDENTITY'),
    // ⛔ 两者恒为 false/none —— controlled activation ≠ general production
    ready_for_general_production: false,
    ready_for_production_promotion: 'NOT_ISSUED',
    deployment_identity_verified: identityOk,
    owner_run_authorization: ownerRunOk,
    failed_items: failed,
    items
  };
}

/**
 * ★ C-021 §7/§8 / C-021.1 §6：GATE-D —— 部署门禁（与运行门禁**严格分离**）。
 *
 *   输出语义（fail-closed 优先级）：
 *     ① artifact 链未完成（D-08/D-09 FAIL）  ⇒ `BLOCKED_ON_DEPLOYMENT_ARTIFACT`
 *     ② 其它核心项未完成                      ⇒ `BLOCKED_DEPLOYMENT_GATE_INCOMPLETE`
 *     ③ 核心全绿但 owner 未授权               ⇒ `PENDING_OWNER_DEPLOYMENT_APPROVAL`
 *     ④ 核心全绿 + owner 已授权               ⇒ `GRANTED`（may_deploy = true）
 *
 *   ⛔ 部署授权 ⇒ ⛔ 不得推导出运行授权（反之亦然）。
 *
 * @param {object} facts
 * @returns {{ gate_id, gate_status, may_deploy, implies_first_controlled_run,
 *             deployment_artifact_materialized, deployment_bundle_sha,
 *             failed_items, items }}
 */
function evaluateDeploymentGate(facts) {
  const f = facts || {};
  const items = DEPLOYMENT_GATE_ITEMS.map((it) => ({
    id: it.id, key: it.key, desc: it.desc, ok: f[it.key] === true, value: f[it.key]
  }));
  const failed = items.filter((x) => !x.ok).map((x) => x.id);

  const ownerId = 'D-10';
  const coreFailed = failed.filter((id) => id !== ownerId);
  const artifactFailed = failed.filter((id) => DEPLOYMENT_ARTIFACT_ITEMS.includes(id));
  const ownerOk = items.find((x) => x.id === ownerId).ok;
  const artifactOk = artifactFailed.length === 0;

  let gate_status;
  let mayDeploy = false;
  if (!artifactOk) {
    // ★ C-021.1 §6：bundle 尚未物化 / 未 exact match ⇒ 更精确的 fail-closed
    gate_status = GATE_STATUS.BLOCKED_ON_DEPLOYMENT_ARTIFACT;
  } else if (coreFailed.length > 0) {
    gate_status = GATE_STATUS.BLOCKED_DEPLOYMENT_GATE_INCOMPLETE;
  } else if (!ownerOk) {
    gate_status = GATE_STATUS.PENDING_OWNER_DEPLOYMENT_APPROVAL;
  } else {
    gate_status = GATE_STATUS.GRANTED;
    mayDeploy = true;
  }

  return {
    gate_id: DEPLOYMENT.GATE_D,
    gate_status,
    may_deploy: mayDeploy,
    // ⛔ 部署门禁 ≠ 运行门禁
    implies_first_controlled_run: false,
    deployment_artifact_materialized: artifactOk,
    deployment_bundle_sha: f.deployment_bundle_sha || null,
    // ★ C-021.2 §7：owner 部署授权是**一次性**的 —— 已被单次授权部署消耗后，
    //    即使 D-01~D-09 全绿，也不得再次部署（需 owner 新授权）。
    deployment_authorization_consumed: f.deployment_authorization_consumed === true,
    pending_semantics: gate_status === GATE_STATUS.PENDING_OWNER_DEPLOYMENT_APPROVAL
      ? (f.deployment_authorization_consumed === true
        ? '授权已被单次授权部署消耗；再次部署需 owner 新授权'
        : '已存在具体、不可变、可用 SHA 唯一标识的 deployment bundle；owner 只差决定是否上传生产')
      : null,
    failed_items: failed,
    items
  };
}

/**
 * ★ C-021.1 §7：owner 部署授权**必须绑定 bundle**，⛔ 不得只绑 HEAD SHA。
 *
 *   三层 identity binding：
 *     · base_head_sha          —— provenance（**不再是**唯一代码身份）
 *     · candidate_manifest_sha —— 源码侧身份
 *     · deployment_bundle_sha  —— 可部署字节身份
 *   外加 production_env / function_name 限定作用域。
 *
 * @param {object} auth owner 授权声明
 * @param {object} expected 当前实际的五元组
 * @returns {{ bound:boolean, missing:string[], mismatches:Array<{field,authorized,actual}> }}
 */
function evaluateDeploymentAuthorizationBinding(auth, expected) {
  const a = auth || {};
  const e = expected || {};
  const missing = [];
  const mismatches = [];

  for (const fld of DEPLOYMENT_AUTHORIZATION_BINDING_FIELDS) {
    const av = a[fld];
    if (av === undefined || av === null || av === '') { missing.push(fld); continue; }
    if (e[fld] !== undefined && e[fld] !== null && av !== e[fld]) {
      mismatches.push({ field: fld, authorized: av, actual: e[fld] });
    }
  }

  // ⛔ 显式拒绝「只绑 HEAD」的旧形态：必须有 bundle sha
  const headOnly = !!(a.base_head_sha && !a.deployment_bundle_sha && !a.candidate_manifest_sha);

  return {
    bound: missing.length === 0 && mismatches.length === 0 && !headOnly,
    head_only_authorization_rejected: headOnly,
    required_fields: DEPLOYMENT_AUTHORIZATION_BINDING_FIELDS,
    missing,
    mismatches,
    note: 'HEAD 是 provenance，⛔ 不能再作为唯一代码身份'
  };
}

/**
 * ★ C-021 §9：Post-Deploy Identity Gate（部署后**立即**只读核验）。
 *
 *   只有 ONLINE_SOURCE_PARITY = EXACT_MATCH 且 UNEXPECTED_PACKAGE_DIFF = 0
 *   才允许 DEPLOYMENT_IDENTITY_VERIFIED = true；否则 STOP，不得进入 first run。
 *
 * @param {object} s { online, manifest, unexpected_package_diff }
 * @returns {{ deployment_identity_verified, online_source_parity, stop, mismatches }}
 */
function evaluatePostDeployIdentity(s) {
  const x = s || {};
  const online = x.online || {};
  const manifest = x.manifest || {};
  const mismatches = [];

  const cmp = (label, a, b) => {
    if (a == null || b == null) { mismatches.push(`${label}: missing (online=${a}, manifest=${b})`); return; }
    if (a !== b) mismatches.push(`${label}: online=${a} != manifest=${b}`);
  };
  cmp('runtime', online.Runtime, manifest.expected_runtime);
  cmp('handler', online.Handler, manifest.expected_handler);
  cmp('deployment_candidate_manifest_sha', online.deployment_candidate_manifest_sha, manifest.candidate_manifest_sha);

  // 逐文件在线哈希（若提供）
  if (Array.isArray(online.file_hashes)) {
    const byPath = new Map(online.file_hashes.map((f) => [f.path, f.sha256]));
    for (const f of (manifest.deployment_required_files || [])) {
      const o = byPath.get(f.path);
      if (o == null) mismatches.push(`file missing online: ${f.path}`);
      else if (o !== f.sha256) mismatches.push(`file content diff: ${f.path}`);
    }
  } else {
    mismatches.push('online.file_hashes 缺失 ⇒ 无法逐文件核验（fail-closed）');
  }

  const diff = Number(x.unexpected_package_diff);
  if (!Number.isFinite(diff) || diff !== 0) {
    mismatches.push(`UNEXPECTED_PACKAGE_DIFF = ${x.unexpected_package_diff}（必须为 0）`);
  }

  const exact = mismatches.length === 0;
  return {
    deployment_identity_verified: exact ? true : false,
    online_source_parity: exact ? DEPLOYMENT.ONLINE_SOURCE_PARITY.EXACT_MATCH
      : DEPLOYMENT.ONLINE_SOURCE_PARITY.MISMATCH,
    unexpected_package_diff: Number.isFinite(diff) ? diff : null,
    stop: exact ? null : 'STOP',
    mismatches
  };
}

/**
 * 判定 First Natural Run Acceptance（A-01~A-10）。
 *
 * @param {object} acceptance 各 A-xx 对应事实
 * @returns {{
 *   acceptance_status: string,     // PASSED | FAILED | NOT_RUN
 *   all_green: boolean,
 *   run_history_index_transition: string,  // 'PENDING' | 'ACTIVE/AVAILABLE'
 *   failed_items: string[],
 *   items: Array<{id,key,desc,ok,value}>
 * }}
 */
function evaluateFirstNaturalRunAcceptance(acceptance) {
  const a = acceptance || {};
  const ran = a.__run_attempted === true;

  const items = ACCEPTANCE_ITEMS.map((it) => ({
    id: it.id, key: it.key, desc: it.desc, ok: a[it.key] === true, value: a[it.key]
  }));
  const failed = items.filter((x) => !x.ok).map((x) => x.id);
  const allGreen = ran && failed.length === 0;

  return {
    acceptance_status: !ran ? 'NOT_RUN' : (allGreen ? 'PASSED' : 'FAILED'),
    all_green: allGreen,
    // ⛔ 仅当 A-01~A-10 全绿才允许升格
    run_history_index_transition: allGreen ? 'ACTIVE/AVAILABLE' : 'PENDING',
    failed_items: failed,
    items
  };
}

/**
 * ★ C-020 §2/§5：校验 result_sequence_sha 的**降级**语义 + PROSPECTIVE_QUALIFICATION_ANCHOR 完整性。
 *
 *   铁律：same qualification anchor
 *        ⇒ same protocol + same actual datasets + same production code
 *        + same replay implementation + same result sequence
 *
 * @param {object} a { result_sequence_sha?, prospective_qualification_anchor?, ...bindings }
 * @returns {{ ok: boolean, errors: string[], result_sequence_sha_standalone_forbidden: true }}
 */
function validateProspectiveAnchor(a) {
  const x = a || {};
  const errs = [];

  // ⛔ ① result_sequence_sha 不得单独作为 qualification anchor
  if (x.result_sequence_sha != null && x.prospective_qualification_anchor == null) {
    errs.push('⛔ result_sequence_sha 不得单独作为 production-historical qualification anchor '
      + '（必须由 PROSPECTIVE_QUALIFICATION_ANCHOR 承载）');
  }

  // ② PROSPECTIVE_QUALIFICATION_ANCHOR 必须存在，且绑定全部必需字段
  const anchor = x.prospective_qualification_anchor;
  if (anchor == null) {
    errs.push('缺少 PROSPECTIVE_QUALIFICATION_ANCHOR');
  } else {
    const bindings = anchor.bindings && typeof anchor.bindings === 'object' ? anchor.bindings : anchor;
    for (const k of ANCHOR_BINDINGS) {
      if (bindings[k] == null || bindings[k] === '') {
        errs.push(`PROSPECTIVE_QUALIFICATION_ANCHOR 缺少必需绑定 ${k}`);
      }
    }
    // ③ protocol 一致性
    if (bindings.protocol_version != null && bindings.protocol_version !== PROTOCOL.protocol_version) {
      errs.push(`anchor.protocol_version 必须为 ${PROTOCOL.protocol_version}`);
    }
    if (bindings.replay_semantics != null && bindings.replay_semantics !== PROTOCOL.replay_semantics) {
      errs.push(`anchor.replay_semantics 必须为 ${PROTOCOL.replay_semantics}`);
    }
    // ④ ⛔ anchor sha 不得复用旧协议 anchor
    if (anchor.sha256 != null && FORBIDDEN_ANCHORS.includes(anchor.sha256)) {
      errs.push('⛔ PROSPECTIVE_QUALIFICATION_ANCHOR 复用了旧协议 anchor —— 必须独立');
    }
  }

  return {
    ok: errs.length === 0,
    errors: errs,
    result_sequence_sha_standalone_forbidden: true
  };
}

/**
 * ★ C-020 §3：CAS-success / history-failure 恢复判定（纯函数 · fail-closed）。
 *
 * 冻结 OD-2 时序保持不变：
 *   candidate complete → manifest/finality → CAS promotion attempt
 *   → promotion result known → run_history append → authoritative pointer readable
 *
 * 两类失败：
 *   A. CAS_REJECTED                ⇒ pointer 不变 / promoted=false / 记 rejected history /
 *                                     switch date=null / EPOCH=NOT_STARTED / STOP
 *   B. CAS 成功但 run_history 失败 ⇒ PROMOTED_HISTORY_INCOMPLETE
 *        （⛔ 不得声明"不写 pointer" —— promotion 已经发生）
 *        恢复协议 7 步；⛔ 不得自动回滚 pointer。
 *
 * @param {object} s {
 *   cas_result: 'SUCCESS'|'REJECTED',
 *   run_history_append_result?: 'SUCCESS'|'FAILED',
 *   pointer_run_id?, this_run_id?,
 *   existing_history?: null | object,
 *   expected_history?: object,
 *   rollback_cas_protocol_frozen?: boolean
 * }
 * @returns {{ state, actions: string[], may_advance: boolean, switch_date: null|string, errors: string[] }}
 */
function evaluateCasHistoryRecovery(s) {
  const x = s || {};
  const errors = [];
  const actions = [];

  // ---- A. CAS 未成功 ----
  if (x.cas_result === 'REJECTED') {
    actions.push('pointer 不变（不修改 active_run_pointer）');
    actions.push('run promoted = false');
    actions.push('按冻结规则记录 rejected history');
    actions.push('switch date = null');
    actions.push('PROSPECTIVE_EPOCH = NOT_STARTED');
    actions.push('STOP');
    return {
      state: RECOVERY.CAS_REJECTED,
      actions,
      may_advance: false,
      switch_date: null,
      errors
    };
  }

  if (x.cas_result !== 'SUCCESS') {
    errors.push('cas_result 必须为 SUCCESS 或 REJECTED（⛔ 缺失/未知 ⇒ fail-closed）');
    return { state: 'BLOCKED_UNKNOWN_CAS_RESULT', actions, may_advance: false, switch_date: null, errors };
  }

  // ---- B. CAS 成功 ----
  if (x.run_history_append_result === 'SUCCESS') {
    actions.push('CAS 成功 + history 落盘成功 ⇒ 进入 First Natural Run Acceptance（A-01~A-10）');
    return { state: RECOVERY.RECOVERED, actions, may_advance: true, switch_date: null, errors };
  }

  // B. CAS 成功但 history 失败 ⇒ PROMOTED_HISTORY_INCOMPLETE
  actions.push('⛔ 不得声明"不写 pointer" —— promotion 已经发生');
  actions.push('1. 禁止再次 promotion');
  actions.push('2. read active_run_pointer');
  actions.push('3. 确认 pointer == 本 run');

  if (x.pointer_run_id != null && x.this_run_id != null && x.pointer_run_id !== x.this_run_id) {
    errors.push('pointer != 本 run ⇒ 与 CAS-success 事实矛盾，HARD STOP');
    return { state: RECOVERY.PROMOTED_HISTORY_INCOMPLETE, actions, may_advance: false, switch_date: null, errors };
  }
  actions.push('4. 以 uk_run_id 查询 run_history');

  const existing = x.existing_history;
  if (existing == null) {
    // 5a. 无 history ⇒ 幂等补写同一 immutable history row
    actions.push('5a. 无 history ⇒ 幂等补写同一 immutable history row');
    actions.push('6. history 恢复成功 ⇒ 再执行 First Natural Run Acceptance');
    actions.push('7. A-01~A-10 全绿前：switch date 不登记 · qualification 不累计');
    return { state: RECOVERY.PROMOTED_HISTORY_INCOMPLETE, actions, may_advance: false, switch_date: null, errors };
  }

  // 判定已有 history 是否与期望完全一致
  const expected = x.expected_history;
  const exactMatch = expected != null
    && typeof existing === 'object' && typeof expected === 'object'
    && JSON.stringify(existing) === JSON.stringify(expected);

  if (exactMatch) {
    // 5b. exact-match ⇒ retry/recovery success
    actions.push('5b. 已有完全一致 history ⇒ 视为 retry/recovery success');
    actions.push('6. 再执行 First Natural Run Acceptance');
    actions.push('7. A-01~A-10 全绿前：switch date 不登记 · qualification 不累计');
    return { state: RECOVERY.RECOVERED, actions, may_advance: true, switch_date: null, errors };
  }

  // 5c. 不同内容 ⇒ HISTORY_IMMUTABILITY_CONFLICT ⇒ HARD STOP
  actions.push('5c. 已有不同内容 ⇒ HISTORY_IMMUTABILITY_CONFLICT ⇒ HARD STOP');
  if (x.rollback_cas_protocol_frozen !== true) {
    actions.push('⛔ 无独立冻结的 rollback CAS 协议 ⇒ 不得自动回滚 pointer');
  }
  return { state: RECOVERY.HISTORY_IMMUTABILITY_CONFLICT, actions, may_advance: false, switch_date: null, errors };
}

/**
 * ★ C-020 §4：OD-P-1 窗口策略判定。
 *
 * @param {object} w { trading_days, dimensions: {regime_count, actions_covered, cooldown_triggered, cap_triggered} }
 * @returns {{ status, may_qualify, next }}
 */
function evaluateProspectiveWindow(w) {
  const x = w || {};
  const days = Number(x.trading_days);
  const d = x.dimensions || {};
  const dimsSatisfied =
    Number(d.regime_count) >= 2
    && Array.isArray(d.actions_covered)
    && ['BUILD', 'ADD', 'REDUCE', 'HOLD'].every((a) => d.actions_covered.includes(a))
    && d.cooldown_triggered === true
    && d.cap_triggered === true;

  if (!Number.isFinite(days) || days < WINDOW_POLICY.minimum_trading_days) {
    return { status: 'ACCUMULATING', may_qualify: false, next: `累计至 ≥ ${WINDOW_POLICY.minimum_trading_days} 交易日` };
  }
  if (dimsSatisfied) {
    return { status: 'WINDOW_SATISFIED', may_qualify: true, next: '进入 RPG-F2-B/C-PROSPECTIVE 与 RPG-F3 前瞻判定' };
  }
  if (days >= WINDOW_POLICY.maximum_trading_days) {
    return { status: WINDOW_POLICY.on_insufficient_at_max, may_qualify: false, next: 'STOP · OWNER_REVIEW_REQUIRED（⛔ 不得自动降低资格标准）' };
  }
  return { status: 'ACCUMULATING_EXTENDED', may_qualify: false, next: `覆盖维度未满 ⇒ 自 120 起自动延长，上限 ${WINDOW_POLICY.maximum_trading_days}` };
}

/**
 * 校验 protocol 登记合法性（⛔ 独立 anchor、初始非权威）。
 */
function validateProspectiveProtocol(reg) {
  const r = reg || {};
  const errs = [];
  if (r.protocol_version !== PROTOCOL.protocol_version) {
    errs.push(`protocol_version 必须为 ${PROTOCOL.protocol_version}`);
  }
  if (r.replay_semantics !== PROTOCOL.replay_semantics) {
    errs.push(`replay_semantics 必须为 ${PROTOCOL.replay_semantics}`);
  }
  if (r.qualification_authoritative !== false) {
    errs.push('qualification_authoritative 初始必须为 false（⛔ agent 不得自行升格）');
  }
  if (r.anchor != null && FORBIDDEN_ANCHORS.includes(r.anchor)) {
    errs.push('⛔ anchor 复用了旧协议（V1 / V2-CF / V2-CF-COOLDOWN / V2-AE）—— 必须独立');
  }
  return { ok: errs.length === 0, errors: errs };
}

/**
 * ★ C-020 §7：OD-P-5 —— qualification_authoritative 升格前置条件（⛔ agent 不得自行升格）。
 */
function evaluateQualificationAuthoritativePromotion(st) {
  const x = st || {};
  const checks = [
    { id: 'Q1', ok: Number(x.window_trading_days) >= WINDOW_POLICY.minimum_trading_days, desc: 'prospective window ≥ 120' },
    { id: 'Q2', ok: x.dynamic_coverage_satisfied === true, desc: '所有动态覆盖条件满足' },
    { id: 'Q3', ok: x.rpg_f2_b_prospective === 'COMPLETE', desc: 'RPG-F2-B-PROSPECTIVE = COMPLETE' },
    { id: 'Q4', ok: x.rpg_f2_c_prospective === 'COMPLETE', desc: 'RPG-F2-C-PROSPECTIVE = COMPLETE' },
    { id: 'Q5', ok: x.rpg_f3_prospective_unexpected_decision_delta === 0, desc: 'RPG_F3_PROSPECTIVE_UNEXPECTED_DECISION_DELTA = 0' },
    { id: 'Q6', ok: x.full_requalification_pass === true, desc: 'Full Requalification PASS' }
  ];
  const failed = checks.filter((c) => !c.ok).map((c) => c.id);
  const eligible = failed.length === 0;
  return {
    eligible_for_owner_promotion_decision: eligible,
    // ⛔ agent 不得自行升格：即使全部满足，仍须 owner 单独裁定
    requires_owner_decision: true,
    may_agent_set_authoritative: false,
    failed_items: failed,
    checks
  };
}

/**
 * 校验 prospective coverage schema 完整性（★ C-020 §1：含 actual-book authority 校验）。
 */
function validateProspectiveCoverage(cov) {
  const c = cov || {};
  const errs = [];
  const required = [
    'required_trade_dates', 'available_trade_dates', 'missing_trade_dates',
    'actual_book_source', 'cooldown_source'
  ];
  for (const k of required) {
    if (c[k] === undefined) errs.push(`缺少字段 ${k}`);
  }
  // ⛔ 严禁 synthetic / 推断来源
  const FORBIDDEN_SOURCES = ['synthetic', 'suggested_position', 'counterfactual', 'interpolated', 'zero_position'];
  for (const k of ['actual_book_source', 'cooldown_source']) {
    if (typeof c[k] === 'string' && FORBIDDEN_SOURCES.some((s) => c[k].toLowerCase().includes(s))) {
      errs.push(`⛔ ${k} = "${c[k]}" 属禁止来源（Model B：必须来自显式实际执行账本）`);
    }
  }
  // ★ C-020 §1：actual_book_source 必须是冻结的 actual position-book 权威
  if (typeof c.actual_book_source === 'string') {
    if (c.actual_book_source.includes('run_candidate_portfolio')) {
      errs.push('⛔ actual_book_source 不得为 run_candidate_portfolio —— 审计判定其仅为 '
        + 'candidate/intended provenance，无法证明保存执行后 actual position');
    }
    if (!c.actual_book_source.includes(ACTUAL_BOOK_AUTHORITY.actual_position_book_authority)
        && !c.actual_book_source.includes('portfolio_snapshot')) {
      errs.push(`actual_book_source 必须为 ${ACTUAL_BOOK_AUTHORITY.actual_position_book_authority}`);
    }
  }
  // ★ C-020 §1：cooldown/execution 权威必须是 trade_log
  if (typeof c.cooldown_source === 'string' && !c.cooldown_source.includes(ACTUAL_BOOK_AUTHORITY.execution_authority)) {
    errs.push(`cooldown_source 必须为 ${ACTUAL_BOOK_AUTHORITY.execution_authority}`);
  }
  // missing 必须与 required - available 一致
  if (Array.isArray(c.required_trade_dates) && Array.isArray(c.available_trade_dates)
      && Array.isArray(c.missing_trade_dates)) {
    const avail = new Set(c.available_trade_dates);
    const expectMissing = c.required_trade_dates.filter((d) => !avail.has(d));
    if (JSON.stringify(expectMissing.sort()) !== JSON.stringify([...c.missing_trade_dates].sort())) {
      errs.push('missing_trade_dates 与 required - available 不一致（⛔ 不得人工裁剪）');
    }
  }
  return { ok: errs.length === 0, errors: errs };
}

module.exports = {
  PROTOCOL,
  FORBIDDEN_ANCHORS,
  GATE_ITEMS,
  ACCEPTANCE_ITEMS,
  ACTUAL_BOOK_AUTHORITY,
  ANCHOR_BINDINGS,
  RECOVERY,
  WINDOW_POLICY,
  DEPLOYMENT,
  GATE_STATUS,
  DEPLOYMENT_GATE_ITEMS,
  DEPLOYMENT_ARTIFACT_ITEMS,
  DEPLOYMENT_AUTHORIZATION_BINDING_FIELDS,
  evaluateControlledActivationGate,
  evaluateDeploymentGate,
  evaluateDeploymentAuthorizationBinding,
  evaluatePostDeployIdentity,
  evaluateFirstNaturalRunAcceptance,
  validateProspectiveProtocol,
  validateProspectiveCoverage,
  validateProspectiveAnchor,
  evaluateCasHistoryRecovery,
  evaluateProspectiveWindow,
  evaluateQualificationAuthoritativePromotion
};
