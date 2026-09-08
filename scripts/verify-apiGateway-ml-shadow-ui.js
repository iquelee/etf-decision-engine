'use strict';
/** One-shot: invoke apiGateway /api/dashboard and print ml_shadow */
const path = require('path');
const fs = require('fs');
const CloudBase = require('@cloudbase/manager-node');
const Tcb = CloudBase.default || CloudBase;

async function main() {
  const root = path.join(__dirname, '..');
  const perm = path.join(root, '.tcb-home', '.config', '.cloudbase', 'auth.json');
  const home = path.join(process.env.HOME || '', '.config', '.cloudbase', 'auth.json');
  let cred;
  if (fs.existsSync(perm)) {
    const j = JSON.parse(fs.readFileSync(perm, 'utf8'));
    cred = j.credential || j;
  } else {
    const j = JSON.parse(fs.readFileSync(home, 'utf8')).credential;
    cred = {
      secretId: j.secretId || j.tmpSecretId,
      secretKey: j.secretKey || j.tmpSecretKey,
      token: j.token || j.tmpToken
    };
  }
  const envId = JSON.parse(fs.readFileSync(path.join(root, 'cloudbaserc.json'), 'utf8')).envId;
  const tcb = new Tcb({
    secretId: cred.secretId,
    secretKey: cred.secretKey,
    token: cred.token,
    envId
  });

  const list = await tcb.functions.getFunctionList();
  const names = (list.Functions || list.functions || []).map((f) => f.FunctionName || f.name);
  console.log('functions', names);
  const name = names.find((n) => /apigateway/i.test(String(n))) || 'apiGateway';

  const r = await tcb.functions.invokeFunction({
    FunctionName: name,
    InvokeData: JSON.stringify({
      path: '/api/dashboard',
      httpMethod: 'GET',
      headers: {},
      queryStringParameters: {}
    })
  });
  const msg = r.Response && (r.Response.RetMsg || r.Response.Result || r.Response);
  const s = typeof msg === 'string' ? msg : JSON.stringify(msg);
  console.log(s.slice(0, 1500));
  console.log('HAS_ml_shadow', s.includes('ml_shadow'));
  try {
    const parsed = JSON.parse(s);
    const body = parsed.body ? JSON.parse(parsed.body) : parsed;
    const data = body.data || body;
    console.log('ml_shadow object', JSON.stringify(data.ml_shadow, null, 2));
  } catch (e) {
    /* ignore */
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
