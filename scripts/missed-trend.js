/**
 * A5 Missed Trend 统计：识别每只 ETF 的主升浪（>20%/30%/50% 涨幅窗口），
 * 统计引擎在窗口内的平均仓位、首次建仓日、最高仓位 → 定位「买点太晚」还是「卖点太早」。
 *
 * 运行：node scripts/missed-trend.js
 * 输出：scripts/backtest-out/missed-trend-<date>.json
 */
'use strict';

const fs = require('fs');
const path = require('path');
const indicators = require('../cloudfunctions/common/utils/indicators.js');
const decision = require('../cloudfunctions/common/utils/decision.js');
const { barsThrough } = require('./lib/bars-through.js');

const CSV_DIR = path.join(__dirname, '../deliverables/etf_daily_qfq');
const OUT_DIR = path.join(__dirname, '../scripts/backtest-out');
const START_DATE = '2025-02-25';
function argVal(name) {
  const hit = process.argv.find((a) => a.indexOf(name + '=') === 0);
  return hit ? hit.slice(name.length + 1) : null;
}
const TECH_MAX = 65;

const ETFS = [
  { code: '513310', name: '中韩半导体', sector: 'storage' },
  { code: '515880', name: '通信ETF', sector: 'ai_network' },
  { code: '159582', name: '半导体设备', sector: 'semi_equip' },
  { code: '518880', name: '黄金ETF', sector: 'gold' },
  { code: '159570', name: '创新药ETF', sector: 'biotech' }
];
const TECH_SECTORS = ['storage', 'ai_network', 'semi_equip'];

const PARAMS = {
  sideway_days: 15, sideway_days_min: 8, sideway_days_mature: 20,
  sideway_range_base: 12, sideway_atr_multiplier: 4, sideway_range_max: 12, sideway_range_hard_cap: 15,
  ma20_slope_flat: 1.5, trend_context_up: 5, trend_context_down: -5,
  volume_ratio: 0.70, volume_ratio_mild: 0.95, volume_ratio_high: 1.15, volume_ratio_extreme: 1.5,
  tech_sector_max: 65, single_etf_max: 30
};

function loadCsv(code) {
  const files = fs.readdirSync(CSV_DIR).filter((f) => f.startsWith(code));
  const lines = fs.readFileSync(path.join(CSV_DIR, files[0]), 'utf8').split('\n');
  const bars = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    if (p.length < 6 || !p[0]) continue;
    bars.push({ trade_date: p[0], open: +p[1], close: +p[2], high: +p[3], low: +p[4], volume: +p[5] });
  }
  return bars.sort((a, b) => (a.trade_date < b.trade_date ? -1 : 1));
}

