/**
 * Gen-1 Execution Boundary（WP-G1 / G1-09）。
 *
 * 自动执行是**永久硬边界**：即使数据库把 ml_execution_enabled 置为 true，
 * 系统也必须输出 false，并产生 CONFIG_IGNORED_SECURITY_BOUNDARY 审计记录。
 *
 * 同时守卫 authority：任何状态都不得授予生产写权限。
 *
 * @module gen1-execution-boundary
 */
'use strict';

/** 自动执行永久关闭（常量，任何入参都无法改变）。 */
const EXECUTION_ENABLED = false;
const AUTO_TRADING_LABEL = '自动交易：关闭';
const AUDIT_CODE = 'CONFIG_IGNORED_SECURITY_BOUNDARY';

/**
 * 解析执行权限（恒 false）。
 *
 * @param {object} [params] param_config 合并结果
 * @returns {{execution_enabled: boolean, auto_execution: boolean, broker_wired: boolean,
 *            label: string, config_requested: boolean, audit: object|null}}
 */
function resolveExecution(params) {
  const p = params || {};
  const configRequested = p.ml_execution_enabled === true;
  return {
    execution_enabled: EXECUTION_ENABLED,
    auto_execution: EXECUTION_ENABLED,
    broker_wired: false,
    label: AUTO_TRADING_LABEL,
    config_requested: configRequested,
    // 配置试图开启 → 产生审计记录（调用方落库到 shadow log / runtime_status）
    audit: configRequested ? {
      code: AUDIT_CODE,
      severity: 'SECURITY',
      message: '数据库 ml_execution_enabled=true 被安全边界忽略；自动执行永久关闭',
      config_key: 'ml_execution_enabled',
      effective_value: false,
      at: new Date().toISOString()
    } : null
  };
}

/**
 * UI 文案守卫：任何试图显示「已启用自动执行」的文案都必须被纠正。
 * @param {string} text
 * @returns {string}
 */
function guardExecutionLabel(text) {
  const t = String(text || '');
  if (/execution\s*enabled|自动交易\s*[:：]?\s*(开|启用|on)/i.test(t)) return AUTO_TRADING_LABEL;
  return t || AUTO_TRADING_LABEL;
}

module.exports = {
  EXECUTION_ENABLED,
  AUTO_TRADING_LABEL,
  AUDIT_CODE,
  resolveExecution,
  guardExecutionLabel
};
