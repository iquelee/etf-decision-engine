'use strict';
const assert = require('assert'), path = require('path'), fs = require('fs'), crypto = require('crypto');
const {createHarness} = require('../scripts/lib/rde-offline-harness');
const {createAdminMaintenanceEntry, potentialMutation} = require('../release/writer-admin-maintenance');
let root = path.resolve(__dirname, '../cloudfunctions/adminGateway'), common = path.resolve(__dirname, '../src/common');
const binding = {environment: 'offline', scope: 'writer-rollout'}, copy = x => JSON.parse(JSON.stringify(x));
function setup(readRollout) {
  const h = createHarness(root, {common});let loads = 0;
  h.setRows('param_config', [...h.rows('param_config'), {_id: 'auth:fixture', key: 'admin_token', value: {v: 'fixture-session', exp: '2026-10-30T00:00:00Z'}}]);
  h.setRows('risk_events', [{_id: 'risk:fixture', code: '513310', status: 'active'}]);
  return {h, entry: createAdminMaintenanceEntry({binding, readRollout, loadMain: async () => {loads++;return h.entry.main;}}), loads: () => loads};
}
const rollout = state => ({schema: 1, ...binding, revision: 1, state});
const post = (route, body = {}) => ({httpMethod: 'POST', path: '/api/admin/' + route, headers: {'x-admin-token': 'fixture-session'}, body});
async function test() {
  const events = [post('risk', {code: '513310', event_type: 'POLICY', reason: 'fixture'}),
    post('risk', {action: 'resolve', event_id: 'risk:fixture', resolve_reason: 'fixture'}),
    post('param', {key: 'offline_fixture_param', value: 7}),post('fundamental/config'),post('fundamental/data'),
    post('trade'),post('portfolio/snapshot'),post('fetch', {task: 'daily'}),post('intel/refresh'),
    post('gen1/health/review'),post('logout'),post('changePassword'),post('login', {password: 'fixture'}),
    {httpMethod: 'GET', path: '/adminGateway/api/admin/login', body: {password: 'fixture'}},
    {method: 'GET', url: '/apiGateway/api/admin/login', body: {password: 'fixture'}},post('future-write-route')];
  const closed = setup(async () => rollout('CLOSED'));
  for (const event of events) {
    assert(potentialMutation(event));const result = await closed.entry({...event, force: true, maintenance: 'OPEN'}, {});
    assert.strictEqual(result.code, 503);
  }
  assert.strictEqual(closed.loads(), 0);assert.strictEqual(closed.h.writes.length, 0);
  for (const state of [null, {...rollout('OPEN'), scope: 'other'}, {...rollout('OPEN'), state: 'UNKNOWN'},
    {...rollout('OPEN'), revision: -1}, {...rollout('OPEN'), extra: true}]) {
    const invalid = setup(async () => state);assert.strictEqual((await invalid.entry(events[0], {})).code, 503);
    assert.strictEqual(invalid.h.writes.length, 0);assert.strictEqual(invalid.loads(), 0);
  }
  const unavailable = setup(async () => {throw Error('read unavailable');});
  assert.strictEqual((await unavailable.entry(events[0], {})).code, 503);assert.strictEqual(unavailable.h.writes.length, 0);
  // A real authenticated read remains available even while rollout data is
  // unavailable; original authentication is still required by the old entry.
  const read = {httpMethod: 'GET', path: '/api/admin/risk/list', headers: {'x-admin-token': 'fixture-session'}};
  const readResult = await unavailable.entry(read, {});assert.strictEqual(readResult.code, 0);
  assert.strictEqual((await unavailable.entry({...read, headers: {}}, {})).code, 401);
  assert.strictEqual(unavailable.h.writes.length, 0);
  // OPEN preserves actual whole-entry writes, validation and return values.
  const baseline = setup(async () => rollout('OPEN')), allowed = setup(async () => rollout('OPEN'));
  const expected = await baseline.h.run(events[0]), actual = await allowed.entry(events[0], {});
  assert.deepStrictEqual(copy(actual), copy(expected));assert.deepStrictEqual(allowed.h.writes, baseline.h.writes);
  for (const name of new Set(baseline.h.writes.map(x => x.collection))) assert.deepStrictEqual(allowed.h.rows(name), baseline.h.rows(name));
  // Explicit negative witness: an already-passed request can still write AFTER
  // closing the gate. Migration must drain it; this read gate is not fencing.
  let state = 'OPEN', entered, release;
  const started = new Promise(resolve => {entered = resolve;}), gate = new Promise(resolve => {release = resolve;});
  const inflight = setup(async () => rollout(state));let first = true;
  inflight.h.setOnWrite(async () => {if (first) {first = false;entered();await gate;}});
  const pending = inflight.entry(events[0], {});await started;state = 'CLOSED';
  assert.strictEqual((await inflight.entry(events[1], {})).code, 503);assert.strictEqual(inflight.h.writes.length, 0);
  release();await pending;assert(inflight.h.writes.some(x => x.collection === 'risk_events'));
  console.log(JSON.stringify({actual_admin_entry_closed_before_first_write: true, blocked_mutation_forms: events.length,
    malformed_or_missing_rollout_fails_closed: true, read_auth_and_open_business_preserved: true,
    passed_request_can_write_after_close: true, inflight_drain_still_required: true, transport: 'MEMORY_ONLY'}));
}
async function main() {
  const args = process.argv.slice(2);if (!args.length) return test();
  assert(args.length === 2 && args[0] === '--inventory-root');
  const base = path.resolve(args[1]), raw = fs.readFileSync(path.join(base, 'adminGateway.files.json'));
  const files = JSON.parse(raw), observed = require('../release/runtime24-writer-inventory.json').functions.find(x => x.FunctionName === 'adminGateway');
  const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  assert.strictEqual(sha(raw), observed.download.raw_file_map_sha256);
  root = path.join(base, 'adminGateway-download');common = path.join(root, 'common');
  const walk = directory => fs.readdirSync(directory, {withFileTypes: true}).flatMap(item => {
    assert(!item.isSymbolicLink());const file = path.join(directory, item.name);
    return item.isDirectory() ? walk(file) : [path.relative(root, file).split(path.sep).join('/')];
  });
  const check = () => {assert.deepStrictEqual(walk(root).sort(), Object.keys(files).sort());
    for (const [file, hash] of Object.entries(files)) assert.strictEqual(sha(fs.readFileSync(path.join(root, file))), hash);};
  check();await test();check();
  console.log(JSON.stringify({independent_admin_package_bytes_preserved: true, runtime: process.version, network_requests: 0}));
}
main().catch(error => {console.error(error);process.exitCode = 1;});
