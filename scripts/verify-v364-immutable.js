#!/usr/bin/env node
/**
 * V3.6.4 不可变身份链校验器（R7-IMPL-1 · 独立 verifier）。
 *
 * 为什么必须是**独立**脚本（⛔ 不得并入 scripts/verify-immutable.js）：
 *   ① verify-immutable.js 的 `23/23` 身份被 tests/gen1-ge03-regression-guard.test.js
 *      逐字钉住（`/23\/23 项锁定/`）——在该脚本里加检查项会直接打破既有 GEN1 回归门；
 *   ② 该脚本被 Stage C（test-all.js）、CI "Gate 6"、Stage G 的 G1-A 三处复用，
 *      改动会同时波及三条通道；
 *   ③ 本仓唯一同类先例（V3.6.5）用的就是「独立 verifier + 独立 CI step」。
 *
 * 本脚本只做**只读**校验：⛔ 不写任何文件、⛔ 不改 lock、⛔ 不改 anchor、⛔ 不碰 git。
 * 退出码：0 = PASS，1 = FAIL（任一错误码命中即 FAIL）。
 *
 * ⚠️ OPTION-1（R7-IMPL-10）说明：本轮**有意保留** V3.6.4 lock 的 stale 声明，
 *    因此首次运行时 `src/common/schema.js` 预期出现 `V364_CODE_HASH_MISMATCH`。
 *    这是**预期治理红**，不是实施失败；⛔ 本脚本绝不会自动修锁/自动 refreeze/把 FAIL 转成 PASS。
 *
 * 稳定错误码（机器可读）：
 *   V364_LOCK_MISSING                     lock 文件不存在
 *   V364_LOCK_SCHEMA_INVALID              lock 缺 files/sha256 或二者非精确双射
 *   V364_LOCK_ANCHOR_MISMATCH             lock 内容 ≠ L0 anchor（lock 被单侧替换/改动）
 *   V364_GENERATION_MISMATCH              lock.version ≠ L0 anchor.generation
 *   V364_DECLARED_FILE_MISSING            lock 声明的文件在磁盘上不存在
 *   V364_CODE_HASH_MISMATCH               声明文件内容 ≠ lock.sha256[path]（LF 口径）
 *   V364_BASELINE_SELF_HASH_MISMATCH      baseline 字面清单自身被改动（内容身份不自洽）
 *   V364_BASELINE_REGISTRY_MISMATCH       证据副本 registry 的 baseline 与主载体不一致
 *   V364_UNEXPECTED_SURFACE_FILE          受管面出现 baseline ∪ declared ∪ EXCL 之外的文件
 *
 * **前置阶段（baseline 自洽 / lock 存在与 schema / L0 锚 / generation）任一不成立
 *   ⇒ 立即 fail-closed 返回**：⛔ 不再把该 lock 的 files/sha256 当作声明源继续消费。
 *   理由：身份根不可信时，被污染 lock 的「声明」没有治理含义；继续消费只会把
 *   「lock 已被换掉」这一根因淹没在成百上千条次级差异里。
 *
 * 用法：node scripts/verify-v364-immutable.js [--json]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..');

/* =====================================================================
 * L0 —— V364 专属身份锚（identity anchor / root of trust）
 *
 * 本锚是 V364 身份的**主依据**：它同时钉住「lock 是哪一个字节」与「是哪一代」。
 * 任何 lock 改动（含冻结器重新生成、含手工改写）都会使 lock 的 LF-sha256 离开本锚
 * ⇒ `V364_LOCK_ANCHOR_MISMATCH` fail-closed。
 *
 * 第二载体：tests/v364-immutable-anchor-guard.test.js 内**复制**同样四字段字面量并断言相等。
 * 因此单侧改动锚（只改本文件或只改守卫测试）都会红。
 *
 * ⚠️ `freeze_commit` 是**声明式 attestation**（attestation_literal）：
 *    R7-IMPL-7 明令本 verifier ⛔ 不得依赖 git / tag 做运行时身份推断
 *    ⇒ 该字段**不被本脚本校验**，它只是把「这一代冻结对应哪个 commit」记录下来。
 *    ⛔ 不得把它当成已校验的身份边；也不得为了让它可校验而引入 git 依赖。
 * ===================================================================== */
const ROOT_ANCHOR_V364 = {
  lock_path: 'ml/manifests/V364_IMMUTABLE_LOCK.json',
  lock_sha256_lf: '0b4a95bee3470cebc7adc230291946bc598b5187d9abe1cdb5bf3f44eb91ff72',
  generation: 'V3.6.4',
  freeze_commit: 'aa634e264270f26207c59c19ef3e1c31dde01e64',
};

