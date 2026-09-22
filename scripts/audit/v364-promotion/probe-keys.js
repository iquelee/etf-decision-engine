'use strict';
/* 真跑 computeSnapshot，输出真实键集合（不用正则推断）。
   用法：node probe-keys.js <root> */
const fs = require('fs');  // audit/v364-promotion
const path = require('path');

const ROOT = process.argv[2];
const LABEL = path.basename(path.normalize(ROOT));   // old / new / mi —— 由根目录名决定，勿用 indexOf 猜
const CSV = path.join(ROOT, 'deliverables', 'etf_daily_ml_pool', '513310_qfq.csv');

const indicators = require(path.join(ROOT, 'src/common/utils/indicators.js'));
const constants = require(path.join(ROOT, 'src/common/constants.js'));

const bars = fs.readFileSync(CSV, 'utf8').trim().split(/\r?\n/).map((l) => {
  const p = l.split(',');
  return { trade_date: p[0], open: +p[1], high: +p[2], low: +p[3], close: +p[4], volume: +p[5] };
}).filter((b) => b.trade_date && Number.isFinite(b.close));

const def = constants.DEFAULT_PARAMS || {};
const params = Object.assign({}, def);
// 线上 param_config 的唯一差异项（已只读核实）
params.premium_etf_extreme = 2.5;

const snap = indicators.computeSnapshot(bars, params, {
  code: '513310', calc_date: bars[bars.length - 1].trade_date, premium_rate: null, version: 4
});
const keys = Object.keys(snap);
const WATCH = ['breakout_nd', 'ma60_slope', 'high_point_falling', 'lower_high', 'higher_low',
  'ma20_slope', 'd_state', 'h_state', 'w_state', 'volume_ratio', 'breakout'];

console.log('ROOT         =', ROOT);
console.log('bars         =', bars.length, 'last =', bars[bars.length - 1].trade_date);
console.log('FIELD_COUNT  =', keys.length);
console.log('KEYS         =', JSON.stringify(keys.sort()));
console.log('WATCH        =', JSON.stringify(WATCH.map((k) => [k, Object.prototype.hasOwnProperty.call(snap, k)])));
fs.writeFileSync(path.join(ROOT, '..', `keys-${LABEL}.json`),
  JSON.stringify({ root: ROOT, field_count: keys.length, keys: keys.sort() }, null, 1), 'utf8');
