/**
 * 云函数：runGen2ShadowEod —— Gen-2 Cross-ETF Leadership / Rotation Shadow 观测器
 *
 * 职责（只读，绝不改生产仓位）：
 *   1. 读线上 etf_daily 的 universe 日线；
 *   2. 计算 Gen-2 特征 → leadership_score → 横截面 rank；
 *   3. 角色状态机（Core/Challenger/Reserve + hedge + 滞后 + cluster cap）；
 *   4. 组合候选（CORE 等权）+ 防守闸门（MA60 regime + vol target）；
 *   5. 全部写 gen2_shadow 集合（type=gen2_ranking / gen2_run），供状态包导出与后续判断。
 *
 * 与 Gen-1 / V3.6.1 完全隔离：本函数不调用 runDecisionEngine、不写 decision_result、
 * 不写 portfolio_position / portfolio_snapshot，仅产生观测数据。
 *
 * 适配说明：线上 etf_daily 当前只有 5 只主 ETF、无 benchmark 510300，
 * 故 benchmark 用 universe 等权组合收益作代理（rs 与防守 regime 均基于等权基准）。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./common/utils/db');
const { COLLECTIONS } = require('./common/constants');

// Gen-2 Rule V2 单一真相源：优先从 bundle 读（build 时由 build-cloudfunctions.js 复制到本目录），
// 缺失（本地直跑 / 未 build）则 fallback 硬编码（与 ml/gen2/manifests/GEN2_RULE_V2_BUNDLE.json 一致）。
let _bundle = null;
let _bundle_sha256 = null;
try {
  const _raw = fs.readFileSync(path.join(__dirname, 'GEN2_RULE_V2_BUNDLE.json'), 'utf8');
  _bundle = JSON.parse(_raw);
  _bundle_sha256 = crypto.createHash('sha256').update(_raw).digest('hex');
} catch (e) { /* bundle 缺失，用硬编码 fallback */ }

const ENGINE_ID = (_bundle && _bundle.engine_id) || 'gen2-rule-v2';
const BUNDLE_VERSION = (_bundle && _bundle.bundle_version) || 'gen2-rule-v2.0';

// Gen-2 universe_v1（30 只候选 + benchmark 510300）。
// 研究选池（selection_universe）≠ 生产（production_enabled，仅 Main5）。
const UNIVERSE = {
  version: 'universe_v1',
  benchmark_code: '510300', // 沪深300 ETF（真实 benchmark）
  target_size: 30,
  eligible_codes: ['513310', '515880', '159582', '518880', '159570', '588000', '588080', '512480', '159995', '512760', '515050', '159819', '159915', '159992', '159770', '159852', '512010', '512690', '159928', '510880', '512800', '512000', '512660', '515030', '515790', '512400', '515220', '513180', '159941', '513500'],
  name: {
    '513310': '中韩半导体ETF',
    '515880': '通信ETF',
    '159582': '半导体设备ETF',
    '518880': '黄金ETF',
    '159570': '港股通创新药ETF',
    '588000': '科创50ETF',
    '588080': '科创板50ETF',
    '512480': '半导体ETF',
    '159995': '芯片ETF',
    '512760': '芯片产业ETF',
    '515050': '5G通信ETF',
    '159819': '人工智能ETF',
    '159915': '创业板ETF',
    '159992': '创新药ETF',
    '159770': '机器人ETF',
    '159852': '软件ETF',
    '512010': '医药ETF',
    '512690': '酒ETF',
    '159928': '消费ETF',
    '510880': '红利ETF',
    '512800': '银行ETF',
    '512000': '券商ETF',
    '512660': '军工ETF',
    '515030': '新能源车ETF',
    '515790': '光伏ETF',
    '512400': '有色金属ETF',
    '515220': '煤炭ETF',
    '513180': '恒生科技ETF',
    '159941': '纳指ETF',
    '513500': '标普500ETF'
  },
  cluster: {
    '513310': 'tech_hardware',
    '515880': 'tech_hardware',
    '159582': 'tech_hardware',
    '518880': 'gold_commodity',
    '159570': 'healthcare',
    '588000': 'growth_broad',
    '588080': 'growth_broad',
    '512480': 'tech_hardware',
    '159995': 'tech_hardware',
    '512760': 'tech_hardware',
    '515050': 'tech_hardware',
    '159819': 'software_ai',
    '159915': 'growth_broad',
    '159992': 'healthcare',
    '159770': 'software_ai',
    '159852': 'software_ai',
    '512010': 'healthcare',
    '512690': 'consumer',
    '159928': 'consumer',
    '510880': 'defensive_dividend',
    '512800': 'financial',
    '512000': 'financial',
    '512660': 'cyclical_resources',
    '515030': 'cyclical_resources',
    '515790': 'cyclical_resources',
    '512400': 'cyclical_resources',
    '515220': 'cyclical_resources',
    '513180': 'overseas_equity',
    '159941': 'overseas_equity',
    '513500': 'overseas_equity'
  },
  strategic_role_hint: {
    '518880': 'hedge' // 黄金固定防守资产；红利/海外按排名竞争 CORE
  },
  incumbent: ['513310', '515880', '159582', '518880', '159570']
};

// 领导力评分权重（与 ml/gen2/baseline/leadership_score.py DEFAULT_WEIGHTS 一致；V1 复合，仅保留作历史对照字段）
const LEADERSHIP_WEIGHTS = {
  trend: 0.20, rs: 0.25, stage: 0.15, momentum: 0.10, consolidation: 0.10,
  breakout: 0.05, volatility: 0.05, liquidity: 0.05, diversification: 0.05
};

// Gen-2 Rule V2 配置：单一真相源 GEN2_RULE_V2_BUNDLE（缺失时 fallback 硬编码，值与 bundle 一致）
const _sel = (_bundle && _bundle.selection) || {};
const _pf = (_bundle && _bundle.portfolio) || {};
const _def = (_bundle && _bundle.defense) || {};
const _reg = (_bundle && _bundle.regime) || {};
const _alpha = (_bundle && _bundle.alpha) || {};

// AlphaScore-v2 权重（与 ml/gen2/baseline/alpha_score.py ALPHA_WEIGHTS_V2 一致）
// F02：V2 用「找赢家(Alpha)」与「控风险(Utility)」分离，Alpha = Trend + RS + Breakout 等权。
const ALPHA_WEIGHTS_V2 = {
  trend: _alpha.trend != null ? _alpha.trend : 1 / 3,
  rs: _alpha.rs != null ? _alpha.rs : 1 / 3,
  breakout: _alpha.breakout != null ? _alpha.breakout : 1 / 3
};

// 角色状态机参数（与 config/gen2.yaml portfolio 一致）
const PORTFOLIO_CFG = {
  promotion_persistence_days: _sel.promotion_persistence_days != null ? _sel.promotion_persistence_days : 5,
  demotion_persistence_days: _sel.demotion_persistence_days != null ? _sel.demotion_persistence_days : 5,
  max_core_count: _sel.max_core_count != null ? _sel.max_core_count : 5,
  max_core_per_cluster: _sel.max_core_per_cluster != null ? _sel.max_core_per_cluster : 2,
  top_quantile: _sel.top_quantile != null ? _sel.top_quantile : 0.2,
  min_replacement_edge: _sel.min_replacement_edge != null ? _sel.min_replacement_edge : 8.0,
  max_single_weight: _pf.max_single_weight != null ? _pf.max_single_weight : 0.25,
  max_cluster_weight: _pf.max_cluster_weight != null ? _pf.max_cluster_weight : 0.40,
  max_tech_weight: _pf.max_tech_weight != null ? _pf.max_tech_weight : 0.65,
  tech_clusters: _pf.tech_clusters || ['tech_hardware', 'software_ai']
};

