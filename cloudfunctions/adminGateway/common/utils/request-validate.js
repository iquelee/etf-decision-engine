'use strict';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const { RISK_EVENT_TYPES } = require('../constants');

function isDateStr(s) {
  if (!s || typeof s !== 'string') return false;
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function clampInt(n, min, max, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(v)));
}

/** 严格有限数值校验，避免 NaN/Infinity/越界污染账户与回测数据。 */
function parseFiniteNumber(value, opts = {}) {
  const { min = -Infinity, max = Infinity, name = 'value' } = opts;
  if (value === '' || value == null) throw new Error(`${name} 必须是有效数字`);
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${name} 必须是有效数字`);
  if (n < min || n > max) throw new Error(`${name} 超出范围（应为 ${min}~${max}）`);
  return n;
}

const RISK_FLAGS = ['NORMAL', 'YELLOW', 'RED'];

function isRiskFlag(s) {
  return s && RISK_FLAGS.indexOf(String(s).toUpperCase()) >= 0;
}

function normalizeRiskFlag(s, fallback = 'YELLOW') {
  if (!s) return fallback;
  const up = String(s).toUpperCase();
  return RISK_FLAGS.indexOf(up) >= 0 ? up : fallback;
}

function isRiskEventTypeKey(key) {
  if (!key) return false;
  const k = String(key).toUpperCase();
  return Object.prototype.hasOwnProperty.call(RISK_EVENT_TYPES, k)
    || Object.values(RISK_EVENT_TYPES).indexOf(String(key).toLowerCase()) >= 0;
}

module.exports = {
  DATE_RE,
  isDateStr,
  clampInt,
  parseFiniteNumber,
  RISK_FLAGS,
  isRiskFlag,
  normalizeRiskFlag,
  isRiskEventTypeKey
};
