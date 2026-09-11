/**
 * Gen-1 UI 契约 ViewModel（PR-UI-01）。
 *
 * 目标：前台/后台不再从 `ml_shadow`、`param_config ml_*` 与 `decision_result`
 * 各自猜语义，而是统一消费明确分层的三层结构：
 *
 *   system_runtime.production  V3.6.1 唯一生产决策层（ACTIVE）
 *   system_runtime.gen1        COUNTERFACTUAL_CANARY（反事实，不写生产）
 *   system_runtime.gen2        SHADOW Selection（不写生产）
 *
 * 硬约束（本模块只读组合，绝不改写）：
 *   - production.* 只能来自 decision_result.final_action / final_target /
 *     suggested_position 与 portfolio_position.current_position；
 *   - gen1.counterfactual.* 只能来自 decision_result.gen1_counterfactual_*，
 *     绝不允许回填进 production.*；
 *   - authority 只能来自 runtime_status.gen1_authority；
 *     禁止通过 ml_shadow_observe / ml_advisory_enabled / ml_fast_path_enabled 反推；
 *   - production_write / production_fast_path_enabled / auto_execution 恒 false。
 *
 * 纯函数、无 DB、无副作用：便于 Node 单测（tests/gen1-ui-contract.test.js）。
 *
 * @module gen1-ui-view-model
 */
'use strict';

const { AUTHORITY_LABEL } = require('./gen1-authority');
const { evaluateDomainPermission } = require('./gen1-domain-permission');

const PRODUCTION_ENGINE_FALLBACK = 'v3.6.1';

/** Gen-1 信号状态码（与前端既有枚举对齐） */
const SIGNAL_STATUS = Object.freeze({
  NO_OPPORTUNITY: 'NO_OPPORTUNITY',
  OBSERVED: 'OBSERVED',
  CANDIDATE: 'CANDIDATE',
  BLOCKED: 'BLOCKED',
  DEGRADED: 'DEGRADED'
});

function numberOrNull(v) {
  return v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
}

function pct(v) {
  const n = numberOrNull(v);
  return n == null ? null : Math.round(n * 10) / 10;
}

function strOrNull(v) {
  return v == null || String(v).trim() === '' ? null : String(v).trim();
}

/** runtime_status 行 → authority（唯一合法来源；读不到 = null，绝不反推） */
function authorityFromRuntime(runtime) {
  if (!runtime || typeof runtime !== 'object') return null;
  return strOrNull(runtime.gen1_authority);
}

function authorityLabelOf(authority) {
  return authority && AUTHORITY_LABEL[authority] ? AUTHORITY_LABEL[authority] : (authority || null);
}

/**
 * A. 系统级三层 ViewModel。
 * @param {object|null} runtime runtime_status 单文档（key='runtime-status'）
 */
function buildSystemRuntime(runtime) {
  const rt = runtime && typeof runtime === 'object' ? runtime : null;
  const authority = authorityFromRuntime(rt);
  return {
    production: {
      engine: (rt && strOrNull(rt.production_engine)) || PRODUCTION_ENGINE_FALLBACK,
      status: 'ACTIVE'
    },
    gen1: {
      authority,
      authority_label: authorityLabelOf(authority),
      health_status: rt ? strOrNull(rt.gen1_health_status) : null,
      health_gate_status: rt ? strOrNull(rt.gen1_health_gate_status) : null,
      health_source: rt ? strOrNull(rt.gen1_health_source) : null,
      safety_source: (rt && strOrNull(rt.gen1_safety_source)) || 'SAFETY_CORE',
      counterfactual_active: rt ? rt.gen1_counterfactual_canary_active === true : false,
      counterfactual_invocations: rt && numberOrNull(rt.gen1_counterfactual_canary_invocations) != null
        ? numberOrNull(rt.gen1_counterfactual_canary_invocations) : 0,
      ledger_ok: rt ? rt.gen1_counterfactual_ledger_ok === true : false,
      // 三条硬边界恒 false（Gen-1 永不写生产 / 永不开生产 Fast Path / 永不自动交易）
      production_write: false,
      production_fast_path_enabled: false,
      auto_execution: false
    },
    gen2: {
      mode: 'SHADOW',
      production_write: false
    }
  };
}

