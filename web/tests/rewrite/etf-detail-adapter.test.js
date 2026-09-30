/**
 * ETF 工作台适配器测试（M4-P1）
 *
 * 覆盖 owner 指定的 M4 验收场景（15 个）：
 *   normal · decision-missing · gen1-missing · stale · malformed
 *   · target=0 / 0.5 / 28.5 · risk-normal/yellow/red/中文
 *   · kline-live60 / kline-empty / kline-error
 * 另加：三条**明文禁止**的守卫 + 数字单位语义 + K 线/决策新鲜度独立性 + 决策链定性。
 */
import { adaptEtfDetail } from '../../src/rewrite/adapters/etfDetail.js';
import { adaptGen1ForDetail } from '../../src/rewrite/adapters/gen1Detail.js';
import { FIELD_STATE, MISSING_REASON, GEN1_CHANNEL } from '../../src/rewrite/domain/enums.js';
import { FIXTURES, suite, assert, assertState } from './_fixtures.js';

const t = suite('etf-detail-adapter.test');

const LIVE = () => FIXTURES.m4('etf-normal.json');
const K60 = () => FIXTURES.m4('kline-live60.json');
const REAL = '2026-09-30T20:00:00.000Z';
const val = (f) => (f && (f.state === FIELD_STATE.PROVIDED || f.state === FIELD_STATE.STALE) ? f.value : null);

/** 完整 ViewModel（带 kline） */
const full = (data, opts = {}) => adaptEtfDetail(data, null, { klineRaw: K60(), retrievedAt: REAL, ...opts });

/* ==================== ① 结构完整性（12 组） ==================== */

t.ok('normal：ViewModel 12 组齐备（M4-P0 §B 形状）', () => {
  const vm = full(LIVE());
  for (const k of ['identity', 'decision', 'position', 'risk', 'gen1Detail', 'price', 'kline',
    'structure', 'fundamentalsSummary', 'freshness', 'provenance', 'boundaries']) {
    assert.ok(vm[k] !== undefined, '缺 VM 组: ' + k);
  }
  assert.equal(vm.available, true);
  assert.equal(vm.identity.nameText, '中韩半导体ETF(QDII)');
  assert.equal(vm.decision.identity, 'V3 Safety Core · 安全与最终权威');
  assert.equal(vm.decision.isFormalAuthority, true);
});

t.ok('normal：missingItems 集中列出显式缺失项（⛔ 不静默）', () => {
  const vm = full(LIVE());
  assert.ok(Array.isArray(vm.missingItems), 'missingItems 必须是数组');
  // 线上实测 premium_rate / avg_cost 恒 null ⇒ 必须在缺失清单里出现
  const labels = vm.missingItems.map((m) => m.k);
  assert.ok(labels.includes('风险 · 溢价率'), '溢价率恒 null，必须登记为缺失');
  assert.ok(labels.includes('实际 · 成本价'), '成本价恒 null，必须登记为缺失');
  for (const m of vm.missingItems) {
    assert.ok(m.k && m.v, '缺失项必须有标签与状态文案');
    assert.ok(m.v !== '—', '⛔ 缺失不得显示为 —（那是「值为空」的歧义写法）');
  }
});

/* ==================== ② 三条禁止（用户 M4-P1 明文） ==================== */

t.ok('★ 禁止 1：position_gap 逐位等于服务端值，⛔ 不重算', () => {
  const data = LIVE();
  const vm = full(data);
  assert.equal(val(vm.decision.gap), data.decision.position_gap, '必须逐位等于服务端 position_gap');
  assert.equal(val(vm.decision.gap), 0);
  // 前置证据：final_target − current ≠ 0 ⇒ 若前端重算会得出不同值
  const ft = val(vm.decision.finalTarget);
  const cur = val(vm.position.currentPosition);
  assert.notEqual(ft - cur, val(vm.decision.gap), '前端不得用减法重算缺口');
  assert.ok(vm.decision.gapNote.includes('服务端'),
    'UI 必须标注缺口来源（gapNote 由 domain 提供，⛔ 组件不硬编码）');
  assert.ok(vm.boundaries.noRecomputeNote.includes('不重算'), '统一「不重算」声明必须存在');
});

