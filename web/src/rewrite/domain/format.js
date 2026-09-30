/**
 * V365 语义化格式化层（web/src/rewrite/domain/format.js）
 * 规范依据：docs/V365_PROJECT_FUNCTION_AND_FRONTEND_REWRITE_SPEC.md §10
 *
 * ★ 核心契约（§10.1）：⛔ 禁止任何「按数值大小推断单位」的启发式。
 *   历史问题：旧 `pct()` / `fmtProb()` 在 `Math.abs(v) <= 1.5` 时把值 ×100，
 *   会把线上真实的 `final_target = 0.5`（语义 0.5%）渲染成 `50%`。
 *
 * ★ 正确做法（§10.2）：**由字段语义决定 formatter**，不由数值大小决定。
 *
 *   仓位/权重百分比（契约内已是百分数：final_target / *_pct / current_position）
 *     → formatPercent(v)
 *   比例（0~1，且语义确为比例）        → formatRatio(v)
 *   概率（契约内 0~1）                → formatProbability(v)   ← 唯一允许 0~1 → % 的场景
 *   金额（元）                        → formatAmount(v)
 *   价格（元）                        → formatPrice(v)
 *   数量（份）                        → formatCount(v)
 *   日期 / 日期时间                   → formatDate(v) / formatDateTime(v)
 */

const EMPTY = '—';

function isNil(v) {
  return v === null || v === undefined || v === '' || Number.isNaN(Number(v));
}

/* ---------------- 数值类 ---------------- */

/**
 * 仓位 / 权重百分比。**输入已是百分数**，⛔ 不做任何 ×100 推断。
 * @param {number|string|null} v 百分数，例 0.5 表示 0.5%
 * @param {number} digits 小数位
 * @param {boolean} withSign 正数是否加 '+'
 * @returns {string} 例 '0.5%' / '+12.3%'
 */
export function formatPercent(v, digits = 1, withSign = false) {
  if (isNil(v)) return EMPTY;
  const n = Number(v);
  const sign = withSign && n > 0 ? '+' : '';
  return sign + n.toFixed(digits) + '%';
}

/**
 * 比例（0~1 的纯比例），**原样输出，不转百分比**。
 * @returns {string} 例 '0.72'
 */
export function formatRatio(v, digits = 2) {
  if (isNil(v)) return EMPTY;
  return Number(v).toFixed(digits);
}

/**
 * 概率：契约内为 0~1 的比例，本函数是**唯一**允许做 0~1 → % 换算的地方
 * （因其语义明确为「比例」，不存在单位歧义）。
 * 若传入的值 > 1.5，视为调用方误传百分数 ⇒ 直接报错，⛔ 不静默猜测。
 * @returns {string} 例 '72.0%'
 */
export function formatProbability(v, digits = 1) {
  if (isNil(v)) return EMPTY;
  const n = Number(v);
  if (n > 1.5) {
    throw new Error(
      'formatProbability 期望 0~1 的概率，收到 ' + n + '；' +
      '若该字段本就是百分数，请改用 formatPercent（SPEC §10.2）'
    );
  }
  return (n * 100).toFixed(digits) + '%';
}

/** 金额（元）。 */
export function formatAmount(v, digits = 2) {
  if (isNil(v)) return EMPTY;
  const n = Number(v);
  const abs = Math.abs(n);
  if (abs >= 1e8) return (n / 1e8).toFixed(2) + ' 亿';
  if (abs >= 1e4) return (n / 1e4).toFixed(2) + ' 万';
  return n.toFixed(digits);
}

/** 价格（元）。 */
export function formatPrice(v, digits = 3) {
  if (isNil(v)) return EMPTY;
  return Number(v).toFixed(digits);
}

/** 数量（份），千分位整数。 */
export function formatCount(v) {
  if (isNil(v)) return EMPTY;
  return Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 0 });
}

/** 普通数值（无单位、无推断）。 */
export function formatNumber(v, digits = 1) {
  if (isNil(v)) return EMPTY;
  return Number(v).toFixed(digits);
}

/**
 * 评分（点数 0~100 或各维上限）。⛔ **不加 `%`** —— 机会分/横盘分/五维分都是点数。
 * @returns {string} 例 '67' / '28.5'
 */
export function formatScore(v, digits = 0) {
  if (isNil(v)) return EMPTY;
  const n = Number(v);
  return digits > 0 ? n.toFixed(digits) : String(Math.round(n));
}

/**
 * 比例（0~1）**按调用方显式声明**渲染成百分比。
 * ⚠️ 与 `formatProbability` 的区别：本函数**不做** 0~1 合法性校验，
 *    仅用于「语义确为比例、但业务上要显示成 %」的字段（如 `price_position`）。
 *    ⛔ 不得用它给 stage_factor / market_factor 这类**系数**加 %（系数不是比例份额）。
 * @returns {string} 例 '72.0%'
 */
export function formatRatioAsPercent(v, digits = 1) {
  if (isNil(v)) return EMPTY;
  return (Number(v) * 100).toFixed(digits) + '%';
}

/* ---------------- 日期类 ---------------- */

/** 日期：保留 YYYY-MM-DD 前 10 位。 */
export function formatDate(v) {
  if (!v) return EMPTY;
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

/** 日期时间：YYYY-MM-DD HH:mm（本地时区）。 */
export function formatDateTime(v) {
  if (!v) return EMPTY;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  const p = (x) => String(x).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
    ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

/* ---------------- 文本/枚举类 ---------------- */

/** 空值统一占位（仅供「已确认为空」时使用；⛔ 不得用于掩盖 MISSING / UNAVAILABLE）。 */
export function dash(v) {
  return v === null || v === undefined || v === '' ? EMPTY : v;
}

/** 方向文案。 */
export function formatDirection(direction) {
  const map = { up: '↑ 升', down: '↓ 降', flat: '→ 平', na: EMPTY };
  return map[direction] || EMPTY;
}

export const EMPTY_TEXT = EMPTY;
