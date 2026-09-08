const cloudbase = require('@cloudbase/node-sdk');
const fs = require('fs');
const path = require('path');

const credPath = path.join(process.env.USERPROFILE, '.config', '.cloudbase', 'auth.json');
const cred = JSON.parse(fs.readFileSync(credPath, 'utf8'));
const app = cloudbase.init({
  env: 'tradingview-etf-d0fa42yy57cbc11b',
  secretId: cred.credential.secretId,
  secretKey: cred.credential.secretKey
});
const db = app.database();
const _ = db.command;

async function main() {
  // 1. Delete all fundamental_series for 518880 (force regeneration)
  const seriesRes = await db.collection('fundamental_series').where({ code: '518880' }).get();
  const seriesIds = (seriesRes.data || []).map(s => s._id);
  if (seriesIds.length > 0) {
    for (let i = 0; i < seriesIds.length; i += 20) {
      const batch = seriesIds.slice(i, i + 20);
      await db.collection('fundamental_series').where({ _id: _.in(batch) }).remove();
    }
    console.log(`Deleted ${seriesIds.length} fundamental_series entries for 518880`);
  }

  // 2. Delete all fundamental_evidence for 518880 (force clean start)
  const evRes = await db.collection('fundamental_evidence').where({ code: '518880' }).get();
  const evIds = (evRes.data || []).map(e => e._id);
  if (evIds.length > 0) {
    for (let i = 0; i < evIds.length; i += 20) {
      const batch = evIds.slice(i, i + 20);
      await db.collection('fundamental_evidence').where({ _id: _.in(batch) }).remove();
    }
    console.log(`Deleted ${evIds.length} fundamental_evidence entries for 518880`);
  }

  // 3. Also clean 159570 evidence that was incorrectly deleted earlier - remove all and let it regenerate
  const evRes2 = await db.collection('fundamental_evidence').where({ code: '159570' }).get();
  const evIds2 = (evRes2.data || []).map(e => e._id);
  if (evIds2.length > 0) {
    for (let i = 0; i < evIds2.length; i += 20) {
      const batch = evIds2.slice(i, i + 20);
      await db.collection('fundamental_evidence').where({ _id: _.in(batch) }).remove();
    }
    console.log(`Deleted ${evIds2.length} fundamental_evidence entries for 159570`);
  }

  console.log('Done. Now trigger rollup_all to regenerate.');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
