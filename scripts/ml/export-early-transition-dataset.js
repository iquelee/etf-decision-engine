/**
 * V4.0 Phase1 — 因果 Stage 标签 + 特征导出（Early Transition）
 *
 * 不做训练。输出可供 Qlib / 后续建模的事件表。
 *
 * 依赖：deliverables/etf_daily_ml_pool/（先跑 refill-ml-train-pool.py）
 * 回退：若 ml_pool 缺文件，对 Main5 回退 etf_daily_qfq（会标 WARN）。
 *
 * 运行：
 *   node scripts/ml/export-early-transition-dataset.js
 *   node scripts/ml/export-early-transition-dataset.js --from=2024-01-01 --to=2026-08-24
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

const NS = [5, 10];

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

function closeOn(bars, date) {
  const i = bars.findIndex((b) => b.trade_date === date);
  return i >= 0 ? { i, close: bars[i].close } : null;
}

function buildFeatures(snap, bars, idx, benchBars) {
  const close = bars[idx].close;
  const ma20 = snap.ma20;
  const ma60 = snap.ma60;
  const feat = {
    ma20_slope: snap.ma20_slope,
    ma20: ma20,
    ma60: ma60,
    px_ma20: ma20 ? close / ma20 - 1 : null,
    px_ma60: ma60 ? close / ma60 - 1 : null,
    price_position: snap.price_position,
    volume_ratio: snap.volume_ratio,
    sideway_days: snap.sideway_days,
    sideway_range: snap.sideway_range,
    consolidation_score: snap.consolidation_score,
    atr20: snap.atr20,
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

  // Relative strength vs benchmark（同日）
  feat.rs_20d = null;
  if (benchBars && benchBars.length) {
    const b = closeOn(benchBars, bars[idx].trade_date);
    if (b && b.i >= 20) {
      const etf20 = feat.ret_20d;
      const bm20 = retN(benchBars, b.i, 20);
      if (etf20 != null && bm20 != null) feat.rs_20d = etf20 - bm20;
    }
  }
  return feat;
}

function stageAt(bars, idx, state) {
  const today = bars[idx].trade_date;
  const histFull = barsThrough(bars, today);
  // 足够 MA250 / 周线 MA60w；避免全历史 O(n²) 过慢
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

function exportEvents(meta, fromDate, toDate) {
  const benchCode = meta.benchmark && meta.benchmark.code;
  const benchLoad = benchCode ? loadBars(benchCode) : null;
  const benchBars = benchLoad ? benchLoad.bars : null;

  const coverage = [];
  const rows = [];
  let usedFallback = false;

  for (const etf of meta.train_pool) {
    const loaded = loadBars(etf.code);
    if (!loaded) {
      coverage.push({ code: etf.code, ok: false, error: 'missing_csv' });
      continue;
    }
    if (loaded.source !== 'etf_daily_ml_pool') usedFallback = true;
    const bars = loaded.bars;
    process.stderr.write(`stage-pass ${etf.code} bars=${bars.length}...\n`);

    // 单次因果推进整段 Stage 序列（含 hysteresis），再切片取 t+N 标签
    const series = new Array(bars.length).fill(null);
    let state = {};
    const startI = 60;
    for (let i = startI; i < bars.length; i++) {
      if ((i - startI) % 250 === 0) {
        process.stderr.write(`  ${etf.code} ${i}/${bars.length}\n`);
      }
      const cur = stageAt(bars, i, state);
      if (!cur) continue;
      state = cur.state;
      series[i] = {
        date: bars[i].trade_date,
        primary: cur.primary,
        display: cur.display,
        snapshot: cur.snapshot,
        state: { ...state }
      };
    }
    process.stderr.write(`  ${etf.code} stage done\n`);

    let nS2 = 0;
    let nPos5 = 0;
    let nPos10 = 0;
    const maxN = Math.max(...NS);

    for (let i = 60; i < bars.length; i++) {
      const row = series[i];
      if (!row) continue;
      const d = row.date;
      if (fromDate && d < fromDate) continue;
      if (toDate && d > toDate) break;
      if (i + maxN >= bars.length) break;
      if (row.primary !== 'S2') continue;
      nS2 += 1;

      const y5p = series[i + 5] ? series[i + 5].primary : null;
      const y10p = series[i + 10] ? series[i + 10].primary : null;
      const label5 = (y5p === 'S4' || y5p === 'S5') ? 1 : 0;
      const label10 = (y10p === 'S4' || y10p === 'S5') ? 1 : 0;
      if (label5) nPos5 += 1;
      if (label10) nPos10 += 1;

      const feats = buildFeatures(row.snapshot, bars, i, benchBars);
      rows.push({
        code: etf.code,
        name: etf.name,
        sector: etf.sector,
        main5: !!etf.main5,
        date: d,
        stage_t: row.primary,
        stage_display_t: row.display,
        y5_stage: y5p,
        y10_stage: y10p,
        y5: label5,
        y10: label10,
        ...feats,
        data_source: loaded.source
      });
    }
    coverage.push({
      code: etf.code, ok: true, source: loaded.source,
      bars: bars.length, from: bars[0].trade_date, to: bars[bars.length - 1].trade_date,
      s2: nS2, pos5: nPos5, pos10: nPos10
    });
  }

  return { rows, coverage, usedFallback, bench: benchLoad ? benchLoad.source : null };
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

function summarize(rows, coverage, usedFallback) {
  const pos5 = rows.filter((r) => r.y5 === 1).length;
  const pos10 = rows.filter((r) => r.y10 === 1).length;
  const byCode = {};
  for (const r of rows) {
    if (!byCode[r.code]) byCode[r.code] = { n: 0, y5: 0, y10: 0 };
    byCode[r.code].n += 1;
    byCode[r.code].y5 += r.y5;
    byCode[r.code].y10 += r.y10;
  }
  let gate = 'PASS';
  const reasons = [];
  if (usedFallback) {
    gate = 'WARN';
    reasons.push('部分/全部 CSV 回退 etf_daily_qfq，请先 refill ml_pool');
  }
  if (pos5 < 80 || pos10 < 80) {
    gate = 'WARN';
    reasons.push(`正样本不足 pos5=${pos5} pos10=${pos10}（目标≥80）；继续扩池或拉长窗口`);
  }
  if (!rows.length) {
    gate = 'FAIL';
    reasons.push('无 S2 事件');
  }
  const missing = coverage.filter((c) => !c.ok).map((c) => c.code);
  if (missing.length) {
    gate = gate === 'FAIL' ? 'FAIL' : 'WARN';
    reasons.push(`缺 CSV: ${missing.join(',')}`);
  }
  return { gate, reasons, n: rows.length, pos5, pos10, byCode, coverage };
}

function writeReport(summary, stamp, paths) {
  const lines = [];
  lines.push('# V4.0 Phase1 — Early Transition 因果数据集');
  lines.push('');
  lines.push(`日期：${stamp}`);
  lines.push(`闸门：**${summary.gate}**`);
  lines.push('');
  if (summary.reasons.length) {
    summary.reasons.forEach((r) => lines.push(`- ${r}`));
    lines.push('');
  }
  lines.push(`S2 事件：${summary.n}｜Y5+：${summary.pos5}｜Y10+：${summary.pos10}`);
  lines.push('');
  lines.push('| 代码 | S2 | Y5+ | Y10+ | 源 |');
  lines.push('|------|----|-----|------|----|');
  for (const c of summary.coverage) {
    if (!c.ok) {
      lines.push(`| ${c.code} | — | — | — | MISSING |`);
      continue;
    }
    lines.push(`| ${c.code} | ${c.s2} | ${c.pos5} | ${c.pos10} | ${c.source} |`);
  }
  lines.push('');
  lines.push('## 文件');
  lines.push('');
  lines.push(`- 事件表：\`${paths.csv}\``);
  lines.push(`- JSON：\`${paths.json}\``);
  lines.push('');
  lines.push('## 下一步');
  lines.push('');
  lines.push(summary.gate === 'FAIL'
    ? '- 修复缺数后重跑 export'
    : summary.gate === 'WARN'
      ? '- 补齐 ml_pool / 扩窗至正样本≥80 后再开 Qlib 训练'
      : '- 进入 Qlib Walk-Forward（仍走 Challenger Protocol；禁止 Random Split）');
  lines.push('');
  const md = path.join(REPORT_DIR, `V4.0-Phase1-EarlyTransition数据集-${stamp}.md`);
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(md, lines.join('\n'), 'utf8');
  return md;
}

function main() {
  const fromDate = argVal('--from') || '2023-01-01';
  const toDate = argVal('--to') || '2026-08-24';
  const meta = loadPool();
  const { rows, coverage, usedFallback } = exportEvents(meta, fromDate, toDate);
  const summary = summarize(rows, coverage, usedFallback);
  const stamp = new Date().toISOString().slice(0, 10);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(DATASET_DIR, { recursive: true });
  const csvRel = `ml/datasets/early_transition_s2_${stamp}.csv`;
  const jsonRel = `scripts/backtest-out/early-transition-dataset-${stamp}.json`;
  const csvPath = path.join(ROOT, csvRel);
  const jsonPath = path.join(ROOT, jsonRel);
  fs.writeFileSync(csvPath, toCsv(rows), 'utf8');
  fs.writeFileSync(jsonPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    window: { from: fromDate, to: toDate },
    summary,
    sample: rows.slice(0, 5)
  }, null, 2));
  const md = writeReport(summary, stamp, { csv: csvRel, json: jsonRel });

  console.log('════════ Early Transition 因果导出 ════════');
  console.log(`GATE ${summary.gate}  events=${summary.n}  y5+=${summary.pos5}  y10+=${summary.pos10}`);
  if (summary.reasons.length) console.log(summary.reasons.join(' | '));
  console.log(csvPath);
  console.log(md);
  if (summary.gate === 'FAIL') process.exitCode = 2;
}

if (require.main === module) main();
