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
 * ⚠️ 产物级检查（C/D/E + 产物入口身份）需要**一次真实构建**：
 *   · 无产物 / 产物早于本次改动 ⇒ 本段输出 `[SKIP]` + 原因（**显式打印**，⛔ 不伪装成 PASS）；
 *   · 有新鲜产物 ⇒ 本段**真正执行**。判据是**语义入口身份**（比对入口模块文件本身），
 *     ⛔ **不按 chunk 文件名**判身份 —— 命名随模式漂移：`legacy-root` = `main-*`/`rewrite-*`，
 *     `rewrite-root` = `legacy-*`/`app-*`。
 *   ⚠️ **静默 SKIP 会造成假绿**：`dist` 长期过期时本段从未真正执行，直到 2026-10-01
 *     `dist` 因重建而变新，才暴露「`bootOf()` 只认源码形态 ⇒ 产物恒判 `unknown`」的缺陷。
 *     改完入口相关代码后请跑一次 `npm run build` 再跑本套件。
 *   产物亦可单独用 `node tests/tools/verify-entry-artifact.cjs [--expect=legacy-root|rewrite-root]` 校验。
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

/**
 * 从 HTML 里取引导身份：rewrite / legacy / unknown。
 *
 * ★ 必须同时支持**两种形态**（2026-10-01 修正）：
 *   · 源码形态：挂载点 + `<script src="/src/…">` **同时**命中；
 *   · 产物形态：Vite 已把 script src 改写为 `./assets/*-<hash>.js`（`/src/**` 字样消失）
 *     ⇒ 退回**挂载点**判定 —— 产物里 `#app` 与 `#rewrite-app` **互斥**，判定唯一。
 * ⚠️ 原实现只认源码形态 ⇒ 对真实构建产物**恒返回 `'unknown'`**，使产物级断言永远不可能通过
 *    （此前被 `distIsFresh()` 静默 SKIP 掩盖，直到 dist 变新才暴露）。
 * ⛔ 不按 chunk 文件名判身份（命名随模式漂移），⛔ 不依赖产物里的 `/src/**` 字样。
 */
function bootOf(html) {
  const hasRewriteApp = /id="rewrite-app"/.test(html);
  const hasApp = /id="app"/.test(html);
  if (hasRewriteApp && /src="\/src\/rewrite\/app\.js"/.test(html)) return 'rewrite';
  if (hasApp && /src="\/src\/main\.js"/.test(html)) return 'legacy';
  // —— 产物形态：script src 已被改写 ⇒ 用挂载点退化判定（两者互斥，故无歧义）
  if (hasRewriteApp) return 'rewrite';
  if (hasApp) return 'legacy';
  return 'unknown';
}

/**
 * 取「主要 entry module」的文件名（如 `main-BDPxIthH.js`）—— **语义判据**。
 *
 * 规则与 `tests/tools/verify-entry-artifact.cjs` **同源**（只写本套件所需的最小判断，
 * ⛔ 不把验证器整份实现复制成第二份）：
 *   入口 = 文档中**最后**一个 `<script type="module" src="./assets/*.js">`
 *   —— Vite 先注入被提升的共享 chunk，再注入入口 chunk；属性顺序不敏感。
 * ⛔ 绝不按 chunk 文件名（`rewrite-*` / `index-*` / `app-*` …）判身份。
 *
 * @param {string} html
 * @returns {string|null} 形如 `assets/app-BWRjnT2Z.js`；未找到 ⇒ null
 */
