/**
 * Dashboard 适配器（web/src/rewrite/adapters/dashboard.js）
 * 规范依据：SPEC §2 / §4.1 / §4.2 / §6 / §7 / §9 / 附录 A
 *
 * ★ 本适配器同时是 **Dashboard ViewModel 的唯一构建者**：
 *   raw response → `Field<T>` 领域对象 → **带展示文案的 ViewModel**。
 *   ⇒ 视图层只负责绑定；⛔ 不再解释后端字段、⛔ 不再自行格式化数字、⛔ 不再自造文案。
 *
 * ★ 承载首轮审计发现的契约断裂修复（审计 §3.6）：
 *   #1 `three_questions.market_regime` 线上不存在（实际为 `market_status`）
 *      ⇒ 优先 `overview.market_regime`（枚举），`market_status` 仅作展示兜底并标 derived。
 *   #3 `three_questions.risk_status` 不存在 ⇒ 改读 `overview.overall_risk`。
 *   #4 `overview.leverage_alert` / `total_book_pct` 不存在 ⇒ 不虚构该区块。
 *   #5 线上 `cards[].gen1` 不存在 ⇒ 显式 UNAVAILABLE（canonical 下发时才展示）。
 *
 * ★ M3 新增（Dashboard 页面级语义）：
 *   · `market` / `portfolio` / `decision` / `gen1` / `lifecycle` / `provenance` / `asOf` / `freshness`
 *   · Gen-1 **系统级状态**三级解析：
 *       canonical `system_runtime.gen1`
 *         > `runtime_status.gen1_*`（**显式命名通道**，UI 必须标注来源，⛔ 非静默 fallback）
 *         > `UNAVAILABLE`
 *   · 生命周期：**不在前端写死任何状态值**，全部交由 `domain/lifecycle.js` 状态机裁决。
 *
 * ⛔ 本适配器不做的事：
 *   · ⛔ 不重算 `position_gap`（服务端已算；SPEC 附录 A.5）
 *   · ⛔ 不合成「组合目标合计」（无组合级契约 ⇒ 显式 NO_BACKEND_CONTRACT，不出数字）
 *   · ⛔ 不做任何「按数值大小推断单位」的格式化（SPEC §10，D-7）
 */
import {
  provided, missing, unavailable, readField, readBlock, provenance, hasValue
} from '../domain/provenance.js';
import { FIELD_STATE, MISSING_REASON, AUTHORITY, LIFECYCLE_DIMS } from '../domain/enums.js';
import {
  adaptGen1, legacyFallback, hasCanonicalContract, cardGen1Field, cardProductionField
} from './gen1.js';
import { assess, describe as describeFreshness } from '../domain/freshness.js';
import { readLifecycle, readBoundaryFields } from '../domain/lifecycle.js';
import {
  actionLabel, toneForAction, riskLabel, toneForRisk, regimeLabel, toneForRegime,
  overAllocLabel, sectorLabel,
  fieldStateText, missingReasonText, sourceChannelText, sourceChannelNote,
  gen1AuthorityLabel, gen1HealthLabel, toneForGen1Health, gen1HealthGateLabel,
  gen1SignalStatusLabel, toneForGen1Signal,
  lifecycleDimDisplay, lifecycleDimCaveat, lifecycleValueText,
  IDENTITY_GEN1, IDENTITY_SAFETY_CORE, IDENTITY_GEN2, GEN1_BOUNDARY_NOTE, GEN2_BOUNDARY_NOTE
} from '../domain/labels.js';
import { opportunityLevel, CHAIN_COLLAPSE_AFTER } from '../domain/thresholds.js';
import { formatPercent, formatDate, formatDateTime, formatRatio, formatProbability, formatAmount } from '../domain/format.js';
/** ★ 展示映射统一实现在 domain/display.js（M4 起 M3/M4 共用；⛔ 不得再在 adapter 内私有实现） */
import { disp, dispTri, pctText, scoreText, dateText, dateTimeText, rawText } from '../domain/display.js';

const SRC = 'api:/api/dashboard';
const SRC_ALT = 'api:/api/constants';
const P = (f) => provenance({ source: SRC + (f ? '.' + f : ''), authority: AUTHORITY.SAFETY_CORE });
const P_OPS = (f) => provenance({ source: SRC + (f ? '.' + f : ''), authority: AUTHORITY.OPERATOR });

/* ==================== 展示映射工具（VM 层） ====================
 * ★ 已上移到 `domain/display.js`（M4 起 M3/M4 共用同一实现）。
 *   此处仅保留本地别名，调用点零改动（行为与 M3 逐位一致）。
 */
const pct = pctText;
const score = scoreText;
const dateTxt = dateText;
const dtTxt = dateTimeText;
const rawTxt = rawText;

/* ==================== 主入口 ==================== */