// 防守参数（与 portfolio/defense_gate.py DEFAULT_DEFENSE 一致）
// F02：regime 统一用 market_score 55/45 契约（与 ml/gen2/portfolio/regime.py 一致），替代 MA60<-2% 硬编码。
const DEFENSE_CFG = {
  enabled: true,
  risk_off_exposure_scale: _def.risk_off_exposure_scale != null ? _def.risk_off_exposure_scale : 0.50,
  risk_off_hedge_weight: _def.risk_off_hedge_weight != null ? _def.risk_off_hedge_weight : 0.15,
  hedge_code: _def.hedge_code || '518880',
  market_score_risk_on_ge: _reg.risk_on_ge != null ? _reg.risk_on_ge : 55,
  market_score_risk_off_le: _reg.risk_off_le != null ? _reg.risk_off_le : 45,
  vol_target_enabled: _def.vol_target_enabled != null ? _def.vol_target_enabled : true,
  vol_target_annualized: _def.vol_target_annualized != null ? _def.vol_target_annualized : 0.17
};

const CORE_PCT = _sel.core_pct != null ? _sel.core_pct : 0.80;
const CHALLENGER_PCT = _sel.challenger_pct != null ? _sel.challenger_pct : 0.70;
const SATELLITE_PCT = _sel.satellite_pct != null ? _sel.satellite_pct : 0.60;

/* ---------------- 统一 Regime 契约（与 ml/gen2/portfolio/regime.py 一致） ---------------- */

/** 连续市场评分（0-100），由 benchmark 沪深300 的 MA20/MA60 偏离合成 */
function marketScore(benchmark_px_ma20, benchmark_px_ma60) {
  return 50.0 + 500.0 * (benchmark_px_ma20 + benchmark_px_ma60);
}

/** 单一 regime 分类：RISK_ON >=55 / RISK_OFF <=45 / 其余 RANGE（NaN 归 RANGE） */
function classifyRegime(score) {
  if (score == null || Number.isNaN(score)) return 'RANGE';
  if (score >= DEFENSE_CFG.market_score_risk_on_ge) return 'RISK_ON';
  if (score <= DEFENSE_CFG.market_score_risk_off_le) return 'RISK_OFF';
  return 'RANGE';
}

/** Selection Permission：ACTIVE / REDUCED / DISABLED（§6.1 拆开） */
function selectionMode(score) {
  const reg = classifyRegime(score);
  if (reg === 'RISK_ON') return 'ACTIVE';
  if (reg === 'RISK_OFF') return 'DISABLED';
  return 'REDUCED';
}

/** 是否允许新晋升/新替换。DISABLED(RISK_OFF) 时禁止新晋升，但不清现任 CORE。 */
function promotionAllowed(score) {
  return selectionMode(score) !== 'DISABLED';
}

/** 晋升后允许的 CORE 数量上限；DISABLED 返回 null（不强制减少现任 CORE 数量） */
function maxCoreCount(score, base) {
  const mode = selectionMode(score);
  if (mode === 'ACTIVE') return base;
  if (mode === 'REDUCED') return 3;
  return null; // DISABLED：仅禁晋升，不清现任
}

/**
 * 选择可信度（非 ML probability，而是数据/系统层面的可信度）：
 * - FULL：universe ≥15 且 coverage ≥90%
 * - DEGRADED：universe ≥15 但 coverage 不足
 * - LIMITED：universe <15（小样本，仅管道验证，不产出生产级结论）
 */
function computeSelectionConfidence(rankedCount, targetSize) {
  if (rankedCount < 15) return { selection_confidence: 'LIMITED', confidence_reason: 'SMALL_UNIVERSE' };
  const coverage = targetSize ? rankedCount / targetSize : 1;
  if (coverage < 0.9) return { selection_confidence: 'DEGRADED', confidence_reason: `LOW_COVERAGE_${Math.round(coverage * 100)}pct` };
  return { selection_confidence: 'FULL', confidence_reason: null };
}

/** 角色分类：小样本 universe 显式标注，避免把 CORE 当成生产级结论 */
function roleClassification(rankedCount) {
  return rankedCount < 15 ? 'LIMITED_UNIVERSE' : 'STANDARD';
}

/* ---------------- 数值工具 ---------------- */

function mean(arr) {
  if (!arr || !arr.length) return null;
  let s = 0;
  let c = 0;
  for (const v of arr) {
    if (v == null || !Number.isFinite(v)) continue; // 忽略 null/非有限值
    s += v;
    c += 1;
  }
  return c ? s / c : null;
}

function std(arr) {
  if (!arr || arr.length < 2) return null;
  const vs = arr.filter((v) => v != null && Number.isFinite(v));
  if (vs.length < 2) return null;
  const m = mean(vs);
  let s = 0;
  for (const v of vs) s += (v - m) * (v - m);
  return Math.sqrt(s / (vs.length - 1));
}

/** 滚动均值：返回与输入等长数组，前 n-1 个为 null */
function rollingMean(arr, n) {
  const out = new Array(arr.length).fill(null);
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
    if (i >= n) sum -= arr[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

/** 滚动标准差 */
function rollingStd(arr, n) {
  const out = new Array(arr.length).fill(null);
  for (let i = n - 1; i < arr.length; i++) {
    out[i] = std(arr.slice(i - n + 1, i + 1));
  }
  return out;
}

/** pct_change(n)：arr[i] / arr[i-n] - 1 */
function pctChange(arr, n) {
  const out = new Array(arr.length).fill(null);
  for (let i = n; i < arr.length; i++) {
    if (arr[i - n] && arr[i - n] !== 0) out[i] = arr[i] / arr[i - n] - 1;
  }
  return out;
}

/** 滚动最大值 / 最小值 */
function rollingMax(arr, n) {
  const out = new Array(arr.length).fill(null);
  for (let i = n - 1; i < arr.length; i++) {
    let m = -Infinity;
    for (let j = i - n + 1; j <= i; j++) if (arr[j] > m) m = arr[j];
    out[i] = m;
  }
  return out;
}
function rollingMin(arr, n) {
  const out = new Array(arr.length).fill(null);
  for (let i = n - 1; i < arr.length; i++) {
    let m = Infinity;
    for (let j = i - n + 1; j <= i; j++) if (arr[j] < m) m = arr[j];
    out[i] = m;
  }
  return out;
}

/** 连续 True 计数（按时间正序，每个 code 内部） */
function consecutiveTrue(flags) {
  const out = [];
  let c = 0;
  for (const v of flags) {
    c = v ? c + 1 : 0;
    out.push(c);
  }
  return out;
}

/** 20 日最大回撤 */
function maxDrawdown20(close, i) {
  const start = Math.max(0, i - 19);
  let peak = -Infinity;
  let mdd = 0;
  for (let j = start; j <= i; j++) {
    if (close[j] > peak) peak = close[j];
    const dd = close[j] / peak - 1;
    if (dd < mdd) mdd = dd;
  }
  return mdd;
}

/** Pearson 相关系数（忽略 null） */
function pearson(xs, ys) {
  const pairs = [];
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] != null && ys[i] != null) pairs.push([xs[i], ys[i]]);
  }
  if (pairs.length < 2) return null;
  const n = pairs.length;
  let mx = 0, my = 0;
  for (const p of pairs) { mx += p[0]; my += p[1]; }
  mx /= n; my /= n;
  let cov = 0, vx = 0, vy = 0;
  for (const p of pairs) {
    const dx = p[0] - mx, dy = p[1] - my;
    cov += dx * dy; vx += dx * dx; vy += dy * dy;
  }
  if (vx === 0 || vy === 0) return null;
  return cov / Math.sqrt(vx * vy);
}

/** 滚动 Pearson 相关（窗口 n，前 n-1 个为 null） */
function rollingCorr(x, y, n) {
  const out = new Array(x.length).fill(null);
  for (let i = n - 1; i < x.length; i++) {
    out[i] = pearson(x.slice(i - n + 1, i + 1), y.slice(i - n + 1, i + 1));
  }
  return out;
}

/** 交易日字符串规范化（取 YYYY-MM-DD 前缀） */
function dateKey(d) { return String(d == null ? '' : d).slice(0, 10); }

