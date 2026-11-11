'use strict';
// Offline HTTP-to-local-worker bridge. Original business authentication remains.
const assert = require('assert');
const {isDeepStrictEqual} = require('util');
const {manualRequest} = require('./writer-entry');
const {potentialMutation} = require('./writer-admin-maintenance');
const {createLocalRoot} = require('./writer-local-root');
const operationHeader = 'x-writer-operation-id';
const operationPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function inspect(event) {
  assert(event && typeof event === 'object' && !Array.isArray(event));
  const business = JSON.parse(JSON.stringify(event));assert(isDeepStrictEqual(event, business), 'plain JSON request required');
  const method = (business.httpMethod || business.method || 'GET').toUpperCase();
  const route = (business.path || business.url || '/').replace(/^\/(apiGateway|adminGateway)/, '') || '/';
  assert(route.startsWith('/api/admin/') && route.length <= 140, 'admin route required');
  const headers = {};
  assert(!business.headers || (typeof business.headers === 'object' && !Array.isArray(business.headers)));
  for (const [name, value] of Object.entries(business.headers || {})) {
    assert(typeof value === 'string');const lower = name.toLowerCase();
    assert(!Object.hasOwn(headers, lower), 'duplicate header spelling');headers[lower] = value;
  }
  const mutation = route === '/api/admin/dispatch/status' ? false : potentialMutation(business), operationId = headers[operationHeader] && headers[operationHeader].toLowerCase();
  if (mutation) assert(typeof operationId === 'string' && operationPattern.test(operationId), 'stable UUIDv4 operation ID required');
  // The gateway ordinarily lowercases HTTP headers; normalize the SDK path too.
  business.headers = headers;
  return {business, method, route, mutation, operationId};
}
const failure = (code, message, extra = {}) => ({code, data: null, message, ...extra});
const acknowledge = (result, request, outcome) => ({...result, operation_id: request.operationId, writer_outcome: outcome});
function createAdminHttpRoot({binding, target, owner, key, store, runtimeIdentity, beforeAdmission, readToken,
  worker, loadReadMain, readDispatch, now = () => Date.now()}) {
  assert([runtimeIdentity, beforeAdmission, readToken, worker, loadReadMain, now].every(fn => typeof fn === 'function'));
  const local = createLocalRoot({store, binding, target, owner, key, runtimeIdentity, worker,
    identify: request => ({request_id: manualRequest({environment: binding.environment, producer: 'adminGateway',
      action: request.method + ':' + request.route,
      operation_id: (request.route === '/api/admin/login' ? 'login:' : 'admin:') + request.operationId}), business: request.business})});
  async function authorized(request) {
    // Login's original password verification/rate-limit writes run INSIDE the
    // admitted worker. Do not skip failed-password accounting or pre-verify it.
    if (request.route === '/api/admin/login') return true;
    const h = request.business.headers;
    const primary = h['x-admin-token'], bearer = h.authorization && h.authorization.replace(/^Bearer\s+/i, '');
    if (primary && bearer && primary.replace(/^Bearer\s+/i, '') !== bearer) return false;
    const token = (primary || bearer || '').replace(/^Bearer\s+/i, '');if (!token) return false;
    try {
      const saved = await readToken();
      if (!saved || typeof saved.v !== 'string' || saved.v !== token) return false;
      // Legacy invalid/missing expiries do not become a new trust credential.
      const expiry = saved.exp && new Date(saved.exp).getTime(), instant = now();
      return Number.isFinite(expiry) && Number.isFinite(instant) && expiry >= instant;
    } catch (_) {return false;}
  }
  return async (event, context) => {
    let request;
    try {
      const r = await runtimeIdentity(context);
      assert(r.environment === binding.environment && r.function_name === target && r.node_major === (owner === 'new' ? 24 : 16));
      request = inspect(event);
    } catch (_) {return failure(400, '请求或操作标识无效');}
    if (request.route === '/api/admin/dispatch/status') {
      if (request.method !== 'GET') return failure(405,'任务状态查询仅支持 GET');
      if (!(await authorized(request))) return failure(401,'未登录或登录已过期');
      const query = request.business.queryStringParameters || request.business.query || {};
      const body = request.business.body;
      const emptyBody = body === undefined || body === null || body === '' || (typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 0);
      if (!query || typeof query !== 'object' || Array.isArray(query) || Object.keys(query).join(',') !== 'job_id' ||
          typeof query.job_id !== 'string' || !/^dispatch:[a-f0-9]{64}$/.test(query.job_id) ||
          !emptyBody) return failure(400,'任务标识无效');
      try {
        assert.strictEqual(typeof readDispatch,'function');const job=await readDispatch(query.job_id);
        if (!job) return failure(404,'未找到该任务');
        return {code:0,data:require('./writer-dispatch-status').publicStatus(job),message:'ok'};
      } catch (_) {return failure(503,'任务状态暂不可核验');}
    }
    let allowed = false;try {allowed = await beforeAdmission(request.business, context) === true;} catch (_) { /* closed */ }
    if (!allowed) return request.mutation ? acknowledge(failure(503, '写入维护中，请稍后重试'), request, 'DENIED') : failure(503, '写入维护中，请稍后重试');
    if (!request.mutation) {
      const main = await loadReadMain();assert.strictEqual(typeof main, 'function');
      return main(request.business, context); // Original read auth remains authoritative.
    }
    if (!(await authorized(request))) return acknowledge(failure(401, '未登录或登录已过期'), request, 'DENIED');
    const result = await local(request, context);
    if (result && Object.hasOwn(result, 'code')) return acknowledge(result, request, 'COMPLETE');
    const uncertain = result.error_code === 'WRITER_EXECUTION_UNKNOWN';
    const duplicate = result.error_code === 'WRITER_ADMISSION_DENIED' && result.reason === 'ALREADY_COMPLETE';
    return acknowledge(failure(duplicate || uncertain ? 409 : 503,
      duplicate ? '该操作已执行，请刷新核对结果' : uncertain ? '操作结果待核对，请勿重复提交' : '写入暂不可用，请稍后核对',
      {operation_id: request.operationId, ...result}), request, duplicate ? 'ALREADY_COMPLETE' : 'UNKNOWN');
  };
}
module.exports = {createAdminHttpRoot, inspect, operationHeader, operationPattern};
