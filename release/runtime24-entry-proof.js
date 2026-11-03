'use strict';
// Isolated fixed fixture only. No RDE, market/holding data, production imports.
const assert = require('assert');
const {isDeepStrictEqual} = require('util');
const entry = require('./writer-entry');
const journal = require('./writer-admission-journal');
const adapter = require('./writer-journal-cloudbase');
const plan = require('./runtime24-entry-proof-plan.json');
const binding = {environment: plan.environment, scope: plan.scope};
const key = Buffer.alloc(32, 7); // Deliberately public fixture, not a production credential.
const proof = {reference: 'isolated-entry-fixture', entries_closed: true, executions_terminal: true, retries_accounted_for: true};
class ExpectedRetry extends Error { constructor() { super('EXPECTED_ENTRY_TIMER_RETRY'); } }
function strip(event) {
  assert(event && typeof event === 'object' && !Array.isArray(event));
  const e = {...event};
  for (const k of ['tcbContext', 'userInfo']) if (Object.prototype.hasOwnProperty.call(e, k)) { assert.deepStrictEqual(e[k], {}); delete e[k]; }
  return e;
}
function createHandlers({database, callFunction, runtimeIdentity, sleep, now, monotonic}) {
  const store = adapter.createStore({database, collection: plan.collection, binding});
  const col = database.collection(plan.collection);
  function checked(r) { if (r && r.code) throw r; assert(r && r.requestId); return r; }
  async function read(id) {
    const r = checked(await col.doc(id).get()); assert(Array.isArray(r.data) && r.data.length <= 1);
    return r.data[0] || null;
  }
  async function create(id, row) { assert.strictEqual(checked(await col.doc(id).create(row)).id, id); }
  async function update(id, row) { assert.strictEqual(checked(await col.doc(id).update(row)).updated, 1); }
  async function runtime(context, name) {
    const r = await runtimeIdentity(context);
    assert(r.environment === plan.environment && r.function_name === name && r.node_major === 24);
    assert(typeof r.request_id === 'string' && r.request_id.length > 0); return r;
  }
  function request(schedule) {
    return entry.scheduledRequest({environment: plan.environment, producer: plan.root_name,
      trigger_name: plan.timer_name, scheduled_for: schedule.scheduled_for});
  }
  const business = {fixture: 'bounded-entry-proof-v1'};
  const expectedResult = schedule => ({ok: true, fixture: business.fixture, request_id: request(schedule)});
  const worker = entry.createWorker({store, binding, target: plan.worker_name, owner: 'new', key, runtimeIdentity,
    loadMain: async () => async (payload, context) => {
      assert.deepStrictEqual(payload, business);
      const workerRuntime = await runtime(context, plan.worker_name);
      assert(/^v24\.\d+\.\d+$/.test(workerRuntime.runtime_version));
      const schedule = await read('entry:schedule'); assert(schedule);
      assert.strictEqual(await read('entry:business'), null);
      const start = monotonic(); await sleep(plan.worker_delay_ms); const elapsed_ms = monotonic() - start;
      assert(elapsed_ms >= plan.worker_delay_ms - 1000, 'delay did not reach qualification range');
      await create('entry:business', {kind: 'entry-business', request_id: request(schedule), elapsed_ms,
        worker_runtime: workerRuntime.runtime_version, worker_native_request_id: workerRuntime.request_id});
      return expectedResult(schedule);
    }});
  const facade = entry.createFacade({store, binding, key,
    targets: {old: 'ISOLATED_DISABLED_OLD', new: plan.worker_name},
    budget: {worker_ms: 120000, transport_ms: plan.transport_timeout_ms, facade_ms: 150000, reserve_ms: plan.reserve_ms},
    identify: async () => { const schedule = await read('entry:schedule'); assert(schedule); return {request_id: request(schedule), business}; }, callFunction});
  async function workerMain(event, context) {
    await runtime(context, plan.worker_name);
    const e = strip(event), schedule = await read('entry:schedule'); assert(schedule);
    assert(e.request_id === request(schedule)); assert.deepStrictEqual(e.business, business);
    return worker(event, context);
  }
  async function rootMain(event, context) {
    const r = await runtime(context, plan.root_name), e = strip(event);
    if (e.case === plan.manual_prepare_case) {
      assert.deepStrictEqual(Object.keys(e).sort(), ['case', 'scheduled_for']);
      const due = new Date(e.scheduled_for).getTime(); assert(Number.isFinite(due));
      assert(new Date(due).toISOString() === e.scheduled_for && due % 60000 === 0);
      assert(due - now() >= 120000 && due - now() <= 360000, 'one-off occurrence outside approved relative window');
      for (const id of ['entry:schedule', 'entry:business', 'entry:attempt-0', 'entry:attempt-1']) assert.strictEqual(await read(id), null, 'fixture exists');
      assert.strictEqual(await store.read(binding), null, 'control exists');
      await create('entry:schedule', {kind: 'entry-schedule', scheduled_for: e.scheduled_for, trigger_name: plan.timer_name});
      const controlId = adapter.id(binding, 'control');
      await create(controlId, adapter.encodeControl(journal.initial(binding), binding));
      assert((await journal.apply(store, binding, {type: 'activate', owner: 'new', revision: 0, proof})).ok);
      return {status: 'PREPARED', scheduled_for: e.scheduled_for, request_id: request(e)};
    }
    if (e.case === plan.manual_audit_case) {
      assert.deepStrictEqual(e, {case: plan.manual_audit_case});
      const s = await read('entry:schedule'), first = await read('entry:attempt-0'), retry = await read('entry:attempt-1'), b = await read('entry:business');
      assert(s && first && retry && b && first.status === 'SUCCESS' && retry.status === 'SUCCESS');
      assert(first.event_time === s.scheduled_for && retry.event_time === s.scheduled_for);
      assert(first.request_id === retry.request_id && b.request_id === first.request_id);
      assert(b.elapsed_ms >= plan.worker_delay_ms - 1000);
      assert(first.forward_elapsed_ms >= b.elapsed_ms - 5 && first.forward_elapsed_ms < plan.transport_timeout_ms);
      const control = await store.read(binding); assert(control.revision === 3 && control.active === null && control.state === 'ACTIVE');
      return {status: 'PASS', scheduled_for: s.scheduled_for, logical_request_id: first.request_id,
        timer_time_matches_prepared_occurrence: true, timer_time_stable_across_native_retry: true,
        native_request_id_stable_across_retry: first.native_request_id === retry.native_request_id,
        first_native_request_id: first.native_request_id, retry_native_request_id: retry.native_request_id,
        worker_elapsed_ms: b.elapsed_ms, worker_runtime: b.worker_runtime, first_forward_elapsed_ms: first.forward_elapsed_ms,
        business_executions: 1, independent_readback_required: true};
    }
    assert.deepStrictEqual(Object.keys(e).sort(), ['Message', 'Time', 'TriggerName', 'Type']);
    assert(e.Type === 'Timer' && e.TriggerName === plan.timer_name && e.Message === plan.timer_message);
    const schedule = await read('entry:schedule'); assert(schedule);
    const eventTime = new Date(e.Time).toISOString();
    if (eventTime !== schedule.scheduled_for) {
      if (!(await read('entry:attempt-0'))) await create('entry:attempt-0', {kind: 'entry-attempt', status: 'FAILED',
        reason: 'TIMER_TIME_MISMATCH', event_time: eventTime, expected_time: schedule.scheduled_for, native_request_id: r.request_id});
      return {status: 'STOPPED', reason: 'TIMER_TIME_MISMATCH'};
    }
    const first = await read('entry:attempt-0');
    if (first && first.status !== 'SUCCESS') return {status: 'STOPPED', reason: 'PRIOR_OUTCOME_NOT_CONFIRMED'};
    if (await read('entry:attempt-1')) return {status: 'STOPPED', reason: 'DELIVERY_LIMIT'};
    const id = first ? 'entry:attempt-1' : 'entry:attempt-0';
    const row = {kind: 'entry-attempt', status: 'RUNNING', native_request_id: r.request_id,
      event_time: new Date(e.Time).toISOString(), request_id: request(schedule)};
    await create(id, row);
    let result; const forwardingStarted = monotonic();
    try { result = await facade({}, context); }
    catch (_) { await update(id, {status: 'FAILED'}); return {status: 'STOPPED', reason: 'UNEXPECTED_FORWARD_FAILURE'}; }
    if (!first) {
      if (!isDeepStrictEqual(result, expectedResult(schedule))) {
        await update(id, {status: 'FAILED', forward_error: result && result.error_code || 'INVALID_RESULT'});
        return {status: 'STOPPED', reason: 'FIRST_RESULT_NOT_CONFIRMED'};
      }
      await update(id, {status: 'SUCCESS', forward_elapsed_ms: monotonic() - forwardingStarted});
      // This is the ONLY intended error: after confirmed completion, request
      // exactly one native retry to examine event identity without redoing work.
      throw new ExpectedRetry();
    }
    if (!result || result.error_code !== 'WRITER_ADMISSION_DENIED' || result.reason !== 'ALREADY_COMPLETE') {
      await update(id, {status: 'FAILED'}); return {status: 'STOPPED', reason: 'RETRY_NOT_DEDUPLICATED'};
    }
    await update(id, {status: 'SUCCESS', forward_elapsed_ms: monotonic() - forwardingStarted});
    return {status: 'PASS', native_retry_deduplicated: true};
  }
  return {rootMain, workerMain};
}
async function main(role, event, context) {
  try {
  assert(['root', 'worker'].includes(role));
  const sdk = require('@cloudbase/node-sdk'); assert.strictEqual(sdk.version, plan.sdk_version);
  assert.strictEqual(require('@cloudbase/database/package.json').version, plan.database_version);
  const environment = sdk.getCloudbaseContext(); assert.strictEqual(environment.TCB_ENV || environment.SCF_NAMESPACE, plan.environment);
  const app = sdk.init({env: plan.environment, timeout: 15000, retries: 0, keepalive: false, throwOnCode: true});
  const handlers = createHandlers({database: app.database(), callFunction: (request, options) => app.callFunction(request, options),
    runtimeIdentity: ctx => ({environment: plan.environment, function_name: ctx && ctx.function_name,
      request_id: ctx && ctx.request_id, node_major: Number(process.versions.node.split('.')[0]), runtime_version: process.version}),
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)), now: () => Date.now(), monotonic: () => Number(process.hrtime.bigint() / 1000000n)});
  const result = await handlers[role === 'root' ? 'rootMain' : 'workerMain'](event, context);
  return {...result, runtime: process.version, sdk: plan.sdk_version};
  } catch (error) {
    if (error instanceof ExpectedRetry) throw error;
    return {status: 'STOPPED', reason: 'UNEXPECTED_PROBE_ERROR', error_code: error && error.code || 'VALIDATION_OR_RUNTIME_FAILURE', runtime: process.version};
  }
}
module.exports = {createHandlers, main};
