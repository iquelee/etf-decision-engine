#!/usr/bin/env node
/**
 * V3.6.5 P-1 / P-1A —— CN 交易日历 artifact 生成器
 *
 * 职责：把**权威来源**（SSE / SZSE 正式休市公告）转成 repo-versioned calendar artifact + manifest。
 *
 * 设计约束（V3.6.5 裁定 + P-1A 封版要求）：
 *   - ⛔ 脚本**不得**推测节假日。必须显式给出 --source-file；
 *     或用 --allow-unseeded 生成**未播种骨架**（coverage.seeded=false ⇒ 运行时 fail-closed BLOCKED）。
 *   - ⛔ 不得使用：普通日历网站 / 第三方财经网站 / 政府调休工作日推导 / `HOLIDAYS` 环境变量 /
 *     runtime 网络 API / 现有数据 max(snapshot date)。
 *   - **SSE 与 SZSE 正式安排若不一致** ⇒ `CALENDAR_CONFLICT` ⇒ **拒绝生成**（不自行选边）。
 *   - artifact 内**不含**生成时间戳等非确定性字段 ⇒ 同输入必然同字节同 SHA。
 *   - artifact 本身**不含**自己的 sha256（避免自指）；sha 记录在伴随 manifest 中。
 *
 * 用法：
 *   # 官方来源（v1：SSE + SZSE 双所公告 + 交叉一致性校验）
 *   node scripts/gen-cn-trading-calendar.js --source-file <v1-source.json> [--check]
 *
 *   # 简化来源（holidays 列表 / CSV），仍支持
 *   node scripts/gen-cn-trading-calendar.js --source-file <f> \
 *        --calendar-version <ver> --coverage-start <d> --coverage-end <d> \
 *        [--out <path>] [--manifest <path>] [--check]
 *
 *   # 未播种骨架
 *   node scripts/gen-cn-trading-calendar.js --allow-unseeded --calendar-version <ver>
 *
 *   --check   只校验「现有 artifact 是否与由来源重算的结果逐字节一致」，不写文件
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..');
const DATA_DIR = path.join(REPO, 'src', 'common', 'data');
const DEFAULT_OUT = path.join(DATA_DIR, 'cn-trading-calendar.json');
const DEFAULT_MANIFEST = path.join(DATA_DIR, 'cn-trading-calendar.manifest.json');
const V1_OUT = path.join(DATA_DIR, 'cn-trading-calendar.v1.json');
const V1_MANIFEST = path.join(DATA_DIR, 'cn-trading-calendar.v1.manifest.json');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_EXPIRY_WARNING_DAYS = 30;

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) continue;
    const name = k.slice(2);
    if (name === 'allow-unseeded' || name === 'check' || name === 'help') { a[name] = true; continue; }
    const v = argv[i + 1];
    if (v == null || v.startsWith('--')) { a[name] = true; continue; }
    a[name] = v; i += 1;
  }
  return a;
}

function fail(msg) {
  console.error(`[gen-cn-trading-calendar] ERROR: ${msg}`);
  process.exit(1);
}

function isDate(v) { return typeof v === 'string' && DATE_RE.test(v); }

function shiftDate(dateStr, days) {
  const t = Date.parse(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  return new Date(t + days * 86400000).toISOString().slice(0, 10);
}

function weekdayOf(dateStr) {
  const t = Date.parse(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  return new Date(t).getUTCDay();
}

function isWeekend(dateStr) {
  const w = weekdayOf(dateStr);
  return w === 0 || w === 6;
}

function uniqSorted(list) {
  return Array.from(new Set(list)).sort();
}

/* ------------------------------------------------------------------ *
 * 来源解析
 * ------------------------------------------------------------------ */

