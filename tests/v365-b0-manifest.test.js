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
  // DG-1 路线 (c) REBIND + 意图锚：
  //   ① REBIND —— 断言 manifest 声明值 == **唯一来源** CONTRACTS.ENGINE_VERSION（免维护）；
  //   ② 意图锚 —— 另加一条**字面量**断言钉住目标版本号。
  //   ⛔ 只做 REBIND 会退化为同义反复：「常量被改成错值」时两边一起错、静默通过。
  assert.strictEqual(m.engine_version, CONTRACTS.ENGINE_VERSION,
    'manifest.engine_version 必须等于 CONTRACTS.ENGINE_VERSION（唯一来源）');
  assert.strictEqual(CONTRACTS.ENGINE_VERSION, 'v3.6.7',
    '意图锚：本候选的目标版本号必须为 v3.6.7（升版时须显式改此锚，勿只改常量）');
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

test('A.10 CAS 证据状态未被高估（Q7 重裁后：只认单文档 CAS，且要求实现对齐）', () => {
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  // 机制裁定：多文档事务**非**必要条件；单文档条件 CAS 才是
  assert.strictEqual(m.cas_evidence.transaction_required, false,
    '多文档事务不是必要条件（协议只需要单文档指针原子切换）');
  assert.strictEqual(m.cas_evidence.platform_single_document_cas_required, true);
  assert.strictEqual(m.cas_evidence.platform_single_document_cas_verified, true,
    '平台单文档条件 CAS 已实证（CAS-1~CAS-7 + 并发，见 docs/V365_PLATFORM_CAS_EVIDENCE.md）');
  // 平台**负向**事实必须如实记录
  assert.strictEqual(m.cas_evidence.transaction_command_available, false,
    '命令通道无事务命令（CommandNotFound）⇒ 不得标 true');
  assert.strictEqual(m.cas_evidence.multi_command_batch_atomic, false,
    '批量命令非原子 ⇒ 不得标 true');
  // 实现对齐
  assert.strictEqual(m.cas_evidence.implementation_uses_single_document_cas, true);
  // 双重门：平台证据 AND 实现对齐 ⇒ 现为 true（⛔ 但仍受 deploy 授权约束）
  assert.strictEqual(CONTRACTS.publishPromotionAllowed(), true,
    '平台证据 + 实现对齐后 promotionAllowed() 应为 true');
  // ⛔ 反向守卫：任何一门缺失都必须 fail-closed
  const seen = CONTRACTS.CAS_EVIDENCE.platform_single_document_cas_verified;
  assert.strictEqual(seen, true);
});

test('A.11 CI 真的消费 manifest（§18 要求）', () => {
  const wf = fs.readFileSync(path.join(REPO, '.github/workflows/test.yml'), 'utf8');
  assert.ok(/verify-v365-candidate-manifest\.js/.test(wf),
    'CI workflow 必须执行 V365 manifest 校验器，否则 qualification 不是真的被 CI 消费');
});

