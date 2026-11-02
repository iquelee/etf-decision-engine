'use strict';
// Fixed isolated fixture only. HTTP and forged SDK Timer paths never open DB.
const assert = require('assert'), crypto = require('crypto');
const {isDeepStrictEqual} = require('util');
const entry = require('./writer-entry'), journal = require('./writer-admission-journal');
const adapter = require('./writer-journal-cloudbase');
const {createLocalRoot} = require('./writer-local-root');
const plan = require('./runtime24-native-proof-plan.json');
const binding = {environment: plan.environment, scope: plan.scope};
const key = Buffer.alloc(32, 27); // Public isolated fixture, never production key material.
const instance = crypto.randomBytes(12).toString('hex');
const proof = {reference: 'new-empty-native-fixture', entries_closed: true, executions_terminal: true, retries_accounted_for: true};
class ExpectedRetry extends Error {constructor() {super('EXPECTED_NATIVE_ROOT_RETRY_V1');}}
function strip(event) {
  assert(event && typeof event === 'object' && !Array.isArray(event));const e = {...event};
  for (const k of ['tcbContext', 'userInfo']) if (Object.hasOwn(e, k)) {assert.deepStrictEqual(e[k], {});delete e[k];}
  return e;
}
function createHandlers({database, runtimeIdentity, runtimeInstance, now, observe = () => {}}) {
  assert([database, runtimeIdentity, now, observe].every(f => typeof f === 'function'));
  assert(typeof runtimeInstance === 'string' && /^[a-zA-Z0-9:-]{1,100}$/.test(runtimeInstance));
  let db, store;
  function storage() {
    if (!db) {db = database();store = adapter.createStore({database: db, binding, collection: plan.collection});}
    return db.collection(plan.collection);
  }
  const checked = r => {assert(r && !r.code && typeof r.requestId === 'string' && r.requestId.length);return r;};
  async function read(id) {const r = checked(await storage().doc(id).get());assert(Array.isArray(r.data) && r.data.length <= 1);return r.data[0] || null;}
  async function create(id, row) {assert.strictEqual(checked(await storage().doc(id).create(row)).id, id);}
  async function update(id, row) {assert.strictEqual(checked(await storage().doc(id).update(row)).updated, 1);}
  const request = schedule => entry.scheduledRequest({environment: plan.environment, producer: plan.function_name,
    trigger_name: plan.timer_name, scheduled_for: schedule.scheduled_for});
  async function main(event, context) {
    const runtime = await runtimeIdentity(context);
    assert(runtime.environment === plan.environment && runtime.function_name === plan.function_name && runtime.node_major === 24);
    assert(typeof runtime.request_id === 'string' && runtime.request_id.length);
    const capsule = {environment: runtime.environment, function_name: runtime.function_name, node_major: runtime.node_major,
      trigger_source: runtime.trigger_source === undefined ? null : runtime.trigger_source,
      native_request_id: runtime.request_id, runtime_instance: runtimeInstance};
    observe(capsule);const e = strip(event);
    // Never let an HTTP body select SDK prepare/audit or database behavior.
    if (e.httpMethod || e.method) {
      const method = (e.httpMethod || e.method).toUpperCase();
      assert((e.path || e.url) === plan.http_path && ['OPTIONS', 'POST'].includes(method));
      const headers = {};
      for (const [name, value] of Object.entries(e.headers || {})) {const lower = name.toLowerCase();assert(!Object.hasOwn(headers, lower));headers[lower] = value;}
      if (method === 'OPTIONS') return {code: 0, data: {preflight: true}, message: 'ok', observation: capsule};
      assert(headers.origin === plan.http_origin && headers['x-writer-operation-id'] === plan.http_operation_id);
      const body = typeof e.body === 'string' ? JSON.parse(e.body) : e.body;
      assert.deepStrictEqual(body, {case: 'verify-native-header-v1'});
      return {code: 0, data: {header_received: true, origin_received: true}, message: 'ok',
        operation_id: plan.http_operation_id, writer_outcome: 'COMPLETE', observation: capsule};
    }
    if (e.case === 'prepare-native-root-v1') {
      assert.deepStrictEqual(Object.keys(e).sort(), ['case', 'scheduled_for']);
      assert(typeof e.scheduled_for === 'string' && new Date(e.scheduled_for).toISOString() === e.scheduled_for);
      const delta = Date.parse(e.scheduled_for) - now();assert(delta >= 120000 && delta <= 360000);
      for (const id of ['entry:schedule', 'entry:business', 'entry:attempt-0', 'entry:attempt-1', adapter.id(binding, 'control')]) assert.strictEqual(await read(id), null);
      await create('entry:schedule', {kind: 'native:schedule', scheduled_for: e.scheduled_for, request_id: request(e)});
      await create(adapter.id(binding, 'control'), adapter.encodeControl(journal.initial(binding), binding));
      assert((await journal.apply(store, binding, {type: 'activate', revision: 0, owner: 'new', proof})).ok);
      return {status: 'PREPARED', request_id: request(e), observation: capsule};
    }
    if (e.case === 'audit-native-root-v1') {
      assert.deepStrictEqual(Object.keys(e), ['case']);
      const schedule = await read('entry:schedule'), business = await read('entry:business');
      const first = await read('entry:attempt-0'), retry = await read('entry:attempt-1');
      assert(schedule && business && first && retry);
      assert(first.status === 'SUCCESS' && retry.status === 'SUCCESS');
      assert(first.event_time === schedule.scheduled_for && retry.event_time === schedule.scheduled_for);
      assert(first.request_id === request(schedule) && retry.request_id === request(schedule));
      const control = await store.read(binding);assert(control.state === 'ACTIVE' && control.active === null);
      for (const kind of ['request', 'token']) {
        const value = kind === 'request' ? request(schedule) : business.token;
        const receipt = adapter.decode(await read(adapter.id(binding, kind, value)), adapter.id(binding, kind, value), binding, kind);
        assert(receipt.status === 'COMPLETE' && receipt.request_id === request(schedule));
      }
      return {status: 'PASS', native_time_and_dedup: true, first_instance: first.runtime_instance,
        retry_instance: retry.runtime_instance, warm_sdk_rejection_requires_independent_verification: true, observation: capsule};
    }
    // Checked BEFORE storage and before parsing caller-controlled Timer identity.
    if (runtime.trigger_source !== 'timer') return {status: 'REJECTED', reason: 'NATIVE_TIMER_SOURCE_REQUIRED', observation: capsule};
    assert.deepStrictEqual(Object.keys(e).sort(), ['Message', 'Time', 'TriggerName', 'Type']);
    assert(e.Type === 'Timer' && e.TriggerName === plan.timer_name && e.Message === plan.timer_message);
    const schedule = await read('entry:schedule');assert(schedule);
    assert(typeof e.Time === 'string' && new Date(e.Time).toISOString() === schedule.scheduled_for, 'native Time mismatch');
    const first = await read('entry:attempt-0');
    if ((first && first.status !== 'SUCCESS') || await read('entry:attempt-1'))
      return {status: 'STOPPED', reason: 'PRIOR_OUTCOME_OR_DELIVERY_LIMIT', observation: capsule};
    const id = first ? 'entry:attempt-1' : 'entry:attempt-0';
    await create(id, {kind: 'native:attempt', status: 'RUNNING', event_time: schedule.scheduled_for,
      request_id: request(schedule), runtime_instance: runtimeInstance, native_request_id: runtime.request_id, trigger_source: runtime.trigger_source});
    const business = {fixture: 'native-local-root-v1'};
    const identity = () => ({request_id: request(schedule), business});
    const worker = entry.createWorker({store, binding, key, target: plan.function_name, owner: 'new', runtimeIdentity,
      loadMain: async () => async payload => {
        assert.deepStrictEqual(payload, business);
        const control = await store.read(binding);assert(control.active && control.active.request_id === request(schedule));
        await create('entry:business', {kind: 'native:business', request_id: request(schedule), token: control.active.token, runtime_instance: runtimeInstance});
        return {ok: true, fixture: business.fixture};
      }});
    const root = createLocalRoot({store, binding, key, target: plan.function_name, owner: 'new', runtimeIdentity, identify: identity, worker});
    const result = await root(e, context);
    if (!first) {
      if (!isDeepStrictEqual(result, {ok: true, fixture: business.fixture})) {
        await update(id, {status: 'FAILED'});return {status: 'STOPPED', reason: 'BUSINESS_NOT_CONFIRMED', observation: capsule};
      }
      await update(id, {status: 'SUCCESS'});throw new ExpectedRetry();
    }
    if (!result || result.reason !== 'ALREADY_COMPLETE') {
      await update(id, {status: 'FAILED'});return {status: 'STOPPED', reason: 'RETRY_NOT_DEDUPLICATED', observation: capsule};
    }
    await update(id, {status: 'SUCCESS'});return {status: 'PASS', native_retry_deduplicated: true, observation: capsule};
  }
  return {main};
}
let handlers;
async function main(event, context) {
  try {
    const sdk = require('@cloudbase/node-sdk');assert.strictEqual(sdk.version, plan.sdk_version);
    assert.strictEqual(require('@cloudbase/database/package.json').version, plan.database_version);
    if (!handlers) handlers = createHandlers({database: () => sdk.init({env: plan.environment, timeout: 15000, retries: 0,
      keepalive: false, throwOnCode: true}).database(), runtimeInstance: instance, now: () => Date.now(),
      runtimeIdentity: ctx => {const r = sdk.getCloudbaseContext();return {environment: r.TCB_ENV || r.SCF_NAMESPACE,
        function_name: ctx && ctx.function_name, request_id: ctx && ctx.request_id,
        node_major: Number(process.versions.node.split('.')[0]), trigger_source: r.TRIGGER_SRC};},
      observe: capsule => console.log('NATIVE_IDENTITY_OBSERVATION_V1 ' + JSON.stringify(capsule))});
    return await handlers.main(event, context);
  } catch (error) {
    if (error instanceof ExpectedRetry) throw error;
    return {status: 'STOPPED', reason: 'UNEXPECTED_NATIVE_PROOF_ERROR', error_code: error && error.code || 'VALIDATION_FAILED'};
  }
}
module.exports = {createHandlers, main, ExpectedRetry};
