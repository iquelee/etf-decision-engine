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

const ROOT = path.resolve(__dirname, '..', '..');
const FN_DIR = path.join(ROOT, 'cloudfunctions', 'runGen2ShadowEod');
const SRC_COMMON = path.join(ROOT, 'src', 'common');
const SOURCE = fs.readFileSync(path.join(FN_DIR, 'index.js'), 'utf8');

const fixturePath = process.argv[2] || path.join(ROOT, 'fixtures', 'gen2', 'golden_scenarios_v1.json');
const outPath = process.argv[3] || null;
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

const AUDIT_EXPORT = '\nexports.audit = { UNIVERSE, PORTFOLIO_CFG, DEFENSE_CFG,'
  + ' marketScore, classifyRegime, selectionMode, promotionAllowed, maxCoreCount,'
  + ' computeReplacementEdge, shouldReplace, applyReplacementGate, assertFinalRoleConstraints };\n';

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