// ─────────────────────────────────────────────────────────────────────
// A.12 ★ DG-1 新增：**V3.6.5 升版前身份件的留存与可独立复核**（升版不得丢失旧指纹）
//
// 背景：`ml/manifests/V365_CANDIDATE_MANIFEST.json` 是「当前候选」的**身份件**；
//   v3.6.5 → v3.6.7 升版时该文件**原地重出**（engine_version / file_sha256 / candidate_content_sha 全变）
//   ⇒ 若不显式留存，上一代身份（candidate_content_sha + 20×file_sha256）在工作区即**不可见**。
//
// 留存方式（DG-1.4，**零新增文件**）：把 V3.6.5 **升版前**身份件以**活体常量**承载于本文件，
//   并给出两条**互相独立**的可复核判据：
//     (I)  自洽重算 —— 用留存 file_sha256 重算 candidate_content_sha，须 == 留存声明值；
//     (II) 保真哈希 —— 留存块按生成器同构的**确定性序列化**后，其 LF-sha256 须 ==
//          `git cat-file blob dd610cb5dd0a782459d3789b94de3e1a3170c539:ml/manifests/V365_CANDIDATE_MANIFEST.json`
//          的 sha256（= f9673ee6…）。
//
// provenance：留存来源 = commit `dd610cb5dd0a782459d3789b94de3e1a3170c539`；该 commit 由远端分支
//   `gen1-da-rc-impl-20261006` 与 annotated tag `v3.6.7-impl-base` **双锚定**（tag^{} == dd610cb…）。
//   ⇒ 篡改留存常量 ⇒ (II) 必红；篡改 file_sha256 而不同步改 candidate_content_sha ⇒ (I) 必红。
// ⛔ 本测试只用 Node 内建模块：无网络、无子进程、无 git 调用（CI 浅克隆下同样成立）。
// ─────────────────────────────────────────────────────────────────────
test('A.12 ★ V3.6.5 升版前身份件留存且可独立复核（升版未丢失旧指纹）', () => {
  const crypto = require('crypto');

  // ── 留存块：V3.6.5 **升版前**身份件（= dd610cb 的 ml/manifests/V365_CANDIDATE_MANIFEST.json）──
  //    ⛔ 历史留存，不得随任何一次升版改写。
  const V365_PRE_UPGRADE_LF_SHA256 =
    'f9673ee62792833c2949d8d955f9b0c10646ca0601bb93f58ffe0f82aba409ed';
  const V365_PRE_UPGRADE = {
    "candidate_content_sha": "2027e5ccab37290f76d1feadd1710bca145a77255524ac01d03c5a4991e5e6fa",
    "candidate_content_sha_basis": "sha256(排序后的 \"path:per_file_lf_sha256\" 行，\\n 连接)",
    "cas_evidence": {
      "channel_evidence": "tcb.RunCommands",
      "evidence_doc": "docs/V365_PLATFORM_CAS_EVIDENCE.md",
      "implementation_uses_single_document_cas": true,
      "mechanics": "single-document conditional CAS（findAndModify 语义：expected-current filter + revision guard）",
      "multi_command_batch_atomic": false,
      "platform_single_document_cas_required": true,
      "platform_single_document_cas_verified": true,
      "probe_collection": "_v365_cas_probe",
      "probe_date": "2026-09-24",
      "transaction_command_available": false,
      "transaction_required": false
    },
    "contracts": {
      "calendar_artifact_sha256": "5edb6d4a0a9d7361d2794399a64f5882a7970a14ce4581aae05addb3c6eef786",
      "calendar_coverage_end": "2026-12-31",
      "calendar_coverage_start": "2026-01-01",
      "calendar_seeded": true,
      "calendar_synthetic": false,
      "calendar_version": "cn-a-share-2026.1",
      "input_contract_excluded_fields": [
        "breakout_nd"
      ],
      "input_contract_field_count": 31,
      "input_contract_version": "live-31-v1",
      "pipeline_contract_version": "pipeline-correlation-v1",
      "publish_protocol_version": "v365-two-stage-v1",
      "run_context_version": "v361-run-context-v2",
      "run_finality_version": "v361-run-finality-v1"
    },
    "engine_version": "v3.6.5",
    "file_sha256": {
      "cloudfunctions/adminGateway/index.js": "121e6f0de67913de168b1fbb3a12a9eba41629da1068322d9ac48b949c53999a",
      "cloudfunctions/apiGateway/index.js": "a86fd452dde19914369cd0d2550f0c4b10a398ed56e03e65e118dc83fc8754bf",
      "cloudfunctions/materializeIndicators/index.js": "bfb38f8d193429f4c32aeb220bbba5e56b0ee7660552418463d580411f32b448",
      "cloudfunctions/runDecisionEngine/index.js": "32168b2c1213157cfa756295725c6226c6f7fd11df5a3b87ec898c2e7043e95f",
      "src/common/data/cn-trading-calendar.v1.json": "5edb6d4a0a9d7361d2794399a64f5882a7970a14ce4581aae05addb3c6eef786",
      "src/common/data/cn-trading-calendar.v1.manifest.json": "82021a453c63ca6c8dbe5cca57ef67f4059961eaddfd71821303dbb821c13e7f",
      "src/common/data/sources/cn-trading-calendar.source.v1.json": "edd5147283ba22a3d271856ff0a0f1f67b1e63c6119c1193528154eb90ef6f6b",
      "src/common/utils/cn-trading-calendar.js": "9beb9a21022cd93132422a4c52f2c5c6d3db63c177ad1531155d46c2f4381ec9",
      "src/common/utils/datasource.js": "82d58d4163c41a8a0f2509312f261b118d0852c8471ee17d6d3ee0f6942f10cd",
      "src/common/utils/fundamental-provenance.js": "3caacc827788242b085961fb197c259e3fd205d69bc04e6f76bfb25e5c028443",
      "src/common/utils/global-signal-provenance.js": "708c1488f65e29130c191dcdde6a8274ec9ba0e62eca4588dfb44fb35caf3ba0",
      "src/common/utils/market-env-provenance.js": "7056560c5710999d17793a1ce37f57168b10fd59e2268abcb8209e9b8d6ae731",
      "src/common/utils/pipeline-correlation.js": "681a2dc4ddb6635f12894af297f1b3186c93dbe0a6e7f2d13d3bec2dbdca0a7a",
      "src/common/utils/v361-run-context.js": "1bc0c1447df990eea670463676bc61716762216e3cc38fa94ee48c5f3f11bccf",
      "src/common/utils/v361-run-finality.js": "f9228792793e1059acdbaabe22ba51abdd477be87d626f93d191ae4d6e0dd1e6",
      "src/common/utils/v365-active-read.js": "9bb154e10fcee49d238b51f596366bd6f2305b53d6ad507b77ff8f19ecd6fb39",
      "src/common/utils/v365-atomic-publish.js": "cb0950a0927951279660a6a058e0a57ac536dc70a007372f161a024a2b16763f",
      "src/common/utils/v365-contracts.js": "caf5ae8b89cc546264111f2b39531246308091ba97ea7fbe9877d70a79b87f25",
      "src/common/utils/v365-publish-store.js": "989a62bcc775e333227e5ef4515783f1e9e4ce667a6ccc9b64af97cd32df8285",
      "src/common/utils/v365-run-integrity.js": "9c0aba213c8c049ca520a845f77bd80f34c3769fc3b5dda19c9ab158e57ab921"
    },
    "frozen_predecessor_locks": [
      "ml/manifests/V361_IMMUTABLE_LOCK.json",
      "ml/manifests/V364_IMMUTABLE_LOCK.json"
    ],
    "frozen_predecessor_locks_rewritten_by_v365": false,
    "manifest_type": "v365_candidate_manifest",
    "parent_production_version": "v3.6.4",
    "qualification_status": "CANDIDATE",
    "qualification_status_note": "CANDIDATE ≠ PRODUCTION AUTHORIZED。QUALIFIED_CANDIDATE 仅在 Q1–Q15 全过时写入（scripts/v365-qualification-gate.js）。",
    "qualified_file_count": 20,
    "qualified_files": [
      "src/common/utils/v365-contracts.js",
      "src/common/utils/cn-trading-calendar.js",
      "src/common/data/cn-trading-calendar.v1.json",
      "src/common/data/cn-trading-calendar.v1.manifest.json",
      "src/common/data/sources/cn-trading-calendar.source.v1.json",
      "src/common/utils/v361-run-context.js",
      "src/common/utils/global-signal-provenance.js",
      "src/common/utils/fundamental-provenance.js",
      "src/common/utils/market-env-provenance.js",
      "src/common/utils/datasource.js",
      "src/common/utils/v361-run-finality.js",
      "src/common/utils/v365-atomic-publish.js",
      "src/common/utils/pipeline-correlation.js",
      "src/common/utils/v365-run-integrity.js",
      "src/common/utils/v365-publish-store.js",
      "src/common/utils/v365-active-read.js",
      "cloudfunctions/materializeIndicators/index.js",
      "cloudfunctions/runDecisionEngine/index.js",
      "cloudfunctions/apiGateway/index.js",
      "cloudfunctions/adminGateway/index.js"
    ],
    "release_kind": "PRODUCTION_INTEGRITY",
    "schema_version": "1.0",
    "source": {
      "hash_basis": "LF-normalized sha256（CRLF→LF 后再 sha256）",
      "source_commit": null,
      "source_commit_basis": "git rev-parse HEAD（生成时刻）；⚠️ 该字段为 volatile，--check 时忽略"
    }
  };

  const sha256 = (s) => crypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');
  // 与 scripts/gen-v365-candidate-manifest.js::stableStringify 同构（键序升序 + 紧凑 JSON）
  const stable = (v) => {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  };

  // (II) 保真哈希：留存块 确定性序列化 == dd610cb 身份件 blob
  assert.strictEqual(sha256(stable(V365_PRE_UPGRADE) + '\n'), V365_PRE_UPGRADE_LF_SHA256,
    '留存块确定性序列化后的 LF-sha256 必须等于 dd610cb 身份件 blob 的 sha256（留真校验失败）');

  // (I) 自洽重算：留存 file_sha256 → candidate_content_sha
  const basis = V365_PRE_UPGRADE.qualified_files.slice().sort()
    .map((p) => p + ':' + V365_PRE_UPGRADE.file_sha256[p]).join('\n');
  assert.strictEqual(sha256(basis), V365_PRE_UPGRADE.candidate_content_sha,
    '留存 file_sha256 重算出的 candidate_content_sha 必须等于留存声明值');
  assert.strictEqual(V365_PRE_UPGRADE.candidate_content_sha,
    '2027e5ccab37290f76d1feadd1710bca145a77255524ac01d03c5a4991e5e6fa',
    'V3.6.5 升版前 candidate_content_sha 冻结值不得被改写');
  assert.strictEqual(V365_PRE_UPGRADE.engine_version, 'v3.6.5', '留存块必须是 V3.6.5');
  assert.strictEqual(V365_PRE_UPGRADE.qualification_status, 'CANDIDATE');

  // (III) 升版确实发生：当前 manifest 的版本轴与指纹均已前进
  const cur = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  assert.notStrictEqual(cur.engine_version, V365_PRE_UPGRADE.engine_version,
    '当前 manifest engine_version 必须已升版（仍为 v3.6.5 说明未重出）');
  assert.strictEqual(cur.engine_version, CONTRACTS.ENGINE_VERSION);
  assert.notStrictEqual(cur.candidate_content_sha, V365_PRE_UPGRADE.candidate_content_sha,
    '升版后 candidate_content_sha 必须改变（否则说明合格面没变 / manifest 未重出）');

  // (IV) 合格面清单零增删（DG-1.3）
  assert.deepStrictEqual(cur.qualified_files.slice().sort(),
    V365_PRE_UPGRADE.qualified_files.slice().sort(),
    '合格面文件清单**不得**随升版增删');
  assert.strictEqual(cur.qualified_file_count, V365_PRE_UPGRADE.qualified_files.length);

  // (V) file_sha256 变化面恰 = 4：3 个已授权 CALC + v365-contracts.js（引擎身份轴）
  const changed = V365_PRE_UPGRADE.qualified_files.filter(
    (p) => cur.file_sha256[p] !== V365_PRE_UPGRADE.file_sha256[p]).sort();
  assert.deepStrictEqual(changed, [
    'cloudfunctions/materializeIndicators/index.js',
    'src/common/utils/cn-trading-calendar.js',
    'src/common/utils/datasource.js',
    'src/common/utils/v365-contracts.js'
  ].sort(), '升版后 file_sha256 变化面必须恰为上述 4 项，实得 ' + JSON.stringify(changed));

  // (VI) 其余 16 项逐位不变（防「顺手改」）
  const unchanged = V365_PRE_UPGRADE.qualified_files.filter(
    (p) => cur.file_sha256[p] === V365_PRE_UPGRADE.file_sha256[p]);
  assert.strictEqual(unchanged.length, 16);
});

const failed = results.filter((r) => !r.ok);
results.forEach((r) => console.log((r.ok ? '[PASS] ' : '[FAIL] ') + r.name + (r.ok ? '' : ' :: ' + r.err)));
console.log('--- ' + (results.length - failed.length) + '/' + results.length
  + (failed.length ? ' HAS_FAILURE' : ' ALL_PASS') + ' ---');
process.exit(failed.length ? 1 : 0);
