'use strict';
// OFFLINE all-callers switch adapter. No SDK, default key, production import or
// cloud initialization. Capture trusted invocation identity before installing
// this one logical call adapter; never derive identity from business.from.
const assert = require('assert');
const {isDeepStrictEqual} = require('util');
const entry = require('./writer-entry');
const protocol = require('./writer-admission');
const journal = require('./writer-admission-journal');
const text = x => typeof x === 'string' && /^[A-Za-z0-9_:./|#@+-]{1,200}$/.test(x);
class WriterCallError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'WriterCallError'; this.code = code; Object.assign(this, details); }
}
function createDirectCaller({store, binding, key, logicalName, targets, callerName, callerNodeMajor,
  runtimeIdentity, resolveRequestId, callFunction, transportTimeoutMs, allowedOwners = ['old', 'new']}) {
  assert(binding && text(binding.environment) && text(binding.scope));
  assert.deepStrictEqual(Object.keys(binding).sort(), ['environment', 'scope']); binding = {...binding};
  assert(Buffer.isBuffer(key) && key.length >= 32); key = Buffer.from(key);
  assert(text(logicalName) && text(callerName) && [16, 24].includes(callerNodeMajor));
  assert(targets && text(targets.old) && text(targets.new) && targets.old !== targets.new);
  assert.deepStrictEqual(Object.keys(targets).sort(), ['new', 'old']); targets = {...targets};
  assert(Array.isArray(allowedOwners) && allowedOwners.length > 0 && allowedOwners.every(x => ['old', 'new'].includes(x))
    && new Set(allowedOwners).size === allowedOwners.length, 'qualified owner policy required');
  allowedOwners = Object.freeze([...allowedOwners]);
  assert([runtimeIdentity, resolveRequestId, callFunction].every(x => typeof x === 'function'));
  assert(Number.isSafeInteger(transportTimeoutMs) && transportTimeoutMs > 0 && transportTimeoutMs <= 135000);
  async function hold(dispatched) {
    try {
      const current = await store.read(binding); protocol.validate(current, binding);
      if (current.owner !== dispatched.owner || current.epoch !== dispatched.epoch) return false;
      if (current.state === 'HOLD') return true;
      return (await journal.apply(store, binding, {type: 'hold', revision: current.revision})).ok;
    } catch (_) { return false; }
  }
  return async (request, options = {}) => {
    let requestId, timeout, business;
    try {
      assert(request && request.name === logicalName);
      assert.deepStrictEqual(Object.keys(request).sort(), ['data', 'name']);
      assert(options && typeof options === 'object' && !Array.isArray(options));
      assert(Object.keys(options).every(k => ['timeout', 'retryOptions'].includes(k)));
      if (options.retryOptions !== undefined) assert.deepStrictEqual(options.retryOptions, {retries: 0});
      timeout = options.timeout === undefined ? transportTimeoutMs : options.timeout;
      assert(Number.isSafeInteger(timeout) && timeout > 0 && timeout <= 135000);
      business = JSON.parse(JSON.stringify(request.data));
      assert(business && typeof business === 'object' && !Array.isArray(business));
      assert(isDeepStrictEqual(business, request.data), 'plain business JSON required');
      const runtime = await runtimeIdentity();
      assert(runtime.environment === binding.environment && runtime.function_name === callerName && runtime.node_major === callerNodeMajor);
      // Intentionally no business/event argument: the enclosing authenticated
      // entry must capture a retry-stable parent/operation identity itself.
      requestId = await resolveRequestId(); assert(text(requestId));
    } catch (cause) {
      throw new WriterCallError('WRITER_CALLER_IDENTITY_UNAVAILABLE', 'writer caller identity unavailable', {cause});
    }
    let control, wire;
    try {
      control = await store.read(binding); protocol.validate(control, binding);
      if (control.state !== 'ACTIVE' || control.active)
        throw new WriterCallError('WRITER_ADMISSION_CLOSED', 'writer admission closed', {request_id: requestId});
      // A legacy business entry is not a signed worker merely because its
      // name occupies the old route. Refuse it before sealing or transport.
      if (!allowedOwners.includes(control.owner))
        throw new WriterCallError('WRITER_ADMISSION_DENIED', 'writer owner is not qualified for this route',
          {request_id: requestId, reason: 'OWNER_NOT_QUALIFIED'});
      wire = entry.seal({binding, control, target: targets[control.owner], request_id: requestId, business, key});
    } catch (cause) {
      if (cause instanceof WriterCallError) throw cause;
      throw new WriterCallError('WRITER_CONTROL_UNAVAILABLE', 'writer control unavailable', {request_id: requestId, cause});
    }
    async function unknown(cause) {
      throw new WriterCallError('WRITER_EXECUTION_UNKNOWN', cause && cause.message || 'writer execution outcome unknown',
        {request_id: requestId, hold_confirmed: await hold(control), ...(cause ? {cause} : {})});
    }
    let response, result;
    try {
      // One original caller -> selected worker call. No forwarding function,
      // retry, fallback, second target or business-deadline reduction.
      response = await callFunction({name: wire.target, data: wire}, {timeout, retryOptions: {retries: 0}});
      assert(response && !response.code && Object.prototype.hasOwnProperty.call(response, 'result'));
      result = response.result;
      assert(result && result.protocol === 'writer-result-v1' && result.request_id === wire.request_id
        && result.token === wire.token && result.owner === wire.owner && result.epoch === wire.epoch);
    } catch (cause) { return unknown(cause); }
    if (result.executed === true && result.outcome === 'COMPLETE' && Object.prototype.hasOwnProperty.call(result, 'result'))
      return {...response, result: result.result}; // Preserve the ORIGINAL SDK envelope and business value, including ok:false.
    if (result.executed === false && typeof result.admission === 'string') {
      if (/UNAVAILABLE|AMBIGUOUS/.test(result.admission)) return unknown();
      throw new WriterCallError('WRITER_ADMISSION_DENIED', 'writer admission denied: ' + result.admission,
        {request_id: requestId, reason: result.admission});
    }
    return unknown();
  };
}
module.exports = {createDirectCaller, WriterCallError};
