/**
 * V4.0 Phase 3.5 — HVT Refined Dataset
 * 基于 export-early-transition-dataset.js 因果 Stage 管线扩展。
 *
 * 新增：
 *   y3/y5/y8/y10、ret10_atr、hvt_tier(A/B/C)、y_hvta
 *   rs_accel_5、breakout_approach_5、event_cluster_id
 *
 *   node scripts/ml/export-hvt-refined-dataset.js
 *   node scripts/ml/export-hvt-refined-dataset.js --from=2024-01-01 --to=2026-08-24
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
const OUT_DIR = path.join(ROOT, 'scripts/backtest-out');
const REPORT_DIR = path.join(ROOT, '回测报告');
const DATASET_DIR = path.join(ROOT, 'ml/datasets');

const PARAMS = {
  sideway_days: 15, sideway_days_min: 8, sideway_days_mature: 20,
  sideway_range_base: 12, sideway_atr_multiplier: 4, sideway_range_max: 12, sideway_range_hard_cap: 15,
  ma20_slope_flat: 1.5, trend_context_up: 5, trend_context_down: -5,
  volume_ratio: 0.70, volume_ratio_mild: 0.95, volume_ratio_high: 1.15, volume_ratio_extreme: 1.5
};

const WINDOWS = [3, 5, 8, 10];
const HVT = {
  alpha_atr: 1.0,
  beta_atr: 0.35,
  persist_a: 0.60,
  persist_b: 0.40,
  cluster_gap_days: 10  // used as HVT.cluster_gap_days
};

function argVal(name) {
  const hit = process.argv.find((a) => a.indexOf(name + '=') === 0);
  return hit ? hit.slice(name.length + 1) : null;
}

function loadPool() {
  return JSON.parse(fs.readFileSync(POOL_JSON, 'utf8'));
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

function dayDiff(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
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

function classifyHvt(fast, ret10Atr, persist) {
  if (!fast) return 'C';
  if (ret10Atr == null || persist == null) return 'C';
  if (ret10Atr >= HVT.alpha_atr && persist >= HVT.persist_a) return 'A';
  if (ret10Atr >= HVT.beta_atr && persist >= HVT.persist_b) return 'B';
  return 'C';
}

function exportEvents(meta, fromDate, toDate) {
  const benchCode = meta.benchmark && meta.benchmark.code;
  const benchLoad = benchCode ? loadBars(benchCode) : null;
  const benchBars = benchLoad ? benchLoad.bars : null;

  const coverage = [];
  const rows = [];
  let usedFallback = false;
  let clusterSeq = 0;

  const pool = (meta.train_pool || []).map((e) => ({ ...e, role: 'train' }));
  const neg = (meta.holdout_negative || []).map((e) => ({ ...e, role: 'negative_control' }));
  const allEtfs = pool.concat(neg);

  for (const etf of allEtfs) {
    const loaded = loadBars(etf.code);
    if (!loaded) {
      coverage.push({ code: etf.code, ok: false, role: etf.role, error: 'missing_csv' });
      continue;
    }
    if (loaded.source !== 'etf_daily_ml_pool') usedFallback = true;
    const bars = loaded.bars;
    process.stderr.write(`[${etf.role}] stage-pass ${etf.code} bars=${bars.length}...\n`);

    const series = new Array(bars.length).fill(null);
    const histRs = new Array(bars.length).fill(null);
    const histBd = new Array(bars.length).fill(null);
    const histSlope = new Array(bars.length).fill(null);
    let state = {};
    const startI = 60;
    for (let i = startI; i < bars.length; i++) {
      if ((i - startI) % 250 === 0) process.stderr.write(`  ${etf.code} ${i}/${bars.length}\n`);
      const cur = stageAt(bars, i, state);
      if (!cur) continue;
      state = cur.state;
      const snap = cur.snapshot;
      const close = bars[i].close;
      const atr20 = snap.atr20;
      const hh = hhN(bars, i, 20);

      let rs20 = null;
      const r20 = retN(bars, i, 20);
      if (benchBars && r20 != null) {
        const b = closeOn(benchBars, bars[i].trade_date);
        if (b && b.i >= 20) {
          const bm20 = retN(benchBars, b.i, 20);
          if (bm20 != null) rs20 = r20 - bm20;
        }
      }
      let bd = null;
      if (hh != null && atr20 != null && atr20 > 0) bd = (hh - close) / atr20;

      series[i] = {
        date: bars[i].trade_date,
        primary: cur.primary,
        display: cur.display,
        snapshot: snap,
        atr20,
        rs20,
        bd,
        close
      };
      histRs[i] = rs20;
      histBd[i] = bd;
      histSlope[i] = snap.ma20_slope != null ? snap.ma20_slope : null;
    }
    process.stderr.write(`  ${etf.code} stage done\n`);

    let nS2 = 0;
    const counts = { y3: 0, y5: 0, y8: 0, y10: 0, a: 0, b: 0, c: 0 };
    let lastClusterDate = null;
    let curCluster = null;
    const maxN = Math.max(...WINDOWS, 10);

    for (let i = 60; i < bars.length; i++) {
      const row = series[i];
      if (!row) continue;
      const d = row.date;
      if (fromDate && d < fromDate) continue;
      if (toDate && d > toDate) break;
      if (i + maxN >= bars.length) break;
      if (row.primary !== 'S2') continue;
      nS2 += 1;

      if (lastClusterDate == null || dayDiff(lastClusterDate, d) > HVT.cluster_gap_days) {
        clusterSeq += 1;
        curCluster = `${etf.code}_${clusterSeq}`;
      }
      lastClusterDate = d;

      const yFast = {};
      let entry5 = null;
      for (const w of WINDOWS) {
        const entry = firstS4Within(series, i, w);
        yFast['y' + w] = entry != null ? 1 : 0;
        if (w === 5) entry5 = entry;
        if (entry != null) counts['y' + w] += 1;
      }

      const persist10 = persistAfter(series, entry5, 10);
      const ret10 = fwdRet(bars, i, 10);
      const atrPct = (row.atr20 != null && row.close > 0) ? row.atr20 / row.close : null;
      const ret10Atr = (ret10 != null && atrPct > 0) ? ret10 / atrPct : null;
      const tier = classifyHvt(yFast.y5 === 1, ret10Atr, persist10);
      counts[tier.toLowerCase()] += 1;

      const snap = row.snapshot;
      const close = row.close;
      const ma20 = snap.ma20;
      const ma60 = snap.ma60;

      let rsAccel = null;
      if (i >= 5 && histRs[i] != null && histRs[i - 5] != null) rsAccel = histRs[i] - histRs[i - 5];
      let bdApproach = null;
      if (i >= 5 && histBd[i] != null && histBd[i - 5] != null) bdApproach = histBd[i - 5] - histBd[i];
      let slopeAccel = null;
      if (i >= 5 && histSlope[i] != null && histSlope[i - 5] != null) {
        slopeAccel = histSlope[i] - histSlope[i - 5];
      }

      const r5 = retN(bars, i, 5);
      let rs5 = null;
      if (benchBars && r5 != null) {
        const b = closeOn(benchBars, d);
        if (b && b.i >= 5) {
          const bm5 = retN(benchBars, b.i, 5);
          if (bm5 != null) rs5 = r5 - bm5;
        }
      }
      let marketMom20 = null;
      if (benchBars) {
        const b = closeOn(benchBars, d);
        if (b && b.i >= 20) marketMom20 = retN(benchBars, b.i, 20);
      }

      rows.push({
        code: etf.code,
        name: etf.name,
        sector: etf.sector || '',
        main5: !!etf.main5,
        role: etf.role,
        date: d,
        stage_t: row.primary,
        event_cluster_id: curCluster,
        y3: yFast.y3,
        y5: yFast.y5,
        y8: yFast.y8,
        y10: yFast.y10,
        y_persist10: persist10 == null ? '' : +persist10.toFixed(4),
        y_ret10: ret10 == null ? '' : +ret10.toFixed(6),
        y_ret10_atr: ret10Atr == null ? '' : +ret10Atr.toFixed(4),
        hvt_tier: tier,
        y_hvta: tier === 'A' ? 1 : 0,
        y_hvt_ab: (tier === 'A' || tier === 'B') ? 1 : 0,
        ma20_slope: snap.ma20_slope,
        px_ma20: ma20 ? close / ma20 - 1 : null,
        px_ma60: ma60 ? close / ma60 - 1 : null,
        price_position: snap.price_position,
        volume_ratio: snap.volume_ratio,
        sideway_days: snap.sideway_days,
        sideway_range: snap.sideway_range,
        consolidation_score: snap.consolidation_score,
        atr20: row.atr20,
        change_5d: snap.change_5d,
        bias_20d: snap.bias_20d,
        breakout: snap.breakout === true ? 1 : 0,
        w_state: snap.w_state,
        d_state: snap.d_state,
        h_state: snap.h_state,
        v_state: snap.v_state,
        ret_5d: r5,
        ret_20d: retN(bars, i, 20),
        rs_5d: rs5,
        rs_20d: row.rs20,
        rs_accel_5: rsAccel,
        breakout_distance_atr: row.bd,
        breakout_approach_5: bdApproach,
        slope_accel_5: slopeAccel,
        market_mom_20d: marketMom20,
        vol_compression: (snap.sideway_range != null && snap.volume_ratio != null)
          ? (1 / (1 + snap.sideway_range)) * (snap.volume_ratio < 1 ? (1 - snap.volume_ratio) : 0)
          : null,
        data_source: loaded.source
      });
    }

    coverage.push({
      code: etf.code, ok: true, role: etf.role, source: loaded.source,
      bars: bars.length, s2: nS2, ...counts
    });
    process.stderr.write(
      `  ${etf.code} s2=${nS2} y5=${counts.y5} A=${counts.a} B=${counts.b} C=${counts.c}\n`
    );
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
  const fromDate = argVal('--from') || '2024-01-01';
  const toDate = argVal('--to') || '2026-08-24';
  const meta = loadPool();
  const { rows, coverage, usedFallback } = exportEvents(meta, fromDate, toDate);
  const stamp = new Date().toISOString().slice(0, 10);

  const train = rows.filter((r) => r.role === 'train');
  const n = train.length;
  const y5 = train.filter((r) => r.y5 === 1).length;
  const nA = train.filter((r) => r.hvt_tier === 'A').length;
  const nB = train.filter((r) => r.hvt_tier === 'B').length;
  const nC = train.filter((r) => r.hvt_tier === 'C').length;
  const clusters = new Set(train.map((r) => r.event_cluster_id)).size;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(DATASET_DIR, { recursive: true });
  fs.mkdirSync(REPORT_DIR, { recursive: true });

  const csvRel = `ml/datasets/hvt_refined_${stamp}.csv`;
  const csvPath = path.join(ROOT, csvRel);
  fs.writeFileSync(csvPath, toCsv(rows), 'utf8');

  const summary = {
    stamp,
    window: { from: fromDate, to: toDate },
    hvt_params: HVT,
    usedFallback,
    n_train_s2: n,
    n_clusters: clusters,
    y5,
    hvt_a: nA,
    hvt_b: nB,
    hvt_c: nC,
    a_of_y5: y5 ? nA / y5 : null,
    coverage
  };
  fs.writeFileSync(
    path.join(OUT_DIR, `hvt-refined-dataset-${stamp}.json`),
    JSON.stringify(summary, null, 2)
  );

  const md = [
    '# V4.0 Phase3.5 — HVT Refined Dataset',
    '',
    `日期：${stamp}`,
    '',
    `A：ret10_atr≥${HVT.alpha_atr} & persist≥${HVT.persist_a}；B：ret10_atr≥${HVT.beta_atr} & persist≥${HVT.persist_b}`,
    '',
    '| 指标 | 值 |',
    '|------|----|',
    `| Train S2 | ${n} |`,
    `| Clusters | ${clusters} |`,
    `| Y5+ | ${y5} |`,
    `| HVT-A | ${nA} |`,
    `| HVT-B | ${nB} |`,
    `| HVT-C | ${nC} |`,
    `| A / Y5 | ${y5 ? (100 * nA / y5).toFixed(1) + '%' : '—'} |`,
    `| Fallback | ${usedFallback ? 'WARN' : 'OK'} |`,
    '',
    `文件：\`${csvRel}\``,
    ''
  ].join('\n');
  fs.writeFileSync(path.join(REPORT_DIR, `V4.0-Phase35-HVT-Dataset-${stamp}.md`), md);

  console.log(JSON.stringify({
    ok: true, n, clusters, y5, a: nA, b: nB, c: nC,
    a_of_y5: y5 ? +(nA / y5).toFixed(3) : null, csv: csvPath
  }, null, 2));
}

if (require.main === module) main();
