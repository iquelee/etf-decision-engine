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
 * 事务 / CAS 证据状态（§10）
 * ------------------------------------------------------------------ *
 * `PLATFORM_CAS_VERIFIED` 只有在**实测两个并发 promotion** 并证明 stale run 无法覆盖
 * newer run 之后才可为 `true`。⛔ 不得因为"读到了 API 签名"就置 true。
 */
const CAS_EVIDENCE = Object.freeze({
  api_present: true,                  // @cloudbase/node-sdk 2.11.0 Db.runTransaction 存在（types/index.d.ts:467-468）
  semantics_documented_in_repo: false, // 本仓文档未给隔离级别/冲突重试契约
  platform_concurrency_tested: false  // 需一次性授权的真实集合写测试
});

/**
 * 发布协议是否被允许执行 promotion。
 * fail-closed：平台 CAS 未取得并发实证 ⇒ 一律不得提升。
 */
function publishPromotionAllowed() {
  return CAS_EVIDENCE.platform_concurrency_tested === true;
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
