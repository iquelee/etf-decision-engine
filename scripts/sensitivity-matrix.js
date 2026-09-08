/**
 * A6 参数敏感性矩阵：扫描关键参数，输出 Return/MaxDD/Sharpe/Turnover/BUILD-ADD 矩阵，
 * 找「稳定区间」而非最优单点（ChatGPT 建议，防过拟合）。
 *
 * 扫描维度：
 *  - volume_ratio_mild（V2 上限）：0.80 / 0.85 / 0.90 / 0.95
 *  - consolidation_score 门槛（H1=75 → 70/75/80，A/B 级用）
 *  - sideway_days_min：8 / 10 / 15
 *
 * V3.1：volume_ratio_mild 冻结 0.95，禁止再用本脚本在同一窗口拧阈值换收益。
 * 运行：node scripts/sensitivity-matrix.js
 * 输出：scripts/backtest-out/sensitivity-<date>.json + 控制台表格
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
const TECH_MAX = 65;

const ETFS = [
  { code: '513310', name: '中韩半导体', sector: 'storage' },
  { code: '515880', name: '通信ETF', sector: 'ai_network' },
  { code: '159582', name: '半导体设备', sector: 'semi_equip' },
  { code: '518880', name: '黄金ETF', sector: 'gold' },
  { code: '159570', name: '创新药ETF', sector: 'biotech' }
];
const TECH_SECTORS = ['storage', 'ai_network', 'semi_equip'];

function loadCsv(code) {
  const files = fs.readdirSync(CSV_DIR).filter((f) => f.startsWith(code));
  if (!files.length) throw new Error(`无数据: ${code}`);
  const lines = fs.readFileSync(path.join(CSV_DIR, files[0]), 'utf8').split('\n');
  const bars = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    if (p.length < 6 || !p[0]) continue;
    bars.push({ trade_date: p[0], open: +p[1], close: +p[2], high: +p[3], low: +p[4], volume: +p[5] });
  }
  return bars.sort((a, b) => (a.trade_date < b.trade_date ? -1 : 1));
}

function makeSlowResolver() {
  const state = {};
  const F_TO_CORE = { F1: 'A', F2: 'B', F3: 'C', F4: 'D', F5: 'D' };
  return {
    resolve(code, fState, today, tradingDays) {
      const s = state[code] || (state[code] = { core_grade: 'B', trade_grade: 'B' });
      s.core_grade = F_TO_CORE[fState] || 'C';
      s.trade_grade = F_TO_CORE[fState] || 'C';
      return s;
    }
  };
}

function makeCooldown(tradingDays) {
  const lastBuy = {};
  return {
    setBuy(code, idx, mode) { lastBuy[code] = { idx, mode: mode || '横盘加仓' }; },
    remaining(code, idx) {
      const b = lastBuy[code];
      if (b == null) return 0;
      const base = b.mode === '突破加仓' ? 5 : 2;
      return Math.max(0, base - (idx - b.idx));
    }
  };
}

/** 单次回测（返回 summary 关键指标） */
function runBacktest(params, barsMap, tradingDays) {
  const portfolio = {
    positions: {},
    techPosition: 0, goldPosition: 0, drugPosition: 0, market_regime: 'range', cashRatio: 100,
    tech_position: 0, gold_position: 0, cash_ratio: 100
  };
  for (const etf of ETFS) {
    portfolio.positions[etf.code] = {
      code: etf.code, current_position: 0, target_max: 30, max_position: 30, max_strategic_position: 30,
      core_position: 0, trade_position: 0
    };
  }
  const slowResolver = makeSlowResolver();
  const cooldown = makeCooldown(tradingDays);

  let nav = 100, prevNav = 100;
  let peak = -Infinity, maxDD = 0;
  const dailyRets = [];
  const actionsCount = {};
  let tradeCount = 0;
  const pendingOrders = {};

  for (let idx = 60; idx < tradingDays.length; idx++) {
    const today = tradingDays[idx];
    const prevDate = idx > 60 ? tradingDays[idx - 1] : null;
    // 执行昨日挂单
    for (const code of Object.keys(pendingOrders)) {
      const ord = pendingOrders[code];
      const pos = portfolio.positions[code];
      const bar = barsMap[code].find((b) => b.trade_date === today);
      const diff = ord.target - pos.current_position;
      if (bar && Math.abs(diff) > 0.05) {
        pos.current_position = Math.round(ord.target * 10) / 10;
        if (diff > 0) cooldown.setBuy(code, idx, ord.add_mode);
        tradeCount += 1;
        pos.core_position = ord.core != null ? ord.core : pos.core_position;
        pos.trade_position = ord.trade != null ? ord.trade : pos.trade_position;
      }
      delete pendingOrders[code];
    }
    // 决策
    const prepared = [];
    for (const etf of ETFS) {
      const bars = barsMap[etf.code];
      if (idx < 60) continue;
      const hist = barsThrough(bars, today);
      if (hist.length < 60) continue;
      const snapshot = indicators.computeSnapshot(hist, params, { code: etf.code, calc_date: today });
      if (!snapshot) continue;
      const pos = portfolio.positions[etf.code];
      const slow = slowResolver.resolve(etf.code, 'F3', today, tradingDays);
      const posWithCore = { ...pos, core_ratio_grade: slow.core_grade, trade_ratio_grade: slow.trade_grade };
      const fundamental = { f_state: 'F3', f_score: 15 };
      const risk = { risk_flag: 'NORMAL', risk_override: false };
      const probe = decision.runDecision(etf, snapshot, posWithCore, params, { fundamental, risk, portfolio });
      prepared.push({ etf, snapshot, pos, posWithCore, fundamental, risk, opportunityScore: probe.opportunity_score, probeTarget: probe.final_target });
    }
    const isTech = (p) => p.etf && TECH_SECTORS.indexOf(p.etf.sector) >= 0;
    const marginalScore = (p) => {
      const current = p.pos.current_position || 0;
      const target = p.probeTarget != null ? p.probeTarget : current;
      return (p.opportunityScore || 0) * (1 + Math.max(0, target - current) / 30);
    };
    const ordered = [...prepared.filter((p) => !isTech(p)), ...prepared.filter(isTech).sort((a, b) => marginalScore(b) - marginalScore(a))];
    let sectorUsed = portfolio.techPosition;
    for (const p of ordered) {
      if (!p.snapshot) continue;
      let sectorRemainingLimit = null;
      if (TECH_SECTORS.indexOf(p.etf.sector) >= 0) {
        sectorRemainingLimit = Math.max(0, TECH_MAX - (sectorUsed - p.pos.current_position));
      }
      const cooldownDays = cooldown.remaining(p.etf.code, idx);
      const result = decision.runDecision(p.etf, p.snapshot, p.posWithCore, params, {
        fundamental: p.fundamental, risk: p.risk, portfolio, cooldownDays, sectorRemainingLimit
      });
      actionsCount[result.final_action] = (actionsCount[result.final_action] || 0) + 1;
      if (TECH_SECTORS.indexOf(p.etf.sector) >= 0) {
        const current = p.pos.current_position || 0;
        const occupy = result.suggested_position != null ? Math.min(result.suggested_position, result.final_target != null ? result.final_target : result.suggested_position) : (result.final_target || 0);
        sectorUsed += Math.max(0, occupy - current);
      }
      pendingOrders[p.etf.code] = {
        target: result.suggested_position != null ? result.suggested_position : p.pos.current_position,
        core: result.core_position, trade: result.trade_position,
        action: result.final_action, add_mode: result.add_mode || '无'
      };
    }
    // 净值
    portfolio.techPosition = ETFS.filter((e) => TECH_SECTORS.indexOf(e.sector) >= 0)
      .reduce((s, e) => s + (portfolio.positions[e.code].current_position || 0), 0);
    portfolio.goldPosition = portfolio.positions['518880'].current_position || 0;
    portfolio.drugPosition = portfolio.positions['159570'].current_position || 0;
    portfolio.cashRatio = Math.max(0, 100 - portfolio.techPosition - portfolio.goldPosition - portfolio.drugPosition);
    portfolio.tech_position = portfolio.techPosition;
    portfolio.gold_position = portfolio.goldPosition;
    portfolio.cash_ratio = portfolio.cashRatio;
    let dayRet = 0;
    for (const etf of ETFS) {
      const barT = barsMap[etf.code].find((b) => b.trade_date === today);
      const barP = prevDate ? barsMap[etf.code].find((b) => b.trade_date === prevDate) : null;
      if (!barT || !barP || barP.close === 0) continue;
      dayRet += (portfolio.positions[etf.code].current_position || 0) / 100 * (barT.close / barP.close - 1);
    }
    nav *= (1 + dayRet);
    if (idx >= 61) dailyRets.push(nav / prevNav - 1);
    prevNav = nav;
    peak = Math.max(peak, nav);
    maxDD = Math.max(maxDD, (peak - nav) / peak * 100);
  }
  const totalRet = (nav - 100) / 100 * 100;
  const mean = dailyRets.reduce((s, v) => s + v, 0) / dailyRets.length;
  const std = Math.sqrt(dailyRets.reduce((s, v) => s + (v - mean) * (v - mean), 0) / dailyRets.length);
  const sharpe = std > 0 ? (mean / std) * Math.sqrt(252) : 0;
  return {
    totalRet: Math.round(totalRet * 100) / 100,
    maxDD: Math.round(maxDD * 100) / 100,
    sharpe: Math.round(sharpe * 100) / 100,
    turnover: tradeCount,
    builds: actionsCount['BUILD'] || 0,
    adds: actionsCount['ADD'] || 0
  };
}

