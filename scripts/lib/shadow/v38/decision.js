/**
 * 决策引擎纯函数（全项目最核心算法）
 *
 * 六层架构 + 五维评分(25/25/25/15/10) + 机会分(Trend35/Vol30/Fund25/Crowd10)
 * + 六态状态机 + P0~P7 硬规则优先级 + explain_chain 决策链。
 *
 * 约束：
 * - 纯函数、无副作用，不依赖数据库/网络，可独立回放；
 * - 评分不推翻硬规则（优先级 P0 证伪/熔断 > P1 周线 > P2 基本面 > P3 量价
 *   > P4 组合 > P5 拥挤 > P6 评分 > P7 战术）；
 * - 阈值由 params 传入，缺省回退 constants.DEFAULT_PARAMS。
 *
 * @module decision
 */

'use strict';

const {
  W_STATE_LABELS, H_STATE_LABELS, V_STATE_LABELS, F_STATE_LABELS, C_STATE_LABELS,
  DEFAULT_PARAMS, DEFAULT_OPPORTUNITY_WEIGHTS, SCORE_MAX, TECH_SECTORS,
  OPPORTUNITY_FACTORS, RISK_FACTORS, CORE_RATIOS, TRADE_RATIOS, F_TO_CORE_GRADE,
  BUILD_FIRST_LOT_PCT, ADD_STEP_PCT, ADD_TREND_STEP_PCT,
  ADD_BREAKOUT_MAX_PCT, ADD_THRESHOLD_PCT, OVER_ALLOC_REDUCE_PCT, OVER_ALLOC_THRESHOLDS,
  ACTION_LABELS, TREND_CONTEXTS, MARKET_REGIME_LABELS, CASH_REGIME
} = require('./constants');

/* ============================ 五维评分 ============================ */

/** 趋势评分（满分 25） */
function scoreTrend(wState) {
  const map = { W1: 25, W2: 20, W3: 15, W4: 10, W5: 5 };
  return map[wState] != null ? map[wState] : 15;
}

/**
 * 量价评分（满分 25）
 * @param {string} hState H1~H5
 * @param {string} vState V1~V5
 * @param {object} flags { high_volume_decline, high_volume_stagnation, price_position }
 */
/**
 * 量能评分（满分 25）——B2 去双重计分（2026-08-22）：
 * 原实现 H1+V1/V2→25 分，而 H 状态源自横盘评分 → "横盘质量"经 H→Volume 维→机会分计了 2 次，
 * 模型过度偏爱形态漂亮标的。现在 Volume 维只度量**量能本身**（V 状态 + 防守 flag），
 * 横盘质量改由资格闸门 structure（H 状态）单独把关，各司其职。
 */
function scoreVolume(hState, vState, flags = {}) {
  const { high_volume_decline, high_volume_stagnation, price_position } = flags;
  if (high_volume_decline) return 0; // 放量下跌破位（最高优先级防守）
  if (high_volume_stagnation && price_position != null && price_position > 0.7) return 5; // 高位放量滞涨
  if (high_volume_stagnation) return 10; // 放量滞涨
  if (vState === 'V1' || vState === 'V2') return 25; // 缩量（V1 明显缩量/V2 温和缩量→满分）
  if (vState === 'V3') return 15; // 正常量
  if (vState === 'V4') return 10; // 放量
  if (vState === 'V5') return 5;  // 异常放量
  return 15;
}

/** 基本面评分（满分 25） */
function scoreFundamental(fState) {
  const map = { F1: 25, F2: 20, F3: 15, F4: 10, F5: 5 };
  return map[fState] != null ? map[fState] : 15;
}

/** 拥挤度评分（满分 15） */
function scoreCrowding(cState) {
  const map = { C1: 15, C2: 10, C3: 5, C4: 0 };
  return map[cState] != null ? map[cState] : 10;
}

/** 风险评分（满分 10）：熔断置 0；RED（未 override）置 2 强化防守 */
function scoreRisk(riskFlag, riskOverride = false) {
  if (riskOverride) return 0;
  const map = { NORMAL: 10, YELLOW: 7, RED: 2 };
  return map[riskFlag] != null ? map[riskFlag] : 10;
}

/* ============================ 机会分 ============================ */

/**
 * 机会分 = Trend×35% + Volume×30% + Fund×25% + Crowd×10%（权重可配，熔断置 0）。
 * @param {object} scores { trend, volume, fundamental, crowding }
 * @param {object} weights { trend, volume, fundamental, crowding }（百分比 35/30/25/10）
 * @param {boolean} riskOverride
 * @returns {number}
 */
function calcOpportunityScore(scores, weights = DEFAULT_OPPORTUNITY_WEIGHTS, riskOverride = false) {
  if (riskOverride) return 0;
  const w = {
    trend: weights.trend != null ? weights.trend : DEFAULT_OPPORTUNITY_WEIGHTS.trend,
    volume: weights.volume != null ? weights.volume : DEFAULT_OPPORTUNITY_WEIGHTS.volume,
    fundamental: weights.fundamental != null ? weights.fundamental : DEFAULT_OPPORTUNITY_WEIGHTS.fundamental,
    crowding: weights.crowding != null ? weights.crowding : DEFAULT_OPPORTUNITY_WEIGHTS.crowding
  };
  const total = (w.trend + w.volume + w.fundamental + w.crowding) || 1;
  // 分维先归一化到 0~1（各自除以满分），再加权求和，×100 得到 0~100 机会分。
  // 旧实现分子分母同时乘 (w/total)，在各分维满分不同（25/25/25/15）时权重被归一化抵消，等价于等权。
  const raw =
    ((scores.trend || 0) / (SCORE_MAX.trend || 1)) * (w.trend / total) +
    ((scores.volume || 0) / (SCORE_MAX.volume || 1)) * (w.volume / total) +
    ((scores.fundamental || 0) / (SCORE_MAX.fundamental || 1)) * (w.fundamental / total) +
    ((scores.crowding || 0) / (SCORE_MAX.crowding || 1)) * (w.crowding / total);
  return Math.round(raw * 100);
}

/* ============================ 拥挤度引擎 ============================ */

/**
 * 计算拥挤度状态 + 折溢价等级。
 * @param {object} ctx { etf:{is_qdii}, snapshot:{premium_rate, bias_20d, change_5d, volume_ratio}, params }
 * @returns {{c_state:string, premium_flag:string}}
 */
function computeCrowding(ctx) {
  const { etf = {}, snapshot = {}, params = {} } = ctx;
  const isQdii = etf.is_qdii === true;
  const premium = snapshot.premium_rate;
  const bias20d = snapshot.bias_20d;

  const light = isQdii
    ? (params.premium_qdii_light != null ? params.premium_qdii_light : DEFAULT_PARAMS.premium_qdii_light)
    : (params.premium_etf_light != null ? params.premium_etf_light : DEFAULT_PARAMS.premium_etf_light);
  const obvious = isQdii
    ? (params.premium_qdii_obvious != null ? params.premium_qdii_obvious : DEFAULT_PARAMS.premium_qdii_obvious)
    : (params.premium_etf_obvious != null ? params.premium_etf_obvious : DEFAULT_PARAMS.premium_etf_obvious);
  const extreme = isQdii
    ? (params.premium_qdii_extreme != null ? params.premium_qdii_extreme : DEFAULT_PARAMS.premium_qdii_extreme)
    : (params.premium_etf_extreme != null ? params.premium_etf_extreme : DEFAULT_PARAMS.premium_etf_extreme);
  const biasHot = params.bias_20d_hot != null ? params.bias_20d_hot : DEFAULT_PARAMS.bias_20d_hot;
  const biasCrowd = params.bias_20d_crowd != null ? params.bias_20d_crowd : DEFAULT_PARAMS.bias_20d_crowd;

  let premiumFlag = '正常';
  if (premium != null && premium >= extreme) premiumFlag = '极端溢价';
  else if (premium != null && premium >= obvious) premiumFlag = '明显溢价';
  else if (premium != null && premium >= light) premiumFlag = '轻度溢价';

  let cState = 'C1';
  const absBias = bias20d != null ? Math.abs(bias20d) : 0;
  if (premiumFlag === '极端溢价' || absBias >= biasCrowd) cState = 'C4';
  else if (premiumFlag === '明显溢价' || absBias >= biasHot) cState = 'C3';
  else if (premiumFlag === '轻度溢价' || absBias >= biasHot * 0.6) cState = 'C2';

  return { c_state: cState, premium_flag: premiumFlag };
}

