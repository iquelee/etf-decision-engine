/**
 * ETF 详情适配器（web/src/rewrite/adapters/etfDetail.js）
 * 规范依据：SPEC §2 / §4.2 / §9 / 附录 A ＋ owner 裁定 M4-D1/D2/D3（2026-09-30）
 *
 * 职责：`GET /api/etf/:code`（＋可选 `kline`）原始响应 → ETF 工作台 ViewModel。
 *
 * ══════════════════════════════════════════════════════════════════
 * ★ 三条**语义边界硬约束**（M4-P0 §B，⛔ 违反即返工）
 *   1. `V3 Safety Core → Formal Decision / Authority`
 *      `Gen-1 → Timing / Advisory`
 *      `Gen-2 → Selection / Research / Shadow`
 *   2. **Gen-1 不得视觉上伪装成正式决策**：Gen-1 区必须有独立身份标题与更弱视觉权重；
 *      `gen1.counterfactual.*` ⛔ 不得覆盖 `decision.finalTargetPct`。
 *   3. **Gen-2 不进入正式 Decision 区**（本页当前不呈现 Gen-2 数据）。
 *
 * ★ 三条**明文禁止**（用户 M4-P1 指令）
 *   禁止 1 · 前端重算：⛔ 不重算 `position_gap` / 防守分 / 防守等级 / `final target`；
 *   禁止 2 · 跨 endpoint 偷补：detail 缺字段 ⛔ 不得去 `etf/list` 找同名补上；
 *   禁止 3 · legacy → canonical 偷升级：`decision.gen1_*` / `ml_shadow`
 *            只能叫「Legacy Gen-1 Advisory」，⛔ 不得叫「Canonical Gen-1」。
 *
 * ★ 关键区分（SPEC 附录 A.4 / M4-P0 §F.3「同名字段不同义」）：
 *   · `decision.target_min/std/max` = 本次决策的最终目标带（经约束后）
 *   · `position.target_min/std/max` = 配置的标准目标带（来自 etf_basic）
 *   · `decision.core_position`（**建议** 0.2） ≠ `position.core_position`（**实际** 12.6）
 *   · `decision.trade_position`（0.3） ≠ `position.trade_position`（8.4）
 *   ⇒ ⛔ 不可合并、⛔ 不可互相顶替、⛔ 不可放进同一个无标签数字卡。
 *
 * ★ 单位（SPEC 附录 A）：`*_position` / `target_*` / `premium_rate` / `change_5d` / `bias_20d` = **百分数**；
 *   `price_position` / `volume_ratio` = **0~1 比例**；`stage_factor` / `market_factor` = **系数**；
 *   `atr20` = **价格**；`vol20` / `shares` = **份**。
 */
import { provided, missing, unavailable, readField, readBlock, provenance, hasValue } from '../domain/provenance.js';
import { FIELD_STATE, MISSING_REASON, AUTHORITY, FRESHNESS, GEN1_CHANNEL } from '../domain/enums.js';
import { adaptDecision } from './decision.js';
import { adaptGen1, legacyFallback } from './gen1.js';
import { adaptGen1ForDetail } from './gen1Detail.js';
import { adaptKline } from './kline.js';
import { adaptMarketRegime } from './marketRegime.js';
import { adaptDefense } from './defense.js';
import { adaptOpportunity } from './opportunity.js';
import { adaptIntelligence } from './intelligence.js';
import { adaptDecisionHistory } from './decisionHistory.js';
import { assess, describe, isSeverelyStale, staleDays } from '../domain/freshness.js';
import {
  pctText, ratioText, scoreText, priceText, countText, dateText, dateTimeText, rawText, factorText
} from '../domain/display.js';
import {
  actionLabel, toneForAction, riskLabel, toneForRisk, normalizeRisk, stateLabel, sectorLabel,
  overAllocLabel, etfName, fieldStateText, missingReasonText,
  IDENTITY_SAFETY_CORE, IDENTITY_GEN1, GEN1_BOUNDARY_NOTE, IDENTITY_GEN2, GEN2_BOUNDARY_NOTE,
  KLINE_STALE_TITLE, KLINE_STATUS_LABEL, KLINE_STALE_KEEP_NOTE, klineStaleBannerText,
  CHAIN_SECTION_TITLE, CHAIN_MODE_NOTE, chainHiddenSummary,
  POSITION_KIND_LABEL, POSITION_KIND_NOTE, GAP_SOURCE_NOTE, NO_RECOMPUTE_NOTE,
  SINGLE_SOURCE_PRINCIPLE, PRIMARY_DECISION_SCOPE_NOTE,
  POSITION_RISK_SCOPE_NOTE, DEFENSE_SCOPE_NOTE, OPPORTUNITY_SCOPE_NOTE
} from '../domain/labels.js';
/* ★ M5-P10（2026-10-01）：删除 dead import `opportunityLevel`
   （该标识符在本文件内零引用 —— 用未使用导入扫描器逐项核实） */

const SRC = 'api:/api/etf/:code';
const SRC_K = 'api:/api/etf/:code/kline';
const SRC_LIST_NOTE = '⛔ 本页不使用 /api/etf/list（禁止跨 endpoint 偷补字段）';
const P = (f) => provenance({ source: SRC + (f ? '.' + f : ''), authority: AUTHORITY.SAFETY_CORE });
const P_OPS = (f) => provenance({ source: SRC + (f ? '.' + f : ''), authority: AUTHORITY.OPERATOR });

/**
 * @param {object|null} data `/api/etf/:code` 的 data
 * @param {object|null} runtimeStatus `/api/constants` 的 runtime_status（可选）
 * @param {{klineRaw?:any, decisionsRaw?:any, marketRaw?:any, retrievedAt?:string}} [options]
 *        `klineRaw`：`/api/etf/:code/kline` 的 data（可选；未传 ⇒ UNAVAILABLE）
 *        `decisionsRaw`：`/api/etf/:code/decisions` 的 data（未传 = 未请求 · null = 失败）
 *        `marketRaw`：`/api/dashboard` 的 data（M5-P1 只读引用组合环境；未传 ⇒ UNAVAILABLE）
 *        `retrievedAt`：取数时刻，由 **compose 层**注入（⛔ 适配器不自造时间）
 */
