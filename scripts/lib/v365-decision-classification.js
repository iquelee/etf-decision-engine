#!/usr/bin/env node
/**
 * V3.6.5 —— 决策分类**唯一来源**（HD12-1 / HD12-1.1）
 *
 * 目的：消灭「同一份决策核心清单被多个门禁各自硬编码维护」的多源真相问题。
 *
 * 背景（HD12-0 实测）：
 *   · `scripts/v365-p12-decision-parity.js` 维护 `DECISION_CORE`（12 项）
 *   · `scripts/v365-qualification-gate.js` 维护 `CORE`（11 项）
 *   · 两者互相漂移 3 项（`v3-6-stage-persistence` / `runDecisionEngine` / `v3-shadow`）
 *   · 且 replay 依赖集里**没有任何编排层文件** ⇒ Δ=0 对编排层结构性盲区
 *
 * 设计约束（HD12-1 §二）：
 *   · **纯数据 + 纯函数**：⛔ 不访问数据库、⛔ 不访问网络、⛔ 不读环境变量决定分类、
 *     ⛔ 不调子进程、⛔ 不动态扫描仓库后改变分类结果。
 *   · 所有成员为**字面量**；新增成员必须显式写入本文件。
 *
 * HD12-1.1 收口：
 *   · §1 **protected-domain fail-closed**：受保护域内的文件若 `classify() === UNCLASSIFIED` ⇒ FAIL
 *     （⛔ 不得把「replay 是否加载该文件」当作「该文件是否可能影响生产决策」的判据）
 *   · §2 `cooldown.js` = CALC（数据流已证实：`cooldownCheck` → `eligibilityOverall` → `finalAction`）
 *   · §3 `src/common/utils/**` **全量定性**（80/80），`UNKNOWN_DECISION_RELEVANCE = 0`
 *   · §9 `REPLAY_COVERAGE_GAPS` 新增 **RPG-002**（cooldown 闸门未被 replay 覆盖）
 *
 * ⛔ 本文件**不实施授权机制**（那是 HD12-2）。本轮所有受保护类别一律 fail-closed。
 */

'use strict';

/* ------------------------------------------------------------------ *
 * 版本
 * ------------------------------------------------------------------ */
const CLASSIFICATION_VERSION = 'v365-decision-classification-v2';

/* ------------------------------------------------------------------ *
 * ① DECISION_CALCULATION_CORE —— 计算核心
 *
 * 判据：其改动**可能**改变 `trend_stage` / `final_target` / `final_action`，
 *       或**决定某个动作能否生效**（闸门 / 权限 / 覆盖）。
 * 处理：⛔ **FAIL（绝对，无例外路径）**。
 * ------------------------------------------------------------------ */
