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

// GEN2 Rule V2（WP-G2-04 起：bundle SHA + 实现哈希 + 构建产物声明，共 1 lock 文件）
const G2_LOCK_REL = 'ml/gen2/manifests/GEN2_RULE_V2_LOCK.json';
const G2_BUNDLE_REL = 'ml/gen2/manifests/GEN2_RULE_V2_BUNDLE.json';
const g2Lock = JSON.parse(fs.readFileSync(path.join(REPO, G2_LOCK_REL), 'utf8'));
{
  CHECKS.push({
    name: `${G2_BUNDLE_REL} vs ${path.basename(G2_LOCK_REL)}.bundle_sha256`,
    expected: g2Lock.bundle_sha256,
    actual: sha256File(G2_BUNDLE_REL),
    lockRef: G2_LOCK_REL,
  });
  const bundle = JSON.parse(fs.readFileSync(path.join(REPO, G2_BUNDLE_REL), 'utf8'));
  CHECKS.push({
    name: `bundle_version == lock.bundle_version`,
    expected: g2Lock.bundle_version,
    actual: bundle.bundle_version,
    lockRef: G2_LOCK_REL,
  });
  // 规则闸门的显式契约（WP-G2-04 的目的）：冻结 bundle 必须自带 selection.role_thresholds，
  // 否则 Gen-2 Shadow 会（正确地）持续 blocked / RULE_BUNDLE_INCOMPLETE。
  const rt = bundle.selection && bundle.selection.role_thresholds;
  CHECKS.push({
    name: `bundle.selection.role_thresholds 存在（冻结后规则闸门不再 blocked）`,
    expected: 'present',
    actual: rt && typeof rt === 'object' ? 'present' : 'missing',
    lockRef: G2_LOCK_REL,
  });
  // 旧字段不得留在运行 selection 段（只允许在 legacy_migration_audit 里）
  const legacyLeak = ['core_pct', 'challenger_pct', 'satellite_pct', 'top_quantile']
    .filter((k) => bundle.selection && Object.prototype.hasOwnProperty.call(bundle.selection, k));
  CHECKS.push({
    name: `旧 selection 字段已退出运行段（只留 audit）`,
    expected: 'none',
    actual: legacyLeak.length ? legacyLeak.join(',') : 'none',
    lockRef: G2_LOCK_REL,
  });
}

// GEN2 Rule V2 冻结实现集合（裁决 2026-09-14：lock 必须同时覆盖实现哈希）。
// 结构守卫：条目数固定，避免「lock 被静默删条目 → 少检查也算 PASS」。
// lock_revision 2（2026-09-14 审查裁决扩围）：新增 python_role_thresholds
//   （ml/gen2/portfolio/role_thresholds.py —— 线上阈值加载/校验契约；不锁会留下
//    「bundle 字节未变、运行语义已变」的旁路）。
// lock_revision 3（2026-09-14 审查裁决扩围）：新增 python_selection_scores
//   （ml/gen2/baseline/selection_scores.py —— 显式 Alpha 计算/覆盖校验/内容哈希）与
//   python_regime（ml/gen2/portfolio/regime.py —— 55/45 实际执行常量，bundle 仅是声明）。
const G2_FROZEN_EXPECT = 8;
const G2_REQUIRED_IDS = [
  'bundle', 'js_implementation', 'python_rule', 'python_candidate', 'python_defense',
  'python_role_thresholds', 'python_selection_scores', 'python_regime',
];
{
  const entries = g2Lock.immutable_set || [];
  CHECKS.push({
    name: `lock.immutable_set 条目数（bundle + JS 实现 + Python 规则/候选/防守/阈值契约/评分/regime）`,
    expected: String(G2_FROZEN_EXPECT),
    actual: String(entries.length),
    lockRef: G2_LOCK_REL,
  });
  // 必锁 id 集合：防止「拿别的文件顶替」（例如把 role_thresholds.py 换成同名占位）。
  const gotIds = entries.map((e) => e.id).slice().sort();
  const wantIds = G2_REQUIRED_IDS.slice().sort();
  CHECKS.push({
    name: `lock.immutable_set id 集合 == 必需集合（含 python_role_thresholds / selection_scores / regime）`,
    expected: wantIds.join(','),
    actual: gotIds.join(','),
    lockRef: G2_LOCK_REL,
  });
  for (const e of entries) {
    CHECKS.push({
      name: `[${e.id}] ${e.file} —— ${e.role}`,
      expected: e.sha256,
      actual: sha256File(e.file),
      lockRef: G2_LOCK_REL,
    });
  }
}

// Root-of-trust（M0 审批修复，2026-09-09）：LOCK 文件自身 SHA 硬锚定在本 verifier 内。
// 防止「frozen bundle + 其 LOCK 同一 commit 一起改」绕过冻结（lock 内写入新 expected → 旧逻辑仍 PASS）。
// 校验顺序：① lock 文件 SHA == 本 ROOT_ANCHORS；② lock 内 expected == frozen 文件实际 SHA。
// 合法升级（新版本 freeze / 重新封印）必须显式同步修改本数组（PR diff 醒目，等同显式审批动作）。
const ROOT_ANCHORS = [
  { lock: 'ml/manifests/GEN1_IMMUTABLE_LOCK.json', sha256: '138fe886a9f50440f717eaa0739d3144fd5e6418fc8d3d2ad03d1643320501c0' },
  { lock: 'ml/manifests/V361_IMMUTABLE_LOCK.json', sha256: '1c724381e533dd51e4fd0268bdc14aca0b4f444a458eab6c75c97be78a78f1bd' },
  { lock: 'ml/gen2/manifests/GEN2_RULE_V2_LOCK.json', sha256: 'd3d40f99dd3d766bd326bf11cc81dcc1168fde4d59693187f1154b2a9e7b2d9c' },
];
for (const a of ROOT_ANCHORS) {
  CHECKS.push({
    name: `${a.lock} root-of-trust`,
    expected: a.sha256,
    actual: sha256File(a.lock),
    lockRef: 'verify-immutable.js ROOT_ANCHORS',
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
