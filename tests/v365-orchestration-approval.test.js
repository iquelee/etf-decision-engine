#!/usr/bin/env node
/**
 * HD12-2 —— 编排层变更授权机制专项测试（B-01 ~ B-13）
 *
 * 主要直接调用**纯函数** `validate()`（快、无副作用）；
 * 末尾用一次子进程集成验证门禁真实接线。
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const A = require(path.join(REPO, 'scripts', 'lib', 'v365-orchestration-approval.js'));
const C = require(path.join(REPO, 'scripts', 'lib', 'v365-decision-classification.js'));

const HEAD40 = 'c6bd006fd76ffc5358cddd07347df8ed23d9e61d';
const RDE = 'cloudfunctions/runDecisionEngine/index.js';
const ok = (n, d) => console.log(`[PASS] ${n}${d ? ' — ' + d : ''}`);

const SHA256_FAKE = 'a'.repeat(64);
function mkManifest(over) {
  return Object.assign({
    approval_schema_version: A.APPROVAL_SCHEMA_VERSION,
    authorized_by: 'test',
    authorization_sha: HEAD40,
    authorized_at: '2026-09-28T00:00:00+08:00',
    changed_files: [RDE],
    orchestration_scope: ['TEST_SCOPE']
  }, over || {});
}
const run = (changed, manifest, headSha) => A.validate(manifest, { changed, headSha, classification: C });

/* ================= B-01 无改动 ⇒ 无需授权 ================= */
{
  const r = run([], null, null);
  assert.strictEqual(r.ok, true); assert.strictEqual(r.code, 'NO_APPROVAL_NEEDED');
  ok('B-01 无改动 ⇒ NO_APPROVAL_NEEDED');
}

/* ================= B-02 CALC 绝对禁止（即使有授权）================= */
{
  const r1 = run(['src/common/constants.js'], null, null);
  assert.strictEqual(r1.ok, false); assert.strictEqual(r1.code, 'CALC_TOUCHED');
  const r2 = run(['src/common/constants.js'], mkManifest({ changed_files: ['src/common/constants.js'] }), HEAD40);
  assert.strictEqual(r2.ok, false); assert.strictEqual(r2.code, 'CALC_TOUCHED');
  ok('B-02 CALC 绝对禁止（无授权路径）');
}

/* ================= B-03 ORCH 无清单 ⇒ FAIL ================= */
{
  const r = run(['src/common/utils/portfolio-mode.js'], null, null);
  assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'APPROVAL_MISSING');
  ok('B-03 ORCH 无授权清单 ⇒ APPROVAL_MISSING');
}

/* ================= B-04 ORCH + 有效清单 ⇒ APPROVED ================= */
{
  const f = 'src/common/utils/portfolio-mode.js';
  const r = run([f], mkManifest({ changed_files: [f] }), HEAD40);
  assert.strictEqual(r.ok, true); assert.strictEqual(r.code, 'APPROVED');
  ok('B-04 ORCH + 有效授权 ⇒ APPROVED');
}

/* ================= B-05 授权 SHA 不匹配 ⇒ FAIL ================= */
{
  const r = run([RDE], mkManifest(), 'f'.repeat(40));
  assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'AUTHORIZATION_SHA_MISMATCH');
  ok('B-05 授权 SHA 与 HEAD 不匹配 ⇒ FAIL');
}

/* ================= B-06 缺 head-sha ⇒ FAIL（fail-closed）================= */
{
  const r = run([RDE], mkManifest(), null);
  assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'HEAD_SHA_REQUIRED');
  ok('B-06 提供清单但缺 --head-sha ⇒ HEAD_SHA_REQUIRED');
}

/* ================= B-07 授权 SHA 必须 40 位字面值 ================= */
{
  const r = run([RDE], mkManifest({ authorization_sha: 'HEAD' }), 'HEAD');
  assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'AUTHORIZATION_SHA_INVALID');
  ok('B-07 授权 SHA 非 40 位字面值 ⇒ FAIL（R-GI-002）');
}

