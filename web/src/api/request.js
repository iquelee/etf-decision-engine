/**
 * HTTP 请求封装（对接 apiGateway / adminGateway 云函数）
 * 统一错误处理与空态（data 为 null 时返回 null，由页面做灰化）。
 * 基础 URL 通过 Vite 环境变量配置：
 *   VITE_API_BASE    —— apiGateway 网关 URL（如 https://xxx.apigw.tencentcs.com/apiGateway）
 *   VITE_ADMIN_BASE  —— adminGateway 网关 URL
 *
 * 后台鉴权：adminApi 所有接口（login 除外）自动携带 X-Admin-Token 头，
 * 401 时清除本地 token 并跳转 /login。
 */

const API_BASE = import.meta.env.VITE_API_BASE || '';
const ADMIN_BASE = import.meta.env.VITE_ADMIN_BASE || '';

const TOKEN_KEY = 'admin_token';

export function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
export function setToken(t) { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); }

/** 通用请求（前台只读 + 登录接口） */
async function request(base, path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const init = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (options.auth) {
    const token = getToken();
    if (token) init.headers['X-Admin-Token'] = token;
  }
  if (method !== 'GET' && options.body) init.body = JSON.stringify(options.body);

  let res;
  try {
    res = await fetch(`${base}${path}`, init);
  } catch (e) {
    throw new Error(`网络错误：${e.message || e}`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.code === 401 && options.auth) {
    setToken(null);
    window.location.hash = '#/login';
  }
  if (json.code !== 0) throw new Error(json.message || '请求失败');
  return json.data;
}

/** 后台请求：自动带 token 头；401 时清 token 跳登录 */
async function adminRequest(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['X-Admin-Token'] = token;
  const init = { method, headers };
  if (method !== 'GET' && options.body) init.body = JSON.stringify(options.body);

  let res;
  try {
    res = await fetch(`${ADMIN_BASE}${path}`, init);
  } catch (e) {
    throw new Error(`网络错误：${e.message || e}`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.code === 401) {
    setToken(null);
    window.location.hash = '#/login';
    throw new Error(json.message || '未登录或登录已过期');
  }
  if (json.code !== 0) throw new Error(json.message || '请求失败');
  return json.data;
}

/** 前台只读接口 */
export const api = {
  dashboard: () => request(API_BASE, '/api/dashboard'),
  etfList: () => request(API_BASE, '/api/etf/list'),
  etfDetail: (code) => request(API_BASE, `/api/etf/${encodeURIComponent(code)}`),
  kline: (code, period = 'daily') => {
    const params = new URLSearchParams();
    params.set('period', period);
    return request(API_BASE, `/api/etf/${encodeURIComponent(code)}/kline?${params.toString()}`);
  },
  decisions: (code, from, to) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const q = params.toString();
    return request(API_BASE, `/api/etf/${encodeURIComponent(code)}/decisions${q ? '?' + q : ''}`);
  },
  review: (from, to, code, action) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (code) params.set('code', code);
    if (action) params.set('action', action);
    const q = params.toString();
    return request(API_BASE, `/api/review${q ? '?' + q : ''}`, { auth: true });
  },
  fundamentals: () => request(API_BASE, '/api/fundamentals'),
  intel: (limit = 60) => {
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    return request(API_BASE, `/api/intel?${params.toString()}`);
  },
  macro: () => request(API_BASE, '/api/macro'),
  constants: () => request(API_BASE, '/api/constants')
};

/** 后台读写接口（自动带 token） */
export const adminApi = {
  // 鉴权
  login: (password) => request(ADMIN_BASE, '/api/admin/login', { method: 'POST', body: { password } }),
  changePassword: (oldPassword, newPassword) => adminRequest('/api/admin/changePassword', { method: 'POST', body: { oldPassword, newPassword } }),
  logout: () => adminRequest('/api/admin/logout', { method: 'POST', body: {} }),
  // 基本面
  fundamentalConfig: (code) => {
    const params = new URLSearchParams();
    params.set('code', code);
    return adminRequest(`/api/admin/fundamental/config?${params.toString()}`);
  },
  saveFundamentalConfig: (body) => adminRequest('/api/admin/fundamental/config', { method: 'POST', body }),
  addFundamentalData: (body) => adminRequest('/api/admin/fundamental/data', { method: 'POST', body }),
  fundamentalSeries: (code, indicator) => {
    const params = new URLSearchParams();
    params.set('code', code);
    params.set('indicator', indicator);
    return adminRequest(`/api/admin/fundamental/series?${params.toString()}`);
  },
  etfHoldings: (code) => {
    const params = new URLSearchParams();
    params.set('code', code);
    return adminRequest(`/api/admin/fundamental/holdings?${params.toString()}`);
  },
  intelRefresh: () => adminRequest('/api/admin/intel/refresh', { method: 'POST', body: {} }),
  // 风险
  postRisk: (body) => adminRequest('/api/admin/risk', { method: 'POST', body }),
  riskList: () => adminRequest('/api/admin/risk/list'),
  // 参数
  params: () => adminRequest('/api/admin/param'),
  updateParam: (body) => adminRequest('/api/admin/param', { method: 'POST', body }),
  // Gen-1 模型健康（只读）
  gen1Health: () => adminRequest('/api/admin/gen1/health'),
  // Gen-2 Selection Shadow（只读观察）
  gen2Shadow: (date) => {
    const params = new URLSearchParams();
    if (date) params.set('date', date);
    const q = params.toString();
    return adminRequest(`/api/admin/gen2/shadow${q ? '?' + q : ''}`);
  },
  // 操作记录
  tradeList: () => adminRequest('/api/admin/trade'),
  tradeCreate: (body) => adminRequest('/api/admin/trade', { method: 'POST', body: { ...body, _op: 'create' } }),
  tradeUpdate: (body) => adminRequest('/api/admin/trade', { method: 'POST', body: { ...body, _op: 'update' } }),
  tradeDelete: (id) => adminRequest('/api/admin/trade', { method: 'POST', body: { _id: id, _op: 'delete' } }),
  // 数据管理
  triggerFetch: (task) => adminRequest('/api/admin/fetch', { method: 'POST', body: { task } }),
  fetchLog: (from, to) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const q = params.toString();
    return adminRequest(`/api/admin/fetchlog${q ? '?' + q : ''}`);
  },
  // 账户快照（总资产/浮盈）
  portfolioSnapshot: (body) => adminRequest('/api/admin/portfolio/snapshot', { method: 'POST', body })
};

export default { api, adminApi };
