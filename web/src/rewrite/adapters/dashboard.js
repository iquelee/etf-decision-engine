/**
 * Dashboard 适配器（web/src/rewrite/adapters/dashboard.js）
 * 规范依据：SPEC §2 / §4.2 / §9 / 附录 A
 *
 * ★ 本适配器承载**首轮审计发现的契约断裂修复**（审计 §3.6）：
 *   #1 `three_questions.market_regime` 线上不存在（实际为 `market_status`）
 *      ⇒ 改为：优先 `overview.market_regime`（枚举，语义更稳），
 *              `three_questions.market_status` 仅作展示兜底。
 *   #3 `three_questions.risk_status` 不存在 ⇒ 改读 `overview.overall_risk`。
 *   #4 `overview.leverage_alert` / `total_book_pct` 不存在 ⇒ 不再虚构该区块（SPEC §11.4①）。
 *   #5 `cards[].gen1` 不存在 ⇒ Gen-1 分层改由契约 `production` / `gen1` 提供；
 *      cards 只暴露 Safety Core 口径，⛔ 不静默把 legacy 当 Gen-1。
 */
import {
  provided, missing, unavailable, readField, readBlock, provenance
} from '../domain/provenance.js';
import { FIELD_STATE, MISSING_REASON, AUTHORITY } from '../domain/enums.js';
import { adaptGen1, hasCanonicalContract, legacyFallback } from './gen1.js';
import { assess } from '../domain/freshness.js';

const SRC = 'api:/api/dashboard';
const P = (f) => provenance({ source: SRC + (f ? '.' + f : ''), authority: AUTHORITY.SAFETY_CORE });
const P_OPS = (f) => provenance({ source: SRC + (f ? '.' + f : ''), authority: AUTHORITY.OPERATOR });

/**
 * @param {object|null} data `/api/dashboard` 的 data
 * @param {object|null} runtimeStatus `/api/constants` 的 runtime_status（可选）
 */
export function adaptDashboard(data, runtimeStatus = null) {
  const empty = !data || typeof data !== 'object';
  const overview = empty ? null : data.overview;
  const tq = empty ? null : data.three_questions;

  return Object.freeze({
    available: !empty,

    /* ---- 引擎模式（运维元数据，⛔ 不是决策口径）---- */
    engineMode: readField(data, 'engine_mode', P_OPS('engine_mode')),
    v3Mode: readField(data, 'v3_mode', P_OPS('v3_mode')),

    /* ---- 结论带（SPEC §4.2 全局首屏）---- */
    headline: adaptHeadline(overview, tq),

    /* ---- 组合状态（金额默认遮罩由 UI 负责）---- */
    account: adaptAccount(overview),

    /* ---- 5 张标的卡 ---- */
    cards: adaptCards(empty ? null : data.cards),

    /* ---- Gen-1 / 契约分层 ---- */
    gen1: adaptGen1(data),
    legacyFallback: legacyFallback(data, runtimeStatus),

    /* ---- 系统运行状态（折叠区）---- */
    systemStatus: adaptSystemStatus(empty ? null : data.ml_shadow),

    freshness: Object.freeze({
      overview: assess(overview && overview.snapshot_date, 'snapshot')
    })
  });
}

/**
 * ★ 契约断裂修复点。
 * - 市场环境：优先 `overview.market_regime`（内部枚举）→ 兜底 `three_questions.market_status`（已本地化文案）
 * - 风险：`overview.overall_risk`
 * - Gen-1 一句话：**契约缺位时明确 UNAVAILABLE**，⛔ 不用 legacy 冒充（SPEC §6.3 / D-1）
 */
function adaptHeadline(overview, tq) {
  const regimeEnum = readField(overview, 'market_regime', P('overview.market_regime'));
  const marketStatus = readField(tq, 'market_status', P('three_questions.market_status'));
  const risk = readField(overview, 'overall_risk', P('overview.overall_risk'));

  let marketRegime;
  if (regimeEnum.state === FIELD_STATE.PROVIDED) {
    marketRegime = regimeEnum;
  } else if (marketStatus.state === FIELD_STATE.PROVIDED) {
    // 展示兜底：仅当枚举缺失时才用已本地化的 market_status
    marketRegime = provided(marketStatus.value, provenance({
      source: 'api:/api/dashboard#three_questions.market_status',
      authority: AUTHORITY.SAFETY_CORE,
      derived: true
    }));
  } else {
    marketRegime = unavailable(MISSING_REASON.CONTRACT_NOT_PROVIDED, P('overview.market_regime'));
  }

  return Object.freeze({
    marketRegime,
    /** 是否使用了展示兜底（UI 可据此决定是否标注「来源：market_status」） */
    marketRegimeIsFallback: regimeEnum.state !== FIELD_STATE.PROVIDED && marketStatus.state === FIELD_STATE.PROVIDED,
    risk,
    /** 值得关注 / 需防守（线上 `most_worth` 实测为 null ⇒ MISSING，不是 UNAVAILABLE） */
    mostWorth: readField(tq, 'most_worth', P('three_questions.most_worth')),
    mostDefend: readBlock(tq, 'most_defend', P('three_questions.most_defend')),
    snapshotDate: readField(overview, 'snapshot_date', P('overview.snapshot_date'))
  });
}

