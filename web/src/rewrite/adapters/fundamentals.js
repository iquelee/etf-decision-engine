/**
 * 基本面 / 情报适配器（web/src/rewrite/adapters/fundamentals.js）
 * 规范依据：SPEC §2 / §4.2 情报 / §9 / 附录 A
 *
 * 数据源：`GET /api/fundamentals`（5 只 ETF 的基本面卡）+ `GET /api/intel?limit=`
 *
 * 单位（SPEC 附录 A.2）：
 *   · `weight` / `holding_weight` = **占净值百分比**
 *   · `confidence` = **0~1 比例**（schema range [0,1]）
 *   · `detail.total_layer_weight` = 百分比（覆盖度）
 *   · `detail.layer_breakdown[*].signal` = 分层信号值（**有正负**，用于强弱分档）
 */
import { provided, missing, readField, readBlock, provenance } from '../domain/provenance.js';
import { FIELD_STATE, MISSING_REASON, AUTHORITY } from '../domain/enums.js';

const SRC_F = 'api:/api/fundamentals';
const SRC_I = 'api:/api/intel';
const P_F = (f) => provenance({ source: SRC_F + (f ? '.' + f : ''), authority: AUTHORITY.OPERATOR });
const P_I = (f) => provenance({ source: SRC_I + (f ? '.' + f : ''), authority: AUTHORITY.OPERATOR });

/** 三个基本面分层（与后端 layer 键一一对应） */
export const LAYER_KEYS = Object.freeze(['hard_data', 'earnings', 'events']);

export function adaptFundamentals(data) {
  const empty = !data || typeof data !== 'object';
  const list = empty ? null : data.list;
  if (!Array.isArray(list)) {
    return Object.freeze({ available: false, cards: missing(MISSING_REASON.FIELD_ABSENT, P_F()) });
  }
  return Object.freeze({
    available: true,
    cards: provided(Object.freeze(list.filter((c) => c && typeof c === 'object').map(adaptCard)), P_F())
  });
}

function adaptCard(c) {
  return Object.freeze({
    code: readField(c, 'code', P_F('code')),
    name: readField(c, 'name', P_F('name')),
    sector: readField(c, 'sector', P_F('sector')),
    fState: readField(c, 'f_state', P_F('f_state')),
    fScore: readField(c, 'f_score', P_F('f_score')),
    updatedAt: readField(c, 'updated_at', P_F('updated_at')),
    /** 合成判断：三分层信号 + 总覆盖权重 + 最终信号 */
    detail: Object.freeze({
      layerBreakdown: adaptLayerBreakdown(c.detail && c.detail.layer_breakdown),
      totalLayerWeight: readField(c.detail, 'total_layer_weight', P_F('detail.total_layer_weight')),
      finalSignal: readField(c.detail, 'final_signal', P_F('detail.final_signal'))
    }),
    indicators: adaptIndicators(c.indicators),
    aiJudgments: adaptAiJudgments(c.ai_judgments, c.indicators)
  });
}

function adaptLayerBreakdown(bd) {
  const P0 = P_F('detail.layer_breakdown');
  const out = {};
  for (const k of LAYER_KEYS) {
    const row = bd && typeof bd === 'object' ? bd[k] : null;
    out[k] = Object.freeze({
      count: readField(row, 'count', P0),
      signal: readField(row, 'signal', P0)
    });
  }
  return Object.freeze(out);
}

function adaptIndicators(list) {
  const P0 = P_F('indicators');
  if (!Array.isArray(list)) return missing(MISSING_REASON.FIELD_ABSENT, P0);
  const items = list
    .filter((i) => i && typeof i === 'object')
    .map((i) => Object.freeze({
      indicator: readField(i, 'indicator', P0),
      name: readField(i, 'name', P0),
      /** 占净值百分比 */
      weight: readField(i, 'weight', P0),
      layer: readField(i, 'layer', P0),
      /** `quantitative` | `qualitative` */
      metricType: readField(i, 'metric_type', P0),
      value: readField(i, 'value', P0),
      unit: readField(i, 'unit', P0),
      direction: readField(i, 'direction', P0),
      dataDate: readField(i, 'data_date', P0),
      sourceLabel: readField(i, 'source_label', P0),
      note: readField(i, 'note', P0),
      citations: readField(i, 'citations', P0)
    }));
  return provided(Object.freeze(items), P0);
}

