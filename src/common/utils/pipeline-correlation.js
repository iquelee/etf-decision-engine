/**
 * V3.6.5 P-4 —— Pipeline Correlation & Observability（**纯函数契约，未接线生产**）
 *
 * ── 本轮裁定 ──────────────────────────────────────────────────────────
 *   `P4_DESIGN = CORRELATION_AND_OBSERVABILITY_ONLY`
 *   ⛔ RETRY = NO · ⛔ TIMEOUT_CHANGE = NO · ⛔ MATERIALIZE_CONTROL_FLOW_CHANGE = NO
 *   ⛔ caller timeout **不得**自动重试 `runDecisionEngine`
 *
 * ── 要解决的问题（OBS-001）────────────────────────────────────────────
 *   `materializeIndicators` 的返回体出现过 `chained:{error:"ESOCKETTIMEDOUT"}`，
 *   但下游 `runDecisionEngine` **实际完整执行且成功**（5/5 ETF 落库正常）。
 *   即：**TRANSPORT OUTCOME ≠ BUSINESS EXECUTION OUTCOME**。
 *   目标：让「caller 超时 + 下游成功」这件事可以被**结构化表达**，
 *   而不是靠时间窗口 + 函数名人工拼接。
 *
 * ── 三组 ID 必须分开（任务书 §10）────────────────────────────────────
 *   `pipeline_run_id`  整条任务链身份           ← 本模块
 *   `engine_run_id`    一次 decision-engine candidate 身份   ← P-3 的 run_id
 *   `active_run_id`    当前 authoritative dataset            ← P-3 的 pointer
 *   ⛔ 不得把三者混成一个（有可执行守卫 `assertDistinctIdentities`）。
 *
 * 纯函数模块：无 I/O、无网络、无数据库、无时钟依赖（时间戳仅作**诊断字段**，不参与身份）。
 */
'use strict';

/* ------------------------------------------------------------------ *
 * 状态模型（任务书 §5）
 * ------------------------------------------------------------------ */

const TRANSPORT_STATUS = Object.freeze({
  CALL_STARTED: 'CALL_STARTED',
  CALL_RETURNED: 'CALL_RETURNED',
  CALL_TIMEOUT: 'CALL_TIMEOUT',
  CALL_ERROR: 'CALL_ERROR'
});

const BUSINESS_STATUS = Object.freeze({
  NOT_OBSERVED: 'NOT_OBSERVED',
  RUNNING: 'RUNNING',
  COMPLETE: 'COMPLETE',
  PARTIAL: 'PARTIAL',
  FAILED: 'FAILED'
});

const TRANSPORT_TERMINAL = Object.freeze([
  TRANSPORT_STATUS.CALL_RETURNED,
  TRANSPORT_STATUS.CALL_TIMEOUT,
  TRANSPORT_STATUS.CALL_ERROR
]);

/** 链路起点类型 —— 手动调用也必须有明确来源 */
const ORIGIN = Object.freeze({
  TIMER: 'timer',      // 平台定时器（TRIGGER_TIMER）
  CHAIN: 'chain',      // 上游云函数链式调用（TCB_API）
  MANUAL: 'manual',    // 管理后台 / 人工触发
  UNKNOWN: 'unknown'   // 无法判定（⛔ 不猜）
});

/** 传输层超时的可选错误码/文案（分类用，⛔ 不用于判定业务结果） */
const TIMEOUT_MARKERS = Object.freeze([
  'ESOCKETTIMEDOUT',
  'ESOCKETTIMEOUT',
  'ETIMEDOUT',
  'TIMEOUT',
  'ERR_SOCKET_TIMEOUT'
]);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isDate(v) { return typeof v === 'string' && DATE_RE.test(v); }

/* ------------------------------------------------------------------ *
 * pipeline 身份（任务书 §4）
 * ------------------------------------------------------------------ */

/**
 * 身份成分（规范化）。**单一真相**：key 与 run_id 都由它派生，避免两处规则漂移。
 * ⛔ 成分里**不含 wall-clock**。
 */
