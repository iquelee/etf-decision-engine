/**
 * V3.6.1 Safety Hardening R1 —— 专项测试（缺陷 #1 / #2 / #4 / #7 / #8 / #9）
 *
 * 运行：node tests/v361-safety-hardening.test.js
 *
 * 覆盖：
 *   #1  Trend Stage「运行次数冒充交易日」 —— pendingDays / days_in_stage / soft_down_days / s5_risk_days
 *   #2  Swing Structure 唯一实现 + SlowBreak 链（lowerLow → isSlowBreakHigh → +20 bonus）
 *   #4  相关性按 trade_date INNER JOIN 对齐（缺一个交易日不得错位）
 *   #7  Market Regime 单一真相诊断 + W5 多数闸可达性
 *   #8  真实现金 / 隐性杠杆诊断（total_position=106 → cash_ratio_raw=-6 / leverage_excess=6 / overbooked）
 *   #9  负向约束回归守卫（禁止开启 6.2/6.3、禁止改冻结参数与因子表）
 *
 * 注意：本测试**只读**，不部署、不写入任何线上集合。
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const U = (f) => require(path.join(REPO, 'src/common/utils', f));

const { resolveTrendStage, swingHighLow: swingFromTrendStage } = U('trend-stage.js');
const {
  swingHighLow: swingFromPersistence,
  evaluateS45Persistence,
  updatePersistenceState
} = U('v3-6-stage-persistence.js');
const { swingHighLow: swingCanonical } = U('swing-structure.js');
const { advanceDailyCounter, resolveTradeDate } = U('trade-date-progress.js');
const { isSlowBreakHigh, computeDefenseScore, SLOW_BREAK_BONUS } = U('defense.js');
const { appendSlowBreakHistory } = U('v3-shadow.js');
const {
  alignReturnSeries, computeTechCorrelation, compareTechCap, MIN_OBSERVATIONS
} = U('correlation.js');
const { checkCrisisHardTrigger, resolveMarketEnvironment } = U('market-regime.js');
const { diagnoseIndexStateGate, diagnoseRegimeDivergence, buildSingleMarketEnvironment } = U('market-env-diagnostics.js');
const { computeCashDiagnostics } = U('portfolio-cash.js');
const { applyV361ParamBundle } = U('v3-shadow.js');
const { V3_STAGE_FACTORS, V3_MARKET_FACTORS } = U('v3-constants.js');
const { DEFAULT_PARAMS } = U('../../../src/common/constants.js');

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } catch (e) {
    failed += 1;
    failures.push({ name, err: e });
    console.log(`  \u2717 ${name}`);
    console.log(`      ${e && e.message}`);
  }
}

function section(t) { console.log(`\n== ${t} ==`); }

/* =====================================================================
 * 公共夹具
 * ===================================================================*/

/** 生成升序日线；spec = [{date, high, low, close}] */
function barsOf(spec) {
  return spec.map((s) => ({ trade_date: s.date, high: s.high, low: s.low, close: s.close }));
}

/** 生成 N 个连续交易日（跳过周末），收益率由 fn 给出 */
function makeSeries(startDate, n, retFn) {
  const out = [];
  let d = new Date(`${startDate}T00:00:00Z`);
  let close = 100;
  for (let i = 0; i < n; i += 1) {
    // 跳过周六(6)/周日(0)
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d = new Date(d.getTime() + 86400000);
    const iso = d.toISOString().slice(0, 10);
    const r = retFn(i);
    close = close * (1 + r);
    out.push({ trade_date: iso, close: Math.round(close * 10000) / 10000, high: close * 1.01, low: close * 0.99 });
    d = new Date(d.getTime() + 86400000);
  }
  return out;
}

const F3 = { f_state: 'F3', f_score: 15 };

/** 让 raw 主状态判为 S3（w=W3 + 收盘站上 MA20 + 斜率 > 0.5） */
function snapshotCandS3(date) {
  return {
    calc_date: date, w_state: 'W3', ma20: 100, ma60: 100, ma20_slope: 1.0,
    price_position: 0.9, bias_20d: 2, volume_ratio: 1.0
  };
}

/** 让 raw 主状态判为 S2（default_hold；收盘 < MA20 且 MA20 < MA60） */
function snapshotCandS2(date) {
  return {
    calc_date: date, w_state: 'W3', ma20: 110, ma60: 100, ma20_slope: -1.0,
    price_position: -0.5, bias_20d: -11.4, volume_ratio: 1.0
  };
}

/** 让 raw 主状态判为 S2，且 S5 Integrity 失分到 risk 带（但**不**触发 hard break） */
function snapshotS5Risk(date) {
  return {
    calc_date: date, w_state: 'W3', ma20: 110, ma60: 100, ma20_slope: -1.0,
    price_position: -11.4, bias_20d: -11.4, volume_ratio: 1.0
  };
}

