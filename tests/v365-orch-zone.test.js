#!/usr/bin/env node
/**
 * HD12-3 —— orchestration zone 保护专项测试（D-01 ~ D-10）
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const A = require(path.join(REPO, 'scripts', 'lib', 'v365-orchestration-approval.js'));
const RDE = 'cloudfunctions/runDecisionEngine/index.js';
const RDE_ABS = path.join(REPO, RDE);
const ok = (n, d) => console.log(`[PASS] ${n}${d ? ' — ' + d : ''}`);

/* ================= D-01 解析多区段 ================= */
{
  const src = [
    'const a = 1;',
    '// >>> v365-orch-zone: alpha',
    'const b = 2;',
    '// <<< v365-orch-zone: alpha',
    'const c = 3;',
    '// >>> v365-orch-zone: alpha',
    'const d = 4;',
    '// <<< v365-orch-zone: alpha',
    '// >>> v365-orch-zone: beta',
    'const e = 5;',
    '// <<< v365-orch-zone: beta'
  ].join('\n');
  const z = A.parseOrchZones(src);
  assert.deepStrictEqual(z.names, ['alpha', 'beta']);
  assert.deepStrictEqual(z.zones.alpha, [{ start: 2, end: 4 }, { start: 6, end: 8 }]);
  assert.deepStrictEqual(z.zones.beta, [{ start: 9, end: 11 }]);
  assert.deepStrictEqual(z.malformed, []);
  ok('D-01 解析多区段', `alpha×${z.zones.alpha.length} · beta×${z.zones.beta.length}`);
}

/* ================= D-02 检出未闭合 / 无对应开启 ================= */
{
  const unclosed = A.parseOrchZones(['// >>> v365-orch-zone: x', 'const a = 1;'].join('\n'));
  assert.strictEqual(unclosed.malformed.length, 1);
  assert.ok(/未闭合/.test(unclosed.malformed[0]));
  const orphan = A.parseOrchZones(['// <<< v365-orch-zone: y', 'const a = 1;'].join('\n'));
  assert.strictEqual(orphan.malformed.length, 1);
  assert.ok(/无对应开启/.test(orphan.malformed[0]));
  ok('D-02 检出未闭合/孤立闭合标记');
}

/* ================= D-03 区间抗行号漂移 ================= */
{
  const base = ['const a = 1;', '// >>> v365-orch-zone: z', 'const b = 2;', '// <<< v365-orch-zone: z'];
  const shifted = ['// 新增一行注释', 'const a = 1;', 'const a2 = 1;', '// >>> v365-orch-zone: z', 'const b = 2;', '// <<< v365-orch-zone: z'];
  const z1 = A.parseOrchZones(base.join('\n')).zones.z[0];
  const z2 = A.parseOrchZones(shifted.join('\n')).zones.z[0];
  assert.deepStrictEqual(z1, { start: 2, end: 4 });
  assert.deepStrictEqual(z2, { start: 4, end: 6 });
  // 区间**宽度**不变，且随内容漂移
  assert.strictEqual(z2.end - z2.start, z1.end - z1.start);
  ok('D-03 区间抗行号漂移', `${JSON.stringify(z1)} → ${JSON.stringify(z2)}`);
}

/* ================= D-04 区域落在 zone 内 ⇒ CONTAINED ================= */
{
  const zones = { 'f.js': { a: [{ start: 10, end: 20 }] } };
  const r = A.validateRegionContainment([{ file: 'f.js', start: 12, end: 15 }], zones, ['a']);
  assert.strictEqual(r.ok, true); assert.strictEqual(r.code, 'REGIONS_CONTAINED');
  ok('D-04 区域落在 zone 内 ⇒ REGIONS_CONTAINED');
}

/* ================= D-05 区域在 zone 外 ⇒ FAIL ================= */
{
  const zones = { 'f.js': { a: [{ start: 10, end: 20 }] } };
  const r = A.validateRegionContainment([{ file: 'f.js', start: 21, end: 25 }], zones, ['a']);
  assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'REGION_OUTSIDE_DECLARED_ZONE');
  // 跨界（start 在内、end 在外）也必须 FAIL
  const r2 = A.validateRegionContainment([{ file: 'f.js', start: 18, end: 25 }], zones, ['a']);
  assert.strictEqual(r2.ok, false);
  ok('D-05 区域在 zone 外/跨界 ⇒ FAIL');
}

/* ================= D-06 声明不存在的 zone ⇒ FAIL ================= */
{
  const zones = { 'f.js': { a: [{ start: 10, end: 20 }] } };
  const r = A.validateRegionContainment([{ file: 'f.js', start: 12, end: 15 }], zones, ['nope']);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => /不存在该 zone/.test(e)));
  ok('D-06 声明不存在的 zone ⇒ FAIL');
}

