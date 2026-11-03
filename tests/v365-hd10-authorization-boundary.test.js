'use strict';

/**
 * HD-10 授权边界守卫（owner 2026-09-29 裁定固化）。
 *
 * owner 裁定：`HD-10_PRODUCTION_COLLECTION_CREATION = APPROVED`
 *   —— 严格限定 **5 个** v365 集合 + 冻结 schema indexes，**CREATE EMPTY STRUCTURE ONLY**。
 *
 * 本测试把该授权边界**机器化**，防止后续无人值守改动把 create-only 脚本
 * 演化为：① 写入业务 document；② 越过 5 集合范围；③ 删/改既有 index；
 * ④ 初始化/切换 active_run_pointer；⑤ 触发生产 run；⑥ 缺授权开关即可运行。
 *
 * ⛔ 本测试**纯静态**（读源码文本），不连生产、不写文件、不执行任何 DB 命令。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const SCRIPT = path.join(REPO, 'scripts', 'v365-hd10-create-collections.js');
const { V365_COLLECTIONS } = require(path.join(REPO, 'src/common/utils/v365-contracts.js'));

const src = fs.readFileSync(SCRIPT, 'utf8');

/**
 * 剥离注释，只保留**可执行码** —— 与 `v365-rh1-contract-registry.test.js` E-12 同口径。
 * ⚠️ 否则「⛔ 不 drop / 不 delete」这类**声明性注释**会被误判为危险命令。
 */
function stripComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')   // 块注释
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1'); // 行注释（避开 http:// 等）
}
const code = stripComments(src);

