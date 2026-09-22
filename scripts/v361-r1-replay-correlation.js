#!/usr/bin/env node
/**
 * V3.6.1 Safety Hardening R1 —— TechCorrelation Replay（缺陷 #4）
 *
 * 目的：在**不改动线上 tech_sector_max** 的前提下，逐日对照：
 *   OLD_CORRELATION              （旧口径：按 returns 数组下标尾部配对）
 *   NEW_DATE_ALIGNED_CORRELATION （新口径：按 trade_date INNER JOIN + 跨度一致）
 *   OLD_EFFECTIVE_TECH_CAP
 *   NEW_EFFECTIVE_TECH_CAP
 *
 * 并输出对齐诊断（aligned_observations / latest_common_date / coverage_ratio /
 * dropped_misaligned），把「样本不足」显式暴露出来，不隐藏。
 *
 * 数据：deliverables/etf_daily_ml_pool/<code>_qfq.csv（真实历史日线，read-only）
 * 用法：node scripts/v361-r1-replay-correlation.js [--days 120]
 * 产物：outputs/v361-r1-replay-20260922/correlation_replay.{json,md}
 *
 * ⚠️ 本脚本**只读**：不联网、不写库、不部署、不改任何线上参数。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const U = (f) => require(path.join(REPO, 'src/common/utils', f));
const { compareTechCap, DEFAULT_WINDOW } = U('correlation.js');
const { TECH_CORR_PAIRS } = U('correlation.js');
const { DEFAULT_PARAMS } = require(path.join(REPO, 'src/common/constants.js'));

const CSV_DIR = path.join(REPO, 'deliverables/etf_daily_ml_pool');
const OUT_DIR = path.join(REPO, 'outputs/v361-r1-replay-20260922');
const BASE_TECH_CAP = DEFAULT_PARAMS.tech_sector_max != null ? DEFAULT_PARAMS.tech_sector_max : 65;

function argOf(flag, dflt) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] != null ? process.argv[i + 1] : dflt;
}
const DAYS = Number(argOf('--days', 120));

const TECH_CODES = ['513310', '159582', '515880'];

function loadCsv(code) {
  const file = path.join(CSV_DIR, `${code}_qfq.csv`);
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).map((line) => {
    const p = line.split(',');
    return {
      trade_date: p[0], high: Number(p[2]), low: Number(p[3]), close: Number(p[4])
    };
  }).filter((b) => b.trade_date && Number.isFinite(b.close));
}

const barsByCode = {};
const missing = [];
TECH_CODES.forEach((c) => {
  const b = loadCsv(c);
  if (!b || b.length < 120) missing.push(c);
  barsByCode[c] = b || [];
});
if (missing.length) { console.error(`[FAIL] 缺少科技票历史数据：${missing.join(', ')}`); process.exit(2); }

// 公共交易日轴
// 公共交易日轴在「日历分歧扫描」之后统一计算（见下方 fullCommonAxis）

const rows = [];

/** 在给定交易日轴上逐日对照 OLD / NEW 口径 */
function replayOver(axisDays) {
  const out = [];
  axisDays.forEach((d) => {
    const barsMap = {};
    TECH_CODES.forEach((c) => { barsMap[c] = barsByCode[c].filter((b) => b.trade_date <= d); });

    const cmp = compareTechCap(BASE_TECH_CAP, barsMap);
    const pairs = cmp.new_date_aligned_correlation.pair_diagnostics.map((p) => ({
      pair: p.pair.join('/'),
      rho_new: p.rho,
      aligned_observations: p.aligned_observations,
      dropped_misaligned: p.dropped_misaligned,
      latest_common_date: p.latest_common_date,
      coverage_ratio: p.coverage_ratio,
      insufficient_sample: p.insufficient_sample,
      reason: p.reason
    }));

    out.push({
      trade_date: d,
      old_rho_avg: cmp.old_correlation.rho_avg,
      new_rho_avg: cmp.new_date_aligned_correlation.rho_avg,
      old_discount: cmp.old_correlation.discount,
      new_discount: cmp.new_date_aligned_correlation.discount,
      old_effective_tech_cap: cmp.old_effective_tech_cap,
      new_effective_tech_cap: cmp.new_effective_tech_cap,
      effective_cap_delta: Math.round((cmp.new_effective_tech_cap - cmp.old_effective_tech_cap) * 10) / 10,
      new_insufficient_sample: cmp.new_date_aligned_correlation.insufficient_sample,
      new_dropped_misaligned_total: cmp.new_date_aligned_correlation.dropped_misaligned_total,
      new_min_coverage_ratio: pairs.length ? Math.min(...pairs.map((p) => p.coverage_ratio)) : null,
      pairs
    });
  });
  return out;
}

