'use strict';
// Offline native Timer adapter. Event Time retry stability still needs cloud proof.
const assert = require('assert');
const {scheduledRequest} = require('./writer-entry');
const policies = Object.freeze({
  fetchDailyData: Object.freeze({'dailyFetch-2200': '0 0 22 * * 1-5 *'}),
  materializeIndicators: Object.freeze({'dailyPipeline-0800': '0 0 8 * * 1-5 *'}),
  fetchRealtimeData: Object.freeze({'realtime-5min': '0 */5 9-15 * * 1-5 *'}),
  runGen1ShadowEod: Object.freeze({'gen1-eod-weekdays-2220': '0 20 22 * * 1-5 *'}),
  runGen2ShadowEod: Object.freeze({'gen2-eod-weekdays-2230': '0 30 22 * * 1-5 *'}),
  fetchFundamentalNews: Object.freeze({'newsFetch-1630': '0 30 16 * * 1-5 *', 'intelFetch-30min': '0 0,30 8-22 * * * *'}),
  extractFundamental: Object.freeze({'newsExtract-1640': '0 40 16 * * 1-5 *', 'intelExtract-30min': '0 5,35 8-22 * * * *'})
});
const message = 'writer-root-timer-v1';
// Observed SCF ListTriggers on 2026-11-03: Gen2 runs in explicit REPLAY mode.
// Its actual entry parses Message as JSON. Preserve that business contract;
// never replace it with a generic marker or silently change REPLAY to LIVE.
const gen2Message = '{"mode":"REPLAY"}';
function messageFor(producer) {
  assert(Object.hasOwn(policies, producer), 'native timer producer required');
  return producer === 'runGen2ShadowEod' ? gen2Message : message;
}
function matches(cron, time) {
  // Only the reviewed numeric subset used by the fixed policies above.
  // No generic user-supplied cron parser or ambiguous day/week OR inference.
  const fields = cron.split(' '), local = new Date(time.getTime() + 8 * 3600000);
  const values = [local.getUTCSeconds(), local.getUTCMinutes(), local.getUTCHours(), local.getUTCDate(),
    local.getUTCMonth() + 1, local.getUTCDay(), local.getUTCFullYear()];
  return fields.every((field, i) => field === '*' || field.split(',').some(part => {
    if (/^\*\/\d+$/.test(part)) return values[i] % Number(part.slice(2)) === 0;
    if (/^\d+-\d+$/.test(part)) {const [lo, hi] = part.split('-').map(Number);return values[i] >= lo && values[i] <= hi;}
    assert(/^\d+$/.test(part), 'unreviewed cron syntax');return values[i] === Number(part);
  }));
}
function createTimerIdentity({environment, producer, target, owner = 'new', runtimeIdentity}) {
  assert(typeof environment === 'string' && environment.length && Object.hasOwn(policies, producer));
  assert(typeof target === 'string' && target.length && ['old', 'new'].includes(owner));
  assert.strictEqual(typeof runtimeIdentity, 'function');
  return async (event, context) => {
    const runtime = await runtimeIdentity(context);
    assert(runtime && runtime.environment === environment && runtime.function_name === target &&
      runtime.node_major === (owner === 'new' ? 24 : 16) && runtime.trigger_source === 'timer', 'native timer source required');
    assert(event && typeof event === 'object' && !Array.isArray(event));const e = {...event};
    for (const key of ['tcbContext', 'userInfo']) if (Object.hasOwn(e, key)) {assert.deepStrictEqual(e[key], {});delete e[key];}
    assert.deepStrictEqual(Object.keys(e).sort(), ['Message', 'Time', 'TriggerName', 'Type']);
    assert(e.Type === 'Timer' && e.Message === messageFor(producer) && Object.hasOwn(policies[producer], e.TriggerName));
    assert(typeof e.Time === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.000)?Z$/.test(e.Time));
    const time = new Date(e.Time), scheduled = time.toISOString();
    assert.strictEqual(scheduled.replace('.000Z', 'Z'), e.Time.replace('.000Z', 'Z'), 'invalid timer date');
    assert(matches(policies[producer][e.TriggerName], time), 'time does not match the fixed UTC+8 schedule');
    return {request_id: scheduledRequest({environment, producer, trigger_name: e.TriggerName, scheduled_for: scheduled}), business: e};
  };
}
module.exports = {createTimerIdentity, policies, message, messageFor};