export function adaptEtfDetail(data, runtimeStatus = null, options = {}) {
  /**
   * ⚠️ 数组不是合法的 `/api/etf/:code` data ⇒ 必须判为不可用。
   *   （`typeof [] === 'object'`，只判 typeof 会把空数组当成"页面存在"，导致渲染一堆空块。）
   */
  const empty = !data || typeof data !== 'object' || Array.isArray(data);
  const basic = empty ? null : data.basic;
  const snapshot = empty ? null : data.snapshot;
  const rawPosition = empty ? null : data.position;

  const decision = adaptDecision(data && data.decision);
  const position = adaptPosition(rawPosition);
  const kline = adaptKlineBlock(options.klineRaw, options.klineError);
  const gen1Detail = adaptGen1ForDetail(data, runtimeStatus);
  const risk = adaptRisk(decision, empty ? null : data.risk_events, snapshot);

  /* ---- M4-P1 第二阶段：机会 / 防守 / 情报 / 历史 ---- */
  /**
   * 风险事件只适配**一次**，供「防守雷达」与「情报」**共用同一对象**
   * （⛔ 不重复计算，避免两处展示出现分歧）。
   */
  const riskEventsField = adaptRiskEvents(empty ? null : data.risk_events);
  const defense = adaptDefense(decision, riskEventsField, snapshot);
  const opportunity = adaptOpportunity(decision);
  const intelligence = adaptIntelligence(empty ? null : data.fundamental, defense.events);
  const decisionHistory = adaptDecisionHistory(options.decisionsRaw, { retrievedAt: retrievedAt(options) });

  const snapshotFreshness = assess(snapshot && snapshot.calc_date, 'snapshot');
  const decisionFreshness = assess(
    hasValue(decision.decisionDate) ? decision.decisionDate.value : null, 'decision');
  const klineFreshness = assess(kline.lastBarDate, 'kline');
  const fundamentalFreshness = assess(
    empty || !data.fundamental ? null : data.fundamental.updated_at, 'fundamentals');

  /** 先构造 body，再统一冻结并派生 `missingItems`（需要遍历已成型结构） */
  const body = {
    available: !empty,

    /* ---- 标的身份 ---- */
    identity: adaptIdentity(basic, snapshot, retrievedAt(options)),

    /**
     * ---- 组合环境（M5-P1 D-M5-3：**只读引用** /api/dashboard#overview.market_regime）----
     * `options.marketRaw`：`undefined` = 未请求 · `null` = 请求失败 · 对象 = 已取到
     * ⇒ 取不到时 **NOT_PROVIDED**，⛔ 不由标的字段（trend_context 等）推导市场状态。
     */
    marketRegime: adaptMarketRegime(options.marketRaw),

    /* ---- ① 正式决策（V3 Safety Core · 唯一权威层） ---- */
    decision: adaptDecisionView(decision),

    /* ---- ② 实际持仓（⛔ ≠ decision 的建议值） ---- */
    position: adaptPositionView(position),

    /* ---- ③ 风险 ---- */
    risk,

    /* ---- ④ Gen-1（Timing / Advisory；★ M4-D1 三通道，Legacy 显式降级） ---- */
    gen1Detail,

    /* ---- ④b 机会 / 辅助信号（★ 不是「建议加仓」，⛔ 不由 gap 推导） ---- */
    opportunity,

    /* ---- ④c 防守雷达（★ 只用后端已算 level/score/factor，⛔ 不重算） ---- */
    defense,

    /* ---- ④d 情报 / 基本面摘要（⛔ 不展开 fundamental_config / series） ---- */
    intelligence,

    /* ---- ④e 历史决策变化（★ 真实 API；无则 NOT_PROVIDED，⛔ 不伪造） ---- */
    decisionHistory,

    /* ---- ⑤ 价格 / 量价（快照口径） ---- */
    price: adaptPrice(snapshot),

    /* ---- ⑥ K 线（★ M4-D2：独立新鲜度，⛔ 不与 decision 合并） ---- */
    kline: adaptKlineView(kline, klineFreshness, decisionFreshness, hasValue(decision.decisionDate) ? decision.decisionDate.value : null),

    /* ---- ⑦ 结构识别（W/D/H/V + 横盘 + 量价 + 均线） ---- */
    structure: adaptStructure(snapshot),

    /* ---- ⑧ 基本面摘要（⛔ 不搬 fundamental_config / fundamental_series） ---- */
    fundamentalsSummary: adaptFundamentalsSummary(empty ? null : data.fundamental),

    /* ---- ⑨ 新鲜度总表（各域**独立**） ---- */
    freshness: Object.freeze({
      snapshot: Object.freeze({ ...snapshotFreshness, text: describe(snapshotFreshness) }),
      decision: Object.freeze({ ...decisionFreshness, text: describe(decisionFreshness) }),
      quote: Object.freeze({ ...snapshotFreshness, text: describe(snapshotFreshness) }),
      kline: Object.freeze({ ...klineFreshness, text: describe(klineFreshness) }),
      fundamental: Object.freeze({ ...fundamentalFreshness, text: describe(fundamentalFreshness) })
    }),

    /* ---- ⑩ 来源 / 边界 ---- */
    provenance: Object.freeze({
      source: SRC,
      listEndpointNote: SRC_LIST_NOTE,
      gen1Channel: gen1Detail.channel,
      gen1ChannelLabel: gen1Detail.channelLabel,
      fallbackFrom: gen1Detail.channel === GEN1_CHANNEL.DECISION_LEGACY ? 'legacy' : null,
      retrievedAt: retrievedAt(options),
      retrievedAtText: retrievedAt(options) ? dateTimeText(provided(retrievedAt(options), P(''))).text : '—',
      /** 面向用户的中文块名（⛔ 不暴露后端块名） */
      blocks: Object.freeze(['基础信息', '快照', '决策', '实际持仓', '风险事件', '影子观察', '基本面']),
      /** 技术块名（供审计 / 测试对照，⛔ UI 不渲染） */
      blockKeys: Object.freeze(['basic', 'snapshot', 'decision', 'position', 'risk_events', 'ml_shadow', 'fundamental']),
      notConsumedBlocks: Object.freeze(['基本面分层配置', '基本面序列', '前十大重仓', '重仓报告期'])
    }),

    boundaries: Object.freeze({
      safetyCoreIdentity: IDENTITY_SAFETY_CORE,
      gen1Identity: IDENTITY_GEN1,
      gen1Note: GEN1_BOUNDARY_NOTE,
      gen2Identity: IDENTITY_GEN2,
      gen2Note: GEN2_BOUNDARY_NOTE,
      positionKinds: POSITION_KIND_LABEL,
      positionKindNotes: POSITION_KIND_NOTE,
      chainTitle: CHAIN_SECTION_TITLE,
      chainNote: CHAIN_MODE_NOTE,
      /** 统一「不重算」声明（⛔ 组件不硬编码） */
      noRecomputeNote: NO_RECOMPUTE_NOTE,
      /* ---- M5-P1：单源展示（Single-Source Display）自述文案，⛔ 组件不硬编码 ---- */
      singleSourcePrinciple: SINGLE_SOURCE_PRINCIPLE,
      primaryDecisionScopeNote: PRIMARY_DECISION_SCOPE_NOTE,
      positionRiskScopeNote: POSITION_RISK_SCOPE_NOTE,
      defenseScopeNote: DEFENSE_SCOPE_NOTE,
      opportunityScopeNote: OPPORTUNITY_SCOPE_NOTE
    }),

    /* ══ 以下为 M2 既有键（⛔ 保留，零回归）══ */
    basic: Object.freeze({
      code: readField(basic, 'code', P_OPS('basic.code')),
      name: readField(basic, 'name', P_OPS('basic.name')),
      sector: readField(basic, 'sector', P_OPS('basic.sector')),
      isQdii: readField(basic, 'is_qdii', P_OPS('basic.is_qdii')),
      status: readField(basic, 'status', P_OPS('basic.status')),
      maxPosition: readField(basic, 'max_position', P_OPS('basic.max_position')),
      targetPosition: readField(basic, 'target_position', P_OPS('basic.target_position'))
    }),
    snapshot: adaptSnapshot(snapshot),
    riskEvents: adaptRiskEvents(empty ? null : data.risk_events),
    /** ⚠️ canonical 契约四块（供审计/后台复用）；⛔ **页面不得消费** —— 页面用 `gen1Detail` */
    gen1: adaptGen1(data),
    legacyFallback: legacyFallback(data, runtimeStatus),
    fundamentalBrief: adaptFundamentalBrief(empty ? null : data.fundamental),
    holdings: adaptHoldings(empty ? null : data.holdings, empty ? null : data.holdings_date)
  };

  return Object.freeze({
    ...body,
    /** ★ 集中列出「显式缺失 / 未提供」的展示项（⛔ 不静默；供数据质量区渲染） */
    missingItems: Object.freeze(collectMissing(body))
  });
}

