'use strict';
/**
 * **WP-G2-04 冻结一致性回归**（裁决 2026-09-14：PR #29 合并后立即进入 WP-G2-04，只做冻结、不部署）。
 *
 * 本回归回答三个问题：
 *
 *   ① **锁是不是真的锁住了**：`GEN2_RULE_V2_LOCK.json` 覆盖的每一项（bundle / JS 实现 /
 *      Python 规则·候选·防守实现 / Python 阈值加载校验契约 / 显式 Alpha 实现 / 统一 regime 契约）
 *      SHA 是否与磁盘实际一致；条目数与 id 集合是否被静默删减/顶替。
 *   ② **冻结后规则闸门是否解除**：冻结 bundle 必须自带 `selection.role_thresholds`
 *      ⇒ 用**真实冻结文件**驱动真实 `main()` 时必须 `completed`（而不是
 *      `blocked / RULE_BUNDLE_INCOMPLETE`）。这条是 WP-G2-04 的目的本身。
 *   ③ **迁移有没有偷偷调参**：迁移只允许改 `bundle_version` / `selection` / `notes`；
 *      alpha / regime / portfolio caps / defense / universe 必须与 v2.0 逐值相同，
 *      且 `role_thresholds` 必须等于旧字段按同一公式换算的结果（跨语言同式）。
 *
 * 注意：本测试**不做 bundle 注入**——`fs` 不做替换，生产代码直接读磁盘上被冻结的那份
 * `GEN2_RULE_V2_BUNDLE.json`（连同 `__dirname` 语义）。因此它测的是「线上真正加载的规则」。
 *
 * 运行：node tests/gen2-rule-freeze.test.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const REPO = path.resolve(__dirname, '..');
const ROOT = path.join(REPO, 'cloudfunctions', 'runGen2ShadowEod');
const SRC_COMMON = path.join(REPO, 'src', 'common');
const SOURCE = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');

const BUNDLE_REL = 'ml/gen2/manifests/GEN2_RULE_V2_BUNDLE.json';
const LOCK_REL = 'ml/gen2/manifests/GEN2_RULE_V2_LOCK.json';
const BUNDLE = JSON.parse(fs.readFileSync(path.join(REPO, BUNDLE_REL), 'utf8'));
const LOCK = JSON.parse(fs.readFileSync(path.join(REPO, LOCK_REL), 'utf8'));

/** 与 verify-immutable.js 同口径：CRLF→LF 归一化后再哈希。 */
function sha256Norm(rel) {
  const buf = fs.readFileSync(path.join(REPO, rel));
  return crypto.createHash('sha256').update(buf.toString('utf8').replace(/\r\n/g, '\n')).digest('hex');
}

/**
 * 装载生产代码。**不做内容注入** —— 只把「生产代码按 `__dirname` 读 bundle」这一路径
 * **映射到冻结真相源** `ml/gen2/manifests/GEN2_RULE_V2_BUNDLE.json`（读的是磁盘真实字节，
 * 不是测试里拼出来的对象）。
 *
 * 为什么需要映射：生产运行时 `__dirname` 是构建产物 `dist-functions/runGen2ShadowEod/`
 * （bundle 由 `build-cloudfunctions.js` 复制进去，`dist-functions/` 不入库）。
 * 该产物与冻结源**逐位一致**这件事由 `scripts/verify-gen2-build-artifacts.js`（Stage F）负责；
 * 本测试关心的是「被冻结的那份规则」能否让 main() 走通，因此直接读冻结源。
 */
