'use strict';
const assert = require('assert');
const {createInvocationWorker} = require('../release/writer-invocation-worker');
const plan = require('../release/writer-dispatch-plan');
const outbox = require('../release/writer-dispatch-cloudbase');
const ledger = require('../release/writer-journal-cloudbase');
const journal = require('../release/writer-admission-journal');
const entry = require('../release/writer-entry');
const {backend, fakeDatabase} = require('./writer-journal-cloudbase.test');
const clone = x => JSON.parse(JSON.stringify(x));
const key = Buffer.alloc(32, 83), binding = plan.parentBinding, target = 'adminGatewayNode24';
async function fixture(handler, wrap = store => store) {
  const b = backend(JSON, outbox.collection), database = fakeDatabase(b, plan.environment, outbox.collection);
  const store = ledger.createProductionStore({database, binding});
  b.seed(ledger.id(binding, 'control'), ledger.encodeControl(journal.initial(binding), binding));
  assert((await journal.apply(store, binding, {type: 'activate', revision: 0, owner: 'new',
    proof: {reference: 'fixture:enqueue', entries_closed: true, executions_terminal: true, retries_accounted_for: true}})).ok);
  const dispatch = outbox.createStore({database});let nativeCalls = 0;
  const service = createInvocationWorker({producer: 'adminGateway', owner: 'new', binding, target, key, store,
    beforeAdmission: async () => true, childRoutes: {}, dispatchStore: wrap(dispatch),
    sdk: {init: () => ({database: () => database, callFunction: async () => {nativeCalls++;throw Error('NATIVE_TRANSPORT_FORBIDDEN');}})},
    runtimeIdentity: () => ({environment: plan.environment, function_name: target, node_major: 24}),
    loadMain: async sdk => (business, context) => handler(sdk.init({}), business, context)});
  const wire = entry.seal({binding, key, target, control: await store.read(binding), request_id: 'manual:enqueue', business: {fixture: true}});
  return {b, database, store, dispatch, service, wire, calls: () => nativeCalls,
    run: () => service.main(clone(wire), {})};
}
const request = {name: 'fetchDailyData', data: {force: true, task_name: 'daily'}};
async function main() {
  let release, started;
  const gate = new Promise(resolve => {release = resolve;}), entered = new Promise(resolve => {started = resolve;});
  const f = await fixture(app => {app.callFunction(request).catch(() => {});return {code: 0, data: {triggered: true}};}, store => ({
    async prepare(spec) {const ack = await store.prepare(spec);started();await gate;return ack;}
  }));
  const running = f.run();await entered;
  const occupied = await f.store.read(binding);assert(occupied.active);assert.strictEqual(occupied.receipts[0].status, 'RUNNING');
  const rows = f.b.rows().filter(r => r.kind === 'dispatch');assert.strictEqual(rows.length, 1);
  const job = outbox.decode(rows[0], rows[0]._id);assert.strictEqual(job.state, 'PREPARED');
  assert.strictEqual(f.calls(), 0);release();
  const done = await running;assert.strictEqual(done.outcome, 'COMPLETE');assert.strictEqual(done.result.writer_dispatch.state, 'QUEUED');
  assert.strictEqual(done.result.data.triggered, true);assert.strictEqual((await f.store.read(binding)).active, null);
  const receipts = f.b.rows().filter(r => ['request','token'].includes(r.kind));assert(receipts.every(r => JSON.parse(r.payload_json).status === 'COMPLETE'));
  const count = f.b.calls.length;assert.strictEqual((await f.run()).admission, 'ALREADY_COMPLETE');
  assert.strictEqual(f.b.rows().filter(r => r.kind === 'dispatch').length, 1);assert.strictEqual(f.calls(), 0);
  assert(!f.b.calls.slice(count).some(c => ['database.insertDocument','database.modifyDocument'].includes(c.action)));
  for (const after of [false, true]) {
    let callbackStarted, callbackRelease;
    const callbackGate = new Promise(resolve => {callbackRelease = resolve;}), callbackEntered = new Promise(resolve => {callbackStarted = resolve;});
    const failure = await fixture(app => {
      app.callFunction(request).catch(async () => {callbackStarted();await callbackGate;});return {code: 0};
    }, store => ({async prepare(spec) {
      // Inject specifically into durable prepare, not parent admission/finish.
      const b = failure.b;b.fault = {action: 'database.commitTransaction', after, throw: true};return store.prepare(spec);
    }}));
    const task = failure.run();await callbackEntered;
    assert.strictEqual((await failure.store.read(binding)).state, 'ACTIVE', 'parent cannot finalize before its async rejection callback settles');
    assert((await failure.store.read(binding)).active);callbackRelease();
    assert.strictEqual((await task).outcome, 'UNKNOWN');assert.strictEqual((await failure.store.read(binding)).state, 'HOLD');
    assert.strictEqual(failure.b.rows().filter(r => r.kind === 'dispatch').length, after ? 1 : 0);assert.strictEqual(failure.calls(), 0);
  }
  const chain = await fixture(app => {
    app.callFunction(request).then(value => {assert(value.result.queued);return 'accepted';}).finally(async () => {await Promise.resolve();});
    return {code: 0};
  });
  assert.strictEqual((await chain.run()).outcome, 'COMPLETE');assert.strictEqual(chain.calls(), 0);
  const businessFailure = await fixture(app => {app.callFunction(request).catch(() => {});throw Error('business failed after prepare started');});
  assert.strictEqual((await businessFailure.run()).outcome, 'UNKNOWN');assert.strictEqual((await businessFailure.store.read(binding)).state, 'HOLD');
  for (const invalid of [{...request, name: 'runGen1ShadowEod'}, {...request, name: 'runGen2ShadowEod'},
    {...request, data: {...request.data, task_name: 'unknown'}}]) {
    const rejected = await fixture(app => {app.callFunction(invalid).catch(() => {});return {code: 0};});
    assert.strictEqual((await rejected.run()).outcome, 'UNKNOWN');assert.strictEqual(rejected.calls(), 0);
    assert.strictEqual(rejected.b.rows().filter(r => r.kind === 'dispatch').length, 0);
  }
  const duplicate = await fixture(app => {app.callFunction(request).catch(() => {});app.callFunction(request).catch(() => {});return {code: 0};});
  assert.strictEqual((await duplicate.run()).outcome, 'UNKNOWN');assert.strictEqual(duplicate.calls(), 0);
  console.log('Core enqueue runtime: await durable ACK and callback chains before parent COMPLETE; unknown HOLD, no inline transport, stable receipts PASS (MODEL_ONLY)');
}
if (require.main === module) main().catch(error => {console.error(error);process.exitCode = 1;});
