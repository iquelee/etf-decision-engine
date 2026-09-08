/**
 * 全链路回测（V3.1）：五维评分→机会分→目标仓位→P0~P7 硬规则→核心/交易仓拆分→仓位模拟。
 * 对齐 runDecisionEngine 编排：
 *   - 非科技 ETF 先算；科技 ETF 按机会分降序分配 65% 赛道额度（按建议执行仓占用）
 *   - 核心仓 20 交易日确认、交易仓 10 交易日确认（慢变量）
 *   - 冷静期 3 个交易日（硬规则）
 *   - 全部复用生产纯函数：indicators.computeSnapshot / decision.runDecision / decision.computeCoreTrade
 *
 * 数据：deliverables/etf_daily_qfq/*.csv（前复权日线）
 * 运行：node scripts/backtest-full-engine.js
 *       node scripts/backtest-full-engine.js --f-path   # B4 合成 F4/F5 路径
 *       node scripts/backtest-full-engine.js --frp --tag=v38-frp  # F/Regime/溢价代理对照，不覆盖 126.46%
 *       node scripts/backtest-full-engine.js --cash-cap --tag=v38-cashcap  # 成交层现金约束对照，不进决策
 *       node scripts/backtest-full-engine.js --codes=518880,515880,513310 --csv-dir=deliverables/etf_daily_3ticket --from=... --to=... --tag=v41-3ticket
 *         # V4.1 三票独立系列，只评不调，不得与五票 126.46% 混比
 * 输出：scripts/backtest-out/full-engine-<date>.json + 控制台摘要
 * V3.1：volume_ratio_mild 冻结 0.95，本脚本不得改此值。
 * V3.3：快照必须 barsThrough(bars, today)，禁止 bars.slice(0, idx+1)
 *       （tradingDays 从 startIdx-60 切开时，下标切全量 CSV 会固定落后 60 个交易日）。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const indicators = require('../cloudfunctions/common/utils/indicators.js');
const createDecision = require('./lib/decision-v39.js');
function loadDecision() {
  const decHit = process.argv.find((a) => a.indexOf('--decision=') === 0);
  if (decHit) {
    const rel = decHit.slice('--decision='.length);
    const abs = path.isAbsolute(rel) ? rel : path.join(__dirname, rel);
    return require(abs);
  }
  const hit = process.argv.find((a) => a.indexOf('--experiment=') === 0);
  return hit ? createDecision(hit.slice('--experiment='.length)) : require('../cloudfunctions/common/utils/decision.js');
}
const decision = loadDecision();
const { barsThrough } = require('./lib/bars-through.js');
const { rawCash, clipCash, unleverDayReturn } = require('./lib/book-disclose.js');
const { createMtmBook, stepMtm, mtmWeights, mtmBookPct } = require('./lib/mtm-book.js');
const { clipBuyTarget, sumBook, fillOrderCodes } = require('./lib/cash-cap.js');
const { fFromW, fScore, regimeFromWStates } = require('./lib/signal-proxy.js');
const {
  ALL_ETFS, parseCodes, selectUniverse, equalWeight, sectorPosition,
  intersectTradeDates, seriesLabel, listingBlockReason
} = require('./lib/universe.js');

/* ================= 配置 ================= */
const DEFAULT_CSV_DIR = path.join(__dirname, '../deliverables/etf_daily_qfq');
let CSV_DIR = DEFAULT_CSV_DIR;
const OUT_DIR = path.join(__dirname, '../scripts/backtest-out');
const START_DATE = '2025-02-25'; // 与回测报告一致：近 1.5 年
const INITIAL_POSITION = 0;      // 空仓起步
const TECH_MAX = 65;             // 科技赛道上限
const SINGLE_MAX = 30;           // 单票上限
const TRADE_COST_PCT = Number((() => {
  const hit = process.argv.find((a) => a.indexOf('--cost-pct=') === 0);
  return hit ? hit.slice('--cost-pct='.length) : '0.0003';
})());
const SLIPPAGE_PCT = Number((() => {
  const hit = process.argv.find((a) => a.indexOf('--slippage-pct=') === 0);
  return hit ? hit.slice('--slippage-pct='.length) : '0';
})());
const CORE_CONFIRM = 20;         // 核心仓确认周期（交易日）
const TRADE_CONFIRM = 10;        // 交易仓确认周期（交易日）

