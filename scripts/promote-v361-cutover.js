/**
 * 将线上 V3.6.1 shadow 切为正式引擎（代替 V3.8）
 *
 * 机制（线上已有）：
 *   trend_stage_enabled=true → mergeShadowOutputs 以 V3 为 primary，engine_version=v3.6.1
 *   V3.8 保留在 shadow_targets.v38_baseline 作对照
 *
 * 运行：node scripts/promote-v361-cutover.js
 *       node scripts/promote-v361-cutover.js --dry-run
 */
'use strict';

const fs = require('fs');
const path = require('path');
const cloudbase = require('@cloudbase/node-sdk');

const ENV_ID = 'tradingview-etf-d0fa42yy57cbc11b';
const DRY = process.argv.indexOf('--dry-run') >= 0;

function loadCred() {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const candidates = [
    path.join(home, '.config', '.cloudbase', 'auth.json'),
    path.join(__dirname, '..', '.tcb-home', '.config', '.cloudbase', 'auth.json')
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (j.credential && j.credential.secretId) return j.credential;
    }
  }
  throw new Error('未找到 CloudBase auth.json');
}

const KEYS = {
  trend_stage_enabled: true,
  v3_6_1_enabled: true,
  v3_6_1_shadow: false, // 已切流，不再标 shadow-only
  v3_shadow_enabled: true, // 仍并行输出 v38 对照
  config_version: '2026-08-29-v361-cutover',
  engine_build: 'v3.6.1'
};

async function upsertParam(db, key, value, description) {
  const col = db.collection('param_config');
  const found = await col.where({ key }).limit(1).get();
  const rows = found.data || [];
  const now = new Date().toISOString();
  const payload = {
    key,
    value: { v: value },
    description: description || key,
    category: '引擎切流',
    version: 1,
    updated_at: now
  };
  if (rows.length) {
    await col.doc(rows[0]._id).update(payload);
    return 'update';
  }
  await col.add(payload);
  return 'add';
}

async function main() {
  const cred = loadCred();
  const app = cloudbase.init({
    env: ENV_ID,
    secretId: cred.secretId,
    secretKey: cred.secretKey,
    token: cred.token
  });
  const db = app.database();

  console.log('=== 切流前 param 快照 ===');
  const before = await db.collection('param_config').where({
    key: db.command.in(Object.keys(KEYS).concat([
      'v3_6_1_s5_downside', 'v3_6_persistence', 'v3_6_2_post_s5_s4_grace', 'v3_6_3_adaptive_post_s5_grace'
    ]))
  }).limit(50).get();
  for (const r of before.data || []) {
    const v = r.value && r.value.v !== undefined ? r.value.v : r.value;
    console.log(`  ${r.key} = ${JSON.stringify(v)}`);
  }

  if (DRY) {
    console.log('\n--dry-run：不写库、不触发决策');
    console.log('将写入:', KEYS);
    return;
  }

  console.log('\n=== 写入切流参数 ===');
  const descs = {
    trend_stage_enabled: 'true → final 走 V3.6.1（代替 V3.8）',
    v3_6_1_enabled: 'V3.6.1 总闸（Persistence + S5 Downside + V3.5-D）',
    v3_6_1_shadow: 'false：已升正式，不再 shadow-only',
    v3_shadow_enabled: '仍并行输出 v38 对照到 shadow_targets',
    config_version: '切流配置版本戳',
    engine_build: '引擎构建标识'
  };
  for (const [k, v] of Object.entries(KEYS)) {
    const op = await upsertParam(db, k, v, descs[k]);
    console.log(`  ${op} ${k}=${JSON.stringify(v)}`);
  }

  console.log('\n=== 触发 runDecisionEngine ===');
  const fn = await app.callFunction({
    name: 'runDecisionEngine',
    data: { trigger: 'promote-v361-cutover', reason: 'shadow→production' }
  });
  console.log('  result:', JSON.stringify(fn.result || fn).slice(0, 500));

  console.log('\n完成。请用 dashboard 核对 v3_mode=cutover、engine_version=v3.6.1');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
