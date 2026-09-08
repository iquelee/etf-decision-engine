#!/usr/bin/env node
/**
 * P0-01 构建脚本：从 cloudfunctions/<fn> 源码 + src/common canonical 生成 dist-functions/<fn>。
 *
 * 职责（任务书 WP1）：
 *   1. 复制每个云函数自身源码（index.js / package.json / frozen artifacts）
 *   2. 从 src/common/ 复制 canonical common
 *   3. 生成 SHA256 manifest
 *   4. duplicate parity validation（同名文件在所有函数中 SHA 一致）
 *
 * 不负责 node_modules / config.json（由 prepare-deploy.py 从 zip 快照恢复）。
 *
 * 用法：node scripts/build-cloudfunctions.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..');
const SRC_COMMON = path.join(REPO, 'src', 'common');
const CF_DIR = path.join(REPO, 'cloudfunctions');
const DIST = path.join(REPO, 'dist-functions');

// 线上 10 个函数（与 MCP listFunctions / prepare-deploy.py 一致）
const FUNCTIONS = [
  'runGen2ShadowEod', 'runGen1ShadowEod', 'runDecisionEngine',
  'adminGateway', 'apiGateway', 'extractFundamental',
  'fetchDailyData', 'fetchFundamentalNews', 'fetchRealtimeData',
  'materializeIndicators',
];

// 不复制到 dist 的顶层条目（common 由 src/common 统一供给；MANIFEST 是 build 产物）
const SKIP_TOP = new Set(['common', 'MANIFEST.json', 'node_modules']);

// 额外复制到 dist 的文件（相对 REPO）。Gen-2 Rule V2 bundle 是 Node/Python 共用单一真相源。
const EXTRA_FILES = {
  runGen2ShadowEod: ['ml/gen2/manifests/GEN2_RULE_V2_BUNDLE.json'],
};

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function copyFile(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

function copyDir(srcDir, dstDir) {
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(srcDir, e.name);
    const d = path.join(dstDir, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else copyFile(s, d);
  }
}

function main() {
  fs.mkdirSync(DIST, { recursive: true });

  // 收集 src/common 的 canonical SHA（用于 parity 校验）
  const canonical = {}; // rel -> sha
  (function walk(dir, rel) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(p, r);
      else if (e.name !== 'MANIFEST.json') {
        canonical[r] = sha256(fs.readFileSync(p));
      }
    }
  })(SRC_COMMON, '');

  const manifest = {};       // fn -> { files: {rel: sha}, common_sha }
  const perFileSha = {};     // rel -> { fn: sha }（parity 校验用）

  for (const fn of FUNCTIONS) {
    const out = path.join(DIST, fn);
    fs.mkdirSync(out, { recursive: true });

    // 1) 函数自身源码（排除 common / MANIFEST / node_modules）
    const srcFn = path.join(CF_DIR, fn);
    for (const e of fs.readdirSync(srcFn, { withFileTypes: true })) {
      if (SKIP_TOP.has(e.name)) continue;
      const s = path.join(srcFn, e.name);
      const d = path.join(out, e.name);
      if (e.isDirectory()) copyDir(s, d);
      else copyFile(s, d);
    }

    // 2) canonical common（覆盖式，不整目录删除避免安全守卫）
    copyDir(SRC_COMMON, path.join(out, 'common'));

    // 2.5) 额外文件（如 Gen-2 Rule V2 bundle，Node 运行时读取）
    for (const rel of EXTRA_FILES[fn] || []) {
      copyFile(path.join(REPO, rel), path.join(out, path.basename(rel)));
    }

    // 3) manifest：记录 common 各文件 SHA
    const fnFiles = {};
    (function walkCommon(dir, rel) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walkCommon(p, r);
        else {
          const h = sha256(fs.readFileSync(p));
          fnFiles[r] = h;
          perFileSha[r] = perFileSha[r] || {};
          perFileSha[r][fn] = h;
        }
      }
    })(path.join(out, 'common'), '');

    manifest[fn] = { files: fnFiles };
    console.log(`[build] ${fn}: ${Object.keys(fnFiles).length} 个 common 文件`);
  }

  // 4) parity validation：同名 common 文件跨函数 SHA 必须一致
  let parityFail = 0;
  for (const [rel, shas] of Object.entries(perFileSha)) {
    const unique = new Set(Object.values(shas));
    if (unique.size > 1) {
      parityFail++;
      console.error(`[PARITY FAIL] ${rel}:`);
      for (const [fn, h] of Object.entries(shas)) console.error(`    ${fn}: ${h}`);
    }
    // 与 src/common canonical 比对
    if (canonical[rel] && unique.has(canonical[rel]) === false) {
      parityFail++;
      console.error(`[PARITY FAIL] ${rel}: 与 src/common 不一致`);
    }
  }

  // 5) 生成 build manifest
  const manifestOut = {
    generated: 'build-cloudfunctions.js',
    canonical_common_sha: sha256(JSON.stringify(canonical, null, 0)),
    functions: manifest,
  };
  fs.writeFileSync(
    path.join(DIST, 'BUILD-MANIFEST.json'),
    JSON.stringify(manifestOut, null, 2)
  );

  if (parityFail) {
    console.error(`\n[FAIL] parity 校验发现 ${parityFail} 处不一致`);
    process.exit(1);
  }
  console.log('\n[OK] 构建完成，全部函数 common 文件 SHA 一致（parity PASS）');
}

main();
