/**
 * Gen-1 canonical 契约适配器（web/src/rewrite/adapters/gen1.js）
 * 规范依据：SPEC §6（canonical source = src/common/utils/gen1-ui-view-model.js）
 *
 * ★★ **形状以真实契约为准**（2026-09-30 用契约模块实跑导出，见
 *    `web/tests/fixtures/canonical/*.json`，生成脚本 `_v365-fe-audit-20260930/tools/gen-m2-fixtures.cjs`）。
 *    ⚠️ 修正记录：初版曾按源码片段推断出「`gen1.signal.calibrated_probability` / `gen1.authority_label`」，
 *    **实跑证明不存在** —— 真实字段是 `signal.threshold`，而 `authority_label` 只在 `system_runtime.gen1`。
 *    ⇒ 结论：**契约形状必须由实跑产出，不得由源码片段推断**。
 *
 * 真实形状：
 *   production     = { engine, engine_source, action_code, action_label, current_pct,
 *                      final_target_pct, suggested_pct, risk_flag, binding_constraint }
 *   gen1           = { authority, status, stages{signal,baseline,effective},
 *                      signal{stage,probability,threshold,model_candidate,signal_status},
 *                      data{health_status,source_trade_date,benchmark_latest_date},
 *                      applicability{domain_status,domain_permission,label,message},
 *                      safety{permission,reason_code,reason,source,eod_stage,baseline_stage,
 *                             binding_stage,binding_stage_source},
 *                      counterfactual{target_pct,suggested_pct,delta_pct,stage_changed,clamped,
 *                                     baseline_floor_breached} }
 *   system_runtime = { runtime_status_available,
 *                      production{engine,engine_source,status},
 *                      gen1{authority,authority_label,health_status,health_gate_status,health_source,
 *                           safety_source,counterfactual_authorized,counterfactual_health_allowed,
 *                           counterfactual_active,counterfactual_inactive_reason,
 *                           counterfactual_invocations,ledger_ok,production_write,
 *                           production_fast_path_enabled,auto_execution,safety_invariant_ok},
 *                      gen2{mode,source,production_write,production_write_source} }
 *   legacy         = { deprecated, do_not_use_for_authority, note, fields[] }
 *
 * ⛔ 严禁把旧前端的 `gen1.advisory.*` 当作 canonical path（对真实契约命中率 0/8，审计 §3.7.3）。
 * ★ 优先级：canonical > legacy fallback > 显式 UNAVAILABLE（且 canonical 存在但字段为 null ⇒ MISSING，不 fallback）
 */
import { provided, missing, unavailable, readField, readBlock, provenance, hasValue } from '../domain/provenance.js';
import { FIELD_STATE, MISSING_REASON, AUTHORITY } from '../domain/enums.js';

const P_PROD = provenance({ source: 'contract:production', authority: AUTHORITY.SAFETY_CORE });
const P_GEN1 = provenance({ source: 'contract:gen1', authority: AUTHORITY.GEN1 });
const P_SR = provenance({ source: 'contract:system_runtime', authority: AUTHORITY.SAFETY_CORE });
const P_LEGACY = provenance({ source: 'legacy:ml_shadow', authority: AUTHORITY.GEN1, fallbackFrom: 'legacy' });

/** legacy 语义键黑名单：⛔ 不得出现在 production / gen1 块内（UI-G1-12） */
export const LEGACY_SEMANTIC_KEYS = Object.freeze([
  'ml_shadow', 'advisory_enabled', 'fast_path_enabled', 'ui_phase', 'production_permission'
]);

export const CANONICAL_BLOCKS = Object.freeze(['production', 'gen1', 'system_runtime', 'legacy']);

/** canonical 契约是否下发（⛔ 与「字段是否齐全」分开判定） */
export function hasCanonicalContract(data) {
  if (!data || typeof data !== 'object') return false;
  return !!(data.production || data.gen1 || data.system_runtime);
}

/**
 * @param {object|null} data 页面级响应 data
 * @param {object|null} runtimeStatus `/api/constants` 的 runtime_status（用于 authority 兜底）
 */
