/**
 * V3.6.5 P-4 —— 候选补丁描述（**只描述，不落盘到云函数**）
 *
 * 本轮裁定：`P4_DESIGN = CORRELATION_AND_OBSERVABILITY_ONLY`
 *   ⛔ RETRY = NO · ⛔ TIMEOUT_CHANGE = NO · ⛔ MATERIALIZE_CONTROL_FLOW_CHANGE = NO
 *
 * 本文件把「为了让 pipeline_run_id 端到端透传所需的最小 additive patch」
 * 表达为**可检视、可测试的数据**，而不是直接改冻结的云函数文件：
 *   - `cloudfunctions/materializeIndicators/index.js` —— 已知 drift 件，本轮**不得修改**（任务书 §8）
 *   - `cloudfunctions/runDecisionEngine/index.js`    —— **V364 冻结件**，改它需单独授权（任务书 §13）
 *
 * ⇒ `PATCH_APPLICATION_REQUIRES_AUTHORIZATION = true`
 */

'use strict';

const ORIGIN_PLACEHOLDER = "'chain' | 'timer' | 'manual' | 'unknown'";

/** materializeIndicators —— caller 侧：生成身份 + 透传 + transport 结构化（严格 additive） */
const PATCH_MATERIALIZE_INDICATORS = Object.freeze({
  id: 'P4-PATCH-MI',
  file: 'cloudfunctions/materializeIndicators/index.js',
  change_required: true,
  frozen: false,
  kind: 'additive_only',
  purpose: '生成 pipeline_run_id、向下游透传、把 transport 结果结构化（便于 caller 侧回查）',
  additions: Object.freeze([
    {
      anchor: '顶部 require 区（在 const { COLLECTIONS, DEFAULT_PARAMS } = require(\'./common/constants\'); 之后）',
      snippet: "const { ORIGIN, buildPipelineIdentity, buildForwardPayload, buildCallRecord, classifyTransportError, settleTransport } = require('./common/utils/pipeline-correlation');"
    },
    {
      anchor: 'exports.main 内、第 3 步链式调用**之前**',
      snippet: [
        'const pipelineIdentity = buildPipelineIdentity({',
        '  expected_trade_date: event.expected_trade_date || observedCalcDate(results) || null,',
        `  origin: event.pipeline_run_id ? ORIGIN.CHAIN : ORIGIN.TIMER,`,
        "  entry_function: 'materializeIndicators',",
        '  attempt: event.pipeline_attempt || 1',
        '});',
        'const callRecord0 = buildCallRecord({ identity: pipelineIdentity, caller_function: \'materializeIndicators\', caller_request_id: context && context.request_id ? context.request_id : null, callee_function: \'runDecisionEngine\', started_at: new Date().toISOString() });',
        'await emitCallRecord(callRecord0);   // 可观测性写入（非业务集合）'
      ].join('\n')
    },
    {
      anchor: '第 3 步 callFunction 的 data（当前为 { from: \'materializeIndicators\' }）',
      snippet: "data: buildForwardPayload({ identity: pipelineIdentity, caller_function: 'materializeIndicators', origin: callRecord0.origin, entry_function: 'materializeIndicators', expected_trade_date: callRecord0.expected_trade_date })   // 仅新增字段，from 语义不变"
    },
    {
      anchor: '第 3 步的 catch 分支（当前为 chained = { error: String(e.message || e) }）',
      snippet: [
        'const c = classifyTransportError(e);',
        "chained = { error: String(e.message || e), transport: c };   // error 保留（向后兼容），transport 为新增结构化字段",
        'await emitCallRecord(settleTransport(callRecord0, { transport_status: c.transport_status, error_code: c.error_code, error_message: c.error_message, completed_at: new Date().toISOString() }));'
      ].join('\n')
    },
    {
      anchor: 'try 正常返回前（拿到 chained 之后）',
      snippet: 'await emitCallRecord(settleTransport(callRecord0, { transport_status: TRANSPORT_STATUS.CALL_RETURNED, callee_request_id: (chained && chained.requestId) || null, completed_at: new Date().toISOString() }));'
    }
  ]),
  strictly_forbidden: Object.freeze([
    'RETRY：不得因 caller timeout 自动重试 runDecisionEngine',
    'TIMEOUT：不得修改任何 CloudBase timeout 参数',
    'CONTROL_FLOW：不得改变 materializeIndicators → runDecisionEngine 的链式控制流',
    'INDICATOR_CONTRACT：不得修改 indicator contract / snapshot 内容 / 恢复 breakout_nd',
    'CALLFUNCTION_SEMANTICS：不得重写 app.callFunction 的调用语义'
  ]),
  retry_added: false,
  timeout_changed: false,
  business_control_flow_changed: false
});

