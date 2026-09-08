/**
 * 云函数：extractFundamental —— 用 DeepSeek 从 news_feed 新闻中提取基本面指标与方向
 * 流程：读 news_feed 未处理新闻 → 批量调 DeepSeek → 写 fundamental_series → 标记已处理
 * 说明：这是「新闻自动搜集 → LLM 语义提取 → 自动补充基本面」的第二步，替代人工录入。
 */

'use strict';

const cloudbase = require('@cloudbase/node-sdk');
const db = require('./common/utils/db');
const datasource = require('./common/utils/datasource');
const { clampConfidence } = require('./common/utils/fetch-guard');
const { COLLECTIONS, FINANCIAL_CONDUCTION_MAP, SEC_FINANCIAL_TICKERS } = require('./common/constants');
const fund = require('./common/utils/fundamental');
const { materializeHoldingsYoy, padHkCode } = require('./common/utils/overseas-filings');
const biotech = require('./common/utils/biotech-intel');

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });

/** 北京时间日期 YYYY-MM-DD（P2-4：LLM 提取日期用北京时间，勿用 toISOString 的 UTC 日，避免少 8 小时） */
function beijingDateStr(d = new Date()) {
  const bj = new Date(d.getTime() + 8 * 3600 * 1000);
  return bj.toISOString().slice(0, 10);
}

const INDICATOR_KEYS = fund.INDICATOR_KEYS;
const QUALITATIVE_KEYS = fund.QUALITATIVE_KEYS;

const FINANCIAL_SYSTEM_PROMPT = `你是 A 股 ETF 基本面传导分析助手。给定一家美国上市公司的财报核心数据，判断其对相关 A 股 ETF 基本面指标的传导信号。

输出 JSON：
{"results":[{"related":"513310","indicator":"capex","direction":"up","score":70,"confidence":0.7,"reason":"CapEx大幅上调，扩产"}, ...]}

规则：
1. related：从给定的「关联 ETF 及合法指标清单」里选 ETF 代码
2. indicator：从该 ETF 的合法传导指标清单里选最相关的一个
3. 只输出定性指标的 grade（1很差~5很好）。CapEx/营收等数字由系统直接入库，不要编造
4. direction、score 填 null
5. confidence：0.6~0.85
6. 无明确传导时不输出该条
7. 只返回 JSON，不要输出任何其他文字`;

const GLOBAL_SYSTEM_PROMPT = `你是 A 股 ETF 基本面传导分析助手。给定海外关联标的的走势摘要，判断这些海外标的对对应 ETF 基本面指标的传导信号。

输出 JSON：
{"results":[{"related":"513310","indicator":"hbm_demand","direction":"up","score":65,"confidence":0.7,"reason":"美光涨价+EWY强势"}, ...]}

规则：
1. related：ETF 代码（513310/515880/159582/518880/159570）
2. indicator：从该 ETF 的合法传导指标清单里选最相关的一个
3. 量化指标输出 direction（up=利好，down=利空，neutral=中性）+ score（-100~100 强度分：正=利好、负=利空、绝对值=强度）；定性指标输出 grade（1~5），score 填 null
4. confidence：0.6~0.8（海外传导是间接信号，置信度偏保守）
5. 海外走势与 ETF 基本面无明确传导关系时不输出该条
6. 只返回 JSON，不要输出任何其他文字`;

const SYSTEM_PROMPT = `你是 A 股 ETF 基本面分析助手。根据重仓股公告/快讯（或赛道新闻）判断对指定 ETF 哪个基本面指标的影响。

新闻可能标注「持股 名称 代码 占净值x%」。权重大的持股对 ETF 基本面影响更大，但不要因为股价涨跌打分。

只对定性指标输出 grade（1=很差，2=较差，3=中性，4=较好，5=很好）。硬数据/量化数字由系统抓取，不要编造价格、CapEx、渗透率。
无关新闻（纯人事、股权登记、例行会议）indicator 和 grade 都返回 null。
不要用海外股价涨跌代替基本面。
港股通创新药「核心产品销售」只看该 ETF 前十大持仓的商业化产品，例如：百济神州-泽布替尼、信达生物-单抗、康方生物-依沃西、翰森制药-阿美替尼、药明康德-CRO服务。鲁抗、原料药、仿制药、A股化学药不要打 core_sales。没有持股标注的赛道新闻不要打 core_sales。

返回 JSON：
{"results":[{"index":0,"indicator":"hbm_demand","grade":5,"confidence":0.8,"reason":"新易盛中标/指引上修"}, ...]}`;

