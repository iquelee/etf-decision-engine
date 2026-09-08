#!/usr/bin/env node
/**
 * Push latest Shadow ledger rows → CloudBase ml_shadow_signal (UI consume).
 * Observe-only. Does not change V3.6.1 decisions / Gen-1 model.
 *
 * Usage: node scripts/ml/push-shadow-signals.js [YYYY-MM-DD]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '../..');
const MODEL_ID = 'HVT-A-ET-20260830';
const ENV_ID = 'tradingview-etf-d0fa42yy57cbc11b';
const LEDGER = path.join(ROOT, 'ml/shadow', MODEL_ID, 'ledger_signals.csv');
const MANIFEST = path.join(ROOT, 'ml/models', MODEL_ID, 'freeze_manifest.json');
const MAIN5_CODES = new Set(['513310', '515880', '159582', '518880', '159570']);

function loadFeatureSchemaHash() {
  try {
    const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    // Keep byte-for-byte parity with shadow-daily-log.py (sort_keys=True).
    const payload = JSON.stringify({
      features_cat: m.features_cat || [],
      features_core: m.features_core || []
    });
    return crypto.createHash('sha256').update(payload).digest('hex');
  } catch (_) {
    return null;
  }
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (!lines.length) return [];
  const header = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cols = line.split(',');
    const o = {};
    header.forEach((h, i) => { o[h.trim()] = (cols[i] != null ? cols[i].trim() : ''); });
    return o;
  });
}

function num(v) {
  if (v == null || v === '' || v === 'nan' || v === 'NaN') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function bool(v) {
  return String(v).toLowerCase() === 'true' || v === '1';
}

function signalStatus(r) {
  const explicit = String(r.signal_status || '').trim().toUpperCase();
  if (['NO_OPPORTUNITY', 'OBSERVED', 'CANDIDATE', 'BLOCKED', 'DEGRADED'].includes(explicit)) return explicit;
  if (bool(r.fast_path_would_trigger)) return 'CANDIDATE';
  if (bool(r.permission_hit)) return 'BLOCKED';
  if (num(r.calibrated_probability) != null || num(r.ml_probability) != null) return 'OBSERVED';
  return 'NO_OPPORTUNITY';
}

async function main() {
  if (!fs.existsSync(LEDGER)) {
    console.error('missing ledger', LEDGER);
    process.exit(1);
  }
  const day = process.argv[2] || null;
  const schemaHash = loadFeatureSchemaHash();
  let rows = parseCsv(fs.readFileSync(LEDGER, 'utf8'));
  if (day) rows = rows.filter((r) => r.date === day);
  if (!rows.length) {
    console.log('no rows to push');
    return;
  }
  if (day) {
    const pushedCodes = new Set(rows.map((r) => String(r.code)).filter((c) => MAIN5_CODES.has(c)));
    const missing = [...MAIN5_CODES].filter((c) => !pushedCodes.has(c));
    if (missing.length) throw new Error(`Main5 Shadow completeness failed for ${day}: missing=${missing.join(',')}`);
  }

  const perm = process.env.TCB_AUTH_PATH
    || path.join(ROOT, '.tcb-home', '.config', '.cloudbase', 'auth.json');
  const home = path.join(
    process.env.HOME || process.env.USERPROFILE || '',
    '.config', '.cloudbase', 'auth.json'
  );
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

  const cloudbase = require('@cloudbase/node-sdk');
  const app = cloudbase.init({
    env: ENV_ID,
    secretId: cred.secretId,
    secretKey: cred.secretKey,
    token: cred.token
  });
  const db = app.database();
  const col = db.collection('ml_shadow_signal');

  let n = 0;
  for (const r of rows) {
    const doc = {
      date: r.date,
      source_trade_date: r.source_trade_date || r.date,
      code: r.code,
      stage: r.stage || null,
      ml_probability: num(r.ml_probability),
      calibrated_probability: num(r.calibrated_probability),
      ml_fast: bool(r.ml_fast),
      rule_gate: r.rule_gate || null,
      permission_hit: bool(r.permission_hit),
      fast_path_would_trigger: bool(r.fast_path_would_trigger),
      signal_status: signalStatus(r),
      ml_counterfactual_target: num(r.ml_counterfactual_target),
      v361_target: num(r.v361_target),
      delta_target: num(r.delta_target),
      decision_hash: r.decision_hash || null,
      feature_schema_hash: r.feature_schema_hash || schemaHash,
      model_id: r.model_id || r.ml_model_id || MODEL_ID,
      ml_model_id: r.ml_model_id || MODEL_ID,
      ml_effective: false,
      ml_advisory_enabled: true,
      advisory_effective: signalStatus(r) === 'CANDIDATE',
      ml_execution_enabled: false,
      updated_at: new Date().toISOString()
    };
    const existed = await col.where({ date: doc.date, code: doc.code }).limit(1).get();
    if (existed.data && existed.data[0]) {
      await col.doc(existed.data[0]._id).update(doc);
    } else {
      await col.add(doc);
    }
    n += 1;
  }
  console.log('pushed', n, 'ml_shadow_signal rows (advisory metadata; execution=false)');
}

main().catch((e) => { console.error(e); process.exit(1); });
