'use strict';
// OFFLINE early mutation gate for the actual admin entry. This closes NEW
// requests only. It is NOT execution admission/fencing or proof of draining.
const assert = require('assert');
const text = x => typeof x === 'string' && /^[A-Za-z0-9_:./|#@+-]{1,200}$/.test(x);
function potentialMutation(event = {}) {
  const method = (event.httpMethod || event.method || 'GET').toUpperCase();
  const path = (event.path || event.url || '/').replace(/^\/(apiGateway|adminGateway)/, '') || '/';
  // The original entry allows login without a POST-only check; GET + body
  // can therefore mutate login guards/password migration/session records.
  return path === '/api/admin/login' || (path.startsWith('/api/admin/') && method === 'POST');
}
function createAdminMaintenanceCheck({binding, readRollout}) {
  assert(binding && text(binding.environment) && text(binding.scope));
  assert.deepStrictEqual(Object.keys(binding).sort(), ['environment', 'scope']);binding = Object.freeze({...binding});
  assert(typeof readRollout === 'function');
  return async (event = {}) => {
    let mutation;
    try { mutation = potentialMutation(event); } catch (_) { return false; }
    if (mutation) {
      try {
        const rollout = await readRollout(binding);
        assert(rollout && rollout.schema === 1 && rollout.environment === binding.environment && rollout.scope === binding.scope);
        assert.deepStrictEqual(Object.keys(rollout).sort(), ['environment', 'revision', 'schema', 'scope', 'state']);
        assert(Number.isSafeInteger(rollout.revision) && rollout.revision >= 0 && ['OPEN', 'CLOSED'].includes(rollout.state));
        if (rollout.state !== 'OPEN') return false;
      } catch (_) { return false; }
    }
    return true;
  };
}
function createAdminMaintenanceEntry({binding, readRollout, loadMain}) {
  assert.strictEqual(typeof loadMain, 'function');
  const check = createAdminMaintenanceCheck({binding, readRollout});
  return async (event = {}, context = {}) => {
    if (!(await check(event))) return {code: 503, data: null, message: '写入维护中，请稍后重试'};
    const main = await loadMain();assert.strictEqual(typeof main, 'function');
    return main(event, context); // Original auth, validation, business and returns remain inside.
  };
}
module.exports = {potentialMutation, createAdminMaintenanceCheck, createAdminMaintenanceEntry};
