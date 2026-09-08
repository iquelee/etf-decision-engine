/**
 * Stage Residency Diagnostics — V3.5 冻结仓位公式后的强制诊断输出
 *
 * 四件套：
 *   1. Stage Time Share
 *   2. Stage Transition Lag（相对 TrendOnset）
 *   3. Stage Churn（升降来回）
 *   4. Stage Survival（进入后平均停留天数）
 *
 * + Binding Constraint Histogram（Target→Constraint→Actual）
 */
'use strict';

const STAGE_ORDER = ['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'];

function stageRank(s) {
  const i = STAGE_ORDER.indexOf(s);
  return i >= 0 ? i : 2;
}

function normalizeStage(s) {
  if (!s) return 'S2';
  if (s === 'S6') return 'S6';
  if (s === 'S7') return 'S7';
  if (STAGE_ORDER.indexOf(s) >= 0) return s;
  return 'S2';
}

/**
 * @param {Array<{date:string, code:string, stage:string, mr?:number, equal_ret?:number}>} rows
 * 按 code 分组的日频 stage 序列
 */
function computeTimeShare(rows) {
  const counts = {};
  STAGE_ORDER.forEach((s) => { counts[s] = 0; });
  let total = 0;
  for (const row of rows) {
    const s = normalizeStage(row.stage);
    counts[s] = (counts[s] || 0) + 1;
    total += 1;
  }
  const share = {};
  STAGE_ORDER.forEach((s) => {
    share[s] = total ? Math.round((counts[s] / total) * 1000) / 10 : 0;
  });
  return { counts, share_pct: share, total_days: total };
}

/** 进入某 Stage 后的连续停留长度（天） */
function computeSurvival(rowsByCode) {
  const runs = {};
  STAGE_ORDER.forEach((s) => { runs[s] = []; });

  for (const code of Object.keys(rowsByCode)) {
    const seq = rowsByCode[code];
    let i = 0;
    while (i < seq.length) {
      const st = normalizeStage(seq[i].stage);
      let j = i + 1;
      while (j < seq.length && normalizeStage(seq[j].stage) === st) j += 1;
      runs[st].push(j - i);
      i = j;
    }
  }

  const survival = {};
  STAGE_ORDER.forEach((s) => {
    const arr = runs[s];
    if (!arr.length) {
      survival[s] = { avg_days: null, median_days: null, n_runs: 0 };
      return;
    }
    const sum = arr.reduce((a, b) => a + b, 0);
    const sorted = arr.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const med = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    survival[s] = {
      avg_days: Math.round((sum / arr.length) * 10) / 10,
      median_days: Math.round(med * 10) / 10,
      n_runs: arr.length
    };
  });
  return survival;
}

/**
 * Churn：升→降→升 或 同级附近来回
 * 统计 S3↔S2、S4↔S3 等振荡次数
 */
function computeChurn(rowsByCode) {
  let upDownUp = 0;
  let totalTransitions = 0;
  const pairCounts = {};

  for (const code of Object.keys(rowsByCode)) {
    const seq = rowsByCode[code];
    const stages = [];
    for (const row of seq) {
      const s = normalizeStage(row.stage);
      if (!stages.length || stages[stages.length - 1] !== s) stages.push(s);
    }
    for (let i = 1; i < stages.length; i++) {
      totalTransitions += 1;
      const a = stages[i - 1];
      const b = stages[i];
      const key = `${a}→${b}`;
      pairCounts[key] = (pairCounts[key] || 0) + 1;
    }
    for (let i = 2; i < stages.length; i++) {
      const r0 = stageRank(stages[i - 2]);
      const r1 = stageRank(stages[i - 1]);
      const r2 = stageRank(stages[i]);
      if ((r1 > r0 && r2 < r1) || (r1 < r0 && r2 > r1)) upDownUp += 1;
    }
  }

  return {
    oscillatory_triples: upDownUp,
    total_transitions: totalTransitions,
    churn_rate: totalTransitions ? Math.round((upDownUp / totalTransitions) * 1000) / 10 : 0,
    top_transitions: Object.entries(pairCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([k, n]) => ({ edge: k, n }))
  };
}

/**
 * TrendOnset：向前看，若未来 20 日等权收益显著为正（>8%），且当日起 20 日趋势启动
 * 简化：用 forward 20d equal/benchmark return > threshold 的起点
 */
