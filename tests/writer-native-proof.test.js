'use strict';
const assert = require('assert');
const path = require('path');
const {createHandlers, ExpectedRetry} = require('../release/runtime24-native-proof');
const plan = require('../release/runtime24-native-proof-plan.json');
const {backend, fakeDatabase} = require('./writer-journal-cloudbase.test');
const args = process.argv.slice(2);let sdk, serializer = JSON, restore = () => {}, verify = () => {};
if (args.length) {
  assert(args.length === 4 && args[0] === '--package' && args[2] === '--file-map');
  const {verifyPackage} = require('../scripts/lib/verified-writer-package');
  const root = verifyPackage(path.resolve(args[1]), path.resolve(args[3])).root;
  sdk = require(path.join(root, 'node_modules/@cloudbase/node-sdk'));
  assert.strictEqual(sdk.version, '2.11.0');
  assert.strictEqual(require(path.join(root, 'node_modules/@cloudbase/database/package.json')).version, '1.4.1');
  serializer = require(path.join(root, 'node_modules/bson')).EJSON;
  const {DBRequest} = require(path.join(root, 'node_modules/@cloudbase/node-sdk/lib/utils/dbRequest'));
  const before = DBRequest.prototype.send;
  DBRequest.prototype.send = function(action, params) {return b.send(action, params);};
  restore = () => {DBRequest.prototype.send = before;};verify = () => verifyPackage(root, path.resolve(args[3]));
}
const b = backend(serializer, plan.collection, {entryFixture: true});
const epoch = Date.parse('2026-11-03T00:00:00.000Z'), due = new Date(epoch + 180000).toISOString();
let source, dbLoads = 0;const observations = [];
const h = createHandlers({database: () => {dbLoads++;return sdk ? sdk.init({env: plan.environment, retries: 0, keepalive: false,
    timeout: 15000, throwOnCode: true}).database() : fakeDatabase(b, plan.environment, plan.collection);}, runtimeInstance: 'synthetic-warm-instance', now: () => epoch,
  runtimeIdentity: ctx => ({environment: plan.environment, function_name: plan.function_name, node_major: 24,
    request_id: ctx.id, trigger_source: source}), observe: r => observations.push(r)});
const event = {Type: 'Timer', TriggerName: plan.timer_name, Message: plan.timer_message, Time: due};
async function test() {
  const forged = await h.main(event, {id: 'sdk:before'});
  assert.strictEqual(forged.status, 'REJECTED');assert.strictEqual(dbLoads, 0);assert.strictEqual(b.calls.length, 0);
  const http = {httpMethod: 'POST', path: plan.http_path, headers: {Origin: plan.http_origin, 'X-Writer-Operation-Id': plan.http_operation_id},
    body: JSON.stringify({case: 'verify-native-header-v1'})};
  const echo = await h.main(http, {id: 'http:header'});
  assert.strictEqual(echo.operation_id, plan.http_operation_id);assert.strictEqual(echo.data.header_received, true);
  await assert.rejects(h.main({...http, body: JSON.stringify({case: 'prepare-native-root-v1', scheduled_for: due})}, {id: 'http:forged-prepare'}));
  assert.strictEqual(dbLoads, 0);assert.strictEqual(b.calls.length, 0, 'HTTP can never select SDK storage actions');
  assert.strictEqual((await h.main({case: 'prepare-native-root-v1', scheduled_for: due}, {id: 'sdk:prepare'})).status, 'PREPARED');
  const initialRows = b.rows();assert.strictEqual(initialRows.length, 2);
  await assert.rejects(h.main({case: 'prepare-native-root-v1', scheduled_for: due}, {id: 'sdk:prepare-again'}));
  assert.deepStrictEqual(b.rows(), initialRows, 'no reset/reinitialization');
  source = 'timer';
  await assert.rejects(h.main({...event, Time: new Date(epoch).toISOString()}, {id: 'native:wrong-time'}));
  assert.deepStrictEqual(b.rows(), initialRows);
  await assert.rejects(h.main(event, {id: 'native:first'}), ExpectedRetry);
  assert.strictEqual(b.rows().length, 6);
  assert.strictEqual(b.rows().find(row => row._id === 'entry:attempt-0').status, 'SUCCESS');
  const retried = await h.main({...event, Time: due.replace('.000Z', 'Z')}, {id: 'native:retry-distinct'});
  assert.strictEqual(retried.status, 'PASS');assert.strictEqual(b.rows().length, 7);
  const final = b.rows();
  assert.strictEqual((await h.main(event, {id: 'native:extra'})).status, 'STOPPED');assert.deepStrictEqual(b.rows(), final);
  // Sticky per-instance source would be a failed source qualification even
  // when permanent dedup prevents an additional business execution.
  assert.strictEqual((await h.main(event, {id: 'sdk:sticky-source'})).status, 'STOPPED');
  source = undefined;const before = b.calls.length;
  const after = await h.main(event, {id: 'sdk:after'});
  assert.strictEqual(after.status, 'REJECTED');assert.strictEqual(after.observation.runtime_instance, retried.observation.runtime_instance);
  assert.strictEqual(b.calls.length, before, 'post-Timer SDK source rejection precedes storage');
  const audit = await h.main({case: 'audit-native-root-v1'}, {id: 'sdk:audit'});
  assert.strictEqual(audit.status, 'PASS');assert.strictEqual(audit.warm_sdk_rejection_requires_independent_verification, true);
  assert.deepStrictEqual(b.rows(), final);assert.strictEqual(final.filter(row => row.kind === 'native:business').length, 1);
  assert(observations.every(row => Object.keys(row).sort().join(',') ===
    'environment,function_name,native_request_id,node_major,runtime_instance,trigger_source'));
  verify();console.log(JSON.stringify({transport: sdk ? 'REAL_SDK_MEMORY_WIRE' : 'MODEL_ONLY', runtime: process.version, fixture_documents: 7, business_executions: 1,
    intentional_error_after_confirmation: true, retry_distinct_native_id_deduplicated: true,
    sdk_and_http_before_database: true, sticky_source_not_accepted_as_pass: true, native_platform_proof: 'NOT_RUN'}));
}
test().catch(error => {console.error(error);process.exitCode = 1;}).finally(restore);
