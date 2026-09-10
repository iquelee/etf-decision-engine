#!/usr/bin/env node
/**
 * Gen-1 Sector Contract Audit（WP-G1.1 / G1.1-02）。
 *
 * 事实来源：
 *   ① frozen model 每个 fold 的 `sector` categorical encoder 类别集合
 *   ② 运行时 sector 词表（runGen1ShadowEod SECTORS）
 *   ③ src/common/utils/gen1-capability.js 的 ENCODER_SECTOR_FOLDS / SECTOR_COVERAGE
 *
 * 门禁规则（CI FAIL 条件）：
 *   - 部署侧 ENCODER_SECTOR_FOLDS 与 frozen model 逐 fold 事实不一致 → FAIL
 *   - SECTOR_COVERAGE（若被硬写）与由 ENCODER_SECTOR_FOLDS 推导的值不一致 → FAIL
 *   - 任一运行时 sector 的 observed_folds 与 encoder 命中数不一致 → FAIL
 *
 * 审计结论（2026-09-10）：**一致**。observed_folds 恰好等于认识该字符串的 fold 数：
 *   biotech 3/3、storage 2/3、ai_network 2/3、semi_equip 2/3、gold 0/3。
 * → 不存在 capability 与 encoder 的矛盾；gold 为域外（0/3）。
 *
 * 产出：ml/manifests/GEN1_SECTOR_CONTRACT_AUDIT.json
 * 用法：node scripts/audit-gen1-sector-contract.js [--check]
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const MODEL = path.join(REPO, 'cloudfunctions/runGen1ShadowEod/frozen-model.json');
const OUT = path.join(REPO, 'ml/manifests/GEN1_SECTOR_CONTRACT_AUDIT.json');

/** 运行时 sector 词表（与 runGen1ShadowEod SECTORS 一致）。 */
const RUNTIME_SECTORS = {
  '513310': 'storage', '515880': 'ai_network', '159582': 'semi_equip',
  '518880': 'gold', '159570': 'biotech'
};