t.ok('★ 禁止 2：⛔ 不跨 endpoint 偷补（不使用 /api/etf/list）', () => {
  const vm = full(LIVE());
  assert.ok(vm.provenance.listEndpointNote.includes('/api/etf/list'), '必须显式声明不用 list 端点');
  assert.equal(vm.provenance.blocks.includes('list'), false);
  // 本页 VM 中不得出现任何 list 专属字段名
  const json = JSON.stringify(vm);
  assert.ok(!json.includes('"defense"'), '⛔ 不得引入 etf/list 的 defense 字段');
  assert.equal(vm.identity.configTargetText.text, '25.0%', '配置目标来自 basic 块（本端点自带），非 list');
});

t.ok('★ 禁止 3：legacy 通道 ⛔ 不得标成 canonical', () => {
  const vm = full(LIVE());
  assert.equal(vm.gen1Detail.channel, GEN1_CHANNEL.DECISION_LEGACY);
  assert.equal(vm.gen1Detail.isCanonical, false);
  assert.equal(vm.gen1Detail.channelLabel, 'Legacy Channel');
  assert.ok(!vm.gen1Detail.channelLabel.toLowerCase().includes('canonical'), '⛔ 不得出现 canonical 字样');
  assert.equal(vm.gen1Detail.fieldTag, 'Legacy 通道');
  assert.equal(vm.provenance.fallbackFrom, 'legacy');
});

/* ==================== ③ 单位语义（0 / 0.5 / 28.5 专项） ==================== */

t.ok('★ target=0：`0` 是合法值 ⇒ `0.0%`，missing=false（⛔ 不得当缺失、⛔ 不得显示 —）', () => {
  const vm = adaptEtfDetail(FIXTURES.m4('etf-target-0.json'), null, {});
  assertState(vm.decision.finalTarget, FIELD_STATE.PROVIDED, 'finalTarget');
  assert.equal(val(vm.decision.finalTarget), 0);
  assert.equal(vm.decision.finalTargetText.text, '0.0%');
  assert.equal(vm.decision.finalTargetText.missing, false);
});

t.ok('★ target=0.5：⇒ `0.5%`（⛔ 绝不是 50%）', () => {
  const vm = adaptEtfDetail(FIXTURES.m4('etf-target-0p5.json'), null, {});
  assert.equal(val(vm.decision.finalTarget), 0.5);
  assert.equal(vm.decision.finalTargetText.text, '0.5%');
  assert.ok(!vm.decision.finalTargetText.text.includes('50'), '⛔ 0.5 不得被渲染成 50%');
  assert.equal(vm.decision.targetBand.rangeText, '0.4% ~ 0.5%');
});

t.ok('★ target=28.5：⇒ `28.5%`（与 0.5 同一 formatter，⛔ 无量级分支）', () => {
  const vm = adaptEtfDetail(FIXTURES.m4('etf-target-28p5.json'), null, {});
  assert.equal(val(vm.decision.finalTarget), 28.5);
  assert.equal(vm.decision.finalTargetText.text, '28.5%');
});

t.ok('★ stage_factor / market_factor 是**系数 0~1**，⛔ 不得显示成 25%', () => {
  const vm = adaptEtfDetail(FIXTURES.m4('etf-target-0p5.json'), null, {});
  // ⚠️ factorsView 是 display 对象（`{field,text,missing}`），不是裸 Field ⇒ 断言走 .field / .text
  assert.equal(vm.decision.factorsView.market.field.value, 0.25, '原始值必须是 0.25');
  assert.equal(vm.decision.factorsView.market.text, '0.25', 'market_factor=0.25 必须显示 0.25，不是 25%');
  assert.ok(!vm.decision.factorsView.market.text.includes('%'), '⛔ 系数不得带 %');
  assert.equal(vm.decision.factorsView.market.missing, false);
  assert.equal(vm.decision.factorsView.stage.text, '0.00');
  // M2 形态必须仍在（⛔ 零回归）
  assert.equal(vm.decision.factors.market.value, 0.25, 'M2 的 factors 必须是 Field 形态');
});

