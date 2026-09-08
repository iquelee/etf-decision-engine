/**
 * 云函数：apiGateway —— 前台只读聚合路由
 * GET /api/dashboard /api/etf/list /api/etf/:code /api/etf/:code/kline
 *     /api/etf/:code/decisions /api/portfolio /api/review
 *     /api/fundamentals /api/intel /api/macro /api/constants
 */

'use strict';

const cloudbase = require('@cloudbase/node-sdk');
const db = require('./common/utils/db');
const { COLLECTIONS, W_STATE_LABELS, D_STATE_LABELS, H_STATE_LABELS, V_STATE_LABELS, F_STATE_LABELS, C_STATE_LABELS, ACTION_LABELS, RISK_FLAG_LABELS, SECTORS, ETF_NAMES, ENGINE_VERSION } = require('./common/constants');
const { bookFromPositions } = require('./common/utils/live-asset');
const { replayAverageCost, unrealizedPnl } = require('./common/utils/pnl');
const { actualHeldPosition } = require('./common/utils/review-position');
const { computeReviewStats } = require('./common/utils/review-stats');
const { computeCooldownDays } = require('./common/utils/cooldown');
const fund = require('./common/utils/fundamental');
const { buildPortfolioMlShadow, buildEtfMlShadow, slimCardMlShadow } = require('./common/utils/ml-shadow');

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });

async function getLatestMlShadowSignal(code) {
  try {
    const rows = await db.query(COLLECTIONS.ML_SHADOW_SIGNAL, { code }, {
      orderBy: [{ field: 'date', direction: 'desc' }],
      limit: 1
    });
    return rows && rows[0] ? rows[0] : null;
  } catch (e) {
    return null;
  }
}

/** 读取某标的最新 Shadow 信号行（EOD 推送；无则 null） */

/** 北京今天（YYYY-MM-DD）：前台展示「当前状态」用，避免用决策快照里的历史冷静期 */
function beijingTodayStr() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 用当前 trade_log 实时重算冷静期，覆盖决策快照里的历史值（冷静期是当前状态，不是历史快照） */
async function attachLiveCooldown(decision) {
  if (!decision || !decision.code) return decision;
  try {
    const cd = await computeCooldownDays(db, decision.code, beijingTodayStr(), {}, '无');
    return { ...decision, cooldown_days: cd };
  } catch (e) {
    return decision;
  }
}

/** 统一响应 */
function ok(data) { return { code: 0, data, message: 'ok' }; }
function fail(message, code = 1) { return { code, data: null, message }; }

/** 展示用动作名：强制按 final_action 映射中文，避免库里残留英文 BUILD */
function resolveActionLabel(finalAction, fallbackLabel) {
  return ACTION_LABELS[finalAction] || fallbackLabel || finalAction || null;
}

/** 决策文档出站前统一改写 action_label（详情/历史接口直接返回决策文档） */
function withChineseActionLabel(decision) {
  if (!decision) return decision;
  return {
    ...decision,
    action_label: resolveActionLabel(decision.final_action, decision.action_label)
  };
}

/**
 * 等待/暂停的主卡点文案（P2 可解释性）。
 * 从 add_eligibility 分项提取未通过项，按「主因 + 次因」生成，替代单一 stage_summary。
 * @param {object} decision decision_result 文档
 * @returns {string|null} 如「周线趋势未过；横盘结构未过」或 null（非等待状态）
 */
function buildWaitReason(decision) {
  if (!decision) return null;
  const ae = decision.add_eligibility;
  const action = decision.final_action;
  if (!ae || !action) return null;
  // 仅对"等待/持有/暂停"类动作展示卡点；减仓/清仓本身是动作不是等待
  if (['BUILD', 'ADD', 'HOLD', 'WAIT'].indexOf(action) < 0) return null;
  const labels = {
    trend: '周线趋势未过',
    structure: '横盘结构未过',
    volume: '量能未缩',
    fund: '基本面转弱',
    chase: '位置偏高',
    limit: '已达上限',
    sector: '赛道超配',
    risk: '风险暂停',
    cooldown: '冷静期内',
    regime: '市场环境防守'
  };
  const blocked = Object.keys(labels).filter((k) => ae[k] === 'pause' || ae[k] === 'forbid');
  if (!blocked.length) return null;
  // 主因 + 次因（最多 2 个）
  return blocked.slice(0, 2).map((k) => labels[k]).join('；');
}

async function computeDashboardPnl(etfs) {
  const raw = await db.query(COLLECTIONS.TRADE_LOG, {}, {
    orderBy: [{ field: 'trade_date', direction: 'asc' }]
  }).catch(() => []);
  const holdings = replayAverageCost(raw || []);
  const prices = {};
  await Promise.all((etfs || []).map(async (e) => {
    const daily = await db.query(COLLECTIONS.ETF_DAILY, { code: e.code }, {
      orderBy: [{ field: 'trade_date', direction: 'desc' }], limit: 1
    }).catch(() => []);
    if (daily.length) prices[e.code] = Number(daily[0].close);
  }));
  return unrealizedPnl(holdings, prices);
}

