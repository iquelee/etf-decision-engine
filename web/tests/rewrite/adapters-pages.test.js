/**
 * 页面级适配器测试（SPEC §2 / §4.2 / 附录 A）
 *
 * 覆盖首轮审计发现的契约断裂修复：
 *   #1 `three_questions.market_regime` → 改读 `overview.market_regime`（枚举）+ market_status 展示兜底
 *   #4 隐杠杆字段不存在 ⇒ 不再虚构区块
 *   #5 `cards[].gen1` 不存在 ⇒ 显式 UNAVAILABLE，⛔ 不用 ml_shadow 冒充
 *   #8 `over_all_status`（拼写错）→ `over_alloc_status`
 *   #10 加仓资格 8 项 → 10 项（补 cooldown / regime）
 *   ★ 同名不同义：decision.target_* vs position.target_* 必须分开
 */
import { adaptDashboard } from '../../src/rewrite/adapters/dashboard.js';
import { adaptEtfDetail } from '../../src/rewrite/adapters/etfDetail.js';
import { adaptDecision, displayOverAlloc } from '../../src/rewrite/adapters/decision.js';
import { adaptFundamentals, adaptIntel, filterIntelByCode } from '../../src/rewrite/adapters/fundamentals.js';
import { adaptKline, movingAverage } from '../../src/rewrite/adapters/kline.js';
import { ELIGIBILITY_ITEMS } from '../../src/rewrite/domain/thresholds.js';
import { FIELD_STATE } from '../../src/rewrite/domain/enums.js';
import { FIXTURES, suite, assert, assertState } from './_fixtures.js';

const t = suite('adapters-pages.test');
const val = (f) => (f && f.state === FIELD_STATE.PROVIDED ? f.value : null);

/* ==================== Dashboard ==================== */

t.ok('dashboard：市场环境优先取 overview.market_regime（枚举），非 three_questions', () => {
  const live = FIXTURES.liveDashboard();
  assert.ok(!('market_regime' in live.three_questions), '前置：线上 three_questions 无 market_regime');
  const vm = adaptDashboard(live, FIXTURES.liveConstants().runtime_status);
  assertState(vm.headline.marketRegime, FIELD_STATE.PROVIDED, 'marketRegime');
  assert.equal(vm.headline.marketRegime.value, 'defensive');
  assert.equal(vm.headline.marketRegimeIsFallback, false, '枚举可得时不应走兜底');
  assert.match(vm.headline.marketRegime.provenance.source, /overview\.market_regime/);
});

t.ok('dashboard：枚举缺失时用 three_questions.market_status 兜底，并显式标注 derived', () => {
  const live = JSON.parse(JSON.stringify(FIXTURES.liveDashboard()));
  delete live.overview.market_regime;
  const vm = adaptDashboard(live, null);
  assert.equal(vm.headline.marketRegimeIsFallback, true);
  assert.equal(val(vm.headline.marketRegime), '防守');
  assert.equal(vm.headline.marketRegime.provenance.derived, true, '兜底必须标 derived');
});

t.ok('dashboard：风险取 overview.overall_risk（线上 three_questions 无 risk_status）', () => {
  const live = FIXTURES.liveDashboard();
  assert.ok(!('risk_status' in live.three_questions));
  const vm = adaptDashboard(live, null);
  assertState(vm.headline.risk, FIELD_STATE.PROVIDED, 'risk');
  assert.match(vm.headline.risk.provenance.source, /overall_risk/);
});

t.ok('dashboard：隐杠杆区块字段不存在 ⇒ 显式缺失，⛔ 不虚构', () => {
  const live = FIXTURES.liveDashboard();
  assert.ok(!('leverage_alert' in live.overview), '前置：线上无 leverage_alert');
  assert.ok(!('total_book_pct' in live.overview), '前置：线上无 total_book_pct');
  const vm = adaptDashboard(live, null);
  assert.ok(vm.account.leverageExcess === undefined || vm.account.leverageExcess.state !== FIELD_STATE.PROVIDED,
    '不得凭空给出 leverage 值');
});

t.ok('dashboard：cards[].gen1 显式 UNAVAILABLE，⛔ 不得用 ml_shadow 冒充（审计 #5）', () => {
  const live = FIXTURES.liveDashboard();
  assert.ok(!('gen1' in live.cards[0]), '前置：线上 cards 无 gen1');
  const vm = adaptDashboard(live, null);
  const cards = val(vm.cards);
  assert.equal(cards.length, 5);
  assertState(cards[0].gen1, FIELD_STATE.UNAVAILABLE, 'cards[0].gen1');
  assert.equal(cards[0].gen1.missingReason, 'CONTRACT_NOT_PROVIDED');
});

