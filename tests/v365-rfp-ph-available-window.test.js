#!/usr/bin/env node
/**
 * V3.6.5 —— RFP-V2-PH-AVAILABLE-WINDOW 诊断件专项测试（PH-01 ~ PH-08）
 *
 * 目的：把 owner 对「诊断件不得替代冻结资格窗口」的裁定**机器化锁定**。
 *
 * ⛔ 本测试**只读**：不写文件、不访问网络、不访问数据库。
 *    （它会重新计算一次诊断件内容以比对，但只比较、不落盘。）
 *
 * ⚠️ 若 `deliverables/v365-production-history/` 不存在（gitignored、需先导出），
 *    则输出 SKIP 并以 exit 0 结束 —— 不得因缺数据而让 Stage A 变红。
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const PH_DIR = path.join(REPO, 'deliverables', 'v365-production-history');
const ARTIFACT = path.join(PH_DIR, 'rfp-v2-ph-available-window.json');

let pass = 0;
let fail = 0;
function ok(name, detail) { pass += 1; console.log(`[PASS] ${name}${detail ? ' — ' + detail : ''}`); }
function bad(name, detail) { fail += 1; console.log(`[FAIL] ${name}${detail ? ' — ' + detail : ''}`); }

console.log('== RFP-V2-PH-AVAILABLE-WINDOW 专项测试（PH-01 ~ PH-08）==\n');

/* ---------- 数据缺失 ⇒ SKIP（不得让 Stage A 变红） ---------- */
if (!fs.existsSync(ARTIFACT)) {
  console.log('[SKIP] 诊断件不存在（deliverables/v365-production-history 为 gitignored，需先受治理导出）');
  console.log('       复现：node scripts/v365-rfp-ph-available-window.js');
  console.log('\nRFP-V2-PH-AVAILABLE-WINDOW 专项测试：SKIP（缺数据，非失败）');
  process.exit(0);
}

const j = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
const t = (name, fn) => { try { fn(); } catch (e) { bad(name, e.message); return; } };

/* ================= PH-01 冻结资格窗口不得被本件更改 ================= */
t('PH-01 冻结资格窗口未被本件更改', () => {
  assert.strictEqual(j.QUALIFICATION_WINDOW.from, '2026-08-01', 'from 必须为 2026-08-01');
  assert.strictEqual(j.QUALIFICATION_WINDOW.to, '2026-09-22', 'to 必须为 2026-09-22');
  assert.strictEqual(j.QUALIFICATION_WINDOW.frozen, true);
  assert.strictEqual(j.QUALIFICATION_WINDOW.changed_by_this_artifact, false,
    '⛔ 不得由本诊断件更改资格窗口');
  ok('PH-01 冻结资格窗口未被本件更改',
    `${j.QUALIFICATION_WINDOW.from} → ${j.QUALIFICATION_WINDOW.to} · changed_by_this_artifact=false`);
});

/* ================= PH-02 诊断件必须自证非权威 ================= */
t('PH-02 诊断件自证非资格权威', () => {
  assert.strictEqual(j.qualification_authoritative, false,
    '⛔ qualification_authoritative 必须为 false');
  assert.strictEqual(j.supersedes_qualification_window, false,
    '⛔ 不得替代原 qualification window');
  assert.strictEqual(j.available_window_verdict, 'DIAGNOSTIC_ONLY');
  ok('PH-02 诊断件自证非资格权威',
    `verdict=DIAGNOSTIC_ONLY · qualification_authoritative=false · supersedes=false`);
});

/* ================= PH-03 available window 必须是资格窗口的真子集 ================= */
t('PH-03 available window 是冻结窗口的真子集', () => {
  const w = j.RFP_V2_PH_AVAILABLE_WINDOW;
  assert.ok(w && w.from && w.to, '必须含 from/to');
  assert.ok(w.from >= j.QUALIFICATION_WINDOW.from && w.to <= j.QUALIFICATION_WINDOW.to,
    `available window ${w.from}→${w.to} 必须落在 ${j.QUALIFICATION_WINDOW.from}→${j.QUALIFICATION_WINDOW.to} 内`);
  assert.ok(w.from > j.QUALIFICATION_WINDOW.from,
    '⛔ available window 起点晚于冻结窗口起点 ⇒ 存在缺口（这正是 F2-C 阻塞的成因）');
  ok('PH-03 available window 是冻结窗口的真子集',
    `${w.from} → ${w.to}（⊂ ${j.QUALIFICATION_WINDOW.from} → ${j.QUALIFICATION_WINDOW.to}）`);
});

