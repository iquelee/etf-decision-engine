/**
 * 云函数：fetchDailyData —— 收盘后抓日线 OHLCV/折溢价 + FRED 宏观
 * 触发：定时 15:30/22:00 + 手动 HTTP
 * 流程：节假日/双 Lane 幂等校验 → 抓取（重试3次）→ 写 etf_daily + fetch_log → 链式 materializeIndicators
 *
 * WP-G1-DATA-01（方案 B+）：新增**独立 Benchmark Lane**。
 *   - production lane：Main5（来自 etf_basic / getEtfList）→ 决策 Universe，抓日线 + 折溢价
 *   - benchmark lane ：GEN1_BENCHMARK_CODES → Gen-1 rs_20d 基准，只写 etf_daily、不抓折溢价、
 *                      **绝不进入 etf_basic / getEtfList / 决策 Universe**
 *   两条 Lane 分别做幂等判定（任一缺失都不得 skip），失败语义见 daily-fetch-plan.js。
 */

'use strict';

const cloudbase = require('@cloudbase/node-sdk');
const db = require('./common/utils/db');
const datasource = require('./common/utils/datasource');
const { beijingNow, beijingDateStr, isOfficialDailyBar } = require('./common/utils/fetch-guard');
const { COLLECTIONS, MARKET_INDEXES, GLOBAL_TICKERS, GEN1_BENCHMARK_CODES } = require('./common/constants');
const {
  ROLE, planDailyFetch, summarizeDailyFetchResults, laneReadyCodes
} = require('./common/utils/daily-fetch-plan');

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

/** 读取「指定交易日」已落库的 etf_daily 行（两条 Lane 共用同一份快照做幂等判定）。 */
async function dailyRowsOn(dateStr) {
  return db.query(COLLECTIONS.ETF_DAILY, { trade_date: dateStr }, { limit: 500 });
}

/**
 * 幂等检查（单 Lane 兼容 API）：codes 是否都已有今日正式日线。
 * 正式日线以 **volume 非空** 判定（V3.1 A1）：盘中 stub 即使误写 source='tencent'
 * （close=price, volume=null）也不得跳过收盘抓取。
 *
 * ⚠️ 主流程**不再**直接使用它 —— 生产 ETF 与 Benchmark 必须分别判定
 * （见 `planDailyFetch`），否则「Main5 已就绪 + Benchmark 缺失」会被误判为已抓完。
 */
async function isAlreadyFetched(codes) {
  const dateStr = beijingDateStr(beijingNow());
  const rows = await dailyRowsOn(dateStr);
  const list = (codes || []).map(String);
  if (list.length === 0) return false;
  return laneReadyCodes(rows, list, dateStr, isOfficialDailyBar).length === list.length;
}

/**
 * 抓取并落库单个标的的日线 —— **生产 ETF 与 Benchmark 共用同一实现**（禁止复制粘贴）。
 *
 * @param {string} code
 * @param {object} [opts]
 * @param {string}  [opts.role]          ROLE.PRODUCTION_ETF | ROLE.BENCHMARK（仅审计，不落库）
 * @param {boolean} [opts.fetchPremium]  是否抓折溢价/IOPV（Benchmark 不需要，默认 true）
 * @param {number}  [opts.limit]         抓取条数（默认 260；Benchmark 用 320 覆盖完整滚动窗口）
 * @returns {Promise<{code, role, bars, source, ok, latest_date}>}
 */
async function fetchAndPersistDaily(code, opts) {
  const o = opts || {};
  const role = o.role || ROLE.PRODUCTION_ETF;
  const fetchPremium = o.fetchPremium !== false;
  const limit = Number(o.limit) > 0 ? Number(o.limit) : 260;

  const { bars, source } = await datasource.fetchDaily(code, limit);

  // 分批并发 upsert（幂等，key = code + trade_date）
  const chunks = [];
  for (let i = 0; i < bars.length; i += 20) chunks.push(bars.slice(i, i + 20));
  for (const chunk of chunks) {
    await Promise.all(chunk.map((bar) => {
      const doc = Object.assign({ code }, bar);
      if (role === ROLE.PRODUCTION_ETF) { doc.premium_rate = null; doc.iopv = null; }
      return db.upsert(COLLECTIONS.ETF_DAILY, doc, { code, trade_date: bar.trade_date });
    }));
  }
  const latestDate = bars.length ? bars[bars.length - 1].trade_date : null;

  // 折溢价/IOPV（仅生产 ETF；失败不阻断，缺数标 null 不编造）
  if (fetchPremium) {
    try {
      const prem = await datasource.fetchPremiumIopv(code);
      if (prem && (prem.premium_rate != null || prem.iopv != null) && latestDate) {
        const doc = await db.query(COLLECTIONS.ETF_DAILY, { code, trade_date: latestDate }, { limit: 1 });
        if (doc.length > 0) {
          await db.updateById(COLLECTIONS.ETF_DAILY, doc[0]._id,
            { premium_rate: prem.premium_rate, iopv: prem.iopv });
        }
      }
    } catch (e) { /* 折溢价缺失不阻断 */ }
  }

  return { code, role, bars: bars.length, source, ok: true, latest_date: latestDate };
}

