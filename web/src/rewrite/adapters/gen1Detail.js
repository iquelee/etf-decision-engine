/**
 * Gen-1 Detail 适配器（web/src/rewrite/adapters/gen1Detail.js）
 * 规范依据：owner 裁定 M4-D1（2026-09-30）＋ SPEC §6 ＋ M4-P0 §A/§F.6
 *
 * ── 裁定原文要点（⛔ 不得偏离）────────────────────────────────────────
 *   · 允许 Detail 展示现有 `decision.gen1_*`（59 键）+ `ml_shadow`（27 键），
 *     但**必须降级为 Legacy Advisory**，⛔ 不得伪装成 canonical Gen-1。
 *   · 统一进入 `Gen-1 · TIMING / ADVISORY` + `Legacy Channel`。
 *   · 视觉层级：`V3 Safety Core > Gen-1 Legacy Advisory`。
 *   · 某字段无可靠来源 ⇒ 「数据未提供」，⛔ 不得用其它字段偷偷补齐。
 *   · ⛔ 硬禁止：`ml_shadow` 冒充 canonical gen1。
 *
 * ── 三通道（优先级严格自上而下）─────────────────────────────────────
 *   1. `CANONICAL`       — `data.{production,gen1,system_runtime}`（V3.6.5 契约；线上**未部署**）
 *   2. `DECISION_LEGACY` — `data.decision.gen1_*` + `data.ml_shadow`（pre-contract 平铺）
 *   3. `NONE`            — 三级全无 ⇒ 全字段显式「数据未提供」
 *
 * ⛔ 本模块**不**做跨通道字段级拼接（禁止 2）：一旦选定通道，缺失字段就是缺失，
 *   ⛔ 不得"canonical 缺 X 就去 legacy 找 X 补上"。
 */
import { provided, missing, unavailable, readField, provenance, hasValue } from '../domain/provenance.js';
import { FIELD_STATE, MISSING_REASON, AUTHORITY, GEN1_CHANNEL } from '../domain/enums.js';
import {
  GEN1_SECTION_TITLE, GEN1_CHANNEL_LABEL, GEN1_CHANNEL_CAVEAT, GEN1_CHANNEL_TONE,
  GEN1_CHANNEL_NOTE, GEN1_PROVENANCE_SOURCE,
  GEN1_ADVISORY_DISCLAIMER, GEN1_COUNTERFACTUAL_NOTE, GEN1_LEGACY_FIELD_NOTE
} from '../domain/labels.js';
import { adaptGen1, hasCanonicalContract } from './gen1.js';
import { disp, pctText } from '../domain/display.js';

const P_CANON = provenance({ source: 'contract:system_runtime.gen1', authority: AUTHORITY.GEN1 });
const P_DECISION = provenance({ source: 'api:/api/etf/:code#decision.gen1_*', authority: AUTHORITY.GEN1, fallbackFrom: 'legacy' });
const P_ML = provenance({ source: 'api:/api/etf/:code#ml_shadow', authority: AUTHORITY.GEN1, fallbackFrom: 'legacy' });
const P_NONE = provenance({ source: 'none', authority: AUTHORITY.UNKNOWN });

/** legacy 平铺字段命名空间：`decision.gen1_*` 与 `ml_shadow.*` 两源分开记录 provenance */
const DEC = (f) => provenance({ source: 'api:/api/etf/:code#decision.' + f, authority: AUTHORITY.GEN1, fallbackFrom: 'legacy' });
const ML = (f) => provenance({ source: 'api:/api/etf/:code#ml_shadow.' + f, authority: AUTHORITY.GEN1, fallbackFrom: 'legacy' });

/**
 * ★ 本模块**有意不消费**的 legacy 键（诚实登记，⛔ 不是"漏了"）。
 *   收录原则：与 §B ViewModel 的 9 组展示字段无关的审计/封版/影子内部量。
 *   ⛔ 不得因为"看起来有用"而扩大消费面 —— 扩面需 owner 授权。
 */
const NOT_CONSUMED_LEGACY_PATTERNS = Object.freeze([
  /^gen1_guarded_(freeze_seal|evidence_seal|shadow_source|selector_source)/,
  /^gen1_canary_sector_remaining$/,
  /^gen1_counterfactual_sector_remaining$/,
  /^gen1_candidate_hash$/,
  /^bundle_id$/,
  /^decision_hash$/
]);

/**
 * @param {object|null} data `/api/etf/:code` 的 data
 * @param {object|null} runtimeStatus `/api/constants` 的 runtime_status（可选；仅作 authority 兜底）
 */
