/**
 * V3.6.5 Production Integrity —— P-2：fundamental 日期 provenance
 *
 * 背景（V3.6.5 只读审计 §14 / P-2）：
 *   `computeFundamentalState()` 写入 `fundamental_state` 的行**不含任何数据日期**
 *   （只有 `updated_at = new Date()`），且 `detail` 里也没有日期；
 *   真正的数据日期只存在于 `fundamental_series.data_date`。
 *   ⇒ 「基本面数据是哪一天的」在当前生产结果中**无法回答**。
 *
 * ⛔ 本模块的硬约束（V3.6.5 裁定）：
 *   - **不把 `updated_at` 当数据日期**（它只是计算/写入时刻）；
 *   - **不用 `max(data_date)` 作为唯一 freshness 真相**；
 *   - **只记录当前本来就被评分器选中的那些行** —— row selection / signal / score /
 *     f_state **一律不变**。因此这里复用 `fundamental.js::pickLatestSeries`，
 *     而不是另写一套选择逻辑（否则就会出现「provenance 说的行 ≠ 实际参与评分的行」）。
 *   - fundamental 是 **optional** 源：过期产生 `DEGRADED`，
 *     **不得**单独因为 fundamental 较旧就把一个完整的生产 run BLOCK。
 *
 * 纯函数模块：无网络、无数据库。
 */
'use strict';

const { pickLatestSeries } = require('./fundamental.js');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 各频率的允许 staleness —— **仅用于 provenance 诊断**，⛔ 不参与任何决策计算。
 * （表值需在 V3.6.5 实施评审中裁定；当前取「明显宽松」的安全值，宁可 DEGRADED 不可误 BLOCK。）
 */
const FUNDAMENTAL_FREQ_STALENESS = Object.freeze({
  daily: Object.freeze({ max_staleness_days: 5, unit: 'natural_days' }),
  weekly: Object.freeze({ max_staleness_days: 14, unit: 'natural_days' }),
  monthly: Object.freeze({ max_staleness_days: 60, unit: 'natural_days' }),
  quarterly: Object.freeze({ max_staleness_days: 200, unit: 'natural_days' }),
  unknown: Object.freeze({ max_staleness_days: 120, unit: 'natural_days' })
});

const FRESHNESS = Object.freeze({
  OK: 'OK',
  DEGRADED: 'DEGRADED',
  UNKNOWN: 'UNKNOWN'
});

function isDate(v) {
  return typeof v === 'string' && DATE_RE.test(v);
}

function daysBetween(a, b) {
  if (!isDate(a) || !isDate(b)) return null;
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return null;
  return Math.round((tb - ta) / 86400000);
}

function profileFor(freq) {
  const key = String(freq || '').toLowerCase();
  return FUNDAMENTAL_FREQ_STALENESS[key] || FUNDAMENTAL_FREQ_STALENESS.unknown;
}

/**
 * 选出**与评分器完全相同**的贡献行。
 *
 * 与 `cloudfunctions/runDecisionEngine/index.js::computeFundamentalState` 的对应关系：
 *   - rows 取法：该函数为每个 (code, indicator) 查 `fundamental_series`，
 *     `orderBy data_date desc, limit 40` ⇒ 调用方按同样方式备好 `seriesByIndicator`；
 *   - 选中行：本模块调用同一个 `pickLatestSeries(rows, cfg)`；
 *   - 跳过条件：`!row` 与 `weight <= 0`（顺序与评分器一致）。
 *
 * ⛔ 本函数**不**计算 signal / score，只回答「哪一行参与了」。
 *
 * @param {Array<object>} configs fundamental_config 行（含 code/indicator/weight/freq/metric_type）
 * @param {Object<string,Array<object>>} seriesByIndicator indicator → 该指标的序列行（已按 data_date desc）
 * @returns {{contributions:Array<object>, skipped:Array<{indicator:string,reason:string}>}}
 */
