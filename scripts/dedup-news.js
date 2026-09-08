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
  // Fetch all news_feed records
  const allNews = [];
  let offset = 0;
  while (true) {
    const batch = await db.collection('news_feed').skip(offset).limit(100).get();
    if (!batch.data || batch.data.length === 0) break;
    allNews.push(...batch.data);
    if (batch.data.length < 100) break;
    offset += 100;
  }
  console.log(`Total news_feed records: ${allNews.length}`);

  // Group by code+title to find duplicates
  const groups = {};
  for (const n of allNews) {
    const key = `${n.code}|||${n.title}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(n);
  }

  // Collect IDs to delete (keep first, delete rest)
  const idsToDelete = [];
  let dupGroups = 0;
  for (const [key, items] of Object.entries(groups)) {
    if (items.length > 1) {
      dupGroups++;
      // Keep the first (oldest by created_at or _id), delete the rest
      items.sort((a, b) => {
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
        return ta - tb;
      });
      for (let i = 1; i < items.length; i++) {
        idsToDelete.push(items[i]._id);
      }
    }
  }
  console.log(`Duplicate groups: ${dupGroups}, records to delete: ${idsToDelete.length}`);

  // Delete in batches of 20
  let deleted = 0;
  for (let i = 0; i < idsToDelete.length; i += 20) {
    const batch = idsToDelete.slice(i, i + 20);
    try {
      await db.collection('news_feed').where({ _id: _.in(batch) }).remove();
      deleted += batch.length;
      console.log(`  Deleted batch ${i / 20 + 1}: ${batch.length} (total: ${deleted})`);
    } catch (e) {
      console.error(`  Batch delete error: ${e.message}`);
    }
  }
  console.log(`Done. Deleted ${deleted} duplicate records.`);

  // Verify
  const countRes = await db.collection('news_feed').count();
  console.log(`Remaining news_feed count: ${countRes.total}`);

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
