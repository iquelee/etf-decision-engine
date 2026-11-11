'use strict';
// Offline adapter candidate. Constructed only with an explicitly supplied SDK
// database; no init, collection creation, scheduler or production import.
const assert = require('assert');
const {isDeepStrictEqual} = require('util');
const plan = require('./writer-dispatch-plan');
const journal = require('./writer-journal-cloudbase');
const admission = require('./writer-admission');
const entry = require('./writer-entry');
const {canonical} = require('./writer-admission-cloudbase');
const clone = x => JSON.parse(JSON.stringify(x));
const collection = journal.productionNamespace.collection;
const validId = id => assert(typeof id === 'string' && /^dispatch:[a-f0-9]{64}$/.test(id), 'fixed dispatch job ID required');
function encode(job) {
  plan.validate(job);
  return {schema: 1, kind: 'dispatch', environment: plan.environment, scope: plan.parentBinding.scope,
    job_id: job.spec.id, revision: job.revision, state: job.state, payload_json: canonical(job)};
}
function decode(row, id) {
  if (row === null) return null;
  assert(row && typeof row.payload_json === 'string');const job = JSON.parse(row.payload_json);
  assert.strictEqual(job.spec.id, id);assert.deepStrictEqual(row, {_id: id, ...encode(job)}, 'corrupt dispatch envelope');return job;
}
function createStore(options) {
  assert(options && typeof options === 'object');assert.deepStrictEqual(Object.keys(options), ['database']);
  const {database} = options;
  assert(database && typeof database.startTransaction === 'function' && typeof database.collection === 'function');
  assert(database.config && database.config.envName === plan.environment);
  assert(database.config.retries === 0 && database.config.keepalive === false, 'no SDK retries or reused-socket resend');
  const okay = r => assert(r && !r.code && typeof r.requestId === 'string' && r.requestId.length, 'ambiguous SDK acknowledgement');
  async function row(col, id, transactional) {
    const r = await col.doc(id).get();okay(r);
    if (transactional) {assert(r.data === null || (r.data && typeof r.data === 'object' && !Array.isArray(r.data)));return r.data;}
    assert(Array.isArray(r.data) && r.data.length <= 1);return r.data[0] || null;
  }
  async function update(col, id, payload) {const ack = await col.doc(id).update(payload);okay(ack);assert.strictEqual(ack.updated, 1);}
  async function loadControl(col, binding) {
    const id = journal.id(binding, 'control');return journal.decode(await row(col, id, true), id, binding, 'control');
  }
  async function receipts(col, parent) {
    const binding = plan.parentBinding, result = {};
    for (const kind of ['request', 'token']) {
      const id = journal.id(binding, kind, parent[kind === 'request' ? 'request_id' : 'token']);
      result[kind] = journal.decode(await row(col, id, true), id, binding, kind);
      if (result[kind]) for (const [k, v] of Object.entries(parent)) assert.strictEqual(result[kind][k], v);
    }
    assert(isDeepStrictEqual(result.request, result.token), 'parent receipt index divergence');return result;
  }
  async function transaction(stage, operation) {
    let tx, commitAttempted = false, rollbackAttempted = false;
    try {
      tx = await database.startTransaction();assert(tx && typeof tx.getTransactionId() === 'string' && tx.getTransactionId().length);
      const result = await operation(tx.collection(collection));
      if (!result.changed) {rollbackAttempted = true;okay(await tx.rollback());return {acknowledged: true, ...result.value};}
      commitAttempted = true;okay(await tx.commit());return {acknowledged: true, ...result.value};
    } catch (cause) {
      // Once commit was sent, do not rollback, compensate, retry, read back to
      // infer permission to send, or release a reservation.
      if (tx && !commitAttempted && !rollbackAttempted) {rollbackAttempted = true;try {await tx.rollback();} catch (_) {}}
      const error = new Error('DISPATCH_STORAGE_UNAVAILABLE');error.stage = stage;error.commitAttempted = commitAttempted;error.cause = cause;throw error;
    }
  }
  function verifyWire(job, key) {
    assert(Buffer.isBuffer(key) && key.length === 32, 'explicit child signing key required');
    entry.authenticate(job.wire, {binding: {environment: plan.environment, scope: 'production/' + job.spec.target},
      target: job.spec.target + 'Node24', owner: 'new', key});
  }
  return {
    async read(id) {validId(id);return decode(await row(database.collection(collection), id, false), id);},
    async prepare(spec) {
      const fresh = plan.prepare(null, spec);spec = clone(fresh.spec);validId(spec.id);
      return transaction('prepare', async col => {
        const current = decode(await row(col, spec.id, true), spec.id);
        if (current) {plan.prepare(current, spec);return {changed: false, value: {created: false, job: clone(current)}};}
        const control = await loadControl(col, plan.parentBinding), p = spec.parent;
        assert(control && control.state === 'ACTIVE' && control.owner === p.owner && control.epoch === p.epoch);
        assert(control.active && ['request_id', 'token', 'owner', 'epoch'].every(k => control.active[k] === p[k]), 'authenticated running parent required');
        const indexes = await receipts(col, p);assert(indexes.request && indexes.request.status === 'RUNNING');
        assert(control.receipts.length === 1 && control.receipts[0].status === 'RUNNING');
        assert(control.revision < Number.MAX_SAFE_INTEGER - 1);
        // Conflict against a simultaneous parent finish/unknown/owner operation.
        const fence = {...clone(control), revision: control.revision + 1};
        await update(col, journal.id(plan.parentBinding, 'control'), journal.encodeControl(fence, plan.parentBinding));
        const ack = await col.doc(spec.id).create(encode(fresh));okay(ack);
        assert(ack.inserted === 1 && ack.ok === 1 && ack.id === spec.id);
        return {changed: true, value: {created: true, job: clone(fresh)}};
      });
    },
    async claim(id, key, reservation) {
      validId(id);assert(Buffer.isBuffer(key) && key.length === 32);
      key = Buffer.from(key);
      return transaction('claim', async col => {
        const current = decode(await row(col, id, true), id);
        if (!current) return {changed: false, value: {claimed: false, reason: 'JOB_NOT_FOUND'}};
        if (current.state !== 'PREPARED') return {changed: false, value: {claimed: false, reason: 'NO_AUTOMATIC_RETRY'}};
        let queueFence;
        if (reservation !== undefined) {
          const queue = require('./writer-dispatch-queue');
          queueFence = queue.fence(queue.decode(await row(col, queue.controlId, true)), reservation);
        }
        const childBinding = {environment: plan.environment, scope: 'production/' + current.spec.target};
        const parentControl = await loadControl(col, plan.parentBinding), childControl = await loadControl(col, childBinding);
        const indexes = await receipts(col, current.spec.parent), rawRollout = await row(col, 'rollout:adminGateway', true);
        let rollout = null;
        if (rawRollout) {assert.strictEqual(rawRollout._id, 'rollout:adminGateway');const {_id, ...value} = rawRollout;rollout = value;}
        const change = plan.claim(current, {parentControl, childControl, requestReceipt: indexes.request, tokenReceipt: indexes.token, rollout}, key);
        if (!change.ok) return {changed: false, value: {claimed: false, reason: change.reason}};
        verifyWire(change.next, key);
        // Every fence and the job are written in the SAME manual transaction.
        await update(col, journal.id(plan.parentBinding, 'control'), journal.encodeControl(change.parentFence, plan.parentBinding));
        await update(col, journal.id(childBinding, 'control'), journal.encodeControl(change.childFence, childBinding));
        await update(col, 'rollout:adminGateway', change.rolloutFence);
        await update(col, id, encode(change.next));
        if (queueFence) {const queue = require('./writer-dispatch-queue');await update(col, queue.controlId, queue.encode(queueFence));}
        return {changed: true, value: {claimed: true, job: clone(change.next),
          ...(queueFence ? {reservation: require('./writer-dispatch-queue').permit(queueFence)} : {})}};
      });
    },
    async settle(claimed, response, key) {
      plan.validate(claimed);assert.strictEqual(claimed.state, 'CLAIMED');verifyWire(claimed, key);
      claimed = clone(claimed);key = Buffer.from(key);
      try {response = clone(response);} catch (_) {response = null;}
      return transaction('settle', async col => {
        const current = decode(await row(col, claimed.spec.id, true), claimed.spec.id);
        assert(isDeepStrictEqual(current, claimed), 'claim changed or already terminal');
        const next = plan.settle(current, response);let holdConfirmed = null;
        if (next.state === 'HOLD') {
          holdConfirmed = true;
          const childBinding = {environment: plan.environment, scope: 'production/' + next.spec.target};
          for (const [binding, identity] of [[plan.parentBinding, next.spec.parent], [childBinding, next.wire]]) {
            const control = await loadControl(col, binding);assert(control, 'missing control during reconciliation');
            if (control.owner !== identity.owner || control.epoch !== identity.epoch) {holdConfirmed = false;continue;}
            if (control.state === 'HOLD') continue;
            const held = admission.transition(control, {type: 'hold', revision: control.revision}, binding);assert(held.ok);
            await update(col, journal.id(binding, 'control'), journal.encodeControl(held.next, binding));
          }
        }
        await update(col, claimed.spec.id, encode(next));
        return {changed: true, value: {job: clone(next), hold_confirmed: holdConfirmed}};
      });
    }
  };
}
module.exports = {collection, encode, decode, createStore};