/** 三问 + 账户总览 + 5 ETF 状态卡 */
async function getDashboard() {
  const etfs = await db.getEtfList();
  const positions = await db.query(COLLECTIONS.PORTFOLIO_POSITION, {});
  // 引擎模式（2026-08-26 进攻引擎接入）：param_config 的 opportunity_factors 是否为 O3 系数
  let engine_mode = 'defense';
  let v3_mode = 'off';
  let paramBag = {};
  try {
    const { params } = await db.getParamConfig();
    paramBag = params || {};
    const of = params && params.opportunity_factors;
    if (of && typeof of === 'object' && of.A && Array.isArray(of.A) && of.A[0] === 1) engine_mode = 'offense';
    const trendOn = params && params.trend_stage_enabled === true;
    const v361Shadow = params && params.v3_6_1_enabled === true && params.v3_6_1_shadow === true;
    const shadowOn = v361Shadow || (!params || params.v3_shadow_enabled !== false);
    if (trendOn) v3_mode = 'cutover';
    else if (v361Shadow) v3_mode = 'v361_shadow';
    else if (shadowOn) v3_mode = 'shadow';
  } catch (e) { /* 读不到不阻断 */ }
  // 组合级 Shadow 状态（顶栏）；标的级信号挂在 cards[].ml_shadow
  const ml_shadow = buildPortfolioMlShadow(paramBag);
  const snapshots = await db.query(COLLECTIONS.PORTFOLIO_SNAPSHOT, {}, {
    orderBy: [{ field: 'snapshot_date', direction: 'desc' }], limit: 1
  });
  const portSnapshot = snapshots[0] || null;  // P2-2：并发拉取所有 ETF 的最新决策（原顺序 await → Promise.all，标的池扩大不线性变慢）
  const decisionsMap = {};
  const mlSignalMap = {};
  await Promise.all(etfs.map(async (etf) => {
    const [dec, sig] = await Promise.all([
      db.getLatestDecision(etf.code),
      getLatestMlShadowSignal(etf.code)
    ]);
    decisionsMap[etf.code] = dec;
    mlSignalMap[etf.code] = sig;
  }));

  const cards = [];
  for (const etf of etfs) {
    const decision = decisionsMap[etf.code];
    const pos = positions.find((p) => p.code === etf.code) || {
      current_position: 0, target_position: etf.target_position || 0, max_position: etf.max_position || 30
    };
    const stage = decision && decision.stage_summary
      ? decision.stage_summary
      : (decision ? `${decision.w_state}·${decision.d_state}·${decision.h_state}` : null);
    // P2 可解释性：等待/暂停的主卡点（从 add_eligibility 分项提取，替代单一 stage 文案）
    const waitReason = buildWaitReason(decision);
    const cardMl = slimCardMlShadow(
      buildEtfMlShadow(paramBag, decision, mlSignalMap[etf.code])
    );
    cards.push({
      code: etf.code,
      name: etf.name,
      sector: etf.sector,
      stage,
      wait_reason: waitReason,
      action: decision ? decision.final_action : null,
      action_label: decision
        ? resolveActionLabel(decision.final_action, decision.action_label)
        : null,
      opportunity_score: decision ? decision.opportunity_score : null,
      opportunity_grade: decision ? decision.opportunity_grade : null,
      risk_flag: decision ? decision.risk_flag : null,
      risk_override: decision ? decision.risk_override === true : false,
      current_position: pos.current_position || 0,
      target_position: decision ? decision.target_position : (pos.target_position || 0),
      target_min: decision ? decision.target_min : (pos.target_min != null ? pos.target_min : null),
      target_std: decision ? decision.target_std : (pos.target_std != null ? pos.target_std : (pos.target_position || 0)),
      target_max: decision ? decision.target_max : (pos.target_max != null ? pos.target_max : (pos.max_position || 0)),
      max_position: decision ? decision.max_position : (pos.max_position || 0),
      final_target: decision ? decision.final_target : null,
      position_gap: decision ? decision.position_gap : null,
      over_alloc_status: decision ? decision.over_alloc_status : null,
      core_position: decision ? decision.core_position : (pos.core_position != null ? pos.core_position : null),
      trade_position: decision ? decision.trade_position : (pos.trade_position != null ? pos.trade_position : null),
      suggest_position: decision ? decision.suggested_position : null,
      data_time: decision ? decision.decision_date : null,
      explain_chain: decision ? decision.explain_chain : null,
      shadow_targets: decision && decision.shadow_targets ? decision.shadow_targets : null,
      trend_stage: decision ? (decision.trend_stage_primary || decision.trend_stage) : null,
      trend_stage_overlay: decision ? decision.trend_stage_overlay : null,
      binding_constraint: decision ? decision.binding_constraint : null,
      engine_version: decision ? decision.engine_version : null,
      shadow_engine_version: decision ? decision.shadow_engine_version : null,
      target_delta: decision && decision.target_delta != null ? decision.target_delta
        : (decision && decision.shadow_targets && decision.shadow_targets.target_delta != null
          ? decision.shadow_targets.target_delta : null),
      aggressive_divergence: decision ? decision.aggressive_divergence === true : false,
      w_state: decision ? decision.w_state : null,
      main_rally_utilization: decision && decision.main_rally_utilization != null
        ? decision.main_rally_utilization : null,
      v3_allowed_max: decision && decision.shadow_targets && decision.shadow_targets.v3_raw != null
        ? decision.shadow_targets.v3_raw
        : (decision && decision.risk_adjusted_target != null ? decision.risk_adjusted_target : null),
      momentum_acceleration: decision ? decision.momentum_acceleration === true : false,
      v3_shadow_gap: decision && decision.shadow_targets && decision.final_target != null && decision.shadow_targets.v3_raw != null
        ? Math.round((decision.shadow_targets.v3_raw - decision.final_target) * 10) / 10
        : null,
      ml_shadow: cardMl
    });
  }

  // 三问：市场状态 / 最值得关注 / 最需防守
  // 动作码统一：decision.final_action 为英文 code（ADD/BUILD/HOLD/TACTICAL_REDUCE/STRATEGIC_REDUCE/EXIT/WAIT），展示走 action_label
  const defensiveActions = ['TACTICAL_REDUCE', 'STRATEGIC_REDUCE', 'EXIT'];
  const offensiveActions = ['ADD', 'BUILD'];
  const hasDefense = cards.some((c) => c.action && defensiveActions.indexOf(c.action) >= 0) ||
    cards.some((c) => c.risk_override);
  const marketStatus = hasDefense ? '防守' : '进攻';

  let mostWorth = null;
  let bestScore = -1;
  cards.forEach((c) => {
    if (c.action && offensiveActions.indexOf(c.action) >= 0) {
      if (c.opportunity_score != null && c.opportunity_score > bestScore) {
        bestScore = c.opportunity_score;
        mostWorth = c;
      }
    }
  });

  let mostDefend = null;
  cards.forEach((c) => {
    if (c.risk_override || (c.action && defensiveActions.indexOf(c.action) >= 0)) {
      if (!mostDefend) mostDefend = c;
    }
  });

  // 账户总览补字段
  const etfTotal = cards.reduce((s, c) => s + (c.current_position || 0), 0);
  const innovationCard = cards.find((c) => c.code === '159570');
  const innovationPosition = innovationCard ? innovationCard.current_position || 0 : 0;
  let overallRisk = '正常';
  if (cards.some((c) => c.risk_override || c.risk_flag === 'RED')) overallRisk = '高风险';
  else if (cards.some((c) => c.risk_flag === 'YELLOW')) overallRisk = '注意';

  const book = bookFromPositions(etfs, positions);
  const pick = (snapVal, fallback) => (snapVal != null && !Number.isNaN(Number(snapVal)) ? snapVal : fallback);
  let displayPnl = portSnapshot
    ? (portSnapshot.total_pnl != null ? portSnapshot.total_pnl : portSnapshot.auto_pnl)
    : null;
  if (displayPnl == null) {
    try { displayPnl = await computeDashboardPnl(etfs); } catch (e) { displayPnl = null; }
  }

  return {
    engine_mode,
    v3_mode,
    ml_shadow,
    three_questions: {
      market_status: marketStatus,
      most_worth: mostWorth ? { code: mostWorth.code, name: mostWorth.name } : null,
      most_defend: mostDefend ? { code: mostDefend.code, name: mostDefend.name } : null
    },
    overview: portSnapshot ? {
      total_asset: portSnapshot.total_asset,
      cash_balance: portSnapshot.cash_balance,
      holdings_mv: portSnapshot.holdings_mv,
      asset_source: portSnapshot.asset_source,
      tech_position: pick(book.tech_position, portSnapshot.tech_position),
      gold_position: pick(book.gold_position, portSnapshot.gold_position),
      cash_ratio: pick(book.cash_ratio, portSnapshot.cash_ratio),
      total_pnl: displayPnl,
      auto_pnl: portSnapshot.auto_pnl != null ? portSnapshot.auto_pnl : displayPnl,
      snapshot_date: portSnapshot.snapshot_date,
      market_regime: portSnapshot.market_regime,
      etf_total: etfTotal,
      innovation_position: innovationPosition,
      overall_risk: overallRisk
    } : {
      tech_position: book.tech_position,
      gold_position: book.gold_position,
      cash_ratio: book.cash_ratio,
      etf_total: etfTotal, innovation_position: innovationPosition, overall_risk: overallRisk
    },
    cards
  };
}

