/**
 * V365 新前端路由表（纯数据，web/src/rewrite/routes.js）
 * 规范依据：docs/V365_PROJECT_FUNCTION_AND_FRONTEND_REWRITE_SPEC.md §4.1 / §5 / §11.5
 *
 * 为什么与 router.js 分开：
 *   本模块是**纯数据**（无 vue-router、无 DOM 副作用），因此 Node 契约测试可直接 import，
 *   而 router.js 负责装配 createRouter / 守卫。
 *
 * 硬性要求：
 *  - 前台 4 页（/dashboard · /etf/:code · /intel · /review）+ 后台 9 页（含 /admin/production 与
 *    /admin/password）+ 登录页；⛔ 无「空壳业务页」；
 *    ★ M5-P1-OBS-1（2026-10-01）：`/structure` 与 `/structure/:code` **不再是页**（仅剩兼容 redirect）；
 *  - 旧 URL 保留 redirect 兼容（§11.5），⛔ 不再维护无业务内容的空页面；
 *  - `/review` 保持鉴权（§8.1）。
 */

/** 前台主 IA：全局 · 标的 · 情报 · 复盘（SPEC §4.1）
 *  ★ M5-P1-OBS-1（2026-10-01）：删除「看盘」导航项 —— `/structure` 已无独立产品职责
 *   （归并为兼容 redirect，见下方 LEGACY_REDIRECTS），⛔ 不得再回填进导航；
 *   兼容入口必须保留，删除导航 ≠ 删除 redirect。 */
export const FRONT_NAV = Object.freeze([
  { path: '/dashboard', title: '全局', needsAuth: false },
  { path: '/etf', title: '标的', needsAuth: false },
  { path: '/intel', title: '情报', needsAuth: false },
  { path: '/review', title: '复盘', needsAuth: true }
]);

/** 后台主 IA：系统运行 / 数据管理 / 策略配置 / 执行（SPEC §5） */
export const ADMIN_NAV = Object.freeze([
  { group: '系统运行', items: [
    { path: '/admin/gen1', title: 'Gen-1 运行状态' },
    { path: '/admin/gen2', title: '选池观察 · Shadow' },
    { path: '/admin/production', title: 'V3.6.5 生产状态' }
  ] },
  { group: '数据管理', items: [
    { path: '/admin/data', title: '数据源与抓取' },
    { path: '/admin/fundamental', title: '基本面录入' }
  ] },
  { group: '策略配置', items: [
    { path: '/admin/param', title: '参数配置' },
    { path: '/admin/risk', title: '风险事件' }
  ] },
  { group: '执行', items: [
    { path: '/admin/trade', title: '操作记录与账户快照' }
  ] }
]);

/** 后台默认落地页（保持旧行为） */
export const ADMIN_HOME = '/admin/data';

const FrontLayout = () => import('./layouts/FrontLayout.vue');
const AdminLayout = () => import('./layouts/AdminLayout.vue');

/** 旧 URL 兼容跳转（SPEC §11.5）：⛔ 这些是 redirect，不是业务页 */
export const LEGACY_REDIRECTS = Object.freeze([
  { path: '/portfolio', target: '/dashboard' },
  { path: '/fundamentals', target: '/intel' },
  { path: '/etf', target: '/etf/513310' },
  /* ★ M5-P1 / owner D-M5-1（合并 + redirect）：看盘**不再单独建设第二套 Workbench**，
   *   `/structure` 与 `/structure/:code` 一律归并到 `/etf/:code`（唯一 ETF 看盘载体）。 */
  { path: '/structure', target: '/etf/513310' },
  { path: '/structure/:code', target: '/etf/:code', param: 'code' }
]);

export const routes = [
  /* ---------------- 前台 ---------------- */
  {
    path: '/',
    component: FrontLayout,
    children: [
      { path: '', redirect: '/dashboard' },
      { path: 'dashboard', name: 'Dashboard', component: () => import('./views/front/Dashboard.vue'), meta: { title: '全局', zone: 'front' } },

      { path: 'portfolio', redirect: '/dashboard' },           // 旧 URL 兼容
      { path: 'etf', redirect: '/etf/513310' },
      { path: 'etf/:code', name: 'EtfWorkbench', component: () => import('./views/front/EtfWorkbench.vue'), meta: { title: '标的', zone: 'front' } },

      /* ★ M5-P1 D-M5-1：看盘 → 归并到 ETF 工作台（⛔ 不建第二套 Workbench） */
      { path: 'structure', redirect: '/etf/513310' },
      { path: 'structure/:code', redirect: (to) => '/etf/' + encodeURIComponent(String(to.params.code || '')) },

      { path: 'fundamentals', redirect: '/intel' },             // 旧 URL 兼容
      { path: 'intel', name: 'Intel', component: () => import('./views/front/Intel.vue'), meta: { title: '情报', zone: 'front' } },

      {
        path: 'review',
        name: 'Review',
        component: () => import('./views/front/Review.vue'),
        meta: { title: '复盘', zone: 'front', requiresAuth: true }
      }
    ]
  },

  /* ---------------- 后台 ---------------- */
  {
    path: '/admin',
    component: AdminLayout,
    meta: { requiresAuth: true },
    children: [
      { path: '', redirect: ADMIN_HOME },
      { path: 'gen1', name: 'AdminGen1', component: () => import('./views/admin/Gen1Health.vue'), meta: { title: 'Gen-1 运行状态', zone: 'admin' } },
      { path: 'gen2', name: 'AdminGen2', component: () => import('./views/admin/Gen2Shadow.vue'), meta: { title: '选池观察 · Shadow', zone: 'admin' } },
      { path: 'production', name: 'AdminProduction', component: () => import('./views/admin/ProductionState.vue'), meta: { title: 'V3.6.5 生产状态', zone: 'admin' } },
      { path: 'data', name: 'AdminData', component: () => import('./views/admin/DataManage.vue'), meta: { title: '数据源与抓取', zone: 'admin' } },
      { path: 'fundamental', name: 'AdminFundamental', component: () => import('./views/admin/FundamentalEntry.vue'), meta: { title: '基本面录入', zone: 'admin' } },
      { path: 'param', name: 'AdminParam', component: () => import('./views/admin/ParamConfig.vue'), meta: { title: '参数配置', zone: 'admin' } },
      { path: 'risk', name: 'AdminRisk', component: () => import('./views/admin/RiskEvents.vue'), meta: { title: '风险事件', zone: 'admin' } },
      { path: 'trade', name: 'AdminTrade', component: () => import('./views/admin/TradeLog.vue'), meta: { title: '操作记录与账户快照', zone: 'admin' } },
      { path: 'password', name: 'AdminPassword', component: () => import('./views/admin/ChangePassword.vue'), meta: { title: '修改密码', zone: 'admin' } }
    ]
  },

  /* ---------------- 登录 ---------------- */
  { path: '/login', name: 'Login', component: () => import('./views/admin/Login.vue'), meta: { title: '后台登录', zone: 'auth' } }
];

export default routes;
