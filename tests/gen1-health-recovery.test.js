'use strict';

/**
 * C-2 受控人工恢复（Gen-1 health recovery）回归测试。
 *
 * Owner C-2 裁定 = B（master new-layout lineage）。验收面：
 *   ① 鉴权：/api/admin/gen1/health/review 复用既有 admin token；未授权 → 401；非 POST → 405
 *   ② 恢复成功：DEGRADED + manualReviewConfirmed=true + 当前 runtime data health=OK → OK
 *   ③ fail-closed：当前数据仍坏 → 保持 DEGRADED，且**不落库**
 *   ④ 幂等：已 OK + 确认 → 无非法状态变化、不落库
 *   ⑤ 持久化：恢复后下一次读取 / 下一次 EOD 不得回到旧 DEGRADED
 *   ⑥ ⛔ 防伪：请求体夹带的 health / incomingHealth / runtime_data_health 一律不采纳
 *
 * 用 vm + 内存 DB 加载**真实** cloudfunctions/adminGateway/index.js（不连云端），
 * 并复用 src/common 的 canonical 健康 latch / 熔断实现（⛔ 测试不另造实现）。
 * 运行：node tests/gen1-health-recovery.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
require('./helpers/mock-cloudbase'); // 必须在加载 src/common 之前

const REPO = path.join(__dirname, '..');
const ROOT = path.join(REPO, 'cloudfunctions', 'adminGateway');
const SRC_COMMON = path.join(REPO, 'src', 'common');
const SOURCE = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');

const ROUTE = '/api/admin/gen1/health/review';
const TOKEN = 'TOK-C2-LOCAL-FIXTURE';

const {
  defaultHealthState, computeLatchedState
} = require(path.join(SRC_COMMON, 'utils', 'gen1-health-state'));
const { HEALTH } = require(path.join(SRC_COMMON, 'utils', 'gen1-circuit-breaker'));

/* ------------------------------------------------------------------ 夹具 */

/** 生产实读形态的 latch（2026-10-02 实读：latched=DEGRADED, runtime_data_health=DEGRADED）。 */
function latchDoc(over) {
  return Object.assign({}, defaultHealthState(), {
    _id: 'h1',
    key: 'gen1-health-state',
    current_health: HEALTH.DEGRADED,
    latched_health: HEALTH.DEGRADED,
    manual_review_required: true,
    degraded_at: '2026-09-21T14:20:27.241Z',
    reviewed_at: null,
    reviewed_by: null,
    recovery_allowed: false,
    runtime_data_health: 'DEGRADED',
    economic_health: 'PENDING',
    economic: null,
    updated_at: '2026-10-02T14:20:23.258Z'
  }, over || {});
}

const BATCH_OK = [
  { _id: 'a1', date: '2026-09-29', code: '513310', data_health_status: 'DATA_OK' },
  { _id: 'a2', date: '2026-09-29', code: '515880', data_health_status: 'DATA_OK' },
  { _id: 'a3', date: '2026-09-29', code: '159582', data_health_status: 'DATA_OK' },
  { _id: 'a4', date: '2026-09-29', code: '518880', data_health_status: 'DATA_OK' },
  { _id: 'a5', date: '2026-09-29', code: '159570', data_health_status: 'DATA_OK' }
];

/** 生产实读形态的批次：515880 = DATA_DEGRADED / STATISTICAL_MISSING / ['sideway_range']。 */
const BATCH_STUCK = BATCH_OK.map((r) => (r.code === '515880'
  ? Object.assign({}, r, {
    data_health_status: 'DATA_DEGRADED',
    data_health_reason_code: 'STATISTICAL_MISSING',
    missing_features: ['sideway_range']
  })
  : r));

const TOKEN_ROW = {
  _id: 'p1', key: 'admin_token',
  value: { v: TOKEN, exp: new Date(Date.now() + 86400000) }
};

/** 默认夹具 = **生产实读的卡死形态**（DEGRADED latch + DEGRADED 批次）。 */
function mkStore(over) {
  const data = {
    gen1_health_state: [latchDoc()],
    ml_shadow_signal: BATCH_STUCK,
    param_config: [TOKEN_ROW]
  };
  if (over) over(data);
  return { data: data, failCollections: [], writes: [] };
}