export function adaptGen1ForDetail(data, runtimeStatus = null) {
  const canonical = hasCanonicalContract(data);

  if (canonical) {
    return build(CANONICAL_SHAPE, {
      channel: GEN1_CHANNEL.CANONICAL,
      canonical: adaptGen1(data, runtimeStatus),
      legacy: null,
      legacyRaw: null
    });
  }

  const decision = data && typeof data.decision === 'object' ? data.decision : null;
  const shadow = data && typeof data.ml_shadow === 'object' ? data.ml_shadow : null;
  const legacyRaw = collectLegacy(decision, shadow);

  if (!legacyRaw.anySource) {
    return build(NONE_SHAPE, {
      channel: GEN1_CHANNEL.NONE,
      canonical: null,
      legacy: null,
      legacyRaw: null
    });
  }

  return build(LEGACY_SHAPE, {
    channel: GEN1_CHANNEL.DECISION_LEGACY,
    canonical: null,
    legacy: legacyRaw.fields,
    legacyRaw
  });
}

/* ============================================================
 * 形状构造器（每个通道一个，⛔ 不共用字段默认值 —— 避免"缺了就借别的通道"）
 * ============================================================ */

/** 三通道共有的外壳（标题 / 通道角标 / 声明 / 免责） */
function shell(channel) {
  return Object.freeze({
    title: GEN1_SECTION_TITLE,
    channel,
    channelLabel: GEN1_CHANNEL_LABEL[channel],
    channelCaveat: GEN1_CHANNEL_CAVEAT[channel],
    channelTone: GEN1_CHANNEL_TONE[channel],
    /** 通道警示 + 来源标注（⛔ 组件不得硬编码，也不得写后端字段名） */
    channelNote: GEN1_CHANNEL_NOTE[channel],
    sourceLabel: GEN1_PROVENANCE_SOURCE[channel],
    isCanonical: channel === GEN1_CHANNEL.CANONICAL,
    /** 值旁挂的角标（⛔ 只有 legacy 需要；canonical 不挂） */
    fieldTag: channel === GEN1_CHANNEL.DECISION_LEGACY ? GEN1_LEGACY_FIELD_NOTE : '',
    advisoryDisclaimer: GEN1_ADVISORY_DISCLAIMER,
    counterfactualNote: GEN1_COUNTERFACTUAL_NOTE
  });
}

/** canonical 通道：直接透传 M2 已适配的契约块（⛔ 不加 legacy 兜底） */
function CANONICAL_SHAPE(ctx) {
  const g = ctx.canonical.gen1;
  const sr = ctx.canonical.systemRuntime;
  return Object.freeze({
    available: true,
    authority: sr.gen1.authority !== undefined && hasValue(sr.gen1.authority) ? sr.gen1.authority : g.authority,
    authorityLabel: sr.gen1.authorityLabel,
    healthStatus: sr.gen1.healthStatus,
    healthGateStatus: sr.gen1.healthGateStatus,
    signal: Object.freeze({
      /* 契约 `gen1.signal.stage` 与 `gen1.stages.signal` 实测同值（均 S1），此处取 signal 块内那个 */
      stage: g.signal.stage,
      probability: g.signal.probability,
      threshold: g.signal.threshold,
      modelCandidate: g.signal.modelCandidate,
      signalStatus: g.signal.signalStatus
    }),
    stages: Object.freeze({ signal: g.stages.signal, baseline: g.stages.baseline, effective: g.stages.effective }),
    safetyGate: Object.freeze({
      permission: g.safety.permission, reasonCode: g.safety.reasonCode, reason: g.safety.reason,
      source: g.safety.source, bindingStage: g.safety.bindingStage, bindingStageSource: g.safety.bindingStageSource
    }),
    applicability: Object.freeze({
      domainStatus: g.applicability.domainStatus, domainPermission: g.applicability.domainPermission,
      label: g.applicability.label, message: g.applicability.message
    }),
    counterfactual: Object.freeze({
      /* ★ 同 legacy：仓位百分比在 VM 层格式化（⛔ 组件不手拼 %） */
      targetPct: pctText(g.counterfactual.targetPct),
      suggestedPct: pctText(g.counterfactual.suggestedPct),
      deltaPct: g.counterfactual.deltaPct, stageChanged: g.counterfactual.stageChanged,
      clamped: g.counterfactual.clamped, baselineFloorBreached: g.counterfactual.baselineFloorBreached
    }),
    dataHealth: Object.freeze({
      status: g.data.healthStatus, sourceTradeDate: g.data.sourceTradeDate, benchmarkLatestDate: g.data.benchmarkLatestDate
    }),
    meta: Object.freeze({
      runId: unavailable(MISSING_REASON.FIELD_ABSENT, P_CANON),
      modelId: unavailable(MISSING_REASON.FIELD_ABSENT, P_CANON),
      engineVersion: ctx.canonical.production.engine,
      generatedAt: unavailable(MISSING_REASON.FIELD_ABSENT, P_CANON),
      note: unavailable(MISSING_REASON.FIELD_ABSENT, P_CANON)
    }),
    notConsumed: Object.freeze([])
  });
}

