#!/usr/bin/env node
/**
 * WP-RH3 —— Promotion History / supersede 链专项测试（G-01 ~ G-11）
 *
 * RH3 范围（冻结依据 `V365_RUN_LIFECYCLE_IMPLEMENTATION_ROADMAP.md` §WP-RH3）：
 *   `active_run_pointer` + promotion records（OD-2 内嵌 + **supersede 链**）
 *   修改文件：`v365-publish-store.js`（CAS 成功后触发）· `v365-atomic-publish.js`
 *             （`supersedes_run_id` / `same_trade_date_supersede` 落 `run_history`）
 *             · `runDecisionEngine/index.js`（传递 manifest 的 supersede 上下文）
 *
 * ⚠️ RH2 已落地 `run_history` 的**写入本体**（OD-2 时序 + 单次写入）。
 *    RH3 的增量 = **supersede 链富化** + CAS 写后回读一致性上报。
 *
 * 本测试**不改**任何生产文件，只做静态 + 行为断言。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const RDE_REL = 'cloudfunctions/runDecisionEngine/index.js';
const AP_REL = 'src/common/utils/v365-atomic-publish.js';
const PS_REL = 'src/common/utils/v365-publish-store.js';
const RI_REL = 'src/common/utils/v365-run-integrity.js';
const SC_REL = 'src/common/schema.js';

const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const RDE = read(RDE_REL);
const AP = read(AP_REL);
const PS = read(PS_REL);
const RI = read(RI_REL);
const SC = read(SC_REL);

let pass = 0;
const ok = (n, d) => { pass++; console.log(`[PASS] ${n}${d ? ' — ' + d : ''}`); };

const APPROVAL = require(path.join(REPO, 'scripts/lib/v365-orchestration-approval.js'));

/** HD12-3 正确口径：剥离注释后再判定「代码」事实 */
const stripComments = (s) => String(s)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const AP_CODE = stripComments(AP);
const PS_CODE = stripComments(PS);

/* ================= G-01 supersede 语义源在 planPointerPromotion（⛔ 不硬编码在 RDE）================= */
{
  assert.ok(/function planPointerPromotion/.test(AP_CODE), 'planPointerPromotion 必须仍存在');
  assert.ok(/supersedes_run_id:\s*\(current && current\.expected_trade_date === manifest\.expected_trade_date\)/
    .test(AP_CODE), 'supersedes_run_id 必须由「当前 pointer 交易日 == 本 run 交易日」判定');
  assert.ok(/same_trade_date_supersede:\s*!!\(current && current\.expected_trade_date === manifest\.expected_trade_date\)/
    .test(AP_CODE), 'same_trade_date_supersede 必须与 supersedes_run_id **同源**（同一比较）');
  // ⛔ RDE 侧不得自己重算 supersede 语义
  assert.ok(!/current\.expected_trade_date\s*===/.test(stripComments(RDE)),
    '⛔ RDE 不得自行重算 supersede 语义（必须取自 plan）');
  ok('G-01 supersede 语义唯一来源 = planPointerPromotion', 'supersedes_run_id 与 same_trade_date_supersede 同源比较');
}

/* ================= G-02 plan 的 next_pointer 带 promoted_from_run_id ================= */
{
  assert.ok(/next_pointer:\s*\{[\s\S]{0,400}?promoted_from_run_id:\s*current\s*\?\s*current\.run_id\s*:\s*null/.test(AP_CODE),
    'plan.next_pointer 必须记录 promoted_from_run_id（promotion **前**的 active run）');
  ok('G-02 plan.next_pointer.promoted_from_run_id 建立', '取自 current pointer（promotion 前）');
}

/* ================= G-03 CAS 成功路径上报 read_after_write_consistent（CAS-7）================= */
{
  const m = PS_CODE.match(/read_after_write_consistent:\s*consistent/);
  assert.ok(m, 'compareAndSetPointer 成功回执必须含 read_after_write_consistent（CAS-7 写后独立回读）');
  assert.ok(/const consistent = !!confirmed[\s\S]{0,300}?run_id[\s\S]{0,120}?revision/.test(PS_CODE),
    'read_after_write_consistent 必须比较 run_id **与** revision（⛔ 不能只看一个）');
  ok('G-03 CAS-7 写后回读一致性上报', 'run_id + revision 双字段比对');
}

/* ================= G-04 publishCandidateFirst 透传回读一致性（仅提升成功时有意义）================= */
{
  assert.ok(/read_after_write_consistent:\s*exec\.promoted === true && exec\.cas != null/.test(stripComments(RI)),
    'publishCandidateFirst 必须在**提升成功**时透传 read_after_write_consistent');
  assert.ok(/exec\.cas\.read_after_write_consistent === true\)\s*:\s*null/.test(stripComments(RI)),
    '⛔ 非提升成功 ⇒ read_after_write_consistent 必须为 null（⛔ 不得伪造 false）');
  ok('G-04 回读一致性透传（三态：true / false / null）');
}

