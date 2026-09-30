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
  /**
   * ⚠️ 必须**同时**试原样与小写：线上同一族字段既出现 `NORMAL`（大写英文），
   *   又出现「正常」（中文），而本表键为**小写英文 + 中文**。
   *   原实现只比 `s` 与 `s.toUpperCase()` ⇒ `NORMAL` 两个都落空、返回 null，
   *   后果：`risk_flag="NORMAL"` 的 tone 掉成 `muted`（与「未知」不可区分）。
   *   M4-P1 实测发现，M3 期间被 dashboard 的中文值掩盖。
   */
  return RISK_ALIASES[s] || RISK_ALIASES[s.toLowerCase()] || null;
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

/* ================================================================
 * 以下为 M4-P1 增补。仍遵守「文案只此一处」原则（SPEC §12.1）。
 * 裁定来源：owner 2026-09-30 对 M4-D1 / M4-D2 / M4-D3 的决定。
 * ================================================================ */

/* ---------------- M4-D1：Gen-1 在 ETF Detail 的数据通道身份 ----------------
 * ★ 裁定：允许展示 `decision.gen1_*`(59 键) + `ml_shadow`(27 键)，
 *   但**必须降级为 Legacy Advisory**，⛔ 不得伪装成 canonical Gen-1。
 * ★ 视觉层级：V3 Safety Core（正式决策）> Gen-1 Legacy Advisory。 */

/** 区块标题（三通道统一标题；权威等级由 LABEL 区分） */
export const GEN1_SECTION_TITLE = 'GEN-1 · TIMING / ADVISORY';

/** 通道角标文案 */
export const GEN1_CHANNEL_LABEL = Object.freeze({
  CANONICAL: 'Canonical Channel',
  DECISION_LEGACY: 'Legacy Channel',
  NONE: 'No Channel'
});

/** 通道说明（★ DECISION_LEGACY 的措辞由 owner 逐字给定，⛔ 不得改写） */
export const GEN1_CHANNEL_CAVEAT = Object.freeze({
  CANONICAL: '数据来源：V3.6.5 canonical 契约 system_runtime.gen1。',
  DECISION_LEGACY: '当前页面使用的是现有 legacy 通道数据；它不是 V3.6.5 canonical "system_runtime.gen1" 契约。',
  NONE: ''
});

/** 通道 tone（Legacy 用中性偏警示，⛔ 不得用与正式决策同级的强调色） */
export const GEN1_CHANNEL_TONE = Object.freeze({
  CANONICAL: 'good',
  DECISION_LEGACY: 'warn',
  NONE: 'muted'
});

/**
 * 通道来源标注（供 provenance 行渲染）。
 * ⚠️ 刻意**不写后端字段名**：面向用户的来源说明用大白话；
 *    ⛔ 不得在组件模板里硬编码这些串（M4-P1 回归测试抓到过）。
 */
export const GEN1_PROVENANCE_SOURCE = Object.freeze({
  CANONICAL: '正式契约 · 系统运行时',
  DECISION_LEGACY: '历史兼容通道 · 决策记录与影子观察',
  NONE: ''
});

/** 通道警示（⛔ 只有 CANONICAL 才可用于权威判断） */
export const GEN1_CHANNEL_NOTE = Object.freeze({
  CANONICAL: '',
  DECISION_LEGACY: '非契约通道：数值不得用于权限或阶段判定',
  NONE: ''
});

/** 权威降级声明（Gen-1 区**必须**可见） */
export const GEN1_ADVISORY_DISCLAIMER =
  'Gen-1 只提供时机与适用性建议，不构成正式交易决定，也不改变仓位目标；最终动作与目标由 V3 Safety Core 决定。';

/**
 * ★ 反事实专项声明：反事实目标与正式目标常取同值（实测均 0.5），极易误读为
 *   「Gen-1 决定了目标」。⚠️ 刻意**不写后端字段名**（用户偏好大白话，⛔ 不暴露原始字段）。
 */
export const GEN1_COUNTERFACTUAL_NOTE =
  '反事实只是影子推演，不改变正式目标；两者数值相同不代表 Gen-1 决定了目标。';

