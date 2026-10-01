/**
 * Dashboard 适配器 / ViewModel 测试（M3 · SPEC §4.1 / §9 / 附录 A）
 *
 * 覆盖 owner 指定的 6 类响应 + 数字语义 + 生命周期未提供 + Gen-1 未提供：
 *   A canonical · B 当前线上旧响应 · C canonical 字段为 null · D canonical 字段缺失
 *   E legacy-only（无 canonical、无运行时状态）· F malformed
 *
 * ★ 断言原则：
 *   · 数字必须按**字段语义**断言（不得按数值大小推断单位）；
 *   · 缺失必须落到 `数据未提供` + 原因码，⛔ 不接受静默 `—`；
 *   · 生命周期 ⛔ 不得出现任何写死的状态值。
 */
import { adaptDashboard } from '../../src/rewrite/adapters/dashboard.js';
import { phaseOf, describeError, loadDashboard, PAGE_PHASE } from '../../src/rewrite/compose/useDashboard.js';
import { API_ERROR_KIND } from '../../src/rewrite/api.js';
import { FIELD_STATE, MISSING_REASON } from '../../src/rewrite/domain/enums.js';
import { FIXTURES, suite, assert } from './_fixtures.js';

const t = suite('dashboard-adapter.test');
const clone = (o) => JSON.parse(JSON.stringify(o));
const val = (f) => (f && f.state === FIELD_STATE.PROVIDED ? f.value : null);
const RS = () => FIXTURES.liveConstants().runtime_status;

/** 异步用例（suite.ok 是同步的，异步断言必须用本 harness，否则失败会变成未捕获 rejection） */
async function okAsync(label, fn) {
  await fn();
  console.log('[PASS] ' + label);
}

/* ==================== A/B：canonical 与线上旧响应 ==================== */

t.ok('A canonical：VM 顶层结构齐备（market/decision/gen1/lifecycle/provenance/asOf/freshness/portfolio/boundaries）', () => {
  const vm = adaptDashboard(FIXTURES.canonicalDashboard(), RS(), { retrievedAt: '2026-09-30T18:00:00.000Z' });
  for (const k of ['available', 'market', 'decision', 'portfolio', 'cards', 'gen1', 'lifecycle',
    'boundaryFields', 'systemStatus', 'asOf', 'freshness', 'provenance', 'boundaries', 'headline', 'account']) {
    assert.ok(Object.prototype.hasOwnProperty.call(vm, k), '缺 VM 键 ' + k);
  }
  assert.equal(vm.provenance.hasCanonicalContract, true);
  assert.equal(vm.gen1.sourceChannel, 'CANONICAL');
  assert.equal(vm.gen1.perCard.available, 5, 'canonical 下 5 张卡都应带 gen1 契约');
});

t.ok('B 线上旧响应：gen1 通道 = RUNTIME_STATUS（显式命名，⛔ 非静默 fallback）', () => {
  const vm = adaptDashboard(FIXTURES.liveDashboard(), RS(), { retrievedAt: '2026-09-30T18:00:00.000Z' });
  assert.equal(vm.provenance.hasCanonicalContract, false, '前置：线上无顶层 production/gen1');
  assert.equal(vm.gen1.sourceChannel, 'RUNTIME_STATUS');
  assert.equal(vm.gen1.sourceChannelText, '运行时状态');
  assert.ok(vm.gen1.sourceChannelNote.includes('非契约通道'), '必须带通道警示');
  assert.ok(vm.gen1.channelCaveat.includes('runtime_status'), '必须说明来源');
  assert.equal(vm.gen1.authority.provenance.fallbackFrom, 'runtime_status', '必须标注 fallbackFrom');
  assert.equal(vm.gen1.perCard.available, 0, '线上 cards 无 gen1');
  assert.equal(vm.gen1.perCard.unavailable, 5);
});

t.ok('B 线上旧响应：后端标签优先（authority_label / health_label 用后端中文，⛔ 不自造）', () => {
  const vm = adaptDashboard(FIXTURES.liveDashboard(), RS(), {});
  assert.equal(vm.gen1.authorityLabel.text, '灰度反事实');
  assert.equal(vm.gen1.authorityLabelIsBackend, true);
  assert.equal(vm.gen1.healthLabel.text, '降级（禁止灰度）', 'runtime_status.gen1_health_label 是后端文案');
  assert.equal(vm.gen1.healthTone, 'risk');
  assert.equal(vm.gen1.healthGateLabel.text, '门控生效');
});

