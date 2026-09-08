'use strict';

/** runDecisionEngine 允许的链式/后台触发来源 */
const ALLOWED_DECISION_ENGINE_FROM = new Set([
  'materializeIndicators',
  'paramChange',
  'riskTrigger',
  'riskResolve',
  'adminGateway',
  'timer',
  'scheduled'
]);

/**
 * 校验决策引擎调用来源（拒绝匿名直调重写核心集合）。
 * @param {object} event 云函数 event
 * @param {object} context 云函数 context
 */
function isAllowedDecisionEngineInvoke(event = {}, context = {}) {
  const from = event.from || (event.data && event.data.from) || '';
  if (from && ALLOWED_DECISION_ENGINE_FROM.has(from)) return true;
  const type = event.Type || event.type || context.Type || '';
  if (/timer/i.test(String(type))) return true;
  if (event.TriggerName || context.triggerName) return true;
  return false;
}

module.exports = { ALLOWED_DECISION_ENGINE_FROM, isAllowedDecisionEngineInvoke };
