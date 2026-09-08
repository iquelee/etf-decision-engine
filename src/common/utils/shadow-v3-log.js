/**
 * V3 Shadow 日对照条目构建（runDecisionEngine 落库 + scripts/shadow-v3.js 本地 JSONL 共用）
 * V3.6.1：Aggressive Divergence（Δ≥5pp）+ 双结果字段
 */
'use strict';

const DIVERGE_PCT = 1; // 目标仓差 ≥1pp 视为分歧
const AGGRESSIVE_PP = 5;

function round1(n) {
  return Math.round(n * 10) / 10;
}

function analyzeDecision(dec) {
  const shadow = dec.shadow_targets || {};
  const v38 = shadow.v38_baseline != null ? shadow.v38_baseline
    : (dec.v38_target != null ? dec.v38_target : dec.v38_final_target);
  const v3 = shadow.v3_raw != null ? shadow.v3_raw
    : (dec.v361_target != null ? dec.v361_target : dec.v3_final_target);
  const o3 = shadow.o3_adjusted;
  const final = dec.final_target;
  const targetGap = shadow.target_delta != null
    ? shadow.target_delta
    : (v38 != null && v3 != null ? round1(v3 - v38) : null);
  const diverge = targetGap != null && Math.abs(targetGap) >= DIVERGE_PCT;
  const actionDiverge = dec.v38_final_action && dec.v3_final_action
    ? dec.v38_final_action !== dec.v3_final_action
    : false;
  const aggressive = shadow.aggressive_divergence === true
    || (targetGap != null && targetGap >= AGGRESSIVE_PP);
  const holdVsAdd = (dec.v38_final_action === 'HOLD' || dec.v38_action === 'HOLD')
    && (dec.v3_final_action === 'ADD' || dec.v3_final_action === 'BUILD'
      || dec.v361_action === 'ADD' || dec.v361_action === 'BUILD');
  const reduceVsHold = (dec.v38_final_action === 'TACTICAL_REDUCE' || dec.v38_final_action === 'STRATEGIC_REDUCE'
      || dec.v38_action === 'TACTICAL_REDUCE' || dec.v38_action === 'STRATEGIC_REDUCE')
    && (dec.v3_final_action === 'HOLD' || dec.v361_action === 'HOLD');

  return {
    v38,
    v3,
    o3,
    final,
    v38_action: dec.v38_final_action || dec.v38_action || dec.final_action,
    v3_action: dec.v3_final_action || dec.v361_action,
    engine_path: dec.engine_path,
    engine_version: dec.engine_version || null,
    shadow_engine_version: dec.shadow_engine_version || null,
    trend_stage: dec.trend_stage,
    binding: dec.binding_constraint,
    target_gap: targetGap,
    action_delta: shadow.action_delta || dec.action_delta || null,
    diverge: diverge || actionDiverge,
    action_diverge: actionDiverge,
    aggressive_divergence: aggressive,
    hold_vs_add: holdVsAdd,
    reduce_vs_hold: reduceVsHold,
    has_shadow: shadow.v38_baseline != null || dec.v38_final_target != null || dec.v38_target != null
  };
}

/**
 * @param {object} opts
 * @param {string} opts.snapDate YYYY-MM-DD
 * @param {boolean} opts.trendStageEnabled
 * @param {boolean} opts.shadowEnabled
 * @param {object} [opts.meta] config / version flags
 * @param {Array<{code:string, decision:object, w_state?:string}>} opts.items
 */