/** 记录日志（失败不阻断） */
async function logFetch(source, status, itemCount, error, taskName, durationMs) {
  try {
    await db.getCollection(COLLECTIONS.FETCH_LOG).add({
      source, fetch_time: new Date(), status, item_count: itemCount || 0,
      error: error || '', task_name: taskName || 'extractFundamental', duration_ms: durationMs || 0
    });
  } catch (e) { /* ignore */ }
}

function parseScore(item, direction) {
  return fund.parseScore(item, direction);
}

/** P3.9：验证股票是否属于 ETF 赛道——防止科技公司 evidence 污染黄金/创新药等跨赛道指标 */
function isStockValidForEtf(stockName, stockCode, etfCode, holdingNames, holdingCodes) {
  if (!stockName && !stockCode) return true; // 无股票名的纯赛道新闻，不过滤
  // 1. 持仓匹配优先：股票名/代码在 ETF 持仓中
  if (holdingNames && holdingNames.has(stockName)) return true;
  if (holdingCodes && holdingCodes.has(stockCode)) return true;
  // 2. SEC 传导映射：股票是 SEC_FINANCIAL_TICKERS 公司，且 related 包含该 ETF
  for (const t of SEC_FINANCIAL_TICKERS) {
    if ((t.name === stockName || t.code === stockCode) && t.related && t.related.includes(etfCode)) {
      return true;
    }
  }
  return false;
}

async function rollupWeek(code, indicator, week) {
  let rows = await db.query(COLLECTIONS.FUNDAMENTAL_EVIDENCE, { code, indicator, week_date: week }, { limit: 80 });
  if (code === '159570' && indicator === 'core_sales') {
    rows = rows.filter((r) => biotech.isCoreSalesAllowed(r));
  }
  // P3.9：cross-contamination 安全网——过滤掉不属该 ETF 赛道的 evidence（科技公司污染黄金/创新药等）
  if (rows.length > 0) {
    let etfHoldings = [];
    try { etfHoldings = await db.query(COLLECTIONS.ETF_HOLDINGS, { code }, { limit: 30 }); } catch (e) { /* ignore */ }
    const hNames = new Set(etfHoldings.map((h) => h.stock_name).filter(Boolean));
    const hCodes = new Set(etfHoldings.map((h) => h.stock_code).filter(Boolean));
    rows = rows.filter((r) => {
      if (!r.stock_name && !r.stock_code) return true; // 纯赛道 evidence 保留
      // 持仓匹配优先：股票在 ETF 持仓中 → 永远有效
      if (hNames.has(r.stock_name) || hCodes.has(r.stock_code)) return true;
      // SEC 财报 evidence：检查股票是否在 SEC_TICKERS 中映射到该 ETF
      if (r.source === 'sec') {
        for (const t of SEC_FINANCIAL_TICKERS) {
          if ((t.name === r.stock_name || t.code === r.stock_code) && t.related && t.related.includes(code)) return true;
        }
        return false; // SEC 公司但 unrelated → 过滤
      }
      // 新闻 evidence 且不在持仓中 → 过滤
      return false;
    });
  }
  const grade = fund.aggregateQualitative(rows.map((r) => ({
    grade: r.grade, confidence: r.confidence, weight: r.holding_weight, source: r.source
  })));
  if (grade == null) return false;
  // P3.9：citations 按 stock_name 去重（同一公司多条 evidence 只保留首条，避免"美光科技"重复出现）
  const rawCitations = rows.slice(0, 6).map((r) => ({
    stock_code: r.stock_code || '',
    stock_name: r.stock_name || '',
    title: String(r.title || '').slice(0, 80),
    source: r.source || ''
  }));
  const seenStock = {};
  const citations = rawCitations.filter((c) => {
    const key = c.stock_name || c.stock_code || c.title;
    if (!key) return false;
    if (seenStock[key]) return false;
    seenStock[key] = true;
    return true;
  });
  const prevRows = await db.query(COLLECTIONS.FUNDAMENTAL_SERIES, { code, indicator }, {
    orderBy: [{ field: 'data_date', direction: 'desc' }], limit: 1
  });
  let prev = null;
  if (prevRows.length > 0 && prevRows[0].data_date !== week) prev = prevRows[0].value;
  await db.upsert(COLLECTIONS.FUNDAMENTAL_SERIES, {
    code, indicator, data_date: week, value: grade, prev,
    direction: 'na', source: 'llm_week', confidence: 0.7, unit: '级',
    layer: 'events',
    note: citations.map((c) => (c.stock_name ? `${c.stock_name}：` : '') + c.title).join('；').slice(0, 180),
    citations
  }, { code, indicator, data_date: week });
  return true;
}

