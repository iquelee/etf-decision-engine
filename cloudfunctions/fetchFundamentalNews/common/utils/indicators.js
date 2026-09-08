/**
 * 技术指标纯函数（决策引擎内核之一）
 *
 * 约束（架构 A1.3）：
 * - 纯函数、无副作用，输入 bars + 参数，输出状态；
 * - 不依赖数据库/网络，可独立回放；
 * - 阈值一律由 params 传入（运行时读 param_config），本文件不硬编码业务阈值；
 *   仅在 params 缺省时回退 constants.DEFAULT_PARAMS。
 *
 * @module indicators
 */

'use strict';

const { DEFAULT_PARAMS, TREND_CONTEXTS, CONSOLIDATION_SCORE_WEIGHTS } = require('../constants');

/** 安全取数（数组越界返回 null） */
function last(arr, n = 1) {
  if (!arr || arr.length === 0) return null;
  if (n === 1) return arr[arr.length - 1];
  return arr.slice(-n);
}

/** 数组均值（空数组返回 null） */
function mean(arr) {
  if (!arr || arr.length === 0) return null;
  const valid = arr.filter((v) => typeof v === 'number' && !Number.isNaN(v));
  if (valid.length === 0) return null;
  return valid.reduce((s, v) => s + v, 0) / valid.length;
}

/** 数组最大值 */
function max(arr) {
  if (!arr || arr.length === 0) return null;
  return Math.max(...arr.filter((v) => typeof v === 'number' && !Number.isNaN(v)));
}

/** 数组最小值 */
function min(arr) {
  if (!arr || arr.length === 0) return null;
  return Math.min(...arr.filter((v) => typeof v === 'number' && !Number.isNaN(v)));
}

/** 提取 bars 的 close 序列 */
function closes(bars) { return bars.map((b) => b.close); }
function highs(bars) { return bars.map((b) => b.high); }
function lows(bars) { return bars.map((b) => b.low); }
function volumes(bars) { return bars.map((b) => b.volume); }

/**
 * 简单移动平均 MA(n)，前 n-1 项为 null。
 * @param {Array<number>} values
 * @param {number} n
 * @returns {Array<number|null>}
 */
function calcMA(values, n) {
  const result = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) result[i] = sum / n;
  }
  return result;
}

/**
 * 计算 ATR(n)：N 日 TR 简单均值（非 Wilder 递推 Smoothed ATR），返回最新值。
 * TR = max(high-low, |high-prevClose|, |low-prevClose|)
 * @returns {number|null}
 */
function calcATR(highsArr, lowsArr, closesArr, n = 20) {
  const len = Math.min(highsArr.length, lowsArr.length, closesArr.length);
  if (len < n + 1) return null;
  const trs = [];
  for (let i = 1; i < len; i++) {
    const tr = Math.max(
      highsArr[i] - lowsArr[i],
      Math.abs(highsArr[i] - closesArr[i - 1]),
      Math.abs(lowsArr[i] - closesArr[i - 1])
    );
    trs.push(tr);
  }
  const window = trs.slice(-n);
  const m = mean(window);
  return m;
}

/**
 * 线性回归斜率（归一化为每期百分比变化，单位 %/period）。
 * @param {Array<number>} values
 * @param {number} lookback
 * @returns {number|null} 斜率%（>0 向上，≈0 走平，<0 向下）
 */
function calcSlope(values, lookback) {
  const window = values.slice(-lookback);
  const n = window.length;
  if (n < 2) return null;
  const xs = window.map((_, i) => i);
  const yMean = mean(window);
  const xMean = (n - 1) / 2;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - xMean) * (window[i] - yMean);
    den += (xs[i] - xMean) * (xs[i] - xMean);
  }
  if (den === 0) return 0;
  const b = num / den; // 每期绝对变化
  if (yMean === 0) return 0;
  return (b / yMean) * 100;
}

/**
 * 缩量比 = 5 日均量 / 20 日均量。
 * @param {Array<number>} volumesArr
 * @returns {number|null}
 */
function calcVolumeRatio(volumesArr) {
  if (volumesArr.length < 20) return null;
  const v5 = mean(volumesArr.slice(-5));
  const v20 = mean(volumesArr.slice(-20));
  if (!v20 || v20 === 0) return null;
  return v5 / v20;
}

/**
 * 量趋势：近 n 日量线性回归斜率（归一化 %）。
 * @returns {number|null}
 */
function calcVolumeSlope(volumesArr, n = 5) {
  if (volumesArr.length < n) return null;
  return calcSlope(volumesArr.slice(-n), n);
}

/**
 * 找横盘区间：从最近一天往前扩展，维护窗口最高/最低，
 * 直到窗口振幅超过动态阈值（Max(8%, 4×ATR20)）。
 * 适用于上涨后横盘（高位震荡）与下跌后横盘（低位横住）两种场景。
 * @param {Array<object>} bars 日线（升序）
 * @param {object} params 阈值
 * @returns {{days:number, startIdx:number}}
 */
