#!/usr/bin/env node
/**
 * WP-RH1 —— Contract Registry 专项测试（E-01 ~ E-12）
 *
 * 验证：
 *   · 5 个 v365 集合全部登记（constants ↔ SCHEMAS 的**双源并集**口径）
 *   · 集合名**唯一来源** = `v365-contracts.js`（OD-5 冻结）
 *   · ⛔ `constants.js`（CALC / HD12-D8）**零改动**
 *   · 集合名收敛（`POC_COLLECTIONS` → `V365_COLLECTIONS` 别名）
 *   · `run_history` 符合 OD-1 方案 A′（严格 append-only）
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const { SCHEMAS, getSchema, getCollectionNames } = require(path.join(REPO, 'src/common/schema.js'));
const { COLLECTIONS } = require(path.join(REPO, 'src/common/constants.js'));
const { V365_COLLECTIONS } = require(path.join(REPO, 'src/common/utils/v365-contracts.js'));
const AP = require(path.join(REPO, 'src/common/utils/v365-atomic-publish.js'));

const V365_NAMES = ['run_manifest', 'run_candidate_decision', 'run_candidate_portfolio', 'active_run_pointer', 'run_history'];
const ok = (n, d) => console.log(`[PASS] ${n}${d ? ' — ' + d : ''}`);

/* ================= E-01 5 个 v365 集合全部登记在 SCHEMAS ================= */
{
  const missing = V365_NAMES.filter((n) => !SCHEMAS.some((s) => s.name === n));
  assert.deepStrictEqual(missing, [], `以下 v365 集合未登记：${missing.join(', ')}`);
  ok('E-01 5 个 v365 集合全部登记在 SCHEMAS', `SCHEMAS=${SCHEMAS.length}`);
}

/* ================= E-02 getCollectionNames 含全部 5 个（init-collections 依赖）================= */
{
  const names = getCollectionNames();
  V365_NAMES.forEach((n) => assert.ok(names.includes(n), `${n} 必须进入 init-collections 的建集合清单`));
  ok('E-02 init-collections 清单含全部 5 个', `getCollectionNames()=${names.length}`);
}

/* ================= E-03 ⛔ constants.js（CALC）零改动 ================= */
{
  const r = spawnSync('git', ['diff', '--name-only', 'HEAD', '--', 'src/common/constants.js'],
    { cwd: REPO, encoding: 'utf8' });
  assert.ok(!r.error && r.status === 0, 'git 必须可用');
  assert.strictEqual(String(r.stdout).trim(), '',
    'src/common/constants.js 属 DECISION_CALCULATION_CORE（HD12-D8）⇒ ⛔ 绝对不得改动');
  ok('E-03 constants.js 零改动（CALC 绝对保护）');
}

/* ================= E-04 集合名唯一来源 = v365-contracts.js ================= */
{
  const constNames = Object.values(COLLECTIONS).filter((v) => typeof v === 'string');
  const leaked = V365_NAMES.filter((n) => constNames.includes(n));
  assert.deepStrictEqual(leaked, [],
    `v365 集合名不得出现在 constants.COLLECTIONS（OD-5 要求单一来源）：${leaked.join(', ')}`);
  // 反向：v365-contracts 必须声明全部 5 个
  const v365Vals = Object.values(V365_COLLECTIONS);
  V365_NAMES.forEach((n) => assert.ok(v365Vals.includes(n), `${n} 必须在 V365_COLLECTIONS 中`));
  ok('E-04 集合名唯一来源 = v365-contracts.js', `V365_COLLECTIONS=${v365Vals.length}`);
}

/* ================= E-05 POC_COLLECTIONS 别名 == V365_COLLECTIONS ================= */
{
  assert.strictEqual(AP.POC_COLLECTIONS.RUN_MANIFEST, V365_COLLECTIONS.RUN_MANIFEST);
  assert.strictEqual(AP.POC_COLLECTIONS.RUN_CANDIDATE_DECISION, V365_COLLECTIONS.CANDIDATE_DECISION);
  assert.strictEqual(AP.POC_COLLECTIONS.RUN_CANDIDATE_PORTFOLIO, V365_COLLECTIONS.CANDIDATE_PORTFOLIO);
  assert.strictEqual(AP.POC_COLLECTIONS.ACTIVE_RUN_POINTER, V365_COLLECTIONS.ACTIVE_POINTER);
  ok('E-05 POC_COLLECTIONS 别名 == V365_COLLECTIONS');
}

