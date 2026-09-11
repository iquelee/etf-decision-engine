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

const AUDIT_EXPORT = '\nexports.audit = { UNIVERSE, PORTFOLIO_CFG, DEFENSE_CFG,'
  + ' marketScore, classifyRegime, selectionMode, promotionAllowed, maxCoreCount,'
  + ' computeLeadershipScore, rankFeatures, initialRoles, buildDailyRoles,'
  + ' computeReplacementEdge, shouldReplace, applyReplacementGate, assertFinalRoleConstraints, finalizeRoles };\n';

function loadAudit() {
  const box = {
    exports: {},
    require: (p) => {
      if (p === 'fs') return require('fs');
      if (p === 'path') return require('path');
      if (p === 'crypto') return require('crypto');
      if (p === './common/utils/db') return { query: async () => [], upsert: async () => {} };
      if (p.startsWith('./common/')) return require(path.join(SRC_COMMON, p.replace(/^\.\/common\//, '')));
      return require(path.join(FN_DIR, p));
    },
    Date,
    console
  };
  vm.runInNewContext(SOURCE + AUDIT_EXPORT, box);
  return box.exports.audit;
}

const A = loadAudit();
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
        breakout_distance: R4(0.03 - 0.003 * (k - 1)),
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
  }
};

function main() {
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
    results.scenarios[sc.id] = handler(sc);
  }
  const text = JSON.stringify(results, null, 2);
  if (outPath) fs.writeFileSync(outPath, text);
  else process.stdout.write(text + '\n');
}

main();
