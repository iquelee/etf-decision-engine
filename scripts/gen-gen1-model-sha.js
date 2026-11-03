#!/usr/bin/env node
/**
 * I-2-D：Gen-1 `model_sha256` sidecar 生成器（F-02 / WR-C-03）。
 *
 * CANONICAL_BYTE_SOURCE = `cloudfunctions/runGen1ShadowEod/frozen-model.json`
 *   算法口径与 `ml/manifests/GEN1_IMMUTABLE_LOCK.json::hash_basis` **逐字一致**：
 *   "LF-normalized content (CRLF->LF before sha256) so Windows worktree == Linux CI"
 *
 * 产物：`ml/manifests/GEN1_MODEL_SHA.json`
 *   { model_sha256, hash_basis, source, generated_at }
 *
 * ⛔ 不联网、不调用子进程；只读 frozen-model.json + 写一份 sidecar。
 * ⛔ **不是** authority：本 sidecar 与 IMMUTABLE_LOCK / RUNTIME_BUNDLE 同源（单向），
 *    生成器**不读**任何锁，也**不**被任何锁读取。
 *
 * 用法：
 *   node scripts/gen-gen1-model-sha.js            # 生成 sidecar（幂等覆盖）
 *   node scripts/gen-gen1-model-sha.js --print    # 只打印 64-hex，不写文件
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..');
const SOURCE_REL = 'cloudfunctions/runGen1ShadowEod/frozen-model.json';
const OUT_REL = 'ml/manifests/GEN1_MODEL_SHA.json';
/** 与 GEN1_IMMUTABLE_LOCK.json::hash_basis 逐字一致。 */
const HASH_BASIS = 'LF-normalized content (CRLF->LF before sha256) so Windows worktree == Linux CI';
/** 行尾基准文件（同目录既有制品）：产物沿用其行尾，避免工作区 EOL 漂移。 */
const EOL_REF_REL = 'ml/manifests/GEN1_IMMUTABLE_LOCK.json';

/** 探测仓库工作区的行尾约定（CRLF / LF）。 */
function detectEol() {
  try {
    const b = fs.readFileSync(path.join(REPO, ...EOL_REF_REL.split('/')));
    return b.includes(Buffer.from('\r\n')) ? '\r\n' : '\n';
  } catch (e) {
    return '\n';
  }
}

function sha256lf(absPath) {
  const bytes = fs.readFileSync(absPath).toString('latin1');
  const lf = Buffer.from(bytes.replace(/\r\n/g, '\n'), 'latin1');
  return crypto.createHash('sha256').update(lf).digest('hex');
}

function main() {
  const printOnly = process.argv.slice(2).includes('--print');
  const srcAbs = path.join(REPO, ...SOURCE_REL.split('/'));
  const modelSha = sha256lf(srcAbs);

  if (printOnly) {
    process.stdout.write(`${modelSha}\n`);
    return;
  }

  const outAbs = path.join(REPO, ...OUT_REL.split('/'));
  const payload = {
    model_sha256: modelSha,
    hash_basis: HASH_BASIS,
    source: SOURCE_REL,
    generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  };
  const eol = detectEol();
  const text = (JSON.stringify(payload, null, 2) + '\n').split('\n').join(eol);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  fs.writeFileSync(outAbs, Buffer.from(text, 'utf8'));
  process.stdout.write(`[gen-gen1-model-sha] ${OUT_REL}\n  model_sha256 = ${modelSha}\n`);
}

main();