/** legacy 通道字段级标注（UI 挂在数值旁） */
export const GEN1_LEGACY_FIELD_NOTE = 'Legacy 通道';

/* ---------------- M4-D2：K 线陈旧（★ 与 decision freshness 严格独立） ----------------
 * ★ 裁定：置顶 Banner + **保留图表**；⛔ 不修改数据、⛔ 不猜最新价、⛔ 不删历史数据伪装正常、
 *   ⛔ 不得把 stale 当 empty；⛔ 不得把 K 线 stale 扩展成 ETF decision stale。 */

export const KLINE_STALE_TITLE = 'K 线数据已明显滞后';

/**
 * ★ Banner 正文——**日期必须来自实际数据**（⛔ 不得硬编码）。
 * @param {string} lastBarDate 实际最后一根 K 线日期（如 `2024-08-27`）
 * @param {string} decisionDate 实际决策日（如 `2026-09-29`）；无则省略比较句
 */
export function klineStaleBannerText(lastBarDate, decisionDate) {
  const a = lastBarDate || '—';
  if (!decisionDate) return '当前 K 线截至 ' + a + '。';
  return '当前 K 线截至 ' + a + '，早于当前决策日 ' + decisionDate + '。';
}

/** K 线区块内的状态标签（与 decision freshness 分开显示） */
export const KLINE_STATUS_LABEL = Object.freeze({
  FRESH: '数据新鲜',
  STALE: 'STALE · 数据滞后',
  MISSING: '无时间戳',
  UNAVAILABLE: '未提供',
  /** ★ 请求失败 —— ⛔ 必须与「空数据」和「缺失」都不同（把错误说成空是 SPEC §9 明令禁止的） */
  ERROR: '读取失败'
});

/** K 线图区固定说明（解释"为何图还在"） */
export const KLINE_STALE_KEEP_NOTE = '历史数据照常保留（不清空、不插值）；仅标注其实际时点。';

/* ---------------- M4-D3：决策链只保留定性 ----------------
 * ★ 裁定：`explain_chain` 与同文档字段存在三处数字冲突 ⇒ 本页**不消费**冲突数字。 */

export const CHAIN_SECTION_TITLE = '为什么（定性条件）';

export const CHAIN_MODE_NOTE =
  '本链仅保留定性条件；其中的数字与正式决策字段口径不一致（已核验冲突），故一律隐藏。'
  + '后端统一口径后再恢复定量。';

/** 数字遮蔽标记（UI 直接渲染；⛔ 不得替换为具体数字） */
export const CHAIN_QUANT_MASK = '［数字已隐藏］';

/** 结果含定量时的替代文案 */
export const CHAIN_RESULT_QUANT_HIDDEN = '（结果含定量，已隐藏）';

/** 统计隐藏条数的文案 */
export function chainHiddenSummary(hiddenCount, total) {
  if (!hiddenCount) return '';
  return '共 ' + total + ' 步，其中 ' + hiddenCount + ' 步含定量数字，已隐藏。';
}

/* ---------------- M4-P1：建议 / 实际 / 目标 三类仓位的显式命名 ----------------
 * ★ 依据 M4-P0 §F.3：`decision.core_position`(0.2 建议) ≠ `position.core_position`(12.6 实际)，
 *   ⛔ 不得放进同一个无标签数字卡。 */

export const POSITION_KIND_LABEL = Object.freeze({
  suggested: '建议（本次决策）',
  actual: '实际（当前持仓）',
  target: '目标（决策带）',
  config: '配置标准（etf_basic）'
});

export const POSITION_KIND_NOTE = Object.freeze({
  suggested: '来自 decision 块：本次决策给出的建议值',
  actual: '来自 position 块：账户当前真实持仓',
  target: '来自 decision 块：经组合约束后的最终目标带',
  config: '来自 position/basic 块：配置层面的标准目标带（⛔ 不是本次决策结果）'
});

/** ★ 仓位缺口来源标注（⛔ 组件不得硬编码；语义见 SPEC 附录 A.5） */
export const GAP_SOURCE_NOTE = '服务端值，⛔ 本页不重算';