/**
 * 扫描**关键展示位**的 `Field`，收集非 PROVIDED 的项。
 * ⚠️ 用**显式清单**而非深度递归：递归会把 chain.steps 的内部 raw 也扫进来（噪声），
 *    且清单本身即"本页承诺要显示什么"的可测契约。
 */
const MISSING_SCAN = Object.freeze([
  ['组合环境', (b) => b.marketRegime.regime],
  ['决策 · 动作', (b) => b.decision.action],
  ['决策 · 最终目标', (b) => b.decision.finalTarget],
  ['决策 · 仓位缺口', (b) => b.decision.positionGap],
  ['决策 · 目标带上限', (b) => b.decision.targetBand.max],
  ['决策 · 建议仓位', (b) => b.decision.suggestedPosition],
  ['决策 · 下一加仓条件', (b) => b.decision.nextAddCondition],
  ['实际 · 当前仓位', (b) => b.position.currentPosition],
  ['实际 · 份额', (b) => b.position.shares],
  ['实际 · 成本价', (b) => b.position.avgCost],
  ['风险 · 风险等级', (b) => b.risk.flag],
  ['风险 · 溢价率', (b) => b.risk.premiumRate],
  ['行情 · 5 日涨跌', (b) => b.price.change5d],
  ['行情 · 价格位置', (b) => b.price.pricePosition],
  ['行情 · ATR20', (b) => b.price.atr20],
  ['结构 · 周线状态', (b) => b.structure.states.w],
  ['结构 · 日线状态', (b) => b.structure.states.d],
  ['结构 · 横盘状态', (b) => b.structure.states.h],
  ['结构 · 量能状态', (b) => b.structure.states.v],
  ['结构 · 量比', (b) => b.structure.volume.ratio],
  ['基本面 · 状态', (b) => b.fundamentalsSummary.fState],
  /* ---- M4-P1 第二阶段 ---- */
  ['机会 · 机会分', (b) => b.opportunity.score],
  ['机会 · 机会系数', (b) => b.opportunity.factor],
  ['机会 · 加仓模式', (b) => b.opportunity.addMode],
  ['防守 · 等级', (b) => b.defense.level],
  ['防守 · 分数', (b) => b.defense.score],
  ['防守 · 系数', (b) => b.defense.factor],
  ['情报 · 基本面状态', (b) => b.intelligence.fundamental.fState],
  /* ⚠️ gen1Detail 输出的已是 display 对象 ⇒ 取 `.field` 才能拿到原 Field 的状态 */
  ['Gen-1 · 权限档位', (b) => b.gen1Detail.authority.field],
  ['Gen-1 · 健康状态', (b) => b.gen1Detail.healthStatus.field],
  ['Gen-1 · 模型概率', (b) => b.gen1Detail.signal.probability.field],
  ['Gen-1 · 反事实目标', (b) => b.gen1Detail.counterfactual.targetPct.field]
]);

function collectMissing(body) {
  const out = [];
  for (const [label, pick] of MISSING_SCAN) {
    let f = null;
    try { f = pick(body); } catch (e) { f = null; }
    if (!f || typeof f !== 'object' || !f.state) continue;
    if (f.state === FIELD_STATE.PROVIDED || f.state === FIELD_STATE.STALE) continue;
    out.push(Object.freeze({
      k: label,
      v: fieldStateText(f.state),
      /** 缺失原因（可读） */
      r: f.missingReason ? missingReasonText(f.missingReason) : ''
    }));
  }
  return out;
}

const retrievedAt = (options) => (options && options.retrievedAt) || null;

/* ==================== ① identity ==================== */

function adaptIdentity(basic, snapshot, rt) {
  const nameF = readField(basic, 'name', P_OPS('basic.name'));
  const codeF = readField(basic, 'code', P_OPS('basic.code'));
  const sectorF = readField(basic, 'sector', P_OPS('basic.sector'));
  return Object.freeze({
    code: codeF,
    codeText: hasValue(codeF) ? String(codeF.value) : '—',
    name: nameF,
    /** 名称缺失时用代码兜底显示（⛔ 不虚构名称） */
    nameText: hasValue(nameF) ? String(nameF.value) : (hasValue(codeF) ? etfName(codeF.value) : '—'),
    sector: sectorF,
    sectorText: hasValue(sectorF) ? sectorLabel(sectorF.value) : '—',
    isQdii: readField(basic, 'is_qdii', P_OPS('basic.is_qdii')),
    status: readField(basic, 'status', P_OPS('basic.status')),
    maxPosition: readField(basic, 'max_position', P_OPS('basic.max_position')),
    maxPositionText: pctText(readField(basic, 'max_position', P_OPS('basic.max_position'))),
    /** 配置层面的标准目标（⛔ 不是本次决策结果） */
    configTarget: readField(basic, 'target_position', P_OPS('basic.target_position')),
    configTargetText: pctText(readField(basic, 'target_position', P_OPS('basic.target_position'))),
    asOf: readField(snapshot, 'calc_date', P('snapshot.calc_date')),
    asOfText: dateText(readField(snapshot, 'calc_date', P('snapshot.calc_date'))),
    retrievedAt: rt
  });
}

