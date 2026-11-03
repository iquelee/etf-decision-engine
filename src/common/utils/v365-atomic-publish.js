/**
 * V3.6.5 P-3 —— Atomic Publish PoC（**PoC only，未接入生产 runDecisionEngine**）
 *
 * ── Atomic 的严格定义（任务书 §11）────────────────────────────────────
 *   本 PoC **不要求**「所有 candidate 文档一次事务提交」。
 *   Atomicity 定义为：
 *     «消费者可见的 authoritative dataset，只能通过单一 active pointer
 *       从旧完整 run 切换到新完整 run。»
 *   也就是说：candidate **可以逐条写**；但 partial candidate
 *   **永远不能成为 authoritative**。
 *
 * ── 消费者契约 ────────────────────────────────────────────────────────
 *   ⛔ 消费者**只允许**读取 `active_run_pointer` 指向的 **completed** dataset。
 *   ⛔ 不得把「最新写入时间最大的文档」视为 active。
 *
 * ── 逻辑模型（collection 名可调整，重点是语义）──────────────────────
 *   run_manifest            : run_id / expected_trade_date / input_hash / expected_codes / status / revision
 *   run_candidate_decision  : run_id / code / payload
 *   run_candidate_portfolio : run_id / payload
 *   active_run_pointer      : scope='production' / run_id / revision
 *
 * ── 提升规则（显式定义，⛔ 不靠 wall-clock）──────────────────────────
 *   R1 finality.status === COMPLETE
 *   R2 validation.passed === true
 *   R3 **monotonic revision**：candidate.revision > current_pointer.revision
 *   R4 同一 expected_trade_date 允许 supersede，但必须记录 supersedes_run_id（可追溯）
 *   R5 **CAS**：提升时 expected_pointer 必须与当前 pointer 一致，否则 HOLD
 *
 * 纯逻辑模块：只依赖 adapter 接口，不含 I/O。
 */
'use strict';

const {
  RUN_STATUS, PUBLISH_PHASE, classifyRunFinality, planTwoStagePublish
} = require('./v361-run-finality.js');
// 拒因枚举**单一来源**：与适配器共用同一 CAS 语义层（机制无关）
const { CAS_REASON } = require('./v365-publish-store.js');

/**
 * 逻辑集合名 —— **唯一来源**为 `v365-contracts.js::V365_COLLECTIONS`（OD-5 冻结）。
 *
 * ⚠️ WP-RH1：本文件原先**自带一份** `POC_COLLECTIONS` 硬编码表，与 `V365_COLLECTIONS`
 *    构成**双源**（HD12-0 实测：两侧字面值一致 ⇒ 当前可工作，但**改名任一侧即静默错配**）。
 *    ⇒ 现改为从契约模块读取，并保留 `POC_COLLECTIONS` 作为**过渡别名**（不破坏既有调用方）。
 * ⛔ 不得在本文件重新硬编码集合名。
 */
const { V365_COLLECTIONS } = require('./v365-contracts.js');
/** @deprecated 过渡别名 —— 请直接使用 `V365_COLLECTIONS`；本别名将在后续版本移除 */
const POC_COLLECTIONS = Object.freeze({
  RUN_MANIFEST: V365_COLLECTIONS.RUN_MANIFEST,
  RUN_CANDIDATE_DECISION: V365_COLLECTIONS.CANDIDATE_DECISION,
  RUN_CANDIDATE_PORTFOLIO: V365_COLLECTIONS.CANDIDATE_PORTFOLIO,
  ACTIVE_RUN_POINTER: V365_COLLECTIONS.ACTIVE_POINTER
});

const POINTER_ACTION = Object.freeze({
  PROMOTE: 'PROMOTE',
  HOLD: 'HOLD',
  ALREADY_ACTIVE: 'ALREADY_ACTIVE'
});

const HOLD_REASON = Object.freeze({
  RUN_NOT_COMPLETE: 'run_not_complete',
  VALIDATION_FAILED: 'validation_failed',
  ARTIFACT_INCOMPLETE: 'artifact_incomplete',
  REVISION_NOT_MONOTONIC: 'revision_not_monotonic',
  STALE_RUN: 'stale_run_cannot_overwrite_newer',
  POINTER_CHANGED: 'pointer_changed_by_concurrent_run',
  CAS_REJECTED: 'compare_and_set_rejected'
});

