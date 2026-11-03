'use strict';
// Test-only single-record atomic CAS. Not evidence of CloudBase write semantics.
const {isDeepStrictEqual} = require('util');
const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
function createMemoryStore(initial) {
  let record = copy(initial);
  return {
    async read() { return copy(record); },
    async compareAndSet(expected, next) {
      if (!isDeepStrictEqual(record, expected)) return false;
      record = copy(next); return true;
    }
  };
}
module.exports = {createMemoryStore};
