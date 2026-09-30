/**
 * 历史决策变化 + 情报/基本面适配器测试（M4-P1 第二阶段）
 *
 * 覆盖 owner 指定的测试矩阵中属本文件的部分：
 *   history-present · history-changes · history-empty · history-missing · history-error
 *   fundamental-present · fundamental-missing（detail 缺失）
 *
 * ★★ 本文件的核心是「不伪造历史」：四种状态（未请求 / 读取失败 / 空 / 畸形）的文案必须**两两不同**，
 *   且 ⛔ 任何一种都不得从「当前 decision」拼出一条假历史。
 */
import { adaptEtfDetail } from '../../src/rewrite/adapters/etfDetail.js';
import { adaptDecisionHistory } from '../../src/rewrite/adapters/decisionHistory.js';
import { adaptIntelligence } from '../../src/rewrite/adapters/intelligence.js';
import { FIELD_STATE, MISSING_REASON } from '../../src/rewrite/domain/enums.js';
import { FIXTURES, suite, assert } from './_fixtures.js';

const t = suite('etf-history-intel.test');

const M4 = (n) => FIXTURES.m4(n);
const vmOf = (data, raw, extra = {}) => adaptEtfDetail(data, null, { decisionsRaw: raw, ...extra });

/* ==================== ① 历史：五种状态 ==================== */

t.ok('history-present：6 条真实记录逐条可读', () => {
  const h = vmOf(M4('etf-normal.json'), M4('decisions-normal.json')).decisionHistory;
  assert.equal(h.state, FIELD_STATE.PROVIDED);
  assert.equal(h.available, true);
  assert.equal(h.count, 6);
  assert.equal(h.newestDate, '2026-09-29');
  assert.equal(h.oldestDate, '2026-09-22');
  const r0 = h.items[0];
  assert.equal(r0.dateText, '2026-09-29');
  assert.equal(r0.actionText, '战略减仓');
  assert.equal(r0.finalTargetText.text, '0.5%');
  assert.equal(r0.riskText, '正常');
  assert.equal(r0.defenseLevelText, '轻度防守');
  assert.equal(r0.defenseScoreText.text, '37');
});

t.ok('history-present：★ 全部数值来自**后端历史记录**（与我构造的当前决策不同）', () => {
  const data = JSON.parse(JSON.stringify(M4('etf-normal.json')));
  data.decision.final_target = 30;      // 人为改「当前决策」
  data.decision.final_action = 'ADD';
  const h = vmOf(data, M4('decisions-normal.json')).decisionHistory;
  assert.equal(h.items[0].finalTargetText.text, '0.5%', '⛔ 历史首条必须是记录原值，⛔ 不受当前决策改动影响');
  assert.equal(h.items[0].actionText, '战略减仓', '⛔ 历史动作不得被当前动作污染');
});

t.ok('★ history-changes：检出对比变化（动作 / 风险 / 目标），⛔ 不推断原因', () => {
  const h = vmOf(M4('etf-normal.json'), M4('decisions-changes.json')).decisionHistory;
  assert.equal(h.available, true);
  const kinds = new Set(h.changes.map((c) => c.kind));
  assert.ok(kinds.has('action'), '应检出动作变化');
  assert.ok(kinds.has('risk'), '应检出风险变化');
  assert.ok(kinds.has('target'), '应检出目标变化');
  for (const c of h.changes) {
    assert.ok(c.label && c.from !== undefined && c.to !== undefined, '变化项必须有 label/from/to');
    assert.ok(!/原因|因为|由于/.test(JSON.stringify(c)), '⛔ 不得推断变化原因');
  }
  assert.ok(h.changeNote.includes('不推断原因'), '必须声明不推断原因');
});

t.ok('history-normal：变化条目按「较新日期」归属', () => {
  const h = vmOf(M4('etf-normal.json'), M4('decisions-normal.json')).decisionHistory;
  // 实测 target 序列（新→旧）：0.5, 0.5, 0.5, 0, 1.5, 7.5
  const targetChanges = h.changes.filter((c) => c.kind === 'target');
  assert.equal(targetChanges.length, 3);
  assert.equal(targetChanges[0].date, '2026-09-25');
  assert.equal(targetChanges[0].from, '0.0%');
  assert.equal(targetChanges[0].to, '0.5%');
});