/* ============================ 仓位引擎 V2.0.1 ============================ */

/**
 * 机会分 → 机会等级 A~F。
 * 阈值：≥80=A、65~79=B、50~64=C、35~49=D、20~34=E、<20=F
 */
function gradeOpportunity(score) {
  if (score == null || Number.isNaN(Number(score))) return 'F';
  if (score >= 80) return 'A';
  if (score >= 65) return 'B';
  if (score >= 50) return 'C';
  if (score >= 35) return 'D';
  if (score >= 20) return 'E';
  return 'F';
}

/**
 * 目标仓位区间生成器（V2.1：区间动态生成，纯函数）。
 * @param {number} maxStrategic 最大战略仓位（基数）
 * @param {string} grade 机会等级 A~F
 * @returns {{target_min:number, target_std:number, target_max:number}}
 *   target_min = maxStrategic × 区间下限；target_max = × 上限；target_std = 中值，均四舍五入 1 位
 */
function computeTargetRange(maxStrategic, grade) {
  const range = (OPPORTUNITY_FACTORS[grade] && Array.isArray(OPPORTUNITY_FACTORS[grade]))
    ? OPPORTUNITY_FACTORS[grade] : [0, 0];
  const round1 = (n) => Math.round(n * 10) / 10;
  const targetMin = round1(maxStrategic * range[0]);
  const targetMax = round1(maxStrategic * range[1]);
  const targetStd = round1((targetMin + targetMax) / 2);
  return { target_min: targetMin, target_std: targetStd, target_max: targetMax };
}

/**
 * 目标仓位生成器（纯函数，核心公式链）：
 *   机会等级 → 机会系数 → 基础目标 = maxStrategic × factor
 *   → 风险修正 = 基础目标 × riskFactor → 组合约束 MIN(修正目标, ETF上限, 赛道剩余, 组合上限)
 *   → Gap = finalTarget − current
 * @returns {{grade:string, factor:number, finalTarget:number, gap:number}}
 */
function generateTargetPosition(ctx) {
  const { positions = {}, params = {}, risk = {}, portfolio = {}, etf = {}, fundamental = {} } = ctx;
  const grade = gradeOpportunity(ctx.opportunityScore);

  // F5 证伪：目标仓直接 0（与 EXIT 动作/核心仓清零语义一致，避免 finalTarget 与 suggested 口径分裂）
  if (fundamental.f_state === 'F5') {
    return { grade: 'F', factor: 0, range: { target_min: 0, target_std: 0, target_max: 0 }, finalTarget: 0, gap: 0 - (positions.current_position || 0) };
  }

  const maxStrategic = positions.max_strategic_position != null ? positions.max_strategic_position
    : (positions.max_position != null ? positions.max_position
      : (params.single_etf_max != null ? params.single_etf_max : DEFAULT_PARAMS.single_etf_max));

  // 目标仓位区间（动态生成）
  const range = computeTargetRange(maxStrategic, grade);
  // 机会系数保留区间中值（兼容旧字段）
  const factorRange = (OPPORTUNITY_FACTORS[grade] && Array.isArray(OPPORTUNITY_FACTORS[grade]))
    ? OPPORTUNITY_FACTORS[grade] : [0, 0];
  const factor = (factorRange[0] + factorRange[1]) / 2;

  const riskFactor = risk.risk_override === true ? 0
    : (RISK_FACTORS[risk.risk_flag] != null ? RISK_FACTORS[risk.risk_flag] : 1.0);
  const riskAdjustedStd = range.target_std * riskFactor;

  const current = positions.current_position || 0;
  const singleMax = params.single_etf_max != null ? params.single_etf_max : DEFAULT_PARAMS.single_etf_max;

  // 赛道剩余空间（科技三赛道：给本 ETF 留出从当前仓加到赛道上限的余地）
  let sectorRemaining = singleMax;
  const sector = etf.sector || '';
  if (TECH_SECTORS.indexOf(sector) >= 0) {
    const techMax = params.tech_sector_max != null ? params.tech_sector_max : DEFAULT_PARAMS.tech_sector_max;
    const techPos = portfolio.tech_position != null ? portfolio.tech_position : 0;
    // 组合层已按机会分排序分配额度时，优先用外部传入的剩余额度；否则回退单 ETF 视角兜底
    sectorRemaining = ctx.sectorRemainingLimit != null
      ? Math.max(0, ctx.sectorRemainingLimit)
      : Math.max(0, techMax - (techPos - current));
  }

  let finalTarget = Math.min(riskAdjustedStd, range.target_max, sectorRemaining, singleMax);
  // YELLOW 风险：目标仓位不得高于当前（不能新增），与加仓闸门 pause 保持一致，避免"目标>当前但永远加不了"的死锁
  if (risk.risk_override !== true && risk.risk_flag === 'YELLOW') {
    finalTarget = Math.min(finalTarget, current);
  }
  // 市场环境分级约束（P1-6，用户拍板）：
  // - crisis（系统性风险）：禁止新增，目标 ≤ 当前
  // - defensive（防守）：压缩单票目标（上限 = 当前 + 现金目标下限对应的可投空间的一半，保守起见 ≤ max(current, target_std×0.5)）
  const regime = portfolio.market_regime || 'range';
  if (regime === 'crisis') {
    finalTarget = Math.min(finalTarget, current);
  } else if (regime === 'defensive') {
    finalTarget = Math.min(finalTarget, Math.max(current, range.target_std * 0.5));
  }
  const gap = finalTarget - current;
  return { grade, factor, range, finalTarget, gap };
}

/**
 * 横盘加仓分级（P1-4）：返回 'A'/'B'/'C'/null。
 * - A级：上涨后横盘 + 缩量(volume_ratio≤0.85) + 趋势不破 → 核心买点
 * - B级：上涨后横盘 + 量能正常(volume_ratio>0.85) + 趋势不破 → 小仓试探
 * - C级：下跌后横盘 → 不进入加仓模型
 * - 其他（震荡横盘/无横盘）→ null
 * @param {object} snapshot indicator_snapshot
 */
