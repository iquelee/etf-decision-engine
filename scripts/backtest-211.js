/**
 * 阶段二回测（多标的交叉验证）：V2.1 原版 vs V2.1.1 调整版 —— 横盘/整理判定对比
 * 标的：科创50、中韩半导体513310、创业板指399006、纳斯达克100
 * 目的：验证 V2.1.1 调整（MA20进评分、时间8/10/15/20、A级75/0.80）在不同市场/波动率下的有效性
 *
 * 运行：node scripts/backtest-211.js
 * 前置：/tmp/kc50_raw.json /tmp/kc513310_raw.json /tmp/kc399006_raw.json /tmp/ndx_raw.json
 */
'use strict';

const fs = require('fs');
const indicators = require('../cloudfunctions/common/utils/indicators.js');

const params = {
  sideway_days: 15, sideway_days_min: 8, sideway_days_mature: 20,
  sideway_range_base: 12, sideway_atr_multiplier: 4, sideway_range_max: 12, sideway_range_hard_cap: 15,
  ma20_slope_flat: 1.5, trend_context_up: 5, trend_context_down: -5,
  volume_ratio: 0.70, volume_ratio_mild: 0.90, volume_ratio_high: 1.15, volume_ratio_extreme: 1.5
};

// 标的定义（腾讯日线 [date,open,close,high,low,volume]；新浪美股 {d,o,h,l,c,v}）
const TARGETS = [
  { name: '科创50', file: '/tmp/kc50_raw.json', type: 'tencent', key: 'sh000688' },
  { name: '中韩半导体513310', file: '/tmp/kc513310_raw.json', type: 'tencent', key: 'sh513310' },
  { name: '创业板指399006', file: '/tmp/kc399006_raw.json', type: 'tencent', key: 'sz399006' },
  { name: '纳斯达克100', file: '/tmp/ndx_raw.json', type: 'sina', maxBars: 800 }
];

function loadTencent(file, key) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const node = raw.data && raw.data[key];
  const rows = (node && (node.day || node.qfqday)) || [];
  return rows.map((r) => ({ trade_date: r[0], open: +r[1], close: +r[2], high: +r[3], low: +r[4], volume: +r[5] }));
}

function loadSina(file, maxBars) {
  const arr = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rows = Array.isArray(arr) ? arr : [];
  const slice = maxBars ? rows.slice(-maxBars) : rows;
  return slice.map((r) => ({ trade_date: r.d, open: +r.o, close: +r.c, high: +r.h, low: +r.l, volume: +r.v }));
}

function computeIndicators(bars) {
  const closeArr = indicators.closes(bars);
  const volArr = indicators.volumes(bars);
  const ma20 = indicators.calcMA(closeArr, 20);
  const ma20Val = ma20[ma20.length - 1];
  const ma20_5ago = ma20[ma20.length - 6];
  const ma20Slope5 = (ma20Val != null && ma20_5ago != null && ma20_5ago !== 0)
    ? ((ma20Val - ma20_5ago) / ma20_5ago) * 100 : null;
  const volRatio = indicators.calcVolumeRatio(volArr);
  const { days } = indicators.findConsolidation(bars, params);
  const rangePct = days >= 1 ? indicators.calcSidewayRange(bars, days) : null;
  const tc = indicators.detectTrendContext(bars, params);
  const ma60 = indicators.calcMA(closeArr, 60);
  const ma60Val = ma60[ma60.length - 1];
  const ma60_5ago = ma60[ma60.length - 6];
  const ma60Up = ma60Val != null && ma60_5ago != null && ma60Val >= ma60_5ago;
  const sidewayDaysV21 = indicators.calcSidewayDays(bars, params);
  const scoreV21 = sidewayDaysV21 > 0
    ? indicators.calcConsolidationScore(sidewayDaysV21, rangePct, ma20Slope5, volRatio, ma60Up, params) : 0;
  return { ma20Slope5, volRatio, days, rangePct, tc, ma60Up, sidewayDaysV21, scoreV21 };
}

