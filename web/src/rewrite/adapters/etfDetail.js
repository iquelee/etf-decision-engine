/**
 * ETF 详情适配器（web/src/rewrite/adapters/etfDetail.js）
 * 规范依据：SPEC §2 / §4.2 / §9 / 附录 A
 *
 * 职责：`GET /api/etf/:code` 原始响应 → ETF 详情领域对象。
 *
 * ★ 关键区分（SPEC 附录 A.4「同名字段不同义」）：
 *   · `decision.target_min/std/max` = **本次决策的最终目标带**（经约束后）
 *   · `position.target_min/std/max` = **配置的标准目标带**（来自 etf_basic）
 *   ⇒ 两者 ⛔ 不可合并、⛔ 不可互相顶替。
 *
 * ★ 单位：本响应内 `*_position` / `target_*` / `premium_rate` / `change_5d` 等均为**仓位或涨跌百分比**；
 *   `price_position` 为 **0~1 比例**（SPEC 附录 A.2）。
 */
import {
  provided, missing, unavailable, readField, readBlock, provenance, hasValue
} from '../domain/provenance.js';
import { FIELD_STATE, MISSING_REASON, AUTHORITY } from '../domain/enums.js';
import { adaptDecision } from './decision.js';
import { adaptGen1, legacyFallback } from './gen1.js';
import { assess } from '../domain/freshness.js';

const SRC = 'api:/api/etf/:code';
const P = (f) => provenance({ source: SRC + (f ? '.' + f : ''), authority: AUTHORITY.SAFETY_CORE });
const P_OPS = (f) => provenance({ source: SRC + (f ? '.' + f : ''), authority: AUTHORITY.OPERATOR });

/**
 * @param {object|null} data `/api/etf/:code` 的 data
 * @param {object|null} runtimeStatus `/api/constants` 的 runtime_status（可选）
 */
export function adaptEtfDetail(data, runtimeStatus = null) {
  const empty = !data || typeof data !== 'object';
  const basic = empty ? null : data.basic;
  const snapshot = empty ? null : data.snapshot;
  const position = empty ? null : data.position;

  return Object.freeze({
    available: !empty,

    basic: Object.freeze({
      code: readField(basic, 'code', P_OPS('basic.code')),
      name: readField(basic, 'name', P_OPS('basic.name')),
      sector: readField(basic, 'sector', P_OPS('basic.sector')),
      isQdii: readField(basic, 'is_qdii', P_OPS('basic.is_qdii')),
      status: readField(basic, 'status', P_OPS('basic.status')),
      maxPosition: readField(basic, 'max_position', P_OPS('basic.max_position')),
      targetPosition: readField(basic, 'target_position', P_OPS('basic.target_position'))
    }),

    snapshot: adaptSnapshot(snapshot),

    decision: adaptDecision(data && data.decision),

    /** ★ 配置的标准目标带（⛔ 与 decision.targetBand 不同义） */
    position: adaptPosition(position),

    riskEvents: adaptRiskEvents(empty ? null : data.risk_events),

    gen1: adaptGen1(data),
    legacyFallback: legacyFallback(data, runtimeStatus),

    /** 基本面摘要（旧前端**未使用**的载荷，本轮启用；SPEC §11.3） */
    fundamentalBrief: adaptFundamentalBrief(empty ? null : data.fundamental),

    holdings: adaptHoldings(empty ? null : data.holdings, empty ? null : data.holdings_date),

    freshness: Object.freeze({
      decision: assess(snapshot && snapshot.calc_date, 'snapshot'),
      quote: assess(snapshot && snapshot.calc_date, 'snapshot')
    })
  });
}

/* ---------------- snapshot ---------------- */

function adaptSnapshot(s) {
  const empty = !s || typeof s !== 'object';
  if (empty) {
    return Object.freeze({ available: false });
  }
  return Object.freeze({
    available: true,
    calcDate: readField(s, 'calc_date', P('snapshot.calc_date')),
    states: Object.freeze({
      w: readField(s, 'w_state', P('snapshot.w_state')),
      d: readField(s, 'd_state', P('snapshot.d_state')),
      h: readField(s, 'h_state', P('snapshot.h_state')),
      v: readField(s, 'v_state', P('snapshot.v_state'))
    }),
    /** 横盘四重确认 */
    consolidation: Object.freeze({
      trendContext: readField(s, 'trend_context', P('snapshot.trend_context')),
      sidewayDays: readField(s, 'sideway_days', P('snapshot.sideway_days')),
      sidewayRange: readField(s, 'sideway_range', P('snapshot.sideway_range')),
      ma20Slope: readField(s, 'ma20_slope', P('snapshot.ma20_slope')),
      score: readField(s, 'consolidation_score', P('snapshot.consolidation_score'))
    }),
    /** 量价结构 */
    volume: Object.freeze({
      ratio: readField(s, 'volume_ratio', P('snapshot.volume_ratio')),
      slope: readField(s, 'volume_slope', P('snapshot.volume_slope')),
      highVolumeStagnation: readField(s, 'high_volume_stagnation', P('snapshot.high_volume_stagnation')),
      highVolumeDecline: readField(s, 'high_volume_decline', P('snapshot.high_volume_decline'))
    }),
    /** ★ `price_position` 是 **0~1 比例**（SPEC 附录 A.2） */
    pricePosition: readField(s, 'price_position', P('snapshot.price_position')),
    premiumRate: readField(s, 'premium_rate', P('snapshot.premium_rate')),
    change5d: readField(s, 'change_5d', P('snapshot.change_5d')),
    bias20d: readField(s, 'bias_20d', P('snapshot.bias_20d')),
    dataComplete: readField(s, 'data_complete', P('snapshot.data_complete')),
    /** 均线族（后续 Structure 页需要） */
    ma: Object.freeze({
      ma5: readField(s, 'ma5', P('snapshot.ma5')),
      ma10: readField(s, 'ma10', P('snapshot.ma10')),
      ma20: readField(s, 'ma20', P('snapshot.ma20')),
      ma60: readField(s, 'ma60', P('snapshot.ma60')),
      ma120: readField(s, 'ma120', P('snapshot.ma120')),
      ma250: readField(s, 'ma250', P('snapshot.ma250'))
    })
  });
}