function gradeConsolidation(snapshot) {
  if (!snapshot) return null;
  const tc = snapshot.trend_context || '';
  const volRatio = snapshot.volume_ratio;
  const h = snapshot.h_state || '';
  const score = snapshot.consolidation_score;
  const sidewayDays = snapshot.sideway_days || 0;
  if (sidewayDays < 8) return null; // 8 日初步整理起算（V2.1.1）
  if (tc === TREND_CONTEXTS.DOWN) return 'C'; // 下跌后横盘不进入加仓模型

  // V2.1.1：A/B 由「综合结构质量（Score）」决定，而非单一量比阈值
  // A级：高质量整理（H1 = Score≥75 且上涨后整理）+ 量比≤0.80
  // B4 尝试回退（2026-08-22 实测）：去 volRatio≤0.80 门槛 → 收益 72.09%→65.27%（负优化），
  // 放进了量比未收敛的横盘加仓。恢复原 A/B 判定，仅新增 A+ 分级（score≥85 顶尖结构）。
  if (score != null && score >= 85 && h === 'H1' && volRatio != null && volRatio <= 0.80) return 'A+';
  if (h === 'H1' && volRatio != null && volRatio <= 0.80) return 'A';
  // B级：有效整理（Score≥65 且趋势完整 H1/H2）→ 小仓试探
  if (score != null && score >= 65 && (h === 'H1' || h === 'H2')) return 'B';
  return null;
}

/** 高质量横盘（可进入加仓模型）：A+ / A / B。V3.1 A2：A+ 此前未接线，最好结构加不了仓。 */
function isQualityConsolidation(grade) {
  return grade === 'A+' || grade === 'A' || grade === 'B';
}

/** 判定加仓模式：横盘加仓（A+/A/B 级）/ 突破加仓 / 无 */
function determineAddMode(ctx) {
  const { snapshot = {}, crowding = {} } = ctx;
  const w = snapshot.w_state || 'W3';
  const v = snapshot.v_state || 'V3';
  const grade = ctx.consolidationGrade != null ? ctx.consolidationGrade : gradeConsolidation(snapshot);
  if (crowding.premium_flag === '极端溢价') return '无';
  if (grade === 'C') return '无'; // C 级横盘不进入加仓模型
  if (isQualityConsolidation(grade)) return '横盘加仓';
  // V2.1.1 C4：突破加仓 = 横盘成熟后的第二阶段（用户拍板：无成熟横盘不得突破加仓）
  // 前置：高质量横盘（sideway_days ≥ 15）+ 周线不弱（W1/W2）+ 突破整理窗口高点 + 放量
  const sidewayDays = snapshot.sideway_days || 0;
  const matureEnough = sidewayDays >= 15;
  const trendNotDown = snapshot.trend_context !== 'DOWN';
  if (matureEnough && trendNotDown && (w === 'W1' || w === 'W2') && snapshot.breakout === true && (v === 'V4' || v === 'V5')) return '突破加仓';
  return '无';
}

/**
 * 核心仓 / 交易仓拆分。
 * - 核心仓 = finalTarget × CORE_RATIOS[核心仓等级]；F5 时核心仓 0。
 * - 交易仓 = finalTarget × TRADE_RATIOS[交易仓等级]（交易仓独立 10 日确认，比核心仓更快参与）
 * - 等级优先用慢变量确认的 positions.core_ratio_grade / positions.trade_ratio_grade，否则由 F 状态即时映射。
 * @returns {{core:number, trade:number, core_ratio_grade:string, trade_ratio_grade:string}}
 */
function computeCoreTrade(ctx, finalTarget) {
  const { fundamental = {}, positions = {}, snapshot = {}, portfolio = {} } = ctx;
  const fState = fundamental.f_state || 'F3';
  const confirmedGrade = positions.core_ratio_grade;
  const confirmedTrade = positions.trade_ratio_grade;
  const baseGrade = fState === 'F5' ? 'F5' : (confirmedGrade || F_TO_CORE_GRADE[fState] || 'C');
  const tradeGrade = fState === 'F5' ? 'F5' : (confirmedTrade || F_TO_CORE_GRADE[fState] || 'C');
  let grade = baseGrade;
  let defense = false;

  // B10 三因子核心仓（2026-08-22）：基础等级由 F 决定，再受长期趋势(W)与市场环境(Regime)调节——
  // 基本面决定"愿不愿意长期拿"，趋势决定"现在适不适合重仓"，环境决定"敢不敢下重注"。
  if (fState !== 'F5') {
    const w = snapshot.w_state || 'W3';
    const regime = portfolio.market_regime || 'range';
    // W4/W5 趋势破坏 → 核心仓降 1 级（不能重仓逆势）；crisis/defensive → 再降 1 级（系统性防守）
    let factor = 0;
    if (w === 'W4' || w === 'W5') factor += 1;
    if (regime === 'crisis' || regime === 'defensive') factor += 1;
    if (factor > 0) {
      defense = true;
      const order = ['A', 'B', 'C', 'D'];
      const idx = order.indexOf(grade);
      if (idx >= 0) grade = order[Math.min(order.length - 1, idx + factor)];
    }
  }

  let core = 0;
  let trade = 0;
  if (fState === 'F5') {
    core = 0;
    trade = 0;
  } else {
    const ratio = CORE_RATIOS[grade] != null ? CORE_RATIOS[grade] : 0.5;
    core = Math.round(finalTarget * ratio * 10) / 10;
    const leftover = Math.max(0, Math.round((finalTarget - core) * 10) / 10);
    const tradeByRatio = TRADE_RATIOS[tradeGrade] != null
      ? Math.round(finalTarget * TRADE_RATIOS[tradeGrade] * 10) / 10
      : leftover;
    if (defense) {
      // V3.1 A3：防守时交易仓按原 TRADE_RATIOS 计，不得因核心降级而膨胀；差额进现金。
      trade = Math.min(tradeByRatio, leftover);
    } else {
      trade = leftover;
    }
  }
  return { core, trade, core_ratio_grade: grade, trade_ratio_grade: tradeGrade };
}

/**
 * 加仓资格检查（8 项）。
 * 每项 'ok'/'pause'/'forbid'；overall = allow/pause/forbid。
 */
