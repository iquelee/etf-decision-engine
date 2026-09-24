#!/usr/bin/env node
'use strict';

/**
 * V3.6.5 合格面校验器（任务书 §18）。
 *
 * 与 V3.6.4 的差别（这是必须补上的缺陷）：
 *   V364 lock **声明了** file hashes，但既有 verifier 并未完整消费那些声明
 *   ⇒ 声明与实际之间可以是"无人核对"的状态。V365 不得复制该缺陷。
 *
 * 本校验器做**逐文件实读 + 实算 hash + 逐一比对**：
 *   manifest.qualified_files → 磁盘实文件 → LF-sha256 → 与 manifest.file_sha256 比
 *
 * 失败码（任一即 FAIL，进程退出码 1）：
 *   MANIFEST_MISSING               - manifest 不存在
 *   MANIFEST_SCHEMA_INVALID        - 缺必需字段 / 类型不符
 *   DECLARED_FILE_MISSING          - manifest 声明的文件在磁盘上不存在
 *   HASH_MISMATCH                  - 内容与声明不符
 *   UNEXPECTED_QUALIFIED_FILE_CHANGE - 磁盘存在属于 V365 合格面的文件但未被声明
 *   CANDIDATE_CONTENT_SHA_MISMATCH - candidate_content_sha 与重算值不符
 *   CALENDAR_SHA_MISMATCH          - calendar_artifact_sha256 与 calendar manifest 不符
 *
 * 用法：node scripts/verify-v365-candidate-manifest.js [--json]
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..');
const MANIFEST = path.join(REPO, 'ml', 'manifests', 'V365_CANDIDATE_MANIFEST.json');

/** 磁盘上**属于** V365 合格面、但因任何原因未被 manifest 声明的文件模式 */
const SURFACE_GLOBS = [
  { dir: 'src/common/utils', test: (n) => /^v365-.*\.js$/.test(n) },
  { dir: 'src/common/utils', test: (n) => n === 'pipeline-correlation.js' },
  { dir: 'src/common/utils', test: (n) => /^cn-trading-calendar\.js$/.test(n) },
  { dir: 'src/common/utils', test: (n) => /-provenance\.js$/.test(n) },
  { dir: 'src/common/data', test: (n) => /^cn-trading-calendar\.v1(\..*)?\.json$/.test(n) },
  { dir: 'src/common/data/sources', test: (n) => /^cn-trading-calendar\.source\.v1\.json$/.test(n) }
];

function lfNormalize(buf) {
  return Buffer.from(String(buf).replace(/\r\n/g, '\n'), 'utf8');
}
function sha256Lf(buf) {
  return crypto.createHash('sha256').update(lfNormalize(buf)).digest('hex');
}
function sha256Text(s) {
  return crypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');
}

function collectSurfaceFiles() {
  const found = [];
  SURFACE_GLOBS.forEach((g) => {
    const abs = path.join(REPO, g.dir);
    if (!fs.existsSync(abs)) return;
    fs.readdirSync(abs).forEach((n) => {
      if (!g.test(n)) return;
      const rel = (g.dir + '/' + n).replace(/\\/g, '/');
      if (!found.includes(rel)) found.push(rel);
    });
  });
  return found;
}