t.ok('dashboard：final_target 单位 = 仓位百分比（按原值透传，⛔ 不做单位猜断）', () => {
  const live = FIXTURES.liveDashboard();
  const vm = adaptDashboard(live, null);
  const c0 = val(vm.cards)[0];
  assert.equal(val(c0.finalTarget), 0.5, '0.5 必须原样 0.5（表示 0.5%）');
  assert.equal(val(c0.currentPosition), 8.3);
  // ★ 线上实测：dashboard 卡片的 target_std = 0.5（来自 decision 的「本次最终目标带」），
  //   而 /api/etf/list 的同名字段 = 25（配置标准带）—— 见下一条断言
  assert.equal(val(c0.targetStd), 0.5, 'dashboard cards.target_std 来自 decision 目标带');
});

t.ok('★ endpoint 级同名不同义：dashboard.cards.target_std(0.5) ≠ etf/list.target_std(25)', () => {
  const liveCard = FIXTURES.liveDashboard().cards[0];
  const liveListItem = FIXTURES.liveEtfList().list[0];
  assert.equal(liveCard.target_std, 0.5, '前置：dashboard 卡片为 decision 目标带');
  assert.equal(liveListItem.target_std, 25, '前置：etf/list 为配置标准带');
  assert.equal(liveCard.target_position, 0.5);
  assert.equal(liveListItem.target_position, 25);
  // ⛔ 结论：同名 target_* 在三处（decision / position / etf/list / dashboard cards）语义不同，
  //    adapter 必须按「来源端点 + 来源块」区分，⛔ 不得按字段名统一处理。
  assert.notEqual(liveCard.target_std, liveListItem.target_std);
});

t.ok('dashboard：over_alloc_status 真实值可能是**中文**（线上为「中度」）', () => {
  const live = FIXTURES.liveDashboard();
  const raw = live.cards[0].over_alloc_status;
  assert.equal(raw, '中度', '前置：线上确为中文值');
  const vm = adaptDashboard(live, null);
  const c0 = val(vm.cards)[0];
  assertState(c0.overAllocStatus, FIELD_STATE.PROVIDED, 'overAllocStatus');
  assert.equal(c0.overAllocStatus.value, '中度');
});

t.ok('dashboard：ml_shadow.capability 线上不存在 ⇒ 显式 MISSING（审计 #9）', () => {
  const live = FIXTURES.liveDashboard();
  assert.ok(!('capability' in live.ml_shadow), '前置：线上 ml_shadow 无 capability');
  const vm = adaptDashboard(live, null);
  assert.notEqual(vm.systemStatus.capability.state, FIELD_STATE.PROVIDED);
});

/* ==================== ETF detail ==================== */

t.ok('etfDetail：★ 同名字段不同义 —— decision.target_* 与 position.target_* 必须分开', () => {
  const live = FIXTURES.liveEtf();
  // 前置证据：线上两者确实不同量级
  assert.equal(live.decision.target_std, 0.5);
  assert.equal(live.position.target_std, 25);
  const vm = adaptEtfDetail(live, null);
  assert.equal(val(vm.decision.targetBand.std), 0.5, 'decision 带 = 本次最终目标带');
  assert.equal(val(vm.position.band.std), 25, 'position 带 = 配置标准目标带');
  assert.notEqual(val(vm.decision.targetBand.std), val(vm.position.band.std));
  assert.notEqual(vm.decision.targetBand.std.provenance.source, vm.position.band.std.provenance.source,
    '两者 provenance 必须不同源，避免被合并');
});

t.ok('etfDetail：over_alloc_status 拼写已修正（审计 #8）', () => {
  const live = FIXTURES.liveEtf();
  assert.ok('over_alloc_status' in live.decision, '前置：线上为 over_alloc_status');
  const vm = adaptEtfDetail(live, null);
  assertState(vm.decision.overAllocStatus, FIELD_STATE.PROVIDED, 'overAllocStatus');
  assert.notEqual(displayOverAlloc(vm.decision), '—', '⛔ 不得再恒为 —');
  // 反向：若误用旧拼写，结果为 MISSING
  const wrong = adaptDecision({ over_all_status: 'normal' });
  assert.notEqual(wrong.overAllocStatus.state, FIELD_STATE.PROVIDED, '旧拼写应取不到值（证明修复点真实）');
});

t.ok('etfDetail：加仓资格为 **10 项**（补 cooldown / regime，审计 #10）', () => {
  const vm = adaptEtfDetail(FIXTURES.liveEtf(), null);
  assert.equal(ELIGIBILITY_ITEMS.length, 10);
  assert.equal(vm.decision.addEligibility.items.length, 10);
  const keys = vm.decision.addEligibility.items.map((i) => i.key);
  for (const k of ['cooldown', 'regime']) assert.ok(keys.includes(k), '缺判据 ' + k);
  const byKey = Object.fromEntries(vm.decision.addEligibility.items.map((i) => [i.key, i]));
  assert.equal(val(byKey.cooldown.field), 'ok');
  assert.equal(val(byKey.regime.field), 'pause');
});

