'use strict';

/**
 * V3.6.5 run 完整性编排（B1 核心，**纯逻辑**，存储访问全部经适配器）。
 *
 * 职责边界：
 *   1. RunContext 构建 + **required-input gate**（fail-closed）
 *   2. Run Finality 分类（COMPLETE / PARTIAL / FAILED）
 *   3. candidate-first 发布：先写 candidate → 分类 → 校验 → （CAS）指针提升
 *   4. 结构化 telemetry（含 OBS-001 形态）
 *
 * ⛔ 本模块**不做**任何策略计算：不碰 trend_stage / final_target / final_action /
 *    market regime / cap / factor。它只决定"这份结果能不能成为 authoritative"。
 */

const { buildV361RunContext, HEALTH } = require('./v361-run-context.js');
const { classifyRunFinality, RUN_STATUS, HEALTH_SEMANTICS, PUBLISH_PHASE } = require('./v361-run-finality.js');
const {
  classifyCandidateSet, validateCandidateSet, planPointerPromotion,
  executePointerPromotion, POINTER_ACTION, HOLD_REASON, POC_COLLECTIONS
} = require('./v365-atomic-publish.js');
const {
  TRANSPORT_STATUS, BUSINESS_STATUS, buildPipelineIdentity,
  buildCallRecord, buildBusinessObservation, settleTransport, reconcile,
  buildForwardPayload, readInboundCorrelation, ORIGIN, isObs001Shape
} = require('./pipeline-correlation.js');
const CONTRACTS = require('./v365-contracts.js');
const calendar = require('./cn-trading-calendar.js');
const { promotionAllowed, CAS_CODE } = require('./v365-publish-store.js');

/** run gate 结果（语义固定；名称可调） */
const RUN_GATE = Object.freeze({
  PASS: 'PASS',
  BLOCKED: 'BLOCKED'
});

/* ------------------------------------------------------------------ *
 * 1. RunContext
 * ------------------------------------------------------------------ */

/**
 * 由 `prepared`（已读到的 5 票快照）构建 RunContext 信封。
 * @param {object} input
 *   - expected_codes      {string[]}
 *   - snapshots           {Object} code -> { calc_date }
 *   - expected_trade_date {string}  ← 由日历权威源给出（⛔ 不得用 max(calc_date) 代替）
 *   - expected_trade_date_authority {object} calendarArtifactSha/version/coverage
 *   - global_signals / fundamentals / market_env_date / config_version
 */
function buildRunContext(input) {
  const i = input || {};
  return buildV361RunContext(i);
}

/**
 * required-input gate（任务书 §5/§6）。
 *
 * 语义（fail-closed）：
 *   - `input_health.status !== OK` ⇒ BLOCKED（含 CASE_B / CASE_C 全体一致落后）
 *   - ⛔ 绝不回退用 observed_latest_date 顶替 expected_trade_date
 *   - ⛔ 绝不"看起来完整就放行"
 */
function decideRunGate(envelope) {
  const e = envelope || {};
  const health = (e.input_health && e.input_health.status) || null;
  const alignment = (e.date_alignment && e.date_alignment.case) || null;
  // 语义边界（任务书 §17）：**只有 BLOCKED 才阻断**。
  //   `DEGRADED` = 仅 optional source（fundamental / market_env / global_signal）过期或缺失
  //   ⇒ ⛔ 不得因此 BLOCK 整条生产 run（否则会因基本面数据旧而停掉仓位决策）。
  //   health 缺失/null = 无法判定 ⇒ fail-closed 视为 BLOCKED。
  const blocked = health == null || health === HEALTH.BLOCKED;
  const degraded = health === HEALTH.DEGRADED;
  const reason = !blocked ? (degraded ? 'required_inputs_ok_optional_degraded' : 'required_inputs_ok')
    : (health == null ? 'run_context_unavailable'
      : `input_health_${String(health)}` + (alignment ? `:${alignment}` : ''));
  return {
    status: blocked ? RUN_GATE.BLOCKED : RUN_GATE.PASS,
    publishable: !blocked,
    business_status: blocked ? BUSINESS_STATUS.FAILED : BUSINESS_STATUS.RUNNING,
    input_health: health,
    input_health_degraded: degraded,
    date_alignment_case: alignment,
    reason,
    // 结构性事实：BLOCK 时**不得**产生新的 authoritative portfolio
    active_pointer_must_remain: blocked
  };
}

