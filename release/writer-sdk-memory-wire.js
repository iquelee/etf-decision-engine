'use strict';
// Strict business-table wire model for actual captured database SDK replays.
// No SDK shim, query-function replacement, sockets or cloud calls live here.
const assert = require('assert');
const {isDeepStrictEqual} = require('util');
function createBusinessWire({EJSON, collections, conditionalPointerUpdates = false}) {
  assert(EJSON && typeof EJSON.parse === 'function' && typeof EJSON.stringify === 'function');
  assert(Array.isArray(collections) && collections.length && new Set(collections).size === collections.length);
  assert.strictEqual(typeof conditionalPointerUpdates, 'boolean');
  const allowed = new Set(collections), tables = new Map(collections.map(name => [name, []]));
  const writes = [], calls = [], violations = [];let sequence = 0;
  const copy = value => EJSON.parse(EJSON.stringify(value));
  function filter(value) {
    assert(value && typeof value === 'object' && !Array.isArray(value));
    assert(Object.keys(value).every(key => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)), 'operators and dotted filters require a reviewed model');
    for (const item of Object.values(value)) assert(item === null || ['string', 'number', 'boolean'].includes(typeof item), 'only scalar equality filters reviewed');
    return value;
  }
  function rows(name) {assert(allowed.has(name), 'unreviewed business collection');return tables.get(name);}
  function setFields(row, patch) {
    const paths = Object.keys(patch).map(key => key.split('.'));
    for (const segments of paths) {
      assert(segments.every(key => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && !['__proto__', 'constructor', 'prototype'].includes(key)),
        'unsafe update path');
      assert(segments[0] !== '_id', 'primary key updates forbidden');
    }
    const keys = Object.keys(patch);
    assert(!keys.some((left, i) => keys.some((right, j) => i !== j && right.startsWith(left + '.'))), 'conflicting update paths');
    const result = copy(row);
    for (const key of keys) {
      const parts = key.split('.');let target = result;
      for (const part of parts.slice(0, -1)) {
        if (!Object.hasOwn(target, part)) target[part] = {};
        assert(target[part] && Object.prototype.toString.call(target[part]) === '[object Object]', 'cannot set nested path in scalar/array');
        target = target[part];
      }
      target[parts[parts.length - 1]] = copy(patch[key]);
    }
    return result;
  }
  const model = {
    calls, writes, violations,
    seed(name, data) {rows(name);assert(Array.isArray(data));tables.set(name, copy(data));},
    rows(name) {return copy(rows(name));},
    snapshot() {return Object.fromEntries(collections.map(name => [name, model.rows(name)]));},
    async send(action, params = {}) {
      assert(!params.transactionId, 'business transaction requires a separate reviewed model');
      const table = rows(params.collectionName), requestId = 'memory-business:' + (calls.length + 1);
      calls.push({action, params: copy(params)});
      if (action === 'database.insertDocument') {
        assert(Array.isArray(params.data) && params.data.length === 1, 'only single-document inserts reviewed');const insertedIds = [];
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
      assert.strictEqual(params.upsert, false);
      const pointerCas = conditionalPointerUpdates && params.collectionName === 'active_run_pointer' && params.multi === true;
      if (pointerCas) {
        assert.deepStrictEqual(Object.keys(where).sort(), ['_id', 'revision', 'run_id', 'scope']);
        assert.strictEqual(where._id, 'active_run_pointer::production');assert.strictEqual(where.scope, 'production');
        assert(typeof where.run_id === 'string' && where.run_id.length && Number.isSafeInteger(where.revision) && where.revision >= 0);
        assert(selected.length <= 1, 'single primary-key CAS only');
      } else {assert.strictEqual(params.multi, false);assert.deepStrictEqual(Object.keys(where), ['_id'], 'only doc updates reviewed');}
      const update = EJSON.parse(params.data);assert.deepStrictEqual(Object.keys(update), ['$set']);
      assert(update.$set && typeof update.$set === 'object' && !Object.hasOwn(update.$set, '_id'));
      setFields({}, update.$set); // Validate even when no document matches.
      const replacements = selected.map(row => [row, setFields(row, update.$set)]);
      for (const [row, replacement] of replacements) Object.assign(row, replacement);
      writes.push({collection: params.collectionName, operation: 'update', id: where._id, patch: copy(update.$set), updated: selected.length,
        ...(pointerCas ? {condition: copy(where)} : {})});
      return {requestId, data: {updated: selected.length}};
    }
  };
  const send = model.send.bind(model);
  model.send = async (...args) => {
    try {return await send(...args);}
    catch (error) {
      // Business code can intentionally catch a rejected request. Keep that
      // rejection observable so a replay cannot silently declare equivalence.
      violations.push({action: args[0], collection: args[1] && args[1].collectionName, reason: error.message});
      throw error;
    }
  };
  return model;
}
module.exports = {createBusinessWire};
