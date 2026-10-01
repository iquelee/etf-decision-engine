/**
 * 语义边界守卫（M5-P2 · 前端 IA 与语义一致性最终审查）
 * 规范依据：owner 指令 M5-P2 §六（2026-10-01）＋ SPEC §4.2 ＋ domain/ownership.js
 *
 * ══════════════════════════════════════════════════════════════════
 * ★ 本套件回答的问题（M5-P1 解决了「出现几次」，M5-P2 解决「每段该承载什么」）：
 *   ① 每一段的**语义优先级**是否真的挂在 class 上（⛔ 不是数字档位）；
 *   ② 每个事实是否**只出现在允许它的区块**（owner 或注册表白名单 refs）；
 *   ③ §六 点名的**越界**是否真的不存在
 *      （正式决策不得携带机会/防守结论；机会不得推导动作；防守不得升格为卖出信号）；
 *   ④ 空数组/缺失的**文案纪律**（`[]` ⇒ 「没有返回事件数据」，⛔ 不是「没有风险」）。
 *
 * ★ 判定方式：SSR 真渲染 → 按 `<section class="section …">` 的**出现位置**切片
 *   （⚠️ ⛔ 不可用 `indexOf(class)` 定位：同 class 的多个区块会全部指向第一段）。
 *
 * ⛔ 本套件不新增任何业务信息、不改评分/动作语义。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import { createSSRApp } from 'vue';
import { renderToString } from '@vue/server-renderer';
import { adaptEtfDetail } from '../../src/rewrite/adapters/etfDetail.js';
import { FACT, OWNER, isAllowedAt, ownerOf, forbiddenPhrases } from '../../src/rewrite/domain/ownership.js';
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
async function ok(label, fn) { await fn(); pass++; console.log('[PASS] ' + label); }

/* ==================== 区块计划（位置 → 语义优先级 class → 归属） ==================== */

/**
 * ★ DOM 顺序 = **真实认知顺序**（owner D-M5-4：⛔ 不为档位编号调整 DOM）。
 *   `owner` 为 null ⇒ 该段在注册表中**不拥有任何事实**（应零 `data-fact`）。
 */
const SECTIONS = [
  { cls: 'primary-decision', owner: OWNER.PRIMARY_DECISION },
  { cls: 'prio-position', owner: OWNER.POSITION_RISK },
  { cls: 'prio-advisory', owner: OWNER.OPPORTUNITY_RADAR },
  { cls: 'prio-risk', owner: OWNER.DEFENSE_RADAR },
  { cls: 'gen1-advisory', owner: null },   // Gen-1 · Legacy Advisory（降权）
  { cls: 'prio-evidence', owner: OWNER.KLINE },
  { cls: 'prio-evidence', owner: null },   // 结构识别（FieldValue，非 Fact）
  { cls: 'prio-evidence', owner: OWNER.INTELLIGENCE },
  { cls: 'prio-history', owner: OWNER.DECISION_HISTORY },
  { cls: 'prio-evidence', owner: null }    // 来源与数据质量
];

/** 按**出现位置**切片（⚠️ 同 class 多段必须靠 index 切片，⛔ 不能 indexOf） */
function sliceSections(html) {
  const re = /<section class="section ([^"]*)"/g;
  const marks = [];
  let m;
  while ((m = re.exec(html))) marks.push({ i: m.index, cls: m[1] });
  return {
    header: html.slice(0, marks.length ? marks[0].i : html.length),
    list: marks.map((mk, n) => ({
      cls: mk.cls,
      html: html.slice(mk.i, n + 1 < marks.length ? marks[n + 1].i : html.length)
    }))
  };
}

/** 取一段内所有 `data-fact` 出现（含角色） */
function factsIn(seg) {
  return [...seg.matchAll(/data-fact="([^"]+)"\s+data-role="(owner|ref)"/g)]
    .map((x) => ({ fact: x[1], role: x[2] }));
}