function main() {
  const barsMap = {};
  for (const etf of ETFS) barsMap[etf.code] = loadCsv(etf.code);
  const dateSet = new Set();
  for (const etf of ETFS) barsMap[etf.code].forEach((b) => dateSet.add(b.trade_date));
  const allDates = [...dateSet].sort();
  const startIdx = allDates.findIndex((d) => d >= START_DATE);
  const tradingDays = allDates.slice(Math.max(0, startIdx - 60));

  const BASE = {
    sideway_days: 15, sideway_days_min: 8, sideway_days_mature: 20,
    sideway_range_base: 12, sideway_atr_multiplier: 4, sideway_range_max: 12, sideway_range_hard_cap: 15,
    ma20_slope_flat: 1.5, trend_context_up: 5, trend_context_down: -5,
    volume_ratio: 0.70, volume_ratio_mild: 0.90, volume_ratio_high: 1.15, volume_ratio_extreme: 1.5,
    tech_sector_max: 65, single_etf_max: 30, consolidation_score_min: 65
  };

  const scans = {
    volume_ratio_mild: [0.80, 0.85, 0.90, 0.95],
    sideway_days_min: [8, 10, 15],
    tech_sector_max: [55, 60, 65, 70]
  };

  const results = {};
  console.log('════════ 参数敏感性矩阵（A6）════════\n');
  for (const [param, values] of Object.entries(scans)) {
    console.log(`\n── 扫描 ${param} ──`);
    console.log('  参数值 | 收益% | 回撤% | Sharpe | 调仓数 | BUILD | ADD');
    console.log('  ' + '-'.repeat(55));
    results[param] = {};
    for (const v of values) {
      const params = { ...BASE, [param]: v };
      const r = runBacktest(params, barsMap, tradingDays);
      results[param][v] = r;
      console.log(`  ${String(v).padEnd(6)} | ${String(r.totalRet).padStart(6)} | ${String(r.maxDD).padStart(6)} | ${String(r.sharpe).padStart(5)} | ${String(r.turnover).padStart(5)} | ${String(r.builds).padStart(3)} | ${String(r.adds).padStart(3)}`);
    }
  }

  const outFile = path.join(OUT_DIR, `sensitivity-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
  console.log(`\n输出: ${outFile}`);
  console.log('\n结论指引：找「稳定区间」——连续 2~3 个参数值表现接近且优良，而非单点最优（防过拟合）。');
}

main();
