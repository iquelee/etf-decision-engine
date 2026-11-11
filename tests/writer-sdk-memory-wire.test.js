'use strict';
const assert = require('assert');
const {createBusinessWire} = require('../release/writer-sdk-memory-wire');
async function main() {
  const wire = createBusinessWire({EJSON: JSON, collections: ['daily', 'shadow']});
  wire.seed('daily', [{_id: 'a', code: 'one', day: 3}, {_id: 'b', code: 'two', day: 2}, {_id: 'c', code: 'one', day: 1}]);
  const get = (params = {}) => wire.send('database.getDocument', {collectionName: 'daily', ...params});
  let value = await get({query: JSON.stringify({code: 'one'}), order: JSON.stringify({day: 1}), offset: 1, limit: 1});
  assert.deepStrictEqual(value.data.list.map(JSON.parse), [{_id: 'a', code: 'one', day: 3}]);
  value = await wire.send('database.modifyDocument', {collectionName: 'daily', query: JSON.stringify({_id: 'a'}),
    data: JSON.stringify({$set: {day: 4}}), multi: false, upsert: false});
  assert.strictEqual(value.data.updated, 1);assert.strictEqual(wire.rows('daily').find(row => row._id === 'a').day, 4);
  await wire.send('database.modifyDocument', {collectionName: 'daily', query: JSON.stringify({_id: 'a'}),
    data: JSON.stringify({$set: {'realtime.price': 10, 'realtime.metadata': 'keep'}}), multi: false, upsert: false});
  await wire.send('database.modifyDocument', {collectionName: 'daily', query: JSON.stringify({_id: 'a'}),
    data: JSON.stringify({$set: {'realtime.price': 11}}), multi: false, upsert: false});
  assert.deepStrictEqual(wire.rows('daily')[0].realtime, {price: 11, metadata: 'keep'});
  const stable = wire.snapshot();
  for (const patch of [{'realtime.price': 12, realtime: {}}, {'realtime.__proto__.bad': true}, {'realtime.constructor.bad': true},
    {'day.child': 1}, {$inc: 1}]) {
    await assert.rejects(wire.send('database.modifyDocument', {collectionName: 'daily', query: JSON.stringify({_id: 'a'}),
      data: JSON.stringify({$set: patch}), multi: false, upsert: false}));
    assert.deepStrictEqual(wire.snapshot(), stable, 'invalid patch cannot partially mutate stored rows');
  }
  const inserted = await wire.send('database.insertDocument', {collectionName: 'shadow', data: [JSON.stringify({kind: 'run'})]});
  assert.strictEqual(inserted.data.insertedIds[0], 'business:shadow:1');
  const resumed = createBusinessWire({EJSON: JSON, collections: ['shadow']});
  resumed.seed('shadow', wire.rows('shadow'));
  const next = await resumed.send('database.insertDocument', {collectionName: 'shadow', data: [JSON.stringify({kind: 'next-run'})]});
  assert.strictEqual(next.data.insertedIds[0], 'business:shadow:2');
  assert.strictEqual(resumed.rows('shadow').length, 2, 'replaying a saved snapshot preserves existing rows and allocates a fresh ID');
  assert.deepStrictEqual(resumed.violations, []);
  const snapshot = wire.snapshot();snapshot.daily[0].day = 99;
  assert.strictEqual(wire.rows('daily')[0].day, 4, 'snapshot must not mutate stored data');
  for (const params of [{collectionName: 'production-other'}, {transactionId: 'tx'},
    {query: JSON.stringify({$or: []})}, {query: JSON.stringify({code: {$gt: 0}})},
    {order: JSON.stringify({day: 'asc'})}, {projection: '{}'}]) await assert.rejects(get(params));
  await assert.rejects(wire.send('database.removeDocument', {collectionName: 'daily'}));
  await assert.rejects(wire.send('database.insertDocument', {collectionName: 'daily', data: [JSON.stringify({_id: 'a'})]}));
  assert(wire.violations.length >= 8, 'caught model rejections remain visible to the replay');
  await assert.rejects(wire.send('database.insertDocument', {collectionName: 'shadow', data: ['{}', '{}']}));
  await assert.rejects(wire.send('database.modifyDocument', {collectionName: 'daily', query: JSON.stringify({_id: 'missing'}),
    data: JSON.stringify({$set: {'constructor.bad': true}}), multi: false, upsert: false}));
  const cas = createBusinessWire({EJSON: JSON, collections: ['active_run_pointer'], conditionalPointerUpdates: true});
  cas.seed('active_run_pointer', [{_id: 'active_run_pointer::production', scope: 'production', run_id: 'old', revision: 7}]);
  const change = where => cas.send('database.modifyDocument', {collectionName: 'active_run_pointer', query: JSON.stringify(where),
    data: JSON.stringify({$set: {run_id: 'new', revision: 8}}), multi: true, upsert: false});
  const where = {_id: 'active_run_pointer::production', scope: 'production', run_id: 'old', revision: 7};
  assert.strictEqual((await change({...where, revision: 6})).data.updated, 0);
  assert.strictEqual(cas.rows('active_run_pointer')[0].run_id, 'old', 'stale CAS leaves pointer unchanged');
  assert.strictEqual((await change(where)).data.updated, 1);
  assert.strictEqual((await change(where)).data.updated, 0, 'stale expected identity cannot overwrite the promoted pointer');
  for (const invalid of [{_id: where._id}, {...where, scope: 'other'}, {...where, revision: '7'}, {...where, _id: 'another'}])
    await assert.rejects(change(invalid));
  const defaultCas = createBusinessWire({EJSON: JSON, collections: ['active_run_pointer']});
  await assert.rejects(defaultCas.send('database.modifyDocument', {collectionName: 'active_run_pointer', query: JSON.stringify(where),
    data: JSON.stringify({$set: {run_id: 'new'}}), multi: true, upsert: false}), 'conditional query updates remain denied by default');
  console.log('business SDK wire: scalar filters, sorting/pagination, updates, snapshots and unreviewed operations denied PASS (MODEL_ONLY)');
}
if (require.main === module) main().catch(error => {console.error(error);process.exitCode = 1;});
