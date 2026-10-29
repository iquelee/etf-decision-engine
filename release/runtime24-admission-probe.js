'use strict';
const assert = require('assert');
const protocol = require('./writer-admission');
const adapter = require('./writer-admission-cloudbase');
const plan = require('./runtime24-admission-probe-plan.json');
const binding = {environment: plan.environment, scope: plan.scope};
const proof = {reference: 'isolated-fixture-only', entries_closed: true, executions_terminal: true, retries_accounted_for: true};
async function verify(database) {
  const col = database.collection(plan.collection);
  // Read every fixed ID first, then add with deterministic primary keys. A
  // repeated/overlapping call cannot reset an existing fixture. Never remove.
  for (const id of plan.documents) {
    const r = await col.doc(id).get();
    assert(r && !r.code && Array.isArray(r.data) && r.data.length === 0, 'fixture already present or unreadable');
  }
  for (const id of plan.documents) await col.add({_id: id, ...adapter.encode(protocol.initial(binding), binding)});
  const store = suffix => adapter.createStore({database, collection: plan.collection, document: 'probe:' + suffix, binding});
  async function action(s, a) { return protocol.apply(s, binding, {revision: (await s.read()).revision, ...a}); }
  async function open(s) { assert((await action(s, {type: 'activate', owner: 'old', proof})).ok); }
  const identity = (revision, request_id, token = request_id) => ({revision, owner: 'old', epoch: 1, request_id, token});
  const cas = store('cas'); await open(cas);
  const snapshot = await cas.read();
  const next = protocol.transition(snapshot, {type: 'drain', revision: snapshot.revision}, binding).next;
  assert.strictEqual(await cas.compareAndSet(snapshot, next), true);
  assert.strictEqual(await cas.compareAndSet(snapshot, next), false, 'stale CAS must match zero');
  const race = store('race'); await open(race);
  const contenders = await Promise.all(Array.from({length: 8}, (_, i) =>
    protocol.apply(race, binding, {...identity(1, 'race:' + i), type: 'admit'})));
  assert.strictEqual(contenders.filter(r => r.ok).length, 1);
  assert((await race.read()).active);
  const drain = store('drain'); await open(drain);
  assert((await protocol.apply(drain, binding, {...identity(1, 'one'), type: 'admit'})).ok);
  assert((await action(drain, {type: 'drain'})).ok);
  assert.strictEqual((await action(drain, {type: 'activate', owner: 'new', proof})).reason, 'BUSY');
  assert((await action(drain, {...identity(0, 'one'), type: 'finish', revision: (await drain.read()).revision})).ok);
  assert((await action(drain, {type: 'activate', owner: 'new', proof})).ok);
  assert.strictEqual((await drain.read()).active, null);
  assert.strictEqual((await drain.read()).receipts[0].status, 'COMPLETE');
  let wrongOwnerRan = false;
  assert.strictEqual((await protocol.execute(drain, binding, identity(5, 'late'), () => { wrongOwnerRan = true; })).executed, false);
  assert.strictEqual(wrongOwnerRan, false);
  const unknown = store('unknown'); await open(unknown);
  assert.strictEqual((await protocol.execute(unknown, binding, identity(1, 'timeout'), () => { throw Error('simulated'); })).outcome, 'UNKNOWN');
  assert.strictEqual((await unknown.read()).state, 'HOLD'); assert((await unknown.read()).active);
  assert.strictEqual((await action(unknown, {type: 'activate', owner: 'new', proof})).reason, 'BUSY');
  const ack = store('ack-lost'); await open(ack); let executed = false;
  const lost = {read: ack.read, compareAndSet: async (before, after) => {
    assert.strictEqual(await ack.compareAndSet(before, after), true); throw Error('simulated acknowledgement loss');
  }};
  assert.strictEqual((await protocol.execute(lost, binding, identity(1, 'lost'), () => { executed = true; })).executed, false);
  assert.strictEqual(executed, false); assert((await ack.read()).active);
  return {status: 'PASS', collection: plan.collection, documents: plan.documents,
    runtime: process.version, sdk_version: '2.11.0', stale_cas_rejected: true, race_winners: 1,
    drain_and_owner_switch: true, nested_state_cleared: true, unknown_and_ack_loss_retained: true,
    production_writer_invocations: 0, proof_note: 'Fixture evidence only; drain proof flags do not prove production drain.'};
}
async function main(event) {
  assert.deepStrictEqual(event, plan.event, 'only the one fixed verification event is accepted');
  const sdk = require('@cloudbase/node-sdk');
  assert.strictEqual(sdk.version, plan.sdk_version, 'unexpected SDK dependency');
  const context = sdk.getCloudbaseContext();
  assert.strictEqual(context.TCB_ENV || context.SCF_NAMESPACE, plan.environment, 'wrong cloud environment');
  const app = sdk.init({env: sdk.SYMBOL_CURRENT_ENV});
  return verify(app.database());
}
module.exports = {main, verify};
