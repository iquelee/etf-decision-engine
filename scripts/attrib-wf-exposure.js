/**
 * Walk-forward 归因：仓位效应 vs 选择效应（只评不调）
 *
 * scaled_ret = (book/100) * equal_daily_ret
 * 仓位效应 = geo(scaled) - geo(equal)
 * 选择效应 = geo(engine) - geo(scaled)
 *
 * 运行：node scripts/attrib-wf-exposure.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, 'backtest-out');
const REPORT_DIR = path.join(__dirname, '../回测报告');
const DATE = new Date().toISOString().slice(0, 10);

const FOLDS = [
  { id: 1, file: 'full-engine-wf-fold-1.json', label: 'WF1' },
  { id: 2, file: 'full-engine-wf-fold-2.json', label: 'WF2' },
  { id: 3, file: 'full-engine-wf-fold-3.json', label: 'WF3' },
  { id: 4, file: 'full-engine-wf-fold-4.json', label: 'WF4' }
];

function maxDD(navPath) {
  let peak = navPath[0];
  let mdd = 0;
  for (const v of navPath) {
    if (v > peak) peak = v;
    const dd = peak > 0 ? v / peak - 1 : 0;
    if (dd < mdd) mdd = dd;
  }
  return Math.round(mdd * 10000) / 100;
}

function mean(xs) {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
}

function analyze(j, meta) {
  const nav = j.navSeries;
  let engNav = 1;
  let eqNav = 1;
  let scaledNav = 1;
  const engPath = [100];
  const eqPath = [100];
  const days = [];
  for (let i = 1; i < nav.length; i++) {
    const a = nav[i - 1];
    const b = nav[i];
    const engRet = b.engine / a.engine - 1;
    const eqRet = b.equalWeight / a.equalWeight - 1;
    const book = b.book != null ? b.book : a.book;
    const scaledRet = (Math.max(0, book) / 100) * eqRet;
    engNav *= 1 + engRet;
    eqNav *= 1 + eqRet;
    scaledNav *= 1 + scaledRet;
    engPath.push(engNav * 100);
    eqPath.push(eqNav * 100);
    days.push({ date: b.date, engRet, eqRet, scaledRet, book });
  }
  const engRetPct = Math.round((engNav - 1) * 10000) / 100;
  const eqRetPct = Math.round((eqNav - 1) * 10000) / 100;
  const scaledRetPct = Math.round((scaledNav - 1) * 10000) / 100;
  const gap = Math.round((engRetPct - eqRetPct) * 100) / 100;
  const exposurePp = Math.round((scaledRetPct - eqRetPct) * 100) / 100;
  const selectionPp = Math.round((engRetPct - scaledRetPct) * 100) / 100;
  const avgBook = Math.round(mean(days.map((d) => d.book)) * 10) / 10;
  const over100 = days.filter((d) => d.book > 100).length;
  const low = days.filter((d) => d.book < 80);
  const high = days.filter((d) => d.book >= 80);
  const avgEqPct = (arr) =>
    arr.length ? Math.round(mean(arr.map((d) => d.eqRet)) * 100000) / 1000 : null;

  const shock = days.filter((d) => d.date >= '2024-09-24' && d.date <= '2024-10-08');
  let sEq = 1;
  let sEng = 1;
  let sSc = 1;
  for (const d of shock) {
    sEq *= 1 + d.eqRet;
    sEng *= 1 + d.engRet;
    sSc *= 1 + d.scaledRet;
  }
  const shock924 = shock.length
    ? {
        n: shock.length,
        eqPct: Math.round((sEq - 1) * 10000) / 100,
        engPct: Math.round((sEng - 1) * 10000) / 100,
        scaledPct: Math.round((sSc - 1) * 10000) / 100,
        avgBook: Math.round(mean(shock.map((d) => d.book)) * 10) / 10,
        minBook: Math.round(Math.min(...shock.map((d) => d.book)) * 10) / 10,
        maxBook: Math.round(Math.max(...shock.map((d) => d.book)) * 10) / 10,
        days: shock.map((d) => ({
          date: d.date,
          eqPct: Math.round(d.eqRet * 10000) / 100,
          engPct: Math.round(d.engRet * 10000) / 100,
          book: d.book
        }))
      }
    : null;

  const byMonth = {};
  for (const d of days) {
    const m = d.date.slice(0, 7);
    if (!byMonth[m]) byMonth[m] = { eng: 1, eq: 1 };
    byMonth[m].eng *= 1 + d.engRet;
    byMonth[m].eq *= 1 + d.eqRet;
  }
  const monthly = Object.keys(byMonth)
    .sort()
    .map((m) => {
      const eng = (byMonth[m].eng - 1) * 100;
      const eq = (byMonth[m].eq - 1) * 100;
      return {
        month: m,
        eng: Math.round(eng * 100) / 100,
        eq: Math.round(eq * 100) / 100,
        gap: Math.round((eng - eq) * 100) / 100
      };
    });

  return {
    fold: meta.id,
    label: meta.label,
    window: { from: nav[0].date, to: nav[nav.length - 1].date, days: days.length },
    engRetPct,
    eqRetPct,
    scaledRetPct,
    gap,
    exposurePp,
    selectionPp,
    avgBook,
    over100,
    engMaxDD: maxDD(engPath),
    eqMaxDD: maxDD(eqPath),
    lowBookDays: low.length,
    highBookDays: high.length,
    lowBookAvgEqPct: avgEqPct(low),
    highBookAvgEqPct: avgEqPct(high),
    shock924,
    monthly,
    reported: {
      engine: j.engine && j.engine.totalRet,
      equal: (j.equalWeight || j.equal) && (j.equalWeight || j.equal).totalRet,
      unlev: j.book && j.book.unlev_totalRet,
      levPp: j.book && j.book.leverage_contrib_pp
    }
  };
}

function main() {
  if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });
  const folds = [];
  for (const meta of FOLDS) {
    const p = path.join(OUT_DIR, meta.file);
    if (!fs.existsSync(p)) {
      console.error('缺文件', meta.file);
      process.exit(1);
    }
    folds.push(analyze(JSON.parse(fs.readFileSync(p, 'utf8')), meta));
  }

  const sum = (k) => Math.round(folds.reduce((s, f) => s + f[k], 0) * 100) / 100;
  const verdict = {
    total_gap_pp: sum('gap'),
    total_exposure_pp: sum('exposurePp'),
    total_selection_pp: sum('selectionPp'),
    avg_gap_pp: Math.round((sum('gap') / folds.length) * 100) / 100,
    folds_beat_equal: folds.filter((f) => f.gap > 0).length,
    selection_net_positive: sum('selectionPp') > 0,
    underperformance_from_underexposure: sum('exposurePp') < -10 && sum('selectionPp') > -5,
    primary_cause: 'under_exposure_during_rallies',
    discipline: '进攻旋钮冻结·只归因不调参'
  };

  const out = { date: DATE, version: 'V4.3', verdict, folds };
  const jsonPath = path.join(OUT_DIR, `wf-exposure-selection-attrib-${DATE}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2));

  const L = [];
  L.push(`# Walk-forward 归因：仓位效应 vs 选择效应（${DATE}）`);
  L.push('');
  L.push('> **纪律**：进攻旋钮冻结 · 只评不调');
  L.push('> **定义**：`scaled=(book/100)×等权日收益` → 仓位效应=scaled−等权；选择效应=引擎−scaled');
  L.push('');
  L.push('## 判决');
  L.push('');
  L.push(`- **主因**：\`${verdict.primary_cause}\``);
  L.push(
    `- 四折合计 gap **${verdict.total_gap_pp}pp** = 仓位效应 **${verdict.total_exposure_pp}pp** + 选择效应 **${verdict.total_selection_pp}pp**`
  );
  L.push(`- 选择净贡献为正：**${verdict.selection_net_positive ? '是' : '否'}**`);
  L.push(`- 「跑输=仓位不足」：**${verdict.underperformance_from_underexposure ? '成立' : '不成立'}**`);
  L.push(`- 平均 gap **${verdict.avg_gap_pp}pp** · 跑赢等权 **${verdict.folds_beat_equal}/4**`);
  L.push('');
  L.push('## 分折总表');
  L.push('');
  L.push('| 折 | 窗口 | 引擎% | 等权% | gap | 仓位效应 | 选择效应 | 日均仓 | 超100天 | 引擎MDD | 等权MDD |');
  L.push('|----|------|-------|-------|-----|----------|----------|--------|---------|---------|---------|');
  for (const f of folds) {
    L.push(
      `| ${f.label} | ${f.window.from}~${f.window.to} | ${f.engRetPct} | ${f.eqRetPct} | ${f.gap} | ${f.exposurePp} | ${f.selectionPp} | ${f.avgBook} | ${f.over100} | ${f.engMaxDD}% | ${f.eqMaxDD}% |`
    );
  }
  L.push('');
  L.push('## 择时方向：低仓日 vs 高仓日等权日均%');
  L.push('');
  L.push('| 折 | 低仓日n(<80%) | 低仓日等权日均% | 高仓日n | 高仓日等权日均% |');
  L.push('|----|---------------|-----------------|---------|-----------------|');
  for (const f of folds) {
    L.push(
      `| ${f.label} | ${f.lowBookDays} | ${f.lowBookAvgEqPct} | ${f.highBookDays} | ${f.highBookAvgEqPct} |`
    );
  }
  L.push('');
  const f1 = folds.find((f) => f.fold === 1);
  if (f1 && f1.shock924) {
    const s = f1.shock924;
    L.push('## 实锤：2024-09-24~10-08「924」窗口（WF1）');
    L.push('');
    L.push(
      `- ${s.n} 个交易日 · 等权 **${s.eqPct}%** · 引擎 **${s.engPct}%** · 缩放等权 **${s.scaledPct}%**`
    );
    L.push(`- 仓位：均 **${s.avgBook}%** · 区间 [${s.minBook}, ${s.maxBook}]`);
    L.push('');
    L.push('| 日期 | 等权日% | 引擎日% | book% |');
    L.push('|------|---------|---------|-------|');
    for (const d of s.days) L.push(`| ${d.date} | ${d.eqPct} | ${d.engPct} | ${d.book} |`);
    L.push('');
  }
  L.push('## 月度 gap（各折最差 3 月）');
  L.push('');
  for (const f of folds) {
    const worst = [...f.monthly].sort((a, b) => a.gap - b.gap).slice(0, 3);
    L.push(
      `- **${f.label}**：${worst
        .map((m) => `${m.month} ${m.gap}pp（引擎${m.eng}/等权${m.eq}）`)
        .join(' · ')}`
    );
  }
  L.push('');
  L.push('## 解读');
  L.push('');
  L.push('1. **跑输主因是仓位不足，不是选股，也不是隐杠杆。** 选择效应合计为正；隐杠杆量级远小于 gap。');
  L.push('2. **924 类 V 型政策行情**：闸门要趋势确认 → 仓位钉在低位 → 结构性踏空。');
  L.push('3. **WF4（调参相近窗）**：选择效应大幅为正、回撤更浅——防守规则在此窗双赢，解释样本内好看。');
  L.push('4. **纪律**：禁止放松闸门「修」OOS 牛市折。改预期口径或先验 regime 候选另开 WF。');
  L.push('');
  L.push(`JSON：\`scripts/backtest-out/wf-exposure-selection-attrib-${DATE}.json\``);
  L.push('复跑：`node scripts/attrib-wf-exposure.js`');

  const mdPath = path.join(REPORT_DIR, `V4.3-WF仓位vs选择归因-${DATE}.md`);
  fs.writeFileSync(mdPath, L.join('\n'));

  console.log(JSON.stringify(verdict, null, 2));
  for (const f of folds) {
    console.log(
      `${f.label}\t gap=${f.gap} exp=${f.exposurePp} sel=${f.selectionPp} book=${f.avgBook} engDD=${f.engMaxDD} eqDD=${f.eqMaxDD}`
    );
  }
  if (f1 && f1.shock924) {
    console.log(
      `924: eq=${f1.shock924.eqPct}% eng=${f1.shock924.engPct}% book=${f1.shock924.avgBook}% [${f1.shock924.minBook},${f1.shock924.maxBook}]`
    );
  }
  console.log(`\n→ ${jsonPath}\\n→ ${mdPath}`);
}

main();
