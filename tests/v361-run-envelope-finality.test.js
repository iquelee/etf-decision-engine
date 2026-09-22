/**
 * V3.6.1 Safety Hardening R1 —— 专项测试（缺陷 #5 / #6）
 *
 * 运行：node tests/v361-run-envelope-finality.test.js
 *
 * 覆盖：
 *   #5  V361RunContext（Run Input Envelope）—— 日期兼容规则写成代码 + 测试
 *   #6  Run Finality 诊断 —— COMPLETE / PARTIAL / FAILED + 两阶段发布方案
 *
 * 注意：本测试**只读**，不部署、不写入任何线上集合。
 */
'use strict';

const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..');
const U = (f) => require(path.join(REPO, 'src/common/utils', f));

const {
  buildV361RunContext,
  validateSameTradeDate,
  daysBetween,
  stableStringify,
  hashInput,
  FRESHNESS_POLICY,
  HEALTH
} = U('v361-run-context.js');

const {
  RUN_STATUS, HEALTH_SEMANTICS, PUBLISH_PHASE,
  classifyRunFinality, isPartialIndistinguishableFromComplete, planTwoStagePublish
} = U('v361-run-finality.js');

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } catch (e) {
    failed += 1;
    failures.push({ name, err: e });
    console.log(`  \u2717 ${name}`);
    console.log(`      ${e && e.message}`);
  }
}
function section(t) { console.log(`\n== ${t} ==`); }

/* =====================================================================
 * #5 V361RunContext
 * ===================================================================*/
section('#5 V361RunContext（Run Input Envelope）');

const AS_OF = '2026-09-18';
const CODES = ['513310', '515880', '159582', '518880', '159570'];

function fullSnapshots(date) {
  const s = {};
  CODES.forEach((c) => { s[c] = { calc_date: date }; });
  return s;
}

function fullFundamentals(date) {
  const f = {};
  CODES.forEach((c) => { f[c] = { as_of_date: date }; });
  return f;
}

function baseInput(over) {
  return Object.assign({
    run_id: 'run-2026-09-18-001',
    expected_codes: CODES,
    snapshots: fullSnapshots(AS_OF),
    market_env_date: AS_OF,
    global_signals: [{ symbol: 'usNDX', as_of_date: '2026-09-17' }],
    fundamentals: fullFundamentals('2026-09-15'),
    config_version: '2026-09-01-gen1-advisory-active'
  }, over || {});
}

test('#5.1 全部输入齐全且同日 → input_health=OK，as_of_trade_date 为最新快照日', () => {
  const ctx = buildV361RunContext(baseInput());
  assert.strictEqual(ctx.as_of_trade_date, AS_OF);
  assert.deepStrictEqual(ctx.expected_codes, CODES);
  assert.strictEqual(ctx.missing_sources.length, 0);
  assert.strictEqual(ctx.stale_sources.length, 0);
  assert.strictEqual(ctx.input_health.status, HEALTH.OK);
  assert.strictEqual(ctx.config_version, '2026-09-01-gen1-advisory-active');
  assert.strictEqual(Object.keys(ctx.snapshot_dates).length, CODES.length);
  assert.strictEqual(ctx.global_signal_dates.usNDX, '2026-09-17');
});

test('#5.2 中国 ETF 快照不同日 → BLOCKED + stale_sources 精确到 code（required 规则）', () => {
  const snaps = fullSnapshots(AS_OF);
  snaps['159570'] = { calc_date: '2026-09-17' };   // 只差一个交易日
  const ctx = buildV361RunContext(baseInput({ snapshots: snaps }));

  assert.strictEqual(ctx.as_of_trade_date, AS_OF, '应到交易日取最新快照日');
  assert.strictEqual(ctx.input_health.status, HEALTH.BLOCKED);
  assert.strictEqual(ctx.input_health.reason, 'required_source_stale');
  const stale = ctx.stale_sources.find((s) => s.code === '159570');
  assert.ok(stale, '必须显式登记 stale 来源');
  assert.strictEqual(stale.source, 'indicator_snapshot');
  assert.strictEqual(stale.policy, 'strict_same_trade_date');
  assert.strictEqual(stale.reason, 'not_as_of_trade_date');
  assert.strictEqual(stale.expected_date, AS_OF);
});

