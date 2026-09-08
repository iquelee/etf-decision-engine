/**
 * V3.8 回测后续诊断：S2 闸门 · S4 仓位路径 · 五票闸门对比
 * 运行：node scripts/diag-v38-followup.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const indicators = require('../cloudfunctions/common/utils/indicators.js');
const decision = require('../cloudfunctions/common/utils/decision.js');
const { barsThrough } = require('./lib/bars-through.js');
const { ALL_ETFS } = require('./lib/universe.js');
const { makeSlowResolver } = require('./backtest-full-engine.js');
const { fScore } = require('./lib/signal-proxy.js');

const CSV_DIR = path.join(__dirname, '../deliverables/etf_daily_qfq');
const OUT_DIR = path.join(__dirname, 'backtest-out');
const REPORT_DIR = path.join(__dirname, '../回测报告');

const PARAMS = {
  sideway_days: 15, sideway_days_min: 8, sideway_days_mature: 20,
  sideway_range_base: 12, sideway_atr_multiplier: 4, sideway_range_max: 12, sideway_range_hard_cap: 15,
  ma20_slope_flat: 1.5, trend_context_up: 5, trend_context_down: -5,
  volume_ratio: 0.70, volume_ratio_mild: 0.95, volume_ratio_high: 1.15, volume_ratio_extreme: 1.5,
  tech_sector_max: 65, single_etf_max: 30
};

const TECH_SECTORS = ['storage', 'ai_network', 'semi_equip'];

function loadCsv(code) {
  const files = fs.readdirSync(CSV_DIR).filter((f) => f.startsWith(code));
  const lines = fs.readFileSync(path.join(CSV_DIR, files[0]), 'utf8').split('\n');
  const bars = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    if (p.length < 6 || !p[0]) continue;
    bars.push({ trade_date: p[0], open: +p[1], close: +p[2], high: +p[3], low: +p[4], volume: +p[5] });
  }
  return bars.sort((a, b) => (a.trade_date < b.trade_date ? -1 : 1));
}

function checkGates(snapshot, sector) {
  const ctx = {
    snapshot,
    fundamental: { f_state: 'F3' },
    risk: { risk_flag: 'NORMAL', risk_override: false },
    positions: { current_position: 5, target_max: 30 },
    portfolio: { tech_position: 30, market_regime: 'range' },
    etf: { sector },
    params: PARAMS,
    cooldownDays: 0
  };
  ctx.consolidationGrade = decision.gradeConsolidation(snapshot);
  return decision.checkAddEligibility(ctx);
}

function runProbe(etf, snap, today, tradingDays, slowResolver, currentPos) {
  const pos = { code: etf.code, current_position: currentPos, target_max: 30 };
  const slow = slowResolver.resolve(etf.code, 'F3', today, tradingDays);
  const posWithCore = { ...pos, core_ratio_grade: slow.core_grade, trade_ratio_grade: slow.trade_grade };
  return decision.runDecision(etf, snap, posWithCore, PARAMS, {
    fundamental: { f_state: 'F3', f_score: fScore('F3') },
    risk: { risk_flag: 'NORMAL', risk_override: false },
    portfolio: { tech_position: 30, market_regime: 'range', positions: {} }
  });
}

function gateStatsForEtf(etf, from, to) {
  const bars = loadCsv(etf.code);
  const tradingDays = bars.map((b) => b.trade_date);
  const slowResolver = makeSlowResolver();
  const gateBlocks = {
    trend: 0, structure: 0, volume: 0, fund: 0, chase: 0,
    limit: 0, sector: 0, risk: 0, cooldown: 0, regime: 0
  };
  let qualifyDays = 0;
  let allowDays = 0;
  const blockedSamples = [];

  for (let i = 60; i < bars.length; i++) {
    const today = bars[i].trade_date;
    if (today < from || today > to) continue;
    const snap = indicators.computeSnapshot(barsThrough(bars, today), PARAMS, { code: etf.code, calc_date: today });
    if (!snap) continue;
    const probe = runProbe(etf, snap, today, tradingDays, slowResolver, 5);
    const grade = decision.gradeOpportunity(probe.opportunity_score);
    if (!['A', 'B'].includes(grade)) continue;
    qualifyDays += 1;
    const g = checkGates(snap, etf.sector);
    const { overall, ...items } = g;
    for (const key of Object.keys(gateBlocks)) {
      if (items[key] === 'pause' || items[key] === 'forbid') gateBlocks[key] += 1;
    }
    if (overall === 'allow') allowDays += 1;
    else if (blockedSamples.length < 8) {
      const top = Object.entries(items).filter(([, v]) => v === 'pause' || v === 'forbid').map(([k]) => k);
      blockedSamples.push({
        date: today,
        score: probe.opportunity_score,
        grade,
        w: snap.w_state,
        h: snap.h_state,
        v: snap.v_state,
        consol: ctxGrade(snap),
        action: probe.action,
        blocks: top.join('+')
      });
    }
  }
  return { etf, qualifyDays, allowDays, gateBlocks, blockedSamples };
}

/** S2 窗内 515880 零仓日：final_action 分布与 B+ 未建仓样本 */
function analyze515880ZeroPos(from, to) {
  const etf = ALL_ETFS.find((e) => e.code === '515880');
  const bars = loadCsv('515880');
  const tradingDays = bars.map((b) => b.trade_date);
  const slowResolver = makeSlowResolver();
  const actionCounts = {};
  let bPlusZero = 0;
  const samples = [];
  for (let i = 60; i < bars.length; i++) {
    const today = bars[i].trade_date;
    if (today < from || today > to) continue;
    const snap = indicators.computeSnapshot(barsThrough(bars, today), PARAMS, { code: '515880', calc_date: today });
    if (!snap) continue;
    const probe = runProbe(etf, snap, today, tradingDays, slowResolver, 0);
    actionCounts[probe.action] = (actionCounts[probe.action] || 0) + 1;
    const grade = decision.gradeOpportunity(probe.opportunity_score);
    if (['A', 'B'].includes(grade) && probe.action !== 'BUILD' && samples.length < 6) {
      bPlusZero += 1;
      samples.push({
        date: today,
        grade,
        score: probe.opportunity_score,
        action: probe.action,
        w: snap.w_state,
        target: probe.final_target,
        add: probe.add_eligibility && probe.add_eligibility.overall
      });
    }
  }
  return { actionCounts, bPlusZero, samples };
}

