/**
 * 事实主位注册表（web/src/rewrite/domain/ownership.js）
 * 规范依据：owner 裁定 M5-P1（2026-10-01）· Single-Source Display Governance
 *          ＋ M5-P0 IA Review §9 P0-1（跨区块重复渲染 15 个事实）
 *
 * ══════════════════════════════════════════════════════════════════════
 * ★★ 本模块的唯一职责：**声明「同一个后端事实归谁主位」**
 *
 *   规则（owner 原文口径）：
 *     «同一个 backend 事实，在页面中必须有唯一明确的主位；
 *       其他区块如必须出现，只能作为引用位，不能再次解释成另一套判断。»
 *
 *   ⇒ 因此每个事实只有 **1 个 owner**，可以有 **N 个 ref（引用位）**，
 *     且引用位必须满足：
 *       ① 视觉上带「引用」标记（由 `components/domain/Fact.vue` 统一渲染）；
 *       ② ⛔ 不得产生第二个独立语义解释（见每个事实的 `rule` / `forbid`）；
 *       ③ 引用位显示的数值必须与主位**同源**（同一次适配结果），⛔ 不得另算。
 *
 * ⛔ 本模块是**纯数据 + 纯函数**：不含业务计算、不触 api、不触 Vue。
 * ⛔ 不在此处做任何数字格式化（格式化是 `domain/format.js` / `domain/display.js` 的职责）。
 *
 * ★ 可测性：测试用 `data-fact` / `data-role` / `data-ref-to` 三个 DOM 属性断言
 *   「canonical owner count = 1」与「引用位必须带标记」，见 `tests/rewrite/single-source.test.js`。
 */

/* ══════════════════ ① 区块（owner / ref 的载体） ══════════════════ */

export const OWNER = Object.freeze({
  HEADER: 'WorkbenchHeader',
  PRIMARY_DECISION: 'PrimaryDecision',
  POSITION_RISK: 'PositionRisk',
  DEFENSE_RADAR: 'DefenseRadar',
  OPPORTUNITY_RADAR: 'OpportunityRadar',
  INTELLIGENCE: 'IntelligenceSection',
  DECISION_HISTORY: 'DecisionHistorySection',
  KLINE: 'KlineSection'
});

/** 面向用户的区块中文名（引用位文案「见「正式决策」」由这里拼，⛔ 组件不得硬编码） */
export const OWNER_LABEL = Object.freeze({
  [OWNER.HEADER]: '页头',
  [OWNER.PRIMARY_DECISION]: '正式决策',
  [OWNER.POSITION_RISK]: '仓位与风险',
  [OWNER.DEFENSE_RADAR]: '防守雷达',
  [OWNER.OPPORTUNITY_RADAR]: '机会 / 辅助信号',
  [OWNER.INTELLIGENCE]: '情报 / 基本面',
  [OWNER.DECISION_HISTORY]: '历史决策变化',
  [OWNER.KLINE]: 'K 线'
});

/** 引用位统一标记词（⛔ 不是"归档""副本"等其它说法） */
export const REFERENCE_MARKER = '引用';

/* ══════════════════ ② 事实 ID ══════════════════ */

/**
 * ⚠️ 命名规则：事实 ID **必须 camelCase**，⛔ 不得使用后端 snake_case 字段名。
 *    原因：`tests/rewrite/etf-detail-render.test.js` 有一条**真守卫** ——
 *    「渲染结果 ⛔ 不得泄露后端原始字段名」（禁止 `final_target` / `position_gap` /
 *    `core_position` / `over_alloc_status` / `gen1_authority` / `ml_shadow` / `f_state` 等）。
 *    本模块的 ID 会进入 `data-fact` 属性（即进入 HTML）⇒ 若用 snake_case 会**误触**该守卫。
 *    ⇒ 结论：用前端领域词汇（camelCase），⛔ 不为通过断言而削弱守卫。
 */
