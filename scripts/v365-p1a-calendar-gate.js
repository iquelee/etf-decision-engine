#!/usr/bin/env node
/**
 * V3.6.5 P-1A —— Trading Calendar Authority Seal Gate
 *
 * 输出任务书 §5 的 7 项判定，并按需给出
 * `P1_PRODUCTION_AUTHORITY_ARTIFACT = CLOSED / OPEN`。
 *
 * ⚠️ 只读：不写文件、不联网、不部署。
 * ⚠️ 不调子进程（沙箱禁止）——确定性重算通过 `require` 生成器的纯函数完成。
 *
 * 用法：node scripts/v365-p1a-calendar-gate.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const U = (f) => require(path.join(REPO, 'src/common/utils', f));
const GEN = require(path.join(REPO, 'scripts', 'gen-cn-trading-calendar.js'));

const {
  resolveExpectedTradeDate, loadRepoCalendar, calendarArtifactSha256, isTradingDay
} = U('cn-trading-calendar.js');

const V1_CALENDAR = path.join(REPO, 'src', 'common', 'data', 'cn-trading-calendar.v1.json');
const V1_MANIFEST = path.join(REPO, 'src', 'common', 'data', 'cn-trading-calendar.v1.manifest.json');
const SOURCE_FILE = path.join(REPO, 'src', 'common', 'data', 'sources', 'cn-trading-calendar.source.v1.json');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
}

function bj(dateStr, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.parse(`${dateStr}T00:00:00Z`) + (h * 60 + m - 480) * 60000);
}

console.log('== P-1A Trading Calendar Authority Seal Gate ==\n');

/* ---- 1. CALENDAR_SEEDED ---- */
const cal = loadRepoCalendar();
const artifact = JSON.parse(fs.readFileSync(V1_CALENDAR, 'utf8'));
check('CALENDAR_SEEDED = true', cal.valid && cal.coverage.seeded === true && artifact.coverage.seeded === true,
  `seeded=${artifact.coverage.seeded} valid=${cal.valid}`);

/* ---- 2. CALENDAR_SYNTHETIC ---- */
check('CALENDAR_SYNTHETIC = false', artifact.synthetic === false && cal.synthetic === false,
  `synthetic=${artifact.synthetic}`);

