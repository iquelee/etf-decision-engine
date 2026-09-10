/**
 * Gen-1 前台视图模型。
 *
 * 这里刻意不参与任何交易、仓位、模型或风控计算：它只把已有的
 * decision_result + ml_shadow_signal 压缩成面向人工决策的稳定语义。
 * 原始 V3.6.1 / Shadow 字段继续由调用方保留在 audit 中，兼容旧接口。
 */
'use strict';

const STATUS = Object.freeze({
  NO_OPPORTUNITY: 'NO_OPPORTUNITY',
  OBSERVED: 'OBSERVED',
  CANDIDATE: 'CANDIDATE',
  FAST_PATH_ACTIVE: 'FAST_PATH_ACTIVE',
  BLOCKED: 'BLOCKED',
  DATA_STALE: 'DATA_STALE',
  EOD_PENDING: 'EOD_PENDING',
  DEGRADED: 'DEGRADED',
  ML_OFF: 'ML_OFF'
});

const ACTION_TEXT = Object.freeze({
  WAIT: '继续等待，不建仓',
  BUILD: '分步建仓',
  ADD: '适度增加',
  HOLD: '继续持有，暂不加仓',
  TACTICAL_REDUCE: '适度减持',
  STRATEGIC_REDUCE: '防守减持',
  EXIT: '退出'
});

const CONSTRAINT_LABELS = Object.freeze({
  etf_max: '单只 ETF 仓位上限',
  sector_cap: '科技板块仓位上限',
  correlation_cap: '相关性约束',
  portfolio_risk_cap: '组合风险上限',
  cash_floor: '现金安全垫',
  defense_cap_s7: '趋势防守上限'
});

function numberOrNull(v) {
  return v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
}

function pct(v) {
  const n = numberOrNull(v);
  return n == null ? null : Math.round(n * 10) / 10;
}

function permissionLabel(permission) {
  const p = String(permission || '').toUpperCase();
  if (p === 'PERMIT' || p === 'ALLOW' || p === 'PASS') return '允许';
  if (p === 'BLOCK' || p === 'BLOCKED' || p === 'FORBID') return '阻止';
  return p ? '待确认' : '暂无模型许可';
}

function statusMeta(ml) {
  if (!ml || ml.enabled !== true) {
    return { code: STATUS.ML_OFF, label: 'Gen-1 暂停', message: '趋势启动增强当前未启用', tone: 'muted' };
  }
  // 盘中上一交易日的 EOD 信号仍有效；不要误报为模型异常或无期限等待。
  if (ml.is_stale === true && Number(ml.data_age_days) === 1) {
    return {
      code: STATUS.EOD_PENDING,
      label: '上一交易日信号有效',
      message: '等待今日收盘后更新 EOD 模型信号',
      tone: 'muted'
    };
  }
  // is_stale 优先于历史 raw status：过期是数据新鲜度问题，不是模型故障。
  if (ml.is_stale === true || ml.has_signal_row === false) {
    return { code: STATUS.DATA_STALE, label: '数据待更新', message: '等待最新有效的 EOD 模型信号', tone: 'warn' };
  }
  // G1.1-01：快速通道已触发 —— 必须 model_candidate 为真（Safety PERMIT ≠ 模型触发）
  if (ml.advisory_effective === true && ml.model_candidate === true) {
    return { code: STATUS.FAST_PATH_ACTIVE, label: '快速通道已触发', message: 'Gen-1 已给出趋势启动增强建议', tone: 'good' };
  }
  const raw = String(ml.signal_status || '').toUpperCase();
  if (raw === STATUS.CANDIDATE) return { code: STATUS.CANDIDATE, label: '快速通道候选', message: '模型信号已达到候选条件，等待安全约束确认', tone: 'primary' };
  if (raw === STATUS.BLOCKED) return { code: STATUS.BLOCKED, label: '机会存在 · 风险规则阻止', message: '模型发现机会，但风险或组合约束尚未放行', tone: 'bad' };
  if (raw === STATUS.OBSERVED) {
    // 规则允许但模型未触发（P 未达阈值）→ 明确表述为观察，不得提示「已触发」
    if (ml.advisory_effective === true && ml.model_candidate !== true) {
      return { code: STATUS.OBSERVED, label: '观察中 · 模型未触发', message: 'Safety Core 已允许，但模型概率尚未达到触发阈值', tone: 'primary' };
    }
    return { code: STATUS.OBSERVED, label: '观察中', message: '趋势正在观察，尚未达到快速通道条件', tone: 'primary' };
  }
  if (raw === STATUS.DEGRADED) {
    return {
      code: STATUS.DEGRADED,
      label: 'EOD 信号降级',
      message: ml.signal_status_reason || '该日 EOD 模型信号不可用，请检查任务运行记录。',
      tone: 'warn'
    };
  }
  return { code: STATUS.NO_OPPORTUNITY, label: '暂无机会', message: '当前暂无趋势启动机会，继续等待', tone: 'muted' };
}