/** ETF 列表 */
async function getEtfList() {
  const etfs = await db.getEtfList();
  const positions = await db.query(COLLECTIONS.PORTFOLIO_POSITION, {});
  // P2-2：并发拉取决策 + 快照
  const [decisionsArr, snapshotsArr] = await Promise.all([
    Promise.all(etfs.map((etf) => db.getLatestDecision(etf.code))),
    Promise.all(etfs.map((etf) => db.getLatestSnapshot(etf.code)))
  ]);
  const list = [];
  etfs.forEach((etf, i) => {
    const decision = decisionsArr[i];
    const snapshot = snapshotsArr[i];
    const pos = positions.find((p) => p.code === etf.code);
    // 防守级：放量下跌/周线反转=高；放量滞涨/周线破坏=中；否则低
    let defense = null;
    if (snapshot) {
      if (snapshot.high_volume_decline || snapshot.w_state === 'W5') defense = '高';
      else if (snapshot.high_volume_stagnation || snapshot.w_state === 'W4') defense = '中';
      else defense = '低';
    }
    list.push({
      code: etf.code,
      name: etf.name,
      sector: etf.sector,
      stage: decision && decision.stage_summary
        ? decision.stage_summary
        : (decision ? `${decision.w_state}·${decision.h_state}` : null),
      action: decision ? decision.final_action : null,
      action_label: decision
        ? resolveActionLabel(decision.final_action, decision.action_label)
        : null,
      opportunity_score: decision ? decision.opportunity_score : null,
      opportunity_grade: decision ? decision.opportunity_grade : null,
      defense,
      current_position: pos ? pos.current_position || 0 : 0,
      target_position: pos ? pos.target_position || 0 : etf.target_position || 0,
      target_min: pos ? (pos.target_min != null ? pos.target_min : null) : null,
      target_std: pos ? (pos.target_std != null ? pos.target_std : (pos.target_position || 0)) : null,
      target_max: pos ? (pos.target_max != null ? pos.target_max : (pos.max_position || 0)) : null,
      final_target: decision ? decision.final_target : null,
      suggested_position: decision ? decision.suggested_position : null,
      data_time: decision ? decision.decision_date : null
    });
  });
  const actionRank = { 'TACTICAL_REDUCE': 0, 'STRATEGIC_REDUCE': 1, 'EXIT': 2, 'ADD': 3, 'BUILD': 4, 'HOLD': 5, 'WAIT': 6 };
  list.sort((a, b) => {
    const ra = a.action ? (actionRank[a.action] != null ? actionRank[a.action] : 6) : 6;
    const rb = b.action ? (actionRank[b.action] != null ? actionRank[b.action] : 6) : 6;
    return ra - rb;
  });
  return { list };
}

