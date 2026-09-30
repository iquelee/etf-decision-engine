#!/usr/bin/env node
/**
 * C-021.1 §5 —— DEPLOYMENT_ROLLBACK_BINDING
 *
 * 把 PREVIOUS_PRODUCTION_PACKAGE_SHA 与 NEW_V365_BUNDLE_SHA 放进**同一个 deployment plan**。
 *
 * 至少绑定：
 *   previous_package_sha / previous_runtime / previous_handler
 *   new_bundle_sha / new_candidate_manifest_sha
 *   rollback_artifact_sha
 *
 * ⛔ 只读：不 deploy / 不写生产 / 不 push。
 *    副作用仅 = 把当前线上 V3.6.4 包下载到本地并物化 canonical rollback bundle（只读通道）。
 *
 * 用法：
 *   node scripts/v365-deployment-rollback-binding.js [--reuse-online]
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const TAR = require('./lib/v365-deterministic-tar');

const REPO = path.join(__dirname, '..');
const C021 = path.join(REPO, 'deliverables', 'v365-production-history', 'c021');
const ONLINE_DIR = path.join(C021, 'online-v364');
const ROLLBACK_OUT = path.join(C021, 'rollback');
const ARTIFACT_PATH = path.join(C021, 'deployment-artifact.json');
const MANIFEST_PATH = path.join(C021, 'deployment-candidate-manifest.json');
const ROLLBACK_JSON = path.join(C021, 'rollback-artifact.json');
const AUDIT_PATH = path.join(C021, 'deployment-identity-audit.json');

const ENV_ID = 'tradingview-etf-d0fa42yy57cbc11b';
const FN_NAME = 'runDecisionEngine';

/** D-006 台账登记的线上包 sha（V3.6.4） */
const LEDGER_PACKAGE_SHA = 'aa576c20599528a66737f154b31b8cca87f25c1cf50068093bc243ed7084caea';
const FROZEN_V364_COMMIT = 'aa634e264270f26207c59c19ef3e1c31dde01e64';

/** 历史回滚快照（V3.6.4 部署前保存，用于回滚 V3.6.4 那次部署） */
const HISTORICAL_ROLLBACK_ZIP =
  'D:/AI-Projects/Codex/etf-decision-engine/_v364-deploy/rollback/runDecisionEngine.PREVIOUS.a694b7d3.zip';

const sha = TAR.sha256;
const ignore = TAR.makeIgnoreMatcher(TAR.IGNORE_POLICY);

function resolveTcbEntry() {
  const c = [
    process.env.TCB_JS_ENTRY,
    path.join(os.homedir(), '.npm-global', 'node_modules', '@cloudbase', 'cli', 'bin', 'tcb'),
    path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@cloudbase', 'cli', 'bin', 'tcb')
  ].filter(Boolean);
  for (const x of c) if (fs.existsSync(x)) return x;
  return null;
}

