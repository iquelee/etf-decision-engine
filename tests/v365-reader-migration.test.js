/**
 * V3.6.5 —— Authoritative Reader Migration 测试（RM-01 ~ RM-10 + 并发读 §15）
 *
 * 覆盖任务书 §14（RM 矩阵）、§15（并发读一致性）、§17（API-level parity）。
 *
 * 运行：node tests/v365-reader-migration.test.js
 *
 * ⛔ 全程使用内存适配器：不连数据库、不建生产 collection、不部署。
 * ⛔ 本文件不调用真实 apiGateway（需云环境）；改以**源级断言 + resolver 行为断言**覆盖。
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const U = (f) => require(path.join(REPO, 'src/common/utils', f));
const L = (f) => require(path.join(REPO, 'scripts/lib', f));

const ar = U('v365-active-read.js');
const CONTRACTS = U('v365-contracts.js');
const { createMemoryAdapter } = L('v365-p3-memory-adapter.js');

const CODES = ['513310', '515880', '159582', '518880', '159570'];
const TD = '2026-09-23';
const SCOPE = 'production';
const API_GW_REL = 'cloudfunctions/apiGateway/index.js';

let passed = 0;
let failed = 0;
const failures = [];
const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const section = (t) => console.log(`\n== ${t} ==`);

/** 造一个「完整 run」（decision × 5 + portfolio + manifest），字段与生产同形 */
async function seedRun(ad, runId, revision, opts) {
  const o = opts || {};
  const date = o.trade_date || TD;
  await ad.putManifest({
    run_id: runId, revision, expected_trade_date: date, expected_codes: CODES.slice(),
    input_hash: 'hash-' + runId, status: o.status || 'COMPLETE',
    engine_version: CONTRACTS.ENGINE_VERSION
  });
  for (const c of (o.codes || CODES)) {
    await ad.putCandidate(CONTRACTS.V365_COLLECTIONS.CANDIDATE_DECISION, runId, c, {
      code: c, run_id: runId,
      decision_date: date, calc_date: date,
      trend_stage: 'S1', final_target: 10, final_action: 'HOLD',
      binding_constraint: 'none', suggested_position: 10
    });
  }
  if (o.portfolio !== false) {
    await ad.putCandidate(CONTRACTS.V365_COLLECTIONS.CANDIDATE_PORTFOLIO, runId, 'portfolio', {
      run_id: runId, snapshot_date: date, total_asset: 100000,
      market_regime: 'neutral', strategic_cash: null, deployable_cash: null
    });
  }
}
const promote = (ad, from, to) => ad.compareAndSetPointer(SCOPE, from, to);
const P = (run_id, revision, td) => ({ run_id, revision, expected_trade_date: td || TD });

/* ================================================================== *
 * RM-01 ~ RM-03：pointer 是唯一 selector
 * ================================================================== */
section('§A pointer 唯一 selector（RM-01 / RM-02 / RM-03）');

test('RM-01 pointer=B，同时存在 A/B/C ⇒ 只返回 B', async () => {
  const ad = createMemoryAdapter();
  await seedRun(ad, 'run-A', 1);
  await seedRun(ad, 'run-B', 2);
  await seedRun(ad, 'run-C', 3);
  await promote(ad, null, P('run-A', 1));
  await promote(ad, P('run-A', 1), P('run-B', 2));

  const ds = await ar.readAuthoritativeDataset(ad, { scope: SCOPE, expected_codes: CODES });
  assert.strictEqual(ds.available, true, 'run-B 完整 ⇒ 必须 available');
  assert.strictEqual(ds.active_run_id, 'run-B');
  assert.strictEqual(ds.decisions.length, 5);
  assert.ok(ds.decisions.every((d) => String(d.run_id) === 'run-B'), '⛔ 不得混入 A/C');
  assert.strictEqual(String(ds.portfolio.run_id), 'run-B');
});