async function writeQualitativeEvidence(payload) {
  if (payload.code === '159570' && payload.indicator === 'core_sales' && !biotech.isCoreSalesAllowed(payload)) {
    return;
  }
  const week = fund.weekDataDate();
  await db.upsert(COLLECTIONS.FUNDAMENTAL_EVIDENCE, {
    code: payload.code,
    indicator: payload.indicator,
    week_date: week,
    title: payload.title,
    stock_code: payload.stock_code || '',
    stock_name: payload.stock_name || '',
    holding_weight: payload.holding_weight != null ? payload.holding_weight : null,
    grade: payload.grade,
    confidence: payload.confidence,
    source: payload.source || 'deepseek',
    reason: (payload.reason || '').slice(0, 80),
    news_id: payload.news_id || '',
    created_at: new Date()
  }, { code: payload.code, indicator: payload.indicator, week_date: week, title: payload.title });
  await rollupWeek(payload.code, payload.indicator, week);
}

async function materializeSecHardData() {
  const rows = await db.query(COLLECTIONS.GLOBAL_FINANCIAL, {});
  if (rows.length === 0) return 0;
  const bySymbol = {};
  rows.forEach((r) => {
    if (!bySymbol[r.symbol] || r.period_end > bySymbol[r.symbol].period_end) bySymbol[r.symbol] = r;
  });
  let n = 0;
  for (const spec of fund.SEC_HARD_SPECS) {
    const value = fund.materializeSecValue(spec, bySymbol);
    if (value == null) continue;
    const used = spec.symbols.map((s) => bySymbol[s]).filter(Boolean);
    const dataDate = (used[0] && used[0].period_end) || beijingDateStr();
    const prevRows = await db.query(COLLECTIONS.FUNDAMENTAL_SERIES, { code: spec.code, indicator: spec.indicator }, {
      orderBy: [{ field: 'data_date', direction: 'desc' }], limit: 1
    });
    const prev = prevRows.length > 0 ? prevRows[0].value : null;
    let direction = 'na';
    if (prev != null) {
      if (value > prev) direction = 'up';
      else if (value < prev) direction = 'down';
      else direction = 'flat';
    }
    await db.upsert(COLLECTIONS.FUNDAMENTAL_SERIES, {
      code: spec.code, indicator: spec.indicator, data_date: dataDate,
      value, prev, direction, source: 'sec_hard', confidence: 0.9,
      unit: spec.unit, layer: 'hard_data',
      note: spec.symbols.filter((s) => bySymbol[s]).join('+')
    }, { code: spec.code, indicator: spec.indicator, data_date: dataDate });
    n += 1;
  }
  const hkN = await materializeHkLeadingRevenue(bySymbol);
  return n + hkN;
}

async function writeHardSeries(code, indicator, value, dataDate, unit, source, note) {
  const prevRows = await db.query(COLLECTIONS.FUNDAMENTAL_SERIES, { code, indicator }, {
    orderBy: [{ field: 'data_date', direction: 'desc' }], limit: 1
  });
  const prev = prevRows.length > 0 ? prevRows[0].value : null;
  let direction = 'na';
  if (prev != null) {
    if (value > prev) direction = 'up';
    else if (value < prev) direction = 'down';
    else direction = 'flat';
  }
  await db.upsert(COLLECTIONS.FUNDAMENTAL_SERIES, {
    code, indicator, data_date: dataDate,
    value, prev, direction, source, confidence: 0.9,
    unit, layer: 'hard_data', note
  }, { code, indicator, data_date: dataDate });
}

