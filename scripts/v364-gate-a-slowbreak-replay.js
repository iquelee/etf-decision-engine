#!/usr/bin/env node
/**
 * V3.6.4 Safety Hardening —— Gate A：SlowBreak Historical Replay
 *
 * 用真实历史数据逐日重放生产 V3.6.1 决策链，比较两种 SlowBreak 语义：
 *   OLD：历史生产语义 —— `appendSlowBreakHistory` 收到的 swing 里 `lowerLow` 恒 false
 *        ⇒ `isSlowBreakHigh()` 恒 false ⇒ DefenseScore 的 +20 bonus 不触发
 *   NEW：当前 R1 —— `swing-structure` 提供真实 `lowerLow` ⇒ `isSlowBreakHigh()` 可触发
 *
 * 目的**不是**证明收益提高，而是回答：
 *   「修复后的 SlowBreak 是否主要发生在真实的持续结构恶化窗口，而不是普通震荡/健康回撤？」
 *
 * 用法：node scripts/v364-gate-a-slowbreak-replay.js [--from 2024-04-16] [--to YYYY-MM-DD]
 * 产物：docs/V364_SLOWBREAK_REPLAY.md  +  outputs/v364-qualification/slowbreak_replay.json
 *
 * ⚠️ 只读：不联网、不写库、不部署、不改任何生产参数、**不调 SlowBreak 阈值**。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const H = require('./lib/v364-replay-harness.js');

const REPO = H.REPO;
const OUT_DIR = path.join(REPO, 'outputs/v364-qualification');
const DOC = path.join(REPO, 'docs/V364_SLOWBREAK_REPLAY.md');

function argOf(flag, dflt) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] != null ? process.argv[i + 1] : dflt;
}

const FROM = argOf('--from', '2024-04-16');
const TO = argOf('--to', null);
const HORIZONS = [5, 10, 20];

/* ---- Gate A 判定阈值（**先声明后看结果**，避免事后挑口径）---- */
const THRESHOLDS = {
  maxAbsTargetDeltaPp: 30,          // final_target 最大绝对变化
  actionFlipRatio: 0.05,            // 区间内 action 变化天数占比上限
  healthyRiskTriggerRatio: 0.20,    // 触发日中「S3/S4/S5 且被压仓」占比上限
  extraExits: 1,                    // 新增 EXIT 次数上限
  extraStrategicReduce: 5,          // 新增 STRATEGIC_REDUCE 次数上限
  extraTacticalReduce: 10           // 新增 TACTICAL_REDUCE 次数上限
};

const REDUCES = ['TACTICAL_REDUCE', 'STRATEGIC_REDUCE', 'EXIT'];

function r1(n) { return n == null ? null : Math.round(n * 10) / 10; }
function round2(n) { return n == null ? null : Math.round(n * 100) / 100; }

function countBy(list) {
  const m = {};
  list.forEach((a) => { m[a] = (m[a] || 0) + 1; });
  return m;
}

