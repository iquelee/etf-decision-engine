#!/usr/bin/env node
/**
 * V3.6.1 Safety Hardening R1 —— Portfolio Mode Replay（缺陷 #3）
 *
 * 目的：在**不改动生产**的前提下，量化回答一个问题 ——
 *   「若把 portfolio flag 打开（组合轨生效），逐日决策会变成什么样？」
 *
 * 对照两条路径：
 *   CURRENT_PATH          = 线上实际参数（不带任何 force 开关）
 *   FORCED_PORTFOLIO_PATH = CURRENT_PATH + v3_force_portfolio_track: true
 *
 * 输出逐日：
 *   final_target delta / final_action delta / single cap delta /
 *   cash floor delta / binding_constraint delta
 *
 * 数据：deliverables/etf_daily_ml_pool/<code>_qfq.csv（真实历史日线，read-only）
 * 指数代理：510300(沪深300) / 588000(科创50) / 159915(创业板指)
 *
 * 用法：node scripts/v361-r1-replay-portfolio-mode.js [--days 120] [--start YYYY-MM-DD]
 * 产物：outputs/v361-r1-replay-20260922/portfolio_mode_replay.{json,md}
 *
 * ⚠️ 本脚本**只读**：不联网、不写库、不部署、不改任何生产参数。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const U = (f) => require(path.join(REPO, 'src/common/utils', f));

const indicators = U('indicators.js');
const decisionV3 = U('decision-v3.js')();
const { applyV361ParamBundle } = U('v3-shadow.js');
const { resolveMarketEnvironment } = U('market-regime.js');
const { DEFAULT_PARAMS, TECH_SECTORS, SEMI_SECTORS } = require(path.join(REPO, 'src/common/constants.js'));
const { diagnoseV3PortfolioMode } = U('portfolio-mode.js');
const { computeCashDiagnostics } = U('portfolio-cash.js');

const CSV_DIR = path.join(REPO, 'deliverables/etf_daily_ml_pool');
const OUT_DIR = path.join(REPO, 'outputs/v361-r1-replay-20260922');

const UNIVERSE = [
  { code: '513310', name: '中韩半导体ETF(QDII)', sector: 'storage', profileType: null },
  { code: '515880', name: '通信ETF', sector: 'ai_network', profileType: null },
  { code: '159582', name: '半导体设备ETF', sector: 'semi_equip', profileType: null },
  { code: '518880', name: '黄金ETF', sector: 'gold', profileType: 'macro_driven' },
  { code: '159570', name: '港股通创新药ETF', sector: 'biotech', profileType: null }
];
const INDEX_PROXIES = [
  { code: '510300', index: '000300' },
  { code: '588000', index: '000688' },
  { code: '159915', index: '399006' }
];

function argOf(flag, dflt) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] != null ? process.argv[i + 1] : dflt;
}
const DAYS = Number(argOf('--days', 120));
const START = argOf('--start', null);

function loadCsv(code) {
  const file = path.join(CSV_DIR, `${code}_qfq.csv`);
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).map((line) => {
    const p = line.split(',');
    return {
      trade_date: p[0],
      open: Number(p[1]),
      high: Number(p[2]),
      low: Number(p[3]),
      close: Number(p[4]),
      volume: Number(p[5]),
      amount: p[6] != null && p[6] !== '' ? Number(p[6]) : null
    };
  }).filter((b) => b.trade_date && Number.isFinite(b.close) && Number.isFinite(b.high) && Number.isFinite(b.low));
}

function round1(n) { return Math.round(n * 10) / 10; }

/* ---------- 载入 ---------- */
const barsByCode = {};
const missing = [];
UNIVERSE.forEach((u) => {
  const b = loadCsv(u.code);
  if (!b || b.length < 80) missing.push(u.code);
  barsByCode[u.code] = b || [];
});
if (missing.length) {
  console.error(`[FAIL] 缺少足够历史数据：${missing.join(', ')}`);
  process.exit(2);
}
const indexBars = {};
INDEX_PROXIES.forEach((p) => { indexBars[p.code] = loadCsv(p.code) || []; });

/* ---------- 公共交易日轴（5 只都有数据的日期，取最后 N 天） ---------- */
function commonDates() {
  let acc = null;
  UNIVERSE.forEach((u) => {
    const s = new Set(barsByCode[u.code].map((b) => b.trade_date));
    acc = acc == null ? s : new Set([...acc].filter((d) => s.has(d)));
  });
  const arr = [...acc].sort();
  return arr;
}
let axis = commonDates();
if (START) axis = axis.filter((d) => d >= START);
axis = axis.slice(-DAYS);
if (!axis.length) { console.error('[FAIL] 无可用公共交易日'); process.exit(2); }