/**
 * @param {object|null} data `/api/dashboard` 的 data
 * @param {object|null} runtimeStatus `/api/constants` 的 runtime_status（可选）
 * @param {{retrievedAt?:string}} meta 由 compose 层注入的取数元信息（⛔ 适配器不自造时间）
 */
export function adaptDashboard(data, runtimeStatus = null, meta = {}) {
  const empty = !data || typeof data !== 'object' || Array.isArray(data);
  const overview = empty ? null : data.overview;
  const tq = empty ? null : data.three_questions;
  const retrievedAt = meta && meta.retrievedAt ? meta.retrievedAt : null;

  const headline = adaptHeadline(overview, tq);
  const cardsField = adaptCards(empty ? null : data.cards);
  const cards = hasValue(cardsField) ? cardsField.value : [];
  const gen1 = adaptGen1Section(data, runtimeStatus);
  const lifecycle = adaptLifecycle(runtimeStatus, empty ? null : data.system_runtime);
  const legacy = legacyFallback(data, runtimeStatus);

  return Object.freeze({
    available: !empty,

    /* ---- 引擎模式（运维元数据，⛔ 不是决策口径）---- */
    engineMode: disp(readField(data, 'engine_mode', P_OPS('engine_mode'))),
    v3Mode: disp(readField(data, 'v3_mode', P_OPS('v3_mode'))),

    /* ---- 结论带（保持 M2 形状，⛔ 不删）---- */
    headline,

    /* ---- 第一主区：市场环境 ---- */
    market: adaptMarket(headline, overview, tq),

    /* ---- 第一主区：正式决策 / 风险 ---- */
    decision: adaptDecisionSection(cards, headline, gen1),

    /* ---- 组合仓位 / 账户（金额默认遮罩由 UI 负责）---- */
    portfolio: adaptPortfolio(overview),
    account: adaptAccount(overview),

    /* ---- 第三主区：标的 ---- */
    cards: cardsField,

    /* ---- 第二主区：Gen-1 ---- */
    gen1,

    /* ---- 底部：生命周期 / 边界字段 / 数据质量 ---- */
    lifecycle,
    boundaryFields: adaptBoundaryFields(runtimeStatus),

    /* ---- 系统运行状态（折叠区）---- */
    systemStatus: adaptSystemStatus(empty ? null : data.ml_shadow),

    /* ---- 数据质量 ---- */
    asOf: adaptAsOf(overview, runtimeStatus, retrievedAt, cards),
    freshness: adaptFreshness(overview, runtimeStatus),

    /** 三方职责身份与边界说明（SPEC §3；⛔ 文案只此一处，UI 不做拼装） */
    boundaries: Object.freeze({
      safetyCoreIdentity: IDENTITY_SAFETY_CORE,
      gen1Identity: IDENTITY_GEN1,
      gen1Note: GEN1_BOUNDARY_NOTE,
      gen2Identity: IDENTITY_GEN2,
      gen2Note: GEN2_BOUNDARY_NOTE
    }),

    /* ---- 来源与回退 ---- */
    provenance: Object.freeze({
      source: SRC,
      sourceAlt: SRC_ALT,
      retrievedAt,
      gen1Channel: gen1.sourceChannel,
      gen1ChannelText: sourceChannelText(gen1.sourceChannel),
      gen1ChannelNote: sourceChannelNote(gen1.sourceChannel),
      legacyFallbackUsed: legacy.used,
      legacyFallbackReason: legacy.reason || null,
      hasCanonicalContract: hasCanonicalContract(data)
    }),

    legacyFallback: legacy
  });
}

/* ==================== 结论带（保持 M2 形状，⛔ 不删） ==================== */

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
    marketRegimeIsFallback: regimeEnum.state !== FIELD_STATE.PROVIDED && marketStatus.state === FIELD_STATE.PROVIDED,
    risk,
    mostWorth: readField(tq, 'most_worth', P('three_questions.most_worth')),
    mostDefend: readBlock(tq, 'most_defend', P('three_questions.most_defend')),
    snapshotDate: readField(overview, 'snapshot_date', P('overview.snapshot_date'))
  });
}

/* ==================== 市场环境 ==================== */