export const FACT = Object.freeze({
  /* — 正式决策族（V3 Safety Core） — */
  ACTION: 'action',
  FINAL_TARGET: 'finalTarget',
  TARGET_BAND: 'targetBand',
  CHAIN: 'explainChain',
  SCORES: 'scores',

  /* — 仓位族 — */
  POSITION_GAP: 'positionGap',
  ACTUAL_POSITION: 'actualPosition',
  SUGGESTED_POSITION: 'suggestedPosition',
  MAX_POSITION: 'maxPosition',
  CONFIG_TARGET: 'configTarget',

  /* — 风险族 — */
  RISK_FLAG: 'riskFlag',
  PREMIUM_FLAG: 'premiumFlag',
  PREMIUM_RATE: 'premiumRate',
  OVER_ALLOC: 'overAllocStatus',
  RISK_EVENTS: 'riskEvents',
  DEFENSE_STATE: 'defenseState',

  /* — 机会族 — */
  OPPORTUNITY_SCORE: 'opportunityScore',
  OPPORTUNITY_GRADE: 'opportunityGrade',
  ADD_ELIGIBILITY: 'addEligibility',
  NEXT_ADD_CONDITION: 'nextAddCondition',
  COOLDOWN: 'cooldownDays',

  /* — 证据 / 环境族 — */
  FUNDAMENTAL_SUMMARY: 'fundamentalSummary',
  MARKET_REGIME: 'marketRegime',
  KLINE_LAST_DATE: 'klineLastDate',

  /* — 历史族 — */
  HISTORY: 'decisionHistory'
});

/* ══════════════════ ③ 注册表本体 ══════════════════ */

/**
 * @typedef {object} FactRule
 * @property {string}   owner    唯一主位（`OWNER.*`）
 * @property {string[]} refs     允许的引用位（`OWNER.*`，可为空数组）
 * @property {string}   rule     展示规则（人类可读，供文档与测试复核）
 * @property {string[]} forbid   该事实**绝不允许**出现的表达（测试据此做反向断言）
 * @property {boolean}  governance 是否属「治理敏感」（M5-P1 明确点名的事实）
 */

