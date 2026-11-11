'use strict';
const assert = require('assert'), path = require('path');
const fixtures = require('./writer-dispatch-store.test');
const plan = require('../release/writer-dispatch-plan');
const storeAdapter = require('../release/writer-dispatch-cloudbase');
const queue = require('../release/writer-dispatch-queue');
const ledger = require('../release/writer-journal-cloudbase');
const admission = require('../release/writer-admission');
const entry = require('../release/writer-entry');
const {createHost} = require('../release/writer-dispatch-host');
const key = Buffer.alloc(32,71), clone = x => JSON.parse(JSON.stringify(x));
const event = minute => ({Type:'Timer',TriggerName:'writerDispatchMinute-v1',Message:'writer-dispatch-queue-v1',Time:'2026-11-11T02:' + String(minute).padStart(2,'0') + ':00Z'});
async function setup(count=4, initialize=true) {
  const f = await fixtures.fixture();await f.prepareAndFinish();
  const initial = {schema:1,environment:plan.environment,scope:queue.scope,revision:0,state:'OPEN',active:null,after:null};
  if (initialize) f.b.seed(queue.controlId,queue.encode(initial));
  const originalJob = await f.store.read(f.spec.id), specs=[];
  const names=['fetchDailyData','fetchRealtimeData','fetchFundamentalNews','extractFundamental'];
  const tasks=['daily','realtime','news','extract'];
  for (let i=0;i<count;i++) {
    const spec = plan.specification(originalJob.spec.parent,{name:names[i],data:{force:true,task_name:tasks[i]}});specs.push(spec);
    if (i) f.b.seed(spec.id,storeAdapter.encode(plan.prepare(null,spec)));
    const binding={environment:plan.environment,scope:'production/'+names[i]};
    f.b.seed(ledger.id(binding,'control'),ledger.encodeControl({...admission.initial(binding),owner:'new',epoch:1,state:'ACTIVE',revision:3},binding));
  }
  const sdk = fixtures.getSdk(), EJSON = sdk ? require(path.join(sdkRoot,'node_modules/bson')).EJSON : JSON;
  const send=f.b.send.bind(f.b);f.pages=0;
  f.b.send=async (action,params={})=>{
    const where=params.query && EJSON.parse(params.query);
    if (action==='database.getDocument' && where && !Object.hasOwn(where,'_id')) {
      assert(!params.transactionId);assert.strictEqual(params.collectionName,storeAdapter.collection);f.pages++;
      const {job_id,...base}=where;assert.deepStrictEqual(base,{kind:'dispatch',environment:plan.environment,scope:plan.parentBinding.scope,state:'PREPARED'});
      if (job_id) {assert.deepStrictEqual(Object.keys(job_id),['$gt']);assert(/^dispatch:[a-f0-9]{64}$/.test(job_id.$gt));}
      assert.deepStrictEqual(EJSON.parse(params.order),{job_id:1});assert(params.limit>=1 && params.limit<=10);
      const rows=f.b.rows().filter(row=>Object.entries(base).every(([k,v])=>row[k]===v) && (!job_id || row.job_id>job_id.$gt))
        .sort((a,b)=>a.job_id.localeCompare(b.job_id)).slice(0,params.limit);
      return {requestId:'fixture:page',data:{list:rows.map(row=>EJSON.stringify(row)),offset:0,limit:params.limit}};
    }
    return send(action,params);
  };
  let database=f.database;
  if (!sdk) database={...database,command:{gt:v=>({$gt:v})},collection(name) {
    assert.strictEqual(name,storeAdapter.collection);const col=f.database.collection(name);
    return {...col,where:filter=>({orderBy:(field,direction)=>({limit:limit=>({get:async()=>{
      assert(field==='job_id' && direction==='asc');const r=await f.b.send('database.getDocument',{collectionName:name,query:JSON.stringify(filter),order:JSON.stringify({job_id:1}),limit});
      return {requestId:r.requestId,data:r.data.list.map(JSON.parse)};
    }})})})};
  }};
  f.transport=async (request,options)=>{
    f.attempts++;assert.deepStrictEqual(options,{timeout:15000,retryOptions:{retries:0}});
    const name=request.name.replace(/Node24$/,'');assert(names.includes(name));
    const binding={environment:plan.environment,scope:'production/'+name}, childStore=ledger.createProductionStore({database,binding});
    const worker=entry.createWorker({store:childStore,binding,key,target:request.name,owner:'new',
      runtimeIdentity:()=>({environment:plan.environment,node_major:24,function_name:request.name}),
      loadMain:async()=>async()=>{f.business++;return {ok:true};}});
    const result=await worker(request.data,{});if(f.lost) throw Error('fixture response lost');return {requestId:'fixture:transport',result};
  };
  f.inits=0;f.source='timer';
  if (sdk) sdk.getCloudbaseContext=()=>({TCB_ENV:plan.environment,TRIGGER_SRC:f.source});
  if (hostPackage) for(const name of ['WRITER_DAILY_SIGNING_KEY_HEX','WRITER_REALTIME_SIGNING_KEY_HEX','WRITER_NEWS_SIGNING_KEY_HEX','WRITER_EXTRACT_SIGNING_KEY_HEX']) process.env[name]=key.toString('hex');
  const fakeSdk={getCloudbaseContext:()=>({TCB_ENV:plan.environment,TRIGGER_SRC:f.source}),init:config=>{
    f.inits++;assert(config.retries===0 && config.keepalive===false && config.env===plan.environment);
    const actual=sdk && sdk.init(config);return {database:()=>database,callFunction:actual?actual.callFunction.bind(actual):(...args)=>f.transport(...args)};
  }};
  f.makeHost=()=>hostPackage ? {main:require(path.join(sdkRoot,'index.js')).main} : createHost({sdk:fakeSdk,sdkVersion:'2.11.0',databaseVersion:'1.4.1',batchSize:2,transportTimeoutMs:15000,nodeMajor:()=>24,readEnvironment:()=>key.toString('hex')});
  const host=f.makeHost();f.run=(minute=0)=>host.main(event(minute),{function_name:'writerDispatchNode24',request_id:'native:'+minute});
  f.queueState=()=>queue.decode(f.b.rows().find(row=>row._id===queue.controlId));f.databaseWithQuery=database;
  return f;
}
let sdkRoot,hostPackage=false;
async function main() {
  let cases=0;
  const f=await setup();assert((await f.run(0)).ok);assert.strictEqual(f.business,2);assert((await f.run(1)).ok);assert.strictEqual(f.business,4);
  assert((await f.run(2)).ok);assert.strictEqual(f.business,4);assert.strictEqual((await f.run(0)).reason,'CYCLE_ALREADY_SEEN');
  assert.strictEqual(f.queueState().state,'OPEN');assert.strictEqual(f.queueState().after,null);cases++;
  const closed=await setup();closed.source='sdk';assert.strictEqual((await closed.run()).reason,'DISPATCH_IDENTITY_UNAVAILABLE');assert.strictEqual(closed.inits,0);cases++;
  const missing=await setup(1,false);assert.strictEqual((await missing.run()).ok,false);assert.strictEqual(missing.attempts,0);assert(!missing.b.rows().some(row=>row._id===queue.controlId));cases++;
  const crash=await setup();const q=queue.createQueue({database:crash.databaseWithQuery});
  const cycle=entry.scheduledRequest({environment:plan.environment,producer:'writerDispatch',trigger_name:event(0).TriggerName,scheduled_for:event(0).Time});
  assert((await q.reserve(cycle)).reserved);assert.strictEqual((await crash.run(1)).reason,'QUEUE_CLOSED');assert.strictEqual(crash.attempts,0);cases++;
  for (const phase of ['reserve','claim']) {
    const x=await setup(1), base=x.b.send.bind(x.b);let armed=false;
    x.b.send=async(action,params={})=>{
      if (!armed && ((phase==='reserve' && action==='database.insertDocument' && params.data.some(raw=>JSON.parse(raw).kind==='dispatch_cycle')) ||
          (phase==='claim' && action==='database.modifyDocument' && JSON.parse(params.data).$set.state==='CLAIMED'))) {
        armed=true;x.b.fault={action:'database.commitTransaction',after:true,throw:true};
      }
      return base(action,params);
    };
    const result=await x.run();assert(armed);assert.strictEqual(result.ok,false);assert.strictEqual(x.attempts,0);
    assert(['BUSY','HOLD'].includes(x.queueState().state));assert.strictEqual((await x.run(1)).reason,'QUEUE_CLOSED');cases++;
  }
  const lost=await setup(1);lost.lost=true;assert.strictEqual((await lost.run()).ok,false);assert.strictEqual(lost.business,1);
  assert.strictEqual(lost.queueState().state,'HOLD');assert.strictEqual((await lost.run(1)).reason,'QUEUE_CLOSED');assert.strictEqual(lost.attempts,1);cases++;
  const fairness=await setup();const p=await fairness.parentStore.read(plan.parentBinding);
  fairness.b.seed(ledger.id(plan.parentBinding,'control'),ledger.encodeControl({...p,state:'HOLD'},plan.parentBinding));
  assert((await fairness.run()).ok);assert.strictEqual(fairness.attempts,0);assert(fairness.queueState().after);
  fairness.b.seed(ledger.id(plan.parentBinding,'control'),ledger.encodeControl({...p,revision:p.revision+1},plan.parentBinding));
  assert((await fairness.run(1)).ok);assert((await fairness.run(2)).ok);assert.strictEqual(fairness.business,4);cases++;
  const race=await setup();const outcomes=await Promise.all([race.run(0),race.run(1)]);
  assert.strictEqual(outcomes.filter(r=>r.ok).length,1);assert.strictEqual(race.business,2);assert.strictEqual(race.queueState().state,'OPEN');cases++;
  const finishLost=await setup(1),finishSend=finishLost.b.send.bind(finishLost.b);let finishArmed=false;
  finishLost.b.send=async(action,params={})=>{
    if(!finishArmed && action==='database.modifyDocument') {
      const patch=JSON.parse(params.data).$set;
      if(patch.kind==='dispatch_queue_control' && JSON.parse(patch.payload_json).state==='OPEN') {
        finishArmed=true;finishLost.b.fault={action:'database.commitTransaction',after:true,throw:true};
      }
    }
    return finishSend(action,params);
  };
  const finalUnknown=await finishLost.run();assert(finishArmed);assert.strictEqual(finalUnknown.ok,false);
  assert.strictEqual(finalUnknown.hold_confirmed,false);assert.strictEqual(finishLost.queueState().state,'OPEN');assert.strictEqual(finishLost.business,1);
  assert.strictEqual((await finishLost.run(0)).reason,'CYCLE_ALREADY_SEEN');assert((await finishLost.run(1)).ok);assert.strictEqual(finishLost.attempts,1);cases++;
  assert.strictEqual(fixtures.networkAttempts(),0);
  console.log(JSON.stringify({status:'PASS_CORE_DISPATCH_HOST',evidence:fixtures.getSdk()?'ACTUAL_SDK_MEMORY_WIRE':'MODEL_ONLY',sealed_host_entry:hostPackage,cases,cloud_calls:0,network_attempts:fixtures.networkAttempts(),
    queue_bootstrap:'EXPLICIT_FIXTURE_ONLY',platform_timer_source:'NOT_PROVEN',production_and_natural_qualification:'NOT_PROVEN'}));
}
if(require.main===module) {
  const args=process.argv.slice(2);
  if(args.length && !['--child','--package-child'].includes(args[0])) {
    assert(args.length===2 && ['--sdk-root','--host-package'].includes(args[0]));const env={};for(const k of ['PATH','SystemRoot','WINDIR','TEMP','TMP']) if(process.env[k]) env[k]=process.env[k];
    const r=require('child_process').spawnSync(process.execPath,[__filename,args[0]==='--host-package'?'--package-child':'--child',args[1]],{env,encoding:'utf8',timeout:300000});
    if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr);assert.strictEqual(r.status,0);
  } else {if(args.length){sdkRoot=path.resolve(args[1]);hostPackage=args[0]==='--package-child';fixtures.initSdk(sdkRoot);}main().catch(error=>{console.error(error);process.exitCode=1;});}
}
