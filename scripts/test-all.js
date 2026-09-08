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

/* ---------- Stage C: Immutable Checks ---------- */
function stageC() {
  console.log('\n== Stage C: Immutable Checks（Gen-1 frozen + V3.6.1）==');
  const gen1Dir = path.join(REPO, 'cloudfunctions', 'runGen1ShadowEod');

  // 1) Gen-1 frozen model_id 不可变
  const manifest = JSON.parse(fs.readFileSync(path.join(gen1Dir, 'frozen-manifest.json'), 'utf8'));
  report('C', 'Gen-1 model_id = HVT-A-ET-20260830', manifest.model_id === 'HVT-A-ET-20260830', manifest.model_id);

  // 2) frozen 文件相对 git HEAD 无未提交改动（immutable 保护）
  for (const f of ['frozen-model.json', 'frozen-manifest.json', 'frozen-node-inference.js']) {
    const r = spawnSync('git', ['diff', '--quiet', 'HEAD', '--', `cloudfunctions/runGen1ShadowEod/${f}`], { cwd: REPO });
    report('C', `frozen/${f} 无改动`, r.status === 0);
  }

  // 3) V3.6.1 决策核心（decision-v3.js / decision.js）无未提交改动
  for (const f of ['src/common/utils/decision-v3.js', 'src/common/utils/decision.js']) {
    const r = spawnSync('git', ['diff', '--quiet', 'HEAD', '--', f], { cwd: REPO });
    report('C', `${f} 无改动`, r.status === 0);
  }
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

/* ---------- 主流程 ---------- */
const only = process.argv.find((a) => a.startsWith('--stage='));
const stages = { A: stageA, B: stageB, C: stageC, D: stageD, E: stageE };
const order = ['A', 'B', 'C', 'D', 'E'];

for (const s of order) {
  if (only && only !== `--stage=${s}`) continue;
  stages[s]();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n=== 汇总：${results.length - failed}/${results.length} 项通过，${failed} 项失败 ===`);
if (process.exitCode !== 1 && failed > 0) process.exitCode = 1;
process.exit(process.exitCode || 0);
