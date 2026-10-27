#!/usr/bin/env node
/**
 * C-021.1 §4 —— PRE_DEPLOY_PACKAGE_DIFF
 *
 * 以当前线上冻结 V3.6.4 package 为 PREVIOUS，与新 V3.6.5 bundle 做 deterministic diff。
 * 输出 added / modified / deleted / unchanged，并与 C-021 已批准范围交叉验证。
 *
 * 要求：UNEXPECTED_PACKAGE_DIFF = 0
 * 特别确认：
 *   · materializeIndicators changed = false
 *   · param_config semantic change = false
 *   · protected CALC files unexpected change = false
 *
 * ⛔ 只读：不 deploy / 不写生产 / 不 push。
 *    唯一副作用 = 把线上包**下载**到本地 c021/online-v364/ 作为 PREVIOUS 参考（只读通道）。
 *
 * 用法：
 *   node scripts/v365-pre-deploy-package-diff.js [--reuse-online] [--bundle <path>]
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync, execSync } = require('child_process');

// ★ C-021.1：确定性 tar / 路径映射 / ignore policy 一律引用共享模块（⛔ 不复制）
const TAR = require('./lib/v365-deterministic-tar');

const REPO = path.join(__dirname, '..');
const C021 = path.join(REPO, 'deliverables', 'v365-production-history', 'c021');
const BUNDLE_DIR = path.join(C021, 'bundle');
const ONLINE_DIR = path.join(C021, 'online-v364');
const MANIFEST_PATH = path.join(C021, 'deployment-candidate-manifest.json');
const ARTIFACT_PATH = path.join(C021, 'deployment-artifact.json');
const SCOPE_PATH = path.join(C021, 'deployment-scope.json');

const ENV_ID = 'tradingview-etf-d0fa42yy57cbc11b';
const FN_NAME = 'runDecisionEngine';

/** 冻结 V3.6.4 源码 commit（线上件身份已独立验证 == 此 commit） */
const FROZEN_V364_COMMIT = 'aa634e264270f26207c59c19ef3e1c31dde01e64';

/** ⛔ 冻结 ignore policy：非源码项，不参与 package diff */
const IGNORE_POLICY = TAR.IGNORE_POLICY;

/** ⛔ CALC 绝对保护域（任何非预期改动 ⇒ FAIL） */
const PROTECTED_CALC = Object.freeze([
  'src/common/utils/cooldown.js',
  'src/common/constants.js'
]);

/** ⛔ 默认不得修改/部署 */
const MATERIALIZE_INDICATORS = 'cloudfunctions/materializeIndicators/index.js';

const sha = TAR.sha256;
const lf = TAR.lfNormalize;
const parseTar = TAR.parseDeterministicTar;
const makeIgnoreMatcher = TAR.makeIgnoreMatcher;
const bundleToRepo = TAR.bundleToRepo;
const repoToBundle = TAR.repoToBundle;

function shaOfFile(p) { return sha(fs.readFileSync(p)); }
function shaOfFileLf(p) { return sha(lf(fs.readFileSync(p))); }

function getArg(name, dflt) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

function resolveTcbEntry() {
  const c = [
    process.env.TCB_JS_ENTRY,
    path.join(os.homedir(), '.npm-global', 'node_modules', '@cloudbase', 'cli', 'bin', 'tcb'),
    path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@cloudbase', 'cli', 'bin', 'tcb')
  ].filter(Boolean);
  for (const x of c) if (fs.existsSync(x)) return x;
  return null;
}

function walkRel(root, rel, acc) {
  const dir = rel ? path.join(root, rel) : root;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walkRel(root, r, acc);
    else acc.push(r);
  }
  return acc;
}