t.ok('★★ history 五态文案**两两不同**（未请求 / 读取失败 / 空 / 畸形 / 有数据）', () => {
  const sub = (raw) => vmOf(M4('etf-normal.json'), raw).decisionHistory;
  const notRequested = sub(undefined);
  const failed = sub(null);
  const empty = sub([]);
  const malformed = sub(M4('decisions-error.json'));
  const normal = sub(M4('decisions-normal.json'));

  assert.equal(notRequested.state, FIELD_STATE.UNAVAILABLE);
  assert.equal(failed.state, FIELD_STATE.ERROR);
  assert.equal(empty.state, FIELD_STATE.PROVIDED);
  assert.equal(empty.count, 0);
  assert.equal(malformed.state, FIELD_STATE.MISSING);

  const texts = [notRequested.text, failed.text, empty.text, malformed.text];
  assert.equal(new Set(texts).size, 4, '四种状态文案必须互不相同，实际：' + JSON.stringify(texts));
  assert.ok(notRequested.text.includes('数据未提供'));
  assert.ok(failed.text.includes('读取失败'));
  assert.ok(empty.text.includes('为空'));
  assert.equal(normal.text, '', '有数据时不得有任何占位文案');
});

t.ok('★★ 禁止：任何一种"无历史"状态都**不得**出现伪造的历史条目', () => {
  for (const raw of [undefined, null, [], M4('decisions-error.json')]) {
    const h = vmOf(M4('etf-normal.json'), raw).decisionHistory;
    assert.equal(h.count, 0, '无历史时 count 必须为 0');
    assert.equal(h.items.length, 0, '⛔ 不得用当前字段拼一条假历史');
    assert.equal(h.changes.length, 0, '⛔ 不得凭空产生变化点');
    // 即便当前决策有 action/target，也不得出现在历史里
    const json = JSON.stringify(h.items) + JSON.stringify(h.changes);
    assert.equal(json, '[][][]'.slice(0, 4), '历史容器必须为空');
  }
});

t.ok('★ 禁止：无历史时必须显示「不伪造」说明（UNAVAILABLE / MISSING 场景）', () => {
  const h = vmOf(M4('etf-normal.json'), undefined).decisionHistory;
  assert.ok(h.note.includes('不会用当前决策字段拼装历史'), '必须显式声明不伪造');
});

t.ok('history-error：非数组 ⇒ 显式缺失且不抛异常', () => {
  let h;
  assert.doesNotThrow(() => { h = adaptDecisionHistory({ not: 'an array' }); });
  assert.equal(h.state, FIELD_STATE.MISSING);
  assert.equal(h.available, false);
  assert.equal(h.reason, MISSING_REASON.FIELD_ABSENT);
});

t.ok('history：乱序 / 缺日期的行被过滤并重新排序（desc）', () => {
  const rows = [
    { decision_date: '2026-09-20', final_action: 'HOLD', final_target: 1 },
    { decision_date: null, final_action: 'HOLD' },
    { decision_date: '2026-09-25', final_action: 'ADD', final_target: 5 },
    { not: 'a row' }
  ];
  const h = adaptDecisionHistory(rows);
  assert.equal(h.count, 2, '无日期与非对象行应被过滤');
  assert.equal(h.items[0].dateText, '2026-09-25', '必须按日期倒序');
  assert.equal(h.items[1].dateText, '2026-09-20');
});

t.ok('history：action_label 优先用后端中文（⛔ 不自行译）', () => {
  const h = adaptDecisionHistory([{ decision_date: '2026-09-29', final_action: 'HOLD', action_label: '后端自定义标签' }]);
  assert.equal(h.items[0].actionText, '后端自定义标签');
  const h2 = adaptDecisionHistory([{ decision_date: '2026-09-29', final_action: 'HOLD' }]);
  assert.equal(h2.items[0].actionText, '持有', '无后端标签时用前端字典兜底');
});

