'use strict';
// Offline candidate. Fixed journal namespace; no auto-create, lease or takeover.
const assert = require('assert'), crypto = require('crypto');
const {isDeepStrictEqual} = require('util');
const plan = require('./writer-dispatch-plan');
const {canonical} = require('./writer-admission-cloudbase');
const {productionNamespace} = require('./writer-journal-cloudbase');
const controlId = 'dispatch-queue:control', scope = 'production/writer-dispatch';
const clone = x => JSON.parse(JSON.stringify(x));
const jobId = x => x === null || (typeof x === 'string' && /^dispatch:[a-f0-9]{64}$/.test(x));
const cycleId = x => typeof x === 'string' && /^scheduled:[a-f0-9]{64}$/.test(x);
const receiptId = id => {assert(cycleId(id));return 'dispatch-cycle:' + crypto.createHash('sha256').update(id).digest('hex');};
function validate(c) {
  assert(c && c.schema === 1 && c.environment === plan.environment && c.scope === scope);
  assert.deepStrictEqual(Object.keys(c).sort(), ['active','after','environment','revision','schema','scope','state']);
  assert(Number.isSafeInteger(c.revision) && c.revision >= 0 && c.revision < Number.MAX_SAFE_INTEGER - 1 && jobId(c.after));
  assert(['OPEN','BUSY','HOLD'].includes(c.state));assert(c.state === 'OPEN' ? c.active === null : cycleId(c.active));return c;
}
function encode(c) {validate(c);return {schema: 1, kind: 'dispatch_queue_control', environment: plan.environment, scope, payload_json: canonical(c)};}
function decode(row) {assert(row && typeof row.payload_json === 'string');const c = JSON.parse(row.payload_json);assert.deepStrictEqual(row, {_id: controlId, ...encode(c)});return c;}
function permit(c) {validate(c);assert.strictEqual(c.state, 'BUSY');return {cycle_id: c.active, revision: c.revision};}
function fence(c, p) {validate(c);assert.deepStrictEqual(permit(c), p);return {...clone(c), revision: c.revision + 1};}
function cycle(cycle, status) {assert(cycleId(cycle));assert(['RUNNING','COMPLETE','HOLD'].includes(status));return {schema: 1, kind: 'dispatch_cycle', environment: plan.environment, scope, cycle_id: cycle, status};}
function createQueue({database}) {
  assert(database && database.config && database.config.envName === plan.environment && database.config.retries === 0 && database.config.keepalive === false);
  const okay = r => assert(r && !r.code && typeof r.requestId === 'string' && r.requestId.length);
  async function row(col, id) {const r = await col.doc(id).get();okay(r);assert(r.data === null || (r.data && !Array.isArray(r.data)));return r.data;}
  async function update(col, id, data) {const r = await col.doc(id).update(data);okay(r);assert.strictEqual(r.updated, 1);}
  async function tx(fn) {
    let transaction, commit = false, abort = false;
    try {
      transaction = await database.startTransaction();assert(transaction && transaction.getTransactionId());
      const result = await fn(transaction.collection(productionNamespace.collection));
      if (!result.changed) {abort = true;okay(await transaction.rollback());return {acknowledged: true, ...result.value};}
      commit = true;okay(await transaction.commit());return {acknowledged: true, ...result.value};
    } catch (error) {if (transaction && !commit && !abort) {abort = true;try {await transaction.rollback();} catch (_) {}}throw error;}
  }
  return {
    async reserve(id) {
      assert(cycleId(id));return tx(async col => {
        const c = decode(await row(col, controlId)), rid = receiptId(id), seen = await row(col, rid);
        if (seen) {
          assert.deepStrictEqual(seen, {_id: rid, ...cycle(id, seen.status)});
          return {changed: false, value: {reserved: false, reason: 'CYCLE_ALREADY_SEEN'}};
        }
        if (c.state !== 'OPEN') return {changed: false, value: {reserved: false, reason: 'QUEUE_CLOSED'}};
        const next = {...clone(c), state: 'BUSY', active: id, revision: c.revision + 1};
        await update(col, controlId, encode(next));const r = await col.doc(rid).create(cycle(id, 'RUNNING'));okay(r);
        assert(r.inserted === 1 && r.ok === 1 && r.id === rid);
        return {changed: true, value: {reserved: true, reservation: permit(next), after: c.after}};
      });
    },
    async discover(p, after, limit) {
      assert(cycleId(p.cycle_id) && Number.isSafeInteger(p.revision) && jobId(after));assert(Number.isInteger(limit) && limit >= 1 && limit <= 10);
      const col = database.collection(productionNamespace.collection);
      const read = await col.doc(controlId).get();okay(read);assert(Array.isArray(read.data) && read.data.length === 1);
      assert(isDeepStrictEqual(permit(decode(read.data[0])), p));
      async function page(cursor) {
        const query = {kind:'dispatch', environment:plan.environment, scope:plan.parentBinding.scope, state:'PREPARED'};
        if (cursor !== null) query.job_id = database.command.gt(cursor);
        const r = await col.where(query).orderBy('job_id','asc').limit(limit).get();okay(r);assert(Array.isArray(r.data) && r.data.length <= limit);
        let previous = cursor;
        return r.data.map(value => {
          const job = require('./writer-dispatch-cloudbase').decode(value, value._id);
          assert(job.state === 'PREPARED' && (previous === null || job.spec.id > previous));previous = job.spec.id;return job.spec.id;
        });
      }
      let ids = await page(after);if (!ids.length && after !== null) ids = await page(null);
      return {ids, after: ids.length ? ids[ids.length - 1] : null};
    },
    async finish(p, after, hold = false) {
      assert(jobId(after));return tx(async col => {
        const c = decode(await row(col, controlId));
        assert(c.active === p.cycle_id && c.state === 'BUSY');
        if (!hold) assert(isDeepStrictEqual(permit(c), p));
        const rid = receiptId(p.cycle_id), seen = await row(col, rid);assert.deepStrictEqual(seen, {_id:rid, ...cycle(p.cycle_id,'RUNNING')});
        const next = {...clone(c), revision:c.revision+1, state:hold?'HOLD':'OPEN', active:hold?c.active:null, after:hold?c.after:after};
        await update(col, controlId, encode(next));await update(col, rid, cycle(p.cycle_id, hold?'HOLD':'COMPLETE'));
        return {changed:true, value:{state:next.state}};
      });
    }
  };
}
module.exports = {controlId, scope, validate, encode, decode, permit, fence, receiptId, createQueue};
