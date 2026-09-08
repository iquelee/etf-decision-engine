'use strict';
/**
 * Promote frozen Gen-1 to human-only Advisory Active.
 * No broker/automatic execution. Roll back with ml_advisory_enabled=false.
 *   node scripts/promote-gen1-advisory.js --dry-run
 *   node scripts/promote-gen1-advisory.js
 */
const fs = require('fs');
const path = require('path');
const cloudbase = require('@cloudbase/node-sdk');

const ENV_ID = 'tradingview-etf-d0fa42yy57cbc11b';
const DRY = process.argv.includes('--dry-run');
const KEYS = {
  ml_shadow_observe: true,
  ml_advisory_enabled: true,
  ml_fast_path_enabled: true,
  ml_execution_enabled: false,
  ml_challenger_model_id: 'HVT-A-ET-20260830',
  ml_shadow_bundle_id: 'shadow-bundle-v1',
  ml_gen1_frozen: true,
  config_version: '2026-09-01-gen1-advisory-active'
};
const DESCS = {
  ml_shadow_observe: '允许 Gen-1 EOD 信号观察',
  ml_advisory_enabled: 'Gen-1 Advisory 主建议总闸；false 一键回退 V3.6.1',
  ml_fast_path_enabled: '允许满足候选条件时显示 Gen-1 S2→S4 人工建议',
  ml_execution_enabled: '永久关闭：不接自动下单或券商写入',
  ml_challenger_model_id: '冻结 Gen-1 模型 ID',
  ml_shadow_bundle_id: 'shadow-bundle-v1',
  ml_gen1_frozen: '冻结工件，禁止热更新',
  config_version: 'Gen-1 Advisory 部署戳'
};

function loadCred() {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  for (const p of [path.join(home, '.config', '.cloudbase', 'auth.json'), path.join(__dirname, '..', '.tcb-home', '.config', '.cloudbase', 'auth.json')]) {
    if (fs.existsSync(p)) {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      const c = j.credential || j;
      if (c.secretId && c.secretKey) return c;
    }
  }
  throw new Error('未找到 CloudBase auth.json');
}

async function upsert(db, key, value) {
  const col = db.collection('param_config');
  const found = await col.where({ key }).limit(1).get();
  const old = (found.data || [])[0] || null;
  const payload = {
    key, value: { v: value },
    description: DESCS[key] || key, category: 'Gen-1-Advisory',
    version: old && Number.isFinite(Number(old.version)) ? Number(old.version) + 1 : 1,
    updated_at: new Date().toISOString()
  };
  if (DRY) return old ? 'would-update' : 'would-add';
  if (old) { await col.doc(old._id).update(payload); return 'update'; }
  await col.add(payload); return 'add';
}

async function main() {
  console.log(`=== Gen-1 Advisory Active (${DRY ? 'dry-run' : 'WRITE'}) ===`);
  const cred = loadCred();
  const app = cloudbase.init({ env: ENV_ID, secretId: cred.secretId, secretKey: cred.secretKey, token: cred.token });
  const db = app.database();
  for (const [key, value] of Object.entries(KEYS)) console.log(`${await upsert(db, key, value)} ${key}=${JSON.stringify(value)}`);
  console.log('完成：主建议引擎=gen1；风险骨架=v3.6.1；自动执行=false');
  console.log('回退：将 param_config.ml_advisory_enabled 设置为 false（无需重新部署）');
}
main().catch((e) => { console.error(e); process.exit(1); });
