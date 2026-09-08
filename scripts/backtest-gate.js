/**
 * 闸门拦截率分布回测：还原 checkAddEligibility 的 10 项闸门，
 * 统计在「机会分达标（B 级及以上）」的日子里，每一项各拦掉多少天。
 *
 * 运行：node scripts/backtest-gate.js
 * 前置：/tmp/kc513310_raw.json /tmp/kc50_raw.json /tmp/kc399006_raw.json
 */
'use strict';

const fs = require('fs');
const indicators = require('../cloudfunctions/common/utils/indicators.js');
const decision = require('../cloudfunctions/common/utils/decision.js');

const params = {
  sideway_days: 15, sideway_days_min: 8, sideway_days_mature: 20,
  sideway_range_base: 12, sideway_atr_multiplier: 4, sideway_range_max: 12, sideway_range_hard_cap: 15,
  ma20_slope_flat: 1.5, trend_context_up: 5, trend_context_down: -5,
  volume_ratio: 0.70, volume_ratio_mild: 0.90, volume_ratio_high: 1.15, volume_ratio_extreme: 1.5,
  tech_sector_max: 65, single_etf_max: 30
};

const TARGETS = [
  { name: '513310', file: '/tmp/kc513310_raw.json', key: 'sh513310', sector: 'storage' },
  { name: '科创50', file: '/tmp/kc50_raw.json', key: 'sh000688', sector: 'storage' },
  { name: '创业板指', file: '/tmp/kc399006_raw.json', key: 'sz399006', sector: 'ai_network' }
];

function loadTencent(file, key) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const node = raw.data && raw.data[key];
  const rows = (node && (node.day || node.qfqday)) || [];
  return rows.map((r) => ({ trade_date: r[0], open: +r[1], close: +r[2], high: +r[3], low: +r[4], volume: +r[5] }));
}

/**
 * 还原 checkAddEligibility 的 10 项闸门。
 * 传入当日 snapshot + 简化 context（当前仓 5%、赛道未超配、无风险、无冷静期、市场震荡）。
 * @returns {{items: object, overall: string}}
 */
function checkGates(snapshot) {
  const w = snapshot.w_state || 'W3';
  const h = snapshot.h_state || 'H3';
  const v = snapshot.v_state || 'V3';
  const f = 'F3'; // 回测无基本面，按中性（不拦）
  const pricePosition = snapshot.price_position;
  const consolidationScore = snapshot.consolidation_score;
  const sidewayDays = snapshot.sideway_days || 0;

  const ctx = {
    snapshot,
    fundamental: { f_state: f },
    risk: { risk_flag: 'NORMAL', risk_override: false },
    positions: { current_position: 5, target_max: 30 },
    portfolio: { tech_position: 30, market_regime: 'range' },
    etf: { sector: 'storage' },
    params: {},
    cooldownDays: 0
  };
  // consolidationGrade：用横盘评分+状态粗判（A/B/C）
  const grade = decision.gradeConsolidation(snapshot);
  ctx.consolidationGrade = grade;

  return decision.checkAddEligibility(ctx);
}

function backtestOne(target) {
  const bars = loadTencent(target.file, target.key);
  const START = 260;
  if (bars.length <= START + 20) return null;

  // 闸门拦截统计
  const gateBlocks = {
    trend: 0, structure: 0, volume: 0, fund: 0, chase: 0,
    limit: 0, sector: 0, risk: 0, cooldown: 0, regime: 0
  };
  const singleRelax = { trend: 0, structure: 0, volume: 0, chase: 0 }; // 单独放宽该项后的放行天数
  const comboRelax = { 'trend+chase': 0, 'trend+volume': 0, 'chase+volume': 0, 'trend+chase+volume': 0, '全部进攻项': 0 };
  let qualifyDays = 0;      // 机会分≥65（B级及以上）的天数
  let allowDays = 0;        // 10 项全过的天数
  let defenseOnlyDays = 0;  // 只过防守 6 项的天数
  let trendRelaxDays = 0;   // 放宽 trend（允许 W3）后的天数

  // 每日记录
  const dailyLog = [];
  // 此处 bars 就是正在遍历的同一数组，t 是该数组下标。
  // 这与 V3.3 的 60 日错位不是同一类 bug（那是用 tradingDays 下标去切另一份全量 CSV）。
  for (let t = START; t < bars.length; t++) {
    const snap = indicators.computeSnapshot(bars.slice(0, t + 1), params, { code: target.key });
    if (!snap || snap.sideway_days == null || snap.sideway_days < 8) continue;

    // 机会分达标判定（B 级及以上）：consolidation_score ≥65（近似 V2.1.1 的 B 级）
    const qualify = snap.consolidation_score != null && snap.consolidation_score >= 65;
    if (!qualify) continue;
    qualifyDays += 1;

    const g = checkGates(snap);
    const { overall: _gOverall, ...items } = g; // 剥离 overall，只留 10 项闸门
    // 记录每项拦截
    for (const key of Object.keys(gateBlocks)) {
      if (items[key] === 'pause' || items[key] === 'forbid') gateBlocks[key] += 1;
    }
    if (g.overall === 'allow') allowDays += 1;

    // 只过防守 6 项（fund/limit/sector/risk/cooldown/regime）：进攻项（trend/structure/volume/chase）全部忽略
    const defenseKeys = ['fund', 'limit', 'sector', 'risk', 'cooldown', 'regime'];
    const defensePass = defenseKeys.every((k) => items[k] === 'ok');
    if (defensePass) defenseOnlyDays += 1;

    // 逐个放宽单个进攻闸门（其余保持），看每个闸门单独放开能多放行多少天
    const attackKeys = ['trend', 'structure', 'volume', 'chase'];
    attackKeys.forEach((ak) => {
      const relaxed = { ...items, [ak]: 'ok' };
      const overall = Object.values(relaxed).indexOf('forbid') >= 0 ? 'forbid'
        : (Object.values(relaxed).indexOf('pause') >= 0 ? 'pause' : 'allow');
      if (overall === 'allow') singleRelax[ak] += 1;
    });
    // 组合放宽（两两 + 全部进攻项）：用于判断闸门共振程度
    const comboKeys = [
      { name: 'trend+chase', set: ['trend', 'chase'] },
      { name: 'trend+volume', set: ['trend', 'volume'] },
      { name: 'chase+volume', set: ['chase', 'volume'] },
      { name: 'trend+chase+volume', set: ['trend', 'chase', 'volume'] },
      { name: '全部进攻项', set: attackKeys }
    ];
    comboKeys.forEach((ck) => {
      const relaxed = { ...items };
      ck.set.forEach((k) => { relaxed[k] = 'ok'; });
      const overall = Object.values(relaxed).indexOf('forbid') >= 0 ? 'forbid'
        : (Object.values(relaxed).indexOf('pause') >= 0 ? 'pause' : 'allow');
      if (overall === 'allow') comboRelax[ck.name] += 1;
    });
    // 放宽 trend（允许 W3）→ 看是否 allow
    const trendRelaxedItems = { ...items, trend: 'ok' };
    const trendRelaxedOverall = Object.values(trendRelaxedItems).indexOf('forbid') >= 0 ? 'forbid'
      : (Object.values(trendRelaxedItems).indexOf('pause') >= 0 ? 'pause' : 'allow');
    if (trendRelaxedOverall === 'allow') trendRelaxDays += 1;

    dailyLog.push({ date: bars[t].trade_date, w: snap.w_state, h: snap.h_state, v: snap.v_state, score: snap.consolidation_score, overall: g.overall });
  }

  return { name: target.name, qualifyDays, allowDays, defenseOnlyDays, trendRelaxDays, gateBlocks, singleRelax, comboRelax, dailyLog };
}

