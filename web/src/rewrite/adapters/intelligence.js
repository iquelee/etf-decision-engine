/**
 * 情报 / 基本面摘要适配器（web/src/rewrite/adapters/intelligence.js）
 * 规范依据：owner M4-P1b §六 / §九.4
 *
 * ★ 只展示**有助于理解当前决策**的证据；⛔ 不展开 `fundamental_config` / `fundamental_series`。
 *
 * ★★ `risk_events` 的语义纪律（用户 §六 / §九.4）：
 *   `[]` ⇒ 「**当前没有返回风险事件数据**」
 *   ⛔ **绝不** ⇒ 「没有风险」（两者语义完全不同）
 *
 * ★ 量纲纪律（实测 + 源码）：
 *   · `f_score`      = 点数（⛔ 不加 %）
 *   · `layer.weight` = 后端原始权重（实测 50 / 30，合计 80 = total_layer_weight）⇒ ⛔ 不是百分比
 *   · `layer.signal` / `detail.final_signal` = **后端原始信号值**（量纲未证实 ⇒ 只原值展示，⛔ 不解释）
 */
import { readField, unavailable, provenance, hasValue } from '../domain/provenance.js';
import { FIELD_STATE, MISSING_REASON, AUTHORITY } from '../domain/enums.js';
import { scoreText, ratioText, dateTimeText, rawText } from '../domain/display.js';
import {
  fieldStateText, stateLabel, fundLayerLabel,
  INTELLIGENCE_SECTION_NOTE, FUND_SIGNAL_NOTE as SIGNAL_NOTE, FUND_WEIGHT_NOTE as WEIGHT_NOTE
} from '../domain/labels.js';

const SRC = 'api:/api/etf/:code';
const P = (f) => provenance({ source: SRC + '.' + f, authority: AUTHORITY.SAFETY_CORE });

/**
 * @param {object|null} fundamental `data.fundamental`（原始）
 * @param {object} riskEvents 已适配的事件对象（**直接引用** defense 组的产物，⛔ 不重复计算）
 */
export function adaptIntelligence(fundamental, riskEvents) {
  const f = fundamental && typeof fundamental === 'object' ? fundamental : null;

  if (!f) {
    const u = () => unavailable(MISSING_REASON.CONTRACT_NOT_PROVIDED, P('fundamental'));
    return Object.freeze({
      available: false,
      sectionNote: INTELLIGENCE_SECTION_NOTE,
      fundamental: Object.freeze({
        available: false,
        fState: u(), fStateText: fieldStateText(FIELD_STATE.UNAVAILABLE),
        fScore: u(), fScoreText: scoreText(u()),
        updatedAt: u(), updatedAtText: dateTimeText(u())
      }),
      layers: Object.freeze({ available: false, items: Object.freeze([]), totalLayerWeight: null, note: '' }),
      detail: Object.freeze({ available: false, finalSignal: null, finalSignalText: null, signalNote: SIGNAL_NOTE }),
      riskEvents,
      notConsumed: Object.freeze(['基本面分层配置', '基本面序列', '前十大重仓'])
    });
  }

  const fState = readField(f, 'f_state', P('fundamental.f_state'));
  const detail = f.detail && typeof f.detail === 'object' ? f.detail : null;
  const lb = detail && detail.layer_breakdown && typeof detail.layer_breakdown === 'object'
    ? detail.layer_breakdown : null;

  return Object.freeze({
    available: true,
    sectionNote: INTELLIGENCE_SECTION_NOTE,

    fundamental: Object.freeze({
      available: true,
      fState,
      fStateText: hasValue(fState) ? stateLabel(fState.value) : fieldStateText(fState.state),
      fScore: readField(f, 'f_score', P('fundamental.f_score')),
      fScoreText: scoreText(readField(f, 'f_score', P('fundamental.f_score'))),
      updatedAt: readField(f, 'updated_at', P('fundamental.updated_at')),
      updatedAtText: dateTimeText(readField(f, 'updated_at', P('fundamental.updated_at')))
    }),

    /** 分层证据（`fundamental.detail.layer_breakdown`） */
    layers: adaptLayers(lb, detail),

    detail: Object.freeze({
      available: !!detail,
      /** ⚠️ 量纲未证实 ⇒ 原值；⛔ 不加 %、⛔ 不解释 */
      finalSignal: detail && detail.final_signal !== undefined ? Number(detail.final_signal) : null,
      finalSignalText: detail && detail.final_signal !== undefined ? String(detail.final_signal) : null,
      signalNote: SIGNAL_NOTE,
      counts: detail ? Object.freeze({
        up: detail.up !== undefined ? Number(detail.up) : null,
        down: detail.down !== undefined ? Number(detail.down) : null,
        positive: detail.positive !== undefined ? Number(detail.positive) : null,
        negative: detail.negative !== undefined ? Number(detail.negative) : null,
        total: detail.total !== undefined ? Number(detail.total) : null
      }) : null
    }),

    riskEvents,
    /** ⛔ 本页不消费的载荷块（诚实登记，⛔ 不是"漏了"） */
    notConsumed: Object.freeze(['基本面分层配置', '基本面序列', '前十大重仓'])
  });
}

function adaptLayers(lb, detail) {
  if (!lb) {
    return Object.freeze({
      available: false,
      items: Object.freeze([]),
      totalLayerWeight: null,
      note: '后端未提供分层明细（该明细字段缺失，⛔ 不推测也不补零）'
    });
  }
  const items = Object.entries(lb).map(([k, v]) => {
    const o = v && typeof v === 'object' ? v : {};
    return Object.freeze({
      key: k,
      label: fundLayerLabel(k),
      count: o.count !== undefined ? Number(o.count) : null,
      signal: o.signal !== undefined ? Number(o.signal) : null,
      signalText: o.signal !== undefined ? String(o.signal) : null,
      weight: o.weight !== undefined ? Number(o.weight) : null,
      weightText: o.weight !== undefined ? String(o.weight) : null,
      signalNote: SIGNAL_NOTE,
      weightNote: WEIGHT_NOTE
    });
  });
  return Object.freeze({
    available: true,
    items: Object.freeze(items),
    totalLayerWeight: detail && detail.total_layer_weight !== undefined ? Number(detail.total_layer_weight) : null,
    note: ''
  });
}

export { rawText, ratioText };
