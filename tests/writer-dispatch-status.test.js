'use strict';
const assert=require('assert'),path=require('path');
const {pathToFileURL}=require('url');
const {setup}=require('./writer-admin-http.test');
const plan=require('../release/writer-dispatch-plan'),admission=require('../release/writer-admission');
const store=require('../release/writer-dispatch-cloudbase'),{publicStatus}=require('../release/writer-dispatch-status');
const key=Buffer.alloc(32,71),clone=x=>JSON.parse(JSON.stringify(x));
function jobs() {
  const parent={...plan.parentBinding,owner:'new',epoch:1,request_id:'status:parent',token:'status:token'};
  const spec=plan.specification(parent,{name:'fetchDailyData',data:{force:true,task_name:'daily'}}),prepared=plan.prepare(null,spec);
  const child={environment:plan.environment,scope:'production/fetchDailyData'},active=b=>({...admission.initial(b),state:'ACTIVE',owner:'new',epoch:1,revision:2});
  const receipt={...parent,status:'COMPLETE'},claimed=plan.claim(prepared,{parentControl:active(plan.parentBinding),childControl:active(child),
    requestReceipt:receipt,tokenReceipt:clone(receipt),rollout:{schema:1,environment:plan.environment,scope:'production/writer-rollout',revision:0,state:'OPEN'}},key).next;
  const w=claimed.wire,response={requestId:'fixture:status',result:{protocol:'writer-result-v1',request_id:w.request_id,token:w.token,owner:w.owner,epoch:w.epoch,
    executed:true,outcome:'COMPLETE',result:{ok:false}}};
  return [prepared,claimed,plan.settle(claimed,response),plan.settle(claimed,null)];
}
async function main() {
  const f=await setup();f.state.rollout=null;
  const event=id=>({httpMethod:'GET',path:'/api/admin/dispatch/status',headers:{'x-admin-token':'fixture-session'},queryStringParameters:{job_id:id}});
  for(const job of jobs()) {
    f.b.seed(job.spec.id,store.encode(job));const before=f.b.calls.length;
    const result=await f.bootstrap.main(event(job.spec.id),f.context);assert.strictEqual(result.code,0);
    assert.deepStrictEqual(result.data,publicStatus(job));assert.strictEqual(result.data.business_status,'NOT_OBSERVED');
    const text=JSON.stringify(result);for(const privateKey of ['payload_json','signature','token','parent','wire','business":']) assert(!text.includes(privateKey));
    assert(!f.b.calls.slice(before).some(c=>c.action!=='database.getDocument'),'lookup is read-only, no transaction or admission');
    assert.strictEqual(f.state.loads,0);assert.strictEqual(f.state.rolloutReads,0);
  }
  const id=jobs()[0].spec.id;
  for(const input of [{...event(id),headers:{}},{...event(id),headers:{'x-admin-token':'wrong'}},
    {...event(id),headers:{'x-admin-token':'fixture-session',authorization:'Bearer conflicting'}}]) {
    const before=f.b.calls.length;assert.strictEqual((await f.bootstrap.main(input,f.context)).code,401);assert.strictEqual(f.b.calls.length,before);
  }
  for(const query of [{job_id:'control:other'},{job_id:[id]},{job_id:id,scope:'other'},{}]) assert.strictEqual((await f.bootstrap.main({...event(id),queryStringParameters:query},f.context)).code,400);
  assert.strictEqual((await f.bootstrap.main({...event(id),httpMethod:'POST'},f.context)).code,405);
  assert.strictEqual((await f.bootstrap.main(event('dispatch:'+'0'.repeat(64)),f.context)).code,404);
  f.b.seed(id,{kind:'dispatch',payload_json:'private-corruption'});const corrupt=await f.bootstrap.main(event(id),f.context);
  assert.strictEqual(corrupt.code,503);assert(!JSON.stringify(corrupt).includes('private-corruption'));
  assert.strictEqual(f.h.writes.length,0);
  const client=await import(pathToFileURL(path.resolve(__dirname,'../web/src/utils/core-dispatch.js')).href);
  for(const job of jobs()) {
    const expected={job_id:job.spec.id,target:job.spec.target,state:'PREPARED'},data=publicStatus(job);let requests=0;
    const result=await client.readDispatchStatuses([expected],{base:'https://fixture.example/adminGateway',storage:{getItem:()=> 'fixture-token'},
      fetchImpl:async(url,init)=>{requests++;assert.strictEqual(url,'https://fixture.example/adminGateway/api/admin/dispatch/status?job_id='+encodeURIComponent(expected.job_id));
        assert.strictEqual(init.method,'GET');assert.strictEqual(init.cache,'no-store');assert.deepStrictEqual(init.headers,{'X-Admin-Token':'fixture-token'});
        return {ok:true,json:async()=>({code:0,data})};}});
    assert.deepStrictEqual(result,[data]);assert.strictEqual(requests,1);assert(!client.dispatchStatusMessage(data).includes('业务成功'));
    for(const bad of [{...data,job_id:'dispatch:'+'f'.repeat(64)},{...data,target:'runGen1ShadowEod'},{...data,wire:'secret'},
      {...data,business_status:'SUCCESS'},{...data,execution_status:'FABRICATED'}]) assert.throws(()=>client.validateDispatchStatus(bad,expected));
  }
  console.log('Core exact job status: authenticated GET, four states, strict public whitelist, no admission/writes, no business-success inference PASS (MODEL_ONLY)');
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
