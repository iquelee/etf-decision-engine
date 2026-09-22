'use strict';
/**
 * breakout_nd 反事实差异（**仅供 FINDING-2 严重度判断，不得混入 Promotion 主 Gate**）
 *   A = CURRENT_PRODUCTION_CONTRACT            （new-r1.json：冻结 V3.6.4 代码 + 真实生产契约，breakout_nd 缺失）
 *   B = BREAKOUT_ND_RESTORED_COUNTERFACTUAL    （new-bnd-r1.json：同一代码 + 把 breakout_nd 补回输入）
 * 两者**仅**输入契约不同 ⇒ 差异全部归因于该字段。
 */
const fs = require('fs');  // audit/v364-promotion
const path = require('path');
const DIR = process.env.V364_PB_DIR || path.join(__dirname, '..', '..', '..', '.v364-audit-work');
const R = (n) => path.join(DIR, n);
const CODES = ['513310', '515880', '159582', '518880', '159570'];
const LAST_N = 120;

const A = JSON.parse(fs.readFileSync(R('new-r1.json'), 'utf8'));
const B = JSON.parse(fs.readFileSync(R('new-bnd-r1.json'), 'utf8'));
const win = A.axis.slice(-LAST_N);
const idx = (p) => { const m = {}; p.days.forEach((d) => { m[d.trade_date] = d.byCode; }); return m; };
const a = idx(A); const b = idx(B);

const s4 = { A: 0, B: 0 };
const trans = { 'S3->S4': { A: 0, B: 0 }, 'S4->S5': { A: 0, B: 0 }, 'S4->S3': { A: 0, B: 0 }, 'S5->S4': { A: 0, B: 0 } };
const dt = [];
let flips = 0;
const flipSamples = [];
const byCode = {};

CODES.forEach((c) => {
  const rec = { s4_A: 0, s4_B: 0, action_flips: 0, max_abs_target_delta: 0 };
  let pA = null; let pB = null;
  win.forEach((d) => {
    const x = (a[d] || {})[c]; const y = (b[d] || {})[c];
    if (!x || !y) return;
    if (x.trend_stage_primary === 'S4') { rec.s4_A += 1; s4.A += 1; }
    if (y.trend_stage_primary === 'S4') { rec.s4_B += 1; s4.B += 1; }
    if (pA && pB) {
      const kA = `${pA}->${x.trend_stage_primary}`;
      const kB = `${pB}->${y.trend_stage_primary}`;
      if (trans[kA]) trans[kA].A += 1;
      if (trans[kB]) trans[kB].B += 1;
    }
    if (typeof x.final_target === 'number' && typeof y.final_target === 'number') {
      const dv = Math.round((y.final_target - x.final_target) * 1000) / 1000;
      dt.push(dv);
      rec.max_abs_target_delta = Math.max(rec.max_abs_target_delta, Math.abs(dv));
    }
    if (x.final_action !== y.final_action) {
      flips += 1; rec.action_flips += 1;
      if (flipSamples.length < 10) flipSamples.push({ trade_date: d, code: c, A: x.final_action, B: y.final_action, A_target: x.final_target, B_target: y.final_target });
    }
    pA = x.trend_stage_primary; pB = y.trend_stage_primary;
  });
  byCode[c] = rec;
});

const out = {
  note: 'COUNTERFACTUAL ONLY —— 不得混入 Promotion 主 Gate；仅用于 FINDING-2 严重度判断',
  window: { from: win[0], to: win[win.length - 1], days: win.length, universe: CODES },
  A_current_production_contract: 'breakout_nd = missing',
  B_breakout_nd_restored: 'breakout_nd present（20 日新高为 true）',
  'S4_days': s4,
  'stage_transitions': trans,
  'target_delta': {
    n: dt.length,
    max_abs: dt.length ? Math.max(...dt.map(Math.abs)) : 0,
    mean: dt.length ? Math.round((dt.reduce((s, v) => s + v, 0) / dt.length) * 1000) / 1000 : 0,
    nonzero: dt.filter((v) => v !== 0).length
  },
  'action_flip_count': flips,
  flip_samples: flipSamples,
  by_code: byCode
};
fs.writeFileSync(R('cf-breakout-nd.json'), JSON.stringify(out, null, 1), 'utf8');

console.log('====== breakout_nd COUNTERFACTUAL（仅严重度判断，不混入主 Gate）======');
console.log(`窗口 ${win[0]} ~ ${win[win.length - 1]} (${win.length} 日 × ${CODES.length} 票)`);
console.log('S4 天数:   A(生产契约)=%d   B(补回)=%d   Δ=%d', s4.A, s4.B, s4.B - s4.A);
console.log('阶段迁移:', JSON.stringify(trans));
console.log('Δtarget:  n=%d max_abs=%s mean=%s 非零=%d', out.target_delta.n, out.target_delta.max_abs, out.target_delta.mean, out.target_delta.nonzero);
console.log('action flip 次数 =', flips);
if (flipSamples.length) { console.log('样例:'); flipSamples.slice(0, 5).forEach((s) => console.log('   ', JSON.stringify(s))); }
console.log('按票:', JSON.stringify(byCode));