function identityComponents(input) {
  const i = input || {};
  return {
    expected_trade_date: isDate(i.expected_trade_date) ? i.expected_trade_date : null,
    origin: i.origin != null ? String(i.origin) : ORIGIN.UNKNOWN,
    entry_function: i.entry_function != null ? String(i.entry_function) : 'UNKNOWN_ENTRY',
    source_detail: (i.source_detail != null && String(i.source_detail) !== '') ? String(i.source_detail) : '-'
  };
}

/**
 * 稳定逻辑身份：**不含 wall-clock**。
 * 同一 (expected_trade_date, origin, entry_function, source_detail) ⇒ 同一 key，
 * ⇒ 重试可被识别为「同一条 pipeline 的再次执行」而不是新的独立决策。
 */
function canonicalPipelineKey(input) {
  const c = identityComponents(input);
  return `pl|${c.expected_trade_date || 'UNKNOWN_DATE'}|${c.origin}|${c.entry_function}|${c.source_detail}`;
}

/**
 * 构建 pipeline 身份。
 * 同时返回规范化后的**成分字段**，供 caller/callee 记录直接继承
 * （避免下游记录遗漏 origin / entry_function 而退化成 unknown）。
 *
 * @param {object} input { expected_trade_date, origin, entry_function, source_detail, attempt }
 * @returns {object} { pipeline_key, attempt, pipeline_run_id, identity_basis,
 *                     expected_trade_date, origin, entry_function, source_detail }
 */
function buildPipelineIdentity(input) {
  const i = input || {};
  const c = identityComponents(i);
  const key = canonicalPipelineKey(i);
  const rawAttempt = Number(i.attempt);
  const attempt = Number.isFinite(rawAttempt) && rawAttempt >= 1 ? Math.floor(rawAttempt) : 1;
  return {
    pipeline_key: key,
    attempt,
    pipeline_run_id: `${key}#a${attempt}`,
    identity_basis: 'expected_trade_date+origin+entry_function(+source_detail)+attempt（⛔ 不含 wall-clock）',
    expected_trade_date: c.expected_trade_date,
    origin: c.origin,
    entry_function: c.entry_function,
    source_detail: c.source_detail
  };
}