/* ---------- 参数 ---------- */
const CURRENT_PARAMS = applyV361ParamBundle({ ...DEFAULT_PARAMS });
const FORCED_PARAMS = applyV361ParamBundle({ ...DEFAULT_PARAMS, v3_force_portfolio_track: true });

const SNAPSHOT_PARAMS = { ...DEFAULT_PARAMS };

/* ---------- 辅助 ---------- */
function regimeFor(d) {
  const indexWStates = INDEX_PROXIES.map((p) => {
    const bars = indexBars[p.code].filter((b) => b.trade_date <= d);
    if (bars.length < 40) return null;
    const weekly = indicators.buildWeekly(bars);
    if (!weekly || weekly.length < 10) return null;
    return indicators.detectWState(weekly, {}).state;
  }).filter(Boolean);
  if (indexWStates.length < 3) return { market_regime: 'range', market_factor: null, indexWStates };
  const env = resolveMarketEnvironment({ indexWStates, etfWStates: [] });
  return { market_regime: env.market_regime, market_factor: env.market_factor, indexWStates };
}

function buildPortfolio(book, regime) {
  let tech = 0; let semi = 0; let gold = 0; let drug = 0; let total = 0;
  UNIVERSE.forEach((u) => {
    const p = book[u.code] || 0;
    total += p;
    if (TECH_SECTORS.indexOf(u.sector) >= 0) tech += p;
    if (SEMI_SECTORS.indexOf(u.sector) >= 0) semi += p;
    if (u.sector === 'gold') gold += p;
    if (u.sector === 'biotech') drug += p;
  });
  const cash = computeCashDiagnostics(total);
  const port = {
    tech_position: tech,
    semi_position: semi,
    gold_position: gold,
    drug_position: drug,
    cash_ratio: cash.cash_ratio,
    cash_ratio_raw: cash.cash_ratio_raw,
    leverage_excess: cash.leverage_excess,
    overbooked: cash.overbooked,
    market_regime: regime.market_regime,
    market_factor: regime.market_factor,
    total_position: total,
    global_signals: []
  };
  return port;
}

function runOne(u, snapshot, bars, book, params, regime, stageState, shockState, slowBreak) {
  const portfolio = buildPortfolio(book, regime);
  const positions = { code: u.code, current_position: book[u.code] || 0, target_std: 0 };
  const etf = { code: u.code, name: u.name, sector: u.sector, target_position: 0, max_position: 30 };
  const res = decisionV3.runDecision(etf, snapshot, positions, params, {
    fundamental: { f_state: 'F3', f_score: 15, detail: {} },
    risk: { risk_flag: 'NORMAL', risk_override: false, events: [] },
    portfolio,
    cooldownDays: 0,
    sectorRemainingLimit: null,
    trendStageState: stageState,
    shockState,
    recentSlowBreakScores: slowBreak,
    bars,
    expectedEtfCount: UNIVERSE.length
  });
  return { res, portfolio };
}

/* ---------- 主循环 ---------- */
const rows = [];
const currentBook = {};
const forcedBook = {};
const currentState = {};
const forcedState = {};
const currentSlow = {};
const forcedSlow = {};