test('#5.3 某只 ETF 完全没有快照 → BLOCKED + missing_sources', () => {
  const snaps = fullSnapshots(AS_OF);
  delete snaps['518880'];
  const ctx = buildV361RunContext(baseInput({ snapshots: snaps }));
  assert.strictEqual(ctx.input_health.status, HEALTH.BLOCKED);
  assert.strictEqual(ctx.input_health.reason, 'required_source_missing');
  const miss = ctx.missing_sources.find((m) => m.code === '518880');
  assert.ok(miss);
  assert.strictEqual(miss.reason, 'no_snapshot');
});

test('#5.4 Global signal / Fundamental 使用各自 freshness policy —— 不要求机械同日', () => {
  // 海外信号滞后 1 天：不 stale（政策上限 3 自然日）
  const ctx = buildV361RunContext(baseInput({
    global_signals: [{ symbol: 'usNDX', as_of_date: '2026-09-17' }]
  }));
  assert.strictEqual(ctx.stale_sources.filter((s) => s.source === 'global_signal').length, 0,
    '海外指数不要求与 A 股同日');

  // 海外信号滞后 17 天：stale（optional）→ DEGRADED 而非 BLOCKED
  const staleGs = buildV361RunContext(baseInput({
    global_signals: [{ symbol: 'usNDX', as_of_date: '2026-09-01' }]
  }));
  assert.strictEqual(staleGs.input_health.status, HEALTH.DEGRADED);
  const gs = staleGs.stale_sources.find((s) => s.source === 'global_signal');
  assert.ok(gs);
  assert.strictEqual(gs.max_staleness_days, 3);
  assert.strictEqual(gs.lag_days, 17);

  // 基本面滞后 365 天：stale（optional，政策上限 120 自然日）
  const staleFd = buildV361RunContext(baseInput({
    fundamentals: fullFundamentals('2025-09-18')
  }));
  assert.strictEqual(staleFd.input_health.status, HEALTH.DEGRADED);
  const fd = staleFd.stale_sources.find((s) => s.source === 'fundamental');
  assert.strictEqual(fd.max_staleness_days, 120);
  assert.strictEqual(fd.lag_days, 365);
});

test('#5.5 market_env 超过交易日后滞后上限 → 计入 stale（optional）', () => {
  const ctx = buildV361RunContext(baseInput({ market_env_date: '2026-08-20' }));
  const me = ctx.stale_sources.find((s) => s.source === 'market_env');
  assert.ok(me, 'market_env 滞后必须显式登记');
  assert.strictEqual(me.max_staleness_trade_days, 5);
  assert.strictEqual(ctx.input_health.status, HEALTH.DEGRADED);
});

test('#5.6 无任何快照 → BLOCKED 且 as_of_trade_date 为 null（不得编造日期）', () => {
  const ctx = buildV361RunContext(baseInput({ snapshots: {} }));
  assert.strictEqual(ctx.as_of_trade_date, null);
  assert.strictEqual(ctx.input_health.status, HEALTH.BLOCKED);
  assert.ok(ctx.missing_sources.some((m) => m.source === 'as_of_trade_date'));
});

test('#5.7 expected_codes 为空 → BLOCKED（reason=no_expected_codes）', () => {
  const ctx = buildV361RunContext(baseInput({ expected_codes: [], snapshots: {} }));
  assert.strictEqual(ctx.input_health.status, HEALTH.BLOCKED);
  assert.strictEqual(ctx.input_health.reason, 'no_expected_codes');
});

test('#5.8 validateSameTradeDate：日期兼容规则落在代码里可被断言', () => {
  const ok = buildV361RunContext(baseInput());
  assert.deepStrictEqual(validateSameTradeDate(ok), {
    ok: true, as_of_trade_date: AS_OF, offenders: []
  });

  const snaps = fullSnapshots(AS_OF);
  snaps['515880'] = { calc_date: '2026-09-16' };
  const bad = buildV361RunContext(baseInput({ snapshots: snaps }));
  const v = validateSameTradeDate(bad);
  assert.strictEqual(v.ok, false);
  assert.deepStrictEqual(v.offenders, [{ code: '515880', date: '2026-09-16', expected_date: AS_OF }]);
});