/** Health 四真值（后台 Control Plane 用；逐字段独立，禁止合并成“健康正常”） */
function buildHealthTruth(runtime) {
  const rt = runtime && typeof runtime === 'object' ? runtime : null;
  return {
    gen1_health_status: rt ? strOrNull(rt.gen1_health_status) : null,
    gen1_health_gate_status: rt ? strOrNull(rt.gen1_health_gate_status) : null,
    gen1_health_source: rt ? strOrNull(rt.gen1_health_source) : null,
    gen1_safety_source: (rt && strOrNull(rt.gen1_safety_source)) || 'SAFETY_CORE'
  };
}

/** Canary 账本五字段（cap 合规证据只看 intended，target_sum 仅 info） */
function buildCanaryLedger(runtime) {
  const rt = runtime && typeof runtime === 'object' ? runtime : null;
  return {
    gen1_production_tech_position: rt ? numberOrNull(rt.gen1_production_tech_position) : null,
    gen1_counterfactual_intended_tech_position: rt
      ? numberOrNull(rt.gen1_counterfactual_intended_tech_position) : null,
    gen1_counterfactual_tech_cap: rt ? numberOrNull(rt.gen1_counterfactual_tech_cap) : null,
    gen1_counterfactual_ledger_ok: rt ? rt.gen1_counterfactual_ledger_ok === true : false,
    gen1_counterfactual_target_sum: rt ? numberOrNull(rt.gen1_counterfactual_target_sum) : null // info only
  };
}

/**
 * 推导 Gen-1 信号状态码。
 * 规则（UI-G1-08）：无模型候选 → NO_OPPORTUNITY，概率必须 null，不得伪造胜率。
 */
function deriveSignalStatus(decision, signal) {
  const d = decision || null;
  const sig = signal || null;
  if (!sig) return SIGNAL_STATUS.DEGRADED;
  const raw = String(sig.raw_signal_status || sig.signal_status || '').toUpperCase();
  if (raw === SIGNAL_STATUS.DEGRADED) return SIGNAL_STATUS.DEGRADED;
  const candidate = !!(d && d.gen1_model_candidate === true);
  if (candidate && d.gen1_canary_effective === true) return SIGNAL_STATUS.CANDIDATE;
  const safetyBlock = d && String(d.ml_rule_permission || '').toUpperCase() === 'BLOCK';
  if (candidate && safetyBlock) return SIGNAL_STATUS.BLOCKED;
  const prob = numberOrNull(sig.calibrated_probability != null ? sig.calibrated_probability : sig.ml_probability);
  if (prob != null) return SIGNAL_STATUS.OBSERVED;
  return SIGNAL_STATUS.NO_OPPORTUNITY;
}

/**
 * B. 每 ETF 生产层 ViewModel（production.* 唯一来源 = V3.6.1 decision_result）。
 */
function buildEtfProduction({ decision, position, runtime, actionLabel } = {}) {
  const d = decision || null;
  const pos = position || null;
  return {
    engine: (runtime && strOrNull(runtime.production_engine)) || PRODUCTION_ENGINE_FALLBACK,
    action_code: d ? strOrNull(d.final_action) : null,
    action_label: actionLabel != null ? actionLabel : null,
    current_pct: pos ? pct(pos.current_position) : null,
    final_target_pct: d ? pct(d.final_target) : null,
    suggested_pct: d ? pct(d.suggested_position) : null,
    risk_flag: d ? strOrNull(d.risk_flag) : null,
    binding_constraint: d ? strOrNull(d.binding_constraint) : null
  };
}

/**
 * B. 每 ETF Gen-1 反事实 ViewModel。
 * counterfactual.* 只读 decision_result.gen1_counterfactual_*，绝不回填 production。
 */
