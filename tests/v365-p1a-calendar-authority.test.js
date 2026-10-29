/**
 * V3.6.5 P-1A —— Trading Calendar Authority Seal 专项测试
 *
 * 覆盖任务书 §3（2026 特别测试 + 保留既有回归）/ §4（到期与越界 fail-closed）/ §5（Gate 依据）
 *
 * 运行：node tests/v365-p1a-calendar-authority.test.js
 *
 * ⚠️ 只读：不联网、不部署、不写库。
 * ⚠️ 本测试使用**已播种**的官方 artifact（SSE 上证公告〔2025〕45号 + SZSE 深证会〔2025〕481号）。
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const U = (f) => require(path.join(REPO, 'src/common/utils', f));

const {
  REASON, STATUS, FAIL_CLOSED_CODE,
  isTradingDay, prevTradingDay, nextTradingDay,
  resolveExpectedTradeDate, loadCalendar, loadRepoCalendar,
  calendarExpiryStatus, calendarArtifactSha256,
  V1_CALENDAR_PATH, V1_MANIFEST_PATH
} = U('cn-trading-calendar.js');

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

/** UTC 时刻 → 北京 HH:MM */
function bj(dateStr, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const utcMinutes = h * 60 + m - 8 * 60;
  return new Date(Date.parse(`${dateStr}T00:00:00Z`) + utcMinutes * 60000);
}

const CAL = loadRepoCalendar();
const ARTIFACT = JSON.parse(fs.readFileSync(V1_CALENDAR_PATH, 'utf8'));
const MANIFEST = JSON.parse(fs.readFileSync(V1_MANIFEST_PATH, 'utf8'));
const SOURCE = JSON.parse(fs.readFileSync(
  path.join(REPO, 'src', 'common', 'data', 'sources', 'cn-trading-calendar.source.v1.json'), 'utf8'));

/* ================================================================== *
 * §A Authority / artifact 元数据
 * ================================================================== */
section('§A Authority 与 artifact 元数据');

test('A.1 CALENDAR_SEEDED = true / CALENDAR_SYNTHETIC = false', () => {
  assert.strictEqual(CAL.valid, true, JSON.stringify(CAL.errors));
  assert.strictEqual(CAL.coverage.seeded, true, 'coverage.seeded 必须为 true');
  assert.strictEqual(ARTIFACT.coverage.seeded, true);
  assert.strictEqual(CAL.synthetic, false, 'synthetic 必须为 false（不得用合成日历当权威）');
  assert.strictEqual(ARTIFACT.synthetic, false);
  assert.strictEqual(CAL.market, 'CN_A_SHARE');
});