const DECISION_CALCULATION_CORE = Object.freeze([
  // ---- 参数 / 常量 ----
  { file: 'src/common/constants.js', note: 'HD12-D8：携带 DEFAULT_PARAMS / 评分权重 / 状态枚举 ⇒ 可改决策' },

  // ---- 决策生成 ----
  { file: 'src/common/utils/decision.js', note: '评分族 + 资格闸门 + 状态机（产出 finalAction）' },
  { file: 'src/common/utils/decision-v3.js', note: '生产决策路径本体' },
  { file: 'src/common/utils/trend-stage.js', note: '阶段因子 → 阶段' },
  { file: 'src/common/utils/v3-6-stage-persistence.js', note: '阶段持久化 / 降级 / 结构破坏' },

  // ---- 信号 / 结构 ----
  { file: 'src/common/utils/swing-structure.js', note: '摆动结构 → 阶段' },
  { file: 'src/common/utils/indicators.js', note: '决策输入计算（MA/ATR/…）' },

  // ---- 市场状态 / 广度 ----
  { file: 'src/common/utils/market-regime.js', note: '市场状态 → regime（regime 直接 pause 新增）' },
  { file: 'src/common/utils/market-env-v3.js', note: '生产环境 MarketScore / Regime 解析' },
  { file: 'src/common/utils/market-score-components.js', note: 'MarketScore 分项' },
  { file: 'src/common/utils/market-env-diagnostics.js', note: '环境诊断，参与 regime 判定' },

  // ---- 防守 / Shock ----
  { file: 'src/common/utils/defense.js', note: '防守评分（SlowBreak / 趋势破坏）' },
  { file: 'src/common/utils/shock-filter.js', note: 'Shock 动作重分类' },
  { file: 'src/common/utils/shock-recovery.js', note: 'Shock 恢复动作' },

  // ---- 画像 / 仓位约束 ----
  { file: 'src/common/utils/etf-profile.js', note: 'adjustStageFactor / profileMaxPosition' },
  { file: 'src/common/utils/position-sizing.js', note: 'computePositionTargets（目标仓位）' },
  { file: 'src/common/utils/live-asset.js', note: '实盘总资产分母（持仓市值 + 现金）⇒ 参与仓位计算' },

  // ---- 各代目标引擎 ----
  { file: 'src/common/utils/v3-2-math-engine.js', note: '乘法引擎 → Target' },
  { file: 'src/common/utils/v3-3-target-exposure.js', note: 'computeV33Targets' },
  { file: 'src/common/utils/v3-4-stage-position-engine.js', note: 'computeV34Targets' },
  { file: 'src/common/utils/v3-5-structural-engine.js', note: 'computeV35Targets' },
  { file: 'src/common/utils/v3-bull-participation.js', note: 'computeBullParticipationTargets' },
  { file: 'src/common/utils/v3-trend-first-position.js', note: 'computeTrendFirstTargets' },
  { file: 'src/common/utils/v3-constants.js', note: '阶段 → StageFactor 映射' },
  { file: 'src/common/utils/v3-premium.js', note: '溢价分级 / 降级（可 forbid chase）' },
  { file: 'src/common/utils/v3-shadow.js', note: 'HD12 §八：在 replay 依赖集内，且参与 shadow target / portfolio 计算' },

  // ---- 日期 / 状态（决定"用哪一天的数据 / 输入形态"）----
  { file: 'src/common/utils/cn-trading-calendar.js', note: 'CN 交易日历权威源 ⇒ expected_trade_date ⇒ 门控 run' },
  { file: 'src/common/utils/trade-date-idempotence.js', note: 'HD12-D9：planRunInput / finalizeState 决定 run 输入形态' },
  { file: 'src/common/utils/trade-date-progress.js', note: 'HD12-D9：resolveTradeDate 决定用哪一天数据' },

  // ---- 基本面（决策输入）----
  { file: 'src/common/utils/fundamental.js', note: '基本面模板 / 信号 / 证据聚合 ⇒ 决策输入' },

  // ---- ★ HD12-1.1 §2：冷静期（数据流已证实影响动作）----
  {
    file: 'src/common/utils/cooldown.js',
    note: 'computeCooldownDays → cooldownDays → decision.js:468 cooldownCheck(pause) '
      + '→ eligibilityOverall → decision-v3.js:1008/1234 → finalAction（硬规则：cooldown>0 禁止新增）',
    replay_coverage: 'UNVERIFIED_PRODUCTION_BRANCH',
    reason: 'cooldown gate not exercised by replay harness（harness 硬编码 cooldownDays: 0）',
    coverage_gap: 'RPG-002'
  },

  // ---- Gen-1 权限 / 健康 / 覆盖（可 gate 或 overlay 决策）----
  { file: 'src/common/utils/gen1-authority.js', note: 'HD12-D9：权限阶梯决定 Gen-1 覆盖是否生效' },
  { file: 'src/common/utils/gen1-safety-permission.js', note: 'Safety Core Permission —— 唯一裁决点（model_candidate/allow_advisory/allow_canary）' },
  { file: 'src/common/utils/gen1-rule-permission.js', note: 'Fast Path rule permission（兼容薄适配层，指向 safety-permission）' },
  { file: 'src/common/utils/gen1-domain-permission.js', note: 'Domain Permission —— 有约束力的权限判断（IN_DOMAIN 等）' },
  { file: 'src/common/utils/gen1-circuit-breaker.js', note: 'Runtime Circuit Breaker —— 运行时门，允许/阻止 Advisory/Canary' },
  { file: 'src/common/utils/gen1-data-health.js', note: 'Data Health Gate —— Fail Closed：核心特征缺失则关 advisory/canary' },
  { file: 'src/common/utils/gen1-economic-health.js', note: '经济健康聚合 ⇒ 参与健康门判定' },
  { file: 'src/common/utils/gen1-health-state.js', note: '持久化健康 latch（GATE_STATUS）⇒ 参与健康门判定' },
  { file: 'src/common/utils/gen1-guarded-seal.js', note: 'Guarded Effective 封印（Freeze Seal / Evidence Seal）⇒ gate guarded 生效' },
  { file: 'src/common/utils/gen1-guarded-selector.js', note: 'Guarded 权威选择器 —— 可改变决策来源（baseline vs guarded）' },
  { file: 'src/common/utils/gen1-shadow-eligibility.js', note: 'Guarded Shadow Eligibility ⇒ 决定 shadow 是否计入' },
  { file: 'src/common/utils/gen1-overlay.js', note: '决策结果装饰器 —— 把 Permission 与反事实字段附加到决策' },
  { file: 'src/common/utils/gen1-execution-boundary.js', note: 'Execution Boundary —— 决定 execution_enabled（永久硬边界）' },

  // ---- 可达性受限于 RDE 的计算模块（⚠️ replay 覆盖缺口）----
  {
    file: 'src/common/utils/correlation.js',
    note: 'effectiveTechCap → portfolio.effective_tech_cap（decision-v3.js:539 读取）',
    replay_coverage: 'UNVERIFIED_PRODUCTION_BRANCH',
    reason: 'effective_tech_cap path not represented by current replay harness',
    coverage_gap: 'RPG-001'
  },
  { file: 'src/common/utils/portfolio-cash.js', note: 'computeCashDiagnostics → cash_ratio → cashRange' }
]);