/** 给定逐日结果 → 汇总 */
function summarize(days) {
  const capDelta = days.map((r) => r.effective_cap_delta);
  const rhoDelta = days.map((r) => (r.old_rho_avg != null && r.new_rho_avg != null)
    ? Math.round((r.new_rho_avg - r.old_rho_avg) * 1000) / 1000 : null).filter((v) => v != null);
  return {
    days: days.length,
    from: days[0] ? days[0].trade_date : null,
    to: days[days.length - 1] ? days[days.length - 1].trade_date : null,
    cap_delta_nonzero_days: capDelta.filter((v) => v !== 0).length,
    cap_delta_max_abs: capDelta.length ? Math.max(...capDelta.map(Math.abs)) : 0,
    cap_delta_mean: capDelta.length ? Math.round((capDelta.reduce((s, v) => s + v, 0) / capDelta.length) * 100) / 100 : 0,
    rho_delta_nonzero_days: rhoDelta.filter((v) => v !== 0).length,
    rho_delta_max_abs: rhoDelta.length ? Math.max(...rhoDelta.map(Math.abs)) : 0,
    insufficient_sample_days: days.filter((r) => r.new_insufficient_sample).length,
    dropped_misaligned_days: days.filter((r) => r.new_dropped_misaligned_total > 0).length,
    dropped_misaligned_total: days.reduce((s, r) => s + r.new_dropped_misaligned_total, 0),
    min_coverage_ratio_seen: days.length ? Math.min(...days.map((r) => r.new_min_coverage_ratio)) : null
  };
}

/* ---------- 1) 交易日历分歧扫描（真实缺日证据） ---------- */
const calendars = {};
TECH_CODES.forEach((c) => { calendars[c] = new Set(barsByCode[c].map((b) => b.trade_date)); });
const allDates = [...new Set(TECH_CODES.reduce((acc, c) => acc.concat([...calendars[c]]), []))].sort();
const divergenceByDate = allDates.map((d) => ({
  trade_date: d,
  missing: TECH_CODES.filter((c) => !calendars[c].has(d))
})).filter((x) => x.missing.length > 0);

const firstAllPresent = allDates.find((d) => TECH_CODES.every((c) => calendars[c].has(d)));
const calendarSummary = {
  union_trading_days: allDates.length,
  first_date_all_three_present: firstAllPresent || null,
  diverging_days_total: divergenceByDate.length,
  diverging_before_all_present: firstAllPresent
    ? divergenceByDate.filter((x) => x.trade_date < firstAllPresent).length : divergenceByDate.length,
  diverging_after_all_present: firstAllPresent
    ? divergenceByDate.filter((x) => x.trade_date >= firstAllPresent).length : 0,
  diverging_samples_after_all_present: (firstAllPresent
    ? divergenceByDate.filter((x) => x.trade_date >= firstAllPresent) : []
  ).slice(0, 10)
};

/* ---------- 2) 全历史共同轴 + 最近 N 天 ---------- */
const fullCommonAxis = allDates.filter((d) => TECH_CODES.every((c) => calendars[c].has(d)));
const fullRows = replayOver(fullCommonAxis);
const recentRows = fullRows.slice(-DAYS);
rows.push(...recentRows);

