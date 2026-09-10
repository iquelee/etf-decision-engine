/**
 * 日线抓取 Lane 规划（WP-G1-DATA-01 方案 B+ 独立 Benchmark Lane / WP-G1-DATA-02 执行层收口）。
 *
 * ## 背景
 * Gen-1 的 `rs_20d` 需要基准 `510300`，但 `510300` **不属于生产决策 Universe**
 * （`etf_basic` 只有 Main5）。历史实现里 `fetchDailyData` 的抓取范围完全由
 * `db.getEtfList()` 决定，因此基准**永远不会**被每日任务更新 → 长期落后 →
 * Data Health fail-closed（`BENCHMARK_MISSING` → `ML_OFF`）。
 *
 * ## 本模块的职责
 * 把「今天要抓哪些标的、哪些已就绪、本轮到底该抓谁」抽成**纯函数**（无 DB / 无网络），
 * 使两条 Lane 的判定与执行都能被单测覆盖，并钉死下面三条语义：
 *
 * ★ 1. **两条 Lane 必须分别判定。** 任一 Lane 有缺失都不得 skip。
 *      （否则「Main5 已就绪 + 基准缺失」会永久 already_fetched。）
 * ★ 2. **只有 `to_fetch` 里的标的才允许真抓。** 已就绪（`READY_EXISTING`）的标的
 *      不得重复抓 —— 否则生产数据已完整时，一次瞬时抓取失败就会把 `overall` 打成 FAIL。
 * ★ 3. **「就绪」= 已收盘定稿**，不是「有成交量」。判定用
 *      `isFinalizedDailyBar`（当日 bar 必须带落库时的 `is_final` 标记），
 *      因此盘中误写入的当日 bar 会被视为**未就绪**并在收盘后自动覆盖。
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

/** 单标的本轮状态。 */
const STATE = Object.freeze({
  READY_EXISTING: 'READY_EXISTING',   // 已有当日定稿 bar，本轮不抓
  FETCHED_OK: 'FETCHED_OK',           // 本轮抓取成功
  FETCH_FAILED: 'FETCH_FAILED'        // 本轮抓取失败
});

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

/** 与 fetch-guard.isStructurallyValidDailyBar 同口径的兜底（调用方通常显式传入）。 */
function defaultIsFinalized(row) {
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
 * 在给定日期上，codes 里**已有定稿 bar** 的那些。
 * 定稿 = `trade_date` 命中 && `isFinalized(row)`。
 */
function finalizedCodesOnDate(rows, codes, dateStr, isFinalized) {
  const check = typeof isFinalized === 'function' ? isFinalized : defaultIsFinalized;
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

function buildLane(role, codes, rows, dateStr, isFinalized, force) {
  const ready = finalizedCodesOnDate(rows, codes, dateStr, isFinalized);
  const pending = codes.filter((c) => ready.indexOf(c) < 0);
  // 非 force：只抓未定稿的；force：整条 Lane 全量重抓（显式运维意图）
  const toFetch = force ? codes.slice() : pending.slice();
  return {
    role,
    codes,
    ready,                      // 已有当日定稿 bar（READY_EXISTING）
    pending,                    // 缺当日定稿 bar
    to_fetch: toFetch,          // ★ 本轮**真正允许抓取**的清单
    ready_flag: pending.length === 0,
    fetch_flag: toFetch.length > 0
  };
}

/**
 * 规划本轮抓取。
 *
 * @param {object} input
 * @param {string[]} input.decisionCodes    生产 ETF（来自 getEtfList）
 * @param {string[]} input.benchmarkCodes   基准（来自 GEN1_BENCHMARK_CODES）
 * @param {object[]} input.existingRows     当日已落库的 etf_daily 行
 * @param {string}   input.dateStr          目标交易日（北京日期）
 * @param {boolean}  [input.force]          强制抓取（跳过节假日闸门 + 整条 Lane 全量重抓）
 * @param {function} [input.isFinalized]    定稿判定（默认 volume>0 && close>0）
 * @returns {{date, force, production, benchmark, needsFetch, skip, fetch_production, fetch_benchmark}}
 */
function planDailyFetch(input) {
  const src = input || {};
  const isFinalized = src.isFinalized;
  const dateStr = sliceDate(src.dateStr);
  const force = src.force === true;
  const decisionCodes = uniqCodes(src.decisionCodes);
  const benchmarkCodes = uniqCodes(src.benchmarkCodes);
  const rows = src.existingRows || [];

  const production = buildLane(ROLE.PRODUCTION_ETF, decisionCodes, rows, dateStr, isFinalized, force);
  const benchmark = buildLane(ROLE.BENCHMARK, benchmarkCodes, rows, dateStr, isFinalized, force);

  // ★ 任一 Lane 缺失都不得 skip
  const needsFetch = force || production.pending.length > 0 || benchmark.pending.length > 0;

  return {
    date: dateStr,
    force,
    production,
    benchmark,
    needsFetch,
    skip: !needsFetch,
    fetch_production: production.to_fetch.length > 0,
    fetch_benchmark: benchmark.to_fetch.length > 0
  };
}

/** 取一批结果里最新的 trade_date（无则 null）。 */
function latestDateOf(results) {
  let latest = null;
  for (const r of (Array.isArray(results) ? results : [])) {
    const d = r && r.latest_date ? sliceDate(r.latest_date) : '';
    if (d && (!latest || d > latest)) latest = d;
  }
  return latest;
}

function countState(results, state) {
  return (Array.isArray(results) ? results : [])
    .filter((r) => r && r.state === state).length;
}

function failedCodes(results) {
  return (Array.isArray(results) ? results : [])
    .filter((r) => !r || r.state === STATE.FETCH_FAILED || r.ok === false)
    .map((r) => (r && r.code) || null);
}

function firstOkSource(results) {
  for (const r of (Array.isArray(results) ? results : [])) {
    if (r && r.ok !== false && r.source) return r.source;
  }
  return null;
}

function summarizeLane(role, results, code) {
  const list = Array.isArray(results) ? results : [];
  const failed = failedCodes(list);
  const base = {
    role,
    codes: list.length,
    ok: list.length > 0 && failed.length === 0,
    latest_date: latestDateOf(list),
    ready_existing: countState(list, STATE.READY_EXISTING),
    fetched_ok: countState(list, STATE.FETCHED_OK),
    fetch_failed: countState(list, STATE.FETCH_FAILED),
    failed_codes: failed
  };
  if (code != null) {
    base.code = String(code);
    base.source = firstOkSource(list);
  }
  return base;
}

/**
 * 汇总两条 Lane 的结果（运维可读 + 上线验收用）。
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
  const production = summarizeLane(ROLE.PRODUCTION_ETF, src.productionResults);
  const benchmark = summarizeLane(ROLE.BENCHMARK, src.benchmarkResults, src.benchmarkCode);

  return {
    production_daily: production,
    benchmark_daily: benchmark,
    overall: !production.ok ? OVERALL.FAIL : (benchmark.ok ? OVERALL.OK : OVERALL.PARTIAL),
    production_blocked_by_benchmark: false
  };
}

module.exports = {
  ROLE,
  STATE,
  OVERALL,
  planDailyFetch,
  summarizeDailyFetchResults,
  finalizedCodesOnDate,
  uniqCodes
};