/* ------------------------------------------------------------------ *
 * ② DECISION_ORCHESTRATION —— 编排层
 *
 * 判据：**已能证明不直接决定** target / action；影响 IO / 展示 / 台账 / 诊断 / 生命周期。
 * 处理：⚠️ HD12-2 起为「授权 + 证明」；**本轮仍一律 FAIL**。
 * ------------------------------------------------------------------ */
const DECISION_ORCHESTRATION = Object.freeze([
  // ---- 既有 ----
  { file: 'src/common/utils/gen1-canary.js', note: '反事实账本；assertProductionUntouched ⇒ 不参与生产决策' },
  { file: 'src/common/utils/portfolio-mode.js', note: 'diagnoseV3PortfolioMode：RDE:342-343 自述为诊断，不补字段改变生产行为' },
  { file: 'src/common/utils/gen1-capability.js', note: '自述「display/audit metadata only」' },
  { file: 'src/common/utils/gen1-view-model.js', note: '自述「刻意不参与任何交易、仓位、模型或风控计算」' },
  { file: 'src/common/utils/gen1-ui-view-model.js', note: 'Gen-1 UI 契约 ViewModel（展示层）' },

  // ---- IO / 存储 / 抓取 ----
  { file: 'src/common/utils/db.js', note: '数据库封装（IO）' },
  { file: 'src/common/utils/datasource.js', note: '多源数据抓取封装（网络 IO）' },
  { file: 'src/common/utils/intel-refresh.js', note: '情报刷新触发器（IO）' },
  { file: 'src/common/utils/fetch-guard.js', note: '抓取闸门纯函数（数据管线，不参与决策计算）' },
  { file: 'src/common/utils/daily-fetch-plan.js', note: '日线抓取 Lane 规划（数据管线）' },
  { file: 'src/common/utils/holdings-parse.js', note: 'ETF 持仓 HTML 解析（IO）' },
  { file: 'src/common/utils/overseas-filings.js', note: '港股/韩股披露解析（IO）' },
  { file: 'src/common/utils/biotech-intel.js', note: '创新药事件源解析（IO / 情报）' },

  // ---- 鉴权 / 请求 ----
  { file: 'src/common/utils/admin-auth.js', note: '管理端口令哈希（鉴权）' },
  { file: 'src/common/utils/gateway-auth.js', note: '网关鉴权（未接线生产）' },
  { file: 'src/common/utils/gateway-errors.js', note: '错误响应封装（IO）' },
  { file: 'src/common/utils/request-validate.js', note: '请求参数校验（IO）' },
  { file: 'src/common/utils/engine-invoke.js', note: '允许的调用来源白名单（未接线生产）' },

  // ---- 台账 / 复盘 / 统计（展示与审计）----
  { file: 'src/common/utils/pnl.js', note: '成交还原 / 未实现盈亏（会计）' },
  { file: 'src/common/utils/review-position.js', note: '复盘时间轴（展示）' },
  { file: 'src/common/utils/review-stats.js', note: '复盘统计（展示）' },
  { file: 'src/common/utils/shadow-v3-log.js', note: 'V3 Shadow 日对照条目（遥测）' },
  { file: 'src/common/utils/stage-residency-diagnostics.js', note: 'Stage Residency 诊断输出' },
  { file: 'src/common/utils/ml-shadow.js', note: 'Gen-1 统一元数据（展示）' },

  // ---- provenance（只读标注）----
  { file: 'src/common/utils/global-signal-provenance.js', note: 'global_signals 日期 provenance' },
  { file: 'src/common/utils/fundamental-provenance.js', note: 'fundamental 日期 provenance（未接线生产）' },
  { file: 'src/common/utils/market-env-provenance.js', note: 'market_env 日期 provenance（未接线生产）' },
  { file: 'src/common/utils/pipeline-correlation.js', note: '自述「纯函数契约，未接线生产」' },

  // ---- V365 生命周期（reader / writer / contracts）----
  { file: 'src/common/utils/v361-run-finality.js', note: 'run 终局分类（决定是否可发布，不改 target/action）' },
  { file: 'src/common/utils/v365-contracts.js', note: '契约版本中央声明' },
  { file: 'src/common/utils/v365-publish-store.js', note: '发布存储适配器（CAS）' },
  { file: 'src/common/utils/v365-atomic-publish.js', note: '发布协议 PoC（未接入生产 RDE）' },
  { file: 'src/common/utils/v365-run-integrity.js', note: 'run 完整性编排（finality / gate / telemetry）' },
  { file: 'src/common/utils/v365-active-read.js', note: 'authoritative 读取解析器（reader 侧）' }
]);

