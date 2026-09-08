/**
 * 多源数据抓取封装（akshare 等价实现）
 *
 * 说明（架构 A1.1 难点 2）：
 * - akshare 是 Python 库，Node.js 云函数无法直接 import；
 * - 本模块用 axios 直连 akshare 底层封装的东财/腾讯/新浪 HTTP 接口 + FRED，
 *   实现「akshare 等价」抓取；
 * - 函数内重试 3 次（1s/5s/30s 指数退避）；缺数标 data_complete=false，绝不编造。
 *
 * @module datasource
 */

'use strict';

const axios = require('axios');
const { parseHoldingRow } = require('./holdings-parse');
const overseas = require('./overseas-filings');
const biotech = require('./biotech-intel');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const http = axios.create({
  timeout: 15000,
  headers: { 'User-Agent': UA, Referer: 'https://quote.eastmoney.com/' }
});

/** 延时 */
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/** 数字容错 */
function num(v) {
  if (v == null || v === '' || v === '-') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

/** 代码 → 东财 secid（5 开头沪市=1.xxx，1 开头深市=0.xxx） */
function toSecid(code) {
  const c = String(code);
  return c.startsWith('5') ? `1.${c}` : `0.${c}`;
}

/** 代码 → 腾讯/新浪 symbol（sh/sz 前缀） */
function toSymbol(code) {
  const c = String(code);
  return c.startsWith('5') ? `sh${c}` : `sz${c}`;
}

/** 解码 GBK 缓冲（腾讯接口返回 GBK） */
function decodeBuffer(buf) {
  try {
    return new TextDecoder('gbk').decode(Buffer.from(buf));
  } catch (e) {
    return Buffer.from(buf).toString('utf-8');
  }
}

/**
 * 带指数退避的重试封装。
 * @param {Function} fn 异步函数
 * @param {number} retries 重试次数（默认 3）
 * @param {Array<number>} backoff 退避毫秒（默认 [1000, 5000, 30000]）
 * @returns {Promise<any>}
 */
async function fetchWithRetry(fn, retries = 3, backoff = [1000, 5000, 30000]) {
  let lastErr = null;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < retries) {
        const wait = backoff[i] != null ? backoff[i] : (backoff[backoff.length - 1] || 1000);
        await sleep(wait);
      }
    }
  }
  throw lastErr;
}

/**
 * 判断是否交易日（近似：周末非交易日，节假日经 HOLIDAYS 环境变量补充）。
 * @param {string} dateStr YYYY-MM-DD
 * @returns {boolean}
 */
function isTradingDay(dateStr) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return false;
  const day = d.getDay();
  if (day === 0 || day === 6) return false;
  const holidays = process.env.HOLIDAYS ? process.env.HOLIDAYS.split(',') : [];
  const key = String(dateStr).slice(0, 10);
  return holidays.indexOf(key) < 0;
}

/**
 * 东财日线（akshare 底层接口）。
 * kline 每项：`date,open,close,high,low,volume,amount,振幅,涨跌幅,涨跌额,换手率`
 * @param {string} code
 * @param {number} limit 抓取条数
 * @returns {Promise<Array<object>>} [{trade_date,open,high,low,close,volume,amount,source}]
 */
async function fetchDailyEastmoney(code, limit = 320) {
  const secid = toSecid(code);
  // P1-4 修复（2026-08-22）：fqt=0（不复权）→ fqt=1（前复权），与腾讯主源 qfq 口径统一，
  // 避免多源回退混用复权基准导致除权日数据污染指标（份额折算日不复权价断层）。
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&beg=0&end=20500101&lmt=${limit}`;
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

/**
 * 腾讯日线（前复权 qfq）。
 * @param {string} code
 * @param {number} limit
 * @returns {Promise<Array<object>>}
 */
async function fetchDailyTencent(code, limit = 320) {
  const symbol = toSymbol(code);
  // 复权口径：前复权（qfq）。P0-1 修复（2026-08-21）：
  // 原不复权口径在份额折算日产生价格断层（如 515880 2026-02-03 3.16→1.084、07-06 1.579→0.757），
  // 污染 MA20/MA60/ATR 等指标 → 周线状态误判 W4。前复权保证连续可比。
  // 注意：qfq 基准随最新价漂移，历史价会随每次抓取微调——指标/周线由物化层每日全量重算，天然一致。
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},day,,,${limit},qfq`;
  const res = await http.get(url);
  const node = res.data && res.data.data && res.data.data[symbol];
  if (!node) throw new Error(`腾讯日线为空 code=${code}`);
  const rows = node.qfqday || node.day || [];
  if (!rows.length) throw new Error(`腾讯日线为空 code=${code}`);
  return rows.map((r) => ({
    trade_date: r[0],
    open: num(r[1]),
    close: num(r[2]),
    high: num(r[3]),
    low: num(r[4]),
    volume: num(r[5]),
    amount: num(r[6]) || null,
    source: 'tencent'
  }));
}

/**
 * 新浪日线。
 * @param {string} code
 * @param {number} limit
 * @returns {Promise<Array<object>>}
 */
