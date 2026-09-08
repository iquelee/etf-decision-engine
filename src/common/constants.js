/**
 * 全局常量（后端）——单一事实源
 *
 * 说明（共享知识 B3-4）：
 * - 本文件存默认值与冻结清单；运行时阈值读 param_config，但 FROZEN_PARAM_KEYS 禁止后台改；
 * - 状态机枚举与中文文案在此定义，前端 web/src/utils/constants.js 存一份一致副本；
 * - 字段 snake_case、日期 string YYYY-MM-DD、百分比数值（30=30%）、金额单位元、数量单位份。
 *
 * @module constants
 */

'use strict';

/** 集合名（单一真相） */
const COLLECTIONS = {
  ETF_BASIC: 'etf_basic',
  ETF_DAILY: 'etf_daily',
  ETF_WEEKLY: 'etf_weekly',
  INDICATOR_SNAPSHOT: 'indicator_snapshot',
  FUNDAMENTAL_CONFIG: 'fundamental_config',
  FUNDAMENTAL_SERIES: 'fundamental_series',
  FUNDAMENTAL_STATE: 'fundamental_state',
  RISK_EVENTS: 'risk_events',
  PORTFOLIO_POSITION: 'portfolio_position',
  PORTFOLIO_SNAPSHOT: 'portfolio_snapshot',
  DECISION_RESULT: 'decision_result',
  SHADOW_V3_LOG: 'shadow_v3_log',
  /** 运行状态单一真相（runDecisionEngine 每次运行后落库；前后端统一读它，禁止再凭 VERSION.txt / shadow log 各说一套） */
  RUNTIME_STATUS: 'runtime_status',
  /** Gen-1 Shadow 日信号（EOD 推送；观察元数据，不改仓位） */
  ML_SHADOW_SIGNAL: 'ml_shadow_signal',
  /** Gen-2 Shadow 日观测（ranking/roles/portfolio_candidates；只读，不改生产仓位） */
  GEN2_SHADOW: 'gen2_shadow',
  /** Gen-2 研究日线（qfq 前复权，独立于生产 etf_daily，供 Gen-2 Shadow 对齐 Python 研究版口径） */
  GEN2_DAILY: 'gen2_daily',
  /** Integrated Shadow 组合运行元数据（run_id → 依赖门/状态/计数；只读反事实，不写生产） */
  INTEGRATED_SHADOW_RUN: 'integrated_shadow_run',
  /** Integrated Shadow 每只 ETF 结果（run_id + code 唯一；四层权限模型 + explain chain） */
  INTEGRATED_SHADOW_RESULT: 'integrated_shadow_result',
  TRADE_LOG: 'trade_log',
  PARAM_CONFIG: 'param_config',
  FETCH_LOG: 'fetch_log',
  NEWS_FEED: 'news_feed',
  ETF_HOLDINGS: 'etf_holdings',
  FUNDAMENTAL_EVIDENCE: 'fundamental_evidence',
  MARKET_ENV: 'market_env',
  GLOBAL_QUOTE: 'global_quote',
  GLOBAL_FINANCIAL: 'global_financial',
  MACRO: 'macro'
};

/** 对外展示版本兜底值。运行时真实版本读 runtime_status.production_engine（/api/constants 下发），此值仅在 runtime_status 未落库时兜底 */
const ENGINE_VERSION = 'V3.6.1';

/**
 * 后台 updateParam 禁止改这些 key（文档冻结清单）。
 * 解冻只能改本数组，不要从 ParamConfig 页面绕过。
 */
const FROZEN_PARAM_KEYS = [
  'volume_ratio_mild',
  'tech_sector_max',
  // V4.0 ML Gen-1 Shadow：观察开、接线关 —— 禁止后台改闸门
  'ml_fast_path_enabled',
  'ml_challenger_model_id',
  'ml_gen1_frozen',
  'ml_shadow_bundle_id'
];

/** trade_log 更新允许写入的字段 */
const TRADE_LOG_UPDATE_FIELDS = [
  'trade_date', 'code', 'action', 'shares', 'price', 'amount',
  'reason', 'decision_id', 'position_after', 'add_mode'
];

function pickTradeUpdate(payload) {
  const out = {};
  TRADE_LOG_UPDATE_FIELDS.forEach((k) => {
    if (payload && payload[k] !== undefined) out[k] = payload[k];
  });
  return out;
}

/** 周线状态 W1~W5 */
const W_STATES = {
  W1: 'W1', W2: 'W2', W3: 'W3', W4: 'W4', W5: 'W5'
};
const W_STATE_LABELS = {
  W1: '强趋势', W2: '趋势完整', W3: '周线震荡', W4: '趋势破坏', W5: '趋势反转'
};

/** 日线状态 D1~D5 */
const D_STATES = { D1: 'D1', D2: 'D2', D3: 'D3', D4: 'D4', D5: 'D5' };
const D_STATE_LABELS = {
  D1: '上涨', D2: '上涨后横盘', D3: '正常回调', D4: '高位震荡', D5: '趋势破坏'
};