export function adaptGen1(data, runtimeStatus = null) {
  const present = hasCanonicalContract(data);
  return Object.freeze({
    canonicalAvailable: present,
    unavailableReason: present ? null : MISSING_REASON.CONTRACT_NOT_PROVIDED,
    production: present ? adaptProduction(data.production) : emptyProduction(),
    gen1: present ? adaptGen1Block(data.gen1) : emptyGen1Block(),
    systemRuntime: present ? adaptSystemRuntime(data.system_runtime) : emptySystemRuntime(),
    legacy: adaptLegacyNotice(data && data.legacy),
    authority: resolveAuthority(data, runtimeStatus)
  });
}

/* ================= production ================= */

function adaptProduction(p) {
  if (!p || typeof p !== 'object') return emptyProduction();
  return Object.freeze({
    /** 该决策自身的引擎版本（⛔ 不是「当前生产引擎」，见 UI-G1-09） */
    engine: readField(p, 'engine', P_PROD),
    engineSource: readField(p, 'engine_source', P_PROD),
    actionCode: readField(p, 'action_code', P_PROD),
    actionLabel: readField(p, 'action_label', P_PROD),
    /** ★ 仓位百分比（SPEC 附录 A.1） */
    currentPct: readField(p, 'current_pct', P_PROD),
    finalTargetPct: readField(p, 'final_target_pct', P_PROD),
    suggestedPct: readField(p, 'suggested_pct', P_PROD),
    riskFlag: readField(p, 'risk_flag', P_PROD),
    bindingConstraint: readField(p, 'binding_constraint', P_PROD),
    contractViolations: scanForbiddenKeys(p)
  });
}

function emptyProduction() {
  const u = () => unavailable(MISSING_REASON.CONTRACT_NOT_PROVIDED, P_PROD);
  return Object.freeze({
    engine: u(), engineSource: u(), actionCode: u(), actionLabel: u(),
    currentPct: u(), finalTargetPct: u(), suggestedPct: u(), riskFlag: u(),
    bindingConstraint: u(), contractViolations: Object.freeze([])
  });
}

/* ================= gen1 块 ================= */

export function adaptGen1Block(g) {
  if (!g || typeof g !== 'object') return emptyGen1Block();
  const sig = g.signal && typeof g.signal === 'object' ? g.signal : null;
  const dat = g.data && typeof g.data === 'object' ? g.data : null;
  const stg = g.stages && typeof g.stages === 'object' ? g.stages : null;
  const saf = g.safety && typeof g.safety === 'object' ? g.safety : null;
  const app = g.applicability && typeof g.applicability === 'object' ? g.applicability : null;
  const cf = g.counterfactual && typeof g.counterfactual === 'object' ? g.counterfactual : null;

  return Object.freeze({
    available: true,
    /** CANARY / ADVISORY / PRODUCTION / OFF */
    authority: readField(g, 'authority', P_GEN1),
    /** 字符串枚举：NO_OPPORTUNITY / OBSERVED / CANDIDATE / BLOCKED / DEGRADED（⛔ 不是对象） */
    status: readField(g, 'status', P_GEN1),
    /**
     * ⚠️ 契约的 `gen1` **没有** `authority_label`（该字段在 `system_runtime.gen1`）。
     * 注意语义：gen1 块**已下发**，只是不含此键 ⇒ `MISSING / FIELD_ABSENT`
     * （⛔ 不是 `UNAVAILABLE` —— 后者专指「契约整块未下发」）。
     */
    authorityLabel: missing(MISSING_REASON.FIELD_ABSENT,
      provenance({ source: 'contract:gen1.authority_label', authority: AUTHORITY.GEN1 })),

    signal: Object.freeze({
      stage: readField(sig, 'stage', P_GEN1),
      probability: readField(sig, 'probability', P_GEN1),
      /** 模型阈值（0~1 比例，线上 0.65）—— ⛔ **不是** calibrated_probability */
      threshold: readField(sig, 'threshold', P_GEN1),
      modelCandidate: readField(sig, 'model_candidate', P_GEN1),
      signalStatus: readField(sig, 'signal_status', P_GEN1)
    }),

    /** 信号数据健康（与模型健康是两回事） */
    data: Object.freeze({
      healthStatus: readField(dat, 'health_status', P_GEN1),
      sourceTradeDate: readField(dat, 'source_trade_date', P_GEN1),
      benchmarkLatestDate: readField(dat, 'benchmark_latest_date', P_GEN1)
    }),

    /** ★ 三段 stage 必须分开（UI-G1-10 / UI-G1-14：⛔ 不得串位） */
    stages: Object.freeze({
      signal: readField(stg, 'signal', P_GEN1),
      baseline: readField(stg, 'baseline', P_GEN1),
      effective: readField(stg, 'effective', P_GEN1)
    }),

    /** Safety Core 阶段门 */
    safety: Object.freeze({
      permission: readField(saf, 'permission', P_GEN1),
      reasonCode: readField(saf, 'reason_code', P_GEN1),
      reason: readField(saf, 'reason', P_GEN1),
      source: readField(saf, 'source', P_GEN1),
      eodStage: readField(saf, 'eod_stage', P_GEN1),
      baselineStage: readField(saf, 'baseline_stage', P_GEN1),
      bindingStage: readField(saf, 'binding_stage', P_GEN1),
      bindingStageSource: readField(saf, 'binding_stage_source', P_GEN1)
    }),

    applicability: Object.freeze({
      domainStatus: readField(app, 'domain_status', P_GEN1),
      domainPermission: readField(app, 'domain_permission', P_GEN1),
      label: readField(app, 'label', P_GEN1),
      message: readField(app, 'message', P_GEN1)
    }),

    /** ★ 反事实（shadow）—— ⛔ 不得覆盖 production（UI-G1-03） */
    counterfactual: Object.freeze({
      targetPct: readField(cf, 'target_pct', P_GEN1),
      suggestedPct: readField(cf, 'suggested_pct', P_GEN1),
      deltaPct: readField(cf, 'delta_pct', P_GEN1),
      stageChanged: readField(cf, 'stage_changed', P_GEN1),
      clamped: readField(cf, 'clamped', P_GEN1),
      baselineFloorBreached: readField(cf, 'baseline_floor_breached', P_GEN1)
    }),

    contractViolations: scanForbiddenKeys(g)
  });
}

