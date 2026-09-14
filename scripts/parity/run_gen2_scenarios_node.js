'use strict';
/**
 * WP-G2-01 —— Gen-2 场景夹具的 Node 端 runner。
 *
 * 通过 vm 加载 `cloudfunctions/runGen2ShadowEod/index.js`（生产代码，不修改），
 * 额外导出仅用于**读取**的审计面（与 tests/gen2-gate.test.js 同一手法）：
 *   applyReplacementGate / assertFinalRoleConstraints / computeReplacementEdge / shouldReplace
 *
 * 对 fixtures/gen2/golden_scenarios_v1.json 的 RUNNABLE 场景输出 canonical JSON。
 * 只读、不写库、不改规则、不部署。
 *
 * 用法：node scripts/parity/run_gen2_scenarios_node.js [fixture.json] [out.json]
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const FN_DIR = path.join(ROOT, 'cloudfunctions', 'runGen2ShadowEod');
const SRC_COMMON = path.join(ROOT, 'src', 'common');
const SOURCE = fs.readFileSync(path.join(FN_DIR, 'index.js'), 'utf8');

const fixturePath = process.argv[2] || path.join(ROOT, 'fixtures', 'gen2', 'golden_scenarios_v1.json');
const outPath = process.argv[3] || null;
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

const AUDIT_EXPORT = '\nexports.audit = { UNIVERSE, PORTFOLIO_CFG, DEFENSE_CFG, ROLE_THRESHOLDS, resolveRoleThresholds, RULE_BUNDLE_GATE, RULE_BUNDLE_REASON, deriveRoleThresholdsFromLegacy, SELECTION_SCORE_WEIGHTS, SELECTION_SCORE_SOURCE, combineSelectionScore, applySelectionScores, selectionScoreHash,'
  + ' marketScore, classifyRegime, selectionMode, promotionAllowed, maxCoreCount,'
  + ' computeLeadershipScore, rankFeatures, initialRoles, buildDailyRoles,'
  + ' buildCandidatePortfolio, candidatePriorityHash, candidateConfigHash,'
  + ' computeReplacementEdge, shouldReplace, applyReplacementGate, assertFinalRoleConstraints, finalizeRoles,'
  + ' inspectBarsIntegrity, validatePublishResults };\n';

/** 空 db（纯函数场景用；run 级场景另见 makeRunDb） */
const EMPTY_DB = { query: async () => [], upsert: async () => {} };

// G2S-10：与 Python 端逐字一致的确定性工具（固定 10 位小数 / code 升序 / 上限观测）
function fixed10N(x) { return Number(x).toFixed(10); }
function byCodeAscN(a, b) {
  const ca = String(a.code); const cb = String(b.code);
  return ca < cb ? -1 : (ca > cb ? 1 : 0);
}
function candidateCapsObs(rows) {
  const nonCash = rows.filter((r) => r.code !== 'CASH').slice().sort(byCodeAscN);
  let maxSingle = 0;
  const byCluster = {};
  const byDayTech = {};
  const TECH = ['software_ai', 'tech_hardware'];
  for (const r of nonCash) {
    maxSingle = Math.max(maxSingle, r.target_weight);
    const ck = String(r.trade_date) + '~' + String(r.correlation_cluster);
    byCluster[ck] = (byCluster[ck] || 0) + r.target_weight;
    if (TECH.indexOf(r.correlation_cluster) >= 0) {
      const dk = String(r.trade_date);
      byDayTech[dk] = (byDayTech[dk] || 0) + r.target_weight;
    }
  }
  let maxCluster = 0;
  for (const k in byCluster) maxCluster = Math.max(maxCluster, byCluster[k]);
  let maxTech = 0;
  for (const k in byDayTech) maxTech = Math.max(maxTech, byDayTech[k]);
  return { maxSingle, maxCluster, maxTech };
}

// WP-G2-05R：运行路径不再有 role_thresholds fallback（缺 → blocked/RULE_BUNDLE_INCOMPLETE）。
// 因此 parity 必须**显式注入**运行 bundle：冻结 manifest + 运行配置 role_thresholds。
const MANIFEST_PATH = path.join(ROOT, 'ml', 'gen2', 'manifests', 'GEN2_RULE_V2_BUNDLE.json');
const MANIFEST_BUNDLE = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const RUNNING_ROLE_THRESHOLDS = { core_top_fraction: 0.20, challenger_top_fraction: 0.30, satellite_top_fraction: 0.40 };

