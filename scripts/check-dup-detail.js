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
  // 1. Count total news_feed records
  const countRes = await db.collection('news_feed').count();
  console.log(`Total news_feed count: ${countRes.total}`);

  // 2. Check for similar titles (not exact duplicates)
  const allNews = [];
  let offset = 0;
  while (true) {
    const batch = await db.collection('news_feed').skip(offset).limit(100).orderBy('publish_time', 'desc').get();
    if (!batch.data || batch.data.length === 0) break;
    allNews.push(...batch.data);
    if (batch.data.length < 100) break;
    offset += 100;
  }
  console.log(`Fetched ${allNews.length} news_feed records`);

  // 3. Group by title (ignoring code) to find cross-ETF duplicates
  const titleMap = {};
  for (const n of allNews) {
    const t = (n.title || '').trim();
    if (!t) continue;
    if (!titleMap[t]) titleMap[t] = [];
    titleMap[t].push(n);
  }

  let crossEtfDups = 0;
  for (const [title, items] of Object.entries(titleMap)) {
    const codes = [...new Set(items.map(i => i.code))];
    if (codes.length > 1 || items.length > 1) {
      crossEtfDups++;
      console.log(`\n  CROSS-ETF DUP (${items.length}x, codes=[${codes.join(',')}]): "${title.slice(0, 60)}"`);
      for (const it of items) {
        console.log(`    code=${it.code}, source=${it.source}, id=${it._id}, time=${it.publish_time ? String(it.publish_time).slice(0, 19) : '?'}`);
      }
    }
  }
  console.log(`\nCross-ETF duplicate titles: ${crossEtfDups}`);

  // 4. Check for near-duplicate titles (same first 20 chars)
  const prefixMap = {};
  for (const n of allNews) {
    const prefix = (n.title || '').trim().slice(0, 20);
    if (!prefix) continue;
    if (!prefixMap[prefix]) prefixMap[prefix] = [];
    prefixMap[prefix].push(n);
  }
  let nearDups = 0;
  for (const [prefix, items] of Object.entries(prefixMap)) {
    if (items.length > 2) {
      nearDups++;
      const codes = [...new Set(items.map(i => i.code))];
      console.log(`\n  NEAR-DUP prefix "${prefix}" x${items.length} (codes=[${codes.join(',')}])`);
      for (const it of items.slice(0, 4)) {
        console.log(`    [${it.code}] ${(it.title || '').slice(0, 70)}`);
      }
      if (items.length > 4) console.log(`    ... and ${items.length - 4} more`);
    }
  }
  console.log(`\nNear-duplicate title prefixes (>2): ${nearDups}`);

  // 5. Check what the intel API actually returns
  console.log('\n=== INTEL API SIMULATION ===');
  // Simulate getIntel: fetch news_feed limit 100, group by code
  const newsForIntel = allNews.slice(0, 100);
  const byCode = {};
  for (const n of newsForIntel) {
    if (!byCode[n.code]) byCode[n.code] = [];
    byCode[n.code].push(n);
  }
  for (const [code, items] of Object.entries(byCode)) {
    // Check for duplicates within this ETF
    const titleSet = {};
    let dups = 0;
    for (const n of items) {
      if (titleSet[n.title]) dups++;
      else titleSet[n.title] = true;
    }
    console.log(`  ${code}: ${items.length} items, ${dups} exact title duplicates`);

    // Show first 5 titles
    for (const n of items.slice(0, 5)) {
      console.log(`    [${n.source}] ${(n.title || '').slice(0, 70)}`);
    }
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
