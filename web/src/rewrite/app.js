/**
 * V365 新前端应用装配（web/src/rewrite/）
 * 规范依据：docs/V365_PROJECT_FUNCTION_AND_FRONTEND_REWRITE_SPEC.md §2 / §8 / §12
 *
 * 说明：
 *  - 本入口与旧前端（web/src/main.js + index.html）**完全并存**，互不影响。
 *  - 通过 web/rewrite.html 独立装载，vite 以多页方式构建出独立产物。
 *  - 全局样式按 tokens → base → utilities 顺序加载（base/utilities 依赖 tokens 变量）。
 */
import { createApp } from 'vue';
import router from './router.js';

import './styles/tokens.css';
import './styles/base.css';
import './styles/utilities.css';

const app = createApp({
  template: '<router-view />'
});

app.use(router);
app.mount('#rewrite-app');