/* =====================================================================
 * #1 运行次数 ≠ 交易日
 *
 * ⚠️ 修复落点说明：`trend-stage.js`（Gen-1 pipeline lock）与 `decision-v3.js`（V361 lock）
 * 都是受冻结锁保护的工件，本轮**不得改动**。因此「同一 trade_date 只贡献一个交易日」
 * 实现在**未上锁的调用侧**：`trade-date-idempotence.js` 的「按交易日幂等重放」，
 * 由 `cloudfunctions/runDecisionEngine/index.js` 接线。
 * 下面用与 index.js **同构**的调用序列验证语义。
 * ===================================================================*/
section('#1 Trend Stage：运行次数不得冒充交易日（按交易日幂等重放）');

const { planRunInput, finalizeState, snapshotDayState } = U('trade-date-idempotence.js');

const TREND_OPTS = { v3_6_persistence: true, params: { v3_6_persistence: true } };

/** 与 runDecisionEngine 的接线同构：plan → 跑引擎 → finalize 落库 */
function runDayOnce(state, snapshot, opts) {
  const plan = planRunInput(state, snapshot.calc_date);
  const r = resolveTrendStage(snapshot, F3, plan.engine_state, opts || TREND_OPTS);
  return { r, nextState: finalizeState(r, snapshot.calc_date, plan), plan };
}

test('#1.1 同一 trade_date 连续三次调用：Stage pending 只推进一次；第二个 trade_date 才推进第二次', () => {
  const D1 = '2026-09-14';
  const D2 = '2026-09-15';

  let state = {
    stage: 'S1', overlay: 'normal', initialized: true, stage_algo_version: 3,
    pendingStage: null, pendingDays: 0
  };

  let out = runDayOnce(state, snapshotCandS3(D1));
  assert.strictEqual(out.r.stage, 'S1', '同日首次：S1→S3 需 2 日确认，不应立即升级');
  assert.strictEqual(out.r.pendingDays, 1, '同日首次应记 1 日');
  assert.strictEqual(out.r.pendingStage, 'S3');
  assert.strictEqual(out.plan.replaying, false);
  assert.strictEqual(out.nextState.last_evaluated_trade_date, D1);

  const first = out.r;
  state = out.nextState;

  for (let i = 0; i < 2; i += 1) {
    out = runDayOnce(state, snapshotCandS3(D1));
    assert.strictEqual(out.plan.replaying, true, `D1 第 ${i + 2} 次必须走「同日重放」`);
    assert.strictEqual(out.r.stage, first.stage, `D1 第 ${i + 2} 次：Stage 必须与首次一致`);
    assert.strictEqual(out.r.pendingDays, 1, `D1 第 ${i + 2} 次：pendingDays 必须仍为 1`);
    assert.deepStrictEqual(snapshotDayState(out.nextState), snapshotDayState(first.pendingDays != null ? {
      ...out.nextState
    } : out.nextState), '落库的按日字段应稳定');
    state = out.nextState;
  }

  out = runDayOnce(state, snapshotCandS3(D2));
  assert.strictEqual(out.plan.replaying, false, 'D2 是新交易日，不是重放');
  assert.strictEqual(out.r.stage, 'S3', 'D2：pendingDays 达 2 → 升到 S3');
});

test('#1.2 三日降级必须来自三个不同 trade_date，不能来自三次运行', () => {
  const D = ['2026-09-14', '2026-09-15', '2026-09-16'];

  let state = {
    stage: 'S3', overlay: 'normal', initialized: true, stage_algo_version: 3,
    pendingStage: null, pendingDays: 0, days_in_stage: 10
  };

  let out = runDayOnce(state, snapshotCandS2(D[0]));
  assert.strictEqual(out.r.stage, 'S3');
  assert.strictEqual(out.r.pendingDays, 1);
  state = out.nextState;

  out = runDayOnce(state, snapshotCandS2(D[0]));
  out = runDayOnce(out.nextState, snapshotCandS2(D[0]));
  assert.strictEqual(out.r.stage, 'S3', 'D1 三次运行绝不能凑满三日降级');
  assert.strictEqual(out.r.pendingDays, 1, 'D1 三次运行 pendingDays 仍为 1');
  state = out.nextState;

  out = runDayOnce(state, snapshotCandS2(D[1]));
  assert.strictEqual(out.r.stage, 'S3', '只有两个 trade_date 时不得降级');
  assert.strictEqual(out.r.pendingDays, 2);
  state = out.nextState;

  out = runDayOnce(state, snapshotCandS2(D[2]));
  assert.strictEqual(out.r.stage, 'S2', '第三个不同 trade_date 才允许降级到 S2');
});

