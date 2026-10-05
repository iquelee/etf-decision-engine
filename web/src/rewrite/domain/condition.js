/**
 * 条件文案去冲突定量（web/src/rewrite/domain/condition.js）
 * 规范依据：owner 裁定 M5-P1 第六阶段（D-M5-5，2026-10-01）
 *
 * ══════════════════════════════════════════════════════════════════════
 * ── 为什么需要这一层 ────────────────────────────────────────────────
 *   实测（513310 / 2026-09-29，同一 `decision` 块内）：
 *     · `position_gap = 0`                 ← 结构化字段（已 clamp：max(0, final_target − suggested)）
 *     · `final_target − suggested_position = −7.8`
 *     · `next_add_condition` 原文含「**Gap -8%**」 ← 引的是**未 clamp 的有符号差**
 *   ⇒ 用户在「正式决策」看到缺口 `0.0%`、在「机会」看到「Gap -8%」，会认为系统自相矛盾。
 *   这与 M4-D3 处理的 `explain_chain` 是**同一性质的冲突**（M4-D3 只覆盖了链，未覆盖本字段）。
 *   登记：**DS-006**（见 `docs/V365_FRONTEND_RISK_LEDGER.md`）。
 *
 * ── 本模块的规则（owner 明令，★ 刻意保持极简、可测）──────────────
 *   1. **只移除**与结构化字段冲突的「Gap 数字」片段，**保留其余定性文字为后端原文**；
 *   2. ⛔ **不换算**（不得把 `-8%` 改成别的数字、⛔ 不得乘除、⛔ 不得四舍五入）；
 *   3. ⛔ **不用 `position_gap` 生成新文案**（⛔ 不重算、⛔ 不替换成 `0.0%`）；
 *   4. ⛔ 不改写、不重排、不解释其余部分；
 *   5. 被移除的片段**保留在返回值里**（`removed`），供审计与测试断言 —— ⛔ 但 UI 不得渲染。
 *
 * ── 恢复路径 ────────────────────────────────────────────────────────
 *   后端统一「Gap」口径（字段与文案同源）后，删除本模块的调用即可恢复原文展示；
 *   原始文案始终由适配器保留在 `nextAddConditionRaw`（未丢失）。
 */

/** 与结构化字段冲突的片段形态：`Gap -8%` / `gap 8 %` / `GAP +7.8%` */
const GAP_QUANT = /Gap\s*[+\-−]?\s*\d+(?:\.\d+)?\s*(?:%|％)?/gi;

/** 括号对（中英文各一套） */
const BRACKET_PAIRS = [['（', '）'], ['(', ')']];

/** 占位符：替换掉冲突片段后暂存，便于按相邻分隔符规则清理 */
const HOLE = '\u0000';

/**
 * 清理占位符周边的标点，避免留下 `（）` / `，，` / 悬空逗号。
 * @param {string} s
 * @returns {string}
 */
function cleanup(s) {
  let out = s;
  // 「（<hole>，」⇒「（」；「<hole>，」⇒ 删除；「，<hole>」⇒ 删除
  for (const [open, close] of BRACKET_PAIRS) {
    const esc = (c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(esc(open) + '\\s*' + HOLE + '\\s*[，,、;；]?', 'g'), open);
    out = out.replace(new RegExp('[，,、;；]?\\s*' + HOLE + '\\s*' + esc(close), 'g'), close);
    // 空括号（含只剩分隔符）
    out = out.replace(new RegExp(esc(open) + '\\s*[，,、;；]?\\s*' + esc(close), 'g'), '');
  }
  out = out.replace(new RegExp('[，,、;；]?\\s*' + HOLE, 'g'), '');
  out = out.replace(new RegExp(HOLE, 'g'), '');
  out = out.replace(/[，,、;；]{2,}/g, '，');
  out = out.replace(/\s{2,}/g, ' ');
  out = out.replace(/^[，,、;；\s]+/, '');
  out = out.replace(/[，,、;；\s]+$/, '');
  return out.trim();
}

/**
 * 文案中是否含与结构化字段冲突的「Gap 定量」。
 * @param {string|null|undefined} text
 * @returns {boolean}
 */
export function hasConflictingGapQuant(text) {
  if (text === null || text === undefined) return false;
  GAP_QUANT.lastIndex = 0;
  return GAP_QUANT.test(String(text));
}

/**
 * 移除与结构化字段冲突的「Gap 定量」片段，其余文字**逐字保留**。
 * @param {string|null|undefined} text 后端原文（如 `next_add_condition`）
 * @returns {{ text: string, removed: string[], hadConflict: boolean }}
 *          `text` = 可渲染文案；`removed` = 被移除的片段（⛔ UI 不得渲染）
 */
export function sanitizeConditionText(text) {
  if (text === null || text === undefined || text === '') {
    return Object.freeze({ text: '', removed: Object.freeze([]), hadConflict: false });
  }
  const raw = String(text);
  const removed = [];
  const holed = raw.replace(GAP_QUANT, (m) => {
    removed.push(m);
    return HOLE;
  });
  const cleaned = cleanup(holed);
  return Object.freeze({
    text: cleaned,
    removed: Object.freeze(removed),
    hadConflict: removed.length > 0
  });
}
