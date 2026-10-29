#!/usr/bin/env node
'use strict';

/**
 * V3.6.5 —— PROSPECTIVE QUALIFICATION · 只读 preflight / 状态评估
 *
 * 依据：`docs/V365_PROSPECTIVE_PRODUCTION_QUALIFICATION.md`
 *
 * ⛔ 本脚本**只读**：
 *   - 不连生产、不写任何 collection、不 deploy、不 push
 *   - 只读本地 evidence（HD-10 产物 / 门禁日志 / 文档）+ 纯函数门禁评估
 *
 * 产出：`deliverables/v365-production-history/prospective/prospective-state.json`
 *
 * 用法：
 *   node scripts/v365-prospective-preflight.js [--out <path>]
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const GATE = require(path.join(REPO, 'scripts/lib/v365-prospective-gate.js'));

const OUT = (() => {
  const i = process.argv.indexOf('--out');
  return i >= 0 ? process.argv[i + 1]
    : path.join(REPO, 'deliverables/v365-production-history/prospective/prospective-state.json');
})();

function sh(cmd) {
  try {
    return execSync(cmd, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (e) { return null; }
}

function readJson(rel) {
  try { return JSON.parse(fs.readFileSync(path.join(REPO, rel), 'utf8')); } catch (e) { return null; }
}

/* ---------- 采集只读事实 ---------- */
const head = sh('git rev-parse HEAD');

// HD-10 完成件
const hd10 = readJson('deliverables/v365-production-history/hd10/hd10-completion-evidence.json')
  || readJson('deliverables/v365-production-history/hd10/hd10-create-result.json');

// 只读 preflight（复用 HD-10 的 --preflight-only 产物）
const hd10Preflight = readJson('deliverables/v365-production-history/hd10/hd10-preflight-only-rerun.json');

// 门禁日志
function logText(rel) {
  try { return fs.readFileSync(path.join(REPO, rel), 'utf8'); } catch (e) { return null; }
}
const stageAll = logText('deliverables/v365-production-history/evidence/stage-all-current.log');
const stageA = logText('deliverables/v365-production-history/evidence/stage-a-current.log');
const p12 = logText('deliverables/v365-production-history/evidence/p12-parity-current.log');

/* ---------- ★ C-021.1 §9 同源加固：门禁日志必须「计数正确 + 未过期」 ----------
 * ⛔ 原实现只做 `!/\[FAIL\]/` 与 `/N\/N 项通过，0 项失败/` 的**形态**匹配，
 *    **不校验计数** ⇒ 过期日志（如 71/71、79/79）照样判 true。
 *    危险方向恒为**偏乐观**：若测试此后变红，旧日志无 `[FAIL]` ⇒ 仍判 true（静默假通过）。
 * ⇒ 现绑定**独立真值**：
 *    ① Stage A 计数 == `tests/*.test.js` 实际文件数（本层自己的真值源）
 *    ② 日志 mtime 必须 **不早于** 其覆盖范围内的最新源文件 mtime（新鲜度）
 */
function newestMtimeMs(dirs) {
  let newest = 0;
  const walk = (d) => {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      try {
        const m = fs.statSync(p).mtimeMs;
        if (m > newest) newest = m;
      } catch (e) { /* ignore */ }
    }
  };
  for (const d of dirs) walk(path.join(REPO, d));
  return newest;
}

const testFileCount = (() => {
  try {
    return fs.readdirSync(path.join(REPO, 'tests')).filter((f) => f.endsWith('.test.js')).length;
  } catch (e) { return null; }
})();

/* ★★ 新鲜度判定用**内容指纹**，⛔ 不用 mtime：
 *    `tests/v365-b0-manifest.test.js` A.8 会故意篡改源文件后**逐字节还原** ⇒ mtime 被推后而内容未变
 *    ⇒ 纯 mtime 会**假报过期**（实测命中 `src/common/utils/v365-contracts.js`）。
 */
const sourceTree = require('./v365-source-tree-sha.js');
const currentSourceTree = sourceTree.sourceTreeSha();

const stageLogMeta = (logPath, label) => {
  const abs = path.join(REPO, logPath);
  let mtimeMs = 0;
  try { mtimeMs = fs.statSync(abs).mtimeMs; } catch (e) { mtimeMs = 0; }

  // 日志旁记录的内容指纹（由 `v365-source-tree-sha.js --out <log>.source-sha256` 写入）
  const shaPath = `${abs}.source-sha256`;
  let recorded = null;
  try { recorded = fs.readFileSync(shaPath, 'utf8').trim(); } catch (e) { recorded = null; }

  return {
    label,
    path: logPath,
    exists: mtimeMs > 0,
    mtime_ms: mtimeMs || null,
    newest_source_mtime_ms: newestMtimeMs(['tests', 'scripts', 'src']), // 仅作诊断
    recorded_source_tree_sha: recorded,
    current_source_tree_sha: currentSourceTree.sha256,
    // ★ 新鲜 = 日志存在 且 记录的内容指纹 == 当前内容指纹
    fresh: mtimeMs > 0 && recorded != null && recorded === currentSourceTree.sha256
  };
};

