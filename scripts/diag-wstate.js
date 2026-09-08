/* 诊断：5 只 ETF 的 W 状态触发分支（验证 claude/grok 关于 W4 过宽的判断）
 * 数据：deliverables/etf_daily_qfq/*.csv（前复权日线）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const indicators = require('../cloudfunctions/common/utils/indicators.js');

const CSV_DIR = path.join(__dirname, '../deliverables/etf_daily_qfq');
const TARGETS = [
  { name: '中韩半导体', code: '513310' },
  { name: '通信ETF', code: '515880' },
  { name: '半导体设备', code: '159582' },
  { name: '黄金ETF', code: '518880' },
  { name: '创新药ETF', code: '159570' }
];

function loadCsv(code) {
  const files = fs.readdirSync(CSV_DIR).filter((f) => f.startsWith(code));
  if (!files.length) return null;
  const lines = fs.readFileSync(path.join(CSV_DIR, files[0]), 'utf8').split('\n');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    if (p.length < 6 || !p[0]) continue;
    rows.push({ trade_date: p[0], open: +p[1], close: +p[2], high: +p[3], low: +p[4], volume: +p[5] });
  }
  return rows;
}

// 复现 detectWState 的判定细节（含每分支触发条件标注）
function diagWState(bars) {
  const weeklyBars = indicators.buildWeekly(bars);
  const withInd = indicators.calcWeeklyIndicators(weeklyBars);
  const cur = withInd[withInd.length - 1];
  const prev = withInd[withInd.length - 2] || cur;
  const close = cur.close;
  const ma20w = cur.ma20w;
  const ma60w = cur.ma60w;
  const ma20w_slope = cur.ma20w_slope || 0;
  const ma60w_slope = cur.ma60w_slope || 0;
  const recent = withInd.slice(-10);
  const prevSeg = withInd.slice(-20, -10);
  const recentHigh = indicators.max(indicators.highs(recent));
  const prevHigh = prevSeg.length ? indicators.max(indicators.highs(prevSeg)) : null;
  const recentLow = indicators.min(indicators.lows(recent));
  const prevLow = prevSeg.length ? indicators.min(indicators.lows(prevSeg)) : null;
  const lowerHighLow = prevHigh != null && recentHigh < prevHigh && recentLow < prevLow;

  const branches = {
    W5: ma60w != null && close < ma60w && ma20w < ma60w && ma20w_slope < 0 && ma60w_slope < 0 && lowerHighLow,
    W4a_跌破60周线: ma60w != null && close < ma60w,
    W4b_斜率负或结构弱: ma20w_slope < -0.5 || (prevHigh != null && recentHigh < prevHigh && recentLow < prevLow),
    W3_关60上: close < ma20w && (ma60w == null || close > ma60w)
  };

  return {
    date: cur.week_end_date,
    close, ma20w: ma20w && +ma20w.toFixed(3), ma60w: ma60w && +ma60w.toFixed(3),
    ma20w_slope: +ma20w_slope.toFixed(3), ma60w_slope: +ma60w_slope.toFixed(3),
    close_vs_ma60w: ma60w ? ((close / ma60w - 1) * 100).toFixed(2) + '%' : 'N/A',
    recentHigh: recentHigh && +recentHigh.toFixed(3), prevHigh: prevHigh && +prevHigh.toFixed(3),
    lowerHighLow,
    branches
  };
}

console.log('════════ W 状态触发分支诊断（最新周）════════\n');
for (const t of TARGETS) {
  const bars = loadCsv(t.code);
  if (!bars) { console.log(`✗ ${t.name}: 无数据`); continue; }
  const d = diagWState(bars);
  console.log(`── ${t.name} (${t.code}) ${d.date} ──`);
  console.log(`  收盘=${d.close} | MA20w=${d.ma20w} | MA60w=${d.ma60w} | 收盘vs MA60w: ${d.close_vs_ma60w}`);
  console.log(`  MA20w斜率=${d.ma20w_slope}% | MA60w斜率=${d.ma60w_slope}% | 近10周低点下移=${d.lowerHighLow}`);
  console.log(`  分支触发: W5=${d.branches.W5} | W4a(跌破60周线)=${d.branches.W4a_跌破60周线} | W4b(斜率/结构)=${d.branches.W4b_斜率负或结构弱} | W3=${d.branches.W3_关60上}`);
  const trigger = d.branches.W4a_跌破60周线 ? 'W4a(跌破MA60w)' : (d.branches.W4b_斜率负或结构弱 ? 'W4b(斜率/结构)' : '—');
  console.log(`  → 判定: ${trigger}`);
  console.log();
}
