/**
 * 基本面模板、信号与证据聚合（取数与裁判分离）
 *
 * 约定：
 * - 硬数据只来自抓取/财报数字，LLM 不得覆盖；
 * - 定性按自然周聚合证据，按重仓股权重加权；
 * - 黄金利率/美元符号反向；
 * - 海外股价不进入 F。
 */

'use strict';

const { METRIC_TYPES, METRIC_LAYERS, GRADE_SCORES } = require('../constants');
const { materializeHoldingsYoy } = require('./overseas-filings');

/** 利率/美元升对黄金是利空 */
const INVERT_SIGNAL_INDICATORS = {
  '518880': ['real_rate', 'dollar_index']
};

/** 有真实序列、禁止 LLM 覆盖 */
const HARD_DATA_INDICATORS = {
  '513310': ['dram_price', 'nand_price', 'capex'],
  '515880': ['cloud_capex'],
  '159582': ['wafer_capex'],
  '518880': ['real_rate', 'dollar_index', 'etf_flow'],
  '159570': ['leading_revenue']
};

const QUALITATIVE_KEYS = {
  '513310': ['hbm_demand', 'ai_server_demand'],
  '515880': ['optical_800g', 'cpo_progress', 'asp'],
  '159582': ['domestic_order', 'penetration', 'advanced_process'],
  '518880': ['fed_policy', 'cb_gold_buy'],
  '159570': ['core_sales', 'bd_licensing', 'approval_export']
};

const INDICATOR_KEYS = {
  '513310': ['dram_price', 'nand_price', 'hbm_demand', 'capex', 'ai_server_demand'],
  '515880': ['cloud_capex', 'optical_800g', 'cpo_progress', 'asp'],
  '159582': ['wafer_capex', 'domestic_order', 'penetration', 'advanced_process'],
  '518880': ['real_rate', 'dollar_index', 'fed_policy', 'cb_gold_buy', 'etf_flow'],
  '159570': ['leading_revenue', 'core_sales', 'bd_licensing', 'approval_export']
};

const INDICATOR_LABELS = {
  dram_price: 'DRAM价格(dram_price,量化)',
  nand_price: 'NAND价格(nand_price,量化)',
  hbm_demand: 'HBM供需(hbm_demand,定性)',
  capex: '龙头CapEx(capex,量化)',
  ai_server_demand: 'AI服务器需求(ai_server_demand,定性)',
  cloud_capex: '云厂商CapEx(cloud_capex,量化)',
  optical_800g: '800G/1.6T需求(optical_800g,定性)',
  cpo_progress: 'CPO进展(cpo_progress,定性)',
  asp: '光模块盈利(asp,定性)',
  wafer_capex: '晶圆厂CapEx(wafer_capex,量化)',
  domestic_order: '国产设备订单(domestic_order,定性)',
  penetration: '国产替代进度(penetration,定性)',
  advanced_process: '先进制程投资(advanced_process,定性)',
  real_rate: '美国实际利率(real_rate,量化)',
  dollar_index: '美元指数(dollar_index,量化)',
  fed_policy: '美联储政策(fed_policy,定性)',
  cb_gold_buy: '全球央行购金(cb_gold_buy,定性)',
  etf_flow: '黄金ETF资金(etf_flow,量化)',
  leading_revenue: '龙头收入(leading_revenue,量化)',
  core_sales: '核心产品销售(core_sales,定性)',
  bd_licensing: 'BD授权(bd_licensing,定性)',
  approval_export: '审批与出海(approval_export,定性)'
};

/** 权重置 0，雷达与 F 不再使用，历史序列保留 */
const RETIRED_INDICATORS = [
  { code: '515880', indicator: 'ai_cluster', name: 'AI集群规模（已并入云厂CapEx）' },
  { code: '159582', indicator: 'leading_order', name: '龙头订单（已并入晶圆厂CapEx）' },
  { code: '159570', indicator: 'overseas', name: '海外商业化（已并入审批与出海）' },
  { code: '159570', indicator: 'clinical', name: '临床审批（已并入审批与出海）' }
];