/**
 * legacy 通道（`decision.gen1_*` + `ml_shadow`）。
 *
 * ⚠️ 与 canonical 的**结构对齐但语义独立**：字段名相同不代表同源。
 *    UI 必须同时显示 `Legacy Channel` 角标与逐字段 `Legacy 通道` 标注。
 */
function LEGACY_SHAPE(ctx) {
  const f = ctx.legacy;
  return Object.freeze({
    available: true,

    /** authority：`gen1_authority`（实测 `CANARY`） —— ⛔ 不是 system_runtime.gen1.authority */
    authority: f.authority,
    /** ⚠️ legacy 无后端中文标签（`authority_label` 只存在于契约），前端按枚举兜底映射 */
    authorityLabel: unavailable(MISSING_REASON.NO_BACKEND_CONTRACT, P_DECISION),

    healthStatus: f.healthStatus,
    healthGateStatus: f.healthGateStatus,

    signal: Object.freeze({
      /**
       * ⚠️ **语义推断**（已登记）：legacy 无 `stages.signal` 契约槽；此处取 `ml_shadow.stage`
       *    （实测 `S1`，与 `ml_rule_permission_reason` 所述"当前阶段 S1"一致）。
       *    ⛔ 契约部署后一律以 canonical `stages.signal` 为准。
       */
      stage: f.modelStage,
      probability: f.modelProbability,
      /** ⚠️ legacy 字段名是 `gen1_model_threshold_p`（**不是** canonical 的 `threshold`） */
      threshold: f.modelThresholdP,
      modelCandidate: f.modelCandidate,
      signalStatus: f.signalStatus
    }),

    stages: Object.freeze({
      signal: f.modelStage,
      baseline: f.baselineStage,
      effective: f.effectiveStage
    }),

    safetyGate: Object.freeze({
      permission: f.rulePermission,
      reasonCode: f.rulePermissionReasonCode,
      reason: f.rulePermissionReason,
      source: f.rulePermissionSource,
      bindingStage: unavailable(MISSING_REASON.FIELD_ABSENT, P_DECISION)
    }),

    applicability: Object.freeze({
      domainStatus: unavailable(MISSING_REASON.FIELD_ABSENT, P_DECISION),
      domainPermission: unavailable(MISSING_REASON.FIELD_ABSENT, P_DECISION),
      label: f.candidateReasonLabel,
      message: f.rulePermissionReason
    }),

    counterfactual: Object.freeze({
      /* ★ 仓位百分比（数值即百分数）⇒ 在 VM 层就格式化好，⛔ 组件不得手拼 % */
      targetPct: pctText(f.cfTargetPct),
      suggestedPct: pctText(f.cfSuggestedPct),
      deltaPct: f.cfDeltaPct,
      stageChanged: f.cfStageChanged,
      clamped: f.cfClamped,
      baselineFloorBreached: f.cfBaselineFloorBreached
    }),

    dataHealth: Object.freeze({
      status: f.healthSnapshot,
      sourceTradeDate: f.signalDate,
      benchmarkLatestDate: unavailable(MISSING_REASON.FIELD_ABSENT, P_ML)
    }),

    meta: Object.freeze({
      runId: f.runId,
      modelId: f.modelId,
      engineVersion: f.engineVersion,
      generatedAt: f.generatedAt,
      note: f.shadowNote
    }),

    /** ⛔ 有意不消费的键（诚实登记） */
    notConsumed: ctx.legacyRaw.notConsumed
  });
}