/** 上述锚中**仅作声明**、不由本脚本运行时校验的字段（见上方注释）。 */
const ANCHOR_ATTESTATION_ONLY_FIELDS = ['freeze_commit'];

/* =====================================================================
 * F-2 surface closure —— baseline 是「**一次生成后字面冻结**」的路径清单
 *
 * 语义（Owner BL-1 裁定，逐字口径）：
 *   baseline = 「freeze conversion 时刻已经存在、但**明确不属于** V3.6.4 frozen
 *   declaration 的文件集合」。它们**不是** V3.6.4 文件，只是当前治理边界内既有、
 *   非声明的东西。⛔ 不得把 baseline 读成「被重新声明为 V364 文件」。
 *
 * ⛔ baseline **绝不**允许在运行时重算（例如 `surface − declared`）：
 *    一旦重算，差式恒为 0 ⇒ CLOSURE 检测力归零（新增受管文件再也不会被发现）。
 *    本清单是数据，不是推导结果。
 *
 * 判据：surface − baseline − declared − EXCL = ∅（差集为空）。
 *   有残留 ⇒ 逐项 V364_UNEXPECTED_SURFACE_FILE。
 *
 * 内容身份（口径已钉死，不得两可）：POSIX 相对路径 · 字典序 · "\n" 连接 ·
 * **含尾部 LF** · UTF-8 · SHA-256 ⇒ SURFACE_BASELINE_SHA256（见下方自洽断言）。
 * ===================================================================== */
