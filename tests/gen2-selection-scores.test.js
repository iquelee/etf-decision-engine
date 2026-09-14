'use strict';
/**
 * WP-G2-05 / F1 + F2 —— JS 侧验收测试（与 Python test_selection_scores.py 对称）。
 *
 * F1：显式 Selection Score 注入链（canonical 权重来自 bundle.alpha；显式注入做精确覆盖校验，
 *     缺/多/重复/非有限一律抛错，不允许静默 fallback）。
 * F2：角色阈值只能来自显式 role_thresholds；**运行路径禁止 fallback**（WP-G2-05R：缺配置
 *     → blocked/RULE_BUNDLE_INCOMPLETE，旧 top_quantile 只在离线迁移 bundle 时读取）。
 *
 * 运行：node tests/gen2-selection-scores.test.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FN_DIR = path.resolve(__dirname, '..', 'cloudfunctions', 'runGen2ShadowEod');
const SRC_COMMON = path.resolve(__dirname, '..', 'src', 'common');
const SOURCE = fs.readFileSync(path.join(FN_DIR, 'index.js'), 'utf8');
// 冻结的规则 manifest（真实来源）：alpha 权重 + selection 段（WP-G2-04 之前尚无 role_thresholds）
const MANIFEST_BUNDLE = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '..', 'ml', 'gen2', 'manifests', 'GEN2_RULE_V2_BUNDLE.json'), 'utf8'));
const BUNDLE = MANIFEST_BUNDLE;
/** 运行配置阈值（与 ml/gen2/config/gen2.yaml portfolio.role_thresholds 一致） */
const RUNNING_ROLE_THRESHOLDS = { core_top_fraction: 0.20, challenger_top_fraction: 0.30, satellite_top_fraction: 0.40 };

/** 复制 bundle 并设置/删除 selection.role_thresholds（不污染 MANIFEST_BUNDLE） */
function withRoleThresholds(bundle, roleThresholds) {
  const b = JSON.parse(JSON.stringify(bundle));
  b.selection = Object.assign({}, b.selection);
  if (roleThresholds) b.selection.role_thresholds = roleThresholds;
  else delete b.selection.role_thresholds;
  return b;
}
/** 运行 bundle：冻结 manifest + 运行配置 role_thresholds（WP-G2-05R 起必须显式注入） */
const RUNNING_BUNDLE = withRoleThresholds(MANIFEST_BUNDLE, RUNNING_ROLE_THRESHOLDS);

/**
 * 装载生产代码。

 * ②bundle 参数：undefined → RUNNING_BUNDLE；null → 无 bundle 文件（模拟未 build）。
 * 生产代码用 `path.join(__dirname, 'GEN2_RULE_V2_BUNDLE.json')` 读 bundle，故这里提供 __dirname
 * 并用 fs shim 替换该文件的读取。
 */