/** 复制 bundle 并设置/删除 selection.role_thresholds（不污染 MANIFEST_BUNDLE） */
function withRoleThresholds(bundle, roleThresholds) {
  const b = JSON.parse(JSON.stringify(bundle));
  b.selection = Object.assign({}, b.selection);
  if (roleThresholds) b.selection.role_thresholds = roleThresholds;
  else delete b.selection.role_thresholds;
  return b;
}
const DEFAULT_BUNDLE = withRoleThresholds(MANIFEST_BUNDLE, RUNNING_ROLE_THRESHOLDS);

/**
 * 加载生产代码到 vm。
 *
 * 生产代码用 `path.join(__dirname, 'GEN2_RULE_V2_BUNDLE.json')` 读 bundle，所以这里
 * ①提供 `__dirname`；②用 fs shim 把 bundle 文件读取替换为**注入的 bundle 对象**
 *    （bundle === undefined → DEFAULT_BUNDLE；null → 无 bundle 文件，模拟未 build）。
 */
function loadEntry(dbImpl, bundle) {
  const bundleJson = JSON.stringify(bundle === undefined ? DEFAULT_BUNDLE : bundle);
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
      if (p === './common/utils/db') return dbImpl || EMPTY_DB;
      if (p.startsWith('./common/')) return require(path.join(SRC_COMMON, p.replace(/^\.\/common\//, '')));
      return require(path.join(FN_DIR, p));
    },
    Date,
    console
  };
  vm.runInNewContext(SOURCE + AUDIT_EXPORT, box);
  return box.exports;
}

const A = loadEntry(EMPTY_DB).audit;
const r4 = (v) => (v == null ? null : Math.round(v * 1e4) / 1e4);
const num = (v) => (v == null || v === '' ? null : Number(v));

/** 结构化 day → JS 端形态（数组 + 单复数字段名） */
function toJsDay(rows) {
  return rows.map((r) => ({
    code: r.code,
    role: r.role,
    role_before_cap: r.role_before_cap != null ? r.role_before_cap : r.role,
    alpha_score_v2: num(r.alpha_score_v2),
    reason_codes: r.reason_codes != null ? r.reason_codes : ''
  }));
}

function snapshot(day) {
  const roles = {};
  const reason = {};
  const perCluster = {};
  const clusterUsed = {};
  for (const r of day) {
    roles[r.code] = r.role;
    reason[r.code] = r.reason_codes || '';
    clusterUsed[r.code] = A.UNIVERSE.cluster[r.code] || 'other';
  }
  for (const r of day) {
    if (r.role !== 'CORE') continue;
    const cl = A.UNIVERSE.cluster[r.code] || 'other';
    perCluster[cl] = (perCluster[cl] || 0) + 1;
  }
  return {
    roles,
    reason_codes: reason,
    core_count: day.filter((r) => r.role === 'CORE').length,
    per_cluster_core: perCluster,
    // adapter 自证：本端实际使用的 cluster 映射（供比对器核对与夹具声明是否一致）
    cluster_used: clusterUsed
  };
}

/* ---------- canonical roles panel 展开（V1；与 Python 端逐字一致） ---------- */

const PANEL_BASE_DATE = '2026-06-';
const PANEL_CONST = {
  sideway_days: 20, sideway_range: 0.05, volume_ratio_5_20: 1.0,
  momentum_accel_5_20: 0.01, atr20_pct: 0.02, realized_vol20: 0.25,
  max_drawdown_20d: -0.1, corr_to_portfolio_60d: 0.3, corr_to_cluster_60d: 0.4,
  avg_amount_20d: 100000000.0, ret_1d: 0.0, ret_20d: 0.02, ret_60d: 0.05, close: 1.0
};
const R4 = (v) => Math.round(v * 1e4) / 1e4;

function expandPanel(panel, c) {
  const rows = [];
  for (let d = 1; d <= c.days; d += 1) {
    c.rank_order.forEach((code, idx) => {
      const k = idx + 1; // 1 = 最高 alpha
      const broken = (c.trend_break[code] || []).indexOf(d) >= 0;
      const row = Object.assign({}, PANEL_CONST, {
        trade_date: `${PANEL_BASE_DATE}${String(d).padStart(2, '0')}`,
        code,
        px_ma20: R4(0.10 - 0.01 * (k - 1)),
        px_ma60: broken ? -0.02 : R4(0.08 - 0.01 * (k - 1)),
        ma20_slope_5d: R4(0.05 - 0.005 * (k - 1)),
        ma60_slope_10d: R4(0.04 - 0.004 * (k - 1)),
        rs20_vs_benchmark: R4(0.06 - 0.006 * (k - 1)),
        rs60_vs_benchmark: R4(0.05 - 0.005 * (k - 1)),
        rs_accel_5d: R4(0.02 - 0.002 * (k - 1)),
        breakout_distance: c.breakout_ascending ? R4(0.003 * k) : R4(0.03 - 0.003 * (k - 1)),
        benchmark_px_ma20: R4(c.benchmark.px_ma20),
        benchmark_px_ma60: R4(c.benchmark.px_ma60),
        eligibility: 'ELIGIBLE'
      });
      rows.push(row);
    });
  }
  return rows;
}

/** panel_sha256：对「规范化元组」做 sha256（两端字符串必须逐字相同） */
function panelHash(rows) {
  const lines = rows.map((r) => [
    r.trade_date, r.code, r.px_ma20, r.px_ma60, r.ma20_slope_5d, r.ma60_slope_10d,
    r.rs20_vs_benchmark, r.rs60_vs_benchmark, r.rs_accel_5d, r.breakout_distance,
    r.benchmark_px_ma20, r.benchmark_px_ma60
  ].map((v) => (typeof v === 'number' ? v.toFixed(4) : String(v))).join(','));
  return crypto.createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex');
}

/** reason 归一化（契约见夹具 seam_contracts.reason_normalization）：剥离纯标签差异 */
const ZONE_CODES = ['LEADERSHIP_TOP_QUINTILE', 'LEADERSHIP_CHALLENGER_ZONE',
  'LEADERSHIP_SATELLITE_ZONE', 'LEADERSHIP_BELOW_SATELLITE'];
function normalizeReasons(raw) {
  return String(raw || '')
    .split('|')
    .map((x) => x.replace(/_WAIT$/, '').replace(/_KEEP$/, ''))
    .filter((x) => x && ZONE_CODES.indexOf(x) < 0)
    .join('|');
}

function rolesSnapshot(dayRows, panelCodes) {
  const days = {};
  const reasons = {};
  const reasonsNorm = {};
  const clusterCore = {};
  const clusterUsed = {};
  for (const r of dayRows) {
    const d = String(Number(String(r.trade_date).slice(8, 10)));
    (days[d] = days[d] || {})[r.code] = r.role;
    (reasons[d] = reasons[d] || {})[r.code] = r.reason_codes || '';
    (reasonsNorm[d] = reasonsNorm[d] || {})[r.code] = normalizeReasons(r.reason_codes);
    if (r.role === 'CORE') {
      const cl = A.UNIVERSE.cluster[r.code] || 'other';
      (clusterCore[d] = clusterCore[d] || {})[cl] = ((clusterCore[d] || {})[cl] || 0) + 1;
    }
  }
  for (const c of panelCodes) clusterUsed[c.code] = A.UNIVERSE.cluster[c.code] || 'other';
  return { days, reasons, reasons_norm: reasonsNorm, cluster_core_count: clusterCore, cluster_used: clusterUsed };
}

/* ---------- canonical run panel 展开（RUN_V1；与 Python 端逐字一致） ---------- */

function runPanelCodes(panel) {
  return panel.codes.concat([panel.benchmark_code]);
}

/** 生成 run 级日线面板：全整数运算，保证两端逐位一致 */
function runPanelBase(panel) {
  const rows = [];
  const base = Date.parse(panel.base_date + 'T00:00:00Z');
  const codes = runPanelCodes(panel);
  for (let i = 0; i < panel.days; i += 1) {
    const d = new Date(base + i * 86400000).toISOString().slice(0, 10);
    codes.forEach((code, j) => {
      const stepQ = 100 + 5 * j; // 每只标的不同斜率（百分比×100，整数）
      const close = panel.price_base + Math.floor((i * stepQ) / 100);
      const volume = panel.volume + 1000 * j;
      rows.push({
        code, trade_date: d,
        open: close - 1, high: close + 2, low: close - 2, close,
        volume, amount: volume * close
      });
    });
  }
  return rows;
}

function groupByCode(rows) {
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r.code)) m.set(r.code, []);
    m.get(r.code).push(r);
  }
  return m;
}

