'use strict';
/**
 * **WP-G2-06 / F4 端到端回归**（裁决 2026-09-14 · 任务 46）
 *
 * 裁决要点：F4 必须真正进入**线上 Shadow 决策链**。此前 `runGen2ShadowEod.main()` 仍走旧链路
 *   `buildDailyRoles → buildPortfolioCandidates(1/n 等权) → applyDefense(...)`
 * 新增的 `buildCandidatePortfolio()` 只被 `_internal` / G2S-10 调用 —— 300/300 parity 证明的是
 * **新 seam**，不是线上 Shadow 实际发布的候选组合（「修复未进入决策链」）。
 *
 * 本回归用**内存 DB 驱动真实 `main()`**，并特意构造：
 *   * **非等权**角色权重（科技 cluster 上限收紧 → CORE 权重 0.1625 ≠ 0.20）
 *   * **分数排序 ≠ 权重排序**（priority=1 的 CORE 权重 < 另一只 CORE）
 * 然后断言 `main()` **实际写出的 `gen2_candidate_leg`** 与
 *   `buildCandidatePortfolio()`（G2S-10 handler 调用的那个 seam）**逐字段完全一致**。
 *
 * 三级一致性（任一级断裂即红）：
 *   ① `main()` 写库 legs  ==  ② 从原始 bars 独立重放 `computeFeatureFrame → buildCandidatePanel`
 *                          ==  ③ G2S-10 seam `buildCandidatePortfolio(...)`
 *
 * 另含**源码级**断言：`main()` 函数体内不得再出现 `buildPortfolioCandidates(` / `applyDefense(`。
 *
 * 用 vm 注入内存 DB，不连云端、不真实写入。运行：node tests/gen2-candidate-leg-e2e.test.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', 'cloudfunctions', 'runGen2ShadowEod');
const SRC_COMMON = path.resolve(__dirname, '..', 'src', 'common');
const SOURCE = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');

const MANIFEST_BUNDLE = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '..', 'ml', 'gen2', 'manifests', 'GEN2_RULE_V2_BUNDLE.json'), 'utf8'));
const RUNNING_ROLE_THRESHOLDS = {
  core_top_fraction: 0.20, challenger_top_fraction: 0.30, satellite_top_fraction: 0.40
};
const RUNNING_BUNDLE = (() => {
  const b = JSON.parse(JSON.stringify(MANIFEST_BUNDLE));
  b.selection = Object.assign({}, b.selection, { role_thresholds: RUNNING_ROLE_THRESHOLDS });
  return b;
})();

function load(data, bundle) {
  const writes = [];
  const db = {
    query: async (_, where) => (data[where && where.code] || []).slice(),
    upsert: async (collection, doc) => { writes.push({ collection, doc }); }
  };
  const bundleJson = JSON.stringify(bundle === undefined ? RUNNING_BUNDLE : bundle);
  const realFs = require('fs');
  const fsShim = Object.assign({}, realFs, {
    readFileSync: (p, ...rest) => (String(p).endsWith('GEN2_RULE_V2_BUNDLE.json')
      ? bundleJson : realFs.readFileSync(p, ...rest))
  });
  const box = {
    exports: {}, __dirname: ROOT,
    require: (p) => {
      if (p === 'fs') return fsShim;
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

/* ---------------- 合成 bars（刻意构造：非等权 + 分数排序≠权重排序） ---------------- */

const N_DAYS = 140;
const TURN_DAY = 118; // 两阶段切换点（仅 RISK_OFF 场景用）
const D_UP = 0.0040;
const D_STEP = 0.00009;

