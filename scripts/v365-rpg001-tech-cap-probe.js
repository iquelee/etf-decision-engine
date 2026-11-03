#!/usr/bin/env node
/**
 * RPG-001 Production-Path Parity Probe（**只读**）
 *
 * 目的：把 HD12-0 / RPG 设计中一次性手工探针得到的 E1 / E2 结论**正式固化为可复跑脚本**。
 *
 * 对当前 replay 的**全部** (date, code) 同时计算：
 *   V1（现行协议）：`effective_tech_cap = fallback tech_sector_max`（harness 不设该字段 ⇒ 走 fallback）
 *   PRODUCTION_FAITHFUL：as-of-date bars → `correlation.effectiveTechCap()` → `effective_tech_cap`
 *
 * ⛔ 本脚本**不修改任何文件**（除 `--out` 指定的证据 JSON）；⛔ 不改 harness / 生产代码 / 门禁。
 * ⛔ 不写入 `effective_tech_cap = 65` 之类的假常量 —— 生产侧一律走**同一个纯函数**。
 *
 * 用法：
 *   node scripts/v365-rpg001-tech-cap-probe.js [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--out <path>]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const harness = require(path.join(REPO, 'scripts', 'lib', 'v364-replay-harness.js'));
const corr = require(path.join(REPO, 'src', 'common', 'utils', 'correlation.js'));
const constants = require(path.join(REPO, 'src', 'common', 'constants.js'));

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) continue;
    const v = argv[i + 1];
    if (v == null || v.startsWith('--')) { a[k.slice(2)] = true; continue; }
    a[k.slice(2)] = v; i += 1;
  }
  return a;
}
const a = parseArgs(process.argv);
const FROM = a.from || '2026-08-01';
const TO = a.to || '2026-09-22';

const TECH_SECTORS = constants.TECH_SECTORS;                 // ['storage','ai_network','semi_equip']
const UNIVERSE = harness.UNIVERSE;
const TECH_CODES = UNIVERSE.filter((u) => TECH_SECTORS.indexOf(u.sector) >= 0).map((u) => u.code);

// 生产口径的 base_cap（与 RDE:670 同式）
const BASE_CAP = harness.PROD_PARAMS.tech_sector_max != null
  ? harness.PROD_PARAMS.tech_sector_max
  : constants.DEFAULT_PARAMS.tech_sector_max;

const { barsByCode } = harness.loadBars();
const axis = harness.commonAxis(barsByCode, { from: FROM, to: TO });
// RPG-F2-B：replay() 已改为 async ⇒ async IIFE 包裹（CJS 无顶层 await）
(async () => {
const v1 = await harness.replay({ from: FROM, to: TO, runsPerDay: 1 });

/* ------------------------------------------------------------------ *
 * 逐 (date, code) 计算
 *
 * ⚠️ sector_remaining_* 的说明：
 *    `sectorRemainingLimit = max(0, effectiveTechMax - sectorUsed)`，其中
 *    `sectorUsed` 由 harness **在当日 run 循环内**逐票累加（`harness:335 sectorOccupation`），
 *    **不通过公开 API 暴露**。本探针**不重实现** replay，因此：
 *      · 提供 `sector_remaining_upper_bound_*` = max(0, cap - tech_position(前一日账面))，
 *        其中前一日账面由 `byCode[].suggested_position`（harness:325/340 的账面推进规则）重建；
 *        ⚠️ 因 `sectorUsed >= tech_position` ⇒ 该值为**上界**（不是精确值）。
 *      · 另提供 `sector_cap_shift_pp` = `cap_delta_pp`（cap 位移对 remaining 的**精确**位移，模 max(0) 截断）。
 * ------------------------------------------------------------------ */
