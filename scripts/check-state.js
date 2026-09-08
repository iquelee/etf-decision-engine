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
  // 1. Check evidence for all ETFs
  console.log('=== FUNDAMENTAL_EVIDENCE ===');
  const codes = ['513310', '515880', '159582', '518880', '159570'];
  for (const code of codes) {
    const res = await db.collection('fundamental_evidence').where({ code }).get();
    const ev = res.data || [];
    console.log(`\n${code}: ${ev.length} entries`);
    const byIndicator = {};
    for (const e of ev) {
      if (!byIndicator[e.indicator]) byIndicator[e.indicator] = [];
      byIndicator[e.indicator].push({
        stock: e.stock_name,
        stockCode: e.stock_code,
        signal: e.signal_type,
        source: e.source
      });
    }
    for (const [ind, items] of Object.entries(byIndicator)) {
      const stocks = [...new Set(items.map(i => `${i.stock || '?'}:${i.stockCode || '?'}`))];
      console.log(`  ${ind}: ${items.length} entries, stocks=[${stocks.join(', ')}]`);
    }
  }

  // 2. Check fundamental_series for all ETFs
  console.log('\n=== FUNDAMENTAL_SERIES ===');
  for (const code of codes) {
    const res = await db.collection('fundamental_series').where({ code }).get();
    const series = res.data || [];
    console.log(`\n${code}: ${series.length} entries`);
    for (const s of series) {
      const note = (s.note || '').slice(0, 100);
      console.log(`  ${s.indicator}: val=${s.value}, note=[${note}]`);
    }
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
