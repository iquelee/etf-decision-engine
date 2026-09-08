'use strict';

/**
 * 取截至 today（含）的日线。按 trade_date 对齐，禁止用 tradingDays 下标去切全量 CSV。
 * 全量 CSV 从 2024-08-21 起，而回测 tradingDays 从 startIdx-60 切开；
 * bars.slice(0, idx+1) 会让快照固定落后 60 个交易日。
 */
function barsThrough(bars, today) {
  if (!bars || !bars.length || !today) return [];
  let end = -1;
  let prev = '';
  for (let i = 0; i < bars.length; i++) {
    const d = bars[i].trade_date;
    if (prev && d < prev) {
      throw new Error('barsThrough: trade_date 必须升序，禁止用乱序数组下标切快照');
    }
    prev = d;
    if (d <= today) end = i;
    else break;
  }
  return end >= 0 ? bars.slice(0, end + 1) : [];
}

module.exports = { barsThrough };
