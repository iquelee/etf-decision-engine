/**
 * API Client（web/src/rewrite/api.js）—— **只负责 transport 与错误归一**
 * 规范依据：SPEC §2.2 / §8.3 / §11.4（D-5）
 *
 * ★ 本层**不**做三件事（M2 清理）：
 *   1. ⛔ 不改 `window.location`（401 的会话与跳转语义上移到 compose/app 层，SPEC §8.3）
 *      —— 旧实现在 401 时直接改 `location.hash`，副作用藏在 HTTP 客户端里（审计 §4.8-3）；
 *   2. ⛔ 不保留 `api.macro()`（D-5 裁定：按 dead code 删除，需要时再建正式 contract）；
 *   3. ⛔ 不解释业务字段（字段语义在 adapters/domain）。
 *
 * 会话钩子：app/compose 通过 `setUnauthorizedHandler(fn)` 注册「未授权」处理
 * （默认只清 token，不跳转）。
 */

// ⚠️ `import.meta.env` 由 Vite 注入；裸 Node（跑测试）下为 undefined ⇒ 用空对象兜底，
//    使本模块可在无打包器环境下被 import（api-client 测试需要）。
const ENV = import.meta.env || {};
const API_BASE = ENV.VITE_API_BASE || '';
const ADMIN_BASE = ENV.VITE_ADMIN_BASE || '';
const TOKEN_KEY = 'admin_token';
const DEFAULT_TIMEOUT_MS = 20000;

/* ---------------- token ---------------- */

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch (e) {
    return '';
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch (e) {
    /* 隐私模式等场景下静默失败，由会话层决定后续行为 */
  }
}

/* ---------------- 错误模型 ---------------- */

export const API_ERROR_KIND = Object.freeze({
  NETWORK: 'NETWORK',
  TIMEOUT: 'TIMEOUT',
  HTTP: 'HTTP',
  UNAUTHORIZED: 'UNAUTHORIZED',
  ENVELOPE: 'ENVELOPE',
  PARSE: 'PARSE'
});

export class ApiError extends Error {
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.httpStatus = extra.httpStatus != null ? extra.httpStatus : null;
    this.code = extra.code != null ? extra.code : null;
    this.retryable = kind === API_ERROR_KIND.NETWORK || kind === API_ERROR_KIND.TIMEOUT
      || (kind === API_ERROR_KIND.HTTP && this.httpStatus >= 500);
  }
}

/* ---------------- 未授权钩子 ---------------- */

let unauthorizedHandler = null;

/** 由 app/compose 注入；⛔ 本层不自作主张跳转 */
export function setUnauthorizedHandler(fn) {
  unauthorizedHandler = typeof fn === 'function' ? fn : null;
}

function handleUnauthorized(message) {
  setToken(null);
  if (unauthorizedHandler) {
    try { unauthorizedHandler(); } catch (e) { /* 钩子异常不得影响错误传播 */ }
  }
  return new ApiError(API_ERROR_KIND.UNAUTHORIZED, message || '未登录或登录已过期');
}

/* ---------------- 核心请求 ---------------- */

async function call(base, path, { method = 'GET', body, auth = false, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = getToken();
    if (token) headers['X-Admin-Token'] = token;
  }

  const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  // 外部 signal 与内部超时合并
  if (signal && controller) {
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  let res;
  try {
    res = await fetch(base + path, {
      method,
      headers,
      body: method === 'GET' ? undefined : JSON.stringify(body === undefined ? {} : body),
      signal: controller ? controller.signal : signal
    });
  } catch (e) {
    if (e && e.name === 'AbortError') {
      throw new ApiError(API_ERROR_KIND.TIMEOUT, '请求超时（' + timeoutMs + 'ms）');
    }
    throw new ApiError(API_ERROR_KIND.NETWORK, '网络错误：' + ((e && e.message) || e));
  } finally {
    if (timer) clearTimeout(timer);
  }

  let json = null;
  let parseFailed = false;
  try {
    json = await res.json();
  } catch (e) {
    parseFailed = true;
  }

  if (!res.ok) {
    const msg = (json && json.message) || ('HTTP ' + res.status);
    if (res.status === 401) throw handleUnauthorized(msg);
    throw new ApiError(API_ERROR_KIND.HTTP, msg, { httpStatus: res.status, code: json && json.code });
  }
  if (parseFailed) {
    throw new ApiError(API_ERROR_KIND.PARSE, '响应不是合法 JSON');
  }
  if (json && json.code === 401) {
    throw handleUnauthorized(json.message);
  }
  if (json && json.code != null && json.code !== 0) {
    throw new ApiError(API_ERROR_KIND.ENVELOPE, json.message || '请求失败', { code: json.code, httpStatus: res.status });
  }
  return json && 'data' in json ? json.data : json;
}

const q = (obj = {}) => {
  const s = new URLSearchParams();
  Object.entries(obj).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  });
  const t = s.toString();
  return t ? '?' + t : '';
};

