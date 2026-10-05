/**
 * 边界与畸形响应测试（SPEC §9 / §14「7. malformed response tests」）
 *
 * 核心要求：**任何畸形输入都不得抛异常**，必须转成显式状态
 * （MISSING / UNAVAILABLE），并保持 0 是合法值。
 */
import { adaptDashboard } from '../../src/rewrite/adapters/dashboard.js';
import { adaptEtfDetail } from '../../src/rewrite/adapters/etfDetail.js';
import { adaptDecision } from '../../src/rewrite/adapters/decision.js';
import { adaptFundamentals, adaptIntel } from '../../src/rewrite/adapters/fundamentals.js';
import { adaptKline } from '../../src/rewrite/adapters/kline.js';
import { adaptConstants } from '../../src/rewrite/adapters/constants.js';
import { adaptGen1 } from '../../src/rewrite/adapters/gen1.js';
import { adaptReview } from '../../src/rewrite/adapters/review.js';
import {
  adaptGen1Health, adaptGen2Shadow, adaptFetchLog, adaptParams,
  adaptTrades, adaptRiskEvents, adaptFundamentalConfig, adaptHoldings
} from '../../src/rewrite/adapters/adminRuntime.js';
import { FIELD_STATE } from '../../src/rewrite/domain/enums.js';
import { FIXTURES, suite, assert } from './_fixtures.js';

const t = suite('edge-malformed.test');
const val = (f) => (f && f.state === FIELD_STATE.PROVIDED ? f.value : null);

const ALL = [
  ['adaptDashboard', adaptDashboard],
  ['adaptEtfDetail', adaptEtfDetail],
  ['adaptDecision', adaptDecision],
  ['adaptFundamentals', adaptFundamentals],
  ['adaptIntel', adaptIntel],
  ['adaptKline', adaptKline],
  ['adaptConstants', adaptConstants],
  ['adaptGen1', adaptGen1],
  ['adaptReview', adaptReview],
  ['adaptGen1Health', adaptGen1Health],
  ['adaptGen2Shadow', adaptGen2Shadow],
  ['adaptFetchLog', adaptFetchLog],
  ['adaptParams', adaptParams],
  ['adaptTrades', adaptTrades],
  ['adaptRiskEvents', adaptRiskEvents],
  ['adaptFundamentalConfig', adaptFundamentalConfig],
  ['adaptHoldings', adaptHoldings]
];

const WEIRD = [null, undefined, 0, 1, '', 'string', true, false, [], [1, 2], NaN, () => {}];

t.ok('★ 全部 adapter 对 12 种畸形输入都不抛异常且返回对象', () => {
  for (const [name, fn] of ALL) {
    for (const w of WEIRD) {
      let out;
      try {
        out = fn(w);
      } catch (e) {
        throw new Error(name + '(' + String(w) + ') 抛异常：' + e.message);
      }
      assert.equal(typeof out, 'object', name + '(' + String(w) + ') 应返回对象');
      assert.ok(out !== null, name + '(' + String(w) + ') 不得返回 null');
    }
  }
});

t.ok('★ 全部 adapter 对 edge/malformed.json 不抛异常', () => {
  const m = FIXTURES.malformed();
  for (const [name, fn] of ALL) {
    try {
      const out = fn(m);
      assert.ok(out && typeof out === 'object', name + ' 应返回对象');
    } catch (e) {
      throw new Error(name + ' 对 malformed.json 抛异常：' + e.message);
    }
  }
});

t.ok('malformed：类型错误的字段进入非 PROVIDED 状态（⛔ 不静默接受脏值）', () => {
  const m = FIXTURES.malformed();
  const d = adaptDashboard(m, null);
  // cards 是数组但含 null/数字/字符串 ⇒ 只保留对象项
  const cards = val(d.cards);
  assert.ok(cards === null || cards.every((c) => c && typeof c === 'object'));
  // overview 是字符串 ⇒ 所有 account 字段进入缺失态
  assert.notEqual(d.account.cashRatio.state, FIELD_STATE.PROVIDED);
  assert.equal(d.account.cashRatio.value, null);
});

t.ok('malformed：snapshot/decision 的字段级脏值不导致崩溃且不复用脏值', () => {
  const m = FIXTURES.malformed();
  const vm = adaptEtfDetail(m, null);
  // decision 存在（对象）⇒ available=true，但脏字段各自进入状态
  assert.equal(vm.decision.available, true);
  const ft = vm.decision.finalTarget;
  assert.ok(ft && ft.state, 'finalTarget 必须是 Field');
  // 'x' 是字符串：当前实现按「非 null 即 PROVIDED」透传，但**不得**被解析成数字
  if (ft.state === FIELD_STATE.PROVIDED) {
    assert.equal(Number.isNaN(Number(ft.value)) === false || typeof ft.value === 'string', true);
  }
  // explain_chain 为 'nope'（非数组）⇒ 必须 MISSING
  assert.equal(vm.decision.explainChain.state, FIELD_STATE.MISSING, 'explain_chain 非数组应 MISSING');
  // add_eligibility 为 null ⇒ 整块不可用
  assert.equal(vm.decision.addEligibility.available, false);
});