/** runDecisionEngine —— callee 侧：读入 + 回填到**已有** runtime_status 写 + 返回体只读字段 */
const PATCH_RUN_DECISION_ENGINE = Object.freeze({
  id: 'P4-PATCH-RDE',
  file: 'cloudfunctions/runDecisionEngine/index.js',
  change_required: true,
  frozen: true,                       // ⚠️ V364 冻结件
  applies_requires_authorization: true,
  kind: 'additive_only_read_only_provenance',
  purpose: '读入 caller 透传的 pipeline 字段，作为**只读 provenance** 落库（复用已有 runtime_status 写，零新增业务写入）',
  additions: Object.freeze([
    {
      anchor: '顶部 require 区',
      snippet: "const { readInboundCorrelation } = require('./common/utils/pipeline-correlation');"
    },
    {
      anchor: 'exports.main 开头（const startedAt = Date.now(); 之后）',
      snippet: [
        '// P-4 只读 provenance：仅读取 caller 透传的关联字段，⛔ 不参与任何决策计算',
        'const inboundCorrelation = readInboundCorrelation(event);'
      ].join('\n')
    },
    {
      anchor: 'runtime_status upsert 的对象字面量内（新增字段）',
      snippet: [
        'pipeline_run_id: inboundCorrelation.pipeline_run_id,',
        'pipeline_key: inboundCorrelation.pipeline_key,',
        'pipeline_attempt: inboundCorrelation.attempt,',
        'pipeline_origin: inboundCorrelation.origin,',
        'pipeline_entry_function: inboundCorrelation.entry_function,',
        'pipeline_expected_trade_date: inboundCorrelation.expected_trade_date,',
        'callee_request_id: (context && context.request_id) ? String(context.request_id) : null,',
        'engine_run_id: null    // ← P-3 落地后再填（当前不启用 active pointer，故为 null）'
      ].join('\n')
    },
    {
      anchor: 'main() 的 return 对象内（新增只读字段）',
      snippet: 'pipeline: { run_id: inboundCorrelation.pipeline_run_id, attempt: inboundCorrelation.attempt, origin: inboundCorrelation.origin, present: inboundCorrelation.present }'
    }
  ]),
  why_reuse_runtime_status: 'runtime_status 每次 run 已经 upsert ⇒ 加字段属**零新增写入**，不改任何业务集合与决策路径',
  optional_enhancement: '如需独立的下游自证记录，可另行立项新增 pipeline_observation 集合（本轮不纳入）',
  strictly_forbidden: Object.freeze([
    'RETRY / TIMEOUT / CONTROL_FLOW 任何改动',
    '把 pipeline_* 字段接入任何决策计算（必须只读）',
    '修改 final_target / final_action / trend_stage 等决策输出'
  ]),
  retry_added: false,
  timeout_changed: false,
  business_control_flow_changed: false
});

const PATCHES = Object.freeze([PATCH_MATERIALIZE_INDICATORS, PATCH_RUN_DECISION_ENGINE]);

/** 材料是否必须改才能端到端透传 */
const MATERIALIZE_CHANGE_REQUIRED = PATCH_MATERIALIZE_INDICATORS.change_required === true;

/** 补丁落地需要显式授权（含任一冻结件） */
const PATCH_APPLICATION_REQUIRES_AUTHORIZATION = PATCHES.some((p) => p.applies_requires_authorization === true);

/** 校验补丁描述本身不含被禁改动（把「禁止项」变成可执行断言） */
function assertPatchIsAdditiveOnly(patch) {
  const p = patch || {};
  const bad = [];
  if (p.retry_added === true) bad.push('retry_added');
  if (p.timeout_changed === true) bad.push('timeout_changed');
  if (p.business_control_flow_changed === true) bad.push('business_control_flow_changed');
  if (p.kind !== 'additive_only' && p.kind !== 'additive_only_read_only_provenance') bad.push(`kind=${p.kind}`);
  (p.additions || []).forEach((a, idx) => {
    const blob = `${a.anchor || ''} ${a.snippet || ''}`;
    if (/\bretry\b|重试/i.test(blob)) bad.push(`addition#${idx} 含 retry 字样`);
    if (/setTimeout|time_limit|Timeout\s*[:=]/i.test(blob)) bad.push(`addition#${idx} 含 timeout 配置`);
  });
  if (bad.length) {
    throw new Error(`PATCH_NOT_ADDITIVE_ONLY: ${bad.join('; ')}`);
  }
  return { ok: true, patch_id: p.id || null, additions: (p.additions || []).length };
}

module.exports = {
  PATCH_MATERIALIZE_INDICATORS,
  PATCH_RUN_DECISION_ENGINE,
  PATCHES,
  MATERIALIZE_CHANGE_REQUIRED,
  PATCH_APPLICATION_REQUIRES_AUTHORIZATION,
  ORIGIN_PLACEHOLDER,
  assertPatchIsAdditiveOnly
};
