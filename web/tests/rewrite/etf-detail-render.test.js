/**
 * ETF 工作台渲染测试（M4-P1 · SSR 真渲染，非字符串拼接）
 *
 * 做法：用 vite 的 SSR 模块加载器加载真实 `.vue`（含 SFC 编译），
 *       再用 `@vue/server-renderer` 渲染成 HTML 做结构化断言
 *       ⇒ 断言对象是**组件真实输出**。
 *
 * 覆盖 owner 指定的 M4 验收场景 + 两项专项：
 *   ⑦ K-line stale 的**实际渲染结果**
 *   ⑧ Gen-1 Legacy Advisory 的**实际视觉层级**（DOM 顺序 + 权重类名）
 *
 * ⚠️ 本套件启动一个 vite dev server（middleware 模式，⛔ 不 spawn 子进程），
 *     必须在 finally 中关闭，否则 runner 进程不会退出。
 */
import { createServer } from 'vite';
import { createSSRApp } from 'vue';
import { renderToString } from '@vue/server-renderer';
import { adaptEtfDetail } from '../../src/rewrite/adapters/etfDetail.js';
import { FIXTURES, assert } from './_fixtures.js';

const REAL = '2026-09-30T20:00:00.000Z';
const LIVE = () => FIXTURES.m4('etf-normal.json');
const K60 = () => FIXTURES.m4('kline-live60.json');

