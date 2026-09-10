'use strict';

/**
 * WP-G1.3 G1.3-10：constants ↔ SCHEMAS 集合一致性守卫（上线前置）。
 *
 * 背景：`gen1_health_state`（G1.1-03 新增）等集合只登记在 constants.js，未进入 SCHEMAS →
 * `scripts/init-collections.js` 不会创建它们，「线上是否存在」全靠人工保证。
 * 对 gen1_health_state 而言这是上线风险：集合缺失会被健康读取判为 READ_ERROR → ML_OFF →
 * Canary 关闭（fail-closed 正确，但会被误判为接线 bug）。
 *
 * 本测试守卫：COLLECTIONS 里的每个集合都必须在 SCHEMAS 有定义，且反向不留孤儿。
 */
const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..');
const { SCHEMAS, getSchema, getCollectionNames } = require(path.join(REPO, 'src/common/schema.js'));
const { COLLECTIONS } = require(path.join(REPO, 'src/common/constants.js'));

const declared = Object.entries(COLLECTIONS)
  .filter(([, v]) => typeof v === 'string')
  .map(([k, v]) => ({ key: k, name: v }));
const schemaNames = new Set(SCHEMAS.map((s) => s.name));

/* ---- 1) ★ constants 声明了但 SCHEMAS 未登记 → FAIL（本类 bug 的根因） ---- */
{
  const missing = declared.filter((d) => !schemaNames.has(d.name));
  assert.deepStrictEqual(missing.map((m) => `${m.key}=${m.name}`), [],
    `★ 以下集合在 constants.js 已声明但 SCHEMAS 未登记（init-collections 不会创建它们）：\n  `
    + missing.map((m) => `${m.key}=${m.name}`).join('\n  '));
}

/* ---- 2) SCHEMAS 里不得有 constants 未声明的孤儿集合 ---- */
{
  const declaredNames = new Set(declared.map((d) => d.name));
  const orphans = [...schemaNames].filter((n) => !declaredNames.has(n));
  assert.deepStrictEqual(orphans, [],
    `SCHEMAS 存在 constants 未声明的集合：${orphans.join(', ')}`);
}

/* ---- 3) 上线关键集合必须存在且有唯一键索引 ---- */
{
  const mustHave = [
    { name: 'gen1_health_state', keyField: 'key' },
    { name: 'runtime_status', keyField: 'key' }
  ];
  for (const m of mustHave) {
    const s = getSchema(m.name);
    assert.ok(s, `★ 上线关键集合 ${m.name} 必须在 SCHEMAS 中定义`);
    assert.ok(s.fields && s.fields[m.keyField] && s.fields[m.keyField].required === true,
      `${m.name}.${m.keyField} 必须声明为 required`);
    const uniq = (s.indexes || []).find((i) => i.unique === true);
    assert.ok(uniq, `${m.name} 必须有唯一索引`);
    assert.ok(uniq.keys.some((k) => k.field === m.keyField),
      `${m.name} 唯一索引必须包含 ${m.keyField}`);
  }
  // gen1_health_state 的 latch 字段必须登记（决定权限的字段不能游离于 schema 之外）
  const hs = getSchema('gen1_health_state');
  for (const f of ['latched_health', 'manual_review_required', 'economic_health', 'updated_at']) {
    assert.ok(hs.fields[f], `gen1_health_state.${f} 必须登记`);
  }
}

/* ---- 4) 每个 schema 至少要能通过 validateDoc 的空文档必填校验（结构完整性） ---- */
{
  const { validateDoc } = require(path.join(REPO, 'src/common/schema.js'));
  for (const s of SCHEMAS) {
    assert.ok(Array.isArray(s.fields) === false, `${s.name}: fields 必须是对象不是数组`);
    assert.strictEqual(typeof s.fields, 'object', `${s.name} 必须有 fields`);
    const v = validateDoc(s.name, {});
    assert.strictEqual(typeof v.ok, 'boolean', `${s.name}: validateDoc 必须返回 {ok}`);
    assert.ok(Array.isArray(v.errors));
  }
}

/* ---- 5) getCollectionNames 与 SCHEMAS 一致（init-collections 依赖它） ---- */
{
  assert.deepStrictEqual(getCollectionNames(), SCHEMAS.map((s) => s.name));
  assert.ok(getCollectionNames().indexOf('gen1_health_state') >= 0,
    '★ gen1_health_state 必须包含在 init-collections 的建集合清单里');
}

console.log(`schema/collections parity passed（${schemaNames.size} 集合，含 gen1_health_state）`);
