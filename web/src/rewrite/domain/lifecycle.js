/**
 * 生命周期状态机（web/src/rewrite/domain/lifecycle.js）
 * 规范依据：SPEC §1.2 / §1.3 / §7
 *
 * ★★ 三条硬约束（owner 裁定）：
 *   1. **8 个维度必须分开建模**，⛔ 不得合成一个「总状态」；
 *   2. **无 API 数据 ⇒ NOT_PROVIDED**，⛔ 前端**不得写死**当前状态；
 *   3. **三个轴必须永远可区分**：
 *        代码部署完成  ≠  首次受控 production run  ≠  正式 general production
 *
 * 因此本模块**不包含任何** `COMPLETE` / `NOT_STARTED` 字面量常量；
 * 状态值只能来自外部数据（API 或 owner 授权的静态登记件），否则为 ABSENT。
 */
import { LIFECYCLE_DIM, LIFECYCLE_DIMS, FIELD_STATE, MISSING_REASON, AUTHORITY } from './enums.js';
import { provided, unavailable, provenance } from './provenance.js';

/**
 * 8 个维度的定义。
 * `kind` 决定 UI 呈现方式与「该维度回答什么问题」。
 */
export const LIFECYCLE_SPEC = Object.freeze([
  { dim: LIFECYCLE_DIM.DEPLOYMENT, label: '受控部署',
    question: '受控部署是否已完成？', kind: 'state', values: ['COMPLETE', 'NOT_STARTED', 'IN_PROGRESS', 'FAILED'] },
  { dim: LIFECYCLE_DIM.DEPLOYMENT_IDENTITY, label: '生产部署身份',
    question: '线上跑的是哪个版本？', kind: 'identity', values: null },
  { dim: LIFECYCLE_DIM.SOURCE_PARITY, label: '线上源码一致性',
    question: '线上源码与冻结候选是否一致？', kind: 'state', values: ['EXACT_MATCH', 'MISMATCH', 'UNKNOWN'] },
  { dim: LIFECYCLE_DIM.ACTIVATION_AUTHORIZATION, label: '生产激活授权',
    question: '是否获准激活生产？', kind: 'state', values: ['GRANTED', 'NOT_GRANTED', 'PENDING'] },
  { dim: LIFECYCLE_DIM.FIRST_CONTROLLED_RUN, label: '首次受控运行',
    question: '是否已发生首次受控生产运行？', kind: 'state', values: ['EXECUTED', 'NOT_EXECUTED'] },
  { dim: LIFECYCLE_DIM.PROSPECTIVE_EPOCH, label: '前瞻周期',
    question: '前瞻资格周期是否已开始？', kind: 'state', values: ['STARTED', 'NOT_STARTED'] },
  { dim: LIFECYCLE_DIM.RUN_HISTORY, label: '运行历史索引',
    question: 'run 历史索引是否可用？', kind: 'state', values: ['AVAILABLE', 'PENDING'] },
  { dim: LIFECYCLE_DIM.GENERAL_PRODUCTION, label: '一般生产资格',
    question: '是否已取得一般生产资格？', kind: 'boolean', values: [true, false] }
]);

/**
 * ★ 三个轴的分组（用于 UI 分栏与不变量校验）。
 * ⛔ 任意轴内或轴间的「合并成单一状态」都是违规。
 */
export const LIFECYCLE_AXES = Object.freeze([
  { axis: 'code_on_line', label: '代码上线', dims: [
    LIFECYCLE_DIM.DEPLOYMENT, LIFECYCLE_DIM.DEPLOYMENT_IDENTITY, LIFECYCLE_DIM.SOURCE_PARITY ] },
  { axis: 'production_run', label: '生产运行', dims: [
    LIFECYCLE_DIM.ACTIVATION_AUTHORIZATION, LIFECYCLE_DIM.FIRST_CONTROLLED_RUN ] },
  { axis: 'qualification', label: '资格演进', dims: [
    LIFECYCLE_DIM.PROSPECTIVE_EPOCH, LIFECYCLE_DIM.RUN_HISTORY, LIFECYCLE_DIM.GENERAL_PRODUCTION ] }
]);

/** 维度 → 轴（反向索引） */
export const DIM_TO_AXIS = Object.freeze(
  LIFECYCLE_AXES.reduce((acc, a) => { a.dims.forEach((d) => { acc[d] = a.axis; }); return acc; }, {})
);

