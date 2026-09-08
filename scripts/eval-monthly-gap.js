/**
 * 分月 gap 诊断：引擎 vs 等权落后最多的月份 + 分票归因
 * 运行：node scripts/eval-monthly-gap.js [--json=full-engine-v39-draft-main.json]
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
const ETF_NAMES = Object.fromEntries(ETFS.map((e) => [e.code, e.name || e.code]));

function argJson() {
  const hit = process.argv.find((a) => a.indexOf('--json=') === 0);
  const name = hit ? hit.slice(7) : 'full-engine-v39-draft-main.json';
  return path.join(OUT_DIR, name);
}

function monthRange(ym, tradingDays) {
  const days = tradingDays.filter((d) => d.slice(0, 7) === ym);
  return { from: days[0], to: days[days.length - 1], days };
}

function etfMonthReturn(bars, from, to) {
  const s = bars.find((b) => b.trade_date === from);
  const e = bars.find((b) => b.trade_date === to);
  if (!s || !e) return null;
  return Math.round((e.close / s.close - 1) * 10000) / 100;
}

function replayDailyPaths(tradingDays, barsMap) {
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
  const daily = []; // { date, book, positions, actions }

  for (let idx = 60; idx < tradingDays.length; idx++) {
    const today = tradingDays[idx];
    const dayActions = {};
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
        dayActions[code] = ord.action;
      }
      if (bar) delete pending[code];
    }

    const dayResults = decideDay(barsMap, idx, portfolio, slowResolver, cooldown, tradingDays, 'F3');
    for (const { code, result } of dayResults) {
      const pos = portfolio.positions[code];
      pending[code] = {
        target: result.suggested_position != null ? result.suggested_position : pos.current_position,
        core: result.core_position,
        trade: result.trade_position,
        action: result.final_action,
        add_mode: result.add_mode || '无'
      };
      if (!dayActions[code] && result.final_action !== 'HOLD' && result.final_action !== 'WAIT') {
        dayActions[code] = result.final_action;
      }
    }

    portfolio.techPosition = ETFS.filter((e) => TECH_SECTORS.indexOf(e.sector) >= 0)
      .reduce((s, e) => s + (portfolio.positions[e.code].current_position || 0), 0);
    portfolio.goldPosition = portfolio.positions['518880'].current_position || 0;
    portfolio.drugPosition = portfolio.positions['159570'].current_position || 0;
    portfolio.cashRatio = Math.max(0, 100 - portfolio.techPosition - portfolio.goldPosition - portfolio.drugPosition);
    portfolio.tech_position = portfolio.techPosition;

    const book = ETFS.reduce((s, e) => s + (portfolio.positions[e.code].current_position || 0), 0);
    daily.push({
      date: today,
      book: Math.round(book * 10) / 10,
      positions: Object.fromEntries(ETFS.map((e) => [e.code, portfolio.positions[e.code].current_position || 0])),
      actions: { ...dayActions }
    });
  }
  return daily;
}

function analyzeMonth(ym, daily, barsMap, monthlyRow) {
  const rows = daily.filter((d) => d.date.slice(0, 7) === ym);
  const from = rows[0].date;
  const to = rows[rows.length - 1].date;
  const ewPct = 100 / ETFS.length;
  const perEtf = [];

  for (const etf of ETFS) {
    const bars = barsMap[etf.code];
    const ret = etfMonthReturn(bars, from, to);
    const avgPos = rows.reduce((s, r) => s + (r.positions[etf.code] || 0), 0) / rows.length;
    const maxPos = Math.max(...rows.map((r) => r.positions[etf.code] || 0));
    const minPos = Math.min(...rows.map((r) => r.positions[etf.code] || 0));
    const ewContrib = ret != null ? Math.round(ret * ewPct / 100 * 100) / 100 : null;
    const engContrib = ret != null ? Math.round(ret * avgPos / 100 * 100) / 100 : null;
    const partGap = (ewContrib != null && engContrib != null)
      ? Math.round((ewContrib - engContrib) * 100) / 100 : null;

    const actions = {};
    for (const r of rows) {
      const a = r.actions[etf.code];
      if (a) actions[a] = (actions[a] || 0) + 1;
    }

    perEtf.push({
      code: etf.code,
      name: ETF_NAMES[etf.code],
      monthReturn: ret,
      avgPos: Math.round(avgPos * 10) / 10,
      maxPos: Math.round(maxPos * 10) / 10,
      minPos: Math.round(minPos * 10) / 10,
      ewContrib,
      engContrib,
      partGap,
      actions
    });
  }

  perEtf.sort((a, b) => (b.partGap || 0) - (a.partGap || 0));
  const avgBook = Math.round(rows.reduce((s, r) => s + r.book, 0) / rows.length * 10) / 10;

  return {
    month: ym,
    from,
    to,
    engine: monthlyRow.engine,
    equal: monthlyRow.equal,
    gap: monthlyRow.gap,
    avgBook,
    topUnderweight: perEtf.filter((p) => (p.partGap || 0) > 0.15).slice(0, 3),
    perEtf
  };
}

function renderMd(stamp, summary, top3) {
  const lines = [];
  lines.push(`# 分月 gap 诊断 · 落后等权 Top3（${stamp}）`);
  lines.push('');
  lines.push(`> 基线：**${summary.engine.totalRet}%** vs 等权 **${summary.equalWeight.totalRet}%**（${summary.gapTotal}pp）· 引擎 ${summary.version}`);
  lines.push('');
  lines.push('## 全窗分月一览（gap = 引擎 − 等权）');
  lines.push('');
  lines.push('| 月份 | 引擎% | 等权% | gap | 判定 |');
  lines.push('|------|-------|-------|-----|------|');
  for (const r of summary.allMonths) {
    const tag = r.gap < -1 ? '**落后**' : (r.gap > 1 ? '领先' : '接近');
    lines.push(`| ${r.month} | ${r.engine} | ${r.equal} | ${r.gap >= 0 ? '+' : ''}${r.gap} | ${tag} |`);
  }
  lines.push('');
  lines.push('## Top3 落后月 · 分票归因');
  lines.push('');
  lines.push('`partGap` = 等权贡献 − 引擎贡献（%）≈ 该票「少赚」；`avgPos` 为月内日均仓位。');
  lines.push('');

  for (let i = 0; i < top3.length; i++) {
    const m = top3[i];
    lines.push(`### ${i + 1}. ${m.month}（gap **${m.gap}pp** · 引擎 ${m.engine}% vs 等权 ${m.equal}%）`);
    lines.push('');
    lines.push(`- 区间 ${m.from} ~ ${m.to} · 窗均 book **${m.avgBook}%**（等权隐含 100%）`);
    lines.push('');
    lines.push('| 代码 | 月涨跌 | 均仓 | 等权贡献 | 引擎贡献 | partGap | 主要动作 |');
    lines.push('|------|--------|------|----------|----------|---------|----------|');
    for (const p of m.perEtf) {
      const act = Object.entries(p.actions).map(([k, v]) => `${k}×${v}`).join(' ') || '—';
      lines.push(`| ${p.code} ${p.name} | ${p.monthReturn != null ? p.monthReturn + '%' : '—'} | ${p.avgPos}% | ${p.ewContrib}% | ${p.engContrib}% | ${p.partGap}% | ${act} |`);
    }
    lines.push('');
    lines.push('**归因摘要**：');
    for (const p of m.topUnderweight) {
      lines.push(`- **${p.code}**：涨 ${p.monthReturn}% 但均仓仅 ${p.avgPos}%（等权 20%）→ 少参与约 **${p.partGap}pp**`);
    }
    lines.push('');
  }

  lines.push('## 下一版假设（只评不调）');
  lines.push('');
  const codes = [...new Set(top3.flatMap((m) => m.topUnderweight.map((p) => p.code)))];
  lines.push(`- 重复出现在 Top3 的票：**${codes.join('、') || '—'}** → 优先做窄域闸门/减仓节奏实验`);
  lines.push('- 落后月若 `avgBook` 明显低于 80%：主因是**总参与度**，不是单票择时');
  lines.push('- 禁止在同一 126% 窗拧参；每条假设须 OOS + S2/S4 压力窗复验');
  lines.push('');
  return lines.join('\n');
}

function main() {
  const jsonPath = argJson();
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const barsMap = {};
  for (const etf of ETFS) barsMap[etf.code] = loadCsv(etf.code);
  const dateSet = new Set();
  for (const etf of ETFS) barsMap[etf.code].forEach((b) => dateSet.add(b.trade_date));
  const allDates = [...dateSet].sort();
  const startIdx = allDates.findIndex((d) => d >= START_DATE);
  const tradingDays = allDates.slice(Math.max(0, startIdx - 60));

  const allMonths = Object.keys(data.monthly).sort().map((ym) => {
    const m = data.monthly[ym];
    return {
      month: ym,
      engine: m.engine,
      equal: m.equal,
      gap: Math.round((m.engine - m.equal) * 100) / 100
    };
  });
  const loseMonths = allMonths.filter((r) => r.gap < 0).sort((a, b) => a.gap - b.gap);
  const top3Keys = loseMonths.slice(0, 3);

  console.log('回放日度仓位路径…');
  const daily = replayDailyPaths(tradingDays, barsMap);

  const top3 = top3Keys.map((row) => analyzeMonth(row.month, daily, barsMap, row));

  const stamp = new Date().toISOString().slice(0, 10);
  const summary = {
    stamp,
    source: path.basename(jsonPath),
    version: data.experiment ? 'experiment' : 'V3.9',
    engine: data.engine,
    equalWeight: data.equalWeight,
    gapTotal: Math.round((data.engine.totalRet - data.equalWeight.totalRet) * 100) / 100,
    allMonths,
    loseMonths,
    top3
  };

  const outJson = path.join(OUT_DIR, `eval-monthly-gap-${stamp}.json`);
  fs.writeFileSync(outJson, JSON.stringify(summary, null, 2));
  const md = renderMd(stamp, summary, top3);
  const outMd = path.join(REPORT_DIR, `V3.9-分月gap诊断-${stamp}.md`);
  fs.writeFileSync(outMd, md, 'utf8');

  console.log('════════ 分月 gap Top3 ════════');
  for (const m of top3) {
    console.log(`${m.month}  gap ${m.gap}pp  book ${m.avgBook}%`);
    for (const p of m.topUnderweight) {
      console.log(`  ${p.code} ret ${p.monthReturn}% avg ${p.avgPos}% partGap ${p.partGap}pp`);
    }
  }
  console.log(`\nJSON: ${outJson}`);
  console.log(`报告: ${outMd}`);
}

main();
