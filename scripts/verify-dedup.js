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
  // Call the intel API through the cloud function
  const result = await app.callFunction({
    name: 'apiGateway',
    data: { path: '/api/intel', method: 'GET', query: { limit: '80' } }
  });

  const res = result.result || result;
  if (res.code !== 0 && res.code !== undefined) {
    // Try direct result
    const data = res.data || res;
    if (!data.items) {
      console.log('API response:', JSON.stringify(res).slice(0, 300));
      process.exit(1);
    }
  }

  const data = res.data || res;
  const items = data.items || [];
  console.log(`Total items: ${data.total || items.length}`);

  // Check duplicates per ETF
  const codes = ['513310', '515880', '159582', '518880', '159570'];
  for (const code of codes) {
    const etfItems = items.filter(i => (i.related || []).includes(code));
    const titles = etfItems.map(i => i.title);
    const titleSet = {};
    let dups = 0;
    for (const t of titles) {
      if (titleSet[t]) {
        dups++;
        console.log(`  [${code}] DUP: "${t.slice(0, 50)}"`);
      } else titleSet[t] = true;
    }
    console.log(`${code}: ${etfItems.length} items, ${dups} duplicates`);
  }

  // Also check overall (cross-ETF is OK, within-ETF is the issue)
  console.log('\n--- Sample items ---');
  for (const item of items.slice(0, 5)) {
    console.log(`  [${(item.related || []).join(',')}] ${item.type}: ${(item.title || '').slice(0, 60)}`);
  }

  process.exit(0);
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
