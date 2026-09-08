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
  const result = await app.callFunction({
    name: 'extractFundamental',
    data: { materialize_only: true, rollup_all: true }
  });
  console.log(JSON.stringify(result.result || result, null, 2));
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
