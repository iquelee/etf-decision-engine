#!/usr/bin/env node
'use strict';
/**
 * E-006 / A2 —— 生产根入口**产物级**验证器
 *
 * 用途：在**一次真实 `vite build` 之后**核对 `web/dist/` 的三个入口与资源引用，
 *       补上单元测试无法覆盖的「产物映射 / 引用存在性 / content-hash / base 相对路径」四项。
 *
 * ★ 入口身份（entry identity）的判据 —— ⛔ **不按 chunk 文件名猜测**：
 *   同一份 `vite.config.js` 下，entry chunk 的**文件名**会随「哪些入口共享同一模块」而变。
 *   实测（2026-10-01，真实双状态构建）：
 *     · `legacy-root`  模式：index.html → `main-*.js`    rewrite.html → `rewrite-*.js`
 *     · `rewrite-root` 模式：index.html → `app-*.js`     legacy.html  → `legacy-*.js`
 *   ⇒ 任何 `rewrite-*` / `index-*` 之类的名字模式断言都是**假阳性源**（已验证会误报）。
 *   本脚本改为比对**入口模块文件本身**（同一文件 = 同一入口）：
 *     · `legacy-root`  ⇒ **index.html ≡ legacy.html** 且 **index.html ≠ rewrite.html**
 *     · `rewrite-root` ⇒ **index.html ≡ rewrite.html** 且 **index.html ≠ legacy.html**
 *   这两个不变量与文件名无关，是 A2 语义的直接表达。
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
/** file → 入口模块文件名（**语义身份**，⛔ 与 chunk 命名无关） */
const entries = {};

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

/**
 * 取「主要 entry module」的**文件名**（形如 `app-BWRjnT2Z.js`）。
 *
 * ⛔ 刻意**不**按文件名模式判身份（原因见文件头：命名随模式漂移）。
 * 规则：entry 是文档中**最后**一个 `<script type="module" src="./assets/*.js">`
 *       —— Vite 先注入被提升的共享 chunk，再注入入口 chunk。
 *       属性顺序不敏感（先取整个 `<script …>` 标签，再从中取 `src`）。
 *
 * @param {string} html
 * @returns {string|null} 入口模块文件名（已去掉 `./assets/` 前缀）；未找到 ⇒ null
 */
function entryModule(html) {
  const srcs = [];
  for (const m of html.matchAll(/<script\b[^>]*>/g)) {
    const tag = m[0];
    if (!/\btype="module"/.test(tag)) continue;
    const s = /\bsrc="(\.\/assets\/[^"]+\.js)"/.exec(tag);
    if (s) srcs.push(s[1].replace(/^\.\/assets\//, ''));
  }
  return srcs.length ? srcs[srcs.length - 1] : null;
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

  const entry = entryModule(html);
  entries[file] = entry;
  if (!entry) fail(file + ' 未找到任何 `<script type="module" src="./assets/*.js">` 入口模块');

  const refs = assetRefs(html);
  if (refs.length === 0) fail(file + ' 未引用任何 ./assets 资源');
  for (const r of refs) {
    if (!r.startsWith('./assets/')) fail(file + ' 资源非相对 ./assets/ 形式：' + r);
    const f = path.join(DIST, r.replace(/^\.\//, ''));
    if (!fs.existsSync(f)) fail(file + ' 引用不存在的资源：' + r);
    else if (!/-[A-Za-z0-9_-]{8,}\.(js|css)$/.test(r)) fail(file + ' 资源名缺 content hash：' + r);
  }
  notes.push(file + ' → ' + got + '（引用 ' + refs.length + ' 个资源；入口模块 ' + (entry || '?') + '）');
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
}

/**
 * ★ 入口身份（A2 核心不变量）—— **语义判据，⛔ 与 chunk 文件名无关**。
 *   legacy-root  ⇒ index.html ≡ legacy.html  且  index.html ≠ rewrite.html
 *   rewrite-root ⇒ index.html ≡ rewrite.html 且  index.html ≠ legacy.html
 * （原实现用 `/^rewrite-.*\.js$/ || /^index-.*\.js$/` 猜身份 —— 在 rewrite-root 模式下
 *   入口实名为 `app-*.js`，会**假 FAIL**。已废弃，⛔ 不得再按文件名判身份。）
 */
const IDENTITY = {
  'legacy-root': { same: ['index.html', 'legacy.html'], differ: ['index.html', 'rewrite.html'] },
  'rewrite-root': { same: ['index.html', 'rewrite.html'], differ: ['index.html', 'legacy.html'] }
};
const idRules = IDENTITY[expectMode];

for (const [kind, pair] of [['same', idRules.same], ['differ', idRules.differ]]) {
  const a = pair[0];
  const b = pair[1];
  if (!entries[a] || !entries[b]) continue;   // 文件缺失 / 无入口 ⇒ 已在上面报错
  const sameNow = entries[a] === entries[b];
  if (kind === 'same' && !sameNow) {
    fail(a + ' 与 ' + b + ' 的入口模块必须相同，实际 ' + entries[a] + ' vs ' + entries[b]);
  } else if (kind === 'differ' && sameNow) {
    fail(a + ' 与 ' + b + ' 的入口模块必须不同，实际同为 ' + entries[a]);
  } else {
    notes.push('entry identity: ' + a + ' ' + (kind === 'same' ? '≡' : '≠') + ' ' + b
      + '（' + entries[a] + (kind === 'same' ? '' : ' vs ' + entries[b]) + '）');
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
