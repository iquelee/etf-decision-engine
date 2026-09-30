/**
 * 历史决策变化适配器（web/src/rewrite/adapters/decisionHistory.js）
 * 规范依据：owner M4-P1b §七 / §九.5（★ 硬规则：不伪造历史）
 *
 * ★★ 硬规则（用户原文）：
 *   「有真实历史 API ⇒ 展示真实历史。没有历史 API ⇒ 展示『历史决策变化：数据未提供』。
 *     ⛔ **绝对不要**：当前 target + 当前 action + 当前日期 拼成一条"历史"。
 *     ⛔ 也不要根据当前字段猜测：『从持有 → 加仓 → 防守』。」
 *
 * ★ 数据源（已只读侦察确认，2026-09-30）：
 *   `GET /api/etf/:code/decisions` → `data` 为**数组**；
 *   后端实现 `getDecisions`：同一 `decision_result` 集合、`orderBy decision_date **desc**`、
 *   `limit = (from||to) ? 500 : 60`、支持 `?from=&to=` 区间。
 *
 * ★ 「变化」的定义（⛔ 不推断原因）：
 *   相邻两条**后端记录**的实测值差异（动作 / 目标 / 风险 / 防守等级）。
 *   ⛔ 本模块不生成任何"趋势解读"或"原因分析"。
 */
import { provenance } from '../domain/provenance.js';
import { FIELD_STATE, MISSING_REASON, AUTHORITY } from '../domain/enums.js';
import { pctText, scoreText, rawText } from '../domain/display.js';
import {
  actionLabel, toneForAction, riskLabel, toneForRisk, overAllocLabel,
  defenseLevelLabel, toneForDefenseLevel, fieldStateText,
  HISTORY_SOURCE_NOTE, HISTORY_EMPTY_TEXT, HISTORY_EMPTY_NOTE,
  HISTORY_UNAVAILABLE_TEXT, HISTORY_UNAVAILABLE_NOTE, HISTORY_CHANGE_KINDS, HISTORY_CHANGE_NOTE
} from '../domain/labels.js';
import { assess, describe } from '../domain/freshness.js';

const SRC = 'api:/api/etf/:code/decisions';
const P = provenance({ source: SRC, authority: AUTHORITY.SAFETY_CORE });

/** 与后端一致的上限（`getDecisions` 默认 60，带区间 500） */
export const HISTORY_DEFAULT_LIMIT = 60;

/**
 * @param {any} raw `data`（数组）· `undefined`（未请求）· `null`（请求失败）· 其它（畸形）
 * @param {{retrievedAt?:string}} [meta]
 */
export function adaptDecisionHistory(raw, meta = {}) {
  const base = {
    source: SRC,
    sourceNote: HISTORY_SOURCE_NOTE,
    changeNote: HISTORY_CHANGE_NOTE,
    changeKinds: HISTORY_CHANGE_KINDS,
    retrievedAt: (meta && meta.retrievedAt) || null
  };

  /* ---- ① 未请求 ⇒ UNAVAILABLE（可自愈：一旦请求即恢复） ---- */
  if (raw === undefined) {
    return Object.freeze({
      ...base,
      state: FIELD_STATE.UNAVAILABLE,
      available: false,
      reason: MISSING_REASON.CONTRACT_NOT_PROVIDED,
      count: 0, items: Object.freeze([]), changes: Object.freeze([]), changedCount: 0,
      text: HISTORY_UNAVAILABLE_TEXT,
      note: HISTORY_UNAVAILABLE_NOTE,
      freshness: null
    });
  }

  /* ---- ② 请求失败 ⇒ ERROR ---- */
  if (raw === null) {
    return Object.freeze({
      ...base,
      state: FIELD_STATE.ERROR,
      available: false,
      reason: MISSING_REASON.RUNTIME_STATUS_UNAVAILABLE,
      count: 0, items: Object.freeze([]), changes: Object.freeze([]), changedCount: 0,
      text: '历史决策读取失败。',
      note: '⛔ 读取失败与「无历史记录」不是同一状态，故文案不同；⛔ 本页不会用当前字段补一条假历史。',
      freshness: null
    });
  }

  /* ---- ③ 畸形（非数组）⇒ MISSING ---- */
  if (!Array.isArray(raw)) {
    return Object.freeze({
      ...base,
      state: FIELD_STATE.MISSING,
      available: false,
      reason: MISSING_REASON.FIELD_ABSENT,
      count: 0, items: Object.freeze([]), changes: Object.freeze([]), changedCount: 0,
      text: '历史决策字段缺失（后端返回结构异常）。',
      note: HISTORY_UNAVAILABLE_NOTE,
      freshness: null
    });
  }

  /* ---- ④ 合法空数组 ⇒ PROVIDED 但「无记录」（★ 与 UNAVAILABLE 文案不同） ---- */
  if (raw.length === 0) {
    return Object.freeze({
      ...base,
      state: FIELD_STATE.PROVIDED,
      available: true,
      reason: null,
      count: 0, items: Object.freeze([]), changes: Object.freeze([]), changedCount: 0,
      text: HISTORY_EMPTY_TEXT,
      note: HISTORY_EMPTY_NOTE,
      freshness: null
    });
  }

  /* ---- ⑤ 有真实历史 ---- */
  const items = raw
    .filter((x) => x && typeof x === 'object' && x.decision_date)
    .sort((a, b) => (a.decision_date < b.decision_date ? 1 : a.decision_date > b.decision_date ? -1 : 0))
    .map(adaptHistoryRow);

  const changes = detectChanges(items);

  return Object.freeze({
    ...base,
    state: FIELD_STATE.PROVIDED,
    available: true,
    reason: null,
    count: items.length,
    items: Object.freeze(items),
    changes: Object.freeze(changes),
    changedCount: changes.length,
    text: '',
    note: '',
    /** 历史首条自身的新鲜度（⛔ 与当前决策、K 线各自独立） */
    freshness: Object.freeze({ ...assess(items[0].date, 'decision'), text: describe(assess(items[0].date, 'decision')) }),
    oldestDate: items[items.length - 1].date,
    newestDate: items[0].date
  });
}