t.ok('★ 比例 vs 百分数：price_position(0~1) 与 change_5d(%) 单位不同', () => {
  const raw = LIVE();
  const vm = full(raw);
  // ⚠️ 与 fixture 的实际值逐位比较（实测 0.3032069…，⛔ 不写四舍五入后的近似值）
  assert.equal(val(vm.price.pricePosition), raw.snapshot.price_position);
  assert.ok(raw.snapshot.price_position > 0 && raw.snapshot.price_position <= 1, 'price_position 必须落在 0~1');
  assert.equal(vm.price.pricePositionText.text, '0.30', 'price_position 按比例显示（⛔ 不 ×100）');
  assert.equal(val(vm.price.change5d), raw.snapshot.change_5d);
  assert.equal(vm.price.change5dText.text, '-4.09%', 'change_5d 是百分数，原样加 %');
});

t.ok('★ 点数：scores / opportunity 不加 %（⛔ 也 ⛔ 不显总分）', () => {
  const vm = full(LIVE());
  assert.equal(vm.decision.scoresView.trend.text, '5');
  assert.ok(!vm.decision.scoresView.trend.text.includes('%'));
  assert.ok(vm.decision.opportunity.scoreText.text === '67');
  assert.equal(vm.decision.scoresView.total, undefined, '⛔ 不得暴露总分');
  // M2 形态（Field）必须仍在（⛔ 零回归）
  assert.equal(vm.decision.scores.trend.value, 5, 'M2 的 scores 必须是 Field 形态');
});

t.ok('★ atr20 是**价格**、vol20 是**份**（⛔ 都不是百分比）', () => {
  const vm = full(LIVE());
  assert.equal(vm.price.atr20Text.text, '0.130');
  assert.ok(!vm.price.atr20Text.text.includes('%'));
  assert.ok(vm.price.vol20Text.text.includes(','), 'vol20 应按数量分组显示');
});

/* ==================== ④ 三轴分区（同名不同义） ==================== */

t.ok('★ 建议 ≠ 实际：decision.core_position(0.2) ≠ position.core_position(12.6)', () => {
  const vm = full(LIVE());
  assert.equal(val(vm.decision.suggestedCore), 0.2);
  assert.equal(val(vm.position.realCore), 12.6);
  assert.equal(vm.decision.suggestedCoreText.text, '0.2%');
  assert.equal(vm.position.realCoreText.text, '12.6%');
  assert.notEqual(vm.decision.suggestedCoreText.text, vm.position.realCoreText.text, '⛔ 两者不得同值显示');
  assert.equal(vm.position.kindLabel, '实际（当前持仓）');
  assert.ok(vm.position.kindNote.includes('决策给出的建议值') === false);
});

t.ok('★ 决策带 ≠ 配置带（0.4~0.5 vs 20~30，相差 50×）', () => {
  const vm = full(LIVE());
  assert.equal(vm.decision.targetBand.rangeText, '0.4% ~ 0.5%');
  assert.equal(vm.position.configBand.rangeText, '20.0% ~ 30.0%');
  assert.notEqual(vm.decision.targetBand.rangeText, vm.position.configBand.rangeText);
  assert.ok(vm.position.configBand.kindNote.includes('标准目标带'));
});

/* ==================== ⑤ 风险四变体（中英混合归一） ==================== */

t.ok('risk=normal（英大写）⇒ 绿', () => {
  const vm = adaptEtfDetail(FIXTURES.m4('etf-risk-normal.json'), null, {});
  assert.equal(vm.risk.flagText, '正常');
  assert.equal(vm.risk.tone, 'good');
  assert.equal(vm.risk.hasEvents, false);
});

t.ok('risk=yellow ⇒ 黄 + 事件原因可见', () => {
  const vm = adaptEtfDetail(FIXTURES.m4('etf-risk-yellow.json'), null, {});
  assert.equal(vm.risk.flagText, '暂停加仓');
  assert.equal(vm.risk.tone, 'warn');
  assert.equal(vm.risk.eventCount, 1);
  assert.equal(vm.risk.hasEvents, true);
});

t.ok('risk=red + override ⇒ 红 + 覆盖标记', () => {
  const vm = adaptEtfDetail(FIXTURES.m4('etf-risk-red.json'), null, {});
  assert.equal(vm.risk.flagText, '风险熔断');
  assert.equal(vm.risk.tone, 'risk');
  assert.equal(vm.risk.overrideActive, true);
  assert.equal(vm.risk.overrideText, '是');
});