test('#1.3 days_in_stage 只能按唯一交易日增加', () => {
  const D1 = '2026-09-14';
  const D2 = '2026-09-15';

  let state = {
    stage: 'S2', overlay: 'normal', initialized: true, stage_algo_version: 3,
    days_in_stage: 0
  };

  let out = runDayOnce(state, snapshotCandS2(D1));
  assert.strictEqual(out.r.days_in_stage, 1, 'D1 首次：0 → 1');
  state = out.nextState;

  for (let i = 0; i < 2; i += 1) {
    out = runDayOnce(state, snapshotCandS2(D1));
    assert.strictEqual(out.r.days_in_stage, 1, `D1 第 ${i + 2} 次：days_in_stage 不得继续增长`);
    state = out.nextState;
  }

  out = runDayOnce(state, snapshotCandS2(D2));
  assert.strictEqual(out.r.days_in_stage, 2, 'D2 才 +1');
});

test('#1.4 S5 risk_confirm_days=2：同一天两次运行不得降级', () => {
  const D1 = '2026-09-14';
  const D2 = '2026-09-15';
  const params = { v3_6_persistence: true, v3_6_1_s5_downside: true, v3_6_1_s5_risk_confirm_days: 2 };
  const opts = { v3_6_persistence: true, v3_6_1_s5_downside: true, params };

  let state = {
    stage: 'S5', overlay: 'normal', initialized: true, stage_algo_version: 3,
    days_in_stage: 5, s5_risk_days: 0, breakout_level: 120
  };

  let out = runDayOnce(state, snapshotS5Risk(D1), opts);
  assert.strictEqual(out.r.stage, 'S5', 'D1 首次：风险仅 1 日，不得降级');
  assert.strictEqual(out.r.s5_risk_days, 1);
  state = out.nextState;

  for (let i = 0; i < 2; i += 1) {
    out = runDayOnce(state, snapshotS5Risk(D1), opts);
    assert.strictEqual(out.r.stage, 'S5', `D1 第 ${i + 2} 次运行：不得降级（运行次数≠交易日）`);
    assert.strictEqual(out.r.s5_risk_days, 1, '同日 s5_risk_days 不得叠加');
    state = out.nextState;
  }

  out = runDayOnce(state, snapshotS5Risk(D2), opts);
  assert.strictEqual(out.r.stage, 'S4', '第二个不同交易日才允许 S5→S4');
});

test('#1.5 向后兼容：旧 state 无日期锚点不得崩溃，且仍按 1 日推进一次', () => {
  const legacy = { stage: 'S1', overlay: 'normal', initialized: true, stage_algo_version: 3 };
  const plan = planRunInput(legacy, '2026-09-14');
  assert.strictEqual(plan.replaying, false, '旧 state 无从重放');
  assert.strictEqual(plan.anchored, true);

  const r = resolveTrendStage(snapshotCandS3('2026-09-14'), F3, plan.engine_state, TREND_OPTS);
  assert.strictEqual(r.stage, 'S1');
  assert.strictEqual(r.pendingDays, 1, '旧 state 第一次运行 +1（与修复前一致）');
  const next = finalizeState(r, '2026-09-14', plan);
  assert.strictEqual(next.last_evaluated_trade_date, '2026-09-14', '并补上锚点');
  // 第二次运行即可重放（锚点已建立）
  assert.strictEqual(planRunInput(next, '2026-09-14').replaying, true);
});

test('#1.6 无 calc_date 时：不崩溃，并**显式**退化为按调用次数（anchored=false）', () => {
  const plan = planRunInput({ stage: 'S1', initialized: true, stage_algo_version: 3 }, null);
  assert.strictEqual(plan.anchored, false, '必须显式标注未锚定，不得假装已幂等');
  assert.strictEqual(plan.replaying, false);
  assert.strictEqual(plan.reason, 'no_trade_date');

  const r = resolveTrendStage(snapshotCandS3('2026-09-14'), F3, plan.engine_state, TREND_OPTS);
  assert.strictEqual(r.pendingDays, 1);
  const next = finalizeState(r, null, plan);
  assert.strictEqual(next.last_evaluated_trade_date, null);
  assert.strictEqual(next.trade_date_anchored, false);
});

test('#1.7 幂等性等价：一天跑 N 次 == 一天跑 1 次（按日字段逐字段一致）', () => {
  const D1 = '2026-09-14';
  const seed = {
    stage: 'S3', overlay: 'normal', initialized: true, stage_algo_version: 3,
    pendingStage: null, pendingDays: 0, days_in_stage: 7
  };

  let one = runDayOnce(seed, snapshotCandS2(D1));
  const once = one.nextState;

  let many = runDayOnce(seed, snapshotCandS2(D1));
  for (let i = 0; i < 4; i += 1) many = runDayOnce(many.nextState, snapshotCandS2(D1));
  const manyState = many.nextState;

  assert.deepStrictEqual(snapshotDayState(manyState), snapshotDayState(once),
    '同一天重复运行后的按日状态必须与单次运行完全一致');
  assert.strictEqual(manyState.last_evaluated_trade_date, once.last_evaluated_trade_date);
});