/* ---------------- position ---------------- */

function adaptPosition(p) {
  const empty = !p || typeof p !== 'object';
  if (empty) {
    return Object.freeze({
      available: false,
      currentPosition: unavailable(MISSING_REASON.CONTRACT_NOT_PROVIDED, P('position')),
      band: Object.freeze({ min: unavailable(MISSING_REASON.CONTRACT_NOT_PROVIDED, P('position')), std: unavailable(MISSING_REASON.CONTRACT_NOT_PROVIDED, P('position')), max: unavailable(MISSING_REASON.CONTRACT_NOT_PROVIDED, P('position')) })
    });
  }
  return Object.freeze({
    available: true,
    currentPosition: readField(p, 'current_position', P('position.current_position')),
    /** 配置的标准目标带（≠ decision.targetBand） */
    band: Object.freeze({
      min: readField(p, 'target_min', P('position.target_min')),
      std: readField(p, 'target_std', P('position.target_std')),
      max: readField(p, 'target_max', P('position.target_max'))
    }),
    maxPosition: readField(p, 'max_position', P('position.max_position')),
    maxStrategicPosition: readField(p, 'max_strategic_position', P('position.max_strategic_position')),
    corePosition: readField(p, 'core_position', P('position.core_position')),
    tradePosition: readField(p, 'trade_position', P('position.trade_position')),
    shares: readField(p, 'shares', P('position.shares')),
    avgCost: readField(p, 'avg_cost', P('position.avg_cost')),
    updatedAt: readField(p, 'updated_at', P('position.updated_at')),
    grade: Object.freeze({
      coreRatioGrade: readField(p, 'core_ratio_grade', P('position.core_ratio_grade')),
      tradeRatioGrade: readField(p, 'trade_ratio_grade', P('position.trade_ratio_grade'))
    })
  });
}

/* ---------------- risk_events ---------------- */

function adaptRiskEvents(list) {
  const P0 = P('risk_events');
  if (!Array.isArray(list)) return missing(MISSING_REASON.FIELD_ABSENT, P0);
  const items = list
    .filter((e) => e && typeof e === 'object')
    .map((e) => Object.freeze({
      id: readField(e, '_id', P0),
      code: readField(e, 'code', P0),
      eventType: readField(e, 'event_type', P0),
      riskFlag: readField(e, 'risk_flag', P0),
      riskOverride: readField(e, 'risk_override', P0),
      status: readField(e, 'status', P0),
      reason: readField(e, 'reason', P0),
      note: readField(e, 'note', P0),
      triggerTime: readField(e, 'trigger_time', P0)
    }));
  return provided(items, P0);
}

/* ---------------- 基本面摘要 ---------------- */

function adaptFundamentalBrief(f) {
  const P0 = P('fundamental');
  if (!f || typeof f !== 'object') {
    return Object.freeze({ available: false, fState: unavailable(MISSING_REASON.CONTRACT_NOT_PROVIDED, P0) });
  }
  return Object.freeze({
    available: true,
    fState: readField(f, 'f_state', P0),
    fScore: readField(f, 'f_score', P0),
    updatedAt: readField(f, 'updated_at', P0)
  });
}

/* ---------------- 前十大重仓（旧前端仅在后台录入页使用） ---------------- */

function adaptHoldings(list, date) {
  const P0 = P('holdings');
  if (!Array.isArray(list)) return Object.freeze({ available: false, reportDate: readField({ report_date: date }, 'report_date', P0) });
  return Object.freeze({
    available: true,
    reportDate: readField({ report_date: date }, 'report_date', P0),
    items: list.filter((h) => h && typeof h === 'object').map((h) => Object.freeze({
      rank: readField(h, 'rank', P0),
      stockCode: readField(h, 'stock_code', P0),
      stockName: readField(h, 'stock_name', P0),
      weight: readField(h, 'weight', P0),
      market: readField(h, 'market', P0)
    }))
  });
}

export { hasValue, readBlock, FIELD_STATE };
