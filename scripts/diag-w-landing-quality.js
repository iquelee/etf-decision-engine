/**
 * Landing Quality 诊断（只评不调）
 *
 * 背景：研究简报中的 S5→S4 / Post-S5 Grace 不在本仓；本脚本用线上同源状态机的
 * 「W1/W2 → W4」作为最接近的落地事件，按 LQ / 回撤深度分桶，观察后续是否回强趋势。
 *
 * 不做：day3_min_hits、Grace 参数、decision.js 改动、V3.7 Entry 加速。
 *
 * 运行：
 *   node scripts/diag-w-landing-quality.js
 *   node scripts/diag-w-landing-quality.js --from=2025-02-25 --to=2026-08-24
 */
'use strict';

const fs = require('fs');
const path = require('path');
const indicators = require('../cloudfunctions/common/utils/indicators.js');
const {
  loadCsv, decideDay, makeSlowResolver, makeCooldown,
  ETFS, START_DATE, PARAMS, TECH_SECTORS
} = require('./backtest-full-engine.js');
const { barsThrough } = require('./lib/bars-through.js');

const OUT_DIR = path.join(__dirname, 'backtest-out');
const REPORT_DIR = path.join(__dirname, '../回测报告');

function argVal(name) {
  const hit = process.argv.find((a) => a.indexOf(name + '=') === 0);
  return hit ? hit.slice(name.length + 1) : null;
}

function isStrong(w) {
  return w === 'W1' || w === 'W2';
}

/** LandingQuality 0~100（权重对齐研究简报：MA60 40 / Base 30 / HL 20 / MA20 10） */
function landingQuality(snap, landClose, peakClose) {
  let score = 0;
  const ma60 = snap.ma60;
  const ma60Intact = ma60 != null && landClose >= ma60;
  if (ma60Intact) score += 40;
  else if (ma60 != null && landClose >= ma60 * 0.98) score += 20;

  // BreakoutBase 代理：相对峰值回撤浅，且 price_position 未崩
  const retreat = peakClose > 0 ? (peakClose - landClose) / peakClose : 1;
  const pp = snap.price_position;
  if (retreat <= 0.05 && (pp == null || pp >= 0.35)) score += 30;
  else if (retreat <= 0.10 && (pp == null || pp >= 0.25)) score += 18;
  else if (retreat <= 0.12) score += 8;

  const h = snap.h_state;
  const d = snap.d_state;
  if (h === 'H1' || h === 'H2' || d === 'D3') score += 20;
  else if (h === 'H3' || d === 'D2' || d === 'D4') score += 12;
  else if (h === 'H4') score += 5;

  const slope = snap.ma20_slope;
  if (slope != null && slope >= 0) score += 10;
  else if (slope != null && slope > -1.5) score += 4;

  return {
    lq: Math.max(0, Math.min(100, score)),
    ma60_intact: ma60Intact,
    retreat_from_peak: Math.round(retreat * 10000) / 10000,
    h_state: h,
    d_state: d,
    v_state: snap.v_state,
    ma20_slope: slope,
    price_position: pp,
    volume_ratio: snap.volume_ratio,
    high_volume_decline: !!snap.high_volume_decline
  };
}

function lqBucket(lq) {
  if (lq >= 70) return 'high';
  if (lq >= 45) return 'medium';
  return 'low';
}

function retreatBucket(r) {
  if (r < 0.05) return 'shallow';
  if (r <= 0.10) return 'mid';
  return 'deep';
}

function futurePath(bars, landIdx, landClose, landDate) {
  const out = {
    re_strong_5: false,
    re_strong_10: false,
    to_w5_5: false,
    to_w5_10: false,
    stay_weak_10: false,
    continue_down_10: false,
    w_at_5: null,
    w_at_10: null,
    close_chg_10: null
  };
  let sawStrong5 = false;
  let sawStrong10 = false;
  let sawW55 = false;
  let sawW510 = false;
  let lastW = null;
  for (let k = 1; k <= 10; k++) {
    const j = landIdx + k;
    if (j >= bars.length) break;
    const hist = barsThrough(bars, bars[j].trade_date);
    if (hist.length < 60) continue;
    const snap = indicators.computeSnapshot(hist, PARAMS, { code: bars[j].code || '', calc_date: bars[j].trade_date });
    if (!snap) continue;
    lastW = snap.w_state;
    if (k <= 5) {
      if (isStrong(snap.w_state)) sawStrong5 = true;
      if (snap.w_state === 'W5') sawW55 = true;
      if (k === 5) out.w_at_5 = snap.w_state;
    }
    if (k <= 10) {
      if (isStrong(snap.w_state)) sawStrong10 = true;
      if (snap.w_state === 'W5') sawW510 = true;
      if (k === 10) {
        out.w_at_10 = snap.w_state;
        out.close_chg_10 = landClose > 0
          ? Math.round(((bars[j].close - landClose) / landClose) * 10000) / 10000
          : null;
      }
    }
  }
  out.re_strong_5 = sawStrong5;
  out.re_strong_10 = sawStrong10;
  out.to_w5_5 = sawW55;
  out.to_w5_10 = sawW510;
  out.stay_weak_10 = out.w_at_10 === 'W4' || out.w_at_10 === 'W3';
  out.continue_down_10 = out.close_chg_10 != null && out.close_chg_10 <= -0.05;
  void landDate;
  return out;
}

