/**
 * V4.0 Phase2 — 导出 Main5(+可选扩展) 日频因果 Stage 面板
 * 供 counterfactual-fast-path.py 使用。不训练、不上线。
 *
 *   node scripts/ml/export-daily-stage-panel.js
 *   node scripts/ml/export-daily-stage-panel.js --codes=515880,159582,513310,159570,588000
 */
'use strict';

const fs = require('fs');
const path = require('path');
const indicators = require('../../cloudfunctions/common/utils/indicators.js');
const { resolveTrendStage } = require('../../cloudfunctions/common/utils/trend-stage.js');
const { barsThrough } = require('../lib/bars-through.js');

const ROOT = path.join(__dirname, '../..');
const POOL_JSON = path.join(ROOT, 'ml/universe-train-pool.json');
const ML_CSV = path.join(ROOT, 'deliverables/etf_daily_ml_pool');
const MAIN_CSV = path.join(ROOT, 'deliverables/etf_daily_qfq');
const LIVE_CSV = path.join(ROOT, 'ml/live-bars');
const OUT_DIR = path.join(ROOT, 'ml/datasets');

const PARAMS = {
  sideway_days: 15, sideway_days_min: 8, sideway_days_mature: 20,
  sideway_range_base: 12, sideway_atr_multiplier: 4, sideway_range_max: 12, sideway_range_hard_cap: 15,
  ma20_slope_flat: 1.5, trend_context_up: 5, trend_context_down: -5,
  volume_ratio: 0.70, volume_ratio_mild: 0.95, volume_ratio_high: 1.15, volume_ratio_extreme: 1.5
};

function argVal(name) {
  const hit = process.argv.find((a) => a.indexOf(name + '=') === 0);
  return hit ? hit.slice(name.length + 1) : null;
}

function findCsv(code) {
  for (const dir of [LIVE_CSV, ML_CSV, MAIN_CSV]) {
    if (!fs.existsSync(dir)) continue;
    const hit = fs.readdirSync(dir).find((f) => f.startsWith(code) && f.endsWith('.csv'));
    if (hit) return path.join(dir, hit);
  }
  return null;
}

function loadBars(code) {
  const file = findCsv(code);
  if (!file) return null;
  const lines = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split('\n');
  const bars = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    if (p.length < 6 || !p[0]) continue;
    bars.push({
      trade_date: p[0].trim(),
      open: +p[1], close: +p[2], high: +p[3], low: +p[4], volume: +p[5]
    });
  }
  bars.sort((a, b) => (a.trade_date < b.trade_date ? -1 : 1));
  return bars;
}

function stageAt(bars, idx, state) {
  const today = bars[idx].trade_date;
  const histFull = barsThrough(bars, today);
  const hist = histFull.length > 800 ? histFull.slice(histFull.length - 800) : histFull;
  if (hist.length < 60) return null;
  const snapshot = indicators.computeSnapshot(hist, PARAMS, { calc_date: today });
  if (!snapshot) return null;
  const resolved = resolveTrendStage(snapshot, { f_state: 'F3', f_score: 50 }, state || {}, {
    bars: hist,
    params: { v3_6_persistence: true, v3_6_1_s5_downside: true, v3_6_1_enabled: true },
    v3_6_persistence: true
  });
  return {
    snapshot,
    primary: resolved.primaryStage || resolved.stage,
    display: resolved.displayStage,
    state: {
      stage: resolved.primaryStage || resolved.stage,
      overlay: resolved.overlay,
      days_in_stage: resolved.days_in_stage,
      soft_down_days: resolved.soft_down_days,
      breakout_level: resolved.breakout_level,
      s4_origin: resolved.s4_origin,
      s5_risk_days: resolved.s5_risk_days
    }
  };
}

function retN(bars, idx, n) {
  if (idx < n) return null;
  const a = bars[idx - n].close;
  const b = bars[idx].close;
  if (!(a > 0)) return null;
  return (b - a) / a;
}

function closeOn(bars, date) {
  const i = bars.findIndex((b) => b.trade_date === date);
  return i >= 0 ? { i, close: bars[i].close } : null;
}

function pickCodes(meta) {
  const explicit = argVal('--codes');
  if (explicit) return explicit.split(',').map((s) => s.trim()).filter(Boolean);
  const main = meta.train_pool.filter((e) => e.main5).map((e) => e.code);
  // 用户研究常含科创50；纳入面板但不改训练标签定义
  if (!main.includes('588000')) main.push('588000');
  return main;
}