/* ------------------------------------------------------------------ *
 * 2. Finality
 * ------------------------------------------------------------------ */

/**
 * 由 results 列表（逐票）计算 finality。
 * @param {object} input { expected_codes, results }   results: code -> { ok }
 */
function computeFinality(input) {
  const i = input || {};
  const f = classifyRunFinality({ expected_codes: i.expected_codes, results: i.results });
  return {
    status: f.status,
    health_semantics: HEALTH_SEMANTICS[f.status],
    expected_count: f.expected_count != null ? f.expected_count : f.expectedCount,
    success_count: f.success_count != null ? f.success_count : f.successCount,
    failed_count: f.failed_count != null ? f.failed_count : f.failedCount,
    failed_codes: f.failed_codes || [],
    missing_codes: f.missing_codes || [],
    reason: f.reason || null,
    publishable: f.status === RUN_STATUS.COMPLETE
  };
}

/* ------------------------------------------------------------------ *
 * 3. candidate-first 发布
 * ------------------------------------------------------------------ */

/**
 * 执行：写 candidate → 回读 → 分类 → 校验 → （CAS）提升。
 *
 * @param {object} input
 *   - store   {object}   适配器（cloudbase 或 memory）
 *   - scope   {string}   指针作用域（默认 production）
 *   - manifest {object}  run manifest（含 run_id / revision / expected_trade_date）
 *   - decisions {object[]} 逐票 candidate（**由调用方写入 store 或在此写入**）
 *   - portfolio {object|null}
 *   - allowPromotion {boolean} 默认由 promotionAllowed() 决定
 * @returns {object} 结构化结果（含 promotion_skipped_reason）
 */
async function publishCandidateFirst(input) {
  const i = input || {};
  const store = i.store;
  const scope = i.scope || CONTRACTS.POINTER_SCOPE_PRODUCTION;
  const manifest = i.manifest;
  const decisions = i.decisions || [];
  const portfolio = i.portfolio || null;
  const codes = i.expected_codes || decisions.map((d) => d && d.code).filter((c) => c != null);

  // 1) 写 candidate（可部分成功 —— 这正是要防的场景）
  await store.putManifest(manifest);
  for (const d of decisions) {
    // ⚠️ 字段同义归一（**不是**"把日期填正确"）：
    //    生产 `decision_result.decision_date` 本身**就是** snapshot 的 `calc_date`
    //    （`src/common/utils/decision.js:936` → `decision_date: snapshot.calc_date || ''`）。
    //    发布校验的 mixed-date gate 统一以 `calc_date` 为交易日字段，故此处做等价映射。
    //    ⛔ 若某票的日期真的不同（跨 run / 混日期），归一后仍然不同 ⇒ 校验照旧报 `mixed_date_detected`。
    const candidateDoc = Object.assign({}, d, {
      calc_date: d.calc_date != null ? d.calc_date
        : (d.decision_date != null ? d.decision_date : null)
    });
    await store.putCandidate(POC_COLLECTIONS.RUN_CANDIDATE_DECISION, manifest.run_id, String(d.code), candidateDoc);
  }
  if (portfolio) {
    await store.putCandidate(POC_COLLECTIONS.RUN_CANDIDATE_PORTFOLIO, manifest.run_id, 'portfolio', portfolio);
  }

  // 2) 从存储**回读**（⛔ 不信任内存入参）
  const storedDecisions = await store.listCandidates(POC_COLLECTIONS.RUN_CANDIDATE_DECISION, manifest.run_id);
  const storedPortfolio = await store.getCandidate(POC_COLLECTIONS.RUN_CANDIDATE_PORTFOLIO, manifest.run_id, 'portfolio');

  // 3) 分类 —— 用「声明的 expected_codes」而不是「实际写成功的条数」
  const resultMap = {};
  storedDecisions.forEach((d) => { if (d && d.code != null) resultMap[String(d.code)] = { ok: d.ok !== false }; });
  const finality = computeFinality({
    expected_codes: codes,
    results: resultMap
  });
  const candidateClass = classifyCandidateSet(
    Object.assign({}, manifest, { expected_codes: codes }), storedDecisions
  );

  // 4) 校验
  const validation = validateCandidateSet({
    manifest: Object.assign({}, manifest, { expected_codes: codes }),
    decisions: storedDecisions,
    portfolio: storedPortfolio
  });

  const currentPointer = await store.getPointer(scope);
  const plan = planPointerPromotion({
    finality, validation, manifest, current_pointer: currentPointer
  });

  await store.putManifest(Object.assign({}, manifest, {
    status: finality.status,
    finality_health: finality.health_semantics,
    validation_passed: validation.passed === true,
    validation_reason: validation.reason || null,
    candidate_class: candidateClass && candidateClass.status ? candidateClass.status : null
  }));

  // 5) 提升 —— **双重门**：协议判定 + 平台 CAS 证据
  const allowed = i.allowPromotion != null ? i.allowPromotion === true : promotionAllowed();
  if (plan.action !== POINTER_ACTION.PROMOTE || plan.action === POINTER_ACTION.ALREADY_ACTIVE) {
    return {
      finality, candidate_class: candidateClass, validation, plan,
      promotion_attempted: false,
      promoted: plan.action === POINTER_ACTION.ALREADY_ACTIVE,
      promotion_skipped_reason: plan.reason || plan.action,
      pointer_unchanged: true,
      current_pointer: currentPointer
    };
  }
  if (!allowed) {
    return {
      finality, candidate_class: candidateClass, validation, plan,
      promotion_attempted: false,
      promoted: false,
      promotion_skipped_reason: 'ATOMIC_PROMOTION_BLOCKED:platform_cas_unverified',
      pointer_unchanged: true,
      current_pointer: currentPointer
    };
  }

  const exec = await executePointerPromotion({ store, adapter: store, scope, plan, expected_pointer: currentPointer });
  return {
    finality, candidate_class: candidateClass, validation, plan,
    promotion_attempted: true,
    promoted: exec.promoted === true,
    promotion_skipped_reason: exec.promoted ? null : (exec.reason || CAS_CODE.CAS_REJECTED),
    pointer_unchanged: exec.promoted !== true,
    current_pointer: exec.pointer || currentPointer,
    cas: exec.cas || null,
    exec_action: exec.action
  };
}

