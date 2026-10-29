'use strict';
// Pure guards/payload generation only. This module cannot call cloud APIs.
const assert = require('assert');
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
function equal(a, b) { assert.deepStrictEqual(canonical(a), canonical(b)); }
function validatePlan(p) {
  assert.strictEqual(p.environment, 'tradingview-etf-d0fa42yy57cbc11b');
  assert.strictEqual(p.domain, p.environment + '-1253568636.tcloudbaseapp.com');
  assert.strictEqual(p.domain_type, 'STATIC_STORE');
  assert.strictEqual(p.path, '/apiGateway');
  assert.strictEqual(p.upstream_type, 'SCF');
  assert.strictEqual(p.old_upstream, 'apiGateway');
  assert.strictEqual(p.new_upstream, 'apiGatewayNode24');
  equal(p.preserved_route_fields, {Enable:true,EnableAuth:false,EnableSafeDomain:true,EnablePathTransmission:true,PathRewrite:{},QPSPolicy:{}});
  equal(p.mutation, {service:'tcb',action:'ModifyHTTPServiceRoute',only_mutated_field:'UpstreamResourceName',delete_recreate:false});
  equal(p.scope, {function_updates:[],frontend_updates:false,permission_changes:false,timer_changes:[],temporary_public_routes:[],resource_deletions:[],producer_invocations:[]});
}
function data(snapshot) {
  const d = snapshot.data || snapshot;
  assert.ok(Array.isArray(d.Domains), 'Complete native Domains array required');
  assert.strictEqual(d.TotalCount, d.Domains.length, 'Truncated domain inventory');
  assert.ok(d.Domains.length > 0);
  const domains = new Set();
  for (const domain of d.Domains) {
    assert.ok(domain.Domain && !domains.has(domain.Domain), 'Missing/duplicate domain'); domains.add(domain.Domain);
    assert.ok(Array.isArray(domain.Routes), 'Routes array required');
    const paths = new Set();
    for (const route of domain.Routes) {
      assert.ok(route.Path && !paths.has(route.Path), 'Missing/duplicate route'); paths.add(route.Path);
    }
  }
  return d;
}
function target(snapshot, plan, direction = 'cutover') {
  validatePlan(plan); assert.ok(['cutover','rollback'].includes(direction));
  const d = data(snapshot), domain = d.Domains.find(r => r.Domain === plan.domain);
  assert.ok(domain, 'Production static domain missing');
  assert.strictEqual(domain.DomainType, plan.domain_type);
  assert.strictEqual(domain.Enable, true);
  const route = domain.Routes.find(r => r.Path === plan.path); assert.ok(route, 'Target path missing');
  assert.strictEqual(route.UpstreamResourceType, plan.upstream_type);
  assert.strictEqual(route.UpstreamResourceName, direction === 'cutover' ? plan.old_upstream : plan.new_upstream, 'Upstream drift; refuse overwrite');
  for (const [k,v] of Object.entries(plan.preserved_route_fields)) equal(route[k],v);
  return route;
}
function payload(plan, direction = 'cutover') {
  validatePlan(plan); assert.ok(['cutover','rollback'].includes(direction));
  return {EnvId:plan.environment,Domain:plan.domain,Routes:[{Path:plan.path,UpstreamResourceName:direction==='cutover'?plan.new_upstream:plan.old_upstream}]};
}
function normalized(snapshot, plan) {
  const d = JSON.parse(JSON.stringify(data(snapshot))); delete d.RequestId;
  for (const domain of d.Domains) {
    if (domain.Domain === plan.domain) {
      delete domain.UpdateTime;
      for (const route of domain.Routes) if (route.Path === plan.path) delete route.UpdateTime;
    }
    domain.Routes.sort((a,b)=>a.Path.localeCompare(b.Path));
  }
  d.Domains.sort((a,b)=>a.Domain.localeCompare(b.Domain));
  return d;
}
function verifyTransition(before, after, plan, direction = 'cutover') {
  target(before,plan,direction);
  target(after,plan,direction==='cutover'?'rollback':'cutover');
  const expected = normalized(before,plan);
  expected.Domains.find(d=>d.Domain===plan.domain).Routes.find(r=>r.Path===plan.path).UpstreamResourceName = direction==='cutover'?plan.new_upstream:plan.old_upstream;
  equal(expected,normalized(after,plan));
  return {ok:true,domain:plan.domain,path:plan.path,direction,only_changed_field:'UpstreamResourceName'};
}
module.exports = {target,payload,verifyTransition};
