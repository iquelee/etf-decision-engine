'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const integrity = require('../src/common/utils/v365-run-integrity');
const calendar = require('../src/common/utils/cn-trading-calendar');
const active = require('../src/common/utils/v365-active-read');
const history = require('../src/common/utils/production-history');
const publishStore = require('../src/common/utils/v365-publish-store');
const { createMemoryAdapter } = require('../scripts/lib/v365-p3-memory-adapter');
const source = fs.readFileSync(path.join(__dirname, '../cloudfunctions/runDecisionEngine/index.js'), 'utf8');
const zones = [...source.matchAll(/\/\/ >>> v365-orch-zone: lifecycle_writer([\s\S]*?)\/\/ <<< v365-orch-zone: lifecycle_writer/g)].map(match => match[1]);
assert.strictEqual(zones.length, 2);
const codes = ['513310', '515880', '159582', '518880', '159570'];
const clone = value => JSON.parse(JSON.stringify(value));

async function run(now, options = {}) {
  const authority = integrity.resolveExpectedTradeDate(new Date(now), calendar.loadRepoCalendar());
  assert.strictEqual(authority.blocked, false);
  const expected = authority.expected_trade_date;
  const snapshots = Object.fromEntries(codes.map(code => [code, { calc_date: expected }]));
  const envelope = integrity.buildRunContext({ run_id: 'new-run', expected_codes: codes, snapshots,
    expected_trade_date: expected, expected_trade_date_authority: authority });
  assert.strictEqual(integrity.decideRunGate(envelope).publishable, true);
  const wallDate = calendar.beijingParts(new Date(now)).date;
  const portfolio = { snapshot_date: wallDate, total_asset: 100000, cash_balance: 50000 };
  const original = clone(portfolio);
  const store = createMemoryAdapter();
  await store.compareAndSetPointer('production', null, { run_id: 'previous-run', revision: 15, expected_trade_date: expected });
  const previous = await store.getPointer('production');
  const rows = [], legacy = [];
  const decisions = codes.map(code => ({ code, decision_date: expected, ok: true }));
  if (options.mixed) decisions[0].decision_date = '2026-10-26';
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return new Date(now).getTime(); }
  }
  const box = {
    console, path, Date: Clock, __dirname: __dirname,
    COLLECTIONS: require('../src/common/constants').COLLECTIONS,
    fs: { readFileSync() { throw new Error('source-only package'); } },
    v365Mode: options.mode || 'ENFORCE', v365Store: store, v365EngineRunIdBase: 'new-run',
    runIntegrity: integrity, publishStore, v365Envelope: envelope, snapshotDate: wallDate,
    v365SnapshotDoc: portfolio, v365Finality: integrity.computeFinality({ expected_codes: codes,
      results: Object.fromEntries(codes.map(code => [code, { ok: true }])) }),
    trendStageEnabled: true, merged: {}, resolveShadowEngineVersion: () => 'v3.6.1',
    inputDecisions: decisions,
    db: { upsert: async (collection, doc, selector) => { legacy.push({ collection, doc: clone(doc), selector }); return { created: true }; },
      query: async (_, filter) => rows.filter(row => row.run_id === filter.run_id),
      getCollection: () => ({ add: async row => { rows.push(clone(row)); } }) }
  };
  // Execute both actual RDE writer zones, including portfolio routing, manifest
  // creation, real candidate validation/CAS and append-after-promotion history.
  const result = await vm.runInNewContext('(async () => {' + zones[0]
    + '\nfor (const d of inputDecisions) await v365WriteDecision(d, d.code);\n'
    + zones[1] + '\nreturn { publish: v365PublishResult, history: v365HistoryRow }; })()', box);
  assert.deepStrictEqual(portfolio, original, 'legacy snapshot object must not be mutated');
  return { result, store, previous, rows, legacy, expected, wallDate };
}
(async () => {
  for (const now of ['2026-10-28T08:00:00+08:00', '2026-10-28T15:59:00+08:00',
    '2026-10-28T16:00:00+08:00', '2026-10-28T22:00:00+08:00',
    '2026-10-31T08:00:00+08:00', '2026-10-01T08:00:00+08:00']) {
    const { result, store, expected, wallDate, rows } = await run(now);
    const manifest = await store.getManifest('new-run');
    assert.strictEqual(manifest.expected_trade_date, expected, 'manifest must use calendar authority, not wall date ' + wallDate);
    assert.strictEqual(result.publish.promoted, true, JSON.stringify(result.publish.validation));
    assert.strictEqual(result.history.expected_trade_date, expected);
    assert.strictEqual(rows.length, 1);
    const dataset = await active.readAuthoritativeDataset(store, { expected_codes: codes });
    assert.strictEqual(dataset.available, true);
    assert.strictEqual(dataset.portfolio.snapshot_date, expected);
    assert.strictEqual(dataset.latest_fallback_used, false);
    assert.strictEqual(history.validateRun(rows[0], manifest, dataset.decisions, dataset.portfolio), true,
      'published run must remain readable through production history');
  }
  const bad = await run('2026-10-28T08:00:00+08:00', { mixed: true });
  assert.strictEqual(bad.result.publish.validation.reason, 'mixed_date_detected');
  assert.strictEqual(bad.result.publish.promoted, false);
  assert.deepStrictEqual(await bad.store.getPointer('production'), bad.previous);
  assert.strictEqual(bad.rows[0].promoted, false);
  const legacy = await run('2026-10-28T08:00:00+08:00', { mode: 'LEGACY' });
  assert.strictEqual(legacy.result.publish, null);
  assert.strictEqual(legacy.rows.length, 0);
  const snapshot = legacy.legacy.find(row => row.doc.snapshot_date);
  assert.strictEqual(snapshot.doc.snapshot_date, '2026-10-28');
  assert.strictEqual(snapshot.selector.snapshot_date, '2026-10-28');
  assert.deepStrictEqual(await legacy.store.getPointer('production'), legacy.previous);
  console.log('Actual RDE writer/calendar/CAS/history: morning, cutoff, EOD, weekend, holiday, mixed-date rejection and legacy snapshot semantics passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