/** @type {Readonly<Record<string, FactRule>>} */
export const FACT_OWNERSHIP = Object.freeze({
  /* ══════════ 正式决策 ══════════ */
  [FACT.ACTION]: Object.freeze({
    owner: OWNER.PRIMARY_DECISION,
    refs: Object.freeze([]),
    rule: '全页唯一：动作只能由「正式决策」给出，⛔ 其它区块不得复述动作结论',
    forbid: Object.freeze([]),
    governance: true
  }),
  [FACT.FINAL_TARGET]: Object.freeze({
    owner: OWNER.PRIMARY_DECISION,
    refs: Object.freeze([OWNER.POSITION_RISK]),
    rule: '主位「正式决策」；「仓位与风险」可作引用位（同源同值 + 「引用」标记），⛔ 不得改写成"建议买入到 X"',
    forbid: Object.freeze([]),
    governance: true
  }),
  [FACT.TARGET_BAND]: Object.freeze({
    owner: OWNER.POSITION_RISK,
    refs: Object.freeze([OWNER.PRIMARY_DECISION]),
    rule: '主位在「仓位与风险」（目标带属仓位轴）；「正式决策」只可引用区间文字',
    forbid: Object.freeze([]),
    governance: true
  }),
  [FACT.CHAIN]: Object.freeze({
    owner: OWNER.PRIMARY_DECISION,
    refs: Object.freeze([]),
    rule: '决策链只在「正式决策」区；⛔ 其它区块不得复述链上条件',
    forbid: Object.freeze([]),
    governance: false
  }),
  [FACT.SCORES]: Object.freeze({
    owner: OWNER.PRIMARY_DECISION,
    refs: Object.freeze([]),
    rule: '五维评分只在「正式决策」区',
    forbid: Object.freeze([]),
    governance: false
  }),

  /* ══════════ 仓位 ══════════ */
  [FACT.POSITION_GAP]: Object.freeze({
    owner: OWNER.POSITION_RISK,
    refs: Object.freeze([OWNER.PRIMARY_DECISION, OWNER.OPPORTUNITY_RADAR]),
    rule: '主位「仓位与风险」；引用位的数值必须与主位同源，⛔ 不得重新计算、⛔ 不得据此推导下一步动作',
    forbid: Object.freeze(['应该加仓', '建议加仓', '可以加仓', '应当加仓']),
    governance: true
  }),
  [FACT.ACTUAL_POSITION]: Object.freeze({
    owner: OWNER.POSITION_RISK,
    refs: Object.freeze([]),
    rule: '★ M5-P2 §六(2)：**实际持仓**（position 块，账户真实仓位）只在「仓位与风险」区，'
      + '⛔ 与「建议仓位」（decision 块）⛔ 不同轴 ⇒ 不得合并、不得互相替代、不得在页头复述',
    forbid: Object.freeze([]),
    governance: true
  }),
  [FACT.SUGGESTED_POSITION]: Object.freeze({
    owner: OWNER.POSITION_RISK,
    refs: Object.freeze([]),
    rule: '建议仓位只在「仓位与风险」区（⛔ 与 final_target 分轴，不得合并）',
    forbid: Object.freeze([]),
    governance: true
  }),
  [FACT.MAX_POSITION]: Object.freeze({
    owner: OWNER.POSITION_RISK,
    refs: Object.freeze([]),
    rule: '仓位上限只在「仓位与风险」区（⛔ 页头不得重复，会与"配置上限"混淆）',
    forbid: Object.freeze([]),
    governance: false
  }),
  [FACT.CONFIG_TARGET]: Object.freeze({
    owner: OWNER.POSITION_RISK,
    refs: Object.freeze([]),
    rule: '配置标准目标只在「仓位与风险」区（属配置带，⛔ 不是本次决策结果）',
    forbid: Object.freeze([]),
    governance: false
  }),

  /* ══════════ 风险 ══════════ */
  [FACT.RISK_FLAG]: Object.freeze({
    owner: OWNER.PRIMARY_DECISION,
    refs: Object.freeze([OWNER.POSITION_RISK, OWNER.DEFENSE_RADAR]),
    rule: '主位「正式决策」（正式风险权威）；「仓位与风险」「防守雷达」只可作引用位，⛔ 不得再次形成独立风险结论',
    forbid: Object.freeze([]),
    governance: true
  }),
  [FACT.PREMIUM_FLAG]: Object.freeze({
    owner: OWNER.DEFENSE_RADAR,
    refs: Object.freeze([]),
    rule: '溢价状态属风险明细 ⇒ 主位在「防守雷达」；⛔ 页头/仓位区不重复渲染',
    forbid: Object.freeze([]),
    governance: true
  }),
  [FACT.PREMIUM_RATE]: Object.freeze({
    owner: OWNER.DEFENSE_RADAR,
    refs: Object.freeze([]),
    rule: '溢价率属风险明细 ⇒ 主位在「防守雷达」；⛔ 不重复渲染、⛔ 不改口径',
    forbid: Object.freeze([]),
    governance: true
  }),
  [FACT.OVER_ALLOC]: Object.freeze({
    owner: OWNER.DEFENSE_RADAR,
    refs: Object.freeze([]),
    rule: '主位「防守雷达」（超配属防守语义）；⛔ 不得两处都当作独立风险结论',
    forbid: Object.freeze([]),
    governance: true
  }),
  [FACT.RISK_EVENTS]: Object.freeze({
    owner: OWNER.INTELLIGENCE,
    refs: Object.freeze([OWNER.DEFENSE_RADAR]),
    rule: '主位「情报 / 基本面」（证据），完整清单只在此渲染；「防守雷达」只给条数引用，⛔ 不得三处各自解释同一批事件',
    forbid: Object.freeze(['没有风险']),
    governance: true
  }),
  [FACT.DEFENSE_STATE]: Object.freeze({
    owner: OWNER.DEFENSE_RADAR,
    refs: Object.freeze([]),
    rule: '防守 level / score / factor 只在「防守雷达」区，⛔ 前端不重算、⛔ 不升格为卖出信号',
    forbid: Object.freeze(['应该卖出', '建议卖出', '清仓信号']),
    governance: true
  }),

  /* ══════════ 机会 ══════════ */
  [FACT.OPPORTUNITY_SCORE]: Object.freeze({
    owner: OWNER.OPPORTUNITY_RADAR,
    refs: Object.freeze([]),
    rule: '机会分只在「机会 / 辅助信号」区，⛔ 不得升格为买入/交易信号',
    forbid: Object.freeze(['买入信号', '交易信号', '应该买']),
    governance: true
  }),
  [FACT.OPPORTUNITY_GRADE]: Object.freeze({
    owner: OWNER.OPPORTUNITY_RADAR,
    refs: Object.freeze([]),
    rule: '机会等级只在「机会 / 辅助信号」区，⛔ 不得出现在「正式决策」区',
    forbid: Object.freeze(['买入信号', '交易信号', '应该买']),
    governance: true
  }),
  [FACT.ADD_ELIGIBILITY]: Object.freeze({
    owner: OWNER.OPPORTUNITY_RADAR,
    refs: Object.freeze([]),
    rule: '加仓资格 10 项判据只在「机会 / 辅助信号」区；逐项为后端判定，⛔ 不合并成单一结论',
    forbid: Object.freeze([]),
    governance: true
  }),
  [FACT.NEXT_ADD_CONDITION]: Object.freeze({
    owner: OWNER.OPPORTUNITY_RADAR,
    refs: Object.freeze([]),
    rule: '下一加仓条件只在「机会 / 辅助信号」区；文案为后端原文，⛔ 但含冲突缺口数字的片段必须移除（M5-P1 第六阶段）',
    forbid: Object.freeze([]),
    governance: true
  }),
  [FACT.COOLDOWN]: Object.freeze({
    owner: OWNER.OPPORTUNITY_RADAR,
    refs: Object.freeze([]),
    rule: '加仓冷静期只在「机会 / 辅助信号」区',
    forbid: Object.freeze([]),
    governance: true
  }),

  /* ══════════ 证据 / 环境 ══════════ */
  [FACT.FUNDAMENTAL_SUMMARY]: Object.freeze({
    owner: OWNER.INTELLIGENCE,
    refs: Object.freeze([]),
    rule: '基本面状态 / 评分 / 更新时间只在「情报 / 基本面」区，⛔ 不得再有第二处摘要段',
    forbid: Object.freeze([]),
    governance: true
  }),
  [FACT.MARKET_REGIME]: Object.freeze({
    owner: OWNER.HEADER,
    refs: Object.freeze([]),
    rule: '组合环境只在页头（只读引用 /api/dashboard#overview.market_regime）；无契约 ⇒ NOT_PROVIDED，⛔ 不由标的字段推导',
    forbid: Object.freeze([]),
    governance: true
  }),
  [FACT.KLINE_LAST_DATE]: Object.freeze({
    owner: OWNER.KLINE,
    refs: Object.freeze([OWNER.HEADER]),
    rule: 'K 线主位在「K 线」区；页头只作新鲜度引用（日期 + 状态），⛔ 不得渲染第二张图',
    forbid: Object.freeze([]),
    governance: false
  }),

  /* ══════════ 历史 ══════════ */
  [FACT.HISTORY]: Object.freeze({
    owner: OWNER.DECISION_HISTORY,
    refs: Object.freeze([]),
    rule: '工作台只给「与当前判断直接相关的最近变化」；完整历史审阅属「复盘」页，⛔ 不得复制完整历史能力',
    forbid: Object.freeze(['预测', '即将', '将会']),
    governance: true
  })
});

