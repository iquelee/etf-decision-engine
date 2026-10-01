/**
 * 常量与运行时状态适配器（web/src/rewrite/adapters/constants.js）
 * 规范依据：SPEC §7.2 / §12
 *
 * ★ 版本口径（owner 裁定）：引擎/配置版本**只从 `/api/constants` 读**，
 *   ⛔ 前端零硬编码（旧前端硬编码 `V3.6.1`，与生产身份冲突，见审计 §4.12）。
 *
 * ⚠️ 标签类常量由后端下发（单一事实源）。本适配器**只做形状归一**，
 *   ⛔ 不在此处做「后端没给就用本地值顶上」——缺失就报缺失（SPEC §9）。
 *   本地兜底文案属于 `domain/labels.js` 的**独立**能力，由 UI 决定是否启用。
 */
import { unavailable, readField, readBlock, provenance } from '../domain/provenance.js';
import { FIELD_STATE, MISSING_REASON, AUTHORITY } from '../domain/enums.js';

const SRC = 'api:/api/constants';
const P = provenance({ source: SRC, authority: AUTHORITY.OPERATOR });

const LABEL_KEYS = Object.freeze([
  'w_state_labels', 'd_state_labels', 'h_state_labels', 'v_state_labels',
  'f_state_labels', 'c_state_labels', 'action_labels', 'risk_flag_labels',
  'sectors', 'etf_names'
]);

export function adaptConstants(data) {
  const empty = !data || typeof data !== 'object';
  const labels = {};
  for (const k of LABEL_KEYS) {
    labels[k] = empty
      ? unavailable(MISSING_REASON.CONTRACT_NOT_PROVIDED, P)
      : readBlock(data, k, provenance({ source: SRC + '.' + k, authority: AUTHORITY.OPERATOR }));
  }

  const rs = empty ? null : data.runtime_status;

  return Object.freeze({
    available: !empty,
    /** 版本：仅此来源（⛔ 前端不得硬编码） */
    engineVersion: readField(data, 'engine_version', P),
    labels: Object.freeze(labels),
    runtimeStatus: adaptRuntimeStatus(rs)
  });
}

/**
 * `runtime_status` → 运行时状态领域对象。
 * ★ 这里**只做原样透传**；边界字段组与生命周期维度分别由
 *   `domain/lifecycle.js` 的 `readBoundaryFields()` / `readLifecycle()` 处理。
 */
export function adaptRuntimeStatus(rs) {
  const P0 = provenance({ source: SRC + '.runtime_status', authority: AUTHORITY.OPERATOR });
  if (!rs || typeof rs !== 'object') {
    return Object.freeze({
      available: false,
      reason: MISSING_REASON.RUNTIME_STATUS_UNAVAILABLE,
      raw: null,
      updatedAt: unavailable(MISSING_REASON.RUNTIME_STATUS_UNAVAILABLE, P0)
    });
  }
  return Object.freeze({
    available: true,
    raw: rs,
    updatedAt: readField(rs, 'updated_at', P0),
    productionEngine: readField(rs, 'production_engine', P0),
    configVersion: readField(rs, 'config_version', P0),
    decisionDate: readField(rs, 'decision_date', P0),
    shadowEngine: readField(rs, 'shadow_engine', P0),
    stageEngine: readField(rs, 'stage_engine', P0),
    mlModelId: readField(rs, 'ml_model_id', P0),
    gen1Authority: readField(rs, 'gen1_authority', P0),
    gen1AuthorityLabel: readField(rs, 'gen1_authority_label', P0),
    gen1HealthStatus: readField(rs, 'gen1_health_status', P0),
    gen1HealthGateStatus: readField(rs, 'gen1_health_gate_status', P0),
    gen1SafetySource: readField(rs, 'gen1_safety_source', P0),
    trendStageEnabled: readField(rs, 'trend_stage_enabled', P0)
  });
}

export { FIELD_STATE };