/** ★ 本页「不重算」的统一声明（多个组件共用） */
export const NO_RECOMPUTE_NOTE =
  '⛔ 本页不重算任何上述数值（缺口 / 目标 / 等级均直接采用服务端值）；'
  + '⛔ 不从 `/api/etf/list` 借用同名字段补齐。';

/* ================================================================
 * 以下为 M4-P1 第二阶段增补（防守 / 机会 / 情报 / 历史）。
 * 仍遵守「文案只此一处」原则（SPEC §12.1）。
 * ================================================================ */

/* ---------------- 防守等级 ----------------
 * ★ 唯一来源 = 后端 `defenseLevelFromScore(score)`（返回**数字 0~4**）；
 *   ⛔ 前端**不得**自行按 W 态或 high_volume_* 重算（用户 M4-P1b §四明文禁止）。
 */
export const DEFENSE_LEVEL_LABELS = Object.freeze({
  0: '无防守信号',
  1: '轻度防守',
  2: '中度防守',
  3: '高度防守',
  4: '极高防守'
});

export function defenseLevelLabel(n) {
  if (n === null || n === undefined || n === '') return '—';
  const k = String(n);
  return DEFENSE_LEVEL_LABELS[k] !== undefined ? DEFENSE_LEVEL_LABELS[k] : String(n);
}

/** 防守等级 tone（⛔ 与行情色分域） */
export function toneForDefenseLevel(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 'muted';
  if (v >= 3) return 'risk';
  if (v >= 1) return 'warn';
  return 'good';
}

/** 量纲标注（★ 用户反复强调：分数 / 系数 / 百分比不得混用） */
export const DEFENSE_SCORE_NOTE = '分数 0~100（后端计算，⛔ 本页不重算、⛔ 不加 %）';
export const DEFENSE_PENALTY_NOTE = '乘性系数 0.50 ~ 1.00（⛔ 不是百分比）';
export const OPPORTUNITY_FACTOR_NOTE = '系数（⛔ 不是百分比）';
export const OPPORTUNITY_SCORE_NOTE = '分数（⛔ 不加 %）';

/** 防守族的统一「只读」声明 */
export const DEFENSE_READONLY_NOTE =
  '防守等级 / 分数 / 系数全部为后端已算结果，本页只展示；'
  + '⛔ 具备前端 self-compute 的旧实现（按 W 态与放量字段重算）已移除。';

/* ---------------- 加仓模式（schema desc：'横盘加仓/突破加仓/无'） ---------------- */
export const ADD_MODE_LABELS = Object.freeze({
  无: '无',
  横盘加仓: '横盘加仓',
  突破加仓: '突破加仓'
});

export function addModeLabel(v) {
  if (v === null || v === undefined || v === '') return '—';
  return ADD_MODE_LABELS[v] !== undefined ? ADD_MODE_LABELS[v] : String(v);
}

/** 加仓资格单项状态（与 `eligibilityTone` 配套；⛔ 语义由后端给定） */
export const ELIGIBILITY_STATUS_LABELS = Object.freeze({ ok: '通过', pause: '暂停' });

export function eligibilityStatusLabel(v) {
  if (v === null || v === undefined || v === '') return '—';
  return ELIGIBILITY_STATUS_LABELS[v] !== undefined ? ELIGIBILITY_STATUS_LABELS[v] : String(v);
}

/**
 * ★★ 机会区的**命名纪律**（用户 M4-P1b §三）：
 *   后端已有正式 action / final_target / position_gap ⇒ 那属 **V3 Safety Core 正式决策**；
 *   本区额外信息只能叫「机会 / 辅助信号」，⛔ **不得**叫「建议加仓」。
 */
export const OPPORTUNITY_SECTION_TITLE = '机会 / 辅助信号';
export const OPPORTUNITY_SECTION_NOTE =
  '本区为**辅助信号**，不是加仓建议；正式动作与目标见上方「正式决策」（V3 Safety Core）。';
