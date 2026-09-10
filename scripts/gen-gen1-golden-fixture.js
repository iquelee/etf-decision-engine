#!/usr/bin/env node
/**
 * 生成 Gen-1 Golden Parity Fixture（WP-G1 / G1-08）。
 *
 * 方法（确定、可复现）：
 *   ① 随机搜索找「高概率种子」；
 *   ② 对种子做局部扰动 → 沿决策边界走出 low / near0.35 / mid / near0.65 / above0.65 / high 各带；
 *   ③ 按带配额挑选；再叠加「数值缺失」「类别未知」派生行；
 *   ④ 写入 fixtures/gen1/gen1_inference_golden_v1.json（含 Node 计算出的 expected_probability）。
 *
 * 覆盖矩阵：五只 ETF / 高低概率 / 近 0.35 / 近 0.65 / 高于 0.65 / breakout 与非 breakout /
 *          不同 W-D-H-V state / partial coverage / OOD / 数值缺失 / 类别未知。
 *
 * 用法：node scripts/gen-gen1-golden-fixture.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const manifest = require(path.join(REPO, 'cloudfunctions/runGen1ShadowEod/frozen-manifest.json'));
const { predictProbability, modelId } = require(path.join(REPO, 'cloudfunctions/runGen1ShadowEod/frozen-node-inference'));

const SEED = 20260910;
const CODES = [
  { code: '513310', runtime_sector: 'storage', coverage: 'partial' },
  { code: '515880', runtime_sector: 'ai_network', coverage: 'partial' },
  { code: '159582', runtime_sector: 'semi_equip', coverage: 'partial' },
  { code: '159570', runtime_sector: 'biotech', coverage: 'in_domain' },
  { code: '518880', runtime_sector: 'gold', coverage: 'out_of_domain' }
];
const W = ['W1', 'W2', 'W3', 'W4'];                    // 模型类别（无 W5）
const D = ['D1', 'D2', 'D3', 'D4', 'D5'];
const H = ['H1', 'H2', 'H3', 'H4', 'H5'];
const V = ['V1', 'V2', 'V3', 'V4', 'V5'];
const MODEL_SECTORS = ['ai', 'biotech', 'comms', 'growth_broad', 'semi']; // 模型训练类别

/** 特征生成范围（依据 frozen-model 训练中位数定标）。 */
const RANGE = {
  ma20_slope: [-10, 10], px_ma20: [-0.4, 0.6], px_ma60: [-0.5, 0.8],
  price_position: [0, 1], volume_ratio: [0.1, 3], sideway_days: [0, 60],
  sideway_range: [0, 40], consolidation_score: [0, 100], atr20: [0.002, 0.1],
  change_5d: [-0.4, 0.5], bias_20d: [-40, 60], breakout: [0, 1],
  ret_5d: [-0.5, 0.9], ret_20d: [-0.5, 0.9], rs_20d: [-0.5, 0.9]
};