/* ================= B-08 changed_files 必须完全一致 ================= */
{
  const extra = run([RDE], mkManifest({ changed_files: [RDE, 'docs/X.md'] }), HEAD40);
  assert.strictEqual(extra.ok, false); assert.strictEqual(extra.code, 'APPROVAL_CHANGED_FILES_MISMATCH');
  const miss = run([RDE, 'docs/X.md'], mkManifest({ changed_files: [RDE] }), HEAD40);
  assert.strictEqual(miss.ok, false); assert.strictEqual(miss.code, 'APPROVAL_CHANGED_FILES_MISMATCH');
  ok('B-08 changed_files 多报/少报均 ⇒ FAIL');
}

/* ================= B-09 scope 必须非空 ================= */
{
  const r = run([RDE], mkManifest({ orchestration_scope: [] }), HEAD40);
  assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'APPROVAL_SCOPE_EMPTY');
  ok('B-09 orchestration_scope 空 ⇒ FAIL');
}

/* ================= B-10 MIXED 需 zone 或 comment-only 证明 ================= */
{
  const r = run([RDE], mkManifest(), HEAD40);
  assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'MIXED_REQUIRES_ZONE_OR_COMMENT_ONLY_PROOF');
  ok('B-10 MIXED 无 zone 无 proof ⇒ FAIL');
}

/* ================= B-11 MIXED + comment-only 证明 ⇒ APPROVED ================= */
{
  const r = run([RDE], mkManifest({
    comment_only_proof: {
      file: RDE, comment_stripped_sha_before: SHA256_FAKE, comment_stripped_sha_after: SHA256_FAKE
    }
  }), HEAD40);
  assert.strictEqual(r.ok, true); assert.strictEqual(r.code, 'APPROVED');
  // ⚠️ 反向：before ≠ after ⇒ 不是 comment-only ⇒ FAIL
  const bad = run([RDE], mkManifest({
    comment_only_proof: { file: RDE, comment_stripped_sha_before: SHA256_FAKE, comment_stripped_sha_after: 'b'.repeat(64) }
  }), HEAD40);
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.code, 'MIXED_REQUIRES_ZONE_OR_COMMENT_ONLY_PROOF');
  ok('B-11 MIXED + comment-only 证明 ⇒ APPROVED（且 before≠after 时 FAIL）');
}

/* ================= B-12 MIXED + zone 声明（⚠️ HD12-3 起须附区域包含性）================= */
{
  // ① 仅声明 zone、不给区域 ⇒ FAIL（HD12-3 关闭 OBS-D：「声明而非验证」不再被接受）
  const bare = run([RDE], mkManifest({ zone_declaration: ['telemetry'] }), HEAD40);
  assert.strictEqual(bare.ok, false);
  assert.strictEqual(bare.code, 'ZONE_DECLARATION_WITHOUT_REGIONS');
  // ② 声明 + 区域落在 zone 内 ⇒ APPROVED
  const withRegions = A.validate(mkManifest({ zone_declaration: ['telemetry'] }), {
    changed: [RDE], headSha: HEAD40,
    changedRegions: [{ file: RDE, start: 1430, end: 1440 }],
    zonesByFile: { [RDE]: { telemetry: [{ start: 1424, end: 1521 }] } },
    classification: C
  });
  assert.strictEqual(withRegions.ok, true);
  assert.strictEqual(withRegions.code, 'APPROVED');
  // ③ 声明 + 区域在 zone 外 ⇒ FAIL
  const outside = A.validate(mkManifest({ zone_declaration: ['telemetry'] }), {
    changed: [RDE], headSha: HEAD40,
    changedRegions: [{ file: RDE, start: 900, end: 910 }],
    zonesByFile: { [RDE]: { telemetry: [{ start: 1424, end: 1521 }] } },
    classification: C
  });
  assert.strictEqual(outside.ok, false);
  assert.strictEqual(outside.code, 'REGION_OUTSIDE_DECLARED_ZONE');
  ok('B-12 MIXED + zone 声明（须附区域包含性）');
}

