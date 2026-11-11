'use strict';
// OFFLINE authenticated worker + per-invocation outgoing SDK routing. Native
// Timer/HTTP identity and production key/storage/package wiring are separate.
const assert = require('assert');
const {AsyncLocalStorage} = require('async_hooks');
const entry = require('./writer-entry');
const {createDirectCaller, WriterCallError} = require('./writer-direct-caller');
const text = x => typeof x === 'string' && /^[A-Za-z0-9_:./|#@+-]{1,200}$/.test(x);
function createInvocationWorker({sdk, store, binding, key, target, owner, producer, runtimeIdentity,
  loadMain, childRoutes, beforeAdmission, unmanagedNames = [], dispatchStore, recordCompletion = false}) {
  assert(sdk && typeof sdk.init === 'function' && typeof loadMain === 'function' && typeof runtimeIdentity === 'function');
  assert(text(producer) && text(target) && ['old', 'new'].includes(owner));
  assert(beforeAdmission === undefined || typeof beforeAdmission === 'function');
  if (producer === 'adminGateway') assert.strictEqual(typeof beforeAdmission, 'function', 'admin maintenance check required');
  assert(binding && text(binding.environment) && text(binding.scope)); binding = {...binding};
  assert(Buffer.isBuffer(key) && key.length >= 32); key = Buffer.from(key);
  assert(childRoutes && typeof childRoutes === 'object' && !Array.isArray(childRoutes));
  let dispatchPlan;
  if (dispatchStore !== undefined) {
    dispatchPlan = require('./writer-dispatch-plan');
    assert(producer === 'adminGateway' && owner === 'new' && typeof dispatchStore.prepare === 'function');
    assert.deepStrictEqual(binding, dispatchPlan.parentBinding);
  }
  assert(Array.isArray(unmanagedNames) && unmanagedNames.every(text) && new Set(unmanagedNames).size === unmanagedNames.length);
  const routes = new Map();
  for (const [name, route] of Object.entries(childRoutes)) {
    assert(text(name) && route && route.binding && route.binding.environment === binding.environment);
    assert(text(route.binding.scope) && route.binding.scope !== binding.scope, 'parent and child must not acquire the same scope');
    assert(Buffer.isBuffer(route.key) && route.key.length >= 32 && text(route.action));
    assert(route.store && typeof route.store.read === 'function' && typeof route.store.transaction === 'function');
    assert(route.targets && text(route.targets.old) && text(route.targets.new) && route.targets.old !== route.targets.new);
    const allowedOwners = route.allowedOwners === undefined ? ['old', 'new'] : route.allowedOwners;
    assert(Array.isArray(allowedOwners) && allowedOwners.length > 0 && allowedOwners.every(x => ['old', 'new'].includes(x))
      && new Set(allowedOwners).size === allowedOwners.length, 'qualified child owner policy required');
    if (route.transportTimeoutMs !== undefined)
      assert(Number.isSafeInteger(route.transportTimeoutMs) && route.transportTimeoutMs > 0 && route.transportTimeoutMs <= 135000);
    routes.set(name, {...route, binding: {...route.binding}, targets: {...route.targets}, key: Buffer.from(route.key),
      allowedOwners: Object.freeze([...allowedOwners])});
  }
  const unmanaged = new Set(unmanagedNames);assert([...unmanaged].every(name => !routes.has(name)));
  if (dispatchPlan) {
    assert(unmanaged.size === 0 && [...routes.keys()].every(name => name === 'runDecisionEngine'), 'Core admin has no unmanaged/Gen dispatch edges');
    assert(Object.keys(dispatchPlan.routes).every(name => !routes.has(name)));
  }
  const context = new AsyncLocalStorage(), apps = new WeakMap();
  function track(promise, invocation) {
    if (invocation.enqueues.has(promise)) return promise;
    invocation.enqueues.add(promise);
    // Handle rejections immediately, including ignored chains, without changing
    // what the original caller's catch/then/finally observes.
    Promise.prototype.then.call(promise, undefined, () => {invocation.failed = true;});
    Object.defineProperties(promise, {
      then: {value: (yes, no) => track(Promise.prototype.then.call(promise, yes, no), invocation)},
      catch: {value: no => track(Promise.prototype.then.call(promise, undefined, no), invocation)},
      finally: {value: done => track(Promise.prototype.finally.call(promise, done), invocation)}
    });
    return promise;
  }
  async function settleEnqueues(invocation) {
    const seen = new Set();
    while (true) {
      const batch = [...invocation.enqueues].filter(p => !seen.has(p));if (!batch.length) return;
      batch.forEach(p => seen.add(p));
      // Bypass the observed .then so this bookkeeping does not register itself.
      await Promise.all(batch.map(p => new Promise(resolve => Promise.prototype.then.call(p, () => resolve(), () => resolve()))));
    }
  }
  function wrapApp(app) {
    assert(app && typeof app.callFunction === 'function');if (apps.has(app)) return apps.get(app);
    const nativeCall = app.callFunction.bind(app), boundMethods = new Map();
    function callFunction(request, options) {
      const invocation = context.getStore();
      if (!invocation || !invocation.active) return Promise.reject(new WriterCallError('WRITER_INVOCATION_UNAVAILABLE', 'writer invocation unavailable'));
      if (dispatchPlan && request && Object.hasOwn(dispatchPlan.routes, request.name)) {
        return track((async () => {
          try {
            assert(options === undefined, 'queued routes do not accept transport overrides');
            assert(!invocation.seen.has(request.name), 'one dispatch per target per parent invocation');
            invocation.seen.add(request.name);
            const spec = dispatchPlan.specification(invocation.parent, request);
            const ack = await dispatchStore.prepare(spec);
            assert(ack && ack.acknowledged === true && ack.job);
            dispatchPlan.validate(ack.job);assert.deepStrictEqual(ack.job.spec, spec);
            assert.strictEqual(ack.job.state, 'PREPARED', 'new parent cannot accept an already consumed task');
            const receipt = {job_id: spec.id, target: spec.target, state: 'PREPARED'};
            invocation.queued.push(receipt);
            return {requestId: spec.id, result: {queued: true, ...receipt}};
          } catch (error) {invocation.failed = true;throw error;}
        })(), invocation);
      }
      return directCall(invocation, request, options);
    }
    async function directCall(invocation, request, options) {
      const route = request && routes.get(request.name);
      if (!route && !(request && unmanaged.has(request.name))) {
        invocation.failed = true;
        throw new WriterCallError('WRITER_CHILD_UNDECLARED', 'writer child target is not declared');
      }
      if (invocation.seen.has(request.name)) {
        invocation.failed = true;
        throw new WriterCallError('WRITER_CHILD_REUSED', 'one child action per parent invocation');
      }
      invocation.seen.add(request.name);
      let operation;
      try {
        operation = Promise.resolve(route ? createDirectCaller({store: route.store, binding: route.binding, key: route.key,
          logicalName: request.name, targets: route.targets, callerName: target,
          allowedOwners: route.allowedOwners,
          callerNodeMajor: owner === 'new' ? 24 : 16, runtimeIdentity: () => invocation.runtime,
          resolveRequestId: () => entry.childRequest({parent_request_id: invocation.request_id, producer, action: route.action}),
          transportTimeoutMs: route.transportTimeoutMs === undefined ? app.config && app.config.timeout : route.transportTimeoutMs,
          callFunction: nativeCall})(request, options) : nativeCall(request, options));
      } catch (error) { invocation.failed = true;throw error; }
      invocation.pending.add(operation);
      try { return await operation; }
      catch (error) { invocation.failed = true;throw error; }
      finally { invocation.pending.delete(operation); }
    }
    const proxy = new Proxy(app, {get(original, property) {
      if (property === 'callFunction') return callFunction;
      const value = Reflect.get(original, property, original);
      if (typeof value !== 'function') return value;
      if (!boundMethods.has(property)) boundMethods.set(property, value.bind(original));
      return boundMethods.get(property);
    }});
    apps.set(app, proxy);return proxy;
  }
  const init = (...args) => wrapApp(sdk.init(...args));
  const wrappedSdk = new Proxy(sdk, {get(original, property) {
    return property === 'init' ? init : Reflect.get(original, property, original);
  }});
  const worker = entry.createWorker({store, binding, key, target, owner, recordCompletion,
    runtimeIdentity: () => {
      const invocation = context.getStore();assert(invocation && invocation.active);return invocation.runtime;
    }, loadMain: async () => {
      const original = await loadMain(wrappedSdk);assert.strictEqual(typeof original, 'function');
      return async (business, nativeContext) => {
        const invocation = context.getStore();assert(invocation && invocation.active);
        let result, failure;
        try {result = await original(business, nativeContext);} catch (error) {failure = error;}
        // Join durable prepares AND the original caller's registered rejection
        // callbacks before the parent journal may complete or become UNKNOWN.
        if (invocation.enqueues.size) await settleEnqueues(invocation);
        // Original fire-and-forget / caught child failures must not create a
        // falsely COMPLETE parent while callbacks may still perform writes.
        // The parent journal stays UNKNOWN/occupied, requiring reconciliation.
        // Unmanaged detached transports remain forbidden.
        if (failure) throw failure;
        if (invocation.pending.size || invocation.failed) throw Error('WRITER_CHILD_OUTCOME_UNSETTLED');
        if (invocation.queued.length) {
          assert(result && typeof result === 'object' && result.code === 0 && !Object.hasOwn(result, 'writer_dispatch'));
          return {...result, writer_dispatch: {schema: 1, state: 'QUEUED', jobs: invocation.queued.map(row => ({...row}))}};
        }
        return result;
      };
    }});
  async function main(event, nativeContext) {
    let runtime, wire;
    try {
      const observed = await runtimeIdentity(nativeContext);
      assert(observed.environment === binding.environment && observed.function_name === target && observed.node_major === (owner === 'new' ? 24 : 16));
      runtime = {environment: observed.environment, function_name: observed.function_name, node_major: observed.node_major};
      wire = entry.authenticate(event, {binding, target, owner, key});
    } catch (_) { return {protocol: 'writer-result-v1', executed: false, admission: 'ENTRY_AUTHENTICATION_FAILED'}; }
    // A maintenance denial must happen BEFORE reserving a request receipt. A
    // CLOSED response is not a completed business operation whose retry should
    // be permanently deduplicated after maintenance reopens.
    if (beforeAdmission) {
      let allowed = false;
      try { allowed = (await beforeAdmission(wire.business, nativeContext)) === true; } catch (_) { /* closed */ }
      if (!allowed) return {protocol: 'writer-result-v1', request_id: wire.request_id, token: wire.token,
        owner: wire.owner, epoch: wire.epoch, executed: false, admission: 'ENTRY_GATE_CLOSED'};
    }
    const invocation = {request_id: wire.request_id, runtime: Object.freeze({...runtime}), active: true,
      parent: {environment: binding.environment, scope: binding.scope, request_id: wire.request_id, token: wire.token, owner: wire.owner, epoch: wire.epoch},
      seen: new Set(), pending: new Set(), enqueues: new Set(), queued: [], failed: false};
    return context.run(invocation, async () => {
      try { return await worker(event, nativeContext); }
      finally { invocation.active = false; }
    });
  }
  return {main, sdk: wrappedSdk};
}
module.exports = {createInvocationWorker};