/* ------------------------------------------------------------------ *
 * ③ DECISION_MIXED —— 混合文件（既含计算又含编排）
 * ⚠️ HD12-3 建立 zone 级保护之前，本类**保持现有 fail-closed 保护**（改动 ⇒ FAIL）。
 * ------------------------------------------------------------------ */
const DECISION_MIXED = Object.freeze([
  {
    file: 'cloudfunctions/runDecisionEngine/index.js',
    note: '混合：既有计算装配，又有遥测 / 发布门 / candidate 写入',
    protected_until: 'HD12-3（zone 级保护）'
  }
]);

/* ------------------------------------------------------------------ *
 * ④ REPLAY_INFRASTRUCTURE —— 回放基础设施（HD12-D6 第三桶）
 * ⛔ 不得使用普通 ORCH 授权；必须进入 `REPLAY_INFRA_CHANGE_REVIEW_REQUIRED`。
 * ------------------------------------------------------------------ */
const REPLAY_INFRASTRUCTURE = Object.freeze([
  {
    file: 'scripts/lib/v364-replay-harness.js',
    note: 'replay 证据的生产者；改它 anchor 会变 ⇒ 可静默改变 Δ=0 的含义',
    review_marker: 'REPLAY_INFRA_CHANGE_REVIEW_REQUIRED'
  }
]);

/* ------------------------------------------------------------------ *
 * ⑤ ALLOWED_EXCEPTIONS —— 已声明的例外（白名单 + 证明义务）
 * ------------------------------------------------------------------ */
const ALLOWED_EXCEPTIONS = Object.freeze([
  {
    file: 'src/common/utils/v361-run-context.js',
    proof: 'not_wired_in_production',
    note: 'P-1 明确要求扩展它；须证明生产 cloudfunctions/*/index.js 零 require'
  }
]);

/* ------------------------------------------------------------------ *
 * ⑥ REPLAY_COVERAGE_GAPS —— replay 覆盖缺口（机器可读）
 * ⚠️ HD12-3 在关闭下列缺口前**不得获得最终放行**。
 * ------------------------------------------------------------------ */
