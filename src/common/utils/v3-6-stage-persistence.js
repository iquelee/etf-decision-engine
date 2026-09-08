/**
 * V3.6 Experiment C — S4 Persistence
 * V3.6.1 — S5 Downside Protection（与 S4 分轨）
 *
 * 原则：
 *   S4：宽容（抗噪音）
 *   S5：保护（正常回撤持有，结构损坏快速退出；正常降级只到 S4）
 *
 * 不改 Target / StageFactor / TechCap / Opportunity / O3。
 */
'use strict';

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

function resolveClose(snapshot) {
  if (!snapshot) return null;
  if (snapshot.close != null) return snapshot.close;
  const ma20 = snapshot.ma20;
  if (ma20 != null && snapshot.bias_20d != null) {
    return ma20 * (1 + snapshot.bias_20d / 100);
  }
  return ma20;
}

function estimateAtr(snapshot, bars) {
  if (snapshot && snapshot.atr20 != null) return snapshot.atr20;
  if (!bars || bars.length < 5) return null;
  let sum = 0;
  let n = 0;
  for (let i = Math.max(1, bars.length - 20); i < bars.length; i++) {
    const h = bars[i].high;
    const l = bars[i].low;
    const pc = bars[i - 1].close;
    if (h == null || l == null || pc == null) continue;
    sum += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    n += 1;
  }
  return n ? sum / n : null;
}

function inferBreakoutLevel(snapshot, bars, state) {
  if (state && state.breakout_level != null) return state.breakout_level;
  if (bars && bars.length >= 22) {
    let mx = -Infinity;
    for (let i = bars.length - 21; i < bars.length - 1; i++) {
      if (bars[i].high != null && bars[i].high > mx) mx = bars[i].high;
    }
    if (mx > -Infinity) return mx;
  }
  const close = resolveClose(snapshot);
  if (close != null) return close * 0.98;
  return snapshot && snapshot.ma20 != null ? snapshot.ma20 : null;
}

function isBreakoutFailure(snapshot, bars, state) {
  const close = resolveClose(snapshot);
  const level = inferBreakoutLevel(snapshot, bars, state);
  if (close == null || level == null) return false;
  const vol = snapshot.volume_ratio != null ? snapshot.volume_ratio : 1;
  const atr = estimateAtr(snapshot, bars);
  // 放量跌破突破位 → Hard
  if (close < level && vol > 1.20) return true;
  // 无放量时要求更深破位（≥1ATR），避免普通回撤被当成 BreakoutFailure 直送 S3
  if (atr != null && close < level - atr) return true;
  return false;
}

/** S5 专用 Hard Breakout：仅放量跌破；浅 ATR 破位留给 Integrity→S4 */
function isS5BreakoutFailure(snapshot, bars, state) {
  const close = resolveClose(snapshot);
  const level = inferBreakoutLevel(snapshot, bars, state);
  if (close == null || level == null) return false;
  const vol = snapshot.volume_ratio != null ? snapshot.volume_ratio : 1;
  if (close < level && vol > 1.20) return true;
  return false;
}

function isHardStructureBreak(snapshot, bars, state, opts) {
  const s5Mode = opts && opts.s5_mode === true;
  const bf = s5Mode
    ? isS5BreakoutFailure(snapshot, bars, state)
    : isBreakoutFailure(snapshot, bars, state);
  if (bf) {
    return { hard: true, reason: 'breakout_failure', severity: 's3' };
  }
  const close = resolveClose(snapshot);
  const ma60 = snapshot.ma60;
  const w = snapshot.w_state || 'W3';
  if (close != null && ma60 != null && close < ma60 * (s5Mode ? 0.97 : 0.98)) {
    return { hard: true, reason: 'ma60_break', severity: 's7' };
  }
  if (w === 'W5') return { hard: true, reason: 'weekly_w5', severity: 's7' };
  if (snapshot.high_volume_decline === true && (w === 'W4' || w === 'W5')) {
    return { hard: true, reason: 'hvd_weekly', severity: 's7' };
  }
  const swing = bars ? swingHighLow(bars) : { lowerHigh: false };
  if (close != null && ma60 != null && close < ma60 && swing.lowerHigh) {
    return { hard: true, reason: 'ma60_lh', severity: 's7' };
  }
  return { hard: false, reason: null, severity: null };
}