function detectTrendOnsets(navOrBenchmarkSeries, thresholdPct) {
  const thr = thresholdPct != null ? thresholdPct : 8;
  const series = navOrBenchmarkSeries || [];
  const onsets = [];
  for (let i = 0; i < series.length - 20; i++) {
    const a = series[i].equalWeight != null ? series[i].equalWeight : series[i].bench;
    const b = series[i + 20].equalWeight != null ? series[i + 20].equalWeight : series[i + 20].bench;
    if (a == null || b == null || a <= 0) continue;
    const ret = (b / a - 1) * 100;
    if (ret < thr) continue;
    // 去重：距上一个 onset 至少 40 日
    if (onsets.length && i - onsets[onsets.length - 1].idx < 40) continue;
    onsets.push({ idx: i, date: series[i].date, forward_20d_ret: Math.round(ret * 10) / 10 });
  }
  return onsets;
}

/**
 * Lag：从 TrendOnset 到首次进入 S2/S4/S5 的交易日数
 * @param {object} rowsByCode
 * @param {Array<{idx,date}>} onsets — 索引对齐到 allDates / navSeries
 * @param {string[]} allDates
 */
function computeTransitionLag(rowsByCode, onsets, allDates) {
  const dateToIdx = {};
  (allDates || []).forEach((d, i) => { dateToIdx[d] = i; });

  const lags = { S2: [], S4: [], S5: [] };
  const codes = Object.keys(rowsByCode);
  if (!codes.length || !onsets.length) {
    return { lag_avg: { S2: null, S4: null, S5: null }, samples: 0 };
  }

  for (const onset of onsets) {
    const onsetIdx = onset.idx;
    for (const code of codes) {
      const seq = rowsByCode[code];
      const first = { S2: null, S4: null, S5: null };
      for (const row of seq) {
        const di = dateToIdx[row.date];
        if (di == null || di < onsetIdx) continue;
        if (di > onsetIdx + 60) break;
        const s = normalizeStage(row.stage);
        const r = stageRank(s);
        if (first.S2 == null && r >= stageRank('S2')) first.S2 = di - onsetIdx;
        if (first.S4 == null && r >= stageRank('S4')) first.S4 = di - onsetIdx;
        if (first.S5 == null && r >= stageRank('S5')) first.S5 = di - onsetIdx;
      }
      ['S2', 'S4', 'S5'].forEach((k) => {
        if (first[k] != null) lags[k].push(first[k]);
      });
    }
  }

  const avg = (arr) => (arr.length
    ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10
    : null);

  return {
    lag_avg: { S2: avg(lags.S2), S4: avg(lags.S4), S5: avg(lags.S5) },
    lag_n: { S2: lags.S2.length, S4: lags.S4.length, S5: lags.S5.length },
    samples: onsets.length
  };
}

/**
 * Binding constraint histogram
 * @param {Array<{binding:string, gap:number, stage_target?:number, regime_cap?:number, actual?:number, suggested?:number}>} rows
 */
function computeBindingHistogram(rows) {
  const counts = {};
  let gapTotal = 0;
  const gapBy = {};
  let n = 0;
  for (const row of rows) {
    const b = row.binding || 'none';
    counts[b] = (counts[b] || 0) + 1;
    const gap = row.gap != null ? Math.max(0, row.gap) : 0;
    gapBy[b] = (gapBy[b] || 0) + gap;
    gapTotal += gap;
    n += 1;
  }
  const hist = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).map((k) => ({
    binding: k,
    days: counts[k],
    day_share_pct: n ? Math.round((counts[k] / n) * 1000) / 10 : 0,
    gap_share_pct: gapTotal > 1e-9 ? Math.round((gapBy[k] / gapTotal) * 1000) / 10 : 0
  }));
  return { histogram: hist, n_rows: n, total_gap: Math.round(gapTotal * 10) / 10 };
}

/**
 * False Downgrade Rate：
 * S4/S5 降到更低阶段后，5～10 日内重新回到 S4/S5 的比例
 */