async function fetchDailySina(code, limit = 320) {
  const symbol = toSymbol(code);
  const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${symbol}&scale=240&ma=no&datalen=${limit}`;
  const res = await http.get(url, { responseType: 'text' });
  let raw = res.data;
  if (typeof raw !== 'string') raw = JSON.stringify(raw);
  const arr = JSON.parse(raw);
  if (!arr || !arr.length) throw new Error(`新浪日线为空 code=${code}`);
  return arr.map((r) => ({
    trade_date: r.day,
    open: num(r.open),
    high: num(r.high),
    low: num(r.low),
    close: num(r.close),
    volume: num(r.volume),
    amount: null,
    source: 'sina'
  }));
}

/**
 * 多源日线（东财→腾讯→新浪），带重试；返回首个可用源。
 * @param {string} code
 * @param {number} limit
 * @returns {Promise<{bars:Array<object>, source:string}>}
 */
async function fetchDaily(code, limit = 320) {
  // 腾讯接口优先（云函数在腾讯云内网，访问腾讯行情最快；东财为外部接口，公网访问易超时）
  const sources = [
    { name: 'tencent', fn: () => fetchDailyTencent(code, limit) },
    { name: 'sina', fn: () => fetchDailySina(code, limit) },
    { name: 'eastmoney', fn: () => fetchDailyEastmoney(code, limit) }
  ];
  let lastErr = null;
  for (const s of sources) {
    try {
      const bars = await fetchWithRetry(s.fn);
      if (bars && bars.length >= 20) return { bars, source: s.name };
      lastErr = new Error(`源 ${s.name} 数据不足 20 根`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('所有数据源均失败');
}

/**
 * 腾讯实时快照（GBK 编码）。
 * 字段（~ 分隔）：0=标识,1=名称,2=代码,3=现价,4=昨收,5=今开,6=成交量(手),
 *   30=时间,31=涨跌,32=涨跌幅%,33=最高,34=最低,37=成交额(万)
 * @param {string} code
 * @returns {Promise<{price:number, time:string, change_pct:number, high:number, low:number, open:number, prev_close:number}>}
 */
async function fetchRealtime(code) {
  const symbol = toSymbol(code);
  const url = `https://qt.gtimg.cn/q=${symbol}`;
  const res = await http.get(url, { responseType: 'arraybuffer' });
  const text = decodeBuffer(res.data);
  const m = text.match(/="([^"]*)"/);
  if (!m) throw new Error(`腾讯实时解析失败 code=${code}`);
  const f = m[1].split('~');
  return {
    price: num(f[3]),
    prev_close: num(f[4]),
    open: num(f[5]),
    time: f[30] || '',
    change_pct: num(f[32]),
    high: num(f[33]),
    low: num(f[34]),
    source: 'tencent'
  };
}

/**
 * 东财折溢价/IOPV（ETF 溢价率字段 f162）。
 * 注意：东财返回数值可能存在小数位缩放，取值以实测为准；不确定时返回 null（不编造）。
 * @param {string} code
 * @returns {Promise<{premium_rate:number|null, iopv:number|null, price:number|null}>}
 */
async function fetchPremiumIopv(code) {
  const secid = toSecid(code);
  const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f43,f57,f58,f60,f127,f162,f169,f170,f171`;
  const res = await http.get(url);
  const data = res.data && res.data.data;
  if (!data) return { premium_rate: null, iopv: null, price: null };

  let price = num(data.f43);
  if (price != null && Math.abs(price) > 10000) price = price / 1000; // 价格放大精度启发式

  let premium = num(data.f162);
  // 折溢价率应在合理区间（-30 ~ +30%），超出视为字段缩放异常 → 归一化或置 null
  if (premium != null && Math.abs(premium) > 30) premium = premium / 100;

  const iopv = num(data.f127);
  return { premium_rate: premium, iopv, price };
}

/**
 * FRED 时序（宏观：美国实际利率/美债等）。
 * @param {string} seriesId 如 DFII10
 * @param {string} apiKey FRED_API_KEY
 * @returns {Promise<Array<object>>} [{date, value}]
 */
async function fetchFredSeries(seriesId, apiKey) {
  if (!apiKey) throw new Error('缺少 FRED_API_KEY');
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${apiKey}&file_type=json`;
  const res = await http.get(url);
  const observations = res.data && res.data.observations;
  if (!observations || !observations.length) throw new Error(`FRED 数据为空 series=${seriesId}`);
  return observations
    .filter((o) => o.value !== '.')
    .map((o) => ({ date: o.date, value: num(o.value) }));
}

/**
 * 美元指数（腾讯行情 whDINIW，GBK 编码，~ 分隔）。
 * 返回 `v_whDINIW="310~美元指数~DINIW~99.6400~0~20260810160649~99.6000~...";`
 * 字段：0=市场,1=名称,2=代码,3=最新价,4=涨跌,5=时间戳(YYYYMMDDHHmmss),6=昨收
 * @returns {Promise<{value:number, date:string}>}
 */
