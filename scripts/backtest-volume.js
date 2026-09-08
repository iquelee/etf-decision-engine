/**
 * 缩量闸门敏感性回测：对比 volume_ratio_mild（V2 上限）0.85 / 0.90 / 0.95 下的买点数量与质量。
 *
 * 根因说明：闸门判定 `v==='V1'||v==='V2'||volRatio<=volTh` 中，V1/V2 直接放行，
 * 而 V2 = volRatio ≤ volume_ratio_mild（默认 0.85）→ 真正卡点其实是 mild 阈值。
 * 改 volume_ratio（0.70→0.80）只切 V1/V2 标签，不改变放行结果（上版已实证三档结果全同）。
 * 本版测试 volume_ratio_mild：0.85 / 0.90 / 0.95（V2 上限放宽）。
 *
 * 运行：node scripts/backtest-volume.js
 */
'use strict';

const fs = require('fs');
const indicators = require('../cloudfunctions/common/utils/indicators.js');
const decision = require('../cloudfunctions/common/utils/decision.js');

const BASE_PARAMS = {
  sideway_days: 15, sideway_days_min: 8, sideway_days_mature: 20,
  sideway_range_base: 12, sideway_atr_multiplier: 4, sideway_range_max: 12, sideway_range_hard_cap: 15,
  ma20_slope_flat: 1.5, trend_context_up: 5, trend_context_down: -5,
  volume_ratio: 0.70, volume_ratio_mild: 0.85, volume_ratio_high: 1.15, volume_ratio_extreme: 1.5,
  tech_sector_max: 65, single_etf_max: 30
};

const MILD_THRESHOLDS = [0.85, 0.90, 0.95];

const TARGETS = [
  { name: '513310', file: '/tmp/kc513310_raw.json', key: 'sh513310' },
  { name: '科创50', file: '/tmp/kc50_raw.json', key: 'sh000688' },
  { name: '创业板指', file: '/tmp/kc399006_raw.json', key: 'sz399006' }
];

function loadTencent(file, key) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const node = raw.data && raw.data[key];
  const rows = (node && (node.day || node.qfqday)) || [];
  return rows.map((r) => ({ trade_date: r[0], open: +r[1], close: +r[2], high: +r[3], low: +r[4], volume: +r[5] }));
}

function checkGates(snapshot, mildTh) {
  const ctx = {
    snapshot,
    fundamental: { f_state: 'F3' },
    risk: { risk_flag: 'NORMAL', risk_override: false },
    positions: { current_position: 5, target_max: 30 },
    portfolio: { tech_position: 30, market_regime: 'range' },
    etf: { sector: 'storage' },
    params: { volume_ratio: 0.70, volume_ratio_mild: mildTh },
    cooldownDays: 0,
    consolidationGrade: decision.gradeConsolidation(snapshot)
  };
  return decision.checkAddEligibility(ctx);
}

function fwdReturn(bars, idx, n) {
  const buyIdx = idx + 1;
  const sellIdx = buyIdx + n;
  if (sellIdx >= bars.length || !bars[buyIdx] || !bars[buyIdx].close) return null;
  return ((bars[sellIdx].close - bars[buyIdx].close) / bars[buyIdx].close) * 100;
}

function backtestOne(target, mildTh) {
  const bars = loadTencent(target.file, target.key);
  const START = 260;
  if (bars.length <= START + 20) return null;

  // 用该 mild 阈值重新物化（V2 上限变化）
  const params = { ...BASE_PARAMS, volume_ratio_mild: mildTh };
  const buys = [];
  let lastBuy = -100;
  let qualifyDays = 0;

  for (let t = START; t < bars.length; t++) {
    const snap = indicators.computeSnapshot(bars.slice(0, t + 1), params, { code: target.key });
    if (!snap || snap.sideway_days == null || snap.sideway_days < 8) continue;
    // 机会分达标（横盘评分 ≥65，与 volume 阈值无关——分档硬编码）
    if (snap.consolidation_score == null || snap.consolidation_score < 65) continue;
    qualifyDays += 1;

    const g = checkGates(snap, mildTh);
    if (g.overall === 'allow' && t - lastBuy >= 5) {
      buys.push({ idx: t, date: bars[t].trade_date, grade: snap.consolidation_score >= 75 ? 'A' : 'B' });
      lastBuy = t;
    }
  }

  // 质量统计
  const ret20 = [], ret60 = [];
  let win20 = 0, win60 = 0;
  for (const b of buys) {
    const r20 = fwdReturn(bars, b.idx, 20);
    const r60 = fwdReturn(bars, b.idx, 60);
    if (r20 != null) { ret20.push(r20); if (r20 > 0) win20++; }
    if (r60 != null) { ret60.push(r60); if (r60 > 0) win60++; }
  }
  const avg = (a) => a.length ? Math.round(a.reduce((s, v) => s + v, 0) / a.length * 100) / 100 : null;

  return {
    name: target.name, volTh: mildTh, qualifyDays,
    count: buys.length,
    aCount: buys.filter((b) => b.grade === 'A').length,
    avgRet20: avg(ret20), winRate20: ret20.length ? Math.round(win20 / ret20.length * 100) : null,
    avgRet60: avg(ret60), winRate60: ret60.length ? Math.round(win60 / ret60.length * 100) : null
  };
}

function main() {
  console.log('════════ 缩量闸门敏感性回测（volume_ratio_mild: 0.85 / 0.90 / 0.95）════════');
  console.log('口径：V2 上限 = mild 阈值（V1/V2 直接放行闸门），横盘评分≥65 为达标日\n');

  const results = [];
  for (const t of TARGETS) {
    for (const mildTh of MILD_THRESHOLDS) {
      const r = backtestOne(t, mildTh);
      if (r) results.push(r);
    }
  }

  // 按标的分组输出
  for (const t of TARGETS) {
    console.log(`\n──── ${t.name} ────`);
    console.log('mild阈值 | 达标日 | 买点 | A级 | 20日胜率 | 20日均收益 | 60日胜率 | 60日均收益');
    console.log('--------------------------------------------------------------------------');
    results.filter((r) => r.name === t.name).forEach((r) => {
      console.log(`${String(r.volTh).padEnd(7)} | ${String(r.qualifyDays).padStart(5)} | ${String(r.count).padStart(4)} | ${String(r.aCount).padStart(3)} | ${String(r.winRate20).padEnd(5)}% | ${String(r.avgRet20).padEnd(6)}% | ${String(r.winRate60).padEnd(5)}% | ${r.avgRet60}%`);
    });
  }

  // 汇总表
  console.log('\n\n════════ 三标的汇总（0.85 为基线）════════');
  console.log('标的       | 阈值 | 买点 | 60日胜率 | 60日均收益 | 买点变化 | 胜率变化');
  console.log('----------------------------------------------------------------------');
  for (const t of TARGETS) {
    const base = results.find((r) => r.name === t.name && r.volTh === 0.85);
    results.filter((r) => r.name === t.name).forEach((r) => {
      const dCount = r.count - base.count;
      const dWin = r.winRate60 != null && base.winRate60 != null ? r.winRate60 - base.winRate60 : null;
      console.log(`${t.name.padEnd(10)}| ${String(r.volTh).padEnd(5)}| ${String(r.count).padStart(4)} | ${String(r.winRate60).padEnd(5)}% | ${String(r.avgRet60).padEnd(6)}% | ${dCount > 0 ? '+' : ''}${dCount}      | ${dWin != null ? (dWin > 0 ? '+' : '') + dWin : '—'}`);
    });
  }
}

main();
