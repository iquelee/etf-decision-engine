/**
 * V3.6.5 Production Integrity —— P-1 专项测试
 *
 * 覆盖：
 *   §A  CN 交易日历权威源 `resolveExpectedTradeDate`（cutoff / coverage / fail-closed）
 *   §B  RunContext 三日期语义（expected / observed / effective）与 CASE A/B/C 对齐判定
 *   §C  P-1 Failure Tests（V3.6.5 任务书 §七 的 8 项）
 *
 * 运行：node tests/v365-p1-trade-date-authority.test.js
 *
 * ⚠️ 本测试只读：不部署、不写库、不改生产参数。
 * ⚠️ 使用的 calendar 是 **合成 fixture**（tests/fixtures/cn-trading-calendar.fixture.json，
 *    标记 synthetic=true），仅用于验证逻辑；其中的 holidays 不代表真实节假日安排。
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const U = (f) => require(path.join(REPO, 'src/common/utils', f));

const {
  REASON, STATUS,
  isTradingDay, prevTradingDay, nextTradingDay, countTradeDays,
  resolveExpectedTradeDate, loadCalendar, loadRepoCalendar, parseCutoff, beijingParts
} = U('cn-trading-calendar.js');

const {
  buildV361RunContext, validateAgainstExpectedTradeDate, DATE_ALIGNMENT_CASE, HEALTH
} = U('v361-run-context.js');

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

/* ------------------------------------------------------------------ *
 * 夹具
 * ------------------------------------------------------------------ */

const FIXTURE = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures', 'cn-trading-calendar.fixture.json'), 'utf8'
));
const CAL = loadCalendar(FIXTURE);

/** UTC 时刻 → 北京 HH:MM 的 Date 构造器（北京 = UTC+8） */
function bj(dateStr, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const utcMinutes = h * 60 + m - 8 * 60;
  const t = Date.parse(`${dateStr}T00:00:00Z`) + utcMinutes * 60000;
  return new Date(t);
}

const CODES = ['513310', '515880', '159582', '518880', '159570'];
const EXPECTED = '2026-10-08';     // 节后第一交易日
const PREV = '2026-09-30';         // 节前最后交易日

function snapshotsAll(date) {
  const s = {};
  CODES.forEach((c) => { s[c] = { calc_date: date }; });
  return s;
}
function fundamentalsAll(date) {
  const f = {};
  CODES.forEach((c) => { f[c] = { as_of_date: date }; });
  return f;
}
function ctxInput(over) {
  return Object.assign({
    run_id: 'run-p1-test-001',
    expected_codes: CODES,
    snapshots: snapshotsAll(EXPECTED),
    expected_trade_date: EXPECTED,
    market_env_date: EXPECTED,
    global_signals: [{ symbol: 'usNDX', as_of_date: EXPECTED }],
    // 基本面为 optional 源：给新鲜日期，避免把 optional 缺失混进 required 判定
    fundamentals: fundamentalsAll(PREV)
  }, over || {});
}

/* ================================================================== *
 * §A calendar authority
 * ================================================================== */
section('§A CN 交易日历权威源');

test('A.1 fixture 日历自洽：节前/节后交易性正确', () => {
  assert.strictEqual(CAL.valid, true, JSON.stringify(CAL.errors));
  assert.strictEqual(CAL.synthetic, true);
  assert.strictEqual(isTradingDay('2026-09-30', CAL), true, '节前最后交易日应为交易日');
  assert.strictEqual(isTradingDay('2026-10-01', CAL), false, '国庆当天应为非交易日');
  assert.strictEqual(isTradingDay('2026-10-05', CAL), false, '假期内工作日应为非交易日');
  assert.strictEqual(isTradingDay('2026-10-08', CAL), true, '节后第一交易日应为交易日');
  assert.strictEqual(isTradingDay('2026-09-26', CAL), false, '周六非交易日');
});