function emptyGen1Block() {
  const u = () => unavailable(MISSING_REASON.CONTRACT_NOT_PROVIDED, P_GEN1);
  const g = { available: false };
  ['authority', 'status', 'authorityLabel'].forEach((k) => { g[k] = u(); });
  g.signal = Object.freeze({ stage: u(), probability: u(), threshold: u(), modelCandidate: u(), signalStatus: u() });
  g.data = Object.freeze({ healthStatus: u(), sourceTradeDate: u(), benchmarkLatestDate: u() });
  g.stages = Object.freeze({ signal: u(), baseline: u(), effective: u() });
  const su = () => unavailable(MISSING_REASON.CONTRACT_NOT_PROVIDED, P_GEN1);
  g.safety = Object.freeze({ permission: su(), reasonCode: su(), reason: su(), source: su(), eodStage: su(), baselineStage: su(), bindingStage: su(), bindingStageSource: su() });
  g.applicability = Object.freeze({ domainStatus: su(), domainPermission: su(), label: su(), message: su() });
  g.counterfactual = Object.freeze({ targetPct: su(), suggestedPct: su(), deltaPct: su(), stageChanged: su(), clamped: su(), baselineFloorBreached: su() });
  g.contractViolations = Object.freeze([]);
  return Object.freeze(g);
}

/* ================= system_runtime ================= */