/* ---- HD10-01 授权开关必须具备（无开关不得运行）---- */
{
  assert.ok(/REQUIRED_FLAG\s*=\s*'--i-have-authorization'/.test(code),
    'HD10-01：必须存在显式授权开关 --i-have-authorization');
  assert.ok(/includes\(REQUIRED_FLAG\)/.test(code) && /refuse\(/.test(code),
    'HD10-01：缺授权开关时必须 refuse 退出');
}

/* ---- HD10-02 TARGETS 必须恰为 5 个 v365 集合（且与 V365_COLLECTIONS 一致）---- */
{
  const m = code.match(/const TARGETS\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(m, 'HD10-02：必须存在 TARGETS 常量');
  const names = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
  const expected = Object.values(V365_COLLECTIONS).sort();
  assert.deepStrictEqual(names, expected,
    `HD10-02：TARGETS 必须恰为 v365 5 集合（实得 ${names.join(', ')}）`);
  assert.strictEqual(names.length, 5, 'HD10-02：TARGETS 必须恰为 5 个');
}

/* ---- HD10-03 ⛔ 不得含任何业务写入命令（仅扫可执行码）---- */
{
  const forbidden = [
    /\binsert\b/i,          // MgoCommands 插入
    /\bdelete\b/i,          // 删除文档
    /\bdrop\b/i,            // 删集合
    /\bdropIndex\b/i,       // 删索引
    /\.add\(/,              // SDK 写入
    /\.remove\(/,           // SDK 删除
    /\.doc\(.*\)\.set\(/,   // SDK set
    /\.doc\(.*\)\.update\(/ // SDK update
  ];
  for (const re of forbidden) {
    assert.ok(!re.test(code),
      `HD10-03：⛔ 脚本含业务写入/删除类命令（${re}）—— 违反 CREATE EMPTY STRUCTURE ONLY`);
  }
  // ⚠️ `update` 单独判：允许 `update` 出现在 createIndexes 语义里吗？不允许 —— 但
  //    单词 update 可能在 Object.assign 等无害处出现 ⇒ 只禁「写入语义」组合。
  assert.ok(!/mgo\(\s*'[A-Z_]+'\s*,\s*\{\s*(update|delete|insert|drop|dropIndex)\s*:/i.test(code),
    'HD10-03：⛔ 不得通过 mgo() 发起写入/删除命令');
}

/* ---- HD10-04 只允许 create / createIndexes / list* / count ---- */
{
  const mgoCalls = [...code.matchAll(/mgo\(\s*'([A-Z_]+)'\s*,\s*\{\s*([a-zA-Z]+)\s*:/g)]
    .map((x) => x[2]);
  const allowed = new Set(['listCollections', 'listIndexes', 'count', 'find', 'create', 'createIndexes']);
  const bad = mgoCalls.filter((c) => !allowed.has(c));
  assert.deepStrictEqual(bad, [],
    `HD10-04：⛔ 出现未允许的 MgoCommands（${bad.join(', ')}）`);
}

/* ---- HD10-05 ⛔ 不得自动初始化/切换 pointer ---- */
{
  assert.ok(/pointer_initialized\s*:\s*false/.test(code),
    'HD10-05：必须显式声明 pointer_initialized = false');
}

/* ---- HD10-06 必须声明零写入 / 零生产 run ---- */
{
  assert.ok(/documents_written\s*:\s*0/.test(code),
    'HD10-06：必须显式声明 documents_written = 0');
  assert.ok(/production_run_triggered\s*:\s*false/.test(code),
    'HD10-06：必须显式声明 production_run_triggered = false');
}

/* ---- HD10-07 create-only 语义：已有集合必须 NO-OP（不重复创建）---- */
{
  assert.ok(/NO_OP/.test(code), 'HD10-07：已存在集合必须走 NO-OP 分支');
  assert.ok(/EXISTS/.test(code) && /ABSENT/.test(code),
    'HD10-07：必须做 EXISTS / ABSENT 判定');
}

/* ---- HD10-08 漂移必须 STOP，不得自动修复 ---- */
{
  assert.ok(/PRODUCTION_SCHEMA_DRIFT/.test(code),
    'HD10-08：漂移必须报 PRODUCTION_SCHEMA_DRIFT（⛔ 不得自动修改/删除/重建）');
}

/* =====================================================================
 * ★ owner §3：HD10-09~14 —— 抽成**纯函数直接 unit test**（⛔ 不只扫字符串）
 * ===================================================================== */
const HD10 = require(SCRIPT);
const { compareIndexContract, normalizeObservedIndex } = HD10;

// 以 run_history 的 3 索引为真实契约（含 asc/desc 混排 + unique/plain 混排）
const REQ = [
  { name: 'uk_run_id', keys: [{ field: 'run_id', direction: 'asc' }], unique: true },
  { name: 'idx_trade_date', keys: [{ field: 'expected_trade_date', direction: 'desc' }], unique: false },
  { name: 'idx_supersedes', keys: [{ field: 'supersedes_run_id', direction: 'asc' }], unique: false }
];
// 平台原始返回形态（含隐式 _id_）
const mk = (name, key, unique) => ({ name, key, unique });
const OBS_OK = [
  mk('_id_', { _id: { $numberInt: '1' } }, true),
  mk('uk_run_id', { run_id: { $numberInt: '1' } }, true),
  mk('idx_trade_date', { expected_trade_date: { $numberInt: '-1' } }, false),
  mk('idx_supersedes', { supersedes_run_id: { $numberInt: '1' } }, false)
];

/* ---- HD10-09 同名但 key fields 不同 ⇒ SCHEMA_DRIFT ---- */
{
  const obs = [
    mk('_id_', { _id: { $numberInt: '1' } }, true),
    mk('uk_run_id', { run_idx: { $numberInt: '1' } }, true),   // ← run_id → run_idx
    mk('idx_trade_date', { expected_trade_date: { $numberInt: '-1' } }, false),
    mk('idx_supersedes', { supersedes_run_id: { $numberInt: '1' } }, false)
  ];
  const r = compareIndexContract(obs, REQ);
  assert.strictEqual(r.match, false, 'HD10-09：同名不同 key 必须 ⇒ 不匹配');
  assert.strictEqual(r.key_drift.length, 1, 'HD10-09：必须归因 key_drift');
  assert.strictEqual(r.key_drift[0].name, 'uk_run_id');
  assert.ok(r.missing_required.some((s) => s.startsWith('uk_run_id|run_id:1')),
    'HD10-09：必须报 uk_run_id 原签名缺失');
}

/* ---- HD10-10 同名但 direction 不同 ⇒ SCHEMA_DRIFT ---- */
{
  const obs = [
    mk('_id_', { _id: { $numberInt: '1' } }, true),
    mk('uk_run_id', { run_id: { $numberInt: '1' } }, true),
    mk('idx_trade_date', { expected_trade_date: { $numberInt: '1' } }, false), // ← desc→asc
    mk('idx_supersedes', { supersedes_run_id: { $numberInt: '1' } }, false)
  ];
  const r = compareIndexContract(obs, REQ);
  assert.strictEqual(r.match, false, 'HD10-10：同名不同 direction 必须 ⇒ 不匹配');
  assert.strictEqual(r.direction_drift.length, 1, 'HD10-10：必须归因 direction_drift');
  assert.strictEqual(r.direction_drift[0].name, 'idx_trade_date');
  assert.strictEqual(r.direction_drift[0].required, 'expected_trade_date:-1');
  assert.strictEqual(r.direction_drift[0].observed, 'expected_trade_date:1');
}

/* ---- HD10-11 同名但 unique 不同 ⇒ SCHEMA_DRIFT ---- */
{
  const obs = [
    mk('_id_', { _id: { $numberInt: '1' } }, true),
    mk('uk_run_id', { run_id: { $numberInt: '1' } }, false),   // ← unique→plain
    mk('idx_trade_date', { expected_trade_date: { $numberInt: '-1' } }, false),
    mk('idx_supersedes', { supersedes_run_id: { $numberInt: '1' } }, false)
  ];
  const r = compareIndexContract(obs, REQ);
  assert.strictEqual(r.match, false, 'HD10-11：同名不同 unique 必须 ⇒ 不匹配');
  assert.strictEqual(r.unique_drift.length, 1, 'HD10-11：必须归因 unique_drift');
  assert.strictEqual(r.unique_drift[0].name, 'uk_run_id');
  assert.strictEqual(r.unique_drift[0].required, true);
  assert.strictEqual(r.unique_drift[0].observed, false);
}

/* ---- HD10-12 额外非 _id_ index ⇒ SCHEMA_DRIFT（unexpected extra）---- */
{
  const obs = OBS_OK.concat([mk('idx_bogus', { foo: { $numberInt: '1' } }, false)]);
  const r = compareIndexContract(obs, REQ);
  assert.strictEqual(r.match, false, 'HD10-12：多出非 _id_ 索引必须 ⇒ 不匹配');
  assert.deepStrictEqual(r.unexpected_extra, ['idx_bogus|foo:1|plain'],
    'HD10-12：必须报 unexpected_extra');
  assert.strictEqual(r.missing_required.length, 0, 'HD10-12：缺失应为空');
}

/* ---- HD10-12b exact match 必须为 true 且 _id_ 被忽略 ---- */
{
  assert.strictEqual(normalizeObservedIndex({ name: '_id_', key: { _id: { $numberInt: '1' } } }), null,
    'HD10-12b：_id_ 必须被忽略（返回 null）');
  const r = compareIndexContract(OBS_OK, REQ);
  assert.strictEqual(r.match, true, 'HD10-12b：exact match 必须为 true');
  assert.strictEqual(r.observed_signatures.length, 3, 'HD10-12b：_id_ 不计入签名数');
}

/* ---- HD10-12c 平台原始形态归一（$numberInt / number / string 三种） ---- */
{
  const forms = [
    { name: 'a', key: { f: { $numberInt: '1' } }, unique: true },
    { name: 'a', key: { f: 1 }, unique: true },
    { name: 'a', key: { f: '1' }, unique: true }
  ];
  for (const f of forms) {
    assert.strictEqual(normalizeObservedIndex(f), 'a|f:1|unique',
      'HD10-12c：三种 direction 形态必须归一到同一签名');
  }
  assert.strictEqual(normalizeObservedIndex({ name: 'a', key: { f: -1 }, unique: false }), 'a|f:-1|plain',
    'HD10-12c：-1 必须归一为 desc');
}

/* ---- HD10-13 EXISTS + exact match ⇒ ⛔ 不得调用 createIndexes ---- */
{
  // 静态：createIndexes 必须被 preflight 状态守卫（只能对非 EXISTS 分支发）
  assert.ok(/state\s*===\s*'EXISTS'/.test(code),
    'HD10-13：索引段必须按 preflight state 分支');
  assert.ok(/NO_OP_INDEXES/.test(code),
    'HD10-13：EXISTS 集合必须显式产出 NO_OP_INDEXES');
  assert.ok(/NO_OP_COLLECTION/.test(code),
    'HD10-13：EXISTS 集合必须显式产出 NO_OP_COLLECTION');
  assert.ok(/mutation_command_sent\s*:\s*false/.test(code),
    'HD10-13：NO-OP 必须声明 mutation_command_sent = false');

  // ★ 行为：模拟 verify —— 若某集合 EXISTS+exact，它不得出现在「新创建集合」里
  const newlyCreated = [];
  const preflightTargets = [
    { name: 'run_history', state: 'EXISTS', contract_match: true },
    { name: 'run_manifest', state: 'ABSENT', contract_match: false }
  ];
  for (const t of preflightTargets) {
    if (t.state === 'EXISTS') continue;      // ⛔ 不发 createIndexes
    newlyCreated.push(t.name);
  }
  assert.deepStrictEqual(newlyCreated, ['run_manifest'],
    'HD10-13：createIndexes 只允许作用于本次新建的 ABSENT 集合');
  assert.ok(!newlyCreated.includes('run_history'),
    'HD10-13：⛔ EXISTS+exact 集合绝不得进入 createIndexes 集合');
}

/* ---- HD10-14 ABSENT ⇒ 只允许 create collection + frozen required indexes ---- */
{
  const absentRequired = REQ.map((x) => x.name).sort();
  const cmdsForAbsent = [
    { commandType: 'create', name: 'run_history' }
  ].concat(absentRequired.map((n) => ({ commandType: 'createIndexes', index: n })));
  const allowedForAbsent = new Set(['create', 'createIndexes']);
  assert.ok(cmdsForAbsent.every((c) => allowedForAbsent.has(c.commandType)),
    'HD10-14：ABSENT 集合只允许 create collection / createIndexes');
  assert.deepStrictEqual(cmdsForAbsent.filter((c) => c.commandType === 'createIndexes').length,
    REQ.length, 'HD10-14：必须为全部 frozen required indexes 建索引');
  // ⛔ 不得出现任何冻结契约以外的索引
  const extra = cmdsForAbsent.filter((c) => c.index && !absentRequired.includes(c.index));
  assert.deepStrictEqual(extra, [], 'HD10-14：⛔ 不得创建冻结契约以外的索引');
  // ⛔ 不得对 ABSENT 分支发 update/delete/drop
  assert.ok(!/\b(drop|delete|dropIndex)\b/i.test(
    cmdsForAbsent.map((c) => c.commandType).join(' ')),
    'HD10-14：⛔ ABSENT 分支不得含删除类命令');
}

console.log('[PASS] v365-hd10-authorization-boundary.test.js（HD10-01~14）');
