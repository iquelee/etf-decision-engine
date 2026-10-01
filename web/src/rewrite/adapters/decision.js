/**
 * decision 适配器（web/src/rewrite/adapters/decision.js）
 * 规范依据：SPEC §2 / §6 / §9 / 附录 A
 *
 * 职责单一：把 `decision_result` 原始文档 → 决策领域对象（全 Field<T>）。
 *
 * ⛔ 不做的事：
 *   · 不重算 `position_gap`（SPEC 附录 A.5：服务端已算，语义是 max(0, final_target − suggested)）
 *   · 不改写 action / risk 语义（只做大小写与别名归一，归一在 display 层）
 *   · 不做阈值判断（在 domain/thresholds.js）
 *
 * ★ 单位（SPEC 附录 A）：`final_target` / `target_*` / `*_position` = **仓位百分比**；
 *   `stage_factor` / `market_factor` = **系数 0~1**（⛔ 不是百分比）。
 */
import { readField, readBlock, provided, missing, unavailable, pickCanonicalThenLegacy, provenance, hasValue } from '../domain/provenance.js';
import { FIELD_STATE, MISSING_REASON, AUTHORITY, CHAIN_MODE } from '../domain/enums.js';
import { normalizeAction, overAllocLabel, riskLabel, stateLabel, CHAIN_MODE_NOTE } from '../domain/labels.js';
import { qualitativeStep } from '../domain/chain.js';
import { ELIGIBILITY_ITEMS, opportunityLevel } from '../domain/thresholds.js';

const SRC = 'api:/api/etf/:code#decision';

function prov(field) {
  return provenance({ source: SRC + '.' + field, authority: AUTHORITY.SAFETY_CORE });
}

/**
 * @param {object|null} decision `decision_result` 原始文档（可能 null）
 * @returns {object} 决策领域对象
 */
