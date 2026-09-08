/**
 * 2026-08 主升段减太早 · 515880 / 518880 逐日决策链
 * 运行：node scripts/diag-aug2026-reduce.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  loadCsv, decideDay, makeSlowResolver, makeCooldown,
  ETFS, START_DATE, TECH_SECTORS
} = require('./backtest-full-engine.js');

const OUT_DIR = path.join(__dirname, 'backtest-out');
const REPORT_DIR = path.join(__dirname, '../回测报告');
const TARGET_CODES = ['515880', '518880'];
const MONTH = '2026-08';

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
      code: etf.code, current_position: 0, target_max: 30,
      max_position: 30, max_strategic_position: 30,
      core_position: 0, trade_position: 0
    };
  }

  const slowResolver = makeSlowResolver();
  const cooldown = makeCooldown(tradingDays);
  const pending = {};
  const daily = [];

  for (let idx = 60; idx < tradingDays.length; idx++) {
    const today = tradingDays[idx];
    for (const code of Object.keys(pending)) {
      const ord = pending[code];
      const pos = portfolio.positions[code];
      const bar = barsMap[code].find((b) => b.trade_date === today);
      const diff = ord.target - pos.current_position;
      if (bar && Math.abs(diff) > 0.05) {
        pos.current_position = Math.round(ord.target * 10) / 10;
        if (diff > 0) cooldown.setBuy(code, idx, ord.add_mode);
        pos.core_position = ord.core != null ? ord.core : pos.core_position;
        pos.trade_position = ord.trade != null ? ord.trade : pos.trade_position;
      }
      if (bar) delete pending[code];
    }

    const dayResults = decideDay(barsMap, idx, portfolio, slowResolver, cooldown, tradingDays, 'F3');
    const row = { date: today, book: 0, codes: {} };
    for (const { code, result } of dayResults) {
      const pos = portfolio.positions[code];
      pending[code] = {
        target: result.suggested_position != null ? result.suggested_position : pos.current_position,
        core: result.core_position,
        trade: result.trade_position,
        action: result.final_action,
        add_mode: result.add_mode || '无'
      };
      if (TARGET_CODES.includes(code)) {
        row.codes[code] = {
          action: result.final_action,
          current: pos.current_position,
          suggested: result.suggested_position,
          w: result.w_state,
          h: result.h_state,
          v: result.v_state,
          score: result.opportunity_score,
          grade: result.opportunity_grade,
          explain: (result.explain_chain || []).slice(0, 6)
        };
      }
    }
    portfolio.techPosition = ETFS.filter((e) => TECH_SECTORS.indexOf(e.sector) >= 0)
      .reduce((s, e) => s + (portfolio.positions[e.code].current_position || 0), 0);
    portfolio.goldPosition = portfolio.positions['518880'].current_position || 0;
    portfolio.drugPosition = portfolio.positions['159570'].current_position || 0;
    row.book = Math.round(ETFS.reduce((s, e) => s + (portfolio.positions[e.code].current_position || 0), 0) * 10) / 10;
    daily.push(row);
  }

  const aug = daily.filter((d) => d.date.startsWith(MONTH));
  const srRows = [];
  const actionCounts = { '515880': {}, '518880': {} };

  for (const d of aug) {
    for (const code of TARGET_CODES) {
      const c = d.codes[code];
      if (!c) continue;
      actionCounts[code][c.action] = (actionCounts[code][c.action] || 0) + 1;
      if (c.action === 'STRATEGIC_REDUCE' || c.action === 'TACTICAL_REDUCE') {
        srRows.push({
          date: d.date,
          code,
          action: c.action,
          current: c.current,
          suggested: c.suggested,
          w: c.w,
          h: c.h,
          v: c.v,
          grade: c.grade,
          explain: c.explain
        });
      }
    }
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const payload = { month: MONTH, actionCounts, srRows, dailyAug: aug };
  const outJson = path.join(OUT_DIR, `diag-aug2026-reduce-${stamp}.json`);
  fs.writeFileSync(outJson, JSON.stringify(payload, null, 2));

  const lines = [];
  lines.push(`# V3.9 · 2026-08 减仓链诊断（${stamp}）`);
  lines.push('');
  lines.push('> 分月 gap Top1：2026-08 gap **−5.2pp** · book 均 **53.9%**');
  lines.push('> 目标票：**515880**（+16.3% 均仓 8.9%）· **518880**（+11.5% 均仓 9.5%，STR×13）');
  lines.push('');
  lines.push('## 动作分布（2026-08）');
  lines.push('');
  for (const code of TARGET_CODES) {
    const name = ETFS.find((e) => e.code === code).name;
    const ac = actionCounts[code];
    lines.push(`**${code} ${name}**：${Object.entries(ac).map(([k, v]) => `${k}×${v}`).join(' · ') || '—'}`);
  }
  lines.push('');
  lines.push('## STR / TAC 减仓逐日（含 explain_chain）');
  lines.push('');
  if (!srRows.length) {
    lines.push('（无 STR/TAC 决策日）');
  } else {
    lines.push('| 日期 | 代码 | 动作 | 仓 | W | H | V | 分档 | 触发链 |');
    lines.push('|------|------|------|-----|---|---|---|------|--------|');
    for (const r of srRows) {
      const chain = (r.explain || []).map((e) => e.step || e.reason || JSON.stringify(e)).join(' → ');
      lines.push(`| ${r.date} | ${r.code} | ${r.action} | ${r.current}→${r.suggested} | ${r.w} | ${r.h} | ${r.v} | ${r.grade || '—'} | ${chain.slice(0, 80)} |`);
    }
  }
  lines.push('');
  lines.push('## 初步归因');
  lines.push('');
  const w4sr = srRows.filter((r) => r.w === 'W4' && r.action === 'STRATEGIC_REDUCE');
  const p3sr = srRows.filter((r) => r.explain && r.explain.some((e) => String(e.step || e.reason || '').match(/放量|hvD|hvS|P3/i)));
  lines.push(`- W4 触发的 STR：**${w4sr.length}** 笔`);
  lines.push(`- explain 含放量/P3 语义：**${p3sr.length}** 笔`);
  lines.push('- V4.0 假设方向：涨段 W4 战略减仓是否过频；518880 STR 与 book 被压至 ~54% 的直接关联');
  lines.push('');

  const outMd = path.join(REPORT_DIR, `V3.9-2026-08减仓链诊断-${stamp}.md`);
  fs.writeFileSync(outMd, lines.join('\n'), 'utf8');

  console.log('2026-08 STR/TAC:', srRows.length, '笔');
  for (const r of srRows) {
    console.log(`  ${r.date} ${r.code} ${r.action} ${r.current}→${r.suggested} W${r.w}`);
  }
  console.log(`\nJSON: ${outJson}`);
  console.log(`报告: ${outMd}`);
}

main();