async function fetchDollarIndex() {
  const url = 'https://qt.gtimg.cn/q=whDINIW';
  const res = await http.get(url, { responseType: 'arraybuffer' });
  const text = decodeBuffer(res.data);
  const m = text.match(/="([^"]*)"/);
  if (!m) throw new Error('美元指数解析失败');
  const f = m[1].split('~');
  const value = num(f[3]);
  // 时间戳 YYYYMMDDHHmmss → YYYY-MM-DD
  let date = '';
  const ts = f[5] || '';
  if (ts.length >= 8) {
    date = `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
  }
  if (value == null) throw new Error('美元指数数据为空');
  return { value, date };
}

/**
 * 宽基指数周线（腾讯 fqkline week，用于 V2.1 市场环境推导）。
 * @param {string} symbol 指数 symbol，如 sh000300 / sh000688 / sz399006
 * @param {number} limit 周线条数
 * @returns {Promise<Array<object>>} [{date, open, high, low, close, volume}]
 */
async function fetchIndexWeekly(symbol, limit = 60) {
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},week,,,${limit},`;
  const res = await http.get(url);
  const node = res.data && res.data.data && res.data.data[symbol];
  if (!node) throw new Error(`腾讯周线为空 symbol=${symbol}`);
  const rows = node.week || node.qfqweek || [];
  if (!rows.length) throw new Error(`腾讯周线为空 symbol=${symbol}`);
  return rows.map((r) => ({
    date: r[0],
    open: num(r[1]),
    close: num(r[2]),
    high: num(r[3]),
    low: num(r[4]),
    volume: num(r[5]) || null
  }));
}

/**
 * 海外关联标的「当日快照」（腾讯实时 qt.gtimg.cn，美股/指数统一 symbol）。
 * 海外标的历史日线免费源均不可用（腾讯 fqkline 只返回 2 根、东财 push2his 海外断开、
 * stooq JS 反爬、雅虎被墙），故改为「每日收盘后抓腾讯实时快照 → 存 global_quote 累积」，
 * 累积 20 个交易日后自然形成 MA20/动量所需的历史序列。
 * @param {object} ticker GLOBAL_TICKERS 条目 { symbol }
 * @param {number} limit 未使用（兼容签名）
 * @returns {Promise<Array<object>>} [{trade_date, open, high, low, close, volume, pct_change}]（单条当日快照）
 */
async function fetchGlobalDaily(ticker, limit = 320) {
  if (!ticker || !ticker.symbol) throw new Error('缺少 ticker.symbol');
  const symbol = ticker.symbol;
  const url = `https://qt.gtimg.cn/q=${symbol}`;
  const res = await http.get(url, { responseType: 'arraybuffer' });
  const text = decodeBuffer(res.data);
  const m = text.match(/="([^"]*)"/);
  if (!m) throw new Error(`腾讯实时解析失败 symbol=${symbol}`);
  const f = m[1].split('~');
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  return [{
    trade_date: today,
    open: num(f[5]),
    close: num(f[3]),
    high: num(f[33]),
    low: num(f[34]),
    volume: null,
    pct_change: num(f[32])
  }];
}

/** SEC 财报字段映射（按命名空间）：us-gaap 与 ifrs-full 两套标签（含备用字段兜底） */
const SEC_METRIC_DEFS = {
  'us-gaap': {
    revenue: ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues'],
    net_income: ['NetIncomeLoss'],
    gross_profit: ['GrossProfit'],
    cost_of_revenue: ['CostOfRevenue', 'CostOfGoodsAndServicesSold', 'CostOfSales'],
    operating_income: ['OperatingIncomeLoss'],
    rd_expense: ['ResearchAndDevelopmentExpense'],
    inventory: ['InventoryNet'],
    capex: ['PaymentsToAcquirePropertyPlantAndEquipment'],
    eps: ['EarningsPerShareDiluted', 'EarningsPerShareBasic']
  },
  'ifrs-full': {
    revenue: ['Revenue'],
    net_income: ['ProfitLossAttributableToOwnersOfParent', 'ProfitLoss'],
    gross_profit: ['GrossProfit'],
    cost_of_revenue: ['CostOfSales'],
    operating_income: ['ProfitLossFromOperatingActivities'],
    rd_expense: ['ResearchAndDevelopmentExpense'],
    inventory: ['Inventories'],
    capex: ['PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities'],
    eps: ['DilutedEarningsLossPerShare', 'BasicEarningsLossPerShare']
  }
};

/**
 * SEC EDGAR 财报抓取（美国上市 + ADR 公司）。
 * 官方 companyfacts API：https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json
 * 免费无 Key，仅要求 User-Agent 携带联系邮箱 + 控制频率（<10 req/s，单标的每日一次安全）。
 *
 * 兼容性：多命名空间（us-gaap / ifrs-full）、多货币（USD / EUR / TWD）、
 * 多表单（10-K/10-Q / 20-F/6-K）、年度财报（ADR 无单季时取年度值）。
 *
 * @param {object} ticker SEC_FINANCIAL_TICKERS 条目 { cik, ns, currency, forms }
 * @returns {Promise<object>} 财报摘要 { currency, latest:{...}, prev_quarters }
 */