function replayEvents(fromDate, toDate) {
  const barsMap = {};
  for (const etf of ETFS) barsMap[etf.code] = loadCsv(etf.code);
  const dateSet = new Set();
  for (const etf of ETFS) barsMap[etf.code].forEach((b) => dateSet.add(b.trade_date));
  const allDates = [...dateSet].sort();
  const startIdx = allDates.findIndex((d) => d >= START_DATE);
  const tradingDays = allDates.slice(Math.max(0, startIdx - 60));

  const portfolio = {
    positions: {},
    techPosition: 0, goldPosition: 0, drugPosition: 0,
    market_regime: 'range', cashRatio: 100,
    tech_position: 0, gold_position: 0, cash_ratio: 100
  };
  for (const etf of ETFS) {
    portfolio.positions[etf.code] = {
      code: etf.code, current_position: 0, target_max: 30,
      max_position: 30, max_strategic_position: 30,
      core_position: 0, trade_position: 0
    };
  }

  const slowResolver = makeSlowResolver();
  const cooldown = makeCooldown(tradingDays);
  const pending = {};

  // per-code streak state
  const streak = {};
  for (const etf of ETFS) {
    streak[etf.code] = { strongDays: 0, peak: null, prevW: null };
  }

  const events = [];
  const navSeries = []; // lightweight book proxy for alpha stability slice
  let engineNav = 1;
  let ewNav = 1;
  const baseCloses = {};

  for (let idx = 60; idx < tradingDays.length; idx++) {
    const today = tradingDays[idx];

    for (const code of Object.keys(pending)) {
      const ord = pending[code];
      const pos = portfolio.positions[code];
      const bar = barsMap[code].find((b) => b.trade_date === today);
      if (bar) {
        pos.current_position = Math.round(ord.target * 10) / 10;
        if (Math.abs(ord.target - (ord.from || 0)) > 0.05 && ord.target > (ord.from || 0)) {
          cooldown.setBuy(code, idx, ord.add_mode);
        }
        pos.core_position = ord.core != null ? ord.core : pos.core_position;
        pos.trade_position = ord.trade != null ? ord.trade : pos.trade_position;
        delete pending[code];
      }
    }

    const dayResults = decideDay(barsMap, idx, portfolio, slowResolver, cooldown, tradingDays, 'F3');

    // init EW base on first in-window day
    if (today >= fromDate && (!toDate || today <= toDate) && Object.keys(baseCloses).length === 0) {
      for (const etf of ETFS) {
        const b = barsMap[etf.code].find((x) => x.trade_date === today);
        if (b) baseCloses[etf.code] = b.close;
      }
    }

    for (const { code, result, p } of dayResults) {
      const pos = portfolio.positions[code];
      const from = pos.current_position;
      pending[code] = {
        from,
        target: result.suggested_position != null ? result.suggested_position : from,
        core: result.core_position,
        trade: result.trade_position,
        action: result.final_action,
        add_mode: result.add_mode || '无'
      };

      const snap = p && p.snapshot;
      if (!snap) continue;
      const w = snap.w_state;
      const st = streak[code];
      const bars = barsMap[code];
      const barIdx = bars.findIndex((b) => b.trade_date === today);
      const close = barIdx >= 0 ? bars[barIdx].close : null;

      // Event: first day entering W4 from W1/W2
      if (w === 'W4' && isStrong(st.prevW) && close != null && today >= fromDate && (!toDate || today <= toDate)) {
        const peak = st.peak != null ? st.peak : close;
        const lq = landingQuality(snap, close, peak);
        const fut = futurePath(bars, barIdx, close, today);
        events.push({
          date: today,
          code,
          from_w: st.prevW,
          to_w: w,
          strong_streak_days: st.strongDays,
          peak,
          land_close: close,
          action: result.final_action,
          suggested: result.suggested_position,
          current: from,
          ...lq,
          lq_bucket: lqBucket(lq.lq),
          retreat_bucket: retreatBucket(lq.retreat_from_peak),
          ...fut
        });
      }

      if (isStrong(w) && close != null) {
        st.strongDays = isStrong(st.prevW) ? st.strongDays + 1 : 1;
        st.peak = st.peak == null ? close : Math.max(st.peak, close);
      } else if (w !== 'W4' || !isStrong(st.prevW)) {
        // reset when not in strong; keep peak until after W4 event handled above
        if (!(w === 'W4' && isStrong(st.prevW))) {
          st.strongDays = 0;
          st.peak = null;
        } else {
          // just landed; reset after recording
          st.strongDays = 0;
          st.peak = null;
        }
      }
      st.prevW = w;
    }

    portfolio.techPosition = ETFS.filter((e) => TECH_SECTORS.indexOf(e.sector) >= 0)
      .reduce((s, e) => s + (portfolio.positions[e.code].current_position || 0), 0);
    portfolio.goldPosition = portfolio.positions['518880'].current_position || 0;
    portfolio.drugPosition = portfolio.positions['159570'].current_position || 0;
    portfolio.tech_position = portfolio.techPosition;
    portfolio.gold_position = portfolio.goldPosition;

    if (today >= fromDate && (!toDate || today <= toDate) && Object.keys(baseCloses).length === ETFS.length) {
      // engine day return ~ book-weighted; use equal book proxy via positions %
      const book = ETFS.reduce((s, e) => s + (portfolio.positions[e.code].current_position || 0), 0);
      let engRet = 0;
      let ewRet = 0;
      let nEw = 0;
      for (const etf of ETFS) {
        const bars = barsMap[etf.code];
        const i = bars.findIndex((b) => b.trade_date === today);
        if (i <= 0) continue;
        const r = (bars[i].close - bars[i - 1].close) / bars[i - 1].close;
        const wgt = book > 0 ? (portfolio.positions[etf.code].current_position || 0) / 100 : 0;
        engRet += wgt * r;
        ewRet += r / ETFS.length;
        nEw += 1;
      }
      if (nEw === ETFS.length) {
        engineNav *= (1 + engRet);
        ewNav *= (1 + ewRet);
        navSeries.push({
          date: today,
          engine: Math.round(engineNav * 1e6) / 1e6,
          equalWeight: Math.round(ewNav * 1e6) / 1e6,
          book: Math.round(book * 10) / 10,
          alpha_pp: Math.round((engineNav - ewNav) * 10000) / 100
        });
      }
    }
  }

  return { events, navSeries };
}