/** 变异算子（与 Python 端逐字一致）：制造陈旧 / 重复 / 缺基准 / 短历史 / NaN 等场景 */
function applyRunMutations(rows, mutations, panel) {
  const groups = groupByCode(rows);
  const sel = (spec) => {
    if (spec === 'eligible') return panel.codes.slice();
    if (spec === 'all') return runPanelCodes(panel);
    return Array.isArray(spec) ? spec.slice() : [spec];
  };
  for (const m of mutations || []) {
    const codes = sel(m.codes != null ? m.codes : m.code);
    if (m.op === 'slice_last') {
      for (const c of codes) if (groups.has(c)) groups.set(c, groups.get(c).slice(-m.n));
    } else if (m.op === 'drop_code') {
      for (const c of codes) groups.delete(c);
    } else if (m.op === 'stale_shift') {
      for (const c of codes) if (groups.has(c)) groups.set(c, groups.get(c).slice(0, groups.get(c).length - m.days));
    } else if (m.op === 'duplicate_last') {
      for (const c of codes) {
        if (!groups.has(c)) continue;
        const g = groups.get(c);
        g.push(Object.assign({}, g[g.length - 1]));
      }
    } else if (m.op === 'nan_field') {
      for (const c of codes) {
        const g = groups.get(c);
        if (!g) continue;
        const idx = m.row < 0 ? g.length + m.row : m.row;
        g[idx] = Object.assign({}, g[idx]);
        g[idx][m.field] = null;
      }
    } else {
      throw new Error(`unknown run mutation op ${m.op}`);
    }
  }
  const out = [];
  for (const g of groups.values()) out.push(...g);
  out.sort((a, b) => (a.trade_date < b.trade_date ? -1 : a.trade_date > b.trade_date ? 1
    : (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)));
  return out;
}

