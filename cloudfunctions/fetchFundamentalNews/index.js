/**
 * 云函数：fetchFundamentalNews —— 搜集 5 只 ETF 赛道的基本面新闻/公告
 * 定时：intelFetch-30min 北京时间 08:00–22:00 每 30 分钟（含 22:00）；newsFetch-1630 工作日收盘后
 * 数据源：巨潮（A 股）+ 港交所披露易 + OpenDART（韩股，需 OPENDART_API_KEY）+ 东财港股利润表
 *        + 159570 东财搜索 / ClinicalTrials.gov / openFDA + 双上市 SEC（BGNE/ZLAB/HCM）
 * 处理：关键词规则初判方向（利好/利空/中性），落库 news_feed
 * 说明：本阶段为「搜集 + 初筛」原型；后续可接入 LLM 精确提取后写入 fundamental_series
 */

'use strict';

const cloudbase = require('@cloudbase/node-sdk');
const db = require('./common/utils/db');
const datasource = require('./common/utils/datasource');
const {
  COLLECTIONS, NEWS_SECTOR_KEYWORDS, NEWS_DIRECTION_KEYWORDS, SEC_FINANCIAL_TICKERS, MACRO_DEFS
} = require('./common/constants');
const { KR_DART_CORPS, dartCorpByStock, padHkCode } = require('./common/utils/overseas-filings');
const biotech = require('./common/utils/biotech-intel');

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });

function beijingNow() { return new Date(Date.now() + 8 * 3600 * 1000); }
function beijingDateStr(d) { return d.toISOString().slice(0, 10); }

const NEWS_TIMEOUT_MS = 540000;
const STALE_RUNNING_MS = 8 * 60 * 1000;
const RESERVE_MS = 20000;

/** 记录抓取日志（失败不阻断） */
async function logFetch(source, status, itemCount, error, taskName, durationMs) {
  try {
    await db.getCollection(COLLECTIONS.FETCH_LOG).add({
      source, fetch_time: new Date(), status, item_count: itemCount || 0,
      error: error || '', task_name: taskName || 'fetchFundamentalNews', duration_ms: durationMs || 0
    });
  } catch (e) { /* ignore */ }
}

function remainingMs(context, startedAt) {
  if (context && typeof context.getRemainingTimeInMillis === 'function') {
    try {
      const left = Number(context.getRemainingTimeInMillis());
      if (Number.isFinite(left)) return left;
    } catch (e) { /* ignore */ }
  }
  return Math.max(0, NEWS_TIMEOUT_MS - (Date.now() - startedAt));
}

function hasBudget(context, startedAt, needMs) {
  return remainingMs(context, startedAt) > (needMs + RESERVE_MS);
}

async function addJobLog(source, status, itemCount, error, taskName, durationMs) {
  try {
    const res = await db.getCollection(COLLECTIONS.FETCH_LOG).add({
      source, fetch_time: new Date(), status, item_count: itemCount || 0,
      error: error || '', task_name: taskName || 'fetchFundamentalNews', duration_ms: durationMs || 0
    });
    return (res && (res.id || res._id)) || null;
  } catch (e) { return null; }
}

async function closeJob(jobId, status, itemCount, error, taskName, durationMs) {
  if (jobId) {
    try {
      await db.updateById(COLLECTIONS.FETCH_LOG, jobId, {
        status, item_count: itemCount || 0, error: error || '', duration_ms: durationMs || 0
      });
      return;
    } catch (e) { /* fall through */ }
  }
  await logFetch('fundamental_news', status, itemCount, error, taskName, durationMs);
}

/** 把超时未收尾的 running 改成 fail；若仍有 8 分钟内的 running 则视为还在跑 */
async function sweepStaleNewsJobs() {
  const rows = await db.query(COLLECTIONS.FETCH_LOG, { source: 'fundamental_news' }, {
    orderBy: [{ field: 'fetch_time', direction: 'desc' }], limit: 40
  });
  const now = Date.now();
  let fresh = false;
  for (const r of rows) {
    if (!r || r.status !== 'running' || !r._id) continue;
    const age = now - new Date(r.fetch_time).getTime();
    if (Number.isFinite(age) && age < STALE_RUNNING_MS) fresh = true;
    else {
      try {
        await db.updateById(COLLECTIONS.FETCH_LOG, r._id, {
          status: 'fail',
          error: '超时未收尾（云函数被强制结束）',
          duration_ms: Number.isFinite(age) ? Math.round(age) : 0
        });
      } catch (e) { /* ignore */ }
    }
  }
  return fresh;
}

