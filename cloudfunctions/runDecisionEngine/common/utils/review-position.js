/**
 * 复盘时间轴：某日某票的实际持仓%。
 * 决策日是 K 线日，组合快照日是引擎跑的日历日，所以允许 +3 天内的下一张快照。
 */

function daysBetween(a, b) {
  if (!a || !b) return null;
  const da = new Date(a);
  const dbb = new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(dbb.getTime())) return null;
  return Math.round((dbb.getTime() - da.getTime()) / (24 * 3600 * 1000));
}

function pushSnap(events, code, date, snapshot) {
  const sd = snapshot && snapshot.snapshot_date;
  if (!sd) return;
  const rows = snapshot.positions || [];
  const row = rows.find((p) => p && p.code === code);
  let pos = null;
  if (row && row.position != null && !Number.isNaN(Number(row.position))) {
    pos = Number(row.position);
  } else if (rows.length > 0 && sd <= date) {
    pos = 0;
  }
  if (pos == null) return;
  if (sd === date) events.push({ date: sd, pos, kind: 'snap', exact: true });
  else if (sd < date) events.push({ date: sd, pos, kind: 'snap', exact: false });
  else {
    const diff = daysBetween(date, sd);
    if (diff != null && diff <= 3) events.push({ date: sd, pos, kind: 'snap-next', exact: false });
  }
}

/**
 * @param {string} code
 * @param {string} date YYYY-MM-DD
 * @param {Array<object>} snapshots portfolio_snapshot[]
 * @param {Array<object>} trades trade_log[]
 * @returns {number|null}
 */
function actualHeldPosition(code, date, snapshots, trades) {
  if (!code || !date) return null;
  const events = [];
  (snapshots || []).forEach((s) => pushSnap(events, code, date, s));
  (trades || []).forEach((t) => {
    if (!t || t.code !== code || t.position_after == null || !t.trade_date) return;
    if (t.trade_date > date || Number.isNaN(Number(t.position_after))) return;
    events.push({
      date: t.trade_date,
      pos: Number(t.position_after),
      kind: 'trade',
      exact: t.trade_date === date
    });
  });
  if (!events.length) return null;
  const exactSnap = events.find((e) => e.kind === 'snap' && e.exact);
  if (exactSnap) return exactSnap.pos;
  const exactTrade = events.find((e) => e.kind === 'trade' && e.exact);
  if (exactTrade) return exactTrade.pos;
  const rank = { snap: 3, trade: 2 };
  const past = events.filter((e) => e.kind !== 'snap-next');
  const future = events.filter((e) => e.kind === 'snap-next');
  past.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return (rank[b.kind] || 0) - (rank[a.kind] || 0);
  });
  future.sort((a, b) => (a.date < b.date ? -1 : 1));
  const p = past[0];
  const f = future[0];
  if (p && f) {
    const pd = daysBetween(p.date, date);
    const fd = daysBetween(date, f.date);
    if (pd != null && fd != null && fd < pd) return f.pos;
    return p.pos;
  }
  return p ? p.pos : (f ? f.pos : null);
}

module.exports = { actualHeldPosition, daysBetween };