function findConsolidation(bars, params = {}) {
  const rangeBase = params.sideway_range_base != null ? params.sideway_range_base : DEFAULT_PARAMS.sideway_range_base;
  const atrMult = params.sideway_atr_multiplier != null ? params.sideway_atr_multiplier : DEFAULT_PARAMS.sideway_atr_multiplier;
  const hardCap = params.sideway_range_hard_cap != null ? params.sideway_range_hard_cap : DEFAULT_PARAMS.sideway_range_hard_cap;
  const closeArr = closes(bars);
  const highArr = highs(bars);
  const lowArr = lows(bars);
  const atr20 = calcATR(highArr, lowArr, closeArr, 20);
  // V3.1 A5：横盘窗口从昨日起算，今日留给突破检测（与 priorHighBk 不含今日对齐）。
  // 突破日大振幅不再灌进 sideway_days。
  if (bars.length < 2) return { days: 0, startIdx: 0 };
  const endIdx = bars.length - 2;
  const lastClose = closeArr[endIdx] != null ? closeArr[endIdx] : closeArr[closeArr.length - 1];
  const atrThreshold = atr20 != null && lastClose > 0 ? (atr20 / lastClose) * 100 * atrMult : rangeBase;
  const threshold = Math.min(Math.max(rangeBase, atrThreshold), hardCap);

  let winHigh = highArr[endIdx];
  let winLow = lowArr[endIdx];
  let days = 1;
  const maxLook = Math.min(40, endIdx + 1);
  for (let i = 1; i < maxLook; i++) {
    const idx = endIdx - i;
    if (idx < 0) break;
    const h = highArr[idx];
    const l = lowArr[idx];
    if (h != null) winHigh = Math.max(winHigh, h);
    if (l != null) winLow = Math.min(winLow, l);
    const rangePct = winLow > 0 ? ((winHigh - winLow) / winLow) * 100 : 0;
    if (rangePct > threshold) break;
    days = i + 1;
  }
  return { days, startIdx: endIdx - days + 1 };
}

/**
 * 横盘天数：四重确认（时间 + 区间 + 趋势 + 无突破）。
 * 注意：缩量不是横盘的必要条件（只是"高质量横盘"的条件），此处不要求量缩。
 * @param {Array<object>} dailyBars 日线（按日期升序）
 * @param {object} params 阈值
 * @returns {number}
 */
function calcSidewayDays(dailyBars, params = {}) {
  const minDays = params.sideway_days_min != null ? params.sideway_days_min : DEFAULT_PARAMS.sideway_days_min;
  const bars = dailyBars.slice(-80);
  if (bars.length < 20) return 0;

  // V2.1.1：MA20 斜率不再一票否决，改由 Consolidation Score 的 ma20_slope 维度评分。
  // 这样高波动成长股「MA20 缓慢向上、斜率下降」的健康整理也能被识别。
  const { days } = findConsolidation(bars, params);
  return days >= minDays ? days : 0;
}

/**
 * 横盘区间振幅（%）：(区间最高 - 区间最低) / 区间最低 × 100。
 * @param {Array<object>} dailyBars 日线（升序）
 * @param {number} sidewayDays 横盘天数
 * @returns {number|null}
 */
function calcSidewayRange(dailyBars, sidewayDays) {
  if (!sidewayDays || sidewayDays < 1) return null;
  // 与 findConsolidation 一致：窗口止于昨日，不含今日突破 K
  const end = dailyBars.length - 1;
  if (end < 1) return null;
  const start = Math.max(0, end - sidewayDays);
  const bars = dailyBars.slice(start, end);
  const hi = max(highs(bars));
  const lo = min(lows(bars));
  if (hi == null || lo == null || lo <= 0) return null;
  return Math.round(((hi - lo) / lo) * 10000) / 100;
}

/**
 * 突破 = 有效横盘窗口内最高价被收盘价越过（不含今日这根）。
 * 无有效横盘时返回 false，不回退近 10 日高点。
 */
function detectBreakout(sidewayDays, highArr, lastClose, params = {}) {
  const minDays = params.sideway_days_min != null ? params.sideway_days_min : DEFAULT_PARAMS.sideway_days_min;
  if (!sidewayDays || sidewayDays < 1 || sidewayDays < minDays || !highArr || lastClose == null) return false;
  const priorHigh = max(highArr.slice(-(sidewayDays + 1), -1));
  return priorHigh != null && lastClose > priorHigh;
}

/**
 * 横盘前趋势（Trend Context）：横盘起点前 20 日的涨跌幅方向。
 * @param {Array<object>} dailyBars 日线（升序）
 * @param {object} params 阈值 { trend_context_up, trend_context_down }
 * @returns {string} UP_CONSOLIDATION / DOWN_CONSOLIDATION / RANGE_CONSOLIDATION
 */
