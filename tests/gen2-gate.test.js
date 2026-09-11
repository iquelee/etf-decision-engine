'use strict';
/**
 * Gen-2 runGen2ShadowEod 数据闸门 + 选池状态机回归测试
 *
 * 覆盖报告 P0-1（数据闸门）、P0-5（replacement 破坏 cluster cap）、
 * P0-2（RISK_OFF 不清现任）、NO_CORE 硬退出、F12（半写入不发布 completed）。
 *
 * 用 vm 注入内存 DB，不连接云端、不真实写入。
 * 运行：node tests/gen2-gate.test.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', 'cloudfunctions', 'runGen2ShadowEod');
const SRC_COMMON = path.resolve(__dirname, '..', 'src', 'common');
const SOURCE = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');

function load(data, failRankingAt = 0) {
  const writes = [];
  let rankingCalls = 0;
  const db = {
    query: async (_, where) => (data[where && where.code] || []).slice(),
    upsert: async (collection, doc, where) => {
      if (doc.type === 'gen2_ranking' && ++rankingCalls === failRankingAt) {
        throw new Error('injected ranking write failure');
      }
      writes.push({ collection, doc, where });
    }
  };
  const box = { exports: {}, require: (p) => {
    if (p === 'fs') return require('fs');
    if (p === 'path') return require('path');
    if (p === 'crypto') return require('crypto');
    if (p === './common/utils/db') return db;
    if (p.startsWith('./common/')) return require(path.join(SRC_COMMON, p.replace(/^\.\/common\//, '')));
    return require(path.join(ROOT, p));
  }, Date, console };
  vm.runInNewContext(SOURCE + '\nexports.audit = {UNIVERSE, buildDailyRoles, buildPortfolioCandidates, applyReplacementGate, assertFinalRoleConstraints, finalizeRoles, inspectBarsIntegrity, validatePublishResults};', box);
  return { entry: box.exports, writes };
}

const { entry } = load({});
const UNIVERSE = entry.audit.UNIVERSE;

function bars(code, n = 130) {
  return Array.from({ length: n }, (_, i) => ({
    code,
    trade_date: new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10),
    open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i, volume: 1000000, amount: 200000000
  }));
}

function fullData() {
  return Object.fromEntries([...UNIVERSE.eligible_codes, UNIVERSE.benchmark_code].map((c) => [c, bars(c)]));
}

let passed = 0;
let failed = 0;
function assert(name, cond, detail) {
  if (cond) { passed += 1; console.log('  PASS', name); }
  else { failed += 1; console.log('  FAIL', name, detail ? JSON.stringify(detail) : ''); }
}

async function main() {
  console.log('== P0-1 数据闸门 ==');

  // 反例1：整批数据停在 2020，LIVE 传入 2026-09-07 期望日期 → 必须 STALE_BATCH（原 bug：FULL + 5 正权重）
  {
    const { entry: e, writes } = load(fullData());
    const out = await e.main({ mode: 'LIVE', expected_trade_date: '2026-09-07' });
    const docs = writes.filter((w) => w.doc.type === 'gen2_ranking');
    assert('陈旧批次(LIVE+期望日)阻断', out.ok === false && out.data_gate === 'STALE_BATCH', out);
    assert('陈旧批次不产出正权重', docs.filter((w) => w.doc.target_weight > 0).length === 0);
  }

  // 反例2：benchmark 只有最后 1 行 → 必须阻断（原 bug：FULL + 3 正权重）
  {
    const data = fullData();
    data[UNIVERSE.benchmark_code] = data[UNIVERSE.benchmark_code].slice(-1);
    const { entry: e, writes } = load(data);
    const out = await e.main({ mode: 'REPLAY' });
    assert('benchmark 单行阻断', out.ok === false && out.data_gate === 'BENCHMARK_INSUFFICIENT_HISTORY', out);
  }

  // 反例3：每个候选同一天重复 120 次 → 唯一交易日=1 < 120，必须阻断（原 bug：ranked=3600）
  {
    const data = fullData();
    for (const c of UNIVERSE.eligible_codes) {
      const last = data[c].at(-1);
      data[c] = Array.from({ length: 120 }, () => ({ ...last }));
    }
    const { entry: e, writes } = load(data);
    const out = await e.main({ mode: 'REPLAY' });
    const docs = writes.filter((w) => w.doc.type === 'gen2_ranking');
    assert('重复日期不产生 3600 行', docs.length === 0, { written: out.written });
    assert('重复日期 → DUPLICATE_TRADE_DATE(blocked)',
      out.status === 'blocked' && out.data_gate === 'DUPLICATE_TRADE_DATE', out);
  }

  // WP-G2-03（A2 剩余切片）：字段完整性 / 非 30 资产 / 完整通过 三类新增场景
  {
    const data = fullData();
    const i = data['159915'].length - 1;
    data['159915'][i] = { ...data['159915'][i], close: null };
    const { entry: e } = load(data);
    const out = await e.main({ mode: 'REPLAY' });
    assert('关键字段缺失 → NAN_OR_MISSING_FIELD(blocked)',
      out.status === 'blocked' && out.data_gate === 'NAN_OR_MISSING_FIELD', out);
  }
  {
    const data = fullData();
    data['159915'] = data['159915'].concat([{ ...data['159915'].at(-1) }]);
    const { entry: e } = load(data);
    const out = await e.main({ mode: 'REPLAY' });
    assert('单只重复交易日 → DUPLICATE_TRADE_DATE(blocked)',
      out.status === 'blocked' && out.data_gate === 'DUPLICATE_TRADE_DATE', out);
  }
  {
    // 非 30 资产：1 只候选落后 → 29/30，禁止发布不完整横截面
    const data = fullData();
    data['159570'] = data['159570'].slice(0, data['159570'].length - 30);
    const { entry: e, writes } = load(data);
    const out = await e.main({ mode: 'REPLAY' });
    assert('非 30 资产 → UNIVERSE_INCOMPLETE(blocked)',
      out.status === 'blocked' && out.data_gate === 'UNIVERSE_INCOMPLETE', out);
    assert('非 30 资产不写 ranking', writes.filter((w) => w.doc.type === 'gen2_ranking').length === 0);
  }
  {
    const { entry: e, writes } = load(fullData());
    const out = await e.main({ mode: 'REPLAY' });
    const runs = writes.filter((w) => w.doc.type === 'gen2_run');
    assert('完整横截面 30/30 → completed', out.ok === true && out.status === 'completed' && out.eligible_count === 30, out);
    assert('completed 是唯一可被消费状态（恰一条 completed）',
      runs.filter((w) => w.doc.status === 'completed').length === 1, runs.map((w) => w.doc.status));
  }
  // 发布完整性校验（A3 seam 纯函数）
  {
    const { entry: e } = load({});
    const V = e.audit.validatePublishResults;
    assert('导出 inspectBarsIntegrity / validatePublishResults',
      typeof e.audit.inspectBarsIntegrity === 'function' && typeof V === 'function');
    assert('唯一 code 重复 → PUBLISH_VALIDATION_FAILED',
      V([{ code: 'a', alpha_score_v2: 1 }, { code: 'a', alpha_score_v2: 2 }], 2).data_gate === 'PUBLISH_VALIDATION_FAILED');
    assert('非有限 alpha → PUBLISH_VALIDATION_FAILED',
      V([{ code: 'a', alpha_score_v2: NaN }], 1).data_gate === 'PUBLISH_VALIDATION_FAILED');
    assert('写入 0 行 → PUBLISH_VALIDATION_FAILED',
      V([{ code: 'a', alpha_score_v2: 1 }], 0).data_gate === 'PUBLISH_VALIDATION_FAILED');
    const ok = V([{ code: 'a', alpha_score_v2: 1 }], 1);
    assert('全部通过 → completed / data_gate=null', ok.status === 'completed' && ok.data_gate === null, ok);
  }

  // 已生效项：benchmark 完全缺失 → BENCHMARK_MISSING
  {
    const data = fullData();
    delete data[UNIVERSE.benchmark_code];
    const { entry: e } = load(data);
    const out = await e.main({ mode: 'REPLAY' });
    assert('benchmark 缺失阻断', out.ok === false && out.data_gate === 'BENCHMARK_MISSING', out);
  }

  // 已生效项：全部候选 119 行 → NO_ELIGIBLE_TODAY
  {
    const data = fullData();
    for (const c of UNIVERSE.eligible_codes) data[c] = data[c].slice(-119);
    const { entry: e } = load(data);
    const out = await e.main({ mode: 'REPLAY' });
    assert('候选 119 行阻断', out.ok === false && out.data_gate === 'NO_ELIGIBLE_TODAY', out);
  }

  // WP-G2-03 四态：数据/资格闸门未通过 → blocked（可预期业务结果），且绝不写 completed
  {
    const data = fullData();
    const { entry: e, writes } = load(data);
    await e.main({ mode: 'LIVE', expected_trade_date: '2026-09-07' });
    const runs = writes.filter((w) => w.doc.type === 'gen2_run');
    assert('数据闸门写 blocked 记录', runs.some((w) => w.doc.status === 'blocked'));
    assert('数据闸门不写 failed（blocked 与 failed 不合并）', !runs.some((w) => w.doc.status === 'failed'));
    assert('数据闸门不写 completed', !runs.some((w) => w.doc.status === 'completed'));
    assert('blocked 带 status_reason', runs.some((w) => w.doc.status === 'blocked' && w.doc.status_reason === 'DATA_OR_ELIGIBILITY_GATE'));
  }

  // WP-G2-03（D-001 裁决回归）：任何角色生成路径在返回前都必须无条件执行终局约束检查。
  // 无 cap 降级现任时，software_ai 有 3 个 CORE，统一出口必须收敛到 2。
  {
    const { entry: e } = load(fullData());
    const day = [
      { code: '159770', role: 'CORE', role_before_cap: 'CORE', alpha_score_v2: 20, reason_codes: '' },
      { code: '159819', role: 'CORE', role_before_cap: 'CORE', alpha_score_v2: 10, reason_codes: '' },
      { code: '159852', role: 'CORE', role_before_cap: 'CHALLENGER', alpha_score_v2: 5, reason_codes: '' }
    ];
    const prev = { '159770': 'CORE', '159819': 'CORE' };
    const capped = e.audit.finalizeRoles(day, Object.assign({}, prev));
    const cores = capped.filter((r) => r.role === 'CORE');
    assert('统一出口无条件收敛（3 → 2 个 software_ai CORE）', cores.length === 2, capped);
    assert('降级的是非现任晋升者', capped.find((r) => r.code === '159852').role === 'CHALLENGER', capped);
    assert('现任 CORE 未被降级', capped.find((r) => r.code === '159770').role === 'CORE'
      && capped.find((r) => r.code === '159819').role === 'CORE', capped);

    // 替换门本身只做事务，不再承担终局检查（防止未来新增早退分支绕过约束）
    const day2 = [
      { code: '159770', role: 'CORE', role_before_cap: 'CORE', alpha_score_v2: 20, reason_codes: '' },
      { code: '159819', role: 'CORE', role_before_cap: 'CORE', alpha_score_v2: 10, reason_codes: '' },
      { code: '159852', role: 'CORE', role_before_cap: 'CHALLENGER', alpha_score_v2: 5, reason_codes: '' }
    ];
    e.audit.applyReplacementGate(day2, Object.assign({}, prev));
    assert('替换门不再内含终局断言（职责单一）', day2.filter((r) => r.role === 'CORE').length === 3, day2);
  }

  console.log('== P0-5 replacement 不破坏 cluster cap ==');
  {
    // 构造：科技现任 A=90，科技新人 B=95、C=94，金融新人 D=85。
    // cap 后科技留 B/C（cap=2），A 被降级；replacement 边际不足应恢复 A，
    // 且必须退回同 cluster 晋升者（B 或 C），而非金融 D。最终科技 CORE 必须 ≤2。
    const { entry: e } = load({});
    const codes = ['512480', '159995', '513310', '512800', ...UNIVERSE.eligible_codes.filter((c) => !['512480', '159995', '513310', '512800'].includes(c))];
    const alphas = { 512480: 95, 159995: 94, 513310: 90, 512800: 85 };
    const features = [];
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < codes.length; j++) {
        const c = codes[j];
        features.push({
          trade_date: `2026-09-0${i + 1}`, code: c, rank: j + 1,
          rank_percentile: (codes.length - j) / codes.length,
          alpha_score_v2: c in alphas ? alphas[c] : 40 - j,
          leadership_score: 50, trend_gate: j < 4, market_score: 60, regime: 'RISK_ON',
          trend_score: 80, rs_score: 80
        });
      }
    }
    const roles = e.audit.buildDailyRoles(features);
    const last = roles.filter((r) => r.trade_date === '2026-09-05');
    const techCores = last.filter((r) => r.role === 'CORE' && r.correlation_cluster === 'tech_hardware');
    assert('科技 cluster CORE ≤2', techCores.length <= UNIVERSE.PORTFOLIO_CFG ? techCores.length <= 2 : techCores.length <= 2, { tech_cores: techCores.length });
    const totalCores = last.filter((r) => r.role === 'CORE');
    assert('CORE 总数 ≤ max_core_count', totalCores.length <= 5, { total: totalCores.length });
    // D-004（WP-G2-03 裁决）：被 cap 降级的行必须留下审计码，审计串与最终角色一致。
    // 注意：审计码是 append-only 历史 —— 被替换门撤销（REPLACEMENT_REVOKED）而恢复 CORE 的行
    // 仍保留 CLUSTER_CAP_DEMOTED，必须同时带恢复码，不得出现「无解释的 CORE + 降级码」。
    const demoted = last.filter((r) => (r.reason_codes || '').indexOf('CLUSTER_CAP_DEMOTED') >= 0);
    assert('cap 降级行带 CLUSTER_CAP_DEMOTED 审计码', demoted.length >= 1,
      last.map((r) => `${r.code}:${r.role}:${r.reason_codes}`));
    assert('降级码与角色自洽（非 CORE，或已带 REPLACEMENT_REVOKED 恢复码）',
      demoted.every((r) => r.role !== 'CORE'
        || (r.reason_codes || '').indexOf('REPLACEMENT_REVOKED') >= 0),
      demoted.map((r) => `${r.code}:${r.role}:${r.reason_codes}`));
  }

  console.log('== P0-2 RISK_OFF 不清现任 + NO_CORE 硬退出 ==');
  {
    const { entry: e } = load({});
    // RISK_OFF 下：现任 CORE 应保留（禁止新晋升≠清仓）
    const off = [{
      trade_date: '2026-09-07', code: '513310', rank: 1, rank_percentile: 1, alpha_score_v2: 90,
      leadership_score: 50, trend_gate: true, market_score: 40, regime: 'RISK_OFF', trend_score: 80, rs_score: 80
    }];
    const offRows = e.audit.buildDailyRoles(off);
    assert('RISK_OFF 现任保留 CORE', offRows[0].role === 'CORE', offRows[0]);
    // NO_CORE：trend_gate=false 即使 RISK_ON 也必须退出 CORE
    const noCore = e.audit.buildDailyRoles(off.map((r) => ({ ...r, market_score: 60, regime: 'RISK_ON', trend_gate: false })));
    assert('NO_CORE 硬退出', noCore[0].role !== 'CORE', noCore[0]);
  }

  console.log('== F12 半写入不发布 completed ==');
  {
    const { entry: e, writes } = load(fullData(), 3);
    const out = await e.main({ mode: 'REPLAY' });
    const runs = writes.filter((w) => w.doc.type === 'gen2_run');
    assert('半写入 ok=false', out.ok === false);
    assert('半写入停留 running/failed，无 completed', !runs.some((w) => w.doc.status === 'completed'), runs.map((w) => w.doc.status));
  }

  console.log(`\n=== 结果：${passed} 通过 / ${failed} 失败 ===`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