/** 横盘质量 H1~H5 */
const H_STATES = { H1: 'H1', H2: 'H2', H3: 'H3', H4: 'H4', H5: 'H5' };
const H_STATE_LABELS = {
  // P2 文案修正（2026-08-22）：H1 规则已改为「Score≥75 + 上涨后整理」，旧标签"≥15日缩量"误导
  H1: '优秀整理(Score≥75·上涨后)', H2: '良好整理(Score≥65)', H3: '一般(量未降)', H4: '危险(高点下降)', H5: '防守(放量破位)'
};

/** 量能状态 V1~V5 */
const V_STATES = { V1: 'V1', V2: 'V2', V3: 'V3', V4: 'V4', V5: 'V5' };
const V_STATE_LABELS = {
  V1: '强缩量', V2: '温和缩量', V3: '正常量能', V4: '放量', V5: '异常放量'
};

/** 基本面状态 F1~F5 */
const F_STATES = { F1: 'F1', F2: 'F2', F3: 'F3', F4: 'F4', F5: 'F5' };
const F_STATE_LABELS = {
  F1: '加速', F2: '稳定', F3: '中性', F4: '恶化', F5: '证伪'
};

/** 拥挤度状态 C1~C4 */
const C_STATES = { C1: 'C1', C2: 'C2', C3: 'C3', C4: 'C4' };
const C_STATE_LABELS = {
  C1: '正常', C2: '偏热', C3: '拥挤', C4: '极端拥挤'
};

/** 七态动作（状态机输出，英文 code） */
const ACTIONS = {
  WAIT: 'WAIT',
  BUILD: 'BUILD',
  ADD: 'ADD',
  HOLD: 'HOLD',
  TACTICAL_REDUCE: 'TACTICAL_REDUCE',
  STRATEGIC_REDUCE: 'STRATEGIC_REDUCE',
  EXIT: 'EXIT'
};
const ACTION_LIST = ['WAIT', 'BUILD', 'ADD', 'HOLD', 'TACTICAL_REDUCE', 'STRATEGIC_REDUCE', 'EXIT'];
/** 动作英文 code → 中文 label（前端展示用） */
const ACTION_LABELS = {
  WAIT: '等待',
  BUILD: '建仓',
  ADD: '加仓',
  HOLD: '持有',
  TACTICAL_REDUCE: '战术减仓',
  STRATEGIC_REDUCE: '战略减仓',
  EXIT: '清仓'
};

/** 风险等级 */
const RISK_FLAGS = { NORMAL: 'NORMAL', YELLOW: 'YELLOW', RED: 'RED' };
const RISK_FLAG_LABELS = { NORMAL: '正常', YELLOW: '暂停加仓', RED: '风险熔断' };

/** 折溢价等级 */
const PREMIUM_FLAGS = {
  NORMAL: '正常', LIGHT: '轻度溢价', OBVIOUS: '明显溢价', EXTREME: '极端溢价'
};

/** 赛道中文映射 */
const SECTORS = {
  storage: '存储', ai_network: 'AI互联', semi_equip: '半导体设备', gold: '黄金', biotech: '港股通创新药'
};

/** 展示用 ETF 名称（名称为主，代码为辅） */
const ETF_NAMES = {
  '513310': '中韩半导体ETF(QDII)',
  '515880': '通信ETF',
  '159582': '半导体设备ETF',
  '518880': '黄金ETF',
  '159570': '港股通创新药ETF'
};