function rng(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function band(p) {
  if (p < 0.30) return 'low';
  if (Math.abs(p - 0.35) <= 0.02) return 'near_0.35';
  if (p < 0.63) return 'mid';
  if (Math.abs(p - 0.65) <= 0.02) return 'near_0.65';
  if (p < 0.80) return 'above_0.65';
  return 'high';
}

function randomRow(rand) {
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const row = {};
  for (const [k, [lo, hi]] of Object.entries(RANGE)) row[k] = Number((lo + rand() * (hi - lo)).toFixed(5));
  row.sideway_days = Math.floor(row.sideway_days);
  row.breakout = rand() < 0.5 ? 1 : 0;
  row.w_state = pick(W); row.d_state = pick(D); row.h_state = pick(H); row.v_state = pick(V);
  row.sector = pick(MODEL_SECTORS);
  return row;
}

/** 种子 + 局部扰动：沿决策边界走。 */
function perturb(rand, seed, scale) {
  const row = Object.assign({}, seed);
  for (const [k, [lo, hi]] of Object.entries(RANGE)) {
    const span = hi - lo;
    const delta = (rand() * 2 - 1) * span * scale;
    let v = Number(row[k]) + delta;
    v = Math.max(lo, Math.min(hi, v));
    row[k] = Number(v.toFixed(5));
  }
  row.sideway_days = Math.max(0, Math.min(60, Math.round(row.sideway_days)));
  if (rand() < 0.35) row.breakout = 1 - row.breakout;
  if (rand() < 0.3) row.w_state = W[Math.floor(rand() * W.length)];
  if (rand() < 0.3) row.d_state = D[Math.floor(rand() * D.length)];
  if (rand() < 0.3) row.h_state = H[Math.floor(rand() * H.length)];
  if (rand() < 0.3) row.v_state = V[Math.floor(rand() * V.length)];
  row.sector = MODEL_SECTORS[Math.floor(rand() * MODEL_SECTORS.length)];
  return row;
}

function main() {
  const rand = rng(SEED);
  const quota = { low: 70, 'near_0.35': 40, mid: 90, 'near_0.65': 60, 'above_0.65': 60, high: 40 };
  const buckets = { low: [], 'near_0.35': [], mid: [], 'near_0.65': [], 'above_0.65': [], high: [] };

  // ① 随机搜索找种子（高概率极稀疏）
  const seeds = [];
  for (let i = 0; i < 60000; i += 1) {
    const row = randomRow(rand);
    const p = predictProbability(row);
    const b = band(p);
    if (b !== 'low' && buckets[b].length < quota[b]) buckets[b].push({ row, p });
    if (p >= 0.55 && seeds.length < 40) seeds.push(row);
  }

  // ② 种子局部扰动：多尺度，最大化带宽覆盖
  const scales = [0.02, 0.05, 0.1, 0.2, 0.35, 0.5];
  for (let round = 0; round < 14; round += 1) {
    for (const seed of seeds) {
      for (const sc of scales) {
        const row = perturb(rand, seed, sc);
        const p = predictProbability(row);
        const b = band(p);
        if (buckets[b].length < quota[b]) buckets[b].push({ row, p });
      }
    }
    const full = Object.keys(quota).every((k) => buckets[k].length >= quota[k]);
    if (full) break;
  }

  // ③ 汇总 + 赋 code/coverage（轮转五只 ETF）
  const flat = [];
  let ci = 0;
  for (const b of ['low', 'near_0.35', 'mid', 'near_0.65', 'above_0.65', 'high']) {
    for (const entry of buckets[b]) {
      const c = CODES[ci % CODES.length]; ci += 1;
      flat.push({ row: entry.row, p: entry.p, band: b, code: c.code, coverage: c.coverage, runtime_sector: c.runtime_sector });
    }
  }

  // ④ 派生：数值缺失 / 类别未知
  const variants = [];
  flat.slice(0, 80).forEach((e) => {
    const miss = Object.assign({}, e.row, { ma20_slope: null, bias_20d: null, atr20: null });
    variants.push({ row: miss, p: predictProbability(miss), band: e.band, code: e.code, coverage: e.coverage,
      runtime_sector: e.runtime_sector, missing_numeric: true });
  });
  flat.slice(0, 80).forEach((e) => {
    const unknown = Object.assign({}, e.row, { sector: 'quantum_unknown', w_state: 'WX', v_state: 'VX' });
    variants.push({ row: unknown, p: predictProbability(unknown), band: e.band, code: e.code, coverage: 'unknown',
      runtime_sector: e.runtime_sector, unknown_category: true });
  });

  const all = flat.concat(variants);
  const rows = all.map((e, i) => ({
    row_id: `g1-${String(i + 1).padStart(4, '0')}`,
    code: e.code,
    runtime_sector: e.runtime_sector,
    model_sector_category: e.row.sector,
    coverage: e.coverage,
    band: e.band,
    breakout: e.row.breakout,
    missing_numeric: !!e.missing_numeric,
    unknown_category: !!e.unknown_category,
    features: e.row,
    expected_probability: e.p
  }));

  const fixture = {
    fixture_version: 'gen1-inference-golden-v1',
    model_id: modelId,
    seed: SEED,
    generated_at: '2026-09-10',
    generator: 'scripts/gen-gen1-golden-fixture.js',
    feature_core: manifest.features_core,
    feature_cat: manifest.features_cat,
    threshold_signal_p: manifest.thresholds.signal_p,
    row_count: rows.length,
    notes: [
      'expected_probability 由 Node frozen-node-inference 计算（与生产同实现）。',
      'Python 侧 scripts/ml/gen1_frozen_inference.py 独立重写推理，parity 要求 max_abs_diff < 1e-10。',
      'IMPORTANT: 模型训练类别 sector ∈ {ai, biotech, comms, growth_broad, semi}；',
      '运行时 runGen1ShadowEod 传入 sector ∈ {storage, ai_network, semi_equip, gold, biotech} →',
      '除 biotech 外均编码为 -1（unknown）。本 fixture 同时包含两类取值以记录该不一致（不改模型）。'
    ],
    rows
  };

  const outDir = path.join(REPO, 'fixtures', 'gen1');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'gen1_inference_golden_v1.json'), JSON.stringify(fixture, null, 2) + '\n', 'utf8');

  const byBand = rows.reduce((a, r) => { a[r.band] = (a[r.band] || 0) + 1; return a; }, {});
  const byCode = rows.reduce((a, r) => { a[r.code] = (a[r.code] || 0) + 1; return a; }, {});
  console.log(`[OK] fixtures/gen1/gen1_inference_golden_v1.json  rows=${rows.length}`);
  console.log('     band:', JSON.stringify(byBand));
  console.log('     code:', JSON.stringify(byCode));
  console.log(`     missing_numeric=${rows.filter((r) => r.missing_numeric).length}  unknown_category=${rows.filter((r) => r.unknown_category).length}`);
  if (rows.length < 200) { console.error('FATAL: rows < 200'); process.exitCode = 1; }
}

main();