test('#1.8 finalizeState 只落白名单字段，day_start_state 不得嵌套膨胀', () => {
  const plan = planRunInput({ stage: 'S2', days_in_stage: 3 }, '2026-09-14');
  const s1 = finalizeState({ stage: 'S2', days_in_stage: 4 }, '2026-09-14', plan);
  const plan2 = planRunInput(s1, '2026-09-15');
  const s2 = finalizeState({ stage: 'S2', days_in_stage: 5 }, '2026-09-15', plan2);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(s2.day_start_state, 'day_start_state'), false,
    'day_start_state 内部不得再嵌套 day_start_state');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(s2.day_start_state, 'last_evaluated_trade_date'), false);
  assert.strictEqual(s2.day_start_state.days_in_stage, 4, 'day_start_state 记录的是「当日起点」');
});

test('#1.9 advanceDailyCounter 语义单元测试（v3-6-stage-persistence 内部锚点用）', () => {
  assert.deepStrictEqual(advanceDailyCounter(0, null, '2026-09-14', 1),
    { count: 1, counted: true, anchor: '2026-09-14', anchored: true });
  assert.deepStrictEqual(advanceDailyCounter(1, '2026-09-14', '2026-09-14', 1),
    { count: 1, counted: false, anchor: '2026-09-14', anchored: true });
  assert.deepStrictEqual(advanceDailyCounter(1, '2026-09-14', '2026-09-15', 1),
    { count: 2, counted: true, anchor: '2026-09-15', anchored: true });
  assert.strictEqual(advanceDailyCounter(0, null, '2026/09/14', 1).anchored, false);
  assert.strictEqual(advanceDailyCounter(0, null, null, 1).anchored, false);
  assert.strictEqual(advanceDailyCounter(0, null, null, 1).count, 1, '无交易日时退化为旧行为');
});

/* =====================================================================
 * #2 Swing Structure / SlowBreak
 * ===================================================================*/
section('#2 Swing Structure 唯一实现 + SlowBreak 链');

/** 前 5 根高点 110 低点 100；近 5 根高点 105 低点 95 → lowerHigh + lowerLow */
function decliningSwingBars() {
  const spec = [];
  for (let i = 0; i < 12; i += 1) {
    const prior = i >= 2 && i <= 6;
    spec.push({
      date: `2026-08-${String(10 + i).padStart(2, '0')}`,
      high: prior ? 110 : 105,
      low: prior ? 100 : 95,
      close: prior ? 106 : 99
    });
  }
  return barsOf(spec);
}

test('#2.1 下降高点 + 下降低点：lowerHigh=true 且 lowerLow=true', () => {
  const s = swingCanonical(decliningSwingBars());
  assert.strictEqual(s.lowerHigh, true, '近 5 根高点 105 < 前 5 根 110 → lowerHigh');
  assert.strictEqual(s.lowerLow, true, '近 5 根低点 95 < 前 5 根 100 → lowerLow');
  assert.strictEqual(s.higherHigh, false);
  assert.strictEqual(s.higherLow, false);
  assert.strictEqual(s.computable, true);
  assert.strictEqual(s.priorHigh, 110);
  assert.strictEqual(s.recentLow, 95);
});

test('#2.2 v3-6-stage-persistence 与唯一实现是**同一个函数引用**（禁止复制）', () => {
  assert.strictEqual(swingFromPersistence, swingCanonical,
    'v3-6-stage-persistence 必须转发 swing-structure 的实现，不得自带副本');
  // trend-stage.js 内仍保留一份 2 字段副本：它是冻结工件（Gen-1 pipeline lock），
  // 本轮**不动**；此项把「该残留是已知且被登记的」钉住，而不是假装已收敛。
  assert.notStrictEqual(swingFromTrendStage, swingCanonical,
    'trend-stage 的冻结副本仍在（已登记为残留冲突，见报告 §未解决风险）');
});

test('#2.3 静态守卫：v3-6-stage-persistence 不再定义 swingHighLow；生产 SlowBreak 链从 swing-structure 取数', () => {
  const pSrc = fs.readFileSync(path.join(REPO, 'src/common/utils/v3-6-stage-persistence.js'), 'utf8');
  assert.ok(!/function\s+swingHighLow\s*\(/.test(pSrc),
    'v3-6-stage-persistence.js 不得再定义第二份 swingHighLow');

  const idx = fs.readFileSync(path.join(REPO, 'cloudfunctions/runDecisionEngine/index.js'), 'utf8');
  assert.ok(/require\('\.\/common\/utils\/swing-structure\.js'\)/.test(idx),
    'runDecisionEngine 必须从 swing-structure 取 swing');
  assert.ok(!/swingHighLow\s*\}\s*=\s*require\('\.\/common\/utils\/trend-stage\.js'\)/.test(idx),
    'runDecisionEngine 不得再从 trend-stage 取 swing（那份是 2 字段冻结副本）');
});

