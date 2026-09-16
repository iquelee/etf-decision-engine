/**
 * Gen-1 Guarded Effective 封印（WP-G1-GE-02）。
 *
 * 本模块承载章程 §3.1 的 **Key 2（Freeze Seal）** 与 **Key 3（Evidence Seal）** 的
 * 评估与读取。设计原则：
 *
 *   1. **fail-closed**：读不到 / 解析失败 / 状态非 APPROVED(或 PASS) / 绑定缺失或不一致
 *      ⇒ 一律 `false`。绝不因为「没读到」而放行。
 *   2. **纯函数评估 + 显式注入**：`evaluateGuardedSeal()` 不碰文件系统，便于单测注入
 *      synthetic APPROVED / PASS 覆盖真值逻辑。
 *   3. **生产制品恒不可通过**：GE-02 阶段仓库内的两份制品状态为 PENDING
 *      （见 ml/manifests/GEN1_GUARDED_EFFECTIVE_FREEZE.json /
 *        ml/manifests/GEN1_GUARDED_EFFECTIVE_EVIDENCE.json）。
 *      这是**第二层保证**：即使有人误把 `param_config.gen1_authority` 改成
 *      `GUARDED_EFFECTIVE`，`effective_guarded` 仍然为 false。
 *
 * ⚠️ 本模块**不**授予任何生产写权限：它只回答「守门条件是否成立」。
 *    `final_target` / `final_action` 的唯一产出方始终是 V3.6.1 Safety Core。
 *
 * @module gen1-guarded-seal
 */
'use strict';

const fs = require('fs');
const path = require('path');

const FREEZE_SEAL_ID = 'GUARDED_EFFECTIVE_FREEZE';
const EVIDENCE_SEAL_ID = 'GUARDED_EFFECTIVE_EVIDENCE';

/** Freeze Seal 状态词表（只有 APPROVED 允许通过）。 */
const FREEZE_STATUS = Object.freeze({
  MISSING: 'MISSING',
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REVOKED: 'REVOKED'
});

/** Evidence Seal 状态词表（只有 PASS 允许通过）。 */
const EVIDENCE_STATUS = Object.freeze({
  MISSING: 'MISSING',
  PENDING: 'PENDING',
  PASS: 'PASS',
  FAIL: 'FAIL'
});

/**
 * Freeze Seal 必须绑定的四项（章程 §3.1 Key 2）。
 * 四项须与**运行期实读**逐项一致，任一项缺失或不等 ⇒ 不通过。
 */
const FREEZE_BINDING_FIELDS = Object.freeze([
  'source_sha256', 'model_sha256', 'threshold_version', 'contract_version'
]);

/** 契约版本（与章程 WP-G1-GE-CH-1.0 一致，作为 contract_version 绑定的期望值常量）。 */
const GUARDED_CONTRACT_VERSION = 'WP-G1-GE-CH-1.0';
/** 冻结阈值版本（GEN1_FEATURE_PIPELINE_LOCK.derived.threshold_version）。 */
const GUARDED_THRESHOLD_VERSION = 'shadow-threshold-v1';
/** 证据门硬前置：独立事件下限（章程 §5.1 / GEN1_EVIDENCE_CONTRACT §4.2）。 */
const MIN_INDEPENDENT_EVENTS = 30;

/** 制品相对仓库路径（也是 build-cloudfunctions.js EXTRA_FILES 的来源）。 */
const ARTIFACT_PATHS = Object.freeze({
  freeze: 'ml/manifests/GEN1_GUARDED_EFFECTIVE_FREEZE.json',
  evidence: 'ml/manifests/GEN1_GUARDED_EFFECTIVE_EVIDENCE.json'
});

/** 拒绝原因码词表（稳定，供审计/测试引用）。 */
const SEAL_REASON = Object.freeze({
  FREEZE_MISSING: 'FREEZE_SEAL_MISSING',
  FREEZE_NOT_APPROVED: 'FREEZE_SEAL_NOT_APPROVED',
  FREEZE_BINDING_UNVERIFIABLE: 'FREEZE_SEAL_BINDING_UNVERIFIABLE',
  FREEZE_BINDING_MISMATCH: 'FREEZE_SEAL_BINDING_MISMATCH',
  EVIDENCE_MISSING: 'EVIDENCE_SEAL_MISSING',
  EVIDENCE_NOT_PASS: 'EVIDENCE_SEAL_NOT_PASS',
  EVIDENCE_INSUFFICIENT_EVENTS: 'EVIDENCE_SEAL_INSUFFICIENT_EVENTS',
  READ_OK: 'SEAL_ARTIFACTS_READ_OK',
  READ_PARTIAL: 'SEAL_ARTIFACTS_PARTIAL',
  READ_MISSING: 'SEAL_ARTIFACTS_MISSING'
});