function selectFundamentalContributions(configs, seriesByIndicator) {
  const list = Array.isArray(configs) ? configs : [];
  const byInd = seriesByIndicator || {};
  const contributions = [];
  const skipped = [];

  list.forEach((cfg) => {
    if (!cfg || cfg.indicator == null) return;
    const rows = byInd[cfg.indicator] || [];
    const row = pickLatestSeries(rows, cfg);
    if (!row) { skipped.push({ indicator: String(cfg.indicator), reason: 'no_row' }); return; }
    const weight = Number(cfg.weight) || 0;
    if (weight <= 0) { skipped.push({ indicator: String(cfg.indicator), reason: 'zero_or_missing_weight' }); return; }

    contributions.push({
      indicator: String(cfg.indicator),
      source: row.source != null ? String(row.source) : null,
      data_date: isDate(row.data_date) ? row.data_date : null,
      frequency: cfg.freq != null ? String(cfg.freq) : 'unknown',
      weight,
      // 明确记录「日期来自 row.data_date」，并显式声明未使用 updated_at
      data_date_origin: 'fundamental_series.data_date'
    });
  });

  return { contributions, skipped };
}

/**
 * 汇总 provenance。
 *
 * @param {Array<object>} contributions selectFundamentalContributions().contributions
 * @param {object} [opts]
 *   - reference_date {string} 参照日（应传 expected/effective as_of_trade_date）；
 *     不传则只做「有没有日期」的判定，不做 staleness 判定（⛔ 绝不用 new Date()）。
 * @returns {object}
 */
function buildFundamentalProvenance(contributions, opts) {
  const o = opts || {};
  const list = Array.isArray(contributions) ? contributions : [];
  const ref = isDate(o.reference_date) ? o.reference_date : null;

  const dated = list.filter((c) => isDate(c.data_date));
  const dates = dated.map((c) => c.data_date).sort();
  const oldest = dates.length ? dates[0] : null;
  const latest = dates.length ? dates[dates.length - 1] : null;

  const perIndicator = list.map((c) => {
    const profile = profileFor(c.frequency);
    const lag = ref ? daysBetween(c.data_date, ref) : null;
    let status = FRESHNESS.UNKNOWN;
    if (!isDate(c.data_date)) status = FRESHNESS.UNKNOWN;
    else if (lag == null) status = FRESHNESS.UNKNOWN;
    else status = lag > profile.max_staleness_days ? FRESHNESS.DEGRADED : FRESHNESS.OK;
    return {
      indicator: c.indicator,
      data_date: c.data_date,
      frequency: c.frequency,
      lag_days: lag,
      max_staleness_days: profile.max_staleness_days,
      staleness_unit: profile.unit,
      status
    };
  });

  let freshness = FRESHNESS.UNKNOWN;
  if (list.length > 0) {
    const unresolved = perIndicator.filter((p) => p.status === FRESHNESS.UNKNOWN).length;
    const degraded = perIndicator.filter((p) => p.status === FRESHNESS.DEGRADED).length;
    if (unresolved === perIndicator.length) freshness = FRESHNESS.UNKNOWN;
    else if (degraded === 0 && unresolved === 0) freshness = FRESHNESS.OK;
    else freshness = FRESHNESS.DEGRADED;
  }

  return {
    contributing_inputs: list.map((c) => ({
      indicator: c.indicator,
      source: c.source,
      data_date: c.data_date,
      frequency: c.frequency,
      weight: c.weight
    })),
    contribution_count: list.length,
    oldest_contributing_date: oldest,
    latest_contributing_date: latest,
    // V3.6.5 裁定：需要单一日期时取 **oldest**（保守：不掩盖最旧的那个源）
    fundamental_as_of_date: oldest,
    oldest_vs_news_basis: 'oldest_contributing_actual_data_date',
    per_indicator_staleness: perIndicator,
    reference_date: ref,
    freshness_status: freshness,
    // fundamental 是 optional 源 ⇒ 过期只 DEGRADED，绝不单独 BLOCK 完整 run
    optional_source: true,
    blocks_run: false,
    updated_at_used_as_data_date: false
  };
}

/** 便捷组合：直接从 configs + series 得到完整 provenance */
function fundamentalProvenanceFrom(configs, seriesByIndicator, opts) {
  const sel = selectFundamentalContributions(configs, seriesByIndicator);
  return Object.assign(
    buildFundamentalProvenance(sel.contributions, opts),
    { skipped_indicators: sel.skipped }
  );
}

module.exports = {
  FUNDAMENTAL_FREQ_STALENESS,
  FRESHNESS,
  daysBetween,
  profileFor,
  selectFundamentalContributions,
  buildFundamentalProvenance,
  fundamentalProvenanceFrom
};