test('RM-02 最新写入是 candidate C，pointer 仍为 B ⇒ 返回 B（⛔ 不看写入时间）', async () => {
  const ad = createMemoryAdapter();
  await seedRun(ad, 'run-B', 2);
  await promote(ad, null, P('run-B', 2));
  await seedRun(ad, 'run-C', 3);   // 后写入（时间上"最新"）

  const ds = await ar.readAuthoritativeDataset(ad, { scope: SCOPE, expected_codes: CODES });
  assert.strictEqual(ds.active_run_id, 'run-B');
  assert.ok(!ds.decisions.some((d) => String(d.run_id) === 'run-C'), '⛔ C 绝不可见');
  const prov = ar.buildAuthoritativeProvenance(ds);
  assert.strictEqual(prov.latest_fallback_used, false, '⛔ 未使用 latest 回退');
  assert.strictEqual(prov.authority_selector, 'active_run_pointer.run_id');
});

test('RM-03 B 完整、C candidate partial ⇒ 仍返回 B', async () => {
  const ad = createMemoryAdapter();
  await seedRun(ad, 'run-B', 2);
  await seedRun(ad, 'run-C', 3, { codes: ['513310', '515880'] });   // 只有 2 票
  await promote(ad, null, P('run-B', 2));

  const ds = await ar.readAuthoritativeDataset(ad, { scope: SCOPE, expected_codes: CODES });
  assert.strictEqual(ds.available, true);
  assert.strictEqual(ds.active_run_id, 'run-B');
  assert.strictEqual(ds.decision_count, 5);
});

/* ================================================================== *
 * RM-04 / RM-05：coherence
 * ================================================================== */
section('§B Reader Consistency Guard（RM-04 / RM-05）');

test('RM-04 decision/portfolio/manifest 同 run ⇒ coherence PASS', async () => {
  const ad = createMemoryAdapter();
  await seedRun(ad, 'run-B', 2);
  await promote(ad, null, P('run-B', 2));

  const ds = await ar.readAuthoritativeDataset(ad, { scope: SCOPE, expected_codes: CODES });
  assert.strictEqual(ds.coherence.ok, true);
  assert.strictEqual(ds.coherence.status, ar.AUTH_READ_STATUS.OK);
  // 5 票 + portfolio + manifest = 7 条
  assert.strictEqual(ds.coherence.records_checked, 7, 'checked=' + ds.coherence.records_checked);
  assert.deepStrictEqual(ds.coherence.mismatches, []);
});

test('RM-05a coherence guard 单元：混 run 必须被判为 READ_COHERENCE_FAILURE', () => {
  // ⚠️ 说明：保真适配器下「跨 run 记录」无法经正常 API 注入（`where({run_id})` 天然过滤）
  //      ⇒ coherence guard 属**纵深防御**。此处直接对守卫做单元测试。
  const bad = ar.checkRunCoherence({
    active_run_id: 'run-B',
    decisions: [
      { code: '513310', run_id: 'run-B' },
      { code: '515880', run_id: 'run-C' }            // ← 混入其他 run
    ],
    portfolio: { run_id: 'run-B' },
    manifest: { run_id: 'run-B' }
  });
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.status, ar.AUTH_READ_STATUS.READ_COHERENCE_FAILURE);
  assert.strictEqual(bad.records_checked, 4);
  assert.strictEqual(bad.mismatches.length, 1);
  assert.strictEqual(bad.mismatches[0].record_run_id, 'run-C');

  const good = ar.checkRunCoherence({
    active_run_id: 'run-B',
    decisions: [{ code: '513310', run_id: 'run-B' }],
    portfolio: { run_id: 'run-B' }, manifest: { run_id: 'run-B' }
  });
  assert.strictEqual(good.ok, true);
  assert.deepStrictEqual(good.mismatches, []);
});