exports.isAlreadyFetched = isAlreadyFetched;
exports.isOfficialDailyBar = isOfficialDailyBar;
exports.fetchAndPersistDaily = fetchAndPersistDaily;

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

    // 2. 两条 Lane 的标的清单
    //    - production lane：etf_basic 的 Main5（决策 Universe；getEtfList 永不返回 Benchmark）
    //    - benchmark lane ：GEN1_BENCHMARK_CODES（Gen-1 rs_20d 基准，只写 etf_daily）
    const etfs = await db.getEtfList();
    const decisionCodes = etfs.map((e) => e.code);
    const benchmarkCodes = GEN1_BENCHMARK_CODES.slice();

    // 3. 幂等：两条 Lane **分别**判定（★ Benchmark 缺失不得被 Main5 就绪掩盖）
    const force = (event && event.force) === true;
    const existingRows = await dailyRowsOn(today);
    const plan = planDailyFetch({
      decisionCodes, benchmarkCodes, existingRows, dateStr: today, force, isOfficial: isOfficialDailyBar
    });
    if (plan.skip) {
      const summary = summarizeDailyFetchResults({
        productionResults: decisionCodes.map((c) => ({ code: c, ok: true, latest_date: today })),
        benchmarkResults: benchmarkCodes.map((c) => ({ code: c, ok: true, latest_date: today })),
        benchmarkCode: benchmarkCodes[0] || null
      });
      return {
        ok: true, skipped: 'already_fetched', date: today,
        production_daily: summary.production_daily,
        benchmark_daily: summary.benchmark_daily,
        overall: summary.overall,
        message: '两条 Lane 当日正式日线均已就绪，幂等跳过'
      };
    }

    // 4. Production Lane：Main5 日线 + 折溢价
    let totalBars = 0;
    for (const etf of etfs) {
      try {
        const r = await fetchAndPersistDaily(etf.code, {
          role: ROLE.PRODUCTION_ETF, fetchPremium: true, limit: 260
        });
        totalBars += r.bars;
        results.push(r);
      } catch (e) {
        results.push({
          code: etf.code, role: ROLE.PRODUCTION_ETF, bars: 0, source: null, ok: false,
          error: String(e.message || e)
        });
        await logFetch('daily', 'fail', 0, String(e.message || e), taskName, Date.now() - startedAt);
      }
    }

    // 4b. Benchmark Lane：Gen-1 基准（320 根 → 首次即完成完整滚动窗口 backfill，之后每日幂等覆盖）
    //     失败只令数据任务 PARTIAL、Gen-1 后续 fail-closed；**不得阻断 V3.6.1 生产数据更新**
    const benchmarkResults = [];
    for (const code of benchmarkCodes) {
      try {
        const r = await fetchAndPersistDaily(code, {
          role: ROLE.BENCHMARK, fetchPremium: false, limit: 320
        });
        benchmarkResults.push(r);
        await logFetch('benchmark', 'success', r.bars, '', taskName, Date.now() - startedAt);
      } catch (e) {
        benchmarkResults.push({
          code, role: ROLE.BENCHMARK, bars: 0, source: null, ok: false, error: String(e.message || e)
        });
        await logFetch('benchmark', 'fail', 0, String(e.message || e), taskName, Date.now() - startedAt);
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

    // 7. 两条 Lane 汇总（显式上报，便于运维一眼看出 Main5 / 510300 是否就绪）
    const laneSummary = summarizeDailyFetchResults({
      productionResults: results,
      benchmarkResults,
      benchmarkCode: benchmarkCodes[0] || null
    });

    return {
      ok: true,
      date: today,
      total_bars: totalBars,
      results,
      production_daily: laneSummary.production_daily,
      benchmark_daily: laneSummary.benchmark_daily,
      overall: laneSummary.overall,
      chained
    };
  } catch (e) {
    await logFetch('daily', 'fail', 0, String(e.message || e), taskName, Date.now() - startedAt);
    return { ok: false, error: String(e.message || e) };
  }
};
