'use strict';
// OFFLINE TRANSACTION PLAN ONLY. No storage adapter, scheduler or transport.
// Integration MUST commit all returned fences and the job atomically, and MUST
// receive a definite commit acknowledgement BEFORE sending the stored wire.
const assert = require('assert'), crypto = require('crypto');
const {isDeepStrictEqual} = require('util');
const admission = require('./writer-admission');
const entry = require('./writer-entry');
const {canonical} = require('./writer-admission-cloudbase');
const {assertCoreWriters} = require('./runtime24-v3-core-scope');
const environment = 'tradingview-etf-d0fa42yy57cbc11b';
const parentBinding = Object.freeze({environment, scope: 'production/adminGateway'});
const routes = Object.freeze({fetchDailyData: ['daily', 'fetchDailyData'], fetchRealtimeData: ['realtime'],
  fetchFundamentalNews: ['news'], extractFundamental: ['extract']});
assertCoreWriters(Object.keys(routes));
const clone = x => JSON.parse(JSON.stringify(x));
const hash = x => crypto.createHash('sha256').update(canonical(x)).digest('hex');
const text = x => typeof x === 'string' && /^[A-Za-z0-9_:./|#@+-]{1,200}$/.test(x);
function plain(x) {assert(x && typeof x === 'object' && !Array.isArray(x));assert(isDeepStrictEqual(clone(x), x));}
function specification(parent, request) {
  plain(parent);plain(request);
  assert.deepStrictEqual(Object.keys(parent).sort(), ['environment', 'epoch', 'owner', 'request_id', 'scope', 'token']);
  assert(parent.environment === environment && parent.scope === parentBinding.scope && parent.owner === 'new');
  assert(Number.isSafeInteger(parent.epoch) && parent.epoch >= 0 && text(parent.request_id) && text(parent.token));
  assert.deepStrictEqual(Object.keys(request).sort(), ['data', 'name']);
  assert(Object.hasOwn(routes, request.name), 'only four declared Core dispatch targets');
  assertCoreWriters([request.name]);plain(request.data);
  assert.deepStrictEqual(Object.keys(request.data).sort(), ['force', 'task_name']);
  assert.strictEqual(request.data.force, true);assert(routes[request.name].includes(request.data.task_name), 'reviewed task alias required');
  const request_id = entry.childRequest({parent_request_id: parent.request_id, producer: 'adminGateway', action: 'dispatch/' + request.name});
  return {schema: 1, id: 'dispatch:' + hash([parentBinding, parent.request_id, request.name]), parent: clone(parent),
    target: request.name, request_id, business: clone(request.data)};
}
function validate(job) {
  plain(job);const spec = specification(job.spec.parent, {name: job.spec.target, data: job.spec.business});
  assert(isDeepStrictEqual(spec, job.spec));
  assert.deepStrictEqual(Object.keys(job).sort(), ['attempt', 'revision', 'spec', 'state', 'wire']);
  assert(Number.isSafeInteger(job.revision) && job.revision >= 0 && job.revision < Number.MAX_SAFE_INTEGER);
  assert(['PREPARED', 'CLAIMED', 'COMPLETE', 'HOLD'].includes(job.state));
  assert.strictEqual(job.revision, {PREPARED: 0, CLAIMED: 1, COMPLETE: 2, HOLD: 2}[job.state]);
  assert.strictEqual(job.attempt, job.state === 'PREPARED' ? 0 : 1);
  if (job.state === 'PREPARED') assert.strictEqual(job.wire, null);
  else {
    plain(job.wire);assert.strictEqual(job.wire.request_id, spec.request_id);assert.strictEqual(job.wire.target, spec.target + 'Node24');
    assert.strictEqual(job.wire.environment, environment);assert.strictEqual(job.wire.scope, 'production/' + spec.target);
    assert.strictEqual(job.wire.owner, 'new');assert(isDeepStrictEqual(job.wire.business, spec.business));
    assert(text(job.wire.token) && Number.isSafeInteger(job.wire.epoch));
  }
  return job;
}
function prepare(current, spec) {
  const verified = specification(spec.parent, {name: spec.target, data: spec.business});assert(isDeepStrictEqual(spec, verified));
  if (current) {validate(current);assert(isDeepStrictEqual(current.spec, spec), 'same operation/target changed its payload');return null;}
  return validate({spec: clone(spec), revision: 0, state: 'PREPARED', attempt: 0, wire: null});
}
function claim(current, view, childKey) {
  validate(current);const deny = reason => ({ok: false, reason});
  if (current.state !== 'PREPARED') return deny('NO_AUTOMATIC_RETRY');
  try {
    // The future adapter must read these records inside the SAME transaction.
    // Writing all three fence records creates conflicts against owner/epoch,
    // maintenance and competing child admission changes, not just snapshot reads.
    const {parentControl, childControl, requestReceipt, tokenReceipt, rollout} = view;
    const childBinding = {environment, scope: 'production/' + current.spec.target};
    admission.validate(parentControl, parentBinding);admission.validate(childControl, childBinding);
    const p = current.spec.parent;
    assert(parentControl.owner === p.owner && parentControl.epoch === p.epoch && parentControl.state === 'ACTIVE' && !parentControl.active);
    assert(childControl.owner === 'new' && childControl.state === 'ACTIVE' && !childControl.active);
    assert(parentControl.receipts.length === 0 && childControl.receipts.length === 0, 'journal V2 controls required');
    assert(isDeepStrictEqual(requestReceipt, tokenReceipt), 'both permanent parent receipt indexes must agree');
    for (const [key, value] of Object.entries(p)) assert.strictEqual(requestReceipt[key], value);
    assert.strictEqual(requestReceipt.status, 'COMPLETE', 'never dispatch before the parent is durably complete');
    assert.deepStrictEqual(Object.keys(rollout).sort(), ['environment', 'revision', 'schema', 'scope', 'state']);
    assert(rollout.schema === 1 && rollout.environment === environment && rollout.scope === 'production/writer-rollout' && rollout.state === 'OPEN');
    for (const row of [parentControl, childControl, rollout]) assert(Number.isSafeInteger(row.revision) && row.revision >= 0 && row.revision < Number.MAX_SAFE_INTEGER - 1);
    const parentFence = {...clone(parentControl), revision: parentControl.revision + 1};
    const childFence = {...clone(childControl), revision: childControl.revision + 1};
    const rolloutFence = {...clone(rollout), revision: rollout.revision + 1};
    const wire = entry.seal({binding: childBinding, control: childFence, target: current.spec.target + 'Node24',
      request_id: current.spec.request_id, business: current.spec.business, key: childKey});
    const next = validate({...clone(current), state: 'CLAIMED', attempt: 1, revision: current.revision + 1, wire});
    return {ok: true, next, parentFence, childFence, rolloutFence};
  } catch (_) {return deny('DISPATCH_GATE_CLOSED');}
}
function settle(current, response) {
  validate(current);assert.strictEqual(current.state, 'CLAIMED', 'terminal/unknown jobs cannot be reset or re-submitted');
  let complete = false;
  try {
    assert(response && !response.code && typeof response.requestId === 'string' && response.requestId.length && response.result);
    const r = response.result, w = current.wire;
    assert.strictEqual(r.protocol, 'writer-result-v1');
    for (const key of ['request_id', 'token', 'owner', 'epoch']) assert.strictEqual(r[key], w[key]);
    assert(r.executed === true && r.outcome === 'COMPLETE' && Object.hasOwn(r, 'result'));
    complete = true; // Business ok:false is still a completed invocation.
  } catch (_) { /* No result, mismatch, duplicate or denial: hold for reconciliation. */ }
  return validate({...clone(current), revision: current.revision + 1, state: complete ? 'COMPLETE' : 'HOLD'});
}
module.exports = {environment, parentBinding, routes, specification, validate, prepare, claim, settle};
