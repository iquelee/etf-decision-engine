#!/usr/bin/env node
/**
 * 统一测试入口（P0-03）：5 阶段测试门禁。
 *
 *   Stage A  Node 单元测试        tests/*.test.js
 *   Stage B  Gen-2 Python 单测    PYTHONPATH=ml python -m unittest discover ml/gen2/tests
 *   Stage C  Immutable Checks     Gen-1 frozen model / manifest / inference SHA + model_id
 *   Stage D  Cross-language Parity（P0-04 之后接入，当前 pending）
 *   Stage E  Secret scan          scripts/scan-secrets.js
 *
 * 任何阶段失败 → 整体 exit 1（供 CI / npm test 使用）。
 * 用法：node scripts/test-all.js [--stage A|B|C|D|E]
 */
'use strict';
const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..');

// Python 解释器：优先 TCB_PYTHON，其次本地 venv（含 numpy/pandas），CI 上回退 python3
const _WIN_PY = 'C:/Users/iquel/.workbuddy/binaries/python/envs/default/Scripts/python.exe';
const PYTHON = process.env.TCB_PYTHON || (fs.existsSync(_WIN_PY) ? _WIN_PY : 'python3');
const NODE = process.execPath;

const results = [];
function report(stage, name, ok, detail) {
  results.push({ stage, name, ok });
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`  [${mark}] ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/* ---------- Stage A: Node 单元测试 ---------- */
function stageA() {
  console.log('\n== Stage A: Node 单元测试 ==');
  const dir = path.join(REPO, 'tests');
  const tests = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js')).sort();
  let failed = 0;
  for (const t of tests) {
    const r = spawnSync(NODE, [path.join(dir, t)], { cwd: REPO, encoding: 'utf8' });
    const ok = r.status === 0;
    if (!ok) {
      failed++;
      // 打印失败摘要
      const lines = (r.stderr + r.stdout).split('\n').filter((l) => /AssertionError|Error|FAIL|actual|expected/.test(l)).slice(0, 3);
      report('A', t, false, lines.join(' | ').slice(0, 160));
    } else {
      report('A', t, true);
    }
  }
  console.log(`  Stage A: ${tests.length - failed}/${tests.length} 文件通过`);
}

/* ---------- Stage B: Gen-2 Python 单测 ---------- */
function stageB() {
  console.log('\n== Stage B: Gen-2 Python 单元测试 ==');
  const env = { ...process.env, PYTHONPATH: path.join(REPO, 'ml') };
  const r = spawnSync(PYTHON, ['-m', 'unittest', 'discover', 'ml/gen2/tests'], {
    cwd: REPO, env, encoding: 'utf8',
  });
  const ok = r.status === 0;
  const tail = (r.stdout + r.stderr).split('\n').filter(Boolean).slice(-4).join(' | ').slice(0, 200);
  report('B', 'unittest discover ml/gen2/tests', ok, ok ? undefined : tail);
}

/* ---------- Stage C: Immutable Checks（真 SHA 锁，P0-A） ---------- */
function stageC() {
  console.log('\n== Stage C: Immutable Checks（Gen-1 frozen + V3.6.1 + GEN2 bundle + Gen-1 pipeline）==');
  // P0-A：不再用 `git diff --quiet HEAD`（CI 干净 checkout 恒 PASS 的假锁）。
  // 改为实际文件 SHA256 vs lock 文件 expected（GEN1/V361/GEN2_RULE_V2 lock）。
  const r = spawnSync(NODE, [path.join(REPO, 'scripts', 'verify-immutable.js')], { cwd: REPO, encoding: 'utf8' });
  const ok = r.status === 0;
  const lines = (r.stdout + r.stderr).split('\n').filter(Boolean);
  lines.forEach((l) => console.log('  ' + l));
  report('C', 'Immutable SHA lock（8 项：Gen-1 frozen×3 + model_id + V3.6.1×2 + GEN2 bundle×2）', ok);

  // G1-11 Gate G1-B：Gen-1 Feature Pipeline Lock（指标/阶段/PARAMS/特征构建/RS20/schema/sector/健康/域策略）
  const p = spawnSync(NODE, [path.join(REPO, 'scripts', 'verify-gen1-pipeline.js')], { cwd: REPO, encoding: 'utf8' });
  const pOk = p.status === 0;
  const pLines = (p.stdout + p.stderr).split('\n').filter(Boolean);
  pLines.forEach((l) => console.log('  ' + l));
  report('C', 'Gen-1 Feature Pipeline Lock（Gate G1-B，10 项；改一行指标实现或阈值不一致即 FAIL）', pOk);
}

/* ---------- Stage D: Cross-language Parity ---------- */
function stageD() {
  console.log('\n== Stage D: Cross-language Parity（Python ↔ Node）==');
  const fixture = path.join(REPO, 'fixtures', 'gen2', 'parity_fixture.json');
  if (!fs.existsSync(fixture)) {
    console.log('  [PENDING] fixtures/gen2/parity_fixture.json 未生成，跳过');
    return;
  }
  const env = { ...process.env, PYTHONPATH: path.join(REPO, 'ml') };
  const r = spawnSync(PYTHON, [
    path.join(REPO, 'scripts', 'parity', 'compare.py'),
    '--node', NODE, '--python', PYTHON, '--fixture', fixture,
  ], { cwd: REPO, env, encoding: 'utf8' });
  const ok = r.status === 0;
  console.log(r.stdout.trim());
  if (!ok && r.stderr) console.log(r.stderr.trim());
  report('D', 'parity（360 行 role/rank 精确 + score/weight 容差）', ok);
}

/* ---------- Stage E: Secret scan ---------- */
function stageE() {
  console.log('\n== Stage E: Secret scan ==');
  const r = spawnSync(NODE, [path.join(REPO, 'scripts', 'scan-secrets.js')], { cwd: REPO, encoding: 'utf8' });
  const ok = r.status === 0;
  report('E', 'scan-secrets', ok, ok ? undefined : (r.stdout + r.stderr).slice(-160));
}

/* ---------- Stage F: Build Common Parity（P0-B，进 CI 的正式 Gate） ---------- */
function stageF() {
  console.log('\n== Stage F: Build Common Parity（src/common → dist-functions 构建 + SHA 校验）==');
  const r = spawnSync(NODE, [path.join(REPO, 'scripts', 'build-cloudfunctions.js')], { cwd: REPO, encoding: 'utf8' });
  const ok = r.status === 0;
  const tail = (r.stdout + r.stderr).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 200);
  report('F', 'build-cloudfunctions（11 函数 common SHA parity）', ok, ok ? undefined : tail);
}

/* ---------- Stage G: Gen-1 Production Gates（WP-G1 / G1-11） ---------- */
function stageG() {
  console.log('\n== Stage G: Gen-1 Production Gates（G1-A ~ G1-T）==');
  const r = spawnSync(NODE, [path.join(REPO, 'scripts', 'gen1-production-gates.js')], { cwd: REPO, encoding: 'utf8' });
  const ok = r.status === 0;
  const lines = (r.stdout + r.stderr).split('\n').filter(Boolean);
  lines.forEach((l) => console.log('  ' + l));
  report('G', 'Gen-1 Production Gates G1-A~T（含 Model Candidate/Sector Contract/Persistent Latch/Economic Health/Canary Portfolio/Health Single Truth/Fail-Closed/Context Parity/Event Contract/Benchmark Pipeline）', ok);
}

/* ---------- 主流程 ---------- */
const only = process.argv.find((a) => a.startsWith('--stage='));
const stages = { A: stageA, B: stageB, C: stageC, D: stageD, E: stageE, F: stageF, G: stageG };
const order = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

for (const s of order) {
  if (only && only !== `--stage=${s}`) continue;
  stages[s]();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n=== 汇总：${results.length - failed}/${results.length} 项通过，${failed} 项失败 ===`);
if (process.exitCode !== 1 && failed > 0) process.exitCode = 1;
process.exit(process.exitCode || 0);