function checkAddEligibility(ctx) {
  const { snapshot = {}, fundamental = {}, risk = {}, positions = {}, portfolio = {}, params = {}, etf = {} } = ctx;
  const w = snapshot.w_state || 'W3';
  const h = snapshot.h_state || 'H3';
  const v = snapshot.v_state || 'V3';
  const f = fundamental.f_state || 'F3';
  const pricePosition = snapshot.price_position;
  const consolidationScore = snapshot.consolidation_score;
  const addMode = ctx.addMode || '无';

  // ① 趋势闸门（P1 建仓加速，回测支撑：全样本仅 5 次建仓、通信 ETF 错过春季主升）：
  //    W1/W2 全放行；W3（震荡）+ 高质量横盘（A/B 级）+ 缩量 → 允许小仓试探建仓；W4/W5 仍禁止
  const consolidationGrade = ctx.consolidationGrade != null ? ctx.consolidationGrade : gradeConsolidation(snapshot);
  const qualityConsol = isQualityConsolidation(consolidationGrade);
  const isShrinking = (v === 'V1' || v === 'V2' || (snapshot.volume_ratio != null && snapshot.volume_ratio <= (params.volume_ratio != null ? params.volume_ratio : DEFAULT_PARAMS.volume_ratio)));
  const current = positions.current_position || 0;
  // V3.2：W1/W2 空仓首仓不要求横盘缩量、不因高位禁追。
  // V3.4b：W1/W2 已有仓时也放行 structure/volume（C 级除外），方便趋势回调加仓。
  //         chase 仍卡 price_position>0.8，禁止沿涨加。W3 / P3 不改。
  // V3.6：防守砍剩 ≤8% 的残仓，缩量且不追高时可重建（513310 2026-07 被 P3 砍到 5.4% 后
  //        卡在 W3+C 级，既不是空仓首仓也不是 trendAdd）。空仓 W3 仍禁止。
  //        故意不排除 C 级：残仓重建的目标场景就是 DOWN_CONSOLIDATION。
  //        与 trendAdd 不对称是设计，不是漏写。高位 / 放量仍禁止。
  const firstLotTrend = current <= 0 && (w === 'W1' || w === 'W2');
  const remnantRebuild = current > 0 && current <= BUILD_FIRST_LOT_PCT
    && (w === 'W1' || w === 'W2' || w === 'W3')
    && isShrinking
    && (pricePosition == null || pricePosition <= 0.8);
  const trendAdd = current > 0 && (w === 'W1' || w === 'W2') && consolidationGrade !== 'C';
  const trend = (w === 'W1' || w === 'W2') ? 'ok'
    : (w === 'W3' && (qualityConsol || remnantRebuild) && isShrinking) ? 'ok' : 'pause';
  // ② 横盘结构：C 级横盘（下跌后横盘）不进入加仓模型 → pause
  const structure = (consolidationGrade === 'C' && !firstLotTrend && !remnantRebuild) ? 'pause'
    : (firstLotTrend || trendAdd || remnantRebuild) ? 'ok'
    : (h === 'H1' || h === 'H2' || (consolidationScore != null && consolidationScore >= 65)) ? 'ok' : 'pause';
  const volTh = params.volume_ratio != null ? params.volume_ratio : DEFAULT_PARAMS.volume_ratio;
  const volume = (firstLotTrend || trendAdd || remnantRebuild) ? 'ok'
    : (v === 'V1' || v === 'V2' || (snapshot.volume_ratio != null && snapshot.volume_ratio <= volTh)) ? 'ok' : 'pause';
  const fund = (f === 'F4' || f === 'F5') ? 'pause' : 'ok';
  // ⑤ 非高位追涨（price_position ≤ 0.8 或 突破模式）；W1/W2 空仓首仓放行
  const chase = (firstLotTrend || pricePosition == null || pricePosition <= 0.8 || addMode === '突破加仓') ? 'ok' : 'pause';
  const targetMax = positions.target_max != null ? positions.target_max
    : (positions.max_position != null ? positions.max_position : 30);
  const limit = (current >= targetMax) ? 'pause' : 'ok';
  // ⑦ 赛道未超配
  let sectorCheck = 'ok';
  const sector = etf.sector || '';
  if (TECH_SECTORS.indexOf(sector) >= 0) {
    const techMax = params.tech_sector_max != null ? params.tech_sector_max : DEFAULT_PARAMS.tech_sector_max;
    const techPos = portfolio.tech_position != null ? portfolio.tech_position : 0;
    sectorCheck = techPos >= techMax ? 'pause' : 'ok';
  }
  // ⑧ 无风险熔断/警戒（YELLOW 暂停新增但不熔断，RED/override 熔断）
  const riskCheck = (risk.risk_override === true || risk.risk_flag === 'RED') ? 'forbid'
    : (risk.risk_flag === 'YELLOW' ? 'pause' : 'ok');
  // ⑨ 加仓冷静期（硬规则：cooldown>0 禁止新增，防止连续追高）
  // B6 自适应（2026-08-22）：cooldownDays 由 runDecisionEngine 按 addMode 计算基数
  // （普通横盘 2 日 / 突破加仓 5 日），此处仅做闸门判定：剩余日 >0 则 pause
  const cooldownDays = ctx.cooldownDays != null ? ctx.cooldownDays : 0;
  const cooldownCheck = cooldownDays > 0 ? 'pause' : 'ok';
  // ⑩ 市场环境分级约束（用户拍板）：crisis/defensive 暂停新增（crisis 更严格，defensive 允许持有观察）
  const regime = portfolio.market_regime || 'range';
  const regimeCheck = (regime === 'crisis' || regime === 'defensive') ? 'pause' : 'ok';

  const items = { trend, structure, volume, fund, chase, limit, sector: sectorCheck, risk: riskCheck, cooldown: cooldownCheck, regime: regimeCheck };
  let overall = 'allow';
  if (Object.values(items).indexOf('forbid') >= 0) overall = 'forbid';
  else if (Object.values(items).indexOf('pause') >= 0) overall = 'pause';
  return { ...items, overall };
}

/**
 * 被动超配状态（gap = finalTarget − current，负值=超配）。
 * ≥−3 normal / −5~−3 mild / −8~−5 moderate / −15~−8 severe / <−15 extreme
 */
function computeOverAllocStatus(gap) {
  if (gap == null) return 'normal';
  if (gap >= -OVER_ALLOC_THRESHOLDS.normal) return 'normal';
  if (gap >= -OVER_ALLOC_THRESHOLDS.mild) return '轻度';
  if (gap >= -OVER_ALLOC_THRESHOLDS.moderate) return '中度';
  if (gap >= -OVER_ALLOC_THRESHOLDS.severe) return '明显';
  return '极端';
}

/**
 * 防守状态（独立于机会分，供前端「防守仪表盘」）。
 * 0=无、1=高位放量滞涨（战术）、2=跌破趋势/基本面恶化（战略）、3=周线破坏/熔断（战略）、4=趋势反转+证伪（清仓）
 * @returns {{level:number, reason:string}}
 */
function computeDefenseState(ctx) {
  const { snapshot = {}, fundamental = {}, risk = {} } = ctx;
  const w = snapshot.w_state || 'W3';
  const f = fundamental.f_state || 'F3';
  const riskTrigger = risk.risk_override === true || risk.risk_flag === 'RED';

  if (f === 'F5') return { level: 4, reason: '趋势反转 + 基本面证伪' };
  if (riskTrigger) return { level: 3, reason: '风险熔断（战略防守）' };
  if (w === 'W4' || w === 'W5') return { level: 3, reason: '周线趋势破坏' };
  if (snapshot.high_volume_decline || f === 'F4') return { level: 2, reason: '跌破趋势 / 基本面恶化' };
  if (snapshot.high_volume_stagnation) return { level: 1, reason: '高位放量滞涨' };
  return { level: 0, reason: '无防守信号' };
}

/* ============================ 硬规则（P0~P7） ============================ */

/**
 * 按优先级命中硬规则，返回规则数组（用于留痕 explain 与前端 rule_hits）。
 * @param {object} ctx 见 runDecision 组装
 * @returns {Array<{level:string,name:string,condition:string,result:string}>}
 */
