'use strict';
const assert = require('assert');
const crypto = require('crypto');
const g = require('./writer-admission-journal');
const adapter = require('./writer-journal-cloudbase');
const plan = require('./runtime24-journal-probe-plan.json');
const instanceMarker = crypto.randomBytes(16).toString('hex');
const proof = {reference: 'isolated-fixture-only', entries_closed: true, executions_terminal: true, retries_accounted_for: true};
const binding = scope => ({environment: plan.environment, scope: plan.scope_prefix + scope});
function validateEvent(event) {
  assert(event && typeof event === 'object' && !Array.isArray(event));
  const e = {...event};
  for (const key of Object.keys(plan.accepted_platform_metadata)) if (Object.prototype.hasOwnProperty.call(e, key)) {
    assert.deepStrictEqual(e[key], {}); delete e[key];
  }
  assert.strictEqual(e.case, 'journal-v2');
  const expected = {case: 'journal-v2', phase: e.phase};
  if (e.phase === 'race') { assert(Number.isInteger(e.contender) && e.contender >= 0 && e.contender < 8); expected.contender = e.contender; }
  else if (e.phase === 'durable') { assert(Number.isInteger(e.batch) && e.batch >= 0 && e.batch < 17); expected.batch = e.batch; }
  else assert(['initialize', 'finalize', 'unknown', 'audit'].includes(e.phase));
  assert.deepStrictEqual(e, expected); return e;
}
async function verify(database, rawEvent) {
  const event = validateEvent(rawEvent);
  const stores = Object.fromEntries(plan.scopes.map(scope => [scope, adapter.createStore({database, collection: plan.collection, binding: binding(scope)})]));
  const read = scope => stores[scope].read(binding(scope));
  const action = async (scope, a) => g.apply(stores[scope], binding(scope), {revision: (await read(scope)).revision, ...a});
  const identity = (revision, request_id, owner = 'old', epoch = 1) => ({revision, request_id, token: 'token:' + request_id, owner, epoch});
  let result;
  if (event.phase === 'initialize') {
    for (const scope of plan.scopes) assert.strictEqual(await read(scope), null, 'fixture must be absent');
    for (const scope of plan.scopes) {
      const b = binding(scope), control = g.initial(b), controlId = adapter.id(b, 'control');
      // Fixture creation is explicitly outside store/admission. Unique create,
      // no set/upsert/reset. Retain any partial failure for independent audit.
      const ack = await database.collection(plan.collection).doc(controlId).create(adapter.encodeControl(control, b));
      assert(ack && !ack.code && ack.id === controlId);
      assert((await action(scope, {type: 'activate', owner: 'old', proof})).ok);
    }
    result = {initialized: 3};
  } else if (event.phase === 'race') {
    const admitted = await g.apply(stores.race, binding('race'), {...identity(1, 'race:' + event.contender), type: 'admit'});
    result = {contender: event.contender, admitted: admitted.ok, reason: admitted.reason};
  } else if (event.phase === 'finalize') {
    const s = await read('race'); assert.strictEqual(s.revision, 2); assert(s.active);
    assert((await action('race', {...s.active, type: 'finish'})).ok);
    assert((await action('race', {type: 'drain'})).ok);
    assert((await action('race', {type: 'activate', owner: 'new', proof})).ok);
    assert.strictEqual((await g.execute(stores.race, binding('race'), identity(5, s.active.request_id, 'new', 2), () => { throw Error('duplicate entered'); })).admission, 'ALREADY_COMPLETE');
    const reused = {...identity(5, 'fresh', 'new', 2), token: s.active.token};
    assert.strictEqual((await g.execute(stores.race, binding('race'), reused, () => { throw Error('token reused'); })).admission, 'TOKEN_REUSED');
    result = {winner: s.active.request_id, epoch: 2, completed_and_duplicate_rejected: true};
  } else if (event.phase === 'durable') {
    const first = event.batch * plan.requests_per_batch;
    assert.strictEqual((await read('durable')).revision, 1 + first * 2, 'one ordered invocation per batch');
    for (let i = first; i < first + plan.requests_per_batch; i++) {
      const out = await g.execute(stores.durable, binding('durable'), identity(1 + i * 2, 'durable:' + i), () => ({fixture: true}));
      assert.strictEqual(out.outcome, 'COMPLETE');
    }
    result = {batch: event.batch, completed: first + plan.requests_per_batch};
  } else if (event.phase === 'unknown') {
    assert.strictEqual((await read('unknown')).revision, 1);
    const out = await g.execute(stores.unknown, binding('unknown'), identity(1, 'unknown'), () => { throw Error('simulated callee failure'); });
    assert.strictEqual(out.outcome, 'UNKNOWN');
    assert.strictEqual((await action('unknown', {type: 'activate', owner: 'new', proof})).reason, 'BUSY');
    result = {unknown_slot_retained: true, real_network_fault: false};
  } else {
    const race = await read('race'), durable = await read('durable'), unknown = await read('unknown');
    assert(race.revision === 5 && race.owner === 'new' && race.epoch === 2 && race.active === null);
    assert(durable.revision === 273 && durable.active === null && durable.receipts.length === 0);
    assert(unknown.revision === 3 && unknown.state === 'HOLD' && unknown.active);
    assert.strictEqual((await g.execute(stores.durable, binding('durable'), identity(273, 'durable:0'), () => { throw Error('evicted historical identity'); })).admission, 'ALREADY_COMPLETE');
    result = {race, durable, unknown, completed_durable_receipts: 136, independent_full_collection_readback_required: true};
  }
  return {ok: true, phase: event.phase, instance_marker: instanceMarker, ...result};
}
async function main(event) {
  validateEvent(event); // Reject before SDK init or any write.
  const sdk = require('@cloudbase/node-sdk');
  assert.strictEqual(require('@cloudbase/node-sdk/package.json').version, plan.sdk_version);
  assert.strictEqual(require('@cloudbase/database/package.json').version, plan.database_version);
  // Match the D-022 qualified environment parser. Do not require a particular
  // runtime context serialization shape from the invocation channel.
  const c = sdk.getCloudbaseContext();
  assert.strictEqual(c.TCB_ENV || c.SCF_NAMESPACE, plan.environment);
  const app = sdk.init({env: plan.environment, retries: 0, keepalive: false, throwOnCode: true});
  return {runtime: process.version, sdk: plan.sdk_version, database: plan.database_version, ...await verify(app.database(), event)};
}
module.exports = {main, verify, validateEvent};