function buildEtfGen1({ code, sector, decision, signal, runtime } = {}) {
  const d = decision || null;
  const sig = signal || null;
  const authority = authorityFromRuntime(runtime);
  const status = deriveSignalStatus(d, sig);

  const rawProb = sig
    ? numberOrNull(sig.calibrated_probability != null ? sig.calibrated_probability : sig.ml_probability)
    : null;
  // UI-G1-08：NO_OPPORTUNITY / DEGRADED 不展示概率，绝不伪造 0% 胜率
  const showProb = [SIGNAL_STATUS.OBSERVED, SIGNAL_STATUS.CANDIDATE, SIGNAL_STATUS.BLOCKED].indexOf(status) >= 0;

  const domain = evaluateDomainPermission(
    (sig && (sig.category || sig.sector)) || sector || null, code || null);

  return {
    authority,
    status,
    signal: {
      stage: (d && (strOrNull(d.gen1_effective_stage) || strOrNull(d.trend_stage_primary)))
        || (sig && (strOrNull(sig.stage) || strOrNull(sig.stage_t))) || null,
      probability: showProb ? rawProb : null,
      threshold: d ? numberOrNull(d.gen1_model_threshold_p) : null,
      model_candidate: !!(d && d.gen1_model_candidate === true),
      signal_status: status
    },
    data: {
      health_status: sig ? strOrNull(sig.data_health_status) : null,
      source_trade_date: sig ? strOrNull(sig.source_trade_date || sig.date || sig.signal_date) : null,
      benchmark_latest_date: sig ? strOrNull(sig.benchmark_latest_date) : null
    },
    applicability: {
      domain_status: (sig && strOrNull(sig.domain_status)) || domain.status,
      domain_permission: (sig && strOrNull(sig.domain_permission)) || domain.permission,
      label: (sig && strOrNull(sig.domain_status_label))
        || (domain.status === 'IN_DOMAIN' ? '域内'
          : domain.status === 'PARTIAL_COVERAGE' ? '部分覆盖' : '域外'),
      message: (sig && strOrNull(sig.domain_status_message)) || domain.reason || null
    },
    safety: {
      permission: d ? strOrNull(d.ml_rule_permission) : null,
      reason_code: d ? strOrNull(d.ml_rule_permission_reason_code) : null,
      reason: d ? strOrNull(d.ml_rule_permission_reason) : null,
      source: (d && strOrNull(d.ml_rule_permission_source)) || 'SAFETY_CORE'
    },
    counterfactual: {
      target_pct: d ? pct(d.gen1_counterfactual_target) : null,
      suggested_pct: d ? pct(d.gen1_counterfactual_suggested_position) : null,
      delta_pct: d ? pct(d.gen1_counterfactual_delta) : null,
      stage_changed: !!(d && d.gen1_counterfactual_stage_changed === true),
      clamped: !!(d && d.gen1_counterfactual_clamped === true),
      baseline_floor_breached: !!(d && d.gen1_counterfactual_baseline_floor_breached === true)
    }
  };
}

/**
 * B. 每 ETF 统一 ViewModel：{ code, name, production, gen1 }。
 */
function buildEtfUiViewModel({ code, name, sector, decision, position, signal, runtime, actionLabel } = {}) {
  return {
    code: code || (decision && decision.code) || (position && position.code) || null,
    name: name || null,
    production: buildEtfProduction({ decision, position, runtime, actionLabel }),
    gen1: buildEtfGen1({ code, sector, decision, signal, runtime })
  };
}

/**
 * E. Review 行级 Gen-1 反事实字段（独立于生产字段，不作为“最终建议来源”）。
 */
function buildReviewGen1(decision) {
  const d = decision || null;
  if (!d) return null;
  const domain = evaluateDomainPermission(d.sector || null, d.code || null);
  return {
    authority: strOrNull(d.gen1_authority),
    signal_status: deriveSignalStatus(d, {
      calibrated_probability: d.gen1_model_probability,
      signal_status: d.gen1_model_candidate === true ? 'CANDIDATE' : null
    }),
    probability: numberOrNull(d.gen1_model_probability),
    baseline_suggested_pct: pct(d.suggested_position),
    counterfactual_suggested_pct: pct(d.gen1_counterfactual_suggested_position),
    delta_pct: pct(d.gen1_counterfactual_delta),
    domain_status: domain.status,
    safety_permission: strOrNull(d.ml_rule_permission)
  };
}

module.exports = {
  PRODUCTION_ENGINE_FALLBACK,
  SIGNAL_STATUS,
  authorityFromRuntime,
  buildSystemRuntime,
  buildHealthTruth,
  buildCanaryLedger,
  buildEtfProduction,
  buildEtfGen1,
  buildEtfUiViewModel,
  buildReviewGen1,
  deriveSignalStatus
};