function computeDowngradeScore(snapshot, bars, state) {
  const close = resolveClose(snapshot);
  const ma20 = snapshot.ma20;
  const ma60 = snapshot.ma60;
  const slope = snapshot.ma20_slope != null ? snapshot.ma20_slope : 0;
  const level = inferBreakoutLevel(snapshot, bars, state);
  const swing = bars ? swingHighLow(bars) : { higherLow: true, lowerHigh: false };
  let score = 0;
  const hits = [];

  if (close != null && ma20 != null && close < ma20) {
    score += 20;
    hits.push('below_ma20');
  }
  if (slope < 0) {
    score += 25;
    hits.push('ma20_slope_neg');
  }
  if (close != null && level != null && close < level) {
    score += 25;
    hits.push('below_breakout');
  }
  if (swing.higherLow === false && bars && bars.length >= 12) {
    const lows = bars.slice(-5).map((b) => b.low).filter((x) => x != null);
    const prevLows = bars.slice(-10, -5).map((b) => b.low).filter((x) => x != null);
    if (lows.length && prevLows.length && Math.min(...lows) < Math.min(...prevLows)) {
      score += 25;
      hits.push('lower_low');
    }
  }
  if (close != null && ma60 != null && close < ma60) {
    score += 40;
    hits.push('below_ma60');
  }

  return { score, hits };
}

function evaluateTrendIntegrity(snapshot, bars, state) {
  const close = resolveClose(snapshot);
  const ma20 = snapshot.ma20;
  const ma60 = snapshot.ma60;
  const slope = snapshot.ma20_slope != null ? snapshot.ma20_slope : 0;
  const level = inferBreakoutLevel(snapshot, bars, state);
  const swing = bars ? swingHighLow(bars) : { higherLow: true };

  const ma20Up = slope >= 0;
  const ma60Ok = !(close != null && ma60 != null && close < ma60 * 0.98);
  const hlOk = swing.higherLow !== false;
  const baseOk = !(close != null && level != null && close < level);

  const intact = (ma20Up || (close != null && ma20 != null && close >= ma20 * 0.985))
    && ma60Ok
    && (hlOk || ma20Up)
    && baseOk;

  return {
    intact,
    ma20_up: ma20Up,
    ma60_ok: ma60Ok,
    higher_low: hlOk,
    base_ok: baseOk
  };
}

/**
 * S5IntegrityScore（0～100）
 * MA20向上25 + MA60未破25 + HL25 + 突破结构未失守25
 */
function resolveS5Integrity(snapshot, bars, state) {
  const close = resolveClose(snapshot);
  const ma20 = snapshot.ma20;
  const ma60 = snapshot.ma60;
  const slope = snapshot.ma20_slope != null ? snapshot.ma20_slope : 0;
  const level = inferBreakoutLevel(snapshot, bars, state);
  const swing = bars ? swingHighLow(bars) : { higherLow: true };

  let score = 0;
  const parts = {};

  const ma20Up = slope >= 0 || (close != null && ma20 != null && close >= ma20);
  if (ma20Up) { score += 25; parts.ma20 = 25; } else { parts.ma20 = 0; }

  const ma60Ok = !(close != null && ma60 != null && close < ma60 * 0.98);
  if (ma60Ok) { score += 25; parts.ma60 = 25; } else { parts.ma60 = 0; }

  const hlOk = swing.higherLow !== false;
  if (hlOk) { score += 25; parts.hl = 25; } else { parts.hl = 0; }

  const baseOk = !(close != null && level != null && close < level);
  if (baseOk) { score += 25; parts.base = 25; } else { parts.base = 0; }

  let band = 'normal';
  if (score < 50) band = 'risk';
  else if (score < 75) band = 'pullback';

  return { score, band, parts, ma20_up: ma20Up, ma60_ok: ma60Ok, higher_low: hlOk, base_ok: baseOk };
}

/** Post-S5 → S4 Recovery Integrity：MA60 + 突破底 + HL */
function resolvePostS5S4Integrity(snapshot, bars, state) {
  const close = resolveClose(snapshot);
  const ma60 = snapshot.ma60;
  const level = inferBreakoutLevel(snapshot, bars, state);
  const swing = bars ? swingHighLow(bars) : { higherLow: true };
  const ma60Ok = !(close != null && ma60 != null && close < ma60);
  const baseOk = !(close != null && level != null && close < level);
  const hlOk = swing.higherLow !== false;
  return {
    intact: ma60Ok && baseOk && hlOk,
    ma60_ok: ma60Ok,
    base_ok: baseOk,
    higher_low: hlOk
  };
}