/** ETF 详情 */
async function getEtfDetail(code) {
  // P2-2：并发拉取（原顺序 await）
  const [etf, snapshot, decision, fundamental, riskEvents, pos] = await Promise.all([
    db.getEtf(code),
    db.getLatestSnapshot(code),
    db.getLatestDecision(code),
    db.getLatestFundamentalState(code),
    db.getActiveRiskEvents(code),
    db.getPosition(code)
  ]);
  if (!etf) return null;

  // 基本面雷达明细：模板指标 + 每个指标最新 series
  const fundamentalConfigAll = await db.query(COLLECTIONS.FUNDAMENTAL_CONFIG, { code }, {
    orderBy: [{ field: 'indicator', direction: 'asc' }]
  });
  const fundamentalConfig = fundamentalConfigAll.filter((c) => (Number(c.weight) || 0) > 0);
  const seriesRows = await Promise.all(fundamentalConfig.map((cfg) =>
    db.query(COLLECTIONS.FUNDAMENTAL_SERIES, { code, indicator: cfg.indicator }, {
      orderBy: [{ field: 'data_date', direction: 'desc' }], limit: 40
    })
  ));
  const fundamentalSeries = {};
  fundamentalConfig.forEach((cfg, i) => {
    const row = fund.pickLatestSeries(seriesRows[i], cfg);
    fundamentalSeries[cfg.indicator] = row ? {
      value: row.value, direction: row.direction, data_date: row.data_date,
      unit: row.unit || cfg.unit || '', note: row.note || '',
      citations: row.citations || [], source: row.source || ''
    } : null;
  });
  let holdingRows = [];
  try {
    holdingRows = await db.query(COLLECTIONS.ETF_HOLDINGS, { code }, { limit: 40 });
  } catch (e) { holdingRows = []; }
  let reportDate = '';
  holdingRows.forEach((r) => { if (!reportDate || r.report_date > reportDate) reportDate = r.report_date; });
  const holdings = holdingRows.filter((r) => r.report_date === reportDate).sort((a, b) => a.rank - b.rank).slice(0, 10);

  let paramBag = {};
  try {
    const { params } = await db.getParamConfig();
    paramBag = params || {};
  } catch (e) { /* ignore */ }
  const signal = await getLatestMlShadowSignal(code);
  const liveDecision = withChineseActionLabel(await attachLiveCooldown(decision));
  const ml_shadow = buildEtfMlShadow(paramBag, liveDecision, signal);

  return {
    basic: etf,
    snapshot,
    // 冷静期实时化：决策快照里的 cooldown_days 是生成时的历史值，展示用「北京今天」重算的当前剩余
    decision: liveDecision,
    ml_shadow,
    fundamental,
    risk_events: riskEvents,
    position: pos || { current_position: 0, target_position: etf.target_position || 0, max_position: etf.max_position || 30 },
    fundamental_config: fundamentalConfig,
    fundamental_series: fundamentalSeries,
    holdings,
    holdings_date: reportDate || null
  };
}

/** K 线 */
async function getKline(code, period) {
  if (period === 'weekly') {
    const rows = await db.query(COLLECTIONS.ETF_WEEKLY, { code }, {
      orderBy: [{ field: 'week_end_date', direction: 'asc' }], limit: 260
    });
    return rows.map((r) => ({
      date: r.week_end_date, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume
    }));
  }
  const rows = await db.query(COLLECTIONS.ETF_DAILY, { code }, {
    orderBy: [{ field: 'trade_date', direction: 'asc' }], limit: 320
  });
  return rows
    .filter((r) => r.close != null)
    .map((r) => ({
      date: r.trade_date, open: r.open, high: r.high, low: r.low, close: r.close,
      volume: r.volume, amount: r.amount, premium_rate: r.premium_rate
    }));
}

/** 历史信号（与 getReview 同一套日期命令，避免只 from 或只 to 时内存过滤漏网） */
async function getDecisions(code, from, to) {
  const _ = db.getCommand();
  const where = { code };
  if (from && to) {
    where.decision_date = _.and(_.gte(from), _.lte(to));
  } else if (from) {
    where.decision_date = _.gte(from);
  } else if (to) {
    where.decision_date = _.lte(to);
  }
  const rows = await db.query(COLLECTIONS.DECISION_RESULT, where, {
    orderBy: [{ field: 'decision_date', direction: 'desc' }],
    limit: (from || to) ? 500 : 60
  });
  return (rows || []).map(withChineseActionLabel);
}

