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

async function main() {
  // Check if there are news items with status 'new'
  const db = app.database();
  const newsRes = await db.collection('news_feed').where({ status: 'new' }).limit(30).get();
  const news = newsRes.data || [];
  console.log(`News with status 'new': ${news.length}`);

  // Show news grouped by ETF code
  const byCode = {};
  for (const n of news) {
    const c = n.code || 'unknown';
    if (!byCode[c]) byCode[c] = [];
    byCode[c].push({ title: n.title, source: n.source });
  }
  for (const [code, items] of Object.entries(byCode)) {
    console.log(`\n  ${code}: ${items.length} items`);
    for (const it of items.slice(0, 3)) {
      console.log(`    - ${it.title.slice(0, 60)}`);
    }
  }

  // Check if DEEPSEEK_API_KEY is set
  const result = await app.callFunction({
    name: 'extractFundamental',
    data: { materialize_only: true, rollup_all: false }
  });
  console.log(`\nMaterialize test: ${JSON.stringify(result.result || result).slice(0, 200)}`);

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
