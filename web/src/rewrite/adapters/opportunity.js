/**
 * 机会 / 辅助信号适配器（web/src/rewrite/adapters/opportunity.js）
 * 规范依据：owner M4-P1b §三 / §九.1
 *
 * ★★ 命名纪律（本模块存在的**首要理由**）：
 *   后端已有正式的 `action` / `final_target` / `position_gap` ⇒ 那属 **V3 Safety Core 正式决策**；
 *   本模块只呈现**额外辅助信号**，⛔ **不得**叫「建议加仓」、⛔ 不得包装成第二个决赛层。
 *
 * ⛔ 明文禁止（用户 §三）：
 *   · ⛔ **不得**因为 `position_gap > 0` 就推导「应该加仓」——缺口是后端计算结果；
 *   · ⛔ 不得重算 `position_gap`（M4-P1a 已确立）。
 *
 * ★ 量纲（schema 可证，⛔ 不得猜）：
 *   · `opportunity_score`  = 机会分（点数，⛔ 不加 %）
 *   · `opportunity_factor` = **机会系数**（⛔ 不是百分比）
 *   · `add_mode`           = 字符串枚举（'横盘加仓' / '突破加仓' / '无'）
 */
import { readField, unavailable, provenance, hasValue } from '../domain/provenance.js';
import { FIELD_STATE, MISSING_REASON, AUTHORITY } from '../domain/enums.js';
import { scoreText, ratioText, rawText, pctText } from '../domain/display.js';
import {
  fieldStateText, addModeLabel, eligibilityStatusLabel,
  OPPORTUNITY_FACTOR_NOTE, OPPORTUNITY_SCORE_NOTE,
  OPPORTUNITY_SECTION_NOTE, OPPORTUNITY_NO_DERIVE_NOTE
} from '../domain/labels.js';
import { ELIGIBILITY_ITEMS, eligibilityTone, opportunityLevel } from '../domain/thresholds.js';

const SRC = 'api:/api/etf/:code#decision';
const P = (f) => provenance({ source: SRC + '.' + f, authority: AUTHORITY.SAFETY_CORE });

/**
 * @param {object} decisionVm `adaptDecision()` 的输出
 */
export function adaptOpportunity(decisionVm) {
  const d = decisionVm || {};
  const gradeF = d.opportunity ? d.opportunity.grade : null;
  const scoreF = d.opportunity ? d.opportunity.score : null;

  /** 机会/加仓族是否**至少有一项**有值（⛔ 不以「decision 存在」代替） */
  const avail = !!(d.available && (
    hasValue(gradeF) || hasValue(scoreF) || hasValue(d.opportunityFactor) || hasValue(d.addMode)
  ));

  return Object.freeze({
    available: avail,
    sectionNote: OPPORTUNITY_SECTION_NOTE,
    noDeriveNote: OPPORTUNITY_NO_DERIVE_NOTE,

    /* ---- 机会分 / 等级（★ 点数，⛔ 不加 %） ---- */
    score: scoreF || unavailable(MISSING_REASON.CONTRACT_NOT_PROVIDED, P('opportunity_score')),
    scoreText: scoreText(scoreF || unavailable(MISSING_REASON.CONTRACT_NOT_PROVIDED, P('opportunity_score'))),
    scoreNote: OPPORTUNITY_SCORE_NOTE,
    grade: gradeF || unavailable(MISSING_REASON.CONTRACT_NOT_PROVIDED, P('opportunity_grade')),
    gradeText: hasValue(gradeF) ? String(gradeF.value) : fieldStateText(gradeF ? gradeF.state : FIELD_STATE.UNAVAILABLE),
    level: d.opportunity && d.opportunity.level ? d.opportunity.level : { grade: null, label: '—', tone: 'muted' },
    levelText: d.opportunity && d.opportunity.level ? d.opportunity.level.label : '—',
    levelTone: d.opportunity && d.opportunity.level ? d.opportunity.level.tone : 'muted',

    /* ---- 机会系数（⛔ 不是百分比） ---- */
    factor: d.opportunityFactor || unavailable(MISSING_REASON.FIELD_ABSENT, P('opportunity_factor')),
    factorText: ratioText(d.opportunityFactor || unavailable(MISSING_REASON.FIELD_ABSENT, P('opportunity_factor')), 2),
    factorNote: OPPORTUNITY_FACTOR_NOTE,

    /* ---- 加仓模式（字符串枚举） ---- */
    addMode: d.addMode || unavailable(MISSING_REASON.FIELD_ABSENT, P('add_mode')),
    addModeText: hasValue(d.addMode) ? addModeLabel(d.addMode.value) : fieldStateText(d.addMode ? d.addMode.state : FIELD_STATE.UNAVAILABLE),

    /* ---- 冷静期 ---- */
    cooldownDays: d.cooldownDays || null,
    cooldownText: scoreText(d.cooldownDays || unavailable(MISSING_REASON.FIELD_ABSENT, P('cooldown_days'))),

    /* ---- 下一加仓条件（后端给定长句，⛔ 不改写、⛔ 不从中提取数字做判断） ---- */
    nextAddCondition: d.nextAddCondition || null,
    nextAddConditionText: rawText(d.nextAddCondition || unavailable(MISSING_REASON.FIELD_ABSENT, P('next_add_condition'))),

    /* ---- 加仓资格（★ 10 项判据 + overall） ---- */
    eligibility: adaptEligibility(d.addEligibility),

    /* ---- 缺口：**只引用正式决策的值**（⛔ 不重算、⛔ 不据它推导动作） ---- */
    gap: d.positionGap || null,
    gapText: pctText(d.positionGap || unavailable(MISSING_REASON.FIELD_ABSENT, P('position_gap')), 1, true),
    gapNote: d.gapNote || ''
  });
}

function adaptEligibility(block) {
  const prov0 = provenance({ source: SRC + '.add_eligibility', authority: AUTHORITY.SAFETY_CORE });
  if (!block || !block.available) {
    return Object.freeze({
      available: false,
      missingReason: (block && block.missingReason) || MISSING_REASON.CONTRACT_NOT_PROVIDED,
      items: Object.freeze(ELIGIBILITY_ITEMS.map((it) => Object.freeze({
        ...it, value: null, statusText: '数据未提供', tone: 'muted', blocked: false
      }))),
      overall: null,
      overallText: '数据未提供',
      overallTone: 'muted',
      blockedCount: 0
    });
  }
  const items = ELIGIBILITY_ITEMS.map((it) => {
    const f = block.items.find((x) => x.key === it.key);
    const field = f ? f.field : unavailable(MISSING_REASON.FIELD_ABSENT, prov0);
    const v = hasValue(field) ? String(field.value) : null;
    return Object.freeze({
      key: it.key,
      label: it.label,
      value: v,
      statusText: v === null ? fieldStateText(field.state) : eligibilityStatusLabel(v),
      tone: v === null ? 'muted' : eligibilityTone(v),
      /** 非 ok 即视为「未通过」（⛔ 语义由后端给定，前端只做展示映射） */
      blocked: v !== null && v !== 'ok'
    });
  });
  const overallF = block.overall;
  const overallV = hasValue(overallF) ? String(overallF.value) : null;
  return Object.freeze({
    available: true,
    missingReason: null,
    items: Object.freeze(items),
    overall: overallV,
    overallText: overallV === null ? fieldStateText(overallF.state) : eligibilityStatusLabel(overallV),
    overallTone: overallV === null ? 'muted' : eligibilityTone(overallV),
    blockedCount: items.filter((i) => i.blocked).length
  });
}

export { opportunityLevel };
