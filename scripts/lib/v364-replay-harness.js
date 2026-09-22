#!/usr/bin/env node
/**
 * V3.6.4 Safety Hardening —— 生产链重放 harness（Gate A / Gate B 共用）
 *
 * 目的：在**不改动任何生产写入**的前提下，用真实历史 OHLCV 逐日重放 V3.6.1 决策链，
 * 从而对 OLD / NEW 两种语义做同源对照。
 *
 * 真实 vs 重推导（保真度声明，必须如实告知读者）：
 *   ✅ 真实：5 只生产 ETF 与 3 个宽基指数代理的**日线 OHLCV**（`deliverables/etf_daily_ml_pool/*.csv`）
 *   ✅ 真实：线上 `etf_basic` 的 sector / target_position / max_position（只读核实 2026-09-22）
 *   ✅ 真实：线上 `param_config` 的全部开关与阈值（只读核实 2026-09-22）
 *   🔁 重推导：`indicator_snapshot`（由真实 OHLCV 经 `indicators.computeSnapshot` 算出，
 *              这正是生产 `materializeIndicators` 的同一函数）
 *   🔁 重推导：`trend_stage_state` / `shock_state` / `slow_break_history`（按生产调用序列滚动）
 *   ⚠️ 常量化：`fundamental` 固定 F3/15（生产从 DB 读；常量化后 OLD/NEW 差异不受其干扰）
 *   ⚠️ 起点：账面从 0 开始自洽滚动（不注入真实持仓，避免把个人资金数据写进仓库）
 *
 * ⚠️ 本 harness **只读**：不联网、不写库、不部署、不改任何生产参数。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const U = (f) => require(path.join(REPO, 'src/common/utils', f));

const indicators = U('indicators.js');
const decisionV3 = U('decision-v3.js')();
const { applyV361ParamBundle, appendSlowBreakHistory, buildV3Portfolio } = U('v3-shadow.js');
const { resolveMarketEnvironment } = U('market-regime.js');
const { swingHighLow } = U('swing-structure.js');
const { planRunInput, finalizeState } = U('trade-date-idempotence.js');
const { sectorOccupation } = U('gen1-canary.js');
const constants = require(path.join(REPO, 'src/common/constants.js'));
const { DEFAULT_PARAMS, TECH_SECTORS, SEMI_SECTORS } = constants;

const CSV_DIR = path.join(REPO, 'deliverables/etf_daily_ml_pool');

/** 线上 etf_basic（只读核实 2026-09-22）：sector / target_position / max_position */
const UNIVERSE = [
  { code: '518880', name: '黄金ETF', sector: 'gold', target_position: 30, max_position: 30 },
  { code: '159570', name: '港股通创新药ETF', sector: 'biotech', target_position: 10, max_position: 20 },
  { code: '513310', name: '中韩半导体ETF(QDII)', sector: 'storage', target_position: 25, max_position: 30 },
  { code: '515880', name: '通信ETF', sector: 'ai_network', target_position: 20, max_position: 30 },
  { code: '159582', name: '半导体设备ETF', sector: 'semi_equip', target_position: 20, max_position: 30 }
];

/** 宽基指数代理（真实 CSV） */
const INDEX_PROXIES = [
  { code: '510300', index: '000300' },
  { code: '588000', index: '000688' },
  { code: '159915', index: '399006' }
];

/** 线上 param_config 只读核实值（2026-09-22）；仅 premium_etf_extreme 与 DEFAULT_PARAMS 不同 */
const LIVE_PARAM_OVERRIDES = Object.freeze({
  premium_etf_extreme: 2.5,      // 线上 2.5（DEFAULT_PARAMS 为 2）
  sideway_days_min: 8,
  volume_ratio_mild: 0.95,
  volume_ratio_high: 1.15,
  volume_ratio_extreme: 1.5,
  single_etf_max: 30,
  tech_sector_max: 65,
  sideway_days: 15,
  volume_ratio: 0.7,
  ma20_slope: 0,
  bias_20d_hot: 15,
  bias_20d_crowd: 25,
  trend_stage_enabled: true,
  v3_shadow_enabled: true,
  v3_breadth_source: 'index',
  v3_2_math_enabled: true,
  v3_2_math_auto_track: true,
  v3_6_1_enabled: true,
  v3_6_1_shadow: false,
  v3_5_enabled: true,
  v3_5_mode: 'd',
  v3_6_persistence: true,
  v3_6_1_s5_downside: true,
  v3_6_2_post_s5_s4_grace: false,
  v3_6_3_adaptive_post_s5_grace: false
});