test('A.2 交易日导航：prev / next 跨过周末与假期', () => {
  assert.strictEqual(prevTradingDay('2026-10-01', CAL), PREV, '从节假日回退到节前最后交易日');
  assert.strictEqual(prevTradingDay('2026-10-08', CAL), PREV, '从节后第一交易日回退到节前最后交易日');
  assert.strictEqual(prevTradingDay('2026-09-28', CAL), '2026-09-25', '从周一回退到周五');
  assert.strictEqual(nextTradingDay('2026-09-30', CAL), EXPECTED, '从节前最后交易日前进到节后第一交易日');
  assert.strictEqual(nextTradingDay('2026-10-08', CAL), '2026-10-09');
});

test('A.3 交易日差 ≠ 自然日差（禁止自然日冒充）', () => {
  // 2026-09-30 → 2026-10-08：自然日 8 天，交易日仅 10-08 一天
  assert.strictEqual(countTradeDays(PREV, EXPECTED, CAL), 1);
  // 2026-09-30 → 2026-10-12：交易日 = 10-08、10-09、10-12 共 3 天，自然日 12 天
  assert.strictEqual(countTradeDays(PREV, '2026-10-12', CAL), 3);
  assert.strictEqual(countTradeDays(EXPECTED, PREV, CAL), -1, '方向相反应为负数');
  assert.strictEqual(countTradeDays(EXPECTED, EXPECTED, CAL), 0);
});

test('A.4 cutoff：默认 16:00，可配置为字符串或分钟数', () => {
  assert.strictEqual(parseCutoff(undefined), 16 * 60);
  assert.strictEqual(parseCutoff('15:00'), 15 * 60);
  assert.strictEqual(parseCutoff('09:30'), 9 * 60 + 30);
  assert.strictEqual(parseCutoff(930), 930);
  assert.strictEqual(parseCutoff('25:00'), null);
  assert.strictEqual(parseCutoff('abc'), null);
});

test('A.5 时间换算：北京时间墙钟（UTC+8），与宿主时区无关', () => {
  const p = beijingParts(new Date('2026-10-08T00:00:00Z'));
  assert.strictEqual(p.date, '2026-10-08');
  assert.strictEqual(p.hhmm, '08:00');
  const q = beijingParts(new Date('2026-10-07T16:30:00Z'));   // 北京 10-08 00:30
  assert.strictEqual(q.date, '2026-10-08');
  assert.strictEqual(q.hhmm, '00:30');
});

test('A.6 special_trading_days 优先于 weekend / holiday 规则', () => {
  const cal = loadCalendar(Object.assign({}, FIXTURE, {
    special_trading_days: ['2026-10-10']    // 周六，显式开市（演示用）
  }));
  assert.strictEqual(cal.valid, true, JSON.stringify(cal.errors));
  assert.strictEqual(isTradingDay('2026-10-10', cal), true, '显式 special 应覆盖周末规则');
});

test('A.7 非法 calendar ⇒ INVALID_CALENDAR（不抛异常）', () => {
  const bad = resolveExpectedTradeDate(new Date('2026-10-08T08:30:00Z'), { artifact_type: 'nope' });
  assert.strictEqual(bad.status, STATUS.BLOCKED);
  assert.strictEqual(bad.resolution_reason, REASON.INVALID_CALENDAR);
  assert.strictEqual(bad.expected_trade_date, null);
  assert.ok(bad.calendar_errors.length > 0);
});

test('A.8 非法 now ⇒ INVALID_NOW（不抛异常、不编造日期）', () => {
  const r = resolveExpectedTradeDate('not-a-date', CAL);
  assert.strictEqual(r.status, STATUS.BLOCKED);
  assert.strictEqual(r.resolution_reason, REASON.INVALID_NOW);
  assert.strictEqual(r.expected_trade_date, null);
});

/* ================================================================== *
 * §B RunContext 三日期
 * ================================================================== */
section('§B RunContext 三日期语义（expected / observed / effective）');

test('B.1 三日期同时出现在 envelope，且语义互不顶替', () => {
  const ctx = buildV361RunContext(ctxInput());
  assert.strictEqual(ctx.expected_trade_date, EXPECTED);
  assert.strictEqual(ctx.observed_latest_date, EXPECTED);
  assert.strictEqual(ctx.effective_as_of_trade_date, EXPECTED);
  // 向后兼容字段保留
  assert.strictEqual(ctx.as_of_trade_date, EXPECTED);
  assert.strictEqual(ctx.date_alignment.case, DATE_ALIGNMENT_CASE.CASE_A_ALL_EXPECTED);
  assert.strictEqual(ctx.date_alignment.blocked, false);
  assert.strictEqual(ctx.input_health.status, HEALTH.OK);
});

