/**
 * P1 剩余项回测：
 * ① C2 横盘假突破容忍：findConsolidation 允许 1~2 根越界 K 线不中断（outlier 容忍）
 * ② 赛道额度二次分配：final_target vs suggested_position 占用口径对比（3 只科技 ETF 组合模拟）
 *
 * 运行：node scripts/backtest-c2-sector.js
 */
'use strict';

const fs = require('fs');
const indicators = require('../cloudfunctions/common/utils/indicators.js');

const params = {
  sideway_days: 15, sideway_days_min: 8, sideway_days_mature: 20,
  sideway_range_base: 12, sideway_atr_multiplier: 4, sideway_range_max: 12, sideway_range_hard_cap: 15,
  ma20_slope_flat: 1.5, trend_context_up: 5, trend_context_down: -5,
  volume_ratio: 0.70, volume_ratio_mild: 0.95, volume_ratio_high: 1.15, volume_ratio_extreme: 1.5
};

// —— ① C2：带 outlier 容忍的 findConsolidation（对比一超即断）——
// 允许 maxOutliers 根 K 线超出振幅阈值仍继续计数；超过则 break（该根算入计数但标记越界）
function findConsolidationTolerant(bars, params = {}, maxOutliers = 0) {
  const rangeBase = params.sideway_range_base != null ? params.sideway_range_base : 12;
  const atrMult = params.sideway_atr_multiplier != null ? params.sideway_atr_multiplier : 4;
  const hardCap = params.sideway_range_hard_cap != null ? params.sideway_range_hard_cap : 15;
  const closeArr = indicators.closes(bars);
  const highArr = indicators.highs(bars);
  const lowArr = indicators.lows(bars);
  const atr20 = indicators.calcATR(highArr, lowArr, closeArr, 20);
  const lastClose = closeArr[closeArr.length - 1];
  const atrThreshold = atr20 != null && lastClose > 0 ? (atr20 / lastClose) * 100 * atrMult : rangeBase;
  const threshold = Math.min(Math.max(rangeBase, atrThreshold), hardCap);

  let winHigh = highArr[highArr.length - 1];
  let winLow = lowArr[lowArr.length - 1];
  let days = 1;
  let outliers = 0;
  const maxLook = Math.min(40, bars.length);
  for (let i = 2; i <= maxLook; i++) {
    const idx = bars.length - i;
    const h = highArr[idx];
    const l = lowArr[idx];
    if (h != null) winHigh = Math.max(winHigh, h);
    if (l != null) winLow = Math.min(winLow, l);
    const rangePct = winLow > 0 ? ((winHigh - winLow) / winLow) * 100 : 0;
    if (rangePct > threshold) {
      outliers += 1;
      if (outliers > maxOutliers) break; // 越界 K 线超过容忍数 → 横盘结束
    }
    days = i;
  }
  return { days, startIdx: bars.length - days, outliers };
}

// 用容忍版天数替代 findConsolidation 计算（沿用 V2.1.1 评分/A/B 分级）
function computeIndicatorsTol(bars, maxOutliers) {
  const closeArr = indicators.closes(bars);
  const volArr = indicators.volumes(bars);
  const ma20 = indicators.calcMA(closeArr, 20);
  const ma20Val = ma20[ma20.length - 1];
  const ma20_5ago = ma20[ma20.length - 6];
  const ma20Slope5 = (ma20Val != null && ma20_5ago != null && ma20_5ago !== 0)
    ? ((ma20Val - ma20_5ago) / ma20_5ago) * 100 : null;
  const volRatio = indicators.calcVolumeRatio(volArr);
  const { days } = findConsolidationTolerant(bars, params, maxOutliers);
  const rangePct = days >= 1 ? indicators.calcSidewayRange(bars, days) : null;
  const tc = indicators.detectTrendContext(bars, params);
  const ma60 = indicators.calcMA(closeArr, 60);
  const ma60Val = ma60[ma60.length - 1];
  const ma60_5ago = ma60[ma60.length - 6];
  const ma60Up = ma60Val != null && ma60_5ago != null && ma60Val >= ma60_5ago;
  return { days, rangePct, ma20Slope5, volRatio, tc, ma60Up };
}