const PARAMS = {
  sideway_days: 15, sideway_days_min: 8, sideway_days_mature: 20,
  sideway_range_base: 12, sideway_atr_multiplier: 4, sideway_range_max: 12, sideway_range_hard_cap: 15,
  ma20_slope_flat: 1.5, trend_context_up: 5, trend_context_down: -5,
  volume_ratio: 0.70, volume_ratio_mild: 0.95, volume_ratio_high: 1.15, volume_ratio_extreme: 1.5,
  tech_sector_max: 65, single_etf_max: 30
};

// (代码, 名称, 赛道) —— 默认五票；`--codes=` 在 main 里切子集
const ETFS = ALL_ETFS;
const TECH_SECTORS = ['storage', 'ai_network', 'semi_equip'];
const GOLD_SECTOR = 'gold';
const DRUG_SECTOR = 'biotech';

/* ================= 数据加载 ================= */
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

/* ================= 慢变量：核心/交易仓等级确认 ================= */
/**
 * 简化版 resolveCoreRatioGrade：用 F 状态映射目标等级，维护 pending 起始日，
 * 连续 CONFIRM 个交易日同等级才确认切换（F5 即时清零）。
 */
function makeSlowResolver() {
  const state = {}; // code -> {core_grade, core_pending_since, trade_grade, trade_pending_since, last_f}
  const F_TO_CORE = { F1: 'A', F2: 'B', F3: 'C', F4: 'D', F5: 'D' };
  const F_TO_TRADE = { F1: 'B', F2: 'B', F3: 'C', F4: 'D', F5: 'D' };

  return {
    /** @param tradingDays 按时间排序的交易日数组，datesMap 用于算两个日期间的交易日数 */
    resolve(code, fState, today, tradingDays) {
      const s = state[code] || (state[code] = {
        core_grade: 'B', trade_grade: 'B', core_pending_since: null, trade_pending_since: null
      });
      const targetCore = F_TO_CORE[fState] || 'C';
      const targetTrade = F_TO_TRADE[fState] || 'C';

      const tradingDaysBetween = (since) => {
        if (!since) return 0;
        return tradingDays.filter((d) => d > since && d <= today).length;
      };

      if (fState === 'F5') {
        s.core_grade = 'F5'; s.trade_grade = 'F5';
        s.core_pending_since = null; s.trade_pending_since = null;
        return s;
      }
      // 核心仓（20 日确认）
      if (targetCore !== s.core_grade) {
        if (s.core_pending_since === null) s.core_pending_since = today;
        else if (tradingDaysBetween(s.core_pending_since) >= CORE_CONFIRM) {
          s.core_grade = targetCore; s.core_pending_since = null;
        }
      } else s.core_pending_since = null;
      // 交易仓（10 日确认）
      if (targetTrade !== s.trade_grade) {
        if (s.trade_pending_since === null) s.trade_pending_since = today;
        else if (tradingDaysBetween(s.trade_pending_since) >= TRADE_CONFIRM) {
          s.trade_grade = targetTrade; s.trade_pending_since = null;
        }
      } else s.trade_pending_since = null;

      return s;
    }
  };
}

/* ================= 冷静期 ================= */
/** 距上次买入的剩余冷静日（回测内模拟：记录每只最后买入日，3 个交易日内禁止加仓） */
function makeCooldown(tradingDays) {
  const lastBuy = {}; // code -> {idx, mode}
  return {
    setBuy(code, idx, mode) { lastBuy[code] = { idx, mode: mode || '横盘加仓' }; },
    remaining(code, idx) {
      const b = lastBuy[code];
      if (b == null) return 0;
      // B6 自适应冷静期：上次横盘加仓 → 2 日；突破加仓 → 5 日（回测与生产 computeCooldownDays 对齐）
      const base = b.mode === '突破加仓' ? 5 : 2;
      return Math.max(0, base - (idx - b.idx));
    }
  };
}

