'use strict';

/**
 * B0 测试：V3.6.5 自己的身份 / 合格面 / manifest 校验器（任务书 §2、§18）。
 *
 * 重点：证明「声明 → 实读 → 实算 hash → 逐一比对」这条链**真的会 FAIL**，
 * 而不是像 V364 lock 那样"声明了 hash 但无人消费"。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const { verify, collectSurfaceFiles, MANIFEST } = require(path.join(REPO, 'scripts', 'verify-v365-candidate-manifest.js'));
const gen = require(path.join(REPO, 'scripts', 'gen-v365-candidate-manifest.js'));
const CONTRACTS = require(path.join(REPO, 'src', 'common', 'utils', 'v365-contracts.js'));

const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: String(e.message || e) }); }
}

test('A.1 manifest 存在且 schema 合法', () => {
  assert.ok(fs.existsSync(MANIFEST), 'manifest 不存在');
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  ['engine_version', 'parent_production_version', 'source', 'contracts',
    'qualified_files', 'file_sha256', 'candidate_content_sha', 'qualification_status'].forEach((k) => {
    assert.notStrictEqual(m[k], undefined, '缺字段 ' + k);
  });
});

test('A.2 engine_version / parent 正确，且**不冒充** V364', () => {
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  assert.strictEqual(m.engine_version, 'v3.6.5');
  assert.strictEqual(m.parent_production_version, 'v3.6.4');
  assert.strictEqual(m.release_kind, 'PRODUCTION_INTEGRITY');
  assert.strictEqual(m.frozen_predecessor_locks_rewritten_by_v365, false,
    'V365 不得回写 V364/V361 lock');
});

test('A.3 契约版本齐备（input/calendar/pipeline/run_context/run_finality/publish）', () => {
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const c = m.contracts;
  assert.strictEqual(c.input_contract_version, 'live-31-v1');
  assert.strictEqual(c.input_contract_field_count, 31, '必须按真实生产 31-field contract');
  assert.deepStrictEqual(c.input_contract_excluded_fields, ['breakout_nd'],
    '⛔ 不恢复 breakout_nd');
  assert.ok(c.calendar_version && c.calendar_artifact_sha256);
  assert.ok(c.pipeline_contract_version && c.run_context_version
    && c.run_finality_version && c.publish_protocol_version);
});

test('A.4 calendar artifact sha 与 calendar manifest 自洽', () => {
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const cm = JSON.parse(fs.readFileSync(path.join(REPO, 'src/common/data/cn-trading-calendar.v1.manifest.json'), 'utf8'));
  assert.strictEqual(m.contracts.calendar_artifact_sha256, cm.artifact_sha256);
  assert.strictEqual(cm.seeded, true);
  assert.strictEqual(cm.synthetic, false);
});

test('A.5 生成器确定性（--check 语义：重算 == 磁盘）', () => {
  const diffs = gen.checkDeterminism();
  assert.deepStrictEqual(diffs, [], '确定性复核不得有差异: ' + JSON.stringify(diffs.slice(0, 5)));
});

test('A.6 校验器 PASS，且逐文件核对数量 == 声明数量', () => {
  const r = verify();
  assert.strictEqual(r.ok, true, '校验失败: ' + JSON.stringify(r.errors));
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  assert.strictEqual(r.checked, m.qualified_files.length);
  assert.ok(r.checked >= 18, '合格文件数异常偏小');
});

test('A.7 candidate_content_sha 与重算一致', () => {
  const r = verify();
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  assert.ok(r.candidate_content_sha);
  assert.notStrictEqual(m.candidate_content_sha, undefined);
});

test('A.8 ★ 反向证明：篡改任一合格文件的内容必须触发 HASH_MISMATCH', () => {
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const target = m.qualified_files.find((f) => f.endsWith('.js'));
  const abs = path.join(REPO, target);
  const backup = fs.readFileSync(abs);
  try {
    fs.writeFileSync(abs, Buffer.concat([backup, Buffer.from('\n// v365-test-tamper\n')]));
    const r = verify();
    assert.strictEqual(r.ok, false, '内容被改后校验器必须 FAIL（否则就是"声明了却无人消费"）');
    const codes = r.errors.map((e) => e.code);
    assert.ok(codes.includes('HASH_MISMATCH'), '应报 HASH_MISMATCH，实得 ' + JSON.stringify(codes));
    assert.ok(codes.includes('CANDIDATE_CONTENT_SHA_MISMATCH'), '应同时报内容 sha 失配');
  } finally {
    fs.writeFileSync(abs, backup);   // 必须逐字节还原
  }
  const after = verify();
  assert.strictEqual(after.ok, true, '还原后应恢复 PASS');
});

test('A.9 ★ 反向证明：合格面文件未被声明 ⇒ UNEXPECTED_QUALIFIED_FILE_CHANGE', () => {
  const surface = collectSurfaceFiles();
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const undeclared = surface.filter((f) => !m.qualified_files.includes(f));
  assert.deepStrictEqual(undeclared, [],
    '存在属于 V365 合格面但未被 manifest 声明的文件: ' + JSON.stringify(undeclared));
});

test('A.10 CAS 证据状态未被高估（平台并发实证未取得时必须为 false）', () => {
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  assert.strictEqual(m.cas_evidence.api_present, true, 'API 存在（SDK 2.11.0）应为 true');
  assert.strictEqual(m.cas_evidence.platform_concurrency_tested, false,
    '平台并发未实测 ⇒ 不得标为 true');
  assert.strictEqual(CONTRACTS.publishPromotionAllowed(), false,
    'promotionAllowed() 必须 fail-closed');
});

test('A.11 CI 真的消费 manifest（§18 要求）', () => {
  const wf = fs.readFileSync(path.join(REPO, '.github/workflows/test.yml'), 'utf8');
  assert.ok(/verify-v365-candidate-manifest\.js/.test(wf),
    'CI workflow 必须执行 V365 manifest 校验器，否则 qualification 不是真的被 CI 消费');
});

const failed = results.filter((r) => !r.ok);
results.forEach((r) => console.log((r.ok ? '[PASS] ' : '[FAIL] ') + r.name + (r.ok ? '' : ' :: ' + r.err)));
console.log('--- ' + (results.length - failed.length) + '/' + results.length
  + (failed.length ? ' HAS_FAILURE' : ' ALL_PASS') + ' ---');
process.exit(failed.length ? 1 : 0);