function verify() {
  const errors = [];
  const add = (code, detail) => errors.push({ code, detail });

  if (!fs.existsSync(MANIFEST)) {
    add('MANIFEST_MISSING', path.relative(REPO, MANIFEST).replace(/\\/g, '/'));
    return { ok: false, errors, checked: 0 };
  }

  let m;
  try {
    m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  } catch (e) {
    add('MANIFEST_SCHEMA_INVALID', 'JSON 解析失败: ' + e.message);
    return { ok: false, errors, checked: 0 };
  }

  const required = ['engine_version', 'parent_production_version', 'source', 'contracts',
    'qualified_files', 'file_sha256', 'candidate_content_sha', 'qualification_status'];
  required.forEach((k) => {
    if (m[k] == null) add('MANIFEST_SCHEMA_INVALID', '缺字段 ' + k);
  });
  if (!Array.isArray(m.qualified_files) || !m.file_sha256 || typeof m.file_sha256 !== 'object') {
    add('MANIFEST_SCHEMA_INVALID', 'qualified_files / file_sha256 形态不符');
    return { ok: false, errors, checked: 0 };
  }
  if (errors.length) return { ok: false, errors, checked: 0 };

  // ---- 逐文件实读 + 实算 + 比对 ----
  let checked = 0;
  const recomputed = {};
  m.qualified_files.forEach((rel) => {
    const abs = path.join(REPO, rel);
    if (!fs.existsSync(abs)) {
      add('DECLARED_FILE_MISSING', rel);
      return;
    }
    const got = sha256Lf(fs.readFileSync(abs));
    recomputed[rel] = got;
    checked += 1;
    const declared = m.file_sha256[rel];
    if (declared == null) {
      add('MANIFEST_SCHEMA_INVALID', 'file_sha256 未声明 ' + rel);
    } else if (declared !== got) {
      add('HASH_MISMATCH', `${rel}: declared=${declared.slice(0, 16)}… actual=${got.slice(0, 16)}…`);
    }
  });
  // manifest 声明了但磁盘没有的 key（反向核对）
  Object.keys(m.file_sha256).forEach((rel) => {
    if (!m.qualified_files.includes(rel)) add('MANIFEST_SCHEMA_INVALID', 'file_sha256 含未声明路径 ' + rel);
  });

  // ---- 合格面「意外新增」检测 ----
  const surface = collectSurfaceFiles();
  surface.forEach((rel) => {
    if (!m.qualified_files.includes(rel)) {
      add('UNEXPECTED_QUALIFIED_FILE_CHANGE', rel + ' 属于 V365 合格面但未被 manifest 声明');
    }
  });

  // ---- candidate_content_sha 重算 ----
  const basis = m.qualified_files.slice().sort().map((p) => p + ':' + recomputed[p]).join('\n');
  const contentSha = sha256Text(basis);
  if (contentSha !== m.candidate_content_sha) {
    add('CANDIDATE_CONTENT_SHA_MISMATCH',
      `declared=${String(m.candidate_content_sha).slice(0, 16)}… actual=${contentSha.slice(0, 16)}…`);
  }

  // ---- calendar artifact sha 交叉核对 ----
  if (m.contracts && m.contracts.calendar_artifact_sha256) {
    const calManifestPath = path.join(REPO, 'src/common/data/cn-trading-calendar.v1.manifest.json');
    try {
      const cm = JSON.parse(fs.readFileSync(calManifestPath, 'utf8'));
      if (cm.artifact_sha256 !== m.contracts.calendar_artifact_sha256) {
        add('CALENDAR_SHA_MISMATCH', `calendar manifest=${cm.artifact_sha256} vs v365 manifest=${m.contracts.calendar_artifact_sha256}`);
      }
    } catch (e) {
      add('CALENDAR_SHA_MISMATCH', 'calendar manifest 不可读: ' + e.message);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    checked,
    engine_version: m.engine_version,
    qualification_status: m.qualification_status,
    candidate_content_sha: contentSha
  };
}

function main() {
  const r = verify();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(r, null, 2));
  } else if (r.ok) {
    console.log(`[PASS] V365_CANDIDATE_MANIFEST 校验通过：${r.checked} 个合格文件逐字节一致`);
    console.log(`       engine_version       = ${r.engine_version}`);
    console.log(`       qualification_status = ${r.qualification_status}`);
    console.log(`       candidate_content_sha= ${r.candidate_content_sha}`);
  } else {
    console.error(`[FAIL] V365_CANDIDATE_MANIFEST 校验失败：${r.errors.length} 项`);
    r.errors.forEach((e) => console.error(`   - ${e.code}: ${e.detail}`));
  }
  process.exit(r.ok ? 0 : 1);
}

if (require.main === module) main();

module.exports = { verify, collectSurfaceFiles, MANIFEST };