const summary = Object.assign({
  generated_at: new Date().toISOString(),
  base_tech_cap: BASE_TECH_CAP,
  window: DEFAULT_WINDOW,
  pairs: TECH_CORR_PAIRS.map((p) => p.join('/')),
  calendar_divergence: calendarSummary,
  full_history: summarize(fullRows),
  last_n_days: Object.assign({ n: DAYS }, summarize(recentRows)),
  // 折扣分档边界（correlationDiscount）：0.65 / 0.75 / 0.85
  // ρ 若贴近边界，错位哪怕 0.003 也可能跨档 ⇒ cap 突变
  band_boundary_proximity: {
    threshold_0_65: recentRows.filter((r) => r.new_rho_avg != null && Math.abs(r.new_rho_avg - 0.65) <= 0.02).length,
    threshold_0_75: recentRows.filter((r) => r.new_rho_avg != null && Math.abs(r.new_rho_avg - 0.75) <= 0.02).length,
    threshold_0_85: recentRows.filter((r) => r.new_rho_avg != null && Math.abs(r.new_rho_avg - 0.85) <= 0.02).length,
    note: '落在边界 ±0.02 内的天数越多，越容易被「下标错位」推过档位'
  }
}, {});

/* ---------- 3) 真实缺日压力测试（若历史上真出现过分歧） ---------- */
if (divergenceByDate.length) {
  const stressRow = (() => {
    // 取「分歧日」中最早的、且窗口内三票都有足够历史的日期
    const cand = divergenceByDate.find((x) => x.trade_date >= '2024-10-01');
    return cand || divergenceByDate[divergenceByDate.length - 1];
  })();
  const barsMap = {};
  TECH_CODES.forEach((c) => { barsMap[c] = barsByCode[c].filter((b) => b.trade_date <= stressRow.trade_date); });
  const cmp = compareTechCap(BASE_TECH_CAP, barsMap);
  summary.real_gap_stress = {
    trade_date: stressRow.trade_date,
    missing_codes_that_day: stressRow.missing,
    old_rho_avg: cmp.old_correlation.rho_avg,
    new_rho_avg: cmp.new_date_aligned_correlation.rho_avg,
    old_discount: cmp.old_correlation.discount,
    new_discount: cmp.new_date_aligned_correlation.discount,
    old_effective_tech_cap: cmp.old_effective_tech_cap,
    new_effective_tech_cap: cmp.new_effective_tech_cap,
    pair_diagnostics: cmp.new_date_aligned_correlation.pair_diagnostics
  };
}

/* ---------- 4) 合成缺日压力测试（真实数据 + 注入一个中间缺日） ---------- */
// 真实数据里三票在「三票齐备」之后从无中间缺日，故缺陷不触发。
// 这里在同一条真实序列上**注入**一个中间缺日，验证「若真发生停牌/抓取缺口，旧口径会错位」。
(() => {
  const target = fullCommonAxis[fullCommonAxis.length - 1];
  const cutIdx = 60; // 窗口内、非首非尾的一个交易日
  const victim = TECH_CODES[1]; // 159582
  const victimBarsFull = barsByCode[victim].filter((b) => b.trade_date <= target);
  const victimDates = victimBarsFull.map((b) => b.trade_date);
  const dropDate = victimDates[victimDates.length - 1 - cutIdx];

  const barsMap = {};
  TECH_CODES.forEach((c) => {
    let bars = barsByCode[c].filter((b) => b.trade_date <= target);
    if (c === victim) bars = bars.filter((b) => b.trade_date !== dropDate);
    barsMap[c] = bars;
  });
  const cmp = compareTechCap(BASE_TECH_CAP, barsMap);
  summary.synthetic_gap_stress = {
    as_of: target,
    injected_missing_date: dropDate,
    injected_into: victim,
    old_rho_avg: cmp.old_correlation.rho_avg,
    new_rho_avg: cmp.new_date_aligned_correlation.rho_avg,
    old_discount: cmp.old_correlation.discount,
    new_discount: cmp.new_date_aligned_correlation.discount,
    old_effective_tech_cap: cmp.old_effective_tech_cap,
    new_effective_tech_cap: cmp.new_effective_tech_cap,
    cap_delta: Math.round((cmp.new_effective_tech_cap - cmp.old_effective_tech_cap) * 10) / 10,
    pair_diagnostics: cmp.new_date_aligned_correlation.pair_diagnostics
  };
})();

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'correlation_replay.json'),
  JSON.stringify({ summary, rows }, null, 1), 'utf8');