function entryModule(html) {
  const srcs = [];
  /* ★ `i` 标志**必需**（非装饰）：标签匹配必须兼顾大小写 HTML（`<SCRIPT>`），
   *   否则触发 CodeQL `js/bad-tag-filter`（"does not match upper case <SCRIPT> tags"）。
   *   输入是本仓 `vite build` 自产 HTML，本就全小写 ⇒ 加 `i` 对真实产物**零语义变化**。 */
  for (const m of html.matchAll(/<script\b[^>]*>/gi)) {
    if (!/\btype="module"/.test(m[0])) continue;
    const s = /\bsrc="\.\/(assets\/[^"]+\.js)"/.exec(m[0]);
    if (s) srcs.push(s[1]);
  }
  return srcs.length ? srcs[srcs.length - 1] : null;
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
  const how = '；先在 web/ 执行一次 npm run build 即可让本段真正执行'
    + '（⚠️ 产物过期 ⇒ 本段静默 SKIP ⇒ 「一直 PASS、其实从未执行」的假绿）';
  skip('Case C  引用的 JS/CSS 实际存在', why + how);
  skip('Case D  `base:"./"` 下 asset URL 形如 ./assets/...', why);
  skip('Case E  content-hashed asset 与 HTML 引用一致', why);
  skip('产物入口身份：A2 语义不变量（legacy-root / rewrite-root）', why);
} else {
  ok('Case C/D/E + 产物入口身份：A2 语义不变量（⛔ 不按 chunk 文件名判身份）', () => {
    const dIndex = read(distIndex);
    const dLegacy = read(distLegacy);
    const dRewrite = read(distRewrite);

    /* ① 与开关无关的两个固定事实 */
    assert.equal(bootOf(dLegacy), 'legacy', 'dist/legacy.html 必须为 Legacy');
    assert.equal(bootOf(dRewrite), 'rewrite', 'dist/rewrite.html 必须为 Rewrite');

    /* ② 根入口身份 = **语义不变量**（与 chunk 文件名、与源码 `<script src>` 均无关）：
     *      legacy-root  ⇒ index ≡ legacy 且 index ≠ rewrite
     *      rewrite-root ⇒ index ≡ rewrite 且 index ≠ legacy
     *    —— 必须**恰好满足其中一种**（互斥；同时满足或都不满足都判错）。 */
    const eIndex = entryModule(dIndex);
    const eLegacy = entryModule(dLegacy);
    const eRewrite = entryModule(dRewrite);
    assert.ok(eIndex && eLegacy && eRewrite, '三个入口都必须解析出 entry module');

    const shapes = {
      'legacy-root': eIndex === eLegacy && eIndex !== eRewrite,
      'rewrite-root': eIndex === eRewrite && eIndex !== eLegacy
    };
    const matched = Object.keys(shapes).filter((k) => shapes[k]);
    assert.equal(matched.length, 1,
      'dist/index.html 的入口身份必须恰满足一种 A2 契约'
      + '（legacy-root: index≡legacy 且 index≠rewrite；rewrite-root: index≡rewrite 且 index≠legacy）；'
      + '实际 index=' + eIndex + ' · legacy=' + eLegacy + ' · rewrite=' + eRewrite);
    const shape = matched[0];

    /* ③ 仅当环境**显式**设置开关时，才要求产物与该开关一致。
     *    未设置时不约束 —— 否则「磁盘上残留另一种形态的产物」会造成误报
     *    （这正是 2026-10-01 暴露的失败形态）。 */
    if (process.env[ENV_FLAG] !== undefined) {
      const want = isRewriteRootEntryEnabled() ? 'rewrite-root' : 'legacy-root';
      assert.equal(shape, want,
        '显式 ' + ENV_FLAG + '=' + process.env[ENV_FLAG] + ' 时产物必须为 ' + want + '，实际 ' + shape);
    }

    /* ④ 挂载点（保留）：根入口挂载点必须与所选形态一致 */
    assert.equal(bootOf(dIndex), shape === 'rewrite-root' ? 'rewrite' : 'legacy',
      'dist/index.html 挂载点与入口形态不符');

    console.log('    · 产物入口形态 = ' + shape
      + '（index=' + eIndex + ' · legacy=' + eLegacy + ' · rewrite=' + eRewrite + '）');

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
