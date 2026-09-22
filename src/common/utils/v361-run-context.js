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

  // ---- 1. 应到交易日：取已到 ETF 快照 calc_date 的最大值 ----
  const snapshotDates = {};
  const presentDates = [];
  expectedCodes.forEach((code) => {
    const snap = snapshots[code];
    const d = snap && isDate(snap.calc_date) ? snap.calc_date : null;
    snapshotDates[code] = d;
    if (d) presentDates.push(d);
  });
  presentDates.sort();
  const asOfTradeDate = presentDates.length ? presentDates[presentDates.length - 1] : null;

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

  const envelope = {
    run_id: inp.run_id != null ? String(inp.run_id) : null,
    as_of_trade_date: asOfTradeDate,
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

module.exports = {
  FRESHNESS_POLICY,
  HEALTH,
  REQUIRED,
  OPTIONAL,
  stableStringify,
  hashInput,
  daysBetween,
  buildV361RunContext,
  validateSameTradeDate
};
