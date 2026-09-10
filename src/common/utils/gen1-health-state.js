/**
 * Gen-1 持久化健康状态 / 熔断 latch（WP-G1.1 / G1.1-03+04；WP-G1.2 / G1.2-01+02）。
 *
 * 背景（复审 P0-3）：原实现用进程内 `let _lastHealth`，在 CloudBase Serverless
 * 冷启动后归零 → 「DEGRADED/ML_OFF 须人工恢复」不可靠。
 *
 * 现改为**持久化 latch**（集合 `gen1_health_state`，单文档 key='gen1-health-state'）。
 *
 * === WP-G1.2 G1.2-02：读取三态 + Fail-Closed（本轮 P0）===
 * 原实现把任何读取异常都吞成 `defaultHealthState()`（latched = OK）——
 * 即「DB 异常 → Gen-1 健康 = OK」，与整个 WP-G1 的 Fail-Closed 原则冲突。
 *
 * 现在明确区分三种读取结果（`read_status`）：
 *   FOUND           正常读到持久化文档        → 用文档内容，gate_status = ACTIVE
 *   NOT_INITIALIZED 首次运行、文档尚不存在    → PENDING：允许 ADVISORY，**禁止 CANARY**，不落库
 *   READ_ERROR      DB 查询抛错（网络/权限/集合缺失）→ ML_OFF：全链 fail-closed，不落库
 *
 * **绝不**把异常当成 OK。`writeHealthState` 对 `persist_allowed === false` 的状态
 * 直接跳过 upsert（读异常时不得用伪造状态覆盖真实 latch）。
 *
 * === WP-G1.2 G1.2-01：唯一真相 ===
 * 运行时权限链**只能**消费 `healthStateToGate()` 的产出（gate_status / allow_*）。
 * `ml_shadow_signal.gen1_health_status` 只是「信号生成时刻的审计快照」，不得再拥有实时权限。
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
const HEALTH_SOURCE = 'GEN1_HEALTH_STATE_LATCH';

const READ_STATUS = Object.freeze({
  FOUND: 'FOUND',
  NOT_INITIALIZED: 'NOT_INITIALIZED',
  READ_ERROR: 'READ_ERROR'
});

const GATE_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  PENDING: 'PENDING',
  READ_ERROR: 'READ_ERROR'
});

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
    read_status: READ_STATUS.FOUND,
    read_reason_code: null,
    persist_allowed: true,
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
 * @returns {{state: object, recovery_applied: boolean, recovery_rejected: boolean, persisted: boolean}}
 */
function computeLatchedState(prevState, incomingHealth, opts) {
  const o = opts || {};
  const now = o.now || new Date().toISOString();

  // G1.2-02：读取异常 → fail-closed，禁止用伪造 OK 覆盖持久化 latch
  if (prevState && prevState.read_status === READ_STATUS.READ_ERROR) {
    const state = Object.assign(defaultHealthState(), {
      current_health: HEALTH.ML_OFF,
      latched_health: HEALTH.ML_OFF,
      manual_review_required: true,
      ml_off_at: prevState.ml_off_at || now,
      runtime_data_health: HEALTH.ML_OFF,
      read_status: READ_STATUS.READ_ERROR,
      read_reason_code: prevState.read_reason_code || 'HEALTH_STATE_READ_ERROR',
      persist_allowed: false,
      updated_at: now
    });
    return { state, recovery_applied: false, recovery_rejected: false, persisted: false };
  }

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

  state.read_status = READ_STATUS.FOUND;
  state.read_reason_code = null;
  state.persist_allowed = true;

  return { state, recovery_applied: recoveryApplied, recovery_rejected: recoveryRejected, persisted: true };
}

/**
 * 由持久化状态导出运行时门（WP-G1.2 起为**唯一**权限真相入口）。
 *
 * gate_status 语义：
 *   ACTIVE      正常：健康门按 latched_health 生效
 *   PENDING     首次未初始化：allow_canary 强制 false（ADVISORY 不受影响）
 *   READ_ERROR  DB 异常：等同 ML_OFF，回退纯 V3.6.1
 */
