'use strict';
const assert = require('assert'), path = require('path');
const {backend, fakeDatabase} = require('./writer-journal-cloudbase.test');
const {createHandlers} = require('../release/runtime24-entry-proof');
const plan = require('../release/runtime24-entry-proof-plan.json');
const {oneOff} = require('../release/entry-proof-schedule');
for (const now of [Date.UTC(2026, 10, 2, 15, 59, 30), Date.UTC(2026, 11, 31, 15, 59, 30), Date.UTC(2026, 10, 2, 1, 0, 0)]) {
  const schedule = oneOff(now), due = Date.parse(schedule.scheduled_for), parts = schedule.cron.split(' ');
  assert.strictEqual(parts[5], '?'); assert.strictEqual(schedule.occurrences, 1);
  assert.strictEqual(Date.UTC(Number(parts[6]), Number(parts[4]) - 1, Number(parts[3]), Number(parts[2]) - 8, Number(parts[1])), due);
  assert(due - now >= 180000 && due - now < 240000);
}
async function replay(makeDatabase, wrap = fn => fn) {
  const {b, database} = makeDatabase(); let elapsed = 0, sleeps = 0, forwards = 0;
  const now = Date.UTC(2026, 10, 2, 1, 0, 0), due = new Date(now + 180000).toISOString();
  const rootContext = request_id => ({function_name: plan.root_name, request_id});
  let handlers;
  const callFunction = wrap(async (request, opts) => {
    forwards++; assert.strictEqual(request.name, plan.worker_name);
    assert.deepStrictEqual(opts, {timeout: 135000, retryOptions: {retries: 0}});
    return {requestId: 'sdk:' + forwards, result: await handlers.workerMain({...request.data, tcbContext: {}, userInfo: {}},
      {function_name: plan.worker_name, request_id: 'worker:' + forwards})};
  });
  handlers = createHandlers({database, callFunction, now: () => now, monotonic: () => elapsed,
    sleep: async ms => { assert.strictEqual(ms, 115000); sleeps++; elapsed += ms; },
    runtimeIdentity: c => ({...c, environment: plan.environment, node_major: 24, runtime_version: 'v24.0.0'})});
  const prepare = {case: plan.manual_prepare_case, scheduled_for: due};
  await assert.rejects(handlers.rootMain({...prepare, collection: 'production'}, rootContext('bad')));
  assert.strictEqual(b.rows().length, 0);
  assert.strictEqual((await handlers.rootMain(prepare, rootContext('prepare'))).status, 'PREPARED');
  await assert.rejects(handlers.rootMain(prepare, rootContext('repeat')), /fixture exists/);
  const event = {Type: 'Timer', TriggerName: plan.timer_name, Time: due, Message: plan.timer_message};
  assert.strictEqual(forwards, 0);
  await assert.rejects(handlers.rootMain(event, rootContext('native:first')), /EXPECTED_ENTRY_TIMER_RETRY/);
  assert.strictEqual(sleeps, 1); assert.strictEqual(forwards, 1);
  const retried = await handlers.rootMain(event, rootContext('native:retry-distinct'));
  assert.strictEqual(retried.status, 'PASS'); assert.strictEqual(forwards, 2); assert.strictEqual(sleeps, 1);
  const audit = await handlers.rootMain({case: plan.manual_audit_case}, rootContext('audit'));
  assert.strictEqual(audit.status, 'PASS'); assert.strictEqual(audit.timer_time_stable_across_native_retry, true);
  assert.strictEqual(audit.native_request_id_stable_across_retry, false, 'identity must not depend on native requestId stability');
  assert.strictEqual(audit.worker_elapsed_ms, 115000); assert.strictEqual(b.rows().length, 7);
  const snapshot = b.rows();
  assert.strictEqual((await handlers.rootMain(event, rootContext('excess'))).status, 'STOPPED');
  assert.deepStrictEqual(b.rows(), snapshot); assert.strictEqual(forwards, 2);
  // Unexpected forwarding failures do not trigger the intended native retry.
  const failed = makeDatabase(); let attempted = 0;
  const bad = createHandlers({database: failed.database, now: () => now, monotonic: () => 0, sleep: async () => { throw Error('must not sleep'); },
    runtimeIdentity: c => ({...c, environment: plan.environment, node_major: 24}),
    callFunction: wrap(async () => { attempted++; throw Error('unknown transport outcome'); })});
  await bad.rootMain(prepare, rootContext('failed-prepare'));
  assert.strictEqual((await bad.rootMain(event, rootContext('failed-first'))).status, 'STOPPED');
  assert.strictEqual((await bad.rootMain(event, rootContext('failed-retry'))).status, 'STOPPED');
  assert.strictEqual(attempted, 1); assert(!failed.b.rows().some(row => row._id === 'entry:business'));
  const mismatch = makeDatabase(); let wrongForwards = 0;
  const wrongTime = createHandlers({database: mismatch.database, now: () => now, monotonic: () => 0, sleep: async () => {},
    runtimeIdentity: c => ({...c, environment: plan.environment, node_major: 24}), callFunction: async () => { wrongForwards++; }});
  await wrongTime.rootMain(prepare, rootContext('mismatch-prepare'));
  assert.strictEqual((await wrongTime.rootMain({...event, Time: new Date(now).toISOString()}, rootContext('mismatch-timer'))).status, 'STOPPED');
  assert.strictEqual(wrongForwards, 0);
  assert.strictEqual(mismatch.b.rows().find(row => row._id === 'entry:attempt-0').reason, 'TIMER_TIME_MISMATCH');
  return {fixed_proof_flow: true, documents: 7, forwarded_calls: forwards, business_executions: sleeps,
    simulated_worker_delay_ms: elapsed, native_timer_and_retry_not_proven: true, network_requests: 0};
}
async function main() {
  const args = process.argv.slice(2);
  if (!args.length) {
    const result = await replay(() => { const b = backend(JSON, plan.collection, {entryFixture: true}); return {b, database: fakeDatabase(b, plan.environment, plan.collection)}; });
    console.log(JSON.stringify(result)); return;
  }
  assert(args.length === 4 && args[0] === '--package' && args[2] === '--file-map');
  const {verifyPackage} = require('../scripts/lib/verified-writer-package');
  const {root} = verifyPackage(path.resolve(args[1]), path.resolve(args[3]));
  assert.strictEqual(require(path.join(root, 'node_modules/@cloudbase/node-sdk/package.json')).version, '2.11.0');
  const {Db} = require(path.join(root, 'node_modules/@cloudbase/database')), {EJSON} = require(path.join(root, 'node_modules/bson'));
  const http = require(path.join(root, 'node_modules/@cloudbase/node-sdk/lib/utils/httpRequest'));
  const sdk = require(path.join(root, 'node_modules/@cloudbase/node-sdk/lib/functions'));
  const original = {request: Db.reqClass, http: http.default}, routes = new Map(), transports = new Map();
  Db.reqClass = class {constructor(config) { this.b = transports.get(config.transportId); assert(this.b); } send(action, params) { return this.b.send(action, params); }};
  http.default = async args => {
    assert.strictEqual(args.params.action, 'functions.invokeFunction');
    assert(args.config.retries === 0 && args.config.keepalive === false);
    const response = await routes.get(args.config.route)({name: args.params.function_name, data: JSON.parse(args.params.request_data)}, args.opts);
    return {requestId: 'offline', data: {response_data: JSON.stringify(response.result)}};
  };
  try {
    const result = await replay(() => {
      const b = backend(EJSON, plan.collection, {entryFixture: true}), transportId = transports.size; transports.set(transportId, b);
      return {b, database: new Db({envName: plan.environment, transportId, retries: 0, keepalive: false, throwOnCode: true})};
    }, fn => {
      const route = routes.size; routes.set(route, fn);
      return (request, options) => sdk.callFunction({config: {envName: plan.environment, route, retries: 0, keepalive: false}}, request, options);
    });
    verifyPackage(root, path.resolve(args[3]));
    console.log(JSON.stringify({runtime: process.version, sdk: '2.11.0', real_database_and_function_serializers: true, ...result}));
  } finally { Db.reqClass = original.request; http.default = original.http; }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
