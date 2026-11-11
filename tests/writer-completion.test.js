'use strict';
const assert=require('assert'),path=require('path');
const fixtures=require('./writer-dispatch-store.test');
const completion=require('../release/writer-completion'),ledger=require('../release/writer-journal-cloudbase');
const journal=require('../release/writer-admission-journal'),entry=require('../release/writer-entry');
const {createInspector}=require('../release/writer-completion-inspector');
const key=Buffer.alloc(32,71);let sdkRoot;
async function setup(target='fetchFundamentalNews'){
  const f=await fixtures.fixture(target,target==='extractFundamental'?'extract':'news');await f.prepareAndFinish();
  const claim=await f.store.claim(f.spec.id,key);assert(claim.acknowledged&&claim.claimed);f.claimed=claim.job;
  f.longStore=ledger.createCoreCompletionStore({database:f.database,binding:f.childBinding});
  f.result={ok:true,inserted:2,errors:['private-provider-error'],skipped:['private-task'],secret:'PRIVATE_TOKEN',text:'PRIVATE_NEWS'};
  f.worker=entry.createWorker({store:f.longStore,binding:f.childBinding,key,target:target+'Node24',owner:'new',recordCompletion:true,
    runtimeIdentity:()=>({environment:f.childBinding.environment,function_name:target+'Node24',node_major:24}),
    loadMain:async()=>async()=>{f.business++;if(f.handler)return f.handler();return f.result;}});
  f.launch=()=>f.worker(f.claimed.wire,{});
  f.inspect=createInspector({database:f.database,readKey:async name=>{assert.strictEqual(name,target);return key;}});
  f.evidence=()=>{const id=completion.id(f.childBinding,f.claimed.wire);return completion.decode(f.b.rows().find(r=>r._id===id)||null,f.childBinding,f.claimed.wire);};
  f.receipts=()=>f.b.rows().filter(r=>r.scope===f.childBinding.scope&&['request','token'].includes(r.kind)).map(r=>JSON.parse(r.payload_json));
  return f;
}
async function readonly(f){
  const before=JSON.stringify(f.b.rows()),count=f.b.calls.length,result=await f.inspect(f.spec.id),calls=f.b.calls.slice(count);
  assert.strictEqual(JSON.stringify(f.b.rows()),before,'inspection cannot mutate jobs, controls or receipts');
  assert(!calls.some(c=>/commit|insert|modify/.test(c.action)));assert(calls.filter(c=>c.action==='database.abortTransaction').length<=1);
  assert.strictEqual(result.can_release,false);assert.strictEqual(result.can_retry,false);return result;
}
async function main(){let cases=0;
  for(const target of ['fetchFundamentalNews','extractFundamental']){
    const f=await setup(target);assert.strictEqual((await f.launch()).outcome,'COMPLETE');
    const evidence=f.evidence();assert(evidence);assert.strictEqual(evidence.reported_issue_count,2);assert.strictEqual(evidence.business_status,'REPORTED_OK');
    const serialized=JSON.stringify(evidence);for(const privateValue of ['PRIVATE_TOKEN','PRIVATE_NEWS','private-provider-error','private-task'])assert(!serialized.includes(privateValue));
    assert(f.receipts().every(r=>r.status==='COMPLETE'));
    assert.strictEqual((await readonly(f)).execution_status,'DURABLE_COMPLETE');
    assert.strictEqual((await f.launch()).admission,'ALREADY_COMPLETE');assert.strictEqual(f.business,1);
    const finishCreate=f.b.calls.find(c=>c.action==='database.insertDocument'&&JSON.parse(c.params.data[0]).kind==='completion');assert(finishCreate.params.transactionId);
    const writes=f.b.calls.filter(c=>c.params.transactionId===finishCreate.params.transactionId&&/insertDocument|modifyDocument/.test(c.action));
    assert.strictEqual(writes.length,4,'completion, dual receipts and scoped control share one transaction');cases++;
  }
  for(const value of [{ok:false,processed:0,error:'PRIVATE_FAILURE'},{message:'PRIVATE_UNCLASSIFIED'}]){
    const f=await setup('extractFundamental');f.result=value;assert.strictEqual((await f.launch()).outcome,'COMPLETE');
    assert.strictEqual(f.evidence().business_status,value.ok===false?'REPORTED_FAILURE':'UNCLASSIFIED');
    assert.strictEqual((await readonly(f)).execution_status,'DURABLE_COMPLETE');cases++;
  }
  const late=await setup();let release,started;const began=new Promise(r=>{started=r;});
  late.handler=async()=>{started();return new Promise(r=>{release=r;});};const pending=late.launch();await began;
  assert.strictEqual((await late.store.settle(late.claimed,null,key)).job.state,'HOLD');
  assert.strictEqual((await readonly(late)).execution_status,'IN_FLIGHT');
  release({ok:true,inserted:9});assert.strictEqual((await pending).outcome,'COMPLETE');
  const report=await readonly(late);assert.strictEqual(report.execution_status,'DURABLE_COMPLETE');assert.strictEqual(report.controls_held,true);
  assert.strictEqual((await late.longStore.read(late.childBinding)).state,'HOLD');assert.strictEqual((await late.store.read(late.spec.id)).state,'HOLD');
  assert.strictEqual((await late.store.claim(late.spec.id,key)).reason,'NO_AUTOMATIC_RETRY');assert.strictEqual(late.business,1);cases++;
  for(const after of [false,true]){
    const f=await setup();f.handler=async()=>{f.b.fault={action:'database.commitTransaction',after,throw:true};return {ok:true,inserted:3};};
    assert.strictEqual((await f.launch()).outcome,'UNKNOWN');assert.strictEqual(f.b.fault,null);
    assert.strictEqual(Boolean(f.evidence()),after);assert(f.receipts().every(r=>r.status===(after?'COMPLETE':'RUNNING')));
    assert.strictEqual((await readonly(f)).execution_status,after?'DURABLE_COMPLETE':'IN_FLIGHT');
    const before=f.business;await f.launch();assert.strictEqual(f.business,before);cases++;
  }
  const rejected=await setup();rejected.handler=async()=>{
    rejected.b.fault={action:'database.insertDocument',when:p=>JSON.parse(p.data[0]).kind==='completion',response:{code:'DENIED',requestId:'fixture:denied'}};return {ok:true};};
  assert.strictEqual((await rejected.launch()).outcome,'UNKNOWN');assert.strictEqual(rejected.evidence(),null);
  assert(rejected.receipts().every(r=>r.status==='RUNNING'));assert.strictEqual((await readonly(rejected)).execution_status,'IN_FLIGHT');cases++;
  const thrown=await setup();thrown.handler=async()=>{throw Error('PRIVATE_BUSINESS_THROW');};
  assert.strictEqual((await thrown.launch()).outcome,'UNKNOWN');assert.strictEqual(thrown.evidence(),null);
  assert.strictEqual((await readonly(thrown)).execution_status,'UNKNOWN');cases++;
  const legacy=await setup();const worker=entry.createWorker({store:legacy.childStore,binding:legacy.childBinding,key,target:'fetchFundamentalNewsNode24',owner:'new',
    runtimeIdentity:()=>({environment:legacy.childBinding.environment,function_name:'fetchFundamentalNewsNode24',node_major:24}),loadMain:async()=>async()=>({ok:true})});
  assert.strictEqual((await worker(legacy.claimed.wire,{})).outcome,'COMPLETE');assert.strictEqual((await readonly(legacy)).execution_status,'LEGACY_COMPLETE_NO_SUMMARY');cases++;
  const stale=await setup();await stale.launch();
  const control=await stale.longStore.read(stale.childBinding);
  stale.b.seed(ledger.id(stale.childBinding,'control'),ledger.encodeControl({...control,epoch:control.epoch+1},stale.childBinding));
  const historical=await readonly(stale);assert.strictEqual(historical.execution_status,'DURABLE_COMPLETE');assert.strictEqual(historical.generation_matches,false);cases++;
  for(const corrupt of ['missing-token','completion-private-field','receipt-running','completion-wrong-epoch']){
    const f=await setup();await f.launch();
    if(corrupt==='missing-token'||corrupt==='receipt-running'){
      const wire=f.claimed.wire,id=ledger.id(f.childBinding,'token',wire.token),r=f.receipts()[0];
      f.b.seed(id,corrupt==='missing-token'?{kind:'corrupt'}:ledger.encodeReceipt({...r,status:'RUNNING'},f.childBinding,'token'));
    }else{
      const id=completion.id(f.childBinding,f.claimed.wire),e=f.evidence(),value=corrupt==='completion-private-field'?{...e,private:'SECRET'}:{...e,epoch:e.epoch+1};
      f.b.seed(id,{schema:1,kind:'completion',environment:f.childBinding.environment,scope:f.childBinding.scope,payload_json:JSON.stringify(value)});
    }
    assert.strictEqual((await readonly(f)).execution_status,'UNVERIFIABLE');cases++;
  }
  const immutable=await setup();await immutable.launch();const record=immutable.evidence(),saved=JSON.stringify(immutable.b.rows());
  assert.strictEqual((await journal.apply(immutable.longStore,immutable.childBinding,{...immutable.claimed.wire,type:'finish',completion:record,
    revision:(await immutable.longStore.read(immutable.childBinding)).revision})).ok,false);
  assert.strictEqual(JSON.stringify(immutable.b.rows()),saved);cases++;
  const wrongKey=await setup();const inspector=createInspector({database:wrongKey.database,readKey:async()=>Buffer.alloc(32,1)});
  assert.strictEqual((await inspector(wrongKey.spec.id)).execution_status,'UNVERIFIABLE');cases++;
  const rollback=await setup();await rollback.launch();rollback.b.fault={action:'database.abortTransaction',throw:true};
  assert.strictEqual((await readonly(rollback)).execution_status,'UNVERIFIABLE');cases++;
  const badParent=await setup();await badParent.launch();
  badParent.b.seed(ledger.id(badParent.spec.parent,'request',badParent.spec.parent.request_id),{kind:'corrupt-parent'});
  assert.strictEqual((await readonly(badParent)).execution_status,'UNVERIFIABLE');cases++;
  const occupied=await setup();await occupied.launch();const before=await occupied.longStore.read(occupied.childBinding);
  const admitted=require('../release/writer-admission').transition(before,{...occupied.claimed.wire,type:'admit',revision:before.revision},occupied.childBinding);
  assert(admitted.ok);occupied.b.seed(ledger.id(occupied.childBinding,'control'),ledger.encodeControl(admitted.next,occupied.childBinding));
  assert.strictEqual((await readonly(occupied)).execution_status,'UNVERIFIABLE');cases++;
  for(const scope of ['production/runGen1ShadowEod','production/runGen2ShadowEod','production/adminGateway','production/fetchDailyData'])
    assert.throws(()=>ledger.createCoreCompletionStore({database:wrongKey.database,binding:{environment:completion.environment,scope}}));
  assert.throws(()=>entry.createWorker({store:wrongKey.childStore,binding:wrongKey.childBinding,key,target:'fetchFundamentalNewsNode24',owner:'new',recordCompletion:true,
    runtimeIdentity:()=>({}),loadMain:async()=>()=>({})}));
  assert.strictEqual(fixtures.networkAttempts(),0);
  console.log(JSON.stringify({status:'PASS_CORE_DURABLE_COMPLETION',cases,evidence:fixtures.getSdk()?'ACTUAL_SDK_MEMORY_WIRE':'MODEL_ONLY',
    atomic_finish:'CONTROL_DUAL_RECEIPTS_COMPLETION',late_finish_preserves_hold:true,inspector:'SNAPSHOT_READ_ONLY_NO_COMMIT_OR_RELEASE',business_success:'NOT_INFERRED',cloud_calls:0,network_attempts:0,long_duration_and_platform_qualification:'NOT_PROVEN'}));
}
if(require.main===module){const args=process.argv.slice(2);
  if(args.length&&args[0]!=='--child'){
    assert(args.length===2&&args[0]==='--sdk-root');const env={};for(const k of ['PATH','SystemRoot','WINDIR','TEMP','TMP'])if(process.env[k])env[k]=process.env[k];
    const r=require('child_process').spawnSync(process.execPath,[__filename,'--child',args[1]],{env,encoding:'utf8',timeout:300000,maxBuffer:1024*1024});
    if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr);assert.strictEqual(r.status,0);
  }else{if(args.length){sdkRoot=path.resolve(args[1]);fixtures.initSdk(sdkRoot);}main().catch(e=>{console.error(e);process.exitCode=1;});}
}
