import {dispatchAcknowledgment, validateDispatch, isDispatchEndpoint} from './core-dispatch.js';
// One durable pending operation per origin. Never persists payloads or tokens.
export const OPERATION_KEY = 'etf.writer.admin-operation.v1';
export function reviewDestination(endpoint, currentUrl) {
  const route = endpoint.match(/\/api\/admin\/([^/? ]+)/)?.[1];
  const pages = {risk: 'risk', param: 'param', trade: 'trade', portfolio: 'trade', fundamental: 'fundamental',
    fetch: 'data', intel: 'data', gen1: 'gen1'};
  const target = new URL('legacy.html', currentUrl);
  target.hash = pages[route] ? '/admin/' + pages[route] : '/login';return target.href;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export class PendingOperationError extends Error {
  constructor(message = '前次操作结果待核对，请勿作为新操作重复提交') {super(message);this.name = 'PendingOperationError';this.pendingOperation = true;}
}
export function createOperationTracker({storage = () => globalThis.localStorage, crypto = () => globalThis.crypto,
  locks = () => globalThis.navigator && globalThis.navigator.locks, now = () => Date.now()} = {}) {
  let active, snapshot, rememberedId;const listeners = new Set();
  function read() {
    try {
    const raw = storage().getItem(OPERATION_KEY);if (!raw) return null;
    const record = JSON.parse(raw);
    if (!record || record.schema !== 1 || !uuid.test(record.id) || typeof record.endpoint !== 'string' ||
      !Number.isFinite(record.started_at) || !['SUBMITTING', 'UNCERTAIN', 'QUEUED'].includes(record.state) ||
      typeof record.uncertain !== 'boolean' || typeof record.review_requested !== 'boolean' ||
      Object.keys(record).sort().join(',') !== (record.state === 'QUEUED' ? 'dispatch,endpoint,id,review_requested,schema,started_at,state,uncertain' : 'endpoint,id,review_requested,schema,started_at,state,uncertain'))
      throw new PendingOperationError('操作标识记录异常，暂不能提交，请先核对已有结果');
    if (record.state === 'QUEUED') {validateDispatch(record.dispatch);if (record.uncertain || !isDispatchEndpoint(record.endpoint)) throw new PendingOperationError();}
    return record;
    } catch (_) {throw new PendingOperationError('操作标识记录不可用，暂不能提交，请先核对已有结果');}
  }
  function notify() {for (const listener of listeners) {try {listener();} catch (_) { /* view isolation */ }}}
  function write(record) {
    try {
    storage().setItem(OPERATION_KEY, JSON.stringify(record));
    if (storage().getItem(OPERATION_KEY) !== JSON.stringify(record)) throw new PendingOperationError('操作标识未能保存，未发出请求');
    notify();
    } catch (_) {throw new PendingOperationError('操作状态未能保存，请先核对结果');}
  }
  function clear(id) {
    if (read()?.id !== id) throw new PendingOperationError();
    storage().removeItem(OPERATION_KEY);
    if (storage().getItem(OPERATION_KEY) !== null) throw new PendingOperationError('操作状态未能保存，请先核对结果');
    snapshot = rememberedId = undefined;notify();
  }
  function state() {
    try {const record = read();return {record, busy: !!active, error: ''};}
    catch (_) {return {record: null, busy: !!active, error: '操作标识不可用，暂不能提交写操作'};}
  }
  function withLock(callback) {
    const provider = locks();
    if (!provider || typeof provider.request !== 'function') throw new PendingOperationError('当前浏览器无法安全协调提交，请使用支持此功能的浏览器');
    return provider.request('etf-writer-admin-operation-v1', {mode: 'exclusive', ifAvailable: true}, lock => {
      if (!lock) throw new PendingOperationError('另一页面正在提交操作，请先核对结果');
      return callback();
    });
  }
  function run(endpoint, body, send) {
    const sort = value => Array.isArray(value) ? value.map(sort) : value && typeof value === 'object' ?
      Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])])) : value;
    const serialized = JSON.stringify(sort(JSON.parse(JSON.stringify(body === undefined ? {} : body))));
    if (active) return endpoint === active.endpoint && serialized === active.serialized ? active.promise : Promise.reject(new PendingOperationError());
    let resolve, reject;const promise = new Promise((yes, no) => {resolve = yes;reject = no;});
    const previousSnapshot = snapshot;active = {endpoint, serialized, promise};notify();
    Promise.resolve().then(() => withLock(async () => {
      let record = read();
      if (record?.state === 'QUEUED') throw new PendingOperationError('任务已接单，请先核对执行结果，勿重复提交');
      if (record) {
        if (rememberedId !== record.id || previousSnapshot !== serialized || record.endpoint !== endpoint)
          throw new PendingOperationError();
      } else {
        const id = crypto().randomUUID().toLowerCase();if (!uuid.test(id)) throw new PendingOperationError('无法生成操作标识，未发出请求');
        record = {schema: 1, id, endpoint, started_at: now(), state: 'SUBMITTING', uncertain: false, review_requested: false};
      }
      rememberedId = record.id;snapshot = serialized;record = {...record, state: 'SUBMITTING'};write(record);
      let response;
      try {response = await send(record.id);}
      catch (_) {write({...record, state: 'UNCERTAIN', uncertain: true});throw new PendingOperationError('提交结果未确认，请先核对，重试会沿用本次操作标识');}
      const json = response && response.json;
      const bound = response && response.ok && json && json.operation_id === record.id && Number.isSafeInteger(json.code) &&
        Object.prototype.hasOwnProperty.call(json, 'data') && typeof json.message === 'string';
      if (bound && (json.writer_outcome === 'COMPLETE' || (json.writer_outcome === 'DENIED' && json.code >= 400 && !record.uncertain))) {
        try {
          const dispatch = json.writer_outcome === 'COMPLETE' ? dispatchAcknowledgment(json, endpoint) : null;
          if (dispatch) {write({...record,state:'QUEUED',uncertain:false,review_requested:false,dispatch});snapshot=rememberedId=undefined;return response;}
        } catch (error) {write({...record,state:'UNCERTAIN',uncertain:true});throw new PendingOperationError(error.message);}
        clear(record.id);return response;
      }
      write({...record, state: 'UNCERTAIN', uncertain: true});
      throw new PendingOperationError(json && json.message || '未收到本次操作的完成确认，请先核对结果');
    })).then(value => {active = undefined;notify();resolve(value);}, error => {active = undefined;notify();reject(error);});
    return promise;
  }
  return {run, state, subscribe(listener) {listeners.add(listener);return () => listeners.delete(listener);}, notify,
    async requestReview(id) {return withLock(() => {const record = read();if (!record || record.id !== id || active) throw new PendingOperationError();write({...record, review_requested: true});});},
    async acknowledge(id, reviewed) {return withLock(() => {const record = read();
      if (!record || record.id !== id || active || !record.review_requested || reviewed !== true) throw new PendingOperationError();clear(id);});}
  };
}
export const adminOperations = createOperationTracker();
export async function fetchAdminOperation(url, init) {
  const response = await adminOperations.run(init.method + ' ' + url, init.body ? JSON.parse(init.body) : {}, async id => {
    const controller = !init.signal && typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 20000) : null;
    try {
      const r = await fetch(url, {...init, signal: init.signal || controller?.signal,
        headers: {...init.headers, 'X-Writer-Operation-Id': id}});
      return {ok: r.ok, status: r.status, json: await r.json()};
    } finally {if (timer) clearTimeout(timer);}
  });
  return {ok: response.ok, status: response.status, json: async () => response.json};
}
if (typeof window !== 'undefined') window.addEventListener('storage', event => {if (event.key === OPERATION_KEY) adminOperations.notify();});
