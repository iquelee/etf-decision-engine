/**
 * 标签与文案（web/src/rewrite/domain/labels.js）
 * 规范依据：SPEC §3 / §4 / §5 / §12.1
 *
 * ★ 单一来源：**全部** action / risk / regime / state 文案只在本文件定义。
 *   旧前端把这些映射抄了 2~4 份（审计 §4.2），本模块是唯一权威。
 *
 * - 保留后端历史脏数据所需的别名（小写 action、中英混合 over_alloc），
 *   但**归一化逻辑只此一处**。
 */

/* ---------------- 动作 ---------------- */
export const ACTION_LABELS = Object.freeze({
  WAIT: '等待', BUILD: '建仓', ADD: '加仓', HOLD: '持有',
  TACTICAL_REDUCE: '战术减仓', STRATEGIC_REDUCE: '战略减仓', EXIT: '清仓'
});

/** 历史脏数据别名 → canonical（仅用于归一，⛔ 不用于新增代码） */
const ACTION_ALIASES = Object.freeze({
  wait: 'WAIT', build: 'BUILD', add: 'ADD', hold: 'HOLD',
  tactical_reduce: 'TACTICAL_REDUCE', strategic_reduce: 'STRATEGIC_REDUCE', exit: 'EXIT'
});

export function normalizeAction(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v);
  if (ACTION_LABELS[s]) return s;
  return ACTION_ALIASES[s] || ACTION_ALIASES[s.toLowerCase()] || null;
}

/** 动作中文；未知时**返回原文**而非 '—'（保留可诊断性） */
export function actionLabel(v) {
  const code = normalizeAction(v);
  if (code) return ACTION_LABELS[code];
  if (v === null || v === undefined || v === '') return '—';
  return String(v);
}

/**
 * 动作 → tone（与 owner 既有 `toneForAction()` 语义一致，SPEC §12.1）
 * accent = 加/建 · good = 持有 · risk = 减/清 · muted = 其它
 */
export function toneForAction(v) {
  const code = normalizeAction(v);
  if (code === 'ADD' || code === 'BUILD') return 'accent';
  if (code === 'HOLD') return 'good';
  if (code === 'TACTICAL_REDUCE' || code === 'STRATEGIC_REDUCE' || code === 'EXIT') return 'risk';
  return 'muted';
}

/* ---------------- 风险 ---------------- */
export const RISK_LABELS = Object.freeze({ NORMAL: '正常', YELLOW: '暂停加仓', RED: '风险熔断' });

/**
 * 风险值归一（★ 线上实测 `overview.overall_risk` 下发的是**中文**「正常」，
 * 而 `three_questions` 系字段历史上有英文枚举 —— 两种都可能出现，⛔ 不得只认一种）。
 * 归一逻辑只此一处（同 `overAllocLabel` 的处理思路）。
 */
const RISK_ALIASES = Object.freeze({
  normal: 'NORMAL', 正常: 'NORMAL',
  yellow: 'YELLOW', 暂停加仓: 'YELLOW', 黄: 'YELLOW',
  red: 'RED', 风险熔断: 'RED', 熔断: 'RED', 红: 'RED'
});

export function normalizeRisk(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  return RISK_ALIASES[s] || RISK_ALIASES[s.toUpperCase()] || null;
}

export function riskLabel(v) {
  if (v === null || v === undefined || v === '') return '—';
  const code = normalizeRisk(v);
  return code ? RISK_LABELS[code] : String(v);
}

/** 风险 tone（⛔ 与行情色分离：风险用 --risk-*） */
export function toneForRisk(v) {
  const code = normalizeRisk(v);
  if (code === 'RED') return 'risk';
  if (code === 'YELLOW') return 'warn';
  if (code === 'NORMAL') return 'good';
  return 'muted';
}

/* ---------------- 市场环境 ---------------- */
export const REGIME_LABELS = Object.freeze({
  aggressive: '进攻', structural: '结构性行情', range: '震荡',
  defensive: '防守', crisis: '系统性风险', recovery: '修复'
});

export function regimeLabel(v) {
  if (v === null || v === undefined || v === '') return '—';
  return REGIME_LABELS[String(v).toLowerCase()] || String(v);
}

export function toneForRegime(v) {
  const k = String(v || '').toLowerCase();
  if (k === 'aggressive' || k === 'structural') return 'good';
  if (k === 'defensive' || k === 'crisis') return 'risk';
  return 'neutral';
}