/** 唯一交易日去重 + 升序排序。返回唯一日期数组（无重复）。 */
function uniqueTradeDates(bars) {
  const seen = new Set();
  const out = [];
  for (const b of bars || []) {
    const d = dateKey(b.trade_date);
    if (!d) continue;
    if (seen.has(d)) continue;
    seen.add(d);
    out.push(d);
  }
  out.sort();
  return out;
}

/** 按 (code, trade_date) 去重（保留首条），返回新数组 */
function dedupByDate(bars) {
  const seen = new Set();
  const out = [];
  for (const b of bars || []) {
    const d = dateKey(b.trade_date);
    if (!d || seen.has(d)) continue;
    seen.add(d);
    out.push(b);
  }
  return out;
}

/** 过滤出有限值索引与值（供横截面排名排除 null/NaN） */
function finiteIndexValues(values) {
  const idx = [];
  const vals = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v != null && Number.isFinite(v)) { idx.push(i); vals.push(v); }
  }
  return { idx, vals };
}

/** 横截面百分位（0-100）。ascending=true：值越大 pct 越高；false：值越小 pct 越高。tie 取平均排名（对齐 pandas rank(pct=True, method='average')）。
 *  P0-1：null/非有限值位置返回 null（不参与排名），其余按有效值排名。 */
function crossSectionalPct(values, ascending = true) {
  const n = values.length;
  const { idx: validIdx, vals: validVals } = finiteIndexValues(values);
  const m = validVals.length;
  if (m === 0) return new Array(n).fill(null);
  const sorted = validVals.map((v, i) => i).sort((a, b) => validVals[a] - validVals[b]);
  const rank = new Array(m);
  let i = 0;
  while (i < m) {
    let j = i;
    while (j + 1 < m && validVals[sorted[j + 1]] === validVals[sorted[i]]) j++;
    const avgRank = (i + 1 + j + 1) / 2; // 升序位置 i+1..j+1 的平均（tie 取平均）
    for (let k = i; k <= j; k++) rank[sorted[k]] = avgRank;
    i = j + 1;
  }
  const out = new Array(n).fill(null);
  for (let k = 0; k < m; k++) {
    const orig = validIdx[k];
    const p = ascending ? rank[k] : (m - rank[k] + 1);
    out[orig] = (p / m) * 100;
  }
  return out;
}

/* ---------------- 特征计算 ---------------- */

/** 对单只 ETF 的时间序列计算特征（忠实移植 build_features.compute_time_series_features） */
function computeTimeSeriesFeatures(bars) {
  // bars 已按 trade_date 升序
  const close = bars.map((b) => Number(b.close));
  const high = bars.map((b) => Number(b.high));
  const low = bars.map((b) => Number(b.low));
  const volume = bars.map((b) => Number(b.volume) || 0);
  const amount = bars.map((b) => Number(b.amount) || (Number(b.volume) * Number(b.close)) || 0);

  const ret1 = pctChange(close, 1);
  const ret5 = pctChange(close, 5);
  const ret20 = pctChange(close, 20);
  const ret60 = pctChange(close, 60);

  const ma20 = rollingMean(close, 20);
  const ma60 = rollingMean(close, 60);
  const ma20Shift5 = new Array(close.length).fill(null);
  const ma60Shift10 = new Array(close.length).fill(null);
  for (let i = 5; i < close.length; i++) ma20Shift5[i] = ma20[i - 5];
  for (let i = 10; i < close.length; i++) ma60Shift10[i] = ma60[i - 10];

  const hh20 = rollingMax(high, 20);
  const ll20 = rollingMin(low, 20);
  const volMa20 = rollingMean(volume, 20);
  const volMa5 = rollingMean(volume, 5);

  // 前 60 日最高（shift 1）
  const prevHigh60 = new Array(close.length).fill(null);
  for (let i = 1; i < close.length; i++) {
    let m = -Infinity;
    const start = Math.max(0, i - 60);
    for (let j = start; j < i; j++) if (high[j] > m) m = high[j];
    prevHigh60[i] = m;
  }

  const ret1Std20 = rollingStd(ret1, 20);
  const amountMa20 = rollingMean(amount, 20);
  const amountMa60 = rollingMean(amount, 60);

  const feat = bars.map((b, i) => {
    const pxMa20 = ma20[i] && ma20[i] !== 0 ? close[i] / ma20[i] - 1 : null;
    const pxMa60 = ma60[i] && ma60[i] !== 0 ? close[i] / ma60[i] - 1 : null;
    const ma20Slope5 = ma20Shift5[i] && ma20Shift5[i] !== 0 ? ma20[i] / ma20Shift5[i] - 1 : null;
    const ma60Slope10 = ma60Shift10[i] && ma60Shift10[i] !== 0 ? ma60[i] / ma60Shift10[i] - 1 : null;
    const sidewayRange = hh20[i] && ll20[i] && ll20[i] !== 0 ? hh20[i] / ll20[i] - 1 : null;
    const volumeRatio520 = volMa20[i] && volMa20[i] !== 0 ? (volMa5[i] || 0) / volMa20[i] : null;
    const breakoutDistance = prevHigh60[i] && prevHigh60[i] !== 0 ? close[i] / prevHigh60[i] - 1 : null;

    // ATR20
    let atr20 = null;
    if (i >= 19) {
      let s = 0;
      for (let j = i - 19; j <= i; j++) {
        const pc = j > 0 ? close[j - 1] : close[j];
        const tr = Math.max(high[j] - low[j], Math.abs(high[j] - pc), Math.abs(low[j] - pc));
        s += tr;
      }
      atr20 = close[i] !== 0 ? (s / 20) / close[i] : null;
    }

    const realizedVol20 = ret1Std20[i] != null ? ret1Std20[i] * Math.sqrt(252) : null;
    const mdd20 = i >= 19 ? maxDrawdown20(close, i) : null;

    return {
      trade_date: b.trade_date,
      code: b.code,
      history_days: i + 1,
      ret_1d: ret1[i], ret_5d: ret5[i], ret_20d: ret20[i], ret_60d: ret60[i],
      px_ma20: pxMa20, px_ma60: pxMa60,
      ma20_slope_5d: ma20Slope5, ma60_slope_10d: ma60Slope10,
      momentum_accel_5_20: ret5[i] != null && ret20[i] != null ? ret5[i] - ret20[i] : null,
      sideway_range: sidewayRange,
      sideway_days: null, // 下面统一填
      volume_ratio_5_20: volumeRatio520,
      breakout_distance: breakoutDistance,
      atr20_pct: atr20,
      realized_vol20: realizedVol20,
      max_drawdown_20d: mdd20,
      avg_amount_20d: amountMa20[i],
      avg_amount_60d: amountMa60[i]
    };
  });

  // sideway_days：连续 sideway_range <= 0.15 天数
  const sidewayFlags = feat.map((f) => f.sideway_range != null && f.sideway_range <= 0.15);
  const sidewayDays = consecutiveTrue(sidewayFlags);
  feat.forEach((f, i) => { f.sideway_days = sidewayDays[i]; });

  return feat;
}

/** 用 benchmark（510300）真实特征计算相对强度 rs 与防守 regime（与 Python 版 benchmark_code=510300 一致） */
function addBenchmark(features, benchmarkFeatures) {
  // benchmarkFeatures 是 510300 的特征（已按 trade_date 升序）
  const benchByDate = {};
  for (const b of benchmarkFeatures) {
    benchByDate[b.trade_date] = b;
  }

  const byCodeDate = {};
  for (const f of features) {
    const bench = benchByDate[f.trade_date];
    f.rs20_vs_benchmark = f.ret_20d != null && bench && bench.ret_20d != null ? f.ret_20d - bench.ret_20d : null;
    f.rs60_vs_benchmark = f.ret_60d != null && bench && bench.ret_60d != null ? f.ret_60d - bench.ret_60d : null;
    f.benchmark_px_ma60 = bench ? bench.px_ma60 : null;
    f.benchmark_px_ma20 = bench ? bench.px_ma20 : null;
    // rs_accel_5d：rs20 的 5 日差分（按 code 正序，稍后统一算）
    (byCodeDate[f.code] = byCodeDate[f.code] || []).push(f);
  }
  for (const code in byCodeDate) {
    const arr = byCodeDate[code].sort((a, b) => (a.trade_date < b.trade_date ? -1 : 1));
    for (let i = 0; i < arr.length; i++) {
      arr[i].rs_accel_5d = i >= 5 && arr[i].rs20_vs_benchmark != null && arr[i - 5].rs20_vs_benchmark != null
        ? arr[i].rs20_vs_benchmark - arr[i - 5].rs20_vs_benchmark : null;
    }
  }
  return features;
}