// 轻量仓位模拟（不含冷静期/慢变量，只记录每天建议仓——用于统计参与度）
function simulatePositions(barsMap, tradingDays) {
  const portfolio = {
    positions: {}, techPosition: 0, goldPosition: 0, drugPosition: 0, market_regime: 'range', cashRatio: 100,
    tech_position: 0, gold_position: 0, cash_ratio: 100
  };
  for (const etf of ETFS) {
    portfolio.positions[etf.code] = {
      code: etf.code, current_position: 0, target_max: 30, max_position: 30, max_strategic_position: 30,
      core_position: 0, trade_position: 0, core_ratio_grade: 'B', trade_ratio_grade: 'B'
    };
  }
  const pending = {};
  const dailyPos = {}; // code -> [{date, position}]
  for (const etf of ETFS) dailyPos[etf.code] = [];

  for (let idx = 60; idx < tradingDays.length; idx++) {
    const today = tradingDays[idx];
    // 执行
    for (const code of Object.keys(pending)) {
      const ord = pending[code];
      const pos = portfolio.positions[code];
      const diff = ord.target - pos.current_position;
      if (Math.abs(diff) > 0.05) pos.current_position = Math.round(ord.target * 10) / 10;
      delete pending[code];
    }
    // 决策
    const prepared = [];
    for (const etf of ETFS) {
      const bars = barsMap[etf.code];
      const hist = barsThrough(bars, today);
      if (hist.length < 60) continue;
      const snapshot = indicators.computeSnapshot(hist, PARAMS, { code: etf.code, calc_date: today });
      if (!snapshot) continue;
      const pos = portfolio.positions[etf.code];
      const fundamental = { f_state: 'F3', f_score: 15 };
      const risk = { risk_flag: 'NORMAL', risk_override: false };
      const probe = decision.runDecision(etf, snapshot, pos, PARAMS, { fundamental, risk, portfolio });
      prepared.push({ etf, snapshot, pos, fundamental, risk, opportunityScore: probe.opportunity_score, probeTarget: probe.final_target });
    }
    const isTech = (p) => p.etf && TECH_SECTORS.indexOf(p.etf.sector) >= 0;
    const ordered = [...prepared.filter((p) => !isTech(p)), ...prepared.filter(isTech).sort((a, b) => (b.opportunityScore || 0) - (a.opportunityScore || 0))];
    let sectorUsed = portfolio.techPosition;
    for (const p of ordered) {
      let sectorRemainingLimit = null;
      if (TECH_SECTORS.indexOf(p.etf.sector) >= 0) {
        sectorRemainingLimit = Math.max(0, TECH_MAX - (sectorUsed - p.pos.current_position));
      }
      const result = decision.runDecision(p.etf, p.snapshot, p.pos, PARAMS, {
        fundamental: p.fundamental, risk: p.risk, portfolio, cooldownDays: 0, sectorRemainingLimit
      });
      if (TECH_SECTORS.indexOf(p.etf.sector) >= 0) {
        const current = p.pos.current_position || 0;
        const occupy = result.suggested_position != null ? Math.min(result.suggested_position, result.final_target != null ? result.final_target : result.suggested_position) : (result.final_target || 0);
        sectorUsed += Math.max(0, occupy - current);
      }
      pending[p.etf.code] = { target: result.suggested_position != null ? result.suggested_position : p.pos.current_position };
    }
    portfolio.techPosition = ETFS.filter((e) => TECH_SECTORS.indexOf(e.sector) >= 0)
      .reduce((s, e) => s + (portfolio.positions[e.code].current_position || 0), 0);
    portfolio.goldPosition = portfolio.positions['518880'].current_position || 0;
    portfolio.drugPosition = portfolio.positions['159570'].current_position || 0;
    portfolio.cashRatio = Math.max(0, 100 - portfolio.techPosition - portfolio.goldPosition - portfolio.drugPosition);
    portfolio.tech_position = portfolio.techPosition;
    portfolio.gold_position = portfolio.goldPosition;
    portfolio.cash_ratio = portfolio.cashRatio;
    // 记录
    for (const etf of ETFS) {
      dailyPos[etf.code].push({ date: today, position: portfolio.positions[etf.code].current_position });
    }
  }
  return dailyPos;
}

/** 识别主升浪：允许 1–2 日回调，避免把主升切成碎片。索引相对传入的 closes。 */
function findRallies(closes, minRise, maxPullbackDays = 2) {
  const rallies = [];
  let i = 0;
  while (i < closes.length - 1) {
    if (closes[i + 1] <= closes[i]) { i++; continue; }
    let j = i;
    while (j + 1 < closes.length) {
      if (closes[j + 1] > closes[j]) { j += 1; continue; }
      let k = j + 1;
      let down = 0;
      while (k < closes.length && closes[k] <= closes[k - 1] && down < maxPullbackDays) {
        down += 1;
        k += 1;
      }
      if (down > 0 && k < closes.length && closes[k] > closes[j]) {
        j = k;
        continue;
      }
      break;
    }
    const rise = (closes[j] - closes[i]) / closes[i] * 100;
    if (rise >= minRise) rallies.push({ start: i, end: j, rise: Math.round(rise) });
    i = j + 1;
  }
  return rallies;
}

