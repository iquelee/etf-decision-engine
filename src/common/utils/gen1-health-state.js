/**
 * Gen-1 持久化健康状态 / 熔断 latch（WP-G1.1 / G1.1-03 + G1.1-04）。
 *
 * 背景（复审 P0-3）：原实现用进程内 `let _lastHealth`，在 CloudBase Serverless
 * 冷启动后归零 → 「DEGRADED/ML_OFF 须人工恢复」不可靠。
 *
 * 现改为**持久化 latch**（集合 `gen1_health_state`，单文档 key='gen1-health-state'）：
 *   current_health          本轮算出的即时健康
 *   latched_health          对外的权威健康（含 latch 效果）
 *   manual_review_required  是否需要人工复核（latched 处于 DEGRADED/ML_OFF）
 *   degraded_at / ml_off_at 进入降级/停用时间
 *   reviewed_at / reviewed_by 人工复核记录
 *   recovery_allowed        是否已允许恢复
 *   economic_health         经济健康（G1.1-04，样本不足 = PENDING）
 *   runtime_data_health     数据健康（运行时）
 *
 * 规则（fail-closed）：
 *   - latched ∈ {DEGRADED, ML_OFF} → 只有 `manualReviewConfirmed === true` 才允许升回 OK/WARNING；
 *     否则保持 latch（recovery_rejected）。
 *   - 冷启动不影响：状态从 DB 读，不从进程内存读。
 *
 * 纯函数为主（computeLatchedState / healthStateToGate），DB 读写为薄封装。
 *
 * @module gen1-health-state
 */
'use strict';

const { HEALTH, HEALTH_RANK, circuitGate, computeHealthStatus } = require('./gen1-circuit-breaker');

const HEALTH_STATE_KEY = 'gen1-health-state';
const DOWN_STATES = Object.freeze([HEALTH.DEGRADED, HEALTH.ML_OFF]);

function defaultHealthState() {
  return {
    key: HEALTH_STATE_KEY,
    current_health: HEALTH.OK,
    latched_health: HEALTH.OK,
    manual_review_required: false,
    degraded_at: null,
    ml_off_at: null,
    reviewed_at: null,
    reviewed_by: null,
    recovery_allowed: false,
    runtime_data_health: 'UNKNOWN',
    economic_health: 'PENDING',
    economic: null,
    updated_at: null
  };
}

function isDown(health) {
  return DOWN_STATES.indexOf(health) >= 0;
}

function worse(a, b) {
  return (HEALTH_RANK[a] || 0) >= (HEALTH_RANK[b] || 0) ? a : b;
}

/**
 * 由「上一持久化状态 + 本轮即时健康」计算新状态（含 latch 与人工复核）。
 *
 * @param {object} prevState 之前持久化的状态（可为 null → 用默认）
 * @param {string} incomingHealth 本轮 computeHealthStatus 结果
 * @param {object} [opts]
 * @param {boolean} [opts.manualReviewConfirmed] 人工复核是否已确认
 * @param {string}  [opts.reviewedBy]
 * @param {string}  [opts.now] ISO 时间
 * @param {object}  [opts.economic] G1.1-04 经济健康结果
 * @param {string}  [opts.runtimeDataHealth]
 * @returns {{state: object, recovery_applied: boolean, recovery_rejected: boolean}}
 */
function computeLatchedState(prevState, incomingHealth, opts) {
  const o = opts || {};
  const now = o.now || new Date().toISOString();
  const prev = Object.assign(defaultHealthState(), prevState || {});
  const incoming = HEALTH_RANK.hasOwnProperty(incomingHealth) ? incomingHealth : HEALTH.ML_OFF;

  const prevLatched = HEALTH_RANK.hasOwnProperty(prev.latched_health) ? prev.latched_health : HEALTH.OK;
  const wasDown = isDown(prevLatched);
  const nowUp = !isDown(incoming);

  const state = Object.assign({}, prev, {
    key: HEALTH_STATE_KEY,
    current_health: incoming,
    updated_at: now
  });
  if (o.runtimeDataHealth != null) state.runtime_data_health = o.runtimeDataHealth;
  if (o.economic != null) {
    state.economic = o.economic;
    state.economic_health = o.economic.status || 'PENDING';
  }

  let recoveryApplied = false;
  let recoveryRejected = false;

  if (wasDown && nowUp) {
    if (o.manualReviewConfirmed === true) {
      state.latched_health = incoming;
      state.manual_review_required = false;
      state.recovery_allowed = true;
      state.reviewed_at = now;
      state.reviewed_by = o.reviewedBy || 'manual';
      state.degraded_at = null;
      state.ml_off_at = null;
      recoveryApplied = true;
    } else {
      // 禁止 auto reopen：保持 latch
      state.latched_health = prevLatched;
      state.manual_review_required = true;
      state.recovery_allowed = false;
      recoveryRejected = true;
    }
  } else if (wasDown && !nowUp) {
    // 仍在下行：取更差者，保持 latch
    state.latched_health = worse(prevLatched, incoming);
    state.manual_review_required = true;
    state.recovery_allowed = false;
  } else {
    state.latched_health = incoming;
    state.manual_review_required = isDown(incoming);
    state.recovery_allowed = false;
  }

  if (state.latched_health === HEALTH.DEGRADED) {
    state.degraded_at = state.degraded_at || now;
  }
  if (state.latched_health === HEALTH.ML_OFF) {
    state.ml_off_at = state.ml_off_at || now;
  }
  if (!isDown(state.latched_health)) {
    state.degraded_at = null;
    state.ml_off_at = null;
  }

  return { state, recovery_applied: recoveryApplied, recovery_rejected: recoveryRejected };
}

/** 由持久化状态导出运行时门（唯一消费入口）。 */
function healthStateToGate(state) {
  const s = Object.assign(defaultHealthState(), state || {});
  const gate = circuitGate(s.latched_health);
  return Object.assign({}, gate, {
    latched_health: s.latched_health,
    manual_review_required: s.manual_review_required === true,
    economic_health: s.economic_health || 'PENDING',
    runtime_data_health: s.runtime_data_health || 'UNKNOWN'
  });
}

/** 从 DB 读取健康状态（缺失 → 默认 OK）。 */
async function readHealthState(db, collections) {
  const col = (collections && collections.GEN1_HEALTH_STATE) || 'gen1_health_state';
  try {
    const rows = await db.query(col, { key: HEALTH_STATE_KEY }, { limit: 1 });
    return (rows && rows[0]) ? rows[0] : defaultHealthState();
  } catch (e) {
    return defaultHealthState();
  }
}

/** 写回健康状态。 */
async function writeHealthState(db, state, collections) {
  const col = (collections && collections.GEN1_HEALTH_STATE) || 'gen1_health_state';
  const doc = Object.assign(defaultHealthState(), state || {}, { key: HEALTH_STATE_KEY });
  await db.upsert(col, doc, { key: HEALTH_STATE_KEY });
  return doc;
}

module.exports = {
  HEALTH_STATE_KEY,
  DOWN_STATES,
  defaultHealthState,
  computeLatchedState,
  healthStateToGate,
  readHealthState,
  writeHealthState,
  computeHealthStatus
};
