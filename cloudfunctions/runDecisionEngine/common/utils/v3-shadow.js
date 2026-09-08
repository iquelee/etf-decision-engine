/**
 * V3.0 v1.1 P5 — Shadow 三目标合并 + O3 缩放
 * v38_baseline / v3_raw / o3_adjusted 并行输出（§2.5）
 * V3.6.1：双结果落库 + engine_version / Aggressive Divergence 元数据
 */
'use strict';

const { OPPORTUNITY_FACTORS } = require('../constants.js');

/** O3 激进机会系数（与 decision-offense.js 对齐） */
const O3_OPPORTUNITY_FACTORS = {
  A: [0.95, 1.0],
  B: [0.75, 0.85],
  C: [0.55, 0.65],
  D: [0.35, 0.45],
  E: [0.15, 0.25],
  F: [0, 0]
};

/** Aggressive Divergence：Shadow 比生产多给 ≥5pct */
const AGGRESSIVE_DIVERGE_PP = 5;

function round1(n) {
  return Math.round(n * 10) / 10;
}

function midFactor(table, grade) {
  const row = table[grade];
  if (!row || !Array.isArray(row)) return null;
  return (row[0] + row[1]) / 2;
}

/** engine_mode 含 O3 或自定义 opportunity_factors 时计算 O3 调整后目标 */
function computeO3Adjusted(v3Result, params) {
  const raw = v3Result && v3Result.risk_adjusted_target;
  if (raw == null) return null;

  const mode = (params && params.engine_mode) || '';
  const hasO3 = mode.indexOf('O3') >= 0 || (params && params.opportunity_factors);
  if (!hasO3) return null;

  const grade = v3Result.opportunity_grade || 'C';
  const stdMid = midFactor(OPPORTUNITY_FACTORS, grade);
  const custom = params && params.opportunity_factors;
  const o3Mid = custom && custom[grade]
    ? midFactor(custom, grade)
    : midFactor(O3_OPPORTUNITY_FACTORS, grade);

  if (stdMid == null || o3Mid == null || stdMid <= 0) return round1(raw);
  const scaled = raw * (o3Mid / stdMid);
  const cap = v3Result.raw_target_position != null ? v3Result.raw_target_position : raw;
  return round1(Math.min(scaled, cap));
}

/**
 * V3.6.1 总闸：enabled=true 时强制 Baseline 包（Persistence + S5 Downside + V3.5-D），
 * 并关闭仍在实验层的 6.2/6.3。enabled=false 时关闭 6.1 S5 Downside（一键回退）。
 */
function applyV361ParamBundle(params) {
  const p = { ...(params || {}) };
  if (p.v3_6_1_enabled === true) {
    p.v3_5_enabled = true;
    if (!p.v3_5_mode || p.v3_5_mode === 'off') p.v3_5_mode = 'd';
    p.v3_6_persistence = true;
    p.v3_6_1_s5_downside = true;
    p.v3_6_2_post_s5_s4_grace = false;
    p.v3_6_3_adaptive_post_s5_grace = false;
  } else if (p.v3_6_1_enabled === false) {
    p.v3_6_1_s5_downside = false;
  }
  return p;
}

function resolveShadowEngineVersion(params) {
  if (params && (params.v3_6_1_enabled === true || params.v3_6_1_s5_downside === true)) {
    return 'v3.6.1';
  }
  if (params && params.v3_6_persistence === true) return 'v3.6';
  if (params && params.v3_5_enabled === true) return 'v3.5';
  return 'v3';
}

/**
 * 合并 V3.8 与 V3 决策结果；trend_stage_enabled 时 final 走 V3。
 */
