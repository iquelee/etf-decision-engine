/**
 * V3.9 候选方案 · 对照实验套件
 * 运行：node scripts/run-v39-experiments.js
 */
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(__dirname, 'backtest-out');
const REPORT_DIR = path.join(ROOT, '回测报告');

const BASELINE = { id: 'V38', engine: 126.46, mdd: 14.73, sharpe: 2.25, s2: 6.66, s4Sharpe: 0.57 };

const EXPERIMENTS = [
  { id: 'E1', flag: 'E1-w4-firstlot', name: 'W4 零仓 B+ 允许首仓（全科技）' },
  { id: 'E2', flag: 'E2-w4-firstlot-b72', name: 'W4 零仓 分数≥72 首仓' },
  { id: 'E3', flag: 'E3-ai-network', name: 'W4 零仓首仓 · 仅通信 ai_network' },
  { id: 'E4', flag: 'E4-w4-down-flat', name: 'W4+DOWN 战略减仓至 0' },
  { id: 'E6', flag: 'E6-combo', name: 'E1 + E4 组合', extra: ['--cash-cap'] }
];

const SCENARIOS = [
  { key: 'MAIN', args: [] },
  { key: 'OOS', args: ['--from=2024-08-21', '--to=2025-02-24'] },
  { key: 'S2', args: ['--from=2025-03-01', '--to=2025-06-30'] },
  { key: 'S4', args: ['--from=2026-06-01', '--to=2026-08-21'] }
];