async function fetchSecCompanyFacts(ticker) {
  const cik = ticker.cik;
  const ns = ticker.ns || 'us-gaap';
  const currency = ticker.currency || 'USD';
  const forms = ticker.forms || ['10-K', '10-Q'];
  const defs = SEC_METRIC_DEFS[ns] || SEC_METRIC_DEFS['us-gaap'];

  const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;
  // 带指数退避重试（SEC 连续请求易限流/超时，重试 3 次可显著提升批量抓取成功率）
  const res = await fetchWithRetry(() => http.get(url, {
    headers: { 'User-Agent': 'investment-research-agent contact@example.com' },
    timeout: 30000
  }), 3, [1000, 5000, 15000]);
  const data = res.data;
  if (!data || !data.facts || !data.facts[ns]) {
    throw new Error(`SEC 财报为空 cik=${cik}`);
  }
  const gaap = data.facts[ns];

  /** 金额序列：合并所有标签（主+备）的数据，优先配置货币，去重后按 end 倒序 */
  const seriesAmount = (tags) => {
    const collected = [];
    for (const tag of tags) {
      const f = gaap[tag];
      if (!f || !f.units) continue;
      const money = [currency, 'USD', 'EUR', 'TWD'].filter((u, i, a) => a.indexOf(u) === i);
      let unitArr = null;
      for (const uk of money) {
        const arr = f.units[uk];
        if (arr && arr.length) { unitArr = arr; break; }
      }
      if (!unitArr) {
        for (const uk of Object.keys(f.units)) {
          const arr = f.units[uk];
          if (arr && arr.length) { unitArr = arr; break; }
        }
      }
      if (unitArr) {
        unitArr.forEach((x) => { if (forms.indexOf(x.form) >= 0) collected.push(x); });
      }
    }
    // 去重（同 end+val 可能在多标签重复披露）+ 排序
    const seen = {};
    const dedup = [];
    for (const x of collected) {
      const key = `${x.end}_${x.val}`;
      if (!seen[key]) { seen[key] = true; dedup.push(x); }
    }
    return dedup.sort((a, b) => (b.end || '').localeCompare(a.end || ''));
  };

  /** EPS 序列：合并所有标签，优先 {currency}/shares，去重后按 end 倒序 */
  const seriesEps = (tags) => {
    const collected = [];
    for (const tag of tags) {
      const f = gaap[tag];
      if (!f || !f.units) continue;
      const share = [`${currency}/shares`, 'USD/shares', 'EUR/shares', 'TWD/shares']
        .filter((u, i, a) => a.indexOf(u) === i);
      let unitArr = null;
      for (const uk of share) {
        const arr = f.units[uk];
        if (arr && arr.length) { unitArr = arr; break; }
      }
      if (!unitArr) {
        for (const uk of Object.keys(f.units)) {
          if (uk.indexOf('/shares') >= 0) {
            const arr = f.units[uk];
            if (arr && arr.length) { unitArr = arr; break; }
          }
        }
      }
      if (unitArr) {
        unitArr.forEach((x) => { if (forms.indexOf(x.form) >= 0) collected.push(x); });
      }
    }
    const seen = {};
    const dedup = [];
    for (const x of collected) {
      const key = `${x.end}_${x.val}`;
      if (!seen[key]) { seen[key] = true; dedup.push(x); }
    }
    return dedup.sort((a, b) => (b.end || '').localeCompare(a.end || ''));
  };

  /** 是否「单季」口径：start 与 end 相差约一个季度（< 120 天） */
  const isQuarter = (x) => {
    if (!x.start || !x.end) return false;
    const days = (new Date(x.end).getTime() - new Date(x.start).getTime()) / 86400000;
    return days > 0 && days < 120;
  };

  /** 取「最新单季」；无单季（ADR 年度 20-F）时回退取最新一条 */
  const latestPeriod = (tags) => {
    const all = seriesAmount(tags);
    if (all.length === 0) return null;
    const q = all.filter(isQuarter);
    return q.length > 0 ? q[0] : all[0];
  };

  /** 时点值（无 start）：库存，取最新 */
  const latestPoint = (tags) => {
    const all = seriesAmount(tags);
    return all.length > 0 ? all[0] : null;
  };

  /** 累计 YTD 值（start=财年初，>100 天排除单季 90 天）：CapEx 现金流，取最新 */
  const latestYtd = (tags) => {
    const all = seriesAmount(tags).filter((x) => {
      if (!x.start || !x.end) return false;
      return (new Date(x.end).getTime() - new Date(x.start).getTime()) / 86400000 > 100;
    });
    return all.length > 0 ? all[0] : null;
  };

  /** 找「去年同期」：end 相差约 350~385 天（季度同比 / 年度同比均适用） */
  const findYoy = (arr, targetEnd) => {
    const t = new Date(targetEnd).getTime();
    return arr.find((x) => {
      const d = Math.abs(new Date(x.end).getTime() - t);
      return d >= 350 * 86400000 && d <= 385 * 86400000;
    }) || null;
  };

  const val = (x) => (x ? num(x.val) : null);
  const yoyPct = (cur, prev) => {
    if (cur == null || prev == null || prev === 0) return null;
    return Math.round(((cur - prev) / Math.abs(prev)) * 10000) / 100;
  };

  // 核心指标：营收/净利/毛利/营业利润/研发取最新期（单季优先，ADR 年度回退）
  const rev = latestPeriod(defs.revenue);
  const ni = latestPeriod(defs.net_income);
  const gp = latestPeriod(defs.gross_profit);
  const oi = latestPeriod(defs.operating_income);
  const rd = latestPeriod(defs.rd_expense);
  const eps = (() => {
    const arr = seriesEps(defs.eps).filter(isQuarter);
    if (arr.length === 0) {
      const all = seriesEps(defs.eps);
      return all.length > 0 ? all[0] : null;
    }
    return arr[0];
  })();
  const inv = latestPoint(defs.inventory);
  const capex = latestYtd(defs.capex);

  // 同比基准序列：单季优先（季度公司），无单季用全序列（ADR 年度公司）
  const revAll = seriesAmount(defs.revenue);
  const niAll = seriesAmount(defs.net_income);
  const revSeries = revAll.filter(isQuarter).length > 0 ? revAll.filter(isQuarter) : revAll;
  const niSeries = niAll.filter(isQuarter).length > 0 ? niAll.filter(isQuarter) : niAll;
  let revenueYoy = null;
  let netIncomeYoy = null;
  if (rev) {
    const prevRev = findYoy(revSeries, rev.end);
    revenueYoy = prevRev ? yoyPct(val(rev), val(prevRev)) : null;
  }
  if (ni) {
    const prevNi = findYoy(niSeries, ni.end);
    netIncomeYoy = prevNi ? yoyPct(val(ni), val(prevNi)) : null;
  }

  // 库存环比（最新 vs 上一期时点）
  let inventoryQoq = null;
  if (inv) {
    const invSeries = seriesAmount(defs.inventory);
    if (invSeries.length > 1) inventoryQoq = yoyPct(val(inv), val(invSeries[1]));
  }

  // 毛利率：优先 GrossProfit（合理性校验 5%~98%，排除旧标签异常值），兜底用成本反推 1 - cost/revenue
  const revVal = val(rev);
  const gpVal = val(gp);
  let grossMargin = null;
  if (gpVal != null && revVal != null && revVal !== 0) {
    const m = gpVal / revVal;
    if (m > 0.05 && m < 0.98) grossMargin = Math.round(m * 10000) / 100;
  }
  if (grossMargin == null) {
    const cor = latestPeriod(defs.cost_of_revenue);
    const corVal = val(cor);
    if (corVal != null && revVal != null && revVal !== 0) {
      const m = 1 - corVal / revVal;
      if (m > 0 && m < 0.95) grossMargin = Math.round(m * 10000) / 100;
    }
  }

  if (!rev) throw new Error(`SEC 财报无营收数据 cik=${cik}`);

  // 最近几期（单季优先，ADR 年度回退）
  const qSeries = revSeries.filter(isQuarter);
  const trendSeries = qSeries.length > 0 ? qSeries : revSeries;
  const prevQuarters = trendSeries.slice(1, 5).map((x) => ({
    period_end: x.end, form: x.form, revenue: val(x)
  }));

  return {
    cik,
    entity_name: data.entityName || '',
    currency,
    as_of: rev.end,
    latest: {
      period_end: rev.end,
      fy: rev.fy || null,
      fp: rev.fp || null,
      form: rev.form || null,
      filed: rev.filed || null,
      revenue: val(rev),
      revenue_yoy: revenueYoy,
      net_income: val(ni),
      net_income_yoy: netIncomeYoy,
      gross_profit: val(gp),
      gross_margin: grossMargin,
      operating_income: val(oi),
      rd_expense: val(rd),
      inventory: val(inv),
      inventory_qoq: inventoryQoq,
      capex_ytd: val(capex),
      eps: val(eps)
    },
    prev_quarters: prevQuarters
  };
}