t.ok('★ risk=中文「正常」⇒ 归一后仍为绿（⛔ 不得因中文掉成 muted）', () => {
  const vm = adaptEtfDetail(FIXTURES.m4('etf-risk-cn.json'), null, {});
  assert.equal(vm.risk.flagText, '正常');
  assert.equal(vm.risk.tone, 'good');
  assert.notEqual(vm.risk.tone, 'muted', '⛔ 中文枚举不得导致语义丢失');
});

t.ok('★ premium_flag 为中文「正常」⇒ 必须归一（⛔ 不假设英文）', () => {
  const vm = full(LIVE());
  assert.equal(val(vm.risk.premiumFlag), '正常', '前置：线上该字段是中文');
  assert.equal(vm.risk.premiumText, '正常');
  assert.equal(vm.risk.premiumTone, 'good');
});

/* ==================== ⑥ Gen-1 三通道 ==================== */

t.ok('★ Gen-1：canonical 在场 ⇒ CANONICAL 通道', () => {
  const vm = adaptEtfDetail(FIXTURES.m4('etf-canonical.json'), null, {});
  assert.equal(vm.gen1Detail.channel, GEN1_CHANNEL.CANONICAL);
  assert.equal(vm.gen1Detail.isCanonical, true);
  assert.equal(vm.gen1Detail.channelTone, 'good');
  assert.equal(vm.gen1Detail.fieldTag, '', 'canonical 不挂 legacy 角标');
});

t.ok('★ Gen-1：legacy 通道 caveat **逐字**等于 owner 给定措辞', () => {
  const vm = full(LIVE());
  assert.equal(
    vm.gen1Detail.channelCaveat,
    '当前页面使用的是现有 legacy 通道数据；它不是 V3.6.5 canonical "system_runtime.gen1" 契约。'
  );
});

t.ok('★ Gen-1：三级全空 ⇒ NONE，「数据未提供」（⛔ 不得显示「正常/无信号/关闭」）', () => {
  const vm = adaptEtfDetail(FIXTURES.m4('etf-gen1-missing.json'), null, {});
  assert.equal(vm.gen1Detail.channel, GEN1_CHANNEL.NONE);
  assert.equal(vm.gen1Detail.available, false);
  // ⚠️ gen1Detail 对外是 **display 形态** ⇒ 断言 .missing / .reason；原 Field 挂在 .field 上
  assert.equal(vm.gen1Detail.authority.missing, true);
  assert.equal(vm.gen1Detail.authority.reason, MISSING_REASON.CONTRACT_NOT_PROVIDED);
  assert.equal(vm.gen1Detail.authority.text, '数据未提供');
  assert.equal(vm.gen1Detail.authority.field.state, FIELD_STATE.UNAVAILABLE);
  assert.equal(vm.gen1Detail.healthStatus.missing, true);
  for (const s of ['正常', '无信号', '关闭']) {
    assert.notEqual(vm.gen1Detail.healthStatus.text, s, '⛔ 不得显示猜测值 ' + s);
  }
});

t.ok('★ Gen-1：legacy 字段名逐字对照（gen1_authority / gen1_model_threshold_p 等）', () => {
  const vm = full(LIVE());
  const g = vm.gen1Detail;
  // ⚠️ display 形态：文本看 `.text`；原始值看 `.field.value`
  assert.equal(g.authority.text, 'CANARY', 'gen1_authority');
  assert.equal(g.authority.field.value, 'CANARY');
  assert.equal(g.signal.threshold.field.value, 0.65, 'gen1_model_threshold_p');
  assert.equal(g.signal.threshold.text, '0.65', '阈值是 0~1 比例，⛔ 不加 %');
  assert.equal(g.healthStatus.text, 'DEGRADED', 'gen1_health_status');
  assert.equal(g.healthGateStatus.text, 'ACTIVE', 'gen1_health_gate_status');
  assert.equal(g.safetyGate.permission.text, 'BLOCK', 'ml_rule_permission');
  assert.equal(g.safetyGate.source.text, 'SAFETY_CORE', 'ml_rule_permission_source');
  assert.equal(g.counterfactual.targetPct.field.value, 0.5, 'gen1_counterfactual_target');
  assert.equal(g.counterfactual.targetPct.text, '0.5%', '★ 反事实目标是仓位百分比（⛔ 组件手拼 % 会在数字与 % 之间留空格）');
  assert.equal(g.dataHealth.sourceTradeDate.text, '2026-09-29', 'ml_shadow.signal_date');
});

