/**
 * V3.6.1 Safety Hardening R1 —— V361RunContext（Run Input Envelope，缺陷 #5）
 *
 * 背景：
 *   旧实现里 `runDecisionEngine` 让**每只 ETF 各自无约束地**取自己的
 *   `db.getLatestSnapshot(code)`，没有任何机制保证「这 5 张快照属于同一个应到交易日」。
 *   只要某只 ETF 抓取失败 / 落在旧日期，这一次运行就是**混合日期**的：
 *   行情是 A 日的、基本面是 B 日的、指数环境是 C 日的，却合成同一个 run 的结论。
 *
 * 本轮定位：
 *   - 建立 `V361RunContext` 显式输入信封：一次运行**声明**它吃了哪些输入、各自日期、
 *     哪些缺失 / 过期、健康度、以及一个可复核的 `input_hash`。
 *   - **日期兼容规则写成代码 + 测试**，不写在注释里靠人理解。
 *   - 本轮只**构建与诊断**，不改任何生产写入路径（不落库、不阻断、不改 target/action）。
 *
 * ── V3.6.5 P-1 增补（三日期语义正式分离，additive）───────────────────────
 *   P-1 审计结论：旧字段 `as_of_trade_date` 取「已到快照 calc_date 的**最大值**」，
 *   该值只是**观察值**，不能当权威值 —— 当 5 只 ETF **全体一致过期**时它仍返回 T-1、
 *   且「不齐项 = 0」⇒ 健康度假绿。故本文件引入三个**语义独立**的日期：
 *
 *     expected_trade_date            ← 外部权威（CN 交易日历 + 北京 cutoff），
 *                                      由 `cn-trading-calendar.js` 的
 *                                      `resolveExpectedTradeDate()` 提供。
 *                                      本文件**不自己算**，只接收并回显。
 *     observed_latest_date           ← required ETF 快照 calc_date 的实际最大值。
 *                                      = 旧 `as_of_trade_date`（该字段保留，向后兼容，
 *                                        语义等同 observed_latest_date）。
 *     effective_as_of_trade_date     ← 仅当 **required 快照全部 == expected_trade_date**
 *                                      时才成立（否则为 null）。
 *
 *   对齐判定（`validateAgainstExpectedTradeDate`）分三类：
 *     CASE_A_ALL_EXPECTED  5/5 == expected                → 健康，可继续
 *     CASE_B_PARTIAL_STALE 部分 == expected、部分更旧      → **BLOCKED**
 *     CASE_C_ALL_STALE     全部一致地更旧（全体落后同一天） → **BLOCKED**（旧方案盲区）
 *   未传 expected_trade_date 时不做对齐判定（保持旧行为，CASE_UNKNOWN）。
 *   ⛔ 本文件仍不阻断生产：只**分类与登记**，是否 fail-closed 由调用方决定。
 *
 * 兼容性口径（写成代码，见 FRESHNESS_POLICY）：
 *   - 中国 ETF 快照 / indicator 快照：**必须**等于本次 `as_of_trade_date`
 *     （`strict_same_trade_date`，required）。
 *   - `market_env`（宽基指数周线）：允许最多 `max_staleness_trade_days` 个交易日的滞后。
 *   - `global_signal`（海外指数）：允许最多 `max_staleness_days` 个自然日滞后。
 *   - `fundamental`：允许最多 `max_staleness_days` 个自然日滞后（财报本身低频）。
 *
 * 本文件为**纯函数**（唯一外部依赖：crypto，用于 input_hash）。
 */
'use strict';

const crypto = require('crypto');

const REQUIRED = 'required';
const OPTIONAL = 'optional';

const FRESHNESS_POLICY = Object.freeze({
  etf_snapshot: Object.freeze({
    mode: 'strict_same_trade_date', level: REQUIRED,
    note: '中国 ETF 行情快照必须属于本次 as_of_trade_date'
  }),
  indicator_snapshot: Object.freeze({
    mode: 'strict_same_trade_date', level: REQUIRED,
    note: '指标快照（calc_date）必须与 ETF 快照同一交易日'
  }),
  market_env: Object.freeze({
    mode: 'max_staleness_trade_days', max_staleness_trade_days: 5, level: OPTIONAL,
    note: '宽基指数周线允许最多 5 个交易日滞后'
  }),
  global_signal: Object.freeze({
    mode: 'max_staleness_days', max_staleness_days: 3, level: OPTIONAL,
    note: '海外指数信号允许最多 3 个自然日滞后（时区/交易日不同）'
  }),
  fundamental: Object.freeze({
    mode: 'max_staleness_days', max_staleness_days: 120, level: OPTIONAL,
    note: '基本面为低频数据，允许最多 120 个自然日滞后'
  })
});