t.ok('市场环境：枚举优先（defensive → 防守），risk 走 overall_risk', () => {
  const vm = adaptDashboard(FIXTURES.liveDashboard(), RS(), {});
  assert.equal(vm.market.regimeLabel, '防守');
  assert.equal(vm.market.regimeTone, 'risk');
  assert.equal(vm.market.regimeIsFallback, false);
  assert.equal(vm.market.riskLabel, '正常');
  assert.equal(vm.market.riskTone, 'good');
  assert.equal(vm.market.mostDefendLabel, '中韩半导体ETF(QDII)');
  assert.equal(vm.market.mostWorthText.text, '字段缺失', '线上 most_worth = null ⇒ NULL_IN_CONTRACT');
  assert.equal(vm.market.mostWorthText.reason, MISSING_REASON.NULL_IN_CONTRACT);
});

t.ok('★ 契约断裂守卫：⛔ 不再读取 three_questions.market_regime / risk_status / gen1_advice', () => {
  const live = FIXTURES.liveDashboard();
  assert.ok(!('market_regime' in live.three_questions));
  assert.ok(!('risk_status' in live.three_questions));
  assert.ok(!('gen1_advice' in live.three_questions));
  const vm = adaptDashboard(live, RS(), {});
  // 市场/风险都能拿到值，说明读的是正确字段
  assert.equal(vm.market.regime.state, FIELD_STATE.PROVIDED);
  assert.equal(vm.market.risk.state, FIELD_STATE.PROVIDED);
  assert.match(vm.market.regime.provenance.source, /overview\.market_regime/);
  assert.match(vm.market.risk.provenance.source, /overall_risk/);
});

/* ==================== 正式决策区 ==================== */

t.ok('正式决策：动作分类计数 + 关注列表（非 WAIT/HOLD 才进关注）', () => {
  const vm = adaptDashboard(FIXTURES.liveDashboard(), RS(), {});
  assert.deepEqual(vm.decision.counts, { total: 5, reduce: 1, hold: 1, add: 0, wait: 3, other: 0 });
  assert.equal(vm.decision.attention.length, 1);
  assert.equal(vm.decision.attention[0].display.code, '513310');
  assert.equal(vm.decision.attention[0].display.action, '战略减仓');
  assert.equal(vm.decision.attention[0].display.attention, true);
  assert.equal(vm.decision.identity.includes('Safety Core'), true, '正式决策身份必须写明 Safety Core');
});

t.ok('★ 组合目标合计：⛔ 前端不出数字（无组合级契约）', () => {
  const vm = adaptDashboard(FIXTURES.canonicalDashboard(), RS(), {});
  assert.equal(vm.decision.targetTotal.available, false);
  assert.equal(vm.decision.targetTotal.reason, MISSING_REASON.NO_BACKEND_CONTRACT);
  assert.equal(vm.decision.targetTotal.text, '数据未提供');
  assert.ok(!/\d/.test(vm.decision.targetTotal.text), '⛔ 不得出现任何数字（防代求和）');
});

t.ok('★ position_gap：逐位透传服务端值，⛔ 不重算（SPEC 附录 A.5）', () => {
  const live = FIXTURES.liveDashboard();
  const vm = adaptDashboard(live, RS(), {});
  const c0 = vm.cards.value[0];
  assert.equal(val(c0.positionGap), live.cards[0].position_gap);
  assert.equal(c0.display.gap.text, '0.0%');
  // 反证：若按 final_target − current 重算会得到 -7.8
  assert.notEqual(live.cards[0].final_target - live.cards[0].current_position, live.cards[0].position_gap);
  assert.notEqual(c0.display.gap.text, '-7.8%');
});

/* ==================== ★ 数字语义（SPEC §10 / 附录 A） ==================== */

t.ok('★ final_target = 仓位百分比：0.5 → "0.5%"（⛔ 绝不是 50%）', () => {
  const vm = adaptDashboard(FIXTURES.liveDashboard(), RS(), {});
  const c0 = vm.cards.value[0];
  assert.equal(val(c0.finalTarget), 0.5);
  assert.equal(c0.display.target.text, '0.5%');
  assert.notEqual(c0.display.target.text, '50.0%');
  assert.notEqual(c0.display.target.text, '50%');
});