/** 默认阈值（运行时读 param_config，此处仅作兜底默认值） */
const DEFAULT_PARAMS = {
  // 横盘（四重确认：区间 + 波动率 + 趋势 + 时间）
  sideway_days: 15,        // 标准/有效横盘天数
  sideway_days_min: 8,     // 横盘有效最小天数（8 日=初步整理，V2.1.1）
  sideway_days_mature: 20, // 成熟横盘天数（≥20 日）
  sideway_range_base: 12,  // 横盘区间振幅基础阈值%（Max(12%, 4×ATR20)）
  sideway_atr_multiplier: 4, // ATR 动态阈值倍数（区间 ≤ Max(12%, 4×ATR20)）
  sideway_range_max: 12,   // 标准横盘区间振幅上限%（文档：≤12%）
  sideway_range_hard_cap: 15, // 横盘区间绝对硬上限%（>15% 不认定为横盘）
  ma20_slope_flat: 1.5,    // MA20 5日斜率走平阈值%（|slope| ≤ 1.5% 视为走平）
  trend_context_up: 5,     // 横盘前 20 日涨幅 ≥5% 判定为上涨后横盘
  trend_context_down: -5,  // 横盘前 20 日跌幅 ≤-5% 判定为下跌后横盘
  // 缩量
  volume_ratio: 0.70,      // 缩量阈值：5日均量/20日均量 <= 0.70 为缩量
  volume_ratio_mild: 0.95, // 温和缩量上限（V2 上限；2026-08-22 敏感性矩阵 0.90→0.95 单调递增 +7.9pct，用户采纳）
  volume_ratio_high: 1.15, // 放量阈值
  volume_ratio_extreme: 1.50, // 异常放量阈值
  stagnation_atr_ratio: 0.5, // 放量滞涨 ATR 标准化阈值（5日价格变化 / ATR20 <= 0.5 视为滞涨）
  // 趋势
  ma20_slope: 0,           // ma20 斜率 > 0 视为向上
  // 组合约束
  tech_sector_max: 65,     // 科技赛道上限%（用户确认值，覆盖线框图的 60%）
  single_etf_max: 30,      // 单 ETF 最大仓位%
  // 拥挤度溢价（QDII 与普通 ETF 分档，单位 %）
  premium_qdii_light: 1,
  premium_qdii_obvious: 3,
  premium_qdii_extreme: 5,
  premium_etf_light: 0.3,
  premium_etf_obvious: 1,
  premium_etf_extreme: 2,
  // 偏离 20 日均线（拥挤度判定）
  bias_20d_hot: 15,        // 偏离 > 15% 视为偏热
  bias_20d_crowd: 25,      // 偏离 > 25% 视为拥挤
  // 仓位引擎参数（对应 seed 点号 key：cooldown.days / add.breakout.max_pct，经 mergeParams 映射）
  cooldown_days: 3,        // 加仓冷静期（交易日）
  add_breakout_max_pct: 5,  // 突破加仓单次上限 pct
  // V3.0 v1.1 灰度开关（P5）— 2026-08-29 切流：V3.6.1 正式，V3.8 对照
  trend_stage_enabled: true,  // true → final_target 走 V3.6.1（正式）
  v3_shadow_enabled: true,     // true → 并行输出 shadow_targets（v38 对照）
  // V4.0 Gen-1 Advisory Active：主机会判断；V3.6.1 仍是安全骨架/对照组
  ml_shadow_observe: true,
  ml_advisory_enabled: true, // 一键回退为 false
  ml_fast_path_enabled: true, // 只影响人工建议，不接自动执行
  ml_execution_enabled: false, // 永久边界：不接券商/自动下单
  ml_challenger_model_id: 'HVT-A-ET-20260830',
  ml_shadow_bundle_id: 'shadow-bundle-v1',
  ml_gen1_frozen: true,
  v3_breadth_source: 'index',   // breadth 源：index=三指数W(V38对齐) | portfolio=五票W
  // 牛市参与度 P0（2026-08-27）：V3.8 默认关；V3 Shadow 在 decision-v3 内按 v3_first_lot_breakout 开启
  first_lot_breakout: false,
  trend_follow_add: false,
  v3_first_lot_breakout: true,   // false → Shadow 也不开首仓突破
  v3_bull_mf_floor: true,       // P1：S5+W1/W2 时 MF 不低于 0.85
  v3_bull_mf_floor_value: 0.85,
  v3_momentum_acceleration: true, // P1-B：S5 主升加速器（Shadow 默认开）
  v3_momentum_accel_min_pct: 8,
  v3_momentum_accel_max_pct: 10,
  // Phase D：S4/S5 + A/A+ 全链路 MF×SF×OF×FF×DP 托底
  v3_full_chain_floor: true,
  v3_full_chain_floor_s5: 0.75,
  v3_full_chain_floor_s4: 0.65,
  // Phase E（924 窗口，2026-08-27）：Shadow 冷启动/过热迟滞
  v3_crisis_score_release: 55,   // MarketScore≥此值 → breadth 类 Crisis 硬触发不覆盖分数档
  v3_s6_empty_build: true,       // S6 过热 overlay 下空仓 W1/W2 仍允许首仓 BUILD
  v3_flb_allow_v5: true,          // 首仓突破 flb 允许 V5 爆量（924 急涨型）
  v3_s6_probe_hold: true,         // S6 下 ≤首仓上限的试探仓 HOLD，不 TACTICAL_REDUCE
  // V3.1 Trend-First（Shadow 战略重构）：分层仓位，Regime=天花板，Stage=基础仓
  v3_trend_first_enabled: true,
  v3_v31_breakout_boost: true,
  v3_v31_persistence_boost: true,
  v3_v31_transition_boost: true,
  v3_v31_s0_cold_start: true,    // S0+W1/W2/W3 冷启动走 V3.1 S2 base 10%
  v3_rally_gap_accel: true,      // S4/S5 大 gap 穿透 S6 overlay / eligibility pause
  v3_rally_gap_accel_min: 12,    // gap≥此值触发加速 ADD（P2：15→12）
  // V3.2 Bull Participation（Shadow 战略升级）：Recovery + Bull Activation + 凸型参与
  v3_v32_enabled: true,
  v3_v32_breakout_primary: true,
  v3_v32_momentum_boost: true,
  v3_v32_transition_boost: true,
  v3_v32_bull_fast_path: true,
  // V3.2 乘法数学引擎：单票自动 v32-math，组合保持 additive V32
  v3_2_math_enabled: true,
  v3_2_math_auto_track: true,
  v3_2_math_single_enabled: true,
  v3_2_math_portfolio_enabled: false,
  v3_2_bull_mode_action: true,
  v3_2_breakout_add_min_pct: 15,
  v3_2_breakout_add_max_pct: 25,
  v3_2_portfolio_rb_enforce: false,
  v3_2_om_floor_mr65: 0.85,
  v3_2_tm_floor_stage3: 0.70,
  v3_2_bull_pullback_hold: true,
  // V3.3 加法目标敞口（默认关；单票实验 Cap=100%）
  v3_3_enabled: false,
  v3_3_mode: 'off',
  v3_3_single_full_cap: true,
  v3_3_single_cap: 100,
  v3_3_auto_track: true,
  v3_3_portfolio_enabled: false,
  v3_3_breakout_add_min_pct: 15,
  v3_3_breakout_add_max_pct: 25,
  // V3.4 Stage Position Engine（Regime=Permission, Stage=Position）
  v3_4_enabled: false,
  v3_4_single_full_cap: true,
  v3_4_single_cap: 100,
  v3_4_auto_track: true,
  v3_4_portfolio_enabled: false,
  // V3.5 Structural：Regime×Stage 简化骨架（默认关）
  v3_5_enabled: false,
  v3_5_mode: 'off',
  v3_5_single_full_cap: true,
  v3_5_single_cap: 100,
  v3_5_auto_track: true,
  v3_5_portfolio_enabled: false,
  // V3.6 Experiment C：S4/S5 Persistence（默认关）
  v3_6_persistence: false,
  v3_6_s4_grace_days: 2,
  v3_6_soft_confirm_days: 2,
  v3_6_downgrade_soft_score: 50,
  v3_6_downgrade_hard_score: 70,
  // V3.6.1：S5 Downside Protection（需同时开 v3_6_persistence）
  v3_6_1_s5_downside: false,
  v3_6_1_s5_grace_days: 1,
  v3_6_1_s5_risk_confirm_days: 2,
  // V3.6.1：enabled=总闸；shadow=false 表示已升正式（仍可由 v3_shadow_enabled 输出 v38 对照）
  v3_6_1_enabled: true,
  v3_6_1_shadow: false,
  // 生产可观测性：构建/配置版本（落库 decision / shadow_log）
  config_version: '2026-08-29-v361-cutover',
  engine_build: 'v3.6.1',
  // V3.6.2：S5→S4 落地缓冲（StageRecoveryGrace）
  v3_6_2_post_s5_s4_grace: false,
  v3_6_2_post_s5_s4_grace_days: 3,
  // V3.6.3：Adaptive Recovery — 2日硬保护 + 第3日条件保护
  v3_6_3_adaptive_post_s5_grace: false,
  v3_6_3_hard_protect_days: 2,
  v3_6_3_day3_min_hits: 2,
  // P0 动作层 / 迟滞 / 评分（Shadow 默认开，修 bug 不加风险）
  v3_s6_target_consistency: true,   // S6 overlay 仅 target 下降时才 TACTICAL_REDUCE
  v3_s6_confirmed_rally_add: true,  // primary=S4/S5 + display=S6 主升穿透 overlay 继续 ADD
  v3_stage_down_one_step: true,     // 阶段降级每次最多 1 档
  v3_volume_breakout_bonus: true,   // 放量+突破高位时 V4/V5 加分而非扣分
  v3_o3_regime_shadow: true,        // structural/aggressive 下用 O3 机会系数
  // P2 牛市参与度（仅 Shadow；V3.8 生产仍 single_etf_max=30）
  v3_single_etf_max: 45,
  v3_build_first_lot_pct: 12,
  v3_add_breakout_max_pct: 10,
  v3_add_trend_step_pct: 6,
  v3_momentum_accel_max_pct: 12,
  v3_s6_probe_hold_pct: 12,
  v3_v31_raise_stage_base: true,
  // P3 eligibility：chase / cash_floor 放松（仅 Shadow）
  v3_chase_rally_relax: true,       // 主升段 S4/S5/S6 清 chase；阈值抬至 0.98
  v3_chase_pp_rally: 0.98,          // S4/S5 追涨阈值（原 0.92）
  v3_cash_floor_relax: true,        // bull regime 下调现金底；Recovery 穿透 crisis 锁仓
  v3_cash_min_aggressive: 5,        // aggressive/structural 最低现金%
  v3_cash_min_range: 15,
  v3_cash_min_defensive: 30,
  v3_cash_min_crisis: 50,
  v3_cash_min_recovery: 20,          // Crisis+Recovery 最低现金%
  // P4 双轨：单票进攻 / 组合保守（portfolio.multi_etf 或 etf_count>1 自动切换）
  v3_dual_track_enabled: true,
  v3_portfolio_single_etf_max: 42,
  v3_portfolio_cash_min_aggressive: 9,
  v3_portfolio_raise_stage_base: true,
  v3_portfolio_build_first_lot_pct: 10,
  // P5：组合轨默认仅 P0 动作层；单票仍走全量 P0–P3
  v3_portfolio_p0_only: true,
  v3_portfolio_p0_single_max: 30
};

