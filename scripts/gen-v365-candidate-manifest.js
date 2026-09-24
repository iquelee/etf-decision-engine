#!/usr/bin/env node
'use strict';

/**
 * 生成 `ml/manifests/V365_CANDIDATE_MANIFEST.json`（V3.6.5 自己的身份与完整性声明）。
 *
 * 用法：
 *   node scripts/gen-v365-candidate-manifest.js                 # 生成（source_commit 取 HEAD）
 *   node scripts/gen-v365-candidate-manifest.js --check         # 确定性复核（忽略 volatile 字段）
 *   node scripts/gen-v365-candidate-manifest.js --source-commit <sha>
 *   node scripts/gen-v365-candidate-manifest.js --status CANDIDATE|QUALIFIED_CANDIDATE
 *
 * 设计要点（任务书 §2 / §18）：
 *   - ⛔ 不含时间戳；除 `source.source_commit` 与 `qualification_status` 外全部可确定性重算。
 *   - hash_basis = **LF 归一化**后 sha256（CRLF→LF），与 CI/Linux 一致。
 *   - manifest **不记录自身 hash**（避免自指）。
 *   - 与 V364 lock 的关系：V365 修改了若干 V364 冻结文件，但**绝不回写** V364 lock。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..');
const CONTRACTS = require(path.join(REPO, 'src', 'common', 'utils', 'v365-contracts.js'));

const OUT = path.join(REPO, 'ml', 'manifests', 'V365_CANDIDATE_MANIFEST.json');

/**
 * V3.6.5 **合格文件面**（qualified_files）。
 * 语义：这份清单**构成** V3.6.5 候选本体。清单内任何文件内容变化 ⇒ 必须重出 manifest。
 * ⛔ 该清单必须在源码**显式列出**（不得用 glob）—— 否则"意外新增文件"将无法被检出。
 */
const QUALIFIED_FILES = [
  // —— B0：身份与契约 ——
  'src/common/utils/v365-contracts.js',

  // —— P-1 / P-1A：交易日历权威源 ——
  'src/common/utils/cn-trading-calendar.js',
  'src/common/data/cn-trading-calendar.v1.json',
  'src/common/data/cn-trading-calendar.v1.manifest.json',
  'src/common/data/sources/cn-trading-calendar.source.v1.json',

  // —— P-1：RunContext 三日期语义 ——
  'src/common/utils/v361-run-context.js',

  // —— P-2：输入日期 provenance ——
  'src/common/utils/global-signal-provenance.js',
  'src/common/utils/fundamental-provenance.js',
  'src/common/utils/market-env-provenance.js',
  'src/common/utils/datasource.js',

  // —— P-3：原子发布 ——
  'src/common/utils/v361-run-finality.js',
  'src/common/utils/v365-atomic-publish.js',

  // —— P-4：pipeline correlation ——
  'src/common/utils/pipeline-correlation.js',

  // —— B1：运行时接线（本工作包新增） ——
  'src/common/utils/v365-run-integrity.js',
  'src/common/utils/v365-publish-store.js',
  'src/common/utils/v365-active-read.js',

  // —— B1：云函数接线 ——
  'cloudfunctions/materializeIndicators/index.js',
  'cloudfunctions/runDecisionEngine/index.js'
];

function lfNormalize(buf) {
  return Buffer.from(String(buf).replace(/\r\n/g, '\n'), 'utf8');
}

function sha256Lf(absPath) {
  const raw = fs.readFileSync(absPath);
  return crypto.createHash('sha256').update(lfNormalize(raw)).digest('hex');
}

function sha256Text(s) {
  return crypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');
}

/** 稳定键序 JSON（保证确定性重算） */
function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

function readGitHead() {
  try {
    const g = path.join(REPO, '.git', 'HEAD');
    let head = fs.readFileSync(g, 'utf8').trim();
    if (head.startsWith('ref:')) {
      const ref = head.slice(4).trim();
      const p = path.join(REPO, '.git', ref);
      if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').trim();
      // packed-refs 回退
      const packed = path.join(REPO, '.git', 'packed-refs');
      if (fs.existsSync(packed)) {
        const line = fs.readFileSync(packed, 'utf8').split('\n')
          .find((l) => l.endsWith(' ' + ref));
        if (line) return line.split(' ')[0];
      }
    }
    return head;
  } catch (e) {
    return null;
  }
}

