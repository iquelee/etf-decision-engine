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
 *   - stage 三拆（review-fix P0）：stages.signal = ml_shadow_signal.stage，
 *     stages.baseline = decision.v361_baseline_stage，stages.effective =
 *     decision.gen1_effective_stage；兼容字段 gen1.signal.stage 严格等于
 *     stages.signal，绝不冒充 effective；
 *   - canary 权限链三真值：authorized / health_allowed / active 独立下发（P1-1）；
 *   - Safety 阶段门（review-fix P0）：eod_stage / baseline_stage / binding_stage /
 *     binding_stage_source 四件套，禁止用一个模糊 stage 兜住 EOD 门与基线门；
 *   - 安全边界（review-fix P0-2）：production_write / production_fast_path_enabled /
 *     auto_execution **透传 runtime_status 真值**（缺失才 false），另给
 *     safety_invariant_ok 自检；禁止硬编码 false 把线上的违规藏起来；
 *   - engine 审计（review-fix P1-3）：production.engine = decision.engine_version
 *     （这条决策真实的产生者）；当前生产引擎只在 system_runtime.production.engine；
 *   - Gen-2 目前是静态契约，必须带 source=STATIC_CURRENT_CONTRACT，不得伪装 runtime 真相；
 *   - legacy 字段（ml_shadow / advisory_enabled / fast_path_enabled 等）一律
 *     deprecated，仅可展示，禁止用于权限判定（P1-2）。
 *
 * 纯函数、无 DB、无副作用：便于 Node 单测（tests/gen1-ui-contract.test.js）。
 *
 * @module gen1-ui-view-model
 */
'use strict';

const { AUTHORITY_LABEL } = require('./gen1-authority');
const { evaluateDomainPermission } = require('./gen1-domain-permission');

/** Gen-1 信号状态码（与前端既有枚举对齐） */
const SIGNAL_STATUS = Object.freeze({
  NO_OPPORTUNITY: 'NO_OPPORTUNITY',
  OBSERVED: 'OBSERVED',
  CANDIDATE: 'CANDIDATE',
  BLOCKED: 'BLOCKED',
  DEGRADED: 'DEGRADED'
});

/**
 * PR-UI-01 review-fix（P1-2）：历史兼容字段清单。
 * 这些字段只允许「展示/排错」，禁止用于权限、阶段、写权限的判定。
 * 判定当前运行权限只能使用 system_runtime / production / gen1 三块。
 */
const LEGACY_DEPRECATED_FIELDS = Object.freeze([
  'ml_shadow',
  'ml_shadow.ui_phase',
  'ml_shadow.production_permission',
  'ml_shadow.fast_path_enabled',
  'ml_shadow.advisory_enabled',
  'advisory_enabled',
  'fast_path_enabled'
]);

const LEGACY_NOTICE =
  '历史兼容字段（保留一轮，仅供展示/排错）：禁止用于权限或阶段判定；'
  + '真实运行权限只看 system_runtime / production / gen1。';

/**
 * legacy 兼容块的统一声明（dashboard / detail / admin health 共用一份定义，
 * 避免各接口各写一套文案形成新的双重真相）。
 */
function buildLegacyNotice() {
  return {
    deprecated: true,
    do_not_use_for_authority: true,
    note: LEGACY_NOTICE,
    fields: LEGACY_DEPRECATED_FIELDS.slice()
  };
}

/** 反事实 canary 未激活时的归因（只读 runtime_status 三布尔，不反推 ml_* 配置） */
function counterfactualInactiveReason(authorized, healthAllowed, active) {
  if (active) return null;
  if (!authorized) return 'NOT_AUTHORIZED';
  if (!healthAllowed) return 'HEALTH_NOT_ALLOWED';
  return 'OTHER_CONDITIONS';
}

/**
 * Safety 的「阶段门」归属（PR-UI-01 review-fix P0）。
 *
 * Safety 链里有两个**独立**的阶段门，必须分开表达，禁止用单一 signal stage 兜住全部：
 *   EOD Gate        → reason_code 以 `EOD_` 开头 → 卡在 EOD 预检阶段（= stages.signal）
 *   Baseline Gate   → `BASELINE_STAGE_NOT_ELIGIBLE` → 卡在 V3.6.1 基线阶段（= stages.baseline）
 *   其它非阶段门（风险 / 基本面 / 结构 / 数据 / 域 / 健康 / 权限 / 模型候选）→ null
 *
 * 真实反例（515880 / 2026-09-10）：signal=S3（EOD 预检 PERMIT）、baseline=S0，
 * Safety 实际因 BASELINE_STAGE_NOT_ELIGIBLE 在基线门被拦 —— 若把 binding stage 写成 S3，
 * 页面就会出现「因 baseline S0 拦截」与「评估阶段 S3」并存的矛盾。
 */
