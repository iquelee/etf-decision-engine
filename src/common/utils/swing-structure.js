/**
 * V3.6.1 Safety Hardening R1 —— Swing Structure 唯一实现（Single Truth）
 *
 * 背景（R1 缺陷 #2）：
 *   历史上 `trend-stage.js` 与 `v3-6-stage-persistence.js` **各自复制**了一份
 *   `swingHighLow()`，且两份都只返回 `higherLow` / `lowerHigh`。
 *   但 `v3-shadow.js::appendSlowBreakHistory()` 读取 `swing.lowerLow`、
 *   `defense.js::isSlowBreakHigh()` 要求「过去 5 日中 ≥3 日同时 LH 且 LL」——
 *   `lowerLow` 恒为 `undefined` ⇒ `isSlowBreakHigh()` 永远 false ⇒
 *   DefenseScore 的 +20 SlowBreak bonus 永远不会触发。
 *
 * 本模块是 swing 结构的**唯一**实现。任何模块需要摆动高低点，必须 require 本文件，
 * 禁止再复制第二份算法。
 *
 * 语义（与修复前保持一致的窗口口径）：
 *   - 近 5 根（bars 末尾 5 根）vs 前 5 根（末尾第 6~10 根）
 *   - `higherHigh` = 近 5 根最高价 > 前 5 根最高价
 *   - `lowerHigh`  = 近 5 根最高价 < 前 5 根最高价
 *   - `higherLow`  = 近 5 根最低价 > 前 5 根最低价
 *   - `lowerLow`   = 近 5 根最低价 < 前 5 根最低价
 *
 * 向后兼容：
 *   - 修复前 `lowerLow` 不存在（`undefined`）。任何以 `=== true` 判定的旧消费点，
 *     在修复后语义正确；以 falsy 判定的点行为不变。
 *   - 不足 12 根 / high-low 缺失时，四项一律 `false`（与旧实现 NaN 比较的结果一致），
 *     并附 `computable: false` 供调用方区分「不可计算」与「计算为否」。
 *
 * 本文件为**纯函数**，不读写任何状态、不触碰生产写入路径。
 */
'use strict';

const SWING_WINDOW = 5;
const SWING_MIN_BARS = 12; // 需要 前5 + 近5 + 2 根缓冲

function numOrNull(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function emptySwing(reason) {
  return {
    higherHigh: false,
    higherLow: false,
    lowerHigh: false,
    lowerLow: false,
    computable: false,
    reason: reason || 'insufficient_bars',
    window: SWING_WINDOW,
    sample: 0
  };
}

/**
 * 摆动高低点。
 * @param {Array<{high?:number,low?:number}>} bars 日线序列（**升序**，最后一根为最新）
 * @returns {{higherHigh:boolean,higherLow:boolean,lowerHigh:boolean,lowerLow:boolean,
 *            computable:boolean,reason?:string,window:number,sample:number,
 *            priorHigh?:number,priorLow?:number,recentHigh?:number,recentLow?:number}}
 */
function swingHighLow(bars) {
  if (!Array.isArray(bars) || bars.length < SWING_MIN_BARS) return emptySwing('insufficient_bars');

  const priorSlice = bars.slice(-10, -5);
  const recentSlice = bars.slice(-5);
  if (priorSlice.length < SWING_WINDOW || recentSlice.length < SWING_WINDOW) {
    return emptySwing('insufficient_bars');
  }

  const priorHighs = priorSlice.map((b) => numOrNull(b && b.high));
  const priorLows = priorSlice.map((b) => numOrNull(b && b.low));
  const recentHighs = recentSlice.map((b) => numOrNull(b && b.high));
  const recentLows = recentSlice.map((b) => numOrNull(b && b.low));

  if (priorHighs.some((v) => v == null) || priorLows.some((v) => v == null)
    || recentHighs.some((v) => v == null) || recentLows.some((v) => v == null)) {
    // 旧实现对 null 会得到 NaN，所有比较均为 false —— 这里显式返回同等结果并标注不可计算
    return emptySwing('missing_high_low');
  }

  const priorHigh = Math.max.apply(null, priorHighs);
  const priorLow = Math.min.apply(null, priorLows);
  const recentHigh = Math.max.apply(null, recentHighs);
  const recentLow = Math.min.apply(null, recentLows);

  return {
    higherHigh: recentHigh > priorHigh,
    lowerHigh: recentHigh < priorHigh,
    higherLow: recentLow > priorLow,
    lowerLow: recentLow < priorLow,
    computable: true,
    window: SWING_WINDOW,
    sample: SWING_WINDOW * 2,
    priorHigh,
    priorLow,
    recentHigh,
    recentLow
  };
}

module.exports = {
  SWING_WINDOW,
  SWING_MIN_BARS,
  swingHighLow
};