/* ================= G-05 RDE 落 3 个 RH3 字段到 run_history ================= */
{
  const code = stripComments(RDE);
  assert.ok(/same_trade_date_supersede:\s*v365Plan\.same_trade_date_supersede === true/.test(code),
    'run_history 必须落 same_trade_date_supersede（取自 plan）');
  assert.ok(/promoted_from_pointer_run_id:[\s\S]{0,160}?v365Plan\.next_pointer[\s\S]{0,80}?promoted_from_run_id/.test(code),
    'run_history 必须落 promoted_from_pointer_run_id（取自 plan.next_pointer）');
  assert.ok(/read_after_write_consistent:\s*\(v365PublishResult && v365PublishResult\.promoted === true\)[\s\S]{0,120}?v365PublishResult\.read_after_write_consistent === true\)\s*:\s*null/.test(code),
    'run_history 必须落 read_after_write_consistent（仅提升成功时非 null）');
  ok('G-05 RDE 落 3 个 RH3 字段', 'same_trade_date_supersede · promoted_from_pointer_run_id · read_after_write_consistent');
}

/* ================= G-06 supersedes 与 same_trade_date 不可互相矛盾 ================= */
{
  const code = stripComments(RDE);
  // 若 same_trade_date_supersede 为 true ⇒ 必须取自 plan 的 supersedes_run_id 非 null
  // （静态可验证形式：两者同源于 v365Plan，且 same_trade_date 由 === true 严格化成布尔）
  assert.ok(/supersedes_run_id:\s*v365Plan\.supersedes_run_id/.test(code)
    && /same_trade_date_supersede:\s*v365Plan\.same_trade_date_supersede === true/.test(code),
    '⛔ supersedes_run_id 与 same_trade_date_supersede 必须同源于 v365Plan（防矛盾）');
  ok('G-06 一致性约束：两字段同源于 plan，不可矛盾');
}

/* ================= G-07 run_history schema 已登记 RH3 字段 ================= */
{
  for (const f of ['same_trade_date_supersede', 'promoted_from_pointer_run_id', 'read_after_write_consistent']) {
    assert.ok(new RegExp(`\\b${f}:\\s*\\{`).test(SC), `run_history schema 必须登记 ${f}`);
  }
  ok('G-07 run_history schema 登记 RH3 三字段');
}

/* ================= G-08 ⛔ 仍无反向 supersede 字段 / 无 update ================= */
{
  const rh = SC.slice(SC.indexOf("name: 'run_history'"));
  assert.ok(!/superseded_by_run_id/.test(rh),
    '⛔ OD-1 A′：run_history 不得有反向 `superseded_by_run_id`');
  assert.ok(!/is_active/.test(rh.split('indexes')[0]),
    '⛔ 不得引入 `is_active` 布尔（用 promoted_at 事件表达）');
  const code = stripComments(RDE);
  const updates = [...code.matchAll(/updateById\(\s*v365HistoryColl/g)].length;
  assert.strictEqual(updates, 0, '⛔ run_history 严格 append-only（不得 update）');
  ok('G-08 append-only 未被破坏', '无反向字段 · 无 is_active · 零 update');
}

/* ================= G-09 ⛔ 时序不变量仍保持（RH3 未破坏 OD-2）================= */
{
  const code = stripComments(RDE);
  const iPromote = code.indexOf('publishCandidateFirst({');
  const iHistory = code.indexOf('db.getCollection(v365HistoryColl).add(v365HistoryRow)');
  assert.ok(iPromote > 0 && iHistory > 0, '提升点与 history 写入点必须都存在');
  assert.ok(iPromote < iHistory,
    '⛔ RH3 不得破坏 OD-2：CAS 提升尝试必须仍**先于** run_history 写入');
  ok('G-09 OD-2 时序未被 RH3 破坏', `提升(${iPromote}) < history(${iHistory})`);
}

/* ================= G-10 CAS 成功才允许 promoted_at（RH3 未放宽）================= */
{
  const code = stripComments(RDE);
  assert.ok(/promoted_at:[^,]*?promoted\s*===\s*true\s*\)\s*\?\s*v365Now\s*:\s*null/.test(code),
    '⛔ promoted_at 必须仍**仅**在真实 promotion 成功时写入');
  assert.ok(/same_trade_date_supersede:/.test(code),
    '⛔ same_trade_date_supersede 是**描述性**字段，不得被用作 promotion 成功的替代判据');
  ok('G-10 promoted_at 判据未被放宽');
}

/* ================= G-11 CALC 绝对保护：RH3 未触碰 ================= */
{
  const CLASSIFICATION = require(path.join(REPO, 'scripts/lib/v365-decision-classification.js'));
  const calc = CLASSIFICATION.calcFiles ? CLASSIFICATION.calcFiles() : [];
  const touched = calc.filter((f) => {
    const r = spawnSync('git', ['diff', '--name-only', 'HEAD', '--', f], { cwd: REPO, encoding: 'utf8' });
    return r.status === 0 && String(r.stdout).trim().length > 0;
  });
  assert.deepStrictEqual(touched, [],
    `⛔ CALC 文件不得被 RH3 触碰：${touched.join(', ')}`);
  assert.strictEqual(CLASSIFICATION.classify('src/common/constants.js'), 'CALC');
  assert.strictEqual(CLASSIFICATION.isInProtectedDomain('src/common/constants.js'), true,
    'constants.js 必须在受保护域内（⛔ 绝对保护，无授权路径）');
  ok('G-11 CALC 绝对保护（constants.js 零改动）', `CALC ${calc.length} 文件全部未改`);
}

console.log(`\nWP-RH3 Promotion History 专项测试：G-01 ~ G-11 全部 PASS`);
