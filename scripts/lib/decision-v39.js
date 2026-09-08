/**
 * V3.9 实验层：包装生产 decision.js，仅回测使用，不进云函数。
 * 用法：require('./decision-v39')('E1-w4-firstlot')
 */
'use strict';

const base = require('../../cloudfunctions/common/utils/decision.js');
const {
  ADD_THRESHOLD_PCT, BUILD_FIRST_LOT_PCT, OVER_ALLOC_THRESHOLDS, TREND_CONTEXTS
} = require('../../cloudfunctions/common/constants.js');

function w4FirstLotAllowed(experiment, ctx) {
  if (!experiment || !experiment.startsWith('E')) return false;
  const w = (ctx.snapshot && ctx.snapshot.w_state) || 'W3';
  const current = (ctx.positions && ctx.positions.current_position) || 0;
  if (w !== 'W4' || current > 0) return false;

  const score = ctx.opportunityScore;
  const grade = base.gradeOpportunity(score);
  if (grade !== 'A' && grade !== 'B') return false;

  if (experiment === 'E2-w4-firstlot-b72') {
    if (score == null || score < 72) return false;
  }
  if (experiment === 'E3-ai-network') {
    const sector = ctx.etf && ctx.etf.sector;
    if (sector !== 'ai_network') return false;
  }
  if (experiment === 'E1-w4-firstlot' || experiment === 'E2-w4-firstlot-b72' || experiment === 'E3-ai-network' || experiment === 'E6-combo') {
    return true;
  }
  return false;
}

function runStateMachineV39(experiment, ctx) {
  const { snapshot = {}, fundamental = {}, risk = {}, crowding = {}, positions = {} } = ctx;
  const w = snapshot.w_state || 'W3';
  const f = fundamental.f_state || 'F3';
  const current = positions.current_position || 0;
  const finalTarget = ctx.finalTarget != null ? ctx.finalTarget : 0;
  const gap = ctx.gap != null ? ctx.gap : 0;
  const eligibilityOverall = ctx.eligibilityOverall || 'allow';
  const allowW4First = w4FirstLotAllowed(experiment, ctx);

  if (risk.risk_override === true || risk.risk_flag === 'RED') {
    if (f === 'F5') return current > 0 ? 'EXIT' : 'WAIT';
    return current > 0 ? 'STRATEGIC_REDUCE' : 'WAIT';
  }
  if (f === 'F5') return current > 0 ? 'EXIT' : 'WAIT';

  if (w === 'W5') return current > 0 ? 'STRATEGIC_REDUCE' : 'WAIT';
  if (w === 'W4') {
    if (current > 0) return 'STRATEGIC_REDUCE';
    if (!allowW4First) return 'WAIT';
  }

  if (f === 'F4') return current > 0 ? 'STRATEGIC_REDUCE' : 'WAIT';
  if (snapshot.high_volume_decline) return current > 0 ? 'STRATEGIC_REDUCE' : 'WAIT';
  if (snapshot.high_volume_stagnation) return current > 0 ? 'TACTICAL_REDUCE' : 'WAIT';
  if (crowding.premium_flag === '极端溢价') return current > 0 ? 'HOLD' : 'WAIT';
  if (finalTarget <= 0) return current > 0 ? 'EXIT' : 'WAIT';

  if (gap >= ADD_THRESHOLD_PCT) {
    if (eligibilityOverall === 'allow') return current <= 0 ? 'BUILD' : 'ADD';
    return current > 0 ? 'HOLD' : 'WAIT';
  }

  const overStatus = ctx.overAllocStatus || base.computeOverAllocStatus(gap);
  if (overStatus === 'normal' || overStatus === '轻度') return 'HOLD';
  if ((w === 'W1' || w === 'W2') && overStatus === '中度') return 'HOLD';
  return 'TACTICAL_REDUCE';
}