/** 相关性：corr_to_portfolio_60d（vs incumbent 等权）与 corr_to_cluster_60d（vs 同类 peer 等权），忠实移植 Python add_correlations */
function addCorrelations(features) {
  const byCode = {};
  for (const f of features) (byCode[f.code] = byCode[f.code] || []).push(f);
  const codes = Object.keys(byCode);

  // 统一 trade_date 轴（所有 ETF 并集，排序）
  const dateSet = new Set();
  for (const f of features) dateSet.add(f.trade_date);
  const dates = [...dateSet].sort();

  // 每只 ret_1d 映射到轴（缺失 null）
  const retByCode = {};
  for (const code of codes) {
    const m = {};
    for (const f of byCode[code]) m[f.trade_date] = f.ret_1d;
    retByCode[code] = dates.map((d) => (d in m ? m[d] : null));
  }

  // incumbent 等权收益
  const incumbentCodes = UNIVERSE.incumbent.filter((c) => retByCode[c]);
  const incumbentRet = dates.map((_, i) => {
    const vs = incumbentCodes.map((c) => retByCode[c][i]).filter((v) => v != null);
    return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
  });

  // 每只：corr_to_portfolio = rollingCorr(ret, incumbentRet, 60)
  //       corr_to_cluster = rollingCorr(ret, peer_ret, 60)
  for (const code of codes) {
    const cl = UNIVERSE.cluster[code];
    const peerCodes = codes.filter((c) => c !== code && UNIVERSE.cluster[c] === cl);
    const peerRet = peerCodes.length
      ? dates.map((_, i) => {
          const vs = peerCodes.map((c) => retByCode[c][i]).filter((v) => v != null);
          return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
        })
      : null;

    const corrPort = rollingCorr(retByCode[code], incumbentRet, 60);
    const corrCl = peerRet ? rollingCorr(retByCode[code], peerRet, 60) : new Array(dates.length).fill(null);

    // 写回每只每个日期的相关性
    const dateMap = {};
    for (const f of byCode[code]) dateMap[f.trade_date] = f;
    dates.forEach((d, i) => {
      const f = dateMap[d];
      if (!f) return;
      f.corr_to_portfolio_60d = corrPort[i];
      f.corr_to_cluster_60d = corrCl[i];
    });
  }
  return features;
}

/* ---------------- 领导力评分 ---------------- */

function computeLeadershipScore(features) {
  // 按 trade_date 分组做横截面百分位
  const byDate = {};
  for (const f of features) (byDate[f.trade_date] = byDate[f.trade_date] || []).push(f);

  for (const d in byDate) {
    const rows = byDate[d];
    const pxMa20 = crossSectionalPct(rows.map((r) => r.px_ma20), true);
    const pxMa60 = crossSectionalPct(rows.map((r) => r.px_ma60), true);
    const ma20Slope = crossSectionalPct(rows.map((r) => r.ma20_slope_5d), true);
    const ma60Slope = crossSectionalPct(rows.map((r) => r.ma60_slope_10d), true);
    const rs20 = crossSectionalPct(rows.map((r) => r.rs20_vs_benchmark), true);
    const rs60 = crossSectionalPct(rows.map((r) => r.rs60_vs_benchmark), true);
    const rsAccel = crossSectionalPct(rows.map((r) => r.rs_accel_5d), true);
    const sidewayDays = crossSectionalPct(rows.map((r) => r.sideway_days), true);
    const sidewayRange = crossSectionalPct(rows.map((r) => r.sideway_range), false);
    const volRatio = crossSectionalPct(rows.map((r) => r.volume_ratio_5_20), false);
    const momentumAccel = crossSectionalPct(rows.map((r) => r.momentum_accel_5_20), true);
    const breakout = crossSectionalPct(rows.map((r) => r.breakout_distance), true);
    const atr = crossSectionalPct(rows.map((r) => r.atr20_pct), false);
    const vol = crossSectionalPct(rows.map((r) => r.realized_vol20), false);
    const mdd = crossSectionalPct(rows.map((r) => r.max_drawdown_20d), true);
    const liquidity = crossSectionalPct(rows.map((r) => r.avg_amount_20d), true);

    // diversification_raw = 1 - corr_to_portfolio.clip(0,1)；横截面 rank_pct（null 保持 null，后续 fillna 50）
    rows.forEach((r) => {
      const c = r.corr_to_portfolio_60d;
      r.diversification_raw = c != null ? 1 - Math.max(0, Math.min(1, c)) : null;
    });
    const divValidIdx = [];
    const divValidVals = [];
    rows.forEach((r, i) => { if (r.diversification_raw != null) { divValidIdx.push(i); divValidVals.push(r.diversification_raw); } });
    const divPct = crossSectionalPct(divValidVals, true);
    const divScore = rows.map(() => null);
    divValidIdx.forEach((origIdx, k) => { divScore[origIdx] = divPct[k]; });

    rows.forEach((r, i) => {
      r.trend_score = mean([pxMa20[i], pxMa60[i], ma20Slope[i], ma60Slope[i]]);
      r.rs_score = mean([rs20[i], rs60[i], rsAccel[i]]);
      r.stage_quality = 0.60 * sidewayDays[i] + 0.40 * sidewayRange[i];
      r.momentum_accel_score = momentumAccel[i];
      r.consolidation_score = mean([sidewayDays[i], sidewayRange[i], volRatio[i]]);
      r.breakout_approach_score = breakout[i];
      r.volatility_quality_score = mean([atr[i], vol[i], mdd[i]]);
      r.liquidity_score = liquidity[i];
      r.diversification_score = divScore[i] != null ? divScore[i] : 50.0;
      r.risk_penalty = Math.max(0, 100 - r.volatility_quality_score) * 0.10;
      const cc = r.corr_to_cluster_60d;
      r.crowding_penalty = (cc != null ? Math.max(0, Math.min(1, cc)) : 0.5) * 5.0;

      r.leadership_score = Math.max(0, Math.min(100,
        LEADERSHIP_WEIGHTS.trend * r.trend_score
        + LEADERSHIP_WEIGHTS.rs * r.rs_score
        + LEADERSHIP_WEIGHTS.stage * r.stage_quality
        + LEADERSHIP_WEIGHTS.momentum * r.momentum_accel_score
        + LEADERSHIP_WEIGHTS.consolidation * r.consolidation_score
        + LEADERSHIP_WEIGHTS.breakout * r.breakout_approach_score
        + LEADERSHIP_WEIGHTS.volatility * r.volatility_quality_score
        + LEADERSHIP_WEIGHTS.liquidity * r.liquidity_score
        + LEADERSHIP_WEIGHTS.diversification * r.diversification_score
        - r.risk_penalty - r.crowding_penalty
      ));
      // F02：AlphaScore-v2 = (Trend + RS + Breakout) / 3（与 Python alpha_score.py ALPHA_WEIGHTS_V2 一致）
      // P0-1：用等权 mean（忽略 null）；三个组件全 null 时 alpha 为 null，不参与排名。
      r.alpha_score_v2 = mean([r.trend_score, r.rs_score, r.breakout_approach_score]);
      // 绝对趋势闸门（NO_CORE）：价格在 60 日线上方才可成为 CORE
      r.trend_gate = r.px_ma60 != null && r.px_ma60 > 0;
      // 市场 regime（用于 Selection Permission / Defense 统一契约）
      r.market_score = (r.benchmark_px_ma20 != null && r.benchmark_px_ma60 != null)
        ? marketScore(r.benchmark_px_ma20, r.benchmark_px_ma60) : null;
      r.regime = classifyRegime(r.market_score);
    });
  }
  return features;
}