const HEALTH = Object.freeze({ OK: 'OK', DEGRADED: 'DEGRADED', BLOCKED: 'BLOCKED' });

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isDate(v) {
  return typeof v === 'string' && DATE_RE.test(v);
}

/** 自然日差（b - a），输入均为 'YYYY-MM-DD'；非法输入返回 null */
function daysBetween(a, b) {
  if (!isDate(a) || !isDate(b)) return null;
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return null;
  return Math.round((tb - ta) / 86400000);
}

/** 稳定序列化：对象键递归排序，保证 input_hash 与键顺序无关 */
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function hashInput(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

const DATE_ALIGNMENT_CASE = Object.freeze({
  /** 5/5 required 快照 == expected ⇒ 健康 */
  CASE_A_ALL_EXPECTED: 'CASE_A_ALL_EXPECTED',
  /** 部分 == expected、部分更旧 ⇒ BLOCKED */
  CASE_B_PARTIAL_STALE: 'CASE_B_PARTIAL_STALE',
  /** 全部**一致地**更旧（全体落后同一天）⇒ BLOCKED（旧 max 方案完全看不见的一类） */
  CASE_C_ALL_STALE: 'CASE_C_ALL_STALE',
  /** 未提供 expected_trade_date ⇒ 不做对齐判定（保持旧行为） */
  CASE_UNKNOWN_NO_EXPECTED: 'CASE_UNKNOWN_NO_EXPECTED',
  /** 一个 required 快照都没有 ⇒ 交由 missing_sources 定性，不在此重复 */
  CASE_NO_REQUIRED_SNAPSHOT: 'CASE_NO_REQUIRED_SNAPSHOT'
});

/**
 * 对齐判定：required 快照日期 vs **权威**应到交易日。
 *
 * ⛔ 这里的 expected 必须来自外部权威（CN 交易日历），
 *    绝不能传 max(snapshot.calc_date) —— 那正是本函数要防的盲区。
 *
 * @param {string|null} expectedTradeDate 权威应到交易日
 * @param {Object<string,string|null>} snapshotDates code → calc_date
 * @param {string[]} expectedCodes 应到标的清单
 * @returns {{case:string, blocked:boolean, effective_as_of_trade_date:string|null,
 *            offender_codes:string[], distinct_snapshot_dates:string[]}}
 */
function computeDateAlignment(expectedTradeDate, snapshotDates, expectedCodes) {
  const out = {
    case: DATE_ALIGNMENT_CASE.CASE_UNKNOWN_NO_EXPECTED,
    blocked: false,
    effective_as_of_trade_date: null,
    offender_codes: [],
    distinct_snapshot_dates: []
  };
  if (!isDate(expectedTradeDate)) return out;

  const codes = Array.isArray(expectedCodes) ? expectedCodes : [];
  const dates = [];
  const missing = [];
  codes.forEach((c) => {
    const d = snapshotDates ? snapshotDates[c] : null;
    if (isDate(d)) dates.push(d); else missing.push(c);
  });
  out.distinct_snapshot_dates = Array.from(new Set(dates)).sort();

  if (dates.length === 0) {
    out.case = DATE_ALIGNMENT_CASE.CASE_NO_REQUIRED_SNAPSHOT;
    out.blocked = false;
    return out;
  }

  out.offender_codes = codes.filter((c) => {
    const d = snapshotDates ? snapshotDates[c] : null;
    return isDate(d) && d !== expectedTradeDate;
  }).sort();

  if (out.offender_codes.length === 0 && missing.length === 0) {
    out.case = DATE_ALIGNMENT_CASE.CASE_A_ALL_EXPECTED;
    out.effective_as_of_trade_date = expectedTradeDate;
    return out;
  }

  // 全体一致地更旧：所有已到快照同值且严格早于 expected ⇒ CASE_C
  // （这正是 max(calc_date) 方案的盲区：它能算出观测日，却对「全体过期」无感）
  const allSame = out.distinct_snapshot_dates.length === 1;
  const thatDate = allSame ? out.distinct_snapshot_dates[0] : null;
  if (allSame && missing.length === 0 && thatDate < expectedTradeDate) {
    out.case = DATE_ALIGNMENT_CASE.CASE_C_ALL_STALE;
    out.blocked = true;
    return out;
  }

  out.case = DATE_ALIGNMENT_CASE.CASE_B_PARTIAL_STALE;
  out.blocked = true;
  return out;
}

/**
 * 构建 V361RunContext。
 *
 * @param {object} input
 *   - run_id            {string}  本次运行标识（调用方生成，要求可追溯）
 *   - expected_codes    {string[]} 本次应到的标的（权威清单，来自 etf_basic）
 *   - snapshots         {Object<string,{calc_date?:string}>} code → 指标快照
 *   - market_env_date   {string|null} 宽基指数环境数据的基准日期
 *   - global_signals    {Array<{symbol?:string, as_of_date?:string}>}
 *   - fundamentals      {Object<string,{as_of_date?:string}>}
 *   - config_version    {string|null}
 *   - market_env_trade_days_lag {number} 可选：market_env 相对 as_of 的**交易日**滞后数
 *   - expected_trade_date   {string|null} 可选：由 CN 交易日历权威源解析出的
 *                           **应到交易日**（见 cn-trading-calendar.js）。不传则不做对齐判定。
 *   - expected_trade_date_authority {object|null} 可选：权威解析的元数据
 *                           { calendar_version, calendar_coverage, resolution_reason, status }
 * @returns {object} V361RunContext
 */
function buildV361RunContext(input) {
  const inp = input || {};
  const expectedCodes = Array.isArray(inp.expected_codes)
    ? inp.expected_codes.filter((c) => c != null).map(String)
    : [];
  const snapshots = inp.snapshots || {};
  const globalSignals = Array.isArray(inp.global_signals) ? inp.global_signals : [];
  const fundamentals = inp.fundamentals || {};

  // ---- 1. 观察日期（observed）与权威日期（expected）分离（V3.6.5 P-1）----
  // observed_latest_date = 已到 ETF 快照 calc_date 的最大值：**只是观察值**，
  // 不构成「应到交易日」权威 —— 5 票全体一致过期时它照样返回 T-1 且毫无察觉。
  const snapshotDates = {};
  const presentDates = [];
  expectedCodes.forEach((code) => {
    const snap = snapshots[code];
    const d = snap && isDate(snap.calc_date) ? snap.calc_date : null;
    snapshotDates[code] = d;
    if (d) presentDates.push(d);
  });
  presentDates.sort();
  const observedLatestDate = presentDates.length ? presentDates[presentDates.length - 1] : null;
  // 向后兼容：as_of_trade_date 逐字保留旧语义（= observed_latest_date），既有调用方零改动。
  const asOfTradeDate = observedLatestDate;

  // expected_trade_date 由调用方从权威源（CN 交易日历 + cutoff）传入；本文件**不自行推断**。
  const expectedTradeDate = isDate(inp.expected_trade_date) ? inp.expected_trade_date : null;
  const alignment = computeDateAlignment(expectedTradeDate, snapshotDates, expectedCodes);

  // ---- 2. 缺失 / 过期来源 ----
  const missingSources = [];
  const staleSources = [];

  expectedCodes.forEach((code) => {
    if (!snapshots[code]) {
      missingSources.push({ source: 'etf_snapshot', code, reason: 'no_snapshot' });
      return;
    }
    const d = snapshotDates[code];
    if (!d) {
      missingSources.push({ source: 'etf_snapshot', code, reason: 'no_calc_date' });
      return;
    }
    if (asOfTradeDate && d !== asOfTradeDate) {
      staleSources.push({
        source: 'indicator_snapshot', code, date: d,
        expected_date: asOfTradeDate, policy: 'strict_same_trade_date',
        reason: 'not_as_of_trade_date'
      });
    }
  });

  if (!asOfTradeDate) {
    missingSources.push({ source: 'as_of_trade_date', reason: 'no_snapshot_date_available' });
  }

  // ---- 3. market_env ----
  const marketEnvDate = isDate(inp.market_env_date) ? inp.market_env_date : null;
  if (!marketEnvDate) {
    missingSources.push({ source: 'market_env', reason: 'no_date' });
  } else if (asOfTradeDate) {
    const lag = typeof inp.market_env_trade_days_lag === 'number'
      ? inp.market_env_trade_days_lag
      : daysBetween(marketEnvDate, asOfTradeDate);
    const maxLag = FRESHNESS_POLICY.market_env.max_staleness_trade_days;
    if (lag != null && lag > maxLag) {
      staleSources.push({
        source: 'market_env', date: marketEnvDate, expected_date: asOfTradeDate,
        lag_days: lag, max_staleness_trade_days: maxLag,
        policy: 'max_staleness_trade_days', reason: 'exceeds_max_staleness'
      });
    }
  }

  // ---- 4. global signals（各自 freshness policy，不要求机械同日）----
  const globalSignalDates = {};
  globalSignals.forEach((s) => {
    const sym = s && s.symbol != null ? String(s.symbol) : null;
    if (!sym) return;
    const d = s && isDate(s.as_of_date) ? s.as_of_date : null;
    globalSignalDates[sym] = d;
    if (!d) {
      staleSources.push({
        source: 'global_signal', code: sym, date: null, expected_date: asOfTradeDate,
        policy: 'max_staleness_days', reason: 'no_as_of_date'
      });
      return;
    }
    const lag = asOfTradeDate ? daysBetween(d, asOfTradeDate) : null;
    const maxLag = FRESHNESS_POLICY.global_signal.max_staleness_days;
    if (lag != null && lag > maxLag) {
      staleSources.push({
        source: 'global_signal', code: sym, date: d, expected_date: asOfTradeDate,
        lag_days: lag, max_staleness_days: maxLag,
        policy: 'max_staleness_days', reason: 'exceeds_max_staleness'
      });
    }
  });
  if (!Object.keys(globalSignalDates).length) {
    missingSources.push({ source: 'global_signal', reason: 'no_signals' });
  }

  // ---- 5. fundamental ----
  const fundamentalDates = {};
  expectedCodes.forEach((code) => {
    const f = fundamentals[code];
    const d = f && isDate(f.as_of_date) ? f.as_of_date : null;
    fundamentalDates[code] = d;
    if (!d) {
      staleSources.push({
        source: 'fundamental', code, date: null, expected_date: asOfTradeDate,
        policy: 'max_staleness_days', max_staleness_days: FRESHNESS_POLICY.fundamental.max_staleness_days,
        reason: 'no_as_of_date'
      });
      return;
    }
    const lag = asOfTradeDate ? daysBetween(d, asOfTradeDate) : null;
    const maxLag = FRESHNESS_POLICY.fundamental.max_staleness_days;
    if (lag != null && lag > maxLag) {
      staleSources.push({
        source: 'fundamental', code, date: d, expected_date: asOfTradeDate,
        lag_days: lag, max_staleness_days: maxLag,
        policy: 'max_staleness_days', reason: 'exceeds_max_staleness'
      });
    }
  });

  // ---- 6. input_health ----
  const requiredMissing = missingSources.filter((m) => {
    const p = FRESHNESS_POLICY[m.source];
    return !p || p.level === REQUIRED;
  });
  const requiredStale = staleSources.filter((s) => {
    const p = FRESHNESS_POLICY[s.source];
    return !p || p.level === REQUIRED;
  });
  const optionalIssues = (missingSources.length - requiredMissing.length)
    + (staleSources.length - requiredStale.length);

  let status = HEALTH.OK;
  let healthReason = null;
  if (requiredMissing.length || requiredStale.length || expectedCodes.length === 0) {
    status = HEALTH.BLOCKED;
    healthReason = expectedCodes.length === 0
      ? 'no_expected_codes'
      : (requiredMissing.length ? 'required_source_missing' : 'required_source_stale');
  } else if (optionalIssues > 0) {
    status = HEALTH.DEGRADED;
    healthReason = 'optional_source_incomplete';
  }

  // V3.6.5 P-1：相对**权威应到交易日**的对齐判定（与上面的 cross-sectional 判据互补）。
  // ⚠️ 仅在调用方传入 expected_trade_date 时生效 —— 不传则逐字保持旧行为（既有调用方零影响）。
  // 关键补强：CASE_C（5 票全体一致过期）在纯 cross-sectional 判据下 stale_count = 0、
  // 会被误判为 OK；此处显式 BLOCK（这是旧 max(calc_date) 方案的结构性盲区）。
  if (expectedTradeDate && alignment.blocked) {
    status = HEALTH.BLOCKED;
    healthReason = alignment.case === DATE_ALIGNMENT_CASE.CASE_C_ALL_STALE
      ? 'all_required_stale_against_expected'
      : 'required_not_at_expected_trade_date';
  }

  const envelope = {
    run_id: inp.run_id != null ? String(inp.run_id) : null,
    // 向后兼容字段：语义等同 observed_latest_date（旧的 max(calc_date) 行为逐字保留）
    as_of_trade_date: asOfTradeDate,
    // ---- V3.6.5 P-1 三日期（语义独立，不得互相顶替）----
    observed_latest_date: observedLatestDate,
    expected_trade_date: expectedTradeDate,
    effective_as_of_trade_date: alignment.effective_as_of_trade_date,
    expected_trade_date_authority: (inp.expected_trade_date_authority && typeof inp.expected_trade_date_authority === 'object')
      ? { ...inp.expected_trade_date_authority } : null,
    date_alignment: {
      case: alignment.case,
      blocked: alignment.blocked,
      expected_trade_date: expectedTradeDate,
      observed_latest_date: observedLatestDate,
      effective_as_of_trade_date: alignment.effective_as_of_trade_date,
      offender_codes: alignment.offender_codes,
      distinct_snapshot_dates: alignment.distinct_snapshot_dates
    },
    expected_codes: expectedCodes,
    snapshot_dates: snapshotDates,
    market_env_date: marketEnvDate,
    global_signal_dates: globalSignalDates,
    fundamental_dates: fundamentalDates,
    missing_sources: missingSources,
    stale_sources: staleSources,
    input_health: { status, reason: healthReason, missing_count: missingSources.length, stale_count: staleSources.length },
    config_version: inp.config_version != null ? inp.config_version : null,
    freshness_policy: FRESHNESS_POLICY
  };

  return {
    ...envelope,
    input_hash: hashInput({
      run_id: envelope.run_id,
      as_of_trade_date: envelope.as_of_trade_date,
      observed_latest_date: envelope.observed_latest_date,
      expected_trade_date: envelope.expected_trade_date,
      expected_codes: envelope.expected_codes,
      snapshot_dates: envelope.snapshot_dates,
      market_env_date: envelope.market_env_date,
      global_signal_dates: envelope.global_signal_dates,
      fundamental_dates: envelope.fundamental_dates,
      config_version: envelope.config_version
    })
  };
}

/**
 * 校验：所有中国 ETF / indicator 快照是否都属于同一 expected trade date。
 * （规则落在代码里，供测试与诊断调用）
 */
function validateSameTradeDate(context) {
  const ctx = context || {};
  const expected = ctx.as_of_trade_date;
  const offenders = [];
  Object.keys(ctx.snapshot_dates || {}).forEach((code) => {
    const d = ctx.snapshot_dates[code];
    if (d !== expected) offenders.push({ code, date: d, expected_date: expected });
  });
  return { ok: expected != null && offenders.length === 0, as_of_trade_date: expected, offenders };
}

/**
 * V3.6.5 P-1：独立对齐校验入口 —— required 快照是否全部落在**权威应到交易日**。
 *
 * 与 `validateSameTradeDate` 的区别（两者互补，不是替代）：
 *   - `validateSameTradeDate`  : 跨截面一致性（都等于 observed max）—— 看不见「全体一致过期」
 *   - `validateAgainstExpectedTradeDate` : 相对权威日的新鲜度 —— 能 BLOCK 全体一致过期
 *
 * @param {object} context buildV361RunContext 的产物（或至少含 snapshot_dates / expected_codes）
 * @param {object} [opts] { expected_trade_date?, snapshot_dates?, expected_codes? } 覆盖 context
 */
function validateAgainstExpectedTradeDate(context, opts) {
  const ctx = context || {};
  const o = opts || {};
  const expected = isDate(o.expected_trade_date) ? o.expected_trade_date
    : (isDate(ctx.expected_trade_date) ? ctx.expected_trade_date : null);
  const snapDates = o.snapshot_dates || ctx.snapshot_dates || {};
  const codes = Array.isArray(o.expected_codes) ? o.expected_codes
    : (Array.isArray(ctx.expected_codes) ? ctx.expected_codes : []);
  const alignment = computeDateAlignment(expected, snapDates, codes);
  const observed = ctx.observed_latest_date != null ? ctx.observed_latest_date
    : (ctx.as_of_trade_date != null ? ctx.as_of_trade_date : null);
  return {
    ok: alignment.case === DATE_ALIGNMENT_CASE.CASE_A_ALL_EXPECTED && alignment.blocked === false,
    case: alignment.case,
    blocked: alignment.blocked,
    expected_trade_date: expected,
    observed_latest_date: observed,
    effective_as_of_trade_date: alignment.effective_as_of_trade_date,
    offender_codes: alignment.offender_codes,
    distinct_snapshot_dates: alignment.distinct_snapshot_dates
  };
}

module.exports = {
  FRESHNESS_POLICY,
  HEALTH,
  REQUIRED,
  OPTIONAL,
  DATE_ALIGNMENT_CASE,
  stableStringify,
  hashInput,
  daysBetween,
  computeDateAlignment,
  buildV361RunContext,
  validateSameTradeDate,
  validateAgainstExpectedTradeDate
};