function adaptSystemRuntime(sr) {
  if (!sr || typeof sr !== 'object') return emptySystemRuntime();
  const p = sr.production && typeof sr.production === 'object' ? sr.production : null;
  const g = sr.gen1 && typeof sr.gen1 === 'object' ? sr.gen1 : null;
  const g2 = sr.gen2 && typeof sr.gen2 === 'object' ? sr.gen2 : null;

  return Object.freeze({
    available: true,
    /** runtime_status 本身是否可读（三态判定的前提） */
    runtimeStatusAvailable: readField(sr, 'runtime_status_available', P_SR),

    production: Object.freeze({
      engine: readField(p, 'engine', P_SR),
      engineSource: readField(p, 'engine_source', P_SR),
      status: readField(p, 'status', P_SR)
    }),

    gen1: Object.freeze({
      authority: readField(g, 'authority', P_SR),
      /** ★ `authority_label` 的真实位置在这里（不在 gen1 块） */
      authorityLabel: readField(g, 'authority_label', P_SR),
      healthStatus: readField(g, 'health_status', P_SR),
      healthGateStatus: readField(g, 'health_gate_status', P_SR),
      healthSource: readField(g, 'health_source', P_SR),
      safetySource: readField(g, 'safety_source', P_SR),
      counterfactualAuthorized: readField(g, 'counterfactual_authorized', P_SR),
      counterfactualHealthAllowed: readField(g, 'counterfactual_health_allowed', P_SR),
      counterfactualActive: readField(g, 'counterfactual_active', P_SR),
      counterfactualInactiveReason: readField(g, 'counterfactual_inactive_reason', P_SR),
      counterfactualInvocations: readField(g, 'counterfactual_invocations', P_SR),
      ledgerOk: readField(g, 'ledger_ok', P_SR),
      /** ★ 安全三字段：三态（true / false / **null**），⛔ 不得压扁（UI-G1-05 / UI-G1-16） */
      productionWrite: readField(g, 'production_write', P_SR),
      productionFastPathEnabled: readField(g, 'production_fast_path_enabled', P_SR),
      autoExecution: readField(g, 'auto_execution', P_SR),
      safetyInvariantOk: readField(g, 'safety_invariant_ok', P_SR)
    }),

    /** ★ Gen-2 边界（⛔ 不得被包装成 final target authority，SPEC §3.2） */
    gen2: Object.freeze({
      mode: readField(g2, 'mode', P_SR),
      source: readField(g2, 'source', P_SR),
      /** ⚠️ 线上实测为 `null` ⇒ **三态**，⛔ 不得当作 false（UI-G1-15 精神） */
      productionWrite: readField(g2, 'production_write', P_SR),
      productionWriteSource: readField(g2, 'production_write_source', P_SR)
    })
  });
}

function emptySystemRuntime() {
  const u = () => unavailable(MISSING_REASON.CONTRACT_NOT_PROVIDED, P_SR);
  return Object.freeze({
    available: false,
    runtimeStatusAvailable: u(),
    production: Object.freeze({ engine: u(), engineSource: u(), status: u() }),
    gen1: Object.freeze({}),
    gen2: Object.freeze({})
  });
}

/* ================= legacy ================= */

function adaptLegacyNotice(lg) {
  if (!lg || typeof lg !== 'object') {
    return Object.freeze({
      available: false,
      deprecated: unavailable(MISSING_REASON.CONTRACT_NOT_PROVIDED, P_LEGACY),
      doNotUseForAuthority: unavailable(MISSING_REASON.CONTRACT_NOT_PROVIDED, P_LEGACY),
      note: unavailable(MISSING_REASON.CONTRACT_NOT_PROVIDED, P_LEGACY),
      fields: Object.freeze([])
    });
  }
  return Object.freeze({
    available: true,
    deprecated: readField(lg, 'deprecated', P_LEGACY),
    doNotUseForAuthority: readField(lg, 'do_not_use_for_authority', P_LEGACY),
    note: readField(lg, 'note', P_LEGACY),
    fields: Array.isArray(lg.fields) ? Object.freeze(lg.fields.slice()) : Object.freeze([])
  });
}

/* ================= authority ================= */

/**
 * authority 唯一来源 = `system_runtime.gen1.authority`
 *   > `gen1.authority` > `runtime_status.gen1_authority`
 * ⛔ **不得**由 `ml_shadow*` / `ml_advisory_enabled` / `ml_fast_path_enabled` 反推（UI-G1-04）。
 */
export function resolveAuthority(data, runtimeStatus) {
  const srAuth = data && data.system_runtime && data.system_runtime.gen1 && data.system_runtime.gen1.authority;
  if (srAuth !== undefined && srAuth !== null) return provided(srAuth, provenance({ source: 'contract:system_runtime.gen1.authority', authority: AUTHORITY.SAFETY_CORE }));
  const gAuth = data && data.gen1 && data.gen1.authority;
  if (gAuth !== undefined && gAuth !== null) return provided(gAuth, provenance({ source: 'contract:gen1.authority', authority: AUTHORITY.GEN1 }));
  const rsAuth = runtimeStatus && runtimeStatus.gen1_authority;
  if (rsAuth !== undefined && rsAuth !== null) return provided(rsAuth, provenance({ source: 'api:/api/constants#runtime_status.gen1_authority', authority: AUTHORITY.SAFETY_CORE }));
  return unavailable(MISSING_REASON.CONTRACT_NOT_PROVIDED, provenance({ source: 'none', authority: AUTHORITY.UNKNOWN }));
}

