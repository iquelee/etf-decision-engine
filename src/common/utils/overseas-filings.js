/**
 * 港股 / 韩股披露与利润表解析（无网络，便于单测）
 */
'use strict';

/** 港交所 5 位代码：1801 → 01801 */
function padHkCode(code) {
  const s = String(code || '').replace(/\D/g, '');
  if (!s) return '';
  return s.padStart(5, '0').slice(-5);
}

/** 韩交所 6 位代码：660 → 000660 */
function padKrCode(code) {
  const s = String(code || '').replace(/\D/g, '');
  if (!s) return '';
  return s.padStart(6, '0').slice(-6);
}

function ymd(dateStr) {
  return String(dateStr || '').replace(/-/g, '').slice(0, 8);
}

function parseHkexPrefix(body) {
  const text = String(body || '');
  const json = text.replace(/^\s*callback\(/, '').replace(/\);\s*$/, '');
  let data;
  try { data = JSON.parse(json); } catch (e) { return null; }
  const row = data && data.stockInfo && data.stockInfo[0];
  if (!row || row.stockId == null) return null;
  return { stockId: String(row.stockId), code: padHkCode(row.code), name: row.name || '' };
}

function parseHkexSearch(body) {
  let data;
  try { data = typeof body === 'string' ? JSON.parse(body) : body; } catch (e) { return []; }
  let rows = data && data.result;
  if (typeof rows === 'string') {
    try { rows = JSON.parse(rows); } catch (e) { return []; }
  }
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => {
      const title = String(r.TITLE || '').replace(/<[^>]*>/g, '').trim();
    const dt = String(r.DATE_TIME || '');
    const m = dt.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
    let time = null;
    if (m) time = new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:00+08:00`).toISOString();
    const link = r.FILE_LINK ? `https://www1.hkexnews.hk${r.FILE_LINK}` : '';
    return {
      title,
      secName: r.STOCK_NAME || '',
      stockCode: padHkCode(r.STOCK_CODE),
      time,
      url: link,
      category: String(r.LONG_TEXT || r.SHORT_TEXT || '').replace(/<[^>]*>/g, '').trim()
    };
  }).filter((x) => x.title);
}

/** 例行月报 / 董事会日期不送 LLM */
function isHkexNoise(item) {
  const t = `${(item && item.title) || ''} ${(item && item.category) || ''}`;
  return /月報表|月报表|Monthly Return|董事會召開日期|董事会召开日期|翌日披露|Next Day Disclosure|證券變動月報/i.test(t);
}

function parseDartList(body) {
  const data = typeof body === 'string' ? JSON.parse(body) : body;
  const status = data && data.status;
  if (status && status !== '000') {
    const err = new Error(`DART ${status}: ${data.message || ''}`);
    err.dartStatus = status;
    throw err;
  }
  const list = (data && data.list) || [];
  return list.map((r) => {
    const title = String(r.report_nm || r.report_name || '').trim();
    const day = String(r.rcept_dt || '').replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
    return {
      title,
      secName: r.corp_name || '',
      time: day ? new Date(`${day}T00:00:00+09:00`).toISOString() : null,
      url: r.rcept_no ? `https://englishdart.fss.or.kr/dsbh001/main.do?rcpNo=${r.rcept_no}` : '',
      receiptNo: r.rcept_no || ''
    };
  }).filter((x) => x.title);
}

function isDartNoise(item) {
  const t = String((item && item.title) || '');
  return /대규모보유|주식등의대량보유|임원ㆍ주요주주|임원·주요주주|단순처분|단순취득/i.test(t);
}

