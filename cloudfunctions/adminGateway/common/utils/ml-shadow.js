/**
 * Gen-1 统一元数据。
 * Advisory 可影响人工可见主建议；自动执行/券商写入永久关闭。
 * V3.6.1 风险骨架与基线字段始终保留。
 */
'use strict';

const DEFAULT_MODEL_ID = 'HVT-A-ET-20260830';
const DEFAULT_BUNDLE_ID = 'shadow-bundle-v1';
const ML_SIGNAL_STATUSES = Object.freeze({
  NO_OPPORTUNITY: 'NO_OPPORTUNITY',
  OBSERVED: 'OBSERVED',
  CANDIDATE: 'CANDIDATE',
  BLOCKED: 'BLOCKED',
  DEGRADED: 'DEGRADED'
});

function toPct(v) {
  if (v == null || Number.isNaN(Number(v))) return null;
  const n = Number(v);
  // 0–1.5 视为权重小数；否则视为已是百分比
  return (n >= 0 && n <= 1.5) ? Math.round(n * 1000) / 10 : Math.round(n * 10) / 10;
}

function pickNum(obj, keys) {
  if (!obj) return null;
  for (let i = 0; i < keys.length; i += 1) {
    const v = obj[keys[i]];
    if (v != null && v !== '' && !Number.isNaN(Number(v))) return Number(v);
  }
  return null;
}