function NONE_SHAPE() {
  const u = (p) => unavailable(MISSING_REASON.CONTRACT_NOT_PROVIDED, p);
  const slot = () => u(P_NONE);
  return Object.freeze({
    available: false,
    authority: slot(), authorityLabel: slot(), healthStatus: slot(), healthGateStatus: slot(),
    signal: Object.freeze({ stage: slot(), probability: slot(), threshold: slot(), modelCandidate: slot(), signalStatus: slot() }),
    stages: Object.freeze({ signal: slot(), baseline: slot(), effective: slot() }),
    safetyGate: Object.freeze({ permission: slot(), reasonCode: slot(), reason: slot(), source: slot(), bindingStage: slot(), bindingStageSource: slot() }),
    applicability: Object.freeze({ domainStatus: slot(), domainPermission: slot(), label: slot(), message: slot() }),
    counterfactual: Object.freeze({ targetPct: slot(), suggestedPct: slot(), deltaPct: slot(), stageChanged: slot(), clamped: slot(), baselineFloorBreached: slot() }),
    dataHealth: Object.freeze({ status: slot(), sourceTradeDate: slot(), benchmarkLatestDate: slot() }),
    meta: Object.freeze({ runId: slot(), modelId: slot(), engineVersion: slot(), generatedAt: slot(), note: slot() }),
    notConsumed: Object.freeze([])
  });
}

/**
 * ★ 本模块对外输出的是**展示就绪（display-ready）**的 VM，而不是裸 `Field`：
 *   组件层只负责渲染 `{text, missing, reasonText}`，⛔ 不再自己解释 Field 状态。
 *
 * 原因（M4-P1 真实渲染核验抓到）：`FieldValue` 只认 display 对象；
 * 若这里透传裸 `Field`（`{state,value,provenance}`），Gen-1 整区的值会**全部渲染为空**
 * —— 且单测/SSR 若只断言"字段存在"是抓不到的，只有**浏览器实看**才暴露。
 *
 * ⚠️ 原始 Field 并未丢失：`disp()` 会把原 Field 挂在 `.field` 上，
 *    供 `missingItems` 扫描与回归断言使用（⛔ UI 不读 `.field`）。
 */
function build(shapeFn, ctx) {
  return toDisplay({ ...shell(ctx.channel), ...shapeFn(ctx) });
}

const FIELD_STATES = ['PROVIDED', 'MISSING', 'UNAVAILABLE', 'STALE', 'ERROR'];

function isField(v) {
  return !!v && typeof v === 'object' && typeof v.state === 'string' && FIELD_STATES.includes(v.state);
}

/** 已经是 display 对象（`{text, missing, ...}`）⇒ 原样保留，⛔ 不得二次包装 */
function isDisplay(v) {
  return !!v && typeof v === 'object' && typeof v.text === 'string' && typeof v.missing === 'boolean';
}

/** 深度把 `Field<T>` 转成 display 对象；已 display 的保持；字符串/数字等原样保留 */
function toDisplay(v) {
  if (isDisplay(v)) return v;
  if (isField(v)) return disp(v);
  if (Array.isArray(v)) return Object.freeze(v.map(toDisplay));
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = toDisplay(val);
    return Object.freeze(out);
  }
  return v;
}

/* ============================================================
 * legacy 平铺字段收集（⛔ 只读，不改写语义；取不到就是取不到）
 * ============================================================ */