/**
 * CFM 闪存市场（www.chinaflashmarket.com）DRAM/NAND 现货价。
 * 中文站首页直接渲染价格表格（UTF-8，无需登录），解析「DDR4 16Gb 3200」与「256Gb TLC」当前价。
 * @returns {Promise<{dram:{value:number}, nand:{value:number}}>}
 */
async function fetchStoragePrice() {
  const url = 'https://www.chinaflashmarket.com/';
  const res = await http.get(url, {
    headers: { 'User-Agent': UA, Referer: 'https://www.chinaflashmarket.com/' }
  });
  const html = typeof res.data === 'string' ? res.data : Buffer.from(res.data).toString('utf-8');
  // 定位目标价格项 href，再非贪婪匹配紧随其后的 new-price 数值
  const pick = (href, label) => {
    const re = new RegExp(`/price/${href}">[^<]*</a></th>[\\s\\S]*?new-price[^>]*>\\s*<b>\\$</b>\\s*([\\d.]+)`);
    const m = html.match(re);
    if (!m) throw new Error(`${label} 价格解析失败`);
    const v = num(m[1]);
    if (v == null) throw new Error(`${label} 价格为空`);
    return v;
  };
  const dram = pick('ews/100222', 'DDR4 16Gb 3200');
  const nand = pick('in/100164', '256Gb TLC');
  return { dram: { value: dram }, nand: { value: nand } };
}

