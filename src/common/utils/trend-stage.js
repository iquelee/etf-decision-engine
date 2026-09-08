/**
 * V3.0 v1.1 Trend Stage Engine — 主状态 S0~S5 + RiskOverlay
 *
 * 职责分离（v1.1 §A2 / §A6 / §A8）：
 * - TrendStage (S0~S5) → StageFactor（v3-constants.getStageFactor）
 * - trend_quality_score (0~25) → Opportunity Trend 维输入（不直接乘 TP）
 * - RiskOverlay (normal|overheated|broken|shock) → Defense / 展示 S6|S7
 *
 * 原则：趋势阶段不应被基本面数据延迟阻塞；基本面负责限制重仓上限，而非阻止趋势状态升级。
 *
 * 对外展示：displayStage 可为 S6/S7；state.stage 持久化主状态 S0~S5。
 */
'use strict';

const {
  V3_STAGE_FACTORS,
  V3_PRIMARY_STAGES,
  V3_MARKET_FACTORS,
  STAGE_UP_CONFIRM_DAYS,
  STAGE_DOWN_CONFIRM_DAYS,
  STAGE_HARD_BREAK_DAYS,
  TREND_STAGE_ALGO_VERSION,
  getStageFactor: getStageFactorV3,
  getMarketFactor: getMarketFactorV3,
  normalizePrimaryStage
} = require('./v3-constants.js');
const { isStructuralBreak } = require('./shock-recovery.js');
const {
  evaluateS45Persistence,
  updatePersistenceState
} = require('./v3-6-stage-persistence.js');
const STAGE_FACTORS = V3_STAGE_FACTORS;

const STAGE_LABELS = Object.freeze({
  S0: '下降',
  S1: '筑底',
  S2: '启动',
  S3: '横盘确认',
  S4: '突破',
  S5: '主升',
  S6: '过热',
  S7: '破坏'
});

const OVERLAY_LABELS = Object.freeze({
  normal: '正常',
  overheated: '过热',
  broken: '趋势破坏',
  shock: '急跌',
  pullback: '回踩保护'
});

const MARKET_FACTORS = V3_MARKET_FACTORS;

const STAGE_ACCELERATION = Object.freeze({
  S0: 0, S1: 0.20, S2: 0.30, S3: 0.50, S4: 0.70, S5: 1.00
});

const STAGE_ORDER = V3_PRIMARY_STAGES;

function stageIndex(s) {
  const primary = normalizePrimaryStage(s);
  const i = STAGE_ORDER.indexOf(primary);
  return i >= 0 ? i : 0;
}

function marketFactor(regime) {
  return getMarketFactorV3(regime);
}

function getStageFactor(stage) {
  return getStageFactorV3(stage);
}

function getStageAcceleration(stage) {
  const primary = normalizePrimaryStage(stage);
  return STAGE_ACCELERATION[primary] != null ? STAGE_ACCELERATION[primary] : 0;
}

function stageSensitivity(profile) {
  if (!profile) return 1.0;
  if (profile.stage_sensitivity != null) return profile.stage_sensitivity;
  return 1.0;
}

function adjustedThreshold(base, profile) {
  const sens = stageSensitivity(profile);
  return sens > 0 ? base / sens : base;
}

/** 摆动高低点：近 5 根 vs 前 5 根 */
function swingHighLow(bars) {
  if (!bars || bars.length < 12) return { higherLow: false, lowerHigh: false };
  const lows = bars.slice(-10, -5).map((b) => b.low);
  const lows2 = bars.slice(-5).map((b) => b.low);
  const highs = bars.slice(-10, -5).map((b) => b.high);
  const highs2 = bars.slice(-5).map((b) => b.high);
  const min1 = Math.min(...lows);
  const min2 = Math.min(...lows2);
  const max1 = Math.max(...highs);
  const max2 = Math.max(...highs2);
  return { higherLow: min2 > min1, lowerHigh: max2 < max1 };
}