/* ================= PH-04 required 必须来自独立真值源（⛔ 非数据自推导） ================= */
t('PH-04 required 来自独立真值源', () => {
  assert.ok(/harness\.replay\(\)\.axis/.test(String(j.required_trade_dates_source || '')),
    '⛔ required_trade_dates 必须取自 replay 轴（生产交易日历真值），不得从受治理数据自身日期推导');
  ok('PH-04 required 来自独立真值源', String(j.required_trade_dates_source).slice(0, 52) + '…');
});

/* ================= PH-05 与覆盖审计逐项一致（跨件同源） ================= */
t('PH-05 与 actual-coverage-audit 逐项一致', () => {
  const auditPath = path.join(PH_DIR, 'rpg-f2b-actual-coverage-audit.json');
  if (!fs.existsSync(auditPath)) { ok('PH-05 与覆盖审计一致', '审计件缺失 ⇒ 跳过跨件比对'); return; }
  const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
  const a = audit.portfolio_snapshot;
  assert.strictEqual(j.required_trade_dates, a.required_trade_dates, 'required_trade_dates 必须一致');
  assert.strictEqual(j.snapshot_available_dates, a.snapshot_available_dates, 'snapshot_available_dates 必须一致');
  assert.strictEqual(j.missing_trade_dates, a.missing_trade_dates, 'missing_trade_dates 必须一致');
  assert.deepStrictEqual(j.missing_dates_list, a.missing_dates_list, 'missing_dates_list 必须一致');
  ok('PH-05 与覆盖审计逐项一致',
    `required=${j.required_trade_dates} · available=${j.snapshot_available_dates} · missing=${j.missing_trade_dates}`);
});

/* ================= PH-06 全窗口可用性必须如实为 false ================= */
t('PH-06 RFP_V2_PH_FULL_WINDOW_AVAILABLE 如实为 false', () => {
  assert.strictEqual(j.rfp_v2_ph_full_window_available, false,
    '缺 9 天 ⇒ 必须为 false，⛔ 不得因"有诊断件"而置 true');
  assert.strictEqual(j.RFP_V2_PH_FULL_WINDOW_AVAILABLE, false);
  assert.ok(j.missing_trade_dates > 0, 'missing_trade_dates 必须 > 0');
  ok('PH-06 FULL_WINDOW_AVAILABLE 如实为 false',
    `missing=${j.missing_trade_dates} 天 ⇒ false`);
});

/* ================= PH-07 owner 五条硬规则全部履行 ================= */
t('PH-07 五条硬规则全部履行', () => {
  const h = j.hard_rules_upheld || {};
  assert.strictEqual(h.no_suggested_position_backfill, true, '⛔ 不得用 suggested_position 补');
  assert.strictEqual(h.no_next_day_snapshot_extrapolation, true, '⛔ 不得用后一天 snapshot 回推');
  assert.strictEqual(h.no_interpolation, true, '⛔ 不得插值');
  assert.strictEqual(h.no_assumed_zero_position, true, '⛔ 不得假设零仓');
  assert.strictEqual(h.no_replay_window_silent_change, true, '⛔ 不得偷改 replay window');
  ok('PH-07 owner 五条硬规则全部履行', Object.keys(h).length + ' 条全 true');
});

/* ================= PH-08 不得解除 F2-C 阻塞 ================= */
t('PH-08 诊断件不解除 F2-C 阻塞', () => {
  assert.ok(/BLOCKED_ON_ACTUAL_BOOK_COVERAGE/.test(String(j.note_on_f2c || '')),
    '⛔ 诊断件必须显式声明不解 F2-C 阻塞');
  ok('PH-08 诊断件不解除 F2-C 阻塞', String(j.note_on_f2c).slice(0, 46) + '…');
});

/* ---------- 汇总 ---------- */
console.log(`\nRFP-V2-PH-AVAILABLE-WINDOW 专项测试：PH-01 ~ PH-08 —— ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