/** 读取 calendar artifact manifest 里的 sha（calendar_artifact_sha256） */
function readCalendarArtifactSha() {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(REPO, CONTRACTS.CALENDAR_MANIFEST_PATH), 'utf8'));
    return {
      sha: m.artifact_sha256 || null,
      version: m.calendar_version || null,
      seeded: m.seeded === true,
      synthetic: m.synthetic === true,
      coverage_start: m.coverage_start || null,
      coverage_end: m.coverage_end || null
    };
  } catch (e) {
    return { sha: null, version: null, seeded: false, synthetic: false, coverage_start: null, coverage_end: null };
  }
}

function build(opts) {
  const o = opts || {};
  const missing = [];
  const fileSha = {};
  QUALIFIED_FILES.forEach((rel) => {
    const abs = path.join(REPO, rel);
    if (!fs.existsSync(abs)) { missing.push(rel); return; }
    fileSha[rel] = sha256Lf(abs);
  });
  if (missing.length) {
    throw new Error('QUALIFIED_FILE_MISSING: ' + missing.join(', '));
  }

  // candidate_content_sha = 对「排序后的 path:sha256 行」取 sha256
  const contentBasis = QUALIFIED_FILES.slice().sort()
    .map((p) => p + ':' + fileSha[p]).join('\n');
  const candidateContentSha = sha256Text(contentBasis);

  const cal = readCalendarArtifactSha();

  return {
    manifest_type: 'v365_candidate_manifest',
    schema_version: '1.0',
    engine_version: CONTRACTS.ENGINE_VERSION,
    release_kind: CONTRACTS.RELEASE_KIND,
    parent_production_version: CONTRACTS.PARENT_PRODUCTION_VERSION,

    // ⚠️ V364 / V361 lock **不在**本 manifest 内，也不由本 manifest 回写：
    //    V3.6.5 有自己的完整性与合格面（见 qualified_files）。
    frozen_predecessor_locks: [
      'ml/manifests/V361_IMMUTABLE_LOCK.json',
      'ml/manifests/V364_IMMUTABLE_LOCK.json'
    ],
    frozen_predecessor_locks_rewritten_by_v365: false,

    source: {
      source_commit: o.sourceCommit || readGitHead(),
      source_commit_basis: 'git rev-parse HEAD（生成时刻）；⚠️ 该字段为 volatile，--check 时忽略',
      hash_basis: 'LF-normalized sha256（CRLF→LF 后再 sha256）'
    },

    contracts: {
      input_contract_version: CONTRACTS.INPUT_CONTRACT_VERSION,
      input_contract_field_count: CONTRACTS.INPUT_CONTRACT_FIELD_COUNT,
      input_contract_excluded_fields: CONTRACTS.INPUT_CONTRACT_EXCLUDED_FIELDS.slice(),
      calendar_version: CONTRACTS.CALENDAR_VERSION,
      calendar_artifact_sha256: cal.sha,
      calendar_seeded: cal.seeded,
      calendar_synthetic: cal.synthetic,
      calendar_coverage_start: cal.coverage_start,
      calendar_coverage_end: cal.coverage_end,
      pipeline_contract_version: CONTRACTS.PIPELINE_CONTRACT_VERSION,
      run_context_version: CONTRACTS.RUN_CONTEXT_VERSION,
      run_finality_version: CONTRACTS.RUN_FINALITY_VERSION,
      publish_protocol_version: CONTRACTS.PUBLISH_PROTOCOL_VERSION
    },

    cas_evidence: {
      // ── Q7 重裁（2026-09-24 平台实证后）──────────────────────────────
      // 判据从「是否用了多文档事务」改为「authoritative 指针切换是否真的原子」。
      transaction_required: CONTRACTS.CAS_EVIDENCE.transaction_required,
      platform_single_document_cas_required: CONTRACTS.CAS_EVIDENCE.platform_single_document_cas_required,
      mechanics: 'single-document conditional CAS（findAndModify 语义：expected-current filter + revision guard）',
      channel_evidence: CONTRACTS.CAS_EVIDENCE.channel_evidence,
      probe_collection: CONTRACTS.CAS_EVIDENCE.probe_collection,
      probe_date: CONTRACTS.CAS_EVIDENCE.probe_date,
      platform_single_document_cas_verified: CONTRACTS.CAS_EVIDENCE.platform_single_document_cas_verified,
      // 平台**负向**事实（如实记录，不得当成"已具备"）
      transaction_command_available: CONTRACTS.CAS_EVIDENCE.transaction_command_available,
      multi_command_batch_atomic: CONTRACTS.CAS_EVIDENCE.multi_command_batch_atomic,
      // 实现对齐（必须与 v365-publish-store.js 实际实现一致）
      implementation_uses_single_document_cas: CONTRACTS.CAS_EVIDENCE.implementation_uses_single_document_cas,
      evidence_doc: CONTRACTS.CAS_EVIDENCE.evidence_doc
    },

    qualified_files: QUALIFIED_FILES.slice(),
    qualified_file_count: QUALIFIED_FILES.length,
    file_sha256: fileSha,
    candidate_content_sha: candidateContentSha,
    candidate_content_sha_basis: 'sha256(排序后的 "path:per_file_lf_sha256" 行，\\n 连接)',

    qualification_status: o.status || 'CANDIDATE',
    qualification_status_note:
      'CANDIDATE ≠ PRODUCTION AUTHORIZED。QUALIFIED_CANDIDATE 仅在 Q1–Q15 全过时写入（scripts/v365-qualification-gate.js）。'
  };
}

