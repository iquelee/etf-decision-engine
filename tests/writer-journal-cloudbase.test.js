'use strict';
const assert = require('assert');
const path = require('path');
const g = require('../release/writer-admission-journal');
const adapter = require('../release/writer-journal-cloudbase');
const clone = value => JSON.parse(JSON.stringify(value));
const collection = 'runtime24_journal_probe_offline';
const binding = {environment: 'offline', scope: 'transaction-test'};
const proof = {reference: 'fixture:terminal', entries_closed: true, executions_terminal: true, retries_accounted_for: true};

// Snapshot + conflicting write model at the wire boundary. No authentication,
// sockets or server-side isolation proof. Optional explicit SDK package mode
// exercises the actual captured 1.4.1 database and EJSON serializers.
function backend(EJSON = JSON, namespace = collection) {
  let rows = new Map(), version = 0, sequence = 0;
  const sessions = new Map(), calls = [];
  const state = {fault: null, calls, seed(id, row) { rows.set(id, {_id: id, ...clone(row)}); version++; },
    rows: () => clone([...rows.values()]),
    async send(action, params = {}) {
      calls.push({action, params: clone(params)});
      const fault = state.fault;
      const matches = fault && fault.action === action && (!fault.when || fault.when(params));
      if (matches) { state.fault = null; if (!fault.after) return fail(); }
      function fail() { if (fault.throw) throw Error('simulated wire fault'); return fault.response; }
      const requestId = 'memory:' + calls.length;
      if (action === 'database.startTransaction') {
        const transactionId = 'tx:' + (++sequence);
        sessions.set(transactionId, {rows: new Map([...rows].map(([k, v]) => [k, clone(v)])), version, dirty: false});
        return {requestId, transactionId};
      }
      const tx = params.transactionId ? sessions.get(params.transactionId) : null;
      if (params.transactionId) assert(tx, 'transaction must exist');
      if (action === 'database.abortTransaction') { sessions.delete(params.transactionId); return {requestId}; }
      if (action === 'database.commitTransaction') {
        assert(tx);
        if (tx.dirty && tx.version !== version) { sessions.delete(params.transactionId); return {code: 'DATABASE_TRANSACTION_CONFLICT', requestId}; }
        if (tx.dirty) { rows = tx.rows; version++; }
        sessions.delete(params.transactionId);
        if (matches && fault.after) return fail();
        return {requestId};
      }
      assert.strictEqual(params.collectionName, namespace, 'no unexpected namespace');
      const data = tx ? tx.rows : rows;
      const query = params.query && EJSON.parse(params.query);
      if (query) assert.deepStrictEqual(Object.keys(query), ['_id'], 'doc-only queries');
      if (action === 'database.getDocument') {
        const row = data.get(query._id);
        return {requestId, data: {list: row ? [EJSON.stringify(row)] : [], offset: 0, limit: 1}};
      }
      if (action === 'database.insertDocument') {
        const insertedIds = [];
        for (const raw of params.data) {
          const row = EJSON.parse(raw); assert(!data.has(row._id), 'unique primary key');
          if (!tx) assert(row.kind === 'control' && row.revision === 0, 'only explicit probe fixture bootstrap outside transaction');
          data.set(row._id, row); insertedIds.push(row._id);
        }
        if (tx) tx.dirty = true; else version++;
        return {requestId, data: {insertedIds}};
      }
      assert(tx, 'all updates must be transactional');
      tx.dirty = true;
      assert.strictEqual(action, 'database.modifyDocument');
      assert.strictEqual(params.upsert, false); assert.strictEqual(params.multi, false);
      const update = EJSON.parse(params.data); assert.deepStrictEqual(Object.keys(update), ['$set']);
      const before = data.get(query._id);
      if (before) data.set(query._id, {...before, ...update.$set});
      return {requestId, data: {updated: before ? 1 : 0}};
    }};
  return state;
}
function fakeDatabase(b, environment = binding.environment, namespace = collection) {
  function col(transactionId) { return {doc(docId) { return {
    async get() {
      const r = await b.send('database.getDocument', {collectionName: namespace, query: JSON.stringify({_id: docId}), transactionId});
      if (r.code) return r;
      const rows = r.data.list.map(JSON.parse);
      return {requestId: r.requestId, data: transactionId ? rows[0] || null : rows};
    },
    async create(row) {
      const r = await b.send('database.insertDocument', {collectionName: namespace, transactionId, data: [JSON.stringify({_id: docId, ...row})]});
      return r.code ? r : {requestId: r.requestId, inserted: 1, ok: 1, id: r.data.insertedIds[0]};
    },
    async update(row) {
      const r = await b.send('database.modifyDocument', {collectionName: namespace, transactionId, query: JSON.stringify({_id: docId}),
        data: JSON.stringify({$set: row}), upsert: false, multi: false});
      return r.code ? r : {requestId: r.requestId, updated: r.data.updated};
    }
  }; }}; }
  return {config: {envName: environment, retries: 0, keepalive: false}, collection: () => col(), async startTransaction() {
    const r = await b.send('database.startTransaction'); if (r.code) throw r;
    const transactionId = r.transactionId;
    return {getTransactionId: () => transactionId, collection: () => col(transactionId),
      commit: async () => { const ack = await b.send('database.commitTransaction', {transactionId}); if (ack.code) throw ack; return ack; },
      rollback: async () => { const ack = await b.send('database.abortTransaction', {transactionId}); if (ack.code) throw ack; return ack; }};
  }};
}
async function exercise(make) {
  function setup(scope = binding.scope, seed = true) {
    const {database, b} = make(); const bound = {...binding, scope};
    if (seed) b.seed(adapter.id(bound, 'control'), adapter.encodeControl(g.initial(bound), bound));
    return {b, bound, store: adapter.createStore({database, collection, binding: bound})};
  }
  const apply = async (f, action) => g.apply(f.store, f.bound, {revision: (await f.store.read(f.bound)).revision, ...action});
  const activate = async f => assert((await apply(f, {type: 'activate', owner: 'old', proof})).ok);
  const identity = async (f, name) => { const s = await f.store.read(f.bound); return {revision: s.revision, epoch: s.epoch, owner: s.owner, request_id: name, token: 'token:' + name}; };
  const f = setup(); await activate(f);
  for (let i = 0; i < 140; i++) assert.strictEqual((await g.execute(f.store, f.bound, await identity(f, 'run:' + i), () => ({ok: true}))).outcome, 'COMPLETE');
  assert.strictEqual(f.b.rows().length, 281); assert.deepStrictEqual((await f.store.read(f.bound)).receipts, []);
  let ran = 0;
  assert.strictEqual((await g.execute(f.store, f.bound, await identity(f, 'run:0'), () => { ran++; })).admission, 'ALREADY_COMPLETE');
  const old = await identity(f, 'fresh'); old.token = 'token:run:0';
  assert.strictEqual((await g.execute(f.store, f.bound, old, () => { ran++; })).admission, 'TOKEN_REUSED');
  const race = setup(); await activate(race);
  const identities = await Promise.all(Array.from({length: 20}, (_, i) => identity(race, 'race:' + i)));
  const admitted = await Promise.all(identities.map(i => g.apply(race.store, race.bound, {...i, type: 'admit'})));
  assert.strictEqual(admitted.filter(r => r.ok).length, 1); assert.strictEqual(race.b.rows().length, 3);
  assert.strictEqual(race.b.calls.filter(c => c.action === 'database.startTransaction').length, 21, 'no conflict retry');
  for (const phase of ['admission', 'completion']) for (const after of [false, true]) {
    const x = setup(); await activate(x); const i = await identity(x, 'fault');
    const fault = {action: 'database.commitTransaction', after, throw: true};
    if (phase === 'admission') x.b.fault = fault;
    const result = await g.execute(x.store, x.bound, i, () => { ran++; x.b.fault = fault; return 7; });
    if (phase === 'admission') {
      assert.strictEqual(result.executed, false);
      assert.strictEqual(x.b.rows().length, after ? 3 : 1);
      assert.strictEqual(Boolean((await x.store.read(x.bound)).active), after);
    } else {
      assert.strictEqual(result.outcome, 'UNKNOWN');
      const state = await x.store.read(x.bound);
      assert.strictEqual(Boolean(state.active), !after);
      const receipts = x.b.rows().filter(r => r.kind !== 'control').map(r => JSON.parse(r.payload_json));
      assert(receipts.every(r => r.status === (after ? 'COMPLETE' : 'RUNNING')));
      assert.strictEqual((await g.execute(x.store, x.bound, await identity(x, 'fault'), () => { throw Error('must not run'); })).executed, false);
    }
  }
  assert.strictEqual(ran, 2);
  // One receipt index write fails after control+other index were staged: rollback
  // must retain the old control and expose neither receipt.
  const partial = setup(); await activate(partial);
  partial.b.fault = {action: 'database.insertDocument', when: p => JSON.parse(p.data[0]).kind === 'token', response: {code: 'DENIED'}};
  assert.strictEqual((await g.execute(partial.store, partial.bound, await identity(partial, 'partial'), () => { ran++; })).executed, false);
  assert.strictEqual(partial.b.rows().length, 1); assert.strictEqual((await partial.store.read(partial.bound)).active, null);
  const missing = setup('missing', false);
  assert.strictEqual((await g.apply(missing.store, missing.bound, {type: 'activate', revision: 0, owner: 'old', proof})).ok, false);
  assert.strictEqual(missing.b.rows().length, 0);
  assert.strictEqual((await g.apply(f.store, {...f.bound, environment: 'other'}, {type: 'hold', revision: 1})).ok, false);
  const corrupt = setup(); await activate(corrupt);
  const row = f.b.rows().find(r => r.kind === 'request');
  corrupt.b.seed(row._id, {...row, payload_json: row.payload_json.replace('COMPLETE', 'UNKNOWN')});
  assert.strictEqual((await g.execute(corrupt.store, corrupt.bound, await identity(corrupt, 'run:0'), () => { ran++; })).executed, false);
  assert.strictEqual(ran, 2);
  assert.throws(() => adapter.createStore({database: make().database, collection: 'production_receipts', binding}));
  for (const config of [{keepalive: true}, {retries: 1}, {envName: 'other'}]) {
    const database = make().database; Object.assign(database.config, config);
    assert.throws(() => adapter.createStore({database, collection, binding}));
  }
  for (const response of [{requestId: 'zero', data: {updated: 0}}, {code: 'DENIED', requestId: 'deny'}]) {
    const x = setup(); await activate(x);
    x.b.fault = {action: 'database.modifyDocument', response};
    assert.strictEqual((await g.execute(x.store, x.bound, await identity(x, 'bad-ack'), () => { ran++; })).executed, false);
    assert.strictEqual(x.b.rows().length, 1); assert.strictEqual((await x.store.read(x.bound)).active, null);
  }
  assert.strictEqual(ran, 2);
  return {retained_receipts: 140, index_documents: 280, contenders: 20, conflict_retries: 0, admission_completion_ack_faults: 4,
    partial_write_rollback: true, production_namespaces_rejected: true, network: false};
}
async function probeReplay(make) {
  const probe = require('../release/runtime24-journal-probe');
  const plan = require('../release/runtime24-journal-probe-plan.json');
  const {database, b} = make({namespace: plan.collection, environment: plan.environment});
  const invoke = (phase, rest = {}) => probe.verify(database, {case: 'journal-v2', phase, ...rest});
  for (const event of [null, {}, {case: 'journal-v2', phase: 'audit', collection: 'other'},
    {case: 'journal-v2', phase: 'race', contender: 8}, {case: 'journal-v2', phase: 'durable', batch: 17},
    {case: 'journal-v2', phase: 'audit', tcbContext: {x: 1}}]) assert.throws(() => probe.validateEvent(event));
  assert.deepStrictEqual(probe.validateEvent({case: 'journal-v2', phase: 'audit', tcbContext: {}, userInfo: {}}), {case: 'journal-v2', phase: 'audit'});
  await invoke('initialize');
  const before = b.rows(); await assert.rejects(invoke('initialize')); assert.deepStrictEqual(b.rows(), before, 'no fixture reset');
  const race = await Promise.all(Array.from({length: 8}, (_, contender) => invoke('race', {contender})));
  assert.strictEqual(race.filter(r => r.admitted).length, 1);
  await invoke('finalize');
  for (let batch = 0; batch < 17; batch++) await invoke('durable', {batch});
  await invoke('unknown'); await invoke('audit');
  const rows = b.rows(); assert.strictEqual(rows.length, 279);
  const byId = new Map(rows.map(r => [r._id, r]));
  const requests = rows.filter(r => r.kind === 'request'); assert.strictEqual(requests.length, 138);
  for (const row of requests) {
    const receipt = JSON.parse(row.payload_json), bound = {environment: receipt.environment, scope: receipt.scope};
    assert.deepStrictEqual(adapter.decode(row, adapter.id(bound, 'request', receipt.request_id), bound, 'request'), receipt);
    assert.deepStrictEqual(adapter.decode(byId.get(adapter.id(bound, 'token', receipt.token)), adapter.id(bound, 'token', receipt.token), bound, 'token'), receipt);
  }
  assert.strictEqual(requests.filter(r => JSON.parse(r.payload_json).status === 'COMPLETE').length, 137);
  assert.strictEqual(requests.filter(r => JSON.parse(r.payload_json).status === 'UNKNOWN').length, 1);
  return {fixed_probe_replay: true, fixed_probe_documents: rows.length, completed_receipts: 137, unknown_receipts: 1,
    real_multi_instance_proof: false, wire_requests: b.calls.length};
}
async function main() {
  const args = process.argv.slice(2);
  if (!args.length) {
    const make = (opts = {}) => { const b = backend(JSON, opts.namespace); return {b, database: fakeDatabase(b, opts.environment, opts.namespace)}; };
    const result = await exercise(make);
    console.log(JSON.stringify({transport: 'MODEL_ONLY', ...result, ...await probeReplay(make)})); return;
  }
  assert(args.length === 4 && args[0] === '--package' && args[2] === '--file-map');
  const {verifyPackage} = require('../scripts/lib/verified-writer-package');
  const {root} = verifyPackage(path.resolve(args[1]), path.resolve(args[3]));
  assert.strictEqual(require(path.join(root, 'node_modules/@cloudbase/node-sdk/package.json')).version, '2.11.0');
  assert.strictEqual(require(path.join(root, 'node_modules/@cloudbase/database/package.json')).version, '1.4.1');
  const {Db} = require(path.join(root, 'node_modules/@cloudbase/database'));
  const {EJSON} = require(path.join(root, 'node_modules/bson'));
  const original = Db.reqClass;
  try {
    const transports = new Map();
    Db.reqClass = class {
      constructor(config) { this.transport = transports.get(config.transportKey); assert(this.transport, 'unbound transport'); }
      send(action, params) { return this.transport.send(action, params); }
    };
    const make = (opts = {}) => {
      const b = backend(EJSON, opts.namespace);
      const env = 'offline-wire-' + transports.size;
      transports.set(env, b);
      return {b, database: new Db({envName: opts.environment || binding.environment, transportKey: env, retries: 0, keepalive: false, throwOnCode: true})};
    };
    const result = await exercise(make), probe = await probeReplay(make);
    verifyPackage(root, path.resolve(args[3]));
    console.log(JSON.stringify({runtime: process.version, sdk: '2.11.0', database: '1.4.1', transport: 'REAL_SDK_MEMORY_WIRE', ...result, ...probe}));
  } finally { Db.reqClass = original; }
}
module.exports = {backend, exercise};
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
