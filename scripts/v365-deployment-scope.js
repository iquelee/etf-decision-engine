#!/usr/bin/env node
'use strict';

/**
 * V3.6.5 · C-021 —— DEPLOYMENT SCOPE / DEPENDENCY CLOSURE（§3 / §4 · 只读 · 纯本地）
 *
 * 目的：
 *   从 **当前 V3.6.5 candidate** 出发，计算 `runDecisionEngine` 的
 *   production package **依赖闭包**，明确：
 *     · 哪些文件必须进入 runDecisionEngine deploy package
 *     · 哪些只是 tests / scripts / docs / evidence（⛔ 不得进包）
 *
 * 事实基础（非假设）：
 *   · `cloudbaserc.json` → `functionRoot = ./dist-functions` ⇒ **部署源 = dist-functions/**
 *   · `scripts/build-cloudfunctions.js` ⇒ dist 由 3 部分构成：
 *       ① `cloudfunctions/runDecisionEngine/*`（自身源码 + 2 个 frozen artifact）
 *       ② `src/common/**`（canonical common，**整体**复制进每个函数包）
 *       ③ `EXTRA_FILES.runDecisionEngine` 指定的 `ml/manifests/GEN1_GUARDED_EFFECTIVE_*.json`
 *   · ⛔ `node_modules` / `config.json` 由 `prepare-deploy.py` 从快照恢复，不在本工具范围
 *
 * ⛔ 本脚本**只读**、⛔ 不 deploy、⛔ 不 build（只做静态闭包分析 + SHA 复算）。
 *
 * 产出：`deliverables/v365-production-history/c021/deployment-scope.json`
 *
 * 用法：
 *   node scripts/v365-deployment-scope.js [--out <path>]
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..');
const FN = 'runDecisionEngine';
const OUT = (() => {
  const i = process.argv.indexOf('--out');
  return i >= 0 ? process.argv[i + 1]
    : path.join(REPO, 'deliverables', 'v365-production-history', 'c021', 'deployment-scope.json');
})();

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const sha256File = (p) => sha256(fs.readFileSync(p));
const rel = (p) => path.relative(REPO, p).split(path.sep).join('/');

/** 递归列文件（相对路径，posix 风格） */
function walk(dir) {
  const out = [];
  (function rec(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) rec(p);
      else out.push(p);
    }
  })(dir);
  return out;
}

/* ---------- ① 从 cloudbaserc + build 脚本推导线上的部署模型 ---------- */
const cloudbaserc = JSON.parse(fs.readFileSync(path.join(REPO, 'cloudbaserc.json'), 'utf8'));
const fnCfg = (cloudbaserc.functions || []).find((f) => f.name === FN) || {};

// build 脚本的 EXTRA_FILES（显式声明，非推断）
const EXTRA_FILES_RDX = [
  'ml/manifests/GEN1_GUARDED_EFFECTIVE_FREEZE.json',
  'ml/manifests/GEN1_GUARDED_EFFECTIVE_EVIDENCE.json'
];

/* ---------- ② 计算 deploy package 的构成（三部分） ---------- */
const parts = {};

// ① 函数自身源码目录（排除 node_modules / common —— common 由 src/common 供给）
const fnDir = path.join(REPO, 'cloudfunctions', FN);
const fnOwn = walk(fnDir)
  .map(rel)
  .filter((r) => !r.includes('/node_modules/') && path.basename(r) !== 'MANIFEST.json');
parts.function_own_source = fnOwn;

// ② canonical common（src/common/**，排除 MANIFEST.json —— 它是 build 产物）
const srcCommon = path.join(REPO, 'src', 'common');
const commonFiles = walk(srcCommon).map(rel).filter((r) => path.basename(r) !== 'MANIFEST.json');
parts.canonical_common = commonFiles;

// ③ extra frozen artifacts
parts.extra_frozen_artifacts = EXTRA_FILES_RDX.slice();

const requiredFiles = [
  ...parts.function_own_source,
  ...parts.canonical_common,
  ...parts.extra_frozen_artifacts
].sort();

/* ---------- ③ 当前 worktree 变更面（74）与闭包的交集/差集 ---------- */
const { execSync } = require('child_process');
const changed = execSync('git status --porcelain -uall', { cwd: REPO, encoding: 'utf8' })
  .split('\n').filter(Boolean).map((l) => l.substring(3).trim())
  .filter((x) => x && !x.endsWith('/'));

const requiredSet = new Set(requiredFiles);
const changedSet = new Set(changed);

const changedInClosure = changed.filter((c) => requiredSet.has(c)).sort();
const changedOutsideClosure = changed.filter((c) => !requiredSet.has(c)).sort();

/* ---------- ④ 分类（为什么某些文件不进包） ---------- */
const classify = (p) => {
  if (p === '.gitignore') return 'REPO_HYGIENE';
  if (p.startsWith('docs/')) return 'DOCS';
  if (p.startsWith('tests/')) return 'TESTS';
  if (p.startsWith('scripts/')) return 'SCRIPTS_TOOLING';
  if (p.startsWith('ml/manifests/') && p.endsWith('V365_CANDIDATE_MANIFEST.json')) return 'MANIFEST_ARTIFACT';
  if (p.startsWith('cloudfunctions/')) return 'OTHER_CLOUDFUNCTION';
  return 'OTHER';
};