function pick(v) {
  return v == null ? '' : String(v).trim();
}

function normStatus(v, table, fallback) {
  const s = pick(v).toUpperCase();
  return Object.prototype.hasOwnProperty.call(table, s) ? s : fallback;
}

function numOrNull(v) {
  return v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
}

/**
 * 评估 Freeze / Evidence 两把封印（**纯函数**，不读文件、无副作用）。
 *
 * @param {object} input
 * @param {object|null} [input.freeze]    Freeze 制品内容（缺失 ⇒ MISSING ⇒ 不通过）
 * @param {object|null} [input.evidence]  Evidence 制品内容（缺失 ⇒ MISSING ⇒ 不通过）
 * @param {object} [input.runtime]        运行期实读的绑定值（四项之一）
 * @returns {{
 *   freeze_seal_status: string, freeze_seal_approved: boolean, freeze_seal_reason_code: string|null,
 *   freeze_binding_checks: object, freeze_binding_complete: boolean,
 *   evidence_seal_status: string, evidence_seal_pass: boolean, evidence_seal_reason_code: string|null,
 *   evidence_independent_events: number|null, evidence_min_independent_events: number,
 *   contract_version: string
 * }}
 */
function evaluateGuardedSeal(input) {
  const src = input || {};
  const freeze = src.freeze || null;
  const evidence = src.evidence || null;
  const runtime = src.runtime || {};

  /* ---------- Key 2：Freeze Seal ---------- */
  const freezeStatus = freeze == null
    ? FREEZE_STATUS.MISSING
    : normStatus(freeze.status, FREEZE_STATUS, FREEZE_STATUS.MISSING);

  const bindingChecks = {};
  const unverifiable = [];
  const mismatched = [];
  for (const f of FREEZE_BINDING_FIELDS) {
    const claimed = pick(freeze && freeze[f]);
    const observed = pick(runtime[f]);
    if (claimed === '' || observed === '') {
      bindingChecks[f] = { claimed: claimed || null, observed: observed || null, ok: false, reason: 'UNVERIFIABLE' };
      unverifiable.push(f);
      continue;
    }
    const ok = claimed === observed;
    bindingChecks[f] = { claimed, observed, ok, reason: ok ? null : 'MISMATCH' };
    if (!ok) mismatched.push(f);
  }
  const bindingComplete = unverifiable.length === 0 && mismatched.length === 0;

  let freezeReason = null;
  if (freeze == null) freezeReason = SEAL_REASON.FREEZE_MISSING;
  else if (freezeStatus !== FREEZE_STATUS.APPROVED) {
    freezeReason = `${SEAL_REASON.FREEZE_NOT_APPROVED}:${freezeStatus}`;
  } else if (unverifiable.length) freezeReason = SEAL_REASON.FREEZE_BINDING_UNVERIFIABLE;
  else if (mismatched.length) freezeReason = SEAL_REASON.FREEZE_BINDING_MISMATCH;
  const freezeApproved = freezeReason == null;

  /* ---------- Key 3：Evidence Seal ---------- */
  const evidenceStatus = evidence == null
    ? EVIDENCE_STATUS.MISSING
    : normStatus(evidence.status, EVIDENCE_STATUS, EVIDENCE_STATUS.MISSING);
  const events = numOrNull(evidence && evidence.independent_events);

  let evidenceReason = null;
  if (evidence == null) evidenceReason = SEAL_REASON.EVIDENCE_MISSING;
  else if (evidenceStatus !== EVIDENCE_STATUS.PASS) {
    evidenceReason = `${SEAL_REASON.EVIDENCE_NOT_PASS}:${evidenceStatus}`;
  } else if (events == null || events < MIN_INDEPENDENT_EVENTS) {
    evidenceReason = SEAL_REASON.EVIDENCE_INSUFFICIENT_EVENTS;
  }
  const evidencePass = evidenceReason == null;

  return {
    freeze_seal_id: FREEZE_SEAL_ID,
    freeze_seal_status: freezeStatus,
    freeze_seal_approved: freezeApproved,
    freeze_seal_reason_code: freezeReason,
    freeze_binding_checks: bindingChecks,
    freeze_binding_complete: bindingComplete,
    freeze_binding_unverifiable: unverifiable.slice(),
    freeze_binding_mismatched: mismatched.slice(),
    evidence_seal_id: EVIDENCE_SEAL_ID,
    evidence_seal_status: evidenceStatus,
    evidence_seal_pass: evidencePass,
    evidence_seal_reason_code: evidenceReason,
    evidence_independent_events: events,
    evidence_min_independent_events: MIN_INDEPENDENT_EVENTS,
    contract_version: GUARDED_CONTRACT_VERSION
  };
}

