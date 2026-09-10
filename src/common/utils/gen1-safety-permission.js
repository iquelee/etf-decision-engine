/**
 * Gen-1 Safety Core Permission（WP-G1 G1-02 + WP-G1.1 G1.1-01）。
 *
 * 唯一裁决点。三层语义严格分层，**不得互相替代**：
 *
 *   model_candidate  —— 模型层：Gen-1 是否真的「触发了」。
 *                       必须 stage==S2（v1 严格 S2 only）+ ml_fast==true
 *                       + calibrated_probability >= frozen signal_p + model_id 精确匹配。
 *   safety           —— 规则层：Safety Core 是否放行（风险/F5/结构/阶段/数据/域/健康）。
 *                       **Safety PERMIT 只表示「规则允许」，绝不等于「模型触发」。**
 *   effective_*      —— 合成层：model_candidate AND safety AND 数据/域/健康/authority。
 *
 * 关键不变量：
 *   - 概率低于阈值（如 S2 + P=0.12）即使 Safety PERMIT，也不得 advisory/canary。
 *   - ml_fast=false 但 P>=阈值 → 信号自相矛盾，fail-closed（BLOCK）。
 *   - effective_canary 额外要求 authority >= CANARY（PRODUCTION 永久锁定）。
 *
 * 纯函数；不 require DB。阈值由调用方传入（`thresholdSignalP`，默认 0.65，与 frozen-manifest 一致）。
 *
 * @module gen1-safety-permission
 */
'use strict';

const { resolveAuthority, authorityAllows, AUTHORITY } = require('./gen1-authority');

const SAFETY_SOURCE = 'SAFETY_CORE';
const EOD_SOURCE = 'EOD_STAGE_PRECHECK';
/** Gen-1 v1 严格限定 S2（不得因 Safety 支持 S3 而隐式扩大模型生产域）。 */
const MODEL_STAGES = Object.freeze(['S2']);
const DEFAULT_THRESHOLD_P = 0.65;

function pick(v) {
  return v == null ? '' : String(v).trim();
}

function dayOnly(v) {
  return pick(v).slice(0, 10);
}

function num(v) {
  return v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
}

/** 默认冻结 model_id 兜底（与 GEN1_IMMUTABLE_LOCK / frozen-manifest 一致）。 */
function expectedModelId(params) {
  return pick(params && params.ml_challenger_model_id) || 'HVT-A-ET-20260830';
}

function signalModelId(signal) {
  return pick(signal && (signal.ml_model_id || signal.model_id));
}

function baselineStageOf(baseline) {
  return pick(baseline && (baseline.trend_stage_primary || baseline.trend_stage
    || baseline.v361_baseline_stage || baseline.baseline_stage || baseline.stage)).toUpperCase();
}

function makeResult(permission, code, reason) {
  return { permission: permission, reason_code: code, reason: reason };
}

/**
 * 计算 Gen-1 完整许可（含 model_candidate）。
 *
 * @param {object} input
 * @param {object} input.params      param_config 合并结果
 * @param {object} input.signal      ml_shadow_signal 行（含 ml_fast / calibrated_probability / stage）
 * @param {object} input.baseline    V3.6.1 基线
 * @param {number} [input.thresholdSignalP] frozen signal_p（默认 0.65）
 * @param {object} [input.risk] / [input.fundamental] / [input.snapshot]
 * @param {string} [input.today]
 * @param {object} [input.dataHealth] / [input.domainPermission] / [input.healthGate]
 */
