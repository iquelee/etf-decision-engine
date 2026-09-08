/**
 * 涨日未满仓 · 闸门命中诊断（只评不调）
 * 运行：node scripts/diag-upday-gates.js
 *       node scripts/diag-upday-gates.js --eq-threshold=0.01
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  loadCsv, decideDay, makeSlowResolver, makeCooldown, ETFS, TECH_SECTORS
} = require('./backtest-full-engine.js');
const { intersectTradeDates } = require('./lib/universe.js');

const OUT_DIR = path.join(__dirname, 'backtest-out');
const REPORT_DIR = path.join(__dirname, '../回测报告');
const DATE = new Date().toISOString().slice(0, 10);
const GATE_KEYS = ['trend','structure','volume','fund','chase','limit','sector','risk','cooldown','regime','position'];
const GATE_LABEL = {
  trend: '趋势(W)', structure: '横盘结构', volume: '量能', fund: '基本面F', chase: '追涨',
  limit: '单票上限', sector: '赛道顶', risk: '风险', cooldown: '冷静期',
  regime: '市场regime', position: '仓位未知'
};
const WINDOWS = [
  { id: 'wf1', label: 'WF1', from: '2024-07-15', to: '2025-01-20' },
  { id: 'wf2', label: 'WF2', from: '2025-01-21', to: '2025-08-01' },
  { id: 'wf3', label: 'WF3', from: '2025-08-04', to: '2026-02-09' },
  { id: 'wf4', label: 'WF4(对照)', from: '2026-02-10', to: '2026-08-24' }
];

function argVal(name) {
  const hit = process.argv.find((a) => a.indexOf(name + '=') === 0);
  return hit ? hit.slice(name.length + 1) : null;
}
function emptyHits() {
  const o = {};
  for (const k of GATE_KEYS) o[k] = 0;
  return o;
}

function runWindow(meta, barsMap, universe, eqThreshold) {
  const allDates = intersectTradeDates(barsMap, universe);
  const startIdx = allDates.findIndex((d) => d >= meta.from);
  const tradingDays = allDates.slice(Math.max(0, startIdx - 60));
  const loopStart = tradingDays.findIndex((d) => d >= meta.from);
  const firstIdx = Math.max(60, loopStart);

  const portfolio = {
    positions: {}, techPosition: 0, goldPosition: 0, drugPosition: 0,
    market_regime: 'range', cashRatio: 100, tech_position: 0, gold_position: 0, cash_ratio: 100
  };
  for (const etf of universe) {
    portfolio.positions[etf.code] = {
      code: etf.code, current_position: 0, target_max: 30, max_position: 30,
      max_strategic_position: 30, core_position: 0, trade_position: 0
    };
  }
  const slow = makeSlowResolver();
  const cooldown = makeCooldown(tradingDays);
  const pending = {};
  const upDays = [];
  const gateHits = emptyHits();
  let etfDayObs = 0, pausedObs = 0, allowNoAdd = 0, allowAdd = 0;
  const actionCounts = {};

  for (let idx = firstIdx; idx < tradingDays.length; idx++) {
    const today = tradingDays[idx];
    if (today > meta.to) break;

    for (const code of Object.keys(pending)) {
      const ord = pending[code];
      const pos = portfolio.positions[code];
      const bar = barsMap[code].find((b) => b.trade_date === today);
      const diff = ord.target - pos.current_position;
      if (bar && Math.abs(diff) > 0.05) {
        pos.current_position = Math.round(ord.target * 10) / 10;
        if (diff > 0) cooldown.setBuy(code, idx, ord.add_mode);
        if (ord.core != null) pos.core_position = ord.core;
        if (ord.trade != null) pos.trade_position = ord.trade;
      }
      if (bar) delete pending[code];
    }

    const prevDate = tradingDays[idx - 1];
    let eqRet = 0, eqN = 0;
    for (const etf of universe) {
      const a = barsMap[etf.code].find((b) => b.trade_date === prevDate);
      const b = barsMap[etf.code].find((b) => b.trade_date === today);
      if (a && b && a.close > 0) { eqRet += b.close / a.close - 1; eqN++; }
    }
    if (eqN) eqRet /= eqN;

    const dayResults = decideDay(barsMap, idx, portfolio, slow, cooldown, tradingDays, 'F3', false, universe);
    let book = 0;
    for (const etf of universe) book += portfolio.positions[etf.code].current_position || 0;
    book = Math.round(book * 10) / 10;
    const isUp = eqRet >= eqThreshold;
    const dayRow = { date: today, eqRetPct: Math.round(eqRet * 10000) / 100, book, codes: [] };

    for (const { code, result } of dayResults) {
      const pos = portfolio.positions[code];
      pending[code] = {
        target: result.suggested_position != null ? result.suggested_position : pos.current_position,
        core: result.core_position, trade: result.trade_position,
        action: result.final_action, add_mode: result.add_mode || '无'
      };
      if (!isUp) continue;
      etfDayObs++;
      const action = result.final_action || 'HOLD';
      actionCounts[action] = (actionCounts[action] || 0) + 1;
      const elig = result.add_eligibility || {};
      const paused = [];
      for (const k of GATE_KEYS) {
        if (elig[k] === 'pause' || elig[k] === 'forbid') {
          gateHits[k]++;
          paused.push(k);
        }
      }
      if (elig.overall === 'pause' || elig.overall === 'forbid') pausedObs++;
      else if ((result.suggested_position || 0) <= (pos.current_position || 0) + 0.05) allowNoAdd++;
      else allowAdd++;
      dayRow.codes.push({
        code, action, current: pos.current_position, suggested: result.suggested_position,
        w: result.w_state, overall: elig.overall, paused
      });
    }

    portfolio.techPosition = universe.filter((e) => TECH_SECTORS.indexOf(e.sector) >= 0)
      .reduce((s, e) => s + (portfolio.positions[e.code].current_position || 0), 0);
    portfolio.tech_position = portfolio.techPosition;
    const g = portfolio.positions['518880'];
    portfolio.goldPosition = g ? g.current_position || 0 : 0;
    portfolio.gold_position = portfolio.goldPosition;
    if (isUp) upDays.push(dayRow);
  }

  const gateRank = GATE_KEYS.map((k) => ({
    gate: k, label: GATE_LABEL[k], hits: gateHits[k],
    pct: etfDayObs ? Math.round((gateHits[k] / etfDayObs) * 1000) / 10 : 0
  })).sort((a, b) => b.hits - a.hits);

  return {
    id: meta.id, label: meta.label, window: `${meta.from} ~ ${meta.to}`,
    upDays: upDays.length,
    avgBookOnUpDays: upDays.length ? Math.round(upDays.reduce((s, d) => s + d.book, 0) / upDays.length * 10) / 10 : null,
    etfDayObs, pausedObs, allowNoAdd, allowAdd,
    pausedRate: etfDayObs ? Math.round((pausedObs / etfDayObs) * 1000) / 10 : 0,
    actionCounts, gateRank,
    topUpDays: [...upDays].sort((a, b) => b.eqRetPct - a.eqRetPct).slice(0, 8)
  };
}

function main() {
  const eqThreshold = Number(argVal('--eq-threshold') || '0.01');
  const universe = ETFS;
  const barsMap = {};
  for (const etf of universe) barsMap[etf.code] = loadCsv(etf.code);

  const windows = [];
  for (const meta of WINDOWS) {
    console.log('>>>', meta.label);
    windows.push(runWindow(meta, barsMap, universe, eqThreshold));
  }

  const oos = windows.filter((w) => w.id !== 'wf4');
  const sumHits = emptyHits();
  let sumObs = 0;
  for (const w of oos) {
    sumObs += w.etfDayObs;
    for (const g of w.gateRank) sumHits[g.gate] += g.hits;
  }
  const oosGateRank = GATE_KEYS.map((k) => ({
    gate: k, label: GATE_LABEL[k], hits: sumHits[k],
    pct: sumObs ? Math.round((sumHits[k] / sumObs) * 1000) / 10 : 0
  })).sort((a, b) => b.hits - a.hits);

  const out = {
    date: DATE, discipline: '进攻旋钮冻结·只诊断不调参', eqThreshold,
    note: '等权日涨≥阈值；闸门命中按票×日',
    oos_summary: { windows: oos.map((w) => w.id), etfDayObs: sumObs, gateRank: oosGateRank },
    windows
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const jsonPath = path.join(OUT_DIR, `upday-gate-hits-${DATE}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2));

  const L = [];
  L.push(`# 涨日未满仓 · 闸门命中诊断（${DATE}）`);
  L.push('');
  L.push('> **纪律**：进攻旋钮冻结 · 只诊不调');
  L.push(`> 条件：等权日涨 ≥ **${(eqThreshold * 100).toFixed(1)}%** · 计数单位：票×日`);
  L.push('');
  L.push('## OOS 三折（WF1–3）闸门排行');
  L.push('');
  L.push('| 闸门 | 命中次数 | 占涨日票×日% |');
  L.push('|------|----------|--------------|');
  for (const g of oosGateRank) L.push(`| ${g.label}（\`${g.gate}\`） | ${g.hits} | ${g.pct}% |`);
  L.push('');
  L.push('## 分窗摘要');
  L.push('');
  L.push('| 窗 | 涨日n | 涨日均仓% | 票×日 | 资格暂停率 | allow但未加 | allow且有加仓意图 |');
  L.push('|----|-------|-----------|-------|------------|-------------|-------------------|');
  for (const w of windows) {
    L.push(`| ${w.label} | ${w.upDays} | ${w.avgBookOnUpDays} | ${w.etfDayObs} | ${w.pausedRate}% | ${w.allowNoAdd} | ${w.allowAdd} |`);
  }
  L.push('');
  for (const w of windows) {
    L.push(`## ${w.label}（${w.window}）`);
    L.push('');
    L.push(`动作：${Object.entries(w.actionCounts).map(([k, v]) => `${k}×${v}`).join(' · ') || '—'}`);
    L.push('');
    L.push('| 闸门 | 命中 | 占比 |');
    L.push('|------|------|------|');
    for (const g of w.gateRank.filter((x) => x.hits > 0)) L.push(`| ${g.label} | ${g.hits} | ${g.pct}% |`);
    L.push('');
    L.push('最大涨日样本：');
    L.push('');
    for (const d of w.topUpDays.slice(0, 5)) {
      L.push(`- **${d.date}** 等权 +${d.eqRetPct}% · book ${d.book}%`);
      for (const c of d.codes) {
        L.push(`  - ${c.code} ${c.action} ${c.current}→${c.suggested} W=${c.w || '?'} overall=${c.overall} paused=[${(c.paused || []).join(',')}]`);
      }
    }
    L.push('');
  }
  L.push('## 解读（不调参）');
  L.push('');
  L.push('1. 排行前列 = 涨日欠仓的主要**资格层**成本；若 allow 但未加仓占比高，则成本在**目标仓偏低**（状态机/减仓路径），不在资格闸。');
  L.push('2. WF4 对照：涨日均仓更低、暂停率更高——欠仓在防守窗是可接受代价。');
  L.push('3. **禁止**据此放松 Top 闸门；本报告只回答「钱耗在哪」。');
  L.push('');
  L.push(`JSON：\`scripts/backtest-out/upday-gate-hits-${DATE}.json\``);
  L.push('复跑：`node scripts/diag-upday-gates.js`');

  const mdPath = path.join(REPORT_DIR, `V4.3-涨日闸门命中-${DATE}.md`);
  fs.writeFileSync(mdPath, L.join('\n'));

  console.log('\nOOS gate rank:');
  for (const g of oosGateRank) console.log(`  ${g.label}\t${g.hits}\t${g.pct}%`);
  for (const w of windows) {
    console.log(`${w.label}\t upDays=${w.upDays} avgBook=${w.avgBookOnUpDays} pausedRate=${w.pausedRate}% allowNoAdd=${w.allowNoAdd} allowAdd=${w.allowAdd}`);
  }
  console.log(`\n→ ${jsonPath}\n→ ${mdPath}`);
}

main();