function applyHardRules(ctx) {
  const { snapshot = {}, fundamental = {}, risk = {}, crowding = {}, positions = {}, portfolio = {}, params = {}, etf = {}, opportunityScore } = ctx;
  const w = snapshot.w_state || 'W3';
  const h = snapshot.h_state || 'H3';
  const v = snapshot.v_state || 'V3';
  const f = fundamental.f_state || 'F3';
  const current = positions.current_position || 0;
  const hits = [];

  // P0 证伪/熔断
  if (risk.risk_override === true || risk.risk_flag === 'RED') {
    hits.push({ level: 'P0', name: 'RISK_OVERRIDE', condition: '风险熔断触发', result: f === 'F5' ? '清仓' : '减仓/禁新增' });
  }
  if (f === 'F5') {
    hits.push({ level: 'P0', name: 'FALSIFY', condition: '基本面证伪 F5', result: '清仓' });
  }
  // P1 周线
  if (w === 'W5') hits.push({ level: 'P1', name: 'W5', condition: '周线趋势反转', result: '战略减仓/清仓' });
  else if (w === 'W4') hits.push({ level: 'P1', name: 'W4', condition: '周线趋势破坏', result: '防守模式' });
  else if (w === 'W1' || w === 'W2') hits.push({ level: 'P1', name: w, condition: `周线${W_STATE_LABELS[w]}`, result: '允许进攻' });
  // P2 基本面
  if (f === 'F4') hits.push({ level: 'P2', name: 'F4', condition: '基本面恶化', result: '减仓' });
  else if (f === 'F1' || f === 'F2') hits.push({ level: 'P2', name: f, condition: `基本面${F_STATE_LABELS[f]}`, result: '可持有' });
  // P3 量价
  if (snapshot.high_volume_decline) hits.push({ level: 'P3', name: 'HIGH_VOL_DECLINE', condition: '放量下跌破位', result: '强防守信号' });
  if (snapshot.high_volume_stagnation) hits.push({ level: 'P3', name: 'HIGH_VOL_STAGNATION', condition: '放量滞涨', result: '防守观察' });
  if (h === 'H1' && (v === 'V1' || v === 'V2')) hits.push({ level: 'P3', name: 'H1V1', condition: `横盘${H_STATE_LABELS.H1}·量能${V_STATE_LABELS[v]}`, result: 'A级加仓候选' });
  // P4 组合约束
  const maxPos = positions.max_position != null ? positions.max_position : (params.single_etf_max != null ? params.single_etf_max : DEFAULT_PARAMS.single_etf_max);
  if (current > maxPos) hits.push({ level: 'P4', name: 'OVER_MAX', condition: `当前仓位 ${current}% 超最大 ${maxPos}%`, result: '超配预警' });
  const sector = etf.sector || '';
  if (TECH_SECTORS.indexOf(sector) >= 0) {
    const techMax = params.tech_sector_max != null ? params.tech_sector_max : DEFAULT_PARAMS.tech_sector_max;
    const techPos = portfolio.tech_position != null ? portfolio.tech_position : 0;
    if (techPos > techMax) hits.push({ level: 'P4', name: 'TECH_OVER', condition: `科技赛道 ${techPos}% 超上限 ${techMax}%`, result: '赛道超配' });
  }
  // P5 拥挤度
  if (crowding.premium_flag === '极端溢价') hits.push({ level: 'P5', name: 'PREMIUM_EXTREME', condition: '极端溢价', result: '禁止新增仓位' });
  else if (crowding.premium_flag === '明显溢价') hits.push({ level: 'P5', name: 'PREMIUM_OBVIOUS', condition: '明显溢价', result: '暂停追涨' });
  // P6 评分
  hits.push({ level: 'P6', name: 'SCORE', condition: `机会分 ${opportunityScore}`, result: opportunityScore >= 60 ? '偏多' : '偏谨慎' });
  // P7 战术
  hits.push({ level: 'P7', name: 'BATCH', condition: '分批建仓 2-5%→5-10%→10-15%→15-20%', result: '控制节奏' });

  return hits;
}

/**
 * V3.8 赛道硬顶：科技仓合计超过上限时，按当前仓占比分摊超额，压回上限。
 * V3.5 中度 HOLD 只在未超赛道时生效；已超则这里改 TACTICAL_REDUCE。
 * 已有更深的减仓（P3 / W4 / W5）不回抬。黄金/创新药不参与。
 */
function applySectorHardCap(ctx, action, suggested) {
  const { etf = {}, positions = {}, portfolio = {}, params = {} } = ctx;
  const sector = etf.sector || '';
  if (TECH_SECTORS.indexOf(sector) < 0) return { action, suggested, hit: false };
  const techMax = params.tech_sector_max != null ? params.tech_sector_max : DEFAULT_PARAMS.tech_sector_max;
  const techPos = portfolio.tech_position != null ? portfolio.tech_position : 0;
  const current = positions.current_position || 0;
  if (techPos <= techMax || current <= 0) return { action, suggested, hit: false };
  const share = current / techPos * (techPos - techMax);
  const capped = Math.max(0, Math.round((current - share) * 10) / 10);
  if (suggested <= capped + 1e-9) return { action, suggested, hit: false };
  const nextAction = (action === 'EXIT' || action === 'STRATEGIC_REDUCE') ? action : 'TACTICAL_REDUCE';
  return { action: nextAction, suggested: capped, hit: true };
}

/* ============================ 六态状态机 ============================ */

/**
 * 七态状态机（V2.1 P1）：硬规则优先，然后 Gap 驱动。动作输出英文 code。
 * EXIT / STRATEGIC_REDUCE / TACTICAL_REDUCE / BUILD / ADD / HOLD / WAIT
 * @param {object} ctx 需含 finalTarget / gap / eligibilityOverall / consolidationGrade
 * @returns {string} 七态英文 code
 */
function runStateMachine(ctx) {
  const { snapshot = {}, fundamental = {}, risk = {}, crowding = {}, positions = {} } = ctx;
  const w = snapshot.w_state || 'W3';
  const f = fundamental.f_state || 'F3';
  const current = positions.current_position || 0;
  const finalTarget = ctx.finalTarget != null ? ctx.finalTarget : 0;
  const gap = ctx.gap != null ? ctx.gap : 0;
  const eligibilityOverall = ctx.eligibilityOverall || 'allow';

  // P0 证伪/熔断
  if (risk.risk_override === true || risk.risk_flag === 'RED') {
    if (f === 'F5') return current > 0 ? 'EXIT' : 'WAIT';
    return current > 0 ? 'STRATEGIC_REDUCE' : 'WAIT';
  }
  if (f === 'F5') return current > 0 ? 'EXIT' : 'WAIT';

  // P1 周线破坏 → 战略减仓
  if (w === 'W5' || w === 'W4') return current > 0 ? 'STRATEGIC_REDUCE' : 'WAIT';

  // P2 基本面恶化 → 战略减仓
  if (f === 'F4') return current > 0 ? 'STRATEGIC_REDUCE' : 'WAIT';

  // P3 放量下跌破位 → 战略减仓；高位放量滞涨 → 战术减仓
  // V3.2 试过「W1/W2 上不因 hvD/hvS 砍仓」：收益 89.08%→85.07%，MaxDD 14.32%→21.81%，回退。
  if (snapshot.high_volume_decline) return current > 0 ? 'STRATEGIC_REDUCE' : 'WAIT';
  if (snapshot.high_volume_stagnation) return current > 0 ? 'TACTICAL_REDUCE' : 'WAIT';

  // P5 拥挤度极端（禁止新增，非卖出）
  if (crowding.premium_flag === '极端溢价') return current > 0 ? 'HOLD' : 'WAIT';

  // Gap 驱动
  if (finalTarget <= 0) return current > 0 ? 'EXIT' : 'WAIT';

  if (gap >= ADD_THRESHOLD_PCT) {
    if (eligibilityOverall === 'allow') {
      return current <= 0 ? 'BUILD' : 'ADD';
    }
    // 闸门 pause / forbid：暂不加仓
    return current > 0 ? 'HOLD' : 'WAIT';
  }

  // 被动超配按 5 级分级驱动：normal/轻度 → 持有观察；中度/明显/极端 → 战术减仓（减仓力度由 over_alloc_status 决定）
  const overStatus = ctx.overAllocStatus || computeOverAllocStatus(gap);
  if (overStatus === 'normal' || overStatus === '轻度') return 'HOLD';
  // V3.5：W1/W2 中度超配不砍——常见是分数回落把目标从 28 打到 21，趋势未坏。
  // 明显/极端仍减；W3 中度仍减；P3 在上面已经先判。
  if ((w === 'W1' || w === 'W2') && overStatus === '中度') return 'HOLD';
  return 'TACTICAL_REDUCE';
}

