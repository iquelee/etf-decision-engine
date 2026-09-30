#!/usr/bin/env node
/**
 * C-021.1 —— 确定性 tar 工具（**唯一来源**）
 *
 * ⛔ 多脚本复制同源逻辑是本项目已记录的踩坑（C-021 实测：`{data:{}}` 信封修复
 *    在 §2 脚本修好后，独立复制的回滚件脚本又踩一次）。
 *    ⇒ 凡需要「确定性打包 / 解包 / content-manifest sha」一律引用本模块。
 *
 * 设计要点（保证 same input ⇒ same bytes）：
 *   · ustar 格式
 *   · mtime / uid / gid 固定为 0
 *   · mode 固定 0644
 *   · 条目按 path 字典序排序
 *   · ⛔ 不 gzip（gzip 头含 mtime ⇒ 非确定性）
 */
'use strict';

const crypto = require('crypto');

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** LF 归一化（⛔ 线上包 CRLF ≠ git LF ⇒ 必须归一化，否则全量假阳性） */
function lfNormalize(buf) {
  return Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
}

function sha256Lf(buf) {
  return sha256(lfNormalize(buf));
}

/**
 * 构建确定性 tar。
 * @param {Array<{name:string, buf:Buffer}>} entries
 * @returns {Buffer}
 */
function buildDeterministicTar(entries) {
  const sorted = entries.slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const blocks = [];

  for (const e of sorted) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    if (nameBuf.length > 100) throw new Error(`tar 名过长（>100）：${e.name}`);
    const header = Buffer.alloc(512, 0);
    nameBuf.copy(header, 0);
    header.write('0000644\0', 100, 'ascii');                                       // mode（固定）
    header.write('0000000\0', 108, 'ascii');                                       // uid
    header.write('0000000\0', 116, 'ascii');                                       // gid
    header.write(e.buf.length.toString(8).padStart(11, '0') + '\0', 124, 'ascii'); // size
    header.write('00000000000\0', 136, 'ascii');                                   // mtime（固定 0）
    header.write('        ', 148, 'ascii');                                        // chksum 占位
    header.write('0', 156, 'ascii');                                               // typeflag
    header.write('ustar\0', 257, 'ascii');
    header.write('00', 263, 'ascii');
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += header[i];
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');

    blocks.push(header, e.buf);
    const rem = e.buf.length % 512;
    if (rem !== 0) blocks.push(Buffer.alloc(512 - rem, 0));
  }
  blocks.push(Buffer.alloc(1024, 0));
  return Buffer.concat(blocks);
}

/**
 * 独立最小 ustar 解析器（⛔ 不复用 build 侧内存对象）。
 * @returns {Array<{name:string, buf:Buffer, size:number}>}
 */
function parseDeterministicTar(buf) {
  const out = [];
  let off = 0;
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    let allZero = true;
    for (let i = 0; i < 512; i++) if (h[i] !== 0) { allZero = false; break; }
    if (allZero) break;

    const name = h.toString('utf8', 0, 100).replace(/\0.*$/, '');
    const sizeStr = h.toString('ascii', 124, 136).replace(/\0.*$/, '').trim();
    const size = parseInt(sizeStr, 8);
    if (!name || !Number.isFinite(size)) break;

    const start = off + 512;
    out.push({ name, buf: Buffer.from(buf.subarray(start, start + size)), size });
    off = start + size + ((size % 512) ? (512 - (size % 512)) : 0);
  }
  return out;
}

/**
 * content-manifest sha：对 (path, sha256, bytes) 三元组按 path 排序后串接取 sha。
 * @param {Array<{path:string, sha256:string, bytes:number}>} entries
 */
function contentManifestSha(entries) {
  const canonical = entries
    .slice()
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((e) => `${e.path}\n${e.sha256}\n${e.bytes}\n`)
    .join('');
  return sha256(Buffer.from(canonical, 'utf8'));
}

/** 冻结 ignore policy：非源码项，不参与 package diff */
const IGNORE_POLICY = Object.freeze(['node_modules/**', 'config.json']);

function makeIgnoreMatcher(patterns) {
  return (p) => patterns.some((pat) => {
    if (pat.endsWith('/**')) {
      const pre = pat.slice(0, -3);
      return p === pre || p.startsWith(pre + '/');
    }
    return p === pat;
  });
}

/** 递归列出目录内所有文件相对路径（posix 风格） */
function walkRel(root, rel, acc) {
  const fs = require('fs');
  const path = require('path');
  const dir = rel ? path.join(root, rel) : root;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walkRel(root, r, acc);
    else acc.push(r);
  }
  return acc;
}

// ── 路径映射（§3 三文件树规则，唯一来源）──────────────────

/** bundle 内相对路径 → repo 路径 */
function bundleToRepo(bundleRel) {
  if (bundleRel === 'index.js') return 'cloudfunctions/runDecisionEngine/index.js';
  if (bundleRel === 'package.json') return 'cloudfunctions/runDecisionEngine/package.json';
  if (bundleRel.startsWith('common/')) return 'src/common/' + bundleRel.slice('common/'.length);
  return 'ml/manifests/' + bundleRel;
}

/** repo 路径 → bundle 内相对路径 */
function repoToBundle(repoPath) {
  const path = require('path');
  if (repoPath === 'cloudfunctions/runDecisionEngine/index.js') return 'index.js';
  if (repoPath === 'cloudfunctions/runDecisionEngine/package.json') return 'package.json';
  if (repoPath.startsWith('src/common/')) return 'common/' + repoPath.slice('src/common/'.length);
  return path.basename(repoPath);
}

module.exports = {
  sha256,
  lfNormalize,
  sha256Lf,
  buildDeterministicTar,
  parseDeterministicTar,
  contentManifestSha,
  IGNORE_POLICY,
  makeIgnoreMatcher,
  walkRel,
  bundleToRepo,
  repoToBundle
};
