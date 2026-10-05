/**
 * 数据新鲜度（web/src/rewrite/domain/freshness.js）
 * 规范依据：SPEC §9
 *
 * ★ 三者文案必须不同，且都不得是 `—`：
 *   STALE（数据过期） ≠ MISSING（字段缺失） ≠ UNAVAILABLE（能力未提供）
 *
 * SLA 依据各域的真实更新节奏（来自线上实测）：
 *   · decision / snapshot：交易日日更 ⇒ 3 个自然日内算新鲜（覆盖周末）
 *   · runtime_status：日更（updated_at 有精确时间戳）
 *   · intel：小时级
 *   · fundamentals：月/周级
 */
import { FRESHNESS } from './enums.js';

/** 各域 SLA（小时）。⛔ 不得按「看起来旧」主观判断。 */
export const SLA_HOURS = Object.freeze({
  decision: 72,
  snapshot: 72,
  /** ★ K 线**独立域**（owner 裁定 M4-D2）：⛔ 不得与 decision/snapshot 合并判定 */
  kline: 72,
  runtimeStatus: 30,
  intel: 24,
  fundamentals: 24 * 30,
  adminHealth: 72,
  gen2Shadow: 24 * 7
});

/**
 * 严重滞后阈值（自然日）。
 * ★ 用途：区分「刚过期几天」（提示即可）与「滞后以年计」（必须置顶 banner）。
 *   实测案例：线上 K 线末端 `2024-08-27` vs 决策日 `2026-09-29` ⇒ 滞后 ≈ 764 天。
 *   ⛔ 该阈值只决定**呈现强度**，不改变 STALE 判定本身，也不得据此隐藏历史数据。
 */
export const SEVERE_STALE_DAYS = 30;

const HOUR_MS = 3600 * 1000;

/**
 * 判定新鲜度。
 * @param {string|number|Date|null} asOf 数据自身时点
 * @param {string} domain SLA 域键（见 SLA_HOURS）
 * @param {Date} now 参照时点（可注入，便于测试）
 * @returns {{level:string, ageHours:number|null, slaHours:number}}
 */
export function assess(asOf, domain, now = new Date()) {
  const slaHours = SLA_HOURS[domain] != null ? SLA_HOURS[domain] : 72;
  if (asOf === null || asOf === undefined || asOf === '') {
    return { level: FRESHNESS.MISSING, ageHours: null, slaHours };
  }
  const d = asOf instanceof Date ? asOf : new Date(asOf);
  if (Number.isNaN(d.getTime())) {
    return { level: FRESHNESS.MISSING, ageHours: null, slaHours };
  }
  const ageHours = (now.getTime() - d.getTime()) / HOUR_MS;
  // 未来时点（时钟偏差）：按 FRESH 处理，⛔ 不报负数年龄
  if (ageHours < 0) return { level: FRESHNESS.FRESH, ageHours: 0, slaHours };
  return {
    level: ageHours > slaHours ? FRESHNESS.STALE : FRESHNESS.FRESH,
    ageHours,
    slaHours
  };
}

/** 人类可读的过期说明（供 UI 直接显示，⛔ 不在此处做样式判断） */
export function describe(result) {
  if (result.level === FRESHNESS.MISSING) return '无时间戳';
  if (result.level === FRESHNESS.STALE) {
    const days = Math.floor(result.ageHours / 24);
    return days >= 1 ? '数据已过期 ' + days + ' 天' : '数据已过期 ' + Math.round(result.ageHours) + ' 小时';
  }
  return '数据新鲜';
}

/**
 * 是否「严重滞后」（滞后以月/年计）。
 * ★ 触发置顶 banner；⛔ 不改变 `level`（仍为 STALE），⛔ 不构成隐藏历史数据的理由。
 */
export function isSeverelyStale(result) {
  if (!result || result.level !== FRESHNESS.STALE) return false;
  return result.ageHours >= SEVERE_STALE_DAYS * 24;
}

/** 滞后天数（整数；用于文案，⛔ 四舍五入到「天」即可，不需要小时精度） */
export function staleDays(result) {
  if (!result || result.ageHours === null || result.ageHours === undefined) return null;
  return Math.floor(result.ageHours / 24);
}