/* ============================ 目标仓位 ============================ */

/**
 * 根据动作计算建议仓位%（本次建议调整到），按七态分级。
 * - EXIT → 0
 * - STRATEGIC_REDUCE → 减到核心仓（current > core ? core : 0）
 * - TACTICAL_REDUCE → 减交易仓约 25%（Math.max(core, current - trade*0.25)）
 * - ADD → 横盘加仓 +3pct（B 级小仓减半 +1.5pct）/ 突破加仓 ≤ +add_breakout_max_pct，均不超过 finalTarget
 * - BUILD → 首仓 ≤8pct
 * - HOLD/WAIT → current
 * @param {object} ctx 需含 finalTarget / addMode / consolidationGrade / core / trade
 * @param {string} action 七态英文 code
 * @returns {number}
 */
function computeTargetPosition(ctx, action) {
  const { positions = {}, params = {} } = ctx;
  const current = positions.current_position || 0;
  const finalTarget = ctx.finalTarget != null ? ctx.finalTarget
    : (positions.target_std != null ? positions.target_std : (positions.target_position || 0));
  const addMode = ctx.addMode || '无';
  // 减仓地板用「当前实际核心仓」，交易仓 = 当前 − 核心仓（非建议值）
  // 保护：实际核心仓不超过当前持仓（防「建议核心仓 > 实际持仓 → 误清仓」）
  const core = Math.min(positions.core_position != null ? positions.core_position : 0, current);
  const trade = Math.max(0, current - core);

  switch (action) {
    case 'EXIT': return 0;
    case 'STRATEGIC_REDUCE': {
      // B-006 修复（2026-08-22）：W5 趋势反转 → 强制清仓（0）；W4 才减到核心仓。
      // 原逻辑 current≤core 时返回 current，W5 永不清仓 → 已亏损利润无法止损（GLM 深审实锤）。
      const w = (ctx.snapshot && ctx.snapshot.w_state) || 'W4';
      if (w === 'W5') return 0;
      // 战略减仓：减到实际核心仓；当前不高于核心仓则保持现状（避免「建议核心>实际持仓」误清仓）
      return current > core ? core : current;
    }
    case 'TACTICAL_REDUCE': {
      // 减交易仓力度按超配等级：中度 25% / 明显 50% / 极端 100%（回到核心仓），不低于核心仓
      const overStatus = ctx.overAllocStatus || '中度';
      const ratio = overStatus === '极端' ? 1.0 : (overStatus === '明显' ? 0.5 : 0.25);
      return Math.max(core, current - trade * ratio);
    }
    case 'BUILD':
      // 首仓分批，第一档 ≤8pct。V3.4 试过 W1/W2 提到 15：60.32%→53.54%，现金仍 65.5%，回退。
      return Math.min(finalTarget, BUILD_FIRST_LOT_PCT);
    case 'ADD': {
      let step;
      if (addMode === '突破加仓') {
        step = params.add_breakout_max_pct != null ? params.add_breakout_max_pct : ADD_BREAKOUT_MAX_PCT;
      } else {
        // V3.7：W1/W2 已过 chase 的加仓 +5；W3 仍 +3。B5 按等级缩小步长已回退，这里只加大趋势步长。
        const w = (ctx.snapshot && ctx.snapshot.w_state) || 'W3';
        step = (w === 'W1' || w === 'W2') ? ADD_TREND_STEP_PCT : ADD_STEP_PCT;
      }
      if (ctx.consolidationGrade === 'B') step = step / 2; // B 级小仓试探，步进减半
      return Math.min(current + step, finalTarget);
    }
    case 'HOLD':
    case 'WAIT':
      return current;
    default: return current;
  }
}

/* ============================ 下一加仓条件 ============================ */

/**
 * 生成「下一加仓条件」文案（结合 add_mode + 冷静期）。
 * @param {object} ctx 需含 addMode / cooldownDays / gap / finalTarget
 * @returns {string}
 */
function buildNextAddCondition(ctx) {
  const { snapshot = {}, params = {} } = ctx;
  const addMode = ctx.addMode || '无';
  const cooldown = ctx.cooldownDays != null ? ctx.cooldownDays : 0;
  const gap = ctx.gap != null ? ctx.gap : 0;
  const finalTarget = ctx.finalTarget != null ? ctx.finalTarget : 0;

  if (cooldown > 0) {
    return `加仓冷静期：还需 ${cooldown} 个交易日方可再次加仓（当前模式：${addMode === '无' ? '暂无' : addMode}）`;
  }
  if (gap < ADD_THRESHOLD_PCT) {
    return `仓位缺口不足（Gap ${Math.round(gap)}%，需 ≥ ${ADD_THRESHOLD_PCT}% 触发加仓），等待目标区间上移或回撤至横盘下沿`;
  }
  if (addMode === '横盘加仓') {
    return `横盘加仓：横盘 ${snapshot.sideway_days || 0} 日，可在横盘下沿/中部分批 +3~5pct，不超过目标 ${finalTarget}%`;
  }
  if (addMode === '突破加仓') {
    return `突破加仓：放量突破确认，单次 ≤ +${params.add_breakout_max_pct != null ? params.add_breakout_max_pct : ADD_BREAKOUT_MAX_PCT}pct，不超过目标 ${finalTarget}%`;
  }
  return '暂不满足加仓条件（趋势/横盘结构/量能/基本面待验证）';
}

/* ============================ 决策链 explain_chain ============================ */

/**
 * 构建 13 步因果决策链（每步 condition → result，前端「因为…所以…」渲染）。
 * @param {object} ctx 需含 grade / gap / finalTarget / consolidationGrade / core / trade / eligibilityOverall
 * @param {string} action 七态英文 code
 * @returns {Array<{step:number,condition:string,result:string}>}
 */