function computeFalseDowngradeRate(rowsByCode, reclaimWindow) {
  const winLo = 5;
  const winHi = reclaimWindow != null ? reclaimWindow : 10;
  let downgrades = 0;
  let falseDown = 0;

  for (const code of Object.keys(rowsByCode)) {
    const seq = rowsByCode[code];
    for (let i = 1; i < seq.length; i++) {
      const prev = normalizeStage(seq[i - 1].stage);
      const cur = normalizeStage(seq[i].stage);
      const wasHigh = prev === 'S4' || prev === 'S5' || prev === 'S6';
      const nowLow = stageRank(cur) < stageRank('S4');
      if (!wasHigh || !nowLow) continue;
      downgrades += 1;
      let reclaimed = false;
      for (let j = i + winLo; j <= Math.min(seq.length - 1, i + winHi); j++) {
        const s = normalizeStage(seq[j].stage);
        if (s === 'S4' || s === 'S5' || s === 'S6') {
          reclaimed = true;
          break;
        }
      }
      // 也检查 winLo 之内是否已 reclaim（更短）
      if (!reclaimed) {
        for (let j = i + 1; j <= Math.min(seq.length - 1, i + winHi); j++) {
          const s = normalizeStage(seq[j].stage);
          if (s === 'S4' || s === 'S5' || s === 'S6') {
            reclaimed = true;
            break;
          }
        }
      }
      if (reclaimed) falseDown += 1;
    }
  }

  return {
    downgrades,
    false_downgrades: falseDown,
    fdr_pct: downgrades ? Math.round((falseDown / downgrades) * 1000) / 10 : null
  };
}

/**
 * Captured Rebound：降级后标的在窗口内创新高（用 raw_target 或 price proxy）
 * 简化：降级后 10 日内 equalWeight/nav 创新高，或 stage 重新升到 S4/S5 且 target 更高
 */
function computeCapturedRebound(rowsByCode, navByDate) {
  let events = 0;
  let rebound = 0;
  for (const code of Object.keys(rowsByCode)) {
    const seq = rowsByCode[code];
    for (let i = 1; i < seq.length; i++) {
      const prev = normalizeStage(seq[i - 1].stage);
      const cur = normalizeStage(seq[i].stage);
      if (!((prev === 'S4' || prev === 'S5') && stageRank(cur) < stageRank('S4'))) continue;
      events += 1;
      const downDate = seq[i].date;
      const baseNav = navByDate && navByDate[downDate];
      let hit = false;
      for (let j = i + 1; j <= Math.min(seq.length - 1, i + 10); j++) {
        const s = normalizeStage(seq[j].stage);
        if (s === 'S4' || s === 'S5' || s === 'S6') {
          hit = true;
          break;
        }
        if (baseNav != null && navByDate) {
          const n = navByDate[seq[j].date];
          if (n != null && n > baseNav * 1.02) {
            hit = true;
            break;
          }
        }
      }
      if (hit) rebound += 1;
    }
  }
  return {
    events,
    rebound_events: rebound,
    captured_rebound_pct: events ? Math.round((rebound / events) * 1000) / 10 : null
  };
}

/**
 * V3.6.1 S5 Downside KPIs
 * - Giveback：进入 S5 至离开 S5，峰值利润 − 退出利润（pct）
 * - Recovery Rate：首次风险降级后 10 日内重回 S5 比例
 * - False / Productive S5 Downgrade
 */
