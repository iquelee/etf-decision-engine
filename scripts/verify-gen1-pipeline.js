#!/usr/bin/env node
/**
 * Gen-1 Feature Pipeline Lock 校验器（WP-G1 / G1-04 + G1-11 Gate G1-B）。
 *
 * 两级校验（防止「文件 + 锁一起改」绕过）：
 *   ① 锁文件自身 SHA == 本脚本内 root anchor（防静默改锁）
 *   ② 锁内 expected SHA == 各管线文件实际 SHA（LF 归一化）
 *   ③ derived.feature_schema_sha256 == 运行时反复计算的 schema hash
 *   ④ GEN1_RUNTIME_BUNDLE.feature_pipeline_hash == 锁文件实际 SHA
 *
 * 用法：node scripts/verify-gen1-pipeline.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..');

const PIPELINE_LOCK = 'ml/manifests/GEN1_FEATURE_PIPELINE_LOCK.json';
const RUNTIME_BUNDLE = 'ml/manifests/GEN1_RUNTIME_BUNDLE.json';

/**
 * ROOT ANCHOR：锁文件自身的 LF 归一化 SHA。
 * 合法变更管线锁时必须同步更新此值（PR diff 将非常醒目）。
 * 由 `node scripts/gen-gen1-pipeline-lock.js` 生成后填入。
 */
const ROOT_ANCHOR_PIPELINE_LOCK = '8efdda6fadb7da409c4d6215851495cf63dec4904a371d3bf5fff82008a2b7ad';

function sha256lf(rel) {
  const raw = fs.readFileSync(path.join(REPO, rel)).toString('utf8').replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function featureSchemaHash() {
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO, 'cloudfunctions/runGen1ShadowEod/frozen-manifest.json'), 'utf8'));
  return crypto.createHash('sha256').update(JSON.stringify({
    features_cat: manifest.features_cat, features_core: manifest.features_core
  })).digest('hex');
}

/**
 * 执行全部管线校验。
 * @returns {{checks: Array<{name, expected, actual}>, ok: boolean}}
 */
function verifyPipeline() {
  const checks = [];
  const add = (name, expected, actual) => checks.push({ name, expected, actual });

  // ① root anchor：锁文件自身
  add('GEN1_FEATURE_PIPELINE_LOCK.json root-of-trust', ROOT_ANCHOR_PIPELINE_LOCK, sha256lf(PIPELINE_LOCK));

  const lock = JSON.parse(fs.readFileSync(path.join(REPO, PIPELINE_LOCK), 'utf8'));

  // ② 每个管线文件
  for (const f of lock.files) {
    add(`gen1-pipeline/${f.role}`, f.sha256, sha256lf(f.path));
  }

  // ③ derived schema hash
  if (lock.derived && lock.derived.feature_schema_sha256) {
    add('gen1-pipeline/feature_schema_sha256', lock.derived.feature_schema_sha256, featureSchemaHash());
  }

  // ④ runtime bundle 指向一致性
  if (fs.existsSync(path.join(REPO, RUNTIME_BUNDLE))) {
    const bundle = JSON.parse(fs.readFileSync(path.join(REPO, RUNTIME_BUNDLE), 'utf8'));
    add('gen1-runtime-bundle/feature_pipeline_hash', sha256lf(PIPELINE_LOCK), bundle.feature_pipeline_hash);
    if (lock.derived && lock.derived.feature_schema_sha256) {
      add('gen1-runtime-bundle/feature_schema_hash', lock.derived.feature_schema_sha256, bundle.feature_schema_hash);
    }
    const gen1Lock = JSON.parse(fs.readFileSync(path.join(REPO, 'ml/manifests/GEN1_IMMUTABLE_LOCK.json'), 'utf8'));
    add('gen1-runtime-bundle/model_sha256', gen1Lock.model_sha256, bundle.model_sha256);
  }

  // ⑤ G1.1-01：部署侧常量 constants.js 的阈值必须等于 frozen-manifest 阈值
  {
    const constantsSrc = fs.readFileSync(path.join(REPO, 'src/common/constants.js'), 'utf8');
    const m = constantsSrc.match(/gen1_frozen_threshold_p:\s*([0-9.]+)/);
    const deployValue = m ? Number(m[1]) : null;
    const frozenValue = lock.derived ? Number(lock.derived.threshold_signal_p) : null;
    add('gen1-threshold/constants.js == frozen-manifest', String(frozenValue), String(deployValue));
  }

  const ok = checks.every((c) => c.expected === c.actual);
  return { checks, ok };
}

function main() {
  const { checks, ok } = verifyPipeline();
  let failed = 0;
  checks.forEach((c) => {
    const pass = c.expected === c.actual;
    if (!pass) failed++;
    const mark = pass ? 'PASS' : 'FAIL';
    const detail = pass ? '' : ` — expected ${String(c.expected).slice(0, 16)}… got ${String(c.actual).slice(0, 16)}…`;
    console.log(`  [${mark}] ${c.name}${detail}`);
  });
  console.log(`\n=== Gen-1 Feature Pipeline Lock：${checks.length - failed}/${checks.length} 项通过 ===`);
  process.exitCode = failed === 0 ? 0 : 1;
}

if (require.main === module) main();

module.exports = { verifyPipeline, sha256lf, featureSchemaHash, PIPELINE_LOCK, RUNTIME_BUNDLE, ROOT_ANCHOR_PIPELINE_LOCK };
