'use strict';
// Offline control-plane payloads only. No SDK, credentials or cloud requests.
const assert = require('assert');
const targets = {root: 'writerEntryFacade24', worker: 'writerEntryWorker24'};
const environment = 'tradingview-etf-d0fa42yy57cbc11b';
function request(role) {
  assert(Object.prototype.hasOwnProperty.call(targets, role), 'fixed isolated role required');
  // Public input RetryConfig declares RetryNum only. Readback ErrorCode and
  // RetryInterval must never be copied into this request.
  return {FunctionName: targets[role], Namespace: environment,
    AsyncTriggerConfig: {MsgTTL: 600, RetryConfig: [{RetryNum: role === 'root' ? 1 : 0}]}};
}
function verifyReadback(role, response) {
  const expected = request(role);
  assert(response && (!('code' in response) || response.code === 0) && !response.error);
  const config = response.data && response.data.AsyncTriggerConfig;
  assert(config && config.MsgTTL === expected.AsyncTriggerConfig.MsgTTL, 'missing/wrong nested AsyncTriggerConfig or TTL');
  assert(Array.isArray(config.RetryConfig) && config.RetryConfig.length === 2);
  const byCode = new Map();
  for (const row of config.RetryConfig) {
    assert.deepStrictEqual(Object.keys(row).sort(), ['ErrorCode', 'RetryInterval', 'RetryNum']);
    assert(Array.isArray(row.ErrorCode) && row.ErrorCode.length === 1);
    const code = row.ErrorCode[0];
    assert(['default', '432'].includes(code) && !byCode.has(code), 'unexpected/duplicate retry class');
    assert(row.RetryInterval === 60);
    byCode.set(code, row.RetryNum);
  }
  assert.strictEqual(byCode.get('default'), expected.AsyncTriggerConfig.RetryConfig[0].RetryNum);
  // Existing native readbacks expose system/resource-error retries separately.
  // The public write schema does not promise a switch to turn these off.
  assert.strictEqual(byCode.get('432'), -1, 'resource policy differs from explicit proposed scope');
  return {ttl_seconds: 600, default_retry_num: byCode.get('default'), resource_retry_num: -1,
    resource_retry_interval_seconds: 60, hard_total_invocation_bound: false,
    policy: 'RESOURCE_RETRIES_UNTIL_TTL_NOT_ZERO',
    native_update_acceptance_proven: false};
}
module.exports = {request, verifyReadback};