axis.forEach((d, idx) => {
  const regime = regimeFor(d);
  const dayRow = {
    trade_date: d,
    market_regime: regime.market_regime,
    index_w_states: regime.indexWStates,
    codes: {}
  };

  UNIVERSE.forEach((u) => {
    const bars = barsByCode[u.code].filter((b) => b.trade_date <= d);
    const snapshot = indicators.computeSnapshot(bars, SNAPSHOT_PARAMS, { code: u.code, calc_date: d });

    const cur = runOne(u, snapshot, bars, currentBook, CURRENT_PARAMS, regime,
      currentState[u.code], currentState[`${u.code}__shock`], currentSlow[u.code] || []);
    const frc = runOne(u, snapshot, bars, forcedBook, FORCED_PARAMS, regime,
      forcedState[u.code], forcedState[`${u.code}__shock`], forcedSlow[u.code] || []);

    const c = cur.res;
    const f = frc.res;

    const cashFloorCur = cur.res.factor_breakdown && cur.res.factor_breakdown.cash_floor_max != null
      ? cur.res.factor_breakdown.cash_floor_max : null;
    const cashFloorFrc = f.factor_breakdown && f.factor_breakdown.cash_floor_max != null
      ? f.factor_breakdown.cash_floor_max : null;

    dayRow.codes[u.code] = {
      final_target_current: c.final_target,
      final_target_forced: f.final_target,
      final_target_delta: round1((f.final_target || 0) - (c.final_target || 0)),
      final_action_current: c.final_action,
      final_action_forced: f.final_action,
      final_action_delta: c.final_action === f.final_action ? null : `${c.final_action}->${f.final_action}`,
      single_cap_current: c.max_position,
      single_cap_forced: f.max_position,
      single_cap_delta: round1((f.max_position || 0) - (c.max_position || 0)),
      cash_floor_current: cashFloorCur,
      cash_floor_forced: cashFloorFrc,
      cash_floor_delta: (cashFloorCur == null || cashFloorFrc == null) ? null : round1(cashFloorFrc - cashFloorCur),
      binding_constraint_current: c.binding_constraint,
      binding_constraint_forced: f.binding_constraint,
      binding_constraint_delta: c.binding_constraint === f.binding_constraint
        ? null : `${c.binding_constraint}->${f.binding_constraint}`,
      engine_path_current: c.engine_path,
      engine_path_forced: f.engine_path,
      trend_stage_current: c.trend_stage_primary,
      trend_stage_forced: f.trend_stage_primary
    };

    // 滚动账面
    currentBook[u.code] = c.suggested_position != null ? c.suggested_position : (currentBook[u.code] || 0);
    forcedBook[u.code] = f.suggested_position != null ? f.suggested_position : (forcedBook[u.code] || 0);
    currentState[u.code] = c.trend_stage_state;
    forcedState[u.code] = f.trend_stage_state;
    currentState[`${u.code}__shock`] = c.shock_state;
    forcedState[`${u.code}__shock`] = f.shock_state;
    const swing = bars.length >= 12 ? require(path.join(REPO, 'src/common/utils/swing-structure.js')).swingHighLow(bars) : null;
    if (swing) {
      currentSlow[u.code] = require(path.join(REPO, 'src/common/utils/v3-shadow.js'))
        .appendSlowBreakHistory(currentSlow[u.code] || [], c.slow_break_score, swing);
      forcedSlow[u.code] = require(path.join(REPO, 'src/common/utils/v3-shadow.js'))
        .appendSlowBreakHistory(forcedSlow[u.code] || [], f.slow_break_score, swing);
    }
  });

  rows.push(dayRow);
});

/* ---------- 汇总 ---------- */
const summary = {
  generated_at: new Date().toISOString(),
  days: rows.length,
  from: rows.length ? rows[0].trade_date : null,
  to: rows.length ? rows[rows.length - 1].trade_date : null,
  universe: UNIVERSE.map((u) => u.code),
  current_path: 'DEFAULT_PARAMS + applyV361ParamBundle（无 force 开关）',
  forced_path: 'DEFAULT_PARAMS + applyV361ParamBundle + v3_force_portfolio_track=true',
  per_code: {},
  engine_path_switch_days: 0,
  regime_divergence_days: 0
};

UNIVERSE.forEach((u) => {
  const cells = rows.map((r) => r.codes[u.code]);
  const deltas = cells.map((c) => c.final_target_delta);
  const nonZero = deltas.filter((v) => v !== 0);
  const acts = cells.filter((c) => c.final_action_delta);
  const binding = cells.filter((c) => c.binding_constraint_delta);
  const engineSw = cells.filter((c) => c.engine_path_current !== c.engine_path_forced);
  summary.per_code[u.code] = {
    target_delta_nonzero_days: nonZero.length,
    target_delta_max_abs: nonZero.length ? Math.max(...nonZero.map(Math.abs)) : 0,
    target_delta_mean: deltas.length ? round1(deltas.reduce((s, v) => s + v, 0) / deltas.length) : 0,
    action_delta_days: acts.length,
    action_delta_samples: acts.slice(0, 5).map((c) => c.final_action_delta),
    single_cap_delta_values: [...new Set(cells.map((c) => c.single_cap_delta))],
    cash_floor_delta_days: cells.filter((c) => c.cash_floor_delta != null && c.cash_floor_delta !== 0).length,
    binding_constraint_delta_days: binding.length,
    binding_constraint_samples: binding.slice(0, 5).map((c) => c.binding_constraint_delta),
    engine_path_switch_days: engineSw.length,
    engine_path_current_seen: [...new Set(cells.map((c) => c.engine_path_current))],
    engine_path_forced_seen: [...new Set(cells.map((c) => c.engine_path_forced))]
  };
  if (engineSw.length) summary.engine_path_switch_days += engineSw.length;
});