/** 组合仓位 */
async function getPortfolio() {
  const etfs = await db.getEtfList();
  const positions = await db.query(COLLECTIONS.PORTFOLIO_POSITION, {});
  const snapshots = await db.query(COLLECTIONS.PORTFOLIO_SNAPSHOT, {}, {
    orderBy: [{ field: 'snapshot_date', direction: 'desc' }], limit: 1
  });
  const snapshot = snapshots[0] || null;

  const techSectors = ['storage', 'ai_network', 'semi_equip'];
  const semiSectors = ['storage', 'semi_equip'];
  let techTotal = 0;
  let semiTotal = 0;
  let goldTotal = 0;
  let totalPos = 0;
  let innovationPosition = 0;
  const rows = positions.map((p) => {
    const etf = etfs.find((e) => e.code === p.code);
    const sector = etf ? etf.sector : '';
    if (techSectors.indexOf(sector) >= 0) techTotal += p.current_position || 0;
    if (semiSectors.indexOf(sector) >= 0) semiTotal += p.current_position || 0;
    if (sector === 'gold') goldTotal += p.current_position || 0;
    totalPos += p.current_position || 0;
    if (p.code === '159570') innovationPosition = p.current_position || 0;
    const overMax = (p.current_position || 0) > (p.target_max != null ? p.target_max : (p.max_position || 0));
    const addSpace = Math.max(0, (p.target_std != null ? p.target_std : (p.target_position || 0)) - (p.current_position || 0));
    return {
      code: p.code,
      name: etf ? etf.name : p.code,
      sector,
      current_position: p.current_position || 0,
      target_position: p.target_position || 0,
      max_position: p.max_position || 0,
      target_min: p.target_min != null ? p.target_min : null,
      target_std: p.target_std != null ? p.target_std : (p.target_position || 0),
      target_max: p.target_max != null ? p.target_max : (p.max_position || 0),
      max_strategic_position: p.max_strategic_position != null ? p.max_strategic_position : (p.max_position || 0),
      core_position: p.core_position != null ? p.core_position : null,
      trade_position: p.trade_position != null ? p.trade_position : null,
      core_ratio_grade: p.core_ratio_grade || null,
      add_space: addSpace,
      over_max: overMax
    };
  });

  // 科技赛道上限从 param_config 读（缺省 65）
  const { params } = await db.getParamConfig();
  const techSectorMax = params.tech_sector_max != null ? params.tech_sector_max : 65;

  return {
    summary: snapshot ? {
      total_asset: snapshot.total_asset,
      cash_balance: snapshot.cash_balance,
      holdings_mv: snapshot.holdings_mv,
      asset_source: snapshot.asset_source,
      // 仓位类字段实时优先（portfolio_position 为用户维护的当前仓位，快照可能滞后/时序不一致）
      cash_ratio: totalPos > 0 ? Math.round(Math.max(0, 100 - totalPos) * 10) / 10 : snapshot.cash_ratio,
      tech_position: techTotal > 0 ? Math.round(techTotal * 10) / 10 : snapshot.tech_position,
      semi_position: semiTotal > 0 ? Math.round(semiTotal * 10) / 10 : snapshot.semi_position,
      gold_position: goldTotal > 0 ? Math.round(goldTotal * 10) / 10 : snapshot.gold_position,
      drug_position: innovationPosition > 0 ? Math.round(innovationPosition * 10) / 10 : (snapshot.drug_position != null ? snapshot.drug_position : innovationPosition),
      total_pnl: snapshot.total_pnl,
      tech_total: techTotal,
      semi_total: semiTotal,
      innovation_position: innovationPosition,
      tech_sector_max: techSectorMax,
      strategic_cash: snapshot.strategic_cash != null ? snapshot.strategic_cash : null,
      deployable_cash: snapshot.deployable_cash != null ? snapshot.deployable_cash : null,
      market_regime: snapshot.market_regime || null
    } : {
      tech_total: techTotal, semi_total: semiTotal, innovation_position: innovationPosition,
      tech_sector_max: techSectorMax, semi_position: semiTotal, drug_position: innovationPosition,
      strategic_cash: null, deployable_cash: null, market_regime: null
    },
    rows,
    tech_sector_max: techSectorMax
  };
}

/** 历史复盘 */
async function getReview(from, to) {
  // S-001 修复（2026-08-22）：加 where 范围过滤 + limit，防公网全表扫描刷慢整库（GLM 深审）
  const _ = db.getCommand();
  const decisionWhere = {};
  const tradeWhere = {};
  if (from && to) {
    decisionWhere.decision_date = _.and(_.gte(from), _.lte(to));
    tradeWhere.trade_date = _.and(_.gte(from), _.lte(to));
  } else if (from) {
    decisionWhere.decision_date = _.gte(from);
    tradeWhere.trade_date = _.gte(from);
  } else if (to) {
    decisionWhere.decision_date = _.lte(to);
    tradeWhere.trade_date = _.lte(to);
  }
  const decisions = await db.query(COLLECTIONS.DECISION_RESULT, decisionWhere, {
    orderBy: [{ field: 'decision_date', direction: 'desc' }], limit: 500
  });
  const trades = await db.query(COLLECTIONS.TRADE_LOG, tradeWhere, {
    orderBy: [{ field: 'trade_date', direction: 'desc' }], limit: 500
  });
  // 持仓要能看到筛选日前的快照/成交，不能跟复盘日期带绑死
  const [snapshots, heldTrades] = await Promise.all([
    db.query(COLLECTIONS.PORTFOLIO_SNAPSHOT, {}, {
      orderBy: [{ field: 'snapshot_date', direction: 'desc' }], limit: 200
    }),
    (from || to)
      ? db.query(COLLECTIONS.TRADE_LOG, {}, {
        orderBy: [{ field: 'trade_date', direction: 'desc' }], limit: 500
      })
      : Promise.resolve(trades)
  ]);

  const review = computeReviewStats(decisions, heldTrades);

  // 安全：复盘为公网无鉴权接口，不返回成交明细（仅聚合统计与决策链），成交明细走后台 adminGateway
  const target = d => (d.final_target != null ? d.final_target : d.target_position);
  const decisionsSafe = decisions.map((d) => ({
    decision_date: d.decision_date, code: d.code, final_action: d.final_action,
    action_label: resolveActionLabel(d.final_action, d.action_label), opportunity_score: d.opportunity_score,
    opportunity_grade: d.opportunity_grade,
    final_target: target(d),
    target_position: target(d),
    suggested_position: d.suggested_position,
    current_position: actualHeldPosition(d.code, d.decision_date, snapshots, heldTrades)
  }));

  // 实际操作（去敏：不含股数/金额，公网接口安全约束）——登记的操作立即可见，附匹配到的最近系统建议（决策日≤操作日）
  const tradesSafe = (heldTrades || []).map((t) => {
    const d = (decisions || []).find((x) => x.code === t.code && x.decision_date <= t.trade_date);
    return {
      trade_date: t.trade_date,
      code: t.code,
      action: t.action,
      position_after: t.position_after != null ? t.position_after : null,
      system_action: d ? d.final_action : null
    };
  }).sort((a, b) => String(b.trade_date).localeCompare(String(a.trade_date)));

  return {
    decisions: decisionsSafe,
    deviations: review.deviations,
    stats: review.stats,
    trades: tradesSafe
  };
}