function mergeShadowOutputs(v38Result, v3Result, params, trendStageEnabled) {
  const v38Target = v38Result.final_target;
  const v3Target = v3Result.final_target != null ? v3Result.final_target : v3Result.risk_adjusted_target;
  const targetDelta = (v38Target != null && v3Target != null) ? round1(v3Target - v38Target) : null;
  const actionDelta = (v38Result.final_action && v3Result.final_action
    && v38Result.final_action !== v3Result.final_action)
    ? `${v38Result.final_action}->${v3Result.final_action}`
    : null;
  const aggressiveDivergence = targetDelta != null && targetDelta >= AGGRESSIVE_DIVERGE_PP;
  const shadowEngine = resolveShadowEngineVersion(params);
  const engineMode = trendStageEnabled === true ? 'production' : 'shadow';

  const shadow = {
    v38_baseline: v38Target,
    v3_raw: v3Result.risk_adjusted_target,
    v3_6_1: shadowEngine === 'v3.6.1' ? v3Target : null,
    v3_2_math: v3Result.engine_path === 'v32_math' ? v3Result.risk_adjusted_target : null,
    v3_3_target: v3Result.engine_path === 'v33_target' ? v3Result.risk_adjusted_target : null,
    v3_4_stage: v3Result.engine_path === 'v34_stage' ? v3Result.risk_adjusted_target : null,
    v3_5_structural: v3Result.engine_path === 'v35_structural' ? v3Result.risk_adjusted_target : null,
    o3_adjusted: computeO3Adjusted(v3Result, params),
    target_delta: targetDelta,
    action_delta: actionDelta,
    aggressive_divergence: aggressiveDivergence
  };

  const primary = trendStageEnabled === true ? v3Result : v38Result;
  const secondary = trendStageEnabled === true ? v38Result : v3Result;
  const decisionTs = new Date().toISOString();

  return {
    ...primary,
    shadow_targets: shadow,
    engine_path: trendStageEnabled === true ? 'v3' : 'v38',
    engine_version: trendStageEnabled === true ? shadowEngine : 'v3.8',
    shadow_engine_version: shadowEngine,
    engine_mode: engineMode,
    config_version: (params && params.config_version) || null,
    decision_timestamp: decisionTs,
    // 双结果（生产复盘 / Shadow Diff）
    v38_target: v38Target,
    v361_target: shadowEngine === 'v3.6.1' ? v3Target : null,
    v38_action: v38Result.final_action,
    v361_action: shadowEngine === 'v3.6.1' ? v3Result.final_action : null,
    target_delta: targetDelta,
    action_delta: actionDelta,
    aggressive_divergence: aggressiveDivergence,
    v38_final_target: v38Target,
    v38_final_action: v38Result.final_action,
    v3_final_target: v3Result.final_target,
    v3_final_action: v3Result.final_action,
    trend_stage: v3Result.trend_stage,
    trend_stage_primary: v3Result.trend_stage_primary,
    trend_stage_overlay: v3Result.trend_stage_overlay,
    trend_quality_score: v3Result.trend_quality_score,
    trend_stage_state: v3Result.trend_stage_state,
    raw_target_position: v3Result.raw_target_position,
    risk_adjusted_target: v3Result.risk_adjusted_target,
    binding_constraint: v3Result.binding_constraint,
    factor_breakdown: v3Result.factor_breakdown,
    stage_factor: v3Result.stage_factor,
    market_factor: v3Result.market_factor,
    defense_score: v3Result.defense_score,
    defense_penalty: v3Result.defense_penalty,
    shock_context: v3Result.shock_context,
    shock_state: v3Result.shock_state,
    slow_break_score: v3Result.slow_break_score,
    main_rally_utilization: v3Result.main_rally_utilization,
    momentum_acceleration: v3Result.momentum_acceleration === true,
    profile_type: v3Result.profile_type,
    _shadow_secondary_action: secondary.final_action
  };
}

function buildV3Portfolio(portfolio, v3MarketEnv) {
  if (!v3MarketEnv) return portfolio;
  return {
    ...portfolio,
    market_regime: v3MarketEnv.market_regime,
    market_factor: v3MarketEnv.market_factor,
    market_score: v3MarketEnv.market_score,
    portfolio_breadth_proxy: v3MarketEnv.portfolio_breadth_proxy,
    crisis_hard_trigger: v3MarketEnv.crisis_hard_trigger
  };
}

function appendSlowBreakHistory(history, score, swing) {
  const next = Array.isArray(history) ? history.slice() : [];
  if (score == null) return next;
  const row = {
    score,
    lowerHigh: swing && swing.lowerHigh === true,
    lowerLow: swing && swing.lowerLow === true
  };
  next.push(row);
  while (next.length > 5) next.shift();
  return next;
}

module.exports = {
  O3_OPPORTUNITY_FACTORS,
  AGGRESSIVE_DIVERGE_PP,
  midFactor,
  computeO3Adjusted,
  applyV361ParamBundle,
  resolveShadowEngineVersion,
  mergeShadowOutputs,
  buildV3Portfolio,
  appendSlowBreakHistory
};
