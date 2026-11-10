'use strict';
const assert = require('assert');
const {writers, excluded, assertCoreWriters} = require('../release/runtime24-v3-core-scope');
const builder = require('../release/prepare-writer-six-workers');
assert.strictEqual(writers.length, 7);assert(Object.isFrozen(writers) && Object.isFrozen(excluded));
assertCoreWriters([...writers]);
assert.deepStrictEqual(builder.coreProducers, ['fetchDailyData', 'fetchRealtimeData', 'fetchFundamentalNews', 'extractFundamental']);
for (const producers of [[], ['runDecisionEngine', 'runDecisionEngine'], ['unknown'], ['runGen1ShadowEod'], ['runGen2ShadowEod'],
  ['runGen1ShadowEodNode24'], ['runGen2ShadowEodNode24'], ['runDecisionEngine', 'runGen2ShadowEod']])
  assert.throws(() => assertCoreWriters(producers));
// The former six-package entry must reject by scope before checking source or
// creating output. Undefined source/input/output must therefore remain unused.
assert.throws(() => builder.build({}), /V3_CORE_ONLY/);
assert.throws(() => builder.build({producers: ['runGen1ShadowEod']}), /V3_CORE_ONLY/);
assert.throws(() => builder.build({producers: ['runGen2ShadowEod']}), /V3_CORE_ONLY/);
console.log('V3 core scope: seven writers only; historical six-package entry and Gen1/Gen2 aliases rejected before packaging PASS');
