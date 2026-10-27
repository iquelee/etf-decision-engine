'use strict';

// Historical reads only. No writes, current-position inference, or strategy changes.
const { COLLECTIONS } = require('../constants');
const { V365_COLLECTIONS: C } = require('./v365-contracts');
const calendar = require('./cn-trading-calendar');
const SWITCH_DATE = '2026-09-30'; // First promoted production run, verified 2026-10-27.
const MAX_RUNS = 500;

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}
function bounds(from, to) {
  if ((from && !validDate(from)) || (to && !validDate(to)) || (from && to && from > to)) throw new Error('INVALID_HISTORY_DATE_RANGE');
}
function dateFilter(_, from, to, before) {
  const terms = [];
  if (from) terms.push(_.gte(from));
  if (to) terms.push(_.lte(to));
  if (before) terms.push(_.lt(before));
  return terms.length > 1 ? _.and(...terms) : terms[0];
}
function selectDailyRuns(rows, pointer, from, to) {
  const daily = new Map();
  for (const h of rows) {
    if (h.scope !== 'production' || h.promoted !== true || h.status !== 'COMPLETE') continue;
    if (!validDate(h.expected_trade_date) || h.expected_trade_date < SWITCH_DATE) continue;
    if (h.expected_trade_date > pointer.expected_trade_date) continue;
    if ((from && h.expected_trade_date < from) || (to && h.expected_trade_date > to)) continue;
    if (!Number.isSafeInteger(h.revision) || h.revision <= 0 || h.revision > pointer.revision || !h.run_id) continue;
    const prev = daily.get(h.expected_trade_date);
    if (prev && prev.revision === h.revision && prev.run_id !== h.run_id) throw new Error('AMBIGUOUS_HISTORY_REVISION');
    if (!prev || h.revision > prev.revision) daily.set(h.expected_trade_date, h);
  }
  return [...daily.values()].sort((a,b) => b.expected_trade_date.localeCompare(a.expected_trade_date));
}
function validateRun(h, manifest, decisions, portfolio) {
  if (!manifest || manifest.run_id !== h.run_id || manifest.validation_passed !== true || manifest.status !== 'COMPLETE') return false;
  if (manifest.revision !== h.revision || manifest.expected_trade_date !== h.expected_trade_date) return false;
  const expected = manifest.expected_codes;
  if (!Array.isArray(expected) || expected.length === 0 || new Set(expected.map(String)).size !== expected.length) return false;
  if (decisions.length !== expected.length || new Set(decisions.map(d => String(d.code))).size !== decisions.length) return false;
  if (!decisions.every(d => d.run_id === h.run_id && expected.map(String).includes(String(d.code)) && d.decision_date === h.expected_trade_date)) return false;
  return !!portfolio && portfolio.run_id === h.run_id && portfolio.snapshot_date === h.expected_trade_date;
}

