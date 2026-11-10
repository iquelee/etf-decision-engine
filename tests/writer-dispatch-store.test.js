'use strict';
// Manual transaction conflict model; optional actual captured SDK mode. No cloud.
const assert = require('assert'), path = require('path');
const plan = require('../release/writer-dispatch-plan');
const adapter = require('../release/writer-dispatch-cloudbase');
const {createExecutor} = require('../release/writer-dispatch-executor');
const admission = require('../release/writer-admission');
const journal = require('../release/writer-admission-journal');
const ledger = require('../release/writer-journal-cloudbase');
const entry = require('../release/writer-entry');
const {backend, fakeDatabase} = require('./writer-journal-cloudbase.test');
const clone = x => JSON.parse(JSON.stringify(x)), key = Buffer.alloc(32, 71);
const parent = {...plan.parentBinding, owner: 'new', epoch: 1, request_id: 'manual:fixture', token: 'parent:fixture'};
let sdk, EJSON = JSON, activeBackend, activeFixture, network = 0;
const runtime = () => ({environment: plan.environment, node_major: 24, function_name: 'writerDispatchNode24', trigger_source: 'timer'});
function active(binding) {return {...admission.initial(binding), owner: 'new', epoch: 1, state: 'ACTIVE', revision: 3};}
async function fixture(target = 'fetchDailyData', task = 'daily') {
  const b = backend(EJSON, adapter.collection);activeBackend = b;
  const database = sdk ? sdk.init({env: plan.environment, retries: 0, keepalive: false}).database() : fakeDatabase(b, plan.environment, adapter.collection);
  const spec = plan.specification(parent, {name: target, data: {force: true, task_name: task}});
  const childBinding = {environment: plan.environment, scope: 'production/' + target};
  const admitted = admission.transition(active(plan.parentBinding), {type: 'admit', revision: 3, ...parent}, plan.parentBinding);assert(admitted.ok);
  b.seed(ledger.id(plan.parentBinding, 'control'), ledger.encodeControl(admitted.next, plan.parentBinding));
  for (const kind of ['request', 'token']) b.seed(ledger.id(plan.parentBinding, kind, parent[kind === 'request' ? 'request_id' : 'token']),
    ledger.encodeReceipt({...parent, status: 'RUNNING'}, plan.parentBinding, kind));
  b.seed(ledger.id(childBinding, 'control'), ledger.encodeControl(active(childBinding), childBinding));
  b.seed('rollout:adminGateway', {schema: 1, environment: plan.environment, scope: 'production/writer-rollout', revision: 2, state: 'OPEN'});
  const store = adapter.createStore({database}), parentStore = ledger.createProductionStore({database, binding: plan.parentBinding});
  const childStore = ledger.createProductionStore({database, binding: childBinding});
  const f = {b, database, store, parentStore, childStore, childBinding, spec, attempts: 0, business: 0, mode: 'success', businessOk: true};
  f.finishParent = async () => {
    assert((await journal.apply(parentStore, plan.parentBinding, {type: 'finish', revision: (await parentStore.read(plan.parentBinding)).revision, ...parent})).ok);
  };
  f.prepareAndFinish = async () => {assert((await store.prepare(spec)).acknowledged);await f.finishParent();};
  const worker = entry.createWorker({store: childStore, binding: childBinding, key, target: target + 'Node24', owner: 'new',
    runtimeIdentity: () => ({environment: plan.environment, node_major: 24, function_name: target + 'Node24'}),
    loadMain: async () => async business => {assert.deepStrictEqual(business, spec.business);f.business++;return {ok: f.businessOk};}});
  f.transport = async (request, options) => {
    f.attempts++;assert.strictEqual(request.name, target + 'Node24');
    assert.deepStrictEqual(options, {timeout: 15000, retryOptions: {retries: 0}});
    if (f.mode === 'lost-before') throw Error('fixture transport failed before child');
    const result = await worker(request.data, {});
    if (f.mode === 'lost-after') throw Error('fixture response lost after child complete');
    return {requestId: 'fixture:sdk-transport', result};
  };
  activeFixture = f;
  const app = sdk && sdk.init({env: plan.environment, retries: 0, keepalive: false});
  f.run = createExecutor({store, runtimeIdentity: runtime, readKey: async targetName => {assert.strictEqual(targetName, target);return key;},
    transportTimeoutMs: 15000, callFunction: sdk ? app.callFunction.bind(app) : f.transport});
  return f;
}
const job = f => f.store.read(f.spec.id);
const control = async (f, child = false) => (child ? f.childStore : f.parentStore).read(child ? f.childBinding : plan.parentBinding);
const fault = (f, after, action = 'database.commitTransaction', when) => {f.b.fault = {action, after, throw: true, when};};
async function main() {
  let cases = 0;
  for (const [target, task] of [['fetchDailyData','daily'],['fetchRealtimeData','realtime'],['fetchFundamentalNews','news'],['extractFundamental','extract']]) {
    const f = await fixture(target, task);await f.store.prepare(f.spec);
    assert.strictEqual((await f.run(f.spec.id)).sent, false, 'RUNNING parent is not dispatch permission');
    assert.strictEqual((await job(f)).state, 'PREPARED');assert.strictEqual(f.attempts, 0);
    await f.finishParent();const before = f.b.calls.length;
    const result = await f.run(f.spec.id);assert.strictEqual(result.state, 'COMPLETE');assert.strictEqual(f.business, 1);assert.strictEqual(f.attempts, 1);
    const calls = f.b.calls.slice(before), commits = calls.filter(c => c.action === 'database.commitTransaction');assert.strictEqual(commits.length, 4, 'claim, child admission, child finish, settlement');
    const claimStart = calls.findIndex(c => c.action === 'database.startTransaction');
    const claimCommit = calls.findIndex(c => c.action === 'database.commitTransaction');
    const writes = calls.slice(claimStart, claimCommit).filter(c => c.action === 'database.modifyDocument').map(c => EJSON.parse(c.params.query)._id);
    assert.deepStrictEqual(writes, [ledger.id(plan.parentBinding, 'control'), ledger.id(f.childBinding, 'control'), 'rollout:adminGateway', f.spec.id]);
    assert.strictEqual((await f.run(f.spec.id)).reason, 'NO_AUTOMATIC_RETRY');assert.strictEqual(f.attempts, 1);
    assert.strictEqual((await f.store.prepare(f.spec)).created, false);cases++;
  }
  const concurrency = await fixture();await concurrency.prepareAndFinish();
  const raced = await Promise.all([concurrency.run(concurrency.spec.id), concurrency.run(concurrency.spec.id)]);
  assert.strictEqual(raced.filter(r => r.sent).length, 1);assert.strictEqual(concurrency.attempts, 1);assert.strictEqual(concurrency.business, 1);cases++;
  for (const phase of ['prepare','claim','settle']) for (const after of [false, true]) {
    const f = await fixture();
    if (phase === 'prepare') {
      fault(f, after);await assert.rejects(f.store.prepare(f.spec));
      assert.strictEqual((await job(f)) !== null, after);assert.strictEqual(f.attempts, 0);
      assert.strictEqual((await control(f)).active.request_id, parent.request_id);
      if (after) assert.strictEqual((await f.run(f.spec.id)).sent, false, 'unknown enqueue is not parent completion');
    } else {
      await f.prepareAndFinish();
      if (phase === 'claim') fault(f, after);
      else {
        const transport = f.transport;
        const call = async (request, options) => {const r = await transport(request, options);fault(f, after);return r;};
        f.run = createExecutor({store: f.store, runtimeIdentity: runtime, readKey: async () => key, transportTimeoutMs: 15000, callFunction: call});
      }
      const start = f.b.calls.length, result = await f.run(f.spec.id), calls = f.b.calls.slice(start);
      assert.strictEqual(result.sent, phase === 'settle');assert.strictEqual(f.attempts, phase === 'settle' ? 1 : 0);
      const state = await job(f);assert.strictEqual(state.state, phase === 'claim' ? (after ? 'CLAIMED' : 'PREPARED') : (after ? 'COMPLETE' : 'CLAIMED'));
      assert(!calls.some(c => c.action === 'database.abortTransaction'), 'never rollback after attempted commit');
      if (after || phase === 'settle') {assert.strictEqual((await f.run(f.spec.id)).sent, false);assert.strictEqual(f.attempts, phase === 'settle' ? 1 : 0);}
    }
    cases++;
  }
  const crash = await fixture();await crash.prepareAndFinish();assert((await crash.store.claim(crash.spec.id, key)).claimed);
  const restarted = adapter.createStore({database: crash.database});
  assert.strictEqual((await restarted.claim(crash.spec.id, key)).reason, 'NO_AUTOMATIC_RETRY');assert.strictEqual((await crash.run(crash.spec.id)).sent, false);assert.strictEqual(crash.attempts, 0);cases++;
  for (const mode of ['lost-before','lost-after']) {
    const f = await fixture();await f.prepareAndFinish();f.mode = mode;
    const result = await f.run(f.spec.id);assert.strictEqual(result.state, 'HOLD');assert.strictEqual(result.hold_confirmed, true);
    assert.strictEqual((await control(f)).state, 'HOLD');assert.strictEqual((await control(f, true)).state, 'HOLD');
    assert.strictEqual(f.business, mode === 'lost-after' ? 1 : 0);assert.strictEqual(f.attempts, 1);
    assert.strictEqual((await f.run(f.spec.id)).sent, false);assert.strictEqual(f.attempts, 1);cases++;
  }
  const failedBusiness = await fixture();await failedBusiness.prepareAndFinish();failedBusiness.businessOk = false;
  assert.strictEqual((await failedBusiness.run(failedBusiness.spec.id)).state, 'COMPLETE');assert.strictEqual(failedBusiness.business, 1);cases++;
  const atomic = await fixture();await atomic.prepareAndFinish();const original = clone(atomic.b.rows());
  fault(atomic, false, 'database.modifyDocument', p => EJSON.parse(p.query)._id === 'rollout:adminGateway');
  assert.strictEqual((await atomic.run(atomic.spec.id)).sent, false);assert.deepStrictEqual(atomic.b.rows(), original);assert.strictEqual(atomic.attempts, 0);cases++;
  const duplicatePrepare = await fixture();
  const prepared = await Promise.allSettled([duplicatePrepare.store.prepare(duplicatePrepare.spec), duplicatePrepare.store.prepare(duplicatePrepare.spec)]);
  assert.strictEqual(prepared.filter(r => r.status === 'fulfilled' && r.value.created).length, 1);
  assert.strictEqual(duplicatePrepare.b.rows().filter(row => row.kind === 'dispatch').length, 1);cases++;
  const raceClose = await fixture();await raceClose.prepareAndFinish();const send = raceClose.b.send.bind(raceClose.b);let closed = false;
  const beforeRace = (await control(raceClose)).revision;
  raceClose.b.send = async (action, params) => {
    if (!closed && action === 'database.modifyDocument') {
      closed = true;raceClose.b.seed('rollout:adminGateway', {schema: 1, environment: plan.environment, scope: 'production/writer-rollout', revision: 3, state: 'CLOSED'});
    }
    return send(action, params);
  };
  assert.strictEqual((await raceClose.run(raceClose.spec.id)).sent, false);assert(closed);assert.strictEqual(raceClose.attempts, 0);
  assert.strictEqual((await job(raceClose)).state, 'PREPARED');assert.strictEqual((await control(raceClose)).revision, beforeRace);cases++;
  const rotation = await fixture();await rotation.prepareAndFinish();const transport = rotation.transport;
  rotation.run = createExecutor({store: rotation.store, runtimeIdentity: runtime, readKey: async () => key, transportTimeoutMs: 15000,
    callFunction: async (request, options) => {
      await transport(request, options);
      rotation.b.seed(ledger.id(rotation.childBinding, 'control'), ledger.encodeControl({...active(rotation.childBinding), epoch: 2}, rotation.childBinding));
      throw Error('fixture lost response after owner epoch advanced');
    }});
  const rotated = await rotation.run(rotation.spec.id);assert.strictEqual(rotated.state, 'HOLD');assert.strictEqual(rotated.hold_confirmed, false);
  assert.strictEqual((await control(rotation, true)).epoch, 2);assert.strictEqual((await control(rotation, true)).state, 'ACTIVE');
  assert.strictEqual((await rotation.run(rotation.spec.id)).sent, false);assert.strictEqual(rotation.attempts, 1);cases++;
  const abortLost = await fixture();await abortLost.store.prepare(abortLost.spec);const abortStart = abortLost.b.calls.length;
  const abortSend = abortLost.b.send.bind(abortLost.b);let abortAckLost = false;
  abortLost.b.send = async (action, params) => {
    const result = await abortSend(action, params);
    if (action === 'database.abortTransaction' && !abortAckLost) {abortAckLost = true;throw Error('fixture abort ACK lost after abort');}
    return result;
  };
  assert.strictEqual((await abortLost.run(abortLost.spec.id)).sent, false);assert(abortAckLost, 'post-abort fault must actually be injected');
  assert.strictEqual(abortLost.b.calls.slice(abortStart).filter(c => c.action === 'database.abortTransaction').length, 1);cases++;
  const noAck = await fixture();await noAck.prepareAndFinish();
  const missingAck = createExecutor({store: {...noAck.store, async claim(...args) {return {...await noAck.store.claim(...args), acknowledged: false};}},
    runtimeIdentity: runtime, readKey: async () => key, transportTimeoutMs: 15000, callFunction: noAck.transport});
  assert.strictEqual((await missingAck(noAck.spec.id)).reason, 'CLAIM_NOT_ACKNOWLEDGED');assert.strictEqual(noAck.attempts, 0);
  assert.strictEqual((await job(noAck)).state, 'CLAIMED');assert.strictEqual((await noAck.run(noAck.spec.id)).sent, false);cases++;
  const tamper = await fixture();await tamper.prepareAndFinish();
  const forgedClaim = createExecutor({store: {...tamper.store, async claim(...args) {
    const result = await tamper.store.claim(...args);result.job.wire.signature = '0'.repeat(64);return result;
  }}, runtimeIdentity: runtime, readKey: async () => key, transportTimeoutMs: 15000, callFunction: tamper.transport});
  assert.strictEqual((await forgedClaim(tamper.spec.id)).sent, false);assert.strictEqual(tamper.attempts, 0);
  assert.strictEqual((await tamper.run(tamper.spec.id)).sent, false);cases++;
  for (const kind of ['parent-hold','child-busy','rollout-closed','receipt-unknown','receipt-divergence','missing-child','wrong-runtime']) {
    const f = await fixture();await f.prepareAndFinish();
    if (kind === 'parent-hold') f.b.seed(ledger.id(plan.parentBinding, 'control'), ledger.encodeControl({...await control(f), state: 'HOLD'}, plan.parentBinding));
    if (kind === 'child-busy') {
      assert((await journal.apply(f.childStore, f.childBinding, {type: 'admit', revision: (await control(f, true)).revision,
        owner: 'new', epoch: 1, request_id: 'other', token: 'other'})).ok);
    }
    if (kind === 'rollout-closed') f.b.seed('rollout:adminGateway', {schema: 1, environment: plan.environment, scope: 'production/writer-rollout', revision: 2, state: 'CLOSED'});
    if (kind.startsWith('receipt-')) for (const k of kind === 'receipt-unknown' ? ['request','token'] : ['token'])
      f.b.seed(ledger.id(plan.parentBinding, k, parent[k === 'request' ? 'request_id' : 'token']), ledger.encodeReceipt({...parent, status: 'UNKNOWN'}, plan.parentBinding, k));
    if (kind === 'missing-child') f.b.seed(ledger.id(f.childBinding, 'control'), {corrupt: true});
    if (kind === 'wrong-runtime') f.run = createExecutor({store: f.store, callFunction: f.transport, readKey: async () => key,
      transportTimeoutMs: 15000, runtimeIdentity: () => ({...runtime(), node_major: 22})});
    assert.strictEqual((await f.run(f.spec.id)).sent, false);assert.strictEqual(f.attempts, 0);assert.strictEqual((await job(f)).state, 'PREPARED');cases++;
  }
  const b = await fixture();await assert.rejects(b.store.prepare(plan.specification({...parent, token: 'wrong'}, {name: 'fetchDailyData', data: {force: true, task_name: 'daily'}})));
  assert.strictEqual((await job(b)), null);cases++;
  assert.throws(() => adapter.createStore({database: {...b.database, config: {...b.database.config, retries: 1}}}));
  assert.throws(() => adapter.createStore({database: b.database, collection: 'anything'}));
  assert.throws(() => createExecutor({store: b.store, callFunction: b.transport, runtimeIdentity: runtime, readKey: async () => key}));
  assert.strictEqual(network, 0);
  console.log(JSON.stringify({status: 'PASS_CORE_DISPATCH_STORE_EXECUTOR', evidence: sdk ? 'ACTUAL_SDK_MEMORY_WIRE' : 'MODEL_ONLY',
    cases, sdk: sdk ? '2.11.0/database1.4.1' : null, cloud_calls: 0, network_attempts: network,
    parent_and_claim_atomicity: 'MODEL_NOT_PLATFORM_PROOF', runtime_wiring: 'NOT_WIRED', production_and_natural_qualification: 'NOT_PROVEN'}));
}
function initSdk(root) {
  const deny = () => {network++;throw Error('OFFLINE_NETWORK_DENIED');};
  for (const name of ['http','https']) {const m = require(name);m.request = m.get = deny;}
  require('net').Socket.prototype.connect = deny;require('tls').connect = deny;global.fetch = deny;
  const dns = require('dns');for (const k of Object.keys(dns)) if (/^(lookup|resolve|reverse)/.test(k) && typeof dns[k] === 'function') dns[k] = deny;
  for (const k of Object.keys(dns.promises)) if (typeof dns.promises[k] === 'function') dns.promises[k] = deny;
  assert.strictEqual(Number(process.versions.node.split('.')[0]), 24);
  sdk = require(path.join(root, 'node_modules/@cloudbase/node-sdk'));({EJSON} = require(path.join(root, 'node_modules/bson')));
  assert.strictEqual(require(path.join(root, 'node_modules/@cloudbase/node-sdk/package.json')).version, '2.11.0');
  assert.strictEqual(require(path.join(root, 'node_modules/@cloudbase/database/package.json')).version, '1.4.1');
  require(path.join(root, 'node_modules/@cloudbase/node-sdk/lib/utils/dbRequest')).DBRequest.prototype.send = function(action, params) {
    assert.strictEqual(this.config.envName, plan.environment);assert.strictEqual(this.config.retries, 0);assert.strictEqual(this.config.keepalive, false);
    return activeBackend.send(action, params);
  };
  require(path.join(root, 'node_modules/@cloudbase/node-sdk/lib/utils/httpRequest')).default = async request => {
    assert.strictEqual(request.params.action, 'functions.invokeFunction');assert.strictEqual(request.method, 'post');
    const r = await activeFixture.transport({name: request.params.function_name, data: JSON.parse(request.params.request_data)}, request.opts);
    return {requestId: r.requestId, data: {response_data: JSON.stringify(r.result)}};
  };
}
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length && args[0] !== '--child') {
    assert(args.length === 2 && args[0] === '--sdk-root');
    const env = {};for (const key of ['PATH','SystemRoot','WINDIR','TEMP','TMP']) if (process.env[key]) env[key] = process.env[key];
    const r = require('child_process').spawnSync(process.execPath, [__filename, '--child', args[1]], {env, encoding: 'utf8', timeout: 300000});
    if (r.stdout) process.stdout.write(r.stdout);if (r.stderr) process.stderr.write(r.stderr);assert.strictEqual(r.status, 0);
  } else {if (args.length) {assert.strictEqual(args.length, 2);initSdk(path.resolve(args[1]));}main().catch(error => {console.error(error);process.exitCode = 1;});}
}
