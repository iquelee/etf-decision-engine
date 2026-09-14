#!/usr/bin/env node
/**
 * WP-G2-04：**构建产物 vs 冻结锁逐位一致**校验器。
 *
 * 为什么单独一个脚本：`scripts/verify-immutable.js`（Stage C）只校验**仓库内受版本控制**的
 * 冻结对象；而云函数实际加载的 `GEN2_RULE_V2_BUNDLE.json` 是 `scripts/build-cloudfunctions.js`
 * 在**构建时**从 `ml/gen2/manifests/` 复制到 `dist-functions/runGen2ShadowEod/` 的产物
 * （`dist-functions/` 被 .gitignore 忽略）。所以必须「先构建、再比对」。
 *
 * 校验三件事（任一不符即 exit 1）：
 *   1. 产物存在（缺失 ⇒ 提示先 `node scripts/build-cloudfunctions.js`）；
 *   2. 产物 SHA == `GEN2_RULE_V2_LOCK.json.build_artifacts[].sha256`；
 *   3. 产物 SHA == 其镜像的冻结源（bundle / js 实现）SHA ⇒ **逐位一致**（不是"内容等价"）。
 *
 * 附加端到端断言：产物 bundle 必须自带 `selection.role_thresholds` 且 `bundle_version`
 * 与 lock 一致 —— 即「云函数运行时真正读到的那份规则」就是被冻结的那份。
 *
 * 用法：node scripts/verify-gen2-build-artifacts.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..');
const LOCK_REL = 'ml/gen2/manifests/GEN2_RULE_V2_LOCK.json';
const DIST_DIR = 'dist-functions/runGen2ShadowEod';

/** 与 verify-immutable.js 同口径：CRLF→LF 归一化后再哈希（行尾差异不算改动）。 */
function sha256Normalized(rel) {
  const buf = fs.readFileSync(path.join(REPO, rel));
  return crypto.createHash('sha256').update(buf.toString('utf8').replace(/\r\n/g, '\n')).digest('hex');
}

function main() {
  const lock = JSON.parse(fs.readFileSync(path.join(REPO, LOCK_REL), 'utf8'));
  const byId = {};
  for (const e of lock.immutable_set || []) byId[e.id] = e;

  const checks = [];
  const artifacts = lock.build_artifacts || [];

  checks.push({
    name: `lock.build_artifacts 条目数（≥2：云函数 bundle + 云函数 index.js）`,
    expected: '2',
    actual: String(artifacts.length),
  });

  for (const a of artifacts) {
    const abs = path.join(REPO, a.file);
    if (!fs.existsSync(abs)) {
      checks.push({
        name: `产物存在 ${a.file}`,
        expected: 'exists',
        actual: 'missing（先跑 `node scripts/build-cloudfunctions.js`）',
      });
      continue;
    }
    const actual = sha256Normalized(a.file);
    checks.push({ name: `产物 SHA == lock ${a.id}`, expected: a.sha256, actual });

    const mirror = byId[a.must_equal];
    if (mirror) {
      checks.push({
        name: `产物逐位一致 == 冻结源 [${a.must_equal}] ${mirror.file}`,
        expected: mirror.sha256,
        actual,
      });
    } else {
      checks.push({
        name: `产物镜像目标 [${a.must_equal}] 存在于 immutable_set`,
        expected: 'present',
        actual: 'missing',
      });
    }
  }

  // 端到端：云函数运行时真正读到的那份 bundle，必须就是被冻结（且已迁移）的那份。
  const distBundle = path.join(REPO, DIST_DIR, 'GEN2_RULE_V2_BUNDLE.json');
  if (fs.existsSync(distBundle)) {
    let b = null;
    try {
      b = JSON.parse(fs.readFileSync(distBundle, 'utf8'));
    } catch (e) {
      checks.push({ name: `产物 bundle 可解析为 JSON`, expected: 'ok', actual: String(e.message) });
    }
    if (b) {
      const rt = b.selection && b.selection.role_thresholds;
      checks.push({
        name: `产物 bundle 自带 selection.role_thresholds（云函数不再 blocked/RULE_BUNDLE_INCOMPLETE）`,
        expected: 'present',
        actual: rt && typeof rt === 'object' ? 'present' : 'missing',
      });
      checks.push({
        name: `产物 bundle_version == lock.bundle_version`,
        expected: lock.bundle_version,
        actual: b.bundle_version,
      });
    }
  }

  let failed = 0;
  for (const c of checks) {
    const ok = String(c.actual) === String(c.expected);
    if (!ok) failed += 1;
    console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${c.name}${ok ? '' : `\n       expected ${c.expected}\n       actual   ${c.actual}`}`);
  }
  console.log(`\n=== WP-G2-04 构建产物逐位一致：${checks.length - failed}/${checks.length} 项 ===`);
  process.exit(failed ? 1 : 0);
}

main();