/** --check：只比较「非 volatile」字段 */
function checkDeterminism() {
  const onDisk = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  const fresh = build({ sourceCommit: onDisk.source && onDisk.source.source_commit, status: onDisk.qualification_status });
  const diffs = [];
  const volatile = new Set(['source_commit']);
  const cmp = (a, b, prefix) => {
    if (a === b) return;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
      diffs.push(`${prefix}: disk=${JSON.stringify(a)} recomputed=${JSON.stringify(b)}`);
      return;
    }
    const keys = Array.from(new Set([...Object.keys(a), ...Object.keys(b)])).sort();
    keys.forEach((k) => cmp(a[k], b[k], prefix ? prefix + '.' + k : k));
  };
  // source 内的 source_commit 为 volatile ⇒ 临时对齐
  const a = JSON.parse(JSON.stringify(onDisk));
  const b = JSON.parse(JSON.stringify(fresh));
  if (a.source && b.source) { a.source.source_commit = 'X'; b.source.source_commit = 'X'; }
  cmp(a, b, '');
  return diffs;
}

function main() {
  const argv = process.argv.slice(2);
  const getArg = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : null;
  };
  if (argv.includes('--check')) {
    const diffs = checkDeterminism();
    if (diffs.length) {
      console.error('[FAIL] V365 manifest 确定性复核失败：');
      diffs.slice(0, 20).forEach((d) => console.error('   - ' + d));
      process.exit(1);
    }
    console.log('[OK] V365_CANDIDATE_MANIFEST.json 确定性复核通过（BYTE-EQUIVALENT，忽略 source_commit）');
    return;
  }
  const manifest = build({ sourceCommit: getArg('--source-commit'), status: getArg('--status') });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, stableStringify(manifest) + '\n', 'utf8');
  console.log('[OK] 已写入 ' + path.relative(REPO, OUT).replace(/\\/g, '/'));
  console.log('  engine_version        = ' + manifest.engine_version);
  console.log('  qualified_file_count  = ' + manifest.qualified_file_count);
  console.log('  candidate_content_sha = ' + manifest.candidate_content_sha);
  console.log('  calendar_artifact_sha = ' + manifest.contracts.calendar_artifact_sha256);
  console.log('  qualification_status  = ' + manifest.qualification_status);
}

if (require.main === module) main();

module.exports = { QUALIFIED_FILES, sha256Lf, sha256Text, stableStringify, build, checkDeterminism, OUT };