test('B.2 未传 expected_trade_date ⇒ 不做对齐判定（保持旧行为，零影响）', () => {
  const inp = ctxInput();
  delete inp.expected_trade_date;
  const ctx = buildV361RunContext(inp);
  assert.strictEqual(ctx.expected_trade_date, null);
  assert.strictEqual(ctx.date_alignment.case, DATE_ALIGNMENT_CASE.CASE_UNKNOWN_NO_EXPECTED);
  assert.strictEqual(ctx.date_alignment.blocked, false);
  assert.strictEqual(ctx.effective_as_of_trade_date, null);
  assert.strictEqual(ctx.input_health.status, HEALTH.OK, '旧调用方行为逐字保持');
});

test('B.3 authority 元数据原样回显（calendar_version / coverage / reason）', () => {
  const authority = {
    calendar_version: 'TEST-FIXTURE-synthetic-2026.10',
    calendar_coverage: { start: '2026-09-01', end: '2026-12-31', seeded: true },
    resolution_reason: REASON.TRADING_DAY_AFTER_CUTOFF,
    status: 'OK'
  };
  const ctx = buildV361RunContext(ctxInput({ expected_trade_date_authority: authority }));
  assert.strictEqual(ctx.expected_trade_date_authority.calendar_version, authority.calendar_version);
  assert.strictEqual(ctx.expected_trade_date_authority.resolution_reason, REASON.TRADING_DAY_AFTER_CUTOFF);
});

test('B.4 validateAgainstExpectedTradeDate 是独立可复核入口', () => {
  const ctx = buildV361RunContext(ctxInput());
  const v = validateAgainstExpectedTradeDate(ctx);
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.case, DATE_ALIGNMENT_CASE.CASE_A_ALL_EXPECTED);
  assert.strictEqual(v.effective_as_of_trade_date, EXPECTED);
  assert.deepStrictEqual(v.offender_codes, []);
});

/* ================================================================== *
 * §C P-1 Failure Tests（任务书 §七 8 项）
 * ================================================================== */
section('§C P-1 Failure Tests（8 项）');

test('C.1【5/5 expected date】→ PASS（可继续）', () => {
  const ctx = buildV361RunContext(ctxInput({ snapshots: snapshotsAll(EXPECTED) }));
  assert.strictEqual(ctx.date_alignment.case, DATE_ALIGNMENT_CASE.CASE_A_ALL_EXPECTED);
  assert.strictEqual(ctx.date_alignment.blocked, false);
  assert.strictEqual(ctx.effective_as_of_trade_date, EXPECTED);
  assert.strictEqual(ctx.input_health.status, HEALTH.OK);
  assert.strictEqual(validateAgainstExpectedTradeDate(ctx).ok, true);
});

test('C.2【4/5 expected + 1 stale】→ BLOCKED', () => {
  const snaps = snapshotsAll(EXPECTED);
  snaps['159570'] = { calc_date: PREV };
  const ctx = buildV361RunContext(ctxInput({ snapshots: snaps }));
  assert.strictEqual(ctx.date_alignment.case, DATE_ALIGNMENT_CASE.CASE_B_PARTIAL_STALE);
  assert.strictEqual(ctx.date_alignment.blocked, true);
  assert.deepStrictEqual(ctx.date_alignment.offender_codes, ['159570']);
  assert.strictEqual(ctx.effective_as_of_trade_date, null);
  assert.strictEqual(ctx.input_health.status, HEALTH.BLOCKED);
  assert.strictEqual(ctx.input_health.reason, 'required_not_at_expected_trade_date');
});

