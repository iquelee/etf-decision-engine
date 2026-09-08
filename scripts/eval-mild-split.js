/**
 * V3.1 B7：把已有全窗回测按时间切前 70% / 后 30%，只评不调。
 * 不搜索 volume_ratio_mild。后段明显变差 → 记录回退 0.90 的建议，禁止全窗再搜。
 *
 * 运行：node scripts/eval-mild-split.js [jsonPath]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, 'backtest-out');
const arg = process.argv[2];
const src = arg
  ? path.resolve(arg)
  : path.join(OUT_DIR, 'full-engine-2026-08-22.json');

if (!fs.existsSync(src)) {
  console.error('找不到回测 JSON:', src);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(src, 'utf8'));
const nav = data.navSeries || [];
if (nav.length < 20) {
  console.error('navSeries 太短');
  process.exit(1);
}

const cut = Math.floor(nav.length * 0.7);
const first = nav.slice(0, cut);
const last = nav.slice(cut);

function stats(series) {
  const a = series[0].engine;
  const b = series[series.length - 1].engine;
  const eqA = series[0].equalWeight;
  const eqB = series[series.length - 1].equalWeight;
  let peak = -Infinity, maxDD = 0;
  for (const n of series) {
    peak = Math.max(peak, n.engine);
    maxDD = Math.max(maxDD, (peak - n.engine) / peak * 100);
  }
  return {
    start: series[0].date,
    end: series[series.length - 1].date,
    days: series.length,
    engineRet: Math.round((b / a - 1) * 10000) / 100,
    equalRet: Math.round((eqB / eqA - 1) * 10000) / 100,
    maxDD: Math.round(maxDD * 100) / 100
  };
}

const train = stats(first);
const valid = stats(last);
const trainGap = Math.round((train.engineRet - train.equalRet) * 100) / 100;
const validGap = Math.round((valid.engineRet - valid.equalRet) * 100) / 100;
train.vsEqual = trainGap;
valid.vsEqual = validGap;
const verdict = validGap + 8 < trainGap
  ? '后段相对等权明显变差：0.95 视为假设，可回退 0.90，禁止全窗再搜 mild'
  : '后段相对等权未明显变差（绝对收益低多半是行情弱）。维持冻结 0.95，仍不当作定版参数';

function monthlyByCut(monthly, cutDate) {
  const rows = [];
  for (const ym of Object.keys(monthly || {}).sort()) {
    const m = monthly[ym];
    const side = ym + '-28' <= cutDate ? 'train' : 'valid';
    rows.push({
      month: ym,
      side,
      engine: m.engine,
      equal: m.equal,
      gap: Math.round((m.engine - m.equal) * 100) / 100
    });
  }
  return rows;
}

const monthly = monthlyByCut(data.monthly, first[first.length - 1].date);
const report = {
  source: src, mild: 0.95, frozen: true, train, valid, verdict,
  note: '一次性时间切分，不是 walk-forward。验证段短，不得当成参数已稳健。',
  monthly
};
const out = path.join(OUT_DIR, `mild-split-${new Date().toISOString().slice(0, 10)}.json`);
fs.writeFileSync(out, JSON.stringify(report, null, 2));

console.log('════════ V3.1 B7  0.95 前后段只评不调 ════════');
console.log(`前 70%  ${train.start} ~ ${train.end}  引擎 ${train.engineRet}%  等权 ${train.equalRet}%  回撤 ${train.maxDD}%`);
console.log(`后 30%  ${valid.start} ~ ${valid.end}  引擎 ${valid.engineRet}%  等权 ${valid.equalRet}%  回撤 ${valid.maxDD}%`);
console.log(verdict);
console.log('月度（只评不调；train=切分日前，valid=切分日后）：');
for (const r of monthly) {
  console.log(`  ${r.month}  ${r.side.padEnd(6)}  引擎 ${r.engine}%  等权 ${r.equal}%  差 ${r.gap}pp`);
}
console.log('输出:', out);