/** 每日排名 + rank_percentile（F02：V2 按 alpha_score_v2 排名，替代 V1 leadership_score；null alpha 不参与排名） */
function rankFeatures(features) {
  const byDate = {};
  for (const f of features) (byDate[f.trade_date] = byDate[f.trade_date] || []).push(f);
  for (const d in byDate) {
    const rows = byDate[d].slice().sort((a, b) => {
      if (b.alpha_score_v2 !== a.alpha_score_v2) return b.alpha_score_v2 - a.alpha_score_v2;
      return a.code < b.code ? -1 : 1;
    });
    const n = rows.length;
    rows.forEach((r, i) => {
      r.rank = i + 1;
      r.rank_percentile = (n - (i + 1) + 1) / n;
    });
  }
  return features;
}

/* ---------------- 角色状态机 ---------------- */

function initialRoles() {
  const roles = {};
  for (const code of UNIVERSE.eligible_codes) {
    if (UNIVERSE.strategic_role_hint[code] === 'hedge') roles[code] = 'HEDGE';
    else if (UNIVERSE.incumbent.includes(code)) roles[code] = 'CORE';
    else roles[code] = 'RESERVE';
  }
  return roles;
}

/* ---------------- Replacement 决策流（F09，与 portfolio/replacement_engine.py 一致） ---------------- */

function computeReplacementEdge(challengerAlpha, incumbentAlpha) {
  // 惩罚项与 Python rotation penalties 默认一致（correlation 2 / turnover 2 / crowding 1）
  const rawEdge = challengerAlpha - incumbentAlpha;
  return rawEdge - 2.0 - 2.0 - 1.0;
}

function shouldReplace(challengerAlpha, incumbentAlpha) {
  return computeReplacementEdge(challengerAlpha, incumbentAlpha) >= PORTFOLIO_CFG.min_replacement_edge;
}

function applyReplacementGate(day, prevRoles) {
  // 被 cap 降级的「现任 CORE」：上一日 CORE 且 cap 前仍 CORE、cap 后非 CORE
  const capDemoted = day.filter((r) => (prevRoles[r.code] || 'RESERVE') === 'CORE' && r.role_before_cap === 'CORE' && r.role !== 'CORE');
  if (!capDemoted.length) return;

  // 新晋升者：上一日非 CORE、当前为 CORE
  const promoted = day.filter((r) => (prevRoles[r.code] || 'RESERVE') !== 'CORE' && r.role === 'CORE');
  capDemoted.sort((a, b) => b.alpha_score_v2 - a.alpha_score_v2);

  for (const dem of capDemoted) {
    if (!promoted.length) break;
    const demCluster = UNIVERSE.cluster[dem.code] || 'other';

    // P0-5 修复：替换对必须在「同一 cluster」内配对。现任因 cluster 超员被降级，
    // 意味着是「同 cluster 晋升者」挤掉了它；恢复现任时必须退回同 cluster 晋升者，
    // 而不是全局最弱晋升者（否则会连带降级别的行业，破坏约束）。
    const sameCluster = promoted.filter((p) => (UNIVERSE.cluster[p.code] || 'other') === demCluster);
    const replacers = sameCluster.length ? sameCluster : promoted;

    // 一对一替换：同 cluster 内是否存在「净边际达标」的挑战者
    const hasReplacer = replacers.some((p) => shouldReplace(p.alpha_score_v2, dem.alpha_score_v2));
    if (hasReplacer) {
      // 边际足够 → 接受替换，现任保持降级
      dem.reason_codes += '|REPLACEMENT_ACCEPTED';
      continue;
    }

    // 边际不足 → 撤销替换：恢复现任，退回同 cluster 最弱晋升者
    dem.role = 'CORE';
    dem.reason_codes += '|REPLACEMENT_REVOKED';
    let weakestIdx = 0;
    for (let i = 1; i < replacers.length; i++) {
      if (replacers[i].alpha_score_v2 < replacers[weakestIdx].alpha_score_v2) weakestIdx = i;
    }
    const weakest = replacers[weakestIdx];
    weakest.role = 'CHALLENGER';
    weakest.reason_codes += '|REPLACEMENT_BLOCKED';
    const pi = promoted.indexOf(weakest);
    if (pi >= 0) promoted.splice(pi, 1);
  }

  // 最终组合约束断言（P0-5）：恢复后重新校验 cluster 数量 cap 与 CORE 总数 cap。
  // 不得用「末尾再盲目 cap」把恢复的现任又删掉；只允许在异常时降级同 cluster 的晋升者（非现任）。
  assertFinalRoleConstraints(day, prevRoles);
}

/** 组合约束最终断言：CORE 总数 ≤ max_core_count，每 cluster CORE 数 ≤ max_core_per_cluster。
 *  异常时降级同 cluster 中 alpha 最低的「晋升者」（非现任），绝不降级被恢复的现任 CORE。 */
function assertFinalRoleConstraints(day, prevRoles) {
  const cores = day.filter((r) => r.role === 'CORE');

  // cluster 数量约束
  const byCluster = {};
  for (const r of cores) (byCluster[UNIVERSE.cluster[r.code] || 'other'] = byCluster[UNIVERSE.cluster[r.code] || 'other'] || []).push(r);
  for (const cl in byCluster) {
    const arr = byCluster[cl].sort((a, b) => a.alpha_score_v2 - b.alpha_score_v2);
    let excess = arr.length - PORTFOLIO_CFG.max_core_per_cluster;
    while (excess > 0) {
      // 优先降级非现任（晋升者）中 alpha 最低者
      const victim = arr.find((r) => (prevRoles[r.code] || 'RESERVE') !== 'CORE') || arr[0];
      victim.role = 'CHALLENGER';
      victim.reason_codes += '|FINAL_CLUSTER_CAP';
      arr.splice(arr.indexOf(victim), 1);
      excess -= 1;
    }
  }

  // CORE 总数约束
  const remaining = day.filter((r) => r.role === 'CORE').sort((a, b) => a.alpha_score_v2 - b.alpha_score_v2);
  let totalExcess = remaining.length - PORTFOLIO_CFG.max_core_count;
  while (totalExcess > 0) {
    const victim = remaining.find((r) => (prevRoles[r.code] || 'RESERVE') !== 'CORE') || remaining[0];
    victim.role = 'CHALLENGER';
    victim.reason_codes += '|FINAL_CORE_CAP';
    remaining.splice(remaining.indexOf(victim), 1);
    totalExcess -= 1;
  }
}

