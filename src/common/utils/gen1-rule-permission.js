/** Gen-1 Fast Path rule permission: Safety Core metadata only. */
'use strict';

function gen1RulePermission(params, signal, baseline, risk, fundamental, snapshot, today) {
  const blocked = (reason_code, reason_label) => ({ permission: 'BLOCK', reason_code, reason_label, source: 'SAFETY_CORE' });
  const unavailable = (reason_code, reason_label) => ({ permission: null, reason_code, reason_label, source: 'SIGNAL' });
  if (params.ml_shadow_observe !== true || params.ml_advisory_enabled !== true || params.ml_fast_path_enabled !== true) {
    return blocked('GEN1_ADVISORY_DISABLED', 'Gen-1 人工建议或快速通道当前关闭');
  }
  if (!signal || !baseline || !today) return unavailable('SIGNAL_OR_BASELINE_MISSING', '缺少当日模型信号或 V3.6.1 基线');
  if (String(signal.date || '').slice(0, 10) !== String(today).slice(0, 10)) return unavailable('SIGNAL_STALE', '不是当日 EOD 模型信号，等待收盘后更新');
  if (String(signal.ml_model_id || signal.model_id || '') !== String(params.ml_challenger_model_id || 'HVT-A-ET-20260830')) {
    return unavailable('MODEL_ID_MISMATCH', '模型版本与当前冻结配置不一致');
  }
  if (String(signal.rule_gate || signal.permission || '').toUpperCase() === 'BLOCK') {
    return blocked(signal.rule_permission_reason_code || 'EOD_PRECHECK_BLOCK', signal.rule_permission_reason || 'EOD 阶段预检未通过');
  }
  const baseStage = String(baseline.trend_stage_primary || baseline.trend_stage || '').toUpperCase();
  if (baseStage !== 'S2' && baseStage !== 'S3') return blocked('BASELINE_STAGE_NOT_ELIGIBLE', `V3.6.1 基线阶段为 ${baseStage || '未知'}，不属于 S2/S3 观察许可范围`);
  if (risk && (risk.risk_override === true || risk.risk_flag === 'RED')) return blocked('HARD_RISK_OVERRIDE', 'Safety Core 风险熔断或硬风险覆盖生效');
  if (fundamental && fundamental.f_state === 'F5') return blocked('FUNDAMENTAL_F5', '基本面 F5 证伪，禁止提前进攻');
  if (snapshot && (snapshot.structural_break === true || snapshot.hard_break === true)) return blocked('STRUCTURAL_BREAK', '趋势结构破坏或 Hard Break 已触发');
  return { permission: 'PERMIT', reason_code: 'SAFETY_CORE_PASS', reason_label: 'Safety Core 通过；仍需模型达到 Fast Path 阈值及仓位约束后才形成建议', source: 'SAFETY_CORE' };
}

module.exports = { gen1RulePermission };
