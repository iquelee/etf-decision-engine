/**
 * V3.6.1 Safety Hardening R1 —— 同一交易日幂等（Trade-Date Idempotence）
 *
 * 背景（R1 缺陷 #1）与**关键约束**：
 *   旧实现里 `pendingDays` / `days_in_stage` / `soft_down_days` / `s5_risk_days`
 *   都是「每次函数调用 +1」。同一 `snapshot.calc_date` 当天被重复运行
 *   （手工重跑、后台重复触发、Canary 重算、补数重跑）时，**运行次数被冒充成交易日**。
 *
 *   ⛔ 最自然的两处修复位置（`trend-stage.js` 的 pending 计数、`decision-v3.js` 的状态落库）
 *   **都是受冻结锁保护的工件**：
 *     - `ml/manifests/V361_IMMUTABLE_LOCK.json` 钉死 `decision-v3.js`
 *       （规则原文：「V3.6.1 生产决策核心不可修改；任何挑战须升版（V3.6.2+），不得静默改旧版」）
 *     - `ml/manifests/GEN1_FEATURE_PIPELINE_LOCK.json` 钉死 `trend-stage.js`
 *       （role = trend_stage_implementation）
 *   本轮任务同时禁止升版与修改冻结工件 ⇒ **不得在这两个文件里落修复**。
 *
 * 本模块的做法（落在**未上锁**的调用侧，`cloudfunctions/runDecisionEngine/index.js`）：
 *   把「同一天只贡献一个交易日」实现为**按交易日幂等重放**：
 *
 *     1. 状态里记两个锚点：
 *        - `last_evaluated_trade_date`：本 state 最近一次被评估的交易日
 *        - `day_start_state`：**当日首次运行之前**的按日计数器快照
 *     2. 当天再次运行时，把 `day_start_state`（而非已经推进过的计数器）交给引擎，
 *        引擎于是**重放**出与当日首次运行**完全相同**的结果 ⇒ 计数器只被推进一次。
 *     3. 落库时始终写入同一份 `day_start_state`，保证一天之内反复运行是幂等的。
 *
 * 与「引擎内锚点」的关系：
 *   `v3-6-stage-persistence.js`（**未上锁**）内部也有交易日锚点保护，
 *   两者语义一致、互不冲突：幂等重放让输入回到当日起点，引擎内锚点再保证一次计数。
 *
 * 向后兼容：
 *   旧 state 没有 `last_evaluated_trade_date` / `day_start_state` ⇒ 不进入重放分支，
 *   按普通一次运行处理，并把锚点补上；不崩溃、不跳变。
 *   `snapshot.calc_date` 缺失 ⇒ 退化为「每次运行都按新的一天处理」，但在返回值里显式
 *   标注 `anchored:false`，不静默假装已幂等。
 *
 * 本文件为**纯函数**，不读写任何状态、不触碰生产写入路径。
 */
'use strict';

/** 参与「按日推进 / 阶段判定」的字段 —— 重放基准与落库字段都用此白名单，避免嵌套膨胀 */
const DAY_STATE_FIELDS = Object.freeze([
  'stage',
  'overlay',
  'displayStage',
  'initialized',
  'stage_algo_version',
  'pending',
  'pendingStage',
  'pendingDays',
  'days_in_stage',
  'soft_down_days',
  's5_risk_days',
  's4_origin',
  'breakout_level',
  'persistence_overlay',
  'persistence_reason',
  'downgrade_score',
  's5_integrity_score',
  'block_aggressive_add',
  'post_s5_grace',
  // V3.6.1 R1：v3-6-stage-persistence 内部的交易日锚点（未上锁模块，已实现）
  'pending_last_counted_date',
  'persistence_last_counted_date',
  'soft_down_last_counted_date',
  's5_risk_last_counted_date'
]);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isDate(v) {
  return typeof v === 'string' && DATE_RE.test(v);
}

/** 从 state 抽取「按日状态」的扁平快照（白名单，绝不嵌套） */
function snapshotDayState(state) {
  const src = state || {};
  const out = {};
  DAY_STATE_FIELDS.forEach((k) => {
    if (src[k] !== undefined) out[k] = src[k];
  });
  return out;
}

/**
 * 规划本次运行的引擎输入。
 *
 * @param {object} state 持久化的 trend_stage_state
 * @param {string|null} tradeDate 本次权威交易日（snapshot.calc_date）
 * @returns {{engine_state:object, replaying:boolean, day_start_state:object, anchored:boolean,
 *            reason:string}}
 */
function planRunInput(state, tradeDate) {
  const s = state || {};
  const anchored = isDate(tradeDate);
  const dayStart = snapshotDayState(s);

  // 无可用交易日 ⇒ 退化为「每次都当新的一天」（显式标注，不假装幂等）
  if (!anchored) {
    return {
      engine_state: s,
      replaying: false,
      day_start_state: dayStart,
      anchored: false,
      reason: 'no_trade_date'
    };
  }

  const sameDate = s.last_evaluated_trade_date === tradeDate;
  if (sameDate) {
    const hasBaseline = s.day_start_state && typeof s.day_start_state === 'object';
    if (hasBaseline) {
      return {
        engine_state: s.day_start_state,
        replaying: true,
        day_start_state: s.day_start_state,
        anchored: true,
        reason: 'same_trade_date_replay'
      };
    }
    // 旧 state 缺 day_start_state：无法重放，只能按当前计数器继续（旧行为），
    // 但把锚点补齐，使**下一次**同一天运行可以重放。
    return {
      engine_state: s,
      replaying: false,
      day_start_state: dayStart,
      anchored: true,
      reason: 'same_trade_date_without_baseline'
    };
  }

  return {
    engine_state: s,
    replaying: false,
    day_start_state: dayStart,
    anchored: true,
    reason: 'new_trade_date'
  };
}

/**
 * 生成要落库的 trend_stage_state。
 *
 * @param {object} engineStateOut 引擎（decision-v3）回吐的 trend_stage_state
 * @param {string|null} tradeDate
 * @param {object} plan planRunInput 的返回值
 * @returns {object} 供写入 portfolio_position.trend_stage_state
 */
function finalizeState(engineStateOut, tradeDate, plan) {
  const out = snapshotDayState(engineStateOut);
  const p = plan || {};
  return {
    ...out,
    // 锚点：本次评估日 + 当日起点计数器（当日恒定不变 ⇒ 幂等）
    last_evaluated_trade_date: isDate(tradeDate) ? tradeDate : null,
    day_start_state: p.day_start_state || snapshotDayState(engineStateOut),
    trade_date_anchored: p.anchored === true,
    idempotence_reason: p.reason || null
  };
}

module.exports = {
  DAY_STATE_FIELDS,
  snapshotDayState,
  planRunInput,
  finalizeState,
  isDate
};