/* ------------------------------------------------------------------ *
 * 4. pipeline correlation telemetry（P-4 接线）
 * ------------------------------------------------------------------ */

/** 生成 caller 侧身份（⛔ 身份不含 wall-clock） */
function allocatePipelineIdentity(input) {
  return buildPipelineIdentity(input);
}

/** 从 event 中只读读取上游 correlation（兼容无 correlation 的历史入口） */
function readInbound(event) {
  return readInboundCorrelation(event || {});
}

/** 组装下游 → 上游的只读回执（下游自证） */
function buildDownstreamAttestation(input) {
  const i = input || {};
  const call = buildCallRecord(i);
  return Object.assign(call, {
    transport_status: i.transport_status || TRANSPORT_STATUS.CALL_RETURNED,
    business_status: i.business_status || BUSINESS_STATUS.NOT_OBSERVED
  });
}

/* ------------------------------------------------------------------ *
 * 5. run 级 telemetry（落 runtime_status 的 pipeline_* 字段用）
 * ------------------------------------------------------------------ */

/**
 * OBS-001 形态判定（任务书 §6）。
 *
 * ⚠️ 必须经 `reconcile` 走一遍**关联**：仅当
 *   transport = CALL_TIMEOUT、business = COMPLETE、且两者 **pipeline_run_id 相等**
 *   才算「同一次 pipeline 的 caller 超时 + 下游成功」。
 * ⛔ 不得只凭"时间窗口相近 + 函数名"下结论（那正是 OBS-001 只能人工推断的根因）。
 */