/** 按市场选公告源：港股港交所、韩股 OpenDART、A 股巨潮 */
async function fetchHoldingAnnouncements(etf, h, startDate, endDate) {
  const market = h.market || 'cn';
  if (market === 'hk') {
    const items = await datasource.fetchHkexAnnouncements(h.stock_code, startDate, endDate, 5);
    return { source: 'hkex_holding', items };
  }
  if (market === 'kr') {
    const corp = dartCorpByStock(h.stock_code);
    if (!corp) return { source: 'dart_holding', items: [] };
    if (!process.env.OPENDART_API_KEY) return { source: 'dart_holding', items: [] };
    const items = await datasource.fetchDartDisclosures(corp.corp_code, startDate, endDate, '', 6);
    return { source: 'dart_holding', items };
  }
  const searchKey = h.stock_name || h.stock_code;
  if (!searchKey) return { source: 'cninfo_holding', items: [] };
  const items = await datasource.fetchCninfoNews(searchKey, startDate, endDate, 3);
  return { source: 'cninfo_holding', items };
}

/**
 * 159570 持仓：东财搜索补 CDE/获批/BD，ClinicalTrials + openFDA 补官方状态。
 * 按现价十大匹配别名，不写死名单。
 */
async function fetchBiotechHoldingNews(h, startDate, endDate) {
  const alias = biotech.matchBiotechAlias(h);
  const keyword = (alias && alias.searchName) || h.stock_name;
  const out = [];
  if (keyword) {
    const rows = await datasource.fetchEastmoneySearchNews(keyword, 8);
    for (const r of rows) {
      if (!biotech.inDateWindow(r.time, startDate, endDate)) continue;
      out.push({
        title: r.title,
        time: r.time,
        url: r.url || '',
        secName: r.secName || h.stock_name || '',
        summary: r.summary || '',
        source: 'eastmoney_search'
      });
    }
    await datasource.sleep(250);
  }
  if (alias && alias.sponsors && alias.sponsors[0]) {
    const trials = await datasource.fetchClinicalTrials(alias.sponsors[0], 5);
    for (const t of trials) {
      if (!biotech.inDateWindow(t.time, startDate, endDate)) continue;
      out.push({
        title: biotech.formatTrialTitle(t),
        time: t.time,
        url: t.url || '',
        secName: h.stock_name || '',
        summary: t.conditions || t.sponsor || '',
        source: 'clinicaltrials'
      });
    }
    await datasource.sleep(250);
  }
  for (const brand of (alias && alias.brands) || []) {
    const apps = await datasource.fetchOpenFdaApprovals(`openfda.brand_name:${brand}`, 2);
    for (const a of apps) {
      if (!biotech.inYmdWindow(a.statusDate, startDate, endDate)) continue;
      out.push({
        title: biotech.formatFdaTitle(a),
        time: a.time,
        url: a.url || '',
        secName: h.stock_name || '',
        summary: a.sponsor || '',
        source: 'openfda'
      });
    }
    await datasource.sleep(250);
  }
  return out;
}

async function upsertOverseasFinancial(row) {
  if (!row || !row.symbol || !row.period_end) return false;
  const existed = await db.query(COLLECTIONS.GLOBAL_FINANCIAL, { symbol: row.symbol, period_end: row.period_end }, { limit: 1 });
  if (existed.length > 0 && existed[0].revenue_yoy != null && row.revenue_yoy == null) return false;
  await db.upsert(COLLECTIONS.GLOBAL_FINANCIAL, { ...row, created_at: existed.length ? existed[0].created_at : new Date() }, { symbol: row.symbol, period_end: row.period_end });
  return true;
}

/** 关键词初判方向：positive/negative/neutral */
function judgeDirection(title) {
  const t = title || '';
  const pos = NEWS_DIRECTION_KEYWORDS.positive.some((k) => t.includes(k));
  const neg = NEWS_DIRECTION_KEYWORDS.negative.some((k) => t.includes(k));
  if (pos && !neg) return { direction: 'positive', confidence: 0.5 };
  if (neg && !pos) return { direction: 'negative', confidence: 0.5 };
  if (pos && neg) return { direction: 'neutral', confidence: 0.3 };
  return { direction: 'neutral', confidence: 0.3 };
}

