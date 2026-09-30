/**
 * adapters 层出口（web/src/rewrite/adapters/index.js）
 *
 * ⚠️ 引用约定：
 *   · **只有 `compose/**` 可以 import 本模块**（SPEC §2.2）；
 *   · `views/**` / `components/**` / `layouts/**` ⛔ 不得 import（由 layering test 守卫）。
 *
 * 职责：raw backend response → 领域对象（全 `Field<T>`）→ 交给 domain 做阈值/格式化。
 */
export { adaptDecision, displayRisk, displayOverAlloc, displayState } from './decision.js';
export { adaptEtfDetail } from './etfDetail.js';
export { adaptDashboard } from './dashboard.js';
export { adaptKline, movingAverage } from './kline.js';
export { adaptConstants, adaptRuntimeStatus } from './constants.js';
export { adaptReview, REVIEW_LIVE_VERIFICATION } from './review.js';
export { adaptFundamentals, adaptIntel, filterIntelByCode, LAYER_KEYS } from './fundamentals.js';
export {
  adaptGen1Health, adaptGen2Shadow, adaptFetchLog, adaptParams, unwrapParamValue,
  adaptTrades, adaptSnapshotResult, adaptFundamentalConfig, adaptFundamentalSeries,
  adaptHoldings, adaptRiskEvents, fetchStatusLabel, fetchStatusTone,
  FETCH_STATUS, RISK_EVENT_TYPES
} from './adminRuntime.js';
export {
  adaptGen1, legacyFallback, hasCanonicalContract, resolveAuthority,
  scanForbiddenKeys, LEGACY_SEMANTIC_KEYS, CANONICAL_BLOCKS
} from './gen1.js';
