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
export function pct(v, digits=1) {
  if (v===null || v===undefined || Number.isNaN(Number(v))) return '—';
  const n=Number(v);
  return (Math.abs(n)<=1.5 ? n*100 : n).toFixed(digits)+'%';
}
export function rawPct(v,digits=1) {
  if (v===null || v===undefined || Number.isNaN(Number(v))) return '—';
  return Number(v).toFixed(digits)+'%';
}
export function num(v,digits=1) {
  if (v===null || v===undefined || Number.isNaN(Number(v))) return '—';
  return Number(v).toFixed(digits);
}
export function dateText(v) {
  if (!v) return '—';
  const s=String(v);
  return s.length>10 ? s.slice(0,16) : s;
}
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