// R3-4：V2.1.1 评分直接用生产 indicators.calcConsolidationScore（不再手写，避免口径漂移）
function calcScoreV211(days, rangePct, ma20Slope5, volRatio, ma60Up, tc) {
  return indicators.calcConsolidationScore(days, rangePct, ma20Slope5, volRatio, ma60Up, params, tc);
}

function judge(ind, minDays) {
  if (ind.days < minDays) return null;
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
  const byGrade = (g) => {
    const subset = buys.filter((b) => b.grade === g);
    const r60 = subset.map((b) => fwdReturn(bars, b.idx, 60)).filter((v) => v != null);
    return { count: subset.length, avgRet60: avg(r60), winRate60: r60.length ? Math.round(r60.filter((v) => v > 0).length / r60.length * 100) : null };
  };
  return {
    count: buys.length, aCount: buys.filter((b) => b.grade === 'A').length, bCount: buys.filter((b) => b.grade === 'B').length,
    avgRet20: avg(ret20), winRate20: ret20.length ? Math.round(win20 / ret20.length * 100) : null,
    avgRet60: avg(ret60), winRate60: ret60.length ? Math.round(win60 / ret60.length * 100) : null,
    A: byGrade('A'), B: byGrade('B')
  };
}

function loadTencent(file, key) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const node = raw.data && raw.data[key];
  const rows = (node && (node.day || node.qfqday)) || [];
  return rows.map((r) => ({ trade_date: r[0], open: +r[1], close: +r[2], high: +r[3], low: +r[4], volume: +r[5] }));
}

// —— ① C2 回测主体 ——
const C2_TARGETS = [
  { name: '科创50', file: '/tmp/kc50_raw.json', key: 'sh000688' },
  { name: '513310', file: '/tmp/kc513310_raw.json', key: 'sh513310' },
  { name: '创业板指', file: '/tmp/kc399006_raw.json', key: 'sz399006' }
];

function backtestC2() {
  console.log('════════ ① C2 横盘假突破容忍回测（outlier 容忍 0/1/2 根对比）════════');
  console.log('标的            | 容忍数 | 买点 | A/B  | 20日胜率 | 60日胜率 | 60日均收益 | A级60胜率');
  console.log('------------------------------------------------------------------------------');
  const rows = [];
  for (const t of C2_TARGETS) {
    const bars = loadTencent(t.file, t.key);
    const START = 260;
    if (bars.length <= START + 20) continue;
    for (const maxOutliers of [0, 1, 2]) {
      const buys = [];
      let last = -100;
      for (let idx = START; idx < bars.length; idx++) {
        const ind = computeIndicatorsTol(bars.slice(0, idx + 1), maxOutliers);
        const g = judge(ind, 8);
        if (g && idx - last >= 5) { buys.push({ idx, date: bars[idx].trade_date, grade: g }); last = idx; }
      }
      const s = summarize(buys, bars);
      console.log(`${t.name.padEnd(12)}| 容忍${maxOutliers}  | ${String(s.count).padEnd(4)}| ${s.aCount}/${s.bCount} | ${s.winRate20}%    | ${s.winRate60}%     | ${s.avgRet60}%      | ${s.A.winRate60}%`);
      rows.push({ name: t.name, tol: maxOutliers, ...s });
    }
  }
  console.log('\n结论判断（看容忍 1~2 是否增加买点且胜率不降反升）：');
  return rows;
}

// —— ② 赛道额度二次分配：3 只科技 ETF 组合模拟 ——
const SECTOR_TARGETS = [
  { code: '513310', file: '/tmp/kc513310_raw.json', key: 'sh513310', current: 5, max: 30 },
  { code: '515880', file: '/tmp/kc515880_raw.json', key: 'sh515880', current: 5, max: 30 },
  { code: '159582', file: '/tmp/kc159582_raw.json', key: 'sz159582', current: 5, max: 30 }
];