function buildDailyRoles(features) {
  const corePct = 1.0 - PORTFOLIO_CFG.top_quantile; // 0.8
  // 按 code 正序，计算 above_core_days / below_satellite_days
  const byCode = {};
  for (const f of features) (byCode[f.code] = byCode[f.code] || []).push(f);
  for (const code in byCode) {
    const arr = byCode[code].sort((a, b) => (a.trade_date < b.trade_date ? -1 : 1));
    // F04：above_core 累计「完整准入条件」（alpha 前 20% 且过趋势闸门），跌破 MA60 不累计晋升天数
    const above = arr.map((r) => r.rank_percentile >= corePct && r.trend_gate);
    const below = arr.map((r) => r.rank_percentile < SATELLITE_PCT);
    const aboveDays = consecutiveTrue(above);
    const belowDays = consecutiveTrue(below);
    arr.forEach((r, i) => {
      r.above_core_days = aboveDays[i];
      r.below_satellite_days = belowDays[i];
    });
  }

  // 按 trade_date 分组，逐日状态机
  const byDate = {};
  for (const f of features) (byDate[f.trade_date] = byDate[f.trade_date] || []).push(f);
  const currentRoles = initialRoles();
  const dates = Object.keys(byDate).sort();

  const out = [];
  for (const d of dates) {
    const day = byDate[d].slice().sort((a, b) => a.rank - b.rank);
    // proposed role
    for (const r of day) {
      if (r.rank_percentile >= corePct) r.proposed_role = 'CORE';
      else if (r.rank_percentile >= CHALLENGER_PCT) r.proposed_role = 'CHALLENGER';
      else if (r.rank_percentile >= SATELLITE_PCT) r.proposed_role = 'SATELLITE';
      else r.proposed_role = 'RESERVE';
      r.reason_codes = {
        CORE: 'LEADERSHIP_TOP_QUINTILE',
        CHALLENGER: 'LEADERSHIP_CHALLENGER_ZONE',
        SATELLITE: 'LEADERSHIP_SATELLITE_ZONE',
        RESERVE: 'LEADERSHIP_BELOW_SATELLITE'
      }[r.proposed_role];
    }

    // 滞后 + hedge
    for (const r of day) {
      const code = r.code;
      const current = currentRoles[code] || 'RESERVE';
      let role = r.proposed_role;
      const reasons = [r.reason_codes];

      if (UNIVERSE.strategic_role_hint[code] === 'hedge') {
        role = 'HEDGE';
        reasons.push('DEFENSIVE_HEDGE_BASELINE');
      } else if (current === 'CORE' && ['RESERVE', 'CHALLENGER', 'SATELLITE'].includes(role)) {
        // §6.1：现任 CORE 去留由 demotion 滞后决定，不受 DISABLED 清仓
        if ((r.below_satellite_days || 0) < PORTFOLIO_CFG.demotion_persistence_days) {
          role = 'CORE';
          reasons.push('DEMOTION_HYSTERESIS_KEEP');
        } else {
          reasons.push('DEMOTION_CONFIRMED');
        }
      } else if (current !== 'CORE' && role === 'CORE') {
        // §6.1：新晋升受 Selection Permission 控制，DISABLED 禁晋升但不清现任
        if (!promotionAllowed(r.market_score)) {
          role = 'CHALLENGER';
          reasons.push('PROMOTION_BLOCKED_BY_PERMISSION');
        } else if ((r.above_core_days || 0) < PORTFOLIO_CFG.promotion_persistence_days) {
          role = 'CHALLENGER';
          reasons.push('PROMOTION_HYSTERESIS_WAIT');
        } else {
          reasons.push('PROMOTION_CONFIRMED');
        }
      }

      // NO_CORE 绝对硬门槛（F04）：跌破 MA60 即失去 CORE 资格，无论 proposed 晋升还是现任保留
      if (role === 'CORE' && !r.trend_gate) {
        role = 'CHALLENGER';
        reasons.push('NO_CORE_TREND_GATE');
      }

      r.role = role;
      r.reason_codes = reasons.join('|');
      r.persistence_days = Math.max(r.above_core_days || 0, r.below_satellite_days || 0);
    }

    // cluster cap（F03：按 alpha_score_v2 排序；maxCore 为 null 时仅 cluster cap，不清现任）
    const maxCore = day.length ? maxCoreCount(day[0].market_score, PORTFOLIO_CFG.max_core_count) : PORTFOLIO_CFG.max_core_count;
    for (const r of day) r.role_before_cap = r.role;
    const cores = day.filter((r) => r.role === 'CORE').sort((a, b) => {
      if (b.alpha_score_v2 !== a.alpha_score_v2) return b.alpha_score_v2 - a.alpha_score_v2;
      return a.rank - b.rank;
    });
    let keepCount = 0;
    const clusterCount = {};
    const keepSet = new Set();
    for (const r of cores) {
      if (maxCore != null && keepCount >= maxCore) continue;
      const cl = UNIVERSE.cluster[r.code] || 'other';
      if ((clusterCount[cl] || 0) >= PORTFOLIO_CFG.max_core_per_cluster) continue;
      keepSet.add(r.code);
      clusterCount[cl] = (clusterCount[cl] || 0) + 1;
      keepCount += 1;
    }
    for (const r of day) {
      if (r.role === 'CORE' && !keepSet.has(r.code)) {
        r.role = 'SATELLITE';
        r.reason_codes += '|CLUSTER_CAP_DEMOTED';
      }
    }

    // F09：自愿替换校验。被 cap 降级的「现任 CORE」（上一日 CORE 且 cap 前仍 CORE）
    // 需有 alpha 边际 >= min_replacement_edge 的新晋升者才接受替换；否则撤销（恢复现任、退回最弱晋升者）。
    // 硬退出（NO_CORE）已在前置状态机把 role 降为非 CORE，不经过此校验、不被阈值阻塞。
    applyReplacementGate(day, currentRoles);

    for (const r of day) {
      currentRoles[r.code] = r.role;
      out.push({
        trade_date: r.trade_date,
        code: r.code,
        name: UNIVERSE.name[r.code] || '',
        correlation_cluster: UNIVERSE.cluster[r.code] || '',
        rank: r.rank,
        rank_percentile: r.rank_percentile,
        leadership_score: Math.round(r.leadership_score * 100) / 100,
        alpha_score_v2: Math.round(r.alpha_score_v2 * 100) / 100,
        trend_gate: !!r.trend_gate,
        regime: r.regime || 'RANGE',
        proposed_role: r.proposed_role,
        role: r.role,
        persistence_days: r.persistence_days,
        reason_codes: r.reason_codes,
        trend_score: Math.round(r.trend_score * 100) / 100,
        rs_score: Math.round(r.rs_score * 100) / 100
      });
    }
  }
  return out;
}

/* ---------------- 组合候选 + 防守 ---------------- */

/** F05：按分组（cluster / tech）将权重和缩到 cap 内，剩余留现金（不归一化） */
function scaleGroupToCap(items, groupFn, cap) {
  const groups = {};
  for (const r of items) {
    const g = groupFn(r);
    (groups[g] = groups[g] || []).push(r);
  }
  for (const g in groups) {
    const arr = groups[g];
    const total = arr.reduce((s, r) => s + r.target_weight, 0);
    if (total > cap) {
      const k = cap / total;
      for (const r of arr) r.target_weight = r.target_weight * k;
    }
  }
}

/** F05：广义科技约束（tech_clusters 合计 <= max_tech_weight），只缩科技、不动非科技 */
function scaleTechToCap(items) {
  const isTech = (r) => PORTFOLIO_CFG.tech_clusters.includes(UNIVERSE.cluster[r.code]);
  const techTotal = items.reduce((s, r) => s + (isTech(r) ? r.target_weight : 0), 0);
  if (techTotal > PORTFOLIO_CFG.max_tech_weight) {
    const k = PORTFOLIO_CFG.max_tech_weight / techTotal;
    for (const r of items) {
      if (isTech(r)) r.target_weight = r.target_weight * k;
    }
  }
}

function buildPortfolioCandidates(roles) {
  const byDate = {};
  for (const r of roles) (byDate[r.trade_date] = byDate[r.trade_date] || []).push(r);
  const out = [];
  for (const d in byDate) {
    const day = byDate[d];
    const cores = day.filter((r) => r.role === 'CORE');
    // 1. 等权相对份额 → 单只 cap
    const w0 = cores.length ? 1.0 / cores.length : 0;
    for (const r of cores) r.target_weight = Math.min(w0, PORTFOLIO_CFG.max_single_weight);
    // 2. cluster cap（同 cluster 合计 <= max_cluster_weight）
    scaleGroupToCap(cores, (r) => UNIVERSE.cluster[r.code] || 'other', PORTFOLIO_CFG.max_cluster_weight);
    // 3. 广义科技 cap（tech_clusters 合计 <= max_tech_weight）
    scaleTechToCap(cores);
    for (const r of day) {
      out.push({ ...r, target_weight: r.role === 'CORE' ? Math.round((r.target_weight || 0) * 10000) / 10000 : 0.0 });
    }
  }
  return out;
}

