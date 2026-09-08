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
  // 1. Check current fundamental_evidence
  console.log('=== FUNDAMENTAL_EVIDENCE ===');
  const codes = ['513310', '515880', '159582', '518880', '159570'];
  for (const code of codes) {
    const res = await db.collection('fundamental_evidence').where({ code }).get();
    const ev = res.data || [];
    const byIndicator = {};
    for (const e of ev) {
      if (!byIndicator[e.indicator]) byIndicator[e.indicator] = [];
      byIndicator[e.indicator].push(e.stock_name || '?');
    }
    console.log(`\n${code}: ${ev.length} entries`);
    for (const [ind, stocks] of Object.entries(byIndicator)) {
      console.log(`  ${ind}: [${[...new Set(stocks)].join(', ')}]`);
    }
  }

  // 2. Check latest fundamental_series per ETF
  console.log('\n=== LATEST FUNDAMENTAL_SERIES ===');
  for (const code of codes) {
    const res = await db.collection('fundamental_series').where({ code }).orderBy('updatedAt', 'desc').limit(50).get();
    const series = res.data || [];
    const byIndicator = {};
    for (const s of series) {
      if (!byIndicator[s.indicator]) byIndicator[s.indicator] = s;
    }
    console.log(`\n${code} (latest per indicator):`);
    for (const [ind, s] of Object.entries(byIndicator)) {
      const note = (s.note || '').slice(0, 120);
      console.log(`  ${ind}: val=${s.value}, note=[${note}]`);
    }
  }

  // 3. Check news feed for unprocessed items
  console.log('\n=== NEWS FEED ===');
  const newsRes = await db.collection('news_feed').where({ status: 'new' }).limit(10).get();
  const news = newsRes.data || [];
  console.log(`News with status 'new': ${news.length}`);
  for (const n of news.slice(0, 5)) {
    console.log(`  [${n.code || '?'}] ${(n.title || '').slice(0, 60)}`);
  }

  // 4. Check if DEEPSEEK_API_KEY env var is set in cloud function
  // We can test by calling the function with a simple materialize_only
  console.log('\n=== TEST API KEY ===');
  try {
    const testRes = await app.callFunction({
      name: 'extractFundamental',
      data: { test_key: true }
    });
    console.log('Test result:', JSON.stringify(testRes.result || testRes).slice(0, 300));
  } catch (e) {
    console.log('Test error:', e.message || 'timeout');
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