async function readProductionHistory(db, options = {}) {
  const { from, to, code } = options;
  bounds(from,to);
  const limit = Math.min(Math.max(Number(options.limit) || 500, 1), 500);
  const _ = db.getCommand();
  const history = { switch_date: SWITCH_DATE, selector:'promoted run_history, highest revision per trade date',
    pinned_revision:null, status:'OK', segments:[], gaps:[], truncated:false, latest_fallback_used:false };
  let decisions = [];
  const portfolios = [];
  if (!from || from < SWITCH_DATE) {
    const where = code ? {code} : {};
    where.decision_date = dateFilter(_,from,to,SWITCH_DATE);
    try {
      const rows = await db.query(COLLECTIONS.DECISION_RESULT,where,{
        orderBy:[{field:'decision_date',direction:'desc'}],limit:limit+1 // v365-reader-allow:history-deferred (explicit legacy archive segment only)
      });
      if (rows.length > limit) history.truncated = true;
      decisions.push(...rows.slice(0,limit).filter(d => validDate(d.decision_date) && d.decision_date < SWITCH_DATE && (!from || d.decision_date >= from) && (!to || d.decision_date <= to) && (!code || d.code === code)).map(d => ({...d,history_provenance:{axis:'LEGACY_ARCHIVE',source:'decision_result',switch_date:SWITCH_DATE}})));
      history.segments.push({axis:'LEGACY_ARCHIVE',from:from || null,to:to && to < SWITCH_DATE ? to : '2026-09-29',available:true});
    } catch (e) {
      history.gaps.push({axis:'LEGACY_ARCHIVE',reason:'ARCHIVE_READ_FAILED'});
    }
  }
  if (!to || to >= SWITCH_DATE) {
    try {
      const pointers = await db.query(C.ACTIVE_POINTER,{scope:'production'},{limit:1});
      const pointer = pointers[0];
      if (!pointer || !pointer.run_id || !Number.isSafeInteger(pointer.revision) || pointer.revision < 1 || !validDate(pointer.expected_trade_date)) throw new Error('NO_VALID_ACTIVE_POINTER');
      history.pinned_revision = pointer.revision;
      history.published_through = pointer.expected_trade_date;
      const runFrom = from && from > SWITCH_DATE ? from : SWITCH_DATE;
      const rows = await db.query(C.RUN_HISTORY,{scope:'production',promoted:true,
        expected_trade_date:dateFilter(_,runFrom,to),revision:_.lte(pointer.revision)},
      {orderBy:[{field:'expected_trade_date',direction:'desc'}],limit:MAX_RUNS+1});
      // Never choose a same-day winner from a truncated event list.
      if (rows.length > MAX_RUNS) throw new Error('RUN_HISTORY_RANGE_TOO_LARGE');
      const daily = selectDailyRuns(rows,pointer,from,to);
      const cal = calendar.loadRepoCalendar();
      const end = to && to < pointer.expected_trade_date ? to : pointer.expected_trade_date;
      if (!cal.valid || !calendar.inCoverage(runFrom,cal) || !calendar.inCoverage(end,cal)) {
        history.gaps.push({axis:'RUN_AXIS',reason:'CALENDAR_COVERAGE_UNAVAILABLE'});
      } else {
        const dates = new Set(daily.map(h => h.expected_trade_date));
        for (let d = runFrom; d <= end; d = calendar.shiftDate(d,1)) {
          if (calendar.isTradingDay(d,cal) && !dates.has(d)) history.gaps.push({date:d,reason:'PROMOTED_DAY_MISSING'});
        }
      }
      let runDecisionCount = 0;
      for (const h of daily) {
        if (runDecisionCount >= limit) {history.truncated=true;break;}
        if (code && Array.isArray(h.expected_codes) && !h.expected_codes.map(String).includes(String(code))) continue;
        try {
          const [ms,ds,ps] = await Promise.all([
            db.query(C.RUN_MANIFEST,{run_id:h.run_id},{limit:2}),
            db.query(C.CANDIDATE_DECISION,{run_id:h.run_id},{limit:201}),
            db.query(C.CANDIDATE_PORTFOLIO,{run_id:h.run_id,candidate_key:'portfolio'},{limit:2})
          ]);
          if (ms.length !== 1 || ps.length !== 1 || !validateRun(h,ms[0],ds,ps[0])) throw new Error('INCOMPLETE_OR_INCOHERENT_RUN');
          const provenance = {axis:'RUN_AXIS',source:'run_history → run_candidate_decision',run_id:h.run_id,revision:h.revision,
            trade_date:h.expected_trade_date,release_version:h.engine_version || null,switch_date:SWITCH_DATE};
          const selected=ds.filter(d => !code || d.code === code).map(d => ({...d,history_provenance:provenance}));
          decisions.push(...selected);
          runDecisionCount += selected.length;
          portfolios.push({...ps[0],history_provenance:provenance});
        } catch (e) { history.gaps.push({run_id:h.run_id,date:h.expected_trade_date,reason:'RUN_DATA_UNAVAILABLE'}); }
      }
      history.segments.push({axis:'RUN_AXIS',from:runFrom,to:end >= runFrom ? end : null,requested_to:to || null,available:true,
        promoted_days:daily.length});
      // A naturally published run exists on the pointer's day. An absent timeline
      // entry for that day is a detectable hole, not a successful empty response.
      const pointerInRange = (!from || pointer.expected_trade_date >= from) && (!to || pointer.expected_trade_date <= to);
      if (pointerInRange && !daily.some(h => h.run_id === pointer.run_id)) history.gaps.push({date:pointer.expected_trade_date,reason:'ACTIVE_RUN_MISSING_FROM_HISTORY'});
    } catch (e) {
      history.segments.push({axis:'RUN_AXIS',available:false});
      history.gaps.push({axis:'RUN_AXIS',reason:e.message === 'RUN_HISTORY_RANGE_TOO_LARGE' ? e.message : 'HISTORY_INDEX_UNAVAILABLE'});
    }
  }
  decisions.sort((a,b) => b.decision_date.localeCompare(a.decision_date) || String(a.code).localeCompare(String(b.code)));
  if (decisions.length > limit) history.truncated = true;
  decisions = decisions.slice(0,limit);
  if (history.gaps.length) history.status = decisions.length ? 'PARTIAL' : 'UNAVAILABLE';
  else if (history.truncated) history.status = 'TRUNCATED';
  history.coverage = history.segments.length > 1 ? 'CROSS_SWITCH_SEGMENTS' : history.segments[0] && history.segments[0].axis;
  return {decisions,portfolios,history};
}
module.exports = {SWITCH_DATE,bounds,selectDailyRuns,validateRun,readProductionHistory};
