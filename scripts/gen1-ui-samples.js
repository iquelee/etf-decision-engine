#!/usr/bin/env node
/**
 * PR-UI-01 验收样例生成器。
 *
 * 用「真实生产库导出数据」（outputs/gen1-ui-contract-samples/real-data-fixture.json）
 * 在本地驱动 dist-functions 里的真实 gateway 处理器（db 层打桩，其余全是真代码），
 * 产出四份 API 契约样例供人工审查三层字段是否串位：
 *
 *   api-dashboard.json           GET /api/dashboard
 *   api-etf-513310.json          GET /api/etf/513310
 *   api-review.json              GET /api/review?from=&to=
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
  // review-fix：复盘页需要「生产决策 | Gen-1 反事实 | 实际操作」三段直出，补第四份样例
  results['api-review.json'] = await apiGateway.main({
    httpMethod: 'GET',
    path: '/api/review',
    queryStringParameters: { from: '2026-09-01', to: '2026-09-10' }
  });
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
  assert.strictEqual(detail.legacy.deprecated, true, 'detail 必须下发 legacy.deprecated');
  assert.strictEqual(detail.legacy.do_not_use_for_authority, true, 'detail 必须下发 legacy.do_not_use_for_authority');

  /* review-fix P0：stage 三拆必须用真实反例守住（513310 当日 signal=S0 / baseline=effective=S1） */
  assert.strictEqual(detail.gen1.stages.signal, 'S0', 'stages.signal = ml_shadow_signal.stage = S0');
  assert.strictEqual(detail.gen1.stages.baseline, 'S1', 'stages.baseline = v361_baseline_stage = S1');
  assert.strictEqual(detail.gen1.stages.effective, 'S1', 'stages.effective = gen1_effective_stage = S1');
  assert.strictEqual(detail.gen1.signal.stage, detail.gen1.stages.signal, '兼容字段 signal.stage === stages.signal');
  assert.notStrictEqual(detail.gen1.signal.stage, detail.gen1.stages.effective,
    'signal.stage 不得冒充 effective stage');
  assert.strictEqual(detail.gen1.safety.evaluated_stage, 'S0', 'Safety 实际评估阶段 = S0（与其文案一致）');
  assert.strictEqual(detail.gen1.safety.stage_source, 'EOD_STAGE_PRECHECK', 'Safety stage 来源可追溯');

  /* review-fix P1-1：canary 权限链三真值 */
  const c1 = dash.system_runtime.gen1;
  assert.strictEqual(typeof c1.counterfactual_authorized, 'boolean', 'system_runtime.gen1 必须含 counterfactual_authorized');
  assert.strictEqual(typeof c1.counterfactual_health_allowed, 'boolean', 'system_runtime.gen1 必须含 counterfactual_health_allowed');
  assert.strictEqual(c1.counterfactual_authorized, true);
  assert.strictEqual(c1.counterfactual_health_allowed, true);
  assert.strictEqual(c1.counterfactual_active, true);
  assert.strictEqual(c1.counterfactual_inactive_reason, null, '已激活时归因必须为 null');

  /* review-fix P1-2：dashboard legacy 声明 */
  assert.strictEqual(dash.legacy.deprecated, true);
  assert.strictEqual(dash.legacy.do_not_use_for_authority, true);
  assert.ok(dash.legacy.fields.indexOf('ml_shadow.fast_path_enabled') >= 0);

  /* 第四份：review 行必须能直出「生产 | 反事实 | 实操」 */
  const reviewPayload = results['api-review.json'];
  assert.ok(reviewPayload && reviewPayload.data && Array.isArray(reviewPayload.data.decisions),
    'api-review 必须返回 decisions 数组');
  const rv = reviewPayload.data.decisions.find((x) => x.code === '513310' && x.decision_date === '2026-09-10')
    || reviewPayload.data.decisions[0];
  assert.ok(rv, 'review 至少需一条 decision');
  assert.ok(rv.production, 'review 行必须含 production 块');
  assert.strictEqual(rv.production.action, rv.final_action, 'review production.action === final_action');
  assert.strictEqual(rv.production.suggested, rv.suggested_position, 'review production.suggested === suggested_position');
  assert.strictEqual(rv.production.engine, 'v3.6.1', 'review 生产引擎恒 V3.6.1');
  assert.ok(rv.gen1, 'review 行必须含 gen1 块');
  assert.ok(rv.gen1.counterfactual && 'suggested_pct' in rv.gen1.counterfactual, 'gen1.counterfactual.suggested_pct 必须存在');
  assert.ok('delta_pct' in rv.gen1.counterfactual, 'gen1.counterfactual.delta_pct 必须存在');
  assert.ok(rv.gen1.status, 'gen1.status 必须存在');
  assert.strictEqual(rv.gen1.stages.signal, null, 'Review 无信号联表，stages.signal 显式 null');

  const health = results['api-admin-gen1-health.json'].data;
  assert.strictEqual(health.gen1_health_status, 'OK');
  assert.strictEqual(health.gen1_health_gate_status, 'ACTIVE');
  assert.strictEqual(health.gen1_health_source, 'GEN1_HEALTH_STATE_LATCH');
  assert.strictEqual(health.gen1_safety_source, 'SAFETY_CORE');
  assert.strictEqual(health.ledger.gen1_counterfactual_ledger_ok, true);
  assert.strictEqual(health.ledger.gen1_counterfactual_intended_tech_position, 16.2);
  assert.strictEqual(health.authority.value, 'CANARY');
  /* review-fix P1-1：canary 新形状 */
  assert.strictEqual(health.canary.authorized, true);
  assert.strictEqual(health.canary.health_allowed, true);
  assert.strictEqual(health.canary.active, true);
  assert.strictEqual(health.canary.inactive_reason, null);
  assert.strictEqual(health.canary.invocations, 0);
  assert.strictEqual(health.canary.production_write, false);
  assert.strictEqual(health.canary.production_fast_path_enabled, false);
  assert.strictEqual(health.canary.auto_execution, false);
  /* review-fix P1-2：admin legacy 声明 */
  assert.strictEqual(health.legacy.deprecated, true);
  assert.strictEqual(health.legacy.do_not_use_for_authority, true);
  /* review-fix P0：admin 行三种 stage 分列（513310：S0 / S1 / S1） */
  const row513 = health.rows.find((r) => r.code === '513310');
  assert.ok(row513, 'admin rows 必须含 513310');
  assert.strictEqual(row513.stage_signal, 'S0');
  assert.strictEqual(row513.stage_baseline, 'S1');
  assert.strictEqual(row513.stage_effective, 'S1');
  assert.strictEqual(row513.stage, row513.stage_signal, '兼容字段 stage === stage_signal');
  assert.strictEqual(row513.safety_evaluated_stage, 'S0');
  assert.strictEqual(row513.safety_stage_source, 'EOD_STAGE_PRECHECK');

  console.log('\n[self-check] 四份样例自检 PASS（三层 runtime / production / gen1 无串位，stage 三拆与 legacy 声明到位）');
}

main().catch((e) => { console.error(e); process.exit(1); });