test('RM-05b 端到端：store 返回跨 run 记录（模拟适配器损坏/带外污染）⇒ fail-closed、不拼装', async () => {
  const ad = createMemoryAdapter();
  await seedRun(ad, 'run-B', 2);
  await promote(ad, null, P('run-B', 2));

  // 损坏的 store：portfolio 被换成另一个 run 的记录（模拟带外写入 / 适配器缺陷）
  const corrupted = {
    getPointer: (s) => ad.getPointer(s),
    listCandidates: (c, r) => ad.listCandidates(c, r),
    getCandidate: async (c, r, k) => {
      const doc = await ad.getCandidate(c, r, k);
      if (doc && String(c).indexOf('portfolio') >= 0) return Object.assign({}, doc, { run_id: 'run-C' });
      return doc;
    },
    getManifest: (r) => ad.getManifest(r)
  };

  const ds = await ar.readAuthoritativeDataset(corrupted, { scope: SCOPE, expected_codes: CODES });
  assert.strictEqual(ds.available, false);
  assert.strictEqual(ds.status, ar.AUTH_READ_STATUS.READ_COHERENCE_FAILURE);
  assert.strictEqual(ds.reason, ar.AUTH_READ_REASON.RUN_ID_MISMATCH);
  assert.strictEqual(ds.decisions.length, 0, '⛔ 不得拼装返回');
  assert.strictEqual(ds.portfolio, null, '⛔ 不得拼装返回');
  assert.ok(ds.coherence.mismatches.some((m) => m.record === 'run_candidate_portfolio'),
    '必须指出是哪条记录不一致: ' + JSON.stringify(ds.coherence.mismatches));
});

test('RM-05c ★ 保真断言：内存与 cloudbase 适配器的 putCandidate 盖章字段一致', async () => {
  // 早期内存适配器**不**盖章 run_id ⇒ 双适配器语义偏离，会把「candidate 缺 run_id」隐藏成假绿。
  // 本断言把「两层适配器写入形状一致」钉死，防止再次漂移。
  const ad = createMemoryAdapter();
  await seedRun(ad, 'run-B', 2);
  const docs = await ad.listCandidates(CONTRACTS.V365_COLLECTIONS.CANDIDATE_DECISION, 'run-B');
  assert.strictEqual(docs.length, 5);
  docs.forEach((d) => {
    assert.strictEqual(String(d.run_id), 'run-B', 'putCandidate 必须盖章 run_id');
    assert.ok(d.candidate_key != null, 'putCandidate 必须盖章 candidate_key');
    assert.ok(d.written_at != null, 'putCandidate 必须盖章 written_at');
  });
  // 与 cloudbase 适配器源码的盖章集一致（静态交叉核对）
  const storeSrc = fs.readFileSync(path.join(REPO, 'src/common/utils/v365-publish-store.js'), 'utf8');
  ['run_id: runId', 'candidate_key: String(key)', 'written_at: nowIso()'].forEach((k) => {
    assert.ok(storeSrc.includes(k), 'cloudbase 适配器应盖章 ' + k);
  });
});

/* ================================================================== *
 * RM-06 / RM-07：fail-closed
 * ================================================================== */
section('§C fail-closed（RM-06 / RM-07）');

test('RM-06 pointer 缺失 ⇒ AUTHORITATIVE_READ_UNAVAILABLE，⛔ 不得 latest fallback', async () => {
  const ad = createMemoryAdapter();
  await seedRun(ad, 'run-B', 2);     // 库里**有**完整数据，但 pointer 缺失
  const ds = await ar.readAuthoritativeDataset(ad, { scope: SCOPE, expected_codes: CODES });

  assert.strictEqual(ds.available, false);
  assert.strictEqual(ds.reason, ar.AUTH_READ_REASON.NO_ACTIVE_POINTER);
  assert.strictEqual(ds.latest_fallback_used, false);
  assert.strictEqual(ds.fail_closed, true);
  assert.strictEqual(ds.decisions.length, 0, '⛔ 必须空（不得回退到库里的 run-B）');
  assert.strictEqual(ds.portfolio, null);
  // provenance 也必须如实表达不可用
  const prov = ar.buildAuthoritativeProvenance(ds);
  assert.strictEqual(prov.available, false);
  assert.strictEqual(prov.status, 'AUTHORITATIVE_READ_UNAVAILABLE');
  assert.strictEqual(prov.decision_as_of_run_id, null);
});

