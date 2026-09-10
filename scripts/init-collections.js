/**
 * 初始化脚本：按 common/schema.js（单点真相）建集合 + 索引 + 权限说明。
 *
 * 用法：
 *   TCB_ENV=<你的环境ID> node init-collections.js
 *   （或） node init-collections.js <你的环境ID>
 *
 * 说明：
 * - 集合创建用 @cloudbase/node-sdk createCollection（已存在则跳过）；
 * - 索引：若本地装有 @cloudbase/cli（tcb），自动执行 tcb createIndex；
 *   否则打印待执行的 CLI 命令，供手动执行；
 * - 权限：CloudBase 默认「仅创建者可读写」（安全规则预设），单用户系统无需额外改动，
 *   脚本会输出确认提示。
 *
 * WP-G1.3 G1.3-10：源码真相源已收敛到 `src/common/`（P0-01），
 * 本脚本此前仍 require 旧的 `cloudfunctions/common/schema.js`（已不存在）→ 直接报错。
 * 现改为 require `src/common/schema.js`；集合清单由 SCHEMAS 驱动，
 * 并由 tests/schema-collections-parity.test.js 守卫 constants ↔ SCHEMAS 一一对应。
 */

'use strict';

const path = require('path');
const { execSync } = require('child_process');
const cloudbase = require('@cloudbase/node-sdk');

const { SCHEMAS, getCollectionNames } = require(path.join(__dirname, '..', 'src', 'common', 'schema.js'));

const envId = process.env.TCB_ENV || process.argv[2] || null;

if (!envId) {
  console.error('❌ 缺少环境 ID。用法：TCB_ENV=<envId> node init-collections.js 或 node init-collections.js <envId>');
  process.exit(1);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function createCollection(app, name) {
  const db = app.database();
  try {
    await db.createCollection(name);
    console.log(`  ✅ 集合 ${name} 已创建`);
    return true;
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    if (msg.indexOf('已存在') >= 0 || msg.indexOf('already exist') >= 0 || msg.indexOf('exist') >= 0) {
      console.log(`  ⏭️  集合 ${name} 已存在，跳过`);
      return false;
    }
    console.warn(`  ⚠️  集合 ${name} 创建异常：${msg}`);
    return false;
  }
}

/** 将 schema 索引转换为 tcb CLI createIndex 参数 */
function indexToCliArgs(index) {
  const keys = index.keys.map((k) => `${k.field}:${k.direction === 'desc' ? -1 : 1}`).join(',');
  return `${index.name} "${keys}"${index.unique ? ' --unique' : ''}`;
}

function tryCreateIndexes(collection) {
  const commands = [];
  (collection.indexes || []).forEach((idx) => {
    commands.push(`tcb db createIndex ${collection.name} ${indexToCliArgs(idx)} --envId ${envId}`);
  });
  return commands;
}

async function main() {
  console.log(`\n=== ETF 决策系统：初始化集合（envId=${envId}）===\n`);
  const app = cloudbase.init({ env: envId });

  // 1. 建集合
  console.log('1/3 创建集合：');
  for (const schema of SCHEMAS) {
    await createCollection(app, schema.name);
    await sleep(300); // 节流，避免触发频率限制
  }

  // 2. 建索引
  console.log('\n2/3 创建索引：');
  const allIndexCommands = [];
  SCHEMAS.forEach((s) => {
    allIndexCommands.push(...tryCreateIndexes(s));
  });

  let cliAvailable = false;
  try {
    execSync('tcb --version', { stdio: 'ignore' });
    cliAvailable = true;
  } catch (e) {
    cliAvailable = false;
  }

  if (cliAvailable) {
    let okCount = 0;
    let failCount = 0;
    for (const cmd of allIndexCommands) {
      try {
        execSync(cmd, { stdio: 'pipe' });
        console.log(`  ✅ ${cmd.split(' ').slice(0, 5).join(' ')}`);
        okCount += 1;
        // 索引创建有频率限制，逐条慢速执行
        await sleep(500);
      } catch (e) {
        failCount += 1;
        console.warn(`  ⚠️  索引命令执行失败（可能已存在）：${cmd}`);
      }
    }
    console.log(`  索引创建完成：成功 ${okCount}，跳过/失败 ${failCount}`);
  } else {
    console.log('  未检测到 tcb CLI，请手动依次执行以下命令（或安装 @cloudbase/cli）：');
    allIndexCommands.forEach((cmd) => console.log(`    ${cmd}`));
  }

  // 3. 权限说明
  console.log('\n3/3 权限：');
  console.log('  CloudBase 数据库默认权限为「仅创建者可读写」，符合单用户系统要求，无需额外改动。');
  console.log('  如已改动，请在控制台将以下集合权限设为「仅创建者可读写」：');
  console.log('  ' + getCollectionNames().join(', '));

  console.log('\n✅ 集合初始化完成。');
}

main().catch((e) => {
  console.error('❌ 初始化失败：', e);
  process.exit(1);
});