/* ---------------- 六组状态码 ---------------- */
export const STATE_LABELS = Object.freeze({
  W1: '强趋势', W2: '趋势完整', W3: '周线震荡', W4: '趋势破坏', W5: '趋势反转',
  D1: '上涨', D2: '上涨后横盘', D3: '正常回调', D4: '高位震荡', D5: '趋势破坏',
  H1: '优秀整理(Score≥75·上涨后)', H2: '良好整理(Score≥65)', H3: '一般(量未降)',
  H4: '危险(高点下降)', H5: '防守(放量破位)',
  V1: '强缩量', V2: '温和缩量', V3: '正常量能', V4: '放量', V5: '异常放量',
  F1: '加速', F2: '稳定', F3: '中性', F4: '恶化', F5: '证伪',
  C1: '正常', C2: '偏热', C3: '拥挤', C4: '极端拥挤'
});

/** 维度全称（SPEC §4.2：界面不得单独出现裸字母） */
export const STATE_DIM_LABELS = Object.freeze({
  W: '周线', D: '日线', H: '横盘', V: '量能', F: '基本面', C: '拥挤度'
});

export function stateLabel(code) {
  if (code === null || code === undefined || code === '') return '—';
  return STATE_LABELS[String(code)] || String(code);
}

export function stateDimLabel(kind) {
  return STATE_DIM_LABELS[String(kind || '').toUpperCase()] || String(kind || '');
}

/* ---------------- 超配状态（历史脏数据含中英混合） ---------------- */
export const OVER_ALLOC_LABELS = Object.freeze({
  normal: '正常', mild: '轻度', moderate: '中度', severe: '明显', extreme: '极端',
  正常: '正常', 轻度: '轻度', 中度: '中度', 明显: '明显', 极端: '极端'
});

export function overAllocLabel(v) {
  if (v === null || v === undefined || v === '') return '—';
  return OVER_ALLOC_LABELS[v] || String(v);
}

/* ---------------- Gen-1 信号状态 ---------------- */
export const GEN1_STATUS_LABELS = Object.freeze({
  NO_OPPORTUNITY: '暂无机会',
  OBSERVED: '已观察',
  CANDIDATE: '快速通道候选',
  BLOCKED: '被规则拦截',
  DEGRADED: '数据降级'
});

export function gen1StatusLabel(v) {
  if (v === null || v === undefined || v === '') return '—';
  return GEN1_STATUS_LABELS[String(v)] || String(v);
}

/* ---------------- Gen-2 角色 ---------------- */
export const GEN2_ROLE_LABELS = Object.freeze({
  CORE: '核心', CHALLENGER: '挑战者', SATELLITE: '卫星', RESERVE: '储备', HEDGE: '对冲'
});

export function gen2RoleLabel(v) {
  if (!v) return '—';
  return GEN2_ROLE_LABELS[String(v)] || String(v);
}

/* ---------------- ETF 名称（无接口名单时的兜底） ---------------- */
export const ETF_NAMES = Object.freeze({
  513310: '中韩半导体ETF(QDII)',
  515880: '通信ETF',
  159582: '半导体设备ETF',
  518880: '黄金ETF',
  159570: '港股通创新药ETF'
});

export function etfName(code, list = []) {
  if (!code) return '—';
  const hit = (list || []).find((x) => x && x.code === code);
  if (hit && hit.name) return hit.name;
  return ETF_NAMES[code] || code;
}

/* ---------------- 赛道 ---------------- */
export const SECTOR_LABELS = Object.freeze({
  storage: '存储', ai_network: 'AI互联', semi_equip: '半导体设备',
  gold: '黄金', biotech: '港股通创新药'
});

export function sectorLabel(v) {
  if (!v) return '—';
  return SECTOR_LABELS[v] || String(v);
}

/* ---------------- 角色分类（Gen-2 selection） ---------------- */
export const SELECTION_MODE_LABEL = Object.freeze({
  SHADOW: '影子观察（Selection / Shadow / Research）',
  PRODUCTION: '生产'
});

/* ================================================================
 * 以下为 M3 增补。仍遵守「文案只此一处」原则（SPEC §12.1）。
 * ================================================================ */