const lines = [];
const cmpTable = (s, title) => {
  lines.push(`### ${title}`);
  lines.push('');
  lines.push(`区间：${s.from} ~ ${s.to}（${s.days} 个交易日）`);
  lines.push('');
  lines.push('| 指标 | 值 |');
  lines.push('|---|---|');
  lines.push(`| 有效 tech cap 发生变化的天数 | ${s.cap_delta_nonzero_days} / ${s.days} |`);
  lines.push(`| 有效 tech cap 最大绝对差 | ${s.cap_delta_max_abs} pp |`);
  lines.push(`| 有效 tech cap 平均差（new − old） | ${s.cap_delta_mean} pp |`);
  lines.push(`| ρ_avg 发生变化的天数 | ${s.rho_delta_nonzero_days} / ${s.days} |`);
  lines.push(`| ρ_avg 最大绝对差 | ${s.rho_delta_max_abs} |`);
  lines.push(`| 新口径判为样本不足的天数 | ${s.insufficient_sample_days} |`);
  lines.push(`| 存在「跨度不一致被丢弃」的天数 | ${s.dropped_misaligned_days} |`);
  lines.push(`| 被丢弃观测点合计 | ${s.dropped_misaligned_total} |`);
  lines.push(`| 最小 coverage_ratio | ${s.min_coverage_ratio_seen} |`);
  lines.push('');
};

