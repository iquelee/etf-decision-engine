/**
 * V3.8 回测标准 · 一键执行套件
 * 运行：node scripts/run-v38-backtest-suite.js
 */
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(__dirname, 'backtest-out');
const REPORT_DIR = path.join(ROOT, '回测报告');

const SCENARIOS = [
  {
    id: 'MAIN',
    name: '五票主窗（B 成本 0.03% 双边）',
    args: ['--tag=v38-exec-main'],
    pool: '5ticket'
  },
  {
    id: 'OOS',
    name: '样本外（五票上市对齐后 ~ 调参窗前）',
    args: ['--from=2024-08-21', '--to=2025-02-24', '--tag=v38-exec-oos'],
    pool: '5ticket'
  },
  {
    id: 'S1',
    name: 'S1 2024Q1 急跌（三票：黄金+通信+中韩半导体）',
    args: [
      '--codes=518880,515880,513310',
      '--csv-dir=deliverables/etf_daily_3ticket',
      '--from=2024-01-01',
      '--to=2024-03-31',
      '--tag=v38-exec-s1'
    ],
    pool: '3ticket'
  },
  {
    id: 'S2',
    name: 'S2 2025 科技主升（五票）',
    args: ['--from=2025-03-01', '--to=2025-06-30', '--tag=v38-exec-s2'],
    pool: '5ticket'
  },
  {
    id: 'S3',
    name: 'S3 2025 黄金独涨段（五票）',
    args: ['--from=2025-09-01', '--to=2025-12-31', '--tag=v38-exec-s3'],
    pool: '5ticket'
  },
  {
    id: 'S4',
    name: 'S4 2026 半导体下行（五票）',
    args: ['--from=2026-06-01', '--to=2026-08-21', '--tag=v38-exec-s4'],
    pool: '5ticket'
  },
  {
    id: 'S5',
    name: 'S5 创新药高波动（五票 2025H2）',
    args: ['--from=2025-07-01', '--to=2025-11-30', '--tag=v38-exec-s5'],
    pool: '5ticket'
  },
  {
    id: 'S6',
    name: 'S6 合成 F 路径（五票全窗）',
    args: ['--f-path', '--tag=v38-exec-s6-fpath'],
    pool: '5ticket'
  }
];

