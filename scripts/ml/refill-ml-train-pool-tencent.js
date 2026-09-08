/**
 * 东财失败时用腾讯按年拉 ML 训练池 → deliverables/etf_daily_ml_pool/
 * node scripts/ml/refill-ml-train-pool-tencent.js
 * node scripts/ml/refill-ml-train-pool-tencent.js --only-missing
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '../..');
const POOL = JSON.parse(fs.readFileSync(path.join(ROOT, 'ml/universe-train-pool.json'), 'utf8'));
const OUT = path.join(ROOT, 'deliverables/etf_daily_ml_pool');
const ONLY_MISSING = process.argv.indexOf('--only-missing') >= 0;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Referer: 'https://finance.qq.com/'
      },
      timeout: 30000
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function symbol(code) {
  return String(code).startsWith('5') ? `sh${code}` : `sz${code}`;
}

function poolItems() {
  const items = [...(POOL.train_pool || [])];
  if (POOL.benchmark) items.push(POOL.benchmark);
  for (const e of POOL.holdout_negative || []) items.push(e);
  const seen = new Set();
  return items.filter((e) => {
    if (seen.has(e.code)) return false;
    seen.add(e.code);
    return true;
  });
}

async function fetchYear(code, year) {
  const sym = symbol(code);
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${sym},day,${year}-01-01,${year}-12-31,320,qfq`;
  const data = await getJson(url);
  const node = data && data.data && data.data[sym];
  const rows = (node && (node.qfqday || node.day)) || [];
  return rows.map((r) => ({
    trade_date: r[0],
    open: +r[1], close: +r[2], high: +r[3], low: +r[4], volume: +r[5]
  })).filter((r) => r.trade_date);
}

async function fetchAll(code) {
  const thisYear = new Date().getFullYear();
  const startYear = code.startsWith('588') ? 2020
    : (code === '159582' ? 2024 : (code === '159570' || code === '159992' ? 2020 : 2018));
  const seen = new Set();
  const out = [];
  for (let y = startYear; y <= thisYear; y++) {
    const chunk = await fetchYear(code, y);
    for (const r of chunk) {
      if (!seen.has(r.trade_date)) {
        seen.add(r.trade_date);
        out.push(r);
      }
    }
    await sleep(350);
  }
  out.sort((a, b) => (a.trade_date < b.trade_date ? -1 : 1));
  return out;
}

function hasFile(code) {
  if (!fs.existsSync(OUT)) return false;
  return fs.readdirSync(OUT).some((f) => f.startsWith(code + '_') && f.endsWith('.csv'));
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const items = poolItems();
  let ok = 0;
  for (const e of items) {
    if (ONLY_MISSING && hasFile(e.code)) {
      console.log(`skip ${e.code} (exists)`);
      ok += 1;
      continue;
    }
    try {
      const rows = await fetchAll(e.code);
      if (!rows.length) {
        console.log(`✗ ${e.code} empty`);
        continue;
      }
      const name = e.name || e.code;
      const file = path.join(OUT, `${e.code}_${name}_qfq.csv`);
      const body = ['date,open,close,high,low,volume,amount']
        .concat(rows.map((r) => `${r.trade_date},${r.open},${r.close},${r.high},${r.low},${r.volume},`))
        .join('\n') + '\n';
      fs.writeFileSync(file, body, 'utf8');
      console.log(`✓ ${e.code} ${name}: ${rows.length}  ${rows[0].trade_date}~${rows[rows.length - 1].trade_date}`);
      ok += 1;
    } catch (err) {
      console.log(`✗ ${e.code}: ${err.message || err}`);
    }
  }
  console.log(`done ${ok}/${items.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
