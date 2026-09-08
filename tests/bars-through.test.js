'use strict';
const assert = require('assert');
const { barsThrough } = require('../scripts/lib/bars-through.js');

const bars = [
  { trade_date: '2024-08-21', close: 1 },
  { trade_date: '2024-08-22', close: 2 },
  { trade_date: '2024-11-22', close: 3 },
  { trade_date: '2025-02-25', close: 4 },
  { trade_date: '2025-08-14', close: 5 }
];

assert.strictEqual(barsThrough(bars, '2025-02-25').length, 4);
assert.strictEqual(barsThrough(bars, '2025-02-25').pop().trade_date, '2025-02-25');
assert.strictEqual(barsThrough(bars, '2025-08-14').pop().trade_date, '2025-08-14');
assert.strictEqual(barsThrough(bars, '2025-03-01').pop().trade_date, '2025-02-25');
assert.strictEqual(barsThrough([], '2025-02-25').length, 0);
assert.strictEqual(barsThrough(bars, '2024-01-01').length, 0);

// 模拟旧 bug：tradingDays 从 startIdx-60 切开后，idx=60 对应 2025-02-25，
// 但 bars.slice(0, 61) 会落到 2024-11-22 那根。
const allDates = ['2024-08-21', '2024-11-22', '2025-02-25', '2025-08-14'];
const startIdx = allDates.indexOf('2025-02-25');
const idx = 60;
const buggyLast = allDates[Math.min(idx, allDates.length - 1)];
assert.notStrictEqual(buggyLast, '2025-02-25');
assert.strictEqual(barsThrough(bars, allDates[startIdx]).pop().trade_date, '2025-02-25');

assert.throws(() => barsThrough([
  { trade_date: '2025-02-25', close: 1 },
  { trade_date: '2024-08-21', close: 2 }
], '2025-02-25'), /升序/);

console.log('bars-through 7 项通过');
