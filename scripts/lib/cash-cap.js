/**
 * 回测现金约束（对照，默认关闭）：加仓不得超过 100−合计 的剩余现金。
 * 减仓不限。不压已有仓，所以不是 V3.9 的组合硬顶；经济效果仍接近「没现金不准加」。
 */
'use strict';

function clipBuyTarget(from, target, book) {
  const f = Number(from) || 0;
  const t = Number(target);
  const diff = t - f;
  if (!(diff > 0.05)) return t;
  const room = Math.max(0, 100 - (Number(book) || 0));
  if (room <= 0.05) return f;
  const filled = Math.min(diff, room);
  return Math.round((f + filled) * 10) / 10;
}

function sumBook(positions) {
  let s = 0;
  Object.keys(positions || {}).forEach((c) => {
    s += (positions[c] && positions[c].current_position) || 0;
  });
  return s;
}

/** 卖先买后，同一天卖出腾出的现金可供买入。 */
function fillOrderCodes(pending, positions) {
  const codes = Object.keys(pending || {});
  return codes.slice().sort((a, b) => {
    const da = pending[a].target - ((positions[a] && positions[a].current_position) || 0);
    const db = pending[b].target - ((positions[b] && positions[b].current_position) || 0);
    return da - db;
  });
}

module.exports = { clipBuyTarget, sumBook, fillOrderCodes };