/** 宏观数据（按指标分组的序列，供信息流宏观卡片展示） */
async function getMacro() {
  const rows = await db.query(COLLECTIONS.MACRO, {}, {
    orderBy: [{ field: 'report_date', direction: 'desc' }]
  });
  const byIndicator = {};
  rows.forEach((r) => {
    if (!byIndicator[r.indicator]) {
      byIndicator[r.indicator] = {
        indicator: r.indicator, name: r.name, unit: r.unit, note: r.note, series: []
      };
    }
    byIndicator[r.indicator].series.push({
      report_date: r.report_date, period_label: r.period_label, value: r.value
    });
  });
  return { indicators: Object.values(byIndicator) };
}

// 前台匿名 intel refresh 接口已迁移至后台管理端（POST /api/admin/intel/refresh，走鉴权 + intel-refresh.js 3 分钟冷却）

/** 信息流聚合：财报 + 新闻/快讯 + 传导信号 + 宏观，按时间倒序，含对决策的影响描述 */
async function getIntel(limit = 60) {
  const items = [];

  // 1. SEC 财报（20 家美股）
  const financials = await db.query(COLLECTIONS.GLOBAL_FINANCIAL, {}, { limit: 60 });
  for (const f of financials) {
    const cu = f.currency === 'EUR' ? '亿欧元' : (f.currency === 'TWD' ? '亿新台币' : '亿美元');
    const yoy = f.revenue_yoy != null ? (f.revenue_yoy > 0 ? '+' : '') + f.revenue_yoy + '%' : '—';
    items.push({
      type: 'financial', type_label: '财报',
      title: `${f.name}(${f.code}) ${f.form || ''} ${f.fp || ''} 财报`,
      time: (f.filed || f.period_end || '').slice(0, 10),
      detail: `营收 ${f.revenue != null ? (f.revenue / 1e8).toFixed(2) + cu : '—'}｜同比 ${yoy}｜毛利率 ${f.gross_margin != null ? f.gross_margin + '%' : '—'}`,
      impact: `${f.factor}：营收同比 ${yoy}，${f.revenue_yoy > 0 ? '对相关 ETF 基本面构成利好传导' : '景气偏弱'}${etfRelatedText(f.related) ? '（关联 ' + etfRelatedText(Array.isArray(f.related) ? f.related : [f.related]) + '）' : ''}`,
      related: Array.isArray(f.related) ? f.related : (f.related ? [f.related] : []),
      tone: f.revenue_yoy != null && f.revenue_yoy > 0 ? 'up' : 'down'
    });
  }

  // 2. 新闻 + 东财快讯
  const news = await db.query(COLLECTIONS.NEWS_FEED, {}, {
    orderBy: [{ field: 'publish_time', direction: 'desc' }], limit: 100
  });
  // 时间转北京时间字符串；容错脏数据（超大时间戳=微秒级误写、非法值）→ 回退空串，避免排序错乱
  const bjTime = (d) => {
    let dt = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(dt.getTime())) return String(d || '').slice(0, 19);
    // 防御：时间超出合理范围（早于 2000-01-01 或晚于当前+1年）→ 视为脏数据
    const ts = dt.getTime();
    if (ts < 946684800000 || ts > Date.now() + 366 * 24 * 3600 * 1000) {
      return '';
    }
    return new Date(ts + 8 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  };
  for (const n of news) {
    const isFast = n.source === 'eastmoney_fastnews';
    const srcLabel = n.source === 'clinicaltrials' ? '临床登记'
      : (n.source === 'openfda' ? 'FDA'
        : (n.source === 'eastmoney_search' ? '东财搜索'
          : (isFast ? '快讯' : '新闻')));
    const dirTxt = n.direction === 'positive' ? '利好' : (n.direction === 'negative' ? '利空' : '中性');
    items.push({
      type: isFast ? 'fastnews' : 'news', type_label: srcLabel,
      title: n.title,
      time: bjTime(n.publish_time),
      detail: n.summary || n.sec_name || '',
      impact: `${dirTxt}${n.code && n.code !== 'ALL' ? '（关联 ' + etfDisplayName(n.code) + '）' : ''}`,
      related: n.code && n.code !== 'ALL' ? [n.code] : [],
      tone: n.direction === 'positive' ? 'up' : (n.direction === 'negative' ? 'down' : 'neutral')
    });
  }

  // 3. 传导信号（LLM 从财报/新闻/海外走势提取）
  const signals = await db.query(COLLECTIONS.FUNDAMENTAL_SERIES, {}, { limit: 300 });
  const conduction = signals.filter((s) => ['sec', 'global', 'deepseek', 'llm_week'].indexOf(s.source) >= 0);
  for (const s of conduction) {
    const dirTxt = s.direction === 'up' ? '利好↑' : (s.direction === 'down' ? '利空↓' : (s.value >= 4 ? '较强' : (s.value === 3 ? '中性' : '偏弱')));
    items.push({
      type: 'signal', type_label: '传导信号',
      title: `${etfDisplayName(s.code)} · ${s.indicator}`,
      time: s.data_date,
      detail: s.note || '',
      impact: `${dirTxt}｜来源 ${s.source}｜置信 ${s.confidence != null ? s.confidence : '—'}`,
      related: [s.code],
      tone: s.direction === 'up' ? 'up' : (s.direction === 'down' ? 'down' : 'neutral')
    });
  }

  // 4. 宏观数据
  const macros = await db.query(COLLECTIONS.MACRO, {}, { limit: 20 });
  for (const m of macros) {
    items.push({
      type: 'macro', type_label: '宏观',
      title: `${m.name}（${m.period_label || m.report_date}）`,
      time: m.report_date + '-01',
      detail: `值 ${m.value}${m.unit || ''}`,
      impact: m.note || '',
      related: [],
      tone: 'neutral'
    });
  }

  // P3.10：去重安全网——同一 title + related(ETF) 只保留最新一条，防止历史重复数据透出
  const dedupMap = {};
  for (const it of items) {
    const relKey = (it.related || []).sort().join(',');
    const key = `${it.title}|||${relKey}`;
    if (!dedupMap[key]) {
      dedupMap[key] = it;
    }
  }
  const deduped = Object.values(dedupMap);

  // 按时间倒序
  deduped.sort((a, b) => (a.time < b.time ? 1 : (a.time > b.time ? -1 : 0)));
  const sliced = deduped.slice(0, limit);
  return { items: sliced, total: deduped.length };
}

