/**
 * 应用外壳守卫（M3 · SPEC §2 / §12 / §13）
 *
 * ★ 为什么需要这套测试：
 *   M1 的 `app.js` 用 `createApp({ template: '<router-view />' })` 装配根组件。
 *   Vite 生产构建使用 **runtime-only** Vue（无模板编译器）⇒
 *     · dev：控制台只给一条告警；
 *     · production：**静默渲染为空** —— 页面白屏，而 `vite build` 依然 PASS。
 *   该缺陷躲过了 build 与单元测试，只有真实浏览器渲染才暴露（M3 视觉核验发现）。
 *   ⇒ 这里把它变成**机器守卫**，防止再次引入。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const CWD = process.cwd();
const REWRITE = path.join(CWD, 'src', 'rewrite');

let pass = 0;
function ok(name, fn) { fn(); pass++; console.log('[PASS] ' + name); }

const read = (p) => fs.readFileSync(p, 'utf8');
/** 剥离注释后断言（工作纪律：静态断言必须剥离注释） */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

ok('⛔ app.js 不得使用运行时可编译的字符串模板（runtime-only Vue 会静默白屏）', () => {
  const src = strip(read(path.join(REWRITE, 'app.js')));
  assert.ok(!/template\s*:\s*['"`]/.test(src),
    '⛔ 根组件不得用 template 字符串（生产构建静默渲染为空）');
  assert.ok(/render\s*:/.test(src), '根组件必须提供 render 函数');
  assert.ok(/h\s*\(\s*RouterView\s*\)/.test(src), '根组件应渲染 RouterView');
  assert.ok(!/from\s+['"]vue\/dist\//.test(src), '⛔ 不得直接引用 vue 的 dist 内部路径');
});

ok('全 rewrite 源码（.js/.vue script 段）⛔ 不得出现 template 字符串选项', () => {
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|vue)$/.test(e.name)) files.push(p);
    }
  })(REWRITE);

  const hits = [];
  for (const f of files) {
    const src = strip(read(f));
    // 只看「组件选项对象里的 template: '...'」；SFC 的 <template> 块不算
    const re = /template\s*:\s*['"`]/g;
    if (re.test(src)) hits.push(path.relative(REWRITE, f));
  }
  assert.equal(hits.length, 0, '违规文件：' + hits.join(', '));
});

ok('rewrite.html：独立入口 + 挂载点 + noindex（与旧前端并存）', () => {
  const html = read(path.join(CWD, 'rewrite.html'));
  assert.ok(/id="rewrite-app"/.test(html), '缺挂载点 #rewrite-app');
  assert.ok(/src="\/src\/rewrite\/app\.js"/.test(html), '入口脚本应为 /src/rewrite/app.js');
  assert.ok(/name="robots"[^>]*noindex/.test(html), '新入口必须 noindex');
  assert.ok(/viewport/.test(html), '缺 viewport');
});

ok('样式加载顺序：tokens → base → utilities → components（变量必须先定义）', () => {
  const src = read(path.join(REWRITE, 'app.js'));
  const iTokens = src.indexOf("styles/tokens.css");
  const iBase = src.indexOf("styles/base.css");
  const iUtils = src.indexOf("styles/utilities.css");
  const iComps = src.indexOf("styles/components.css");
  for (const [n, i] of [['tokens', iTokens], ['base', iBase], ['utilities', iUtils], ['components', iComps]]) {
    assert.ok(i >= 0, '未加载 ' + n);
  }
  assert.ok(iTokens < iBase && iBase < iUtils && iUtils < iComps, '样式顺序错误');
});

ok('vite 配置：多入口（index.html + rewrite.html），旧前端入口不丢', () => {
  const cfg = read(path.join(CWD, 'vite.config.js'));
  assert.ok(/index\.html/.test(cfg), '缺旧入口 index.html');
  assert.ok(/rewrite\.html/.test(cfg), '缺新入口 rewrite.html');
  assert.ok(/base\s*:\s*['"]\.\/['"]/.test(cfg), '静态托管要求相对 base');
});

console.log('\napp-shell.test: ' + pass + ' 项全过');