function summarize(events) {
  const byLq = { high: [], medium: [], low: [] };
  const byRetreat = { shallow: [], mid: [], deep: [] };
  const byCode = {};
  for (const e of events) {
    byLq[e.lq_bucket].push(e);
    byRetreat[e.retreat_bucket].push(e);
    if (!byCode[e.code]) byCode[e.code] = [];
    byCode[e.code].push(e);
  }

  function rates(list) {
    const n = list.length || 1;
    return {
      n: list.length,
      re_strong_5: Math.round(1000 * list.filter((x) => x.re_strong_5).length / n) / 10,
      re_strong_10: Math.round(1000 * list.filter((x) => x.re_strong_10).length / n) / 10,
      to_w5_5: Math.round(1000 * list.filter((x) => x.to_w5_5).length / n) / 10,
      to_w5_10: Math.round(1000 * list.filter((x) => x.to_w5_10).length / n) / 10,
      continue_down_10: Math.round(1000 * list.filter((x) => x.continue_down_10).length / n) / 10,
      avg_lq: list.length ? Math.round(10 * list.reduce((s, x) => s + x.lq, 0) / list.length) / 10 : null,
      avg_retreat: list.length
        ? Math.round(10000 * list.reduce((s, x) => s + x.retreat_from_peak, 0) / list.length) / 10000
        : null
    };
  }

  return {
    total: events.length,
    by_lq: {
      high: rates(byLq.high),
      medium: rates(byLq.medium),
      low: rates(byLq.low)
    },
    by_retreat: {
      shallow: rates(byRetreat.shallow),
      mid: rates(byRetreat.mid),
      deep: rates(byRetreat.deep)
    },
    by_code: Object.fromEntries(Object.keys(byCode).sort().map((c) => [c, rates(byCode[c])]))
  };
}

