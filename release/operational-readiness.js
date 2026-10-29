#!/usr/bin/env node
'use strict';
// Local readiness report only; does not provision a runtime, extend a calendar,
// install dependencies, trigger production, or schedule evidence capture.
const cal=require('../src/common/utils/cn-trading-calendar');
const baseline=require('./production-baseline.json');
const arg=process.argv.indexOf('--as-of');
const now=arg>=0 ? new Date(process.argv[arg+1]) : new Date();
if(!Number.isFinite(now.getTime()))throw new Error('Invalid --as-of ISO timestamp');
const calendar=cal.loadRepoCalendar();
const expected=cal.resolveExpectedTradeDate(now,calendar);
const expiry=cal.calendarExpiryStatus(now,calendar);
const report={as_of:now.toISOString(),local_node:process.version,
  observed_production_runtime:baseline.runtime_observed,observation_time:baseline.observed_at,
  calendar:{version:calendar.calendar_version,coverage:calendar.coverage,expected_trade_date:expected.expected_trade_date,
    blocked:expected.blocked,reason:expected.resolution_reason,expiry},
  runtime_upgrade_status:'NOT_PERFORMED; select a platform-supported target and verify SDK compatibility separately',
  calendar_extension_status:'NOT_PERFORMED; requires official exchange notices and a new versioned artifact',
  evidence_capture_status:'FROZEN_FORMAL_ENTRY_UNCHANGED; use reader-source-audit sidecars to disclose stale source-derived fields'};
console.log(JSON.stringify(report,null,2));
if(expected.blocked || !calendar.valid)process.exitCode=1;
