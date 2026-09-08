const fs = require('fs');
const path = require('path');

async function main() {
  const CloudBase = await import('@cloudbase/manager-node');
  const Tcb = CloudBase.default || CloudBase;

  const credPath = path.join(process.env.USERPROFILE, '.config', '.cloudbase', 'auth.json');
  const cred = JSON.parse(fs.readFileSync(credPath, 'utf8'));

  const tcb = new Tcb({
    secretId: cred.credential.secretId,
    secretKey: cred.credential.secretKey,
    envId: 'tradingview-etf-d0fa42yy57cbc11b'
  });

  // List all methods on functions
  const fnProto = Object.getPrototypeOf(tcb.functions);
  console.log('functions methods:', Object.getOwnPropertyNames(fnProto));

  // Also check top-level methods
  const tcbProto = Object.getPrototypeOf(tcb);
  console.log('tcb methods:', Object.getOwnPropertyNames(tcbProto));

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