function runScenario(sc) {
  const tagArg = sc.args.find((a) => a.startsWith('--tag='));
  const tag = tagArg ? tagArg.slice(6) : 'unknown';
  const outFile = path.join(OUT_DIR, `full-engine-${tag}.json`);
  if (fs.existsSync(outFile)) fs.unlinkSync(outFile);

  const cmd = ['scripts/backtest-full-engine.js', ...sc.args];
  console.log(`\n>>> ${sc.id} ${sc.name}`);
  const r = spawnSync('node', cmd, { cwd: ROOT, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) {
    return { id: sc.id, name: sc.name, pool: sc.pool, error: r.stderr || `exit ${r.status}` };
  }
  if (!fs.existsSync(outFile)) {
    return { id: sc.id, name: sc.name, pool: sc.pool, error: `missing ${outFile}` };
  }
  const data = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  return enrichMetrics(sc, data);
}

function enrichMetrics(sc, data) {
  const eng = data.engine || {};
  const eq = data.equalWeight || {};
  const days = (data.window && data.window.days) || 0;
  const finalNav = eng.finalNav || 100;
  const totalRet = eng.totalRet || 0;
  const maxDD = eng.maxDD || 0;
  const sharpe = eng.sharpe || 0;

  let annRet = 0;
  let calmar = 0;
  if (days > 0 && finalNav > 0) {
    annRet = Math.pow(finalNav / 100, 252 / days) - 1;
    calmar = maxDD !== 0 ? annRet / Math.abs(maxDD / 100) : 0;
  }

  const monthly = data.monthly || {};
  const monthKeys = Object.keys(monthly).sort();
  let winMonths = 0;
  let totalMonths = 0;
  for (const k of monthKeys) {
    const m = monthly[k];
    if (m && m.engine != null) {
      totalMonths += 1;
      if (m.engine > 0) winMonths += 1;
    }
  }
  const monthWinPct = totalMonths ? Math.round((winMonths / totalMonths) * 1000) / 10 : 0;

  const eqRet = eq.totalRet || 0;
  let eqMaxDD = 0;
  let peak = -Infinity;
  if (data.navSeries && data.navSeries.length) {
    for (const n of data.navSeries) {
      peak = Math.max(peak, n.equalWeight);
      eqMaxDD = Math.max(eqMaxDD, peak > 0 ? ((peak - n.equalWeight) / peak) * 100 : 0);
    }
  }
  const ddGap = eqMaxDD - maxDD;

  const book = data.book || {};
  const verdict = judgePass({ maxDD, sharpe, calmar, monthWinPct, ddGap, daysOver100: book.days_over_100 || 0, pool: sc.pool });

  return {
    id: sc.id,
    name: sc.name,
    pool: sc.pool,
    window: data.window,
    engine: {
      totalRet,
      maxDD,
      sharpe: Math.round(sharpe * 100) / 100,
      calmar: Math.round(calmar * 100) / 100,
      annRetPct: Math.round(annRet * 10000) / 100,
      finalNav
    },
    equalWeight: { totalRet: eqRet, maxDD: Math.round(eqMaxDD * 100) / 100 },
    ddGapPP: Math.round(ddGap * 10) / 10,
    book: {
      avg: book.avg,
      end: book.end,
      max: book.max,
      days_over_100: book.days_over_100
    },
    trades: data.trades,
    monthWinPct,
    winMonths,
    totalMonths,
    verdict,
    mix_forbidden: data.mix_forbidden,
    listing_block: data.listing_block
  };
}

function judgePass({ maxDD, sharpe, calmar, monthWinPct, ddGap, daysOver100, pool }) {
  const fails = [];
  const warns = [];
  if (maxDD < -25) fails.push(`MDD ${maxDD}% > −25%`);
  else if (maxDD < -18) warns.push(`MDD ${maxDD}% 在 Warn 区（−18%~−25%）`);
  if (sharpe < 0.8) fails.push(`Sharpe ${sharpe} < 0.8`);
  else if (sharpe < 1.2) warns.push(`Sharpe ${sharpe} < 1.2`);
  if (calmar < 0.6) fails.push(`Calmar ${calmar.toFixed(2)} < 0.6`);
  else if (calmar < 1.0) warns.push(`Calmar ${calmar.toFixed(2)} < 1.0`);
  if (monthWinPct < 50) fails.push(`月度胜率 ${monthWinPct}% < 50%`);
  else if (monthWinPct < 55) warns.push(`月度胜率 ${monthWinPct}% < 55%`);
  if (pool === '5ticket' && ddGap < 4) warns.push(`相对等权回撤保护仅 ${ddGap.toFixed(1)}pp`);
  if (daysOver100 > 5) warns.push(`超100% book ${daysOver100} 天（决策层合计>100%，需对照 mtm/去杠杆）`);
  if (fails.length) return { level: 'FAIL', fails, warns };
  if (warns.length) return { level: 'WARN', fails: [], warns };
  return { level: 'PASS', fails: [], warns: [] };
}

function renderMarkdown(results, stamp) {
  const lines = [];
  lines.push(`# V3.8 回测执行报告（${stamp}）`);
  lines.push('');
  lines.push('> 成本档：**B 标准**（单边佣金 0.03%，脚本 `TRADE_COST_PCT`）· 引擎 **V3.8** · 主脚本 `backtest-full-engine.js`');
  lines.push('> 说明：五票主窗与 **126.46%** 基线同窗；子集窗 **不得** 与五票累计混比。');
  lines.push('');
  lines.push('## 总览');
  lines.push('');
  lines.push('| ID | 场景 | 池 | 累计% | MDD% | Sharpe | Calmar | 月胜率 | 均仓% | 成交 | 等权% | 回撤差pp | 判定 |');
  lines.push('|----|------|----|-------|------|--------|--------|--------|-------|------|-------|----------|------|');
  for (const r of results) {
    if (r.error) {
      lines.push(`| ${r.id} | ${r.name} | ${r.pool} | — | — | — | — | — | — | — | — | — | **ERROR** |`);
      continue;
    }
    lines.push([
      r.id,
      r.name.replace(/\|/g, '/'),
      r.pool,
      r.engine.totalRet,
      r.engine.maxDD,
      r.engine.sharpe,
      r.engine.calmar,
      `${r.monthWinPct}%`,
      r.book.avg ?? '—',
      r.trades ?? '—',
      r.equalWeight.totalRet,
      r.ddGapPP,
      r.verdict.level
    ].join(' | '));
  }
  lines.push('');
  lines.push('## 分项说明');
  lines.push('');
  for (const r of results) {
    lines.push(`### ${r.id} · ${r.name}`);
    if (r.error) {
      lines.push(`- **失败**：${r.error}`);
      lines.push('');
      continue;
    }
    lines.push(`- 窗口：${r.window.start} ~ ${r.window.end}（${r.window.days} 日）`);
    if (r.listing_block) lines.push(`- 上市约束：${r.listing_block}`);
    if (r.mix_forbidden) lines.push('- ⚠️ 独立票池，不得与五票 126.46% 混比');
    lines.push(`- 引擎：累计 **${r.engine.totalRet}%** · MDD **${r.engine.maxDD}%** · Sharpe **${r.engine.sharpe}** · Calmar **${r.engine.calmar}** · 年化 **${r.engine.annRetPct}%**`);
    lines.push(`- 等权 BM1：累计 **${r.equalWeight.totalRet}%** · MDD **${r.equalWeight.maxDD}%** · 回撤保护 **${r.ddGapPP}pp**`);
    lines.push(`- 仓位：日均 **${r.book.avg}%** · 期末 **${r.book.end}%** · 峰值 **${r.book.max}%** · 超100% **${r.book.days_over_100}** 天`);
    lines.push(`- 月度胜率：**${r.winMonths}/${r.totalMonths}**（${r.monthWinPct}%）`);
    if (r.verdict.warns.length) lines.push(`- Warn：${r.verdict.warns.join('；')}`);
    if (r.verdict.fails.length) lines.push(`- Fail：${r.verdict.fails.join('；')}`);
    lines.push('');
  }
  lines.push('## 结论（稳健性）');
  lines.push('');
  const main = results.find((r) => r.id === 'MAIN' && !r.error);
  if (main) {
    lines.push(`- **主窗**（${main.window.start}~${main.window.end}）：引擎 ${main.engine.totalRet}% vs 等权 ${main.equalWeight.totalRet}%；回撤 ${main.engine.maxDD}% vs ${main.equalWeight.maxDD}%（保护 ${main.ddGapPP}pp）→ **${main.verdict.level}**`);
  }
  const fails = results.filter((r) => r.verdict && r.verdict.level === 'FAIL');
  if (fails.length) {
    lines.push(`- **需关注**：${fails.map((r) => r.id).join('、')} 未达 Pass`);
  } else {
    lines.push('- 全部场景无 FAIL（子集窗仅作环境压力参考）');
  }
  lines.push('');
  lines.push('## 原始 JSON');
  lines.push('');
  lines.push('`scripts/backtest-out/full-engine-v38-exec-*.json`');
  lines.push('');
  return lines.join('\n');
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const results = [];
  for (const sc of SCENARIOS) {
    results.push(runScenario(sc));
  }
  const summaryFile = path.join(OUT_DIR, `v38-exec-suite-${stamp}.json`);
  fs.writeFileSync(summaryFile, JSON.stringify({ stamp, results }, null, 2));
  const md = renderMarkdown(results, stamp);
  const reportFile = path.join(REPORT_DIR, `V3.8-回测执行报告-${stamp}.md`);
  fs.writeFileSync(reportFile, md, 'utf8');
  console.log('\n════════ 套件完成 ════════');
  console.log(`汇总 JSON: ${summaryFile}`);
  console.log(`报告 MD:   ${reportFile}`);
  for (const r of results) {
    if (r.error) console.log(`  ${r.id}: ERROR`);
    else console.log(`  ${r.id}: ${r.verdict.level} | ret ${r.engine.totalRet}% mdd ${r.engine.maxDD}% calmar ${r.engine.calmar}`);
  }
}

if (require.main === module) main();

module.exports = { SCENARIOS, enrichMetrics, judgePass, renderMarkdown };