t.ok('★ 组合仓位 / 现金比例：百分数原样渲染（etf_total=15.4 → 15.4%）', () => {
  const vm = adaptDashboard(FIXTURES.liveDashboard(), RS(), {});
  // portfolio.* 是**展示对象**（含 text/missing），account.* 才是裸 Field
  assert.equal(vm.portfolio.etfTotal.missing, false);
  assert.equal(vm.portfolio.etfTotal.text, '15.4%');
  assert.equal(vm.portfolio.cashRatio.text, '84.6%');
  assert.equal(vm.portfolio.techPosition.text, '15.4%');
  assert.equal(vm.portfolio.goldPosition.text, '0.0%', '0 是合法值 ⇒ 0.0%，⛔ 不是缺失');
  assert.equal(vm.portfolio.goldPosition.missing, false);
  assert.equal(vm.portfolio.innovationPosition.text, '0.0%');
  assert.equal(vm.portfolio.etfTotal.field.provenance.source.includes('overview'), true);
});

t.ok('★ 金额（元）→ 万/亿显示，但单位语义固定为元（⛔ 不推断输入单位）', () => {
  const vm = adaptDashboard(FIXTURES.liveDashboard(), RS(), {});
  assert.equal(val(vm.account.totalAsset), 99172.1);
  assert.equal(vm.portfolio.money.totalAsset.text, '9.92 万');
  assert.equal(vm.portfolio.money.maskedByDefault, true, '前台默认遮罩');
  // 万/亿只在 ≥1e4 时启用；-823.8 仍在「元」档 ⇒ 原样两位小数（⛔ 不为了好看擅自缩位）
  assert.equal(vm.portfolio.money.totalPnl.text, '-823.80');
  assert.equal(vm.portfolio.money.totalPnl.field.value, -823.8);
  assert.equal(vm.portfolio.money.pnlSign, -823.8);
});

t.ok('★ 目标带（min ~ max）逐项百分号，⛔ 不做区间推断', () => {
  const vm = adaptDashboard(FIXTURES.liveDashboard(), RS(), {});
  const c0 = vm.cards.value[0];
  assert.equal(c0.display.band, '0.4% ~ 0.5%');
});

t.ok('★ 0 与空串是合法值 ⇒ 必须 PROVIDED（SPEC §9）', () => {
  const data = {
    overview: { market_regime: 'range', overall_risk: 'NORMAL', cash_ratio: 0, etf_total: 0 },
    three_questions: {},
    cards: [{ code: 'X', name: 'X', action: 'WAIT', current_position: 0, final_target: 0, position_gap: 0 }]
  };
  const vm = adaptDashboard(data, null, {});
  assert.equal(vm.portfolio.cashRatio.missing, false);
  assert.equal(vm.portfolio.cashRatio.text, '0.0%');
  const c0 = vm.cards.value[0];
  assert.equal(c0.display.current.missing, false);
  assert.equal(c0.display.current.text, '0.0%');
});

/* ==================== C/D：canonical 字段为 null / 缺失 ==================== */

t.ok('C canonical 字段为 null ⇒ MISSING/NULL_IN_CONTRACT，⛔ 不 fallback 掩盖', () => {
  const data = clone(FIXTURES.canonicalDashboard());
  data.cards = [data.cards[0]];
  data.cards[0].production.final_target_pct = null;
  data.cards[0].gen1.signal.probability = null;

  const vm = adaptDashboard(data, RS(), {});
  const c0 = vm.cards.value[0];
  assert.equal(c0.production.value.finalTargetPct.state, FIELD_STATE.MISSING);
  assert.equal(c0.production.value.finalTargetPct.missingReason, MISSING_REASON.NULL_IN_CONTRACT);
  assert.equal(c0.display.gen1.probabilityText, '字段缺失');
  assert.equal(c0.display.gen1.available, true, 'gen1 块已下发 ⇒ 卡片级 Gen-1 可用（只是该字段为 null）');
});

t.ok('D canonical 字段缺失 ⇒ FIELD_ABSENT（与「块未下发」区分）', () => {
  const data = clone(FIXTURES.canonicalDashboard());
  data.cards = [data.cards[0]];
  delete data.cards[0].production.risk_flag;
  delete data.cards[0].gen1.safety.reason;

  const vm = adaptDashboard(data, RS(), {});
  const c0 = vm.cards.value[0];
  assert.equal(c0.production.value.riskFlag.state, FIELD_STATE.MISSING);
  assert.equal(c0.production.value.riskFlag.missingReason, MISSING_REASON.FIELD_ABSENT);
  assert.equal(c0.display.gen1.safetyReasonText, '字段缺失');
  // 对照：整块不存在 ⇒ UNAVAILABLE
  const data2 = clone(FIXTURES.liveDashboard());
  const vm2 = adaptDashboard(data2, RS(), {});
  assert.equal(vm2.cards.value[0].gen1.state, FIELD_STATE.UNAVAILABLE);
  assert.equal(vm2.cards.value[0].gen1.missingReason, MISSING_REASON.CONTRACT_NOT_PROVIDED);
});