/* ==================== ② 情报 / 基本面 ==================== */

t.ok('fundamental-present：状态 / 评分 / 分层明细 / 综合信号可读', () => {
  const it = vmOf(M4('etf-normal.json'), []).intelligence;
  assert.equal(it.available, true);
  assert.equal(it.fundamental.fStateText, '稳定');
  assert.equal(it.fundamental.fScoreText.text, '20');
  assert.equal(it.layers.available, true);
  assert.equal(it.layers.items.length, 2);
  const hard = it.layers.items.find((x) => x.key === 'hard_data');
  assert.equal(hard.label, '硬数据');
  assert.equal(hard.count, 3);
  assert.equal(hard.signalText, '0.75');
  assert.equal(hard.weightText, '50');
  assert.equal(it.detail.finalSignalText, '0.73');
  assert.equal(it.layers.totalLayerWeight, 80);
});

t.ok('★ 量纲：分层 signal / weight 只展示**后端原始值**（⛔ 不加 %）', () => {
  const it = vmOf(M4('etf-normal.json'), []).intelligence;
  for (const l of it.layers.items) {
    assert.ok(!String(l.signalText).includes('%'), '信号值不得带 %');
    assert.ok(!String(l.weightText).includes('%'), '权重不得带 %');
  }
  assert.equal(it.detail.signalNote, '后端原始信号值（本页不解释其量纲）');
  assert.ok(it.layers.items[0].weightNote.includes('不是百分比'));
});

t.ok('fundamental-minimal：`detail` 缺失 ⇒ 分层显式缺失，但 f_state / f_score 仍可读', () => {
  const it = vmOf(M4('etf-fundamental-minimal.json'), []).intelligence;
  assert.equal(it.available, true);
  assert.equal(it.fundamental.fStateText, '稳定');
  assert.equal(it.fundamental.fScoreText.text, '20');
  assert.equal(it.layers.available, false);
  assert.equal(it.layers.items.length, 0);
  assert.ok(it.layers.note.includes('未提供'));
  assert.equal(it.detail.available, false);
  assert.equal(it.detail.finalSignalText, null);
});

t.ok('fundamental-missing：整块「数据未提供」', () => {
  const it = vmOf(M4('etf-decision-missing.json'), []).intelligence;
  // decision-missing 场景仍带 fundamental ⇒ 应可用；用 malformed 测整块缺失
  const it2 = vmOf(M4('etf-malformed.json'), []).intelligence;
  assert.equal(it2.available, false);
  assert.equal(it2.fundamental.fStateText, '数据未提供');
  assert.equal(it2.layers.available, false);
  assert.ok(it.available !== undefined);
});

t.ok('★ 情报不消费 fundamental_config / series（只登记）', () => {
  const it = vmOf(M4('etf-normal.json'), []).intelligence;
  assert.deepEqual([...it.notConsumed], ['基本面分层配置', '基本面序列', '前十大重仓']);
  const json = JSON.stringify(it);
  assert.ok(!json.includes('fundamental_config'), '⛔ 不得出现后端块名');
  assert.ok(!json.includes('fundamental_series'));
});

t.ok('★ 情报与防守共用同一风险事件对象（⛔ 不重复计算、不出现分歧）', () => {
  const vm = vmOf(M4('etf-normal.json'), []);
  assert.equal(vm.intelligence.riskEvents, vm.defense.events, '必须是同一对象引用');
  const vm2 = vmOf(M4('etf-risk-events-present.json'), []);
  assert.equal(vm2.intelligence.riskEvents.count, 1);
  assert.equal(vm2.intelligence.riskEvents, vm2.defense.events);
});

t.ok('adaptIntelligence 可独立调用且不抛异常', () => {
  assert.doesNotThrow(() => adaptIntelligence(null, { state: FIELD_STATE.PROVIDED, value: [] }));
  assert.doesNotThrow(() => adaptIntelligence({ code: 'x' }, null));
  assert.equal(adaptIntelligence(null, null).available, false);
});

t.done();