/* ==================== ② 正式决策（V3 Safety Core） ==================== */

function adaptDecisionView(d) {
  // ⚠️ decision 不可用时 `adaptDecision` 只返回 `{available,reason,action}` ⇒ 其余键不存在。
  //    必须返回**同形状的全缺失骨架**（⛔ 不让组件读到 undefined，⛔ 不让适配器抛异常）。
  if (!d || d.available !== true) return emptyDecisionView(d);
  const chainHidden = d.chain && d.chain.hiddenCount ? chainHiddenSummary(d.chain.hiddenCount, d.chain.total) : '';
  return Object.freeze({
    /**
     * ★★ 先**原样展开 M2 的字段**（⛔ 零回归）：
     *   `finalTarget` / `targetBand` / `positionGap` / `overAllocStatus` / `addEligibility` /
     *   `explainChain` / `scores` / `factors` / `audit` 等全部保留原语义与原名。
     *   M4 的展示字段一律用**新名**（`*Text` / `*View`）追加，⛔ 绝不覆盖 M2 的键。
     */
    ...d,

    /** ★ 归属标注：本块数据属 V3 Safety Core（正式权威） */
    identity: IDENTITY_SAFETY_CORE,
    isFormalAuthority: true,

    /** 决策日（展示） */
    dateText: dateText(d.decisionDate),

    actionText: hasValue(d.action) ? actionLabel(d.action.value) : fieldStateText(d.action.state),
    actionTone: hasValue(d.action) ? toneForAction(d.action.value) : 'muted',

    /* 目标与仓位（★ 建议口径，单位=百分数） */
    finalTarget: d.finalTarget,
    finalTargetText: pctText(d.finalTarget),
    targetBand: Object.freeze({
      min: d.targetBand.min, std: d.targetBand.std, max: d.targetBand.max,
      minText: pctText(d.targetBand.min),
      stdText: pctText(d.targetBand.std),
      maxText: pctText(d.targetBand.max),
      /** 区间整串（缺失时由 pctText 各自标注，⛔ 不伪造数字） */
      rangeText: `${pctText(d.targetBand.min).text} ~ ${pctText(d.targetBand.max).text}`
    }),
    /** ⛔ 服务端已算（`max(0, final_target − suggested)`）⇒ 只展示，⛔ 不重算 */
    gap: d.positionGap,
    gapText: pctText(d.positionGap, 1, true),
    /** 来源标注（⛔ 组件不得硬编码这句话） */
    gapNote: GAP_SOURCE_NOTE,
    suggestedPosition: d.suggestedPosition,
    suggestedPositionText: pctText(d.suggestedPosition),
    maxPosition: d.maxPosition,
    maxPositionText: pctText(d.maxPosition),

    /* ⚠️ 以下两个是**建议值**（decision 块），⛔ 与实际持仓（position 块）不同 */
    suggestedCore: d.corePosition,
    suggestedCoreText: pctText(d.corePosition),
    suggestedTrade: d.tradePosition,
    suggestedTradeText: pctText(d.tradePosition),

    overAlloc: d.overAllocStatus,
    /** ⚠️ 线上实测为**中文**「中度」⇒ 归一在 labels（⛔ 不得假设英文枚举） */
    overAllocText: hasValue(d.overAllocStatus) ? overAllocLabel(d.overAllocStatus.value) : fieldStateText(d.overAllocStatus.state),

    cooldownDays: d.cooldownDays,
    cooldownText: scoreText(d.cooldownDays),
    nextAddCondition: d.nextAddCondition,
    nextAddConditionText: rawText(d.nextAddCondition),

    opportunity: Object.freeze({
      grade: d.opportunity.grade,
      score: d.opportunity.score,
      level: d.opportunity.level,
      gradeText: hasValue(d.opportunity.grade) ? String(d.opportunity.grade.value) : fieldStateText(d.opportunity.grade.state),
      scoreText: scoreText(d.opportunity.score)
    }),

    /** M4 展示层（⛔ 用新名 `scoresView`，避免覆盖 M2 的 `scores`（Field 形态）） */
    scoresView: Object.freeze({
      trend: scoreText(d.scores.trend),
      volume: scoreText(d.scores.volume),
      fundamental: scoreText(d.scores.fundamental),
      crowding: scoreText(d.scores.crowding),
      risk: scoreText(d.scores.risk)
    }),

    /** 决策链定性版（M2 只有 `explainChain` 原文；`chain` 是 M4-D3 策略产物） */
    chain: d.chain,
    chainHiddenSummary: chainHidden,

    /** ⛔ 系数 0~1（新名 `factorsView`；M2 的 `factors` 保持 Field 形态不变） */
    factorsView: Object.freeze({
      stage: factorText(d.factors.stage),
      market: factorText(d.factors.market)
    }),

    engineVersion: rawText(d.audit.engineVersion),
    effectiveMarketRegime: rawText(d.audit.effectiveMarketRegime)
  });
}

/**
 * decision 不可用时的**同形状骨架**（全字段 UNAVAILABLE）。
 * ★ 目的：组件可以无差别渲染，⛔ 不必到处写 `v-if`；缺失一律显式、⛔ 不显示 0 / —。
 */
