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
    envId: process.env.TCB_ENV_ID || process.env.CLOUDBASE_ENV_ID || 'YOUR_CLOUD_BASE_ENV_ID'
  });

  // Deploy from dist-functions/ (has common/ inlined)
  const distRoot = path.join(__dirname, '..', 'dist-functions');

  for (const name of ['fetchFundamentalNews', 'apiGateway']) {
    console.log(`\nDeploying ${name} from dist-functions...`);
    try {
      const result = await tcb.functions.updateFunctionCode({
        funcName: name,
        functionRootPath: distRoot,
        func: {
          name,
          handler: 'index.main',
          installDependency: true
        }
      });
      console.log(`  OK: ${JSON.stringify(result).slice(0, 200)}`);
    } catch (e) {
      console.error(`  Error: ${e.message || e}`);
    }
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
