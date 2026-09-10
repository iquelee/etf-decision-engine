/**
 * Gen-1 Safety Core Permission（WP-G1 / G1-02）。
 *
 * 这是「Gen-1 能否行动」的唯一裁决点。它把原先混在一起的两种语义拆开：
 *
 *   eod_precheck  —— runGen1ShadowEod 在 EOD 阶段按「基线阶段 S2/S3」做的粗筛
 *                    （source = EOD_STAGE_PRECHECK），仅供信号行内部使用；
 *   safety        —— 本模块产出的最终许可（source = SAFETY_CORE），
 *                    额外复核 model_id / 信号新鲜度 / 风险熔断 / F5 / 结构破坏 / 数据健康 / 域许可。
 *
 * 主链（API / UI / canary）**必须**使用 `safety`，不得再用 eod_precheck 冒充最终许可。
 *
 * 语义：
 *   permission = 'PERMIT' | 'BLOCK' | null
 *     null 表示「不可用（unavailable）」：缺少信号/基线、信号过期、model_id 不符等
 *     —— 不可用一律 fail-closed，调用方按 BLOCK 处理。
 *
 * 纯函数；dataHealth / domainPermission 为可选外部输入（PR2 接入），缺省时按 UNKNOWN 处理，
 * 且 UNKNOWN 不阻断 ADVISORY（保持 PR1 可独立落地），但阻断 CANARY（fail closed）。
 *
 * @module gen1-safety-permission
 */
'use strict';

const { resolveAuthority, authorityAllows, AUTHORITY } = require('./gen1-authority');

const SAFETY_SOURCE = 'SAFETY_CORE';
const EOD_SOURCE = 'EOD_STAGE_PRECHECK';

function pick(v) {
  return v == null ? '' : String(v).trim();
}

function dayOnly(v) {
  return pick(v).slice(0, 10);
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
 * 计算 Gen-1 完整许可。
 *
 * @param {object} input
 * @param {object} input.params      param_config 合并结果（含 ml_* 开关）
 * @param {object} input.signal      ml_shadow_signal 行（可空）
 * @param {object} input.baseline    decision_result / V3.6.1 基线（可空）
 * @param {object} [input.risk]      { risk_override, risk_flag }
 * @param {object} [input.fundamental] { f_state }
 * @param {object} [input.snapshot]  { structural_break, hard_break }
 * @param {string} [input.today]     YYYY-MM-DD（默认取 signal.date）
 * @param {object} [input.dataHealth]      G1-05 输出（可选）
 * @param {object} [input.domainPermission] G1-06 输出（可选）
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

  const eod = makeResult(null, null, null);
  const safety = makeResult(null, null, null);
  const blocking = [];

  // ---- EOD precheck（沿用信号行内既有 rule_gate，若存在）----
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

  // ---- Safety Core（最终裁决；source 恒为 SAFETY_CORE）----
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

  // 1) 权限总闸：必须达到 ADVISORY 才可能 PERMIT
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
  // 5) 信号新鲜度（必须当日 EOD）
  if (dayOnly(signal.date || signal.signal_date) !== today) {
    return isUnavailable('SIGNAL_STALE', '不是当日 EOD 模型信号，等待收盘后更新');
  }
  // 6) EOD 预检不得为 BLOCK
  if (eod.permission === 'BLOCK') {
    return isBlocked(eod.reason_code || 'EOD_PRECHECK_BLOCK', eod.reason || 'EOD 阶段预检未通过');
  }
  // 7) 基线阶段必须属于 S2/S3 观察许可范围
  const baseStage = baselineStageOf(baseline);
  if (baseStage !== 'S2' && baseStage !== 'S3') {
    return isBlocked('BASELINE_STAGE_NOT_ELIGIBLE',
      `V3.6.1 基线阶段为 ${baseStage || '未知'}，不属于 S2/S3 观察许可范围`);
  }
  // 8) 硬风险熔断
  if (risk && (risk.risk_override === true || String(risk.risk_flag).toUpperCase() === 'RED')) {
    return isBlocked('HARD_RISK_OVERRIDE', 'Safety Core 风险熔断或硬风险覆盖生效');
  }
  // 9) 基本面 F5 证伪
  if (fundamental && String(fundamental.f_state).toUpperCase() === 'F5') {
    return isBlocked('FUNDAMENTAL_F5', '基本面 F5 证伪，禁止提前进攻');
  }
  // 10) 结构破坏 / Hard Break
  if (snapshot && (snapshot.structural_break === true || snapshot.hard_break === true)) {
    return isBlocked('STRUCTURAL_BREAK', '趋势结构破坏或 Hard Break 已触发');
  }

  safety.permission = 'PERMIT';
  safety.reason_code = 'SAFETY_CORE_PASS';
  safety.reason = 'Safety Core 通过；仍需模型达到 Fast Path 阈值及仓位约束后才形成建议';
  return finish();

  function finish() {
    const dataHealth = src.dataHealth || null;
    const domain = src.domainPermission || null;
    const dataStatus = dataHealth ? String(dataHealth.status || '').toUpperCase() : 'UNKNOWN';
    // 域许可归一化：优先取 domain.permission（G1-06 输出），否则由 status 映射。
    const DOMAIN_BY_STATUS = { IN_DOMAIN: 'ALLOW', PARTIAL_COVERAGE: 'CANARY_LIMITED', OUT_OF_DOMAIN: 'BLOCK_CANARY' };
    const domainStatus = domain ? String(domain.status || '').toUpperCase() : 'UNKNOWN';
    const domainPermission = domain
      ? String(domain.permission || DOMAIN_BY_STATUS[domainStatus] || 'UNKNOWN').toUpperCase()
      : 'UNKNOWN';

    // ADVISORY：safety PERMIT 且数据未 BLOCKED
    const advisoryBlockedByData = dataStatus === 'BLOCKED';
    const effectiveAdvisory = safety.permission === 'PERMIT' && !advisoryBlockedByData;
    // CANARY：safety PERMIT 且数据 OK 且域许可为 ALLOW/CANARY_LIMITED
    //         UNKNOWN（未接入）时 fail-closed 阻断 canary
    const canaryDataOk = dataStatus === 'OK';
    const canaryDomainOk = domainPermission === 'ALLOW' || domainPermission === 'CANARY_LIMITED'
      || domainPermission === 'CANARY_ALLOWED_WITH_WARNING';
    const effectiveCanary = safety.permission === 'PERMIT' && canaryDataOk && canaryDomainOk;

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
      data_health: dataHealth ? { status: dataHealth.status, reason_code: dataHealth.reason_code || null } : { status: 'UNKNOWN', reason_code: null },
      domain: domain
        ? { status: domain.status, permission: domain.permission, reason_code: domain.reason_code || null }
        : { status: 'UNKNOWN', permission: 'UNKNOWN', reason_code: null },
      effective_advisory: effectiveAdvisory,
      effective_canary: effectiveCanary,
      blocking_codes: blocking.slice()
    };
  }
}

module.exports = {
  SAFETY_SOURCE,
  EOD_SOURCE,
  evaluateGen1Permission,
  expectedModelId,
  baselineStageOf
};