function main() {
  console.log('=== C-021.1 §5 DEPLOYMENT_ROLLBACK_BINDING ===');

  const artifact = JSON.parse(fs.readFileSync(ARTIFACT_PATH, 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const rollbackJson = JSON.parse(fs.readFileSync(ROLLBACK_JSON, 'utf8'));
  const audit = JSON.parse(fs.readFileSync(AUDIT_PATH, 'utf8'));

  const newBundleSha = artifact.bundle_sha256;
  const onlineFnDir = path.join(ONLINE_DIR, 'functions', FN_NAME);

  // ── 确保线上包已在本地（PREVIOUS 参考）───────────────
  const reuse = process.argv.includes('--reuse-online');
  if (!reuse || !fs.existsSync(onlineFnDir)) {
    fs.rmSync(ONLINE_DIR, { recursive: true, force: true });
    fs.mkdirSync(ONLINE_DIR, { recursive: true });
    const entry = resolveTcbEntry();
    if (!entry) { console.error('⛔ 找不到 tcb JS 入口'); process.exit(2); }
    console.log(`[prev] 下载线上包 → ${ONLINE_DIR}`);
    const r = spawnSync(process.execPath,
      [entry, 'fn', 'code', 'download', FN_NAME, '-e', ENV_ID, '--json'],
      { cwd: ONLINE_DIR, encoding: 'utf8', timeout: 180000 });
    if (r.status !== 0 || !fs.existsSync(onlineFnDir)) {
      console.error('⛔ 下载失败：', (r.stdout || '') + (r.stderr || ''));
      process.exit(2);
    }
  } else {
    console.log(`[prev] 复用已下载线上包 → ${onlineFnDir}`);
  }

  // ── 物化 canonical rollback bundle（V3.6.4 源码级）───
  const all = TAR.walkRel(onlineFnDir, '', []);
  const srcFiles = all.filter((p) => !ignore(p)).sort();
  const entries = srcFiles.map((p) => ({ name: p, buf: fs.readFileSync(path.join(onlineFnDir, p)) }));
  const rollbackTar = TAR.buildDeterministicTar(entries);
  const rollbackBundleSha = sha(rollbackTar);

  fs.rmSync(ROLLBACK_OUT, { recursive: true, force: true });
  fs.mkdirSync(ROLLBACK_OUT, { recursive: true });
  const rollbackBundlePath = path.join(ROLLBACK_OUT, `runDecisionEngine.V364.${rollbackBundleSha.slice(0, 12)}.tar`);
  fs.writeFileSync(rollbackBundlePath, rollbackTar);

  const rollbackFiles = srcFiles.map((p) => {
    const buf = fs.readFileSync(path.join(onlineFnDir, p));
    return { path: p, sha256: TAR.sha256Lf(buf), raw_sha256: sha(buf), bytes: buf.length };
  });
  const rollbackContentManifestSha = TAR.contentManifestSha(rollbackFiles);

  // ── 独立复核：重新解包并重算 ────────────────────────
  const reparsed = TAR.parseDeterministicTar(fs.readFileSync(rollbackBundlePath));
  const reMap = new Map(reparsed.map((e) => [e.name, TAR.sha256Lf(e.buf)]));
  const reDiff = rollbackFiles.filter((f) => reMap.get(f.path) !== f.sha256);
  const rollbackParity = (reparsed.length === rollbackFiles.length && reDiff.length === 0)
    ? 'EXACT_MATCH' : 'MISMATCH';

  // ── 关键：rollback bundle 的 LF sha 必须匹配台账 D-006 的 index.js 双 sha ──
  const idxEntry = rollbackFiles.find((f) => f.path === 'index.js');
  const idxRawOk = idxEntry && idxEntry.raw_sha256 === rollbackJson.ledger_baseline.index_sha256_raw_expected;
  const idxLfOk = idxEntry && idxEntry.sha256 === rollbackJson.ledger_baseline.index_sha256_lf_expected;

  console.log(`[rollback] files          = ${rollbackFiles.length}`);
  console.log(`[rollback] bundle_sha256  = ${rollbackBundleSha}`);
  console.log(`[rollback] content_manifest_sha = ${rollbackContentManifestSha}`);
  console.log(`[rollback] parity         = ${rollbackParity}`);
  console.log(`[rollback] index.js raw == 台账 D-006 : ${idxRawOk}`);
  console.log(`[rollback] index.js lf  == 台账 D-006 : ${idxLfOk}`);

  // ── rollback_artifact_sha：锚定到具体证据文件字节 ────
  const rollbackArtifactSha = sha(fs.readFileSync(ROLLBACK_JSON));

  // ── DEPLOYMENT_ROLLBACK_BINDING ──────────────────────
  const binding = {
    artifact: 'v365-deployment-rollback-binding',
    generated_at: new Date().toISOString(),
    phase: 'C-021.1',
    purpose: '把 PREVIOUS 与 NEW 放进同一个 deployment plan，确保任一方可独立回滚/核验',
    read_only: true,
    deployed: false,
    production_writes_performed: false,
    deployment_performed: false,

    env_id: ENV_ID,
    function_name: FN_NAME,

    // ── PREVIOUS（当前线上 = V3.6.4）──
    previous: {
      identity: 'CURRENT_PRODUCTION_DEPLOYMENT_IDENTITY = V3.6.4',
      frozen_source_commit: FROZEN_V364_COMMIT,
      package_sha256: LEDGER_PACKAGE_SHA,               // 台账 D-006 登记值
      package_sha256_source: 'docs/production-deployment-ledger.md D-006',
      runtime: rollbackJson.ledger_baseline.runtime,     // Nodejs16.13
      handler: rollbackJson.ledger_baseline.handler,     // index.main
      mod_time: rollbackJson.ledger_baseline.mod_time,
      code_size: rollbackJson.ledger_baseline.code_size,
      rollback_bundle_path: path.relative(REPO, rollbackBundlePath).replace(/\\/g, '/'),
      rollback_bundle_sha256: rollbackBundleSha,
      rollback_bundle_size: rollbackTar.length,
      rollback_content_manifest_sha: rollbackContentManifestSha,
      rollback_source_file_count: rollbackFiles.length,
      rollback_files: rollbackFiles,
      index_sha256_raw: idxEntry ? idxEntry.raw_sha256 : null,
      index_sha256_lf: idxEntry ? idxEntry.sha256 : null,
      index_sha256_matches_ledger: { raw: !!idxRawOk, lf: !!idxLfOk },
      historical_rollback_zip: {
        path: HISTORICAL_ROLLBACK_ZIP,
        note: 'V3.6.4 部署前保存的快照（用于回滚那次部署）；⛔ 非本次 V3.6.5 部署的回滚件',
        exists: fs.existsSync(HISTORICAL_ROLLBACK_ZIP)
      }
    },

    // ── NEW（待授权部署 = V3.6.5）──
    new: {
      identity: 'V365_DEPLOYMENT_CANDIDATE',
      bundle_path: path.relative(REPO, artifact.bundle_path).replace(/\\/g, '/'),
      bundle_sha256: newBundleSha,
      bundle_size: artifact.bundle_size,
      bundle_content_manifest_sha: artifact.bundle_content_manifest_sha,
      candidate_manifest_sha: manifest.candidate_manifest_sha,
      candidate_content_sha: manifest.candidate_content_sha,
      dependency_closure_sha: manifest.dependency_closure_sha,
      production_code_sha: manifest.production_code_sha,
      base_head_sha: manifest.base_head_sha,
      runtime: manifest.expected_runtime,
      handler: manifest.expected_handler,
      required_file_count: manifest.deployment_required_files_count,
      bundle_source_parity: artifact.independent_verification.bundle_source_parity
    },

    // ── 回滚件独立验证链 ──
    rollback_artifact_sha: rollbackArtifactSha,
    rollback_artifact_path: path.relative(REPO, ROLLBACK_JSON).replace(/\\/g, '/'),
    rollback_artifact_independently_verified: rollbackJson.independently_verified === true,

    // ── 一致性断言 ──
    consistency: {
      previous_runtime_equals_new_runtime: rollbackJson.ledger_baseline.runtime === manifest.expected_runtime,
      previous_handler_equals_new_handler: rollbackJson.ledger_baseline.handler === manifest.expected_handler,
      rollback_bundle_parity: rollbackParity,
      rollback_index_matches_ledger: !!(idxRawOk && idxLfOk),
      audit_online_parity: audit.online_source_parity.parity
    },

    // ── 不变量 ──
    invariant: 'rollback 可用性 ⇒ previous_bundle_sha 与 new_bundle_sha 均可被独立复算验证',
    note: '⛔ 本轮不得 deploy；本 binding 仅供 owner 部署授权决策。'
  };

  const outPath = path.join(C021, 'deployment-rollback-binding.json');
  fs.writeFileSync(outPath, JSON.stringify(binding, null, 2) + '\n');
  console.log(`\n[out] ${outPath}`);

  const ok = rollbackParity === 'EXACT_MATCH' && idxRawOk && idxLfOk &&
             binding.consistency.previous_runtime_equals_new_runtime &&
             binding.consistency.previous_handler_equals_new_handler;
  console.log(`\n=== ${ok ? 'PASS' : 'FAIL'} ===`);
  console.log(`DEPLOYMENT_ROLLBACK_BINDING = ${ok ? 'BOUND' : 'INCONSISTENT'}`);
  console.log(`previous_package_sha        = ${LEDGER_PACKAGE_SHA}`);
  console.log(`new_bundle_sha              = ${newBundleSha}`);
  process.exit(ok ? 0 : 3);
}

main();
