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

/**
 * spawnSync 结果 → 文本（V3.6.1 R1 健壮性修复）。
 *
 * 背景：`spawnSync` 自身失败时（Windows 偶发 EBUSY / ENOBUFS / 找不到解释器）
 * `r.status === null` 且 `r.stdout` / `r.stderr` 均为 `null`。
 * 旧写法 `(r.stderr + r.stdout)` 在 JS 里等于 `null + null === 0`（数字），
 * 随后 `.split` 直接抛 TypeError —— 把「某个测试跑不起来」升级成「整个门禁崩掉」，
 * 结果一行测试结论都看不到。此处统一降级为可读文本。
 */
function outText(r) {
  const body = `${r && r.stdout != null ? r.stdout : ''}${r && r.stderr != null ? r.stderr : ''}`;
  const err = r && r.error ? ` [spawn_error=${r.error.code || r.error.message}]` : '';
  return `${body}${err}`;
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
      // 打印失败摘要。
      // 2026-09-22 修：旧实现按 /AssertionError|Error|FAIL|actual|expected/ 取前 3 行，
      //   会把测试里**通过的**用例名（如「…（tie）→ 两项皆 false」）当成失败原因，
      //   在 CI 上导致误诊（PR #52 run #143 实际失败项是 C.2，标签却指向 C.7）。
      //   现改为：① spawn 本身失败 → 显式说明；② 优先取测试自己打印的 ✗ 行 + 其下一行；
      //   ③ 退化为 AssertionError/Error/FAIL 行；④ 再退化为输出尾部。
      const raw = outText(r).split('\n').map((l) => l.replace(/\s+$/, ''));
      let picked = [];
      if (r.error) {
        picked = [`spawn_failed:${r.error.code || r.error.message}`];
      } else {
        const idx = raw.findIndex((l) => l.indexOf('\u2717') >= 0);
        if (idx >= 0) {
          picked = [raw[idx].trim()];
          if (raw[idx + 1] && raw[idx + 1].trim()) picked.push(raw[idx + 1].trim());
        } else {
          picked = raw.filter((l) => /AssertionError|Error:|FAIL/.test(l)).slice(0, 2).map((l) => l.trim());
        }
        if (!picked.length) picked = raw.filter(Boolean).slice(-2).map((l) => l.trim());
      }
      report('A', t, false, (picked.join(' | ') || '(no output)').slice(0, 280));
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
  const tail = outText(r).split('\n').filter(Boolean).slice(-4).join(' | ').slice(0, 200);
  report('B', 'unittest discover ml/gen2/tests', ok, ok ? undefined : tail);
}

/* ---------- Stage C: Immutable Checks（真 SHA 锁，P0-A） ---------- */
function stageC() {
  console.log('\n== Stage C: Immutable Checks（Gen-1 frozen + V3.6.1 + GEN2 bundle + Gen-1 pipeline）==');
  // P0-A：不再用 `git diff --quiet HEAD`（CI 干净 checkout 恒 PASS 的假锁）。
  // 改为实际文件 SHA256 vs lock 文件 expected（GEN1/V361/GEN2_RULE_V2 lock）。
  const r = spawnSync(NODE, [path.join(REPO, 'scripts', 'verify-immutable.js')], { cwd: REPO, encoding: 'utf8' });
  const ok = r.status === 0;
  const lines = outText(r).split('\n').filter(Boolean);
  lines.forEach((l) => console.log('  ' + l));
  report('C', 'Immutable SHA lock（23 项：Gen-1 frozen×3 + model_id + V3.6.1×2 + GEN2 bundle/version/role_thresholds/legacy + '
    + 'immutable_set 条目数 + id 必需集合 + 8 项实现（bundle·JS·Python 规则/候选/防守·阈值契约 role_thresholds.py'
    + '·显式 Alpha selection_scores.py·统一 regime regime.py）+ 3 lock root-of-trust）', ok);

  // G1-11 Gate G1-B：Gen-1 Feature Pipeline Lock（指标/阶段/PARAMS/特征构建/RS20/schema/sector/健康/域策略）
  const p = spawnSync(NODE, [path.join(REPO, 'scripts', 'verify-gen1-pipeline.js')], { cwd: REPO, encoding: 'utf8' });
  const pOk = p.status === 0;
  const pLines = outText(p).split('\n').filter(Boolean);
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
  console.log(outText(r).trim());
  report('D', 'parity（360 行 role/rank 精确 + score/weight 容差）', ok);
}

/* ---------- Stage E: Secret scan ---------- */
function stageE() {
  console.log('\n== Stage E: Secret scan ==');
  const r = spawnSync(NODE, [path.join(REPO, 'scripts', 'scan-secrets.js')], { cwd: REPO, encoding: 'utf8' });
  const ok = r.status === 0;
  report('E', 'scan-secrets', ok, ok ? undefined : outText(r).slice(-160));
}

/* ---------- Stage F: Build Common Parity（P0-B，进 CI 的正式 Gate） ---------- */
function stageF() {
  console.log('\n== Stage F: Build Common Parity（src/common → dist-functions 构建 + SHA 校验）==');
  const r = spawnSync(NODE, [path.join(REPO, 'scripts', 'build-cloudfunctions.js')], { cwd: REPO, encoding: 'utf8' });
  const ok = r.status === 0;
  const tail = outText(r).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 200);
  report('F', 'build-cloudfunctions（11 函数 common SHA parity）', ok, ok ? undefined : tail);

  // WP-G2-04：构建产物（云函数实际加载的 GEN2 bundle / index.js）必须与冻结锁**逐位一致**。
  // 必须在 build 之后跑：dist-functions/ 是构建产物，不入库。
  const a = spawnSync(NODE, [path.join(REPO, 'scripts', 'verify-gen2-build-artifacts.js')],
    { cwd: REPO, encoding: 'utf8' });
  const aOk = a.status === 0;
  const aLines = outText(a).split('\n').filter(Boolean);
  aLines.forEach((l) => console.log('  ' + l));
  report('F', 'WP-G2-04 构建产物 vs 冻结锁逐位一致（云函数 bundle + index.js）', aOk);
}

/* ---------- Stage G: Gen-1 Production Gates（WP-G1 / G1-11） ---------- */
function stageG() {
  console.log('\n== Stage G: Gen-1 Production Gates（G1-A ~ G1-AF）==');
  const r = spawnSync(NODE, [path.join(REPO, 'scripts', 'gen1-production-gates.js')], { cwd: REPO, encoding: 'utf8' });
  const ok = r.status === 0;
  const lines = outText(r).split('\n').filter(Boolean);
  lines.forEach((l) => console.log('  ' + l));
  report('G', 'Gen-1 Production Gates G1-A~AF（含 Model Candidate/Sector Contract/Persistent Latch/Economic Health/Canary Portfolio/Health Single Truth/Fail-Closed/Context Parity/Event Contract/Benchmark Pipeline/Daily Finality/Guarded Effective Authority+Gates+Selector No-op+Frozen Param + GE-03 Shadow Eligibility/Rerun/Counters/Replay/Selector Security/Regression Guard/S4 Invocation Census）', ok);
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
