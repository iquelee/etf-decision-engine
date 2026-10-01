/**
 * E-006 / A2 —— 生产根入口收敛（V3.6.5 Rewrite 与 Legacy 并存）
 *
 * 规范依据：`docs/V365_PROJECT_FUNCTION_AND_FRONTEND_REWRITE_SPEC.md` §18-1 ·
 *           `docs/V365_FRONTEND_RISK_LEDGER.md` `E-006`
 *
 * 目标（A2）：
 *   `VITE_ENABLE_REWRITE_ENTRY=1`   ⇒ `dist/index.html` = V3.6.5 Rewrite UI
 *   未设置 / `=0`（默认）            ⇒ `dist/index.html` = Legacy UI
 *                                     （默认态产物与收敛前**逐字节一致**）
 *   无论开关如何：
 *     · `/legacy.html`  = Legacy 入口（引导 `/src/main.js`，⛔ 永不改造）
 *     · `/rewrite.html` = Rewrite 入口（保持 `noindex`，独立可达）
 *
 * ⛔ 没有做的事（刻意）：
 *   · 不用 `sed` / 不对 **dist** 做事后改写 / 不手工复制 dist 文件；
 *   · 不引入任何第三方插件或新的构建系统；
 *   · 不改 `web/src/rewrite/**`（Rewrite 本体零改动）；
 *   · 不改 `web/src/main.js`（Legacy 本体零改动）。
 *
 * ✅ 实现方式：**Vite 官方 `transformIndexHtml` 钩子**，注册为 `order: 'pre'`。
 *
 * ★ 为什么必须是 `order: 'pre'`（已对**本仓已安装的 Vite 5.4.21 源码**取证，非猜测）：
 *   `node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js` 内 `buildHtmlPlugin`：
 *
 *       html = await applyHtmlTransforms(html, preHooks, { path: publicPath, filename: id });
 *       let js = "";
 *       const s = new MagicString(html);
 *       const scriptUrls = [];        // ← 入口发现在这一行之后
 *
 *   ⇒ `pre` 钩子在**入口发现之前**执行，因此被注入/替换出来的
 *     `<script type="module" src="/src/rewrite/app.js">` 会被 Vite 正常登记为入口并打包；
 *     若用 `order: 'post'`，Vite 内部早已把该 script 改写为产物路径，再替换必然失效。
 *
 * ★ fail-closed：开关开启且目标为根入口时，若引导锚点缺失 ⇒ **直接抛错**，
 *   拒绝静默产出「根入口指向空壳」的产物。
 */

/** 唯一开关名（⛔ 不引入第二个开关） */
export const ENV_FLAG = 'VITE_ENABLE_REWRITE_ENTRY';

/** 根入口的两个引导锚点（与 `web/index.html` 逐字对应） */
export const LEGACY_BOOT = Object.freeze({
  div: '<div id="app"></div>',
  script: '<script type="module" src="/src/main.js"></script>'
});

/** 收敛后根入口的两个引导锚点（与 `web/rewrite.html` 逐字对应） */
export const REWRITE_BOOT = Object.freeze({
  div: '<div id="rewrite-app"></div>',
  script: '<script type="module" src="/src/rewrite/app.js"></script>'
});

/**
 * 读取开关：只有精确 `"1"` 才算开启。
 * 默认（未设置）⇒ 关闭 ⇒ 保持今天的生产形态（Legacy 在根）。
 *
 * @param {string|undefined} [raw]
 * @returns {boolean}
 */
export function isRewriteRootEntryEnabled(raw = process.env[ENV_FLAG]) {
  return String(raw) === '1';
}

/** 归一化路径分隔符（Windows 会给出反斜杠） */
function norm(p) {
  return String(p == null ? '' : p).replace(/\\/g, '/');
}

/**
 * 该次 HTML 变换是否针对**根入口** `index.html`。
 * 只认 `index.html`：`legacy.html` 与 `rewrite.html` ⛔ 永不改写。
 *
 * @param {string} pathLike `ctx.path`（如 `/index.html`）或 `ctx.filename`（绝对路径）
 * @returns {boolean}
 */
export function isRootEntryHtml(pathLike) {
  const p = norm(pathLike);
  return p === 'index.html' || p.endsWith('/index.html');
}

/**
 * 纯变换：按开关把**根入口**的引导切到 Rewrite。
 *
 * @param {string} html 源 HTML 文本
 * @param {string} pathLike 该 HTML 的路径
 * @param {boolean} enabled 开关
 * @returns {string} 变换后的 HTML；未开启或非根入口 ⇒ **原样返回**
 * @throws {Error} 开关开启 + 目标是根入口 + 引导锚点缺失（fail-closed）
 */
export function convergeRootEntry(html, pathLike, enabled) {
  if (!enabled) return html;                    // 默认路径：逐字节不动
  if (!isRootEntryHtml(pathLike)) return html;  // 只改根入口

  const src = String(html);
  if (!src.includes(LEGACY_BOOT.div) || !src.includes(LEGACY_BOOT.script)) {
    throw new Error(
      '[v365-rewrite-root-entry] 根入口 index.html 的引导锚点缺失 ⇒ 拒绝产出错误的根入口。'
      + '期望同时存在：' + LEGACY_BOOT.div + ' 与 ' + LEGACY_BOOT.script
    );
  }
  return src
    .replace(LEGACY_BOOT.div, REWRITE_BOOT.div)
    .replace(LEGACY_BOOT.script, REWRITE_BOOT.script);
}

/**
 * Vite 插件：把上面的纯变换接到官方 `transformIndexHtml`（`order: 'pre'`）。
 *
 * @param {boolean} [enabled] 省略时读环境变量（便于测试注入）
 * @returns {import('vite').Plugin}
 */
export function rewriteRootEntryPlugin(enabled = isRewriteRootEntryEnabled()) {
  return {
    name: 'v365-rewrite-root-entry',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const pathLike = (ctx && (ctx.path || ctx.filename)) || '';
        return convergeRootEntry(html, pathLike, enabled);
      }
    }
  };
}
