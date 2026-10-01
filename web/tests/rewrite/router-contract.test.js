/**
 * 路由契约测试（SPEC §4.1 / §5 / §11.5）
 *
 * 守卫：
 *  1. 必需路由名齐备（前台 5 + 后台 10 + 登录）；
 *  2. 每个**业务页**都有 meta.title 与 meta.zone（⛔ 无「无名空壳业务页」）；
 *  3. redirect-only 路由**不得**携带 component（⛔ 不停留无业务内容的空页面）；
 *  4. `/review` 必须 requiresAuth（§8.1）；`/admin/*` 整组 requiresAuth；
 *  5. 旧 URL 兼容跳转存在且指向**真实存在的路由**；
 *  6. 导航（FRONT_NAV / ADMIN_NAV）每一项都能解析到真实路由（⛔ 菜单不指向死链）。
 */
import assert from 'node:assert/strict';
import { routes, FRONT_NAV, ADMIN_NAV, ADMIN_HOME, LEGACY_REDIRECTS } from '../../src/rewrite/routes.js';

let pass = 0;
function ok(name, fn) { fn(); pass++; console.log('[PASS] ' + name); }

/** 展平出全部叶子路由，path 为绝对路径 */
function flatten(rs, prefix = '') {
  const out = [];
  for (const r of rs) {
    const abs = r.path.startsWith('/') ? r.path : (prefix + '/' + r.path).replace(/\/{2,}/g, '/');
    const p = abs === '' ? '/' : abs;
    out.push({ abs: p, def: r });
    if (r.children) out.push(...flatten(r.children, abs));
  }
  return out;
}
const flat = flatten(routes);
const byPath = new Map(flat.map((x) => [x.abs, x.def]));
const names = new Set(flat.map((x) => x.def.name).filter(Boolean));

const REQUIRED_NAMES = [
  /* ★ M5-P1 D-M5-1：'Structure' 已从名单移除 —— 看盘归并到 `/etf/:code`，
     `/structure/:code` 是**无 name 的兼容 redirect**（⛔ 不建第二套 Workbench）。 */
  'Dashboard', 'EtfWorkbench', 'Intel', 'Review',
  'AdminGen1', 'AdminGen2', 'AdminProduction', 'AdminData', 'AdminFundamental',
  'AdminParam', 'AdminRisk', 'AdminTrade', 'AdminPassword',
  'Login'
];

ok('必需路由名全部存在', () => {
  const missing = REQUIRED_NAMES.filter((n) => !names.has(n));
  assert.equal(missing.length, 0, '缺失路由: ' + missing.join(', '));
});

ok('新增 /admin/production 存在且指向 ProductionState 视图', () => {
  const r = flat.find((x) => x.abs === '/admin/production');
  assert.ok(r, '缺少 /admin/production');
  assert.equal(r.def.name, 'AdminProduction');
  assert.ok(typeof r.def.component === 'function', '必须有真实组件（非 redirect）');
  assert.equal(r.def.meta.title, 'V3.6.5 生产状态');
});

ok('业务页必须有 title + zone；redirect-only 不得带 component；容器路由豁免', () => {
  const problems = [];
  for (const { abs, def } of flat) {
    if (def.redirect) {
      // 兼容跳转：⛔ 不得同时挂组件（否则就是"留了一个空页面"）
      if (def.component) problems.push(abs + ' 同时有 redirect 与 component');
      continue;
    }
    // 布局容器（有 children，如 '/' 与 '/admin'）：本身不是业务页，豁免 meta 检查
    if (def.children && def.children.length) continue;
    if (!def.component) continue;
    if (!def.meta || !def.meta.title) problems.push(abs + ' 缺 meta.title');
    if (!def.meta || !def.meta.zone) problems.push(abs + ' 缺 meta.zone');
  }
  assert.equal(problems.length, 0, problems.join('; '));
});

ok('/review 必须 requiresAuth；/admin 整组必须 requiresAuth', () => {
  const review = flat.find((x) => x.abs === '/review');
  assert.ok(review.def.meta.requiresAuth, '/review 必须 requiresAuth（SPEC §8.1）');
  const adminParent = routes.find((r) => r.path === '/admin');
  assert.ok(adminParent.meta && adminParent.meta.requiresAuth, '/admin 组必须 requiresAuth');
});

/** 路径能否被路由表解析（支持 :param 段） */
function resolves(pathname) {
  const segs = pathname.split('/').filter(Boolean);
  return flat.some(({ abs }) => {
    const ps = abs.split('/').filter(Boolean);
    if (ps.length !== segs.length) return false;
    return ps.every((p, i) => p.startsWith(':') || p === segs[i]);
  });
}