function computeObs001Shape(p) {
  const pipeline = p || {};
  const rec = reconcile({
    callRecord: {
      pipeline_run_id: pipeline.pipeline_run_id != null ? String(pipeline.pipeline_run_id) : null,
      pipeline_key: pipeline.pipeline_key != null ? String(pipeline.pipeline_key) : null,
      attempt: pipeline.attempt != null ? pipeline.attempt : null,
      transport_status: pipeline.transport_status != null ? String(pipeline.transport_status) : null
    },
    businessObservation: pipeline.callee_pipeline_run_id != null
      ? {
        pipeline_run_id: String(pipeline.callee_pipeline_run_id),
        pipeline_key: pipeline.pipeline_key != null ? String(pipeline.pipeline_key) : null,
        attempt: pipeline.attempt != null ? pipeline.attempt : null,
        business_status: pipeline.business_status != null ? String(pipeline.business_status) : null
      }
      : null
  });
  return {
    is_shape: isObs001Shape(rec) === true,
    correlated: rec.correlated === true,
    manual_reconstruction_required: isObs001Shape(rec) === true && rec.correlated === true ? 0 : 1
  };
}

function buildRunTelemetry(input) {
  const i = input || {};
  const env = i.envelope || {};
  const gate = i.gate || decideRunGate(env);
  const finality = i.finality || null;
  const pipeline = i.pipeline || {};
  const obs = computeObs001Shape(pipeline);
  return {
    pipeline_run_id: pipeline.pipeline_run_id || null,
    pipeline_attempt: pipeline.attempt != null ? pipeline.attempt : null,
    pipeline_origin: pipeline.origin || null,
    engine_run_id: i.engine_run_id || null,
    caller_function: pipeline.caller_function || null,
    caller_request_id: pipeline.caller_request_id || null,
    transport_status: pipeline.transport_status || null,
    business_status: pipeline.business_status
      || (gate.status === RUN_GATE.BLOCKED ? BUSINESS_STATUS.FAILED : null),
    obs_001_shape: obs.is_shape,
    obs_001_correlated: obs.correlated,
    obs_001_manual_reconstruction_required: obs.manual_reconstruction_required,
    expected_trade_date: env.expected_trade_date != null ? env.expected_trade_date : null,
    observed_latest_date: env.observed_latest_date != null ? env.observed_latest_date : null,
    effective_as_of_trade_date: env.effective_as_of_trade_date != null ? env.effective_as_of_trade_date : null,
    input_hash: env.input_hash != null ? env.input_hash : null,
    input_contract_version: CONTRACTS.INPUT_CONTRACT_VERSION,
    calendar_version: (env.expected_trade_date_authority && env.expected_trade_date_authority.calendar_version)
      || CONTRACTS.CALENDAR_VERSION,
    run_context_version: CONTRACTS.RUN_CONTEXT_VERSION,
    run_finality_version: CONTRACTS.RUN_FINALITY_VERSION,
    publish_protocol_version: CONTRACTS.PUBLISH_PROTOCOL_VERSION,
    engine_version: CONTRACTS.ENGINE_VERSION,
    input_health: gate.input_health,
    date_alignment_case: gate.date_alignment_case,
    publishable: gate.publishable === true && (!finality || finality.publishable === true),
    finality_status: finality ? finality.status : null
  };
}

module.exports = {
  RUN_GATE,
  RUN_STATUS,
  // 契约常量再导出（云函数侧不必再 require 两个模块）
  ENGINE_VERSION: CONTRACTS.ENGINE_VERSION,
  INPUT_CONTRACT_VERSION: CONTRACTS.INPUT_CONTRACT_VERSION,
  V365_COLLECTIONS: CONTRACTS.V365_COLLECTIONS,
  CAS_EVIDENCE: CONTRACTS.CAS_EVIDENCE,
  // P-1A 日历权威源再导出（RunContext gate 的 expected_trade_date 来源）
  resolveExpectedTradeDate: calendar.resolveExpectedTradeDate,
  loadRepoCalendar: calendar.loadRepoCalendar,
  calendarExpiryStatus: calendar.calendarExpiryStatus || null,
  CALENDAR_REASON: calendar.REASON,
  CALENDAR_STATUS: calendar.STATUS,
  PUBLISH_PHASE,
  POINTER_ACTION,
  HOLD_REASON,
  ORIGIN,
  TRANSPORT_STATUS,
  BUSINESS_STATUS,
  buildRunContext,
  decideRunGate,
  computeFinality,
  publishCandidateFirst,
  allocatePipelineIdentity,
  readInbound,
  buildDownstreamAttestation,
  buildForwardPayload,
  settleTransport,
  buildBusinessObservation,
  reconcile,
  isObs001Shape,
  buildRunTelemetry,
  promotionAllowed
};