/** 展开一个 authority 的休市区间 → { weekday:[], weekend:[] } */
function expandAuthority(auth, label) {
  const closures = Array.isArray(auth && auth.closures) ? auth.closures : [];
  if (!closures.length) fail(`${label}: closures 为空`);
  const weekday = [];
  const weekend = [];
  closures.forEach((c) => {
    if (!isDate(c.start) || !isDate(c.end)) fail(`${label}: closure 区间非法 ${JSON.stringify(c)}`);
    if (c.start > c.end) fail(`${label}: closure start > end ${JSON.stringify(c)}`);
    let cur = c.start;
    let guard = 0;
    while (cur <= c.end) {
      if (guard++ > 400) fail(`${label}: closure 区间过长 ${JSON.stringify(c)}`);
      (isWeekend(cur) ? weekend : weekday).push(cur);
      cur = shiftDate(cur, 1);
      if (!cur) fail(`${label}: 日期推进失败`);
    }
  });
  const declaredWeekend = Array.isArray(auth.weekend_closures) ? auth.weekend_closures.slice() : [];
  declaredWeekend.forEach((d) => { if (!isDate(d)) fail(`${label}: weekend_closures 含非法日期 ${JSON.stringify(d)}`); });
  return {
    weekday: uniqSorted(weekday),
    weekend: uniqSorted(weekend.concat(declaredWeekend.filter(isWeekend)))
  };
}

/** 读 v1 来源（authorities 结构） */
function readV1Source(file) {
  let j;
  try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { fail(`source-file JSON 解析失败: ${e.message}`); }
  const authorities = Array.isArray(j.authorities) ? j.authorities : [];
  if (authorities.length < 2) fail('v1 来源必须至少包含两个 authority（SSE 与 SZSE）');
  const perAuthority = authorities.map((a) => {
    const label = `${a.exchange || 'UNKNOWN'}`;
    return { exchange: String(a.exchange || 'UNKNOWN'), raw: a, expanded: expandAuthority(a, label) };
  });

  // ---- 双所交叉一致性校验：不一致 ⇒ CALENDAR_CONFLICT ⇒ 拒绝生成 ----
  const ref = perAuthority[0];
  const conflicts = [];
  perAuthority.slice(1).forEach((p) => {
    const aSet = new Set(ref.expanded.weekday);
    const bSet = new Set(p.expanded.weekday);
    const onlyA = [...aSet].filter((d) => !bSet.has(d));
    const onlyB = [...bSet].filter((d) => !aSet.has(d));
    if (onlyA.length || onlyB.length) {
      conflicts.push({ left: ref.exchange, right: p.exchange, only_left: onlyA, only_right: onlyB });
    }
  });
  if (conflicts.length) {
    console.error('[gen-cn-trading-calendar] CALENDAR_CONFLICT');
    console.error(JSON.stringify(conflicts, null, 1));
    console.error('→ BLOCKED：SSE / SZSE 正式安排不一致，不得自行选边。');
    process.exit(2);
  }

  const holidays = uniqSorted([].concat(...perAuthority.map((p) => p.expanded.weekday)));
  const weekendClosures = uniqSorted([].concat(...perAuthority.map((p) => p.expanded.weekend)));

  return {
    mode: 'v1',
    market: j.market != null ? String(j.market) : 'CN_A_SHARE',
    calendarVersion: j.calendar_version != null ? String(j.calendar_version) : null,
    coverageStart: j.coverage_start,
    coverageEnd: j.coverage_end,
    generationMethod: j.generation_method != null ? String(j.generation_method) : null,
    holidays,
    specials: [],
    weekendClosures,
    authorities: perAuthority.map((p) => p.raw),
    confirmingNotices: Array.isArray(j.confirming_notices) ? j.confirming_notices : []
  };
}

/** 读简化来源（holidays 列表 / CSV） */
function readSimpleSource(file) {
  const text = fs.readFileSync(file, 'utf8');
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    let j;
    try { j = JSON.parse(trimmed); } catch (e) { fail(`source-file JSON 解析失败: ${e.message}`); }
    const holidays = Array.isArray(j.holidays) ? j.holidays : [];
    const specials = Array.isArray(j.special_trading_days) ? j.special_trading_days : [];
    holidays.concat(specials).forEach((d) => { if (!isDate(d)) fail(`source-file 含非法日期: ${JSON.stringify(d)}`); });
    return { mode: 'simple', holidays, specials, weekendClosures: [], authorities: [], confirmingNotices: [] };
  }
  const holidays = [];
  const specials = [];
  text.split(/\r?\n/).forEach((line) => {
    const s = line.trim();
    if (!s || s.startsWith('#')) return;
    const [datePart, tag] = s.split(/[,\t]/).map((x) => (x == null ? '' : x.trim()));
    if (!isDate(datePart)) fail(`source-file CSV 行非法: ${JSON.stringify(line)}`);
    if (tag && /^(special|trading)$/i.test(tag)) specials.push(datePart);
    else holidays.push(datePart);
  });
  return { mode: 'simple', holidays, specials, weekendClosures: [], authorities: [], confirmingNotices: [] };
}