/* ---- 3. OFFICIAL_SOURCE_TRACEABLE ---- */
const p = artifact.provenance || {};
const urlOk = Array.isArray(p.source_notice_urls)
  && p.source_notice_urls.length >= 2
  && p.source_notice_urls.every((u) => /^https?:\/\/(www\.)?(sse\.com\.cn|szse\.cn)\//.test(u));
const idOk = Array.isArray(p.source_notice_identifiers)
  && p.source_notice_identifiers.includes('上证公告〔2025〕45号')
  && p.source_notice_identifiers.includes('深证会〔2025〕481号');
const dateOk = Array.isArray(p.source_notice_dates) && p.source_notice_dates.includes('2025-12-22');
check('OFFICIAL_SOURCE_TRACEABLE = PASS',
  urlOk && idOk && dateOk && !!(p.generation_method && p.source_file_sha256),
  `authorities=${JSON.stringify(p.source_authorities)} notices=${JSON.stringify(p.source_notice_identifiers)}`);

/* ---- 4. SSE_SZSE_CONSISTENCY（用生成器的展开逻辑 + 冲突检测）---- */
let consistencyOk = false;
let consistencyDetail = '';
try {
  const src = GEN.readV1Source(SOURCE_FILE);      // 内部含 CALENDAR_CONFLICT 检测（不一致会 exit 2）
  consistencyOk = Array.isArray(src.authorities) && src.authorities.length === 2
    && JSON.stringify(src.holidays) === JSON.stringify(artifact.holidays);
  consistencyDetail = `holidays=${src.holidays.length} 与 artifact 一致=${consistencyOk}`;
} catch (e) {
  consistencyDetail = `异常: ${e.message}`;
}
check('SSE_SZSE_CONSISTENCY = PASS', consistencyOk, consistencyDetail);

/* ---- 5. DETERMINISTIC_REGEN（同输入 ⇒ 同字节）---- */
let regenOk = false;
let regenDetail = '';
try {
  const src = GEN.readV1Source(SOURCE_FILE);
  const rebuilt = GEN.buildArtifact({
    seeded: true, mode: 'v1', market: src.market,
    calendarVersion: src.calendarVersion, coverageStart: src.coverageStart, coverageEnd: src.coverageEnd,
    holidays: src.holidays, specials: src.specials, weekendClosures: src.weekendClosures,
    authorities: src.authorities, confirmingNotices: src.confirmingNotices,
    generationMethod: src.generationMethod, sourceFile: SOURCE_FILE
  });
  const body = GEN.stableJson(rebuilt);
  const onDisk = fs.readFileSync(V1_CALENDAR, 'utf8');
  regenOk = Buffer.from(body, 'utf8').equals(Buffer.from(onDisk, 'utf8'));
  regenDetail = regenOk ? '重算结果与磁盘文件逐字节一致' : '重算结果与磁盘文件不一致';
} catch (e) {
  regenDetail = `异常: ${e.message}`;
}
check('DETERMINISTIC_REGEN = PASS', regenOk, regenDetail);

/* ---- 6. ARTIFACT_SHA_STABLE ---- */
let shaOk = false;
let shaDetail = '';
try {
  const manifest = JSON.parse(fs.readFileSync(V1_MANIFEST, 'utf8'));
  const actual = calendarArtifactSha256(V1_CALENDAR);
  shaOk = actual === manifest.artifact_sha256;
  shaDetail = `actual=${actual.slice(0, 16)}… manifest=${String(manifest.artifact_sha256).slice(0, 16)}…`;
} catch (e) {
  shaDetail = `异常: ${e.message}`;
}
check('ARTIFACT_SHA_STABLE = PASS', shaOk, shaDetail);

/* ---- 7. HOLIDAY_CASES ---- */
const OPEN_CASES = ['2026-09-23', '2026-09-24', '2026-09-28', '2026-10-08'];
const CLOSED_CASES = ['2026-09-25', '2026-09-26', '2026-09-27', '2026-10-01', '2026-10-02',
  '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-10'];
const badOpen = OPEN_CASES.filter((d) => isTradingDay(d, cal) !== true);
const badClosed = CLOSED_CASES.filter((d) => isTradingDay(d, cal) !== false);
check('HOLIDAY_CASES = PASS', badOpen.length === 0 && badClosed.length === 0,
  `OPEN 用例 ${OPEN_CASES.length} / CLOSED 用例 ${CLOSED_CASES.length}；异常 open=${JSON.stringify(badOpen)} closed=${JSON.stringify(badClosed)}`);

/* ---- 8. OUT_OF_RANGE_FAIL_CLOSED ---- */
const outOfRange = resolveExpectedTradeDate(bj('2027-03-01', '16:30'), cal);
const beforeRange = resolveExpectedTradeDate(bj('2025-06-01', '16:30'), cal);
const failClosedOk = outOfRange.status === 'BLOCKED'
  && outOfRange.fail_closed_code === 'CALENDAR_OUT_OF_RANGE'
  && outOfRange.expected_trade_date === null
  && beforeRange.status === 'BLOCKED';
check('OUT_OF_RANGE_FAIL_CLOSED = PASS', failClosedOk,
  `after-end=${outOfRange.fail_closed_code} before-start=${beforeRange.fail_closed_code}（均 BLOCKED，无 weekday-only 回退）`);

/* ---- 结论 ---- */
const failed = results.filter((r) => !r.ok);
console.log('');
console.log('== 结论 ==');
if (failed.length === 0) {
  console.log('  P1_PRODUCTION_AUTHORITY_ARTIFACT = CLOSED');
  console.log(`  calendar_version = ${artifact.calendar_version}`);
  console.log(`  artifact_sha256  = ${calendarArtifactSha256(V1_CALENDAR)}`);
  process.exit(0);
}
console.log(`  P1_PRODUCTION_AUTHORITY_ARTIFACT = OPEN（${failed.length} 项 FAIL: ${failed.map((f) => f.name).join('; ')}）`);
process.exit(1);