/**
 * 全球黄金 ETF（SPDR GLD）持仓量（吨），来自金小秘 t-goldream.com（UTF-8，直接渲染表格）。
 * 映射到 518880 黄金 ETF 的「黄金ETF资金」指标，反映全球黄金配置盘资金流向。
 * @returns {Promise<{value:number, date:string}>}
 */
async function fetchGoldEtfHolding() {
  const url = 'https://t-goldream.com/gold-observation?section=global-gold-etf';
  const res = await http.get(url, {
    headers: { 'User-Agent': UA, Referer: 'https://t-goldream.com/' }
  });
  const html = typeof res.data === 'string' ? res.data : Buffer.from(res.data).toString('utf-8');
  // 定位 GLD 主行（data-etf-toggle="daily-etf-history-gld"），提取日期与持仓吨数
  const m = html.match(/data-etf-toggle="daily-etf-history-gld"[\s\S]*?<td>(\d{4}-\d{2}-\d{2})<\/td>\s*<td>([\d.]+)吨<\/td>/);
  if (!m) throw new Error('GLD 持仓解析失败');
  const value = num(m[2]);
  if (value == null) throw new Error('GLD 持仓为空');
  return { value, date: m[1] };
}

/**
 * 巨潮资讯全文搜索（证监会指定官方披露平台，免费无 Key）。
 * POST http://www.cninfo.com.cn/new/fulltextSearch/full
 * 返回公告元数据（标题/公司/时间），不含 PDF 正文。
 * @param {string} keyword 搜索关键词
 * @param {string} startDate YYYY-MM-DD
 * @param {string} endDate YYYY-MM-DD
 * @param {number} pageSize 条数
 * @returns {Promise<Array<{title:string, secName:string, time:string|null}>>}
 */
async function fetchCninfoNews(keyword, startDate, endDate, pageSize = 10) {
  const url = 'https://www.cninfo.com.cn/new/fulltextSearch/full';
  const body = new URLSearchParams({
    searchkey: keyword, sdate: startDate, edate: endDate,
    isfulltext: 'false', sortName: 'pubdate', sortType: 'desc',
    pageNum: '1', pageSize: String(pageSize)
  });
  const res = await http.post(url, body.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'User-Agent': UA,
      'Referer': 'https://www.cninfo.com.cn/'
    }
  });
  const anns = res.data && res.data.announcements;
  if (!anns || !anns.length) return [];
  return anns
    .map((a) => ({
      title: String(a.announcementTitle || '').replace(/<[^>]*>/g, '').trim(),
      secName: a.secName || '',
      // 修复：巨潮 announcementTime 本身是毫秒级时间戳（15 位），不能再 ×1000（会变微秒级超大值，导致排序错乱）
      time: a.announcementTime ? new Date(Number(a.announcementTime)).toISOString() : null
    }))
    .filter((x) => x.title);
}

/**
 * 东财 7×24 快讯（财联社电报的替代，免费无 Key，内容同质且更新快）。
 * 接口：np-listapi.eastmoney.com/comm/web/getFastNewsList（JSON）
 * @param {number} limit 条数
 * @returns {Promise<Array<{title:string, summary:string, code:string, show_time:string, stock_list:Array}>>}
 */
async function fetchEastmoneyFastNews(limit = 30) {
  const url = `https://np-listapi.eastmoney.com/comm/web/getFastNewsList?client=web&biz=web_724&fastColumn=102&sortEnd=&pageSize=${limit}&req_trace=${Date.now()}`;
  const res = await http.get(url, {
    headers: { 'User-Agent': UA, Referer: 'https://kuaixun.eastmoney.com/' }
  });
  const list = res.data && res.data.data && res.data.data.fastNewsList;
  if (!list || !list.length) throw new Error('东财快讯为空');
  return list.map((x) => ({
    title: String(x.title || '').slice(0, 140),
    summary: String(x.summary || x.title || '').slice(0, 400),
    code: String(x.code || ''),
    show_time: String(x.showTime || ''),
    stock_list: Array.isArray(x.stockList) ? x.stockList : []
  }));
}

/**
 * ETF 前十大重仓（天天基金季报持仓，免费无 Key）。
 * 黄金 ETF 无股票持仓时返回空数组。
 * @returns {Promise<{report_date:string|null, holdings:Array}>}
 */