function main() {
  const meta = JSON.parse(fs.readFileSync(POOL_JSON, 'utf8'));
  const codes = pickCodes(meta);
  const inferenceOnly = process.argv.includes('--inference');
  const benchCode = meta.benchmark && meta.benchmark.code;
  const benchBars = benchCode ? loadBars(benchCode) : null;
  const fromDate = argVal('--from') || '2024-01-01';
  const toDate = argVal('--to') || '2026-08-24';
  const stamp = new Date().toISOString().slice(0, 10);
  const nameMap = {};
  for (const e of meta.train_pool) nameMap[e.code] = e;

  const rows = [];
  for (const code of codes) {
    const bars = loadBars(code);
    if (!bars) {
      process.stderr.write(`MISSING ${code}\n`);
      continue;
    }
    process.stderr.write(`panel ${code} n=${bars.length}\n`);
    let state = {};
    const series = new Array(bars.length).fill(null);
    for (let i = 60; i < bars.length; i++) {
      if ((i - 60) % 250 === 0) process.stderr.write(`  ${code} ${i}/${bars.length}\n`);
      const cur = stageAt(bars, i, state);
      if (!cur) continue;
      state = cur.state;
      series[i] = cur;
    }

    for (let i = 60; i < bars.length; i++) {
      const cur = series[i];
      if (!cur) continue;
      const d = bars[i].trade_date;
      if (d < fromDate || d > toDate) continue;
      if (i + 5 >= bars.length && !inferenceOnly) continue;
      const y5p = (i + 5 < bars.length && series[i + 5]) ? series[i + 5].primary : null;
      const y5 = y5p == null ? null : ((y5p === 'S4' || y5p === 'S5') ? 1 : 0);
      const snap = cur.snapshot;
      const close = bars[i].close;
      const prevClose = i > 0 ? bars[i - 1].close : close;
      const ret_1d = prevClose > 0 ? (close / prevClose - 1) : 0;
      const ret_5d = retN(bars, i, 5);
      let rs_20d = null;
      if (benchBars) {
        const b = closeOn(benchBars, d);
        if (b && b.i >= 20) {
          const bm20 = retN(benchBars, b.i, 20);
          const own20 = retN(bars, i, 20);
          if (bm20 != null && own20 != null) rs_20d = own20 - bm20;
        }
      }
      rows.push({
        code,
        name: (nameMap[code] && nameMap[code].name) || code,
        sector: (nameMap[code] && nameMap[code].sector) || '',
        main5: !!(nameMap[code] && nameMap[code].main5),
        date: d,
        stage_t: cur.primary,
        close,
        ret_1d,
        ret_5d,
        stage: cur.primary,
        stage_display: cur.display,
        y5,
        y5_stage: y5p || '',
        ma20_slope: snap.ma20_slope,
        px_ma20: snap.ma20 ? close / snap.ma20 - 1 : null,
        px_ma60: snap.ma60 ? close / snap.ma60 - 1 : null,
        price_position: snap.price_position,
        volume_ratio: snap.volume_ratio,
        sideway_days: snap.sideway_days,
        sideway_range: snap.sideway_range,
        consolidation_score: snap.consolidation_score,
        atr20: snap.atr20,
        bias_20d: snap.bias_20d,
        w_state: snap.w_state || 'NA',
        d_state: snap.d_state || 'NA',
        h_state: snap.h_state || 'NA',
        v_state: snap.v_state || 'NA',
        breakout: snap.breakout === true ? 1 : 0,
        ret_20d: retN(bars, i, 20),
        rs_20d,
        change_5d: snap.change_5d
      });
    }
    process.stderr.write(`  ${code} rows done\n`);
  }

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const keys = Object.keys(rows[0] || { code: 1 });
  const lines = [keys.join(',')];
  for (const r of rows) {
    lines.push(keys.map((k) => {
      const v = r[k];
      if (v == null) return '';
      if (typeof v === 'string' && (v.indexOf(',') >= 0 || v.indexOf('"') >= 0)) {
        return `"${v.replace(/"/g, '""')}"`;
      }
      return String(v);
    }).join(','));
  }
  const out = path.join(OUT_DIR, `daily_stage_panel_${stamp}.csv`);
  fs.writeFileSync(out, lines.join('\n') + '\n');
  process.stderr.write(`wrote ${out} n=${rows.length} codes=${codes.join(',')}\n`);
  console.log(JSON.stringify({ ok: true, path: out, n: rows.length, codes }, null, 2));
}

main();
