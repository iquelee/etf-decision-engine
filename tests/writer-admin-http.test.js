'use strict';
const assert = require('assert'), path = require('path');
const {createBootstrap} = require('../release/writer-worker-bootstrap');
const {inspect, operationHeader} = require('../release/writer-admin-http');
const entry = require('../release/writer-entry'), journal = require('../release/writer-admission-journal');
const a = require('../release/writer-journal-cloudbase');
const {backend, fakeDatabase} = require('./writer-journal-cloudbase.test');
const {createHarness} = require('../scripts/lib/rde-offline-harness');
const repo = path.resolve(__dirname, '..'), common = path.join(repo, 'src/common');
const environment = a.productionNamespace.environment, key = Buffer.alloc(32, 31);
const binding = {environment, scope: 'production/adminGateway'}, childBinding = {environment, scope: 'production/runDecisionEngine'};
const proof = {reference: 'fixture:terminal', entries_closed: true, executions_terminal: true, retries_accounted_for: true};
const op = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const post = (route, body = {}, id = 1) => ({httpMethod: 'POST', path: '/api/admin/' + route,
  headers: {'x-admin-token': 'fixture-session', [operationHeader]: op(id)}, body});
const copy = x => JSON.parse(JSON.stringify(x));
let roots = Object.fromEntries(['adminGateway', 'runDecisionEngine'].map(name => [name,
  {root: path.join(repo, 'cloudfunctions', name), common}]));
