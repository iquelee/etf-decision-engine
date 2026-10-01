#!/usr/bin/env node
'use strict';
/**
 * E-006 / A2 —— 生产根入口**产物级**验证器
 *
 * 用途：在**一次真实 `vite build` 之后**核对 `web/dist/` 的三个入口与资源引用，
 *       补上单元测试无法覆盖的「产物映射 / 引用存在性 / content-hash / base 相对路径」四项。
 *
 * 为什么单独一个脚本：`web/tests/rewrite/entry-convergence.test.js` 在**无新构建产物**时
 * 会把这些项标 `[SKIP]`（本 Agent 环境的 `vite build` 被沙箱批量删除守卫拦截）；
 * 真实构建（非 shim 环境 / CI）后用它做产物校验，两者结论应当一致。
 *
 * 用法：
 *   # 默认态（根入口 = Legacy）
 *   node tests/tools/verify-entry-artifact.cjs
 *   node tests/tools/verify-entry-artifact.cjs --expect=legacy-root
 *
 *   # 生产候选（根入口 = V3.6.5 Rewrite）
 *   VITE_ENABLE_REWRITE_ENTRY=1 node tests/tools/verify-entry-artifact.cjs --expect=rewrite-root
 *
 * 退出码：0 = 全部通过；1 = 存在不符合项（逐条打印）。
 */

const fs = require('fs');
const path = require('path');

const WEB = path.resolve(__dirname, '..', '..');
const DIST = path.join(WEB, 'dist');

const expectArg = (process.argv.find((a) => a.startsWith('--expect=')) || '').split('=')[1];
const expectMode = expectArg
  || (String(process.env.VITE_ENABLE_REWRITE_ENTRY) === '1' ? 'rewrite-root' : 'legacy-root');

if (expectMode !== 'legacy-root' && expectMode !== 'rewrite-root') {
  console.error('[FAIL] --expect 只接受 legacy-root | rewrite-root，收到: ' + expectArg);
  process.exit(1);
}

const rootBoot = expectMode === 'rewrite-root' ? 'rewrite' : 'legacy';
const failures = [];
const notes = [];

function fail(m) { failures.push(m); }

function bootOf(html) {
  const hasApp = /id="app"/.test(html);
  const hasRewriteApp = /id="rewrite-app"/.test(html);
  const hasMain = /src="\/src\/main\.js"/.test(html);
  const hasRewriteEntry = /src="\/src\/rewrite\/app\.js"/.test(html);
  if (hasRewriteApp && hasRewriteEntry) return 'rewrite';
  if (hasApp && hasMain) return 'legacy';
  // 产物里脚本 src 已被改写为 hash 文件，因此再退化用「挂载点」判定
  if (hasRewriteApp) return 'rewrite';
  if (hasApp) return 'legacy';
  return 'unknown';
}

function assetRefs(html) {
  return Array.from(html.matchAll(/(?:src|href)="(\.\/assets\/[^"]+)"/g)).map((m) => m[1]);
}

if (!fs.existsSync(DIST)) {
  console.error('[FAIL] 未找到 ' + DIST + ' —— 请先执行一次真实构建（npm run build）。');
  process.exit(1);
}

const targets = [
  ['index.html', rootBoot],
  ['legacy.html', 'legacy'],
  ['rewrite.html', 'rewrite']
];

for (const [file, want] of targets) {
  const p = path.join(DIST, file);
  if (!fs.existsSync(p)) { fail('缺产物 ' + file); continue; }
  const html = fs.readFileSync(p, 'utf8');
  const got = bootOf(html);
  if (got !== want) fail(file + ' 引导身份错：期望 ' + want + '，实际 ' + got);

  const refs = assetRefs(html);
  if (refs.length === 0) fail(file + ' 未引用任何 ./assets 资源');
  for (const r of refs) {
    if (!r.startsWith('./assets/')) fail(file + ' 资源非相对 ./assets/ 形式：' + r);
    const f = path.join(DIST, r.replace(/^\.\//, ''));
    if (!fs.existsSync(f)) fail(file + ' 引用不存在的资源：' + r);
    else if (!/-[A-Za-z0-9_-]{8,}\.(js|css)$/.test(r)) fail(file + ' 资源名缺 content hash：' + r);
  }
  notes.push(file + ' → ' + got + '（引用 ' + refs.length + ' 个资源）');
}

// deploy-hosting-web.js 的前置断言：dist/assets/Dashboard-*.js 必须存在（旧前端仍在构建图中）
const assetsDir = path.join(DIST, 'assets');
if (!fs.existsSync(assetsDir)) {
  fail('缺 dist/assets 目录');
} else {
  const assets = fs.readdirSync(assetsDir);
  if (!assets.some((f) => /^Dashboard-.*\.js$/.test(f))) {
    fail('缺 Dashboard-*.js —— scripts/deploy-hosting-web.js 的前置断言会失败（旧前端是否被移出构建图？）');
  }
  if (expectMode === 'rewrite-root' && !assets.some((f) => /^rewrite-.*\.js$/.test(f) || /^index-.*\.js$/.test(f))) {
    fail('rewrite-root 模式下未找到 rewrite 入口 chunk');
  }
}

console.log('=== verify-entry-artifact（期望模式：' + expectMode + '）===');
for (const n of notes) console.log('  · ' + n);
if (failures.length) {
  console.error('\n[FAIL] ' + failures.length + ' 项不符合：');
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log('\n[PASS] 全部符合（根入口 = ' + rootBoot + '）');
