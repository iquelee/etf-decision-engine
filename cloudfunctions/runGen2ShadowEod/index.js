/**
 * 云函数：runGen2ShadowEod —— Gen-2 Cross-ETF Leadership / Rotation Shadow 观测器
 *
 * 职责（只读，绝不改生产仓位）：
 *   1. 读线上 etf_daily 的 universe 日线；
 *   2. 计算 Gen-2 特征 → leadership_score → 横截面 rank；
 *   3. 角色状态机（Core/Challenger/Reserve + hedge + 滞后 + cluster cap），并产出**权威权重**
 *      `target_weight`（`attachAuthoritativeWeights()`，全仓唯一权重算法：1/n 起算 →
 *      cluster cap → 广义科技 cap；非 CORE 一律 0）；
 *   4. 候选组合 = **沿用**角色层权威权重（只做上限**复核**，越界抛错；绝不重算、绝不重置为等权）
 *      + 现金腿（逐日 residual = 1 - Σ证券腿）
 *      + 防守腿（market-score regime：RISK_ON ≥ 55 / RISK_OFF ≤ 45，缩仓 + hedge 腿）；
 *   5. `priority` = **显式 selection score**（`features.alpha_score_v2` 的**未四舍五入**值），
 *      与权重排序无关；缺失即 blocked（不猜、不回退 legacy rank）；
 *   6. 发布**两类**记录到 gen2_shadow（同 run_id）：
 *        * `gen2_ranking`       —— **只含 30 条 ETF**（现金腿没有 alpha，不得进入排名校验）；
 *        * `gen2_candidate_leg` —— **30 ETF + CASH = 31 条候选腿**，带
 *          `priority / priority_score / priority_source / priority_hash / config_hash /
 *           defense_state / sleeve='GEN2_CANDIDATE'`；
 *      两类记录**都通过发布校验**才把 run 标 `completed`，否则 blocked（fail-closed）。
 *
 * 与 Gen-1 / V3.6.1 完全隔离：本函数不调用 runDecisionEngine、不写 decision_result、
 * 不写 portfolio_position / portfolio_snapshot，仅产生观测数据。
 * 候选腿**绝不写** `final_target`（那是 V3.6.1 的正式仓位字段，两者口径严格分离）。
 *
 * 规则单一真相源：`GEN2_RULE_V2_BUNDLE.json`（build 时由 `scripts/build-cloudfunctions.js`
 * 复制到本目录）。规则 bundle 缺 `selection.role_thresholds`（或提供但非法）→ 本次运行
 * `blocked` / `RULE_BUNDLE_INCOMPLETE`，且**先于任何数据读取**早退（fail-closed；
 * 运行路径禁止 fallback 到旧 `top_quantile`）。
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

// Gen-2 Rule V2 单一真相源：从 bundle 读（build 时由 build-cloudfunctions.js 复制到本目录）。
// bundle 文件缺失 ⇒ `_bundle=null` ⇒ 无 selection.role_thresholds ⇒ 规则 bundle 闸门判
// blocked/RULE_BUNDLE_INCOMPLETE（fail-closed；不再有任何「硬编码/旧字段」兜底）。
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

// Gen-2 Rule V2 配置：单一真相源 GEN2_RULE_V2_BUNDLE。
// 说明：alpha / portfolio / defense / regime 的**数值**在 bundle 缺失时回落到与本文件一致的
// 硬编码默认（见下方 `!= null ? : default`）；**角色阈值不在该回落范围内** —— 它必须显式来自
// bundle 的 `selection.role_thresholds`，缺失或非法即 blocked / RULE_BUNDLE_INCOMPLETE
// （fail-closed，见 `resolveRoleThresholds()`）。
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

/* ---------------- 显式 Selection Score（WP-G2-05 / F1 修复） ----------------
 *
 * 设计（与 Python `ml/gen2/baseline/selection_scores.py` 对称）：
 *   特征 → Alpha 计算/注入 → Alpha 排名 → 角色状态机 → 候选权重 → 账本
 * 评分必须显式、可校验、带 provenance（score_version / score_source / score_hash）；
 * 显式注入时缺键、多键、重复键一律抛错，不允许静默 fallback。
 */

/** 组件分数字段（与 Python COMPONENT_SCORE_COLUMNS 一致） */
const SELECTION_COMPONENT_FIELDS = {
  trend: 'trend_score',
  rs: 'rs_score',
  breakout: 'breakout_approach_score',
  stage: 'stage_quality',
  momentum: 'momentum_accel_score',
  consolidation: 'consolidation_score',
  volatility: 'volatility_quality_score',
  liquidity: 'liquidity_score',
  diversification: 'diversification_score'
};

/** canonical Alpha 权重 = bundle.alpha（Trend/RS/Breakout 等权） */
const SELECTION_SCORE_WEIGHTS = Object.assign({}, ALPHA_WEIGHTS_V2);
const SELECTION_SCORE_VERSION = 'alpha-v2-equal-3';
const SELECTION_SCORE_SOURCE = 'bundle.alpha';

/** 按组件权重合成评分；权重全等时走算术平均（与历史 mean() 逐位一致） */
function combineSelectionScore(row, weights) {
  const entries = Object.keys(weights || {})
    .map((k) => [SELECTION_COMPONENT_FIELDS[k], Number(weights[k])])
    .filter(([col, w]) => col && isFinite(w) && w > 0);
  if (!entries.length) throw new Error('selection score weights 为空或不合法');
  const valid = entries.filter(([col]) => row[col] != null && isFinite(row[col]));
  if (!valid.length) return null;
  const firstW = valid[0][1];
  if (valid.every(([, w]) => w === firstW)) return mean(valid.map(([col]) => row[col]));
  const wsum = valid.reduce((acc, [, w]) => acc + w, 0);
  return valid.reduce((acc, [col, w]) => acc + row[col] * w, 0) / wsum;
}

function selectionScoreHash(features) {
  const rows = features
    .filter((f) => f.alpha_score_v2 != null && isFinite(f.alpha_score_v2))
    .map((f) => `${f.trade_date}~${f.code}~${Number(f.alpha_score_v2).toFixed(6)}`)
    .sort();
  return crypto.createHash('sha256').update(rows.join('|')).digest('hex');
}

function validateSelectionWeights(weights) {
  const keys = Object.keys(weights || {});
  if (!keys.length) throw new Error('selection weights 不能为空');
  let sum = 0;
  for (const k of keys) {
    if (!SELECTION_COMPONENT_FIELDS[k]) throw new Error(`selection weights 含未知组件 ${k}`);
    const w = Number(weights[k]);
    if (!isFinite(w) || w < 0) throw new Error(`selection weights[${k}] 必须是非负有限数，实际 ${weights[k]}`);
    sum += w;
  }
  if (!(sum > 0)) throw new Error('selection weights 不能全为 0');
}

/**
 * 校验/注入 selection score。
 * explicit = { trade_date: { code: score } } 时做**精确覆盖校验**（缺/多/重复/非有限 → 抛错）；
 * explicit = null 时只校验并返回 provenance（canonical 评分已由 computeLeadershipScore 按
 * SELECTION_SCORE_WEIGHTS 写入各行）。
 */
function applySelectionScores(features, explicit, scoreSource) {
  validateSelectionWeights(SELECTION_SCORE_WEIGHTS);
  if (explicit) {
    const seen = {};
    let assigned = 0;
    for (const f of features) {
      const day = explicit[f.trade_date];
      if (!day || !Object.prototype.hasOwnProperty.call(day, f.code)) {
        throw new Error(`selection score 未覆盖 ${f.trade_date}/${f.code}（禁止 fallback 到另一套分数）`);
      }
      const v = Number(day[f.code]);
      if (!isFinite(v)) throw new Error(`selection score 非有限值 ${f.trade_date}/${f.code}=${day[f.code]}`);
      const key = `${f.trade_date}~${f.code}`;
      if (seen[key]) throw new Error(`selection score 重复键 ${key}`);
      seen[key] = true;
      f.alpha_score_v2 = v;
      assigned += 1;
    }
    for (const d of Object.keys(explicit)) {
      for (const c of Object.keys(explicit[d])) {
        if (!features.some((f) => f.trade_date === d && f.code === c)) {
          throw new Error(`selection score 含不属于面板的键 ${d}/${c}`);
        }
      }
    }
    return {
      score_version: scoreSource ? `${scoreSource}-version` : 'explicit',
      score_source: scoreSource || 'EXPLICIT_INJECTION',
      score_hash: selectionScoreHash(features),
      score_coverage: assigned,
      score_null_rows: 0
    };
  }
  const nullRows = features.filter((f) => f.alpha_score_v2 == null || !isFinite(f.alpha_score_v2)).length;
  return {
    score_version: SELECTION_SCORE_VERSION,
    score_source: SELECTION_SCORE_SOURCE,
    score_hash: selectionScoreHash(features),
    score_coverage: features.length - nullRows,
    score_null_rows: nullRows
  };
}