/**
 * 静态登记件（D-2 方案 B 的接入点）。
 *
 * ⛔ **当前为 `null`** —— 表示「无后端契约、也无 owner 授权的静态登记」，
 *    因此 8 个维度全部走 `ABSENT / NO_BACKEND_CONTRACT`（SPEC §7.3）。
 * ✅ 若 owner 后续授权以「版本化静态清单」表达生命周期（D-2 方案 B），
 *    只需把该清单注入此处，**无需改前端其它代码**。
 *    清单格式：{ asOf: 'YYYY-MM-DD', anchor: '<台账条目>', values: { <dim>: value } }
 */
export const STATIC_REGISTER = null;

/**
 * 读取生命周期。
 *
 * @param {object|null} runtimeStatus `/api/constants` 的 `runtime_status`（可能不存在）
 * @param {object|null} systemRuntime 契约的 `system_runtime`（线上未部署 ⇒ 通常为 null）
 * @param {object|null} staticRegister 见 STATIC_REGISTER
 */
export function readLifecycle(runtimeStatus, systemRuntime, staticRegister = STATIC_REGISTER) {
  const rsProv = provenance({ source: 'api:/api/constants#runtime_status', authority: AUTHORITY.OPERATOR, asOf: runtimeStatus && runtimeStatus.updated_at });
  const srProv = provenance({ source: 'contract:system_runtime', authority: AUTHORITY.SAFETY_CORE });
  const stProv = provenance({ source: 'static-register', authority: AUTHORITY.OPERATOR, derived: true, asOf: staticRegister && staticRegister.asOf });

  const dims = {};
  for (const spec of LIFECYCLE_SPEC) {
    dims[spec.dim] = resolveDim(spec, { runtimeStatus, systemRuntime, staticRegister, rsProv, srProv, stProv });
  }

  return Object.freeze({
    dims,
    axes: LIFECYCLE_AXES.map((a) => Object.freeze({
      axis: a.axis,
      label: a.label,
      dims: a.dims,
      allProvided: a.dims.every((d) => dims[d].state === FIELD_STATE.PROVIDED)
    })),
    /** `runtime_status` 是否可读（供 UI 显示「数据未提供」时的原因） */
    runtimeStatusAvailable: !!(runtimeStatus && typeof runtimeStatus === 'object'),
    /** 是否使用了静态登记（⛔ 使用了就必须在 UI 上显式标注其 asOf） */
    staticRegisterUsed: !!(staticRegister && staticRegister.values)
  });
}

/** 单维度解析：静态登记 > system_runtime > runtime_status > ABSENT */
function resolveDim(spec, ctx) {
  const { runtimeStatus, systemRuntime, staticRegister, rsProv, srProv, stProv } = ctx;

  // 1) owner 授权的静态登记（方案 B；默认关闭）
  if (staticRegister && staticRegister.values && has(staticRegister.values, spec.dim)) {
    return provided(staticRegister.values[spec.dim], stProv);
  }

  // 2) canonical 契约 system_runtime（线上未部署契约 ⇒ 走 3 或 4）
  if (systemRuntime && typeof systemRuntime === 'object') {
    const v = fromSystemRuntime(spec.dim, systemRuntime);
    if (v !== undefined) return provided(v, srProv);
  }

  // 3) runtime_status 直读（仅 deployment_identity 有部分可读：仅引擎版本，非台账身份）
  if (runtimeStatus && typeof runtimeStatus === 'object') {
    const v = fromRuntimeStatus(spec.dim, runtimeStatus);
    if (v !== undefined) return provided(v, rsProv);
  }

  // 4) 无任何来源 ⇒ ABSENT（⛔ 绝不写死）
  return unavailable(
    runtimeStatus ? MISSING_REASON.CONTRACT_NOT_PROVIDED : MISSING_REASON.RUNTIME_STATUS_UNAVAILABLE,
    provenance({ source: 'none', authority: AUTHORITY.UNKNOWN })
  );
}

function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

/**
 * 从 canonical `system_runtime` 取值。
 * ⚠️ 现有契约只提供 production.{status,engine,engine_source} 与 gen2.{mode,source}，
 *    **没有任何一个维度**能被它完整满足 ⇒ 除 deployment_identity 外均返回 undefined。
 *    （这正是 SPEC §7.1「6 项无接口」的机器可验证表达。）
 */
function fromSystemRuntime(dim, sr) {
  if (dim === LIFECYCLE_DIM.DEPLOYMENT_IDENTITY) {
    const eng = sr.production && sr.production.engine;
    // 引擎版本 ≠ 台账部署身份（V3.6.5）；只在有值时以「引擎」身份暴露
    return eng !== undefined && eng !== null ? eng : undefined;
  }
  return undefined;
}