export const OPPORTUNITY_NO_DERIVE_NOTE =
  '⛔ 本页不会因为「仓位缺口 > 0」就推导「应该加仓」—— 缺口是后端计算结果。';

/* ---------------- 情报 / 基本面 ---------------- */
export const INTELLIGENCE_SECTION_TITLE = '情报 / 基本面摘要';
export const INTELLIGENCE_SECTION_NOTE = '只展示有助于理解当前决策的证据；完整基本面属「基本面」页。';

/** 基本面分层（`fundamental.detail.layer_breakdown` 的键 → 中文） */
export const FUND_LAYER_LABELS = Object.freeze({
  hard_data: '硬数据',
  earnings: '景气 / 财报',
  events: '事件',
  ai_evidence: 'AI 研究证据'
});

export function fundLayerLabel(k) {
  return FUND_LAYER_LABELS[k] !== undefined ? FUND_LAYER_LABELS[k] : String(k);
}

/**
 * 基本面 detail 内的两个量纲标注。
 * ⚠️ `layer.signal` / `detail.final_signal` 的**量纲未由 schema 证实**
 *    ⇒ 页面只展示**后端原始值**，⛔ 不加 %、⛔ 不解释、⛔ 不换算。
 * `layer.weight` 实测 50 / 30、合计 = `total_layer_weight`(80) ⇒ **原始权重和**，⛔ 不是百分比。
 */
export const FUND_SIGNAL_NOTE = '后端原始信号值（本页不解释其量纲）';
export const FUND_WEIGHT_NOTE = '后端原始权重（⛔ 不是百分比）';

/**
 * ★★ 空数组语义（用户 M4-P1b §六 / §九.4）：
 *   `[]` 只能说明「当前没有返回事件数据」，⛔ **不得**说成「没有风险」。
 */
export const RISK_EVENTS_EMPTY_TEXT = '当前没有返回风险事件数据。';
export const RISK_EVENTS_EMPTY_NOTE = '⛔ 这不等于「没有风险」—— 只表示接口未返回事件记录。';

export const RISK_EVENT_STATUS_LABELS = Object.freeze({
  ACTIVE: '生效中', RESOLVED: '已解除', CLOSED: '已关闭'
});

export function riskEventStatusLabel(v) {
  if (v === null || v === undefined || v === '') return '—';
  const k = String(v).toUpperCase();
  return RISK_EVENT_STATUS_LABELS[k] !== undefined ? RISK_EVENT_STATUS_LABELS[k] : String(v);
}

/* ---------------- 历史决策变化 ----------------
 * ★★ 硬规则（用户 M4-P1b §七 / §九.5）：
 *   有真实历史 API ⇒ 展示真实历史；没有 ⇒ 明说「数据未提供」；
 *   ⛔ **绝对不得**用「当前 target + 当前 action + 当前日期」拼一条假历史，
 *     也 ⛔ 不得据当前字段猜测「持有 → 加仓 → 防守」。
 */
export const HISTORY_SECTION_TITLE = '历史决策变化';
export const HISTORY_SOURCE_NOTE = '来源：后端历史决策记录（逐条实测，⛔ 不由当前字段拼装）';
export const HISTORY_EMPTY_TEXT = '后端返回的历史决策记录为空。';
export const HISTORY_EMPTY_NOTE = '⛔ 「记录为空」与「接口未提供」是两种不同状态，故文案不同。';
export const HISTORY_UNAVAILABLE_TEXT = '历史决策变化：数据未提供。';
export const HISTORY_UNAVAILABLE_NOTE =
  '⛔ 本页不会用当前决策字段拼装历史，也不会据当前字段推测历史动作变化。';

/** 变化维度（相邻两条实测值的差异，⛔ 不推断原因） */
export const HISTORY_CHANGE_KINDS = Object.freeze([
  { key: 'action', label: '动作' },
  { key: 'target', label: '目标' },
  { key: 'risk', label: '风险' },
  { key: 'defense', label: '防守' }
]);

export const HISTORY_CHANGE_NOTE = '变化 = 相邻两条后端记录的实测值差异（⛔ 不推断原因）。';