/** 一次 run 的必填发布对象（5 只 ETF decision + 1 个 portfolio） */
function expectedObjects(expectedCodes, opts) {
  const o = opts || {};
  const codes = (Array.isArray(expectedCodes) ? expectedCodes : []).map(String).sort();
  return {
    decision_codes: codes,
    portfolio_required: o.portfolioRequired !== false
  };
}

/**
 * 只读：当前 active dataset（消费者唯一入口）。
 * ⛔ 绝不返回「最新写入」的候选；只返回 pointer 指向的 run 的已落库候选。
 */
async function readActive(adapter, scope) {
  const pointer = await adapter.getPointer(scope || 'production');
  if (!pointer || !pointer.run_id) return { active: false, pointer: null, manifest: null, decisions: [], portfolio: null };
  const manifest = await adapter.getManifest(pointer.run_id);
  if (!manifest) return { active: false, pointer, manifest: null, decisions: [], portfolio: null };
  const decisions = await adapter.listCandidates(POC_COLLECTIONS.RUN_CANDIDATE_DECISION, pointer.run_id);
  const portfolio = await adapter.getCandidate(POC_COLLECTIONS.RUN_CANDIDATE_PORTFOLIO, pointer.run_id, 'portfolio');
  return { active: true, pointer, manifest, decisions, portfolio };
}

/**
 * 复用既有 `classifyRunFinality`（V364 锁内模块，只读调用不修改）。
 * @param {object} manifest run_manifest（含 expected_codes）
 * @param {Array<object>} decisionCandidates [{ code, ok, ... }]
 */
function classifyCandidateSet(manifest, decisionCandidates) {
  const results = {};
  (Array.isArray(decisionCandidates) ? decisionCandidates : []).forEach((c) => {
    if (!c || c.code == null) return;
    results[String(c.code)] = c.ok === false
      ? { ok: false, error: c.error || 'candidate_failed' }
      : { ok: true };
  });
  return classifyRunFinality({
    expected_codes: (manifest && manifest.expected_codes) || [],
    results
  });
}

/**
 * 校验：候选集是否「自洽且完整」。
 * 关键检查 = **同日性**（mixed-date 判定）：每个 ETF candidate 的 calc_date
 * 必须等于 manifest.expected_trade_date。
 */
function validateCandidateSet(input) {
  const inp = input || {};
  const manifest = inp.manifest || {};
  const decisions = Array.isArray(inp.decisions) ? inp.decisions : [];
  const portfolio = inp.portfolio || null;
  const expectedTradeDate = manifest.expected_trade_date;
  const expected = expectedObjects(manifest.expected_codes, inp);

  // (1) decision 齐备
  const gotCodes = decisions.map((d) => String(d.code)).sort();
  const missing = expected.decision_codes.filter((c) => !gotCodes.includes(c));
  const extra = gotCodes.filter((c) => !expected.decision_codes.includes(c));
  if (missing.length) return { passed: false, reason: 'missing_decision_candidates', detail: missing };
  if (extra.length) return { passed: false, reason: 'unexpected_decision_candidates', detail: extra };

  // (2) portfolio 齐备
  if (expected.portfolio_required && !portfolio) {
    return { passed: false, reason: 'missing_portfolio_candidate' };
  }

  // (3) 同日性（mixed-date gate）
  if (!expectedTradeDate) return { passed: false, reason: 'manifest_missing_expected_trade_date' };
  const wrongDate = decisions
    .filter((d) => String(d.calc_date) !== String(expectedTradeDate))
    .map((d) => ({ code: String(d.code), calc_date: d.calc_date }));
  if (wrongDate.length) return { passed: false, reason: 'mixed_date_detected', detail: wrongDate };

  // (4) 显式 failed 候选（写失败/计算失败都算）
  const failed = decisions.filter((d) => d.ok === false).map((d) => String(d.code));
  if (failed.length) return { passed: false, reason: 'candidate_failed', detail: failed };

  return { passed: true, reason: 'ok' };
}

/**
 * 决定是否可以把 pointer 切到该 candidate。
 *
 * ⛔ 不依赖 wall-clock；靠 **monotonic revision + CAS**。
 *
 * @param {object} input
 *   - finality        {object} classifyCandidateSet 的结果
 *   - validation      {object} validateCandidateSet 的结果
 *   - manifest        {object} candidate 的 run_manifest（含 run_id / revision / expected_trade_date）
 *   - current_pointer {object|null} 当前 pointer
 */
