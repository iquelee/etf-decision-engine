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

/**
 * GitHub 令牌形态检测。
 *
 * 覆盖 `ghp_`（经典 PAT）/ `gho_`（OAuth）/ `ghu_`（用户）/ `ghs_`（应用/服务）/
 * `ghr_`（refresh）/ `github_pat_`（仓库限定细粒度）。
 *
 * 长度取 GitHub 官方 secret scanning 的口径（体 36+；细粒度 22+）；并**排除占位符体**
 * （全同字符、`x`/下划线填充）——否则文档里的示例 `ghp_xxxx…` 会把发布门禁打成假红。
 *
 * 为什么必须单独查：本仓库原有检查只认 `FRED_API_KEY` / `DEEPSEEK_API_KEY` /
 * `TUSHARE_TOKEN` / `OPENDART_API_KEY` / `sk-` / 通用 `api_key`，**GitHub 令牌形态完全
 * 不在覆盖内**（2026-09-15 PAT 审计发现）。本函数是 Stage E 门禁与 `pack-source.js`
 * 打包过滤的共同依赖。
 */
const GITHUB_TOKEN_RE_SRC = '\\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255})\\b';

function isPlaceholderTokenBody(body) {
  const b = String(body || '');
  if (!b) return true;
  if (/^(.)\1*$/.test(b)) return true;          // 全同字符（aaaa… / AAAA…）
  if (/^[xX_]+$/.test(b)) return true;          // x 或下划线填充
  if (/^x+_/i.test(b)) return true;             // 细粒度文档示例 xxxx_…
  return false;
}

function githubTokenHits(text) {
  const hits = [];
  const re = new RegExp(GITHUB_TOKEN_RE_SRC, 'g');
  let m;
  while ((m = re.exec(text))) {
    const raw = m[0];
    const body = raw.slice(raw.indexOf('_') + 1);
    if (isPlaceholderTokenBody(body)) continue;
    hits.push({
      key: 'GITHUB_TOKEN',
      preview: `疑似 GitHub 令牌（${raw.slice(0, raw.indexOf('_') + 1)}…，${raw.length} 字符）`
    });
  }
  return hits;
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
  for (const h of githubTokenHits(text)) hits.push(h);
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
  githubTokenHits,
  isPlaceholderTokenBody,
  scanPaths,
  scanZipNamelist
};
