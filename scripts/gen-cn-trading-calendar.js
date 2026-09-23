#!/usr/bin/env node
/**
 * V3.6.5 P-1 —— CN 交易日历 artifact 生成器
 *
 * 职责：把**权威来源**的节假日列表转成 repo-versioned calendar artifact + manifest。
 *
 * 设计约束（V3.6.5 裁定）：
 *   - ⛔ 脚本**不得**自行推测节假日。必须显式给出 --source-file（权威来源文件），
 *     或用 --allow-unseeded 生成**未播种骨架**（coverage.seeded=false ⇒ 运行时 fail-closed BLOCKED）。
 *   - artifact 本身**不含**自己的 sha256（避免自指）；sha 记录在伴随 manifest 中。
 *   - 生成结果必须可复现：同输入 ⇒ 同 artifact ⇒ 同 sha（数字/字符串均规范化排序）。
 *
 * 用法：
 *   node scripts/gen-cn-trading-calendar.js --source-file <path> \
 *        --calendar-version <ver> --coverage-start <YYYY-MM-DD> --coverage-end <YYYY-MM-DD> \
 *        [--source-url <url>] [--out <path>] [--manifest <path>] [--check]
 *
 *   node scripts/gen-cn-trading-calendar.js --allow-unseeded --calendar-version <ver>
 *
 *   --check   只校验「现有 artifact 是否与由 source-file 重算的结果一致」，不写文件
 *
 * source-file 支持两种格式：
 *   JSON: { "holidays": ["2026-01-01", ...], "special_trading_days": [] }
 *   CSV/TXT: 每行一个 YYYY-MM-DD（# 开头为注释）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..');
const DEFAULT_OUT = path.join(REPO, 'src', 'common', 'data', 'cn-trading-calendar.json');
const DEFAULT_MANIFEST = path.join(REPO, 'src', 'common', 'data', 'cn-trading-calendar.manifest.json');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

/** 读来源文件 → { holidays:[], special_trading_days:[] } */
function readSource(file) {
  const text = fs.readFileSync(file, 'utf8');
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    let j;
    try { j = JSON.parse(trimmed); } catch (e) { fail(`source-file JSON 解析失败: ${e.message}`); }
    const holidays = Array.isArray(j.holidays) ? j.holidays : [];
    const specials = Array.isArray(j.special_trading_days) ? j.special_trading_days : [];
    holidays.concat(specials).forEach((d) => { if (!isDate(d)) fail(`source-file 含非法日期: ${JSON.stringify(d)}`); });
    return { holidays, special_trading_days: specials };
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
  return { holidays, special_trading_days: specials };
}

function uniqSorted(list) {
  return Array.from(new Set(list)).sort();
}

