/**
 * API Client 清理测试（SPEC §8.3 / §11.4 D-5）
 *
 * 守卫：
 *   1. ⛔ `api.macro()` 已删除（D-5 裁定：dead code）
 *   2. ⛔ HTTP 客户端**不得**改 `window.location`（401 语义上移到 app/compose 层）
 *   3. 401 ⇒ 清 token + 调用注入的 unauthorized 钩子（⛔ 不自行跳转）
 *   4. 错误模型可区分 NETWORK / TIMEOUT / HTTP / UNAUTHORIZED / ENVELOPE / PARSE
 *
 * ⚠️ 本套件含 async 断言，使用自带的异步 harness（不能复用同步 `suite()`）。
 * ⚠️ 必须在装好 localStorage 桩之后再 import api.js（动态 import）。
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { API_ERROR_KIND, setUnauthorizedHandler } from '../../src/rewrite/api.js';

/* ---------------- 异步 harness ---------------- */
let pass = 0;
const failures = [];
async function ok(label, fn) {
  try {
    await fn();
    pass++;
    console.log('[PASS] ' + label);
  } catch (e) {
    failures.push({ label, e });
    console.error('[FAIL] ' + label + '\n       ' + (e && e.message));
  }
}

/* ---------------- 1) 静态守卫：源码层面 ---------------- */

const API_SRC = fs.readFileSync(path.join(process.cwd(), 'src', 'rewrite', 'api.js'), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

await ok('⛔ api.js 源码不含 window.location 副作用（SPEC §8.3）', () => {
  const s = strip(API_SRC);
  assert.ok(!/window\.location/.test(s), 'api.js 不得触碰 window.location');
  assert.ok(!/location\.hash/.test(s), 'api.js 不得改 location.hash');
});

await ok('⛔ api.js 已删除 macro()（D-5 裁定）', () => {
  const s = strip(API_SRC);
  assert.ok(!/macro\s*:/.test(s), 'api.js 不得再导出 macro');
  assert.ok(!/\/api\/macro/.test(s), 'api.js 不得再引用 /api/macro');
});

await ok('api.js 声明 6 类错误 kind（可区分失败形态）', () => {
  for (const k of ['NETWORK', 'TIMEOUT', 'HTTP', 'UNAUTHORIZED', 'ENVELOPE', 'PARSE']) {
    assert.ok(API_SRC.includes(k + ':'), '缺错误类型 ' + k);
  }
});

await ok('api.js 提供 setUnauthorizedHandler（钩子注入点）', () => {
  assert.ok(/export function setUnauthorizedHandler/.test(API_SRC));
});

/* ---------------- 2) 运行时行为（带 localStorage 桩） ---------------- */

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k)
};

const mod = await import('../../src/rewrite/api.js');

await ok('token 存取往返正常', () => {
  store.clear();
  assert.equal(mod.getToken(), '');
  mod.setToken('t-123');
  assert.equal(mod.getToken(), 't-123');
  mod.setToken(null);
  assert.equal(mod.getToken(), '');
  mod.setToken('');
  assert.equal(mod.getToken(), '');
});

await ok('⛔ api 导出中**没有** macro（运行时确认）；decisions 保留', () => {
  assert.equal(mod.api.macro, undefined, 'api.macro 必须不存在');
  assert.ok(typeof mod.api.dashboard === 'function');
  assert.ok(typeof mod.api.decisions === 'function', 'decisions 应保留（本轮启用）');
  assert.ok(typeof mod.api.review === 'function');
});

await ok('401 处理：清 token + 调用注入钩子，⛔ 不自行跳转', async () => {
  store.clear();
  mod.setToken('t-old');
  let called = 0;
  setUnauthorizedHandler(() => { called++; });
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ code: 401, data: null, message: '未登录或登录已过期' }) });
  try {
    await assert.rejects(() => mod.admin.gen1Health(),
      (e) => e.kind === API_ERROR_KIND.UNAUTHORIZED && e.name === 'ApiError');
    assert.equal(called, 1, '钩子必须被调用一次');
    assert.equal(mod.getToken(), '', 'token 必须被清空');
    assert.equal(typeof globalThis.window, 'undefined', '⛔ 无 window ⇒ 证明未依赖 location');
  } finally {
    globalThis.fetch = origFetch;
    setUnauthorizedHandler(null);
  }
});

await ok('envelope 非 0 且非 401 ⇒ ENVELOPE 错误，携带 code', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ code: 500, message: '内部错误' }) });
  try {
    await assert.rejects(() => mod.api.dashboard(), (e) => e.kind === API_ERROR_KIND.ENVELOPE && e.code === 500);
  } finally { globalThis.fetch = origFetch; }
});

await ok('HTTP 5xx ⇒ HTTP 错误且 retryable=true', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({ message: 'busy' }) });
  try {
    await assert.rejects(() => mod.api.dashboard(), (e) => e.kind === API_ERROR_KIND.HTTP && e.httpStatus === 503 && e.retryable === true);
  } finally { globalThis.fetch = origFetch; }
});

await ok('HTTP 4xx（非 401）⇒ retryable=false', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 400, json: async () => ({ message: 'bad' }) });
  try {
    await assert.rejects(() => mod.api.dashboard(), (e) => e.kind === API_ERROR_KIND.HTTP && e.retryable === false);
  } finally { globalThis.fetch = origFetch; }
});

await ok('网络异常 ⇒ NETWORK 错误且可重试', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  try {
    await assert.rejects(() => mod.api.dashboard(), (e) => e.kind === API_ERROR_KIND.NETWORK && e.retryable === true);
  } finally { globalThis.fetch = origFetch; }
});

await ok('响应非 JSON ⇒ PARSE 错误', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } });
  try {
    await assert.rejects(() => mod.api.dashboard(), (e) => e.kind === API_ERROR_KIND.PARSE);
  } finally { globalThis.fetch = origFetch; }
});

await ok('envelope 成功时正确解包 data', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ code: 0, data: { ok: 1 } }) });
  try {
    assert.deepEqual(await mod.api.dashboard(), { ok: 1 });
  } finally { globalThis.fetch = origFetch; }
});

await ok('review 带 X-Admin-Token（SPEC §8.1）', async () => {
  store.clear();
  mod.setToken('tok-9');
  let seen = null;
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { seen = init.headers; return { ok: true, status: 200, json: async () => ({ code: 0, data: [] }) }; };
  try {
    await mod.api.review();
    assert.equal(seen['X-Admin-Token'], 'tok-9');
  } finally { globalThis.fetch = origFetch; }
});

await ok('GET 不带 body；POST 带 JSON body', async () => {
  const seen = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { seen.push({ method: init.method, body: init.body }); return { ok: true, status: 200, json: async () => ({ code: 0, data: {} }) }; };
  try {
    await mod.api.dashboard();
    await mod.admin.login('pw');
    assert.equal(seen[0].method, 'GET');
    assert.equal(seen[0].body, undefined, 'GET 不得带 body');
    assert.equal(seen[1].method, 'POST');
    assert.equal(JSON.parse(seen[1].body).password, 'pw');
  } finally { globalThis.fetch = origFetch; }
});

/* ---------------- 汇总 ---------------- */
console.log('\napi-client.test: ' + pass + ' 项全过' + (failures.length ? '，' + failures.length + ' 项失败' : ''));
if (failures.length) {
  throw new Error('api-client.test 失败 ' + failures.length + ' 项：' + failures.map((f) => f.label).join('; '));
}
