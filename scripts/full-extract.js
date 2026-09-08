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
  // 1. Trigger rollup_all first
  console.log('=== Triggering rollup_all ===');
  const rollupResult = await app.callFunction({
    name: 'extractFundamental',
    data: { materialize_only: true, rollup_all: true }
  });
  console.log('Rollup result:', JSON.stringify(rollupResult.result || rollupResult).slice(0, 300));
  
  // 2. Now trigger full extraction (needs DEEPSEEK_API_KEY in cloud env)
  console.log('\n=== Triggering full extraction ===');
  try {
    const extractResult = await app.callFunction({
      name: 'extractFundamental',
      data: {}  // No special params = full extraction
    });
    const result = extractResult.result || extractResult;
    console.log('Extract result:', JSON.stringify(result).slice(0, 500));
    
    // 3. If extraction succeeded, trigger rollup_all again to materialize new evidence
    if (result && result.ok) {
      console.log('\n=== Triggering rollup_all after extraction ===');
      const rollupResult2 = await app.callFunction({
        name: 'extractFundamental',
        data: { materialize_only: true, rollup_all: true }
      });
      console.log('Rollup2 result:', JSON.stringify(rollupResult2.result || rollupResult2).slice(0, 300));
    }
  } catch (err) {
    console.log('Extraction error:', err.message || JSON.stringify(err).slice(0, 300));
  }
  
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