/** 159570 龙头收入：港股持仓营运收入同比加权。缺数留空，不用礼来填。 */
async function materializeHkLeadingRevenue(bySymbol) {
  let holds = [];
  try {
    holds = await db.query(COLLECTIONS.ETF_HOLDINGS, { code: '159570' }, { limit: 40 });
  } catch (e) { holds = []; }
  let latest = '';
  holds.forEach((h) => { if (h.report_date && h.report_date > latest) latest = h.report_date; });
  const top = latest ? holds.filter((h) => h.report_date === latest) : holds;
  const byHk = { ...bySymbol };
  for (const h of top) {
    const hk = padHkCode(h.stock_code);
    const sym = `hk${hk}`;
    if (byHk[sym] && byHk[sym].revenue_yoy != null) continue;
    try {
      const rows = await db.query(COLLECTIONS.GLOBAL_FINANCIAL, { symbol: sym }, { limit: 8 });
      const best = rows.filter((r) => r.revenue_yoy != null)
        .sort((a, b) => String(b.period_end || '').localeCompare(String(a.period_end || '')))[0];
      if (best) byHk[sym] = best;
    } catch (e) { /* ignore */ }
  }
  const yoy = materializeHoldingsYoy(top, byHk);
  if (yoy == null) return 0;
  const used = top.filter((h) => byHk[`hk${padHkCode(h.stock_code)}`]);
  const first = used[0] && byHk[`hk${padHkCode(used[0].stock_code)}`];
  const period = (first && first.period_end) || beijingDateStr();
  const names = used.map((h) => h.stock_name || h.stock_code).join('+');
  await writeHardSeries('159570', 'leading_revenue', yoy, beijingDateStr(), '%', 'hk_income', `${period} ${names}`);
  return 1;
}

/** 调用 DeepSeek，返回解析后的 JSON */
async function callDeepseek(messages, apiKey) {
  const res = await datasource.http.post('https://api.deepseek.com/chat/completions', {
    model: 'deepseek-chat',
    messages,
    response_format: { type: 'json_object' },
    temperature: 0.1,
    max_tokens: 2000
  }, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
    timeout: 60000
  });
  const content = res.data && res.data.choices && res.data.choices[0]
    && res.data.choices[0].message && res.data.choices[0].message.content;
  if (!content) throw new Error('DeepSeek 返回为空');
  return JSON.parse(content);
}

/** 读 global_quote 汇总海外标的走势摘要（trend_20d / momentum_5d） */
async function getGlobalSummary() {
  const rows = await db.query(COLLECTIONS.GLOBAL_QUOTE, {});
  if (rows.length === 0) return [];
  const bySymbol = {};
  rows.forEach((r) => {
    if (!bySymbol[r.symbol]) bySymbol[r.symbol] = { name: r.name, related: r.related, factor: r.factor, bars: [] };
    bySymbol[r.symbol].bars.push(r);
  });
  const summary = [];
  for (const [symbol, g] of Object.entries(bySymbol)) {
    const bars = g.bars.sort((a, b) => (a.trade_date < b.trade_date ? -1 : 1));
    const last = bars[bars.length - 1];
    const closes = bars.map((b) => b.close).filter((v) => v != null && !Number.isNaN(v));
    const ma20 = closes.length >= 20 ? closes.slice(-20).reduce((s, v) => s + v, 0) / 20 : null;
    const c5 = closes.length >= 6 ? closes[closes.length - 6] : null;
    const momentum = c5 != null && c5 !== 0 ? ((last.close - c5) / c5) * 100 : null;
    summary.push({
      symbol,
      name: g.name,
      related: g.related,
      factor: g.factor,
      trend_20d: ma20 != null ? (last.close >= ma20 ? '上' : '下') : null,
      momentum_5d: momentum != null ? Math.round(momentum * 100) / 100 : null
    });
  }
  return summary;
}

/** 海外股价不再写入 F（价格≠基本面），仅保留函数供诊断 */
async function extractGlobalSignals() {
  return { ok: true, extracted: 0, skipped: true, message: '海外股价不进入 F' };
}