test('C.3【5/5 全体一致 stale 一天】→ BLOCKED（旧 max 方案的盲区）', () => {
  const snaps = snapshotsAll(PREV);            // 全体落后到节前最后交易日
  const ctx = buildV361RunContext(ctxInput({ snapshots: snaps }));

  // 关键对照：纯 cross-sectional 判据（旧逻辑）对此**完全无感**
  assert.strictEqual(ctx.stale_sources.length, 0, 'cross-sectional 判据看不见全体一致过期');
  assert.strictEqual(ctx.observed_latest_date, PREV, '观测值照旧是 T-1');

  // 新对齐判据必须抓住它
  assert.strictEqual(ctx.date_alignment.case, DATE_ALIGNMENT_CASE.CASE_C_ALL_STALE);
  assert.strictEqual(ctx.date_alignment.blocked, true);
  assert.strictEqual(ctx.effective_as_of_trade_date, null);
  assert.strictEqual(ctx.input_health.status, HEALTH.BLOCKED);
  assert.strictEqual(ctx.input_health.reason, 'all_required_stale_against_expected');
});

test('C.4【周六 08:00】→ expected = 最近交易日（周五）', () => {
  const r = resolveExpectedTradeDate(bj('2026-09-26', '08:00'), CAL);
  assert.strictEqual(r.status, STATUS.OK);
  assert.strictEqual(r.resolution_reason, REASON.NON_TRADING_DAY);
  assert.strictEqual(r.expected_trade_date, '2026-09-25', '周六 → 上一个交易日 = 周五');
});

test('C.5【法定节假日】→ expected = 最近正式交易日', () => {
  const r = resolveExpectedTradeDate(bj('2026-10-05', '08:00'), CAL);
  assert.strictEqual(r.status, STATUS.OK);
  assert.strictEqual(r.resolution_reason, REASON.NON_TRADING_DAY);
  assert.strictEqual(r.expected_trade_date, PREV, '假期内工作日 → 节前最后交易日');
});

test('C.6【节后第一交易日 08:00】→ expected = 节前最后交易日', () => {
  const r = resolveExpectedTradeDate(bj('2026-10-08', '08:00'), CAL);
  assert.strictEqual(r.status, STATUS.OK);
  assert.strictEqual(r.resolution_reason, REASON.TRADING_DAY_BEFORE_CUTOFF);
  assert.strictEqual(r.expected_trade_date, PREV, '08:00 尚未完成当日交易 ⇒ 取上一完成交易日');
});

test('C.7【节后第一交易日收盘后】→ expected = 当日', () => {
  const r = resolveExpectedTradeDate(bj('2026-10-08', '16:30'), CAL);
  assert.strictEqual(r.status, STATUS.OK);
  assert.strictEqual(r.resolution_reason, REASON.TRADING_DAY_AFTER_CUTOFF);
  assert.strictEqual(r.expected_trade_date, EXPECTED, '收盘后 ⇒ 当日即应到交易日');

  // 22:00 定时（实际生产链的时刻）同属 after cutoff
  const r22 = resolveExpectedTradeDate(bj('2026-10-08', '22:00'), CAL);
  assert.strictEqual(r22.expected_trade_date, EXPECTED);

  // 边界：恰好 15:00 收盘、但未过默认 16:00 cutoff ⇒ 仍取上一完成交易日
  const r15 = resolveExpectedTradeDate(bj('2026-10-08', '15:00'), CAL);
  assert.strictEqual(r15.resolution_reason, REASON.TRADING_DAY_BEFORE_CUTOFF);
  assert.strictEqual(r15.expected_trade_date, PREV);
});