// 组合轨诊断（线上语义）：portfolio 对象不含 multi_etf / etf_count ⇒ 恒为单票轨
const diagCurrent = diagnoseV3PortfolioMode({ cash_ratio: 0, tech_position: 0 }, CURRENT_PARAMS, UNIVERSE.length);
summary.portfolio_mode_diagnostic_current_path = diagCurrent;

/* ---------- 落盘 ---------- */
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'portfolio_mode_replay.json'),
  JSON.stringify({ summary, rows }, null, 1), 'utf8');

const lines = [];
lines.push('# V3.6.1 R1 — Portfolio Mode Replay（CURRENT_PATH vs FORCED_PORTFOLIO_PATH）');
lines.push('');
lines.push(`- 生成时间：${summary.generated_at}`);
lines.push(`- 区间：${summary.from} ~ ${summary.to}（${summary.days} 个公共交易日）`);
lines.push(`- universe：${summary.universe.join(', ')}`);
lines.push(`- CURRENT_PATH：${summary.current_path}`);
lines.push(`- FORCED_PORTFOLIO_PATH：${summary.forced_path}`);
lines.push('');
lines.push('## 组合轨诊断（CURRENT_PATH）');
lines.push('');
lines.push('```');
lines.push(JSON.stringify(diagCurrent, null, 1));
lines.push('```');
lines.push('');
lines.push('## 逐票差异汇总');
lines.push('');
lines.push('| code | targetΔ≠0 天数 | max|Δtarget| | mean Δtarget | actionΔ 天数 | single cap Δ 取值 | cash floorΔ 天数 | bindingΔ 天数 | engine_path 切换天数 |');
lines.push('|---|---|---|---|---|---|---|---|---|');
UNIVERSE.forEach((u) => {
  const s = summary.per_code[u.code];
  lines.push(`| ${u.code} | ${s.target_delta_nonzero_days} | ${s.target_delta_max_abs} | ${s.target_delta_mean} `
    + `| ${s.action_delta_days} | ${JSON.stringify(s.single_cap_delta_values)} | ${s.cash_floor_delta_days} `
    + `| ${s.binding_constraint_delta_days} | ${s.engine_path_switch_days} |`);
});
lines.push('');
lines.push('## 引擎路径（engine_path）对照');
lines.push('');
UNIVERSE.forEach((u) => {
  const s = summary.per_code[u.code];
  lines.push(`- ${u.code}：CURRENT = ${JSON.stringify(s.engine_path_current_seen)} → FORCED = ${JSON.stringify(s.engine_path_forced_seen)}`);
});
lines.push('');
lines.push('## 前 10 个有差异的交易日（逐票明细）');
lines.push('');
lines.push('| date | code | target cur→forced | action | binding cur→forced | engine cur→forced |');
lines.push('|---|---|---|---|---|---|');
let shown = 0;
for (const r of rows) {
  if (shown >= 10) break;
  const hit = UNIVERSE.map((u) => ({ u, c: r.codes[u.code] }))
    .find((x) => x.c.final_target_delta !== 0 || x.c.final_action_delta || x.c.binding_constraint_delta);
  if (!hit) continue;
  const c = hit.c;
  lines.push(`| ${r.trade_date} | ${hit.u.code} | ${c.final_target_current}→${c.final_target_forced} `
    + `| ${c.final_action_delta || '—'} | ${c.binding_constraint_delta || '—'} `
    + `| ${c.engine_path_current}→${c.engine_path_forced} |`);
  shown += 1;
}
lines.push('');
lines.push('> 说明：本 Replay 只做**只读对照**。在 Replay 报告通过并单独 PR 晋升之前，');
lines.push('> 不允许让新的 portfolio flag 驱动生产结果（`getPortfolioSummary` 刻意不返回 `multi_etf` / `etf_count`）。');
fs.writeFileSync(path.join(OUT_DIR, 'portfolio_mode_replay.md'), `${lines.join('\n')}\n`, 'utf8');

console.log(`[OK] ${rows.length} 天 × ${UNIVERSE.length} 票`);
console.log(JSON.stringify(summary.per_code, null, 1));
console.log(`[OK] 产物：${path.relative(REPO, path.join(OUT_DIR, 'portfolio_mode_replay.md'))}`);