function main() {
  console.log('════════ 闸门拦截率分布回测（机会分≥65 的日子为分母）════════');
  console.log('说明：fund 假设 F3 中性、无风险/冷静期/赛道未超配/市场震荡——只测「技术面+结构」闸门\n');

  const results = [];
  for (const t of TARGETS) {
    const r = backtestOne(t);
    if (r) results.push(r);
  }

  for (const r of results) {
    console.log(`\n──── ${r.name} ────`);
    console.log(`机会分≥65 天数: ${r.qualifyDays}  | 10项全过(实际买点): ${r.allowDays} (${r.qualifyDays ? Math.round(r.allowDays / r.qualifyDays * 100) : 0}%)`);
    console.log(`只过防守6项: ${r.defenseOnlyDays} (${r.qualifyDays ? Math.round(r.defenseOnlyDays / r.qualifyDays * 100) : 0}%)  | 放宽trend后: ${r.trendRelaxDays} (${r.qualifyDays ? Math.round(r.trendRelaxDays / r.qualifyDays * 100) : 0}%)`);
    console.log('闸门拦截分布（可叠加）:');
    const rows = Object.entries(r.gateBlocks).map(([k, v]) => ({
      key: k, count: v, pct: r.qualifyDays ? Math.round(v / r.qualifyDays * 100) : 0
    })).sort((a, b) => b.count - a.count);
    for (const x of rows) {
      const bar = '█'.repeat(Math.round(x.pct / 5));
      console.log(`  ${x.key.padEnd(10)} 拦 ${String(x.count).padStart(4)} 天 (${String(x.pct).padStart(3)}%) ${bar}`);
    }
    console.log('单独放宽单个进攻闸门后的放行天数（其余保持原样）:');
    for (const [ak, cnt] of Object.entries(r.singleRelax)) {
      const add = cnt - r.allowDays;
      console.log(`  放宽 ${ak.padEnd(9)} → ${String(cnt).padStart(4)} 天（+${add}）`);
    }
    console.log('组合放宽后的放行天数（共振检测）:');
    for (const [ck, cnt] of Object.entries(r.comboRelax)) {
      const add = cnt - r.allowDays;
      console.log(`  放宽 ${ck.padEnd(16)} → ${String(cnt).padStart(4)} 天（+${add}）`);
    }
  }

  // 汇总
  console.log('\n\n════════ 三标的汇总 ════════');
  console.log('标的       | 达标天数 | 实际买点(全过) | 防守6项 | 放宽trend | 主要拦截闸门(前三)');
  console.log('--------------------------------------------------------------------------');
  for (const r of results) {
    const top = Object.entries(r.gateBlocks).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([k, v]) => `${k}(${v})`).join(' ');
    console.log(`${r.name.padEnd(10)}| ${String(r.qualifyDays).padStart(7)} | ${String(r.allowDays).padStart(7)} (${r.qualifyDays ? Math.round(r.allowDays / r.qualifyDays * 100) : 0}%) | ${String(r.defenseOnlyDays).padStart(7)} | ${String(r.trendRelaxDays).padStart(9)} | ${top}`);
  }
  console.log('\n注：fund 假设 F3 中性、无风险/冷静期/赛道未超配/市场震荡 → 防守 6 项天然不拦');
  console.log('    「单独放宽」= 该闸门强制 ok，其余 9 项保持原样，看放行增量（定位卡脖子闸门）');
}

main();
