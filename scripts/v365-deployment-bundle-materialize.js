#!/usr/bin/env node
/**
 * C-021.1 §1/§2/§3 —— PRE_DEPLOY_ARTIFACT_MATERIALIZATION
 *
 * 目标：把"逻辑上的 V3.6.5 candidate"冻结成"一个确定、可验证、可授权的实际 deployment bundle"。
 *
 * ⛔ 本脚本严格只读 + 本地构建：
 *    ⛔ 不 deploy
 *    ⛔ 不执行 production run
 *    ⛔ 不初始化 pointer
 *    ⛔ 不写 production DB
 *    ⛔ 不设置 switch date
 *    ⛔ 不 push / PR / merge / tag
 *
 * §1 逐文件校验 current file sha == candidate manifest expected sha
 *    任一不一致 ⇒ STOP = CANDIDATE_SOURCE_DRIFT（⛔ 不得重新生成 manifest 适配漂移）
 * §2 产出 V365_DEPLOYMENT_ARTIFACT（含 bundle_sha256 / bundle_content_manifest_sha）
 * §3 bundle 独立复核 —— 重新解包、忽略 build 内存，重算全部 path/sha 并与 manifest 逐项比较
 *    要求 BUNDLE_SOURCE_PARITY = EXACT_MATCH
 *
 * 用法：
 *   node scripts/v365-deployment-bundle-materialize.js [--out-dir <dir>]
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// ★ C-021.1：确定性 tar / 路径映射 / ignore policy 一律引用共享模块（⛔ 不复制）
const TAR = require('./lib/v365-deterministic-tar');

const REPO = path.join(__dirname, '..');
const C021_DIR = path.join(REPO, 'deliverables', 'v365-production-history', 'c021');
const MANIFEST_PATH = path.join(C021_DIR, 'deployment-candidate-manifest.json');
const SCOPE_PATH = path.join(C021_DIR, 'deployment-scope.json');
const AUDIT_PATH = path.join(C021_DIR, 'deployment-identity-audit.json');
const ROLLBACK_PATH = path.join(C021_DIR, 'rollback-artifact.json');

const OUT_DIR = (() => {
  const i = process.argv.indexOf('--out-dir');
  return i >= 0 ? path.resolve(process.argv[i + 1]) : path.join(C021_DIR, 'bundle');
})();

/** ⛔ 冻结 ignore policy（§3 ONLINE_IRRELEVANT_ARTIFACT_DIFF） */
const IGNORE_POLICY = TAR.IGNORE_POLICY;

/** repo 路径 → bundle 内路径（共享映射，⛔ 不本地重定义） */
function repoPathToBundlePath(p) {
  const known = p === 'cloudfunctions/runDecisionEngine/index.js' ||
                p === 'cloudfunctions/runDecisionEngine/package.json' ||
                p.startsWith('src/common/') ||
                p.startsWith('ml/manifests/');
  if (!known) throw new Error(`未登记的 repo 路径形态（⛔ 不得猜测）：${p}`);
  return TAR.repoToBundle(p);
}

const sha256 = TAR.sha256;
const sha256Lf = TAR.sha256Lf;
const buildDeterministicTar = TAR.buildDeterministicTar;
const parseDeterministicTar = TAR.parseDeterministicTar;
const contentManifestSha = TAR.contentManifestSha;
const makeIgnoreMatcher = TAR.makeIgnoreMatcher;