function load(data, bundle, dbOverride) {
  const writes = [];
  const db = dbOverride || {
    query: async (_, where) => (data[where && where.code] || []).slice(),
    upsert: async (collection, doc, where) => { writes.push({ collection, doc, where }); }
  };
  const bundleJson = JSON.stringify(bundle === undefined ? RUNNING_BUNDLE : bundle);
  const realFs = require('fs');
  const fsShim = Object.assign({}, realFs, {
    readFileSync: (p, ...rest) => (String(p).endsWith('GEN2_RULE_V2_BUNDLE.json')
      ? bundleJson
      : realFs.readFileSync(p, ...rest))
  });
  const box = {
    exports: {},
    __dirname: FN_DIR,
    require: (p) => {
      if (p === 'fs') return fsShim;
      if (p === 'path') return require('path');
      if (p === 'crypto') return require('crypto');
      if (p === './common/utils/db') return db;
      if (p.startsWith('./common/')) return require(path.join(SRC_COMMON, p.replace(/^\.\/common\//, '')));
      return require(path.join(FN_DIR, p));
    },
    Date, console
  };
  vm.runInNewContext(SOURCE + '\nexports.audit = {UNIVERSE, ROLE_THRESHOLDS, RULE_BUNDLE_GATE, RULE_BUNDLE_REASON,'
    + ' resolveRoleThresholds, deriveRoleThresholdsFromLegacy,'
    + ' SELECTION_SCORE_WEIGHTS, SELECTION_SCORE_SOURCE, combineSelectionScore,'
    + ' validateSelectionWeights, applySelectionScores, buildDailyRoles};', box);
  return { entry: box.exports, writes };
}

/**
 * DB 读操作陷阱（闸门**顺序**证明，裁决追加验证要求）：
 * - 任何「读」操作（query / getById / getParamConfig / getEtf* / getLatest* /
 *   getActiveRiskEvents / getPosition，以及底层 getApp / getDb / getCommand / getCollection）
 *   一律**立即抛错** DB_READ_TRAP，并留下调用记录；
 * - 「写」操作（upsert / batchInsert）照常记录 —— 否则 failGate 无法落 blocked 记录，
 *   陷阱会把「闸门正确」误判成「闸门失效」。
 *
 * 判定方式：缺 role_thresholds + 陷阱 DB 下，若 reads.length === 0，即证明
 * 「规则 bundle 闸门实际位于所有数据库读取之前」，而不是仅仅「结果上优先」。
 */
function makeTrapDb() {
  const reads = [];
  const writes = [];
  const trap = (op) => (...args) => {
    reads.push({ op, collection: args[0], where: args[1] });
    throw new Error('DB_READ_TRAP: 规则 bundle 闸门之前发生了数据库读取 :: ' + op);
  };
  const db = {
    upsert: async (collection, doc, where) => { writes.push({ collection, doc, where }); },
    batchInsert: async (collection, docs) => { writes.push({ collection, docs }); },
    query: trap('query'),
    getById: trap('getById'),
    getApp: trap('getApp'),
    getDb: trap('getDb'),
    getCommand: trap('getCommand'),
    getCollection: trap('getCollection'),
    getParamConfig: trap('getParamConfig'),
    getEtfList: trap('getEtfList'),
    getEtf: trap('getEtf'),
    getLatestSnapshot: trap('getLatestSnapshot'),
    getLatestDecision: trap('getLatestDecision'),
    getLatestFundamentalState: trap('getLatestFundamentalState'),
    getActiveRiskEvents: trap('getActiveRiskEvents'),
    getPosition: trap('getPosition')
  };
  return { db, reads, writes };
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
console.log('\n== F2 角色阈值（显式 role_thresholds；运行路径禁止 fallback） ==');
{
  const t = A.ROLE_THRESHOLDS;
  assert('注入运行 bundle 后来源标注为 RUNTIME_BUNDLE', t.ok === true && t.source === 'RUNTIME_BUNDLE', t && t.source);
  assert('切点与运行配置一致（0.20/0.30/0.40 → 0.80/0.70/0.60）',
    t.core_pct === 0.8 && t.challenger_pct === 0.7 && t.satellite_pct === 0.6, t);
  assert('top_fractions 为显式分位（0.20/0.30/0.40）',
    t.top_fractions.core_top_fraction === 0.2
    && t.top_fractions.challenger_top_fraction === 0.3
    && t.top_fractions.satellite_top_fraction === 0.4, t.top_fractions);
  assert('运行 bundle 完整 → RULE_BUNDLE_GATE 为 null', A.RULE_BUNDLE_GATE === null, A.RULE_BUNDLE_GATE);

  const rb = A.resolveRoleThresholds({ role_thresholds: { core_top_fraction: 0.25, challenger_top_fraction: 0.35, satellite_top_fraction: 0.45 } });
  assert('bundle 提供 role_thresholds 时来源为 RUNTIME_BUNDLE', rb.ok && rb.source === 'RUNTIME_BUNDLE', rb.source);
  assert('派生切点 = 1 - top_fraction', rb.core_pct === 0.75 && rb.challenger_pct === 0.65 && rb.satellite_pct === 0.55, rb);

  // WP-G2-05R：缺失 / 非法一律返回 INCOMPLETE 标记（不抛错、不回退、不产出切点）
  const miss = A.resolveRoleThresholds({});
  assert('缺 role_thresholds → INCOMPLETE / MISSING（不再抛错、不再回退旧字段）',
    miss.ok === false && miss.reason === 'RULE_BUNDLE_INCOMPLETE'
    && miss.gate === 'RULE_BUNDLE_ROLE_THRESHOLDS_MISSING', miss);
  assert('缺 role_thresholds 不产出任何切点', miss.core_pct === undefined, miss.core_pct);
  const legacyOnly = A.resolveRoleThresholds({ top_quantile: 0.3, challenger_pct: 0.7, satellite_pct: 0.6 });
  assert('只有旧 top_quantile/challenger_pct/satellite_pct → 仍判 MISSING（运行路径不读旧字段）',
    legacyOnly.ok === false && legacyOnly.gate === 'RULE_BUNDLE_ROLE_THRESHOLDS_MISSING', legacyOnly);

  const badOrder = A.resolveRoleThresholds({ role_thresholds: { core_top_fraction: 0.5, challenger_top_fraction: 0.3, satellite_top_fraction: 0.4 } });
  assert('顺序非法（core > challenger）→ INCOMPLETE / INVALID',
    badOrder.ok === false && badOrder.gate === 'RULE_BUNDLE_ROLE_THRESHOLDS_INVALID', badOrder);
  const badRange = A.resolveRoleThresholds({ role_thresholds: { core_top_fraction: 0.2, challenger_top_fraction: 0.3, satellite_top_fraction: 1 } });
  assert('越界（satellite = 1）→ INCOMPLETE / INVALID',
    badRange.ok === false && badRange.gate === 'RULE_BUNDLE_ROLE_THRESHOLDS_INVALID', badRange);
  const badMissing = A.resolveRoleThresholds({ role_thresholds: { core_top_fraction: 0.2 } });
  assert('缺字段 → INCOMPLETE / INVALID',
    badMissing.ok === false && badMissing.gate === 'RULE_BUNDLE_ROLE_THRESHOLDS_INVALID', badMissing);

  // 旧字段唯一合法出口：离线迁移助手（WP-G2-04 重建 bundle 时用）
  const migrated = A.deriveRoleThresholdsFromLegacy({ top_quantile: 0.2 });
  assert('迁移助手把旧 top_quantile 换算成显式 role_thresholds（0.20/0.30/0.40）',
    migrated.core_top_fraction === 0.2 && migrated.challenger_top_fraction === 0.3
    && migrated.satellite_top_fraction === 0.4, migrated);
  const migratedDefault = A.deriveRoleThresholdsFromLegacy({});
  assert('迁移助手缺旧字段时用默认值（0.20/0.30/0.40）',
    migratedDefault.core_top_fraction === 0.2 && migratedDefault.satellite_top_fraction === 0.4, migratedDefault);
  throws('迁移助手产物非法时必须抛错（保证新 bundle 一定合法）',
    () => A.deriveRoleThresholdsFromLegacy({ top_quantile: -1 }));

  // 静态守卫：角色路径不得再直接读 top_quantile
  const roleFn = SOURCE.slice(SOURCE.indexOf('function buildDailyRoles('), SOURCE.indexOf('function buildPortfolioCandidates('));
  assert('buildDailyRoles 不再直接读 PORTFOLIO_CFG.top_quantile',
    roleFn.indexOf('PORTFOLIO_CFG.top_quantile') < 0);
  assert('buildDailyRoles 阈值经统一 resolver（可显式覆盖，默认运行配置）',
    roleFn.indexOf('roleThresholds || ROLE_THRESHOLDS') >= 0 && roleFn.indexOf('const corePct = T.core_pct') >= 0);
  assert('buildDailyRoles 对无显式阈值 fail-closed（含 RULE_BUNDLE_INCOMPLETE 断言）',
    roleFn.indexOf('RULE_BUNDLE_INCOMPLETE') >= 0);
  throws('buildDailyRoles 缺显式阈值必须抛错（第二层兜底）',
    () => A.buildDailyRoles([], { ok: false }));
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

/* ---------------- run 记录 provenance + WP-G2-05R 规则 bundle 闸门回归 ---------------- */
(async () => {
  const UNIVERSE = A.UNIVERSE;
  const mkBars = (code, n = 130) => Array.from({ length: n }, (_, i) => ({
    code,
    trade_date: new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10),
    open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i, volume: 1000000, amount: 200000000
  }));
  // 完整横截面：如果规则闸门失灵，这里会一路跑到 completed（所以「blocked」是真结论）
  const data = Object.fromEntries([...UNIVERSE.eligible_codes, UNIVERSE.benchmark_code].map((c) => [c, mkBars(c)]));

  console.log('\n== run 记录 provenance（role_thresholds / selection_score） ==');
  {
    const { entry: e, writes } = load(data);
    const out = await e.main({ mode: 'REPLAY' });
    const runDoc = writes.map((x) => x.doc).filter((d) => d.type === 'gen2_run').pop();
    assert('显式运行 bundle 下 main() completed', out.status === 'completed', out.status);
    assert('run 记录含 selection_score_source', !!runDoc && runDoc.selection_score_source === 'bundle.alpha', runDoc && runDoc.selection_score_source);
    assert('run 记录含 selection_score_hash（64 hex）',
      !!runDoc && /^[0-9a-f]{64}$/.test(String(runDoc.selection_score_hash || '')));
    assert('run 记录含 role_thresholds（显式分位）',
      !!runDoc && runDoc.role_thresholds && runDoc.role_thresholds.core_top_fraction === 0.2);
    assert('run 记录含 role_thresholds_source=RUNTIME_BUNDLE',
      !!runDoc && runDoc.role_thresholds_source === 'RUNTIME_BUNDLE', runDoc && runDoc.role_thresholds_source);
  }

  console.log('\n== WP-G2-05R 规则 bundle 闸门（缺显式 role_thresholds → blocked/RULE_BUNDLE_INCOMPLETE） ==');
  {
    // 1) bundle 缺 role_thresholds（冻结 bundle 现状）
    {
      const { entry: e, writes } = load(data, withRoleThresholds(MANIFEST_BUNDLE, null));
      const out = await e.main({ mode: 'REPLAY' });
      const runDoc = writes.map((x) => x.doc).filter((d) => d.type === 'gen2_run').pop();
      assert('缺 role_thresholds → blocked（不是 failed、不是 completed）', out.status === 'blocked', out.status);
      assert('status_reason = RULE_BUNDLE_INCOMPLETE', out.status_reason === 'RULE_BUNDLE_INCOMPLETE', out.status_reason);
      assert('data_gate = RULE_BUNDLE_ROLE_THRESHOLDS_MISSING',
        out.data_gate === 'RULE_BUNDLE_ROLE_THRESHOLDS_MISSING', out.data_gate);
      assert('run 记录落库 blocked / RULE_BUNDLE_INCOMPLETE',
        !!runDoc && runDoc.status === 'blocked' && runDoc.status_reason === 'RULE_BUNDLE_INCOMPLETE', runDoc);
      assert('闸门早于数据读取：零 ranking 写入',
        writes.filter((x) => x.doc.type === 'gen2_ranking').length === 0);
    }
    // 2) 只有旧 top_quantile/challenger_pct/satellite_pct → 仍 blocked（运行路径不读旧字段）
    {
      const legacyBundle = withRoleThresholds(MANIFEST_BUNDLE, null);
      legacyBundle.selection.top_quantile = 0.3;
      legacyBundle.selection.challenger_pct = 0.7;
      legacyBundle.selection.satellite_pct = 0.6;
      const { entry: e } = load(data, legacyBundle);
      const out = await e.main({ mode: 'REPLAY' });
      assert('只有旧 top_quantile 时仍 blocked / RULE_BUNDLE_INCOMPLETE',
        out.status === 'blocked' && out.status_reason === 'RULE_BUNDLE_INCOMPLETE',
        out.status + '/' + out.status_reason);
      assert('旧字段不参与判定（data_gate 仍是 MISSING）',
        out.data_gate === 'RULE_BUNDLE_ROLE_THRESHOLDS_MISSING', out.data_gate);
    }
    // 3) bundle 文件缺失（未 build / 本地直跑）→ blocked
    {
      const { entry: e } = load(data, null);
      const out = await e.main({ mode: 'REPLAY' });
      assert('bundle 文件缺失 → blocked / RULE_BUNDLE_INCOMPLETE',
        out.status === 'blocked' && out.status_reason === 'RULE_BUNDLE_INCOMPLETE',
        out.status + '/' + out.status_reason);
    }
    // 4) role_thresholds 非法 → blocked / INVALID（配置损坏不得静默沿用）
    {
      const badBundle = withRoleThresholds(MANIFEST_BUNDLE,
        { core_top_fraction: 0.5, challenger_top_fraction: 0.3, satellite_top_fraction: 0.4 });
      const { entry: e } = load(data, badBundle);
      const out = await e.main({ mode: 'REPLAY' });
      assert('role_thresholds 非法 → blocked / RULE_BUNDLE_ROLE_THRESHOLDS_INVALID',
        out.status === 'blocked' && out.data_gate === 'RULE_BUNDLE_ROLE_THRESHOLDS_INVALID',
        out.status + '/' + out.data_gate);
    }
  }

  console.log('\n== 闸门顺序证明：规则 bundle 闸门先于**所有** DB 读取（DB 读操作陷阱） ==');
  {
    // 顺序证明（主控）：缺 role_thresholds + 任何 DB 读都抛错 → 仍必须 blocked/RULE_BUNDLE_INCOMPLETE，
    // 且读调用计数为 0。若规则闸门只是「结果上优先」而实际先读了库，这里会变成 failed/SYSTEM_ERROR。
    const trap = makeTrapDb();
    const { entry: e } = load(data, withRoleThresholds(MANIFEST_BUNDLE, null), trap.db);
    const out = await e.main({ mode: 'REPLAY' });
    assert('缺 role_thresholds + 读操作抛错 → 仍为 blocked（不是 failed/SYSTEM_ERROR）',
      out.status === 'blocked' && out.status_reason === 'RULE_BUNDLE_INCOMPLETE',
      out.status + '/' + out.status_reason + '/' + out.error);
    assert('data_gate = RULE_BUNDLE_ROLE_THRESHOLDS_MISSING（未被数据闸门抢占）',
      out.data_gate === 'RULE_BUNDLE_ROLE_THRESHOLDS_MISSING', out.data_gate);
    assert('规则闸门早于所有 DB 读取：DB 读调用计数 = 0', trap.reads.length === 0, trap.reads);
    assert('闸门失败仍能写 blocked 运行记录（读陷阱不影响写路径）',
      trap.writes.some((w) => w.doc && w.doc.type === 'gen2_run' && w.doc.status === 'blocked'),
      trap.writes.map((w) => w.doc && w.doc.type));
    assert('未写入任何 ranking / 未触发合格性读取',
      trap.writes.filter((w) => w.doc && w.doc.type === 'gen2_ranking').length === 0);

    // 正控：同一陷阱 + 完整 role_thresholds → 读操作**必须**被触发并抛错。
    // 没有这条，上面「reads = 0」可能只是陷阱本身没接线（空跑）。
    const trap2 = makeTrapDb();
    const { entry: e2 } = load(data, undefined, trap2.db);
    const out2 = await e2.main({ mode: 'REPLAY' });
    assert('正控：完整 role_thresholds 下同一陷阱被触发（failed/SYSTEM_ERROR + DB_READ_TRAP）',
      out2.status === 'failed' && out2.status_reason === 'SYSTEM_ERROR' && /DB_READ_TRAP/.test(String(out2.error)),
      out2.status + '/' + out2.status_reason + '/' + out2.error);
    assert('正控：确实发生了 DB 读（>= 1 次，陷阱接线有效）', trap2.reads.length >= 1, trap2.reads.length);
    assert('正控：首个被触发的读操作是 GEN2_DAILY 日线读取',
      trap2.reads[0] && trap2.reads[0].op === 'query', trap2.reads[0]);
  }

  console.log('\n=== 结果：' + passed + ' 通过 / ' + failed + ' 失败 ===');
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.log('  FAIL 测试执行异常 :: ' + (err && err.stack ? err.stack : err));
  process.exit(1);
});
