/**
 * 机会雷达 + 防守雷达适配器测试（M4-P1 第二阶段）
 *
 * 覆盖 owner 指定的测试矩阵中属本文件的部分：
 *   opportunity-present / opportunity-missing
 *   defense-present（level>0）· defense-inactive（level=0，无 score/factor）· defense-missing
 *   risk-events-present · risk-events-empty
 *
 * ★ 量纲专项（本文件重点）：score=分数 / factor=系数 / level=档位 三者**不得混用**。
 * ★ 禁止项专项：⛔ 不得因 position_gap>0 推导「建议加仓」；⛔ `[]` 不得说成「没有风险」。
 */
import { adaptEtfDetail } from '../../src/rewrite/adapters/etfDetail.js';
import { adaptDecision } from '../../src/rewrite/adapters/decision.js';
import { adaptDefense } from '../../src/rewrite/adapters/defense.js';
import { adaptOpportunity } from '../../src/rewrite/adapters/opportunity.js';
import { FIELD_STATE, MISSING_REASON } from '../../src/rewrite/domain/enums.js';
import { FIXTURES, suite, assert, assertState } from './_fixtures.js';

const t = suite('etf-radar.test');

const M4 = (n) => FIXTURES.m4(n);
const val = (f) => (f && (f.state === FIELD_STATE.PROVIDED || f.state === FIELD_STATE.STALE) ? f.value : null);
const vmOf = (data, opts = {}) => adaptEtfDetail(data, null, { decisionsRaw: M4('decisions-normal.json'), ...opts });

/* ==================== ① 机会 / 辅助信号 ==================== */

t.ok('opportunity-present：机会分 / 等级 / 系数 / 加仓模式全部可读', () => {
  const o = vmOf(M4('etf-normal.json')).opportunity;
  assert.equal(o.available, true);
  assert.equal(val(o.score), 67);
  assert.equal(o.scoreText.text, '67');
  assert.equal(o.gradeText, 'B');
  assert.equal(o.levelText, '积极');
  assert.equal(val(o.factor), 0.7);
  assert.equal(o.factorText.text, '0.70');
  assert.equal(o.addModeText, '无');
});

t.ok('★ 量纲：机会分是**点数**（⛔ 不加 %）、机会系数是**系数**（⛔ 不是百分比）', () => {
  const o = vmOf(M4('etf-normal.json')).opportunity;
  assert.ok(!o.scoreText.text.includes('%'), '机会分不得带 %');
  assert.ok(!o.factorText.text.includes('%'), '机会系数不得带 %');
  assert.notEqual(o.factorText.text, '70%', '⚠️ 0.7 是系数，⛔ 绝不显示为 70%');
  assert.equal(o.scoreNote, '分数（⛔ 不加 %）');
  assert.equal(o.factorNote, '系数（⛔ 不是百分比）');
});

t.ok('★ 加仓资格为 **10 项** + overall，每项带后端判定的状态文案', () => {
  const o = vmOf(M4('etf-normal.json')).opportunity;
  assert.equal(o.eligibility.available, true);
  assert.equal(o.eligibility.items.length, 10, '必须 10 项（含 cooldown / regime）');
  assert.equal(o.eligibility.overallText, '暂停');
  assert.ok(o.eligibility.blockedCount >= 1, '实测 trend/structure/regime 为 pause');
  const byKey = Object.fromEntries(o.eligibility.items.map((i) => [i.key, i]));
  assert.equal(byKey.trend.value, 'pause');
  assert.equal(byKey.trend.statusText, '暂停');
  assert.equal(byKey.trend.tone, 'warn');
  assert.equal(byKey.volume.value, 'ok');
  assert.equal(byKey.volume.statusText, '通过');
});

t.ok('opportunity-missing：整族显式缺失，⛔ 不得显示 0 分', () => {
  const o = vmOf(M4('etf-opportunity-missing.json')).opportunity;
  assert.equal(o.available, false);
  assert.equal(o.scoreText.missing, true);
  /**
   * ⚠️ SPEC §9 状态机：这里是**字段级**缺失（键被删）⇒ `MISSING/字段缺失`；
   *    「整块未下发」才是 `UNAVAILABLE/数据未提供`。两者都合法，但都 ⛔ 不得是 `0`。
   */
  assert.ok(['字段缺失', '数据未提供'].includes(o.scoreText.text), '必须是显式缺失文案，实际 ' + o.scoreText.text);
  assert.notEqual(o.scoreText.text, '0', '⛔ 缺失不得显示 0');
  assert.equal(o.addModeText, '字段缺失');
  assert.equal(o.eligibility.available, false);
  assert.equal(o.eligibility.overallText, '数据未提供');
});

