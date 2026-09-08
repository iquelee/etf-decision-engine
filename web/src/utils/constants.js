/**
 * 前端常量（与后端 cloudfunctions/common/constants.js 保持一致，共享知识 B3-3）
 * 状态机枚举 → 中文文案、赛道映射、动作、风险、溢价。
 */

export const W_STATE_LABELS = {
  W1: '强趋势', W2: '趋势完整', W3: '周线震荡', W4: '趋势破坏', W5: '趋势反转'
};
export const D_STATE_LABELS = {
  D1: '上涨', D2: '上涨后横盘', D3: '正常回调', D4: '高位震荡', D5: '趋势破坏'
};
export const H_STATE_LABELS = {
  // P2 文案修正（2026-08-22）：与后端 constants.js 同步——H1 规则已改为「Score≥75 + 上涨后整理」
  H1: '优秀整理(Score≥75·上涨后)', H2: '良好整理(Score≥65)', H3: '一般(量未降)', H4: '危险(高点下降)', H5: '防守(放量破位)'
};
export const V_STATE_LABELS = {
  V1: '强缩量', V2: '温和缩量', V3: '正常量能', V4: '放量', V5: '异常放量'
};
export const F_STATE_LABELS = {
  F1: '加速', F2: '稳定', F3: '中性', F4: '恶化', F5: '证伪'
};
export const C_STATE_LABELS = {
  C1: '正常', C2: '偏热', C3: '拥挤', C4: '极端拥挤'
};

/** ML Gen-1 Shadow signal status (single vocabulary shared with backend). */
export const ML_SIGNAL_STATUSES = Object.freeze({
  NO_OPPORTUNITY: 'NO_OPPORTUNITY',
  OBSERVED: 'OBSERVED',
  CANDIDATE: 'CANDIDATE',
  BLOCKED: 'BLOCKED',
  DEGRADED: 'DEGRADED'
});
export const ML_SIGNAL_STATUS_LABELS = {
  NO_OPPORTUNITY: '暂无机会',
  OBSERVED: '已观察',
  CANDIDATE: '快速通道候选',
  BLOCKED: 'ML 机会 · 被规则拦截',
  DEGRADED: '数据降级'
};

export const ACTION_LIST = ['WAIT', 'BUILD', 'ADD', 'HOLD', 'TACTICAL_REDUCE', 'STRATEGIC_REDUCE', 'EXIT'];
export const ACTION_LABELS = {
  WAIT: '等待', BUILD: '建仓', ADD: '加仓', HOLD: '持有',
  TACTICAL_REDUCE: '战术减仓', STRATEGIC_REDUCE: '战略减仓', EXIT: '清仓',
  // 小写别名（防接口/历史脏数据）
  wait: '等待', build: '建仓', add: '加仓', hold: '持有', exit: '清仓',
  tactical_reduce: '战术减仓', strategic_reduce: '战略减仓'
};
export const ACTION_COLORS = {
  WAIT: '#6b7280', BUILD: '#2563eb', ADD: '#dc2626', HOLD: '#059669',
  TACTICAL_REDUCE: '#f59e0b', STRATEGIC_REDUCE: '#b91c1c', EXIT: '#7f1d1d'
};

/** 展示用动作名：优先按 code 查中文，避免 action_label 残留英文 BUILD 等 */
export function actionLabel(code, label) {
  if (code != null && ACTION_LABELS[code]) return ACTION_LABELS[code];
  if (label != null && ACTION_LABELS[label]) return ACTION_LABELS[label];
  const s = label != null && label !== '' ? String(label) : (code != null ? String(code) : '');
  if (!s) return '—';
  if (/^[A-Z][A-Z0-9_]*$/.test(s)) return ACTION_LABELS[s] || s;
  return s;
}

export const RISK_FLAG_LABELS = { NORMAL: '正常', YELLOW: '暂停加仓', RED: '风险熔断' };
export const RISK_FLAG_COLORS = { NORMAL: '#059669', YELLOW: '#d97706', RED: '#dc2626' };

/** 市场环境为内部枚举，前台统一显示中文。 */
export const MARKET_REGIME_LABELS = {
  aggressive: '进攻',
  structural: '结构性行情',
  range: '震荡',
  defensive: '防守',
  crisis: '系统性风险',
  recovery: '修复'
};
export function marketRegimeLabel(v) {
  if (v == null || v === '') return '—';
  return MARKET_REGIME_LABELS[String(v).toLowerCase()] || v;
}