function dates(n) {
  return Array.from({ length: n }, (_, i) =>
    new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10));
}
/** 恒定日漂移 → 斜率越陡 alpha 越高（alpha = 1/3 trend + 1/3 rs + 1/3 breakout，均对斜率单调） */
function bars(code, driftUp, driftDown) {
  const ds = dates(N_DAYS);
  let px = 100;
  const down = (driftDown === undefined) ? driftUp : driftDown;
  return ds.map((d, i) => {
    px = px * (1 + (i < TURN_DAY ? driftUp : down));
    return {
      code, trade_date: d,
      open: px * 0.999, high: px * 1.002, low: px * 0.998, close: px,
      volume: 1000000 + i * 1000, amount: 200000000 + i * 1000
    };
  });
}
/** 期望 CORE：2×tech_hardware + 2×software_ai + 1×healthcare（科技合计 0.80 > 上限 0.65 → 收紧） */
const INTENDED_CORE = ['513310', '159582', '159819', '159852', '159570'];

function buildData(UNIVERSE, benchUp, benchDown) {
  const ALL = UNIVERSE.eligible_codes;
  const order = INTENDED_CORE.concat(ALL.filter((c) => !INTENDED_CORE.includes(c)));
  const data = {};
  order.forEach((code, i) => { data[code] = bars(code, D_UP - D_STEP * i, -0.0005); });
  data[UNIVERSE.benchmark_code] = bars(UNIVERSE.benchmark_code, benchUp, benchDown);
  return data;
}

/* ---------------- 断言工具 ---------------- */

let passed = 0;
let failed = 0;
function assert(name, cond, detail) {
  if (cond) { passed += 1; console.log('  PASS', name); }
  else { failed += 1; console.log('  FAIL', name, detail === undefined ? '' : JSON.stringify(detail)); }
}
const f10 = (x) => Number(x).toFixed(10);

/* ---------------- 端到端：真实 main() 写库 → 与 seam 对表 ---------------- */