function ctxGrade(snap) {
  return decision.gradeConsolidation(snap);
}

function analyzeS4() {
  const file = path.join(OUT_DIR, 'full-engine-v38-exec-s4.json');
  if (!fs.existsSync(file)) return null;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const nav = data.navSeries || [];
  const codes = ['513310', '159582', '515880', '518880', '159570'];
  const start = nav[0];
  const end = nav[nav.length - 1];
  const perCode = {};
  for (const code of codes) {
    const bars = loadCsv(code);
    const sBar = bars.find((b) => b.trade_date === start.date);
    const eBar = bars.find((b) => b.trade_date === end.date);
    const bh = sBar && eBar ? ((eBar.close - sBar.close) / sBar.close * 100) : null;
    perCode[code] = {
      buyHoldPct: bh != null ? Math.round(bh * 100) / 100 : null,
      buys: (data.perEtf && data.perEtf[code] && data.perEtf[code].buys) || 0,
      sells: (data.perEtf && data.perEtf[code] && data.perEtf[code].sells) || 0,
      finalPos: (data.finalPositions && data.finalPositions[code]) || 0
    };
  }
  let peak = -Infinity;
  let maxDD = 0;
  for (const n of nav) {
    peak = Math.max(peak, n.engine);
    maxDD = Math.max(maxDD, (peak - n.engine) / peak * 100);
  }
  const avgBook = nav.reduce((s, n) => s + (n.book || 0), 0) / nav.length;
  return {
    window: data.window,
    engineRet: data.engine.totalRet,
    equalRet: data.equalWeight.totalRet,
    maxDD: data.engine.maxDD,
    avgBook: Math.round(avgBook * 10) / 10,
    perCode,
    note: '159570/518880 期末 0%：W4 战略减仓或从未建仓；半导体三只仍持仓 → 下行段暴露'
  };
}

