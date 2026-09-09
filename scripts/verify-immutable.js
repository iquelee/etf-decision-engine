#!/usr/bin/env node
/**
 * Immutable 真 SHA 校验器（P0-A，修复「git diff HEAD 假锁」）。
 *
 * 问题：旧 Stage C / CI Gate 6 用 `git diff --quiet HEAD -- file`，在 CI 干净 checkout
 * 上工作区恒等于 HEAD → 即使历史 commit 修改了 frozen 文件也 PASS。它证明的是
 * 「工作区无未提交改动」，不是「冻结引擎未被修改」。
 *
 * 本脚本改为「实际文件 SHA256 == lock 文件 expected SHA256」：
 *   - Gen-1 frozen：  ml/manifests/GEN1_IMMUTABLE_LOCK.json
 *   - V3.6.1 决策核心： ml/manifests/V361_IMMUTABLE_LOCK.json
 *   - GEN2 Rule V2：  ml/gen2/manifests/GEN2_RULE_V2_LOCK.json
 *
 * 任意 mismatch → exit 1。升级冻结对象必须显式新 bundle/version/lock，不允许静默改旧。
 *
 * 用法：node scripts/verify-immutable.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..');

/**
 * 冻结内容 sha256（P0-A 修正，2026-09-09）：
 * hash 前做 \r\n→\n 归一化，使「lock 基准」与平台 checkout 行尾无关
 * （Windows worktree 因 core.autocrlf=true 是 CRLF，Linux CI 是 LF）。
 * 纯行尾差异不视为改动；真实内容差异仍必被抓。
 */
function sha256File(file) {
  const buf = fs.readFileSync(path.join(REPO, file));
  const normalized = buf.toString('utf8').replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

const GEN1 = 'cloudfunctions/runGen1ShadowEod/';
const CHECKS = [];

function addLock(lockRel, entries) {
  const lock = JSON.parse(fs.readFileSync(path.join(REPO, lockRel), 'utf8'));
  for (const [lockKey, file] of entries) {
    CHECKS.push({
      name: `${file} vs ${path.basename(lockRel)}.${lockKey}`,
      expected: lock[lockKey],
      actual: sha256File(file),
      lockRef: lockRel,
    });
  }
  return lock;
}

// Gen-1 frozen（3 文件 + model_id）
const gen1Lock = addLock('ml/manifests/GEN1_IMMUTABLE_LOCK.json', [
  ['model_sha256', `${GEN1}frozen-model.json`],
  ['freeze_manifest_sha256', `${GEN1}frozen-manifest.json`],
  ['inference_sha256', `${GEN1}frozen-node-inference.js`],
]);
{
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO, `${GEN1}frozen-manifest.json`), 'utf8'));
  CHECKS.push({
    name: `frozen-manifest.model_id == lock.model_id`,
    expected: gen1Lock.model_id,
    actual: manifest.model_id,
  });
}

// V3.6.1 决策核心（2 文件）
addLock('ml/manifests/V361_IMMUTABLE_LOCK.json', [
  ['decision_v3_sha256', 'src/common/utils/decision-v3.js'],
  ['decision_sha256', 'src/common/utils/decision.js'],
]);

// GEN2 Rule V2 bundle（1 文件 + version）
const g2Lock = addLock('ml/gen2/manifests/GEN2_RULE_V2_LOCK.json', [
  ['bundle_sha256', 'ml/gen2/manifests/GEN2_RULE_V2_BUNDLE.json'],
]);
{
  const bundle = JSON.parse(fs.readFileSync(path.join(REPO, 'ml/gen2/manifests/GEN2_RULE_V2_BUNDLE.json'), 'utf8'));
  CHECKS.push({
    name: `bundle_version == lock.bundle_version`,
    expected: g2Lock.bundle_version,
    actual: bundle.bundle_version,
  });
}

let failed = 0;
for (const c of CHECKS) {
  const ok = String(c.actual) === String(c.expected);
  if (!ok) failed += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${c.name}${ok ? '' : `\n       expected ${c.expected}\n       actual   ${c.actual}（lockRef: ${c.lockRef}）`}`);
}
console.log(`\n=== Immutable SHA：${CHECKS.length - failed}/${CHECKS.length} 项锁定 ===`);
process.exit(failed ? 1 : 0);
