const API_BASE = import.meta.env.VITE_API_BASE || '';
const ADMIN_BASE = import.meta.env.VITE_ADMIN_BASE || '';
const TOKEN_KEY = 'admin_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY) || '';
export const setToken = (token) => token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY);

async function call(base, path, { method='GET', body, auth=false, signal }={}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = getToken();
    if (token) headers['X-Admin-Token'] = token;
  }
  const res = await fetch(base + path, {
    method,
    headers,
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    signal
  });
  let json = null;
  try { json = await res.json(); } catch (_) {}
  if (!res.ok) throw new Error(json?.message || `HTTP ${res.status}`);
  if (json?.code === 401 && auth) {
    setToken(null);
    window.location.hash = '#/login';
    throw new Error(json.message || '登录已过期');
  }
  if (json?.code != null && json.code !== 0) throw new Error(json.message || '请求失败');
  return json?.data ?? json;
}

const q = (obj={}) => {
  const s = new URLSearchParams();
  Object.entries(obj).forEach(([k,v]) => { if (v !== undefined && v !== null && v !== '') s.set(k, String(v)); });
  const t = s.toString();
  return t ? '?' + t : '';
};

export const api = {
  constants: () => call(API_BASE, '/api/constants'),
  dashboard: () => call(API_BASE, '/api/dashboard'),
  etfList: () => call(API_BASE, '/api/etf/list'),
  etfDetail: (code) => call(API_BASE, '/api/etf/' + encodeURIComponent(code)),
  kline: (code, period='daily') => call(API_BASE, '/api/etf/' + encodeURIComponent(code) + '/kline' + q({period})),
  decisions: (code, from, to) => call(API_BASE, '/api/etf/' + encodeURIComponent(code) + '/decisions' + q({from,to})),
  review: (from,to,code,action) => call(API_BASE, '/api/review' + q({from,to,code,action}), {auth:true}),
  fundamentals: () => call(API_BASE, '/api/fundamentals'),
  intel: (limit=80) => call(API_BASE, '/api/intel' + q({limit})),
  macro: () => call(API_BASE, '/api/macro')
};

export const admin = {
  login: (password) => call(ADMIN_BASE, '/api/admin/login', {method:'POST', body:{password}}),
  logout: () => call(ADMIN_BASE, '/api/admin/logout', {method:'POST', body:{}, auth:true}),
  changePassword: (oldPassword,newPassword) => call(ADMIN_BASE, '/api/admin/changePassword', {method:'POST',body:{oldPassword,newPassword},auth:true}),
  params: () => call(ADMIN_BASE, '/api/admin/param', {auth:true}),
  updateParam: (body) => call(ADMIN_BASE, '/api/admin/param', {method:'POST',body,auth:true}),
  gen1: () => call(ADMIN_BASE, '/api/admin/gen1/health', {auth:true}),
  gen2: (date) => call(ADMIN_BASE, '/api/admin/gen2/shadow' + q({date}), {auth:true}),
  fetchLog: (from,to) => call(ADMIN_BASE, '/api/admin/fetchlog' + q({from,to}), {auth:true}),
  triggerFetch: (task) => call(ADMIN_BASE, '/api/admin/fetch', {method:'POST',body:{task},auth:true}),
  riskList: () => call(ADMIN_BASE, '/api/admin/risk/list', {auth:true}),
  postRisk: (body) => call(ADMIN_BASE, '/api/admin/risk', {method:'POST',body,auth:true}),
  fundamentalConfig: (code) => call(ADMIN_BASE, '/api/admin/fundamental/config' + q({code}), {auth:true}),
  saveFundamentalConfig: (body) => call(ADMIN_BASE, '/api/admin/fundamental/config', {method:'POST',body,auth:true}),
  addFundamentalData: (body) => call(ADMIN_BASE, '/api/admin/fundamental/data', {method:'POST',body,auth:true}),
  fundamentalSeries: (code,indicator) => call(ADMIN_BASE, '/api/admin/fundamental/series' + q({code,indicator}), {auth:true}),
  holdings: (code) => call(ADMIN_BASE, '/api/admin/fundamental/holdings' + q({code}), {auth:true}),
  intelRefresh: () => call(ADMIN_BASE, '/api/admin/intel/refresh', {method:'POST',body:{},auth:true}),
  trades: () => call(ADMIN_BASE, '/api/admin/trade', {auth:true}),
  tradeCreate: (body) => call(ADMIN_BASE, '/api/admin/trade', {method:'POST',body:{...body,_op:'create'},auth:true}),
  tradeUpdate: (body) => call(ADMIN_BASE, '/api/admin/trade', {method:'POST',body:{...body,_op:'update'},auth:true}),
  tradeDelete: (id) => call(ADMIN_BASE, '/api/admin/trade', {method:'POST',body:{_id:id,_op:'delete'},auth:true}),
  snapshot: (body) => call(ADMIN_BASE, '/api/admin/portfolio/snapshot', {method:'POST',body,auth:true})
};