const excluded = changedOutsideClosure.map((p) => ({ path: p, category: classify(p) }));

/* ---------- ⑤ SHA 复算 ---------- */
const requiredWithSha = requiredFiles.map((p) => ({
  path: p,
  sha256: sha256File(path.join(REPO, p))
}));
const closureSha = sha256(requiredWithSha.map((x) => `${x.path}:${x.sha256}`).join('\n'));

/* ---------- ⑥ ⛔ 红线断言 ---------- */
const materializeTouched = changed.some((p) => p.includes('materializeIndicators'));
const calibrationTouched = changedInClosure.filter((p) =>
  /(^|\/)(cooldown|constants)\.js$/.test(p) || p.includes('runGen1ShadowEod'));

const result = {
  artifact: 'v365-deployment-scope',
  generated_at: new Date().toISOString(),
  phase: 'C-021',
  read_only: true,
  deployed: false,
  function: FN,
  deployment_model: {
    function_root: cloudbaserc.functionRoot,
    deploy_source: 'dist-functions/' + FN + '/',
    runtime: fnCfg.runtime || null,
    handler: fnCfg.handler || null,
    timeout: fnCfg.timeout || null,
    build_tool: 'scripts/build-cloudfunctions.js',
    note: '部署源为 dist-functions/**（gitignored 构建产物）；由 cloudfunctions/<fn> + src/common + EXTRA_FILES 生成。'
      + 'node_modules/config.json 由 prepare-deploy.py 从快照恢复，不在闭包内。'
  },
  closure_parts: {
    function_own_source: { count: parts.function_own_source.length, files: parts.function_own_source },
    canonical_common: { count: parts.canonical_common.length, files: parts.canonical_common },
    extra_frozen_artifacts: { count: parts.extra_frozen_artifacts.length, files: parts.extra_frozen_artifacts }
  },
  V365_DEPLOYMENT_REQUIRED_FILES: requiredFiles,
  V365_DEPLOYMENT_REQUIRED_FILES_with_sha256: requiredWithSha,
  V365_DEPLOYMENT_EXCLUDED_FILES: excluded,
  closure_summary: {
    required_file_count: requiredFiles.length,
    excluded_change_count: excluded.length,
    changed_total: changed.length,
    changed_in_closure_count: changedInClosure.length,
    changed_in_closure: changedInClosure,
    changed_outside_closure_count: changedOutsideClosure.length
  },
  dependency_closure_sha: closureSha,
  red_line_checks: {
    materializeIndicators_touched: materializeTouched,
    materializeIndicators_in_closure: requiredFiles.some((p) => p.includes('materializeIndicators')),
    calibration_files_touched_in_closure: calibrationTouched,
    note: '⛔ materializeIndicators 默认不得修改/部署；⛔ cooldown.js/constants.js 属 CALC 绝对保护。'
  },
  verdict: {
    V365_DEPLOYMENT_SCOPE: 'EXACT',
    deploy_all_74_changed_files: false,
    note: '⛔ 不得因 worktree 有 74 个变更就全量部署；必须只部署 runDecisionEngine 闭包。'
  }
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n');

/* ---------- 打印 ---------- */
console.log('== C-021 Deployment Scope / Dependency Closure（只读）==\n');
console.log('function        =', FN);
console.log('deploy_source   =', result.deployment_model.deploy_source);
console.log('runtime/handler =', fnCfg.runtime, '/', fnCfg.handler);
console.log('');
console.log('--- V365_DEPLOYMENT_REQUIRED_FILES（进包）---');
console.log('  ① function own source   =', parts.function_own_source.length);
parts.function_own_source.forEach((p) => console.log('       ' + p));
console.log('  ② canonical common      =', parts.canonical_common.length);
console.log('  ③ extra frozen artifacts=', parts.extra_frozen_artifacts.length);
parts.extra_frozen_artifacts.forEach((p) => console.log('       ' + p));
console.log('  ⇒ required total =', requiredFiles.length);
console.log('  ⇒ dependency_closure_sha =', closureSha.slice(0, 16) + '…');
console.log('');
console.log('--- V365_DEPLOYMENT_EXCLUDED_FILES（⛔ 不进包）---');
const byCat = {};
excluded.forEach((e) => { byCat[e.category] = (byCat[e.category] || 0) + 1; });
Object.entries(byCat).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
console.log('');
console.log('--- 74 变更面 × 闭包 ---');
console.log('  changed_in_closure    =', changedInClosure.length, changedInClosure);
console.log('  changed_out_of_closure=', changedOutsideClosure.length);
console.log('');
console.log('--- 红线 ---');
console.log('  materializeIndicators_touched =', materializeTouched);
console.log('  CALC files touched in closure =', JSON.stringify(calibrationTouched));
console.log('');
console.log('written =>', path.relative(REPO, OUT));
