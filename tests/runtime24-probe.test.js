'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const calls = [];
let apiLoads = 0;
const exportsStub = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../release/runtime24-probe.js'), 'utf8'), {
  exports: exportsStub, process,
  require(id) {
    if (id === 'crypto') return require('crypto');
    assert.strictEqual(id, './index');
    apiLoads += 1;
    return { main: async event => {
      calls.push(JSON.parse(JSON.stringify(event)));
      // Try to mutate a request: the next call must get a fresh query object.
      if (event.queryStringParameters) event.queryStringParameters.period = 'mutated';
      return { code: event.path.startsWith('/__') ? 404 : 0, data: { marker: 'actual-api-result' } };
    } };
  }
});
(async () => {
  for (const input of [undefined, null, [], 'daily', {}, { case: 'constructor' },
    { case: '__proto__' }, { case: 'toString' }, { case: 'admin' },
    { case: 'daily', path: '/api/admin/intel/refresh' }, { case: 'daily', body: {} }]) {
    assert.strictEqual((await exportsStub.main(input)).probe_error, 'UNSUPPORTED_PROBE_CASE');
  }
  assert.strictEqual(apiLoads, 0, 'invalid requests must not load API/SDK');
  const cases = ['constants', 'dashboard', 'daily', 'weekly', 'history', 'legacyHistory', 'notFound', 'daily'];
  const results = [];
  for (const name of cases) results.push(await exportsStub.main({ case: name }));
  assert.strictEqual(apiLoads, cases.length);
  assert.ok(calls.every(event => event.httpMethod === 'GET'));
  assert.deepStrictEqual(calls.map(event => event.path), ['/api/constants', '/api/dashboard',
    '/api/etf/513310/kline', '/api/etf/513310/kline', '/api/etf/513310/decisions',
    '/api/etf/513310/decisions', '/__runtime_probe_not_found__', '/api/etf/513310/kline']);
  assert.strictEqual(calls[2].queryStringParameters.period, 'daily');
  assert.strictEqual(calls[3].queryStringParameters.period, 'weekly');
  assert.strictEqual(calls[7].queryStringParameters.period, 'daily');
  assert.strictEqual(calls[4].queryStringParameters.include_provenance, '1');
  assert.strictEqual(calls[5].queryStringParameters.include_provenance, undefined);
  assert.deepStrictEqual(results.map(result => result.probe.invocation), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.strictEqual(new Set(results.map(result => result.probe.instance)).size, 1);
  assert.ok(results.every(result => result.probe.node === process.version && result.probe.handler_elapsed_ms >= 0));
  assert.strictEqual(results[6].response.code, 404);
  assert.strictEqual(results[0].response.data.marker, 'actual-api-result');
  console.log('Fixed read-only cases, input rejection, instance diagnostics and response preservation passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