/** 当前雷达模板（sync 用）。权重合计 100。 */
const FUNDAMENTAL_TEMPLATES = [
  { code: '513310', indicator: 'dram_price', name: 'DRAM价格', weight: 20, freq: 'daily', source: 'chinaflashmarket', unit: 'USD', metric_type: 'quantitative', layer: 'hard_data' },
  { code: '513310', indicator: 'nand_price', name: 'NAND价格', weight: 15, freq: 'daily', source: 'chinaflashmarket', unit: 'USD', metric_type: 'quantitative', layer: 'hard_data' },
  { code: '513310', indicator: 'capex', name: '龙头CapEx', weight: 25, freq: 'quarterly', source: 'sec', unit: '亿美元', metric_type: 'quantitative', layer: 'hard_data' }, // 龙头=海力士+三星+美光；硬数字暂仅美光美元，韩元不混入
  { code: '513310', indicator: 'hbm_demand', name: 'HBM供需', weight: 20, freq: 'weekly', source: 'llm_week', unit: '级', metric_type: 'qualitative', layer: 'earnings' },
  { code: '513310', indicator: 'ai_server_demand', name: 'AI服务器需求', weight: 20, freq: 'weekly', source: 'llm_week', unit: '级', metric_type: 'qualitative', layer: 'earnings' },
  { code: '515880', indicator: 'cloud_capex', name: '云厂商CapEx', weight: 35, freq: 'quarterly', source: 'sec', unit: '亿美元', metric_type: 'quantitative', layer: 'hard_data' },
  { code: '515880', indicator: 'optical_800g', name: '800G/1.6T需求', weight: 25, freq: 'weekly', source: 'llm_week', unit: '级', metric_type: 'qualitative', layer: 'earnings' },
  { code: '515880', indicator: 'cpo_progress', name: 'CPO进展', weight: 15, freq: 'weekly', source: 'llm_week', unit: '级', metric_type: 'qualitative', layer: 'events' },
  { code: '515880', indicator: 'asp', name: '光模块盈利', weight: 25, freq: 'weekly', source: 'llm_week', unit: '级', metric_type: 'qualitative', layer: 'earnings' },
  { code: '159582', indicator: 'wafer_capex', name: '晶圆厂CapEx', weight: 30, freq: 'quarterly', source: 'sec', unit: '亿美元', metric_type: 'quantitative', layer: 'hard_data' },
  { code: '159582', indicator: 'domestic_order', name: '国产设备订单', weight: 25, freq: 'weekly', source: 'llm_week', unit: '级', metric_type: 'qualitative', layer: 'events' },
  { code: '159582', indicator: 'penetration', name: '国产替代进度', weight: 20, freq: 'weekly', source: 'llm_week', unit: '级', metric_type: 'qualitative', layer: 'earnings' },
  { code: '159582', indicator: 'advanced_process', name: '先进制程投资', weight: 25, freq: 'weekly', source: 'llm_week', unit: '级', metric_type: 'qualitative', layer: 'earnings' },
  { code: '518880', indicator: 'real_rate', name: '美国实际利率', weight: 30, freq: 'daily', source: 'fred', unit: '%', metric_type: 'quantitative', layer: 'hard_data', signal_invert: true },
  { code: '518880', indicator: 'dollar_index', name: '美元指数', weight: 20, freq: 'daily', source: 'tencent', unit: '', metric_type: 'quantitative', layer: 'hard_data', signal_invert: true },
  { code: '518880', indicator: 'etf_flow', name: '黄金ETF资金', weight: 15, freq: 'daily', source: 't-goldream', unit: '吨', metric_type: 'quantitative', layer: 'hard_data' },
  { code: '518880', indicator: 'fed_policy', name: '美联储政策', weight: 15, freq: 'weekly', source: 'llm_week', unit: '级', metric_type: 'qualitative', layer: 'events' },
  { code: '518880', indicator: 'cb_gold_buy', name: '全球央行购金', weight: 20, freq: 'weekly', source: 'llm_week', unit: '级', metric_type: 'qualitative', layer: 'events' },
  { code: '159570', indicator: 'leading_revenue', name: '龙头收入', weight: 25, freq: 'quarterly', source: 'hk_income', unit: '%', metric_type: 'quantitative', layer: 'hard_data' },
  { code: '159570', indicator: 'core_sales', name: '核心产品销售', weight: 25, freq: 'weekly', source: 'llm_week', unit: '级', metric_type: 'qualitative', layer: 'earnings' },
  { code: '159570', indicator: 'bd_licensing', name: 'BD授权', weight: 25, freq: 'weekly', source: 'llm_week', unit: '级', metric_type: 'qualitative', layer: 'events' },
  { code: '159570', indicator: 'approval_export', name: '审批与出海', weight: 25, freq: 'weekly', source: 'llm_week', unit: '级', metric_type: 'qualitative', layer: 'events' }
];