function detectTrendContext(dailyBars, params = {}) {
  const upTh = params.trend_context_up != null ? params.trend_context_up : DEFAULT_PARAMS.trend_context_up;
  const downTh = params.trend_context_down != null ? params.trend_context_down : DEFAULT_PARAMS.trend_context_down;
  const bars = dailyBars.slice(-80);
  if (bars.length < 30) return TREND_CONTEXTS.RANGE;

  const closeArr = closes(bars);
  // 横盘起点 = 区间扩展找出的横盘区间起点
  const { startIdx } = findConsolidation(bars, params);
  const preStart = startIdx - 20;
  if (preStart < 0) return TREND_CONTEXTS.RANGE;
  const preClose = closeArr[preStart];
  const startClose = closeArr[startIdx];
  if (!preClose || preClose === 0) return TREND_CONTEXTS.RANGE;
  const chg = ((startClose - preClose) / preClose) * 100;
  if (chg >= upTh) return TREND_CONTEXTS.UP;
  if (chg <= downTh) return TREND_CONTEXTS.DOWN;
  return TREND_CONTEXTS.RANGE;
}

/**
 * 横盘评分（Consolidation Score 0~100）：V2.1.1 五维加权。
 * 时间(15) + 波动收敛(20) + 量能收缩(25) + MA20斜率(15) + 趋势/低点(25)。
 * 核心：判断「上涨后筹码消化的质量」，而非「价格是否横住」。
 * @param {number} sidewayDays 连续稳定天数
 * @param {number|null} rangePct 横盘区间振幅%
 * @param {number|null} ma20Slope MA20 5日斜率%
 * @param {number|null} volRatio 量比
 * @param {boolean|null} ma60Up MA60 是否向上
 * @param {object} params 阈值
 * @param {string|null} trendContext 横盘前趋势 UP/DOWN/RANGE
 * @returns {number}
 */
function calcConsolidationScore(sidewayDays, rangePct, ma20Slope, volRatio, ma60Up, params = {}, trendContext = null) {
  const W = CONSOLIDATION_SCORE_WEIGHTS;

  // 1. 整理时间（15）：成熟度递进（8/10/15/20 是成熟度，不是买入门槛）
  let durationScore = 0;
  if (sidewayDays >= 20) durationScore = W.duration;
  else if (sidewayDays >= 15) durationScore = Math.round(W.duration * 0.8);
  else if (sidewayDays >= 10) durationScore = Math.round(W.duration * 0.6);
  else if (sidewayDays >= 8) durationScore = Math.round(W.duration * 0.4);

  // 2. 价格波动收敛（20）：振幅越小分越高
  let rangeScore = 0;
  if (rangePct != null) {
    if (rangePct <= 8) rangeScore = W.range;
    else if (rangePct <= 12) rangeScore = Math.round(W.range * 0.75);
    else if (rangePct <= 15) rangeScore = Math.round(W.range * 0.5);
    else rangeScore = Math.round(W.range * 0.25);
  }

  // 3. 成交量收缩（25）：量比越小分越高（缩量证明抛压下降，权重最高）
  let volumeScore = 0;
  if (volRatio != null) {
    if (volRatio <= 0.70) volumeScore = W.volume;
    else if (volRatio <= 0.75) volumeScore = Math.round(W.volume * 0.8);
    else if (volRatio <= 0.80) volumeScore = Math.round(W.volume * 0.6);
    else if (volRatio <= 0.85) volumeScore = Math.round(W.volume * 0.4);
    else volumeScore = Math.round(W.volume * 0.2);
  }

  // 4. MA20 斜率下降（15）：斜率明显下降即可，不要求走平；>3% 不计入横盘质量分
  let ma20Score = 0;
  if (ma20Slope != null) {
    const abs = Math.abs(ma20Slope);
    if (abs <= 1.0) ma20Score = W.ma20_slope;
    else if (abs <= 2.0) ma20Score = Math.round(W.ma20_slope * 2 / 3);
    else if (abs <= 3.0) ma20Score = Math.round(W.ma20_slope * 0.4);
  }

  // 5. 趋势/低点结构（25）：MA60 向上 15 + 上涨后整理 10
  let trendScore = 0;
  if (ma60Up === true) trendScore += Math.round(W.trend * 0.6);
  if (trendContext === TREND_CONTEXTS.UP) trendScore += Math.round(W.trend * 0.4);

  return durationScore + rangeScore + volumeScore + ma20Score + trendScore;
}

/**
 * 收盘价在近 n 日区间的位置（0~1）。
 * @returns {number|null}
 */
