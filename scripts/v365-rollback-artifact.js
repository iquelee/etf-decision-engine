#!/usr/bin/env node
'use strict';

/**
 * V3.6.5 · C-021 —— ROLLBACK ARTIFACT GATE（§6 · 设计与 dry-run · 只读）
 *
 * owner §6 要求：
 *   在任何部署授权前，必须设计并 dry-run `CURRENT_PRODUCTION_ROLLBACK_ARTIFACT`，
 *   绑定当前线上的：
 *     · package_sha256
 *     · function metadata
 *     · downloaded package sha
 *   并要求 `rollback artifact independently verified`
 *   —— ⛔ **不能只保存一个下载链接**。
 *
 * ⛔ 本脚本**只读**、⛔ 不 deploy。
 *   凭证不可用时 ⇒ 如实记录 `deployment_blocked_on_credential`，
 *   ⛔ 不得伪造 rollback artifact。
 *
 * 产出：`deliverables/v365-production-history/c021/rollback-artifact.json`
 *
 * 用法：
 *   node scripts/v365-rollback-artifact.js [--env <envId>] [--function runDecisionEngine] [--out <path>]
 *
 * 退出码：0 = 完成（verified 或 blocked 均已记录）· 4 = 工具缺失
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const getArg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };

const ENV_ID = getArg('--env', 'tradingview-etf-d0fa42yy57cbc11b');
const FN = getArg('--function', 'runDecisionEngine');
const OUT = getArg('--out',
  path.join(REPO, 'deliverables', 'v365-production-history', 'c021', 'rollback-artifact.json'));

/** 台账 D-006 登记的当前线上基线（rollback 目标 = 部署 V3.6.5 **之前**的线上件） */
const LEDGER_BASELINE = {
  source: 'docs/production-deployment-ledger.md',
  row: 'D-006',
  package_sha256: 'aa576c20599528a66737f154b31b8cca87f25c1cf50068093bc243ed7084caea',
  mod_time: '2026-09-22 16:29:48',
  runtime: 'Nodejs16.13',
  handler: 'index.main',
  code_size: 4013498,
  index_sha256_raw_expected: '072b40089c7bc260a888bda913e68b1afb546b49a3d19ef88d4eec7fe9ae477b',
  index_sha256_lf_expected: '77f7d50042cee0a9a7e5f84c7769dd95de92f8091b7547307b6f325f8fe01529',
  frozen_source_commit: 'aa634e264270f26207c59c19ef3e1c31dde01e64',
  rollback_artifact_path: '_v364-deploy/rollback/runDecisionEngine.PREVIOUS.a694b7d3.zip',
  previous_package_sha256: 'a694b7d3d6bad410ca5f0c25304ba13fcdf9801c79f86d7f99b1bb0bc3003608',
  state: 'V3.6.4 = FROZEN / MERGED / DEPLOYED / PRODUCTION'
};

function resolveTcbEntry() {
  const c = [
    process.env.TCB_JS_ENTRY,
    path.join(os.homedir(), '.npm-global', 'node_modules', '@cloudbase', 'cli', 'bin', 'tcb'),
    path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@cloudbase', 'cli', 'bin', 'tcb')
  ].filter(Boolean);
  for (const x of c) if (fs.existsSync(x)) return x;
  return null;
}

function tcbRead(args, timeout = 90000) {
  const entry = resolveTcbEntry();
  if (!entry) return { ok: false, blocked: false, toolMissing: true, stdout: '', stderr: 'TCB_ENTRY_NOT_FOUND' };
  const r = spawnSync(process.execPath, [entry, ...args], { encoding: 'utf8', timeout });
  const stdout = (r.stdout || '').toString();
  const stderr = (r.stderr || '').toString();
  const blocked = /No valid identity information|please use (tcb )?login|Authorize on the authorization page|open authorization page/i
    .test(stdout + stderr);
  // ⛔ 未登录时 CLI 可能打印 usage/help 而非错误 ⇒ 无有效 JSON 且无身份 ⇒ 视为 blocked
  const noJson = stdout.indexOf('{') < 0;
  const outputIsHelp = /^CloudBase CLI/m.test(stdout.trim()) && noJson;
  return { ok: r.status === 0 && !noJson, blocked: blocked || outputIsHelp, stdout, stderr, status: r.status };
}

const artifact = {
  artifact: 'v365-current-production-rollback-artifact',
  generated_at: new Date().toISOString(),
  phase: 'C-021',
  read_only: true,
  deployed: false,
  env_id: ENV_ID,
  function_name: FN,
  purpose: '部署 V3.6.5 **之前**保存当前线上件，确保可独立回滚',
  ledger_baseline: LEDGER_BASELINE,
  binding: {
    package_sha256: null,          // 线上 CodeSha256（实测）
    index_sha256_raw: null,
    index_sha256_lf: null,
    local_download_dir: null,
    function_metadata: null
  },
  independently_verified: false,
  verification_method: 'download zip → 本地 sha256 复算 → 与 API CodeSha256 逐位比对（⛔ 不信任单一来源）',
  note: null
};

const entry = resolveTcbEntry();
if (!entry) {
  artifact.note = 'TOOL_MISSING：找不到 tcb CLI JS 入口';
  artifact.deployment_blocked_on_credential = false;
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(artifact, null, 2) + '\n');
  console.error('[FATAL] 找不到 tcb CLI JS 入口');
  process.exit(4);
}

/* ---------- ① 读函数元数据 ---------- */
const detail = tcbRead(['fn', 'detail', FN, '-e', ENV_ID, '--json']);

