'use strict';
// In-process root -> authenticated worker. No SDK invocation or timeout budget.
const assert = require('assert');
const protocol = require('./writer-admission');
const journal = require('./writer-admission-journal');
const {seal} = require('./writer-entry');
function createLocalRoot({store, binding, target, owner, key, identify, runtimeIdentity, worker}) {
  assert(binding && typeof binding.environment === 'string' && typeof binding.scope === 'string');
  assert.deepStrictEqual(Object.keys(binding).sort(), ['environment', 'scope']);binding = {...binding};
  assert(typeof target === 'string' && ['old', 'new'].includes(owner));
  assert(Buffer.isBuffer(key) && key.length >= 32);key = Buffer.from(key);
  assert([identify, runtimeIdentity, worker].every(fn => typeof fn === 'function'));
  async function hold(dispatched) {
    try {
      const current = await store.read(binding);protocol.validate(current, binding);
      if (current.owner !== dispatched.owner || current.epoch !== dispatched.epoch) return false;
      if (current.state === 'HOLD') return true;
      return (await journal.apply(store, binding, {type: 'hold', revision: current.revision})).ok;
    } catch (_) {return false;}
  }
  return async (event, context) => {
    let identity, control, wire;
    try {
      const runtime = await runtimeIdentity(context);
      assert(runtime.environment === binding.environment && runtime.function_name === target && runtime.node_major === (owner === 'new' ? 24 : 16));
      identity = await identify(event, context);
      assert(identity && typeof identity.request_id === 'string' && identity.business && typeof identity.business === 'object');
    } catch (_) {return {ok: false, error_code: 'WRITER_IDENTITY_UNAVAILABLE'};}
    try {
      control = await store.read(binding);protocol.validate(control, binding);
      if (control.owner !== owner || control.state !== 'ACTIVE' || control.active)
        return {ok: false, error_code: 'WRITER_ADMISSION_CLOSED', request_id: identity.request_id};
      wire = seal({binding, control, target, request_id: identity.request_id, business: identity.business, key});
    } catch (_) {return {ok: false, error_code: 'WRITER_CONTROL_UNAVAILABLE', request_id: identity.request_id};}
    const unknown = async () => ({ok: false, error_code: 'WRITER_EXECUTION_UNKNOWN', request_id: identity.request_id,
      hold_confirmed: await hold(control)});
    let result;
    try {
      result = await worker(wire, context);
      assert(result && result.protocol === 'writer-result-v1' && result.request_id === wire.request_id && result.token === wire.token &&
        result.owner === wire.owner && result.epoch === wire.epoch);
    } catch (_) {return unknown();}
    if (result.executed === true && result.outcome === 'COMPLETE' && Object.hasOwn(result, 'result')) return result.result;
    if (result.executed === false && typeof result.admission === 'string') {
      if (/UNAVAILABLE|AMBIGUOUS/.test(result.admission)) return unknown();
      return {ok: false, error_code: 'WRITER_ADMISSION_DENIED', request_id: wire.request_id, reason: result.admission};
    }
    return unknown();
  };
}
module.exports = {createLocalRoot};