function calcPricePosition(closesArr, n = 20) {
  const window = closesArr.slice(-n);
  if (window.length < 2) return null;
  const hi = max(window);
  const lo = min(window);
  if (hi === lo) return 0.5;
  const lastClose = window[window.length - 1];
  const pos = (lastClose - lo) / (hi - lo);
  return Math.max(0, Math.min(1, pos));
}

/**
 * 日线 → 周线物化（按自然周聚合，周结束日 = 该周最后交易日）。
 * @param {Array<object>} dailyBars
 * @returns {Array<object>} [{ week_end_date, open, high, low, close, volume }]
 */
function buildWeekly(dailyBars) {
  const groups = {};
  dailyBars.forEach((b) => {
    const d = new Date(b.trade_date);
    // ISO 周（周一为一周起点）
    const day = (d.getDay() + 6) % 7; // 周一=0
    const monday = new Date(d);
    monday.setDate(d.getDate() - day);
    const key = monday.toISOString().slice(0, 10);
    if (!groups[key]) groups[key] = [];
    groups[key].push(b);
  });
  const weeks = [];
  Object.keys(groups).sort().forEach((key) => {
    const bars = groups[key].sort((a, b) => (a.trade_date < b.trade_date ? -1 : 1));
    const firstBar = bars[0];
    const lastBar = bars[bars.length - 1];
    weeks.push({
      week_start_date: key,
      week_end_date: lastBar.trade_date,
      open: firstBar.open,
      high: max(highs(bars)),
      low: min(lows(bars)),
      close: lastBar.close,
      volume: bars.reduce((s, b) => s + (b.volume || 0), 0),
      bar_count: bars.length
    });
  });
  // D2：不足 3 个交易日的短周（节假日周）并入前一周，避免单根 K 线的短周扭曲周均线
  const merged = [];
  for (const w of weeks) {
    if (w.bar_count < 3 && merged.length > 0) {
      const prev = merged[merged.length - 1];
      prev.week_end_date = w.week_end_date;
      prev.close = w.close;
      prev.high = Math.max(prev.high, w.high);
      prev.low = Math.min(prev.low, w.low);
      prev.volume += w.volume;
    } else {
      merged.push(w);
    }
  }
  // 删除辅助字段 bar_count，保持返回结构不变
  return merged.map(({ bar_count, ...rest }) => rest);
}

/**
 * 为周线序列附加 ma20w/ma60w/slope 指标。
 * @returns {Array<object>} 每根周线附 { ma20w, ma60w, ma20w_slope, ma60w_slope }
 */
function calcWeeklyIndicators(weeklyBars) {
  const closeArr = closes(weeklyBars);
  const ma20 = calcMA(closeArr, 20);
  const ma60 = calcMA(closeArr, 60);

  // 取某 MA 序列截至 i 的有效（非 null）尾部并算归一化斜率
  // 避免 ma60 前 60 根 null 污染斜率（null 参与减法会被强转为 0）
  const slopeOf = (maArr, i, lookback = 5) => {
    const valid = [];
    for (let k = 0; k <= i; k++) {
      if (maArr[k] != null) valid.push(maArr[k]);
    }
    if (valid.length < 2) return null;
    return calcSlope(valid, lookback);
  };

  return weeklyBars.map((w, i) => {
    const ma20w = ma20[i];
    const ma60w = ma60[i];
    return {
      ...w,
      ma20w: ma20w != null ? ma20w : null,
      ma60w: ma60w != null ? ma60w : null,
      ma20w_slope: ma20w != null ? slopeOf(ma20, i, 5) : null,
      ma60w_slope: ma60w != null ? slopeOf(ma60, i, 5) : null
    };
  });
}

/**
 * 判断周线状态 W1~W5。
 * @param {Array<object>} weeklyBars 已附加 ma20w/ma60w/slope（或未附加，内部计算）
 * @param {object} params 阈值
 * @returns {{state:string, ma20w:number|null, ma60w:number|null, ma20w_slope:number|null, ma60w_slope:number|null}}
 */