/* ================= B-13 REPLAY_INFRA 需专门评审标记 ================= */
{
  const f = 'scripts/lib/v364-replay-harness.js';
  const noMarker = run([f], mkManifest({ changed_files: [f] }), HEAD40);
  assert.strictEqual(noMarker.ok, false); assert.strictEqual(noMarker.code, 'REPLAY_INFRA_REVIEW_REQUIRED');
  const withMarker = run([f], mkManifest({ changed_files: [f], replay_infra_review: C.REPLAY_INFRA_REVIEW_MARKER }), HEAD40);
  assert.strictEqual(withMarker.ok, true); assert.strictEqual(withMarker.code, 'APPROVED');
  ok('B-13 REPLAY_INFRA 需 REPLAY_INFRA_CHANGE_REVIEW_REQUIRED');
}

/* ================= B-14 受保护域内未登记 ⇒ 默认拒绝 ================= */
{
  const r = run(['src/common/utils/__hd12_2_unregistered__.js'], null, null);
  assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'UNCLASSIFIED_IN_PROTECTED_DOMAIN');
  ok('B-14 域内未登记 ⇒ UNCLASSIFIED_IN_PROTECTED_DOMAIN');
}

/* ================= B-15 授权清单不得覆盖 CALC（防夹带）================= */
{
  // ① 无受保护文件被改动时，授权清单内容**不参与判定**（提前返回 ⇒ 无害）
  const r0 = run(['docs/X.md'], mkManifest({ changed_files: ['docs/X.md', 'src/common/utils/decision.js'] }), HEAD40);
  assert.strictEqual(r0.ok, true);
  assert.strictEqual(r0.code, 'NO_APPROVAL_NEEDED',
    '未改动受保护文件时不应进入授权校验（避免误报）');
  // ② 真正防夹带：改动清单里**确实含** CALC ⇒ 即使清单声称授权也 CALC_TOUCHED
  const r2 = run(['docs/X.md', 'src/common/utils/decision.js'],
    mkManifest({ changed_files: ['docs/X.md', 'src/common/utils/decision.js'] }), HEAD40);
  assert.strictEqual(r2.ok, false); assert.strictEqual(r2.code, 'CALC_TOUCHED');
  ok('B-15 授权不得覆盖 CALC（夹带 ⇒ CALC_TOUCHED）');
}

/* ================= B-16 门禁集成：RDE 无清单 ⇒ exit ≠ 0 ================= */
{
  const p = path.join(os.tmpdir(), 'hd12-2-b16-changed.txt');
  fs.writeFileSync(p, RDE + '\n', 'utf8');
  const r = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'v365-p12-decision-parity.js'), '--changed-file', p],
    { cwd: REPO, encoding: 'utf8' });
  fs.unlinkSync(p);
  assert.ok(r.error == null, 'parity 子进程必须可运行');
  assert.notStrictEqual(r.status, 0, 'RDE 改动且无授权清单 ⇒ 门禁必须 FAIL');
  assert.ok(/受保护文件变更已授权/.test(String(r.stdout)), '必须命中授权判据');
  ok('B-16 门禁集成：RDE 无授权 ⇒ FAIL', `exit=${r.status}`);
}

/* ================= B-17 门禁集成：域外改动 ⇒ PASS ================= */
{
  const p = path.join(os.tmpdir(), 'hd12-2-b17-changed.txt');
  fs.writeFileSync(p, 'docs/ONLY.md\n', 'utf8');
  const r = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'v365-p12-decision-parity.js'), '--changed-file', p],
    { cwd: REPO, encoding: 'utf8' });
  fs.unlinkSync(p);
  assert.strictEqual(r.status, 0, '仅域外改动 ⇒ 门禁必须 PASS');
  assert.ok(/NO_APPROVAL_NEEDED/.test(String(r.stdout)));
  ok('B-17 门禁集成：仅域外改动 ⇒ PASS');
}

console.log('\nHD12-2 授权机制专项测试：B-01 ~ B-17 全部 PASS');
