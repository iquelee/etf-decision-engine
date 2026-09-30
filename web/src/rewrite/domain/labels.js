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

export function riskLabel(v) {
  if (v === null || v === undefined || v === '') return '—';
  return RISK_LABELS[String(v).toUpperCase()] || String(v);
}

/** 风险 tone（⛔ 与行情色分离：风险用 --risk-*） */
export function toneForRisk(v) {
  const k = String(v || '').toUpperCase();
  if (k === 'RED') return 'risk';
  if (k === 'YELLOW') return 'warn';
  if (k === 'NORMAL') return 'good';
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
