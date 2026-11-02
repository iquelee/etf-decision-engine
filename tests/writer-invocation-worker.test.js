'use strict';
const assert = require('assert'), path = require('path');
const {createInvocationWorker} = require('../release/writer-invocation-worker');
const {createAdminMaintenanceCheck} = require('../release/writer-admin-maintenance');
const entry = require('../release/writer-entry'), g = require('../release/writer-admission-journal');
const a = require('../release/writer-journal-cloudbase');
const {backend, fakeDatabase} = require('./writer-journal-cloudbase.test');
const {createHarness} = require('../scripts/lib/rde-offline-harness');
const environment = 'offline', key = Buffer.alloc(32, 8), childKey = Buffer.alloc(32, 9);
const parentBinding = {environment, scope: 'parent'}, childBinding = {environment, scope: 'child'};
const target = 'materializer24', childTarget = 'rde24';
const proof = {reference: 'fixture:terminal', entries_closed: true, executions_terminal: true, retries_accounted_for: true};
let sdkFactory = bridge => ({version: 'synthetic', init: config => ({config: {timeout: 15000, ...config},
  database() {assert.strictEqual(this.config.timeout, 15000);return 'same-database';}, callFunction: bridge})});
async function makeStore(binding, owner = 'new') {
  const b = backend(), database = fakeDatabase(b);
  b.seed(a.id(binding, 'control'), a.encodeControl(g.initial(binding), binding));
  const store = a.createStore({database, binding, collection: 'runtime24_journal_probe_offline'});
  assert((await g.apply(store, binding, {type: 'activate', revision: 0, owner, proof})).ok);
  return {b, store};
}
async function setup(handler, childMain = async data => data, extras = {}) {
  const parentOwner = extras.owner || 'new', parentTarget = extras.target || target;
  const parent = await makeStore(parentBinding, parentOwner), child = await makeStore(childBinding);
  const state = {calls: [], loads: 0, childLoads: 0};
  const worker = entry.createWorker({store: child.store, binding: childBinding, key: childKey, target: childTarget, owner: 'new',
    runtimeIdentity: () => ({environment, function_name: childTarget, node_major: 24}),
    loadMain: async () => {state.childLoads++;return childMain;}});
  const sdk = sdkFactory(async (request, options) => {
      state.calls.push({name: request.name, request_id: request.data.request_id, options});
      return {requestId: 'sdk:' + state.calls.length, result: await worker(request.data, {})};
    });
  const originalInit = sdk.init;
  const service = createInvocationWorker({sdk, store: parent.store, binding: parentBinding, key, target: parentTarget, owner: parentOwner,
    producer: 'materializeIndicators', runtimeIdentity: c => c,
    childRoutes: {runDecisionEngine: {store: child.store, binding: childBinding, key: childKey, action: 'decision',
      targets: {old: 'rdeOld', new: childTarget}, transportTimeoutMs: 15000}},
    loadMain: async wrapped => {state.loads++;return (business, context) => handler(wrapped.init({}), business, context);}, ...extras});
  assert.strictEqual(sdk.init, originalInit, 'original SDK exports not mutated');
  assert(service.sdk.init({}).database(), 'SDK methods bind to original app');
  if (typeof sdk.getCloudbaseContext === 'function') assert(service.sdk.getCloudbaseContext());
  const runtime = {environment, function_name: parentTarget, node_major: parentOwner === 'new' ? 24 : 16};
  async function wire(id, business = {}) {
    return entry.seal({binding: parentBinding, key, target: parentTarget, control: await parent.store.read(parentBinding), request_id: id, business});
  }
  return {parent, child, state, service, runtime, wire};
}
const copy = x => JSON.parse(JSON.stringify(x));
async function test() {
  const f = await setup((app, data) => app.callFunction({name: 'runDecisionEngine', data}), data => ({ok: false, original: data}));
  const result = await f.service.main(await f.wire('root:one', {from: 'original', request_id: 'forged'}), f.runtime);
  assert.strictEqual(result.outcome, 'COMPLETE', JSON.stringify(result));
  assert.deepStrictEqual(result.result, {requestId: 'sdk:1', result: {ok: false, original: {from: 'original', request_id: 'forged'}}});
  assert.strictEqual(f.state.calls[0].request_id, entry.childRequest({parent_request_id: 'root:one', producer: 'materializeIndicators', action: 'decision'}));
  assert.strictEqual((await f.parent.store.read(parentBinding)).active, null);
  assert.strictEqual((await f.child.store.read(childBinding)).active, null, 'separate parent/child scopes do not deadlock');
  const old = await setup(app => app.callFunction({name: 'runDecisionEngine', data: {}}), undefined,
    {owner: 'old', target: 'materializerOld'});
  assert.strictEqual((await old.service.main(await old.wire('root:old'), old.runtime)).outcome, 'COMPLETE');
  assert.strictEqual(old.state.calls[0].name, childTarget, 'old caller can directly use the selected new child worker');
  let warmApp;
  const warm = await setup(app => {if (!warmApp) warmApp = app;return warmApp.callFunction({name: 'runDecisionEngine', data: {}});});
  for (const id of ['root:warm1', 'root:warm2']) assert.strictEqual((await warm.service.main(await warm.wire(id), warm.runtime)).outcome, 'COMPLETE');
  assert.strictEqual(warm.state.calls.length, 2);assert.notStrictEqual(warm.state.calls[0].request_id, warm.state.calls[1].request_id);
  assert.strictEqual(warmApp.config.request_id, undefined, 'warm SDK config never stores invocation identity');
  let open = false;
  const check = createAdminMaintenanceCheck({binding: {environment, scope: 'rollout'},
    readRollout: async () => ({schema: 1, environment, scope: 'rollout', revision: 1, state: open ? 'OPEN' : 'CLOSED'})});
  const gated = await setup(() => ({code: 0}), undefined, {producer: 'adminGateway', beforeAdmission: check});
  const gateWire = await gated.wire('root:retry-after-maintenance', {method: 'POST', path: '/api/admin/risk'});
  const callsBeforeGate = gated.parent.b.calls.length;
  assert.strictEqual((await gated.service.main(gateWire, gated.runtime)).admission, 'ENTRY_GATE_CLOSED');
  assert.strictEqual(gated.parent.b.calls.length, callsBeforeGate);assert.strictEqual(gated.state.loads, 0);
  open = true;assert.strictEqual((await gated.service.main(gateWire, gated.runtime)).outcome, 'COMPLETE', 'denied ID was not burned by a maintenance response');
  await assert.rejects(f.service.sdk.init({}).callFunction({name: 'runDecisionEngine', data: {}}), {code: 'WRITER_INVOCATION_UNAVAILABLE'});
  const invalid = await f.wire('bad');const before = f.parent.b.calls.length;
  const forged = await f.service.main({...invalid, business: {force: true}}, f.runtime);
  assert.strictEqual(forged.admission, 'ENTRY_AUTHENTICATION_FAILED');assert.strictEqual(f.parent.b.calls.length, before);
  assert.strictEqual((await f.service.main(invalid, {...f.runtime, node_major: 16})).admission, 'ENTRY_AUTHENTICATION_FAILED');
  // Two overlapping authenticated invocations. The denied rival must not
  // overwrite or clear the first invocation's identity before its child call.
  let entered, resume;
  const started = new Promise(resolve => {entered = resolve;}), gate = new Promise(resolve => {resume = resolve;});
  const concurrent = await setup(async app => {entered();await gate;return app.callFunction({name: 'runDecisionEngine', data: {}});});
  const running = concurrent.service.main(await concurrent.wire('root:first'), concurrent.runtime);await started;
  const rejected = await concurrent.service.main(await concurrent.wire('root:rival'), concurrent.runtime);
  assert.strictEqual(rejected.executed, false);resume();assert.strictEqual((await running).outcome, 'COMPLETE');
  assert.strictEqual(concurrent.state.calls[0].request_id, entry.childRequest({parent_request_id: 'root:first', producer: 'materializeIndicators', action: 'decision'}));
  // Detached source path: a parent's normal return cannot claim COMPLETE if
  // its child is still running. The unresolved parent stays occupied/HOLD.
  let finishChild, startedChild;
  const childGate = new Promise(resolve => {finishChild = resolve;}), childStarted = new Promise(resolve => {startedChild = resolve;});
  let detachedCall;
  const detached = await setup(app => {detachedCall = app.callFunction({name: 'runDecisionEngine', data: {}});return {triggered: true};},
    async () => {startedChild();await childGate;return {ok: true};});
  const detachedResult = await detached.service.main(await detached.wire('root:detached'), detached.runtime);
  await childStarted;assert.strictEqual(detachedResult.outcome, 'UNKNOWN');
  assert(!Object.prototype.hasOwnProperty.call(detachedResult, 'result'), 'detached triggered:true is not a COMPLETE acknowledgement');
  const held = await detached.parent.store.read(parentBinding);assert.strictEqual(held.state, 'HOLD');assert(held.active);
  finishChild();await detachedCall;
  assert.strictEqual((await detached.parent.store.read(parentBinding)).state, 'HOLD');
  assert((await detached.parent.store.read(parentBinding)).active, 'child late finish never releases parent UNKNOWN');
  // Catching a child failure inside old business code cannot hide it from the
  // invocation coordinator and manufacture a COMPLETE execution receipt.
  const undeclared = await setup(async app => {try {await app.callFunction({name: 'unlisted', data: {}});} catch (_) {} return {ok: true};});
  assert.strictEqual((await undeclared.service.main(await undeclared.wire('root:unlisted'), undeclared.runtime)).outcome, 'UNKNOWN');
  assert.strictEqual(undeclared.state.calls.length, 0);
  let savedApp;
  const expired = await setup(app => {savedApp = app;return {ok: true};});
  assert.strictEqual((await expired.service.main(await expired.wire('root:expired'), expired.runtime)).outcome, 'COMPLETE');
  await assert.rejects(savedApp.callFunction({name: 'runDecisionEngine', data: {}}), {code: 'WRITER_INVOCATION_UNAVAILABLE'});
  let lateAttempt;
  const callback = await setup(app => {
    lateAttempt = new Promise(resolve => setImmediate(() => app.callFunction({name: 'runDecisionEngine', data: {}})
      .then(() => resolve('unexpected'), error => resolve(error.code))));
    return {ok: true};
  });
  assert.strictEqual((await callback.service.main(await callback.wire('root:callback'), callback.runtime)).outcome, 'COMPLETE');
  assert.strictEqual(await lateAttempt, 'WRITER_INVOCATION_UNAVAILABLE');assert.strictEqual(callback.state.calls.length, 0);
  const sameScope = await makeStore(parentBinding);
  assert.throws(() => createInvocationWorker({sdk: {init() {}},store: sameScope.store,binding: parentBinding,key,target,owner: 'new',producer: 'p',
    runtimeIdentity: () => ({}),loadMain: () => {},childRoutes: {child: {binding: parentBinding}}}), /same scope/);
  // Actual whole materializer + RDE, sharing memory business storage.
  const repo = path.resolve(__dirname, '..'), common = path.join(repo, 'src/common');let h, childMain;
  const whole = await setup(async (_app, business, context) => h.entry.main(business, context),
    (business, context) => childMain.main(business, context));
  h = createHarness(path.join(repo, 'cloudfunctions/materializeIndicators'), {common,
    entries: [{root: path.join(repo, 'cloudfunctions/runDecisionEngine'), common}],
    callFunction: (request, options) => whole.service.sdk.init({}).callFunction(copy(request), options)});
  childMain = h.load(path.join(repo, 'cloudfunctions/runDecisionEngine/index.js'));
  const baseline = createHarness(path.join(repo, 'cloudfunctions/materializeIndicators'), {common,
    entries: [{root: path.join(repo, 'cloudfunctions/runDecisionEngine'), common}],
    callFunction: async request => ({requestId: 'sdk:1',result: await baselineChild.main(request.data, {})})});
  const baselineChild = baseline.load(path.join(repo, 'cloudfunctions/runDecisionEngine/index.js'));
  const expected = await baseline.run({}), actual = await whole.service.main(await whole.wire('root:materializer'), whole.runtime);
  assert.strictEqual(actual.outcome, 'COMPLETE');assert.deepStrictEqual(copy(actual.result), copy(expected));
  assert.deepStrictEqual(h.writes, baseline.writes);
  for (const name of new Set(h.writes.map(x => x.collection))) assert.deepStrictEqual(h.rows(name), baseline.rows(name));
  console.log(JSON.stringify({authenticated_context: true, overlapping_invocations_isolated: true,
    same_scope_nested_entry_rejected: true, detached_or_failed_children_keep_parent_unknown: true,
    whole_materializer_rde_writes: h.writes.length, all_returns_and_rows_match: true, transport: 'MEMORY_ONLY'}));
}
async function main() {
  const args = process.argv.slice(2);if (!args.length) return test();
  assert(args.length === 4 && args[0] === '--package' && args[2] === '--file-map');
  const {verifyPackage} = require('../scripts/lib/verified-writer-package');
  const {root: packageRoot} = verifyPackage(path.resolve(args[1]), path.resolve(args[3]));
  const sdk = require(path.join(packageRoot, 'node_modules/@cloudbase/node-sdk'));
  const http = require(path.join(packageRoot, 'node_modules/@cloudbase/node-sdk/lib/utils/httpRequest'));
  assert.strictEqual(sdk.version, '2.11.0');const initBefore = sdk.init, httpBefore = http.default;
  const bridges = new Map();let requests = 0;
  sdkFactory = bridge => {
    const route = bridges.size;bridges.set(route, bridge);
    const facade = Object.create(sdk);
    facade.init = config => sdk.init({env: 'offline', secretId: 'fixture', secretKey: 'fixture', ...config, route});
    return facade;
  };
  http.default = async args => {
    requests++;assert.strictEqual(args.params.action, 'functions.invokeFunction');assert.strictEqual(args.opts.timeout, 15000);
    assert.strictEqual(args.opts.retryOptions.retries, 0);
    const response = await bridges.get(args.config.route)({name: args.params.function_name, data: JSON.parse(args.params.request_data)}, args.opts);
    return {requestId: response.requestId, data: {response_data: JSON.stringify(response.result)}};
  };
  try {await test();assert.strictEqual(sdk.init, initBefore);verifyPackage(packageRoot, path.resolve(args[3]));
    console.log(JSON.stringify({runtime: process.version, sdk: '2.11.0', original_sdk_init_unchanged: true,
      real_init_and_function_serializers: true, memory_function_requests: requests, network_requests: 0}));}
  finally {http.default = httpBefore;}
}
main().catch(error => {console.error(error);process.exitCode = 1;});