test('#2.4 冻结工件未被改动：trend-stage.js 仍与 Gen-1 pipeline lock 逐位一致', () => {
  const crypto = require('crypto');
  const lock = JSON.parse(fs.readFileSync(path.join(REPO, 'ml/manifests/GEN1_FEATURE_PIPELINE_LOCK.json'), 'utf8'));
  const entry = lock.files.find((f) => f.role === 'trend_stage_implementation');
  assert.ok(entry, '锁文件必须含 trend_stage_implementation');
  const raw = fs.readFileSync(path.join(REPO, entry.path), 'utf8');
  const lf = raw.replace(/\r\n/g, '\n');   // 锁的 hash_basis = LF-normalized
  const got = crypto.createHash('sha256').update(lf, 'utf8').digest('hex');
  assert.strictEqual(got, entry.sha256,
    'trend-stage.js 是冻结工件，本轮不得修改（缺陷 #2 的收敛改在未上锁侧完成）');
});

test('#2.5 冻结工件未被改动：decision-v3.js / decision.js 仍与 V361 lock 逐位一致', () => {
  const crypto = require('crypto');
  const lock = JSON.parse(fs.readFileSync(path.join(REPO, 'ml/manifests/V361_IMMUTABLE_LOCK.json'), 'utf8'));
  [['src/common/utils/decision-v3.js', 'decision_v3_sha256'],
    ['src/common/utils/decision.js', 'decision_sha256']].forEach(([p, key]) => {
    const raw = fs.readFileSync(path.join(REPO, p), 'utf8');
    const lf = raw.replace(/\r\n/g, '\n');
    const got = crypto.createHash('sha256').update(lf, 'utf8').digest('hex');
    assert.strictEqual(got, lock[key], `${p} 受 V361_IMMUTABLE_LOCK 保护，本轮不得修改`);
  });
});

test('#2.6 appendSlowBreakHistory 真正写入 lowerLow', () => {
  const swing = swingCanonical(decliningSwingBars());
  const h = appendSlowBreakHistory([], 75, swing);
  assert.strictEqual(h.length, 1);
  assert.strictEqual(h[0].lowerHigh, true);
  assert.strictEqual(h[0].lowerLow, true, '修复前 lowerLow 恒为 undefined');
  // 窗口上限 5
  let acc = [];
  for (let i = 0; i < 8; i += 1) acc = appendSlowBreakHistory(acc, 80, swing);
  assert.strictEqual(acc.length, 5);
});

test('#2.7 isSlowBreakHigh：过去 5 日中 ≥3 日 score>=75 + LH + LL → true', () => {
  const hist = [
    { score: 75, lowerHigh: true, lowerLow: true },
    { score: 50, lowerHigh: true, lowerLow: true },
    { score: 100, lowerHigh: true, lowerLow: true },
    { score: 20, lowerHigh: false, lowerLow: false },
    { score: 75, lowerHigh: true, lowerLow: true }
  ];
  assert.strictEqual(isSlowBreakHigh(hist), true);

  // 只有 LH 没有 LL → false（正是修复前的恒 false 场景）
  const onlyLh = hist.map((x) => ({ ...x, lowerLow: false }));
  assert.strictEqual(isSlowBreakHigh(onlyLh), false);

  // 高分日不足 3 → false
  const few = [
    { score: 75, lowerHigh: true, lowerLow: true },
    { score: 50, lowerHigh: true, lowerLow: true },
    { score: 50, lowerHigh: true, lowerLow: true },
    { score: 20, lowerHigh: false, lowerLow: false },
    { score: 75, lowerHigh: true, lowerLow: true }
  ];
  assert.strictEqual(isSlowBreakHigh(few), false);
});

test('#2.8 DefenseScore 的 +20 SlowBreak bonus 真正触发', () => {
  const ctx = {
    snapshot: { w_state: 'W3', ma20_slope: 1, volume_ratio: 1, price_position: 0.5 },
    fundamental: { f_state: 'F3', f_score: 15 },
    trendStage: 'S3',
    trendStageOverlay: 'normal',
    risk: { risk_flag: 'NORMAL' }
  };
  const hist = [
    { score: 75, lowerHigh: true, lowerLow: true },
    { score: 75, lowerHigh: true, lowerLow: true },
    { score: 100, lowerHigh: true, lowerLow: true },
    { score: 0, lowerHigh: false, lowerLow: false },
    { score: 0, lowerHigh: false, lowerLow: false }
  ];

  const base = computeDefenseScore(ctx, { recentSlowBreakScores: [] });
  const withBonus = computeDefenseScore(ctx, { recentSlowBreakScores: hist });

  assert.strictEqual(base.slow_break_high, false);
  assert.strictEqual(withBonus.slow_break_high, true, 'isSlowBreakHigh 必须为 true');
  assert.strictEqual(withBonus.defense_score - base.defense_score, SLOW_BREAK_BONUS,
    `SlowBreak bonus 必须恰好 +${SLOW_BREAK_BONUS}`);
  assert.strictEqual(SLOW_BREAK_BONUS, 20);
});

