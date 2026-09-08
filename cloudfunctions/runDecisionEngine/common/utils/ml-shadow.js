/**
 * ML Shadow 统一元数据（观察期）
 * enabled=观察开；effective=false=无生产写权限；fast_path_enabled 硬关。
 * 不改 V3.6.1 Target / Action。
 *
 * 层次：
 * - buildPortfolioMlShadow → 组合级状态（Dashboard 顶栏 / ParamConfig）
 * - buildEtfMlShadow → 标的级信号（EtfDetail + Dashboard cards[].ml_shadow）
 */
'use strict';

const DEFAULT_MODEL_ID = 'HVT-A-ET-20260830';
const DEFAULT_BUNDLE_ID = 'shadow-bundle-v1';

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
  return {
    enabled,
    effective: false,
    observe: enabled,
    fast_path_enabled: false,
    model_id: p.ml_challenger_model_id || DEFAULT_MODEL_ID,
    bundle_id: p.ml_shadow_bundle_id || DEFAULT_BUNDLE_ID,
    gen1_frozen: p.ml_gen1_frozen !== false,
    engine_version: 'v3.6.1',
    ui_phase: 'OBSERVE',
    production_permission: 'BLOCKED',
    note: 'ML 影子观察中 · 不影响正式仓位',
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
    'final_target', 'suggested_position', 'target_std', 'target_position', 'v361_target'
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

  // ledger 的 ml_counterfactual_target 是事件日阶段书权重（S2→0.4），
  // 仅在 fast-path 会上抬（通常 S4 mid→0.635）。无 uplift 时若直接 toPct(0.4)=40，
  // 会与 live production（如 4.5/12/20）错位，造成五卡全 40%。
  const counterfactual_target_pct = (() => {
    if (!sig) return null;
    const rawCf = pickNum(sig, [
      'ml_counterfactual_target', 'counterfactual_target_pct', 'counterfactual_target'
    ]);
    const rawDelta = pickNum(sig, ['delta_target', 'delta_target_pct']);
    const hasUplift = wouldTrigger || (rawDelta != null && rawDelta > 0);
    if (hasUplift) {
      return rawCf == null ? null : toPct(rawCf);
    }
    // 无 ML 仓位变化：反事实 = 正式目标
    if (production_target_pct != null) return production_target_pct;
    return rawCf == null ? null : toPct(rawCf);
  })();

  const delta_target_pct = (counterfactual_target_pct != null && production_target_pct != null)
    ? Math.round((counterfactual_target_pct - production_target_pct) * 10) / 10
    : (() => {
      const n = pickNum(sig, ['delta_target', 'delta_target_pct']);
      return n == null ? null : toPct(n);
    })();

  const signal_date = pickStr(sig, ['date', 'signal_date']) || null;
  const data_age_days = sig ? calendarAgeDays(signal_date) : null;
  const is_stale = data_age_days != null ? data_age_days > 0 : !sig;

  let signal_status = 'NO_SIGNAL';
  if (!sig) signal_status = 'DATA_MISSING';
  else if (wouldTrigger) signal_status = 'FAST_PATH_CANDIDATE';
  else if (permissionHit) signal_status = 'ML_OPPORTUNITY_BLOCKED';
  else if (calibrated != null || probability != null) signal_status = 'OBSERVED';
  else signal_status = 'NO_OPPORTUNITY';

  return {
    ...base,
    stage: pickStr(sig, ['stage', 'stage_t']) || stage,
    probability,
    calibrated_probability: calibrated,
    permission: permission || null,
    permission_hit: permissionHit,
    would_trigger_fast_path: wouldTrigger,
    signal_status,
    production_target_pct,
    counterfactual_target_pct,
    delta_target_pct,
    decision_hash: pickStr(sig, ['decision_hash', 'decision_id']) || null,
    signal_date,
    data_age_days,
    is_stale,
    has_signal_row: !!sig
  };
}

/** Dashboard 卡片轻量字段（展示用；不影响交易） */
function slimCardMlShadow(full) {
  if (!full) return null;
  return {
    enabled: !!full.enabled,
    effective: false,
    fast_path_enabled: false,
    model_id: full.model_id || DEFAULT_MODEL_ID,
    probability: full.probability,
    calibrated_probability: full.calibrated_probability,
    signal_status: full.signal_status,
    would_trigger_fast_path: !!full.would_trigger_fast_path,
    signal_date: full.signal_date || null,
    data_age_days: full.data_age_days,
    is_stale: !!full.is_stale,
    has_signal_row: !!full.has_signal_row
  };
}

function permissionLabel(ml) {
  if (!ml || !ml.enabled) return '影子观察关闭';
  if (ml.signal_status === 'DATA_MISSING') return '数据缺失';
  if (ml.signal_status === 'FAST_PATH_CANDIDATE') return '快速通道候选';
  if (ml.signal_status === 'ML_OPPORTUNITY_BLOCKED') return 'ML 机会 · 被规则拦截';
  if (ml.signal_status === 'NO_OPPORTUNITY') return '模型判断无机会';
  if (ml.has_signal_row) return '影子信号';
  return '暂无 ML 信号';
}

module.exports = {
  DEFAULT_MODEL_ID,
  DEFAULT_BUNDLE_ID,
  buildPortfolioMlShadow,
  buildEtfMlShadow,
  slimCardMlShadow,
  permissionLabel,
  calendarAgeDays,
  beijingTodayStr
};