function evaluateGen1Permission(input) {
  const src = input || {};
  const params = src.params || {};
  const signal = src.signal || null;
  const baseline = src.baseline || null;
  const risk = src.risk || null;
  const fundamental = src.fundamental || null;
  const snapshot = src.snapshot || null;
  const today = dayOnly(src.today || (signal && (signal.date || signal.signal_date)));
  const authority = resolveAuthority(params);
  const threshold = num(src.thresholdSignalP) != null ? num(src.thresholdSignalP) : DEFAULT_THRESHOLD_P;

  const eod = makeResult(null, null, null);
  const safety = makeResult(null, null, null);
  const blocking = [];

  // ---- EOD precheck（信号行内既有 rule_gate）----
  const rawGate = pick(signal && (signal.rule_gate || signal.permission || signal.permission_class)).toUpperCase();
  if (rawGate === 'BLOCK' || rawGate === 'BLOCKED' || rawGate === 'FORBID') {
    eod.permission = 'BLOCK';
    eod.reason_code = pick(signal.rule_permission_reason_code) || 'EOD_STAGE_NOT_ELIGIBLE';
    eod.reason = pick(signal.rule_permission_reason) || 'EOD 阶段预检未通过';
  } else if (rawGate === 'PERMIT' || rawGate === 'ALLOW' || rawGate === 'PASS') {
    eod.permission = 'PERMIT';
    eod.reason_code = pick(signal.rule_permission_reason_code) || 'EOD_STAGE_PRECHECK_PASS';
    eod.reason = pick(signal.rule_permission_reason) || 'EOD 阶段预检通过';
  }

  const isUnavailable = (code, reason) => {
    safety.permission = null;
    safety.reason_code = code;
    safety.reason = reason;
    return finish();
  };
  const isBlocked = (code, reason) => {
    safety.permission = 'BLOCK';
    safety.reason_code = code;
    safety.reason = reason;
    blocking.push(code);
    return finish();
  };

  // ---- Safety Core 链 ----
  // 1) 权限总闸
  if (!authorityAllows(authority.gen1_authority, 'ADVISORY')) {
    return isBlocked('GEN1_AUTHORITY_NOT_ADVISORY',
      `Gen-1 权限 ${authority.gen1_authority} 未达到人工建议级别`);
  }
  // 2) 配置闸
  if (params.ml_shadow_observe !== true || params.ml_advisory_enabled !== true || params.ml_fast_path_enabled !== true) {
    return isBlocked('GEN1_ADVISORY_DISABLED', 'Gen-1 观察或人工建议开关当前关闭');
  }
  // 3) 信号 / 基线存在性
  if (!signal || !baseline || !today) {
    return isUnavailable('SIGNAL_OR_BASELINE_MISSING', '缺少当日模型信号或 V3.6.1 基线');
  }
  // 4) model_id 精确匹配
  if (signalModelId(signal) !== expectedModelId(params)) {
    return isUnavailable('MODEL_ID_MISMATCH', '模型版本与当前冻结配置不一致');
  }
  // 5) 信号新鲜度
  if (dayOnly(signal.date || signal.signal_date) !== today) {
    return isUnavailable('SIGNAL_STALE', '不是当日 EOD 模型信号，等待收盘后更新');
  }
  // 6) EOD 预检
  if (eod.permission === 'BLOCK') {
    return isBlocked(eod.reason_code || 'EOD_PRECHECK_BLOCK', eod.reason || 'EOD 阶段预检未通过');
  }
  // 7) 基线阶段必须属于 S2/S3 观察许可范围（Safety 层）
  const baseStage = baselineStageOf(baseline);
  const signalStage = pick(signal.stage || signal.stage_t || baseStage).toUpperCase();
  if (baseStage !== 'S2' && baseStage !== 'S3') {
    return isBlocked('BASELINE_STAGE_NOT_ELIGIBLE',
      `V3.6.1 基线阶段为 ${baseStage || '未知'}，不属于 S2/S3 观察许可范围`);
  }
  // 8) 硬风险熔断
  if (risk && (risk.risk_override === true || String(risk.risk_flag).toUpperCase() === 'RED')) {
    return isBlocked('HARD_RISK_OVERRIDE', 'Safety Core 风险熔断或硬风险覆盖生效');
  }
  // 9) 基本面 F5
  if (fundamental && String(fundamental.f_state).toUpperCase() === 'F5') {
    return isBlocked('FUNDAMENTAL_F5', '基本面 F5 证伪，禁止提前进攻');
  }
  // 10) 结构破坏
  if (snapshot && (snapshot.structural_break === true || snapshot.hard_break === true)) {
    return isBlocked('STRUCTURAL_BREAK', '趋势结构破坏或 Hard Break 已触发');
  }

  // ---- 11) Model Candidate Gate（G1.1-01，P0）----
  const probability = num(signal.calibrated_probability != null ? signal.calibrated_probability : signal.ml_probability);
  const mlFast = signal.ml_fast === true;
  const probabilityOk = probability != null && probability >= threshold;
  const modelChecks = {
    stage_s2_only: MODEL_STAGES.indexOf(signalStage) >= 0,
    ml_fast_true: mlFast,
    probability_ge_threshold: probabilityOk,
    model_id_exact: signalModelId(signal) === expectedModelId(params)
  };
  // 信号自相矛盾（ml_fast=false 但概率已达阈值）→ fail-closed
  if (probabilityOk && !mlFast) {
    return isBlocked('MODEL_SIGNAL_INCONSISTENT',
      `信号自相矛盾：calibrated_probability=${probability} >= ${threshold} 但 ml_fast=false`);
  }
  const modelCandidate = Object.keys(modelChecks).every((k) => modelChecks[k] === true);

  safety.permission = 'PERMIT';
  safety.reason_code = 'SAFETY_CORE_PASS';
  safety.reason = modelCandidate
    ? 'Model Candidate 成立且 Safety Core 通过；仍需数据/域/健康/权限门合成'
    : 'Safety Core 通过（规则允许），但 Model Candidate 未成立（模型未触发）';
  return finish(modelChecks, modelCandidate, probability);

  function finish(modelChecks, modelCandidate, probabilityIn) {
    const checks = modelChecks || {
      stage_s2_only: false, ml_fast_true: false, probability_ge_threshold: false, model_id_exact: false
    };
    const candidate = modelCandidate === true;
    const dataHealth = src.dataHealth || null;
    const domain = src.domainPermission || null;
    // 词表归一化：DATA_OK/DEGRADED/BLOCKED 与 OK/DEGRADED/BLOCKED 等价
    const dataStatus = dataHealth
      ? String(dataHealth.status || '').toUpperCase().replace(/^DATA_/, '')
      : 'UNKNOWN';
    const DOMAIN_BY_STATUS = { IN_DOMAIN: 'ALLOW', PARTIAL_COVERAGE: 'CANARY_LIMITED', OUT_OF_DOMAIN: 'BLOCK_CANARY' };
    const domainStatus = domain ? String(domain.status || '').toUpperCase() : 'UNKNOWN';
    const domainPermission = domain
      ? String(domain.permission || DOMAIN_BY_STATUS[domainStatus] || 'UNKNOWN').toUpperCase()
      : 'UNKNOWN';

    // WP-G1.2 G1.2-01：healthGate **只**接受 healthStateToGate()（持久化 latch）产出。
    // ml_shadow_signal.gen1_health_status 仅作审计快照（src.signalHealthSnapshot），不参与授权。
    const hg = src.healthGate || null;
    const healthAllowsAdvisory = !hg || hg.allow_advisory !== false;
    const healthAllowsCanary = !hg || hg.allow_canary !== false;
    const healthEnvelope = hg ? {
      status: hg.health != null ? hg.health : (hg.latched_health || null),
      latched_health: hg.latched_health != null ? hg.latched_health : null,
      gate_status: hg.gate_status || 'ACTIVE',
      source: hg.source || 'GEN1_HEALTH_STATE_LATCH',
      allow_advisory: hg.allow_advisory !== false,
      allow_canary: hg.allow_canary !== false,
      allow_gen1_timing: hg.allow_gen1_timing !== false,
      manual_review_required: hg.manual_review_required === true,
      economic_health: hg.economic_health || 'PENDING',
      runtime_data_health: hg.runtime_data_health || 'UNKNOWN',
      read_reason_code: hg.read_reason_code || null
    } : null;

    const safetyPass = safety.permission === 'PERMIT';
    const dataNotBlocked = dataStatus !== 'BLOCKED';
    const dataOk = dataStatus === 'OK';
    const domainOk = domainPermission === 'ALLOW' || domainPermission === 'CANARY_LIMITED'
      || domainPermission === 'CANARY_ALLOWED_WITH_WARNING';
    const authorityCanary = authorityAllows(authority.gen1_authority, 'CANARY_OVERRIDE');

    const effectiveAdvisory = candidate && safetyPass && dataNotBlocked && healthAllowsAdvisory;
    const effectiveCanary = candidate && safetyPass && dataOk && domainOk && healthAllowsCanary && authorityCanary;

    const modelReason = candidate ? null
      : (!checks.stage_s2_only ? 'STAGE_NOT_S2'
        : (!checks.ml_fast_true ? 'ML_FAST_FALSE'
          : (!checks.probability_ge_threshold ? 'PROBABILITY_BELOW_THRESHOLD' : 'MODEL_ID_NOT_EXACT')));

    return {
      authority,
      eod_precheck: {
        permission: eod.permission,
        reason_code: eod.reason_code,
        reason: eod.reason,
        source: EOD_SOURCE
      },
      safety: {
        permission: safety.permission,
        reason_code: safety.reason_code,
        reason: safety.reason,
        source: SAFETY_SOURCE
      },
      model: {
        model_candidate: candidate,
        checks,
        reason_code: modelReason,
        probability: probabilityIn == null ? null : probabilityIn,
        threshold_signal_p: threshold,
        ml_fast: checks.ml_fast_true,
        stage: baselineStageOf(baseline) || null
      },
      data_health: dataHealth ? { status: dataHealth.status, reason_code: dataHealth.reason_code || null } : { status: 'UNKNOWN', reason_code: null },
      domain: domain
        ? { status: domain.status, permission: domain.permission, reason_code: domain.reason_code || null }
        : { status: 'UNKNOWN', permission: 'UNKNOWN', reason_code: null },
      effective_advisory: effectiveAdvisory,
      effective_canary: effectiveCanary,
      // WP-G1.2 G1.2-01：实时权限健康（唯一真相 = 持久化 latch）
      health: healthEnvelope,
      gen1_health_status: hg ? (hg.health != null ? hg.health : (hg.latched_health || null)) : null,
      // 审计快照：信号生成当时的健康（**不**参与授权，仅用于对比/追溯）
      signal_health_snapshot: src.signalHealthSnapshot != null ? src.signalHealthSnapshot : null,
      blocking_codes: blocking.slice()
    };
  }
}

module.exports = {
  SAFETY_SOURCE,
  EOD_SOURCE,
  MODEL_STAGES,
  DEFAULT_THRESHOLD_P,
  evaluateGen1Permission,
  expectedModelId,
  baselineStageOf
};
