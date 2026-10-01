/**
 * E-006 / A2 —— 生产根入口收敛守卫
 *
 * 规范依据：SPEC §18-1 · 风险台账 `E-006` · 实现 `web/vite-config/rewrite-root-entry.js`
 *
 * 覆盖 owner 指定的 Case A~G：
 *   A  flag 未设置/0  ⇒ index.html=Legacy · legacy.html=Legacy · rewrite.html=Rewrite
 *   B  flag=1         ⇒ index.html=Rewrite · legacy.html=Legacy · rewrite.html=Rewrite
 *   C  所有 HTML 引用的 JS/CSS 实际存在
 *   D  `base:'./'` 下 asset URL 形如 `./assets/...`
 *   E  content-hashed asset 与 HTML 引用一致（引用即存在，且为哈希文件名）
 *   F  Rewrite 路由 smoke：`#/etf/513310` · `#/structure` · `#/structure/513310`
 *   G  Legacy：`/legacy.html` 能正常加载（源码级 smoke）
 *
 * ⚠️ 环境限制（诚实登记，⛔ 不伪造 PASS）：
 *   「产物级」检查（C/D/E 与产出的入口映射）需要**一次真实构建**。本 Agent 环境里
 *   `vite build` 会被沙箱批量删除守卫拦截（`CODEBUDDY_SAFE_DELETE_BULK_GUARD`：
 *   `emptyOutDir` 清空 `dist/assets` 触发），且本轮**禁止**关闭 guard / 改 guard /
 *   用临时 outDir 规避 ⇒ 这些项在本环境**无法执行**。
 *   ⇒ 无「新于本次改动」的产物时，本套件对它们输出 `[SKIP]` + 原因；
 *     真实构建后（非 shim 环境或 CI）用同一套件，或
 *     `node tests/tools/verify-entry-artifact.cjs` 完成产物验证。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  ENV_FLAG,
  LEGACY_BOOT,
  REWRITE_BOOT,
  convergeRootEntry,
  isRewriteRootEntryEnabled,
  isRootEntryHtml,
  rewriteRootEntryPlugin
} from '../../vite-config/rewrite-root-entry.js';
import { routes, LEGACY_REDIRECTS, FRONT_NAV } from '../../src/rewrite/routes.js';

const CWD = process.cwd();
const DIST = path.join(CWD, 'dist');

let pass = 0;
function ok(name, fn) { fn(); pass++; console.log('[PASS] ' + name); }
function skip(name, why) { console.log('[SKIP] ' + name + ' —— ' + why); }

const read = (p) => fs.readFileSync(p, 'utf8');
const INDEX_SRC = read(path.join(CWD, 'index.html'));
const LEGACY_SRC = read(path.join(CWD, 'legacy.html'));
const REWRITE_SRC = read(path.join(CWD, 'rewrite.html'));

/** 从 HTML 里取引导身份：rewrite / legacy / unknown */
function bootOf(html) {
  if (/id="rewrite-app"/.test(html) && /src="\/src\/rewrite\/app\.js"/.test(html)) return 'rewrite';
  if (/id="app"/.test(html) && /src="\/src\/main\.js"/.test(html)) return 'legacy';
  return 'unknown';
}

/** 取 HTML 引用的产物资源（`./assets/*`） */
function assetRefs(html) {
  return Array.from(html.matchAll(/(?:src|href)="(\.\/assets\/[^"]+)"/g)).map((m) => m[1]);
}

/* ───────────────────────── 源码级事实（永远可跑） ───────────────────────── */

ok('开关语义：仅精确 "1" 开启；未设置/其它值一律关闭', () => {
  assert.equal(isRewriteRootEntryEnabled('1'), true);
  for (const v of [undefined, '', '0', 'true', 'yes', '2']) {
    assert.equal(isRewriteRootEntryEnabled(v), false, '非 "1" 的值必须视为关闭: ' + String(v));
  }
  assert.equal(ENV_FLAG, 'VITE_ENABLE_REWRITE_ENTRY');
});

ok('只认根入口：index.html 命中，legacy.html / rewrite.html 不命中', () => {
  assert.equal(isRootEntryHtml('/index.html'), true);
  assert.equal(isRootEntryHtml('C:/x/web/index.html'), true);
  assert.equal(isRootEntryHtml('C:\\x\\web\\index.html'), true);
  for (const p of ['/legacy.html', '/rewrite.html', '/x/legacy.html', '/x/rewrite.html', '']) {
    assert.equal(isRootEntryHtml(p), false, '不应命中: ' + p);
  }
});

