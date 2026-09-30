/**
 * Field<T> 与 Provenance —— 数据来源与可用性的统一载体
 * 规范依据：SPEC §2（分层）/ §9（缺失状态机）/ §6.3（canonical 优先）
 *
 * ★ 核心不变式：
 *   1. 每个从后端读来的值都必须包成 Field，**不允许裸值直通 UI**；
 *   2. `state !== 'PROVIDED'` 时 ⛔ 不得携带可用 value；
 *   3. 由前端推导出的值必须标 `provenance.derived = true`（SPEC §2.2 / G4）。
 */
import { FIELD_STATE, MISSING_REASON, AUTHORITY } from './enums.js';

/** 数据来源描述 */
export function provenance({ source, authority = AUTHORITY.UNKNOWN, derived = false, asOf = null, fallbackFrom = null }) {
  return Object.freeze({ source, authority, derived, asOf, fallbackFrom });
}

/** 有真实数据 */
export function provided(value, prov) {
  return Object.freeze({ state: FIELD_STATE.PROVIDED, value, provenance: prov });
}

/** 响应成功但字段缺失/为 null */
export function missing(reason, prov) {
  return Object.freeze({
    state: FIELD_STATE.MISSING,
    value: null,
    missingReason: reason || MISSING_REASON.FIELD_ABSENT,
    provenance: prov
  });
}

/** 契约整块未下发（可自愈：后端部署后同一份前端即恢复显示） */
export function unavailable(reason, prov) {
  return Object.freeze({
    state: FIELD_STATE.UNAVAILABLE,
    value: null,
    missingReason: reason || MISSING_REASON.CONTRACT_NOT_PROVIDED,
    provenance: prov
  });
}

/** 数据超 SLA */
export function stale(value, prov) {
  return Object.freeze({ state: FIELD_STATE.STALE, value, provenance: prov });
}

/** 请求失败（网络 / 5xx / 解析失败） */
export function errored(message, prov) {
  return Object.freeze({ state: FIELD_STATE.ERROR, value: null, missingReason: message, provenance: prov });
}

/* ---------------- 判定helpers ---------------- */

export function hasValue(f) {
  return !!f && f.state === FIELD_STATE.PROVIDED;
}

/**
 * 从对象里安全取字段并包成 Field。
 * - 对象本身不存在 ⇒ UNAVAILABLE（契约未下发）
 * - 字段不存在或为 null/undefined ⇒ MISSING（FIELD_ABSENT / NULL_IN_CONTRACT）
 * - 否则 ⇒ PROVIDED
 *
 * ⚠️ 注意：`0` 与 `''` 是**合法值**，必须判定为 PROVIDED（SPEC §9）。
 */
export function readField(container, key, prov) {
  if (container === null || container === undefined || typeof container !== 'object') {
    return unavailable(MISSING_REASON.CONTRACT_NOT_PROVIDED, prov);
  }
  if (!Object.prototype.hasOwnProperty.call(container, key)) {
    return missing(MISSING_REASON.FIELD_ABSENT, prov);
  }
  const v = container[key];
  if (v === null || v === undefined) {
    return missing(MISSING_REASON.NULL_IN_CONTRACT, prov);
  }
  return provided(v, prov);
}

/** 取父对象本身是否存在（用于「契约块是否下发」判定） */
export function readBlock(container, key, prov) {
  if (container === null || container === undefined || typeof container !== 'object') {
    return unavailable(MISSING_REASON.CONTRACT_NOT_PROVIDED, prov);
  }
  const v = container[key];
  if (v === null || v === undefined) {
    return unavailable(MISSING_REASON.CONTRACT_NOT_PROVIDED, prov);
  }
  return provided(v, prov);
}

/** 便捷：取裸值（仅用于展示层之前的格式化；⛔ 不得用它规避 Field 语义） */
export function valueOrNull(f) {
  return f && (f.state === FIELD_STATE.PROVIDED || f.state === FIELD_STATE.STALE) ? f.value : null;
}

/**
 * canonical → legacy 优先级选择（SPEC §6.3）
 * 规则：canonical 存在即用 canonical；**canonical 存在但字段缺失时不得静默 fallback**
 *      （fallback 只用于 canonical **整块未下发** 的情形）。
 *
 * @param {object} canonical Container|null（canonical 契约块）
 * @param {string} key
 * @param {object} legacyContainer legacy 兜底容器
 * @param {string} legacyKey
 * @param {object} prov
 */
export function pickCanonicalThenLegacy(canonical, key, legacyContainer, legacyKey, prov) {
  if (canonical !== null && canonical !== undefined && typeof canonical === 'object'
      && Object.prototype.hasOwnProperty.call(canonical, key)) {
    const v = canonical[key];
    if (v !== null && v !== undefined) return provided(v, prov);
    // canonical 有该键但为 null ⇒ 契约内缺失，⛔ 不得 fallback 掩盖
    return missing(MISSING_REASON.NULL_IN_CONTRACT, prov);
  }
  if (legacyContainer !== null && legacyContainer !== undefined && typeof legacyContainer === 'object'
      && Object.prototype.hasOwnProperty.call(legacyContainer, legacyKey || key)) {
    const v = legacyContainer[legacyKey || key];
    if (v !== null && v !== undefined) {
      return provided(v, provenance({
        source: prov && prov.source,
        authority: (prov && prov.authority) || AUTHORITY.UNKNOWN,
        derived: false,
        asOf: prov && prov.asOf ? prov.asOf : null,
        fallbackFrom: 'legacy'
      }));
    }
  }
  // canonical 整块未下发且 legacy 也没有 ⇒ UNAVAILABLE（可自愈）
  return unavailable(MISSING_REASON.CONTRACT_NOT_PROVIDED, prov);
}
