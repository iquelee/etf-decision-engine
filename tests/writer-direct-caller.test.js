'use strict';
const assert = require('assert'), path = require('path');
const {createDirectCaller} = require('../release/writer-direct-caller');
const entry = require('../release/writer-entry');
const g = require('../release/writer-admission-journal');
const a = require('../release/writer-journal-cloudbase');
const {backend, fakeDatabase} = require('./writer-journal-cloudbase.test');
const {createHarness} = require('../scripts/lib/rde-offline-harness');
const binding = {environment: 'offline', scope: 'direct-rde'};
const key = Buffer.alloc(32, 9), targets = {old: 'rdeOld', new: 'rdeNode24'};
const callerName = 'materializeIndicators', logicalName = 'runDecisionEngine';
const proof = {reference: 'fixture:terminal', entries_closed: true, executions_terminal: true, retries_accounted_for: true};
const root = path.resolve(__dirname, '../cloudfunctions/runDecisionEngine'), common = path.resolve(__dirname, '../src/common');
const copy = x => JSON.parse(JSON.stringify(x));
let wrap = fn => fn;
async function setup(handler, owner = 'new') {
  const b = backend(), database = fakeDatabase(b);
  b.seed(a.id(binding, 'control'), a.encodeControl(g.initial(binding), binding));
  const store = a.createStore({database, collection: 'runtime24_journal_probe_offline', binding});
  assert((await g.apply(store, binding, {type: 'activate', revision: 0, owner, proof})).ok);
  const state = {loads: 0, calls: []};
  const worker = entry.createWorker({store, binding, key, target: targets[owner], owner,
    runtimeIdentity: () => ({environment: 'offline', function_name: targets[owner], node_major: owner === 'new' ? 24 : 16}),
    loadMain: async () => { state.loads++; return handler; }});
  function caller(id, options = {}) {
    return createDirectCaller({store, binding, key, logicalName, targets, callerName, callerNodeMajor: 16,
      runtimeIdentity: () => ({environment: 'offline', function_name: callerName, node_major: 16}),
      resolveRequestId: () => id, transportTimeoutMs: 15000,
      callFunction: wrap(async (request, opts) => {
        state.calls.push({name: request.name, options: opts});
        return {requestId: 'sdk:' + state.calls.length, result: await worker({...request.data, tcbContext: {}, userInfo: {}}, {})};
      }), ...options});
  }
  return {b, store, worker, state, caller};
}
async function test() {
  const business = {from: 'materializeIndicators', pipeline_run_id: 'existing:pipeline', force: false};
  const parent = entry.scheduledRequest({environment: binding.environment, producer: callerName,
    trigger_name: 'dailyPipeline-0800', scheduled_for: '2026-11-02T00:00:00Z'});
  const id = entry.childRequest({parent_request_id: parent, producer: callerName, action: logicalName});
  const baseline = createHarness(root, {common}), expected = await baseline.run(business); let actual;
  const f = await setup(async (event, context) => {
    actual = createHarness(root, {common}); return actual.entry.main(event, context);
  });
  const result = await f.caller(id)({name: logicalName, data: business});
  assert.deepStrictEqual(copy(result), {requestId: 'sdk:1', result: copy(expected)});
  assert.deepStrictEqual(actual.writes, baseline.writes);
  for (const name of new Set(actual.writes.map(x => x.collection))) assert.deepStrictEqual(actual.rows(name), baseline.rows(name));
  assert.strictEqual(f.state.calls.length, 1);assert.strictEqual(f.state.calls[0].name, targets.new);
  assert.deepStrictEqual(f.state.calls[0].options, {timeout: 15000, retryOptions: {retries: 0}});
  await assert.rejects(f.caller(id)({name: logicalName, data: {...business, force: true}}), e => e.code === 'WRITER_ADMISSION_DENIED' && e.reason === 'ALREADY_COMPLETE');
  assert.strictEqual(f.state.loads, 1);assert.strictEqual((await f.store.read(binding)).state, 'ACTIVE');
  const invalid = await setup(() => { throw Error('must not load'); });
  const invalidStart = invalid.b.calls.length;
  const runtimeBad = invalid.caller('bad', {runtimeIdentity: () => ({environment: 'offline', function_name: 'forged', node_major: 16})});
  await assert.rejects(runtimeBad({name: logicalName, data: business}), {code: 'WRITER_CALLER_IDENTITY_UNAVAILABLE'});
  for (const args of [[{name: 'other', data: {}}], [{name: logicalName, data: {}, target: targets.old}],
    [{name: logicalName, data: {}}, {retryOptions: {retries: 1}}], [{name: logicalName, data: {}}, {timeout: 0}]])
    await assert.rejects(invalid.caller('bad')(...args), {code: 'WRITER_CALLER_IDENTITY_UNAVAILABLE'});
  await assert.rejects(invalid.caller('')({name: logicalName, data: business}), {code: 'WRITER_CALLER_IDENTITY_UNAVAILABLE'});
  assert.strictEqual(invalid.b.calls.length, invalidStart);assert.strictEqual(invalid.state.calls.length, 0);
  // Data claiming another owner/target does not affect the signed route or the
  // captured request ID. It remains ordinary business input.
  let received;
  const old = await setup(data => { received = data; return {ok: false, error: 'business rejected'}; }, 'old');
  const payload = {...business, owner: 'new', target: targets.new, epoch: 99};
  const negative = await old.caller('captured:old')({name: logicalName, data: payload}, {timeout: 23000});
  assert.deepStrictEqual(received, payload);assert.strictEqual(old.state.calls[0].name, targets.old);
  assert.strictEqual(old.state.calls[0].options.timeout, 23000);
  assert.deepStrictEqual(negative, {requestId: 'sdk:1', result: {ok: false, error: 'business rejected'}});
  const qualifiedOwners = ['new'], limited = old.caller('captured:unqualified', {allowedOwners: qualifiedOwners});
  qualifiedOwners.push('old'); // Later configuration mutation cannot widen the captured policy.
  const priorCalls = old.state.calls.length, priorRows = old.b.rows();
  await assert.rejects(limited({name: logicalName, data: payload}), e => e.code === 'WRITER_ADMISSION_DENIED' && e.reason === 'OWNER_NOT_QUALIFIED');
  assert.strictEqual(old.state.calls.length, priorCalls);assert.deepStrictEqual(old.b.rows(), priorRows);
  for (const allowedOwners of [[], ['old', 'old'], ['other'], 'new'])
    assert.throws(() => old.caller('bad-policy', {allowedOwners}), /qualified owner policy/);
  const race = await setup(() => ({ok: true}));
  const settled = await Promise.allSettled(Array.from({length: 20}, (_, n) => race.caller('race:' + n)({name: logicalName, data: {}})));
  assert.strictEqual(settled.filter(x => x.status === 'fulfilled').length, 1);
  assert.strictEqual(race.state.loads, 1);assert.strictEqual((await race.store.read(binding)).state, 'ACTIVE');
  // Real whole RDE pauses at its first actual write. The caller loses the
  // outcome; no fallback call is made and its genuine SDK error text survives.
  let resume, entered, pending, lateHarness;
  const gate = new Promise(resolve => { resume = resolve; }), started = new Promise(resolve => { entered = resolve; });
  const late = await setup(async (event, context) => {
    lateHarness = createHarness(root, {common});let first = true;
    lateHarness.setOnWrite(async () => { if (first) {first = false;entered();await gate;} });
    return lateHarness.entry.main(event, context);
  });
  let calls = 0;const originalError = new Error('native transport lost outcome');
  const timeout = late.caller('late:one', {callFunction: wrap(async request => {
    calls++;pending = late.worker(request.data, {});await started;throw originalError;
  })});
  await assert.rejects(timeout({name: logicalName, data: business}), error => error.code === 'WRITER_EXECUTION_UNKNOWN'
    && error.hold_confirmed === true && error.message === originalError.message && error.cause === originalError);
  await assert.rejects(late.caller('late:rival')({name: logicalName, data: business}), {code: 'WRITER_ADMISSION_CLOSED'});
  assert.strictEqual(calls, 1);assert.strictEqual(lateHarness.writes.length, 0);
  resume();assert.strictEqual((await pending).outcome, 'COMPLETE');
  assert.deepStrictEqual(lateHarness.writes, baseline.writes);
  assert.strictEqual((await late.store.read(binding)).state, 'HOLD');assert.strictEqual((await late.store.read(binding)).active, null);
  const delayed = await setup(() => { throw Error('must not load'); });let wire;
  const lost = delayed.caller('delayed:one', {callFunction: wrap(async request => {wire = request.data;throw Error('delivery unknown');})});
  await assert.rejects(lost({name: logicalName, data: {}}), e => e.hold_confirmed === true);
  assert.strictEqual((await delayed.worker(wire, {})).executed, false);assert.strictEqual(delayed.state.loads, 0);
  const malformed = await setup(() => { throw Error('must not load'); });
  await assert.rejects(malformed.caller('malformed', {callFunction: wrap(async () => ({result: {result: {ok: true}}}))})({name: logicalName, data: {}}), e => e.code === 'WRITER_EXECUTION_UNKNOWN' && e.hold_confirmed);
  console.log(JSON.stringify({one_direct_call_no_facade: true, original_sdk_envelope: true,
    complete_business_writes: actual.writes.length, all_payloads_match: true, late_completion_keeps_hold: true, transport: 'MEMORY_ONLY'}));
}
async function main() {
  const args = process.argv.slice(2);if (!args.length) return test();
  assert(args.length === 4 && args[0] === '--package' && args[2] === '--file-map');
  const {verifyPackage} = require('../scripts/lib/verified-writer-package');
  const {root: packageRoot} = verifyPackage(path.resolve(args[1]), path.resolve(args[3]));
  const http = require(path.join(packageRoot, 'node_modules/@cloudbase/node-sdk/lib/utils/httpRequest'));
  const sdk = require(path.join(packageRoot, 'node_modules/@cloudbase/node-sdk/lib/functions'));
  assert.strictEqual(require(path.join(packageRoot, 'node_modules/@cloudbase/node-sdk/package.json')).version, '2.11.0');
  const original = http.default, routes = new Map();let requests = 0;
  http.default = async args => {
    requests++;assert.strictEqual(args.params.action, 'functions.invokeFunction');
    assert.strictEqual(args.opts.retryOptions.retries, 0);
    assert([15000, 23000].includes(args.opts.timeout));
    const response = await routes.get(args.config.route)({name: args.params.function_name, data: JSON.parse(args.params.request_data)}, args.opts);
    return {requestId: response.requestId, data: {response_data: JSON.stringify(response.result)}};
  };
  wrap = fn => {const route = routes.size;routes.set(route, fn);
    return (request, options) => sdk.callFunction({config: {envName: binding.environment, route, retries: 0, keepalive: false}}, request, options);};
  try {await test();verifyPackage(packageRoot, path.resolve(args[3]));console.log(JSON.stringify({sdk: '2.11.0', runtime: process.version, real_function_serializer: true, memory_requests: requests, network_requests: 0}));}
  finally {http.default = original;wrap = fn => fn;}
}
module.exports = {setup};
if (require.main === module) main().catch(error => {console.error(error);process.exitCode = 1;});
