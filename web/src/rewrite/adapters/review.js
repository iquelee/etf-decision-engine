/**
 * 复盘适配器（web/src/rewrite/adapters/review.js）
 * 规范依据：SPEC §4.2 复盘 / §8.1（鉴权）/ §9
 *
 * ⚠️ 本端点**需鉴权**（`GET /api/review` 带 `X-Admin-Token`）。
 *   涉及账户快照 / 持仓 / 成交 / 实际执行 / 偏差的数据 ⛔ 不得成为公开页面（SPEC §8.1）。
 *
 * ⚠️ `/api/review` 线上未登录 ⇒ **真实响应结构本轮 [NOT VERIFIED]**（审计 §2.5）。
 *    本适配器按源码引用字段构造，标 `PENDING_LIVE_VERIFICATION`，M2 之后首次登录后校订。
 */
import { provided, missing, unavailable, readField, provenance } from '../domain/provenance.js';
import { FIELD_STATE, MISSING_REASON, AUTHORITY } from '../domain/enums.js';

const SRC = 'api:/api/review';
const P = (f) => provenance({ source: SRC + (f ? '.' + f : ''), authority: AUTHORITY.SAFETY_CORE });
const P_HIST = (f) => provenance({ source: SRC + (f ? '.' + f : ''), authority: AUTHORITY.OPERATOR });

export const REVIEW_LIVE_VERIFICATION = 'PENDING_LIVE_VERIFICATION';

export function adaptReview(data) {
  const empty = !data || typeof data !== 'object';
  return Object.freeze({
    available: !empty,
    liveVerification: REVIEW_LIVE_VERIFICATION,
    stats: adaptStats(empty ? null : data.stats),
    decisions: adaptDecisions(empty ? null : data.decisions),
    deviations: adaptDeviations(empty ? null : data.deviations),
    trades: adaptTrades(empty ? null : data.trades)
  });
}

/** 8 项统计（比率类为百分比数值，SPEC 附录 A.2） */
function adaptStats(s) {
  const P0 = P('stats');
  if (!s || typeof s !== 'object') {
    return Object.freeze({ available: false });
  }
  return Object.freeze({
    available: true,
    decisionSnapshotCount: readField(s, 'decision_snapshot_count', P0),
    actionableCount: readField(s, 'actionable_count', P0),
    executionRate: readField(s, 'execution_rate', P0),
    reverseOperationCount: readField(s, 'reverse_operation_count', P0),
    unexecutedCount: readField(s, 'unexecuted_count', P0),
    buildExecutionRate: readField(s, 'build_execution_rate', P0),
    defenseExecutionRate: readField(s, 'defense_execution_rate', P0),
    avgResponseDays: readField(s, 'avg_response_days', P0)
  });
}

function adaptDecisions(list) {
  const P0 = P('decisions');
  if (!Array.isArray(list)) return missing(MISSING_REASON.FIELD_ABSENT, P0);
  return provided(list.filter((d) => d && typeof d === 'object').map((d) => Object.freeze({
    id: readField(d, '_id', P0),
    decisionDate: readField(d, 'decision_date', P0),
    code: readField(d, 'code', P0),
    finalAction: readField(d, 'final_action', P0),
    actionLabel: readField(d, 'action_label', P0),
    currentPosition: readField(d, 'current_position', P0),
    positionSource: readField(d, 'position_source', P0),
    positionIsExact: readField(d, 'position_is_exact', P0),
    positionAsOfDate: readField(d, 'position_as_of_date', P0),
    /**
     * ★ 复盘行的 Gen-1 块（由 `buildReviewGen1` 产出，真实形状见 canonical/review.json）：
     *   { authority, status, signal_status, probability, stages,
     *     baseline_suggested_pct, counterfactual{…}, counterfactual_suggested_pct,
     *     delta_pct, domain_status, safety_permission }
     * ⛔ 审计 #7：旧前端读 `d.gen1.status.label` —— 契约里 `status` 是**字符串**，故恒为 undefined。
     * ⛔ 该块**不得**携带 `final*` / `action_code`（UI-G1-13），故此处不产出这些字段。
     */
    gen1: adaptReviewGen1(d.gen1)
  })), P0);
}

function adaptReviewGen1(g) {
  const PG = provenance({ source: SRC + '.decisions[].gen1', authority: AUTHORITY.GEN1 });
  if (!g || typeof g !== 'object') {
    return Object.freeze({
      available: false,
      status: unavailable(MISSING_REASON.CONTRACT_NOT_PROVIDED, PG),
      authority: unavailable(MISSING_REASON.CONTRACT_NOT_PROVIDED, PG)
    });
  }
  const cf = g.counterfactual && typeof g.counterfactual === 'object' ? g.counterfactual : null;
  const stg = g.stages && typeof g.stages === 'object' ? g.stages : null;
  return Object.freeze({
    available: true,
    authority: readField(g, 'authority', PG),
    status: readField(g, 'status', PG),
    signalStatus: readField(g, 'signal_status', PG),
    probability: readField(g, 'probability', PG),
    baselineSuggestedPct: readField(g, 'baseline_suggested_pct', PG),
    counterfactualSuggestedPct: readField(g, 'counterfactual_suggested_pct', PG),
    deltaPct: readField(g, 'delta_pct', PG),
    domainStatus: readField(g, 'domain_status', PG),
    safetyPermission: readField(g, 'safety_permission', PG),
    stages: Object.freeze({
      signal: readField(stg, 'signal', PG),
      baseline: readField(stg, 'baseline', PG),
      effective: readField(stg, 'effective', PG)
    }),
    counterfactual: Object.freeze({
      targetPct: readField(cf, 'target_pct', PG),
      suggestedPct: readField(cf, 'suggested_pct', PG),
      deltaPct: readField(cf, 'delta_pct', PG)
    })
  });
}

function adaptDeviations(list) {
  const P0 = P_HIST('deviations');
  if (!Array.isArray(list)) return missing(MISSING_REASON.FIELD_ABSENT, P0);
  return provided(list.filter((d) => d && typeof d === 'object').map((d) => Object.freeze({
    decisionId: readField(d, 'decision_id', P0),
    date: readField(d, 'date', P0),
    operationDate: readField(d, 'operation_date', P0),
    code: readField(d, 'code', P0),
    systemAction: readField(d, 'system_action', P0),
    actualAction: readField(d, 'actual_action', P0),
    deviation: readField(d, 'deviation', P0),
    matchedBy: readField(d, 'matched_by', P0)
  })), P0);
}

function adaptTrades(list) {
  const P0 = P_HIST('trades');
  if (!Array.isArray(list)) return missing(MISSING_REASON.FIELD_ABSENT, P0);
  return provided(list.filter((t) => t && typeof t === 'object').map((t) => Object.freeze({
    tradeDate: readField(t, 'trade_date', P0),
    code: readField(t, 'code', P0),
    action: readField(t, 'action', P0),
    positionAfter: readField(t, 'position_after', P0),
    systemAction: readField(t, 'system_action', P0),
    systemDecisionDate: readField(t, 'system_decision_date', P0),
    systemMatchType: readField(t, 'system_match_type', P0)
  })), P0);
}

export { FIELD_STATE };
