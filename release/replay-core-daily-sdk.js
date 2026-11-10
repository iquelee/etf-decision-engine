#!/usr/bin/env node
'use strict';
// Captured daily business + actual database SDK. Provider and child transport
// responses are synthetic; this is NOT a materializer/RDE or cloud acceptance.
const assert = require('assert'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const {spawnSync} = require('child_process');
const {fileMap} = require('./prepare-writer-workers');
const {createBusinessWire} = require('./writer-sdk-memory-wire');
const {backend} = require('../tests/writer-journal-cloudbase.test');
const {assertCoreWriters} = require('./runtime24-v3-core-scope');
const PRODUCER = 'fetchDailyData', CHILD = 'materializeIndicators';assertCoreWriters([PRODUCER, CHILD]);
const inventory = require('./runtime24-writer-six-inventory.json').functions.find(f => f.FunctionName === PRODUCER);
const manifest = require('./runtime24-writer-core-candidates.json');
const pack = manifest.packages.find(p => p.producer === PRODUCER);
const ENV = 'tradingview-etf-d0fa42yy57cbc11b', JOURNAL = 'writer_admission_journal_v1';
const codes = ['513310', '515880', '159582', '518880', '159570'];
const copy = x => JSON.parse(JSON.stringify(x));
const sha = x => crypto.createHash('sha256').update(x).digest('hex');
const definitions = Object.freeze([
  {name: 'eod-insert', now: '2026-10-29T14:00:00Z', writes: 145, requests: 22},
  {name: 'eod-update-unfinalized', now: '2026-10-29T14:00:00Z', existing: 'unfinalized', writes: 145, requests: 22},
  {name: 'production-ready-benchmark-missing', now: '2026-10-29T14:00:00Z', existing: 'production', writes: 40, requests: 12},
  {name: 'all-finalized-skip', now: '2026-10-29T14:00:00Z', existing: 'all', skipped: 'already_fetched', writes: 0, requests: 0},
  {name: 'configured-holiday-skip', now: '2026-10-01T14:00:00Z', skipped: 'holiday', writes: 0, requests: 0},
  {name: 'signed-force-intraday', now: '2026-10-29T02:00:00Z', signed: true, intraday: true, writes: 139, requests: 22},
  {name: 'short-primary-fallback', now: '2026-10-29T14:00:00Z', fallback: true, writes: 145, requests: 23},
  {name: 'optional-storage-malformed', now: '2026-10-29T14:00:00Z', badStorage: true, writes: 143, requests: 22},
  {name: 'optional-fred-key-absent', now: '2026-10-29T14:00:00Z', noFred: true, writes: 143, requests: 21},
  {name: 'child-response-lost', now: '2026-10-29T14:00:00Z', childFault: true, writes: 145, requests: 22}
]);
function noNetwork() {
  let attempts = 0;const deny = () => {attempts++;throw Error('OFFLINE_NETWORK_DENIED');};
  for (const name of ['http', 'https']) {const m = require(name);m.request = m.get = deny;}
  require('net').Socket.prototype.connect = deny;require('tls').connect = deny;
  const dns = require('dns');
  for (const key of Object.keys(dns)) if (/^(lookup|resolve|reverse)/.test(key) && typeof dns[key] === 'function') dns[key] = deny;
  for (const key of Object.keys(dns.promises)) if (typeof dns.promises[key] === 'function') dns.promises[key] = deny;
  global.fetch = deny;return () => attempts;
}
function dates() {
  const result = [];let time = Date.parse('2026-10-29T00:00:00Z');
  while (result.length < 20) {
    const date = new Date(time), day = date.toISOString().slice(0, 10);
    if (![0, 6].includes(date.getUTCDay()) && !(day >= '2026-10-01' && day <= '2026-10-07')) result.unshift(day);
    time -= 86400000;
  }
  return result;
}
function bars() {return dates().map((day, i) => [day, '10', String(10 + i / 100), '11', '9', '10000', '100000']);}
function verify(root, map, expected) {
  assert.strictEqual(sha(fs.readFileSync(map)), expected, 'unbound package map');
  assert.deepStrictEqual(fileMap(root), JSON.parse(fs.readFileSync(map)), 'captured package drift');
}
async function execute(inputs, candidates) {
  assert.strictEqual(process.env.V3_CORE_DAILY_SDK_CHILD, 'yes');
  assert.strictEqual(Number(process.versions.node.split('.')[0]), 24);
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
  process.env.TCB_ENV = ENV;process.env.SCF_NAMESPACE = ENV;process.env.FRED_API_KEY = 'fixture-no-real-credential';
  process.env.HOLIDAYS = '2026-10-01'; // Captured daily uses the explicit env list, unlike captured realtime.
  const key = Buffer.alloc(32, 47), childKey = Buffer.alloc(32, 53);
  process.env.WRITER_DAILY_SIGNING_KEY_HEX = key.toString('hex');
  process.env.WRITER_MATERIALIZER_SIGNING_KEY_HEX = childKey.toString('hex');
  const restorers = [];
  function load(root, wrapped) {
    const sdk = require(path.join(root, 'node_modules/@cloudbase/node-sdk'));
    const axios = require(path.join(root, 'node_modules/axios'));
    const {EJSON} = require(path.join(root, 'node_modules/bson'));
    assert.strictEqual(require(path.join(root, 'node_modules/@cloudbase/node-sdk/package.json')).version, '2.11.0');
    assert.strictEqual(require(path.join(root, 'node_modules/@cloudbase/database/package.json')).version, '1.4.1');
    const constants = require(path.join(root, 'common/constants')), collections = constants.COLLECTIONS;
    const state = {source: 'timer', provider: [], rejected: [], children: []};
    const {DBRequest} = require(path.join(root, 'node_modules/@cloudbase/node-sdk/lib/utils/dbRequest'));
    const previous = DBRequest.prototype.send;
    DBRequest.prototype.send = function(action, params = {}) {
      assert.strictEqual(this.config.envName, ENV);
      if (wrapped) {assert.strictEqual(this.config.retries, 0);assert.strictEqual(this.config.keepalive, false);}
      if (/^database\.(startTransaction|commitTransaction|abortTransaction)$/.test(action) || params.collectionName === JOURNAL)
        return state.journal.send(action, params);
      return state.business.send(action, params);
    };
    restorers.push(() => {DBRequest.prototype.send = previous;});
    sdk.getCloudbaseContext = () => ({TCB_ENV: ENV, TRIGGER_SRC: state.source});
    // Keep functions.invokeFunction's actual SDK JSON serialization and response
    // decoding. Only its HTTP transport returns a child-protocol fixture.
    const transport = require(path.join(root, 'node_modules/@cloudbase/node-sdk/lib/utils/httpRequest'));
    const previousHttp = transport.default;
    transport.default = async request => {
      try {
        const {params, config, opts} = request;
        assert.strictEqual(params.action, 'functions.invokeFunction');assert.strictEqual(request.method, 'post');
        const data = JSON.parse(params.request_data);let business = data;
        const configuredEnv = config.envName || config.env;
        assert(configuredEnv === ENV || (!wrapped && configuredEnv === sdk.SYMBOL_CURRENT_ENV));
        if (wrapped) {
          assert.strictEqual(params.function_name, CHILD + 'Node24');
          assert.strictEqual(config.retries, 0);assert.strictEqual(config.keepalive, false);
          assert.deepStrictEqual(opts, {timeout: 15000, retryOptions: {retries: 0}});
          const entry = require(path.join(candidate, 'writer-entry'));
          entry.authenticate(data, {binding: {environment: ENV, scope: 'production/' + CHILD}, target: CHILD + 'Node24', owner: 'new', key: childKey});
          business = data.business;
        } else {assert.strictEqual(params.function_name, CHILD);assert.strictEqual(opts, undefined);}
        assert.deepStrictEqual(business, {from: PRODUCER});
        state.children.push({target: params.function_name, business: copy(business), ...(wrapped ? {request_id: data.request_id, token: data.token} : {})});
        if (wrapped && state.definition.childFault) throw Error('FIXTURE_CHILD_RESPONSE_LOST');
        const value = {ok: true, fixture: 'CHILD_TRANSPORT_ONLY_NO_MATERIALIZER_EXECUTION'};
        const result = wrapped ? {protocol: 'writer-result-v1', request_id: data.request_id, token: data.token,
          owner: data.owner, epoch: data.epoch, executed: true, outcome: 'COMPLETE', result: value} : value;
        return {requestId: 'fixture:child-http', data: {response_data: JSON.stringify(result)}};
      } catch (error) {
        if (error.message !== 'FIXTURE_CHILD_RESPONSE_LOST') state.rejected.push({boundary: 'child', reason: error.message});
        throw error;
      }
    };
    restorers.push(() => {transport.default = previousHttp;});
    axios.defaults.adapter = async config => {
      try {
        assert.strictEqual(config.method, 'get');assert.strictEqual(config.params, undefined);
        const url = config.url;let data;
        const daily = /^https:\/\/web\.ifzq\.gtimg\.cn\/appstock\/app\/fqkline\/get\?param=(sh|sz)(\d{6}),day,,,(260|320),qfq$/.exec(url);
        const sina = /^https:\/\/money\.finance\.sina\.com\.cn\/quotes_service\/api\/json_v2\.php\/CN_MarketData\.getKLineData\?symbol=(sh|sz)(\d{6})&scale=240&ma=no&datalen=260$/.exec(url);
        const premium = /^https:\/\/push2\.eastmoney\.com\/api\/qt\/stock\/get\?secid=([01])\.(\d{6})&fields=f43,f57,f58,f60,f127,f162,f169,f170,f171$/.exec(url);
        const weekly = /^https:\/\/web\.ifzq\.gtimg\.cn\/appstock\/app\/fqkline\/get\?param=([A-Za-z0-9]+),week,,,60,$/.exec(url);
        if (daily) {
          const code = daily[2];assert([...codes, ...constants.GEN1_BENCHMARK_CODES].includes(code));
          assert.strictEqual(daily[1], code.startsWith('5') ? 'sh' : 'sz');
          assert.strictEqual(daily[3], codes.includes(code) ? '260' : '320');
          const rows = state.definition.fallback && code === codes[0] ? bars().slice(1) : bars();
          data = {data: {[daily[1] + code]: {qfqday: rows}}};
        } else if (sina) {
          assert(state.definition.fallback && sina[2] === codes[0]);assert.strictEqual(sina[1], 'sh');
          assert.strictEqual(config.responseType, 'text');
          data = JSON.stringify(bars().map(row => ({day: row[0], open: row[1], close: row[2], high: row[3], low: row[4], volume: row[5]})));
        } else if (premium) {
          assert(codes.includes(premium[2]));assert.strictEqual(premium[1], premium[2].startsWith('5') ? '1' : '0');
          data = {data: {f43: 10, f127: 10.2, f162: 0.3}};
        } else if (url === 'https://api.stlouisfed.org/fred/series/observations?series_id=DFII10&api_key=fixture-no-real-credential&file_type=json') {
          data = {observations: [{date: '2026-10-28', value: '.'}, {date: '2026-10-29', value: '1.7'}]};
        } else if (url === 'https://qt.gtimg.cn/q=whDINIW') {
          assert.strictEqual(config.responseType, 'arraybuffer');data = Buffer.from('v_fixture="310~synthetic~DINIW~99.64~0~20261029220000~99.6";');
        } else if (url === 'https://www.chinaflashmarket.com/') {
          data = state.definition.badStorage ? 'fixture-missing-prices' :
            '<th><a href="/price/ews/100222">DDR</a></th><span class="new-price"><b>$</b> 3.2</span>' +
            '<th><a href="/price/in/100164">NAND</a></th><span class="new-price"><b>$</b> 4.1</span>';
        } else if (url === 'https://t-goldream.com/gold-observation?section=global-gold-etf') {
          data = '<tr data-etf-toggle="daily-etf-history-gld"><td>2026-10-29</td><td>1000.5吨</td></tr>';
        } else if (weekly) {
          assert(constants.MARKET_INDEXES.some(item => item.symbol === weekly[1]));data = {data: {[weekly[1]]: {week: bars()}}};
        } else if (url.startsWith('https://qt.gtimg.cn/q=')) {
          const symbol = url.slice('https://qt.gtimg.cn/q='.length);assert(constants.GLOBAL_TICKERS.some(item => item.symbol === symbol));
          assert.strictEqual(config.responseType, 'arraybuffer');const fields = Array(38).fill('');
          fields[3] = '10';fields[5] = '9.9';fields[32] = '1.01';fields[33] = '11';fields[34] = '9';
          data = Buffer.from('v_fixture="' + fields.join('~') + '";');
        } else {throw Error('UNREVIEWED_PROVIDER_REQUEST');}
        state.provider.push({url, method: config.method, responseType: config.responseType || null});
        return {status: 200, statusText: 'OK', headers: {}, config, data, request: {fixture: true}};
      } catch (error) {state.rejected.push({boundary: 'provider', reason: error.message});throw error;}
    };
    return {root, state, sdk, EJSON, constants, collections, index: require(path.join(root, 'index.js'))};
  }
  try {
    const original = load(input, false), actual = load(candidate, true);
    const adapter = require(path.join(candidate, 'writer-journal-cloudbase'));
    const journal = require(path.join(candidate, 'writer-admission-journal')), entry = require(path.join(candidate, 'writer-entry'));
    const binding = {environment: ENV, scope: 'production/' + PRODUCER}, childBinding = {environment: ENV, scope: 'production/' + CHILD};
    const database = actual.sdk.init({env: ENV, retries: 0, keepalive: false}).database();
    const store = adapter.createProductionStore({database, binding});
    const childStore = adapter.createProductionStore({database, binding: childBinding});
    const context = {function_name: pack.target, request_id: 'fixture:native-1'}, results = [], faultCases = [];
    const proof = {reference: 'fixture:offline-core-daily', entries_closed: true, executions_terminal: true, retries_accounted_for: true};
    for (const definition of definitions) {
      now = NativeDate.parse(definition.now);
      process.env.FRED_API_KEY = definition.noFred ? '' : 'fixture-no-real-credential';
      for (const side of [original, actual]) {
        const {state, EJSON, collections: c, constants} = side;
        state.definition = definition;state.source = 'timer';state.provider = [];state.rejected = [];state.children = [];
        state.business = createBusinessWire({EJSON, collections: [c.ETF_BASIC, c.ETF_DAILY, c.FETCH_LOG, c.FUNDAMENTAL_SERIES, c.MARKET_ENV, c.GLOBAL_QUOTE]});
        state.journal = backend(EJSON, JOURNAL);
        state.business.seed(c.ETF_BASIC, codes.map((code, i) => ({_id: 'basic:' + code, code, status: 'enable', sort_order: i})).concat(
          [{_id: 'basic:disabled', code: '000000', status: 'disable', sort_order: -1}]));
        const existingCodes = definition.existing === 'production' ? codes : [...codes, ...constants.GEN1_BENCHMARK_CODES];
        const rows = definition.existing ? existingCodes.flatMap(code => bars().map(row => ({_id: 'daily:' + code + ':' + row[0], code,
          trade_date: row[0], open: 8, high: 11, low: 7, close: 9, volume: 10000,
          is_final: definition.existing !== 'unfinalized', fixture_metadata: 'preserve'}))) : [];
        state.business.seed(c.ETF_DAILY, rows);
      }
      for (const [b, s] of [[binding, store], [childBinding, childStore]]) {
        actual.state.journal.seed(adapter.id(b, 'control'), adapter.encodeControl(journal.initial(b), b));
        assert((await journal.apply(s, b, {type: 'activate', owner: 'new', revision: 0, proof})).ok);
      }
      const business = definition.signed ? {force: true} : {Type: 'Timer', TriggerName: 'dailyFetch-2200', Time: definition.now, Message: 'writer-root-timer-v1'};
      const request = definition.signed ? entry.seal({binding, control: await store.read(binding), target: pack.target,
        request_id: 'fixture:' + definition.name, business, key}) : business;
      if (!definition.signed) {
        actual.state.source = 'sdk';const before = actual.state.journal.calls.length;
        assert.strictEqual((await actual.index.main(copy(request), context)).executed, false);
        assert.strictEqual(actual.state.journal.calls.length, before);assert.strictEqual(actual.state.business.calls.length, 0);
        assert.strictEqual(actual.state.provider.length, 0);assert.strictEqual(actual.state.children.length, 0);actual.state.source = 'timer';
      }
      const wrapped = await actual.index.main(copy(request), context), left = actual.state;
      assert.deepStrictEqual(left.business.violations, []);assert.deepStrictEqual(left.rejected, []);
      assert.strictEqual(left.business.writes.length, definition.writes, definition.name + ': unexpected number of writes');
      assert.strictEqual(left.provider.length, definition.requests, definition.name + ': unexpected number of provider requests');
      if (definition.childFault) {
        assert.strictEqual(wrapped.error_code, 'WRITER_EXECUTION_UNKNOWN');assert.strictEqual(wrapped.hold_confirmed, true);
        assert.strictEqual((await store.read(binding)).state, 'HOLD');assert.strictEqual((await childStore.read(childBinding)).state, 'HOLD');
        assert.strictEqual(left.children.length, 1);
        assert((await store.read(binding)).active, 'unknown parent must retain its execution slot');
        const before = [left.business.calls.length, left.provider.length, left.children.length];
        assert.strictEqual((await actual.index.main(copy(request), {...context, request_id: 'fixture:retry'})).error_code, 'WRITER_ADMISSION_CLOSED');
        assert.deepStrictEqual([left.business.calls.length, left.provider.length, left.children.length], before);
        faultCases.push({case: definition.name, business_writes: left.business.writes.length, parent: 'HOLD', child: 'HOLD', duplicate_business_calls: 0});
        continue;
      }
      const expected = await original.index.main(copy(business), {}), right = original.state;
      const result = definition.signed ? wrapped.result : wrapped;
      assert.deepStrictEqual(copy(result), copy(expected), definition.name + ': whole response differs');assert.strictEqual(result.ok, true);
      assert.strictEqual(result.skipped, definition.skipped);
      assert.deepStrictEqual(left.business.violations, []);assert.deepStrictEqual(right.business.violations, []);
      assert.deepStrictEqual(right.rejected, []);
      assert.deepStrictEqual(copy(left.business.writes), copy(right.business.writes), definition.name + ': wire writes differ');
      assert.deepStrictEqual(copy(left.business.snapshot()), copy(right.business.snapshot()), definition.name + ': final tables differ');
      assert.deepStrictEqual(left.provider, right.provider);
      if (definition.skipped) {assert.strictEqual(left.business.writes.length, 0);assert.strictEqual(left.provider.length, 0);assert.strictEqual(left.children.length, 0);}
      else {
        assert.strictEqual(left.children.length, 1);assert.strictEqual(right.children.length, 1);
        const rootId = definition.signed ? request.request_id : entry.scheduledRequest({environment: ENV, producer: PRODUCER,
          trigger_name: 'dailyFetch-2200', scheduled_for: definition.now});
        assert.strictEqual(left.children[0].request_id, entry.childRequest({parent_request_id: rootId, producer: PRODUCER, action: 'materialize'}));
        assert.deepStrictEqual(left.children[0].business, right.children[0].business);
        const dailyRows = left.business.rows(actual.collections.ETF_DAILY);
        if (definition.intraday) {assert(!dailyRows.some(row => row.trade_date === '2026-10-29'));assert.strictEqual(result.total_bars, 95);}
        else {assert.strictEqual(dailyRows.filter(row => row.trade_date === '2026-10-29' && row.is_final).length, 6);}
        if (definition.existing) assert(dailyRows.filter(row => row._id.startsWith('daily:')).every(row => row.fixture_metadata === 'preserve'));
        if (definition.existing === 'production') {
          assert.strictEqual(result.total_bars, 0);assert.strictEqual(result.production_daily.ok, true);
          assert.deepStrictEqual(result.lane_execution.production_to_fetch, []);
          assert(!left.provider.some(row => /secid=/.test(row.url)), 'ready production must not fetch premium again');
        }
        if (definition.fallback) {assert.strictEqual(result.results[0].source, 'sina');assert(left.provider.some(row => /sina/.test(row.url)));}
        const logs = left.business.rows(actual.collections.FETCH_LOG);
        assert(logs.some(row => row.source === 'storage_price' && row.status === (definition.badStorage ? 'fail' : 'success')));
        assert.strictEqual(logs.some(row => row.source === 'fred' && row.status === 'success'), !definition.noFred);
        assert.strictEqual(left.business.rows(actual.collections.FUNDAMENTAL_SERIES).some(row => row.indicator === 'real_rate' && row.value === 1.7), !definition.noFred);
        assert.strictEqual(left.business.rows(actual.collections.MARKET_ENV).length, 3);
        assert.strictEqual(left.business.rows(actual.collections.GLOBAL_QUOTE).length, 4);
      }
      const before = [left.business.calls.length, left.business.writes.length, left.provider.length, left.children.length];
      const repeated = await actual.index.main(copy(request), {...context, request_id: 'fixture:native-2'});
      assert.strictEqual(definition.signed ? repeated.admission : repeated.reason, 'ALREADY_COMPLETE');
      assert.deepStrictEqual([left.business.calls.length, left.business.writes.length, left.provider.length, left.children.length], before);
      const receipts = left.journal.rows().filter(row => ['request', 'token'].includes(row.kind));
      assert.strictEqual(receipts.length, 2);assert(receipts.every(row => JSON.parse(row.payload_json).status === 'COMPLETE'));
      results.push({case: definition.name, business_writes: left.business.writes.length, provider_fixture_requests: left.provider.length,
        child_transport_fixtures: left.children.length, duplicate_business_calls: 0});
    }
    assert.strictEqual(attempts(), 0);check();
    return {status: 'PASS_CORE_DAILY_ACTUAL_SDK_MEMORY_WIRE', scope: 'V3_CORE_ONLY', producer: PRODUCER,
      runtime: process.version, sdk: '2.11.0', database: '1.4.1', package_source: manifest.source_commit, cases: results, fault_cases: faultCases,
      all_business_results_writes_and_final_tables_equal: true, network_attempts: attempts(), cloud_calls: 0,
      materializer_and_rde_execution: 'NOT_RUN_CHILD_TRANSPORT_FIXTURE_ONLY', production_and_natural_qualification: 'NOT_PROVEN'};
  } finally {restorers.reverse().forEach(restore => restore());global.Date = NativeDate;}
}
function main() {
  let args = process.argv.slice(2);const child = args[0] === '--child';if (child) args = args.slice(1);
  assert(args.length === 4 && args[0] === '--inputs' && args[2] === '--candidates');
  if (child) return execute(args[1], args[3]).then(result => console.log(JSON.stringify(result)));
  const env = {V3_CORE_DAILY_SDK_CHILD: 'yes'};
  for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP']) if (process.env[key]) env[key] = process.env[key];
  const result = spawnSync(process.execPath, [__filename, '--child', ...args], {env, encoding: 'utf8', timeout: 300000, maxBuffer: 1024 * 1024});
  if (result.stdout) process.stdout.write(result.stdout);if (result.stderr) process.stderr.write(result.stderr);
  assert.strictEqual(result.status, 0, 'Core daily SDK child failed; not chain/cloud qualification');
}
if (require.main === module) Promise.resolve().then(main).catch(error => {console.error(error);process.exitCode = 1;});