function pickStr(obj, keys) {
  if (!obj) return '';
  for (let i = 0; i < keys.length; i += 1) {
    const v = obj[keys[i]];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

/** 北京日历日 YYYY-MM-DD */
function beijingTodayStr() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 自然日差（日历日）；无效返回 null */
function calendarAgeDays(signalDate, todayStr) {
  if (!signalDate || !/^\d{4}-\d{2}-\d{2}/.test(String(signalDate))) return null;
  const d0 = String(signalDate).slice(0, 10);
  const d1 = todayStr || beijingTodayStr();
  const t0 = Date.parse(d0 + 'T00:00:00+08:00');
  const t1 = Date.parse(d1 + 'T00:00:00+08:00');
  if (Number.isNaN(t0) || Number.isNaN(t1)) return null;
  return Math.max(0, Math.round((t1 - t0) / 86400000));
}

/** 组合级 / Dashboard 状态卡 */
function buildPortfolioMlShadow(params, extras) {
  const p = params || {};
  const enabled = p.ml_shadow_observe === true;
  const advisory = enabled && p.ml_advisory_enabled !== false;
  const fastPath = advisory && p.ml_fast_path_enabled !== false;
  return {
    enabled,
    effective: advisory,
    advisory_enabled: advisory,
    observe: enabled,
    fast_path_enabled: fastPath,
    execution_enabled: false,
    model_id: p.ml_challenger_model_id || DEFAULT_MODEL_ID,
    bundle_id: p.ml_shadow_bundle_id || DEFAULT_BUNDLE_ID,
    gen1_frozen: p.ml_gen1_frozen !== false,
    engine_version: 'v3.6.1',
    ui_phase: advisory ? 'ADVISORY_ACTIVE' : 'OBSERVE',
    production_permission: advisory ? 'ADVISORY_ONLY' : 'BLOCKED',
    note: advisory ? 'Gen-1 主机会判断 · V3.6.1 风险骨架 · 人工执行' : 'ML 影子观察中 · 不影响正式仓位',
    generated_at: new Date().toISOString(),
    ...(extras || {})
  };
}

/**
 * 标的级：闸门 + 正式仓位 + （可选）Shadow 信号行
 * signal 字段对齐 scripts/ml/push-shadow-signals.js / ledger_signals.csv
 */
function buildEtfMlShadow(params, decision, signal) {
  const base = buildPortfolioMlShadow(params);

  // 正式目标：兼容 final_target / suggested_position / target_std / target_position
  const rawProd = pickNum(decision, [
    'v361_baseline_target', 'baseline_target', 'v361_target',
    'final_target', 'suggested_position', 'target_std', 'target_position'
  ]);
  const production_target_pct = rawProd == null ? null : Math.round(rawProd * 10) / 10;

  const stage = pickStr(decision, [
    'trend_stage_primary', 'trend_stage', 'stage', 'stage_primary'
  ]) || null;

  const sig = signal || null;
  const probability = pickNum(sig, ['ml_probability', 'probability', 'p_raw']);
  const calibrated = pickNum(sig, ['calibrated_probability', 'p_calibrated']) != null
    ? pickNum(sig, ['calibrated_probability', 'p_calibrated'])
    : probability;

  const permissionRaw = pickStr(sig, ['rule_gate', 'permission', 'permission_class']);
  const permission = permissionRaw ? permissionRaw.toUpperCase() : '';
  const permit = permission === 'PERMIT' || permission === 'ALLOW' || permission === 'PASS';
  const blocked = permission === 'BLOCK' || permission === 'BLOCKED' || permission === 'FORBID';

  const wouldTrigger = !!(sig && (
    sig.fast_path_would_trigger === true
    || sig.would_trigger_fast_path === true
    || (sig.ml_fast === true && permit)
  ));
  const permissionHit = !!(sig && (
    sig.permission_hit === true
    || (sig.ml_fast === true && blocked)
  ));

  const signal_date = pickStr(sig, ['date', 'signal_date']) || null;
  const data_age_days = sig ? calendarAgeDays(signal_date) : null;
  // 旧行仍保留用于审计，但不能作为当日观察信号。
  const is_stale = data_age_days != null ? data_age_days > 0 : !sig;
  const stale_reason = !sig
    ? 'SIGNAL_ROW_MISSING'
    : (is_stale ? 'SIGNAL_DATE_BEFORE_TODAY' : null);

  const counterfactual_target_pct = (() => {
    const n = pickNum(sig, [
      'ml_counterfactual_target', 'counterfactual_target_pct', 'counterfactual_target'
    ]);
    return n == null ? null : toPct(n);
  })();

  const delta_target_pct = (counterfactual_target_pct != null && production_target_pct != null)
    ? Math.round((counterfactual_target_pct - production_target_pct) * 10) / 10
    : (() => {
      const n = pickNum(sig, ['delta_target', 'delta_target_pct']);
      return n == null ? null : toPct(n);
    })();

  let signal_status = ML_SIGNAL_STATUSES.NO_OPPORTUNITY;
  if (!sig || is_stale || String(sig.signal_status || '').toUpperCase() === ML_SIGNAL_STATUSES.DEGRADED) {
    signal_status = ML_SIGNAL_STATUSES.DEGRADED;
  } else if (wouldTrigger) signal_status = ML_SIGNAL_STATUSES.CANDIDATE;
  else if (permissionHit) signal_status = ML_SIGNAL_STATUSES.BLOCKED;
  else if (sig && (calibrated != null || probability != null)) signal_status = ML_SIGNAL_STATUSES.OBSERVED;

  return {
    ...base,
    stage: pickStr(sig, ['stage', 'stage_t']) || stage,
    probability,
    calibrated_probability: calibrated,
    permission: permission || null,
    permission_hit: permissionHit,
    would_trigger_fast_path: wouldTrigger,
    signal_status,
    advisory_effective: base.advisory_enabled === true && decision && decision.ml_advisory_effective === true,
    effective_stage: pickStr(decision, ['effective_stage', 'gen1_effective_stage', 'trend_stage']) || null,
    baseline_stage: pickStr(decision, ['v361_baseline_stage', 'baseline_stage']) || stage,
    advisory_target_pct: pickNum(decision, ['gen1_advisory_target', 'advisory_target']) != null
      ? pickNum(decision, ['gen1_advisory_target', 'advisory_target']) : null,
    baseline_target_pct: pickNum(decision, ['v361_baseline_target', 'baseline_target']) != null
      ? pickNum(decision, ['v361_baseline_target', 'baseline_target']) : production_target_pct,
    production_target_pct,
    counterfactual_target_pct,
    delta_target_pct,
    decision_hash: pickStr(sig, ['decision_hash', 'decision_id']) || null,
    source_trade_date: pickStr(sig, ['source_trade_date', 'date', 'signal_date']) || null,
    feature_schema_hash: pickStr(sig, ['feature_schema_hash']) || null,
    model_id: pickStr(sig, ['model_id', 'ml_model_id']) || base.model_id,
    signal_date,
    data_age_days,
    is_stale,
    stale_reason,
    usable_for_observation: !!sig && !is_stale,
    has_signal_row: !!sig
  };
}

function permissionLabel(ml) {
  if (!ml || !ml.enabled) return '影子观察关闭';
  if (ml.signal_status === ML_SIGNAL_STATUSES.CANDIDATE) return '快速通道候选';
  if (ml.signal_status === ML_SIGNAL_STATUSES.BLOCKED) return 'ML 机会 · 被规则拦截';
  if (ml.signal_status === ML_SIGNAL_STATUSES.OBSERVED) return '已观察';
  if (ml.signal_status === ML_SIGNAL_STATUSES.DEGRADED) return '数据降级';
  return '暂无机会';
}

/** Dashboard 卡片轻量字段（展示用；不影响交易） */
function slimCardMlShadow(full) {
  if (!full) return null;
  return {
    enabled: !!full.enabled,
    effective: !!full.effective,
    fast_path_enabled: !!full.fast_path_enabled,
    advisory_enabled: !!full.advisory_enabled,
    execution_enabled: false,
    model_id: full.model_id || DEFAULT_MODEL_ID,
    probability: full.probability,
    calibrated_probability: full.calibrated_probability,
    signal_status: full.signal_status,
    advisory_effective: !!full.advisory_effective,
    effective_stage: full.effective_stage || null,
    baseline_stage: full.baseline_stage || null,
    advisory_target_pct: full.advisory_target_pct,
    baseline_target_pct: full.baseline_target_pct,
    would_trigger_fast_path: !!full.would_trigger_fast_path,
    signal_date: full.signal_date || null,
    data_age_days: full.data_age_days,
    is_stale: !!full.is_stale,
    stale_reason: full.stale_reason || null,
    usable_for_observation: !!full.usable_for_observation,
    source_trade_date: full.source_trade_date || null,
    feature_schema_hash: full.feature_schema_hash || null,
    has_signal_row: !!full.has_signal_row
  };
}

module.exports = {
  DEFAULT_MODEL_ID,
  DEFAULT_BUNDLE_ID,
  ML_SIGNAL_STATUSES,
  buildPortfolioMlShadow,
  buildEtfMlShadow,
  slimCardMlShadow,
  permissionLabel,
  calendarAgeDays,
  beijingTodayStr
};