function toDateStr(v) {
  if (!v) return '';
  if (v instanceof Date) {
    const t = v.getTime();
    if (Number.isNaN(t)) return '';
    return new Date(t + 8 * 3600 * 1000).toISOString().slice(0, 10);
  }
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function etfDisplayName(code) {
  if (!code || code === 'ALL') return '';
  return ETF_NAMES[code] || code;
}

function etfRelatedText(codes) {
  const names = (codes || []).map(etfDisplayName).filter(Boolean);
  return names.length ? names.join('、') : '';
}

function sourceLabel(src) {
  const map = {
    deepseek: 'AI',
    llm_week: 'AI周评',
    sec: '财报传导',
    sec_hard: 'SEC硬数据',
    hk_income: '港股财报',
    manual_veto: '人工否决',
    chinaflashmarket: '闪存现货',
    fred: 'FRED',
    tencent: '腾讯',
    't-goldream': '黄金持仓',
    eastmoney: '东财',
    global: '海外'
  };
  return map[src] || src || '';
}

/**
 * 五只 ETF 基本面总览：F 状态 + 雷达格子 + AI 逐条判定。
 * 给前台「基本面」页一次拉齐，避免连打 5 次 etfDetail。
 */
async function getFundamentals() {
  const etfs = await db.getEtfList();
  const n = etfs.length;
  const packed = await Promise.all([
    db.query(COLLECTIONS.FUNDAMENTAL_STATE, {}, { limit: 40 }).catch(() => []),
    db.query(COLLECTIONS.FUNDAMENTAL_CONFIG, {}, { limit: 80 }).catch(() => []),
    ...etfs.map((e) => db.query(COLLECTIONS.FUNDAMENTAL_SERIES, { code: e.code }, {
      orderBy: [{ field: 'data_date', direction: 'desc' }], limit: 80
    }).catch(() => [])),
    ...etfs.map((e) => db.query(COLLECTIONS.FUNDAMENTAL_EVIDENCE, { code: e.code }, { limit: 20 }).catch(() => []))
  ]);
  const states = packed[0] || [];
  const configs = packed[1] || [];
  const seriesPack = packed.slice(2, 2 + n);
  const evidencePack = packed.slice(2 + n);

  const stateByCode = {};
  (states || []).forEach((s) => {
    if (!s || !s.code) return;
    const prev = stateByCode[s.code];
    if (!prev) { stateByCode[s.code] = s; return; }
    const prevT = prev.updated_at ? new Date(prev.updated_at).getTime() : 0;
    const nextT = s.updated_at ? new Date(s.updated_at).getTime() : 0;
    if (nextT >= prevT) stateByCode[s.code] = s;
  });

  const list = etfs.map((etf, i) => {
    const state = stateByCode[etf.code] || null;
    const detail = (state && state.detail) || {};
    const cfgs = (configs || []).filter((c) => c.code === etf.code && (Number(c.weight) || 0) > 0);
    const seriesRows = seriesPack[i] || [];
    const indicators = cfgs.map((cfg) => {
      const rows = seriesRows.filter((r) => r.indicator === cfg.indicator);
      const row = fund.pickLatestSeries(rows, cfg);
      return {
        indicator: cfg.indicator,
        name: cfg.name || cfg.indicator,
        weight: cfg.weight,
        layer: cfg.layer || 'hard_data',
        metric_type: cfg.metric_type || 'quantitative',
        unit: (row && row.unit) || cfg.unit || '',
        value: row ? row.value : null,
        direction: row ? row.direction : null,
        data_date: row ? row.data_date : null,
        note: row ? (row.note || '') : '',
        citations: row ? (row.citations || []) : [],
        source: row ? (row.source || '') : '',
        source_label: sourceLabel(row ? row.source : '')
      };
    });

    const ev = (evidencePack[i] || [])
      .sort((a, b) => {
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
        if (tb !== ta) return tb - ta;
        return String(b.week_date || '').localeCompare(String(a.week_date || ''));
      })
      .slice(0, 12)
      .map((e) => ({
        indicator: e.indicator,
        title: e.title || '',
        stock_code: e.stock_code || '',
        stock_name: e.stock_name || '',
        grade: e.grade,
        confidence: e.confidence,
        source: e.source || '',
        source_label: sourceLabel(e.source),
        reason: e.reason || '',
        week_date: e.week_date || '',
        created_at: toDateStr(e.created_at)
      }));

    return {
      code: etf.code,
      name: etf.name,
      sector: etf.sector,
      f_state: state ? state.f_state : null,
      f_score: state ? state.f_score : null,
      updated_at: state ? toDateStr(state.updated_at) : '',
      detail: {
        final_signal: detail.final_signal,
        total_layer_weight: detail.total_layer_weight,
        positive: detail.positive,
        negative: detail.negative,
        layer_breakdown: detail.layer_breakdown || {}
      },
      indicators,
      ai_judgments: ev
    };
  });

  return { list };
}

/** 常量同步接口（D5）：后端单一事实源，供前端启动时拉取，消除前后端常量双写 */
async function getConstants() {
  // 运行状态唯一真相：读 runDecisionEngine 落库的 runtime_status，不再凭硬编码 ENGINE_VERSION / VERSION.txt / shadow log
  let runtime = null;
  try {
    const rows = await db.query(COLLECTIONS.RUNTIME_STATUS, { key: 'runtime-status' }, { limit: 1 });
    runtime = rows[0] || null;
  } catch (e) { /* runtime_status 未建时兜底 */ }
  return {
    w_state_labels: W_STATE_LABELS,
    d_state_labels: D_STATE_LABELS,
    h_state_labels: H_STATE_LABELS,
    v_state_labels: V_STATE_LABELS,
    f_state_labels: F_STATE_LABELS,
    c_state_labels: C_STATE_LABELS,
    action_labels: ACTION_LABELS,
    risk_flag_labels: RISK_FLAG_LABELS,
    sectors: SECTORS,
    etf_names: ETF_NAMES,
    engine_version: (runtime && runtime.production_engine) || ENGINE_VERSION,
    runtime_status: runtime || null
  };
}

/** 路由分发 */
exports.main = async (event = {}, context = {}) => {
  const method = (event.httpMethod || event.method || 'GET').toUpperCase();
  let path = event.path || event.url || '/';
  // 剥掉 HTTP 网关路径前缀（兼容 /apiGateway 或 /adminGateway 前缀透传）
  path = path.replace(/^\/(apiGateway|adminGateway)/, '') || '/';
  const query = event.queryStringParameters || event.query || {};
  const body = event.body ? (typeof event.body === 'string' ? JSON.parse(event.body || '{}') : event.body) : {};

  try {
    // GET /api/dashboard
    if (path === '/api/dashboard') return ok(await getDashboard());

    // GET /api/etf/list
    if (path === '/api/etf/list') return ok(await getEtfList());

    // GET /api/etf/:code/kline
    const klineMatch = path.match(/^\/api\/etf\/([^/]+)\/kline$/);
    if (klineMatch) return ok(await getKline(klineMatch[1], query.period || 'daily'));

    // GET /api/etf/:code/decisions
    const decMatch = path.match(/^\/api\/etf\/([^/]+)\/decisions$/);
    if (decMatch) return ok(await getDecisions(decMatch[1], query.from, query.to));

    // GET /api/etf/:code
    const detailMatch = path.match(/^\/api\/etf\/([^/]+)$/);
    if (detailMatch) {
      const detail = await getEtfDetail(detailMatch[1]);
      return detail ? ok(detail) : fail('ETF 不存在', 404);
    }

    // GET /api/portfolio
    if (path === '/api/portfolio') return ok(await getPortfolio());

    // GET /api/review
    if (path === '/api/review') return ok(await getReview(query.from, query.to));

    // 原 POST /api/intel/refresh 匿名接口已迁移至后台管理端（/api/admin/intel/refresh）

    // GET /api/fundamentals（五 ETF 基本面总览）
    if (path === '/api/fundamentals') return ok(await getFundamentals());

    // GET /api/intel（信息流聚合）
    if (path === '/api/intel') return ok(await getIntel(Number(query.limit) || 60));

    // GET /api/macro（宏观数据序列）
    if (path === '/api/macro') return ok(await getMacro());

    // GET /api/constants（常量同步，前后端单一事实源）
    if (path === '/api/constants') return ok(await getConstants());

    return fail(`未匹配路由: ${method} ${path}`, 404);
  } catch (e) {
    return fail(String(e.message || e), 500);
  }
};