function emptyDecisionView(d) {
  const m = (f) => unavailable(MISSING_REASON.CONTRACT_NOT_PROVIDED, P('decision.' + f));
  const one = () => m('(block absent)');
  const bandMin = m('target_min');
  const bandStd = m('target_std');
  const bandMax = m('target_max');
  return Object.freeze({
    identity: IDENTITY_SAFETY_CORE,
    isFormalAuthority: true,
    available: false,
    reason: (d && d.reason) || MISSING_REASON.CONTRACT_NOT_PROVIDED,

    date: m('decision_date'),
    dateText: dateText(m('decision_date')),

    action: (d && d.action) || m('final_action'),
    actionText: fieldStateText(((d && d.action) || m('final_action')).state),
    actionTone: 'muted',

    finalTarget: m('final_target'),
    finalTargetText: pctText(m('final_target')),
    targetBand: Object.freeze({
      min: bandMin, std: bandStd, max: bandMax,
      minText: pctText(bandMin), stdText: pctText(bandStd), maxText: pctText(bandMax),
      rangeText: '数据未提供'
    }),
    gap: m('position_gap'),
    gapText: pctText(m('position_gap'), 1, true),
    gapNote: GAP_SOURCE_NOTE,
    /** ⚠️ M2 原名（⛔ 必须保留，否则 M2 的断言会取到 undefined） */
    positionGap: m('position_gap'),
    overAllocStatus: m('over_alloc_status'),
    suggestedPosition: m('suggested_position'),
    suggestedPositionText: pctText(m('suggested_position')),
    maxPosition: m('max_position'),
    maxPositionText: pctText(m('max_position')),
    suggestedCore: m('core_position'),
    suggestedCoreText: pctText(m('core_position')),
    suggestedTrade: m('trade_position'),
    suggestedTradeText: pctText(m('trade_position')),
    overAlloc: m('over_alloc_status'),
    overAllocText: fieldStateText(FIELD_STATE.UNAVAILABLE),

    cooldownDays: m('cooldown_days'),
    cooldownText: scoreText(m('cooldown_days')),
    nextAddCondition: m('next_add_condition'),
    nextAddConditionText: rawText(m('next_add_condition')),

    opportunity: Object.freeze({
      grade: one(), score: one(),
      level: { grade: null, label: '—', tone: 'muted' },
      gradeText: fieldStateText(FIELD_STATE.UNAVAILABLE),
      scoreText: scoreText(one())
    }),
    /** M2 形态（Field）—— ⛔ 保持原名，供 M2 断言与审计 */
    scores: Object.freeze({
      trend: one(), volume: one(), fundamental: one(), crowding: one(), risk: one()
    }),
    /** M4 展示形态（新名） */
    scoresView: Object.freeze({
      trend: scoreText(one()), volume: scoreText(one()), fundamental: scoreText(one()),
      crowding: scoreText(one()), risk: scoreText(one())
    }),
    addEligibility: Object.freeze({ available: false, items: Object.freeze([]), overall: one() }),
    explainChain: one(),
    audit: Object.freeze({
      engineVersion: one(), configVersion: one(), decisionTimestamp: one(),
      enginePath: one(), effectiveMarketRegime: one()
    }),
    chain: Object.freeze({
      mode: 'QUALITATIVE_ONLY', available: false, state: FIELD_STATE.UNAVAILABLE,
      missingReason: MISSING_REASON.CONTRACT_NOT_PROVIDED,
      steps: Object.freeze([]), total: 0, hiddenCount: 0, note: CHAIN_MODE_NOTE
    }),
    chainHiddenSummary: '',
    /** M2 形态（Field） */
    factors: Object.freeze({ stage: one(), market: one() }),
    /** M4 展示形态（新名） */
    factorsView: Object.freeze({ stage: factorText(one()), market: factorText(one()) }),
    engineVersion: rawText(one()),
    effectiveMarketRegime: rawText(one())
  });
}

/* ==================== ③ 实际持仓（≠ 建议） ==================== */

function adaptPositionView(p) {
  return Object.freeze({
    /**
     * ★★ 先**原样展开 M2 的字段**（⛔ 零回归）：`currentPosition` / `band` / `maxPosition` /
     *   `maxStrategicPosition` / `corePosition` / `tradePosition` / `shares` / `avgCost` /
     *   `updatedAt` / `grade` 全部保留原名。
     *   M4 的展示字段一律用**新名**追加（`configBand` / `realCoreText` 等）。
     */
    ...p,

    /** ★ 归属标注：实际持仓，与 decision 的建议值**不同轴** */
    kind: 'actual',
    kindLabel: POSITION_KIND_LABEL.actual,
    kindNote: POSITION_KIND_NOTE.actual,

    available: p.available,
    currentPosition: p.currentPosition,
    currentPositionText: pctText(p.currentPosition),

    /** 配置的标准目标带（⛔ ≠ decision.targetBand） */
    configBand: Object.freeze({
      min: p.band.min, std: p.band.std, max: p.band.max,
      minText: pctText(p.band.min),
      stdText: pctText(p.band.std),
      maxText: pctText(p.band.max),
      rangeText: `${pctText(p.band.min).text} ~ ${pctText(p.band.max).text}`,
      kindLabel: POSITION_KIND_LABEL.config,
      kindNote: POSITION_KIND_NOTE.config
    }),

    maxPosition: p.maxPosition,
    maxPositionText: pctText(p.maxPosition),
    maxStrategic: p.maxStrategicPosition,
    maxStrategicText: pctText(p.maxStrategicPosition),

    /** ★ 实际核心/交易（⛔ 与 decision 的建议值区分显示） */
    realCore: p.corePosition,
    realCoreText: pctText(p.corePosition),
    realTrade: p.tradePosition,
    realTradeText: pctText(p.tradePosition),

    shares: p.shares,
    sharesText: countText(p.shares),
    avgCost: p.avgCost,
    avgCostText: priceText(p.avgCost),
    grade: p.grade,
    updatedAt: p.updatedAt,
    updatedAtText: dateTimeText(p.updatedAt)
  });
}

/* ==================== ④ 风险 ==================== */

/**
 * ⚠️ `risk_flag`（英）/ `premium_flag`（**中**「正常」）中英混合 ⇒ 统一走 `normalizeRisk`。
 * 依据：M4-P0 §F.1；⛔ 不得按字段名假设语言（M2/M3 已连续踩两次）。
 */
