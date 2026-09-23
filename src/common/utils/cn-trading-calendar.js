/**
 * V3.6.5 Production Integrity —— P-1：CN 交易日历权威源（Expected Trade Date Authority）
 *
 * 背景（V3.6.5 只读审计 §14 的 P-1 结论）：
 *   `v361-run-context.js` 旧设计把 `as_of_trade_date` 定义为
 *   「已到 ETF 快照 calc_date 的**最大值**」。
 *   该值只能叫 `observed_latest_date`（观察值），**不能**当 `expected_trade_date`（权威值）：
 *   当 5 只 ETF **全体一致过期一天**时，max 仍得 T-1、不齐项 = 0 ⇒ 健康度假绿。
 *   这是 Candidate A 的结构性盲区（§14 案例 7）。
 *
 * 本模块是 P-1 的权威实现，语义严格按 V3.6.5 裁定：
 *   - 权威 = **versioned repo artifact 的 CN 交易日历 + 北京 cutoff**；
 *   - ⛔ 不得用 max(snapshot.calc_date) 当 expected_trade_date；
 *   - ⛔ 不得用 materializeIndicators / fetchDailyData 的某次成功批次当唯一权威；
 *   - ⛔ 不得默认「周一到周五就是交易日」、不得用当前自然日兜底、
 *        不得用空的 HOLIDAYS 环境变量当权威、不得运行时依赖外部网络 API；
 *   - calendar coverage 不足 ⇒ **BLOCKED（fail-closed）**，绝不猜。
 *
 * 纯函数模块：无网络、无数据库、无环境变量依赖（除显式传入的 calendar）。
 * 唯一 I/O 是 `loadRepoCalendar()` 读取仓库内 artifact（可被测试替换）。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BEIJING_OFFSET_MINUTES = 8 * 60;
/** 默认「当日已完成」判定线：15:00 收盘后留 60 分钟数据落地余量 */
const DEFAULT_CUTOFF = '16:00';
/** prevTradingDay / nextTradingDay 的扫描上限（超过必然说明日历数据异常） */
const MAX_SCAN_DAYS = 30;

const REASON = Object.freeze({
  TRADING_DAY_AFTER_CUTOFF: 'TRADING_DAY_AFTER_CUTOFF',
  TRADING_DAY_BEFORE_CUTOFF: 'TRADING_DAY_BEFORE_CUTOFF',
  NON_TRADING_DAY: 'NON_TRADING_DAY',
  CALENDAR_COVERAGE_MISSING: 'CALENDAR_COVERAGE_MISSING',
  CALENDAR_COVERAGE_OUT_OF_RANGE: 'CALENDAR_COVERAGE_OUT_OF_RANGE',
  CALENDAR_COVERAGE_EXHAUSTED: 'CALENDAR_COVERAGE_EXHAUSTED',
  INVALID_CALENDAR: 'INVALID_CALENDAR',
  INVALID_NOW: 'INVALID_NOW'
});

const STATUS = Object.freeze({ OK: 'OK', BLOCKED: 'BLOCKED' });

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const REPO = path.join(__dirname, '..', '..', '..');
const CALENDAR_PATH = path.join(REPO, 'src', 'common', 'data', 'cn-trading-calendar.json');
const MANIFEST_PATH = path.join(REPO, 'src', 'common', 'data', 'cn-trading-calendar.manifest.json');

/* ------------------------------------------------------------------ *
 * 基础日期工具（全部 UTC-safe，不依赖宿主时区）
 * ------------------------------------------------------------------ */

function isDate(v) {
  return typeof v === 'string' && DATE_RE.test(v);
}

