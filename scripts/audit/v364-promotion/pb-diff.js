'use strict';
/**
 * Gate P-B 差异分类器 —— OLD(线上 V3.6.1 生产语义) vs NEW(冻结 aa634e2)
 *
 * ★ 分类规则**在执行前声明**（本文件即声明处），任何差异按下列规则机械归类，
 *   **不得**在看过结果后调整定义（任务书明令禁止「事后调整分类定义让 Gate 变绿」）。
 *
 * INTENDED_CORRECTNESS_CHANGE —— V3.6.4 明确要修的正确性缺陷，且**只**在这些范围内：
 *   I1. 同日重复运行漂移（缺陷 #1）：仅体现在 runsPerDay=3 的**日内**比较。
 *       涉及字段：pendingDays / days_in_stage / soft_down_days / s5_risk_days / pendingStage /
 *                 trend_stage_primary / trend_stage_overlay / final_target / final_action。
 *   I2. SlowBreak 链的 swing 结构性修复（缺陷 #2）：lowerLow 由「恒 false」变为真实值。
 *       涉及字段：slow_break_score / slow_break_high；以及**由它直接导致**的
 *                 defense_score / defense_penalty（仅当同票同日 slow_break_* 同时变化时）。
 *
 * DIAGNOSTIC_ONLY —— 只读诊断字段/诊断口径变化，不进入决策数值。（本比较集内无此类字段；
 *   相关性 rho_avg / tech_cap 单独报告。）
 *
 * UNEXPECTED_CHANGE —— 除上述之外的一切差异。
 *
 * Gate 判定：UNEXPECTED_CHANGE 计数 > 0 ⇒ PROMOTION_GATE = FAIL。
 *
 * 用法：node pb-diff.js
 */
const fs = require('fs');  // audit/v364-promotion
const path = require('path');

const DIR = process.env.V364_PB_DIR
  || path.join(__dirname, '..', '..', '..', '.v364-audit-work');
const CODES = ['513310', '515880', '159582', '518880', '159570'];
const LAST_N_DAYS = 120;

const CMP = ['trend_stage_primary', 'trend_stage_overlay', 'pendingStage', 'pendingDays',
  'days_in_stage', 'soft_down_days', 's5_risk_days', 'slow_break_score', 'slow_break_high',
  'defense_score', 'defense_penalty', 'final_target', 'final_action', 'binding_constraint'];

const INTENDED_INTRA_DAY_FIELDS = new Set(['pendingDays', 'days_in_stage', 'soft_down_days',
  's5_risk_days', 'pendingStage', 'trend_stage_primary', 'trend_stage_overlay',
  'final_target', 'final_action']);
const INTENDED_SLOWBREAK_FIELDS = new Set(['slow_break_score', 'slow_break_high']);
const SLOWBREAK_DERIVED = new Set(['defense_score', 'defense_penalty']);

function load(n) { return JSON.parse(fs.readFileSync(path.join(DIR, n), 'utf8')); }
function byKey(payload) {
  const m = {};
  payload.days.forEach((d) => { m[d.trade_date] = d.byCode; });
  return m;
}
function lastNDates(axis, n) { return axis.slice(Math.max(0, axis.length - n)); }

const old1 = load('old-r1.json'); const new1 = load('new-r1.json');
const axis = new1.axis;
const win = lastNDates(axis, LAST_N_DAYS);
const O1 = byKey(old1); const N1 = byKey(new1);

/* ---------- 主 replay（1 次/日）逐字段分类 ---------- */
const main = { dates: win.length, cells_compared: 0, field_diffs: 0, per_field: {}, samples: [], by_class: {} };
win.forEach((d) => {
  CODES.forEach((c) => {
    const o = (O1[d] || {})[c]; const n = (N1[d] || {})[c];
    if (!o || !n) return;
    main.cells_compared += 1;
    const slowChanged = (JSON.stringify(o.slow_break_score) !== JSON.stringify(n.slow_break_score))
      || (o.slow_break_high !== n.slow_break_high);
    CMP.forEach((f) => {
      if (JSON.stringify(o[f]) === JSON.stringify(n[f])) return;
      main.field_diffs += 1;
      main.per_field[f] = (main.per_field[f] || 0) + 1;
      let cls = 'UNEXPECTED_CHANGE';
      if (INTENDED_SLOWBREAK_FIELDS.has(f)) cls = 'INTENDED_CORRECTNESS_CHANGE';
      else if (SLOWBREAK_DERIVED.has(f) && slowChanged) cls = 'INTENDED_CORRECTNESS_CHANGE';
      main.by_class[cls] = (main.by_class[cls] || 0) + 1;
      // 从 Δtarget 统计里排除诊断量（只统计 final_target）
      if (main.samples.length < 25) {
        main.samples.push({ trade_date: d, code: c, field: f, class: cls, old: o[f], new: n[f],
          old_slow: o.slow_break_score, new_slow: n.slow_break_score });
      }
    });
  });
});

