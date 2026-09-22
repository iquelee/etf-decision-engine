/**
 * V3.6.1 Safety Hardening R1 —— Run Finality 诊断设计（缺陷 #6）
 *
 * 背景：
 *   旧 `runDecisionEngine` 逐只 ETF 循环，某只成功落库、某只抛错被 catch 之后
 *   函数**仍然可能返回 `ok:true`**。也就是说「部分 ETF 没算出结果」这件事
 *   在返回值里没有任何痕迹 —— 读者会把 PARTIAL 当成 COMPLETE。
 *
 * 本轮定位：
 *   - 定义三种终局：`COMPLETE` / `PARTIAL` / `FAILED`；
 *   - 返回体必须带 `expected_count` / `success_count` / `failed_count` / `failed_codes`；
 *   - **PARTIAL 不得与 COMPLETE 使用相同健康语义**（本节用 `health_semantics` 表达）；
 *   - 同时给出「两阶段发布」的实现方案（纯函数 + 文档），
 *     本轮**不改变**生产写入路径（仍按 legacy 单阶段写库）。
 *
 * 本文件为**纯函数**。
 */
'use strict';

const RUN_STATUS = Object.freeze({
  COMPLETE: 'COMPLETE',
  PARTIAL: 'PARTIAL',
  FAILED: 'FAILED'
});

/** 与 run status 一一对应的健康语义 —— PARTIAL 与 COMPLETE 必须不同 */
const HEALTH_SEMANTICS = Object.freeze({
  [RUN_STATUS.COMPLETE]: 'HEALTHY',
  [RUN_STATUS.PARTIAL]: 'DEGRADED',
  [RUN_STATUS.FAILED]: 'UNHEALTHY'
});

/** 两阶段发布的运行阶段（设计；本轮不改生产写入） */
const PUBLISH_PHASE = Object.freeze({
  CALCULATING: 'CALCULATING',
  CANDIDATE_READY: 'CANDIDATE_READY',
  VALIDATED: 'VALIDATED',
  COMPLETED: 'COMPLETED',
  ACTIVE: 'ACTIVE'
});

/**
 * 单次 run 的终局分类。
 *
 * @param {object} input
 *   - expected_codes {string[]} 本次应到的标的（权威清单）
 *   - results {Object<string,{ok?:boolean, error?:string}>} code → 单票结果
 * @returns {{status:string, expected_count:number, success_count:number, failed_count:number,
 *            failed_codes:string[], missing_codes:string[],
 *            health_semantics:string, publishable:boolean, reason:string|null}}
 */
function classifyRunFinality(input) {
  const inp = input || {};
  const expected = Array.isArray(inp.expected_codes)
    ? inp.expected_codes.filter((c) => c != null).map(String) : [];
  const results = inp.results || {};

  const failedCodes = [];
  const missingCodes = [];
  let successCount = 0;

  expected.forEach((code) => {
    const r = results[code];
    if (r == null) { missingCodes.push(code); return; }
    if (r.ok === true) successCount += 1;
    else failedCodes.push(code);
  });

  const expectedCount = expected.length;
  const failedCount = failedCodes.length + missingCodes.length;

  let status;
  let reason = null;
  if (expectedCount === 0) {
    status = RUN_STATUS.FAILED;
    reason = 'no_expected_codes';
  } else if (successCount === expectedCount) {
    status = RUN_STATUS.COMPLETE;
  } else if (successCount === 0) {
    status = RUN_STATUS.FAILED;
    reason = 'no_successful_etf';
  } else {
    status = RUN_STATUS.PARTIAL;
    reason = 'partial_etf_failure';
  }

  return {
    status,
    expected_count: expectedCount,
    success_count: successCount,
    failed_count: failedCount,
    failed_codes: failedCodes.concat(missingCodes),
    missing_codes: missingCodes,
    health_semantics: HEALTH_SEMANTICS[status],
    // 只有 COMPLETE 才允许「整体发布为 active run」；PARTIAL/FAILED 一律不得发布
    publishable: status === RUN_STATUS.COMPLETE,
    reason
  };
}

/**
 * PARTIAL 是否与 COMPLETE 语义等价（必须恒为 false）。
 * 提供给测试与守卫使用，防止后续有人把两者收敛成同一个 ok。
 */
function isPartialIndistinguishableFromComplete(finality) {
  const f = finality || {};
  if (f.status !== RUN_STATUS.PARTIAL) return false;
  return f.health_semantics === HEALTH_SEMANTICS[RUN_STATUS.COMPLETE] || f.publishable === true;
}

/**
 * 两阶段发布：把「写入候选」与「整体校验通过后切换为 active」拆开。
 *
 * 方案（下一阶段实施，本轮仅设计 + 纯函数可测）：
 *   1. CALCULATING       ：逐只 ETF 计算，只写 `run_candidate`（带 run_id / input_hash），
 *                          绝不写 `decision_result` / `portfolio_snapshot` 的 active 版本；
 *   2. CANDIDATE_READY   ：所有 expected_codes 都有候选（含显式失败标记）；
 *   3. VALIDATED         ：整体校验（集合完整、日期同源、健康度、不变量）；
 *   4. COMPLETED         ：校验 PASS 才把候选标记为 COMPLETED；
 *   5. ACTIVE            ：唯一一次原子切换，把 COMPLETED 的候选提升为 active run。
 *   校验 FAIL ⇒ 保持上一次 active run 不变（fail-closed，不产生半成品快照）。
 *
 * @param {object} args { finality, validation }
 * @returns {{phase:string, next_phase:string|null, action:string, reason:string|null}}
 */
function planTwoStagePublish(args) {
  const a = args || {};
  const finality = a.finality || {};
  const validation = a.validation || {};

  if (finality.status !== RUN_STATUS.COMPLETE) {
    return {
      phase: PUBLISH_PHASE.CANDIDATE_READY,
      next_phase: null,
      action: 'hold_candidate',
      reason: `run_not_complete:${finality.status || 'UNKNOWN'}`
    };
  }
  if (validation.passed !== true) {
    return {
      phase: PUBLISH_PHASE.CANDIDATE_READY,
      next_phase: null,
      action: 'hold_candidate',
      reason: `validation_failed:${validation.reason || 'unknown'}`
    };
  }
  return {
    phase: PUBLISH_PHASE.VALIDATED,
    next_phase: PUBLISH_PHASE.ACTIVE,
    action: 'promote_active',
    reason: null
  };
}

module.exports = {
  RUN_STATUS,
  HEALTH_SEMANTICS,
  PUBLISH_PHASE,
  classifyRunFinality,
  isPartialIndistinguishableFromComplete,
  planTwoStagePublish
};
