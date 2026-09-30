/**
 * V365 新前端测试运行器（零新增依赖，用 Node 原生 ESM + node:assert）
 *
 * 用法（在 web/ 目录下）：
 *     node tests/run-rewrite-tests.js
 *  或 npm run test:rewrite
 *
 * 说明：本运行器**不启动子进程**（本机沙箱禁 spawnSync/execSync），
 *      全部用例在**同一进程内**顺序 import，靠抛错判定失败。
 */
'use strict';

const SUITES = [
  /* --- domain --- */
  './rewrite/format.test.js',
  './rewrite/format-semantics.test.js',
  './rewrite/lifecycle.test.js',
  /* --- adapters（M2） --- */
  './rewrite/adapters-gen1.test.js',
  './rewrite/adapters-pages.test.js',
  './rewrite/gen2-boundary.test.js',
  './rewrite/edge-malformed.test.js',
  /* --- transport（M2 清理） --- */
  './rewrite/api-client.test.js',
  /* --- 工程守卫（M0/M1） --- */
  './rewrite/design-tokens.test.js',
  './rewrite/router-contract.test.js',
  './rewrite/layering.test.js',
  './rewrite/spec-guards.test.js'
];

const results = [];
let failed = 0;

for (const s of SUITES) {
  const name = s.replace('./rewrite/', '').replace('.test.js', '');
  try {
    await import(s);
    results.push({ name, ok: true });
  } catch (e) {
    failed++;
    results.push({ name, ok: false, err: (e && e.message) || String(e) });
    console.error('\n[FAIL] ' + name + '\n' + ((e && e.stack) || e));
  }
}

console.log('\n================ rewrite test summary ================');
for (const r of results) {
  console.log((r.ok ? '  PASS  ' : '  FAIL  ') + r.name + (r.ok ? '' : '  ← ' + r.err));
}
console.log('  ------------------------------------------------');
console.log('  suites: ' + results.length + '  failed: ' + failed);
console.log('======================================================');

if (failed > 0) process.exit(1);
