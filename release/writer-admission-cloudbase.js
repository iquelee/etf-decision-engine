'use strict';
// Isolated validation adapter only. No bootstrap, unconditional update or retry.
const assert = require('assert');
const {isDeepStrictEqual} = require('util');
const protocol = require('./writer-admission');
const keys = ['active', 'environment', 'epoch', 'owner', 'receipts', 'revision', 'schema', 'scope', 'state'];
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
function encode(state, binding) {
  protocol.validate(state, binding);
  assert.deepStrictEqual(Object.keys(state).sort(), keys);
  return {schema: 1, environment: state.environment, scope: state.scope, revision: state.revision,
    owner: state.owner, epoch: state.epoch, state: state.state, payload_json: canonical(state)};
}
function createStore({database, collection, document, binding}) {
  assert(/^runtime24_admission_probe_[a-z0-9_]+$/.test(collection), 'isolated probe collection required');
  assert(/^probe:[a-z0-9-]+$/.test(document), 'fixed probe document required');
  assert(database && typeof database.collection === 'function');
  const col = database.collection(collection);
  async function read() {
    const response = await col.doc(document).get();
    assert(response && !response.code && Array.isArray(response.data) && response.data.length <= 1, 'invalid read acknowledgement');
    if (!response.data.length) return null;
    const row = response.data[0];
    assert.strictEqual(row._id, document);
    assert.strictEqual(typeof row.payload_json, 'string');
    const state = JSON.parse(row.payload_json), encoded = encode(state, binding);
    for (const [key, value] of Object.entries(encoded)) assert.strictEqual(row[key], value, 'corrupt envelope:' + key);
    return state;
  }
  return {read, async compareAndSet(expected, next) {
    const before = encode(expected, binding), after = encode(next, binding);
    assert.strictEqual(next.revision, expected.revision + 1);
    // Match full canonical payload as well as all scalar guards. Never set/upsert.
    const result = await col.where({_id: document, ...before}).update(after);
    if (!result || result.code || result.updated !== 1 || result.upsertedId != null || result.upsertId != null
      || (result.upserted != null && result.upserted !== 0)) return false;
    // A failed or concurrently changed readback is ambiguous, hence no admission.
    return isDeepStrictEqual(await read(), next);
  }};
}
module.exports = {canonical, encode, createStore};