t.ok('etfDetail：decision 不可用时整块进入显式缺失态（不抛异常）', () => {
  const vm = adaptEtfDetail({ basic: { code: '513310' } }, null);
  assert.equal(vm.decision.available, false);
  assert.equal(vm.decision.reason, 'CONTRACT_NOT_PROVIDED');
  assert.equal(vm.snapshot.available, false);
  assert.equal(vm.position.available, false);
});

t.ok('etfDetail：position_gap 只展示服务端值，⛔ 不重算（SPEC 附录 A.5）', () => {
  const live = FIXTURES.liveEtf();
  const vm = adaptEtfDetail(live, null);
  assert.equal(val(vm.decision.positionGap), 0, '服务端值 0');
  const ft = val(vm.decision.finalTarget);
  const cur = val(vm.position.currentPosition);
  assert.notEqual(ft - cur, 0, '前置：final_target − current ≠ 0，证明服务端语义不是简单相减');
  assert.equal(val(vm.decision.positionGap), live.decision.position_gap, '必须逐位等于服务端值');
});

t.ok('etfDetail：price_position 是 0~1 比例（不得当百分比）', () => {
  const live = FIXTURES.liveEtf();
  const vm = adaptEtfDetail(live, null);
  const pp = val(vm.snapshot.pricePosition);
  assert.equal(pp, live.snapshot.price_position);
  assert.ok(pp >= 0 && pp <= 1, 'price_position 应落在 0~1，实际 ' + pp);
});

t.ok('etfDetail：stage_factor / market_factor 是系数（0~1），不是百分比', () => {
  const live = FIXTURES.liveEtf();
  const vm = adaptEtfDetail(live, null);
  assert.equal(val(vm.decision.factors.stage), 0);
  assert.equal(val(vm.decision.factors.market), 0.25);
  // 若被当百分比渲染会变成 "0%" / "25%" —— 语义错误
  assert.equal(val(vm.decision.factors.market), live.decision.market_factor);
});

t.ok('etfDetail：基本面载荷由「死载荷」变为可用摘要（SPEC §11.3）', () => {
  const live = FIXTURES.liveEtf();
  assert.ok(live.fundamental, '前置：线上确有 fundamental 载荷');
  const vm = adaptEtfDetail(live, null);
  assert.equal(vm.fundamentalBrief.available, true);
  assertState(vm.fundamentalBrief.fState, FIELD_STATE.PROVIDED, 'fState');
});

/* ==================== 基本面 / 情报 ==================== */

t.ok('fundamentals：三分层 + 权重 + AI 证据均可读', () => {
  const vm = adaptFundamentals(FIXTURES.liveFundamentals());
  const cards = val(vm.cards);
  assert.equal(cards.length, 5);
  const c = cards.find((x) => val(x.code) === '513310');
  assert.ok(c, '缺 513310 卡');
  assertState(c.detail.layerBreakdown.hard_data.count, FIELD_STATE.PROVIDED, 'hard_data.count');
  assertState(c.indicators, FIELD_STATE.PROVIDED, 'indicators');
  assert.ok(val(c.indicators).length > 0);
  const ind = val(c.indicators)[0];
  assertState(ind.weight, FIELD_STATE.PROVIDED, 'indicator.weight');
});

t.ok('intel：按 related 过滤 —— 无关联杂音不得出现在标的下（沿用旧语义）', () => {
  const vm = adaptIntel(FIXTURES.liveIntel());
  const all = val(vm.items);
  const only = filterIntelByCode(vm, '518880');
  assert.ok(only.length <= all.length);
  for (const item of only) {
    const rel = val(item.related);
    assert.ok(Array.isArray(rel) && rel.includes('518880'), '过滤结果必须都关联 518880');
  }
  // 反向：空 related 的项必须被排除
  assert.ok(only.every((i) => Array.isArray(val(i.related)) && val(i.related).length > 0));
});

/* ==================== K 线 ==================== */

t.ok('kline：条形字段可读、按日期升序、volume 为「份」原值', () => {
  const vm = adaptKline(FIXTURES.liveKline());
  const bars = val(vm);
  assert.ok(bars.length >= 30);
  for (let i = 1; i < bars.length; i++) assert.ok(bars[i].date >= bars[i - 1].date, '必须升序');
  assert.equal(typeof bars[bars.length - 1].close, 'number');
  const ma = movingAverage(bars, 20);
  assert.equal(ma.length, bars.length);
  assert.equal(ma[18], null, '不足 20 根时 MA20 为 null（⛔ 不填 0）');
  assert.ok(typeof ma[19] === 'number');
});

t.ok('kline：非数组输入 ⇒ 显式缺失（不抛异常）；空数组是合法值（PROVIDED 且长度 0）', () => {
  const f = adaptKline(null);
  assert.equal(f.state, FIELD_STATE.MISSING);
  assert.equal(adaptKline('nope').state, FIELD_STATE.MISSING);
  const empty = adaptKline([]);
  assert.equal(empty.state, FIELD_STATE.PROVIDED, '空数组是合法值（⛔ 不是缺失）');
  assert.equal(empty.value.length, 0);
});

t.done();
