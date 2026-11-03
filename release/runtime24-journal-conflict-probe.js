'use strict';
const assert = require('assert');
const {isDeepStrictEqual} = require('util');
const v1 = require('./writer-admission');
const g = require('./writer-admission-journal');
const a = require('./writer-journal-cloudbase');
const plan = require('./runtime24-journal-conflict-plan.json');
const binding = {environment: plan.environment, scope: plan.scope};
const proof = {reference: 'isolated-forced-snapshot', entries_closed: true, executions_terminal: true, retries_accounted_for: true};
function validateEvent(event) {
  assert(event && typeof event === 'object' && !Array.isArray(event));
  const e = {...event};
  for (const key of Object.keys(plan.accepted_platform_metadata)) if (Object.prototype.hasOwnProperty.call(e, key)) {
    assert.deepStrictEqual(e[key], {}); delete e[key];
  }
  assert.deepStrictEqual(e, plan.event);
}
async function verify(database) {
  const store = a.createStore({database, collection: plan.collection, binding});
  const controlId = a.id(binding, 'control');
  function checked(r) {
    if (r && r.code) throw r;
    assert(r && typeof r.requestId === 'string' && r.requestId.length, 'ambiguous SDK acknowledgement');
    return r;
  }
  async function read(doc, id, kind, tx = false) {
    const r = checked(await doc.get());
    if (tx) { assert(r.data === null || (r.data && !Array.isArray(r.data))); return a.decode(r.data, id, binding, kind); }
    assert(Array.isArray(r.data) && r.data.length <= 1);
    return a.decode(r.data[0] || null, id, binding, kind);
  }
  const col = database.collection(plan.collection);
  const ids = request => ({request: a.id(binding, 'request', request), token: a.id(binding, 'token', 'token:' + request)});
  // Unique, new scope only. Never read/modify old scopes as a migration shortcut.
  assert.strictEqual(await store.read(binding), null, 'fixture already exists');
  for (const request of ['forced', 'rolled-back']) for (const kind of ['request', 'token'])
    assert.strictEqual(await read(col.doc(ids(request)[kind]), ids(request)[kind], kind), null);
  const created = checked(await col.doc(controlId).create(a.encodeControl(g.initial(binding), binding)));
  assert.strictEqual(created.id, controlId);
  assert((await g.apply(store, binding, {type: 'activate', revision: 0, owner: 'old', proof})).ok);
  function admission(control, request) {
    const identity = {revision: control.revision, owner: 'old', epoch: 1, request_id: request, token: 'token:' + request};
    const transition = v1.transition(control, {...identity, type: 'admit'}, binding); assert(transition.ok);
    return {control: transition.next, receipt: {...binding, owner: 'old', epoch: 1,
      request_id: request, token: 'token:' + request, status: 'RUNNING'}};
  }
  async function stage(tx, change) {
    const c = tx.collection(plan.collection);
    assert.strictEqual(checked(await c.doc(controlId).update(a.encodeControl(change.control, binding))).updated, 1);
    for (const kind of ['request', 'token']) {
      const id = ids(change.receipt.request_id)[kind];
      const ack = checked(await c.doc(id).create(a.encodeReceipt(change.receipt, binding, kind)));
      assert(ack.inserted === 1 && ack.ok === 1 && ack.id === id);
    }
  }
  async function rollback(tx) {
    if (tx && !tx.commited && !tx.aborted) { try { await tx.rollback(); } catch (_) { /* preserve failure */ } }
  }
  let first, stale, firstCommitAttempted = false, conflictCode;
  try {
    first = await database.startTransaction(); stale = await database.startTransaction();
    assert(first.getTransactionId() && stale.getTransactionId() && first.getTransactionId() !== stale.getTransactionId());
    const c1 = first.collection(plan.collection), c2 = stale.collection(plan.collection);
    const s1 = await read(c1.doc(controlId), controlId, 'control', true);
    const s2 = await read(c2.doc(controlId), controlId, 'control', true);
    assert(s1.revision === 1 && isDeepStrictEqual(s1, s2), 'both snapshots must precede the first commit');
    for (const c of [c1, c2]) for (const kind of ['request', 'token'])
      assert.strictEqual(await read(c.doc(ids('forced')[kind]), ids('forced')[kind], kind, true), null);
    await stage(first, admission(s1, 'forced'));
    firstCommitAttempted = true; checked(await first.commit());
    // Stale already read revision1 BEFORE first committed revision2. This
    // reaches the platform write conflict, rather than protocol STALE_REVISION.
    try {
      checked(await c2.doc(controlId).update(a.encodeControl(admission(s2, 'forced').control, binding)));
    } catch (error) { conflictCode = error && error.code; }
    await rollback(stale);
    assert.strictEqual(conflictCode, 'DATABASE_TRANSACTION_CONFLICT', 'native snapshot conflict was not observed');
  } catch (error) {
    if (!firstCommitAttempted) await rollback(first);
    await rollback(stale); throw error;
  }
  const occupied = await store.read(binding);
  assert(occupied.revision === 2 && occupied.active && occupied.active.request_id === 'forced');
  for (const kind of ['request', 'token']) {
    const receipt = await read(col.doc(ids('forced')[kind]), ids('forced')[kind], kind);
    assert(receipt && receipt.status === 'RUNNING');
  }
  assert((await g.apply(store, binding, {...occupied.active, revision: 2, type: 'finish'})).ok);
  const terminal = await store.read(binding); assert(terminal.revision === 3 && terminal.active === null);
  let aborted;
  try {
    aborted = await database.startTransaction(); const c = aborted.collection(plan.collection);
    assert.deepStrictEqual(await read(c.doc(controlId), controlId, 'control', true), terminal);
    for (const kind of ['request', 'token']) assert.strictEqual(await read(c.doc(ids('rolled-back')[kind]), ids('rolled-back')[kind], kind, true), null);
    await stage(aborted, admission(terminal, 'rolled-back'));
    checked(await aborted.rollback());
  } catch (error) { await rollback(aborted); throw error; }
  assert.deepStrictEqual(await store.read(binding), terminal, 'rollback must restore original control');
  for (const kind of ['request', 'token']) {
    assert.strictEqual(await read(col.doc(ids('rolled-back')[kind]), ids('rolled-back')[kind], kind), null, 'rolled-back index must be absent');
    const receipt = await read(col.doc(ids('forced')[kind]), ids('forced')[kind], kind);
    assert(receipt && receipt.status === 'COMPLETE');
  }
  assert.strictEqual((await g.execute(store, binding, {revision: 3, owner: 'old', epoch: 1, request_id: 'forced', token: 'token:forced'},
    () => { throw Error('duplicate handler entered'); })).admission, 'ALREADY_COMPLETE');
  return {status: 'PASS', native_conflict_code: conflictCode, forced_common_snapshot_revision: 1,
    committed_control_and_dual_indexes: true, explicit_three_document_rollback: true,
    control_revision: 3, retained_complete_receipts: 1, expected_new_documents: 3,
    real_network_fault_injection: false, production_writer_invocations: 0};
}
async function main(event) {
  validateEvent(event);
  const sdk = require('@cloudbase/node-sdk');
  assert.strictEqual(sdk.version, plan.sdk_version);
  assert.strictEqual(require('@cloudbase/database/package.json').version, plan.database_version);
  const context = sdk.getCloudbaseContext();
  assert.strictEqual(context.TCB_ENV || context.SCF_NAMESPACE, plan.environment);
  const app = sdk.init({env: plan.environment, retries: 0, keepalive: false, throwOnCode: true});
  return {runtime: process.version, sdk: plan.sdk_version, database: plan.database_version, ...await verify(app.database())};
}
module.exports = {main, verify, validateEvent};
