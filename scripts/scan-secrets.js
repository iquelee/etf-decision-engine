/**
 * 发布前敏感文件检查。本地 cloudbaserc.json / config.json / web/.env 可以留真实值，
 * 但不得打进 zip、不得出现在将要分发的文件列表里。
 *
 * 运行：node scripts/scan-secrets.js [路径…]
 * 无参数：扫描将要打包的候选文件（已排除密钥文件本身）。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const SECRET_FILES = [
  'cloudbaserc.json',
  'web/.env',
  'web/.env.local'
];

const SKIP_DIR = new Set([
  'node_modules', 'dist', 'dist-functions', '.git', '.workbuddy', '.obsidian',
  'etf-decision-engine-source-2026-08-16-v211', '源码', 'V2.1.1调整建议'
]);

/** 占位符或空值不算泄露 */
function isPlaceholder(value) {
  const v = String(value || '').trim();
  if (!v) return true;
  if (/^\{\{[A-Z0-9_]+\}\}$/.test(v)) return true;
  if (/^(YOUR_|CHANGE_ME)/i.test(v)) return true;
  if (/^https:\/\/\{\{APP_DOMAIN\}\}/.test(v)) return true;
  return false;
}

function looksLikeSecretAssignment(text) {
  const hits = [];
  const named = /(?:^|[\s,{;])["']?(FRED_API_KEY|DEEPSEEK_API_KEY|TUSHARE_TOKEN|OPENDART_API_KEY)["']?\s*[:=]\s*(?:"([^"]*)"|'([^']*)'|([^\s,;]+))/gm;
  let m;
  while ((m = named.exec(text))) {
    const value = m[2] != null ? m[2] : (m[3] != null ? m[3] : m[4]);
    if (!isPlaceholder(value)) hits.push({ key: m[1], preview: `${m[1]} 不是占位符` });
  }
  const generic = /(?:^|[\s,{;])["']?(?:api_key|API_KEY)["']?\s*[:=]\s*["']([^"']{16,})["']/gm;
  while ((m = generic.exec(text))) {
    if (!isPlaceholder(m[1])) hits.push({ key: 'API_KEY', preview: '疑似通用 api_key 赋值' });
  }
  if (/\bsk-[a-zA-Z0-9]{16,}\b/.test(text)) {
    hits.push({ key: 'DEEPSEEK_LIKE', preview: '疑似 sk- 密钥' });
  }
  return hits;
}

function isSecretRel(rel) {
  const n = rel.replace(/\\/g, '/');
  if (SECRET_FILES.indexOf(n) >= 0) return true;
  if (/^cloudfunctions\/[^/]+\/config\.json$/.test(n)) return true;
  return false;
}

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue;
    if (name.endsWith('.zip')) continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
}

function toRel(abs) {
  return path.relative(ROOT, abs).replace(/\\/g, '/');
}

function scanPaths(absPaths) {
  const findings = [];
  for (const abs of absPaths) {
    const rel = toRel(abs);
    if (isSecretRel(rel)) {
      findings.push({ file: rel, reason: '密钥/本地配置文件，禁止打进发布包' });
      continue;
    }
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
    const ext = path.extname(abs);
    if (['.png', '.jpg', '.jpeg', '.gif', '.woff', '.woff2',
      '.joblib', '.pkl', '.pickle', '.npy', '.npz', '.parquet', '.bin', '.pt', '.pth', '.h5'].indexOf(ext) >= 0) continue;
    const text = fs.readFileSync(abs, 'utf8');
    for (const hit of looksLikeSecretAssignment(text)) {
      findings.push({ file: rel, reason: hit.preview });
    }
  }
  return findings;
}

function defaultPackCandidates() {
  const files = [];
  walk(ROOT, files);
  return files.filter((abs) => !isSecretRel(toRel(abs)));
}

function scanZipNamelist(zipPath) {
  const { execSync } = require('child_process');
  const listing = execSync(`unzip -Z1 "${zipPath}"`, { encoding: 'utf8' });
  const names = listing.split('\n').map((s) => s.trim()).filter(Boolean);
  const findings = [];
  for (const name of names) {
    const rel = name.replace(/^[^/]+\//, '');
    if (isSecretRel(name) || isSecretRel(rel)) {
      findings.push({ file: name, reason: 'zip 内含密钥/本地配置文件' });
    }
  }
  return findings;
}

function main() {
  const args = process.argv.slice(2);
  let findings;
  if (args.length === 1 && args[0].endsWith('.zip') && fs.existsSync(args[0])) {
    findings = scanZipNamelist(path.resolve(args[0]));
  } else if (args.length) {
    findings = scanPaths(args.map((a) => path.resolve(a)));
  } else {
    findings = scanPaths(defaultPackCandidates());
  }
  if (findings.length) {
    console.error('敏感检查未通过：');
    for (const f of findings) console.error(`  - ${f.file}: ${f.reason}`);
    process.exit(1);
  }
  console.log('敏感检查通过（待打包文件无明文密钥）');
}

if (require.main === module) main();

module.exports = {
  isPlaceholder,
  isSecretRel,
  looksLikeSecretAssignment,
  scanPaths,
  scanZipNamelist
};