/* ---------------- 三方身份标识（SPEC §3：职责边界必须显式标注） ---------------- */

/** V3 Safety Core = 安全闸门 + 最终权威（Dashboard 的「正式决策」归它） */
export const IDENTITY_SAFETY_CORE = 'V3 Safety Core · 安全与最终权威';

/** Gen-1 = 时机建议（⛔ 不是最终交易决定、⛔ 不是仓位 authority） */
export const IDENTITY_GEN1 = 'GEN-1 · TIMING / ADVISORY';

/** Gen-2 = 选池观察（⛔ 不得呈现为最终仓位 authority；SPEC §3.2） */
export const IDENTITY_GEN2 = 'GEN-2 · SELECTION / SHADOW / RESEARCH';

/** Gen-1 身份的补充说明（首页必须可见，防误读为交易决定） */
export const GEN1_BOUNDARY_NOTE = 'Gen-1 只提供时机与适用性建议；仓位与最终动作由 V3 Safety Core 决定。';

/** Gen-2 身份的补充说明 */
export const GEN2_BOUNDARY_NOTE = 'Gen-2 当前仅做选池观察与研究，不产生正式仓位建议。';

/* ---------------- 数据状态文案（SPEC §9 统一状态机） ---------------- */

export const FIELD_STATE_TEXT = Object.freeze({
  PROVIDED: '',
  MISSING: '字段缺失',
  UNAVAILABLE: '数据未提供',
  STALE: '数据已过期',
  ERROR: '读取失败'
});

export function fieldStateText(state) {
  if (!state) return '';
  return FIELD_STATE_TEXT[state] !== undefined ? FIELD_STATE_TEXT[state] : '数据未提供';
}

export const MISSING_REASON_TEXT = Object.freeze({
  FIELD_ABSENT: '后端未下发该字段',
  NULL_IN_CONTRACT: '后端下发了该字段但值为 null',
  CONTRACT_NOT_PROVIDED: '后端契约未下发',
  RUNTIME_STATUS_UNAVAILABLE: '运行时状态不可读',
  NO_BACKEND_CONTRACT: '尚无后端契约'
});

export function missingReasonText(reason) {
  if (!reason) return '原因未知';
  return MISSING_REASON_TEXT[reason] || String(reason);
}

/* ---------------- 数据来源通道文案（provenance 显示） ---------------- */

export const SOURCE_CHANNEL_TEXT = Object.freeze({
  CANONICAL: '正式契约',
  RUNTIME_STATUS: '运行时状态',
  LEGACY: '历史兼容字段',
  NONE: '无来源'
});

export function sourceChannelText(k) {
  return SOURCE_CHANNEL_TEXT[k] || String(k || '无来源');
}

/** 通道补充警示（⛔ 只有 CANONICAL 才可用于权威判断） */
export const SOURCE_CHANNEL_NOTE = Object.freeze({
  CANONICAL: '',
  RUNTIME_STATUS: '非契约通道：与契约字段语义可能不同步',
  LEGACY: '历史兼容字段：⛔ 不得用于权限或阶段判定',
  NONE: ''
});

export function sourceChannelNote(k) {
  return SOURCE_CHANNEL_NOTE[k] || '';
}

/* ---------------- Gen-1 权限 / 健康 / 信号 ---------------- */

export const GEN1_PERMISSION_LABELS = Object.freeze({
  ALLOW: '允许', BLOCK: '阻止', OBSERVE: '仅观察', OBSERVE_ONLY: '仅观察', DEGRADED: '降级'
});

export function gen1PermissionLabel(v) {
  if (v === null || v === undefined || v === '') return '—';
  return GEN1_PERMISSION_LABELS[String(v).toUpperCase()] || String(v);
}

export const GEN1_HEALTH_LABELS = Object.freeze({
  OK: '正常', HEALTHY: '正常', DEGRADED: '降级', UNKNOWN: '未知', PENDING: '待定', ERROR: '异常'
});

export function gen1HealthLabel(v) {
  if (v === null || v === undefined || v === '') return '—';
  return GEN1_HEALTH_LABELS[String(v).toUpperCase()] || String(v);
}

/** 健康 tone（⛔ 与行情/动作色分域） */
export function toneForGen1Health(v) {
  const k = String(v || '').toUpperCase();
  if (k === 'OK' || k === 'HEALTHY') return 'good';
  if (k === 'DEGRADED' || k === 'ERROR') return 'risk';
  if (k === 'PENDING' || k === 'UNKNOWN') return 'warn';
  return 'muted';
}

