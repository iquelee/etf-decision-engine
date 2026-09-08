'use strict';
/**
 * Gen-2 Selection Shadow 消费端回归测试（P1-2 消费闭环 + 工作包5）。
 *
 * 验收（报告 P1-2）：
 *  - 消费者先选同交易日 completed 运行，再按 run_id 读取，禁止按每只 ETF 最新日期拼接
 *  - 半写入（停留 running/failed）的运行不得被消费者选中
 *  - 重跑（同 run_id 多次写）不产生重复
 *
 * 用 vm 注入内存 DB，不连接云端。
 * 运行：node tests/gen2-consumer.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', 'functions', 'adminGateway');
const SOURCE = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');

// 构造内存 DB：仅实现 query/upsert，返回预置数据
function load(collectionData) {
  const db = {
    query: async (collection, where, opts) => {
      let rows = (collectionData[collection] || []).filter((d) => {
        return Object.keys(where || {}).every((k) => d[k] === where[k]);
      });
      if (opts && opts.orderBy && opts.orderBy.length) {
        const { field, direction } = opts.orderBy[0];
        rows = rows.slice().sort((a, b) => (direction === 'desc' ? (a[field] < b[field] ? 1 : -1) : (a[field] > b[field] ? 1 : -1)));
      }
      if (opts && opts.limit) rows = rows.slice(0, opts.limit);
      return rows;
    },
    upsert: async () => {},
    getParamConfig: async () => ({ params: {} }),
    getEtfList: async () => [],
  };
  const box = { exports: {}, require: (p) => {
    if (p === './common/utils/db') return db;
    if (p === 'crypto') return require('crypto');
    if (p === '@cloudbase/node-sdk') return { init: () => ({ database: () => ({ collection: () => ({}) }) }), SYMBOL_CURRENT_ENV: 'test' };
    return require(path.join(ROOT, p));
  }, Date, console, crypto: require('crypto') };
  vm.runInNewContext(SOURCE + '\nexports.audit = { getGen2SelectionShadow };', box);
  return box.exports;
}

let passed = 0;
let failed = 0;
function assert(name, cond, detail) {
  if (cond) { passed += 1; console.log('  PASS', name); }
  else { failed += 1; console.log('  FAIL', name, detail ? JSON.stringify(detail) : ''); }
}

async function main() {
  const now = '2026-09-06T10:30:00.000Z';

  console.log('== 消费端：按 run_id 读取（不按 code 最新拼接） ==');
  {
    // 两个 run：runA(2026-09-04 completed) + runB(2026-09-05 completed)，各有完整横截面
    const data = {
      gen2_shadow: [
        { type: 'gen2_run', run_id: 'runA', status: 'completed', run_date: '2026-09-04', created_at: '2026-09-04T10:00:00.000Z', selection_confidence: 'FULL', ranked_count: 30 },
        { type: 'gen2_run', run_id: 'runB', status: 'completed', run_date: '2026-09-05', created_at: '2026-09-05T10:00:00.000Z', selection_confidence: 'FULL', ranked_count: 30 },
        { type: 'gen2_ranking', run_id: 'runA', code: '513310', rank: 1, role: 'CORE', target_weight: 0.25, alpha_score_v2: 90 },
        { type: 'gen2_ranking', run_id: 'runB', code: '513310', rank: 1, role: 'CORE', target_weight: 0.25, alpha_score_v2: 91 },
      ],
    };
    const e = load(data);
    const out = await e.audit.getGen2SelectionShadow({});
    // 应选最新 completed = runB
    assert('选最新 completed run', out.run.run_id === 'runB', out.run);
    // 只读到 runB 的 ranking，不混入 runA
    assert('只读本 run 的横截面', out.rankings.length === 1 && out.rankings[0].alpha_score_v2 === 91, out.rankings);
  }

  console.log('== 半写入（running/failed）不得被选中 ==');
  {
    const data = {
      gen2_shadow: [
        { type: 'gen2_run', run_id: 'runFail', status: 'failed', run_date: '2026-09-05', created_at: '2026-09-05T11:00:00.000Z' },
        { type: 'gen2_run', run_id: 'runRunning', status: 'running', run_date: '2026-09-05', created_at: '2026-09-05T12:00:00.000Z' },
        { type: 'gen2_run', run_id: 'runOK', status: 'completed', run_date: '2026-09-05', created_at: '2026-09-05T10:00:00.000Z', selection_confidence: 'DEGRADED' },
        { type: 'gen2_ranking', run_id: 'runOK', code: '518880', rank: 1, role: 'HEDGE', target_weight: 0.15, alpha_score_v2: 50 },
      ],
    };
    const e = load(data);
    const out = await e.audit.getGen2SelectionShadow({});
    assert('跳过 failed/running，选 completed', out.run.run_id === 'runOK', out.run);
    assert('completed 状态正确', out.selection.status === 'completed');
  }

  console.log('== 指定日期读取 ==');
  {
    const data = {
      gen2_shadow: [
        { type: 'gen2_run', run_id: 'r0904', status: 'completed', run_date: '2026-09-04', created_at: '2026-09-04T10:00:00.000Z', selection_confidence: 'FULL' },
        { type: 'gen2_run', run_id: 'r0905', status: 'completed', run_date: '2026-09-05', created_at: '2026-09-05T10:00:00.000Z', selection_confidence: 'LIMITED' },
        { type: 'gen2_ranking', run_id: 'r0904', code: '513310', rank: 1, role: 'CORE', target_weight: 0.2 },
      ],
    };
    const e = load(data);
    const out = await e.audit.getGen2SelectionShadow({ date: '2026-09-04' });
    assert('按指定日期读取', out.run.run_id === 'r0904', out.run);
  }

  console.log('== 无 completed 运行时不报错 ==');
  {
    const e = load({ gen2_shadow: [{ type: 'gen2_run', run_id: 'x', status: 'running', created_at: now }] });
    const out = await e.audit.getGen2SelectionShadow({});
    assert('无 completed 返回空', out.run === null && out.rankings.length === 0, out);
  }

  console.log(`\n=== 结果：${passed} 通过 / ${failed} 失败 ===`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
