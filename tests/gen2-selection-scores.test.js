'use strict';
/**
 * WP-G2-05 / F1 + F2 —— JS 侧验收测试（与 Python test_selection_scores.py 对称）。
 *
 * F1：显式 Selection Score 注入链（canonical 权重来自 bundle.alpha；显式注入做精确覆盖校验，
 *     缺/多/重复/非有限一律抛错，不允许静默 fallback）。
 * F2：角色阈值来自显式 role_thresholds；迁移窗口内回落旧 top_quantile 必须**标注来源**，
 *     且角色路径不得再直接读 top_quantile。
 *
 * 运行：node tests/gen2-selection-scores.test.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FN_DIR = path.resolve(__dirname, '..', 'cloudfunctions', 'runGen2ShadowEod');
const SRC_COMMON = path.resolve(__dirname, '..', 'src', 'common');
const SOURCE = fs.readFileSync(path.join(FN_DIR, 'index.js'), 'utf8');
// bundle 由 npm run build 复制到函数目录；本地未 build 时读 manifests 原件
const BUNDLE_PATH = fs.existsSync(path.join(FN_DIR, 'GEN2_RULE_V2_BUNDLE.json'))
  ? path.join(FN_DIR, 'GEN2_RULE_V2_BUNDLE.json')
  : path.resolve(__dirname, '..', 'ml', 'gen2', 'manifests', 'GEN2_RULE_V2_BUNDLE.json');
const BUNDLE = JSON.parse(fs.readFileSync(BUNDLE_PATH, 'utf8'));

function load(data) {
  const writes = [];
  const db = {
    query: async (_, where) => (data[where && where.code] || []).slice(),
    upsert: async (collection, doc, where) => { writes.push({ collection, doc, where }); }
  };
  const box = {
    exports: {},
    require: (p) => {
      if (p === 'fs') return require('fs');
      if (p === 'path') return require('path');
      if (p === 'crypto') return require('crypto');
      if (p === './common/utils/db') return db;
      if (p.startsWith('./common/')) return require(path.join(SRC_COMMON, p.replace(/^\.\/common\//, '')));
      return require(path.join(FN_DIR, p));
    },
    Date, console
  };
  vm.runInNewContext(SOURCE + '\nexports.audit = {UNIVERSE, ROLE_THRESHOLDS, resolveRoleThresholds,'
    + ' SELECTION_SCORE_WEIGHTS, SELECTION_SCORE_SOURCE, combineSelectionScore,'
    + ' validateSelectionWeights, applySelectionScores, buildDailyRoles};', box);
  return { entry: box.exports, writes };
}

const { entry } = load({});
const A = entry.audit;

let passed = 0;
let failed = 0;
function assert(name, cond, extra) {
  if (cond) { passed += 1; console.log('  PASS ' + name); }
  else { failed += 1; console.log('  FAIL ' + name + (extra ? ' :: ' + JSON.stringify(extra) : '')); }
}
function throws(name, fn) {
  try { fn(); assert(name, false, '未抛错'); }
  catch (e) { assert(name, true); }
}

/* ---------------- F2：角色阈值 ---------------- */
console.log('\n== F2 角色阈值（显式 role_thresholds / 迁移窗口标注） ==');
{
  const t = A.ROLE_THRESHOLDS;
  // 当前冻结 bundle 尚无 role_thresholds → 回落必须显式标注来源
  assert('bundle 无 role_thresholds 时来源标注为 LEGACY_TOP_QUANTILE_AUDIT',
    t.source === 'LEGACY_TOP_QUANTILE_AUDIT', t.source);
  assert('默认切点与历史行为一致（0.80/0.70/0.60）',
    t.core_pct === 0.8 && t.challenger_pct === 0.7 && t.satellite_pct === 0.6, t);
  assert('top_fractions 为显式分位（0.20/0.30/0.40）',
    t.top_fractions.core_top_fraction === 0.2
    && t.top_fractions.challenger_top_fraction === 0.3
    && t.top_fractions.satellite_top_fraction === 0.4, t.top_fractions);

  const rb = A.resolveRoleThresholds({ role_thresholds: { core_top_fraction: 0.25, challenger_top_fraction: 0.35, satellite_top_fraction: 0.45 } });
  assert('bundle 提供 role_thresholds 时来源为 RUNTIME_BUNDLE', rb.source === 'RUNTIME_BUNDLE', rb.source);
  assert('派生切点 = 1 - top_fraction', rb.core_pct === 0.75 && rb.challenger_pct === 0.65 && rb.satellite_pct === 0.55, rb);

  throws('顺序非法（core > challenger）必须抛错',
    () => A.resolveRoleThresholds({ role_thresholds: { core_top_fraction: 0.5, challenger_top_fraction: 0.3, satellite_top_fraction: 0.4 } }));
  throws('越界（satellite = 1）必须抛错',
    () => A.resolveRoleThresholds({ role_thresholds: { core_top_fraction: 0.2, challenger_top_fraction: 0.3, satellite_top_fraction: 1 } }));
  throws('缺字段必须抛错',
    () => A.resolveRoleThresholds({ role_thresholds: { core_top_fraction: 0.2 } }));

  // 静态守卫：角色路径不得再直接读 top_quantile（只能经 resolver 的迁移分支）
  const roleFn = SOURCE.slice(SOURCE.indexOf('function buildDailyRoles('), SOURCE.indexOf('function buildPortfolioCandidates('));
  assert('buildDailyRoles 不再直接读 PORTFOLIO_CFG.top_quantile',
    roleFn.indexOf('PORTFOLIO_CFG.top_quantile') < 0);
  assert('buildDailyRoles 阈值经统一 resolver（可显式覆盖，默认运行配置）',
    roleFn.indexOf('roleThresholds || ROLE_THRESHOLDS') >= 0 && roleFn.indexOf('const corePct = T.core_pct') >= 0);
}