async function fetchEtfHoldings(code) {
  const url = `https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=${code}&topline=10&year=&month=`;
  const res = await http.get(url, {
    headers: { 'User-Agent': UA, Referer: 'https://fund.eastmoney.com/' }
  });
  const html = typeof res.data === 'string' ? res.data : String(res.data || '');
  const dateM = html.match(/截止至：<font[^>]*>([^<]+)<\/font>/);
  const reportDate = dateM ? String(dateM[1]).trim() : null;
  const holdings = [];
  const seen = {};
  String(html).split(/<tr>/).forEach((tr) => {
    const row = parseHoldingRow(tr);
    if (!row || seen[row.stock_code]) return;
    seen[row.stock_code] = true;
    holdings.push(row);
  });
  holdings.sort((a, b) => a.rank - b.rank);
  return { report_date: reportDate, holdings: holdings.slice(0, 10) };
}

/**
 * 东财宏观数据（CPI/PMI/PPI/GDP 等，datacenter-web 报表）。
 * 接口：datacenter-web.eastmoney.com/api/data/v1/get?reportName=xxx
 * @param {string} reportName 报表名（RPT_ECONOMY_CPI / _PMI / _PPI / _GDP）
 * @param {number} pageSize 条数
 * @returns {Promise<Array<object>>} 原始数据数组（按 REPORT_DATE 倒序）
 */
async function fetchEastmoneyMacro(reportName, pageSize = 8) {
  const url = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=${reportName}&columns=ALL&pageSize=${pageSize}&pageNumber=1&sortColumns=REPORT_DATE&sortTypes=-1`;
  const res = await http.get(url, {
    headers: { 'User-Agent': UA, Referer: 'https://data.eastmoney.com/' }
  });
  const data = res.data && res.data.result && res.data.result.data;
  if (!data || !data.length) throw new Error(`东财宏观为空 ${reportName}`);
  return data;
}

/**
 * 港交所披露易：代码 → 内部 stockId。
 * @param {string} code 港股代码
 */
async function fetchHkexStockId(code) {
  const hk = overseas.padHkCode(code);
  if (!hk) return null;
  const url = `https://www1.hkexnews.hk/search/prefix.do?callback=callback&lang=ZH&type=A&name=${encodeURIComponent(hk)}&market=SEHK`;
  const res = await http.get(url, {
    headers: { 'User-Agent': UA, Referer: 'https://www1.hkexnews.hk/search/titlesearch.xhtml' }
  });
  return overseas.parseHkexPrefix(typeof res.data === 'string' ? res.data : String(res.data || ''));
}

/**
 * 港交所公司公告标题（JSON，免费无 Key）。
 * @returns {Promise<Array<{title, secName, time, url}>>}
 */
async function fetchHkexAnnouncements(code, startDate, endDate, pageSize = 8) {
  const meta = await fetchHkexStockId(code);
  if (!meta) return [];
  const from = overseas.ymd(startDate);
  const to = overseas.ymd(endDate);
  const url = `https://www1.hkexnews.hk/search/titleSearchServlet.do?lang=ZH&category=0&market=SEHK&searchType=1&documentType=-1&t1code=-1&t2Gcode=-2&t2code=-2&stockId=${encodeURIComponent(meta.stockId)}&from=${from}&to=${to}&title=&searchMode=1`;
  const res = await http.get(url, {
    headers: { 'User-Agent': UA, Referer: 'https://www1.hkexnews.hk/search/titlesearch.xhtml' }
  });
  const rows = overseas.parseHkexSearch(typeof res.data === 'string' ? res.data : JSON.stringify(res.data || {}));
  return rows.filter((x) => !overseas.isHkexNoise(x)).slice(0, pageSize);
}

/**
 * 东财港股利润表：营运收入同比。
 * @returns {Promise<{period_end, revenue, revenue_yoy, currency}|null>}
 */
async function fetchHkOperatingIncome(code) {
  const hk = overseas.padHkCode(code);
  if (!hk) return null;
  const url = `https://datacenter.eastmoney.com/securities/api/data/v1/get?reportName=RPT_HKF10_FN_INCOME&columns=ALL&filter=(SECURITY_CODE%3D%22${hk}%22)&pageSize=80&pageNumber=1&sortColumns=REPORT_DATE&sortTypes=-1&source=SECURITIES&client=PC`;
  const res = await http.get(url, {
    headers: { 'User-Agent': UA, Referer: 'https://emweb.securities.eastmoney.com/' }
  });
  const rows = res.data && res.data.result && res.data.result.data;
  return overseas.pickHkOperatingIncome(rows || []);
}

function dartKey() {
  return String(process.env.OPENDART_API_KEY || '').trim();
}

/**
 * OpenDART 披露列表。英文站 Key 优先走英接口，失败再试韩接口。
 */