export function adaptDecision(decision) {
  if (!decision || typeof decision !== 'object') {
    /**
     * ★★ 返回**与正常分支同形状的完整骨架**（全 unavailable）。
     *   教训（M4-P1b 实测）：早前这里只返回 3 个键（available/reason/action），
     *   下游（如 `adaptDefense`）读 `decisionVm.riskFlag` 直接 `TypeError`
     *   ⇒ 页面整页崩。⛔ **不要靠下游一个个加防御**，骨架必须在这里补齐。
     */
    const u = (f) => unavailable(MISSING_REASON.CONTRACT_NOT_PROVIDED, prov(f));
    const empty = {};
    return Object.freeze({
      available: false,
      reason: MISSING_REASON.CONTRACT_NOT_PROVIDED,

      code: u('code'),
      decisionDate: u('decision_date'),

      action: u('final_action'),
      actionLabel: u('action_label'),

      riskFlag: u('risk_flag'),
      riskOverride: u('risk_override'),
      premiumFlag: u('premium_flag'),
      states: Object.freeze({
        w: u('w_state'), d: u('d_state'), h: u('h_state'),
        v: u('v_state'), f: u('f_state'), c: u('c_state')
      }),

      finalTarget: u('final_target'),
      targetBand: Object.freeze({ min: u('target_min'), std: u('target_std'), max: u('target_max') }),
      maxPosition: u('max_position'),
      suggestedPosition: u('suggested_position'),
      positionGap: u('position_gap'),
      corePosition: u('core_position'),
      tradePosition: u('trade_position'),
      overAllocStatus: u('over_alloc_status'),
      targetDelta: u('target_delta'),

      addEligibility: adaptEligibility(empty),
      cooldownDays: u('cooldown_days'),
      nextAddCondition: u('next_add_condition'),

      scores: adaptScores(empty),
      opportunity: Object.freeze({
        grade: u('opportunity_grade'),
        score: u('opportunity_score'),
        level: opportunityLevel(null, null)
      }),
      opportunityFactor: u('opportunity_factor'),
      addMode: u('add_mode'),
      aggressiveDivergence: u('aggressive_divergence'),

      explainChain: missing(MISSING_REASON.CONTRACT_NOT_PROVIDED, prov('explain_chain')),
      chain: adaptChainQualitative(empty),

      defense: adaptDefenseRaw(null),

      factors: Object.freeze({ stage: u('stage_factor'), market: u('market_factor') }),
      audit: Object.freeze({
        engineVersion: u('engine_version'), configVersion: u('config_version'),
        decisionTimestamp: u('decision_timestamp'), enginePath: u('engine_path'),
        effectiveMarketRegime: u('effective_market_regime')
      })
    });
  }

  const actionF = readField(decision, 'final_action', prov('final_action'));
  const gradeF = readField(decision, 'opportunity_grade', prov('opportunity_grade'));
  const scoreF = readField(decision, 'opportunity_score', prov('opportunity_score'));

  return Object.freeze({
    available: true,

    /* ---- 标的与日期 ---- */
    code: readField(decision, 'code', prov('code')),
    decisionDate: readField(decision, 'decision_date', prov('decision_date')),

    /* ---- 动作（唯一权威字段 = final_action）---- */
    action: hasValue(actionF)
      ? provided(normalizeAction(actionF.value) || actionF.value, actionF.provenance)
      : actionF,
    actionLabel: readField(decision, 'action_label', prov('action_label')),

    /* ---- 风险与状态码 ---- */
    riskFlag: readField(decision, 'risk_flag', prov('risk_flag')),
    riskOverride: readField(decision, 'risk_override', prov('risk_override')),
    premiumFlag: readField(decision, 'premium_flag', prov('premium_flag')),
    states: Object.freeze({
      w: readField(decision, 'w_state', prov('w_state')),
      d: readField(decision, 'd_state', prov('d_state')),
      h: readField(decision, 'h_state', prov('h_state')),
      v: readField(decision, 'v_state', prov('v_state')),
      f: readField(decision, 'f_state', prov('f_state')),
      c: readField(decision, 'c_state', prov('c_state'))
    }),

    /* ---- 目标与仓位（单位：仓位百分比）---- */
    finalTarget: readField(decision, 'final_target', prov('final_target')),
    targetBand: Object.freeze({
      min: readField(decision, 'target_min', prov('target_min')),
      std: readField(decision, 'target_std', prov('target_std')),
      max: readField(decision, 'target_max', prov('target_max'))
    }),
    maxPosition: readField(decision, 'max_position', prov('max_position')),
    suggestedPosition: readField(decision, 'suggested_position', prov('suggested_position')),
    /** ⚠️ 服务端已算（max(0, final_target − suggested)）⇒ ⛔ 前端不得重算 */
    positionGap: readField(decision, 'position_gap', prov('position_gap')),
    corePosition: readField(decision, 'core_position', prov('core_position')),
    tradePosition: readField(decision, 'trade_position', prov('trade_position')),
    overAllocStatus: readField(decision, 'over_alloc_status', prov('over_alloc_status')),
    targetDelta: readField(decision, 'target_delta', prov('target_delta')),

    /* ---- 加仓资格（★ 10 项，含旧前端遗漏的 cooldown / regime）---- */
    addEligibility: adaptEligibility(decision),
    cooldownDays: readField(decision, 'cooldown_days', prov('cooldown_days')),
    nextAddCondition: readField(decision, 'next_add_condition', prov('next_add_condition')),

    /* ---- 评分（点数，⛔ 非百分比）---- */
    scores: adaptScores(decision),
    opportunity: Object.freeze({
      grade: gradeF,
      score: scoreF,
      level: opportunityLevel(hasValue(gradeF) ? gradeF.value : null, hasValue(scoreF) ? scoreF.value : null)
    }),
    /** ★ 机会系数（schema desc: '机会系数'）—— **系数**，⛔ 不是百分比 */
    opportunityFactor: readField(decision, 'opportunity_factor', prov('opportunity_factor')),
    /** ★ 加仓模式（schema desc: '横盘加仓/突破加仓/无'） */
    addMode: readField(decision, 'add_mode', prov('add_mode')),
    /** 主动分歧标记（布尔） */
    aggressiveDivergence: readField(decision, 'aggressive_divergence', prov('aggressive_divergence')),

    /* ---- 决策链 ----
     * `explainChain` = 原始三元组（保留契约完整性；⛔ 页面不得直接渲染其数字）
     * `chain`        = ★ M4-D3 定性版（页面**唯一**可消费的形态，定量一律不出）
     */
    explainChain: adaptChain(decision),
    chain: adaptChainQualitative(decision),

    /* ---- 防守（★ 全部为后端已算结果；⛔ 前端不得重算 defense_level / defense_penalty）---- */
    defense: adaptDefenseRaw(decision),

    /* ---- 系数（0~1，⛔ 非百分比）---- */
    factors: Object.freeze({
      stage: readField(decision, 'stage_factor', prov('stage_factor')),
      market: readField(decision, 'market_factor', prov('market_factor'))
    }),

    /* ---- 审计元数据 ---- */
    audit: Object.freeze({
      engineVersion: readField(decision, 'engine_version', prov('engine_version')),
      configVersion: readField(decision, 'config_version', prov('config_version')),
      decisionTimestamp: readField(decision, 'decision_timestamp', prov('decision_timestamp')),
      enginePath: readField(decision, 'engine_path', prov('engine_path')),
      effectiveMarketRegime: readField(decision, 'effective_market_regime', prov('effective_market_regime'))
    })
  });
}

