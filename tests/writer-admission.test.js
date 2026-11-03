'use strict';
const assert = require('assert');
const g = require('../release/writer-admission');
const {createMemoryStore} = require('../scripts/lib/writer-admission-memory-store');
const binding = {environment: 'offline', scope: 'rde'};
const proof = {reference: 'fixture:terminal', entries_closed: true, executions_terminal: true, retries_accounted_for: true};
async function active() {
  const store = createMemoryStore(g.initial(binding));
  assert((await g.apply(store, binding, {type: 'activate', owner: 'old', revision: 0, proof})).ok);
  return store;
}
async function action(store, a) { return g.apply(store, binding, {revision: (await store.read()).revision, ...a}); }
const identity = (revision, id, owner = 'old', epoch = 1) => ({revision, request_id: id, token: 'token:' + id, owner, epoch});
(async () => {
  const store = await active(), rev = (await store.read()).revision;
  let entered = 0, release;
  const blocked = new Promise(resolve => { release = resolve; });
  const run = g.execute(store, binding, identity(rev, 'night'), async () => { entered++; await blocked; return 42; });
  await new Promise(resolve => setImmediate(resolve));
  const rival = await g.execute(store, binding, identity(rev, 'morning'), async () => { entered++; });
  assert.strictEqual(rival.executed, false); assert.strictEqual(entered, 1);
  assert((await action(store, {type: 'drain'})).ok);
  assert.strictEqual((await action(store, {type: 'activate', owner: 'new', proof})).reason, 'BUSY');
  const denied = await g.execute(store, binding, identity((await store.read()).revision, 'admin'), () => { throw Error('must not run'); });
  assert.strictEqual(denied.executed, false);
  release(); assert.strictEqual((await run).outcome, 'COMPLETE');
  assert.strictEqual((await action(store, {type: 'activate', owner: 'new'})).reason, 'DRAIN_PROOF_REQUIRED');
  assert((await action(store, {type: 'activate', owner: 'new', proof})).ok);
  const switched = await store.read(); assert.strictEqual(switched.epoch, 2);
  assert.strictEqual((await g.execute(store, binding, identity(switched.revision, 'late'), () => entered++)).executed, false);
  assert.strictEqual((await g.execute(store, binding, identity(switched.revision, 'night', 'new', 2), () => entered++)).admission, 'ALREADY_COMPLETE');
  assert.strictEqual((await g.execute(store, binding, identity(switched.revision, 'morning', 'new', 2), () => ++entered)).outcome, 'COMPLETE');
  assert.strictEqual(entered, 2, 'distinct legitimate same-day run can execute');

  const lost = await active();
  const unknown = await g.execute(lost, binding, identity(1, 'timeout'), async () => { throw Error('downstream may still be writing'); });
  assert.strictEqual(unknown.outcome, 'UNKNOWN');
  const stuck = await lost.read(); assert.strictEqual(stuck.state, 'HOLD'); assert(stuck.active);
  assert.strictEqual((await action(lost, {type: 'activate', owner: 'new', proof})).reason, 'BUSY');
  assert.strictEqual(g.transition(stuck, {type: 'expire', revision: stuck.revision, now: Number.MAX_SAFE_INTEGER}, binding).reason, 'UNKNOWN_ACTION');
  assert.strictEqual((await action(lost, {...identity(0, 'other'), type: 'finish', revision: stuck.revision})).reason, 'STALE_EXECUTION');

  for (const mode of ['read-fail', 'cas-fail', 'ack-lost']) {
    const base = await active(); let writes = 0;
    const fault = {read: mode === 'read-fail' ? async () => { throw Error('read'); } : base.read,
      compareAndSet: async (before, next) => {
        if (mode === 'cas-fail') return false;
        await base.compareAndSet(before, next); throw Error('ack lost');
      }};
    const r = await g.execute(fault, binding, identity(1, mode), async () => writes++);
    assert.strictEqual(r.executed, false); assert.strictEqual(writes, 0);
    if (mode === 'ack-lost') assert((await base.read()).active, 'ambiguous admission retains slot');
  }
  const full = g.initial(binding); full.state = 'ACTIVE';
  full.receipts = Array.from({length: g.MAX_RECEIPTS}, (_, i) => ({request_id: 'r' + i, token: 't' + i, status: 'COMPLETE'}));
  assert.strictEqual(g.transition(full, {...identity(0, 'overflow', 'old', 0), type: 'admit'}, binding).reason, 'RECEIPT_CAPACITY');
  assert.strictEqual(g.transition(full, {revision: 0, type: 'hold'}, {...binding, environment: 'wrong'}).reason, 'INVALID_CONTROL');
  assert.strictEqual(g.transition(null, {revision: 0, type: 'hold'}, binding).reason, 'INVALID_CONTROL');
  const racing = await active();
  const claims = await Promise.all(Array.from({length: 20}, (_, i) =>
    g.apply(racing, binding, {...identity(1, 'race:' + i), type: 'admit'})));
  assert.strictEqual(claims.filter(r => r.ok).length, 1, 'same snapshot contenders must serialize at CAS');
  const drainRace = await active();
  let intercepted = false;
  const interleaved = {read: drainRace.read, compareAndSet: async (before, next) => {
    if (!intercepted) { intercepted = true; await g.apply(drainRace, binding, {type: 'drain', revision: before.revision}); }
    return drainRace.compareAndSet(before, next);
  }};
  let crossed = false;
  assert.strictEqual((await g.execute(interleaved, binding, identity(1, 'cross-drain'), () => { crossed = true; })).executed, false);
  assert.strictEqual(crossed, false, 'drain between read and CAS must close admission');
  const finishLost = await active();
  let calls = 0;
  const releaseFailure = {read: finishLost.read, compareAndSet: async (before, next) => {
    calls++; if (calls === 2) throw Error('release unavailable');
    return finishLost.compareAndSet(before, next);
  }};
  assert.strictEqual((await g.execute(releaseFailure, binding, identity(1, 'release-failed'), () => 1)).outcome, 'UNKNOWN');
  assert((await finishLost.read()).active, 'failed release cannot open second execution');
  const closed = createMemoryStore(g.initial(binding)); let forced = false;
  assert.strictEqual((await g.execute(closed, binding, {...identity(0, 'force', 'old', 0), force: true}, () => { forced = true; })).executed, false);
  assert.strictEqual(forced, false, 'force is never an admission bypass');
  const businessFailure = await active();
  const settled = await g.execute(businessFailure, binding, identity(1, 'business-failure'), () => ({ok: false}));
  assert.strictEqual(settled.outcome, 'COMPLETE', 'execution settlement is not business success');
  assert.strictEqual(settled.result.ok, false);
  const corruptRelease = await active(); let reads = 0;
  const corrupt = {read: async () => (++reads === 1 ? corruptRelease.read() : null), compareAndSet: corruptRelease.compareAndSet};
  assert.strictEqual((await g.execute(corrupt, binding, identity(1, 'lost-record'), () => 1)).outcome, 'UNKNOWN');
  const exhausted = g.initial(binding); exhausted.revision = Number.MAX_SAFE_INTEGER - 1;
  assert.strictEqual(g.transition(exhausted, {type: 'hold', revision: exhausted.revision}, binding).reason, 'REVISION_EXHAUSTED');
  console.log('Offline admission: concurrent entry, drain, epoch switch, dedup, same-day runs, unknown retention, ambiguous CAS and capacity passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