ok('旧 URL 兼容跳转存在且目标为真实路由（★ M5-P1 D-M5-1：/structure 归并到 /etf/:code）', () => {
  const expect = {
    '/portfolio': '/dashboard',
    '/fundamentals': '/intel',
    '/etf': '/etf/513310',
    '/structure': '/etf/513310'
  };
  for (const [from, to] of Object.entries(expect)) {
    const def = byPath.get(from);
    assert.ok(def, '缺少旧 URL 兼容: ' + from);
    assert.equal(def.redirect, to, from + ' 应重定向到 ' + to);
    assert.ok(resolves(to), '目标路由无法解析: ' + to);
  }
  assert.equal(LEGACY_REDIRECTS.length, 5, 'LEGACY_REDIRECTS 应声明 5 条');

  /* ★ M5-P1 D-M5-1：`/structure/:code` 必须是**参数化 redirect**，
   *   ⛔ 不得再挂 component（即 ⛔ 不得存在第二套 ETF 看盘页面）。 */
  const p = byPath.get('/structure/:code');
  assert.ok(p, '缺少 /structure/:code 兼容跳转');
  assert.equal(typeof p.redirect, 'function', '/structure/:code 应为函数式 redirect');
  assert.equal(p.redirect({ params: { code: '518880' } }), '/etf/518880', '参数必须透传');
  assert.equal(p.component, undefined, '⛔ /structure/:code 不得挂 component（禁止第二套 Workbench）');
});

ok('前台导航每项都能解析到真实路由', () => {
  for (const m of FRONT_NAV) {
    const hit = flat.some((x) => x.abs === m.path || x.abs.startsWith(m.path + '/'));
    assert.ok(hit, '前台导航指向死链: ' + m.path);
  }
});

ok('★ M5-P1-OBS-1：前台导航 ⛔ 不得再含 /structure「看盘」（且必须是 4 项固定顺序）', () => {
  /* ① 导航收敛：删除「看盘」后严格为 全局 · 标的 · 情报 · 复盘（⛔ 不重排 情报/标的） */
  assert.deepEqual(FRONT_NAV.map((m) => m.title), ['全局', '标的', '情报', '复盘'],
    '前台导航应严格为 全局 · 标的 · 情报 · 复盘');
  /* ② 看盘 / /structure 不得回填进导航（含 path 与 title 两种写法） */
  assert.ok(!FRONT_NAV.some((m) => m.path === '/structure'), '⛔ FRONT_NAV 不得包含 /structure');
  assert.ok(!FRONT_NAV.some((m) => m.title === '看盘'), '⛔ FRONT_NAV 不得包含「看盘」');
  /* ③ ★ 关键：删除导航 ≠ 删除兼容入口 —— 两条 redirect 必须仍在（防"顺手一起删"） */
  assert.ok(byPath.has('/structure'), '⛔ 不得删除 /structure 兼容 redirect');
  assert.ok(byPath.has('/structure/:code'), '⛔ 不得删除 /structure/:code 兼容 redirect');
  assert.equal(byPath.get('/structure').redirect, '/etf/513310', '/structure 应仍 redirect 到 /etf/513310');
  /* ④ 唯一正式 Workbench 入口不变 */
  assert.equal(byPath.get('/etf/:code').name, 'EtfWorkbench', '/etf/:code 应仍为 EtfWorkbench');
});

ok('后台导航每项都能解析到真实路由，且都有分组名', () => {
  assert.ok(ADMIN_NAV.length >= 4, '后台应有 ≥4 个分组');
  for (const g of ADMIN_NAV) {
    assert.ok(g.group, '分组必须有 group 名');
    for (const m of g.items) {
      assert.ok(byPath.has(m.path), '后台导航指向死链: ' + m.path);
    }
  }
});

ok('ADMIN_HOME 是真实路由', () => {
  assert.ok(byPath.has(ADMIN_HOME), 'ADMIN_HOME 不是真实路由: ' + ADMIN_HOME);
});

ok('⛔ 不存在已知的旧死路由/死接口入口（无 /macro 页）', () => {
  assert.ok(!flat.some((x) => x.abs === '/macro'), '宏观页本轮不建（SPEC §11.4 / §15）');
  assert.ok(!flat.some((x) => x.abs === '/structure-preview'), '不得新增无业务内容的占位页');
});

console.log('\nrouter-contract.test: ' + pass + ' 项全过');