async function runE2E(label, benchUp, benchDown, expectRiskOff) {
  console.log(`\n== ${label} ==`);
  const { entry: probe } = load({});
  const UNIVERSE = probe._internal.UNIVERSE;
  const ALL = UNIVERSE.eligible_codes;

  const data = buildData(UNIVERSE, benchUp, benchDown);
  const { entry, writes } = load(data);

  // ---- 1) 驱动**真实 main()**（内存 DB 注入）----
  const out = await entry.main({ mode: 'REPLAY' });
  assert(`[${label}] main() 发布 completed`, out.ok === true && out.status === 'completed', out);
  if (!out.ok) return { out, writes };

  const ranking = writes.filter((w) => w.doc.type === 'gen2_ranking').map((w) => w.doc);
  const legs = writes.filter((w) => w.doc.type === 'gen2_candidate_leg').map((w) => w.doc);
  const runDocs = writes.filter((w) => w.doc.type === 'gen2_run').map((w) => w.doc);
  const runDoc = runDocs.filter((d) => d.status === 'completed')[runDocs.filter((d) => d.status === 'completed').length - 1];

  // ---- 2) 记录类型分离（裁决：现金腿不得塞进 gen2_ranking）----
  assert(`[${label}] gen2_ranking = 30 条 ETF`,
    ranking.length === 30, { n: ranking.length });
  assert(`[${label}] gen2_ranking 不含现金腿`,
    ranking.every((r) => String(r.code) !== 'CASH' && String(r.role) !== 'CASH'));
  assert(`[${label}] gen2_candidate_leg = 30 ETF + CASH = 31 条`,
    legs.length === 31, { n: legs.length });
  assert(`[${label}] candidate leg 含现金腿且唯一`,
    legs.filter((r) => String(r.code) === 'CASH').length === 1);
  assert(`[${label}] run 记录 leg_written = 31`, runDoc && runDoc.leg_written === 31,
    runDoc && { leg_written: runDoc.leg_written });
  assert(`[${label}] run 记录带 candidate provenance（sleeve/priority_hash/config_hash）`,
    runDoc && runDoc.candidate_sleeve === 'GEN2_CANDIDATE'
    && !!runDoc.candidate_priority_hash && !!runDoc.candidate_config_hash);

  // ---- 3) sleeve / priority_source / 无 final_target（新链路指纹）----
  const etfLegs = legs.filter((r) => String(r.code) !== 'CASH');
  assert(`[${label}] 全部 legs 归属 GEN2_CANDIDATE sleeve`,
    legs.every((r) => r.sleeve === 'GEN2_CANDIDATE'));
  assert(`[${label}] ETF 腿 priority_source = INJECTED_SELECTION_SCORE（非 legacy rank）`,
    etfLegs.every((r) => r.priority_source === 'INJECTED_SELECTION_SCORE'),
    [...new Set(etfLegs.map((r) => r.priority_source))]);
  assert(`[${label}] 现金腿 priority_source = RESIDUAL_CASH_LEG`,
    legs.filter((r) => r.code === 'CASH').every((r) => r.priority_source === 'RESIDUAL_CASH_LEG'));
  assert(`[${label}] 绝不写入 V3.6.1 final_target`,
    legs.every((r) => !Object.prototype.hasOwnProperty.call(r, 'final_target')));

  // ---- 4) 独立重放：从原始 bars 走 computeFeatureFrame → buildCandidatePanel ----
  const A = entry._internal;
  const clean = {};
  for (const c of ALL.concat([UNIVERSE.benchmark_code])) {
    clean[c] = (data[c] || []).slice()
      .sort((a, b) => (a.trade_date < b.trade_date ? -1 : 1));
  }
  const { features, benchmarkFeatures } = A.computeFeatureFrame(clean, ALL);
  const allDates = [...new Set(features.map((f) => f.trade_date))].sort();
  const latestDate = allDates[allDates.length - 1];
  assert(`[${label}] main() 发布日 == 重放最新日`, out.run_date === latestDate,
    { main: out.run_date, replay: latestDate });

  const panel = A.buildCandidatePanel(features, latestDate, benchmarkFeatures);
  const panelByCode = {};
  for (const r of panel.latestLegs) panelByCode[String(r.code)] = r;

  // ---- 5) G2S-10 seam（handler 直接调用的那个函数）----
  // seam 的输入契约：benchmark 行带**公开名** `benchmark_px_ma20/ma60`（与 Python defense_gate 一致）。
  // 生产侧由 `toBenchmarkRows()` 适配 —— 这里显式复用同一个适配器，保证两条链路喂同一形状。
  const seamRows = A.buildCandidatePortfolio(panel.weightedRoles, {
    priority: panel.priority,
    portfolio_config: A.PORTFOLIO_CFG,
    defense_config: A.DEFENSE_CFG,
    benchmark: A.toBenchmarkRows(benchmarkFeatures),
    apply_defense: A.DEFENSE_CFG.enabled !== false
  });
  const seamByCode = {};
  for (const r of seamRows.filter((r) => r.trade_date === latestDate)) {
    seamByCode[String(r.code)] = r;
  }
  assert(`[${label}] seam 输出 31 腿（30 ETF + CASH）`,
    Object.keys(seamByCode).length === 31, { n: Object.keys(seamByCode).length });

  // ---- 6) 三向逐字段一致：DB 写库 == 重放 panel == G2S-10 seam ----
  const FIELDS = ['target_weight', 'priority', 'priority_score', 'priority_source',
    'priority_hash', 'sleeve', 'defense_state', 'role', 'correlation_cluster', 'name'];
  let mismatches = [];
  for (const leg of legs) {
    const c = String(leg.code);
    const p = panelByCode[c];
    const s = seamByCode[c];
    if (!p || !s) { mismatches.push({ code: c, missing: !p ? 'panel' : 'seam' }); continue; }
    for (const f of FIELDS) {
      if (f === 'target_weight') {
        if (f10(leg[f]) !== f10(p[f]) || f10(leg[f]) !== f10(s[f])) {
          mismatches.push({ code: c, field: f, db: f10(leg[f]), panel: f10(p[f]), seam: f10(s[f]) });
        }
      } else if ((leg[f] === undefined ? null : leg[f]) !== (p[f] === undefined ? null : p[f])
              || (leg[f] === undefined ? null : leg[f]) !== (s[f] === undefined ? null : s[f])) {
        mismatches.push({ code: c, field: f, db: leg[f], panel: p[f], seam: s[f] });
      }
    }
  }
  assert(`[${label}] DB 写库 == 重放 panel == G2S-10 seam（逐字段）`,
    mismatches.length === 0, mismatches.slice(0, 6));

  // ---- 7) hash / config_hash 一致 ----
  const wantCfg = A.candidateConfigHash(A.PORTFOLIO_CFG, A.DEFENSE_CFG);
  const wantPrio = A.candidatePriorityHash(panel.priority);
  assert(`[${label}] config_hash 与 seam 一致`,
    legs.every((r) => r.config_hash === wantCfg), { got: legs[0] && legs[0].config_hash, want: wantCfg });
  assert(`[${label}] priority_hash 与 seam 一致`,
    legs.every((r) => r.priority_hash === wantPrio), { got: legs[0] && legs[0].priority_hash, want: wantPrio });

  // ---- 8) G2S-10 不变量在**真实写库**上的等价检查 ----
  const sum = legs.reduce((a, b) => a + Number(b.target_weight), 0);
  assert(`[${label}] 逐日守恒（Σ legs 含现金 = 1）`, f10(sum) === f10(1), { sum: f10(sum) });

  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  const prios = legs.map((r) => Number(r.priority)).sort((a, b) => a - b);
  assert(`[${label}] priority 稠密 1..31`,
    prios.length === 31 && prios.every((v, i) => v === i + 1), prios);
  assert(`[${label}] 现金腿 priority = n+1 = 31`,
    legs.find((r) => r.code === 'CASH').priority === 31);

  const secLegs = legs.filter((r) => String(r.code) !== 'CASH');
  const maxSingle = Math.max(...secLegs.map((r) => Number(r.target_weight)));
  assert(`[${label}] 单只上限 ≤ 0.25（不含现金腿）`, maxSingle <= A.PORTFOLIO_CFG.max_single_weight + 1e-9,
    { maxSingle });
  const byCluster = {};
  const techClusters = A.PORTFOLIO_CFG.tech_clusters;
  let techSum = 0;
  for (const r of legs) {
    if (String(r.code) === 'CASH') continue;
    byCluster[r.correlation_cluster] = (byCluster[r.correlation_cluster] || 0) + Number(r.target_weight);
    if (techClusters.includes(r.correlation_cluster)) techSum += Number(r.target_weight);
  }
  const maxCluster = Math.max(...Object.values(byCluster));
  assert(`[${label}] cluster 上限 ≤ 0.40`, maxCluster <= A.PORTFOLIO_CFG.max_cluster_weight + 1e-9,
    { maxCluster });
  assert(`[${label}] 广义科技上限 ≤ 0.65`, techSum <= A.PORTFOLIO_CFG.max_tech_weight + 1e-9,
    { techSum });

  // ---- 9) 故意构造的输入性质（本回归的存在意义）----
  const cores = legs.filter((r) => String(r.role) === 'CORE');
  const distinctCoreW = [...new Set(cores.map((r) => f10(r.target_weight)))];
  assert(`[${label}] CORE 权重**非等权**（非 1/n）`,
    cores.length >= 3 && distinctCoreW.length > 1, { cores: cores.length, distinctCoreW });

  const heaviest = etfLegs.reduce((a, b) => (Number(b.target_weight) > Number(a.target_weight) ? b : a));
  const topPriority = legs.find((r) => Number(r.priority) === 1);
  assert(`[${label}] **分数排序 ≠ 权重排序**（priority=1 者不是权重最大者）`,
    String(topPriority.code) !== String(heaviest.code),
    { priority1: topPriority.code, priority1_w: f10(topPriority.target_weight),
      heaviest: heaviest.code, heaviest_w: f10(heaviest.target_weight) });

  // ---- 10) 防守腿（RISK_OFF 场景）----
  const hedgeCode = String(A.DEFENSE_CFG.hedge_code);
  const hedge = legs.find((r) => String(r.code) === hedgeCode);
  if (expectRiskOff) {
    assert(`[${label}] 防守状态 RISK_OFF`,
      etfLegs.every((r) => r.defense_state === 'RISK_OFF'),
      [...new Set(etfLegs.map((r) => r.defense_state))]);
    assert(`[${label}] 防守腿权重 == 配置 0.15`,
      f10(hedge.target_weight) === f10(A.DEFENSE_CFG.risk_off_hedge_weight),
      { got: f10(hedge.target_weight) });
    // 非防守 ETF 腿按 coreScale = exposure_scale - hedge_weight = 0.35 缩仓
    const coreScale = A.DEFENSE_CFG.risk_off_exposure_scale - A.DEFENSE_CFG.risk_off_hedge_weight;
    // 防守前权威权重（panel.latestSecurities 已是防守后，故显式重算一次）
    const preDefenseSum = A.attachAuthoritativeWeights(panel.latestRoles)
      .reduce((a, r) => a + Number(r.target_weight), 0);
    const postDefenseSum = secLegs
      .filter((r) => String(r.code) !== hedgeCode)
      .reduce((a, r) => a + Number(r.target_weight), 0);
    assert(`[${label}] 非防守腿按 exposure_scale 缩仓（0.35×）`,
      f10(postDefenseSum) === f10(preDefenseSum * coreScale),
      { preDefenseSum: f10(preDefenseSum), postDefenseSum: f10(postDefenseSum), coreScale });
    assert(`[${label}] 防守腿不与缩仓重复计入（Σ证券 = 0.35×pre + 0.15）`,
      f10(secLegs.reduce((a, r) => a + Number(r.target_weight), 0))
        === f10(preDefenseSum * coreScale + A.DEFENSE_CFG.risk_off_hedge_weight));
  } else {
    assert(`[${label}] NORMAL 下无防守腿权重`,
      f10(hedge.target_weight) === f10(0), { hedge: f10(hedge.target_weight) });
  }

  return { out, writes, legs, panel, seamByCode };
}

