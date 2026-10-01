/**
 * 阈值与等级判定（web/src/rewrite/domain/thresholds.js）
 * 规范依据：SPEC §2.2（阈值只此一处）
 *
 * ⛔ 阈值判定**只允许**在本文件实现。视图/组件/模板 ⛔ 不得内联阈值。
 *    （旧前端把机会等级阈值抄了两份：constants.js 与 ScoreBar.vue，见审计 §4.2）
 *
 * ⚠️ 本文件的阈值**镜像后端**，不是前端自创；变更须与后端同步并更新 SPEC。
 */

/* ---------------- 机会等级（A~F） ----------------
 * 依据：后端 gradeOpportunity（A≥80 / B≥65 / C≥50 / D≥35 / E≥20 / F<20）
 * 前端优先使用后端下发的 opportunity_grade；本函数仅在 grade 缺失时兜底。
 */
export const OPPORTUNITY_THRESHOLDS = Object.freeze([
  { min: 80, grade: 'A', label: '强进攻', tone: 'good' },
  { min: 65, grade: 'B', label: '积极', tone: 'good' },
  { min: 50, grade: 'C', label: '持有', tone: 'warn' },
  { min: 35, grade: 'D', label: '警戒', tone: 'warn' },
  { min: 20, grade: 'E', label: '防守', tone: 'risk' },
  { min: -Infinity, grade: 'F', label: '清仓', tone: 'risk' }
]);

export const OPPORTUNITY_GRADE_LABELS = Object.freeze({
  A: '强进攻', B: '积极', C: '持有', D: '警戒', E: '防守', F: '清仓'
});

export function opportunityLevelByScore(score) {
  if (score === null || score === undefined || Number.isNaN(Number(score))) {
    return { grade: null, label: '—', tone: 'muted' };
  }
  const n = Number(score);
  const hit = OPPORTUNITY_THRESHOLDS.find((t) => n >= t.min);
  return { grade: hit.grade, label: hit.label, tone: hit.tone };
}

/** 优先后端 grade；缺失时按 score 兜底 */
export function opportunityLevel(grade, score) {
  if (grade && OPPORTUNITY_GRADE_LABELS[grade]) {
    const byScore = opportunityLevelByScore(score);
    return { grade, label: OPPORTUNITY_GRADE_LABELS[grade], tone: byScore.tone };
  }
  return opportunityLevelByScore(score);
}

/* ---------------- 防守等级 ----------------
 * 依据：high_volume_decline / W5 ⇒ 高；high_volume_stagnation / W4 ⇒ 中；否则低。
 */
export function defenseLevel({ highVolumeStagnation, highVolumeDecline, wState } = {}) {
  if (highVolumeDecline === true || wState === 'W5') return { level: '高', tone: 'risk' };
  if (highVolumeStagnation === true || wState === 'W4') return { level: '中', tone: 'warn' };
  return { level: '低', tone: 'good' };
}

/* ---------------- 五维评分上限（点数，非百分比） ----------------
 * 依据：线上实测 scores = {trend:5, volume:25, fundamental:20, crowding:15, risk:10, total:75}
 * ⛔ total 有意不展示（SPEC §4.2 / 旧实现「禁显总分」）。
 */
export const SCORE_DIMENSIONS = Object.freeze([
  { key: 'trend', label: '趋势', max: 25 },
  { key: 'volume', label: '量价', max: 25 },
  { key: 'fundamental', label: '基本面', max: 25 },
  { key: 'crowding', label: '拥挤度', max: 15 },
  { key: 'risk', label: '风险', max: 10 }
]);

/* ---------------- 加仓资格判据（★ 10 项，含首轮遗漏的 cooldown / regime） ----------------
 * 依据：线上 add_eligibility 实测键
 *   { trend, structure, volume, fund, chase, limit, sector, risk, cooldown, regime, overall }
 * ⚠️ 旧前端 ELIGIBILITY_ITEMS 只列 8 项，漏了 cooldown 与 regime（审计 §3.6 #10）。
 */
export const ELIGIBILITY_ITEMS = Object.freeze([
  { key: 'trend', label: '趋势' },
  { key: 'structure', label: '横盘结构' },
  { key: 'volume', label: '成交量' },
  { key: 'fund', label: '基本面' },
  { key: 'chase', label: '追涨' },
  { key: 'limit', label: '仓位上限' },
  { key: 'sector', label: '赛道' },
  { key: 'risk', label: '风险熔断' },
  { key: 'cooldown', label: '加仓冷静期' },
  { key: 'regime', label: '市场环境' }
]);

/** 单项判据 → 语义（ok / pause / 其它=阻止） */
export function eligibilityTone(v) {
  if (v === 'ok') return 'good';
  if (v === 'pause') return 'warn';
  if (v === null || v === undefined || v === '') return 'muted';
  return 'risk';
}

export const ELIGIBILITY_OVERALL_LABELS = Object.freeze({
  ok: '通过', allow: '通过', pause: '暂停', forbid: '禁止', block: '禁止'
});

export function eligibilityOverallLabel(v) {
  if (!v) return '—';
  return ELIGIBILITY_OVERALL_LABELS[String(v).toLowerCase()] || String(v);
}

/* ---------------- 素材/文本长度阈值（供 UI 折叠判断，非业务阈值） ---------------- */
export const CHAIN_COLLAPSE_AFTER = 3;     // 决策链首页只展开前 3 步
export const TABLE_MOBILE_BREAKPOINT = 768; // SPEC §13
