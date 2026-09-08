'use strict';
/**
 * Deploy runDecisionEngine using permanent .tcb-home credentials.
 * Gen-1 Advisory is human-only; automatic/broker execution remains OFF.
 */
const path = require('path');
const fs = require('fs');

async function main() {
  const CloudBase = require('@cloudbase/manager-node');
  const Tcb = CloudBase.default || CloudBase;

  const root = path.join(__dirname, '..');
  const perm = path.join(root, '.tcb-home', '.config', '.cloudbase', 'auth.json');
  const home = path.join(process.env.HOME || '', '.config', '.cloudbase', 'auth.json');
  let cred;
  if (fs.existsSync(perm)) {
    cred = JSON.parse(fs.readFileSync(perm, 'utf8')).credential
      || JSON.parse(fs.readFileSync(perm, 'utf8'));
  } else {
    const j = JSON.parse(fs.readFileSync(home, 'utf8')).credential;
    cred = {
      secretId: j.secretId || j.tmpSecretId,
      secretKey: j.secretKey || j.tmpSecretKey,
      token: j.token || j.tmpToken
    };
  }
  if (!cred.secretId || !cred.secretKey) throw new Error('missing secretId/secretKey');

  // ensure dist packed
  require('child_process').execSync('node scripts/prepare-functions.js', {
    cwd: root,
    stdio: 'inherit'
  });

  const tcb = new Tcb({
    secretId: cred.secretId,
    secretKey: cred.secretKey,
    token: cred.token,
    envId: 'tradingview-etf-d0fa42yy57cbc11b'
  });

  const distRoot = path.join(root, 'dist-functions');
  const name = 'runDecisionEngine';
  const packed = fs.readFileSync(
    path.join(distRoot, name, 'common', 'constants.js'),
    'utf8'
  );
  if (!packed.includes('ml_shadow_observe')) {
    throw new Error('dist missing ml_shadow_observe — prepare-functions failed?');
  }

  console.log('Deploying', name, '…');
  const result = await tcb.functions.updateFunctionCode({
    funcName: name,
    functionRootPath: distRoot,
    func: {
      name,
      handler: 'index.main',
      installDependency: true
    }
  });
  console.log('OK', JSON.stringify(result).slice(0, 400));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
