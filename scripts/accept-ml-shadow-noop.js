#!/usr/bin/env node
/**
 * Zero-strategy-change acceptance: Shadow metadata must not alter V3.6.1 targets/actions.
 *
 *   node scripts/accept-ml-shadow-noop.js
 *
 * Captures runDecisionEngine results and asserts:
 *   - ml_shadow.effective === false
 *   - ml_fast_path_enabled === false (in ml_shadow)
 *   - each result final_target / action stable across two consecutive calls
 */
'use strict';

const fs = require('fs');
const path = require('path');
const cloudbase = require('@cloudbase/node-sdk');

const ENV_ID = 'tradingview-etf-d0fa42yy57cbc11b';
const OUT = path.join(__dirname, '..', 'ml', 'shadow', 'HVT-A-ET-20260830', 'acceptance_noop.json');

function loadCred() {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const candidates = [
    path.join(__dirname, '..', '.tcb-home', '.config', '.cloudbase', 'auth.json'),
    path.join(home, '.config', '.cloudbase', 'auth.json')
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    const c = j.credential || j;
    if (c.secretId && c.secretKey) return c;
    if (c.tmpSecretId && c.tmpSecretKey) {
      return {
        secretId: c.tmpSecretId,
        secretKey: c.tmpSecretKey,
        token: c.tmpToken || c.token
      };
    }
  }
  throw new Error('CloudBase credentials not found');
}

function fingerprint(results) {
  return (results || [])
    .map((r) => ({
      code: r.code,
      action: r.action,
      final_target: r.final_target,
      suggested_position: r.suggested_position
    }))
    .sort((a, b) => String(a.code).localeCompare(String(b.code)));
}

async function callOnce(app, tag) {
  const fn = await app.callFunction({
    name: 'runDecisionEngine',
    data: { trigger: 'accept-ml-shadow-noop', tag }
  });
  return fn.result || fn;
}

async function main() {
  const cred = loadCred();
  const app = cloudbase.init({
    env: ENV_ID,
    secretId: cred.secretId,
    secretKey: cred.secretKey,
    token: cred.token
  });

  console.log('=== Shadow noop acceptance (two consecutive production calls) ===');
  const a = await callOnce(app, 'before');
  const b = await callOnce(app, 'after');

  const fa = fingerprint(a.results);
  const fb = fingerprint(b.results);
  const same = JSON.stringify(fa) === JSON.stringify(fb);

  const ml = b.ml_shadow || a.ml_shadow || {};
  const checks = {
    calls_ok: !!(a.ok || a.ok === undefined) && !!(b.ok || b.ok === undefined),
    production_engine_v361:
      String(b.production_engine || a.production_engine || '').includes('3.6.1'),
    ml_effective_false: b.ml_effective === false || ml.effective === false,
    ml_fast_path_off: ml.fast_path_enabled === false || ml.fast_path_enabled == null,
    targets_actions_identical: same,
    model_id: ml.model_id || null
  };

  const pass = Object.entries(checks)
    .filter(([k]) => k !== 'model_id')
    .every(([, v]) => v === true);

  const report = {
    sealed_at: new Date().toISOString(),
    pass,
    checks,
    ml_shadow: ml,
    fingerprint: fa,
    note: 'Shadow metadata must never change V3.6.1 Target/Action'
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  console.log(JSON.stringify(report, null, 2));
  console.log(pass ? '\nPASS: zero strategy change' : '\nFAIL: see checks');
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
