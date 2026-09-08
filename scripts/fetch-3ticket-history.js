/**
 * 拉黄金/通信/中韩半导体前复权日线，写入 deliverables/etf_daily_3ticket/。
 * 不覆盖五票对齐切片 deliverables/etf_daily_qfq/。
 * 东财不可用时：腾讯 qfq 按年切（param=code,day,YYYY-01-01,YYYY-12-31,320,qfq），新浪兜底。
 *
 * 运行：node scripts/fetch-3ticket-history.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const OUT_DIR = path.join(__dirname, '../deliverables/etf_daily_3ticket');
const LIMIT = 2500;
const CODES = [
  { code: '518880', name: '黄金ETF' },
  { code: '515880', name: '通信ETF' },
  { code: '513310', name: '中韩半导体ETF' }
];
const http = axios.create({
  timeout: 25000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    Referer: 'https://quote.eastmoney.com/'
  }
});

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function toSecid(code) {
  const c = String(code);
  return c.startsWith('5') ? `1.${c}` : `0.${c}`;
}

function toSymbol(code) {
  const c = String(code);
  return c.startsWith('5') ? `sh${c}` : `sz${c}`;
}

function num(v) {
  if (v == null || v === '' || v === '-') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

async function fetchEastmoney(code) {
  const secid = toSecid(code);
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&beg=0&end=20500101&lmt=${LIMIT}`;
  const res = await http.get(url);
  const data = res.data && res.data.data;
  if (!data || !data.klines || data.klines.length === 0) {
    throw new Error(`东财日线为空 code=${code}`);
  }
  return data.klines.map((line) => {
    const f = String(line).split(',');
    return {
      trade_date: f[0],
      open: num(f[1]),
      close: num(f[2]),
      high: num(f[3]),
      low: num(f[4]),
      volume: num(f[5]),
      amount: num(f[6]),
      source: 'eastmoney'
    };
  });
}

async function fetchTencentYear(code, year) {
  const symbol = toSymbol(code);
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},day,${year}-01-01,${year}-12-31,320,qfq`;
  const res = await http.get(url, { headers: { Referer: 'https://finance.qq.com/' } });
  const node = res.data && res.data.data && res.data.data[symbol];
  const rows = (node && (node.qfqday || node.day)) || [];
  return rows.map((r) => ({
    trade_date: r[0],
    open: num(r[1]),
    close: num(r[2]),
    high: num(r[3]),
    low: num(r[4]),
    volume: num(r[5]),
    amount: 0,
    source: 'tencent'
  }));
}

async function fetchTencentPaged(code) {
  const startYear = code === '513310' ? 2022 : 2019;
  const thisYear = new Date().getFullYear();
  const seen = new Set();
  const out = [];
  for (let y = startYear; y <= thisYear; y++) {
    const chunk = await fetchTencentYear(code, y);
    for (const r of chunk) {
      if (r.trade_date && !seen.has(r.trade_date)) {
        seen.add(r.trade_date);
        out.push(r);
      }
    }
    await sleep(150);
  }
  if (!out.length) throw new Error(`腾讯年切为空 code=${code}`);
  return out;
}

async function fetchSina(code) {
  const symbol = toSymbol(code);
  const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${symbol}&scale=240&ma=no&datalen=${LIMIT}`;
  const res = await http.get(url, {
    responseType: 'text',
    headers: { Referer: 'https://finance.sina.com.cn/' }
  });
  let raw = res.data;
  if (typeof raw !== 'string') raw = JSON.stringify(raw);
  const arr = JSON.parse(raw);
  if (!arr || !arr.length) throw new Error(`新浪日线为空 code=${code}`);
  return arr.map((r) => ({
    trade_date: r.day,
    open: num(r.open),
    close: num(r.close),
    high: num(r.high),
    low: num(r.low),
    volume: num(r.volume),
    amount: 0,
    source: 'sina'
  }));
}

async function fetchDaily(code) {
  const sources = [
    { name: 'eastmoney', fn: () => fetchEastmoney(code) },
    { name: 'tencent', fn: () => fetchTencentPaged(code) },
    { name: 'sina', fn: () => fetchSina(code) }
  ];
  let lastErr = null;
  for (const src of sources) {
    try {
      const rows = await src.fn();
      if (rows && rows.length) {
        rows._source = src.name;
        return rows;
      }
    } catch (e) {
      lastErr = e;
      console.warn(`  ${code} ${src.name} 失败: ${e.message || e}`);
    }
  }
  throw lastErr || new Error(`无日线 code=${code}`);
}

function toCsv(rows) {
  const head = 'date,open,close,high,low,volume,amount';
  const body = rows.map((r) => [
    r.trade_date,
    r.open, r.close, r.high, r.low,
    r.volume == null ? 0 : r.volume,
    r.amount == null ? 0 : r.amount
  ].join(','));
  return [head, ...body, ''].join('\n');
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const item of CODES) {
    const rows = await fetchDaily(item.code);
    const sorted = rows.filter((r) => r.trade_date && r.close != null)
      .sort((a, b) => (a.trade_date < b.trade_date ? -1 : 1));
    const file = path.join(OUT_DIR, `${item.code}_${item.name}_qfq.csv`);
    fs.writeFileSync(file, toCsv(sorted));
    const first = sorted[0] && sorted[0].trade_date;
    const last = sorted[sorted.length - 1] && sorted[sorted.length - 1].trade_date;
    const src = (sorted[0] && sorted[0].source) || '?';
    console.log(`${item.code} ${item.name}: ${sorted.length} 根  ${first} ~ ${last}  (${src})  → ${file}`);
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