function resolveSafetyStageBinding(decision, signal, stages) {
  const st = stages || {};
  const code = String((decision && decision.ml_rule_permission_reason_code) || '').toUpperCase();
  if (code.indexOf('EOD_') === 0) {
    return {
      binding_stage: st.signal == null ? null : st.signal,
      binding_stage_source: (signal && strOrNull(signal.rule_permission_source)) || 'EOD_STAGE_PRECHECK'
    };
  }
  if (code === 'BASELINE_STAGE_NOT_ELIGIBLE') {
    return {
      binding_stage: st.baseline == null ? null : st.baseline,
      binding_stage_source: 'SAFETY_CORE_BASELINE_GATE'
    };
  }
  return { binding_stage: null, binding_stage_source: null };
}

/** 该决策真正的产生者（审计口径：历史决策不得显示当前生产引擎） */
function engineFromDecision(decision) {
  const v = decision ? strOrNull(decision.engine_version) : null;
  return { engine: v, engine_source: v ? 'DECISION_RESULT_ENGINE_VERSION' : 'UNKNOWN' };
}

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
  // PR-UI-01 review-fix（P1-1）：canary 权限链三项独立真值 —— 激活原因可归因
  const canaryAuthorized = rt ? rt.gen1_counterfactual_canary_authorized === true : false;
  const canaryHealthAllowed = rt ? rt.gen1_counterfactual_canary_health_allowed === true : false;
  const canaryActive = rt ? rt.gen1_counterfactual_canary_active === true : false;
  // PR-UI-01 review-fix（P0-2）：三条安全边界**必须透传 runtime_status 真值**，
  // 禁止硬编码 false —— 否则线上真的出现 production_write=true 时，UI 反而会把违规隐藏掉。
  // 安全不变量「期望」为 false，但展示必须说真话。
  const productionWrite = rt ? rt.gen1_production_write === true : false;
  const fastPathEnabled = rt ? rt.gen1_production_fast_path_enabled === true : false;
  const autoExecution = rt ? rt.gen1_auto_execution === true : false;
  // Gen-2：runtime_status 目前没有 Gen-2 Authority 字段，静态定义必须标明来源，
  // 不得让读者误以为 SHADOW 是从数据库读出的实时真值（Gen-2 Production 工作包再补 gen2_*）
  const gen2Mode = rt ? strOrNull(rt.gen2_mode) : null;
  return {
    production: {
      // 当前生产引擎（runtime_status 真值；读不到就是 null，不猜某个版本）
      engine: rt ? strOrNull(rt.production_engine) : null,
      engine_source: rt && strOrNull(rt.production_engine) ? 'RUNTIME_STATUS' : 'UNKNOWN',
      status: 'ACTIVE'
    },
    gen1: {
      authority,
      authority_label: authorityLabelOf(authority),
      health_status: rt ? strOrNull(rt.gen1_health_status) : null,
      health_gate_status: rt ? strOrNull(rt.gen1_health_gate_status) : null,
      health_source: rt ? strOrNull(rt.gen1_health_source) : null,
      safety_source: (rt && strOrNull(rt.gen1_safety_source)) || 'SAFETY_CORE',
      // canary 权限链：authorized → health_allowed → active（三者独立，禁止合并成一个布尔）
      counterfactual_authorized: canaryAuthorized,
      counterfactual_health_allowed: canaryHealthAllowed,
      counterfactual_active: canaryActive,
      counterfactual_inactive_reason: counterfactualInactiveReason(canaryAuthorized, canaryHealthAllowed, canaryActive),
      counterfactual_invocations: rt && numberOrNull(rt.gen1_counterfactual_canary_invocations) != null
        ? numberOrNull(rt.gen1_counterfactual_canary_invocations) : 0,
      ledger_ok: rt ? rt.gen1_counterfactual_ledger_ok === true : false,
      // 三条硬边界的 runtime 真值（不是常量）
      production_write: productionWrite,
      production_fast_path_enabled: fastPathEnabled,
      auto_execution: autoExecution,
      // 不变量自检：三者必须同时为 false，任一为 true 即报警（值为 false 时才是「正常」）
      safety_invariant_ok: !productionWrite && !fastPathEnabled && !autoExecution
    },
    gen2: {
      mode: gen2Mode || 'SHADOW',
      // 明确来源：当前契约里 SHADOW 是静态定义，不是 runtime 真相
      source: gen2Mode ? 'RUNTIME_STATUS' : 'STATIC_CURRENT_CONTRACT',
      production_write: rt && rt.gen2_production_write === true,
      production_write_source: rt && rt.gen2_production_write != null
        ? 'RUNTIME_STATUS' : 'STATIC_CURRENT_CONTRACT'
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
 *
 * engine 审计口径（review-fix）：production.engine = 这条决策**自己的** engine_version，
 * 不是「当前生产引擎」（后者只在 system_runtime.production.engine）。
 * 这样引擎升级到 v4 之后回看 2026-09-10 的历史决策，仍显示 v3.6.1。
 */
function buildEtfProduction({ decision, position, runtime, actionLabel } = {}) {
  const d = decision || null;
  const pos = position || null;
  const eng = engineFromDecision(d);
  return {
    engine: eng.engine,
    engine_source: eng.engine_source,
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

  // PR-UI-01 review-fix（P0）：三种 stage 必须分开表达，禁止互相冒充。
  //   signal    = ml_shadow_signal.stage        模型真正评估时的 EOD stage
  //   baseline  = decision.v361_baseline_stage  V3.6.1 基线 stage
  //   effective = decision.gen1_effective_stage Safety / Canary 之后的 effective stage
  // 背景：513310(2026-09-10) 实际是 signal=S0（EOD 预检按 S0 判 BLOCK），
  // baseline/effective=S1；旧实现把 signal.stage 填成 effective，导致
  // 「Stage S1」与「Safety：当前阶段 S0 不符合条件」同时出现。
  const stages = {
    signal: sig ? strOrNull(sig.stage) : null,
    baseline: d ? strOrNull(d.v361_baseline_stage) : null,
    effective: d ? strOrNull(d.gen1_effective_stage) : null
  };
  // Safety 的「阶段门」归属（review-fix P0）：EOD 门 / 基线门 / 非阶段门 三态
  const binding = resolveSafetyStageBinding(d, sig, stages);

  return {
    authority,
    status,
    stages,
    signal: {
      // 兼容字段：严格等于 stages.signal，绝不冒充 stages.effective
      stage: stages.signal,
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
      source: (d && strOrNull(d.ml_rule_permission_source)) || 'SAFETY_CORE',
      // 阶段门明细（review-fix P0）：哪个门拦的、用的是哪个 stage，一次说清
      eod_stage: stages.signal,
      baseline_stage: stages.baseline,
      binding_stage: binding.binding_stage,
      binding_stage_source: binding.binding_stage_source
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
 *
 * PR-UI-01 review-fix：补齐分层，使 Review 可直接渲染
 *   生产决策 | Gen-1 反事实 | 实际操作
 * 而不再从旧平铺字段拼装。gen1 块永远不含最终建议语义字段（final_action /
 * final_target / action_code 等）；
 * 平铺字段（counterfactual_suggested_pct / delta_pct / signal_status）保留一轮兼容。
 * 注：Review 行不联 ml_shadow_signal 表，故 stages.signal 恒为 null（不猜测、不用其它 stage 顶替）。
 */
function buildReviewGen1(decision) {
  const d = decision || null;
  if (!d) return null;
  const domain = evaluateDomainPermission(d.sector || null, d.code || null);
  const status = deriveSignalStatus(d, {
    calibrated_probability: d.gen1_model_probability,
    signal_status: d.gen1_model_candidate === true ? 'CANDIDATE' : null
  });
  return {
    authority: strOrNull(d.gen1_authority),
    status,
    signal_status: status,   // 兼容别名：严格等于 status
    probability: numberOrNull(d.gen1_model_probability),
    stages: {
      signal: null,          // Review 行无信号联表，明确 null 而非顶替
      baseline: strOrNull(d.v361_baseline_stage),
      effective: strOrNull(d.gen1_effective_stage)
    },
    baseline_suggested_pct: pct(d.suggested_position),
    counterfactual: {
      target_pct: pct(d.gen1_counterfactual_target),
      suggested_pct: pct(d.gen1_counterfactual_suggested_position),
      delta_pct: pct(d.gen1_counterfactual_delta),
      stage_changed: d.gen1_counterfactual_stage_changed === true,
      clamped: d.gen1_counterfactual_clamped === true,
      baseline_floor_breached: d.gen1_counterfactual_baseline_floor_breached === true
    },
    // 兼容平铺（一轮）：等价于 counterfactual.*
    counterfactual_suggested_pct: pct(d.gen1_counterfactual_suggested_position),
    delta_pct: pct(d.gen1_counterfactual_delta),
    domain_status: domain.status,
    safety_permission: strOrNull(d.ml_rule_permission)
  };
}

module.exports = {
  SIGNAL_STATUS,
  LEGACY_DEPRECATED_FIELDS,
  LEGACY_NOTICE,
  authorityFromRuntime,
  buildLegacyNotice,
  buildSystemRuntime,
  buildHealthTruth,
  buildCanaryLedger,
  buildEtfProduction,
  buildEtfGen1,
  buildEtfUiViewModel,
  buildReviewGen1,
  counterfactualInactiveReason,
  engineFromDecision,
  resolveSafetyStageBinding,
  deriveSignalStatus
};
