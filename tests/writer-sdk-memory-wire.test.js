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
  const inserted = await wire.send('database.insertDocument', {collectionName: 'shadow', data: [JSON.stringify({kind: 'run'})]});
  assert.strictEqual(inserted.data.insertedIds[0], 'business:shadow:1');
  const snapshot = wire.snapshot();snapshot.daily[0].day = 99;
  assert.strictEqual(wire.rows('daily')[0].day, 4, 'snapshot must not mutate stored data');
  for (const params of [{collectionName: 'production-other'}, {transactionId: 'tx'},
    {query: JSON.stringify({$or: []})}, {query: JSON.stringify({code: {$gt: 0}})},
    {order: JSON.stringify({day: 'asc'})}, {projection: '{}'}]) await assert.rejects(get(params));
  await assert.rejects(wire.send('database.removeDocument', {collectionName: 'daily'}));
  await assert.rejects(wire.send('database.insertDocument', {collectionName: 'daily', data: [JSON.stringify({_id: 'a'})]}));
  console.log('business SDK wire: scalar filters, sorting/pagination, updates, snapshots and unreviewed operations denied PASS (MODEL_ONLY)');
}
if (require.main === module) main().catch(error => {console.error(error);process.exitCode = 1;});
