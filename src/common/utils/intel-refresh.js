'use strict';

const cloudbase = require('@cloudbase/node-sdk');
const db = require('./db');
const { COLLECTIONS } = require('../constants');

const INTEL_REFRESH_COOL_MS = 3 * 60 * 1000;

let _app = null;
function getApp() {
  if (!_app) _app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
  return _app;
}

/**
 * 触发新闻搜集（3 分钟冷却）。供 adminGateway 调用；前台 apiGateway 已下线。
 */
async function triggerIntelRefresh() {
  const rows = await db.query(COLLECTIONS.FETCH_LOG, {}, {
    orderBy: [{ field: 'fetch_time', direction: 'desc' }], limit: 40
  }).catch(() => []);
  const last = (rows || []).find((r) => {
    const name = String(r.task_name || '');
    const src = String(r.source || '');
    return name.indexOf('fetchFundamentalNews') >= 0 || name === 'news'
      || src === 'fundamental_news' || src === 'eastmoney_fastnews' || src === 'biotech_intel';
  });
  const lastTs = last && last.fetch_time ? new Date(last.fetch_time).getTime() : 0;
  if (lastTs && (Date.now() - lastTs) < INTEL_REFRESH_COOL_MS) {
    return {
      triggered: false,
      cooled: true,
      wait_sec: Math.ceil((INTEL_REFRESH_COOL_MS - (Date.now() - lastTs)) / 1000)
    };
  }
  getApp().callFunction({ name: 'fetchFundamentalNews', data: { force: true, task_name: 'news' } })
    .catch((e) => console.error('[intel-refresh] fetchFundamentalNews failed', e));
  return { triggered: true, cooled: false };
}

module.exports = { triggerIntelRefresh, INTEL_REFRESH_COOL_MS };