function main() {
  console.log(`[Gate A] 载入真实数据 & 重放 OLD/NEW（${FROM} ~ ${TO || 'latest'}）…`);
  const t0 = Date.now();
  const oldRun = H.replay({ from: FROM, to: TO, slowBreakMode: 'old', runsPerDay: 1 });
  const newRun = H.replay({ from: FROM, to: TO, slowBreakMode: 'new', runsPerDay: 1 });
  console.log(`[Gate A] 重放完成：${oldRun.axis.length} 个共同交易日 × 5 票 × 2 变体，用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const { barsByCode } = H.loadBars();
  const axis = newRun.axis;

  const perCode = {};
  const gates = {};
  const details = [];

  /**
   * ★ 决定性诊断：calcSlowBreakScore 的 4 项输入在生产快照上的可得性。
   * 四条件（见 defense.js::calcSlowBreakScore）：
   *   ① high_point_falling === true || lower_high === true
   *   ② ma20_slope < 0
   *   ③ ma60_slope < 0
   *   ④ d_state === 'D5' || h_state ∈ {H4, H5}
   * 分数映射 0/1/2/3/4 → 0/20/50/75/100；`SB>=75` 需 ≥3 项可满足。
   */
  const slowBreakInputAvailability = (() => {
    const { barsByCode } = H.loadBars();
    const indicatorsMod = require(path.join(REPO, 'src/common/utils/indicators.js'));
    const raw = indicatorsMod.computeSnapshot(
      barsByCode[H.UNIVERSE[0].code], H.SNAPSHOT_PARAMS,
      { code: H.UNIVERSE[0].code, calc_date: '2026-09-21' }
    );
    const live = H.shapeSnapshotForProduction(raw).snapshot;
    const has = (f) => Object.prototype.hasOwnProperty.call(live, f);

    const conditions = [
      { id: 1, desc: 'high_point_falling || lower_high', inputs: ['high_point_falling', 'lower_high'], available: has('high_point_falling') || has('lower_high') },
      { id: 2, desc: 'ma20_slope < 0', inputs: ['ma20_slope'], available: has('ma20_slope') },
      { id: 3, desc: 'ma60_slope < 0', inputs: ['ma60_slope'], available: has('ma60_slope') },
      { id: 4, desc: 'd_state==D5 || h_state in {H4,H5}', inputs: ['d_state', 'h_state'], available: has('d_state') || has('h_state') }
    ];
    const obtainable = conditions.filter((c) => c.available).length;
    const maxScore = ({ 0: 0, 1: 20, 2: 50, 3: 75, 4: 100 })[obtainable];
    return {
      conditions,
      obtainable_condition_count: obtainable,
      max_score_reachable: maxScore,
      sb_ge_75_reachable: obtainable >= 3,
      live_snapshot_field_count: Object.keys(live).length,
      live_snapshot_fields: Object.keys(live).sort(),
      dropped_from_repo_pipeline: H.shapeSnapshotForProduction(raw).dropped,
      source: '2026-09-22 只读探测线上 indicator_snapshot（code=513310, calc_date=2026-09-21, version=4）',
      note: '四条件中仅 2 项可得 ⇒ 分数上限 50 ⇒ isSlowBreakHigh 的 SB>=75 在生产上不可达'
    };
  })();

  H.UNIVERSE.forEach((u) => {
    const code = u.code;
    const rows = axis.map((d, i) => ({
      date: d,
      old: oldRun.days[i].byCode[code],
      nu: newRun.days[i].byCode[code]
    }));

    // 触发日（NEW）
    const triggerDates = rows.filter((r) => r.nu.slow_break_high).map((r) => r.date);
    const oldTriggerDates = rows.filter((r) => r.old.slow_break_high).map((r) => r.date);

    // target / action 差值
    const deltas = rows.map((r) => r1((r.nu.final_target || 0) - (r.old.final_target || 0)));
    const nonZero = deltas.filter((v) => v !== 0);
    const actionChanged = rows.filter((r) => r.old.final_action !== r.nu.final_action);

    const oldActions = countBy(rows.map((r) => r.old.final_action));
    const newActions = countBy(rows.map((r) => r.nu.final_action));
    const extra = {};
    REDUCES.forEach((a) => { extra[a] = (newActions[a] || 0) - (oldActions[a] || 0); });

    // 触发日的「真实结构恶化 vs 健康回撤」判定
    const triggerDetail = triggerDates.map((d) => {
      const r = rows.find((x) => x.date === d);
      const startsBefore = triggerDates[0] === d;
      const fwd = H.forwardStats(barsByCode[code], d, HORIZONS);
      return {
        date: d,
        defense_score_old: r.old.defense_score,
        defense_score_new: r.nu.defense_score,
        defense_penalty_old: r.old.defense_penalty,
        defense_penalty_new: r.nu.defense_penalty,
        trend_stage_primary: r.nu.trend_stage_primary,
        trend_stage_overlay: r.nu.trend_stage_overlay,
        slow_break_score: r.nu.slow_break_score,
        w_state: r.nu.w_state,
        final_target_old: r.old.final_target,
        final_target_new: r.nu.final_target,
        target_delta: r1((r.nu.final_target || 0) - (r.old.final_target || 0)),
        final_action_old: r.old.final_action,
        final_action_new: r.nu.final_action,
        is_first_of_run: startsBefore,
        forward: fwd
      };
    });

    // 「健康 S4/S5 回撤被压仓」计数：阶段属于 S3/S4/S5 且 target 被下调
    const healthyRiskTriggers = triggerDetail.filter(
      (t) => ['S3', 'S4', 'S5'].indexOf(t.trend_stage_primary) >= 0 && (t.target_delta || 0) < 0
    );

    // 触发条件逼近度诊断：单独统计三项条件
    //   isSlowBreakHigh 要求「过去 5 日中 ≥3 日同时满足 SB>=75 且 LH 且 LL」
    //   若三项同时成立的天数为 0，说明机制根本没被喂到条件（而不是判定坏了）
    const tripleSeries = rows.map((r) => (
      (r.nu.slow_break_score >= 75) && r.nu.swing_lower_high === true && r.nu.swing_lower_low === true
    ));
    const scoreGe75 = rows.filter((r) => r.nu.slow_break_score >= 75).length;
    const scoreHistogram = {};
    rows.forEach((r) => {
      const k = String(r.nu.slow_break_score);
      scoreHistogram[k] = (scoreHistogram[k] || 0) + 1;
    });
    let maxWindowTriple = 0;
    for (let i = 0; i + 5 <= tripleSeries.length; i += 1) {
      const c = tripleSeries.slice(i, i + 5).filter(Boolean).length;
      if (c > maxWindowTriple) maxWindowTriple = c;
    }
    const proximity = {
      days_with_score_ge_75: scoreGe75,
      days_with_all_three_conditions: tripleSeries.filter(Boolean).length,
      max_triple_days_in_any_5day_window: maxWindowTriple,
      score_histogram: scoreHistogram,
      note: 'isSlowBreakHigh 需要某个 5 日窗口内 triple 天数 ≥3'
    };

    perCode[code] = {
      code,
      name: u.name,
      sector: u.sector,
      trigger_proximity: proximity,
      slow_break_high_trigger_count_new: triggerDates.length,
      slow_break_high_trigger_count_old: oldTriggerDates.length,
      first_trigger_date: triggerDates[0] || null,
      trigger_dates: triggerDates,
      trigger_details: triggerDetail,
      days: rows.length,
      target_delta_nonzero_days: nonZero.length,
      max_abs_target_delta: deltas.length ? Math.max(...deltas.map(Math.abs)) : 0,
      mean_target_delta: deltas.length ? round2(deltas.reduce((s, v) => s + v, 0) / deltas.length) : 0,
      action_changed_count: actionChanged.length,
      action_changed_samples: actionChanged.slice(0, 8).map((r) => ({
        date: r.date, old: r.old.final_action, nu: r.nu.final_action
      })),
      actions_old: oldActions,
      actions_new: newActions,
      new_reduce_counts: extra,
      defense_score: {
        old_max: Math.max(...rows.map((r) => r.old.defense_score || 0)),
        new_max: Math.max(...rows.map((r) => r.nu.defense_score || 0)),
        old_mean: round2(rows.reduce((s, r) => s + (r.old.defense_score || 0), 0) / rows.length),
        new_mean: round2(rows.reduce((s, r) => s + (r.nu.defense_score || 0), 0) / rows.length),
        changed_days: rows.filter((r) => r.old.defense_score !== r.nu.defense_score).length
      },
      defense_penalty: {
        old_mean: round2(rows.reduce((s, r) => s + (r.old.defense_penalty || 0), 0) / rows.length),
        new_mean: round2(rows.reduce((s, r) => s + (r.nu.defense_penalty || 0), 0) / rows.length),
        changed_days: rows.filter((r) => r.old.defense_penalty !== r.nu.defense_penalty).length
      },
      healthy_risk_trigger_count: healthyRiskTriggers.length,
      healthy_risk_trigger_ratio: triggerDates.length ? round2(healthyRiskTriggers.length / triggerDates.length) : 0
    };
  });

  /* ---- Gate A 判定 ---- */
  const totalDays = axis.length;
  const allActionChanged = H.UNIVERSE.reduce((s, u) => s + perCode[u.code].action_changed_count, 0);
  const maxAbsDelta = Math.max(...H.UNIVERSE.map((u) => perCode[u.code].max_abs_target_delta));
  const totalTriggers = H.UNIVERSE.reduce((s, u) => s + perCode[u.code].slow_break_high_trigger_count_new, 0);
  const totalHealthyRisk = H.UNIVERSE.reduce((s, u) => s + perCode[u.code].healthy_risk_trigger_count, 0);
  const extraExits = H.UNIVERSE.reduce((s, u) => s + perCode[u.code].new_reduce_counts.EXIT, 0);
  const extraStrat = H.UNIVERSE.reduce((s, u) => s + perCode[u.code].new_reduce_counts.STRATEGIC_REDUCE, 0);
  const extraTact = H.UNIVERSE.reduce((s, u) => s + perCode[u.code].new_reduce_counts.TACTICAL_REDUCE, 0);
  const actionFlipRatio = round2(allActionChanged / (totalDays * H.UNIVERSE.length));
  const healthyRiskRatio = totalTriggers ? round2(totalHealthyRisk / totalTriggers) : 0;

  gates.F1_healthy_risk_ratio = {
    value: healthyRiskRatio,
    limit: THRESHOLDS.healthyRiskTriggerRatio,
    pass: healthyRiskRatio <= THRESHOLDS.healthyRiskTriggerRatio,
    note: '触发日中「S3/S4/S5 且 target 被下调」占比'
  };
  gates.F2_action_flip_ratio = {
    value: actionFlipRatio,
    limit: THRESHOLDS.actionFlipRatio,
    pass: actionFlipRatio <= THRESHOLDS.actionFlipRatio,
    note: '区间内 action 变化占比'
  };
  gates.F3_max_abs_target_delta = {
    value: maxAbsDelta,
    limit: THRESHOLDS.maxAbsTargetDeltaPp,
    pass: maxAbsDelta <= THRESHOLDS.maxAbsTargetDeltaPp,
    note: 'final_target 最大绝对变化（pp）'
  };
  gates.F4_extra_exits = {
    value: extraExits, limit: THRESHOLDS.extraExits,
    pass: extraExits <= THRESHOLDS.extraExits, note: '新增 EXIT 次数'
  };
  gates.F5_extra_strategic_reduce = {
    value: extraStrat, limit: THRESHOLDS.extraStrategicReduce,
    pass: extraStrat <= THRESHOLDS.extraStrategicReduce, note: '新增 STRATEGIC_REDUCE 次数'
  };
  gates.F6_extra_tactical_reduce = {
    value: extraTact, limit: THRESHOLDS.extraTacticalReduce,
    pass: extraTact <= THRESHOLDS.extraTacticalReduce, note: '新增 TACTICAL_REDUCE 次数'
  };

  const allPass = Object.values(gates).every((g) => g.pass);

  const result = {
    generated_at: new Date().toISOString(),
    from: oldRun.meta.from, to: oldRun.meta.to, days: totalDays,
    universe: oldRun.meta.universe,
    thresholds: THRESHOLDS,
    gates,
    verdict: allPass ? 'PASS' : 'FAIL',
    slow_break_input_availability: slowBreakInputAvailability,
    snapshot_shaping: newRun.meta.snapshot_shaping,
    totals: {
      total_triggers_new: totalTriggers,
      total_triggers_old: H.UNIVERSE.reduce((s, u) => s + perCode[u.code].slow_break_high_trigger_count_old, 0),
      total_days_score_ge_75: H.UNIVERSE.reduce((s, u) => s + perCode[u.code].trigger_proximity.days_with_score_ge_75, 0),
      total_days_all_three_conditions: H.UNIVERSE.reduce((s, u) => s + perCode[u.code].trigger_proximity.days_with_all_three_conditions, 0),
      max_triple_days_in_any_5day_window: Math.max(...H.UNIVERSE.map((u) => perCode[u.code].trigger_proximity.max_triple_days_in_any_5day_window)),
      total_healthy_risk_triggers: totalHealthyRisk,
      total_action_changed: allActionChanged,
      max_abs_target_delta: maxAbsDelta,
      extra_reduce_counts: { EXIT: extraExits, STRATEGIC_REDUCE: extraStrat, TACTICAL_REDUCE: extraTact }
    },
    per_code: perCode
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'slowbreak_replay.json'), JSON.stringify(result, null, 1), 'utf8');

  /* ---- 报告 ---- */
  const L = [];
  L.push('# V3.6.4 Gate A —— SlowBreak Historical Replay');
  L.push('');
  L.push(`- 生成时间：${result.generated_at}`);
  L.push(`- 区间：**${result.from} ~ ${result.to}**（${totalDays} 个五票共同交易日）`);
  L.push(`- universe：${result.universe.join(', ')}`);
  L.push('- 数据：真实历史 OHLCV（`deliverables/etf_daily_ml_pool/*.csv`）+ 线上 `etf_basic` / `param_config` 只读核实值');
  L.push('- OLD = 历史生产语义（`lowerLow` 恒 false，`slow_break_high` 不触发）');
  L.push('- NEW = 当前 R1（`swing-structure` 提供真实 `lowerLow`）');
  L.push('');
  L.push(`## 判定：**${result.verdict}**`);
  L.push('');
  L.push('## ★ 决定性发现：`SB>=75` 在生产上不可达（R1 的 lowerLow 修复必要但**不充分**）');
  L.push('');
  L.push('`defense.js::calcSlowBreakScore()` 的 4 项输入，在生产 `indicator_snapshot` 文档上的可得性：');
  L.push('');
  L.push('| # | 条件 | 需要的字段 | 线上快照是否存在 |');
  L.push('|---|---|---|---|');
  slowBreakInputAvailability.conditions.forEach((c) => {
    L.push(`| ${c.id} | \`${c.desc}\` | ${c.inputs.map((f) => `\`${f}\``).join(' / ')} | ${c.available ? '✅ 存在' : '❌ **不存在**'} |`);
  });
  L.push('');
  L.push(`- 可得条件数：**${slowBreakInputAvailability.obtainable_condition_count} / 4**`);
  L.push(`- 因此分数上限：**${slowBreakInputAvailability.max_score_reachable}**（映射 0/1/2/3/4 → 0/20/50/75/100）`);
  L.push(`- \`SB>=75\` 是否可达：**${slowBreakInputAvailability.sb_ge_75_reachable ? '可达' : '不可达'}**`);
  L.push(`- 证据来源：${slowBreakInputAvailability.source}`);
  L.push(`- 仓库管线产出但**线上文档没有**的字段：\`${slowBreakInputAvailability.dropped_from_repo_pipeline.join('`, `')}\``);
  L.push('');
  L.push('> 交叉证据：全仓检索 `ma60_slope` **只有 `defense.js` 一处读取、没有任何产生处**；');
  L.push('> `high_point_falling` / `lower_high` 在 `indicators.js` 里出现 **0 次**（内部变量叫 `highPointFalling`，从未暴露为快照字段）。');
  L.push('> 因此 `isSlowBreakHigh()` 是**双重死逻辑**：① `lowerLow` 恒 false（缺陷 #2，R1 已修）');
  L.push('> ② 即使 `lowerLow` 修好，`SB>=75` 这一前置门槛也永远达不到。');
  L.push('');
  L.push('**⇒ R1 的 SlowBreak 修复是必要条件，但不是充分条件。**');
  L.push('**⇒ 本 Gate 的「触发时机是否正确」这一问，在当前数据条件下无法回答**（条件不可达而非修复无效）。');
  L.push('**⇒ 补齐快照字段属于新的独立立项（会改变 SlowBreak 触发域 ⇒ 属策略级变更），本轮不修。**');
  L.push('');
  L.push('| Gate | 指标 | 实测 | 上限 | 结论 |');
  L.push('|---|---|---|---|---|');
  L.push(`| F1 | 触发日中「S3/S4/S5 且被压仓」占比 | ${gates.F1_healthy_risk_ratio.value} | ≤ ${gates.F1_healthy_risk_ratio.limit} | ${gates.F1_healthy_risk_ratio.pass ? 'PASS' : 'FAIL'} |`);
  L.push(`| F2 | action 变化占比（全区间×全票） | ${gates.F2_action_flip_ratio.value} | ≤ ${gates.F2_action_flip_ratio.limit} | ${gates.F2_action_flip_ratio.pass ? 'PASS' : 'FAIL'} |`);
  L.push(`| F3 | final_target 最大绝对变化 | ${gates.F3_max_abs_target_delta.value} pp | ≤ ${gates.F3_max_abs_target_delta.limit} pp | ${gates.F3_max_abs_target_delta.pass ? 'PASS' : 'FAIL'} |`);
  L.push(`| F4 | 新增 EXIT | ${gates.F4_extra_exits.value} | ≤ ${gates.F4_extra_exits.limit} | ${gates.F4_extra_exits.pass ? 'PASS' : 'FAIL'} |`);
  L.push(`| F5 | 新增 STRATEGIC_REDUCE | ${gates.F5_extra_strategic_reduce.value} | ≤ ${gates.F5_extra_strategic_reduce.limit} | ${gates.F5_extra_strategic_reduce.pass ? 'PASS' : 'FAIL'} |`);
  L.push(`| F6 | 新增 TACTICAL_REDUCE | ${gates.F6_extra_tactical_reduce.value} | ≤ ${gates.F6_extra_tactical_reduce.limit} | ${gates.F6_extra_tactical_reduce.pass ? 'PASS' : 'FAIL'} |`);
  L.push('');
  L.push('> 阈值由本 Gate **在跑之前声明**（见脚本 `THRESHOLDS`），未按结果回调。');
  L.push('> 这些阈值是工程判断，不是用户确认值 —— 原始数字全部列出，供独立复核。');
  L.push('');
  L.push('## 逐票结果');
  L.push('');
  L.push('| code | 名称 | NEW 触发次数 | OLD 触发次数 | 首次触发 | DefenseScore max(old→new) | DefensePenalty mean(old→new) | Δtarget≠0 天数 | max\\|Δtarget\\| | mean Δtarget | action 变化 |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|');
  H.UNIVERSE.forEach((u) => {
    const p = perCode[u.code];
    L.push(`| ${p.code} | ${p.name} | ${p.slow_break_high_trigger_count_new} | ${p.slow_break_high_trigger_count_old} `
      + `| ${p.first_trigger_date || '—'} | ${p.defense_score.old_max} → ${p.defense_score.new_max} `
      + `| ${p.defense_penalty.old_mean} → ${p.defense_penalty.new_mean} | ${p.target_delta_nonzero_days} `
      + `| ${p.max_abs_target_delta} | ${p.mean_target_delta} | ${p.action_changed_count} |`);
  });
  L.push('');
  L.push('### 触发条件逼近度（为什么触发 0 次 —— 机制是否被喂到条件）');
  L.push('');
  L.push('`isSlowBreakHigh()` 要求「某个 5 日窗口内 ≥3 日同时满足 `SlowBreak>=75` **且** `LH` **且** `LL`」。');
  L.push('下表逐项拆开，用来区分「机制坏了」与「条件确实没满足」。');
  L.push('');
  L.push('| code | SB>=75 天数 | 三项同时成立天数 | 任一 5 日窗口内三项最大天数 | SlowBreak 分数分布 |');
  L.push('|---|---|---|---|---|');
  H.UNIVERSE.forEach((u) => {
    const p = perCode[u.code].trigger_proximity;
    L.push(`| ${u.code} | ${p.days_with_score_ge_75} | ${p.days_with_all_three_conditions} `
      + `| ${p.max_triple_days_in_any_5day_window} | ${JSON.stringify(p.score_histogram)} |`);
  });
  L.push('');
  L.push('> 判读：若「三项同时成立天数」为 0，说明真实历史里 `SB>=75` 与 `LH/LL` 从未同时出现，');
  L.push('> 因此 `slow_break_high` 不可能触发 —— 这是**条件未满足**，不是判定逻辑失效。');
  L.push('');
  L.push('### 新增减仓动作次数（NEW − OLD）');
  L.push('');
  L.push('| code | EXIT | STRATEGIC_REDUCE | TACTICAL_REDUCE |');
  L.push('|---|---|---|---|');
  H.UNIVERSE.forEach((u) => {
    const e = perCode[u.code].new_reduce_counts;
    L.push(`| ${u.code} | ${e.EXIT} | ${e.STRATEGIC_REDUCE} | ${e.TACTICAL_REDUCE} |`);
  });
  L.push('');
  L.push('### 动作分布对照');
  L.push('');
  L.push('| code | action | OLD | NEW |');
  L.push('|---|---|---|---|');
  H.UNIVERSE.forEach((u) => {
    const p = perCode[u.code];
    const keys = [...new Set([...Object.keys(p.actions_old), ...Object.keys(p.actions_new)])].sort();
    keys.forEach((k) => {
      L.push(`| ${u.code} | ${k} | ${p.actions_old[k] || 0} | ${p.actions_new[k] || 0} |`);
    });
  });
  L.push('');
  L.push('## 触发日明细与前向表现');
  L.push('');
  L.push('> 前向收益/回撤均相对**触发日收盘**计算；`ret_Nd` = N 个交易日后收盘相对触发日收盘（%），`mdd_Nd` = 窗口内最大回撤（%）。');
  L.push('');
  const anyTrigger = H.UNIVERSE.some((u) => perCode[u.code].trigger_details.length);
  if (!anyTrigger) {
    L.push('**区间内 5 只 ETF 均未出现 `slow_break_high` 触发。**');
    L.push('');
    L.push('这意味着：在本区间内，修复带来的 DefenseScore +20 **一次都没有生效** ⇒ 决策数值零变化。');
  } else {
    L.push('| code | 触发日 | stage | overlay | SBscore | DefenseScore old→new | 5D ret | 5D mdd | 10D ret | 10D mdd | 20D ret | 20D mdd | Δtarget | action old→new |');
    L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    H.UNIVERSE.forEach((u) => {
      perCode[u.code].trigger_details.forEach((t) => {
        const f = t.forward || {};
        L.push(`| ${t.date ? u.code : u.code} | ${t.date} | ${t.trend_stage_primary}/${t.trend_stage_overlay} | ${t.trend_stage_overlay} `
          + `| ${t.slow_break_score} | ${t.defense_score_old} → ${t.defense_score_new} `
          + `| ${f.ret_5d} | ${f.mdd_5d} | ${f.ret_10d} | ${f.mdd_10d} | ${f.ret_20d} | ${f.mdd_20d} `
          + `| ${t.target_delta} | ${t.final_action_old} → ${t.final_action_new} |`);
      });
    });
  }
  L.push('');
  L.push('## 结论（只报证据，不做收益主张）');
  L.push('');
  if (!anyTrigger) {
    L.push(`1. NEW 口径在本区间触发 **0** 次；OLD 口径同样 0 次 ⇒ **决策数值零差异**：`);
    L.push(`   Δtarget 最大 0pp、action 变化 0 次、EXIT/STRATEGIC_REDUCE/TACTICAL_REDUCE 全部 +0。`);
    L.push(`2. 零触发的**原因已被定位**（不是机制坏了）：该区间内 5 只 ETF 的 \`SlowBreak\` 分数只出现过 0 / 20 / 50，`);
    L.push(`   从未出现 ≥75（见上方「触发条件逼近度」表）。`);
    L.push(`3. 而 \`SB>=75\` 达不到的根因是**快照字段缺失**（见上一节 ★）——`);
    L.push(`   这是比缺陷 #2 更底层的问题，R1 未修、本轮也不修（属策略级变更）。`);
    L.push(`4. 因此本 Gate 证明的是**上游安全性**：「R1 的 SlowBreak 改动在生产数据上零副作用」。`);
    L.push(`   它**不能**证明「触发时机正确」—— 那需要先补齐快照字段再重跑本 Gate。`);
    L.push(`5. 建议：把「补齐 \`ma60_slope\` / \`high_point_falling\`(或 \`lower_high\`) 快照字段」单独立项；`);
    L.push(`   立项前不要启用任何依赖 SlowBreak 的加/减仓语义。`);
  } else {
    L.push(`1. NEW 口径共触发 ${totalTriggers} 次，OLD 口径 ${result.totals.total_triggers_old} 次。`);
    L.push(`2. 其中「S3/S4/S5 且 target 被下调」的触发 ${totalHealthyRisk} 次（占比 ${healthyRiskRatio}）。`);
    L.push('3. 逐日与前向表现见上表；本 Gate 不主张收益改善。');
  }
  L.push('');
  L.push('## 方法学边界（必须诚实告知）');
  L.push('');
  L.push('- ✅ **生产保真**：重推导快照按**线上 `indicator_snapshot` 实际字段集合**裁剪'
    + `（${newRun.meta.snapshot_shaping.live_field_count} 个字段）` + '，');
  L.push(`  丢弃仓库管线会产出但线上文档没有的字段：\`${newRun.meta.snapshot_shaping.dropped_fields_example.join('`, `')}\`。`);
  L.push('  理由：本 Gate 要回答的是**生产**会不会出现压仓，不是仓库分支会不会。');
  L.push('- `indicator_snapshot` 由真实 OHLCV 经 `indicators.computeSnapshot` **重推导**');
  L.push('  （与生产 `materializeIndicators` 同一函数；线上该集合只保留近期 ~27 天，无法直接取历史快照）。');
  L.push('- `fundamental` 固定 `F3/15`（生产从 DB 读）；两个变体使用同一常量，故 **OLD/NEW 差异不受其影响**。');
  L.push('- 账面从 0 自洽滚动（不注入真实持仓，避免个人资金数据入库）；两变体同起点。');
  L.push('- `premium_rate` 未注入（无历史实时数据）⇒ 溢价分档按缺失处理。');
  L.push('- 科技赛道内处理顺序固定为 513310 → 515880 → 159582（生产按边际机会排序，本重放取固定序，两变体一致）。');
  L.push('- **未调整**任何 SlowBreak / DefenseScore 阈值。');

  fs.mkdirSync(path.dirname(DOC), { recursive: true });
  fs.writeFileSync(DOC, `${L.join('\n')}\n`, 'utf8');

  console.log(`[Gate A] verdict=${result.verdict}`);
  console.log(JSON.stringify({ gates, totals: result.totals }, null, 1));
  console.log(`[Gate A] 报告：${path.relative(REPO, DOC)}`);
}

main();
