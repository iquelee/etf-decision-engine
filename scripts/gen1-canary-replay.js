#!/usr/bin/env node
/**
 * Gen-1 Canary Replay（WP-G1 / G1-12）。
 *
 * 在**历史数据**上回放：V3.6.1 基线 vs Gen-1 Canary 反事实。
 * 复用**真实**代码路径：indicators.computeSnapshot → trend-stage.resolveTrendStage →
 * frozen-node-inference.predictProbability → G1-05/06/02 门禁。
 *
 * ⚠️ 诚实标注（Fidelity）：
 *   - risk / fundamental 无历史可恢复 → 固定 NORMAL / F3。因此 Safety BLOCK 统计只反映
 *     authority / 数据 / 域 / 阶段 门，**不含**历史硬风险与 F5。标为 PARTIAL_FIDELITY。
 *   - canary target = min(STAGE_W[S4], 30) 为**上界代理**，未重放完整 V3.6.1 组合约束。
 *   - regime 由 510300 自身 MA20/MA60 状态推导，是**代理**非生产 regime。
 *   - 本脚本仅用于评估，不参与生产。
 *
 * 用法：node scripts/gen1-canary-replay.js [--from 2023-01-01] [--to 2026-09-04]
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const indicators = require(path.join(REPO, 'src/common/utils/indicators.js'));
const { resolveTrendStage } = require(path.join(REPO, 'src/common/utils/trend-stage.js'));
const { predictProbability, modelId } = require(path.join(REPO, 'cloudfunctions/runGen1ShadowEod/frozen-node-inference'));
const manifest = require(path.join(REPO, 'cloudfunctions/runGen1ShadowEod/frozen-manifest.json'));
const { evaluateDataHealth } = require(path.join(REPO, 'src/common/utils/gen1-data-health.js'));
const { evaluateDomainPermission } = require(path.join(REPO, 'src/common/utils/gen1-domain-permission.js'));
const { evaluateGen1Permission } = require(path.join(REPO, 'src/common/utils/gen1-safety-permission.js'));

const DATA_DIR = path.join(REPO, 'deliverables/etf_daily_ml_pool');
const MAIN5 = ['513310', '515880', '159582', '159570', '518880'];
const SECTORS = { 513310: 'storage', 515880: 'ai_network', 159582: 'semi_equip', 518880: 'gold', 159570: 'biotech' };
const STAGE_W = { S0: 0.055, S1: 0.225, S2: 0.40, S3: 0.49, S4: 0.635, S5: 0.75 };
const PARAMS = {
  sideway_days: 15, sideway_days_min: 8, sideway_days_mature: 20,
  sideway_range_base: 12, sideway_atr_multiplier: 4, sideway_range_max: 12,
  sideway_range_hard_cap: 15, ma20_slope_flat: 1.5, trend_context_up: 5,
  trend_context_down: -5, volume_ratio: 0.70, volume_ratio_mild: 0.95,
  volume_ratio_high: 1.15, volume_ratio_extreme: 1.5
};
const MAX_FORWARD = 40;

function arg(name, dflt) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : dflt;
}

function loadBars(code) {
  const file = path.join(DATA_DIR, `${code}_qfq.csv`);
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(',');
  const idx = (name) => header.indexOf(name);
  const iDate = idx('date'); const iO = idx('open'); const iC = idx('close');
  const iH = idx('high'); const iL = idx('low'); const iV = idx('volume');
  return lines.slice(1).map((line) => {
    const p = line.split(',');
    return {
      trade_date: String(p[iDate]).slice(0, 10),
      open: Number(p[iO]), close: Number(p[iC]), high: Number(p[iH]),
      low: Number(p[iL]), volume: Number(p[iV])
    };
  }).filter((b) => Number.isFinite(b.close) && b.close > 0).sort((a, b) => (a.trade_date < b.trade_date ? -1 : 1));
}

function retN(bars, index, days) {
  if (index < days || !(bars[index - days].close > 0)) return null;
  return bars[index].close / bars[index - days].close - 1;
}
function clean(v) { return Number.isFinite(v) ? v : null; }

/** 单次前向扫描：预计算每日快照 + 阶段（避免 O(n³) 重算）。 */
function buildPanel(code, bars) {
  const panel = [];
  let state = {};
  for (let i = 60; i < bars.length; i += 1) {
    const hist = bars.slice(0, i + 1);
    const snapshot = indicators.computeSnapshot(hist, PARAMS, { calc_date: bars[i].trade_date });
    const resolved = resolveTrendStage(snapshot, { f_state: 'F3', f_score: 50 }, state, {
      bars: hist,
      params: { v3_6_persistence: true, v3_6_1_s5_downside: true, v3_6_1_enabled: true },
      v3_6_persistence: true
    });
    state = {
      stage: resolved.primaryStage || resolved.stage, overlay: resolved.overlay,
      days_in_stage: resolved.days_in_stage, soft_down_days: resolved.soft_down_days,
      breakout_level: resolved.breakout_level, s4_origin: resolved.s4_origin, s5_risk_days: resolved.s5_risk_days
    };
    panel.push({ index: i, snapshot, stage: resolved.primaryStage || resolved.stage });
  }
  return panel;
}