/** Grace 提前结束：收盘跌破 MA60，或跌破突破位−1ATR */
function shouldAbortPostS5Grace(snapshot, bars, state) {
  const close = resolveClose(snapshot);
  const ma60 = snapshot.ma60;
  if (close != null && ma60 != null && close < ma60) {
    return { abort: true, reason: 'grace_abort_ma60' };
  }
  const level = inferBreakoutLevel(snapshot, bars, state);
  const atr = estimateAtr(snapshot, bars);
  if (close != null && level != null && atr != null && close < level - atr) {
    return { abort: true, reason: 'grace_abort_breakout_atr' };
  }
  return { abort: false, reason: null };
}

/** Day3 条件保护：至少 hitNeed 项成立 */
function scorePostS5Day3Continue(snapshot, bars, state) {
  const close = resolveClose(snapshot);
  const ma60 = snapshot.ma60;
  const level = inferBreakoutLevel(snapshot, bars, state);
  const swing = bars ? swingHighLow(bars) : { higherLow: true };
  const slope = snapshot.ma20_slope != null ? snapshot.ma20_slope : 0;
  const hits = [];
  if (!(close != null && ma60 != null && close < ma60)) hits.push('ma60');
  if (!(close != null && level != null && close < level)) hits.push('base');
  if (swing.higherLow !== false) hits.push('hl');
  if (close != null && level != null && close > level) hits.push('above_retain');
  if (slope >= 0) hits.push('ma20_slope');
  return { hits, count: hits.length, parts: hits };
}

/**
 * Post-S5 Recovery Window 决策
 * V3.6.2：固定 N 日硬保护
 * V3.6.3：hardProtect 日硬保护 + 第 (hardProtect+1) 日条件保护
 * @returns {null|object} null=未启用；{mode:'hold'|'fallthrough', ...}
 */
function resolvePostS5Recovery(snapshot, bars, state, params, daysInStage) {
  const adaptive = params && params.v3_6_3_adaptive_post_s5_grace === true;
  const fixed = params && params.v3_6_2_post_s5_s4_grace === true;
  if (!adaptive && !fixed) return null;
  if (!state || state.s4_origin !== 'from_s5') return null;

  const hardDays = adaptive
    ? (params.v3_6_3_hard_protect_days != null ? params.v3_6_3_hard_protect_days : 2)
    : (params.v3_6_2_post_s5_s4_grace_days != null ? params.v3_6_2_post_s5_s4_grace_days : 3);
  const maxExclusive = adaptive ? hardDays + 1 : hardDays;
  const day = daysInStage != null ? daysInStage : 0;
  if (day >= maxExclusive) return { mode: 'fallthrough', reason: 'post_s5_window_end' };

  const abort = shouldAbortPostS5Grace(snapshot, bars, state);
  if (abort.abort) {
    return { mode: 'fallthrough', reason: abort.reason, abort: true };
  }

  const rec = resolvePostS5S4Integrity(snapshot, bars, state);

  // 硬保护日（含固定 Grace 全日）
  if (!adaptive || day < hardDays) {
    return {
      mode: 'hold',
      overlay: rec.intact ? null : 'pullback',
      reason: adaptive ? 'post_s5_hard_protect' : (rec.intact ? 'post_s5_s4_grace' : 'post_s5_s4_grace_soft'),
      recovery_integrity: rec,
      adaptive,
      day
    };
  }

  // V3.6.3 第3日（day === hardDays）：条件保护
  const day3Need = params.v3_6_3_day3_min_hits != null ? params.v3_6_3_day3_min_hits : 2;
  const scored = scorePostS5Day3Continue(snapshot, bars, state);
  if (scored.count >= day3Need) {
    return {
      mode: 'hold',
      overlay: scored.count >= 4 ? null : 'pullback',
      reason: 'post_s5_day3_conditional',
      recovery_integrity: rec,
      day3: scored,
      adaptive: true,
      day
    };
  }
  return {
    mode: 'fallthrough',
    reason: 'post_s5_day3_fail',
    day3: scored,
    adaptive: true,
    day
  };
}

function isPostS5S4GraceActive(state, params, daysInStage) {
  if (!postS5GraceEnabled(params) || !state || state.s4_origin !== 'from_s5') return false;
  const adaptive = params.v3_6_3_adaptive_post_s5_grace === true;
  const hardDays = adaptive
    ? (params.v3_6_3_hard_protect_days != null ? params.v3_6_3_hard_protect_days : 2)
    : (params.v3_6_2_post_s5_s4_grace_days != null ? params.v3_6_2_post_s5_s4_grace_days : 3);
  const maxExclusive = adaptive ? hardDays + 1 : hardDays;
  return (daysInStage != null ? daysInStage : 0) < maxExclusive;
}