/* ------------------------------------------------------------------ *
 * artifact / manifest 构造
 * ------------------------------------------------------------------ */

function buildArtifact(opts) {
  const seeded = opts.seeded === true;
  const isV1 = opts.mode === 'v1';
  const base = {
    artifact_type: 'cn_trading_calendar',
    schema_version: isV1 ? '1.0' : '1.0',
    calendar_version: opts.calendarVersion,
    market: isV1 ? opts.market : null,
    exchange: isV1 ? uniqSorted(opts.authorities.map((x) => String(x.exchange || 'UNKNOWN'))) : ['SSE', 'SZSE'],
    session_rule: {
      weekend: 'sat_sun_non_trading',
      session_close_local: '15:00',
      timezone: 'Asia/Shanghai'
    },
    coverage: {
      start: seeded ? opts.coverageStart : null,
      end: seeded ? opts.coverageEnd : null,
      seeded
    },
    synthetic: seeded && isV1 ? false : (seeded ? false : false),
    holidays: seeded ? uniqSorted(opts.holidays || []) : [],
    special_trading_days: seeded ? uniqSorted(opts.specials || []) : [],
    weekend_closures: seeded ? uniqSorted(opts.weekendClosures || []) : [],
    calendar_expiry_warning_days: opts.expiryWarningDays != null ? opts.expiryWarningDays : DEFAULT_EXPIRY_WARNING_DAYS,
    provenance: {},
    notes: []
  };

  if (seeded && isV1) {
    base.provenance = {
      source_authorities: opts.authorities.map((x) => String(x.exchange || 'UNKNOWN')).sort(),
      source_notice_identifiers: opts.authorities
        .map((x) => (x.notice_identifier != null ? String(x.notice_identifier) : null))
        .filter(Boolean).sort(),
      source_notice_dates: opts.authorities
        .map((x) => (x.notice_date != null ? String(x.notice_date) : null))
        .filter(Boolean).sort(),
      source_notice_urls: opts.authorities
        .map((x) => (x.notice_url != null ? String(x.notice_url) : null))
        .filter(Boolean).sort(),
      confirming_notice_identifiers: opts.confirmingNotices
        .map((x) => (x.notice_identifier != null ? String(x.notice_identifier) : null))
        .filter(Boolean).sort(),
      generation_method: opts.generationMethod
        || 'expand_official_closure_ranges -> derive_weekday_closures -> cross_check_exchanges',
      source_file: opts.sourceFile ? path.relative(REPO, opts.sourceFile).split(path.sep).join('/') : null,
      source_file_sha256: opts.sourceFile
        ? crypto.createHash('sha256').update(fs.readFileSync(opts.sourceFile)).digest('hex')
        : null
    };
    base.notes = [
      'Authority: SSE / SZSE 正式年度休市公告。CN trading day = Monday-Friday AND NOT official exchange closure。',
      'SSE 与 SZSE 安排已交叉校验一致；不一致时生成器会以 CALENDAR_CONFLICT 拒绝生成（不自行选边）。',
      '本 artifact 由 scripts/gen-cn-trading-calendar.js 从来源文件确定性生成，禁止手工编辑；不含生成时间戳。',
      'holidays = 官方休市区间内的**工作日**；weekend_closures = 公告另行点明的周末休市日（信息性，周末本就不开市）。',
      '超出 coverage 一律 BLOCKED（CALENDAR_OUT_OF_RANGE），不回退为 weekday-only。',
      '严禁在运行时联网更新：到期只产生 warning，不自动拉取。'
    ];
  } else if (seeded) {
    base.provenance = {
      source: opts.sourceUrl || opts.sourceFile || null,
      method: 'gen-cn-trading-calendar.js:parse_source_file',
      source_file: opts.sourceFile ? path.basename(opts.sourceFile) : null,
      source_file_sha256: opts.sourceFile
        ? crypto.createHash('sha256').update(fs.readFileSync(opts.sourceFile)).digest('hex')
        : null
    };
    base.notes = [
      '本 artifact 由 scripts/gen-cn-trading-calendar.js 从权威来源文件生成，禁止手工编辑。',
      'weekend 规则属交易所会期规则；holidays 必须来自权威来源。'
    ];
  } else {
    base.market = null;
    base.provenance = {
      source: null, method: null, source_file: null, source_file_sha256: null
    };
    base.notes = [
      '本文件是 V3.6.5 的『CN 交易日历权威源』artifact，除该 artifact 本身与生成脚本外，不依赖任何运行时外部网络调用。',
      '当前 coverage.seeded=false ⇒ 未注入权威节假日来源。按 fail-closed 设计，resolveExpectedTradeDate 在此状态下必须返回 BLOCKED / CALENDAR_COVERAGE_MISSING。',
      '严禁手工猜节假日：必须由生成脚本从权威来源文件生成。'
    ];
  }
  return base;
}

