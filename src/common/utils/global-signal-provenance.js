/**
 * V3.6.5 Production Integrity —— P-2：global_signals 日期 provenance
 *
 * 背景（V3.6.5 只读审计 §14 / P-2）：
 *   `datasource.js::fetchGlobalDaily()` 抓的是腾讯**实时快照**（qt.gtimg.cn），
 *   但它把 `trade_date` **硬编码成「抓取时刻的北京自然日」**：
 *       const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
 *   ⇒ 该字段是 **fetch/artifact 日**，不是**市场交易日**。
 *   后果：北京时间 09-23 凌晨抓美股，得到的是 09-22 的美股收盘数据，
 *   却被标成 `trade_date = 2026-09-23` ⇒ 用 legacy 字段做 freshness 判断会系统性偏新。
 *
 * 本模块的职责（V3.6.5 裁定：**只做 additive provenance**）：
 *   - 从 provider 原始响应的分片里解析**真实时间戳** ⇒ `source_timestamp`；
 *   - 由该时间戳派生 `source_market_date`；
 *   - 打上 `date_origin = 'provider_timestamp'`；
 *   - ⛔ **不修改** legacy `trade_date`（暂不改写、不迁移、不批量改历史数据）；
 *   - ⛔ 无 provider timestamp 时明确给 `null` / `date_origin = 'UNKNOWN'`，
 *     **绝不** fallback 成北京今天，**绝不**用 fetch_time 伪装 market date。
 *
 * RunContext 的 freshness 判定应使用 `source_market_date`（经调用侧 adapter 映射为
 * `as_of_date`），而不是 legacy `trade_date`。
 *
 * 纯函数模块：无网络、无数据库、无环境变量依赖。
 */
'use strict';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** provider 时间戳里可能出现的形态（腾讯 qt.gtimg.cn 分片为 `~` 分隔的纯文本，格式随市场而变化） */
const TIMESTAMP_PATTERNS = [
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/,   // 2026-09-22 16:00:00
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/,           // 2026-09-22 16:00
  /^(\d{4})\/(\d{2})\/(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/, // 2026/09/22 16:00:00
  /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/            // 20260922160000
];

/**
 * ⚠️ 腾讯返回的时间戳代表**哪个时区**，仓库内没有任何确证（不同市场/接口可能给当地时间）。
 * 因此显式标记「未验证」，防止下游把它当北京时间使用。
 * 要把它变成确定时区，必须先有实测证据（对话/文档里明确记录），不得凭常识假设。
 */
const SOURCE_TIMEZONE = 'PROVIDER_LOCAL_UNVERIFIED';

const DATE_ORIGIN = Object.freeze({
  PROVIDER_TIMESTAMP: 'provider_timestamp',
  UNKNOWN: 'UNKNOWN'
});

function isDate(v) {
  return typeof v === 'string' && DATE_RE.test(v);
}

/** 校验日期三元组是否为合法日历日（拒绝 2026-02-31 之类） */
function isValidYmd(y, m, d) {
  const dt = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return dt.getUTCFullYear() === Number(y)
    && dt.getUTCMonth() === Number(m) - 1
    && dt.getUTCDate() === Number(d);
}

/**
 * 从 provider 原始分片里解析时间戳。
 * ⛔ 不按**固定下标**取（字段布局会随市场/接口变动）——按**形态**扫描，
 *    这与「正则只能定位、不能计数」的教训方向一致：此处只需要定位，不需要计数。
 *
 * @param {string[]} fields provider 原始响应的分片数组（腾讯为 `~` 分隔）
 * @returns {{source_timestamp:string, source_market_date:string}|null}
 */
function parseProviderTimestamp(fields) {
  const list = Array.isArray(fields) ? fields : [];
  for (const raw of list) {
    const s = typeof raw === 'string' ? raw.trim() : '';
    if (!s) continue;
    for (const re of TIMESTAMP_PATTERNS) {
      const m = re.exec(s);
      if (!m) continue;
      const [y, mo, d] = [m[1], m[2], m[3]];
      if (!isValidYmd(y, mo, d)) continue;
      const dateStr = `${y}-${mo}-${d}`;
      let normalized = dateStr;
      if (m[4] != null && m[5] != null) normalized += ` ${m[4]}:${m[5]}`;
      if (m[6] != null) normalized += `:${m[6]}`;
      return { source_timestamp: normalized, source_market_date: dateStr };
    }
  }
  return null;
}

/**
 * 构造一行 global_quote 的 provenance 字段（additive，不改 legacy 字段）。
 *
 * @param {object} input
 *   - fields           {string[]} provider 原始分片
 *   - legacy_trade_date {string} 现有的 trade_date（仅回显，不参与推导）
 *   - provider         {string}   数据源标识（默认 'tencent_qt'）
 * @returns {object} { symbol?, legacy_trade_date, source_timestamp, source_market_date,
 *                     date_origin, source_timezone, provider, provenance_status }
 */
function buildGlobalQuoteProvenance(input) {
  const inp = input || {};
  const fields = inp.fields;
  const legacy = isDate(inp.legacy_trade_date) ? inp.legacy_trade_date : null;
  const parsed = parseProviderTimestamp(fields);
  return {
    legacy_trade_date: legacy,
    source_timestamp: parsed ? parsed.source_timestamp : null,
    source_market_date: parsed ? parsed.source_market_date : null,
    date_origin: parsed ? DATE_ORIGIN.PROVIDER_TIMESTAMP : DATE_ORIGIN.UNKNOWN,
    source_timezone: SOURCE_TIMEZONE,
    provider: inp.provider != null ? String(inp.provider) : 'tencent_qt',
    provenance_status: parsed ? 'RESOLVED' : 'UNKNOWN'
  };
}

/**
 * 供 RunContext freshness 使用的日期。
 * ⛔ 不回退 legacy `trade_date`（那是 fetch 日，会系统性偏新）；
 * ⛔ 不回退「北京今天」；取不到就给 null，让上层按未知处理。
 *
 * @param {object} row global_quote 行（或 buildGlobalQuoteProvenance 的产物）
 * @returns {string|null}
 */
function resolveGlobalSignalFreshnessDate(row) {
  const r = row || {};
  return isDate(r.source_market_date) ? r.source_market_date : null;
}

/**
 * 把 globalSignals 数组映射为 RunContext 所需的 `{ symbol, as_of_date }` 列表。
 * 调用侧 adapter：`source_market_date → as_of_date`（**不改 producer 语义**）。
 *
 * @param {Array<object>} signals 每项形如 { symbol, source_market_date, trade_date? }
 * @returns {{mapped:Array<{symbol:string,as_of_date:string|null}>, unmapped:Array<{symbol:string,reason:string}>}}
 */
function mapGlobalSignalsToAsOf(signals) {
  const mapped = [];
  const unmapped = [];
  (Array.isArray(signals) ? signals : []).forEach((s) => {
    const sym = s && s.symbol != null ? String(s.symbol) : null;
    if (!sym) return;
    const d = resolveGlobalSignalFreshnessDate(s);
    if (d) mapped.push({ symbol: sym, as_of_date: d });
    else unmapped.push({ symbol: sym, reason: 'no_provider_market_date' });
  });
  return { mapped, unmapped };
}

module.exports = {
  SOURCE_TIMEZONE,
  DATE_ORIGIN,
  TIMESTAMP_PATTERNS,
  isDate,
  isValidYmd,
  parseProviderTimestamp,
  buildGlobalQuoteProvenance,
  resolveGlobalSignalFreshnessDate,
  mapGlobalSignalsToAsOf
};
