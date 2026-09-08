/**
 * V4.0 Phase3-A — High-Value Transition 数据集
 *
 * 在 Early Transition 因果 Stage 上增加：
 *   y5 / y_persist10 / y_ret10 / y_hvt
 * 以及加速度 / 突破距离 / RS 等特征。
 *
 * 不改 V3.6.1；不上线。
 *
 *   node scripts/ml/export-high-value-transition-dataset.js
 *   node scripts/ml/export-high-value-transition-dataset.js --from=2024-01-01 --to=2026-08-24
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
const OUT_DIR = path.join(ROOT, 'ml/datasets');
const REPORT_DIR = path.join(ROOT, '回测报告');

const PARAMS = {
  sideway_days: 15, sideway_days_min: 8, sideway_days_mature: 20,
  sideway_range_base: 12, sideway_atr_multiplier: 4, sideway_range_max: 12, sideway_range_hard_cap: 15,
  ma20_slope_flat: 1.5, trend_context_up: 5, trend_context_down: -5,
  volume_ratio: 0.70, volume_ratio_mild: 0.95, volume_ratio_high: 1.15, volume_ratio_extreme: 1.5
};

/** HVT 阈值（研究默认；可后续敏感性分析） */
const HVT = {
  ret10_min: 0.02,       // 未来 10 日收益 > 2%
  persist_min: 0.50      // 进入后 10 日内 ≥50% 日子在 S4/S5
};

function argVal(name) {
  const hit = process.argv.find((a) => a.indexOf(name + '=') === 0);
  return hit ? hit.slice(name.length + 1) : null;
}

function findCsv(code) {
  for (const dir of [ML_CSV, MAIN_CSV]) {
    if (!fs.existsSync(dir)) continue;
    const hit = fs.readdirSync(dir).find((f) => f.startsWith(code) && f.endsWith('.csv'));
    if (hit) return { dir, file: path.join(dir, hit), source: path.basename(dir) };
  }
  return null;
}

function loadBars(code) {
  const loc = findCsv(code);
  if (!loc) return null;
  const lines = fs.readFileSync(loc.file, 'utf8').replace(/^\uFEFF/, '').split('\n');
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
  return { bars, source: loc.source };
}

function retN(bars, idx, n) {
  if (idx < n || idx + n >= bars.length && n > 0) {
    /* forward return handled separately */
  }
  if (idx < n) return null;
  const a = bars[idx - n].close;
  const b = bars[idx].close;
  if (!(a > 0)) return null;
  return (b - a) / a;
}

function fwdRet(bars, idx, n) {
  if (idx + n >= bars.length) return null;
  const a = bars[idx].close;
  const b = bars[idx + n].close;
  if (!(a > 0)) return null;
  return (b - a) / a;
}

function closeOn(bars, date) {
  const i = bars.findIndex((b) => b.trade_date === date);
  return i >= 0 ? { i, close: bars[i].close } : null;
}

function hhN(bars, idx, n) {
  let mx = -Infinity;
  const from = Math.max(0, idx - n + 1);
  for (let j = from; j <= idx; j++) mx = Math.max(mx, bars[j].high);
  return mx === -Infinity ? null : mx;
}

