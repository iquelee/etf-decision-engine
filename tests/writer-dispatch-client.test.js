'use strict';
const assert = require('assert'), path = require('path');
const {pathToFileURL} = require('url');
const uri = p => pathToFileURL(path.resolve(__dirname,'../web/src',p)).href;
async function main() {
  const {createOperationTracker, OPERATION_KEY, adminOperations} = await import(uri('utils/admin-operations.js'));
  const helper = await import(uri('utils/core-dispatch.js'));let seq=0;
  const rows=new Map(),storage={getItem:k=>rows.get(k)||null,setItem:(k,v)=>rows.set(k,v),removeItem:k=>rows.delete(k)};
  const locks={request:async(_name,_opts,fn)=>fn({fixture:true})},crypto={randomUUID:()=> '00000000-0000-4000-8000-'+String(++seq).padStart(12,'0')};
  const factory=()=>createOperationTracker({storage:()=>storage,locks:()=>locks,crypto:()=>crypto});
  const dispatch={schema:1,state:'QUEUED',jobs:[{job_id:'dispatch:'+'a'.repeat(64),target:'fetchDailyData',state:'PREPARED'}]};
  const envelope=id=>({code:0,data:{triggered:true},message:'ok',operation_id:id,writer_outcome:'COMPLETE',writer_dispatch:dispatch});
  const t=factory();let sends=0;
  await t.run('POST /api/admin/fetch',{task:'daily',private_fixture:'not-persisted'},async id=>{sends++;return {ok:true,json:envelope(id)};});
  assert.strictEqual(t.state().record.state,'QUEUED');assert(!storage.getItem(OPERATION_KEY).includes('not-persisted'));
  assert.deepStrictEqual(t.state().record.dispatch,dispatch);
  await assert.rejects(factory().run('POST /api/admin/fetch',{task:'daily'},()=>{sends++;}));assert.strictEqual(sends,1);
  const id=t.state().record.id;await t.requestReview(id);await t.acknowledge(id,true);assert.strictEqual(storage.getItem(OPERATION_KEY),null);
  for(const invalid of [null,{schema:1,state:'COMPLETE',jobs:dispatch.jobs},{...dispatch,jobs:[{...dispatch.jobs[0],target:'runGen1ShadowEod'}]},
    {...dispatch,jobs:[dispatch.jobs[0],dispatch.jobs[0]]}]) {
    const tracker=factory();await assert.rejects(tracker.run('POST /api/admin/fetch',{},async op=>{
      const json=envelope(op);if(invalid)json.writer_dispatch=invalid;else delete json.writer_dispatch;return {ok:true,json};
    }));assert.strictEqual(tracker.state().record.state,'UNCERTAIN');
    const op=tracker.state().record.id;await tracker.requestReview(op);await tracker.acknowledge(op,true);
  }
  const cooled=factory();await cooled.run('POST /api/admin/intel/refresh',{},async op=>({ok:true,json:{...envelope(op),
    writer_dispatch:undefined,data:{triggered:false,cooled:true}}}));assert.strictEqual(cooled.state().record,null);
  const late=factory();await assert.rejects(late.run('POST /api/admin/fetch',{},async()=>{throw Error('fixture lost');}));
  await late.requestReview(late.state().record.id);
  await late.run('POST /api/admin/fetch',{},async op=>({ok:true,json:envelope(op)}));
  assert.strictEqual(late.state().record.review_requested,false,'queued acknowledgement requires a fresh execution review');
  const lateId=late.state().record.id;await assert.rejects(late.acknowledge(lateId,true));await late.requestReview(lateId);await late.acknowledge(lateId,true);
  const ordinary={code:0,data:{gen1:'unchanged'}};assert.strictEqual(helper.unwrapCoreDispatch(ordinary,'/api/admin/gen1/health'),ordinary.data);
  assert.strictEqual(helper.dispatchAcknowledgment({...ordinary,writer_dispatch:{invalid:true}},'/api/admin/gen1/health'),null);
  assert(helper.dispatchMessage({writer_dispatch:dispatch}).includes('等待执行'));
  const saved={localStorage:global.localStorage,fetch:global.fetch,window:global.window,navigator:Object.getOwnPropertyDescriptor(global,'navigator'),crypto:Object.getOwnPropertyDescriptor(global,'crypto')};
  try {
    global.localStorage=storage;global.window={location:{hash:''}};
    Object.defineProperty(global,'navigator',{configurable:true,value:{locks}});Object.defineProperty(global,'crypto',{configurable:true,value:crypto});
    global.fetch=async(_url,init)=>({ok:true,status:200,json:async()=>envelope(init.headers['X-Writer-Operation-Id'])});
    for(const file of ['api/request.js','rewrite/api.js']) {
      const client=await import(uri(file)),result=await (client.adminApi || client.admin).triggerFetch('daily');
      assert.deepStrictEqual(result.writer_dispatch,dispatch);assert.strictEqual(adminOperations.state().record.state,'QUEUED');
      const op=adminOperations.state().record.id;await adminOperations.requestReview(op);await adminOperations.acknowledge(op,true);
    }
  } finally {
    global.localStorage=saved.localStorage;global.fetch=saved.fetch;global.window=saved.window;
    for(const name of ['navigator','crypto']) if(saved[name])Object.defineProperty(global,name,saved[name]);else delete global[name];
  }
  console.log('Core queued client: both APIs preserve receipts, refresh blocks resubmit, malformed ACK stays uncertain, non-Core data unchanged PASS (MODEL_ONLY)');
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