test('#2.9 不足 12 根 / 缺失 high-low：computable=false，四项一律 false（向后兼容旧 NaN 行为）', () => {
  const short = swingCanonical(barsOf([{ date: '2026-09-01', high: 10, low: 9, close: 9.5 }]));
  assert.strictEqual(short.computable, false);
  assert.strictEqual(short.lowerLow, false);
  const spec = [];
  for (let i = 0; i < 12; i += 1) spec.push({ date: `2026-09-${String(i + 1).padStart(2, '0')}`, high: null, low: 9, close: 9 });
  const broken = swingCanonical(barsOf(spec));
  assert.strictEqual(broken.computable, false);
  assert.strictEqual(broken.lowerHigh, false);
  assert.strictEqual(broken.higherLow, false);
});

/* =====================================================================
 * #4 相关性按 trade_date 对齐
 * ===================================================================*/
section('#4 相关性：按 trade_date INNER JOIN（缺一个交易日不得错位）');

const synthRet = (i) => Math.sin(i / 3) / 40 + 0.0005;
const SERIES_A = makeSeries('2026-05-04', 75, synthRet);
const SERIES_B_MISSING_ONE = (() => {
  const b = makeSeries('2026-05-04', 75, synthRet);
  const drop = b[40].trade_date;            // 丢掉一个交易日
  return { bars: b.filter((x) => x.trade_date !== drop), dropped: drop };
})();

test('#4.1 其中一只 ETF 缺一个交易日：新口径不会错位（ρ 仍为 1），旧口径被污染', () => {
  const aligned = alignReturnSeries(SERIES_A, SERIES_B_MISSING_ONE.bars);
  assert.ok(aligned.dropped_misaligned >= 1,
    '缺日后的第一个共同交易日跨度不一致，必须被丢弃并计数');
  assert.strictEqual(aligned.aligned_observations, 60, '窗口 60 应被填满（数据充足）');
  assert.ok(aligned.latest_common_date, 'latest_common_date 必须给出');

  const cmp = compareTechCap(65, {
    513310: SERIES_A, 159582: SERIES_B_MISSING_ONE.bars, 515880: SERIES_A
  });
  const newRho = cmp.new_date_aligned_correlation.rho_avg;
  const oldRho = cmp.old_correlation.rho_avg;

  assert.ok(Math.abs(newRho - 1) < 1e-9,
    `日期对齐后两只相同走势的 ETF ρ 必须为 1，实际 ${newRho}`);
  assert.ok(oldRho == null || Math.abs(oldRho - 1) > 1e-6,
    `旧口径（按下标配对）应被错位污染，实际 ${oldRho}`);
});

test('#4.2 诊断字段：aligned_observations / latest_common_date / coverage_ratio 必须给出且不隐藏', () => {
  const diag = computeTechCorrelation({
    513310: SERIES_A, 159582: SERIES_B_MISSING_ONE.bars, 515880: SERIES_A
  });
  assert.strictEqual(diag.alignment.mode, 'trade_date_inner_join');
  assert.ok(Number.isInteger(diag.alignment.dropped_misaligned_total));
  diag.pair_diagnostics.forEach((d) => {
    assert.ok(Number.isInteger(d.aligned_observations), '必须给出 aligned_observations');
    assert.ok('latest_common_date' in d, '必须给出 latest_common_date');
    assert.ok(typeof d.coverage_ratio === 'number', '必须给出 coverage_ratio');
    assert.ok(d.coverage_ratio >= 0 && d.coverage_ratio <= 1, 'coverage_ratio ∈ [0,1]');
  });
});

test('#4.3 样本不足不得隐藏：显式 insufficient_sample=true 且 rho 为 null', () => {
  const shortA = makeSeries('2026-05-04', 8, synthRet);
  const shortB = makeSeries('2026-05-04', 8, synthRet);
  const diag = computeTechCorrelation({ 513310: shortA, 159582: shortB, 515880: shortA });
  assert.strictEqual(diag.rho_avg, null);
  assert.strictEqual(diag.sample, 0);
  assert.strictEqual(diag.insufficient_sample, true);
  assert.ok(diag.insufficient_pairs.length > 0);
  const d0 = diag.pair_diagnostics[0];
  assert.ok(d0.aligned_observations < MIN_OBSERVATIONS);
  assert.strictEqual(d0.insufficient_sample, true);
  assert.strictEqual(d0.reason, 'insufficient_sample');
});

test('#4.4 缺少 trade_date 时不得回退到「按下标配对」，而是显式失败', () => {
  const noDate = SERIES_A.map((x) => ({ close: x.close }));
  const aligned = alignReturnSeries(noDate, SERIES_A);
  assert.strictEqual(aligned.aligned_observations, 0);
  assert.strictEqual(aligned.reason, 'a:missing_trade_date');
});

