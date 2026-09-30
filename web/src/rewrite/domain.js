export const ETF_NAMES = {
  '513310':'中韩半导体 ETF',
  '515880':'通信 ETF',
  '159582':'半导体设备 ETF',
  '518880':'黄金 ETF',
  '159570':'港股通创新药 ETF'
};

export const ACTION_LABELS = {
  WAIT:'等待', BUILD:'建仓', ADD:'加仓', HOLD:'持有',
  TACTICAL_REDUCE:'战术减仓', STRATEGIC_REDUCE:'战略减仓', EXIT:'清仓',
  wait:'等待', build:'建仓', add:'加仓', hold:'持有',
  tactical_reduce:'战术减仓', strategic_reduce:'战略减仓', exit:'清仓'
};

export const REGIME_LABELS = {
  aggressive:'进攻', structural:'结构性行情', range:'震荡',
  defensive:'防守', crisis:'系统性风险', recovery:'修复'
};

export const STATE_LABELS = {
  W1:'强趋势',W2:'趋势完整',W3:'周线震荡',W4:'趋势破坏',W5:'趋势反转',
  D1:'上涨',D2:'上涨后横盘',D3:'正常回调',D4:'高位震荡',D5:'趋势破坏',
  V1:'强缩量',V2:'温和缩量',V3:'正常量能',V4:'放量',V5:'异常放量',
  F1:'加速',F2:'稳定',F3:'中性',F4:'恶化',F5:'证伪'
};

export const RISK_LABELS = {NORMAL:'正常',YELLOW:'暂停加仓',RED:'风险熔断'};

export const roleLabel = {CORE:'核心',CHALLENGER:'挑战者',SATELLITE:'卫星',RESERVE:'储备',HEDGE:'对冲'};

export function actionLabel(code,label) {
  return ACTION_LABELS[code] || ACTION_LABELS[label] || label || code || '—';
}
export function regimeLabel(v) { return REGIME_LABELS[String(v||'').toLowerCase()] || v || '—'; }
export function etfName(code, list=[]) {
  return list.find(x=>x.code===code)?.name || ETF_NAMES[code] || code || '—';
}
/**
 * ★ V365 / D-7（2026-09-30，owner 裁定）：**已删除**基于数值范围的启发式 `pct()`。
 *
 * 被删除的实现是：
 *     return (Math.abs(n) <= 1.5 ? n * 100 : n).toFixed(digits) + '%';
 * 它会把线上真实的 `final_target = 0.5`（语义 0.5%）渲染成 `50%`。
 *
 * 替代（SPEC §10.2，语义化，由字段语义而非数值大小决定）：
 *   仓位/权重百分比（输入已是百分数） → formatPercent(v)     例 0.5 → '0.5%'
 *   概率（输入 0~1）                 → formatProbability(v) 例 0.72 → '72.0%'
 *   比例（输入 0~1，原样输出）        → formatRatio(v)
 *   ⛔ 三者不得互相代用。
 */
export {
  formatPercent,
  formatProbability,
  formatRatio,
  formatAmount,
  formatPrice,
  formatCount,
  formatNumber,
  formatDate,
  formatDateTime
} from './domain/format.js';

/** 百分数（输入已是百分数，⛔ 不做 ×100 推断）。保留旧名以兼容调用方，语义明确。 */
export { formatPercent as rawPct } from './domain/format.js';
export { formatNumber as num } from './domain/format.js';
export { formatDateTime as dateText } from './domain/format.js';

export function toneForAction(code) {
  if (['ADD','BUILD'].includes(code)) return 'accent';
  if (code==='HOLD') return 'good';
  if (['TACTICAL_REDUCE','STRATEGIC_REDUCE','EXIT'].includes(code)) return 'risk';
  return 'muted';
}
export function first(...values) {
  return values.find(v=>v!==undefined && v!==null && v!=='');
}
export function safeArray(v) { return Array.isArray(v) ? v : []; }
