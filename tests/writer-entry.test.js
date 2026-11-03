'use strict';
const assert = require('assert'), path = require('path');
const entry = require('../release/writer-entry');
const g = require('../release/writer-admission-journal');
const a = require('../release/writer-journal-cloudbase');
const {backend, fakeDatabase} = require('./writer-journal-cloudbase.test');
const {createHarness} = require('../scripts/lib/rde-offline-harness');
const binding = {environment: 'offline', scope: 'entry-test'};
const key = Buffer.alloc(32, 7); // Public synthetic fixture; never a deployed key.
const targets = {old: 'runDecisionEngineOld', new: 'runDecisionEngineNode24'};
const budget = {worker_ms: 120000, transport_ms: 135000, facade_ms: 150000, reserve_ms: 5000};
const proof = {reference: 'fixture:terminal', entries_closed: true, executions_terminal: true, retries_accounted_for: true};
const root = path.resolve(__dirname, '../cloudfunctions/runDecisionEngine'), common = path.resolve(__dirname, '../src/common');
const copy = x => JSON.parse(JSON.stringify(x));
let wrapTransport = fn => fn;
async function setup(handler) {
  const b = backend(), database = fakeDatabase(b);
  b.seed(a.id(binding, 'control'), a.encodeControl(g.initial(binding), binding));
  const store = a.createStore({database, collection: 'runtime24_journal_probe_offline', binding});
  assert((await g.apply(store, binding, {type: 'activate', revision: 0, owner: 'new', proof})).ok);
  const state = {loads: 0, forwards: 0};
  const worker = entry.createWorker({store, binding, target: targets.new, owner: 'new', key,
    runtimeIdentity: () => ({environment: 'offline', function_name: targets.new, node_major: 24}),
    loadMain: async () => { state.loads++; return handler; }});
  function facade(transport, identify = x => x) {
    return entry.createFacade({store, binding, targets, key, budget, identify,
      callFunction: wrapTransport(transport || (async (request, options) => {
        state.forwards++; assert.strictEqual(request.name, targets.new);
        assert.deepStrictEqual(options, {timeout: 135000, retryOptions: {retries: 0}});
        return {requestId: 'offline', result: await worker({...request.data, tcbContext: {}, userInfo: {}}, {})};
      }))});
  }
  return {b, store, worker, state, facade};
}
async function test() {
  const timer = {environment: 'offline', producer: 'materializeIndicators', trigger_name: 'dailyPipeline-0800', scheduled_for: '2026-11-02T00:00:00Z'};
  const morning = entry.scheduledRequest(timer);
  assert.strictEqual(morning, entry.scheduledRequest({...timer, scheduled_for: '2026-11-02T00:00:00.000Z'}));
  assert.notStrictEqual(morning, entry.scheduledRequest({...timer, trigger_name: 'dailyFetch-2200', scheduled_for: '2026-10-30T14:00:00Z'}));
  assert.throws(() => entry.scheduledRequest({...timer, scheduled_for: undefined}));
  assert.throws(() => entry.scheduledRequest({...timer, scheduled_for: '2026-02-31T00:00:00Z'}));
  const manual = {environment: 'offline', producer: 'adminGateway', action: 'paramChange', operation_id: 'operation:1'};
  assert.strictEqual(entry.manualRequest(manual), entry.manualRequest({...manual}));
  assert.notStrictEqual(entry.manualRequest(manual), entry.manualRequest({...manual, operation_id: 'operation:2'}));
  assert.notStrictEqual(entry.manualRequest(manual), entry.manualRequest({...manual, action: 'riskTrigger'}));
  assert.throws(() => entry.manualRequest({...manual, operation_id: ''}));
  assert.notStrictEqual(entry.childRequest({parent_request_id: morning, producer: 'rde', action: 'decision'}),
    entry.childRequest({parent_request_id: morning, producer: 'materializer', action: 'indicators'}));
  assert.throws(() => entry.budgetCheck({...budget, facade_ms: 120000}));
  assert.throws(() => entry.createFacade({store: {}, binding, targets, budget, key: Buffer.alloc(0)}));

  const business = {from: 'materializeIndicators', pipeline_run_id: 'fixture:preserved', force: false};
  const baseline = createHarness(root, {common}), expected = await baseline.run(business);
  let actual;
  const f = await setup(async (event, context) => {
    actual = createHarness(root, {common});
    return actual.entry.main(event, context);
  });
  // Reject forged direct calls BEFORE reading storage or loading business code.
  const control = await f.store.read(binding), id = {request_id: morning, business};
  const wire = entry.seal({binding, control, target: targets.new, ...id, key});
  const callsBefore = f.b.calls.length;
  for (const forged of [{...wire, business: {...business, force: true}}, {...wire, owner: 'old'},
    {...wire, epoch: 99}, {...wire, target: targets.old}, {...wire, signature: '0'},
    {...wire, userInfo: {id: 'forged'}}, {...wire, extra: true}]) {
    assert.strictEqual((await f.worker(forged, {})).admission, 'ENTRY_AUTHENTICATION_FAILED');
  }
  assert.strictEqual(f.state.loads, 0); assert.strictEqual(f.b.calls.length, callsBefore);
  const wrongRuntime = entry.createWorker({store: f.store, binding, target: targets.new, owner: 'new', key,
    runtimeIdentity: () => ({environment: 'other', function_name: targets.new, node_major: 24}), loadMain: () => { throw Error('must not load'); }});
  assert.strictEqual((await wrongRuntime(wire, {})).executed, false);
  const wrongMajor = entry.createWorker({store: f.store, binding, target: targets.new, owner: 'new', key,
    runtimeIdentity: () => ({environment: 'offline', function_name: targets.new, node_major: 16}), loadMain: () => { throw Error('must not load'); }});
  assert.strictEqual((await wrongMajor(wire, {})).executed, false);
  const facade = f.facade();
  const result = await facade({...id, owner: 'old', epoch: 999, target: targets.old}, {});
  assert.deepStrictEqual(copy(result), copy(expected), 'return exact business result, not an extra SDK/admission wrapper');
  assert.deepStrictEqual(actual.writes, baseline.writes);
  for (const name of new Set(actual.writes.map(r => r.collection))) assert.deepStrictEqual(actual.rows(name), baseline.rows(name));
  assert.strictEqual(f.state.loads, 1); assert.strictEqual(f.state.forwards, 1);
  const duplicate = await facade(id, {});
  assert.strictEqual(duplicate.reason, 'ALREADY_COMPLETE'); assert.strictEqual(f.state.loads, 1);
  assert.strictEqual((await facade({...id, business: {...business, force: true}}, {})).error_code, 'WRITER_ADMISSION_DENIED');
  assert.strictEqual(f.state.loads, 1, 'same request ID with changed payload cannot execute');
  assert.strictEqual((await facade({}, {})).error_code, 'WRITER_IDENTITY_UNAVAILABLE');

  const negativeBusiness = {ok: false, error: 'business validation failed'};
  const failed = await setup(() => negativeBusiness);
  assert.deepStrictEqual(await failed.facade()({request_id: 'manual:failure', business: {}}, {}), negativeBusiness);
  assert.strictEqual((await failed.store.read(binding)).active, null, 'normal business failure is terminal');

  const race = await setup(() => ({ok: true}));
  const concurrentFacade = race.facade();
  const contenders = await Promise.all(Array.from({length: 20}, (_, i) => concurrentFacade({request_id: 'race:' + i, business: {}}, {})));
  assert.strictEqual(contenders.filter(r => r.ok === true).length, 1);
  assert.strictEqual(race.state.loads, 1);
  assert.strictEqual((await race.store.read(binding)).state, 'ACTIVE', 'known conflicting aborts must not HOLD the winner');

  const lost = await setup(() => { throw Error('must not load'); });
  lost.b.fault = {action: 'database.commitTransaction', after: true, throw: true};
  const lostResult = await lost.facade()({request_id: 'lost:admission', business: {}}, {});
  assert.strictEqual(lostResult.error_code, 'WRITER_EXECUTION_UNKNOWN'); assert.strictEqual(lostResult.hold_confirmed, true);
  assert.strictEqual(lost.state.loads, 0);
  assert((await lost.store.read(binding)).active, 'ambiguous admission keeps the committed slot');

  // Real whole entry pauses at its first config write. The transport times out,
  // while the worker remains alive. HOLD survives its eventual normal finish.
  let resume, entered, pending, runningFixture;
  const gate = new Promise(resolve => { resume = resolve; }), started = new Promise(resolve => { entered = resolve; });
  const late = await setup(async (event, context) => {
    runningFixture = createHarness(root, {common}); let first = true;
    runningFixture.setOnWrite(async () => { if (first) { first = false; entered(); await gate; } });
    return runningFixture.entry.main(event, context);
  });
  let forwards = 0;
  const timeout = late.facade(async request => {
    forwards++; pending = late.worker(request.data, {}); await started; throw Error('simulated caller timeout');
  });
  const unknown = await timeout({request_id: 'late:one', business}, {});
  assert.strictEqual(unknown.error_code, 'WRITER_EXECUTION_UNKNOWN'); assert.strictEqual(unknown.hold_confirmed, true);
  assert.strictEqual((await late.store.read(binding)).state, 'HOLD');
  assert.strictEqual((await timeout({request_id: 'late:rival', business}, {})).error_code, 'WRITER_ADMISSION_CLOSED');
  assert.strictEqual(forwards, 1); assert.strictEqual(runningFixture.writes.length, 0);
  resume(); assert.strictEqual((await pending).outcome, 'COMPLETE');
  assert.deepStrictEqual(runningFixture.writes, baseline.writes);
  assert.strictEqual((await late.store.read(binding)).state, 'HOLD'); assert.strictEqual((await late.store.read(binding)).active, null);

  const delayed = await setup(() => { throw Error('must not load'); }); let delayedWire;
  const notStarted = delayed.facade(async request => { delayedWire = request.data; throw Error('unknown delivery'); });
  assert.strictEqual((await notStarted({request_id: 'delayed:one', business: {}}, {})).hold_confirmed, true);
  assert.strictEqual((await delayed.worker(delayedWire, {})).executed, false, 'delivery after HOLD cannot start work');
  assert.strictEqual(delayed.state.loads, 0);

  const malformed = await setup(() => { throw Error('must not run'); }); let calls = 0;
  const invalid = malformed.facade(async () => { calls++; return {result: {result: {ok: true}}}; });
  assert.strictEqual((await invalid({request_id: 'bad:response', business: {}}, {})).error_code, 'WRITER_EXECUTION_UNKNOWN');
  assert.strictEqual(calls, 1); assert.strictEqual(malformed.state.loads, 0);
  assert.strictEqual((await malformed.store.read(binding)).state, 'HOLD');
  console.log(JSON.stringify({scheduled_and_manual_identity: true, authenticated_lazy_worker: true,
    whole_entry_writes: actual.writes.length, business_payload_and_all_writes_match: true,
    late_worker_holds_after_transport_timeout: true, transport: 'MEMORY_ONLY', production_imports: false}));
}
async function main() {
  const args = process.argv.slice(2);
  if (!args.length) return test();
  assert(args.length === 4 && args[0] === '--package' && args[2] === '--file-map');
  const {verifyPackage} = require('../scripts/lib/verified-writer-package');
  const {root: packageRoot} = verifyPackage(path.resolve(args[1]), path.resolve(args[3]));
  assert.strictEqual(require(path.join(packageRoot, 'node_modules/@cloudbase/node-sdk/package.json')).version, '2.11.0');
  const http = require(path.join(packageRoot, 'node_modules/@cloudbase/node-sdk/lib/utils/httpRequest'));
  const sdk = require(path.join(packageRoot, 'node_modules/@cloudbase/node-sdk/lib/functions'));
  const original = http.default, routes = new Map(); let requests = 0;
  http.default = async args => {
    requests++;
    assert.strictEqual(args.params.action, 'functions.invokeFunction');
    assert.strictEqual(args.config.retries, 0); assert.strictEqual(args.config.keepalive, false);
    assert.deepStrictEqual(args.opts, {timeout: 135000, retryOptions: {retries: 0}});
    const response = await routes.get(args.config.transportId)({name: args.params.function_name, data: JSON.parse(args.params.request_data)}, args.opts);
    return {requestId: response.requestId || 'offline', data: {response_data: JSON.stringify(response.result)}};
  };
  wrapTransport = transport => {
    const transportId = routes.size; routes.set(transportId, transport);
    const cloudbase = {config: {envName: binding.environment, retries: 0, keepalive: false, timeout: 135000, transportId}};
    return (request, options) => sdk.callFunction(cloudbase, request, options);
  };
  try {
    assert.strictEqual(new http.Request({config: {timeout: 15000}, opts: {timeout: 135000}, params: {}}).getTimeout(), 135000);
    await test();
    verifyPackage(packageRoot, path.resolve(args[3]));
    console.log(JSON.stringify({runtime: process.version, sdk: '2.11.0', real_call_function_serializer: true,
      explicit_timeout_override_ms: 135000, memory_function_requests: requests, network_requests: 0}));
  } finally { http.default = original; wrapTransport = fn => fn; }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
