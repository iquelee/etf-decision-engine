#!/usr/bin/env node
'use strict';
// Offline whole captured Core entry + actual SDK/database/common/db replay.
// Run in a credential-free child. Only DBRequest.send and Axios's transport
// adapter receive synthetic fixtures; business code and parsers stay intact.
const assert = require('assert'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const {spawnSync} = require('child_process');
const {fileMap} = require('./prepare-writer-workers');
const {createBusinessWire} = require('./writer-sdk-memory-wire');
const {backend} = require('../tests/writer-journal-cloudbase.test');
const {assertCoreWriters} = require('./runtime24-v3-core-scope');
const PRODUCER = 'fetchRealtimeData';assertCoreWriters([PRODUCER]);
const inventory = require('./runtime24-writer-six-inventory.json').functions.find(f => f.FunctionName === PRODUCER);
const manifest = require('./runtime24-writer-core-candidates.json');
const pack = manifest.packages.find(p => p.producer === PRODUCER);
const ENV = 'tradingview-etf-d0fa42yy57cbc11b', JOURNAL = 'writer_admission_journal_v1';
const codes = ['513310', '515880', '159582', '518880', '159570'];
const copy = value => JSON.parse(JSON.stringify(value));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const definitions = Object.freeze([
  {name: 'update-existing', now: '2026-10-29T01:05:00Z', existing: 5, writes: 6, quotes: 5},
  {name: 'insert-missing', now: '2026-10-29T01:05:00Z', existing: 0, writes: 6, quotes: 5},
  {name: 'mixed-partial', now: '2026-10-29T01:05:00Z', existing: 2, writes: 5, quotes: 5, badCode: '159570'},
  {name: 'off-hours', now: '2026-10-29T07:10:00Z', existing: 5, writes: 0, quotes: 0, skipped: 'off_hours'},
  {name: 'holiday', now: '2026-10-01T01:05:00Z', existing: 5, writes: 0, quotes: 0, skipped: 'holiday'},
  {name: 'signed-force-off-hours', now: '2026-10-29T12:05:00Z', existing: 0, writes: 6, quotes: 5, signed: true},
  {name: 'admission-commit-ack-lost', now: '2026-10-29T01:05:00Z', existing: 5, fault: 'admit', writes: 0, quotes: 0},
  {name: 'completion-commit-ack-lost', now: '2026-10-29T01:05:00Z', existing: 5, fault: 'finish', writes: 6, quotes: 5}
]);
function noNetwork() {
  let attempts = 0;
  const deny = () => {attempts++;throw Error('OFFLINE_NETWORK_DENIED');};
  for (const name of ['http', 'https']) {const m = require(name);m.request = m.get = deny;}
  require('net').Socket.prototype.connect = deny;require('tls').connect = deny;
  const dns = require('dns');dns.lookup = dns.resolve = deny;global.fetch = deny;
  return () => attempts;
}
function quote(code, malformed) {
  if (malformed) return Buffer.from('fixture-malformed-quote');
  const fields = Array(38).fill('');const n = codes.indexOf(code);
  fields[0] = '1';fields[1] = 'synthetic';fields[2] = code;fields[3] = String(10 + n);
  fields[4] = String(9.9 + n);fields[5] = String(9.95 + n);fields[30] = '20261029090500';
  fields[32] = '1.01';fields[33] = String(10.1 + n);fields[34] = String(9.9 + n);
  return Buffer.from('v_fixture="' + fields.join('~') + '";');
}
function verify(root, map, expected) {
  assert.strictEqual(sha(fs.readFileSync(map)), expected, 'unbound package map');
  assert.deepStrictEqual(fileMap(root), JSON.parse(fs.readFileSync(map)), 'captured package drift');
}
async function execute(inputs, candidates) {
  assert.strictEqual(process.env.V3_CORE_SDK_CHILD, 'yes');
  assert.strictEqual(Number(process.versions.node.split('.')[0]), 24, 'actual Node24 candidate execution required');
  assert.strictEqual(manifest.release_scope, 'V3_CORE_ONLY');
  const input = path.resolve(inputs, PRODUCER + '-download'), candidate = path.resolve(candidates, pack.target);
  const check = () => {
    verify(input, path.resolve(inputs, PRODUCER + '.files.json'), inventory.download.raw_file_map_sha256);
    verify(candidate, path.resolve(candidates, pack.target + '.files.json'), pack.map_sha256);
    assert.strictEqual(sha(fs.readFileSync(path.resolve(inputs, PRODUCER + '.zip'))), inventory.download.archive_sha256);
    assert.strictEqual(sha(fs.readFileSync(path.resolve(candidates, pack.target + '.zip'))), pack.zip_sha256);
    const identity = JSON.parse(fs.readFileSync(path.join(candidate, 'SOURCE_IDENTITY.json')));
    assert.strictEqual(identity.source_commit, manifest.source_commit);assert.strictEqual(identity.release_scope, 'V3_CORE_ONLY');
  };
  const attempts = noNetwork();check();
  const NativeDate = Date;let now = NativeDate.parse(definitions[0].now);
  global.Date = class extends NativeDate {constructor(...args) {super(...(args.length ? args : [now]));} static now() {return now;}};
  process.env.TCB_ENV = ENV;process.env.SCF_NAMESPACE = ENV;
  const key = Buffer.alloc(32, 47);process.env.WRITER_REALTIME_SIGNING_KEY_HEX = key.toString('hex');
  const restorers = [];
  function load(root, wrapped) {
    const sdk = require(path.join(root, 'node_modules/@cloudbase/node-sdk'));
    const axios = require(path.join(root, 'node_modules/axios'));
    const {EJSON} = require(path.join(root, 'node_modules/bson'));
    assert.strictEqual(require(path.join(root, 'node_modules/@cloudbase/node-sdk/package.json')).version, '2.11.0');
    assert.strictEqual(require(path.join(root, 'node_modules/@cloudbase/database/package.json')).version, '1.4.1');
    const collections = require(path.join(root, 'common/constants')).COLLECTIONS;
    const state = {source: 'timer', business: null, journal: null, provider: [], forbiddenProvider: [], definition: null};
    const {DBRequest} = require(path.join(root, 'node_modules/@cloudbase/node-sdk/lib/utils/dbRequest'));
    const previous = DBRequest.prototype.send;
    DBRequest.prototype.send = function(action, params = {}) {
      assert.strictEqual(this.config.envName, ENV);
      if (wrapped) {
        assert.strictEqual(this.config.retries, 0, 'candidate SDK retry must stay disabled');
        assert.strictEqual(this.config.keepalive, false, 'candidate socket resend must stay disabled');
      }
      if (/^database\.(startTransaction|commitTransaction|abortTransaction)$/.test(action) || params.collectionName === JOURNAL)
        return state.journal.send(action, params);
      return state.business.send(action, params).then(result => {
        if (wrapped && state.definition.fault === 'finish' && state.business.writes.length === state.definition.writes && !state.faultArmed) {
          state.faultArmed = true;
          state.journal.fault = {action: 'database.commitTransaction', after: true,
            response: {code: 'SIMULATED_COMMIT_ACK_LOST', requestId: 'fixture:ack-lost'}};
        }
        return result;
      });
    };
    restorers.push(() => {DBRequest.prototype.send = previous;});
    sdk.getCloudbaseContext = () => ({TCB_ENV: ENV, TRIGGER_SRC: state.source});
    axios.defaults.adapter = async config => {
      const matched = /^https:\/\/qt\.gtimg\.cn\/q=(sh|sz)(\d{6})$/.exec(config.url);
      if (!matched || !codes.includes(matched[2]) || config.method !== 'get' || config.responseType !== 'arraybuffer') {
        state.forbiddenProvider.push(String(config.url));throw Error('UNREVIEWED_PROVIDER_REQUEST');
      }
      const code = matched[2];assert.strictEqual(matched[1], code.startsWith('5') ? 'sh' : 'sz');
      state.provider.push({url: config.url, method: config.method, responseType: config.responseType});
      return {status: 200, statusText: 'OK', headers: {}, config,
        data: quote(code, state.definition.badCode === code), request: {fixture: true}};
    };
    const index = require(path.join(root, 'index.js'));
    return {root, state, sdk, EJSON, collections, index, wrapped};
  }
  try {
    const original = load(input, false), actual = load(candidate, true);
    const adapter = require(path.join(candidate, 'writer-journal-cloudbase'));
    const journal = require(path.join(candidate, 'writer-admission-journal'));
    const entry = require(path.join(candidate, 'writer-entry'));
    const binding = {environment: ENV, scope: 'production/' + PRODUCER};
    const database = actual.sdk.init({env: ENV, retries: 0, keepalive: false}).database();
    const store = adapter.createProductionStore({database, binding});
    const context = {function_name: pack.target, request_id: 'fixture:native-1'};const results = [], faultCases = [];
    for (const definition of definitions) {
      now = NativeDate.parse(definition.now);
      const date = new NativeDate(now + 8 * 3600000).toISOString().slice(0, 10);
      for (const side of [original, actual]) {
        const {state, EJSON, collections: c} = side;
        state.definition = definition;state.source = 'timer';state.provider = [];state.forbiddenProvider = [];state.faultArmed = false;
        state.business = createBusinessWire({EJSON, collections: [c.ETF_BASIC, c.ETF_DAILY, c.FETCH_LOG]});
        state.journal = backend(EJSON, JOURNAL);
        state.business.seed(c.ETF_BASIC, codes.map((code, i) => ({_id: 'basic:' + code, code, status: 'enable', sort_order: i})).concat(
          [{_id: 'basic:disabled', code: '000000', status: 'disable', sort_order: -1}]));
        state.business.seed(c.ETF_DAILY, codes.map(code => ({_id: 'prior:' + code, code, trade_date: '2026-09-29', close: 7})).concat(
          codes.slice(0, definition.existing).map(code => ({_id: 'daily:' + code, code, trade_date: date,
            open: 8, high: 11, low: 7, close: 9, volume: 10000, is_final: false,
            realtime: {fixture_metadata: 'preserve', price: 1}}))));
      }
      actual.state.journal.seed(adapter.id(binding, 'control'), adapter.encodeControl(journal.initial(binding), binding));
      assert((await journal.apply(store, binding, {type: 'activate', owner: 'new', revision: 0,
        proof: {reference: 'fixture:offline-core-sdk', entries_closed: true, executions_terminal: true, retries_accounted_for: true}})).ok);
      const business = definition.signed ? {force: true} : {Type: 'Timer', TriggerName: 'realtime-5min', Time: definition.now, Message: 'writer-root-timer-v1'};
      const request = definition.signed ? entry.seal({binding, control: await store.read(binding), target: pack.target,
        request_id: 'fixture:' + definition.name, business, key}) : business;
      if (!definition.signed) {
        actual.state.source = 'sdk';const before = actual.state.journal.calls.length;
        assert.strictEqual((await actual.index.main(copy(request), context)).executed, false);
        assert.strictEqual(actual.state.journal.calls.length, before);assert.strictEqual(actual.state.business.calls.length, 0);
        assert.strictEqual(actual.state.provider.length, 0);actual.state.source = 'timer';
      }
      if (definition.fault) {
        if (definition.fault === 'admit') {
          actual.state.faultArmed = true;
          actual.state.journal.fault = {action: 'database.commitTransaction', after: true,
            response: {code: 'SIMULATED_COMMIT_ACK_LOST', requestId: 'fixture:ack-lost'}};
        }
        const uncertain = await actual.index.main(copy(request), context);
        assert.strictEqual(uncertain.error_code, 'WRITER_EXECUTION_UNKNOWN');assert.strictEqual(uncertain.hold_confirmed, true);
        const state = actual.state;assert(state.faultArmed);assert.strictEqual(state.journal.fault, null, 'fault must be consumed once');
        assert.strictEqual(state.business.writes.length, definition.writes);assert.strictEqual(state.provider.length, definition.quotes);
        assert.deepStrictEqual(state.business.violations, []);assert.deepStrictEqual(state.forbiddenProvider, []);
        const held = await store.read(binding);assert.strictEqual(held.state, 'HOLD');
        assert.strictEqual(Boolean(held.active), definition.fault === 'admit');
        const receipts = state.journal.rows().filter(row => ['request', 'token'].includes(row.kind));
        const status = definition.fault === 'admit' ? 'RUNNING' : 'COMPLETE';
        assert.strictEqual(receipts.length, 2);assert(receipts.every(row => JSON.parse(row.payload_json).status === status));
        const counts = [state.business.calls.length, state.business.writes.length, state.provider.length];
        assert.strictEqual((await actual.index.main(copy(request), {...context, request_id: 'fixture:retry'})).error_code, 'WRITER_ADMISSION_CLOSED');
        assert.deepStrictEqual([state.business.calls.length, state.business.writes.length, state.provider.length], counts);
        faultCases.push({case: definition.name, business_writes: definition.writes, control: 'HOLD', dual_receipt_status: status,
          automatic_retry: false, duplicate_business_calls: 0});
        continue;
      }
      const expected = await original.index.main(copy(business), {});
      const wrappedResult = await actual.index.main(copy(request), context);
      const result = definition.signed ? wrappedResult.result : wrappedResult;
      if (definition.signed) assert.strictEqual(wrappedResult.outcome, 'COMPLETE');
      assert.deepStrictEqual(copy(result), copy(expected), definition.name + ': whole response changed');
      assert.strictEqual(result.ok, true);assert.strictEqual(result.skipped, definition.skipped);
      if (!definition.skipped) {
        assert.strictEqual(result.results.length, 5);
        assert.strictEqual(result.results.filter(row => row.ok).length, definition.badCode ? 4 : 5,
          JSON.stringify({case: definition.name, results: result.results, model_violations: actual.state.business.violations}));
      }
      const left = actual.state, right = original.state;
      assert.deepStrictEqual(copy(left.business.writes), copy(right.business.writes), definition.name + ': wire write payload/order changed');
      assert.deepStrictEqual(copy(left.business.snapshot()), copy(right.business.snapshot()), definition.name + ': final table state changed');
      if (!definition.skipped) {
        for (const code of codes.slice(0, definition.existing).filter(code => code !== definition.badCode)) {
          const row = left.business.rows(actual.collections.ETF_DAILY).find(row => row._id === 'daily:' + code);
          assert.strictEqual(row.realtime.fixture_metadata, 'preserve', 'SDK dot updates preserve unmentioned fields');
          assert.strictEqual(row.volume, 10000, 'realtime update cannot replace the daily bar');
        }
      }
      assert.deepStrictEqual(left.provider, right.provider);assert.strictEqual(left.provider.length, definition.quotes);
      assert.strictEqual(left.forbiddenProvider.length + right.forbiddenProvider.length, 0);
      assert.deepStrictEqual(left.business.violations, [], 'caught unreviewed actual SDK request');
      assert.deepStrictEqual(right.business.violations, [], 'caught unreviewed baseline SDK request');
      assert.strictEqual(left.business.writes.length, definition.writes);
      const before = {business: left.business.calls.length, writes: left.business.writes.length, provider: left.provider.length};
      const repeated = await actual.index.main(copy(request), {...context, request_id: 'fixture:native-2'});
      assert.strictEqual(definition.signed ? repeated.admission : repeated.reason, 'ALREADY_COMPLETE');
      assert.deepStrictEqual({business: left.business.calls.length, writes: left.business.writes.length, provider: left.provider.length}, before);
      const control = await store.read(binding);assert.strictEqual(control.state, 'ACTIVE');assert.strictEqual(control.active, null);
      const receipts = left.journal.rows().filter(row => ['request', 'token'].includes(row.kind));
      assert.strictEqual(receipts.length, 2);assert(receipts.every(row => JSON.parse(row.payload_json).status === 'COMPLETE'));
      results.push({case: definition.name, business_writes: definition.writes, provider_fixture_requests: left.provider.length,
        business_sdk_wire_requests: left.business.calls.length, dual_complete_receipts: 2, duplicate_business_calls: 0});
    }
    assert.strictEqual(attempts(), 0);check();
    return {status: 'PASS_CORE_REALTIME_ACTUAL_SDK_MEMORY_WIRE', scope: 'V3_CORE_ONLY', producer: PRODUCER,
      runtime: process.version, sdk: '2.11.0', database: '1.4.1', package_source: manifest.source_commit,
      cases: results, fault_cases: faultCases, all_business_results_writes_and_final_tables_equal: true,
      network_attempts: attempts(), cloud_calls: 0, production_and_natural_qualification: 'NOT_PROVEN'};
  } finally {restorers.reverse().forEach(restore => restore());global.Date = NativeDate;}
}
function main() {
  let args = process.argv.slice(2);const child = args[0] === '--child';if (child) args = args.slice(1);
  assert(args.length === 4 && args[0] === '--inputs' && args[2] === '--candidates');
  if (child) return execute(args[1], args[3]).then(result => console.log(JSON.stringify(result)));
  const env = {V3_CORE_SDK_CHILD: 'yes'};
  for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP']) if (process.env[key]) env[key] = process.env[key];
  const result = spawnSync(process.execPath, [__filename, '--child', ...args], {env, encoding: 'utf8', timeout: 300000, maxBuffer: 1024 * 1024});
  if (result.stdout) process.stdout.write(result.stdout);if (result.stderr) process.stderr.write(result.stderr);
  assert.strictEqual(result.status, 0, 'Core SDK replay child failed; not cloud qualification');
}
if (require.main === module) Promise.resolve().then(main).catch(error => {console.error(error);process.exitCode = 1;});