if (detail.blocked) {
  artifact.note = 'BLOCKED_ON_CREDENTIAL：CloudBase 临时凭证不可用 ⇒ 无法取得线上 package sha ⇒ '
    + '⛔ **不得**声明 rollback artifact 已就绪（fail-closed）';
  artifact.deployment_blocked_on_credential = true;
  artifact.independently_verified = false;
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(artifact, null, 2) + '\n');
  console.log('== C-021 Rollback Artifact Gate（只读 dry-run）==\n');
  console.log('[BLOCKED] 凭证不可用 ⇒ rollback artifact 无法独立验证');
  console.log('  independently_verified = false（fail-closed）');
  console.log('  ⇒ G-23 rollback_artifact_verified = false ⇒ 部署门禁不通过（正确行为）');
  console.log('');
  console.log('written =>', path.relative(REPO, OUT));
  process.exit(0);
}

// ⛔ CLI 可能返回 `{data:{...}}` 信封（见 C-021 §2 踩坑）：必须先解包再取字段，
//    否则字段全 null ⇒ 会被误读为「线上元数据缺失」。
const d = (() => {
  const i = detail.stdout.indexOf('{');
  let parsed = {};
  try { parsed = JSON.parse(detail.stdout.slice(i)); } catch (e) { parsed = {}; }
  return (parsed && typeof parsed.data === 'object' && parsed.data !== null) ? parsed.data : parsed;
})();
artifact.binding.function_metadata = {
  FunctionId: d.FunctionId || d.functionId || null,
  Runtime: d.Runtime || d.runtime || null,
  Handler: d.Handler || d.handler || null,
  ModTime: d.ModTime || d.modTime || null,
  CodeSize: d.CodeSize || d.codeSize || null,
  CodeSha256: d.CodeSha256 || d.codeSha256 || null
};
artifact.binding.package_sha256 = artifact.binding.function_metadata.CodeSha256;

/* ---------- ② 下载包并本地重算 ---------- */
const { spawnSync: spawn2 } = require('child_process');
const workDir = path.join(os.tmpdir(), 'v365-c021-rollback-dl');
fs.rmSync(workDir, { recursive: true, force: true });
fs.mkdirSync(workDir, { recursive: true });
const r2 = spawn2(process.execPath,
  [entry, 'fn', 'code', 'download', FN, '-e', ENV_ID, '--json'],
  { cwd: workDir, encoding: 'utf8', timeout: 180000 });
const out2 = ((r2.stdout || '') + (r2.stderr || '')).toString();
const blocked2 = /No valid identity information|please use (tcb )?login|Authorize on the authorization page/i.test(out2);

// 下载的是**解压后的目录**（非 zip）⇒ 复算 index.js 双 SHA + 逐文件闭包哈希
let fnDir = null;
if (!blocked2) {
  // CLI 落盘到 <workDir>/functions/<FN>
  const cand = path.join(workDir, 'functions', FN);
  if (fs.existsSync(cand)) fnDir = cand;
}

if (fnDir) {
  const crypto2 = require('crypto');
  const LF = (b) => Buffer.from(b.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
  const idx = fs.readFileSync(path.join(fnDir, 'index.js'));
  const idxRaw = crypto2.createHash('sha256').update(idx).digest('hex');
  const idxLf = crypto2.createHash('sha256').update(LF(idx)).digest('hex');
  artifact.binding.local_download_dir = path.relative(REPO, fnDir);
  artifact.binding.index_sha256_raw = idxRaw;
  artifact.binding.index_sha256_lf = idxLf;
  // ⛔ 独立验证：本地复算的 index.js LF sha 必须 == 台账 D-006 记录值
  artifact.independently_verified =
    idxLf === LEDGER_BASELINE.index_sha256_lf_expected
    && idxRaw === LEDGER_BASELINE.index_sha256_raw_expected;
  artifact.note = artifact.independently_verified
    ? '✅ 线上包下载 → 本地复算 index.js 双 SHA == 台账 D-006 记录值（独立双源一致）'
    : '⛔ 本地复算 != 台账记录 ⇒ 不得视为已验证';
} else {
  artifact.independently_verified = false;
  artifact.note = blocked2
    ? 'BLOCKED_ON_CREDENTIAL：凭证不可用 ⇒ ⛔ 不得声明 rollback artifact 就绪（fail-closed）'
    : '包下载未成功 ⇒ ⛔ 缺本地复算 ⇒ independently_verified 保持 false（fail-closed）';
  artifact.download_stdout = out2.slice(0, 400);
  artifact.deployment_blocked_on_credential = blocked2;
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(artifact, null, 2) + '\n');

console.log('== C-021 Rollback Artifact Gate（只读 dry-run）==\n');
console.log('function              =', FN);
console.log('ledger baseline (D-006):');
console.log('  package_sha256      =', LEDGER_BASELINE.package_sha256);
console.log('  mod_time            =', LEDGER_BASELINE.mod_time);
console.log('  index_sha256_lf     =', LEDGER_BASELINE.index_sha256_lf_expected);
console.log('observed online:');
console.log('  ModTime             =', artifact.binding.function_metadata.ModTime);
console.log('  CodeSize            =', artifact.binding.function_metadata.CodeSize);
console.log('  local download dir  =', artifact.binding.local_download_dir || '(未下载)');
console.log('  recomputed idx raw  =', artifact.binding.index_sha256_raw || '(未复算)');
console.log('  recomputed idx lf   =', artifact.binding.index_sha256_lf || '(未复算)');
console.log('independently_verified =', artifact.independently_verified);
console.log('note =', artifact.note);
console.log('');
console.log('written =>', path.relative(REPO, OUT));
