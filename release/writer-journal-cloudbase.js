'use strict';
// ISOLATED CANDIDATE. Production namespaces are intentionally rejected.
const assert = require('assert');
const crypto = require('crypto');
const {isDeepStrictEqual} = require('util');
const protocol = require('./writer-admission');
const {canonical} = require('./writer-admission-cloudbase');
const text = value => typeof value === 'string' && /^[A-Za-z0-9_:./|#@+-]{1,200}$/.test(value);
const clone = value => JSON.parse(JSON.stringify(value));
function id(binding, kind, value = '') {
  assert(text(binding.environment) && text(binding.scope));
  assert(['control', 'request', 'token'].includes(kind));
  if (kind !== 'control') assert(text(value), 'invalid journal identity');
  return kind + ':' + crypto.createHash('sha256').update(canonical([binding.environment, binding.scope, kind, value])).digest('hex');
}
function encodeControl(control, binding) {
  protocol.validate(control, binding);
  assert(!control.receipts.some(r => r.status === 'COMPLETE'), 'V1 migration required');
  // Reuse the strict V1 shape check, but mark the stored envelope as V2.
  const {encode} = require('./writer-admission-cloudbase');
  encode(control, binding);
  return {schema: 2, kind: 'control', environment: binding.environment, scope: binding.scope,
    revision: control.revision, payload_json: canonical(control)};
}
function encodeReceipt(receipt, binding, kind) {
  assert(['request', 'token'].includes(kind));
  assert.deepStrictEqual(Object.keys(receipt).sort(), ['environment', 'epoch', 'owner', 'request_id', 'scope', 'status', 'token']);
  assert(receipt.environment === binding.environment && receipt.scope === binding.scope);
  assert(text(receipt.request_id) && text(receipt.token));
  assert(['RUNNING', 'UNKNOWN', 'COMPLETE'].includes(receipt.status));
  assert(['old', 'new'].includes(receipt.owner));
  assert(Number.isSafeInteger(receipt.epoch) && receipt.epoch >= 0 && receipt.epoch < Number.MAX_SAFE_INTEGER);
  return {schema: 2, kind, environment: binding.environment, scope: binding.scope, payload_json: canonical(receipt)};
}
function decode(row, expectedId, binding, kind) {
  if (row === null) return null;
  assert(row && typeof row === 'object' && !Array.isArray(row));
  assert.strictEqual(row._id, expectedId);
  assert.strictEqual(typeof row.payload_json, 'string');
  const value = JSON.parse(row.payload_json);
  const encoded = kind === 'control' ? encodeControl(value, binding) : encodeReceipt(value, binding, kind);
  assert.deepStrictEqual(row, {_id: expectedId, ...encoded}, 'corrupt journal envelope');
  return value;
}
function createStore({database, collection, binding: supplied}) {
  assert(/^runtime24_journal_probe_[a-z0-9_]+$/.test(collection), 'isolated journal collection required');
  assert(database && typeof database.startTransaction === 'function' && typeof database.collection === 'function');
  const binding = Object.freeze(clone(supplied));
  assert.deepStrictEqual(Object.keys(binding).sort(), ['environment', 'scope']);
  assert(database.config && database.config.envName === binding.environment, 'explicit SDK environment required');
  assert(database.config.retries === 0 && database.config.keepalive === false,
    'disable SDK retry and reused-socket ECONNRESET resend');
  const controlId = id(binding, 'control');
  const checkBinding = b => assert.deepStrictEqual(b, binding);
  const okay = r => assert(r && typeof r === 'object' && !r.code && typeof r.requestId === 'string' && r.requestId.length, 'ambiguous SDK acknowledgement');
  async function get(doc, docId, kind, transactional) {
    const r = await doc.get(); okay(r);
    let row;
    if (transactional) { assert(r.data === null || (r.data && !Array.isArray(r.data))); row = r.data; }
    else { assert(Array.isArray(r.data) && r.data.length <= 1); row = r.data[0] || null; }
    return decode(row, docId, binding, kind);
  }
  return {
    async read(b) {
      checkBinding(b);
      return get(database.collection(collection).doc(controlId), controlId, 'control', false);
    },
    async transaction(b, callback, lookup = {}) {
      checkBinding(b);
      let tx, commitAttempted = false;
      try {
        // Manual transaction only: no runTransaction conflict retry.
        tx = await database.startTransaction();
        assert(tx && typeof tx.getTransactionId() === 'string' && tx.getTransactionId().length);
        const col = tx.collection(collection);
        const control = await get(col.doc(controlId), controlId, 'control', true);
        assert(control, 'control missing: no fail-open bootstrap');
        const requests = new Map(), tokens = new Map();
        async function load(kind, value) {
          const cache = kind === 'request' ? requests : tokens;
          if (!cache.has(value)) {
            const docId = id(binding, kind, value);
            const receipt = await get(col.doc(docId), docId, kind, true);
            if (receipt) assert.strictEqual(receipt[kind === 'request' ? 'request_id' : 'token'], value);
            cache.set(value, receipt);
          }
          return cache.get(value);
        }
        if (control.active) {
          const a = control.active;
          assert(isDeepStrictEqual(await load('request', a.request_id), await load('token', a.token)), 'active index divergence');
        }
        if (lookup.request_id !== undefined) await load('request', lookup.request_id);
        if (lookup.token !== undefined) await load('token', lookup.token);
        // Verify the counterpart of every existing lookup, including COMPLETE.
        for (const r of [...requests.values(), ...tokens.values()]) if (r) {
          assert(isDeepStrictEqual(await load('request', r.request_id), await load('token', r.token)), 'receipt index divergence');
        }
        const find = (cache, value) => { assert(cache.has(value), 'lookup not declared'); return clone(cache.get(value)); };
        const change = callback({control: clone(control), findRequest: value => find(requests, value), findToken: value => find(tokens, value)});
        assert(!change || typeof change.then !== 'function', 'synchronous pure callback required');
        if (!change) { okay(await tx.rollback()); return true; }
        assert.strictEqual(change.control.revision, control.revision + 1);
        const encoded = encodeControl(change.control, binding);
        // Every mutation writes this SAME document in the snapshot transaction.
        // Its write conflict serializes this scoped protocol despite snapshot
        // isolation. Primary-key receipt indexes avoid query/phantom assumptions.
        const updated = await col.doc(controlId).update(encoded); okay(updated);
        assert.strictEqual(updated.updated, 1, 'control update did not match exactly one');
        if (change.receipt) {
          const r = change.receipt;
          for (const kind of ['request', 'token']) {
            const value = kind === 'request' ? r.request_id : r.token;
            const cache = kind === 'request' ? requests : tokens;
            assert(cache.has(value), 'receipt write without prior read');
            const before = cache.get(value);
            const docId = id(binding, kind, value), payload = encodeReceipt(r, binding, kind);
            if (before) {
              assert(before.status !== 'COMPLETE' && before.request_id === r.request_id && before.token === r.token
                && before.owner === r.owner && before.epoch === r.epoch, 'immutable receipt identity/terminal state');
              const ack = await col.doc(docId).update(payload); okay(ack); assert.strictEqual(ack.updated, 1);
            } else {
              assert.strictEqual(r.status, 'RUNNING');
              const ack = await col.doc(docId).create(payload); okay(ack);
              assert(ack.inserted === 1 && ack.ok === 1 && ack.id === docId, 'receipt insert acknowledgement');
            }
          }
        }
        commitAttempted = true;
        okay(await tx.commit());
        return true;
      } catch (error) {
        // After commit was sent its outcome can be unknown. Do not compensate,
        // release a slot, re-submit commit, or execute work based on readback.
        if (tx && !commitAttempted) { try { await tx.rollback(); } catch (_) { /* reject */ } }
        throw error;
      }
    }
  };
}
module.exports = {id, encodeControl, encodeReceipt, decode, createStore};
