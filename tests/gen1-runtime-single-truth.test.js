'use strict';

/**
 * WP-G1.2 G1.2-01/03：运行时「单一真相」静态守卫（复审 P0）。
 *
 * 单元测试无法覆盖 runDecisionEngine 的 DB 接线，因此这里对**源码**做确定性断言，
 * 把三个复审 P0 变成「改回去就红」的回归门：
 *   P0-1 Health 只有一个真相（不得由 ml_shadow_signal 快照推导权限）
 *   P0-3 Portfolio Cap 只有一个算法（canary 用组合总仓 + 同一占用函数）
 *   P0-3 Replay 与 Runtime 只有一个上下文（canary 继承生产全部输入）
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const RDE = fs.readFileSync(path.join(REPO, 'cloudfunctions/runDecisionEngine/index.js'), 'utf8');
const VM = fs.readFileSync(path.join(REPO, 'src/common/utils/gen1-view-model.js'), 'utf8');

/** 去掉注释，避免文档里的反例代码触发误判。 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
const CODE = stripComments(RDE);

/* ---- P0-1：Health 单一真相 ---- */
{
  assert.ok(/readHealthState\(db,\s*COLLECTIONS\)/.test(CODE), '必须读持久化 latch');
  assert.ok(/healthStateToGate\(gen1HealthState\)/.test(CODE), '必须由 latch 导出运行时门');
  assert.ok(/const gen1Gate = gen1GlobalGate;/.test(CODE),
    '★ 权限门必须直接引用全局 latch 门（gen1GlobalGate）');
  assert.ok(!/circuitGate\(\s*gen1HealthStatus\s*\)/.test(CODE),
    '★ 禁止再按 ml_shadow_signal 的 health 重新推导熔断门');
  assert.ok(!/gen1Signal\.gen1_health_status\s*\|\|\s*['"]OK['"]/.test(CODE),
    '★ 禁止把缺失的 signal 健康默认为 OK');
  assert.ok(/signalHealthSnapshot:\s*gen1SignalHealthSnapshot/.test(CODE),
    'signal 侧 health 只能作为审计快照传入');
}

/* ---- P0-3a：Portfolio Cap 只有一个算法（WP-G1.3 起为双账本） ---- */
{
  assert.ok(/let canarySectorUsed = portfolio\.tech_position/.test(CODE),
    '★ canary 赛道占用种子必须 = portfolio.tech_position（含真实持仓）');
  assert.ok(!/let canaryTechUsed = 0;/.test(CODE), '★ 禁止再从 0 起算 canary 增量');
  // 账本推进必须走唯一的 stepCounterfactualLedger（内部即生产同款 limit 公式）
  assert.ok(/stepCounterfactualLedger\(\{/.test(CODE), '★ 必须使用唯一账本推进函数');
  assert.ok(/counterfactualSectorRemaining\(\{/.test(CODE),
    '★ canary rerun 的 sectorRemainingLimit 必须来自唯一公式函数');
  assert.ok(!/clampCanaryCandidate/.test(CODE),
    '★ 旧的 clampCanaryCandidate（含 baseline 地板）不得再被调用');
  // 生产侧占用仍复用同一 sectorOccupation()
  assert.ok(/sectorUsed \+= sectorOccupation\(current, result\.suggested_position, result\.final_target\)/.test(CODE),
    '★ 生产占用必须与 canary 共用 sectorOccupation()');
}

/* ---- P0-3b：Replay 与 Runtime 只有一个上下文 ---- */
{
  assert.ok(!/recentSlowBreakScores:\s*\[\]/.test(CODE),
    '★ 禁止再用空数组当 canary 的 slowBreak 上下文');
  assert.ok(/slowBreakScores:\s*v3SlowBreakHistory/.test(CODE),
    'canary 必须继承生产当次 slowBreak 实参');
  assert.ok(/canaryCtx = \{[\s\S]{0,400}?trendStageState: v3TrendStageState[\s\S]{0,200}?shockState: v3ShockState/.test(CODE),
    'canary 必须冻结生产调用时的阶段/冲击上下文（不得用被覆写后的 p.position）');
  assert.ok(/recentSlowBreakScores:\s*canaryCtx\.slowBreakScores/.test(CODE));
  assert.ok(/trendStageState:\s*canaryCtx\.trendStageState/.test(CODE));
  assert.ok(/shockState:\s*canaryCtx\.shockState/.test(CODE));
  assert.ok(/portfolio:\s*canaryCtx\.portfolio/.test(CODE));
  assert.ok(/bars:\s*canaryCtx\.bars/.test(CODE));
  // 唯一变量必须是 advisoryStageOverride
  assert.ok(/advisoryStageOverride:\s*stage/.test(CODE), 'A/B 唯一变量 = advisoryStageOverride');
}

/* ---- P0-1（UI 侧）：前端健康展示必须取运行时 latch ---- */
{
  const vmCode = stripComments(VM);
  assert.ok(/health_status:\s*\(decision && decision\.gen1_health_status\) \|\| \(ml && ml\.gen1_health_status\)/.test(vmCode),
    '★ 视图层 health_status 必须优先运行时 latch，而不是 signal 快照');
  assert.ok(/signal_health_snapshot:\s*\(ml && ml\.gen1_health_status\)/.test(vmCode),
    'signal 快照必须单列为 signal_health_snapshot');
}

console.log('gen1 runtime single-truth static guards passed');
