'use strict';

const crypto = require('crypto');

/** 生成请求追踪 ID；不把凭据或请求体写入日志。 */
function requestId(event) {
  const supplied = event && event.requestId;
  if (supplied && /^[A-Za-z0-9._-]{8,80}$/.test(String(supplied))) return String(supplied);
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

/** 对外统一错误文案；完整异常只写云函数日志。 */
function publicErrorMessage(e, fallback = '系统错误，请稍后重试', rid) {
  console.error(`[gateway${rid ? `:${rid}` : ''}]`, e && e.stack ? e.stack : e);
  return fallback;
}

function safeErrorResponse(e, rid, code = 500) {
  const id = rid || requestId();
  return {
    code,
    data: null,
    message: publicErrorMessage(e, '系统错误，请稍后重试', id),
    request_id: id
  };
}

module.exports = { requestId, publicErrorMessage, safeErrorResponse };
