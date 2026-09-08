import { createRouter, createWebHashHistory } from 'vue-router';
import { getToken } from '../api/request.js';
import { ENGINE_VERSION } from '../utils/constants.js';

// 嵌套路由：前台 FrontLayout（顶部导航）/ 后台 AdminLayout（左侧导航 + 鉴权）/ 独立登录页
const routes = [
  {
    path: '/',
    component: () => import('../layouts/FrontLayout.vue'),
    children: [
      { path: '', redirect: '/dashboard' },
      { path: 'dashboard', name: 'Dashboard', component: () => import('../views/Dashboard.vue'), meta: { title: '全局' } },
      { path: 'etf', redirect: '/etf/513310' },
      { path: 'etf/:code', name: 'EtfDetail', component: () => import('../views/EtfDetail.vue'), meta: { title: '执行' } },
      { path: 'structure', redirect: '/structure/513310' },
      { path: 'structure/:code', name: 'Structure', component: () => import('../views/Structure.vue'), meta: { title: '看盘' } },
      { path: 'portfolio', redirect: '/dashboard' },
      { path: 'review', name: 'Review', component: () => import('../views/Review.vue'), meta: { title: '历史', requiresAuth: true } },
      { path: 'fundamentals', name: 'Fundamentals', component: () => import('../views/Fundamentals.vue'), meta: { title: '基本面' } },
      { path: 'intel', redirect: '/fundamentals' }
    ]
  },
  {
    path: '/admin',
    component: () => import('../layouts/AdminLayout.vue'),
    meta: { requiresAuth: true },
    children: [
      { path: '', redirect: '/admin/data' },
      { path: 'gen1', name: 'Gen1Health', component: () => import('../views/admin/Gen1Health.vue'), meta: { title: 'Gen-1 运行状态' } },
      { path: 'gen2', name: 'Gen2Shadow', component: () => import('../views/admin/Gen2Shadow.vue'), meta: { title: '选池观察' } },
      { path: 'data', name: 'DataManage', component: () => import('../views/admin/DataManage.vue'), meta: { title: '数据管理' } },
      { path: 'param', name: 'ParamConfig', component: () => import('../views/admin/ParamConfig.vue'), meta: { title: '参数配置' } },
      { path: 'password', name: 'ChangePassword', component: () => import('../views/admin/ChangePassword.vue'), meta: { title: '修改密码' } },
      { path: 'fundamental', name: 'FundamentalEntry', component: () => import('../views/admin/FundamentalEntry.vue'), meta: { title: '基本面录入' } },
      { path: 'risk', name: 'RiskEvents', component: () => import('../views/admin/RiskEvents.vue'), meta: { title: '风险事件' } },
      { path: 'trade', name: 'TradeLog', component: () => import('../views/admin/TradeLog.vue'), meta: { title: '操作记录' } }
    ]
  },
  { path: '/login', name: 'Login', component: () => import('../views/admin/Login.vue'), meta: { title: '后台登录' } }
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior(to, from) {
    if (to.path !== from.path) return { top: 0, left: 0 };
  }
});

// 鉴权守卫：requiresAuth 路由未登录跳 /login；已登录访问 /login 跳后台
router.beforeEach((to) => {
  if (to.matched.some((r) => r.meta.requiresAuth)) {
    if (!getToken()) return { path: '/login', query: { redirect: to.fullPath } };
  }
  if (to.path === '/login' && getToken()) return { path: '/admin/data' };
});

router.afterEach((to) => {
  const title = to.meta && to.meta.title ? to.meta.title : '决策系统';
  document.title = `${title} · ETF 仓位决策 ${ENGINE_VERSION}`;
});

export default router;
