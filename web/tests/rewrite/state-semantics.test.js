/**
 * 数据语义与缺失状态守卫（M5-P4 ＋ M5-P5 ＋ M5-P7）
 * 规范依据：owner 指令 M5-P4 / M5-P5 / M5-P7（2026-10-01）＋ SPEC §9 ＋ M4 既有结论
 *
 * ══════════════════════════════════════════════════════════════════
 * ★ 本套件把三条**已被 owner 明令**的口径变成机器守卫：
 *
 *  【M5-P4】canonical > 显式 legacy fallback > unavailable，且
 *     ⛔ 不得把 null / missing 静默变成 0、空串或历史值；
 *     ⛔ 不得跨 endpoint 猜字段；⛔ 不得用一个字段推导另一个无契约字段。
 *
 *  【M5-P5】`market_regime` 是**组合环境**（只读引用 /api/dashboard#overview.market_regime），
 *     ⛔ **不是**当前 ETF 的交易信号；⛔ 不得由标的字段推导；三态都必须「数据未提供」。
 *
 *  【M5-P7】K 线七态**互不相同**（读取失败 ≠ 未提供 ≠ 字段缺失 ≠ 合法空 ≠ 无时间戳 ≠ 滞后 ≠ 新鲜）；
 *     陈旧时保留历史、显示真实 cutoff；`klineLastDate` 的引用必须始终有主位。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import { createSSRApp } from 'vue';
import { renderToString } from '@vue/server-renderer';
import { adaptEtfDetail } from '../../src/rewrite/adapters/etfDetail.js';
import { FACT, OWNER, ownerOf } from '../../src/rewrite/domain/ownership.js';
import { KLINE_STATUS_LABEL } from '../../src/rewrite/domain/labels.js';
import { sanitizeConditionText } from '../../src/rewrite/domain/condition.js';
import { disambiguateEngineContext } from '../../src/rewrite/domain/chain.js';
import { FIXTURES, assert } from './_fixtures.js';

const REAL = '2026-10-01T00:30:00.000Z';
const LIVE = () => FIXTURES.m4('etf-normal.json');
const K60 = () => FIXTURES.m4('kline-live60.json');
const DEC = () => FIXTURES.m4('decisions-normal.json');
const DASH = () => FIXTURES.liveDashboard();

const VM = (data, opts = {}) => adaptEtfDetail(data, null, {
  klineRaw: K60(), decisionsRaw: DEC(), marketRaw: DASH(), retrievedAt: REAL, ...opts
});

/** 所有「不可用」文案的集合（⛔ 任何一个都不允许等于 0 / ''） */
const UNAVAILABLE_TEXTS = ['字段缺失', '数据未提供', '—', '无时间戳', '读取失败'];

let pass = 0;
async function ok(label, fn) { await fn(); pass++; console.log('[PASS] ' + label); }

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
  optimizeDeps: { noDiscovery: true, include: [] }
});