/* -------------------------------------------------------- 真实网关加载器 */

function loadGateway(store) {
  const db = {
    query: async (collection, where, opts) => {
      if (store.failCollections.indexOf(collection) >= 0) {
        throw new Error('simulated db failure: ' + collection);
      }
      let rows = (store.data[collection] || []).map((r) => Object.assign({}, r));
      const w = where || {};
      rows = rows.filter((d) => Object.keys(w).every((k) => d[k] === w[k]));
      const ob = opts && opts.orderBy;
      if (ob && ob.length) {
        const f = ob[0].field;
        const dir = ob[0].direction === 'desc' ? -1 : 1;
        rows.sort((a, b) => (a[f] > b[f] ? dir : (a[f] < b[f] ? -dir : 0)));
      }
      if (opts && opts.limit) rows = rows.slice(0, opts.limit);
      return rows;
    },
    upsert: async (collection, doc, uniqueKey) => {
      store.writes.push({ collection: collection, doc: JSON.parse(JSON.stringify(doc)) });
      const arr = store.data[collection] || (store.data[collection] = []);
      const keys = Object.keys(uniqueKey || {});
      const i = arr.findIndex((d) => keys.every((k) => d[k] === uniqueKey[k]));
      if (i >= 0) arr[i] = Object.assign({}, arr[i], doc);
      else arr.push(Object.assign({}, doc));
      return { created: i < 0, id: 'w' };
    },
    getParamConfig: async () => ({ params: {} }),
    getEtfList: async () => []
  };
  const box = {
    exports: {},
    require: (p) => {
      if (p === './common/utils/db') return db;
      if (p === 'crypto') return crypto;
      if (p === '@cloudbase/node-sdk') {
        return {
          init: () => ({ database: () => ({ collection: () => ({}) }) }),
          SYMBOL_CURRENT_ENV: 'test'
        };
      }
      if (p.indexOf('./common/') === 0) {
        return require(path.join(SRC_COMMON, p.replace(/^\.\/common\//, '')));
      }
      return require(path.join(ROOT, p));
    },
    Date: Date,
    console: console,
    crypto: crypto
  };
  vm.runInNewContext(
    SOURCE + '\nexports.audit = { reviewGen1Health: reviewGen1Health, revalidateRuntimeDataHealth: revalidateRuntimeDataHealth };',
    box
  );
  return { main: box.exports.main, audit: box.exports.audit };
}

/** 走真实 exports.main（含鉴权 + 路由分发）。 */
async function callRoute(store, body, opts) {
  const o = opts || {};
  const gw = loadGateway(store);
  const event = {
    httpMethod: o.method || 'POST',
    path: o.path || ROUTE,
    headers: o.token === null ? {} : { 'x-admin-token': o.token || TOKEN },
    body: (o.rawBody !== undefined) ? o.rawBody : JSON.stringify(body || {})
  };
  return gw.main(event);
}

/* ---------------------------------------------------------------- 断言器 */

let passed = 0;
let failed = 0;
function ck(name, cond, detail) {
  if (cond) { passed += 1; console.log('  PASS ' + name); }
  else {
    failed += 1;
    console.log('  FAIL ' + name + (detail !== undefined && detail !== null
      ? '  ' + JSON.stringify(detail).slice(0, 300) : ''));
  }
}
function noWrite(store, label) {
  ck(label + ' → 零落库', store.writes.length === 0, store.writes.length);
}

/* ------------------------------------------------------------------ 主体 */

async function main() {
  /* ---- ① 鉴权 ---- */
  {
    const st = mkStore();
    const r = await callRoute(st, { manualReviewConfirmed: true }, { token: null });
    ck('① 未授权 → 401', r.code === 401, r);
    noWrite(st, '① 未授权');
  }
  {
    const st = mkStore();
    const r = await callRoute(st, { manualReviewConfirmed: true }, { token: 'WRONG-TOKEN' });
    ck('① 错误 token → 401', r.code === 401, r);
    noWrite(st, '① 错误 token');
  }
  {
    const st = mkStore();
    const r = await callRoute(st, null, { method: 'GET' });
    ck('① 非 POST → 405', r.code === 405, r);
    noWrite(st, '① 非 POST');
  }

  /* ---- ② 恢复成功 ---- */
  {
    const st = mkStore((d) => {
      d.gen1_health_state = [latchDoc({ runtime_data_health: 'OK' })];
      d.ml_shadow_signal = BATCH_OK;
    });
    const r = await callRoute(st, { manualReviewConfirmed: true, reviewedBy: 'owner-declared-A' });
    ck('② code 0', r.code === 0, r);
    const d = (r && r.data) || {};
    ck('② recovery_applied=true', d.recovery_applied === true, d);
    ck('② recovered_from=DEGRADED / to=OK',
      d.recovered_from === 'DEGRADED' && d.recovered_to === 'OK', d);
    ck('② latch_after.latched_health=OK', d.latch_after && d.latch_after.latched_health === 'OK', d.latch_after);
    ck('② manual_review_required true→false', d.latch_after && d.latch_after.manual_review_required === false, d.latch_after);
    ck('② recovery_allowed false→true', d.latch_after && d.latch_after.recovery_allowed === true, d.latch_after);
    ck('② reviewed_at 已写', !!(d.latch_after && d.latch_after.reviewed_at), d.latch_after);
    ck('② reviewed_by 已记录', d.latch_after && d.latch_after.reviewed_by === 'owner-declared-A', d.latch_after);
    ck('② degraded_at 清空', d.latch_after && d.latch_after.degraded_at === null, d.latch_after);
    ck('② 运行时门翻绿（allow_canary）',
      !!(d.gate_after && d.gate_after.allow_canary === true), d.gate_after);
    ck('② 恰好 1 次落库', st.writes.length === 1, st.writes.length);
    const doc = st.writes[0] && st.writes[0].doc;
    ck('② 落库 doc.latched_health=OK', doc && doc.latched_health === 'OK', doc);
    ck('② 落库 doc 保留 economic_health', doc && doc.economic_health === 'PENDING', doc);
    ck('② 落库 doc 不含 read_status/persist_allowed',
      doc && doc.read_status === undefined && doc.persist_allowed === undefined, doc);
  }

  /* ---- ③ fail-closed：数据仍坏（生产实读形态） ---- */
  {
    const st = mkStore();
    const r = await callRoute(st, { manualReviewConfirmed: true });
    ck('③ 数据仍坏 → 409', r.code === 409, r);
    ck('③ 理由 = RUNTIME_DATA_HEALTH_NOT_OK',
      /RECOVERY_RUNTIME_DATA_HEALTH_NOT_OK/.test(String(r.message)), r.message);
    noWrite(st, '③ 数据仍坏');
  }
  /* ---- ③b fail-closed：runtime OK 但批次仍有 DEGRADED（交叉校验真的在生效） ---- */
  {
    const st = mkStore((d) => {
      d.gen1_health_state = [latchDoc({ runtime_data_health: 'OK' })];
    });
    const r = await callRoute(st, { manualReviewConfirmed: true });
    ck('③b runtime OK 但批次未全 OK → 409', r.code === 409, r);
    ck('③b 理由 = HEALTH_BATCH_NOT_OK',
      /RECOVERY_HEALTH_BATCH_NOT_OK/.test(String(r.message)), r.message);
    noWrite(st, '③b 批次未全 OK');
  }

  /* ---- ④ 人工确认缺失 / 非布尔 ---- */
  {
    const st = mkStore((d) => {
      d.gen1_health_state = [latchDoc({ runtime_data_health: 'OK' })];
      d.ml_shadow_signal = BATCH_OK;
    });
    const r1 = await callRoute(st, {});
    ck('④ 缺确认 → 400', r1.code === 400, r1);
    ck('④ 理由 = NOT_CONFIRMED', /RECOVERY_NOT_CONFIRMED/.test(String(r1.message)), r1.message);
    const r2 = await callRoute(st, { manualReviewConfirmed: 'true' });
    ck('④ 字符串 "true" 不算确认 → 400', r2.code === 400, r2);
    noWrite(st, '④ 确认缺失');
  }

  /* ---- ⑤ 幂等 ---- */
  {
    const st = mkStore((d) => {
      d.gen1_health_state = [latchDoc({
        current_health: 'OK', latched_health: 'OK', manual_review_required: false,
        degraded_at: null, runtime_data_health: 'OK'
      })];
      d.ml_shadow_signal = BATCH_OK;
    });
    const r = await callRoute(st, { manualReviewConfirmed: true });
    ck('⑤ 已 OK → code 0', r.code === 0, r);
    ck('⑤ recovery_applied=false', (r.data || {}).recovery_applied === false, r.data);
    ck('⑤ idempotent=true', (r.data || {}).idempotent === true, r.data);
    ck('⑤ 理由 = ALREADY_UP', (r.data || {}).reason_code === 'RECOVERY_ALREADY_UP', r.data);
    noWrite(st, '⑤ 幂等');
  }

  /* ---- ⑥ 持久化：恢复后不得回退 ---- */
  {
    const st = mkStore((d) => {
      d.gen1_health_state = [latchDoc({ runtime_data_health: 'OK' })];
      d.ml_shadow_signal = BATCH_OK;
    });
    await callRoute(st, { manualReviewConfirmed: true });
    const persisted = st.data.gen1_health_state[0];
    ck('⑥ 持久化后 latched=OK', persisted && persisted.latched_health === 'OK', persisted);
    const next = computeLatchedState(persisted, HEALTH.OK, { now: 'T-next' });
    ck('⑥ 下一次 EOD（数据 OK、无确认）不回退',
      next.state.latched_health === 'OK', next.state.latched_health);
    ck('⑥ 下一次 EOD manual_review_required 仍 false',
      next.state.manual_review_required === false, next.state.manual_review_required);
    const reBad = computeLatchedState(persisted, HEALTH.DEGRADED, { now: 'T-bad' });
    ck('⑥ 数据再坏仍可重新 latch（fail-closed 方向未被削弱）',
      reBad.state.latched_health === 'DEGRADED' && reBad.state.manual_review_required === true,
      reBad.state.latched_health);
  }

  /* ---- ⑦ ⛔ 防伪：请求体夹带的健康值一律不采纳 ---- */
  {
    const st = mkStore();
    const r = await callRoute(st, {
      manualReviewConfirmed: true,
      health: 'OK', incomingHealth: 'OK', dataHealth: 'OK',
      runtime_data_health: 'OK', latched_health: 'OK',
      manual_review_required: false, recovery_allowed: true
    });
    ck('⑦ 夹带 OK 不采纳 → 409', r.code === 409, r);
    ck('⑦ 理由仍 = RUNTIME_DATA_HEALTH_NOT_OK',
      /RECOVERY_RUNTIME_DATA_HEALTH_NOT_OK/.test(String(r.message)), r.message);
    noWrite(st, '⑦ 夹带健康值');
  }

  /* ---- ⑧ ML_OFF 不在 C-2 授权范围 ---- */
  {
    const st = mkStore((d) => {
      d.gen1_health_state = [latchDoc({
        current_health: 'ML_OFF', latched_health: 'ML_OFF', ml_off_at: '2026-09-21T00:00:00.000Z',
        runtime_data_health: 'OK'
      })];
      d.ml_shadow_signal = BATCH_OK;
    });
    const r = await callRoute(st, { manualReviewConfirmed: true });
    ck('⑧ ML_OFF → 409', r.code === 409, r);
    ck('⑧ 理由 = ML_OFF_OUT_OF_SCOPE',
      /RECOVERY_ML_OFF_OUT_OF_SCOPE/.test(String(r.message)), r.message);
    noWrite(st, '⑧ ML_OFF');
  }

  /* ---- ⑨ latch 读取异常 / 未初始化 ---- */
  {
    const st = mkStore((d) => {
      d.gen1_health_state = [latchDoc({ runtime_data_health: 'OK' })];
      d.ml_shadow_signal = BATCH_OK;
    });
    st.failCollections = ['gen1_health_state'];
    const r = await callRoute(st, { manualReviewConfirmed: true });
    ck('⑨ latch 读异常 → 409', r.code === 409, r);
    ck('⑨ 理由 = LATCH_READ_ERROR', /RECOVERY_LATCH_READ_ERROR/.test(String(r.message)), r.message);
    noWrite(st, '⑨ latch 读异常');
  }
  {
    const st = mkStore((d) => { d.gen1_health_state = []; });
    const r = await callRoute(st, { manualReviewConfirmed: true });
    ck('⑨b latch 未初始化 → 409', r.code === 409, r);
    ck('⑨b 理由 = LATCH_NOT_INITIALIZED',
      /RECOVERY_LATCH_NOT_INITIALIZED/.test(String(r.message)), r.message);
    noWrite(st, '⑨b 未初始化');
  }

  /* ---- ⑩ 经济健康仍下行 → 由 canonical 合成拒绝 ---- */
  {
    const st = mkStore((d) => {
      d.gen1_health_state = [latchDoc({ runtime_data_health: 'OK', economic_health: 'DEGRADED' })];
      d.ml_shadow_signal = BATCH_OK;
    });
    const r = await callRoute(st, { manualReviewConfirmed: true });
    ck('⑩ economic=DEGRADED → 409', r.code === 409, r);
    ck('⑩ 理由 = GATE_NOT_SATISFIED', /RECOVERY_GATE_NOT_SATISFIED/.test(String(r.message)), r.message);
    noWrite(st, '⑩ 经济健康下行');
  }

  /* ---- ⑪ 批次不可读 → fail-closed ---- */
  {
    const st = mkStore((d) => {
      d.gen1_health_state = [latchDoc({ runtime_data_health: 'OK' })];
    });
    st.failCollections = ['ml_shadow_signal'];
    const r = await callRoute(st, { manualReviewConfirmed: true });
    ck('⑪ 批次不可读 → 409', r.code === 409, r);
    ck('⑪ 理由 = HEALTH_BATCH_UNAVAILABLE',
      /RECOVERY_HEALTH_BATCH_UNAVAILABLE/.test(String(r.message)), r.message);
    noWrite(st, '⑪ 批次不可读');
  }

  /* ---- ⑫ 静态范围守卫（复用 canonical，⛔ 不另造实现 / 不碰 C3-R2） ---- */
  {
    const stripped = SOURCE
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    ck('⑫ 复用 canonical latch 模块',
      /require\('\.\/common\/utils\/gen1-health-state'\)/.test(stripped));
    ck('⑫ 复用 canonical 熔断模块',
      /require\('\.\/common\/utils\/gen1-circuit-breaker'\)/.test(stripped));
    ck('⑫ ⛔ 未新建第三份 latch 实现',
      !/function\s+(computeLatchedState|readHealthState|writeHealthState|healthStateToGate)/.test(stripped));
    ck('⑫ ⛔ 未新建第三份健康/熔断实现',
      !/function\s+(computeHealthStatus|circuitGate|evaluateDataHealth)/.test(stripped));
    ck('⑫ ⛔ 未引入 C3-R2 数据健康模块（不扩范围）',
      !/require\('\.\/common\/utils\/gen1-data-health'\)/.test(stripped));
    ck('⑫ 恢复路由已登记进 POST_ONLY（纯写路径）',
      /POST_ONLY[\s\S]{0,700}'\/api\/admin\/gen1\/health\/review'/.test(stripped));
    ck('⑫ 恢复路由受 /api/admin/* 统一鉴权覆盖（前缀未绕过）',
      /path\.startsWith\('\/api\/admin\/'\)/.test(stripped));
    ck('⑫ ⛔ 未读请求体传入的健康值',
      !/p\.(health|incomingHealth|dataHealth|runtime_data_health|latched_health)\b/.test(stripped));

    const dh = fs.readFileSync(path.join(SRC_COMMON, 'utils', 'gen1-data-health.js'), 'utf8');
    ck('⑫ C3-R2 双域拆分未被改动（HARD + SEMANTICALLY_NULLABLE + 取域分离）',
      /HARD_REQUIRED_FEATURES/.test(dh) && /SEMANTICALLY_NULLABLE_FEATURES/.test(dh)
      && /hardRequired\.filter/.test(dh) && /required\.filter/.test(dh));
    assert.ok(true);
  }

  console.log('\nC-2 recovery: ' + passed + ' passed / ' + failed + ' failed');
  if (failed) process.exit(1);
  console.log('gen1 C-2 health recovery tests passed');
}

main().catch((e) => {
  console.error('UNCAUGHT: ' + ((e && e.stack) || e));
  process.exit(1);
});