/** 由预计算面板构建与 runGen1ShadowEod.latestFeature 字段逐一对应的特征行。 */
function rowFromPanel(code, bars, entry, benchmarkByDate) {
  const { index, snapshot } = entry;
  const date = bars[index].trade_date;
  let rs20 = null;
  const bench = benchmarkByDate.get(date);
  if (bench && bench.index >= 20) {
    const own20 = retN(bars, index, 20);
    const bench20 = retN(bench.bars, bench.index, 20);
    if (own20 != null && bench20 != null) rs20 = own20 - bench20;
  }
  return {
    code, date, source_trade_date: date, stage_t: entry.stage, stage: entry.stage,
    close: bars[index].close, sector: SECTORS[code] || 'NA', history_bars: index + 1,
    ma20_slope: clean(snapshot.ma20_slope),
    px_ma20: snapshot.ma20 ? clean(bars[index].close / snapshot.ma20 - 1) : null,
    px_ma60: snapshot.ma60 ? clean(bars[index].close / snapshot.ma60 - 1) : null,
    price_position: clean(snapshot.price_position), volume_ratio: clean(snapshot.volume_ratio),
    sideway_days: clean(snapshot.sideway_days), sideway_range: clean(snapshot.sideway_range),
    consolidation_score: clean(snapshot.consolidation_score), atr20: clean(snapshot.atr20),
    change_5d: clean(snapshot.change_5d), bias_20d: clean(snapshot.bias_20d),
    breakout: snapshot.breakout === true ? 1 : 0, ret_5d: clean(retN(bars, index, 5)),
    ret_20d: clean(retN(bars, index, 20)), rs_20d: clean(rs20), w_state: snapshot.w_state || 'NA',
    d_state: snapshot.d_state || 'NA', h_state: snapshot.h_state || 'NA', v_state: snapshot.v_state || 'NA'
  };
}