t.ok('★ Gen-1：三段 stage 不串位（signal=S1 / baseline=S0 / effective=S0）', () => {
  const vm = full(LIVE());
  const g = vm.gen1Detail;
  assert.equal(g.stages.signal.text, 'S1');
  assert.equal(g.stages.baseline.text, 'S0');
  assert.equal(g.stages.effective.text, 'S0');
  assert.equal(g.signal.stage.text, g.stages.signal.text, 'signal 槽与 signal.stage 应同源');
});

t.ok('★ Gen-1：notConsumed 诚实登记未消费键（⛔ 不是"漏了"）', () => {
  const vm = full(LIVE());
  assert.ok(vm.gen1Detail.notConsumed.length > 0, '应登记未消费的 legacy 键');
  assert.ok(vm.gen1Detail.notConsumed.includes('gen1_candidate_hash'));
  assert.ok(vm.gen1Detail.notConsumed.includes('bundle_id'));
});

t.ok('★ Gen-1：反事实声明必须存在（防误读为「Gen-1 决定了目标」）', () => {
  const vm = full(LIVE());
  assert.ok(vm.gen1Detail.counterfactualNote.includes('不改变正式目标'));
  assert.equal(vm.gen1Detail.counterfactual.targetPct.field.value, val(vm.decision.finalTarget),
    '前置：两者数值相同（0.5）⇒ 正是需要声明的原因');
});

/* ==================== ⑦ K 线（★ 与决策新鲜度独立） ==================== */

t.ok('★ kline-live60：K 线 STALE 且严重滞后，决策仍 FRESH（两者独立）', () => {
  const vm = full(LIVE());
  assert.equal(vm.kline.count, 60);
  assert.equal(vm.kline.lastBarDate, '2024-08-27');
  assert.equal(vm.kline.freshness.level, 'STALE');
  assert.equal(vm.kline.isSeverelyStale, true);
  assert.ok(vm.kline.staleDays > 700, '滞后天数应以年计，实际 ' + vm.kline.staleDays);
  assert.equal(vm.freshness.decision.level, 'FRESH');
  assert.notEqual(vm.kline.freshness.level, vm.freshness.decision.level,
    '★ K 线 stale ⛔ 不得扩散成 decision stale');
  assert.equal(vm.kline.decisionFreshnessIndependent, true);
});

t.ok('★ K 线 banner：日期**来自实际数据**（⛔ 不硬编码）', () => {
  const vm = full(LIVE());
  assert.equal(vm.kline.banner.show, true);
  assert.equal(vm.kline.banner.title, 'K 线数据已明显滞后');
  assert.equal(vm.kline.banner.text, '当前 K 线截至 2024-08-27，早于当前决策日 2026-09-29。');
  // 反向：换一份数据，文案必须跟着变
  const other = full(LIVE(), { klineRaw: [] });
  assert.equal(other.kline.banner.show, false, '无 K 线时不得显示滞后 banner');
});

t.ok('★ K 线：陈旧也**保留全部历史数据**（⛔ 不裁、⛔ 不插值）', () => {
  const vm = full(LIVE());
  const raw = K60();
  assert.equal(vm.kline.bars.length, raw.length, '必须逐根保留，⛔ 不得裁剪');
  assert.equal(vm.kline.bars[0].date, raw[0].date);
  assert.ok(vm.kline.keepNote.includes('照常保留'));
});

