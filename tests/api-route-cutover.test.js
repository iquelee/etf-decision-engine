'use strict';
const assert=require('assert');
const plan=require('../release/runtime24-api-cutover-plan.json');
const guard=require('../release/api-route-cutover');
const clone=x=>JSON.parse(JSON.stringify(x));
const route={Path:'/apiGateway',UpstreamResourceType:'SCF',UpstreamResourceName:'apiGateway',...plan.preserved_route_fields,CreateTime:'old',UpdateTime:'old'};
const before={data:{RequestId:'before',OriginDomain:'same',TotalCount:2,Domains:[
  {Domain:plan.domain,DomainType:'STATIC_STORE',Enable:true,UpdateTime:'old',Routes:[clone(route),{Path:'/',UpstreamResourceType:'STATIC_STORE',UpstreamResourceName:'staticstore',Enable:true},{Path:'/adminGateway',UpstreamResourceType:'SCF',UpstreamResourceName:'adminGateway',Enable:true}]},
  {Domain:'other',DomainType:'HTTPSERVICE',Enable:true,Routes:[{Path:'/check-work',UpstreamResourceType:'SCF',UpstreamResourceName:'check-work',Enable:true}]}
]}};
const after=clone(before);after.data.RequestId='after';after.data.Domains[0].UpdateTime='new';after.data.Domains[0].Routes[0].UpdateTime='new';after.data.Domains[0].Routes[0].UpstreamResourceName='apiGatewayNode24';
assert.deepStrictEqual(guard.payload(plan),{EnvId:plan.environment,Domain:plan.domain,Routes:[{Path:'/apiGateway',UpstreamResourceName:'apiGatewayNode24'}]});
assert.deepStrictEqual(guard.payload(plan,'rollback'),{EnvId:plan.environment,Domain:plan.domain,Routes:[{Path:'/apiGateway',UpstreamResourceName:'apiGateway'}]});
assert.deepStrictEqual(guard.nativePayload(plan),{EnvId:plan.environment,Domain:{Domain:plan.domain,Routes:[{Path:'/apiGateway',UpstreamResourceName:'apiGatewayNode24'}]}});
assert.deepStrictEqual(guard.nativePayload(plan,'rollback'),{EnvId:plan.environment,Domain:{Domain:plan.domain,Routes:[{Path:'/apiGateway',UpstreamResourceName:'apiGateway'}]}});
assert.strictEqual(guard.verifyTransition(before,after,plan).ok,true);
assert.strictEqual(guard.verifyTransition(after,before,plan,'rollback').ok,true);
const reordered=clone(after);reordered.data.Domains.reverse();reordered.data.Domains[1].Routes.reverse();assert.ok(guard.verifyTransition(before,reordered,plan));
for(const mutate of [
 x=>x.data.Domains[0].Routes[0].EnableAuth=true,
 x=>x.data.Domains[0].Routes[0].EnablePathTransmission=false,
 x=>x.data.Domains[0].Routes[0].EnableSafeDomain=false,
 x=>x.data.Domains[0].Routes[0].PathRewrite={prefix:'/wrong'},
 x=>x.data.Domains[0].Routes[0].QPSPolicy={QPS:1},
 x=>x.data.Domains[0].Routes[0].UpstreamResourceVersion='1',
 x=>x.data.Domains[0].Routes[1].Enable=false,
 x=>x.data.Domains[0].Routes[2].UpstreamResourceName='wrong',
 x=>x.data.Domains[1].Routes[0].Enable=false,
 x=>x.data.Domains[1].Routes.push({Path:'/new',UpstreamResourceName:'wrong'}),
 x=>x.data.Domains[0].Routes.push(clone(x.data.Domains[0].Routes[0])),
 x=>x.data.Domains.pop(),
 x=>x.data.TotalCount=3,
 x=>x.data.Domains[0].Routes[0].CreateTime='changed',
 x=>x.data.Domains[1].UpdateTime='unrelated change'
]) {const bad=clone(after);mutate(bad);assert.throws(()=>guard.verifyTransition(before,bad,plan));}
for(const mutate of [p=>p.domain='other',p=>p.path='/adminGateway',p=>p.new_upstream='apiGatewayRuntime24',p=>p.scope.permission_changes=true,p=>p.mutation.only_mutated_field='EnableAuth']){
 const bad=clone(plan);mutate(bad);assert.throws(()=>guard.payload(bad));
}
const foreign=clone(after);foreign.data.Domains[0].Routes[0].UpstreamResourceName='third-party';assert.throws(()=>guard.target(foreign,plan,'rollback'));
assert.throws(()=>guard.target(before,plan,'rollback'));
assert.throws(()=>guard.payload(plan,'delete'));
console.log('Single-route cutover/rollback, full-domain diff, drift/flag/duplicate/truncation and unrelated-change rejection passed');