function resolveLastClose(snapshot) {
  const ma20 = snapshot.ma20;
  if (ma20 != null && snapshot.price_position != null) {
    return ma20 * (1 + (snapshot.bias_20d || 0) / 100);
  }
  return ma20;
}

function rsUpProxy(snapshot) {
  if (snapshot.rs_up === true) return true;
  if (snapshot.relative_strength_up === true) return true;
  return snapshot.change_5d != null && snapshot.change_5d > 6;
}

/**
 * 主状态 S0~S5（不含 overlay / 不含 F_score 门槛）
 */
function detectPrimaryStageRaw(snapshot, fundamental, opts) {
  if (!snapshot) return { stage: 'S0', reason: 'no_snapshot' };

  const w = snapshot.w_state || 'W3';
  const ma20 = snapshot.ma20;
  const ma60 = snapshot.ma60;
  const lastClose = resolveLastClose(snapshot);
  const slope = snapshot.ma20_slope;
  const vol = snapshot.volume_ratio;
  const pp = snapshot.price_position;

  // S0 下降（W5 清零；W4 反弹例外）
  if (w === 'W5') return { stage: 'S0', reason: 'W5' };
  if (w === 'W4') {
    if (slope != null && slope > 0 && pp != null && pp > 0.85) {
      return { stage: 'S1', reason: 'W4_rebound' };
    }
    return { stage: 'S0', reason: 'W4' };
  }

  const grade = opts && opts.consolidationGrade;
  const bars = opts && opts.bars;
  const swing = bars ? swingHighLow(bars) : { higherLow: false, lowerHigh: false };
  const profile = opts && opts.profile;
  const macro = profile && profile.profile_type === 'macro_driven';
  const breakoutVolMin = adjustedThreshold(1.2, profile);

  // S5 主升（v1.1 §A8：不含 f_score 门槛）
  if (macro && (w === 'W1' || w === 'W2' || w === 'W3')) {
    const aboveMa = lastClose != null && ma20 != null && lastClose >= ma20 * 0.992;
    if (aboveMa && slope != null && slope > 0) {
      return { stage: 'S5', reason: 'macro_main_rally' };
    }
  }
  if (w === 'W1' || w === 'W2') {
    const strong = snapshot.breakout_nd === true
      || (pp != null && pp > 0.72)
      || (snapshot.change_5d != null && snapshot.change_5d > 6);
    if (strong && slope != null && slope > 0 && rsUpProxy(snapshot)) {
      return { stage: 'S5', reason: 'main_rally' };
    }
  }

  // S4 突破
  if (snapshot.breakout_nd === true && vol != null && vol > breakoutVolMin
    && (w === 'W1' || w === 'W2' || w === 'W3')) {
    return { stage: 'S4', reason: 'breakout_nd' };
  }

  // S3 横盘确认
  if (macro && (grade === 'A+' || grade === 'A' || grade === 'B')) {
    return { stage: 'S3', reason: 'macro_consolidation' };
  }
  if (grade === 'A+' || grade === 'A' || grade === 'B') {
    if (vol != null && vol < 0.85) return { stage: 'S3', reason: 'consolidation' };
  }
  if (macro && w === 'W3' && lastClose != null && ma20 != null && lastClose >= ma20 && slope != null && slope > 0) {
    return { stage: 'S3', reason: 'macro_slow_uptrend' };
  }
  if (w === 'W3' && lastClose != null && ma20 != null && lastClose >= ma20 && slope != null && slope > 0.5) {
    return { stage: 'S3', reason: 'slow_uptrend' };
  }

  // S2 启动
  if (ma20 != null && lastClose != null && lastClose > ma20 && slope != null && slope > 0) {
    if (ma60 == null || ma20 >= ma60 * 0.98 || swing.higherLow) {
      return { stage: 'S2', reason: 'trend_start' };
    }
  }
  const curPos = opts && opts.currentPosition != null ? opts.currentPosition : 0;
  if ((w === 'W1' || w === 'W2') && curPos <= 0) {
    return { stage: 'S2', reason: 'W1/W2_first' };
  }

  // W3 斜率启动：MA20 未站上但斜率转正 + MA60 结构未破 → S2（515880 类 Shadow 观察）
  if (w === 'W3' && slope != null && slope > 0.35 && ma60 != null && lastClose != null
    && lastClose >= ma60 * 0.94 && !swing.lowerHigh) {
    return { stage: 'S2', reason: 'W3_slope_launch' };
  }

  // S1 筑底（斜率需走平：|slope|≤0.5，正斜率启动已在上方处理）
  if (w === 'W3' && slope != null && slope >= -0.5 && slope <= 0.5
    && ma60 != null && lastClose != null && lastClose <= ma60 * 1.02) {
    return { stage: 'S1', reason: 'base_build' };
  }

  // S0 下降（MA 空头；W1/W2 仍强时不降级；F1/F2 基本面强时最低 S1）
  if (w !== 'W1' && w !== 'W2'
    && ma20 != null && ma60 != null && ma20 < ma60 && slope != null && slope < 0) {
    const f = (fundamental && fundamental.f_state) || 'F3';
    if (f === 'F1' || f === 'F2') {
      return { stage: 'S1', reason: 'MA_down_f_floor' };
    }
    return { stage: 'S0', reason: 'MA_down' };
  }

  return { stage: 'S2', reason: 'default_hold' };
}