function main() {
  console.log('=== C-021.1 §4 PRE_DEPLOY_PACKAGE_DIFF ===');

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const artifact = JSON.parse(fs.readFileSync(ARTIFACT_PATH, 'utf8'));
  const scope = JSON.parse(fs.readFileSync(SCOPE_PATH, 'utf8'));
  const ignore = makeIgnoreMatcher(IGNORE_POLICY);

  // ── NEW 侧：解析 bundle ─────────────────────────────────
  const bundlePath = getArg('--bundle', artifact.bundle_path);
  if (!fs.existsSync(bundlePath)) {
    console.error(`⛔ bundle 不存在：${bundlePath}（先跑 v365-deployment-bundle-materialize.js）`);
    process.exit(2);
  }
  const bundleBytes = fs.readFileSync(bundlePath);
  const newFiles = new Map();  // bundlePath -> lf sha
  for (const e of parseTar(bundleBytes)) newFiles.set(e.name, sha(lf(e.buf)));
  console.log(`[new] bundle  : ${bundlePath}`);
  console.log(`[new] sha256  : ${sha(bundleBytes)}`);
  console.log(`[new] files   : ${newFiles.size}`);

  // ── PREVIOUS 侧：线上 V3.6.4 package ───────────────────
  const reuse = process.argv.includes('--reuse-online');
  const onlineFnDir = path.join(ONLINE_DIR, 'functions', FN_NAME);
  if (!reuse || !fs.existsSync(onlineFnDir)) {
    fs.rmSync(ONLINE_DIR, { recursive: true, force: true });
    fs.mkdirSync(ONLINE_DIR, { recursive: true });
    const entry = resolveTcbEntry();
    if (!entry) {
      console.error('⛔ 找不到 tcb JS 入口（TCB_JS_ENTRY）');
      process.exit(2);
    }
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

  const onlineAll = walkRel(onlineFnDir, '', []);
  const ignoredOnline = onlineAll.filter(ignore);
  const onlineSrc = onlineAll.filter((p) => !ignore(p));

  const prevFiles = new Map(); // relPath -> lf sha
  for (const p of onlineSrc) prevFiles.set(p, shaOfFileLf(path.join(onlineFnDir, p)));

  console.log(`[prev] 全部文件 ${onlineAll.length} · 源码文件 ${prevFiles.size} · 按 ignore policy 排除 ${ignoredOnline.length}`);
  console.log(`[prev] ignore policy 命中：${JSON.stringify(IGNORE_POLICY)}`);

  // ── diff 分类 ───────────────────────────────────────────
  const added = [], modified = [], deleted = [], unchanged = [];
  for (const [p, h] of newFiles) {
    if (!prevFiles.has(p)) { added.push({ path: p, new_sha256: h }); continue; }
    if (prevFiles.get(p) !== h) modified.push({ path: p, previous_sha256: prevFiles.get(p), new_sha256: h });
    else unchanged.push({ path: p, sha256: h });
  }
  for (const [p, h] of prevFiles) {
    if (!newFiles.has(p)) deleted.push({ path: p, previous_sha256: h });
  }
  added.sort((a, b) => (a.path < b.path ? -1 : 1));
  modified.sort((a, b) => (a.path < b.path ? -1 : 1));
  deleted.sort((a, b) => (a.path < b.path ? -1 : 1));

  console.log(`\n[§4] added=${added.length} modified=${modified.length} deleted=${deleted.length} unchanged=${unchanged.length}`);
  console.log('  modified:');
  for (const m of modified) console.log(`    M ${m.path}`);
  console.log('  added:');
  for (const a of added) console.log(`    A ${a.path}`);
  console.log('  deleted:');
  for (const d of deleted) console.log(`    D ${d.path}`);

  // ── 交叉验证 ①：bundle 内容 vs candidate manifest ──────
  const manMap = new Map(manifest.deployment_required_files.map((e) => [e.path, e.sha256]));
  let manifestMismatch = 0;
  for (const [bp, h] of newFiles) {
    const repo = bundleToRepo(bp);
    const full = path.join(REPO, repo);
    if (!fs.existsSync(full)) { manifestMismatch++; continue; }
    if (shaOfFileLf(full) !== h) manifestMismatch++;
    if (manMap.get(repo) !== sha(fs.readFileSync(full))) manifestMismatch++;
  }

  // ── 交叉验证 ②：bundle delta vs 源码 delta（git aa634e2 → worktree）──
  //    线上 == V3.6.4 源码（已独立验证）⇒ 两侧 delta 必须逐项一致。
  const srcDelta = { added: [], modified: [], deleted: [] };
  const manPaths = manifest.deployment_required_files.map((e) => e.path);
  for (const repo of manPaths) {
    let oldBuf = null;
    try {
      oldBuf = execSync(`git show ${FROZEN_V364_COMMIT}:${repo}`, {
        cwd: REPO, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (e) { oldBuf = null; }
    const newBuf = fs.readFileSync(path.join(REPO, repo));
    const bundleRel = repoToBundle(repo);
    if (oldBuf === null) srcDelta.added.push(bundleRel);
    else if (sha(lf(oldBuf)) !== sha(lf(newBuf))) srcDelta.modified.push(bundleRel);
  }
  // 源码侧删除：V3.6.4 commit 里存在、当前闭包已无的 src/common 文件
  const oldCommon = (() => {
    try {
      return execSync(`git ls-tree -r --name-only ${FROZEN_V364_COMMIT} -- src/common`, {
        cwd: REPO, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    } catch (e) { return []; }
  })();
  const nowCommon = new Set(manPaths.filter((p) => p.startsWith('src/common/')));
  for (const p of oldCommon) {
    if (!nowCommon.has(p)) srcDelta.deleted.push('common/' + p.slice('src/common/'.length));
  }
  srcDelta.added.sort(); srcDelta.modified.sort(); srcDelta.deleted.sort();

  const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  const deltaAddedMatch = eq(added.map((x) => x.path).sort(), srcDelta.added);
  const deltaModifiedMatch = eq(modified.map((x) => x.path).sort(), srcDelta.modified);
  const deltaDeletedMatch = eq(deleted.map((x) => x.path).sort(), srcDelta.deleted);

  // ── 交叉验证 ③：与 C-021 §3 已批准的 working-tree 闭包对账 ──
  //    C-021 §3 的 `changed_in_closure_count = 7` 是「**working tree** 变更 ∩ 闭包」；
  //    本脚本的 19 是「**已部署基线 aa634e2** → worktree 的闭包内 delta」。
  //    两者是**包含关系**：7 ⊂ 19（差集 = aa634e2→HEAD 之间**已提交**的变更）。
  const wtRaw = execSync('git status --porcelain -uall', { cwd: REPO, encoding: 'utf8' });
  const wtClosure = wtRaw.split('\n').filter(Boolean)
    .map((l) => ({ status: l.substring(0, 2).trim(), p: l.substring(3).trim() }))
    .filter((x) => x.p && !x.p.endsWith('/') && manMap.has(x.p))
    .map((x) => ({ repo_path: x.p, bundle_path: repoToBundle(x.p), status: x.status }));

  const changedSet = new Set([...added.map((x) => x.path), ...modified.map((x) => x.path)]);
  const wtNotInDelta = wtClosure.filter((x) => !changedSet.has(x.bundle_path)).map((x) => x.bundle_path);
  const wtClosureSubset = wtNotInDelta.length === 0;

  const committedDelta = [...changedSet].filter(
    (p) => !wtClosure.some((x) => x.bundle_path === p)
  ).sort();

  console.log(`\n[cross] C-021 §3 working-tree 闭包 = ${wtClosure.length}（⊂ 本 delta ${changedSet.size}）`);
  console.log(`  subset = ${wtClosureSubset}${wtNotInDelta.length ? '  ⛔ 越界: ' + JSON.stringify(wtNotInDelta) : ''}`);
  console.log(`  aa634e2→HEAD 已提交变更（闭包内）= ${committedDelta.length}`);
  for (const p of committedDelta) console.log(`     C ${p}`);

  console.log(`\n[cross] 源码 delta（git ${FROZEN_V364_COMMIT.slice(0, 7)} → worktree，闭包内）`);
  console.log(`  added=${srcDelta.added.length} modified=${srcDelta.modified.length} deleted=${srcDelta.deleted.length}`);
  console.log(`  SET_EQUAL  added=${deltaAddedMatch} modified=${deltaModifiedMatch} deleted=${deltaDeletedMatch}`);

  // ── 红线三项 ───────────────────────────────────────────
  const allDiffPaths = [
    ...added.map((x) => x.path), ...modified.map((x) => x.path), ...deleted.map((x) => x.path)
  ];
  const materializeIndicatorsChanged = allDiffPaths.some((p) => p.includes('materializeIndicators'));
  // param_config 契约承载于 constants.js（COLLECTIONS.PARAM_CONFIG / FROZEN_PARAM_KEYS）
  const paramConfigSemanticChange = allDiffPaths.includes('common/constants.js');
  const protectedCalcUnexpected = allDiffPaths
    .filter((p) => PROTECTED_CALC.includes(bundleToRepo(p)))
    .map((p) => ({ path: p, repo_path: bundleToRepo(p), expected: false }));

  const redLines = {
    materializeIndicators_changed: materializeIndicatorsChanged,
    materializeIndicators_expected: false,
    param_config_semantic_change: paramConfigSemanticChange,
    param_config_expected: false,
    protected_calc_unexpected_change: protectedCalcUnexpected.length > 0,
    protected_calc_files_changed: protectedCalcUnexpected,
    protected_calc_expected: false
  };
  console.log('\n[§4] 红线三项：');
  console.log(`  materializeIndicators changed = ${materializeIndicatorsChanged}（期望 false）`);
  console.log(`  param_config semantic change  = ${paramConfigSemanticChange}（期望 false）`);
  console.log(`  protected CALC unexpected     = ${protectedCalcUnexpected.length > 0}（期望 false）`);

  // ── UNEXPECTED_PACKAGE_DIFF ────────────────────────────
  const unexpected = [];
  if (!deltaAddedMatch) unexpected.push({ kind: 'ADDED_SET_MISMATCH' });
  if (!deltaModifiedMatch) unexpected.push({ kind: 'MODIFIED_SET_MISMATCH' });
  if (!deltaDeletedMatch) unexpected.push({ kind: 'DELETED_SET_MISMATCH' });
  if (manifestMismatch > 0) unexpected.push({ kind: 'BUNDLE_MANIFEST_MISMATCH', count: manifestMismatch });
  if (!wtClosureSubset) unexpected.push({ kind: 'WORKTREE_CLOSURE_NOT_SUBSET_OF_DELTA', files: wtNotInDelta });
  if (materializeIndicatorsChanged) unexpected.push({ kind: 'MATERIALIZE_INDICATORS_CHANGED' });
  if (paramConfigSemanticChange) unexpected.push({ kind: 'PARAM_CONFIG_SEMANTIC_CHANGE' });
  if (protectedCalcUnexpected.length > 0) unexpected.push({ kind: 'PROTECTED_CALC_CHANGED', files: protectedCalcUnexpected });

  const unexpectedCount = unexpected.length;

  const out = {
    artifact: 'v365-pre-deploy-package-diff',
    generated_at: new Date().toISOString(),
    phase: 'C-021.1',
    read_only: true,
    deployed: false,
    production_writes_performed: false,
    deployment_performed: false,

    previous: {
      identity: 'CURRENT_PRODUCTION_DEPLOYMENT_IDENTITY = V3.6.4',
      frozen_source_commit: FROZEN_V364_COMMIT,
      online_dir: path.relative(REPO, onlineFnDir).replace(/\\/g, '/'),
      all_files: onlineAll.length,
      source_files: prevFiles.size,
      ignored_by_policy: ignoredOnline
    },
    new: {
      bundle_path: path.relative(REPO, bundlePath).replace(/\\/g, '/'),
      bundle_sha256: sha(bundleBytes),
      candidate_manifest_sha: manifest.candidate_manifest_sha,
      source_files: newFiles.size
    },
    ignore_policy: IGNORE_POLICY,
    diff: {
      added_files: added,
      modified_files: modified,
      deleted_files: deleted,
      unchanged_files: unchanged,
      counts: {
        added: added.length, modified: modified.length,
        deleted: deleted.length, unchanged: unchanged.length
      }
    },
    cross_validation: {
      bundle_vs_candidate_manifest: { mismatch: manifestMismatch },
      bundle_delta_vs_source_delta: {
        frozen_commit: FROZEN_V364_COMMIT,
        source_delta: srcDelta,
        added_set_equal: deltaAddedMatch,
        modified_set_equal: deltaModifiedMatch,
        deleted_set_equal: deltaDeletedMatch
      },
      c021_working_tree_closure: {
        note: 'C-021 §3 的 changed_in_closure_count 是 working-tree ∩ 闭包；本 diff 是 aa634e2→worktree 闭包内 delta。二者为包含关系。',
        working_tree_closure_count: wtClosure.length,
        working_tree_closure: wtClosure,
        is_subset_of_delta: wtClosureSubset,
        not_in_delta: wtNotInDelta,
        committed_delta_count: committedDelta.length,
        committed_delta: committedDelta,
        reconciliation: `${changedSet.size} = ${wtClosure.length} working-tree + ${committedDelta.length} committed-since-${FROZEN_V364_COMMIT.slice(0, 7)}`
      }
    },
    red_line_checks: redLines,
    unexpected_package_diff: unexpectedCount,
    unexpected_details: unexpected,
    verdict: {
      UNEXPECTED_PACKAGE_DIFF: unexpectedCount,
      materializeIndicators_changed: materializeIndicatorsChanged,
      param_config_semantic_change: paramConfigSemanticChange,
      protected_CALC_files_unexpected_change: protectedCalcUnexpected.length > 0,
      note: '⛔ 只读 diff；本轮不得 deploy。'
    }
  };

  const outPath = path.join(C021, 'pre-deploy-package-diff.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
  console.log(`\n[out] ${outPath}`);

  const ok = unexpectedCount === 0;
  console.log(`\n=== ${ok ? 'PASS' : 'FAIL'} ===`);
  console.log(`UNEXPECTED_PACKAGE_DIFF = ${unexpectedCount}`);
  process.exit(ok ? 0 : 3);
}

main();
