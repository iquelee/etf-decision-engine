'use strict';
const assert = require('assert');
const plan = require('../release/writer-dispatch-plan');
const admission = require('../release/writer-admission');
const entry = require('../release/writer-entry');
const clone = x => JSON.parse(JSON.stringify(x)), key = Buffer.alloc(32, 71);
const parent = {...plan.parentBinding, owner: 'new', epoch: 1, request_id: 'manual:fixture', token: 'parent:fixture'};
const request = {name: 'fetchDailyData', data: {force: true, task_name: 'daily'}};
function control(binding) {return {...admission.initial(binding), owner: 'new', epoch: 1, state: 'ACTIVE', revision: 3};}
function view(spec) {
  const receipt = {...spec.parent, status: 'COMPLETE'};
  return {parentControl: control(plan.parentBinding), childControl: control({environment: plan.environment, scope: 'production/' + spec.target}),
    requestReceipt: clone(receipt), tokenReceipt: clone(receipt),
    rollout: {schema: 1, environment: plan.environment, scope: 'production/writer-rollout', revision: 2, state: 'OPEN'}};
}
function main() {
  for (const [target, aliases] of Object.entries(plan.routes)) for (const alias of aliases) {
    const spec = plan.specification(parent, {name: target, data: {force: true, task_name: alias}});
    const prepared = plan.prepare(null, spec), before = clone(prepared), v = view(spec), oldView = clone(v);
    assert.strictEqual(plan.prepare(prepared, spec), null, 'durable prepare is idempotent');
    const claimed = plan.claim(prepared, v, key);assert(claimed.ok);assert.deepStrictEqual(prepared, before);assert.deepStrictEqual(v, oldView);
    assert.strictEqual(claimed.parentFence.revision, 4);assert.strictEqual(claimed.childFence.revision, 4);assert.strictEqual(claimed.rolloutFence.revision, 3);
    admission.validate(claimed.parentFence, plan.parentBinding);
    entry.authenticate(claimed.next.wire, {binding: {environment: plan.environment, scope: 'production/' + target}, target: target + 'Node24', owner: 'new', key});
    assert.strictEqual(plan.claim(claimed.next, v, key).reason, 'NO_AUTOMATIC_RETRY');
    const w = claimed.next.wire;
    const response = {requestId: 'fixture:sdk', result: {protocol: 'writer-result-v1', request_id: w.request_id, token: w.token,
      owner: w.owner, epoch: w.epoch, executed: true, outcome: 'COMPLETE', result: {ok: false}}};
    const finished = plan.settle(claimed.next, response);assert.strictEqual(finished.state, 'COMPLETE');
    assert.throws(() => plan.settle(finished, response));assert.strictEqual(plan.claim(finished, v, key).ok, false);
    for (const bad of [null, {code: 'timeout'}, {result: response.result}, {requestId: 'fixture', result: {...response.result, token: 'wrong'}},
      {result: {...response.result, executed: false, admission: 'ALREADY_COMPLETE'}}]) {
      const held = plan.settle(claimed.next, bad);assert.strictEqual(held.state, 'HOLD');
      assert.strictEqual(plan.claim(held, v, key).ok, false);assert.throws(() => plan.settle(held, response));
    }
  }
  const spec = plan.specification(parent, request), prepared = plan.prepare(null, spec);
  for (const mutate of [v => {v.parentControl.state = 'HOLD';}, v => {v.parentControl.epoch++;}, v => {v.childControl.state = 'DRAINING';},
    v => {v.rollout.state = 'CLOSED';}, v => {v.rollout.revision = -1;}, v => {v.requestReceipt = null;},
    v => {v.tokenReceipt.status = 'UNKNOWN';}, v => {v.requestReceipt.status = v.tokenReceipt.status = 'UNKNOWN';},
    v => {v.requestReceipt.token = v.tokenReceipt.token = 'other';}, v => {v.parentControl.revision = Number.MAX_SAFE_INTEGER - 1;}]) {
    const v = view(spec);mutate(v);assert.strictEqual(plan.claim(prepared, v, key).ok, false);
    assert.strictEqual(prepared.state, 'PREPARED');
  }
  // Claim acknowledgement loss is NOT permission to send. A persisted CLAIMED
  // record remains occupied across restart; the pure planner offers no reclaim.
  const durableClaim = clone(plan.claim(prepared, view(spec), key).next);
  assert.strictEqual(plan.claim(durableClaim, view(spec), key).reason, 'NO_AUTOMATIC_RETRY');
  assert.strictEqual(plan.prepare(durableClaim, spec), null);
  const changed = plan.specification({...parent, token: 'changed'}, request);
  assert.strictEqual(changed.id, spec.id);assert.throws(() => plan.prepare(prepared, changed));
  for (const name of ['runGen1ShadowEod','runGen2ShadowEod','adminGateway','unknown']) assert.throws(() => plan.specification(parent, {...request, name}));
  assert.throws(() => plan.specification(parent, {...request, data: {...request.data, task_name: 'unknown'}}));
  assert.throws(() => plan.specification(parent, {...request, data: {...request.data, force: false}}));
  assert.throws(() => plan.specification({...parent, owner: 'old'}, request));
  console.log('Core dispatch transaction plans: parent COMPLETE + dual receipts + three fences, one claim, unknown HOLD PASS (MODEL_ONLY_NOT_WIRED)');
}
if (require.main === module) main();
module.exports = {main};
