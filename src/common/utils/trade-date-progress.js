/**
 * V3.6.1 Safety Hardening R1 —— 交易日锚点工具（Trade-Date Anchored Counters）
 *
 * 背景（R1 缺陷 #1）：
 *   旧实现里 `pendingDays` / `days_in_stage` / `soft_down_days` / `s5_risk_days`
 *   都是「每次函数调用 +1」。同一个 `snapshot.calc_date` 当天被重复运行
 *   （手工重跑、后台重复触发、Canary 重算、补数重跑）时，**运行次数被冒充成交易日**，
 *   会让「升级需 2 日 / 三日降级 / `s5_risk_confirm_days=2`」在一天内被凑满。
 *
 * 修复原则：
 *   把「谁在计一天」这件事显式写成状态里的**日期锚点**，而不是隐式依赖调用次数。
 *   同一个 `trade_date` 无论被评估多少次，都只贡献 1 个交易日。
 *
 * 锚点字段（存放在 trend_stage_state 内，随既有持久化链路落库）：
 *   - `pending_last_counted_date`      迟滞 pending 计数的最后计入日
 *   - `persistence_last_counted_date`  days_in_stage（S4/S5 驻留）最后计入日
 *   - `soft_down_last_counted_date`    soft_down_days 最后计入日
 *   - `s5_risk_last_counted_date`      s5_risk_days 最后计入日
 *
 * 向后兼容：
 *   旧 state 没有锚点（`undefined`）⇒ 视为「尚未计入」，本次计入一次并写锚点，
 *   与修复前「第一次调用 +1」的行为一致，不会崩溃、不会跳变。
 *   `trade_date` 缺失（旧快照 / 非生产调用）⇒ 退化为旧行为（按调用次数推进），
 *   并在返回值里用 `anchored:false` 显式标注，不静默假装已锚定。
 *
 * 本文件为**纯函数**，不读写任何状态。
 */
'use strict';

/**
 * 从 snapshot 解析权威交易日。
 * @param {object} snapshot
 * @returns {string|null} 形如 '2026-09-22'；缺失/非法返回 null
 */
function resolveTradeDate(snapshot) {
  const d = snapshot && snapshot.calc_date;
  if (typeof d === 'string' && d.trim() !== '') return d.trim();
  return null;
}

function isPlainDate(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/**
 * 按「唯一交易日」推进一个日计数器。
 *
 * @param {number} prevCount   上一次的计数
 * @param {string|null} prevAnchor 上一次计入的日期锚点
 * @param {string|null} tradeDate  本次的权威交易日
 * @param {number} [step=1]        推进步长
 * @returns {{count:number, counted:boolean, anchor:string|null, anchored:boolean}}
 *   counted=true 表示本次真的推进了计数器；counted=false 表示同日重复运行被挡住。
 *   anchored=false 表示本次没有可用交易日（退化为旧行为）。
 */
function advanceDailyCounter(prevCount, prevAnchor, tradeDate, step) {
  const base = typeof prevCount === 'number' && Number.isFinite(prevCount) ? prevCount : 0;
  const n = typeof step === 'number' && Number.isFinite(step) ? step : 1;

  if (!isPlainDate(tradeDate)) {
    // 无可用交易日 ⇒ 保持旧语义（按调用次数推进），并显式标注未锚定
    return { count: base + n, counted: true, anchor: prevAnchor || null, anchored: false };
  }
  if (prevAnchor === tradeDate) {
    // 同一个交易日重复运行 ⇒ 不推进
    return { count: base, counted: false, anchor: tradeDate, anchored: true };
  }
  return { count: base + n, counted: true, anchor: tradeDate, anchored: true };
}

/**
 * 计数器被重置（换阶段 / 清 pending）时的锚点处理。
 * 重置当天视为「已经计入过这一天」，因此同一天再跑不会立刻变成 1。
 * @param {string|null} tradeDate
 * @returns {string|null}
 */
function resetAnchor(tradeDate) {
  return isPlainDate(tradeDate) ? tradeDate : null;
}

module.exports = {
  resolveTradeDate,
  advanceDailyCounter,
  resetAnchor,
  isPlainDate
};
