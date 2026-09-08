'use strict';

const crypto = require('crypto');
const db = require('./db');
const { COLLECTIONS } = require('../constants');

function getHeader(event, wanted) {
  const headers = (event && event.headers) || {};
  const key = String(wanted).toLowerCase();
  const found = Object.keys(headers).find((k) => String(k).toLowerCase() === key);
  return found ? headers[found] : '';
}

function getAdminToken(event) {
  const raw = getHeader(event, 'x-admin-token') || getHeader(event, 'authorization') || '';
  return String(raw).replace(/^Bearer\s+/i, '').trim();
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
}

/** 统一校验后台 token；仅返回布尔值，不把 token 写入日志或响应。 */
async function requireAuth(event) {
  const token = getAdminToken(event);
  if (!token) return false;
  const rows = await db.query(COLLECTIONS.PARAM_CONFIG, { key: 'admin_token' }, { limit: 1 });
  const value = rows.length && rows[0].value ? rows[0].value : {};
  const saved = value.v || '';
  if (!safeEqual(token, saved)) return false;
  const exp = value.exp ? new Date(value.exp).getTime() : null;
  return !exp || (Number.isFinite(exp) && exp >= Date.now());
}

module.exports = { getHeader, getAdminToken, requireAuth };
