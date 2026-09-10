/**
 * 云函数：runDecisionEngine —— 决策引擎（评分 + 仓位引擎 + 硬规则 → 落库）
 * 触发：链式（materializeIndicators 完成后）+ 定时兜底 + 后台手动
 * 流程：读 indicator_snapshot/risk_events/fundamental_state/portfolio_position/trade_log
 *       → 慢变量核心仓解析 + 冷静期 → decision.runDecision
 *       → 写 decision_result + fundamental_state + portfolio_snapshot + portfolio_position
 */

'use strict';

const cloudbase = require('@cloudbase/node-sdk');
const db = require('./common/utils/db');
const decision = require('./common/utils/decision');
const decisionV3 = require('./common/utils/decision-v3.js')();
const { deriveMarketEnvironmentForPortfolio } = require('./common/utils/market-env-v3.js');
const {
  mergeShadowOutputs, buildV3Portfolio, appendSlowBreakHistory,
  applyV361ParamBundle, resolveShadowEngineVersion
} = require('./common/utils/v3-shadow.js');
const { effectiveTechCap } = require('./common/utils/correlation.js');
const { swingHighLow } = require('./common/utils/trend-stage.js');
const { buildShadowDailyEntry, summarizeEntry } = require('./common/utils/shadow-v3-log.js');
const indicators = require('./common/utils/indicators');
const { replayAverageCost } = require('./common/utils/pnl');
const { snapshotHoldingsMv, resolveCashYuan, liveTotalAsset } = require('./common/utils/live-asset');
const { indicatorSignal, layerOf, syncFundamentalConfigs, pickLatestSeries } = require('./common/utils/fundamental');
const { computeCooldownDays } = require('./common/utils/cooldown');
// WP-G1（G1-01/02/03）：Gen-1 Authority 状态机 + Safety Core Permission + Canary 反事实链
const { resolveAuthority, authorityAllows } = require('./common/utils/gen1-authority');
const { evaluateGen1Permission } = require('./common/utils/gen1-safety-permission');
const {
  buildCanaryCounterfactual, sectorOccupation,
  counterfactualSectorRemaining, stepCounterfactualLedger
} = require('./common/utils/gen1-canary');
const { applyGen1Overlay, verifyProductionNoop } = require('./common/utils/gen1-overlay');
const { evaluateDomainPermission } = require('./common/utils/gen1-domain-permission');
const { readHealthState, healthStateToGate, defaultHealthState } = require('./common/utils/gen1-health-state');
const { resolveExecution } = require('./common/utils/gen1-execution-boundary');
const {
  COLLECTIONS, DEFAULT_PARAMS, TECH_SECTORS, SEMI_SECTORS,
  GRADE_SCORES, METRIC_TYPES, METRIC_LAYERS, LAYER_WEIGHTS,
  CASH_REGIME, COOLDOWN_DAYS, F_TO_CORE_GRADE, CORE_CONFIRM_PERIODS, TRADE_CONFIRM_PERIODS
} = require('./common/constants');

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });

function mergeParams(params) {
  const merged = { ...DEFAULT_PARAMS };
  Object.keys(params || {}).forEach((k) => { merged[k] = params[k]; });
  if (params && params.opportunity_weights) merged.opportunity_weights = params.opportunity_weights;
  // 点号 key → snake_case 映射（R3-3：仅作旧数据兼容；snake_case key 已存在时优先 snake_case，避免旧值覆盖新值）
  const dotMap = {
    'cooldown.days': 'cooldown_days',
    'add.breakout.max_pct': 'add_breakout_max_pct',
    'over_alloc.threshold': 'over_alloc_thresholds',
    'cash.regime': 'cash_regime',
    'core.ratio': 'core_ratio',
    'factor.opportunity': 'factor_opportunity',
    'risk.factor': 'risk_factor'
  };
  Object.keys(dotMap).forEach((dotKey) => {
    const snakeKey = dotMap[dotKey];
    if (params && params[dotKey] != null && params[snakeKey] === undefined) {
      merged[snakeKey] = params[dotKey];
    }
  });
  return merged;
}

/** 数字截断到 [-2, 2]（连续信号分范围） */
function clampSignal(v) { return Math.max(-2, Math.min(2, v)); }

/**
 * 量化指标信号分：优先用数值变化幅度（pct_change / 5，5% 变化=满信号），无 prev 时退回 up/down 离散值。
 */
function quantSignal(row) {
  const value = Number(row.value);
  const prev = row.prev != null ? Number(row.prev) : null;
  if (value != null && !Number.isNaN(value) && prev != null && !Number.isNaN(prev) && prev !== 0) {
    const pct = ((value - prev) / Math.abs(prev)) * 100;
    return clampSignal(pct / 5);
  }
  if (row.direction === 'up') return 1;
  if (row.direction === 'down') return -1;
  return 0;
}

/**
 * 计算基本面状态（V2.1 三层结构：hard_data 50% / earnings 30% / events 20%）。
 * 每层内按指标 weight + confidence 加权聚合层内信号分，量化指标用数值变化幅度（quantSignal）。
 * 三层加权：finalSignal = Σ(layerSignal × LAYER_WEIGHTS[layer]) ÷ Σ(参与层的权重)。
 * @returns {Promise<{f_state:string, f_score:number, detail:object, updated_at:Date}>}
 */
async function computeFundamentalState(code) {
  const configs = await db.query(COLLECTIONS.FUNDAMENTAL_CONFIG, { code });
  const layers = {};
  let positive = 0;
  let negative = 0;

  for (const cfg of configs) {
    const rows = await db.query(COLLECTIONS.FUNDAMENTAL_SERIES, { code, indicator: cfg.indicator }, {
      orderBy: [{ field: 'data_date', direction: 'desc' }], limit: 40
    });
    const row = pickLatestSeries(rows, cfg);
    if (!row) continue;
    const weight = Number(cfg.weight) || 0;
    if (weight <= 0) continue;

    const signal = indicatorSignal(row, cfg);
    const confRaw = Number(row.confidence);
    const conf = (confRaw >= 0 && confRaw <= 1) ? confRaw : 0.7;

    const layer = layerOf(cfg);
    if (!layers[layer]) layers[layer] = { weighted: 0, weight: 0, count: 0 };
    layers[layer].weighted += signal * conf * weight;
    layers[layer].weight += weight;
    layers[layer].count += 1;
    if (signal > 0) positive += 1;
    else if (signal < 0) negative += 1;
  }

  // 三层加权
  const layerBreakdown = {};
  let finalSignal = 0;
  let totalLayerWeight = 0;
  for (const [layer, info] of Object.entries(layers)) {
    const layerWeight = LAYER_WEIGHTS[layer] != null ? LAYER_WEIGHTS[layer] : 0;
    const layerSignal = info.weight > 0 ? info.weighted / info.weight : 0;
    layerBreakdown[layer] = {
      signal: Math.round(layerSignal * 100) / 100,
      weight: layerWeight,
      count: info.count
    };
    finalSignal += layerSignal * layerWeight;
    totalLayerWeight += layerWeight;
  }
  if (totalLayerWeight > 0) finalSignal = finalSignal / totalLayerWeight;

  let f_state = 'F3';
  let f_score = 15;
  if (totalLayerWeight > 0) {
    // D4：数据覆盖度惩罚——缺层的 ETF 信号按覆盖度向中性收缩（如黄金只有 hard_data=50，信号折半），
    // 避免「只有一层数据却和三层满的 ETF 用同阈值判 F1/F5 极端」。
    const coverage = Math.min(1, totalLayerWeight / 100);
    const adjustedSignal = finalSignal * coverage;
    if (adjustedSignal >= 1.0) { f_state = 'F1'; f_score = 25; }
    else if (adjustedSignal >= 0.4) { f_state = 'F2'; f_score = 20; }
    else if (adjustedSignal <= -1.0) { f_state = 'F5'; f_score = 5; }
    else if (adjustedSignal <= -0.4) { f_state = 'F4'; f_score = 10; }
    else { f_state = 'F3'; f_score = 15; }
  }
  return {
    f_state, f_score,
    detail: {
      final_signal: Math.round(finalSignal * 100) / 100,
      total_layer_weight: totalLayerWeight,
      positive, negative,
      layer_breakdown: layerBreakdown
    },
    updated_at: new Date()
  };
}