function adaptAccount(o) {
  const P0 = P('overview');
  return Object.freeze({
    cashRatio: readField(o, 'cash_ratio', P0),
    techPosition: readField(o, 'tech_position', P0),
    goldPosition: readField(o, 'gold_position', P0),
    innovationPosition: readField(o, 'innovation_position', P0),
    /** 元（SPEC 附录 A.2） */
    totalAsset: readField(o, 'total_asset', P0),
    cashBalance: readField(o, 'cash_balance', P0),
    holdingsMv: readField(o, 'holdings_mv', P0),
    totalPnl: readField(o, 'total_pnl', P0),
    assetSource: readField(o, 'asset_source', P0),
    etfTotal: readField(o, 'etf_total', P0),
    /**
     * ⛔ 首轮审计 #4：`leverage_alert` / `total_book_pct` 线上**不存在**。
     * 保留字段仅为「显式缺失」，⛔ UI 不得据此渲染隐杠杆区块（SPEC §11.4①）。
     */
    leverageExcess: readField(o, 'leverage_excess', P0),
    overbooked: readField(o, 'overbooked', P0)
  });
}

function adaptCards(list) {
  const P0 = P('cards');
  if (!Array.isArray(list)) return missing(MISSING_REASON.FIELD_ABSENT, P0);
  return provided(list.filter((c) => c && typeof c === 'object').map((c) => Object.freeze({
    code: readField(c, 'code', P0),
    name: readField(c, 'name', P0),
    sector: readField(c, 'sector', P0),
    stage: readField(c, 'stage', P0),
    waitReason: readField(c, 'wait_reason', P0),
    action: readField(c, 'action', P0),
    actionLabel: readField(c, 'action_label', P0),
    opportunityScore: readField(c, 'opportunity_score', P0),
    opportunityGrade: readField(c, 'opportunity_grade', P0),
    riskFlag: readField(c, 'risk_flag', P0),
    riskOverride: readField(c, 'risk_override', P0),
    currentPosition: readField(c, 'current_position', P0),
    suggestedPosition: readField(c, 'suggest_position', P0),
    /** ★ 单位 = 仓位百分比（SPEC 附录 A.1） */
    finalTarget: readField(c, 'final_target', P0),
    targetStd: readField(c, 'target_std', P0),
    targetMin: readField(c, 'target_min', P0),
    targetMax: readField(c, 'target_max', P0),
    positionGap: readField(c, 'position_gap', P0),
    overAllocStatus: readField(c, 'over_alloc_status', P0),
    bindingConstraint: readField(c, 'binding_constraint', P0),
    trendStage: readField(c, 'trend_stage', P0),
    dataTime: readField(c, 'data_time', P0),
    explainChain: readField(c, 'explain_chain', P0),
    /**
     * ⛔ 审计 #5：线上 cards[] **没有** `gen1` 字段。
     * 这里显式暴露为 UNAVAILABLE，供 UI 显示诚实态，
     * ⛔ **不得**用 `ml_shadow` 冒充 cards 级 Gen-1 分层。
     */
    gen1: unavailable(MISSING_REASON.CONTRACT_NOT_PROVIDED, P0)
  })), P0);
}

/** 系统运行状态（旧前端读的 `capability.*` 线上不存在 ⇒ 显式缺失） */
function adaptSystemStatus(ml) {
  const P0 = P('ml_shadow');
  if (!ml || typeof ml !== 'object') {
    return Object.freeze({ available: false });
  }
  return Object.freeze({
    available: true,
    enabled: readField(ml, 'enabled', P0),
    effective: readField(ml, 'effective', P0),
    observe: readField(ml, 'observe', P0),
    fastPathEnabled: readField(ml, 'fast_path_enabled', P0),
    modelId: readField(ml, 'model_id', P0),
    engineVersion: readField(ml, 'engine_version', P0),
    uiPhase: readField(ml, 'ui_phase', P0),
    productionPermission: readField(ml, 'production_permission', P0),
    generatedAt: readField(ml, 'generated_at', P0),
    /** ⛔ 审计 #9：`ml_shadow.capability` 线上不存在 */
    capability: unavailable(MISSING_REASON.FIELD_ABSENT, P0)
  });
}

export { hasCanonicalContract };