function checkAddEligibilityV39(experiment, ctx) {
  if (!w4FirstLotAllowed(experiment, ctx)) {
    return base.checkAddEligibility(ctx);
  }
  const { snapshot = {}, fundamental = {}, risk = {}, positions = {}, portfolio = {}, params = {} } = ctx;
  const w = snapshot.w_state || 'W3';
  const h = snapshot.h_state || 'H3';
  const v = snapshot.v_state || 'V3';
  const f = fundamental.f_state || 'F3';
  const pricePosition = snapshot.price_position;
  const consolidationScore = snapshot.consolidation_score;
  const addMode = ctx.addMode || '无';
  const consolidationGrade = ctx.consolidationGrade != null ? ctx.consolidationGrade : base.gradeConsolidation(snapshot);
  const current = positions.current_position || 0;
  const volTh = params.volume_ratio != null ? params.volume_ratio : 0.70;

  const w4FirstLot = true;
  const trend = 'ok';
  const structure = (consolidationGrade === 'C') ? 'pause' : 'ok';
  const volume = (v === 'V1' || v === 'V2' || (snapshot.volume_ratio != null && snapshot.volume_ratio <= volTh)) ? 'ok' : 'pause';
  const fund = (f === 'F4' || f === 'F5') ? 'pause' : 'ok';
  const chase = (w4FirstLot || pricePosition == null || pricePosition <= 0.8 || addMode === '突破加仓') ? 'ok' : 'pause';
  const targetMax = positions.target_max != null ? positions.target_max : 30;
  const limit = (current >= targetMax) ? 'pause' : 'ok';

  let sectorCheck = 'ok';
  const sector = (ctx.etf && ctx.etf.sector) || '';
  const TECH_SECTORS = ['storage', 'ai_network', 'semi_equip'];
  if (TECH_SECTORS.indexOf(sector) >= 0) {
    const techMax = params.tech_sector_max != null ? params.tech_sector_max : 65;
    const techPos = portfolio.tech_position != null ? portfolio.tech_position : 0;
    sectorCheck = techPos >= techMax ? 'pause' : 'ok';
  }
  const riskCheck = (risk.risk_override === true || risk.risk_flag === 'RED') ? 'forbid'
    : (risk.risk_flag === 'YELLOW' ? 'pause' : 'ok');
  const cooldownDays = ctx.cooldownDays != null ? ctx.cooldownDays : 0;
  const cooldownCheck = cooldownDays > 0 ? 'pause' : 'ok';
  const regime = portfolio.market_regime || 'range';
  const regimeCheck = (regime === 'crisis' || regime === 'defensive') ? 'pause' : 'ok';

  const items = { trend, structure, volume, fund, chase, limit, sector: sectorCheck, risk: riskCheck, cooldown: cooldownCheck, regime: regimeCheck };
  let overall = 'allow';
  if (Object.values(items).indexOf('forbid') >= 0) overall = 'forbid';
  else if (Object.values(items).indexOf('pause') >= 0) overall = 'pause';
  return { ...items, overall };
}

function computeTargetPositionV39(experiment, ctx, action) {
  if (experiment !== 'E4-w4-down-flat' && experiment !== 'E6-combo') {
    return base.computeTargetPosition(ctx, action);
  }
  if (action !== 'STRATEGIC_REDUCE') {
    return base.computeTargetPosition(ctx, action);
  }
  const snapshot = ctx.snapshot || {};
  const w = snapshot.w_state || 'W4';
  const current = (ctx.positions && ctx.positions.current_position) || 0;
  if (w === 'W4' && (snapshot.trend_context === TREND_CONTEXTS.DOWN || snapshot.trend_context === 'DOWN_CONSOLIDATION')) return 0;
  return base.computeTargetPosition(ctx, action);
}

