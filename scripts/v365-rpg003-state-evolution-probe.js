#!/usr/bin/env node
/**
 * RPG-003 State-Evolution Probe（**只读**）
 *
 * 目的：量化 V1 replay 的 **Model A 暴露面**
 *       —— `nextBook[code] = res.suggested_position`（`v364-replay-harness.js:340`）
 *          即「决策建议直接推进次日账面」。
 *
 * ⛔ 只读：不修改任何文件（除 `--out` 指定的证据 JSON）。
 * ⛔ 不改 harness / 生产代码 / 门禁；⛔ 不改 V1 anchor。
 *
 * ⚠️ 关键口径：**不得只数 BUILD/ADD**。`TACTICAL_REDUCE` / `STRATEGIC_REDUCE` 若同样推进
 *    账面，也属于 `decision → assumed execution`。
 *
 * 用法：
 *   node scripts/v365-rpg003-state-evolution-probe.js [--from D] [--to D] [--out <path>]
 *   node scripts/v365-rpg003-state-evolution-probe.js --snapshot-dump <portfolio_snapshot.ndjson>
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const harness = require(path.join(REPO, 'scripts', 'lib', 'v364-replay-harness.js'));
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

const TECH_SECTORS = constants.TECH_SECTORS;
const UNIVERSE = harness.UNIVERSE;
const TECH_CODES = UNIVERSE.filter((u) => TECH_SECTORS.indexOf(u.sector) >= 0).map((u) => u.code);
const ADD_ACTIONS = new Set(['BUILD', 'ADD']);
const REDUCE_ACTIONS = new Set(['TACTICAL_REDUCE', 'STRATEGIC_REDUCE']);

// RPG-F2-B：replay() 已改为 async ⇒ async IIFE 包裹（CJS 无顶层 await）
(async () => {
const r = await harness.replay({ from: FROM, to: TO, runsPerDay: 1 });
const days = r.days;

/* ------------------------------------------------------------------ *
 * 账面重建（与 harness:340 同式）：
 *   book_0[code] = 0
 *   book_{d+1}[code] = suggested_position(day d, code)
 *   （同日 runsPerDay=1 ⇒ 仅最后一次运行生效）
 * ------------------------------------------------------------------ */
function bookAt(di) {
  const b = {};
  for (const u of UNIVERSE) {
    b[u.code] = di === 0 ? 0
      : ((days[di - 1].byCode[u.code] || {}).suggested_position || 0);
  }
  return b;
}
const techPositionAt = (b) => TECH_CODES.reduce((s, c) => s + (b[c] || 0), 0);
const totalAt = (b) => UNIVERSE.reduce((s, u) => s + (b[u.code] || 0), 0);

const rows = [];
let transitions = 0, buildAdd = 0, reduce = 0, holdNoChange = 0;
let techChangedDays = 0, cashChangedDays = 0, sectorUsedChangedDays = 0;

let prevTech = null, prevCash = null;
for (let di = 0; di < days.length; di++) {
  const d = days[di];
  const book = bookAt(di);                       // 当日**起点**账面（由前一日 suggested 推进而来）
  const techPos = techPositionAt(book);
  const total = totalAt(book);
  const cashRatio = Math.max(0, Math.round((100 - total) * 10) / 10);
  const sectorUsed = techPos;                    // harness:246 `sectorUsed = portfolio.tech_position`

  if (prevTech !== null && Math.round(techPos * 10) !== Math.round(prevTech * 10)) techChangedDays++;
  if (prevCash !== null && Math.round(cashRatio * 10) !== Math.round(prevCash * 10)) cashChangedDays++;
  if (prevTech !== null && Math.round(sectorUsed * 10) !== Math.round(prevTech * 10)) sectorUsedChangedDays++;
  prevTech = techPos; prevCash = cashRatio;

  for (const u of UNIVERSE) {
    const b = d.byCode[u.code] || {};
    const from = book[u.code] || 0;
    const suggested = b.suggested_position != null ? b.suggested_position : from;
    const changed = Math.round(suggested * 10) !== Math.round(from * 10);
    const action = b.final_action != null ? b.final_action : null;
    if (changed) {
      transitions++;
      if (ADD_ACTIONS.has(action)) buildAdd++;
      else if (REDUCE_ACTIONS.has(action)) reduce++;
    } else {
      holdNoChange++;
    }
    rows.push({
      date: d.trade_date, code: u.code, action,
      book_from: from, suggested_position: suggested,
      state_changed_by_suggested: changed,
      is_tech_code: TECH_CODES.indexOf(u.code) >= 0,
      final_target: b.final_target != null ? b.final_target : null,
      binding_constraint: b.binding_constraint != null ? b.binding_constraint : null,
      tech_position_start_of_day: Math.round(techPos * 10) / 10,
      cash_ratio_start_of_day: cashRatio,
      sector_used_start_of_day: Math.round(sectorUsed * 10) / 10
    });
  }
}

