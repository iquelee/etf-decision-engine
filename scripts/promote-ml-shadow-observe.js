/**
 * 生产部署：开启 ML Shadow「观察」闸门；Fast Path 强制 OFF。
 *
 * 不改变 V3.6.1 仓位。仅写入 param_config 观察开关。
 *
 *   node scripts/promote-ml-shadow-observe.js --dry-run
 *   node scripts/promote-ml-shadow-observe.js
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
  ml_shadow_observe: true,
  ml_fast_path_enabled: false,
  ml_challenger_model_id: 'HVT-A-ET-20260830',
  ml_shadow_bundle_id: 'shadow-bundle-v1',
  ml_gen1_frozen: true,
  config_version: '2026-08-30-ml-shadow-observe'
};

const DESCS = {
  ml_shadow_observe: 'true → 允许 Shadow 观察元数据；不改仓位',
  ml_fast_path_enabled: 'false 强制：Gen-1 Fast Path 未接线',
  ml_challenger_model_id: '冻结 Gen-1 模型 ID',
  ml_shadow_bundle_id: 'shadow-bundle-v1',
  ml_gen1_frozen: 'true → Gen-1 禁止热更新',
  config_version: 'ML Shadow 观察部署戳'
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
    category: 'ML-Shadow观察',
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

  console.log('=== ML Shadow Observe 部署（Fast Path OFF）===');
  console.log(DRY ? '模式: dry-run' : '模式: WRITE');
  console.log('将写入:', KEYS);

  if (DRY) return;

  for (const [k, v] of Object.entries(KEYS)) {
    const op = await upsertParam(db, k, v, DESCS[k]);
    console.log(`  ${op} ${k}=${JSON.stringify(v)}`);
  }

  console.log('\n=== 触发 runDecisionEngine（刷新元数据，不启用 Fast Path）===');
  const fn = await app.callFunction({
    name: 'runDecisionEngine',
    data: { trigger: 'promote-ml-shadow-observe', reason: 'shadow-observe-only' }
  });
  console.log('  result:', JSON.stringify(fn.result || fn).slice(0, 800));

  console.log('\n完成。');
  console.log('  Production Core = V3.6.1');
  console.log('  ML Fast Path    = OFF');
  console.log('  ML Shadow       = OBSERVE');
  console.log('日终: bash scripts/ops/run-shadow-eod.sh [YYYY-MM-DD]');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
