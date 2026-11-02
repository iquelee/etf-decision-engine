'use strict';
const assert = require('assert'), path = require('path');
const {pathToFileURL} = require('url');
const {setup} = require('./writer-admin-http.test');
const uri = file => pathToFileURL(path.resolve(__dirname, '../web/src', file)).href;
function storage() {const rows = new Map();return {getItem: key => rows.get(key) || null,
  setItem: (key, value) => rows.set(key, value), removeItem: key => rows.delete(key), rows};}
function locks() {let held = false;return {async request(_name, options, fn) {
  assert.strictEqual(options.ifAvailable, true);if (held) return fn(null);held = true;
  try {return await fn({name: 'fixture-lock'});} finally {held = false;}
}};}
async function main() {
  const {createOperationTracker, OPERATION_KEY, adminOperations, reviewDestination} = await import(uri('utils/admin-operations.js'));
  assert.strictEqual(reviewDestination('POST /api/admin/param', 'https://fixture.example/etf/rewrite.html#/admin/param'),
    'https://fixture.example/etf/legacy.html#/admin/param');
  let sequence = 0;const crypto = {randomUUID: () => '00000000-0000-4000-8000-' + String(++sequence).padStart(12, '0')};
  const disk = storage(), manager = locks();
  const factory = () => createOperationTracker({storage: () => disk, locks: () => manager, crypto: () => crypto});
  const t = factory();let sends = 0, release;
  const pending = t.run('POST /risk', {b: 2, a: 1}, id => {sends++;return new Promise(resolve => {release = () => resolve({ok: true,
    json: {code: 0, data: {}, message: 'ok', operation_id: id, writer_outcome: 'COMPLETE'}});});});
  assert.strictEqual(t.run('POST /risk', {a: 1, b: 2}, () => {}), pending);
  await new Promise(resolve => setImmediate(resolve));assert.strictEqual(sends, 1);
  const otherTab = factory();await assert.rejects(otherTab.run('POST /risk', {}, () => {throw Error('must not send');}));
  release();await pending;assert.strictEqual(disk.getItem(OPERATION_KEY), null);assert.strictEqual(t.state().busy, false);
  const ids = [];
  await assert.rejects(t.run('POST /risk', {reason: 'private-fixture-body'}, id => {ids.push(id);throw Error('lost');}));
  assert(!disk.getItem(OPERATION_KEY).includes('private-fixture-body'));
  await assert.rejects(t.run('POST /risk', {reason: 'private-fixture-body'}, async id => {
    ids.push(id);return {ok: true, json: {code: 503, data: null, operation_id: id, writer_outcome: 'DENIED', message: 'closed'}};
  }));
  assert.strictEqual(ids[0], ids[1], 'denial after uncertainty never resets operation identity');
  await assert.rejects(t.run('POST /risk', {reason: 'changed'}, () => {throw Error('must not send');}));
  await assert.rejects(t.run('POST /risk', {reason: 'changed'}, () => {throw Error('changed retry must NEVER replace original snapshot');}));
  await assert.rejects(t.run('POST /risk', {reason: 'private-fixture-body'}, async id => {
    ids.push(id);return {ok: true, json: {code: 503, data: null, operation_id: id, writer_outcome: 'DENIED', message: 'closed'}};
  }));assert.strictEqual(ids[2], ids[0]);
  const reloaded = factory();await assert.rejects(reloaded.run('POST /risk', {reason: 'private-fixture-body'}, () => {throw Error('must not send');}));
  await assert.rejects(reloaded.acknowledge(ids[0], true));await reloaded.requestReview(ids[0]);
  await assert.rejects(reloaded.acknowledge(ids[0], false));await reloaded.acknowledge(ids[0], true);
  assert.strictEqual(disk.getItem(OPERATION_KEY), null);
  await t.run('POST /risk', {}, async id => ({ok: true, json: {code: 503, data: null, message: 'closed', operation_id: id, writer_outcome: 'DENIED'}}));
  assert.strictEqual(disk.getItem(OPERATION_KEY), null, 'fresh definitive denial consumes no client operation');
  await assert.rejects(t.run('POST /risk', {}, async () => ({ok: true, json: {operation_id: 'wrong', writer_outcome: 'COMPLETE'}})));
  const wrong = t.state().record.id;await t.requestReview(wrong);await t.acknowledge(wrong, true);
  disk.setItem(OPERATION_KEY, '{invalid');await assert.rejects(t.run('POST /risk', {}, () => {throw Error('must not send');}));disk.removeItem(OPERATION_KEY);
  const unsupported = createOperationTracker({storage: () => disk, crypto: () => crypto, locks: () => null});
  await assert.rejects(unsupported.run('POST /risk', {}, () => {throw Error('must not send');}));
  assert.strictEqual(disk.getItem(OPERATION_KEY), null);
  const saved = Object.fromEntries(['localStorage', 'navigator', 'crypto', 'fetch', 'window'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  try {
    const globals = {localStorage: disk, navigator: {locks: manager}, crypto, window: {location: {hash: ''}}};
    for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, {configurable: true, writable: true, value});
    disk.setItem('admin_token', 'fixture-session');
    const legacy = await import(uri('api/request.js')), rewrite = await import(uri('rewrite/api.js'));
    const server = await setup();let lost = true;const requestIds = [];
    globalThis.fetch = async (url, init) => {
      const event = {httpMethod: init.method, path: url, headers: init.headers};if (init.body !== undefined) event.body = init.body;
      requestIds.push(init.headers['X-Writer-Operation-Id']);
      const json = await server.bootstrap.main(event, server.context);
      if (lost) {lost = false;throw Error('response lost AFTER server completion');}
      return {ok: true, status: 200, json: async () => json};
    };
    const body = {code: '513310', event_type: 'POLICY', reason: 'private-fixture-body'};
    await assert.rejects(legacy.adminApi.postRisk(body), error => error.pendingOperation === true);
    assert.strictEqual(server.h.writes.length, 55);
    await assert.rejects(rewrite.admin.postRisk(body), error => error.kind === 'PENDING_OPERATION' && error.retryable === false);
    assert.strictEqual(server.h.writes.length, 55);assert.strictEqual(requestIds[0], requestIds[1]);
    const record = adminOperations.state().record;
    assert(!disk.getItem(OPERATION_KEY).includes('fixture-session'));assert(!disk.getItem(OPERATION_KEY).includes('private-fixture-body'));
    await adminOperations.requestReview(record.id);await adminOperations.acknowledge(record.id, true);
    const read = await legacy.adminApi.riskList();assert.strictEqual(read.list.filter(row => row.reason === body.reason).length, 1);
    assert.strictEqual(requestIds[2], undefined, 'reads have no operation header');
    assert.strictEqual(server.h.writes.length, 55);
  } finally {for (const [name, descriptor] of Object.entries(saved)) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);else delete globalThis[name];
  }}
  console.log(JSON.stringify({both_frontend_clients_to_full_admin_rde: true, lost_response_business_writes: 55,
    shared_retry_id_and_no_second_write: true, reload_blocks_new_operation: true, cross_tab_lock: true,
    payload_and_credentials_not_persisted: true, acknowledgement_bound_to_operation: true, transport: 'MEMORY_ONLY'}));
}
main().catch(error => {console.error(error);process.exitCode = 1;});