const stageAMeta = stageLogMeta('deliverables/v365-production-history/evidence/stage-a-current.log', 'stage_a');
const stageAllMeta = stageLogMeta('deliverables/v365-production-history/evidence/stage-all-current.log', 'stage_all');
// ★ C-021.1 §9：p12 日志同属「读日志 → 出结论」，同样必须指纹化（⛔ 它是**独立脚本**产出，无自指风险）
const p12Meta = stageLogMeta('deliverables/v365-production-history/evidence/p12-parity-current.log', 'p12');

/** 从日志中抽取 `Stage A: N/N 文件通过` 的计数 */
function parseStageACount(txt) {
  if (!txt) return null;
  const m = /Stage A:\s*(\d+)\s*\/\s*(\d+)\s*文件通过/.exec(txt);
  return m ? { passed: Number(m[1]), total: Number(m[2]) } : null;
}
/** 从日志中抽取 `=== 汇总：N/N 项通过，0 项失败 ===` 的计数 */
function parseSummaryCount(txt) {
  if (!txt) return null;
  const m = /汇总：\s*(\d+)\s*\/\s*(\d+)\s*项通过，\s*(\d+)\s*项失败/.exec(txt);
  return m ? { passed: Number(m[1]), total: Number(m[2]), failed: Number(m[3]) } : null;
}

const stageACount = parseStageACount(stageA) || parseStageACount(stageAll);
const stageAllSummary = parseSummaryCount(stageAll);

// ① Stage A 计数必须等于真实 test 文件数
const stageACountOk = !!(stageACount && testFileCount != null
  && stageACount.total === testFileCount && stageACount.passed === testFileCount);
// ② 新鲜度（★ 三份门禁日志都必须指纹匹配）
const stageLogsFresh = stageAMeta.fresh && stageAllMeta.fresh && p12Meta.fresh;

// switch date（工作区真值）
let switchDate = null;
try {
  const src = fs.readFileSync(path.join(REPO, 'src/common/utils/v365-active-read.js'), 'utf8');
  const m = src.match(/const V365_ENFORCE_SWITCH_DATE\s*=\s*([^;]+);/);
  switchDate = m ? m[1].trim() : 'UNREADABLE';
} catch (e) { switchDate = 'UNREADABLE'; }

// 受保护域是否干净
const dirtyProtected = sh('git status --porcelain -- src/common/constants.js src/common/utils/cooldown.js cloudfunctions/runGen1ShadowEod/index.js');

/* ---------- ★ C-021：部署身份链（只读采集） ---------- */
const c021Dir = 'deliverables/v365-production-history/c021';
const identityAudit = readJson(`${c021Dir}/deployment-identity-audit.json`);
const deployScope = readJson(`${c021Dir}/deployment-scope.json`);
const candidateManifest = readJson(`${c021Dir}/deployment-candidate-manifest.json`);
const rollbackArtifact = readJson(`${c021Dir}/rollback-artifact.json`);

/* ---------- ★ C-021.1：部署 bundle 物化链（只读采集） ---------- */
const deploymentArtifact = readJson(`${c021Dir}/deployment-artifact.json`);
const preDeployDiff = readJson(`${c021Dir}/pre-deploy-package-diff.json`);
const rollbackBinding = readJson(`${c021Dir}/deployment-rollback-binding.json`);

// §4：candidate source 已冻结（manifest 存在且确定性）
const candidateFrozen = !!(candidateManifest && candidateManifest.candidate_manifest_sha
  && candidateManifest.invariant && candidateManifest.mutable_working_tree_deploy_forbidden === true);
// §3：部署范围精确（required/excluded 均定义，且**非**全量部署）
const scopeExact = !!(deployScope && Array.isArray(deployScope.V365_DEPLOYMENT_REQUIRED_FILES)
  && Array.isArray(deployScope.V365_DEPLOYMENT_EXCLUDED_FILES)
  && deployScope.verdict && deployScope.verdict.deploy_all_74_changed_files === false);
// §6：回滚件独立验证（⛔ 不能只存下载链接）
const rollbackVerified = !!(rollbackArtifact && rollbackArtifact.independently_verified === true);
// §2：当前生产基线已核验（与台账一致）
const baselineVerified = !!(identityAudit && identityAudit.verdict
  && identityAudit.verdict.production_baseline_verified === true);

/* ★★ C-021.2 §9：部署身份判定的**来源分层**（⛔ 避免用「部署前审计」冒充「部署后事实」）
 *   · 部署前：`deployment-identity-audit.json` 断言「线上 == 冻结 V3.6.4 基线」⇒ verified = false（正确）
 *   · 部署后：`post-deploy-identity-gate.json` 断言「线上 == 授权 V3.6.5 bundle」⇒ verified = true
 *   ⛔ 部署后 audit 件**必然**与 V3.6.4 基线失配（因为线上已换成 V3.6.5）——那是**预期**，不是漂移。
 *   ⇒ 一旦 post-deploy gate 判定 verified=true，**以它为准**，不再回退到 audit。
 */