const SURFACE_BASELINE_PATHS = [
  'cloudfunctions/runDecisionEngine/package.json',
  'scripts/accept-ml-shadow-noop.js',
  'scripts/attrib-wf-exposure.js',
  'scripts/audit-gen1-sector-contract.js',
  'scripts/backtest-211.js',
  'scripts/backtest-breakout.js',
  'scripts/backtest-c2-sector.js',
  'scripts/backtest-full-engine.js',
  'scripts/backtest-gate.js',
  'scripts/backtest-volume.js',
  'scripts/build-cloudfunctions.js',
  'scripts/check-api.js',
  'scripts/check-csv-coverage.js',
  'scripts/check-dup-detail.js',
  'scripts/check-duplicates.js',
  'scripts/check-logs.js',
  'scripts/check-news.js',
  'scripts/check-state.js',
  'scripts/cleanup-evidence.js',
  'scripts/cleanup-series.js',
  'scripts/dedup-news.js',
  'scripts/deploy-adminGateway-fix.js',
  'scripts/deploy-apiGateway-action-label.js',
  'scripts/deploy-apiGateway-ml-shadow-ui.js',
  'scripts/deploy-gen1-capability-metadata.js',
  'scripts/deploy-hosting-web.js',
  'scripts/deploy-runDecisionEngine-ml-shadow.js',
  'scripts/deploy.sh',
  'scripts/deploy5.js',
  'scripts/diag-aug2026-reduce.js',
  'scripts/diag-e3-explain-audit.js',
  'scripts/diag-oos-underperform.js',
  'scripts/diag-prejul2026-path.js',
  'scripts/diag-prejuly-w4add.js',
  'scripts/diag-upday-gates.js',
  'scripts/diag-v38-followup.js',
  'scripts/diag-w-landing-quality.js',
  'scripts/diag-wstate.js',
  'scripts/establish-canonical-common.py',
  'scripts/eval-leftover.js',
  'scripts/eval-mild-split.js',
  'scripts/eval-monthly-gap.js',
  'scripts/export-etf-daily.py',
  'scripts/fetch-3ticket-history.js',
  'scripts/full-extract.js',
  'scripts/gen-gen1-golden-fixture.js',
  'scripts/gen-gen1-pipeline-lock.js',
  'scripts/gen1-canary-replay.js',
  'scripts/gen1-ge03-replay-gates.js',
  'scripts/gen1-guarded-parity-local.js',
  'scripts/gen1-health-aggregator.js',
  'scripts/gen1-production-gates.js',
  'scripts/gen1-ui-samples.js',
  'scripts/gen1/evidence-capture/README.md',
  'scripts/gen1/evidence-capture/c1_capture.py',
  'scripts/gen1/evidence-capture/c1_capture.py.v6.diff',
  'scripts/gen1/evidence-capture/c1_capture_v6_migration_test.py',
  'scripts/gen1/evidence-capture/c1_gate_redproof.py',
  'scripts/gen1/evidence-capture/checkpoint_discriminator.js',
  'scripts/gen1/evidence-capture/checkpoint_python_js_parity.py',
  'scripts/gen1/evidence-capture/fixtures/checkpoint_windows_cases.json',
  'scripts/gen1/evidence-capture/fixtures/r1_independence_cases.json',
  'scripts/gen1/evidence-capture/fixtures/r1_independence_cases_v2.json',
  'scripts/gen1/evidence-capture/fixtures/trigger_registry.json',
  'scripts/gen1/evidence-capture/fixtures/trigger_registry_cloud_observed.json',
  'scripts/gen1/evidence-capture/independence_discriminator.js',
  'scripts/gen1/evidence-capture/independence_discriminator_v2.js',
  'scripts/gen1/evidence-capture/out/v5-baseline/c1_capture.v5.py',
  'scripts/gen1/evidence-capture/out/v5-baseline/c1_gate_redproof.v5.py',
  'scripts/gen1/evidence-capture/r3_contract_consumption_test.py',
  'scripts/gen1/evidence-capture/trigger_registry.js',
  'scripts/gen1/evidence-capture/v6_c3_c2_architecture_decision_check.py',
  'scripts/gen1/evidence-capture/v6_c3_c2_preflight_check.py',
  'scripts/gen1/evidence-capture/v6_content_assertions.py',
  'scripts/gen1/evidence-capture/v6_contract_compatibility.py',
  'scripts/gen1/evidence-capture/v6_contract_tool_alignment.py',
  'scripts/gen1/evidence-capture/v6_d1d2_decision_check.py',
  'scripts/gen1/evidence-capture/v6_engine_identity_reconciliation_check.py',
  'scripts/gen1/evidence-capture/v6_final_owner_decision_check.py',
  'scripts/gen1/evidence-capture/v6_fingerprint_canonicalization_check.py',
  'scripts/gen1/evidence-capture/v6_frozen_carrier_assertions.py',
  'scripts/gen1/evidence-capture/v6_gap_dependency_plan_check.py',
  'scripts/gen1/evidence-capture/v6_health_blocker_diagnostic_check.py',
  'scripts/gen1/evidence-capture/v6_key2_immutability_check.py',
  'scripts/gen1/evidence-capture/v6_lock_authority_gate_check.py',
  'scripts/gen1/evidence-capture/v6_negative_scan.py',
  'scripts/gen1/evidence-capture/v6_owner_decision_boundary_check.py',
  'scripts/gen1/evidence-capture/v6_owner_decision_gate_check.py',
  'scripts/gen1/evidence-capture/v6_pre_launch_inventory_check.py',
  'scripts/gen1/evidence-capture/v6_r13_lc_c_c3r2_check.py',
  'scripts/gen1/evidence-capture/v6_redproof.py',
  'scripts/gen1/evidence-capture/v6_seal_binding_selfcheck.py',
  'scripts/init-collections.js',
  'scripts/invoke-rollup.js',
  'scripts/lib/bars-through.js',
  'scripts/lib/book-disclose.js',
  'scripts/lib/cash-cap.js',
  'scripts/lib/csv-coverage.js',
  'scripts/lib/decision-v39.js',
  'scripts/lib/mtm-book.js',
  'scripts/lib/shadow/README.md',
  'scripts/lib/shadow/v36/constants.js',
  'scripts/lib/shadow/v36/decision.js',
  'scripts/lib/shadow/v38/constants.js',
  'scripts/lib/shadow/v38/decision.js',
  'scripts/lib/signal-proxy.js',
  'scripts/lib/universe.js',
  'scripts/lib/v364-replay-harness.js',
  'scripts/lib/v364-swing-parity.js',
  'scripts/make-backtest-report.py',
  'scripts/migrate-position-engine.js',
  'scripts/missed-trend.js',
  'scripts/ml/assert-gen1-immutable.py',
  'scripts/ml/attribute-gen2-v2-failure-targeted.py',
  'scripts/ml/attribute-gen2-v2-failure.py',
  'scripts/ml/audit-m1a-etf-history.py',
  'scripts/ml/audit-sample-quality.py',
  'scripts/ml/audit-stage-regime-causal.js',
  'scripts/ml/build-cluster-taxonomy.py',
  'scripts/ml/build-shadow-live-events.py',
  'scripts/ml/counterfactual-fast-path.py',
  'scripts/ml/export-daily-stage-panel.js',
  'scripts/ml/export-early-transition-dataset.js',
  'scripts/ml/export-etf-daily-cloudbase.js',
  'scripts/ml/export-gen1-node-model.py',
  'scripts/ml/export-high-value-transition-dataset.js',
  'scripts/ml/export-hvt-refined-dataset.js',
  'scripts/ml/freeze-gen2-rule-bundle.py',
  'scripts/ml/freeze-hvt-a-et.py',
  'scripts/ml/gen1-capability-audit.py',
  'scripts/ml/gen1_frozen_inference.py',
  'scripts/ml/phase3-alpha-experiments.py',
  'scripts/ml/phase35-hvt-refinement.py',
  'scripts/ml/push-shadow-signals.js',
  'scripts/ml/refill-ml-train-pool-tencent.js',
  'scripts/ml/refill-ml-train-pool.py',
  'scripts/ml/screen-o2-candidates.py',
  'scripts/ml/shadow-daily-log.py',
  'scripts/ml/shadow-reconcile-outcomes.py',
  'scripts/ml/shadow-signal-halflife.py',
  'scripts/ml/shadow-summary.py',
  'scripts/ml/train-early-transition-challenger.py',
  'scripts/ops/run-shadow-eod.ps1',
  'scripts/ops/run-shadow-eod.sh',
  'scripts/pack-source.js',
  'scripts/package-lock.json',
  'scripts/package.json',
  'scripts/parity/compare.py',
  'scripts/parity/compare_gen2_scenarios.py',
  'scripts/parity/gen_fixture.py',
  'scripts/parity/run_gen2_scenarios.py',
  'scripts/parity/run_gen2_scenarios_node.js',
  'scripts/parity/run_node.js',
  'scripts/parity/run_python.py',
  'scripts/prepare-deploy.py',
  'scripts/prepare-functions.js',
  'scripts/promote-gen1-advisory.js',
  'scripts/promote-ml-shadow-observe.js',
  'scripts/promote-v361-cutover.js',
  'scripts/purge-etf.js',
  'scripts/refill-csv-eastmoney.py',
  'scripts/refill-csv-qfq.py',
  'scripts/refill-etf-daily.py',
  'scripts/render-backtest-report.js',
  'scripts/rollup-event.json',
  'scripts/run-tests.js',
  'scripts/run-v38-backtest-suite.js',
  'scripts/run-v39-experiments.js',
  'scripts/run-v43-regime-suite.js',
  'scripts/scan-secrets.js',
  'scripts/seed-data.js',
  'scripts/sensitivity-matrix.js',
  'scripts/sim-cooldown.js',
  'scripts/v361-capability-audit.js',
  'scripts/v361-r1-replay-correlation.js',
  'scripts/v361-r1-replay-portfolio-mode.js',
  'scripts/v364-candidate-manifest.js',
  'scripts/v364-freeze-manifest.js',
  'scripts/v364-gate-a-slowbreak-replay.js',
  'scripts/v364-gate-b-idempotence-replay.js',
  'scripts/v364-gate-c-swing-parity-report.js',
  'scripts/verify-apiGateway-ml-shadow-ui.js',
  'scripts/verify-dedup.js',
  'scripts/verify-gen1-pipeline.js',
  'scripts/verify-gen2-build-artifacts.js',
  'scripts/verify-gen2-dataset.py',
  'scripts/verify-immutable.js',
  'scripts/verify-state.js',
  'scripts/walk-forward-engine.js',
  'src/common/constants.js',
  'src/common/utils/admin-auth.js',
  'src/common/utils/biotech-intel.js',
  'src/common/utils/cooldown.js',
  'src/common/utils/daily-fetch-plan.js',
  'src/common/utils/datasource.js',
  'src/common/utils/db.js',
  'src/common/utils/engine-invoke.js',
  'src/common/utils/etf-profile.js',
  'src/common/utils/fetch-guard.js',
  'src/common/utils/fundamental.js',
  'src/common/utils/gateway-auth.js',
  'src/common/utils/gateway-errors.js',
  'src/common/utils/gen1-authority.js',
  'src/common/utils/gen1-canary.js',
  'src/common/utils/gen1-capability.js',
  'src/common/utils/gen1-circuit-breaker.js',
  'src/common/utils/gen1-data-health.js',
  'src/common/utils/gen1-domain-permission.js',
  'src/common/utils/gen1-economic-health.js',
  'src/common/utils/gen1-execution-boundary.js',
  'src/common/utils/gen1-guarded-seal.js',
  'src/common/utils/gen1-guarded-selector.js',
  'src/common/utils/gen1-health-state.js',
  'src/common/utils/gen1-overlay.js',
  'src/common/utils/gen1-rule-permission.js',
  'src/common/utils/gen1-safety-permission.js',
  'src/common/utils/gen1-shadow-eligibility.js',
  'src/common/utils/gen1-ui-view-model.js',
  'src/common/utils/gen1-view-model.js',
  'src/common/utils/holdings-parse.js',
  'src/common/utils/indicators.js',
  'src/common/utils/intel-refresh.js',
  'src/common/utils/live-asset.js',
  'src/common/utils/market-env-v3.js',
  'src/common/utils/market-score-components.js',
  'src/common/utils/ml-shadow.js',
  'src/common/utils/overseas-filings.js',
  'src/common/utils/pnl.js',
  'src/common/utils/position-sizing.js',
  'src/common/utils/request-validate.js',
  'src/common/utils/review-position.js',
  'src/common/utils/review-stats.js',
  'src/common/utils/shadow-v3-log.js',
  'src/common/utils/shock-filter.js',
  'src/common/utils/shock-recovery.js',
  'src/common/utils/stage-residency-diagnostics.js',
  'src/common/utils/trade-date-progress.js',
  'src/common/utils/v3-2-math-engine.js',
  'src/common/utils/v3-3-target-exposure.js',
  'src/common/utils/v3-4-stage-position-engine.js',
  'src/common/utils/v3-5-structural-engine.js',
  'src/common/utils/v3-bull-participation.js',
  'src/common/utils/v3-constants.js',
  'src/common/utils/v3-premium.js',
  'src/common/utils/v3-shadow.js',
  'src/common/utils/v3-trend-first-position.js',
];