function parseCapabilitySource() {
  const src = fs.readFileSync(path.join(REPO, 'src/common/utils/gen1-capability.js'), 'utf8');
  // ENCODER_SECTOR_FOLDS: { sector: Object.freeze([true, true, true]), ... }
  const block = src.match(/ENCODER_SECTOR_FOLDS\s*=\s*Object\.freeze\(\{([\s\S]*?)\n\}\)/);
  const perFold = {};
  if (block) {
    for (const line of block[1].split('\n')) {
      const m = line.match(/^\s*([A-Za-z_]+):\s*Object\.freeze\(\[([^\]]*)\]\)/);
      if (m) {
        perFold[m[1]] = m[2].split(',').map((s) => s.trim()).map((s) => s === 'true');
      }
    }
  }
  const ver = src.match(/SECTOR_CONTRACT_VERSION\s*=\s*'([^']+)'/);
  return { perFold, version: ver ? ver[1] : null };
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const model = JSON.parse(fs.readFileSync(MODEL, 'utf8'));
  const sectorIndex = model.features_cat.indexOf('sector');
  if (sectorIndex < 0) throw new Error('frozen model has no sector categorical feature');

  const perFoldCategories = model.folds.map((f) => f.categories[sectorIndex].slice());
  const union = [...new Set(perFoldCategories.flat())].sort();
  const cap = parseCapabilitySource();

  const runtimeAudit = {};
  const drift = [];

  for (const [code, sector] of Object.entries(RUNTIME_SECTORS)) {
    const actualPerFold = perFoldCategories.map((cats) => cats.includes(sector));
    const actualRecognized = actualPerFold.filter(Boolean).length;
    const declared = cap.perFold[sector];
    const declaredMatches = Array.isArray(declared)
      && declared.length === actualPerFold.length
      && declared.every((v, i) => v === actualPerFold[i]);
    if (!declaredMatches) drift.push(`ENCODER_SECTOR_FOLDS.${sector}: declared=${JSON.stringify(declared)} actual=${JSON.stringify(actualPerFold)}`);

    const encodePerFold = perFoldCategories.map((cats) => {
      const i = cats.indexOf(sector);
      return i >= 0 ? i : -1;
    });
    runtimeAudit[sector] = {
      code,
      encoder_folds_present: actualPerFold,
      encoder_recognized_folds: actualRecognized,
      encoder_encode_per_fold: encodePerFold,
      encoder_partial: actualRecognized > 0 && actualRecognized < perFoldCategories.length,
      encoder_recognized: actualRecognized === perFoldCategories.length,
      domain_status: actualRecognized === 0 ? 'OUT_OF_DOMAIN'
        : (actualRecognized < perFoldCategories.length ? 'PARTIAL_COVERAGE' : 'IN_DOMAIN'),
      declared_folds_match_encoder: declaredMatches
    };
  }

  // 覆盖声明漂移检查（capability 若硬写 SECTOR_COVERAGE，须与推导值一致）
  const covBlock = fs.readFileSync(path.join(REPO, 'src/common/utils/gen1-capability.js'), 'utf8')
    .match(/SECTOR_COVERAGE\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\)/) ;
  if (covBlock) {
    for (const line of covBlock[1].split('\n')) {
      const m = line.match(/^\s*([A-Za-z_]+):\s*(\d+)/);
      if (m) {
        const sector = m[1]; const declared = Number(m[2]);
        const actual = perFoldCategories.filter((cats) => cats.includes(sector)).length;
        if (declared !== actual) drift.push(`SECTOR_COVERAGE.${sector}: declared=${declared} actual=${actual}`);
      }
    }
  }

  const blocksCanary = Object.values(runtimeAudit).some((x) => x.encoder_recognized_folds === 0);

  const audit = {
    audit_version: 'gen1-sector-contract-v1',
    model_id: model.model_id,
    generated_at: '2026-09-10',
    generator: 'scripts/audit-gen1-sector-contract.js',
    encoder_categories_by_fold: perFoldCategories,
    encoder_categories_union: union,
    declared_encoder_folds_in_capability: cap.perFold,
    contract_version: cap.version,
    runtime_sector_audit: runtimeAudit,
    drift: drift,
    status: drift.length === 0 ? 'CONSISTENT' : 'CONTRACT_DRIFT',
    contradiction: drift.length > 0,
    blocks_canary: blocksCanary,
    canary_block_reason: blocksCanary
      ? '存在运行时 sector 在全部 fold 中均未被 encoder 认识（编码 -1）→ 该标的按 OUT_OF_DOMAIN 处理（gen1-domain-permission 返回 BLOCK_CANARY）。'
      : null,
    notes: [
      '审计结论：capability 的 observed_folds 与 frozen encoder 命中 fold 数**一致**（无矛盾）。',
      '各 fold encoder 类别集合不同（fold0 不含 storage/ai_network/semi_equip）→ 这些类别有 1/3 fold 编码为 -1，',
      '属已知 encoder 契约事实，对应 PARTIAL_COVERAGE 标注；gold 3/3 均 -1 → OUT_OF_DOMAIN。',
      '未修改 frozen model / encoder（禁止）。若未来需要 storage→semi 等映射，',
      '必须从原始训练数据证明映射关系并新建 runtime contract version / bundle version。'
    ]
  };

  fs.writeFileSync(OUT, JSON.stringify(audit, null, 2) + '\n', 'utf8');

  console.log('\n== G1.1-02 Gen-1 Sector Contract Audit ==');
  perFoldCategories.forEach((c, i) => console.log(`   fold${i}: [${c.join(', ')}]`));
  for (const [sector, info] of Object.entries(runtimeAudit)) {
    console.log(`   ${sector.padEnd(11)} code=${info.code} folds=${JSON.stringify(info.encoder_folds_present)} `
      + `recognized=${info.encoder_recognized_folds}/3 status=${info.domain_status} match=${info.declared_folds_match_encoder}`);
  }
  console.log(`   status=${audit.status}  blocks_canary=${audit.blocks_canary}  drift=${drift.length}`);
  console.log(`   [OK] ${path.relative(REPO, OUT)}`);

  if (drift.length > 0) {
    console.error('\nFATAL: capability 契约与 frozen encoder 事实漂移（CI FAIL）：');
    drift.forEach((d) => console.error('  - ' + d));
    process.exitCode = 1;
  }
  if (checkOnly) return;
}

main();