test('#5.9 input_hash 与键顺序无关、与内容有关（可复核）', () => {
  const a = buildV361RunContext(baseInput());
  // 打乱 snapshots 写入顺序
  const shuffled = {};
  [...CODES].reverse().forEach((c) => { shuffled[c] = { calc_date: AS_OF }; });
  const b = buildV361RunContext(baseInput({ snapshots: shuffled }));
  assert.strictEqual(a.input_hash, b.input_hash, '键顺序不得影响 input_hash');
  assert.strictEqual(a.input_hash.length, 64);

  const c = buildV361RunContext(baseInput({ config_version: 'DIFFERENT' }));
  assert.notStrictEqual(a.input_hash, c.input_hash, '内容变化必须改变 input_hash');

  const d = buildV361RunContext(baseInput({ run_id: 'run-2026-09-18-002' }));
  assert.notStrictEqual(a.input_hash, d.input_hash, 'run_id 参与 hash');

  assert.strictEqual(stableStringify({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.strictEqual(hashInput({ b: 1, a: 2 }), hashInput({ a: 2, b: 1 }));
});

test('#5.10 日期工具：daysBetween 严格解析 YYYY-MM-DD', () => {
  assert.strictEqual(daysBetween('2026-09-17', '2026-09-18'), 1);
  assert.strictEqual(daysBetween('2026-09-18', '2026-09-17'), -1);
  assert.strictEqual(daysBetween('2026/09/18', '2026-09-18'), null);
  assert.strictEqual(daysBetween(null, '2026-09-18'), null);
});

test('#5.11 FRESHNESS_POLICY 是代码内的显式契约（required/optional 分明）', () => {
  assert.strictEqual(FRESHNESS_POLICY.etf_snapshot.mode, 'strict_same_trade_date');
  assert.strictEqual(FRESHNESS_POLICY.etf_snapshot.level, 'required');
  assert.strictEqual(FRESHNESS_POLICY.indicator_snapshot.level, 'required');
  assert.strictEqual(FRESHNESS_POLICY.market_env.max_staleness_trade_days, 5);
  assert.strictEqual(FRESHNESS_POLICY.global_signal.max_staleness_days, 3);
  assert.strictEqual(FRESHNESS_POLICY.fundamental.max_staleness_days, 120);
  assert.strictEqual(FRESHNESS_POLICY.global_signal.level, 'optional');
});

/* =====================================================================
 * #6 Run Finality
 * ===================================================================*/
section('#6 Run Finality（COMPLETE / PARTIAL / FAILED）');

test('#6.1 全部成功 → COMPLETE，字段齐全，可发布', () => {
  const results = {};
  CODES.forEach((c) => { results[c] = { ok: true }; });
  const f = classifyRunFinality({ expected_codes: CODES, results });
  assert.strictEqual(f.status, RUN_STATUS.COMPLETE);
  assert.strictEqual(f.expected_count, 5);
  assert.strictEqual(f.success_count, 5);
  assert.strictEqual(f.failed_count, 0);
  assert.deepStrictEqual(f.failed_codes, []);
  assert.strictEqual(f.health_semantics, 'HEALTHY');
  assert.strictEqual(f.publishable, true);
});

test('#6.2 部分成功 → PARTIAL，且 failed_codes 精确', () => {
  const results = { 513310: { ok: true }, 515880: { ok: true }, 159582: { ok: true } };
  const f = classifyRunFinality({ expected_codes: CODES, results });
  assert.strictEqual(f.status, RUN_STATUS.PARTIAL);
  assert.strictEqual(f.expected_count, 5);
  assert.strictEqual(f.success_count, 3);
  assert.strictEqual(f.failed_count, 2);
  assert.deepStrictEqual(f.failed_codes.sort(), ['159570', '518880'].sort());
  assert.strictEqual(f.publishable, false, 'PARTIAL 不得发布为 active run');
});

test('#6.3 PARTIAL 与 COMPLETE 的健康语义必须不同（缺陷 #6 核心）', () => {
  assert.notStrictEqual(HEALTH_SEMANTICS[RUN_STATUS.COMPLETE], HEALTH_SEMANTICS[RUN_STATUS.PARTIAL]);
  const results = { 513310: { ok: true } };
  const partial = classifyRunFinality({ expected_codes: CODES, results });
  assert.strictEqual(partial.health_semantics, 'DEGRADED');
  assert.strictEqual(isPartialIndistinguishableFromComplete(partial), false);
});

test('#6.4 全失败 / 无应到标的 → FAILED', () => {
  const allFail = classifyRunFinality({
    expected_codes: ['513310', '515880'],
    results: { 513310: { ok: false, error: 'boom' }, 515880: { ok: false } }
  });
  assert.strictEqual(allFail.status, RUN_STATUS.FAILED);
  assert.strictEqual(allFail.success_count, 0);
  assert.strictEqual(allFail.health_semantics, 'UNHEALTHY');
  assert.strictEqual(allFail.reason, 'no_successful_etf');

  const noExpected = classifyRunFinality({ expected_codes: [], results: {} });
  assert.strictEqual(noExpected.status, RUN_STATUS.FAILED);
  assert.strictEqual(noExpected.reason, 'no_expected_codes');
  assert.strictEqual(noExpected.publishable, false);
});

test('#6.5 显式失败与「根本没算」都被计入 failed_count（不得静默漏掉）', () => {
  const f = classifyRunFinality({
    expected_codes: ['A', 'B', 'C'],
    results: { A: { ok: true }, B: { ok: false } }   // C 缺失
  });
  assert.strictEqual(f.status, RUN_STATUS.PARTIAL);
  assert.strictEqual(f.failed_count, 2);
  assert.deepStrictEqual(f.missing_codes, ['C']);
  assert.ok(f.failed_codes.includes('C'));
  assert.ok(f.failed_codes.includes('B'));
});

test('#6.6 两阶段发布：只有 COMPLETE + 校验通过才允许 promote_active', () => {
  const results = {};
  CODES.forEach((c) => { results[c] = { ok: true }; });
  const complete = classifyRunFinality({ expected_codes: CODES, results });
  const partial = classifyRunFinality({ expected_codes: CODES, results: { 513310: { ok: true } } });

  const p1 = planTwoStagePublish({ finality: partial, validation: { passed: true } });
  assert.strictEqual(p1.action, 'hold_candidate');
  assert.strictEqual(p1.reason, 'run_not_complete:PARTIAL');

  const p2 = planTwoStagePublish({ finality: complete, validation: { passed: false, reason: 'set_incomplete' } });
  assert.strictEqual(p2.action, 'hold_candidate');
  assert.strictEqual(p2.reason, 'validation_failed:set_incomplete');

  const p3 = planTwoStagePublish({ finality: complete, validation: { passed: true } });
  assert.strictEqual(p3.action, 'promote_active');
  assert.strictEqual(p3.phase, PUBLISH_PHASE.VALIDATED);
  assert.strictEqual(p3.next_phase, PUBLISH_PHASE.ACTIVE);
});

test('#6.7 两阶段发布的阶段序列可断言（CALCULATING→…→ACTIVE）', () => {
  assert.deepStrictEqual(
    [PUBLISH_PHASE.CALCULATING, PUBLISH_PHASE.CANDIDATE_READY, PUBLISH_PHASE.VALIDATED,
      PUBLISH_PHASE.COMPLETED, PUBLISH_PHASE.ACTIVE],
    ['CALCULATING', 'CANDIDATE_READY', 'VALIDATED', 'COMPLETED', 'ACTIVE']
  );
});

test('#6.8 finality 与 V361RunContext 可组合：input_health=BLOCKED 时不得 COMPLETE', () => {
  const snaps = fullSnapshots(AS_OF);
  snaps['159570'] = { calc_date: '2026-09-17' };
  const ctx = buildV361RunContext(baseInput({ snapshots: snaps }));
  assert.strictEqual(ctx.input_health.status, HEALTH.BLOCKED);

  // 即便 5 只都「算出来了」，输入信封不健康也不应被当作可发布的 COMPLETE run
  const results = {};
  CODES.forEach((c) => { results[c] = { ok: true }; });
  const f = classifyRunFinality({ expected_codes: CODES, results });
  const plan = planTwoStagePublish({
    finality: f,
    validation: { passed: ctx.input_health.status === HEALTH.OK, reason: ctx.input_health.reason }
  });
  assert.strictEqual(plan.action, 'hold_candidate');
  assert.strictEqual(plan.reason, 'validation_failed:required_source_stale');
});

/* =====================================================================
 * 汇总
 * ===================================================================*/
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  failures.forEach((f) => console.log(`  \u2717 ${f.name}: ${f.err && f.err.message}`));
  process.exit(1);
}
