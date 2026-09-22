'use strict';
/**
 * Gate P-B 重放驱动：在指定源码根上跑 harness，导出逐日逐票决策字段为 JSON。
 * 用法：node pb-driver.js <root> <runsPerDay> <outJson>
 */
const fs = require('fs');  // audit/v364-promotion
const path = require('path');

const ROOT = process.argv[2];
const RUNS = Number(process.argv[3] || 1);
const OUT = process.argv[4];

const H = require(path.join(ROOT, 'scripts/lib/v364-replay-harness.js'));

const t0 = Date.now();
const r = H.replay({ runsPerDay: RUNS, collectRuns: RUNS > 1 });
const ms = Date.now() - t0;

const payload = {
  root: ROOT,
  runs_per_day: RUNS,
  elapsed_ms: ms,
  meta: r.meta,
  axis: r.axis,
  days: r.days.map((d) => ({ trade_date: d.trade_date, market_regime: d.market_regime, byCode: d.byCode })),
  run_diffs: r.runDiffs,
  final_state: r.finalState,
  final_book: r.finalBook
};
if (RUNS > 1) {
  payload.first_run_by_code = r.days.map((d) => ({ trade_date: d.trade_date, byCode: d.firstRunByCode }));
}
fs.writeFileSync(OUT, JSON.stringify(payload), 'utf8');
console.log(`[${path.basename(ROOT)}] runs/day=${RUNS} days=${r.axis.length} elapsed=${ms}ms -> ${path.basename(OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
console.log(`   axis ${r.axis[0]} ~ ${r.axis[r.axis.length - 1]}`);
console.log(`   live_snapshot_fields=${r.meta.snapshot_shaping.live_field_count}  dropped_example=${JSON.stringify(r.meta.snapshot_shaping.dropped_fields_example)}`);
