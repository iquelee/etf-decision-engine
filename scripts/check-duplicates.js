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

async function main() {
  // 1. Check news_feed for duplicates
  console.log('=== NEWS_FEED DUPLICATE ANALYSIS ===');
  const newsRes = await db.collection('news_feed').limit(200).get();
  const news = newsRes.data || [];
  console.log(`Total news_feed records: ${news.length}`);

  // Group by title+code to find duplicates
  const titleCodeMap = {};
  for (const n of news) {
    const key = `${n.code}|||${n.title}`;
    if (!titleCodeMap[key]) titleCodeMap[key] = [];
    titleCodeMap[key].push(n);
  }

  let dupCount = 0;
  let dupGroups = 0;
  for (const [key, items] of Object.entries(titleCodeMap)) {
    if (items.length > 1) {
      dupGroups += 1;
      dupCount += items.length;
      const [code, title] = key.split('|||');
      console.log(`\n  DUP [${code}] "${(title || '').slice(0, 50)}" x${items.length}`);
      for (const it of items) {
        console.log(`    id=${it._id}, source=${it.source}, time=${it.publish_time ? String(it.publish_time).slice(0, 19) : '?'}, news_code=${it.news_code || 'N/A'}`);
      }
    }
  }
  console.log(`\nDuplicate groups: ${dupGroups}, duplicate records: ${dupCount} (out of ${news.length} total)`);

  // 2. Check news_feed by source
  console.log('\n=== NEWS_FEED BY SOURCE ===');
  const bySource = {};
  for (const n of news) {
    const s = n.source || 'unknown';
    if (!bySource[s]) bySource[s] = 0;
    bySource[s]++;
  }
  for (const [s, c] of Object.entries(bySource)) {
    console.log(`  ${s}: ${c}`);
  }

  // 3. Check news_feed by news_code duplicates (fast news)
  console.log('\n=== FAST NEWS news_code ANALYSIS ===');
  const fastNews = news.filter(n => n.source === 'eastmoney_fastnews');
  console.log(`Fast news total: ${fastNews.length}`);
  const ncMap = {};
  for (const n of fastNews) {
    const nc = n.news_code || 'N/A';
    if (!ncMap[nc]) ncMap[nc] = [];
    ncMap[nc].push(n);
  }
  let fastDupGroups = 0;
  for (const [nc, items] of Object.entries(ncMap)) {
    if (items.length > 1) {
      fastDupGroups++;
      console.log(`  news_code="${nc}" x${items.length}: titles="${items[0].title.slice(0, 40)}"`);
    }
  }
  console.log(`Fast news duplicate groups: ${fastDupGroups}`);

  // 4. Check GLOBAL_FINANCIAL duplicates
  console.log('\n=== GLOBAL_FINANCIAL DUPLICATE ANALYSIS ===');
  const finRes = await db.collection('global_financial').limit(100).get();
  const fins = finRes.data || [];
  console.log(`Total global_financial records: ${fins.length}`);
  const finMap = {};
  for (const f of fins) {
    const key = `${f.symbol}|||${f.period_end}`;
    if (!finMap[key]) finMap[key] = [];
    finMap[key].push(f);
  }
  let finDup = 0;
  for (const [key, items] of Object.entries(finMap)) {
    if (items.length > 1) {
      finDup++;
      console.log(`  DUP ${key} x${items.length}`);
    }
  }
  console.log(`Financial duplicate groups: ${finDup}`);

  // 5. Check fundamental_series duplicates
  console.log('\n=== FUNDAMENTAL_SERIES DUPLICATE ANALYSIS ===');
  const seriesRes = await db.collection('fundamental_series').limit(200).get();
  const series = seriesRes.data || [];
  console.log(`Total fundamental_series records: ${series.length}`);
  const seriesMap = {};
  for (const s of series) {
    const key = `${s.code}|||${s.indicator}|||${s.data_date || s.week_date || ''}`;
    if (!seriesMap[key]) seriesMap[key] = [];
    seriesMap[key].push(s);
  }
  let seriesDup = 0;
  for (const [key, items] of Object.entries(seriesMap)) {
    if (items.length > 1) {
      seriesDup++;
      const [code, ind, date] = key.split('|||');
      console.log(`  DUP ${code}/${ind}/${date} x${items.length}`);
    }
  }
  console.log(`Series duplicate groups: ${seriesDup}`);

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
