'use strict';
const assert = require('assert');
const adapter = require('../release/writer-journal-cloudbase');
const journal = require('../release/writer-admission-journal');
const entry = require('../release/writer-entry');
const {createBootstrap, plans} = require('../release/writer-worker-bootstrap');
const {backend, fakeDatabase} = require('./writer-journal-cloudbase.test');
const ns = adapter.productionNamespace, key = Buffer.alloc(32, 11);
const proof = {reference: 'fixture:terminal', entries_closed: true, executions_terminal: true, retries_accounted_for: true};
async function fixture(producer = 'runDecisionEngine', seed = true) {
  const binding = {environment: ns.environment, scope: 'production/' + producer};
  const b = backend(JSON, ns.collection), database = fakeDatabase(b, ns.environment, ns.collection);
  const store = adapter.createProductionStore({database, binding});
  if (seed) {
    b.seed(adapter.id(binding, 'control'), adapter.encodeControl(journal.initial(binding), binding));
    assert((await journal.apply(store, binding, {type: 'activate', owner: 'new', revision: 0, proof})).ok);
  }
  const state = {inits: [], loads: 0, contextArguments: [], cloudEnvironment: ns.environment, node: 24, secret: key.toString('hex')};
  const sdk = {SYMBOL_CURRENT_ENV: Symbol('current'), getCloudbaseContext(...args) {
    state.contextArguments.push(args);return {TCB_ENV: state.cloudEnvironment, TRIGGER_SRC: state.triggerSource};
  }, init(config) {state.inits.push(config);return {config, database: () => database,
    callFunction: async (request, options) => {assert(state.call, 'NO_NETWORK');return state.call(request, options);}};}};
  const bootstrap = createBootstrap({producer, sdk, sdkVersion: '2.11.0', databaseVersion: '1.4.1',
    readEnvironment: () => state.secret, nodeMajor: () => state.node,
    loadMain: async wrapped => {state.loads++;assert(wrapped !== sdk);return async data => state.handler ?
      state.handler(wrapped, data) : {ok: false, echoed: data};}});
  const context = {function_name: plans[producer].target};
  const wire = async id => entry.seal({binding, control: seed ? await store.read(binding) :
    {...journal.initial(binding), owner: 'new'}, target: context.function_name, request_id: id, business: {force: true}, key});
  return {b, database, store, binding, sdk, bootstrap, state, context, wire};
}
async function main() {
  assert(Object.isFrozen(ns) && Object.isFrozen(ns.scopes));assert.strictEqual(ns.scopes.length, 9);
  for (const scope of ns.scopes) {
    const b = backend(JSON, ns.collection), database = fakeDatabase(b, ns.environment, ns.collection);
    const binding = {environment: ns.environment, scope};
    const store = adapter.createProductionStore({database, binding});
    assert.strictEqual(await store.read(binding), null);
    assert.strictEqual((await journal.apply(store, binding, {type: 'hold', revision: 0})).ok, false);
    assert.deepStrictEqual(b.rows(), []);assert(!b.calls.some(c => /insert|modify|commit/.test(c.action)));
    assert.throws(() => adapter.createStore({database, binding, collection: ns.collection}), /isolated/);
    for (const options of [{database, binding: {...binding, environment: 'elsewhere'}},
      {database, binding: {...binding, scope: 'production/apiGatewayNode24'}},
      {database, binding, collection: 'anything'}, {database, binding: {...binding, extra: true}}])
      assert.throws(() => adapter.createProductionStore(options));
  }
  const f = await fixture(), wire = await f.wire('fixture:once');
  assert.throws(() => f.bootstrap.getBusinessSdk(), /authenticated/);
  const before = f.b.calls.length;
  for (const event of [{}, {...wire, business: {force: false}}, {...wire, target: 'other'}])
    assert.strictEqual((await f.bootstrap.main(event, f.context)).admission, 'ENTRY_AUTHENTICATION_FAILED');
  for (const field of ['secret', 'cloudEnvironment', 'node']) {
    const prior = f.state[field];f.state[field] = field === 'node' ? 22 : undefined;
    assert.strictEqual((await f.bootstrap.main(wire, f.context)).executed, false);f.state[field] = prior;
  }
  assert.strictEqual((await f.bootstrap.main(wire, {function_name: 'runDecisionEngine'})).executed, false);
  assert.strictEqual(f.b.calls.length, before);assert.strictEqual(f.state.inits.length, 0);assert.strictEqual(f.state.loads, 0);
  const result = await f.bootstrap.main(wire, f.context);
  assert.strictEqual(result.outcome, 'COMPLETE');assert.deepStrictEqual(result.result, {ok: false, echoed: {force: true}});
  assert.strictEqual(f.state.loads, 1);assert.strictEqual(f.b.rows().length, 3);
  assert.strictEqual((await f.bootstrap.main(wire, f.context)).admission, 'ALREADY_COMPLETE');
  assert.strictEqual(f.state.loads, 1);
  const wrapped = f.bootstrap.getBusinessSdk();
  const config = {env: f.sdk.SYMBOL_CURRENT_ENV, timeout: 120000};
  const app = wrapped.init(config);assert.strictEqual(app.config.timeout, 120000);
  assert.deepStrictEqual(config, {env: f.sdk.SYMBOL_CURRENT_ENV, timeout: 120000});
  assert.strictEqual(app.config.env, ns.environment);assert.strictEqual(app.config.retries, 0);assert.strictEqual(app.config.keepalive, false);
  for (const bad of [{env: 'elsewhere'}, {retries: 1}, {keepalive: true}]) assert.throws(() => wrapped.init(bad));
  assert(f.state.contextArguments.every(args => args.length === 0));
  const calls = f.b.calls.length;f.state.secret = Buffer.alloc(32, 12).toString('hex');
  const rotated = entry.seal({binding: f.binding, control: await f.store.read(f.binding), target: f.context.function_name,
    request_id: 'fixture:rotation', business: {}, key: Buffer.from(f.state.secret, 'hex')});
  const afterRead = f.b.calls.length;assert(afterRead > calls);
  assert.strictEqual((await f.bootstrap.main(rotated, f.context)).executed, false);assert.strictEqual(f.b.calls.length, afterRead);
  const absent = await fixture('runDecisionEngine', false);
  assert.strictEqual((await absent.bootstrap.main(await absent.wire('fixture:missing'), absent.context)).executed, false);
  assert.strictEqual(absent.state.loads, 0);assert.deepStrictEqual(absent.b.rows(), []);
  const materializer = await fixture('materializeIndicators');
  const childBinding = {environment: ns.environment, scope: 'production/runDecisionEngine'};
  materializer.b.seed(adapter.id(childBinding, 'control'), adapter.encodeControl(journal.initial(childBinding), childBinding));
  const childStore = adapter.createProductionStore({database: materializer.database, binding: childBinding});
  assert((await journal.apply(childStore, childBinding, {type: 'activate', owner: 'new', revision: 0, proof})).ok);
  const child = entry.createWorker({store: childStore, binding: childBinding, key, target: plans.runDecisionEngine.target,
    owner: 'new', runtimeIdentity: () => ({environment: ns.environment, function_name: plans.runDecisionEngine.target, node_major: 24}),
    loadMain: async () => async data => ({child: data})});
  let childCalls = 0;
  materializer.state.call = async (request, options) => {
    childCalls++;assert.strictEqual(request.name, plans.runDecisionEngine.target);
    assert.strictEqual(request.data.scope, childBinding.scope);assert(request.data.request_id.startsWith('child:'));
    assert.deepStrictEqual(options, {timeout: 15000, retryOptions: {retries: 0}});
    return {requestId: 'fixture:SDK', result: await child(request.data, {})};
  };
  materializer.state.handler = async (wrapped, data) => (await wrapped.init({}).callFunction({name: 'runDecisionEngine', data})).result;
  const matResult = await materializer.bootstrap.main(await materializer.wire('fixture:materializer'), materializer.context);
  assert.strictEqual(matResult.outcome, 'COMPLETE');assert.deepStrictEqual(matResult.result, {child: {force: true}});
  assert.strictEqual(childCalls, 1);assert.strictEqual(materializer.b.rows().length, 6);
  assert.throws(() => createBootstrap({producer: 'fetchDailyData'}), /producer/);
  assert.throws(() => createBootstrap({producer: 'runDecisionEngine', sdkVersion: '3.0.0'}), /versions/);
  console.log('writer bootstrap: fixed nine scopes, no auto-init, signed-only entry, lazy imports, SDK policy and warm key checks PASS (MODEL_ONLY)');
}
if (require.main === module) main().catch(error => {console.error(error);process.exitCode = 1;});
module.exports = {fixture};