function adaptMarket(headline, overview, tq) {
  const regime = headline.marketRegime;
  const regimeCode = hasValue(regime) ? regime.value : null;
  const risk = headline.risk;
  const mdBlock = headline.mostDefend;
  const mdValue = hasValue(mdBlock) && mdBlock.value && typeof mdBlock.value === 'object' ? mdBlock.value : null;
  const statusF = readField(tq, 'market_status', P('three_questions.market_status'));

  return Object.freeze({
    regime,
    regimeCode,
    regimeLabel: hasValue(regime) ? regimeLabel(regimeCode) : fieldStateText(regime.state),
    regimeTone: hasValue(regime) ? toneForRegime(regimeCode) : 'muted',
    regimeIsFallback: headline.marketRegimeIsFallback,
    regimeSourceText: regime.provenance ? regime.provenance.source : '',
    regimeSourceNote: headline.marketRegimeIsFallback
      ? '展示兜底：枚举 market_regime 缺失，此处使用后端已本地化的 market_status'
      : '',

    /** 后端已本地化的市场描述（`three_questions.market_status`，如「防守」） */
    statusText: rawTxt(statusF),

    risk,
    riskLabel: hasValue(risk) ? riskLabel(risk.value) : fieldStateText(risk.state),
    riskTone: hasValue(risk) ? toneForRisk(risk.value) : 'muted',

    mostWorth: headline.mostWorth,
    mostWorthText: rawTxt(headline.mostWorth),

    mostDefend: mdBlock,
    mostDefendLabel: mdValue ? (mdValue.name || mdValue.code || '') : fieldStateText(mdBlock.state),
    mostDefendCode: mdValue ? (mdValue.code || '') : '',

    /** 组合是否超配（历史字段；线上 `overview` 无此键 ⇒ 显式 MISSING，⛔ 不虚构） */
    overbooked: disp(readField(overview, 'overbooked', P('overview.overbooked')))
  });
}

/* ==================== 正式决策 / 风险（第一主区） ==================== */

function adaptDecisionSection(cards, headline, gen1) {
  /**
   * ⚠️ `counts` 是**动作分类计数**（把 `cards[].action` 按类别点数），属 UI 聚合，
   *    ⛔ 不是后端字段、⛔ 不是仓位数字。
   */
  const counts = { total: cards.length, reduce: 0, hold: 0, add: 0, wait: 0, other: 0 };
  const constraints = new Set();
  let cardsWithGap = 0;
  let gapKnown = 0;

  for (const c of cards) {
    const code = hasValue(c.action) ? c.action.value : null;
    if (code === 'TACTICAL_REDUCE' || code === 'STRATEGIC_REDUCE' || code === 'EXIT') counts.reduce += 1;
    else if (code === 'HOLD') counts.hold += 1;
    else if (code === 'ADD' || code === 'BUILD') counts.add += 1;
    else if (code === 'WAIT') counts.wait += 1;
    else counts.other += 1;

    const bc = hasValue(c.bindingConstraint) ? c.bindingConstraint.value : null;
    if (bc && bc !== 'none') constraints.add(bc);

    if (hasValue(c.positionGap)) {
      gapKnown += 1;
      if (Number(c.positionGap.value) > 0) cardsWithGap += 1;
    }
  }

  const risk = headline.risk;

  return Object.freeze({
    /** ★ 正式决策归属：V3 Safety Core（⛔ 与 Gen-1 分离呈现，SPEC §3） */
    authorityText: IDENTITY_SAFETY_CORE,
    identity: IDENTITY_SAFETY_CORE,
    risk,
    riskLabel: hasValue(risk) ? riskLabel(risk.value) : fieldStateText(risk.state),
    riskTone: hasValue(risk) ? toneForRisk(risk.value) : 'muted',

    counts: Object.freeze(counts),
    /** 需要动作的标的（非 WAIT/HOLD，或存在仓位缺口，或 RED 风险） */
    attention: Object.freeze(cards.filter((c) => isAttention(c))),
    /** 绑定约束（多标的取并集；`none` 不计入） */
    bindingConstraints: Object.freeze([...constraints]),
    bindingConstraintText: constraints.size ? [...constraints].join(' / ') : '无',

    /**
     * ★ 组合级目标合计：**后端未下发** ⇒ ⛔ 前端不出数字（不求和、不推算）。
     *   证据：`/api/dashboard` 只有单标的 `final_target`，无组合级 target 字段。
     */
    targetTotal: Object.freeze({
      available: false,
      reason: MISSING_REASON.NO_BACKEND_CONTRACT,
      reasonText: missingReasonText(MISSING_REASON.NO_BACKEND_CONTRACT),
      text: '数据未提供',
      note: '后端仅下发单标的 final_target，无组合级目标契约；本页不代为求和。'
    }),

    /** 仓位缺口：只报「有几张卡有缺口」（⛔ 不重算、不求和单条 gap） */
    gap: Object.freeze({
      cardsWithGap,
      cardsKnown: gapKnown,
      hasGap: cardsWithGap > 0,
      text: gapKnown === 0 ? '数据未提供' : (cardsWithGap === 0 ? '无缺口' : (cardsWithGap + ' 只存在缺口'))
    }),

    /** Gen-1 是否可用（供 UI 在「正式决策」区给出正确的对照提示） */
    gen1Available: gen1.sourceChannel !== 'NONE'
  });
}