function atrApprox(bars, idx, n) {
  // 简易 ATR：mean(high-low) over n（与 snapshot.atr20 互补作压缩比）
  if (idx < n - 1) return null;
  let s = 0;
  for (let j = idx - n + 1; j <= idx; j++) s += (bars[j].high - bars[j].low);
  return s / n;
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

function buildFeatures(snap, bars, idx, benchBars, histSlopes, histVr) {
  const close = bars[idx].close;
  const ma20 = snap.ma20;
  const ma60 = snap.ma60;
  const atr20 = snap.atr20 != null ? snap.atr20 : atrApprox(bars, idx, 20);
  const feat = {
    ma20_slope: snap.ma20_slope,
    ma20, ma60,
    px_ma20: ma20 ? close / ma20 - 1 : null,
    px_ma60: ma60 ? close / ma60 - 1 : null,
    price_position: snap.price_position,
    volume_ratio: snap.volume_ratio,
    sideway_days: snap.sideway_days,
    sideway_range: snap.sideway_range,
    consolidation_score: snap.consolidation_score,
    atr20: atr20,
    change_5d: snap.change_5d,
    bias_20d: snap.bias_20d,
    breakout: snap.breakout === true ? 1 : 0,
    w_state: snap.w_state,
    d_state: snap.d_state,
    h_state: snap.h_state,
    v_state: snap.v_state,
    ret_5d: retN(bars, idx, 5),
    ret_20d: retN(bars, idx, 20)
  };

  // RS
  feat.rs_5d = null;
  feat.rs_20d = null;
  let bmRet20 = null;
  if (benchBars && benchBars.length) {
    const b = closeOn(benchBars, bars[idx].trade_date);
    if (b) {
      if (b.i >= 5 && feat.ret_5d != null) {
        const bm5 = retN(benchBars, b.i, 5);
        if (bm5 != null) feat.rs_5d = feat.ret_5d - bm5;
      }
      if (b.i >= 20 && feat.ret_20d != null) {
        bmRet20 = retN(benchBars, b.i, 20);
        if (bmRet20 != null) feat.rs_20d = feat.ret_20d - bmRet20;
      }
    }
  }
  feat.market_mom_20d = bmRet20;

  // 加速度（仅用 ≤t）
  feat.slope_accel_5 = null;
  feat.vol_accel_5 = null;
  if (idx >= 5 && histSlopes[idx] != null && histSlopes[idx - 5] != null) {
    feat.slope_accel_5 = histSlopes[idx] - histSlopes[idx - 5];
  }
  if (idx >= 5 && histVr[idx] != null && histVr[idx - 5] != null) {
    feat.vol_accel_5 = histVr[idx] - histVr[idx - 5];
  }

  // 距突破（HH20）
  const hh = hhN(bars, idx, 20);
  feat.breakout_distance_atr = null;
  if (hh != null && atr20 > 0) {
    feat.breakout_distance_atr = (hh - close) / atr20;
  }

  // ATR compression：atr20 / atr60
  const atr60 = atrApprox(bars, idx, 60);
  feat.atr_compression = (atr20 != null && atr60 > 0) ? atr20 / atr60 : null;

  // Volume compression proxy：sideway_range 小 + volume_ratio 低
  feat.vol_compression = null;
  if (snap.sideway_range != null && snap.volume_ratio != null) {
    feat.vol_compression = (1 / (1 + snap.sideway_range)) * (snap.volume_ratio < 1 ? (1 - snap.volume_ratio) : 0);
  }

  // Cross：RS × market momentum
  feat.rs_x_mkt = null;
  if (feat.rs_20d != null && feat.market_mom_20d != null) {
    feat.rs_x_mkt = feat.rs_20d * feat.market_mom_20d;
  }

  return feat;
}

function firstS4Within(series, i, n) {
  for (let k = 1; k <= n; k++) {
    const row = series[i + k];
    if (!row) return null;
    if (row.primary === 'S4' || row.primary === 'S5') return i + k;
  }
  return null;
}

function persistAfter(series, entryIdx, horizon) {
  if (entryIdx == null) return null;
  let ok = 0;
  let n = 0;
  for (let k = 0; k < horizon; k++) {
    const row = series[entryIdx + k];
    if (!row) break;
    n += 1;
    if (row.primary === 'S4' || row.primary === 'S5') ok += 1;
  }
  if (n < Math.min(5, horizon)) return null;
  return ok / n;
}

function exportPool(meta, codes, role, fromDate, toDate) {
  const benchCode = meta.benchmark && meta.benchmark.code;
  const benchLoad = benchCode ? loadBars(benchCode) : null;
  const benchBars = benchLoad ? benchLoad.bars : null;
  const rows = [];
  const coverage = [];
  let usedFallback = false;

  for (const etf of codes) {
    const loaded = loadBars(etf.code);
    if (!loaded) {
      coverage.push({ code: etf.code, ok: false, role, error: 'missing_csv' });
      continue;
    }
    if (loaded.source !== 'etf_daily_ml_pool') usedFallback = true;
    const bars = loaded.bars;
    process.stderr.write(`[${role}] stage-pass ${etf.code} bars=${bars.length}...\n`);

    const series = new Array(bars.length).fill(null);
    const histSlopes = new Array(bars.length).fill(null);
    const histVr = new Array(bars.length).fill(null);
    let state = {};
    for (let i = 60; i < bars.length; i++) {
      if ((i - 60) % 250 === 0) process.stderr.write(`  ${etf.code} ${i}/${bars.length}\n`);
      const cur = stageAt(bars, i, state);
      if (!cur) continue;
      state = cur.state;
      series[i] = { date: bars[i].trade_date, primary: cur.primary, display: cur.display, snapshot: cur.snapshot };
      histSlopes[i] = cur.snapshot.ma20_slope != null ? cur.snapshot.ma20_slope : null;
      histVr[i] = cur.snapshot.volume_ratio != null ? cur.snapshot.volume_ratio : null;
    }

    let nS2 = 0; let nY5 = 0; let nHvt = 0;
    for (let i = 60; i < bars.length; i++) {
      const row = series[i];
      if (!row) continue;
      const d = row.date;
      if (fromDate && d < fromDate) continue;
      if (toDate && d > toDate) break;
      if (i + 10 >= bars.length) break;
      if (row.primary !== 'S2') continue;
      nS2 += 1;

      const entry = firstS4Within(series, i, 5);
      const y5 = entry != null ? 1 : 0;
      const y_persist10 = persistAfter(series, entry, 10);
      const y_ret10 = fwdRet(bars, i, 10);
      const y_hvt = (
        y5 === 1
        && y_ret10 != null && y_ret10 > HVT.ret10_min
        && y_persist10 != null && y_persist10 >= HVT.persist_min
      ) ? 1 : 0;
      if (y5) nY5 += 1;
      if (y_hvt) nHvt += 1;

      const feats = buildFeatures(row.snapshot, bars, i, benchBars, histSlopes, histVr);
      rows.push({
        code: etf.code,
        name: etf.name,
        sector: etf.sector || '',
        main5: !!etf.main5,
        role,
        date: d,
        stage_t: row.primary,
        y5,
        y_persist10: y_persist10 == null ? '' : +y_persist10.toFixed(4),
        y_ret10: y_ret10 == null ? '' : +y_ret10.toFixed(6),
        y_hvt,
        ...feats,
        data_source: loaded.source
      });
    }
    coverage.push({
      code: etf.code, ok: true, role, source: loaded.source,
      bars: bars.length, s2: nS2, y5: nY5, hvt: nHvt
    });
    process.stderr.write(`  ${etf.code} s2=${nS2} y5=${nY5} hvt=${nHvt}\n`);
  }
  return { rows, coverage, usedFallback };
}

function toCsv(rows) {
  if (!rows.length) return '';
  const keys = Object.keys(rows[0]);
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
  return lines.join('\n') + '\n';
}

function main() {
  const meta = JSON.parse(fs.readFileSync(POOL_JSON, 'utf8'));
  const fromDate = argVal('--from') || '2024-01-01';
  const toDate = argVal('--to') || '2026-08-24';
  const stamp = new Date().toISOString().slice(0, 10);

  const train = exportPool(meta, meta.train_pool, 'train', fromDate, toDate);
  const negCodes = (meta.holdout_negative || []).map((e) => ({ ...e, sector: e.sector || 'gold' }));
  const neg = exportPool(meta, negCodes, 'negative_control', fromDate, toDate);

  const allRows = train.rows.concat(neg.rows);
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const csvPath = path.join(OUT_DIR, `high_value_transition_${stamp}.csv`);
  fs.writeFileSync(csvPath, toCsv(allRows));

  const trainRows = train.rows;
  const n = trainRows.length;
  const y5 = trainRows.filter((r) => r.y5 === 1).length;
  const hvt = trainRows.filter((r) => r.y_hvt === 1).length;
  const summary = {
    stamp,
    hvt_params: HVT,
    n_train_s2: n,
    y5,
    y_hvt: hvt,
    hvt_rate_among_y5: y5 ? hvt / y5 : null,
    coverage: train.coverage.concat(neg.coverage),
    usedFallback: train.usedFallback || neg.usedFallback,
    csv: csvPath
  };
  fs.writeFileSync(
    path.join(OUT_DIR, `high_value_transition_${stamp}.json`),
    JSON.stringify(summary, null, 2)
  );

  const md = [
    '# V4.0 Phase3-A — High-Value Transition 数据集',
    '',
    `日期：${stamp}`,
    '',
    `HVT 阈值：ret10 > ${HVT.ret10_min} 且 persist10 ≥ ${HVT.persist_min}`,
    '',
    `| 指标 | 值 |`,
    `|------|----|`,
    `| Train S2 | ${n} |`,
    `| Y5+ | ${y5} |`,
    `| Y_HVT+ | ${hvt} |`,
    `| HVT / Y5 | ${y5 ? (100 * hvt / y5).toFixed(1) + '%' : '—'} |`,
    '',
    '## Coverage',
    '',
    '| 代码 | role | S2 | Y5 | HVT |',
    '|------|------|----|----|-----|',
    ...summary.coverage.map((c) => (
      c.ok
        ? `| ${c.code} | ${c.role} | ${c.s2} | ${c.y5} | ${c.hvt} |`
        : `| ${c.code} | ${c.role} | — | — | MISSING |`
    )),
    '',
    `文件：\`${csvPath}\``,
    ''
  ].join('\n');
  if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORT_DIR, `V4.0-Phase3A-HVT-Dataset-${stamp}.md`), md);

  console.log(JSON.stringify({
    ok: true, n, y5, hvt, csv: csvPath,
    hvt_of_y5: y5 ? +(hvt / y5).toFixed(3) : null
  }, null, 2));
}

main();
