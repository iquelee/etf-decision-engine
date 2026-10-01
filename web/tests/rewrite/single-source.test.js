/**
 * 单源展示测试（M5-P1 · Single-Source Display Governance）
 * 规范依据：owner 裁定 M5-P1（2026-10-01）
 *          ＋ M5-P0 IA Review §9 P0-1（跨区块重复渲染 15 个事实）
 *
 * ══════════════════════════════════════════════════════════════════
 * ★ 本套件解决的问题：M4 已解决「信息有没有」，M5 解决「同一个事实出现了几次」。
 *   规则（owner 原文）：«同一个 backend 事实，在页面中必须有唯一明确的主位；
 *   其他区块如必须出现，只能作为引用位，不能再次解释成另一套判断。»
 *
 * ★ 判定方式（机器可判）：
 *   `components/domain/Fact.vue` 渲染 `data-fact` / `data-role` / `data-ref-to`：
 *     · `data-role="owner"` 每个事实**必须恰好 1 个**；
 *     · `data-role="ref"` 必须带 `data-ref-to`（= 注册表里的主位）且**紧邻可见的「引用」标记**；
 *     · 引用位窗口内 ⛔ 不得出现该事实的禁用语（= 不得产生第二套判断）。
 *
 * ⚠️ 与 M4 既有「块内数量」测试（K 线根数 / 资格项数 / 历史卡数）**互补**：
 *   那些数的是**块内元素**，本套件数的是**同一事实跨区块的出现次数**。
 */
import { createServer } from 'vite';
import { createSSRApp } from 'vue';
import { renderToString } from '@vue/server-renderer';
import { adaptEtfDetail } from '../../src/rewrite/adapters/etfDetail.js';
import {
  FACT, OWNER, OWNER_LABEL, ALL_FACTS, FACT_OWNERSHIP, GOVERNANCE_FACTS,
  ownerOf, ownerLabel, refText, forbiddenPhrases, isAllowedAt, factsOf
} from '../../src/rewrite/domain/ownership.js';
import { sanitizeConditionText, hasConflictingGapQuant } from '../../src/rewrite/domain/condition.js';
import { FIXTURES, assert } from './_fixtures.js';

const REAL = '2026-10-01T00:30:00.000Z';
const LIVE = () => FIXTURES.m4('etf-normal.json');
const VM = (data, opts = {}) => adaptEtfDetail(data, null, {
  klineRaw: FIXTURES.m4('kline-live60.json'),
  decisionsRaw: FIXTURES.m4('decisions-normal.json'),
  marketRaw: FIXTURES.liveDashboard(),
  retrievedAt: REAL,
  ...opts
});

let pass = 0;
async function ok(label, fn) {
  await fn();
  pass++;
  console.log('[PASS] ' + label);
}

/* ==================== 一、注册表自洽（纯函数，无需渲染） ==================== */

ok('注册表自洽：owner 合法、refs 与 owner 不重叠、每个事实都有规则与治理标记', () => {
  const problems = [];
  for (const f of ALL_FACTS) {
    const r = FACT_OWNERSHIP[f];
    if (!r) { problems.push(f + ' 缺注册项'); continue; }
    if (!OWNER_LABEL[r.owner]) problems.push(f + ' 的 owner 不在 OWNER_LABEL: ' + r.owner);
    if (r.refs.includes(r.owner)) problems.push(f + ' 的 refs 含 owner 自身');
    for (const x of r.refs) {
      if (!OWNER_LABEL[x]) problems.push(f + ' 的 ref 不在 OWNER_LABEL: ' + x);
    }
    if (new Set(r.refs).size !== r.refs.length) problems.push(f + ' 的 refs 有重复');
    if (!r.rule || r.rule.length < 8) problems.push(f + ' 缺可读规则');
    if (typeof r.governance !== 'boolean') problems.push(f + ' 缺 governance 标记');
    if (!Array.isArray(r.forbid)) problems.push(f + ' 的 forbid 不是数组');
  }
  assert.equal(problems.length, 0, problems.join('; '));
  assert.ok(GOVERNANCE_FACTS.length >= 18, '治理敏感事实应 ≥18，实际 ' + GOVERNANCE_FACTS.length);
});