lines.push('# V3.6.1 R1 — TechCorrelation Replay（OLD vs NEW_DATE_ALIGNED）');
lines.push('');
lines.push(`- 生成时间：${summary.generated_at}`);
lines.push(`- base tech cap（线上值，**未改动**）：${summary.base_tech_cap}%`);
lines.push(`- 相关系数对：${summary.pairs.join(' · ')}；窗口 ${summary.window}`);
lines.push('');
lines.push('## 1. 交易日历分歧扫描（真实数据）');
lines.push('');
lines.push('| 指标 | 值 |');
lines.push('|---|---|');
lines.push(`| 三票交易日并集天数 | ${calendarSummary.union_trading_days} |`);
lines.push(`| 首次三票同时有数据的日期 | ${calendarSummary.first_date_all_three_present} |`);
lines.push(`| 存在「至少一票缺日」的天数（全历史） | ${calendarSummary.diverging_days_total} |`);
lines.push(`| 其中发生在「三票齐备」之前 | ${calendarSummary.diverging_before_all_present} |`);
lines.push(`| 其中发生在「三票齐备」之后 | ${calendarSummary.diverging_after_all_present} |`);
lines.push('');
if (calendarSummary.diverging_samples_after_all_present.length) {
  lines.push('三票齐备后仍出现的分歧样本：');
  lines.push('');
  lines.push('| date | 当日缺数据的票 |');
  lines.push('|---|---|');
  calendarSummary.diverging_samples_after_all_present.forEach((x) => {
    lines.push(`| ${x.trade_date} | ${x.missing.join(', ')} |`);
  });
  lines.push('');
}
lines.push('## 2. 口径差异（按共同交易日轴）');
lines.push('');
cmpTable(summary.full_history, '2.1 全历史共同交易日轴');
cmpTable(summary.last_n_days, `2.2 最近 ${summary.last_n_days.n} 个交易日`);
lines.push('### 2.3 折扣分档边界贴近度（最近区间）');
lines.push('');
lines.push('| 边界 | 落在 ±0.02 内的天数 |');
lines.push('|---|---|');
lines.push(`| ρ_avg = 0.65 | ${summary.band_boundary_proximity.threshold_0_65} |`);
lines.push(`| ρ_avg = 0.75 | ${summary.band_boundary_proximity.threshold_0_75} |`);
lines.push(`| ρ_avg = 0.85 | ${summary.band_boundary_proximity.threshold_0_85} |`);
lines.push('');
lines.push(`> ${summary.band_boundary_proximity.note}`);
lines.push('');
if (summary.real_gap_stress) {
  const g = summary.real_gap_stress;
  lines.push('## 3. 真实「缺日」压力测试');
  lines.push('');
  lines.push(`取历史上真实出现缺日的交易日 **${g.trade_date}**（当日缺：${g.missing_codes_that_day.join(', ') || '无'}）做定点对照：`);
  lines.push('');
  lines.push('| 口径 | ρ_avg | discount | effective tech cap |');
  lines.push('|---|---|---|---|');
  lines.push(`| OLD（按下标配对） | ${g.old_rho_avg} | ${g.old_discount} | ${g.old_effective_tech_cap} |`);
  lines.push(`| NEW（按 trade_date 对齐） | ${g.new_rho_avg} | ${g.new_discount} | ${g.new_effective_tech_cap} |`);
  lines.push('');
  lines.push('逐对诊断（NEW）：');
  lines.push('');
  lines.push('| pair | ρ | aligned_obs | dropped_misaligned | latest_common_date | coverage_ratio | 样本不足 |');
  lines.push('|---|---|---|---|---|---|---|');
  g.pair_diagnostics.forEach((p) => {
    lines.push(`| ${p.pair} | ${p.rho} | ${p.aligned_observations} | ${p.dropped_misaligned} `
      + `| ${p.latest_common_date} | ${p.coverage_ratio} | ${p.insufficient_sample ? 'YES' : 'no'} |`);
  });
  lines.push('');
}
if (summary.synthetic_gap_stress) {
  const g = summary.synthetic_gap_stress;
  lines.push('## 4. 合成缺日压力测试（真实序列 + 注入一个中间缺日）');
  lines.push('');
  lines.push(`在 ${g.as_of} 的窗口内，把 **${g.injected_into}** 的 **${g.injected_missing_date}** 这一天删掉`);
  lines.push('（模拟停牌 / 抓取缺口 / 新标的上市日不同），再看两种口径：');
  lines.push('');
  lines.push('| 口径 | ρ_avg | discount | effective tech cap |');
  lines.push('|---|---|---|---|');
  lines.push(`| OLD（按下标配对） | ${g.old_rho_avg} | ${g.old_discount} | ${g.old_effective_tech_cap} |`);
  lines.push(`| NEW（按 trade_date 对齐） | ${g.new_rho_avg} | ${g.new_discount} | ${g.new_effective_tech_cap} |`);
  lines.push('');
  lines.push(`→ 有效 tech cap 差 **${g.cap_delta} pp**。这正是缺陷在真实故障场景下的实际后果。`);
  lines.push('');
  lines.push('逐对诊断（NEW）：');
  lines.push('');
  lines.push('| pair | ρ | aligned_obs | dropped_misaligned | latest_common_date | coverage_ratio | 样本不足 |');
  lines.push('|---|---|---|---|---|---|---|');
  g.pair_diagnostics.forEach((p) => {
    lines.push(`| ${p.pair} | ${p.rho} | ${p.aligned_observations} | ${p.dropped_misaligned} `
      + `| ${p.latest_common_date} | ${p.coverage_ratio} | ${p.insufficient_sample ? 'YES' : 'no'} |`);
  });
  lines.push('');
}
lines.push('## 5. 最近 15 个交易日明细');
lines.push('');
lines.push('| date | old ρ_avg | new ρ_avg | old cap | new cap | Δcap | dropped | min coverage | 样本不足 |');
lines.push('|---|---|---|---|---|---|---|---|---|');
rows.slice(-15).forEach((r) => {
  lines.push(`| ${r.trade_date} | ${r.old_rho_avg} | ${r.new_rho_avg} | ${r.old_effective_tech_cap} `
    + `| ${r.new_effective_tech_cap} | ${r.effective_cap_delta} | ${r.new_dropped_misaligned_total} `
    + `| ${r.new_min_coverage_ratio} | ${r.new_insufficient_sample ? 'YES' : 'no'} |`);
});
lines.push('');
lines.push('> 说明：本 Replay 只做**只读对照**。线上 `tech_sector_max` 未被本包修改；');
lines.push('> 是否让新口径驱动生产，需在 Replay 通过后单独放行。');
fs.writeFileSync(path.join(OUT_DIR, 'correlation_replay.md'), `${lines.join('\n')}\n`, 'utf8');

console.log(JSON.stringify(summary, null, 1));
console.log(`[OK] 产物：${path.relative(REPO, path.join(OUT_DIR, 'correlation_replay.md'))}`);