function computeS5DownsideKpis(rowsByCode, reclaimWindow) {
  const win = reclaimWindow != null ? reclaimWindow : 10;
  const givebacks = [];
  let riskEvents = 0;
  let recovered = 0;
  let falseDown = 0;
  let productiveDown = 0;
  let s5toS4 = 0;
  let s5toS3 = 0;

  for (const code of Object.keys(rowsByCode)) {
    const seq = rowsByCode[code];
    let inS5 = false;
    let entryPx = null;
    let peakPx = null;

    for (let i = 0; i < seq.length; i++) {
      const s = normalizeStage(seq[i].stage);
      const px = seq[i].close != null ? seq[i].close : null;
      const prev = i > 0 ? normalizeStage(seq[i - 1].stage) : null;

      if (s === 'S5' && !inS5) {
        inS5 = true;
        entryPx = px;
        peakPx = px;
      } else if (inS5 && s === 'S5') {
        if (px != null && (peakPx == null || px > peakPx)) peakPx = px;
      } else if (inS5 && s !== 'S5') {
        if (entryPx != null && peakPx != null && px != null && entryPx > 0) {
          const peakRet = ((peakPx - entryPx) / entryPx) * 100;
          const exitRet = ((px - entryPx) / entryPx) * 100;
          const gb = Math.max(0, peakRet - exitRet);
          givebacks.push(gb);
        }
        inS5 = false;
        entryPx = null;
        peakPx = null;
      }

      if (prev === 'S5' && s !== 'S5' && stageRank(s) < stageRank('S5')) {
        riskEvents += 1;
        if (s === 'S4') s5toS4 += 1;
        if (stageRank(s) <= stageRank('S3')) s5toS3 += 1;

        let reclaim = false;
        for (let j = i + 1; j <= Math.min(seq.length - 1, i + win); j++) {
          const sj = normalizeStage(seq[j].stage);
          if (sj === 'S5' || sj === 'S6') {
            reclaim = true;
            break;
          }
        }
        if (reclaim) {
          recovered += 1;
          falseDown += 1;
        } else {
          productiveDown += 1;
        }
      }
    }
  }

  const avgGb = givebacks.length
    ? Math.round((givebacks.reduce((a, b) => a + b, 0) / givebacks.length) * 100) / 100
    : null;

  return {
    s5_giveback_avg_pct: avgGb,
    s5_giveback_n: givebacks.length,
    s5_recovery_rate_pct: riskEvents ? Math.round((recovered / riskEvents) * 1000) / 10 : null,
    s5_risk_events: riskEvents,
    false_s5_downgrade: falseDown,
    productive_s5_downgrade: productiveDown,
    false_s5_pct: riskEvents ? Math.round((falseDown / riskEvents) * 1000) / 10 : null,
    productive_s5_pct: riskEvents ? Math.round((productiveDown / riskEvents) * 1000) / 10 : null,
    s5_to_s4: s5toS4,
    s5_to_s3_or_lower: s5toS3
  };
}

/**
 * V3.6.2/6.3 Post-S5 → S4 Landing KPIs
 * - LandingSuccess：S5→S4 后窗口内未跌到 ≤S3，或先回到 S5
 * - DoubleDowngrade：S5→S4→≤S3 在窗口内
 * - RecoveryToS5：S5→S4 后重新回到 S5 的比例
 * - PostS5 FalseDowngrade：双重降级后又回到 S4/S5
 */
function computePostS5LandingKpis(rowsByCode, windowDays) {
  const win = windowDays != null ? windowDays : 5;
  const reclaimWin = Math.max(win, 10);
  let landings = 0;
  let success = 0;
  let doubleDown = 0;
  let falsePost = 0;
  let recoveryS5 = 0;

  for (const code of Object.keys(rowsByCode)) {
    const seq = rowsByCode[code];
    for (let i = 1; i < seq.length; i++) {
      const prev = normalizeStage(seq[i - 1].stage);
      const cur = normalizeStage(seq[i].stage);
      if (!(prev === 'S5' && cur === 'S4')) continue;
      landings += 1;

      let hitLow = false;
      let lowIdx = -1;
      let reclaimedS5 = false;
      for (let j = i + 1; j <= Math.min(seq.length - 1, i + reclaimWin); j++) {
        const sj = normalizeStage(seq[j].stage);
        if ((sj === 'S5' || sj === 'S6') && !reclaimedS5) {
          reclaimedS5 = true;
          if (j <= i + win && !hitLow) break;
        }
        if (!hitLow && j <= i + win && stageRank(sj) <= stageRank('S3')) {
          hitLow = true;
          lowIdx = j;
        }
      }
      if (reclaimedS5) recoveryS5 += 1;

      if (hitLow) {
        doubleDown += 1;
        let reclaim = false;
        for (let k = lowIdx + 1; k <= Math.min(seq.length - 1, lowIdx + 10); k++) {
          const sk = normalizeStage(seq[k].stage);
          if (sk === 'S4' || sk === 'S5' || sk === 'S6') {
            reclaim = true;
            break;
          }
        }
        if (reclaim) falsePost += 1;
      } else {
        success += 1;
      }
    }
  }

  return {
    s5_to_s4_landings: landings,
    s5_landing_success: success,
    s5_landing_success_rate_pct: landings ? Math.round((success / landings) * 1000) / 10 : null,
    double_downgrade: doubleDown,
    double_downgrade_rate_pct: landings ? Math.round((doubleDown / landings) * 1000) / 10 : null,
    recovery_to_s5: recoveryS5,
    recovery_to_s5_pct: landings ? Math.round((recoveryS5 / landings) * 1000) / 10 : null,
    post_s5_false_downgrade: falsePost,
    post_s5_false_downgrade_pct: landings ? Math.round((falsePost / landings) * 1000) / 10 : null,
    window_days: win
  };
}