function buildExplainChain(ctx, action) {
  const { snapshot = {}, fundamental = {}, risk = {}, crowding = {}, positions = {}, portfolio = {}, params = {}, opportunityScore } = ctx;
  const w = snapshot.w_state || 'W3';
  const f = fundamental.f_state || 'F3';
  const current = positions.current_position || 0;
  const sidewayDays = snapshot.sideway_days || 0;
  const volRatio = snapshot.volume_ratio;
  const grade = ctx.grade || '—';
  const gap = ctx.gap != null ? ctx.gap : 0;
  const eligibilityOverall = ctx.eligibilityOverall || 'allow';
  const suggestedPosition = computeTargetPosition(ctx, action);
  const adjustPct = Math.round((suggestedPosition - current) * 10) / 10;

  const maxStrategic = positions.max_strategic_position != null ? positions.max_strategic_position
    : (positions.max_position != null ? positions.max_position
      : (params.single_etf_max != null ? params.single_etf_max : DEFAULT_PARAMS.single_etf_max));
  const range = computeTargetRange(maxStrategic, grade);

  const steps = [];

  // 1 市场环境
  const regime = portfolio.market_regime || 'range';
  const regimeLabel = MARKET_REGIME_LABELS[regime] || regime;
  const cashRange = CASH_REGIME[regime] || [20, 35];
  steps.push({ step: 1, condition: `市场环境 ${regimeLabel}`, result: `现金目标 ${cashRange[0]}%~${cashRange[1]}%` });

  // 2 周线趋势
  const wResult = (w === 'W1' || w === 'W2') ? '允许进攻' : (w === 'W3' ? '停止主动加仓' : '防守模式');
  steps.push({ step: 2, condition: `${w} 周线 ${W_STATE_LABELS[w] || ''}`, result: wResult });

  // 3 横盘/量价
  const volTxt = volRatio != null ? `缩量比 ${(volRatio * 100).toFixed(0)}%` : '缩量比缺失';
  const volOK = volRatio != null && volRatio <= 0.85;
  steps.push({ step: 3, condition: `横盘 ${sidewayDays} 日 · ${volTxt}`, result: volOK ? '缩量成立' : (volRatio == null ? '量能缺失' : '量能未收缩') });

  // 4 基本面
  const fResult = (f === 'F1' || f === 'F2') ? '可持有' : (f === 'F3' ? '中性' : (f === 'F4' ? '减仓' : '证伪'));
  steps.push({ step: 4, condition: `${f} 基本面 ${F_STATE_LABELS[f] || ''}`, result: fResult });

  // 5 风险
  const riskResult = (risk.risk_override === true || risk.risk_flag === 'RED') ? '熔断触发'
    : (risk.risk_flag === 'YELLOW' ? '警戒（禁新增）' : '无风险熔断');
  steps.push({ step: 5, condition: `风险等级 ${risk.risk_flag || 'NORMAL'}`, result: riskResult });

  // 6 拥挤度
  const premium = crowding.premium_flag || '正常';
  steps.push({ step: 6, condition: `拥挤度 ${premium} · ${crowding.c_state || 'C1'}`, result: premium === '极端溢价' || premium === '明显溢价' ? '限制新增仓位' : '不限制' });

  // 7 机会状态
  steps.push({ step: 7, condition: `机会等级 ${grade} · 机会分 ${opportunityScore}`, result: opportunityScore >= 60 ? '偏多' : '偏谨慎' });

  // 8 目标仓位（三档）
  steps.push({ step: 8, condition: `目标区间 [${range.target_min}~${range.target_max}]%`, result: `标准目标 ${range.target_std}%` });

  // 9 当前仓位（实际核心/交易仓拆分）
  const currentCore = positions.core_position != null ? positions.core_position : 0;
  const currentTrade = Math.max(0, current - currentCore);
  steps.push({ step: 9, condition: `当前仓位 ${current}%`, result: `核心 ${currentCore}% · 交易 ${currentTrade}%` });

  // 10 仓位差
  const gapTxt = (gap > 0 ? '+' : '') + Math.round(gap * 10) / 10;
  steps.push({ step: 10, condition: `仓位缺口 ${gapTxt}pct`, result: gap >= ADD_THRESHOLD_PCT ? '低于目标，倾向加仓' : (gap <= -OVER_ALLOC_REDUCE_PCT ? '明显超配，倾向减仓' : '处于目标区间') });

  // 11 组合约束
  const sector = (ctx.etf && ctx.etf.sector) || '';
  let comboTxt = '未触发';
  if (TECH_SECTORS.indexOf(sector) >= 0) {
    const techMax = params.tech_sector_max != null ? params.tech_sector_max : DEFAULT_PARAMS.tech_sector_max;
    const techPos = portfolio.tech_position != null ? portfolio.tech_position : 0;
    if (techPos > techMax) comboTxt = `科技赛道 ${techPos}% 超上限 ${techMax}%`;
  }
  steps.push({ step: 11, condition: '组合约束检查', result: comboTxt });

  // 12 加仓/减仓闸门
  const gateResult = eligibilityOverall === 'allow' ? 'PASS（8 项全通过）' : (eligibilityOverall === 'forbid' ? 'BLOCKED（风险熔断）' : 'BLOCKED（资格未满足）');
  steps.push({ step: 12, condition: '交易闸门', result: gateResult });

  // 13 最终动作
  const adjustTxt = adjustPct > 0 ? `+${adjustPct}pct` : (adjustPct < 0 ? `${adjustPct}pct` : '0');
  steps.push({ step: 13, condition: '最终动作', result: `${ACTION_LABELS[action] || action}（建议调整 ${adjustTxt}）` });

  return steps;
}

/* ============================ 主入口 runDecision ============================ */

/**
 * 决策引擎主入口（纯函数，无副作用，可独立回放）。
 * @param {object} etf etf_basic 文档 { code, name, sector, is_qdii, max_position, target_position }
 * @param {object} snapshot indicator_snapshot 文档
 * @param {object} positions portfolio_position 文档（含三档目标 + 核心/交易仓 + core_ratio_grade）
 * @param {object} params 运行时阈值（param_config 合并默认值后）
 * @param {object} extra { fundamental, risk, portfolio, crowding, weights, cooldownDays }
 *   - fundamental: { f_state, f_score, detail }
 *   - risk: { risk_flag, risk_override }
 *   - portfolio: { tech_position, gold_position, cash_ratio, market_regime, ... }
 *   - crowding: { c_state, premium_flag }（缺省时自动计算）
 *   - weights: 机会分权重（缺省用 params 或默认）
 *   - cooldownDays: 距下次可加仓剩余交易日（慢变量，由 runDecisionEngine 计算传入）
 * @returns {object} decision_result 文档（含 V2.0.1 仓位引擎扩展字段 + 旧字段兼容）
 */