function main() {
  const from = arg('from', '2023-01-01');
  const to = arg('to', '2026-09-04');

  // 字段集守护：评估脚本必须覆盖 frozen-manifest 的全部特征
  const expected = manifest.features_core.concat(manifest.features_cat).sort();
  const benchBars = loadBars('510300');
  const benchByDate = new Map();
  benchBars.forEach((b, i) => benchByDate.set(b.trade_date, { bars: benchBars, index: i }));

  const events = [];
  let candidates = 0;
  const counters = {
    safety_permit: 0, safety_block: 0, safety_unavailable: 0,
    ood_block: 0, data_block: 0, data_degraded: 0,
    canary_change: 0, baseline_s2: 0
  };

  for (const code of MAIN5) {
    const bars = loadBars(code);
    if (bars.length < 80) continue;
    const panel = buildPanel(code, bars);
    const f0 = rowFromPanel(code, bars, panel[0], benchByDate);
    const got = Object.keys(f0).filter((k) => expected.includes(k)).sort();
    if (got.length !== expected.length) {
      throw new Error(`feature field-set drift for ${code}: ${got.length} vs ${expected.length}`);
    }

    for (const entry of panel) {
      const i = entry.index;
      const d = bars[i].trade_date;
      if (d < from || d > to) continue;
      const row = rowFromPanel(code, bars, entry, benchByDate);
      if (row.stage_t !== 'S2') continue;
      counters.baseline_s2 += 1;
      const probability = predictProbability({ code, ...row });
      if (!(probability >= manifest.thresholds.signal_p)) continue;
      candidates += 1;

      const bh = evaluateDataHealth({ features: row, mainLatestDate: d, benchmarkLatestDate: benchByDate.has(d) ? d : null, historyBars: row.history_bars, minHistoryBars: 60 });
      const dm = evaluateDomainPermission(row.sector, code);
      if (bh.status === 'DATA_BLOCKED') counters.data_block += 1;
      if (bh.status === 'DATA_DEGRADED') counters.data_degraded += 1;
      if (dm.permission === 'BLOCK_CANARY') counters.ood_block += 1;

      const perm = evaluateGen1Permission({
        params: { ml_shadow_observe: true, ml_advisory_enabled: true, ml_fast_path_enabled: true, gen1_authority: 'CANARY' },
        signal: { date: d, model_id: modelId, rule_gate: 'PERMIT', calibrated_probability: probability },
        baseline: { trend_stage_primary: row.stage_t, v361_baseline_target: null },
        risk: { risk_override: false, risk_flag: 'NORMAL' }, fundamental: { f_state: 'F3' },
        snapshot: { structural_break: false, hard_break: false },
        today: d, dataHealth: { status: bh.status }, domainPermission: dm
      });
      if (perm.safety.permission === 'PERMIT') counters.safety_permit += 1;
      else if (perm.safety.permission === 'BLOCK') counters.safety_block += 1;
      else counters.safety_unavailable += 1;

      // 阶段权重（Gen-1 口径，pre-cap）：STAGE_W 是阶段权重，不是最终仓位 %。
      // 生产 target % 需完整 V3.6.1 组合约束（本回放不重放），故此处只报权重口径。
      const baselineWeight = STAGE_W[row.stage_t];
      let canaryWeight = baselineWeight;
      if (perm.effective_canary) {
        canaryWeight = STAGE_W.S4;
        counters.canary_change += 1;
      }

      // 前瞻：20/40D 自身收益 + 相对 510300 超额
      const fwd = {};
      for (const h of [20, 40]) {
        if (i + h < bars.length) {
          fwd[`ret${h}`] = bars[i + h].close / bars[i].close - 1;
          const bi = benchByDate.get(d);
          if (bi && bi.index + h < benchBars.length) {
            fwd[`exc${h}`] = fwd[`ret${h}`] - (benchBars[bi.index + h].close / benchBars[bi.index].close - 1);
          }
        }
      }
      let mae = null; let mfe = null;
      for (let k = 1; k <= 20 && i + k < bars.length; k += 1) {
        const r = bars[i + k].close / bars[i].close - 1;
        mae = mae == null ? r : Math.min(mae, r);
        mfe = mfe == null ? r : Math.max(mfe, r);
      }
      // regime 代理：510300 自身 MA20/MA60 关系
      let regime = 'RANGE';
      const bi2 = benchByDate.get(d);
      if (bi2 && bi2.index >= 60) {
        const b = benchBars; const idx = bi2.index;
        const ma20 = b.slice(idx - 19, idx + 1).reduce((s, x) => s + x.close, 0) / 20;
        const ma60 = b.slice(idx - 59, idx + 1).reduce((s, x) => s + x.close, 0) / 60;
        regime = b[idx].close > ma20 && ma20 > ma60 ? 'BULL' : (b[idx].close < ma20 && ma20 < ma60 ? 'RISK_OFF' : 'RANGE');
      }

      events.push({
        code, date: d, regime, probability, stage: row.stage_t,
        data_health: bh.status, data_reason: bh.reason_code, domain: dm.permission,
        safety: perm.safety.permission, safety_reason: perm.safety.reason_code,
        baseline_stage_weight: baselineWeight, canary_stage_weight: canaryWeight,
        stage_weight_delta: canaryWeight - baselineWeight,
        canary_effective: perm.effective_canary,
        ...fwd, mae, mfe
      });
    }
  }

  // 独立事件：同 code 间隔 >= 40 交易日
  const byCode = {};
  events.forEach((e) => { (byCode[e.code] = byCode[e.code] || []).push(e); });
  let independent = 0;
  const allDays = [...new Set(events.map((e) => e.date))].sort();
  const dayIdx = new Map(allDays.map((d, i) => [d, i]));
  for (const list of Object.values(byCode)) {
    list.sort((a, b) => (a.date < b.date ? -1 : 1));
    let last = -Infinity;
    for (const e of list) {
      const gi = dayIdx.get(e.date);
      if (gi - last >= MAX_FORWARD) { independent += 1; last = gi; }
    }
  }

  const changed = events.filter((e) => e.canary_effective);
  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  const exc20 = changed.map((e) => e.exc20).filter((v) => Number.isFinite(v));
  const exc40 = changed.map((e) => e.exc40).filter((v) => Number.isFinite(v));
  const falseFast = exc20.filter((v) => v < 0).length;
  const timingGain = changed.reduce((s, e) => s + e.stage_weight_delta, 0);
  const maeAll = changed.map((e) => e.mae).filter(Number.isFinite);
  const mfeAll = changed.map((e) => e.mfe).filter(Number.isFinite);
  // Incremental MDD 代理：等权 canary 事件的 20D 权益路径最大回撤
  let eq = 1; let peak = 1; let mdd = 0;
  for (const e of changed) { eq *= (1 + (Number.isFinite(e.ret20) ? e.ret20 : 0)); peak = Math.max(peak, eq); mdd = Math.min(mdd, eq / peak - 1); }

  const byRegime = {};
  for (const rg of ['BULL', 'RANGE', 'RISK_OFF']) {
    const list = events.filter((e) => e.regime === rg);
    const ch = list.filter((e) => e.canary_effective);
    byRegime[rg] = {
      events: list.length, canary_effective: ch.length,
      mean_exc20: mean(ch.map((e) => e.exc20).filter(Number.isFinite)),
      false_fast_path: ch.filter((e) => Number.isFinite(e.exc20) && e.exc20 < 0).length
    };
  }
  const byCodeOut = {};
  for (const code of MAIN5) {
    const list = events.filter((e) => e.code === code);
    byCodeOut[code] = {
      events: list.length,
      canary_effective: list.filter((e) => e.canary_effective).length,
      ood_block: list.filter((e) => e.domain === 'BLOCK_CANARY').length,
      data_block: list.filter((e) => e.data_health === 'DATA_BLOCKED').length
    };
  }

  const summary = {
    engine: 'gen1-canary-replay-v1', model_id: modelId,
    window: { from, to }, fidelity: 'PARTIAL_FIDELITY',
    fidelity_notes: [
      'risk/fundamental 无历史 → 固定 NORMAL/F3；Safety BLOCK 不含历史硬风险与 F5。',
      'canary target = min(STAGE_W[S4], 30%) 为上界代理，未重放完整 V3.6.1 组合约束。',
      'regime 由 510300 MA20/MA60 推导（代理，非生产 regime）。'
    ],
    counts: {
      baseline_s2_days: counters.baseline_s2,
      candidates: candidates,
      independent_events: independent,
      safety_permit: counters.safety_permit,
      safety_block: counters.safety_block,
      safety_unavailable: counters.safety_unavailable,
      ood_block: counters.ood_block,
      data_block: counters.data_block,
      data_degraded: counters.data_degraded,
      canary_change: counters.canary_change
    },
    timing: {
      timing_gain_weight_sum: Number(timingGain.toFixed(4)),
      mean_stage_weight_delta: mean(changed.map((e) => e.stage_weight_delta)),
      false_fast_path: falseFast,
      false_fast_path_rate: exc20.length ? Number((falseFast / exc20.length).toFixed(4)) : null,
      incremental_return_20d_mean: mean(exc20),
      incremental_return_40d_mean: mean(exc40),
      mae_mean: mean(maeAll), mfe_mean: mean(mfeAll),
      incremental_mdd_proxy: Number(mdd.toFixed(4))
    },
    unit_note: 'stage weight（Gen-1 阶段权重，pre-cap）；不是最终仓位 %。生产 target 需完整 V3.6.1 组合约束（未重放）。',
    by_regime: byRegime,
    by_code: byCodeOut
  };

  const outPath = path.join(REPO, 'docs/gen1/gen1_canary_replay_20260910.json');
  fs.writeFileSync(outPath, JSON.stringify({ summary, events }, null, 2) + '\n', 'utf8');

  console.log('\n== G1-12 Gen-1 Canary Replay ==');
  console.log(`   window ${from} → ${to}   fidelity=${summary.fidelity}`);
  console.log('   counts:', JSON.stringify(summary.counts));
  console.log('   timing:', JSON.stringify(summary.timing));
  console.log('   by_regime:', JSON.stringify(summary.by_regime));
  console.log('   by_code:', JSON.stringify(summary.by_code));
  console.log(`   [OK] ${path.relative(REPO, outPath)}`);
}

main();
