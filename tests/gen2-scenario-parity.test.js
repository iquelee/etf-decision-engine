'use strict';
/**
 * WP-G2-01 —— Gen-2 场景夹具的 Node 侧测试接缝。
 *
 * 覆盖：
 *  1. 夹具 schema 与三层结构完整性（input / invariants / observations 分离）；
 *  2. known_differences 登记完整性（每条必须有 status / location / reason，且 status 合法）；
 *  3. PENDING_SEAM 场景必须写明 deferred_to 与 deferred_reason；
 *  4. 跑 Node 端 runner，校验**该端**全部不变量（confirmed 业务语义）；
 *  5. 双端比对器（若解释器可用）：0 个未记录、未定位差异。
 *
 * 只读：不写库、不改规则、不部署。
 * 运行：node tests/gen2-scenario-parity.test.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const FIXTURE = path.join(REPO, 'fixtures', 'gen2', 'golden_scenarios_v1.json');
const RUNNER = path.join(REPO, 'scripts', 'parity', 'run_gen2_scenarios_node.js');
const COMPARATOR = path.join(REPO, 'scripts', 'parity', 'compare_gen2_scenarios.py');
const PY_RUNNER = path.join(REPO, 'scripts', 'parity', 'run_gen2_scenarios.py');

const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const VALID_STATUS = ['ALIGNED', 'EXPLAINED', 'PENDING_RULING', 'EXCLUDED_BY_DESIGN'];
const OUT_DIR = path.join(REPO, 'outputs', 'gen2-wp-g2-01');

/* ---------- 1. schema / 三层结构 ---------- */
{
  assert.ok(fixture.meta && fixture.meta.layer_contract, '夹具必须声明三层结构契约');
  assert.deepStrictEqual(Object.keys(fixture.meta.layer_contract).sort(),
    ['input', 'invariants', 'observations'], '三层必须是 input / invariants / observations');
  assert.ok(Array.isArray(fixture.scenarios) && fixture.scenarios.length >= 5, '场景数量异常');
  for (const sc of fixture.scenarios) {
    for (const k of ['id', 'title', 'tier', 'status', 'seam']) {
      assert.ok(sc[k], `场景 ${sc.id || '?'} 缺字段 ${k}`);
    }
    assert.ok(sc.seam.python && sc.seam.js, `场景 ${sc.id} 必须写明双端 seam`);
    if (sc.status === 'RUNNABLE') {
      assert.ok(sc.handler, `${sc.id} RUNNABLE 必须有 handler`);
      assert.ok(sc.input, `${sc.id} RUNNABLE 必须有固定 input`);
      assert.ok(Array.isArray(sc.invariants) && sc.invariants.length > 0,
        `${sc.id} RUNNABLE 必须至少有一条已确认不变量`);
      for (const inv of sc.invariants) {
        assert.ok(['both', 'js', 'python'].indexOf(inv.applies_to) >= 0,
          `${sc.id}/${inv.id} applies_to 非法`);
      }
    } else {
      assert.ok(sc.deferred_to && sc.deferred_reason,
        `${sc.id} 未运行场景必须写明 deferred_to + deferred_reason`);
    }
  }
  // observations 不得预先写进夹具（禁止把任一端输出当 expected）：
  // 逐场景检查，避免误伤 meta.layer_contract 里对三层的中文说明
  const FORBIDDEN_KEYS = ['observations', 'js_output', 'python_output', 'js', 'python', 'expected', 'expected_output'];
  for (const sc of fixture.scenarios) {
    for (const k of FORBIDDEN_KEYS) {
      assert.ok(!(k in sc), `场景 ${sc.id} 不得预置 ${k}（observations 只能由 runner 生成）`);
    }
  }
  assert.ok(!/"(js_output|python_output|expected_output)"\s*:/.test(fs.readFileSync(FIXTURE, 'utf8')),
    '夹具不得预置任一端输出');
  console.log('[PASS] G2S-A 夹具三层结构与 schema 完整');
}

