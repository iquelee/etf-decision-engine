#!/usr/bin/env node
'use strict';
// Offline observation of the captured Gen2 entry. Never imports its real SDK.
const assert = require('assert'), crypto = require('crypto'), fs = require('fs'), path = require('path'), vm = require('vm');
const {fileMap} = require('../release/prepare-writer-workers');
const {fixture} = require('../tests/writer-worker-bootstrap.test');
const {message, messageFor} = require('../release/writer-timer-identity');
const baseline = require('../release/runtime24-writer-six-inventory.json').functions.find(f => f.FunctionName === 'runGen2ShadowEod');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function replay(root, mapFile) {
  root = fs.realpathSync(root);mapFile = fs.realpathSync(mapFile);
  const raw = fs.readFileSync(mapFile);assert.strictEqual(sha(raw), baseline.download.raw_file_map_sha256);
  const files = JSON.parse(raw);
  function verify() {
    assert.deepStrictEqual(fileMap(root), files, 'captured package drift');
    assert.strictEqual(files['index.js'], baseline.download.entry_sha256);
  }
  verify();
  const writes = [];let reads = 0, allowReads = false;const data = {};
  const database = {async upsert(collection, doc, filter) {writes.push(JSON.parse(JSON.stringify({collection, doc, filter})));},
    async query(collection, filter) {
      reads++;assert(allowReads, 'UNEXPECTED_DATA_READ');
      assert.strictEqual(collection, constants.exports.COLLECTIONS.GEN2_DAILY);
      return JSON.parse(JSON.stringify(data[filter.code] || []));
    }};
  const bundle = path.join(root, 'GEN2_RULE_V2_BUNDLE.json');
  const constantsFile = path.join(root, 'common/constants.js');
  const constants = {exports: {}};
  vm.runInNewContext(fs.readFileSync(constantsFile, 'utf8'), {module: constants, exports: constants.exports},
    {filename: constantsFile, timeout: 10000});
  class Clock extends Date {
    constructor(...args) {super(...(args.length ? args : ['2026-10-29T14:30:00.000Z']));}
    static now() {return new Date('2026-10-29T14:30:00.000Z').getTime();}
  }
  const module = {exports: {}};
  const box = {module, exports: module.exports, __dirname: root, Date: Clock,
    console: {log() {}, warn() {}, error() {}}, require(name) {
      if (name === 'fs') return {readFileSync(file, encoding) {
        assert.strictEqual(path.resolve(file), bundle, 'only captured bundle may be read');
        return fs.readFileSync(bundle, encoding);
      }};
      if (['path', 'crypto'].includes(name)) return require(name);
      if (name === './common/utils/db') return database;
      if (name === './common/constants') return constants.exports;
      throw Error('OFFLINE_MODULE_DENIED:' + name);
    }};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'index.js'), 'utf8'), box, {filename: path.join(root, 'index.js'), timeout: 10000});
  const event = {Type: 'Timer', TriggerName: 'gen2-eod-weekdays-2230', Time: '2026-10-29T14:30:00Z', Message: message};
  const parsed = module.exports._internal.resolveEventParams(event);
  assert.strictEqual(parsed.ok, false);assert.strictEqual(parsed.code, 'EVENT_PARAM_INVALID');
  const jsonControl = module.exports._internal.resolveEventParams({...event,
    Message: JSON.stringify({mode: 'LIVE', expected_trade_date: '2026-10-29'})});
  assert.strictEqual(jsonControl.ok, true);assert.strictEqual(jsonControl.mode, 'LIVE');
  assert.strictEqual(jsonControl.expectedTradeDate, '2026-10-29');
  // Reproduce the former generic-message incompatibility on the whole entry.
  const business = await module.exports.main(event, {});
  assert.strictEqual(business.status, 'blocked');assert.strictEqual(business.status_reason, 'EVENT_PARAM_INVALID');
  assert.strictEqual(business.data_gate, 'EVENT_PARAM_INVALID');assert.strictEqual(reads, 0);
  assert.strictEqual(writes.length, 3);assert(writes.every(row => row.collection === constants.exports.COLLECTIONS.GEN2_SHADOW));
  const f = await fixture('runGen2ShadowEod');f.state.triggerSource = 'timer';
  f.state.handler = (_, business) => module.exports.main(business, {});
  assert.strictEqual((await f.bootstrap.main(event, f.context)).executed, false);
  assert.strictEqual(f.state.inits.length, 0);assert.strictEqual(writes.length, 3);
  // Preserve the observed REPLAY CustomArgument and compare whole actual-entry
  // outputs and every write against the same unwrapped captured business.
  const validEvent = {...event, Message: messageFor('runGen2ShadowEod')};
  assert.strictEqual(module.exports._internal.resolveEventParams(validEvent).mode, 'REPLAY');
  const universe = module.exports._internal.UNIVERSE;
  const order = ['513310', '159582', '159819', '159852', '159570',
    ...universe.eligible_codes.filter(code => !['513310', '159582', '159819', '159852', '159570'].includes(code))];
  for (const [index, code] of [...order, universe.benchmark_code].entries()) {
    let px = 100;const drift = code === universe.benchmark_code ? 0.001 : 0.004 - 0.00009 * index;
    data[code] = Array.from({length: 140}, (_, i) => {
      px *= 1 + drift;
      return {code, trade_date: new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10),
        open: px * 0.999, high: px * 1.002, low: px * 0.998, close: px,
        volume: 1000000 + i * 1000, amount: 200000000 + i * 1000};
    });
  }
  allowReads = true;writes.length = 0;reads = 0;
  const expected = await module.exports.main(validEvent, {});
  assert.strictEqual(expected.status, 'completed');assert.strictEqual(expected.mode, 'REPLAY');
  const expectedWrites = JSON.parse(JSON.stringify(writes)), expectedReads = reads;
  assert.strictEqual(expectedWrites.filter(row => row.doc.type === 'gen2_ranking').length, 30);
  assert.strictEqual(expectedWrites.filter(row => row.doc.type === 'gen2_candidate_leg').length, 31);
  writes.length = 0;reads = 0;
  const actual = await f.bootstrap.main(validEvent, f.context);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)));
  assert.deepStrictEqual(writes, expectedWrites);assert.strictEqual(reads, expectedReads);
  const control = await f.store.read(f.binding);
  assert.strictEqual(control.state, 'ACTIVE');assert.strictEqual(control.active, null);
  assert.strictEqual((await f.bootstrap.main(validEvent, {...f.context, request_id: 'fixture:retry'})).reason, 'ALREADY_COMPLETE');
  assert.strictEqual(writes.length, expectedWrites.length);assert.strictEqual(reads, expectedReads);
  verify();
  return {status: 'PASS_MODEL_ONLY_NOT_CLOUD_QUALIFIED', transport: 'MODEL_ONLY',
    captured_entry_sha256: files['index.js'], captured_files_verified: Object.keys(files).length,
    generic_message: message, actual_business_status: business.status, actual_business_gate: business.data_gate,
    preserved_custom_argument: validEvent.Message, preserved_business_mode: actual.mode,
    whole_entry_results_and_all_writes_equal: true,
    business_writes: writes.length, business_data_reads: reads, json_message_parser_control: 'PASS',
    protocol_receipt_completed: true, duplicate_business_writes: 0, cloud_invocations: 0, cloud_mutations: 0};
}
if (require.main === module) {
  const args = process.argv.slice(2);
  assert(args.length === 4 && args[0] === '--package' && args[2] === '--file-map');
  replay(args[1], args[3]).then(result => console.log(JSON.stringify(result))).catch(error => {console.error(error);process.exitCode = 1;});
}
module.exports = {replay};