test('A.2 OFFICIAL_SOURCE_TRACEABLE：公告标识 / 日期 / 来源机构可追溯', () => {
  const p = CAL.provenance;
  assert.deepStrictEqual(p.source_authorities, ['SSE', 'SZSE']);
  assert.ok(p.source_notice_identifiers.includes('上证公告〔2025〕45号'), '必须记录上交所公告号');
  assert.ok(p.source_notice_identifiers.includes('深证会〔2025〕481号'), '必须记录深交所公告号');
  assert.ok(p.source_notice_dates.includes('2025-12-22'), '必须记录公告日期');
  // 注意：上交所域名是 sse.com.cn，深交所域名是 szse.cn（不是 szse.com.cn）
  assert.ok(p.source_notice_urls.every((u) => /^https?:\/\/(www\.)?(sse\.com\.cn|szse\.cn)\//.test(u)),
    `来源 URL 必须来自 sse.com.cn / szse.cn，实际: ${JSON.stringify(p.source_notice_urls)}`);
  assert.strictEqual(p.generation_method,
    'expand_official_closure_ranges -> derive_weekday_closures -> cross_check_exchanges');
  assert.strictEqual(p.source_file, 'src/common/data/sources/cn-trading-calendar.source.v1.json');
  assert.strictEqual(p.source_file_sha256.length, 64, '必须记录来源文件 SHA');
});

test('A.3 coverage 与到期预警参数已固化', () => {
  assert.strictEqual(CAL.coverage.start, '2026-01-01');
  assert.strictEqual(CAL.coverage.end, '2026-12-31');
  assert.strictEqual(CAL.calendar_expiry_warning_days, 30);
  assert.strictEqual(MANIFEST.calendar_version, 'cn-a-share-2026.1');
  assert.strictEqual(MANIFEST.market, 'CN_A_SHARE');
  assert.strictEqual(MANIFEST.coverage_start, '2026-01-01');
  assert.strictEqual(MANIFEST.coverage_end, '2026-12-31');
  assert.strictEqual(MANIFEST.seeded, true);
  assert.strictEqual(MANIFEST.synthetic, false);
});

test('A.4 ARTIFACT_SHA_STABLE：manifest 记录值 == 实测文件 SHA', () => {
  const actual = calendarArtifactSha256(V1_CALENDAR_PATH);
  assert.strictEqual(actual, MANIFEST.artifact_sha256, 'manifest 的 artifact_sha256 必须等于实测值');
  assert.strictEqual(MANIFEST.artifact_sha256.length, 64);
  assert.strictEqual(MANIFEST.artifact, 'src/common/data/cn-trading-calendar.v1.json');
});

test('A.5 artifact 无生成时间戳等非确定性字段', () => {
  const blob = JSON.stringify(ARTIFACT);
  ['generated_at', 'generatedAt', 'timestamp', 'now'].forEach((k) => {
    assert.ok(!blob.includes(`"${k}"`), `artifact 不得含非确定性字段 ${k}`);
  });
});

test('A.6 SSE_SZSE_CONSISTENCY = PASS（独立展开两所区间后逐一比对）', () => {
  function expandWeekdayClosures(auth) {
    const out = new Set();
    auth.closures.forEach((c) => {
      let cur = c.start;
      let guard = 0;
      while (cur <= c.end && guard++ < 400) {
        const w = new Date(`${cur}T00:00:00Z`).getUTCDay();
        if (w !== 0 && w !== 6) out.add(cur);
        const t = Date.parse(`${cur}T00:00:00Z`) + 86400000;
        cur = new Date(t).toISOString().slice(0, 10);
      }
    });
    return Array.from(out).sort();
  }
  const authorities = SOURCE.authorities;
  assert.strictEqual(authorities.length, 2, '来源必须包含 SSE 与 SZSE 两个 authority');
  const expanded = authorities.map((x) => ({ exchange: x.exchange, days: expandWeekdayClosures(x) }));
  assert.deepStrictEqual(expanded[0].days, expanded[1].days,
    'SSE 与 SZSE 的工作日休市集合必须完全一致（不一致应 CALENDAR_CONFLICT/BLOCKED）');

  // 且与 artifact.holidays 完全一致（独立展开 vs 生成器产物）
  assert.deepStrictEqual(expanded[0].days, CAL.holidays,
    '独立展开结果必须等于 artifact.holidays（生成器未增删）');
});

test('A.7 每个官方休市区间的复市日都是交易日', () => {
  SOURCE.authorities.forEach((auth) => {
    auth.closures.forEach((c) => {
      assert.strictEqual(isTradingDay(c.resume, CAL), true,
        `${auth.exchange} ${c.holiday} 复市日 ${c.resume} 必须开市`);
      assert.strictEqual(isTradingDay(c.start, CAL), false,
        `${auth.exchange} ${c.holiday} 起始日 ${c.start} 必须休市`);
    });
  });
});

/* ================================================================== *
 * §B 2026 特别测试（任务书 §3）
 * ================================================================== */
section('§B 2026 特别测试');

test('B.1 2026-09-23 = OPEN / 2026-09-24 = OPEN', () => {
  assert.strictEqual(isTradingDay('2026-09-23', CAL), true, '09-23（周三）应开市');
  assert.strictEqual(isTradingDay('2026-09-24', CAL), true, '09-24（周四）应开市');
});

test('B.2 中秋节：09-25 / 09-26 / 09-27 = CLOSED，09-28 = OPEN', () => {
  assert.strictEqual(isTradingDay('2026-09-25', CAL), false, '09-25（周五）中秋休市');
  assert.strictEqual(isTradingDay('2026-09-26', CAL), false, '09-26（周六）周末');
  assert.strictEqual(isTradingDay('2026-09-27', CAL), false, '09-27（周日）周末');
  assert.strictEqual(isTradingDay('2026-09-28', CAL), true, '09-28（周一）应复市');
});

test('B.3 国庆节：10-01 ~ 10-07 逐日 CLOSED', () => {
  ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
    '2026-10-05', '2026-10-06', '2026-10-07'].forEach((d) => {
    assert.strictEqual(isTradingDay(d, CAL), false, `${d} 必须休市`);
  });
});