ok('★ 源码引导身份（收敛前基线）：index.html=Legacy · legacy.html=Legacy · rewrite.html=Rewrite', () => {
  assert.equal(bootOf(INDEX_SRC), 'legacy', 'index.html 源文件必须仍是 Legacy 引导');
  assert.equal(bootOf(LEGACY_SRC), 'legacy', 'legacy.html 必须是 Legacy 引导');
  assert.equal(bootOf(REWRITE_SRC), 'rewrite', 'rewrite.html 必须是 Rewrite 引导');
});

ok('★ 漂移守卫：index.html 与 legacy.html 必须逐字节一致（防两处 legacy 引导各自漂移）', () => {
  assert.equal(Buffer.compare(fs.readFileSync(path.join(CWD, 'index.html')),
    fs.readFileSync(path.join(CWD, 'legacy.html'))), 0,
  'index.html 与 legacy.html 已不一致 —— 请同步（flag=0 时两者语义相同）');
});

ok('Legacy 本体零改造：legacy.html ⛔ 不引用 rewrite 的任何东西', () => {
  assert.ok(!/rewrite/.test(LEGACY_SRC), 'legacy.html 不得出现 rewrite 字样');
  assert.ok(LEGACY_BOOT.script.includes('/src/main.js'));
});

ok('rewrite.html 保持独立入口 + noindex（由 app-shell.test 亦守卫）', () => {
  assert.ok(/name="robots"[^>]*noindex/.test(REWRITE_SRC), 'rewrite.html 必须保留 noindex');
  assert.ok(REWRITE_SRC.includes(REWRITE_BOOT.script), 'rewrite.html 引导应为 rewrite entry');
});

/* ───────────────────────── Case A / B：变换语义 ───────────────────────── */

ok('Case A：开关关闭 ⇒ 三个入口的引导全部保持原样（零改动）', () => {
  assert.equal(convergeRootEntry(INDEX_SRC, '/index.html', false), INDEX_SRC, 'index.html 不得被改动');
  assert.equal(convergeRootEntry(LEGACY_SRC, '/legacy.html', false), LEGACY_SRC);
  assert.equal(convergeRootEntry(REWRITE_SRC, '/rewrite.html', false), REWRITE_SRC);
  assert.equal(bootOf(INDEX_SRC), 'legacy', '/ ⇒ Legacy');
  assert.equal(bootOf(LEGACY_SRC), 'legacy', '/legacy.html ⇒ Legacy');
  assert.equal(bootOf(REWRITE_SRC), 'rewrite', '/rewrite.html ⇒ Rewrite');
});

ok('Case B：开关开启 ⇒ 仅 index.html 切到 Rewrite；legacy/rewrite 入口不变', () => {
  const outIndex = convergeRootEntry(INDEX_SRC, '/index.html', true);
  const outLegacy = convergeRootEntry(LEGACY_SRC, '/legacy.html', true);
  const outRewrite = convergeRootEntry(REWRITE_SRC, '/rewrite.html', true);

  assert.equal(bootOf(outIndex), 'rewrite', '/ ⇒ Rewrite');
  assert.equal(bootOf(outLegacy), 'legacy', '/legacy.html ⇒ Legacy');
  assert.equal(bootOf(outRewrite), 'rewrite', '/rewrite.html ⇒ Rewrite');

  assert.equal(outLegacy, LEGACY_SRC, 'legacy.html 必须逐字不变');
  assert.equal(outRewrite, REWRITE_SRC, 'rewrite.html 必须逐字不变');

  // 只换引导：其它行（含 title/description/viewport）必须保持
  assert.ok(outIndex.includes('<title>ETF 智能仓位决策系统 V4.0 Gen-1 Advisory</title>'),
    '根入口站名/标题不得被本变换改写');
  assert.ok(/name="viewport"/.test(outIndex), 'viewport 不得丢失');
  assert.ok(!/id="app"/.test(outIndex), '收敛后不应再残留 legacy 挂载点');
  assert.ok(!outIndex.includes('/src/main.js'), '收敛后不应再引用 legacy 入口脚本');
});

ok('Case B（Windows 路径）：filename 形式的绝对路径同样只收敛 index.html', () => {
  assert.equal(bootOf(convergeRootEntry(INDEX_SRC, 'C:\\r\\web\\index.html', true)), 'rewrite');
  assert.equal(bootOf(convergeRootEntry(LEGACY_SRC, 'C:\\r\\web\\legacy.html', true)), 'legacy');
});

ok('★ fail-closed：开关开启且根入口锚点缺失 ⇒ 抛错（拒绝产出错误根入口）', () => {
  assert.throws(() => convergeRootEntry('<html><body></body></html>', '/index.html', true),
    /引导锚点缺失/);
  // 只剩一个锚点也必须抛
  assert.throws(() => convergeRootEntry('<html><body><div id="app"></div></body></html>', '/index.html', true),
    /引导锚点缺失/);
  // 关闭时则不应抛（原样返回）
  assert.equal(convergeRootEntry('<html></html>', '/index.html', false), '<html></html>');
});