/* ================= D-07 声明 zone 但无区域 ⇒ FAIL ================= */
{
  const manifest = {
    approval_schema_version: A.APPROVAL_SCHEMA_VERSION, authorized_by: 't',
    authorization_sha: 'c6bd006fd76ffc5358cddd07347df8ed23d9e61d',
    authorized_at: 'x', changed_files: [RDE], orchestration_scope: ['s'],
    zone_declaration: ['telemetry']
  };
  const r = A.validate(manifest, {
    changed: [RDE], headSha: manifest.authorization_sha, changedRegions: [],
    zonesByFile: { [RDE]: { telemetry: [{ start: 1, end: 2 }] } },
    classification: require(path.join(REPO, 'scripts', 'lib', 'v365-decision-classification.js'))
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'ZONE_DECLARATION_WITHOUT_REGIONS');
  ok('D-07 声明 zone 但无 --changed-region ⇒ FAIL');
}

/* ================= D-08 真实 RDE：zone 解析正确且无 malformed ================= */
{
  const z = A.parseOrchZones(fs.readFileSync(RDE_ABS, 'utf8'));
  assert.deepStrictEqual(z.malformed, [], 'RDE 的 zone 标记不得有 malformed');
  assert.ok(z.names.includes('lifecycle_writer'), 'RDE 必须含 lifecycle_writer zone');
  assert.ok(z.names.includes('telemetry'), 'RDE 必须含 telemetry zone');
  assert.ok(z.zones.lifecycle_writer.length >= 2, 'lifecycle_writer 应有多区段');
  assert.ok(z.zones.telemetry.length >= 2, 'telemetry 应有多区段');
  ok('D-08 真实 RDE zone 解析', `names=${JSON.stringify(z.names)} · 区段数=${z.zones.lifecycle_writer.length}+${z.zones.telemetry.length}`);
}

/* ================= D-09 真实 RDE：改动必须是 comment-only **或** zone-contained ================= */
{
  // ⚠️ 语义精化：HD12-3 的标记安装是 comment-only；但**后续合法改动**（如 WP-RH2 R2-b
  //    的运行时字段修正）是**真实代码改动** ⇒ 只要全部落在**声明的 zone** 内即可。
  //    ⇒ 判据 = 「comment-only」**或**「zone 包含性成立」。
  const r = spawnSync('git', ['show', `HEAD:${RDE}`], { cwd: REPO, encoding: 'utf8', maxBuffer: 1e8 });
  assert.ok(!r.error && r.status === 0, 'git show 必须可用');
  const before = String(r.stdout);
  const after = fs.readFileSync(RDE_ABS, 'utf8');
  const commentOnly = A.canonicalCodeSha256(after) === A.canonicalCodeSha256(before);

  if (commentOnly) {
    ok('D-09 真实 RDE：改动为 comment-only', A.canonicalCodeSha256(after).slice(0, 16) + '…');
  } else {
    const d = spawnSync('git', ['diff', '-U0', '--no-color', 'HEAD', '--', RDE],
      { cwd: REPO, encoding: 'utf8', maxBuffer: 1e8 });
    assert.ok(!d.error && d.status === 0, 'git diff 必须可用');
    const regions = [];
    String(d.stdout).split(/\r?\n/).forEach((ln) => {
      const m = ln.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
      if (!m) return;
      const start = Number(m[1]);
      const count = m[2] == null ? 1 : Number(m[2]);
      if (count > 0) regions.push({ file: RDE, start, end: start + count - 1 });
    });
    assert.ok(regions.length > 0, '非 comment-only ⇒ 必须能解析出改动区域');
    const z = A.parseOrchZones(after);
    assert.deepStrictEqual(z.malformed, [], 'zone 标记不得 malformed');
    const cont = A.validateRegionContainment(regions, { [RDE]: z.zones }, z.names);
    assert.strictEqual(cont.ok, true,
      `非 comment-only 改动必须**全部**落在 zone 内：${JSON.stringify(cont.errors)}`);
    ok('D-09 真实 RDE：非 comment-only ⇒ zone-contained',
      `${regions.length} 区域 ⊆ ${JSON.stringify(z.names)}`);
  }
}

/* ================= D-10 反向对照：真代码改动必须被检出 ================= */
{
  const src = fs.readFileSync(RDE_ABS, 'utf8');
  const mutated = src.replace('const results = [];', 'const results = []; const __z = 1;');
  assert.notStrictEqual(A.canonicalCodeSha256(mutated), A.canonicalCodeSha256(src),
    '注入一行真代码必须改变规范化代码指纹（证明证明机制非空泛）');
  // marker 行本身不得影响代码指纹
  const withExtraMarker = src.replace(
    '// >>> v365-orch-zone: telemetry',
    '// >>> v365-orch-zone: telemetry\n    // 额外注释行'
  );
  assert.strictEqual(A.canonicalCodeSha256(withExtraMarker), A.canonicalCodeSha256(src),
    '追加纯注释行不得改变规范化代码指纹');
  ok('D-10 反向对照：真代码被检出 / 纯注释不影响指纹');
}

console.log('\nHD12-3 zone 保护专项测试：D-01 ~ D-10 全部 PASS');
