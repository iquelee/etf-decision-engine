/**
 * 部署准备脚本（零依赖）：把 cloudfunctions/common 共享模块内联进每个云函数目录
 *
 * 背景：CloudBase CLI 部署单个函数目录时，只会打包该目录内容，
 *      云函数源码里的 `require('../common/...')` 引用上级目录在云端不存在，
 *      运行时报 `Cannot find module '../common/constants'`，6 函数必崩。
 *
 * 方案：本脚本遍历 6 个函数目录，把 `cloudfunctions/common/` 复制进每个函数目录
 *      为 `<fn>/common/`，并把 index.js 里的 `require('../common/` 替换为
 *      `require('./common/`，输出到 `dist-functions/`（不改动 cloudfunctions/ 源码）。
 *
 * 部署流程（务必按序）：
 *   1. node scripts/prepare-functions.js        # 生成 dist-functions/
 *   2. tcb fn deploy fetchDailyData --dir dist-functions/fetchDailyData
 *      tcb fn deploy fetchRealtimeData --dir dist-functions/fetchRealtimeData
 *      tcb fn deploy materializeIndicators --dir dist-functions/materializeIndicators
 *      tcb fn deploy runDecisionEngine --dir dist-functions/runDecisionEngine
 *      tcb fn deploy apiGateway --dir dist-functions/apiGateway
 *      tcb fn deploy adminGateway --dir dist-functions/adminGateway
 *   3. 部署完成后可删除 dist-functions/
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC_FUNCTIONS = path.join(ROOT, 'cloudfunctions');
const COMMON_DIR = path.join(SRC_FUNCTIONS, 'common');
const DIST_DIR = path.join(ROOT, 'dist-functions');

/** 云函数目录名（与 cloudbaserc.json functions 一致） */
const FUNCTIONS = [
  'fetchDailyData',
  'fetchRealtimeData',
  'materializeIndicators',
  'runDecisionEngine',
  'runGen1ShadowEod',
  'apiGateway',
  'adminGateway',
  'fetchFundamentalNews',
  'extractFundamental'
];

/**
 * 递归复制目录（排除 common 目录自身的 package.json，避免与函数依赖声明混淆）。
 * @param {string} src
 * @param {string} dest
 * @param {Function} [exclude] 返回 true 则跳过该文件
 */
function copyDir(src, dest, exclude) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (exclude && exclude(entry.name, s)) continue;
    if (entry.isDirectory()) copyDir(s, d, exclude);
    else fs.copyFileSync(s, d);
  }
}

/** 处理单个函数 */
function prepareFunction(fn) {
  const srcFn = path.join(SRC_FUNCTIONS, fn);
  const distFn = path.join(DIST_DIR, fn);
  fs.mkdirSync(distFn, { recursive: true });

  // 1. 复制函数自身文件及冻结运行时工件。模型 JSON 必须随函数一起部署，
  //    否则云端 require 会找不到 frozen-manifest / frozen-model。
  for (const f of ['index.js', 'config.json', 'package.json', 'frozen-manifest.json', 'frozen-model.json', 'frozen-node-inference.js']) {
    const sf = path.join(srcFn, f);
    if (fs.existsSync(sf)) fs.copyFileSync(sf, path.join(distFn, f));
  }

  // 2. 复制 common 共享模块到 <fn>/common/（排除 common/package.json）
  copyDir(COMMON_DIR, path.join(distFn, 'common'), (name) => name === 'package.json');

  // 3. 替换 index.js 中的 require('../common/ → require('./common/
  const indexFile = path.join(distFn, 'index.js');
  if (fs.existsSync(indexFile)) {
    let content = fs.readFileSync(indexFile, 'utf8');
    const replaced = (content.match(/\.\.\/common\//g) || []).length;
    content = content.replace(/\.\.\/common\//g, './common/');
    fs.writeFileSync(indexFile, content);
    console.log(`  ✅ ${fn} → dist-functions/${fn}/（替换 ${replaced} 处 require 路径）`);
  } else {
    console.warn(`  ⚠️  ${fn} 缺少 index.js，跳过`);
  }
}

function main() {
  console.log(`\n=== 生成云函数部署目录（dist-functions/）===\n`);
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(DIST_DIR, { recursive: true });

  FUNCTIONS.forEach(prepareFunction);

  console.log('\n✅ 部署目录已生成：dist-functions/');
  console.log('\n部署命令（在项目根目录执行）：');
  FUNCTIONS.forEach((fn) => {
    console.log(`  tcb fn deploy ${fn} --dir dist-functions/${fn}`);
  });
  console.log('');
}

main();