const fmtCell = (v) => (v == null ? 'null' : (typeof v === 'number' ? v.toFixed(4) : String(v)));

function runPanelHash(rows) {
  const lines = rows.map((r) => [r.code, r.trade_date, r.open, r.high, r.low, r.close, r.volume, r.amount]
    .map(fmtCell).join(','));
  return crypto.createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex');
}

function runPublishHash(codes, alphas, written) {
  const line = codes.join('|') + ';' + alphas.map(fmtCell).join('|') + ';' + String(written);
  return crypto.createHash('sha256').update(line, 'utf8').digest('hex');
}

/** 注入式 db：query 返回面板数据；simulate_system_error 时抛异常以触发 failed 路径 */
function makeRunDb(groups, opts) {
  const writes = [];
  const reads = [];
  const db = {
    query: async (collection, where) => {
      reads.push({ collection, where });
      // WP-G2-05R 追加验证：读操作陷阱 —— 任何数据读取**立即抛错**。
      // 用来证明规则 bundle 闸门位于所有数据库读取**之前**（不是「结果上优先」）。
      if (opts && opts.trapReads) throw new Error('DB_READ_TRAP: 规则 bundle 闸门之前发生了数据库读取');
      if (opts && opts.failQuery) throw new Error('injected db query failure (SYSTEM_ERROR simulation)');
      const code = where && where.code;
      return (groups.get(code) || []).slice();
    },
    upsert: async (collection, doc) => { writes.push({ collection, doc }); }
  };
  return { db, writes, reads };
}

