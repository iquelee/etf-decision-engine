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
  'Dashboard', 'EtfWorkbench', 'Structure', 'Intel', 'Review',
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

ok('旧 URL 兼容跳转存在且目标为真实路由', () => {
  const expect = { '/portfolio': '/dashboard', '/fundamentals': '/intel', '/etf': '/etf/513310', '/structure': '/structure/513310' };
  for (const [from, to] of Object.entries(expect)) {
    const def = byPath.get(from);
    assert.ok(def, '缺少旧 URL 兼容: ' + from);
    assert.equal(def.redirect, to, from + ' 应重定向到 ' + to);
    assert.ok(resolves(to), '目标路由无法解析: ' + to);
  }
  assert.equal(LEGACY_REDIRECTS.length, 4, 'LEGACY_REDIRECTS 应声明 4 条');
});

ok('前台导航每项都能解析到真实路由', () => {
  for (const m of FRONT_NAV) {
    const hit = flat.some((x) => x.abs === m.path || x.abs.startsWith(m.path + '/'));
    assert.ok(hit, '前台导航指向死链: ' + m.path);
  }
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