ok('Vite 插件接线：官方 transformIndexHtml 且 order=pre（入口发现之前）', () => {
  const p = rewriteRootEntryPlugin(false);
  assert.equal(p.name, 'v365-rewrite-root-entry');
  assert.equal(typeof p.transformIndexHtml.handler, 'function');
  // ★ 必须 pre：见 web/vite-config/rewrite-root-entry.js 的 Vite 5.4.21 源码取证注释
  assert.equal(p.transformIndexHtml.order, 'pre', 'order 必须为 pre，否则注入的入口不会被登记');
  // 关闭态：无论如何调用都原样返回
  assert.equal(p.transformIndexHtml.handler(INDEX_SRC, { path: '/index.html' }), INDEX_SRC);
  assert.equal(rewriteRootEntryPlugin(true).transformIndexHtml.handler(INDEX_SRC, { path: '/index.html' })
    .includes(REWRITE_BOOT.script), true);
});

ok('vite.config.js 接线：插件已注册 · 三入口齐备 · base 仍为 "./"', () => {
  const cfg = read(path.join(CWD, 'vite.config.js'));
  assert.ok(/rewriteRootEntryPlugin\(\)/.test(cfg), '插件未注册');
  assert.ok(/main:\s*'index\.html'/.test(cfg), '缺 index.html 入口');
  assert.ok(/legacy:\s*'legacy\.html'/.test(cfg), '缺 legacy.html 入口');
  assert.ok(/rewrite:\s*'rewrite\.html'/.test(cfg), '缺 rewrite.html 入口');
  assert.ok(/base\s*:\s*'\.\/'/.test(cfg), '静态托管要求相对 base');
});

ok('构建图完好的**前置条件**：legacy.html 仍在构建图中 ⇒ 旧前端 chunk（含 Dashboard）仍会产出', () => {
  // deploy-hosting-web.js 的前置断言依赖 dist/assets/Dashboard-*.js 存在；
  // 只要 legacy.html 仍是入口，旧前端就仍在打包图中（产物级校验见 artifact 段）。
  const cfg = read(path.join(CWD, 'vite.config.js'));
  assert.ok(/legacy:\s*'legacy\.html'/.test(cfg), 'legacy 入口若被移除会破坏 deploy 前置断言');
  assert.equal(bootOf(LEGACY_SRC), 'legacy');
});

/* ───────────────────────── Case F：Rewrite 路由 smoke ───────────────────────── */

ok('Case F：Rewrite 路由静态 smoke —— #/etf/513310 · #/structure · #/structure/513310', () => {
  const flat = [];
  (function walk(rs, base) {
    for (const r of rs) {
      if (r.path) flat.push({ abs: (base + '/' + r.path).replace(/\/+/g, '/'), name: r.name, redirect: r.redirect });
      if (r.children) walk(r.children, (base + '/' + r.path).replace(/\/+/g, '/'));
    }
  })(routes, '');

  const etf = flat.find((x) => x.abs === '/etf/:code');
  assert.equal(etf && etf.name, 'EtfWorkbench', '#/etf/:code 必须是 EtfWorkbench');
  assert.ok(flat.some((x) => x.abs === '/etf' && x.redirect === '/etf/513310'), '#/etf 必须 redirect 到默认标的');
  assert.ok(flat.some((x) => x.abs === '/structure' && x.redirect === '/etf/513310'), '#/structure 必须 redirect');
  assert.ok(flat.some((x) => x.abs === '/structure/:code' && typeof x.redirect === 'function'), '#/structure/:code 必须函数式 redirect');
  assert.equal(LEGACY_REDIRECTS.length, 5, 'LEGACY_REDIRECTS 兼容表不得变化');
  assert.ok(!FRONT_NAV.some((m) => m.path === '/structure'), '导航不得回填 /structure');

  // hash 路由（入口收敛后深链/刷新仍成立，无需服务端 SPA fallback）
  const routerSrc = read(path.join(CWD, 'src', 'rewrite', 'router.js'));
  assert.ok(/createWebHashHistory/.test(routerSrc), 'Rewrite 必须保持 hash 路由');
});

/* ───────────────────────── Case G：Legacy smoke（源码级） ───────────────────────── */