const REPLAY_COVERAGE_GAPS = Object.freeze([
  {
    id: 'RPG-001',
    module: 'src/common/utils/correlation.js',
    production_input: 'portfolio.effective_tech_cap',
    replay_status: 'NOT_REPRESENTED',
    severity: 'QUALIFICATION_SCOPE_LIMITATION',
    reason: 'effective_tech_cap path not represented by current replay harness',
    detail: 'RDE:685-688 由 correlation.js 供给；decision-v3.js:539 读取；'
      + 'v364-replay-harness.js 的 buildPortfolio() 不设该字段 ⇒ replay 走回退分支',
    registered_at: '2026-09-28',
    blocking: 'HD12-3',
    approved_as: 'HD12-D7 = UNREGISTERED_REPLAY_COVERAGE_GAP'
  },
  {
    id: 'RPG-002',
    module: 'src/common/utils/cooldown.js',
    production_input: 'ctx.cooldownDays（decision.js:467-468 的 cooldown 闸门）',
    replay_status: 'NOT_REPRESENTED',
    severity: 'QUALIFICATION_SCOPE_LIMITATION',
    reason: 'cooldown gate not exercised by replay harness（harness 硬编码 cooldownDays: 0）',
    detail: 'v364-replay-harness.js:284 传 cooldownDays: 0 ⇒ cooldownCheck 恒 ok；'
      + 'cooldown.js 本身也不在 replay 依赖集 ⇒ 该闸门在 Δ=0 中从未被行使',
    registered_at: '2026-09-28',
    blocking: 'HD12-3',
    approved_as: 'HD12-1.1 §2（数据流证实 cooldown 影响 finalAction）'
  }
]);

/* ------------------------------------------------------------------ *
 * ⑦ PROTECTED_DOMAIN —— 受保护域（HD12-1.1 §1）
 *
 * 规则：域内文件若 `classify() === UNCLASSIFIED` ⇒ **FAIL**。
 * 目的：⛔ 不得把「replay 是否加载该文件」当作「该文件是否可能影响生产决策」的判据。
 * ⚠️ 本判据的真实价值在于**新增文件**：域内新出现的、尚未定性的文件必须显式登记，
 *    ⛔ 不得静默放行。
 * ------------------------------------------------------------------ */
const PROTECTED_DOMAIN = Object.freeze({
  exact: Object.freeze(['src/common/constants.js']),
  prefixes: Object.freeze([
    'src/common/utils/',
    'cloudfunctions/runDecisionEngine/'
  ]),
  // REPLAY_INFRASTRUCTURE 中显式登记的文件也属受保护域
  include_infra_files: true
});

/* ------------------------------------------------------------------ *
 * ⑧ CLASSIFICATION_AUDIT —— 全量定性审计（HD12-1.1 §3）
 *
 * 对 `src/common/utils/**` 的**每一个**文件给出 `decision_relevance`。
 * ⇒ `UNKNOWN_DECISION_RELEVANCE = 0`。
 * ⚠️ `relevance` 取值：CALC / ORCH / EXCEPTION（与本文件分类一致）。
 * ⚠️ `reason` 为该文件**为何**归入该类的一句话依据。
 * ------------------------------------------------------------------ */
const CLASSIFICATION_AUDIT = Object.freeze([
  // 说明：本表与 ①②⑤ 三张清单**逐项对应**（由测试 C-17 断言一致性），
  //       因此无需重复 reason —— 唯一的额外信息是「审计已覆盖」这一事实。
  //       `decision_relevance` 即 `classify()` 的返回值（CALC / ORCH / EXCEPTION）。
  //       机械事实（production_reachable / rde_reachable / replay_dependency）
  //       可用 `docs/V365_DECISION_DEPENDENCY_CLASSIFICATION.md` 记录的探针复现。
  Object.freeze({ scope: 'src/common/utils/**', audited: 80, total: 80, unknown_decision_relevance: 0 })
]);

/* ------------------------------------------------------------------ *
 * ⑨ 标记常量
 * ------------------------------------------------------------------ */
const REPLAY_INFRA_REVIEW_MARKER = 'REPLAY_INFRA_CHANGE_REVIEW_REQUIRED';
const UNCLASSIFIED = 'UNCLASSIFIED';

/* ------------------------------------------------------------------ *
 * 纯函数区（无副作用、无 IO）
 * ------------------------------------------------------------------ */