function runDecision(etf = {}, snapshot = {}, positions = {}, params = {}, extra = {}) {
  const fundamental = extra.fundamental || { f_state: 'F3', f_score: 15, detail: {} };
  const risk = extra.risk || { risk_flag: 'NORMAL', risk_override: false };
  const portfolio = extra.portfolio || { tech_position: 0, gold_position: 0, cash_ratio: 100 };
  const crowding = extra.crowding || computeCrowding({ etf, snapshot, params });
  const cooldownDays = extra.cooldownDays != null ? extra.cooldownDays : 0;

  const w = snapshot.w_state || 'W3';
  const d = snapshot.d_state || 'D3';
  const h = snapshot.h_state || 'H3';
  const v = snapshot.v_state || 'V3';
  const f = fundamental.f_state || 'F3';
  const c = crowding.c_state || 'C1';

  // 五维原始分（仅用于诊断，不参与决策；total=100 制，前端永不展示）
  const scores = {
    trend: scoreTrend(w),
    volume: scoreVolume(h, v, snapshot),
    fundamental: scoreFundamental(f),
    crowding: scoreCrowding(c),
    risk: scoreRisk(risk.risk_flag, risk.risk_override === true)
  };
  scores.total = scores.trend + scores.volume + scores.fundamental + scores.crowding + scores.risk;

  const weights = extra.weights || params.opportunity_weights || DEFAULT_OPPORTUNITY_WEIGHTS;
  // 机会分（0~100，仅用于机会等级 → 目标仓位，与五维总分语义分离）
  const opportunityScore = calcOpportunityScore(scores, weights, risk.risk_override === true);

  let ctx = {
    etf, snapshot, fundamental, risk, positions, portfolio, crowding, params, scores, opportunityScore, cooldownDays,
    // 组合层按机会分排序分配的赛道剩余额度（null = 单 ETF 视角兜底）
    sectorRemainingLimit: extra.sectorRemainingLimit != null ? extra.sectorRemainingLimit : null
  };

  // ① 横盘加仓分级（P1-4，供 determineAddMode / checkAddEligibility / computeTargetPosition 使用）
  const consolidationGrade = gradeConsolidation(snapshot);
  ctx = { ...ctx, consolidationGrade };

  // ② 目标仓位生成器
  const target = generateTargetPosition(ctx);
  // ③ 加仓模式
  const addMode = determineAddMode(ctx);
  // ④ 核心/交易仓拆分（核心仓等级优先用慢变量确认值）
  const coreTrade = computeCoreTrade(ctx, target.finalTarget);
  // ⑤ 注入中间结果
  ctx = { ...ctx, grade: target.grade, factor: target.factor, finalTarget: target.finalTarget, gap: target.gap, addMode, ...coreTrade };
  // ⑥ 加仓资格 8 项
  const eligibility = checkAddEligibility(ctx);
  // ⑦ 被动超配状态
  const overAllocStatus = computeOverAllocStatus(target.gap);
  ctx = { ...ctx, eligibilityOverall: eligibility.overall, overAllocStatus };

  const ruleHits = applyHardRules(ctx);
  let finalAction = runStateMachine(ctx);
  let suggestedPosition = computeTargetPosition(ctx, finalAction);
  const sectorCap = applySectorHardCap(ctx, finalAction, suggestedPosition);
  if (sectorCap.hit) {
    finalAction = sectorCap.action;
    suggestedPosition = sectorCap.suggested;
    ruleHits.push({ level: 'P4', name: 'SECTOR_HARD_CAP', condition: '科技赛道超上限', result: `按占比压回建议仓 ${suggestedPosition}%` });
  }
  // B-005 修正（2026-08-22）：移除"降级 HOLD"逻辑——原降级会掩盖 W5 防守信号（GLM 深审实锤）。
  // W5 强制清仓（B-006）已让 suggested=0 不空转；W4 贴核心仓时保持 STRATEGIC_REDUCE 标签
  // （前端展示"已无可减空间"），既保留防守意图又不产生虚假成交。
  const explainChain = buildExplainChain(ctx, finalAction);
  const nextAddCondition = buildNextAddCondition(ctx);

  // 三档目标来自动态区间（target.range），不再读 positions 静态值
  const targetMin = target.range.target_min;
  const targetStd = target.range.target_std;
  const targetMax = target.range.target_max;
  const maxPosition = positions.max_strategic_position != null ? positions.max_strategic_position
    : (positions.max_position != null ? positions.max_position
      : (params.single_etf_max != null ? params.single_etf_max : DEFAULT_PARAMS.single_etf_max));

  // rule_hits：状态码（W/H/V/F/C）+ 规则代号（OVER_MAX 等），H1V1 归并为 H1，去重保序
  const _seen = new Set();
  const ruleHitsArr = [];
  [w, h, v, f, c]
    .concat(ruleHits.map((r) => (r.name === 'H1V1' ? 'H1' : r.name)))
    .forEach((code) => {
      if (code && !_seen.has(code)) { _seen.add(code); ruleHitsArr.push(code); }
    });

  return {
    code: etf.code || snapshot.code || '',
    decision_date: snapshot.calc_date || '',
    w_state: w,
    d_state: d,
    h_state: h,
    v_state: v,
    f_state: f,
    c_state: c,
    risk_flag: risk.risk_flag || 'NORMAL',
    risk_override: risk.risk_override === true,
    premium_flag: crowding.premium_flag || '正常',
    scores,
    opportunity_score: opportunityScore,
    // V2.0.1 仓位引擎扩展
    opportunity_grade: target.grade,
    opportunity_factor: target.factor,
    target_min: targetMin,
    target_std: targetStd,
    target_max: targetMax,
    max_position: maxPosition,
    final_target: target.finalTarget,
    position_gap: target.gap,
    core_position: coreTrade.core,
    trade_position: coreTrade.trade,
    suggested_position: suggestedPosition,
    add_mode: addMode,
    add_eligibility: eligibility,
    cooldown_days: cooldownDays,
    over_alloc_status: overAllocStatus,
    // V2.1 P2：防守状态（独立于机会分）
    defense_state: computeDefenseState(ctx),
    // 旧字段兼容：final_action 存英文 code（= action），target_position 语义 = final_target
    action: finalAction,
    action_label: ACTION_LABELS[finalAction] || finalAction,
    consolidation_grade: consolidationGrade,
    final_action: finalAction,
    target_position: target.finalTarget,
    next_add_condition: nextAddCondition,
    explain_chain: explainChain,
    rule_hits: ruleHitsArr,
    version: snapshot.version != null ? snapshot.version : 0
  };
}

/**
 * 构造「强制等待」决策结果（数据不完整 data_complete=false 时使用）。
 * 纯函数：不读 DB/网络，输出 WAIT 动作 + 原因说明，避免用残缺数据误导。
 * @param {object} etf ETF 元信息
 * @param {object} snapshot 指标快照（含 calc_date 等）
 * @param {string} reason 等待原因（默认数据不完整）
 * @returns {object} decision_result 兼容文档
 */
function buildWaitResult(etf, snapshot, reason) {
  const date = (snapshot && snapshot.calc_date) || new Date().toISOString().slice(0, 10);
  const code = etf.code || (snapshot && snapshot.code) || '';
  return {
    code,
    decision_date: date,
    w_state: snapshot.w_state || 'W3',
    d_state: snapshot.d_state || 'D3',
    h_state: snapshot.h_state || 'H3',
    v_state: snapshot.v_state || 'V3',
    f_state: 'F3',
    c_state: snapshot.c_state || 'C1',
    risk_flag: 'NORMAL',
    risk_override: false,
    premium_flag: '正常',
    scores: { trend: 0, volume: 0, fundamental: 0, crowding: 0, risk: 0, total: 0 },
    opportunity_score: 0,
    opportunity_grade: 'E',
    opportunity_factor: 0,
    target_min: 0,
    target_std: 0,
    target_max: snapshot.target_max != null ? snapshot.target_max : 0,
    max_position: snapshot.max_position != null ? snapshot.max_position : 0,
    final_target: 0,
    position_gap: 0,
    core_position: 0,
    trade_position: 0,
    suggested_position: 0,
    add_mode: '无',
    add_eligibility: { overall: 'pause', reason: reason || '数据不完整' },
    cooldown_days: 0,
    over_alloc_status: 'normal',
    defense_state: { level: 0, reason: reason || '数据不完整' },
    action: 'WAIT',
    action_label: '等待',
    consolidation_grade: null,
    final_action: 'WAIT',
    target_position: 0,
    next_add_condition: '',
    explain_chain: [{ step: 0, condition: '数据完整性', result: reason || '数据不完整（data_complete=false）' }],
    rule_hits: ['DATA_INCOMPLETE'],
    wait_reason: reason || '数据不完整（data_complete=false），待数据补齐后重算',
    version: snapshot.version != null ? snapshot.version : 0
  };
}

module.exports = {
  scoreTrend,
  scoreVolume,
  scoreFundamental,
  scoreCrowding,
  scoreRisk,
  calcOpportunityScore,
  computeCrowding,
  gradeOpportunity,
  computeTargetRange,
  generateTargetPosition,
  gradeConsolidation,
  isQualityConsolidation,
  determineAddMode,
  computeCoreTrade,
  checkAddEligibility,
  computeOverAllocStatus,
  computeDefenseState,
  applyHardRules,
  applySectorHardCap,
  runStateMachine,
  computeTargetPosition,
  buildNextAddCondition,
  buildExplainChain,
  buildWaitResult,
  runDecision
};