try {
  const DetailView = (await server.ssrLoadModule('/src/rewrite/components/workbench/DetailView.vue')).default;
  const renderVm = (vm) => renderToString(createSSRApp(DetailView, { vm }));

  /* ==================== M5-P4：优先级与缺失语义 ==================== */

  await ok('★ M5-P4 canonical > legacy fallback > unavailable：通道判定三态正确且**不互相冒充**', () => {
    const canon = VM(FIXTURES.m4('etf-canonical.json')).gen1Detail;
    const legacy = VM(LIVE()).gen1Detail;
    const none = VM(FIXTURES.m4('etf-gen1-missing.json')).gen1Detail;

    assert.equal(canon.channel, 'CANONICAL', 'canonical 契约在场 ⇒ 走 canonical 通道');
    assert.equal(canon.isCanonical, true);
    assert.equal(legacy.channel, 'DECISION_LEGACY', '无 canonical ⇒ 走**显式** legacy 通道');
    assert.equal(legacy.isCanonical, false, '⛔ legacy 不得被标成 canonical');
    assert.equal(none.channel, 'NONE');
    assert.equal(none.available, false, '三级全空 ⇒ 显式不可用（⛔ 不得显示「正常 / 已关闭」）');
    // 三条通道标签互不相同
    const labels = [canon.channelLabel, legacy.channelLabel, none.channelLabel];
    assert.equal(new Set(labels).size, 3, '通道标签必须两两不同：' + JSON.stringify(labels));
  });

  await ok('★ M5-P4 canonical 字段 = null ⇒ MISSING/NULL_IN_CONTRACT，⛔ 不 fallback、⛔ 不当 0', () => {
    const nullish = VM(FIXTURES.m4('etf-canonical-null.json')).gen1Detail;
    const base = VM(FIXTURES.m4('etf-canonical.json')).gen1Detail;

    // 定点突变：stages.effective 由 PROVIDED 变 null
    // ⚠️ 形状取证：这些是 **display 对象**（`{ field:{state,missingReason,provenance}, text, missing, reason }`），
    //    state 在 `.field.state`，⛔ 不是 `x.state`
    assert.equal(base.stages.effective.field.state, 'PROVIDED', '前置：基准 canonical 的 effective 有值');
    const f = nullish.stages.effective;
    assert.equal(f.field.state, 'MISSING', 'null-in-contract ⇒ MISSING');
    assert.equal(f.reason, 'NULL_IN_CONTRACT', '缺失原因必须是 NULL_IN_CONTRACT');
    assert.equal(f.field.missingReason, 'NULL_IN_CONTRACT');
    assert.equal(f.text, '字段缺失', '⛔ 文案必须是「字段缺失」，不得变 0 / 空串');
    assert.ok(!f.text.includes('0'), '⛔ 不得把 null 说成 0');
    assert.ok(String(f.field.provenance.source).startsWith('contract:'), '来源必须仍是 canonical 契约');
    assert.equal(f.field.provenance.fallbackFrom, null, '⛔ 不得记录/使用 legacy fallback 掩盖 null');
    // 同一文档里本来就为 null 的字段也必须显式缺失（而不是 0）
    for (const x of [nullish.signal.probability, nullish.dataHealth.status]) {
      assert.equal(x.field.state, 'MISSING');
      assert.equal(x.reason, 'NULL_IN_CONTRACT');
      assert.ok(UNAVAILABLE_TEXTS.includes(x.text), '⛔ 缺失文案非法: ' + x.text);
      assert.equal(x.field.provenance.fallbackFrom, null, '⛔ 不得 fallback 掩盖 null');
    }
  });

  await ok('★ M5-P4 ⛔ 不得跨 endpoint 偷补：ETF 详情的空字段不因 dashboard 有值而被填上', () => {
    // dashboard 有组合级 market_regime，但标的自身缺失字段仍必须保持缺失
    const withDash = VM(LIVE(), { marketRaw: DASH() });
    const noDash = VM(LIVE(), { marketRaw: undefined });
    const keysWith = withDash.missingItems.map((m) => m.k).sort();
    const keysWithout = noDash.missingItems.map((m) => m.k).sort();
    // 除「组合环境」外，其余缺失项集合必须一致（⇒ 没有用 dashboard 去补标的字段）
    const a = keysWith.filter((k) => !k.includes('组合环境'));
    const b = keysWithout.filter((k) => !k.includes('组合环境'));
    assert.deepEqual(a, b, '⛔ 组合环境的数据不得用于填补标的其它缺失字段');
    assert.ok(keysWithout.some((k) => k.includes('组合环境')), '缺 dashboard ⇒ 组合环境必须登记为缺失');
  });

  await ok('★ M5-P4 NullSafe：多场景无 NaN / undefined / [object Object] / 裸 null 节点', async () => {
    const cases = [
      VM(LIVE()),
      VM(FIXTURES.m4('etf-canonical.json')),
      VM(FIXTURES.m4('etf-canonical-null.json')),
      VM(FIXTURES.m4('etf-decision-missing.json')),
      VM(FIXTURES.m4('etf-gen1-missing.json')),
      VM(FIXTURES.m4('etf-malformed.json'), { klineRaw: null, decisionsRaw: null, marketRaw: null }),
      VM(FIXTURES.m4('etf-opportunity-missing.json')),
      VM(FIXTURES.m4('etf-defense-missing.json')),
      VM(FIXTURES.m4('etf-defense-inactive.json')),
      VM(FIXTURES.m4('etf-fundamental-minimal.json')),
      VM(FIXTURES.m4('etf-risk-events-present.json')),
      VM(FIXTURES.m4('etf-target-0.json')),
      VM(FIXTURES.m4('etf-stale.json'))
    ];
    for (const vm of cases) {
      const html = await renderVm(vm);
      for (const bad of ['NaN', 'undefined', '[object Object]']) {
        assert.ok(!html.includes(bad), '⛔ 渲染结果出现 ' + bad);
      }
      const bare = html.match(/>(null|undefined|NaN)</g) || [];
      assert.equal(bare.length, 0, '⛔ 出现裸空值节点: ' + JSON.stringify(bare.slice(0, 3)));
    }
  });

  /* ==================== M5-P5：market_regime ==================== */

  await ok('★ M5-P5 组合环境三态：正常 / 字段缺失 / 请求失败 —— 后两者都「数据未提供」且不猜', () => {
    const normal = VM(LIVE()).marketRegime;
    assert.equal(normal.state, 'PROVIDED');
    assert.equal(normal.title, '组合环境');
    assert.ok(normal.regimeText && normal.regimeText !== '数据未提供', '正常态必须有可读状态文案');
    assert.ok(normal.provenance && String(normal.provenance.source).includes('/api/dashboard#overview.market_regime'),
      '必须保留 provenance');
    assert.ok(normal.freshness && normal.freshness.level, '必须保留 freshness');

    const missing = VM(LIVE(), { marketRaw: {} }).marketRegime;
    assert.equal(missing.state, 'MISSING');
    assert.equal(missing.regimeText, '数据未提供');
    assert.ok(missing.unavailableNote.includes('字段缺失'), '缺失原因必须说明是「字段缺失」');

    const failed = VM(LIVE(), { marketRaw: null, marketError: 'boom' }).marketRegime;
    assert.equal(failed.state, 'ERROR');
    assert.equal(failed.regimeText, '数据未提供');
    assert.ok(failed.unavailableNote.includes('读取失败'), '失败原因必须说明是「读取失败」');

    const notRequested = VM(LIVE(), { marketRaw: undefined }).marketRegime;
    assert.equal(notRequested.state, 'UNAVAILABLE');
    assert.equal(notRequested.regimeText, '数据未提供');
    // 三态的 unavailableNote 两两不同（⛔ 不把三种原因说成一句话）
    const notes = [missing.unavailableNote, failed.unavailableNote, notRequested.unavailableNote];
    assert.equal(new Set(notes).size, 3, '三种不可用原因的说明必须两两不同');
  });

  await ok('★★ M5-P5 ⛔ 不消费**标的侧** regime：标的自己有 effective_market_regime，但页头必须只用组合级', async () => {
    /**
     * ★ 实测取证（这是本项的**真实风险源**）：
     *   标的响应里**确实有**自己的市场状态 `decision.effective_market_regime = "crisis"`，
     *   而组合级 `overview.market_regime = "defensive"` —— 两者**实测不同**。
     *   ⇒ 若前端误用标的侧字段，页头会显示「系统性风险」（crisis）而不是「防守」（defensive）。
     */
    const raw = LIVE();
    assert.equal(raw.decision.effective_market_regime, 'crisis', '前置：标的侧 regime 实测为 crisis');
    const dashLevel = VM(raw).marketRegime;
    assert.equal(dashLevel.regimeRaw, 'defensive', '组合环境必须取组合级值 defensive');
    assert.equal(dashLevel.regimeText, '防守');
    assert.notEqual(dashLevel.regimeText, '系统性风险', '⛔ 不得把标的侧 crisis 当成组合环境');

    // ① 改标的侧 regime ⇒ 组合环境**不变**（⇒ 确实没读到标的字段）
    const mutated = JSON.parse(JSON.stringify(raw));
    mutated.decision.effective_market_regime = 'aggressive';
    assert.equal(VM(mutated).marketRegime.regimeRaw, 'defensive',
      '⛔ 改标的侧 regime 竟改变了组合环境 ⇒ 存在跨源推导');

    // ② 改组合级 ⇒ 组合环境随之变化（正证）
    const dash = JSON.parse(JSON.stringify(FIXTURES.liveDashboard()));
    dash.overview.market_regime = 'aggressive';
    assert.equal(VM(raw, { marketRaw: dash }).marketRegime.regimeRaw, 'aggressive',
      '组合级变化必须反映到组合环境');

    // ③ 标的侧 regime **不得**出现在任何 UI 组件里（源码级）
    const files = [];
    (function walk(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(vue|js)$/.test(e.name)) files.push(p);
      }
    })(path.join(process.cwd(), 'src', 'rewrite', 'components'));
    const leaks = [];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      if (/effectiveMarketRegime|effective_market_regime/.test(src)) leaks.push(path.basename(f));
    }
    assert.equal(leaks.length, 0, '⛔ 组件层不得渲染标的侧 effective_market_regime: ' + leaks.join(', '));
  });

  await ok('★ M5-P5 组合环境必须标为「组合环境」，⛔ 不得呈现为当前 ETF 的交易信号', async () => {
    const html = await renderVm(VM(LIVE()));
    assert.ok(html.includes('组合环境'), '必须标注「组合环境」');
    assert.ok(html.includes('只读引用：/api/dashboard#overview.market_regime'), '必须带来源说明');
    assert.ok(html.includes('组合级事实'), '必须声明这是组合级事实');
    // 组合环境所在区块不得出现动作/买入类措辞
    const i = html.indexOf('data-fact="' + FACT.MARKET_REGIME + '"');
    const seg = html.slice(Math.max(0, i - 400), i + 600);
    for (const p of ['买入信号', '应该加仓', '应该卖出', '立即交易']) {
      assert.ok(!seg.includes(p), '⛔ 组合环境附近出现交易措辞 ' + p);
    }
  });

  /* ==================== M6 / UI-001：两个「市场环境」消歧（owner 裁定 = RESOLVED） ==================== */

  await ok('★★ M6/UI-001：链上「决策时点市场环境」与页头「组合环境」必须可区分（⛔ 不删任一事实）', async () => {
    const vm = VM(LIVE());
    const s0 = vm.decision.chain.steps[0];

    /* ① 链上：前导标签已消歧，定性值逐字保留，原文未改（审计） */
    assert.equal(s0.conditionRaw, '市场环境 系统性风险', '前置：后端原文必须逐字保留在 conditionRaw');
    assert.ok(s0.conditionDisplay.startsWith('决策时点市场环境'), '链上必须显示「决策时点市场环境」，实际 ' + s0.conditionDisplay);
    assert.ok(!/^市场环境/.test(s0.conditionDisplay), '⛔ 链上不得再以裸「市场环境」开头');
    assert.ok(s0.conditionDisplay.includes('系统性风险'), '⛔ 定性值必须保留（不删除事实）');

    /* ② 页头：标签与取值均不变，且仍来自**组合级** */
    assert.equal(vm.marketRegime.title, '组合环境');
    assert.equal(vm.marketRegime.regimeRaw, 'defensive');
    assert.equal(vm.marketRegime.regimeText, '防守');

    /* ③ 两个事实**同时在页面上**，且文案可区分（⛔ 不合并、不互覆盖） */
    const html = await renderVm(vm);
    assert.ok(html.includes('组合环境'), '组合环境必须存在');
    assert.ok(html.includes('决策时点市场环境'), '决策时点市场环境必须存在');
    assert.ok(html.includes('防守'), '组合级取值必须保留');
    assert.ok(html.includes('系统性风险'), '引擎决策时点取值必须保留');
    assert.notEqual(vm.marketRegime.regimeText, '系统性风险', '⛔ 组合环境不得被引擎侧取值覆盖');
    assert.ok(!vm.marketRegime.regimeText.includes('系统性'), '⛔ 组合环境不得显示引擎侧语义');

    /* ④ 消歧是**纯展示**：其它链步骤文案逐字不变 */
    assert.ok(s0.conditionRaw !== s0.conditionDisplay, '链上确实发生了标签消歧');
    const others = vm.decision.chain.steps.slice(1).map((s) => s.conditionDisplay).filter(Boolean);
    for (const t of others) assert.ok(!t.startsWith('决策时点市场环境'), '⛔ 消歧只作用于引擎上下文那一步：' + t);
  });

  await ok('★ M6/UI-001 纯函数：只改写**前导**「市场环境」，其余文案逐字返回', () => {
    assert.equal(disambiguateEngineContext('市场环境 系统性风险'), '决策时点市场环境 · 系统性风险');
    assert.equal(disambiguateEngineContext('市场环境·系统性风险'), '决策时点市场环境 · 系统性风险');
    assert.equal(disambiguateEngineContext('市场环境'), '决策时点市场环境');
    /* ⛔ 非前导出现的地方不得改写 */
    assert.equal(disambiguateEngineContext('周线 趋势破坏'), '周线 趋势破坏');
    assert.equal(disambiguateEngineContext('组合环境 防守'), '组合环境 防守');
    assert.equal(disambiguateEngineContext('市场环境变化 → 防守'), '决策时点市场环境 · 变化 → 防守');
    assert.equal(disambiguateEngineContext(null), null);
    assert.equal(disambiguateEngineContext(undefined), undefined);
  });

  /* ==================== M5-P7：K 线 ==================== */

  await ok('★★ M5-P7 K 线七态标签**两两不同**（⛔ 不得再塌陷）', () => {
    const labels = {
      fresh: KLINE_STATUS_LABEL.FRESH,
      stale: KLINE_STATUS_LABEL.STALE,
      missingTs: KLINE_STATUS_LABEL.MISSING,
      unavailable: KLINE_STATUS_LABEL.UNAVAILABLE,
      error: KLINE_STATUS_LABEL.ERROR,
      fieldMissing: KLINE_STATUS_LABEL.FIELD_MISSING,
      empty: KLINE_STATUS_LABEL.EMPTY
    };
    const vals = Object.values(labels);
    assert.equal(new Set(vals).size, vals.length, '七态标签必须两两不同：' + JSON.stringify(labels));
  });

  await ok('★★ M5-P7 状态矩阵：请求失败 ⇒ 读取失败；畸形载荷 ⇒ 字段缺失；合法空 ⇒ 0 根；三者互不相同', () => {
    const failed = VM(LIVE(), { klineRaw: null, klineError: 'boom' }).kline;
    assert.equal(failed.state, 'ERROR');
    assert.equal(failed.statusLabel, KLINE_STATUS_LABEL.ERROR);

    const malformed = VM(LIVE(), { klineRaw: { not: 'an array' } }).kline;
    assert.equal(malformed.state, 'MISSING');
    assert.equal(malformed.statusLabel, KLINE_STATUS_LABEL.FIELD_MISSING, '畸形载荷 ⇒ 字段缺失');
    assert.ok(!malformed.available);

    const empty = VM(LIVE(), { klineRaw: [] }).kline;
    assert.equal(empty.statusLabel, KLINE_STATUS_LABEL.EMPTY, '合法空数组 ⇒ 0 根（不是缺失、不是失败）');
    assert.equal(empty.state, 'PROVIDED');

    const unreq = VM(LIVE(), { klineRaw: undefined }).kline;
    assert.equal(unreq.state, 'UNAVAILABLE');
    assert.equal(unreq.statusLabel, KLINE_STATUS_LABEL.UNAVAILABLE);

    // 四者标签互不相同（含 stale）
    const four = [failed.statusLabel, malformed.statusLabel, empty.statusLabel, unreq.statusLabel];
    assert.equal(new Set(four).size, 4, '⛔ 失败/缺失/空/未提供必须四态可分：' + JSON.stringify(four));
  });

  await ok('★★ M5-P7 陈旧：保留历史数据 + 真实 cutoff + 独立新鲜度，⛔ 不插值不假装最新', async () => {
    const vm = VM(LIVE(), { klineRaw: K60(), klineError: null });
    const k = vm.kline;
    assert.ok(k.isSeverelyStale, '前置：实测 K 线严重滞后');
    assert.equal(k.lastBarDate, k.lastBarDateText, 'cutoff 必须来自真实数据');
    assert.ok(k.lastBarDate.startsWith('2024-'), 'cutoff 必须是数据里的日期（实测 2024-08-27），实际 ' + k.lastBarDate);
    const html = await renderVm(vm);
    assert.ok(html.includes('数据截至'), '必须显示真实 cutoff');
    assert.ok(html.includes('mkline-svg'), '★ 陈旧时**图表必须保留**（⛔ 不隐藏历史）');
    assert.ok(html.includes('历史数据照常保留'), '必须声明不清空、不插值');
    assert.ok(html.includes('决策新鲜度（独立）'), '决策新鲜度与 K 线新鲜度必须分开显示');
    assert.ok(html.includes(k.lastBarDate), '页面必须出现真实 cutoff 日期');
  });

  await ok('★ M5-P7 klineLastDate 引用**必有主位**（陈旧 / 畸形 / 失败三种情形都不许悬空）', async () => {
    const variants = [
      ['正常', { klineRaw: K60() }],
      ['畸形', { klineRaw: { x: 1 } }],
      ['空', { klineRaw: [] }],
      ['失败', { klineRaw: null, klineError: 'boom' }],
      ['未请求', { klineRaw: undefined }]
    ];
    for (const [name, opts] of variants) {
      const html = await renderVm(VM(LIVE(), opts));
      const owners = (html.match(new RegExp('data-fact="' + FACT.KLINE_LAST_DATE + '"\\s+data-role="owner"', 'g')) || []).length;
      const refs = (html.match(new RegExp('data-fact="' + FACT.KLINE_LAST_DATE + '"\\s+data-role="ref"', 'g')) || []).length;
      assert.equal(owners, 1, name + '：klineLastDate 主位必须恰好 1，实际 ' + owners);
      assert.ok(!(refs > 0 && owners !== 1), name + '：出现悬空引用');
      assert.equal(ownerOf(FACT.KLINE_LAST_DATE), OWNER.KLINE);
    }
  });

  /* ==================== M5-P6：DS-006（与状态语义同批回归） ==================== */

  await ok('★ M5-P6 DS-006：冲突 Gap 定量被移除、其余原文逐字保留、原文可审计', async () => {
    const raw = LIVE().decision.next_add_condition;
    const r = sanitizeConditionText(raw);
    assert.ok(!/Gap/i.test(r.text), '⛔ 展示文案不得残留 Gap');
    assert.ok(r.text.includes('需 ≥ 3% 触发加仓'), '非冲突阈值必须保留');
    assert.deepEqual([...r.removed], ['Gap -8%'], '被移除片段必须可审计');
    const vm = VM(LIVE());
    // 原文必须仍在 VM 里（可审计），但不得进可见区
    const rawKept = JSON.stringify(vm).includes('Gap -8%');
    assert.ok(rawKept, '原始文案必须保留在 VM（供审计）');
    const html = await renderVm(vm);
    assert.ok(!html.includes('Gap -8%'), '⛔ 可见区域不得出现 Gap -8%');
    assert.ok(html.includes('该片段已移除'), '必须显式声明片段已移除（⛔ 不静默）');
  });
} finally {
  await server.close();
}

console.log('\nstate-semantics.test: ' + pass + ' 项全过');