/** baseline 条数（防静默截断；与上面的 sha256 双重钉住）。 */
const SURFACE_BASELINE_N = 246;

/** baseline 内容身份（口径见上方注释；必须在运行时复算一致，否则 fail-closed）。 */
const SURFACE_BASELINE_SHA256 = '8f8443306b8e944a5a9de29c9625c1af1e0b5ed62ddd0c366d1644e21ff2e03c';

/**
 * surface 排除集（EXCL）。
 *
 * ⚠️ 本数组必须**只**包含「功能上确实落在 governed surface 内、且必须排除」的自指产物。
 *    当前仅本 verifier 自身（落在 `scripts/` 根内）。
 *    其余本批新增文件（tests/ · ml/manifests/ · docs/）位于 governed surface **之外**
 *    ⇒ 按 Owner 裁定 ⛔ 不得为形式闭合把它们塞进本数组。
 *    扩本数组 = 收缩受管面 ⇒ 属治理动作，须显式授权。
 */
const SURFACE_EXCLUSIONS = [
  'scripts/verify-v364-immutable.js'
];

/**
 * baseline 的**证据副本**载体（R7-IMPL-5）。
 *
 * 主载体 = 本文件内嵌的 SURFACE_BASELINE_PATHS（已自洽校验）；
 * registry 只是治理/证据副本 ⇒ 方向是 **verifier 校验 registry**，
 * ⛔ 绝不是 verifier 从 registry 取 baseline。
 * 副本「存在但内容不一致」⇒ 硬红（V364_BASELINE_REGISTRY_MISMATCH），防证据分叉。
 * 副本「缺失」⇒ 仅 INFO 披露（registry 为 evidence-only；baseline 主载体不依赖它）。
 */