function adaptRisk(decision, events, snapshot) {
  /**
   * ⚠️ 防御：`decision` 不可用时（`adaptDecision` 返回 `{available:false, reason, action}`）
   *    这些键**不存在** ⇒ 必须回落到显式 UNAVAILABLE，⛔ 不得让适配器抛异常
   *    （页面宁可显示「数据未提供」，也不能整页崩）。
   */
  const miss = (f) => unavailable(MISSING_REASON.CONTRACT_NOT_PROVIDED, P('decision.' + f));
  const flagF = (decision && decision.riskFlag) || miss('risk_flag');
  const overrideF = (decision && decision.riskOverride) || miss('risk_override');
  const premiumF = (decision && decision.premiumFlag) || miss('premium_flag');
  const premiumRaw = hasValue(premiumF) ? premiumF.value : null;
  const premiumCode = normalizeRisk(premiumRaw);

  const list = adaptRiskEvents(events);
  const items = hasValue(list) ? list.value : [];

  return Object.freeze({
    flag: flagF,
    flagText: hasValue(flagF) ? riskLabel(flagF.value) : fieldStateText(flagF.state),
    tone: hasValue(flagF) ? toneForRisk(flagF.value) : 'muted',
    override: overrideF,
    overrideText: hasValue(overrideF) ? (overrideF.value === true ? '是' : String(overrideF.value)) : fieldStateText(overrideF.state),
    overrideActive: hasValue(overrideF) && overrideF.value === true,

    premiumFlag: premiumF,
    /** ★ 归一后的中文（⛔ 不假设英文枚举） */
    premiumText: premiumRaw === null ? fieldStateText(premiumF.state) : (premiumCode ? riskLabel(premiumCode) : String(premiumRaw)),
    premiumTone: premiumCode ? toneForRisk(premiumCode) : 'muted',

    premiumRate: readField(snapshot, 'premium_rate', P('snapshot.premium_rate')),
    premiumRateText: pctText(readField(snapshot, 'premium_rate', P('snapshot.premium_rate'))),

    events: items,
    eventCount: items.length,
    /** 线上恒空 ⇒ UI 需有「无事件」态（⛔ 不得显示空条） */
    hasEvents: items.length > 0,
    eventsState: list.state,
    eventsReason: list.missingReason || null
  });
}

/* ==================== ⑤ 价格 / 量价 ==================== */

function adaptPrice(s) {
  return Object.freeze({
    /** 百分数 */
    change5d: readField(s, 'change_5d', P('snapshot.change_5d')),
    change5dText: pctText(readField(s, 'change_5d', P('snapshot.change_5d')), 2, true),
    bias20d: readField(s, 'bias_20d', P('snapshot.bias_20d')),
    bias20dText: pctText(readField(s, 'bias_20d', P('snapshot.bias_20d')), 2, true),
    /** ★ 0~1 比例（⛔ 不是百分数） */
    pricePosition: readField(s, 'price_position', P('snapshot.price_position')),
    pricePositionText: ratioText(readField(s, 'price_position', P('snapshot.price_position'))),
    /** ★ `atr20` 是**价格**（元），不是百分比 */
    atr20: readField(s, 'atr20', P('snapshot.atr20')),
    atr20Text: priceText(readField(s, 'atr20', P('snapshot.atr20'))),
    /** ★ `vol20` 单位是**份** */
    vol20: readField(s, 'vol20', P('snapshot.vol20')),
    vol20Text: countText(readField(s, 'vol20', P('snapshot.vol20'))),
    dataComplete: readField(s, 'data_complete', P('snapshot.data_complete'))
  });
}

/* ==================== ⑥ K 线（★ M4-D2） ==================== */

/** 未传 klineRaw ⇒ UNAVAILABLE（未请求）；传了但请求失败 ⇒ ERROR。⛔ 两者都不得当成「0 根」 */
function adaptKlineBlock(rawKline, klineError) {
  const p = provenance({ source: SRC_K, authority: AUTHORITY.SAFETY_CORE });
  if (klineError) {
    return Object.freeze({
      state: FIELD_STATE.ERROR,
      value: null,
      missingReason: String(klineError),
      provenance: p,
      lastBarDate: null
    });
  }
  if (rawKline === undefined) {
    return Object.freeze({ state: FIELD_STATE.UNAVAILABLE, value: null, missingReason: MISSING_REASON.CONTRACT_NOT_PROVIDED, provenance: p, lastBarDate: null });
  }
  const f = adaptKline(rawKline);
  const bars = f.state === FIELD_STATE.PROVIDED ? f.value : null;
  return Object.freeze({
    ...f,
    lastBarDate: bars && bars.length ? bars[bars.length - 1].date : null
  });
}

/**
 * ★ 硬约束（owner 裁定 M4-D2）：
 *   · K 线 stale ⛔ **不得**扩展成 ETF decision stale —— 两者是**独立状态**；
 *   · ⛔ 不修改数据、⛔ 不猜最新价、⛔ 不删历史数据伪装正常、⛔ 不把 stale 当 empty；
 *   · 日期必须来自**实际数据**；
 *   · 图表**保留**（清空或隐藏 = 用 stale 冒充 empty）。
 */
function adaptKlineView(k, klineFreshness, decisionFreshness, decisionDateRaw) {
  const bars = k.state === FIELD_STATE.PROVIDED ? k.value : null;
  const lastBar = bars && bars.length ? bars[bars.length - 1] : null;
  const firstBar = bars && bars.length ? bars[0] : null;
  const severe = isSeverelyStale(klineFreshness);
  const lastBarDate = k.lastBarDate || null;
  const decisionDateText = decisionDateRaw ? String(decisionDateRaw).slice(0, 10) : null;

  return Object.freeze({
    state: k.state,
    missingReason: k.missingReason || null,
    available: bars !== null,
    bars: bars || Object.freeze([]),
    count: bars ? bars.length : 0,
    firstBarDate: firstBar ? firstBar.date : null,
    lastBarDate,
    lastBarDateText: lastBarDate || '—',

    /** ★ K 线**自己的**新鲜度（⛔ 与 decision 独立） */
    freshness: Object.freeze({ ...klineFreshness, text: describe(klineFreshness) }),
    isSeverelyStale: severe,
    staleDays: staleDays(klineFreshness),
    /**
     * 状态标签（与 decision freshness 分开展示）。
     * ★★ 七态必须**互不相同**（M5-P7 修正；此前「字段缺失(畸形)」与「合法空」都落到「无时间戳」⇒ 两态塌陷）：
     *    ① 读取失败（ERROR）      ② 未提供（UNAVAILABLE）   ③ 字段缺失（MISSING：非数组/无日期字段）
     *    ④ 无行情数据 0 根（PROVIDED + 空数组，**合法**）    ⑤ 无时间戳（有行但推不出日期）
     *    ⑥ 数据滞后（STALE）      ⑦ 数据新鲜（FRESH）
     *   ⚠️ 顺序即优先级：先判「结构性不可用」，再判「有行但无日期」，最后才落到新鲜度。
     *      「未请求」必须先判 —— 它的 `lastBarDate` 也是 null，否则会被说成「无时间戳」。
     */
    statusLabel: k.state === FIELD_STATE.ERROR ? KLINE_STATUS_LABEL.ERROR
      : k.state === FIELD_STATE.UNAVAILABLE ? KLINE_STATUS_LABEL.UNAVAILABLE
        : k.state === FIELD_STATE.MISSING ? KLINE_STATUS_LABEL.FIELD_MISSING
          : (bars !== null && bars.length === 0) ? KLINE_STATUS_LABEL.EMPTY
            : klineFreshness.level === FRESHNESS.FRESH ? KLINE_STATUS_LABEL.FRESH
              : klineFreshness.level === FRESHNESS.STALE ? KLINE_STATUS_LABEL.STALE
                : KLINE_STATUS_LABEL.MISSING,
    /** 读取失败原因（⛔ 不回显堆栈） */
    errorText: k.state === FIELD_STATE.ERROR ? String(k.missingReason || '') : '',

    /** ★ 置顶 banner（仅在严重滞后时出现；文案日期来自实际数据） */
    banner: severe ? Object.freeze({
      show: true,
      title: KLINE_STALE_TITLE,
      text: klineStaleBannerText(lastBarDate, decisionDateText)
    }) : Object.freeze({ show: false, title: '', text: '' }),

    keepNote: KLINE_STALE_KEEP_NOTE,

    /** ⚠️ 供 UI 明示「decision 的新鲜度与此无关」 */
    decisionFreshnessIndependent: true,
    decisionFreshnessText: describe(decisionFreshness)
  });
}

