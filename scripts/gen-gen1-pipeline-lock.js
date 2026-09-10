#!/usr/bin/env node
/**
 * 生成 Gen-1 Feature Pipeline Lock + Runtime Bundle（WP-G1 / G1-04）。
 *
 * 冻结「模型之外」的输入语义：指标实现、阶段实现、Gen-1 PARAMS、特征构建、
 * RS20 计算、特征 schema、sector 映射。这样即使模型没变，只要 indicators.js
 * 等任一环节变化，CI 也会 FAIL。
 *
 * 用法：node scripts/gen-gen1-pipeline-lock.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..');

/** LF 归一化 sha256（Windows worktree == Linux CI）。 */
function sha256lf(rel) {
  const raw = fs.readFileSync(path.join(REPO, rel)).toString('utf8').replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/** 与 runGen1ShadowEod.schemaHash() 完全一致（键顺序：features_cat, features_core）。 */
function featureSchemaHash() {
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO, 'cloudfunctions/runGen1ShadowEod/frozen-manifest.json'), 'utf8'));
  return crypto.createHash('sha256').update(JSON.stringify({
    features_cat: manifest.features_cat, features_core: manifest.features_core
  })).digest('hex');
}

const PIPELINE_FILES = [
  { role: 'indicator_implementation', path: 'src/common/utils/indicators.js' },
  { role: 'trend_stage_implementation', path: 'src/common/utils/trend-stage.js' },
  { role: 'feature_builder_and_params', path: 'cloudfunctions/runGen1ShadowEod/index.js' },
  { role: 'feature_schema_and_thresholds', path: 'cloudfunctions/runGen1ShadowEod/frozen-manifest.json' }
];

function main() {
  const gen1Lock = JSON.parse(fs.readFileSync(path.join(REPO, 'ml/manifests/GEN1_IMMUTABLE_LOCK.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO, 'cloudfunctions/runGen1ShadowEod/frozen-manifest.json'), 'utf8'));

  const files = PIPELINE_FILES.map((f) => ({ role: f.role, path: f.path, sha256: sha256lf(f.path) }));
  const schemaHash = featureSchemaHash();

  const lock = {
    version: 'gen1-feature-pipeline-v1',
    model_id: gen1Lock.model_id,
    sealed_at: '2026-09-10',
    hash_basis: 'LF-normalized content (CRLF->LF before sha256) so Windows worktree == Linux CI',
    files,
    derived: {
      feature_schema_sha256: schemaHash,
      threshold_signal_p: manifest.thresholds.signal_p,
      threshold_version: 'shadow-threshold-v1',
      calibration_version: 'cal-isotonic-cv3-v1',
      domain_policy_version: 'gen1-domain-policy-v1',
      permission_version: 'gen1-safety-permission-v1',
      authority_version: 'gen1-authority-v1',
      circuit_breaker_version: 'gen1-circuit-breaker-v1'
    },
    rule: 'Gen-1 特征管线冻结：任何 role 文件变更（指标/阶段/PARAMS/特征构建/RS20/schema/sector 映射/数据健康/域策略）都必须显式更新本锁并走审批；不得静默修改。'
  };

  const lockPath = path.join(REPO, 'ml/manifests/GEN1_FEATURE_PIPELINE_LOCK.json');
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n', 'utf8');
  const lockSha = sha256lf('ml/manifests/GEN1_FEATURE_PIPELINE_LOCK.json');

  const bundle = {
    bundle_id: 'gen1-runtime-hvta-20260830',
    model_id: gen1Lock.model_id,
    model_sha256: gen1Lock.model_sha256,
    freeze_manifest_sha256: gen1Lock.freeze_manifest_sha256,
    inference_sha256: gen1Lock.inference_sha256,
    feature_pipeline_lock: 'ml/manifests/GEN1_FEATURE_PIPELINE_LOCK.json',
    feature_pipeline_hash: lockSha,
    feature_schema_hash: schemaHash,
    threshold_signal_p: manifest.thresholds.signal_p,
    threshold_version: 'shadow-threshold-v1',
    calibration_version: 'cal-isotonic-cv3-v1',
    domain_policy_version: 'gen1-domain-policy-v1',
    permission_version: 'gen1-safety-permission-v1',
    authority_version: 'gen1-authority-v1',
    sealed_at: '2026-09-10',
    note: 'Gen-1 运行时 bundle：模型 SHA + 特征管线 SHA + schema + 各策略版本。生产 Canary 前置条件之一。'
  };
  fs.writeFileSync(path.join(REPO, 'ml/manifests/GEN1_RUNTIME_BUNDLE.json'), JSON.stringify(bundle, null, 2) + '\n', 'utf8');

  console.log('[OK] GEN1_FEATURE_PIPELINE_LOCK.json');
  files.forEach((f) => console.log(`     ${f.role}: ${f.sha256.slice(0, 16)}…  ${f.path}`));
  console.log(`     feature_schema_sha256: ${schemaHash.slice(0, 16)}…`);
  console.log(`[OK] GEN1_RUNTIME_BUNDLE.json`);
  console.log(`     feature_pipeline_hash: ${lockSha.slice(0, 16)}…`);
}

main();
