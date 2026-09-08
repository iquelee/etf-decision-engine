/**
 * V3.7 只评不调：对着已冻结旋钮，拆还差的钱从哪来。
 * 不改 decision / constants / mild。复用全引擎回放，保证仓位路径和 124.40% 同一套。
 *
 * 运行：node scripts/eval-leftover.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const decision = require('../cloudfunctions/common/utils/decision.js');
const {
  loadCsv, decideDay, makeSlowResolver, makeCooldown,
  ETFS, START_DATE, TECH_SECTORS, INITIAL_POSITION, SINGLE_MAX, TECH_MAX
} = require('./backtest-full-engine.js');

const OUT_DIR = path.join(__dirname, 'backtest-out');
const V37 = path.join(OUT_DIR, 'full-engine-v37-add5-2026-08-22.json');

const WINDOWS = [
  { code: '159582', from: '2026-07-20', to: '2026-08-21', why: 'missed-trend：8 月浪 BUILD 偏晚' },
  { code: '518880', from: '2025-12-15', to: '2026-02-05', why: '黄金 12–1 月浪中被减' },
  { code: '513310', from: '2026-06-20', to: '2026-08-21', why: '轻量踏空：7 月浪 avgPos=0' }
];

function paused(elig) {
  if (!elig) return [];
  return Object.keys(elig).filter((k) => k !== 'overall' && (elig[k] === 'pause' || elig[k] === 'forbid'));
}

function main() {
  const barsMap = {};
  for (const etf of ETFS) barsMap[etf.code] = loadCsv(etf.code);
  const dateSet = new Set();
  for (const etf of ETFS) barsMap[etf.code].forEach((b) => dateSet.add(b.trade_date));
  const allDates = [...dateSet].sort();
  const startIdx = allDates.findIndex((d) => d >= START_DATE);
  const tradingDays = allDates.slice(Math.max(0, startIdx - 60));

  const portfolio = {
    positions: {},
    techPosition: 0, goldPosition: 0, drugPosition: 0,
    market_regime: 'range', cashRatio: 100,
    tech_position: 0, gold_position: 0, cash_ratio: 100
  };
  for (const etf of ETFS) {
    portfolio.positions[etf.code] = {
      code: etf.code, current_position: INITIAL_POSITION, target_max: SINGLE_MAX,
      max_position: SINGLE_MAX, max_strategic_position: SINGLE_MAX,
      core_position: 0, trade_position: 0
    };
  }
  const slowResolver = makeSlowResolver();
  const cooldown = makeCooldown(tradingDays);
  const pending = {};
  const paths = {};
  for (const w of WINDOWS) paths[w.code] = [];

  for (let idx = 60; idx < tradingDays.length; idx++) {
    const today = tradingDays[idx];
    for (const code of Object.keys(pending)) {
      const ord = pending[code];
      const pos = portfolio.positions[code];
      const bar = barsMap[code].find((b) => b.trade_date === today);
      const from = pos.current_position;
      const diff = ord.target - from;
      if (bar && Math.abs(diff) > 0.05) {
        pos.current_position = Math.round(ord.target * 10) / 10;
        if (diff > 0) cooldown.setBuy(code, idx, ord.add_mode);
        pos.core_position = ord.core != null ? ord.core : pos.core_position;
        pos.trade_position = ord.trade != null ? ord.trade : pos.trade_position;
      }
      if (bar) delete pending[code];
    }

    const dayResults = decideDay(barsMap, idx, portfolio, slowResolver, cooldown, tradingDays, 'F3');
    for (const { code, result, p } of dayResults) {
      const pos = portfolio.positions[code];
      const suggested = result.suggested_position != null ? result.suggested_position : pos.current_position;
      pending[code] = {
        target: suggested,
        core: result.core_position,
        trade: result.trade_position,
        action: result.final_action,
        add_mode: result.add_mode || '无'
      };
      const win = WINDOWS.find((w) => w.code === code && today >= w.from && today <= w.to);
      if (!win) continue;
      const snap = (p && p.snapshot) || {};
      const elig = result.add_eligibility || {};
      const grade = decision.gradeConsolidation(snap);
      paths[code].push({
        date: today,
        pos: pos.current_position,
        sug: suggested,
        action: result.final_action,
        w: snap.w_state || result.w_state,
        h: snap.h_state,
        v: snap.v_state,
        grade,
        pp: snap.price_position != null ? Math.round(snap.price_position * 100) / 100 : null,
        vol: snap.volume_ratio != null ? Math.round(snap.volume_ratio * 100) / 100 : null,
        hvD: !!snap.high_volume_decline,
        hvS: !!snap.high_volume_stagnation,
        pause: paused(elig),
        add_mode: result.add_mode,
        hits: (result.rule_hits || []).map((h) => (typeof h === 'string' ? h : (h.name || h.level))).slice(0, 6)
      });
    }

    portfolio.techPosition = ETFS.filter((e) => TECH_SECTORS.indexOf(e.sector) >= 0)
      .reduce((s, e) => s + (portfolio.positions[e.code].current_position || 0), 0);
    portfolio.goldPosition = portfolio.positions['518880'].current_position || 0;
    portfolio.drugPosition = portfolio.positions['159570'].current_position || 0;
    portfolio.cashRatio = Math.max(0, 100 - portfolio.techPosition - portfolio.goldPosition - portfolio.drugPosition);
    portfolio.tech_position = portfolio.techPosition;
    portfolio.gold_position = portfolio.goldPosition;
    portfolio.cash_ratio = portfolio.cashRatio;
  }

  const v37 = JSON.parse(fs.readFileSync(V37, 'utf8'));
  const monthly = Object.keys(v37.monthly).sort().map((ym) => {
    const m = v37.monthly[ym];
    return { month: ym, engine: m.engine, equal: m.equal, gap: Math.round((m.engine - m.equal) * 100) / 100 };
  });
  const loseMonths = monthly.filter((r) => r.gap < -1).sort((a, b) => a.gap - b.gap);

  const nav = v37.navSeries || [];
  const cut = Math.floor(nav.length * 0.7);
  const seg = (series) => {
    const a = series[0];
    const b = series[series.length - 1];
    return {
      start: a.date, end: b.date, days: series.length,
      engine: Math.round((b.engine / a.engine - 1) * 10000) / 100,
      equal: Math.round((b.equalWeight / a.equalWeight - 1) * 10000) / 100
    };
  };
  const train = seg(nav.slice(0, cut));
  const valid = seg(nav.slice(cut));
  train.vsEqual = Math.round((train.engine - train.equal) * 100) / 100;
  valid.vsEqual = Math.round((valid.engine - valid.equal) * 100) / 100;

  function summarize(code) {
    const rows = paths[code];
    const actions = {};
    let minPos = Infinity;
    let maxPos = -Infinity;
    const p3Days = [];
    const addDays = [];
    for (const r of rows) {
      actions[r.action] = (actions[r.action] || 0) + 1;
      minPos = Math.min(minPos, r.pos);
      maxPos = Math.max(maxPos, r.pos);
      if (r.hvD || r.hvS) p3Days.push(r.date);
      if (r.action === 'ADD' || r.action === 'BUILD') addDays.push(`${r.date} ${r.action} ${r.pos}→${r.sug}`);
    }
    return { n: rows.length, minPos, maxPos, actions, p3Days: p3Days.slice(0, 8), addDays };
  }

  const report = {
    frozen: true,
    note: '只评不调。旋钮未改。仓位路径与 full-engine-v37-add5 同一套回放。',
    engine: v37.engine,
    equalWeight: v37.equalWeight,
    cashRatio: v37.cashRatio,
    split70: { train, valid },
    loseMonths,
    windows: WINDOWS.map((w) => ({ ...w, summary: summarize(w.code), days: paths[w.code] }))
  };

  const out = path.join(OUT_DIR, 'eval-leftover-v37-2026-08-22.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2));

  console.log('════════ V3.7 只评不调 ════════');
  console.log(`全窗 引擎 ${v37.engine.totalRet}%  等权 ${v37.equalWeight.totalRet}%  现金 ${v37.cashRatio}%`);
  console.log(`前70% ${train.start}~${train.end}  引擎 ${train.engine}%  等权 ${train.equal}%  差 ${train.vsEqual}pp`);
  console.log(`后30% ${valid.start}~${valid.end}  引擎 ${valid.engine}%  等权 ${valid.equal}%  差 ${valid.vsEqual}pp`);
  console.log('跑输超过 1pp 的月份：');
  for (const r of loseMonths) console.log(`  ${r.month}  引擎 ${r.engine}%  等权 ${r.equal}%  差 ${r.gap}pp`);
  for (const w of WINDOWS) {
    const s = summarize(w.code);
    console.log(`\n── ${w.code} ${w.from}~${w.to}  ${w.why}`);
    console.log(`  仓 ${s.minPos} ~ ${s.maxPos}  动作 ${JSON.stringify(s.actions)}`);
    console.log(`  P3 日 ${s.p3Days.join(', ') || '无'}`);
    console.log(`  建/加 ${s.addDays.join(' | ') || '无'}`);
    const sample = paths[w.code].filter((r) => r.action !== 'HOLD' || r.hvD || r.hvS || r.pause.length);
    const show = sample.length ? sample : paths[w.code].slice(0, 8);
    for (const r of show.slice(0, 24)) {
      console.log(`  ${r.date}  ${r.action.padEnd(16)} 仓${r.pos}→${r.sug}  ${r.w}/${r.h}/${r.v} g=${r.grade} pp=${r.pp} vol=${r.vol} hvD=${r.hvD} hvS=${r.hvS} pause=${r.pause.join(',') || '-'} ${r.hits.join(',')}`);
    }
    if (show.length > 24) console.log(`  … 另 ${show.length - 24} 行，见 JSON`);
  }
  console.log('\n输出:', out);
}

main();