function postS5GraceEnabled(params) {
  return !!(params && (params.v3_6_3_adaptive_post_s5_grace === true
    || params.v3_6_2_post_s5_s4_grace === true));
}

/** S4 Downgrade Engine（V3.6 + V3.6.2/6.3 Post-S5 Recovery） */
function resolveS4Downgrade(ctx) {
  const {
    snapshot = {}, bars = null, state = {}, params = {}, daysInStage = 0
  } = ctx;

  const graceDays = params.v3_6_s4_grace_days != null ? params.v3_6_s4_grace_days : 2;
  const softNeed = params.v3_6_soft_confirm_days != null ? params.v3_6_soft_confirm_days : 2;
  const softThreshold = params.v3_6_downgrade_soft_score != null ? params.v3_6_downgrade_soft_score : 50;
  const hardScore = params.v3_6_downgrade_hard_score != null ? params.v3_6_downgrade_hard_score : 70;

  // from_s5 Recovery 窗口内：Hard 与 S5 对齐（仅放量破位）
  const hardOpts = (state.s4_origin === 'from_s5' && postS5GraceEnabled(params))
    ? { s5_mode: true }
    : undefined;
  const hard = isHardStructureBreak(snapshot, bars, state, hardOpts);
  if (hard.hard) {
    return {
      action: 'downgrade',
      target_stage: 'S3',
      force_overlay: hard.severity === 's7' ? 'broken' : null,
      overlay: null,
      reason: hard.reason,
      score: 100,
      engine: 's4',
      s4_origin: state.s4_origin || null
    };
  }

  const recovery = resolvePostS5Recovery(snapshot, bars, state, params, daysInStage);
  if (recovery && recovery.mode === 'hold') {
    return {
      action: 'hold',
      overlay: recovery.overlay,
      reason: recovery.reason,
      score: 0,
      target_stage: 'S4',
      grace: true,
      post_s5_grace: true,
      s4_origin: 'from_s5',
      recovery_integrity: recovery.recovery_integrity,
      day3: recovery.day3 || null,
      engine: 's4_retain'
    };
  }
  // fallthrough / abort → 普通 S4 规则

  const ds = computeDowngradeScore(snapshot, bars, state);
  const integrity = evaluateTrendIntegrity(snapshot, bars, state);

  if (daysInStage < graceDays && ds.score < hardScore) {
    return {
      action: 'hold', overlay: 'pullback', reason: 's4_grace', score: ds.score,
      target_stage: 'S4', grace: true, integrity, hits: ds.hits, engine: 's4'
    };
  }

  if (integrity.intact && ds.score < softThreshold) {
    return {
      action: 'hold', overlay: ds.score > 0 ? 'pullback' : null, reason: 'integrity_hold',
      score: ds.score, target_stage: 'S4', integrity, hits: ds.hits, engine: 's4'
    };
  }

  if (ds.score >= hardScore) {
    return {
      action: 'downgrade', target_stage: 'S3', overlay: null, reason: 'downgrade_score_hard',
      score: ds.score, integrity, hits: ds.hits, engine: 's4'
    };
  }

  const close = resolveClose(snapshot);
  const softSignal = close != null && snapshot.ma20 != null && close < snapshot.ma20
    && (snapshot.ma20_slope != null ? snapshot.ma20_slope < 0 : false);

  if (softSignal || ds.score >= softThreshold) {
    const softDays = (state.soft_down_days || 0) + 1;
    if (softDays >= softNeed) {
      return {
        action: 'downgrade', target_stage: 'S3', reason: 'soft_confirm', score: ds.score,
        soft_down_days: softDays, integrity, hits: ds.hits, engine: 's4'
      };
    }
    return {
      action: 'soft_pending', overlay: 'pullback', reason: 'soft_pending', score: ds.score,
      soft_down_days: softDays, target_stage: 'S4', integrity, hits: ds.hits, engine: 's4'
    };
  }

  if (ds.score > 0) {
    return {
      action: 'hold', overlay: 'pullback', reason: 'mild_pullback', score: ds.score,
      soft_down_days: 0, target_stage: 'S4', integrity, hits: ds.hits, engine: 's4'
    };
  }

  return {
    action: 'hold', overlay: null, reason: 'clear', score: 0, soft_down_days: 0,
    target_stage: 'S4', integrity, engine: 's4'
  };
}

