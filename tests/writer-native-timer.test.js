'use strict';
const assert = require('assert'), path = require('path');
const {createTimerIdentity, policies, message} = require('../release/writer-timer-identity');
const {createLocalRoot} = require('../release/writer-local-root');
const adapter = require('../release/writer-journal-cloudbase'), journal = require('../release/writer-admission-journal');
const entry = require('../release/writer-entry');
const {fixture} = require('./writer-worker-bootstrap.test');
const {createHarness} = require('../scripts/lib/rde-offline-harness');
const env = adapter.productionNamespace.environment, key = Buffer.alloc(32, 11);
const proof = {reference: 'fixture:terminal', entries_closed: true, executions_terminal: true, retries_accounted_for: true};
const copy = value => JSON.parse(JSON.stringify(value));
const event = (TriggerName = 'dailyPipeline-0800', Time = '2026-10-29T00:00:00Z') => ({Type: 'Timer', TriggerName, Time, Message: message});
async function main() {
  const dates = {'dailyFetch-2200': '2026-10-29T14:00:00Z', 'dailyPipeline-0800': '2026-10-29T00:00:00Z',
    'realtime-5min': '2026-10-29T01:05:00Z', 'gen1-eod-weekdays-2220': '2026-10-29T14:20:00Z',
    'gen2-eod-weekdays-2230': '2026-10-29T14:30:00Z', 'newsFetch-1630': '2026-10-29T08:30:00Z',
    'intelFetch-30min': '2026-10-29T08:30:00Z', 'newsExtract-1640': '2026-10-29T08:40:00Z',
    'intelExtract-30min': '2026-10-29T08:35:00Z'};
  const ids = new Set();let timerCases = 0;
  for (const [producer, triggers] of Object.entries(policies)) {
    const target = producer + 'Node24';
    let runtime = {environment: env, function_name: target, node_major: 24, trigger_source: 'timer'};
    const identify = createTimerIdentity({environment: env, producer, target, runtimeIdentity: () => runtime});
    for (const name of Object.keys(triggers)) {
      const input = event(name, dates[name]);const identity = await identify(input, {});timerCases++;
      assert.deepStrictEqual(identity.business, input);assert(!ids.has(identity.request_id));ids.add(identity.request_id);
      assert.strictEqual((await identify({...input, Time: input.Time.replace('Z', '.000Z')}, {request_id: 'different-attempt'})).request_id, identity.request_id);
      assert.notStrictEqual((await identify({...input, Time: input.Time.replace('2026-10-29', '2026-10-30')}, {})).request_id, identity.request_id);
      const prior = runtime;runtime = {...runtime, trigger_source: 'sdk'};
      await assert.rejects(identify(input, {}), /native timer/);runtime = prior;
      for (const bad of [{...input, force: true}, {...input, Message: ''}, {...input, TriggerName: 'unregistered'},
        {...input, Time: input.Time.replace(':00Z', ':01Z')}, {...input, Time: '2026-02-30T00:00:00Z'},
        {...input, Time: input.Time.replace('Z', '+00:00')}, {...input, tcbContext: {TRIGGER_SRC: 'timer'}}])
        await assert.rejects(identify(bad, {}));
    }
  }
  assert.strictEqual(timerCases, 9);assert.strictEqual(ids.size, 9);
  const f = await fixture('materializeIndicators'), native = event();
  const before = f.b.calls.length;
  assert.strictEqual((await f.bootstrap.main(native, f.context)).executed, false);
  assert.strictEqual(f.b.calls.length, before);assert.strictEqual(f.state.inits.length, 0);
  f.state.triggerSource = 'timer';
  f.state.node = 22;assert.strictEqual((await f.bootstrap.main(native, f.context)).executed, false);f.state.node = 24;
  for (const bad of [{...native, force: true}, {...native, request_id: 'forged'}, {...native, Message: ''},
    {...native, Time: '2026-10-31T00:00:00Z'}, {...native, Time: '2026-10-29T00:01:00Z'}])
    assert.strictEqual((await f.bootstrap.main(bad, f.context)).executed, false);
  assert.strictEqual(f.b.calls.length, before);
  assert(f.state.contextArguments.every(args => args.length === 0));
  const result = await f.bootstrap.main(native, f.context);
  assert.deepStrictEqual(result, {ok: false, echoed: native}, 'original business ok:false unwrapped once');
  assert.strictEqual(f.state.loads, 1);
  const writes = f.b.calls.filter(c => /insert|modify/.test(c.action)).length;
  assert.strictEqual((await f.bootstrap.main({...native, Time: '2026-10-29T00:00:00.000Z'}, {...f.context, request_id: 'native:retry'})).reason, 'ALREADY_COMPLETE');
  assert.strictEqual(f.b.calls.filter(c => /insert|modify/.test(c.action)).length, writes);
  assert.strictEqual(f.state.loads, 1);
  const priorControl = await f.store.read(f.binding);
  assert((await journal.apply(f.store, f.binding, {type: 'hold', revision: priorControl.revision})).ok);
  const held = await f.store.read(f.binding);
  assert((await journal.apply(f.store, f.binding, {type: 'activate', owner: 'old', revision: held.revision, proof})).ok);
  assert.strictEqual((await f.bootstrap.main(event(undefined, '2026-10-30T00:00:00Z'), f.context)).error_code, 'WRITER_ADMISSION_CLOSED');
  assert.strictEqual(f.state.loads, 1, 'never forwards to old implementation');
  const unknown = await fixture('materializeIndicators');unknown.state.triggerSource = 'timer';
  unknown.state.handler = async () => {throw Error('handler outcome unknown');};
  const uncertain = await unknown.bootstrap.main(native, unknown.context);
  assert.strictEqual(uncertain.error_code, 'WRITER_EXECUTION_UNKNOWN');assert.strictEqual(uncertain.hold_confirmed, true);
  const unknownControl = await unknown.store.read(unknown.binding);assert.strictEqual(unknownControl.state, 'HOLD');assert(unknownControl.active);
  const malformed = await fixture();
  const local = createLocalRoot({store: malformed.store, binding: malformed.binding, key, owner: 'new', target: malformed.context.function_name,
    runtimeIdentity: () => ({environment: env, function_name: malformed.context.function_name, node_major: 24}),
    identify: () => ({request_id: 'fixture:malformed-local', business: {}}), worker: async () => ({ok: true})});
  assert.strictEqual((await local({}, {})).hold_confirmed, true);assert.strictEqual((await malformed.store.read(malformed.binding)).state, 'HOLD');
  // Whole original materializer and child RDE with one shared business model.
  const whole = await fixture('materializeIndicators');whole.state.triggerSource = 'timer';
  const childBinding = {environment: env, scope: 'production/runDecisionEngine'};
  whole.b.seed(adapter.id(childBinding, 'control'), adapter.encodeControl(journal.initial(childBinding), childBinding));
  const childStore = adapter.createProductionStore({database: whole.database, binding: childBinding});
  assert((await journal.apply(childStore, childBinding, {type: 'activate', owner: 'new', revision: 0, proof})).ok);
  const repo = path.resolve(__dirname, '..'), common = path.join(repo, 'src/common');let h, wrapped, childMain, baselineChild;
  const child = entry.createWorker({store: childStore, binding: childBinding, key, target: 'runDecisionEngineNode24', owner: 'new',
    runtimeIdentity: () => ({environment: env, function_name: 'runDecisionEngineNode24', node_major: 24}),
    loadMain: async () => childMain.main});
  let calls = 0;
  whole.state.call = async (request, options) => {
    calls++;assert.strictEqual(request.name, 'runDecisionEngineNode24');assert.strictEqual(options.timeout, 15000);
    return {requestId: 'fixture:SDK', result: await child(request.data, {})};
  };
  h = createHarness(path.join(repo, 'cloudfunctions/materializeIndicators'), {common,
    entries: [{root: path.join(repo, 'cloudfunctions/runDecisionEngine'), common}],
    callFunction: (request, options) => wrapped.init({}).callFunction(copy(request), options)});
  childMain = h.load(path.join(repo, 'cloudfunctions/runDecisionEngine/index.js'));
  whole.state.handler = (sdk, business) => {wrapped = sdk;return h.entry.main(business, {});};
  const baseline = createHarness(path.join(repo, 'cloudfunctions/materializeIndicators'), {common,
    entries: [{root: path.join(repo, 'cloudfunctions/runDecisionEngine'), common}],
    callFunction: async request => ({requestId: 'fixture:SDK', result: await baselineChild.main(request.data, {})})});
  baselineChild = baseline.load(path.join(repo, 'cloudfunctions/runDecisionEngine/index.js'));
  const expected = await baseline.run(native), actual = await whole.bootstrap.main(native, whole.context);
  assert.deepStrictEqual(copy(actual), copy(expected));assert.deepStrictEqual(h.writes, baseline.writes);
  for (const name of new Set(h.writes.map(w => w.collection))) assert.deepStrictEqual(h.rows(name), baseline.rows(name));
  assert.strictEqual(h.writes.length, 539);assert.strictEqual(calls, 1, 'only business child RPC; root is in-process');
  assert.strictEqual((await whole.bootstrap.main(native, {...whole.context, request_id: 'retry'})).reason, 'ALREADY_COMPLETE');
  assert.strictEqual(h.writes.length, 539);assert.strictEqual(calls, 1);
  console.log(JSON.stringify({transport: 'MODEL_ONLY', reviewed_timer_policies: timerCases, trusted_source_before_storage: true,
    retry_native_request_id_ignored: true, local_root_rpc_calls: 0, whole_materializer_rde_writes: h.writes.length,
    all_rows_and_results_equal: true, native_timer_retry_stability: 'NOT_PROVEN'}));
}
main().catch(error => {console.error(error);process.exitCode = 1;});