/** SEC 数字 → 硬数据格子（不经 LLM） */
const SEC_HARD_SPECS = [
  // 513310 龙头=海力士+三星+美光；硬格子暂仅美光美元 CapEx，韩元不混入
  { code: '513310', indicator: 'capex', symbols: ['usMU'], field: 'capex_ytd', unit: '亿美元', scale: 1e8 },
  { code: '515880', indicator: 'cloud_capex', symbols: ['usMSFT', 'usGOOGL', 'usAMZN', 'usMETA', 'usORCL'], field: 'capex_ytd', unit: '亿美元', scale: 1e8, aggregate: 'sum' },
  { code: '159582', indicator: 'wafer_capex', symbols: ['usTSM', 'usASML', 'usAMAT'], field: 'capex_ytd', unit: '亿美元', scale: 1e8, aggregate: 'sum' }
];

const MAJOR_EVENT_KEYWORDS = [
  '获批', '中标', '涨价', '下调', '下修', '失败', '授权', 'license', '供不应求',
  '减产', '扩产', 'sold-out', '熔断', '暂停', '终止', '超预期', '低于预期'
];

const ETF_LEVEL_EVIDENCE_WEIGHT = 8;

function isQualitative(code, indicator) {
  return (QUALITATIVE_KEYS[code] || []).includes(indicator);
}

function isHardData(code, indicator) {
  return (HARD_DATA_INDICATORS[code] || []).includes(indicator);
}

function shouldInvert(code, indicator, cfg) {
  if (cfg && cfg.signal_invert === true) return true;
  return (INVERT_SIGNAL_INDICATORS[code] || []).includes(indicator);
}

function indicatorListText(code) {
  return (INDICATOR_KEYS[code] || []).map((k) => INDICATOR_LABELS[k] || k).join('、');
}

/** 北京时间所在自然周的周一 YYYY-MM-DD */
function weekDataDate(d = new Date()) {
  const bj = new Date(d.getTime() + 8 * 3600 * 1000);
  const day = bj.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  bj.setUTCDate(bj.getUTCDate() + diff);
  return bj.toISOString().slice(0, 10);
}

function beijingDateStr(d = new Date()) {
  const bj = new Date(d.getTime() + 8 * 3600 * 1000);
  return bj.toISOString().slice(0, 10);
}

function isMajorEvent(title) {
  const t = String(title || '');
  return MAJOR_EVENT_KEYWORDS.some((k) => t.toLowerCase().indexOf(k.toLowerCase()) >= 0);
}

function clampSignal(v) {
  return Math.max(-2, Math.min(2, v));
}

function quantSignal(row) {
  const value = Number(row && row.value);
  const prev = row && row.prev != null ? Number(row.prev) : null;
  if (Number.isFinite(value) && prev != null && Number.isFinite(prev) && prev !== 0) {
    const pct = ((value - prev) / Math.abs(prev)) * 100;
    return clampSignal(pct / 5);
  }
  if (row && row.direction === 'up') return 1;
  if (row && row.direction === 'down') return -1;
  return 0;
}

function gradeSignal(value) {
  const grade = Math.round(Number(value));
  return (grade >= 1 && grade <= 5 && GRADE_SCORES[grade] != null) ? GRADE_SCORES[grade] : 0;
}

function indicatorSignal(row, cfg) {
  if (!row || !cfg) return 0;
  const qualitative = cfg.metric_type === METRIC_TYPES.QUALITATIVE || cfg.metric_type === 'qualitative';
  let signal = qualitative ? gradeSignal(row.value) : quantSignal(row);
  if (shouldInvert(cfg.code, cfg.indicator, cfg)) signal = -signal;
  return signal;
}

/**
 * 周内定性聚合。人工否决优先；其余按 confidence × 持仓权重加权。
 * @param {Array<{grade:number, confidence?:number, weight?:number, source?:string}>} items
 * @returns {number|null} 1~5
 */
function aggregateQualitative(items) {
  const list = Array.isArray(items) ? items : [];
  const veto = list.find((it) => it && (it.source === 'manual_veto' || it.source === 'manual'));
  if (veto) {
    const g = Math.round(Number(veto.grade));
    return (g >= 1 && g <= 5) ? g : null;
  }
  let num = 0;
  let den = 0;
  list.forEach((it) => {
    const grade = Math.round(Number(it && it.grade));
    if (grade < 1 || grade > 5) return;
    const conf = Number(it.confidence);
    const cw = (conf >= 0 && conf <= 1) ? conf : 0.6;
    const hw = Number(it.weight);
    const w = cw * (Number.isFinite(hw) && hw > 0 ? hw : ETF_LEVEL_EVIDENCE_WEIGHT);
    num += grade * w;
    den += w;
  });
  if (den <= 0) return null;
  return Math.max(1, Math.min(5, Math.round(num / den)));
}

