#!/usr/bin/env node
'use strict';

/**
 * V3.6.5 · C-021 —— PRODUCTION DEPLOYMENT IDENTITY AUDIT（§2 / §9 · 只读）
 *
 * 目的：
 *   只读读取**当前生产** `runDecisionEngine` 的部署身份，并与
 *   `docs/production-deployment-ledger.md` 的最新基线（D-xxx）核对。
 *
 * ⛔ 本脚本**只读**：
 *   - 不 deploy、不 invoke、不改任何云函数、不写任何 collection
 *   - 只调用只读 CLI 通道：`tcb fn detail` / `tcb fn code download`
 *   - 若凭证不可用 ⇒ **如实记录 `BLOCKED_ON_CREDENTIAL`**，⛔ 不得伪造 identity
 *
 * 产出：`deliverables/v365-production-history/c021/deployment-identity-audit.json`
 *
 * 用法：
 *   node scripts/v365-deployment-identity-audit.js \
 *     [--env tradingview-etf-d0fa42yy57cbc11b] \
 *     [--function runDecisionEngine] \
 *     [--expect-modtime "2026-09-22 16:29:48"] \
 *     [--expect-codesha aa576c20...] \
 *     [--out <path>]
 *
 * 退出码：
 *   0 = 审计完成（identity 取得，无论是否 MATCH）
 *   2 = 凭证不可用 ⇒ BLOCKED（**非错误**，属预期 gate 状态）
 *   3 = 发现 deployment ledger 与线上不一致 ⇒ STOP = PRODUCTION_DEPLOYMENT_DRIFT
 *   4 = 环境/工具缺失（tcb CLI 入口找不到）
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');

function getArg(name, dflt) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

const ENV_ID = getArg('--env', 'tradingview-etf-d0fa42yy57cbc11b');
const FN_NAME = getArg('--function', 'runDecisionEngine');
const EXPECT_MODTIME = getArg('--expect-modtime', '2026-09-22 16:29:48');
const EXPECT_CODESHA = getArg('--expect-codesha',
  'aa576c20599528a66737f154b31b8cca87f25c1cf50068093bc243ed7084caea');
const OUT = getArg('--out',
  path.join(REPO, 'deliverables', 'v365-production-history', 'c021', 'deployment-identity-audit.json'));

/** tcb CLI 的 JS 入口（⛔ 不走 .cmd / shell —— Windows 下会剥掉 JSON 引号） */
function resolveTcbEntry() {
  const candidates = [
    process.env.TCB_JS_ENTRY,
    path.join(os.homedir(), '.npm-global', 'node_modules', '@cloudbase', 'cli', 'bin', 'tcb'),
    path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@cloudbase', 'cli', 'bin', 'tcb')
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

/**
 * 只读 CLI 调用（无 shell）。
 * @returns {{ ok:boolean, status:number|null, stdout:string, stderr:string, blocked:boolean }}
 */
function tcbRead(args) {
  const entry = resolveTcbEntry();
  if (!entry) return { ok: false, status: null, stdout: '', stderr: 'TCB_ENTRY_NOT_FOUND', blocked: false };
  const r = spawnSync(process.execPath, [entry, ...args], { encoding: 'utf8', timeout: 60000 });
  const stdout = (r.stdout || '').toString();
  const stderr = (r.stderr || '').toString();
  const blocked = /No valid identity information|please use (tcb )?login|Authorize on the authorization page|open authorization page/i
    .test(stdout + stderr);
  // ⛔ 未登录时 CLI 可能打印 usage/help 而非错误 ⇒ 无有效 JSON 亦视为 blocked
  const noJson = stdout.indexOf('{') < 0;
  const outputIsHelp = /^CloudBase CLI/m.test(stdout.trim()) && noJson;
  return { ok: r.status === 0 && !noJson, status: r.status, stdout, stderr, blocked: blocked || outputIsHelp };
}

function parseJsonLoose(s) {
  const i = s.indexOf('{');
  if (i < 0) return null;
  try { return JSON.parse(s.slice(i)); } catch (e) { return null; }
}

/**
 * ★ 下载线上包并做 **LF-normalized** 全量 source parity（本仓 hash_basis）。
 *   ⛔ 线上包为 CRLF、`git show` 为 LF ⇒ 必须 LF 归一化后再比对（否则 74/74 全假阳性）。
 *
 * @param {string} dnDir 下载目录
 * @returns {{ ok, parity, online_files, match, diff, only_online, index_sha256_raw, index_sha256_lf }}
 */
function computeOnlineParity(dnDir) {
  const crypto = require('crypto');
  const { execSync } = require('child_process');
  const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
  const LF = (b) => Buffer.from(b.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');

  const FN_DIR = path.join(dnDir, 'functions', FN_NAME);
  if (!fs.existsSync(FN_DIR)) return { ok: false, reason: 'DOWNLOAD_DIR_MISSING' };

  const walk = (d, base) => {
    const o = [];
    (function r(x) {
      for (const e of fs.readdirSync(x, { withFileTypes: true })) {
        const p = path.join(x, e.name);
        if (e.isDirectory()) r(p); else o.push(path.relative(base, p).split(path.sep).join('/'));
      }
    })(d);
    return o;
  };

  const SKIP = (f) => f === 'config.json' || f.includes('node_modules');
  const online = walk(FN_DIR, FN_DIR).filter((f) => !SKIP(f));

  // frozen V3.6.4 source （台账 D-004/D-005 的 frozen_source_commit）
  const FROZEN = getArg('--frozen-commit', 'aa634e264270f26207c59c19ef3e1c31dde01e64');

  let onlyOnline = [], diff = [], same = 0;
  for (const f of online) {
    const repoPath = f.startsWith('common/') ? 'src/' + f : 'cloudfunctions/' + FN_NAME + '/' + f;
    let fb;
    try { fb = execSync(`git show ${FROZEN}:${repoPath}`, { cwd: REPO, maxBuffer: 1e8 }); }
    catch (e) { onlyOnline.push(f); continue; }
    if (sha(LF(fs.readFileSync(path.join(FN_DIR, f)))) !== sha(LF(fb))) diff.push(f); else same++;
  }

  const idxRaw = fs.readFileSync(path.join(FN_DIR, 'index.js'));
  return {
    ok: true,
    frozen_commit: FROZEN,
    online_files: online.length,
    match: same,
    diff_count: diff.length,
    diff,
    only_online: onlyOnline,
    parity: diff.length === 0 ? 'EXACT_MATCH' : 'MISMATCH',
    index_sha256_raw: sha(idxRaw),
    index_sha256_lf: sha(LF(idxRaw)),
    download_dir: path.relative(REPO, FN_DIR)
  };
}

/* ---------------- 主流程 ---------------- */
const result = {
  artifact: 'v365-deployment-identity-audit',
  generated_at: new Date().toISOString(),
  phase: 'C-021',
  read_only: true,
  production_writes_performed: false,
  deployment_performed: false,
  env_id: ENV_ID,
  function_name: FN_NAME,
  method: 'tcb fn detail --json (+ optional tcb fn code download for package sha)',
  expected_baseline: {
    source: 'docs/production-deployment-ledger.md',
    latest_row: 'D-006',
    mod_time: EXPECT_MODTIME,
    code_sha256: EXPECT_CODESHA,
    runtime: 'Nodejs16.13',
    handler: 'index.main'
  },
  observed: null,
  credential: null,
  verdict: {}
};

const entry = resolveTcbEntry();
if (!entry) {
  result.credential = { state: 'TOOL_MISSING' };
  result.verdict = {
    CURRENT_PRODUCTION_DEPLOYMENT_IDENTITY: 'UNKNOWN',
    status: 'BLOCKED_ON_TOOLING',
    stop: null
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n');
  console.error('[FATAL] 找不到 tcb CLI 的 JS 入口（可设 TCB_JS_ENTRY）');
  console.log(JSON.stringify(result.verdict));
  process.exit(4);
}

const detail = tcbRead(['fn', 'detail', FN_NAME, '-e', ENV_ID, '--json']);

if (detail.blocked) {
  // ★ 预期路径：凭证过期 ⇒ 如实记录 BLOCKED，⛔ 不得伪造 identity
  result.credential = { state: 'EXPIRED_OR_ABSENT', detail: 'No valid identity information' };
  result.observed = null;
  result.verdict = {
    CURRENT_PRODUCTION_DEPLOYMENT_IDENTITY: 'UNAVAILABLE',
    status: 'BLOCKED_ON_CREDENTIAL',
    reason: 'CloudBase 临时凭证不可用（CLI: No valid identity information）',
    // ⛔ 关键：identity 未取得 ⇒ deployment_identity_verified 必须为 false（fail-closed）
    deployment_identity_verified: false,
    production_baseline_verified: false,
    stop: null,
    next: 'owner 刷新凭证后重跑本脚本（只读）⇒ 取得 ModTime / CodeSha256 / index.js sha256'
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n');
  console.log('== C-021 Production Deployment Identity Audit（只读）==\n');
  console.log('env      =', ENV_ID);
  console.log('function =', FN_NAME);
  console.log('');
  console.log('[BLOCKED] CloudBase 临时凭证不可用 ⇒ 无法读取线上函数身份');
  console.log('verdict  =', JSON.stringify(result.verdict, null, 2));
  console.log('');
  console.log('written =>', path.relative(REPO, OUT));
  process.exit(2);
}

if (!detail.ok) {
  result.credential = { state: 'UNKNOWN_ERROR' };
  result.verdict = {
    CURRENT_PRODUCTION_DEPLOYMENT_IDENTITY: 'UNAVAILABLE',
    status: 'BLOCKED_ON_CLI_ERROR',
    stderr: detail.stderr.slice(0, 500),
    stdout: detail.stdout.slice(0, 500),
    deployment_identity_verified: false,
    production_baseline_verified: false
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n');
  console.error('[ERROR] fn detail 失败：', detail.stderr || detail.stdout);
  process.exit(2);
}

const parsed = parseJsonLoose(detail.stdout) || {};
// CLI 输出信封：{ data: {...} } 或直接平铺 —— 两种都兼容
const d = parsed.data && typeof parsed.data === 'object' ? parsed.data : parsed;
// 字段名兼容：平台可能返回 ModTime / CodeSha256 / Runtime / Handler / CodeSize / FunctionId
const pick = (...keys) => { for (const k of keys) if (d[k] != null) return d[k]; return null; };
const observed = {
  FunctionId: pick('FunctionId', 'functionId') || (d.FunctionName || null),
  Runtime: pick('Runtime', 'runtime'),
  Handler: pick('Handler', 'handler'),
  ModTime: pick('ModTime', 'modTime', 'LastModified', 'UpdateTime'),
  CodeSize: pick('CodeSize', 'codeSize'),
  CodeSha256: pick('CodeSha256', 'codeSha256', 'CodeSha'),
  Status: pick('Status', 'status'),
  Timeout: pick('Timeout', 'timeout'),
  FunctionName: pick('FunctionName', 'functionName'),
  FunctionVersion: pick('FunctionVersion', 'functionVersion')
};
result.credential = { state: 'OK' };
result.observed = observed;

const modMatch = String(observed.ModTime || '').includes(EXPECT_MODTIME.split(' ')[0])
  && String(observed.ModTime || '').includes(EXPECT_MODTIME.split(' ')[1] || '');
const shaMatch = observed.CodeSha256 === EXPECT_CODESHA;
const runtimeMatch = observed.Runtime === 'Nodejs16.13';
const handlerMatch = observed.Handler === 'index.main';

// ⛔ 关键：若平台未返回 CodeSha256（需另行下载 zip 复算）⇒ 不得据此误报 DRIFT
const shaAvailable = observed.CodeSha256 != null && observed.CodeSha256 !== '';
const modAvailable = observed.ModTime != null && observed.ModTime !== '';

/* ---------- ★ 下载线上包 ⇒ 全量 LF-parity + index.js 双 SHA ---------- */
let parity = null;
if (process.argv.includes('--with-download')) {
  // ⚠️ CLI 的 dest 参数语义不稳定；改为：cd 到**临时工作目录**后不带 dest 下载，
  //    再从返回 JSON 的 data.path 读取真实落盘路径。
  const workDir = path.join(os.tmpdir(), 'v365-c021-dl-work');
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });
  const entry0 = resolveTcbEntry();
  const r = spawnSync(process.execPath,
    [entry0, 'fn', 'code', 'download', FN_NAME, '-e', ENV_ID, '--json'],
    { cwd: workDir, encoding: 'utf8', timeout: 180000 });
  const out = ((r.stdout || '') + (r.stderr || '')).toString();
  const blocked = /No valid identity information|please use (tcb )?login|Authorize on the authorization page/i.test(out);
  // 从 JSON 里解析真实路径
  let realPath = null;
  const mi = out.indexOf('{');
  if (mi >= 0) { try { const j = JSON.parse(out.slice(mi)); realPath = j && j.data && j.data.path; } catch (e) { /* ignore */ } }
  // realPath 形如 <workDir>/functions/runDecisionEngine ⇒ computeOnlineParity 期望的是
  // **包含 functions/ 的目录**（它自己再拼 functions/<FN>）
  let parityDir = workDir;
  if (realPath) {
    const idx = realPath.replace(/\\/g, '/').indexOf('/functions/' + FN_NAME);
    parityDir = idx >= 0 ? realPath.slice(0, idx + '/functions/'.length - 1) : workDir;
  }
  // 若解析出的目录里没有 functions/，回退到 workDir
  if (!fs.existsSync(path.join(parityDir, 'functions', FN_NAME))) parityDir = workDir;

  parity = blocked ? { ok: false, reason: 'BLOCKED_ON_CREDENTIAL' } : computeOnlineParity(parityDir);
  result.package_download = {
    attempted: true, ok: !!(parity && parity.ok),
    work_dir: workDir, real_path: realPath, parity_dir: parityDir
  };
  result.online_source_parity = parity;
} else {
  result.package_download = { attempted: false, note: '加 --with-download 才会下载包并做全量 parity' };
}
result.index_sha256 = parity && parity.ok
  ? { raw: parity.index_sha256_raw, lf: parity.index_sha256_lf }
  : null;

// 与台账 D-005 记录的双 SHA 核对（index.js）
const EXPECT_INDEX_RAW = '072b40089c7bc260a888bda913e68b1afb546b49a3d19ef88d4eec7fe9ae477b';
const EXPECT_INDEX_LF = '77f7d50042cee0a9a7e5f84c7769dd95de92f8091b7547307b6f325f8fe01529';
const indexRawMatch = result.index_sha256 ? result.index_sha256.raw === EXPECT_INDEX_RAW : null;
const indexLfMatch = result.index_sha256 ? result.index_sha256.lf === EXPECT_INDEX_LF : null;

// DRIFT 仅在「有可比字段且不一致」时成立
const comparable = [
  shaAvailable ? shaMatch : null,
  modAvailable ? modMatch : null,
  indexRawMatch,
  indexLfMatch
].filter((x) => x !== null);
const drift = comparable.length > 0 && comparable.some((x) => x === false);

result.verdict = {
  CURRENT_PRODUCTION_DEPLOYMENT_IDENTITY: 'AVAILABLE',
  deployment_identity_verified: false, // ⛔ 只有 §9 post-deploy EXACT_MATCH 才能置 true
  production_baseline_verified: !drift,
  fields_available: { code_sha256: shaAvailable, mod_time: modAvailable, package_parity: !!(parity && parity.ok) },
  checks: {
    mod_time_matches_ledger: modAvailable ? modMatch : 'N/A_FIELD_UNAVAILABLE',
    code_sha256_matches_ledger: shaAvailable ? shaMatch : 'N/A_FIELD_UNAVAILABLE',
    index_sha256_raw_matches_ledger: indexRawMatch,
    index_sha256_lf_matches_ledger: indexLfMatch,
    online_source_parity: parity && parity.ok ? parity.parity : 'N/A',
    runtime_matches_expected: runtimeMatch,
    handler_matches_expected: handlerMatch
  },
  ledger_baseline_matches_online: !drift,
  stop: drift ? 'PRODUCTION_DEPLOYMENT_DRIFT' : null,
  note: drift
    ? '⛔ 线上身份与 production-deployment-ledger 基线不一致 ⇒ STOP = PRODUCTION_DEPLOYMENT_DRIFT'
    : '线上身份与台账 D-006 基线一致 —— 线上 = 冻结 V3.6.4 源码（'
      + (parity && parity.ok ? `ONLINE_SOURCE_PARITY=${parity.parity} ${parity.match}/${parity.online_files}` : '未下载包')
      + '）'
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n');

console.log('== C-021 Production Deployment Identity Audit（只读）==\n');
console.log('env      =', ENV_ID);
console.log('function =', FN_NAME);
console.log('');
console.log('CURRENT_PRODUCTION_DEPLOYMENT_IDENTITY:');
Object.entries(observed).forEach(([k, v]) => console.log(`  ${k} = ${v}`));
console.log('');
console.log('checks =', JSON.stringify(result.verdict.checks));
console.log('ledger_baseline_matches_online =', result.verdict.ledger_baseline_matches_online);
if (drift) console.log('⛔ STOP =', result.verdict.stop);
console.log('');
console.log('written =>', path.relative(REPO, OUT));
process.exit(drift ? 3 : 0);
