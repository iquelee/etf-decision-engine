#!/usr/bin/env node
/**
 * V3.6.5 —— RFP-V2-PH-AVAILABLE-WINDOW（**诊断件**，⛔ 非资格权威）
 *
 * 设计依据：owner 裁定（RPG-F2-C 轮次）
 *   · `RFP-V2-PH` 的资格窗口 = `2026-08-01 → 2026-09-22`（**冻结，不得更改**）
 *   · 实际受治理数据只能覆盖其**子区间** ⇒ 允许另建本诊断件，
 *     显式标注 `qualification_authoritative = false`，
 *     ⛔ **绝不替代**原 qualification window，⛔ 不进入任何 anchor / Freeze 证据。
 *
 * ⛔ 本脚本**只读**：
 *   · 不访问网络、不访问数据库、不写生产
 *   · 只读 `deliverables/v365-production-history/**`（项目内 gitignored 受治理导出）
 *   · 仅写一个诊断 JSON 产物
 *
 * ⛔ 严禁（owner 硬规则，全部在本脚本内结构性排除）：
 *   · 用 `suggested_position` 补缺失快照
 *   · 用后一天 snapshot 回推（前视偏差）
 *   · 插值 / 假设零仓
 *   · 偷改 replay window 为 `2026-08-14`
 *
 * 输出：`deliverables/v365-production-history/rfp-v2-ph-available-window.json`
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..');
const PH_DIR = path.join(REPO, 'deliverables', 'v365-production-history');

/** 冻结的资格窗口（⛔ 只读常量，不得由本脚本推导或修改） */
const QUALIFICATION_WINDOW = Object.freeze({ from: '2026-08-01', to: '2026-09-22' });

/** 受治理数据文件及其预期 sha256（来自 manifest；本脚本独立复算校验） */
const GOVERNED_FILES = Object.freeze({
  trade_log: 'raw/trade_log.ndjson',
  portfolio_snapshot: 'raw/portfolio_snapshot.ndjson',
});

function sha256File(abs) {
  return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
}

function readNdjson(abs) {
  if (!fs.existsSync(abs)) return [];
  return fs.readFileSync(abs, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch (e) { return null; } })
    .filter(Boolean);
}

function dateOf(row, keys) {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  }
  return null;
}
const inWindow = (d) => d != null && d >= QUALIFICATION_WINDOW.from && d <= QUALIFICATION_WINDOW.to;

