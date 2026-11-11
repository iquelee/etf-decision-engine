'use strict';
// Offline Timer host factory; no resource creation or automatic queue bootstrap.
const assert = require('assert');
const plan = require('./writer-dispatch-plan');
const entry = require('./writer-entry');
const {createStore} = require('./writer-dispatch-cloudbase');
const {createQueue} = require('./writer-dispatch-queue');
const {createExecutor} = require('./writer-dispatch-executor');
const keys = {fetchDailyData:'WRITER_DAILY_SIGNING_KEY_HEX',fetchRealtimeData:'WRITER_REALTIME_SIGNING_KEY_HEX',
  fetchFundamentalNews:'WRITER_NEWS_SIGNING_KEY_HEX',extractFundamental:'WRITER_EXTRACT_SIGNING_KEY_HEX'};
function createHost({sdk, sdkVersion, databaseVersion, batchSize, transportTimeoutMs,
  readEnvironment = name => process.env[name], nodeMajor = () => Number(process.versions.node.split('.')[0])}) {
  assert(sdkVersion === '2.11.0' && databaseVersion === '1.4.1');assert(Number.isInteger(batchSize) && batchSize >= 1 && batchSize <= 10);
  assert(Number.isInteger(transportTimeoutMs) && transportTimeoutMs > 0 && transportTimeoutMs <= 135000);
  let database, queue, store, app;
  return {async main(event, context) {
    let cycle, runtime;
    try {
      const observed = sdk.getCloudbaseContext();
      assert((observed.TCB_ENV || observed.SCF_NAMESPACE) === plan.environment && observed.TRIGGER_SRC === 'timer');
      assert(nodeMajor() === 24 && context.function_name === 'writerDispatchNode24');
      const fields = {...event};
      for (const name of ['tcbContext','userInfo']) if (Object.hasOwn(fields,name)) {assert.deepStrictEqual(fields[name],{});delete fields[name];}
      assert.deepStrictEqual(Object.keys(fields).sort(), ['Message','Time','TriggerName','Type']);
      assert(event.Type === 'Timer' && event.TriggerName === 'writerDispatchMinute-v1' && event.Message === 'writer-dispatch-queue-v1');
      assert(typeof event.Time === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:00(?:\.000)?Z$/.test(event.Time));
      const instant = new Date(event.Time);assert(instant.toISOString().replace('.000Z','Z') === event.Time.replace('.000Z','Z'));
      cycle = entry.scheduledRequest({environment:plan.environment,producer:'writerDispatch',trigger_name:event.TriggerName,scheduled_for:event.Time});
      runtime = {environment:plan.environment,function_name:context.function_name,node_major:24,trigger_source:'timer'};
    } catch (_) {return {ok:false,reason:'DISPATCH_IDENTITY_UNAVAILABLE'};}
    let reserved, execute;
    try {
      if (!database) {
        const nextApp = sdk.init({env:plan.environment,retries:0,keepalive:false,timeout:transportTimeoutMs}), nextDatabase = nextApp.database();
        const nextQueue = createQueue({database:nextDatabase}), nextStore = createStore({database:nextDatabase});
        app=nextApp;database=nextDatabase;queue=nextQueue;store=nextStore;
      }
      reserved = await queue.reserve(cycle);assert(reserved.acknowledged === true);
      if (!reserved.reserved) return {ok:false,reason:reserved.reason};
      execute = createExecutor({store,callFunction:app.callFunction.bind(app),runtimeIdentity:()=>runtime,transportTimeoutMs,reservation:reserved.reservation,
        readKey: name => {assert(Object.hasOwn(keys,name));const raw=readEnvironment(keys[name]);assert(typeof raw==='string' && /^[a-f0-9]{64}$/i.test(raw));return Buffer.from(raw,'hex');}});
      const page = await queue.discover(reserved.reservation,reserved.after,batchSize), results=[];
      for (const id of page.ids) {
        const result = await execute(id);results.push({id,...result});
        if (result.reconciliation_required || result.state === 'HOLD' || result.reason === 'CLAIM_NOT_ACKNOWLEDGED') throw Error('DISPATCH_RECONCILIATION_REQUIRED');
      }
      const done = await queue.finish(execute.reservation(),page.after);assert(done.acknowledged && done.state==='OPEN');
      return {ok:true,cycle_id:cycle,results,after:page.after};
    } catch (_) {
      // Reservation ACK loss cannot authorize reads/sends. If a reservation was
      // acknowledged, hold it once; BUSY also remains fail-closed after crashes.
      let hold_confirmed=false;
      if (reserved && reserved.acknowledged && reserved.reserved) {
        try {const r=await queue.finish(execute ? execute.reservation() : reserved.reservation,null,true);hold_confirmed=r.acknowledged && r.state==='HOLD';} catch (_) {}
      }
      return {ok:false,reason:'DISPATCH_BATCH_UNKNOWN',hold_confirmed,reconciliation_required:true};
    }
  }};
}
module.exports = {createHost};