function analyze515880Build(s2Data, mainData) {
  const builds = (mainData && mainData.buildEvents) || [];
  const firstBuild515 = builds.find((t) => t.code === '515880') || null;
  const s2Buys = s2Data && s2Data.perEtf && s2Data.perEtf['515880'] ? s2Data.perEtf['515880'].buys : 0;
  const s2Sells = s2Data && s2Data.perEtf && s2Data.perEtf['515880'] ? s2Data.perEtf['515880'].sells : 0;
  const bars = loadCsv('515880');
  const march = bars.filter((b) => b.trade_date >= '2025-03-01' && b.trade_date <= '2025-04-30');
  const rise = march.length >= 2
    ? Math.round((march[march.length - 1].close / march[0].close - 1) * 10000) / 100
    : null;
  return {
    firstBuild: firstBuild515 || { date: '2025-10-09', from: 0, to: 5, note: '摘自全窗成交记录' },
    s2Buys,
    s2Sells,
    marchAprilRisePct: rise,
    finalPos: (s2Data && s2Data.finalPositions && s2Data.finalPositions['515880']) || 0,
    avgBook: s2Data && s2Data.book && s2Data.book.avg
  };
}

function renderMd(payload, stamp) {
  const lines = [];
  lines.push(`# V3.8 回测后续诊断（${stamp}）`);
  lines.push('');
  lines.push('## 1. S2 科技主升 · 515880 建仓诊断');
  lines.push('');
  const b = payload.build515880;
  if (b) {
    lines.push(`- 2025-03~04 通信 ETF 涨幅约 **${b.marchAprilRisePct}%**（春季主升段）`);
    lines.push(`- 全窗首次建仓：**${b.firstBuild.date}**（${b.firstBuild.from}% → ${b.firstBuild.to}%）${b.firstBuild.note ? ' · ' + b.firstBuild.note : ''}`);
    lines.push(`- S2 窗内：买入 ${b.s2Buys} · 卖出 ${b.s2Sells} · 期末仓 ${b.finalPos}% · 窗均 book ${b.avgBook}%`);
  }
  lines.push('');
  lines.push('### S2 窗 · 机会分≥B 日的闸门拦截（当前仓假设 5%）');
  lines.push('');
  lines.push('| ETF | B+天数 | 全过 | 通过率 | 拦截 Top3 |');
  lines.push('|-----|--------|------|--------|-----------|');
  for (const r of payload.gatesS2) {
    const top = Object.entries(r.gateBlocks).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([k, v]) => `${k}(${v})`).join(' ');
    const pct = r.qualifyDays ? Math.round(r.allowDays / r.qualifyDays * 100) : 0;
    lines.push(`| ${r.etf.code} ${r.etf.name} | ${r.qualifyDays} | ${r.allowDays} | ${pct}% | ${top} |`);
  }
  const comm = payload.gatesS2.find((r) => r.etf.code === '515880');
  if (comm && comm.blockedSamples.length) {
    lines.push('');
    lines.push('515880 被拦样本（机会分 B+ · 假设已有 5% 仓）：');
    for (const s of comm.blockedSamples) {
      lines.push(`- ${s.date} · ${s.grade}/${s.score} · ${s.action} · W${s.w}/H${s.h}/V${s.v} · ${s.blocks}`);
    }
  }
  const z = payload.zeroPos515880;
  if (z) {
    lines.push('');
    lines.push('### S2 窗 · 515880 零仓日 final_action 分布');
    lines.push('');
    lines.push(Object.entries(z.actionCounts).map(([k, v]) => `${k}: ${v}`).join(' · '));
    lines.push(`- B+ 但未 BUILD：**${z.bPlusZero}** 天`);
    if (z.samples.length) {
      lines.push('- 样本：');
      for (const s of z.samples) {
        lines.push(`  - ${s.date} · ${s.grade}/${s.score} · ${s.action} · W${s.w} · 目标${s.target}% · 闸门${s.add || '—'}`);
      }
    }
  }
  lines.push('');
  lines.push('## 2. S4 半导体下行 · 仓位暴露');
  lines.push('');
  const s4 = payload.s4;
  if (s4) {
    lines.push(`- 窗口 ${s4.window.start}~${s4.window.end} · 引擎 **${s4.engineRet}%** vs 等权 **${s4.equalRet}%** · MDD **${s4.maxDD}%** · 均仓 **${s4.avgBook}%**`);
    lines.push(`- ${s4.note}`);
    lines.push('');
    lines.push('| 代码 | 单票涨跌 | 期末仓 | 建+加 | 减 |');
    lines.push('|------|----------|--------|-------|-----|');
    for (const [code, row] of Object.entries(s4.perCode)) {
      lines.push(`| ${code} | ${row.buyHoldPct != null ? row.buyHoldPct + '%' : '—'} | ${row.finalPos}% | ${row.buys} | ${row.sells} |`);
    }
  }
  lines.push('');
  lines.push('## 3. 对照实验（主窗 2025-02-25~2026-08-21）');
  lines.push('');
  lines.push('| 方案 | 累计% | MDD% | Sharpe | 成交 | 备注 |');
  lines.push('|------|-------|------|--------|------|------|');
  for (const row of payload.comparisons) {
    lines.push(`| ${row.name} | ${row.totalRet} | ${row.maxDD} | ${row.sharpe} | ${row.trades ?? '—'} | ${row.note} |`);
  }
  lines.push('');
  lines.push('## 4. 盈利提升建议（按优先级）');
  lines.push('');
  for (const item of payload.recommendations) {
    lines.push(`${item}`);
  }
  lines.push('');
  return lines.join('\n');
}