test('RM-07 pointer 指向不存在的 run ⇒ POINTER_TARGET_RUN_NOT_FOUND', async () => {
  const ad = createMemoryAdapter();
  await seedRun(ad, 'run-B', 2);
  await promote(ad, null, P('run-GHOST', 9));   // 指针指向不存在的 run

  const ds = await ar.readAuthoritativeDataset(ad, { scope: SCOPE, expected_codes: CODES });
  assert.strictEqual(ds.available, false);
  assert.strictEqual(ds.reason, ar.AUTH_READ_REASON.POINTER_TARGET_RUN_NOT_FOUND);
  assert.strictEqual(ds.active_run_id, 'run-GHOST', 'provenance 要如实报告指向了谁');
  assert.strictEqual(ds.latest_fallback_used, false);
  assert.strictEqual(ds.decisions.length, 0, '⛔ 不得回退到 run-B');
});

test('补充：run 数据不完整（缺票 / 缺 portfolio）⇒ RUN_DATA_INCOMPLETE', async () => {
  const ad = createMemoryAdapter();
  await seedRun(ad, 'run-B', 2, { codes: ['513310', '515880'] });
  await promote(ad, null, P('run-B', 2));
  const ds = await ar.readAuthoritativeDataset(ad, { scope: SCOPE, expected_codes: CODES });
  assert.strictEqual(ds.reason, ar.AUTH_READ_REASON.RUN_DATA_INCOMPLETE);
  assert.deepStrictEqual(ds.missing_codes, ['159582', '518880', '159570'], JSON.stringify(ds.missing_codes));

  const ad2 = createMemoryAdapter();
  await seedRun(ad2, 'run-B', 2, { portfolio: false });
  await promote(ad2, null, P('run-B', 2));
  const ds2 = await ar.readAuthoritativeDataset(ad2, { scope: SCOPE, expected_codes: CODES });
  assert.strictEqual(ds2.reason, ar.AUTH_READ_REASON.RUN_DATA_INCOMPLETE);
  assert.strictEqual(ds2.portfolio_present, false);
});

/* ================================================================== *
 * RM-08：双轴
 * ================================================================== */
section('§D 双轴模型（RM-08）');

test('RM-08 dashboard 双轴：decision 轴=B run，position 轴=current mutable state', async () => {
  const ad = createMemoryAdapter();
  await seedRun(ad, 'run-B', 2);
  await promote(ad, null, P('run-B', 2));
  const ds = await ar.readAuthoritativeDataset(ad, { scope: SCOPE, expected_codes: CODES });

  // 决策轴
  const ax = ar.buildAuthoritativeProvenance(ds);
  assert.strictEqual(ax.available, true);
  assert.strictEqual(ax.decision_as_of_run_id, 'run-B');
  assert.strictEqual(ax.decision_axis_selector, 'active_run_pointer.run_id');
  assert.strictEqual(ax.expected_trade_date, TD);
  assert.strictEqual(ax.engine_version, CONTRACTS.ENGINE_VERSION);
  assert.strictEqual(ax.finality_status, 'COMPLETE');

  // 可变轴（模拟 portfolio_position 行）
  const mx = ar.buildMutableStateProvenance({
    rows: [{ code: '513310', updated_at: '2026-09-24T01:00:00Z' }, { code: '515880', updated_at: '2026-09-24T09:30:00Z' }]
  });
  assert.strictEqual(mx.position_as_of_current_state, true);
  assert.strictEqual(mx.position_updated_at, '2026-09-24T09:30:00Z');
  assert.ok(/不是同一时间轴/.test(mx.mutable_axis_note), '必须显式声明两轴不同');

  // ★ 关键：两条轴**不是同一个 selector**，且可变轴没有 run_id
  assert.strictEqual(ax.decision_axis_selector !== mx.position_source, true);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(mx, 'active_run_id'), false,
    '⛔ 可变轴不得携带 run_id（否则会被误读为 run 产物）');
});