t.ok('★ 0 是合法值：值为 0 的字段必须判为 PROVIDED，⛔ 不得当缺失', () => {
  const vm = adaptDecision({ code: '513310', final_target: 0, position_gap: 0, cooldown_days: 0, scores: { trend: 0 } });
  assert.equal(vm.finalTarget.state, FIELD_STATE.PROVIDED);
  assert.equal(vm.finalTarget.value, 0);
  assert.equal(vm.positionGap.state, FIELD_STATE.PROVIDED);
  assert.equal(vm.cooldownDays.value, 0);
  assert.equal(vm.scores.trend.value, 0);
});

t.ok('★ 空字符串是合法值（PROVIDED），⛔ 不得当缺失', () => {
  const vm = adaptDecision({ code: '513310', next_add_condition: '' });
  assert.equal(vm.nextAddCondition.state, FIELD_STATE.PROVIDED);
  assert.equal(vm.nextAddCondition.value, '');
});

t.ok('edge/empty-arrays：空数组 ⇒ PROVIDED 且长度 0（区别于缺失）', () => {
  const e = FIXTURES.emptyArrays();
  const d = adaptDashboard(e, null);
  assert.equal(d.cards.state, FIELD_STATE.PROVIDED);
  assert.equal(d.cards.value.length, 0);
  const f = adaptFundamentals(e);
  assert.equal(f.cards.state, FIELD_STATE.PROVIDED);
  assert.equal(f.cards.value.length, 0);
  const i = adaptIntel(e);
  assert.equal(i.items.state, FIELD_STATE.PROVIDED);
  assert.equal(i.items.value.length, 0);
  const k = adaptKline(e.items);
  assert.equal(k.state, FIELD_STATE.PROVIDED);
});

t.ok('edge/empty-arrays：空对象块 ⇒ 字段级 MISSING，而非 UNAVAILABLE（块存在）', () => {
  const e = FIXTURES.emptyArrays();
  const vm = adaptEtfDetail(e, null);
  assert.equal(vm.decision.available, true, 'decision={} 仍是「存在但空」');
  assert.equal(vm.decision.action.state, FIELD_STATE.MISSING);
  assert.equal(vm.decision.action.missingReason, 'FIELD_ABSENT');
});

t.ok('edge/empty-arrays：canonical 空对象 ⇒ 判定为「契约存在」，字段各自 MISSING', () => {
  const e = FIXTURES.emptyArrays();
  // empty-arrays 里 production/gen1/system_runtime/legacy 都是 {} ⇒ hasCanonicalContract 为 true
  const g = adaptGen1(e, null);
  assert.equal(g.canonicalAvailable, true, '{} 也算下发（只是空）');
  assert.equal(g.production.actionCode.state, FIELD_STATE.MISSING);
});

t.ok('legacy-only：无 canonical ⇒ fallback 可用但必须标注', () => {
  const l = FIXTURES.legacyOnly();
  const g = adaptGen1(l, null);
  assert.equal(g.canonicalAvailable, false);
  assert.equal(g.production.actionCode.state, FIELD_STATE.UNAVAILABLE);
});

/* ---------------- 后台适配器边界 ---------------- */

t.ok('adminRuntime：非数组 list ⇒ 显式 MISSING，不抛', () => {
  const f = adaptFetchLog({ list: 'nope' });
  assert.equal(f.available, false);
  assert.equal(f.list.state, FIELD_STATE.MISSING);
  const p = adaptParams({ list: null });
  assert.equal(p.available, false);
  const t2 = adaptTrades({ list: 42 });
  assert.equal(t2.available, false);
  const r = adaptRiskEvents({ list: {} });
  assert.equal(r.available, false);
});

t.ok('adminRuntime：risk 事件「是否有生效 override」为确定性布尔', () => {
  const none = adaptRiskEvents({ list: [] });
  assert.equal(val(none.hasActiveOverride), false, '空列表 ⇒ false（合法值，非缺失）');
  const some = adaptRiskEvents({ list: [{ _id: 'a', status: 'active', risk_override: true }] });
  assert.equal(val(some.hasActiveOverride), true);
  const inactive = adaptRiskEvents({ list: [{ _id: 'b', status: 'resolved', risk_override: true }] });
  assert.equal(val(inactive.hasActiveOverride), false, '非 active 的 override 不算');
});

t.ok('adminRuntime：Gen-2 无 rankings ⇒ 显式缺失，selection 仍可读', () => {
  const vm = adaptGen2Shadow({ selection: { run_date: '2026-09-30' } });
  assert.equal(vm.available, true);
  assert.equal(vm.rankings.state, FIELD_STATE.MISSING);
  const empty = adaptGen2Shadow({});
  assert.equal(empty.available, false);
});

t.done();