function _norm(p) {
  return String(p == null ? '' : p).replace(/\\/g, '/').replace(/^\.\//, '').trim();
}
function _files(list) {
  return list.map((x) => (typeof x === 'string' ? x : x.file)).map(_norm);
}

function calcFiles() { return _files(DECISION_CALCULATION_CORE); }
function orchFiles() { return _files(DECISION_ORCHESTRATION); }
function mixedFiles() { return _files(DECISION_MIXED); }
function infraFiles() { return _files(REPLAY_INFRASTRUCTURE); }
function exceptionFiles() { return _files(ALLOWED_EXCEPTIONS); }

/** 全部受保护文件（CALC ∪ ORCH ∪ MIXED ∪ INFRA）。⛔ 不含 ALLOWED_EXCEPTIONS。 */
function allProtected() {
  return [...calcFiles(), ...orchFiles(), ...mixedFiles(), ...infraFiles()];
}

/** CALC ∪ ORCH（不含 MIXED / INFRA）—— 供「决策核心」语义的门禁使用。 */
function calcOrch() {
  return [...calcFiles(), ...orchFiles()];
}

/**
 * 分类查询。
 * @returns {'CALC'|'ORCH'|'MIXED'|'REPLAY_INFRA'|'EXCEPTION'|'UNCLASSIFIED'}
 * ⚠️ 未登记文件**一律返回 `UNCLASSIFIED`**（⛔ 绝不默认归入宽松类别）。
 */
function classify(file) {
  const f = _norm(file);
  if (!f) return UNCLASSIFIED;
  if (calcFiles().includes(f)) return 'CALC';
  if (orchFiles().includes(f)) return 'ORCH';
  if (mixedFiles().includes(f)) return 'MIXED';
  if (infraFiles().includes(f)) return 'REPLAY_INFRA';
  if (exceptionFiles().includes(f)) return 'EXCEPTION';
  return UNCLASSIFIED;
}

/** 取该文件的元数据条目（未登记返回 null）。 */
function meta(file) {
  const f = _norm(file);
  const pools = [DECISION_CALCULATION_CORE, DECISION_ORCHESTRATION, DECISION_MIXED,
    REPLAY_INFRASTRUCTURE, ALLOWED_EXCEPTIONS];
  for (const pool of pools) {
    const hit = pool.find((x) => _norm(typeof x === 'string' ? x : x.file) === f);
    if (hit) return hit;
  }
  return null;
}

/** 某文件的 replay 覆盖缺口（无则 null）。 */
function coverageGap(file) {
  const f = _norm(file);
  return REPLAY_COVERAGE_GAPS.find((g) => _norm(g.module) === f) || null;
}

/* ---------------- HD12-1.1 §1：受保护域 ---------------- */
/** 该文件是否属于受保护域。 */
function isInProtectedDomain(file) {
  const f = _norm(file);
  if (!f) return false;
  if (PROTECTED_DOMAIN.exact.includes(f)) return true;
  if (PROTECTED_DOMAIN.prefixes.some((p) => f.startsWith(p))) return true;
  if (PROTECTED_DOMAIN.include_infra_files && infraFiles().includes(f)) return true;
  return false;
}

/**
 * 受保护域内**未登记**的文件（⇒ 应 FAIL）。
 * @param {string[]} files
 */
function protectedDomainViolations(files) {
  return (files || []).map(_norm).filter((f) => f && isInProtectedDomain(f) && classify(f) === UNCLASSIFIED);
}

/** 摘要（供门禁打印）。 */
function summary() {
  return {
    version: CLASSIFICATION_VERSION,
    calc: calcFiles().length,
    orch: orchFiles().length,
    mixed: mixedFiles().length,
    infra: infraFiles().length,
    exceptions: exceptionFiles().length,
    all_protected: allProtected().length,
    coverage_gaps: REPLAY_COVERAGE_GAPS.length,
    audit_scope: CLASSIFICATION_AUDIT[0].scope,
    audited: CLASSIFICATION_AUDIT[0].audited,
    unknown_decision_relevance: CLASSIFICATION_AUDIT[0].unknown_decision_relevance
  };
}

module.exports = {
  CLASSIFICATION_VERSION,
  UNCLASSIFIED,

  DECISION_CALCULATION_CORE,
  DECISION_ORCHESTRATION,
  DECISION_MIXED,
  REPLAY_INFRASTRUCTURE,
  ALLOWED_EXCEPTIONS,
  REPLAY_COVERAGE_GAPS,
  PROTECTED_DOMAIN,
  CLASSIFICATION_AUDIT,
  REPLAY_INFRA_REVIEW_MARKER,

  calcFiles,
  orchFiles,
  mixedFiles,
  infraFiles,
  exceptionFiles,
  allProtected,
  calcOrch,
  classify,
  meta,
  coverageGap,
  isInProtectedDomain,
  protectedDomainViolations,
  summary
};