test('C.8【calendar coverage 缺失】→ BLOCKED（fail-closed，绝不猜）', () => {
  // (a) 仓库生产 artifact 当前是未播种状态 ⇒ 必须 BLOCKED
  const repo = loadRepoCalendar();
  const r = resolveExpectedTradeDate(bj('2026-10-08', '16:30'), repo);
  assert.strictEqual(r.status, STATUS.BLOCKED);
  assert.strictEqual(r.resolution_reason, REASON.CALENDAR_COVERAGE_MISSING);
  assert.strictEqual(r.expected_trade_date, null, '覆盖不足时绝不回退为自然日或工作日猜测');

  // (b) 日期落在 coverage 之外 ⇒ OUT_OF_RANGE
  const out = resolveExpectedTradeDate(bj('2026-08-01', '16:30'), CAL);
  assert.strictEqual(out.status, STATUS.BLOCKED);
  assert.strictEqual(out.resolution_reason, REASON.CALENDAR_COVERAGE_OUT_OF_RANGE);

  // (c) 回溯超出 coverage.start ⇒ EXHAUSTED
  const tiny = loadCalendar(Object.assign({}, FIXTURE, {
    coverage: { start: '2026-10-08', end: '2026-12-31', seeded: true }
  }));
  const ex = resolveExpectedTradeDate(bj('2026-10-08', '08:00'), tiny);
  assert.strictEqual(ex.status, STATUS.BLOCKED);
  assert.strictEqual(ex.resolution_reason, REASON.CALENDAR_COVERAGE_EXHAUSTED);
});

test('C.9 端到端：calendar authority → RunContext 对齐（CASE A/B/C 全链）', () => {
  // (a) 收盘后 22:00 定时：权威日 = 当日；但数据仍停在节前 ⇒ CASE_C BLOCK
  const authEve = resolveExpectedTradeDate(bj('2026-10-08', '22:00'), CAL);
  assert.strictEqual(authEve.expected_trade_date, EXPECTED);
  const ctxC = buildV361RunContext(ctxInput({
    snapshots: snapshotsAll(PREV),
    expected_trade_date: authEve.expected_trade_date,
    expected_trade_date_authority: authEve
  }));
  assert.strictEqual(ctxC.date_alignment.case, DATE_ALIGNMENT_CASE.CASE_C_ALL_STALE);
  assert.strictEqual(ctxC.input_health.status, HEALTH.BLOCKED);
  assert.strictEqual(ctxC.effective_as_of_trade_date, null);

  // (b) 同一交易日 08:00：权威日 = 节前最后交易日；数据也停在节前 ⇒ 对齐成立、可继续
  //     （说明「08:00 拿到 PREV」是正确语义，不是故障）
  const authMorning = resolveExpectedTradeDate(bj('2026-10-08', '08:00'), CAL);
  const ctxOk = buildV361RunContext(ctxInput({
    snapshots: snapshotsAll(PREV),
    expected_trade_date: authMorning.expected_trade_date,
    expected_trade_date_authority: authMorning
  }));
  assert.strictEqual(ctxOk.date_alignment.case, DATE_ALIGNMENT_CASE.CASE_A_ALL_EXPECTED);
  assert.strictEqual(ctxOk.input_health.status, HEALTH.OK);
  assert.strictEqual(ctxOk.effective_as_of_trade_date, PREV);

  // (c) 收盘后 16:30：权威日 = 当日，数据也到了当日 ⇒ CASE_A 通过
  const auth2 = resolveExpectedTradeDate(bj('2026-10-08', '16:30'), CAL);
  const ctxA = buildV361RunContext(ctxInput({
    snapshots: snapshotsAll(EXPECTED),
    expected_trade_date: auth2.expected_trade_date,
    expected_trade_date_authority: auth2
  }));
  assert.strictEqual(ctxA.expected_trade_date_authority.resolution_reason, REASON.TRADING_DAY_AFTER_CUTOFF);
  assert.strictEqual(ctxA.date_alignment.case, DATE_ALIGNMENT_CASE.CASE_A_ALL_EXPECTED);
  assert.strictEqual(ctxA.input_health.status, HEALTH.OK);
});

test('C.10 input_hash 纳入 expected_trade_date（可追溯）', () => {
  const a = buildV361RunContext(ctxInput());
  const b = buildV361RunContext(ctxInput({ expected_trade_date: PREV }));
  assert.notStrictEqual(a.input_hash, b.input_hash, '权威日不同必须改变 input_hash');
  const c = buildV361RunContext(ctxInput());
  assert.strictEqual(a.input_hash, c.input_hash, '同输入必须同 hash');
});

/* ------------------------------------------------------------------ *
 * 汇总
 * ------------------------------------------------------------------ */
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  failures.forEach((f) => console.log(`  \u2717 ${f.name}: ${f.err && f.err.message}`));
  process.exit(1);
}