/* ==================== E：legacy-only（无 canonical、无运行时状态） ==================== */

t.ok('E legacy-only：Gen-1 通道 = NONE ⇒ 显式「数据未提供」，⛔ 不用 ml_shadow 反推', () => {
  const vm = adaptDashboard(FIXTURES.liveDashboard(), null, {});
  assert.equal(vm.gen1.sourceChannel, 'NONE');
  assert.equal(vm.gen1.authorityLabel.text, '数据未提供');
  assert.equal(vm.gen1.healthLabel.text, '数据未提供');
  assert.equal(vm.gen1.authority.state, FIELD_STATE.UNAVAILABLE);
  assert.ok(vm.gen1.channelCaveat.includes('未提供'), '必须显式说明未提供');
  // legacy 回退存在，但必须被标记
  assert.equal(vm.legacyFallback.used, true);
  assert.equal(vm.provenance.legacyFallbackUsed, true);
  assert.equal(vm.provenance.gen1Channel, 'NONE', '⛔ legacy 存在不得把 gen1 通道改成 legacy');
});

/* ==================== 生命周期（⛔ 不得写死状态） ==================== */

t.ok('★ 生命周期：仅 API 真实可读的维度才有值，其余「数据未提供」+ 原因', () => {
  const vm = adaptDashboard(FIXTURES.liveDashboard(), RS(), {});
  assert.equal(vm.lifecycle.totalCount, 8);
  const provided = vm.lifecycle.items.filter((i) => i.provided);
  assert.equal(provided.length, 1, '线上仅 deployment_identity 可由 runtime_status 提供');
  assert.equal(provided[0].dim, 'deployment_identity');
  assert.equal(provided[0].valueText, 'v3.6.1', '⚠️ 引擎版本 ≠ 台账部署身份（冲突 A）');
  assert.ok(provided[0].caveat.includes('不是同一概念'), '必须显式区分，⛔ 不得合并表述');
  assert.equal(vm.lifecycle.unavailableCount, 7);
  for (const it of vm.lifecycle.items.filter((i) => !i.provided)) {
    assert.equal(it.valueText, '数据未提供');
    assert.ok(it.reasonText && it.reasonText.length > 0, it.dim + ' 必须给出缺失原因');
  }
});

t.ok('★ 生命周期：runtime_status 与 system_runtime 均不可读 ⇒ 8/8 全部未提供（⛔ 绝不写死台账状态）', () => {
  const data = clone(FIXTURES.canonicalDashboard());
  delete data.system_runtime;                       // 无契约
  const vm = adaptDashboard(data, null, {});        // 且无 runtime_status
  assert.equal(vm.lifecycle.unavailableCount, 8);
  for (const it of vm.lifecycle.items) assert.equal(it.valueText, '数据未提供');
  // 反向守卫：VM 中不得出现任何写死的状态值
  const json = JSON.stringify(vm.lifecycle);
  for (const s of ['NOT_STARTED', 'NOT_GRANTED', 'NOT_EXECUTED', 'V3.6.5']) {
    assert.ok(!json.includes(s), '⛔ lifecycle VM 不得出现写死值 ' + s);
  }
});

t.ok('★ 生命周期：canonical system_runtime 可读 ⇒ 仅「线上引擎版本」有值，来源必须是契约', () => {
  const vm = adaptDashboard(FIXTURES.canonicalDashboard(), null, {});
  assert.equal(vm.lifecycle.unavailableCount, 7);
  const di = vm.lifecycle.items.find((i) => i.dim === 'deployment_identity');
  assert.equal(di.provided, true);
  assert.equal(di.valueText, 'v3.6.1');
  assert.equal(di.sourceText, 'contract:system_runtime');
  assert.ok(di.caveat.includes('不是同一概念'), '⛔ 不得与台账「Production Deployment Identity」混为一谈');
});