function detectWState(weeklyBars, params = {}) {
  const empty = { state: 'W3', ma20w: null, ma60w: null, ma20w_slope: null, ma60w_slope: null };
  if (!weeklyBars || weeklyBars.length < 20) return empty;

  const bars = weeklyBars.map((w) => ({ ...w }));
  const closeArr = closes(bars);
  const withInd = bars[0].ma20w == null ? calcWeeklyIndicators(bars) : bars;
  const cur = withInd[withInd.length - 1];
  const prev = withInd[withInd.length - 2] || cur;

  const close = cur.close;
  const ma20w = cur.ma20w;
  const ma60w = cur.ma60w;
  const ma20w_slope = cur.ma20w_slope || 0;
  const ma60w_slope = cur.ma60w_slope || 0;
  const prevMa60w = prev.ma60w;

  const base = { ma20w, ma60w, ma20w_slope, ma60w_slope };

  // 高低点结构（近 10 周 vs 前 10 周）
  const recent = withInd.slice(-10);
  const prevSeg = withInd.slice(-20, -10);
  const recentHigh = max(highs(recent));
  const prevHigh = prevSeg.length > 0 ? max(highs(prevSeg)) : null;
  const recentLow = min(lows(recent));
  const prevLow = prevSeg.length > 0 ? min(lows(prevSeg)) : null;
  const higherHighLow = prevHigh != null && recentHigh > prevHigh && recentLow >= prevLow;
  const lowerHighLow = prevHigh != null && recentHigh < prevHigh && recentLow < prevLow;

  // 数据不足 ma60w 时降级用 ma20w 判断
  if (ma20w == null) return { ...base, state: 'W3' };

  let state;
  if (close > ma20w && ma20w_slope > 0 && (ma60w == null || ma60w_slope > 0) && higherHighLow) {
    state = 'W1';
  } else if (ma60w != null && close < ma60w && ma20w < ma60w && ma20w_slope < 0 && ma60w_slope < 0 && lowerHighLow) {
    state = 'W5';
  } else if (ma60w != null && close < ma60w && ma20w_slope < 0) {
    // W4a：真跌破——收盘破 60 周线 + 20 周线斜率转负（P2 细化：原「close<ma60w 一票 W4」
    // 对成长股正常回调过敏感，如黄金收盘仍在 MA60w 上方 4.8% 却被判 W4）
    state = 'W4';
  } else if (ma60w != null && close < ma60w && (prevHigh != null && recentHigh < prevHigh && recentLow < prevLow)) {
    // W4a'：跌破 60 周线 + 高低点结构走弱（未确认斜率时由结构佐证）
    state = 'W4';
  } else if (close < ma20w && ma20w_slope < -0.5) {
    // W4b：未破 60 周线，但跌破 20 周线且斜率明显转负（原「斜率<-0.5 一票 W4」收紧为需叠加 close<ma20w，
    // 避免仅斜率微负/高位横盘被判趋势转弱）
    state = 'W4';
  } else if (prevHigh != null && recentHigh < prevHigh && recentLow < prevLow && close < ma20w) {
    // W4b'：高低点结构走弱且跌破 20 周线
    state = 'W4';
  } else if (close < ma20w && (ma60w == null || close > ma60w)) {
    state = 'W3';
  } else if (Math.abs(close / ma20w - 1) < 0.02 && ma20w_slope >= 0 && (ma60w == null || prevMa60w == null || ma60w >= prevMa60w)) {
    state = 'W2';
  } else if (ma20w_slope >= 0) {
    state = 'W2';
  } else {
    state = 'W3';
  }

  // V2.1.1 C6：W2 + 近 4 周高点持续创新高 → 升级 W1。
  // 大牛市初期 higherHighLow 因「前 10 周基数高」而失败，导致趋势完好却长期卡 W2/W3。
  if (state === 'W2' && close > ma20w && ma20w_slope > 0) {
    const risingWeeks = withInd.slice(-4);
    let risingHigh = true;
    let prevWHigh = null;
    for (const wk of risingWeeks) {
      if (prevWHigh != null && wk.high <= prevWHigh) { risingHigh = false; break; }
      prevWHigh = wk.high;
    }
    if (risingHigh && prevWHigh != null) state = 'W1';
  }

  return { ...base, state };
}

/**
 * 判断日线状态 D1~D5。
 * @param {Array<object>} dailyBars
 * @param {object} params
 * @returns {string}
 */
function detectDState(dailyBars, params = {}) {
  if (!dailyBars || dailyBars.length < 20) return 'D3';
  const closeArr = closes(dailyBars);
  const maArr = calcMA(closeArr, 20);
  const ma60Arr = calcMA(closeArr, 60);
  const curClose = closeArr[closeArr.length - 1];
  const ma20 = maArr[maArr.length - 1];
  const ma60 = ma60Arr[ma60Arr.length - 1];
  const ma20_slope = calcSlope(closeArr.slice(-20), 20) || 0;

  const sidewayDays = calcSidewayDays(dailyBars, params);
  const minDays = params.sideway_days_min != null ? params.sideway_days_min : DEFAULT_PARAMS.sideway_days_min;

  // 近 5 日是否创新高
  const recentHigh = max(highs(dailyBars.slice(-5)));
  const prevHigh = max(highs(dailyBars.slice(-20, -5)));
  const newHigh = prevHigh != null && recentHigh > prevHigh;

  if (curClose > ma20 && ma20_slope > 0 && newHigh) return 'D1';
  if (curClose > ma20 && ma20_slope >= 0 && sidewayDays >= minDays) return 'D2';
  if (curClose < ma20 && ma60 != null && curClose > ma60 && ma20_slope >= 0) return 'D3';
  if (ma60 != null && curClose < ma60) return 'D5';
  if (ma20_slope < -0.3) return 'D5';
  // 高位震荡：价格位置高且波动大
  const pos = calcPricePosition(closeArr, 20);
  if (pos != null && pos > 0.65) return 'D4';
  return 'D3';
}