function judgeV21(ind) {
  // V2.1 原版口径保留（对照组，min=10 是当时定义）
  if (ind.sidewayDaysV21 < 10) return null;
  const trendIntact = ind.scoreV21 >= 65;
  if (ind.tc === 'UP_CONSOLIDATION') {
    if (ind.volRatio != null && ind.volRatio <= 0.85 && trendIntact) return 'A';
    if (trendIntact) return 'B';
  }
  return null;
}

// R3-4：V2.1.1 评分直接用生产 indicators.calcConsolidationScore（不再手写，避免口径漂移）
function calcScoreV211(days, rangePct, ma20Slope5, volRatio, ma60Up, tc) {
  return indicators.calcConsolidationScore(days, rangePct, ma20Slope5, volRatio, ma60Up, params, tc);
}

function judgeV211(ind) {
  if (ind.days < 8) return null;
  if (ind.tc === 'DOWN_CONSOLIDATION') return null;
  const score = calcScoreV211(ind.days, ind.rangePct, ind.ma20Slope5, ind.volRatio, ind.ma60Up, ind.tc);
  if (score >= 75 && ind.volRatio != null && ind.volRatio <= 0.80 && ind.ma60Up) return 'A';
  if (score >= 65) return 'B';
  return null;
}

function fwdReturn(bars, idx, n) {
  const buyIdx = idx + 1;
  const sellIdx = buyIdx + n;
  if (sellIdx >= bars.length || !bars[buyIdx] || !bars[buyIdx].close) return null;
  return ((bars[sellIdx].close - bars[buyIdx].close) / bars[buyIdx].close) * 100;
}

function fwdMaxDrawdown(bars, idx, n) {
  const end = Math.min(idx + n, bars.length - 1);
  let minLow = bars[idx].close;
  for (let k = idx; k <= end; k++) if (bars[k].low < minLow) minLow = bars[k].low;
  return ((bars[idx].close - minLow) / bars[idx].close) * 100;
}

function summarize(buys, bars) {
  const ret20 = [], ret60 = [], dd20 = [];
  let win20 = 0, win60 = 0;
  for (const b of buys) {
    const r20 = fwdReturn(bars, b.idx, 20);
    const r60 = fwdReturn(bars, b.idx, 60);
    const d20 = fwdMaxDrawdown(bars, b.idx, 20);
    if (r20 != null) { ret20.push(r20); if (r20 > 0) win20++; }
    if (r60 != null) { ret60.push(r60); if (r60 > 0) win60++; }
    if (d20 != null) dd20.push(d20);
  }
  const avg = (a) => a.length ? Math.round(a.reduce((s, v) => s + v, 0) / a.length * 100) / 100 : null;
  const byGrade = (g) => {
    const subset = buys.filter((b) => b.grade === g);
    const r60 = subset.map((b) => fwdReturn(bars, b.idx, 60)).filter((v) => v != null);
    return {
      count: subset.length,
      avgRet60: avg(r60),
      winRate60: r60.length ? Math.round(r60.filter((v) => v > 0).length / r60.length * 100) : null
    };
  };
  return {
    count: buys.length,
    aCount: buys.filter((b) => b.grade === 'A').length,
    bCount: buys.filter((b) => b.grade === 'B').length,
    avgRet20: avg(ret20), winRate20: ret20.length ? Math.round(win20 / ret20.length * 100) : null,
    avgRet60: avg(ret60), winRate60: ret60.length ? Math.round(win60 / ret60.length * 100) : null,
    avgDD20: avg(dd20),
    A: byGrade('A'), B: byGrade('B')
  };
}

function countSegments(bars, START, predicate) {
  let seg = 0, inSeg = false;
  for (let t = START; t < bars.length; t++) {
    const hit = predicate(computeIndicators(bars.slice(0, t + 1)));
    if (hit && !inSeg) { seg++; inSeg = true; } else if (!hit) inSeg = false;
  }
  return seg;
}