function applyDefense(candidates, features, benchmarkFeatures) {
  // 每日防守信号：benchmark(510300) regime（market_score 55/45）+ vol target
  const benchByDate = {};
  for (const f of features) {
    if (!benchByDate[f.trade_date]) {
      benchByDate[f.trade_date] = { benchmark_px_ma20: f.benchmark_px_ma20, benchmark_px_ma60: f.benchmark_px_ma60, realized_vol20: null };
    }
  }
  // realized_vol20 用 benchmark(510300) 的真实波动率（与 Python 版一致）
  for (const b of benchmarkFeatures) {
    if (benchByDate[b.trade_date]) benchByDate[b.trade_date].realized_vol20 = b.realized_vol20;
  }

  const out = candidates.map((r) => {
    const sig = benchByDate[r.trade_date] || {};
    let state = 'NORMAL';
    let coreScale = 1.0;
    let hedgeWeight = 0.0;

    // F02：统一 regime 契约（market_score 55/45，与 Python regime.py 一致），替代 MA60<-2% 硬编码
    const ms = (sig.benchmark_px_ma20 != null && sig.benchmark_px_ma60 != null)
      ? marketScore(sig.benchmark_px_ma20, sig.benchmark_px_ma60) : null;
    const regime = classifyRegime(ms);

    if (regime === 'RISK_OFF') {
      state = 'RISK_OFF';
      coreScale = Math.max(0, DEFENSE_CFG.risk_off_exposure_scale - DEFENSE_CFG.risk_off_hedge_weight);
      hedgeWeight = DEFENSE_CFG.risk_off_hedge_weight;
    } else if (DEFENSE_CFG.vol_target_enabled && sig.realized_vol20 && sig.realized_vol20 > 0) {
      coreScale = Math.min(1.0, DEFENSE_CFG.vol_target_annualized / sig.realized_vol20);
    }

    const isHedge = r.code === DEFENSE_CFG.hedge_code;
    let tw = r.target_weight;
    if (state === 'RISK_OFF') {
      tw = isHedge ? hedgeWeight : r.target_weight * coreScale;
    } else {
      tw = r.target_weight * coreScale;
    }
    return { ...r, target_weight: Math.round(tw * 10000) / 10000, defense_state: state };
  });
  return out;
}

/* ---------------- 主流程 ---------------- */