/**
 * AI 研究证据。
 * ⚠️ 旧前端有二级兜底（从 `indicators` 里筛 `qualitative` 反推）。
 *    本适配器**保留该兜底但显式标注 derived**（SPEC §6.3：fallback 不得掩盖契约错误）。
 */
function adaptAiJudgments(judgments, indicators) {
  const P0 = P_F('ai_judgments');
  if (Array.isArray(judgments) && judgments.length) {
    return provided(Object.freeze(judgments.filter((j) => j && typeof j === 'object').map((j) => Object.freeze({
      indicator: readField(j, 'indicator', P0),
      title: readField(j, 'title', P0),
      stockName: readField(j, 'stock_name', P0),
      grade: readField(j, 'grade', P0),
      confidence: readField(j, 'confidence', P0),
      sourceLabel: readField(j, 'source_label', P0),
      reason: readField(j, 'reason', P0),
      weekDate: readField(j, 'week_date', P0)
    }))), P0);
  }
  if (Array.isArray(indicators)) {
    const derived = indicators
      .filter((i) => i && i.metric_type === 'qualitative' && (i.note || i.value != null))
      .map((i) => Object.freeze({
        indicator: readField(i, 'indicator', P0),
        title: readField(i, 'name', P0),
        stockName: { state: FIELD_STATE.MISSING, value: null, missingReason: MISSING_REASON.FIELD_ABSENT, provenance: P0 },
        grade: readField(i, 'value', P0),
        confidence: { state: FIELD_STATE.MISSING, value: null, missingReason: MISSING_REASON.FIELD_ABSENT, provenance: P0 },
        sourceLabel: readField(i, 'source_label', P0),
        reason: readField(i, 'note', P0),
        weekDate: readField(i, 'data_date', P0)
      }));
    if (derived.length) {
      return provided(Object.freeze(derived), provenance({
        source: SRC_F + '#derivedFromIndicators', authority: AUTHORITY.OPERATOR, derived: true
      }));
    }
  }
  return missing(MISSING_REASON.FIELD_ABSENT, P0);
}

/* ---------------- intel ---------------- */

export function adaptIntel(data) {
  const empty = !data || typeof data !== 'object';
  const items = empty ? null : data.items;
  if (!Array.isArray(items)) {
    return Object.freeze({ available: false, total: readField(data, 'total', P_I('total')), items: missing(MISSING_REASON.FIELD_ABSENT, P_I()) });
  }
  return Object.freeze({
    available: true,
    total: readField(data, 'total', P_I('total')),
    items: provided(Object.freeze(items.filter((i) => i && typeof i === 'object').map((i) => Object.freeze({
      type: readField(i, 'type', P_I()),
      typeLabel: readField(i, 'type_label', P_I()),
      title: readField(i, 'title', P_I()),
      time: readField(i, 'time', P_I()),
      detail: readField(i, 'detail', P_I()),
      impact: readField(i, 'impact', P_I()),
      tone: readField(i, 'tone', P_I()),
      /** 关联 ETF 代码数组（用于按标的过滤） */
      related: readField(i, 'related', P_I())
    }))), P_I())
  });
}

/** 按 ETF 过滤情报：⛔ 无关联的「市场杂音」不得出现在标的详情下（沿用旧语义） */
export function filterIntelByCode(intelVm, code) {
  const arr = intelVm && intelVm.items && intelVm.items.state === FIELD_STATE.PROVIDED ? intelVm.items.value : [];
  if (!code) return arr;
  return arr.filter((i) => {
    const rel = i.related && i.related.state === FIELD_STATE.PROVIDED ? i.related.value : null;
    if (!Array.isArray(rel) || !rel.length) return false;
    return rel.indexOf(code) >= 0;
  });
}

export { FIELD_STATE, readBlock };
