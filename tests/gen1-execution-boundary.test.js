'use strict';

/** G1-09 Execution Boundary（G1-11 Gate G1-G）单测。 */
const assert = require('assert');
const {
  EXECUTION_ENABLED, AUTO_TRADING_LABEL, AUDIT_CODE, resolveExecution, guardExecutionLabel
} = require('../src/common/utils/gen1-execution-boundary');
const { DEFAULT_PARAMS } = require('../src/common/constants');

// 常量层面：永久 false
assert.strictEqual(EXECUTION_ENABLED, false);

// 正常配置（false）→ 无审计
{
  const r = resolveExecution({ ml_execution_enabled: false });
  assert.strictEqual(r.execution_enabled, false);
  assert.strictEqual(r.auto_execution, false);
  assert.strictEqual(r.broker_wired, false);
  assert.strictEqual(r.label, AUTO_TRADING_LABEL);
  assert.strictEqual(r.audit, null);
}

// 缺省 → false
{
  const r = resolveExecution(undefined);
  assert.strictEqual(r.execution_enabled, false);
  assert.strictEqual(r.audit, null);
}

// 数据库置 true → 仍 false + 审计记录
{
  const r = resolveExecution({ ml_execution_enabled: true });
  assert.strictEqual(r.execution_enabled, false, '即使 config=true 也必须 false');
  assert.strictEqual(r.auto_execution, false);
  assert.strictEqual(r.broker_wired, false);
  assert.ok(r.audit, '必须产生审计记录');
  assert.strictEqual(r.audit.code, AUDIT_CODE);
  assert.strictEqual(r.audit.severity, 'SECURITY');
  assert.strictEqual(r.audit.config_key, 'ml_execution_enabled');
  assert.strictEqual(r.audit.effective_value, false);
}

// 默认参数不含可开启执行的值
assert.strictEqual(DEFAULT_PARAMS.ml_execution_enabled, false);

// UI 文案守卫
assert.strictEqual(guardExecutionLabel('Execution Enabled'), AUTO_TRADING_LABEL);
assert.strictEqual(guardExecutionLabel('execution enabled'), AUTO_TRADING_LABEL);
assert.strictEqual(guardExecutionLabel('自动交易：开启'), AUTO_TRADING_LABEL);
assert.strictEqual(guardExecutionLabel('自动交易：启用'), AUTO_TRADING_LABEL);
assert.strictEqual(guardExecutionLabel('自动交易：关闭'), AUTO_TRADING_LABEL);
assert.strictEqual(guardExecutionLabel(''), AUTO_TRADING_LABEL);
assert.strictEqual(guardExecutionLabel('Gen-1 观察中'), 'Gen-1 观察中');

console.log('gen1 execution boundary tests passed');