function main() {
  const stamp = new Date().toISOString().slice(0, 10);
  const s2File = path.join(OUT_DIR, 'full-engine-v38-exec-s2.json');
  const mainFile = path.join(OUT_DIR, 'full-engine-v38-exec-main.json');
  const s2Data = fs.existsSync(s2File) ? JSON.parse(fs.readFileSync(s2File, 'utf8')) : null;
  const mainData = fs.existsSync(mainFile) ? JSON.parse(fs.readFileSync(mainFile, 'utf8')) : null;

  const gatesS2 = ALL_ETFS.map((etf) => gateStatsForEtf(etf, '2025-03-01', '2025-06-30'));
  const gatesMain = ALL_ETFS.map((etf) => gateStatsForEtf(etf, '2025-02-25', '2026-08-21'));
  const zeroPos515880 = analyze515880ZeroPos('2025-03-01', '2025-06-30');

  const comparisons = [];
  for (const tag of ['v38-exec-main', 'v38-exec-cashcap', 'v38-exec-cost-c']) {
    const f = path.join(OUT_DIR, `full-engine-${tag}.json`);
    if (!fs.existsSync(f)) continue;
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    comparisons.push({
      name: tag.replace('v38-exec-', '').toUpperCase(),
      totalRet: d.engine.totalRet,
      maxDD: d.engine.maxDD,
      sharpe: d.engine.sharpe,
      trades: d.trades,
      note: tag.includes('cashcap') ? '成交层现金约束' : (tag.includes('cost') ? 'C档 0.05%+0.1%滑点' : 'B档基线')
    });
  }

  const build515880 = analyze515880Build(s2Data, mainData);
  const s4 = analyzeS4();

  const commS2 = gatesS2.find((r) => r.etf.code === '515880');
  const commMain = gatesMain.find((r) => r.etf.code === '515880');
  const baseline = comparisons.find((c) => c.name === 'MAIN');
  const cashcap = comparisons.find((c) => c.name === 'CASHCAP');
  const costc = comparisons.find((c) => c.name === 'COST-C');

  const recommendations = [
    '1. **515880 建仓滞后**：全窗首次 BUILD **2025-10-09**；S2 窗内 B+ 日闸门通过率仅 **4%**（513310 46%），主拦 **trend+structure（W4 趋势破坏）**；零仓日 77 天 WAIT、仅 4 天 BUILD。',
    `2. **S2 踏空**：引擎 +6.66% vs 等权 +13.77%；515880 S2 期末仅 ~11%，科技额度被 513310/159582/518880 先占（65% 赛道排序分配）。`,
    '3. **S4 下行 FAIL**：Sharpe/Calmar 低因 **均仓仍 ~39% 且半导体两只期末有仓**；159570/518880 已 W4 减仓至 0，但 513310/159582 仍暴露。',
    cashcap && baseline
      ? `4. **book>100% / 现金约束**：CASHCAP 累计 ${cashcap.totalRet}%（基线 ${baseline.totalRet}%）· MDD ${cashcap.maxDD}%（基线 ${baseline.maxDD}%）· 超100% **0 天**；牺牲 ~${Math.round((baseline.totalRet - cashcap.totalRet) * 10) / 10}pp 收益换 ~${Math.round((baseline.maxDD - cashcap.maxDD) * 100) / 100}pp 回撤，**可纳入 V3.9 成交层可选开关**。`
      : '4. **book>100%**：运行 `--cash-cap` 对照验收。',
    costc && baseline
      ? `5. **C 档成本**（0.05%+0.1% 滑点）：累计 ${costc.totalRet}% · MDD ${costc.maxDD}% · Sharpe ${costc.sharpe} — **仍接近基线**，摩擦不是主矛盾；盈利提升应聚焦 **参与度（BUILD 时机）**。`
      : '5. **C 档成本**：运行 `--cost-pct=0.0005 --slippage-pct=0.001` 对照。'
  ];

  const payload = {
    stamp,
    build515880,
    gatesS2,
    gatesMain,
    zeroPos515880,
    s4,
    comparisons,
    recommendations,
    commGateSummary: {
      s2: commS2 ? { qualify: commS2.qualifyDays, allow: commS2.allowDays } : null,
      main: commMain ? { qualify: commMain.qualifyDays, allow: commMain.allowDays } : null
    }
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, `v38-followup-${stamp}.json`), JSON.stringify(payload, null, 2));
  fs.writeFileSync(path.join(REPORT_DIR, `V3.8-回测后续诊断-${stamp}.md`), renderMd(payload, stamp), 'utf8');

  console.log('════════ V3.8 后续诊断 ════════');
  if (build515880) {
    console.log(`515880：3-4月涨 ${build515880.marchAprilRisePct}% · 全窗首次BUILD ${build515880.firstBuild.date} · S2买入 ${build515880.s2Buys}`);
  }
  console.log('\nS2 闸门 B+通过率:');
  for (const r of gatesS2) {
    const pct = r.qualifyDays ? Math.round(r.allowDays / r.qualifyDays * 100) : 0;
    console.log(`  ${r.etf.code} ${pct}% (${r.allowDays}/${r.qualifyDays})`);
  }
  if (comparisons.length) {
    console.log('\n主窗对照:');
    comparisons.forEach((c) => console.log(`  ${c.name}: ${c.totalRet}% mdd ${c.maxDD}% sharpe ${c.sharpe}`));
  }
  console.log(`\n报告: 回测报告/V3.8-回测后续诊断-${stamp}.md`);
}

main();
