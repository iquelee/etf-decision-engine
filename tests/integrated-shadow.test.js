'use strict';
/**
 * Integrated Shadow 引擎回归测试（WP7）。
 *
 * 验收（任务书 §22）：
 *  - test_integrated_same_trade_date        三输入源锚定同一交易日
 *  - test_integrated_requires_completed_gen2 无 completed Gen-2 → GEN2_NOT_READY
 *  - test_integrated_rejects_stale_gen1     Gen-1 择时 stale → TRADE_DATE_MISMATCH / GEN1_NOT_READY
 *  - test_integrated_no_production_write    结果 production_write/auto_execution 恒 false
 *  - test_integrated_shadow_explain_chain   每只 Main5 有 explain_chain
 *
 * 用 vm 注入内存 DB，不连接云端。
 * 运行：node tests/integrated-shadow.test.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
require('./helpers/mock-cloudbase'); // mock @cloudbase/node-sdk

const ROOT = path.resolve(__dirname, '..', 'cloudfunctions', 'runIntegratedShadowEod');
const SRC_COMMON = path.resolve(__dirname, '..', 'src', 'common');
const SOURCE = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');

// 内存 DB：query 支持 where 等值过滤 + orderBy + limit；upsert/getParamConfig 记录调用
function load(collectionData, params = {}) {
  const writes = [];
  const db = {
    query: async (collection, where, opts) => {
      let rows = (collectionData[collection] || []).filter((d) =>
        Object.keys(where || {}).every((k) => d[k] === where[k]));
      if (opts && opts.orderBy && opts.orderBy.length) {
        const { field, direction } = opts.orderBy[0];
        rows = rows.slice().sort((a, b) =>
          (direction === 'desc' ? (a[field] < b[field] ? 1 : -1) : (a[field] > b[field] ? 1 : -1)));
      }
      if (opts && opts.limit) rows = rows.slice(0, opts.limit);
      return rows;
    },
    upsert: async (collection, doc, key) => { writes.push({ collection, doc, key }); return { created: true }; },
    getParamConfig: async () => ({ params, version: 1 }),
  };
  const box = {
    exports: {}, console, crypto: require('crypto'),
    require: (p) => {
      if (p === './common/utils/db') return db;
      if (p === 'crypto') return require('crypto');
      if (p === '@cloudbase/node-sdk') return { init: () => ({}), SYMBOL_CURRENT_ENV: 'test' };
      if (p.startsWith('./common/')) return require(path.join(SRC_COMMON, p.replace(/^\.\/common\//, '')));
      return require(path.join(ROOT, p));
    },
  };
  vm.runInNewContext(SOURCE, box);
  return { exports: box.exports, writes, db };
}

let passed = 0;
let failed = 0;
function assert(name, cond, detail) {
  if (cond) { passed += 1; console.log('  PASS', name); }
  else { failed += 1; console.log('  FAIL', name, detail !== undefined ? JSON.stringify(detail).slice(0, 400) : ''); }
}

async function main() {
  // 预置完整对齐的输入源（Main5 全 three-layer + 一个非 Main5 选池行）
  const ANCHOR = '2026-09-05';
  const gen2Run = {
    type: 'gen2_run', run_id: 'g2run', status: 'completed', as_of_trade_date: ANCHOR, run_date: ANCHOR,
    engine_id: 'gen2-rule-v2', bundle_version: 'gen2-rule-v2.0', bundle_sha256: 'abc123', created_at: '2026-09-05T10:00:00.000Z',
  };
  const ranking = [
    { type: 'gen2_ranking', run_id: 'g2run', code: '513310', rank: 1, role: 'CORE', target_weight: 0.25, alpha_score_v2: 90, name: '中韩半导体ETF' },
    { type: 'gen2_ranking', run_id: 'g2run', code: '515880', rank: 2, role: 'CORE', target_weight: 0.25, alpha_score_v2: 88, name: '通信ETF' },
    { type: 'gen2_ranking', run_id: 'g2run', code: '159582', rank: 3, role: 'CORE', target_weight: 0.25, alpha_score_v2: 86, name: '半导体设备ETF' },
    { type: 'gen2_ranking', run_id: 'g2run', code: '518880', rank: 4, role: 'HEDGE', target_weight: 0.15, alpha_score_v2: 50, name: '黄金ETF' },
    { type: 'gen2_ranking', run_id: 'g2run', code: '159570', rank: 10, role: 'RESERVE', target_weight: 0, alpha_score_v2: 40, name: '港股通创新药ETF' },
    { type: 'gen2_ranking', run_id: 'g2run', code: '588000', rank: 5, role: 'CORE', target_weight: 0.25, alpha_score_v2: 80, name: '科创50ETF' },
  ];
  const gen1 = [
    { source_trade_date: ANCHOR, code: '513310', signal_status: 'CANDIDATE', rule_gate: 'PERMIT', ml_probability: 0.72, advisory_effective: true, model_id: 'HVT-A-ET-20260830' },
    { source_trade_date: ANCHOR, code: '515880', signal_status: 'OBSERVED', rule_gate: 'PERMIT', ml_probability: 0.55, advisory_effective: false, model_id: 'HVT-A-ET-20260830' },
    { source_trade_date: ANCHOR, code: '159582', signal_status: 'CANDIDATE', rule_gate: 'PERMIT', ml_probability: 0.70, advisory_effective: true, model_id: 'HVT-A-ET-20260830' },
    { source_trade_date: ANCHOR, code: '518880', signal_status: 'NO_OPPORTUNITY', rule_gate: 'BLOCK', ml_probability: null, advisory_effective: false, model_id: 'HVT-A-ET-20260830' },
    { source_trade_date: ANCHOR, code: '159570', signal_status: 'NO_OPPORTUNITY', rule_gate: 'BLOCK', ml_probability: null, advisory_effective: false, model_id: 'HVT-A-ET-20260830' },
  ];
  const decision = [
    { decision_date: ANCHOR, code: '513310', final_target: 15, final_action: 'HOLD', stage: 'S3' },
    { decision_date: ANCHOR, code: '515880', final_target: 10, final_action: 'HOLD', stage: 'S2' },
    { decision_date: ANCHOR, code: '159582', final_target: 12, final_action: 'HOLD', stage: 'S3' },
    { decision_date: ANCHOR, code: '518880', final_target: 8, final_action: 'HOLD', stage: 'S1' },
    { decision_date: ANCHOR, code: '159570', final_target: 10, final_action: 'HOLD', stage: 'S2' },
  ];

  console.log('== 1. 三输入源锚定同一交易日（READY） ==');
  {
    const data = { gen2_shadow: [gen2Run, ...ranking], ml_shadow_signal: gen1, decision_result: decision };
    const { exports: e } = load(data);
    const inputs = await e._internal.loadInputs({});
    assert('依赖门 READY', inputs.gate === 'READY', inputs);
    assert('锚定日 = gen2 as_of', inputs.anchor === ANCHOR, inputs.anchor);
    assert('三个 anchor 同交易日', inputs.anchors.length === 3 && inputs.anchors.every((a) => a.trade_date === ANCHOR), inputs.anchors);
  }

  console.log('== 2. 无 completed Gen-2 → GEN2_NOT_READY ==');
  {
    const data = { gen2_shadow: [{ type: 'gen2_run', run_id: 'x', status: 'running', created_at: '2026-09-05T10:00:00.000Z' }] };
    const { exports: e } = load(data);
    const inputs = await e._internal.loadInputs({});
    assert('GEN2_NOT_READY', inputs.gate === 'GEN2_NOT_READY', inputs);
  }

  console.log('== 3. Gen-1 择时 stale → 阻断 ==');
  {
    // gen1 只有 2026-09-04，锚定 09-05 → TRADE_DATE_MISMATCH
    const staleGen1 = gen1.map((g) => ({ ...g, source_trade_date: '2026-09-04' }));
    const data = { gen2_shadow: [gen2Run, ...ranking], ml_shadow_signal: staleGen1, decision_result: decision };
    const { exports: e } = load(data);
    const inputs = await e._internal.loadInputs({});
    assert('Gen-1 stale → TRADE_DATE_MISMATCH', inputs.gate === 'TRADE_DATE_MISMATCH', inputs);
  }
  {
    // gen1 完全缺失 → GEN1_NOT_READY
    const data = { gen2_shadow: [gen2Run, ...ranking], ml_shadow_signal: [], decision_result: decision };
    const { exports: e } = load(data);
    const inputs = await e._internal.loadInputs({});
    assert('Gen-1 缺失 → GEN1_NOT_READY', inputs.gate === 'GEN1_NOT_READY', inputs);
  }

  console.log('== 4. V3.6.1 基线 stale → TRADE_DATE_MISMATCH ==');
  {
    const staleDec = decision.map((d) => ({ ...d, decision_date: '2026-09-04' }));
    const data = { gen2_shadow: [gen2Run, ...ranking], ml_shadow_signal: gen1, decision_result: staleDec };
    const { exports: e } = load(data);
    const inputs = await e._internal.loadInputs({});
    assert('V3.6.1 stale → TRADE_DATE_MISMATCH', inputs.gate === 'TRADE_DATE_MISMATCH', inputs);
  }

  console.log('== 5. 四层权限模型：computeIntegrated 纯函数 ==');
  {
    const { exports: e } = load({});
    const gen1ByCode = {}; gen1.forEach((g) => { gen1ByCode[g.code] = g; });
    const decisionByCode = {}; decision.forEach((d) => { decisionByCode[d.code] = d; });
    const caps = { single_etf_max: 30, tech_sector_max: 65 };
    const { rows } = e._internal.computeIntegrated(ranking, gen1ByCode, decisionByCode, caps);

    const byCode = {}; rows.forEach((r) => { byCode[r.code] = r; });

    // CORE + 择时解锁 → +5 ADD
    const c310 = byCode['513310'];
    assert('513310 FULL 集成', c310.integration_scope === 'FULL');
    assert('CORE+解锁 → +5', c310.selection_effect === 5 && c310.timing_effect === 0 && c310.proposed === 20, c310);
    assert('safety_clamped_action=ADD', c310.safety_clamped_action === 'ADD', c310);

    // CORE + 择时未解锁 → 维持 baseline
    const c880 = byCode['515880'];
    assert('CORE+未解锁 → 维持 baseline', c880.timing_blocked === true && c880.proposed === 10, c880);
    assert('未解锁动作 HOLD', c880.safety_clamped_action === 'HOLD', c880);

    // RESERVE → 反事实清仓
    const c570 = byCode['159570'];
    assert('RESERVE → 清仓 EXIT', c570.selection_effect === -10 && c570.clamped === 0 && c570.safety_clamped_action === 'EXIT', c570);

    // HEDGE → 维持 baseline
    const gold = byCode['518880'];
    assert('HEDGE → 维持 baseline', gold.selection_effect === 0 && gold.proposed === 8, gold);

    // 非 Main5 → SELECTION_ONLY，集成字段为 null
    const c000 = byCode['588000'];
    assert('非 Main5 SELECTION_ONLY', c000.integration_scope === 'SELECTION_ONLY' && c000.integrated_proposed_action === null, c000);

    // explain_chain 存在（Main5）
    assert('explain_chain 存在', Array.isArray(c310.explain_chain) && c310.explain_chain.length >= 5, c310.explain_chain);
  }

  console.log('== 6. 单只 cap 与科技聚合 cap ==');
  {
    const { exports: e } = load({});
    // baseline 全部 28，CORE 且解锁 → +5 = 33，超单只 30 → clamp 到 30
    const r = [
      { run_id: 'x', code: '513310', rank: 1, role: 'CORE', target_weight: 0.25, alpha_score_v2: 90 },
    ];
    const gen1ByCode = { '513310': gen1[0] };
    const decisionByCode = { '513310': { final_target: 28, final_action: 'HOLD' } };
    const { rows } = e._internal.computeIntegrated(r, gen1ByCode, decisionByCode, { single_etf_max: 30, tech_sector_max: 65 });
    assert('单只 cap 生效', rows[0].clamped === 30 && rows[0].single_cap_bound === true, rows[0]);
  }

  console.log('== 7. 主流程：production_write 恒 false ==');
  {
    const data = { gen2_shadow: [gen2Run, ...ranking], ml_shadow_signal: gen1, decision_result: decision, runtime_status: [{ key: 'runtime-status', production_engine: 'v3.6.1' }] };
    const { exports: e, writes } = load(data);
    const out = await e.main({});
    assert('main ok', out.ok === true, out);
    assert('输出 production_write=false', out.production_write === false && out.auto_execution === false, out);
    const runDocs = writes.filter((w) => w.collection === 'integrated_shadow_run');
    const resultDocs = writes.filter((w) => w.collection === 'integrated_shadow_result');
    assert('run 文档 production_write=false', runDocs.every((w) => w.doc.production_write === false && w.doc.auto_execution === false));
    assert('result 文档 production_write=false', resultDocs.every((w) => w.doc.production_write === false && w.doc.auto_execution === false));
    assert('result 行数 = ranking 行数', resultDocs.length === ranking.length, resultDocs.length);
    assert('最终 run 状态 completed', runDocs.some((w) => w.doc.status === 'completed'));
  }

  console.log(`\n=== 结果：${passed} 通过 / ${failed} 失败 ===`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
