'use strict';
const assert = require('assert');
const protocol = require('../release/writer-admission');
const adapter = require('../release/writer-admission-cloudbase');
const {verify, main} = require('../release/runtime24-admission-probe');
const plan = require('../release/runtime24-admission-probe-plan.json');
const {createDatabase} = require('../scripts/lib/admission-probe-memory-db');
const binding = {environment: plan.environment, scope: plan.scope};
const options = database => ({database, collection: plan.collection, document: 'probe:cas', binding});
(async () => {
  const db = createDatabase(); const result = await verify(db);
  assert.strictEqual(result.status, 'PASS'); assert.strictEqual(result.race_winners, 1);
  assert.strictEqual(db.calls.filter(r => r.action === 'add').length, 5);
  for (const call of db.calls.filter(r => r.action === 'update')) {
    assert.strictEqual(call.collection, plan.collection);
    assert(plan.documents.includes(call.filter._id));
    assert.strictEqual(typeof call.filter.payload_json, 'string');
    assert.strictEqual(typeof call.values.payload_json, 'string');
    assert.strictEqual(call.values.revision, call.filter.revision + 1);
    assert(!Object.keys(call.values).includes('_id'));
  }
  const count = db.calls.filter(r => r.action !== 'get').length;
  await assert.rejects(() => verify(db), /fixture already present/);
  assert.strictEqual(db.calls.filter(r => r.action !== 'get').length, count, 'repeated run cannot reset evidence');
  await assert.rejects(() => main({case: 'anything-else'}), /fixed verification event/);
  assert.throws(() => adapter.createStore({...options(db), collection: 'active_run_pointer'}));
  assert.throws(() => adapter.createStore({...options(db), document: 'production'}));
  const empty = createDatabase(), store = adapter.createStore(options(empty));
  assert.strictEqual(await store.read(), null);
  assert.strictEqual(empty.calls.filter(r => r.action === 'add').length, 0, 'read never bootstraps');

  const seed = protocol.initial(binding);
  const after = protocol.transition(seed, {type: 'hold', revision: 0}, binding).next;
  for (const updated of [0, 2, '1', true, undefined]) {
    let updates = 0;
    const badAck = {collection: () => ({where: () => ({update: async () => { updates++; return {updated}; }})})};
    assert.strictEqual(await adapter.createStore(options(badAck)).compareAndSet(seed, after), false);
    assert.strictEqual(updates, 1);
  }
  const missingReadback = {collection: () => ({where: () => ({update: async () => ({updated: 1})}),
    doc: () => ({get: async () => { throw Error('readback unavailable'); }})})};
  await assert.rejects(() => adapter.createStore(options(missingReadback)).compareAndSet(seed, after));
  const malformed = {collection: () => ({doc: () => ({get: async () => ({data: [{_id: 'probe:cas',
    ...adapter.encode(seed, binding), revision: 99}]})})})};
  await assert.rejects(() => adapter.createStore(options(malformed)).read(), /corrupt envelope/);
  const stale = createDatabase(); await stale.collection(plan.collection).add({_id: 'probe:cas', ...adapter.encode(seed, binding)});
  const concurrent = adapter.createStore(options(stale));
  assert.strictEqual(await concurrent.compareAndSet(seed, after), true);
  assert.strictEqual(await concurrent.compareAndSet(seed, after), false);
  console.log('Isolated adapter/probe: exact full-state CAS, readback, scalar storage, bounded IDs, stale/ambiguous acknowledgements and no fixture reset passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