function main() {
  const startDate = argVal('--from') || START_DATE;
  const endDate = argVal('--to') || null;
  const barsMap = {};
  const closesMap = {};
  for (const etf of ETFS) {
    barsMap[etf.code] = loadCsv(etf.code);
    closesMap[etf.code] = barsMap[etf.code].map((b) => b.close);
  }
  const dateSet = new Set();
  for (const etf of ETFS) barsMap[etf.code].forEach((b) => dateSet.add(b.trade_date));
  const allDates = [...dateSet].sort();
  const startIdx = allDates.findIndex((d) => d >= startDate);
  const tradingDays = allDates.slice(Math.max(0, startIdx - 60));

  // 对齐每只 ETF 的日期索引
  const dateIdx = {};
  for (const etf of ETFS) {
    dateIdx[etf.code] = {};
    barsMap[etf.code].forEach((b, i) => { dateIdx[etf.code][b.trade_date] = i; });
  }

  console.log('════════ Missed Trend 主升浪参与度统计（A5）════════\n');
  console.log('运行完整仓位模拟（轻量版，无冷静期）...');
  const dailyPos = simulatePositions(barsMap, tradingDays);

  const report = {};
  for (const etf of ETFS) {
    const allCloses = closesMap[etf.code];
    const windowIdx = [];
    barsMap[etf.code].forEach((b, i) => {
      if (b.trade_date >= startDate && (!endDate || b.trade_date <= endDate)) windowIdx.push(i);
    });
    const windowCloses = windowIdx.map((i) => allCloses[i]);
    const ralliesRaw = findRallies(windowCloses, 20);
    const rallies = ralliesRaw.map((r) => ({
      start: windowIdx[r.start],
      end: windowIdx[r.end],
      rise: r.rise
    }));
    console.log(`\n── ${etf.name} (${etf.code}) 主升浪(≥20%) ${rallies.length} 次 ──`);
    const etfReport = [];
    for (const r of rallies.slice(-3)) { // 最近 3 次
      const startBar = barsMap[etf.code][r.start];
      const endBar = barsMap[etf.code][r.end];
      if (!startBar || !endBar) continue;
      // 窗口内引擎仓位（用日期过滤）
      const windowPos = dailyPos[etf.code].filter((d) => d.date >= startBar.trade_date && d.date <= endBar.trade_date);
      const avgPos = windowPos.length ? windowPos.reduce((s, x) => s + x.position, 0) / windowPos.length : 0;
      const maxPos = windowPos.length ? Math.max(...windowPos.map((x) => x.position)) : 0;
      const firstBuild = windowPos.find((x) => x.position > 0);
      // 主升浪起点前 60 日的仓位（看是否提前埋伏）
      const preWindow = dailyPos[etf.code].filter((d) => {
        const idx = dateIdx[etf.code][d.date];
        const startIdxE = dateIdx[etf.code][startBar.trade_date];
        return idx != null && startIdxE != null && idx < startIdxE && idx >= startIdxE - 60;
      });
      const preAvg = preWindow.length ? preWindow.reduce((s, x) => s + x.position, 0) / preWindow.length : 0;
      let diagnosis = '未参与';
      if (firstBuild && firstBuild.date > startBar.trade_date) diagnosis = 'BUILD偏晚';
      else if (preAvg > avgPos + 1) diagnosis = '浪中被减（ADD后减仓）';
      else if (avgPos > 0) diagnosis = '已参与';
      console.log(`  ${startBar.trade_date}→${endBar.trade_date} 涨幅 ${r.rise}% | 窗口均仓 ${avgPos.toFixed(1)}% 最高 ${maxPos.toFixed(1)}% | 首次建仓 ${firstBuild ? firstBuild.date : '未参与'} | 起点前60日均仓 ${preAvg.toFixed(1)}% | ${diagnosis}`);
      etfReport.push({
        start: startBar.trade_date, end: endBar.trade_date, rise: r.rise,
        avgPos: Math.round(avgPos * 10) / 10, maxPos: Math.round(maxPos * 10) / 10,
        firstBuild: firstBuild ? firstBuild.date : null, preAvgPos: Math.round(preAvg * 10) / 10,
        diagnosis
      });
    }
    report[etf.code] = etfReport;
  }

  const tag = argVal('--tag') || new Date().toISOString().slice(0, 10);
  const outFile = path.join(OUT_DIR, `missed-trend-${tag}.json`);
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(`\n输出: ${outFile}`);
  console.log('\n解读：窗口均仓低 + 首次建仓晚 = 买点太晚（信号/闸门太严）；高点前就减仓 = 卖点太早（防守过度）。');
}

main();