function buildArtifact(opts) {
  const seeded = opts.seeded === true;
  return {
    artifact_type: 'cn_trading_calendar',
    schema_version: '1.0',
    calendar_version: opts.calendarVersion,
    exchange: ['SSE', 'SZSE'],
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
    holidays: seeded ? uniqSorted(opts.holidays || []) : [],
    special_trading_days: seeded ? uniqSorted(opts.specials || []) : [],
    provenance: {
      source: seeded ? (opts.sourceUrl || opts.sourceFile || null) : null,
      method: seeded ? 'gen-cn-trading-calendar.js:parse_source_file' : null,
      source_file: seeded ? path.basename(opts.sourceFile || '') || null : null,
      source_file_sha256: seeded && opts.sourceFile
        ? crypto.createHash('sha256').update(fs.readFileSync(opts.sourceFile)).digest('hex')
        : null
      // 注意：artifact 内**不写** generated_at —— 生成时刻会破坏可复现性
      //（同输入必须 ⇒ 同字节 ⇒ 同 sha）。生成时刻记录在伴随 manifest 中。
    },
    notes: seeded
      ? [
        '本 artifact 由 scripts/gen-cn-trading-calendar.js 从权威来源文件生成，禁止手工编辑。',
        '修改必须先改来源文件再重新生成，并记录新的 calendar_version 与 artifact SHA。',
        'weekend 规则属交易所会期规则；holidays 必须来自权威来源。'
      ]
      : [
        '本文件是 V3.6.5 的『CN 交易日历权威源』artifact，除该 artifact 本身与生成脚本外，不依赖任何运行时外部网络调用。',
        '当前 coverage.seeded=false ⇒ 未注入权威节假日来源。按 fail-closed 设计，resolveExpectedTradeDate 在此状态下必须返回 BLOCKED / CALENDAR_COVERAGE_MISSING，不得回退为『工作日即交易日』或『当前自然日』。',
        '严禁手工猜节假日：必须由 scripts/gen-cn-trading-calendar.js 从权威来源文件（--source-file）生成，并同时产出 cn-trading-calendar.manifest.json 记录 source / method / calendar_version / coverage / artifact SHA。',
        'weekend 规则（周六周日非交易日）属交易所会期规则，不属『猜测』；holidays 必须来自权威来源。'
      ]
  };
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
  if (a.help) {
    console.log('用法见文件头注释。');
    return;
  }

  const outPath = a.out || DEFAULT_OUT;
  const manifestPath = a.manifest || DEFAULT_MANIFEST;
  const seeded = a['allow-unseeded'] !== true;

  if (seeded && !a['source-file']) {
    fail('必须提供 --source-file（权威来源），或显式使用 --allow-unseeded 生成未播种骨架。');
  }
  if (seeded && (!isDate(a['coverage-start']) || !isDate(a['coverage-end']))) {
    fail('已播种模式必须提供 --coverage-start / --coverage-end（YYYY-MM-DD）。');
  }
  if (!a['calendar-version']) {
    fail('必须提供 --calendar-version（例如 cn-sse-szse-2026.1）。');
  }

  let holidays = [];
  let specials = [];
  if (seeded) {
    const src = readSource(a['source-file']);
    holidays = src.holidays;
    specials = src.special_trading_days;
  }

  const artifact = buildArtifact({
    seeded,
    calendarVersion: a['calendar-version'],
    coverageStart: a['coverage-start'],
    coverageEnd: a['coverage-end'],
    holidays,
    specials,
    sourceFile: a['source-file'],
    sourceUrl: a['source-url']
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
    coverage: { ...artifact.coverage },
    source: artifact.provenance.source,
    method: artifact.provenance.method,
    source_file: artifact.provenance.source_file,
    source_file_sha256: artifact.provenance.source_file_sha256,
    generated_at: new Date().toISOString(),
    generated_by: 'scripts/gen-cn-trading-calendar.js'
  };
  const manifestBody = stableJson(manifest);
  manifest.manifest_sha256 = crypto.createHash('sha256').update(Buffer.from(manifestBody, 'utf8')).digest('hex');
  const manifestFinal = stableJson(manifest);

  if (a.check) {
    let existing = null;
    try { existing = fs.readFileSync(outPath, 'utf8'); } catch (e) { /* ignore */ }
    const same = existing != null && Buffer.from(existing, 'utf8').equals(Buffer.from(body, 'utf8'));
    console.log(`[check] artifact=${outPath}`);
    console.log(`[check] 期望 sha256 = ${sha}`);
    if (same) {
      console.log('[check] PASS —— 现有 artifact 与由来源重算的结果逐字节一致');
      return;
    }
    console.error('[check] FAIL —— 现有 artifact 与来源重算结果不一致（或文件不存在）');
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, body, 'utf8');
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, manifestFinal, 'utf8');

  console.log(`[gen-cn-trading-calendar] WROTE ${path.relative(REPO, outPath)}`);
  console.log(`  calendar_version = ${artifact.calendar_version}`);
  console.log(`  coverage         = ${JSON.stringify(artifact.coverage)}`);
  console.log(`  seeded           = ${artifact.coverage.seeded}`);
  console.log(`  holidays         = ${artifact.holidays.length}`);
  console.log(`  special          = ${artifact.special_trading_days.length}`);
  console.log(`  artifact_sha256  = ${sha}`);
  console.log(`[gen-cn-trading-calendar] WROTE ${path.relative(REPO, manifestPath)}`);
}

main();
