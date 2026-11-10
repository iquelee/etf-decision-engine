'use strict';
// Strict business-table wire model for actual captured database SDK replays.
// No SDK shim, query-function replacement, sockets or cloud calls live here.
const assert = require('assert');
const {isDeepStrictEqual} = require('util');
function createBusinessWire({EJSON, collections}) {
  assert(EJSON && typeof EJSON.parse === 'function' && typeof EJSON.stringify === 'function');
  assert(Array.isArray(collections) && collections.length && new Set(collections).size === collections.length);
  const allowed = new Set(collections), tables = new Map(collections.map(name => [name, []]));
  const writes = [], calls = [];let sequence = 0;
  const copy = value => EJSON.parse(EJSON.stringify(value));
  function filter(value) {
    assert(value && typeof value === 'object' && !Array.isArray(value));
    assert(Object.keys(value).every(key => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)), 'operators and dotted filters require a reviewed model');
    for (const item of Object.values(value)) assert(item === null || ['string', 'number', 'boolean'].includes(typeof item), 'only scalar equality filters reviewed');
    return value;
  }
  function rows(name) {assert(allowed.has(name), 'unreviewed business collection');return tables.get(name);}
  const model = {
    calls, writes,
    seed(name, data) {rows(name);assert(Array.isArray(data));tables.set(name, copy(data));},
    rows(name) {return copy(rows(name));},
    snapshot() {return Object.fromEntries(collections.map(name => [name, model.rows(name)]));},
    async send(action, params = {}) {
      assert(!params.transactionId, 'business transaction requires a separate reviewed model');
      const table = rows(params.collectionName), requestId = 'memory-business:' + (calls.length + 1);
      calls.push({action, params: copy(params)});
      if (action === 'database.insertDocument') {
        assert(Array.isArray(params.data));const insertedIds = [];
        for (const raw of params.data) {
          const row = EJSON.parse(raw);assert(row && typeof row === 'object' && !Array.isArray(row));
          if (!Object.hasOwn(row, '_id')) row._id = 'business:' + params.collectionName + ':' + (++sequence);
          assert(!table.some(item => item._id === row._id), 'duplicate business primary key');
          table.push(copy(row));insertedIds.push(row._id);
          writes.push({collection: params.collectionName, operation: 'insert', row: copy(row)});
        }
        return {requestId, data: {insertedIds}};
      }
      const where = filter(params.query ? EJSON.parse(params.query) : {});
      const selected = table.filter(row => Object.entries(where).every(([key, value]) => isDeepStrictEqual(row[key], value)));
      if (action === 'database.getDocument') {
        const order = params.order ? EJSON.parse(params.order) : {};
        assert(order && typeof order === 'object' && !Array.isArray(order));
        for (const [key, direction] of Object.entries(order)) {
          assert(/^[A-Za-z_][A-Za-z0-9_]*$/.test(key));assert([1, -1].includes(direction));
        }
        selected.sort((left, right) => {
          for (const [key, direction] of Object.entries(order)) {
            if (left[key] < right[key]) return -direction;
            if (left[key] > right[key]) return direction;
          }
          return 0;
        });
        const offset = params.offset || 0, limit = params.limit === undefined ? 100 : params.limit;
        assert(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(limit) && limit > 0 && limit <= 1000);
        assert(params.projection === undefined, 'projection requires a reviewed model');
        return {requestId, data: {list: selected.slice(offset, offset + limit).map(row => EJSON.stringify(row)), offset, limit}};
      }
      assert.strictEqual(action, 'database.modifyDocument', 'unreviewed business wire action');
      assert.strictEqual(params.upsert, false);assert.strictEqual(params.multi, false);
      assert.deepStrictEqual(Object.keys(where), ['_id'], 'only doc updates reviewed');
      const update = EJSON.parse(params.data);assert.deepStrictEqual(Object.keys(update), ['$set']);
      assert(update.$set && typeof update.$set === 'object' && !Object.hasOwn(update.$set, '_id'));
      assert(Object.keys(update.$set).every(key => !key.startsWith('$') && !key.includes('.')), 'nested update operators require a reviewed model');
      for (const row of selected) Object.assign(row, copy(update.$set));
      writes.push({collection: params.collectionName, operation: 'update', id: where._id, patch: copy(update.$set), updated: selected.length});
      return {requestId, data: {updated: selected.length}};
    }
  };
  return model;
}
module.exports = {createBusinessWire};