/** 横盘评分（Consolidation Score 0~100）各维度权重，合计 100（V2.1.1：量能+趋势提权） */
const CONSOLIDATION_SCORE_WEIGHTS = {
  duration: 15,     // 整理时间
  range: 20,        // 价格波动收敛
  volume: 25,       // 成交量收缩（提权：缩量证明抛压下降）
  ma20_slope: 15,   // MA20 斜率下降
  trend: 25         // 趋势/低点结构（MA60向上15 + 上涨后整理10）
};

/** 横盘前趋势（Trend Context）枚举 */
const TREND_CONTEXTS = {
  UP: 'UP_CONSOLIDATION',
  DOWN: 'DOWN_CONSOLIDATION',
  RANGE: 'RANGE_CONSOLIDATION'
};

/** 机会分权重（默认 Trend35/Vol30/Fund25/Crowd10，单位 %，入 param_config 可改） */
const DEFAULT_OPPORTUNITY_WEIGHTS = {
  trend: 35, volume: 30, fundamental: 25, crowding: 10
};

/** 五维评分满分（内部计算用，前端永不展示 100 分） */
const SCORE_MAX = {
  trend: 25, volume: 25, fundamental: 25, crowding: 15, risk: 10
};

/** 分批建仓比例（默认 2-5% → 5-10% → 10-15% → 15-20%） */
const BATCH_POSITIONS = [
  { from: 2, to: 5 },
  { from: 5, to: 10 },
  { from: 10, to: 15 },
  { from: 15, to: 20 }
];

