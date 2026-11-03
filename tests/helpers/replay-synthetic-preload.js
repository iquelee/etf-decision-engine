'use strict';
// Test-only in-memory OHLCV fixture. Run the real replay/decision code without
// exporting private historical data into CI. Never used by release evidence.
const fs = require('fs');
const path = require('path');
const pool = path.resolve(__dirname, '../../deliverables/etf_daily_ml_pool');
const matches = p => typeof p === 'string' && path.dirname(path.resolve(p)) === pool && /^\d+_qfq\.csv$/.test(path.basename(p));
const exists = fs.existsSync;
const read = fs.readFileSync;
const rows = [];
for (let day = Date.UTC(2024, 0, 1), i = 0; day <= Date.UTC(2026, 9, 1); day += 86400000, i++) {
  const date = new Date(day);
  if ([0, 6].includes(date.getUTCDay())) continue;
  const close = 100 + i * 0.02 + Math.sin(i / 13);
  rows.push([date.toISOString().slice(0, 10), close - 0.1, close + 0.5, close - 0.5, close, 1000000, close * 1000000].join(','));
}
const csv = rows.join('\n') + '\n';
fs.existsSync = p => matches(p) || exists(p);
fs.readFileSync = (p, options) => matches(p) ? (options ? csv : Buffer.from(csv)) : read(p, options);
