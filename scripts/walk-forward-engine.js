/**
 * V4.3 Walk-forward（只评不调）：五票交集上切 N 段连续验证窗，冻结参数全窗复跑。
 * 非参数搜索——每段独立 OOS 评估，汇总引擎 vs 等权 gap。
 *
 * 运行：
 *   node scripts/walk-forward-engine.js
 *   node scripts/walk-forward-engine.js --folds=4 --eval-from=2024-07-15
 *   node scripts/walk-forward-engine.js --dry-run
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { getCsvCoverage, DEFAULT_CSV_DIR } = require('./lib/csv-coverage.js');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(__dirname, 'backtest-out');

function argVal(name) {
  const hit = process.argv.find((a) => a.indexOf(name + '=') === 0);
  return hit ? hit.slice(name.length + 1) : null;
}

function buildFolds(evalDates, folds) {
  const n = evalDates.length;
  const size = Math.floor(n / folds);
  if (size < 20) throw new Error(`eval 日不足 ${n}，无法切 ${folds} 段（每段至少 20 日）`);
  const out = [];
  for (let i = 0; i < folds; i++) {
    const startIdx = i * size;
    const endIdx = i === folds - 1 ? n - 1 : (i + 1) * size - 1;
    out.push({
      fold: i + 1,
      from: evalDates[startIdx],
      to: evalDates[endIdx],
      days: endIdx - startIdx + 1
    });
  }
  return out;
}

function runFold(fold) {
  const tag = `wf-fold-${fold.fold}`;
  const cmd = [
    'node', 'scripts/backtest-full-engine.js',
    `--from=${fold.from}`,
    `--to=${fold.to}`,
    `--tag=${tag}`
  ].join(' ');
  console.log(`\n── Fold ${fold.fold}: ${fold.from} ~ ${fold.to} (${fold.days} 日) ──`);
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
  const jsonPath = path.join(OUT_DIR, `full-engine-${tag}.json`);
  if (!fs.existsSync(jsonPath)) throw new Error(`缺少输出 ${jsonPath}`);
  return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
}

function main() {
  const folds = Number(argVal('--folds') || 4);
  const csvDir = argVal('--csv-dir') ? path.resolve(argVal('--csv-dir')) : DEFAULT_CSV_DIR;
  const dry = process.argv.indexOf('--dry-run') >= 0;
  const cov = getCsvCoverage(csvDir);
  const evalFrom = argVal('--eval-from') || cov.intersection.evalStartAfterWarmup;
  const evalTo = argVal('--eval-to') || cov.intersection.end;

  const { ALL_ETFS } = require('./lib/universe.js');
  const { loadCsv } = require('./lib/csv-coverage.js');
  const { intersectTradeDates } = require('./lib/universe.js');
  const barsMap = {};
  for (const etf of ALL_ETFS) barsMap[etf.code] = loadCsv(etf.code, csvDir);
  const dates = intersectTradeDates(barsMap, ALL_ETFS);
  const evalDates = dates.filter((d) => d >= evalFrom && d <= evalTo);
  if (evalDates.length < folds * 20) {
    console.error(`eval 区间 ${evalFrom}~${evalTo} 仅 ${evalDates.length} 日，不足以 walk-forward`);
    process.exit(1);
  }

  const foldPlan = buildFolds(evalDates, folds);
  console.log('════════ V4.3 Walk-forward（只评不调）════════');
  console.log(`CSV: ${csvDir}`);
  console.log(`五票交集: ${cov.intersection.start} ~ ${cov.intersection.end}`);
  console.log(`Eval: ${evalFrom} ~ ${evalTo}  (${evalDates.length} 交易日，${folds} 折)`);
  if (dry) {
    foldPlan.forEach((f) => console.log(`  Fold ${f.fold}: ${f.from} ~ ${f.to}`));
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const results = foldPlan.map((f) => {
    const summary = runFold(f);
    const eng = summary.engine.totalRet;
    const eq = summary.equalWeight.totalRet;
    const gap = Math.round((eng - eq) * 100) / 100;
    return {
      fold: f.fold,
      from: f.from,
      to: f.to,
      days: summary.window.days,
      engineRet: eng,
      equalRet: eq,
      gap_pp: gap,
      maxDD: summary.engine.maxDD,
      sharpe: summary.engine.sharpe,
      book_end: summary.book && summary.book.end,
      days_over_100: summary.book && summary.book.days_over_100,
      unlevRet: summary.book && summary.book.unlev_totalRet,
      leverage_pp: summary.book && summary.book.leverage_contrib_pp,
      tag: `wf-fold-${f.fold}`
    };
  });

  const avgGap = Math.round(results.reduce((s, r) => s + r.gap_pp, 0) / results.length * 100) / 100;
  const wins = results.filter((r) => r.gap_pp > 0).length;
  const report = {
    version: 'V4.3',
    mode: 'walk-forward-eval-only',
    note: '冻结参数、每折独立 OOS；不得与调参窗 126.46% 混比',
    csvDir,
    eval: { from: evalFrom, to: evalTo, folds },
    folds: results,
    aggregate: {
      avg_gap_pp: avgGap,
      folds_beat_equal: wins,
      folds_total: results.length
    }
  };

  const stamp = new Date().toISOString().slice(0, 10);
  const outFile = path.join(OUT_DIR, `walk-forward-${stamp}.json`);
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));

  console.log('\n════════ 汇总 ════════');
  for (const r of results) {
    console.log(`Fold ${r.fold}  ${r.from}~${r.to}  引擎 ${r.engineRet}%  等权 ${r.equalRet}%  gap ${r.gap_pp}pp  超100% ${r.days_over_100}天`);
  }
  console.log(`平均 gap: ${avgGap}pp | 跑赢等权 ${wins}/${results.length} 折`);
  console.log('输出:', outFile);
}

main();