// 角色状态机参数（与 config/gen2.yaml portfolio 一致）
const PORTFOLIO_CFG = {
  promotion_persistence_days: _sel.promotion_persistence_days != null ? _sel.promotion_persistence_days : 5,
  demotion_persistence_days: _sel.demotion_persistence_days != null ? _sel.demotion_persistence_days : 5,
  max_core_count: _sel.max_core_count != null ? _sel.max_core_count : 5,
  max_core_per_cluster: _sel.max_core_per_cluster != null ? _sel.max_core_per_cluster : 2,
  // 注：旧 `top_quantile` 已从运行配置**移除**（WP-G2-05R）。它只在离线迁移 bundle 时经
  // `deriveRoleThresholdsFromLegacy(_sel)` 读取一次，运行路径一律使用 selection.role_thresholds。
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

/**
 * 角色分层阈值（WP-G2-05 / F2 修复；WP-G2-05R 收口运行时 fallback）。
 *
 * 显式契约：`selection.role_thresholds = { core_top_fraction, challenger_top_fraction, satellite_top_fraction }`
 * 含义为「位于前多少比例」（不需要 1 - top_quantile 反向推导），校验
 * 0 < core <= challenger <= satellite < 1；取值与旧行为等价（core 0.80 / challenger 0.70 / satellite 0.60）。
 *
 * **运行路径禁止 fallback**（用户裁决：显式配置 + 与 Python 端语义一致）：
 *   * bundle 缺 `selection.role_thresholds` → 本次运行 `blocked`，`status_reason=RULE_BUNDLE_INCOMPLETE`
 *     （`data_gate=RULE_BUNDLE_ROLE_THRESHOLDS_MISSING`）；
 *   * 提供了但非法（键缺失 / 非数值 / 顺序违例）→ 同样 `blocked`，`data_gate=RULE_BUNDLE_ROLE_THRESHOLDS_INVALID`
 *     （配置损坏同样意味着「无法可信运行」，绝不静默沿用旧值）；
 *   * 旧 `top_quantile` **只允许离线迁移 bundle 时**经 `deriveRoleThresholdsFromLegacy()` 读取，
 *     任何运行路径都不得再读它。
 *
 * 因此本函数**永不抛错**：把判定结果（ok / gate / detail）交给 `main()` 统一转成 run 状态四态。
 */
function validateTopFractions(rt, label) {
  const keys = ['core_top_fraction', 'challenger_top_fraction', 'satellite_top_fraction'];
  const vals = {};
  for (const k of keys) {
    const v = rt[k];
    if (v == null || !isFinite(Number(v))) throw new Error(`${label}.${k} 必须是有限数值，实际 ${v}`);
    vals[k] = Number(v);
  }
  const { core_top_fraction: c, challenger_top_fraction: ch, satellite_top_fraction: sa } = vals;
  if (!(c > 0 && sa < 1) || !(c <= ch && ch <= sa)) {
    throw new Error(`${label} 必须满足 0 < core_top_fraction <= challenger_top_fraction <= satellite_top_fraction < 1，实际 ${c}/${ch}/${sa}`);
  }
  return vals;
}

function resolveRoleThresholds(sel) {
  const node = sel && sel.role_thresholds;
  if (!node || typeof node !== 'object') {
    return {
      ok: false,
      source: 'RULE_BUNDLE_INCOMPLETE',
      reason: 'RULE_BUNDLE_INCOMPLETE',
      gate: 'RULE_BUNDLE_ROLE_THRESHOLDS_MISSING',
      detail: '规则 bundle 缺 selection.role_thresholds；禁止运行路径 fallback 到旧 top_quantile'
        + '（旧字段只允许离线迁移 bundle 时读取）'
    };
  }
  try {
    const vals = validateTopFractions(node, 'selection.role_thresholds');
    return {
      ok: true,
      source: 'RUNTIME_BUNDLE',
      top_fractions: vals,
      core_pct: 1 - vals.core_top_fraction,
      challenger_pct: 1 - vals.challenger_top_fraction,
      satellite_pct: 1 - vals.satellite_top_fraction
    };
  } catch (e) {
    return {
      ok: false,
      source: 'RULE_BUNDLE_INVALID',
      reason: 'RULE_BUNDLE_INCOMPLETE',
      gate: 'RULE_BUNDLE_ROLE_THRESHOLDS_INVALID',
      detail: String((e && e.message) || e)
    };
  }
}

/**
 * **离线迁移助手**（WP-G2-04 重建 bundle/lock 用；严禁出现在运行路径）。
 *
 * 把冻结 bundle 里残留的旧字段（`top_quantile` / `challenger_pct` / `satellite_pct`）一次性
 * 换算成显式 `role_thresholds`，烘焙进新 bundle。运行路径只认 `selection.role_thresholds`，
 * 不调用本函数；迁移产物一律要过 `validateTopFractions` 校验，保证新 bundle 一定合法。
 */
function deriveRoleThresholdsFromLegacy(sel) {
  const s = sel && typeof sel === 'object' ? sel : {};
  const corePct = 1 - (s.top_quantile != null ? Number(s.top_quantile) : 0.2);
  const challengerPct = s.challenger_pct != null ? Number(s.challenger_pct) : 0.70;
  const satellitePct = s.satellite_pct != null ? Number(s.satellite_pct) : 0.60;
  // 分位回推：四舍五入到 1e-10，避免 1-(1-0.2)=0.19999999999999996 这类噪声落进 bundle
  const frac = (v) => Math.round((1 - v) * 1e10) / 1e10;
  const out = {
    core_top_fraction: frac(corePct),
    challenger_top_fraction: frac(challengerPct),
    satellite_top_fraction: frac(satellitePct)
  };
  validateTopFractions(out, 'legacy 迁移派生 role_thresholds');
  return out;
}

// 运行配置的显式阈值：ok=false 时下游常量一律为 null（main() 会在规则 bundle 闸门拦下）。
const ROLE_THRESHOLDS = resolveRoleThresholds(_sel);
const CORE_PCT = ROLE_THRESHOLDS.ok ? ROLE_THRESHOLDS.core_pct : null;
const CHALLENGER_PCT = ROLE_THRESHOLDS.ok ? ROLE_THRESHOLDS.challenger_pct : null;
const SATELLITE_PCT = ROLE_THRESHOLDS.ok ? ROLE_THRESHOLDS.satellite_pct : null;

/**
 * run 级「规则 bundle 闸门」（优先级最高，见夹具 `seam_contracts.run_status_gate.gate_order`）。
 * 非 null ⇒ 本次运行必须 `blocked`（status_reason=RULE_BUNDLE_INCOMPLETE），且**不读数据**。
 */
const RULE_BUNDLE_REASON = 'RULE_BUNDLE_INCOMPLETE';
const RULE_BUNDLE_GATE = ROLE_THRESHOLDS.ok ? null : {
  gate: ROLE_THRESHOLDS.gate,
  detail: ROLE_THRESHOLDS.detail,
  status_reason: RULE_BUNDLE_REASON
};

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

/**
 * 关键日线字段：缺失 / 非有限即视为「数据不可用」（A2 字段完整性）。
 * amount 允许缺失（成交额可由 close×volume 估算），故不在关键字段内。
 */
const CRITICAL_BAR_FIELDS = ['open', 'high', 'low', 'close', 'volume'];

/**
 * 输入完整性体检（A2 数据闸门，WP-G2-03 剩余切片）。
 *
 *   字段完整性 → NAN_OR_MISSING_FIELD：trade_date 必须存在；OHLCV 必须为有限数值
 *   唯一交易日 → DUPLICATE_TRADE_DATE：同一 code 不得出现重复 trade_date
 *
 * 说明：这两个闸门是「不发布不完整/脏横截面」的前置条件。此前实现会静默 dedup，
 * 让重复/脏数据被当成有效横截面参与排名 —— 现改为 blocked（可预期业务结果，不是系统故障）。
 * 只读：不修改入参。
 *
 * @returns {null|{gate:string, detail:string, code:string, trade_date?:string, field?:string}}
 */
function inspectBarsIntegrity(barsByCode, codes) {
  for (const code of codes) {
    const rows = barsByCode[code];
    if (!rows || !rows.length) continue; // 缺失由后续 benchmark / eligibility 闸门判定
    const seen = new Set();
    for (const b of rows) {
      const d = dateKey(b.trade_date);
      if (!d) return { gate: 'NAN_OR_MISSING_FIELD', detail: `${code} 存在缺失 trade_date 的行`, code };
      for (const f of CRITICAL_BAR_FIELDS) {
        const v = b[f];
        const nv = Number(v);
        if (v == null || v === '' || v === true || v === false || !Number.isFinite(nv)) {
          return {
            gate: 'NAN_OR_MISSING_FIELD',
            detail: `${code} ${d} 字段 ${f} 缺失或非有限值（${String(v)}）`,
            code, trade_date: d, field: f
          };
        }
      }
      if (seen.has(d)) {
        return { gate: 'DUPLICATE_TRADE_DATE', detail: `${code} 交易日 ${d} 重复`, code, trade_date: d };
      }
      seen.add(d);
    }
  }
  return null;
}

/**
 * 发布前完整性校验（纯函数，A3 原子发布契约）。
 *
 *   唯一 code / 行数与唯一数一致 / alpha 全部有限 / 至少写入 1 行
 * 任一不满足 → blocked + PUBLISH_VALIDATION_FAILED（今日没有可信结果，不是系统故障）。
 * 抽成纯函数是为了让「发布完整性」成为可跨语言比对的 seam（WP-G2-03 G2S-06）。
 */
function validatePublishResults(rows, written) {
  const list = Array.isArray(rows) ? rows : [];
  const uniqueCodeCount = new Set(list.map((r) => r.code)).size;
  const nonFiniteAlpha = list.filter((r) => r.alpha_score_v2 == null || !Number.isFinite(r.alpha_score_v2)).length;
  const writtenCount = Number.isFinite(Number(written)) ? Number(written) : 0;
  if (uniqueCodeCount === 0 || uniqueCodeCount !== list.length || nonFiniteAlpha > 0 || writtenCount === 0) {
    return {
      ok: false, status: 'blocked', status_reason: 'PUBLISH_VALIDATION_FAILED',
      data_gate: 'PUBLISH_VALIDATION_FAILED',
      unique_code_count: uniqueCodeCount, row_count: list.length,
      non_finite_alpha: nonFiniteAlpha, written: writtenCount
    };
  }
  return {
    ok: true, status: 'completed', status_reason: null, data_gate: null,
    unique_code_count: uniqueCodeCount, row_count: list.length,
    non_finite_alpha: nonFiniteAlpha, written: writtenCount
  };
}

/**
 * **候选腿发布校验**（纯函数；WP-G2-06，裁决 2026-09-14）。
 *
 * 与 `validatePublishResults`（ETF 排名：唯一 code + 有限 alpha）**并列但独立**：
 * 现金腿没有 alpha，塞进排名校验必被判失败，因此单列 `gen2_candidate_leg` 记录类型。
 * 两类记录**都**通过校验后，run 才允许标 `completed`。
 *
 * 校验项：
 *  ① 逐日守恒 `Σ所有腿（含现金） == 1`
 *  ② 单只 / cluster / 广义科技上限（复用 `checkCandidateCaps`）
 *  ③ 防守腿存在性与上限（RISK_OFF 日 hedge 腿权重 == 配置值）
 *  ④ priority 为证券腿 1..n 稠密排名 + 现金腿 n+1
 *  ⑤ priority_hash / config_hash 齐备且唯一
 *  ⑥ sleeve 全为 GEN2_CANDIDATE、绝不携带 final_target
 * 任一不满足 → blocked + CANDIDATE_LEG_PUBLISH_FAILED（今日没有可信候选组合，不是系统故障）。
 */
function validateCandidateLegPublish(legs, opts) {
  const o = opts || {};
  const pcfg = o.portfolio_config || {};
  const list = Array.isArray(legs) ? legs : [];
  const date = o.trade_date != null ? String(o.trade_date) : null;
  const day = date === null ? list.slice() : list.filter((r) => String(r.trade_date) === date);
  const fail = (gate, detail, extra) => Object.assign({
    ok: false, status: 'blocked', status_reason: 'CANDIDATE_LEG_PUBLISH_FAILED',
    data_gate: gate, detail: String(detail)
  }, extra || {});

  if (!day.length) return fail('CANDIDATE_LEG_EMPTY', '候选腿为空（' + String(date) + '）');
  const codes = day.map((r) => String(r.code));
  if (new Set(codes).size !== codes.length) {
    return fail('CANDIDATE_LEG_DUPLICATED', '候选腿 code 重复');
  }
  const cashRows = day.filter((r) => String(r.code) === CANDIDATE_CASH_CODE);
  if (cashRows.length !== 1) {
    return fail('CANDIDATE_LEG_CASH_MISSING', '候选腿必须且只能含 1 条现金腿，实得 ' + cashRows.length);
  }
  const sec = day.filter((r) => String(r.code) !== CANDIDATE_CASH_CODE);

  // ① 逐日守恒（累加顺序固定 code 升序 —— 与 Python 端逐位一致）
  let sum = 0;
  for (const r of day.slice().sort(byCodeAsc)) sum += Number(r.target_weight);
  if (!isFinite(sum) || Math.abs(sum - 1) > 1e-6) {
    return fail('CANDIDATE_LEG_NOT_CONSERVED', '权重和（含现金）!= 1：' + sum);
  }

  // ② 上限（单只 / cluster / 广义科技）—— 与构建期同一实现、同一配置
  const capBad = checkCandidateCaps(sec, pcfg);
  if (capBad) return fail(capBad.gate, capBad.detail);

  // ③ 防守腿：RISK_OFF 日 hedge 腿权重必须等于配置值
  const hedgeCode = String(o.defense_config && o.defense_config.hedge_code
    ? o.defense_config.hedge_code : '518880');
  const hedgeWeight = o.defense_config && o.defense_config.risk_off_hedge_weight != null
    ? Number(o.defense_config.risk_off_hedge_weight) : 0.15;
  const hedgeRows = sec.filter((r) => String(r.code) === hedgeCode);
  const hedgeDay = sec.filter((r) => String(r.code) === hedgeCode
    && String(r.defense_state) === 'RISK_OFF');
  if (hedgeDay.length) {
    const hw = Number(hedgeDay[0].target_weight);
    if (!isFinite(hw) || Math.abs(hw - hedgeWeight) > 1e-9) {
      return fail('CANDIDATE_LEG_HEDGE_WEIGHT_MISMATCH',
        'RISK_OFF 防守腿权重 ' + hw + ' != 配置 ' + hedgeWeight);
    }
  }
  if (o.expect_defense_leg === true && hedgeRows.length === 0) {
    return fail('CANDIDATE_LEG_DEFENSE_LEG_MISSING', '候选腿缺防守腿（hedge_code ' + hedgeCode + '）');
  }

  // ④ priority：证券腿 1..n 稠密 + 现金腿 n+1
  const prios = sec.map((r) => Number(r.priority)).sort((a, b) => a - b);
  const want = sec.map((_, i) => i + 1);
  if (prios.length !== want.length || prios.some((v, i) => v !== want[i])) {
    return fail('CANDIDATE_LEG_PRIORITY_INVALID',
      'priority 必须是证券腿的 1..n 稠密排名，实得 ' + JSON.stringify(prios));
  }
  if (Number(cashRows[0].priority) !== sec.length + 1) {
    return fail('CANDIDATE_LEG_PRIORITY_INVALID',
      '现金腿 priority 应为 ' + (sec.length + 1) + '，实得 ' + cashRows[0].priority);
  }

  // ⑤ priority_hash / config_hash 齐备且唯一
  const hashes = new Set(day.map((r) => r.priority_hash));
  if (hashes.size !== 1 || ![...hashes][0]) {
    return fail('CANDIDATE_LEG_PRIORITY_HASH_INVALID', 'priority_hash 缺失或不唯一');
  }
  if (!o.config_hash) {
    return fail('CANDIDATE_LEG_CONFIG_HASH_MISSING', '缺 config_hash（无法证明配置口径）');
  }

  // ⑥ sleeve 归属 + 绝不携带 final_target
  if (!day.every((r) => r.sleeve === CANDIDATE_SLEEVE)) {
    return fail('CANDIDATE_LEG_SLEEVE_INVALID', 'sleeve 必须全为 ' + CANDIDATE_SLEEVE);
  }
  if (day.some((r) => Object.prototype.hasOwnProperty.call(r, 'final_target'))) {
    return fail('CANDIDATE_LEG_FINAL_TARGET_LEAK', 'Gen-2 candidate sleeve 不得携带 final_target');
  }

  // ⑦ 写入完整性
  const writtenCount = Number.isFinite(Number(o.written)) ? Number(o.written) : 0;
  if (writtenCount !== day.length) {
    return fail('CANDIDATE_LEG_WRITE_INCOMPLETE',
      '写入条数 ' + writtenCount + ' != 期望 ' + day.length);
  }

  return {
    ok: true, status: 'completed', status_reason: null, data_gate: null,
    leg_code_count: sec.length, cash_count: cashRows.length,
    weight_sum: sum, written: writtenCount,
    priority_hash: [...hashes][0], config_hash: o.config_hash
  };
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
      // WP-G2-05（F1）：改由 SELECTION_SCORE_WEIGHTS 统一合成，权重可外部注入（敏感性实验）。
      r.alpha_score_v2 = combineSelectionScore(r, SELECTION_SCORE_WEIGHTS);
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
  // WP-G2-03（D-001 裁决）：本函数**只负责替换事务**，不承担终局约束检查。
  // 终局约束统一由 finalizeRoles() 在角色生成路径的出口无条件执行。
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
}

/**
 * 角色生成的**统一出口**（WP-G2-03 / D-001 裁决）：
 *   替换事务（applyReplacementGate）→ **无条件**终局约束检查（assertFinalRoleConstraints）。
 *
 * 不变量：任何角色生成路径在返回前都必须执行一次终局约束检查 ——
 * 与当天是否存在 cap 降级现任、是否有替换、是否提前返回**无关**。
 * 目的：终局检查不允许藏在替换门内部（否则新增早退分支就会绕过约束）。
 */
function finalizeRoles(day, prevRoles) {
  applyReplacementGate(day, prevRoles);
  assertFinalRoleConstraints(day, prevRoles);
  return day;
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

function buildDailyRoles(features, roleThresholds) {
  // WP-G2-05/F2：阈值只能来自显式 role_thresholds（roleThresholds 参数供跨语言 parity /
  // 场景实验显式覆盖，默认即运行配置）。运行路径缺显式配置时 main() 已在规则 bundle 闸门
  // blocked；这里再 fail-closed 兜一层，杜绝「没有显式阈值也算出角色」。
  const T = roleThresholds || ROLE_THRESHOLDS;
  if (!T || T.ok === false || T.core_pct == null) {
    throw new Error('RULE_BUNDLE_INCOMPLETE: buildDailyRoles 需要显式 role_thresholds（禁止 fallback）');
  }
  const corePct = T.core_pct;
  const challengerPct = T.challenger_pct;
  const satellitePct = T.satellite_pct;
  // 按 code 正序，计算 above_core_days / below_satellite_days
  const byCode = {};
  for (const f of features) (byCode[f.code] = byCode[f.code] || []).push(f);
  for (const code in byCode) {
    const arr = byCode[code].sort((a, b) => (a.trade_date < b.trade_date ? -1 : 1));
    // F04：above_core 累计「完整准入条件」（alpha 前 20% 且过趋势闸门），跌破 MA60 不累计晋升天数
    const above = arr.map((r) => r.rank_percentile >= corePct && r.trend_gate);
    const below = arr.map((r) => r.rank_percentile < satellitePct);
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
      else if (r.rank_percentile >= challengerPct) r.proposed_role = 'CHALLENGER';
      else if (r.rank_percentile >= satellitePct) r.proposed_role = 'SATELLITE';
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
    // WP-G2-03（D-001）：替换事务 + **无条件**终局约束检查统一在 finalizeRoles 出口执行。
    finalizeRoles(day, currentRoles);

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

/** F05：广义科技约束（tech_clusters 合计 <= max_tech_weight），只缩科技、不动非科技。
 *  WP-G2-06：上限与集群集合显式传入（不再读模块级 PORTFOLIO_CFG），使同一函数可服务
 *  研究与场景注入配置；求和沿用**输入顺序**（= 当日 alpha 排名顺序），与 Python
 *  `rule_v2_ab.build_v2_roles` 的 groupby 求和顺序一致，保证浮点结果逐位可比。 */
function scaleTechToCap(items, techClusters, maxTech) {
  const clusters = techClusters || PORTFOLIO_CFG.tech_clusters;
  const cap = maxTech != null ? maxTech : PORTFOLIO_CFG.max_tech_weight;
  const isTech = (r) => clusters.indexOf(r.correlation_cluster) >= 0;
  const techTotal = items.reduce((s, r) => s + (isTech(r) ? r.target_weight : 0), 0);
  if (techTotal > cap) {
    const k = cap / techTotal;
    for (const r of items) {
      if (isTech(r)) r.target_weight = r.target_weight * k;
    }
  }
}

/* ---------------- 权威权重（唯一算法，WP-G2-06） ---------------- */

/**
 * 角色面板 → **权威权重**（全仓唯一算法；与 Python `rule_v2_ab.build_v2_roles` F05 段同式）：
 *   ① CORE 相对份额 `1/n` → 单只上限 `min(1/n, max_single_weight)`；
 *   ② cluster 上限：同 (date, correlation_cluster) 的 CORE 权重和 > `max_cluster_weight` 时按比例缩；
 *   ③ 广义科技上限：同 date 的 `tech_clusters` CORE 权重和 > `max_tech_weight` 时**只缩科技**；
 *   ④ 非 CORE 权重 = 0（剩余留现金，**不归一化到 100%**）。
 *
 * **不做四舍五入**：与 Python 端逐位可比是本函数的存在理由（G2S-10 对表以 10 位小数比较）。
 */
function attachAuthoritativeWeights(roles, pcfg) {
  const cfg = pcfg || PORTFOLIO_CFG;
  const byDate = {};
  for (const r of roles) (byDate[r.trade_date] = byDate[r.trade_date] || []).push(r);
  const out = [];
  for (const d of Object.keys(byDate).sort()) {
    const day = byDate[d].map((r) => Object.assign({}, r));
    const cores = day.filter((r) => r.role === 'CORE');
    const w0 = cores.length ? 1.0 / cores.length : 0;
    for (const r of cores) {
      r.relative_share = w0;
      r.target_weight = Math.min(w0, cfg.max_single_weight);
    }
    scaleGroupToCap(cores, (r) => r.correlation_cluster, cfg.max_cluster_weight);
    scaleTechToCap(cores, cfg.tech_clusters, cfg.max_tech_weight);
    for (const r of day) {
      out.push(Object.assign({}, r, {
        relative_share: r.role === 'CORE' ? w0 : 0.0,
        target_weight: r.role === 'CORE' ? Number(r.target_weight) : 0.0
      }));
    }
  }
  return out;
}

/** @deprecated（WP-G2-06）**生产 run 不再消费**：`main()` 已改为
 *  「buildDailyRoles → attachAuthoritativeWeights → buildCandidatePortfolio」。
 *  本函数仅为 WP-G2-01 旧跨语言 parity 链（`scripts/parity/run_node.js`）保留，
 *  并且**只做委托**，保证全仓只有一套权重算法（`attachAuthoritativeWeights`）。 */
function buildPortfolioCandidates(roles) {
  return attachAuthoritativeWeights(roles);
}

/** 每日防守信号（market_score regime + vol target，与 Python
 *  `defense_gate._build_defense_signal` 同式）→ `{date: {state, coreScale, hedgeWeight}}`。**不四舍五入**。 */
function buildDefenseSignals(benchByDate, dcfg) {
  const out = {};
  for (const d of Object.keys(benchByDate)) {
    const sig = benchByDate[d] || {};
    let state = 'NORMAL';
    let coreScale = 1.0;
    let hedgeWeight = 0.0;
    const hasMa = sig.benchmark_px_ma20 != null && sig.benchmark_px_ma60 != null;
    const ms = hasMa ? marketScore(sig.benchmark_px_ma20, sig.benchmark_px_ma60) : null;
    if (classifyRegime(ms) === 'RISK_OFF') {
      state = 'RISK_OFF';
      coreScale = Math.max(0, dcfg.risk_off_exposure_scale - dcfg.risk_off_hedge_weight);
      hedgeWeight = dcfg.risk_off_hedge_weight;
    } else if (dcfg.vol_target_enabled && sig.realized_vol20 && sig.realized_vol20 > 0) {
      coreScale = Math.min(1.0, dcfg.vol_target_annualized / sig.realized_vol20);
    }
    out[String(d)] = { state: state, coreScale: coreScale, hedgeWeight: hedgeWeight };
  }
  return out;
}

/** 把防守信号套到组合腿上（只改 target_weight，不动 role / rank）。**不四舍五入**。 */
function applyDefenseToItems(items, benchByDate, dcfg) {
  if (dcfg && dcfg.enabled === false) return items.map((r) => Object.assign({}, r));
  const signals = buildDefenseSignals(benchByDate, dcfg);
  const hedgeCode = String(dcfg.hedge_code);
  return items.map((r) => {
    const s = signals[String(r.trade_date)] || { state: 'NORMAL', coreScale: 1.0, hedgeWeight: 0.0 };
    const isHedge = String(r.code) === hedgeCode;
    const tw = (s.state === 'RISK_OFF')
      ? (isHedge ? s.hedgeWeight : r.target_weight * s.coreScale)
      : r.target_weight * s.coreScale;
    return Object.assign({}, r, { target_weight: tw, defense_state: s.state });
  });
}

/** @deprecated（WP-G2-06）同 `buildPortfolioCandidates`：仅为 WP-G2-01 旧 parity 链保留，
 *  内部委托到唯一防守实现 `applyDefenseToItems`（旧签名 features + benchmarkFeatures 兼容）。 */
function applyDefense(candidates, features, benchmarkFeatures) {
  const benchByDate = {};
  for (const f of features) {
    if (!benchByDate[f.trade_date]) {
      benchByDate[f.trade_date] = {
        benchmark_px_ma20: f.benchmark_px_ma20,
        benchmark_px_ma60: f.benchmark_px_ma60,
        realized_vol20: null
      };
    }
  }
  for (const b of benchmarkFeatures) {
    if (benchByDate[b.trade_date]) benchByDate[b.trade_date].realized_vol20 = b.realized_vol20;
  }
  return applyDefenseToItems(candidates, benchByDate, DEFENSE_CFG);
}

/* ---------------- WP-G2-06（F4）：统一候选组合构建（跨端 parity seam） ----------------
 *
 * 与 Python `gen2.portfolio.portfolio_builder.build_portfolio_candidates` **同一口径**：
 *   B1 权重直接沿用角色层权威 target_weight（只做上限复核，越界即抛错，不静默缩）
 *   B2 priority 必须来自显式注入 selection score（缺即抛错），绝不读 legacy rank
 *   B3 现金腿（residual）与防守腿逐日进入组合
 *   B5 priority 全覆盖 / 有限值 / 按 score 降序、**同分按 code 升序**；写入 priority_source/hash
 * 现金求和的累加顺序固定为 **code 升序**，保证 IEEE 浮点结果与 Python 端逐位一致。
 */
const CANDIDATE_SLEEVE = 'GEN2_CANDIDATE';
const CANDIDATE_CASH_CODE = 'CASH';
const CANDIDATE_PRIORITY_SOURCE = 'INJECTED_SELECTION_SCORE';
const CANDIDATE_PRIORITY_SOURCE_RESIDUAL = 'RESIDUAL_CASH_LEG';

/**
 * 候选组合构建的**稳定错误码**（跨端 seam 只比对错误码，不比对自由文本）。
 * 与 Python `portfolio_builder.CANDIDATE_ERR` 逐一对应；两端检查**顺序也必须一致**，
 * 否则同一非法输入会得到不同错误码，跨端比对就会产生「未定位差异」。
 */
const CANDIDATE_ERR = {
  ROLES_EMPTY: 'CANDIDATE_ROLES_EMPTY',
  ROLES_MISSING_FIELD: 'CANDIDATE_ROLES_MISSING_FIELD',
  ROLES_DUPLICATE: 'CANDIDATE_ROLES_DUPLICATE',
  PRIORITY_MISSING: 'CANDIDATE_PRIORITY_MISSING',
  PRIORITY_EXTRA_DATE: 'CANDIDATE_PRIORITY_EXTRA_DATE',
  PRIORITY_MISSING_DATE: 'CANDIDATE_PRIORITY_MISSING_DATE',
  PRIORITY_EXTRA_CODE: 'CANDIDATE_PRIORITY_EXTRA_CODE',
  PRIORITY_MISSING_CODE: 'CANDIDATE_PRIORITY_MISSING_CODE',
  PRIORITY_NOT_FINITE: 'CANDIDATE_PRIORITY_NOT_FINITE',
  WEIGHT_NOT_FINITE: 'CANDIDATE_WEIGHT_NOT_FINITE',
  CAP_NON_FINITE: 'CANDIDATE_CAP_NON_FINITE_WEIGHT',
  CAP_SINGLE: 'CANDIDATE_CAP_SINGLE_BREACHED',
  CAP_CLUSTER: 'CANDIDATE_CAP_CLUSTER_BREACHED',
  CAP_TECH: 'CANDIDATE_CAP_TECH_BREACHED',
  CAP_DAY_SUM: 'CANDIDATE_CAP_DAY_SUM_BREACHED'
};

/** 构造带稳定错误码的异常：消息固定为 `<CODE> :: <detail>`。 */
function candError(code, detail) {
  const e = new Error(code + ' :: ' + detail);
  e.code = code;
  return e;
}

/** 从异常提取稳定错误码（无 code 时退回 `::` 前缀，再退回原始消息）。 */
function candidateErrorCode(e) {
  if (e && e.code) return String(e.code);
  const msg = String((e && e.message) || e);
  return msg.indexOf(' :: ') > 0 ? msg.split(' :: ')[0] : msg;
}

function fixed10(x) { return Number(x).toFixed(10); }

function candidatePriorityHash(priority) {
  const rows = [];
  for (const d of Object.keys(priority).map(String).sort()) {
    const m = priority[d] || {};
    for (const c of Object.keys(m).map(String).sort()) rows.push(d + '~' + c + '~' + fixed10(m[c]));
  }
  return crypto.createHash('sha256').update(rows.join('|')).digest('hex');
}

function candidateConfigHash(pcfg, dcfg) {
  const clusters = (pcfg.tech_clusters || ['software_ai', 'tech_hardware']).map(String).sort();
  const tokens = [
    'max_single_weight=' + fixed10(pcfg.max_single_weight != null ? pcfg.max_single_weight : 0.25),
    'max_cluster_weight=' + fixed10(pcfg.max_cluster_weight != null ? pcfg.max_cluster_weight : 0.40),
    'max_tech_weight=' + fixed10(pcfg.max_tech_weight != null ? pcfg.max_tech_weight : 0.65),
    'tech_clusters=' + clusters.join(','),
    'risk_off_exposure_scale=' + fixed10(dcfg.risk_off_exposure_scale != null ? dcfg.risk_off_exposure_scale : 0.50),
    'risk_off_hedge_weight=' + fixed10(dcfg.risk_off_hedge_weight != null ? dcfg.risk_off_hedge_weight : 0.15)
  ];
  return crypto.createHash('sha256').update(tokens.join('|')).digest('hex');
}

const byCodeAsc = (a, b) => (String(a.code) < String(b.code) ? -1 : (String(a.code) > String(b.code) ? 1 : 0));

const CANDIDATE_EPS = 1e-9;

/**
 * 候选腿上限**体检**（不抛错；返回 `null` 或 `{gate, detail}`）。
 * 防守前 / 防守后共用同一实现 —— 保证「防守处理不得让任何上限越界」可被同一口径验证。
 */
function checkCandidateCaps(items, pcfg) {
  const maxSingle = pcfg.max_single_weight;
  const maxCluster = pcfg.max_cluster_weight;
  const maxTech = pcfg.max_tech_weight;
  const techClusters = pcfg.tech_clusters || [];
  let wMax = -Infinity;
  for (const r of items) {
    const w = Number(r.target_weight);
    if (!isFinite(w) || w < -CANDIDATE_EPS) {
      return { gate: CANDIDATE_ERR.CAP_NON_FINITE,
        detail: String(r.code) + ' 权重非有限或为负：' + String(r.target_weight) };
    }
    if (w > wMax) wMax = w;
  }
  if (items.length && wMax > maxSingle + CANDIDATE_EPS) {
    return { gate: CANDIDATE_ERR.CAP_SINGLE,
      detail: '单只上限被突破：max=' + wMax + ' > ' + maxSingle };
  }
  const clusterSum = {};
  const techSum = {};
  const daySum = {};
  for (const r of items) {
    const d = String(r.trade_date);
    daySum[d] = (daySum[d] || 0) + Number(r.target_weight);
    if (r.role !== 'CORE') continue;
    const ck = d + '~' + String(r.correlation_cluster);
    clusterSum[ck] = (clusterSum[ck] || 0) + Number(r.target_weight);
    if (techClusters.indexOf(r.correlation_cluster) >= 0) {
      techSum[d] = (techSum[d] || 0) + Number(r.target_weight);
    }
  }
  for (const k in clusterSum) {
    if (clusterSum[k] > maxCluster + CANDIDATE_EPS) {
      return { gate: CANDIDATE_ERR.CAP_CLUSTER,
        detail: 'cluster 上限被突破：' + k + '=' + clusterSum[k] + ' > ' + maxCluster };
    }
  }
  for (const k in techSum) {
    if (techSum[k] > maxTech + CANDIDATE_EPS) {
      return { gate: CANDIDATE_ERR.CAP_TECH,
        detail: '广义科技上限被突破：' + k + '=' + techSum[k] + ' > ' + maxTech };
    }
  }
  for (const k in daySum) {
    if (daySum[k] > 1 + CANDIDATE_EPS) {
      return { gate: CANDIDATE_ERR.CAP_DAY_SUM,
        detail: '持仓合计超过 1：' + k + '=' + daySum[k] };
    }
  }
  return null;
}

/** 上限复核（越界即抛错，绝不静默缩、绝不重置为等权）。 */
function assertCandidateCaps(items, pcfg, phase) {
  const bad = checkCandidateCaps(items, pcfg);
  if (bad) throw candError(bad.gate, (phase || 'PRE_DEFENSE') + '：' + bad.detail);
}

/**
 * priority 必须**严格等于**角色面板的 `(trade_date, code)` 集合：
 * **缺、多、重复、非有限一律失败**。
 *
 * 关键点：本校验在 `candidatePriorityHash()` **之前**执行 —— 因此「多余且未被消费的分数」
 * 根本进不了哈希，不可能出现「不可见输入影响 provenance」。
 */
function assertPriorityExactCoverage(roles, priority) {
  const byDate = {};
  for (const r of roles) {
    const d = String(r.trade_date);
    (byDate[d] = byDate[d] || []).push(String(r.code));
  }
  const rDates = Object.keys(byDate).sort();
  const pDates = Object.keys(priority).map(String).sort();
  const extraDates = pDates.filter((d) => rDates.indexOf(d) < 0);
  const missingDates = rDates.filter((d) => pDates.indexOf(d) < 0);
  if (extraDates.length) {
    throw candError(CANDIDATE_ERR.PRIORITY_EXTRA_DATE,
      'priority 含角色面板之外的交易日：' + JSON.stringify(extraDates));
  }
  if (missingDates.length) {
    throw candError(CANDIDATE_ERR.PRIORITY_MISSING_DATE,
      'priority 缺交易日：' + JSON.stringify(missingDates));
  }
  for (const d of rDates) {
    const got = byDate[d].slice().sort();
    if (new Set(got).size !== got.length) {
      throw candError(CANDIDATE_ERR.ROLES_DUPLICATE, '角色面板存在重复 (trade_date, code)：' + d);
    }
    const m = priority[d];
    if (!m || typeof m !== 'object' || Array.isArray(m) || Object.keys(m).length === 0) {
      throw candError(CANDIDATE_ERR.PRIORITY_MISSING, 'priority[' + d + '] 必须是非空映射 {code: score}');
    }
    const have = Object.keys(m).map(String).sort();
    const extra = have.filter((c) => got.indexOf(c) < 0);
    const missing = got.filter((c) => have.indexOf(c) < 0);
    if (extra.length) {
      throw candError(CANDIDATE_ERR.PRIORITY_EXTRA_CODE,
        'priority[' + d + '] 含角色面板之外的 code：' + JSON.stringify(extra));
    }
    if (missing.length) {
      throw candError(CANDIDATE_ERR.PRIORITY_MISSING_CODE,
        'priority[' + d + '] 缺 code：' + JSON.stringify(missing));
    }
  }
}

/**
 * 角色面板 → **未四舍五入**的显式 selection score 映射（priority 的唯一合法来源）。
 *
 * 取值来自 `features.alpha_score_v2` —— 刻意**绕过** `buildDailyRoles` 输出的 2 位四舍五入，
 * 使 priority 与权威路径（Python）的分数口径一致。键集合严格等于角色面板 `(trade_date, code)`。
 */
function priorityFromUnroundedScore(roles, features) {
  const byKey = {};
  for (const f of features) byKey[String(f.trade_date) + '~' + String(f.code)] = f.alpha_score_v2;
  const out = {};
  for (const r of roles) {
    const d = String(r.trade_date);
    const c = String(r.code);
    const s = byKey[d + '~' + c];
    if (s == null || !isFinite(Number(s))) {
      throw new Error('缺未四舍五入的显式 selection score（priority 唯一合法来源）：' + d + '/' + c);
    }
    (out[d] = out[d] || {})[c] = Number(s);
  }
  return out;
}


function buildCandidatePortfolio(roles, opts) {
  const o = opts || {};
  const pcfg = Object.assign({
    max_single_weight: 0.25, max_cluster_weight: 0.40, max_tech_weight: 0.65,
    tech_clusters: ['software_ai', 'tech_hardware']
  }, o.portfolio_config || {});
  const dcfg = Object.assign({
    risk_off_exposure_scale: 0.50, risk_off_hedge_weight: 0.15, hedge_code: '518880',
    vol_target_enabled: true, vol_target_annualized: 0.17
  }, o.defense_config || {});
  const priority = o.priority;
  // 检查顺序与 Python `build_portfolio_candidates` **逐条对齐**（否则同一非法输入得到不同错误码）
  if (!Array.isArray(roles) || roles.length === 0) {
    throw candError(CANDIDATE_ERR.ROLES_EMPTY, 'roles 为空，无法构建候选组合');
  }
  for (const f of ['trade_date', 'code', 'role', 'target_weight']) {
    if (roles[0][f] === undefined || roles[0][f] === null) {
      throw candError(CANDIDATE_ERR.ROLES_MISSING_FIELD,
        'roles 缺字段 ' + f + '：候选组合必须直接沿用角色面板权威权重（B1/B4）');
    }
  }
  if (priority === null || priority === undefined
      || typeof priority !== 'object' || Array.isArray(priority)
      || Object.keys(priority).length === 0) {
    throw candError(CANDIDATE_ERR.PRIORITY_MISSING,
      '缺显式 priority：研究路径禁止回退 legacy rank（B2）');
  }
  const EPS = 1e-9;
  // 严格集合校验**先于**哈希：多余 / 缺失 / 重复 / 非有限一律失败
  // → 「多余且未被消费的分数」不可能进入 priority_hash（裁决 2026-09-14 缺口 ③）
  assertPriorityExactCoverage(roles, priority);
  const ph = candidatePriorityHash(priority);

  const byDate = {};
  for (const r of roles) (byDate[r.trade_date] = byDate[r.trade_date] || []).push(r);

  const out = [];
  for (const d of Object.keys(byDate).sort()) {
    const m = priority[d];
    const scored = byDate[d].map((r) => {
      const c = String(r.code);
      const s = Number(m[c]);
      if (!isFinite(s)) {
        throw candError(CANDIDATE_ERR.PRIORITY_NOT_FINITE, 'priority 非有限值 ' + d + '/' + c);
      }
      if (!isFinite(Number(r.target_weight))) {
        throw candError(CANDIDATE_ERR.WEIGHT_NOT_FINITE,
          '角色面板 target_weight 非有限：' + d + '/' + c + '（B1：候选组合必须直接沿用角色面板权威权重）');
      }
      return { r, c, s };
    });
    scored.sort((a, b) => (b.s - a.s) || (a.c < b.c ? -1 : (a.c > b.c ? 1 : 0)));
    scored.forEach((x, i) => {
      out.push(Object.assign({}, x.r, {
        code: x.c,
        target_weight: Number(x.r.target_weight),
        priority: i + 1,
        priority_score: x.s,
        priority_source: CANDIDATE_PRIORITY_SOURCE,
        priority_hash: ph,
        sleeve: CANDIDATE_SLEEVE
      }));
    });
  }

  // B1 防守前上限复核（越界即抛错，绝不静默缩、更不重置为等权）
  assertCandidateCaps(out, pcfg, 'PRE_DEFENSE');

  // 防守腿（regime + vol target）—— 与 Python `apply_regime_defense` 同式，
  // 复用**同一实现** applyDefenseToItems（不再各自写一份）
  const bench = {};
  for (const b of (o.benchmark || [])) bench[String(b.trade_date)] = b;
  let applied = out;
  if (o.apply_defense) {
    if (!Array.isArray(o.benchmark)) {
      throw candError('CANDIDATE_DEFENSE_FEATURES_MISSING',
        'apply_defense=true 必须提供 benchmark（regime 输入）');
    }
    applied = applyDefenseToItems(out, bench, dcfg);
    // 裁决（2026-09-14）缺口 ②：**防守处理后必须再次跑完整上限校验**。
    // 只在防守前查一次是不够的 —— hedge_weight / exposure_scale 配置过大时，
    // 防守腿（hedge 绝对权重）与缩仓后的腿都可能越界。
    assertCandidateCaps(applied, pcfg, 'POST_DEFENSE');
  }

  // 现金腿（residual）：累加顺序固定 code 升序 → 与 Python 端 IEEE 结果逐位一致
  const byDay = {};
  for (const r of applied) (byDay[r.trade_date] = byDay[r.trade_date] || []).push(r);
  const result = [];
  for (const d of Object.keys(byDay).sort()) {
    const day = byDay[d].slice().sort(byCodeAsc);
    let invested = 0;
    for (const r of day) invested += r.target_weight;
    if (invested > 1 + EPS) {
      throw candError(CANDIDATE_ERR.CAP_DAY_SUM, '持仓合计超过 1 @ ' + d + '：' + invested);
    }
    const t = day[0];
    for (const r of day) result.push(r);
    result.push({
      trade_date: t.trade_date, code: CANDIDATE_CASH_CODE, name: '现金',
      correlation_cluster: 'cash', role: 'CASH', target_weight: Math.max(0, 1 - invested),
      priority: day.length + 1, priority_score: null,
      priority_source: CANDIDATE_PRIORITY_SOURCE_RESIDUAL, priority_hash: ph,
      sleeve: CANDIDATE_SLEEVE, defense_state: t.defense_state
    });
  }
  result.sort((a, b) => {
    const da = String(a.trade_date); const db = String(b.trade_date);
    if (da !== db) return da < db ? -1 : 1;
    return a.priority - b.priority;
  });
  return result;
}

/**
 * **benchmark 帧字段名适配**（裁决 2026-09-14 缺口 ⑤，端到端回归发现）。
 *
 * `computeTimeSeriesFeatures()` 产出的**原始 benchmark 帧**用内部名 `px_ma20` / `px_ma60`
 * （`addBenchmark()` 只把公开名 `benchmark_px_ma20/ma60` 写到 **ETF 行**上）；而防守 regime
 * （`buildDefenseSignals`，与 Python `defense_gate._build_defense_signal` **同契约**）读的是**公开名**。
 *
 * 若把原始 benchmark 帧直接喂进 seam → `hasMa` 恒为 false → regime 恒 `NORMAL`
 * → **防守腿永不触发**（线上静默失效；G2S-10 fixture 自带公开名，所以 seam 对表「蒙对」，
 * parity 全绿也发现不了）。本函数把内部名统一适配为公开名，使线上决策链与 fixture seam
 * 的输入契约逐字一致；两条链路共用它，不可能再各喂一套。
 */
function toBenchmarkRows(benchmarkFeatures) {
  return (benchmarkFeatures || []).map((b) => Object.assign({}, b, {
    benchmark_px_ma20: b.benchmark_px_ma20 != null ? b.benchmark_px_ma20 : b.px_ma20,
    benchmark_px_ma60: b.benchmark_px_ma60 != null ? b.benchmark_px_ma60 : b.px_ma60
  }));
}

/**
 * **特征帧构建**（`barsByCode` → `features`）：与 `main()` 共用同一实现，供端到端回归从原始 bars 重放。
 *
 * 抽出的动机同上（`buildCandidatePanel`）：让「线上决策链」与「测试断言」不可能各算一套特征。
 * 回归测试用本函数 + `buildCandidatePanel()` 从原始 bars **完整重放**整条链路，
 * 再与 `main()` 实际写入 DB 的 candidate leg 逐字段比对。
 */
function computeFeatureFrame(barsByCode, codes) {
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
  // WP-G2-05（F1）：评分 provenance + 校验（canonical 权重来自 bundle.alpha；显式注入时精确覆盖校验）
  const selectionMeta = applySelectionScores(features, null);
  features = rankFeatures(features);
  return { features, benchmarkFeatures, selectionMeta };
}

/**
 * **唯一候选面板构建**（WP-G2-06 / 裁决 2026-09-14）：`main()` 与端到端回归**共用同一实现**。
 *
 * 抽取动机：用户裁决发现「PR 新增的 `buildCandidatePortfolio()` 只被 `_internal` / G2S-10 调用，
 * 没有被 `main()` 消费」——300/300 parity 证明的是新 seam，不是线上 Shadow 实际发布的候选组合。
 * 把整条链路收敛到本函数后，`main()` 与回归断言走**同一段代码**：
 * 一旦 `main()` 退回旧链路（legacy 1/n 等权 / `applyDefense`），本函数即被绕过，
 * 端到端回归（tests/gen2-candidate-leg-e2e.test.js）会立刻变红。
 *
 * 链路：`features → buildDailyRoles → 当日横截面 → 未四舍五入的显式 selection score（priority）
 *       → attachAuthoritativeWeights（唯一权重算法）→ buildCandidatePortfolio（含现金腿 + 防守腿）`
 *
 * @param {Array} features 合并 benchmark 后的全历史特征（`buildDailyRoles` 需全历史，滞后状态机）
 * @param {string} latestDate 当日横截面日期（候选面板只取当日快照）
 * @param {Array} benchmarkFeatures benchmark（510300）特征，供防守 regime / vol target
 * @returns {{roles,latestRoles,weightedRoles,priority,candidateLegs,latestLegs,latestSecurities,candCfgHash,candPrioHash}}
 */
function buildCandidatePanel(features, latestDate, benchmarkFeatures) {
  // 角色层吃全历史（滞后状态机），但**候选面板只取当日横截面**
  const roles = buildDailyRoles(features);
  const latestRoles = roles.filter((r) => r.trade_date === latestDate);
  let priority;
  try {
    priority = priorityFromUnroundedScore(latestRoles, features);
  } catch (e) {
    // 角色面板缺「未四舍五入的显式 selection score」= 当日数据不足以构成可信候选 →
    // 打上稳定码让 main() 判 `blocked`（可预期的业务结果），**不是** failed/SYSTEM_ERROR。
    const err = new Error(String((e && e.message) || e));
    err.code = 'CANDIDATE_PRIORITY_INCOMPLETE';
    throw err;
  }
  const weightedRoles = attachAuthoritativeWeights(latestRoles);
  const candidateLegs = buildCandidatePortfolio(weightedRoles, {
    priority,
    portfolio_config: PORTFOLIO_CFG,
    defense_config: DEFENSE_CFG,
    benchmark: toBenchmarkRows(benchmarkFeatures),
    apply_defense: DEFENSE_CFG.enabled !== false
  });
  const latestLegs = candidateLegs.filter((r) => r.trade_date === latestDate);
  const legByCode = {};
  for (const r of latestLegs) legByCode[String(r.code)] = r;
  const latestSecurities = weightedRoles.map((r) => legByCode[String(r.code)]);
  if (latestSecurities.some((x) => !x)) {
    throw new Error('候选腿未覆盖当日全部角色（buildCandidatePortfolio 输出不完整）');
  }
  return {
    roles,
    latestRoles,
    weightedRoles,
    priority,
    candidateLegs,
    latestLegs,
    latestSecurities,
    candCfgHash: candidateConfigHash(PORTFOLIO_CFG, DEFENSE_CFG),
    candPrioHash: candidatePriorityHash(priority)
  };
}

/* ---------------- 主流程 ---------------- */

// 跨语言 Parity 测试入口：暴露纯决策函数（供 scripts/parity/run_node.js 调用），不改生产行为。
exports._internal = {
  UNIVERSE,
  PORTFOLIO_CFG,
  DEFENSE_CFG,
  CORE_PCT,
  CHALLENGER_PCT,
  SATELLITE_PCT,
  marketScore,
  classifyRegime,
  selectionMode,
  promotionAllowed,
  maxCoreCount,
  computeLeadershipScore,
  rankFeatures,
  initialRoles,
  buildDailyRoles,
  // WP-G2-06：权威权重（唯一算法）+ 旧的委托壳（仅 WP-G2-01 parity 链用）
  attachAuthoritativeWeights,
  buildPortfolioCandidates,
  applyDefense,
  buildDefenseSignals,
  applyDefenseToItems,
  // WP-G2-06（F4）：统一候选组合构建（跨端 parity seam）—— 权威权重复核 + 注入 priority + 现金/防守腿
  buildCandidatePortfolio,
  // WP-G2-06 / 裁决 2026-09-14：**唯一候选面板构建**（main() 与端到端回归共用同一实现）
  buildCandidatePanel,
  computeFeatureFrame,
  toBenchmarkRows,
  priorityFromUnroundedScore,
  assertPriorityExactCoverage,
  checkCandidateCaps,
  candidatePriorityHash,
  candidateConfigHash,
  CANDIDATE_SLEEVE,
  CANDIDATE_CASH_CODE,
  CANDIDATE_ERR,
  candidateErrorCode,
  validateCandidateLegPublish,
  // WP-G2-03：角色生成统一出口（替换事务 + 无条件终局约束检查）与两个组件，供跨语言 parity 读取
  finalizeRoles,
  applyReplacementGate,
  assertFinalRoleConstraints,
  // WP-G2-03：run 状态四态的纯函数 seam（数据完整性体检 + 发布完整性校验）
  inspectBarsIntegrity,
  validatePublishResults,
  // WP-G2-05：显式 Selection Score 注入链 + 角色阈值（F1/F2）
  ROLE_THRESHOLDS,
  resolveRoleThresholds,
  // WP-G2-05R：规则 bundle 闸门 + 旧字段的**离线**迁移助手（运行路径不得调用）
  RULE_BUNDLE_REASON,
  RULE_BUNDLE_GATE,
  deriveRoleThresholdsFromLegacy,
  SELECTION_SCORE_WEIGHTS,
  SELECTION_SCORE_VERSION,
  SELECTION_SCORE_SOURCE,
  SELECTION_COMPONENT_FIELDS,
  combineSelectionScore,
  selectionScoreHash,
  validateSelectionWeights,
  applySelectionScores
};

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

    // F01：数据闸门（P0-1 重写）——独立应到交易日 + 唯一交易日 + benchmark 完整性 + LIVE/REPLAY 分离。
    // 核心契约：绝不把「陈旧批次」「唯一交易日不足」「benchmark 特征未就绪」标成可消费的 FULL。
    const MIN_HISTORY_DAYS = 120;        // 候选「唯一交易日」下限（对齐 Python 120 行语义，但按唯一日计算）
    const BENCHMARK_MIN_DAYS = 60;       // benchmark「唯一交易日」下限（MA20/MA60/vol 必要输入）
    let mode = (event.mode === 'REPLAY') ? 'REPLAY' : 'LIVE';
    const expectedTradeDate = dateKey(event.expected_trade_date || event.as_of_trade_date) || null;

    // 闸门失败：写 blocked 运行记录（不得产生 completed 决策快照），再返回
    /**
     * 数据/资格/约束闸门未通过 → run 状态 **blocked**（可预期的业务结果，不是系统故障）。
     * 四态契约（WP-G2-03）：running → completed | blocked | failed
     *   blocked  今日没有可信的 Gen-2 结果（数据陈旧/重复/缺基准/短历史/无合格标的/规则不完整等），
     *            前台只展示 V3.6.1
     *   failed   代码/网络/数据库等运行异常，系统未正常完成
     * 二者处理、告警与文案必须区分，不得合并。
     *
     * status_reason 取值：DATA_OR_ELIGIBILITY_GATE（数据/资格闸门）/
     * RULE_BUNDLE_INCOMPLETE（规则 bundle 缺显式必需配置 → 见 RULE_BUNDLE_GATE）/ PUBLISH_VALIDATION_FAILED。
     */
    const failGate = async (gate, error, extra = {}) => {
      // status_reason 默认数据/资格闸门；规则 bundle 闸门通过 extra 显式传入 RULE_BUNDLE_INCOMPLETE。
      const statusReason = extra.status_reason || 'DATA_OR_ELIGIBILITY_GATE';
      try {
        await db.upsert(COLLECTIONS.GEN2_SHADOW, {
          type: 'gen2_run', run_id: runId, engine_id: ENGINE_ID,
          universe_version: UNIVERSE.version, mode, status: 'blocked',
          status_reason: statusReason,
          data_gate: gate, error: String(error || '').slice(0, 300),
          created_at: new Date().toISOString()
        }, { type: 'gen2_run', run_id: runId });
      } catch (e2) { /* 忽略失败记录落库失败 */ }
      return { ok: false, status: 'blocked', status_reason: statusReason, error: String(error || ''), data_gate: gate, mode, ...extra };
    };

    // -1) 规则 bundle 闸门（**优先于任何数据读取与统计**，编号与夹具 gate_order 的 `-1` 对齐）：
    //     bundle 缺显式 selection.role_thresholds（或提供但非法）→ 本次运行 blocked /
    //     RULE_BUNDLE_INCOMPLETE。绝不 fallback 到旧 top_quantile：那会产出一套「未经显式声明」
    //     的角色分层，并与 Python 端（缺配置直接失败）语义分裂。
    if (RULE_BUNDLE_GATE) {
      await diag('rule_bundle_gate', RULE_BUNDLE_GATE.gate + ' :: ' + RULE_BUNDLE_GATE.detail);
      return await failGate(RULE_BUNDLE_GATE.gate, RULE_BUNDLE_GATE.detail,
        { status_reason: RULE_BUNDLE_REASON, rule_bundle_status: 'INCOMPLETE' });
    }

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

    // 0) 输入完整性（A2：字段完整性 + 唯一交易日）——早于任何统计，脏数据不得参与排名。
    const integrity = inspectBarsIntegrity(barsByCode, allCodes);
    if (integrity) return await failGate(integrity.gate, integrity.detail, integrity);

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
    // 完整横截面契约（A2/A3：universe_count=30 才允许发布；规划 §A2「非 30 资产 → blocked」）。
    // 缺任何一只即无法保证横截面百分位/角色约束可信，故宁可 blocked 也不发布残缺结果。
    if (codes.length !== UNIVERSE.target_size) {
      return await failGate(
        'UNIVERSE_INCOMPLETE',
        `当日合格横截面 ${codes.length}/${UNIVERSE.target_size}，缺 ${UNIVERSE.target_size - codes.length} 只，禁止发布不完整横截面`,
        { as_of: asOf, excluded, eligible_count: codes.length });
    }
    // 统一把内存数据清洗为「去重 + 截断到 dataCutoff」后的版本，后续特征/角色一律消费清洗后数据
    for (const c of Object.keys(barsByCode)) {
      const clean = dedupByDate(barsByCode[c]).filter((b) => dateKey(b.trade_date) <= dataCutoff);
      barsByCode[c] = clean.sort((a, b) => (a.trade_date < b.trade_date ? -1 : 1));
    }
    await diag('data_gate', 'mode=' + mode + ' asOf=' + asOf + ' loaded=' + loadedCount + ' eligible=' + codes.length + ' excluded=' + excluded.length);

    // 2. 特征（按 code 正序）—— 收敛在 `computeFeatureFrame()`，与端到端回归共用同一实现
    const { features, benchmarkFeatures, selectionMeta } = computeFeatureFrame(barsByCode, codes);

    // 只保留最近一个交易日（落库最新横截面）
    const dates = [...new Set(features.map((f) => f.trade_date))].sort();
    const latestDate = dates[dates.length - 1];
    const latest = features.filter((f) => f.trade_date === latestDate && f.alpha_score_v2 != null);

    // 3. **唯一链路**（WP-G2-06 / 裁决 2026-09-14）：
    //      角色面板 → 权威权重（唯一算法） → 未四舍五入的显式 selection score（priority 唯一来源）
    //               → buildCandidatePortfolio（含现金腿 + 防守腿）
    //    整条链路收敛在 `buildCandidatePanel()` —— **main() 与端到端回归共用同一实现**，
    //    因此「线上发布的候选组合」与「跨端 parity 断言的候选组合」不可能各算一套。
    //    旧的 `buildPortfolioCandidates()` / `applyDefense()` 在 main() 中**已无消费者**
    //    （它们只剩 WP-G2-01 旧 parity 链的委托壳，见各自 @deprecated 注释）。
    let panel;
    try {
      panel = buildCandidatePanel(features, latestDate, benchmarkFeatures);
    } catch (e) {
      if (e && e.code === 'CANDIDATE_PRIORITY_INCOMPLETE') {
        return await failGate('CANDIDATE_PRIORITY_INCOMPLETE', String(e.message || e));
      }
      throw e; // 真实缺陷（cap 越界等）→ 外层 failed/SYSTEM_ERROR，不得伪装成 blocked
    }
    const {
      roles, latestRoles, weightedRoles, latestLegs, latestSecurities, candCfgHash, candPrioHash
    } = panel;
    await diag('computed', 'latest=' + latestDate + ' roles=' + roles.length
      + ' panel=' + latestRoles.length + ' candidate_legs=' + latestLegs.length
      + ' priority_hash=' + candPrioHash.slice(0, 12));

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
      // WP-G2-05：Alpha 与角色阈值的 provenance（可审计；不是从 legacy 字段反推）
      // 运行路径已由规则 bundle 闸门保证 ROLE_THRESHOLDS.ok=true（缺显式配置走不到这里）
      selection_score_version: selectionMeta.score_version,
      selection_score_source: selectionMeta.score_source,
      selection_score_hash: selectionMeta.score_hash,
      selection_score_coverage: selectionMeta.score_coverage,
      selection_score_null_rows: selectionMeta.score_null_rows,
      role_thresholds: ROLE_THRESHOLDS.top_fractions,
      role_thresholds_source: ROLE_THRESHOLDS.source,
      benchmark: UNIVERSE.benchmark_code,
      // WP-G2-06：候选组合（Gen-2 candidate sleeve）provenance —— 可审计、可对表
      candidate_sleeve: CANDIDATE_SLEEVE,
      candidate_leg_count: latestLegs.length,
      candidate_priority_source: CANDIDATE_PRIORITY_SOURCE,
      candidate_priority_hash: candPrioHash,
      candidate_config_hash: candCfgHash,
      status: 'running', // F12：先标 running，全部 ranking + candidate leg 写完后置 completed
      production_write: false,
      auto_execution: false,
      created_at: new Date().toISOString()
    };
    await db.upsert(COLLECTIONS.GEN2_SHADOW, runDoc, { type: 'gen2_run', run_id: runId });

    // 4a. 写 gen2_ranking —— **只承载 ETF 排名**（30 条）。现金腿**不进这里**：
    //     现金没有 alpha，塞进排名会直接被 validatePublishResults（要求 alpha 有限）判失败。
    let written = 0;
    const writtenCodes = new Set();
    for (const r of latestSecurities) {
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

    // 4b. 写 gen2_candidate_leg（**30 ETF + CASH**）—— Gen-2 candidate sleeve，
    //     带 priority / priority_score / priority_hash / config_hash 与 sleeve 归属。
    //     绝不写入 V3.6.1 的 final_target（那是正式仓位口径，不是研究候选）。
    let legWritten = 0;
    for (const r of latestLegs) {
      await db.upsert(COLLECTIONS.GEN2_SHADOW, {
        type: 'gen2_candidate_leg',
        run_id: runId,
        trade_date: r.trade_date,
        code: r.code,
        name: r.name,
        role: r.role,
        correlation_cluster: r.correlation_cluster,
        target_weight: r.target_weight,
        priority: r.priority,
        priority_score: r.priority_score == null ? null : r.priority_score,
        priority_source: r.priority_source,
        priority_hash: r.priority_hash,
        config_hash: candCfgHash,
        defense_state: r.defense_state == null ? null : r.defense_state,
        sleeve: CANDIDATE_SLEEVE,
        engine_id: ENGINE_ID,
        universe_version: UNIVERSE.version,
        production_write: false,
        created_at: new Date().toISOString()
      }, { type: 'gen2_candidate_leg', run_id: runId, code: r.code });
      legWritten += 1;
    }

    // P1-2：发布前完整性校验 —— 排名（唯一 code / 有限 alpha）与候选腿（守恒 / 上限 / 腿 / hash）
    // **两类记录都通过**才允许标 completed（WP-G2-03 四态 + WP-G2-06 裁决）。
    const pub = validatePublishResults(latestSecurities, written);
    const pubLeg = validateCandidateLegPublish(latestLegs, {
      trade_date: latestDate,
      portfolio_config: PORTFOLIO_CFG,
      defense_config: DEFENSE_CFG,
      config_hash: candCfgHash,
      written: legWritten,
      expect_defense_leg: latestLegs.some((r) => r.defense_state === 'RISK_OFF')
    });
    if (!pub.ok || !pubLeg.ok) {
      // WP-G2-03 四态：输出完整性问题 = 今日没有可信结果 → blocked（不是系统故障）
      const reason = !pub.ok ? 'PUBLISH_VALIDATION_FAILED' : 'CANDIDATE_LEG_PUBLISH_FAILED';
      const failDetail = !pub.ok
        ? `Publish validation failed: unique=${pub.unique_code_count}/${pub.row_count}`
          + ` non_finite_alpha=${pub.non_finite_alpha} written=${written}`
        : `Candidate leg validation failed: ${pubLeg.data_gate} :: ${pubLeg.detail}`;
      await db.upsert(COLLECTIONS.GEN2_SHADOW, {
        ...runDoc, status: 'blocked',
        status_reason: reason,
        fail_reason: failDetail,
        completed_at: null
      }, { type: 'gen2_run', run_id: runId });
      return {
        ok: false, status: 'blocked', status_reason: reason,
        error: !pub.ok
          ? 'Gen-2 发布前完整性校验失败，不发布 completed'
          : 'Gen-2 候选腿发布校验失败，不发布 completed',
        data_gate: !pub.ok ? 'PUBLISH_VALIDATION_FAILED' : pubLeg.data_gate,
        written, leg_written: legWritten
      };
    }

    // F12：全部 ranking + candidate leg 写完后，原子发布 completed（半途失败则停留在 running，
    // 不误读为完整横截面）
    await db.upsert(COLLECTIONS.GEN2_SHADOW, {
      ...runDoc, status: 'completed', completed_at: new Date().toISOString(),
      written, leg_written: legWritten
    }, { type: 'gen2_run', run_id: runId });

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
      leg_written: legWritten,
      candidate_sleeve: CANDIDATE_SLEEVE,
      candidate_priority_hash: candPrioHash,
      candidate_config_hash: candCfgHash,
      ranking: latestSecurities.map((r) => ({
        code: r.code, name: r.name, rank: r.rank,
        alpha_score_v2: r.alpha_score_v2, role: r.role,
        target_weight: r.target_weight, defense_state: r.defense_state
      })),
      candidate_legs: latestLegs.map((r) => ({
        code: r.code, role: r.role, target_weight: r.target_weight,
        priority: r.priority, defense_state: r.defense_state
      })),
      production_write: false,
      duration_ms: Date.now() - startedAt
    };
  } catch (e) {
    const errMsg = String(e && e.message ? e.message : e);
    // WP-G2-03 四态：代码/网络/数据库等**运行异常** → failed（与 blocked 严格区分）：
    //   failed 表示系统未正常完成；blocked 表示系统正常但今日数据/资格/约束未通过。
    try {
      await db.upsert(COLLECTIONS.GEN2_SHADOW, {
        type: 'gen2_run', run_id: runId, engine_id: ENGINE_ID,
        universe_version: UNIVERSE.version, status: 'failed',
        status_reason: 'SYSTEM_ERROR',
        error: errMsg.slice(0, 300),
        created_at: new Date().toISOString(),
        completed_at: new Date().toISOString()
      }, { type: 'gen2_run', run_id: runId });
    } catch (e2) { /* 忽略失败记录落库失败 */ }
    try {
      await db.upsert(COLLECTIONS.GEN2_SHADOW, {
        type: 'gen2_error',
        run_id: runId,
        error: errMsg,
        stack: e && e.stack ? String(e.stack).slice(0, 800) : null,
        created_at: new Date().toISOString()
      }, { type: 'gen2_error', run_id: runId });
    } catch (e2) { /* 忽略错误落库失败 */ }
    return { ok: false, status: 'failed', status_reason: 'SYSTEM_ERROR', error: errMsg };
  }
};
