'use strict';
// OFFLINE V2 CONTRACT ONLY. No production adapter/import or automatic migration.
const v1 = require('./writer-admission');
const copy = value => JSON.parse(JSON.stringify(value));

// store.transaction(binding, callback) must be serializable across control and
// BOTH unique receipt indexes (request_id and token). The synchronous callback
// receives a consistent view; {control, receipt} commits atomically or not at all.
// A receipt replaces only its own RUNNING/UNKNOWN row; COMPLETE is permanent.
// A true acknowledgement means the entire commit is durable. Never emulate this
// contract with separate document writes, TTL, or a process-local mutex in cloud.
async function apply(store, binding, action) {
  try {
    let answer;
    const acknowledged = await store.transaction(binding, view => {
      const snapshot = copy(view.control);
      v1.validate(snapshot, binding);
      // V2 control retains only the occupied slot. Historical rows live in the
      // journal forever, including across cold starts and owner epoch changes.
      if (snapshot.receipts.some(row => row.status === 'COMPLETE')) throw Error('unmigrated control');
      if (action && action.type === 'admit') {
        const seen = view.findRequest(action.request_id);
        const token = view.findToken(action.token);
        if (seen || token) {
          answer = {ok: false, reason: seen ? (seen.status === 'COMPLETE' ? 'ALREADY_COMPLETE' : 'IN_FLIGHT_OR_UNKNOWN') : 'TOKEN_REUSED'};
          return null;
        }
      }
      if (snapshot.active) {
        const receipt = view.findRequest(snapshot.active.request_id);
        const token = view.findToken(snapshot.active.token);
        if (!receipt || !token || receipt.token !== snapshot.active.token || token.request_id !== snapshot.active.request_id
          || receipt.owner !== snapshot.owner || receipt.epoch !== snapshot.epoch
          || receipt.status !== snapshot.receipts[0].status || token.status !== receipt.status) throw Error('journal mismatch');
      }
      answer = v1.transition(snapshot, action, binding);
      if (!answer.ok) return null;
      const next = answer.next;
      const changed = ['admit', 'finish', 'unknown'].includes(action.type);
      const row = changed ? next.receipts.find(r => r.request_id === action.request_id) : null;
      const receipt = row ? {...row, environment: binding.environment, scope: binding.scope,
        owner: snapshot.owner, epoch: snapshot.epoch} : null;
      next.receipts = next.receipts.filter(r => r.status !== 'COMPLETE');
      v1.validate(next, binding);
      return {control: next, receipt};
    }, {request_id: action && action.request_id, token: action && action.token});
    if (acknowledged !== true) return {ok: false, reason: 'TRANSACTION_UNAVAILABLE_OR_AMBIGUOUS'};
    return answer || {ok: false, reason: 'INVALID_TRANSACTION_RESULT'};
  } catch (_) { return {ok: false, reason: 'TRANSACTION_UNAVAILABLE_OR_AMBIGUOUS'}; }
}

async function execute(store, binding, identity, handler) {
  const admission = await apply(store, binding, {...identity, type: 'admit'});
  if (!admission.ok) return {executed: false, admission: admission.reason};
  let result, terminal = true;
  try { result = await handler(); } catch (_) { terminal = false; }
  let completion;
  try {
    const snapshot = await store.read(binding);
    completion = await apply(store, binding, {...identity, revision: snapshot.revision, type: terminal ? 'finish' : 'unknown'});
  } catch (_) { /* occupied slot remains; no retry or unconditional release */ }
  return {executed: true, outcome: terminal && completion && completion.ok ? 'COMPLETE' : 'UNKNOWN', ...(terminal ? {result} : {})};
}

// Identity resolution is an injected TRUSTED entry adapter. Caller event fields
// alone cannot establish ownership, epoch, or a retry-stable request identity.
function createEntry({store, binding, resolveIdentity, main}) {
  if (typeof resolveIdentity !== 'function' || typeof main !== 'function') throw Error('entry dependencies required');
  return async (event, context) => {
    let identity;
    try { identity = await resolveIdentity(event, context); } catch (_) { return {executed: false, admission: 'IDENTITY_UNAVAILABLE'}; }
    if (!identity) return {executed: false, admission: 'IDENTITY_UNAVAILABLE'};
    return execute(store, binding, identity, () => main(event, context));
  };
}
module.exports = {initial: v1.initial, apply, execute, createEntry};