/** 风险事件类型 */
const RISK_EVENT_TYPES = {
  POLICY: 'policy', TECH: 'tech', DEMAND: 'demand', STRUCTURE: 'structure', FALSIFY: 'falsify', OTHER: 'other'
};
const RISK_EVENT_TYPE_LABELS = {
  policy: '政策', tech: '技术路线', demand: '需求', structure: '结构', falsify: '证伪', other: '其他'
};

/** 科技赛道三只 ETF 代码（组合约束 P4 用，但代码不硬编码——仅用于归组，实际从 etf_basic.sector 读） */
const TECH_SECTORS = ['storage', 'ai_network', 'semi_equip'];
const SEMI_SECTORS = ['storage', 'semi_equip'];

/* ============================ 仓位引擎 V2.0.1 常量 ============================ */

/** 机会等级 A~F（机会分阈值见 decision.gradeOpportunity） */
const OPPORTUNITY_GRADES = ['A', 'B', 'C', 'D', 'E', 'F'];
/** 机会等级 → 机会系数区间 [下限, 上限]（V2.1：目标仓位区间动态生成，初值可入 param_config 覆盖） */
const OPPORTUNITY_FACTORS = {
  A: [0.90, 1.00],
  B: [0.60, 0.80],
  C: [0.40, 0.60],
  D: [0.20, 0.40],
  E: [0.05, 0.20],
  F: [0, 0]
};
/** 风险等级 → 修正系数（override 时 0） */
const RISK_FACTORS = { NORMAL: 1.0, YELLOW: 0.85, RED: 0.6 };
/** 核心仓比例（基本面核心仓等级 → 占目标仓位比例） */
const CORE_RATIOS = { A: 0.7, B: 0.6, C: 0.5, D: 0.3 };
/** 基本面 F 状态 → 核心仓等级（F5 特判核心仓 0） */
const F_TO_CORE_GRADE = { F1: 'A', F2: 'B', F3: 'C', F4: 'D', F5: 'D' };
/** 加仓冷静期（交易日） */
const COOLDOWN_DAYS = 3;
/** 首仓上限 pct */
const BUILD_FIRST_LOT_PCT = 8;
/** 普通加仓步长 pct（W3 等） */
const ADD_STEP_PCT = 3;
/** W1/W2 加仓步长 pct。V3.7：P3 砍完后 +3 加太慢，趋势回调里一次多加一点 */
const ADD_TREND_STEP_PCT = 5;
/** 突破加仓单次上限 pct */
const ADD_BREAKOUT_MAX_PCT = 5;
/** 加仓触发阈值：gap ≥ 3 才加仓 */
const ADD_THRESHOLD_PCT = 3;
/** 减仓触发阈值：gap ≤ -8 才减仓 */
const OVER_ALLOC_REDUCE_PCT = 8;
/** 被动超配分级阈值（pct） */
const OVER_ALLOC_THRESHOLDS = { normal: 3, mild: 5, moderate: 8, severe: 15 };
/** 组合环境 → 现金目标区间 [下限, 上限] */
const CASH_REGIME = {
  aggressive: [5, 10],
  structural: [10, 20],
  range: [20, 35],
  defensive: [35, 50],
  crisis: [50, 100]
};
/** 市场环境枚举 + 中文 label */
const MARKET_REGIMES = {
  AGGRESSIVE: 'aggressive', STRUCTURAL: 'structural', RANGE: 'range',
  DEFENSIVE: 'defensive', CRISIS: 'crisis'
};
const MARKET_REGIME_LABELS = {
  aggressive: '进攻', structural: '结构性行情', range: '震荡', defensive: '防守', crisis: '系统性风险'
};
/** 核心仓确认周期（交易日）：核心仓比例需连续 N 个交易日同等级才确认调整（慢变量，用户确认 20 日） */
const CORE_CONFIRM_PERIODS = 20;
/** 交易仓确认周期（交易日）：交易仓比核心仓更快参与（用户确认 10 日），F5 仍即时清零 */
const TRADE_CONFIRM_PERIODS = 10;
/** 交易仓等级 → 交易仓占目标比例（= 1 − 核心仓占比） */
const TRADE_RATIOS = { A: 0.3, B: 0.4, C: 0.5, D: 0.7 };