/* ---------------- 前台只读端点 ---------------- */

export const api = {
  constants: () => call(API_BASE, '/api/constants'),
  dashboard: () => call(API_BASE, '/api/dashboard'),
  etfList: () => call(API_BASE, '/api/etf/list'),
  etfDetail: (code) => call(API_BASE, '/api/etf/' + encodeURIComponent(code)),
  kline: (code, period = 'daily') => call(API_BASE, '/api/etf/' + encodeURIComponent(code) + '/kline' + q({ period })),
  decisions: (code, from, to) => call(API_BASE, '/api/etf/' + encodeURIComponent(code) + '/decisions' + q({ from, to })),
  /** ⚠️ 需鉴权（SPEC §8.1） */
  review: (from, to, code, action) => call(API_BASE, '/api/review' + q({ from, to, code, action }), { auth: true }),
  fundamentals: () => call(API_BASE, '/api/fundamentals'),
  intel: (limit = 80) => call(API_BASE, '/api/intel' + q({ limit }))
  /* ⛔ D-5 裁定：`macro()` 已删除（dead code）。需要宏观模块时另建正式 contract。 */
};

/* ---------------- 后台端点（自动带 token） ---------------- */

export const admin = {
  login: (password) => call(ADMIN_BASE, '/api/admin/login', { method: 'POST', body: { password } }),
  logout: () => call(ADMIN_BASE, '/api/admin/logout', { method: 'POST', body: {}, auth: true }),
  changePassword: (oldPassword, newPassword) => call(ADMIN_BASE, '/api/admin/changePassword', { method: 'POST', body: { oldPassword, newPassword }, auth: true }),

  params: () => call(ADMIN_BASE, '/api/admin/param', { auth: true }),
  updateParam: (body) => call(ADMIN_BASE, '/api/admin/param', { method: 'POST', body, auth: true }),

  gen1Health: () => call(ADMIN_BASE, '/api/admin/gen1/health', { auth: true }),
  gen2Shadow: (date) => call(ADMIN_BASE, '/api/admin/gen2/shadow' + q({ date }), { auth: true }),

  fetchLog: (from, to) => call(ADMIN_BASE, '/api/admin/fetchlog' + q({ from, to }), { auth: true }),
  triggerFetch: (task) => call(ADMIN_BASE, '/api/admin/fetch', { method: 'POST', body: { task }, auth: true }),

  riskList: () => call(ADMIN_BASE, '/api/admin/risk/list', { auth: true }),
  postRisk: (body) => call(ADMIN_BASE, '/api/admin/risk', { method: 'POST', body, auth: true }),

  fundamentalConfig: (code) => call(ADMIN_BASE, '/api/admin/fundamental/config' + q({ code }), { auth: true }),
  saveFundamentalConfig: (body) => call(ADMIN_BASE, '/api/admin/fundamental/config', { method: 'POST', body, auth: true }),
  addFundamentalData: (body) => call(ADMIN_BASE, '/api/admin/fundamental/data', { method: 'POST', body, auth: true }),
  fundamentalSeries: (code, indicator) => call(ADMIN_BASE, '/api/admin/fundamental/series' + q({ code, indicator }), { auth: true }),
  holdings: (code) => call(ADMIN_BASE, '/api/admin/fundamental/holdings' + q({ code }), { auth: true }),

  /** 情报刷新是**写操作**，只允许后台调用（SPEC §8.2） */
  intelRefresh: () => call(ADMIN_BASE, '/api/admin/intel/refresh', { method: 'POST', body: {}, auth: true }),

  trades: () => call(ADMIN_BASE, '/api/admin/trade', { auth: true }),
  tradeCreate: (body) => call(ADMIN_BASE, '/api/admin/trade', { method: 'POST', body: { ...body, _op: 'create' }, auth: true }),
  tradeUpdate: (body) => call(ADMIN_BASE, '/api/admin/trade', { method: 'POST', body: { ...body, _op: 'update' }, auth: true }),
  tradeDelete: (id) => call(ADMIN_BASE, '/api/admin/trade', { method: 'POST', body: { _id: id, _op: 'delete' }, auth: true }),

  portfolioSnapshot: (body) => call(ADMIN_BASE, '/api/admin/portfolio/snapshot', { method: 'POST', body, auth: true })
};

export default { api, admin };