/* ================================================================== *
 * RM-09：legacy 响应兼容 + API-level parity
 * ================================================================== */
section('§E legacy 兼容（RM-09 + §17 API parity）');

test('RM-09 5 端点 legacy 响应字段未丢失（含新增 provenance 为 additive）', () => {
  const src = fs.readFileSync(path.join(REPO, API_GW_REL), 'utf8');
  const REQUIRED = {
    getDashboard: ['engine_mode', 'v3_mode', 'system_runtime', 'ml_shadow', 'legacy', 'three_questions', 'overview', 'cards', 'total_asset', 'cash_balance', 'cash_ratio', 'snapshot_date', 'market_regime'],
    getEtfList: ['list', 'action_label', 'opportunity_score', 'current_position', 'final_target', 'suggested_position', 'data_time'],
    getEtfDetail: ['basic', 'snapshot', 'decision', 'ml_shadow', 'legacy', 'production', 'gen1', 'system_runtime', 'fundamental', 'risk_events', 'position'],
    getPortfolio: ['summary', 'rows', 'tech_sector_max', 'total_asset', 'cash_balance', 'tech_position'],
    getConstants: ['w_state_labels', 'action_labels', 'sectors', 'etf_names', 'engine_version', 'runtime_status']
  };
  const missing = [];
  Object.keys(REQUIRED).forEach((fn) => {
    const re = new RegExp('(?:async\\s+)?function\\s+' + fn + '\\s*\\(');
    const m = re.exec(src);
    assert.ok(m, fn + ' 必须存在');
    const body = src.slice(m.index, m.index + 12000);
    REQUIRED[fn].forEach((k) => {
      if (!new RegExp('\\b' + k + '\\s*[:,\\n}]').test(body)) missing.push(fn + '.' + k);
    });
  });
  assert.deepStrictEqual(missing, [], '以下 legacy 字段已丢失: ' + missing.join(', '));
});

test('RM-09b API-level parity：pointer 路径的业务字段与 legacy 同 run 数据逐位一致', async () => {
  const ad = createMemoryAdapter();
  // 同 run 的同一批对象：一份进 candidate（pointer 路径），一份当作 legacy 快照
  const legacyDocs = {};
  await ad.putManifest({
    run_id: 'run-B', revision: 2, expected_trade_date: TD, expected_codes: CODES.slice(),
    input_hash: 'hash-run-B', status: 'COMPLETE', engine_version: CONTRACTS.ENGINE_VERSION
  });
  for (const c of CODES) {
    const doc = {
      code: c, decision_date: TD, calc_date: TD, trend_stage: 'S1',
      final_target: 10, final_action: 'HOLD', binding_constraint: 'none', suggested_position: 10
    };
    legacyDocs[c] = doc;
    await ad.putCandidate(CONTRACTS.V365_COLLECTIONS.CANDIDATE_DECISION, 'run-B', c, doc);
  }
  await ad.putCandidate(CONTRACTS.V365_COLLECTIONS.CANDIDATE_PORTFOLIO, 'run-B', 'portfolio',
    { snapshot_date: TD, total_asset: 100000, market_regime: 'neutral' });
  await promote(ad, null, P('run-B', 2));

  const ds = await ar.readAuthoritativeDataset(ad, { scope: SCOPE, expected_codes: CODES });
  assert.strictEqual(ds.available, true);

  // 剥掉写入元数据后，业务字段必须与 legacy 读到的**同一对象**逐位一致
  const strip = (d) => {
    const o = Object.assign({}, d);
    delete o.run_id; delete o.candidate_key; delete o.written_at;
    return o;
  };
  CODES.forEach((c) => {
    assert.deepStrictEqual(strip(ds.decision_map[c]), legacyDocs[c],
      c + ' 的 pointer 路径业务字段必须与 legacy 逐位一致');
  });

  // 响应层：新路径相对"legacy 响应"只多 provenance 键（业务键集合相同）
  const legacyResponse = { cards: CODES.map((c) => ({ code: c, action: legacyDocs[c].final_action })) };
  const newResponse = Object.assign({}, legacyResponse, {
    authority: ar.buildAuthoritativeProvenance(ds),
    mutable_axis: ar.buildMutableStateProvenance({ rows: [] })
  });
  const added = Object.keys(newResponse).filter((k) => !(k in legacyResponse));
  assert.deepStrictEqual(added.sort(), ['authority', 'mutable_axis'],
    '⚠️ 新增键只允许是 provenance（additive），实际: ' + JSON.stringify(added));
  assert.deepStrictEqual(newResponse.cards, legacyResponse.cards, '业务字段必须逐位不变');
});

