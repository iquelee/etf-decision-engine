#!/usr/bin/env node
'use strict';
// Actual captured admin HTTP -> actual captured RDE, with real SDK serializers.
// Only DBRequest and functions HTTP transport are memory-only. No business shim.
const assert = require('assert'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const {spawnSync} = require('child_process');
const {fileMap} = require('./prepare-writer-workers');
const {createBusinessWire} = require('./writer-sdk-memory-wire');
const {backend} = require('../tests/writer-journal-cloudbase.test');
const {assertCoreWriters} = require('./runtime24-v3-core-scope');
const names = ['runDecisionEngine', 'adminGateway'];assertCoreWriters(names);
const ENV = 'tradingview-etf-d0fa42yy57cbc11b', JOURNAL = 'writer_admission_journal_v1';
const manifestArg = process.argv.indexOf('--manifest');assert(manifestArg > 1 && process.argv[manifestArg + 1]);
const manifest = JSON.parse(fs.readFileSync(path.resolve(process.argv[manifestArg + 1])));
const inventory = require('./runtime24-writer-inventory.json');
const copy = x => JSON.parse(JSON.stringify(x));
const sha = x => crypto.createHash('sha256').update(x).digest('hex');
const codes = ['513310', '515880', '159582', '518880', '159570'];
const signingKeys = Object.fromEntries(names.map((name, i) => [name, Buffer.alloc(32, 61 + 6 * i)]));
const definitions = [
  {name: 'risk-create', route: 'risk', body: {code: '513310', event_type: 'POLICY', reason: 'fixture'}, writes: 55},
  {name: 'risk-resolve', route: 'risk', body: {action: 'resolve', event_id: 'risk:fixture', resolve_reason: 'fixture'}, writes: 55},
  {name: 'param-update', route: 'param', body: {key: 'offline_fixture_param', value: 7}, writes: 55},
  {name: 'failed-login', route: 'login', body: {password: 'wrong'}, writes: 2, login: true},
  {name: 'authenticated-read', route: 'risk/list', read: true, missing: true, writes: 0},
  {name: 'intel-cooled', route: 'intel/refresh', cooled: true, writes: 0},
  {name: 'maintenance-closed', route: 'risk', denied: 503, closed: true},
  {name: 'maintenance-missing', route: 'risk', denied: 503, missing: true},
  {name: 'wrong-token', route: 'risk', denied: 401, badToken: true},
  {name: 'missing-operation-id', route: 'risk', denied: 400, missingId: true},
  ...['daily','realtime','news','extract','fetchDailyData'].map(task => ({name: 'enqueue-' + task, route: 'fetch', body: {task}, enqueue: true})),
  {name: 'enqueue-intel', route: 'intel/refresh', enqueue: true},
  {name: 'enqueue-ack-lost-before', route: 'fetch', body: {task: 'daily'}, enqueueFault: true, after: false},
  {name: 'enqueue-ack-lost-after', route: 'fetch', body: {task: 'daily'}, enqueueFault: true, after: true}
];
const op = '00000000-0000-4000-8000-000000000001';
function noNetwork() {
  let attempts = 0;const deny = () => {attempts++;throw Error('OFFLINE_NETWORK_DENIED');};
  for (const name of ['http', 'https']) {const m = require(name);m.request = m.get = deny;}
  require('net').Socket.prototype.connect = deny;require('tls').connect = deny;
  const dns = require('dns');
  for (const key of Object.keys(dns)) if (/^(lookup|resolve|reverse)/.test(key) && typeof dns[key] === 'function') dns[key] = deny;
  for (const key of Object.keys(dns.promises)) if (typeof dns.promises[key] === 'function') dns.promises[key] = deny;
  global.fetch = deny;return () => attempts;
}
async function execute(inputs, candidates) {
  assert.strictEqual(process.env.V3_CORE_ADMIN_ENQUEUE_SDK_CHILD, 'yes');assert.strictEqual(Number(process.versions.node.split('.')[0]), 24);
  assert.strictEqual(manifest.release_scope, 'V3_CORE_ONLY');
  const packs = names.map(name => ({...manifest.packages.find(p => p.producer === name), source_commit: manifest.source_commit,
    inputRoot: inputs, candidateRoot: candidates, inventory: inventory.functions.find(f => f.FunctionName === name)}));
  const check = () => {
    for (const p of packs) {
      const f = p.inventory;
      const rawMap = path.join(p.inputRoot, p.producer + '.files.json'), map = path.join(p.candidateRoot, p.target + '.files.json');
      assert.strictEqual(sha(fs.readFileSync(rawMap)), f.download.raw_file_map_sha256);
      assert.strictEqual(sha(fs.readFileSync(map)), p.map_sha256);
      assert.deepStrictEqual(fileMap(path.join(p.inputRoot, p.producer + '-download')), JSON.parse(fs.readFileSync(rawMap)));
      assert.deepStrictEqual(fileMap(path.join(p.candidateRoot, p.target)), JSON.parse(fs.readFileSync(map)));
      assert.strictEqual(sha(fs.readFileSync(path.join(p.candidateRoot, p.target + '.zip'))), p.zip_sha256);
      if (p.inventory.download.archive_sha256) assert.strictEqual(sha(fs.readFileSync(path.join(p.inputRoot, p.producer + '.zip'))), p.inventory.download.archive_sha256);
      const identity = JSON.parse(fs.readFileSync(path.join(p.candidateRoot, p.target, 'SOURCE_IDENTITY.json')));
      assert.strictEqual(identity.source_commit, p.source_commit);assert.strictEqual(identity.producer, p.producer);
    }
  };
  const attempts = noNetwork();check();
  const NativeDate = Date;let now = NativeDate.parse('2026-10-29T00:00:00Z');
  global.Date = class extends NativeDate {constructor(...args) {super(...(args.length ? args : [now]));} static now() {return now;}};
  process.env.TCB_ENV = ENV;process.env.SCF_NAMESPACE = ENV;
  process.env.WRITER_RDE_SIGNING_KEY_HEX = signingKeys.runDecisionEngine.toString('hex');
  process.env.WRITER_ADMIN_SIGNING_KEY_HEX = signingKeys.adminGateway.toString('hex');
  const restores = [], sides = [{wrapped: false, services: new Map()}, {wrapped: true, services: new Map()}];
  const output = console.log, warn = console.warn, error = console.error;let diagnostics = 0;
  console.log = console.warn = console.error = () => {diagnostics++;};
  function load(side, pack) {
    const root = path.join(side.wrapped ? pack.candidateRoot : pack.inputRoot, side.wrapped ? pack.target : pack.producer + '-download');
    const sdk = require(path.join(root, 'node_modules/@cloudbase/node-sdk'));
    const {EJSON} = require(path.join(root, 'node_modules/bson'));
    const constants = require(path.join(root, 'common/constants'));
    assert.strictEqual(require(path.join(root, 'node_modules/@cloudbase/node-sdk/package.json')).version, '2.11.0');
    assert.strictEqual(require(path.join(root, 'node_modules/@cloudbase/database/package.json')).version, '1.4.1');
    const {DBRequest} = require(path.join(root, 'node_modules/@cloudbase/node-sdk/lib/utils/dbRequest'));
    const previous = DBRequest.prototype.send;
    DBRequest.prototype.send = function(action, params = {}) {
      try {
        assert.strictEqual(this.config.envName, ENV);
        if (side.wrapped) {assert.strictEqual(this.config.retries, 0);assert.strictEqual(this.config.keepalive, false);}
        if (/^database\.(startTransaction|commitTransaction|abortTransaction)$/.test(action) || params.collectionName === JOURNAL) {
          if (side.wrapped && side.definition.enqueueFault && !side.enqueueFaultArmed && action === 'database.insertDocument' &&
              params.data.some(raw => EJSON.parse(raw).kind === 'dispatch')) {
            side.enqueueFaultArmed = true;
            side.journal.fault = {action: 'database.commitTransaction', after: side.definition.after, throw: true};
          }
          return side.journal.send(action, params);
        }
        return side.business.send(action, params);
      } catch (error) {side.rejected.push(error.message);throw error;}
    };
    restores.push(() => {DBRequest.prototype.send = previous;});
    sdk.getCloudbaseContext = () => ({TCB_ENV: ENV, TRIGGER_SRC: side.source});
    const transport = require(path.join(root, 'node_modules/@cloudbase/node-sdk/lib/utils/httpRequest'));
    const previousHttp = transport.default;
    transport.default = async request => {
      try {
        if (!side.wrapped && side.definition.enqueue && pack.producer === 'adminGateway' &&
            ['fetchDailyData','fetchRealtimeData','fetchFundamentalNews','extractFundamental'].includes(request.params.function_name)) {
          assert.strictEqual(request.params.action, 'functions.invokeFunction');assert.strictEqual(request.method, 'post');
          assert.strictEqual(request.opts, undefined);const data = JSON.parse(request.params.request_data);
          const task = side.definition.route === 'intel/refresh' ? 'news' : side.definition.body.task;
          assert.deepStrictEqual(data, {force: true, task_name: task});side.legacyDispatches.push(request.params.function_name);
          return {requestId: 'fixture:legacy-dispatch', data: {response_data: JSON.stringify({fixture: 'LEGACY_ACCEPT_ONLY_NO_CHILD_BUSINESS'})}};
        }
        const childName = pack.producer === 'fetchDailyData' ? 'materializeIndicators' : 'runDecisionEngine';
        assert(pack.producer === 'adminGateway');assert.strictEqual(request.method, 'post');
        assert.strictEqual(request.params.action, 'functions.invokeFunction');
        assert.strictEqual(request.params.function_name, childName + (side.wrapped ? 'Node24' : ''));
        if (side.wrapped) {
          assert.strictEqual(request.config.envName || request.config.env, ENV);assert.strictEqual(request.config.retries, 0);assert.strictEqual(request.config.keepalive, false);
          assert.deepStrictEqual(request.opts, {timeout: 15000, retryOptions: {retries: 0}});
        } else assert.strictEqual(request.opts, undefined);
        const data = JSON.parse(request.params.request_data), child = side.services.get(childName);
        const result = await child.index.main(data, {function_name: child.target, request_id: 'fixture:child-native'});
        side.children.push({producer: pack.producer, target: request.params.function_name, data: copy(data), result: copy(result)});
        if (side.wrapped && side.definition.lost) throw Error('FIXTURE_CHILD_RESPONSE_LOST');
        return {requestId: 'fixture:real-sdk-child', data: {response_data: JSON.stringify(result)}};
      } catch (error) {if (error.message !== 'FIXTURE_CHILD_RESPONSE_LOST') side.rejected.push(error.message);throw error;}
    };
    restores.push(() => {transport.default = previousHttp;});
    const service = {root, ...pack, sdk, EJSON, constants, target: side.wrapped ? pack.target : pack.producer,
      index: require(path.join(root, 'index.js'))};
    side.services.set(pack.producer, service);return service;
  }
  function fixture(side, definition) {
    const rde = side.services.get('runDecisionEngine'), {EJSON, constants, root} = rde;
    const calendar = require(path.join(root, 'common/utils/cn-trading-calendar'));
    const integrity = require(path.join(root, 'common/utils/v365-run-integrity'));
    const authority = (calendar.resolveExpectedTradeDate || integrity.resolveExpectedTradeDate)(new Date(), calendar.loadRepoCalendar());
    const date = authority.expected_trade_date;assert(date, 'fixture calendar coverage required');
    const collections = [...new Set([...Object.values(constants.COLLECTIONS), 'run_manifest', 'run_candidate_decision',
      'run_candidate_portfolio', 'active_run_pointer', 'run_history'])];
    side.business = createBusinessWire({EJSON, collections, conditionalPointerUpdates: true});side.journal = backend(EJSON, JOURNAL);
    side.children = [];side.rejected = [];side.provider = [];side.legacyDispatches = [];side.enqueueFaultArmed = false;side.definition = definition;side.source = 'timer';side.date = date;
    const c = constants.COLLECTIONS;
    side.business.seed(c.PARAM_CONFIG, Object.entries({...constants.DEFAULT_PARAMS, trend_stage_enabled: true,
      v365_integrity_mode: 'ENFORCE'}).map(([key, value]) => ({_id: 'param:' + key, key, value, version: 1})));
    side.business.seed(c.ETF_BASIC, codes.map((code, i) => ({_id: 'basic:' + code, code, name: 'synthetic-' + code, status: 'enable',
      sort_order: i, sector: ['storage', 'ai_network', 'semi_equip', 'gold', 'biotech'][i], target_position: 20, max_position: 30})));
    side.business.seed(c.PORTFOLIO_SNAPSHOT, [{_id: 'fixture:portfolio', snapshot_date: '2026-09-29', total_asset: 100000,
      cash_balance: 100000, holdings_mv: 0, positions: []}]);
    const indicators = require(path.join(root, 'common/utils/indicators')), daily = [], snapshots = [], positions = [];
    for (const [j, code] of codes.entries()) {
      let bars = [];
      for (let t = Date.UTC(2025, 0, 1), i = 0; t <= NativeDate.parse(date + 'T00:00:00Z'); t += 86400000) {
        if ([0, 6].includes(new NativeDate(t).getUTCDay())) continue;
        const close = 10 + j + i * 0.01 + Math.sin(i++ / 17) * 0.1;
        bars.push({_id: 'daily:' + code + ':' + t, code, trade_date: new NativeDate(t).toISOString().slice(0, 10),
          open: close - 0.02, high: close + 0.1, low: close - 0.1, close, volume: 1000000, amount: close * 1000000, is_final: true});
      }
      daily.push(...bars);
      snapshots.push(indicators.computeSnapshot(bars, constants.DEFAULT_PARAMS,
        {code, calc_date: date, premium_rate: 0, version: 1}));
      positions.push({_id: 'position:' + code, code, current_position: 0, core_position: 0, trade_position: 0, shares: 0, target_std: 20, target_max: 30});
    }
    side.business.seed(c.ETF_DAILY, daily);side.business.seed(c.INDICATOR_SNAPSHOT, snapshots);side.business.seed(c.PORTFOLIO_POSITION, positions);
    side.business.seed(c.PARAM_CONFIG, [...side.business.rows(c.PARAM_CONFIG),
      {_id: 'auth:fixture', key: 'admin_token', value: {v: 'fixture-session', exp: '2099-01-01T00:00:00Z'}, version: 1},
      {_id: 'password:fixture', key: 'admin_password', value: {v: 'public-fixture-password'}, version: 1}]);
    side.business.seed(c.RISK_EVENTS, [{_id: 'risk:fixture', code: '513310', status: 'active'}]);
    if (definition.cooled) side.business.seed(c.FETCH_LOG, [{_id: 'cooled:fixture', source: 'fundamental_news', task_name: 'news', fetch_time: new Date()}]);

  }
  try {
    for (const side of sides) for (const pack of packs) load(side, pack);
    const [original, actual] = sides, rde = actual.services.get('runDecisionEngine');
    const adapter = require(path.join(rde.root, 'writer-journal-cloudbase'));
    const journal = require(path.join(rde.root, 'writer-admission-journal')), entry = require(path.join(rde.root, 'writer-entry'));
    const database = rde.sdk.init({env: ENV, retries: 0, keepalive: false}).database();
    const binding = name => ({environment: ENV, scope: 'production/' + name});
    const stores = new Map(names.map(name => [name, adapter.createProductionStore({database, binding: binding(name)})]));
    const results = [], denials = [], queued = [], faults = [];
    function noReexecution(before) {
      assert.strictEqual(actual.business.writes.length, before[1]);assert.strictEqual(actual.children.length, before[2]);
      for (const call of actual.business.calls.slice(before[0])) {
        assert.strictEqual(call.action, 'database.getDocument');assert.strictEqual(call.params.collectionName, 'param_config');
        assert.deepStrictEqual(JSON.parse(call.params.query), {key: 'admin_token'}, 'only read-only root authentication may repeat');
      }
    }
    for (const definition of definitions) {
      for (const side of sides) fixture(side, definition);
      for (const name of names) {
        const b = binding(name);actual.journal.seed(adapter.id(b, 'control'), adapter.encodeControl(journal.initial(b), b));
        assert((await journal.apply(stores.get(name), b, {type: 'activate', owner: 'new', revision: 0,
          proof: {reference: 'fixture:actual-admin-sdk', entries_closed: true, executions_terminal: true, retries_accounted_for: true}})).ok);
      }
      if (!definition.missing) actual.journal.seed('rollout:adminGateway', {_id: 'rollout:adminGateway', schema: 1,
        environment: ENV, scope: 'production/writer-rollout', revision: 1, state: definition.closed ? 'CLOSED' : 'OPEN'});
      const service = actual.services.get('adminGateway'), b = binding('adminGateway'), store = stores.get('adminGateway');
      const event = {httpMethod: definition.read ? 'GET' : 'POST', path: '/api/admin/' + definition.route,
        headers: {'x-admin-token': definition.badToken ? 'wrong' : 'fixture-session',
          ...(definition.read || definition.missingId ? {} : {'x-writer-operation-id': op})}, body: definition.body || {}};
      if (definition.login) delete event.headers['x-admin-token'];
      const context = {function_name: service.target, request_id: 'fixture:native-1'};
      const journalBefore = copy(actual.journal.rows());
      const result = await service.index.main(copy(event), context);
      await new Promise(resolve => setImmediate(resolve)); // Settle existing local detached rejection callbacks.
      assert.deepStrictEqual(actual.business.violations, []);assert.deepStrictEqual(actual.rejected, []);
      if (definition.denied) {
        assert.strictEqual(result.code, definition.denied);assert.strictEqual(actual.business.writes.length, 0);
        assert.strictEqual(actual.children.length, 0);assert.deepStrictEqual(actual.journal.rows(), journalBefore);
        denials.push({case: definition.name, code: result.code, business_writes: 0, admission_mutations: 0});continue;
      }
      if (definition.enqueue || definition.enqueueFault) {
        const rows = actual.journal.rows().filter(row => row.kind === 'dispatch');
        assert.strictEqual(actual.children.length, 0, 'enqueue cannot call a child inline');
        const receipts = actual.journal.rows().filter(row => ['request', 'token'].includes(row.kind));assert.strictEqual(receipts.length, 2);
        if (definition.enqueueFault) {
          assert(actual.enqueueFaultArmed);assert.strictEqual(actual.journal.fault, null);
          assert.strictEqual(result.code, 409);assert.strictEqual(result.writer_outcome, 'UNKNOWN');
          const control = await store.read(b);assert.strictEqual(control.state, 'HOLD');assert(control.active);
          assert(receipts.every(row => JSON.parse(row.payload_json).status === 'UNKNOWN'));
          assert.strictEqual(rows.length, definition.after ? 1 : 0);assert.strictEqual(actual.business.writes.length, 1, 'original rejection callback log settles before response');
          if (rows.length) assert.strictEqual(JSON.parse(rows[0].payload_json).state, 'PREPARED');
          faults.push({case: definition.name, parent: 'HOLD', job_persisted: Boolean(rows.length), child_calls: 0, callback_writes: 1});
        } else {
          assert.strictEqual(result.code, 0);assert.strictEqual(result.writer_outcome, 'COMPLETE');
          assert.strictEqual(result.writer_dispatch.state, 'QUEUED');assert.strictEqual(result.writer_dispatch.jobs.length, 1);
          assert.strictEqual(rows.length, 1);const job = JSON.parse(rows[0].payload_json);
          assert.strictEqual(job.state, 'PREPARED');assert.strictEqual(job.attempt, 0);assert.strictEqual(job.wire, null);
          const logical = definition.route === 'intel/refresh' ? 'fetchFundamentalNews' :
            ({daily:'fetchDailyData',fetchDailyData:'fetchDailyData',realtime:'fetchRealtimeData',news:'fetchFundamentalNews',extract:'extractFundamental'})[definition.body.task];
          assert.strictEqual(job.spec.target, logical);assert.strictEqual(result.writer_dispatch.jobs[0].job_id, job.spec.id);
          assert.strictEqual(job.spec.parent.request_id, entry.manualRequest({environment: ENV, producer:'adminGateway', action:'POST:/api/admin/' + definition.route, operation_id:'admin:' + op}));
          assert(receipts.every(row => JSON.parse(row.payload_json).status === 'COMPLETE'));
          assert.strictEqual((await store.read(b)).active, null);assert.strictEqual(actual.business.writes.length, 0);
          assert.strictEqual(result.data.triggered, true);
          const beforeLookup=copy(actual.journal.rows());
          const status=await service.index.main({httpMethod:'GET',path:'/api/admin/dispatch/status',headers:{'x-admin-token':'fixture-session'},queryStringParameters:{job_id:job.spec.id}},context);
          assert.strictEqual(status.code,0);assert.deepStrictEqual(status.data,require(path.join(service.root,'writer-dispatch-status')).publicStatus(job));
          assert.deepStrictEqual(actual.journal.rows(),beforeLookup,'status lookup cannot mutate the journal');
          const expected = await original.services.get('adminGateway').index.main(copy(event), {});
          await new Promise(resolve => setImmediate(resolve));
          const {operation_id, writer_outcome, writer_dispatch, ...business} = result;
          assert.deepStrictEqual(copy(business), copy(expected), 'original enqueue response fields changed');
          assert.deepStrictEqual(original.legacyDispatches, [logical]);assert.deepStrictEqual(original.rejected, []);
          assert.strictEqual(original.business.writes.length, 0);
          queued.push({case: definition.name, target: logical, parent:'COMPLETE', job:'PREPARED', child_calls:0, business_writes:0,
            original_response_equal: true, readonly_status_lookup: 'PREPARED_PUBLIC_FIELDS_ONLY', legacy_comparison_transport: 'ACCEPT_FIXTURE_NO_CHILD_BUSINESS'});
        }
        const before = [actual.business.calls.length, actual.business.writes.length, actual.children.length];
        const priorRows = copy(actual.journal.rows());
        assert.strictEqual((await service.index.main(copy(event), {...context, request_id:'fixture:retry'})).code, definition.enqueueFault ? 503 : 409);
        noReexecution(before);assert.deepStrictEqual(actual.journal.rows(), priorRows);continue;
      }
      const expected = await original.services.get('adminGateway').index.main(copy(event), {});
      assert.deepStrictEqual(original.business.violations, []);assert.deepStrictEqual(original.rejected, []);
      const {operation_id, writer_outcome, ...business} = result;
      assert.deepStrictEqual(copy(definition.read ? result : business), copy(expected), definition.name + ': response differs');
      if (!definition.read) {assert.strictEqual(operation_id, op);assert.strictEqual(writer_outcome, 'COMPLETE');}
      assert.strictEqual(result.code, definition.login ? 401 : 0);
      assert.deepStrictEqual(copy(actual.business.writes), copy(original.business.writes));
      assert.deepStrictEqual(copy(actual.business.snapshot()), copy(original.business.snapshot()));
      assert.strictEqual(actual.business.writes.length, definition.writes);
      const calls = ['risk-create','risk-resolve','param-update'].includes(definition.name) ? 1 : 0;
      assert.strictEqual(actual.children.length, calls);assert.strictEqual(original.children.length, calls);
      if (calls) {
        assert.strictEqual(actual.business.rows('run_candidate_decision').length, 5);assert.strictEqual(actual.business.rows('run_candidate_portfolio').length, 1);
        assert.strictEqual(actual.business.rows('active_run_pointer').length, 1);assert.strictEqual(actual.business.rows('run_history')[0].promoted, true);
        assert.strictEqual(actual.children[0].result.outcome, 'COMPLETE');
        assert.deepStrictEqual(actual.children[0].data.business, original.children[0].data);
        const parentId = entry.manualRequest({environment: ENV, producer: 'adminGateway', action: 'POST:/api/admin/' + definition.route,
          operation_id: 'admin:' + op});
        assert.strictEqual(actual.children[0].data.request_id, entry.childRequest({parent_request_id: parentId, producer: 'adminGateway', action: 'decision'}));
      }
      const before = [actual.business.calls.length, actual.business.writes.length, actual.children.length];
      if (!definition.read) {
        const repeated = await service.index.main(copy(event), {...context, request_id: 'fixture:native-2'});
        assert.strictEqual(repeated.code, 409);assert.strictEqual(repeated.writer_outcome, 'ALREADY_COMPLETE');
        noReexecution(before);
        assert.strictEqual((await service.index.main({...copy(event), body: {...event.body, changed: true}}, context)).code, 409);
        noReexecution(before);
      }
      results.push({case: definition.name, business_writes: actual.business.writes.length, actual_rde_executions: calls, duplicate_business_calls: 0});
    }
    assert.strictEqual(attempts(), 0);check();
    return {status: 'PASS_CORE_ADMIN_DURABLE_ENQUEUE_ACTUAL_SDK_MEMORY_WIRE', scope: 'V3_CORE_ONLY',
      runtime: process.version, package_source: manifest.source_commit, sdk: '2.11.0', database: '1.4.1', cases: results, denials, queued, enqueue_faults: faults,
      all_comparable_business_results_writes_and_final_tables_equal: true, distinct_per_producer_fixture_keys: true,
      network_attempts: attempts(), cloud_calls: 0, durable_enqueue: 'WIRED_IN_CANDIDATE_NOT_DEPLOYED', dispatch_execution: 'NOT_WIRED', production_and_natural_qualification: 'NOT_PROVEN'};

  } finally {restores.reverse().forEach(restore => restore());global.Date = NativeDate;console.log = output;console.warn = warn;console.error = error;}
}
function main() {
  let args = process.argv.slice(2);const child = args[0] === '--child';if (child) args = args.slice(1);
  assert(args.length === 6 && args[0] === '--inputs' && args[2] === '--candidates' && args[4] === '--manifest');
  if (child) return execute(args[1], args[3]).then(result => console.log(JSON.stringify(result)));
  const env = {V3_CORE_ADMIN_ENQUEUE_SDK_CHILD: 'yes'};
  for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP']) if (process.env[key]) env[key] = process.env[key];
  const result = spawnSync(process.execPath, [__filename, '--child', ...args], {env, encoding: 'utf8', timeout: 300000, maxBuffer: 2 * 1024 * 1024});
  if (result.stdout) process.stdout.write(result.stdout);if (result.stderr) process.stderr.write(result.stderr);
  assert.strictEqual(result.status, 0, 'Core admin enqueue SDK replay failed; not cloud qualification');
}
if (require.main === module) Promise.resolve().then(main).catch(error => {console.error(error);process.exitCode = 1;});