/* ================= E-06 双源不得重叠 ================= */
{
  const all = [...Object.values(COLLECTIONS).filter((v) => typeof v === 'string'), ...Object.values(V365_COLLECTIONS)];
  const dupes = all.filter((n, i) => all.indexOf(n) !== i);
  assert.deepStrictEqual([...new Set(dupes)], [], `集合名重复声明：${[...new Set(dupes)].join(', ')}`);
  ok('E-06 双源无重叠（防漂移）', `合计 ${all.length} 个唯一名`);
}

/* ================= E-07 run_history 符合 OD-1 A′（严格 append-only）================= */
{
  const s = getSchema('run_history');
  assert.ok(s, 'run_history 必须登记');
  assert.ok(s.fields.supersedes_run_id, 'run_history 必须有**前向** supersedes_run_id');
  assert.ok(!s.fields.superseded_by_run_id,
    '⛔ run_history 不得有 superseded_by_run_id（反向字段需更新既有行 ⇒ 破坏严格 append-only）');
  assert.ok(s.fields.promoted_at, 'run_history 必须有 promoted_at（提升**事件**时刻）');
  assert.ok(!s.fields.is_active, '⛔ 不得有 is_active 布尔（"当前是否 active"只能由 pointer 回答）');
  ok('E-07 run_history 符合 OD-1 A′', '前向 supersedes / 无反向 / 无 is_active');
}

/* ================= E-08 run_history 索引齐备 ================= */
{
  const s = getSchema('run_history');
  const idx = (s.indexes || []).map((i) => i.name).sort();
  assert.deepStrictEqual(idx, ['idx_supersedes', 'idx_trade_date', 'uk_run_id']);
  const uk = s.indexes.find((i) => i.name === 'uk_run_id');
  assert.strictEqual(uk.unique, true);
  assert.strictEqual(uk.keys[0].field, 'run_id');
  ok('E-08 run_history 索引齐备', JSON.stringify(idx));
}

/* ================= E-09 active_run_pointer：1 行 / scope ================= */
{
  const s = getSchema('active_run_pointer');
  assert.ok(s.fields.scope && s.fields.scope.required === true, 'scope 必须 required');
  assert.ok(s.fields.run_id && s.fields.run_id.required === true, 'run_id 必须 required');
  assert.ok(s.fields.revision && s.fields.revision.required === true, 'revision 必须 required（CAS 比较依据）');
  const uk = (s.indexes || []).find((i) => i.unique === true);
  assert.ok(uk && uk.keys.length === 1 && uk.keys[0].field === 'scope',
    'active_run_pointer 必须有 scope 唯一索引（1 行/scope）');
  ok('E-09 active_run_pointer 唯一 scope 索引');
}

/* ================= E-10 candidate 集合 (run_id, candidate_key) 唯一 ================= */
{
  for (const n of ['run_candidate_decision', 'run_candidate_portfolio']) {
    const s = getSchema(n);
    const uk = (s.indexes || []).find((i) => i.unique === true);
    assert.ok(uk, `${n} 必须有唯一索引`);
    assert.deepStrictEqual(uk.keys.map((k) => k.field), ['run_id', 'candidate_key'],
      `${n} 唯一索引必须是 (run_id, candidate_key)`);
  }
  ok('E-10 candidate 集合唯一键 = (run_id, candidate_key)');
}

/* ================= E-11 全部 5 个集合均有唯一索引 ================= */
{
  for (const n of V365_NAMES) {
    const s = getSchema(n);
    assert.ok((s.indexes || []).some((i) => i.unique === true), `${n} 必须有唯一索引`);
  }
  ok('E-11 5 个集合均有唯一索引');
}

/* ================= E-12 v365-atomic-publish 内无硬编码集合名字面量 ================= */
{
  // ⚠️ 必须**先剥离注释**再扫字面量（否则解释性注释里的集合名会误命中）
  const { canonicalCodeFingerprint } = require(path.join(REPO, 'scripts', 'lib', 'v365-orchestration-approval.js'));
  const src = fs.readFileSync(path.join(REPO, 'src/common/utils/v365-atomic-publish.js'), 'utf8');
  const code = canonicalCodeFingerprint(src);
  const leaked = V365_NAMES.filter((n) => code.includes(`'${n}'`) || code.includes(`"${n}"`));
  assert.deepStrictEqual(leaked, [],
    `v365-atomic-publish.js 不得硬编码集合名（应经 v365-contracts.js）：${leaked.join(', ')}`);
  ok('E-12 v365-atomic-publish 无硬编码集合名');
}

console.log('\nWP-RH1 Contract Registry 专项测试：E-01 ~ E-12 全部 PASS');
