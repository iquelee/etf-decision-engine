/**
 * R3-1 突破加仓「连续 N 日收盘确认」回测（grok P1-1 的假突破正确解法）。
 * 对比：单日突破（当前）/ 连续 2 日 / 连续 3 日收盘站上整理窗口上沿才确认突破加仓。
 *
 * 口径：复用生产 indicators/decision 纯函数（calcConsolidationScore、computeSnapshot、determineAddMode 逻辑）。
 * 前置：/tmp/kc513310_raw.json /tmp/kc50_raw.json /tmp/kc399006_raw.json
 * 运行：node scripts/backtest-breakout.js
 */
'use strict';

const fs = require('fs');
const indicators = require('../cloudfunctions/common/utils/indicators.js');
const decision = require('../cloudfunctions/common/utils/decision.js');

const params = {
  sideway_days: 15, sideway_days_min: 8, sideway_days_mature: 20,
  sideway_range_base: 12, sideway_atr_multiplier: 4, sideway_range_max: 12, sideway_range_hard_cap: 15,
  ma20_slope_flat: 1.5, trend_context_up: 5, trend_context_down: -5,
  volume_ratio: 0.70, volume_ratio_mild: 0.90, volume_ratio_high: 1.15, volume_ratio_extreme: 1.5,
  tech_sector_max: 65, single_etf_max: 30
};

const TARGETS = [
  { name: '513310', file: '/tmp/kc513310_raw.json', key: 'sh513310' },
  { name: '科创50', file: '/tmp/kc50_raw.json', key: 'sh000688' },
  { name: '创业板指', file: '/tmp/kc399006_raw.json', key: 'sz399006' }
];

function loadTencent(file, key) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const node = raw.data && raw.data[key];
  const rows = (node && (node.day || node.qfqday)) || [];
  return rows.map((r) => ({ trade_date: r[0], open: +r[1], close: +r[2], high: +r[3], low: +r[4], volume: +r[5] }));
}

/** 判定某日是否为「突破加仓」信号（按连续 confirmDays 日收盘站上整理窗口上沿） */
function isBreakoutSignal(bars, idx, snap, confirmDays) {
  if (!snap || snap.breakout !== true) return false;
  if (snap.consolidation_score == null || snap.consolidation_score < 65) return false;
  // 横盘窗口上沿 = 窗口内最高收盘/最高价（与 indicators 的 bkWin 一致：max(整理天数, 10)）
  const win = Math.max(snap.sideway_days || 0, 10);
  const windowHigh = indicators.max(indicators.highs(bars.slice(Math.max(0, idx - win), idx)));
  if (windowHigh == null) return false;
  // 连续 confirmDays 日（含当日）收盘 > 上沿
  for (let k = 0; k < confirmDays; k++) {
    const bar = bars[idx - k];
    if (!bar) return false;
    if (bar.close <= windowHigh) return false;
  }
  return true;
}

function fwdReturn(bars, idx, n) {
  const buyIdx = idx + 1;
  const sellIdx = buyIdx + n;
  if (sellIdx >= bars.length || !bars[buyIdx] || !bars[buyIdx].close) return null;
  return ((bars[sellIdx].close - bars[buyIdx].close) / bars[buyIdx].close) * 100;
}

function summarize(buys, bars) {
  const ret20 = [], ret60 = [];
  let win20 = 0, win60 = 0;
  for (const b of buys) {
    const r20 = fwdReturn(bars, b.idx, 20);
    const r60 = fwdReturn(bars, b.idx, 60);
    if (r20 != null) { ret20.push(r20); if (r20 > 0) win20++; }
    if (r60 != null) { ret60.push(r60); if (r60 > 0) win60++; }
  }
  const avg = (a) => a.length ? Math.round(a.reduce((s, v) => s + v, 0) / a.length * 100) / 100 : null;
  return {
    count: buys.length,
    avgRet20: avg(ret20), winRate20: ret20.length ? Math.round(win20 / ret20.length * 100) : null,
    avgRet60: avg(ret60), winRate60: ret60.length ? Math.round(win60 / ret60.length * 100) : null
  };
}

function backtestOne(target, confirmDays) {
  const bars = loadTencent(target.file, target.key);
  const START = 260;
  if (bars.length <= START + 20) return null;

  const buys = [];
  let lastBuy = -100;
  for (let t = START; t < bars.length; t++) {
    const snap = indicators.computeSnapshot(bars.slice(0, t + 1), params, { code: target.key });
    if (!snap || snap.sideway_days == null || snap.sideway_days < 8) continue;
    if (!isBreakoutSignal(bars, t, snap, confirmDays)) continue;
    if (t - lastBuy >= 5) { buys.push({ idx: t, date: bars[t].trade_date }); lastBuy = t; }
  }
  const s = summarize(buys, bars);
  return { name: target.name, confirmDays, ...s };
}

function main() {
  console.log('════════ 突破加仓「连续 N 日收盘确认」回测（grok P1-1 假突破解法）════════');
  console.log('口径：突破=连续 N 日收盘站上整理窗口上沿 + 横盘评分≥65；买点间隔≥5 日\n');

  const results = [];
  for (const t of TARGETS) {
    for (const n of [1, 2, 3]) {
      const r = backtestOne(t, n);
      if (r) results.push(r);
    }
  }

  for (const t of TARGETS) {
    console.log(`\n──── ${t.name} ────`);
    console.log('确认方式   | 买点 | 20日胜率 | 20日均收益 | 60日胜率 | 60日均收益');
    console.log('-------------------------------------------------------------');
    results.filter((r) => r.name === t.name).forEach((r) => {
      const label = r.confirmDays === 1 ? '单日突破(当前)' : `连续${r.confirmDays}日`;
      console.log(`${label.padEnd(10)}| ${String(r.count).padStart(4)} | ${String(r.winRate20).padEnd(5)}% | ${String(r.avgRet20).padEnd(7)}% | ${String(r.winRate60).padEnd(5)}% | ${r.avgRet60}%`);
    });
  }

  // 汇总
  console.log('\n\n════════ 三标的汇总（1 日=当前基线）════════');
  console.log('标的       | 确认 | 买点 | 60日胜率 | 买点变化 | 胜率变化');
  console.log('----------------------------------------------------------');
  for (const t of TARGETS) {
    const base = results.find((r) => r.name === t.name && r.confirmDays === 1);
    results.filter((r) => r.name === t.name).forEach((r) => {
      const dCnt = r.count - base.count;
      const dWin = r.winRate60 != null && base.winRate60 != null ? r.winRate60 - base.winRate60 : null;
      console.log(`${t.name.padEnd(9)}| 连续${r.confirmDays}日 | ${String(r.count).padStart(4)} | ${String(r.winRate60).padEnd(5)}% | ${dCnt > 0 ? '+' : ''}${dCnt}      | ${dWin != null ? (dWin > 0 ? '+' : '') + dWin : '—'}`);
    });
  }
}

main();