/** 按 MR 分段：Bull≥75 / Range 55–75 / Bear<55 */
function regimeBucket(mr) {
  if (mr >= 75) return 'bull';
  if (mr >= 55) return 'range';
  return 'bear';
}

/**
 * 汇总完整诊断包
 * @param {object} opts
 * @param {Array} opts.stageLog - [{date,code,stage,mr,raw_target,regime_cap,binding,actual,suggested,equalWeight?}]
 * @param {Array} opts.navSeries
 */
function buildResidencyReport(opts) {
  const log = opts.stageLog || [];
  const nav = opts.navSeries || [];
  const rowsByCode = {};
  for (const row of log) {
    if (!rowsByCode[row.code]) rowsByCode[row.code] = [];
    rowsByCode[row.code].push(row);
  }
  Object.keys(rowsByCode).forEach((c) => {
    rowsByCode[c].sort((a, b) => (a.date < b.date ? -1 : 1));
  });

  const timeShare = computeTimeShare(log);
  const survival = computeSurvival(rowsByCode);
  const churn = computeChurn(rowsByCode);
  const allDates = nav.map((r) => r.date);
  const onsets = detectTrendOnsets(nav, 8);
  const lag = computeTransitionLag(rowsByCode, onsets, allDates);
  const binding = computeBindingHistogram(log.map((r) => ({
    binding: r.binding,
    gap: (r.raw_target != null && r.suggested != null)
      ? Math.max(0, r.raw_target - r.suggested)
      : (r.raw_target != null && r.actual != null ? Math.max(0, r.raw_target - r.actual) : 0)
  })));

  const navByDate = {};
  for (const row of nav) {
    if (row.date) navByDate[row.date] = row.equalWeight != null ? row.equalWeight : row.engine;
  }
  const fdr = computeFalseDowngradeRate(rowsByCode, 10);
  const rebound = computeCapturedRebound(rowsByCode, navByDate);
  const s5Downside = computeS5DownsideKpis(rowsByCode, 10);
  const postS5 = computePostS5LandingKpis(rowsByCode, 5);

  // Target vs Actual on S4/S5
  let s45TargetSum = 0;
  let s45ActualSum = 0;
  let s45N = 0;
  let bullExpSum = 0;
  let bullN = 0;
  const byRegime = { bull: [], range: [], bear: [] };

  for (const row of log) {
    const bucket = regimeBucket(row.mr != null ? row.mr : 55);
    byRegime[bucket].push(row);
    if (bucket === 'bull') {
      bullExpSum += row.actual != null ? row.actual : 0;
      bullN += 1;
    }
    const s = normalizeStage(row.stage);
    if (s === 'S4' || s === 'S5' || s === 'S6') {
      s45TargetSum += row.raw_target != null ? row.raw_target : (row.final_target || 0);
      s45ActualSum += row.actual != null ? row.actual : 0;
      s45N += 1;
    }
  }

  const regimeStats = {};
  ['bull', 'range', 'bear'].forEach((k) => {
    const rows = byRegime[k];
    let exp = 0;
    let tgt = 0;
    const ts = computeTimeShare(rows);
    for (const r of rows) {
      exp += r.actual != null ? r.actual : 0;
      tgt += r.raw_target != null ? r.raw_target : 0;
    }
    regimeStats[k] = {
      days: rows.length,
      avg_actual: rows.length ? Math.round((exp / rows.length) * 10) / 10 : null,
      avg_target: rows.length ? Math.round((tgt / rows.length) * 10) / 10 : null,
      s4_share_pct: ts.share_pct.S4,
      s5_share_pct: ts.share_pct.S5,
      s2_share_pct: ts.share_pct.S2,
      s3_share_pct: ts.share_pct.S3
    };
  });

  return {
    time_share: timeShare,
    transition_lag: lag,
    trend_onsets: onsets.slice(0, 8),
    churn,
    survival,
    binding,
    false_downgrade: fdr,
    captured_rebound: rebound,
    s5_downside: s5Downside,
    post_s5_landing: postS5,
    s45: {
      avg_target: s45N ? Math.round((s45TargetSum / s45N) * 10) / 10 : null,
      avg_actual: s45N ? Math.round((s45ActualSum / s45N) * 10) / 10 : null,
      n: s45N,
      gap: s45N ? Math.round(((s45TargetSum - s45ActualSum) / s45N) * 10) / 10 : null
    },
    bull_avg_exposure: bullN ? Math.round((bullExpSum / bullN) * 10) / 10 : null,
    by_regime: regimeStats
  };
}

