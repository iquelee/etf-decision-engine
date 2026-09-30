/**
 * 领域枚举（web/src/rewrite/domain/enums.js）
 * 规范依据：SPEC §3 / §5.1 / §7.3 / §9
 *
 * ⛔ 本模块只声明枚举与取值域，不含文案（文案在 labels.js）也不含阈值（thresholds.js）。
 */

/* ---------------- 动作 ---------------- */
export const ACTION = Object.freeze({
  WAIT: 'WAIT',
  BUILD: 'BUILD',
  ADD: 'ADD',
  HOLD: 'HOLD',
  TACTICAL_REDUCE: 'TACTICAL_REDUCE',
  STRATEGIC_REDUCE: 'STRATEGIC_REDUCE',
  EXIT: 'EXIT'
});
export const ACTION_VALUES = Object.freeze(Object.values(ACTION));

/* ---------------- 风险旗标 ---------------- */
export const RISK_FLAG = Object.freeze({ NORMAL: 'NORMAL', YELLOW: 'YELLOW', RED: 'RED' });
export const RISK_FLAG_VALUES = Object.freeze(Object.values(RISK_FLAG));

/* ---------------- 市场环境（后端为小写内部枚举） ---------------- */
export const MARKET_REGIME = Object.freeze({
  AGGRESSIVE: 'aggressive',
  STRUCTURAL: 'structural',
  RANGE: 'range',
  DEFENSIVE: 'defensive',
  CRISIS: 'crisis',
  RECOVERY: 'recovery'
});
export const MARKET_REGIME_VALUES = Object.freeze(Object.values(MARKET_REGIME));

/* ---------------- 六组状态码（W/D/H/V/F/C 各 1..5） ---------------- */
export const STATE_KINDS = Object.freeze(['W', 'D', 'H', 'V', 'F', 'C']);

/* ---------------- Gen-1 信号状态（与后端 SIGNAL_STATUS 逐字一致） ---------------- */
export const GEN1_SIGNAL_STATUS = Object.freeze({
  NO_OPPORTUNITY: 'NO_OPPORTUNITY',
  OBSERVED: 'OBSERVED',
  CANDIDATE: 'CANDIDATE',
  BLOCKED: 'BLOCKED',
  DEGRADED: 'DEGRADED'
});

/** Gen-1 在 UI 中的三段 stage（SPEC §6.2；⛔ 不得串位） */
export const GEN1_STAGE_SLOTS = Object.freeze(['signal', 'baseline', 'effective']);

/** Gen-1 authority 档位（唯一来源 = runtime_status.gen1_authority） */
export const GEN1_AUTHORITY = Object.freeze({
  ADVISORY: 'ADVISORY',
  CANARY: 'CANARY',
  PRODUCTION: 'PRODUCTION',
  OFF: 'OFF'
});

/* ---------------- Gen-2 角色（SPEC §3.2：Selection / Shadow / Research） ---------------- */
export const GEN2_ROLE = Object.freeze({
  CORE: 'CORE',
  CHALLENGER: 'CHALLENGER',
  SATELLITE: 'SATELLITE',
  RESERVE: 'RESERVE',
  HEDGE: 'HEDGE'
});
export const GEN2_ROLE_ORDER = Object.freeze(['CORE', 'CHALLENGER', 'SATELLITE', 'RESERVE', 'HEDGE']);

/* ---------------- 数据权威归属（provenance.authority） ---------------- */
export const AUTHORITY = Object.freeze({
  SAFETY_CORE: 'SAFETY_CORE',
  GEN1: 'GEN1',
  GEN2_SHADOW: 'GEN2_SHADOW',
  OPERATOR: 'OPERATOR',
  UNKNOWN: 'UNKNOWN'
});

/* ---------------- 数据可用性（SPEC §9 统一状态机） ---------------- */
export const FIELD_STATE = Object.freeze({
  /** 有真实数据 */
  PROVIDED: 'PROVIDED',
  /** 请求失败（网络 / 5xx） */
  ERROR: 'ERROR',
  /** 响应成功但字段不存在 */
  MISSING: 'MISSING',
  /** 契约整块未下发（后端未提供该能力） */
  UNAVAILABLE: 'UNAVAILABLE',
  /** 数据超过 SLA */
  STALE: 'STALE'
});

/** 缺失原因码（⛔ 不使用自由文本，便于测试断言） */
export const MISSING_REASON = Object.freeze({
  FIELD_ABSENT: 'FIELD_ABSENT',
  NULL_IN_CONTRACT: 'NULL_IN_CONTRACT',
  CONTRACT_NOT_PROVIDED: 'CONTRACT_NOT_PROVIDED',
  RUNTIME_STATUS_UNAVAILABLE: 'RUNTIME_STATUS_UNAVAILABLE',
  NO_BACKEND_CONTRACT: 'NO_BACKEND_CONTRACT'
});

/* ---------------- 生命周期维度（SPEC §7.1，6 个必须分开建模） ---------------- */
export const LIFECYCLE_DIM = Object.freeze({
  DEPLOYMENT: 'deployment',
  DEPLOYMENT_IDENTITY: 'deployment_identity',
  SOURCE_PARITY: 'source_parity',
  ACTIVATION_AUTHORIZATION: 'activation_authorization',
  FIRST_CONTROLLED_RUN: 'first_controlled_run',
  PROSPECTIVE_EPOCH: 'prospective_epoch',
  RUN_HISTORY: 'run_history',
  GENERAL_PRODUCTION: 'general_production'
});
export const LIFECYCLE_DIMS = Object.freeze(Object.values(LIFECYCLE_DIM));

/* ---------------- 数据新鲜度等级 ---------------- */
export const FRESHNESS = Object.freeze({
  FRESH: 'FRESH',
  STALE: 'STALE',
  MISSING: 'MISSING',
  UNAVAILABLE: 'UNAVAILABLE'
});

/* ---------------- 前/后台分区 ---------------- */
export const ZONE = Object.freeze({ FRONT: 'front', ADMIN: 'admin', AUTH: 'auth' });