/**
 * S5 Downside Protection（V3.6.1）
 * 正常降级只到 S4；Hard/BreakoutFailure → S3（或 broken overlay）
 */
function resolveS5Downside(ctx) {
  const {
    snapshot = {}, bars = null, state = {}, params = {}, daysInStage = 0,
    candidateStage = null
  } = ctx;

  const graceDays = params.v3_6_1_s5_grace_days != null ? params.v3_6_1_s5_grace_days : 1;
  let riskNeed = params.v3_6_1_s5_risk_confirm_days != null ? params.v3_6_1_s5_risk_confirm_days : 2;

  const hard = isHardStructureBreak(snapshot, bars, state, { s5_mode: true });
  if (hard.hard) {
    return {
      action: 'downgrade',
      target_stage: 'S3',
      force_overlay: hard.severity === 's7' ? 'broken' : null,
      overlay: null,
      reason: hard.reason,
      score: 100,
      s5_integrity: resolveS5Integrity(snapshot, bars, state),
      block_aggressive_add: true,
      engine: 's5'
    };
  }

  const integ = resolveS5Integrity(snapshot, bars, state);
  // HL 破坏：至少进入 Pullback；若同时还有其他 Integrity 失分 → Risk
  let band = integ.band;
  if (integ.higher_low === false) {
    if (integ.score < 75) band = 'risk';
    else if (band === 'normal') band = 'pullback';
  }
  // raw 跌到 ≤S3 且结构已非 normal：升为 risk，走 S5→S4（避免 Hard 直砸 S3）
  const candRank = { S0: 0, S1: 1, S2: 2, S3: 3, S4: 4, S5: 5 }[candidateStage];
  if (candRank != null && candRank <= 3 && band !== 'normal') {
    band = 'risk';
  }
  const integEff = band === integ.band ? integ : { ...integ, band };

  if (daysInStage < graceDays && integEff.band !== 'risk') {
    return {
      action: 'hold',
      overlay: integEff.band === 'pullback' ? 'pullback' : null,
      reason: 's5_grace',
      score: integEff.score,
      target_stage: 'S5',
      s5_integrity: integEff,
      block_aggressive_add: integEff.band === 'pullback',
      engine: 's5'
    };
  }

  if (integEff.band === 'normal') {
    return {
      action: 'hold', overlay: null, reason: 's5_normal', score: integEff.score,
      target_stage: 'S5', s5_integrity: integEff, block_aggressive_add: false, engine: 's5'
    };
  }

  if (integEff.band === 'pullback') {
    return {
      action: 'hold', overlay: 'pullback', reason: 's5_pullback', score: integEff.score,
      target_stage: 'S5', s5_integrity: integEff, block_aggressive_add: true, engine: 's5'
    };
  }

  const riskDays = (state.s5_risk_days || 0) + 1;
  if (riskDays >= riskNeed) {
    return {
      action: 'downgrade',
      target_stage: 'S4',
      overlay: null,
      reason: 's5_risk_to_s4',
      score: integEff.score,
      s5_risk_days: riskDays,
      soft_down_days: riskDays,
      s5_integrity: integEff,
      block_aggressive_add: true,
      engine: 's5'
    };
  }

  return {
    action: 'soft_pending',
    overlay: 'pullback',
    reason: 's5_risk_pending',
    score: integEff.score,
    soft_down_days: riskDays,
    s5_risk_days: riskDays,
    target_stage: 'S5',
    s5_integrity: integEff,
    block_aggressive_add: true,
    engine: 's5'
  };
}

/**
 * 统一入口：S4 / S5 分轨
 * v3_6_1_s5_downside=true → S5 Downside；否则 S5 走旧 Persistence
 */
function evaluateS45Persistence(ctx) {
  const {
    prevStage,
    candidateStage,
    snapshot = {},
    bars = null,
    state = {},
    params = {},
    daysInStage = 0
  } = ctx || {};

  if (prevStage !== 'S4' && prevStage !== 'S5') {
    return { action: 'pass', overlay: null, reason: null, score: 0 };
  }
  const rank = { S0: 0, S1: 1, S2: 2, S3: 3, S4: 4, S5: 5 };
  const sub = { snapshot, bars, state, params, daysInStage, candidateStage };
  const candRank = rank[candidateStage] || 0;
  const prevRank = rank[prevStage] || 0;

  // V3.6.1：即使 raw 仍为 S5，也用 Integrity 驱动风险降级
  if (prevStage === 'S5' && params.v3_6_1_s5_downside === true) {
    if (candRank >= prevRank) {
      const d = resolveS5Downside(sub);
      if (d.action === 'downgrade' || d.action === 'soft_pending'
        || (d.action === 'hold' && d.overlay === 'pullback')) {
        return d;
      }
      return { action: 'pass', overlay: null, reason: null, score: 0 };
    }
    return resolveS5Downside(sub);
  }

  if (candRank >= prevRank) {
    return { action: 'pass', overlay: null, reason: null, score: 0 };
  }

  if (prevStage === 'S4') return resolveS4Downgrade(sub);

  const legacy = resolveS4Downgrade(sub);
  return {
    ...legacy,
    engine: 's5_legacy',
    target_stage: legacy.action === 'downgrade' && legacy.reason === 'soft_confirm'
      ? 'S4'
      : (legacy.target_stage || 'S3')
  };
}

