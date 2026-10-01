/**
 * 防守雷达适配器（web/src/rewrite/adapters/defense.js）
 * 规范依据：owner M4-P1b §四 / §九 ＋ M2 附录 A
 *
 * ★★ 本模块的**唯一职责**：把后端**已经算好**的防守结果翻译成展示对象。
 *
 * ⛔ 明文禁止（用户 M4-P1b §四 / §九.1）：
 *   · ⛔ 不得重算 `defense_score` / `defense_level` / `defense_penalty`；
 *   · ⛔ 不得实现任何 `defenseLevel` heuristic（旧前端按 W 态与放量字段自行分档，已移除）。
 *
 * ★ 量纲纪律（用户反复强调：score / factor / percentage / level 不得混用）：
 *   · `score`  = 分数 0~100      ⇒ `scoreText`（⛔ 不加 %）
 *   · `factor` = 乘性系数 0.50~1.00 ⇒ `factorText`（⛔ 不是百分比）
 *   · `level`  = 数字 0~4        ⇒ `levelLabel`（中文由 labels 映射，⛔ 不自行分档）
 *
 * ⚠️ 冗余字段的诚实处理：
 *   `defense_score` / `defense_penalty` 是**顶层字段**，与 `defense_state.score / .factor` 同源
 *   （实测均相等：37 / 0.95）。本模块**只展示 state 内的值**，并对顶层值做**一致性核对**；
 *   若不一致 ⇒ 登记（⛔ 不静默选边、⛔ 不用顶层值覆盖 state）。
 */
import { readField, unavailable, provenance, hasValue } from '../domain/provenance.js';
import { FIELD_STATE, MISSING_REASON, AUTHORITY } from '../domain/enums.js';
import { scoreText, ratioText, rawText, disp, pctText } from '../domain/display.js';
import {
  defenseLevelLabel, toneForDefenseLevel, riskLabel, toneForRisk, overAllocLabel,
  normalizeRisk, fieldStateText, DEFENSE_SCORE_NOTE, DEFENSE_PENALTY_NOTE, DEFENSE_READONLY_NOTE,
  DEFENSE_SCOPE_NOTE,
  RISK_EVENTS_EMPTY_TEXT, RISK_EVENTS_EMPTY_NOTE, riskEventStatusLabel
} from '../domain/labels.js';

const SRC = 'api:/api/etf/:code#decision';
const P = (f) => provenance({ source: SRC + '.' + f, authority: AUTHORITY.SAFETY_CORE });

/**
 * @param {object} decisionVm `adaptDecision()` 的输出（含 `defense` 原始 Field 组）
 * @param {object} riskEventsField `adaptRiskEvents()` 的输出（Field<array>）
 * @param {object|null} snapshot 原始 snapshot（用于 premium_rate）
 */
