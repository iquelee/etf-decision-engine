/**
 * 抓取闸门纯函数（无 DB / 无 cloudbase），供云函数与单测共用。
 * V3.1：isIntraday 禁止在测试里复制函数体；正式日线以 volume 非空判定，不认 source 名字。
 */
'use strict';

function beijingNow() { return new Date(Date.now() + 8 * 3600 * 1000); }
function beijingDateStr(d) { return (d || beijingNow()).toISOString().slice(0, 10); }

/**
 * 判断是否盘中（9:00-15:05 北京时间）。
 * beijingNow() 已 +8h，Date 内部 UTC 字段即北京时间，只读 getUTCHours()。
 */
function isIntraday(d) {
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const t = h * 60 + m;
  return t >= 9 * 60 && t <= 15 * 60 + 5;
}

/**
 * 正式日线：必须有成交量。盘中 stub（close=price, volume=null）即使 source 写成 tencent 也不算已抓完。
 */
function isOfficialDailyBar(row) {
  if (!row) return false;
  const vol = Number(row.volume);
  const close = Number(row.close);
  return Number.isFinite(vol) && vol > 0 && Number.isFinite(close) && close > 0;
}

function clampConfidence(v, fallback = 0.6) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

module.exports = {
  beijingNow,
  beijingDateStr,
  isIntraday,
  isOfficialDailyBar,
  clampConfidence
};
