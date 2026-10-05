/**
 * Dashboard 渲染测试（M3 · SSR 真渲染，非字符串拼接）
 *
 * 做法：用 **vite 的 SSR 模块加载器**加载真实 `.vue` 组件（含 SFC 编译），
 *       再用 `@vue/server-renderer` 渲染成 HTML，对 HTML 做结构化断言。
 *       ⇒ 断言对象是**组件真实输出**，不是「我以为它会输出什么」。
 *
 * 覆盖 owner 指定的渲染场景：
 *   canonical · 线上旧响应 · canonical 字段为 null · canonical 字段缺失 · legacy-only · malformed
 *   + loading / empty / error / stale / Gen-1 未提供 / 生命周期未提供
 *   + 数字语义（0.5 → 0.5%，⛔ 不是 50%）+ XSS 转义 + 双形态（桌面表 / 移动卡）
 *
 * ⚠️ 本套件会启动一个 vite dev server（middleware 模式，⛔ 不 spawn 子进程），
 *     必须在 finally 中关闭，否则 runner 进程不会退出。
 */
import { createServer } from 'vite';
import { createSSRApp } from 'vue';
import { renderToString } from '@vue/server-renderer';
import { adaptDashboard } from '../../src/rewrite/adapters/dashboard.js';
import { FORBIDDEN_LIFECYCLE_PHRASES } from '../../src/rewrite/domain/lifecycle.js';
import { FIXTURES, assert } from './_fixtures.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const RS = () => FIXTURES.liveConstants().runtime_status;
const REAL = '2026-09-30T18:00:00.000Z';

let pass = 0;
async function ok(label, fn) {
  await fn();
  pass++;
  console.log('[PASS] ' + label);
}

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
  optimizeDeps: { noDiscovery: true, include: [] }
});