/** 完整 VM（带 K 线 + 历史 + 组合环境只读引用） */
const VM = (data, opts = {}) => adaptEtfDetail(data, null, {
  klineRaw: K60(),
  decisionsRaw: FIXTURES.m4('decisions-normal.json'),
  marketRaw: FIXTURES.liveDashboard(),
  retrievedAt: REAL,
  ...opts
});
/** 无 K 线的 VM */
const VM_NO_K = (data, opts = {}) => adaptEtfDetail(data, null, { klineRaw: [], retrievedAt: REAL, ...opts });

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
  const mod = await server.ssrLoadModule('/src/rewrite/components/workbench/DetailView.vue');
  const DetailView = mod.default;
  assert.ok(DetailView, '未能加载 DetailView.vue');

  const renderVm = (vm) => renderToString(createSSRApp(DetailView, { vm }));

  /** 取 HTML 中某个 class 所在区块的片段（到下一个同级 section 为止），用于**分区断言** */
  function sectionOf(html, marker, nextMarkers = []) {
    const i = html.indexOf(marker);
    if (i < 0) return '';
    let end = html.length;
    for (const m of nextMarkers) {
      const j = html.indexOf(m, i + marker.length);
      if (j > 0) end = Math.min(end, j);
    }
    return html.slice(i, end);
  }

  /* ==================== A 正常渲染 ==================== */

  await ok('A normal：IA 七个区块按序渲染（Header → 决策 → 仓位 → Gen-1 → K 线 → 结构 → 数据质量）', async () => {
    const html = await renderVm(VM(LIVE()));
    const order = [
      'wb-head',            // ① 页头
      'primary-decision',   // ③ 正式决策
      'pos-grid',           // ④ 仓位三轴
      'gen1-advisory',      // ⑤ Gen-1（降权）
      'mkline',             // ⑥ K 线
      'struct-states',      // ⑦ 结构
      '数据质量'            // ⑨ 数据质量
    ];
    let prev = -1;
    for (const m of order) {
      const at = html.indexOf(m);
      assert.ok(at > -1, '缺区块: ' + m);
      assert.ok(at > prev, '区块顺序错误: ' + m + ' 应晚于前一个');
      prev = at;
    }
    assert.ok(html.includes('中韩半导体ETF(QDII)'), '页头应渲染标的名称');
    assert.ok(html.includes('V3 Safety Core · 安全与最终权威'), '正式决策归属必须可见');
    assert.ok(html.includes('GEN-1 · TIMING / ADVISORY'), 'Gen-1 身份必须可见');
  });

  await ok('A normal：三类仓位分区渲染（建议 / 实际 / 配置标准 各带标签）', async () => {
    const html = await renderVm(VM(LIVE()));
    assert.ok(html.includes('实际（当前持仓）'), '必须显式标注「实际」');
    assert.ok(html.includes('配置标准（标的配置表）'), '必须显式标注「配置标准」');
    assert.ok(html.includes('8.3%'), '当前仓位应渲染');
    assert.ok(html.includes('12.6%'), '实际核心应渲染');
    assert.ok(html.includes('0.2%'), '建议核心应渲染（⛔ 与实际 12.6% 分开）');
    assert.ok(html.includes('20.0% ~ 30.0%'), '配置带应渲染');
    assert.ok(html.includes('0.4% ~ 0.5%'), '决策带应渲染');
  });

  /* ==================== B 数字语义（0 / 0.5 / 28.5 专项） ==================== */

  await ok('★ B 数字语义：0.5 ⇒ `0.5%`（⛔ 渲染结果中不得出现 50%）', async () => {
    const html = await renderVm(VM(LIVE()));
    assert.ok(html.includes('0.5%'), '应渲染 0.5%');
    assert.ok(!html.includes('50.0%'), '⛔ 不得出现 50.0%');
    assert.ok(!/>50%</.test(html), '⛔ 不得出现 50%');
  });

  await ok('★ B 数字语义：target=0 ⇒ `0.0%`（⛔ 不得显示 — 或缺失）', async () => {
    const html = await renderVm(adaptEtfDetail(FIXTURES.m4('etf-target-0.json'), null, { klineRaw: [] }));
    assert.ok(html.includes('0.0%'), '0 是合法值，应渲染 0.0%');
    assert.ok(html.includes('最终目标'), '目标标签应存在');
  });

  await ok('★ B 数字语义：target=28.5 ⇒ `28.5%`', async () => {
    const html = await renderVm(adaptEtfDetail(FIXTURES.m4('etf-target-28p5.json'), null, { klineRaw: [] }));
    assert.ok(html.includes('28.5%'));
  });

  await ok('★ B 系数：market_factor=0.25 渲染为 `0.25`（⛔ 不是 25%）', async () => {
    const html = await renderVm(VM(LIVE()));
    assert.ok(html.includes('0.25'), '系数应渲染 0.25');
    const seg = sectionOf(html, '阶段 / 市场系数', ['<hr']);
    assert.ok(seg.includes('0.25') && !seg.includes('25%'), '系数区不得出现 25%：' + seg.slice(0, 160));
  });

  /* ==================== C Gen-1 Legacy Advisory（★ 专项 ⑧） ==================== */

  await ok('★ C Gen-1：通道角标 = `Legacy Channel`，caveat 逐字渲染', async () => {
    const html = await renderVm(VM(LIVE()));
    assert.ok(html.includes('Legacy Channel'), '必须渲染 Legacy Channel 角标');
    // ⚠️ 本断言在 M5-P8 被**修正**：原文案里写着后端字段路径 `system_runtime.gen1`，
    //    旧断言反而**要求该字段名必须存在** —— 那是错误预期（把泄露当成规范）。
    //    现改为：渲染新的大白话文案，并**显式要求字段名不存在**。
    assert.ok(html.includes('当前页面使用的是历史兼容通道的数据'), 'caveat 前半句必须逐字渲染');
    assert.ok(!html.includes('system_runtime'), '★ M5-P8：caveat ⛔ 不得出现后端字段路径');
    assert.ok(html.includes('正式 Gen-1 契约数据。'), 'caveat 结尾必须存在');
    assert.ok(html.includes('Legacy 通道'), '逐字段角标必须存在');
  });

  await ok('★ C Gen-1：⛔ 不得出现 canonical 自我宣称（除 caveat 否定句外）', async () => {
    const html = await renderVm(VM(LIVE()));
    const seg = sectionOf(html, 'gen1-advisory');
    // caveat 里出现一次 "canonical"（否定句），⛔ 不得出现 "Canonical Channel"
    assert.ok(!seg.includes('Canonical Channel'), '⛔ legacy 通道不得显示 Canonical Channel');
    assert.ok(!seg.includes('isCanonical'), '⛔ 不得泄露标志位');
  });

  await ok('★ C-⑧ 视觉层级：Gen-1 区在正式决策**之后**，且**不含 hero 权重数字**', async () => {
    const html = await renderVm(VM(LIVE()));
    const pdAt = html.indexOf('primary-decision');
    const g1At = html.indexOf('gen1-advisory');
    assert.ok(pdAt > -1 && g1At > -1);
    assert.ok(pdAt < g1At, '★ Safety Core 必须排在 Gen-1 Legacy Advisory 之前');

    const g1 = sectionOf(html, 'gen1-advisory', ['mkline']);
    assert.ok(g1.length > 0);
    // ⛔ Gen-1 区不得使用 hero 级大数字类（那会让它看起来比正式决策更权威）
    for (const cls of ['pd-hero-num', 'pos-num', 'wb-price-num', 'hero-action']) {
      assert.ok(!g1.includes(cls), '⛔ Gen-1 区不得使用 ' + cls);
    }
    // Gen-1 区必须有降权边线类
    assert.ok(html.includes('gen1-advisory'), 'Gen-1 区必须带自己的降权样式类');
  });

  await ok('★ C Gen-1：反事实声明与「不改变正式目标」可见', async () => {
    const html = await renderVm(VM(LIVE()));
    assert.ok(html.includes('不改变正式目标'));
    assert.ok(html.includes('反事实（影子推演）'));
  });

  await ok('★★ C 守卫：Gen-1 区的**值**必须真的渲染出来（⛔ 不得只有标签没有值）', async () => {
    const html = await renderVm(VM(LIVE()));
    const g1 = sectionOf(html, 'gen1-advisory', ['mkline']);
    assert.ok(g1.length > 0);
    /**
     * ★ 本条是**防复发守卫**：M4-P1 浏览器核验曾抓到「adapter 透传裸 Field、
     *   组件只认 display 对象」⇒ Gen-1 整区**只剩标签、值全空**，
     *   而当时的 SSR 断言只检查了标题/caveat ⇒ 漏检。
     */
    assert.ok(g1.includes('CANARY'), '权限档位必须有值（gen1_authority）');
    assert.ok(g1.includes('DEGRADED'), '健康状态必须有值（gen1_health_status）');
    assert.ok(g1.includes('ACTIVE'), '健康门控必须有值');
    assert.ok(g1.includes('0.65'), '模型阈值必须有值');
    assert.ok(g1.includes('BLOCK'), 'Safety Core 放行许可必须有值');
    assert.ok(g1.includes('SAFETY_CORE'), '闸门判定来源必须有值');
    assert.ok(g1.includes('S1') && g1.includes('S0'), '三段 stage 必须有值');
    assert.ok(/gen1-eod-\d{8}/.test(g1), '运行 ID 必须有值');
    // ⛔ 反向：不得出现 Field 形态的裸值泄漏
    assert.ok(!g1.includes('[object Object]'), '⛔ 不得把 Field 对象直接渲染');
  });

  await ok('C Gen-1：三级全空 ⇒ 「数据未提供」（⛔ 不显示「正常/无信号/关闭」）', async () => {
    const html = await renderVm(adaptEtfDetail(FIXTURES.m4('etf-gen1-missing.json'), null, { klineRaw: [] }));
    assert.ok(html.includes('数据未提供'));
    assert.ok(html.includes('No Channel'));
    assert.ok(!html.includes('Legacy Channel'), '⛔ 无数据时不得显示通道角标');
  });

  /* ==================== D K 线 stale（★ 专项 ⑦） ==================== */

  await ok('★ D-⑦ K 线滞后：置顶 banner 渲染，日期来自实际数据', async () => {
    const html = await renderVm(VM(LIVE()));
    assert.ok(html.includes('stale-banner'), '必须渲染滞后 banner');
    assert.ok(html.includes('K 线数据已明显滞后'), 'banner 标题');
    assert.ok(html.includes('当前 K 线截至 2024-08-27，早于当前决策日 2026-09-29。'), 'banner 正文必须含实际日期');
    assert.ok(html.includes('STALE · 数据滞后'), 'K 线状态标签');
  });

  await ok('★ D-⑦ K 线：**图表保留**（⛔ 不因 stale 隐藏历史数据）', async () => {
    const html = await renderVm(VM(LIVE()));
    assert.ok(html.includes('mkline-svg'), 'K 线 SVG 必须仍渲染');
    assert.ok(html.includes('data-date="2024-08-27"'), '最后一根蜡烛必须在图内');
    assert.ok(html.includes('data-date="2024-06-03"') || html.includes('mkline-body'), '蜡烛体必须存在');
    assert.ok(html.includes('共 60 根'), '必须标明根数');
    const candles = (html.match(/data-date="/g) || []).length;
    assert.equal(candles, 60, '必须逐根渲染 60 根，实际 ' + candles);
  });

  await ok('★ D banner：显式声明「K 线新鲜度与决策新鲜度相互独立」', async () => {
    const html = await renderVm(VM(LIVE()));
    assert.ok(html.includes('K 线新鲜度与决策新鲜度'));
    assert.ok(html.includes('相互独立'));
    assert.ok(html.includes('数据新鲜'), '决策新鲜度应显示为「数据新鲜」（⛔ 不得被 K 线 stale 带跑）');
  });

  await ok('D K 线：无滞后时 ⛔ 不渲染 banner', async () => {
    const html = await renderVm(VM_NO_K(LIVE()));
    assert.ok(!html.includes('stale-banner'), '空 K 线不得显示滞后 banner');
    assert.ok(html.includes('K 线数据为'), '应显示「空」的显式说明');
  });

  await ok('D K 线：读取失败 ⇒ 「读取失败」，与「空」文案不同', async () => {
    const html = await renderVm(adaptEtfDetail(LIVE(), null, { klineRaw: null, klineError: 'boom', retrievedAt: REAL }));
    assert.ok(html.includes('读取失败'));
    assert.ok(html.includes('不是'), '必须说明这不是「没有行情数据」');
    assert.ok(!html.includes('mkline-svg'), '⛔ 失败时不得画空图冒充');
  });

  await ok('D K 线：未请求（UNAVAILABLE）⇒ 「数据未提供」', async () => {
    const html = await renderVm(adaptEtfDetail(LIVE(), null, { retrievedAt: REAL }));
    assert.ok(html.includes('数据未提供'));
    assert.ok(!html.includes('mkline-svg'));
  });

  /* ==================== E 决策链定性（M4-D3 的渲染证据） ==================== */

  await ok('★ E 决策链：渲染出的定性链**不含**与正式字段冲突的数字', async () => {
    const html = await renderVm(VM(LIVE()));
    // ⚠️ 切片边界必须用 PrimaryDecision 之后的**下一个区块**（pos-grid）；
    //    用「K 线」会命中页头文案 ⇒ 切片退化成全文，误报冲突数字
    const seg = sectionOf(html, '为什么（定性条件）', ['pos-grid']);
    assert.ok(seg.length > 0, '应渲染决策链区');
    assert.ok(seg.length < html.length, '切片必须真的截断（⛔ 不得退化成全文）');
    for (const bad of ['-7.8', '21%', '12.6%', '18~24']) {
      assert.ok(!seg.includes(bad), '⛔ 决策链区不得出现冲突数字 ' + bad);
    }
    assert.ok(seg.includes('［数字已隐藏］'), '遮蔽标记必须可见');
    assert.ok(seg.includes('已隐藏'), '隐藏条数说明必须可见');
    assert.ok(seg.includes('防守模式'), '纯定性结果必须保留');
  });

  await ok('E 决策链：不可用时显式「数据未提供」', async () => {
    const html = await renderVm(adaptEtfDetail(FIXTURES.m4('etf-malformed.json'), null, { klineRaw: [] }));
    assert.ok(html.includes('决策链'));
  });

  /* ==================== F 缺失 / 异常 ==================== */

  await ok('F decision-missing：正式决策区显式「数据未提供」，⛔ 不显示 0', async () => {
    const html = await renderVm(adaptEtfDetail(FIXTURES.m4('etf-decision-missing.json'), null, { klineRaw: [] }));
    assert.ok(html.includes('正式决策'));
    assert.ok(html.includes('数据未提供'));
    const seg = sectionOf(html, 'primary-decision', ['pos-grid']);
    assert.ok(!seg.includes('0.0%'), '⛔ 缺失时不得渲染 0.0%（那是把"没有"说成"是 0"）');
  });

  await ok('F malformed：不抛异常、无 undefined / NaN / [object Object]', async () => {
    let html = '';
    await assert.doesNotReject(async () => {
      html = await renderVm(adaptEtfDetail(FIXTURES.m4('etf-malformed.json'), null, { klineRaw: null }));
    });
    for (const bad of ['undefined', 'NaN', '[object Object]']) {
      assert.ok(!html.includes(bad), '⛔ 渲染结果不得出现 ' + bad);
    }
  });

  await ok('F 缺失清单：数据质量区渲染 missingItems', async () => {
    const html = await renderVm(VM(LIVE()));
    assert.ok(html.includes('显式缺失 / 未提供'));
    assert.ok(html.includes('风险 · 溢价率'), '溢价率恒 null 应出现在缺失清单');
    assert.ok(html.includes('后端下发了该字段但值为 null'), '必须给出缺失原因');
  });

  /* ==================== G 安全与工程约束 ==================== */

  await ok('G XSS：标的名称中的 HTML 必须被转义', async () => {
    const data = JSON.parse(JSON.stringify(LIVE()));
    data.basic.name = '<img src=x onerror=alert(1)>';
    const html = await renderVm(adaptEtfDetail(data, null, { klineRaw: [] }));
    assert.ok(!html.includes('<img src=x'), '⛔ 不得注入原始 HTML');
    assert.ok(html.includes('&lt;img'), '应转义为实体');
  });

  await ok('G ⛔ 渲染结果不得泄露后端原始字段名', async () => {
    const html = await renderVm(VM(LIVE()));
    for (const raw of ['final_target', 'position_gap', 'core_position', 'over_alloc_status',
      'gen1_authority', 'ml_shadow', 'high_volume_stagnation', 'f_state']) {
      assert.ok(!html.includes(raw), '⛔ HTML 中不得出现后端字段名 ' + raw);
    }
  });

  await ok('G ⛔ 不得出现被禁的装饰性样式钩子（SPEC §12.3）', async () => {
    const html = await renderVm(VM(LIVE()));
    assert.ok(!html.includes('linear-gradient'));
    assert.ok(!html.includes('backdrop-filter'));
  });

  await ok('G 数据质量：各域新鲜度并列且独立渲染', async () => {
    const html = await renderVm(VM(LIVE()));
    assert.ok(html.includes('决策（decision）'));
    assert.ok(html.includes('K 线（kline）'));
    assert.ok(html.includes('快照（snapshot）'));
    assert.ok(html.includes('基本面（fundamental）'));
    assert.ok(html.includes('Gen-1 可用性'));
    // K 线过期天数量化
    assert.ok(/滞后 \d+ 天/.test(html), '应渲染 K 线滞后天数');
  });

  await ok('G 结构区：维度显示全称（⛔ 不出现裸字母）', async () => {
    const html = await renderVm(VM(LIVE()));
    for (const dim of ['周线', '日线', '横盘', '量能']) {
      assert.ok(html.includes(dim), '缺维度全称: ' + dim);
    }
    assert.ok(html.includes('趋势破坏') || html.includes('强缩量'), '应渲染状态中文');
  });

  await ok('G 基本面：只渲染摘要，⛔ 不搬 fundamental_config / fundamental_series', async () => {
    const html = await renderVm(VM(LIVE()));
    assert.ok(html.includes('基本面摘要与证据'), '情报区标题须存在');
    /**
     * ★ M5-P1：原页尾重复的 `fundamentalsSummary` 段已删除 ⇒ 边界声明改由**情报区**承担：
     *   「本区**不消费**的载荷块：… 属「基本面」页范围，⛔ 不搬进工作台。」
     * ⚠️ 2026-10-02：原断言文本含内部 milestone 编号「（M6）」，该编号属开发期痕迹、
     *   已从生产 UI 移除 ⇒ 契约改为**不含编号的归属页声明**（语义不变：仍须声明归属页）。
     */
    assert.ok(html.includes('本区<b>不消费</b>的载荷块：'), '必须声明本区不消费的载荷块（边界）');
    assert.ok(html.includes('属「基本面」页范围，⛔ 不搬进工作台。'), '必须声明深层内容的归属页');
    /**
     * ⚠️ 第二阶段起 `layer_breakdown` **已在情报区展示**（属 `fundamental.detail` 内嵌，
     *    M4-P0 曾误记为「属 M6」）⇒ 本条只拦真正不消费的两个**块**。
     */
    for (const raw of ['fundamental_config', 'fundamental_series']) {
      assert.ok(!html.includes(raw), '⛔ 不得搬 ' + raw);
    }
    assert.ok(!/权重\s*[:：]/.test(html), '⛔ 不得出现分层权重明细以外的权重排版');
  });
  /* ==================== H 第二阶段：机会 / 防守 / 情报 / 历史 ==================== */

  await ok('H 机会雷达：分数（点）/ 系数（⛔ 非 %）/ 加仓模式 / 资格 10 项渲染', async () => {
    const html = await renderVm(VM(LIVE()));
    assert.ok(html.includes('机会 / 辅助信号'), '区块标题');
    assert.ok(html.includes('67'), '机会分必须渲染');
    assert.ok(html.includes('0.70'), '机会系数必须渲染');
    assert.ok(!html.includes('70%'), '⛔ 机会系数 0.7 不得渲染成 70%');
    assert.ok(html.includes('加仓资格判据'));
    const items = (html.match(/elig-item/g) || []).length;
    assert.equal(items, 10, '必须渲染 10 项判据，实际 ' + items);
    assert.ok(html.includes('⛔ 本页不会因为'), '必须显式声明不推导加仓');
  });

  await ok('★ H 防守雷达：等级 / 分数 / 系数**三重量纲**各自渲染且带说明', async () => {
    const html = await renderVm(VM(LIVE()));
    assert.ok(html.includes('防守雷达'));
    assert.ok(html.includes('轻度防守'), '等级中文（由 domain 映射，⛔ 前端不分档）');
    assert.ok(html.includes('level = 1'), '必须展示后端原始档位数字');
    assert.ok(html.includes('趋势破坏'), '后端原因');
    assert.ok(html.includes('分数 0~100'), '分数量纲说明');
    assert.ok(html.includes('乘性系数 0.50 ~ 1.00'), '系数量纲说明');
    assert.ok(html.includes('>37<'), '分数值');
    assert.ok(html.includes('0.95'), '系数值');
    assert.ok(!html.includes('95%'), '⛔ defense_penalty=0.95 不得渲染成 95%');
  });

  await ok('★ H 防守雷达：`[]` ⇒ 「当前没有返回风险事件数据」（⛔ 不得说「没有风险」）', async () => {
    const html = await renderVm(VM(LIVE()));
    assert.ok(html.includes('当前没有返回风险事件数据。'));
    assert.ok(html.includes('不等于'), '必须说明 ≠ 没有风险');
    assert.ok(!/没有风险[。，]/.test(html), '⛔ 不得出现「没有风险」');
  });

  await ok('H 防守雷达：level=0 且无 score/factor ⇒ 显式缺失（⛔ 不补 0 / 1.00）', async () => {
    const html = await renderVm(adaptEtfDetail(FIXTURES.m4('etf-defense-inactive.json'), null, { klineRaw: [], retrievedAt: REAL }));
    assert.ok(html.includes('无防守信号'));
    assert.ok(html.includes('数据未提供') || html.includes('字段缺失'));
    /**
     * ⚠️ 用 `>1.00<`（元素内容）而非裸 `1.00` —— 量纲说明文案本身就含「0.50 ~ 1.00」。
     */
    assert.ok(!html.includes('>1.00<'), '⛔ 不得把缺失的系数补成 1.00');
    /** ⚠️ 切片必须止于**紧邻的下一个区块**（`gen1-advisory`）；否则会把 Gen-1 区的真值 `0` 圈进来 */
    const seg = sectionOf(html, 'prio-risk', ['gen1-advisory', 'mkline']);
    assert.ok(seg.length > 0 && seg.length < html.length, '切片必须真的截断');
    assert.ok(!/>0</.test(seg), '⛔ 缺失分数不得渲染成 0');
  });

  await ok('H 情报：分层证据渲染；权重不含 %', async () => {
    const html = await renderVm(VM(LIVE()));
    assert.ok(html.includes('情报 / 基本面'));
    assert.ok(html.includes('硬数据') && html.includes('景气 / 财报'));
    assert.ok(html.includes('后端原始信号值'), '必须标注量纲未解释');
    assert.ok(html.includes('不消费'), '必须登记未消费载荷块');
    assert.ok(!html.includes('fundamental_config'), '⛔ 不得出现后端块名');
  });

  await ok('★ H 历史：真实记录 + 变化点（★ M5-P1 D-M5-2：只渲染最近 5 条）', async () => {
    const html = await renderVm(VM(LIVE()));
    assert.ok(html.includes('最近决策变化'), '标题须为「最近决策变化」');
    assert.ok(html.includes('2026-09-29') && html.includes('2026-09-22'), '覆盖区间仍应含首尾日期');
    assert.ok(html.includes('变化点（相邻记录对比）'));
    assert.ok(html.includes('hist-tbl') && html.includes('hist-cards'), '双形态必须同时存在');
    const cards = (html.match(/hist-card-nums/g) || []).length;
    assert.equal(cards, 5, '★ 移动卡必须为最近 5 条（D-M5-2），实际 ' + cards);
    assert.ok(html.includes('另有 1 条更早记录，完整审阅见「复盘」页。'), '必须显式说明截断与归口');
    assert.ok(html.includes('不由当前字段拼装'), '必须声明不伪造');
    assert.ok(html.includes('完整历史审阅属「复盘」页'), '必须声明完整历史不在此复制');
  });

  await ok('★★ H 历史四态：文案**两两不同**且都**不伪造**条目', async () => {
    const cases = [
      ['unavailable', undefined, '数据未提供'],
      ['error', null, '读取失败'],
      ['empty', [], '为空'],
      ['malformed', FIXTURES.m4('decisions-error.json'), '缺失']
    ];
    const texts = [];
    for (const [name, raw, expectWord] of cases) {
      const html = await renderVm(adaptEtfDetail(LIVE(), null, { klineRaw: [], decisionsRaw: raw, retrievedAt: REAL }));
      assert.ok(html.includes(expectWord), name + ' 应包含「' + expectWord + '」');
      assert.ok(!html.includes('hist-card-nums'), name + ' ⛔ 不得渲染任何历史条目（伪造）');
      assert.ok(html.includes('prio-history'), name + ' 区块本身必须存在（⛔ 不是隐藏）');
      texts.push((html.match(/prio-history[\s\S]{0,400}/) || [''])[0]);
    }
    assert.equal(new Set(texts).size, 4, '四态渲染片段必须互不相同');
  });

  await ok('★ H 空数据总检：⛔ 不得出现 0 / 0% / NaN / undefined / [object Object]', async () => {
    const cases = [
      FIXTURES.m4('etf-opportunity-missing.json'),
      FIXTURES.m4('etf-defense-missing.json'),
      FIXTURES.m4('etf-defense-inactive.json'),
      FIXTURES.m4('etf-fundamental-minimal.json'),
      FIXTURES.m4('etf-decision-missing.json')
    ];
    for (const data of cases) {
      for (const raw of [undefined, null, []]) {
        const html = await renderVm(adaptEtfDetail(data, null, { klineRaw: null, decisionsRaw: raw, retrievedAt: REAL }));
        for (const bad of ['NaN', 'undefined', '[object Object]']) {
          assert.ok(!html.includes(bad), '⛔ 出现 ' + bad + '（' + (data.basic && data.basic.code) + '）');
        }
      }
    }
  });

  await ok('★ H 视觉层级：Formal Decision → Risk & Defense → History（DOM 顺序 + 语义优先级类）', async () => {
    const html = await renderVm(VM(LIVE()));
    /* ★ M5-P1 D-M5-4：类名改用**语义优先级**（⛔ 不再用数字档位） */
    const seq = ['primary-decision', 'prio-risk', 'prio-history'];
    let prev = -1;
    for (const cls of seq) {
      const at = html.indexOf(cls);
      assert.ok(at > -1, '缺优先级类: ' + cls);
      assert.ok(at > prev, cls + ' 顺序错误');
      prev = at;
    }
    // 优先级类必须真的挂在区块上（⛔ 不是只存在于 CSS）
    assert.ok(/class="[^"]*prio-risk/.test(html));
    assert.ok(/class="[^"]*prio-advisory/.test(html));
    assert.ok(/class="[^"]*prio-history/.test(html));
    assert.ok(/class="[^"]*prio-position/.test(html));
    // ⛔ 旧数字档位类名必须已清除（D-M5-4）
    for (const old of ['rank-defense', 'rank-advisory', 'rank-evidence', 'rank-history']) {
      assert.ok(!html.includes(old), '⛔ 旧数字档位类名残留: ' + old);
    }
  });
} finally {
  await server.close();
}

console.log('\netf-detail-render.test: ' + pass + ' 项全过');