t.ok('★ K 线三态互斥：空（合法 0 根）≠ 缺失 ≠ 读取失败', () => {
  const empty = full(LIVE(), { klineRaw: [] });
  assert.equal(empty.kline.state, FIELD_STATE.PROVIDED);
  assert.equal(empty.kline.available, true);
  assert.equal(empty.kline.count, 0, '空数组是合法值（0 根）');
  assert.equal(empty.kline.isSeverelyStale, false, '无数据 ⇒ 不得报「滞后」');
  assert.equal(empty.kline.banner.show, false);

  const bad = full(LIVE(), { klineRaw: FIXTURES.m4('kline-error.json') });
  assert.equal(bad.kline.state, FIELD_STATE.MISSING, '对象而非数组 ⇒ 显式缺失');
  assert.equal(bad.kline.available, false);
  assert.notEqual(bad.kline.state, FIELD_STATE.PROVIDED, '⛔ 不得与「空」混同');

  const failed = full(LIVE(), { klineRaw: null, klineError: 'boom' });
  assert.equal(failed.kline.state, FIELD_STATE.ERROR, '请求失败 ⇒ ERROR');
  assert.equal(failed.kline.statusLabel, '读取失败');
  assert.notEqual(failed.kline.statusLabel, '数据新鲜');

  const notRequested = adaptEtfDetail(LIVE(), null, {});
  assert.equal(notRequested.kline.state, FIELD_STATE.UNAVAILABLE, '未请求 ⇒ UNAVAILABLE');
  assert.equal(notRequested.kline.statusLabel, '未提供');
});

/* ==================== ⑧ 决策链定性（M4-D3） ==================== */

t.ok('★ 决策链：定性模式，⛔ 输出中不得出现定量数字', () => {
  const vm = full(LIVE());
  const c = vm.decision.chain;
  assert.equal(c.mode, 'QUALITATIVE_ONLY');
  assert.equal(c.available, true);
  assert.equal(c.total, 13);
  assert.ok(c.hiddenCount >= 7, '实测 7 步含定量，实际 ' + c.hiddenCount);
  for (const s of c.steps) {
    if (s.conditionDisplay) {
      assert.ok(!/\d+\.\d/.test(s.conditionDisplay), '条件不得含小数定量: ' + s.conditionDisplay);
      assert.ok(!/\d+\s*%/.test(s.conditionDisplay), '条件不得含百分数: ' + s.conditionDisplay);
    }
    if (s.resultDisplay) {
      assert.ok(!/\d+\.\d/.test(s.resultDisplay), '结果不得含小数定量: ' + s.resultDisplay);
      assert.ok(!/\d+\s*%/.test(s.resultDisplay), '结果不得含百分数: ' + s.resultDisplay);
    }
  }
});

t.ok('★ 决策链：与正式字段冲突的三个数字**都不得出现**（-7.8 / 21% / 12.6%）', () => {
  const vm = full(LIVE());
  const rendered = vm.decision.chain.steps
    .map((s) => [s.conditionDisplay, s.resultDisplay].filter(Boolean).join(' '))
    .join(' | ');
  for (const bad of ['-7.8', '21%', '12.6%', '18~24']) {
    assert.ok(!rendered.includes(bad), '⛔ 渲染串不得含冲突数字 ' + bad + '（实际：' + rendered + '）');
  }
  assert.ok(vm.decision.chainHiddenSummary.includes('已隐藏'), '必须给隐藏条数说明');
});

t.ok('决策链：非数组 ⇒ 显式不可用（⛔ 不抛异常）', () => {
  const vm = adaptEtfDetail(FIXTURES.m4('etf-malformed.json'), null, {});
  assert.equal(vm.decision.chain.available, false);
  assert.equal(vm.decision.chain.steps.length, 0);
});

/* ==================== ⑨ 缺失 / 畸形（不抛异常） ==================== */

t.ok('decision-missing：整块显式缺失，页面仍可用', () => {
  const vm = full(FIXTURES.m4('etf-decision-missing.json'));
  assert.equal(vm.available, true, '页面本身仍可用（有 identity / snapshot）');
  assert.equal(vm.decision.available, false);
  assert.equal(vm.decision.reason, MISSING_REASON.CONTRACT_NOT_PROVIDED);
  assert.equal(vm.decision.finalTargetText.missing, true);
  assert.ok(vm.missingItems.length > 0, '必须集中登记缺失');
});

