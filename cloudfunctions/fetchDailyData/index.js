/**
 * 云函数：fetchDailyData —— 收盘后抓日线 OHLCV/折溢价 + FRED 宏观
 * 触发：定时 15:30/22:00 + 手动 HTTP
 * 流程：节假日/幂等校验 → 抓取（重试3次）→ 写 etf_daily + fetch_log → 链式 materializeIndicators
 */

'use strict';

const cloudbase = require('@cloudbase/node-sdk');
const db = require('./common/utils/db');
const datasource = require('./common/utils/datasource');
const { beijingNow, beijingDateStr, isOfficialDailyBar } = require('./common/utils/fetch-guard');
const { COLLECTIONS, MARKET_INDEXES, GLOBAL_TICKERS } = require('./common/constants');

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });

/** 写抓取日志 */
async function logFetch(source, status, itemCount, error, taskName, durationMs) {
  try {
    await db.getCollection(COLLECTIONS.FETCH_LOG).add({
      source, fetch_time: new Date(), status, item_count: itemCount || 0,
      error: error || '', task_name: taskName || 'fetchDailyData', duration_ms: durationMs || 0
    });
  } catch (e) { /* 日志失败不阻断主流程 */ }
}

/**
 * 幂等检查：正式日线以 **volume 非空** 判定（V3.1 A1）。
 * 盘中 stub 即使误写 source='tencent'（close=price, volume=null）也不得跳过 15:30 收盘抓取。
 */
async function isAlreadyFetched(codes) {
  const dateStr = beijingDateStr(beijingNow());
  const rows = await db.query(COLLECTIONS.ETF_DAILY, { trade_date: dateStr }, { limit: 200 });
  const byCode = {};
  for (const r of rows) {
    if (!isOfficialDailyBar(r)) continue;
    if (!byCode[r.code]) byCode[r.code] = { count: 0 };
    byCode[r.code].count += 1;
  }
  return codes.every((code) => byCode[code] && byCode[code].count >= 1);
}

exports.isAlreadyFetched = isAlreadyFetched;
exports.isOfficialDailyBar = isOfficialDailyBar;

