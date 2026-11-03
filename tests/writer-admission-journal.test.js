'use strict';
const assert = require('assert');
const path = require('path');
const g = require('../release/writer-admission-journal');
const {createHarness} = require('../scripts/lib/rde-offline-harness');
const copy = value => JSON.parse(JSON.stringify(value));
const binding = {environment: 'offline', scope: 'rde'};
const proof = {reference: 'fixture:terminal', entries_closed: true, executions_terminal: true, retries_accounted_for: true};

// Executable reference for atomicity, NOT a database adapter. The synchronous
// critical section is valid only in this single-process offline test.
function fixture() {
  let control = g.initial(binding), rows = new Map(), fault = null;
  const store = {
    read: async b => { assert.deepStrictEqual(b, binding); return copy(control); },
    transaction: async (b, callback) => {
      assert.deepStrictEqual(b, binding);
      const draft = new Map([...rows].map(([k, v]) => [k, copy(v)]));
      const change = callback({control: copy(control), findRequest: id => copy(draft.get(id) || null),
        findToken: token => copy([...draft.values()].find(r => r.token === token) || null)});
      if (!change) return true;
      if (change.receipt) {
        const r = change.receipt, old = draft.get(r.request_id);
        assert(!old || (old.status !== 'COMPLETE' && old.token === r.token && old.owner === r.owner && old.epoch === r.epoch));
        assert(![...draft.values()].some(v => v.token === r.token && v.request_id !== r.request_id));
        draft.set(r.request_id, copy(r));
      }
      if (fault === 'before') { fault = null; throw Error('before commit'); }
      control = copy(change.control); rows = draft;
      if (fault === 'after') { fault = null; throw Error('ack lost after atomic commit'); }
      return true;
    }
  };
  return {store, fail: value => { fault = value; }, rows: () => [...rows.values()]};
}
async function activate(f, owner = 'old') {
  const s = await f.store.read(binding);
  assert((await g.apply(f.store, binding, {type: 'activate', owner, proof, revision: s.revision})).ok);
}
async function identity(f, id, extras = {}) {
  const s = await f.store.read(binding);
  return {owner: s.owner, epoch: s.epoch, revision: s.revision, request_id: id, token: 'token:' + id, ...extras};
}
async function test() {
  const f = fixture(); await activate(f);
  for (let i = 0; i < 300; i++) {
    const result = await g.execute(f.store, binding, await identity(f, 'run:' + i), async () => ({ok: false}));
    assert.strictEqual(result.outcome, 'COMPLETE');
    assert.strictEqual(result.result.ok, false, 'terminal receipt does not imply business success');
    assert.deepStrictEqual((await f.store.read(binding)).receipts, []);
  }
  assert.strictEqual(f.rows().length, 300);
  let calls = 0;
  assert.strictEqual((await g.execute(f.store, binding, await identity(f, 'run:0'), () => { calls++; })).admission, 'ALREADY_COMPLETE');
  assert.strictEqual((await g.execute(f.store, binding, await identity(f, 'fresh', {token: 'token:run:0'}), () => { calls++; })).admission, 'TOKEN_REUSED');
  const s = await f.store.read(binding);
  assert((await g.apply(f.store, binding, {type: 'drain', revision: s.revision})).ok);
  await activate(f, 'new');
  // New entry instance over retained storage: historical evidence survives epoch
  // change and an empty process-local cache.
  const entry = g.createEntry({store: f.store, binding, resolveIdentity: () => identity(f, 'run:0'), main: () => { calls++; }});
  assert.strictEqual((await entry({}, {})).admission, 'ALREADY_COMPLETE'); assert.strictEqual(calls, 0);

  for (const failure of ['before', 'after']) {
    const x = fixture(); await activate(x); x.fail(failure);
    assert.strictEqual((await g.execute(x.store, binding, await identity(x, failure), () => { calls++; })).executed, false);
    assert.strictEqual(calls, 0);
    assert.strictEqual(x.rows().length, failure === 'before' ? 0 : 1);
    assert.strictEqual(Boolean((await x.store.read(binding)).active), failure === 'after');
  }
  // Completion fault never exposes control without its permanent receipt.
  for (const failure of ['before', 'after']) {
    const x = fixture(); await activate(x);
    const id = await identity(x, 'completion');
    assert.strictEqual((await g.execute(x.store, binding, id, () => { x.fail(failure); return 7; })).outcome, 'UNKNOWN');
    const state = await x.store.read(binding);
    assert.strictEqual(Boolean(state.active), failure === 'before');
    assert.strictEqual(x.rows()[0].status, failure === 'before' ? 'RUNNING' : 'COMPLETE');
    assert.strictEqual((await g.execute(x.store, binding, await identity(x, 'completion'), () => { calls++; })).executed, false);
  }
  const unknown = fixture(); await activate(unknown);
  assert.strictEqual((await g.execute(unknown.store, binding, await identity(unknown, 'throw'), () => { throw Error('callee'); })).outcome, 'UNKNOWN');
  assert.strictEqual((await unknown.store.read(binding)).state, 'HOLD');
  assert.strictEqual(unknown.rows()[0].status, 'UNKNOWN');
  assert.strictEqual((await g.apply(unknown.store, binding, {type: 'activate', revision: 3, owner: 'new', proof})).reason, 'BUSY');

  const race = fixture(); await activate(race);
  const ids = await Promise.all(Array.from({length: 20}, (_, i) => identity(race, 'race:' + i)));
  const contenders = await Promise.all(ids.map(id => g.apply(race.store, binding, {...id, type: 'admit'})));
  assert.strictEqual(contenders.filter(r => r.ok).length, 1);
  assert.strictEqual(race.rows().length, 1);
  assert.strictEqual((await g.apply(race.store, {...binding, scope: 'other'}, {type: 'hold', revision: 2})).ok, false);

  const root = path.resolve(__dirname, '../cloudfunctions/runDecisionEngine');
  const common = path.resolve(__dirname, '../src/common');
  const baseline = createHarness(root, {common}), actual = createHarness(root, {common});
  const expected = await baseline.run(), integration = fixture(); await activate(integration);
  let resolved = null;
  const guarded = g.createEntry({store: integration.store, binding, resolveIdentity: () => resolved, main: actual.entry.main});
  assert.strictEqual((await guarded({}, {})).admission, 'IDENTITY_UNAVAILABLE'); assert.strictEqual(actual.writes.length, 0);
  resolved = await identity(integration, 'morning:2026-10-29', {owner: 'new'});
  assert.strictEqual((await guarded({}, {})).executed, false); assert.strictEqual(actual.writes.length, 0);
  resolved = await identity(integration, 'morning:2026-10-29');
  const result = await guarded({}, {});
  assert.strictEqual(result.outcome, 'COMPLETE');
  assert.deepStrictEqual(copy(result.result), copy(expected)); assert.deepStrictEqual(actual.writes, baseline.writes);
  for (const name of new Set(actual.writes.map(r => r.collection))) assert.deepStrictEqual(actual.rows(name), baseline.rows(name));
  const count = actual.writes.length;
  resolved = await identity(integration, 'morning:2026-10-29');
  assert.strictEqual((await guarded({}, {})).admission, 'ALREADY_COMPLETE'); assert.strictEqual(actual.writes.length, count);
  console.log(JSON.stringify({durable_contract: 'MEMORY_REFERENCE_ONLY', retained_receipts: 300, contenders: 20,
    whole_entry_writes: count, atomic_faults: 'before/after admission and completion', production_imports: false}));
}
if (require.main === module) test().catch(error => { console.error(error); process.exitCode = 1; });