/** 宽基指数映射（V2.1 市场环境推导，腾讯周线 symbol） */
const MARKET_INDEXES = [
  { code: '000300', name: '沪深300', symbol: 'sh000300' },
  { code: '000688', name: '科创50', symbol: 'sh000688' },
  { code: '399006', name: '创业板指', symbol: 'sz399006' }
];

/** 海外关联标的（V2.1 传导信号 + 市场环境，腾讯美股/东财指数，均已实测可用） */
const GLOBAL_TICKERS = [
  { symbol: 'usMU', name: '美光科技', code: 'MU', market: 'em', secid: '105.MU', cik: '0000723125', related: '513310', factor: '存储周期', layer: 'hard_data' },
  { symbol: 'usEWY', name: '韩国MSCI ETF', code: 'EWY', market: 'em', secid: '107.EWY', related: '513310', factor: '韩国市场', layer: 'events' },
  { symbol: 'usNDX', name: '纳斯达克100', code: 'NDX', market: 'em', secid: '100.NDX', related: 'ALL', factor: '全球科技风险偏好', layer: 'events' },
  { symbol: 'usXBI', name: '美国生科ETF', code: 'XBI', market: 'em', secid: '107.XBI', related: '159570', factor: '创新药景气', layer: 'events' }
];

/**
 * SEC EDGAR 财报抓取标的（有 CIK 的美国上市公司，含 ADR）。
 * 财报为季度数据（10-Q/10-K 或 20-F/6-K），每日增量检测：新财报发布才落库，避免重复。
 *
 * 字段说明：
 * - related: 传导目标 ETF 代码数组
 * - factor: 传导因子简述
 * - ns: 财报命名空间（us-gaap 默认；台积电等 IFRS 公司用 ifrs-full）
 * - currency: 优先货币（USD 默认；阿斯麦等欧元报表用 EUR）
 * - forms: 财报表单类型（10-K/10-Q 默认；ADR 用 20-F/6-K）
 */
const SEC_FINANCIAL_TICKERS = [
  // —— 存储周期（513310 直接相关）——
  { symbol: 'usMU', name: '美光科技', code: 'MU', cik: '0000723125', related: ['513310'], factor: '存储周期' },
  // —— 半导体设备/晶圆代工（159582 直接相关）——
  { symbol: 'usAMAT', name: '应用材料', code: 'AMAT', cik: '0000006951', related: ['159582'], factor: '半导体设备' },
  { symbol: 'usASML', name: '阿斯麦', code: 'ASML', cik: '0000937966', related: ['159582'], factor: '光刻机', ns: 'us-gaap', currency: 'EUR', forms: ['20-F', '6-K'] },
  { symbol: 'usTSM', name: '台积电', code: 'TSM', cik: '0001046179', related: ['159582', '513310'], factor: '晶圆代工', ns: 'ifrs-full', currency: 'USD', forms: ['20-F', '6-K'] },
  { symbol: 'usARM', name: 'ARM', code: 'ARM', cik: '0001973239', related: ['159582', '513310'], factor: '芯片IP', ns: 'us-gaap', currency: 'USD', forms: ['20-F', '6-K'] },
  // —— AI 芯片/算力（513310/515880/159582 间接传导）——
  { symbol: 'usNVDA', name: '英伟达', code: 'NVDA', cik: '0001045810', related: ['515880', '513310', '159582'], factor: 'AI芯片' },
  { symbol: 'usAMD', name: 'AMD', code: 'AMD', cik: '0000002488', related: ['513310'], factor: 'AI芯片' },
  { symbol: 'usMRVL', name: '迈威尔', code: 'MRVL', cik: '0001835632', related: ['515880'], factor: '数据中心DSP' },
  // —— 云厂商 CapEx（515880/513310 间接传导）——
  { symbol: 'usMSFT', name: '微软', code: 'MSFT', cik: '0000789019', related: ['515880', '513310'], factor: '云/AI资本开支' },
  { symbol: 'usGOOGL', name: '谷歌', code: 'GOOGL', cik: '0001652044', related: ['515880', '513310'], factor: '云/AI资本开支' },
  { symbol: 'usAMZN', name: '亚马逊', code: 'AMZN', cik: '0001018724', related: ['515880', '513310'], factor: '云/AI资本开支' },
  { symbol: 'usMETA', name: 'Meta', code: 'META', cik: '0001326801', related: ['515880', '513310'], factor: '云/AI资本开支' },
  { symbol: 'usORCL', name: '甲骨文', code: 'ORCL', cik: '0001341439', related: ['515880', '513310'], factor: '云/AI资本开支' },
  // —— 创新药（159570 直接相关）——
  { symbol: 'usBGNE', name: '百济神州', code: 'BGNE', cik: '0001651308', related: ['159570'], factor: '创新药双上市', forms: ['10-K', '10-Q', '20-F', '6-K'] },
  { symbol: 'usZLAB', name: '再鼎医药', code: 'ZLAB', cik: '0001704292', related: ['159570'], factor: '创新药双上市', forms: ['20-F', '6-K', '10-K', '10-Q'] },
  { symbol: 'usHCM', name: '和黄医药', code: 'HCM', cik: '0001648257', related: ['159570'], factor: '创新药双上市', forms: ['20-F', '6-K', '10-K', '10-Q'] }
];

