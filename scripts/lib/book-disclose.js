/**
 * 回测账面披露（不改决策）：合计仓可超过 100%，现金未夹可以为负。
 * 去杠杆日收益：超 100% 的那天把当日收益按 100/合计 缩回，权重结构不变。
 */
'use strict';

function rawCash(book) {
  return 100 - (book || 0);
}

function clipCash(book) {
  return Math.max(0, rawCash(book));
}

function unleverDayReturn(dayRet, book) {
  if (book > 100 + 1e-9) return dayRet * (100 / book);
  return dayRet;
}

module.exports = { rawCash, clipCash, unleverDayReturn };
