'use strict';
// Whole unchanged caller + RDE entries share the same memory database. This
// tests outgoing RDE routing only, and explicitly exposes parent-write gaps.
const assert = require('assert'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const {createHarness} = require('../scripts/lib/rde-offline-harness');
const {setup} = require('./writer-direct-caller.test');
const journal = require('../release/writer-admission-journal');
const repo = path.resolve(__dirname, '..'), copy = x => JSON.parse(JSON.stringify(x));
const bind = {environment: 'offline', scope: 'direct-rde'};
let roots = Object.fromEntries(['adminGateway', 'materializeIndicators', 'runDecisionEngine'].map(name =>
  [name, {root: path.join(repo, 'cloudfunctions', name), common: path.join(repo, 'src/common')}]));
async function run(callerName, event, guarded, closed = false) {
  let h, dispatch, child; const outgoing = [];
  const rde = roots.runDecisionEngine;
  h = createHarness(roots[callerName].root, {common: roots[callerName].common, entries: [rde],
    callFunction: async (request, options) => {
      outgoing.push(copy(request));
      assert.strictEqual(request.name, 'runDecisionEngine', 'no unexpected dependency calls');
      const plain = copy(request);
      return guarded ? dispatch(plain, options) : {requestId: 'sdk:1', result: copy(await child.main(plain.data, {}))};
    }});
  child = h.load(path.join(rde.root, 'index.js'));
  h.setRows('param_config', [...h.rows('param_config'), {_id: 'auth:fixture', key: 'admin_token',
    value: {v: 'fixture-session', exp: '2026-10-30T00:00:00Z'}}]);
  h.setRows('risk_events', [{_id: 'risk:fixture', code: '513310', event_type: 'policy', status: 'active', reason: 'fixture'}]);
  let f;
  if (guarded) {
    f = await setup(async (business, context) => copy(await child.main(business, context)));
    dispatch = f.caller('captured-operation:' + callerName, {callerName,
      runtimeIdentity: () => ({environment: 'offline', function_name: callerName, node_major: 16})});
    if (closed) assert((await journal.apply(f.store, bind, {type: 'hold', revision: 1})).ok);
  }
  const result = await h.run(copy(event));
  return {h, f, result: copy(result), outgoing};
}
async function test() {
  const isolated = createHarness(roots.runDecisionEngine.root, {common: roots.runDecisionEngine.common});
  assert.throws(() => isolated.load('@cloudbase/node-sdk').init().callFunction({name: 'denied'}), /OFFLINE_FUNCTION_CALL_DENIED/);
  assert.throws(() => isolated.load('https'), /OFFLINE_MODULE_DENIED/);
  assert.throws(() => isolated.load('fs').readFileSync(path.join(repo, 'cloudbaserc.json')), /OFFLINE_FILE_DENIED/);
  const admin = (route, body) => ({httpMethod: 'POST', path: '/api/admin/' + route,
    headers: {'x-admin-token': 'fixture-session'}, body});
  const cases = [
    ['materializeIndicators', {}],
    ['adminGateway', admin('risk', {action: 'resolve', event_id: 'risk:fixture', resolve_reason: 'fixture resolved'})],
    ['adminGateway', admin('risk', {code: '513310', event_type: 'POLICY', reason: 'fixture triggered'})],
    ['adminGateway', admin('param', {key: 'offline_fixture_param', value: 7})]
  ];
  const counts = [];
  for (const [name, event] of cases) {
    const baseline = await run(name, event, false), candidate = await run(name, event, true);
    assert.strictEqual(candidate.outgoing.length, 1, name + ': actual original caller reached dependency');
    assert.strictEqual(candidate.f.state.calls.length, 1, name + ': no extra facade hop');
    assert.strictEqual(candidate.f.state.loads, 1);
    assert.strictEqual(candidate.result.code === undefined ? candidate.result.ok : candidate.result.code === 0, true, JSON.stringify(candidate.result));
    assert.deepStrictEqual(candidate.result, baseline.result, name + ': exact whole caller response');
    assert.deepStrictEqual(candidate.outgoing, baseline.outgoing, name + ': original business payload');
    assert.deepStrictEqual(candidate.h.writes, baseline.h.writes, name + ': whole shared-store write order/count');
    for (const collection of new Set(baseline.h.writes.map(x => x.collection)))
      assert.deepStrictEqual(candidate.h.rows(collection), baseline.h.rows(collection), name + ':' + collection);
    counts.push({caller: name, shared_store_writes: candidate.h.writes.length, from: candidate.outgoing[0].data.from});
  }
  // A blocked child does NOT undo the actual admin mutation which happened
  // before that call. This is a negative witness, NOT maintenance acceptance.
  const blocked = await run('adminGateway', cases[2][1], true, true);
  assert.strictEqual(blocked.f.state.calls.length, 0); assert.strictEqual(blocked.f.state.loads, 0);
  assert(blocked.h.writes.some(x => x.collection === 'risk_events'));
  assert(!blocked.h.writes.some(x => x.collection === 'run_manifest'));
  assert(blocked.h.rows('risk_events').some(x => x.reason === 'fixture triggered'));
  assert(/writer admission closed/.test(blocked.result.data.recomputed.error));
  const unauthorized = await run('adminGateway', {...cases[2][1], headers: {}}, true);
  assert.strictEqual(unauthorized.result.code, 401);assert.strictEqual(unauthorized.h.writes.length, 0);
  assert.strictEqual(unauthorized.outgoing.length, 0);
  console.log(JSON.stringify({whole_caller_and_rde_shared_database: true, cases: counts,
    sdk_envelope_and_all_payloads_preserved: true, parent_mutation_before_child_rejection_observed: true,
    maintenance_gate_still_required: true, transport: 'MEMORY_ONLY'}));
}
async function main() {
  const args = process.argv.slice(2);if (!args.length) return test();
  assert(args.length === 2 && args[0] === '--inventory-root');
  const base = path.resolve(args[1]), inventory = require('../release/runtime24-writer-inventory.json');
  const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex'), verified = [];
  for (const name of Object.keys(roots)) {
    const root = path.join(base, name + '-download'), map = path.join(base, name + '.files.json');
    const observed = inventory.functions.find(x => x.FunctionName === name), raw = fs.readFileSync(map), files = JSON.parse(raw);
    assert.strictEqual(sha(raw), observed.download.raw_file_map_sha256);
    const walk = directory => fs.readdirSync(directory, {withFileTypes: true}).flatMap(item => {
      assert(!item.isSymbolicLink());const file = path.join(directory, item.name);
      return item.isDirectory() ? walk(file) : [path.relative(root, file).split(path.sep).join('/')];
    });
    const check = () => {assert.deepStrictEqual(walk(root).sort(), Object.keys(files).sort());
      for (const [file, hash] of Object.entries(files)) assert.strictEqual(sha(fs.readFileSync(path.join(root, file))), hash);};
    check();verified.push(check);roots[name] = {root, common: path.join(root, 'common')};
  }
  await test();verified.forEach(check => check());
  console.log(JSON.stringify({independent_packages: Object.keys(roots), all_original_bytes_preserved: true, runtime: process.version, network_requests: 0}));
}
if (require.main === module) main().catch(error => {console.error(error);process.exitCode = 1;});