/**
 * 候选制品路径（按优先级）：
 *   ① 环境变量显式指定（运维/取证用）
 *   ② 随云函数部署的产物副本 `<fn>/<basename>`（build-cloudfunctions EXTRA_FILES 落点）
 *   ③ 仓库根 `ml/manifests/<basename>`（本地运行 / 单测）
 */
function candidatesFor(relPath, envVar, baseDir) {
  const base = baseDir || __dirname;
  const out = [];
  const env = process.env[envVar];
  if (env) out.push(env);
  out.push(path.join(base, '..', '..', path.basename(relPath)));
  out.push(path.join(base, '..', '..', '..', relPath));
  return out;
}

/** 依次尝试候选路径；任一步异常都继续尝试（全部失败 ⇒ 视为缺失 ⇒ fail-closed）。 */
function readFirstJson(cands) {
  for (const p of cands) {
    try {
      if (p && fs.existsSync(p)) {
        return { found: true, path: p, value: JSON.parse(fs.readFileSync(p, 'utf8')) };
      }
    } catch (e) {
      // 解析/读取失败不视为「已找到」：继续尝试，最终 fail-closed
    }
  }
  return { found: false, path: null, value: null };
}

/**
 * 生产读取入口：读两份制品 + 与运行期绑定值比对，返回 `evaluateGuardedSeal()` 结果
 * 外加读取元信息。**任何异常都不抛出**，一律降级为 false（fail-closed）。
 *
 * @param {object} [runtimeBindings] 运行期可实读的绑定值（缺失项保持缺省 ⇒ UNVERIFIABLE）
 * @param {object} [opts] `{ baseDir }`（测试注入用）
 */
function readProductionSeals(runtimeBindings, opts) {
  const o = opts || {};
  let freezeRead = { found: false, path: null, value: null };
  let evidenceRead = { found: false, path: null, value: null };
  try {
    freezeRead = readFirstJson(candidatesFor(
      ARTIFACT_PATHS.freeze, 'GEN1_GUARDED_EFFECTIVE_FREEZE_PATH', o.baseDir));
    evidenceRead = readFirstJson(candidatesFor(
      ARTIFACT_PATHS.evidence, 'GEN1_GUARDED_EFFECTIVE_EVIDENCE_PATH', o.baseDir));
  } catch (e) {
    // 读取层异常 ⇒ 保持 MISSING（fail-closed）
  }

  const evaluated = evaluateGuardedSeal({
    freeze: freezeRead.found ? freezeRead.value : null,
    evidence: evidenceRead.found ? evidenceRead.value : null,
    runtime: runtimeBindings || {}
  });

  const foundCount = (freezeRead.found ? 1 : 0) + (evidenceRead.found ? 1 : 0);
  return Object.assign(evaluated, {
    freeze_artifact_path: freezeRead.path,
    evidence_artifact_path: evidenceRead.path,
    read_status: foundCount === 2 ? 'OK' : (foundCount === 0 ? 'MISSING' : 'PARTIAL'),
    read_reason_code: foundCount === 2 ? SEAL_REASON.READ_OK
      : (foundCount === 0 ? SEAL_REASON.READ_MISSING : SEAL_REASON.READ_PARTIAL)
  });
}

module.exports = {
  FREEZE_SEAL_ID,
  EVIDENCE_SEAL_ID,
  FREEZE_STATUS,
  EVIDENCE_STATUS,
  FREEZE_BINDING_FIELDS,
  GUARDED_CONTRACT_VERSION,
  GUARDED_THRESHOLD_VERSION,
  MIN_INDEPENDENT_EVENTS,
  ARTIFACT_PATHS,
  SEAL_REASON,
  evaluateGuardedSeal,
  readProductionSeals
};