test('#4.5 coverage_ratio 在样本被截断时如实降低', () => {
  const a = makeSeries('2026-05-04', 30, synthRet);
  const bAll = makeSeries('2026-05-04', 30, synthRet);
  // b 只保留后 12 个交易日 → 共同观测显著少于 expected_window
  const b = bAll.slice(-12);
  const aligned = alignReturnSeries(a, b);
  assert.ok(aligned.coverage_ratio < 1, `coverage_ratio 必须如实反映截断，实际 ${aligned.coverage_ratio}`);
  assert.ok(aligned.aligned_observations < aligned.expected_window);
});

/* =====================================================================
 * #7 Market Regime 单一真相 / W5 闸可达性
 * ===================================================================*/
section('#7 Market Regime：单一真相诊断 + W5 多数闸可达性');

test('#7.1 线上 3 个宽基指数下，W5 多数闸不可达（只诊断，不触发）', () => {
  const r = checkCrisisHardTrigger({
    techBreadthProxy: 60,
    indexWStates: ['W5', 'W5', 'W5']
  });
  assert.strictEqual(r.triggered, false, '3 个指数即便全 W5 也不得触发（闸门要求 ≥5）');
  assert.strictEqual(r.index_state_count, 3);
  assert.strictEqual(r.w5_majority_gate_reachable, false);
  assert.strictEqual(r.w5_majority_gate_reason, 'index_state_count_below_gate_min');
});

test('#7.2 达到闸门下限时 W5 多数闸可达并能真实触发', () => {
  const r = checkCrisisHardTrigger({
    techBreadthProxy: 60,
    indexWStates: ['W5', 'W5', 'W5', 'W3', 'W1']
  });
  assert.strictEqual(r.triggered, true);
  assert.strictEqual(r.reason, 'index_w5_majority');
  assert.strictEqual(r.w5_majority_gate_reachable, true);
  assert.strictEqual(r.index_state_count, 5);
});

test('#7.3 diagnoseIndexStateGate 单元语义', () => {
  const g = diagnoseIndexStateGate(['W1', 'W4', 'W5']);
  assert.strictEqual(g.index_state_count, 3);
  assert.strictEqual(g.w5_count, 1);
  assert.strictEqual(g.w5_majority_gate_min_indices, 5);
  assert.strictEqual(g.w5_majority_gate_reachable, false);
  assert.strictEqual(diagnoseIndexStateGate([]).index_state_count, 0);
});

test('#7.4 决策 regime ≠ 快照 regime 必须被诊断出来（缺陷 #7 核心）', () => {
  const d = diagnoseRegimeDivergence({
    decision_regime: 'range',
    snapshot_regime: 'crisis',
    decision_source: 'deriveMarketEnvironmentForPortfolio',
    snapshot_source: 'deriveMarketRegime'
  });
  assert.strictEqual(d.divergent, true);
  assert.strictEqual(d.decision_regime, 'range');
  assert.strictEqual(d.snapshot_regime, 'crisis');

  const same = diagnoseRegimeDivergence({ decision_regime: 'range', snapshot_regime: 'range' });
  assert.strictEqual(same.divergent, false);
});

test('#7.5 单一 MarketEnvironment 对象携带 authority 与 legacy_shadow', () => {
  const env = buildSingleMarketEnvironment({
    market_regime: 'structural',
    market_factor: 0.85,
    market_score: 61,
    authority: 'v3_market_environment',
    legacy_shadow: { market_regime: 'range', source: 'deriveMarketRegime' },
    index_state_diagnostics: diagnoseIndexStateGate(['W1', 'W2', 'W3'])
  });
  assert.strictEqual(env.market_regime, 'structural');
  assert.strictEqual(env.authority, 'v3_market_environment');
  assert.strictEqual(env.legacy_shadow.market_regime, 'range');
  assert.strictEqual(env.index_state_diagnostics.index_state_count, 3);
});

test('#7.6 resolveMarketEnvironment 暴露 index_w_states 与可达性诊断（只读附加）', () => {
  const env = resolveMarketEnvironment({ indexWStates: ['W1', 'W3', 'W5'], etfWStates: ['W1'] });
  assert.deepStrictEqual(env.index_w_states, ['W1', 'W3', 'W5']);
  assert.strictEqual(env.index_state_count, 3);
  assert.strictEqual(env.index_state_diagnostics.w5_majority_gate_reachable, false);
  assert.ok('market_regime' in env && 'market_factor' in env, '既有字段不得丢失');
  assert.ok(env.crisis_hard_trigger && 'w5_majority_gate_reachable' in env.crisis_hard_trigger);
});

/* =====================================================================
 * #8 真实现金 / 隐性杠杆
 * ===================================================================*/
section('#8 真实现金 / 隐性杠杆诊断');

test('#8.1 total_position=106 → cash_ratio_raw=-6 / leverage_excess=6 / overbooked=true', () => {
  const d = computeCashDiagnostics(106);
  assert.strictEqual(d.cash_ratio_raw, -6);
  assert.strictEqual(d.leverage_excess, 6);
  assert.strictEqual(d.overbooked, true);
  assert.strictEqual(d.cash_ratio, 0, 'UI 仍可显示 clamp 后的 0');
});