function runDecisionV39(experiment, etf, snapshot, positions, params, extra) {
  const fundamental = extra.fundamental || { f_state: 'F3', f_score: 15, detail: {} };
  const risk = extra.risk || { risk_flag: 'NORMAL', risk_override: false };
  const portfolio = extra.portfolio || { tech_position: 0, gold_position: 0, cash_ratio: 100 };
  const crowding = extra.crowding || base.computeCrowding({ etf, snapshot, params });
  const cooldownDays = extra.cooldownDays != null ? extra.cooldownDays : 0;

  const w = snapshot.w_state || 'W3';
  const scores = {
    trend: base.scoreTrend ? base.scoreTrend(w) : 0,
    volume: 0,
    fundamental: 0,
    crowding: 0,
    risk: 0,
    total: 0
  };
  if (typeof base.scoreVolume === 'function') {
    scores.volume = base.scoreVolume(snapshot.h_state || 'H3', snapshot.v_state || 'V3', snapshot);
    scores.fundamental = base.scoreFundamental(fundamental.f_state || 'F3');
    scores.crowding = base.scoreCrowding(crowding.c_state || 'C1');
    scores.risk = base.scoreRisk(risk.risk_flag, risk.risk_override === true);
    scores.total = scores.trend + scores.volume + scores.fundamental + scores.crowding + scores.risk;
  }

  const weights = extra.weights || params.opportunity_weights || undefined;
  const opportunityScore = base.calcOpportunityScore(scores, weights, risk.risk_override === true);
  const consolidationGrade = base.gradeConsolidation(snapshot);

  let ctx = {
    etf, snapshot, fundamental, risk, positions, portfolio, crowding, params, scores, opportunityScore, cooldownDays,
    sectorRemainingLimit: extra.sectorRemainingLimit != null ? extra.sectorRemainingLimit : null,
    consolidationGrade
  };

  const target = base.generateTargetPosition(ctx);
  const addMode = base.determineAddMode(ctx);
  const coreTrade = base.computeCoreTrade(ctx, target.finalTarget);
  ctx = { ...ctx, grade: target.grade, factor: target.factor, finalTarget: target.finalTarget, gap: target.gap, addMode, ...coreTrade };

  const eligibility = checkAddEligibilityV39(experiment, ctx);
  const overAllocStatus = base.computeOverAllocStatus(target.gap);
  ctx = { ...ctx, eligibilityOverall: eligibility.overall, overAllocStatus };

  const ruleHits = base.applyHardRules(ctx);
  let finalAction = runStateMachineV39(experiment, ctx);
  let suggestedPosition = computeTargetPositionV39(experiment, ctx, finalAction);
  const sectorCap = base.applySectorHardCap(ctx, finalAction, suggestedPosition);
  if (sectorCap.hit) {
    finalAction = sectorCap.action;
    suggestedPosition = sectorCap.suggested;
  }

  const explainChain = base.buildExplainChain(ctx, finalAction, suggestedPosition);
  const nextAddCondition = base.buildNextAddCondition(ctx);
  const targetMin = target.range.target_min;
  const targetStd = target.range.target_std;
  const targetMax = target.range.target_max;
  const maxPosition = positions.max_strategic_position != null ? positions.max_strategic_position
    : (positions.max_position != null ? positions.max_position : (params.single_etf_max != null ? params.single_etf_max : 30));

  return {
    code: etf.code || snapshot.code || '',
    decision_date: snapshot.calc_date || '',
    w_state: w,
    d_state: snapshot.d_state || 'D3',
    h_state: snapshot.h_state || 'H3',
    v_state: snapshot.v_state || 'V3',
    f_state: fundamental.f_state || 'F3',
    c_state: crowding.c_state || 'C1',
    risk_flag: risk.risk_flag || 'NORMAL',
    risk_override: risk.risk_override === true,
    premium_flag: crowding.premium_flag || '正常',
    scores,
    opportunity_score: opportunityScore,
    opportunity_grade: target.grade,
    opportunity_factor: target.factor,
    target_min: targetMin,
    target_std: targetStd,
    target_max: targetMax,
    max_position: maxPosition,
    final_target: target.finalTarget,
    position_gap: Math.round((suggestedPosition - (positions.current_position || 0)) * 10) / 10,
    core_position: coreTrade.core,
    trade_position: coreTrade.trade,
    suggested_position: suggestedPosition,
    add_mode: addMode,
    add_eligibility: eligibility,
    cooldown_days: cooldownDays,
    over_alloc_status: overAllocStatus,
    defense_state: base.computeDefenseState(ctx),
    action: finalAction,
    action_label: (base.ACTION_LABELS && base.ACTION_LABELS[finalAction]) || finalAction,
    consolidation_grade: consolidationGrade,
    final_action: finalAction,
    target_position: target.finalTarget,
    suggested_position_pct: suggestedPosition,
    explain_chain: explainChain,
    next_add_condition: nextAddCondition,
    rule_hits: []
  };
}

module.exports = function createDecisionExperiment(experiment) {
  if (!experiment || experiment === 'baseline') return base;

  const patched = { ...base };
  patched.runStateMachine = (ctx) => runStateMachineV39(experiment, ctx);
  patched.checkAddEligibility = (ctx) => checkAddEligibilityV39(experiment, ctx);
  patched.computeTargetPosition = (ctx, action) => computeTargetPositionV39(experiment, ctx, action);
  patched.runDecision = (etf, snapshot, positions, params, extra) =>
    runDecisionV39(experiment, etf, snapshot, positions, params, extra || {});
  patched._experiment = experiment;
  return patched;
};