t.ok('★ 禁止：⛔ 不得因 position_gap > 0 推导「建议加仓」', () => {
  // 构造一个 gap > 0 的文档
  const data = JSON.parse(JSON.stringify(M4('etf-normal.json')));
  data.decision.position_gap = 12.5;
  const vm = vmOf(data);
  assert.equal(val(vm.opportunity.gap), 12.5, '缺口原样透传（服务端值）');
  assert.equal(vm.opportunity.gapText.text, '+12.5%');
  // ⛔ 除「不推导」说明句外，⛔ 不得出现任何"建议/应该加仓"式措辞
  assert.ok(vm.opportunity.noDeriveNote.includes('不会因为'), '必须显式声明不推导');
  const stripped = JSON.stringify({ ...vm.opportunity, noDeriveNote: '', sectionNote: '' });
  assert.ok(!stripped.includes('建议加仓'), '⛔ 不得出现「建议加仓」');
  assert.ok(!stripped.includes('应该加仓'), '⛔ 不得出现「应该加仓」');
  // 机会等级不受 gap 影响（仍是后端下发的 B）
  assert.equal(vm.opportunity.gradeText, 'B', '机会等级必须来自后端，⛔ 不受前端所见 gap 影响');
});

/* ==================== ② 防守雷达 ==================== */

t.ok('defense-present：level / reason / score / factor 全部来自后端', () => {
  const d = vmOf(M4('etf-normal.json')).defense;
  assert.equal(d.available, true);
  assert.equal(d.active, true);
  assert.equal(d.levelNumber, 1);
  assert.equal(d.levelLabel, '轻度防守');
  assert.equal(d.reasonText, '趋势破坏');
  assert.equal(val(d.score), 37);
  assert.equal(val(d.factor), 0.95);
  assert.equal(d.crossCheck.scoreConsistent, true);
  assert.equal(d.crossCheck.factorConsistent, true);
  assert.equal(d.crossCheck.inconsistent, false);
});

t.ok('★★ 量纲：`defense_score=37` 是**分数**（⛔ 不加 %）、`defense_penalty=0.95` 是**系数**（⛔ 不是 95%）', () => {
  const d = vmOf(M4('etf-normal.json')).defense;
  assert.equal(d.scoreText.text, '37');
  assert.ok(!d.scoreText.text.includes('%'), '分数不得带 %');
  assert.equal(d.factorText.text, '0.95');
  assert.ok(!d.factorText.text.includes('%'), '系数不得带 %');
  assert.notEqual(d.factorText.text, '95%', '⚠️ 0.95 是系数，⛔ 绝不显示为 95%');
  assert.ok(d.scoreNote.includes('分数'), '分数必须有量纲说明');
  assert.ok(d.factorNote.includes('系数'), '系数必须有量纲说明');
});

t.ok('★ 量纲：`defense_state.level=1` 是**数字档位**，⛔ 前端不得自行分档', () => {
  const d = vmOf(M4('etf-normal.json')).defense;
  assert.equal(d.levelNumber, 1);
  assert.equal(d.levelLabel, '轻度防守', '中文映射由 domain/labels 提供');
  assert.equal(d.levelTone, 'warn');
  assert.equal(d.levelNumber === 1 && d.levelLabel !== '1', true, '⛔ 不得把数字直接当标签');
  assert.ok(d.readonlyNote.includes('⛔'), '必须声明只读、不重算');
});

t.ok('defense-inactive：level=0 且**无** score/factor ⇒ 显式缺失（⛔ 不补 0、⛔ 不显示 1.00）', () => {
  const d = vmOf(M4('etf-defense-inactive.json')).defense;
  assert.equal(d.available, true, 'defense_state 存在 ⇒ 可读');
  assert.equal(d.levelNumber, 0);
  assert.equal(d.levelLabel, '无防守信号');
  assert.equal(d.active, false, 'level=0 ⇒ 未激活');
  assert.equal(d.reasonText, '无防守信号');
  assert.equal(d.scoreText.missing, true, 'score 必须显式缺失');
  // ⚠️ `level=0` 时后端**没有** score 键 ⇒ FIELD_ABSENT（「字段缺失」），⛔ 不得是 0
  assert.ok(['字段缺失', '数据未提供'].includes(d.scoreText.text), '实际 ' + d.scoreText.text);
  assert.notEqual(d.scoreText.text, '0', '⛔ 不得补 0');
  assert.equal(d.factorText.missing, true, 'factor 必须显式缺失');
  assert.notEqual(d.factorText.text, '1.00', '⛔ 不得补 1.00');
  assert.equal(d.levelTone, 'good');
});

t.ok('defense-missing：整族「数据未提供」，⛔ 前端不得自行重算防守等级', () => {
  const d = vmOf(M4('etf-defense-missing.json')).defense;
  assert.equal(d.available, false);
  assert.equal(d.active, null, '⛔ 不得凭 W 态推断"有防守"');
  assert.equal(d.levelLabel, '数据未提供');
  assert.equal(d.scoreText.missing, true);
  const json = JSON.stringify(d);
  assert.ok(!/自行推算|按周线重算/.test(json.replace(d.readonlyNote, '')), '⛔ 不得出现重算痕迹');
});

