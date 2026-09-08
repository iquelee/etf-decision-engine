/**
 * 源码发布打包。必须走本脚本，禁止手写 zip 把本地配置打进去。
 *
 * 运行：node scripts/pack-source.js [tag]
 * 默认 tag = 当天日期。输出 etf-decision-engine-source-<tag>.zip
 *
 * 永不打包：cloudbaserc.json、各云函数 config.json、web/.env
 * 打进去的是 example 模板。打完再扫一遍 zip 目录。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { isSecretRel, scanPaths, scanZipNamelist } = require('./scan-secrets.js');

const ROOT = path.join(__dirname, '..');
const tag = process.argv[2] || new Date().toISOString().slice(0, 10);
const outName = `etf-decision-engine-source-${tag}.zip`;
const outPath = path.join(ROOT, outName);

const INCLUDE = [
  'VERSION.txt',
  '.gitignore',
  'cloudbaserc.example.json',
  'V3.1改进建议.md',
  'cloudfunctions',
  'tests',
  'deliverables',
  'PRD文档',
  '用户手册',
  '回测报告',
  'ml',
  'web',
  'scripts'
];

const ZIP_EXCLUDE = [
  'web/node_modules/*',
  'web/dist/*',
  'scripts/node_modules/*',
  'scripts/deploy.js',
  'scripts/deploy2.js',
  'scripts/deploy3.js',
  'scripts/deploy4.js',
  'scripts/backtest-out/*',
  'scripts/backtest-out/**',
  'cloudfunctions/*/config.json',
  'web/.env',
  'web/.env.local',
  '*.DS_Store',
  '*__pycache__/*',
  '*.pyc'
];

function collectIncluded() {
  const files = [];
  function walk(rel) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) return;
    const st = fs.statSync(abs);
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(abs)) {
        if (name === 'node_modules' || name === 'dist') continue;
        walk(path.join(rel, name).replace(/\\/g, '/'));
      }
      return;
    }
    const n = rel.replace(/\\/g, '/');
    if (isSecretRel(n)) return;
    if (n.endsWith('.zip')) return;
    files.push(abs);
  }
  for (const item of INCLUDE) walk(item);
  return files;
}

function main() {
  const included = collectIncluded();
  const leaked = included.filter((abs) => isSecretRel(path.relative(ROOT, abs).replace(/\\/g, '/')));
  if (leaked.length) {
    console.error('打包列表混入密钥文件，已中止');
    process.exit(1);
  }
  const contentHits = scanPaths(included);
  if (contentHits.length) {
    console.error('待打包文件内容含明文密钥，已中止：');
    for (const f of contentHits) console.error(`  - ${f.file}: ${f.reason}`);
    process.exit(1);
  }

  if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
  const excludeArgs = ZIP_EXCLUDE.map((p) => `-x "${p}"`).join(' ');
  const includeArgs = INCLUDE.map((p) => `"${p}"`).join(' ');
  execSync(`zip -r "${outName}" ${includeArgs} ${excludeArgs}`, { cwd: ROOT, stdio: 'inherit' });

  const zipHits = scanZipNamelist(outPath);
  if (zipHits.length) {
    fs.unlinkSync(outPath);
    console.error('打出来的 zip 含密钥文件，已删除：');
    for (const f of zipHits) console.error(`  - ${f.file}: ${f.reason}`);
    process.exit(1);
  }
  const listing = execSync(`unzip -Z1 "${outPath}"`, { encoding: 'utf8' });
  if (/(^|\/)cloudbaserc\.json$|(^|\/)web\/\.env$|cloudfunctions\/[^/\n]+\/config\.json/.test(listing)) {
    fs.unlinkSync(outPath);
    console.error('zip 目录校验失败，已删除');
    process.exit(1);
  }
  console.log(`\n发布包: ${outPath}`);
  console.log('已排除 cloudbaserc.json / 云函数 config.json / web/.env');
}

main();