/* ---------------- F1：显式 Selection Score ---------------- */
console.log('\n== F1 显式 Selection Score（合成 + 校验 + provenance） ==');
{
  // canonical 权重必须等于 bundle.alpha（单一真相源）
  const near = (a, b) => Math.abs(a - b) < 1e-9;  // bundle 副本缺失时函数内 fallback 为 1/3
  assert('SELECTION_SCORE_WEIGHTS 来自 bundle.alpha',
    near(A.SELECTION_SCORE_WEIGHTS.trend, BUNDLE.alpha.trend)
    && near(A.SELECTION_SCORE_WEIGHTS.rs, BUNDLE.alpha.rs)
    && near(A.SELECTION_SCORE_WEIGHTS.breakout, BUNDLE.alpha.breakout), A.SELECTION_SCORE_WEIGHTS);
  assert('canonical 来源标注为 bundle.alpha', A.SELECTION_SCORE_SOURCE === 'bundle.alpha', A.SELECTION_SCORE_SOURCE);

  // 等权特例必须与历史 mean([trend,rs,breakout]) 逐位一致
  const row = { trend_score: 10, rs_score: 20.5, breakout_approach_score: 33.25 };
  const expected = (10 + 20.5 + 33.25) / 3;
  assert('等权合成与 mean() 逐位一致', A.combineSelectionScore(row, A.SELECTION_SCORE_WEIGHTS) === expected);
  assert('全 null 组件返回 null', A.combineSelectionScore({ trend_score: null, rs_score: null, breakout_approach_score: null }, A.SELECTION_SCORE_WEIGHTS) === null);
  const w = A.combineSelectionScore({ trend_score: 10, rs_score: 20 }, { trend: 0.25, rs: 0.75 });
  assert('加权合成（0.25/0.75）= 17.5', Math.abs(w - 17.5) < 1e-12, w);

  throws('未知组件权重必须抛错', () => A.validateSelectionWeights({ nope: 1 }));
  throws('负权重必须抛错', () => A.validateSelectionWeights({ trend: -1 }));
  throws('全零权重必须抛错', () => A.validateSelectionWeights({ trend: 0 }));

  // 显式注入：精确覆盖校验
  const features = [
    { trade_date: '2026-03-02', code: 'AAA', alpha_score_v2: null },
    { trade_date: '2026-03-02', code: 'BBB', alpha_score_v2: null }
  ];
  const meta = A.applySelectionScores(features, { '2026-03-02': { AAA: 5, BBB: 1 } }, 'SCENARIO_ALPHA');
  assert('显式注入写入评分', features[0].alpha_score_v2 === 5 && features[1].alpha_score_v2 === 1);
  assert('注入返回 provenance（source/version/hash/coverage）',
    meta.score_source === 'SCENARIO_ALPHA' && meta.score_coverage === 2
    && typeof meta.score_hash === 'string' && meta.score_hash.length === 64, meta);

  throws('缺键必须抛错（不 fallback）',
    () => A.applySelectionScores([{ trade_date: 'd', code: 'X', alpha_score_v2: null }], { d: { Y: 1 } }, 'S'));
  throws('多键必须抛错',
    () => A.applySelectionScores([{ trade_date: 'd', code: 'X', alpha_score_v2: null }],
      { d: { X: 1, Z: 2 } }, 'S'));
  throws('非有限值必须抛错',
    () => A.applySelectionScores([{ trade_date: 'd', code: 'X', alpha_score_v2: null }],
      { d: { X: 'not-a-number' } }, 'S'));

  // canonical 路径（explicit = null）：返回 provenance + 记录 null 行数
  const f2 = [{ trade_date: 'd', code: 'X', alpha_score_v2: 3 }, { trade_date: 'd', code: 'Y', alpha_score_v2: null }];
  const m2 = A.applySelectionScores(f2, null);
  assert('canonical 路径 provenance', m2.score_source === 'bundle.alpha' && m2.score_coverage === 1 && m2.score_null_rows === 1, m2);
}

