#!/usr/bin/env node
/**
 * Export latest EOD ETF bars from CloudBase for the frozen ML Shadow pipeline.
 * Read-only against CloudBase; writes only ml/live-bars/*.csv locally.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const cloudbase = require('@cloudbase/node-sdk');

const ROOT = path.join(__dirname, '../..');
const ENV_ID = 'tradingview-etf-d0fa42yy57cbc11b';
const DEFAULT_CODES = ['513310', '515880', '159582', '159570', '518880', '588000', '510300'];
const OUT = path.join(ROOT, 'ml', 'live-bars');

function credentialPath() {
  return process.env.TCB_AUTH_PATH
    || path.join(ROOT, '.tcb-home', '.config', '.cloudbase', 'auth.json')
    || path.join(process.env.USERPROFILE || '', '.config', '.cloudbase', 'auth.json');
}

function loadCredential() {
  const p = credentialPath();
  if (!fs.existsSync(p)) throw new Error(`CloudBase auth.json not found: ${p}`);
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  const c = j.credential || j;
  if (!c.secretId || !c.secretKey) throw new Error('CloudBase auth.json missing secretId/secretKey');
  return c;
}

function csvCell(v) {
  if (v == null || v === '') return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  const codes = (process.argv.find((a) => a.startsWith('--codes=')) || '')
    .slice('--codes='.length).split(',').map((s) => s.trim()).filter(Boolean);
  const wanted = codes.length ? codes : DEFAULT_CODES;
  const c = loadCredential();
  const app = cloudbase.init({ env: ENV_ID, secretId: c.secretId, secretKey: c.secretKey, token: c.token });
  const db = app.database();
  fs.mkdirSync(OUT, { recursive: true });
  const fields = ['trade_date', 'open', 'close', 'high', 'low', 'volume'];
  const exported = [];
  for (const code of wanted) {
    const res = await db.collection('etf_daily').where({ code }).orderBy('trade_date', 'desc').limit(1000).get();
    const rows = (res.data || [])
      .filter((r) => r.source !== 'realtime' && r.trade_date && Number.isFinite(Number(r.close)))
      .sort((a, b) => String(a.trade_date).localeCompare(String(b.trade_date)));
    if (!rows.length) { console.log(`SKIP ${code}: no EOD rows`); continue; }
    const out = path.join(OUT, `${code}.csv`);
    const lines = [fields.join(',')].concat(rows.map((r) => fields.map((f) => csvCell(r[f])).join(',')));
    fs.writeFileSync(out, `${lines.join('\n')}\n`, 'utf8');
    exported.push({ code, rows: rows.length, last_date: rows[rows.length - 1].trade_date, path: out });
    console.log(`OK ${code} rows=${rows.length} last=${rows[rows.length - 1].trade_date}`);
  }
  console.log(JSON.stringify({ ok: true, exported }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
