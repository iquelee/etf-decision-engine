'use strict';
/**
 * Deploy apiGateway with Chinese action_label force-resolve.
 * Uses functionPath (same pattern as deploy-adminGateway-fix.js).
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

  require('child_process').execSync('node scripts/prepare-functions.js', {
    cwd: root,
    stdio: 'inherit'
  });

  const envId = 'tradingview-etf-d0fa42yy57cbc11b';
  const tcb = new Tcb({
    secretId: cred.secretId,
    secretKey: cred.secretKey,
    token: cred.token,
    envId
  });

  const name = 'apiGateway';
  const functionPath = path.join(root, 'dist-functions', name);
  const packedIndex = fs.readFileSync(path.join(functionPath, 'index.js'), 'utf8');
  if (!packedIndex.includes('resolveActionLabel') || !packedIndex.includes('withChineseActionLabel')) {
    throw new Error('dist apiGateway missing resolveActionLabel / withChineseActionLabel');
  }
  const packedDecision = fs.readFileSync(
    path.join(functionPath, 'common', 'utils', 'decision.js'),
    'utf8'
  );
  if (!packedDecision.includes('通过（8 项全过）') || !packedDecision.includes('拦截（')) {
    throw new Error('dist decision.js missing Chinese gate labels');
  }

  console.log('Deploying', name, 'via functionPath', functionPath);
  const result = await tcb.functions.updateFunctionCode({
    functionPath,
    func: {
      name,
      handler: 'index.main',
      runtime: 'Nodejs16.13',
      installDependency: true,
      isWaitInstall: true
    }
  });
  console.log('update OK', JSON.stringify(result).slice(0, 400));

  if (typeof tcb.functions.waitFunctionActive === 'function') {
    console.log('waiting Active…');
    await tcb.functions.waitFunctionActive(name);
  } else {
    await new Promise((r) => setTimeout(r, 8000));
  }
  console.log('apiGateway deploy done');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
