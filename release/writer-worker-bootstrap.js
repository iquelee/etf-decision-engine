'use strict';
// Offline signed RPC / local Timer / admin HTTP wiring. No cloud bootstrap.
const assert = require('assert');
const entry = require('./writer-entry');
const {createInvocationWorker} = require('./writer-invocation-worker');
const {createLocalRoot} = require('./writer-local-root');
const {createTimerIdentity, policies: timerPolicies} = require('./writer-timer-identity');
const {createAdminHttpRoot, inspect: inspectAdmin} = require('./writer-admin-http');
const {createAdminMaintenanceCheck} = require('./writer-admin-maintenance');
const {createProductionStore, productionNamespace} = require('./writer-journal-cloudbase');
const plans = Object.freeze({
  runDecisionEngine: Object.freeze({target: 'runDecisionEngineNode24', key: 'WRITER_RDE_SIGNING_KEY_HEX'}),
  materializeIndicators: Object.freeze({target: 'materializeIndicatorsNode24', key: 'WRITER_MATERIALIZER_SIGNING_KEY_HEX'}),
  adminGateway: Object.freeze({target: 'adminGatewayNode24', key: 'WRITER_ADMIN_SIGNING_KEY_HEX'}),
  fetchDailyData: Object.freeze({target: 'fetchDailyDataNode24', key: 'WRITER_DAILY_SIGNING_KEY_HEX'}),
  fetchRealtimeData: Object.freeze({target: 'fetchRealtimeDataNode24', key: 'WRITER_REALTIME_SIGNING_KEY_HEX'}),
  fetchFundamentalNews: Object.freeze({target: 'fetchFundamentalNewsNode24', key: 'WRITER_NEWS_SIGNING_KEY_HEX'}),
  extractFundamental: Object.freeze({target: 'extractFundamentalNode24', key: 'WRITER_EXTRACT_SIGNING_KEY_HEX'}),
  runGen1ShadowEod: Object.freeze({target: 'runGen1ShadowEodNode24', key: 'WRITER_GEN1_SIGNING_KEY_HEX'}),
  runGen2ShadowEod: Object.freeze({target: 'runGen2ShadowEodNode24', key: 'WRITER_GEN2_SIGNING_KEY_HEX'})
});
// Only awaited business edges are declared here. Detached refresh work still
// requires a durable enqueue design before the production candidates can run.
const children = Object.freeze({
  fetchDailyData: Object.freeze({producer: 'materializeIndicators', action: 'materialize'}),
  materializeIndicators: Object.freeze({producer: 'runDecisionEngine', action: 'decision'}),
  adminGateway: Object.freeze({producer: 'runDecisionEngine', action: 'decision'})
});
const denied = () => ({protocol: 'writer-result-v1', executed: false, admission: 'ENTRY_AUTHENTICATION_FAILED'});
function createBootstrap({producer, sdk, sdkVersion, databaseVersion, loadMain,
  readEnvironment = name => process.env[name], nodeMajor = () => Number(process.versions.node.split('.')[0])}) {
  assert(Object.hasOwn(plans, producer), 'package producer not declared');
  assert(sdkVersion === '2.11.0' && databaseVersion === '1.4.1', 'captured SDK versions required');
  assert(sdk && typeof sdk.init === 'function' && typeof sdk.getCloudbaseContext === 'function');
  assert(typeof loadMain === 'function');
  const plan = plans[producer], environment = productionNamespace.environment;
  const binding = Object.freeze({environment, scope: 'production/' + producer});
  let service, timerRoot, httpRoot, sealedKeys;
  function keys() {
    const names = [plan.key];
    if (Object.hasOwn(children, producer)) names.push(plans[children[producer].producer].key);
    return names.map(name => {
      const raw = readEnvironment(name);
      assert(typeof raw === 'string' && /^[0-9a-fA-F]{64}$/.test(raw), 'explicit 32-byte signing key required');
      return Buffer.from(raw, 'hex');
    });
  }
  function runtime(context) {
    // Qualified SDK API takes NO event argument. Never read identity from input.
    const observed = sdk.getCloudbaseContext();
    assert(observed && (observed.TCB_ENV || observed.SCF_NAMESPACE) === environment);
    assert(context && context.function_name === plan.target && nodeMajor() === 24);
    return {environment, function_name: context.function_name, node_major: 24, trigger_source: observed.TRIGGER_SRC};
  }
  const timerIdentity = Object.hasOwn(timerPolicies, producer) ?
    createTimerIdentity({environment, producer, target: plan.target, runtimeIdentity: runtime}) : null;
  const configuredSdk = new Proxy(sdk, {get(original, property) {
    if (property !== 'init') return Reflect.get(original, property, original);
    return (config = {}) => {
      assert(config && typeof config === 'object' && !Array.isArray(config));
      assert(config.env === undefined || config.env === environment ||
        (original.SYMBOL_CURRENT_ENV !== undefined && config.env === original.SYMBOL_CURRENT_ENV), 'SDK environment mismatch');
      assert(config.retries === undefined || config.retries === 0, 'SDK retry forbidden');
      assert(config.keepalive === undefined || config.keepalive === false, 'socket resend forbidden');
      return original.init({...config, env: environment, retries: 0, keepalive: false});
    };
  }});
  function prepare(currentKeys) {
    if (service) {
      assert(currentKeys.every((key, i) => key.equals(sealedKeys[i])), 'warm key rotation requires restart');
      return;
    }
    const database = configuredSdk.init({timeout: 15000}).database();
    const recordCompletion = ['fetchFundamentalNews', 'extractFundamental'].includes(producer);
    const store = recordCompletion ? require('./writer-journal-cloudbase').createCoreCompletionStore({database, binding}) : createProductionStore({database, binding});
    const childRoutes = {};
    if (Object.hasOwn(children, producer)) {
      const child = children[producer], childBinding = {environment, scope: 'production/' + child.producer};
      childRoutes[child.producer] = {binding: childBinding, store: createProductionStore({database, binding: childBinding}),
        key: currentKeys[1], action: child.action, transportTimeoutMs: 15000,
        targets: {old: child.producer, new: plans[child.producer].target}, allowedOwners: ['new']};
    }
    let beforeAdmission;
    const rolloutBinding = {environment, scope: 'production/writer-rollout'};
    const checkedRows = r => {
      assert(r && !r.code && typeof r.requestId === 'string' && r.requestId.length && Array.isArray(r.data));return r.data;
    };
    if (producer === 'adminGateway') beforeAdmission = createAdminMaintenanceCheck({binding: rolloutBinding, readRollout: async () => {
      const rows = checkedRows(await database.collection(productionNamespace.collection).doc('rollout:adminGateway').get());
      assert(rows.length <= 1);if (!rows.length) return null;
      const {_id, ...record} = rows[0];assert.strictEqual(_id, 'rollout:adminGateway');return record;
    }});
    const dispatchStore = producer === 'adminGateway' ? require('./writer-dispatch-cloudbase').createStore({database}) : undefined;
    const candidate = createInvocationWorker({sdk: configuredSdk, store, binding, key: currentKeys[0], target: plan.target,
      owner: 'new', producer, runtimeIdentity: runtime, loadMain, childRoutes, beforeAdmission, recordCompletion,
      ...(dispatchStore ? {dispatchStore} : {})});
    const candidateRoot = timerIdentity ? createLocalRoot({store, binding, target: plan.target, owner: 'new', key: currentKeys[0],
      identify: timerIdentity, runtimeIdentity: runtime, worker: candidate.main}) : null;
    const candidateHttp = producer === 'adminGateway' ? createAdminHttpRoot({binding, target: plan.target, owner: 'new',
      key: currentKeys[0], store, runtimeIdentity: runtime, beforeAdmission, worker: candidate.main,
      readToken: async () => {
        const rows = checkedRows(await database.collection('param_config').where({key: 'admin_token'}).limit(2).get());
        return rows.length === 1 && rows[0].value ? rows[0].value : null;
      }, readDispatch: id => dispatchStore.read(id), loadReadMain: () => loadMain(candidate.sdk)}) : null;
    service = candidate;timerRoot = candidateRoot;httpRoot = candidateHttp;
    sealedKeys = currentKeys.map(key => Buffer.from(key));
  }
  return {
    async main(event, context) {
      let mode = producer === 'adminGateway' && !(event && event.protocol === 'writer-entry-v1') ? 'http' : 'signed';
      try {
        runtime(context);
        const currentKeys = keys();
        if (event && event.protocol === 'writer-entry-v1')
          entry.authenticate(event, {binding, target: plan.target, owner: 'new', key: currentKeys[0]});
        else if (mode === 'http') {
          try {inspectAdmin(event);} catch (_) {return {code: 400, data: null, message: '请求或操作标识无效'};}
        } else {
          assert(timerIdentity, 'no native timer declared');
          await timerIdentity(event, context);mode = 'timer';
        }
        prepare(currentKeys);
      } catch (_) { return mode === 'http' ? {code: 503, data: null, message: '写入入口不可用'} : denied(); }
      return mode === 'timer' ? timerRoot(event, context) : mode === 'http' ? httpRoot(event, context) : service.main(event, context);
    },
    getBusinessSdk() { assert(service, 'authenticated invocation required before SDK import');return service.sdk; }
  };
}
module.exports = {createBootstrap, plans};