console.log('== RFP-V2-PH-AVAILABLE-WINDOW（诊断件 · 只读）==\n');
async function main() {

/* ---------- ① 读取 manifest + 独立复算 hash ---------- */
const manifestPath = path.join(PH_DIR, 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error('  [FATAL] manifest 缺失 ⇒ 无法建立受治理基线');
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const hashChecks = {};
for (const [name, rel] of Object.entries(GOVERNED_FILES)) {
  const abs = path.join(PH_DIR, rel);
  const expected = manifest.files && manifest.files[name] ? manifest.files[name].sha256 : null;
  const actual = fs.existsSync(abs) ? sha256File(abs) : null;
  hashChecks[name] = {
    expected_sha256: expected,
    recomputed_sha256: actual,
    match: actual != null && expected != null && actual === expected,
  };
}
const DATA_GOVERNED = Object.values(hashChecks).every((h) => h.match);
console.log(`  ① hash 独立复算 ⇒ DATA_GOVERNED = ${DATA_GOVERNED}`);
for (const [n, h] of Object.entries(hashChecks)) {
  console.log(`     ${n}: ${h.match ? 'MATCH' : 'MISMATCH'} (${String(h.recomputed_sha256).slice(0, 16)}…)`);
}

/* ---------- ② 采集受治理快照日期（⛔ 仅真实 `.position`，禁用 suggested） ---------- */
const snapRows = readNdjson(path.join(PH_DIR, GOVERNED_FILES.portfolio_snapshot));
const tradeRows = readNdjson(path.join(PH_DIR, GOVERNED_FILES.trade_log));

const snapDatesAll = new Set();
for (const r of snapRows) {
  const d = dateOf(r, ['snapshot_date', 'trade_date', 'date']);
  if (d) snapDatesAll.add(d);
}
const snapDatesInWindow = [...snapDatesAll].filter(inWindow).sort();

const tradeDatesInWindow = [...new Set(
  tradeRows.map((r) => dateOf(r, ['trade_date', 'date'])).filter(inWindow)
)].sort();

/* ---------- ③ 算 available window（⛔ 不做任何补全） ---------- */
const availableFrom = snapDatesInWindow.length ? snapDatesInWindow[0] : null;
const availableTo = snapDatesInWindow.length ? snapDatesInWindow[snapDatesInWindow.length - 1] : null;

// ★ required 交易日必须取自**独立真值源**（replay 轴 / 生产交易日历），
//   ⛔ 绝不从受治理数据自身日期推导 —— 那是**自我指涉**：缺失段会被自动排除在"应有"之外，
//      从而把 `missing` 假算成 0（本脚本首版即犯此错，已修）。
//   ⚠️ 与 `v365-rpg-f2b-actual-coverage-audit.js` 保持**同源**（同一 harness 轴）。
const harness = require(path.join(REPO, 'scripts', 'lib', 'v364-replay-harness.js'));
const replayResult = await harness.replay({
  from: QUALIFICATION_WINDOW.from,
  to: QUALIFICATION_WINDOW.to,
  runsPerDay: 1,
  protocol: 'V1',
});
const requiredDates = replayResult.axis.slice();
const requiredSource = 'harness.replay().axis（生产交易日历真值，⛔ 非数据自推导）';

const snapSet = new Set(snapDatesAll);
const presentDates = requiredDates.filter((d) => snapSet.has(d));
const missingDates = requiredDates.filter((d) => !snapSet.has(d));

/* ---------- ④ T-1 起始实际账本探测（合法种子，若存在） ---------- */
// 若 `availableFrom` 的前一交易日**有**真实快照 ⇒ 可作为 T-1 starting actual book。
// ⚠️ 只探测「窗口内缺失段之首日的前一快照」，⛔ 不做外推、⛔ 不取后一天。
const allSnapSorted = [...snapDatesAll].sort();
const tMinus1 = (() => {
  if (!availableFrom) return null;
  const before = allSnapSorted.filter((d) => d < availableFrom);
  if (!before.length) return null;
  const cand = before[before.length - 1];
  return { date: cand, in_qualification_window: inWindow(cand) };
})();

// 关键判定：窗口起点 2026-08-01 是否恰为 `availableFrom` 的前一快照
const windowStartCovered = availableFrom === requiredDates[0];
const windowStartIndex = requiredDates.indexOf(availableFrom);
const gapDaysCount = windowStartIndex;

/* ---------- ⑤ 裁定 ---------- */
const availableWindow = {
  from: availableFrom,
  to: availableTo,
  trade_days_count: snapDatesInWindow.length,
  missing_before_from: gapDaysCount,
};

const determination = {
  QUALIFICATION_WINDOW: { ...QUALIFICATION_WINDOW, frozen: true, changed_by_this_artifact: false },
  // ★ owner 裁定（2026-09-29 §3）：本诊断件必须携带 replay_semantics
  replay_semantics: 'PRODUCTION_HISTORICAL_AVAILABLE_WINDOW',
  RFP_V2_PH_AVAILABLE_WINDOW: availableWindow,
  available_window_derivation:
    '自动求交集：actual available start（真实 snapshot 最早日）→ qualification end（2026-09-22）；'
    + '⛔ 不手填、⛔ 不选「方便通过」的日期。',
  available_window_verdict: 'DIAGNOSTIC_ONLY',
  qualification_authoritative: false,
  supersedes_qualification_window: false,
  reason:
    '受治理 portfolio_snapshot 仅覆盖资格窗口的子区间 ⇒ 本件仅作**诊断**，'
    + '⛔ 不替代 `2026-08-01 → 2026-09-22` 的冻结资格窗口，⛔ 不进入任何 anchor / Freeze 证据。',
  required_trade_dates_source: requiredSource,
  required_trade_dates: requiredDates.length,
  snapshot_available_dates: presentDates.length,
  missing_trade_dates: missingDates.length,
  missing_dates_list: missingDates,
  t_minus_1_starting_actual_book: tMinus1,
  t_minus_1_is_window_start_predecessor: windowStartCovered,
  window_start_covered_by_actual_book: windowStartCovered,
  rfp_v2_ph_full_window_available: missingDates.length === 0,
  hard_rules_upheld: {
    no_suggested_position_backfill: true,
    no_next_day_snapshot_extrapolation: true,
    no_interpolation: true,
    no_assumed_zero_position: true,
    no_replay_window_silent_change: true,
  },
  note_on_f2c: missingDates.length
    ? 'RPG_F2C = BLOCKED_ON_ACTUAL_BOOK_COVERAGE（⛔ 本诊断件不解阻塞）'
    : 'RPG_F2C 覆盖完整',
  // ★ owner 裁定（2026-09-29 §3）：用途边界，结构性声明
  permitted_uses: [
    '验证 actual position book wiring',
    '验证 actual execution cooldown',
    '验证 production-historical replay machinery',
    '观察真实窗口内 delta',
    '建立诊断 evidence',
  ],
  forbidden_uses: [
    '替代 full-window qualification',
    '关闭 RPG-F2-C',
    '关闭 RFP-V2-PH full-window blocker',
    '输出 READY_FOR_PRODUCTION_PROMOTION',
  ],
};
determination.RFP_V2_PH_FULL_WINDOW_AVAILABLE = determination.rfp_v2_ph_full_window_available;

/* ---------- ⑥ 落盘 ---------- */
const out = {
  artifact: 'rfp-v2-ph-available-window',
  generated_at: new Date().toISOString(),
  authority: {
    DATA_GOVERNED,
    hash_checks: hashChecks,
    manifest_generated_at: manifest.generated_at,
    manifest_env_id: manifest.env_id,
  },
  governance: {
    read_only: true,
    network_access: false,
    production_write: false,
    qualification_authoritative: false,
  },
  ...determination,
};

const outPath = path.join(PH_DIR, 'rfp-v2-ph-available-window.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n', 'utf8');

console.log(`\n  ② 受治理快照（资格窗口内）= ${snapDatesInWindow.length} 天`);
console.log(`     available window = ${availableFrom} → ${availableTo}`);
console.log(`  ③ required 来源 = ${requiredSource}`);
console.log(`     应有 ${requiredDates.length} 天 / 已有 ${presentDates.length} 天 / 缺 ${missingDates.length} 天`);
if (missingDates.length) console.log(`     缺失: ${missingDates.join(', ')}`);
console.log(`  ④ T-1 starting actual book = ${tMinus1 ? `${tMinus1.date}（窗口内=${tMinus1.in_qualification_window}）` : 'null'}`);
console.log(`     窗口起点已被实际账本覆盖 = ${windowStartCovered}`);
console.log(`  ⑤ RFP_V2_PH_FULL_WINDOW_AVAILABLE = ${determination.rfp_v2_ph_full_window_available}`);
console.log(`     qualification_authoritative = false（诊断件，⛔ 不替代冻结窗口）`);
console.log(`\n  [written] ${outPath}`);
}

main().catch((e) => { console.error('[FATAL]', e && e.message ? e.message : e); process.exit(1); });