function healthStateToGate(state) {
  const s = Object.assign(defaultHealthState(), state || {});
  const readStatus = s.read_status || READ_STATUS.FOUND;

  if (readStatus === READ_STATUS.READ_ERROR) {
    return Object.assign(circuitGate(HEALTH.ML_OFF), {
      source: HEALTH_SOURCE,
      gate_status: GATE_STATUS.READ_ERROR,
      latched_health: HEALTH.ML_OFF,
      manual_review_required: true,
      economic_health: s.economic_health || 'UNKNOWN',
      runtime_data_health: s.runtime_data_health || 'UNKNOWN',
      read_reason_code: s.read_reason_code || 'HEALTH_STATE_READ_ERROR'
    });
  }

  const initialized = readStatus !== READ_STATUS.NOT_INITIALIZED;
  const gate = circuitGate(s.latched_health);
  return Object.assign({}, gate, {
    source: HEALTH_SOURCE,
    gate_status: initialized ? GATE_STATUS.ACTIVE : GATE_STATUS.PENDING,
    // 首次未初始化：ADVISORY 可继续（不阻断生产观察），但 Canary 一律关闭
    allow_canary: initialized ? gate.allow_canary : false,
    latched_health: s.latched_health,
    manual_review_required: s.manual_review_required === true,
    economic_health: s.economic_health || 'PENDING',
    runtime_data_health: s.runtime_data_health || 'UNKNOWN',
    read_reason_code: initialized ? null : 'HEALTH_STATE_NOT_INITIALIZED'
  });
}

/**
 * 从 DB 读取健康状态（WP-G1.2 G1.2-02：三态，绝不把异常当 OK）。
 *
 * @returns {Promise<object>} 状态对象，带 `read_status` ∈ {FOUND, NOT_INITIALIZED, READ_ERROR}
 *   - READ_ERROR 时附加 `persist_allowed = false`，调用方写入会被跳过。
 */
async function readHealthState(db, collections) {
  const col = (collections && collections.GEN1_HEALTH_STATE) || 'gen1_health_state';
  try {
    const rows = await db.query(col, { key: HEALTH_STATE_KEY }, { limit: 1 });
    if (rows && rows[0]) {
      return Object.assign(defaultHealthState(), rows[0], {
        read_status: READ_STATUS.FOUND,
        read_reason_code: null,
        persist_allowed: true
      });
    }
    return Object.assign(defaultHealthState(), {
      read_status: READ_STATUS.NOT_INITIALIZED,
      read_reason_code: 'HEALTH_STATE_NOT_INITIALIZED',
      persist_allowed: false
    });
  } catch (e) {
    return Object.assign(defaultHealthState(), {
      read_status: READ_STATUS.READ_ERROR,
      read_reason_code: 'HEALTH_STATE_READ_ERROR',
      read_error: String((e && e.message) || e),
      persist_allowed: false,
      current_health: HEALTH.ML_OFF,
      latched_health: HEALTH.ML_OFF,
      manual_review_required: true,
      runtime_data_health: HEALTH.ML_OFF
    });
  }
}

/**
 * 写回健康状态。`persist_allowed === false` → **不落库**（只返回只读视图），
 * 防止「读取异常」被伪造成一个新的健康真相。
 */
async function writeHealthState(db, state, collections) {
  const col = (collections && collections.GEN1_HEALTH_STATE) || 'gen1_health_state';
  const doc = Object.assign(defaultHealthState(), state || {}, { key: HEALTH_STATE_KEY });
  const persistAllowed = doc.persist_allowed !== false;
  const readStatus = doc.read_status || READ_STATUS.FOUND;
  delete doc.persist_allowed;
  delete doc.read_status;

  if (!persistAllowed) {
    return Object.assign({}, doc, {
      read_status: READ_STATUS.READ_ERROR,
      read_reason_code: (state && state.read_reason_code) || 'HEALTH_STATE_READ_ERROR',
      persist_allowed: false
    });
  }

  const stored = Object.assign({}, doc);
  await db.upsert(col, stored, { key: HEALTH_STATE_KEY });
  return Object.assign({}, doc, { read_status: readStatus, read_reason_code: null, persist_allowed: true });
}

module.exports = {
  HEALTH_STATE_KEY,
  HEALTH_SOURCE,
  DOWN_STATES,
  READ_STATUS,
  GATE_STATUS,
  defaultHealthState,
  computeLatchedState,
  healthStateToGate,
  readHealthState,
  writeHealthState,
  computeHealthStatus
};
