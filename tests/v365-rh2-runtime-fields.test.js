#!/usr/bin/env node
/**
 * WP-RH2 —— R2-a / R2-b 专项测试（F-01 ~ F-11）
 *
 * 依据：
 *   · `docs/V365_RUN_LIFECYCLE_IMPLEMENTATION_ROADMAP.md` §OD-6（FROZEN）
 *   · `docs/V365_RUN_LIFECYCLE_ARCHITECTURE_DECISION.md` RH 划分表
 *
 * ⛔ OD-6 冻结原则：**不得改旧字段值**；应新增派生字段 + 旧字段标 DEPRECATED。
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const RDE_REL = 'cloudfunctions/runDecisionEngine/index.js';
const RDE_ABS = path.join(REPO, RDE_REL);
const { canonicalCodeFingerprint } = require(path.join(REPO, 'scripts', 'lib', 'v365-orchestration-approval.js'));
const { getSchema } = require(path.join(REPO, 'src/common/schema.js'));

const src = fs.readFileSync(RDE_ABS, 'utf8');
const code = canonicalCodeFingerprint(src);
const ok = (n, d) => console.log(`[PASS] ${n}${d ? ' — ' + d : ''}`);

/* ================= F-01 R2-a：注释不再声称 CAS 未验证 ================= */
{
  assert.ok(!/平台级 CAS 并发证据尚未取得/.test(src),
    'R2-a：失效注释「平台级 CAS 并发证据尚未取得」必须已修正');
  assert.ok(!/单指针 CAS 提升需平台级并发实证/.test(src),
    'R2-a：失效注释「单指针 CAS 提升需平台级并发实证」必须已修正');
  ok('F-01 R2-a 失效注释已修正');
}

/* ================= F-02 R2-a：注释引用 CAS 已 CLOSED ================= */
{
  assert.ok(/CAS 并发证据\*\*已取得\*\*|平台 CAS 证据已 CLOSED/.test(src),
    'R2-a：注释必须显式声明平台 CAS 证据已取得');
  assert.ok(/V365_PLATFORM_CAS_EVIDENCE\.md/.test(src),
    'R2-a：注释必须引用证据文档');
  ok('F-02 R2-a 注释引用 CAS 已 CLOSED');
}

/* ================= F-03 `promotion_skipped_reason` 改为派生 ================= */
{
  assert.ok(/promotion_skipped_reason:\s*v365PromotionSkippedReason/.test(code),
    'promotion_skipped_reason 必须使用派生变量');
  assert.ok(!/promotion_skipped_reason:\s*v365Mode === 'ENFORCE'/.test(code),
    '⛔ 不得保留按 mode 硬编码的 promotion_skipped_reason');
  assert.ok(/v365PromotionSkippedReason\s*=\s*v365PromotionAllowed\s*\?\s*null/.test(code),
    '派生规则必须是：promotionAllowed ⇒ null（无跳过）');
  ok('F-03 promotion_skipped_reason 改为派生');
}

/* ================= F-04 `promotion_allowed` 由契约派生 ================= */
{
  assert.ok(/const v365PromotionAllowed = runIntegrity\.promotionAllowed\(\)/.test(code),
    'promotion_allowed 必须由 runIntegrity.promotionAllowed() 派生');
  assert.ok(/promotion_allowed:\s*v365PromotionAllowed/.test(code));
  ok('F-04 promotion_allowed 由契约派生');
}