/** 风险汇总（激活中的事件） */
async function getRiskSummary(code) {
  const events = await db.getActiveRiskEvents(code);
  let riskFlag = 'NORMAL';
  let riskOverride = false;
  events.forEach((ev) => {
    if (ev.risk_override === true) riskOverride = true;
    if (ev.risk_flag === 'RED') riskFlag = 'RED';
    else if (ev.risk_flag === 'YELLOW' && riskFlag === 'NORMAL') riskFlag = 'YELLOW';
  });
  return { risk_flag: riskFlag, risk_override: riskOverride, events };
}

/** 海外信号物化：读 global_quote，对每个标的算 MA20 趋势 / 5日动量 / 20日位置 */
async function computeGlobalSignals() {
  const rows = await db.query(COLLECTIONS.GLOBAL_QUOTE, {});
  if (rows.length === 0) return [];
  const bySymbol = {};
  rows.forEach((r) => {
    if (!bySymbol[r.symbol]) bySymbol[r.symbol] = { name: r.name, related: r.related, factor: r.factor, bars: [] };
    bySymbol[r.symbol].bars.push(r);
  });
  const signals = [];
  for (const [symbol, g] of Object.entries(bySymbol)) {
    const bars = g.bars.sort((a, b) => (a.trade_date < b.trade_date ? -1 : 1));
    const last = bars[bars.length - 1];
    const closes = bars.map((b) => b.close).filter((v) => v != null && !Number.isNaN(v));
    const ma20 = closes.length >= 20 ? closes.slice(-20).reduce((s, v) => s + v, 0) / 20 : null;
    const c5 = closes.length >= 6 ? closes[closes.length - 6] : null;
    const momentum5d = c5 != null && c5 !== 0 ? ((last.close - c5) / c5) * 100 : null;
    const win = closes.slice(-20);
    const hi = win.length ? Math.max(...win) : null;
    const lo = win.length ? Math.min(...win) : null;
    const position20d = (hi != null && lo != null && hi - lo > 0) ? (last.close - lo) / (hi - lo) : null;
    signals.push({
      symbol,
      name: g.name,
      related: g.related,
      factor: g.factor,
      close: last.close,
      trend_20d: ma20 != null ? (last.close >= ma20 ? '上' : '下') : null,
      momentum_5d: momentum5d != null ? Math.round(momentum5d * 100) / 100 : null,
      position_20d: position20d != null ? Math.round(position20d * 100) / 100 : null,
      data_date: last.trade_date
    });
  }
  return signals;
}

/** 市场环境推导（V2.1）：由宽基指数周线趋势推导，不再由仓位反推。
 *  沪深300/科创50/创业板指三个指数周线 W 状态打分：W1/W2=强(2)、W3=中(1)、W4/W5=弱(0)，求和(0~6)；
 *  再纳入纳指(usNDX) trend_20d 作为全球风险偏好一票（上 +1 / 下 −1），总分 0~7。
 *  ≥6 aggressive / 4~5 structural / 2~3 range / 1 defensive / ≤0 crisis；无数据兜底 range。 */
async function deriveMarketRegime(globalSignals) {
  const envRows = await db.query(COLLECTIONS.MARKET_ENV, {});
  if (!envRows || envRows.length === 0) return 'range'; // 首日未抓，中性兜底，不编造
  let score = 0;
  let scored = 0;
  for (const row of envRows) {
    const bars = row.weekly_bars || [];
    if (bars.length < 20) continue;
    const w = indicators.detectWState(bars, {}).state;
    scored += 1;
    if (w === 'W1' || w === 'W2') score += 2;
    else if (w === 'W3') score += 1;
    // W4/W5 → 0
  }
  // 海外风险偏好：纳指趋势作为额外一票
  const gs = globalSignals || await computeGlobalSignals();
  const ndx = gs.find((s) => s.symbol === 'usNDX');
  if (ndx && ndx.trend_20d === '上') score += 1;
  else if (ndx && ndx.trend_20d === '下') score -= 1;

  if (scored === 0) return 'range';
  if (score >= 6) return 'aggressive';
  if (score >= 4) return 'structural';
  if (score >= 2) return 'range';
  if (score >= 1) return 'defensive';
  return 'crisis';
}

/** 近 N 日 K 线（V3 SlowBreak / 相关性 TechCap） */
async function loadRecentDailyBars(code, limit = 80) {
  const rows = await db.query(COLLECTIONS.ETF_DAILY, { code }, {
    orderBy: [{ field: 'trade_date', direction: 'desc' }], limit
  });
  return rows.sort((a, b) => (a.trade_date < b.trade_date ? -1 : 1));
}

async function loadBarsCache(etfList) {
  const cache = {};
  await Promise.all(etfList.map(async (etf) => {
    cache[etf.code] = await loadRecentDailyBars(etf.code);
  }));
  return cache;
}

/**
 * 组合汇总：科技/半导体/黄金/创新药仓位 + 现金拆分 + 组合环境 + 海外信号。
 * @param {string} marketRegime 市场环境（由 deriveMarketRegime 推导）
 * @param {Array<object>} globalSignals 海外信号（computeGlobalSignals 结果）
 */
async function getPortfolioSummary(etfs, positions, marketRegime, globalSignals) {
  let techPosition = 0;
  let semiPosition = 0;
  let goldPosition = 0;
  let drugPosition = 0;
  positions.forEach((p) => {
    const etf = etfs.find((e) => e.code === p.code);
    if (!etf) return;
    const sector = etf.sector || '';
    if (TECH_SECTORS.indexOf(sector) >= 0) techPosition += p.current_position || 0;
    if (SEMI_SECTORS.indexOf(sector) >= 0) semiPosition += p.current_position || 0;
    if (sector === 'gold') goldPosition += p.current_position || 0;
    if (sector === 'biotech') drugPosition += p.current_position || 0;
  });
  const totalPosition = positions.reduce((s, p) => s + (p.current_position || 0), 0);
  const cashRatio = Math.max(0, 100 - totalPosition);
  const regime = marketRegime || 'range';
  const cashRange = CASH_REGIME[regime] || [20, 35];
  const strategicCash = Math.min(cashRange[0], cashRatio);
  const deployableCash = Math.max(0, cashRatio - strategicCash);
  return {
    tech_position: techPosition,
    semi_position: semiPosition,
    gold_position: goldPosition,
    drug_position: drugPosition,
    cash_ratio: cashRatio,
    strategic_cash: strategicCash,
    deployable_cash: deployableCash,
    market_regime: regime,
    total_position: totalPosition,
    global_signals: globalSignals || []
  };
}

/**
 * 慢变量：核心仓 + 交易仓比例等级解析（两档确认周期）。
 * - 核心仓等级：连续 CORE_CONFIRM_PERIODS（20）个交易日同等级才确认调整（慢，管底仓）
 * - 交易仓等级：连续 TRADE_CONFIRM_PERIODS（10）个交易日同等级才确认调整（快，管灵活仓）
 * - F5 证伪：两者即时清零，不走慢变量
 * @returns {Promise<{core_ratio_grade, pending_grade, pending_since, core_ratio_changed_at, trade_ratio_grade, trade_pending_grade, trade_pending_since, trade_changed_at, changed}>}
 */