/* ================= legacy fallback（显式、受限） ================= */

/**
 * ⛔ **仅**在 canonical 整块未下发时使用，且必须显式标注（UI 打「legacy · 不可用于权威判断」角标）。
 * ⛔ 绝不把 legacy 值包装成 production / gen1 语义。
 */
export function legacyFallback(data, runtimeStatus) {
  if (hasCanonicalContract(data)) return Object.freeze({ used: false, reason: 'CANONICAL_PRESENT' });
  const ms = data && data.ml_shadow;
  if (!ms || typeof ms !== 'object') return Object.freeze({ used: false, reason: 'LEGACY_ABSENT' });
  return Object.freeze({
    used: true,
    reason: 'CANONICAL_ABSENT',
    values: Object.freeze({
      enabled: readField(ms, 'enabled', P_LEGACY),
      effective: readField(ms, 'effective', P_LEGACY),
      observe: readField(ms, 'observe', P_LEGACY),
      fastPathEnabled: readField(ms, 'fast_path_enabled', P_LEGACY),
      modelId: readField(ms, 'model_id', P_LEGACY),
      engineVersion: readField(ms, 'engine_version', P_LEGACY),
      uiPhase: readField(ms, 'ui_phase', P_LEGACY),
      productionPermission: readField(ms, 'production_permission', P_LEGACY),
      signalStatus: readField(ms, 'signal_status', P_LEGACY),
      hasSignalRow: readField(ms, 'has_signal_row', P_LEGACY),
      isStale: readField(ms, 'is_stale', P_LEGACY)
    })
  });
}

/* ================= 内部工具 ================= */

/** 扫描块内是否出现 legacy 语义键（契约违规检测，供测试断言） */
export function scanForbiddenKeys(block) {
  if (!block || typeof block !== 'object') return Object.freeze([]);
  const hits = [];
  (function walk(o, path) {
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o)) {
      const here = path ? path + '.' + k : k;
      if (LEGACY_SEMANTIC_KEYS.includes(k)) hits.push(here);
      walk(v, here);
    }
  })(block, '');
  return Object.freeze(hits);
}

export { FIELD_STATE, MISSING_REASON, hasValue, readBlock };

/* ================= 卡片级 Gen-1（Dashboard / 标的页用） =================
 * ⚠️ 实测：`/api/dashboard` 的 canonical 夹具把 `production` / `gen1` 放在**每张 card** 上，
 *    页面顶层只有 `system_runtime` / `legacy`。
 *    ⇒ 卡片级 Gen-1 必须单独适配，⛔ 不得用页面顶层的 `gen1` 冒充（那是系统级状态）。
 */
const P_CARD_GEN1 = provenance({ source: 'contract:cards[].gen1', authority: AUTHORITY.GEN1 });

/**
 * 把单张卡片的 `gen1` 块包成 `Field<Gen1CardVm>`。
 * - 块不存在 ⇒ `UNAVAILABLE / CONTRACT_NOT_PROVIDED`（线上旧 apiGateway 即此态）
 * - 块存在   ⇒ `PROVIDED`，值为适配后的领域对象
 */
export function cardGen1Field(rawBlock) {
  if (rawBlock === null || rawBlock === undefined || typeof rawBlock !== 'object') {
    return unavailable(MISSING_REASON.CONTRACT_NOT_PROVIDED, P_CARD_GEN1);
  }
  return provided(adaptGen1Block(rawBlock), P_CARD_GEN1);
}

/** 卡片级 `production` 块（canonical 契约的安全口径） */
const P_CARD_PROD = provenance({ source: 'contract:cards[].production', authority: AUTHORITY.SAFETY_CORE });

export function cardProductionField(rawBlock) {
  if (rawBlock === null || rawBlock === undefined || typeof rawBlock !== 'object') {
    return unavailable(MISSING_REASON.CONTRACT_NOT_PROVIDED, P_CARD_PROD);
  }
  return provided(adaptProduction(rawBlock), P_CARD_PROD);
}