/**
 * RiskOverlay — 不决定 StageFactor，只影响 Defense / 展示标签
 */
function detectRiskOverlay(snapshot, fundamental, opts) {
  if (!snapshot) return { overlay: 'normal', reason: 'no_snapshot' };

  const f = (fundamental && fundamental.f_state) || 'F3';
  const w = snapshot.w_state || 'W3';
  const ma20 = snapshot.ma20;
  const ma60 = snapshot.ma60;
  const lastClose = resolveLastClose(snapshot);
  const slope = snapshot.ma20_slope;
  const vol = snapshot.volume_ratio;
  const pp = snapshot.price_position;
  const bars = opts && opts.bars;
  const swing = bars ? swingHighLow(bars) : { lowerHigh: false };
  const profile = opts && opts.profile;
  const macro = profile && profile.profile_type === 'macro_driven';
  const distance20 = snapshot.bias_20d != null ? snapshot.bias_20d : null;
  const todayIdx = opts && opts.todayIdx != null ? opts.todayIdx : null;

  if (f === 'F5' || w === 'W5') {
    return { overlay: 'broken', reason: f === 'F5' ? 'F5' : 'W5' };
  }
  if (snapshot.high_volume_decline && (w === 'W4' || w === 'W5')) {
    return { overlay: 'broken', reason: 'hvD+W4/W5' };
  }
  if (isStructuralBreak(snapshot, fundamental, bars, todayIdx)) {
    return { overlay: 'broken', reason: 'structural_break' };
  }
  if (!macro && ma60 != null && lastClose != null && lastClose < ma60 && slope != null && slope < 0 && swing.lowerHigh) {
    return { overlay: 'broken', reason: 'below_MA60+LH' };
  }
  if (macro && ma60 != null && lastClose != null && lastClose < ma60 * 0.985 && slope != null && slope < -0.35 && swing.lowerHigh) {
    return { overlay: 'broken', reason: 'macro_below_MA60+LH' };
  }

  if (opts && opts.shockActive === true) {
    return { overlay: 'shock', reason: 'shock_mode' };
  }

  const overheatDist = macro ? 22 : 15;
  const overheatVol = macro ? 1.8 : 1.5;
  if (distance20 != null && distance20 > overheatDist && vol != null && vol > overheatVol) {
    return { overlay: 'overheated', reason: 'overheat' };
  }
  if (!macro && snapshot.high_volume_stagnation && pp != null && pp > 0.7) {
    return { overlay: 'overheated', reason: 'hvS' };
  }

  return { overlay: 'normal', reason: 'normal' };
}