/* ---------- Δtarget / action flip 统计（仅看 final_target / final_action） ---------- */
const dt = [];
let actionFlips = 0;
win.forEach((d) => CODES.forEach((c) => {
  const o = (O1[d] || {})[c]; const n = (N1[d] || {})[c];
  if (!o || !n) return;
  if (typeof o.final_target === 'number' && typeof n.final_target === 'number') {
    dt.push(Math.round((n.final_target - o.final_target) * 1000) / 1000);
  }
  if (o.final_action !== n.final_action) actionFlips += 1;
}));
const targetStats = {
  n: dt.length,
  max_abs: dt.length ? Math.max(...dt.map(Math.abs)) : 0,
  mean: dt.length ? Math.round((dt.reduce((s, v) => s + v, 0) / dt.length) * 1000) / 1000 : 0,
  nonzero: dt.filter((v) => v !== 0).length
};

/* ---------- Same-Day Stress（3 次/日） ---------- */
function intraStats(payload, label) {
  const w = payload.run_diffs.filter((r) => win.indexOf(r.trade_date) >= 0);
  const perField = {};
  let total = 0; let datesWith = 0;
  const samples = [];
  w.forEach((r) => {
    if (r.drift_count > 0) datesWith += 1;
    r.drift.forEach((x) => {
      total += 1;
      perField[x.field] = (perField[x.field] || 0) + 1;
      if (samples.length < 8) samples.push({ trade_date: r.trade_date, code: x.code, field: x.field, first: x.first, last: x.last });
    });
  });
  return { label, dates: w.length, dates_with_intra_day_drift: datesWith, drift_count: total, per_field: perField, samples };
}
const old3 = load('old-r3.json'); const new3 = load('new-r3.json');
const oldIntra = intraStats(old3, 'OLD(V3.6.1)');
const newIntra = intraStats(new3, 'NEW(V3.6.4 frozen)');

/* NEW 树在 3 次/日下的"日末状态是否等于 1 次/日"（跨模式一致性） */
function endStateMatch(a, b) {
  const ka = JSON.stringify(a.final_book); const kb = JSON.stringify(b.final_book);
  const sa = JSON.stringify(a.final_state); const sb = JSON.stringify(b.final_state);
  return { final_book_equal: ka === kb, final_state_equal: sa === sb };
}
const newCross = endStateMatch(new1, new3);
const oldCross = endStateMatch(old1, old3);

/* ---------- 分类汇总 ---------- */
const out = {
  generated_at: new Date().toISOString(),
  window: { from: win[0], to: win[win.length - 1], days: win.length, universe: CODES },
  compared_fields: CMP,
  classification_rules_declared_upfront: {
    I1_intra_day: [...INTENDED_INTRA_DAY_FIELDS],
    I2_slowbreak: [...INTENDED_SLOWBREAK_FIELDS],
    I2_derived: [...SLOWBREAK_DERIVED],
    everything_else: 'UNEXPECTED_CHANGE'
  },
  main_replay: Object.assign({}, main, { target_delta: targetStats, action_flip_count: actionFlips }),
  same_day_stress: {
    old: oldIntra, new: newIntra,
    old_state_vs_3x: oldCross, new_state_vs_3x: newCross
  }
};
out.UNEXPECTED_CHANGE = (main.by_class.UNEXPECTED_CHANGE || 0);
out.VERDICT_MAIN = out.UNEXPECTED_CHANGE > 0 ? 'FAIL' : 'PASS';

fs.writeFileSync(path.join(DIR, 'pb-diff.json'), JSON.stringify(out, null, 1), 'utf8');

console.log('================ Gate P-B 差异分类 ================');
console.log(`窗口: ${win[0]} ~ ${win[win.length - 1]}  (${win.length} 个共同交易日 × ${CODES.length} 票 = ${main.cells_compared} 单元)`);
console.log(`比较字段 ${CMP.length} 个`);
console.log('\n-- 主 replay（1 次/日）--');
console.log('  字段差异总数 =', main.field_diffs);
console.log('  按字段分布  =', JSON.stringify(main.per_field));
console.log('  按分类      =', JSON.stringify(main.by_class));
console.log('  Δtarget: n=%d max_abs=%s mean=%s 非零=%d', targetStats.n, targetStats.max_abs, targetStats.mean, targetStats.nonzero);
console.log('  action flip =', actionFlips);
console.log('\n-- Same-Day Stress（3 次/日，逐日第1次 vs 第3次）--');
console.log('  OLD 有日内漂移的天数 = %d/%d, 漂移条数 = %d', oldIntra.dates_with_intra_day_drift, oldIntra.dates, oldIntra.drift_count);
console.log('     分布:', JSON.stringify(oldIntra.per_field));
console.log('  NEW 有日内漂移的天数 = %d/%d, 漂移条数 = %d', newIntra.dates_with_intra_day_drift, newIntra.dates, newIntra.drift_count);
console.log('     分布:', JSON.stringify(newIntra.per_field));
console.log('  NEW: 3次/日 的末日状态 == 1次/日 ?', JSON.stringify(newCross));
console.log('  OLD: 3次/日 的末日状态 == 1次/日 ?', JSON.stringify(oldCross));
console.log('\n  UNEXPECTED_CHANGE =', out.UNEXPECTED_CHANGE, '=> VERDICT_MAIN =', out.VERDICT_MAIN);