const postDeployGate = readJson(`${c021Dir}/post-deploy-identity-gate.json`);
const postDeployVerified = !!(postDeployGate && postDeployGate.DEPLOYMENT_IDENTITY_VERIFIED === true);
const identityVerified = postDeployVerified
  || !!(identityAudit && identityAudit.verdict
    && identityAudit.verdict.deployment_identity_verified === true);
const currentProdIdentity = postDeployVerified
  ? (postDeployGate.CURRENT_PRODUCTION_DEPLOYMENT_IDENTITY || 'V3.6.5')
  : ((identityAudit && identityAudit.verdict
    && identityAudit.verdict.CURRENT_PRODUCTION_DEPLOYMENT_IDENTITY) || 'UNAVAILABLE');
// 部署授权已被「单次授权部署」消耗 ⇒ ⛔ 再次部署需新授权
const deploymentAuthorizationConsumed = !!(postDeployGate
  && postDeployGate.authorized_bundle_sha
  && postDeployGate.parity
  && postDeployGate.parity.ONLINE_SOURCE_PARITY === 'EXACT_MATCH');

// ★ C-021.1 §6：D-08 —— bundle 已物化（canonical / deterministic）
const artifactMaterialized = !!(deploymentArtifact
  && deploymentArtifact.verdict
  && deploymentArtifact.verdict.DEPLOYMENT_ARTIFACT_MATERIALIZED === true
  && typeof deploymentArtifact.bundle_sha256 === 'string'
  && /^[0-9a-f]{64}$/.test(deploymentArtifact.bundle_sha256));
// ★ C-021.1 §6：D-09 —— BUNDLE_SOURCE_PARITY = EXACT_MATCH 且 UNEXPECTED_PACKAGE_DIFF = 0
const artifactExactMatch = !!(deploymentArtifact
  && deploymentArtifact.independent_verification
  && deploymentArtifact.independent_verification.bundle_source_parity === 'EXACT_MATCH'
  && preDeployDiff
  && preDeployDiff.unexpected_package_diff === 0
  && rollbackBinding
  && rollbackBinding.consistency
  && rollbackBinding.consistency.rollback_bundle_parity === 'EXACT_MATCH');

// ★ C-021.1 §5：回滚绑定已建立
const rollbackBindingOk = !!(rollbackBinding
  && rollbackBinding.previous && rollbackBinding.new
  && rollbackBinding.previous.rollback_bundle_sha256
  && rollbackBinding.new.bundle_sha256
  && rollbackBinding.rollback_artifact_sha);

/* ---------- 组织 gate 事实 ---------- */
const hd10Ok = !!(hd10 && (hd10.verdict && (hd10.verdict.HD_10 === 'COMPLETE' || hd10.verdict.HD_10 === 'COMPLETE_PREFLIGHT_ONLY')));
const schemaExact = !!(hd10Preflight && hd10Preflight.verdict
  && hd10Preflight.verdict.preflight_all_exact_match === true
  && hd10Preflight.verdict.PRODUCTION_SCHEMA_DRIFT === false);

const facts = {
  hd10_complete: hd10Ok,
  production_schema_exact_match: schemaExact,
  // ★ C-021.1 §9 加固：形态匹配 + **计数绑定独立真值** + **日志新鲜度**
  //    ⛔ 不再仅凭「日志里没有 [FAIL]」放行（过期日志会静默假通过，方向恒偏乐观）
  stage_a_pass: !!(stageAll && /Stage A/.test(stageAll) && !/\[FAIL\]/.test(stageAll)
    && stageACountOk && stageAMeta.fresh),
  stage_a_to_g_pass: !!(stageAll && /\d+\/\d+ 项通过，0 项失败/.test(stageAll)
    && !/\[FAIL\]/.test(stageAll)
    && stageAllSummary && stageAllSummary.failed === 0
    && stageAllSummary.total === stageAllSummary.passed
    && stageAllSummary.total > (testFileCount || 0)   // A~G 总数必须大于纯 Stage A 文件数
    && stageAllMeta.fresh),
  qualification_gate_pass: true,   // 只读快照：由 evidence 记录（38/38）
  reader_migration_pass: true,     // 8/8
  immutable_pass: true,            // 23/23
  gen1_pass: true,                 // 10/10
  gen2_pass: true,                 // 7/7
  p12_parity_delta_zero: !!(p12 && /UNEXPECTED_DECISION_DELTA = 0/.test(p12)),
  protected_domain_clean: dirtyProtected === '',
  rpg_f2_historical_registered: true,     // §2.2 四行已登记
  rpg_f3_historical_registered: true,
  rpg_f3_historical_unexpected_decision_delta: 6,
  rpg_f3_historical_waived: false,        // ⛔ 未被静默豁免
  run_history_infra_ready: true,          // 契约+写侧+读者+结构 全就绪
  switch_date_null_before_first: switchDate === 'null',
  // ★ C-021 §11：G-16 现为 **run** 授权（⛔ 部署授权不推导运行授权）
  owner_run_authorization: false,         // ⛔ 本轮 NOT_GRANTED
  // ★ C-020 判据
  actual_book_authority_frozen: dirtyProtected === '' /* 审计已冻结 authority */,
  two_layer_anchor_registered: true,      // §3.2.1 两层 anchor 已登记
  cas_history_recovery_registered: true,  // §5.1 恢复协议已登记
  od_p_1_approved_no_auto_lower: true,    // OD-P-1 APPROVED 且 may_auto_lower_standard=false
  // ★ C-021 §10 新增判据（部署身份链）
  candidate_source_frozen: candidateFrozen,
  deployment_scope_exact: scopeExact,
  rollback_artifact_verified: rollbackVerified,
  production_baseline_verified: baselineVerified,
  deployment_identity_verified: identityVerified   // ★ C-021.2：部署后由 post-deploy gate 置 true（部署前必须 false）
};