function formatResidencyConsole(report) {
  const lines = [];
  lines.push('── Stage Time Share (%) ──');
  const sh = report.time_share.share_pct;
  lines.push(STAGE_ORDER.map((s) => `${s}:${sh[s]}`).join(' | '));
  lines.push('── Transition Lag (avg days from TrendOnset) ──');
  const lg = report.transition_lag.lag_avg;
  lines.push(`S2:${lg.S2} | S4:${lg.S4} | S5:${lg.S5} (onsets=${report.transition_lag.samples})`);
  lines.push('── Churn ──');
  lines.push(`oscillatory:${report.churn.oscillatory_triples} / transitions:${report.churn.total_transitions} (rate ${report.churn.churn_rate}%)`);
  if (report.churn.top_transitions.length) {
    lines.push('top: ' + report.churn.top_transitions.slice(0, 5).map((t) => `${t.edge}×${t.n}`).join(', '));
  }
  lines.push('── Survival (avg days) ──');
  lines.push(STAGE_ORDER.filter((s) => report.survival[s].n_runs > 0)
    .map((s) => `${s}:${report.survival[s].avg_days}d(n=${report.survival[s].n_runs})`).join(' | '));
  lines.push('── Binding Constraint ──');
  for (const h of report.binding.histogram.slice(0, 8)) {
    lines.push(`  ${h.binding}: days ${h.day_share_pct}% | gap ${h.gap_share_pct}%`);
  }
  if (report.false_downgrade) {
    lines.push('── False Downgrade Rate ──');
    lines.push(`FDR ${report.false_downgrade.fdr_pct}% (${report.false_downgrade.false_downgrades}/${report.false_downgrade.downgrades})`);
  }
  if (report.captured_rebound) {
    lines.push('── Captured Rebound ──');
    lines.push(`Rebound ${report.captured_rebound.captured_rebound_pct}% (${report.captured_rebound.rebound_events}/${report.captured_rebound.events})`);
  }
  if (report.s5_downside) {
    const d = report.s5_downside;
    lines.push('── S5 Downside ──');
    lines.push(
      `Giveback ${d.s5_giveback_avg_pct}% (n=${d.s5_giveback_n}) | Recovery ${d.s5_recovery_rate_pct}%`
      + ` | False ${d.false_s5_pct}% | Productive ${d.productive_s5_pct}%`
      + ` | S5→S4×${d.s5_to_s4} S5→≤S3×${d.s5_to_s3_or_lower}`
    );
  }
  if (report.post_s5_landing) {
    const p = report.post_s5_landing;
    lines.push('── Post-S5 Landing ──');
    lines.push(
      `Landings ${p.s5_to_s4_landings} | Success ${p.s5_landing_success_rate_pct}%`
      + ` | DoubleDown ${p.double_downgrade_rate_pct}% (${p.double_downgrade})`
      + ` | RecoveryS5 ${p.recovery_to_s5_pct}%`
      + ` | PostS5FDR ${p.post_s5_false_downgrade_pct}%`
    );
  }
  lines.push('── S4/S5 Target vs Actual ──');
  lines.push(`target ${report.s45.avg_target}% | actual ${report.s45.avg_actual}% | gap ${report.s45.gap}pp (n=${report.s45.n})`);
  lines.push('── By Regime (MR) ──');
  ['bull', 'range', 'bear'].forEach((k) => {
    const r = report.by_regime[k];
    lines.push(`  ${k}: days=${r.days} avgAct=${r.avg_actual}% avgTgt=${r.avg_target}% S2=${r.s2_share_pct}% S3=${r.s3_share_pct}% S4=${r.s4_share_pct}% S5=${r.s5_share_pct}%`);
  });
  return lines.join('\n');
}

module.exports = {
  STAGE_ORDER,
  normalizeStage,
  computeTimeShare,
  computeSurvival,
  computeChurn,
  detectTrendOnsets,
  computeTransitionLag,
  computeBindingHistogram,
  computeFalseDowngradeRate,
  computeCapturedRebound,
  computeS5DownsideKpis,
  computePostS5LandingKpis,
  regimeBucket,
  buildResidencyReport,
  formatResidencyConsole
};
