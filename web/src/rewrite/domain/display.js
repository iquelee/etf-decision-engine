/**
 * 展示映射层（web/src/rewrite/domain/display.js）
 * 规范依据：SPEC §2（分层）/ §9（缺失状态机）/ §10（语义化格式化）＋ owner 裁定 M4（禁止每页自己格式化）
 *
 * ★ 唯一职责：把 `Field<T>` → `{ field, text, missing, reason, reasonText }`。
 *   ⛔ 不做业务判断、⛔ 不猜单位、⛔ 不按数值范围推断。
 *
 * ★ 为什么独立成模块：M3 曾把 `disp()` 私有实现在 `adapters/dashboard.js` 内，
 *   M4 若再抄一份就成了**第三份格式化实现**（SPEC §10 / 用户裁定明确禁止"每页自己格式化数字"）。
 *   ⇒ 提取到 domain 层，M3/M4 共用同一实现（行为逐位不变，M3 测试即回归证据）。
 */
import { FIELD_STATE, MISSING_REASON } from './enums.js';
import { fieldStateText, missingReasonText } from './labels.js';
import {
  formatPercent, formatScore, formatDate, formatDateTime,
  formatRatio, formatProbability, formatAmount, formatPrice, formatCount
} from './format.js';

/**
 * 单值展示。缺失一律**显式**（`数据未提供` + 原因），⛔ 不得静默显示 `—`。
 * @param {object|null} field Field<T>
 * @param {(v:any)=>string|null} [formatter] 语义化格式化器（⛔ 不得传"按范围猜"的启发式）
 */
export function disp(field, formatter) {
  if (!field || (field.state !== FIELD_STATE.PROVIDED && field.state !== FIELD_STATE.STALE)) {
    const reason = (field && field.missingReason) || MISSING_REASON.NO_BACKEND_CONTRACT;
    return {
      field: field || null,
      text: fieldStateText(field && field.state) || '数据未提供',
      missing: true,
      reason,
      reasonText: missingReasonText(reason)
    };
  }
  let text;
  try {
    text = formatter ? formatter(field.value) : String(field.value);
  } catch (e) {
    // 语义拒绝（如 formatProbability 收到百分数）⇒ 回退原值，⛔ 不猜单位
    text = String(field.value);
  }
  return { field, text, missing: false, reason: null, reasonText: '' };
}

/**
 * 三态布尔（true / false / **null**）—— ⛔ 不得把 null 压成 false。
 * 依据：`system_runtime.gen2.production_write` 线上实测为 `null`。
 */
export function dispTri(field) {
  if (!field || field.state !== FIELD_STATE.PROVIDED) {
    const reason = (field && field.missingReason) || MISSING_REASON.NO_BACKEND_CONTRACT;
    return {
      field: field || null,
      text: fieldStateText(field && field.state) || '数据未提供',
      missing: true,
      reason,
      reasonText: missingReasonText(reason)
    };
  }
  const v = field.value;
  if (v === null || v === undefined) {
    return { field, text: '未提供（null）', missing: true, reason: MISSING_REASON.NULL_IN_CONTRACT, reasonText: missingReasonText(MISSING_REASON.NULL_IN_CONTRACT) };
  }
  if (v === true) return { field, text: '是', missing: false, reason: null, reasonText: '' };
  if (v === false) return { field, text: '否', missing: false, reason: null, reasonText: '' };
  return { field, text: String(v), missing: false, reason: null, reasonText: '' };
}

/* ---------------- 语义化快捷包装（★ 名字即单位契约） ----------------
 * ⛔ 严禁出现 `pct()` 这类「按数值大小猜单位」的函数（owner 裁定 D-7）。
 *   每个包装都对应一个**明确的字段语义**，调用方必须选对。
 */

/** 仓位 / 涨跌百分比（数值即百分数）：`final_target=0.5` ⇒ `0.5%` */
export const pctText = (field, digits = 1, withSign = false) => disp(field, (v) => formatPercent(v, digits, withSign));

/** 概率 0~1 ⇒ 百分数：`probability=0.72` ⇒ `72.0%`（⛔ 不是 0.7%） */
export const probText = (field, digits = 1) => disp(field, (v) => formatProbability(v, digits));

/** 比例 0~1 ⇒ **原样小数**（⛔ 不乘 100）：`price_position=0.3032` ⇒ `0.30` */
export const ratioText = (field, digits = 2) => disp(field, (v) => formatRatio(v, digits));

/** 点数（⛔ 不加 %）：`scores.trend=5` ⇒ `5` */
export const scoreText = (field, digits = 0) => disp(field, (v) => formatScore(v, digits));

/** 金额（元 ⇒ 万/亿显示）：输入单位**固定为元** */
export const amountText = (field, digits = 2) => disp(field, (v) => formatAmount(v, digits));

/** 价格（元） */
export const priceText = (field, digits = 3) => disp(field, (v) => formatPrice(v, digits));

/** 份额 / 数量（份） */
export const countText = (field) => disp(field, (v) => formatCount(v));

/** 日期（截到天） */
export const dateText = (field) => disp(field, (v) => formatDate(v));

/** 日期时间 */
export const dateTimeText = (field) => disp(field, (v) => formatDateTime(v));

/** 原值直出（仅用于枚举/文案类字段；⛔ 不得用于数值） */
export const rawText = (field) => disp(field, null);

/** 系数 0~1 的原样小数（⛔ 不加 %）：`market_factor=0.25` ⇒ `0.25`（**不是** 25%） */
export const factorText = (field, digits = 2) => disp(field, (v) => formatRatio(v, digits));