ok('Case G：legacy 入口本体可加载（/legacy.html ⇒ /src/main.js ⇒ #app）', () => {
  const main = read(path.join(CWD, 'src', 'main.js'));
  assert.ok(/from '\.\/App\.vue'/.test(main), 'legacy 必须仍装配 App.vue');
  assert.ok(/from '\.\/router\/index\.js'/.test(main), 'legacy 必须仍装配自身 router');
  assert.ok(/mount\('#app'\)/.test(main), 'legacy 必须仍挂载 #app');
  assert.ok(!/rewrite/.test(main), '⛔ legacy 入口不得被改造成 rewrite 的 wrapper');

  const legacyRouter = read(path.join(CWD, 'src', 'router', 'index.js'));
  assert.ok(/createWebHashHistory/.test(legacyRouter), 'legacy 亦为 hash 路由');
});

ok('⛔ Rewrite 本体零改动（入口收敛不得触碰 web/src/rewrite/**）', () => {
  const app = read(path.join(CWD, 'src', 'rewrite', 'app.js'));
  assert.ok(/mount\('#rewrite-app'\)/.test(app), 'rewrite 必须仍挂载 #rewrite-app');
  assert.ok(/render:\s*\(\)\s*=>\s*h\(RouterView\)/.test(app), 'rewrite 根组件必须仍为 render 函数（runtime-only）');
  // 入口收敛只改 HTML 引导，不改 app.js 的装配逻辑
  assert.ok(!/ENABLE_REWRITE_ENTRY/.test(app), 'web/src/rewrite/** 不得感知入口开关');
});

/* ───────────────────────── Case C/D/E：产物级（需真实构建） ───────────────────────── */

const distIndex = path.join(DIST, 'index.html');
const distLegacy = path.join(DIST, 'legacy.html');
const distRewrite = path.join(DIST, 'rewrite.html');

function distIsFresh() {
  for (const p of [distIndex, distLegacy, distRewrite]) if (!fs.existsSync(p)) return false;
  const oldest = Math.min(fs.statSync(distIndex).mtimeMs, fs.statSync(distLegacy).mtimeMs,
    fs.statSync(distRewrite).mtimeMs);
  const newestSrc = Math.max(
    fs.statSync(path.join(CWD, 'vite.config.js')).mtimeMs,
    fs.statSync(path.join(CWD, 'vite-config', 'rewrite-root-entry.js')).mtimeMs,
    fs.statSync(path.join(CWD, 'legacy.html')).mtimeMs,
    fs.statSync(path.join(CWD, 'index.html')).mtimeMs
  );
  return oldest >= newestSrc;
}

if (!distIsFresh()) {
  const why = fs.existsSync(DIST)
    ? 'dist 存在但不是本次改动之后的构建产物（或缺 legacy.html）'
    : 'dist 不存在';
  skip('Case C  引用的 JS/CSS 实际存在', why + '；本环境 vite build 被沙箱批量删除守卫拦截，无法产出');
  skip('Case D  `base:"./"` 下 asset URL 形如 ./assets/...', why);
  skip('Case E  content-hashed asset 与 HTML 引用一致', why);
  skip('产物映射：flag=0/1 下 / 与 /legacy.html 的引导身份', why);
} else {
  ok('Case C/D/E + 产物映射：按当前开关核对 dist 三入口', () => {
    const enabled = isRewriteRootEntryEnabled();
    const dIndex = read(distIndex);
    const dLegacy = read(distLegacy);
    const dRewrite = read(distRewrite);

    assert.equal(bootOf(dIndex), enabled ? 'rewrite' : 'legacy', 'dist/index.html 引导身份不符');
    assert.equal(bootOf(dLegacy), 'legacy', 'dist/legacy.html 必须为 Legacy');
    assert.equal(bootOf(dRewrite), 'rewrite', 'dist/rewrite.html 必须为 Rewrite');

    for (const [n, html] of [['index', dIndex], ['legacy', dLegacy], ['rewrite', dRewrite]]) {
      const refs = assetRefs(html);
      assert.ok(refs.length > 0, n + ': 未引用任何 ./assets 资源');
      for (const r of refs) {
        assert.ok(r.startsWith('./assets/'), 'Case D：资源必须相对 ./assets/ 形式 → ' + r);
        const f = path.join(DIST, r.replace(/^\.\//, ''));
        assert.ok(fs.existsSync(f), 'Case C：引用了不存在的资源 ' + r);
        // Case E：产物资源名带 content hash
        assert.ok(/-[A-Za-z0-9_-]{8,}\.(js|css)$/.test(r), 'Case E：资源名应带 content hash → ' + r);
      }
    }

    // deploy 前置断言不破：旧前端 chunk 仍在产物内
    const assets = fs.readdirSync(path.join(DIST, 'assets'));
    assert.ok(assets.some((f) => /^Dashboard-.*\.js$/.test(f)),
      'deploy-hosting-web.js 前置断言要求 dist/assets/Dashboard-*.js 存在');
  });
}

console.log('\nentry-convergence.test: ' + pass + ' 项全过');
