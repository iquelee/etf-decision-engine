#!/usr/bin/env node
'use strict';
// Actual captured materializer -> actual captured RDE, with real SDK serializers.
// Only DBRequest and functions HTTP transport are memory-only. No business shim.
const assert = require('assert'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const {spawnSync} = require('child_process');
const {fileMap} = require('./prepare-writer-workers');
const {createBusinessWire} = require('./writer-sdk-memory-wire');
const {backend} = require('../tests/writer-journal-cloudbase.test');
const {assertCoreWriters} = require('./runtime24-v3-core-scope');
const {createDailyProviderAdapter} = require('./core-daily-provider-fixture');
const names = ['runDecisionEngine', 'materializeIndicators', 'fetchDailyData'];assertCoreWriters(names);
const ENV = 'tradingview-etf-d0fa42yy57cbc11b', JOURNAL = 'writer_admission_journal_v1';
const manifest = require('./runtime24-writer-core-engine-candidates.json');
const inventory = require('./runtime24-writer-inventory.json');
const dailyManifest = require('./runtime24-writer-core-candidates.json');
const dailyInventory = require('./runtime24-writer-six-inventory.json');
const copy = x => JSON.parse(JSON.stringify(x));
const sha = x => crypto.createHash('sha256').update(x).digest('hex');
const codes = ['513310', '515880', '159582', '518880', '159570'];
const signingKeys = Object.fromEntries(names.map((name, i) => [name, Buffer.alloc(32, 61 + 6 * i)]));
const definitions = [
  {name: 'signed-rde-bootstrap', producer: names[0], writes: 54},
  {name: 'signed-rde-existing-pointer', producer: names[0], existingPointer: true, writes: 54},
  {name: 'signed-materializer-chain', producer: names[1], writes: 539},
  {name: 'timer-materializer-chain', producer: names[1], timer: true, writes: 539},
  {name: 'materializer-short-history', producer: names[1], short: true, writes: 414},
  {name: 'materializer-non-trading-day', producer: names[1], timer: true, holiday: true, writes: 0},
  {name: 'materializer-child-response-lost', producer: names[1], timer: true, lost: true, writes: 539},
  {name: 'daily-materializer-rde-chain', producer: names[2], timer: true, daily: true, writes: 684}
];
function noNetwork() {
  let attempts = 0;const deny = () => {attempts++;throw Error('OFFLINE_NETWORK_DENIED');};
  for (const name of ['http', 'https']) {const m = require(name);m.request = m.get = deny;}
  require('net').Socket.prototype.connect = deny;require('tls').connect = deny;
  const dns = require('dns');
  for (const key of Object.keys(dns)) if (/^(lookup|resolve|reverse)/.test(key) && typeof dns[key] === 'function') dns[key] = deny;
  for (const key of Object.keys(dns.promises)) if (typeof dns.promises[key] === 'function') dns.promises[key] = deny;
  global.fetch = deny;return () => attempts;
}
async function execute(inputs, candidates, dailyInputs, dailyCandidates) {
  assert.strictEqual(process.env.V3_CORE_ENGINE_SDK_CHILD, 'yes');assert.strictEqual(Number(process.versions.node.split('.')[0]), 24);
  assert.strictEqual(manifest.release_scope, 'V3_CORE_ONLY');
  assert.strictEqual(dailyManifest.release_scope, 'V3_CORE_ONLY');
  const packs = names.map(name => {
    const daily = name === 'fetchDailyData', m = daily ? dailyManifest : manifest;
    return {...m.packages.find(p => p.producer === name), source_commit: m.source_commit,
      inputRoot: daily ? dailyInputs : inputs, candidateRoot: daily ? dailyCandidates : candidates,
      inventory: (daily ? dailyInventory : inventory).functions.find(f => f.FunctionName === name)};
  });
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
  for (const [i, name] of ['WRITER_RDE_SIGNING_KEY_HEX', 'WRITER_MATERIALIZER_SIGNING_KEY_HEX', 'WRITER_DAILY_SIGNING_KEY_HEX'].entries())
    process.env[name] = signingKeys[names[i]].toString('hex');
  process.env.FRED_API_KEY = 'fixture-no-real-credential';
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
        if (/^database\.(startTransaction|commitTransaction|abortTransaction)$/.test(action) || params.collectionName === JOURNAL)
          return side.journal.send(action, params);
        return side.business.send(action, params);
      } catch (error) {side.rejected.push(error.message);throw error;}
    };
    restores.push(() => {DBRequest.prototype.send = previous;});
    sdk.getCloudbaseContext = () => ({TCB_ENV: ENV, TRIGGER_SRC: side.source});
    const transport = require(path.join(root, 'node_modules/@cloudbase/node-sdk/lib/utils/httpRequest'));
    const previousHttp = transport.default;
    transport.default = async request => {
      try {
        const childName = pack.producer === 'fetchDailyData' ? 'materializeIndicators' : 'runDecisionEngine';
        assert(['fetchDailyData', 'materializeIndicators'].includes(pack.producer));assert.strictEqual(request.method, 'post');
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
    if (pack.producer === 'fetchDailyData') require(path.join(root, 'node_modules/axios')).defaults.adapter = createDailyProviderAdapter({constants, state: side});
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
    side.children = [];side.rejected = [];side.provider = [];side.definition = definition;side.source = 'timer';side.date = date;
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
      if (definition.short && j === 4) bars = bars.slice(-19);
      if (definition.daily) bars = bars.filter(bar => bar.trade_date !== date);
      daily.push(...bars);
      if (definition.producer === 'runDecisionEngine') snapshots.push(indicators.computeSnapshot(bars, constants.DEFAULT_PARAMS,
        {code, calc_date: date, premium_rate: 0, version: 1}));
      positions.push({_id: 'position:' + code, code, current_position: 0, core_position: 0, trade_position: 0, shares: 0, target_std: 20, target_max: 30});
    }
    side.business.seed(c.ETF_DAILY, daily);side.business.seed(c.INDICATOR_SNAPSHOT, snapshots);side.business.seed(c.PORTFOLIO_POSITION, positions);
    if (definition.existingPointer) side.business.seed('active_run_pointer', [{_id: 'active_run_pointer::production', scope: 'production',
      run_id: 'fixture:previous', revision: 7, expected_trade_date: date}]);
  }
  try {
    for (const side of sides) for (const pack of packs) load(side, pack);
    const [original, actual] = sides, rde = actual.services.get('runDecisionEngine');
    const adapter = require(path.join(rde.root, 'writer-journal-cloudbase'));
    const journal = require(path.join(rde.root, 'writer-admission-journal')), entry = require(path.join(rde.root, 'writer-entry'));
    const database = rde.sdk.init({env: ENV, retries: 0, keepalive: false}).database();
    const binding = name => ({environment: ENV, scope: 'production/' + name});
    const stores = new Map(names.map(name => [name, adapter.createProductionStore({database, binding: binding(name)})]));
    const results = [], faultCases = [];
    for (const definition of definitions) {
      now = NativeDate.parse(definition.holiday ? '2026-10-01T00:00:00Z' : definition.daily ? '2026-10-29T14:00:00Z' : '2026-10-29T00:00:00Z');
      for (const side of sides) fixture(side, definition);
      for (const name of names) {
        const b = binding(name);actual.journal.seed(adapter.id(b, 'control'), adapter.encodeControl(journal.initial(b), b));
        assert((await journal.apply(stores.get(name), b, {type: 'activate', owner: 'new', revision: 0,
          proof: {reference: 'fixture:actual-core-sdk', entries_closed: true, executions_terminal: true, retries_accounted_for: true}})).ok);
      }
      const service = actual.services.get(definition.producer), b = binding(definition.producer), store = stores.get(definition.producer);
      const trigger = definition.daily ? 'dailyFetch-2200' : 'dailyPipeline-0800';
      const business = definition.timer ? {Type: 'Timer', TriggerName: trigger, Time: new Date().toISOString(), Message: 'writer-root-timer-v1'} :
        definition.producer === 'materializeIndicators' ? {from: 'fetchDailyData'} : {};
      const request = definition.timer ? business : entry.seal({binding: b, control: await store.read(b), target: service.target,
        request_id: 'fixture:' + definition.name, business, key: signingKeys[definition.producer]});
      const context = {function_name: service.target, request_id: 'fixture:native-1'};
      if (definition.timer) {
        actual.source = 'sdk';const before = actual.journal.calls.length;
        assert.strictEqual((await service.index.main(copy(request), context)).executed, false);
        assert.strictEqual(actual.journal.calls.length, before);assert.strictEqual(actual.business.calls.length, 0);
        assert.strictEqual(actual.provider.length, 0);assert.strictEqual(actual.children.length, 0);actual.source = 'timer';
      }
      const wrapped = await service.index.main(copy(request), context);
      assert.deepStrictEqual(actual.business.violations, []);assert.deepStrictEqual(actual.rejected, []);
      assert.strictEqual(actual.business.writes.length, definition.writes, definition.name + ': unexpected business write count');
      if (definition.lost) {
        assert.strictEqual(wrapped.error_code, 'WRITER_EXECUTION_UNKNOWN');assert.strictEqual(wrapped.hold_confirmed, true);
        for (const name of ['runDecisionEngine', 'materializeIndicators']) assert.strictEqual((await stores.get(name).read(binding(name))).state, 'HOLD');
        assert.strictEqual(actual.children.length, 1);assert.strictEqual(actual.children[0].result.outcome, 'COMPLETE');
        assert.strictEqual(actual.business.rows('active_run_pointer').length, 1);
        assert.strictEqual(actual.business.rows('run_history')[0].promoted, true);
        assert((await store.read(b)).active, 'unknown parent retains execution slot');
        assert.strictEqual((await stores.get('runDecisionEngine').read(binding('runDecisionEngine'))).active, null);
        const receipts = actual.journal.rows().filter(row => ['request', 'token'].includes(row.kind));
        assert.strictEqual(receipts.length, 4);
        assert.deepStrictEqual(receipts.map(row => JSON.parse(row.payload_json).status).sort(), ['COMPLETE', 'COMPLETE', 'UNKNOWN', 'UNKNOWN']);
        const before = [actual.business.calls.length, actual.business.writes.length, actual.children.length];
        assert.strictEqual((await service.index.main(copy(request), {...context, request_id: 'fixture:retry'})).error_code, 'WRITER_ADMISSION_CLOSED');
        assert.deepStrictEqual([actual.business.calls.length, actual.business.writes.length, actual.children.length], before);
        faultCases.push({case: definition.name, business_writes: actual.business.writes.length, child_real_execution: 'COMPLETE',
          parent: 'HOLD', child: 'HOLD', duplicate_business_calls: 0});continue;
      }
      const expected = await original.services.get(definition.producer).index.main(copy(business), {});
      const result = definition.timer ? wrapped : wrapped.result;
      assert.deepStrictEqual(actual.business.violations, []);assert.deepStrictEqual(original.business.violations, []);
      assert.deepStrictEqual(original.rejected, []);
      assert.deepStrictEqual(copy(result), copy(expected), definition.name + ': whole business response changed');
      assert.strictEqual(result.ok, true, JSON.stringify(result));
      assert.deepStrictEqual(copy(actual.business.writes), copy(original.business.writes), definition.name + ': SDK write payload/order changed');
      assert.deepStrictEqual(copy(actual.business.snapshot()), copy(original.business.snapshot()), definition.name + ': final tables changed');
      assert.deepStrictEqual(actual.provider, original.provider);
      if (definition.holiday) {assert.strictEqual(result.skipped, 'non_trading_day');assert.strictEqual(actual.business.writes.length, 0);assert.strictEqual(actual.children.length, 0);}
      else if (definition.short) {
        assert.strictEqual(result.results.filter(row => row.ok).length, 4);
        assert.strictEqual(actual.business.rows('active_run_pointer').length, 0, 'incomplete materialization cannot publish');
        assert.strictEqual(actual.children[0].result.result.ok, false, 'child business failure is preserved, not fabricated as success');
      } else {
        assert.strictEqual(actual.business.rows('run_candidate_decision').length, 5);
        assert.strictEqual(actual.business.rows('run_candidate_portfolio').length, 1);
        const pointer = actual.business.rows('active_run_pointer');assert.strictEqual(pointer.length, 1);
        const run = actual.business.rows('run_manifest')[0];assert.strictEqual(run.validation_passed, true);
        assert.strictEqual(actual.business.rows('run_history')[0].promoted, true);
        assert.strictEqual(pointer[0].expected_trade_date, actual.date);
        if (definition.existingPointer) {
          assert.strictEqual(pointer[0].revision, 8);
          const writes = actual.business.writes.filter(row => row.collection === 'active_run_pointer');
          assert.strictEqual(writes.length, 1);assert.strictEqual(writes[0].operation, 'update');
          assert.deepStrictEqual(writes[0].condition, {_id: 'active_run_pointer::production', scope: 'production', run_id: 'fixture:previous', revision: 7});
          assert.strictEqual(actual.business.rows('run_history')[0].supersedes_run_id, 'fixture:previous');
        }
      }
      if (definition.producer === 'materializeIndicators' && !definition.holiday) {
        assert.strictEqual(actual.children.length, 1);assert.strictEqual(original.children.length, 1);
        assert.strictEqual(actual.children[0].result.outcome, 'COMPLETE');
        assert.deepStrictEqual(actual.children[0].data.business, original.children[0].data);
        const rootId = definition.timer ? entry.scheduledRequest({environment: ENV, producer: definition.producer,
          trigger_name: 'dailyPipeline-0800', scheduled_for: business.Time}) : request.request_id;
        assert.strictEqual(actual.children[0].data.request_id, entry.childRequest({parent_request_id: rootId, producer: definition.producer, action: 'decision'}));
      }
      if (definition.daily) {
        assert.strictEqual(actual.children.length, 2);assert.strictEqual(original.children.length, 2);
        assert.strictEqual(actual.provider.length, 22);assert.strictEqual(result.total_bars, 100);
        assert.strictEqual(actual.business.rows('indicator_snapshot').filter(row => row.calc_date === actual.date).length, 5);
        const dailyRoot = entry.scheduledRequest({environment: ENV, producer: 'fetchDailyData', trigger_name: trigger, scheduled_for: business.Time});
        const materializerId = entry.childRequest({parent_request_id: dailyRoot, producer: 'fetchDailyData', action: 'materialize'});
        const rdeId = entry.childRequest({parent_request_id: materializerId, producer: 'materializeIndicators', action: 'decision'});
        for (const child of actual.children) {
          assert.strictEqual(child.result.outcome, 'COMPLETE');
          assert.strictEqual(child.data.request_id, child.producer === 'fetchDailyData' ? materializerId : rdeId);
          assert.deepStrictEqual(child.data.business, original.children.find(row => row.producer === child.producer).data);
        }
        for (const name of names) {
          const control = await stores.get(name).read(binding(name));assert.strictEqual(control.state, 'ACTIVE');assert.strictEqual(control.active, null);
        }
      }
      const before = [actual.business.calls.length, actual.business.writes.length, actual.children.length, actual.provider.length];
      const repeated = await service.index.main(copy(request), {...context, request_id: 'fixture:native-2'});
      assert.strictEqual(definition.timer ? repeated.reason : repeated.admission, 'ALREADY_COMPLETE');
      assert.deepStrictEqual([actual.business.calls.length, actual.business.writes.length, actual.children.length, actual.provider.length], before);
      const receipts = actual.journal.rows().filter(row => ['request', 'token'].includes(row.kind));
      const completed = definition.daily ? 6 : definition.producer === 'materializeIndicators' && !definition.holiday ? 4 : 2;
      assert.strictEqual(receipts.length, completed);assert(receipts.every(row => JSON.parse(row.payload_json).status === 'COMPLETE'));
      results.push({case: definition.name, business_writes: actual.business.writes.length, child_real_executions: actual.children.length,
        candidate_decisions: actual.business.rows('run_candidate_decision').length, active_pointers: actual.business.rows('active_run_pointer').length,
        provider_fixture_requests: actual.provider.length, duplicate_business_calls: 0});
    }
    assert.strictEqual(attempts(), 0);check();
    return {status: 'PASS_CORE_ENGINE_ACTUAL_SDK_MEMORY_WIRE', scope: 'V3_CORE_ONLY', runtime: process.version,
      package_source: manifest.source_commit, sdk: '2.11.0', database: '1.4.1', cases: results, fault_cases: faultCases,
      all_business_results_writes_and_final_tables_equal: true, network_attempts: attempts(), cloud_calls: 0,
      materializer_and_rde_execution: 'ACTUAL_ENTRIES_AND_SDK', daily_to_engine_full_chain: 'PASS_ACTUAL_ENTRIES_AND_SDK_MEMORY_WIRE',
      daily_package_source: dailyManifest.source_commit,
      distinct_per_producer_fixture_keys: true,
      production_and_natural_qualification: 'NOT_PROVEN', diagnostics_suppressed: diagnostics};
  } finally {restores.reverse().forEach(restore => restore());global.Date = NativeDate;console.log = output;console.warn = warn;console.error = error;}
}
function main() {
  let args = process.argv.slice(2);const child = args[0] === '--child';if (child) args = args.slice(1);
  assert(args.length === 8 && args[0] === '--inputs' && args[2] === '--candidates' && args[4] === '--daily-inputs' && args[6] === '--daily-candidates');
  if (child) return execute(args[1], args[3], args[5], args[7]).then(result => console.log(JSON.stringify(result)));
  const env = {V3_CORE_ENGINE_SDK_CHILD: 'yes'};
  for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP']) if (process.env[key]) env[key] = process.env[key];
  const result = spawnSync(process.execPath, [__filename, '--child', ...args], {env, encoding: 'utf8', timeout: 300000, maxBuffer: 2 * 1024 * 1024});
  if (result.stdout) process.stdout.write(result.stdout);if (result.stderr) process.stderr.write(result.stderr);
  assert.strictEqual(result.status, 0, 'Core engine actual SDK replay failed; not cloud qualification');
}
if (require.main === module) Promise.resolve().then(main).catch(error => {console.error(error);process.exitCode = 1;});
