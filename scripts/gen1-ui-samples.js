#!/usr/bin/env node
/**
 * PR-UI-01 验收样例生成器。
 *
 * 用「真实生产库导出数据」（outputs/gen1-ui-contract-samples/real-data-fixture.json）
 * 在本地驱动 dist-functions 里的真实 gateway 处理器（db 层打桩，其余全是真代码），
 * 产出三份 API 契约样例供人工审查三层字段是否串位：
 *
 *   api-dashboard.json           GET /api/dashboard
 *   api-etf-513310.json          GET /api/etf/513310
 *   api-admin-gen1-health.json   GET /api/admin/gen1/health
 *
 * 只读：不触网、不部署、不写库。param_config 中 admin_* 敏感文档已剔除，
 * admin token 用本地伪值注入（仅通过 verifyToken 比对）。
 *
 * 用法：node scripts/gen1-ui-samples.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');

const REPO = path.join(__dirname, '..');
const OUT_DIR = path.join(REPO, 'outputs', 'gen1-ui-contract-samples');
const fixture = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'real-data-fixture.json'), 'utf8'));

const LOCAL_TOKEN = 'local-sample-token';

/* ---------- 内存数据集 ---------- */
const datasets = {
  runtime_status: fixture.runtime_status,
  gen1_health_state: fixture.gen1_health_state,
  etf_basic: fixture.etf_basic,
  portfolio_position: fixture.portfolio_position,
  portfolio_snapshot: fixture.portfolio_snapshot,
  decision_result: fixture.decision_result,
  ml_shadow_signal: fixture.ml_shadow_signal,
  param_config: fixture.param_config.concat([
    { key: 'admin_token', value: { v: LOCAL_TOKEN, exp: Date.now() + 3600e3 }, version: 1 }
  ]),
  trade_log: [],
  risk_events: [],
  indicator_snapshot: [],
  fundamental_state: [],
  fundamental_config: [],
  fundamental_series: [],
  etf_holdings: [],
  intel: [],
  macro: [],
  etf_daily: Object.entries(fixture.etf_daily_latest_dates || {}).map(([code, d]) => ({
    code, trade_date: d, close: 1, source: 'tencent', is_final: true
  }))
};

function matchWhere(row, where) {
  for (const [k, v] of Object.entries(where || {})) {
    if (v == null || typeof v !== 'object') {
      if (row[k] !== v) return false;
    }
    // 操作符对象（$gte/$lte 等）：样例数据集小，放行由调用方再过滤
  }
  return true;
}

async function stubQuery(collection, where = {}, opts = {}) {
  let rows = (datasets[collection] || []).filter((r) => matchWhere(r, where));
  for (const ob of (opts.orderBy || [])) {
    const { field, direction } = ob;
    rows = rows.slice().sort((a, b) => {
      const av = a[field] == null ? '' : a[field];
      const bv = b[field] == null ? '' : b[field];
      return direction === 'desc' ? String(bv).localeCompare(String(av)) : String(av).localeCompare(String(bv));
    });
  }
  if (opts.limit) rows = rows.slice(0, opts.limit);
  return rows;
}

const dbStub = {
  query: stubQuery,
  getEtfList: async () => datasets.etf_basic.filter((e) => e.status === 'enable')
    .sort((a, b) => a.sort_order - b.sort_order),
  getEtf: async (code) => datasets.etf_basic.find((e) => e.code === code) || null,
  getLatestDecision: async (code) =>
    stubQuery('decision_result', { code }, { orderBy: [{ field: 'decision_date', direction: 'desc' }], limit: 1 })
      .then((r) => r[0] || null),
  getLatestSnapshot: async () => null,
  getLatestFundamentalState: async () => null,
  getActiveRiskEvents: async () => [],
  getPosition: async (code) => datasets.portfolio_position.find((p) => p.code === code) || null,
  getParamConfig: async () => {
    const params = {};
    let version = 0;
    for (const r of datasets.param_config) {
      const v = r.value;
      params[r.key] = (v && typeof v === 'object' && v.v !== undefined) ? v.v : v;
      if (typeof r.version === 'number' && r.version > version) version = r.version;
    }
    return { params, version };
  },
  getCommand: () => ({
    and: (...a) => ({ $and: a }),
    gte: (v) => ({ $gte: v }),
    lte: (v) => ({ $lte: v }),
    gt: (v) => ({ $gt: v }),
    lt: (v) => ({ $lt: v }),
    in: (v) => ({ $in: v }),
    eq: (v) => v
  }),
  upsert: async () => { throw new Error('样例脚本为只读，禁止 upsert'); },
  getDb: () => { throw new Error('样例脚本不提供原生 db 句柄'); }
};

