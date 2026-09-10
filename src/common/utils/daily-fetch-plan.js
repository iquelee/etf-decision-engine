/**
 * 日线抓取 Lane 规划（WP-G1-DATA-01 / 方案 B+「独立 Benchmark Lane」）。
 *
 * ## 背景
 * Gen-1 的 `rs_20d` 需要基准 `510300`，但 `510300` **不属于生产决策 Universe**
 * （`etf_basic` 只有 Main5）。历史实现里 `fetchDailyData` 的抓取范围完全由
 * `db.getEtfList()` 决定，因此基准**永远不会**被每日任务更新 → 长期落后 →
 * Data Health fail-closed（`BENCHMARK_MISSING` → `ML_OFF`）。
 *
 * ## 本模块的职责
 * 把「今天要抓哪些标的、哪些已就绪」抽成**纯函数**（无 DB / 无网络），使两条 Lane
 * 的判定可被单测覆盖，并钉死下面这条最容易踩的语义：
 *
 * ★ **两条 Lane 必须分别判定。** 任一 Lane 有缺失就不得 skip。
 *   否则会出现：`Main5` 今天都有数据 → `already_fetched` → 整个函数提前 return
 *   → 基准永远补不上（原实现的 P0）。
 *
 * ## 两条 Lane 的分工
 * ```text
 * production lane   Main5（来自 etf_basic / getEtfList）
 *                   → 决策 Universe，抓日线 + 折溢价
 * benchmark lane    GEN1_BENCHMARK_CODES（来自 constants 单一事实源）
 *                   → 只抓日线，不进决策 Universe、不抓折溢价
 * ```
 *
 * ⚠️ `source` 语义保持 **provenance**（tencent / sina / eastmoney），
 * 绝不用 `source='benchmark'` 混淆「数据来源」与「资产角色」；角色由 `code` 本身表达
 * （因此本模块的 role 只出现在**返回值审计字段**里，不落库）。
 *
 * @module daily-fetch-plan
 */
'use strict';

/** 标的角色（仅用于判定与审计上报，不写数据库）。 */
const ROLE = Object.freeze({ PRODUCTION_ETF: 'production_etf', BENCHMARK: 'benchmark' });

/**
 * 数据任务整体状态。
 *   OK      两条 Lane 全部就绪（V3.6.1 生产可用 + Gen-1 基准可用）
 *   PARTIAL 生产 ETF 正常、Benchmark 失败 → **V3.6.1 不受影响**，Gen-1 后续 fail-closed
 *   FAIL    生产 ETF 失败（影响 V3.6.1）
 */
const OVERALL = Object.freeze({ OK: 'OK', PARTIAL: 'PARTIAL', FAIL: 'FAIL' });

function sliceDate(v) {
  return v == null ? '' : String(v).slice(0, 10);
}

/** 与 fetch-guard.isOfficialDailyBar 同口径的兜底（调用方通常显式传入）。 */
function defaultIsOfficial(row) {
  if (!row) return false;
  const vol = Number(row.volume);
  const close = Number(row.close);
  return Number.isFinite(vol) && vol > 0 && Number.isFinite(close) && close > 0;
}