/**
 * 判断横盘质量 H1~H5（基于 Consolidation Score + Trend Context）。
 * - H1 优秀：高质量横盘（score≥80 且上涨后横盘）
 * - H2 良好：有效横盘（score≥65 且非下跌后横盘）
 * - H3 一般：普通震荡/下跌后横盘/非有效横盘
 * - H4 危险：高点持续下降
 * - H5 防守：放量破位
 * @param {number} consolidationScore 横盘评分 0~100
 * @param {string} trendContext UP/DOWN/RANGE
 * @param {object} extra { highPointFalling, trendBroken, volRatio }
 * @param {object} params 阈值
 * @returns {string}
 */
function detectHState(consolidationScore, trendContext, extra = {}, params = {}) {
  const highPointFalling = extra.highPointFalling === true;
  const trendBroken = extra.trendBroken === true;
  const volRatio = extra.volRatio;
  const volRatioHigh = params.volume_ratio_high != null ? params.volume_ratio_high : DEFAULT_PARAMS.volume_ratio_high;

  // H5 防守：放量破位（趋势破坏 + 放量）
  if (trendBroken || (highPointFalling && volRatio != null && volRatio >= volRatioHigh)) return 'H5';
  // H4 危险：高点持续下降
  if (highPointFalling) return 'H4';

  // A/B/C 级横盘（上涨后高质量整理才是最佳加仓结构；V2.1.1 H1 阈值 75 对齐 A 级门槛）
  if (consolidationScore >= 75 && trendContext === TREND_CONTEXTS.UP) return 'H1';
  if (consolidationScore >= 65 && trendContext !== TREND_CONTEXTS.DOWN) return 'H2';
  return 'H3';
}

/**
 * 判断量能状态 V1~V5。
 * @param {number} volRatio
 * @param {number} volSlope
 * @param {object} params
 * @returns {string}
 */
function detectVState(volRatio, volSlope, params = {}) {
  const th = params.volume_ratio != null ? params.volume_ratio : DEFAULT_PARAMS.volume_ratio;
  const mild = params.volume_ratio_mild != null ? params.volume_ratio_mild : DEFAULT_PARAMS.volume_ratio_mild;
  const high = params.volume_ratio_high != null ? params.volume_ratio_high : DEFAULT_PARAMS.volume_ratio_high;
  const extreme = params.volume_ratio_extreme != null ? params.volume_ratio_extreme : DEFAULT_PARAMS.volume_ratio_extreme;
  if (volRatio == null) return 'V3';
  if (volRatio <= th) return 'V1';
  if (volRatio <= mild) return 'V2';
  if (volRatio <= high) return 'V3';
  if (volRatio <= extreme) return 'V4';
  return 'V5';
}

/**
 * 放量滞涨检测：量明显增 + 价涨幅不足半个 ATR + 3~5 日无法创新高（ATR 标准化）。
 * @returns {boolean}
 */
function detectHighVolStagnation(bars, params = {}) {
  if (!bars || bars.length < 20) return false;
  const volRatio = calcVolumeRatio(volumes(bars));
  const high = params.volume_ratio_high != null ? params.volume_ratio_high : DEFAULT_PARAMS.volume_ratio_high;
  if (volRatio == null || volRatio < high) return false;

  const closeArr = closes(bars);
  const highArr = highs(bars);
  const lowArr = lows(bars);
  const lastClose = closeArr[closeArr.length - 1];
  const close5ago = closeArr[closeArr.length - 6];
  const atr20 = calcATR(highArr, lowArr, closeArr, 20);
  const atrRatioTh = params.stagnation_atr_ratio != null ? params.stagnation_atr_ratio : DEFAULT_PARAMS.stagnation_atr_ratio;

  // ATR 标准化：5 日价格变化 / ATR20 <= 0.5 视为滞涨；无 ATR 数据时回退固定 2% 涨幅阈值
  if (close5ago != null) {
    if (atr20 != null && atr20 > 0) {
      const change5 = lastClose - close5ago; // 绝对价格变化
      if (change5 / atr20 > atrRatioTh) return false; // 涨幅不小，非滞涨
    } else {
      const change5Pct = ((lastClose - close5ago) / close5ago) * 100;
      if (change5Pct > 2) return false;
    }
  }

  const recentHigh = max(highs(bars.slice(-5)));
  const prevHigh = max(highs(bars.slice(-20, -5)));
  return prevHigh != null && recentHigh < prevHigh; // 近5日无法创新高
}

/**
 * 放量下跌检测：量显著增 + 价明显跌 + 破关键平台（close < ma20）。
 * @returns {boolean}
 */