/* ---------------- run 记录必须带 provenance ---------------- */
console.log('\n== run 记录 provenance（role_thresholds / selection_score） ==');
{
  const UNIVERSE = A.UNIVERSE;
  const mkBars = (code, n = 130) => Array.from({ length: n }, (_, i) => ({
    code,
    trade_date: new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10),
    open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i, volume: 1000000, amount: 200000000
  }));
  const data = Object.fromEntries([...UNIVERSE.eligible_codes, UNIVERSE.benchmark_code].map((c) => [c, mkBars(c)]));
  const { entry: e, writes } = load(data);
  e.main({ mode: 'REPLAY' }).then((out) => {
    const runDoc = writes.map((x) => x.doc).filter((d) => d.type === 'gen2_run').pop();
    assert('run 记录含 selection_score_source', !!runDoc && runDoc.selection_score_source === 'bundle.alpha', runDoc && runDoc.selection_score_source);
    assert('run 记录含 selection_score_hash（64 hex）',
      !!runDoc && /^[0-9a-f]{64}$/.test(String(runDoc.selection_score_hash || '')));
    assert('run 记录含 role_thresholds（显式分位）',
      !!runDoc && runDoc.role_thresholds && runDoc.role_thresholds.core_top_fraction === 0.2);
    assert('run 记录含 role_thresholds_source（迁移窗口标注）',
      !!runDoc && !!runDoc.role_thresholds_source, runDoc && runDoc.role_thresholds_source);

    console.log('\n=== 结果：' + passed + ' 通过 / ' + failed + ' 失败 ===');
    process.exit(failed ? 1 : 0);
  }).catch((err) => {
    console.log('  FAIL run 执行异常 :: ' + err.message);
    process.exit(1);
  });
}
