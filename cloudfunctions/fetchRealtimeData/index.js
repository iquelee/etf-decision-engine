/**
 * 云函数：fetchRealtimeData —— 盘中 5 分钟取腾讯行情，更新当日 etf_daily.realtime
 * 触发：定时 realtime-5min（9:15-15:00 每 5 分钟）
 */

'use strict';

const cloudbase = require('@cloudbase/node-sdk');
const db = require('./common/utils/db');
const datasource = require('./common/utils/datasource');
const { beijingNow, beijingDateStr, isIntraday } = require('./common/utils/fetch-guard');
const { COLLECTIONS } = require('./common/constants');

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });

/** 记录抓取日志（失败不阻断主流程） */
async function logFetch(source, status, itemCount, error, taskName, durationMs) {
  try {
    await db.getCollection(COLLECTIONS.FETCH_LOG).add({
      source, fetch_time: new Date(), status, item_count: itemCount || 0,
      error: error || '', task_name: taskName || 'fetchRealtimeData', duration_ms: durationMs || 0
    });
  } catch (e) { /* ignore */ }
}

exports.main = async (event = {}, context = {}) => {
  const today = beijingDateStr(beijingNow());
  const now = beijingNow();
  const startedAt = Date.now();

  try {
    if (!datasource.isTradingDay(today)) {
      return { ok: true, skipped: 'holiday', date: today };
    }
    if (!isIntraday(now) && (event && event.force) !== true) {
      return { ok: true, skipped: 'off_hours', date: today, message: '非盘中时段，跳过' };
    }

    const etfs = await db.getEtfList();
    const results = [];
    for (const etf of etfs) {
      try {
        const rt = await datasource.fetchRealtime(etf.code);
        // 更新当日 etf_daily 的 realtime 字段（若当日日线尚未生成，则暂存一条 realtime 记录）
        const rows = await db.query(COLLECTIONS.ETF_DAILY, { code: etf.code, trade_date: today }, { limit: 1 });
        if (rows.length > 0) {
          const id = rows[0]._id;
          await db.updateById(COLLECTIONS.ETF_DAILY, id, {
            realtime: { price: rt.price, time: rt.time, change_pct: rt.change_pct, source: 'tencent' }
          });
        } else {
          // 当日无日线，插入仅含 realtime 的记录（缺 OHLCV 不编造，data_complete 由物化阶段判断）
          await db.upsert(COLLECTIONS.ETF_DAILY, {
            code: etf.code, trade_date: today,
            open: rt.open != null ? rt.open : null,
            high: rt.high != null ? rt.high : null,
            low: rt.low != null ? rt.low : null,
            close: rt.price != null ? rt.price : null,
            volume: null, amount: null,
            premium_rate: null, iopv: null, source: 'realtime',
            realtime: { price: rt.price, time: rt.time, change_pct: rt.change_pct, source: 'tencent' }
          }, { code: etf.code, trade_date: today });
        }
        results.push({ code: etf.code, price: rt.price, time: rt.time, ok: true });
      } catch (e) {
        results.push({ code: etf.code, ok: false, error: String(e.message || e) });
      }
    }

    const okCount = results.filter((r) => r.ok).length;
    await logFetch('realtime', okCount === results.length ? 'success' : (okCount > 0 ? 'partial' : 'fail'),
      okCount, okCount === 0 ? '实时行情全部抓取失败' : '', 'fetchRealtimeData', Date.now() - startedAt);

    return { ok: true, date: today, results };
  } catch (e) {
    await logFetch('realtime', 'fail', 0, String(e.message || e), 'fetchRealtimeData', Date.now() - startedAt);
    return { ok: false, error: String(e.message || e) };
  }
};

exports.isIntraday = isIntraday;