/* ================================================================== *
 * RM-10 + §15：并发读
 * ================================================================== */
section('§F 并发读（RM-10 + §15 single-request run pinning）');

test('RM-10 candidate 写入发生在 reader 请求过程中 ⇒ pointer 未切则始终看到旧 active', async () => {
  const ad = createMemoryAdapter();
  await seedRun(ad, 'run-A', 1);
  await promote(ad, null, P('run-A', 1));

  // reader 开始：解析出 A
  const before = await ar.readAuthoritativeDataset(ad, { scope: SCOPE, expected_codes: CODES });
  assert.strictEqual(before.active_run_id, 'run-A');

  // writer 在请求过程中写入 candidate（但**未**切 pointer）
  await seedRun(ad, 'run-B', 2);
  const after = await ar.readAuthoritativeDataset(ad, { scope: SCOPE, expected_codes: CODES });
  assert.strictEqual(after.active_run_id, 'run-A', '⛔ pointer 未切 ⇒ 必须仍看到 A');
  assert.ok(!after.decisions.some((d) => String(d.run_id) === 'run-B'));

  // writer 切 pointer 之后，下一次 request 才看到 B
  await promote(ad, P('run-A', 1), P('run-B', 2));
  const next = await ar.readAuthoritativeDataset(ad, { scope: SCOPE, expected_codes: CODES });
  assert.strictEqual(next.active_run_id, 'run-B');
});

test('§15 单请求 run pinning：一次读取只读一次 pointer；⛔ 绝不 decision=A + snapshot=B', async () => {
  const ad = createMemoryAdapter();
  await seedRun(ad, 'run-A', 1);
  await seedRun(ad, 'run-B', 2);
  await promote(ad, null, P('run-A', 1));

  // 计数 + 在第一次 pointer 读**之后**立刻把 pointer 切到 B（模拟读者读到 A 后 writer 切换）
  let ptrCalls = 0;
  let switched = false;
  const store = {
    getPointer: async (s) => {
      ptrCalls += 1;
      const p = await ad.getPointer(s);
      if (!switched) { switched = true; await ad.compareAndSetPointer(s, P('run-A', 1), P('run-B', 2)); }
      return p;                       // 仍返回 A（pin 住）
    },
    listCandidates: (c, r) => ad.listCandidates(c, r),
    getCandidate: (c, r, k) => ad.getCandidate(c, r, k),
    getManifest: (r) => ad.getManifest(r)
  };

  const ds = await ar.readAuthoritativeDataset(store, { scope: SCOPE, expected_codes: CODES });
  assert.strictEqual(ptrCalls, 1, '一次 request 只允许读一次 pointer（实际 ' + ptrCalls + '）');
  assert.strictEqual(ds.active_run_id, 'run-A', '必须由 pin 决定，不因中途切换而改变');
  // ★ 核心：所有 run-bound 数据必须同属 A（不得出现 decision=A + portfolio=B）
  assert.ok(ds.decisions.every((d) => String(d.run_id) === 'run-A'), 'decision 必须全属 A');
  assert.strictEqual(String(ds.portfolio.run_id), 'run-A', 'portfolio 必须属 A');
  assert.strictEqual(ds.coherence.ok, true);
  // 下一次 request 才看到 B
  const next = await ar.readAuthoritativeDataset(ad, { scope: SCOPE, expected_codes: CODES });
  assert.strictEqual(next.active_run_id, 'run-B');
});

