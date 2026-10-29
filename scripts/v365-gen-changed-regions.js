#!/usr/bin/env node
/**
 * HD12-3 —— 改动区域清单生成器（供 `--changed-region` 使用）
 *
 * ⚠️ 为什么单独一个脚本：parity 门禁**不调子进程**（既有约束）⇒ 区域清单必须由调用方生成。
 *    本脚本即该「调用方工具」，用 `git diff -U0` 得到**新增侧**行区间。
 *
 * 用法：
 *   node scripts/v365-gen-changed-regions.js --changed-file <list> [--out <path>]
 *   node scripts/v365-gen-changed-regions.js <file1> <file2> ...
 *
 * 输出格式（每行）：`<repo-relative-path>\t<startLine>\t<endLine>`（1-based 闭区间）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) { a._.push(k); continue; }
    const v = argv[i + 1];
    if (v == null || v.startsWith('--')) { a[k.slice(2)] = true; continue; }
    a[k.slice(2)] = v; i += 1;
  }
  return a;
}
const a = parseArgs(process.argv);

let files = a._.slice();
if (a['changed-file']) {
  files = files.concat(
    fs.readFileSync(path.resolve(String(a['changed-file'])), 'utf8')
      .split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  );
}
files = [...new Set(files.map((f) => f.split(path.sep).join('/')))].sort();

const regions = [];
const notes = [];

for (const f of files) {
  // 未跟踪文件：整文件视为一个区域
  const tracked = spawnSync('git', ['ls-files', '--error-unmatch', f], { cwd: REPO, encoding: 'utf8' });
  const abs = path.join(REPO, f);
  if (tracked.status !== 0) {
    if (fs.existsSync(abs)) {
      const n = fs.readFileSync(abs, 'utf8').split(/\r?\n/).length;
      regions.push({ file: f, start: 1, end: Math.max(1, n) });
      notes.push(`${f}: 未跟踪 ⇒ 整文件视为一个区域 (1-${n})`);
    }
    continue;
  }
  const d = spawnSync('git', ['diff', '-U0', '--no-color', 'HEAD', '--', f], { cwd: REPO, encoding: 'utf8', maxBuffer: 1e8 });
  if (d.error || d.status !== 0) { notes.push(`${f}: git diff 失败（${d.error ? d.error.code : d.status}）`); continue; }
  const lines = String(d.stdout).split(/\r?\n/);
  let hit = 0;
  lines.forEach((ln) => {
    const m = ln.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (!m) return;
    const start = Number(m[1]);
    const count = m[2] == null ? 1 : Number(m[2]);
    if (count === 0) return;                 // 纯删除 ⇒ 无新增行
    regions.push({ file: f, start, end: start + count - 1 });
    hit++;
  });
  if (!hit) notes.push(`${f}: 无新增行（纯删除或未改动）`);
}

const out = regions.map((r) => `${r.file}\t${r.start}\t${r.end}`).join('\n') + (regions.length ? '\n' : '');

notes.forEach((n) => console.log(`  [INFO] ${n}`));
console.log(`  区域数 = ${regions.length}`);
regions.forEach((r) => console.log(`    ${r.file}\t${r.start}\t${r.end}`));

if (a.out) {
  const p = path.resolve(String(a.out));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, out, 'utf8');
  console.log(`\n  [written] ${p}`);
} else {
  console.log('\n--- 区域清单 ---');
  process.stdout.write(out);
}