function toDisplayStage(primary, overlay) {
  if (overlay === 'overheated') return 'S6';
  if (overlay === 'broken') return 'S7';
  // pullback 不改变展示主阶段（仍为 S4/S5）
  return primary;
}

/**
 * 阶段内连续质量 0~25（v1.1 §A2 Option B）
 */
function calcTrendQualityScore(primary, snapshot, swing) {
  const stageBase = { S0: 5, S1: 10, S2: 14, S3: 18, S4: 21, S5: 23 };
  const p = normalizePrimaryStage(primary);
  let score = stageBase[p] != null ? stageBase[p] : 8;
  const slope = snapshot && snapshot.ma20_slope;

  if (swing && swing.higherLow) score += 1;
  if (swing && swing.lowerHigh) score -= 2;
  if (slope != null && slope > 0) score += 1;
  if (slope != null && slope > 1.5) score += 1;
  if (snapshot && snapshot.breakout_nd === true) score += 1;
  if (snapshot && rsUpProxy(snapshot)) score += 1;
  if (snapshot && snapshot.price_position != null && snapshot.price_position > 0.75) score += 1;

  return Math.max(0, Math.min(25, Math.round(score)));
}

/**
 * 原始检测（无迟滞）：主状态 + overlay + 展示标签
 */
function detectTrendStageRaw(snapshot, fundamental, opts) {
  const primary = detectPrimaryStageRaw(snapshot, fundamental, opts);
  const risk = detectRiskOverlay(snapshot, fundamental, opts);
  const bars = opts && opts.bars;
  const swing = bars ? swingHighLow(bars) : { higherLow: false, lowerHigh: false };
  const displayStage = toDisplayStage(primary.stage, risk.overlay);
  const trendQualityScore = calcTrendQualityScore(primary.stage, snapshot, swing);

  return {
    stage: primary.stage,
    primaryStage: primary.stage,
    overlay: risk.overlay,
    displayStage,
    reason: `${primary.reason}|${risk.reason}`,
    trendQualityScore,
    rawPrimary: primary.stage,
    rawOverlay: risk.overlay
  };
}

function isHardBreak(snapshot, fundamental, raw) {
  if (!snapshot) return false;
  if (fundamental && fundamental.f_state === 'F5') return true;
  if (snapshot.w_state === 'W5') return true;
  if (snapshot.high_volume_decline && snapshot.w_state === 'W4') return true;
  if (raw && raw.overlay === 'broken') return true;
  return false;
}

/** 是否立即生效（硬破位 1 日） */
function immediateHardBreak(snapshot, fundamental, raw) {
  return isHardBreak(snapshot, fundamental, raw);
}

/**
 * 迟滞：升级 2 日、降级 3 日、硬破位 1 日（v1.1 §A7）
 * 仅作用于主状态 S0~S5；overlay 同日生效（硬破位立即 broken）
 */