/** 金额原始值转「亿」文本（按货币单位），保留 2 位小数 */
function amountYi(v, currency) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  const unit = currency === 'EUR' ? '亿欧元'
    : (currency === 'TWD' ? '亿新台币'
      : (currency === 'KRW' ? '亿韩元'
        : (currency === 'CNY' || currency === '人民币' ? '亿元' : '亿美元')));
  return (Number(v) / 1e8).toFixed(2) + unit;
}

/** 读 global_financial 各公司最新财报，按 symbol 去重返回摘要 */
async function getFinancialSummary() {
  const rows = await db.query(COLLECTIONS.GLOBAL_FINANCIAL, {});
  if (rows.length === 0) return [];
  const bySymbol = {};
  rows.forEach((r) => { if (!bySymbol[r.symbol] || r.period_end > bySymbol[r.symbol].period_end) bySymbol[r.symbol] = r; });
  return Object.entries(bySymbol).map(([symbol, r]) => ({
    symbol, name: r.name, code: r.code, related: r.related, factor: r.factor,
    currency: r.currency || 'USD', latest: r
  }));
}

/** 组装单家公司财报摘要文本 */
function buildFinancialLine(s) {
  const l = s.latest;
  return [
    `${s.name}(${s.code}) 财报期 ${l.period_end}（${l.form || ''} ${l.fp || ''}）`,
    `营收 ${amountYi(l.revenue, s.currency)} 同比${l.revenue_yoy != null ? l.revenue_yoy + '%' : '—'}`,
    `净利 ${amountYi(l.net_income, s.currency)} 同比${l.net_income_yoy != null ? l.net_income_yoy + '%' : '—'}`,
    `毛利率 ${l.gross_margin != null ? l.gross_margin + '%' : '—'}`,
    `库存 ${amountYi(l.inventory, s.currency)} 环比${l.inventory_qoq != null ? l.inventory_qoq + '%' : '—'}`,
    `CapEx累计 ${amountYi(l.capex_ytd, s.currency)}`,
    `EPS ${l.eps != null ? l.eps : '—'}`
  ].join('，');
}