async function resolveCoreRatioGrade(pos, fState, today) {
  const targetGrade = F_TO_CORE_GRADE[fState] || 'C';
  // —— 核心仓（20 日确认）——
  let coreGrade = pos.core_ratio_grade || 'B';
  let pendingGrade = pos.pending_grade || null;
  let pendingSince = pos.pending_since || null;
  let changedAt = pos.core_ratio_changed_at || null;
  // —— 交易仓（10 日确认）——
  let tradeGrade = pos.trade_ratio_grade || 'B';
  let tradePendingGrade = pos.trade_pending_grade || null;
  let tradePendingSince = pos.trade_pending_since || null;
  let tradeChangedAt = pos.trade_changed_at || null;
  let changed = false;

  if (fState === 'F5') {
    // 证伪是强信号，核心仓与交易仓直接清零，不走慢变量
    if (coreGrade !== 'F5' || pendingGrade || tradeGrade !== 'F5' || tradePendingGrade) {
      coreGrade = 'F5';
      pendingGrade = null;
      pendingSince = null;
      tradeGrade = 'F5';
      tradePendingGrade = null;
      tradePendingSince = null;
      changedAt = today;
      tradeChangedAt = today;
      changed = true;
    }
  } else {
    // 核心仓解析
    if (targetGrade === coreGrade) {
      if (pendingGrade) { pendingGrade = null; pendingSince = null; changed = true; }
    } else if (pendingGrade === targetGrade) {
      const days = await countTradingDaysBetween(pos.code, pendingSince, today);
      if (pendingSince && days >= CORE_CONFIRM_PERIODS) {
        coreGrade = targetGrade;
        pendingGrade = null;
        pendingSince = null;
        changedAt = today;
        changed = true;
      }
    } else {
      pendingGrade = targetGrade;
      pendingSince = today;
      changed = true;
    }
    // 交易仓解析（独立确认周期，更快参与）
    if (targetGrade === tradeGrade) {
      if (tradePendingGrade) { tradePendingGrade = null; tradePendingSince = null; changed = true; }
    } else if (tradePendingGrade === targetGrade) {
      const days = await countTradingDaysBetween(pos.code, tradePendingSince, today);
      if (tradePendingSince && days >= TRADE_CONFIRM_PERIODS) {
        tradeGrade = targetGrade;
        tradePendingGrade = null;
        tradePendingSince = null;
        tradeChangedAt = today;
        changed = true;
      }
    } else {
      tradePendingGrade = targetGrade;
      tradePendingSince = today;
      changed = true;
    }
  }

  return {
    core_ratio_grade: coreGrade,
    pending_grade: pendingGrade,
    pending_since: pendingSince,
    core_ratio_changed_at: changedAt,
    trade_ratio_grade: tradeGrade,
    trade_pending_grade: tradePendingGrade,
    trade_pending_since: tradePendingSince,
    trade_changed_at: tradeChangedAt,
    changed
  };
}

/** 数 fromDate(不含) 到 toDate(含) 之间的交易日数（基于 ETF_DAILY） */
async function countTradingDaysBetween(code, fromDate, toDate) {
  if (!code || !fromDate || !toDate) return 0;
  const rows = await db.query(COLLECTIONS.ETF_DAILY, { code }, {
    orderBy: [{ field: 'trade_date', direction: 'asc' }]
  });
  if (rows.length === 0) return 0;
  let count = 0;
  for (const r of rows) {
    if (r.trade_date > fromDate && r.trade_date <= toDate) count += 1;
  }
  return count;
}

/** 加仓冷静期：公共模块 common/utils/cooldown.js（runDecisionEngine 与 apiGateway 共用）
 *  V3.1 A4：冷静期长度看**上次买入当时的 add_mode**，不看今天探针模式
 *  （突破后第 3 日即使今天像横盘，仍按 5 日暂停）。
 */

/**
 * 自动浮盈计算（2026-08-22）：从 TRADE_LOG 成交记录用「加权平均成本法」还原持仓，
 * 乘以最新收盘价 → 每只浮盈 + 总浮盈。供前台「总览-浮盈」卡片（无需手动录入）。
 * 注意：sell 记录中 shares 为卖出份额，扣减持仓；加权成本在卖出时保持不变（平均成本法）。
 * @param {Array} etfs ETF 基础信息列表
 * @returns {Promise<{total_pnl:number|null, perEtf:object, total_value:number|null}>}
 *          total_pnl=null 表示无成交记录无法计算（调用方回退用户录入值）
 */
async function computeAutoPnl(etfs) {
  // 不分页截断：db.query 无 limit 时自动翻页拉全。平均成本法必须按时间正序。
  const raw = await db.query(COLLECTIONS.TRADE_LOG, {}, {
    orderBy: [{ field: 'trade_date', direction: 'asc' }]
  }).catch(() => []);
  if (!raw || !raw.length) return { total_pnl: null, perEtf: {}, total_value: null };
  const holdings = replayAverageCost(raw);

  // 取每只最新收盘价（最近一条 ETF_DAILY）
  const perEtf = {};
  let totalPnl = 0;
  let totalValue = 0;
  let hasAny = false;
  for (const etf of etfs) {
    const h = holdings[etf.code];
    if (!h || h.shares <= 0) { perEtf[etf.code] = { shares: 0, avg_cost: 0, value: 0, pnl: 0 }; continue; }
    const daily = await db.query(COLLECTIONS.ETF_DAILY, { code: etf.code }, {
      orderBy: [{ field: 'trade_date', direction: 'desc' }], limit: 1
    }).catch(() => []);
    const lastClose = daily.length ? Number(daily[0].close) : null;
    if (!lastClose || lastClose <= 0) { perEtf[etf.code] = { shares: h.shares, avg_cost: Math.round(h.avgCost * 100) / 100, value: 0, pnl: 0 }; continue; }
    const value = h.shares * lastClose;
    const cost = h.shares * h.avgCost;
    const pnl = value - cost;
    perEtf[etf.code] = {
      shares: Math.round(h.shares * 100) / 100,
      avg_cost: Math.round(h.avgCost * 100) / 100,
      value: Math.round(value * 100) / 100,
      pnl: Math.round(pnl * 100) / 100
    };
    totalPnl += pnl;
    totalValue += value;
    hasAny = true;
  }
  if (!hasAny) return { total_pnl: null, perEtf, total_value: null };
  return { total_pnl: Math.round(totalPnl * 100) / 100, perEtf, total_value: Math.round(totalValue * 100) / 100 };
}