function sha256File(p) {
  return sha256(fs.readFileSync(p));
}

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function main() {
  const manifest = readJson(MANIFEST_PATH);
  const scope = readJson(SCOPE_PATH);
  const audit = readJson(AUDIT_PATH);
  const rollback = readJson(ROLLBACK_PATH);

  console.log('=== C-021.1 PRE_DEPLOY_ARTIFACT_MATERIALIZATION ===');
  console.log(`[in] candidate manifest : ${MANIFEST_PATH}`);
  console.log(`[in] candidate_manifest_sha = ${manifest.candidate_manifest_sha}`);
  console.log(`[in] required files         = ${manifest.deployment_required_files.length}`);

  const stop = { value: null, reason: null, detail: null };

  // ─────────────────────────────────────────────────────────
  // §1 逐文件验证 current sha == manifest expected sha
  // ─────────────────────────────────────────────────────────
  const sourceDrift = [];
  const bundleEntries = [];   // { bundlePath, repoPath, sha256, bytes, buf }

  for (const e of manifest.deployment_required_files) {
    const full = path.join(REPO, e.path);
    if (!fs.existsSync(full)) {
      sourceDrift.push({ path: e.path, reason: 'MISSING_IN_REPO' });
      continue;
    }
    const buf = fs.readFileSync(full);
    const actual = sha256(buf);
    if (actual !== e.sha256) {
      sourceDrift.push({
        path: e.path, reason: 'SHA_MISMATCH', expected: e.sha256, actual
      });
      continue;
    }
    if (buf.length !== e.bytes) {
      sourceDrift.push({
        path: e.path, reason: 'BYTES_MISMATCH', expected: e.bytes, actual: buf.length
      });
      continue;
    }
    bundleEntries.push({
      bundlePath: repoPathToBundlePath(e.path),
      repoPath: e.path,
      sha256: actual,
      bytes: buf.length,
      buf
    });
  }

  console.log(`\n[§1] source verification: ok=${bundleEntries.length} drift=${sourceDrift.length}`);
  if (sourceDrift.length > 0) {
    stop.value = 'CANDIDATE_SOURCE_DRIFT';
    stop.reason = 'current file sha != candidate manifest expected sha';
    stop.detail = sourceDrift.slice(0, 50);
    console.error('⛔ STOP = CANDIDATE_SOURCE_DRIFT');
    for (const d of stop.detail) console.error('   ', JSON.stringify(d));
    console.error('⛔ 不得重新生成 manifest 来"适配"漂移。');
  }

  // 重复路径检测（⛔ 静默覆盖 = 未定义行为）
  const dupCheck = new Map();
  for (const e of bundleEntries) {
    if (dupCheck.has(e.bundlePath)) {
      stop.value = stop.value || 'BUNDLE_PATH_COLLISION';
      stop.reason = `bundle 内路径冲突：${e.bundlePath}`;
      console.error(`⛔ bundle 内路径冲突：${e.bundlePath} ← ${dupCheck.get(e.bundlePath)} / ${e.repoPath}`);
    }
    dupCheck.set(e.bundlePath, e.repoPath);
  }

  if (stop.value) {
    writeStopArtifact(stop, sourceDrift);
    process.exit(2);
  }

  // 与 scope 的 required 集合交叉校验（⛔ 必须逐路径 SET_EQUAL）
  const scopeReq = scope.V365_DEPLOYMENT_REQUIRED_FILES.slice().sort();
  const manReq = manifest.deployment_required_files.map((e) => e.path).slice().sort();
  const setEqual = scopeReq.length === manReq.length &&
    scopeReq.every((p, i) => p === manReq[i]);
  console.log(`[§1] scope.required SET_EQUAL manifest.required = ${setEqual}`);
  if (!setEqual) {
    stop.value = 'DEPLOYMENT_SCOPE_MANIFEST_MISMATCH';
    stop.reason = 'deployment-scope 与 candidate-manifest 的 required 集合不一致';
    writeStopArtifact(stop, sourceDrift);
    process.exit(2);
  }

  // ─────────────────────────────────────────────────────────
  // §2 构建 canonical bundle（确定性 tar）
  // ─────────────────────────────────────────────────────────
  rmrf(OUT_DIR);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const tarEntries = bundleEntries.map((e) => ({ name: e.bundlePath, buf: e.buf }));
  const tarBuf = buildDeterministicTar(tarEntries);
  const bundleSha = sha256(tarBuf);

  const requiredFilesOut = bundleEntries
    .map((e) => ({ path: e.bundlePath, repo_path: e.repoPath, sha256: e.sha256, bytes: e.bytes }))
    .sort((a, b) => (a.path < b.path ? -1 : 1));

  const bundleContentManifestSha = contentManifestSha(requiredFilesOut);
  const bundlePath = path.join(OUT_DIR, `runDecisionEngine.V365.${bundleSha.slice(0, 12)}.tar`);
  fs.writeFileSync(bundlePath, tarBuf);

  console.log(`\n[§2] bundle written: ${bundlePath}`);
  console.log(`[§2] bundle_size        = ${tarBuf.length}`);
  console.log(`[§2] bundle_sha256      = ${bundleSha}`);

  // ─────────────────────────────────────────────────────────
  // §3 独立复核：重新解包 + 重算（⛔ 不复用 build 阶段内存数据）
  // ─────────────────────────────────────────────────────────
  const verify = independentlyVerify(bundlePath, manifest, requiredFilesOut);
  console.log(`\n[§3] BUNDLE_SOURCE_PARITY = ${verify.bundle_source_parity}`);
  console.log(`[§3] MISSING_REQUIRED_FILE = ${verify.missing_required_file}`);
  console.log(`[§3] UNEXPECTED_FILE       = ${verify.unexpected_file}`);
  console.log(`[§3] CONTENT_DIFF          = ${verify.content_diff}`);
  console.log(`[§3] ONLINE_IRRELEVANT_ARTIFACT_DIFF = ${verify.online_irrelevant_artifact_diff}`);
  if (verify.content_diff_items.length) {
    for (const d of verify.content_diff_items.slice(0, 20)) console.error('    DIFF', JSON.stringify(d));
  }

  // ─────────────────────────────────────────────────────────
  // §2 artifact 汇总
  // ─────────────────────────────────────────────────────────
  const artifact = {
    artifact: 'v365-deployment-artifact',
    generated_at: new Date().toISOString(),
    phase: 'C-021.1',
    purpose: '把逻辑上的 V3.6.5 candidate 冻结成确定、可验证、可授权的实际 deployment bundle',
    read_only_source: true,
    deployed: false,
    production_writes_performed: false,
    deployment_performed: false,
    production_run_performed: false,

    // ── source-side identity（继承 C-021 §4）──
    base_head_sha: manifest.base_head_sha,
    candidate_manifest_sha: manifest.candidate_manifest_sha,
    candidate_content_sha: manifest.candidate_content_sha,
    dependency_closure_sha: manifest.dependency_closure_sha,
    production_code_sha: manifest.production_code_sha,
    common_closure_sha: manifest.common_closure_sha,
    extra_artifacts_sha: manifest.extra_artifacts_sha,

    // ── runtime contract ──
    runtime: manifest.expected_runtime,
    handler: manifest.expected_handler,
    build_method: manifest.build_method,
    build_tool_versions: manifest.build_tool_versions,

    // ── bundle-side identity（★ 本轮新增）──
    required_file_count: requiredFilesOut.length,
    required_files: requiredFilesOut,
    bundle_path: bundlePath,
    bundle_size: tarBuf.length,
    bundle_sha256: bundleSha,
    bundle_content_manifest_sha: bundleContentManifestSha,
    bundle_format: 'ustar-deterministic (mtime=0 / uid=0 / gid=0 / mode=0644)',
    created_at: new Date().toISOString(),

    // ── §3 独立复核 ──
    independent_verification: verify,

    // ── §1 source verification ──
    source_verification: {
      checked_at: new Date().toISOString(),
      method: '逐文件 sha256(current file) == manifest.deployment_required_files[].sha256',
      required_count: manifest.deployment_required_files.length,
      verified_ok: bundleEntries.length,
      drift_count: sourceDrift.length,
      drift: sourceDrift,
      scope_manifest_set_equal: setEqual
    },

    // ── 不变量 ──
    invariant: 'same deployment_bundle_sha256 ⇒ same deployable bytes',
    invariant_detail: Object.freeze({
      bundle_sha256: 'sha256(deterministic tar of the 91 required files)',
      bundle_content_manifest_sha: 'sha256(sorted (path,sha256,bytes) triples)',
      determinism: 'tar 内 mtime/uid/gid/mode 全部固定 ⇒ 纯内容哈希'
    }),
    mutable_working_tree_deploy_forbidden: true,

    // ── 引用件（只读，不重算）──
    refs: {
      candidate_manifest_path: path.relative(REPO, MANIFEST_PATH).replace(/\\/g, '/'),
      deployment_scope_path: path.relative(REPO, SCOPE_PATH).replace(/\\/g, '/'),
      production_identity_audit_path: path.relative(REPO, AUDIT_PATH).replace(/\\/g, '/'),
      rollback_artifact_path: path.relative(REPO, ROLLBACK_PATH).replace(/\\/g, '/')
    },

    stop: stop.value || null,
    verdict: {
      DEPLOYMENT_ARTIFACT_MATERIALIZED: verify.bundle_source_parity === 'EXACT_MATCH',
      BUNDLE_SOURCE_PARITY: verify.bundle_source_parity,
      DEPLOYMENT_BUNDLE_SHA: bundleSha,
      candidate_source_drift: sourceDrift.length > 0,
      note: '⛔ 本轮不得 deploy —— bundle 生成仅供 owner 授权决策'
    }
  };

  const artifactPath = path.join(C021_DIR, 'deployment-artifact.json');
  fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2) + '\n');
  console.log(`\n[out] ${artifactPath}`);

  // 独立 bundle 内容清单（供外部复核，不依赖本项目代码）
  const listingPath = path.join(OUT_DIR, 'BUNDLE-CONTENT-MANIFEST.txt');
  fs.writeFileSync(
    listingPath,
    requiredFilesOut.map((e) => `${e.sha256}  ${String(e.bytes).padStart(8)}  ${e.path}`).join('\n') + '\n'
  );
  fs.writeFileSync(
    path.join(OUT_DIR, 'BUNDLE-SHA256.txt'),
    [
      `bundle_sha256                = ${bundleSha}`,
      `bundle_content_manifest_sha  = ${bundleContentManifestSha}`,
      `candidate_manifest_sha       = ${manifest.candidate_manifest_sha}`,
      `base_head_sha                = ${manifest.base_head_sha}`,
      `required_file_count          = ${requiredFilesOut.length}`,
      `bundle_size                  = ${tarBuf.length}`,
      ''
    ].join('\n')
  );

  const ok = verify.bundle_source_parity === 'EXACT_MATCH' &&
             verify.missing_required_file === 0 &&
             verify.unexpected_file === 0 &&
             verify.content_diff === 0;
  console.log(`\n=== ${ok ? 'PASS' : 'FAIL'} ===`);
  console.log(`DEPLOYMENT_ARTIFACT_MATERIALIZED = ${ok}`);
  console.log(`DEPLOYMENT_BUNDLE_SHA            = ${bundleSha}`);
  console.log(`BUNDLE_SOURCE_PARITY             = ${verify.bundle_source_parity}`);
  process.exit(ok ? 0 : 3);
}