test('B.4 10-08 = OPEN / 10-10 = CLOSED', () => {
  assert.strictEqual(isTradingDay('2026-10-08', CAL), true, '10-08（周四）应复市');
  assert.strictEqual(isTradingDay('2026-10-10', CAL), false, '10-10（周六）公告点名的周末休市');
});

test('B.5 holidays 全部不是周末（工作日休市与周末休市不混放）', () => {
  CAL.holidays.forEach((d) => {
    const w = new Date(`${d}T00:00:00Z`).getUTCDay();
    assert.ok(w !== 0 && w !== 6, `${d} 是周末，不应出现在 holidays（应属 weekend_closures）`);
  });
  CAL.weekend_closures.forEach((d) => {
    const w = new Date(`${d}T00:00:00Z`).getUTCDay();
    assert.ok(w === 0 || w === 6, `${d} 不是周末，不应出现在 weekend_closures`);
  });
  assert.strictEqual(CAL.special_trading_days.length, 0, '2026 官方安排中无「周末调休开市」');
});

test('B.6 全年逐日自检：holidays 与 weekdays 互补且无重复', () => {
  const dup = CAL.holidays.filter((d) => CAL.weekend_closures.includes(d));
  assert.deepStrictEqual(dup, [], 'holidays 与 weekend_closures 不得重叠');
  // coverage 内的工作日 = holidays ∪ 交易日
  let cur = CAL.coverage.start;
  let workdays = 0;
  let holidays = 0;
  let guard = 0;
  while (cur <= CAL.coverage.end && guard++ < 400) {
    const w = new Date(`${cur}T00:00:00Z`).getUTCDay();
    if (w !== 0 && w !== 6) {
      workdays += 1;
      if (CAL.holidays.includes(cur)) holidays += 1;
    }
    cur = new Date(Date.parse(`${cur}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  }
  assert.strictEqual(workdays, 261, '2026 年工作日总数应为 261（1/1~12/31）');
  assert.strictEqual(holidays, 19, '工作日休市应为 19 天');
});

/* ================================================================== *
 * §C 既有回归（任务书 §3 要求保留）
 * ================================================================== */
section('§C 既有回归（保留）');

test('C.1 周六 / 周日为交易日之外', () => {
  assert.strictEqual(isTradingDay('2026-09-26', CAL), false);
  assert.strictEqual(isTradingDay('2026-09-27', CAL), false);
  assert.strictEqual(isTradingDay('2026-11-07', CAL), false, '普通周六');
  assert.strictEqual(isTradingDay('2026-11-08', CAL), false, '普通周日');
});

test('C.2 节后第一日 08:00 → 上一完成交易日（09-30）', () => {
  const r = resolveExpectedTradeDate(bj('2026-10-08', '08:00'), CAL);
  assert.strictEqual(r.status, STATUS.OK);
  assert.strictEqual(r.resolution_reason, REASON.TRADING_DAY_BEFORE_CUTOFF);
  assert.strictEqual(r.expected_trade_date, '2026-09-30');
  assert.strictEqual(prevTradingDay('2026-10-08', CAL), '2026-09-30');
});

test('C.3 节后第一日收盘后 → 当日（10-08）', () => {
  const r = resolveExpectedTradeDate(bj('2026-10-08', '22:00'), CAL);
  assert.strictEqual(r.status, STATUS.OK);
  assert.strictEqual(r.resolution_reason, REASON.TRADING_DAY_AFTER_CUTOFF);
  assert.strictEqual(r.expected_trade_date, '2026-10-08');
  assert.strictEqual(nextTradingDay('2026-09-30', CAL), '2026-10-08');
});

test('C.4 coverage 缺失 → BLOCKED（内联未播种，不依赖仓库状态）', () => {
  const unseeded = loadCalendar({
    artifact_type: 'cn_trading_calendar',
    calendar_version: 'UNSEEDED_TEST',
    coverage: { start: null, end: null, seeded: false }, holidays: [], special_trading_days: []
  });
  const r = resolveExpectedTradeDate(bj('2026-10-08', '16:30'), unseeded);
  assert.strictEqual(r.status, STATUS.BLOCKED);
  assert.strictEqual(r.fail_closed_code, 'CALENDAR_COVERAGE_MISSING');
});

test('C.5 coverage 回溯耗尽 → BLOCKED', () => {
  const tiny = loadCalendar({
    artifact_type: 'cn_trading_calendar',
    calendar_version: 'TINY',
    coverage: { start: '2026-10-08', end: '2026-12-31', seeded: true },
    holidays: [], special_trading_days: []
  });
  const r = resolveExpectedTradeDate(bj('2026-10-08', '08:00'), tiny);
  assert.strictEqual(r.status, STATUS.BLOCKED);
  assert.strictEqual(r.fail_closed_code, 'CALENDAR_COVERAGE_EXHAUSTED');
});

/* ================================================================== *
 * §D 到期与越界 fail-closed（任务书 §4）
 * ================================================================== */
section('§D 到期预警与越界 fail-closed');

test('D.1 覆盖期内（距 end > 30 天）→ OK', () => {
  const s = calendarExpiryStatus(bj('2026-06-01', '12:00'), CAL);
  assert.strictEqual(s.status, 'OK');
  assert.strictEqual(s.reason, 'COVERAGE_OK');
  assert.strictEqual(s.coverage_end, '2026-12-31');
  assert.strictEqual(s.warning_days, 30);
  assert.strictEqual(s.auto_update, false, '⛔ 只告警，绝不自动联网更新');
});

test('D.2 距 end ≤ 30 天 → WARNING（只告警）', () => {
  const s = calendarExpiryStatus(bj('2026-12-15', '12:00'), CAL);
  assert.strictEqual(s.status, 'WARNING');
  assert.strictEqual(s.reason, 'COVERAGE_EXPIRING_SOON');
  assert.strictEqual(s.days_remaining, 16);
  assert.strictEqual(s.auto_update, false);
  // 边界：恰好 30 天
  assert.strictEqual(calendarExpiryStatus(bj('2026-12-01', '12:00'), CAL).status, 'WARNING');
  // 边界：31 天 → OK
  assert.strictEqual(calendarExpiryStatus(bj('2026-11-30', '12:00'), CAL).status, 'OK');
});

test('D.3 超出 coverage → EXPIRED，且 resolve 返回 CALENDAR_OUT_OF_RANGE', () => {
  const s = calendarExpiryStatus(bj('2027-01-05', '12:00'), CAL);
  assert.strictEqual(s.status, 'EXPIRED');
  assert.strictEqual(s.reason, 'CALENDAR_OUT_OF_RANGE');
  assert.ok(s.days_remaining < 0);

  const r = resolveExpectedTradeDate(bj('2027-01-05', '16:30'), CAL);
  assert.strictEqual(r.status, STATUS.BLOCKED);
  assert.strictEqual(r.fail_closed_code, 'CALENDAR_OUT_OF_RANGE');
  assert.strictEqual(r.expected_trade_date, null, '⛔ 不得 fallback 为 weekday-only');
});

test('D.4 早于 coverage.start 同样 BLOCKED（不得反向外推）', () => {
  const r = resolveExpectedTradeDate(bj('2025-12-31', '16:30'), CAL);
  assert.strictEqual(r.status, STATUS.BLOCKED);
  assert.strictEqual(r.fail_closed_code, 'CALENDAR_OUT_OF_RANGE');
  assert.strictEqual(calendarExpiryStatus(bj('2025-12-31', '12:00'), CAL).status, 'OK',
    '早于 start 不是 EXPIRED（那是 end 的概念），但 resolve 仍必须 BLOCKED');
});

test('D.5 FAIL_CLOSED_CODE 覆盖全部 BLOCKED 原因（对外稳定命名）', () => {
  assert.strictEqual(FAIL_CLOSED_CODE[REASON.CALENDAR_COVERAGE_MISSING], 'CALENDAR_COVERAGE_MISSING');
  assert.strictEqual(FAIL_CLOSED_CODE[REASON.CALENDAR_COVERAGE_OUT_OF_RANGE], 'CALENDAR_OUT_OF_RANGE');
  assert.strictEqual(FAIL_CLOSED_CODE[REASON.CALENDAR_COVERAGE_EXHAUSTED], 'CALENDAR_COVERAGE_EXHAUSTED');
  const ok = resolveExpectedTradeDate(bj('2026-09-23', '22:00'), CAL);
  assert.strictEqual(ok.blocked, false);
  assert.strictEqual(ok.fail_closed_code, null);
});

/* ================================================================== *
 * §E 端到端：官方日历 → RunContext 对齐
 * ================================================================== */
section('§E 官方日历接入 RunContext');

test('E.1 09-23 22:00（真实当前日）→ expected = 2026-09-23，5/5 对齐 ⇒ OK', () => {
  const { buildV361RunContext } = U('v361-run-context.js');
  const r = resolveExpectedTradeDate(bj('2026-09-23', '22:00'), CAL);
  assert.strictEqual(r.expected_trade_date, '2026-09-23');
  const codes = ['513310', '515880', '159582', '518880', '159570'];
  const snaps = {};
  const funds = {};
  codes.forEach((c) => { snaps[c] = { calc_date: '2026-09-23' }; funds[c] = { as_of_date: '2026-09-23' }; });
  const ctx = buildV361RunContext({
    run_id: 'p1a-e1', expected_codes: codes, snapshots: snaps,
    expected_trade_date: r.expected_trade_date, expected_trade_date_authority: r,
    market_env_date: '2026-09-23',
    global_signals: [{ symbol: 'usNDX', as_of_date: '2026-09-23' }], fundamentals: funds
  });
  assert.strictEqual(ctx.date_alignment.case, 'CASE_A_ALL_EXPECTED');
  assert.strictEqual(ctx.input_health.status, 'OK');
  assert.strictEqual(ctx.expected_trade_date_authority.calendar_version, 'cn-a-share-2026.1');
});

test('E.2 中秋前夜 09-24 22:00 → expected = 09-24；09-25 全天非交易日', () => {
  assert.strictEqual(resolveExpectedTradeDate(bj('2026-09-24', '22:00'), CAL).expected_trade_date, '2026-09-24');
  assert.strictEqual(resolveExpectedTradeDate(bj('2026-09-25', '22:00'), CAL).expected_trade_date, '2026-09-24');
  assert.strictEqual(resolveExpectedTradeDate(bj('2026-09-25', '22:00'), CAL).resolution_reason, REASON.NON_TRADING_DAY);
});

/* ------------------------------------------------------------------ *
 * 汇总
 * ------------------------------------------------------------------ */
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  failures.forEach((f) => console.log(`  \u2717 ${f.name}: ${f.err && f.err.message}`));
  process.exit(1);
}