t.ok('malformed：⛔ 不抛异常；脏字段降级为显式状态或原值', () => {
  let vm;
  assert.doesNotThrow(() => { vm = adaptEtfDetail(FIXTURES.m4('etf-malformed.json'), null, { klineRaw: null }); });
  assert.ok(vm.available);
  // snapshot 是字符串 ⇒ 结构块不可用（⛔ 不得解析成字段）
  assert.equal(vm.structure.available, false, 'snapshot 非对象 ⇒ 结构块不可用');
  // decision_date 是数字 ⇒ 原值透传，⛔ 不得变成 NaN
  assert.ok(!String(JSON.stringify(vm.decision.dateText)).includes('NaN'));
  // position 是数组 ⇒ 字段取不到（⚠️ M2 语义：数组算「对象存在」，故断言字段而非 available）
  assert.notEqual(vm.position.currentPosition.state, FIELD_STATE.PROVIDED, 'position 为数组 ⇒ 当前仓位取不到');
  assert.equal(vm.position.currentPositionText.missing, true);
  // explain_chain 非数组 ⇒ 链不可用
  assert.equal(vm.decision.chain.available, false);
});

t.ok('stale：决策与快照都过期 ⇒ freshness=STALE（文案与「无时间戳」不同）', () => {
  const vm = adaptEtfDetail(FIXTURES.m4('etf-stale.json'), null, { klineRaw: [] });
  assert.equal(vm.freshness.decision.level, 'STALE');
  assert.equal(vm.freshness.snapshot.level, 'STALE');
  assert.notEqual(vm.freshness.decision.text, '无时间戳');
  assert.ok(vm.freshness.decision.text.includes('过期'));
});

t.ok('空输入 / null / 非对象：不抛异常且 available=false', () => {
  for (const bad of [null, undefined, 42, 'x', []]) {
    let vm;
    assert.doesNotThrow(() => { vm = adaptEtfDetail(bad, null, {}); });
    assert.equal(vm.available, false, '输入 ' + JSON.stringify(bad) + ' 应不可用');
  }
});

/* ==================== ⑩ provenance / 边界 ==================== */

t.ok('provenance：取数时刻由外部注入（⛔ 适配器不自造时间）', () => {
  const a = adaptEtfDetail(LIVE(), null, {});
  assert.equal(a.provenance.retrievedAt, null, '未注入 ⇒ null，⛔ 不得自造');
  const b = full(LIVE());
  assert.equal(b.provenance.retrievedAt, REAL);
  // ⚠️ formatDateTime 走**本地时区** ⇒ 不断言具体日子，只断言格式合法（⛔ 也不得出现 NaN）
  assert.ok(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(b.provenance.retrievedAtText),
    '取数时刻应渲染为「日期 时间」，实际：' + b.provenance.retrievedAtText);
  assert.ok(!b.provenance.retrievedAtText.includes('NaN'));
});

t.ok('boundaries：三方身份与仓位种类说明齐备（⛔ 组件不硬编码文案）', () => {
  const vm = full(LIVE());
  const b = vm.boundaries;
  assert.ok(b.safetyCoreIdentity.includes('V3 Safety Core'));
  assert.equal(b.gen1Identity, 'GEN-1 · TIMING / ADVISORY');
  assert.ok(b.gen2Identity.includes('SELECTION'));
  assert.ok(b.gen1Note.includes('最终动作由 V3 Safety Core 决定'));
  assert.ok(b.chainNote.includes('qualitative') === false && b.chainNote.includes('定性'));
  for (const k of ['suggested', 'actual', 'target', 'config']) {
    assert.ok(b.positionKinds[k], '缺仓位种类标签: ' + k);
    assert.ok(b.positionKindNotes[k], '缺仓位种类说明: ' + k);
  }
});

t.ok('gen1Detail 直调：三通道判定与 VM 一致', () => {
  assert.equal(adaptGen1ForDetail(FIXTURES.m4('etf-canonical.json'), null).channel, GEN1_CHANNEL.CANONICAL);
  assert.equal(adaptGen1ForDetail(LIVE(), null).channel, GEN1_CHANNEL.DECISION_LEGACY);
  assert.equal(adaptGen1ForDetail(FIXTURES.m4('etf-gen1-missing.json'), null).channel, GEN1_CHANNEL.NONE);
  assert.equal(adaptGen1ForDetail(null, null).channel, GEN1_CHANNEL.NONE);
});

t.done();