function parseScore(item, direction) {
  const s = Number(item && item.score);
  if (Number.isFinite(s) && s >= -100 && s <= 100) return Math.round(s);
  return direction === 'up' ? 50 : -50;
}

function amountYi(v, scale) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const s = scale != null ? scale : 1e8;
  return Math.round((n / s) * 100) / 100;
}

/** 硬数据合法来源：日期更新的 LLM 分数不能盖过抓取数字 */
const HARD_SERIES_SOURCES = [
  'hk_income', 'sec_hard', 'chinaflashmarket', 'fred', 'tencent', 't-goldream', 'eastmoney'
];

function isHardSeriesSource(source) {
  const s = String(source || '');
  return HARD_SERIES_SOURCES.some((p) => s === p || s.indexOf(p) === 0);
}

/** 已从 F 拿掉的标的：历史 sec/LLM 行不得再上屏 */
const CUT_CONDUCTION_RE = /礼来|\bLLY\b|usLLY|\bAAOI\b|usAAOI|\bAAPL\b|usAAPL|\bTSLA\b|usTSLA|\bQCOM\b|usQCOM|\bSNDK\b|usSNDK|\bGLW\b|usGLW|鲁抗|鲁抗医药|600789|恒瑞医药/;

function isCutConductionRow(code, row) {
  if (!row) return false;
  const blob = `${row.source || ''} ${row.note || ''} ${row.stock_code || ''} ${row.stock_name || ''}`;
  return CUT_CONDUCTION_RE.test(blob);
}

/** 已按 data_date 倒序的序列里，硬格子只取抓取源；没有就空，不回退 LLM/礼来 */
function pickLatestSeries(rows, cfg) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => !isCutConductionRow(cfg && cfg.code, r));
  if (list.length === 0) return null;
  const hard = cfg && (cfg.metric_type === METRIC_TYPES.QUANTITATIVE || cfg.metric_type === 'quantitative'
    || isHardData(cfg.code, cfg.indicator));
  if (hard) {
    return list.find((r) => isHardSeriesSource(r && r.source)) || null;
  }
  return list[0];
}

/** 从最新财报行算出硬数据值 */
function materializeSecValue(spec, bySymbol) {
  const rows = (spec.symbols || []).map((s) => bySymbol[s]).filter(Boolean);
  if (rows.length === 0) return null;
  const vals = rows.map((r) => Number(r[spec.field])).filter((n) => Number.isFinite(n));
  if (vals.length === 0) return null;
  let raw;
  if (spec.aggregate === 'sum') raw = vals.reduce((a, b) => a + b, 0);
  else raw = vals.reduce((a, b) => a + b, 0) / vals.length;
  const scale = spec.scale != null ? spec.scale : 1;
  return Math.round((raw / scale) * 100) / 100;
}

function layerOf(cfg) {
  return (cfg && cfg.layer) || METRIC_LAYERS.HARD_DATA;
}

/** 把最新模板写回 fundamental_config（退役项 weight=0，不删历史） */
async function syncFundamentalConfigs(db, collectionName) {
  const col = collectionName || 'fundamental_config';
  for (const t of FUNDAMENTAL_TEMPLATES) {
    await db.upsert(col, { ...t }, { code: t.code, indicator: t.indicator });
  }
  for (const r of RETIRED_INDICATORS) {
    await db.upsert(col, {
      code: r.code, indicator: r.indicator, name: r.name, weight: 0,
      freq: 'quarterly', source: 'retired', unit: '', metric_type: 'qualitative', layer: 'events'
    }, { code: r.code, indicator: r.indicator });
  }
  return FUNDAMENTAL_TEMPLATES.length + RETIRED_INDICATORS.length;
}

module.exports = {
  INVERT_SIGNAL_INDICATORS,
  HARD_DATA_INDICATORS,
  QUALITATIVE_KEYS,
  INDICATOR_KEYS,
  INDICATOR_LABELS,
  RETIRED_INDICATORS,
  FUNDAMENTAL_TEMPLATES,
  SEC_HARD_SPECS,
  MAJOR_EVENT_KEYWORDS,
  ETF_LEVEL_EVIDENCE_WEIGHT,
  isQualitative,
  isHardData,
  shouldInvert,
  indicatorListText,
  weekDataDate,
  beijingDateStr,
  isMajorEvent,
  quantSignal,
  gradeSignal,
  indicatorSignal,
  aggregateQualitative,
  parseScore,
  amountYi,
  materializeSecValue,
  pickLatestSeries,
  isCutConductionRow,
  isHardSeriesSource,
  HARD_SERIES_SOURCES,
  layerOf,
  syncFundamentalConfigs,
  materializeHoldingsYoy
};