t.ok('★ 生命周期：三轴分离不变量（代码上线 ≠ 生产运行 ≠ 资格演进）', () => {
  const vm = adaptDashboard(FIXTURES.liveDashboard(), RS(), {});
  assert.equal(vm.lifecycle.axesView.length, 3);
  const axisOf = Object.fromEntries(vm.lifecycle.axesView.map((a) => [a.axis, a.items.map((i) => i.dim)]));
  assert.deepEqual(axisOf.code_on_line, ['deployment', 'deployment_identity', 'source_parity']);
  assert.deepEqual(axisOf.production_run, ['activation_authorization', 'first_controlled_run']);
  assert.deepEqual(axisOf.qualification, ['prospective_epoch', 'run_history', 'general_production']);
  // 所有维度恰好归属一个轴
  const flat = vm.lifecycle.axesView.flatMap((a) => a.items.map((i) => i.dim));
  assert.equal(new Set(flat).size, 8);
});

t.ok('边界字段组：三态（true/false/null）⛔ 不压扁；含反例', () => {
  const vm = adaptDashboard(FIXTURES.liveDashboard(), RS(), {});
  const byKey = Object.fromEntries(vm.boundaryFields.map((b) => [b.key, b]));
  assert.equal(byKey.ml_advisory_enabled.value.text, '是');
  assert.equal(byKey.ml_execution_enabled.value.text, '否');
  assert.ok(byKey.ml_advisory_enabled.counter.includes('反例'), '每项必须带反例说明');
  assert.equal(byKey.gen1_broker_wired.value.text, '否');
  // runtime_status 不可读 ⇒ 全部未提供
  const vm2 = adaptDashboard(FIXTURES.liveDashboard(), null, {});
  assert.equal(vm2.boundaryFields.every((b) => b.value.text === '数据未提供'), true);
});

/* ==================== 新鲜度 ==================== */

t.ok('新鲜度：新鲜 / 过期 / 无时间戳 三态文案互不相同', () => {
  const now = new Date('2026-09-30T12:00:00.000Z');
  const live = adaptDashboard(FIXTURES.liveDashboard(), RS(), {});
  // 线上夹具时间为 2026-09-30；用固定 now 断言
  const fresh = adaptDashboard(FIXTURES.liveDashboard(), { decision_date: '2026-09-30' }, {});
  assert.equal(fresh.freshness.snapshot.level, 'FRESH');
  assert.equal(fresh.freshness.decision.level, 'FRESH');
  assert.ok(fresh.freshness.snapshot.text.length > 0);
  assert.equal(live.freshness.overall.text.length > 0, true);

  const staleData = clone(FIXTURES.liveDashboard());
  staleData.overview.snapshot_date = '2020-01-01';
  const stale = adaptDashboard(staleData, { decision_date: '2020-01-01' }, {});
  assert.equal(stale.freshness.snapshot.level, 'STALE');
  assert.ok(stale.freshness.snapshot.text.includes('数据已过期'), '过期文案必须可辨');
  assert.notEqual(stale.freshness.snapshot.text, fresh.freshness.snapshot.text);

  const noDate = clone(FIXTURES.liveDashboard());
  delete noDate.overview.snapshot_date;
  const missing = adaptDashboard(noDate, null, {});
  assert.equal(missing.freshness.snapshot.level, 'MISSING');
  assert.equal(missing.freshness.snapshot.text, '无时间戳');
  assert.equal(missing.asOf.snapshotDateText, '字段缺失', '日期缺失也须显式（⛔ 不用 — 掩盖）');
});

/* ==================== F：malformed ==================== */

t.ok('F malformed：不抛异常，逐字段降级为显式缺失', () => {
  let vm;
  assert.doesNotThrow(() => { vm = adaptDashboard(FIXTURES.malformed(), RS(), {}); });
  assert.equal(vm.available, true);
  assert.equal(vm.market.regimeLabel, '数据未提供', 'overview 是字符串 ⇒ 整块不可用');
  // cards 原始 4 条中 3 条是 null / 42 / 'x'（非对象）⇒ 被过滤，仅保留 1 条合法对象
  assert.equal(vm.cards.state, FIELD_STATE.PROVIDED);
  assert.equal(vm.cards.value.length, 1);
  assert.equal(vm.decision.counts.total, 1);
  const c0 = vm.cards.value[0];
  // 约定：display.code / display.name 是**展示字符串**（缺失时同样给出显式文案），其余为 {text,missing,…} 结构
  assert.equal(c0.display.name, '字段缺失', 'name=null ⇒ 显式文案，⛔ 不留空白');
  assert.equal(c0.display.code, '513310');
  assert.equal(c0.display.target.missing, true, 'final_target 缺失必须显式');
  assert.equal(typeof c0.display.action, 'string');
});