/**
 * 防守族（★ M4-P1b）。
 *
 * ⚠️ 实测形状（`/api/etf/:code#decision`，2026-09-29）：
 *   `defense_state = { level: 1, reason: '趋势破坏', score: 37, factor: 0.95 }`
 *   `defense_score  = 37`     ← **顶层冗余**（与 state.score 同源，均来自 defenseResult）
 *   `defense_penalty = 0.95`  ← **顶层冗余**（与 state.factor 同源）
 *
 * ★ 量纲（源码可证，⛔ 不得猜）：
 *   · `score`  = **分数 0~100**（`computeDefenseScore` 加权求和 + `Math.min(100, …)`）
 *   · `factor` = **乘性系数**（`DEFENSE_PENALTY_BANDS`：0-20→1.00 / 21-40→0.95 / 41-60→0.85
 *                / 61-80→0.70 / 81-100→0.50）⇒ 实测 0.95 ⇔ score ∈ [21,40]，与 37 自洽
 *   · `level`  = **数字 0~4**（`defenseLevelFromScore`），⛔ 不是「高/中/低」中文
 *
 * ⚠️ `level === 0` 时线上**没有** `score` / `factor` 键（且顶层两个也缺失）
 *    ⇒ 必须走 MISSING，⛔ 不得补 0、⛔ 不得显示 1.00。
 *
 * ⛔ 本函数只做「读」，不做任何重算（用户 M4-P1b §四：禁止前端 defenseLevel heuristic）。
 */
function adaptDefenseRaw(decision) {
  const P0 = prov('defense_state');
  const ds = decision && decision.defense_state;
  const topScore = readField(decision, 'defense_score', prov('defense_score'));
  const topPenalty = readField(decision, 'defense_penalty', prov('defense_penalty'));

  if (!ds || typeof ds !== 'object') {
    const u = (f) => unavailable(MISSING_REASON.FIELD_ABSENT, prov(f));
    return Object.freeze({
      available: false,
      level: u('defense_state.level'), reason: u('defense_state.reason'),
      score: u('defense_state.score'), factor: u('defense_state.factor'),
      topScore, topPenalty
    });
  }
  return Object.freeze({
    available: true,
    level: readField(ds, 'level', P0),
    reason: readField(ds, 'reason', P0),
    score: readField(ds, 'score', P0),
    factor: readField(ds, 'factor', P0),
    /** 顶层冗余字段（⛔ 只用于交叉核对，不替代 state 内的值） */
    topScore, topPenalty
  });
}

/** 加仓资格：按 canonical 10 项逐一取；`overall` 单独取 */function adaptEligibility(decision) {
  const block = decision.add_eligibility;
  const prov0 = provenance({ source: SRC + '.add_eligibility', authority: AUTHORITY.SAFETY_CORE });
  if (!block || typeof block !== 'object') {
    return Object.freeze({
      available: false,
      items: ELIGIBILITY_ITEMS.map((it) => ({ ...it, field: unavailable(MISSING_REASON.CONTRACT_NOT_PROVIDED, prov0) })),
      overall: unavailable(MISSING_REASON.CONTRACT_NOT_PROVIDED, prov0)
    });
  }
  return Object.freeze({
    available: true,
    items: ELIGIBILITY_ITEMS.map((it) => ({
      ...it,
      field: readField(block, it.key, provenance({ source: SRC + '.add_eligibility.' + it.key, authority: AUTHORITY.SAFETY_CORE }))
    })),
    overall: readField(block, 'overall', provenance({ source: SRC + '.add_eligibility.overall', authority: AUTHORITY.SAFETY_CORE }))
  });
}