/* ---------------- 源码级断言：main() 不得再消费旧链路 ---------------- */

function sourceLevelChecks() {
  console.log('\n== 源码级：main() 不得再消费 buildPortfolioCandidates / applyDefense ==');
  const idx = SOURCE.indexOf('exports.main =');
  assert('定位 exports.main', idx > 0);
  // 去掉注释再检查：注释里提到旧函数名不算消费者
  const mainBody = SOURCE.slice(idx)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  // \bapplyDefense\s*\( 不会命中 applyDefenseToItems(（其后紧跟 ToItems）
  assert('main() 中无 buildPortfolioCandidates( 调用',
    !/(?<![A-Za-z0-9_])buildPortfolioCandidates\s*\(/.test(mainBody));
  assert('main() 中无 applyDefense( 调用',
    !/(?<![A-Za-z0-9_])applyDefense\s*\(/.test(mainBody));
  assert('main() 走唯一链路 buildCandidatePanel()',
    /(?<![A-Za-z0-9_])buildCandidatePanel\s*\(/.test(mainBody));
}

/* ---------------- 主流程 ---------------- */

async function main() {
  // A. NORMAL regime：非等权 + 分数排序≠权重排序（裁决要求的核心输入）
  await runE2E('A NORMAL', 0.0008, 0.0008, false);
  // B. RISK_OFF regime：同一构造 + benchmark 急跌 → 防守腿必须经 main() 落库
  await runE2E('B RISK_OFF', 0.0008, -0.030, true);
  // C. 源码级
  sourceLevelChecks();

  console.log(`\n=== 结果：${passed} 通过 / ${failed} 失败 ===`);
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