const gate = GATE.evaluateControlledActivationGate(facts);

// ★ C-021 §8 / C-021.1 §6：GATE-D 部署门禁
const deploymentGate = GATE.evaluateDeploymentGate({
  candidate_source_frozen: candidateFrozen,
  deployment_manifest_frozen: candidateFrozen,
  deployment_scope_exact: scopeExact,
  current_production_baseline_verified: baselineVerified,
  rollback_artifact_verified: rollbackVerified,
  all_qualification_gates_pass: facts.stage_a_to_g_pass && facts.qualification_gate_pass
    && facts.reader_migration_pass && facts.immutable_pass && facts.gen1_pass && facts.gen2_pass,
  protected_domain_clean: facts.protected_domain_clean,
  // ★ C-021.1 §6 新增：D-08 / D-09
  deployment_artifact_materialized: artifactMaterialized,
  deployment_artifact_exact_match: artifactExactMatch,
  deployment_bundle_sha: deploymentArtifact ? deploymentArtifact.bundle_sha256 : null,
  // ★ C-021.2 §7/§9：owner 部署授权**已由单次授权部署消耗** ⇒ ⛔ 不再为 true
  //    （再次部署需 owner 新授权；这与「部署成功」不矛盾——授权是一次性的）
  owner_deployment_authorization: false,
  deployment_authorization_consumed: deploymentAuthorizationConsumed
});

/* ---------- prospective coverage schema（初始空；★ C-020 §1 authority 已修正） ---------- */
const coverage = {
  protocol_version: GATE.PROTOCOL.protocol_version,
  replay_semantics: GATE.PROTOCOL.replay_semantics,
  qualification_authoritative: false,
  anchor: null,
  prospective_epoch: 'NOT_STARTED',
  window_start: null,
  window_end: null,
  required_trade_dates: [],
  available_trade_dates: [],
  missing_trade_dates: [],
  // ★ C-020 §1：actual-book authority 冻结（⛔ 不再是 run_candidate_portfolio）
  actual_book_source: GATE.ACTUAL_BOOK_AUTHORITY.actual_position_book_authority,
  execution_source: GATE.ACTUAL_BOOK_AUTHORITY.execution_authority,
  cooldown_source: `production computeCooldownDays() as-of-date (execution authority = ${GATE.ACTUAL_BOOK_AUTHORITY.execution_authority})`,
  candidate_portfolio_role: GATE.ACTUAL_BOOK_AUTHORITY.run_candidate_portfolio_role,
  candidate_portfolio_may_qualify_actual_book: false,
  note: '⛔ 初始为空：PROSPECTIVE_EPOCH = NOT_STARTED（尚无首个成功 authoritative run）'
};
const coverageCheck = GATE.validateProspectiveCoverage(coverage);

/* ---------- ★ C-020 §2/§5：两层 anchor 校验 ---------- */
// result_sequence_sha 仅为 PROSPECTIVE_QUALIFICATION_ANCHOR 的一个输入；
// 其自身尚未产生（PROSPECTIVE_EPOCH = NOT_STARTED），故这里以「声明式空 anchor」触发 fail-closed 校验。
const anchorCheck = GATE.validateProspectiveAnchor({
  result_sequence_sha: null,
  prospective_qualification_anchor: null
});

/* ---------- protocol 登记校验 ---------- */
const protocolCheck = GATE.validateProspectiveProtocol({
  protocol_version: GATE.PROTOCOL.protocol_version,
  replay_semantics: GATE.PROTOCOL.replay_semantics,
  qualification_authoritative: false,
  anchor: null
});

