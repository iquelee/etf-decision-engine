/**
 * V3.0 v1.1 P6 — 科技票相关性 TechCap 折扣（§B1）
 *
 * V3.6.1 Safety Hardening R1（缺陷 #4）——**按 trade_date INNER JOIN 对齐**：
 *
 *   修复前：`returnsFromBars()` 只取 `close` 数组，`computeTechCorrelation()` 直接把
 *   两只 ETF 的 returns 数组**按尾部下标配对**。只要其中一只 ETF 缺一个交易日
 *   （停牌、QDII 假日错位、抓取缺口、次新股上市日不同），两边的收益率序列就会
 *   整体错位一天 —— Pearson ρ 会被系统性污染，进而污染 correlation_discount →
 *   effective_tech_cap。
 *
 *   修复后：
 *     1. 先生成 `{ trade_date -> return }`；
 *     2. 两只 ETF 按 `trade_date` **INNER JOIN**；
 *     3. 额外要求两边该日的收益率**跨度一致**（`prev_trade_date` 相同），
 *        否则该观测点被丢弃（计入 `dropped_misaligned`），绝不拿「1 日收益」
 *        去对「2 日收益」；
 *     4. 只有共同交易日（且跨度一致）才能进入 Pearson 计算。
 *
 *   样本不足**不得隐藏**：输出 `aligned_observations` / `latest_common_date` /
 *   `coverage_ratio`，并对样本不足的 pair 显式给出 `insufficient_sample: true`
 *   与 `reason`（此时 rho 为 null，而不是悄悄拿不足样本硬算）。
 *
 *   本改动**不改变**线上 tech_sector_max 数值，也不改变 discount 分档阈值；
 *   它只修正「喂给分档的 ρ 是怎么算出来的」。是否让新 ρ 驱动生产，需 replay 对照后单独放行。
 */
'use strict';

const TECH_CORR_PAIRS = [
  ['513310', '159582'],
  ['513310', '515880'],
  ['159582', '515880']
];

const DEFAULT_WINDOW = 60;
/** Pearson 最少样本（与修复前一致） */
const MIN_OBSERVATIONS = 10;

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function round3(v) {
  return v == null ? null : Math.round(v * 1000) / 1000;
}

function closesFromBars(bars) {
  if (!bars || !bars.length) return [];
  return bars
    .filter((b) => b && b.close != null)
    .map((b) => b.close);
}

/** @deprecated 仅保留向后兼容；生产路径不再使用（会丢失日期对齐信息） */
function dailyReturns(closes) {
  const rets = [];
  for (let i = 1; i < closes.length; i += 1) {
    const prev = closes[i - 1];
    const cur = closes[i];
    if (prev == null || cur == null || prev <= 0) continue;
    rets.push((cur - prev) / prev);
  }
  return rets;
}

/**
 * 生成带日期的收益率序列：`{ trade_date -> return }` + 每次收益率的跨度来源。
 *
 * 关键点：逐日收益率只在**同一只 ETF 自己的相邻可用交易日**之间计算，
 * 并显式记录 `prev_trade_date`，供后续判断「两边算的是不是同一段区间」。
 *
 * @param {Array<{trade_date?:string,close?:number}>} bars 日线（升序）
 * @returns {{ok:boolean,reason?:string,series?:Array<{trade_date:string,prev_trade_date:string,ret:number}>,
 *            map?:Object<string,number>, latest_trade_date?:string|null}}
 */
function returnsByTradeDate(bars) {
  if (!Array.isArray(bars) || !bars.length) return { ok: false, reason: 'no_bars', series: [], map: {} };

  const rows = bars.filter((b) => b && b.close != null && isNum(b.close));
  if (rows.length < 2) return { ok: false, reason: 'insufficient_rows', series: [], map: {} };

  const dated = rows.filter((b) => typeof b.trade_date === 'string' && b.trade_date !== '');
  if (dated.length < 2) {
    // 无 trade_date ⇒ 无法对齐。绝不回退到「按下标配对」（那正是被修复的缺陷）。
    return { ok: false, reason: 'missing_trade_date', series: [], map: {} };
  }

  const series = [];
  const map = {};
  for (let i = 1; i < dated.length; i += 1) {
    const cur = dated[i];
    const prev = dated[i - 1];
    if (!(prev.close > 0)) continue;
    const ret = (cur.close - prev.close) / prev.close;
    if (!isNum(ret)) continue;
    series.push({ trade_date: cur.trade_date, prev_trade_date: prev.trade_date, ret });
    map[cur.trade_date] = ret;
  }
  return {
    ok: series.length > 0,
    reason: series.length > 0 ? null : 'no_return_pairs',
    series,
    map,
    latest_trade_date: series.length ? series[series.length - 1].trade_date : null
  };
}

/** @deprecated 保留旧签名；仅用于对照 OLD 口径 */
function returnsFromBars(bars, window) {
  return dailyReturns(closesFromBars(bars)).slice(-((window || DEFAULT_WINDOW) + 1));
}