function alphaStability(navSeries) {
  if (!navSeries.length) return { quarters: [], rolling_60d: [] };
  const quarters = {};
  for (const row of navSeries) {
    const y = +row.date.slice(0, 4);
    const m = +row.date.slice(5, 7);
    const q = Math.ceil(m / 3);
    const key = `${y}-Q${q}`;
    if (!quarters[key]) quarters[key] = { first: row, last: row };
    quarters[key].last = row;
  }
  const qRows = Object.keys(quarters).sort().map((key) => {
    const { first, last } = quarters[key];
    const eng = first.engine > 0 ? (last.engine / first.engine - 1) * 100 : null;
    const ew = first.equalWeight > 0 ? (last.equalWeight / first.equalWeight - 1) * 100 : null;
    return {
      quarter: key,
      engine_pct: eng != null ? Math.round(eng * 100) / 100 : null,
      ew_pct: ew != null ? Math.round(ew * 100) / 100 : null,
      alpha_pp: eng != null && ew != null ? Math.round((eng - ew) * 100) / 100 : null
    };
  });

  const rolling = [];
  for (let i = 59; i < navSeries.length; i++) {
    const a = navSeries[i - 59];
    const b = navSeries[i];
    const eng = a.engine > 0 ? (b.engine / a.engine - 1) * 100 : null;
    const ew = a.equalWeight > 0 ? (b.equalWeight / a.equalWeight - 1) * 100 : null;
    rolling.push({
      date: b.date,
      engine_60d_pct: eng != null ? Math.round(eng * 100) / 100 : null,
      ew_60d_pct: ew != null ? Math.round(ew * 100) / 100 : null,
      alpha_60d_pp: eng != null && ew != null ? Math.round((eng - ew) * 100) / 100 : null
    });
  }
  return { quarters: qRows, rolling_60d: rolling };
}