/** 驱动真实 main()：注入 db + 事件，取「最后一次 gen2_run 写入 / 返回值」的规范化状态 */
async function runMainCase(panel, caseSpec) {
  const rows = applyRunMutations(runPanelBase(panel), caseSpec.mutations, panel);
  const { db, writes } = makeRunDb(groupByCode(rows), { failQuery: !!caseSpec.simulate_system_error });
  const entry = loadEntry(db);
  const out = await entry.main(Object.assign({}, caseSpec.event || {}));
  const runs = writes.filter((w) => w.doc && w.doc.type === 'gen2_run');
  const last = runs.length ? runs[runs.length - 1].doc : null;
  const pick = (a, b) => (a === undefined || a === null ? (b === undefined ? null : b) : a);
  return {
    status: pick(out && out.status, last && last.status),
    status_reason: pick(out && out.status_reason, last && last.status_reason),
    data_gate: pick(out && out.data_gate, last && last.data_gate),
    panel_sha256: runPanelHash(rows)
  };
}

/** 跨端可比的评分摘要（3 位小数；与 Python selection_digest 逐字一致） */
function selectionDigest(features, places = 3) {
  const rows = features
    .filter((f) => f.alpha_score_v2 != null && isFinite(f.alpha_score_v2))
    .map((f) => `${f.trade_date}~${f.code}~${Number(f.alpha_score_v2).toFixed(places)}`)
    .sort();
  return crypto.createHash('sha256').update(rows.join('|')).digest('hex');
}