/* ==================== 单行 ==================== */

function adaptHistoryRow(x) {
  const date = String(x.decision_date);
  const actionRaw = x.final_action !== undefined && x.final_action !== null ? x.final_action : null;
  /** 后端已加中文标签（`withChineseActionLabel`）⇒ 优先用后端标签 */
  const labelFromBackend = x.action_label !== undefined && x.action_label !== null ? String(x.action_label) : null;

  const actionF = actionRaw !== null ? { state: FIELD_STATE.PROVIDED, value: actionRaw } : { state: FIELD_STATE.MISSING, value: null };
  const ftF = x.final_target !== undefined && x.final_target !== null ? { state: FIELD_STATE.PROVIDED, value: x.final_target } : { state: FIELD_STATE.MISSING, value: null };
  const gapF = x.position_gap !== undefined && x.position_gap !== null ? { state: FIELD_STATE.PROVIDED, value: x.position_gap } : { state: FIELD_STATE.MISSING, value: null };
  const riskF = x.risk_flag !== undefined && x.risk_flag !== null ? { state: FIELD_STATE.PROVIDED, value: x.risk_flag } : { state: FIELD_STATE.MISSING, value: null };
  const defenseLevelRaw = x.defense_state && typeof x.defense_state === 'object' ? x.defense_state.level : undefined;
  const defenseScoreRaw = x.defense_score;

  return Object.freeze({
    date,
    dateText: date,
    /** 动作（★ 后端中文标签优先） */
    action: actionRaw,
    actionText: labelFromBackend || (actionRaw !== null ? actionLabel(actionRaw) : fieldStateText(actionF.state)),
    actionTone: actionRaw !== null ? toneForAction(actionRaw) : 'muted',
    /** 目标（★ 仓位百分比） */
    finalTarget: ftF.value,
    finalTargetText: pctText(ftF),
    /** 缺口（★ 后端已算，⛔ 不重算） */
    gap: gapF.value,
    gapText: pctText(gapF, 1, true),
    /** 风险（★ 中英混用 ⇒ 归一） */
    riskFlag: riskF.value,
    riskText: riskF.value !== null ? riskLabel(riskF.value) : fieldStateText(riskF.state),
    riskTone: riskF.value !== null ? toneForRisk(riskF.value) : 'muted',
    /** 防守（★ level 为数字，score 为分数） */
    defenseLevel: defenseLevelRaw !== undefined && defenseLevelRaw !== null ? Number(defenseLevelRaw) : null,
    defenseLevelText: defenseLevelRaw !== undefined && defenseLevelRaw !== null ? defenseLevelLabel(defenseLevelRaw) : '数据未提供',
    defenseLevelTone: defenseLevelRaw !== undefined && defenseLevelRaw !== null ? toneForDefenseLevel(defenseLevelRaw) : 'muted',
    defenseScore: defenseScoreRaw !== undefined && defenseScoreRaw !== null ? Number(defenseScoreRaw) : null,
    defenseScoreText: scoreText(scoreText0(defenseScoreRaw)),
    overAllocText: x.over_alloc_status !== undefined && x.over_alloc_status !== null
      ? overAllocLabel(x.over_alloc_status) : '数据未提供'
  });
}

/** 把裸数字包成 `disp` 可消费的假 Field（仅用于格式化） */
function scoreText0(v) {
  return v === undefined || v === null
    ? { state: FIELD_STATE.MISSING, value: null }
    : { state: FIELD_STATE.PROVIDED, value: v };
}

/* ==================== 变化检测（⛔ 不推断原因） ==================== */

function detectChanges(items) {
  const out = [];
  for (let i = 0; i < items.length - 1; i++) {
    const cur = items[i];       // 较新
    const prev = items[i + 1];  // 较旧
    pushIfChanged(out, 'action', '动作', prev.date, cur.date, prev.actionText, cur.actionText);
    pushIfChanged(out, 'target', '目标', prev.date, cur.date, prev.finalTargetText.text, cur.finalTargetText.text);
    pushIfChanged(out, 'risk', '风险', prev.date, cur.date, prev.riskText, cur.riskText);
    pushIfChanged(out, 'defense', '防守', prev.date, cur.date, prev.defenseLevelText, cur.defenseLevelText);
  }
  return out;
}

function pushIfChanged(out, kind, label, fromDate, toDate, from, to) {
  if (from === to) return;
  out.push(Object.freeze({ kind, label, fromDate, toDate, date: toDate, from: String(from), to: String(to) }));
}

export { rawText };
