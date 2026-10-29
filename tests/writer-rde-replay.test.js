'use strict';
const assert = require('assert'), path = require('path');
const {createHarness} = require('../scripts/lib/rde-offline-harness');
const g = require('../release/writer-admission');
const {createMemoryStore} = require('../scripts/lib/writer-admission-memory-store');
const root = path.resolve(__dirname, '../cloudfunctions/runDecisionEngine');
const common = path.resolve(__dirname, '../src/common');
async function replay(rootPath = root, commonPath = common) {
  const baseline = createHarness(rootPath, {common: commonPath});
  const baselineResult = await baseline.run();
  const fixture = createHarness(rootPath, {common: commonPath});
  const binding = {environment: 'offline', scope: 'rde'};
  const store = createMemoryStore(g.initial(binding));
  const proof = {reference: 'fixture:terminal', entries_closed: true, executions_terminal: true, retries_accounted_for: true};
  await g.apply(store, binding, {type: 'activate', revision: 0, owner: 'old', proof});
  const identity = {revision: 1, owner: 'old', epoch: 1, request_id: 'morning:2026-10-29', token: 'one'};
  const before = fixture.writes.length;
  assert.strictEqual((await g.execute(store, binding, {...identity, owner: 'new'}, () => fixture.run())).executed, false);
  assert.strictEqual(fixture.writes.length, before, 'denied before even config synchronization');
  const result = await g.execute(store, binding, identity, () => fixture.run());
  assert.strictEqual(result.outcome, 'COMPLETE');
  assert.strictEqual(result.result.ok, true, JSON.stringify(result.result));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(result.result)), JSON.parse(JSON.stringify(baselineResult)),
    'admitted whole entry must preserve complete business response');
  assert.deepStrictEqual(fixture.writes, baseline.writes, 'admission cannot change write order/count');
  for (const name of [...new Set(fixture.writes.map(row => row.collection))])
    assert.deepStrictEqual(fixture.rows(name), baseline.rows(name), 'all persisted payloads must match: ' + name);
  assert.strictEqual(fixture.rows('active_run_pointer').length, 1, JSON.stringify(fixture.diagnostics));
  const manifest = fixture.rows('run_manifest')[0];
  assert.strictEqual(manifest.validation_passed, true, JSON.stringify(manifest));
  assert.strictEqual(fixture.rows('run_candidate_decision').length, 5);
  assert.strictEqual(fixture.rows('run_candidate_portfolio').length, 1);
  assert.strictEqual(fixture.rows('run_history')[0].promoted, true);
  assert(fixture.writes.some(row => row.collection === 'fundamental_config'));
  assert(fixture.writes.some(row => row.collection === 'portfolio_position'));
  assert(fixture.writes.some(row => row.collection === 'runtime_status'));
  const after = fixture.writes.length;
  const repeated = await g.execute(store, binding, {...identity, revision: (await store.read()).revision}, () => fixture.run());
  assert.strictEqual(repeated.admission, 'ALREADY_COMPLETE');
  assert.strictEqual(fixture.writes.length, after, 'duplicate cannot rewrite state or publish another run');
  // Pause the REAL entry at its first config write, while its execution slot is
  // occupied. An overlapping request and owner switch may not enter/write.
  const concurrentFixture = createHarness(rootPath, {common: commonPath});
  const concurrentStore = createMemoryStore(g.initial(binding));
  await g.apply(concurrentStore, binding, {type: 'activate', revision: 0, owner: 'old', proof});
  let resume, entered;
  const gate = new Promise(resolve => { resume = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  let first = true;
  concurrentFixture.setOnWrite(async () => { if (first) { first = false; entered(); await gate; } });
  const running = g.execute(concurrentStore, binding, identity, () => concurrentFixture.run());
  await started;
  const rival = await g.execute(concurrentStore, binding, {...identity, revision: 2,
    request_id: 'admin:parameter-change', token: 'rival'}, () => concurrentFixture.run());
  assert.strictEqual(rival.executed, false);
  assert.strictEqual(concurrentFixture.writes.length, 0, 'first admitted write is still paused');
  assert((await g.apply(concurrentStore, binding, {type: 'drain', revision: 2})).ok);
  assert.strictEqual((await g.apply(concurrentStore, binding, {type: 'activate', revision: 3, owner: 'new', proof})).reason, 'BUSY');
  assert((await g.apply(concurrentStore, binding, {...identity, type: 'unknown', revision: 3})).ok,
    'caller timeout marks unknown while real callee is still alive');
  assert.strictEqual((await g.apply(concurrentStore, binding, {type: 'activate', revision: 4, owner: 'new', proof})).reason, 'BUSY');
  resume(); assert.strictEqual((await running).outcome, 'COMPLETE');
  assert.deepStrictEqual(concurrentFixture.writes, fixture.writes);
  assert.strictEqual((await concurrentStore.read()).state, 'HOLD', 'late terminal return cannot reopen admission');
  assert((await g.apply(concurrentStore, binding, {type: 'activate', revision: 5, owner: 'new', proof})).ok);
  return {whole_entry: true, synthetic_fixture: true, sdk_boundary: 'MEMORY_ONLY', writes: after,
    collections: [...new Set(fixture.writes.map(row => row.collection))],
    candidates: 5, portfolios: 1, promoted: true, expected_trade_date: fixture.date,
    full_response_and_all_written_payloads_match_baseline: true, real_first_write_concurrency_and_drain: true};
}
module.exports = {replay};
if (require.main === module) replay().then(result => console.log(JSON.stringify(result)))
  .catch(error => { console.error(error); process.exitCode = 1; });
