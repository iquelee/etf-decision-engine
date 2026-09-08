'use strict';
/**
 * Deploy Gen-1 capability / domain-coverage metadata only.
 *
 * Updates:
 * - runGen1ShadowEod: persists category coverage + domain status with EOD rows
 * - apiGateway: exposes immutable capability / applicability metadata to UI
 *
 * Does not call runDecisionEngine or mutate any strategy/model/threshold.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function main() {
  const CloudBase = require('@cloudbase/manager-node');
  const Tcb = CloudBase.default || CloudBase;
  const root = path.join(__dirname, '..');
  const authPath = process.env.TCB_AUTH_FILE || path.join(root, '.tcb-home', '.config', '.cloudbase', 'auth.json');
  if (!fs.existsSync(authPath)) throw new Error('CloudBase credential file not found');
  const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
  const credential = auth.credential || auth;
  const secretId = credential.secretId || credential.tmpSecretId;
  const secretKey = credential.secretKey || credential.tmpSecretKey;
  if (!secretId || !secretKey) throw new Error('CloudBase credential is incomplete');

  execSync('node scripts/prepare-functions.js', { cwd: root, stdio: 'inherit' });
  const distRoot = path.join(root, 'dist-functions');
  for (const name of ['runGen1ShadowEod', 'apiGateway']) {
    const commonCapability = path.join(distRoot, name, 'common', 'utils', 'gen1-capability.js');
    if (!fs.existsSync(commonCapability)) throw new Error(`${name}: capability metadata was not packed`);
  }
  const runner = fs.readFileSync(path.join(distRoot, 'runGen1ShadowEod', 'index.js'), 'utf8');
  if (!runner.includes('category_coverage') || !runner.includes('domain_status')) {
    throw new Error('runGen1ShadowEod: domain metadata missing from packed source');
  }

  const tcb = new Tcb({
    secretId,
    secretKey,
    token: credential.token,
    envId: 'tradingview-etf-d0fa42yy57cbc11b'
  });
  for (const name of ['runGen1ShadowEod', 'apiGateway']) {
    console.log(`Deploying ${name}…`);
    await tcb.functions.updateFunctionCode({
      funcName: name,
      functionRootPath: distRoot,
      func: { name, handler: 'index.main', installDependency: true }
    });
    console.log(`${name}: OK`);
  }
  console.log('Capability metadata deployment complete. EOD metadata takes effect on the next Gen-1 EOD run.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