export function adaptDefense(decisionVm, riskEventsField, snapshot) {
  const d = (decisionVm && decisionVm.defense) || null;
  const avail = !!(d && d.available);

  const levelF = d ? d.level : unavailable(MISSING_REASON.CONTRACT_NOT_PROVIDED, P('defense_state.level'));
  const levelNum = hasValue(levelF) ? Number(levelF.value) : null;
  const scoreF = d ? d.score : unavailable(MISSING_REASON.CONTRACT_NOT_PROVIDED, P('defense_state.score'));
  const factorF = d ? d.factor : unavailable(MISSING_REASON.CONTRACT_NOT_PROVIDED, P('defense_state.factor'));
  const reasonF = d ? d.reason : unavailable(MISSING_REASON.CONTRACT_NOT_PROVIDED, P('defense_state.reason'));

  /* ---- 顶层冗余字段的一致性核对（⛔ 只核对，不覆盖） ---- */
  const topScore = d ? d.topScore : null;
  const topPenalty = d ? d.topPenalty : null;
  const scoreConsistent = !hasValue(scoreF) || !hasValue(topScore)
    ? null : Number(scoreF.value) === Number(topScore.value);
  const factorConsistent = !hasValue(factorF) || !hasValue(topPenalty)
    ? null : Number(factorF.value) === Number(topPenalty.value);
  const inconsistent = scoreConsistent === false || factorConsistent === false;

  /* ---- 风险事件（★ 空数组语义必须谨慎，用户 §六 / §九.4） ---- */
  const events = adaptEvents(riskEventsField);

  return Object.freeze({
    available: avail,
    /** 是否**有防守**（后端 level > 0）—— ⛔ 由后端决定，不由前端按 W 态判断 */
    active: levelNum !== null ? levelNum > 0 : null,

    level: levelF,
    levelNumber: levelNum,
    levelLabel: hasValue(levelF) ? defenseLevelLabel(levelF.value) : fieldStateText(levelF.state),
    levelTone: hasValue(levelF) ? toneForDefenseLevel(levelF.value) : 'muted',

    reason: reasonF,
    reasonText: hasValue(reasonF) ? String(reasonF.value) : fieldStateText(reasonF.state),

    /** ★ 分数 0~100（⛔ 不加 %） */
    score: scoreF,
    scoreText: scoreText(scoreF),
    scoreNote: DEFENSE_SCORE_NOTE,

    /** ★ 乘性系数 0.50~1.00（⛔ 不是百分比） */
    factor: factorF,
    factorText: ratioText(factorF, 2),
    factorNote: DEFENSE_PENALTY_NOTE,

    /** 顶层冗余字段核对结果（不一致时 UI 必须显示警示） */
    crossCheck: Object.freeze({
      topScore, topPenalty,
      scoreConsistent, factorConsistent, inconsistent,
      note: inconsistent
        ? '⚠️ 顶层 defense_score / defense_penalty 与 defense_state 内的值**不一致**；本页以 defense_state 为准并保留此警示（⛔ 不静默选边）。'
        : ''
    }),

    /* ---- 风险旗标（★ 中英混用 ⇒ 统一归一） ---- */
    riskFlag: decisionVm ? decisionVm.riskFlag : unavailable(MISSING_REASON.CONTRACT_NOT_PROVIDED, P('risk_flag')),
    riskLabel: decisionVm && hasValue(decisionVm.riskFlag)
      ? riskLabel(decisionVm.riskFlag.value) : fieldStateText(decisionVm ? decisionVm.riskFlag.state : FIELD_STATE.UNAVAILABLE),
    riskTone: decisionVm && hasValue(decisionVm.riskFlag) ? toneForRisk(decisionVm.riskFlag.value) : 'muted',
    riskOverride: decisionVm ? decisionVm.riskOverride : null,
    /** ★ display 形态（⛔ 组件不得自行拼 {text,missing}） */
    riskOverrideText: disp(
      decisionVm && decisionVm.riskOverride
        ? decisionVm.riskOverride
        : unavailable(MISSING_REASON.CONTRACT_NOT_PROVIDED, P('risk_override')),
      (v) => (v === true ? '是' : v === false ? '否' : String(v))
    ),

    overAlloc: decisionVm ? decisionVm.overAllocStatus : null,
    overAllocText: decisionVm && decisionVm.overAllocStatus && hasValue(decisionVm.overAllocStatus)
      ? overAllocLabel(decisionVm.overAllocStatus.value)
      : fieldStateText(decisionVm && decisionVm.overAllocStatus ? decisionVm.overAllocStatus.state : FIELD_STATE.UNAVAILABLE),

    premiumFlag: decisionVm ? decisionVm.premiumFlag : null,
    premiumText: (() => {
      const f = decisionVm && decisionVm.premiumFlag;
      if (!f) return '数据未提供';
      if (!hasValue(f)) return fieldStateText(f.state);
      const code = normalizeRisk(f.value);
      return code ? riskLabel(code) : String(f.value);
    })(),
    premiumRate: readField(snapshot, 'premium_rate', P('snapshot.premium_rate')),
    /** ★ display 形态（⛔ 组件不得自行拼 % 或判断缺失） */
    premiumRateText: pctText(readField(snapshot, 'premium_rate', P('snapshot.premium_rate'))),

    events,
    readonlyNote: DEFENSE_READONLY_NOTE,
    /** ★ M5-P1：本区边界自述（承载什么 / 只引用什么） */
    scopeNote: DEFENSE_SCOPE_NOTE
  });
}

/* ==================== 风险事件 ==================== */

function adaptEvents(field) {
  const state = field ? field.state : FIELD_STATE.UNAVAILABLE;
  const items = hasValue(field) ? field.value : [];
  const list = Array.isArray(items) ? items : [];
  const isEmpty = state === FIELD_STATE.PROVIDED && list.length === 0;

  return Object.freeze({
    state,
    missingReason: (field && field.missingReason) || null,
    available: state === FIELD_STATE.PROVIDED,
    items: Object.freeze(list.map((e) => Object.freeze({
      id: e.id,
      eventType: e.eventType,
      riskFlag: e.riskFlag,
      riskOverride: e.riskOverride,
      status: e.status,
      statusText: e.status && hasValue(e.status) ? riskEventStatusLabel(e.status.value) : '—',
      reason: e.reason,
      reasonText: e.reason && hasValue(e.reason) ? String(e.reason.value) : '（无原因）',
      note: e.note,
      triggerTime: e.triggerTime,
      triggerTimeText: e.triggerTime && hasValue(e.triggerTime) ? String(e.triggerTime.value) : '—'
    }))),
    count: list.length,
    /** ★ 空数组（合法）—— ⛔ 与「接口未提供」不是一回事 */
    isEmpty,
    /** ★★ 文案纪律：`[]` 只能说「没有返回事件数据」，⛔ 不得说「没有风险」 */
    emptyText: isEmpty ? RISK_EVENTS_EMPTY_TEXT : '',
    emptyNote: isEmpty ? RISK_EVENTS_EMPTY_NOTE : ''
  });
}

export { FIELD_STATE, disp, ratioText, rawText };
