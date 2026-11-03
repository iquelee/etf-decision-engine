'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { COLLECTIONS } = require('../src/common/constants');
const source = fs.readFileSync(path.join(__dirname, '../cloudfunctions/apiGateway/index.js'), 'utf8');

// Exercise the actual HTTP router and K-line handler. Only the storage boundary
// and unrelated endpoint dependencies are stubbed; no cloud SDK or network.
function gateway(rows, error) {
  const calls = [];
  const db = { query: async (collection, where, options) => {
    calls.push({ collection, where, options });
    if (error) throw error;
    const { field, direction } = options.orderBy[0];
    return rows.filter(r => r.code === where.code)
      .sort((a, b) => (a[field] < b[field] ? -1 : a[field] > b[field] ? 1 : 0) * (direction === 'desc' ? -1 : 1))
      .slice(0, options.limit);
  }};
  const exports = {};
  vm.runInNewContext(source, { exports, console, require(id) {
    if (id === '@cloudbase/node-sdk') return { init: () => ({}) };
    if (id === './common/utils/db') return db;
    if (id === './common/constants') return { COLLECTIONS };
    if (id === './RELEASE_SOURCE.json') throw new Error('source-only test');
    if (id.startsWith('./common/')) return {};
    throw new Error('Unexpected dependency: ' + id);
  }}, { filename: 'apiGateway/index.js' });
  return { calls, request: async period => JSON.parse(JSON.stringify(await exports.main({
    httpMethod: 'GET', path: '/apiGateway/api/etf/513310/kline',
    queryStringParameters: period == null ? {} : { period }
  }))) };
}
function bars(count, weekly = false) {
  return Array.from({ length: count }, (_, i) => ({
    code: '513310', [weekly ? 'week_end_date' : 'trade_date']:
      new Date(Date.UTC(2020, 0, 1) + i * (weekly ? 7 : 1) * 86400000).toISOString().slice(0, 10),
    open: i + 1, high: i + 3, low: i, close: i + 2, volume: i * 100,
    amount: i * 200, premium_rate: i / 1000
  }));
}
function project(row, weekly) {
  const value = { date: row[weekly ? 'week_end_date' : 'trade_date'], open: row.open,
    high: row.high, low: row.low, close: row.close, volume: row.volume };
  if (!weekly) Object.assign(value, { amount: row.amount, premium_rate: row.premium_rate });
  return value;
}
(async () => {
  for (const weekly of [false, true]) {
    const limit = weekly ? 260 : 320;
    for (const count of [0, 1, 9, limit, limit + 1, limit + 137]) {
      const records = bars(count, weekly);
      // A later bar belonging to another ETF must never enter this window.
      const other = { ...bars(1, weekly)[0], code: '518880',
        [weekly ? 'week_end_date' : 'trade_date']: '2099-12-31' };
      const app = gateway([other, ...records.slice().reverse()]);
      const response = await app.request(weekly ? 'weekly' : undefined);
      assert.strictEqual(response.code, 0);
      const expected = records.slice(-limit).map(r => project(r, weekly));
      assert.deepStrictEqual(response.data, expected, `${weekly ? 'weekly' : 'daily'} ${count}: latest window, oldest-to-newest, unchanged payload`);
      assert.strictEqual(app.calls.length, 1);
      assert.strictEqual(app.calls[0].collection, weekly ? COLLECTIONS.ETF_WEEKLY : COLLECTIONS.ETF_DAILY);
    }
  }
  const nullable = bars(322);
  nullable[321].close = null;
  const response = await gateway(nullable).request('daily');
  assert.deepStrictEqual(response.data, nullable.slice(-320).filter(r => r.close != null).map(r => project(r, false)),
    'Retain existing null-close filtering within the latest raw window; never backfill from older bars');
  const error = await gateway([], new Error('storage unavailable')).request('weekly');
  assert.strictEqual(error.code, 500);
  assert.strictEqual(error.data, null, 'Read failure must not become a successful empty chart');
  console.log('api K-line window: latest daily/weekly limits, ascending output, short/empty histories, code isolation, payload and errors PASS');
})().catch(e => { console.error(e); process.exitCode = 1; });