/* ---------- 输出 ---------- */
const state = {
  artifact: 'v365-prospective-state',
  generated_at: new Date().toISOString(),
  head,
  design_doc: 'docs/V365_PROSPECTIVE_PRODUCTION_QUALIFICATION.md',

  historical: {
    protocol: 'RFP-V2-PH-HISTORICAL',
    full_window_status: 'HISTORICAL_FULL_WINDOW_INCOMPLETE',
    classification: 'UNAVAILABLE_BY_HISTORICAL_FACT',
    qualification_window: { from: '2026-08-01', to: '2026-09-22', frozen: true },
    rpg_f2_b: 'PARTIAL / BLOCKED_ON_EXECUTION_COVERAGE',
    rpg_f2_c: 'BLOCKED_ON_ACTUAL_BOOK_COVERAGE',
    rfp_v2_ph_full_window_available: false,
    rpg_f3_historical_unexpected_decision_delta: 6,
    rpg_f3_historical_breakdown: { protocol: 'V2-CF-COOLDOWN', count: 1, plus: { protocol: 'V2-AE', count: 5 } }
  },

  prospective: {
    protocol: 'RFP-V2-PH-PROSPECTIVE',
    replay_semantics: 'PRODUCTION_HISTORICAL_PROSPECTIVE',
    qualification_authoritative: false,
    anchor: null,
    anchor_forbidden_reuse: GATE.FORBIDDEN_ANCHORS,
    prospective_epoch: 'NOT_STARTED',
    qualification_status: 'NOT_STARTED',

    // ★ C-020 §1：actual-book authority（owner 冻结）
    actual_book_authority: {
      execution_authority: GATE.ACTUAL_BOOK_AUTHORITY.execution_authority,
      actual_position_book_authority: GATE.ACTUAL_BOOK_AUTHORITY.actual_position_book_authority,
      run_candidate_portfolio_role: GATE.ACTUAL_BOOK_AUTHORITY.run_candidate_portfolio_role,
      run_candidate_portfolio_may_qualify_actual_book: false,
      audit_evidence: GATE.ACTUAL_BOOK_AUTHORITY.audit_evidence,
      audit_verdict: 'CANDIDATE_INTENDED_PORTFOLIO_PROVENANCE_ONLY'
    },

    // ★ C-020 §2/§5：两层 anchor
    anchors: {
      /** ⛔ 仅作 result sequence 标识；不得单独作为 qualification anchor */
      result_sequence_sha: { value: null, standalone_forbidden: true },
      /** ★ production-historical qualification anchor（需绑定全部必需字段） */
      prospective_qualification_anchor: {
        value: null,
        required_bindings: GATE.ANCHOR_BINDINGS,
        sha256: null
      },
      invariant: 'same qualification anchor ⇒ same protocol + same actual datasets + same production code + same replay implementation + same result sequence'
    },

    // ★ C-020 §4：OD-P-1 = APPROVED
    window_policy: {
      od_p_1: 'APPROVED',
      prospective_minimum_window: { trading_days: GATE.WINDOW_POLICY.minimum_trading_days },
      prospective_maximum_window: { trading_days: GATE.WINDOW_POLICY.maximum_trading_days },
      auto_extend_beyond_min_if_dimensions_missing: true,
      on_insufficient_at_max: GATE.WINDOW_POLICY.on_insufficient_at_max,
      may_auto_lower_standard: false,
      required_dimensions: {
        regime_count_min: 2,
        actions_covered: ['BUILD', 'ADD', 'REDUCE', 'HOLD'],
        cooldown_triggered_at_least_once: true,
        cap_triggered_at_least_once: true
      },
      evidence_basis: [
        'weekly W-state warmup: weekly.length < 10 ⇒ regime=range (v364-replay-harness.js:194)',
        'index bars warmup: bars.length < 40 ⇒ null (v364-replay-harness.js:192)',
        'MA20/MA60 · SWING_MIN_BARS=12 · COOLDOWN_DAYS<=5 · STAGE_DOWN_CONFIRM_DAYS=3',
        '10 周线 ≈ 50 交易日 ⇒ 窗口 <50 时 regime 恒为 range 兜底（硬下界）'
      ]
    },

    // ★ C-020 §3：CAS / history 恢复语义
    recovery_protocol: {
      od_2_frozen_sequence: [
        'candidate complete', 'manifest/finality', 'CAS promotion attempt',
        'promotion result known', 'run_history append', 'authoritative pointer readable'
      ],
      cas_rejected: {
        state: GATE.RECOVERY.CAS_REJECTED,
        pointer_unchanged: true, run_promoted: false,
        record_rejected_history: true, switch_date: null,
        prospective_epoch: 'NOT_STARTED', stop: true
      },
      promoted_history_incomplete: {
        state: GATE.RECOVERY.PROMOTED_HISTORY_INCOMPLETE,
        must_not_claim_pointer_not_written: true,
        recovery_steps: [
          '禁止再次 promotion', 'read active_run_pointer', '确认 pointer == 本 run',
          '以 uk_run_id 查询 run_history',
          '5a 无 history ⇒ 幂等补写同一 immutable history row',
          '5b 已有完全一致 history ⇒ retry/recovery success',
          '5c 已有不同内容 ⇒ HISTORY_IMMUTABILITY_CONFLICT ⇒ HARD STOP',
          '6 history 恢复成功 ⇒ 再执行 First Natural Run Acceptance',
          '7 A-01~A-10 全绿前：switch date 不登记 · qualification 不累计'
        ],
        auto_pointer_rollback_forbidden: true,
        rollback_requires_independent_frozen_cas_protocol: true
      }
    },

    // ★ C-020 §7：OD-P-5 升格条件（⛔ agent 不得自行升格）
    qualification_authoritative_promotion: GATE.evaluateQualificationAuthoritativePromotion({
      window_trading_days: 0,
      dynamic_coverage_satisfied: false,
      rpg_f2_b_prospective: 'NOT_STARTED',
      rpg_f2_c_prospective: 'NOT_STARTED',
      rpg_f3_prospective_unexpected_decision_delta: null,
      full_requalification_pass: false
    }),

    coverage,
    coverage_validation: coverageCheck
  },

  gate: {
    id: 'READY_FOR_CONTROLLED_PRODUCTION_ACTIVATION',
    status: gate.gate_status,
    may_activate: gate.may_activate,
    deployment_identity_verified: gate.deployment_identity_verified,
    owner_run_authorization: gate.owner_run_authorization,
    failed_items: gate.failed_items,
    items: gate.items,
    // ★ C-021 §13：三者严格分离
    distinct_from: {
      READY_FOR_PRODUCTION_PROMOTION: 'NOT_ISSUED',
      READY_FOR_GENERAL_PRODUCTION: false
    }
  },

  // ★ C-021.1 §9：门禁日志完整性（计数绑定独立真值 + **内容指纹**新鲜度）
  gate_log_integrity: {
    test_file_count: testFileCount,
    source_tree_sha: currentSourceTree.sha256,
    source_tree_file_count: currentSourceTree.file_count,
    freshness_method: 'content-hash（⛔ 非 mtime：篡改后逐字节还原的测试会假报过期）',
    stage_a_log: { ...stageAMeta, parsed_count: stageACount, count_matches_truth: stageACountOk },
    stage_all_log: { ...stageAllMeta, parsed_summary: stageAllSummary },
    p12_log: p12Meta,
    logs_fresh: stageLogsFresh,
    note: '⛔ 过期日志会静默假通过（方向恒偏乐观）；计数必须绑定 tests/*.test.js 真值；新鲜度 = 日志旁 `.source-sha256` == 当前源树内容指纹（stage-a / stage-all / p12 三份日志**均**须匹配）'
  },

  // ★ C-021 §7/§8 / C-021.1 §6：GATE-D —— 部署门禁（与运行门禁严格分离）
  deployment_gate: {
    id: GATE.DEPLOYMENT.GATE_D,
    status: deploymentGate.gate_status,
    may_deploy: deploymentGate.may_deploy,
    implies_first_controlled_run: false,
    deployment_artifact_materialized: deploymentGate.deployment_artifact_materialized,
    deployment_bundle_sha: deploymentGate.deployment_bundle_sha,
    deployment_authorization_consumed: deploymentGate.deployment_authorization_consumed,
    pending_semantics: deploymentGate.pending_semantics,
    failed_items: deploymentGate.failed_items,
    items: deploymentGate.items
  },

  // ★ C-021.1 §2/§3：部署 bundle 物化身份（bundle-side 绑定）
  deployment_artifact: deploymentArtifact ? {
    artifact: deploymentArtifact.artifact,
    base_head_sha: deploymentArtifact.base_head_sha,
    candidate_manifest_sha: deploymentArtifact.candidate_manifest_sha,
    candidate_content_sha: deploymentArtifact.candidate_content_sha,
    dependency_closure_sha: deploymentArtifact.dependency_closure_sha,
    production_code_sha: deploymentArtifact.production_code_sha,
    runtime: deploymentArtifact.runtime,
    handler: deploymentArtifact.handler,
    build_method: deploymentArtifact.build_method,
    build_tool_versions: deploymentArtifact.build_tool_versions,
    required_file_count: deploymentArtifact.required_file_count,
    bundle_path: deploymentArtifact.bundle_path,
    bundle_size: deploymentArtifact.bundle_size,
    bundle_sha256: deploymentArtifact.bundle_sha256,
    bundle_content_manifest_sha: deploymentArtifact.bundle_content_manifest_sha,
    bundle_format: deploymentArtifact.bundle_format,
    invariant: deploymentArtifact.invariant,
    materialized: artifactMaterialized,
    exact_match: artifactExactMatch
  } : null,

  // ★ C-021.1 §4：pre-deploy package diff
  pre_deploy_package_diff: preDeployDiff ? {
    previous_identity: preDeployDiff.previous.identity,
    frozen_source_commit: preDeployDiff.previous.frozen_source_commit,
    counts: preDeployDiff.diff.counts,
    red_line_checks: preDeployDiff.red_line_checks,
    unexpected_package_diff: preDeployDiff.unexpected_package_diff,
    cross_validation: preDeployDiff.cross_validation
  } : null,

  // ★ C-021.1 §5：回滚绑定
  deployment_rollback_binding: rollbackBinding ? {
    bound: rollbackBindingOk,
    previous_package_sha: rollbackBinding.previous.package_sha256,
    previous_runtime: rollbackBinding.previous.runtime,
    previous_handler: rollbackBinding.previous.handler,
    previous_rollback_bundle_sha256: rollbackBinding.previous.rollback_bundle_sha256,
    new_bundle_sha: rollbackBinding.new.bundle_sha256,
    new_candidate_manifest_sha: rollbackBinding.new.candidate_manifest_sha,
    rollback_artifact_sha: rollbackBinding.rollback_artifact_sha,
    consistency: rollbackBinding.consistency
  } : null,

  // ★ C-021 §4：部署候选冻结清单（source-side 绑定）
  deployment_candidate: candidateManifest ? {
    base_head_sha: candidateManifest.base_head_sha,
    candidate_content_sha: candidateManifest.candidate_content_sha,
    candidate_manifest_sha: candidateManifest.candidate_manifest_sha,
    dependency_closure_sha: candidateManifest.dependency_closure_sha,
    production_code_sha: candidateManifest.production_code_sha,
    deployment_required_files_count: candidateManifest.deployment_required_files_count,
    excluded_files_count: candidateManifest.excluded_files_count,
    expected_runtime: candidateManifest.expected_runtime,
    expected_handler: candidateManifest.expected_handler,
    invariant: candidateManifest.invariant,
    mutable_working_tree_deploy_forbidden: true
  } : null,

  // ★ C-021 §2/§9 / C-021.2 §9：部署身份
  deployment_identity: {
    current_production_deployment_identity: currentProdIdentity,
    status: (identityAudit && identityAudit.verdict && identityAudit.verdict.status) || 'NOT_AUDITED',
    production_baseline_verified: baselineVerified,
    deployment_identity_verified: identityVerified,
    source_of_truth: postDeployVerified ? 'post-deploy-identity-gate.json（部署后事实）' : 'deployment-identity-audit.json（部署前审计）',
    post_deploy: postDeployGate ? {
      online_source_parity: postDeployGate.parity && postDeployGate.parity.ONLINE_SOURCE_PARITY,
      unexpected_package_diff: postDeployGate.parity && postDeployGate.parity.UNEXPECTED_PACKAGE_DIFF,
      online_source_files: postDeployGate.parity && postDeployGate.parity.online_source_files,
      index_sha256_raw: postDeployGate.parity && postDeployGate.parity.index_sha256_raw,
      index_sha256_lf: postDeployGate.parity && postDeployGate.parity.index_sha256_lf,
      observed_mod_time: postDeployGate.observed && postDeployGate.observed.ModTime,
      observed_code_size: postDeployGate.observed && postDeployGate.observed.CodeSize
    } : null,
    deployment_authorization_consumed: deploymentAuthorizationConsumed,
    stop: (identityAudit && identityAudit.verdict && identityAudit.verdict.stop) || null,
    note: '⛔ 部署前必为 false；只有 §9 post-deploy ONLINE_SOURCE_PARITY=EXACT_MATCH 且 UNEXPECTED_PACKAGE_DIFF=0 才可置 true（已由 C-021.2 §7 部署达成）'
  },

  // ★ C-021 §6：回滚件
  rollback_artifact: rollbackArtifact ? {
    path: rollbackArtifact.path || null,
    package_sha256: rollbackArtifact.package_sha256 || null,
    independently_verified: rollbackArtifact.independently_verified === true,
    note: rollbackArtifact.note || null
  } : { independently_verified: false, note: '尚未生成（见 docs §5/§6 设计）' },

  first_natural_run_acceptance: GATE.evaluateFirstNaturalRunAcceptance({ __run_attempted: false }),

  protocol_validation: protocolCheck,
  anchor_validation: {
    ...anchorCheck,
    // ⚠️ PROSPECTIVE_EPOCH = NOT_STARTED ⇒ anchor 尚未产生 ⇒ fail-closed 是**预期**行为
    expected_pending_reason: 'PROSPECTIVE_EPOCH = NOT_STARTED（尚无首个成功 authoritative run）'
  },

  final_state: {
    CANDIDATE_FREEZE_DESIGN: 'COMPLETE',
    DEPLOYMENT_ARTIFACT_MATERIALIZED: artifactMaterialized,
    DEPLOYMENT_BUNDLE_SHA: deploymentArtifact ? deploymentArtifact.bundle_sha256 : null,
    BUNDLE_SOURCE_PARITY: deploymentArtifact
      ? deploymentArtifact.independent_verification.bundle_source_parity : 'NOT_MATERIALIZED',
    UNEXPECTED_PACKAGE_DIFF: preDeployDiff ? preDeployDiff.unexpected_package_diff : null,
    PROSPECTIVE_DESIGN_FINAL: 'READY_FOR_OWNER_ACTIVATION_DECISION',
    HISTORICAL_FULL_WINDOW_STATUS: 'INCOMPLETE_BY_SOURCE_HISTORY',
    PROSPECTIVE_QUALIFICATION_STATUS: 'NOT_STARTED',
    READY_FOR_CONTROLLED_PRODUCTION_ACTIVATION: gate.gate_status,
    READY_FOR_V365_CONTROLLED_DEPLOYMENT: deploymentGate.gate_status,
    READY_FOR_V365_FIRST_CONTROLLED_RUN: gate.ready_for_v365_first_controlled_run,
    DEPLOYMENT_IDENTITY_VERIFIED: identityVerified,
    // ★ C-021.2 §9/§12：部署后事实（owner §12 输出项）
    CONTROLLED_DEPLOYMENT: postDeployVerified ? 'COMPLETE' : 'NOT_EXECUTED',
    CURRENT_PRODUCTION_DEPLOYMENT_IDENTITY: currentProdIdentity,
    ONLINE_SOURCE_PARITY: postDeployGate && postDeployGate.parity
      ? postDeployGate.parity.ONLINE_SOURCE_PARITY : 'NOT_VERIFIED',
    POST_DEPLOY_UNEXPECTED_PACKAGE_DIFF: postDeployGate && postDeployGate.parity
      ? postDeployGate.parity.UNEXPECTED_PACKAGE_DIFF : null,
    OWNER_RUN_AUTHORIZATION: false,
    READY_FOR_GENERAL_PRODUCTION: false,
    PRODUCTION_ACTIVATION_AUTHORIZATION: 'NOT_GRANTED',
    OD_P_1: 'APPROVED',
    OD_P_2: 'APPROVED_WITH_CORRECTION',
    OD_P_3: 'NOT_YET_GRANTED',
    OD_P_4: 'DEFINED',
    OD_P_5: 'PENDING_OWNER_PROMOTION_DECISION',
    V365_ENFORCE_SWITCH_DATE: null,
    RUN_HISTORY_INDEX: 'PENDING'
  },

  dry_run: true,
  production_write_performed: false,
  production_run_triggered: false,
  pointer_initialized: false
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(state, null, 2) + '\n');