async function fetchDartDisclosures(corpCode, startDate, endDate, apiKey, pageSize = 8) {
  const key = apiKey || dartKey();
  if (!key) throw new Error('缺少 OPENDART_API_KEY');
  const bgn = overseas.ymd(startDate);
  const end = overseas.ymd(endDate);
  const qs = `crtfc_key=${encodeURIComponent(key)}&corp_code=${encodeURIComponent(corpCode)}&bgn_de=${bgn}&end_de=${end}&page_count=${pageSize}`;
  const urls = [
    `https://engopendart.fss.or.kr/engapi/list.json?${qs}`,
    `https://opendart.fss.or.kr/api/list.json?${qs}`
  ];
  let lastErr = null;
  for (const url of urls) {
    try {
      const res = await http.get(url, {
        headers: { 'User-Agent': 'etf-decision-engine contact@example.com' },
        timeout: 20000
      });
      const rows = overseas.parseDartList(res.data);
      const kept = rows.filter((x) => !overseas.isDartNoise(x)).slice(0, pageSize);
      if (kept.length > 0) return kept;
      lastErr = new Error('DART 披露为空');
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

/**
 * OpenDART 单家主要科目（最新能读到的年/季报）。
 */
async function fetchDartFinancials(corpCode, apiKey) {
  const key = apiKey || dartKey();
  if (!key) throw new Error('缺少 OPENDART_API_KEY');
  const year = new Date().getFullYear();
  const reports = ['11014', '11012', '11013', '11011'];
  const hosts = [
    'https://engopendart.fss.or.kr/engapi/fnlttSinglAcnt.json',
    'https://opendart.fss.or.kr/api/fnlttSinglAcnt.json'
  ];
  let lastErr = null;
  for (const y of [year, year - 1]) {
    for (const reprt of reports) {
      for (const host of hosts) {
        try {
          const url = `${host}?crtfc_key=${encodeURIComponent(key)}&corp_code=${encodeURIComponent(corpCode)}&bsns_year=${y}&reprt_code=${reprt}`;
          const res = await http.get(url, {
            headers: { 'User-Agent': 'etf-decision-engine contact@example.com' },
            timeout: 20000
          });
          const picked = overseas.pickDartAccounts((res.data && res.data.list) || []);
          if (picked.revenue != null) {
            picked.form = reprt;
            picked.fy = y;
            return picked;
          }
        } catch (e) {
          lastErr = e;
        }
      }
    }
  }
  if (lastErr) throw lastErr;
  return null;
}

/**
 * 东财文章搜索（必须 JSONP，无 cb 会 400）。只留获批/CDE/BD 等事件标题。
 */
async function fetchEastmoneySearchNews(keyword, pageSize = 8) {
  const q = String(keyword || '').trim();
  if (!q) return [];
  const url = biotech.eastmoneySearchUrl(q, pageSize);
  const res = await http.get(url, {
    headers: { 'User-Agent': UA, Referer: 'https://so.eastmoney.com/' },
    timeout: 20000
  });
  const rows = biotech.parseEastmoneySearchJsonp(typeof res.data === 'string' ? res.data : JSON.stringify(res.data || {}));
  return rows.filter((x) => biotech.isBiotechEvent(x)).slice(0, 3);
}

/**
 * ClinicalTrials.gov v2：按申办方英文名拉最近登记/状态变更。
 */
async function fetchClinicalTrials(term, pageSize = 5) {
  const q = String(term || '').trim();
  if (!q) return [];
  const url = `https://clinicaltrials.gov/api/v2/studies?query.term=${encodeURIComponent(q)}&pageSize=${pageSize}&fields=NCTId,BriefTitle,OverallStatus,LastUpdatePostDate,LeadSponsorName,Phase,Condition`;
  const res = await http.get(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    timeout: 20000
  });
  return biotech.parseClinicalTrials(res.data);
}

/**
 * openFDA Drugs@FDA：按商品名搜（申办方名经常 NOT_FOUND）。
 */
async function fetchOpenFdaApprovals(query, limit = 2) {
  const q = String(query || '').trim();
  if (!q) return [];
  const url = `https://api.fda.gov/drug/drugsfda.json?search=${encodeURIComponent(q)}&limit=${limit}`;
  try {
    const res = await http.get(url, {
      headers: { 'User-Agent': UA },
      timeout: 20000
    });
    return biotech.parseOpenFda(res.data);
  } catch (e) {
    const code = e && e.response && e.response.status;
    if (code === 404) return [];
    throw e;
  }
}

module.exports = {
  http,
  sleep,
  num,
  toSecid,
  toSymbol,
  decodeBuffer,
  fetchWithRetry,
  isTradingDay,
  fetchDailyEastmoney,
  fetchDailyTencent,
  fetchDailySina,
  fetchDaily,
  fetchRealtime,
  fetchPremiumIopv,
  fetchFredSeries,
  fetchDollarIndex,
  fetchIndexWeekly,
  fetchGlobalDaily,
  fetchSecCompanyFacts,
  fetchStoragePrice,
  fetchGoldEtfHolding,
  fetchCninfoNews,
  fetchEastmoneyFastNews,
  fetchEastmoneyMacro,
  fetchEtfHoldings,
  fetchHkexStockId,
  fetchHkexAnnouncements,
  fetchHkOperatingIncome,
  fetchDartDisclosures,
  fetchDartFinancials,
  fetchEastmoneySearchNews,
  fetchClinicalTrials,
  fetchOpenFdaApprovals,
  parseHoldingRow
};
