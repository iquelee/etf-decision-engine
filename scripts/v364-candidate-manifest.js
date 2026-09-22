#!/usr/bin/env node
/**
 * V3.6.4 Safety Hardening —— Candidate Manifest 生成器
 *
 * ⚠️ 本轮**只生成候选草案，不冻结**。
 *   - **不修改、不覆盖** `ml/manifests/V361_IMMUTABLE_LOCK.json`（V3.6.1 永久保留历史基线）。
 *   - 产物文件名带 `.candidate`，`status = CANDIDATE_NOT_FROZEN`，
 *     只有 Gate A/B/C/D 全部 PASS 并取得 Review 授权后，才允许改写为 `V364_IMMUTABLE_LOCK.json` 并置 `FROZEN`。
 *
 * 用法：node scripts/v364-candidate-manifest.js [--candidate-sha <sha>]
 *
 * ⚠️ 只读：不部署、不改线上参数、不修改任何受锁文件。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const OUT = path.join(REPO, 'ml/manifests/V364_IMMUTABLE_LOCK.candidate.json');
const V361_LOCK = path.join(REPO, 'ml/manifests/V361_IMMUTABLE_LOCK.json');

function argOf(flag, dflt) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] != null ? process.argv[i + 1] : dflt;
}

/** 与既有锁一致的 hash_basis：LF-normalized 内容哈希 */
function lfSha256(rel) {
  const p = path.join(REPO, rel);
  if (!fs.existsSync(p)) return null;
  const content = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * 读取 git ref —— **不依赖子进程**。
 * 原因：部分受限环境（以及本仓历史的本地沙箱）禁止 Node 拉起子进程，
 * `execSync('git ...')` 会直接失败，导致 manifest 的 git 字段静默变 null。
 * 这里直接读 `.git/` 下的引用文件，并可回退到 `git` 命令。
 */
function gitDir() {
  const g = path.join(REPO, '.git');
  if (fs.existsSync(g) && fs.statSync(g).isDirectory()) return g;
  if (fs.existsSync(g)) {
    const m = fs.readFileSync(g, 'utf8').match(/gitdir:\s*(.+)/);
    if (m) return path.resolve(REPO, m[1].trim());
  }
  return null;
}

function readRefFile(refName) {
  const gd = gitDir();
  if (!gd) return null;
  const direct = path.join(gd, refName);
  if (fs.existsSync(direct)) return fs.readFileSync(direct, 'utf8').trim();
  const packed = path.join(gd, 'packed-refs');
  if (fs.existsSync(packed)) {
    const line = fs.readFileSync(packed, 'utf8').split(/\r?\n/)
      .find((l) => l.endsWith(` ${refName}`));
    if (line) return line.split(' ')[0].trim();
  }
  return null;
}

function readHead() {
  const gd = gitDir();
  if (!gd) return { sha: null, branch: null };
  const head = fs.readFileSync(path.join(gd, 'HEAD'), 'utf8').trim();
  if (head.startsWith('ref:')) {
    const refName = head.slice(4).trim();
    return { sha: readRefFile(refName), branch: refName.replace(/^refs\/heads\//, '') };
  }
  return { sha: head, branch: null };
}

function git(cmd) {
  // 优先用文件直读；仅当确实需要时才尝试子进程
  if (cmd === 'rev-parse HEAD') return readHead().sha;
  if (cmd === 'rev-parse origin/master') return readRefFile('refs/remotes/origin/master');
  if (cmd === 'branch --show-current') return readHead().branch;
  try {
    return execSync(`git ${cmd}`, { cwd: REPO, encoding: 'utf8' }).trim();
  } catch (e) {
    return null;
  }
}

function main() {
  const candidateSha = argOf('--candidate-sha', null) || git('rev-parse HEAD');
  const parentSha = git('rev-parse origin/master');

  const trackedFiles = {
    decision_js: 'src/common/utils/decision.js',
    decision_v3_js: 'src/common/utils/decision-v3.js',
    trend_stage_js: 'src/common/utils/trend-stage.js',
    correlation_js: 'src/common/utils/correlation.js',
    v3_6_stage_persistence_js: 'src/common/utils/v3-6-stage-persistence.js',
    defense_js: 'src/common/utils/defense.js',
    swing_structure_js: 'src/common/utils/swing-structure.js',
    trade_date_idempotence_js: 'src/common/utils/trade-date-idempotence.js',
    portfolio_mode_js: 'src/common/utils/portfolio-mode.js',
    portfolio_cash_js: 'src/common/utils/portfolio-cash.js',
    market_env_diagnostics_js: 'src/common/utils/market-env-diagnostics.js',
    v361_run_context_js: 'src/common/utils/v361-run-context.js',
    v361_run_finality_js: 'src/common/utils/v361-run-finality.js',
    run_decision_engine_index_js: 'cloudfunctions/runDecisionEngine/index.js',
    schema_js: 'src/common/schema.js',
    market_regime_js: 'src/common/utils/market-regime.js',
    test_all_js: 'scripts/test-all.js'
  };

  const fileHashes = {};
  Object.keys(trackedFiles).forEach((k) => { fileHashes[k] = lfSha256(trackedFiles[k]); });

  const qualificationReports = [
    'docs/V364_SLOWBREAK_REPLAY.md',
    'docs/V364_IDEMPOTENCE_REPLAY.md',
    'docs/V364_SWING_PARITY_REPORT.md',
    'docs/V364_CANDIDATE_QUALIFICATION.md',
    'docs/V361_SAFETY_HARDENING_R1_REPORT.md',
    'docs/production-deployment-ledger.md'
  ];
  const reportHashes = {};
  qualificationReports.forEach((rel) => { reportHashes[rel] = lfSha256(rel); });

  /* ---- 关键不变量：父版本冻结件必须**逐位未变** ---- */
  const v361 = JSON.parse(fs.readFileSync(V361_LOCK, 'utf8'));
  const invariantChecks = [
    {
      name: 'V3.6.1 decision-v3.js 未被修改',
      expected: v361.decision_v3_sha256,
      actual: fileHashes.decision_v3_js,
      pass: v361.decision_v3_sha256 === fileHashes.decision_v3_js
    },
    {
      name: 'V3.6.1 decision.js 未被修改',
      expected: v361.decision_sha256,
      actual: fileHashes.decision_js,
      pass: v361.decision_sha256 === fileHashes.decision_js
    },
    {
      name: 'GEN-1 pipeline trend-stage.js 未被修改',
      expected: (() => {
        const l = JSON.parse(fs.readFileSync(path.join(REPO, 'ml/manifests/GEN1_FEATURE_PIPELINE_LOCK.json'), 'utf8'));
        const e = l.files.find((f) => f.role === 'trend_stage_implementation');
        return e ? e.sha256 : null;
      })(),
      actual: fileHashes.trend_stage_js,
      pass: (() => {
        const l = JSON.parse(fs.readFileSync(path.join(REPO, 'ml/manifests/GEN1_FEATURE_PIPELINE_LOCK.json'), 'utf8'));
        const e = l.files.find((f) => f.role === 'trend_stage_implementation');
        return e ? e.sha256 === fileHashes.trend_stage_js : false;
      })()
    }
  ];

  const manifest = {
    version: 'V3.6.4',
    status: 'CANDIDATE_NOT_FROZEN',
    title: 'V3.6.4 Safety Hardening',
    generated_at: new Date().toISOString(),
    hash_basis: 'LF-normalized content (CRLF->LF before sha256)，与 V361/GEN1/GEN2 三把锁同口径',
    parent_version: 'V3.6.1',
    parent_repo_sha: parentSha,
    candidate_repo_sha: candidateSha,
    candidate_branch: git('branch --show-current'),

    // —— 候选版本钉死的实现文件 ——
    files: trackedFiles,
    sha256: fileHashes,

    // —— 资格化证据（报告哈希） ——
    qualification_reports: reportHashes,

    // —— 与父版本的关系 ——
    parent_unchanged_invariants: invariantChecks,
    parent_unchanged_all_pass: invariantChecks.every((c) => c.pass),

    // —— 本次候选**不包含**的变更（显式声明禁止项，避免被误读） ——
    explicitly_not_included: [
      'Portfolio Mode 启用（v3_force_portfolio_track / v3_5_portfolio_enabled）',
      'Market Regime authority 变更 / W5 majority 规则变更',
      'Run Finality 生产阻断接通',
      'V361RunContext 生产阻断接通',
      'Tech Cap / correlation discount 阈值变更',
      'SlowBreak / DefenseScore 阈值变更',
      'StageFactor / MarketFactor / 仓位步长变更',
      'V3.6.2 post-S5 Grace / V3.6.3 adaptive post-S5 Grace（继续保持 OFF）',
      '任何线上部署 / param_config 变更'
    ],

    freeze_condition: {
      requirement: 'Gate A / B / C / D 全部 PASS，且取得人工 Review 授权',
      gate_a: 'PASS（2026-09-22，582 个共同交易日，5 票，0 触发 / 0 数值差异；SB>=75 因快照字段缺失而不可达，已登记）',
      gate_b: 'PASS（2026-09-22，120 天 × 5 票，6000 次字段比对 0 漂移）',
      gate_c: 'PASS（2026-09-22，5483 个 rolling window，共享字段 mismatch_count = 0）',
      gate_d: 'PASS（2026-09-22，GitHub Actions run #144，head 52ee424：Node16/22 × Python3.11/3.12 四 job 全绿；'
        + 'npm test 59/59 项通过、Stage A 51/51、Gen-1 Production Gates 32/32、Build parity 7/7、parity 360 行）。'
        + '首轮 run #143 为 FAIL，根因是 tests/v364-swing-parity.test.js 的 C.2 阈值按本机语料标定'
        + '（CI 无 deliverables/ ⇒ 只剩合成语料 917 窗口），非产品缺陷 —— 反证：C.1 mismatch_count = 0 在 CI 同样 PASS；'
        + '已修为环境感知（合成语料底线环境无关恒强制 / 真实历史可用时才强制 >3000 / 不可用时显式披露）。',
      gate_d_status: 'PASS',
      gate_d_run: 'https://github.com/iquelee/etf-decision-engine/actions/runs/35693440911',
      satisfied: true,
      freeze_decision: 'AWAITING_USER_AUTHORIZATION',
      note: '四道 Gate 已全部 PASS ⇒ 已满足置 FROZEN 的**前置条件**；但 `status` 仍保持 CANDIDATE_NOT_FROZEN：'
        + '置 FROZEN 属治理写操作，须待人工 Review 授权后另起一个可回溯 commit 执行。'
        + '未授权前，本 manifest 不是生产基线，也不得被引用为「已冻结」。'
    },

    rule: 'V3.6.4 为 V3.6.1 的 correctness hardening 候选；父版本 V3.6.1 的三把锁保持原样、永久保留历史基线。'
      + '任何对 V3.6.4 候选范围的扩展都必须重新走 Gate A~D 并重新生成本 manifest。'
  };

  fs.writeFileSync(OUT, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log(`[Manifest] ${path.relative(REPO, OUT)}`);
  console.log(`  parent_version       = ${manifest.parent_version}`);
  console.log(`  parent_repo_sha      = ${manifest.parent_repo_sha}`);
  console.log(`  candidate_repo_sha   = ${manifest.candidate_repo_sha}`);
  console.log(`  status               = ${manifest.status}`);
  console.log(`  parent_unchanged_all_pass = ${manifest.parent_unchanged_all_pass}`);
  invariantChecks.forEach((c) => console.log(`    ${c.pass ? 'PASS' : 'FAIL'}  ${c.name}`));
  console.log(`  V361_IMMUTABLE_LOCK.json 未被覆盖：${!fs.readFileSync(V361_LOCK, 'utf8').includes('V3.6.4')}`);
}

main();
