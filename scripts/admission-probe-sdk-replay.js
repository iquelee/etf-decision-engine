#!/usr/bin/env node
'use strict';
// Actual captured SDK serializers with replaced request transport. NEVER network.
const path = require('path'), assert = require('assert');
const {verifyPackage} = require('./lib/verified-writer-package');
const {createDatabase} = require('./lib/admission-probe-memory-db');
const args = process.argv.slice(2);
assert(args.length === 4 && args[0] === '--package' && args[2] === '--file-map');
const {root} = verifyPackage(path.resolve(args[1]), path.resolve(args[3]));
const {Db} = require(path.join(root, 'node_modules/@cloudbase/database'));
const {EJSON} = require(path.join(root, 'node_modules/bson'));
const {verify} = require('../release/runtime24-admission-probe');
const backend = createDatabase(); const original = Db.reqClass; let calls = 0;
function query(raw) {
  const q = EJSON.parse(raw);
  return Object.fromEntries(Object.entries(q).map(([k, v]) => [k,
    v && typeof v === 'object' && Object.keys(v).length === 1 && '$eq' in v ? v.$eq : v]));
}
Db.reqClass = class {
  async send(action, params) {
    calls++;
    const col = backend.collection(params.collectionName);
    if (action === 'database.getDocument') {
      const q = query(params.query), result = await col.doc(q._id).get();
      return {requestId: 'offline', data: {list: result.data.map(row => EJSON.stringify(row))}};
    }
    if (action === 'database.insertDocument') {
      const ids = []; for (const item of params.data) ids.push((await col.add(EJSON.parse(item))).id);
      return {requestId: 'offline', data: {insertedIds: ids}};
    }
    assert.strictEqual(action, 'database.modifyDocument');
    assert.strictEqual(params.upsert, false, 'SDK wire must disable upsert');
    const patch = EJSON.parse(params.data); assert.deepStrictEqual(Object.keys(patch), ['$set']);
    assert.strictEqual(typeof patch.$set.payload_json, 'string');
    const result = await col.where(query(params.query)).update(patch.$set);
    return {requestId: 'offline', data: {updated: result.updated}};
  }
};
verify(new Db({env: 'offline', throwOnCode: true})).then(result => {
  console.log(JSON.stringify({runtime: process.version, sdk: '2.11.0', database: '1.4.1',
    real_sdk_serializers: true, transport: 'MEMORY_ONLY_NO_NETWORK', requests: calls, ...result}, null, 2));
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { Db.reqClass = original; });