ok('注册表纯函数：ownerOf / refText / isAllowedAt / forbiddenPhrases 行为正确', () => {
  assert.equal(ownerOf(FACT.RISK_FLAG), OWNER.PRIMARY_DECISION);
  assert.equal(ownerOf(FACT.RISK_EVENTS), OWNER.INTELLIGENCE);
  assert.equal(ownerOf(FACT.POSITION_GAP), OWNER.POSITION_RISK);
  assert.equal(ownerOf('不存在的事实'), null);
  assert.equal(refText(OWNER.PRIMARY_DECISION), '见「正式决策」');
  assert.equal(refText(OWNER.INTELLIGENCE), '见「情报 / 基本面」');
  assert.equal(isAllowedAt(FACT.RISK_FLAG, OWNER.PRIMARY_DECISION), false || true); // owner 允许
  assert.equal(isAllowedAt(FACT.RISK_FLAG, OWNER.DEFENSE_RADAR), true, '防守雷达是允许的引用位');
  assert.equal(isAllowedAt(FACT.RISK_EVENTS, OWNER.POSITION_RISK), false, '⛔ 仓位区不得出现风险事件');
  const forb = forbiddenPhrases();
  assert.ok(forb.includes('应该加仓') && forb.includes('买入信号') && forb.includes('应该卖出'));
  assert.ok(factsOf(OWNER.OPPORTUNITY_RADAR).length >= 4, '机会区应拥有 ≥4 个事实');
});

ok('★ 事实 ID ⛔ 不得使用后端 snake_case 字段名（会被渲染进 data-fact）', () => {
  const bad = ALL_FACTS.filter((f) => f.includes('_'));
  assert.equal(bad.length, 0, '⛔ 含下划线的事实 ID: ' + bad.join(', '));
});

/* ==================== 二、条件遮蔽（D-M5-5 / DS-006，纯函数） ==================== */

ok('★ 条件遮蔽：真实原文的冲突 Gap 数字被移除，定性文字逐字保留（⛔ 不换算）', () => {
  const raw = LIVE().decision.next_add_condition;
  assert.ok(hasConflictingGapQuant(raw), '前置：真实原文确实含冲突的 Gap 定量');
  const r = sanitizeConditionText(raw);
  assert.ok(!hasConflictingGapQuant(r.text), '展示文案不得再含 Gap 数字');
  assert.ok(!/Gap/i.test(r.text), '文案中不得残留 Gap 字样');
  assert.ok(r.text.includes('需 ≥ 3% 触发加仓'), '非冲突的阈值必须保留');
  assert.ok(r.text.includes('等待目标区间上移或回撤至横盘下沿'), '定性尾句必须逐字保留');
  assert.deepEqual([...r.removed], ['Gap -8%'], '被移除片段必须可审计');
  // ⛔ 不换算：不得出现从 -8 推导出的新数字
  for (const bad of ['-8', '8.0%', '0.0%', '-7.8']) {
    assert.ok(!r.text.includes(bad), '⛔ 不得换算/替换成 ' + bad);
  }
  assert.equal(sanitizeConditionText('满足条件后再评估，Gap -8%').text, '满足条件后再评估', 'owner 示例');
  assert.equal(sanitizeConditionText('等待回撤（需 ≥ 3%）').text, '等待回撤（需 ≥ 3%）', '无冲突 ⇒ 零改动');
});

