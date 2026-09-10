/**
 * CloudBase-native Gen-1 EOD runner.
 *
 * It builds the frozen feature schema from official EOD bars, evaluates the
 * exported frozen model locally, and writes observation rows only.  It
 * does not call runDecisionEngine, change portfolio data, or enable execution.
 */
'use strict';

const crypto = require('crypto');
const db = require('./common/utils/db');
const { COLLECTIONS } = require('./common/constants');
const indicators = require('./common/utils/indicators');
const { resolveTrendStage } = require('./common/utils/trend-stage');
const { getCategoryCoverage, capabilityForApi } = require('./common/utils/gen1-capability');
// WP-G1（G1-05/06/07）：Data Health Gate + Domain Permission + Circuit Breaker + 权限状态机
const { resolveAuthority } = require('./common/utils/gen1-authority');
const { evaluateDataHealth } = require('./common/utils/gen1-data-health');
const { evaluateDomainPermission } = require('./common/utils/gen1-domain-permission');
const { computeHealthStatus } = require('./common/utils/gen1-circuit-breaker');
// G1.1-03/04：持久化健康 latch + 经济健康
const {
  readHealthState, writeHealthState, computeLatchedState, healthStateToGate, defaultHealthState
} = require('./common/utils/gen1-health-state');
const manifest = require('./frozen-manifest.json');
const { modelId, predictProbability } = require('./frozen-node-inference');

const MAIN5 = ['513310', '515880', '159582', '518880', '159570'];
const SECTORS = { 513310: 'storage', 515880: 'ai_network', 159582: 'semi_equip', 518880: 'gold', 159570: 'biotech' };
const STAGE_W = { S0: 0.055, S1: 0.225, S2: 0.40, S3: 0.49, S4: 0.635, S5: 0.75 };
const PARAMS = {
  sideway_days: 15, sideway_days_min: 8, sideway_days_mature: 20,
  sideway_range_base: 12, sideway_atr_multiplier: 4, sideway_range_max: 12,
  sideway_range_hard_cap: 15, ma20_slope_flat: 1.5, trend_context_up: 5,
  trend_context_down: -5, volume_ratio: 0.70, volume_ratio_mild: 0.95,
  volume_ratio_high: 1.15, volume_ratio_extreme: 1.5
};

function finite(v) { return Number.isFinite(Number(v)) ? Number(v) : null; }
function retN(bars, index, days) {
  if (index < days || !(bars[index - days].close > 0)) return null;
  return bars[index].close / bars[index - days].close - 1;
}
function clean(v) { return Number.isFinite(v) ? v : null; }
function schemaHash() {
  return crypto.createHash('sha256').update(JSON.stringify({
    features_cat: manifest.features_cat, features_core: manifest.features_core
  })).digest('hex');
}
function decisionHash(day, code, featureHash) {
  return crypto.createHash('sha256').update([
    day, code, 'v3.6.1', manifest.model_id, 'hvt-core-v1', 'hvta-v1',
    'shadow-threshold-v1', 'cal-isotonic-cv3-v1', day, featureHash
  ].join('|')).digest('hex').slice(0, 16);
}

async function officialBars(code) {
  // P1-3 修复：去掉 limit:1000（升序 + limit 会取到「最早 1000 行」，记录超 1000 时 EOD 停在旧日期）。
  // db.query 内部已按 pageSize=100 自动分页拉全量；这里显式去重 (code, trade_date) 并校验最新正式收盘日。
  const rows = await db.query(COLLECTIONS.ETF_DAILY, { code }, {
    orderBy: [{ field: 'trade_date', direction: 'asc' }]
  });
  const seen = new Set();
  return rows
    .filter((r) => r.source !== 'realtime' && r.trade_date && finite(r.close) != null)
    .map((r) => ({
      trade_date: String(r.trade_date).slice(0, 10), open: finite(r.open), high: finite(r.high),
      low: finite(r.low), close: finite(r.close), volume: finite(r.volume)
    }))
    .filter((r) => r.open != null && r.high != null && r.low != null && r.volume != null)
    .filter((r) => {
      if (seen.has(r.trade_date)) return false;
      seen.add(r.trade_date);
      return true;
    });
}

/** 只用于候选信号日后续归因；缺失时不阻断 EOD 推理。 */
async function latestMarketRegime() {
  try {
    const rows = await db.query(COLLECTIONS.PORTFOLIO_SNAPSHOT, {}, {
      orderBy: [{ field: 'snapshot_date', direction: 'desc' }], limit: 1
    });
    return rows && rows[0] && rows[0].market_regime ? String(rows[0].market_regime) : null;
  } catch (e) {
    return null;
  }
}