const PROD_PARAMS = applyV361ParamBundle({ ...DEFAULT_PARAMS, ...LIVE_PARAM_OVERRIDES });
const SNAPSHOT_PARAMS = { ...DEFAULT_PARAMS, ...LIVE_PARAM_OVERRIDES };

const FUNDAMENTAL_CONST = { f_state: 'F3', f_score: 15, detail: {} };
const RISK_CONST = { risk_flag: 'NORMAL', risk_override: false, events: [] };

/* ------------------------------------------------------------------ */
/* 生产保真：线上 indicator_snapshot 文档的真实字段集合                  */
/* ------------------------------------------------------------------ */
/**
 * 来源：2026-09-22 只读投影探测线上 `indicator_snapshot`（code=513310, calc_date=2026-09-21，
 * version=4）得到该文档**实际存在的全部键**。
 *
 * ⚠️ 实测发现（登记为 FINDING，不在本轮修复）：
 *   - `ma60_slope` / `high_point_falling` / `lower_high` **不存在**于线上快照文档；
 *     且全仓 `ma60_slope` 只有 `defense.js` 一处**读取**，**没有任何产生处**。
 *     ⇒ `defense.calcSlowBreakScore()` 的 4 项输入实际只有 2 项可得
 *       (`ma20_slope<0` 与 `d_state==='D5' || h_state∈{H4,H5}`) ⇒ **分数上限恒为 50**
 *     ⇒ `isSlowBreakHigh()` 需要的 `SB>=75` **在生产上不可达**。
 *   - `breakout_nd` 也**不存在**于线上文档（仓库 `computeSnapshot` 会产出它）
 *     ⇒ 线上 `detectPrimaryStageRaw` 的 S4「breakout_nd」分支不可达。
 *   为了「重放的是**生产**行为」而不是「仓库分支行为」，此处按线上字段集合裁剪快照。
 */
const LIVE_SNAPSHOT_FIELDS = new Set([
  'atr20', 'bias_20d', 'breakout', 'calc_date', 'change_5d', 'code', 'consolidation_score',
  'd_state', 'data_complete', 'h_state', 'high_volume_decline', 'high_volume_stagnation',
  'ma10', 'ma120', 'ma20', 'ma20_slope', 'ma250', 'ma5', 'ma60', 'premium_rate',
  'price_position', 'sideway_days', 'sideway_range', 'stage_summary', 'trend_context',
  'v_state', 'version', 'vol20', 'volume_ratio', 'volume_slope', 'w_state'
]);

/** 按线上字段集合裁剪重推导快照；返回被丢弃的键（供诊断） */
function shapeSnapshotForProduction(snap) {
  const out = {};
  const dropped = [];
  Object.keys(snap || {}).forEach((k) => {
    if (LIVE_SNAPSHOT_FIELDS.has(k)) out[k] = snap[k];
    else dropped.push(k);
  });
  return { snapshot: out, dropped };
}

/* ------------------------------------------------------------------ */
/* 数据载入                                                            */
/* ------------------------------------------------------------------ */

function loadCsv(code) {
  const file = path.join(CSV_DIR, `${code}_qfq.csv`);
  if (!fs.existsSync(file)) return null;
  const rows = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).map((line) => {
    const p = line.split(',');
    return {
      trade_date: p[0],
      open: Number(p[1]),
      high: Number(p[2]),
      low: Number(p[3]),
      close: Number(p[4]),
      volume: Number(p[5]),
      amount: p[6] != null && p[6] !== '' ? Number(p[6]) : null
    };
  }).filter((b) => b.trade_date && Number.isFinite(b.close) && Number.isFinite(b.high) && Number.isFinite(b.low));
  return rows;
}

function loadBars() {
  const barsByCode = {};
  const missing = [];
  UNIVERSE.forEach((u) => {
    const b = loadCsv(u.code);
    if (!b || b.length < 80) missing.push(u.code);
    barsByCode[u.code] = b || [];
  });
  const indexBars = {};
  INDEX_PROXIES.forEach((p) => { indexBars[p.code] = loadCsv(p.code) || []; });
  if (missing.length) {
    const err = new Error(`缺少足够历史数据：${missing.join(', ')}`);
    err.code = 'DATA_MISSING';
    throw err;
  }
  return { barsByCode, indexBars };
}