/* ================= 单日决策 ================= */
function decideDay(barsMap, idx, portfolio, slowResolver, cooldown, tradingDays, fState, liveSignals, universe) {
  const names = universe || ETFS;
  const prepared = [];
  const today = tradingDays[idx];

  for (const etf of names) {
    const bars = barsMap[etf.code];
    if (idx < 60) { prepared.push({ etf, snapshot: null }); continue; }
    const hist = barsThrough(bars, today);
    if (hist.length < 60) { prepared.push({ etf, snapshot: null }); continue; }
    const lastBar = hist[hist.length - 1];
    if (bars.some((b) => b.trade_date === today) && lastBar.trade_date !== today) {
      throw new Error(`快照日期错位 ${etf.code} last=${lastBar.trade_date} today=${today}`);
    }
    const snapshot = indicators.computeSnapshot(hist, PARAMS, { code: etf.code, calc_date: today });
    if (!snapshot) { prepared.push({ etf, snapshot: null }); continue; }
    if (liveSignals && snapshot.bias_20d != null) snapshot.premium_rate = snapshot.bias_20d;
    prepared.push({ etf, snapshot, pos: portfolio.positions[etf.code] });
  }

  if (liveSignals) {
    const techW = prepared
      .filter((p) => p.snapshot && TECH_SECTORS.indexOf(p.etf.sector) >= 0)
      .map((p) => p.snapshot.w_state);
    portfolio.market_regime = regimeFromWStates(techW);
  }

  for (const p of prepared) {
    if (!p.snapshot) continue;
    const f = liveSignals ? fFromW(p.snapshot.w_state) : (fState || 'F3');
    const slow = slowResolver.resolve(p.etf.code, f, today, tradingDays);
    p.posWithCore = { ...p.pos, core_ratio_grade: slow.core_grade, trade_ratio_grade: slow.trade_grade };
    p.fundamental = { f_state: f, f_score: fScore(f) };
    p.risk = { risk_flag: 'NORMAL', risk_override: false };
    const probe = decision.runDecision(p.etf, p.snapshot, p.posWithCore, PARAMS, {
      fundamental: p.fundamental, risk: p.risk, portfolio
    });
    p.opportunityScore = probe.opportunity_score;
    p.probeTarget = probe.final_target;
  }

  const isTech = (p) => p.etf && TECH_SECTORS.indexOf(p.etf.sector) >= 0;
  const marginalScore = (p) => {
    const score = p.opportunityScore || 0;
    const current = p.pos ? (p.pos.current_position || 0) : 0;
    const target = p.probeTarget != null ? p.probeTarget : current;
    const gap = Math.max(0, target - current);
    return score * (1 + gap / 30);
  };
  const ordered = [
    ...prepared.filter((p) => !isTech(p)),
    ...prepared.filter(isTech).sort((a, b) => marginalScore(b) - marginalScore(a))
  ];
  let sectorUsed = portfolio.techPosition;

  const results = [];
  for (const p of ordered) {
    if (!p.snapshot) continue;
    const etf = p.etf;
    let sectorRemainingLimit = null;
    if (TECH_SECTORS.indexOf(etf.sector) >= 0) {
      const current = p.pos.current_position || 0;
      sectorRemainingLimit = Math.max(0, TECH_MAX - (sectorUsed - current));
    }
    const cooldownDays = cooldown.remaining(etf.code, idx);
    if (p.snapshot.data_complete === false) {
      const waitResult = decision.buildWaitResult(etf, p.snapshot, '数据不完整');
      results.push({ code: etf.code, result: waitResult, p });
      continue;
    }
    const result = decision.runDecision(etf, p.snapshot, p.posWithCore, PARAMS, {
      fundamental: p.fundamental, risk: p.risk, portfolio, cooldownDays, sectorRemainingLimit
    });
    if (TECH_SECTORS.indexOf(etf.sector) >= 0) {
      const current = p.pos.current_position || 0;
      const occupyTarget = result.suggested_position != null
        ? Math.min(result.suggested_position, result.final_target != null ? result.final_target : result.suggested_position)
        : (result.final_target || 0);
      sectorUsed += Math.max(0, occupyTarget - current);
    }
    results.push({ code: etf.code, result, p });
  }
  return results;
}

/* ================= 主回测 ================= */
function syntheticFState(idx, nDays) {
  const p = (idx - 60) / Math.max(1, nDays - 61);
  if (p >= 0.8) return 'F5';
  if (p >= 0.5) return 'F4';
  return 'F3';
}

function argVal(name) {
  const hit = process.argv.find((a) => a.indexOf(name + '=') === 0);
  return hit ? hit.slice(name.length + 1) : null;
}

function resolveCsvDir(rel) {
  if (!rel) return DEFAULT_CSV_DIR;
  return path.isAbsolute(rel) ? rel : path.join(__dirname, '..', rel);
}

