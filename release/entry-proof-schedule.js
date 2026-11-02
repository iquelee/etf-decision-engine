'use strict';
const assert = require('assert');
function oneOff(nowMs) {
  assert(Number.isSafeInteger(nowMs) && nowMs > 0);
  const due = Math.ceil((nowMs + 180000) / 60000) * 60000;
  const local = new Date(due + 8 * 3600000);
  const parts = [0, local.getUTCMinutes(), local.getUTCHours(), local.getUTCDate(), local.getUTCMonth() + 1, '?', local.getUTCFullYear()];
  assert(parts[6] >= 1970 && parts[6] <= 2099);
  assert.strictEqual(Date.UTC(parts[6], parts[4] - 1, parts[3], parts[2] - 8, parts[1], 0), due);
  assert(due - nowMs >= 180000 && due - nowMs < 240000);
  return {scheduled_for: new Date(due).toISOString(), cron: parts.join(' '), timezone: 'Asia/Shanghai', occurrences: 1};
}
module.exports = {oneOff};