/** 五票共同交易日轴（按 ETF 交集），可选区间裁剪 */
function commonAxis(barsByCode, opts) {
  let acc = null;
  UNIVERSE.forEach((u) => {
    const s = new Set(barsByCode[u.code].map((b) => b.trade_date));
    acc = acc == null ? s : new Set([...acc].filter((d) => s.has(d)));
  });
  let arr = [...acc].sort();
  if (opts && opts.from) arr = arr.filter((d) => d >= opts.from);
  if (opts && opts.to) arr = arr.filter((d) => d <= opts.to);
  return arr;
}

/* ------------------------------------------------------------------ */
/* 单日上下文                                                          */
/* ------------------------------------------------------------------ */

function regimeFor(indexBars, d) {
  const indexWStates = INDEX_PROXIES.map((p) => {
    const bars = indexBars[p.code].filter((b) => b.trade_date <= d);
    if (bars.length < 40) return null;
    const weekly = indicators.buildWeekly(bars);
    if (!weekly || weekly.length < 10) return null;
    return indicators.detectWState(weekly, {}).state;
  }).filter(Boolean);
  if (indexWStates.length < 3) {
    return { market_regime: 'range', market_factor: null, indexWStates };
  }
  const env = resolveMarketEnvironment({ indexWStates, etfWStates: [] });
  return { market_regime: env.market_regime, market_factor: env.market_factor, indexWStates };
}

function buildPortfolio(book, regime) {
  let tech = 0;
  let semi = 0;
  let gold = 0;
  let drug = 0;
  let total = 0;
  UNIVERSE.forEach((u) => {
    const p = book[u.code] || 0;
    total += p;
    if (TECH_SECTORS.indexOf(u.sector) >= 0) tech += p;
    if (SEMI_SECTORS.indexOf(u.sector) >= 0) semi += p;
    if (u.sector === 'gold') gold += p;
    if (u.sector === 'biotech') drug += p;
  });
  const cashRatio = Math.max(0, 100 - total);
  return {
    tech_position: tech,
    semi_position: semi,
    gold_position: gold,
    drug_position: drug,
    cash_ratio: cashRatio,
    cash_ratio_raw: Math.round((100 - total) * 10) / 10,
    leverage_excess: total > 100 ? Math.round((total - 100) * 10) / 10 : 0,
    overbooked: total > 100,
    market_regime: regime.market_regime,
    market_factor: regime.market_factor,
    total_position: total,
    global_signals: []
  };
}

/**
 * 单次「一天」的运行（可 1 次或 N 次）。
 * @returns {{ outputs:Array, state:Object, book:Object, sectorUsedTrace:Array }}
 */