function latestFeature(code, bars, benchmarkBars) {
  if (bars.length < 60) throw new Error(`${code}: insufficient official EOD bars`);
  let state = {};
  let latest = null;
  for (let index = 60; index < bars.length; index += 1) {
    const hist = bars.slice(0, index + 1);
    const snapshot = indicators.computeSnapshot(hist, PARAMS, { calc_date: bars[index].trade_date });
    const resolved = resolveTrendStage(snapshot, { f_state: 'F3', f_score: 50 }, state, {
      bars: hist,
      params: { v3_6_persistence: true, v3_6_1_s5_downside: true, v3_6_1_enabled: true },
      v3_6_persistence: true
    });
    state = {
      stage: resolved.primaryStage || resolved.stage, overlay: resolved.overlay,
      days_in_stage: resolved.days_in_stage, soft_down_days: resolved.soft_down_days,
      breakout_level: resolved.breakout_level, s4_origin: resolved.s4_origin,
      s5_risk_days: resolved.s5_risk_days
    };
    latest = { index, snapshot, stage: resolved.primaryStage || resolved.stage };
  }
  const { index, snapshot, stage } = latest;
  let rs20 = null;
  if (benchmarkBars && benchmarkBars.length) {
    const benchmarkIndex = benchmarkBars.findIndex((b) => b.trade_date === bars[index].trade_date);
    const own20 = retN(bars, index, 20);
    if (benchmarkIndex >= 20 && own20 != null) {
      const bench20 = retN(benchmarkBars, benchmarkIndex, 20);
      if (bench20 != null) rs20 = own20 - bench20;
    }
  }
  return {
    code, date: bars[index].trade_date, source_trade_date: bars[index].trade_date, stage_t: stage,
    stage, close: bars[index].close, sector: SECTORS[code] || 'NA', history_bars: bars.length,
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

function inferencePayload(row) {
  const out = { code: row.code };
  manifest.features_core.concat(manifest.features_cat).forEach((key) => { out[key] = row[key]; });
  return out;
}

exports.main = async (event = {}) => {
  if (modelId !== manifest.model_id) throw new Error('Frozen Gen-1 model ID mismatch');
  if (event && event.dry_run === true) {
    return { ok: true, model_id: modelId, model_folds: 3, execution_enabled: false };
  }
  const startedAt = Date.now();
  const signalRunId = `gen1-eod-${new Date().toISOString().replace(/[-:.TZ]/g, '')}-${crypto.randomBytes(3).toString('hex')}`;
  const allBars = await Promise.all(MAIN5.map((code) => officialBars(code)));
  const targetDates = allBars.map((bars) => bars.length ? bars[bars.length - 1].trade_date : null);
  if (targetDates.some((date) => !date) || new Set(targetDates).size !== 1) {
    throw new Error(`Main5 official EOD dates are incomplete: ${targetDates.join(',')}`);
  }
  const day = targetDates[0];
  const benchmark = await officialBars('510300').catch(() => []);
  const benchmarkLatestDate = benchmark.length ? benchmark[benchmark.length - 1].trade_date : null;
  const rows = MAIN5.map((code, index) => latestFeature(code, allBars[index], benchmark));
  const marketRegime = await latestMarketRegime();
  const candidates = rows.filter((row) => row.stage_t === 'S2');
  const prediction = new Map(candidates.map((row) => [row.code, predictProbability(inferencePayload(row))]));
  if (candidates.some((row) => finite(prediction.get(row.code)) == null)) {
    throw new Error('Frozen Gen-1 inference produced an invalid probability');
  }

  const featureHash = schemaHash();
  const gen1Authority = resolveAuthority({ ml_shadow_observe: true, ml_advisory_enabled: true, ml_fast_path_enabled: true });

  // ---- G1.1-03/04：持久化健康 latch（跨 CloudBase 冷启动保持）----
  // 先对全部标的算 data/domain（纯计算），取最差数据健康；再与持久化的经济健康合成 → latch → 落库。
  const perRow = rows.map((row) => ({
    row,
    applicability: getCategoryCoverage(row.sector),
    domainPermission: evaluateDomainPermission(row.sector, row.code),
    dataHealth: evaluateDataHealth({
      features: row, mainLatestDate: day, benchmarkLatestDate,
      historyBars: row.history_bars, minHistoryBars: 60
    })
  }));
  const worstData = perRow.reduce((acc, x) => {
    const s = x.dataHealth.status;
    if (s === 'DATA_BLOCKED') return 'BLOCKED';
    if (s === 'DATA_DEGRADED' && acc !== 'BLOCKED') return 'DEGRADED';
    return acc;
  }, 'OK');
  let healthState = null;
  try {
    const prevState = await readHealthState(db, COLLECTIONS);
    const incoming = computeHealthStatus({
      dataHealth: worstData,
      economicHealth: prevState.economic_health || 'PENDING'
    });
    const latched = computeLatchedState(prevState, incoming, { runtimeDataHealth: worstData });
    healthState = await writeHealthState(db, latched.state, COLLECTIONS);
  } catch (e) {
    healthState = defaultHealthState();
  }
  const healthGate = healthStateToGate(healthState);
  const healthStatus = healthState.latched_health;

  for (const item of perRow) {
    const { row, applicability, domainPermission, dataHealth } = item;
    const probability = prediction.get(row.code);
    const modelEligible = row.stage_t === 'S2' && probability != null;
    const mlFast = modelEligible && probability >= manifest.thresholds.signal_p;
    const ruleGate = ['S2', 'S3'].includes(row.stage_t) ? 'PERMIT' : 'BLOCK';
    const rulePermissionReason = ruleGate === 'PERMIT'
      ? 'EOD 阶段预检通过；仍需 Safety Core 复核后才可形成 Fast Path 建议'
      : `EOD 阶段预检：当前阶段 ${row.stage_t} 不属于 S2/S3 观察许可范围`;
    // Fail-closed 组合门：数据 DATA_OK + 域非 OOD + 熔断允许 canary + 阈值 + 预检 + 模型候选（S2 only）
    const modelCandidate = row.stage_t === 'S2' && mlFast;
    const canaryAllowed = modelCandidate
      && dataHealth.status === 'DATA_OK'
      && domainPermission.permission !== 'BLOCK_CANARY'
      && healthGate.allow_canary === true;
    const candidate = canaryAllowed && ruleGate === 'PERMIT';
    await db.upsert(COLLECTIONS.ML_SHADOW_SIGNAL, {
      date: day, source_trade_date: day, code: row.code, stage: row.stage_t,
      category: applicability.category,
      category_coverage: applicability,
      category_coverage_folds: applicability.observed_folds,
      category_coverage_total_folds: applicability.total_folds,
      domain_status: applicability.domain_status,
      domain_status_label: applicability.label,
      domain_status_message: applicability.message,
      // G1-06 域许可（有约束力）
      domain_permission: domainPermission.permission,
      domain_permission_reason_code: domainPermission.reason_code,
      domain_permission_reason: domainPermission.reason,
      domain_warning: domainPermission.warning,
      // G1-05 数据健康
      data_health_status: dataHealth.status,
      data_health_reason_code: dataHealth.reason_code,
      data_health_reason: dataHealth.reason,
      missing_features: dataHealth.missing_features,
      benchmark_latest_date: benchmarkLatestDate,
        // G1-07 熔断（持久化 latch 结果）
        gen1_health_status: healthStatus,
        gen1_health_label: healthGate.label,
        gen1_health_manual_review_required: healthGate.manual_review_required === true,
        gen1_economic_health: healthState.economic_health || 'PENDING',
        canary_allowed: canaryAllowed,
        gen1_model_candidate: modelCandidate,
      // G1-01 权限
      gen1_authority: gen1Authority.gen1_authority,
      market_regime: marketRegime,
      model_capability: capabilityForApi(),
      ml_probability: modelEligible ? probability : null,
      calibrated_probability: modelEligible ? probability : null,
      ml_fast: mlFast, rule_gate: ruleGate, permission_hit: mlFast && ruleGate === 'BLOCK',
      rule_permission_reason_code: ruleGate === 'PERMIT' ? 'EOD_STAGE_PRECHECK_PASS' : 'EOD_STAGE_NOT_ELIGIBLE',
      rule_permission_reason: rulePermissionReason,
      rule_permission_source: 'EOD_STAGE_PRECHECK',
      fast_path_would_trigger: candidate,
      signal_status: candidate ? 'CANDIDATE' : (modelEligible ? 'OBSERVED' : 'NO_OPPORTUNITY'),
      signal_status_reason: canaryAllowed ? null : (dataHealth.reason || domainPermission.reason || null),
      signal_run_id: signalRunId,
      v361_target: STAGE_W[row.stage_t] || STAGE_W.S2,
      ml_counterfactual_target: candidate ? STAGE_W.S4 : (STAGE_W[row.stage_t] || STAGE_W.S2),
      delta_target: candidate ? STAGE_W.S4 - (STAGE_W[row.stage_t] || STAGE_W.S2) : 0,
      decision_hash: decisionHash(day, row.code, featureHash), feature_schema_hash: featureHash,
      model_id: manifest.model_id, ml_model_id: manifest.model_id, ml_effective: false,
      ml_advisory_enabled: true, advisory_effective: candidate, ml_execution_enabled: false,
      updated_at: new Date()
    }, { date: day, code: row.code });
  }
  return { ok: true, source_trade_date: day, signal_run_id: signalRunId, rows: rows.length, candidates: candidates.length,
    fast_path_candidates: rows.filter((r) => prediction.get(r.code) >= manifest.thresholds.signal_p).map((r) => r.code),
    domain_statuses: rows.map((r) => ({ code: r.code, domain_status: getCategoryCoverage(r.sector).domain_status,
      domain_permission: evaluateDomainPermission(r.sector, r.code).permission })),
    data_health: rows.map((r) => ({ code: r.code, status: evaluateDataHealth({ features: r, mainLatestDate: day, benchmarkLatestDate, historyBars: r.history_bars }).status })),
    benchmark_latest_date: benchmarkLatestDate,
    duration_ms: Date.now() - startedAt, execution_enabled: false };
};