/* ================= F-05 新增 `authoritative_publish_status`（R2-c 后：读真实提升结果）================= */
{
  assert.ok(/authoritative_publish_status:\s*v365AuthoritativePublishStatus/.test(code),
    '必须新增派生字段 authoritative_publish_status');
  // R2-c 接线后：不再由 mode 推断，而是读**真实提升结果**（四态）
  assert.ok(/v365AuthoritativePublishStatus\s*=\s*v365Mode !== 'ENFORCE'/.test(code),
    '非 ENFORCE ⇒ null（LEGACY 无 candidate/promotion 语义）');
  assert.ok(/'PROMOTED'/.test(code), 'R2-c 后必须能表达 PROMOTED（CAS 提升成功）');
  assert.ok(/'NOT_PROMOTED'/.test(code), 'R2-c 后必须能表达 NOT_PROMOTED（指针未切）');
  assert.ok(/'PROMOTION_FAILED'/.test(code), 'R2-c 后必须能表达 PROMOTION_FAILED（提升抛错）');
  // ⛔ 不得再出现「由 mode 推断已发布」的旧表述
  assert.ok(!/CANDIDATE_ONLY_NOT_PROMOTED/.test(code),
    '⛔ R2-c 后不得保留旧表述 CANDIDATE_ONLY_NOT_PROMOTED（已改为读真实提升结果）');
  assert.ok(/v365PublishResult\.promoted\s*===\s*true\s*\?\s*'PROMOTED'/.test(code),
    'PROMOTED 必须严格派生自 v365PublishResult.promoted === true');
  ok('F-05 派生 authoritative_publish_status',
    'ENFORCE ⇒ 读真实提升结果（PROMOTED / NOT_PROMOTED / PROMOTION_FAILED）；LEGACY ⇒ null');
}

/* ================= F-06 新增 `v365_authoritative_publish_status`（runtime_status）================= */
{
  assert.ok(/v365_authoritative_publish_status:\s*v365AuthoritativePublishStatus/.test(code));
  ok('F-06 新增 runtime_status 派生字段');
}

/* ================= F-07 ⛔ 旧字段值未改（OD-6 冻结原则）================= */
{
  const r = spawnSync('git', ['show', `HEAD:${RDE_REL}`], { cwd: REPO, encoding: 'utf8', maxBuffer: 1e8 });
  assert.ok(!r.error && r.status === 0, 'git show 必须可用');
  const before = canonicalCodeFingerprint(String(r.stdout));
  const grab = (s, re) => { const m = s.match(re); return m ? m[1].replace(/\s+/g, ' ').trim() : null; };
  for (const f of ['v365_authoritative_published', 'authoritative_published']) {
    const b = grab(before, new RegExp(`(?:^|[^_])${f}:\\s*([^,]+),`));
    const a = grab(code, new RegExp(`(?:^|[^_])${f}:\\s*([^,]+),`));
    assert.ok(b != null, `${f} 在 HEAD 版必须存在`);
    assert.strictEqual(a, b, `⛔ OD-6：旧字段 ${f} 的值不得被改动（before=${b} after=${a}）`);
  }
  ok('F-07 旧字段值未改（OD-6 冻结原则）', "v365_authoritative_published / authoritative_published 均保持 v365Mode !== 'ENFORCE'");
}

/* ================= F-08 新字段已在 runtime_status schema 登记（D12 前向守卫）================= */
{
  const rs = getSchema('runtime_status');
  assert.ok(rs.fields.v365_authoritative_publish_status,
    '★ D12：新写入 runtime_status 的字段必须同步登记进 schema');
  assert.strictEqual(rs.fields.v365_authoritative_publish_status.required, false,
    '新字段不得设为必填');
  ok('F-08 新字段已登记进 runtime_status schema');
}

/* ================= F-09 派生一致性：两字段不再自相矛盾 ================= */
{
  // 静态：skip reason 的取值域由 allowed 决定 ⇒ 二者不可能同时「allowed=true 且 reason!=null」
  const allowed = /const v365PromotionAllowed = runIntegrity\.promotionAllowed\(\);/.test(code);
  const skip = /v365PromotionAllowed\s*\?\s*null\s*:\s*'ATOMIC_PROMOTION_BLOCKED:platform_cas_unverified'/.test(code);
  assert.ok(allowed && skip,
    'promotion_allowed 与 promotion_skipped_reason 必须同源于 v365PromotionAllowed ⇒ 不可能自相矛盾');
  // 行为：CAS_EVIDENCE 已 CLOSED ⇒ promotionAllowed() === true ⇒ reason === null
  const contracts = require(path.join(REPO, 'src/common/utils/v365-contracts.js'));
  const store = require(path.join(REPO, 'src/common/utils/v365-publish-store.js'));
  assert.strictEqual(contracts.CAS_EVIDENCE.platform_single_document_cas_verified, true,
    '平台 CAS 证据必须为 verified（OD-6 矛盾消解的前提）');
  assert.strictEqual(store.promotionAllowed(), true, 'promotionAllowed() 必须为 true');
  ok('F-09 派生一致：allowed=true ⇒ reason=null（矛盾消解）');
}