function runOneDay(ctx) {
  const {
    d, barsByCode, indexBars, book, state, shockState, slowBreak,
    runsPerDay, slowBreakMode
  } = ctx;

  const regime = regimeFor(indexBars, d);
  const portfolio = buildPortfolio(book, regime);
  const v3Portfolio = buildV3Portfolio(portfolio, null); // v3MarketEnv 由 portfolio 提供
  const effTechMax = PROD_PARAMS.tech_sector_max != null ? PROD_PARAMS.tech_sector_max : 65;
  let sectorUsed = portfolio.tech_position;
  const nextBook = { ...book };
  let nextSlow = { ...slowBreak };
  let nextState = { ...state };
  let nextShock = { ...shockState };

  const order = UNIVERSE.slice();
  const outputs = [];       // 每次运行（run index）的逐票结果
  const sectorTrace = [];

  for (let run = 0; run < runsPerDay; run += 1) {
    const runOut = { run_index: run, byCode: {} };
    sectorUsed = portfolio.tech_position;   // 每次运行都从当日起点额度开始（同日重跑语义）

    for (const u of order) {
      const bars = barsByCode[u.code].filter((b) => b.trade_date <= d);
      const rawSnapshot = indicators.computeSnapshot(bars, SNAPSHOT_PARAMS, { code: u.code, calc_date: d });
      // 生产保真：按线上 indicator_snapshot 实际字段集合裁剪（见 LIVE_SNAPSHOT_FIELDS 注释）
      const snapshot = shapeSnapshotForProduction(rawSnapshot).snapshot;
      const positions = {
        code: u.code,
        current_position: nextBook[u.code] || 0,
        target_std: u.target_position,
        target_max: u.max_position,
        max_position: u.max_position,
        max_strategic_position: u.max_position
      };
      const etf = { code: u.code, name: u.name, sector: u.sector, target_position: u.target_position, max_position: u.max_position };

      // V3.6.1 R1：按交易日幂等（与 runDecisionEngine 接线同构）
      const plan = planRunInput(nextState[u.code] || {}, d);
      const engineState = plan.engine_state;

      const isTech = TECH_SECTORS.indexOf(u.sector) >= 0;
      const sectorRemainingLimit = isTech ? Math.max(0, effTechMax - sectorUsed) : null;

      const res = decisionV3.runDecision(etf, snapshot, positions, PROD_PARAMS, {
        fundamental: FUNDAMENTAL_CONST,
        risk: RISK_CONST,
        portfolio: v3Portfolio,
        cooldownDays: 0,
        sectorRemainingLimit,
        trendStageState: engineState,
        shockState: nextShock[u.code] || null,
        recentSlowBreakScores: nextSlow[u.code] || [],
        riskEvents: [],
        bars
      });

      // SlowBreak 历史滚动：OLD = lowerLow 恒 false（历史生产语义）；NEW = 真实 swing
      const swing = bars.length >= 12 ? swingHighLow(bars) : null;
      const swingForHistory = slowBreakMode === 'old'
        ? (swing ? { lowerHigh: swing.lowerHigh, lowerLow: false } : null)
        : swing;
      nextSlow[u.code] = appendSlowBreakHistory(nextSlow[u.code] || [], res.slow_break_score, swingForHistory);

      // 状态落库（锚点随行）
      nextState[u.code] = finalizeState(res.trend_stage_state, d, plan);
      nextShock[u.code] = res.shock_state;

      runOut.byCode[u.code] = {
        trend_stage_primary: res.trend_stage_primary,
        trend_stage_display: res.trend_stage,
        trend_stage_overlay: res.trend_stage_overlay,
        pendingStage: (res.trend_stage_state && res.trend_stage_state.pendingStage) || null,
        pendingDays: (res.trend_stage_state && res.trend_stage_state.pendingDays) || 0,
        days_in_stage: (res.trend_stage_state && res.trend_stage_state.days_in_stage) || 0,
        soft_down_days: (res.trend_stage_state && res.trend_stage_state.soft_down_days) || 0,
        s5_risk_days: (res.trend_stage_state && res.trend_stage_state.s5_risk_days) || 0,
        breakout_level: (res.trend_stage_state && res.trend_stage_state.breakout_level) || null,
        slow_break_score: res.slow_break_score,
        slow_break_high: res.slow_break_high === true,
        // 原始 swing（两变体一致）+ SlowBreak 三项条件 —— 供 Gate A 判定「是否接近触发」
        swing_lower_high: swing ? swing.lowerHigh === true : null,
        swing_lower_low: swing ? swing.lowerLow === true : null,
        // OLD 语义下历史里写入的 lowerLow（用于反证缺陷）
        history_lower_low_old_semantics: slowBreakMode === 'old' ? false : (swing ? swing.lowerLow === true : null),
        defense_score: res.defense_score,
        defense_penalty: res.defense_penalty,
        final_target: res.final_target,
        final_action: res.final_action,
        suggested_position: res.suggested_position,
        binding_constraint: res.binding_constraint,
        engine_path: res.engine_path,
        opportunity_grade: res.opportunity_grade,
        w_state: res.w_state
      };

      // 赛道额度：每次运行都在**本运行内**按科技票处理顺序累加（run 开始处已重置为当日起点）
      if (isTech) {
        const cur = positions.current_position || 0;
        sectorUsed += sectorOccupation(cur, res.suggested_position, res.final_target);
      }

      // 账面推进：只在**最后一次运行**后生效（同日重跑不改仓位 —— 当天没有成交）
      if (run === runsPerDay - 1) {
        nextBook[u.code] = res.suggested_position != null ? res.suggested_position : (nextBook[u.code] || 0);
      }
    }
    outputs.push(runOut);
    sectorTrace.push(sectorUsed);
  }

  return { outputs, state: nextState, book: nextBook, slowBreak: nextSlow, shockState: nextShock, regime };
}

/**
 * 全序列重放。
 * @param {object} opts { from, to, slowBreakMode:'old'|'new', runsPerDay:1|3, collectRuns:boolean }
 */