/** 超配状态：库里 normal 是英文，其余级已是中文 */
export const OVER_ALLOC_LABELS = {
  normal: '正常', mild: '轻度', moderate: '中度', severe: '明显', extreme: '极端',
  正常: '正常', 轻度: '轻度', 中度: '中度', 明显: '明显', 极端: '极端'
};
export function overAllocLabel(v) {
  if (v == null || v === '') return '—';
  return OVER_ALLOC_LABELS[v] || v;
}

export const PREMIUM_FLAGS = ['正常', '轻度溢价', '明显溢价', '极端溢价'];

export const SECTORS = {
  storage: '存储', ai_network: 'AI互联', semi_equip: '半导体设备', gold: '黄金', biotech: '港股通创新药'
};

/** 展示用 ETF 名称（名称为主，代码为辅；有 etf_basic 时优先用接口 name） */
export const ETF_NAMES = {
  '513310': '中韩半导体ETF(QDII)',
  '515880': '通信ETF',
  '159582': '半导体设备ETF',
  '518880': '黄金ETF',
  '159570': '港股通创新药ETF'
};

/** 与后端 ENGINE_VERSION / VERSION.txt 同步 */
export let ENGINE_VERSION = 'V3.6.1';

// 五维评分维度（禁显 100 分，仅分维条）
export const SCORE_DIMENSIONS = [
  { key: 'trend', label: '趋势', max: 25 },
  { key: 'volume', label: '量价', max: 25 },
  { key: 'fundamental', label: '基本面', max: 25 },
  { key: 'crowding', label: '拥挤度', max: 15 },
  { key: 'risk', label: '风险', max: 10 }
];

// 机会分等级
// V3.1 B6：与后端 gradeOpportunity 对齐（A≥80/B≥65/C≥50/D≥35/E≥20/F<20）
// 前端展示一律用后端下发的 opportunity_grade；此函数仅作无 grade 时的兜底
export const OPPORTUNITY_GRADE_LABELS = {
  A: '强进攻', B: '积极', C: '持有', D: '警戒', E: '防守', F: '清仓'
};
export const OPPORTUNITY_GRADE_TONES = {
  A: 'good', B: 'good', C: 'warn', D: 'warn', E: 'bad', F: 'bad'
};
export function opportunityLevel(score) {
  if (score == null || Number.isNaN(score)) return { label: '—', tone: 'muted' };
  if (score >= 80) return { label: 'A', tone: 'good' };
  if (score >= 65) return { label: 'B', tone: 'good' };
  if (score >= 50) return { label: 'C', tone: 'warn' };
  if (score >= 35) return { label: 'D', tone: 'warn' };
  if (score >= 20) return { label: 'E', tone: 'bad' };
  return { label: 'F', tone: 'bad' };
}

// 防守等级（由高到低）
export function defenseLevel(highVolStag, highVolDecline, wState) {
  if (highVolDecline || wState === 'W5') return { label: '高', tone: 'bad' };
  if (highVolStag || wState === 'W4') return { label: '中', tone: 'warn' };
  return { label: '低', tone: 'good' };
}

/* ============ 单一事实源（D5 迁移 2026-08-22）============
 * 后端 /api/constants 为标签类常量的唯一权威源（改文案只改后端一处）。
 * applyServerConstants() 在启动时被调用，把后端标签**原地合并**进下方对象，
 * 因此各组件 `import { H_STATE_LABELS }` 的引用无需改动、模板渲染自动用新值。
 * 本地初始值仅作网络失败时的兜底。
 */
export function applyServerConstants(server = {}) {
  if (!server || typeof server !== 'object') return;
  const map = {
    w_state_labels: W_STATE_LABELS,
    d_state_labels: D_STATE_LABELS,
    h_state_labels: H_STATE_LABELS,
    v_state_labels: V_STATE_LABELS,
    f_state_labels: F_STATE_LABELS,
    c_state_labels: C_STATE_LABELS,
    action_labels: ACTION_LABELS,
    risk_flag_labels: RISK_FLAG_LABELS,
    sectors: SECTORS,
    etf_names: ETF_NAMES
  };
  Object.keys(map).forEach((key) => {
    if (server[key] && typeof server[key] === 'object') Object.assign(map[key], server[key]);
  });
  if (typeof server.engine_version === 'string' && server.engine_version) ENGINE_VERSION = server.engine_version;
}