function detectHighVolDecline(bars, params = {}) {
  if (!bars || bars.length < 20) return false;
  const volRatio = calcVolumeRatio(volumes(bars));
  const high = params.volume_ratio_high != null ? params.volume_ratio_high : DEFAULT_PARAMS.volume_ratio_high;
  if (volRatio == null || volRatio < high) return false;

  const closeArr = closes(bars);
  const lastClose = closeArr[closeArr.length - 1];
  const close5ago = closeArr[closeArr.length - 6];
  const change5 = close5ago ? ((lastClose - close5ago) / close5ago) * 100 : 0;
  if (change5 > -3) return false; // 跌幅不明显

  const maArr = calcMA(closeArr, 20);
  const ma20 = maArr[maArr.length - 1];
  return ma20 != null && lastClose < ma20;
}

/**
 * 阶段通俗话术（普通投资者可读，替代「周线震荡/趋势破坏/强缩量」等术语）。
 * 用「中期/短期/成交」等大白话描述，避免 K 线周期专业词汇。
 */
const STAGE_PLAIN_W = {
  W1: '中期强势上行', W2: '中期趋势向上', W3: '中期来回震荡', W4: '中期趋势转弱', W5: '中期转为下跌'
};
const STAGE_PLAIN_D = {
  D1: '短期在上涨', D2: '短期涨后盘整', D3: '短期正常回调', D4: '短期高位震荡', D5: '短期走弱'
};
const STAGE_PLAIN_V = {
  V1: '成交明显萎缩', V2: '成交温和萎缩', V3: '成交正常', V4: '成交放大', V5: '成交异常放大'
};

/**
 * 生成阶段通俗概括（把 W/D/V 状态码翻译成一句人话）。
 * 纯函数，输入 snapshot 状态字段，输出一句话。
 * @param {object} s { w_state, d_state, v_state, sideway_days }
 * @returns {string}
 */
function buildStageSummary(s) {
  const w = (s && STAGE_PLAIN_W[s.w_state]) || '中期走势未知';
  const d = (s && STAGE_PLAIN_D[s.d_state]) || '短期走势未知';
  const v = (s && STAGE_PLAIN_V[s.v_state]) || '成交量未知';
  const days = (s && s.sideway_days) || 0;

  let sidewayPart;
  if (days >= 20) sidewayPart = `已横盘 ${days} 个交易日（较充分）`;
  else if (days >= 10) sidewayPart = `已横盘 ${days} 个交易日`;
  else sidewayPart = '尚未横盘';

  return `${w}，${d}，${sidewayPart}，${v}`;
}

/**
 * 综合计算一次指标快照（供 materializeIndicators 云函数调用）。
 * @param {Array<object>} dailyBars 日线（升序，至少 20 根）
 * @param {object} params 运行时阈值
 * @param {object} opts { code, calc_date, premium_rate, version }
 * @returns {object} indicator_snapshot 文档
 */