exports.main = async (event = {}, context = {}) => {
  // 诊断/补抓模式：单家财报抓取（event.single=股票代码），event.save=true 时落库
  if (event && event.single) {
    const t = SEC_FINANCIAL_TICKERS.find((x) => x.code === event.single);
    if (!t) return { ok: false, error: `未找到 ${event.single}` };
    try {
      const facts = await datasource.fetchSecCompanyFacts(t);
      if (!facts || !facts.latest || !facts.latest.period_end) {
        return { ok: false, code: t.code, error: 'latest 为空' };
      }
      if (event.save) {
        const key = { symbol: t.symbol, period_end: facts.latest.period_end };
        await db.upsert(COLLECTIONS.GLOBAL_FINANCIAL, {
          symbol: t.symbol, name: t.name, code: t.code, cik: t.cik, related: t.related, factor: t.factor,
          entity_name: facts.entity_name, currency: facts.currency || 'USD',
          period_end: facts.latest.period_end, form: facts.latest.form, fy: facts.latest.fy,
          fp: facts.latest.fp, filed: facts.latest.filed,
          revenue: facts.latest.revenue, revenue_yoy: facts.latest.revenue_yoy,
          net_income: facts.latest.net_income, net_income_yoy: facts.latest.net_income_yoy,
          gross_profit: facts.latest.gross_profit, gross_margin: facts.latest.gross_margin,
          operating_income: facts.latest.operating_income, rd_expense: facts.latest.rd_expense,
          inventory: facts.latest.inventory, inventory_qoq: facts.latest.inventory_qoq,
          capex_ytd: facts.latest.capex_ytd, eps: facts.latest.eps, created_at: new Date()
        }, key);
        return { ok: true, code: t.code, saved: true, period_end: facts.latest.period_end };
      }
      return { ok: true, code: t.code, facts };
    } catch (e) {
      return { ok: false, code: t.code, error: String(e.message || e), stack: String(e.stack || '').slice(0, 600) };
    }
  }

  if (event && event.hk_income_only) {
    const started = Date.now();
    try { await db.ensureCollection(COLLECTIONS.ETF_HOLDINGS); } catch (e) { /* ignore */ }
    const holds = await db.query(COLLECTIONS.ETF_HOLDINGS, {}, { limit: 80 });
    const hkSeen = {};
    let saved = 0;
    const errors = [];
    const samples = [];
    for (const h of holds || []) {
      const hk = padHkCode(h.stock_code);
      if (!hk || hkSeen[hk]) continue;
      if (h.market && h.market !== 'hk') continue;
      hkSeen[hk] = true;
      try {
        const inc = await datasource.fetchHkOperatingIncome(hk);
        let wrote = false;
        if (inc && inc.period_end && inc.revenue_yoy != null) {
          wrote = await upsertOverseasFinancial({
            symbol: `hk${hk}`,
            name: h.stock_name || hk,
            code: hk,
            related: [h.code],
            factor: '港股持仓收入',
            currency: inc.currency || 'CNY',
            period_end: inc.period_end,
            form: inc.date_type === '002' ? 'HK-H1' : 'HK-AR',
            revenue: inc.revenue,
            revenue_yoy: inc.revenue_yoy
          });
          if (wrote) saved += 1;
        }
        samples.push({
          hk, name: h.stock_name || '', period: inc && inc.period_end, yoy: inc && inc.revenue_yoy, wrote
        });
        await datasource.sleep(200);
      } catch (e) {
        errors.push(`${hk}: ${String(e.message || e).slice(0, 50)}`);
      }
    }
    if (saved > 0) await logFetch('hk_income', 'success', saved, '', 'hk_income_only', Date.now() - started);
    return { ok: true, saved, scanned: Object.keys(hkSeen).length, samples, errors };
  }

  if (event && event.ensure_collections) {
    try {
      const r = await db.ensureCollection(COLLECTIONS.ETF_HOLDINGS);
      const rows = await db.query(COLLECTIONS.FETCH_LOG, { source: 'fundamental_news' }, {
        orderBy: [{ field: 'fetch_time', direction: 'desc' }], limit: 40
      });
      let closed = 0;
      for (const row of rows) {
        if (!row || row.status !== 'running' || !row._id) continue;
        await db.updateById(COLLECTIONS.FETCH_LOG, row._id, {
          status: 'fail', error: '部署后清理卡住的 running', duration_ms: 0
        });
        closed += 1;
      }
      return { ok: true, etf_holdings: r, closed_running: closed };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  }

  const taskName = (event && event.task_name) || 'fetchFundamentalNews';
  const startedAt = Date.now();
  const days = (event && event.days) || 7;
  const endDate = beijingDateStr(beijingNow());
  const startDate = beijingDateStr(new Date(Date.now() + 8 * 3600 * 1000 - days * 24 * 3600 * 1000));

  let total = 0;
  let inserted = 0;
  let biotechNewsCount = 0;
  const errors = [];
  const skipped = [];
  let jobId = null;

  try {
    const etfs = await db.getEtfList();
    try { await db.ensureCollection(COLLECTIONS.ETF_HOLDINGS); } catch (e) {
      errors.push(`ensure etf_holdings: ${String(e.message || e).slice(0, 80)}`);
    }
    const hasFresh = await sweepStaleNewsJobs();
    if (hasFresh && !(event && event.allow_concurrent)) {
      return { ok: true, skipped: true, message: '已有新闻搜集在执行，请等结束或超过 8 分钟后再点' };
    }
    jobId = await addJobLog('fundamental_news', 'running', 0, '开始搜集，先写十大持仓', taskName, 0);

    // 先落十大，避免后半段超时后页面一直空
    const holdingsByEtf = {};
    let holdingsCount = 0;
    if (!(event && event.skip_news)) {
    for (const etf of etfs) {
      try {
        const pack = await datasource.fetchEtfHoldings(etf.code);
        holdingsByEtf[etf.code] = pack.holdings || [];
        const reportDate = pack.report_date || endDate;
        for (const h of pack.holdings || []) {
          try {
            await db.upsert(COLLECTIONS.ETF_HOLDINGS, {
              code: etf.code,
              stock_code: h.stock_code,
              stock_name: h.stock_name,
              weight: h.weight,
              rank: h.rank,
              market: h.market || '',
              report_date: reportDate,
              updated_at: new Date()
            }, { code: etf.code, stock_code: h.stock_code, report_date: reportDate });
            holdingsCount += 1;
          } catch (e) {
            errors.push(`${etf.code}/${h.stock_code}/holdings: ${String(e.message || e).slice(0, 50)}`);
          }
        }
        await datasource.sleep(200);
      } catch (e) {
        errors.push(`${etf.code}/holdings: ${String(e.message || e).slice(0, 60)}`);
      }
    }
    if (holdingsCount > 0) {
      await logFetch('etf_holdings', 'success', holdingsCount, '', taskName, Date.now() - startedAt);
    }

    for (const etf of etfs) {
      if (!hasBudget(context, startedAt, 25000)) {
        skipped.push(`${etf.code}/news`);
        break;
      }
      // 港股通创新药不跑巨潮赛道词（创新药/获批会误收鲁抗等 A 股原料药）
      const keywords = etf.code === '159570' ? [] : (NEWS_SECTOR_KEYWORDS[etf.code] || []);
      for (const kw of keywords) {
        try {
          const anns = await datasource.fetchCninfoNews(kw, startDate, endDate, 10);
          for (const a of anns) {
            total += 1;
            const j = judgeDirection(a.title);
            await db.upsert(COLLECTIONS.NEWS_FEED, {
              code: etf.code,
              sector: etf.sector || '',
              title: a.title,
              sec_name: a.secName || '',
              publish_time: a.time ? new Date(a.time) : new Date(),
              direction: j.direction,
              confidence: j.confidence,
              source: 'cninfo',
              status: 'new',
              created_at: new Date()
            }, { code: etf.code, title: a.title });
            inserted += 1;
          }
          await datasource.sleep(300);
        } catch (e) {
          errors.push(`${etf.code}/${kw}: ${String(e.message || e).slice(0, 60)}`);
        }
      }

      try {
        const packHolds = (holdingsByEtf[etf.code] || []).slice(0, 8);
        for (const h of packHolds) {
          try {
            const packNews = await fetchHoldingAnnouncements(etf, h, startDate, endDate);
            for (const a of packNews.items) {
              total += 1;
              const j = judgeDirection(a.title);
              await db.upsert(COLLECTIONS.NEWS_FEED, {
                code: etf.code,
                sector: etf.sector || '',
                title: a.title,
                sec_name: a.secName || h.stock_name || '',
                publish_time: a.time ? new Date(a.time) : new Date(),
                direction: j.direction,
                confidence: j.confidence,
                source: packNews.source,
                status: 'new',
                url: a.url || '',
                stock_code: h.stock_code,
                stock_name: h.stock_name,
                holding_weight: h.weight,
                created_at: new Date()
              }, { code: etf.code, title: a.title });
              inserted += 1;
            }
            await datasource.sleep(250);
          } catch (e) {
            errors.push(`${etf.code}/${h.stock_code}: ${String(e.message || e).slice(0, 50)}`);
          }
          if (etf.code === '159570') {
            try {
              const intel = await fetchBiotechHoldingNews(h, startDate, endDate);
              for (const a of intel) {
                total += 1;
                const j = judgeDirection(a.title);
                await db.upsert(COLLECTIONS.NEWS_FEED, {
                  code: etf.code,
                  sector: etf.sector || '',
                  title: a.title,
                  sec_name: a.secName || h.stock_name || '',
                  publish_time: a.time ? new Date(a.time) : new Date(),
                  direction: j.direction,
                  confidence: j.confidence,
                  source: a.source,
                  status: 'new',
                  url: a.url || '',
                  summary: a.summary || '',
                  stock_code: h.stock_code,
                  stock_name: h.stock_name,
                  holding_weight: h.weight,
                  created_at: new Date()
                }, { code: etf.code, title: a.title });
                inserted += 1;
                biotechNewsCount += 1;
              }
            } catch (e) {
              errors.push(`${etf.code}/biotech/${h.stock_code}: ${String(e.message || e).slice(0, 50)}`);
            }
          }
        }
      } catch (e) {
        errors.push(`${etf.code}/holdings: ${String(e.message || e).slice(0, 60)}`);
      }
    }
    } // end if(!skip_news)

    let hkIncomeCount = 0;
    const hkSeen = {};
    for (const [etfCode, holds] of Object.entries(holdingsByEtf)) {
      for (const h of holds || []) {
        if (h.market !== 'hk') continue;
        const hk = padHkCode(h.stock_code);
        if (!hk || hkSeen[hk]) continue;
        hkSeen[hk] = true;
        try {
          const inc = await datasource.fetchHkOperatingIncome(hk);
          if (inc && inc.period_end && inc.revenue_yoy != null) {
            const saved = await upsertOverseasFinancial({
              symbol: `hk${hk}`,
              name: h.stock_name || hk,
              code: hk,
              related: [etfCode],
              factor: '港股持仓收入',
              currency: inc.currency || 'CNY',
              period_end: inc.period_end,
              form: inc.date_type === '002' ? 'HK-H1' : 'HK-AR',
              revenue: inc.revenue,
              revenue_yoy: inc.revenue_yoy
            });
            if (saved) hkIncomeCount += 1;
          }
          await datasource.sleep(250);
        } catch (e) {
          errors.push(`hk/${hk}: ${String(e.message || e).slice(0, 50)}`);
        }
      }
    }
    if (hkIncomeCount > 0) {
      await logFetch('hk_income', 'success', hkIncomeCount, '', taskName, Date.now() - startedAt);
    }

    let dartFinancialCount = 0;
    const dartKey = process.env.OPENDART_API_KEY || '';
    if (dartKey) {
      for (const corp of KR_DART_CORPS) {
        try {
          const facts = await datasource.fetchDartFinancials(corp.corp_code, dartKey);
          if (facts && facts.period_end) {
            const saved = await upsertOverseasFinancial({
              symbol: corp.symbol,
              name: corp.name,
              code: corp.stock_code,
              related: corp.related,
              factor: corp.factor,
              currency: 'KRW',
              period_end: facts.period_end,
              form: facts.form || 'DART',
              fy: facts.fy,
              revenue: facts.revenue,
              revenue_yoy: facts.revenue_yoy,
              net_income: facts.net_income,
              net_income_yoy: facts.net_income_yoy,
              operating_income: facts.operating_income
            });
            if (saved) dartFinancialCount += 1;
          }
          await datasource.sleep(400);
        } catch (e) {
          errors.push(`dart/${corp.stock_code}: ${String(e.message || e).slice(0, 50)}`);
        }
      }
      if (dartFinancialCount > 0) {
        await logFetch('dart_financial', 'success', dartFinancialCount, '', taskName, Date.now() - startedAt);
      }
    }

    // 东财 7×24 快讯抓取（财联社电报替代，免费无 Key，关键词匹配关联 ETF）
    let fastNewsCount = 0;
    try {
      const fastNews = await datasource.fetchEastmoneyFastNews(40);
      for (const fn of fastNews) {
        const blob = `${fn.title}${fn.summary}`;
        const stockCodes = (fn.stock_list || []).map((s) => String((s && (s.code || s.stockCode || s)) || ''));
        let matched = [];
        for (const [etfCode, holds] of Object.entries(holdingsByEtf)) {
          for (const h of holds || []) {
            const hitName = h.stock_name && blob.indexOf(h.stock_name) >= 0;
            const hitCode = h.stock_code && (blob.indexOf(h.stock_code) >= 0 || stockCodes.some((c) => c.indexOf(h.stock_code) >= 0));
            if (hitName || hitCode) matched.push({ etfCode, h });
          }
        }
        // P3.9：未命中持仓标的时，用赛道关键词补关联——所有命中的 ETF 都加入
        // （一条新闻可能同时关联多个 ETF，如"半导体设备"涉及 513310/159582/515880）；
        // 全部未命中的视为市场杂音（指数涨跌、集运、锂矿等），不写入 NEWS_FEED，避免污染 5 个 ETF 详情
        if (matched.length === 0) {
          for (const [etfCode, keywords] of Object.entries(NEWS_SECTOR_KEYWORDS)) {
            if (keywords.some((k) => blob.indexOf(k) >= 0)) matched.push({ etfCode, h: null });
          }
          if (matched.length === 0) continue; // 无任何赛道关联，丢弃
        }
        // P3.10：按 etfCode 去重——同一 ETF 多个持仓命中只保留首条，避免重复入库
        const seenEtf = {};
        matched = matched.filter((m) => {
          if (seenEtf[m.etfCode]) return false;
          seenEtf[m.etfCode] = true;
          return true;
        });
        const j = judgeDirection(fn.title);
        const pubTime = fn.show_time
          ? new Date(fn.show_time.replace(' ', 'T') + '+08:00') : new Date();
        for (const m of matched) {
          await db.upsert(COLLECTIONS.NEWS_FEED, {
            code: m.etfCode,
            title: fn.title,
            sec_name: m.h ? m.h.stock_name : '',
            publish_time: pubTime,
            direction: j.direction,
            confidence: j.confidence,
            source: 'eastmoney_fastnews',
            status: 'new',
            summary: fn.summary,
            news_code: fn.code,
            stock_list: fn.stock_list,
            stock_code: m.h ? m.h.stock_code : '',
            stock_name: m.h ? m.h.stock_name : '',
            holding_weight: m.h ? m.h.weight : null,
            created_at: new Date()
          }, { code: m.etfCode, title: fn.title, source: 'eastmoney_fastnews' });
          fastNewsCount += 1;
        }
      }
      await logFetch('eastmoney_fastnews', 'success', fastNewsCount, '', taskName, Date.now() - startedAt);
    } catch (e) {
      await logFetch('eastmoney_fastnews', 'fail', 0, String(e.message || e).slice(0, 80), taskName, Date.now() - startedAt);
    }

    // SEC 财报抓取（美国上市+ADR 公司，季度/年度，增量检测：新财报发布才落库）
    let secFinancialCount = 0;
    if (!hasBudget(context, startedAt, 90000)) {
      skipped.push('sec_financial');
    } else {
    for (const t of SEC_FINANCIAL_TICKERS) {
      if (!hasBudget(context, startedAt, 40000)) {
        skipped.push('sec_financial_rest');
        break;
      }
      try {
        const facts = await datasource.fetchSecCompanyFacts(t);
        if (facts && facts.latest && facts.latest.period_end) {
          console.log(`[sec] ${t.code} OK ${facts.latest.period_end} ${facts.latest.form} rev=${facts.latest.revenue}`);
          // 增量检测：该财报期已入库则跳过（季度数据，避免每日重复写）
          const key = { symbol: t.symbol, period_end: facts.latest.period_end };
          const existed = await db.query(COLLECTIONS.GLOBAL_FINANCIAL, key, { limit: 1 });
          if (existed.length === 0) {
            await db.upsert(COLLECTIONS.GLOBAL_FINANCIAL, {
              symbol: t.symbol,
              name: t.name,
              code: t.code,
              cik: t.cik,
              related: t.related,
              factor: t.factor,
              entity_name: facts.entity_name,
              currency: facts.currency || 'USD',
              period_end: facts.latest.period_end,
              form: facts.latest.form,
              fy: facts.latest.fy,
              fp: facts.latest.fp,
              filed: facts.latest.filed,
              revenue: facts.latest.revenue,
              revenue_yoy: facts.latest.revenue_yoy,
              net_income: facts.latest.net_income,
              net_income_yoy: facts.latest.net_income_yoy,
              gross_profit: facts.latest.gross_profit,
              gross_margin: facts.latest.gross_margin,
              operating_income: facts.latest.operating_income,
              rd_expense: facts.latest.rd_expense,
              inventory: facts.latest.inventory,
              inventory_qoq: facts.latest.inventory_qoq,
              capex_ytd: facts.latest.capex_ytd,
              eps: facts.latest.eps,
              created_at: new Date()
            }, key);
            secFinancialCount += 1;
          }
        } else {
          console.log(`[sec] ${t.code} SKIP latest为空`);
        }
        await datasource.sleep(400);
      } catch (e) {
        console.log(`[sec] ${t.code} ERROR ${String(e.message || e).slice(0, 80)}`);
        errors.push(`sec/${t.code}: ${String(e.message || e).slice(0, 60)}`);
      }
    }
    }
    if (secFinancialCount > 0) {
      await logFetch('sec_financial', 'success', secFinancialCount, '', taskName, Date.now() - startedAt);
    }

    // 东财宏观数据抓取（CPI/PMI/PPI/GDP，市场环境宏观维度，失败不阻断）
    let macroCount = 0;
    for (const m of MACRO_DEFS) {
      try {
        const rows = await datasource.fetchEastmoneyMacro(m.reportName, 8);
        for (const r of rows) {
          const reportDate = String(r.REPORT_DATE || '').slice(0, 7); // YYYY-MM
          const value = datasource.num(r[m.valueField]);
          if (reportDate && value != null) {
            const extra = {};
            (m.extraFields || []).forEach((f) => { extra[f] = r[f]; });
            await db.upsert(COLLECTIONS.MACRO, {
              indicator: m.indicator,
              name: m.name,
              report_date: reportDate,
              period_label: r.TIME || reportDate,
              value,
              unit: m.unit,
              note: m.note,
              ...extra,
              updated_at: new Date()
            }, { indicator: m.indicator, report_date: reportDate });
            macroCount += 1;
          }
        }
        await datasource.sleep(300);
      } catch (e) {
        errors.push(`macro/${m.indicator}: ${String(e.message || e).slice(0, 60)}`);
      }
    }
    if (macroCount > 0) {
      await logFetch('macro', 'success', macroCount, '', taskName, Date.now() - startedAt);
    }

    if (biotechNewsCount > 0) {
      await logFetch('biotech_intel', 'success', biotechNewsCount, '', taskName, Date.now() - startedAt);
    }
    const errText = [errors.slice(0, 3).join('; '), skipped.length ? `跳过:${skipped.join(',')}` : '']
      .filter(Boolean).join(' | ');
    const status = errors.length === 0 && skipped.length === 0 ? 'success' : 'partial';
    await closeJob(jobId, status, total, errText, taskName, Date.now() - startedAt);
    return { ok: true, date: endDate, total_fetched: total, inserted, sec_financial: secFinancialCount, fast_news: fastNewsCount, macro: macroCount, holdings: holdingsCount, hk_income: hkIncomeCount, dart_financial: dartFinancialCount, biotech_news: biotechNewsCount, etf_count: etfs.length, errors, skipped };
  } catch (e) {
    await closeJob(jobId, 'fail', 0, String(e.message || e), taskName, Date.now() - startedAt);
    return { ok: false, error: String(e.message || e) };
  }
};