function loadFrozen(data) {
  const writes = [];
  const db = {
    query: async (_, where) => (data[where && where.code] || []).slice(),
    upsert: async (collection, doc) => { writes.push({ collection, doc }); }
  };
  const frozenBundleAbs = path.join(REPO, BUNDLE_REL);
  const fsMapped = Object.assign({}, fs, {
    readFileSync: (p, ...rest) => (String(p).endsWith('GEN2_RULE_V2_BUNDLE.json')
      ? fs.readFileSync(frozenBundleAbs, ...rest)
      : fs.readFileSync(p, ...rest))
  });
  const box = {
    exports: {}, __dirname: ROOT,
    require: (p) => {
      if (p === 'fs') return fsMapped;
      if (p === 'path') return require('path');
      if (p === 'crypto') return require('crypto');
      if (p === './common/utils/db') return db;
      if (p.startsWith('./common/')) return require(path.join(SRC_COMMON, p.replace(/^\.\/common\//, '')));
      return require(path.join(ROOT, p));
    }, Date, console
  };
  vm.runInNewContext(SOURCE, box);
  return { entry: box.exports, writes };
}

let passed = 0;
let failed = 0;
function assert(name, cond, detail) {
  if (cond) { passed += 1; console.log('  PASS', name); }
  else { failed += 1; console.log('  FAIL', name, detail === undefined ? '' : JSON.stringify(detail)); }
}

/* ---------------- 合成完整横截面（30 ETF + benchmark，130 交易日） ---------------- */

function bars(code, n = 130) {
  return Array.from({ length: n }, (_, i) => ({
    code,
    trade_date: new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10),
    open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i, volume: 1000000, amount: 200000000
  }));
}

/* ---------------- 主流程 ---------------- */

async function main() {
  const { entry: probe } = loadFrozen({});
  // 探针：不注入 bundle，但 main() 未跑；这里仅取 UNIVERSE 常量（与线上同一来源）
  const A = probe._internal;

  console.log('\n== ① 锁 ↔ 磁盘：冻结对象 SHA ==');
  assert('lock.engine_id = gen2-rule-v2', LOCK.engine_id === 'gen2-rule-v2', LOCK.engine_id);
  assert(`lock.bundle_version == bundle.bundle_version（${LOCK.bundle_version}）`,
    LOCK.bundle_version === BUNDLE.bundle_version, [LOCK.bundle_version, BUNDLE.bundle_version]);
  assert('lock.bundle_version 已升版本（不再是 gen2-rule-v2.0）',
    LOCK.bundle_version !== 'gen2-rule-v2.0', LOCK.bundle_version);
  assert('lock.bundle_sha256 == 冻结 bundle 实际 SHA',
    LOCK.bundle_sha256 === sha256Norm(BUNDLE_REL),
    { lock: LOCK.bundle_sha256, actual: sha256Norm(BUNDLE_REL) });

  const entries = LOCK.immutable_set || [];
  const ids = entries.map((e) => e.id).sort();
  assert('immutable_set 覆盖 bundle + JS 实现 + Python 规则/候选/防守/阈值契约/评分/regime（8 项，不多不少）',
    entries.length === 8
    && JSON.stringify(ids) === JSON.stringify(
      ['bundle', 'js_implementation', 'python_candidate', 'python_defense',
        'python_regime', 'python_role_thresholds', 'python_rule', 'python_selection_scores']),
    ids);
  // 扩围的**目的**：阈值加载/校验契约必须被锁住（否则改它即可在 bundle 字节不变时改语义）。
  const rtEntry = entries.find((e) => e.id === 'python_role_thresholds');
  assert('python_role_thresholds 锁定 ml/gen2/portfolio/role_thresholds.py',
    rtEntry && rtEntry.file === 'ml/gen2/portfolio/role_thresholds.py',
    rtEntry);
  // lock_revision 3 扩围：显式 Alpha 实现 + 统一 regime 契约必须被锁住。
  const ssEntry = entries.find((e) => e.id === 'python_selection_scores');
  assert('python_selection_scores 锁定 ml/gen2/baseline/selection_scores.py',
    ssEntry && ssEntry.file === 'ml/gen2/baseline/selection_scores.py', ssEntry);
  const rgEntry = entries.find((e) => e.id === 'python_regime');
  assert('python_regime 锁定 ml/gen2/portfolio/regime.py',
    rgEntry && rgEntry.file === 'ml/gen2/portfolio/regime.py', rgEntry);
  assert('lock_revision == 3（两次审查裁决扩围均已入锁）',
    LOCK.lock_revision === 3, LOCK.lock_revision);
  for (const e of entries) {
    const actual = sha256Norm(e.file);
    assert(`[${e.id}] ${e.file} SHA == 磁盘实际`, actual === e.sha256,
      { lock: e.sha256, actual });
  }
  assert('build_artifacts 声明 2 项（云函数 bundle + index.js）',
    (LOCK.build_artifacts || []).length === 2,
    (LOCK.build_artifacts || []).map((a) => a.id));

  console.log('\n== ② 迁移语义：role_thresholds 已烘焙、旧字段退出运行段 ==');
  const sel = BUNDLE.selection || {};
  assert('bundle.selection.role_thresholds 存在且为对象',
    sel.role_thresholds && typeof sel.role_thresholds === 'object', sel.role_thresholds);
  for (const k of ['core_pct', 'challenger_pct', 'satellite_pct', 'top_quantile']) {
    assert(`运行 selection 段不再含旧字段 ${k}`,
      !Object.prototype.hasOwnProperty.call(sel, k), Object.keys(sel));
  }
  const audit = sel.legacy_migration_audit || {};
  assert('旧字段完整保留在 legacy_migration_audit（可审计）',
    audit.core_pct === 0.8 && audit.challenger_pct === 0.7
    && audit.satellite_pct === 0.6 && audit.top_quantile === 0.2,
    audit);
  assert('legacy_migration_audit.status = MIGRATION_AUDIT_ONLY',
    audit.status === 'MIGRATION_AUDIT_ONLY', audit.status);

  // 跨语言同式：JS 迁移助手对旧字段的换算结果，必须**逐值等于**已烘焙的 role_thresholds。
  const derived = A.deriveRoleThresholdsFromLegacy(audit);
  assert('JS 迁移助手派生值 == 已烘焙 role_thresholds（两端同式）',
    JSON.stringify(derived) === JSON.stringify(sel.role_thresholds),
    { derived, baked: sel.role_thresholds });
  assert('role_thresholds = 0.20 / 0.30 / 0.40（与迁移前 core_pct 0.80 语义等价）',
    sel.role_thresholds.core_top_fraction === 0.2
    && sel.role_thresholds.challenger_top_fraction === 0.3
    && sel.role_thresholds.satellite_top_fraction === 0.4, sel.role_thresholds);

  console.log('\n== ③ 参数未变（迁移不是调参） ==');
  const snap = JSON.stringify({
    alpha: BUNDLE.alpha,
    regime: BUNDLE.regime,
    portfolio: BUNDLE.portfolio,
    defense: BUNDLE.defense,
    universe_version: BUNDLE.universe_version,
    benchmark_code: BUNDLE.benchmark_code,
    selection_rest: {
      promotion_persistence_days: sel.promotion_persistence_days,
      demotion_persistence_days: sel.demotion_persistence_days,
      max_core_count: sel.max_core_count,
      max_core_per_cluster: sel.max_core_per_cluster,
      min_replacement_edge: sel.min_replacement_edge
    }
  });
  const expected = JSON.stringify({
    alpha: { trend: 0.3333333333, rs: 0.3333333333, breakout: 0.3333333333 },
    regime: { risk_on_ge: 55, risk_off_le: 45 },
    portfolio: {
      max_single_weight: 0.25, max_cluster_weight: 0.40, max_tech_weight: 0.65,
      tech_clusters: ['tech_hardware', 'software_ai']
    },
    defense: {
      risk_off_exposure_scale: 0.50, risk_off_hedge_weight: 0.15, hedge_code: '518880',
      vol_target_enabled: true, vol_target_annualized: 0.17
    },
    universe_version: 'universe_v1',
    benchmark_code: '510300',
    selection_rest: {
      promotion_persistence_days: 5, demotion_persistence_days: 5, max_core_count: 5,
      max_core_per_cluster: 2, min_replacement_edge: 8.0
    }
  });
  assert('alpha/regime/portfolio/defense/selection 其余字段 == v2.0 原值（逐值相同）',
    snap === expected, { actual: JSON.parse(snap), expected: JSON.parse(expected) });

  console.log('\n== ④ 冻结后规则闸门解除（真实冻结文件驱动真实 main()） ==');
  const { entry, writes } = loadFrozen({
    ...Object.fromEntries([...A.UNIVERSE.eligible_codes, A.UNIVERSE.benchmark_code].map((c) => [c, bars(c)]))
  });
  const rt = entry._internal.resolveRoleThresholds(BUNDLE.selection);
  assert('resolveRoleThresholds(冻结 bundle.selection) → ok / RUNTIME_BUNDLE',
    rt.ok === true && rt.source === 'RUNTIME_BUNDLE', rt);
  assert('派生切点 = 0.80 / 0.70 / 0.60（与迁移前等价）',
    rt.core_pct === 0.8 && rt.challenger_pct === 0.7 && rt.satellite_pct === 0.6, rt);

  const out = await entry.main({ mode: 'REPLAY' });
  assert('完整横截面 30/30 → completed（**不再是** blocked/RULE_BUNDLE_INCOMPLETE）',
    out.ok === true && out.status === 'completed', out);
  assert('data_gate 为空（规则闸门放行后由数据闸门接手并通过）',
    out.data_gate === null || out.data_gate === undefined, out.data_gate);

  const runDoc = writes.filter((w) => w.doc.type === 'gen2_run').map((w) => w.doc).pop();
  assert('run 记录 role_thresholds_source = RUNTIME_BUNDLE（来源是冻结 bundle，不是 fallback）',
    runDoc && runDoc.role_thresholds_source === 'RUNTIME_BUNDLE',
    runDoc && runDoc.role_thresholds_source);
  assert('run 记录 role_thresholds.core_top_fraction = 0.2',
    runDoc && runDoc.role_thresholds && runDoc.role_thresholds.core_top_fraction === 0.2,
    runDoc && runDoc.role_thresholds);
  assert('run 记录 bundle_version == lock.bundle_version（线上加载的就是被冻结的那份）',
    runDoc && runDoc.bundle_version === LOCK.bundle_version,
    { run: runDoc && runDoc.bundle_version, lock: LOCK.bundle_version });
  assert('发布记录：30 条 gen2_ranking（只含 ETF）',
    writes.filter((w) => w.doc.type === 'gen2_ranking').length === 30,
    writes.filter((w) => w.doc.type === 'gen2_ranking').length);
  assert('发布记录：31 条 gen2_candidate_leg（30 ETF + CASH）',
    writes.filter((w) => w.doc.type === 'gen2_candidate_leg').length === 31,
    writes.filter((w) => w.doc.type === 'gen2_candidate_leg').length);

  console.log(`\n=== 结果：${passed} 通过 / ${failed} 失败 ===`);
  if (failed) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
