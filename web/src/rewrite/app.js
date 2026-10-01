/**
 * V365 新前端应用装配（web/src/rewrite/）
 * 规范依据：docs/V365_PROJECT_FUNCTION_AND_FRONTEND_REWRITE_SPEC.md §2 / §8 / §12
 *
 * 说明：
 *  - 本入口与旧前端（web/src/main.js + index.html）**完全并存**，互不影响。
 *  - 通过 web/rewrite.html 独立装载，vite 以多页方式构建出独立产物。
 *  - 全局样式按 tokens → base → utilities 顺序加载（base/utilities 依赖 tokens 变量）。
 */
import { createApp, h } from 'vue';
import { RouterView } from 'vue-router';
import router from './router.js';

import './styles/tokens.css';
import './styles/base.css';
import './styles/utilities.css';
import './styles/components.css';

/**
 * ⚠️ 必须用 **render 函数**装配根组件，⛔ 不能用字符串模板：
 *   Vite 生产构建用的是 **runtime-only** 的 Vue（不带模板编译器），
 *   `createApp({ template: '<router-view />' })` 在 **dev 下只告警、production 下静默渲染为空**，
 *   结果是一个「build PASS + 页面白屏」的隐蔽故障（M3 用真实浏览器渲染才发现）。
 */
const app = createApp({
  name: 'RewriteRoot',
  render: () => h(RouterView)
});

app.use(router);
app.mount('#rewrite-app');
