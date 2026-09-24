'use strict';

/**
 * V3.6.5 契约版本中央声明（B0）。
 *
 * 设计约束（任务书 §2）：
 *   - V3.6.5 必须拥有**自己的**身份与契约版本，⛔ 不得依赖 V3.6.4 manifest 自证完整性。
 *   - 本文件是 version 常量的**唯一来源**；生成器 / 校验器 / 运行时一律从这里取。
 *   - ⛔ 文件内**不含**任何时间戳、随机值、环境相关值 ⇒ 可确定性重算。
 *
 * ⚠️ 与 V3.6.4 的关系：
 *   `ml/manifests/V361_IMMUTABLE_LOCK.json` / `V364_IMMUTABLE_LOCK.json` 继续只代表
 *   **V3.6.4 历史冻结件**。V3.6.5 修改了其中若干文件的内容，但**绝不回写**那两个 lock
 *   —— V3.6.5 的完整性由 `ml/manifests/V365_CANDIDATE_MANIFEST.json` + 本文件自行声明。
 */

/* ------------------------------------------------------------------ *
 * 引擎身份
 * ------------------------------------------------------------------ */
const ENGINE_VERSION = 'v3.6.5';
const RELEASE_KIND = 'PRODUCTION_INTEGRITY';   // ⛔ 不是 Alpha、不是策略版本
const PARENT_PRODUCTION_VERSION = 'v3.6.4';

/* ------------------------------------------------------------------ *
 * 数据契约
 * ------------------------------------------------------------------ */
// 生产 `indicator_snapshot` **真实**字段集 = 31（P-A 实证；缺 breakout_nd）。
// V3.6.5 按真实 31-field contract 工作，⛔ 不恢复 breakout_nd。
const INPUT_CONTRACT_VERSION = 'live-31-v1';
const INPUT_CONTRACT_FIELD_COUNT = 31;
const INPUT_CONTRACT_EXCLUDED_FIELDS = Object.freeze(['breakout_nd']);

const CALENDAR_VERSION = 'cn-a-share-2026.1';
const CALENDAR_MARKET = 'CN_A_SHARE';
const CALENDAR_ARTIFACT_PATH = 'src/common/data/cn-trading-calendar.v1.json';
const CALENDAR_MANIFEST_PATH = 'src/common/data/cn-trading-calendar.v1.manifest.json';

/* ------------------------------------------------------------------ *
 * 协议版本（每个工作包一个，便于独立演进与审计）
 * ------------------------------------------------------------------ */
const PIPELINE_CONTRACT_VERSION = 'pipeline-correlation-v1';
const RUN_CONTEXT_VERSION = 'v361-run-context-v2';   // v2 = 三日期语义 + DATE_ALIGNMENT_CASE
const RUN_FINALITY_VERSION = 'v361-run-finality-v1';
const PUBLISH_PROTOCOL_VERSION = 'v365-two-stage-v1';

/* ------------------------------------------------------------------ *
 * 发布协议的集合命名（语义，不是"必须用这些物理名"）
 * ------------------------------------------------------------------ */
const V365_COLLECTIONS = Object.freeze({
  RUN_MANIFEST: 'run_manifest',
  CANDIDATE_DECISION: 'run_candidate_decision',
  CANDIDATE_PORTFOLIO: 'run_candidate_portfolio',
  ACTIVE_POINTER: 'active_run_pointer'
});

const POINTER_SCOPE_PRODUCTION = 'production';

/* ------------------------------------------------------------------ *
 * 平台 CAS 证据状态（Q7 重裁，2026-09-24）
 * ------------------------------------------------------------------ *
 * ── 重裁背景 ──────────────────────────────────────────────────────────
 * 旧版把 `REAL_TRANSACTION_API` 当成 Q7 的**必要实现机制**。真实平台实测推翻了这一点：
 *   • `tcb.RunCommands` 的 `{"startTransaction":1}` → `CommandNotFound: no such command`
 *     ⇒ 该通道**没有**多文档事务命令（`transaction_command_available = false`）；
 *   • `[有效写, 非法命令]` 批量 ⇒ 前半**已生效**、整体报错
 *     ⇒ `multi_command_batch_atomic = false`（⛔ 不得用批量伪造成事务）；
 *   • 而本协议的 atomicity 定义（单一 active pointer 切换）**本来就只要求单文档原子性** ——
 *     单文档 `findAndModify + expected-current filter + revision guard` 在真实平台
 *     **八项语义全部 PASS**（CAS-1~CAS-7 + 并发，见 `docs/V365_PLATFORM_CAS_EVIDENCE.md`）。
 * ⇒ 正式裁定：`TRANSACTION_REQUIRED = NO` / `PLATFORM_SINGLE_DOCUMENT_CAS_REQUIRED = YES`。
 *   这是 **implementation selection correction**（判据从"用了什么机制"改为"是否真的原子"），
 *   **不是**放宽安全标准：放行同时要求「平台实证」**且**「实现对齐」。
 *
 * ⛔ 不得手工把 `implementation_uses_single_document_cas` 置 true —— 它必须与
 *    `v365-publish-store.js` 的实际实现一致（由测试静态断言守住）。
 */
const CAS_EVIDENCE = Object.freeze({
  // 机制裁定
  transaction_required: false,
  platform_single_document_cas_required: true,

  // 平台实证（来自一次性隔离探针；集合已 drop、无残留）
  channel_evidence: 'tcb.RunCommands',
  probe_collection: '_v365_cas_probe',
  probe_date: '2026-09-24',
  platform_single_document_cas_verified: true,   // CAS-1~CAS-7 + 并发全部 PASS
  evidence_doc: 'docs/V365_PLATFORM_CAS_EVIDENCE.md',

  // 平台**负向**事实（如实记录，不得当成"已具备"）
  transaction_command_available: false,
  multi_command_batch_atomic: false,

  // 实现对齐（本轮把 publish-store 从 runTransaction 改为单文档条件 CAS 后置 true）
  implementation_uses_single_document_cas: true
});

/**
 * 发布协议是否被允许执行 promotion。
 *
 * fail-closed **双重门**（⛔ 比旧版更严）：
 *   ① 平台已实证单文档条件 CAS；
 *   ② **实现**确已对齐该机制。
 * 两者缺一即 false。
 */
function publishPromotionAllowed() {
  return CAS_EVIDENCE.platform_single_document_cas_verified === true
    && CAS_EVIDENCE.implementation_uses_single_document_cas === true;
}

module.exports = {
  ENGINE_VERSION,
  RELEASE_KIND,
  PARENT_PRODUCTION_VERSION,
  INPUT_CONTRACT_VERSION,
  INPUT_CONTRACT_FIELD_COUNT,
  INPUT_CONTRACT_EXCLUDED_FIELDS,
  CALENDAR_VERSION,
  CALENDAR_MARKET,
  CALENDAR_ARTIFACT_PATH,
  CALENDAR_MANIFEST_PATH,
  PIPELINE_CONTRACT_VERSION,
  RUN_CONTEXT_VERSION,
  RUN_FINALITY_VERSION,
  PUBLISH_PROTOCOL_VERSION,
  V365_COLLECTIONS,
  POINTER_SCOPE_PRODUCTION,
  CAS_EVIDENCE,
  publishPromotionAllowed
};
