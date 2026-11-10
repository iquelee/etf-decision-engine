'use strict';
const assert = require('assert');
const contract = require('./runtime24-v3-core-scope.json');
const writers = Object.freeze([...contract.writers]);
const excluded = Object.freeze([...contract.excluded_writers]);
assert.strictEqual(contract.scope, 'V3_CORE_ONLY');
assert.strictEqual(writers.length, 7);assert.strictEqual(new Set(writers).size, 7);
assert(writers.every(name => !excluded.includes(name)));
function assertCoreWriters(producers) {
  assert(Array.isArray(producers) && producers.length > 0 && new Set(producers).size === producers.length,
    'explicit unique V3 core producers required');
  assert(producers.every(name => typeof name === 'string' && writers.includes(name)),
    'V3_CORE_ONLY: Gen1/Gen2 and unknown producers are outside this update');
}
module.exports = {writers, excluded, assertCoreWriters};