function replay(opts) {
  const o = opts || {};
  const runsPerDay = o.runsPerDay || 1;
  const slowBreakMode = o.slowBreakMode || 'new';
  const { barsByCode, indexBars } = loadBars();
  const axis = commonAxis(barsByCode, { from: o.from, to: o.to });

  const state = {};
  const shockState = {};
  const slowBreak = {};
  const book = {};
  UNIVERSE.forEach((u) => { book[u.code] = 0; });

  const days = [];
  const runDiffs = [];
  axis.forEach((d) => {
    const r = runOneDay({
      d, barsByCode, indexBars, book, state, shockState, slowBreak,
      runsPerDay, slowBreakMode
    });
    const last = r.outputs[r.outputs.length - 1];
    const first = r.outputs[0];
    // 同日幂等：把第 1 次与第 N 次的逐票结果做差（Gate B 用）
    const intraDayDrift = [];
    if (runsPerDay > 1) {
      UNIVERSE.forEach((u) => {
        const a = first.byCode[u.code];
        const b = last.byCode[u.code];
        Object.keys(a).forEach((k) => {
          if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) {
            intraDayDrift.push({ code: u.code, field: k, first: a[k], last: b[k] });
          }
        });
      });
    }
    runDiffs.push({ trade_date: d, drift_count: intraDayDrift.length, drift: intraDayDrift });

    days.push({
      trade_date: d,
      market_regime: r.regime.market_regime,
      index_w_states: r.regime.indexWStates,
      byCode: last.byCode,
      firstRunByCode: o.collectRuns ? first.byCode : undefined
    });

    Object.keys(r.state).forEach((k) => { state[k] = r.state[k]; });
    Object.keys(r.book).forEach((k) => { book[k] = r.book[k]; });
    Object.keys(r.slowBreak).forEach((k) => { slowBreak[k] = r.slowBreak[k]; });
    Object.keys(r.shockState).forEach((k) => { shockState[k] = r.shockState[k]; });
  });

  return {
    axis,
    days,
    runDiffs,
    // 序列结束时的完整状态（Gate B 用于「RUN_ONCE_STATE === RUN_3X_STATE」比对）
    finalState: state,
    finalBook: book,
    finalSlowBreak: slowBreak,
    meta: {
      slowBreakMode,
      runsPerDay,
      from: axis[0] || null,
      to: axis[axis.length - 1] || null,
      days: axis.length,
      universe: UNIVERSE.map((u) => u.code),
      params_source: 'DEFAULT_PARAMS + param_config 只读核实值（premium_etf_extreme=2.5 为唯一差异项）',
      snapshot_shaping: {
        mode: 'whitelist_live_indicator_snapshot_fields',
        live_field_count: LIVE_SNAPSHOT_FIELDS.size,
        dropped_fields_example: (() => {
          const bars = barsByCode[UNIVERSE[0].code].filter((b) => b.trade_date <= axis[axis.length - 1]);
          const raw = indicators.computeSnapshot(bars, SNAPSHOT_PARAMS, { code: UNIVERSE[0].code, calc_date: axis[axis.length - 1] });
          return shapeSnapshotForProduction(raw).dropped;
        })()
      }
    }
  };
}

/** 前向收益 / 最大回撤（相对触发日收盘） */
function forwardStats(bars, triggerDate, horizons) {
  const idx = bars.findIndex((b) => b.trade_date === triggerDate);
  if (idx < 0) return null;
  const base = bars[idx].close;
  const out = {};
  let maxIdx = bars.length - 1;
  horizons.forEach((h) => {
    const end = Math.min(idx + h, maxIdx);
    if (end <= idx) { out[`ret_${h}d`] = null; out[`mdd_${h}d`] = null; return; }
    const seg = bars.slice(idx + 1, end + 1).map((b) => b.close);
    out[`ret_${h}d`] = Math.round(((bars[end].close - base) / base) * 1000) / 10;
    let peak = base;
    let mdd = 0;
    seg.forEach((c) => {
      if (c > peak) peak = c;
      const dd = ((c - peak) / peak) * 100;
      if (dd < mdd) mdd = dd;
    });
    out[`mdd_${h}d`] = Math.round(mdd * 10) / 10;
  });
  return out;
}

module.exports = {
  REPO,
  UNIVERSE,
  INDEX_PROXIES,
  LIVE_PARAM_OVERRIDES,
  PROD_PARAMS,
  SNAPSHOT_PARAMS,
  FUNDAMENTAL_CONST,
  RISK_CONST,
  LIVE_SNAPSHOT_FIELDS,
  shapeSnapshotForProduction,
  loadBars,
  commonAxis,
  replay,
  forwardStats,
  loadCsv
};
