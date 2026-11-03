#!/usr/bin/env node
/**
 * D2-G1：Gen-1 `source_sha256` 生产级生成器（F-01 / WR-C-01）。
 *
 * 对象（裁定 `docs/gen1/GEN1_FREEZE_SEAL_BINDING_DECISION.md` §2）= **C1**
 *   集合 = `src/common/utils/gen1-*.js`（17 文件）
 *   算法 = sha256lf（CRLF→LF 后取 sha256）
 *   聚合 = 对按 **POSIX 路径升序**的每个文件依次
 *            update(rel) + 0x00 + update(hex(sha256lf(file))) + '\n'
 *          最后对整体取 sha256 ⇒ 单一 64-hex
 *
 * ⛔ 只读：本脚本不写任何文件、不联网、不调用子进程。
 * ⛔ 确定性：同一工作区内容连跑两次输出**逐字节相同**（不含时间戳/随机量）。
 *
 * 用法：
 *   node scripts/gen-gen1-source-sha.js            # 输出 64-hex
 *   node scripts/gen-gen1-source-sha.js --list     # 输出 17 条 rel（每行一条）
 *   node scripts/gen-gen1-source-sha.js --json     # 输出 {source_sha256, files, count}
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..');
/** C1 受管目录（POSIX 相对路径口径）。 */
const C1_DIR_REL = 'src/common/utils';
/** C1 文件名模式（与裁定 §2 的 `gen1-*.js` 逐字一致）。 */
const C1_PATTERN = /^gen1-.*\.js$/;

/**
 * CRLF→LF 归一化后取 sha256（与 GEN1_IMMUTABLE_LOCK.json::hash_basis 同口径）。
 * ⚠️ 走 latin1 做**逐字节无损**映射（等价 Python `b.replace(b"\r\n", b"\n")`），
 *    ⛔ 不用 utf8 解码（对非法序列会做替换 ⇒ 非字节级）。
 */
function sha256lf(absPath) {
  const bytes = fs.readFileSync(absPath).toString('latin1');
  const lf = Buffer.from(bytes.replace(/\r\n/g, '\n'), 'latin1');
  return crypto.createHash('sha256').update(lf).digest('hex');
}

function c1Entries() {
  const dirAbs = path.join(REPO, ...C1_DIR_REL.split('/'));
  const names = fs.readdirSync(dirAbs).filter((n) => C1_PATTERN.test(n));
  const rels = names.map((n) => `${C1_DIR_REL}/${n}`);
  rels.sort();                       // 升序（ASCII 路径 ⇒ 与 POSIX 字节序一致）
  return rels.map((rel) => ({
    rel,
    abs: path.join(REPO, ...rel.split('/'))
  }));
}

function aggregate(entries) {
  const h = crypto.createHash('sha256');
  for (const e of entries) {
    h.update(Buffer.from(e.rel, 'utf8'));
    h.update(Buffer.from([0x00]));
    h.update(Buffer.from(sha256lf(e.abs), 'utf8'));
    h.update(Buffer.from('\n', 'utf8'));
  }
  return h.digest('hex');
}

function main() {
  const args = process.argv.slice(2);
  const entries = c1Entries();
  const value = aggregate(entries);

  if (args.includes('--list')) {
    for (const e of entries) process.stdout.write(`${e.rel}\n`);
    return;
  }
  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify({
      source_sha256: value,
      count: entries.length,
      files: entries.map((e) => e.rel)
    }, null, 2) + '\n');
    return;
  }
  process.stdout.write(`${value}\n`);
}

main();