const BASELINE_REGISTRY_REL = 'ml/manifests/V364_LOCK_ANCHOR_REGISTRY.json';

/* =====================================================================
 * 工具
 * ===================================================================== */
/** lock 口径：CRLF→LF 归一化后再 sha256（与 V361/GEN1/GEN2 三把锁同口径）。 */
function lfNormalize(buf) {
  return buf.toString('utf8').replace(/\r\n/g, '\n');
}
function sha256LfBuffer(buf) {
  return crypto.createHash('sha256').update(lfNormalize(buf), 'utf8').digest('hex');
}
function sha256TextUtf8(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}
function absOf(rel) {
  return path.join(REPO, rel.split('/').join(path.sep));
}
/** 递归枚举目录（相对路径用 POSIX 分隔符；跳过 node_modules/.git）。 */
function walkRel(relRoot, out) {
  let ents;
  try {
    ents = fs.readdirSync(absOf(relRoot), { withFileTypes: true });
  } catch (e) {
    return;
  }
  for (let i = 0; i < ents.length; i++) {
    const name = ents[i].name;
    if (name === 'node_modules' || name === '.git') continue;
    const rel = relRoot + '/' + name;
    if (ents[i].isDirectory()) walkRel(rel, out);
    else out.push(rel);
  }
}
function canonBaseline(paths) {
  return paths.slice().sort().join('\n') + '\n';
}

/* =====================================================================
 * 校验主体
 * ===================================================================== */