function backtestSector() {
  console.log('\n\n════════ ② 赛道额度二次分配模拟（65% 上限，final_target vs suggested_position 占用）════════');
  const techMax = 65;
  const START = 260;
  // 载入并预计算每日判定
  const datasets = SECTOR_TARGETS.map((t) => {
    const bars = loadTencent(t.file, t.key);
    const cur = t.current;
    const daily = [];
    for (let idx = START; idx < bars.length; idx++) {
      const ind = computeIndicatorsTol(bars.slice(0, idx + 1), 1); // 用容忍1版（若回测支持）
      const g = judge(ind, 8);
      // 目标仓：B 级 20%、A 级 25%（简化），当前 5 → gap>0 才有加仓意图
      const finalTarget = g ? (g === 'A' ? 25 : 20) : 5;
      const suggested = g ? Math.min(cur + 3, finalTarget) : cur; // 步进 +3pct
      daily.push({ date: bars[idx].trade_date, grade: g, finalTarget, suggested, current: cur });
    }
    return { code: t.code, bars, daily };
  });
  const n = Math.min(...datasets.map((d) => d.daily.length));
  let conflictA = 0, overA = 0, overB = 0;
  let blockedA = 0, blockedB = 0; // 因额度不足被拦下的信号数
  let bothSignalDays = 0;
  // 动态跟踪实际持仓（方案 A：加仓按 final_target 满仓执行；方案 B：按 suggested 步进执行；均受 65% 约束）
  let posA = {}; let posB = {};
  SECTOR_TARGETS.forEach((t) => { posA[t.code] = t.current; posB[t.code] = t.current; });
  for (let i = 0; i < n; i++) {
    const daySignals = datasets.map((d, k) => ({ code: d.code, ...d.daily[i] }));
    const signals = daySignals.filter((s) => s.grade);
    if (signals.length >= 2) bothSignalDays++;
    // 方案 A：按机会分排序，final_target 占用额度，执行后持仓=final_target
    const orderA = [...signals].sort((a, b) => (b.grade === 'A' ? 1 : 0) - (a.grade === 'A' ? 1 : 0));
    for (const s of orderA) {
      const curA = posA[s.code] != null ? posA[s.code] : s.current;
      const add = Math.max(0, s.finalTarget - curA);
      if (add > 0) {
        // 赛道总额度检查：当前科技总仓 + 本次加仓 ≤ 65%
        const techTotal = SECTOR_TARGETS.reduce((sum, t) => sum + (posA[t.code] != null ? posA[t.code] : t.current), 0);
        if (techTotal + add > techMax) { blockedA++; continue; }
        posA[s.code] = s.finalTarget;
      }
    }
    // 方案 B：按机会分排序，suggested 占用额度（步进），执行后持仓=suggested
    const orderB = [...signals].sort((a, b) => (b.grade === 'A' ? 1 : 0) - (a.grade === 'A' ? 1 : 0));
    for (const s of orderB) {
      const curB = posB[s.code] != null ? posB[s.code] : s.current;
      const add = Math.max(0, s.suggested - curB);
      if (add > 0) {
        const techTotal = SECTOR_TARGETS.reduce((sum, t) => sum + (posB[t.code] != null ? posB[t.code] : t.current), 0);
        if (techTotal + add > techMax) { blockedB++; continue; }
        posB[s.code] = s.suggested;
      }
    }
    // 减仓/无信号：持仓缓慢回落（模拟用户部分执行）
    SECTOR_TARGETS.forEach((t) => {
      if (posA[t.code] != null) posA[t.code] = Math.max(t.current, posA[t.code] * 0.999);
      if (posB[t.code] != null) posB[t.code] = Math.max(t.current, posB[t.code] * 0.999);
    });
    const techA = SECTOR_TARGETS.reduce((s, t) => s + posA[t.code], 0);
    const techB = SECTOR_TARGETS.reduce((s, t) => s + posB[t.code], 0);
    if (techA > techMax) overA++;
    if (techB > techMax) overB++;
    if (techA !== techB) conflictA++;
  }
  console.log(`方案A（final_target 占用）: 触发超额 ${overA} 次, 被拦信号 ${blockedA} 个`);
  console.log(`方案B（suggested 占用）  : 触发超额 ${overB} 次, 被拦信号 ${blockedB} 个`);
  console.log(`两方案占用不同的天数: ${conflictA} / ${n}（多信号日 ${bothSignalDays} 天）`);
  console.log(`\n结论判断（方案 B 应减少被拦信号、不超上限）：被拦 ${blockedA}→${blockedB}，超额 ${overA}→${overB}`);
}

function main() {
  backtestC2();
  backtestSector();
}

main();
