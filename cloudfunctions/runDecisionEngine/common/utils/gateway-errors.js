'use strict';

/** 对外统一错误文案；完整异常写云函数日志 */
function publicErrorMessage(e, fallback = '系统错误，请稍后重试') {
  console.error('[gateway]', e && e.stack ? e.stack : e);
  return fallback;
}

module.exports = { publicErrorMessage };