function verify() {
  const errors = [];
  const infos = [];
  const add = (code, detail) => errors.push({ code: code, detail: detail });
  const info = (code, detail) => infos.push({ code: code, detail: detail });
  const result = {
    ok: false,
    errors: errors,
    infos: infos,
    codes: [],
    lock_path: ROOT_ANCHOR_V364.lock_path,
    lock_sha256_lf_expected: ROOT_ANCHOR_V364.lock_sha256_lf,
    lock_sha256_lf_actual: null,
    generation: ROOT_ANCHOR_V364.generation,
    surface_roots: [],
    surface_count: 0,
    baseline_count: SURFACE_BASELINE_PATHS.length,
    declared_count: 0,
    exclusion_in_surface: 0,
    closure_residual: 0,
    declared_checked: 0,
    attestation_only: ANCHOR_ATTESTATION_ONLY_FIELDS.slice(),
  };

  /* ---- ① baseline 自洽（字面清单不得被改动） ---- */
  const canon = canonBaseline(SURFACE_BASELINE_PATHS);
  const canonSha = sha256TextUtf8(canon);
  const sortedUnique = SURFACE_BASELINE_PATHS.slice().sort();
  const isSortedUnique = (function () {
    for (let i = 1; i < SURFACE_BASELINE_PATHS.length; i++) {
      if (SURFACE_BASELINE_PATHS[i - 1] >= SURFACE_BASELINE_PATHS[i]) return false;
    }
    return true;
  })();
  if (SURFACE_BASELINE_PATHS.length !== SURFACE_BASELINE_N) {
    add('V364_BASELINE_SELF_HASH_MISMATCH',
      'n=' + SURFACE_BASELINE_PATHS.length + ' ≠ 钉死值 ' + SURFACE_BASELINE_N);
  } else if (!isSortedUnique || sortedUnique.join('\n') !== SURFACE_BASELINE_PATHS.join('\n')) {
    add('V364_BASELINE_SELF_HASH_MISMATCH', '清单非严格字典序/含重复项');
  } else if (canonSha !== SURFACE_BASELINE_SHA256) {
    add('V364_BASELINE_SELF_HASH_MISMATCH',
      '内容 sha256=' + canonSha.slice(0, 16) + '… ≠ ' + SURFACE_BASELINE_SHA256.slice(0, 16) + '…');
  }
  result.baseline_sha256_actual = canonSha;

  /* ---- ② lock 存在 / 可解析 / schema ---- */
  const lockAbs = absOf(ROOT_ANCHOR_V364.lock_path);
  if (!fs.existsSync(lockAbs)) {
    add('V364_LOCK_MISSING', ROOT_ANCHOR_V364.lock_path);
    result.codes = errors.map(function (e) { return e.code; });
    return result;
  }
  let lockBuf;
  let lock;
  try {
    lockBuf = fs.readFileSync(lockAbs);
    lock = JSON.parse(lfNormalize(lockBuf));
  } catch (e) {
    add('V364_LOCK_SCHEMA_INVALID', 'JSON 解析失败: ' + e.message);
    result.codes = errors.map(function (e) { return e.code; });
    return result;
  }

  /* ---- ③ L0 自认证：lock 必须**就是**锚所指的那一个字节 ---- */
  result.lock_sha256_lf_actual = sha256LfBuffer(lockBuf);
  if (result.lock_sha256_lf_actual !== ROOT_ANCHOR_V364.lock_sha256_lf) {
    add('V364_LOCK_ANCHOR_MISMATCH',
      ROOT_ANCHOR_V364.lock_path + ' sha256LF=' + result.lock_sha256_lf_actual.slice(0, 16)
      + '… ≠ L0 anchor ' + ROOT_ANCHOR_V364.lock_sha256_lf.slice(0, 16) + '…');
  }
  if (String(lock.version) !== ROOT_ANCHOR_V364.generation) {
    add('V364_GENERATION_MISMATCH',
      'lock.version=' + String(lock.version) + ' ≠ anchor.generation=' + ROOT_ANCHOR_V364.generation);
  }

  /* ---- ④ declaration authority：declared 只能来自 lock 的 files/sha256 ---- */
  const files = lock.files;
  const sha256Map = lock.sha256;
  if (!files || typeof files !== 'object' || Array.isArray(files)
    || !sha256Map || typeof sha256Map !== 'object' || Array.isArray(sha256Map)) {
    add('V364_LOCK_SCHEMA_INVALID', 'files / sha256 必须都是对象');
    result.codes = errors.map(function (e) { return e.code; });
    return result;
  }
  const declKeys = Object.keys(files).sort();
  const hashKeys = Object.keys(sha256Map).sort();
  if (declKeys.length !== hashKeys.length || declKeys.join('\u0000') !== hashKeys.join('\u0000')) {
    add('V364_LOCK_SCHEMA_INVALID',
      'files 键集 ≠ sha256 键集（须精确双射）：files=' + declKeys.length + ' sha256=' + hashKeys.length);
  }
  /* ---- ★ 前置阶段 fail-closed 闸门：身份根不可信 ⇒ 立即 STOP ---- */
  if (errors.length) {
    result.codes = errors.map(function (e) { return e.code; });
    return result;
  }

  const declaredPaths = {};
  const declaredAbs = [];
  for (let i = 0; i < declKeys.length; i++) {
    const rel = String(files[declKeys[i]]);
    declaredPaths[rel] = true;
    declaredAbs.push(rel);
  }
  result.declared_count = declaredAbs.length;

  /* ---- ⑤ 逐项：存在性 + LF 口径内容 hash ---- */
  for (let i = 0; i < declKeys.length; i++) {
    const key = declKeys[i];
    const rel = String(files[key]);
    const abs = absOf(rel);
    if (!fs.existsSync(abs)) {
      add('V364_DECLARED_FILE_MISSING', key + ' → ' + rel);
      continue;
    }
    const got = sha256LfBuffer(fs.readFileSync(abs));
    result.declared_checked += 1;
    const declared = sha256Map[key] == null ? null : String(sha256Map[key]);
    if (declared !== got) {
      add('V364_CODE_HASH_MISMATCH',
        rel + ' declared=' + (declared === null ? '(missing)' : declared.slice(0, 16) + '…')
        + ' actual=' + got.slice(0, 16) + '…');
    }
  }

  /* ---- ⑥ surface 根：由 lock 自身推导（⛔ 不手工挑选） ---- */
  const rootSet = {};
  for (let i = 0; i < declaredAbs.length; i++) {
    const d = declaredAbs[i].split('/').slice(0, -1).join('/');
    if (d) rootSet[d] = true;
  }
  const roots = Object.keys(rootSet).sort();
  result.surface_roots = roots;
  const surface = [];
  for (let i = 0; i < roots.length; i++) walkRel(roots[i], surface);
  const surfaceSet = {};
  for (let i = 0; i < surface.length; i++) surfaceSet[surface[i]] = true;
  result.surface_count = Object.keys(surfaceSet).length;

  /* ---- ⑦ F-2 closure：surface − baseline − declared − EXCL ---- */
  const baseSet = {};
  for (let i = 0; i < SURFACE_BASELINE_PATHS.length; i++) baseSet[SURFACE_BASELINE_PATHS[i]] = true;
  const exclSet = {};
  for (let i = 0; i < SURFACE_EXCLUSIONS.length; i++) {
    const p = SURFACE_EXCLUSIONS[i];
    exclSet[p] = true;
    if (surfaceSet[p]) result.exclusion_in_surface += 1;
    else info('V364_EXCLUSION_NOT_IN_SURFACE', p + '（本轮无实际效果；仅提示，非 FAIL）');
  }
  const residual = [];
  const surfKeys = Object.keys(surfaceSet).sort();
  for (let i = 0; i < surfKeys.length; i++) {
    const p = surfKeys[i];
    if (baseSet[p] || declaredPaths[p] || exclSet[p]) continue;
    residual.push(p);
  }
  result.closure_residual = residual.length;
  for (let i = 0; i < residual.length; i++) {
    add('V364_UNEXPECTED_SURFACE_FILE', residual[i] + '（不在 baseline ∪ declared ∪ EXCL 内）');
  }

  /* ---- ★ baseline 证据副本（registry）一致性：副本存在即必须与主载体逐项一致 ---- */
  const regAbs = absOf(BASELINE_REGISTRY_REL);
  if (!fs.existsSync(regAbs)) {
    info('V364_BASELINE_REGISTRY_ABSENT',
      BASELINE_REGISTRY_REL + ' 不存在 ⇒ 跳过证据副本一致性核对（baseline 主载体已自洽）');
  } else {
    try {
      const reg = JSON.parse(lfNormalize(fs.readFileSync(regAbs)));
      const bl = reg.surface_baseline;
      const list = Array.isArray(bl) ? bl : (bl && Array.isArray(bl.paths) ? bl.paths : null);
      if (!list) {
        add('V364_BASELINE_REGISTRY_MISMATCH',
          'registry.surface_baseline 形态不符（应为字符串数组或 { paths: [...] }）');
      } else if (sha256TextUtf8(canonBaseline(list)) !== SURFACE_BASELINE_SHA256) {
        add('V364_BASELINE_REGISTRY_MISMATCH',
          'registry.surface_baseline 内容 sha256='
          + sha256TextUtf8(canonBaseline(list)).slice(0, 16) + '… ≠ 主载体 '
          + SURFACE_BASELINE_SHA256.slice(0, 16) + '…');
      } else if (list.slice().sort().join('\n') !== SURFACE_BASELINE_PATHS.join('\n')) {
        add('V364_BASELINE_REGISTRY_MISMATCH', 'registry.surface_baseline 与主载体逐项不等');
      }
      if (reg.surface_baseline_sha256 != null
        && String(reg.surface_baseline_sha256) !== SURFACE_BASELINE_SHA256) {
        add('V364_BASELINE_REGISTRY_MISMATCH',
          'registry.surface_baseline_sha256 字段 ≠ 主载体常量');
      }
    } catch (e) {
      add('V364_BASELINE_REGISTRY_MISMATCH', BASELINE_REGISTRY_REL + ' 不可解析: ' + e.message);
    }
  }
  result.registry_baseline_present = fs.existsSync(regAbs);

  /* ---- ⑧ 提示：baseline 内已不在盘上的条目（F-2 的已知边界，非 FAIL） ---- */
  const absent = [];
  for (let i = 0; i < SURFACE_BASELINE_PATHS.length; i++) {
    if (!surfaceSet[SURFACE_BASELINE_PATHS[i]]) absent.push(SURFACE_BASELINE_PATHS[i]);
  }
  if (absent.length) {
    info('V364_BASELINE_ENTRY_NOT_PRESENT',
      absent.length + ' 项 baseline 条目当前不在受管面（F-2 只检新增，不检删除；仅提示）');
  }
  result.baseline_absent_count = absent.length;

  result.ok = errors.length === 0;
  result.codes = errors.map(function (e) { return e.code; });
  return result;
}