const HANDLERS = {
  regime_selection(sc) {
    const out = {};
    for (const c of sc.input.cases) {
      const s = c.market_score == null ? null : num(c.market_score);
      out[c.id] = {
        regime: A.classifyRegime(s),
        selection_mode: A.selectionMode(s),
        promotion_allowed: A.promotionAllowed(s),
        max_core_count: A.maxCoreCount(s, sc.input.base_max_core)
      };
    }
    return out;
  },

  replacement_edge(sc) {
    const out = {};
    for (const c of sc.input.cases) {
      const ch = num(c.challenger_alpha);
      const inc = num(c.incumbent_alpha);
      out[c.id] = {
        edge: r4(A.computeReplacementEdge(ch, inc)),
        should_replace: A.shouldReplace(ch, inc)
      };
    }
    return out;
  },

  cluster_cap(sc) {
    const mk = () => toJsDay(sc.input.day);
    const prev = Object.assign({}, sc.input.prev_roles);
    const out = {};

    const dayAssert = mk();
    A.assertFinalRoleConstraints(dayAssert, Object.assign({}, prev));
    out.assert_call = snapshot(dayAssert);

    const dayGate = mk();
    A.applyReplacementGate(dayGate, Object.assign({}, prev));
    out.gate_call = snapshot(dayGate);

    // WP-G2-03：角色生成统一出口（替换事务 + 无条件终局约束检查）
    const dayExit = mk();
    A.finalizeRoles(dayExit, Object.assign({}, prev));
    out.exit_call = snapshot(dayExit);
    return out;
  },

  core_cap(sc) {
    const day = toJsDay(sc.input.day);
    A.assertFinalRoleConstraints(day, Object.assign({}, sc.input.prev_roles));
    return { assert_call: snapshot(day) };
  },

  replacement_transaction(sc) {
    const out = {};
    for (const c of sc.input.cases) {
      const day = toJsDay(c.day);
      A.applyReplacementGate(day, Object.assign({}, c.prev_roles));
      out[c.id] = snapshot(day);
    }
    return out;
  },

  async run_status_gate(sc) {
    const panel = sc.input.panel;
    const declared = runPanelCodes(panel).slice().sort().join(',');
    const ownUniverse = A.UNIVERSE.eligible_codes.concat([A.UNIVERSE.benchmark_code]).slice().sort().join(',');
    const selfCheck = {
      universe_matches_fixture: declared === ownUniverse,
      target_size_matches_fixture: A.UNIVERSE.target_size === panel.target_size
    };
    const out = {};
    for (const c of sc.input.data_cases) {
      // run 级 seam：注入 db 驱动真实 main()，观察 run 文档状态（不作弊、不旁路）
      const obs = await runMainCase(panel, c);
      out[c.id] = Object.assign(obs, selfCheck);
    }
    for (const c of sc.input.publish_cases) {
      // 发布完整性 seam：直调纯函数（唯一 code / 非有限 alpha / 写入 0 行）
      const rows = c.codes.map((code, i) => ({
        code, alpha_score_v2: c.alphas[i] == null ? null : Number(c.alphas[i])
      }));
      const res = A.validatePublishResults(rows, c.written);
      out[c.id] = Object.assign({
        status: res.status, status_reason: res.status_reason, data_gate: res.data_gate,
        panel_sha256: runPublishHash(c.codes, c.alphas, c.written)
      }, selfCheck);
    }
    return out;
  },

  roles_panel(sc) {
    const panel = sc.input.panel;
    const out = {};
    for (const c of panel.cases) {
      const rows = expandPanel(panel, c);
      const feat = rows.map((r) => Object.assign({}, r));
      A.computeLeadershipScore(feat);
      A.rankFeatures(feat);
      const roles = A.buildDailyRoles(feat);
      const snap = rolesSnapshot(roles, panel.codes);
      snap.panel_sha256 = panelHash(rows);
      snap.panel_rows = rows.length;
      // 自证：本端 cluster 映射与夹具声明一致（不一致说明 adapter/宇宙漂移）
      snap.cluster_map_matches_fixture = panel.codes.every(
        (x) => (A.UNIVERSE.cluster[x.code] || 'other') === x.cluster);
      out[c.id] = snap;
    }
    return out;
  },
  /** G2S-08：显式 Selection Score 注入 + 角色阈值（F1/F2 跨语言 parity） */
  selection_injection(sc) {
    const panel = sc.input.panel;
    const out = {};
    let canon = null;
    for (const rawCase of sc.input.cases) {
      // panel 级 days / rank_order 作为默认值合入 case（cases 只声明差异旋钮）
      const c = Object.assign({}, rawCase, {
        days: rawCase.days || panel.days,
        rank_order: rawCase.rank_order || panel.rank_order_default
      });
      const rows = expandPanel(panel, c);
      const feat = rows.map((r) => Object.assign({}, r));
      A.computeLeadershipScore(feat);

      let meta;
      if (c.explicit_rank_order) {
        const order = c.explicit_rank_order;
        const inj = {};
        for (const f of feat) {
          const idx = order.indexOf(f.code);
          const v = order.length - idx;
          (inj[f.trade_date] = inj[f.trade_date] || {})[f.code] = v;
        }
        meta = A.applySelectionScores(feat, inj, 'EXPLICIT_ORDER');
      } else if (c.selection) {
        const inj = {};
        for (const f of feat) {
          (inj[f.trade_date] = inj[f.trade_date] || {})[f.code] = A.combineSelectionScore(f, c.selection);
        }
        meta = A.applySelectionScores(feat, inj, 'SCENARIO_ALPHA');
      } else {
        meta = A.applySelectionScores(feat, null);
      }

      A.rankFeatures(feat);
      // WP-G2-05R：运行配置阈值必须由夹具**显式声明**并注入；不再依赖「bundle 缺 role_thresholds
      // 时回退旧 top_quantile」这条已删除的隐式路径。
      const thresholds = A.resolveRoleThresholds({
        role_thresholds: c.role_thresholds || panel.role_thresholds_running_config
      });
      if (!thresholds.ok) throw new Error(`G2S-08 需要显式 role_thresholds：${thresholds.detail}`);
      const roles = A.buildDailyRoles(feat, thresholds);
      // 显式构造与 Python 端逐字一致的字段集（不使用 rolesSnapshot 的 reasons 等额外字段）
      const days = {};
      const coreCount = {};
      const clusterCore = {};
      for (const r of roles) {
        const d = String(Number(String(r.trade_date).slice(8, 10)));
        (days[d] = days[d] || {})[r.code] = r.role;
        coreCount[d] = (coreCount[d] || 0) + (r.role === 'CORE' ? 1 : 0);
        if (r.role === 'CORE') {
          const cl = A.UNIVERSE.cluster[r.code] || 'other';
          (clusterCore[d] = clusterCore[d] || {})[cl] = ((clusterCore[d] || {})[cl] || 0) + 1;
        }
      }
      const clusterUsed = {};
      for (const x of panel.codes) clusterUsed[x.code] = A.UNIVERSE.cluster[x.code] || 'other';
      const snap = { days, core_count: coreCount, cluster_core_count: clusterCore, cluster_used: clusterUsed };
      snap.panel_sha256 = panelHash(rows);
      snap.panel_rows = rows.length;
      snap.score_source = meta.score_source;
      snap.score_digest = selectionDigest(feat);
      snap.role_thresholds_effective = {
        core_pct: thresholds.core_pct,
        challenger_pct: thresholds.challenger_pct,
        satellite_pct: thresholds.satellite_pct
      };
      snap.role_thresholds_source_class = c.role_thresholds ? 'EXPLICIT' : 'RUNNING_CONFIG';
      if (c.id === 'canonical') canon = snap;
      const isCanon = c.id === 'canonical';
      snap.score_digest_distinct_from_canonical = (canon && !isCanon)
        ? snap.score_digest !== canon.score_digest : null;
      snap.roles_differ_from_canonical = (canon && !isCanon)
        ? JSON.stringify(snap.days) !== JSON.stringify(canon.days) : null;
      snap.core_count_differs_from_canonical = (canon && !isCanon)
        ? JSON.stringify(snap.core_count) !== JSON.stringify(canon.core_count) : null;
      if (c.explicit_rank_order) {
        const lastDay = Object.keys(snap.days).sort().pop();
        snap.role_order_matches_injection = snap.days[lastDay][c.explicit_rank_order[0]] === 'CORE';
      }
      out[c.id] = snap;
    }
    return out;
  },

  /**
   * G2S-09：规则 bundle 闸门（WP-G2-05R）。
   *
   * 逐 case 用「冻结 manifest 的 selection 段 + 覆盖项」拼出注入 bundle，驱动真实 `main()`：
   *   * blocked 用例走**空 db** —— 若规则闸门没抢在数据闸门之前，会先撞 BENCHMARK_MISSING；
   *     拿到 RULE_BUNDLE_* 本身就是「规则闸门优先级最高」的证据；
   *   * complete 用例走**完整面板** —— 正对照，证明只补 role_thresholds 即恢复 completed。
   */
  async rule_bundle_gate(sc) {
    const panel = sc.input.panel;
    const base = sc.input.bundle_selection_base;
    const out = {};
    // 驱动真实 main()：注入 bundle + 数据行，取「返回值 / 最后一次 gen2_run 写入」的规范化状态
    const runCase = async (bundle, rows, opts) => {
      const { db: rdb, writes, reads } = makeRunDb(groupByCode(rows), opts || {});
      const entry = loadEntry(rdb, bundle);
      const res = await entry.main({ mode: 'REPLAY' });
      const runs = writes.filter((w) => w.doc && w.doc.type === 'gen2_run');
      const last = runs.length ? runs[runs.length - 1].doc : null;
      const pick = (a, b) => (a === undefined || a === null ? (b === undefined ? null : b) : a);
      const err = String((res && res.error) || '');
      return {
        status: pick(res && res.status, last && last.status),
        status_reason: pick(res && res.status_reason, last && last.status_reason),
        data_gate: pick(res && res.data_gate, last && last.data_gate),
        // 顺序证明证据：数据源读取尝试次数 + 读陷阱是否被触发
        data_source_reads: reads.length,
        data_source_trap_raised: /DB_READ_TRAP/.test(err)
      };
    };
    for (const c of sc.input.cases) {
      const selection = Object.assign({}, base, c.bundle_selection_overrides || {});
      const bundle = Object.assign({}, MANIFEST_BUNDLE, { selection });
      const rows = c.data === 'full_panel'
        ? applyRunMutations(runPanelBase(panel), [], panel)
        : [];
      // trap_reads：同一面板换成「一读就抛错」的 db —— 缺阈值时必须仍 blocked 且零读取；
      // 有阈值时必然被触发（正控：证明陷阱真的接线了）。
      const opts = c.trap_reads ? { trapReads: true } : {};
      const primary = await runCase(bundle, rows, opts);
      // 顺序证据：同一 bundle 在**空数据**下的状态。规则闸门若未抢在数据闸门之前，
      // 这里会得到 BENCHMARK_MISSING 而不是 RULE_BUNDLE_*。
      const early = await runCase(bundle, []);
      const direct = loadEntry(EMPTY_DB, bundle).audit.resolveRoleThresholds(selection);
      out[c.id] = {
        status: primary.status,
        status_reason: primary.status_reason,
        data_gate: primary.data_gate,
        rule_bundle_status: direct.ok ? 'COMPLETE' : 'INCOMPLETE',
        role_thresholds_effective: direct.ok ? {
          core_pct: direct.core_pct,
          challenger_pct: direct.challenger_pct,
          satellite_pct: direct.satellite_pct
        } : null,
        panel_sha256: runPanelHash(rows),
        data_source_reads: c.trap_reads ? primary.data_source_reads : null,
        data_source_trap_raised: primary.data_source_trap_raised,
        early_gate_data_gate: early.data_gate,
        early_gate_status_reason: early.status_reason
      };
    }
    return out;
  },

  /** G2S-10：统一候选组合构建（WP-G2-06 / F4）—— JS 影子端 vs Python 回测逐日对表 */
  portfolio_build(sc) {
    const panel = sc.input.panel;
    const pcfg = panel.portfolio_config || {};
    const dcfg = panel.defense_config || {};
    const out = {};
    for (const c of sc.input.cases) {
      let rows = null;
      let error = null;
      try {
        rows = A.buildCandidatePortfolio(panel.roles, {
          priority: panel.priority,
          portfolio_config: pcfg,
          defense_config: dcfg,
          benchmark: panel.benchmark,
          apply_defense: !!c.apply_defense
        });
      } catch (e) {
        error = String(e && e.message ? e.message : e);
      }
      const obs = { error: error, final_target_present: false };
      if (rows) {
        const nonCash = rows.filter((r) => r.code !== 'CASH');
        obs.sleeve = rows.length ? rows[0].sleeve : null;
        obs.priority_hash = rows.length ? rows[0].priority_hash : null;
        obs.config_hash = A.candidateConfigHash(pcfg, dcfg);
        obs.priority_source_all_injected = nonCash.every(
          (r) => r.priority_source === 'INJECTED_SELECTION_SCORE');
        obs.final_target_present = rows.some((r) => Object.prototype.hasOwnProperty.call(r, 'final_target'));
        const caps = candidateCapsObs(rows);
        obs.max_single_seen = fixed10N(caps.maxSingle);
        obs.max_cluster_seen = fixed10N(caps.maxCluster);
        obs.max_tech_seen = fixed10N(caps.maxTech);
        const days = {};
        for (const r of rows) (days[String(r.trade_date)] = days[String(r.trade_date)] || []).push(r);
        const dayObs = {};
        for (const d of Object.keys(days).sort()) {
          const day = days[d].slice().sort(byCodeAscN);
          const weights = {};
          const priority = {};
          let sum = 0;
          let cash = null;
          let defense = 0;
          for (const r of day) {
            priority[r.code] = r.priority;
            if (r.code === 'CASH') { cash = r.target_weight; continue; }
            weights[r.code] = fixed10N(r.target_weight);
            sum += r.target_weight;
            if (r.role === 'HEDGE') defense += r.target_weight;
          }
          dayObs[d] = {
            weights: weights,
            priority: priority,
            weight_sum: fixed10N(sum + (cash === null ? 0 : cash)),
            cash_weight: fixed10N(cash === null ? 0 : cash),
            defense_weight: fixed10N(defense)
          };
        }
        obs.days = dayObs;
      }
      out[c.id] = obs;
    }
    return out;
  }
};


async function main() {
  const results = {
    engine: 'js',
    source: 'cloudfunctions/runGen2ShadowEod/index.js',
    rule_bundle_version: A.PORTFOLIO_CFG ? 'gen2-rule-v2.0' : null,
    config_echo: {
      max_core_count: A.PORTFOLIO_CFG.max_core_count,
      max_core_per_cluster: A.PORTFOLIO_CFG.max_core_per_cluster,
      min_replacement_edge: A.PORTFOLIO_CFG.min_replacement_edge,
      promotion_persistence_days: A.PORTFOLIO_CFG.promotion_persistence_days
    },
    scenarios: {},
    pending: []
  };
  for (const sc of fixture.scenarios) {
    if (sc.status !== 'RUNNABLE') {
      results.pending.push({ id: sc.id, deferred_to: sc.deferred_to, reason: sc.deferred_reason });
      continue;
    }
    const handler = HANDLERS[sc.handler];
    if (!handler) throw new Error(`unknown handler ${sc.handler} for ${sc.id}`);
    results.scenarios[sc.id] = await handler(sc);
  }
  const text = JSON.stringify(results, null, 2);
  if (outPath) fs.writeFileSync(outPath, text);
  else process.stdout.write(text + '\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