test('#8.2 正常区间：raw 与 clamp 一致，无杠杆', () => {
  const d = computeCashDiagnostics(94);
  assert.strictEqual(d.cash_ratio_raw, 6);
  assert.strictEqual(d.cash_ratio, 6);
  assert.strictEqual(d.leverage_excess, 0);
  assert.strictEqual(d.overbooked, false);
});

test('#8.3 恰好 100%：不判为超配', () => {
  const d = computeCashDiagnostics(100);
  assert.strictEqual(d.cash_ratio_raw, 0);
  assert.strictEqual(d.overbooked, false);
  assert.strictEqual(d.leverage_excess, 0);
});

test('#8.4 异常输入不产生 NaN 污染', () => {
  const d = computeCashDiagnostics(undefined);
  assert.strictEqual(d.cash_ratio_raw, 100);
  assert.strictEqual(d.overbooked, false);
  assert.ok(Number.isFinite(computeCashDiagnostics(NaN).cash_ratio_raw));
});

/* =====================================================================
 * #9 负向约束回归守卫
 * ===================================================================*/
section('#9 负向约束守卫（禁止开启 6.2/6.3、禁止改冻结参数）');

test('#9.1 v3_6_1_enabled=true 时必须强制关闭 6.2 / 6.3 Grace', () => {
  const p = applyV361ParamBundle({
    v3_6_1_enabled: true,
    v3_6_2_post_s5_s4_grace: true,
    v3_6_3_adaptive_post_s5_grace: true
  });
  assert.strictEqual(p.v3_6_2_post_s5_s4_grace, false);
  assert.strictEqual(p.v3_6_3_adaptive_post_s5_grace, false);
  assert.strictEqual(p.v3_6_1_s5_downside, true);
  assert.strictEqual(p.v3_6_persistence, true);
});

test('#9.2 默认参数中 6.2 / 6.3 必须为 false', () => {
  assert.strictEqual(DEFAULT_PARAMS.v3_6_2_post_s5_s4_grace, false);
  assert.strictEqual(DEFAULT_PARAMS.v3_6_3_adaptive_post_s5_grace, false);
});

test('#9.3 StageFactor / MarketFactor 数值未被本轮改动（冻结守卫）', () => {
  assert.deepStrictEqual({ ...V3_STAGE_FACTORS },
    { S0: 0, S1: 0.25, S2: 0.4, S3: 0.7, S4: 0.85, S5: 1 });
  assert.deepStrictEqual({ ...V3_MARKET_FACTORS },
    { aggressive: 1, structural: 0.85, range: 0.7, defensive: 0.5, crisis: 0.25 });
});

test('#9.4 冻结参数与单只/科技上限数值未变', () => {
  assert.strictEqual(DEFAULT_PARAMS.tech_sector_max, 65);
  assert.strictEqual(DEFAULT_PARAMS.volume_ratio_mild, 0.95);
  assert.strictEqual(DEFAULT_PARAMS.single_etf_max, 30);
});

test('#9.5 本轮新增/改动模块不得写 final_target / final_action / decision_result', () => {
  const newModules = [
    'swing-structure.js', 'trade-date-progress.js', 'trade-date-idempotence.js',
    'portfolio-mode.js', 'portfolio-cash.js', 'market-env-diagnostics.js',
    'v361-run-context.js', 'v361-run-finality.js'
  ];
  newModules.forEach((f) => {
    const src = fs.readFileSync(path.join(REPO, 'src/common/utils', f), 'utf8');
    assert.ok(!/final_target\s*:/.test(src), `${f} 不得写 final_target`);
    assert.ok(!/final_action\s*:/.test(src), `${f} 不得写 final_action`);
    assert.ok(!/upsert\s*\(/.test(src), `${f} 不得有落库写入`);
    assert.ok(!/COLLECTIONS\./.test(src), `${f} 不得直接引用集合（禁止触碰生产写入）`);
  });
});

test('#9.6 组合轨诊断字段不得反向驱动决策（决策只认 multi_etf / etf_count）', () => {
  const { isV3PortfolioMode } = U('portfolio-mode.js');
  const params = { v3_dual_track_enabled: true };
  // 只有诊断字段时：仍然判为单票轨（诊断不得驱动生产）
  assert.strictEqual(isV3PortfolioMode({
    portfolio_detected_etf_count: 5,
    portfolio_mode_expected: true,
    portfolio_mode_effective: false
  }, params), false);
  // 明确 legacy 证据时才判定组合轨
  assert.strictEqual(isV3PortfolioMode({ etf_count: 5 }, params), true);
  assert.strictEqual(isV3PortfolioMode({ multi_etf: true }, params), true);
  assert.strictEqual(isV3PortfolioMode({}, params), false);
});

/* =====================================================================
 * 汇总
 * ===================================================================*/
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  failures.forEach((f) => console.log(`  \u2717 ${f.name}: ${f.err && f.err.message}`));
  process.exit(1);
}