function main() {
  const fPath = process.argv.indexOf('--f-path') >= 0;
  const cashCap = process.argv.indexOf('--cash-cap') >= 0;
  const liveSignals = process.argv.indexOf('--frp') >= 0;
  const startDate = argVal('--from') || START_DATE;
  const endDate = argVal('--to') || null;
  const universe = selectUniverse(parseCodes(argVal('--codes')));
  const series = seriesLabel(universe);
  const ew = equalWeight(universe.length);
  CSV_DIR = resolveCsvDir(argVal('--csv-dir'));
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const barsMap = {};
  let minLen = Infinity;
  for (const etf of universe) {
    barsMap[etf.code] = loadCsv(etf.code);
    minLen = Math.min(minLen, barsMap[etf.code].length);
  }

  // 对齐交易日：共有日期交集（五票切片日期本就对齐；三票必须交，否则缺上市日会变成「缺席仍计 1/n」）
  const allDates = intersectTradeDates(barsMap, universe);
  if (!allDates.length) throw new Error('票池无共同交易日');
  const startIdx = allDates.findIndex((d) => d >= startDate);
  if (startIdx < 0) throw new Error(`没有 >= ${startDate} 的交易日`);
  const tradingDays = allDates.slice(Math.max(0, startIdx - 60)); // 留 60 日热身
  const loopStart = tradingDays.findIndex((d) => d >= startDate);
  if (loopStart < 0) throw new Error(`热身后仍找不到起点 ${startDate}`);
  if (loopStart < 60) {
    console.warn(`警告：${startDate} 之前不足 60 根，从 ${tradingDays[60] || tradingDays[loopStart]} 起算`);
  }
  const firstIdx = Math.max(60, loopStart);

  const portfolio = {
    positions: {},
    techPosition: 0,
    goldPosition: 0,
    drugPosition: 0,
    market_regime: 'range', // R-003 修复：与生产 portfolio.market_regime 字段名一致（原 camelCase 导致 crisis/defensive 路径回测失活）
    cashRatio: 100,
    // 生产 runDecision 读 snake_case；probe 若只传 camelCase，tech_position 恒为 0
    tech_position: 0,
    gold_position: 0,
    cash_ratio: 100
  };
  for (const etf of universe) {
    portfolio.positions[etf.code] = {
      code: etf.code, current_position: INITIAL_POSITION, target_max: SINGLE_MAX,
      max_position: SINGLE_MAX, max_strategic_position: SINGLE_MAX,
      core_position: 0, trade_position: 0
    };
  }
  const slowResolver = makeSlowResolver();
  const cooldown = makeCooldown(tradingDays);

  // 每日净值序列
  const navSeries = []; // {date, engine, equalWeight}
  const monthly = {};  // YYYY-MM -> {engine, equal}
  const trades = [];   // {date, code, action, from, to, pct}
  const actionsCount = {};
  const srSamples = [];
  const f5ZeroDays = [];

  // 等权基准：各 1/n 买入持有（用交易日对齐）
  const baseDay = allDates.findIndex((d) => d >= startDate);
  const baseCloses = {};
  for (const etf of universe) {
    const bar = barsMap[etf.code].find((b) => b.trade_date === allDates[baseDay]);
    baseCloses[etf.code] = bar ? bar.close : null;
  }

  // 阶段0 重写：T 日收盘决策 → T+1 执行（开盘价，无则收盘）→ T+1 起享受收益（日度复利）。
  // 消除 look-ahead（原：当日决策当日更新仓位且当日计息 = 幻影利润）。
  // pendingOrders: code -> {target, core, trade, action}（当日决策，次日执行）
  const pendingOrders = {};
  let prevDayNav = 100; // 上一交易日组合净值（用于日度复利）
  let prevDayEqual = 100;
  let maxBook = 0;
  let daysOver100 = 0;
  let endBook = 0;
  let bookSum = 0;
  let bookDays = 0;
  let minCashRaw = 100;
  let prevDayUnlev = 100;
  const mtmBook = createMtmBook(100);
  let maxMtmBook = 0;
  let cashCapClipped = 0;
  let cashCapRefused = 0;
  const regimeDays = {};
  const fCounts = {};
  const premiumCounts = {};

  for (let idx = firstIdx; idx < tradingDays.length; idx++) {
    const today = tradingDays[idx];
    if (endDate && today > endDate) break;
    const prevDate = idx > firstIdx ? tradingDays[idx - 1] : null;

    // ── ① 执行昨日挂单（T+1 开盘价成交；无开盘价用当日收盘）──
    const fillCodes = cashCap
      ? fillOrderCodes(pendingOrders, portfolio.positions)
      : Object.keys(pendingOrders);
    for (const code of fillCodes) {
      const ord = pendingOrders[code];
      const pos = portfolio.positions[code];
      const from = pos.current_position;
      const bar = barsMap[code].find((b) => b.trade_date === today);
      const fillPrice = bar ? bar.open : null;
      let target = ord.target;
      if (cashCap) {
        const clipped = clipBuyTarget(from, target, sumBook(portfolio.positions));
        if (clipped + 1e-9 < target) {
          if (Math.abs(clipped - from) <= 0.05) cashCapRefused += 1;
          else cashCapClipped += 1;
        }
        target = clipped;
      }
      const diff = target - from;
      if (fillPrice != null && Math.abs(diff) > 0.05) {
        pos.current_position = Math.round(target * 10) / 10;
        if (diff > 0) cooldown.setBuy(code, idx, ord.add_mode);
        // R-004 修复：应用交易成本（佣金按成交额双边，组合口径按仓位变化 pct 折算）
        trades.push({ date: today, code, action: ord.action, from: Math.round(from * 10) / 10, to: pos.current_position, pct: Math.round(diff * 10) / 10 });
        pos.core_position = ord.core != null ? ord.core : pos.core_position;
        pos.trade_position = ord.trade != null ? ord.trade : pos.trade_position;
      } else if (fillPrice == null) {
        // 数据缺失（停牌等）：挂单顺延
        continue;
      }
      delete pendingOrders[code];
    }

    // ── ② 今日决策（用截至今日收盘的数据）→ 生成明日挂单 ──
    const dayF = fPath && !liveSignals ? syntheticFState(idx, tradingDays.length) : 'F3';
    const dayResults = decideDay(barsMap, idx, portfolio, slowResolver, cooldown, tradingDays, dayF, liveSignals, universe);
    if (liveSignals) {
      const rg = portfolio.market_regime || 'range';
      regimeDays[rg] = (regimeDays[rg] || 0) + 1;
    }
    for (const { code, result } of dayResults) {
      const action = result.final_action;
      actionsCount[action] = (actionsCount[action] || 0) + 1;
      const pos = portfolio.positions[code];
      const suggested = result.suggested_position != null ? result.suggested_position : pos.current_position;
      if (action === 'STRATEGIC_REDUCE' && srSamples.length < 40) {
        srSamples.push({
          date: today, code,
          current: pos.current_position,
          suggested,
          w: result.w_state,
          f: result.f_state,
          explain_chain: (result.explain_chain || []).slice(0, 8)
        });
      }
      if (liveSignals) {
        const fs = result.f_state || 'F3';
        fCounts[fs] = (fCounts[fs] || 0) + 1;
        const pf = result.premium_flag || '正常';
        premiumCounts[pf] = (premiumCounts[pf] || 0) + 1;
      }
      if ((dayF === 'F5' || (liveSignals && result.f_state === 'F5')) && suggested === 0 && pos.current_position > 0) {
        f5ZeroDays.push({ date: today, code, from: pos.current_position });
      }
      // 挂单（次日执行），即使 diff 很小也记录（T+1 执行时判断）
      pendingOrders[code] = {
        target: suggested,
        core: result.core_position != null ? result.core_position : pos.core_position,
        trade: result.trade_position != null ? result.trade_position : pos.trade_position,
        action,
        add_mode: result.add_mode || '无'
      };
    }

    // ── ③ 重算组合仓位（决策后、执行前的目标展示用）──
    portfolio.techPosition = universe.filter((e) => TECH_SECTORS.indexOf(e.sector) >= 0)
      .reduce((s, e) => s + (portfolio.positions[e.code].current_position || 0), 0);
    portfolio.goldPosition = sectorPosition(portfolio.positions, universe, GOLD_SECTOR);
    portfolio.drugPosition = sectorPosition(portfolio.positions, universe, DRUG_SECTOR);
    const totalPos = portfolio.techPosition + portfolio.goldPosition + portfolio.drugPosition;
    endBook = totalPos;
    bookSum += totalPos;
    bookDays += 1;
    if (totalPos > maxBook) maxBook = totalPos;
    if (totalPos > 100 + 1e-9) daysOver100 += 1;
    const cashUnclipped = rawCash(totalPos);
    if (cashUnclipped < minCashRaw) minCashRaw = cashUnclipped;
    portfolio.cashRatio = clipCash(totalPos);
    portfolio.tech_position = portfolio.techPosition;
    portfolio.gold_position = portfolio.goldPosition;
    portfolio.cash_ratio = portfolio.cashRatio;

    // ── ④ 日度复利净值：当日收益 = 持仓(截至今日开盘已生效) × 当日涨跌，逐日复利 ──
    const todayCloses = {};
    const prevCloses = {};
    for (const etf of universe) {
      const barT = barsMap[etf.code].find((b) => b.trade_date === today);
      const barP = prevDate ? barsMap[etf.code].find((b) => b.trade_date === prevDate) : null;
      todayCloses[etf.code] = barT ? barT.close : null;
      prevCloses[etf.code] = barP ? barP.close : null;
    }
    let dayRetEngine = 0;
    let dayRetEqual = 0;
    for (const etf of universe) {
      const c0 = prevCloses[etf.code];
      const c1 = todayCloses[etf.code];
      if (c0 == null || c1 == null || c0 === 0) continue;
      const ret = (c1 - c0) / c0;
      dayRetEngine += (portfolio.positions[etf.code].current_position || 0) / 100 * ret;
      dayRetEqual += ew * ret;
    }
    // 现金部分无收益；扣交易成本（执行日按成交额 × 双边佣金；trades 记录的是今日执行动作）
    let dayCost = 0;
    for (const t of trades) {
      if (t.date === today) {
        dayCost += Math.abs(t.pct) / 100 * (TRADE_COST_PCT * 2 + SLIPPAGE_PCT);
      }
    }
    const nav = prevDayNav * (1 + dayRetEngine - dayCost);
    const dayRetUnlev = unleverDayReturn(dayRetEngine, totalPos);
    const unlevNav = prevDayUnlev * (1 + dayRetUnlev - dayCost);
    const equalNav = prevDayEqual * (1 + dayRetEqual);
    const todayTrades = trades.filter((t) => t.date === today).map((t) => ({ code: t.code, pct: t.pct }));
    const mtmSnap = stepMtm(mtmBook, todayTrades, prevCloses, todayCloses, dayCost);
    if (mtmSnap.book > maxMtmBook) maxMtmBook = mtmSnap.book;
    navSeries.push({
      date: today,
      engine: Math.round(nav * 100) / 100,
      equalWeight: Math.round(equalNav * 100) / 100,
      unlev: Math.round(unlevNav * 100) / 100,
      mtm: Math.round(mtmSnap.nav * 100) / 100,
      book: Math.round(totalPos * 10) / 10,
      mtm_book: Math.round(mtmSnap.book * 10) / 10,
      cash_raw: Math.round(cashUnclipped * 10) / 10
    });
    prevDayNav = nav;
    prevDayUnlev = unlevNav;
    prevDayEqual = equalNav;

    // ── ⑤ 月度收益（真实百分比：(月末/月初−1)×100）──
    const month = today.slice(0, 7);
    const prev = navSeries.length > 1 ? navSeries[navSeries.length - 2] : null;
    if (!monthly[month]) monthly[month] = { engine: 0, equal: 0, start: null };
    if (monthly[month].start === null) monthly[month].start = { engine: prev ? prev.engine : 100, equal: prev ? prev.equalWeight : 100 };
    monthly[month].engine = Math.round((nav / monthly[month].start.engine - 1) * 10000) / 100;
    monthly[month].equal = Math.round((equalNav / monthly[month].start.equal - 1) * 10000) / 100;
  }

  // 期末统计
  const last = navSeries[navSeries.length - 1];
  const first = navSeries[0];
  const totalRet = ((last.engine / first.engine) - 1) * 100;
  const equalRet = ((last.equalWeight / first.equalWeight) - 1) * 100;
  const unlevTotalRet = ((last.unlev / first.unlev) - 1) * 100;
  const mtmTotalRet = ((last.mtm / first.mtm) - 1) * 100;
  // 最大回撤
  let maxDD = 0, peak = -Infinity;
  for (const n of navSeries) {
    peak = Math.max(peak, n.engine);
    maxDD = Math.max(maxDD, (peak - n.engine) / peak * 100);
  }
  // 年化 Sharpe（日收益）
  const dailyRets = [];
  for (let i = 1; i < navSeries.length; i++) {
    dailyRets.push(navSeries[i].engine / navSeries[i - 1].engine - 1);
  }
  const mean = dailyRets.reduce((s, v) => s + v, 0) / dailyRets.length;
  const std = Math.sqrt(dailyRets.reduce((s, v) => s + (v - mean) * (v - mean), 0) / dailyRets.length);
  const sharpe = std > 0 ? (mean / std) * Math.sqrt(252) : 0;

  // A3 benchmark：五票用固定目标仓；子集票池没有那套权重，固定仓 = 等权（1/n）
  const FIXED_WEIGHTS = universe.length === 5
    ? { '513310': 16.7, '515880': 16.7, '159582': 16.6, '518880': 20, '159570': 20 }
    : Object.fromEntries(universe.map((e) => [e.code, 100 / universe.length]));
  const bmFixedNav = (() => {
    let nav = 100;
    const out = [];
    for (let idx = firstIdx; idx < tradingDays.length; idx++) {
      const today = tradingDays[idx];
      if (endDate && today > endDate) break;
      const prevDate = idx > firstIdx ? tradingDays[idx - 1] : null;
      let ret = 0;
      for (const etf of universe) {
        const barT = barsMap[etf.code].find((b) => b.trade_date === today);
        const barP = prevDate ? barsMap[etf.code].find((b) => b.trade_date === prevDate) : null;
        if (!barT || !barP || barP.close === 0) continue;
        ret += (FIXED_WEIGHTS[etf.code] || 0) / 100 * (barT.close / barP.close - 1);
      }
      nav *= (1 + ret);
      out.push(nav);
    }
    return out;
  })();
  const bmFixedTotal = Math.round((bmFixedNav[bmFixedNav.length - 1] / bmFixedNav[0] - 1) * 10000) / 100;
  // 满仓最大收益基准：5 只各 20% 满仓持有（= 等权，等同）——A3 要求"100% 最大收益组合"取等权即可
  const bmMaxTotal = Math.round(equalRet * 100) / 100;
  // 关闭择时基准：始终按单票 30%/科技 65% 上限满配（近似 = 固定目标仓的激进版，此处用固定仓代表）

  const isSubset = universe.length !== 5;
  const evalOnly = !!(argVal('--from') || argVal('--to') || argVal('--codes'));
  const experiment = argVal('--experiment');
  const summary = {
    experiment: experiment || undefined,
    window: { start: first.date, end: last.date, days: navSeries.length, from: startDate, to: endDate },
    series,
    codes: universe.map((e) => e.code),
    eval_only: evalOnly,
    mix_forbidden: isSubset,
    listing_block: listingBlockReason(universe.map((e) => e.code)),
    oos: !!(argVal('--from') || argVal('--to')),
    prev_label: isSubset
      ? '三票/两票独立系列，不得与五票 126.46% 混比；本窗只评不调'
      : ((argVal('--from') || argVal('--to'))
        ? '调参窗 V3.8 126.46%（2025-02-25~2026-08-21，同窗拧出，不得当对照）'
        : undefined),
    engine: { totalRet: Math.round(totalRet * 100) / 100, maxDD: Math.round(maxDD * 100) / 100, sharpe: Math.round(sharpe * 100) / 100, finalNav: last.engine },
    equalWeight: { totalRet: Math.round(equalRet * 100) / 100, finalNav: last.equalWeight, n: universe.length, weight: Math.round(ew * 10000) / 100 },
    // A3 benchmark：等权 1/n / 满仓最大收益 / 固定目标仓组合 / （关闭择时=固定仓激进版）
    benchmark: {
      equalWeight20: Math.round(equalRet * 100) / 100,
      maxWeighted100: bmMaxTotal,
      fixedTargetPortfolio: bmFixedTotal,
      fixed_same_as_equal: isSubset || undefined
    },
    finalPositions: Object.fromEntries(universe.map((e) => [e.code, portfolio.positions[e.code].current_position])),
    cashRatio: Math.round(portfolio.cashRatio * 10) / 10,
    book: {
      end: Math.round(endBook * 10) / 10,
      max: Math.round(maxBook * 10) / 10,
      avg: bookDays ? Math.round((bookSum / bookDays) * 10) / 10 : 0,
      days_over_100: daysOver100,
      cash_raw: Math.round((100 - endBook) * 10) / 10,
      min_cash_raw: Math.round(minCashRaw * 10) / 10,
      unlev_totalRet: Math.round(unlevTotalRet * 100) / 100,
      leverage_contrib_pp: Math.round((totalRet - unlevTotalRet) * 100) / 100
    },
    mtm: {
      totalRet: Math.round(mtmTotalRet * 100) / 100,
      vs_engine_pp: Math.round((mtmTotalRet - totalRet) * 100) / 100,
      end_book: Math.round(mtmBookPct(mtmBook) * 10) / 10,
      max_book: Math.round(maxMtmBook * 10) / 10,
      weights: mtmWeights(mtmBook)
    },
    cash_cap: cashCap,
    cash_cap_stats: cashCap ? { clipped: cashCapClipped, refused: cashCapRefused } : undefined,
    frp: liveSignals ? {
      label: 'F(W代理)+regime(科技周线代理)+溢价(bias_20d代理)',
      regime_days: regimeDays,
      f_counts: fCounts,
      premium_counts: premiumCounts
    } : undefined,
    actions: actionsCount,
    trades: trades.length,
    buildEvents: trades.filter((t) => t.action === 'BUILD'),
    monthly,
    navSeries, // 全量曲线（供图表）
    perEtf: Object.fromEntries(universe.map((e) => {
      const buys = trades.filter((t) => t.code === e.code && (t.action === 'ADD' || t.action === 'BUILD'));
      const sells = trades.filter((t) => t.code === e.code && t.action.indexOf('REDUCE') >= 0);
      return [e.code, { buys: buys.length, sells: sells.length }];
    })),
    f_path: fPath,
    f5_zero_days: f5ZeroDays.slice(0, 20),
    sr_samples: srSamples.filter((_, i) => i % Math.max(1, Math.floor(srSamples.length / 10)) === 0).slice(0, 10)
  };

  const stamp = new Date().toISOString().slice(0, 10);
  const tag = process.argv.find((a) => a.indexOf('--tag=') === 0);
  const suffix = tag ? tag.slice(6) : (fPath ? `f5-path-${stamp}` : stamp);
  const outFile = path.join(OUT_DIR, `full-engine-${suffix}.json`);
  fs.writeFileSync(outFile, JSON.stringify(summary, null, 2));
  if (isSubset) {
    console.log('════════ 全链路回测（V4.1 · 独立票池 · 只评不调）════════');
    console.log(`系列 ${series}  票 ${universe.map((e) => e.code).join(',')}  不得与五票 126.46% 混比`);
  } else {
    console.log(fPath
      ? '════════ 全链路回测（V3.1 · 合成 F4/F5 路径）════════'
      : '════════ 全链路回测（V3.1 · 可信口径）════════');
  }
  console.log(`窗口: ${summary.window.start} ~ ${summary.window.end}（${summary.window.days} 交易日）`);
  console.log(`引擎: 累计 ${summary.engine.totalRet}% | 回撤 ${summary.engine.maxDD}% | Sharpe ${summary.engine.sharpe} | 期末净值 ${summary.engine.finalNav}`);
  console.log(`等权: 累计 ${summary.equalWeight.totalRet}% | 期末净值 ${summary.equalWeight.finalNav} | 每票 ${summary.equalWeight.weight}%`);
  console.log(`benchmark: 等权1/${universe.length} ${summary.benchmark.equalWeight20}% | 满仓100% ${summary.benchmark.maxWeighted100}% | 固定目标仓 ${summary.benchmark.fixedTargetPortfolio}%`);
  console.log(`期末仓位: ${JSON.stringify(summary.finalPositions)} | 现金(夹0) ${summary.cashRatio}% | 合计仓 ${summary.book.end}% | 最大合计 ${summary.book.max}% | 日均 ${summary.book.avg}% | 超100% ${summary.book.days_over_100} 天 | 现金未夹 ${summary.book.cash_raw}% | 最低现金未夹 ${summary.book.min_cash_raw}%`);
  console.log(`去杠杆累计 ${summary.book.unlev_totalRet}% | 隐杠杆贡献 ${summary.book.leverage_contrib_pp > 0 ? '+' : ''}${summary.book.leverage_contrib_pp}pp（超100%日把收益按 100/合计 缩回；不改决策）`);
  console.log(`市值重标: 累计 ${summary.mtm.totalRet}% | 相对粘性 ${summary.mtm.vs_engine_pp > 0 ? '+' : ''}${summary.mtm.vs_engine_pp}pp | 期末合计 ${summary.mtm.end_book}% | 最大合计 ${summary.mtm.max_book}%（同一笔调仓、份额随行情漂移；不进决策）`);
  if (cashCap) {
    console.log(`现金约束对照（成交层，不进 decision.js）：减量 ${cashCapClipped} 笔 · 拒加 ${cashCapRefused} 笔 | 相对 V3.8 基线 126.46%/14.73% 按否决标准验收，不按收益留下`);
  }
  if (liveSignals) {
    console.log(`F/Regime/溢价对照（代理，不覆盖 126.46% 基线）：${summary.frp.label}`);
    console.log(`  环境天数 ${JSON.stringify(summary.frp.regime_days)} | F票日 ${JSON.stringify(summary.frp.f_counts)} | 溢价票日 ${JSON.stringify(summary.frp.premium_counts)}`);
  }
  console.log(`动作分布: ${JSON.stringify(summary.actions)}`);
  console.log(`实际调仓 ${summary.trades} 笔`);
  console.log(`单票建/减: ${JSON.stringify(summary.perEtf)}`);
  if (fPath) {
    console.log(`F5→仓位0 的日子: ${f5ZeroDays.length ? f5ZeroDays.slice(0, 5).map((x) => `${x.date} ${x.code}`).join(' | ') : '无'}`);
  }
  console.log(`\n输出: ${outFile}`);
}

if (require.main === module) main();

module.exports = {
  loadCsv, decideDay, makeSlowResolver, makeCooldown,
  ETFS, START_DATE, PARAMS, TECH_SECTORS, INITIAL_POSITION, SINGLE_MAX, TECH_MAX
};