function collectLegacy(decision, shadow) {
  const hasDecision = !!decision;
  const hasShadow = !!shadow;
  if (!hasDecision && !hasShadow) {
    return { anySource: false, fields: null, notConsumed: Object.freeze([]) };
  }
  const d = hasDecision ? decision : {};
  const m = hasShadow ? shadow : {};

  /** ⚠️ 字段全名必须逐字对照实测（M4-P0 §A.1.3），⛔ 不得凭印象缩略 */
  const fields = Object.freeze({
    /* -- 权限 / 阶段 -- */
    authority: readField(d, 'gen1_authority', DEC('gen1_authority')),
    effectiveStage: readField(d, 'gen1_effective_stage', DEC('gen1_effective_stage')),
    baselineStage: readField(d, 'v361_baseline_stage', DEC('v361_baseline_stage')),

    /* -- 模型信号 -- */
    modelStage: readField(m, 'stage', ML('stage')),
    modelProbability: readField(d, 'gen1_model_probability', DEC('gen1_model_probability')),
    modelThresholdP: readField(d, 'gen1_model_threshold_p', DEC('gen1_model_threshold_p')),
    modelCandidate: readField(d, 'gen1_model_candidate', DEC('gen1_model_candidate')),
    candidateReasonLabel: readField(d, 'gen1_model_candidate_reason_code', DEC('gen1_model_candidate_reason_code')),
    signalStatus: readField(m, 'signal_status', ML('signal_status')),

    /* -- 健康 -- */
    healthStatus: readField(d, 'gen1_health_status', DEC('gen1_health_status')),
    healthGateStatus: readField(d, 'gen1_health_gate_status', DEC('gen1_health_gate_status')),
    healthSnapshot: readField(d, 'gen1_signal_health_snapshot', DEC('gen1_signal_health_snapshot')),

    /* -- Safety Core 闸门（★ 注意：来源是 SAFETY_CORE，⛔ 不是 Gen-1 产出） -- */
    rulePermission: readField(d, 'ml_rule_permission', DEC('ml_rule_permission')),
    rulePermissionReasonCode: readField(d, 'ml_rule_permission_reason_code', DEC('ml_rule_permission_reason_code')),
    rulePermissionReason: readField(d, 'ml_rule_permission_reason', DEC('ml_rule_permission_reason')),
    rulePermissionSource: readField(d, 'ml_rule_permission_source', DEC('ml_rule_permission_source')),

    /* -- 反事实 -- */
    cfTargetPct: readField(d, 'gen1_counterfactual_target', DEC('gen1_counterfactual_target')),
    cfSuggestedPct: readField(d, 'gen1_counterfactual_suggested_position', DEC('gen1_counterfactual_suggested_position')),
    cfDeltaPct: readField(d, 'gen1_counterfactual_delta', DEC('gen1_counterfactual_delta')),
    cfStageChanged: readField(d, 'gen1_counterfactual_stage_changed', DEC('gen1_counterfactual_stage_changed')),
    cfClamped: readField(d, 'gen1_counterfactual_clamped', DEC('gen1_counterfactual_clamped')),
    cfBaselineFloorBreached: readField(d, 'gen1_counterfactual_baseline_floor_breached', DEC('gen1_counterfactual_baseline_floor_breached')),

    /* -- 数据健康（ml_shadow） -- */
    signalDate: readField(m, 'signal_date', ML('signal_date')),
    generatedAt: readField(m, 'generated_at', ML('generated_at')),
    modelId: readField(m, 'model_id', ML('model_id')),
    engineVersion: readField(m, 'engine_version', ML('engine_version')),
    shadowNote: readField(m, 'note', ML('note')),
    isStale: readField(m, 'is_stale', ML('is_stale')),
    dataAgeDays: readField(m, 'data_age_days', ML('data_age_days')),

    /* -- 运行标识 -- */
    runId: readField(d, 'gen1_run_id', DEC('gen1_run_id'))
  });

  /* ⛔ 诚实登记：未消费的 legacy 键（用于报告与 SPEC §D 核对，不在 UI 展示数值） */
  const allKeys = [
    ...Object.keys(d).filter((k) => /^gen1_|^ml_rule_|^eod_precheck|^v361_|^ml_advisory/.test(k)),
    ...Object.keys(m)
  ];
  const consumed = new Set([
    'gen1_authority', 'gen1_effective_stage', 'v361_baseline_stage',
    'gen1_model_probability', 'gen1_model_threshold_p', 'gen1_model_candidate',
    'gen1_model_candidate_reason_code', 'gen1_health_status', 'gen1_health_gate_status',
    'gen1_signal_health_snapshot', 'ml_rule_permission', 'ml_rule_permission_reason_code',
    'ml_rule_permission_reason', 'ml_rule_permission_source',
    'gen1_counterfactual_target', 'gen1_counterfactual_suggested_position', 'gen1_counterfactual_delta',
    'gen1_counterfactual_stage_changed', 'gen1_counterfactual_clamped', 'gen1_counterfactual_baseline_floor_breached',
    'gen1_run_id',
    'stage', 'signal_status', 'signal_date', 'generated_at', 'model_id', 'engine_version', 'note', 'is_stale', 'data_age_days'
  ]);
  const notConsumed = allKeys
    .filter((k, i) => allKeys.indexOf(k) === i)
    .filter((k) => !consumed.has(k))
    .filter((k) => NOT_CONSUMED_LEGACY_PATTERNS.some((re) => re.test(k)));

  /**
   * ★ 判定「是否真的有 Gen-1 数据」必须看**消费字段里有没有一个真值**。
   *   ⛔ 不能因为「decision 块存在」就认定有 —— 实测 `gen1-missing` 场景下 decision 仍在，
   *   只是 `gen1_*` 全被删除 ⇒ 必须落到 NONE 通道，显示「数据未提供」，
   *   ⛔ 不得因为 decision 在场就渲染一个空的 Legacy 通道（那会让用户以为"有数据但为空"）。
   */
  const wired = Object.values(fields).some((f) => f && f.state === FIELD_STATE.PROVIDED);
  return {
    anySource: wired,
    fields: wired ? fields : null,
    /** 字段无值但键曾出现 ⇒ 仍登记未消费清单（诊断用） */
    notConsumed: Object.freeze(notConsumed)
  };
}

export { GEN1_CHANNEL, FIELD_STATE, hasValue };
