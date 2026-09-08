/**
 * V4.3 独立系列 regime 回测批跑 + 汇总 JSON/MD
 * 运行：node scripts/run-v43-regime-suite.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(__dirname, 'backtest-out');
const REPORT_DIR = path.join(ROOT, '回测报告');
const DATE = new Date().toISOString().slice(0, 10);

const RUNS = [
  {
    tag: 'v43-main-verify',
    label: '五票主窗验证',
    codes: null,
    csvDir: null,
    from: '2025-02-25',
    to: '2026-08-21',
    mixForbidden: false,
    note: '对照冻结 126.46% / MDD 14.73%'
  },
  {
    tag: 'v43-3t-2024',
    label: '三票 2024→主窗前',
    codes: '518880,515880,513310',
    csvDir: 'deliverables/etf_daily_3ticket',
    from: '2024-01-01',
    to: '2025-02-24',
    mixForbidden: true,
    note: '三票独立系列，不得与五票混比'
  },
  {
    tag: 'v43-3t-2022-24',
    label: '三票 2022–2024',
    codes: '518880,515880,513310',
    csvDir: 'deliverables/etf_daily_3ticket',
    from: '2022-01-01',
    to: '2024-12-31',
    mixForbidden: true,
    note: '513310 2022-12 上市；eval 自 2023-03-24'
  },
  {
    tag: 'v43-2t-2022-24',
    label: '两票 2022–2024（黄金+通信）',
    codes: '518880,515880',
    csvDir: 'deliverables/etf_daily_3ticket',
    from: '2022-01-01',
    to: '2024-12-31',
    mixForbidden: true,
    note: '2022 熊市段两票口径'
  }
];

function runOne(cfg) {
  const args = ['scripts/backtest-full-engine.js', `--from=${cfg.from}`];
  if (cfg.to) args.push(`--to=${cfg.to}`);
  if (cfg.codes) args.push(`--codes=${cfg.codes}`);
  if (cfg.csvDir) args.push(`--csv-dir=${cfg.csvDir}`);
  args.push(`--tag=${cfg.tag}`);
  console.log(`\n>>> ${cfg.label}  (${cfg.tag})`);
  const r = spawnSync('node', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) {
    throw new Error(`${cfg.tag} 失败 exit=${r.status}`);
  }
  const outFile = path.join(OUT_DIR, `full-engine-${cfg.tag}.json`);
  if (!fs.existsSync(outFile)) {
    throw new Error(`缺少输出 ${outFile}`);
  }
  return JSON.parse(fs.readFileSync(outFile, 'utf8'));
}

function gap(engine, equal) {
  if (engine == null || equal == null) return null;
  return Math.round((engine - equal) * 100) / 100;
}

function mdTable(rows) {
  const lines = [
    '| 系列 | 窗口 | 天数 | 引擎% | 等权% | gap | MDD% | Sharpe |',
    '|------|------|------|-------|-------|-----|------|--------|'
  ];
  for (const r of rows) {
    lines.push(
      `| ${r.label} | ${r.window} | ${r.days} | ${r.engineRet} | ${r.equalRet} | ${r.gap} | ${r.mdd} | ${r.sharpe} |`
    );
  }
  return lines.join('\n');
}

function main() {
  const results = [];
  for (const cfg of RUNS) {
    const j = runOne(cfg);
    const w = j.window || {};
    const eng = j.engine || {};
    const eq = j.equalWeight || {};
    results.push({
      tag: cfg.tag,
      label: cfg.label,
      note: cfg.note,
      mixForbidden: cfg.mixForbidden,
      window: `${w.start || w.from} ~ ${w.end || w.to}`,
      days: w.days,
      engineRet: eng.totalRet,
      equalRet: eq.totalRet,
      gap: gap(eng.totalRet, eq.totalRet),
      mdd: eng.maxDD,
      sharpe: eng.sharpe,
      raw: j
    });
  }

  const suiteJson = {
    date: DATE,
    version: 'V4.3',
    discipline: '只评不调 · 独立系列不得与 126.46% 混比',
    runs: results.map((r) => ({
      tag: r.tag,
      label: r.label,
      window: r.window,
      days: r.days,
      engineRet: r.engineRet,
      equalRet: r.equalRet,
      gap: r.gap,
      mdd: r.mdd,
      sharpe: r.sharpe,
      note: r.note
    }))
  };
  const jsonPath = path.join(OUT_DIR, `regime-suite-${DATE}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(suiteJson, null, 2));

  const md = [
    `# V4.3 独立系列 Regime 验收（${DATE}）`,
    '',
    '> **只评不调** · 三票/两票与五票主窗分开展示',
    '> 脚本：`node scripts/run-v43-regime-suite.js`',
  `> JSON：` + `scripts/backtest-out/regime-suite-${DATE}.json`,
    '',
    '## 三票 CSV 覆盖（腾讯 fallback）',
    '',
    '| 代码 | 根数 | 起点 | 终点 |',
    '|------|------|------|------|',
    '| 518880 | 1854 | 2019-01-02 | 2026-08-24 |',
    '| 515880 | 1687 | 2019-09-06 | 2026-08-24 |',
    '| 513310 | 889 | 2022-12-22 | 2026-08-24 |',
    '',
    '东财仍 socket hang up；`fetch-3ticket-history.js` 已用腾讯年切补全。',
    '',
    '## 回测汇总',
    '',
    mdTable(results),
    '',
    '## 口径',
    '',
    '- **主窗验证**：应与冻结 `full-engine-v39-main-frozen.json` 一致（126.46% / MDD 14.73%）',
    '- **三票 2022–24**：513310 上市前仅两票有数据；引擎按 universe 交集 eval',
    '- **不调参**：WF 平均 gap −5.33pp 后禁止进攻性旋钮',
    '',
    '## 各 run 备注',
    '',
    ...results.map((r) => `- **${r.label}**（${r.tag}）：${r.note}`)
  ].join('\n');

  const mdPath = path.join(REPORT_DIR, `V4.3-regime-suite-${DATE}.md`);
  fs.writeFileSync(mdPath, md);
  console.log(`\n汇总 JSON: ${jsonPath}`);
  console.log(`报告: ${mdPath}`);
}

main();
