'use strict';
/**
 * OLD(V3.6.1 生产)语义垫片 —— **不是** R1 的「按交易日幂等」接缝。
 *
 * 存在原因：重放 harness `require('./trade-date-idempotence.js')`，而 **V3.6.1 生产树没有该文件**
 * （它是 R1 为修复「运行次数冒充交易日」而新增的**调用侧**接缝）。
 *
 * 本垫片把两个函数实现为**生产当时的行为**：
 *   - `planRunInput(state)` → 直通：`engine_state === state`，不做同日重放（`replaying=false`）。
 *     这正是 V3.6.1 生产里 `runDecisionEngine` 的写法：把 `p.position.trend_stage_state` **原样**交给引擎。
 *   - `finalizeState(resolved)` → 恒等：生产当时就是 `p.position.trend_stage_state = v3Result.trend_stage_state`。
 *
 * ⛔ 本文件**不得**用于 NEW 树；NEW 树用的是真正的 `src/common/utils/trade-date-idempotence.js`。
 */

function planRunInput(state) {
  return {
    engine_state: state,
    replaying: false,
    day_start_state: null,
    anchored: false,
    reason: 'v361_production_no_idempotence_seam'
  };
}

function finalizeState(resolved) {
  return resolved;
}

module.exports = { planRunInput, finalizeState };
