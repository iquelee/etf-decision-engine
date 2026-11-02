'use strict';
const assert = require('assert');
const {request, verifyReadback} = require('../release/entry-proof-async-config');
for (const role of ['root', 'worker']) {
  const num = role === 'root' ? 1 : 0;
  const body = request(role);
  assert.deepStrictEqual(body.AsyncTriggerConfig, {MsgTTL: 600, RetryConfig: [{RetryNum: num}]});
  assert.strictEqual(body.FunctionName, role === 'root' ? 'writerEntryFacade24' : 'writerEntryWorker24');
  const response = {data: {AsyncTriggerConfig: {MsgTTL: 600, RetryConfig: [
    {ErrorCode: ['default'], RetryNum: num, RetryInterval: 60},
    {ErrorCode: ['432'], RetryNum: -1, RetryInterval: 60}]}, RequestId: 'synthetic'}};
  const parsed = verifyReadback(role, response);
  assert.strictEqual(parsed.resource_retry_num, -1);
  assert.strictEqual(parsed.hard_total_invocation_bound, false);
  assert.strictEqual(parsed.native_update_acceptance_proven, false);
  assert.throws(() => verifyReadback(role, {data: response.data.AsyncTriggerConfig}), /nested/);
  const mutations = [
    r => {r.data.AsyncTriggerConfig.MsgTTL = 21600;},
    r => {r.data.AsyncTriggerConfig.RetryConfig[0].RetryNum = 2;},
    r => {r.data.AsyncTriggerConfig.RetryConfig[1].RetryNum = 0;},
    r => {r.data.AsyncTriggerConfig.RetryConfig[1].ErrorCode = ['default'];},
    r => {r.data.AsyncTriggerConfig.RetryConfig[1].ErrorCode = ['unknown'];},
    r => {r.data.AsyncTriggerConfig.RetryConfig[1].RetryInterval = 30;},
    r => {r.data.AsyncTriggerConfig.RetryConfig[1].Extra = true;},
    r => {r.error = {code: 'InvalidParameterValue.AsyncTriggerConfig'};}
  ];
  for (const mutate of mutations) {
    const changed = JSON.parse(JSON.stringify(response)); mutate(changed);
    assert.throws(() => verifyReadback(role, changed));
  }
  body.AsyncTriggerConfig.RetryConfig[0].RetryNum = 99;
  assert.strictEqual(request(role).AsyncTriggerConfig.RetryConfig[0].RetryNum, num, 'fresh independent payload');
}
assert.throws(() => request('runDecisionEngine'));
assert.throws(() => request('__proto__'));
console.log('PASS: public input/readback split, nested envelope, resource-policy mismatch and malformed-readback rejection (memory only)');