/* ------------------------------------------------------------------ *
 * PH 侧（production historical）数据可得性
 * ------------------------------------------------------------------ */
let snapInfo = { provided: false, path: null, records: 0, canonical: false, error: null };
let snapRecords = null;
if (a['snapshot-dump']) {
  const p = String(a['snapshot-dump']);
  try {
    snapRecords = fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean).map((s) => JSON.parse(s));
    snapInfo = { provided: true, path: p, records: snapRecords.length, canonical: false, error: null };
  } catch (e) {
    snapInfo = { provided: true, path: p, records: 0, canonical: false, error: String(e.message || e) };
  }
}

const stats = {
  TOTAL_DAY_CODE_STATES: days.length * UNIVERSE.length,
  STATE_TRANSITIONS_DRIVEN_BY_SUGGESTED_POSITION: transitions,
  BUILD_ADD_TRANSITIONS: buildAdd,
  REDUCE_TRANSITIONS: reduce,
  HOLD_NO_CHANGE: holdNoChange,
  TECH_POSITION_CHANGED_BY_MODEL_A_COUNT: techChangedDays,
  CASH_RATIO_CHANGED_BY_MODEL_A_COUNT: cashChangedDays,
  SECTOR_USED_CHANGED_BY_MODEL_A_COUNT: sectorUsedChangedDays
};

const out = {
  probe: 'RPG-003',
  kind: 'STATE_EVOLUTION_SEMANTICS',
  read_only: true,
  window: { from: FROM, to: TO, days: days.length },
  v1_semantics: 'COUNTERFACTUAL_FULL_EXECUTION（Model A）',
  ph_semantics: 'PRODUCTION_HISTORICAL（Model B）',
  book_rule: {
    file: 'scripts/lib/v364-replay-harness.js',
    line: 340,
    code: 'nextBook[u.code] = res.suggested_position != null ? res.suggested_position : (nextBook[u.code] || 0);'
  },
  stats,
  portfolio_snapshot_dump: snapInfo,
  ph_reconstruction: {
    model_supports: true,
    source: 'portfolio_snapshot（uk_date 每日一行；positions[].position = 实际仓位；'
      + 'tech_position / cash_ratio / semi_position / gold_position / drug_position / market_regime = replay portfolio 同键）',
    availability_in_canonical_package: 'ABSENT',
    verdict: snapInfo.provided ? 'PARTIAL（已提供 dump，非规范）' : 'PRODUCTION_HISTORICAL_REPLAY_NOT_CURRENTLY_RECONSTRUCTABLE'
  },
  rows
};

console.log('== RPG-003 State-Evolution Probe ==');
console.log(`  window = ${FROM} → ${TO}（${days.length} 日 × ${UNIVERSE.length} 票）`);
console.log('');
for (const [k, v] of Object.entries(stats)) console.log(`  ${k.padEnd(46)} = ${v}`);
console.log('');
console.log(`  portfolio_snapshot dump = ${snapInfo.provided ? snapInfo.path + '（' + snapInfo.records + ' 条）' : '未提供'}`);
console.log(`  ph_reconstruction.verdict = ${out.ph_reconstruction.verdict}`);

if (a.out) {
  const p = path.resolve(String(a.out));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(out, null, 2), 'utf8');
  console.log(`\n  [written] ${p}`);
}
if (a.json) console.log(JSON.stringify(out));
})().catch((e) => { console.error(`  [FATAL] ${e && e.stack ? e.stack : e}`); process.exit(1); });