/**
 * §3 独立复核 —— 从磁盘上**重新读取** bundle 字节并**独立解析**，
 *     ⛔ 不复用 build 阶段的内存对象。
 */
function independentlyVerify(bundlePath, manifest, expectedFiles) {
  const bytes = fs.readFileSync(bundlePath);   // ← 重新读盘
  const parsed = parseDeterministicTar(bytes); // ← 独立解析（独立实现，不引用 build 侧函数）

  const byPath = new Map();
  for (const e of parsed) byPath.set(e.name, e.buf);

  const expectedByPath = new Map();
  for (const e of expectedFiles) expectedByPath.set(e.path, e);

  const missing = [];
  const contentDiff = [];
  const ignoreMatcher = makeIgnoreMatcher(IGNORE_POLICY);

  for (const [p, exp] of expectedByPath) {
    if (!byPath.has(p)) { missing.push(p); continue; }
    const buf = byPath.get(p);
    const h = sha256(buf);
    if (h !== exp.sha256) {
      contentDiff.push({ path: p, expected: exp.sha256, actual: h, kind: 'SHA_MISMATCH' });
    }
  }

  const unexpected = [];
  for (const p of byPath.keys()) {
    if (!expectedByPath.has(p)) unexpected.push(p);
  }

  // ONLINE_IRRELEVANT_ARTIFACT_DIFF：按冻结 ignore policy 统计被忽略项
  const ignored = unexpected.filter((p) => ignoreMatcher(p));
  const trulyUnexpected = unexpected.filter((p) => !ignoreMatcher(p));

  // runtime-relevant 关键文件
  const idx = byPath.get('index.js');
  const indexRaw = idx ? sha256(idx) : null;
  const indexLf = idx ? sha256Lf(idx) : null;

  const parity = (missing.length === 0 && trulyUnexpected.length === 0 && contentDiff.length === 0)
    ? 'EXACT_MATCH' : 'MISMATCH';

  return {
    method: 'read bundle bytes from disk → parse tar independently → recompute all sha256',
    reused_build_memory: false,
    parsed_file_count: parsed.length,
    missing_required_file: missing.length,
    missing_files: missing,
    unexpected_file: trulyUnexpected.length,
    unexpected_files: trulyUnexpected,
    online_irrelevant_artifact_diff: ignored.length,
    online_irrelevant_artifact_files: ignored,
    ignore_policy: IGNORE_POLICY,
    content_diff: contentDiff.length,
    content_diff_items: contentDiff,
    index_sha256_raw: indexRaw,
    index_sha256_lf: indexLf,
    runtime_relevant_file_set: ['index.js', 'package.json', 'common/**', '<extra frozen artifacts>'],
    bundle_source_parity: parity,
    totals: {
      expected_files: expectedByPath.size,
      parsed_files: parsed.length
    }
  };
}

/** 独立的最小 ustar 解析器 —— ⛔ 已移至共享模块（见 scripts/lib/v365-deterministic-tar.js） */

function writeStopArtifact(stop, drift) {
  const p = path.join(C021_DIR, 'deployment-artifact.STOP.json');
  fs.writeFileSync(p, JSON.stringify({
    artifact: 'v365-deployment-artifact.STOP',
    generated_at: new Date().toISOString(),
    phase: 'C-021.1',
    stop: stop.value,
    reason: stop.reason,
    detail: stop.detail || drift,
    note: '⛔ 不得重新生成 manifest 来"适配"漂移；必须先由 owner 裁决漂移来源。'
  }, null, 2) + '\n');
  console.error(`[out] ${p}`);
}

main();