/** 去重并转字符串（保持输入顺序）。 */
function uniqCodes(list) {
  const out = [];
  const seen = new Set();
  for (const v of (Array.isArray(list) ? list : [])) {
    if (v == null || v === '') continue;
    const c = String(v);
    if (seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}

/**
 * 在给定日期上，codes 里**已有正式日线**的那些。
 * 正式 = `trade_date` 命中 && isOfficial（volume>0 && close>0）。
 */
function laneReadyCodes(rows, codes, dateStr, isOfficial) {
  const check = typeof isOfficial === 'function' ? isOfficial : defaultIsOfficial;
  const d = sliceDate(dateStr);
  const ready = new Set();
  for (const r of (Array.isArray(rows) ? rows : [])) {
    if (!r) continue;
    if (sliceDate(r.trade_date) !== d) continue;
    if (!check(r)) continue;
    ready.add(String(r.code));
  }
  return codes.filter((c) => ready.has(c));
}

function buildLane(role, codes, rows, dateStr, isOfficial) {
  const ready = laneReadyCodes(rows, codes, dateStr, isOfficial);
  const pending = codes.filter((c) => ready.indexOf(c) < 0);
  return { role, codes, ready, pending, ready_flag: pending.length === 0 };
}

/**
 * 规划本轮抓取。
 *
 * @param {object} input
 * @param {string[]} input.decisionCodes    生产 ETF（来自 getEtfList）
 * @param {string[]} input.benchmarkCodes   基准（来自 GEN1_BENCHMARK_CODES）
 * @param {object[]} input.existingRows     当日已落库的 etf_daily 行
 * @param {string}   input.dateStr          目标交易日（北京日期）
 * @param {boolean}  [input.force]          强制抓取（忽略幂等）
 * @param {function} [input.isOfficial]     正式日线判定（默认 volume>0 && close>0）
 * @returns {{date, force, production, benchmark, needsFetch, skip, fetch_production, fetch_benchmark}}
 */
function planDailyFetch(input) {
  const src = input || {};
  const isOfficial = src.isOfficial;
  const dateStr = sliceDate(src.dateStr);
  const force = src.force === true;
  const decisionCodes = uniqCodes(src.decisionCodes);
  const benchmarkCodes = uniqCodes(src.benchmarkCodes);
  const rows = src.existingRows || [];

  const production = buildLane(ROLE.PRODUCTION_ETF, decisionCodes, rows, dateStr, isOfficial);
  const benchmark = buildLane(ROLE.BENCHMARK, benchmarkCodes, rows, dateStr, isOfficial);

  // ★ 任一 Lane 缺失都不得 skip
  const fetchProduction = decisionCodes.length > 0 && production.pending.length > 0;
  const fetchBenchmark = benchmarkCodes.length > 0 && benchmark.pending.length > 0;
  const needsFetch = force || fetchProduction || fetchBenchmark;

  return {
    date: dateStr,
    force,
    production,
    benchmark,
    needsFetch,
    skip: !needsFetch,
    // force 时两条 Lane 都抓（用于历史 backfill）
    fetch_production: force ? decisionCodes.length > 0 : fetchProduction,
    fetch_benchmark: force ? benchmarkCodes.length > 0 : fetchBenchmark
  };
}

/** 取一批抓取结果里最新的 trade_date（无则 null）。 */
function latestDateOf(results) {
  let latest = null;
  for (const r of (Array.isArray(results) ? results : [])) {
    const d = r && r.latest_date ? sliceDate(r.latest_date) : '';
    if (d && (!latest || d > latest)) latest = d;
  }
  return latest;
}

function failedCodes(results) {
  return (Array.isArray(results) ? results : [])
    .filter((r) => !r || r.ok !== true)
    .map((r) => (r && r.code) || null);
}

function firstOkSource(results) {
  for (const r of (Array.isArray(results) ? results : [])) {
    if (r && r.ok === true && r.source) return r.source;
  }
  return null;
}

/**
 * 汇总两条 Lane 的抓取结果（运维可读 + 上线验收用）。
 *
 * ★ 语义：**Benchmark 失败只降级整体为 PARTIAL，绝不影响 V3.6.1 生产数据更新**
 *   （Gen-1 是增强层，不能因为自己的基准失败把基线一起拖死）。
 *
 * @param {object} input
 * @param {object[]} input.productionResults
 * @param {object[]} input.benchmarkResults
 * @param {string}   [input.benchmarkCode]
 * @returns {{production_daily, benchmark_daily, overall, production_blocked_by_benchmark}}
 */
function summarizeDailyFetchResults(input) {
  const src = input || {};
  const prod = Array.isArray(src.productionResults) ? src.productionResults : [];
  const bench = Array.isArray(src.benchmarkResults) ? src.benchmarkResults : [];

  const prodOk = prod.length > 0 && prod.every((r) => r && r.ok === true);
  const benchOk = bench.length > 0 && bench.every((r) => r && r.ok === true);
  const overall = !prodOk
    ? OVERALL.FAIL
    : (benchOk ? OVERALL.OK : OVERALL.PARTIAL);

  return {
    production_daily: {
      role: ROLE.PRODUCTION_ETF,
      codes: prod.length,
      ok: prodOk,
      latest_date: latestDateOf(prod),
      failed_codes: failedCodes(prod)
    },
    benchmark_daily: {
      role: ROLE.BENCHMARK,
      code: src.benchmarkCode != null ? String(src.benchmarkCode) : null,
      codes: bench.length,
      ok: benchOk,
      latest_date: latestDateOf(bench),
      source: firstOkSource(bench),
      failed_codes: failedCodes(bench)
    },
    overall,
    production_blocked_by_benchmark: false
  };
}

module.exports = {
  ROLE,
  OVERALL,
  planDailyFetch,
  summarizeDailyFetchResults,
  laneReadyCodes,
  uniqCodes
};