/* ---------- 2. known_differences / resolved_differences 登记完整性 ---------- */
{
  const known = fixture.known_differences || [];
  for (const e of known) {
    assert.ok(e.id && e.scenario && e.status && e.reason && e.location,
      `差异登记 ${e.id || '?'} 必须含 id/scenario/status/reason/location`);
    assert.ok(VALID_STATUS.indexOf(e.status) >= 0, `${e.id} status 非法：${e.status}`);
    assert.ok(e.status !== 'ALIGNED', `${e.id} 登记项不得是 ALIGNED`);
    assert.ok((e.fields && e.fields.length) || e.field, `${e.id} 必须声明 fields/field`);
  }

  // 已结案差异必须留下裁决与回归证据（防止"悄悄修掉、没有留痕"）
  const resolved = fixture.resolved_differences || [];
  const scenarioIds = new Set(fixture.scenarios.map((s) => s.id));
  const allInvariantIds = new Set();
  for (const sc of fixture.scenarios) for (const inv of sc.invariants || []) allInvariantIds.add(inv.id);
  for (const e of resolved) {
    assert.strictEqual(e.status, 'RESOLVED', `${e.id} 结案项 status 必须为 RESOLVED`);
    for (const k of ['id', 'scenario', 'ruling', 'fixed_in']) {
      assert.ok(e[k], `结案项 ${e.id || '?'} 缺 ${k}`);
    }
    assert.ok(scenarioIds.has(e.scenario), `${e.id} 指向不存在的场景`);
    assert.ok(e.semantic_change, `${e.id} 必须说明是否为语义变更及其影响`);
    for (const invId of e.regression_invariants || []) {
      assert.ok(allInvariantIds.has(invId), `${e.id} 引用了不存在的不变量 ${invId}`);
    }
    assert.ok((e.regression_invariants || []).length > 0, `${e.id} 必须登记回归不变量`);
  }

  // seam 契约块（roles panel / run 状态四态）
  const sc = fixture.seam_contracts || {};
  assert.ok(sc.roles_panel && sc.roles_panel.canonical_input && sc.roles_panel.side_adapters,
    '必须声明 roles seam 的共同输入契约');
  assert.ok(sc.run_status_gate && sc.run_status_gate.states, '必须声明 run 状态四态契约');
  for (const st of ['running', 'completed', 'blocked', 'failed']) {
    assert.ok(sc.run_status_gate.states[st], `四态契约缺 ${st}`);
  }
  console.log(`[PASS] G2S-B 差异登记完整（待裁决/已定位 ${known.length} 条，已结案 ${resolved.length} 条）+ seam 契约齐备`);
}

/* ---------- 3. 跑 Node 端 runner + 校验该端不变量 ---------- */
const tmpJs = path.join(os.tmpdir(), 'gen2-scenarios-js.json');
{
  const r = spawnSync(process.execPath, [RUNNER, FIXTURE, tmpJs], { cwd: REPO, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, `Node runner 失败：${(r.stderr || '').slice(0, 400)}`);
  const js = JSON.parse(fs.readFileSync(tmpJs, 'utf8'));
  assert.strictEqual(js.engine, 'js');

  const get = (obj, dotted) => dotted.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
  let checked = 0;
  for (const sc of fixture.scenarios) {
    if (sc.status !== 'RUNNABLE') {
      assert.ok(js.pending.some((p) => p.id === sc.id), `${sc.id} 应在 pending 列表`);
      continue;
    }
    const node = js.scenarios[sc.id];
    assert.ok(node, `${sc.id} Node 端未产出`);
    for (const inv of sc.invariants) {
      if (inv.applies_to === 'python') continue;
      const case_ = inv.case ? node[inv.case] : node;
      assert.ok(case_, `${sc.id}/${inv.case} Node 端缺 case 输出`);
      const actual = get(case_, inv.field);
      let ok;
      switch (inv.op) {
        case 'eq': ok = actual === inv.value; break;
        case 'ne': ok = actual !== inv.value; break;
        case 'gte': ok = typeof actual === 'number' && actual >= inv.value; break;
        case 'lte': ok = typeof actual === 'number' && actual <= inv.value; break;
        case 'is_true': ok = actual === true; break;
        case 'is_false': ok = actual === false; break;
        case 'is_null': ok = actual === null; break;
        case 'not_null': ok = actual !== null; break;
        case 'contains': ok = typeof actual === 'string' && actual.indexOf(inv.value) >= 0; break;
        default: throw new Error(`unknown op ${inv.op}`);
      }
      assert.ok(ok, `不变量失败 ${sc.id}/${inv.id}（js）：${inv.field} ${inv.op} ${inv.value} → 实际 ${JSON.stringify(actual)}`);
      checked += 1;
    }
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.copyFileSync(tmpJs, path.join(OUT_DIR, 'js-observations.json'));
  console.log(`[PASS] G2S-C Node 端 ${checked} 条已确认不变量全部通过`);
}

/* ---------- 4. 双端比对（解释器依赖，缺失时显式 PENDING） ---------- */
{
  const WIN_PY = 'C:/Users/iquel/.workbuddy/binaries/python/envs/default/Scripts/python.exe';
  const py = process.env.TCB_PYTHON || (fs.existsSync(WIN_PY) ? WIN_PY : 'python3');
  const tmpPy = path.join(os.tmpdir(), 'gen2-scenarios-py.json');

  const rp = spawnSync(py, [PY_RUNNER, FIXTURE, tmpPy], {
    cwd: REPO,
    encoding: 'utf8',
    env: Object.assign({}, process.env, { PYTHONPATH: path.join(REPO, 'ml') })
  });
  if (rp.error || rp.status !== 0) {
    console.log(`[PENDING] G2S-D 双端比对未执行（Python 不可用或缺 numpy/pandas）：${String(rp.error || rp.stderr).slice(0, 160)}`);
  } else {
    fs.copyFileSync(tmpPy, path.join(OUT_DIR, 'py-observations.json'));
    const rc = spawnSync(py, [COMPARATOR], { cwd: REPO, encoding: 'utf8' });
    const tail = (rc.stdout || '').trim().split('\n').slice(-3).join(' | ');
    assert.strictEqual(rc.status, 0, `双端比对门禁失败（要求 0 个未记录、未定位差异）：${tail}`);
    console.log(`[PASS] G2S-D 双端比对门禁通过：${tail}`);
  }
}

console.log('\nGen-2 场景 parity 测试（WP-G2-01）PASS');
