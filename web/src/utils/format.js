/**
 * 格式化工具：日期/百分比/金额/数量。
 * 约定：百分比数值 30 = 30%；金额单位元；数量单位份。
 */

/** 数字千分位 */
export function formatNumber(n, digits = 2) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return Number(n).toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** 百分比：30 -> "30%"，可带符号 */
export function formatPercent(n, digits = 1, withSign = false) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const sign = withSign && n > 0 ? '+' : '';
  return `${sign}${Number(n).toFixed(digits)}%`;
}

/** 金额（元） */
export function formatAmount(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const abs = Math.abs(Number(n));
  if (abs >= 100000000) return `${(n / 100000000).toFixed(2)} 亿`;
  if (abs >= 10000) return `${(n / 10000).toFixed(2)} 万`;
  return formatNumber(n, 2);
}

/** 价格 */
export function formatPrice(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return Number(n).toFixed(3);
}

/** 份额 */
export function formatShares(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return formatNumber(n, 0);
}

/** 日期：YYYY-MM-DD 保留原样，带时间则转日期 */
export function formatDate(s) {
  if (!s) return '—';
  const str = String(s);
  if (str.length >= 10) return str.slice(0, 10);
  return str;
}

/** 日期时间（date 对象 / ISO 字符串 / 时间戳） */
export function formatDateTime(s) {
  if (!s) return '—';
  const d = s instanceof Date ? s : new Date(s);
  if (Number.isNaN(d.getTime())) return String(s);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 方向箭头文案 */
export function formatDirection(direction) {
  const map = { up: '↑ 升', down: '↓ 降', flat: '→ 平', na: '—' };
  return map[direction] || '—';
}

/** 空值统一占位 */
export function dash(v) {
  return v == null || v === '' ? '—' : v;
}