/* ==================== ⑦ 结构识别 ==================== */

function adaptStructure(s) {
  const states = Object.freeze({
    w: readField(s, 'w_state', P('snapshot.w_state')),
    d: readField(s, 'd_state', P('snapshot.d_state')),
    h: readField(s, 'h_state', P('snapshot.h_state')),
    v: readField(s, 'v_state', P('snapshot.v_state'))
  });
  return Object.freeze({
    available: !!(s && typeof s === 'object'),
    /** ★ 界面不得出现裸字母（SPEC §4.2）⇒ 同时给维度中文名 */
    states,
    stateRows: Object.freeze([
      { dim: '周线', code: states.w, codeText: hasValue(states.w) ? stateLabel(states.w.value) : fieldStateText(states.w.state), raw: states.w },
      { dim: '日线', code: states.d, codeText: hasValue(states.d) ? stateLabel(states.d.value) : fieldStateText(states.d.state), raw: states.d },
      { dim: '横盘', code: states.h, codeText: hasValue(states.h) ? stateLabel(states.h.value) : fieldStateText(states.h.state), raw: states.h },
      { dim: '量能', code: states.v, codeText: hasValue(states.v) ? stateLabel(states.v.value) : fieldStateText(states.v.state), raw: states.v }
    ]),
    consolidation: Object.freeze({
      trendContext: readField(s, 'trend_context', P('snapshot.trend_context')),
      trendContextText: rawText(readField(s, 'trend_context', P('snapshot.trend_context'))),
      sidewayDays: readField(s, 'sideway_days', P('snapshot.sideway_days')),
      sidewayDaysText: scoreText(readField(s, 'sideway_days', P('snapshot.sideway_days'))),
      sidewayRange: readField(s, 'sideway_range', P('snapshot.sideway_range')),
      sidewayRangeText: pctText(readField(s, 'sideway_range', P('snapshot.sideway_range'))),
      ma20Slope: readField(s, 'ma20_slope', P('snapshot.ma20_slope')),
      ma20SlopeText: pctText(readField(s, 'ma20_slope', P('snapshot.ma20_slope')), 2, true),
      score: readField(s, 'consolidation_score', P('snapshot.consolidation_score')),
      scoreText: scoreText(readField(s, 'consolidation_score', P('snapshot.consolidation_score')))
    }),
    volume: Object.freeze({
      /** ★ 0~1 比例（旧前端 `(1-ratio)*100` 系前端派生，本轮不启用） */
      ratio: readField(s, 'volume_ratio', P('snapshot.volume_ratio')),
      ratioText: ratioText(readField(s, 'volume_ratio', P('snapshot.volume_ratio'))),
      slope: readField(s, 'volume_slope', P('snapshot.volume_slope')),
      highVolumeStagnation: readField(s, 'high_volume_stagnation', P('snapshot.high_volume_stagnation')),
      highVolumeDecline: readField(s, 'high_volume_decline', P('snapshot.high_volume_decline'))
    }),
    ma: Object.freeze({
      ma5: priceText(readField(s, 'ma5', P('snapshot.ma5'))),
      ma10: priceText(readField(s, 'ma10', P('snapshot.ma10'))),
      ma20: priceText(readField(s, 'ma20', P('snapshot.ma20'))),
      ma60: priceText(readField(s, 'ma60', P('snapshot.ma60'))),
      ma120: priceText(readField(s, 'ma120', P('snapshot.ma120'))),
      ma250: priceText(readField(s, 'ma250', P('snapshot.ma250')))
    }),
    dataComplete: readField(s, 'data_complete', P('snapshot.data_complete')),
    /** ⛔ 前端不重算防守等级：后端已在 `etf/list[].defense` 与 `decision.defense_state` 算好，属其它页/后端范围 */
    defenseLevelNote: '本页不展示防守等级（后端已有两个权威来源；本页不得自行重算）'
  });
}

/* ==================== ⑧ 基本面摘要 ==================== */

function adaptFundamentalsSummary(f) {
  const P0 = P('fundamental');
  /**
   * ⚠️ 不可用时也必须返回**同形状骨架**（含 fScoreText / updatedAtText）——
   *    否则组件会收到 undefined 并在 SSR 渲染时抛错（M4-P1 实测被回归测试抓到）。
   */
  if (!f || typeof f !== 'object') {
    const u = () => unavailable(MISSING_REASON.CONTRACT_NOT_PROVIDED, P0);
    return Object.freeze({
      available: false,
      fState: u(),
      fStateText: fieldStateText(FIELD_STATE.UNAVAILABLE),
      fScore: u(),
      fScoreText: scoreText(u()),
      updatedAt: u(),
      updatedAtText: dateTimeText(u()),
      deepDetailNote: '分层权重与 AI 研究证据属「基本面」页；本页只给摘要。'
    });
  }
  const fState = readField(f, 'f_state', P0);
  return Object.freeze({
    available: true,
    fState,
    fStateText: hasValue(fState) ? stateLabel(fState.value) : fieldStateText(fState.state),
    fScore: readField(f, 'f_score', P0),
    fScoreText: scoreText(readField(f, 'f_score', P0)),
    updatedAt: readField(f, 'updated_at', P0),
    updatedAtText: dateTimeText(readField(f, 'updated_at', P0)),
    /** ⛔ 本页不搬 `fundamental_config` / `fundamental_series`（M6 范围） */
    deepDetailNote: '分层权重与 AI 研究证据属「基本面」页；本页只给摘要。'
  });
}