function backtestOne(target) {
  const bars = target.type === 'tencent' ? loadTencent(target.file, target.key) : loadSina(target.file, target.maxBars);
  const START = 260;
  if (bars.length <= START + 20) return null;

  const buyV21 = [], buyV211 = [];
  const lastBuy = { v21: -100, v211: -100 };
  for (let t = START; t < bars.length; t++) {
    const ind = computeIndicators(bars.slice(0, t + 1));
    const g1 = judgeV21(ind);
    if (g1 && t - lastBuy.v21 >= 5) { buyV21.push({ idx: t, date: bars[t].trade_date, grade: g1 }); lastBuy.v21 = t; }
    const g2 = judgeV211(ind);
    if (g2 && t - lastBuy.v211 >= 5) { buyV211.push({ idx: t, date: bars[t].trade_date, grade: g2 }); lastBuy.v211 = t; }
  }

  const segV21 = countSegments(bars, START, (ind) => ind.sidewayDaysV21 >= 10);
  const segV211 = countSegments(bars, START, (ind) => ind.days >= 10);

  return {
    name: target.name,
    bars: bars.length, start: bars[START].trade_date, end: bars[bars.length - 1].trade_date,
    days: bars.length - START,
    segV21, segV211,
    v21: summarize(buyV21, bars),
    v211: summarize(buyV211, bars)
  };
}

function main() {
  const results = [];
  for (const t of TARGETS) {
    const r = backtestOne(t);
    if (r) results.push(r);
  }

  const fmt = (v, s = '') => v == null ? '—' : `${v}${s}`;
  for (const r of results) {
    console.log(`\n════════ ${r.name}（${r.bars} 根，回测 ${r.days} 交易日）════════`);
    console.log('指标                     | V2.1 原版  | V2.1.1 调整');
    console.log('--------------------------------------------------');
    console.log(`有效横盘段(≥10日)          | ${fmt(r.segV21)}         | ${fmt(r.segV211)}`);
    console.log(`A级/B级买点               | ${r.v21.aCount}/${r.v21.bCount}      | ${r.v211.aCount}/${r.v211.bCount}`);
    console.log(`总买点                    | ${fmt(r.v21.count)}         | ${fmt(r.v211.count)}`);
    console.log(`20日均收益/胜率           | ${fmt(r.v21.avgRet20, '%')}/${fmt(r.v21.winRate20, '%')}  | ${fmt(r.v211.avgRet20, '%')}/${fmt(r.v211.winRate20, '%')}`);
    console.log(`60日均收益/胜率           | ${fmt(r.v21.avgRet60, '%')}/${fmt(r.v21.winRate60, '%')}  | ${fmt(r.v211.avgRet60, '%')}/${fmt(r.v211.winRate60, '%')}`);
    console.log(`20日最大回撤(均)          | ${fmt(r.v21.avgDD20, '%')}       | ${fmt(r.v211.avgDD20, '%')}`);
    console.log(`A级60日收益/胜率          | ${fmt(r.v21.A.avgRet60, '%')}/${fmt(r.v21.A.winRate60, '%')}  | ${fmt(r.v211.A.avgRet60, '%')}/${fmt(r.v211.A.winRate60, '%')}`);
    console.log(`B级60日收益/胜率          | ${fmt(r.v21.B.avgRet60, '%')}/${fmt(r.v21.B.winRate60, '%')}  | ${fmt(r.v211.B.avgRet60, '%')}/${fmt(r.v211.B.winRate60, '%')}`);
  }

  // 汇总
  console.log('\n\n════════ 四标的汇总（V2.1.1 vs V2.1 的差异）════════');
  console.log('标的            | 买点数变化      | 60日胜率变化    | A级胜率变化');
  console.log('--------------------------------------------------------------');
  for (const r of results) {
    const cnt = `${r.v21.count}→${r.v211.count}`;
    const win = `${fmt(r.v21.winRate60, '%')}→${fmt(r.v211.winRate60, '%')}`;
    const aWin = `${fmt(r.v21.A.winRate60, '%')}→${fmt(r.v211.A.winRate60, '%')}`;
    console.log(`${r.name.padEnd(16)}| ${cnt.padEnd(14)}| ${win.padEnd(14)}| ${aWin}`);
  }
}

main();