function planPointerPromotion(input) {
  const inp = input || {};
  const finality = inp.finality || {};
  const validation = inp.validation || {};
  const manifest = inp.manifest || {};
  const current = inp.current_pointer || null;

  // R1 必须 COMPLETE
  if (finality.status !== RUN_STATUS.COMPLETE) {
    return { action: POINTER_ACTION.HOLD, reason: `${HOLD_REASON.RUN_NOT_COMPLETE}:${finality.status}` };
  }
  // R2 必须 validation passed
  if (validation.passed !== true) {
    return { action: POINTER_ACTION.HOLD, reason: `${HOLD_REASON.VALIDATION_FAILED}:${validation.reason}` };
  }

  const curRevision = current && Number.isFinite(Number(current.revision)) ? Number(current.revision) : 0;
  const myRevision = Number(manifest.revision);

  // 幂等（F6）：同一 run_id 已是 active ⇒ 不产生新 revision
  if (current && current.run_id === manifest.run_id) {
    return {
      action: POINTER_ACTION.ALREADY_ACTIVE,
      reason: 'already_active_same_run_id',
      run_id: manifest.run_id,
      revision: curRevision
    };
  }

  if (!Number.isFinite(myRevision)) {
    return { action: POINTER_ACTION.HOLD, reason: `${HOLD_REASON.ARTIFACT_INCOMPLETE}:revision_missing` };
  }
  // R3 单调 revision（防止较旧 run 覆盖较新 run）
  if (myRevision <= curRevision) {
    return {
      action: POINTER_ACTION.HOLD,
      reason: `${HOLD_REASON.STALE_RUN}:revision ${myRevision} <= current ${curRevision}`
    };
  }

  const plan = {
    action: POINTER_ACTION.PROMOTE,
    run_id: manifest.run_id,
    revision: myRevision,
    expected_trade_date: manifest.expected_trade_date,
    next_pointer: {
      scope: (current && current.scope) || 'production',
      run_id: manifest.run_id,
      revision: myRevision,
      expected_trade_date: manifest.expected_trade_date,
      promoted_from_run_id: current ? current.run_id : null
    },
    // R4 同一交易日 supersede 必须显式可追溯
    supersedes_run_id: (current && current.expected_trade_date === manifest.expected_trade_date)
      ? current.run_id : null,
    same_trade_date_supersede: !!(current && current.expected_trade_date === manifest.expected_trade_date)
  };

  // 复用既有两阶段发布判定（保证语义与 V3.6.4 设计一致）
  const twoStage = planTwoStagePublish({ finality, validation });
  plan.two_stage_action = twoStage.action;
  plan.phase = PUBLISH_PHASE.VALIDATED;
  plan.next_phase = PUBLISH_PHASE.ACTIVE;
  if (twoStage.action !== 'promote_active') {
    return { action: POINTER_ACTION.HOLD, reason: `${HOLD_REASON.VALIDATION_FAILED}:two_stage_${twoStage.action}` };
  }

  return plan;
}

/**
 * 执行 pointer 提升（**唯一**把 candidate 变成 authoritative 的入口）。
 *
 * 用**单文档条件 CAS**：expected 必须与当前 pointer 逐位一致，且 revision 严格单调；
 * 否则拒写（并发者已抢先 / 快照过期 / 较旧 run 后到）。
 *
 * ⚠️ 拒因**结构化透传**（⛔ 不得压成统一的 CAS_REJECTED 而丢失原因）：
 *    PROMOTED / ALREADY_ACTIVE / STALE_EXPECTED_POINTER / NON_MONOTONIC_REVISION /
 *    POINTER_NOT_FOUND / CAS_UNAVAILABLE / CAS_REJECTED / CAS_ERROR
 *
 * ⚠️ 顺序约束（§9）：本函数是**最后一步** —— 所有关键 validation 必须已在此**之前**完成。
 *    绝不允许「先提升 pointer，再做 validation」。
 */