/** Pearson ρ —— 唯一实现，输入为已对齐的 (x,y) 数组 */
function pearsonOnPairs(pairs) {
  const n = pairs.length;
  if (n < 2) return null;
  let m1 = 0;
  let m2 = 0;
  for (let i = 0; i < n; i += 1) { m1 += pairs[i].x; m2 += pairs[i].y; }
  m1 /= n; m2 /= n;
  let num = 0;
  let d1 = 0;
  let d2 = 0;
  for (let i = 0; i < n; i += 1) {
    const a = pairs[i].x - m1;
    const b = pairs[i].y - m2;
    num += a * b;
    d1 += a * a;
    d2 += b * b;
  }
  const den = Math.sqrt(d1 * d2);
  if (!den) return null;
  return num / den;
}

/**
 * @deprecated 旧口径（按数组下标尾部配对）。**生产路径已不再调用**。
 * 保留仅供 replay 的 OLD_CORRELATION 对照。
 */
function calcCorrelation(returns1, returns2, window) {
  const w = window != null ? window : DEFAULT_WINDOW;
  if (!returns1 || !returns2 || !returns1.length || !returns2.length) return null;
  const n = Math.min(returns1.length, returns2.length, w);
  if (n < MIN_OBSERVATIONS) return null;
  const r1 = returns1.slice(-n);
  const r2 = returns2.slice(-n);
  const pairs = [];
  for (let i = 0; i < n; i += 1) pairs.push({ x: r1[i], y: r2[i] });
  return pearsonOnPairs(pairs);
}

/**
 * 两只 ETF 按 trade_date INNER JOIN（并要求跨度一致）。
 * @returns {{pairs:Array<{trade_date:string,x:number,y:number}>,
 *            aligned_observations:number, dropped_misaligned:number,
 *            latest_common_date:string|null, coverage_ratio:number,
 *            expected_window:number, reason:string|null}}
 */
function alignReturnSeries(barsA, barsB, window) {
  const w = window != null ? window : DEFAULT_WINDOW;
  const a = returnsByTradeDate(barsA);
  const b = returnsByTradeDate(barsB);

  const empty = {
    pairs: [], aligned_observations: 0, dropped_misaligned: 0,
    latest_common_date: null, coverage_ratio: 0, expected_window: w, reason: null
  };

  if (!a.ok || !b.ok) {
    return { ...empty, reason: !a.ok ? `a:${a.reason}` : `b:${b.reason}` };
  }

  const bByDate = {};
  b.series.forEach((r) => { bByDate[r.trade_date] = r; });

  const joined = [];
  let dropped = 0;
  a.series.forEach((ra) => {
    const rb = bByDate[ra.trade_date];
    if (!rb) return; // 非共同交易日 ⇒ 不进入 Pearson（INNER JOIN）
    if (rb.prev_trade_date !== ra.prev_trade_date) {
      // 共同交易日，但两边算的不是同一段区间 ⇒ 错位风险，丢弃并计数
      dropped += 1;
      return;
    }
    joined.push({ trade_date: ra.trade_date, x: ra.ret, y: rb.ret });
  });

  const expected = Math.min(w, Math.max(a.series.length, b.series.length));
  const used = joined.slice(-w);
  const coverage = expected > 0 ? Math.min(1, used.length / expected) : 0;

  return {
    pairs: used,
    aligned_observations: used.length,
    dropped_misaligned: dropped,
    latest_common_date: used.length ? used[used.length - 1].trade_date : null,
    coverage_ratio: round3(coverage),
    expected_window: expected,
    reason: joined.length ? null : 'no_aligned_observation'
  };
}

/**
 * @param {number|null} rhoAvg
 * @param {number|null} rhoMax
 * @returns {number} correlation_discount 0.77~1.0
 */
function correlationDiscount(rhoAvg, rhoMax) {
  let discount = 1.0;
  if (rhoAvg != null) {
    if (rhoAvg >= 0.85) discount = Math.min(discount, 0.77);
    else if (rhoAvg >= 0.75) discount = Math.min(discount, 0.92);
    else if (rhoAvg >= 0.65) discount = Math.min(discount, 0.97);
  }
  if (rhoMax != null && rhoMax > 0.90) {
    discount = Math.min(discount, 0.92);
  }
  return discount;
}

/**
 * 科技票两两相关性（按 trade_date 对齐）。
 *
 * @param {object} barsMap code → daily bars (ascending)
 * @param {string[]} [pairs] optional pair list
 * @returns {{rho_avg:number|null, rho_max:number|null, discount:number, pairs:Array,
 *            sample:number, alignment:object, pair_diagnostics:Array,
 *            insufficient_sample:boolean, insufficient_pairs:Array<string>,
 *            dropped_misaligned_total:number}}
 */