/**
 * 财报传导映射：公司 symbol → { ETF代码: 该 ETF 合法指标白名单 }。
 * LLM 判断传导时只能映射到白名单内指标，防止映射到不存在的 key。
 * 指标 key 与 extractFundamental 的 INDICATOR_KEYS 一致。
 */
const FINANCIAL_CONDUCTION_MAP = {
  usMU: { '513310': ['hbm_demand', 'ai_server_demand'] },
  usAMAT: { '159582': ['advanced_process'] },
  usASML: { '159582': ['advanced_process'] },
  usTSM: { '159582': ['advanced_process'], '513310': ['hbm_demand'] },
  usARM: { '159582': ['advanced_process'] },
  usNVDA: { '515880': ['optical_800g', 'cpo_progress', 'asp'], '513310': ['ai_server_demand', 'hbm_demand'], '159582': ['advanced_process'] },
  usAMD: { '513310': ['ai_server_demand'] },
  usMRVL: { '515880': ['optical_800g', 'cpo_progress'] },
  usMSFT: { '515880': ['cloud_capex'], '513310': ['ai_server_demand'] },
  usGOOGL: { '515880': ['cloud_capex'], '513310': ['ai_server_demand'] },
  usAMZN: { '515880': ['cloud_capex'], '513310': ['ai_server_demand'] },
  usMETA: { '515880': ['cloud_capex'], '513310': ['ai_server_demand'] },
  usORCL: { '515880': ['cloud_capex'], '513310': ['ai_server_demand'] },
  usBGNE: { '159570': ['core_sales', 'bd_licensing', 'approval_export'] },
  usZLAB: { '159570': ['core_sales', 'bd_licensing', 'approval_export'] },
  usHCM: { '159570': ['core_sales', 'bd_licensing', 'approval_export'] },
  kr000660: { '513310': ['hbm_demand', 'ai_server_demand'] },
  kr005930: { '513310': ['hbm_demand', 'ai_server_demand'] }
};

/**
 * 硬数据指标（有自动抓取来源、存真实数值）：LLM 传导信号禁止写这些指标，
 * 否则 LLM 只能给方向（value=0）会覆盖真实价格（如 dram_price/nand_price）。
 * 来源：dram/nand_price=CFM 闪存市场、real_rate=FRED、dollar_index=腾讯、etf_flow=金小秘。
 */
const HARD_DATA_INDICATORS = {
  '513310': ['dram_price', 'nand_price', 'capex'],
  '515880': ['cloud_capex'],
  '159582': ['wafer_capex'],
  '518880': ['real_rate', 'dollar_index', 'etf_flow'],
  '159570': ['leading_revenue']
};

/**
 * 东财宏观数据指标定义（市场环境宏观维度，落库 macro 集合）。
 * - reportName: 东财 datacenter-web 报表名
 * - valueField: 核心指标值字段（落库 value）
 * - extraFields: 附加字段（同比/环比/次级指标，落库原样）
 * - unit: 单位
 * - note: 对决策的影响说明（供信息流展示）
 */
const MACRO_DEFS = [
  {
    indicator: 'cpi', name: 'CPI 居民消费价格', reportName: 'RPT_ECONOMY_CPI',
    valueField: 'NATIONAL_SAME', unit: '%',
    extraFields: ['NATIONAL_SEQUENTIAL', 'NATIONAL_BASE', 'NATIONAL_ACCUMULATE'],
    note: '通胀水平：上行利好黄金/抗通胀资产，过高或触发货币收紧压制成长股'
  },
  {
    indicator: 'pmi', name: '制造业 PMI', reportName: 'RPT_ECONOMY_PMI',
    valueField: 'MAKE_INDEX', unit: '',
    extraFields: ['NMAKE_INDEX', 'MAKE_SAME', 'NMAKE_SAME'],
    note: '景气度：50 为荣枯线，>50 扩张利好周期/制造，<50 收缩偏防守'
  },
  {
    indicator: 'ppi', name: 'PPI 工业品出厂价格', reportName: 'RPT_ECONOMY_PPI',
    valueField: 'BASE_SAME', unit: '%',
    extraFields: ['BASE', 'BASE_ACCUMULATE'],
    note: '工业品价格：上行利好上游/制造利润，下行反映需求偏弱'
  },
  {
    indicator: 'gdp', name: 'GDP 国内生产总值', reportName: 'RPT_ECONOMY_GDP',
    valueField: 'DOMESTICL_PRODUCT_BASE', unit: '亿元',
    extraFields: ['FIRST_PRODUCT_BASE', 'SECOND_PRODUCT_BASE', 'THIRD_PRODUCT_BASE'],
    note: '经济增长总量：增速趋势反映宏观基本面强弱'
  }
];

