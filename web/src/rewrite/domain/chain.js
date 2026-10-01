/**
 * 决策链定性化（web/src/rewrite/domain/chain.js）
 * 规范依据：owner 裁定 M4-D3（2026-09-30）＋ M4-P0 §F.7.2
 *
 * ── 为什么需要这一层 ────────────────────────────────────────────────
 *   实测线上 `explain_chain` 的文案数字与**同一份文档**的决策字段**互相矛盾**：
 *     · step 10 「仓位缺口 -7.8pct」            vs `decision.position_gap = 0`
 *     · step  9 「核心 12.6% · 交易 0%」        vs `decision.core_position = 0.2 / trade_position = 0.3`
 *     · step  8 「目标区间 [18~24]% 标准目标 21%」 vs `position.target_min/max = 20/30`
 *   ⇒ 该链是**另一条计算路径**的产物。若把链里数字与正式字段并列，用户会误以为同属一条计算链。
 *
 * ── 本模块的规则（★ 刻意保持极简、可测）────────────────────────────
 *   1. 保留 `condition` 的**定性文字**，把其中**所有数字**遮蔽为 `［数字已隐藏］`；
 *   2. `result` 若含数字 ⇒ **整条不展示**（标 `resultQuantHidden: true`），
 *      ⛔ 不做部分替换（避免"藏了一半"产生新的误读）；
 *   3. ⛔ 不改写、不重排、不解释后端文案的其它部分；
 *   4. ⛔ 不在此处做任何业务判断（不判断"哪个数字与哪个字段冲突"）——
 *      冲突判定已由 M4-P0 人工核实并写入文档，此处只需**一律不出定量**。
 *
 * ── 恢复路径 ────────────────────────────────────────────────────────
 *   后端统一 `explain_chain` 来源后，把 `CHAIN_MODE` 切回 `QUANTITATIVE` 即可恢复原样
 *   （原始 Field 三元组仍由 `adapters/decision.js#explainChain` 保留，未丢失）。
 */
import { CHAIN_QUANT_MASK, CHAIN_RESULT_QUANT_HIDDEN } from './labels.js';

/**
 * 不遮蔽「贴在字母/数字后的数字」——用于保护状态码（`S0`/`W4`/`H2`/`V1`/`F3`/`C4`/`D5`）。
 * ⚠️ 这些是**枚举码**不是定量，遮蔽它们会破坏语义（如「S1」→「S［数字已隐藏］」）。
 */
const NOT_ALNUM_BEFORE = '(?<![A-Za-z0-9])';
const NOT_ALNUM_AFTER = '(?![A-Za-z0-9%])';

/** 规则集（顺序敏感，见文件头说明） */
const RULES = [
  /** R1：方括号内的含数字范围，整体遮蔽（`[18~24]%` ⇒ `［数字已隐藏］`） */
  [/\[[^[\]]*\d[^[\]]*\]/g, CHAIN_QUANT_MASK],
  /** R2：带单位的定量（`8.3%` / `-7.8pct` / `50%~100%`） */
  [new RegExp(NOT_ALNUM_BEFORE + '(-?\\d+(?:\\.\\d+)?)(?:\\s*[~～]\\s*(-?\\d+(?:\\.\\d+)?))?\\s*(?:%|％|pct)', 'gi'), CHAIN_QUANT_MASK],
  /** R3：裸数字（`29` / `67` / `0`），含可选的 `~` 区间 */
  [new RegExp(NOT_ALNUM_BEFORE + '(-?\\d+(?:\\.\\d+)?)(?:\\s*[~～]\\s*(-?\\d+(?:\\.\\d+)?))?' + NOT_ALNUM_AFTER, 'g'), CHAIN_QUANT_MASK]
];

/** R4/R5：清理遮蔽后残留的孤立单位与相邻重复标记 */
const CLEANUP = [
  [new RegExp(CHAIN_QUANT_MASK + '\\s*(?:%|％|pct)', 'g'), CHAIN_QUANT_MASK],
  [new RegExp('(' + CHAIN_QUANT_MASK + ')(?:\\s*[~～]\\s*' + CHAIN_QUANT_MASK + ')+', 'g'), '$1'],
  [/\s{2,}/g, ' ']
];