function updatePersistenceState(prevState, nextStage, snapshot, bars, persistenceResult, params) {
  const prev = prevState || {};
  const same = prev.stage === nextStage;
  const close = resolveClose(snapshot);
  let breakoutLevel = prev.breakout_level;
  let daysInStage = same ? ((prev.days_in_stage || 0) + 1) : 0;
  let s4Origin = prev.s4_origin || null;
  const graceOn = postS5GraceEnabled(params);

  if (!same && nextStage === 'S4') {
    const fromS5 = prev.stage === 'S5'
      || (persistenceResult && (persistenceResult.reason === 's5_risk_to_s4'
        || persistenceResult.engine === 's5'));
    if (fromS5) {
      s4Origin = 'from_s5';
      if (graceOn) {
        // V3.6.2：落地价作为 RetainBase
        breakoutLevel = close != null ? close : inferBreakoutLevel(snapshot, bars, prev);
      } else {
        breakoutLevel = inferBreakoutLevel(snapshot, bars, {});
        if (close != null && (breakoutLevel == null || close > breakoutLevel)) {
          breakoutLevel = close;
        }
      }
    } else {
      s4Origin = 'standard';
      breakoutLevel = inferBreakoutLevel(snapshot, bars, {});
      if (close != null && (breakoutLevel == null || close > breakoutLevel)) {
        breakoutLevel = close;
      }
    }
    daysInStage = 0;
  } else if (!same && nextStage === 'S5') {
    s4Origin = null;
    breakoutLevel = inferBreakoutLevel(snapshot, bars, {});
    if (close != null && (breakoutLevel == null || close > breakoutLevel)) {
      breakoutLevel = close;
    }
    daysInStage = 0;
  } else if (!same) {
    s4Origin = null;
  }

  let softDown = 0;
  let s5Risk = 0;
  if (persistenceResult && persistenceResult.action === 'soft_pending') {
    softDown = persistenceResult.soft_down_days || persistenceResult.s5_risk_days || 1;
    s5Risk = persistenceResult.s5_risk_days || softDown;
  } else if (persistenceResult && persistenceResult.action === 'hold') {
    softDown = 0;
    s5Risk = 0;
  } else if (!same) {
    softDown = 0;
    s5Risk = 0;
  }

  return {
    breakout_level: breakoutLevel,
    days_in_stage: daysInStage,
    soft_down_days: softDown,
    s5_risk_days: s5Risk,
    s4_origin: s4Origin,
    persistence_overlay: persistenceResult && persistenceResult.overlay
      ? persistenceResult.overlay : null,
    persistence_reason: persistenceResult && persistenceResult.reason
      ? persistenceResult.reason : null,
    downgrade_score: persistenceResult && persistenceResult.score != null
      ? persistenceResult.score : null,
    s5_integrity_score: persistenceResult && persistenceResult.s5_integrity
      ? persistenceResult.s5_integrity.score : null,
    block_aggressive_add: persistenceResult && persistenceResult.block_aggressive_add === true,
    post_s5_grace: persistenceResult && persistenceResult.post_s5_grace === true
  };
}

module.exports = {
  resolveClose,
  isBreakoutFailure,
  isS5BreakoutFailure,
  isHardStructureBreak,
  computeDowngradeScore,
  evaluateTrendIntegrity,
  resolveS5Integrity,
  resolvePostS5S4Integrity,
  shouldAbortPostS5Grace,
  scorePostS5Day3Continue,
  resolvePostS5Recovery,
  isPostS5S4GraceActive,
  postS5GraceEnabled,
  resolveS4Downgrade,
  resolveS5Downside,
  evaluateS45Persistence,
  updatePersistenceState,
  inferBreakoutLevel
};