function computeTechCorrelation(barsMap, pairs) {
  const pairList = pairs || TECH_CORR_PAIRS;
  const rhos = [];
  const pairDiagnostics = [];
  let droppedTotal = 0;

  pairList.forEach(([a, b]) => {
    const aligned = alignReturnSeries(barsMap && barsMap[a], barsMap && barsMap[b], DEFAULT_WINDOW);
    droppedTotal += aligned.dropped_misaligned;

    let rho = null;
    let insufficient = false;
    let reason = aligned.reason;

    if (aligned.aligned_observations < MIN_OBSERVATIONS) {
      insufficient = true;
      reason = reason || 'insufficient_sample';
    } else {
      rho = pearsonOnPairs(aligned.pairs);
      if (rho == null || Number.isNaN(rho)) {
        rho = null;
        insufficient = true;
        reason = reason || 'degenerate_series';
      } else {
        rhos.push(rho);
      }
    }

    pairDiagnostics.push({
      pair: [a, b],
      rho: round3(rho),
      aligned_observations: aligned.aligned_observations,
      dropped_misaligned: aligned.dropped_misaligned,
      latest_common_date: aligned.latest_common_date,
      coverage_ratio: aligned.coverage_ratio,
      expected_window: aligned.expected_window,
      insufficient_sample: insufficient,
      reason: reason || null
    });
  });

  const insufficientPairs = pairDiagnostics
    .filter((d) => d.insufficient_sample)
    .map((d) => d.pair.join(':'));

  const alignment = {
    mode: 'trade_date_inner_join',
    window: DEFAULT_WINDOW,
    min_observations: MIN_OBSERVATIONS,
    dropped_misaligned_total: droppedTotal
  };

  if (!rhos.length) {
    return {
      rho_avg: null,
      rho_max: null,
      discount: 1.0,
      pairs: pairList,
      sample: 0,
      alignment,
      pair_diagnostics: pairDiagnostics,
      insufficient_sample: insufficientPairs.length > 0,
      insufficient_pairs: insufficientPairs,
      dropped_misaligned_total: droppedTotal
    };
  }

  const rhoAvg = rhos.reduce((s, v) => s + v, 0) / rhos.length;
  const rhoMax = Math.max(...rhos);
  const discount = correlationDiscount(rhoAvg, rhoMax);
  return {
    rho_avg: round3(rhoAvg),
    rho_max: round3(rhoMax),
    discount,
    pairs: pairList,
    sample: rhos.length,
    alignment,
    pair_diagnostics: pairDiagnostics,
    insufficient_sample: insufficientPairs.length > 0,
    insufficient_pairs: insufficientPairs,
    dropped_misaligned_total: droppedTotal
  };
}

/** OLD 口径（按下标配对）——仅用于 replay 对照，生产不调用 */
function computeTechCorrelationLegacy(barsMap, pairs) {
  const pairList = pairs || TECH_CORR_PAIRS;
  const rhos = [];
  pairList.forEach(([a, b]) => {
    const ra = returnsFromBars(barsMap && barsMap[a]);
    const rb = returnsFromBars(barsMap && barsMap[b]);
    const rho = calcCorrelation(ra, rb, DEFAULT_WINDOW);
    if (rho != null && !Number.isNaN(rho)) rhos.push(rho);
  });
  if (!rhos.length) return { rho_avg: null, rho_max: null, discount: 1.0, sample: 0, mode: 'legacy_index_align' };
  const rhoAvg = rhos.reduce((s, v) => s + v, 0) / rhos.length;
  const rhoMax = Math.max(...rhos);
  return {
    rho_avg: round3(rhoAvg),
    rho_max: round3(rhoMax),
    discount: correlationDiscount(rhoAvg, rhoMax),
    sample: rhos.length,
    mode: 'legacy_index_align'
  };
}

function effectiveTechCap(baseCap, barsMap) {
  const base = baseCap != null ? baseCap : 65;
  const corr = computeTechCorrelation(barsMap);
  return {
    ...corr,
    base_cap: base,
    effective_cap: Math.round(base * corr.discount * 10) / 10
  };
}

/** replay 对照：OLD_CORRELATION vs NEW_DATE_ALIGNED_CORRELATION */
function compareTechCap(baseCap, barsMap) {
  const base = baseCap != null ? baseCap : 65;
  const oldCorr = computeTechCorrelationLegacy(barsMap);
  const newCorr = computeTechCorrelation(barsMap);
  return {
    base_cap: base,
    old_correlation: oldCorr,
    new_date_aligned_correlation: newCorr,
    old_effective_tech_cap: Math.round(base * oldCorr.discount * 10) / 10,
    new_effective_tech_cap: Math.round(base * newCorr.discount * 10) / 10
  };
}

module.exports = {
  TECH_CORR_PAIRS,
  DEFAULT_WINDOW,
  MIN_OBSERVATIONS,
  calcCorrelation,
  correlationDiscount,
  returnsByTradeDate,
  alignReturnSeries,
  pearsonOnPairs,
  computeTechCorrelation,
  computeTechCorrelationLegacy,
  effectiveTechCap,
  compareTechCap,
  returnsFromBars,
  closesFromBars
};