exports.main = async (event = {}, context = {}) => {
  // 诊断模式：测试云函数出站网络（DNS + HTTP）
  if (event && event.diag) {
    const dns = require('dns');
    const diag = {};
    try {
      const t = Date.now();
      const addrs = await new Promise((res, rej) => dns.lookup('qt.gtimg.cn', (e, a) => e ? rej(e) : res(a)));
      diag.dns = { host: 'qt.gtimg.cn', addrs, ms: Date.now() - t };
    } catch (e) { diag.dns = { error: String(e.message || e) }; }
    try {
      const axios = require('axios');
      const t = Date.now();
      const res = await axios.get('https://qt.gtimg.cn/q=sh513310', { timeout: 8000, responseType: 'arraybuffer' });
      diag.http = { host: 'qt.gtimg.cn', status: res.status, bytes: (res.data && res.data.length) || 0, ms: Date.now() - t };
    } catch (e) { diag.http = { error: String(e.message || e) }; }
    return { ok: true, diag };
  }

  const taskName = (event && event.task_name) || 'fetchDailyData';
  const startedAt = Date.now();
  const results = [];

  try {
    // 1. 节假日校验（force 模式跳过，允许周末手动补抓历史数据跑通全链路）
    const today = beijingDateStr(beijingNow());
    const isForce = (event && event.force) === true;
    if (!isForce && !datasource.isTradingDay(today)) {
      return { ok: true, skipped: 'holiday', date: today, message: '非交易日，跳过' };
    }

    // 2. ETF 列表（不硬编码，读 etf_basic）
    const etfs = await db.getEtfList();
    const codes = etfs.map((e) => e.code);

    // 3. 幂等跳过
    if ((event && event.force) !== true && (await isAlreadyFetched(codes))) {
      return { ok: true, skipped: 'already_fetched', date: today, message: '数据已存在，幂等跳过' };
    }

    // 4. 抓取 5 只 ETF 日线 + 折溢价
    let totalBars = 0;
    for (const etf of etfs) {
      try {
        const { bars, source } = await datasource.fetchDaily(etf.code, 260);
        // 并发写入（分批，避免逐条 await 导致超时）；用 upsert 保证幂等
        const chunks = [];
        for (let i = 0; i < bars.length; i += 20) chunks.push(bars.slice(i, i + 20));
        for (const chunk of chunks) {
          await Promise.all(chunk.map((bar) => {
            const doc = { code: etf.code, ...bar, premium_rate: null, iopv: null };
            return db.upsert(COLLECTIONS.ETF_DAILY, doc, { code: etf.code, trade_date: bar.trade_date });
          }));
        }
        totalBars += bars.length;

        // 折溢价/IOPV（失败不阻断，缺数标 null 不编造）
        try {
          const prem = await datasource.fetchPremiumIopv(etf.code);
          if (prem && (prem.premium_rate != null || prem.iopv != null)) {
            const latestDate = bars.length ? bars[bars.length - 1].trade_date : null;
            if (latestDate) {
              const doc = await db.query(COLLECTIONS.ETF_DAILY, { code: etf.code, trade_date: latestDate }, { limit: 1 });
              if (doc.length > 0) {
                const id = doc[0]._id;
                await db.updateById(COLLECTIONS.ETF_DAILY, id, { premium_rate: prem.premium_rate, iopv: prem.iopv });
              }
            }
          }
        } catch (e) { /* 折溢价缺失不阻断 */ }

        results.push({ code: etf.code, bars: bars.length, source, ok: true });
      } catch (e) {
        results.push({ code: etf.code, bars: 0, source: null, ok: false, error: String(e.message || e) });
        await logFetch('daily', 'fail', 0, String(e.message || e), taskName, Date.now() - startedAt);
      }
    }

    // 5. FRED 宏观（518880 黄金实际利率，可选，失败不阻断）→ 落库 fundamental_series
    try {
      const fredKey = process.env.FRED_API_KEY || '';
      if (fredKey) {
        const realRate = await datasource.fetchFredSeries('DFII10', fredKey);
        if (Array.isArray(realRate) && realRate.length > 0) {
          const latest = realRate[realRate.length - 1];
          const value = Number(latest.value);
          const dataDate = latest.date || beijingDateStr(beijingNow());
          if (!Number.isNaN(value)) {
            // direction 与前值比较
            const prevRows = await db.query(COLLECTIONS.FUNDAMENTAL_SERIES,
              { code: '518880', indicator: 'real_rate' },
              { orderBy: [{ field: 'data_date', direction: 'desc' }], limit: 1 });
            const prev = prevRows.length > 0 ? prevRows[0].value : null;
            let direction = 'na';
            if (prev != null) {
              if (value > prev) direction = 'up';
              else if (value < prev) direction = 'down';
              else direction = 'flat';
            }
            await db.upsert(COLLECTIONS.FUNDAMENTAL_SERIES, {
              code: '518880', indicator: 'real_rate', data_date: dataDate, value, prev, direction,
              source: 'fred', confidence: 0.9, unit: '%', note: 'DFII10 美国10年期实际利率'
            }, { code: '518880', indicator: 'real_rate', data_date: dataDate });
          }
        }
        await logFetch('fred', 'success', realRate.length, '', taskName, Date.now() - startedAt);
      }
    } catch (e) {
      await logFetch('fred', 'fail', 0, String(e.message || e), taskName, Date.now() - startedAt);
    }

    // 5b. 美元指数（新浪免费行情，无需 key，失败不阻断）→ 落库 fundamental_series
    try {
      const dxy = await datasource.fetchDollarIndex();
      if (dxy && dxy.value != null) {
        const dataDate = dxy.date || beijingDateStr(beijingNow());
        // direction 与前值比较（首次为 na）
        const prevRows = await db.query(COLLECTIONS.FUNDAMENTAL_SERIES,
          { code: '518880', indicator: 'dollar_index' },
          { orderBy: [{ field: 'data_date', direction: 'desc' }], limit: 1 });
        const prev = prevRows.length > 0 ? prevRows[0].value : null;
        let direction = 'na';
        if (prev != null) {
          if (dxy.value > prev) direction = 'up';
          else if (dxy.value < prev) direction = 'down';
          else direction = 'flat';
        }
        await db.upsert(COLLECTIONS.FUNDAMENTAL_SERIES, {
          code: '518880', indicator: 'dollar_index', data_date: dataDate, value: dxy.value, prev, direction,
          source: 'tencent', confidence: 0.9, unit: ''
        }, { code: '518880', indicator: 'dollar_index', data_date: dataDate });
        await logFetch('dollar_index', 'success', 1, '', taskName, Date.now() - startedAt);
      }
    } catch (e) {
      await logFetch('dollar_index', 'fail', 0, String(e.message || e), taskName, Date.now() - startedAt);
    }

    // 5c. 存储 DRAM/NAND 现货价（CFM 闪存市场，免费无需 key，失败不阻断）→ 落库 fundamental_series
    try {
      const sp = await datasource.fetchStoragePrice();
      if (sp && sp.dram && sp.dram.value != null && sp.nand && sp.nand.value != null) {
        const dataDate = beijingDateStr(beijingNow());
        // 写入 dram_price 与 nand_price（513310 存储周期）
        const pairs = [['dram_price', sp.dram], ['nand_price', sp.nand]];
        for (const [indicator, priceInfo] of pairs) {
          const prevRows = await db.query(COLLECTIONS.FUNDAMENTAL_SERIES,
            { code: '513310', indicator },
            { orderBy: [{ field: 'data_date', direction: 'desc' }], limit: 1 });
          const prev = prevRows.length > 0 ? prevRows[0].value : null;
          let direction = 'na';
          if (prev != null) {
            if (priceInfo.value > prev) direction = 'up';
            else if (priceInfo.value < prev) direction = 'down';
            else direction = 'flat';
          }
          await db.upsert(COLLECTIONS.FUNDAMENTAL_SERIES, {
            code: '513310', indicator, data_date: dataDate, value: priceInfo.value, prev, direction,
            source: 'chinaflashmarket', confidence: 0.85, unit: 'USD'
          }, { code: '513310', indicator, data_date: dataDate });
        }
        await logFetch('storage_price', 'success', 2, '', taskName, Date.now() - startedAt);
      }
    } catch (e) {
      await logFetch('storage_price', 'fail', 0, String(e.message || e), taskName, Date.now() - startedAt);
    }

    await logFetch('daily', totalBars > 0 ? 'success' : 'partial', totalBars, '', taskName, Date.now() - startedAt);

    // 5d. 全球黄金 ETF（SPDR GLD）持仓（金小秘 t-goldream，免费无需 key，失败不阻断）→ 落库 fundamental_series
    try {
      const gld = await datasource.fetchGoldEtfHolding();
      if (gld && gld.value != null) {
        const dataDate = gld.date || beijingDateStr(beijingNow());
        const prevRows = await db.query(COLLECTIONS.FUNDAMENTAL_SERIES,
          { code: '518880', indicator: 'etf_flow' },
          { orderBy: [{ field: 'data_date', direction: 'desc' }], limit: 1 });
        const prev = prevRows.length > 0 ? prevRows[0].value : null;
        let direction = 'na';
        if (prev != null) {
          if (gld.value > prev) direction = 'up';
          else if (gld.value < prev) direction = 'down';
          else direction = 'flat';
        }
        await db.upsert(COLLECTIONS.FUNDAMENTAL_SERIES, {
          code: '518880', indicator: 'etf_flow', data_date: dataDate, value: gld.value, prev, direction,
          source: 't-goldream', confidence: 0.85, unit: '吨'
        }, { code: '518880', indicator: 'etf_flow', data_date: dataDate });
        await logFetch('gold_etf_holding', 'success', 1, '', taskName, Date.now() - startedAt);
      }
    } catch (e) {
      await logFetch('gold_etf_holding', 'fail', 0, String(e.message || e), taskName, Date.now() - startedAt);
    }

    // 5e. 宽基指数周线（V2.1 市场环境推导，失败不阻断）→ 写 market_env
    try {
      for (const idx of MARKET_INDEXES) {
        const bars = await datasource.fetchIndexWeekly(idx.symbol, 60);
        if (!Array.isArray(bars) || bars.length === 0) continue;
        const latest = bars[bars.length - 1];
        await db.upsert(COLLECTIONS.MARKET_ENV, {
          index_code: idx.code,
          name: idx.name,
          trade_date: latest.date || beijingDateStr(beijingNow()),
          weekly_bars: bars.slice(-60),
          updated_at: new Date()
        }, { index_code: idx.code });
      }
      await logFetch('market_index', 'success', MARKET_INDEXES.length, '', taskName, Date.now() - startedAt);
    } catch (e) {
      await logFetch('market_index', 'fail', 0, String(e.message || e), taskName, Date.now() - startedAt);
    }

    // 5g. 海外关联标的（腾讯实时快照，每日累积，失败不阻断）→ 写 global_quote
    try {
      let globalCount = 0;
      for (const t of GLOBAL_TICKERS) {
        const bars = await datasource.fetchGlobalDaily(t, 320);
        if (!Array.isArray(bars) || bars.length === 0) continue;
        for (const bar of bars) {
          await db.upsert(COLLECTIONS.GLOBAL_QUOTE, {
            symbol: t.symbol,
            name: t.name,
            code: t.code,
            market: t.market,
            related: t.related,
            factor: t.factor,
            layer: t.layer,
            trade_date: bar.trade_date,
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
            volume: bar.volume,
            pct_change: bar.pct_change != null ? bar.pct_change : null
          }, { symbol: t.symbol, trade_date: bar.trade_date });
          globalCount += 1;
        }
      }
      await logFetch('global', globalCount > 0 ? 'success' : 'partial', globalCount, '', taskName, Date.now() - startedAt);
    } catch (e) {
      await logFetch('global', 'fail', 0, String(e.message || e), taskName, Date.now() - startedAt);
    }

    // 6. 链式调用 materializeIndicators
    let chained = null;
    try {
      chained = await app.callFunction({ name: 'materializeIndicators', data: { from: 'fetchDailyData' } });
    } catch (e) {
      chained = { error: String(e.message || e) };
    }

    return { ok: true, date: today, total_bars: totalBars, results, chained };
  } catch (e) {
    await logFetch('daily', 'fail', 0, String(e.message || e), taskName, Date.now() - startedAt);
    return { ok: false, error: String(e.message || e) };
  }
};