try {
  const mod = await server.ssrLoadModule('/src/rewrite/components/dashboard/DashboardView.vue');
  const DashboardView = mod.default;
  assert.ok(DashboardView, '未能加载 DashboardView.vue');

  /** 渲染一个页面状态 */
  async function render(state) {
    const full = Object.assign(
      { phase: 'ready', vm: null, error: '', emptyText: '后端未返回可用数据。', refreshing: false, refresh() {} },
      state
    );
    const app = createSSRApp(DashboardView, { state: Object.freeze(full) });
    return renderToString(app);
  }
  const renderVm = (vm, phase = 'ready') => render({ phase, vm });

  /* ==================== A canonical ==================== */

  await ok('A canonical：首屏渲染出市场环境 / 正式决策 / Gen-1 身份 / 生命周期三轴', async () => {
    const vm = adaptDashboard(FIXTURES.canonicalDashboard(), RS(), { retrievedAt: REAL });
    const html = await renderVm(vm);

    assert.ok(html.includes('防守'), '市场环境应渲染「防守」');
    assert.ok(html.includes('V3 Safety Core'), '必须显式标注正式决策的权威归属');
    assert.ok(html.includes('GEN-1 · TIMING / ADVISORY'), 'Gen-1 身份必须显式');
    assert.ok(html.includes('代码上线') && html.includes('生产运行') && html.includes('资格演进'), '生命周期三轴必须分开渲染');
    assert.ok(html.includes('战略减仓'), '关注标的需要渲染动作');
    assert.ok(html.includes('Gen-1 只提供时机与适用性建议'), '必须渲染 Gen-1 边界说明');
    // 双形态 DOM 同时存在（由 CSS 决定可见性）
    assert.ok(html.includes('tbl-wrap') && html.includes('tbl-mobile'), '必须同时具备桌面表与移动卡两种形态');
  });

  await ok('A canonical：标的级 Gen-1 有契约 ⇒ 渲染状态而非「未提供」', async () => {
    const vm = adaptDashboard(FIXTURES.canonicalDashboard(), RS(), { retrievedAt: REAL });
    const html = await renderVm(vm);
    assert.ok(html.includes('暂无机会'), 'canonical 卡片级 Gen-1 应渲染后端 signal_status 文案');
    assert.ok(html.includes('0 / 5') === false, 'canonical 下不该说 0/5 未下发');
    assert.ok(html.includes('已下发 5 / 5'), '应显示 5/5 已下发');
  });

  /* ==================== B 线上旧响应 ==================== */

  await ok('B 线上旧响应：降级展示 + 通道标注 + Gen-1 未提供（⛔ 不猜测）', async () => {
    const vm = adaptDashboard(FIXTURES.liveDashboard(), RS(), { retrievedAt: REAL });
    const html = await renderVm(vm, 'ready-degraded');

    assert.ok(html.includes('降级展示'), '契约未部署必须显式告知');
    assert.ok(html.includes('运行时状态'), '必须标注非契约通道');
    assert.ok(html.includes('降级（禁止灰度）'), '后端 health 标签应透传');
    assert.ok(html.includes('已下发 0 / 5'), '标的级 Gen-1 未下发要如实显示');
    assert.ok(html.includes('数据未提供'), '缺失位必须显式');
    assert.ok(html.includes('7 / 8 项无数据'), '生命周期未提供计数必须显示');
  });

  /* ==================== C 字段为 null ==================== */

  await ok('C canonical 字段为 null：渲染「字段缺失」，⛔ 不显示 0 或空', async () => {
    const data = clone(FIXTURES.canonicalDashboard());
    data.cards = [data.cards[0]];
    data.cards[0].production.final_target_pct = null;
    const vm = adaptDashboard(data, RS(), { retrievedAt: REAL });
    const html = await renderVm(vm);
    assert.ok(html.includes('字段缺失'), 'null 字段必须渲染「字段缺失」');
  });

  /* ==================== D 字段缺失 ==================== */

  await ok('D canonical 字段缺失：整块进入显式缺失态且不抛错', async () => {
    const data = clone(FIXTURES.canonicalDashboard());
    data.cards = [data.cards[0]];
    delete data.cards[0].gen1.safety;
    delete data.cards[0].production;
    const vm = adaptDashboard(data, RS(), { retrievedAt: REAL });
    const html = await renderVm(vm);
    assert.ok(html.length > 500);
    assert.ok(html.includes('字段缺失') || html.includes('数据未提供'));
  });

  /* ==================== E legacy-only ==================== */

  await ok('E legacy-only（无 canonical、无运行时状态）：Gen-1 区显式未提供', async () => {
    const vm = adaptDashboard(FIXTURES.liveDashboard(), null, { retrievedAt: REAL });
    const html = await renderVm(vm, 'ready-degraded');
    assert.ok(html.includes('未提供'), '必须出现显式未提供');
    assert.ok(html.includes('后端既未下发 canonical 契约，也未提供运行时状态'), 'NONE 通道必须给明确说明');
    assert.ok(html.includes('8 / 8 项无数据'), 'runtime_status 不可读 ⇒ 8/8 未提供');
  });

  /* ==================== F malformed ==================== */

  await ok('F malformed：畸形响应仍能渲染，不抛异常、不出现 undefined', async () => {
    const vm = adaptDashboard(FIXTURES.malformed(), RS(), { retrievedAt: REAL });
    const html = await renderVm(vm);
    assert.ok(html.length > 300);
    assert.ok(!html.includes('undefined'), '⛔ 页面不得出现 undefined');
    assert.ok(!html.includes('[object Object]'), '⛔ 页面不得出现 [object Object]');
    assert.ok(!html.includes('NaN'), '⛔ 页面不得出现 NaN');
  });

  /* ==================== stale ==================== */

  await ok('★ stale：过期数据在页面上有专门提示，⛔ 不与「无时间戳」混同', async () => {
    const data = clone(FIXTURES.liveDashboard());
    data.overview.snapshot_date = '2020-01-01';
    const vm = adaptDashboard(data, { decision_date: '2020-01-01' }, { retrievedAt: REAL });
    const html = await renderVm(vm, 'ready-degraded');
    assert.ok(html.includes('数据已过期'), '过期必须显式提示');
    assert.ok(html.includes('freshness stale'), '过期状态需要有独立样式钩子（可测）');
  });

  await ok('★ 无时间戳（MISSING）与过期（STALE）文案不同', async () => {
    const data = clone(FIXTURES.liveDashboard());
    delete data.overview.snapshot_date;
    const vm = adaptDashboard(data, null, { retrievedAt: REAL });
    const html = await renderVm(vm, 'ready-degraded');
    assert.ok(html.includes('无时间戳'));
    assert.ok(!html.includes('数据已过期'));
  });

  /* ==================== 页面级状态：loading / error / empty ==================== */

  await ok('loading：渲染骨架，⛔ 不渲染任何业务数字（防「0%」被误读）', async () => {
    const html = await render({ phase: 'loading', vm: null });
    assert.ok(html.includes('读取中'));
    assert.ok(html.includes('skeleton'));
    for (const bad of ['0.0%', '防守', '战略减仓', '数据未提供']) {
      assert.ok(!html.includes(bad), 'loading 态不得出现「' + bad + '」');
    }
  });

  await ok('error：渲染可读错误 + 重试按钮，⛔ 不回显堆栈', async () => {
    const html = await render({ phase: 'error', vm: null, error: '网络不可达，请检查网络后重试。' });
    assert.ok(html.includes('数据读取失败'));
    assert.ok(html.includes('网络不可达'));
    assert.ok(html.includes('重试'));
    assert.ok(!html.includes('at '), '⛔ 不得出现堆栈片段');
  });

  await ok('empty：显式空态文案（⛔ 不留白屏）', async () => {
    const vm = adaptDashboard(FIXTURES.emptyArrays(), null, { retrievedAt: REAL });
    const html = await renderVm(vm, 'empty');
    assert.ok(html.includes('暂无数据'));
    assert.ok(html.includes('后端未返回可用数据'));
  });

  /* ==================== 生命周期未提供（专用断言） ==================== */

  await ok('★ 生命周期未提供：三轴仍在，格子显示「数据未提供」+ 原因，⛔ 无写死状态', async () => {
    const data = clone(FIXTURES.canonicalDashboard());
    delete data.system_runtime;                     // 无契约
    const vm = adaptDashboard(data, null, { retrievedAt: REAL });   // 且无 runtime_status
    const html = await renderVm(vm);
    assert.ok(html.includes('8 / 8 项无数据'));
    assert.ok(html.includes('后端未提供对应接口'));
    assert.ok(html.includes('本页不会用台账或静态清单填补'));
    assert.ok(html.includes('生产生命周期状态'));
    // ★ §五：Dashboard ⛔ 不得凭台账写死部署版本身份（API 无法支撑）
    assert.ok(!html.includes('V3.6.5'), '⛔ Dashboard 不得出现写死的部署版本身份');
    assert.ok(html.includes('不声明部署版本身份'), '必须显式说明不声明版本身份');
    // ⛔ 台账值绝不得出现在页面上
    for (const s of ['NOT_STARTED', 'NOT_GRANTED', 'NOT_EXECUTED', 'EXACT_MATCH']) {
      assert.ok(!html.includes(s), '⛔ 页面不得出现状态字面量 ' + s);
    }
    for (const p of FORBIDDEN_LIFECYCLE_PHRASES) {
      assert.ok(!html.includes(p), '⛔ 页面不得出现违规文案「' + p + '」');
    }
  });

  /* ==================== 数字语义（集成级） ==================== */

  await ok('★ 数字语义：final_target=0.5 渲染为 0.5%（⛔ 页面上不得出现 50%）', async () => {
    const vm = adaptDashboard(FIXTURES.liveDashboard(), RS(), { retrievedAt: REAL });
    const html = await renderVm(vm, 'ready-degraded');
    assert.ok(html.includes('0.5%'), 'final_target 0.5 必须渲染为 0.5%');
    assert.ok(!html.includes('50.0%'), '⛔ 不得渲染成 50.0%');
    assert.ok(!html.includes('>50%'), '⛔ 不得渲染成 50%');
    assert.ok(html.includes('8.3%'), '当前仓位 8.3% 应正常渲染');
    assert.ok(html.includes('15.4%'), '组合仓位 15.4% 应正常渲染');
    assert.ok(html.includes('0.4% ~ 0.5%'), '目标带应逐项带百分号');
  });

  await ok('★ 金额默认遮罩：页面渲染 •••• 而非真实金额（隐私默认）', async () => {
    const vm = adaptDashboard(FIXTURES.liveDashboard(), RS(), { retrievedAt: REAL });
    const html = await renderVm(vm, 'ready-degraded');
    assert.ok(html.includes('••••'), '默认应遮罩');
    assert.ok(html.includes('显示'), '应提供显隐开关');
    assert.ok(!html.includes('9.92 万'), '⛔ 遮罩态不得渲染真实金额');
  });

  /* ==================== 安全：XSS 转义 ==================== */

  await ok('★ 安全：后端字段中的 HTML 必须被转义（⛔ 不产生可执行标签）', async () => {
    const data = clone(FIXTURES.liveDashboard());
    data.cards[0].name = 'X<script>alert(1)</script>';
    data.three_questions.most_defend = { code: '513310', name: '<img src=x onerror=alert(1)>' };
    const vm = adaptDashboard(data, RS(), { retrievedAt: REAL });
    const html = await renderVm(vm, 'ready-degraded');
    assert.ok(!html.includes('<script>alert(1)</script>'), '⛔ 未转义脚本');
    assert.ok(!html.includes('<img src=x'), '⛔ 未转义标签');
    assert.ok(html.includes('&lt;script&gt;'), '应转义为实体');
  });

  console.log('\ndashboard-render.test: ' + pass + ' 项全过');
} finally {
  await server.close();
}