function computeSnapshot(dailyBars, params = {}, opts = {}) {
  const code = opts.code || '';
  const calcDate = opts.calc_date || (dailyBars.length ? dailyBars[dailyBars.length - 1].trade_date : '');
  const version = opts.version != null ? opts.version : 0;
  const premiumRate = opts.premium_rate != null ? opts.premium_rate : null;

  const enough = dailyBars && dailyBars.length >= 20;
  const closeArr = closes(dailyBars);
  const highArr = highs(dailyBars);
  const lowArr = lows(dailyBars);
  const volArr = volumes(dailyBars);

  const ma5 = calcMA(closeArr, 5);
  const ma10 = calcMA(closeArr, 10);
  const ma20 = calcMA(closeArr, 20);
  const ma60 = calcMA(closeArr, 60);
  const ma120 = calcMA(closeArr, 120);
  const ma250 = calcMA(closeArr, 250);

  const lastClose = closeArr[closeArr.length - 1];
  const ma20Val = ma20[ma20.length - 1];
  const ma60Val = ma60[ma60.length - 1];
  // P1-1 修复（2026-08-22）：ma60Slope 应为 MA60 序列的斜率（判断 MA60 是否向上），
  // 原实现对收盘价序列算 20 日斜率，口径名不副实（收盘价斜率≠MA60 斜率，MA60 走平时误差放大）。
  // calcSlope 从数组末尾取两个点算百分比变化，ma60 数组尾部 60 个值足够。
  const ma60Slope = calcSlope(ma60.slice(-20), 20) || 0;

  // 趋势不破：close>ma20 且 ma20>ma60 且 ma60_slope>0
  const trendOK = ma20Val != null && ma60Val != null
    ? (lastClose > ma20Val && ma20Val > ma60Val && ma60Slope > 0)
    : (ma20Val != null ? lastClose > ma20Val : false);

  const sidewayDays = calcSidewayDays(dailyBars, params);
  const volRatio = calcVolumeRatio(volArr);
  const volSlope = calcVolumeSlope(volArr, 5);

  // 高点下降检测（近 5 日高点 < 前 5 日高点）
  const recentHigh5 = max(highArr.slice(-5));
  const prevHigh5 = max(highArr.slice(-10, -5));
  const highPointFalling = prevHigh5 != null && recentHigh5 < prevHigh5;

  const wBars = buildWeekly(dailyBars);
  const wState = detectWState(wBars, params).state;
  const dState = detectDState(dailyBars, params);
  const highVolStag = detectHighVolStagnation(dailyBars, params);
  const highVolDecline = detectHighVolDecline(dailyBars, params);

  // 横盘字段：区间振幅 + MA20 斜率 + 趋势上下文 + 横盘评分（Consolidation Score）+ 突破
  const sidewayRange = calcSidewayRange(dailyBars, sidewayDays);
  const ma20_5ago = ma20[ma20.length - 6];
  const ma20Slope5 = ma20Val != null && ma20_5ago != null && ma20_5ago !== 0
    ? ((ma20Val - ma20_5ago) / ma20_5ago) * 100 : null;
  const trendContext = detectTrendContext(dailyBars, params);
  const ma60Up = ma60Slope > 0;
  // 非横盘（sideway_days=0）时评分为 0，明确不进入横盘加仓模型
  const consolidationScore = sidewayDays > 0
    ? calcConsolidationScore(sidewayDays, sidewayRange, ma20Slope5, volRatio, ma60Up, params, trendContext)
    : 0;
  // 突破检测（V2.1.1 C4：突破 = 横盘成熟后的第二阶段）。
  // 无有效横盘（sidewayDays < min）不得回退近 N 日高点，否则超跌反弹会出假突破。
  const breakout = detectBreakout(sidewayDays, highArr, lastClose, params);
  const trendBroken = highVolDecline === true;

  const hState = detectHState(consolidationScore, trendContext, {
    highPointFalling, trendBroken, volRatio
  }, params);
  const vState = detectVState(volRatio, volSlope, params);
  const pricePosition = calcPricePosition(closeArr, 20);
  const atr20 = calcATR(highArr, lowArr, closeArr, 20);
  const vol20 = mean(volArr.slice(-20));

  // 近 5 日涨幅与偏离 20 日均线（拥挤度用）
  const close5ago = closeArr.length > 5 ? closeArr[closeArr.length - 6] : null;
  const change5d = close5ago ? ((lastClose - close5ago) / close5ago) * 100 : null;
  const bias20d = ma20Val ? ((lastClose - ma20Val) / ma20Val) * 100 : null;

  // 数据完整性：日线不足 20 根或关键指标缺失则 false
  const dataComplete = enough && ma20Val != null && volRatio != null && atr20 != null;

  return {
    code,
    calc_date: calcDate,
    ma5: ma5[ma5.length - 1] != null ? ma5[ma5.length - 1] : null,
    ma10: ma10[ma10.length - 1] != null ? ma10[ma10.length - 1] : null,
    ma20: ma20Val,
    ma60: ma60Val,
    ma120: ma120[ma120.length - 1] != null ? ma120[ma120.length - 1] : null,
    ma250: ma250[ma250.length - 1] != null ? ma250[ma250.length - 1] : null,
    atr20,
    vol20,
    sideway_days: sidewayDays,
    sideway_range: sidewayRange,
    ma20_slope: ma20Slope5 != null ? Math.round(ma20Slope5 * 100) / 100 : null,
    trend_context: trendContext,
    consolidation_score: consolidationScore,
    breakout: breakout === true,
    volume_ratio: volRatio,
    volume_slope: volSlope,
    v_state: vState,
    w_state: wState,
    d_state: dState,
    h_state: hState,
    stage_summary: buildStageSummary({ w_state: wState, d_state: dState, v_state: vState, sideway_days: sidewayDays }),
    high_volume_stagnation: highVolStag,
    high_volume_decline: highVolDecline,
    price_position: pricePosition,
    premium_rate: premiumRate,
    change_5d: change5d,
    bias_20d: bias20d,
    data_complete: dataComplete,
    version
  };
}

module.exports = {
  last,
  mean,
  max,
  min,
  closes,
  highs,
  lows,
  volumes,
  calcMA,
  calcATR,
  calcSlope,
  calcVolumeRatio,
  calcVolumeSlope,
  findConsolidation,
  calcSidewayDays,
  calcSidewayRange,
  detectBreakout,
  detectTrendContext,
  calcConsolidationScore,
  calcPricePosition,
  buildWeekly,
  calcWeeklyIndicators,
  detectWState,
  detectDState,
  detectHState,
  detectVState,
  detectHighVolStagnation,
  detectHighVolDecline,
  computeSnapshot
};