/** 稳定序列化（键排序），保证同输入 ⇒ 同字节 ⇒ 同 sha */
function stableJson(obj) {
  const s = JSON.stringify(obj, (k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const out = {};
      Object.keys(v).sort().forEach((key) => { out[key] = v[key]; });
      return out;
    }
    return v;
  }, 2);
  return `${s}\n`;
}

function main() {
  const a = parseArgs(process.argv);
  if (a.help) { console.log('用法见文件头注释。'); return; }

  const seeded = a['allow-unseeded'] !== true;

  let src = { mode: 'simple', holidays: [], specials: [], weekendClosures: [], authorities: [], confirmingNotices: [] };
  let isV1 = false;

  if (seeded) {
    if (!a['source-file']) fail('必须提供 --source-file（权威来源），或显式使用 --allow-unseeded 生成未播种骨架。');
    let probe;
    try { probe = JSON.parse(fs.readFileSync(a['source-file'], 'utf8')); } catch (e) { probe = null; }
    isV1 = !!(probe && Array.isArray(probe.authorities));
    src = isV1 ? readV1Source(a['source-file']) : readSimpleSource(a['source-file']);
  }

  const outPath = a.out || (isV1 ? V1_OUT : DEFAULT_OUT);
  const manifestPath = a.manifest || (isV1 ? V1_MANIFEST : DEFAULT_MANIFEST);

  const calendarVersion = a['calendar-version'] || (isV1 ? src.calendarVersion : null);
  if (!calendarVersion) fail('必须提供 --calendar-version（或由 v1 来源的 calendar_version 提供）。');
  const coverageStart = a['coverage-start'] || (isV1 ? src.coverageStart : null);
  const coverageEnd = a['coverage-end'] || (isV1 ? src.coverageEnd : null);
  if (seeded && (!isDate(coverageStart) || !isDate(coverageEnd))) {
    fail('已播种模式必须提供（或由来源提供）--coverage-start / --coverage-end（YYYY-MM-DD）。');
  }

  const artifact = buildArtifact({
    seeded,
    mode: isV1 ? 'v1' : 'simple',
    market: src.market,
    calendarVersion,
    coverageStart,
    coverageEnd,
    holidays: src.holidays,
    specials: src.specials,
    weekendClosures: src.weekendClosures,
    authorities: src.authorities,
    confirmingNotices: src.confirmingNotices,
    generationMethod: src.generationMethod,
    sourceFile: a['source-file'],
    sourceUrl: a['source-url'],
    expiryWarningDays: a['expiry-warning-days'] != null ? Number(a['expiry-warning-days']) : DEFAULT_EXPIRY_WARNING_DAYS
  });

  const body = stableJson(artifact);
  const sha = crypto.createHash('sha256').update(Buffer.from(body, 'utf8')).digest('hex');

  const manifest = {
    manifest_type: 'cn_trading_calendar_manifest',
    schema_version: '1.0',
    artifact: path.relative(REPO, outPath).split(path.sep).join('/'),
    artifact_sha256: sha,
    artifact_sha256_basis: 'sha256(artifact 文件的 UTF-8 字节，含末尾换行；稳定键序序列化)',
    calendar_version: artifact.calendar_version,
    market: artifact.market,
    coverage_start: artifact.coverage.start,
    coverage_end: artifact.coverage.end,
    seeded: artifact.coverage.seeded,
    synthetic: artifact.synthetic,
    source_authorities: artifact.provenance.source_authorities || null,
    source_notice_identifiers: artifact.provenance.source_notice_identifiers || null,
    source_notice_dates: artifact.provenance.source_notice_dates || null,
    generation_method: artifact.provenance.generation_method || artifact.provenance.method || null,
    source_file: artifact.provenance.source_file || null,
    source_file_sha256: artifact.provenance.source_file_sha256 || null,
    holiday_count: artifact.holidays.length,
    special_trading_day_count: artifact.special_trading_days.length,
    weekend_closure_count: artifact.weekend_closures.length,
    generated_by: 'scripts/gen-cn-trading-calendar.js'
  };
  const manifestBody = stableJson(manifest);

  if (a.check) {
    let existing = null;
    let existingManifest = null;
    try { existing = fs.readFileSync(outPath, 'utf8'); } catch (e) { /* ignore */ }
    try { existingManifest = fs.readFileSync(manifestPath, 'utf8'); } catch (e) { /* ignore */ }
    console.log(`[check] artifact=${path.relative(REPO, outPath)}`);
    console.log(`[check] 期望 artifact sha256 = ${sha}`);
    const sameArtifact = existing != null && Buffer.from(existing, 'utf8').equals(Buffer.from(body, 'utf8'));
    const sameManifest = existingManifest != null
      && Buffer.from(existingManifest, 'utf8').equals(Buffer.from(manifestBody, 'utf8'));
    console.log(`[check] artifact ${sameArtifact ? 'BYTE-IDENTICAL' : 'DIFFERS'}`);
    console.log(`[check] manifest ${sameManifest ? 'BYTE-IDENTICAL' : 'DIFFERS'}`);
    if (sameArtifact && sameManifest) {
      console.log('[check] PASS —— DETERMINISTIC_REGEN / ARTIFACT_SHA_STABLE');
      return;
    }
    console.error('[check] FAIL —— 重算结果与现有文件不一致（或文件不存在）');
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, body, 'utf8');
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, manifestBody, 'utf8');

  console.log(`[gen-cn-trading-calendar] WROTE ${path.relative(REPO, outPath)}`);
  console.log(`  calendar_version = ${artifact.calendar_version}`);
  console.log(`  market           = ${artifact.market}`);
  console.log(`  coverage         = ${JSON.stringify(artifact.coverage)}`);
  console.log(`  seeded/synthetic = ${artifact.coverage.seeded} / ${artifact.synthetic}`);
  console.log(`  holidays(workday)= ${artifact.holidays.length}`);
  console.log(`  weekend_closures = ${artifact.weekend_closures.length}`);
  console.log(`  special_trading  = ${artifact.special_trading_days.length}`);
  console.log(`  authority        = ${JSON.stringify(artifact.provenance.source_authorities || [])}`);
  console.log(`  notices          = ${JSON.stringify(artifact.provenance.source_notice_identifiers || [])}`);
  console.log(`  artifact_sha256  = ${sha}`);
  console.log(`[gen-cn-trading-calendar] WROTE ${path.relative(REPO, manifestPath)}`);
}

if (require.main === module) {
  main();
}

// 供 gate / 测试做**确定性重算**比对（复用同一实现 ⇒ 验证的是「同输入同输出」，不是独立实现）
module.exports = { readV1Source, readSimpleSource, buildArtifact, stableJson, expandAuthority, main };