export const GEN1_HEALTH_GATE_LABELS = Object.freeze({
  ACTIVE: '门控生效', INACTIVE: '门控未生效', PASS: '通过', BLOCKED: '已拦截'
});

export function gen1HealthGateLabel(v) {
  if (v === null || v === undefined || v === '') return '—';
  return GEN1_HEALTH_GATE_LABELS[String(v).toUpperCase()] || String(v);
}

export const GEN1_AUTHORITY_LABELS = Object.freeze({
  ADVISORY: '建议（advisory）',
  CANARY: '灰度反事实（canary）',
  PRODUCTION: '生产（production）',
  OFF: '关闭'
});

/**
 * authority 文案。
 * ⚠️ **后端标签优先**（`gen1_authority_label` / `system_runtime.gen1.authority_label`
 *    都是后端下发的中文，如「灰度反事实」）——本表仅在无后端标签时兜底。
 */
export function gen1AuthorityLabel(code, backendLabel) {
  if (backendLabel !== null && backendLabel !== undefined && backendLabel !== '') return backendLabel;
  if (code === null || code === undefined || code === '') return '—';
  return GEN1_AUTHORITY_LABELS[String(code).toUpperCase()] || String(code);
}

export const GEN1_SIGNAL_STATUS_LABELS = Object.freeze({
  NO_OPPORTUNITY: '暂无机会', OBSERVED: '已观察', CANDIDATE: '快速通道候选',
  BLOCKED: '被规则拦截', DEGRADED: '数据降级', NO_SIGNAL: '无信号行'
});

export function gen1SignalStatusLabel(v) {
  if (v === null || v === undefined || v === '') return '—';
  return GEN1_SIGNAL_STATUS_LABELS[String(v).toUpperCase()] || String(v);
}

/** 信号状态 tone */
export function toneForGen1Signal(v) {
  const k = String(v || '').toUpperCase();
  if (k === 'CANDIDATE') return 'accent';
  if (k === 'OBSERVED') return 'good';
  if (k === 'BLOCKED') return 'risk';
  if (k === 'DEGRADED') return 'warn';
  return 'muted';
}

/* ---------------- 生命周期维度显示名（SPEC §7.1） ----------------
 * ⚠️ `deployment_identity` 的显示名必须与台账概念区分：
 *    线上 `runtime_status.production_engine` 是**引擎版本**（审计冲突 A），
 *    不是台账的 `Production Deployment Identity`。⛔ 不得合并表述。
 */
export const LIFECYCLE_DIM_DISPLAY = Object.freeze({
  deployment: '受控部署',
  deployment_identity: '线上引擎版本',
  source_parity: '线上源码一致性',
  activation_authorization: '生产激活授权',
  first_controlled_run: '首次受控运行',
  prospective_epoch: '前瞻周期',
  run_history: '运行历史索引',
  general_production: '一般生产资格'
});

export const LIFECYCLE_DIM_CAVEAT = Object.freeze({
  deployment_identity: '此项为 API 下发的引擎版本；与台账「Production Deployment Identity」不是同一概念（口径冲突 A，未裁定）'
});

export function lifecycleDimDisplay(dim) {
  return LIFECYCLE_DIM_DISPLAY[dim] || String(dim);
}

export function lifecycleDimCaveat(dim) {
  return LIFECYCLE_DIM_CAVEAT[dim] || '';
}

/** 生命周期维度值的文案（仅展示用途；⛔ 不产生状态值） */
export const LIFECYCLE_VALUE_TEXT = Object.freeze({
  COMPLETE: '已完成', NOT_STARTED: '未开始', IN_PROGRESS: '进行中', FAILED: '失败',
  EXACT_MATCH: '完全一致', MISMATCH: '不一致', UNKNOWN: '未知',
  GRANTED: '已授权', NOT_GRANTED: '未授权', PENDING: '待定',
  EXECUTED: '已执行', NOT_EXECUTED: '未执行',
  STARTED: '已开始', AVAILABLE: '可用'
});

export function lifecycleValueText(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (v === true) return '是';
  if (v === false) return '否';
  return LIFECYCLE_VALUE_TEXT[String(v)] || String(v);
}