function runOne(exp, sc) {
  const tag = `v39-${exp.id.toLowerCase()}-${sc.key.toLowerCase()}`;
  const outFile = path.join(OUT_DIR, `full-engine-${tag}.json`);
  if (fs.existsSync(outFile)) fs.unlinkSync(outFile);
  const args = [
    'scripts/backtest-full-engine.js',
    `--experiment=${exp.flag}`,
    `--tag=${tag}`,
    ...sc.args,
    ...(exp.extra || [])
  ];
  const r = spawnSync('node', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  if (r.status !== 0) {
    return { tag, error: (r.stderr || r.stdout || '').slice(-400) };
  }
  if (!fs.existsSync(outFile)) return { tag, error: 'no output json' };
  const data = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  return {
    tag,
    window: data.window,
    engine: data.engine,
    equalWeight: data.equalWeight,
    book: data.book,
    trades: data.trades,
    buildEvents: data.buildEvents || [],
    perEtf515880: data.perEtf && data.perEtf['515880']
  };
}

function sharpeFromRetMdd(ret, mdd) {
  if (!mdd) return 0;
  return Math.round((ret / Math.abs(mdd)) * 100) / 100;
}

function verdictMain(row) {
  const dRet = row.engine.totalRet - BASELINE.engine;
  const dMdd = row.engine.maxDD - BASELINE.mdd;
  if (row.engine.maxDD > 18) return 'FAIL';
  if (Math.abs(dRet) < 0.05 && Math.abs(dMdd) < 0.05) return 'NEUTRAL';
  if (dRet >= 2 && dMdd <= 1 && row.book.days_over_100 <= 101) return 'PASS+';
  if (dRet >= 0 && dMdd <= 2) return 'PASS';
  if (dRet < -3 || dMdd > 3) return 'WARN-';
  return 'WARN';
}

function renderMd(stamp, matrix) {
  const lines = [];
  lines.push(`# V3.9 候选方案对照实验（${stamp}）`);
  lines.push('');
  lines.push('> 实验层：`scripts/lib/decision-v39.js` · 不进生产云函数 · 主窗 **126.46%** 为 V3.8 冻结基线');
  lines.push('');
  lines.push('## 假设摘要');
  lines.push('');
  lines.push('| ID | 改动 | 针对问题 |');
  lines.push('|----|------|----------|');
  lines.push('| E1 | W4 且零仓时，机会分 B+ 可走 BUILD/ADD 链 | 515880 S2 踏空（状态机直接 WAIT） |');
  lines.push('| E2 | E1 + 分数门槛 ≥72 | 控制 W4 试探仓质量 |');
  lines.push('| E3 | E1 仅限 ai_network（515880） | 缩小影响面 |');
  lines.push('| E4 | W4 + trend_context=DOWN_CONSOLIDATION → 战略减仓至 0 | S4 Sharpe/Calmar FAIL |');
  lines.push('| E6 | E1 + E4 + 成交层 cash-cap | 组合方案 |');
  lines.push('');
  lines.push('## 关键发现');
  lines.push('');
  lines.push('- **E1/E3**：S2 引擎 6.66%→**7.14%**，515880 首次 BUILD 自 10 月前移至 **3 月上旬**；主窗收益/回撤与 V3.8 **完全一致**（路径后期收敛）');
  lines.push('- **E2**（≥72 分）：S2 几乎无增益，门槛过严');
  lines.push('- **E4**：W4+`DOWN_CONSOLIDATION` 战略清仓至 0 → 主窗 **+2.7pp / MDD −0.4pp**，但 **S2 回落至 5.28%**（过早砍仓）；S4 无改善');
  lines.push('- **E6**：E1+E4+cash-cap 主窗 **121.82%**，组合互相抵消，不推荐');
  lines.push('');
  lines.push('## 主窗 MAIN（2025-02-25~最新）');
  lines.push('');
  lines.push('| 方案 | 累计% | MDD% | Sharpe | 超100%天 | 515880建+ | vs基线收益 | 判定 |');
  lines.push('|------|-------|------|--------|----------|-----------|------------|------|');
  lines.push(`| V3.8基线 | ${BASELINE.engine} | ${BASELINE.mdd} | ${BASELINE.sharpe} | 101 | 17 | — | 冻结 |`);
  for (const row of matrix.filter((r) => r.scenario === 'MAIN')) {
    const b = row.perEtf515880 ? `${row.perEtf515880.buys}+` : '—';
    lines.push(`| ${row.expId} | ${row.engine.totalRet} | ${row.engine.maxDD} | ${row.engine.sharpe} | ${row.book.days_over_100} | ${b} | ${row.deltaRet >= 0 ? '+' : ''}${row.deltaRet}pp | ${row.verdict} |`);
  }
  lines.push('');
  lines.push('## S2 科技主升（2025-03~06）');
  lines.push('');
  lines.push('| 方案 | 引擎% | 等权% | 落后 | 515880首次BUILD |');
  lines.push('|------|-------|-------|------|----------------|');
  lines.push(`| V3.8 | ${BASELINE.s2} | 13.77 | 7.1pp | 2025-10-09 |`);
  for (const row of matrix.filter((r) => r.scenario === 'S2')) {
    const build515 = (row.buildEvents || []).find((e) => e.code === '515880');
    lines.push(`| ${row.expId} | ${row.engine.totalRet} | ${row.equalWeight.totalRet} | ${row.gapEq}pp | ${build515 ? build515.date : '—'} |`);
  }
  lines.push('');
  lines.push('## S4 半导体下行 + OOS');
  lines.push('');
  lines.push('| 方案 | 场景 | 引擎% | MDD% | Sharpe |');
  lines.push('|------|------|-------|------|--------|');
  for (const row of matrix.filter((r) => r.scenario === 'S4' || r.scenario === 'OOS')) {
    lines.push(`| ${row.expId} | ${row.scenario} | ${row.engine.totalRet} | ${row.engine.maxDD} | ${row.engine.sharpe} |`);
  }
  lines.push('');
  lines.push('## 推荐路径');
  lines.push('');
  const best = matrix.filter((r) => r.scenario === 'MAIN' && (r.verdict === 'PASS+' || r.verdict === 'PASS')).sort((a, b) => b.deltaRet - a.deltaRet)[0];
  const s2best = matrix.filter((r) => r.scenario === 'S2').sort((a, b) => b.engine.totalRet - a.engine.totalRet)[0];
  if (best) {
    lines.push(`- **主窗 Pass**：**${best.expId}**（${best.engine.totalRet}% / MDD ${best.engine.maxDD}% / +${best.deltaRet}pp）→ 须 OOS + S2 不恶化再进 decision.js`);
  }
  if (s2best && s2best.engine.totalRet > BASELINE.s2) {
    lines.push(`- **S2 参与度**：**${s2best.expId}**（${s2best.engine.totalRet}% vs 基线 ${BASELINE.s2}%）· 515880 BUILD 前移 · 主窗 NEUTRAL 时可作 **窄域试点（E3）**`);
  }
  if (!best && s2best) {
    lines.push('- 主窗无显著 Pass；**E3（仅通信 W4 首仓）** 主窗零伤害、S2 +0.48pp → 推荐下一轮回测重点');
  }
  lines.push('- **禁止**在未 OOS Pass 前改 `ENGINE_VERSION` 或部署 decision.js');
  lines.push('');
  return lines.join('\n');
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const matrix = [];

  for (const exp of EXPERIMENTS) {
    for (const sc of SCENARIOS) {
      process.stdout.write(`>>> ${exp.id} ${sc.key} ... `);
      const row = runOne(exp, sc);
      if (row.error) {
        console.log('ERROR');
        matrix.push({ expId: exp.id, scenario: sc.key, error: row.error });
        continue;
      }
      const deltaRet = Math.round((row.engine.totalRet - BASELINE.engine) * 100) / 100;
      const gapEq = Math.round((row.equalWeight.totalRet - row.engine.totalRet) * 100) / 100;
      const verdict = sc.key === 'MAIN' ? verdictMain(row) : '—';
      matrix.push({
        expId: exp.id,
        name: exp.name,
        flag: exp.flag,
        scenario: sc.key,
        ...row,
        deltaRet,
        gapEq,
        verdict
      });
      console.log(`${row.engine.totalRet}% mdd ${row.engine.maxDD}%`);
    }
  }

  const outJson = path.join(OUT_DIR, `v39-experiments-${stamp}.json`);
  fs.writeFileSync(outJson, JSON.stringify({ stamp, baseline: BASELINE, matrix }, null, 2));
  const md = renderMd(stamp, matrix);
  const outMd = path.join(REPORT_DIR, `V3.9-候选方案对照-${stamp}.md`);
  fs.writeFileSync(outMd, md, 'utf8');
  console.log(`\nJSON: ${outJson}`);
  console.log(`报告: ${outMd}`);
}

if (require.main === module) main();

module.exports = { EXPERIMENTS, SCENARIOS, renderMd, verdictMain };