/**
 * 从 `runtime_status` 取值。
 * ⚠️ `runtime_status.production_engine` 是**引擎版本**（线上实测为 "v3.6.1"），
 *    与台账 `Production Deployment Identity = V3.6.5` **不是同一概念**（审计 §5.1 冲突 A）。
 *    因此这里把它作为「引擎版本」暴露，并**明确记录其来源**，⛔ 不与台账身份合并。
 */
function fromRuntimeStatus(dim, rs) {
  if (dim === LIFECYCLE_DIM.DEPLOYMENT_IDENTITY) {
    return rs.production_engine !== undefined && rs.production_engine !== null ? rs.production_engine : undefined;
  }
  return undefined;
}

/**
 * `runtime_status` 的**边界字段组**（SPEC §7.2）。
 * ⚠️ 相关但语义独立，必须**整体展示**并写明反例
 *   （例：`ml_advisory_enabled = true` 时 `ml_execution_enabled` 仍可为 false）。
 */
export const BOUNDARY_FIELDS = Object.freeze([
  { key: 'ml_effective', label: 'ML 生效',
    counter: '语义独立：为 true 时其余边界仍可各自为 false（反例：ml_effective=true ∧ execution=false）' },
  { key: 'ml_advisory_enabled', label: 'ML 建议启用',
    counter: '语义独立：advisory=true 不代表 execution=true（反例：advisory=true ∧ execution=false）' },
  { key: 'ml_execution_enabled', label: 'ML 执行启用',
    counter: '语义独立：execution 独立于 advisory 与 effective' },
  { key: 'gen1_production_write', label: 'Gen-1 写生产',
    counter: '恒 false：CANARY/ADVISORY 档位下不得写生产' },
  { key: 'gen1_auto_execution', label: 'Gen-1 自动执行',
    counter: '恒 false：本系统为人工执行，未接自动交易' },
  { key: 'gen1_broker_wired', label: '券商已接线',
    counter: '恒 false：未接券商通道' },
  { key: 'gen1_production_fast_path_enabled', label: 'Gen-1 生产快速通道',
    counter: '语义独立：独立于 authority 与 health 状态' }
]);

export function readBoundaryFields(runtimeStatus) {
  const prov = provenance({
    source: 'api:/api/constants#runtime_status',
    authority: AUTHORITY.OPERATOR,
    asOf: runtimeStatus && runtimeStatus.updated_at
  });
  if (!runtimeStatus || typeof runtimeStatus !== 'object') {
    return BOUNDARY_FIELDS.map((f) => ({ ...f, field: unavailable(MISSING_REASON.RUNTIME_STATUS_UNAVAILABLE, prov) }));
  }
  return BOUNDARY_FIELDS.map((f) => {
    const raw = runtimeStatus[f.key];
    return {
      ...f,
      field: raw === undefined ? unavailable(MISSING_REASON.FIELD_ABSENT, prov) : provided(raw, prov)
    };
  });
}

/**
 * ★ 轴分离不变量校验（SPEC §1.3）。
 * 传入任意「合成后」的对象，若它把三个轴塌缩成单一状态 ⇒ 返回违规列表。
 *
 * 用途：contract test 断言 UI 的 lifecycle view-model ⛔ 不出现
 *      `overall_status` / `production_status` 这类字段名。
 */
const FORBIDDEN_COLLAPSED_KEYS = Object.freeze([
  'overall_status', 'overall', 'production_status', 'lifecycle_status',
  'is_production_ready', 'production_running', 'fully_production'
]);

export function validateAxisSeparation(obj, path = '') {
  const violations = [];
  if (!obj || typeof obj !== 'object') return violations;
  for (const [k, v] of Object.entries(obj)) {
    const here = path ? path + '.' + k : k;
    if (FORBIDDEN_COLLAPSED_KEYS.includes(k)) violations.push(here);
    if (v && typeof v === 'object') violations.push(...validateAxisSeparation(v, here));
  }
  return violations;
}

/**
 * ⛔ 生命周期违规文案检测（SPEC §1.3）——用于 contract test。
 * 这些短语把「部署完成」误述为「已生产运行」。
 */
export const FORBIDDEN_LIFECYCLE_PHRASES = Object.freeze([
  '正式生产运行', '生产运行中', '已开始生产周期', '最近生产运行', '生产周期已开始'
]);

export { LIFECYCLE_DIMS };
