'use strict';
// OFFLINE authenticated worker + per-invocation outgoing SDK routing. Native
// Timer/HTTP identity and production key/storage/package wiring are separate.
const assert = require('assert');
const {AsyncLocalStorage} = require('async_hooks');
const entry = require('./writer-entry');
const {createDirectCaller, WriterCallError} = require('./writer-direct-caller');
const text = x => typeof x === 'string' && /^[A-Za-z0-9_:./|#@+-]{1,200}$/.test(x);
function createInvocationWorker({sdk, store, binding, key, target, owner, producer, runtimeIdentity,
  loadMain, childRoutes, beforeAdmission, unmanagedNames = []}) {
  assert(sdk && typeof sdk.init === 'function' && typeof loadMain === 'function' && typeof runtimeIdentity === 'function');
  assert(text(producer) && text(target) && ['old', 'new'].includes(owner));
  assert(beforeAdmission === undefined || typeof beforeAdmission === 'function');
  if (producer === 'adminGateway') assert.strictEqual(typeof beforeAdmission, 'function', 'admin maintenance check required');
  assert(binding && text(binding.environment) && text(binding.scope)); binding = {...binding};
  assert(Buffer.isBuffer(key) && key.length >= 32); key = Buffer.from(key);
  assert(childRoutes && typeof childRoutes === 'object' && !Array.isArray(childRoutes));
  assert(Array.isArray(unmanagedNames) && unmanagedNames.every(text) && new Set(unmanagedNames).size === unmanagedNames.length);
  const routes = new Map();
  for (const [name, route] of Object.entries(childRoutes)) {
    assert(text(name) && route && route.binding && route.binding.environment === binding.environment);
    assert(text(route.binding.scope) && route.binding.scope !== binding.scope, 'parent and child must not acquire the same scope');
    assert(Buffer.isBuffer(route.key) && route.key.length >= 32 && text(route.action));
    assert(route.store && typeof route.store.read === 'function' && typeof route.store.transaction === 'function');
    assert(route.targets && text(route.targets.old) && text(route.targets.new) && route.targets.old !== route.targets.new);
    if (route.transportTimeoutMs !== undefined)
      assert(Number.isSafeInteger(route.transportTimeoutMs) && route.transportTimeoutMs > 0 && route.transportTimeoutMs <= 135000);
    routes.set(name, {...route, binding: {...route.binding}, targets: {...route.targets}, key: Buffer.from(route.key)});
  }
  const unmanaged = new Set(unmanagedNames);assert([...unmanaged].every(name => !routes.has(name)));
  const context = new AsyncLocalStorage(), apps = new WeakMap();
  function wrapApp(app) {
    assert(app && typeof app.callFunction === 'function');if (apps.has(app)) return apps.get(app);
    const nativeCall = app.callFunction.bind(app), boundMethods = new Map();
    async function callFunction(request, options) {
      const invocation = context.getStore();
      if (!invocation || !invocation.active) throw new WriterCallError('WRITER_INVOCATION_UNAVAILABLE', 'writer invocation unavailable');
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
  const worker = entry.createWorker({store, binding, key, target, owner,
    runtimeIdentity: () => {
      const invocation = context.getStore();assert(invocation && invocation.active);return invocation.runtime;
    }, loadMain: async () => {
      const original = await loadMain(wrappedSdk);assert.strictEqual(typeof original, 'function');
      return async (business, nativeContext) => {
        const result = await original(business, nativeContext);
        const invocation = context.getStore();assert(invocation && invocation.active);
        // Original fire-and-forget / caught child failures must not create a
        // falsely COMPLETE parent while callbacks may still perform writes.
        // The parent journal stays UNKNOWN/occupied, requiring reconciliation.
        // Durable enqueue integration is needed before such routes can deploy.
        if (invocation.pending.size || invocation.failed) throw Error('WRITER_CHILD_OUTCOME_UNSETTLED');
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
      seen: new Set(), pending: new Set(), failed: false};
    return context.run(invocation, async () => {
      try { return await worker(event, nativeContext); }
      finally { invocation.active = false; }
    });
  }
  return {main, sdk: wrappedSdk};
}
module.exports = {createInvocationWorker};
