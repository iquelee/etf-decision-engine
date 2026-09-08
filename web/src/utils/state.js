import {
  W_STATE_LABELS, D_STATE_LABELS, H_STATE_LABELS, V_STATE_LABELS,
  F_STATE_LABELS, C_STATE_LABELS, RISK_FLAG_LABELS, OPPORTUNITY_GRADE_LABELS
} from './constants.js';

const STATE_LABELS = {
  W: W_STATE_LABELS,
  D: D_STATE_LABELS,
  H: H_STATE_LABELS,
  V: V_STATE_LABELS,
  F: F_STATE_LABELS,
  C: C_STATE_LABELS
};

/** 维度全称（禁止在界面单独写 F/W/D/H/V/C） */
export const STATE_DIM_LABELS = {
  W: '周线',
  D: '日线',
  H: '横盘',
  V: '量能',
  F: '基本面',
  C: '拥挤度'
};

export function stateName(kind, key) {
  if (!key) return '—';
  const map = STATE_LABELS[kind];
  return (map && map[key]) || key;
}

export function riskFlagName(flag) {
  if (!flag) return '正常';
  return RISK_FLAG_LABELS[flag] || flag;
}

export function gradeName(grade) {
  if (!grade) return '—';
  return OPPORTUNITY_GRADE_LABELS[grade] || grade;
}

/** 把决策链里残留的 W3/F2/C1/NORMAL/A 改成全称（兼容历史快照） */
export function prettyExplain(text) {
  let s = String(text || '');
  s = s.replace(/\bW([1-5])\s+周线\s*/g, '周线 ');
  s = s.replace(/\bD([1-5])\s+日线\s*/g, '日线 ');
  s = s.replace(/\bH([1-5])\s+横盘\s*/g, '横盘 ');
  s = s.replace(/\bV([1-5])\s+量能\s*/g, '量能 ');
  s = s.replace(/\bF([1-5])\s+基本面\s*/g, '基本面 ');
  s = s.replace(/拥挤度\s+(.+?)\s+·\s+C[1-4]/g, '拥挤度 $1');
  s = s.replace(/风险等级\s+(NORMAL|YELLOW|RED)/g, (_, flag) => `风险等级 ${riskFlagName(flag)}`);
  s = s.replace(/机会等级\s+([A-F])\b/g, (_, g) => `机会等级 ${gradeName(g)}`);
  s = s.replace(/RISK_OVERRIDE/g, '强制减仓');
  s = s.replace(/\bPASS\b/g, '通过');
  s = s.replace(/\bBLOCKED\b/g, '拦截');
  s = s.replace(/\bALLOW\b/g, '允许');
  s = s.replace(/\bFORBID\b/g, '禁止');
  s = s.replace(/\bTACTICAL_REDUCE\b/g, '战术减仓');
  s = s.replace(/\bSTRATEGIC_REDUCE\b/g, '战略减仓');
  s = s.replace(/\bBUILD\b/g, '建仓');
  s = s.replace(/\bADD\b/g, '加仓');
  s = s.replace(/\bHOLD\b/g, '持有');
  s = s.replace(/\bWAIT\b/g, '等待');
  s = s.replace(/\bEXIT\b/g, '清仓');
  return s.replace(/\s+/g, ' ').trim();
}