/** 五维评分（点数）。⛔ 有意不导出 `total`（旧实现「禁显总分」）。 */
function adaptScores(decision) {
  const s = decision.scores;
  const prov0 = provenance({ source: SRC + '.scores', authority: AUTHORITY.SAFETY_CORE });
  if (!s || typeof s !== 'object') {
    return Object.freeze({
      trend: unavailable(MISSING_REASON.CONTRACT_NOT_PROVIDED, prov0),
      volume: unavailable(MISSING_REASON.CONTRACT_NOT_PROVIDED, prov0),
      fundamental: unavailable(MISSING_REASON.CONTRACT_NOT_PROVIDED, prov0),
      crowding: unavailable(MISSING_REASON.CONTRACT_NOT_PROVIDED, prov0),
      risk: unavailable(MISSING_REASON.CONTRACT_NOT_PROVIDED, prov0)
    });
  }
  return Object.freeze({
    trend: readField(s, 'trend', prov0),
    volume: readField(s, 'volume', prov0),
    fundamental: readField(s, 'fundamental', prov0),
    crowding: readField(s, 'crowding', prov0),
    risk: readField(s, 'risk', prov0)
  });
}

/** 决策链：`[{step, condition, result}]`，⛔ 不改写文案（洗数在 display 层） */
function adaptChain(decision) {
  const c = decision.explain_chain;
  const prov0 = provenance({ source: SRC + '.explain_chain', authority: AUTHORITY.SAFETY_CORE });
  if (!Array.isArray(c)) return missing(MISSING_REASON.FIELD_ABSENT, prov0);
  const steps = c
    .filter((x) => x && typeof x === 'object')
    .map((x) => Object.freeze({
      step: readField(x, 'step', prov0),
      condition: readField(x, 'condition', prov0),
      result: readField(x, 'result', prov0)
    }));
  return provided(steps, prov0);
}

/**
 * ★ M4-D3：决策链的**定性版**（页面唯一可消费形态）。
 *
 * ⛔ 明文禁止（owner 裁定原文）：把未经统一口径的数字链重新包装成"解释"。
 *     特别是不得出现「目标 21% / 仓位缺口 -7.8% / 实际目标 30%」这种并列结构。
 * ⇒ 本函数对 `condition` 遮蔽全部数字，对含数字的 `result` 整条不展示。
 *
 * @param {object} decision 原始 decision 文档
 */
function adaptChainQualitative(decision) {
  const raw = adaptChain(decision);
  if (raw.state !== FIELD_STATE.PROVIDED) {
    return Object.freeze({
      mode: CHAIN_MODE.QUALITATIVE_ONLY,
      available: false,
      state: raw.state,
      missingReason: raw.missingReason || null,
      steps: Object.freeze([]),
      total: 0,
      hiddenCount: 0,
      note: CHAIN_MODE_NOTE
    });
  }
  const steps = raw.value.map(qualitativeStep);
  return Object.freeze({
    mode: CHAIN_MODE.QUALITATIVE_ONLY,
    available: true,
    state: FIELD_STATE.PROVIDED,
    steps: Object.freeze(steps),
    total: steps.length,
    /** 含定量而被处理的步数（供 UI 显示"共 N 步，其中 M 步含定量"） */
    hiddenCount: steps.filter((s) => s.quantHidden).length,
    note: CHAIN_MODE_NOTE
  });
}

/* ------------------------------------------------------------------ */
/* 显示层便捷函数（⛔ 只做「Field → 文案」，不做业务判断）            */
/* ------------------------------------------------------------------ */

export function displayRisk(decisionVm) {
  return hasValue(decisionVm.riskFlag) ? riskLabel(decisionVm.riskFlag.value) : '—';
}

export function displayOverAlloc(decisionVm) {
  // ⚠️ 修正旧前端拼写错误：over_all_status → over_alloc_status（审计 §3.6 #8）
  return hasValue(decisionVm.overAllocStatus) ? overAllocLabel(decisionVm.overAllocStatus.value) : '—';
}

export function displayState(decisionVm, kind) {
  const f = decisionVm.states && decisionVm.states[kind];
  return hasValue(f) ? stateLabel(f.value) : '—';
}

export { FIELD_STATE, pickCanonicalThenLegacy, readBlock };