/** 禁用语判定：出现在**禁令说明句**或引号引用里是合法的 */
const PROHIBIT = /(⛔|不得|禁止|不会|不是|不能|无需|避免)/;
function bannedHits(text, phrase) {
  const hits = [];
  let i = text.indexOf(phrase);
  while (i >= 0) {
    const before = text.slice(Math.max(0, i - 40), i);
    if (!PROHIBIT.test(before) && !/[「“"]\s*$/.test(before)) hits.push(phrase);
    i = text.indexOf(phrase, i + 1);
  }
  return hits;
}

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
  optimizeDeps: { noDiscovery: true, include: [] }
});

try {
  const DetailView = (await server.ssrLoadModule('/src/rewrite/components/workbench/DetailView.vue')).default;
  const renderVm = (vm) => renderToString(createSSRApp(DetailView, { vm }));

  /* ---------- ① 区块序列 + 语义优先级 class ---------- */

  await ok('① 十段区块的语义优先级 class 与顺序**精确匹配**（⛔ 无数字档位残留）', async () => {
    const html = await renderVm(VM(LIVE()));
    const { list, header } = sliceSections(html);
    assert.equal(list.length, SECTIONS.length,
      '段落数应为 ' + SECTIONS.length + '，实际 ' + list.length + '（若新增/删除区块，请同步本表）');
    list.forEach((s, i) => {
      assert.equal(s.cls, SECTIONS[i].cls, '第 ' + i + ' 段 class 应为 ' + SECTIONS[i].cls + '，实际 ' + s.cls);
    });
    // ⛔ 旧数字档位命名（D-M5-4 已废止）不得回流
    for (const bad of ['rank-defense', 'rank-advisory', 'rank-evidence', 'rank-history', 'rank-position', 'rank-risk']) {
      assert.ok(!html.includes(bad), '⛔ 旧数字档位 class 残留: ' + bad);
    }
    // 语义优先级类必须真的挂上
    for (const need of ['prio-position', 'prio-risk', 'prio-advisory', 'prio-evidence', 'prio-history']) {
      assert.ok(html.includes(need), '缺语义优先级 class: ' + need);
    }
    assert.ok(header.includes('data-fact="' + FACT.MARKET_REGIME + '"'), '页头必须是组合环境的主位');
  });

  /* ---------- ② 每段只承载「允许它承载的事实」 ---------- */

  await ok('② 每个事实**只出现在允许它的区块**（owner 或注册表白名单 refs）', async () => {
    const html = await renderVm(VM(LIVE()));
    const { list } = sliceSections(html);
    const problems = [];
    list.forEach((s, i) => {
      const owner = SECTIONS[i].owner;
      for (const f of factsIn(s.html)) {
        if (!owner) { problems.push('第 ' + i + ' 段(' + s.cls + ')本不该有事实，却出现 ' + f.fact + ':' + f.role); continue; }
        if (!isAllowedAt(f.fact, owner)) {
          problems.push('第 ' + i + ' 段(' + owner + ') 出现不允许的事实 ' + f.fact + ':' + f.role);
        }
        // 角色必须与注册表一致：owner 角色 ⇒ 该段就是 owner；ref 角色 ⇒ 该段在 refs 白名单里
        const real = ownerOf(f.fact);
        if (f.role === 'owner' && real !== owner) problems.push(f.fact + ' 在第 ' + i + ' 段被标为 owner，但注册主位是 ' + real);
        if (f.role === 'ref' && !(owner !== real)) problems.push(f.fact + ' 在它的主位区却被标为 ref');
      }
    });
    // 页头只允许 组合环境（owner）+ K 线时点（ref）
    const { header } = sliceSections(html);
    for (const f of factsIn(header)) {
      if (!isAllowedAt(f.fact, OWNER.HEADER)) problems.push('页头出现不允许的事实 ' + f.fact);
    }
    assert.equal(problems.length, 0, problems.join('; '));
  });

  /* ---------- ③ §六 逐段边界 ---------- */

  await ok('★ §六(1) 正式决策区：⛔ 不携带机会/防守/建议仓位/溢价等其它主位事实', async () => {
    const html = await renderVm(VM(LIVE()));
    const seg = sliceSections(html).list[0].html;
    const banned = [
      FACT.OPPORTUNITY_SCORE, FACT.OPPORTUNITY_GRADE, FACT.ADD_ELIGIBILITY, FACT.NEXT_ADD_CONDITION,
      FACT.COOLDOWN, FACT.DEFENSE_STATE, FACT.SUGGESTED_POSITION, FACT.ACTUAL_POSITION,
      FACT.OVER_ALLOC, FACT.PREMIUM_FLAG, FACT.PREMIUM_RATE, FACT.FUNDAMENTAL_SUMMARY, FACT.HISTORY
    ];
    const present = factsIn(seg).map((x) => x.fact);
    for (const b of banned) assert.ok(!present.includes(b), '⛔ 正式决策区不得出现 ' + b);
    // 它应当只承载自己能承载的四项 + 两个引用位
    for (const need of [FACT.ACTION, FACT.FINAL_TARGET, FACT.RISK_FLAG, FACT.SCORES, FACT.CHAIN]) {
      assert.ok(present.includes(need), '正式决策区应承载 ' + need);
    }
    // ⛔ 不得由缺口推出动作
    for (const p of ['应该加仓', '建议加仓', '买入信号', '卖出信号']) {
      assert.equal(bannedHits(seg, p).length, 0, '⛔ 正式决策区结论位出现 ' + p);
    }
  });

  await ok('★ §六(2) 仓位与风险：五项仓位主位齐备，风险族只作引用', async () => {
    const html = await renderVm(VM(LIVE()));
    const seg = sliceSections(html).list[1].html;
    const own = factsIn(seg).filter((x) => x.role === 'owner').map((x) => x.fact);
    for (const need of [FACT.ACTUAL_POSITION, FACT.SUGGESTED_POSITION,
      FACT.TARGET_BAND, FACT.MAX_POSITION, FACT.POSITION_GAP]) {
      assert.ok(own.includes(need), '仓位区应是 ' + need + ' 的主位');
    }
    /**
     * ★ **IA-001 = RESOLVED**（M6 最终人工裁定，2026-10-01）：
     *   owner 指令 §六(1) 与 §六(2) 曾把 `finalTarget` **同时**列为两处「主位」（互相矛盾）。
     *   正式裁定：«`finalTarget` 的唯一视觉主位归「正式决策」» ⇒ **保持当前实现，不改变 owner**。
     *     · 「正式决策」= owner / primary；
     *     · 「仓位与风险」= **reference only**，必须保留引用标记，⛔ 不得形成第二个主位；
     *     · `actualPosition` / `suggestedPosition` / `targetBand` / `maxPosition` / `positionGap`
     *       继续由「仓位与风险」承担主位。
     *   本测试即该裁定的机器守卫（owner 唯一 + 引用位带标记 + 五项仓位主位齐备）。
     */
    assert.equal(ownerOf(FACT.FINAL_TARGET), OWNER.PRIMARY_DECISION, 'finalTarget 唯一主位在「正式决策」（IA-001 RESOLVED）');
    assert.ok(factsIn(seg).some((x) => x.fact === FACT.FINAL_TARGET && x.role === 'ref'),
      'finalTarget 在仓位区必须是**带标记的引用位**（⛔ 不得形成第二主位）');
    assert.ok(seg.includes('引用'), '仓位区的 finalTarget 引用位必须有可见「引用」标记');
    const refs = factsIn(seg).filter((x) => x.role === 'ref').map((x) => x.fact);
    assert.ok(refs.includes(FACT.RISK_FLAG), '风险旗标在本区应只作引用位');
    for (const banned of [FACT.PREMIUM_FLAG, FACT.PREMIUM_RATE, FACT.OVER_ALLOC, FACT.RISK_EVENTS]) {
      assert.ok(!factsIn(seg).some((x) => x.fact === banned), '⛔ 仓位区不得出现 ' + banned + '（各有主位）');
    }
  });

  await ok('★ §六(3) 机会区：五项主位齐备，⛔ 不写「买入信号 / 应该加仓」', async () => {
    const html = await renderVm(VM(LIVE()));
    const seg = sliceSections(html).list[2].html;
    const own = factsIn(seg).filter((x) => x.role === 'owner').map((x) => x.fact);
    for (const need of [FACT.OPPORTUNITY_SCORE, FACT.OPPORTUNITY_GRADE, FACT.ADD_ELIGIBILITY,
      FACT.NEXT_ADD_CONDITION, FACT.COOLDOWN]) {
      assert.ok(own.includes(need), '机会区应是 ' + need + ' 的主位');
    }
    for (const p of ['买入信号', '交易信号', '应该加仓', '建议加仓', '应当加仓', '可以加仓', '应该买']) {
      assert.equal(bannedHits(seg, p).length, 0, '⛔ 机会区结论位出现 ' + p);
    }
    assert.ok(/不会因为|不由 gap 推导|不会用当前仓位或缺口反推/.test(seg), '机会区必须显式声明不推导动作');
  });

  await ok('★ §六(4) 防守区：六项主位齐备，⛔ 不推导出新的交易动作', async () => {
    const html = await renderVm(VM(LIVE()));
    const seg = sliceSections(html).list[3].html;
    const own = factsIn(seg).filter((x) => x.role === 'owner').map((x) => x.fact);
    for (const need of [FACT.DEFENSE_STATE, FACT.OVER_ALLOC, FACT.PREMIUM_FLAG, FACT.PREMIUM_RATE]) {
      assert.ok(own.includes(need), '防守区应是 ' + need + ' 的主位');
    }
    assert.ok(factsIn(seg).some((x) => x.fact === FACT.RISK_EVENTS && x.role === 'ref'), '风险事件在本区只作引用位');
    for (const p of ['应该卖出', '建议卖出', '清仓信号', '立即交易', '下一步操作']) {
      assert.equal(bannedHits(seg, p).length, 0, '⛔ 防守区结论位出现 ' + p);
    }
  });

  await ok('★ §六(5) 情报区：基本面 + 风险事件双主位；`[]` 只能说「没有返回事件数据」', async () => {
    const html = await renderVm(VM(LIVE()));
    const seg = sliceSections(html).list[7].html;
    const own = factsIn(seg).filter((x) => x.role === 'owner').map((x) => x.fact);
    assert.ok(own.includes(FACT.FUNDAMENTAL_SUMMARY), '基本面摘要主位在情报区');
    assert.ok(own.includes(FACT.RISK_EVENTS), '风险事件主位在情报区');
    // 空数组纪律（LIVE 实测 risk_events 为空）
    assert.ok(seg.includes('当前没有返回风险事件数据。'), '空数组必须说「没有返回风险事件数据」');
    assert.ok(seg.includes('这不等于「没有风险」'), '必须显式声明 ⛔ 不等于「没有风险」');
    // 「没有风险」只能出现在禁令说明句里
    assert.equal(bannedHits(seg, '没有风险').length, 0, '⛔ 不得把 [] 说成「没有风险」');
  });

  await ok('★ §六(5) 风险事件**存在**时：主位仍在情报区，且防守区只给条数引用', async () => {
    const html = await renderVm(VM(FIXTURES.m4('etf-risk-events-present.json')));
    const { list } = sliceSections(html);
    const intel = list[7].html;
    const def = list[3].html;
    assert.ok(intel.includes('当前没有返回风险事件数据。') === false, '有事件时不应再显示空文案');
    const intelOwn = factsIn(intel).filter((x) => x.fact === FACT.RISK_EVENTS && x.role === 'owner');
    assert.equal(intelOwn.length, 1, '风险事件主位应恰好 1 个（情报区）');
    assert.ok(!factsIn(def).some((x) => x.fact === FACT.RISK_EVENTS && x.role === 'owner'), '⛔ 防守区不得成为风险事件第二主位');
    assert.ok(def.includes('引用'), '防守区的风险事件必须是带「引用」标记的引用位');
  });

  await ok('★ §六(6) 历史区：只给最近变化，完整审阅指向「复盘」页', async () => {
    const html = await renderVm(VM(LIVE()));
    const seg = sliceSections(html).list[8].html;
    const own = factsIn(seg).filter((x) => x.role === 'owner').map((x) => x.fact);
    assert.deepEqual(own, [FACT.HISTORY], '历史区应只拥有 decisionHistory');
    assert.equal((html.match(/hist-card-nums/g) || []).length, 5, '工作台只渲染最近 5 条');
    assert.ok(html.includes('完整审阅见「复盘」页'), '必须显式指向「复盘」页');
  });

  /* ---------- ④ 全页禁令总检 ---------- */

  await ok('④ 全页禁用语（注册表 forbid ∪ 交易暗示）在**结论位**为零', async () => {
    const html = await renderVm(VM(LIVE()));
    const text = html.replace(/<[^>]*>/g, ' ');
    const bad = [];
    for (const p of forbiddenPhrases()) bad.push(...bannedHits(text, p));
    for (const p of ['买入信号', '卖出信号', '交易信号', '应该买', '立即交易', '下一步操作', '建议加仓', '应当加仓']) {
      bad.push(...bannedHits(text, p));
    }
    assert.equal(bad.length, 0, '⛔ 结论位出现禁用表达: ' + [...new Set(bad)].join(' | '));
  });

  /* ---------- ⑤ 模板注释纪律（FE-DEF-005 教训，M5-P8 再次踩到） ---------- */

  await ok('⑤ ★ 模板 HTML 注释 ⛔ 不得包含会被守卫命中的字面量（注释会进 HTML）', async () => {
    /**
     * ⚠️ 为什么必须静态检查：Vue 的 **dev/SSR 编译会保留模板注释** ⇒ 注释文字进 HTML。
     *   M5-P8 期间，一条解释性注释里写了「对象字符串化后的字面量」，
     *   结果**注释本身**触发了「HTML 不得出现 [object Object]」守卫（自伤）。
     *   同类还有：后端 snake_case 字段名（FE-DEF-005）。
     */
    const REWRITE = path.join(process.cwd(), 'src', 'rewrite');
    const files = [];
    (function walk(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.vue')) files.push(p);
      }
    })(REWRITE);
    assert.ok(files.length >= 10, '应扫描到 ≥10 个 .vue，实际 ' + files.length);

    const BAD_LITERALS = ['[object Object]', 'NaN', 'undefined'];
    const problems = [];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      const tpl = src.match(/<template>([\s\S]*)<\/template>/);
      if (!tpl) continue;
      const comments = tpl[1].match(/<!--[\s\S]*?-->/g) || [];
      for (const c of comments) {
        for (const bad of BAD_LITERALS) {
          if (c.includes(bad)) problems.push(path.relative(REWRITE, f) + ' 模板注释含「' + bad + '」');
        }
        for (const m of c.matchAll(/\b[a-z][a-z0-9]*_[a-z0-9_]{2,}\b/g)) {
          problems.push(path.relative(REWRITE, f) + ' 模板注释含后端字段名「' + m[0] + '」');
        }
      }
    }
    assert.equal(problems.length, 0, '⛔ ' + problems.slice(0, 6).join('; '));
  });
} finally {
  await server.close();
}

console.log('\nsemantic-boundary.test: ' + pass + ' 项全过');