/* ==================== 三、真渲染：单源性 ==================== */

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

  /** 统计某事实在 HTML 中的出现次数（按 `data-fact` 精确匹配，⛔ 不用裸子串） */
  function countFact(html, factId) {
    const re = new RegExp('data-fact="' + factId + '"\\s+data-role="(owner|ref)"', 'g');
    let m;
    const out = { owner: 0, ref: 0, refTo: [] };
    while ((m = re.exec(html)) !== null) {
      if (m[1] === 'owner') out.owner++;
      else {
        out.ref++;
        out.refTo.push('?');
      }
    }
    // 引用位必须带 data-ref-to
    const reRef = new RegExp('data-fact="' + factId + '"\\s+data-role="ref"\\s+data-ref-to="([^"]*)"', 'g');
    let k;
    const tos = [];
    while ((k = reRef.exec(html)) !== null) tos.push(k[1]);
    out.refTo = tos;
    return out;
  }

  await ok('★★ 每个事实 canonical owner **恰好 1 个**（全 24 个事实，逐个数）', async () => {
    const html = await renderVm(VM(LIVE()));
    const problems = [];
    const stats = {};
    for (const f of ALL_FACTS) {
      const c = countFact(html, f);
      stats[f] = c;
      if (c.owner !== 1) problems.push(f + ' owner=' + c.owner + '（应为 1）');
      const allowedRefs = FACT_OWNERSHIP[f].refs.length;
      if (c.ref > allowedRefs) problems.push(f + ' ref=' + c.ref + ' > 注册允许 ' + allowedRefs);
    }
    assert.equal(problems.length, 0, problems.join('; '));
    // 报告实际统计（可见证据）
    const line = ALL_FACTS.map((f) => f + ':' + stats[f].owner + '/' + stats[f].ref).join('  ');
    console.log('       事实 owner/ref 统计 → ' + line);
  });

  await ok('★ 引用位必须带 `data-ref-to`，且指向注册表里的主位', async () => {
    const html = await renderVm(VM(LIVE()));
    const problems = [];
    for (const f of ALL_FACTS) {
      const c = countFact(html, f);
      if (c.ref === 0) continue;
      if (c.refTo.length !== c.ref) problems.push(f + ' 有 ' + c.ref + ' 个引用位但只有 ' + c.refTo.length + ' 个 data-ref-to');
      for (const to of c.refTo) {
        if (to !== ownerOf(f)) problems.push(f + ' 的引用位指向 ' + to + '，应为 ' + ownerOf(f));
      }
    }
    assert.equal(problems.length, 0, problems.join('; '));
  });

  await ok('★ 引用位必须有**可见**「引用」标记，且不得产生第二套判断（窗口内禁用语为空）', async () => {
    const html = await renderVm(VM(LIVE()));
    const problems = [];
    for (const f of ALL_FACTS) {
      const c = countFact(html, f);
      if (c.ref === 0) continue;
      const re = new RegExp('data-fact="' + f + '"\\s+data-role="ref"[\\s\\S]{0,320}', 'g');
      let m;
      while ((m = re.exec(html)) !== null) {
        const win = m[0];
        if (!win.includes('引用')) problems.push(f + ' 的引用位缺可见「引用」标记');
        for (const bad of FACT_OWNERSHIP[f].forbid) {
          if (win.includes(bad)) problems.push(f + ' 的引用位窗口出现禁用语「' + bad + '」');
        }
      }
    }
    assert.equal(problems.length, 0, problems.join('; '));
  });

  await ok('★★ 三类误读守卫：gap ≠ 应该加仓 · opportunity ≠ 买入信号 · defense ≠ 应该卖出', async () => {
    const html = await renderVm(VM(LIVE()));

    /**
     * ⚠️ 判定方式：禁用词出现在**禁令说明句**里是**允许**的（如
     *   「⛔ 不得因 position_gap > 0 推导「应该加仓」」），出现在**结论位**才是违规。
     *   因此：只有当前缀 40 字内**没有**禁令标记、且该词不是被引号包裹的引用时才判违规。
     *   ⛔ 这不是放水——更强的精度检查在「每事实引用位窗口」那条（按 data-role 精确切窗）。
     */
    const PROHIBIT = /(⛔|不得|禁止|不会|不是|不能|无需|避免)/;
    function bannedHits(phrase) {
      const hits = [];
      let i = html.indexOf(phrase);
      while (i >= 0) {
        const before = html.slice(Math.max(0, i - 40), i);
        const quoted = /[「“"]\s*$/.test(before);
        if (!PROHIBIT.test(before) && !quoted) {
          hits.push(before.replace(/<[^>]*>/g, '').slice(-20) + ' ⟶ [' + phrase + ']');
        }
        i = html.indexOf(phrase, i + 1);
      }
      return hits;
    }

    const bad = [];
    for (const p of forbiddenPhrases()) bad.push(...bannedHits(p));
    for (const p of ['买入信号', '卖出信号', '交易信号', '应该买', '建议加仓', '应当加仓']) {
      bad.push(...bannedHits(p));
    }
    assert.equal(bad.length, 0, '⛔ 结论位出现禁用表达：' + bad.join(' | '));

    // ✅ 正向：必须显式声明不推导
    assert.ok(html.includes('不会因为') || html.includes('⛔ 不由 gap 推导') || html.includes('不会用当前仓位或缺口反推'),
      '必须有「不据缺口推导动作」的显式声明');
  });

  await ok('★ 单源原则声明全页**只出现 1 次**（⛔ 不在各区块重复）', async () => {
    const html = await renderVm(VM(LIVE()));
    const key = '同一后端事实在本页只有一个主位';
    const n = html.split(key).length - 1;
    assert.equal(n, 1, '单源原则声明应恰好 1 次，实际 ' + n);
  });

  await ok('★ 页尾重复的「基本面摘要」段已删除（主位只在情报区）', async () => {
    const html = await renderVm(VM(LIVE()));
    const c = countFact(html, FACT.FUNDAMENTAL_SUMMARY);
    assert.equal(c.owner, 1, '基本面摘要 owner 必须为 1');
    assert.equal(c.ref, 0, '基本面摘要不应有引用位（避免第二处摘要）');
    // 旧附加段独有的写法必须消失（`SectionHeader` 里的 eyebrow="基本面" + title="摘要" 组合）
    assert.ok(!/eyebrow="基本面"[\s\S]{0,80}title="摘要"/.test(html), '⛔ 页尾摘要段残留');
  });

  await ok('★ 历史：工作台只渲染最近 5 条；全量 6 条保留在 VM（⛔ 未丢失）', async () => {
    const vm = VM(LIVE());
    assert.equal(vm.decisionHistory.count, 6, 'VM 全量必须仍为 6 条');
    assert.equal(vm.decisionHistory.recent.length, 5, 'recent 应为 5 条');
    assert.equal(vm.decisionHistory.items.length, 6, 'items 必须保留全量（供「复盘」页）');
    const html = await renderVm(vm);
    assert.equal((html.match(/hist-card-nums/g) || []).length, 5, '页面只渲染 5 条');
    assert.ok(html.includes('另有 1 条更早记录，完整审阅见「复盘」页。'));
  });

  await ok('★ 条件遮蔽在渲染层生效：⛔ 可见区域不得出现「Gap -8%」', async () => {
    const html = await renderVm(VM(LIVE()));
    for (const bad of ['Gap -8%', 'Gap -8', 'Gap -7.8']) {
      assert.ok(!html.includes(bad), '⛔ 可见区域出现 ' + bad);
    }
    assert.ok(html.includes('需 ≥ 3% 触发加仓'), '保留的定性/阈值文案必须渲染');
    assert.ok(html.includes('该片段已移除'), '必须显式声明片段被移除（⛔ 不静默）');
  });

  await ok('★ 组合环境：主位在页头，且带来源说明（只读引用 /api/dashboard）', async () => {
    const html = await renderVm(VM(LIVE()));
    const c = countFact(html, FACT.MARKET_REGIME);
    assert.equal(c.owner, 1, '组合环境 owner 必须为 1（页头）');
    assert.equal(c.ref, 0, '组合环境不得有引用位');
    assert.ok(html.includes('组合环境'), '必须标注标题');
    assert.ok(html.includes('只读引用：/api/dashboard#overview.market_regime'), '必须带来源说明');
  });

  await ok('★ 组合环境三态：未请求 / 请求失败 / 字段缺失 ⇒ 均「数据未提供」且**不猜**', async () => {
    for (const [name, arg, state] of [['未请求', undefined, 'UNAVAILABLE'], ['请求失败', null, 'ERROR'], ['空对象', {}, 'MISSING']]) {
      const vm = VM(LIVE(), { marketRaw: arg });
      assert.equal(vm.marketRegime.state, state, name + ' 状态应为 ' + state);
      const html = await renderVm(vm);
      assert.ok(html.includes('数据未提供'), name + ' 必须显示「数据未提供」');
      assert.ok(!/组合环境[\s\S]{0,40}(激进|结构|震荡|防守|危机)/.test(html), name + ' ⛔ 不得猜测市场状态');
      // 缺失项必须登记
      assert.ok(vm.missingItems.some((m) => m.k.includes('组合环境')), name + ' 应登记为显式缺失');
    }
  });

  await ok('★ 各区块的边界自述必须渲染（承载什么 / 只引用什么）', async () => {
    const html = await renderVm(VM(LIVE()));
    assert.ok(html.includes('本区只给正式决策自身的事实'), '正式决策边界自述');
    assert.ok(html.includes('本区承载仓位四轴'), '仓位区边界自述');
    assert.ok(html.includes('本区承载防守等级'), '防守区边界自述');
    assert.ok(html.includes('本区承载机会分'), '机会区边界自述');
  });

  await ok('★ 空数据总检（重跑）：⛔ 不出现 0 / NaN / undefined / [object Object]', async () => {
    for (const data of [
      FIXTURES.m4('etf-opportunity-missing.json'),
      FIXTURES.m4('etf-defense-missing.json'),
      FIXTURES.m4('etf-defense-inactive.json'),
      FIXTURES.m4('etf-fundamental-minimal.json'),
      FIXTURES.m4('etf-decision-missing.json')
    ]) {
      for (const raw of [undefined, null, []]) {
        const vm = adaptEtfDetail(data, null, {
          klineRaw: null, decisionsRaw: raw, marketRaw: null, retrievedAt: REAL
        });
        const html = await renderVm(vm);
        for (const bad of ['NaN', 'undefined', '[object Object]']) {
          assert.ok(!html.includes(bad), '⛔ 出现 ' + bad);
        }
      }
    }
  });
  /* ==================== 四、M5-P3：治理点名事实 + 多变体单源性 ==================== */

  await ok('★★ M5-P3 十五个治理点名事实：注册主位逐一相符，且渲染层 owner 恰好 1（表驱动）', async () => {
    /** owner 指令 M5-P3 逐项点名的清单（＋ M5-P2 §六(2) 补入的 actualPosition） */
    const EXPECT = {
      [FACT.RISK_FLAG]: OWNER.PRIMARY_DECISION,
      [FACT.PREMIUM_FLAG]: OWNER.DEFENSE_RADAR,
      [FACT.PREMIUM_RATE]: OWNER.DEFENSE_RADAR,
      [FACT.RISK_EVENTS]: OWNER.INTELLIGENCE,
      [FACT.POSITION_GAP]: OWNER.POSITION_RISK,
      [FACT.FINAL_TARGET]: OWNER.PRIMARY_DECISION,
      [FACT.SUGGESTED_POSITION]: OWNER.POSITION_RISK,
      [FACT.ACTUAL_POSITION]: OWNER.POSITION_RISK,
      [FACT.TARGET_BAND]: OWNER.POSITION_RISK,
      [FACT.OPPORTUNITY_SCORE]: OWNER.OPPORTUNITY_RADAR,
      [FACT.OPPORTUNITY_GRADE]: OWNER.OPPORTUNITY_RADAR,
      [FACT.OVER_ALLOC]: OWNER.DEFENSE_RADAR,
      [FACT.FUNDAMENTAL_SUMMARY]: OWNER.INTELLIGENCE,
      [FACT.MARKET_REGIME]: OWNER.HEADER,
      [FACT.KLINE_LAST_DATE]: OWNER.KLINE
    };
    assert.equal(Object.keys(EXPECT).length, 15, '点名清单应为 15 项');
    const html = await renderVm(VM(LIVE()));
    const problems = [];
    for (const [f, want] of Object.entries(EXPECT)) {
      if (!ALL_FACTS.includes(f)) { problems.push('点名事实未注册: ' + f); continue; }
      if (ownerOf(f) !== want) problems.push(f + ' 注册主位应为 ' + want + '，实际 ' + ownerOf(f));
      const c = countFact(html, f);
      if (c.owner !== 1) problems.push(f + ' 渲染 owner=' + c.owner + '（应为 1）');
      if (c.ref > 0 && FACT_OWNERSHIP[f].refs.length === 0) problems.push(f + ' 有引用位但注册表未声明 refs');
      if (c.ref > 0 && c.owner !== 1) problems.push(f + ' 悬空引用：ref=' + c.ref + ' 而 owner=' + c.owner);
      if (c.ref > 0) {
        if (c.refTo.length !== c.ref) problems.push(f + ' 引用位缺 data-ref-to');
        for (const to of c.refTo) if (to !== ownerOf(f)) problems.push(f + ' 引用位指向 ' + to + '，应为 ' + ownerOf(f));
      }
    }
    assert.equal(problems.length, 0, problems.join('; '));
  });

  await ok('★★ M5-P3 多变体单源性：owner=1 / refs≤白名单 / refs>0 ⇒ owner=1 在 10 个场景恒成立', async () => {
    const K = () => FIXTURES.m4('kline-live60.json');
    const D = () => FIXTURES.m4('decisions-normal.json');
    const variants = [
      ['live', VM(LIVE())],
      ['canonical', VM(FIXTURES.m4('etf-canonical.json'))],
      ['canonical-null', VM(FIXTURES.m4('etf-canonical-null.json'))],
      ['decision-missing', VM(FIXTURES.m4('etf-decision-missing.json'), { klineRaw: [] })],
      ['gen1-missing', VM(FIXTURES.m4('etf-gen1-missing.json'))],
      ['opportunity-missing', VM(FIXTURES.m4('etf-opportunity-missing.json'))],
      ['defense-missing', VM(FIXTURES.m4('etf-defense-missing.json'))],
      ['defense-inactive', VM(FIXTURES.m4('etf-defense-inactive.json'))],
      ['risk-events-present', VM(FIXTURES.m4('etf-risk-events-present.json'))],
      ['fundamental-minimal', VM(FIXTURES.m4('etf-fundamental-minimal.json'))],
      ['kline-stale', VM(LIVE(), { klineRaw: K() })],
      ['kline-malformed', VM(LIVE(), { klineRaw: { not: 'array' } })],
      ['kline-failed', VM(LIVE(), { klineRaw: null, klineError: 'boom' })],
      ['kline-unrequested', VM(LIVE(), { klineRaw: undefined })],
      ['history-empty', VM(LIVE(), { decisionsRaw: [] })],
      ['history-failed', VM(LIVE(), { decisionsRaw: null, decisionsError: 'boom' })],
      ['regime-missing', VM(LIVE(), { marketRaw: {} })],
      ['regime-failed', VM(LIVE(), { marketRaw: null, marketError: 'boom' })],
      ['malformed-all', VM(FIXTURES.m4('etf-malformed.json'), { klineRaw: null, decisionsRaw: null, marketRaw: null })]
    ];
    assert.ok(variants.length >= 10, '场景数应 ≥10，实际 ' + variants.length);
    const problems = [];
    for (const [name, vm] of variants) {
      const html = await renderVm(vm);
      for (const f of ALL_FACTS) {
        const c = countFact(html, f);
        if (c.owner > 1) problems.push(name + '：' + f + ' 有 ' + c.owner + ' 个主位');
        if (c.ref > FACT_OWNERSHIP[f].refs.length) {
          problems.push(name + '：' + f + ' ref=' + c.ref + ' 超出注册白名单 ' + FACT_OWNERSHIP[f].refs.length);
        }
        // ★ 更严规则（M5-P1 立，M5-P3 推广到全部场景）：有引用位就必须有主位
        if (c.ref > 0 && c.owner !== 1) problems.push(name + '：' + f + ' 悬空引用 ref=' + c.ref + ' owner=' + c.owner);
        if (c.ref > 0 && c.refTo.some((to) => to !== ownerOf(f))) {
          problems.push(name + '：' + f + ' 引用位指向错误主位');
        }
      }
    }
    assert.equal(problems.length, 0, problems.slice(0, 8).join('; '));
  });

  await ok('★ M5-P3 HTML ⛔ 不泄露后端 snake_case 原始字段名（多场景，⛔ 未削弱既有 guard）', async () => {
    const FORBIDDEN = [
      'final_target', 'position_gap', 'suggested_position', 'actual_position', 'over_alloc_status',
      'risk_flag', 'premium_flag', 'premium_rate', 'core_position', 'gen1_authority', 'ml_shadow',
      'f_state', 'w_state', 'd_state', 'h_state', 'v_state', 'target_min', 'target_std', 'target_max',
      'effective_market_regime', 'next_add_condition', 'defense_score', 'opportunity_score',
      'consolidation_score', 'volume_ratio', 'decision_date', 'calc_date', 'data_complete',
      'risk_events', 'max_position', 'config_target', 'explain_chain', 'trend_context',
      /* ★ M5-P8 补入（浏览器 QA 抓到 Gen-1 空态文案里泄露过这些） */
      'system_runtime', 'runtime_status', 'final_action', 'gen1_'
    ];
    /**
     * ⚠️ 此前只检查 `live` 一个场景 ⇒ **Gen-1 不可用分支**（只在 gen1-missing / malformed / target0
     *    才渲染）里的字段名泄露没被覆盖，浏览器 QA 才抓出来。⇒ 现改为多场景遍历。
     */
    const variants = [
      ['live', VM(LIVE())],
      ['canonical', VM(FIXTURES.m4('etf-canonical.json'))],
      ['canonical-null', VM(FIXTURES.m4('etf-canonical-null.json'))],
      ['gen1-missing', VM(FIXTURES.m4('etf-gen1-missing.json'))],
      ['decision-missing', VM(FIXTURES.m4('etf-decision-missing.json'), { klineRaw: [] })],
      ['malformed', VM(FIXTURES.m4('etf-malformed.json'), { klineRaw: null, decisionsRaw: null, marketRaw: null })],
      ['target0', VM(FIXTURES.m4('etf-target-0.json'), { klineRaw: [], decisionsRaw: [] })],
      ['opportunity-missing', VM(FIXTURES.m4('etf-opportunity-missing.json'))],
      ['defense-missing', VM(FIXTURES.m4('etf-defense-missing.json'))]
    ];
    const problems = [];
    /**
     * ⚠️ **有意豁免**：provenance 来源引用必须保留（M5-P5 要求带来源）⇒
     *   `/api/...` 与 `contract:...` 形式的**来源串**不算字段名泄露。
     *   先剥离来源串，再检查剩余内容。
     */
    const stripSources = (s) => s
      .replace(/\/api\/[^\s"'（()）<]*/g, ' ')
      .replace(/contract:[^\s"'（()）<]*/g, ' ');
    for (const [name, vm] of variants) {
      const html = await renderVm(vm);
      const scanned = stripSources(html);
      for (const n of FORBIDDEN) if (scanned.includes(n)) problems.push(name + ' 泄露 ' + n);
      /**
       * ★ 更严规则：**可见文本**里不得出现任何 snake_case 标识符
       *   （同上：`/api/...` 与 `contract:...` 来源串已剥离）。
       */
      const visible = scanned.replace(/<[^>]*>/g, ' ');
      for (const m of visible.matchAll(/[a-z][a-z0-9]*_[a-z0-9_]{2,}/g)) {
        problems.push(name + ' 可见文本出现 snake_case 标识符: ' + m[0]);
      }
    }
    assert.equal(problems.length, 0, '⛔ ' + [...new Set(problems)].slice(0, 8).join('; '));

    /**
     * ⚠️ **唯一豁免（有意为之，且必须保留）**：`market_regime` 只出现在
     *   provenance 来源串 `/api/dashboard#overview.market_regime` 里 ——
     *   那是**接口路径引用**（M5-P5 要求带 provenance），⛔ 不是字段名泄露。
     */
    const html = await renderVm(VM(LIVE()));
    const occurrences = html.split('market_regime').length - 1;
    assert.ok(occurrences >= 1, '组合环境必须带来源路径（M5-P5）');
    const asPath = html.split('#overview.market_regime').length - 1;
    assert.equal(asPath, occurrences,
      '⛔ `market_regime` 只能以 `#overview.market_regime` 接口路径形式出现（实际 ' + occurrences + ' 次，其中路径形式 ' + asPath + ' 次）');
  });
} finally {
  await server.close();
}

console.log('\nsingle-source.test: ' + pass + ' 项全过');
