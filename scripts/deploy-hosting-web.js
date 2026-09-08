'use strict';
/**
 * Deploy web/dist to CloudBase static hosting (same env as production).
 */
const path = require('path');
const fs = require('fs');

async function main() {
  const CloudBase = require('@cloudbase/manager-node');
  const Tcb = CloudBase.default || CloudBase;

  const root = path.join(__dirname, '..');
  const dist = path.join(root, 'web', 'dist');
  if (!fs.existsSync(path.join(dist, 'index.html'))) {
    throw new Error('web/dist/index.html missing — run npm run build first');
  }
  // Sanity: new actionLabel wiring (code-first), not old action_label||ACTION_LABELS
  const assets = fs.readdirSync(path.join(dist, 'assets')).filter((f) => f.startsWith('Dashboard-') && f.endsWith('.js'));
  if (!assets.length) throw new Error('Dashboard asset missing in dist');
  const dash = fs.readFileSync(path.join(dist, 'assets', assets[0]), 'utf8');
  if (dash.includes('action_label||') || /action_label\|\|/.test(dash)) {
    throw new Error('dist still has old action_label|| pattern — rebuild required');
  }
  if (!dash.includes('action_label))') && !dash.includes('action_label)')) {
    // soft check: expect actionLabel(c.action, c.action_label) compiled form
    console.warn('warn: could not confirm actionLabel call shape in Dashboard asset');
  }

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

  const envId = 'tradingview-etf-d0fa42yy57cbc11b';
  const tcb = new Tcb({
    secretId: cred.secretId,
    secretKey: cred.secretKey,
    token: cred.token,
    envId
  });

  console.log('Uploading hosting from', dist);
  const result = await tcb.hosting.uploadFiles({
    localPath: dist,
    cloudPath: '/',
    ignore: ['.DS_Store', '**/.DS_Store']
  });
  console.log('hosting OK', JSON.stringify(result).slice(0, 400));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
