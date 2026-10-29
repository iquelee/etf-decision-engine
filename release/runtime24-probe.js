'use strict';
// Isolated Event-function entry. It never routes arbitrary client input, logs
// data, changes credentials, or invokes producer/admin functions.
const { randomUUID } = require('crypto');
const instance = randomUUID();
let invocations = 0;
const cases = Object.freeze({
  constants: { path: '/api/constants' },
  dashboard: { path: '/api/dashboard' },
  daily: { path: '/api/etf/513310/kline', queryStringParameters: { period: 'daily' } },
  weekly: { path: '/api/etf/513310/kline', queryStringParameters: { period: 'weekly' } },
  history: { path: '/api/etf/513310/decisions', queryStringParameters: { from: '2026-10-01', to: '2026-10-27', include_provenance: '1' } },
  legacyHistory: { path: '/api/etf/513310/decisions', queryStringParameters: { from: '2026-10-01', to: '2026-10-27' } },
  notFound: { path: '/__runtime_probe_not_found__' }
});

exports.main = async (event = {}) => {
  // Validate before loading the live API/SDK. Rejected input cannot reach it.
  if (!event || typeof event !== 'object' || Array.isArray(event)
      || Object.keys(event).length !== 1 || !Object.prototype.hasOwnProperty.call(event, 'case')
      || typeof event.case !== 'string'
      || !Object.prototype.hasOwnProperty.call(cases, event.case)) {
    return { probe_error: 'UNSUPPORTED_PROBE_CASE' };
  }
  const definition = cases[event.case];
  const started = process.hrtime.bigint();
  const response = await require('./index').main({
    httpMethod: 'GET', path: definition.path,
    queryStringParameters: { ...definition.queryStringParameters }
  });
  invocations += 1;
  return {
    probe: { node: process.version, instance, invocation: invocations,
      case: event.case, handler_elapsed_ms: Number(process.hrtime.bigint() - started) / 1e6 },
    response
  };
};