const rows = [];
for (let di = 0; di < axis.length; di++) {
  const d = axis[di];

  // ---- as-of-date bars（⛔ 无前视）----
  const asOf = {};
  for (const u of UNIVERSE) {
    const bs = (barsByCode[u.code] || []).filter((b) => b.trade_date <= d);
    if (bs.length) asOf[u.code] = bs;
  }
  // ---- 生产纯函数（与 RDE:685 同式）----
  const info = corr.effectiveTechCap(BASE_CAP, asOf);
  const effectiveCapProd = info.effective_cap;
  const effectiveCapV1 = BASE_CAP;   // V1：harness 不设 portfolio.effective_tech_cap ⇒ fallback

  // ---- 前一日账面（重建自 V1 replay 输出）----
  const prevBook = {};
  for (const u of UNIVERSE) {
    prevBook[u.code] = di === 0
      ? 0
      : (v1.days[di - 1].byCode[u.code] ? v1.days[di - 1].byCode[u.code].suggested_position : 0) || 0;
  }
  const techPosPrev = TECH_CODES.reduce((s, c) => s + (prevBook[c] || 0), 0);

  for (const u of UNIVERSE) {
    const b = (v1.days[di].byCode[u.code]) || {};
    const isTech = TECH_SECTORS.indexOf(u.sector) >= 0;
    rows.push({
      date: d,
      code: u.code,
      sector: u.sector,
      is_tech_code: isTech,
      base_cap: BASE_CAP,
      rho_avg: info.rho_avg,
      rho_max: info.rho_max,
      discount: info.discount,
      effective_cap_v1: effectiveCapV1,
      effective_cap_prod: effectiveCapProd,
      cap_delta_pp: Math.round((effectiveCapProd - effectiveCapV1) * 10) / 10,
      // cap 位移对 sectorRemainingLimit 的精确位移（模 max(0) 截断）
      sector_cap_shift_pp: Math.round((effectiveCapProd - effectiveCapV1) * 10) / 10,
      // ⚠️ 上界（见文件头说明）
      sector_remaining_upper_bound_v1: isTech ? Math.max(0, Math.round((effectiveCapV1 - techPosPrev) * 10) / 10) : null,
      sector_remaining_upper_bound_prod: isTech ? Math.max(0, Math.round((effectiveCapProd - techPosPrev) * 10) / 10) : null,
      v1_binding_constraint: b.binding_constraint != null ? b.binding_constraint : null,
      v1_final_target: b.final_target != null ? b.final_target : null,
      v1_final_action: b.final_action != null ? b.final_action : null,
      v1_engine_path: b.engine_path != null ? b.engine_path : null
    });
  }
}

/* ------------------------------------------------------------------ *
 * 统计
 * ------------------------------------------------------------------ */
const techRows = rows.filter((r) => r.is_tech_code);
const daysWithDiscount = new Set(rows.filter((r) => r.discount !== 1.0).map((r) => r.date));
const daysWithCapChange = new Set(rows.filter((r) => r.cap_delta_pp !== 0).map((r) => r.date));
const sectorCapBinding = rows.filter((r) => r.v1_binding_constraint === 'sector_cap');
// 潜在决策相关 = 科技票 ∧ V1 该日确实被 sector_cap 绑定 ∧ cap 有位移
const potentiallyRelevant = sectorCapBinding.filter((r) => r.is_tech_code && r.cap_delta_pp !== 0);

const stats = {
  TOTAL_DAYS: axis.length,
  DISCOUNT_NE_1_DAYS: daysWithDiscount.size,
  CAP_CHANGED_DAYS: daysWithCapChange.size,
  SECTOR_CAP_BINDING_COUNT: sectorCapBinding.length,
  POTENTIALLY_DECISION_RELEVANT_COUNT: potentiallyRelevant.length
};

const out = {
  probe: 'RPG-001',
  kind: 'PRODUCTION_PATH_PARITY',
  read_only: true,
  protocol: { v1: 'RFP-V1', target: 'RFP-V2' },
  window: { from: FROM, to: TO, days: axis.length },
  base_cap: BASE_CAP,
  base_cap_source: harness.PROD_PARAMS.tech_sector_max != null ? 'PROD_PARAMS.tech_sector_max' : 'DEFAULT_PARAMS.tech_sector_max',
  tech_pairs: corr.TECH_CORR_PAIRS,
  tech_codes: TECH_CODES,
  stats,
  potentially_decision_relevant: potentiallyRelevant.map((r) => ({
    date: r.date, code: r.code, cap_delta_pp: r.cap_delta_pp,
    v1_final_target: r.v1_final_target, v1_final_action: r.v1_final_action
  })),
  rows
};

console.log('== RPG-001 Production-Path Parity Probe ==');
console.log(`  window = ${FROM} → ${TO}（${axis.length} 日）`);
console.log(`  base_cap = ${BASE_CAP}（${out.base_cap_source}）`);
console.log(`  tech_codes = ${JSON.stringify(TECH_CODES)}`);
console.log('');
for (const [k, v] of Object.entries(stats)) console.log(`  ${k.padEnd(38)} = ${v}`);
console.log('');
console.log('  注：sector_remaining_* 为**上界**（harness 的当日 sectorUsed 未通过公开 API 暴露）');

if (a.out) {
  const p = path.resolve(String(a.out));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(out, null, 2), 'utf8');
  console.log(`\n  [written] ${p}`);
}
if (a.json) console.log(JSON.stringify(out));
})().catch((e) => { console.error(`  [FATAL] ${e && e.stack ? e.stack : e}`); process.exit(1); });