/**
 * 把文案中的**所有定量数字**遮蔽为 `［数字已隐藏］`。
 * @param {string|null|undefined} text
 * @returns {string} 遮蔽后文案（null/undefined ⇒ `''`）
 */
export function maskQuant(text) {
  if (text === null || text === undefined) return '';
  let s = String(text);
  for (const [re, to] of RULES) s = s.replace(re, to);
  for (const [re, to] of CLEANUP) s = s.replace(re, to);
  return s.trim();
}

/** 文案中是否含定量数字（判定方式：遮蔽后是否变化，⛔ 不另写一套正则） */
export function hasQuant(text) {
  if (text === null || text === undefined) return false;
  return maskQuant(text) !== String(text);
}

/**
 * ★ M6 / **UI-001**（2026-10-01，owner 正式裁定 = `RESOLVED`）—— 两个「市场环境」语义消歧
 *
 *   背景：同一页出现**两个不同层级**的事实，都用「市场环境」措辞：
 *     · 页头「**组合环境**」= 组合快照 `overview.market_regime`（组合级）；
 *     · 决策链第 1 步的「市场环境」= **引擎决策时点**的上下文（后端 `explain_chain` 原文）。
 *   实测二者可以不同（如 组合级=防守 vs 链上=系统性风险）⇒ 用户会误以为是同一件事。
 *
 *   裁定：**两个数据点都保留**（⛔ 不删除、不合并、不重算、⛔ 不用其一覆盖另一个），
 *         只把**链上**那条的标签改写为「**决策时点市场环境**」以消歧。
 *
 *   ⛔ 本函数只动**展示文案里开头那一个词**：不改数据、不改字段、不改来源、不改计算逻辑；
 *      原文仍完整保留在 `conditionRaw`（供审计与未来恢复）。
 */
const ENGINE_CONTEXT = /^市场环境\s*(?:[·・]\s*)?([\s\S]*)$/;

/**
 * 把链条件的**前导**「市场环境」改写为「决策时点市场环境 ·」。
 * 非该形态的文案**逐字返回**（⛔ 不做任何其它改写）。
 * @param {string|null|undefined} text
 * @returns {string|null|undefined}
 */
export function disambiguateEngineContext(text) {
  if (text === null || text === undefined) return text;
  const s = String(text);
  const m = ENGINE_CONTEXT.exec(s);
  if (!m) return s;
  const rest = m[1].trim();
  return rest ? '决策时点市场环境 · ' + rest : '决策时点市场环境';
}

/**
 * 单条链步骤 → 定性展示对象。
 * @param {object} rawStep `{ step, condition, result }`（已适配的 Field 三元组）
 * @returns {object} `{ step, condition, conditionDisplay, result, resultDisplay, quantHidden, resultQuantHidden }`
 */
export function qualitativeStep(rawStep) {
  const condition = rawStep && rawStep.condition;
  const result = rawStep && rawStep.result;
  const conditionText = condition && condition.state === 'PROVIDED' ? String(condition.value) : null;
  const resultText = result && result.state === 'PROVIDED' ? String(result.value) : null;

  const conditionMasked = hasQuant(conditionText);
  const resultMasked = hasQuant(resultText);

  return Object.freeze({
    step: rawStep ? rawStep.step : null,
    /** 原文（供测试断言与未来恢复；⛔ UI 不得渲染） */
    conditionRaw: conditionText,
    resultRaw: resultText,
    /** 可渲染文案（已遮蔽 + ★ UI-001 消歧） */
    conditionDisplay: conditionText === null ? null : disambiguateEngineContext(maskQuant(conditionText)),
    resultDisplay: resultText === null ? null : (resultMasked ? null : resultText),
    /** 结果含定量 ⇒ 用固定说明替代（⛔ 不做部分替换） */
    resultHiddenText: resultMasked ? CHAIN_RESULT_QUANT_HIDDEN : null,
    quantHidden: conditionMasked || resultMasked,
    resultQuantHidden: resultMasked
  });
}

/* ⚠️ 刻意 **不** re-export `CHAIN_QUANT_MASK` / `CHAIN_RESULT_QUANT_HIDDEN`：
 *   它们由 `labels.js` 定义，若在此再导出，`domain/index.js` 的 `export *` 会因同名
 *   变成 ambiguous star export ⇒ 该名字在出口静默不可用（ESM 不报错）。仅本地引用即可。 */