/** 从 pipeline_run_id 反解 attempt（用于 retry 识别） */
function parsePipelineRunId(pipelineRunId) {
  const s = pipelineRunId == null ? '' : String(pipelineRunId);
  const m = /#a(\d+)$/.exec(s);
  const parts = s.split('|');
  if (!m || parts.length < 5 || parts[0] !== 'pl') {
    return { valid: false, pipeline_key: null, attempt: null };
  }
  // ⚠️ 末段带 `#aN` 后缀 ⇒ 必须剥掉，否则 source_detail 会被污染
  const detail = parts.slice(4).join('|').replace(/#a\d+$/, '');
  return {
    valid: true,
    pipeline_key: `pl|${parts[1]}|${parts[2]}|${parts[3]}|${detail}`,
    attempt: Number(m[1]),
    expected_trade_date: parts[1],
    origin: parts[2],
    entry_function: parts[3],
    source_detail: detail
  };
}

/* ------------------------------------------------------------------ *
 * 记录构造
 * ------------------------------------------------------------------ */

/**
 * 构建 caller 侧的调用记录（transport 维度）。
 * `started_at` 仅作**诊断**，不参与身份判定。
 */
function buildCallRecord(input) {
  const i = input || {};
  const identity = i.identity || buildPipelineIdentity(i);
  // 成分优先取显式入参；缺省时**继承 identity**（避免退化成 unknown）
  return {
    record_type: 'pipeline_call',
    pipeline_run_id: identity.pipeline_run_id,
    pipeline_key: identity.pipeline_key,
    attempt: identity.attempt,
    origin: i.origin != null ? String(i.origin) : (identity.origin || ORIGIN.UNKNOWN),
    entry_function: i.entry_function != null ? String(i.entry_function)
      : (identity.entry_function && identity.entry_function !== 'UNKNOWN_ENTRY' ? identity.entry_function : null),
    source_detail: identity.source_detail && identity.source_detail !== '-' ? identity.source_detail : null,
    caller_function: i.caller_function != null ? String(i.caller_function) : null,
    caller_request_id: i.caller_request_id != null ? String(i.caller_request_id) : null,
    callee_function: i.callee_function != null ? String(i.callee_function) : null,
    // 下游自己的 request id 由「下游自证」回填（caller 在 timeout 场景下拿不到）
    callee_request_id: null,
    expected_trade_date: isDate(i.expected_trade_date) ? i.expected_trade_date
      : (isDate(identity.expected_trade_date) ? identity.expected_trade_date : null),
    input_hash: i.input_hash != null ? String(i.input_hash) : null,
    engine_run_id: null,          // 由下游自证回填（P-3 的 run_id）
    transport_status: TRANSPORT_STATUS.CALL_STARTED,
    business_status: BUSINESS_STATUS.NOT_OBSERVED,
    started_at: i.started_at != null ? i.started_at : null,
    completed_at: null,
    timeout_ms: Number.isFinite(Number(i.timeout_ms)) ? Number(i.timeout_ms) : null,
    error_code: null,
    error_message: null
  };
}

/** 把一次传输层异常分类为 CALL_TIMEOUT 或 CALL_ERROR（**只看传输层**） */
function classifyTransportError(err) {
  const e = err || {};
  const code = e.code != null ? String(e.code) : (e.errCode != null ? String(e.errCode) : '');
  const msg = e.message != null ? String(e.message)
    : (e.errMsg != null ? String(e.errMsg) : (typeof err === 'string' ? err : ''));
  const blob = `${code} ${msg}`.toUpperCase();
  const isTimeout = TIMEOUT_MARKERS.some((t) => blob.includes(t));
  return {
    transport_status: isTimeout ? TRANSPORT_STATUS.CALL_TIMEOUT : TRANSPORT_STATUS.CALL_ERROR,
    error_code: code || null,
    error_message: msg || null
  };
}

/**
 * 结算一次调用的 **transport** 状态。
 *
 * ⛔ 硬约束：settlement **不得**携带 `business_status` ——
 *    业务结果必须由下游**自证**单独记录；否则就是「用传输结果推断业务结果」。
 */
function settleTransport(record, settlement) {
  const s = settlement || {};
  if (!record || typeof record !== 'object') throw new Error('settleTransport: record 必填');
  if (s.business_status != null) {
    throw new Error('FORBIDDEN_INFERENCE: transport 结算不得携带 business_status（业务结果必须由下游自证）');
  }
  if (!TRANSPORT_TERMINAL.includes(s.transport_status)) {
    throw new Error(`settleTransport: transport_status 必须是终态之一 ${JSON.stringify(TRANSPORT_TERMINAL)}`);
  }
  return Object.assign({}, record, {
    transport_status: s.transport_status,
    completed_at: s.completed_at != null ? s.completed_at : null,
    error_code: s.error_code || null,
    error_message: s.error_message || null,
    callee_request_id: s.callee_request_id != null ? String(s.callee_request_id) : (record.callee_request_id || null),
    engine_run_id: s.engine_run_id != null ? String(s.engine_run_id) : (record.engine_run_id || null)
  });
}

/**
 * 构建**下游自证**的业务观测（business 维度）。
 *
 * 这是「caller 超时后仍能知道下游最终业务状态」的唯一可靠机制：
 * 下游在**自己这一侧**写一条带 `pipeline_run_id` 的完成记录，
 * 之后任何人（含已放弃等待的 caller）都能按 id 回查。
 */
function buildBusinessObservation(input) {
  const i = input || {};
  const identity = i.identity || buildPipelineIdentity(i);
  return {
    record_type: 'pipeline_business_observation',
    pipeline_run_id: identity.pipeline_run_id,
    pipeline_key: identity.pipeline_key,
    attempt: identity.attempt,
    callee_function: i.callee_function != null ? String(i.callee_function) : null,
    callee_request_id: i.callee_request_id != null ? String(i.callee_request_id) : null,
    engine_run_id: i.engine_run_id != null ? String(i.engine_run_id) : null,   // P-3 的 run_id（⛔ ≠ pipeline_run_id）
    business_status: i.business_status != null ? String(i.business_status) : BUSINESS_STATUS.RUNNING,
    expected_trade_date: isDate(i.expected_trade_date) ? i.expected_trade_date : null,
    input_hash: i.input_hash != null ? String(i.input_hash) : null,
    completed_at: i.completed_at != null ? i.completed_at : null,
    detail: i.detail && typeof i.detail === 'object' ? { ...i.detail } : null
  };
}

/* ------------------------------------------------------------------ *
 * 禁止推断（可执行守卫）
 * ------------------------------------------------------------------ */

/**
 * ⛔ 禁止：`CALL_TIMEOUT ⇒ business FAILED`。
 * 本函数**总是抛错** —— 存在目的是让该禁令**可执行、可测试**，而不是只写在注释里。
 */
function deriveBusinessFromTransport() {
  throw new Error('FORBIDDEN_INFERENCE: transport outcome 不得用于推导 business status（OBS-001 正是该推断的反例）');
}

/**
 * ⛔ 禁止：`CALL_RETURNED ⇒ business COMPLETE`。
 * 传输成功只说明「拿到了返回」，不说明下游业务成功。
 */
function deriveTransportFromBusiness() {
  throw new Error('FORBIDDEN_INFERENCE: business status 不得用于推导 transport outcome');
}

/* ------------------------------------------------------------------ *
 * 关联（reconcile）
 * ------------------------------------------------------------------ */

/**
 * 关联 caller 传输记录与下游业务自证。
 * ⛔ 关联依据**只有** `pipeline_run_id` 相等 —— 不用时间窗口、不用函数名+时间拼接。
 */
function reconcile(input) {
  const i = input || {};
  const call = i.callRecord || null;
  const biz = i.businessObservation || null;
  const idFromCall = call ? call.pipeline_run_id : null;
  const idFromBiz = biz ? biz.pipeline_run_id : null;
  const correlated = !!(idFromCall && idFromBiz && idFromCall === idFromBiz);

  let businessStatus;
  if (biz) businessStatus = biz.business_status;
  else businessStatus = BUSINESS_STATUS.NOT_OBSERVED;   // ⛔ 明确「未观测」，不是从 transport 推断

  return {
    pipeline_run_id: idFromCall || idFromBiz || null,
    pipeline_key: (call && call.pipeline_key) || (biz && biz.pipeline_key) || null,
    attempt: (call && call.attempt != null) ? call.attempt : ((biz && biz.attempt) != null ? biz.attempt : null),
    transport_status: call ? call.transport_status : null,
    business_status: businessStatus,
    correlated,
    correlation_basis: correlated
      ? 'pipeline_run_id_equality'
      : (idFromCall ? 'business_not_observed' : (idFromBiz ? 'call_record_missing' : 'no_records')),
    caller_request_id: call ? call.caller_request_id : null,
    callee_request_id: (biz && biz.callee_request_id)
      || (call && call.callee_request_id) || null,
    engine_run_id: (biz && biz.engine_run_id) || (call && call.engine_run_id) || null,
    expected_trade_date: (call && call.expected_trade_date) || (biz && biz.expected_trade_date) || null,
    is_obs_001_shape: !!(correlated
      && call.transport_status === TRANSPORT_STATUS.CALL_TIMEOUT
      && biz.business_status === BUSINESS_STATUS.COMPLETE),
    // 人工拼接依赖度：0 = 完全结构化（本契约达标时恒为 0）
    manual_reconstruction_required: correlated ? 0 : 1
  };
}

/**
 * 判定是否为 OBS-001 目标形态：`transport = CALL_TIMEOUT` 且 `business = COMPLETE`，
 * 且两者通过 **同一个 `pipeline_run_id`** 证明属于同一次 pipeline。
 */
function isObs001Shape(reconciliation) {
  return !!(reconciliation && reconciliation.is_obs_001_shape === true);
}

/* ------------------------------------------------------------------ *
 * callee 侧：只读读取 caller 透传的关联字段
 * ------------------------------------------------------------------ */

/**
 * 从入参 `event` 中**只读**提取 pipeline 关联信息。
 *
 * ⛔ 本函数只做读取与规范化，**不参与任何决策计算**；
 *    `present=false` 时所有字段为 null（老版本 caller 不含这些字段 ⇒ 不猜、不伪造）。
 */
function readInboundCorrelation(event) {
  const e = event && typeof event === 'object' ? event : {};
  const rid = e.pipeline_run_id != null ? String(e.pipeline_run_id) : null;
  const parsed = rid ? parsePipelineRunId(rid) : { valid: false, pipeline_key: null, attempt: null };
  return {
    present: !!(rid && parsed.valid),
    pipeline_run_id: rid,
    pipeline_key: e.pipeline_key != null ? String(e.pipeline_key)
      : (parsed.valid ? parsed.pipeline_key : null),
    attempt: Number.isFinite(Number(e.attempt)) ? Math.floor(Number(e.attempt))
      : (parsed.valid ? parsed.attempt : null),
    origin: e.origin != null ? String(e.origin) : (parsed.valid ? parsed.origin : null),
    entry_function: e.entry_function != null ? String(e.entry_function)
      : (parsed.valid ? parsed.entry_function : null),
    expected_trade_date: isDate(e.expected_trade_date) ? e.expected_trade_date
      : (parsed.valid ? parsed.expected_trade_date : null),
    input_hash: e.input_hash != null ? String(e.input_hash) : null,
    from: e.from != null ? String(e.from) : null
  };
}

/* ------------------------------------------------------------------ *
 * 三 ID 语义守卫（任务书 §10）
 * ------------------------------------------------------------------ */

/**
 * ⛔ 不得把 `pipeline_run_id` / `engine_run_id` / `active_run_id` 混成一个。
 *
 * 语义边界（重要）：
 *   - `pipeline_run_id` = **整条任务链**身份 ⇒ ⛔ 不得被当作 engine/active 身份复用；
 *   - `engine_run_id`  = 一次 decision-engine candidate 身份（P-3 的 `run_id`）；
 *   - `active_run_id`  = 当前 authoritative dataset（P-3 的 pointer）。
 *   ✅ **`engine_run_id == active_run_id` 是合法的** —— active pointer 本来就"指向某个 run_id"，
 *      这不是混用。此时以 `pointer_targets_run = true` 显式标注。
 */
function assertDistinctIdentities(ids) {
  const i = ids || {};
  const pl = i.pipeline_run_id != null ? String(i.pipeline_run_id) : null;
  const eng = i.engine_run_id != null ? String(i.engine_run_id) : null;
  const act = i.active_run_id != null ? String(i.active_run_id) : null;
  const clash = [];
  if (pl && eng && pl === eng) clash.push('pipeline_run_id == engine_run_id');
  if (pl && act && pl === act) clash.push('pipeline_run_id == active_run_id');
  if (clash.length) {
    throw new Error(`FORBIDDEN_IDENTITY_CONFLATION: ${clash.join('; ')}（pipeline 身份不得被当作 engine/active 身份复用）`);
  }
  return {
    pipeline_run_id: pl,
    engine_run_id: eng,
    active_run_id: act,
    pointer_targets_run: !!(eng && act && eng === act),
    semantics: {
      pipeline_run_id: '整条任务链身份',
      engine_run_id: '一次 decision-engine candidate 身份（P-3 的 run_id）',
      active_run_id: '当前 authoritative dataset（P-3 的 pointer）'
    }
  };
}

/** 构造下游自证所需的**回传字段**（caller 在 payload 里透传的最小集合） */
function buildForwardPayload(input) {
  const i = input || {};
  const identity = i.identity || buildPipelineIdentity(i);
  return {
    from: i.caller_function != null ? String(i.caller_function) : (i.from != null ? String(i.from) : null),
    pipeline_run_id: identity.pipeline_run_id,
    pipeline_key: identity.pipeline_key,
    attempt: identity.attempt,
    origin: i.origin != null ? String(i.origin) : ORIGIN.UNKNOWN,
    entry_function: i.entry_function != null ? String(i.entry_function) : null,
    expected_trade_date: isDate(i.expected_trade_date) ? i.expected_trade_date : null,
    input_hash: i.input_hash != null ? String(i.input_hash) : null
  };
}

module.exports = {
  TRANSPORT_STATUS,
  BUSINESS_STATUS,
  TRANSPORT_TERMINAL,
  ORIGIN,
  TIMEOUT_MARKERS,
  isDate,
  identityComponents,
  canonicalPipelineKey,
  buildPipelineIdentity,
  parsePipelineRunId,
  buildCallRecord,
  classifyTransportError,
  settleTransport,
  buildBusinessObservation,
  deriveBusinessFromTransport,
  deriveTransportFromBusiness,
  reconcile,
  isObs001Shape,
  readInboundCorrelation,
  assertDistinctIdentities,
  buildForwardPayload
};