const cloudbaseStub = {
  init: () => ({}),
  SYMBOL_CURRENT_ENV: 'local-sample',
  database: () => ({})
};

/* ---------- require 打桩 ---------- */
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === '@cloudbase/node-sdk') return cloudbaseStub;
  if (/(^|[\\/])common[\\/]utils[\\/]db$/.test(request)) return dbStub;
  return origLoad.call(this, request, parent, isMain);
};

/* ---------- 调用真实 gateway 处理器 ---------- */
async function main() {
  // 构建产物必须是最新的（npm run build 后 dist 内含新契约代码）
  const apiGateway = require(path.join(REPO, 'dist-functions', 'apiGateway', 'index.js'));
  const adminGateway = require(path.join(REPO, 'dist-functions', 'adminGateway', 'index.js'));

  const results = {};

  results['api-dashboard.json'] = await apiGateway.main({ httpMethod: 'GET', path: '/api/dashboard' });
  results['api-etf-513310.json'] = await apiGateway.main({ httpMethod: 'GET', path: '/api/etf/513310' });
  results['api-admin-gen1-health.json'] = await adminGateway.main({
    httpMethod: 'GET',
    path: '/api/admin/gen1/health',
    headers: { 'x-admin-token': LOCAL_TOKEN }
  });

  for (const [file, payload] of Object.entries(results)) {
    fs.writeFileSync(path.join(OUT_DIR, file), JSON.stringify(payload, null, 2));
    console.log(`[written] ${path.join('outputs', 'gen1-ui-contract-samples', file)}`);
  }

  /* ---------- 就地自检：三层字段不串位 ---------- */
  const assert = require('assert');
  const dash = results['api-dashboard.json'].data;
  assert.ok(dash.system_runtime && dash.system_runtime.production.engine === 'v3.6.1', 'dashboard.system_runtime.production');
  assert.strictEqual(dash.system_runtime.gen1.authority, 'CANARY', 'authority 来自 runtime_status');
  assert.strictEqual(dash.system_runtime.gen1.production_write, false);
  assert.strictEqual(dash.system_runtime.gen1.auto_execution, false);
  assert.strictEqual(dash.system_runtime.gen2.mode, 'SHADOW');
  assert.ok(Array.isArray(dash.cards) && dash.cards.length === 5, '5 张卡');
  for (const c of dash.cards) {
    assert.ok(c.production && c.gen1, `card ${c.code} 缺 production/gen1`);
    assert.ok(c.ml_shadow, `card ${c.code} 兼容字段 ml_shadow 必须保留`);
    assert.ok(!('advisory' in c.gen1), `card ${c.code} gen1 块不得携带 advisory 主建议语义`);
  }
  const gold = dash.cards.find((c) => c.code === '518880');
  assert.strictEqual(gold.gen1.applicability.domain_permission, 'BLOCK_CANARY', '518880 OOD');
  const detail = results['api-etf-513310.json'].data;
  assert.strictEqual(detail.production.action_code, detail.decision.final_action, 'detail production.action === final_action');
  assert.strictEqual(detail.production.suggested_pct, detail.decision.suggested_position, 'detail production.suggested');
  assert.strictEqual(detail.gen1.authority, 'CANARY');
  assert.ok(detail.system_runtime && detail.system_runtime.gen1.health_status === 'OK');
  const health = results['api-admin-gen1-health.json'].data;
  assert.strictEqual(health.gen1_health_status, 'OK');
  assert.strictEqual(health.gen1_health_gate_status, 'ACTIVE');
  assert.strictEqual(health.gen1_health_source, 'GEN1_HEALTH_STATE_LATCH');
  assert.strictEqual(health.gen1_safety_source, 'SAFETY_CORE');
  assert.strictEqual(health.ledger.gen1_counterfactual_ledger_ok, true);
  assert.strictEqual(health.ledger.gen1_counterfactual_intended_tech_position, 16.2);
  assert.strictEqual(health.canary.production_write, false);
  assert.strictEqual(health.authority.value, 'CANARY');
  console.log('\n[self-check] 三份样例三层字段自检 PASS（production / gen1 / runtime 无串位）');
}

main().catch((e) => { console.error(e); process.exit(1); });
