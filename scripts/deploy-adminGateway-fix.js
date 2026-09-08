'use strict';
/**
 * Redeploy adminGateway with full common/utils (fixes HTTP 400 / missing admin-auth).
 */
const path = require('path');
const fs = require('fs');

async function main() {
  const CloudBase = require('@cloudbase/manager-node');
  const Tcb = CloudBase.default || CloudBase;

  const root = path.join(__dirname, '..');
  const perm = process.env.TCB_AUTH_FILE || path.join(root, '.tcb-home', '.config', '.cloudbase', 'auth.json');
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

  const configPath = path.join(root, 'cloudbaserc.json');
  const envId = fs.existsSync(configPath)
    ? JSON.parse(fs.readFileSync(configPath, 'utf8')).envId
    : 'tradingview-etf-d0fa42yy57cbc11b';
  const tcb = new Tcb({
    secretId: cred.secretId,
    secretKey: cred.secretKey,
    token: cred.token,
    envId
  });

  const name = 'adminGateway';
  const functionPath = path.join(root, 'dist-functions', name);
  const must = [
    'common/utils/admin-auth.js',
    'common/utils/gateway-errors.js',
    'common/utils/intel-refresh.js',
    'common/utils/request-validate.js'
  ];
  for (const rel of must) {
    if (!fs.existsSync(path.join(functionPath, rel))) {
      throw new Error(`dist missing ${rel}`);
    }
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

  // Wait for Active
  if (typeof tcb.functions.waitFunctionActive === 'function') {
    console.log('waiting Active…');
    await tcb.functions.waitFunctionActive(name);
  } else {
    await new Promise((r) => setTimeout(r, 8000));
  }

  const smoke = await tcb.functions.invokeFunction(name, {
    path: '/api/admin/login',
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: '__smoke_wrong__' })
  });
  const s = JSON.stringify(smoke);
  console.log('smoke:', s.slice(0, 500));
  if (s.includes('Cannot find module')) {
    throw new Error('smoke still missing module after redeploy');
  }
  // Expect business fail (wrong password / unauth), not module crash
  console.log('PASS: adminGateway loads');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