function buildGen1ViewModel({ ml, decision, position } = {}) {
  const status = statusMeta(ml);
  const actionCode = (decision && (decision.gen1_advisory_action || decision.final_action || decision.action)) || 'WAIT';
  const currentPct = pct(position && position.current_position);
  const executionTargetPct = pct(decision && decision.suggested_position);
  const executionDeltaPct = currentPct != null && executionTargetPct != null
    ? Math.round((executionTargetPct - currentPct) * 10) / 10 : null;
  const isActive = status.code === STATUS.FAST_PATH_ACTIVE;
  const gen1Target = isActive
    ? pct(decision && (decision.gen1_advisory_target != null ? decision.gen1_advisory_target : decision.final_target))
    : null;
  const binding = decision && decision.binding_constraint ? decision.binding_constraint : null;
  // 概率保留模型原精度；仓位字段才按 0.1pct 展示。
  const rawProbability = numberOrNull(ml && (ml.calibrated_probability != null ? ml.calibrated_probability : ml.probability));
  const showProbability = [STATUS.OBSERVED, STATUS.CANDIDATE, STATUS.FAST_PATH_ACTIVE, STATUS.BLOCKED].indexOf(status.code) >= 0
    && rawProbability != null;

  let targetLabel = '暂无新目标仓位';
  if (gen1Target != null) targetLabel = `${gen1Target}%`;
  else if (currentPct != null && ['HOLD', 'WAIT'].indexOf(actionCode) >= 0) targetLabel = `维持当前 ${currentPct}%`;

  return {
    status,
    advisory: {
      action_code: actionCode,
      action_label: ACTION_TEXT[actionCode] || actionCode,
      source: isActive ? 'GEN1_FAST_PATH' : 'SAFETY_CORE_MAINTENANCE',
      target_pct: gen1Target,
      target_label: targetLabel,
      current_pct: currentPct,
      execution_target_pct: executionTargetPct,
      delta_pct: executionDeltaPct,
      message: status.message
    },
    signal: {
      state: status.code,
      probability: showProbability ? rawProbability : null,
      show_probability: showProbability,
      fast_path: isActive ? '已触发'
        : (status.code === STATUS.CANDIDATE ? '候选'
          : (status.code === STATUS.BLOCKED ? '被规则阻止' : '未触发')),
      signal_date: ml && ml.signal_date ? ml.signal_date : null,
      source_trade_date: ml && ml.source_trade_date ? ml.source_trade_date : null
    },
    applicability: {
      category: ml && ml.category ? ml.category : null,
      domain_status: ml && ml.domain_status ? ml.domain_status : 'OUT_OF_DOMAIN',
      label: ml && ml.domain_status_label ? ml.domain_status_label : '域外',
      message: ml && ml.domain_status_message
        ? ml.domain_status_message
        : '缺少类别覆盖记录；概率仅供观察。',
      observed_folds: ml && ml.category_coverage && ml.category_coverage.observed_folds != null
        ? ml.category_coverage.observed_folds : null,
      total_folds: ml && ml.category_coverage && ml.category_coverage.total_folds != null
        ? ml.category_coverage.total_folds : null
    },
    capability: ml && ml.model_capability ? ml.model_capability : null,
    risk: {
      permission: ml && ml.permission ? String(ml.permission).toUpperCase() : null,
      permission_label: permissionLabel(ml && ml.permission),
      permission_reason: ml && ml.rule_permission_reason ? ml.rule_permission_reason : null,
      permission_source: ml && ml.rule_permission_source ? ml.rule_permission_source : null,
      risk_flag: decision && decision.risk_flag ? decision.risk_flag : null,
      binding_constraint: binding,
      binding_label: binding ? (CONSTRAINT_LABELS[binding] || binding) : '无额外限制'
    },
    // WP-G1（G1-10）：Gen-1 生产就绪可观测性 —— 一眼看懂权限 / 健康 / 双目标
    system: {
      model_id: ml && ml.model_id ? ml.model_id : null,
      authority: (ml && ml.gen1_authority) || (decision && decision.gen1_authority) || null,
      authority_label: (ml && ml.gen1_authority_label) || null,
      frozen_status: ml && ml.gen1_frozen === false ? 'NOT_FROZEN' : 'FROZEN_VERIFIED',
      bundle_id: ml && ml.bundle_id ? ml.bundle_id : null,
      bundle_hash: (ml && ml.bundle_hash) || (ml && ml.feature_schema_hash) || null,
      feature_schema_hash: ml && ml.feature_schema_hash ? ml.feature_schema_hash : null,
      // WP-G1.2 G1.2-01：健康唯一真相 = 运行时持久化 latch（decision 侧）；
      // signal 侧 gen1_health_status 只是「信号生成时刻的审计快照」，单列展示，不得冒充实时权限。
      health_status: (decision && decision.gen1_health_status) || (ml && ml.gen1_health_status) || null,
      health_source: (decision && decision.gen1_health_source) || null,
      health_gate_status: (decision && decision.gen1_health_gate_status) || null,
      health_manual_review_required: !!(decision && decision.gen1_health_manual_review_required),
      health_economic_status: (decision && decision.gen1_health_economic_status) || null,
      health_read_reason_code: (decision && decision.gen1_health_read_reason_code) || null,
      signal_health_snapshot: (ml && ml.gen1_health_status) || null,
      data_health_status: (ml && ml.data_health_status) || null,
      data_health_reason_code: (ml && ml.data_health_reason_code) || null,
      data_freshness_days: ml && ml.data_age_days != null ? ml.data_age_days : null,
      signal_date: ml && ml.signal_date ? ml.signal_date : null,
      expected_trade_date: (ml && ml.expected_trade_date) || (ml && ml.source_trade_date) || null,
      domain_status: ml && ml.domain_status ? ml.domain_status : null,
      domain_permission: (ml && ml.domain_permission) || null,
      // 两个硬边界：生产写 / 自动交易恒 false
      production_write: false,
      auto_execution: false,
      execution_label: '自动交易：关闭'
    },
    // 生产目标 vs Canary 目标（必须一眼可区分）
    // WP-G1.3 G1.3-01：canary_target_pct 展示**组合一致**后的反事实目标（账本实际采用值）；
    // canary_intent_pct 是 Gen-1 的单只「意图」——二者在共享 tech cap 下可能不同。
    targets: {
      production_target_pct: pct(decision && decision.final_target),
      baseline_stage: (decision && (decision.v361_baseline_stage || decision.baseline_stage)) || (ml && ml.baseline_stage) || null,
      baseline_target_pct: decision && decision.v361_baseline_target != null
        ? pct(decision.v361_baseline_target) : pct(decision && decision.final_target),
      effective_stage: (decision && (decision.gen1_effective_stage || decision.effective_stage)) || null,
      canary_target_pct: decision && decision.gen1_counterfactual_target != null
        ? pct(decision.gen1_counterfactual_target)
        : (decision && decision.gen1_canary_target != null ? pct(decision.gen1_canary_target) : null),
      canary_intent_pct: decision && decision.gen1_canary_target != null ? pct(decision.gen1_canary_target) : null,
      canary_delta_pct: decision && decision.gen1_counterfactual_delta != null
        ? pct(decision.gen1_counterfactual_delta) : null,
      canary_effective: !!(decision && decision.gen1_canary_effective === true),
      canary_eligible: !!(decision && decision.gen1_canary_eligible === true),
      // 组合约束（共享 cap）导致目标低于 baseline —— 组合所致，非模型/规则降级
      counterfactual_clamped: !!(decision && decision.gen1_counterfactual_clamped === true),
      counterfactual_baseline_floor_breached: !!(decision && decision.gen1_counterfactual_baseline_floor_breached === true)
    },
    audit: {
      model_id: ml && ml.model_id ? ml.model_id : null,
      model_state: ml && ml.signal_status ? ml.signal_status : null,
      is_stale: !!(ml && ml.is_stale),
      data_age_days: ml && ml.data_age_days != null ? ml.data_age_days : null,
      feature_schema_hash: ml && ml.feature_schema_hash ? ml.feature_schema_hash : null,
      decision_hash: ml && ml.decision_hash ? ml.decision_hash : null,
      bundle_id: ml && ml.bundle_id ? ml.bundle_id : null,
      raw_probability: ml && ml.probability != null ? ml.probability : null,
      calibrated_probability: ml && ml.calibrated_probability != null ? ml.calibrated_probability : null,
      signal_status_reason: ml && ml.signal_status_reason ? ml.signal_status_reason : null,
      signal_run_id: ml && ml.signal_run_id ? ml.signal_run_id : null,
      counterfactual_target_pct: ml && ml.counterfactual_target_pct != null ? ml.counterfactual_target_pct : null,
      v361_baseline: {
        stage: decision && (decision.v361_baseline_stage || decision.baseline_stage) || (ml && ml.baseline_stage) || null,
        target_pct: decision && decision.v361_baseline_target != null ? decision.v361_baseline_target : (ml && ml.baseline_target_pct),
        action: decision && (decision.v361_baseline_action || decision.baseline_action) || null
      }
    }
  };
}

module.exports = { STATUS, ACTION_TEXT, CONSTRAINT_LABELS, buildGen1ViewModel };