/** 东财港股利润表：取最新「营运收入」同比 */
function pickHkOperatingIncome(rows) {
  const list = (rows || []).filter((r) => r && r.STD_ITEM_CODE === '004001999' && r.YOY_RATIO != null);
  if (list.length === 0) return null;
  const rank = (d) => (d === '001' ? 2 : (d === '002' ? 1 : 0));
  list.sort((a, b) => {
    const da = String(a.REPORT_DATE || '');
    const db = String(b.REPORT_DATE || '');
    if (da !== db) return db.localeCompare(da);
    return rank(b.DATE_TYPE_CODE) - rank(a.DATE_TYPE_CODE);
  });
  const row = list[0];
  const yoy = Number(row.YOY_RATIO);
  const amount = Number(row.AMOUNT);
  return {
    period_end: String(row.REPORT_DATE || '').slice(0, 10),
    date_type: row.DATE_TYPE_CODE || '',
    revenue: Number.isFinite(amount) ? amount : null,
    revenue_yoy: Number.isFinite(yoy) ? Math.round(yoy * 100) / 100 : null,
    currency: row.CURRENCY || row.CURRENCY_CODE || '',
    item_name: row.ITEM_NAME || '营运收入'
  };
}

function dartNum(v) {
  if (v == null || v === '-' || v === '') return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function yoyFromDart(cur, prev) {
  if (cur == null || prev == null || prev === 0) return null;
  return Math.round(((cur - prev) / Math.abs(prev)) * 10000) / 100;
}

function pickDartAccounts(rows) {
  const list = rows || [];
  const find = (names) => {
    const hit = list.find((r) => names.some((n) => String(r.account_nm || '').indexOf(n) >= 0));
    if (!hit) return { cur: null, prev: null };
    return { cur: dartNum(hit.thstrm_amount), prev: dartNum(hit.frmtrm_amount) };
  };
  const rev = find(['매출액', 'Revenue', 'Sales']);
  const ni = find(['당기순이익', 'Net Income', 'Profit (loss)']);
  const oi = find(['영업이익', 'Operating Income', 'Operating profit']);
  const period = (list[0] && (list[0].thstrm_dt || list[0].bsns_year)) || '';
  return {
    period_end: String(period).slice(0, 10) || null,
    revenue: rev.cur,
    revenue_yoy: yoyFromDart(rev.cur, rev.prev),
    net_income: ni.cur,
    net_income_yoy: yoyFromDart(ni.cur, ni.prev),
    operating_income: oi.cur
  };
}

/**
 * 港股持仓营运收入同比按净值权重加权。
 * @param {Array<{stock_code:string, weight:number, market?:string}>} holdings
 * @param {Object} bySymbol symbol → { revenue_yoy }
 */
function materializeHoldingsYoy(holdings, bySymbol) {
  let num = 0;
  let den = 0;
  (holdings || []).forEach((h) => {
    if (h.market && h.market !== 'hk') return;
    const code = padHkCode(h.stock_code);
    const row = bySymbol[`hk${code}`] || bySymbol[code];
    const yoy = row ? Number(row.revenue_yoy) : NaN;
    const w = Number(h.weight);
    if (!Number.isFinite(yoy) || !Number.isFinite(w) || w <= 0) return;
    num += yoy * w;
    den += w;
  });
  if (den <= 0) return null;
  return Math.round((num / den) * 100) / 100;
}

const KR_DART_CORPS = [
  { stock_code: '000660', name: 'SK海力士', corp_code: '00164779', symbol: 'kr000660', related: ['513310'], factor: 'HBM/DRAM' },
  { stock_code: '005930', name: '三星电子', corp_code: '00126380', symbol: 'kr005930', related: ['513310'], factor: '存储/HBM' }
];

function dartCorpByStock(stockCode) {
  const code = padKrCode(stockCode);
  return KR_DART_CORPS.find((x) => x.stock_code === code) || null;
}

module.exports = {
  padHkCode,
  padKrCode,
  ymd,
  parseHkexPrefix,
  parseHkexSearch,
  isHkexNoise,
  parseDartList,
  isDartNoise,
  pickHkOperatingIncome,
  pickDartAccounts,
  materializeHoldingsYoy,
  KR_DART_CORPS,
  dartCorpByStock
};
