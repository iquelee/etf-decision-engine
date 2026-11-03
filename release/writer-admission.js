'use strict';
// OFFLINE PROTOTYPE. No CloudBase adapter, timer, TTL takeover or production import.
const assert = require('assert');
const copy = value => JSON.parse(JSON.stringify(value));
const text = value => typeof value === 'string' && /^[A-Za-z0-9_:./|#@+-]{1,200}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const MAX_RECEIPTS = 128; // Fail closed at capacity; never evict dedup evidence.

function validate(s, binding) {
  assert(s && s.schema === 1 && s.environment === binding.environment && s.scope === binding.scope);
  assert(text(s.environment) && text(s.scope));
  assert(integer(s.revision) && s.revision < Number.MAX_SAFE_INTEGER);
  assert(integer(s.epoch) && s.epoch < Number.MAX_SAFE_INTEGER);
  assert(['old', 'new'].includes(s.owner) && ['ACTIVE', 'DRAINING', 'HOLD'].includes(s.state));
  assert(Array.isArray(s.receipts) && s.receipts.length <= MAX_RECEIPTS);
  const ids = new Set(), tokens = new Set();
  for (const r of s.receipts) {
    assert(text(r.request_id) && text(r.token) && ['RUNNING', 'COMPLETE', 'UNKNOWN'].includes(r.status));
    assert(!ids.has(r.request_id) && !tokens.has(r.token)); ids.add(r.request_id); tokens.add(r.token);
  }
  const unfinished = s.receipts.filter(r => r.status !== 'COMPLETE');
  if (s.active === null) assert(unfinished.length === 0);
  else {
    const a = s.active;
    assert(a && a.owner === s.owner && a.epoch === s.epoch && text(a.token) && text(a.request_id));
    assert(unfinished.length === 1 && unfinished[0].token === a.token && unfinished[0].request_id === a.request_id);
    if (unfinished[0].status === 'UNKNOWN') assert(s.state === 'HOLD');
  }
}

function initial(binding) {
  const s = {schema: 1, environment: binding.environment, scope: binding.scope,
    revision: 0, epoch: 0, owner: 'old', state: 'HOLD', active: null, receipts: []};
  validate(s, binding); return s;
}

function transition(snapshot, action, binding) {
  try { validate(snapshot, binding); } catch (_) { return {ok: false, reason: 'INVALID_CONTROL'}; }
  if (!action || action.revision !== snapshot.revision) return {ok: false, reason: 'STALE_REVISION'};
  if (snapshot.revision >= Number.MAX_SAFE_INTEGER - 1) return {ok: false, reason: 'REVISION_EXHAUSTED'};
  const s = copy(snapshot), reject = reason => ({ok: false, reason});
  switch (action.type) {
    case 'admit': {
      if (!text(action.request_id) || !text(action.token)) return reject('INVALID_IDENTITY');
      if (action.owner !== s.owner || action.epoch !== s.epoch) return reject('WRONG_OWNER_EPOCH');
      const seen = s.receipts.find(r => r.request_id === action.request_id);
      if (seen) return reject(seen.status === 'COMPLETE' ? 'ALREADY_COMPLETE' : 'IN_FLIGHT_OR_UNKNOWN');
      if (s.receipts.some(r => r.token === action.token)) return reject('TOKEN_REUSED');
      if (s.state !== 'ACTIVE') return reject('ADMISSION_CLOSED');
      if (s.active) return reject('BUSY');
      if (s.receipts.length === MAX_RECEIPTS) return reject('RECEIPT_CAPACITY');
      s.active = {owner: s.owner, epoch: s.epoch, request_id: action.request_id, token: action.token};
      s.receipts.push({request_id: action.request_id, token: action.token, status: 'RUNNING'});
      break;
    }
    case 'finish':
    case 'unknown': {
      const a = s.active;
      if (!a || action.owner !== a.owner || action.epoch !== a.epoch
        || action.token !== a.token || action.request_id !== a.request_id) return reject('STALE_EXECUTION');
      const r = s.receipts.find(row => row.token === a.token);
      if (action.type === 'finish') { r.status = 'COMPLETE'; s.active = null; }
      else { r.status = 'UNKNOWN'; s.state = 'HOLD'; }
      break;
    }
    case 'drain':
      if (s.state !== 'ACTIVE') return reject('NOT_ACTIVE');
      s.state = 'DRAINING'; break;
    case 'hold':
      s.state = 'HOLD'; break;
    case 'activate': {
      const p = action.proof;
      if (s.epoch >= Number.MAX_SAFE_INTEGER - 1) return reject('EPOCH_EXHAUSTED');
      if (!['old', 'new'].includes(action.owner) || s.state === 'ACTIVE') return reject('NOT_DRAINED');
      if (s.active) return reject('BUSY');
      // Evidence must be supplied by a separately qualified operator. These
      // booleans are requirements, not a platform proof implemented by this model.
      if (!p || !text(p.reference) || p.entries_closed !== true || p.executions_terminal !== true
        || p.retries_accounted_for !== true) return reject('DRAIN_PROOF_REQUIRED');
      s.owner = action.owner; s.epoch++; s.state = 'ACTIVE'; break;
    }
    default: return reject('UNKNOWN_ACTION');
  }
  s.revision++; validate(s, binding);
  return {ok: true, reason: 'TRANSITION', next: s};
}

async function apply(store, binding, action) {
  try {
    const snapshot = await store.read();
    const result = transition(snapshot, action, binding);
    if (!result.ok) return result;
    // One attempt only. A false/throw/ambiguous acknowledgement never executes work.
    if (await store.compareAndSet(snapshot, result.next) !== true) return {ok: false, reason: 'CAS_REJECTED'};
    return result;
  } catch (_) { return {ok: false, reason: 'CONTROL_UNAVAILABLE_OR_AMBIGUOUS'}; }
}

async function execute(store, binding, identity, handler) {
  const admitted = await apply(store, binding, {...identity, type: 'admit'});
  if (!admitted.ok) return {executed: false, admission: admitted.reason};
  // Keep the occupied slot on any unknown outcome; no finally/unconditional release.
  let result;
  try { result = await handler(); }
  catch (_) {
    let snapshot;
    try { snapshot = await store.read(); } catch (_) { return {executed: true, outcome: 'UNKNOWN'}; }
    await apply(store, binding, {...identity, revision: snapshot && snapshot.revision, type: 'unknown'});
    return {executed: true, outcome: 'UNKNOWN'};
  }
  let snapshot;
  try { snapshot = await store.read(); } catch (_) { return {executed: true, outcome: 'UNKNOWN', result}; }
  const finished = await apply(store, binding, {...identity, revision: snapshot && snapshot.revision, type: 'finish'});
  return {executed: true, outcome: finished.ok ? 'COMPLETE' : 'UNKNOWN', result};
}

module.exports = {initial, validate, transition, apply, execute, MAX_RECEIPTS};