t.ok('F 空数组 / 非数组 / null 输入均不抛异常', () => {
  for (const input of [null, undefined, [], 'nope', 42, {}]) {
    let vm;
    assert.doesNotThrow(() => { vm = adaptDashboard(input, null, {}); });
    assert.ok(vm && typeof vm === 'object');
  }
  const empty = adaptDashboard(FIXTURES.emptyArrays(), null, {});
  assert.equal(empty.cards.state, FIELD_STATE.PROVIDED, '空数组是合法值（0 条）');
  assert.equal(empty.cards.value.length, 0);
  assert.equal(empty.decision.counts.total, 0);
  assert.equal(empty.decision.targetTotal.text, '数据未提供');
});

/* ==================== provenance / 页面状态机 ==================== */

t.ok('provenance：来源、取数时刻由外部注入（⛔ 适配器不自造时间）', () => {
  const withMeta = adaptDashboard(FIXTURES.liveDashboard(), RS(), { retrievedAt: '2026-09-30T18:00:00.000Z' });
  assert.equal(withMeta.provenance.retrievedAt, '2026-09-30T18:00:00.000Z');
  assert.equal(withMeta.asOf.retrievedAt, '2026-09-30T18:00:00.000Z');
  // ⚠️ formatDateTime 按**本地时区**渲染（GMT+8 ⇒ 18:00Z 显示为次日 02:00）
  //    ⇒ 断言格式而非具体日期字面值，避免把时区行为写死进测试
  assert.match(withMeta.asOf.retrievedAtText, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  const noMeta = adaptDashboard(FIXTURES.liveDashboard(), RS(), {});
  assert.equal(noMeta.asOf.retrievedAt, null, '未注入时必须是 null，⛔ 不得用 now() 顶替');
  assert.equal(noMeta.provenance.source, 'api:/api/dashboard');
  assert.equal(noMeta.provenance.sourceAlt, 'api:/api/constants');
});

t.ok('页面状态机：canonical ⇒ ready；线上旧响应 ⇒ ready-degraded；空 ⇒ empty', () => {
  assert.equal(phaseOf(adaptDashboard(FIXTURES.canonicalDashboard(), RS(), {})), PAGE_PHASE.READY);
  assert.equal(phaseOf(adaptDashboard(FIXTURES.liveDashboard(), RS(), {})), PAGE_PHASE.READY_DEGRADED);
  assert.equal(phaseOf(adaptDashboard(null, null, {})), PAGE_PHASE.EMPTY);
  assert.equal(phaseOf(adaptDashboard({}, null, {})), PAGE_PHASE.EMPTY);
  assert.equal(phaseOf(adaptDashboard(FIXTURES.emptyArrays(), null, {})), PAGE_PHASE.EMPTY);
});

t.ok('错误归一：各类 ApiError 都给用户可读文案（⛔ 不回显堆栈）', () => {
  const mk = (kind, extra = {}) => Object.assign(Object.create({ kind }), { message: 'raw', ...extra });
  assert.ok(describeError({ kind: API_ERROR_KIND.TIMEOUT }).includes('超时'));
  assert.ok(describeError({ kind: API_ERROR_KIND.NETWORK }).includes('网络'));
  assert.ok(describeError({ kind: API_ERROR_KIND.PARSE }).includes('JSON'));
  assert.ok(describeError(mk(API_ERROR_KIND.HTTP, { httpStatus: 500 })).includes('500'));
  assert.ok(!describeError({ kind: API_ERROR_KIND.NETWORK, stack: 'x' }).includes('at '));
  assert.equal(typeof describeError(new Error('boom')), 'string');
});

/* ==================== loadDashboard（可注入 loader） ==================== */

await okAsync('loadDashboard：constants 失败不阻断主视图（Promise.allSettled 语义）', async () => {
  const loader = {
    dashboard: async () => FIXTURES.liveDashboard(),
    constants: async () => { throw new Error('constants down'); }
  };
  const vm = await loadDashboard(loader);
  assert.equal(vm.available, true);
  assert.equal(vm.cards.value.length, 5);
  assert.equal(vm.gen1.sourceChannel, 'NONE', 'constants 不可读 ⇒ Gen-1 走未提供');
  assert.ok(vm.asOf.retrievedAt, '取数时刻由 compose 注入');
});

await okAsync('loadDashboard：dashboard 失败 ⇒ 抛错（由页面转成 error 态）', async () => {
  const loader = { dashboard: async () => { throw new Error('boom'); }, constants: async () => ({}) };
  await assert.rejects(() => loadDashboard(loader));
});

t.done();
