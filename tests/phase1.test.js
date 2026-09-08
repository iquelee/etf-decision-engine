/**
 * 阶段-1 数据正确性单测（grok P0/P1 + GLM 验证）
 * 覆盖：isIntraday 时区 / ma60Up 口径 / core+trade 守恒 / 降噪不掩盖信号
 * 运行：node tests/phase1.test.js（或 scripts/run-tests.js 全量）
 */
'use strict';
const assert = require('assert');
const decision = require('../cloudfunctions/common/utils/decision.js');
const indicators = require('../cloudfunctions/common/utils/indicators.js');
const { replayAverageCost } = require('../cloudfunctions/common/utils/pnl.js');
const { isIntraday, isOfficialDailyBar, clampConfidence } = require('../cloudfunctions/common/utils/fetch-guard.js');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ✓ ${name}`); }
  catch (e) { failed += 1; failures.push({ name, error: e.message }); console.log(`  ✗ ${name}\n      ${e.message}`); }
}

console.log('════════ 阶段-1 数据正确性单测 ════════\n');

/* ① isIntraday 时区：北京盘中 true、凌晨 false（复现 fetchRealtimeData 修复） */
test('① isIntraday：北京盘中(10:30/13:00/14:30)判 true，凌晨(01:30)判 false', () => {
  const bj = (iso) => new Date(new Date(iso).getTime() + 8 * 3600 * 1000);
  assert.strictEqual(isIntraday(bj('2026-08-22T02:30:00Z')), true, '北京10:30应true');
  assert.strictEqual(isIntraday(bj('2026-08-22T05:00:00Z')), true, '北京13:00应true');
  assert.strictEqual(isIntraday(bj('2026-08-22T06:30:00Z')), true, '北京14:30应true');
  assert.strictEqual(isIntraday(bj('2026-08-21T17:30:00Z')), false, '北京01:30应false');
  assert.strictEqual(isIntraday(bj('2026-08-22T08:00:00Z')), false, '北京16:00应false');
});

/* ② ma60Up：MA60 序列斜率（而非收盘价斜率）——用真实数据构造 MA60 走平/向下场景 */
test('② ma60Slope：使用 MA60 序列斜率，走平段不误判向上', () => {
  // 构造：价格冲高后横住（MA60 走平），收盘价斜率仍正但 MA60 斜率应≈0
  const bars = [];
  const base = new Date('2025-01-01');
  for (let i = 0; i < 120; i++) {
    const d = new Date(base); d.setDate(d.getDate() + i);
    const trend = i < 60 ? 1 + i * 0.005 : 1.3 + Math.sin(i) * 0.005; // 前60日上涨，后60日横盘
    bars.push({ trade_date: d.toISOString().slice(0,10), open: trend, close: trend, high: trend * 1.001, low: trend * 0.999, volume: 1000 });
  }
  const closeArr = indicators.closes(bars);
  const ma60 = indicators.calcMA(closeArr, 60);
  const ma60Slope = indicators.calcSlope(ma60.slice(-20), 20) || 0;
  // 横盘段 MA60 斜率应接近 0（|slope| < 0.1），若用收盘价斜率会明显>0
  assert.ok(Math.abs(ma60Slope) < 0.1, `横盘段 MA60 斜率应≈0，实际 ${ma60Slope}`);
});

/* ③ core+trade 守恒：任意等级组合 core+trade ≤ finalTarget */
test('③ 仓位守恒：核心/交易仓等级独立时 core+trade ≤ finalTarget', () => {
  const ctx = {
    fundamental: { f_state: 'F3' },
    positions: { core_ratio_grade: 'B', trade_ratio_grade: 'D' } // 旧逻辑 B(0.6)+D(0.7)=1.3
  };
  const { core, trade } = decision.computeCoreTrade(ctx, 30);
  assert.ok(core + trade <= 30 + 0.1, `core(${core})+trade(${trade}) 应 ≤30`);
  assert.strictEqual(core, 18, 'core=B 应为 30×0.6=18');
  assert.strictEqual(trade, 12, 'trade 应=30−18=12（守恒）');
  // F5 全零
  const f5 = decision.computeCoreTrade({ fundamental: { f_state: 'F5' }, positions: {} }, 30);
  assert.strictEqual(f5.core, 0, 'F5 core=0');
  assert.strictEqual(f5.trade, 0, 'F5 trade=0');
});

/* ④ F5 目标仓=0（generateTargetPosition 早退）*/
test('④ F5 证伪：generateTargetPosition 目标仓 0', () => {
  const ctx = { fundamental: { f_state: 'F5' }, positions: { current_position: 5 } };
  const t = decision.generateTargetPosition({ ...ctx, opportunityScore: 80 });
  assert.strictEqual(t.finalTarget, 0, 'F5 finalTarget=0');
});

/* ⑤ 降噪不掩盖信号：W5 且 current>core 时仍 STRATEGIC_REDUCE（不应被 HOLD 吞掉）*/
test('⑤ W5 防守：状态机输出 STRATEGIC_REDUCE（趋势反转不静默）', () => {
  const ctx = {
    snapshot: { w_state: 'W5', h_state: 'H5', v_state: 'V5', d_state: 'D5', sideway_days: 0, consolidation_score: 0, volume_ratio: 1.5, price_position: 0.9, high_volume_decline: true, high_volume_stagnation: false, breakout: false, trend_context: 'DOWN_CONSOLIDATION' },
    fundamental: { f_state: 'F3', f_score: 15 },
    risk: { risk_flag: 'NORMAL', risk_override: false },
    positions: { current_position: 10, target_max: 30, max_position: 30, max_strategic_position: 30, core_position: 4, trade_position: 6 },
    portfolio: { tech_position: 30, market_regime: 'range' },
    etf: { sector: 'storage' },
    params: {}, cooldownDays: 0
  };
  const r = decision.runDecision(ctx.etf, ctx.snapshot, ctx.positions, {}, {
    fundamental: ctx.fundamental, risk: ctx.risk, portfolio: ctx.portfolio, cooldownDays: 0
  });
  assert.ok(r.final_action === 'STRATEGIC_REDUCE' || r.final_action === 'EXIT',
    `W5 应 STRATEGIC_REDUCE/EXIT，实际 ${r.final_action}`);
  assert.ok(r.suggested_position < 10, `W5 建议仓应低于当前(10)，实际 ${r.suggested_position}`);
});

/* ⑥ A1：source=tencent + volume=null 不得当作正式日线 */
test('⑥ A1 幂等：tencent+volume=null 不是正式日线；有量才算', () => {
  assert.strictEqual(isOfficialDailyBar({ source: 'tencent', close: 1.23, volume: null }), false);
  assert.strictEqual(isOfficialDailyBar({ source: 'tencent', close: 1.23, volume: 0 }), false);
  assert.strictEqual(isOfficialDailyBar({ source: 'realtime', close: 1.23, volume: null }), false);
  assert.strictEqual(isOfficialDailyBar({ source: 'tencent', close: 1.23, volume: 1000 }), true);
});

/* ⑦ A2：A+ 进入横盘加仓 */
test('⑦ A2：Score 88 + H1 + 缩量 → addMode=横盘加仓', () => {
  const snapshot = {
    w_state: 'W2', h_state: 'H1', v_state: 'V1', d_state: 'D2',
    sideway_days: 16, consolidation_score: 88, volume_ratio: 0.70,
    price_position: 0.5, high_volume_decline: false, high_volume_stagnation: false,
    breakout: false, trend_context: 'UP_CONSOLIDATION'
  };
  assert.strictEqual(decision.gradeConsolidation(snapshot), 'A+');
  const addMode = decision.determineAddMode({ snapshot, crowding: { premium_flag: '正常' } });
  assert.strictEqual(addMode, '横盘加仓', `A+ 应为横盘加仓，实际 ${addMode}`);
  assert.strictEqual(decision.isQualityConsolidation('A+'), true);
});

/* ⑧ A3：F1+W5+crisis 交易仓不得高于降级前 */
test('⑧ A3：防守时 trade 不因核心降级而膨胀', () => {
  const base = {
    fundamental: { f_state: 'F1' },
    positions: { core_ratio_grade: 'A', trade_ratio_grade: 'A' },
    snapshot: { w_state: 'W2' },
    portfolio: { market_regime: 'range' }
  };
  const before = decision.computeCoreTrade(base, 30);
  const after = decision.computeCoreTrade({
    ...base,
    snapshot: { w_state: 'W5' },
    portfolio: { market_regime: 'crisis' }
  }, 30);
  assert.ok(after.core < before.core, `防守后 core 应下降，前 ${before.core} 后 ${after.core}`);
  assert.ok(after.trade <= before.trade + 0.05, `防守后 trade 不得升高，前 ${before.trade} 后 ${after.trade}`);
  assert.ok(after.core + after.trade <= 30 + 0.1, 'core+trade 仍守恒');
});

/* ⑨ B5：WAIT 字段与正常决策同构 */
test('⑨ B5：buildWaitResult defense_state 为对象，factor 为数字', () => {
  const w = decision.buildWaitResult({ code: '513310' }, { calc_date: '2026-08-22', w_state: 'W3' }, '数据不完整');
  assert.strictEqual(typeof w.defense_state, 'object');
  assert.strictEqual(w.defense_state.level, 0);
  assert.strictEqual(typeof w.opportunity_factor, 'number');
  assert.strictEqual(w.scores.risk, 0);
  assert.strictEqual(w.scores.total, 0);
});

/* ⑩ A7：confidence 钳到 0~1 */
test('⑩ A7：clampConfidence 超出 [0,1] 被钳住', () => {
  assert.strictEqual(clampConfidence(1.8, 0.6), 1);
  assert.strictEqual(clampConfidence(-0.2, 0.6), 0);
  assert.strictEqual(clampConfidence('x', 0.6), 0.6);
});

/* ⑫ V3.2：W1 空仓首仓不被 structure/volume/chase 挡住 */
test('⑫ V3.2：W1 空仓 + H3 + 放量 + 高位 → BUILD', () => {
  const r = decision.runDecision(
    { sector: 'ai_network' },
    {
      w_state: 'W1', h_state: 'H3', v_state: 'V4', d_state: 'D1',
      sideway_days: 0, consolidation_score: 0, volume_ratio: 1.4,
      price_position: 0.92, high_volume_decline: false, high_volume_stagnation: false,
      breakout: false, trend_context: 'UP_CONSOLIDATION'
    },
    { current_position: 0, target_max: 30, max_position: 30, max_strategic_position: 30, core_position: 0, trade_position: 0 },
    {},
    { fundamental: { f_state: 'F3' }, risk: { risk_flag: 'NORMAL' }, portfolio: { tech_position: 0, market_regime: 'range' }, cooldownDays: 0 }
  );
  assert.strictEqual(r.add_eligibility.overall, 'allow', `首仓资格应为 allow，实际 ${r.add_eligibility.overall}`);
  assert.strictEqual(r.final_action, 'BUILD', `应为 BUILD，实际 ${r.final_action}`);
});

/* ⑬ V3.2：W3 空仓仍不放宽 */
test('⑬ V3.2：W3 空仓 + H3 仍不得 BUILD', () => {
  const r = decision.runDecision(
    { sector: 'ai_network' },
    {
      w_state: 'W3', h_state: 'H3', v_state: 'V4', d_state: 'D3',
      sideway_days: 0, consolidation_score: 40, volume_ratio: 1.2,
      price_position: 0.7, high_volume_decline: false, high_volume_stagnation: false,
      breakout: false, trend_context: 'RANGE_CONSOLIDATION'
    },
    { current_position: 0, target_max: 30, max_position: 30, max_strategic_position: 30, core_position: 0, trade_position: 0 },
    {},
    { fundamental: { f_state: 'F3' }, risk: { risk_flag: 'NORMAL' }, portfolio: { tech_position: 0, market_regime: 'range' }, cooldownDays: 0 }
  );
  assert.notStrictEqual(r.final_action, 'BUILD', `W3 空仓不应 BUILD，实际 ${r.final_action}`);
});

/* ⑭ V3.2：W1 已有仓，ADD 仍受 structure/chase 约束 */
test('⑭ V3.2：W1 已持仓 + H3 + 高位 → 不加仓', () => {
  const r = decision.runDecision(
    { sector: 'ai_network' },
    {
      w_state: 'W1', h_state: 'H3', v_state: 'V4', d_state: 'D1',
      sideway_days: 0, consolidation_score: 0, volume_ratio: 1.4,
      price_position: 0.92, high_volume_decline: false, high_volume_stagnation: false,
      breakout: false, trend_context: 'UP_CONSOLIDATION'
    },
    { current_position: 8, target_max: 30, max_position: 30, max_strategic_position: 30, core_position: 4, trade_position: 4 },
    {},
    { fundamental: { f_state: 'F3' }, risk: { risk_flag: 'NORMAL' }, portfolio: { tech_position: 8, market_regime: 'range' }, cooldownDays: 0 }
  );
  assert.notStrictEqual(r.final_action, 'ADD', `已有仓不应因首仓规则而 ADD，实际 ${r.final_action}`);
});

/* ⑮ V3.4b：W1 已持仓，回调（pp≤0.8）时 structure/volume 放行可 ADD；高位仍禁止 */
test('⑮ V3.4b：W1 已持仓 + H3 + 回调 → ADD；高位仍不得 ADD', () => {
  const snap = {
    w_state: 'W1', h_state: 'H3', v_state: 'V4', d_state: 'D1',
    sideway_days: 0, consolidation_score: 0, volume_ratio: 1.4,
    high_volume_decline: false, high_volume_stagnation: false,
    breakout: false, trend_context: 'UP_CONSOLIDATION'
  };
  const pos = { current_position: 8, target_max: 30, max_position: 30, max_strategic_position: 30, core_position: 4, trade_position: 4 };
  const extra = { fundamental: { f_state: 'F3' }, risk: { risk_flag: 'NORMAL' }, portfolio: { tech_position: 8, market_regime: 'range' }, cooldownDays: 0 };
  const dip = decision.runDecision({ sector: 'ai_network' }, { ...snap, price_position: 0.63 }, pos, {}, extra);
  assert.strictEqual(dip.final_action, 'ADD', `回调应 ADD，实际 ${dip.final_action}`);
  assert.strictEqual(dip.suggested_position, 13, `V3.7 W1 ADD 应为 8+5=13，实际 ${dip.suggested_position}`);
  const high = decision.runDecision({ sector: 'ai_network' }, { ...snap, price_position: 0.92 }, pos, {}, extra);
  assert.notStrictEqual(high.final_action, 'ADD', `高位仍不得 ADD，实际 ${high.final_action}`);
});

/* ⑯ V3.5：W1 中度超配 HOLD；明显仍减；W3 中度仍减；P3 优先 */
test('⑯ V3.5：W1 中度超配不减，明显/W3/P3 仍减', () => {
  const base = {
    fundamental: { f_state: 'F3' },
    risk: { risk_flag: 'NORMAL' },
    positions: { current_position: 27 },
    finalTarget: 21,
    gap: -6,
    eligibilityOverall: 'pause',
    overAllocStatus: '中度'
  };
  const w1mid = decision.runStateMachine({
    ...base,
    snapshot: { w_state: 'W1', high_volume_decline: false, high_volume_stagnation: false }
  });
  assert.strictEqual(w1mid, 'HOLD', `W1 中度超配应为 HOLD，实际 ${w1mid}`);

  const w1sev = decision.runStateMachine({
    ...base,
    gap: -12,
    overAllocStatus: '明显',
    snapshot: { w_state: 'W1', high_volume_decline: false, high_volume_stagnation: false }
  });
  assert.strictEqual(w1sev, 'TACTICAL_REDUCE', `W1 明显超配应仍减，实际 ${w1sev}`);

  const w3mid = decision.runStateMachine({
    ...base,
    snapshot: { w_state: 'W3', high_volume_decline: false, high_volume_stagnation: false }
  });
  assert.strictEqual(w3mid, 'TACTICAL_REDUCE', `W3 中度超配应仍减，实际 ${w3mid}`);

  const w1p3 = decision.runStateMachine({
    ...base,
    snapshot: { w_state: 'W1', high_volume_decline: false, high_volume_stagnation: true }
  });
  assert.strictEqual(w1p3, 'TACTICAL_REDUCE', `W1 放量滞涨应仍减，实际 ${w1p3}`);
});

/* ⑰ V3.6：残仓可在 W3 + C 级（DOWN_CONSOLIDATION）缩量回调中重建。
 * 排除 C 级会撤销本旋钮；空仓 W3 / 高位 / 放量仍禁止。 */
test('⑰ V3.6：W3+C 残仓缩量可 ADD；空仓 W3、高位、放量不得加', () => {
  const wash = {
    w_state: 'W3', h_state: 'H5', v_state: 'V1', d_state: 'D4',
    sideway_days: 10, consolidation_score: 40, volume_ratio: 0.6,
    high_volume_decline: false, high_volume_stagnation: false,
    breakout: false, trend_context: 'DOWN_CONSOLIDATION'
  };
  const extra = { fundamental: { f_state: 'F3' }, risk: { risk_flag: 'NORMAL' }, portfolio: { tech_position: 10, market_regime: 'range' }, cooldownDays: 0 };
  const remnant = { current_position: 5.4, target_max: 30, max_position: 30, max_strategic_position: 30, core_position: 5.4, trade_position: 0 };
  const add = decision.runDecision({ sector: 'storage' }, { ...wash, price_position: 0.46 }, remnant, {}, extra);
  assert.strictEqual(add.final_action, 'ADD', `残仓缩量应 ADD，实际 ${add.final_action}`);
  assert.strictEqual(add.suggested_position, 8.4, `W3 残仓步长仍为 +3，实际 ${add.suggested_position}`);

  const empty = decision.runDecision(
    { sector: 'storage' }, { ...wash, price_position: 0.46 },
    { ...remnant, current_position: 0, core_position: 0 }, {}, extra
  );
  assert.notStrictEqual(empty.final_action, 'BUILD', `空仓 W3 仍不得 BUILD，实际 ${empty.final_action}`);
  assert.notStrictEqual(empty.final_action, 'ADD', `空仓 W3 不得 ADD，实际 ${empty.final_action}`);

  const chase = decision.runDecision({ sector: 'storage' }, { ...wash, price_position: 0.92 }, remnant, {}, extra);
  assert.notStrictEqual(chase.final_action, 'ADD', `残仓高位不得 ADD，实际 ${chase.final_action}`);

  const expand = decision.runDecision(
    { sector: 'storage' }, { ...wash, v_state: 'V4', volume_ratio: 1.3, price_position: 0.46 }, remnant, {}, extra
  );
  assert.notStrictEqual(expand.final_action, 'ADD', `残仓放量不得 ADD，实际 ${expand.final_action}`);
});

/* ⑱ V3.8：科技合计 >65% 按占比压回；未超顶时 V3.5 中度 HOLD 仍在 */
test('⑱ V3.8：科技超顶按占比减；未超顶 / 非科技 / 已更深减仓不动', () => {
  const over = decision.applySectorHardCap({
    etf: { sector: 'storage' },
    positions: { current_position: 28.5 },
    portfolio: { tech_position: 68 },
    params: {}
  }, 'HOLD', 28.5);
  assert.strictEqual(over.action, 'TACTICAL_REDUCE', `超顶 HOLD 应让路，实际 ${over.action}`);
  assert.strictEqual(over.suggested, 27.2, `28.5/68×3 应压到 27.2，实际 ${over.suggested}`);

  const ok = decision.applySectorHardCap({
    etf: { sector: 'storage' },
    positions: { current_position: 27 },
    portfolio: { tech_position: 50 },
    params: {}
  }, 'HOLD', 27);
  assert.strictEqual(ok.action, 'HOLD', `未超顶不得改动作，实际 ${ok.action}`);
  assert.strictEqual(ok.suggested, 27);

  const gold = decision.applySectorHardCap({
    etf: { sector: 'gold' },
    positions: { current_position: 28.5 },
    portfolio: { tech_position: 68 },
    params: {}
  }, 'HOLD', 28.5);
  assert.strictEqual(gold.action, 'HOLD');
  assert.strictEqual(gold.suggested, 28.5);

  const deep = decision.applySectorHardCap({
    etf: { sector: 'storage' },
    positions: { current_position: 28.5 },
    portfolio: { tech_position: 68 },
    params: {}
  }, 'STRATEGIC_REDUCE', 10);
  assert.strictEqual(deep.action, 'STRATEGIC_REDUCE');
  assert.strictEqual(deep.suggested, 10);

  const snap = {
    w_state: 'W1', h_state: 'H3', v_state: 'V2', d_state: 'D2',
    sideway_days: 12, consolidation_score: 70, volume_ratio: 0.8,
    high_volume_decline: false, high_volume_stagnation: false,
    breakout: false, trend_context: 'UP_CONSOLIDATION', price_position: 0.5
  };
  const extra = {
    fundamental: { f_state: 'F3' }, risk: { risk_flag: 'NORMAL' },
    portfolio: { tech_position: 68, market_regime: 'range' }, cooldownDays: 0
  };
  const pos = {
    current_position: 28.5, target_max: 30, max_position: 30, max_strategic_position: 30,
    core_position: 18, trade_position: 10.5
  };
  const live = decision.runDecision({ sector: 'storage' }, snap, pos, {}, extra);
  assert.strictEqual(live.final_action, 'TACTICAL_REDUCE', `runDecision 超顶应减，实际 ${live.final_action}`);
  assert.ok(live.suggested_position < 28.5, `建议仓应低于 28.5，实际 ${live.suggested_position}`);
  const step13 = (live.explain_chain || []).find((s) => s.step === 13);
  assert.ok(step13 && step13.result.indexOf('战术减仓') >= 0, `决策链第13步应是战术减仓，实际 ${step13 && step13.result}`);
  const adj = Math.round((live.suggested_position - 28.5) * 10) / 10;
  assert.ok(step13.result.indexOf(String(adj)) >= 0, `决策链调整应含 ${adj}，实际 ${step13.result}`);
  assert.strictEqual(live.position_gap, adj, `position_gap 应等于建议−当前 ${adj}，实际 ${live.position_gap}`);
});

/* ⑲ 无有效横盘不得把 10 日新当突破 */
test('⑲ 无有效横盘 breakout=false；有横盘才认窗口高点', () => {
  const highs = [9, 9.2, 9.4, 9.6, 9.8, 10, 10.2, 10.4, 10.6, 10.8, 12];
  assert.strictEqual(indicators.detectBreakout(0, highs, 12), false, '无横盘创 10 日新高不是突破');
  assert.strictEqual(indicators.detectBreakout(5, highs, 12), false, '不足 min 日不得突破');
  const flatThenUp = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10.5];
  assert.strictEqual(indicators.detectBreakout(12, flatThenUp, 10.5), true, '有效横盘后越过窗口高点应突破');
  assert.strictEqual(indicators.detectBreakout(12, flatThenUp, 10), false, '未越过窗口高点不是突破');

  const bars = [];
  const base = new Date('2025-01-01');
  for (let i = 0; i < 80; i++) {
    const d = new Date(base); d.setDate(d.getDate() + i);
    const c = i < 75 ? 20 - i * 0.12 : 11 + (i - 75) * 0.8;
    bars.push({ trade_date: d.toISOString().slice(0, 10), open: c, close: c, high: c * 1.01, low: c * 0.99, volume: 1000 });
  }
  const snap = indicators.computeSnapshot(bars, {}, { code: '513310', calc_date: bars[bars.length - 1].trade_date });
  assert.ok(snap.sideway_days < 8, `超跌反弹不应算有效横盘，实际 ${snap.sideway_days}`);
  assert.strictEqual(snap.breakout, false, '无横盘时快照 breakout 必须是 false');
});

/* ⑳ 成交乱序时平均成本仍按日期正序 */
test('⑳ 成交乱序仍按日期回放平均成本', () => {
  const { replayAverageCost, unrealizedPnl } = require('../cloudfunctions/common/utils/pnl.js');
  const h = replayAverageCost([
    { code: '518880', action: 'sell', shares: 100, price: 5, trade_date: '2026-02-01' },
    { code: '518880', action: 'buy', shares: 200, price: 4, trade_date: '2026-01-10' },
    { code: '518880', action: 'buy', shares: 200, price: 2, trade_date: '2026-01-01' }
  ]);
  assert.strictEqual(h['518880'].shares, 300);
  assert.strictEqual(Math.round(h['518880'].avgCost * 100) / 100, 3);
  assert.strictEqual(unrealizedPnl(h, { '518880': 4 }), 300);
});

/* ㉑ 冻结 key 与成交更新白名单 */
test('㉑ 冻结 mild/赛道顶；成交 update 丢掉非白名单字段', () => {
  const { FROZEN_PARAM_KEYS, pickTradeUpdate, ENGINE_VERSION } = require('../cloudfunctions/common/constants.js');
  assert.ok(FROZEN_PARAM_KEYS.indexOf('volume_ratio_mild') >= 0);
  assert.ok(FROZEN_PARAM_KEYS.indexOf('tech_sector_max') >= 0);
  assert.strictEqual(ENGINE_VERSION, 'V3.9');
  const picked = pickTradeUpdate({
    trade_date: '2026-08-22', shares: 10, _id: 'x', _op: 'update', extra: 1, password: 'no'
  });
  assert.strictEqual(picked.trade_date, '2026-08-22');
  assert.strictEqual(picked.shares, 10);
  assert.strictEqual(picked._id, undefined);
  assert.strictEqual(picked.extra, undefined);
  assert.strictEqual(picked.password, undefined);
});

/* ㉒ 去杠杆日收益：超 100% 按 100/合计 缩回，不超则原样 */
test('㉒ 去杠杆日收益只缩超配那天', () => {
  const { unleverDayReturn, rawCash, clipCash } = require('../scripts/lib/book-disclose.js');
  assert.strictEqual(unleverDayReturn(0.02, 100), 0.02);
  assert.strictEqual(unleverDayReturn(0.02, 80), 0.02);
  assert.strictEqual(Math.round(unleverDayReturn(0.0117, 117) * 1e10) / 1e10, 0.01);
  assert.strictEqual(rawCash(117), -17);
  assert.strictEqual(clipCash(117), 0);
  assert.strictEqual(clipCash(60.9), 39.1);
});

/* ㉓ 实盘活分母：现金粘住，市值涨则总资产涨；仓位%用活分母 */
test('㉓ 活分母=市值+现金；首次无现金字段时总资产仍等于旧录入', () => {
  const live = require('../cloudfunctions/common/utils/live-asset.js');
  assert.strictEqual(live.cashDeltaFromTrade({ action: 'buy', amount: 5000 }), -5000);
  assert.strictEqual(live.cashDeltaFromTrade({ action: 'sell', shares: 100, price: 10 }), 1000);
  assert.strictEqual(live.snapshotHoldingsMv({ holdings_mv: 40000 }), 40000);
  assert.strictEqual(live.snapshotHoldingsMv({ positions: [{ value: 100 }, { value: 50 }] }), 150);

  const sticky = live.resolveCashYuan({ cashBalance: 60000, currentHoldingsMv: 50000, cashDelta: 0 });
  assert.strictEqual(sticky, 60000);
  assert.strictEqual(live.liveTotalAsset(50000, sticky), 110000);

  const fromLast = live.resolveCashYuan({
    seedTotalAsset: 100000, lastHoldingsMv: 40000, currentHoldingsMv: 50000, cashDelta: 0
  });
  assert.strictEqual(fromLast, 60000);
  assert.strictEqual(live.liveTotalAsset(50000, fromLast), 110000);

  const first = live.resolveCashYuan({
    seedTotalAsset: 100000, currentHoldingsMv: 45000, cashDelta: 0
  });
  assert.strictEqual(first, 55000);
  assert.strictEqual(live.liveTotalAsset(45000, first), 100000);

  const afterBuyFirst = live.resolveCashYuan({
    seedTotalAsset: 100000, currentHoldingsMv: 45000, cashDelta: -5000
  });
  assert.strictEqual(afterBuyFirst, 55000);
  assert.strictEqual(live.liveTotalAsset(45000, afterBuyFirst), 100000);
  assert.strictEqual(live.resolveCashYuan({ cashBalance: 60000, cashDelta: -5000 }), 55000);
  assert.strictEqual(live.positionPct(20000, 100000), 20);
  const book = live.bookFromPositions(
    [{ code: '513310', sector: 'storage' }, { code: '518880', sector: 'gold' }, { code: '159570', sector: 'biotech' }],
    [{ code: '513310', current_position: 9.1 }, { code: '518880', current_position: 0 }]
  );
  assert.strictEqual(book.tech_position, 9.1);
  assert.strictEqual(book.gold_position, 0);
  assert.strictEqual(book.cash_ratio, 90.9);
});

/* ㉔ 市值重标：同票调仓后仓位随行情漂移，粘性%不变 */
test('㉔ 市值重标对照：同日同涨时与粘性相同，次日漂移', () => {
  const mtm = require('../scripts/lib/mtm-book.js');
  const book = mtm.createMtmBook(100);
  const d1 = mtm.stepMtm(book, [{ code: 'A', pct: 50 }], { A: 10 }, { A: 11 }, 0);
  assert.strictEqual(Math.round(d1.nav * 100) / 100, 105);
  assert.ok(Math.abs(d1.book - 52.381) < 0.02);
  const d2 = mtm.stepMtm(book, [], { A: 11 }, { A: 12.1 }, 0);
  assert.strictEqual(Math.round(d2.nav * 100) / 100, 110.5);
  assert.ok(d2.book > d1.book);
});

/* ㉕ 现金约束：加仓不得超过剩余现金，减仓不限 */
test('㉕ 现金约束只剪加仓，不剪减仓', () => {
  const cap = require('../scripts/lib/cash-cap.js');
  assert.strictEqual(cap.clipBuyTarget(20, 25, 80), 25);
  assert.strictEqual(cap.clipBuyTarget(20, 25, 98), 22);
  assert.strictEqual(cap.clipBuyTarget(20, 25, 100), 20);
  assert.strictEqual(cap.clipBuyTarget(20, 25, 117), 20);
  assert.strictEqual(cap.clipBuyTarget(20, 15, 117), 15);
});

/* ㉖ F/Regime 代理：W→F；科技三票周线分数阈值与生产相同 */
test('㉖ F←W、regime←科技周线分数', () => {
  const sp = require('../scripts/lib/signal-proxy.js');
  assert.strictEqual(sp.fFromW('W1'), 'F1');
  assert.strictEqual(sp.fFromW('W5'), 'F5');
  assert.strictEqual(sp.fScore('F1'), 25);
  assert.strictEqual(sp.regimeFromWStates(['W1', 'W1', 'W1']), 'aggressive');
  assert.strictEqual(sp.regimeFromWStates(['W2', 'W2', 'W3']), 'structural');
  assert.strictEqual(sp.regimeFromWStates(['W3', 'W3', 'W4']), 'range');
  assert.strictEqual(sp.regimeFromWStates(['W4', 'W5', 'W5']), 'crisis');
  assert.strictEqual(sp.regimeFromWStates([]), 'range');
});

/* ㉗ V4.1 票池：1/n 等权；缺黄金/药码不崩；三票日期取交集 */
test('㉗ 票池子集：等权 1/n、缺席仓位 0、日期交集', () => {
  const u = require('../scripts/lib/universe.js');
  assert.strictEqual(u.equalWeight(5), 0.2);
  assert.strictEqual(u.equalWeight(3), 1 / 3);
  const three = u.selectUniverse(['518880', '515880', '513310']);
  assert.strictEqual(three.length, 3);
  assert.strictEqual(u.seriesLabel(three), '3ticket');
  assert.ok(u.listingBlockReason(['518880', '515880', '513310']).indexOf('2022') >= 0);
  assert.ok(u.listingBlockReason(['518880', '515880']).indexOf('两票') >= 0);
  const pos = { '515880': { current_position: 12 } };
  assert.strictEqual(u.sectorPosition(pos, three, 'gold'), 0);
  assert.strictEqual(u.sectorPosition(pos, three, 'ai_network'), 12);
  assert.strictEqual(u.sectorPosition(pos, three, 'biotech'), 0);
  const dates = u.intersectTradeDates({
    '518880': [{ trade_date: '2022-01-04' }, { trade_date: '2023-03-15' }],
    '515880': [{ trade_date: '2022-01-04' }, { trade_date: '2023-03-15' }],
    '513310': [{ trade_date: '2023-03-15' }]
  }, three);
  assert.deepStrictEqual(dates, ['2023-03-15']);
  assert.throws(() => u.selectUniverse(['999999']), /未知代码/);
});

/* ㉘ 复盘时间轴：当天实际持仓，不是目标仓 */
test('㉘ 复盘持仓：同日快照优先，成交补洞，隔日快照限 3 天', () => {
  const { actualHeldPosition, actualHeldPositionDetail } = require('../cloudfunctions/common/utils/review-position.js');
  const snaps = [
    { snapshot_date: '2026-08-21', positions: [{ code: '513310', position: 9.1 }, { code: '518880', position: 0 }] },
    { snapshot_date: '2026-08-23', positions: [{ code: '513310', position: 9.3 }] }
  ];
  const trades = [
    { code: '513310', trade_date: '2026-08-14', position_after: 8 },
    { code: '159570', trade_date: '2026-08-20', position_after: 5 }
  ];
  assert.strictEqual(actualHeldPosition('513310', '2026-08-21', snaps, trades), 9.1);
  assert.strictEqual(actualHeldPosition('518880', '2026-08-21', snaps, trades), 0);
  assert.strictEqual(actualHeldPosition('159570', '2026-08-20', snaps, trades), 5);
  assert.strictEqual(actualHeldPosition('513310', '2026-08-14', [], trades), 8);
  assert.strictEqual(actualHeldPosition('513310', '2026-08-22', snaps, trades), 9.1);
  assert.strictEqual(actualHeldPosition('513310', '2026-08-20', [
    { snapshot_date: '2026-08-23', positions: [{ code: '513310', position: 9.3 }] }
  ], []), 9.3);
  assert.strictEqual(actualHeldPosition('513310', '2026-08-20', snaps, trades), 9.1);
  assert.strictEqual(actualHeldPosition('513310', '2026-08-10', snaps, trades), null);
  assert.deepStrictEqual(actualHeldPositionDetail('513310', '2026-08-20', snaps, trades), {
    position: 9.1, position_date: '2026-08-21', source: 'PORTFOLIO_SNAPSHOT', exact: false
  });
});

/* ㉙ 复盘统计：一笔成交只关联一次，等待日操作属于自主调整 */
test('㉙ 复盘统计：T+1 减仓算执行，HOLD 日买入标记自主调整', () => {
  const { computeReviewStats } = require('../cloudfunctions/common/utils/review-stats.js');
  const decisions = [
    { _id: 'r1', code: '518880', decision_date: '2026-08-18', final_action: 'STRATEGIC_REDUCE' },
    { _id: 'w1', code: '518880', decision_date: '2026-08-19', final_action: 'WAIT' },
    { _id: 'h1', code: '513310', decision_date: '2026-08-19', final_action: 'HOLD' },
    { _id: 'w2', code: '515880', decision_date: '2026-08-19', final_action: 'WAIT' }
  ];
  const trades = [
    { code: '518880', trade_date: '2026-08-19', action: 'sell' },
    { code: '513310', trade_date: '2026-08-19', action: 'buy' }
  ];
  const out = computeReviewStats(decisions, trades);
  assert.strictEqual(out.stats.signal_count, 4);
  assert.strictEqual(out.stats.follow_rate, 100);
  assert.strictEqual(out.stats.violate_count, 0);
  assert.strictEqual(out.stats.add_hit_rate, null);
  assert.strictEqual(out.stats.defense_timely_rate, 100);
  assert.strictEqual(out.stats.avg_deviation_days, 1);
  assert.strictEqual(out.deviations.length, 2);
  assert.strictEqual(out.deviations[0].deviation, '自主调整');
  assert.strictEqual(out.deviations[0].code, '513310');
  assert.strictEqual(out.deviations[1].deviation, '已执行');
  assert.strictEqual(out.deviations[1].code, '518880');
});

test('㉚ 复盘统计：同一笔成交不得重复记到连续 HOLD 决策', () => {
  const { computeReviewStats } = require('../cloudfunctions/common/utils/review-stats.js');
  const decisions = [
    { _id: 'h1', code: '513310', decision_date: '2026-08-31', final_action: 'HOLD' },
    { _id: 'h2', code: '513310', decision_date: '2026-09-01', final_action: 'HOLD' },
    { _id: 'h3', code: '513310', decision_date: '2026-09-02', final_action: 'HOLD' }
  ];
  const out = computeReviewStats(decisions, [
    { code: '513310', trade_date: '2026-09-02', action: 'sell' }
  ]);
  assert.strictEqual(out.stats.violate_count, 0);
  assert.strictEqual(out.stats.independent_operation_count, 1);
  assert.strictEqual(out.deviations.length, 1);
  assert.strictEqual(out.deviations[0].date, '2026-09-02');
  assert.strictEqual(out.deviations[0].deviation, '自主调整');
});

/* ⑪ A8：死代码符号已删除 */
test('⑪ A8：decision 模块不再导出/存在 buildFirstStep、addStepByGrade', () => {
  assert.strictEqual(decision.buildFirstStep, undefined);
  assert.strictEqual(decision.addStepByGrade, undefined);
  const src = require('fs').readFileSync(require('path').join(__dirname, '../cloudfunctions/common/utils/decision.js'), 'utf8');
  assert.ok(!/\bfunction buildFirstStep\b/.test(src), 'buildFirstStep 函数体仍在');
  assert.ok(!/\bfunction addStepByGrade\b/.test(src), 'addStepByGrade 函数体仍在');
});

/* ㉚ V3.9 E3：通信 ai_network · W4 零仓 B+ 可 BUILD；与实验层闸门对齐 */
test('㉚ V3.9 E3：515880 W4 零仓 B+ 必须 BUILD；B 机会+C 横盘/放量不得进', () => {
  const baseSnap = {
    w_state: 'W4', h_state: 'H4', v_state: 'V2', d_state: 'D3',
    consolidation_score: 72, sideway_days: 12, volume_ratio: 0.65,
    price_position: 0.5, data_complete: true, calc_date: '2025-03-07'
  };
  const zero = { current_position: 0, target_max: 30, core_position: 0, trade_position: 0 };
  const extra = {
    fundamental: { f_state: 'F3', f_score: 15 },
    risk: { risk_flag: 'NORMAL', risk_override: false },
    portfolio: { tech_position: 20, market_regime: 'range' },
    cooldownDays: 0
  };
  const comm = decision.runDecision(
    { code: '515880', sector: 'ai_network' }, baseSnap, zero, {}, extra
  );
  assert.strictEqual(comm.final_action, 'BUILD', `通信 W4 零仓 B+ 应 BUILD，实际 ${comm.final_action}`);

  const semi = decision.runDecision(
    { code: '513310', sector: 'storage' }, baseSnap, zero, {}, extra
  );
  assert.strictEqual(semi.final_action, 'WAIT', `半导体 W4 零仓仍应 WAIT，实际 ${semi.final_action}`);

  const commC = decision.runDecision(
    { code: '515880', sector: 'ai_network' },
    { ...baseSnap, h_state: 'H5', v_state: 'V4', consolidation_score: 50 }, zero, {}, extra
  );
  assert.strictEqual(commC.final_action, 'WAIT', `通信 W4 零仓 C 级仍 WAIT，实际 ${commC.final_action}`);

  const commBC = decision.runDecision(
    { code: '515880', sector: 'ai_network' },
    {
      ...baseSnap, trend_context: 'DOWN_CONSOLIDATION',
      h_state: 'H5', v_state: 'V4', consolidation_score: 48, volume_ratio: 0.65
    },
    zero, {}, extra
  );
  assert.strictEqual(commBC.add_eligibility.structure, 'pause', 'B 机会+C 横盘 structure 应 pause');
  assert.strictEqual(commBC.final_action, 'WAIT', `B+C 横盘不得 BUILD，实际 ${commBC.final_action}`);

  const commVol = decision.runDecision(
    { code: '515880', sector: 'ai_network' },
    { ...baseSnap, v_state: 'V4', volume_ratio: 1.25 }, zero, {}, extra
  );
  assert.strictEqual(commVol.add_eligibility.volume, 'pause', 'E3 放量 volume 应 pause');
  assert.strictEqual(commVol.final_action, 'WAIT', `放量不得 BUILD，实际 ${commVol.final_action}`);
});

/* ㉛ V3.9.1：NaN 输入防护 + explain 闸门 PAUSED 文案 */
test('㉛ V3.9.1：NaN 不传播；pause 闸门显示 PAUSED', () => {
  const capNaN = decision.applySectorHardCap({
    etf: { sector: 'storage' },
    positions: { current_position: NaN },
    portfolio: { tech_position: 68 },
    params: {}
  }, 'HOLD', 10);
  assert.strictEqual(capNaN.hit, false);
  assert.ok(Number.isFinite(capNaN.suggested), `applySectorHardCap NaN 不应输出 NaN，实际 ${capNaN.suggested}`);

  const tacNaN = decision.computeTargetPosition({
    positions: { current_position: 20, core_position: NaN },
    finalTarget: 25,
    overAllocStatus: '中度'
  }, 'TACTICAL_REDUCE');
  assert.strictEqual(tacNaN, 20, `core NaN 时 TAC 应 HOLD 当前仓，实际 ${tacNaN}`);

  const holdGap = decision.runStateMachine({
    snapshot: { w_state: 'W1' },
    fundamental: { f_state: 'F3' },
    risk: { risk_flag: 'NORMAL' },
    positions: { current_position: 15 },
    finalTarget: NaN,
    gap: NaN,
    eligibilityOverall: 'allow'
  });
  assert.strictEqual(holdGap, 'HOLD', `NaN gap 有仓应 HOLD，实际 ${holdGap}`);

  const waitGap = decision.runStateMachine({
    snapshot: { w_state: 'W1' },
    fundamental: { f_state: 'F3' },
    risk: { risk_flag: 'NORMAL' },
    positions: { current_position: 0 },
    finalTarget: NaN,
    gap: NaN,
    eligibilityOverall: 'allow'
  });
  assert.strictEqual(waitGap, 'WAIT', `NaN gap 空仓应 WAIT，实际 ${waitGap}`);

  const snap = {
    w_state: 'W3', h_state: 'H3', v_state: 'V3', d_state: 'D3',
    consolidation_score: 70, sideway_days: 10, volume_ratio: 0.8,
    price_position: 0.5, data_complete: true
  };
  const pos = { current_position: 10, target_max: 30, core_position: 8, trade_position: 2 };
  const extra = {
    fundamental: { f_state: 'F3' }, risk: { risk_flag: 'YELLOW' },
    portfolio: { tech_position: 30, market_regime: 'range' }, cooldownDays: 0
  };
  const paused = decision.runDecision({ sector: 'storage' }, snap, pos, {}, extra);
  const step12 = (paused.explain_chain || []).find((s) => s.step === 12);
  assert.ok(step12 && step12.result.indexOf('PAUSED') >= 0, `YELLOW 闸门应 PAUSED，实际 ${step12 && step12.result}`);
  assert.ok(step12.result.indexOf('BLOCKED') < 0, `pause 不应显示 BLOCKED，实际 ${step12.result}`);
});

test('㉜ V4.2：detectDState 数据不足返回 D3；TAC rounding；密码哈希', () => {
  assert.strictEqual(indicators.detectDState([], {}), 'D3', '不足 20 根应 D3 非 D5');
  const tac = decision.computeTargetPosition({
    positions: { current_position: 20, core_position: 10 },
    finalTarget: 25,
    overAllocStatus: '中度'
  }, 'TACTICAL_REDUCE');
  assert.strictEqual(tac, 17.5, `TAC 25% 交易仓应 17.5，实际 ${tac}`);

  const { hashPassword, verifyPassword } = require('../cloudfunctions/common/utils/admin-auth.js');
  const hashed = hashPassword('test-secret');
  assert.ok(hashed.startsWith('$scrypt$'));
  assert.strictEqual(verifyPassword('test-secret', hashed).ok, true);
  assert.strictEqual(verifyPassword('wrong', hashed).ok, false);
  const legacy = verifyPassword('plain', 'plain');
  assert.strictEqual(legacy.ok, true);
  assert.strictEqual(legacy.migrate, true);
});

test('㉝ V4.2b：仓位未知 pause；日期/limit 校验', () => {
  const snap = {
    w_state: 'W1', h_state: 'H3', v_state: 'V2', d_state: 'D2',
    sideway_days: 12, consolidation_score: 70, volume_ratio: 0.8,
    price_position: 0.5, data_complete: true
  };
  const extra = {
    fundamental: { f_state: 'F3' }, risk: { risk_flag: 'NORMAL' },
    portfolio: { tech_position: 20, market_regime: 'range' }, cooldownDays: 0
  };
  const unknown = decision.runDecision(
    { sector: 'storage' }, snap,
    { current_position: null, target_max: 30, max_position: 30 },
    {}, extra
  );
  assert.strictEqual(unknown.add_eligibility.position, 'pause');
  assert.notStrictEqual(unknown.final_action, 'BUILD', `未知仓位不得 BUILD，实际 ${unknown.final_action}`);

  const { isDateStr, clampInt } = require('../cloudfunctions/common/utils/request-validate.js');
  assert.strictEqual(isDateStr('2026-08-24'), true);
  assert.strictEqual(isDateStr('2026-13-01'), false);
  assert.strictEqual(clampInt(999999, 1, 200, 60), 200);
});

console.log(`\n${passed} 通过 / ${failed} 失败`);
if (failed > 0) {
  for (const f of failures) console.log(`  - ${f.name}: ${f.error}`);
  process.exit(1);
}