/**
 * 关注判据（同一实现同时服务两处，⛔ 不得两写）：
 *   · 卡片 `display.attention` 标记
 *   · `decision.attention` 列表筛选
 */
function attentionOf(actionF, gapF, riskF) {
  if (hasValue(actionF) && actionF.value !== 'WAIT' && actionF.value !== 'HOLD') return true;
  if (hasValue(gapF) && Number(gapF.value) > 0) return true;
  if (hasValue(riskF) && String(riskF.value).toUpperCase() === 'RED') return true;
  return false;
}

function isAttention(c) {
  return attentionOf(c.action, c.positionGap, c.riskFlag);
}

/* ==================== 组合仓位 ==================== */

function adaptPortfolio(o) {
  const P0 = P('overview');
  return Object.freeze({
    /** 现金比例（百分比） */
    cashRatio: pct(readField(o, 'cash_ratio', P0)),
    techPosition: pct(readField(o, 'tech_position', P0)),
    goldPosition: pct(readField(o, 'gold_position', P0)),
    innovationPosition: pct(readField(o, 'innovation_position', P0)),
    /** 组合 ETF 总仓位（后端下发，⛔ 不由前端求和） */
    etfTotal: pct(readField(o, 'etf_total', P0)),
    assetSource: rawTxt(readField(o, 'asset_source', P0)),

    /**
     * 金额（单位：元，SPEC 附录 A.2）。
     * ⚠️ 前台**默认遮罩**（owner 既定的隐私默认）；遮罩逻辑在 UI，本层只出真实文案。
     */
    money: Object.freeze({
      totalAsset: disp(readField(o, 'total_asset', P0), (v) => formatAmount(v)),
      cashBalance: disp(readField(o, 'cash_balance', P0), (v) => formatAmount(v)),
      holdingsMv: disp(readField(o, 'holdings_mv', P0), (v) => formatAmount(v)),
      totalPnl: disp(readField(o, 'total_pnl', P0), (v) => formatAmount(v)),
      /** 浮盈方向（⛔ 仅用于配色，不参与任何决策语义） */
      pnlSign: hasValue(readField(o, 'total_pnl', P0)) ? Number(readField(o, 'total_pnl', P0).value) : null,
      assetSource: rawTxt(readField(o, 'asset_source', P0)),
      maskedByDefault: true
    })
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

/* ==================== 标的卡 ==================== */

function adaptCards(list) {
  const P0 = P('cards');
  if (!Array.isArray(list)) return missing(MISSING_REASON.FIELD_ABSENT, P0);
  return provided(list.filter((c) => c && typeof c === 'object').map((c) => adaptCard(c, P0)), P0);
}

function adaptCard(c, P0) {
  const actionF = readField(c, 'action', P0);
  const gradeF = readField(c, 'opportunity_grade', P0);
  const scoreF = readField(c, 'opportunity_score', P0);
  const riskF = readField(c, 'risk_flag', P0);
  const overF = readField(c, 'over_alloc_status', P0);
  const curF = readField(c, 'current_position', P0);
  const ftF = readField(c, 'final_target', P0);
  const gapF = readField(c, 'position_gap', P0);
  const minF = readField(c, 'target_min', P0);
  const maxF = readField(c, 'target_max', P0);
  const sectorF = readField(c, 'sector', P0);
  const stageCodeF = readField(c, 'trend_stage', P0);
  const stageTextF = readField(c, 'stage', P0);
  const waitF = readField(c, 'wait_reason', P0);
  const dataTimeF = readField(c, 'data_time', P0);
  const level = opportunityLevel(hasValue(gradeF) ? gradeF.value : null, hasValue(scoreF) ? scoreF.value : null);
  const gen1Field = cardGen1Field(c.gen1);

  return Object.freeze({
    /* ---- 既有字段（M2 契约，⛔ 不删） ---- */
    code: readField(c, 'code', P0),
    name: readField(c, 'name', P0),
    sector: sectorF,
    stage: stageTextF,
    waitReason: waitF,
    action: actionF,
    actionLabel: readField(c, 'action_label', P0),
    opportunityScore: scoreF,
    opportunityGrade: gradeF,
    riskFlag: riskF,
    riskOverride: readField(c, 'risk_override', P0),
    currentPosition: curF,
    suggestedPosition: readField(c, 'suggest_position', P0),
    /** ★ 单位 = 仓位百分比（SPEC 附录 A.1） */
    finalTarget: ftF,
    targetStd: readField(c, 'target_std', P0),
    targetMin: minF,
    targetMax: maxF,
    positionGap: gapF,
    overAllocStatus: overF,
    bindingConstraint: readField(c, 'binding_constraint', P0),
    trendStage: stageCodeF,
    dataTime: dataTimeF,
    explainChain: readField(c, 'explain_chain', P0),
    /**
     * ⛔ 审计 #5：线上 cards[] **没有** `gen1` 字段。
     * canonical 下发时适配为 `PROVIDED`；缺失时 `UNAVAILABLE`（可自愈）。
     * ⛔ **不得**用 `ml_shadow` 冒充 cards 级 Gen-1 分层。
     */
    gen1: gen1Field,

    /* ---- M3 新增：契约 production 块 + 展示层 ---- */
    production: cardProductionField(c.production),
    sectorLabel: hasValue(sectorF) ? sectorLabel(sectorF.value) : fieldStateText(sectorF.state),

    display: Object.freeze({
      code: rawTxt(readField(c, 'code', P0)).text,
      name: rawTxt(readField(c, 'name', P0)).text,
      action: hasValue(actionF) ? actionLabel(actionF.value) : fieldStateText(actionF.state),
      actionTone: hasValue(actionF) ? toneForAction(actionF.value) : 'muted',
      /** 是否需关注（与 decision.attention 同判据，见 attentionOf） */
      attention: attentionOf(actionF, gapF, riskF),
      current: pct(curF),
      target: pct(ftF),
      gap: pct(gapF, 1, true),
      band: (hasValue(minF) && hasValue(maxF))
        ? (formatPercent(minF.value, 1) + ' ~ ' + formatPercent(maxF.value, 1))
        : '数据未提供',
      overAlloc: hasValue(overF) ? overAllocLabel(overF.value) : fieldStateText(overF.state),
      risk: hasValue(riskF) ? riskLabel(riskF.value) : fieldStateText(riskF.state),
      riskTone: hasValue(riskF) ? toneForRisk(riskF.value) : 'muted',
      opportunity: hasValue(gradeF) ? (gradeF.value + ' · ' + score(scoreF).text + ' 分') : '数据未提供',
      opportunityTone: level.tone,
      stageText: hasValue(stageTextF) ? String(stageTextF.value) : fieldStateText(stageTextF.state),
      trendStageText: hasValue(stageCodeF) ? ('阶段 ' + stageCodeF.value) : fieldStateText(stageCodeF.state),
      dataTime: dateTxt(dataTimeF).text,
      /**
       * ⚠️ `wait_reason` 线上实测为 `null`，语义是「**无等待原因**」（并非字段缺失）。
       *    ⇒ 展示层空串；⛔ 不显示为「字段缺失」以免误导。
       */
      waitReasonText: hasValue(waitF) ? String(waitF.value) : '',
      /** 决策链（首页最多展开 CHAIN_COLLAPSE_AFTER 步） */
      chain: adaptChainDisplay(c.explain_chain, P0),
      /** Gen-1（卡片级，契约下发时才有） */
      gen1: adaptCardGen1Display(gen1Field)
    })
  });
}

/** 卡片级 Gen-1 展示投影（⛔ 无契约时只给「未提供」，不猜） */
function adaptCardGen1Display(gen1Field) {
  if (!hasValue(gen1Field)) {
    return Object.freeze({
      available: false,
      text: '数据未提供',
      reason: gen1Field.missingReason || MISSING_REASON.CONTRACT_NOT_PROVIDED,
      reasonText: missingReasonText(gen1Field.missingReason || MISSING_REASON.CONTRACT_NOT_PROVIDED)
    });
  }
  const g = gen1Field.value;
  return Object.freeze({
    available: true,
    authorityText: disp(g.authority, (v) => gen1AuthorityLabel(v, null)).text,
    statusText: disp(g.status, (v) => gen1SignalStatusLabel(v)).text,
    statusTone: hasValue(g.signal.signalStatus) ? toneForGen1Signal(g.signal.signalStatus.value) : 'muted',
    signalStageText: disp(g.signal.stage, null).text,
    /** 概率是 0~1 比例 ⇒ 显式概率 formatter（唯一允许 0~1→% 的语义） */
    probabilityText: disp(g.signal.probability, (v) => formatProbability(v, 1)).text,
    /** 模型阈值是 0~1 比例 ⇒ ⛔ 不加 % */
    thresholdText: disp(g.signal.threshold, (v) => formatRatio(v, 2)).text,
    modelCandidateText: dispTri(g.signal.modelCandidate).text,
    stageSignalText: disp(g.stages.signal, null).text,
    stageBaselineText: disp(g.stages.baseline, null).text,
    stageEffectiveText: disp(g.stages.effective, null).text,
    safetyPermissionText: disp(g.safety.permission, null).text,
    safetyReasonText: disp(g.safety.reason, null).text,
    applicabilityLabelText: disp(g.applicability.label, null).text,
    applicabilityMessageText: disp(g.applicability.message, null).text,
    dataHealthText: disp(g.data.healthStatus, null).text,
    counterfactualDeltaText: disp(g.counterfactual.deltaPct, (v) => formatPercent(v, 1, true)).text,
    counterfactualTargetText: disp(g.counterfactual.targetPct, (v) => formatPercent(v, 1)).text
  });
}

/** 决策链展示（⛔ 不改写条件文案；只做 Field 包装与截断） */
function adaptChainDisplay(chain, P0) {
  if (!Array.isArray(chain)) {
    return Object.freeze({
      available: false, text: '数据未提供',
      steps: Object.freeze([]), collapsed: Object.freeze([]), more: 0
    });
  }
  const steps = chain
    .filter((x) => x && typeof x === 'object')
    .map((x) => Object.freeze({
      step: rawTxt(readField(x, 'step', P0)).text,
      condition: rawTxt(readField(x, 'condition', P0)).text,
      result: rawTxt(readField(x, 'result', P0)).text
    }));
  return Object.freeze({
    available: true,
    text: steps.length + ' 步',
    steps: Object.freeze(steps),
    collapsed: Object.freeze(steps.slice(0, CHAIN_COLLAPSE_AFTER)),
    more: Math.max(0, steps.length - CHAIN_COLLAPSE_AFTER)
  });
}

/* ==================== Gen-1（系统级） ==================== */

/**
 * ★ 三级解析（canonical > 运行时状态 > 未提供）。
 *   中间的 `runtime_status.gen1_*` 是**显式命名通道**：
 *     · 来源写进 `sourceChannel` / `channelCaveat`，由 UI 显著标注；
 *     · ⛔ 不静默当作契约字段；
 *     · ⛔ 不由 `ml_shadow*` 反推 authority（UI-G1-04）。
 */
function adaptGen1Section(data, runtimeStatus) {
  const sr = data && data.system_runtime && typeof data.system_runtime === 'object' ? data.system_runtime : null;
  const srGen1 = sr && sr.gen1 && typeof sr.gen1 === 'object' ? sr.gen1 : null;
  const rs = runtimeStatus && typeof runtimeStatus === 'object' ? runtimeStatus : null;

  const canonical = !!srGen1;
  const channel = canonical ? 'CANONICAL' : (rs ? 'RUNTIME_STATUS' : 'NONE');

  const P_CANON = provenance({ source: 'contract:system_runtime.gen1', authority: AUTHORITY.SAFETY_CORE });
  const P_RS = provenance({
    source: 'api:/api/constants#runtime_status',
    authority: AUTHORITY.OPERATOR,
    fallbackFrom: 'runtime_status'
  });

  const rawAuthority = canonical ? srGen1.authority : (rs ? rs.gen1_authority : undefined);
  const backendAuthorityLabel = canonical ? srGen1.authority_label : (rs ? rs.gen1_authority_label : undefined);
  const rawHealth = canonical ? srGen1.health_status : (rs ? rs.gen1_health_status : undefined);
  const backendHealthLabel = canonical ? undefined : (rs ? rs.gen1_health_label : undefined);
  const rawGate = canonical ? srGen1.health_gate_status : (rs ? rs.gen1_health_gate_status : undefined);
  const rawSafetySource = canonical ? srGen1.safety_source : (rs ? rs.gen1_safety_source : undefined);
  const rawHealthSource = canonical ? srGen1.health_source : (rs ? rs.gen1_health_source : undefined);

  const prov = canonical ? P_CANON : P_RS;
  const pick = (v) => (v === undefined || v === null
    ? unavailable(MISSING_REASON.FIELD_ABSENT, prov)
    : provided(v, prov));

  const authorityF = pick(rawAuthority);
  const healthF = pick(rawHealth);
  const gateF = pick(rawGate);

  const cfAuthorized = canonical ? srGen1.counterfactual_authorized : (rs ? rs.gen1_counterfactual_canary_authorized : undefined);
  const cfHealthAllowed = canonical ? srGen1.counterfactual_health_allowed : (rs ? rs.gen1_counterfactual_canary_health_allowed : undefined);
  const cfActive = canonical ? srGen1.counterfactual_active : (rs ? rs.gen1_counterfactual_canary_active : undefined);
  const cfReason = canonical ? srGen1.counterfactual_inactive_reason : undefined;

  const cards = data && Array.isArray(data.cards) ? data.cards : [];
  const perCardAvailable = cards.filter((c) => c && c.gen1 && typeof c.gen1 === 'object').length;

  return Object.freeze({
    /** canonical 页面级契约是否下发（⛔ 与「字段是否齐全」分开判定） */
    canonicalAvailable: hasCanonicalContract(data),
    sourceChannel: channel,
    sourceChannelText: sourceChannelText(channel),
    sourceChannelNote: sourceChannelNote(channel),
    /** 通道说明（UI 直接用，⛔ 不在模板里拼文案） */
    channelCaveat: channel === 'CANONICAL' ? ''
      : (channel === 'RUNTIME_STATUS'
        ? '系统级 Gen-1 状态取自 /api/constants 的 runtime_status（正式契约未在线上部署）；权威判定仍以契约与台账为准。'
        : '后端未提供 Gen-1 状态（契约与运行时状态均不可读）。'),

    /** ★ 身份：时机/建议，⛔ 不是交易决定（SPEC §3.1） */
    identity: IDENTITY_GEN1,

    authority: authorityF,
    authorityLabel: disp(authorityF, (v) => gen1AuthorityLabel(v, backendAuthorityLabel)),
    authorityLabelIsBackend: backendAuthorityLabel !== undefined && backendAuthorityLabel !== null && backendAuthorityLabel !== '',

    healthStatus: healthF,
    healthLabel: disp(healthF, (v) => (backendHealthLabel || gen1HealthLabel(v))),
    healthTone: hasValue(healthF) ? toneForGen1Health(healthF.value) : 'muted',
    healthGateStatus: gateF,
    healthGateLabel: disp(gateF, (v) => gen1HealthGateLabel(v)),
    safetySource: pick(rawSafetySource),
    healthSource: pick(rawHealthSource),

    counterfactual: Object.freeze({
      available: cfAuthorized !== undefined || cfHealthAllowed !== undefined || cfActive !== undefined,
      authorized: dispTri(pickCF(cfAuthorized, prov)),
      healthAllowed: dispTri(pickCF(cfHealthAllowed, prov)),
      active: dispTri(pickCF(cfActive, prov)),
      /** ★ 生效档位下的计数/未生效原因：契约键为 `counterfactual_inactive_reason` */
      inactiveReason: disp(pickCF(cfReason, prov), null),
      /** ⛔ 反事实（shadow）不得覆盖 production（UI-G1-03） */
      note: '反事实（counterfactual）属影子计算，⛔ 不改变正式目标仓位。'
    }),

    /** ★ 安全三字段（三态，⛔ 不得压扁） */
    safety: Object.freeze({
      productionWrite: dispTri(pickCF(canonical ? srGen1.production_write : (rs ? rs.gen1_production_write : undefined), prov)),
      productionFastPathEnabled: dispTri(pickCF(canonical ? srGen1.production_fast_path_enabled : (rs ? rs.gen1_production_fast_path_enabled : undefined), prov)),
      autoExecution: dispTri(pickCF(canonical ? srGen1.auto_execution : (rs ? rs.gen1_auto_execution : undefined), prov)),
      safetyInvariantOk: dispTri(pickCF(canonical ? srGen1.safety_invariant_ok : undefined, prov))
    }),

    /** 每张标的卡的 Gen-1 契约是否下发 */
    perCard: Object.freeze({
      total: cards.length,
      available: perCardAvailable,
      unavailable: cards.length - perCardAvailable
    }),

    /** canonical 页面级 gen1 块（单标的上下文才用；Dashboard 上通常为空） */
    pageBlock: adaptGen1(data, runtimeStatus)
  });
}

/** counterfactual / safety 的取值可能**合法为 false** ⇒ 与 pick 区分（false 不是缺失） */
function pickCF(v, prov) {
  if (v === undefined || v === null) return unavailable(MISSING_REASON.FIELD_ABSENT, prov);
  return provided(v, prov);
}

/* ==================== 生命周期 ==================== */

function adaptLifecycle(runtimeStatus, systemRuntime) {
  const lc = readLifecycle(runtimeStatus, systemRuntime);

  const items = LIFECYCLE_DIMS.map((dim) => {
    const f = lc.dims[dim];
    const ok = f.state === FIELD_STATE.PROVIDED;
    return Object.freeze({
      dim,
      label: lifecycleDimDisplay(dim),
      caveat: lifecycleDimCaveat(dim),
      field: f,
      provided: ok,
      valueText: ok ? lifecycleValueText(f.value) : fieldStateText(f.state),
      reasonText: ok ? '' : missingReasonText(f.missingReason),
      sourceText: f.provenance ? f.provenance.source : ''
    });
  });

  const byDim = Object.fromEntries(items.map((i) => [i.dim, i]));

  return Object.freeze({
    dims: lc.dims,
    runtimeStatusAvailable: lc.runtimeStatusAvailable,
    staticRegisterUsed: lc.staticRegisterUsed,
    items: Object.freeze(items),
    axesView: Object.freeze(lc.axes.map((a) => Object.freeze({
      axis: a.axis,
      label: a.label,
      allProvided: a.allProvided,
      items: Object.freeze(a.dims.map((d) => byDim[d]))
    }))),
    /** UI 顶部说明：⛔ 不表达任何状态值，只说「有几项没有数据」 */
    unavailableCount: items.filter((i) => !i.provided).length,
    totalCount: items.length
  });
}

function adaptBoundaryFields(runtimeStatus) {
  return Object.freeze(readBoundaryFields(runtimeStatus).map((b) => Object.freeze({
    key: b.key,
    label: b.label,
    counter: b.counter,
    field: b.field,
    value: dispTri(b.field)
  })));
}

/* ==================== 系统运行状态（折叠区） ==================== */

/** 系统运行状态（旧前端读的 `capability.*` 线上不存在 ⇒ 显式缺失） */
function adaptSystemStatus(ml) {
  const P0 = P('ml_shadow');
  if (!ml || typeof ml !== 'object') {
    return Object.freeze({ available: false, items: Object.freeze([]) });
  }
  const items = [
    { key: 'enabled', label: '启用', d: dispTri(readField(ml, 'enabled', P0)) },
    { key: 'effective', label: '生效', d: dispTri(readField(ml, 'effective', P0)) },
    { key: 'observe', label: '观察模式', d: dispTri(readField(ml, 'observe', P0)) },
    { key: 'fastPathEnabled', label: '快速通道', d: dispTri(readField(ml, 'fast_path_enabled', P0)) },
    { key: 'modelId', label: '模型', d: disp(readField(ml, 'model_id', P0), null) },
    { key: 'engineVersion', label: '引擎版本', d: disp(readField(ml, 'engine_version', P0), null) },
    { key: 'uiPhase', label: '阶段', d: disp(readField(ml, 'ui_phase', P0), null) },
    { key: 'productionPermission', label: '生产许可', d: disp(readField(ml, 'production_permission', P0), null) },
    { key: 'note', label: '说明', d: disp(readField(ml, 'note', P0), null) }
  ];
  return Object.freeze({
    available: true,
    items: Object.freeze(items),
    enabled: readField(ml, 'enabled', P0),
    effective: readField(ml, 'effective', P0),
    observe: readField(ml, 'observe', P0),
    fastPathEnabled: readField(ml, 'fast_path_enabled', P0),
    modelId: readField(ml, 'model_id', P0),
    engineVersion: readField(ml, 'engine_version', P0),
    uiPhase: readField(ml, 'ui_phase', P0),
    productionPermission: readField(ml, 'production_permission', P0),
    generatedAt: readField(ml, 'generated_at', P0),
    note: readField(ml, 'note', P0),
    /** ⛔ 审计 #9：`ml_shadow.capability` 线上不存在 */
    capability: unavailable(MISSING_REASON.FIELD_ABSENT, P0)
  });
}

/* ==================== 数据时点与新鲜度 ==================== */

function adaptAsOf(overview, runtimeStatus, retrievedAt, cards) {
  const snapshot = readField(overview, 'snapshot_date', P('overview.snapshot_date'));
  const decisionDate = runtimeStatus && typeof runtimeStatus === 'object'
    ? readField(runtimeStatus, 'decision_date', provenance({ source: SRC_ALT + '#runtime_status.decision_date', authority: AUTHORITY.OPERATOR }))
    : unavailable(MISSING_REASON.RUNTIME_STATUS_UNAVAILABLE, provenance({ source: SRC_ALT, authority: AUTHORITY.OPERATOR }));

  const cardTimes = cards.map((c) => (hasValue(c.dataTime) ? String(c.dataTime.value) : null)).filter(Boolean).sort();
  const cardLatest = cardTimes.length ? cardTimes[cardTimes.length - 1] : null;

  return Object.freeze({
    snapshotDate: snapshot,
    snapshotDateText: dateTxt(snapshot).text,
    decisionDate,
    decisionDateText: dateTxt(decisionDate).text,
    /** 标的卡数据时点（取最新一张） */
    cardDataTimeText: cardLatest ? formatDate(cardLatest) : '数据未提供',
    /** 取数时刻（由 compose 注入；⛔ 适配器不自造） */
    retrievedAt,
    retrievedAtText: retrievedAt ? formatDateTime(retrievedAt) : '—'
  });
}

function adaptFreshness(overview, runtimeStatus) {
  const snapRaw = overview && overview.snapshot_date ? overview.snapshot_date : null;
  const decRaw = runtimeStatus && runtimeStatus.decision_date ? runtimeStatus.decision_date : null;

  const snapshot = withText(assess(snapRaw, 'snapshot'));
  const decision = withText(assess(decRaw, 'decision'));

  // 总体取「较差」的一档：MISSING 最差，其次 STALE
  const rank = { MISSING: 3, STALE: 2, FRESH: 1 };
  const overall = (rank[decision.level] || 0) > (rank[snapshot.level] || 0) ? decision : snapshot;

  return Object.freeze({
    /** 兼容 M2 形状 */
    overview: snapshot,
    snapshot,
    decision,
    overall
  });
}

function withText(r) {
  return Object.freeze({ ...r, text: describeFreshness(r) });
}

/* ==================== 其他导出 ==================== */

export { hasCanonicalContract };