function shiftDate(dateStr, days) {
  const t = Date.parse(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  return new Date(t + days * 86400000).toISOString().slice(0, 10);
}

/** 0=周日 … 6=周六 */
function weekdayOf(dateStr) {
  const t = Date.parse(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  return new Date(t).getUTCDay();
}

function isWeekend(dateStr) {
  const w = weekdayOf(dateStr);
  return w === 0 || w === 6;
}

/** Date → 北京墙钟 { date:'YYYY-MM-DD', minutes:0..1439, hhmm:'HH:MM' } */
function beijingParts(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const shifted = new Date(date.getTime() + BEIJING_OFFSET_MINUTES * 60000);
  const h = shifted.getUTCHours();
  const m = shifted.getUTCMinutes();
  return {
    date: shifted.toISOString().slice(0, 10),
    minutes: h * 60 + m,
    hhmm: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  };
}

/** 'HH:MM' 或分钟数 → 当日分钟数；非法返回 null */
function parseCutoff(cutoff) {
  if (typeof cutoff === 'number' && Number.isFinite(cutoff)) {
    return cutoff >= 0 && cutoff < 1440 ? Math.floor(cutoff) : null;
  }
  const s = cutoff == null ? DEFAULT_CUTOFF : String(cutoff);
  const m = HHMM_RE.exec(s);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/* ------------------------------------------------------------------ *
 * Calendar 载入与校验
 * ------------------------------------------------------------------ */

const LOADED = Symbol('cnTradingCalendarLoaded');

/**
 * 校验并归一化 calendar 对象。**不抛异常** —— 失败时返回 { valid:false, errors }。
 * @param {object} raw 已解析的 artifact 对象
 */
function loadCalendar(raw) {
  const errors = [];
  const o = raw && typeof raw === 'object' ? raw : null;
  if (!o) {
    return { valid: false, errors: ['calendar artifact 为空或非对象'] };
  }
  if (o.artifact_type !== 'cn_trading_calendar') {
    errors.push(`artifact_type 必须为 'cn_trading_calendar'，实为 ${JSON.stringify(o.artifact_type)}`);
  }
  const holidays = Array.isArray(o.holidays) ? o.holidays : [];
  const specials = Array.isArray(o.special_trading_days) ? o.special_trading_days : [];
  holidays.forEach((d) => { if (!isDate(d)) errors.push(`holidays 含非法日期: ${JSON.stringify(d)}`); });
  specials.forEach((d) => { if (!isDate(d)) errors.push(`special_trading_days 含非法日期: ${JSON.stringify(d)}`); });

  const cov = o.coverage && typeof o.coverage === 'object' ? o.coverage : {};
  const seeded = cov.seeded === true;
  if (seeded) {
    if (!isDate(cov.start)) errors.push(`coverage.start 非法: ${JSON.stringify(cov.start)}`);
    if (!isDate(cov.end)) errors.push(`coverage.end 非法: ${JSON.stringify(cov.end)}`);
    if (isDate(cov.start) && isDate(cov.end) && cov.start > cov.end) errors.push('coverage.start > coverage.end');
  }

  const calendar = {
    valid: errors.length === 0,
    errors,
    [LOADED]: true,
    calendar_version: o.calendar_version != null ? String(o.calendar_version) : null,
    schema_version: o.schema_version != null ? String(o.schema_version) : null,
    synthetic: o.synthetic === true,
    exchange: Array.isArray(o.exchange) ? o.exchange.slice() : [],
    session_rule: o.session_rule && typeof o.session_rule === 'object' ? { ...o.session_rule } : {},
    coverage: {
      start: seeded && isDate(cov.start) ? cov.start : null,
      end: seeded && isDate(cov.end) ? cov.end : null,
      seeded
    },
    holidays: holidays.filter(isDate).slice().sort(),
    special_trading_days: specials.filter(isDate).slice().sort(),
    holidaySet: new Set(holidays.filter(isDate)),
    specialSet: new Set(specials.filter(isDate)),
    provenance: o.provenance && typeof o.provenance === 'object' ? { ...o.provenance } : {}
  };
  return calendar;
}

/** 读取仓库内的生产 artifact（只读；失败返回 valid:false 的 calendar） */
function loadRepoCalendar(filePath) {
  const p = filePath || CALENDAR_PATH;
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    const cal = loadCalendar(raw);
    cal.source_path = p;
    return cal;
  } catch (e) {
    return loadCalendar(null);
  }
}

function inCoverage(dateStr, calendar) {
  const c = calendar.coverage;
  if (!c.seeded || !c.start || !c.end) return false;
  return dateStr >= c.start && dateStr <= c.end;
}

/* ------------------------------------------------------------------ *
 * 交易日判定（special 优先于 holiday 优先于 weekend）
 * ------------------------------------------------------------------ */

function isTradingDay(dateStr, calendar) {
  if (!isDate(dateStr)) return false;
  const cal = calendar && calendar[LOADED] ? calendar : loadCalendar(calendar);
  if (!cal.valid) return false;
  if (cal.specialSet.has(dateStr)) return true;
  if (cal.holidaySet.has(dateStr)) return false;
  return !isWeekend(dateStr);
}

/** 严格早于 dateStr 的最近交易日；超出 coverage / 扫描上限返回 null */
function prevTradingDay(dateStr, calendar) {
  const cal = calendar && calendar[LOADED] ? calendar : loadCalendar(calendar);
  if (!isDate(dateStr) || !cal.valid) return null;
  if (!inCoverage(dateStr, cal) && cal.coverage.seeded) return null;
  let cur = dateStr;
  for (let i = 0; i < MAX_SCAN_DAYS; i++) {
    cur = shiftDate(cur, -1);
    if (!cur) return null;
    if (cal.coverage.seeded && cur < cal.coverage.start) return null;
    if (isTradingDay(cur, cal)) return cur;
  }
  return null;
}

/** 严格晚于 dateStr 的最近交易日；超出 coverage / 扫描上限返回 null */
function nextTradingDay(dateStr, calendar) {
  const cal = calendar && calendar[LOADED] ? calendar : loadCalendar(calendar);
  if (!isDate(dateStr) || !cal.valid) return null;
  if (!inCoverage(dateStr, cal) && cal.coverage.seeded) return null;
  let cur = dateStr;
  for (let i = 0; i < MAX_SCAN_DAYS; i++) {
    cur = shiftDate(cur, 1);
    if (!cur) return null;
    if (cal.coverage.seeded && cur > cal.coverage.end) return null;
    if (isTradingDay(cur, cal)) return cur;
  }
  return null;
}

/**
 * 交易日差（to − from）：不含 from、含 to；to 早于 from 返回负数。
 * 仅用于把「自然日差」换成「交易日差」（market_env staleness），
 * 超出 coverage 返回 null（不得用自然日偷换）。
 */
function countTradeDays(fromDate, toDate, calendar) {
  const cal = calendar && calendar[LOADED] ? calendar : loadCalendar(calendar);
  if (!isDate(fromDate) || !isDate(toDate) || !cal.valid) return null;
  if (fromDate === toDate) return 0;
  const forward = toDate > fromDate;
  const lo = forward ? fromDate : toDate;
  const hi = forward ? toDate : fromDate;
  if (cal.coverage.seeded && (lo < cal.coverage.start || hi > cal.coverage.end)) return null;
  let n = 0;
  let cur = lo;
  for (let i = 0; i < 4000; i++) {
    cur = shiftDate(cur, 1);
    if (!cur || cur > hi) break;
    if (isTradingDay(cur, cal)) n += 1;
  }
  return forward ? n : -n;
}

/* ------------------------------------------------------------------ *
 * P-1 权威解析：resolveExpectedTradeDate
 * ------------------------------------------------------------------ */

function blocked(reason, extra) {
  return Object.assign({
    status: STATUS.BLOCKED,
    expected_trade_date: null,
    resolution_reason: reason
  }, extra || {});
}

/**
 * 解析「一次生产 run 的应到交易日」。
 *
 * 语义（V3.6.5 裁定）：
 *   - 今天是交易日且已过 cutoff（收盘完成 / 22:00 场景）⇒ expected = 今天
 *   - 今天是交易日但未过 cutoff（08:00 场景）        ⇒ expected = 上一个已完成交易日
 *   - 周末 / 节假日                                  ⇒ expected = 上一个已完成交易日
 *   - coverage 缺失 / 越界 / 扫描耗尽                ⇒ BLOCKED，expected = null
 *
 * @param {Date|string|number} now 运行时刻（Date / ISO 串 / 毫秒）；无时区信息按 UTC 解释
 * @param {object} calendar calendar artifact（或已 load 的对象）
 * @param {string|number} [cutoff] 'HH:MM' 或分钟数；默认 DEFAULT_CUTOFF
 * @returns {object} 判定结果（永不抛异常）
 */
function resolveExpectedTradeDate(now, calendar, cutoff) {
  const cal = calendar && calendar[LOADED] ? calendar : loadCalendar(calendar);
  if (!cal || !cal.valid) {
    return blocked(REASON.INVALID_CALENDAR, {
      calendar_version: (cal && cal.calendar_version) || null,
      calendar_coverage: (cal && cal.coverage) || null,
      calendar_errors: (cal && cal.errors) || []
    });
  }
  const cutMin = parseCutoff(cutoff);
  if (cutMin == null) {
    return blocked(REASON.INVALID_NOW, { calendar_version: cal.calendar_version, calendar_coverage: cal.coverage });
  }
  const dt = now instanceof Date ? now : new Date(now);
  const bj = beijingParts(dt);
  if (!bj) {
    return blocked(REASON.INVALID_NOW, {
      calendar_version: cal.calendar_version,
      calendar_coverage: cal.coverage,
      cutoff_local: typeof cutoff === 'string' ? cutoff : DEFAULT_CUTOFF
    });
  }

  const base = {
    calendar_version: cal.calendar_version,
    calendar_coverage: { start: cal.coverage.start, end: cal.coverage.end, seeded: cal.coverage.seeded },
    exchange: cal.exchange.slice(),
    resolved_at_beijing: bj.date,
    resolved_at_beijing_time: bj.hhmm,
    cutoff_local: typeof cutoff === 'string' ? cutoff : (cutoff == null ? DEFAULT_CUTOFF : `${String(Math.floor(cutMin / 60)).padStart(2, '0')}:${String(cutMin % 60).padStart(2, '0')}`),
    cutoff_minutes: cutMin
  };

  if (!cal.coverage.seeded || !cal.coverage.start || !cal.coverage.end) {
    return blocked(REASON.CALENDAR_COVERAGE_MISSING, base);
  }
  if (bj.date < cal.coverage.start || bj.date > cal.coverage.end) {
    return blocked(REASON.CALENDAR_COVERAGE_OUT_OF_RANGE, base);
  }

  const tradingToday = isTradingDay(bj.date, cal);
  if (tradingToday && bj.minutes >= cutMin) {
    return Object.assign({
      status: STATUS.OK,
      expected_trade_date: bj.date,
      observed_reference_date: bj.date,
      resolution_reason: REASON.TRADING_DAY_AFTER_CUTOFF
    }, base);
  }

  const prev = prevTradingDay(bj.date, cal);
  if (!prev) {
    return blocked(REASON.CALENDAR_COVERAGE_EXHAUSTED, base);
  }
  return Object.assign({
    status: STATUS.OK,
    expected_trade_date: prev,
    observed_reference_date: bj.date,
    resolution_reason: tradingToday ? REASON.TRADING_DAY_BEFORE_CUTOFF : REASON.NON_TRADING_DAY
  }, base);
}

/** 计算 artifact 的规范 sha256（用于 manifest 记录；⛔ 不写回 artifact 本身，避免自指） */
function calendarArtifactSha256(filePath) {
  const p = filePath || CALENDAR_PATH;
  const buf = fs.readFileSync(p);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

module.exports = {
  BEIJING_OFFSET_MINUTES,
  DEFAULT_CUTOFF,
  REASON,
  STATUS,
  CALENDAR_PATH,
  MANIFEST_PATH,
  isDate,
  shiftDate,
  weekdayOf,
  isWeekend,
  beijingParts,
  parseCutoff,
  loadCalendar,
  loadRepoCalendar,
  isTradingDay,
  prevTradingDay,
  nextTradingDay,
  countTradeDays,
  resolveExpectedTradeDate,
  calendarArtifactSha256
};