exports.main = async (event = {}, context = {}) => {
  const startedAt = Date.now();
  try {
    const { params, version } = await db.getParamConfig();
    const merged = applyV361ParamBundle(mergeParams(params));
    try { await syncFundamentalConfigs(db, COLLECTIONS.FUNDAMENTAL_CONFIG); } catch (e) { /* 模板同步失败不阻断决策 */ }

    const etfs = await db.getEtfList();
    const positions = await db.query(COLLECTIONS.PORTFOLIO_POSITION, {});
    const globalSignals = await computeGlobalSignals();
    const marketRegime = await deriveMarketRegime(globalSignals);
    const portfolio = await getPortfolioSummary(etfs, positions, marketRegime, globalSignals);
    const trendStageEnabled = merged.trend_stage_enabled === true;
    // V3.6.1 Shadow：总闸开启且 shadow 标记时强制并行；否则沿用 v3_shadow_enabled
    const shadowEnabled = merged.v3_6_1_enabled === true && merged.v3_6_1_shadow === true
      ? true
      : (merged.v3_shadow_enabled !== false);
    const runV3Path = trendStageEnabled || shadowEnabled;
    const shadowEngineVer = resolveShadowEngineVersion(merged);

    const results = [];
    const shadowItems = [];
    let latestDate = '';

    // —— 阶段一：预读所有 ETF 数据 + 预计算机会分（供科技赛道按机会分排序分配额度）——
    const prepared = [];
    for (const etf of etfs) {
      try {
        const snapshot = await db.getLatestSnapshot(etf.code);
        if (!snapshot) { prepared.push({ etf, snapshot: null }); continue; }
        latestDate = snapshot.calc_date;
        const today = latestDate;

        const fundamental = await computeFundamentalState(etf.code);
        const risk = await getRiskSummary(etf.code);
        const position = positions.find((p) => p.code === etf.code) || {
          code: etf.code, current_position: 0, target_std: etf.target_position || 0,
          target_max: etf.max_position || 30, max_strategic_position: etf.max_position || 30
        };

        // 慢变量：解析核心仓等级（连续 20 个交易日同等级才调整）
        const coreResolved = await resolveCoreRatioGrade(position, fundamental.f_state, today);
        // 注入慢变量确认后的核心仓等级
        const posWithCore = { ...position, core_ratio_grade: coreResolved.core_ratio_grade, trade_ratio_grade: coreResolved.trade_ratio_grade };

        // 预计算机会分（不落库，仅用于赛道分配排序）+ 探针 add_mode（B6 冷静期自适应用）
        const probe = decision.runDecision(etf, snapshot, posWithCore, merged, { fundamental, risk, portfolio });

        prepared.push({
          etf, snapshot, today, fundamental, risk, position, coreResolved, posWithCore,
          opportunityScore: probe.opportunity_score,
          probeAddMode: probe.add_mode,
          probeTarget: probe.final_target
        });
      } catch (e) {
        prepared.push({ etf, error: String(e.message || e) });
      }
    }

    let v3MarketEnv = null;
    let barsCache = null;
    const techMax = merged.tech_sector_max != null ? merged.tech_sector_max : DEFAULT_PARAMS.tech_sector_max;
    if (runV3Path) {
      const breadthSource = merged.v3_breadth_source === 'portfolio' ? 'portfolio' : 'index';
      v3MarketEnv = await deriveMarketEnvironmentForPortfolio(
        db, indicators, prepared, globalSignals, { breadthSource }
      );
      portfolio.market_score = v3MarketEnv.market_score;
      portfolio.portfolio_breadth_proxy = v3MarketEnv.portfolio_breadth_proxy;
      portfolio.v3_breadth_source = v3MarketEnv.breadth_source;
      if (trendStageEnabled) {
        portfolio.market_regime = v3MarketEnv.market_regime;
        portfolio.market_factor = v3MarketEnv.market_factor;
      }
      try {
        barsCache = await loadBarsCache(etfs);
        const techCapInfo = effectiveTechCap(techMax, barsCache);
        portfolio.effective_tech_cap = techCapInfo.effective_cap;
        portfolio.correlation_discount = techCapInfo.discount;
        portfolio.tech_correlation = techCapInfo;
      } catch (e) { /* 相关性折扣失败不阻断 */ }
    }

    // —— 阶段二：非科技 ETF 先处理；科技 ETF 按边际机会分配，依次分配赛道剩余额度 ——
    // B9 边际机会分配（2026-08-22）：排序 = 机会分 × 目标缺口（gap）——高分且剩余空间大的优先，
    // 避免"高分但已满仓"标的独占 65% 额度、后续低仓高分标的加不上（ChatGPT 组合层建议）
    const isTech = (p) => p.etf && p.snapshot && TECH_SECTORS.indexOf(p.etf.sector) >= 0;
    const marginalScore = (p) => {
      const score = p.opportunityScore || 0;
      const current = p.position ? (p.position.current_position || 0) : 0;
      const target = p.probeTarget != null ? p.probeTarget : (p.position ? (p.position.target_position || current) : current);
      const gap = Math.max(0, target - current); // 剩余空间
      return score * (1 + gap / 30); // 机会分 × (1 + 归一化缺口)，缺口大者加成
    };
    const ordered = [
      ...prepared.filter((p) => !isTech(p)),
      ...prepared.filter(isTech).sort((a, b) => marginalScore(b) - marginalScore(a))
    ];
    const effectiveTechMax = portfolio.effective_tech_cap != null ? portfolio.effective_tech_cap : techMax;
    let sectorUsed = portfolio.tech_position != null ? portfolio.tech_position : 0;

    // ---- WP-G1 G1-01/G1-02：Gen-1 权限状态机 + 当日信号 ----
    // 权限一律 fail-closed：未知/非法取值不得获得高于 ADVISORY 的权限；
    // production_write / auto_execution 恒 false（见 gen1-authority）。
    const gen1Authority = resolveAuthority(merged);
    const gen1SignalByCode = {};
    try {
      const sigRows = await db.query(COLLECTIONS.ML_SHADOW_SIGNAL, { date: latestDate });
      for (const s of (sigRows || [])) gen1SignalByCode[String(s.code)] = s;
    } catch (e) {
      // 信号缺失不阻断生产决策；Safety 会按「不可用」fail-closed 处理
    }
    // canary 重算所需的 V3.6.1 上下文（仅 authority>=CANARY 时才真正调用）
    // G1.1-05 / WP-G1.2 G1.2-03 / G1.3-01：Canary 组合平价 —— 科技额度按**组合总仓位**顺序累计，
    // 种子 = portfolio.tech_position（与生产 sectorUsed 完全同构），保证聚合不破 tech cap。
    // G1.3-01：**所有**科技 ETF 都推进本账本（非 Candidate 按 baseline 推进）。
    let canarySectorUsed = portfolio.tech_position != null ? portfolio.tech_position : 0;
    // G1.3-07：本轮真正执行了几次 Gen-1 反事实重算（S4 rerun）—— 用于对外状态字段
    let canaryInvocationCount = 0;
    // G1.3-11：Σ 反事实**战略目标**（信息性；**不受** cap 约束，见步进函数注释）
    let counterfactualTargetSum = 0;
    // G1.2-01/02：健康状态唯一真相 = 持久化 latch（三态读取，异常一律 fail-closed）
    let gen1GlobalGate;
    let gen1HealthState;
    try {
      gen1HealthState = await readHealthState(db, COLLECTIONS);
    } catch (e) {
      // 防御性兜底：readHealthState 内部已 fail-closed，此处同样不得返回 OK
      gen1HealthState = Object.assign(defaultHealthState(), {
        read_status: 'READ_ERROR', read_reason_code: 'HEALTH_STATE_READ_ERROR'
      });
    }
    gen1GlobalGate = healthStateToGate(gen1HealthState);
    const gen1GlobalHealth = gen1GlobalGate.latched_health;
    if (gen1GlobalGate.gate_status !== 'ACTIVE') {
      console.warn(`[GEN1-HEALTH] gate_status=${gen1GlobalGate.gate_status}`
        + ` reason=${gen1GlobalGate.read_reason_code} → allow_advisory=${gen1GlobalGate.allow_advisory}`
        + ` allow_canary=${gen1GlobalGate.allow_canary}`);
    }
    // G1-09：执行边界（恒 false；配置试图开启时产生审计记录）
    const gen1Execution = resolveExecution(merged);
    if (gen1Execution.audit) {
      console.warn(`[SECURITY] ${gen1Execution.audit.code}: ${gen1Execution.audit.message}`);
    }

    for (const p of ordered) {
      try {
        if (p.error) { results.push({ code: p.etf.code, ok: false, error: p.error }); continue; }
        if (!p.snapshot) { results.push({ code: p.etf.code, ok: false, reason: '无指标快照' }); continue; }
        const etf = p.etf;
        const today = p.today;

        // 科技 ETF：组合层分配的赛道剩余额度（防止多只同时加仓叠加突破 65% 上限）
        let sectorRemainingLimit = null;
        if (TECH_SECTORS.indexOf(etf.sector) >= 0) {
          const current = p.position.current_position || 0;
          sectorRemainingLimit = Math.max(0, effectiveTechMax - (sectorUsed - current));
        }

        // 加仓冷静期（B6：按探针的 add_mode 自适应——普通横盘 2 日 / 突破加仓 5 日）
        const probeAddMode = p.probeAddMode || '无';
        const cooldownDays = await computeCooldownDays(db, etf.code, today, merged, probeAddMode);

        // 数据完整性强制 WAIT：快照数据不完整（如抓取半包/上游缺失）时不出决策，避免用旧/残缺数据误导
        if (p.snapshot.data_complete === false) {
          const waitResult = decision.buildWaitResult(etf, p.snapshot, '数据不完整（data_complete=false），待数据补齐后重算');
          await db.upsert(COLLECTIONS.DECISION_RESULT, waitResult, { code: etf.code, decision_date: waitResult.decision_date });
          results.push({
            code: etf.code, ok: true, action: 'WAIT',
            opportunity_score: waitResult.opportunity_score,
            opportunity_grade: waitResult.opportunity_grade,
            final_target: waitResult.final_target,
            position_gap: waitResult.position_gap,
            reason: '数据不完整强制等待'
          });
          continue;
        }

        const v38Result = decision.runDecision(etf, p.snapshot, p.posWithCore, merged, {
          fundamental: p.fundamental,
          risk: p.risk,
          portfolio,
          cooldownDays,
          sectorRemainingLimit
        });

        let result = v38Result;
        let v3SlowBreakHistory = p.position.slow_break_history || [];
        // WP-G1.2 G1.2-03：Canary A/B 必须「输入完全相同，只有 advisoryStageOverride 不同」。
        // 这里在生产调用发生的那一刻把**全部**上下文冻结下来，供 canary 重算逐字段复用。
        let canaryCtx = null;

        if (runV3Path) {
          const etfBars = barsCache ? barsCache[etf.code] : null;
          const v3Portfolio = buildV3Portfolio(portfolio, v3MarketEnv);
          const v3TrendStageState = p.position.trend_stage_state || {};
          const v3ShockState = p.position.shock_state || null;
          // WP-G1：缓存 canary 重算上下文（避免重复 build）
          canaryCtx = {
            portfolio: v3Portfolio,
            bars: etfBars,
            trendStageState: v3TrendStageState,
            shockState: v3ShockState,
            slowBreakScores: v3SlowBreakHistory,   // ★ 生产当次实参（append 之前）
            sectorRemainingLimit
          };
          const v3Result = decisionV3.runDecision(etf, p.snapshot, p.posWithCore, merged, {
            fundamental: p.fundamental,
            risk: p.risk,
            portfolio: v3Portfolio,
            cooldownDays,
            sectorRemainingLimit,
            trendStageState: v3TrendStageState,
            shockState: v3ShockState,
            recentSlowBreakScores: v3SlowBreakHistory,
            riskEvents: p.risk.events || [],
            bars: etfBars
          });
          result = mergeShadowOutputs(v38Result, v3Result, merged, trendStageEnabled);
          const swing = etfBars ? swingHighLow(etfBars) : null;
          v3SlowBreakHistory = appendSlowBreakHistory(v3SlowBreakHistory, v3Result.slow_break_score, swing);
          p.position.trend_stage_state = v3Result.trend_stage_state;
          p.position.shock_state = v3Result.shock_state;
          p.position.slow_break_history = v3SlowBreakHistory;
        }

        // 更新科技赛道已用额度（本 ETF 本次的新增部分）
        // P1 回测结论：按「建议执行仓」占用（suggested_position - current）而非 final_target，
        // 避免多只科技 ETF 同时有信号时额度被目标仓占满、后续高分标的加不上（回测：被拦信号 12→0）
        // WP-G1.2：占用算法收敛为唯一的 sectorOccupation()，生产与 Canary 共用同一函数。
        if (TECH_SECTORS.indexOf(etf.sector) >= 0) {
          const current = p.position.current_position || 0;
          sectorUsed += sectorOccupation(current, result.suggested_position, result.final_target);
        }

        // 注入阶段通俗概括（来自 indicator_snapshot，供前端直接展示）
        if (p.snapshot.stage_summary) result.stage_summary = p.snapshot.stage_summary;

        // ---- WP-G1 G1-02/G1-03：Safety Core Permission（source=SAFETY_CORE）+ Canary 反事实 ----
        // 硬边界：以下字段**绝不**改写 result.final_target / final_action（生产仍为 V3.6.1）。
        const gen1Signal = gen1SignalByCode[String(etf.code)] || null;
        const baselineTarget = result.final_target;
        const baselineAction = result.final_action;
        const baselineStage = result.v361_baseline_stage || result.trend_stage_primary
          || p.snapshot.trend_stage_primary || p.snapshot.stage || null;
        // G1-06：域许可（有约束力；OUT_OF_DOMAIN → 禁止 Canary）
        const gen1Domain = evaluateDomainPermission(etf.sector, etf.code);
        // G1-05：数据健康（沿用 runGen1ShadowEod 计算的当日结果；缺失 → fail-closed）
        const gen1DataHealth = gen1Signal && gen1Signal.data_health_status
          ? { status: gen1Signal.data_health_status, reason_code: gen1Signal.data_health_reason_code || null }
          : null;
        // G1-07 / G1.2-01：运行时熔断门 —— **唯一真相**是持久化 latch（gen1GlobalGate）。
        // 绝不再用 gen1Signal.gen1_health_status 重新推导权限（那会造成「信号快照 ≫ 实时 latch」的越权）。
        const gen1SignalHealthSnapshot = gen1Signal ? (gen1Signal.gen1_health_status || null) : null;
        const gen1Gate = gen1GlobalGate;
        const gen1Params = gen1Gate.allow_gen1_timing
          ? merged
          : Object.assign({}, merged, { ml_shadow_observe: false }); // 强制 OFF → Safety 一律 BLOCK
        const gen1Permission = evaluateGen1Permission({
          params: gen1Params,
          signal: gen1Signal,
          baseline: { trend_stage_primary: baselineStage, v361_baseline_target: baselineTarget },
          risk: p.risk,
          fundamental: p.fundamental,
          snapshot: { structural_break: p.snapshot.structural_break, hard_break: p.snapshot.hard_break },
          today,
          dataHealth: gen1DataHealth,
          domainPermission: gen1Domain,
          healthGate: gen1Gate,
          signalHealthSnapshot: gen1SignalHealthSnapshot
        });
        result.gen1_canary_source = 'V361_RERUN_S4';

        // Canary 反事实：authority < CANARY（默认 ADVISORY）时不重算 → 生产零成本/零风险。
        // G1.2-03：必须继承生产调用的**完整** Safety context（含 slowBreak、trendStage、shock、bars、portfolio）。
        // G1.3-01：**完整组合反事实** —— 所有科技 ETF 共享同一 canary 账本与 cap（cap 优先）。
        const isTechEtf = TECH_SECTORS.indexOf(etf.sector) >= 0;
        const currentPos = p.position.current_position || 0;
        const canarySectorRemaining = counterfactualSectorRemaining({
          isTech: isTechEtf, sectorUsed: canarySectorUsed, currentPosition: currentPos,
          effectiveTechMax
        });
        let canarySuggestedPosition = null;
        const canary = buildCanaryCounterfactual({
          permission: gen1Permission,
          baseline: { stage: baselineStage, target: baselineTarget, action: baselineAction },
          recomputeCanaryTarget: (stage) => {
            if (!canaryCtx) return { target: baselineTarget, action: baselineAction };
            const c = decisionV3.runDecision(etf, p.snapshot, p.posWithCore, merged, {
              fundamental: p.fundamental, risk: p.risk, portfolio: canaryCtx.portfolio,
              cooldownDays,
              sectorRemainingLimit: canarySectorRemaining,
              trendStageState: canaryCtx.trendStageState,
              shockState: canaryCtx.shockState,
              recentSlowBreakScores: canaryCtx.slowBreakScores,
              riskEvents: p.risk.events || [], bars: canaryCtx.bars,
              advisoryStageOverride: stage
            });
            canarySuggestedPosition = c.suggested_position != null ? c.suggested_position : null;
            return { target: c.final_target, action: c.final_action, suggested_position: canarySuggestedPosition };
          }
        });
        canary.gen1_canary_sector_remaining = canarySectorRemaining;

        // G1.3-01：账本单步推进 —— **每个科技 ETF 都推进**（非 Candidate 按 baseline 推进）。
        // 这是复审 P0 的修复点：上一版只推进 gen1_canary_effective=true 的 ETF，
        // 导致「baseline 自加仓但无 Gen-1」的科技 ETF 漏记，后续 Candidate 获得虚假额度。
        const cfStep = stepCounterfactualLedger({
          isTech: isTechEtf,
          sectorUsed: canarySectorUsed,
          currentPosition: currentPos,
          effectiveTechMax,
          baselineTarget,
          baselineSuggested: result.suggested_position,
          canaryEffective: canary.gen1_canary_effective === true,
          canaryTarget: canary.gen1_canary_target,
          canarySuggested: canarySuggestedPosition,
          sectorRemainingLimit: canarySectorRemaining
        });
        canarySectorUsed = cfStep.nextSectorUsed;
        canary.gen1_counterfactual_target = cfStep.counterfactualTarget;
        canary.gen1_counterfactual_delta = cfStep.counterfactualDelta;
        canary.gen1_counterfactual_suggested_position = cfStep.counterfactualSuggestedPosition;
        canary.gen1_counterfactual_clamped = cfStep.clamped;
        canary.gen1_counterfactual_baseline_floor_breached = cfStep.baselineFloorBreached;
        canary.gen1_counterfactual_sector_remaining = cfStep.sectorRemainingLimit;
        canary.gen1_counterfactual_stage_changed = canary.gen1_canary_effective === true;
        if (isTechEtf) counterfactualTargetSum += cfStep.counterfactualTarget;
        if (canary.gen1_canary_effective === true) canaryInvocationCount += 1;
        if (cfStep.baselineFloorBreached) {
          console.warn(`[GEN1-CF] ${etf.code} 反事实目标 ${cfStep.counterfactualTarget}`
            + ` 低于 baseline ${baselineTarget}（共享 tech cap 优先，组合约束所致，非模型降级）`);
        }
        // G1-11 No-op 不变量：overlay 前后 final_target / final_action 必须逐字段一致
        const noopBefore = { final_target: result.final_target, final_action: result.final_action };
        Object.assign(result, applyGen1Overlay(result, gen1Permission, canary));
        const noopCheck = verifyProductionNoop(noopBefore, result);
        if (!noopCheck.ok) {
          throw new Error(`Gen-1 overlay violated production No-op: ${noopCheck.diffs.join(', ')}`);
        }

        await db.upsert(COLLECTIONS.DECISION_RESULT, result, { code: etf.code, decision_date: result.decision_date });

        // 回写 fundamental_state（每次重算都 upsert，保证后台基本面录入即时生效）
        await db.upsert(COLLECTIONS.FUNDAMENTAL_STATE, {
          code: etf.code, f_state: p.fundamental.f_state, f_score: p.fundamental.f_score,
          detail: p.fundamental.detail || {}, updated_at: new Date()
        }, { code: etf.code });

        // 回写 portfolio_position：核心/交易仓 + 慢变量状态
        // 拆分 suggested（决策建议）与 actual（实际持仓，由成交回写维护）：
        // - suggested_core/suggested_trade = 决策输出（本次建议的目标拆分，仅作展示）
        // - core_position/trade_position = 实际核心/交易仓（成交回写），决策不覆盖，仅初始化兜底
        const actualCore = p.position.core_position != null ? p.position.core_position
          : Math.min(result.core_position != null ? result.core_position : 0, p.position.current_position || 0);
        const actualTrade = p.position.trade_position != null ? p.position.trade_position
          : Math.max(0, (p.position.current_position || 0) - actualCore);
        await db.upsert(COLLECTIONS.PORTFOLIO_POSITION, {
          code: etf.code,
          core_position: actualCore,
          trade_position: actualTrade,
          suggested_core: result.core_position,
          suggested_trade: result.trade_position,
          core_ratio_grade: p.coreResolved.core_ratio_grade,
          pending_grade: p.coreResolved.pending_grade,
          pending_since: p.coreResolved.pending_since,
          core_ratio_changed_at: p.coreResolved.core_ratio_changed_at,
          trade_ratio_grade: p.coreResolved.trade_ratio_grade,
          trade_pending_grade: p.coreResolved.trade_pending_grade,
          trade_pending_since: p.coreResolved.trade_pending_since,
          trade_changed_at: p.coreResolved.trade_changed_at,
          trend_stage_state: p.position.trend_stage_state || null,
          shock_state: p.position.shock_state || null,
          slow_break_history: p.position.slow_break_history || [],
          updated_at: new Date()
        }, { code: etf.code });

        if (runV3Path && result.shadow_targets) {
          shadowItems.push({
            code: etf.code,
            decision: result,
            w_state: p.snapshot.w_state
          });
        }

        results.push({
          code: etf.code, ok: true, action: result.final_action,
          opportunity_score: result.opportunity_score,
          opportunity_grade: result.opportunity_grade,
          final_target: result.final_target,
          suggested_position: result.suggested_position,
          position_gap: result.position_gap
        });
      } catch (e) {
        results.push({ code: p.etf.code, ok: false, error: String(e.message || e) });
      }
    }

    // ---- WP-G1.3 G1.3-06/11：反事实组合账本终局断言 ----
    // 两个并行账本：productionSectorUsed（生产）vs canarySectorUsed（完整组合反事实）。
    // ★ 本账本是 **execution / intended ledger**：占用按**建议执行仓**计
    //   （occupation = max(0, min(suggested, target) - current)，与生产完全一致），
    //   因此被约束的是「建议执行到的仓位」，**不是** Σ final_target（后者可远超 cap，
    //   例：4 只各 current 10 / target 30 / suggested 15 → 账本 60 ≤ 65 而 Σ target = 105）。
    // 精确不变量：
    //   ① counterfactual_intended_tech_position <= max(起始科技仓位, cap)  —— 绝不制造**新的**超额；
    //   ② 起始仓位 <= cap（正常情况）→ <= cap（复审要求的断言）。
    // 违反即为实现缺陷：如实上报并 fail-closed（不把本轮反事实标为 active），绝不静默吞掉。
    const productionTechPosition = Math.round(sectorUsed * 1e6) / 1e6;
    const counterfactualTechPosition = Math.round(canarySectorUsed * 1e6) / 1e6;
    const techPositionSeed = portfolio.tech_position != null ? portfolio.tech_position : 0;
    const counterfactualLedgerOk = counterfactualTechPosition
      <= Math.max(techPositionSeed, effectiveTechMax) + 1e-9;
    if (!counterfactualLedgerOk) {
      console.error(`[SECURITY] GEN1_COUNTERFACTUAL_LEDGER_OVERFLOW:`
        + ` counterfactual_tech_position=${counterfactualTechPosition}`
        + ` > max(seed=${techPositionSeed}, cap=${effectiveTechMax})`);
    }
    // G1.3-07：对外状态字段（替代旧 canary_enabled 硬编码）
    const cfAuthorized = authorityAllows(gen1Authority.gen1_authority, 'CANARY_OVERRIDE');
    const cfHealthAllowed = gen1GlobalGate.allow_canary === true;
    const cfActive = cfAuthorized && cfHealthAllowed && counterfactualLedgerOk;

    // 写组合快照：snapshot_date 统一用「今天」（北京时间，组合快照时刻），
    // 与 decision_result.decision_date（数据最新日）语义分离，避免快照日期分裂。
    // total_asset = 持股市值 + 现金（现金粘在元上，不随行情改）
    const snapshotDate = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    const recentSnaps = await db.query(COLLECTIONS.PORTFOLIO_SNAPSHOT, {}, {
      orderBy: [{ field: 'snapshot_date', direction: 'desc' }], limit: 30
    });
    const lastWithAsset = recentSnaps.find((s) => s.total_asset != null);
    const lastWithCash = recentSnaps.find((s) => s.cash_balance != null && !Number.isNaN(Number(s.cash_balance)));

    // 自动浮盈（2026-08-22）：TRADE_LOG 平均成本法 → 最新价市值 → 浮盈（优先于用户录入）
    const autoPnl = await computeAutoPnl(etfs);
    const userPnl = lastWithAsset && lastWithAsset.total_pnl != null ? lastWithAsset.total_pnl : null;
    const resolvedPnl = autoPnl.total_pnl != null ? autoPnl.total_pnl : userPnl;
    const seedSnap = lastWithCash || lastWithAsset;
    const cashYuan = seedSnap
      ? resolveCashYuan({
        cashBalance: lastWithCash ? lastWithCash.cash_balance : seedSnap.cash_balance,
        seedTotalAsset: lastWithAsset && lastWithAsset.total_asset != null ? lastWithAsset.total_asset : seedSnap.total_asset,
        lastHoldingsMv: snapshotHoldingsMv(seedSnap),
        currentHoldingsMv: autoPnl.total_value,
        cashDelta: 0
      })
      : null;
    const liveAsset = liveTotalAsset(autoPnl.total_value, cashYuan);
    const resolvedAsset = liveAsset != null ? liveAsset
      : (lastWithAsset && lastWithAsset.total_asset != null ? lastWithAsset.total_asset : null);

    // R3-5：决策后的「建议执行仓位」（intended_*）——按各 ETF 建议仓（suggested_position，退 final_target）
    // 与当前仓位并列，供多信号日额度占用的可解释性（grok P1-5）
    // 注意：sector 在 etf_basic 不在 portfolio_position，需从 etfs 构建映射
    const sectorMap = {};
    etfs.forEach((e) => { sectorMap[e.code] = e.sector || ''; });
    const intendedPositions = positions.map((p) => {
      const r = results.find((x) => x.code === p.code && x.ok);
      const suggested = r && r.suggested_position != null ? r.suggested_position
        : (r && r.final_target != null ? r.final_target : (p.current_position || 0));
      return { ...p, sector: sectorMap[p.code] || '', suggested_position: Math.round(suggested * 10) / 10 };
    });
    const intendedTech = intendedPositions.reduce((s, p) => {
      return TECH_SECTORS.indexOf(p.sector || '') >= 0 ? s + (p.suggested_position || 0) : s;
    }, 0);
    const intendedSemi = intendedPositions.reduce((s, p) => {
      return SEMI_SECTORS.indexOf(p.sector || '') >= 0 ? s + (p.suggested_position || 0) : s;
    }, 0);

    // 快照仓位字段用「更新后的最新 positions」重算：
    // 引擎先在各 ETF 循环内更新 portfolio_position，再写快照；而 portfolio 是运行开始时按旧 positions 计算的，
    // 直接写会与用户最新登记的当前仓位不一致（如科技仓位只算到部分 ETF）。重新读取后汇总，保证快照=实时仓位。
    const freshPositions = await db.query(COLLECTIONS.PORTFOLIO_POSITION, {});
    const freshPortfolio = await getPortfolioSummary(etfs, freshPositions, marketRegime, globalSignals);

    await db.upsert(COLLECTIONS.PORTFOLIO_SNAPSHOT, {
      snapshot_date: snapshotDate,
      total_asset: resolvedAsset,
      cash_balance: cashYuan != null ? cashYuan : (seedSnap && seedSnap.cash_balance != null ? seedSnap.cash_balance : null),
      holdings_mv: autoPnl.total_value != null ? autoPnl.total_value : (seedSnap && seedSnap.holdings_mv != null ? seedSnap.holdings_mv : null),
      asset_source: liveAsset != null ? 'live' : (resolvedAsset != null ? 'manual' : null),
      total_pnl: resolvedPnl,
      auto_pnl: autoPnl.total_pnl != null ? autoPnl.total_pnl : null, // 自动计算值（用户可对比）
      tech_position: freshPortfolio.tech_position,
      semi_position: freshPortfolio.semi_position,
      gold_position: freshPortfolio.gold_position,
      drug_position: freshPortfolio.drug_position,
      cash_ratio: freshPortfolio.cash_ratio,
      strategic_cash: freshPortfolio.strategic_cash,
      deployable_cash: freshPortfolio.deployable_cash,
      market_regime: freshPortfolio.market_regime,
      market_score: v3MarketEnv ? v3MarketEnv.market_score : (freshPortfolio.market_score || null),
      portfolio_breadth_proxy: v3MarketEnv ? v3MarketEnv.portfolio_breadth_proxy : null,
      v3_breadth_source: v3MarketEnv ? v3MarketEnv.breadth_source : null,
      trend_stage_enabled: trendStageEnabled,
      v3_shadow_enabled: shadowEnabled,
      v3_6_1_enabled: merged.v3_6_1_enabled === true,
      v3_6_1_shadow: merged.v3_6_1_shadow === true,
      production_engine: trendStageEnabled ? shadowEngineVer : 'v3.8',
      shadow_engine: runV3Path ? (trendStageEnabled ? 'v3.8' : shadowEngineVer) : null,
      config_version: merged.config_version || null,
      ml_shadow_observe: merged.ml_shadow_observe === true,
      ml_fast_path_enabled: false,
      ml_challenger_model_id: merged.ml_challenger_model_id || 'HVT-A-ET-20260830',
      intended_tech_position: Math.round(intendedTech * 10) / 10,
      intended_semi_position: Math.round(intendedSemi * 10) / 10,
      positions: intendedPositions.map((p) => {
        const pnlInfo = autoPnl.perEtf[p.code] || {};
        return {
          code: p.code,
          position: p.current_position || 0,
          suggested_position: p.suggested_position,
          value: pnlInfo.value != null ? pnlInfo.value : null,
          shares: pnlInfo.shares != null ? pnlInfo.shares : null,
          avg_cost: pnlInfo.avg_cost != null ? pnlInfo.avg_cost : null,
          pnl: pnlInfo.pnl != null ? pnlInfo.pnl : null,
          core: p.core_position != null ? p.core_position : null,
          trade: p.trade_position != null ? p.trade_position : null
        };
      })
    }, { snapshot_date: snapshotDate });

    let shadowLog = null;
    if (shadowEnabled && shadowItems.length) {
      shadowLog = buildShadowDailyEntry({
        snapDate: latestDate || snapshotDate,
        trendStageEnabled,
        shadowEnabled,
        items: shadowItems,
        meta: {
          v3_6_1_enabled: merged.v3_6_1_enabled === true,
          v3_6_1_shadow: merged.v3_6_1_shadow === true,
          // 三个版本概念严格区分（杜绝 shadow log 各说一套）：
          //   production_engine = 生产引擎；shadow_engine = 影子引擎；decision_engine = V3 决策引擎
          production_engine: trendStageEnabled ? shadowEngineVer : 'v3.8',
          shadow_engine: runV3Path ? (trendStageEnabled ? 'v3.8' : shadowEngineVer) : null,
          decision_engine: shadowEngineVer,
          config_version: merged.config_version || null,
          stage_engine: merged.v3_6_persistence ? 'v3.6' : (merged.v3_5_enabled ? 'v3.5' : 'v3'),
          s5_downside: merged.v3_6_1_s5_downside === true,
          post_s5_recovery: merged.v3_6_2_post_s5_s4_grace === true
            || merged.v3_6_3_adaptive_post_s5_grace === true
        }
      });
      await db.upsert(COLLECTIONS.SHADOW_V3_LOG, shadowLog, { snap_date: shadowLog.snap_date });
    }

    // V4.0 ML Gen-1：仅观察元数据。Fast Path 硬关，不得改 final_target。
    const mlShadowObserve = merged.ml_shadow_observe === true;
    const mlFastPathEnabled = merged.ml_fast_path_enabled === true;
    const mlModelId = merged.ml_challenger_model_id || 'HVT-A-ET-20260830';
    const productionEngine = trendStageEnabled ? shadowEngineVer : 'v3.8';
    const shadowEngine = runV3Path ? (trendStageEnabled ? 'v3.8' : shadowEngineVer) : null;
    const mlMeta = {
      enabled: mlShadowObserve,          // Shadow 观察开
      effective: false,                  // 明确：无生产写权限（即使误开 fast_path）
      observe: mlShadowObserve,
      fast_path_enabled: false,          // 强制 OFF
      model_id: mlModelId,
      bundle_id: merged.ml_shadow_bundle_id || 'shadow-bundle-v1',
      gen1_frozen: merged.ml_gen1_frozen !== false,
      engine_version: productionEngine,  // 与生产引擎同源，不再硬编码
      // WP-G1：权限状态机 + Safety Core 许可来源 + Canary 通路状态（默认 path ready / off）
      gen1_authority: gen1Authority.gen1_authority,
      gen1_authority_label: gen1Authority.label,
      permission_source: 'SAFETY_CORE',
      production_write: false,
      auto_execution: false,
      // G1.3-07：不再用含混的 canary_enabled / fast_path_enabled 表达反事实通路，拆成四个显式字段
      counterfactual_canary_authorized: cfAuthorized,
      counterfactual_canary_health_allowed: cfHealthAllowed,
      counterfactual_canary_active: cfActive,
      counterfactual_canary_invocations: canaryInvocationCount,
      production_fast_path_enabled: false,
      canary_path_ready: true,        // 代码层能力就绪（与权限状态解耦）
    // G1.3-06：两条并行账本终局（cap 约束下的组合反事实）
    // G1.3-11：命名精确化 —— `intended` 才是准确名称（账本按**建议执行仓**占用，
    //   不是 Σ final_target）。旧名 gen1_counterfactual_tech_position 保留为等价别名（向后兼容）。
    gen1_production_tech_position: productionTechPosition,
    gen1_counterfactual_intended_tech_position: counterfactualTechPosition,
    gen1_counterfactual_tech_position: counterfactualTechPosition,
    gen1_counterfactual_tech_seed: techPositionSeed,
    gen1_counterfactual_tech_cap: effectiveTechMax,
    gen1_counterfactual_ledger_ok: counterfactualLedgerOk,
    // 信息性：Σ 反事实战略目标（**不受 cap 约束**，不得用作 cap 合规证据）
    gen1_counterfactual_target_sum: Math.round(counterfactualTargetSum * 1e6) / 1e6,
      note: mlFastPathEnabled
        ? 'ml_fast_path_enabled ignored while Gen-1 in SHADOW; production stays V3.6.1'
        : 'ML observing only — no authority to change production decisions'
    };

    // 运行状态单一真相：前后端 / shadow log 统一读这个对象，禁止再凭 VERSION.txt / 硬编码各说一套。
    const runtimeStatus = {
      key: 'runtime-status',
      production_engine: productionEngine,
      shadow_engine: shadowEngine,
      decision_engine: shadowEngineVer,
      stage_engine: merged.v3_6_persistence ? 'v3.6' : (merged.v3_5_enabled ? 'v3.5' : 'v3'),
      ml_model_id: mlModelId,
      ml_effective: false,
      ml_advisory_enabled: merged.ml_advisory_enabled !== false,
      // G1-09：自动执行永久硬关 —— 即使数据库 ml_execution_enabled=true 亦不得开启
      ml_execution_enabled: gen1Execution.execution_enabled,
      gen1_execution_label: gen1Execution.label,
      gen1_broker_wired: gen1Execution.broker_wired,
      gen1_execution_audit: gen1Execution.audit || null,
      // G1-01：Gen-1 权限状态机（单一真相；production_write / auto_execution 恒 false）
      gen1_authority: gen1Authority.gen1_authority,
      gen1_authority_label: gen1Authority.label,
      gen1_production_write: false,
      gen1_auto_execution: false,
      gen1_safety_source: 'SAFETY_CORE',
      // G1-07 / WP-G1.2 G1.2-01/02：运行时健康状态 + 熔断门（唯一真相 = 持久化 latch）
      gen1_health_status: gen1GlobalHealth,
      gen1_health_label: gen1GlobalGate.label,
      gen1_health_source: gen1GlobalGate.source || 'GEN1_HEALTH_STATE_LATCH',
      gen1_health_gate_status: gen1GlobalGate.gate_status || 'ACTIVE',
      gen1_health_read_reason_code: gen1GlobalGate.read_reason_code || null,
      gen1_health_manual_review_required: gen1GlobalGate.manual_review_required === true,
      gen1_health_economic_status: gen1GlobalGate.economic_health || 'PENDING',
      gen1_allow_advisory: gen1GlobalGate.allow_advisory,
      gen1_allow_canary: gen1GlobalGate.allow_canary,
      // G1.3-06/07：反事实通路状态（拆成显式字段，替代含混的 canary_enabled）
      gen1_counterfactual_canary_authorized: cfAuthorized,
      gen1_counterfactual_canary_health_allowed: cfHealthAllowed,
      gen1_counterfactual_canary_active: cfActive,
      gen1_counterfactual_canary_invocations: canaryInvocationCount,
      gen1_production_fast_path_enabled: false,
      // G1.3-06/11：两条并行账本终局 —— intended 为精确名称（账本按建议执行仓占用）
      gen1_production_tech_position: productionTechPosition,
      gen1_counterfactual_intended_tech_position: counterfactualTechPosition,
      gen1_counterfactual_tech_position: counterfactualTechPosition,
      gen1_counterfactual_tech_seed: techPositionSeed,
      gen1_counterfactual_tech_cap: effectiveTechMax,
      gen1_counterfactual_ledger_ok: counterfactualLedgerOk,
      gen1_counterfactual_target_sum: Math.round(counterfactualTargetSum * 1e6) / 1e6,
      ml_gen1_frozen: merged.ml_gen1_frozen !== false,
      ml_shadow_observe: mlShadowObserve,
      trend_stage_enabled: trendStageEnabled,
      v3_6_1_enabled: merged.v3_6_1_enabled === true,
      v3_6_1_shadow: merged.v3_6_1_shadow === true,
      v3_shadow_enabled: shadowEnabled,
      config_version: merged.config_version || null,
      decision_date: snapshotDate,
      updated_at: new Date().toISOString()
    };
    await db.upsert(COLLECTIONS.RUNTIME_STATUS, runtimeStatus, { key: 'runtime-status' });

    return {
      ok: true,
      version,
      decision_date: snapshotDate,
      duration_ms: Date.now() - startedAt,
      production_engine: productionEngine,
      shadow_engine: shadowEngine,
      config_version: merged.config_version || null,
      v3_6_1_enabled: merged.v3_6_1_enabled === true,
      v3_6_1_shadow: merged.v3_6_1_shadow === true,
      ml_shadow: mlMeta,
      ml_effective: false, // 顶层冗余语义：生产决策不受 ML 影响
      results,
      shadow_log: shadowLog ? {
        snap_date: shadowLog.snap_date,
        diverge_count: shadowLog.diverge_count,
        aggressive_divergence_count: shadowLog.aggressive_divergence_count,
        summary: summarizeEntry(shadowLog)
      } : null
    };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
};