exports.main = async (event = {}, context = {}) => {
  const startedAt = Date.now();
  const runId = `gen2-eod-${Date.now()}`;
  const diag = async (step, detail) => {
    try {
      await db.upsert(COLLECTIONS.GEN2_SHADOW, {
        type: 'gen2_diag', run_id: runId, step, detail: String(detail || '').slice(0, 500),
        created_at: new Date().toISOString()
      }, { type: 'gen2_diag', run_id: runId, step });
    } catch (e) { /* 忽略诊断落库失败 */ }
  };
  try {
    await diag('start', 'main entered');
    // 1. 读研究日线（14 只 universe + benchmark 510300，qfq 前复权完整历史；串行避免 SDK 并发挂起）
    const barsByCode = {};
    const allCodes = [...UNIVERSE.eligible_codes, UNIVERSE.benchmark_code];
    for (const code of allCodes) {
      const bars = await db.query(COLLECTIONS.GEN2_DAILY, { code }, {
        orderBy: [{ field: 'trade_date', direction: 'asc' }]
      });
      if (bars && bars.length) barsByCode[code] = bars;
      await diag('read', code + ':' + (bars ? bars.length : 0));
    }
    await diag('read_done', 'codes=' + Object.keys(barsByCode).length);

    // F01：数据闸门（P0-1 重写）——独立应到交易日 + 唯一交易日 + benchmark 完整性 + LIVE/REPLAY 分离。
    // 核心契约：绝不把「陈旧批次」「唯一交易日不足」「benchmark 特征未就绪」标成可消费的 FULL。
    const MIN_HISTORY_DAYS = 120;        // 候选「唯一交易日」下限（对齐 Python 120 行语义，但按唯一日计算）
    const BENCHMARK_MIN_DAYS = 60;       // benchmark「唯一交易日」下限（MA20/MA60/vol 必要输入）
    let mode = (event.mode === 'REPLAY') ? 'REPLAY' : 'LIVE';
    const expectedTradeDate = dateKey(event.expected_trade_date || event.as_of_trade_date) || null;

    // 闸门失败：写 failed 运行记录（不得产生 completed 决策快照），再返回
    const failGate = async (gate, error, extra = {}) => {
      try {
        await db.upsert(COLLECTIONS.GEN2_SHADOW, {
          type: 'gen2_run', run_id: runId, engine_id: ENGINE_ID,
          universe_version: UNIVERSE.version, mode, status: 'failed',
          data_gate: gate, error: String(error || '').slice(0, 300),
          created_at: new Date().toISOString()
        }, { type: 'gen2_run', run_id: runId });
      } catch (e2) { /* 忽略失败记录落库失败 */ }
      return { ok: false, error: String(error || ''), data_gate: gate, mode, ...extra };
    };

    // 1) benchmark 存在性 + 唯一交易日完整性
    const benchBarsRaw = barsByCode[UNIVERSE.benchmark_code];
    if (!benchBarsRaw || !benchBarsRaw.length) {
      return await failGate('BENCHMARK_MISSING', 'benchmark 510300 无数据，阻断 Gen-2 输出');
    }
    const benchBarsDedup = dedupByDate(benchBarsRaw);
    const benchDates = uniqueTradeDates(benchBarsDedup);
    if (benchDates.length < BENCHMARK_MIN_DAYS) {
      return await failGate('BENCHMARK_INSUFFICIENT_HISTORY',
        `benchmark 唯一交易日不足（${benchDates.length}<${BENCHMARK_MIN_DAYS}），MA20/MA60/vol 必要输入未就绪`);
    }
    const benchLatest = benchDates[benchDates.length - 1];

    // 2) 应到交易日：独立于 benchmark 最大日期
    //    LIVE：必须显式传入 expected_trade_date，且数据必须覆盖到应到日（否则陈旧批次阻断）
    //    REPLAY：asOf 取 benchmark 最新日期，明确标注历史重放
    let asOf;
    let dataCutoff; // 数据截断日：特征计算只用到 <= cutoff 的交易日
    if (mode === 'LIVE') {
      if (!expectedTradeDate) {
        // LIVE 未传应到交易日 → 降级为历史重放，禁止宣称新鲜 FULL
        asOf = benchLatest;
        dataCutoff = benchLatest;
        mode = 'REPLAY';
        await diag('data_gate', 'LIVE 缺 expected_trade_date，降级 REPLAY asOf=' + asOf);
      } else if (benchLatest < expectedTradeDate) {
        return await failGate('STALE_BATCH',
          `benchmark 数据停在 ${benchLatest}，落后于应到交易日 ${expectedTradeDate}，陈旧批次阻断`,
          { as_of: benchLatest, expected_trade_date: expectedTradeDate });
      } else {
        asOf = expectedTradeDate;
        dataCutoff = expectedTradeDate;
      }
    } else {
      asOf = benchLatest;
      dataCutoff = benchLatest;
    }

    // 3) 逐只候选：唯一交易日去重 → 历史长度 → 当日新鲜度（last == asOf）
    const eligibleToday = [];
    const excluded = [];
    for (const c of UNIVERSE.eligible_codes) {
      const raw = barsByCode[c];
      if (!raw || !raw.length) { excluded.push({ code: c, reason: 'NO_DATA' }); continue; }
      const ds = uniqueTradeDates(raw);
      if (ds.length < MIN_HISTORY_DAYS) { excluded.push({ code: c, reason: 'INSUFFICIENT_HISTORY', unique_days: ds.length }); continue; }
      const lastDate = ds[ds.length - 1];
      if (lastDate !== asOf) { excluded.push({ code: c, reason: 'STALE', last_date: lastDate }); continue; }
      eligibleToday.push(c);
    }
    const loadedCount = Object.keys(barsByCode).length;
    const codes = eligibleToday;
    if (!codes.length) {
      return await failGate('NO_ELIGIBLE_TODAY', '当日无合格 universe 数据', { as_of: asOf, excluded });
    }
    // 统一把内存数据清洗为「去重 + 截断到 dataCutoff」后的版本，后续特征/角色一律消费清洗后数据
    for (const c of Object.keys(barsByCode)) {
      const clean = dedupByDate(barsByCode[c]).filter((b) => dateKey(b.trade_date) <= dataCutoff);
      barsByCode[c] = clean.sort((a, b) => (a.trade_date < b.trade_date ? -1 : 1));
    }
    await diag('data_gate', 'mode=' + mode + ' asOf=' + asOf + ' loaded=' + loadedCount + ' eligible=' + codes.length + ' excluded=' + excluded.length);

    // 2. 特征（按 code 正序）
    let features = [];
    for (const code of codes) {
      const bars = barsByCode[code].slice().sort((a, b) => (a.trade_date < b.trade_date ? -1 : 1));
      features = features.concat(computeTimeSeriesFeatures(bars));
    }
    // benchmark 510300 特征（单独算，用于 rs 与防守 regime）
    let benchmarkFeatures = [];
    const benchBars = barsByCode[UNIVERSE.benchmark_code];
    if (benchBars && benchBars.length) {
      benchmarkFeatures = computeTimeSeriesFeatures(benchBars.slice().sort((a, b) => (a.trade_date < b.trade_date ? -1 : 1)));
    }
    features = addBenchmark(features, benchmarkFeatures);
    features = addCorrelations(features);
    features = computeLeadershipScore(features);
    features = rankFeatures(features);

    // 只保留最近一个交易日（落库最新横截面）
    const dates = [...new Set(features.map((f) => f.trade_date))].sort();
    const latestDate = dates[dates.length - 1];
    const latest = features.filter((f) => f.trade_date === latestDate && f.alpha_score_v2 != null);

    // 3. 角色 + 组合 + 防守
    const roles = buildDailyRoles(features);
    const candidates = buildPortfolioCandidates(roles);
    const defended = applyDefense(candidates, features, benchmarkFeatures);
    const latestDefended = defended.filter((r) => r.trade_date === latestDate);
    await diag('computed', 'latest=' + latestDate + ' roles=' + roles.length + ' defended=' + latestDefended.length);

    // 4. 落库 gen2_shadow（F01：coverage/confidence 用当日合格数；F12：running→completed 发布契约）
    const coveragePct = UNIVERSE.target_size ? Math.round((codes.length / UNIVERSE.target_size) * 1000) / 10 : null;
    const conf = computeSelectionConfidence(codes.length, UNIVERSE.target_size);
    const rcls = roleClassification(codes.length);
    // 数据降级：当日合格数 < 10 时，即使 coverage 达标也降级为 LIMITED（小样本不可信）
    const dataDegraded = codes.length < 10;
    const selectionConfidence = (dataDegraded && conf.selection_confidence === 'FULL') ? 'LIMITED' : conf.selection_confidence;
    const confidenceReason = (dataDegraded && conf.selection_confidence === 'FULL') ? 'SMALL_ELIGIBLE_TODAY' : conf.confidence_reason;
    const runDoc = {
      type: 'gen2_run',
      run_id: runId,
      run_date: latestDate,
      as_of_trade_date: asOf,
      mode,
      engine_id: ENGINE_ID,
      bundle_version: BUNDLE_VERSION,
      bundle_sha256: _bundle_sha256,
      universe_version: UNIVERSE.version,
      universe_target_size: UNIVERSE.target_size,
      loaded_count: loadedCount,
      eligible_count: codes.length,
      ranked_count: latest.length,
      excluded: excluded,
      universe_coverage: `${codes.length}/${UNIVERSE.target_size}`,
      coverage_pct: coveragePct,
      selection_confidence: selectionConfidence,
      confidence_reason: confidenceReason,
      role_classification: rcls,
      benchmark: UNIVERSE.benchmark_code,
      status: 'running', // F12：先标 running，全部 ranking 写完后置 completed
      production_write: false,
      auto_execution: false,
      created_at: new Date().toISOString()
    };
    await db.upsert(COLLECTIONS.GEN2_SHADOW, runDoc, { type: 'gen2_run', run_id: runId });

    let written = 0;
    const writtenCodes = new Set();
    for (const r of latestDefended) {
      if (writtenCodes.has(r.code)) continue; // 唯一 code 去重（P1-2）
      await db.upsert(COLLECTIONS.GEN2_SHADOW, {
        type: 'gen2_ranking',
        run_id: runId,
        trade_date: r.trade_date,
        code: r.code,
        name: r.name,
        correlation_cluster: r.correlation_cluster,
        rank: r.rank,
        rank_percentile: Math.round(r.rank_percentile * 10000) / 10000,
        leadership_score: r.leadership_score,
        alpha_score_v2: r.alpha_score_v2,
        trend_gate: !!r.trend_gate,
        regime: r.regime || 'RANGE',
        proposed_role: r.proposed_role,
        role: r.role,
        persistence_days: r.persistence_days,
        reason_codes: r.reason_codes,
        target_weight: r.target_weight,
        defense_state: r.defense_state,
        trend_score: r.trend_score,
        rs_score: r.rs_score,
        engine_id: ENGINE_ID,
        universe_version: UNIVERSE.version,
        universe_coverage: `${codes.length}/${UNIVERSE.target_size}`,
        selection_confidence: selectionConfidence,
        role_classification: rcls,
        production_write: false,
        created_at: new Date().toISOString()
      }, { type: 'gen2_ranking', run_id: runId, code: r.code });
      writtenCodes.add(r.code);
      written += 1;
    }

    // P1-2：发布前完整性校验——唯一 code、预期集合、行数、特征有效性。不满足则写 failed 记录，不发布 completed。
    const uniqueCodeCount = new Set(latestDefended.map((r) => r.code)).size;
    const nonFiniteAlpha = latestDefended.filter((r) => r.alpha_score_v2 == null || !Number.isFinite(r.alpha_score_v2)).length;
    if (uniqueCodeCount === 0 || uniqueCodeCount !== latestDefended.length || nonFiniteAlpha > 0 || written === 0) {
      await db.upsert(COLLECTIONS.GEN2_SHADOW, {
        ...runDoc, status: 'failed',
        fail_reason: `Publish validation failed: unique=${uniqueCodeCount}/${latestDefended.length} non_finite_alpha=${nonFiniteAlpha} written=${written}`,
        completed_at: null
      }, { type: 'gen2_run', run_id: runId });
      return { ok: false, error: 'Gen-2 发布前完整性校验失败，不发布 completed', data_gate: 'PUBLISH_VALIDATION_FAILED', written };
    }

    // F12：全部 ranking 写完后，原子发布 completed（半途失败则停留在 running，不误读为完整横截面）
    await db.upsert(COLLECTIONS.GEN2_SHADOW, { ...runDoc, status: 'completed', completed_at: new Date().toISOString(), written }, { type: 'gen2_run', run_id: runId });

    return {
      ok: true,
      run_id: runId,
      run_date: latestDate,
      as_of_trade_date: asOf,
      mode,
      engine_id: ENGINE_ID,
      bundle_version: BUNDLE_VERSION,
      bundle_sha256: _bundle_sha256,
      universe_version: UNIVERSE.version,
      loaded_count: loadedCount,
      eligible_count: codes.length,
      ranked_count: latest.length,
      universe_coverage: `${codes.length}/${UNIVERSE.target_size}`,
      coverage_pct: coveragePct,
      selection_confidence: selectionConfidence,
      confidence_reason: confidenceReason,
      role_classification: rcls,
      status: 'completed',
      written,
      ranking: latestDefended.map((r) => ({
        code: r.code, name: r.name, rank: r.rank,
        alpha_score_v2: r.alpha_score_v2, role: r.role,
        target_weight: r.target_weight, defense_state: r.defense_state
      })),
      production_write: false,
      duration_ms: Date.now() - startedAt
    };
  } catch (e) {
    const errMsg = String(e && e.message ? e.message : e);
    try {
      await db.upsert(COLLECTIONS.GEN2_SHADOW, {
        type: 'gen2_error',
        run_id: runId,
        error: errMsg,
        stack: e && e.stack ? String(e.stack).slice(0, 800) : null,
        created_at: new Date().toISOString()
      }, { type: 'gen2_error', run_id: runId });
    } catch (e2) { /* 忽略错误落库失败 */ }
    return { ok: false, error: errMsg };
  }
};