t.ok('★ 交叉核对：顶层 defense_score/penalty 与 state 内不一致时**登记警示**（⛔ 不静默选边）', () => {
  const data = JSON.parse(JSON.stringify(M4('etf-normal.json')));
  data.decision.defense_score = 99; // 与 defense_state.score=37 冲突
  const d = vmOf(data).defense;
  assert.equal(d.crossCheck.scoreConsistent, false);
  assert.equal(d.crossCheck.inconsistent, true);
  assert.ok(d.crossCheck.note.includes('不一致'), '必须给出不一致警示');
  assert.equal(d.scoreText.text, '37', '⛔ 仍以 defense_state 为准，不用顶层值覆盖');
});

t.ok('★ 禁止：防守区不得出现任何前端 heuristic 痕迹', () => {
  const d = vmOf(M4('etf-normal.json')).defense;
  const json = JSON.stringify(d);
  assert.ok(!json.includes('high_volume'), '⛔ 不得读放量字段自行分档');
  assert.ok(!json.includes('wState'), '⛔ 不得读 W 态自行分档');
});

/* ==================== ③ 风险事件（★ 空数组语义） ==================== */

t.ok('★ risk-events-empty：`[]` ⇒ 「当前没有返回风险事件数据」，⛔ 不得说「没有风险」', () => {
  const d = vmOf(M4('etf-normal.json')).defense;
  assert.equal(d.events.state, FIELD_STATE.PROVIDED);
  assert.equal(d.events.available, true);
  assert.equal(d.events.count, 0);
  assert.equal(d.events.isEmpty, true);
  assert.equal(d.events.emptyText, '当前没有返回风险事件数据。');
  assert.ok(d.events.emptyNote.includes('不等于'), '必须显式声明 ≠ 没有风险');
  assert.ok(!d.events.emptyText.includes('没有风险'), '⛔ 不得出现「没有风险」');
});

t.ok('risk-events-present：事件可读（原因 / 状态 / 时间）', () => {
  const d = vmOf(M4('etf-risk-events-present.json')).defense;
  assert.equal(d.events.count, 1);
  assert.equal(d.events.isEmpty, false);
  assert.equal(d.events.emptyText, '', '有事件时不得有"无事件"文案');
  const e = d.events.items[0];
  assert.equal(e.reasonText, '手工登记：测试用风险事件');
  assert.equal(e.statusText, '生效中');
  assert.equal(e.triggerTimeText, '2026-09-30T09:00:00.000Z');
});

t.ok('风险事件：**字段缺失**与**空数组**文案不同', () => {
  // ⚠️ 不能用 decision-missing 场景（它只删 decision，`risk_events` 仍是合法 `[]`）
  const d = vmOf(M4('etf-malformed.json')).defense;
  assert.notEqual(d.events.state, FIELD_STATE.PROVIDED, 'risk_events 非数组 ⇒ 必须显式缺失');
  assert.equal(d.events.isEmpty, false, '缺失 ≠ 空');
  assert.equal(d.events.emptyText, '', '缺失时不得套用"无事件"文案');
});

/* ==================== ④ 防守区与风险区的独立取值 ==================== */

t.ok('风险旗标 / 超配 / 溢价与防守等级**各自独立**（⛔ 不互相推导）', () => {
  const vm = vmOf(M4('etf-normal.json'));
  assert.equal(vm.defense.riskLabel, '正常');
  assert.equal(vm.defense.riskTone, 'good');
  assert.equal(vm.defense.overAllocText, '中度');
  assert.equal(vm.defense.premiumText, '正常');
  assert.equal(vm.defense.levelNumber, 1, '风险"正常"的同时防守 level=1 ⇒ 两者不是一回事');
});

t.ok('adaptDefense / adaptOpportunity 可独立调用（不依赖 etfDetail）', () => {
  const dec = adaptDecision(M4('etf-normal.json').decision);
  const d = adaptDefense(dec, { state: FIELD_STATE.PROVIDED, value: [] }, null);
  assert.equal(d.levelNumber, 1);
  const o = adaptOpportunity(dec);
  assert.equal(o.gradeText, 'B');
  // 不可用 decision ⇒ 不抛异常且全显式缺失
  const dec2 = adaptDecision(null);
  assert.doesNotThrow(() => adaptDefense(dec2, null, null));
  assert.doesNotThrow(() => adaptOpportunity(dec2));
  assert.equal(adaptOpportunity(dec2).available, false);
  assert.equal(adaptDefense(dec2, null, null).available, false);
});

t.done();