/** 基本面新闻搜集：每只 ETF 的搜索关键词（用于巨潮资讯公告全文搜索） */
const NEWS_SECTOR_KEYWORDS = {
  '513310': ['存储芯片', 'DRAM', 'NAND', '闪存', '兆易创新', '长鑫存储'],
  '515880': ['光模块', '中际旭创', '新易盛', '光通信', 'CPO', '800G'],
  '159582': ['半导体设备', '北方华创', '中微公司', '晶圆厂', '刻蚀', '光刻机'],
  '518880': ['黄金', '央行购金', '金价'],
  '159570': ['信达生物', '百济神州', '康方生物', '翰森制药', '药明康德']
};

/** 新闻方向初筛关键词（利好/利空），后续可升级 LLM 精确提取 */
const NEWS_DIRECTION_KEYWORDS = {
  positive: ['涨价', '上调', '增长', '超预期', '获批', '中标', '扩产', '回购', '增持', '降息', '突破', '新高', '供不应求', '订单增加', '授权', '优先审评', '受理', '突破性'],
  negative: ['降价', '下滑', '亏损', '减持', '下调', '减产', '加息', '终止', '失败', '低于预期', '供过于求', '订单减少', '库存积压']
};

/** 基本面指标类型：quantitative=量化(有数值)、qualitative=定性(分级判断) */
const METRIC_TYPES = {
  QUANTITATIVE: 'quantitative',
  QUALITATIVE: 'qualitative'
};

/** 基本面三层结构（V2.1）：hard_data 硬数据 / earnings 盈利预期 / events 事件新闻 */
const METRIC_LAYERS = {
  HARD_DATA: 'hard_data',
  EARNINGS: 'earnings',
  EVENTS: 'events'
};

/** 三层权重（合计 100） */
const LAYER_WEIGHTS = {
  hard_data: 50,
  earnings: 30,
  events: 20
};

/** 定性指标 5 级分级（1 很差 → 5 很好） */
const GRADE_LABELS = {
  1: '很差', 2: '较差', 3: '中性', 4: '较好', 5: '很好'
};

/** 定性指标分级 → 信号分（-2 ~ +2），与量化指标 up+1/down-1 统一聚合 */
const GRADE_SCORES = {
  1: -2, 2: -1, 3: 0, 4: 1, 5: 2
};

module.exports = {
  COLLECTIONS,
  ENGINE_VERSION,
  FROZEN_PARAM_KEYS,
  TRADE_LOG_UPDATE_FIELDS,
  pickTradeUpdate,
  W_STATES, W_STATE_LABELS,
  D_STATES, D_STATE_LABELS,
  H_STATES, H_STATE_LABELS,
  V_STATES, V_STATE_LABELS,
  F_STATES, F_STATE_LABELS,
  C_STATES, C_STATE_LABELS,
  ACTIONS, ACTION_LIST, ACTION_LABELS,
  RISK_FLAGS, RISK_FLAG_LABELS,
  PREMIUM_FLAGS,
  SECTORS, ETF_NAMES,
  DEFAULT_PARAMS,
  DEFAULT_OPPORTUNITY_WEIGHTS,
  SCORE_MAX,
  BATCH_POSITIONS,
  RISK_EVENT_TYPES, RISK_EVENT_TYPE_LABELS,
  TECH_SECTORS, SEMI_SECTORS,
  NEWS_SECTOR_KEYWORDS, NEWS_DIRECTION_KEYWORDS,
  METRIC_TYPES, GRADE_LABELS, GRADE_SCORES,
  CONSOLIDATION_SCORE_WEIGHTS, TREND_CONTEXTS,
  OPPORTUNITY_GRADES, OPPORTUNITY_FACTORS, RISK_FACTORS, CORE_RATIOS, TRADE_RATIOS, F_TO_CORE_GRADE,
  COOLDOWN_DAYS, BUILD_FIRST_LOT_PCT, ADD_STEP_PCT, ADD_TREND_STEP_PCT, ADD_BREAKOUT_MAX_PCT, ADD_THRESHOLD_PCT, OVER_ALLOC_REDUCE_PCT,
  OVER_ALLOC_THRESHOLDS, CASH_REGIME, MARKET_REGIMES, MARKET_REGIME_LABELS, CORE_CONFIRM_PERIODS, TRADE_CONFIRM_PERIODS,
  MARKET_INDEXES, METRIC_LAYERS, LAYER_WEIGHTS, GLOBAL_TICKERS,
  SEC_FINANCIAL_TICKERS, FINANCIAL_CONDUCTION_MAP, MACRO_DEFS, HARD_DATA_INDICATORS
};
