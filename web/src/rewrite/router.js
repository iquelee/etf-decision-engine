/**
 * V365 新前端路由装配（web/src/rewrite/router.js）
 * 规范依据：docs/V365_PROJECT_FUNCTION_AND_FRONTEND_REWRITE_SPEC.md §4.1 / §5 / §8
 *
 * 本文件只做三件事：装 createRouter、挂鉴权守卫、设置标题。
 * 路由**数据**在 ./routes.js（纯数据，可被 Node 测试直接 import）。
 */
import { createRouter, createWebHashHistory } from 'vue-router';
import { routes, ADMIN_HOME } from './routes.js';
import { isAuthed } from './compose/useSession.js';

const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior(to, from) {
    if (to.path !== from.path) return { top: 0, left: 0 };
    return undefined;
  }
});

/**
 * 鉴权守卫（SPEC §8）
 * - `requiresAuth` 且未登录 ⇒ 引导到登录页并**保留来源**（§8.4：不静默吞掉上下文）。
 * - ⛔ 不在 HTTP 客户端里改 location（401 的集中处理属 app 层，见 SPEC §8.3，M2 落实）。
 */
router.beforeEach((to) => {
  const needAuth = to.matched.some((r) => r.meta && r.meta.requiresAuth);
  if (needAuth && !isAuthed()) {
    return { path: '/login', query: { redirect: to.fullPath } };
  }
  if (to.path === '/login' && isAuthed()) return { path: ADMIN_HOME };
  return true;
});

router.afterEach((to) => {
  const t = (to.meta && to.meta.title) || '决策系统';
  document.title = `${t} · ETF 仓位决策`;
});

export default router;