function applyHysteresis(state, raw, snapshot, fundamental, opts) {
  const candidate = normalizePrimaryStage(raw.stage);
  const overlay = raw.overlay || 'normal';
  const hasPriorStage = state && state.stage != null && state.stage !== '';
  // 冷启动：无历史；Shadow 首跑迁移：仅 S0 且未 initialized 时跳到 raw（跳过无意义迟滞）
  const coldStart = !hasPriorStage;
  const shadowMigrate = hasPriorStage && state.initialized !== true
    && normalizePrimaryStage(state.stage) === 'S0'
    && stageIndex(candidate) > stageIndex('S0');
  const algoStale = hasPriorStage
    && (state.stage_algo_version == null || state.stage_algo_version < TREND_STAGE_ALGO_VERSION)
    && stageIndex(candidate) > stageIndex(normalizePrimaryStage(state.stage));
  if (coldStart || shadowMigrate || algoStale) {
    return {
      stage: candidate,
      overlay,
      displayStage: toDisplayStage(candidate, overlay),
      pending: null,
      pendingStage: null,
      pendingDays: 0,
      changed: true,
      bootstrapped: true,
      stage_algo_version: TREND_STAGE_ALGO_VERSION
    };
  }

  const prev = normalizePrimaryStage(state.stage);
  const hardBreak = immediateHardBreak(snapshot, fundamental, raw);

  const prevOverlay = state.overlay || 'normal';
  let nextOverlay = overlay;
  if (hardBreak) {
    nextOverlay = 'broken';
  } else if (overlay === 'overheated') {
    nextOverlay = 'overheated';
  } else if (overlay === 'shock') {
    nextOverlay = 'shock';
  } else if (prevOverlay === 'overheated' && overlay === 'normal') {
    nextOverlay = 'normal';
  } else if (prevOverlay === 'shock' && overlay === 'normal') {
    nextOverlay = 'normal';
  } else {
    nextOverlay = overlay;
  }

  if (hardBreak) {
    let hbStage = candidate;
    const oneStepHb = !opts || opts.v3_stage_down_one_step !== false;
    if (oneStepHb && stageIndex(candidate) < stageIndex(prev) - 1) {
      hbStage = STAGE_ORDER[stageIndex(prev) - 1];
    }
    const displayStage = toDisplayStage(hbStage, nextOverlay);
    return {
      stage: hbStage,
      overlay: nextOverlay,
      displayStage,
      pending: null,
      pendingStage: null,
      pendingDays: 0,
      changed: hbStage !== prev || nextOverlay !== prevOverlay
    };
  }

  // S5 粘性：主状态 S5 + W1/W2/W3 + HH/HL 未破坏 → 普通回撤不降级
  // V3.6.1 开启时改由 S5 Downside Engine 接管，不再走此短路
  const s51 = opts && ((opts.params && opts.params.v3_6_1_s5_downside === true)
    || opts.v3_6_1_s5_downside === true);
  if (!s51 && prev === 'S5' && stageIndex(candidate) < stageIndex('S5') && nextOverlay !== 'broken') {
    const macro = opts && opts.profile && opts.profile.profile_type === 'macro_driven';
    const wOk = snapshot.w_state === 'W1' || snapshot.w_state === 'W2'
      || (macro && snapshot.w_state === 'W3');
    const bars = opts && opts.bars;
    const swing = bars ? swingHighLow(bars) : { lowerHigh: false };
    if (wOk && !swing.lowerHigh) {
      const displayStage = toDisplayStage('S5', nextOverlay);
      return {
        stage: 'S5',
        overlay: nextOverlay,
        displayStage,
        pending: null,
        pendingStage: null,
        pendingDays: 0,
        changed: nextOverlay !== prevOverlay
      };
    }
  }

  // V3.6 Experiment C：S4/S5 Persistence（Trend Integrity + Grace + BreakoutFailure）
  const persistOn = opts && (opts.v3_6_persistence === true
    || (opts.params && opts.params.v3_6_persistence === true));
  const s51On = opts && (opts.v3_6_1_s5_downside === true
    || (opts.params && opts.params.v3_6_1_s5_downside === true));
  const persistCandidateDown = persistOn && (prev === 'S4' || prev === 'S5')
    && stageIndex(candidate) < stageIndex(prev) && nextOverlay !== 'broken';
  // V3.6.1：S5 同级也跑 Integrity（风险→S4）
  const persistS5Proactive = persistOn && s51On && prev === 'S5'
    && stageIndex(candidate) >= stageIndex('S5') && nextOverlay !== 'broken';

  if (persistCandidateDown || persistS5Proactive) {
    const params = (opts && opts.params) || opts || {};
    const bars = opts && opts.bars;
    const daysInStage = state.days_in_stage != null ? state.days_in_stage : 0;
    const decision = evaluateS45Persistence({
      prevStage: prev,
      candidateStage: candidate,
      snapshot,
      bars,
      state,
      params,
      daysInStage
    });

    if (decision.action === 'pass') {
      // fall through
    } else if (decision.action === 'hold' || decision.action === 'soft_pending') {
      const ov = decision.overlay === 'pullback' ? 'pullback'
        : (nextOverlay === 'overheated' || nextOverlay === 'shock' ? nextOverlay : 'normal');
      const persistFields = updatePersistenceState(state, prev, snapshot, bars, decision, params);
      return {
        stage: prev,
        overlay: ov,
        displayStage: toDisplayStage(prev, ov === 'pullback' ? 'normal' : ov),
        pending: decision.action === 'soft_pending' ? (decision.target_stage || candidate) : null,
        pendingStage: decision.action === 'soft_pending' ? (decision.target_stage || candidate) : null,
        pendingDays: decision.action === 'soft_pending' ? (decision.soft_down_days || 1) : 0,
        changed: ov !== prevOverlay,
        persistence: decision,
        ...persistFields
      };
    } else if (decision.action === 'downgrade') {
    // action === downgrade：尊重 target_stage（S5 正常→S4；Hard→S3）
    const immediateReasons = {
      breakout_failure: 1,
      ma60_break: 1,
      weekly_w5: 1,
      hvd_weekly: 1,
      ma60_lh: 1,
      downgrade_score_hard: 1,
      soft_confirm: 1,
      s5_risk_to_s4: 1
    };
    if (immediateReasons[decision.reason]) {
      let effectiveCandidate = decision.target_stage || candidate;
      const isHard = decision.force_overlay === 'broken'
        || decision.reason === 'breakout_failure'
        || decision.reason === 'ma60_break'
        || decision.reason === 'weekly_w5'
        || decision.reason === 'hvd_weekly'
        || decision.reason === 'ma60_lh'
        || decision.reason === 'downgrade_score_hard';
      // 非 Hard：禁止 S5 直接跳到 S3 以下；有 target_stage 则用之
      if (!isHard && decision.target_stage) {
        effectiveCandidate = decision.target_stage;
      } else if (isHard && decision.target_stage) {
        effectiveCandidate = decision.target_stage;
      } else {
        const oneStep = !opts || opts.v3_stage_down_one_step !== false;
        if (oneStep && stageIndex(effectiveCandidate) < stageIndex(prev) - 1) {
          effectiveCandidate = STAGE_ORDER[stageIndex(prev) - 1];
        }
      }
      const ov = decision.force_overlay === 'broken' ? 'broken' : nextOverlay;
      const persistFields = updatePersistenceState(state, effectiveCandidate, snapshot, bars, decision, params);
      return {
        stage: effectiveCandidate,
        overlay: ov,
        displayStage: toDisplayStage(effectiveCandidate, ov),
        pending: null,
        pendingStage: null,
        pendingDays: 0,
        changed: true,
        persistence: decision,
        ...persistFields
      };
    }
    }
  }

  if (candidate === prev && nextOverlay === prevOverlay) {
    return {
      stage: prev,
      overlay: prevOverlay,
      displayStage: toDisplayStage(prev, prevOverlay),
      pending: null,
      pendingStage: null,
      pendingDays: 0,
      changed: false
    };
  }

  if (candidate === prev) {
    const displayStage = toDisplayStage(prev, nextOverlay);
    return {
      stage: prev,
      overlay: nextOverlay,
      displayStage,
      pending: null,
      pendingStage: null,
      pendingDays: 0,
      changed: nextOverlay !== prevOverlay
    };
  }

  const up = stageIndex(candidate) > stageIndex(prev);
  let effectiveCandidate = candidate;
  if (!up && stageIndex(candidate) < stageIndex(prev)) {
    const oneStep = !opts || opts.v3_stage_down_one_step !== false;
    if (oneStep && stageIndex(candidate) < stageIndex(prev) - 1) {
      effectiveCandidate = STAGE_ORDER[stageIndex(prev) - 1];
    }
  }

  const need = hardBreak
    ? STAGE_HARD_BREAK_DAYS
    : (up ? STAGE_UP_CONFIRM_DAYS : STAGE_DOWN_CONFIRM_DAYS);

  let pending = state && state.pendingStage;
  let pendingDays = (state && state.pendingDays) || 0;

  if (pending === effectiveCandidate) {
    pendingDays += 1;
  } else {
    pending = effectiveCandidate;
    pendingDays = 1;
  }

  if (pendingDays >= need) {
    const displayStage = toDisplayStage(effectiveCandidate, nextOverlay);
    return {
      stage: effectiveCandidate,
      overlay: nextOverlay,
      displayStage,
      pending: null,
      pendingStage: null,
      pendingDays: 0,
      changed: effectiveCandidate !== prev || nextOverlay !== prevOverlay
    };
  }

  return {
    stage: prev,
    overlay: nextOverlay,
    displayStage: toDisplayStage(prev, nextOverlay),
    pending: effectiveCandidate,
    pendingStage: pending,
    pendingDays,
    changed: nextOverlay !== prevOverlay
  };
}