/** SEC 财报传导信号提取（独立可选步骤）：逐家公司读财报 → LLM 判断传导 → 写 fundamental_series（earnings 层） */
async function extractFinancialSignals(apiKey) {
  const hard = await materializeSecHardData();
  const summary = await getFinancialSummary();
  if (summary.length === 0) return { ok: true, extracted: 0, hard, message: '无财报数据' };

  let extracted = 0;
  const errors = [];
  for (const s of summary) {
    const map = FINANCIAL_CONDUCTION_MAP[s.symbol]
      || (String(s.symbol).startsWith('hk') ? { '159570': ['core_sales', 'bd_licensing', 'approval_export'] } : null)
      || (String(s.symbol).startsWith('kr') ? { '513310': ['hbm_demand', 'ai_server_demand'] } : null);
    if (!map) continue; // 无传导映射的公司跳过
    try {
      const indicatorListText = Object.entries(map)
        .map(([code, keys]) => {
          const typed = keys.map((k) => `${k}(${(QUALITATIVE_KEYS[code] || []).includes(k) ? '定性' : '量化'})`).join('/');
          return `${code}: ${typed}`;
        }).join('、');
      const userPrompt = `公司财报：${buildFinancialLine(s)}（关联因子：${s.factor}）\n\n关联 ETF 及合法传导指标清单（已标注指标类型）：${indicatorListText}\n\n请判断该公司财报对相关 ETF 的传导信号。`;

      const result = await callDeepseek([
        { role: 'system', content: FINANCIAL_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ], apiKey);

      const results = (result && result.results) || [];
      for (const item of results) {
        if (!item || !item.related || !item.indicator) continue;
        const validKeys = map[item.related] || [];
        if (!validKeys.includes(item.indicator)) continue;
        // 硬数据指标保护：dram_price/nand_price 等有真实价格的指标，禁止 LLM 传导写入
        if (fund.isHardData(item.related, item.indicator)) continue;
        if (!fund.isQualitative(item.related, item.indicator)) continue;
        if (item.related === '159570' && item.indicator === 'core_sales' && !biotech.isCoreSalesAllowed({
          title: `${s.name} ${s.code}`, stock_name: s.name, stock_code: s.code, reason: item.reason
        })) continue;
        const grade = Math.round(Number(item.grade));
        if (grade < 1 || grade > 5) continue;
        const conf = Number(item.confidence);
        const confidence = (conf >= 0.6 && conf <= 0.85) ? conf : 0.7;
        await writeQualitativeEvidence({
          code: item.related,
          indicator: item.indicator,
          title: `${s.code} ${s.latest && s.latest.period_end ? s.latest.period_end : ''}`.trim(),
          grade,
          confidence,
          source: 'sec',
          reason: `${s.code}:${(item.reason || '').slice(0, 60)}`,
          stock_name: s.name,
          stock_code: s.code
        });
        extracted += 1;
      }
      await datasource.sleep(200); // LLM 限流保护
    } catch (e) {
      errors.push(`${s.code}: ${String(e.message || e).slice(0, 60)}`);
    }
  }
  return { ok: true, extracted, hard, errors };
}

exports.main = async (event = {}, context = {}) => {
  const taskName = (event && event.task_name) || 'extractFundamental';
  const startedAt = Date.now();
  const batchSize = (event && event.batchSize) || 20;
  const apiKey = process.env.DEEPSEEK_API_KEY || '';

  if (event && event.materialize_only) {
    try { await fund.syncFundamentalConfigs(db, COLLECTIONS.FUNDAMENTAL_CONFIG); } catch (e) { /* ignore */ }
    try {
      const hard = await materializeSecHardData();
      // P3.9：rollup_all 模式——重新聚合所有定性指标（清理 cross-contamination 后重新生成）
      if (event.rollup_all) {
        const configs = await db.query(COLLECTIONS.FUNDAMENTAL_CONFIG, {});
        const week = fund.weekDataDate();
        let rollupCount = 0;
        for (const cfg of configs) {
          if (!cfg.code || !cfg.indicator) continue;
          if (!fund.isQualitative(cfg.code, cfg.indicator)) continue;
          const ok = await rollupWeek(cfg.code, cfg.indicator, week);
          if (ok) rollupCount += 1;
        }
        return { ok: true, hard, rollup_all: true, rollup_count: rollupCount };
      }
      return { ok: true, hard };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  }

  if (!apiKey) {
    await logFetch('llm_extract', 'fail', 0, '缺少 DEEPSEEK_API_KEY', taskName, Date.now() - startedAt);
    return { ok: false, error: '缺少 DEEPSEEK_API_KEY' };
  }

  try {
    // 海外传导信号提取（可选步骤，失败不阻断主流程）
    let globalExtracted = 0;
    try {
      const gr = await extractGlobalSignals(apiKey);
      globalExtracted = gr.extracted || 0;
    } catch (e) {
      await logFetch('llm_global', 'fail', 0, String(e.message || e).slice(0, 80), taskName, Date.now() - startedAt);
    }

    // SEC 财报传导信号提取（可选步骤，失败不阻断主流程）
    let financialExtracted = 0;
    try { await fund.syncFundamentalConfigs(db, COLLECTIONS.FUNDAMENTAL_CONFIG); } catch (e) { /* ignore */ }

    try {
      const fr = await extractFinancialSignals(apiKey);
      financialExtracted = (fr.extracted || 0) + (fr.hard || 0);
    } catch (e) {
      await logFetch('llm_financial', 'fail', 0, String(e.message || e).slice(0, 80), taskName, Date.now() - startedAt);
    }

    // 读未处理新闻（按 ETF 分组）
    const rows = await db.query(COLLECTIONS.NEWS_FEED, { status: 'new' }, {
      orderBy: [{ field: 'publish_time', direction: 'desc' }], limit: batchSize
    });
    if (rows.length === 0) {
      return { ok: true, processed: 0, global_extracted: globalExtracted, financial_extracted: financialExtracted, message: '无待处理新闻' };
    }

    // 按 code 分组，每组一次 LLM 调用（减少调用次数）
    for (const r of rows) {
      if (r.code === 'ALL') {
        try { await db.updateById(COLLECTIONS.NEWS_FEED, r._id, { status: 'processed' }); } catch (e) { /* ignore */ }
      }
    }

    const byCode = {};
    rows.forEach((r, i) => {
      const c = r.code || 'unknown';
      if (c === 'ALL' || c === 'unknown' || !INDICATOR_KEYS[c]) return;
      if (!byCode[c]) byCode[c] = [];
      byCode[c].push({
        index: i, title: r.title, _id: r._id, code: c,
        stock_code: r.stock_code || '', stock_name: r.stock_name || '',
        holding_weight: r.holding_weight, summary: r.summary || ''
      });
    });

    let extracted = 0;
    const errors = [];

    for (const code of Object.keys(byCode)) {
      const group = byCode[code];
      const indicatorList = fund.indicatorListText(code);
      // P3.9：加载 ETF 持仓用于 cross-contamination 验证
      let etfHoldings = [];
      try { etfHoldings = await db.query(COLLECTIONS.ETF_HOLDINGS, { code }, { limit: 30 }); } catch (e) { /* ignore */ }
      const holdingNames = new Set(etfHoldings.map((h) => h.stock_name).filter(Boolean));
      const holdingCodes = new Set(etfHoldings.map((h) => h.stock_code).filter(Boolean));
      try {
        const userPrompt = `该 ETF 的定性指标清单：${indicatorList}\n\n新闻列表（按 index 对应，含重仓股标注）：\n`
          + group.map((g) => {
            const tag = g.stock_name
              ? `[持股 ${g.stock_name} ${g.stock_code} 占净值${g.holding_weight != null ? g.holding_weight : '?'}%]`
              : '[赛道]';
            return `${g.index}. ${tag} ${g.title}${g.summary ? '｜' + String(g.summary).slice(0, 80) : ''}`;
          }).join('\n');
        const result = await callDeepseek([
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt }
        ], apiKey);

        const results = (result && result.results) || [];
        const extractedBefore = extracted;
        for (const item of results) {
          const g = group.find((x) => x.index === item.index);
          if (!g || !item.indicator) continue;
          const validKeys = INDICATOR_KEYS[g.code] || [];
          if (!validKeys.includes(item.indicator)) continue;
          if (fund.isHardData(g.code, item.indicator)) continue;
          if (!fund.isQualitative(g.code, item.indicator)) continue;
          if (g.code === '159570' && item.indicator === 'core_sales' && !biotech.isCoreSalesAllowed({
            title: g.title, stock_name: g.stock_name, stock_code: g.stock_code, reason: item.reason
          })) continue;
          const grade = Math.round(Number(item.grade));
          if (grade < 1 || grade > 5) continue;
          // P3.9：cross-contamination 验证——防止科技公司 evidence 污染黄金/创新药等跨赛道指标
          if (!isStockValidForEtf(g.stock_name, g.stock_code, g.code, holdingNames, holdingCodes)) continue;

          await writeQualitativeEvidence({
            code: g.code,
            indicator: item.indicator,
            title: g.title,
            stock_code: g.stock_code,
            stock_name: g.stock_name,
            holding_weight: g.holding_weight,
            grade,
            confidence: clampConfidence(item.confidence, 0.6),
            source: 'deepseek',
            reason: item.reason || '',
            news_id: g._id
          });
          extracted += 1;
        }

        // V3.1 A7：本组没有任何有效 indicator 时标 extract_empty，允许重试；勿标 processed
        const groupExtracted = extracted - extractedBefore;
        const newsStatus = groupExtracted > 0 ? 'processed' : 'extract_empty';
        for (const g of group) {
          await db.updateById(COLLECTIONS.NEWS_FEED, g._id, { status: newsStatus });
        }
      } catch (e) {
        errors.push(`${code}: ${String(e.message || e).slice(0, 80)}`);
      }
    }

    await logFetch('llm_extract', errors.length === 0 ? 'success' : 'partial', extracted, errors.slice(0, 3).join('; '), taskName, Date.now() - startedAt);
    return { ok: true, processed: extracted, global_extracted: globalExtracted, financial_extracted: financialExtracted, news_total: rows.length, errors };
  } catch (e) {
    await logFetch('llm_extract', 'fail', 0, String(e.message || e), taskName, Date.now() - startedAt);
    return { ok: false, error: String(e.message || e) };
  }
};