async function executePointerPromotion(input) {
  const inp = input || {};
  const adapter = inp.adapter;
  const scope = inp.scope || 'production';
  const plan = inp.plan || {};
  const expectedPointer = inp.expected_pointer || null;

  if (plan.action === POINTER_ACTION.ALREADY_ACTIVE) {
    return {
      promoted: false,
      action: POINTER_ACTION.ALREADY_ACTIVE,
      reason: 'already_active_same_run_id',
      cas_reason: 'ALREADY_ACTIVE',
      idempotent: true,
      previous_run_id: plan.run_id != null ? String(plan.run_id) : null,
      previous_revision: Number.isFinite(Number(plan.revision)) ? Number(plan.revision) : null,
      requested_run_id: plan.run_id != null ? String(plan.run_id) : null,
      requested_revision: Number.isFinite(Number(plan.revision)) ? Number(plan.revision) : null
    };
  }
  if (plan.action !== POINTER_ACTION.PROMOTE) {
    return { promoted: false, action: POINTER_ACTION.HOLD, reason: plan.reason, cas_reason: null, idempotent: false };
  }

  const res = await adapter.compareAndSetPointer(scope, expectedPointer, plan.next_pointer);
  if (!res || (res.ok !== true && res.promoted !== true)) {
    const casReason = (res && res.reason) || CAS_REASON.CAS_REJECTED;
    return {
      promoted: false,
      action: POINTER_ACTION.HOLD,
      reason: HOLD_REASON.CAS_REJECTED,
      cas_reason: casReason,
      idempotent: !!(res && res.idempotent),
      previous_run_id: res ? res.previous_run_id : null,
      previous_revision: res ? res.previous_revision : null,
      requested_run_id: res ? res.requested_run_id : null,
      requested_revision: res ? res.requested_revision : null,
      current: res ? res.current : null
    };
  }
  return {
    promoted: true,
    action: POINTER_ACTION.PROMOTE,
    reason: CAS_REASON.PROMOTED,
    cas_reason: CAS_REASON.PROMOTED,
    idempotent: false,
    previous_run_id: res.previous_run_id != null ? res.previous_run_id : null,
    previous_revision: res.previous_revision != null ? res.previous_revision : null,
    requested_run_id: res.requested_run_id != null ? res.requested_run_id : null,
    requested_revision: res.requested_revision != null ? res.requested_revision : null,
    pointer: plan.next_pointer,
    cas: res
  };
}

/**
 * 便捷编排：写候选 → 分类 → 校验 → 决定 → 提升。
 * ⚠️ 仅供 PoC 与测试使用；**不**接生产。
 */
async function runPublishFlow(input) {
  const inp = input || {};
  const adapter = inp.adapter;
  const scope = inp.scope || 'production';
  const manifest = inp.manifest;
  const decisions = inp.decisions || [];
  const portfolio = inp.portfolio || null;

  // 1) 保证 manifest 存在（写失败会被抛出 → 上层按 FAILED 处理）
  await adapter.putManifest(manifest);
  // 2) 逐条写候选（可部分成功）
  for (const d of decisions) {
    await adapter.putCandidate(POC_COLLECTIONS.RUN_CANDIDATE_DECISION, manifest.run_id, String(d.code), d);
  }
  if (portfolio) {
    await adapter.putCandidate(POC_COLLECTIONS.RUN_CANDIDATE_PORTFOLIO, manifest.run_id, 'portfolio', portfolio);
  }

  // 3) 从库里**回读**候选（不信任内存里的入参）
  const storedDecisions = await adapter.listCandidates(POC_COLLECTIONS.RUN_CANDIDATE_DECISION, manifest.run_id);
  const storedPortfolio = await adapter.getCandidate(POC_COLLECTIONS.RUN_CANDIDATE_PORTFOLIO, manifest.run_id, 'portfolio');

  // 4) 分类 + 校验 + 决定
  const finality = classifyCandidateSet(manifest, storedDecisions);
  const validation = validateCandidateSet({ manifest, decisions: storedDecisions, portfolio: storedPortfolio });
  const currentPointer = await adapter.getPointer(scope);
  const plan = planPointerPromotion({ finality, validation, manifest, current_pointer: currentPointer });

  const manifestStatus = finality.status;
  await adapter.putManifest(Object.assign({}, manifest, {
    status: manifestStatus,
    finality_health: finality.health_semantics,
    validation_passed: validation.passed,
    validation_reason: validation.reason
  }));

  // 5) 提升（可能被 crash 注入中断 —— 由测试在 adapter 层抛错模拟）
  const exec = await executePointerPromotion({
    adapter, scope, plan, expected_pointer: currentPointer
  });

  return { finality, validation, plan, exec, manifest_status: manifestStatus };
}

module.exports = {
  POC_COLLECTIONS,
  POINTER_ACTION,
  HOLD_REASON,
  expectedObjects,
  classifyCandidateSet,
  validateCandidateSet,
  planPointerPromotion,
  executePointerPromotion,
  readActive,
  runPublishFlow
};