function resolveTrendStage(snapshot, fundamental, state, opts) {
  const raw = detectTrendStageRaw(snapshot, fundamental, opts);
  const h = applyHysteresis(state || {}, raw, snapshot, fundamental, opts);
  const bars = opts && opts.bars;
  const swing = bars ? swingHighLow(bars) : { higherLow: false, lowerHigh: false };
  const trendQualityScore = calcTrendQualityScore(h.stage, snapshot, swing);
  const displayStage = h.displayStage || toDisplayStage(h.stage, h.overlay || 'normal');

  const persistOn = opts && (opts.v3_6_persistence === true
    || (opts.params && opts.params.v3_6_persistence === true));
  let persistFields = {};
  if (persistOn) {
    const decision = h.persistence || { action: 'pass', overlay: null, soft_down_days: 0 };
    const params = (opts && opts.params) || opts || {};
    // 同阶段持有时也推进 days_in_stage
    if (h.days_in_stage == null) {
      persistFields = updatePersistenceState(state || {}, h.stage, snapshot, bars, decision, params);
    } else {
      persistFields = {
        breakout_level: h.breakout_level != null ? h.breakout_level : (state && state.breakout_level),
        days_in_stage: h.days_in_stage,
        soft_down_days: h.soft_down_days != null ? h.soft_down_days : 0,
        s5_risk_days: h.s5_risk_days != null ? h.s5_risk_days : 0,
        s4_origin: h.s4_origin != null ? h.s4_origin : (state && state.s4_origin) || null,
        persistence_overlay: h.persistence_overlay || null,
        persistence_reason: h.persistence_reason || null,
        downgrade_score: h.downgrade_score != null ? h.downgrade_score : null,
        s5_integrity_score: h.s5_integrity_score != null ? h.s5_integrity_score : null,
        block_aggressive_add: h.block_aggressive_add === true,
        post_s5_grace: h.post_s5_grace === true
      };
    }
  }

  return {
    ...h,
    ...persistFields,
    primaryStage: h.stage,
    displayStage,
    trendQualityScore,
    rawStage: raw.displayStage,
    rawPrimaryStage: raw.primaryStage,
    rawOverlay: raw.overlay,
    rawReason: raw.reason,
    label: STAGE_LABELS[displayStage] || displayStage,
    overlayLabel: OVERLAY_LABELS[h.overlay || 'normal'] || h.overlay,
    stageFactor: getStageFactor(h.stage),
    stage_algo_version: TREND_STAGE_ALGO_VERSION
  };
}

module.exports = {
  STAGE_FACTORS,
  STAGE_LABELS,
  OVERLAY_LABELS,
  MARKET_FACTORS,
  STAGE_ACCELERATION,
  STAGE_ORDER,
  marketFactor,
  getStageFactor,
  getStageAcceleration,
  stageSensitivity,
  swingHighLow,
  rsUpProxy,
  detectPrimaryStageRaw,
  detectRiskOverlay,
  detectTrendStageRaw,
  calcTrendQualityScore,
  applyHysteresis,
  resolveTrendStage,
  toDisplayStage,
  normalizePrimaryStage
};