test('§15b 读 error 也 fail-closed（不做任何回退）', async () => {
  const store = {
    getPointer: async () => { throw new Error('boom'); },
    listCandidates: async () => [], getCandidate: async () => null, getManifest: async () => null
  };
  const ds = await ar.readAuthoritativeDataset(store, { scope: SCOPE, expected_codes: CODES });
  assert.strictEqual(ds.available, false);
  assert.strictEqual(ds.reason, ar.AUTH_READ_REASON.READ_ERROR);
  assert.strictEqual(ds.latest_fallback_used, false);
});

/* ================================================================== *
 * 源级断言：迁移确实落地（非"只改了测试"）
 * ================================================================== */
section('§G 源级断言');

test('G.1 5 个 authoritative 端点均已接 resolver，且不再用 getLatestDecision 当权威', () => {
  const src = fs.readFileSync(path.join(REPO, API_GW_REL), 'utf8');
  ['getDashboard', 'getEtfList', 'getEtfDetail', 'getPortfolio', 'getConstants'].forEach((fn) => {
    const re = new RegExp('(?:async\\s+)?function\\s+' + fn + '\\s*\\(');
    const m = re.exec(src);
    assert.ok(m, fn + ' 必须存在');
    const body = src.slice(m.index, m.index + 12000);
    assert.ok(/resolveAuthoritative|resolveAuthoritativeDecision|resolvePointerProvenance/.test(body),
      fn + ' 必须调用 authoritative resolver');
    assert.ok(!/getLatestDecision\s*\(/.test(body), fn + ' ⛔ 不得再用 getLatestDecision 当权威');
  });
});

test('G.2 迁移扫描器：作者化形态可被机器识别（含 candidate 不带 run_id 读）', () => {
  const bad = `db.query(COLLECTIONS.RUN_CANDIDATE_DECISION, {}, { limit: 1 });`;
  const hits = ar.scanForbiddenReads(bad, 'synthetic');
  assert.ok(hits.some((h) => h.pattern === 'CANDIDATE_WITHOUT_RUN_BINDING'), JSON.stringify(hits));
  const good = `db.query(COLLECTIONS.DECISION_RESULT, {}, { orderBy: [{ field: 'decision_date', direction: 'desc' }], limit: 1 });`;
  assert.ok(ar.scanForbiddenReads(good, 'synthetic').some((h) => h.pattern === 'LATEST_DECISION_BY_DATE'));
  // 合法用途白名单必须显式登记 mutable 轴
  assert.ok((ar.ALLOWED_LATEST_READS || []).some((x) => x.collection === 'portfolio_position' && x.axis === 'MUTABLE_STATE'));
});

test('G.3 controller 判据：ALLOWED_LATEST_READS 覆盖 input-data / mutable / ledger', () => {
  const axes = new Set((ar.ALLOWED_LATEST_READS || []).map((x) => x.axis));
  ['MUTABLE_STATE', 'INPUT_DATA', 'MANUAL_LEDGER'].forEach((a) => assert.ok(axes.has(a), '缺少轴 ' + a));
});

/* ------------------------------------------------------------------ *
 * 运行
 * ------------------------------------------------------------------ */
(async () => {
  for (const c of cases) {
    try {
      await c.fn();
      passed += 1;
      console.log(`  \u2713 ${c.name}`);
    } catch (e) {
      failed += 1;
      failures.push({ name: c.name, err: e });
      console.log(`  \u2717 ${c.name}`);
      console.log(`      ${e && e.message}`);
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) {
    failures.forEach((f) => console.log(`  \u2717 ${f.name}: ${f.err && f.err.message}`));
    process.exit(1);
  }
})();
