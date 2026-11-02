'use strict';
// OFFLINE ENTRY CANDIDATE. No production import, SDK init, secrets or cloud I/O.
const assert = require('assert');
const crypto = require('crypto');
const {isDeepStrictEqual} = require('util');
const v1 = require('./writer-admission');
const journal = require('./writer-admission-journal');
const {canonical} = require('./writer-admission-cloudbase');
const text = x => typeof x === 'string' && /^[A-Za-z0-9_:./|#@+-]{1,200}$/.test(x);
const hash = x => crypto.createHash('sha256').update(canonical(x)).digest('hex');
function json(x) {
  const value = JSON.parse(JSON.stringify(x));
  assert(isDeepStrictEqual(value, x), 'plain JSON required'); return value;
}
function bindingCheck(b) {
  assert(b && text(b.environment) && text(b.scope));
  assert.deepStrictEqual(Object.keys(b).sort(), ['environment', 'scope']);
}
function scheduledRequest({environment, producer, trigger_name, scheduled_for}) {
  assert(text(environment) && text(producer) && text(trigger_name));
  assert(typeof scheduled_for === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(scheduled_for));
  const slot = new Date(scheduled_for).toISOString();
  assert(slot.replace('.000Z', 'Z') === scheduled_for.replace('.000Z', 'Z'), 'invalid schedule instant');
  // The source adapter must prove this is the scheduled occurrence. No clock,
  // trade-date, attempt counter or unverified platform Time fallback here.
  return 'scheduled:' + hash([environment, producer, trigger_name, slot]);
}
function manualRequest({environment, producer, action, operation_id}) {
  assert([environment, producer, action, operation_id].every(text), 'stable upstream operation ID required');
  return 'manual:' + hash([environment, producer, action, operation_id]);
}
function childRequest({parent_request_id, producer, action}) {
  assert([parent_request_id, producer, action].every(text));
  return 'child:' + hash([parent_request_id, producer, action]);
}
function keyCheck(key) { assert(Buffer.isBuffer(key) && key.length >= 32, 'signing key required'); }
const mac = (body, key) => crypto.createHmac('sha256', key).update(canonical(body)).digest('hex');
function seal({binding, control, target, request_id, business, key}) {
  bindingCheck(binding); keyCheck(key); v1.validate(control, binding);
  assert(text(target) && text(request_id));
  const payload = json(business); assert(payload && typeof payload === 'object' && !Array.isArray(payload));
  const body = {protocol: 'writer-entry-v1', ...binding, target, owner: control.owner, epoch: control.epoch,
    revision: control.revision, request_id, token: hash([binding, request_id, payload]), business: payload};
  return {...body, signature: mac(body, key)};
}
function authenticate(event, {binding, target, owner, key}) {
  assert(event && typeof event === 'object' && !Array.isArray(event));
  const wire = {...event};
  // Only the empty metadata already observed in D-022/D-024 is tolerated.
  for (const k of ['tcbContext', 'userInfo']) if (Object.prototype.hasOwnProperty.call(wire, k)) {
    assert.deepStrictEqual(wire[k], {}); delete wire[k];
  }
  assert.deepStrictEqual(Object.keys(wire).sort(), ['business', 'environment', 'epoch', 'owner', 'protocol', 'request_id', 'revision', 'scope', 'signature', 'target', 'token']);
  const {signature, ...body} = wire;
  assert(typeof signature === 'string' && /^[a-f0-9]{64}$/.test(signature));
  assert(crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(mac(body, key), 'hex')));
  assert(body.protocol === 'writer-entry-v1' && body.environment === binding.environment && body.scope === binding.scope);
  assert(body.target === target && body.owner === owner && text(body.request_id) && text(body.token));
  assert(Number.isSafeInteger(body.epoch) && body.epoch >= 0 && Number.isSafeInteger(body.revision) && body.revision >= 0);
  json(body.business); return body;
}
function createWorker({store, binding, target, owner, key, runtimeIdentity, loadMain}) {
  bindingCheck(binding); keyCheck(key); key = Buffer.from(key);
  binding = {...binding};
  assert(text(target) && ['old', 'new'].includes(owner));
  assert(typeof runtimeIdentity === 'function' && typeof loadMain === 'function');
  return async (event, context) => {
    let wire;
    try {
      const runtime = await runtimeIdentity(context);
      assert(runtime.environment === binding.environment && runtime.function_name === target);
      assert.strictEqual(runtime.node_major, owner === 'new' ? 24 : 16, 'wrong worker runtime');
      wire = authenticate(event, {binding, target, owner, key});
    } catch (_) { return {protocol: 'writer-result-v1', executed: false, admission: 'ENTRY_AUTHENTICATION_FAILED'}; }
    const identity = {owner: wire.owner, epoch: wire.epoch, revision: wire.revision, request_id: wire.request_id, token: wire.token};
    let definiteConflict = false;
    const observedStore = {read: b => store.read(b), async transaction(...args) {
      try { return await store.transaction(...args); }
      catch (error) {
        // D-024 qualified this specific platform abort code. Never infer an
        // abort from a timeout, lost acknowledgement, or a generic exception.
        if (error && error.code === 'DATABASE_TRANSACTION_CONFLICT') definiteConflict = true;
        throw error;
      }
    }};
    const result = await journal.execute(observedStore, binding, identity, async () => {
      // Import the entire original business entry only AFTER admission commit.
      const main = await loadMain(); assert.strictEqual(typeof main, 'function');
      return main(wire.business, context);
    });
    if (result.executed === false && definiteConflict) result.admission = 'TRANSACTION_CONFLICT';
    return {protocol: 'writer-result-v1', request_id: wire.request_id, token: wire.token, owner, epoch: wire.epoch, ...result};
  };
}
function budgetCheck(budget) {
  assert(budget && ['worker_ms', 'transport_ms', 'facade_ms', 'reserve_ms'].every(k => Number.isSafeInteger(budget[k]) && budget[k] > 0));
  assert(budget.worker_ms + budget.reserve_ms < budget.transport_ms);
  assert(budget.transport_ms + budget.reserve_ms < budget.facade_ms, 'nested call budget unsafe');
}
function createFacade({store, binding, targets, key, identify, callFunction, budget}) {
  bindingCheck(binding); keyCheck(key); key = Buffer.from(key); budgetCheck(budget);
  assert(targets && text(targets.old) && text(targets.new) && targets.old !== targets.new);
  targets = {...targets}; budget = {...budget}; binding = {...binding};
  assert(typeof identify === 'function' && typeof callFunction === 'function');
  async function hold(dispatched) {
    try {
      const s = await store.read(binding); v1.validate(s, binding);
      if (s.owner !== dispatched.owner || s.epoch !== dispatched.epoch) return false;
      if (s.state === 'HOLD') return true;
      return (await journal.apply(store, binding, {type: 'hold', revision: s.revision})).ok;
    } catch (_) { return false; }
  }
  return async (event, context) => {
    let id, control, wire;
    try {
      id = await identify(event, context);
      assert(id && text(id.request_id));
      assert(id.business && typeof id.business === 'object' && !Array.isArray(id.business)); json(id.business);
    } catch (_) { return {ok: false, error_code: 'WRITER_IDENTITY_UNAVAILABLE'}; }
    try {
      control = await store.read(binding); v1.validate(control, binding);
      if (control.state !== 'ACTIVE' || control.active) return {ok: false, error_code: 'WRITER_ADMISSION_CLOSED', request_id: id.request_id};
      wire = seal({binding, control, target: targets[control.owner], request_id: id.request_id, business: id.business, key});
    } catch (_) { return {ok: false, error_code: 'WRITER_CONTROL_UNAVAILABLE', request_id: id.request_id}; }
    const unknown = async () => ({ok: false, error_code: 'WRITER_EXECUTION_UNKNOWN', request_id: id.request_id, hold_confirmed: await hold(control)});
    let result;
    try {
      // Exactly one target, one call; no timeout fallback or automatic retry.
      const response = await callFunction({name: wire.target, data: wire}, {timeout: budget.transport_ms, retryOptions: {retries: 0}});
      assert(response && !response.code && Object.prototype.hasOwnProperty.call(response, 'result'));
      result = response.result;
      assert(result && result.protocol === 'writer-result-v1' && result.request_id === wire.request_id && result.token === wire.token
        && result.owner === wire.owner && result.epoch === wire.epoch);
    } catch (_) { return unknown(); }
    if (result.executed === true && result.outcome === 'COMPLETE' && Object.prototype.hasOwnProperty.call(result, 'result'))
      return result.result; // SDK wrapper and admission wrapper removed exactly once.
    if (result.executed === false && typeof result.admission === 'string') {
      if (/UNAVAILABLE|AMBIGUOUS/.test(result.admission)) return unknown();
      return {ok: false, error_code: 'WRITER_ADMISSION_DENIED', request_id: id.request_id, reason: result.admission};
    }
    return unknown();
  };
}
module.exports = {scheduledRequest, manualRequest, childRequest, seal, createWorker, createFacade, budgetCheck};