function buildShadowDailyEntry(opts) {
  const snapDate = opts.snapDate || '';
  const trendStage = opts.trendStageEnabled === true;
  const shadowOn = opts.shadowEnabled !== false;
  const meta = opts.meta || {};
  const entry = {
    log_time: new Date().toISOString(),
    snap_date: snapDate,
    trend_stage_enabled: trendStage,
    v3_shadow_enabled: shadowOn,
    v3_6_1_enabled: meta.v3_6_1_enabled === true,
    v3_6_1_shadow: meta.v3_6_1_shadow === true,
    engine_mode: trendStage ? 'cutover' : (shadowOn ? 'shadow' : 'off'),
    // 生产引擎必须用 runDecisionEngine 传入的真实值，禁止再硬编码 'v3.8'（曾致 shadow log 与真实运行各说一套）
    production_engine: meta.production_engine || (trendStage ? (meta.decision_engine || 'v3.6.1') : 'v3.8'),
    shadow_engine: meta.shadow_engine || null,
    config_version: meta.config_version || null,
    decision_engine: meta.decision_engine || null,
    stage_engine: meta.stage_engine || null,
    s5_downside: meta.s5_downside === true,
    post_s5_recovery: meta.post_s5_recovery === true,
    codes: {}
  };

  let divergeCount = 0;
  let missingShadow = 0;
  let aggressiveCount = 0;
  let holdVsAddCount = 0;
  let reduceVsHoldCount = 0;

  (opts.items || []).forEach((item) => {
    const code = item.code;
    const dec = item.decision;
    if (!dec) {
      entry.codes[code] = { missing: 'decision' };
      return;
    }
    const a = analyzeDecision(dec);
    if (!a.has_shadow) missingShadow += 1;
    if (a.diverge) divergeCount += 1;
    if (a.aggressive_divergence) aggressiveCount += 1;
    if (a.hold_vs_add) holdVsAddCount += 1;
    if (a.reduce_vs_hold) reduceVsHoldCount += 1;
    entry.codes[code] = {
      w: item.w_state || null,
      score: dec.opportunity_score,
      grade: dec.opportunity_grade,
      ...a
    };
  });

  entry.diverge_count = divergeCount;
  entry.missing_shadow_count = missingShadow;
  entry.aggressive_divergence_count = aggressiveCount;
  entry.hold_vs_add_count = holdVsAddCount;
  entry.reduce_vs_hold_count = reduceVsHoldCount;
  entry.etf_count = Object.keys(entry.codes).length;
  return entry;
}

function summarizeEntry(entry) {
  const lines = [];
  const eng = entry.shadow_engine ? ` · shadow=${entry.shadow_engine}` : '';
  lines.push(`V3 Shadow ${entry.snap_date} · 模式=${entry.engine_mode}${eng}`);
  if (entry.config_version) lines.push(`config=${entry.config_version}`);
  if (entry.missing_shadow_count) {
    lines.push(`⚠️  ${entry.missing_shadow_count} 只 ETF 无 shadow 字段`);
  }
  Object.entries(entry.codes || {}).forEach(([code, c]) => {
    if (c.missing) {
      lines.push(`  ${code}  缺 ${c.missing}`);
      return;
    }
    const gap = c.target_gap != null ? `${c.target_gap >= 0 ? '+' : ''}${c.target_gap}pp` : '—';
    const flag = c.aggressive_divergence ? ' 🔥' : (c.diverge ? ' ⚡' : '');
    const bind = c.binding ? ` [${c.binding}]` : '';
    const stage = c.trend_stage ? ` ${c.trend_stage}` : '';
    lines.push(
      `  ${code}  v38=${c.v38 ?? '—'} v3=${c.v3 ?? '—'} o3=${c.o3 ?? '—'} final=${c.final ?? '—'}`
      + `  ${c.v38_action}/${c.v3_action || '—'}${stage}${flag} Δ${gap}${bind}`
    );
  });
  lines.push(`分歧 ${entry.diverge_count}/${entry.etf_count}`
    + ` · Aggressive≥5pp ${entry.aggressive_divergence_count || 0}`
    + ` · HOLD→ADD ${entry.hold_vs_add_count || 0}`
    + ` · REDUCE→HOLD ${entry.reduce_vs_hold_count || 0}`);
  return lines.join('\n');
}

module.exports = {
  DIVERGE_PCT,
  AGGRESSIVE_PP,
  round1,
  analyzeDecision,
  buildShadowDailyEntry,
  summarizeEntry
};
