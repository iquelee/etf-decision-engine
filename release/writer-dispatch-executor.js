'use strict';
// Offline one-attempt executor candidate. No Timer/query loop, SDK init or
// retries. A crash after durable claim deliberately needs reconciliation.
const assert = require('assert');
const plan = require('./writer-dispatch-plan');
const entry = require('./writer-entry');
const clone = x => JSON.parse(JSON.stringify(x));
function createExecutor({store, callFunction, readKey, runtimeIdentity, transportTimeoutMs, reservation}) {
  assert(store && ['read', 'claim', 'settle'].every(k => typeof store[k] === 'function'));
  assert([callFunction, readKey, runtimeIdentity].every(fn => typeof fn === 'function'));
  assert(Number.isSafeInteger(transportTimeoutMs) && transportTimeoutMs > 0 && transportTimeoutMs <= 135000, 'explicit qualified transport budget required');
  if (reservation !== undefined) reservation = clone(reservation);
  const execute = async id => {
    let job, key, claimed;
    try {
      const runtime = await runtimeIdentity();
      assert(runtime && runtime.environment === plan.environment && runtime.node_major === 24 &&
        runtime.function_name === 'writerDispatchNode24' && runtime.trigger_source === 'timer', 'trusted dispatcher runtime required');
      job = await store.read(id);
      if (!job) return {sent: false, reason: 'JOB_NOT_FOUND'};
      plan.validate(job);
      if (job.state !== 'PREPARED') return {sent: false, reason: 'NO_AUTOMATIC_RETRY', state: job.state};
      key = await readKey(job.spec.target);assert(Buffer.isBuffer(key) && key.length === 32);key = Buffer.from(key);
      const result = await store.claim(id, key, reservation);
      if (!result || result.acknowledged !== true) return {sent: false, reason: 'CLAIM_NOT_ACKNOWLEDGED'};
      if (result.claimed !== true) return {sent: false, reason: result.reason};
      claimed = result.job;plan.validate(claimed);assert.strictEqual(claimed.state, 'CLAIMED');
      assert.strictEqual(claimed.spec.id, id);
      if (reservation !== undefined) {
        assert.deepStrictEqual(result.reservation, {cycle_id: reservation.cycle_id, revision: reservation.revision + 1});
        reservation = clone(result.reservation);
      }
      assert.deepStrictEqual(claimed.spec, job.spec);
      entry.authenticate(claimed.wire, {binding: {environment: plan.environment, scope: 'production/' + job.spec.target},
        target: job.spec.target + 'Node24', owner: 'new', key});
    } catch (_) {return {sent: false, reason: 'CLAIM_UNAVAILABLE_OR_UNKNOWN', reconciliation_required: true};}
    // There is exactly one transport call, only after a definite durable claim.
    // Never catch-and-resend, retarget, or infer send permission from readback.
    let response;
    try {
      response = await callFunction({name: claimed.wire.target, data: clone(claimed.wire)},
        {timeout: transportTimeoutMs, retryOptions: {retries: 0}});
    } catch (_) {response = null;}
    try {
      const result = await store.settle(claimed, response, key);
      assert(result && result.acknowledged === true && result.job && ['COMPLETE', 'HOLD'].includes(result.job.state));
      plan.validate(result.job);assert.deepStrictEqual(result.job.spec, claimed.spec);assert.deepStrictEqual(result.job.wire, claimed.wire);
      return {sent: true, settled: true, state: result.job.state, hold_confirmed: result.hold_confirmed};
    } catch (_) {return {sent: true, settled: false, reason: 'SETTLE_UNAVAILABLE_OR_UNKNOWN', reconciliation_required: true};}
  };
  execute.reservation = () => reservation === undefined ? undefined : clone(reservation);
  return execute;
}
module.exports = {createExecutor};
