'use strict';

/**
 * G1-08 / G1-11 Gate G1-C：Gen-1 Python ↔ Node Golden Parity。
 *
 * 校验：
 *   ① Node 推理 == fixture.expected_probability（Node 自身不漂移）
 *   ② Python 独立实现 == Node（max_abs_diff < 1e-10）
 *   ③ 阈值分类 P >= 0.65 必须 100% 一致（含 0.64x / 0.65x / 0.66x 边界）
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const FIXTURE = path.join(REPO, 'fixtures', 'gen1', 'gen1_inference_golden_v1.json');
const PY_SCRIPT = path.join(REPO, 'scripts', 'ml', 'gen1_frozen_inference.py');
const TOL = 1e-10;

const _WIN_PY = 'C:/Users/iquel/.workbuddy/binaries/python/envs/default/Scripts/python.exe';
const PYTHON = process.env.TCB_PYTHON || (fs.existsSync(_WIN_PY) ? _WIN_PY : 'python3');

assert.ok(fs.existsSync(FIXTURE), 'fixture missing; run node scripts/gen-gen1-golden-fixture.js');

const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const { predictProbability, modelId } = require(path.join(REPO, 'cloudfunctions/runGen1ShadowEod/frozen-node-inference'));

assert.strictEqual(modelId, fixture.model_id, 'model_id must match fixture');
assert.ok(fixture.rows.length >= 200, `fixture rows must be >= 200, got ${fixture.rows.length}`);

// ① Node 复算一致性
let nodeMaxDiff = 0;
for (const row of fixture.rows) {
  const p = predictProbability(Object.assign({ code: row.code }, row.features));
  const d = Math.abs(p - row.expected_probability);
  if (d > nodeMaxDiff) nodeMaxDiff = d;
}
assert.ok(nodeMaxDiff < 1e-12, `Node recompute drift too large: ${nodeMaxDiff}`);

// ② Python 推理
const outFile = path.join(os.tmpdir(), `g1_parity_${Date.now()}.json`);
const run = spawnSync(PYTHON, [PY_SCRIPT, '--fixture', FIXTURE, '--out', outFile], { cwd: REPO, encoding: 'utf8' });
if (run.status !== 0) {
  console.error(run.stdout, run.stderr);
  throw new Error('python gen1_frozen_inference failed');
}
const py = JSON.parse(fs.readFileSync(outFile, 'utf8'));
fs.unlinkSync(outFile);
assert.strictEqual(py.rows.length, fixture.rows.length, 'python row count mismatch');

const pyById = new Map(py.rows.map((r) => [r.row_id, r.probability]));
let maxAbsDiff = 0;
let worstRow = null;
let classMismatch = 0;
const boundary = [];
const TH = fixture.threshold_signal_p;

for (const row of fixture.rows) {
  const pNode = row.expected_probability;
  const pPy = pyById.get(row.row_id);
  assert.ok(pPy != null, `python missing row ${row.row_id}`);
  const d = Math.abs(pNode - pPy);
  if (d > maxAbsDiff) { maxAbsDiff = d; worstRow = row.row_id; }
  // ③ 阈值分类一致
  if ((pNode >= TH) !== (pPy >= TH)) classMismatch += 1;
  // 边界样本（0.64x / 0.65x / 0.66x）
  if (Math.abs(pNode - TH) <= 0.02) boundary.push({ id: row.row_id, node: pNode, py: pPy });
}

assert.strictEqual(classMismatch, 0, `threshold classification mismatch on ${classMismatch} rows`);
assert.ok(maxAbsDiff < TOL, `Python↔Node max_abs_diff ${maxAbsDiff} >= ${TOL} (worst ${worstRow})`);
assert.ok(boundary.length > 0, 'fixture must contain boundary rows near 0.65');

const posNode = fixture.rows.filter((r) => r.expected_probability >= TH).length;
console.log(`gen1 parity tests passed — rows=${fixture.rows.length} node_drift=${nodeMaxDiff.toExponential(2)} `
  + `py_max_abs_diff=${maxAbsDiff.toExponential(2)} threshold_mismatch=${classMismatch} `
  + `boundary_rows=${boundary.length} P>=${TH}: ${posNode}/${fixture.rows.length}`);