function writeReport(payload) {
  const s = payload.summary;
  const lines = [];
  lines.push('# W 落地质量诊断（只评不调）');
  lines.push('');
  lines.push(`日期：${payload.generated_at.slice(0, 10)}`);
  lines.push(`窗口：${payload.window.from} ~ ${payload.window.to}`);
  lines.push('');
  lines.push('> **概念对齐**：研究简报的 S5→S4 / Grace **不在本仓**。本报告以线上同源引擎的 **W1/W2→W4** 作为落地事件代理。');
  lines.push('>');
  lines.push('> **基线纪律**：Production Baseline = 线上（`ENGINE_VERSION` V3.9 / 包 V4.3c）；Research Candidate = `scripts/lib/shadow/v36|v38`（shadow，不升默认）。**不做** `day3_min_hits=3`；**暂缓** V3.7 Entry 加速；518880 不改主引擎。');
  lines.push('');
  lines.push('## 1. 事件总量');
  lines.push('');
  lines.push(`W1/W2→W4 事件：**${s.total}** 次`);
  lines.push('');
  lines.push('## 2. 按 Landing Quality 分桶');
  lines.push('');
  lines.push('| LQ 桶 | n | 5日回W1/W2% | 10日回W1/W2% | 5日见W5% | 10日见W5% | 10日续跌≥5%% | 均LQ | 均回撤 |');
  lines.push('|-------|---|-------------|--------------|----------|-----------|--------------|------|--------|');
  for (const k of ['high', 'medium', 'low']) {
    const r = s.by_lq[k];
    lines.push(`| ${k} | ${r.n} | ${r.re_strong_5} | ${r.re_strong_10} | ${r.to_w5_5} | ${r.to_w5_10} | ${r.continue_down_10} | ${r.avg_lq} | ${r.avg_retreat} |`);
  }
  lines.push('');
  lines.push('## 3. 按回撤深度分桶');
  lines.push('');
  lines.push('| 回撤 | n | 10日回强% | 10日见W5% | 续跌% | 均LQ |');
  lines.push('|------|---|-----------|-----------|------|------|');
  for (const k of ['shallow', 'mid', 'deep']) {
    const r = s.by_retreat[k];
    lines.push(`| ${k} | ${r.n} | ${r.re_strong_10} | ${r.to_w5_10} | ${r.continue_down_10} | ${r.avg_lq} |`);
  }
  lines.push('');
  lines.push('## 4. 按标的');
  lines.push('');
  lines.push('| 代码 | n | 10日回强% | 10日见W5% | 续跌% | 均LQ | 均回撤 |');
  lines.push('|------|---|-----------|-----------|------|------|--------|');
  for (const code of Object.keys(s.by_code)) {
    const r = s.by_code[code];
    lines.push(`| ${code} | ${r.n} | ${r.re_strong_10} | ${r.to_w5_10} | ${r.continue_down_10} | ${r.avg_lq} | ${r.avg_retreat} |`);
  }
  lines.push('');
  lines.push('## 5. Alpha Stability（仓位加权代理净值 vs 等权）');
  lines.push('');
  lines.push('| 季度 | Engine% | EW% | Alpha pp |');
  lines.push('|------|---------|-----|----------|');
  for (const q of payload.alpha.quarters) {
    lines.push(`| ${q.quarter} | ${q.engine_pct} | ${q.ew_pct} | ${q.alpha_pp} |`);
  }
  const roll = payload.alpha.rolling_60d;
  if (roll.length) {
    const last = roll[roll.length - 1];
    const neg = roll.filter((x) => x.alpha_60d_pp != null && x.alpha_60d_pp < 0).length;
    lines.push('');
    lines.push(`Rolling 60D Alpha：样本 ${roll.length}；期末 ${last.date} = **${last.alpha_60d_pp}pp**；负超额日占比 ${(100 * neg / roll.length).toFixed(1)}%。`);
  }
  lines.push('');
  lines.push('## 6. 解读闸门（不自动改策略）');
  lines.push('');
  lines.push('- 若 **high LQ** 的 10 日回强显著高于 **low LQ**，且 low 的 W5/续跌更高 → 支持下一版 `Grace=f(LQ)`（本仓对应「W4 落地后保护」研究，仍保持 shadow）。');
  lines.push('- 若分桶无单调关系 → **不要**上 Adaptive Grace，继续只观察。');
  lines.push('- 518880：只作独立 Profile 切片，禁止据此改主引擎黄金规则。');
  lines.push('- 本仓无 588000；单票反例研究需另开含该标的数据的工作区。');
  lines.push('');
  lines.push(`JSON：\`${payload.json_rel}\``);
  lines.push('');

  const stamp = payload.generated_at.slice(0, 10);
  const mdPath = path.join(REPORT_DIR, `W落地质量诊断-LandingQuality-只评不调-${stamp}.md`);
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(mdPath, lines.join('\n'), 'utf8');
  return mdPath;
}

function main() {
  const fromDate = argVal('--from') || START_DATE;
  const toDate = argVal('--to') || null;
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const { events, navSeries } = replayEvents(fromDate, toDate);
  const summary = summarize(events);
  const alpha = alphaStability(navSeries);
  const stamp = new Date().toISOString().slice(0, 10);
  const jsonName = `w-landing-quality-${stamp}.json`;
  const jsonPath = path.join(OUT_DIR, jsonName);
  const payload = {
    generated_at: new Date().toISOString(),
    disclaimer: 'W1/W2→W4 proxy for brief S5→S4; diagnose-only; no strategy change',
    baseline: {
      production: 'online ENGINE_VERSION V3.9 / VERSION V4.3c',
      research_candidate: 'scripts/lib/shadow/v36|v38 (shadow only)',
      deferred: ['day3_min_hits=3', 'V3.7 entry acceleration', 'gold rule change']
    },
    window: { from: fromDate, to: toDate || (navSeries.length ? navSeries[navSeries.length - 1].date : null) },
    summary,
    alpha: {
      quarters: alpha.quarters,
      rolling_60d_tail: alpha.rolling_60d.slice(-5),
      rolling_60d: alpha.rolling_60d
    },
    events,
    json_rel: `scripts/backtest-out/${jsonName}`
  };
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
  const mdPath = writeReport(payload);

  console.log('════════ W 落地质量诊断（只评不调）════════');
  console.log(`窗口 ${payload.window.from} ~ ${payload.window.to}`);
  console.log(`事件 ${summary.total}`);
  console.log('按 LQ:', JSON.stringify(summary.by_lq));
  console.log('按回撤:', JSON.stringify(summary.by_retreat));
  console.log('分季 Alpha:', JSON.stringify(alpha.quarters));
  console.log(`JSON ${jsonPath}`);
  console.log(`报告 ${mdPath}`);
}

if (require.main === module) main();

module.exports = { landingQuality, summarize, alphaStability };