/* ══════════════════ ④ 纯函数出口 ══════════════════ */

/** 全部事实 ID（顺序稳定，供测试遍历） */
export const ALL_FACTS = Object.freeze(Object.keys(FACT_OWNERSHIP));

/** 某事实的主位区块 */
export function ownerOf(fact) {
  const r = FACT_OWNERSHIP[fact];
  return r ? r.owner : null;
}

/** 区块中文名（引用位文案用；未知 ⇒ 原样返回） */
export function ownerLabel(ownerKey) {
  return OWNER_LABEL[ownerKey] || String(ownerKey || '');
}

/** 引用位文案：`见「正式决策」`（⛔ 组件不得自行拼这个词） */
export function refText(ownerKey) {
  return '见「' + ownerLabel(ownerKey) + '」';
}

/** 某事实的展示规则（供文档/测试复核） */
export function ruleOf(fact) {
  const r = FACT_OWNERSHIP[fact];
  return r ? r.rule : null;
}

/** 某事实是否允许在某区块出现（主位或引用位）；⛔ 不在表内的组合即违规 */
export function isAllowedAt(fact, ownerKey) {
  const r = FACT_OWNERSHIP[fact];
  if (!r) return false;
  return r.owner === ownerKey || r.refs.includes(ownerKey);
}

/** 某区块承载的事实 ID 列表 */
export function factsOf(ownerKey) {
  return ALL_FACTS.filter((f) => FACT_OWNERSHIP[f].owner === ownerKey);
}

/** 全部「绝对不得出现」的表达（测试反向断言用，去重后稳定排序） */
export function forbiddenPhrases() {
  const set = new Set();
  for (const f of ALL_FACTS) for (const x of FACT_OWNERSHIP[f].forbid) set.add(x);
  return Object.freeze([...set]);
}

/** M5-P1 明确点名治理的事实（报告与测试优先覆盖） */
export const GOVERNANCE_FACTS = Object.freeze(ALL_FACTS.filter((f) => FACT_OWNERSHIP[f].governance));