/* =====================================================================
 * 输出（⛔ 不依赖终端颜色；⛔ 不写文件）
 * ===================================================================== */
function main() {
  const r = verify();
  if (process.argv.indexOf('--json') >= 0) {
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
    return;
  }

  const mark = r.ok ? 'PASS' : 'FAIL';
  console.log('[V364] L0 anchor        = ' + ROOT_ANCHOR_V364.lock_path + ' @ '
    + ROOT_ANCHOR_V364.lock_sha256_lf.slice(0, 8) + '…'
    + ROOT_ANCHOR_V364.lock_sha256_lf.slice(-4) + '  generation=' + ROOT_ANCHOR_V364.generation);
  console.log('[V364] freeze_commit    = ' + ROOT_ANCHOR_V364.freeze_commit
    + '  (attestation_literal · 本脚本不校验)');
  console.log('[V364] lock sha256LF 实读 = ' + (r.lock_sha256_lf_actual === null ? '(未读到)'
    : r.lock_sha256_lf_actual.slice(0, 8) + '…' + r.lock_sha256_lf_actual.slice(-4)));
  console.log('[V364] surface 根（由 lock 推导）= ' + r.surface_roots.join(' · '));
  console.log('[V364] closure          = |S|=' + r.surface_count + ' − |B|=' + r.baseline_count
    + ' − |D|=' + r.declared_count + ' − |EXCL∩S|=' + r.exclusion_in_surface
    + ' ⇒ residual=' + r.closure_residual);
  if (r.infos.length) {
    for (let i = 0; i < r.infos.length; i++) {
      console.log('[V364] [INFO] ' + r.infos[i].code + ': ' + r.infos[i].detail);
    }
  }
  console.log('');
  if (r.ok) {
    console.log('[PASS] V364 immutable identity chain：' + r.declared_checked + '/' + r.declared_count
      + ' 声明文件逐字节一致（LF-normalized sha256）· closure = ∅');
  } else {
    console.log('[FAIL] V364 immutable identity chain：' + r.errors.length + ' 项');
    for (let i = 0; i < r.errors.length; i++) {
      console.log('   - ' + r.errors[i].code + ': ' + r.errors[i].detail);
    }
    if (r.codes.indexOf('V364_CODE_HASH_MISMATCH') >= 0) {
      console.log('   ⚠️ 注：OPTION-1 下 lock 声明**有意保留**为 V3.6.4 冻结时的旧值；'
        + '此红是预期治理结果，⛔ 本脚本不会自动修锁/refreeze。');
    }
  }
  process.exit(r.ok ? 0 : 1);
}

if (require.main === module) main();

module.exports = {
  verify: verify,
  ROOT_ANCHOR_V364: ROOT_ANCHOR_V364,
  ANCHOR_ATTESTATION_ONLY_FIELDS: ANCHOR_ATTESTATION_ONLY_FIELDS,
  SURFACE_BASELINE_PATHS: SURFACE_BASELINE_PATHS,
  SURFACE_BASELINE_N: SURFACE_BASELINE_N,
  SURFACE_BASELINE_SHA256: SURFACE_BASELINE_SHA256,
  SURFACE_EXCLUSIONS: SURFACE_EXCLUSIONS,
  BASELINE_REGISTRY_REL: BASELINE_REGISTRY_REL,
  canonBaseline: canonBaseline,
  sha256LfBuffer: sha256LfBuffer,
  sha256TextUtf8: sha256TextUtf8,
};