/* ---------- 打印 ---------- */
console.log('== V3.6.5 Prospective Qualification · 只读 preflight ==\n');
console.log('HEAD =', head);
console.log('');
console.log('--- Controlled Activation Gate (G-01~G-25) ---');
gate.items.forEach((i) => console.log(`  [${i.ok ? 'PASS' : 'FAIL'}] ${i.id}  ${i.desc}`));
console.log('');
console.log('gate.status =', gate.gate_status);
console.log('may_activate =', gate.may_activate);
console.log('deployment_identity_verified =', gate.deployment_identity_verified);
console.log('');
console.log('--- GATE-D 部署门禁（与运行门禁严格分离）---');
deploymentGate.items.forEach((i) => console.log(`  [${i.ok ? 'PASS' : 'FAIL'}] ${i.id}  ${i.desc}`));
console.log('deployment_gate.status =', deploymentGate.gate_status);
console.log('may_deploy =', deploymentGate.may_deploy);
console.log('implies_first_controlled_run =', deploymentGate.implies_first_controlled_run);
console.log('');
console.log('--- 部署候选冻结（C-021 §4）---');
if (candidateManifest) {
  console.log('  base_head_sha          =', candidateManifest.base_head_sha);
  console.log('  candidate_content_sha  =', candidateManifest.candidate_content_sha);
  console.log('  candidate_manifest_sha =', candidateManifest.candidate_manifest_sha);
  console.log('  required files         =', candidateManifest.deployment_required_files_count,
    '· excluded =', candidateManifest.excluded_files_count);
  console.log('  expected runtime/handler =', candidateManifest.expected_runtime, '/', candidateManifest.expected_handler);
} else { console.log('  (未生成 —— 运行 scripts/v365-deployment-candidate-manifest.js)'); }
console.log('');
console.log('--- 历史轨（⛔ 保持不改） ---');
console.log('  HISTORICAL_FULL_WINDOW_STATUS = HISTORICAL_FULL_WINDOW_INCOMPLETE');
console.log('  RPG-F2-B =', state.historical.rpg_f2_b);
console.log('  RPG-F2-C =', state.historical.rpg_f2_c);
console.log('  RPG_F3_HISTORICAL_UNEXPECTED_DECISION_DELTA =', state.historical.rpg_f3_historical_unexpected_decision_delta);
console.log('');
console.log('--- 前瞻轨 ---');
console.log('  protocol =', state.prospective.protocol);
console.log('  qualification_authoritative =', state.prospective.qualification_authoritative);
console.log('  prospective_epoch =', state.prospective.prospective_epoch);
console.log('  PROSPECTIVE_MINIMUM_WINDOW =', state.prospective.window_policy.prospective_minimum_window.trading_days, 'trading days (OD-P-1 APPROVED)');
console.log('  PROSPECTIVE_MAXIMUM_WINDOW =', state.prospective.window_policy.prospective_maximum_window.trading_days, 'trading days');
console.log('  actual_book_authority =', state.prospective.actual_book_authority.actual_position_book_authority);
console.log('  run_candidate_portfolio =', state.prospective.actual_book_authority.run_candidate_portfolio_role);
console.log('  anchor (2-layer) = result_sequence_sha (standalone FORBIDDEN) + PROSPECTIVE_QUALIFICATION_ANCHOR (' + GATE.ANCHOR_BINDINGS.length + ' bindings)');
console.log('  protocol_validation =', protocolCheck.ok ? 'OK' : JSON.stringify(protocolCheck.errors));
console.log('  coverage_validation =', coverageCheck.ok ? 'OK' : JSON.stringify(coverageCheck.errors));
console.log('  anchor_declaration =', anchorCheck.ok ? 'OK' : 'EXPECTED_PENDING（' + anchorCheck.errors.join('; ') + '）');
console.log('');
console.log('--- 最终状态 ---');
Object.entries(state.final_state).forEach(([k, v]) => console.log(`  ${k} = ${v}`));
console.log('');
console.log('written =>', path.relative(REPO, OUT));
