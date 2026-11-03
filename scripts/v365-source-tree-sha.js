#!/usr/bin/env node
/**
 * C-021.1 §9 —— 源树内容指纹（**独立真值源**，供门禁日志新鲜度判定用）
 *
 * 为什么不用 mtime：
 *   `tests/v365-b0-manifest.test.js` 的 A.8「反向证明」会**故意篡改**某个合格源文件、
 *   校验器报错后再**逐字节还原**。这会让该文件 mtime 被推后而**内容未变**
 *   ⇒ 纯 mtime 的新鲜度判定会**假报过期**（实测：`src/common/utils/v365-contracts.js`）。
 * ⇒ 改用**内容指纹**：只要 `tests/**` · `scripts/**` · `src/**` 的内容未变，即视为「未过期」。
 *
 * 用法：
 *   node scripts/v365-source-tree-sha.js                 # 打印指纹
 *   node scripts/v365-source-tree-sha.js --out <path>    # 写入文件（供 preflight 读取）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..');

/** 参与指纹的目录（= 会影响门禁结论的源面） */
const SOURCE_DIRS = Object.freeze(['tests', 'scripts', 'src']);

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** 递归收集文件相对路径（posix） */
function walkRel(root, rel, acc) {
  let ents;
  try { ents = fs.readdirSync(root, { withFileTypes: true }); } catch (e) { return acc; }
  for (const e of ents) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walkRel(path.join(root, e.name), r, acc);
    else acc.push(r);
  }
  return acc;
}

/**
 * 计算源树内容指纹：对 (relPath, sha256) 排序后串接取 sha。
 * ⛔ 只用内容，⛔ 不用 mtime —— 免受「篡改后逐字节还原」类测试影响。
 * @returns {{ sha256: string, file_count: number, dirs: string[] }}
 */
function sourceTreeSha(dirs) {
  const use = dirs || SOURCE_DIRS;
  const entries = [];
  for (const d of use) {
    const abs = path.join(REPO, d);
    for (const rel of walkRel(abs, '', [])) {
      const p = path.join(abs, rel);
      let h;
      try { h = sha256(fs.readFileSync(p)); } catch (e) { h = 'UNREADABLE'; }
      entries.push({ path: `${d}/${rel}`, sha256: h });
    }
  }
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const canonical = entries.map((e) => `${e.path}\n${e.sha256}\n`).join('');
  return {
    sha256: sha256(Buffer.from(canonical, 'utf8')),
    file_count: entries.length,
    dirs: use.slice()
  };
}

module.exports = { sourceTreeSha, SOURCE_DIRS, sha256 };

if (require.main === module) {
  const i = process.argv.indexOf('--out');
  const info = sourceTreeSha();
  const text = `${info.sha256}\n`;
  if (i >= 0 && process.argv[i + 1]) {
    const out = path.resolve(process.argv[i + 1]);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, text);
    console.log(`${info.sha256}  (files=${info.file_count}) => ${out}`);
  } else {
    process.stdout.write(text);
  }
}
