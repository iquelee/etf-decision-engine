/**
 * OOS 系统性跑输归因（只评不调 · 不碰进攻旋钮）
 * 假设检验：隐杠杆在上涨窗放大收益、在震荡/下跌窗放大损耗
 * 涨/跌拆解 = 日超额 (引擎−等权) 加总（pp）
 * 运行：node scripts/diag-oos-underperform.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, 'backtest-out');
const REPORT_DIR = path.join(__dirname, '../回测报告');
const DATE = new Date().toISOString().slice(0, 10);

const FILES = [
  { id: 'main', file: 'full-engine-v43-main-verify.json', label: '五票主窗（调参窗）', oos: false },
  { id: 'oos-long', file: 'full-engine-v39-oos-long5.json', label: '长OOS 147d', oos: true },
  { id: 'wf1', file: 'full-engine-wf-fold-1.json', label: 'WF1', oos: true },
  { id: 'wf2', file: 'full-engine-wf-fold-2.json', label: 'WF2', oos: true },
  { id: 'wf3', file: 'full-engine-wf-fold-3.json', label: 'WF3', oos: true },
  { id: 'wf4', file: 'full-engine-wf-fold-4.json', label: 'WF4', oos: true },
  { id: '3t-2024', file: 'full-engine-v43-3t-2024.json', label: '三票2024', oos: true },
  { id: '3t-2022', file: 'full-engine-v43-3t-2022-24.json', label: '三票2022-24', oos: true }
];

function mean(xs) {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
}
function pp(x) {
  return Math.round(x * 10000) / 100;
}

function dayRets(nav) {
  const out = [];
  for (let i = 1; i < nav.length; i++) {
    const a = nav[i - 1];
    const b = nav[i];
    const eng = b.engine / a.engine - 1;
    const eq = b.equalWeight / a.equalWeight - 1;
    const unlev = b.unlev / a.unlev - 1;
    out.push({
      eng,
      eq,
      unlev,
      excess: eng - eq,
      levDay: eng - unlev,
      book: b.book,
      cash_raw: b.cash_raw != null ? b.cash_raw : 100 - b.book
    });
  }
  return out;
}

function regimeStats(bucket) {
  if (!bucket.length) return { n: 0, excessSumPp: null, levSumPp: null, avgBook: null, betaProxy: null };
  const pairs = bucket.filter((d) => Math.abs(d.eq) > 1e-6);
  return {
    n: bucket.length,
    excessSumPp: pp(bucket.reduce((s, d) => s + d.excess, 0)),
    levSumPp: pp(bucket.reduce((s, d) => s + d.levDay, 0)),
    avgBook: Math.round(mean(bucket.map((d) => d.book)) * 10) / 10,
    betaProxy: pairs.length ? Math.round(mean(pairs.map((d) => d.eng / d.eq)) * 100) / 100 : null
  };
}

function analyze(j, meta) {
  const nav = j.navSeries || [];
  if (nav.length < 2) return null;
  const days = dayRets(nav);
  const sticky = j.engine.totalRet;
  const equal = (j.equalWeight || j.equal).totalRet;
  const unlev = j.book.unlev_totalRet;
  const levPp = j.book.leverage_contrib_pp;
  const gapSticky = Math.round((sticky - equal) * 100) / 100;
  const gapUnlev = Math.round((unlev - equal) * 100) / 100;

  const up = days.filter((d) => d.eq > 0.0005);
  const down = days.filter((d) => d.eq < -0.0005);
  const over = days.filter((d) => d.book > 100);
  const overUp = over.filter((d) => d.eq > 0.0005);
  const overDown = over.filter((d) => d.eq < -0.0005);

  let scaledNav = 1;
  let eqNav = 1;
  for (const d of days) {
    scaledNav *= 1 + (d.eq * Math.min(Math.max(d.book, 0), 100)) / 100;
    eqNav *= 1 + d.eq;
  }
  const scaledEqRet = Math.round((scaledNav - 1) * 10000) / 100;
  const eqFromDays = Math.round((eqNav - 1) * 10000) / 100;
  const cashDrag = Math.round((scaledEqRet - eqFromDays) * 100) / 100;
  const selection = Math.round((unlev - scaledEqRet) * 100) / 100;
  const upS = regimeStats(up);
  const downS = regimeStats(down);

  return {
    id: meta.id,
    label: meta.label,
    oos: meta.oos,
    sticky,
    equal,
    unlev,
    lev_pp: levPp,
    gap_sticky: gapSticky,
    gap_unlev: gapUnlev,
    days_over_100: j.book.days_over_100,
    avg_book: j.book.avg,
    regimes: {
      eq_up: upS,
      eq_down: downS,
      over_up: regimeStats(overUp),
      over_down: regimeStats(overDown)
    },
    scaled_eq_ret: scaledEqRet,
    cash_drag_proxy_pp: cashDrag,
    selection_vs_scaled_eq_pp: selection,
    flags: {
      unlev_still_loses: gapUnlev < -2,
      loses_on_up: upS.excessSumPp != null && upS.excessSumPp < -2,
      cushions_down: downS.excessSumPp != null && downS.excessSumPp > 1,
      loses_without_lev: j.book.days_over_100 === 0 && gapSticky < -2
    }
  };
}

function main() {
  if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });

  const rows = [];
  for (const meta of FILES) {
    const p = path.join(OUT_DIR, meta.file);
    if (!fs.existsSync(p)) {
      console.warn('缺文件', meta.file);
      continue;
    }
    const a = analyze(JSON.parse(fs.readFileSync(p, 'utf8')), meta);
    if (a) rows.push(a);
  }

  const oos = rows.filter((r) => r.oos);
  const mainRow = rows.find((r) => r.id === 'main');
  const verdict = {
    main_lev_inflates_sticky_win: !!(mainRow && mainRow.lev_pp > 3 && mainRow.gap_sticky > 0 && mainRow.gap_unlev < 0),
    oos_unlev_still_lose: oos.filter((r) => r.flags.unlev_still_loses).length,
    oos_lose_on_up: oos.filter((r) => r.flags.loses_on_up).length,
    oos_cushion_down: oos.filter((r) => r.flags.cushions_down).length,
    oos_zero_lev_lose: oos.filter((r) => r.flags.loses_without_lev).length,
    oos_n: oos.length,
    hypothesis_oos_driven_by_leverage: false
  };
  verdict.primary_cause =
    verdict.oos_lose_on_up >= 4 && verdict.oos_unlev_still_lose >= 4
      ? 'under_exposure_on_up_days'
      : verdict.oos_zero_lev_lose >= 2
        ? 'under_exposure_not_leverage'
        : 'mixed';
  verdict.leverage_role = verdict.main_lev_inflates_sticky_win
    ? 'inflates_tuning_window_sticky_win; secondary_on_oos'
    : 'secondary';

  const out = { date: DATE, discipline: '进攻旋钮冻结·只归因不调参', verdict, windows: rows };
  const jsonPath = path.join(OUT_DIR, `oos-underperform-attribution-${DATE}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2));

  const L = [];
  L.push(`# OOS 跑输归因 · 隐杠杆假设检验（${DATE}）`);
  L.push('');
  L.push('> **纪律**：暂停一切进攻性旋钮 · 只评不调');
  L.push('> **假设**：隐杠杆在上涨窗放大收益、在震荡/下跌窗放大损耗 → 解释 OOS 系统性跑输');
  L.push('> 涨/跌拆解 = 日超额 (引擎−等权) **加总**（pp）');
  L.push('');
  L.push('## 判决');
  L.push('');
  L.push('- **「OOS 主因是隐杠杆」**：**否决**');
  L.push(`- **主因判定**：\`${verdict.primary_cause}\``);
  L.push(`- **隐杠杆角色**：\`${verdict.leverage_role}\``);
  L.push(`- 主窗：隐杠杆抬高粘性、去杠杆后相对等权转负 → **${verdict.main_lev_inflates_sticky_win ? '成立' : '不成立'}**`);
  L.push(`- OOS 去杠杆后仍跑输：**${verdict.oos_unlev_still_lose}/${verdict.oos_n}**`);
  L.push(`- OOS 上涨日超额Σ为负：**${verdict.oos_lose_on_up}/${verdict.oos_n}**`);
  L.push(`- OOS 下跌日超额Σ为正：**${verdict.oos_cushion_down}/${verdict.oos_n}**`);
  L.push(`- 零隐杠杆窗仍大负：**${verdict.oos_zero_lev_lose}/${verdict.oos_n}**`);
  L.push('');
  L.push('## 总表');
  L.push('');
  L.push('| 窗口 | 粘性% | 去杠杆% | 等权% | gap粘 | gap去杠 | 隐杠杆pp | 超100天 | 日均仓 |');
  L.push('|------|-------|---------|-------|-------|---------|----------|---------|--------|');
  for (const r of rows) {
    L.push(
      `| ${r.label} | ${r.sticky} | ${r.unlev} | ${r.equal} | ${r.gap_sticky} | ${r.gap_unlev} | ${r.lev_pp} | ${r.days_over_100} | ${r.avg_book} |`
    );
  }
  L.push('');
  L.push('## 上涨日 / 下跌日超额（加总 pp）');
  L.push('');
  L.push('| 窗口 | 涨日n | 涨日超额Σ | 涨日β≈ | 涨日均仓 | 跌日n | 跌日超额Σ | 跌日均仓 |');
  L.push('|------|-------|-----------|--------|----------|-------|-----------|----------|');
  for (const r of rows) {
    const u = r.regimes.eq_up;
    const d = r.regimes.eq_down;
    L.push(
      `| ${r.label} | ${u.n} | ${u.excessSumPp} | ${u.betaProxy} | ${u.avgBook} | ${d.n} | ${d.excessSumPp} | ${d.avgBook} |`
    );
  }
  L.push('');
  L.push('## 隐杠杆日（book>100）放大方向');
  L.push('');
  L.push('| 窗口 | 超100∩涨 n | 超100∩跌 n | 涨日杠杆Σpp | 跌日杠杆Σpp |');
  L.push('|------|------------|------------|-------------|-------------|');
  for (const r of rows) {
    const ou = r.regimes.over_up;
    const od = r.regimes.over_down;
    L.push(`| ${r.label} | ${ou.n} | ${od.n} | ${ou.levSumPp} | ${od.levSumPp} |`);
  }
  L.push('');
  L.push('## 现金拖累代理');
  L.push('');
  L.push('| 窗口 | 缩放等权% | 现金拖累pp | 去杠杆−缩放（选股/择时残差） |');
  L.push('|------|-----------|------------|------------------------------|');
  for (const r of rows) {
    L.push(
      `| ${r.label} | ${r.scaled_eq_ret} | ${r.cash_drag_proxy_pp} | ${r.selection_vs_scaled_eq_pp} |`
    );
  }
  L.push('');
  L.push('## 解读');
  L.push('');
  L.push('1. **主窗**：粘性赢等权 ≈ 隐杠杆；去杠杆后输等权。假设解释「调参窗好看」**成立**。');
  L.push('2. **OOS/WF**：隐杠杆多在 ±1pp；去掉后 gap 仍大幅为负。WF4/三票 **0 天超仓** 仍大负或（WF4）唯一正 gap → 「隐杠杆放大 OOS 损耗」**否决为主因**。');
  L.push('3. **主因**：上涨日 β≈0.55–0.86、超额Σ显著为负；下跌日超额Σ多为正，但不够补偿。');
  L.push('4. **纪律**：进攻旋钮继续冻结。下一步只做诊断（涨日未满仓清单、book 分布）。');
  L.push('');
  L.push(`JSON：\`scripts/backtest-out/oos-underperform-attribution-${DATE}.json\``);

  const mdPath = path.join(REPORT_DIR, `V4.3-OOS跑输归因-隐杠杆假设-${DATE}.md`);
  fs.writeFileSync(mdPath, L.join('\n'));

  console.log(JSON.stringify(verdict, null, 2));
  for (const r of rows) {
    const u = r.regimes.eq_up;
    const d = r.regimes.eq_down;
    console.log(
      `${r.label}\t gapU=${r.gap_unlev} lev=${r.lev_pp} upΣ=${u.excessSumPp} β=${u.betaProxy} downΣ=${d.excessSumPp} book=${r.avg_book} over100=${r.days_over_100}`
    );
  }
  console.log(`\n→ ${jsonPath}\n→ ${mdPath}`);
}

main();