async function setup(guarded = true) {
  const state = {loads: 0, inits: 0, tokenReads: 0, rolloutReads: 0, calls: 0,
    rollout: {schema: 1, environment, scope: 'production/writer-rollout', revision: 1, state: 'OPEN'}};
  const b = backend(JSON, a.productionNamespace.collection), database = fakeDatabase(b, environment, a.productionNamespace.collection);
  const store = a.createProductionStore({database, binding}), childStore = a.createProductionStore({database, binding: childBinding});
  for (const [bind, targetStore] of [[binding, store], [childBinding, childStore]]) {
    b.seed(a.id(bind, 'control'), a.encodeControl(journal.initial(bind), bind));
    assert((await journal.apply(targetStore, bind, {type: 'activate', owner: 'new', revision: 0, proof})).ok);
  }
  let businessSdk, originalChild;
  const child = entry.createWorker({store: childStore, binding: childBinding, key, target: 'runDecisionEngineNode24', owner: 'new',
    runtimeIdentity: () => ({environment, function_name: 'runDecisionEngineNode24', node_major: 24}),
    loadMain: async () => originalChild.main});
  const h = createHarness(roots.adminGateway.root, {common: roots.adminGateway.common, entries: [roots.runDecisionEngine],
    callFunction: async (request, options) => guarded ? businessSdk.init({}).callFunction(copy(request), options) :
      {requestId: 'fixture:SDK', result: await originalChild.main(request.data, {})}});
  originalChild = h.load(path.join(roots.runDecisionEngine.root, 'index.js'));
  h.setRows('param_config', [...h.rows('param_config'), {_id: 'auth:fixture', key: 'admin_token',
    value: {v: 'fixture-session', exp: '2099-01-01T00:00:00Z'}}]);
  h.setRows('risk_events', [{_id: 'risk:fixture', code: '513310', status: 'active'}]);
  const business = h.load('@cloudbase/node-sdk').init().database();
  const hybrid = {...database, collection: name => name === a.productionNamespace.collection ? {
    doc: id => id === 'rollout:adminGateway' ? {get: async () => {
      state.rolloutReads++;return {requestId: 'fixture:rollout', data: state.rollout ? [{_id: id, ...state.rollout}] : []};
    }} : database.collection(name).doc(id)
  } : {where: filter => {assert.deepStrictEqual(filter, {key: 'admin_token'});return {limit: n => ({get: async () => {
    state.tokenReads++;return {requestId: 'fixture:token', ...(await business.collection(name).where(filter).limit(n).get())};
  }})};}}};
  const sdk = {getCloudbaseContext: () => ({SCF_NAMESPACE: environment}), init: config => {
    state.inits++;return {config: {timeout: 15000, ...config}, database: () => hybrid,
      callFunction: async (request, options) => {
        state.calls++;assert.strictEqual(request.name, 'runDecisionEngineNode24');assert.strictEqual(options.timeout, 15000);
        return {requestId: 'fixture:SDK', result: await child(request.data, {})};
      }};
  }};
  const bootstrap = createBootstrap({producer: 'adminGateway', sdk, sdkVersion: '2.11.0', databaseVersion: '1.4.1',
    nodeMajor: () => 24, readEnvironment: () => key.toString('hex'),
    loadMain: async wrapped => {state.loads++;businessSdk = wrapped;return h.entry.main;}});
  return {state, h, b, store, bootstrap, context: {function_name: 'adminGatewayNode24'}};
}
async function test() {
  const invalid = await setup(), bad = post('risk');delete bad.headers[operationHeader];
  assert.strictEqual((await invalid.bootstrap.main(bad, invalid.context)).code, 400);
  assert.strictEqual(invalid.state.inits, 0);assert.strictEqual(invalid.state.loads, 0);
  assert.throws(() => inspect({...post('risk'), headers: {...post('risk').headers, 'X-Writer-Operation-Id': op(2)}}), /duplicate/);
  const closed = await setup();closed.state.rollout.state = 'CLOSED';
  const forms = [post('risk'),post('param'),post('fundamental/config'),post('fundamental/data'),post('trade'),
    post('portfolio/snapshot'),post('fetch'),post('intel/refresh'),post('gen1/health/review'),post('logout'),post('changePassword'),
    post('login'), {...post('login'), httpMethod: 'GET'}, post('unknown')];
  const beforeClosed = closed.b.calls.length;
  for (const event of forms) assert.strictEqual((await closed.bootstrap.main(event, closed.context)).code, 503);
  assert.strictEqual(closed.b.calls.length, beforeClosed);assert.strictEqual(closed.state.tokenReads, 0);
  assert.strictEqual(closed.state.loads, 0);assert.strictEqual(closed.h.writes.length, 0);
  const event = post('risk', {code: '513310', event_type: 'POLICY', reason: 'fixture'});
  closed.state.rollout.state = 'OPEN';assert.strictEqual((await closed.bootstrap.main(event, closed.context)).code, 0, 'same denied operation ID remains usable');
  const unauthorized = await setup(), beforeAuth = unauthorized.b.calls.length;
  for (const headers of [{[operationHeader]: op(1)}, {...post('risk').headers, 'x-admin-token': 'wrong'},
    {...post('risk').headers, authorization: 'Bearer conflicting'}])
    assert.strictEqual((await unauthorized.bootstrap.main({...event, headers}, unauthorized.context)).code, 401);
  assert.strictEqual(unauthorized.b.calls.length, beforeAuth);assert.strictEqual(unauthorized.state.loads, 0);
  assert.strictEqual(unauthorized.h.writes.length, 0);
  for (const exp of [null, 'invalid-date', '2020-01-01T00:00:00Z']) {
    const invalidSession = await setup();
    invalidSession.h.setRows('param_config', invalidSession.h.rows('param_config').map(row => row.key === 'admin_token' ?
      {...row, value: {v: 'fixture-session', exp}} : row));
    const calls = invalidSession.b.calls.length;
    assert.strictEqual((await invalidSession.bootstrap.main(event, invalidSession.context)).code, 401);
    assert.strictEqual(invalidSession.b.calls.length, calls);assert.strictEqual(invalidSession.h.writes.length, 0);
  }
  const counts = [];
  for (const input of [event, post('risk', {action: 'resolve', event_id: 'risk:fixture', resolve_reason: 'fixture'}),
    post('param', {key: 'offline_fixture_param', value: 7})]) {
    const baseline = await setup(false), actual = await setup();
    const expected = await baseline.h.run(input), result = await actual.bootstrap.main(input, actual.context);
    assert.deepStrictEqual(copy(result), copy(expected));assert.deepStrictEqual(actual.h.writes, baseline.h.writes);
    for (const name of new Set(actual.h.writes.map(w => w.collection))) assert.deepStrictEqual(actual.h.rows(name), baseline.h.rows(name));
    const writes = actual.h.writes.length;
    assert.strictEqual((await actual.bootstrap.main({...input, requestId: 'different-transport-attempt'}, actual.context)).code, 409);
    assert.strictEqual(actual.h.writes.length, writes);assert.strictEqual(actual.state.calls, 1);counts.push(writes);
    assert.strictEqual((await actual.bootstrap.main({...input, body: {...input.body, changed: true}}, actual.context)).code, 409);
    assert.strictEqual(actual.h.writes.length, writes, 'same operation cannot rerun with changed payload');
  }
  const read = await setup();read.state.rollout = null;
  const readBefore = read.b.calls.length;
  const readEvent = {httpMethod: 'GET', path: '/api/admin/risk/list', headers: {'X-Admin-Token': 'fixture-session'}};
  assert.strictEqual((await read.bootstrap.main(readEvent, read.context)).code, 0);
  assert.strictEqual((await read.bootstrap.main({...readEvent, headers: {}}, read.context)).code, 401);
  assert.strictEqual(read.h.writes.length, 0);assert.strictEqual(read.b.calls.length, readBefore);assert.strictEqual(read.state.rolloutReads, 0);
  const login = await setup();login.h.setRows('param_config', [...login.h.rows('param_config'),
    {_id: 'password:fixture', key: 'admin_password', value: {v: 'public-fixture-password'}, version: 1}]);
  const failedLogin = {...post('login', {password: 'wrong'}), headers: {[operationHeader]: op(3)}};
  assert.strictEqual((await login.bootstrap.main(failedLogin, login.context)).code, 401);
  assert(login.h.writes.length > 0, 'original failed-password accounting retained');assert.strictEqual(login.state.tokenReads, 0);
  const loginWrites = login.h.writes.length;
  assert.strictEqual((await login.bootstrap.main(failedLogin, login.context)).code, 409);assert.strictEqual(login.h.writes.length, loginWrites);
  const detached = await setup();
  assert.strictEqual((await detached.bootstrap.main(post('fetch', {task: 'daily'}), detached.context)).code, 409);
  const unsettled = await detached.store.read(binding);assert.strictEqual(unsettled.state, 'HOLD');assert(unsettled.active);
  console.log(JSON.stringify({transport: 'MODEL_ONLY', actual_admin_http_bootstrap: true, closed_mutation_forms: forms.length,
    auth_failure_no_admission: true, login_rate_limit_writes_deduplicated: true, readonly_auth_preserved: true,
    complete_admin_rde_writes: counts, full_results_and_rows_equal: true, async_dispatch_still_not_qualified: true}));
}
if (require.main === module) test().catch(error => {console.error(error);process.exitCode = 1;});
module.exports = {setup};