/* ==================== M2 既有函数（⛔ 原样保留，零回归） ==================== */

function adaptSnapshot(s) {
  const empty = !s || typeof s !== 'object';
  if (empty) {
    return Object.freeze({ available: false });
  }
  return Object.freeze({
    available: true,
    calcDate: readField(s, 'calc_date', P('snapshot.calc_date')),
    states: Object.freeze({
      w: readField(s, 'w_state', P('snapshot.w_state')),
      d: readField(s, 'd_state', P('snapshot.d_state')),
      h: readField(s, 'h_state', P('snapshot.h_state')),
      v: readField(s, 'v_state', P('snapshot.v_state'))
    }),
    consolidation: Object.freeze({
      trendContext: readField(s, 'trend_context', P('snapshot.trend_context')),
      sidewayDays: readField(s, 'sideway_days', P('snapshot.sideway_days')),
      sidewayRange: readField(s, 'sideway_range', P('snapshot.sideway_range')),
      ma20Slope: readField(s, 'ma20_slope', P('snapshot.ma20_slope')),
      score: readField(s, 'consolidation_score', P('snapshot.consolidation_score'))
    }),
    volume: Object.freeze({
      ratio: readField(s, 'volume_ratio', P('snapshot.volume_ratio')),
      slope: readField(s, 'volume_slope', P('snapshot.volume_slope')),
      highVolumeStagnation: readField(s, 'high_volume_stagnation', P('snapshot.high_volume_stagnation')),
      highVolumeDecline: readField(s, 'high_volume_decline', P('snapshot.high_volume_decline'))
    }),
    pricePosition: readField(s, 'price_position', P('snapshot.price_position')),
    premiumRate: readField(s, 'premium_rate', P('snapshot.premium_rate')),
    change5d: readField(s, 'change_5d', P('snapshot.change_5d')),
    bias20d: readField(s, 'bias_20d', P('snapshot.bias_20d')),
    dataComplete: readField(s, 'data_complete', P('snapshot.data_complete')),
    ma: Object.freeze({
      ma5: readField(s, 'ma5', P('snapshot.ma5')),
      ma10: readField(s, 'ma10', P('snapshot.ma10')),
      ma20: readField(s, 'ma20', P('snapshot.ma20')),
      ma60: readField(s, 'ma60', P('snapshot.ma60')),
      ma120: readField(s, 'ma120', P('snapshot.ma120')),
      ma250: readField(s, 'ma250', P('snapshot.ma250'))
    })
  });
}

function adaptPosition(p) {
  const empty = !p || typeof p !== 'object';
  if (empty) {
    return Object.freeze({
      available: false,
      currentPosition: unavailable(MISSING_REASON.CONTRACT_NOT_PROVIDED, P('position')),
      band: Object.freeze({ min: unavailable(MISSING_REASON.CONTRACT_NOT_PROVIDED, P('position')), std: unavailable(MISSING_REASON.CONTRACT_NOT_PROVIDED, P('position')), max: unavailable(MISSING_REASON.CONTRACT_NOT_PROVIDED, P('position')) })
    });
  }
  return Object.freeze({
    available: true,
    currentPosition: readField(p, 'current_position', P('position.current_position')),
    band: Object.freeze({
      min: readField(p, 'target_min', P('position.target_min')),
      std: readField(p, 'target_std', P('position.target_std')),
      max: readField(p, 'target_max', P('position.target_max'))
    }),
    maxPosition: readField(p, 'max_position', P('position.max_position')),
    maxStrategicPosition: readField(p, 'max_strategic_position', P('position.max_strategic_position')),
    corePosition: readField(p, 'core_position', P('position.core_position')),
    tradePosition: readField(p, 'trade_position', P('position.trade_position')),
    shares: readField(p, 'shares', P('position.shares')),
    avgCost: readField(p, 'avg_cost', P('position.avg_cost')),
    updatedAt: readField(p, 'updated_at', P('position.updated_at')),
    grade: Object.freeze({
      coreRatioGrade: readField(p, 'core_ratio_grade', P('position.core_ratio_grade')),
      tradeRatioGrade: readField(p, 'trade_ratio_grade', P('position.trade_ratio_grade'))
    })
  });
}

function adaptRiskEvents(list) {
  const P0 = P('risk_events');
  if (!Array.isArray(list)) return missing(MISSING_REASON.FIELD_ABSENT, P0);
  const items = list
    .filter((e) => e && typeof e === 'object')
    .map((e) => Object.freeze({
      id: readField(e, '_id', P0),
      code: readField(e, 'code', P0),
      eventType: readField(e, 'event_type', P0),
      riskFlag: readField(e, 'risk_flag', P0),
      riskOverride: readField(e, 'risk_override', P0),
      status: readField(e, 'status', P0),
      reason: readField(e, 'reason', P0),
      note: readField(e, 'note', P0),
      triggerTime: readField(e, 'trigger_time', P0)
    }));
  return provided(items, P0);
}

function adaptFundamentalBrief(f) {
  const P0 = P('fundamental');
  if (!f || typeof f !== 'object') {
    return Object.freeze({ available: false, fState: unavailable(MISSING_REASON.CONTRACT_NOT_PROVIDED, P0) });
  }
  return Object.freeze({
    available: true,
    fState: readField(f, 'f_state', P0),
    fScore: readField(f, 'f_score', P0),
    updatedAt: readField(f, 'updated_at', P0)
  });
}

function adaptHoldings(list, date) {
  const P0 = P('holdings');
  if (!Array.isArray(list)) return Object.freeze({ available: false, reportDate: readField({ report_date: date }, 'report_date', P0) });
  return Object.freeze({
    available: true,
    reportDate: readField({ report_date: date }, 'report_date', P0),
    items: list.filter((h) => h && typeof h === 'object').map((h) => Object.freeze({
      rank: readField(h, 'rank', P0),
      stockCode: readField(h, 'stock_code', P0),
      stockName: readField(h, 'stock_name', P0),
      weight: readField(h, 'weight', P0),
      market: readField(h, 'market', P0)
    }))
  });
}

export { hasValue, readBlock, FIELD_STATE, GEN1_CHANNEL, IDENTITY_SAFETY_CORE };