/* ================= F-10 ⛔ 未恢复 decision_result 双写 ================= */
{
  // ⚠️ 语义精化：冻结设计**明确允许** LEGACY 分支直写 decision_result
  //    （`v365WriteDecision` 注释：「LEGACY ⇒ 保持 V3.6.4 原行为（直写 decision_result）」）。
  //    ⇒ 判据不是「零直写」，而是「直写**只在** LEGACY 分支内」+「ENFORCE 走 candidate」。
  const hasRouter = /async function v365WriteDecision/.test(code);
  assert.ok(hasRouter, 'v365WriteDecision 发布路由器必须仍在');

  const directWrites = [...code.matchAll(/db\.(upsert|add)\(\s*COLLECTIONS\.DECISION_RESULT/g)].length;
  assert.strictEqual(directWrites, 1,
    `应恰有 1 处 decision_result 直写（LEGACY 分支）；实测 ${directWrites} 处`);

  // 该直写必须**紧邻** `if (v365Mode !== 'ENFORCE')` 守卫
  const guarded = /if \(v365Mode !== 'ENFORCE'\) \{\s*return db\.upsert\(COLLECTIONS\.DECISION_RESULT/.test(code);
  assert.ok(guarded,
    '⛔ decision_result 直写必须**只在** LEGACY 分支内（`if (v365Mode !== \'ENFORCE\')`）');

  // ENFORCE 分支必须走 candidate（⛔ 不是直写）
  const enforceUsesCandidate = /await v365Store\.putCandidate\(/.test(code);
  assert.ok(enforceUsesCandidate, 'ENFORCE 分支必须写 candidate 集合（非直写）');
  ok('F-10 未恢复 decision_result 双写', '直写 1 处（LEGACY 守卫内）· ENFORCE 走 candidate');
}

/* ================= F-11 R2-c 已接线（OD-3 A）+ R2-d 时序不变 ================= */
{
  // R2-c 落地后：RDE 内**必须**恰好 1 处 `publishCandidateFirst(` 调用（⛔ 不得多处调用 ⇒ 避免双提升）
  const calls = [...code.matchAll(/runIntegrity\.publishCandidateFirst\s*\(/g)].length;
  assert.strictEqual(calls, 1,
    `R2-c 已接线 ⇒ RDE 内应恰有 1 处 publishCandidateFirst 调用；实测 ${calls} 处`);

  // 调用必须传**决策文档本体**（decisions），⛔ 否则 mixed-date gate 必失败
  const passesDecisions = /decisions:\s*v365CandidateDocs/.test(code);
  assert.ok(passesDecisions,
    'R2-c：必须把决策文档本体传给 publishCandidateFirst（decisions: v365CandidateDocs）');

  // 调用必须传 manifest（含 run_id/revision/expected_trade_date）
  const passesManifest = /manifest:\s*v365Manifest/.test(code);
  assert.ok(passesManifest, 'R2-c：必须传 manifest');

  // revision = 逻辑单调时钟（promotion **前** pointer.revision + 1）
  const monotonicRev = /getPointer\(v365Scope\)[\s\S]{0,200}?revision[\s\S]{0,60}?\+\s*1/.test(code);
  assert.ok(monotonicRev, 'R2-c：revision 必须由 promotion 前 pointer.revision + 1 派生（过 NON_MONOTONIC_REVISION）');

  // ⛔ R2-d 时序：CAS 提升**先于** run_history 写入（禁止 append → promote）
  const iPromote = code.indexOf('publishCandidateFirst({');
  const iHistory = code.indexOf('db.getCollection(v365HistoryColl).add(v365HistoryRow)');
  assert.ok(iPromote > 0, 'publishCandidateFirst 调用点必须存在');
  assert.ok(iHistory > 0, 'run_history 写入点必须存在');
  assert.ok(iPromote < iHistory,
    '⛔ OD-2 时序：CAS 提升尝试必须**先于** run_history 写入（禁止 run_history append → CAS promotion）');

  ok('F-11 R2-c 接线 + R2-d 时序',
    `publishCandidateFirst 调用 1 处 · 提升点(${iPromote}) < history 写入点(${iHistory})`);
}

/* ================= F-12 R2-d 时序不变量（OD-2 八条）================= */
{
  // ① CAS 失败 ⇒ 不得写"成功型"history（promoted 必须来自真实结果 + promoted_at 仅成功时非 null）
  const promotedFromResult = /promoted:\s*v365PublishResult\s*\?\s*v365PublishResult\.promoted\s*===\s*true\s*:\s*false/.test(code);
  assert.ok(promotedFromResult, '⛔ `promoted` 必须严格派生自真实 promotion 结果（=== true）');

  const promotedAtConditional = /promoted_at:[^,]*?promoted\s*===\s*true\s*\)\s*\?\s*v365Now\s*:\s*null/.test(code);
  assert.ok(promotedAtConditional,
    '⛔ `promoted_at` 必须**仅在**真实 promotion 成功时写入（失败 ⇒ null）');

  // ② retry ⇒ 不得产生第二条同 run history（幂等：先查后写）
  const idempotentGuard = /db\.query\(v365HistoryColl,[\s\S]{0,120}?run_id:[\s\S]{0,120}?if\s*\(!v365Dup\s*\|\|\s*!v365Dup\.length\)/.test(code);
  assert.ok(idempotentGuard,
    '⛔ 幂等：写入前必须先按 run_id 查重（重试不得产生第二条 history）');

  // ③ supersedes_run_id 来自 promotion 前真实 active pointer（plan），⛔ 非事后反查
  const supersedesFromPlan = /supersedes_run_id:\s*v365Plan\.supersedes_run_id/.test(code);
  assert.ok(supersedesFromPlan,
    '⛔ `supersedes_run_id` 必须取自 promotion 前的 pointer plan（非事后反查）');

  // ④ ⛔ 不得新增反向 supersede 更新（无 superseded_by_run_id 写入）
  assert.ok(!/superseded_by_run_id/.test(code),
    '⛔ OD-1 A′：不得新增反向 `superseded_by_run_id` 更新');
  // 也不得对已存在 history row 做 update
  const historyUpdates = [...code.matchAll(/updateById\(\s*v365HistoryColl/g)].length;
  assert.strictEqual(historyUpdates, 0, '⛔ history 严格 append-only（不得 update 既有 row）');

  // ⑤ CAS rejected 也留痕（promoted:false 仍写一条）
  assert.ok(/promoted:\s*v365PublishResult\s*\?/.test(code) && idempotentGuard,
    '⛔ CAS rejected 也必须写一条 `promoted:false` 的 history 结果（OD-2 Reason ③）');

  // ⑥ 失败可见（不得静默）
  assert.ok(/v365HistoryWriteError\s*=\s*String\(/.test(code),
    '⛔ history 写失败必须记录（不得静默吞掉）');

  ok('F-12 R2-d 时序不变量（OD-2）',
    'promoted 严格派生 · promoted_at 仅成功 · 幂等查重 · supersedes 取自 plan · 无反向 supersede · append-only · 拒因留痕 · 失败可见');
}

console.log('\nWP-RH2 R2-a/R2-b 专项测试：F-01 ~ F-11 全部 PASS');
