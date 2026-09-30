/**
 * 后台运行时适配器（web/src/rewrite/adapters/adminRuntime.js）
 * 规范依据：SPEC §5 / §3.2（Gen-2 边界）/ §9
 *
 * 覆盖：Gen-1 Health · Gen-2 Shadow · 数据抓取日志 · 参数 · 操作记录 ·
 *      基本面后台（config/series/holdings）· 风险事件
 *
 * ★ Gen-2 硬边界（SPEC §3.2）：Gen-2 = **Selection / Shadow / Research**，
 *   ⛔ 不得在 adapter/domain 层被包装成 final target authority。
 *   ⇒ 本适配器**只透传** selection / ranking 字段，
 *     ⛔ 不产出任何名为 `final_target` / `target_pct` 的字段。
 */
import { provided, missing, unavailable, readField, readBlock, provenance } from '../domain/provenance.js';
import { FIELD_STATE, MISSING_REASON, AUTHORITY } from '../domain/enums.js';

const P = (src, f) => provenance({ source: 'api:' + src + (f ? '.' + f : ''), authority: AUTHORITY.OPERATOR });

/* ======================= Gen-1 Health ======================= */

export function adaptGen1Health(data) {
  const S = 'admin:/api/admin/gen1/health';
  const empty = !data || typeof data !== 'object';
  return Object.freeze({
    available: !empty,
    modelId: readField(data, 'model_id', P(S, 'model_id')),
    frozen: readField(data, 'frozen', P(S, 'frozen')),
    advisoryEnabled: readField(data, 'advisory_enabled', P(S, 'advisory_enabled')),
    fastPathEnabled: readField(data, 'fast_path_enabled', P(S, 'fast_path_enabled')),
    autoTrading: readField(data, 'auto_trading', P(S, 'auto_trading')),
    today: readField(data, 'today', P(S, 'today')),
    /** ⚠️ `runtime_status_available`（契约测试要求 admin 下发） */
    runtimeStatusAvailable: readField(data, 'runtime_status_available', P(S, 'runtime_status_available')),
    rows: adaptHealthRows(empty ? null : data.rows, S)
  });
}

function adaptHealthRows(list, S) {
  if (!Array.isArray(list)) return missing(MISSING_REASON.FIELD_ABSENT, P(S, 'rows'));
  return provided(Object.freeze(list.filter((r) => r && typeof r === 'object').map((r) => Object.freeze({
    code: readField(r, 'code', P(S, 'rows')),
    name: readField(r, 'name', P(S, 'rows')),
    signalDate: readField(r, 'signal_date', P(S, 'rows')),
    status: readField(r, 'status', P(S, 'rows')),
    fresh: readField(r, 'fresh', P(S, 'rows')),
    probability: readField(r, 'probability', P(S, 'rows')),
    permission: readField(r, 'permission', P(S, 'rows')),
    fastPathCandidate: readField(r, 'fast_path_candidate', P(S, 'rows'))
  }))), P(S, 'rows'));
}

/* ======================= Gen-2 Shadow ======================= */
/**
 * ⚠️ 边界：本函数产出的对象**只含 selection / ranking / 观察字段**。
 *    ⛔ 若将来有人往里加 `finalTarget` / `targetPct` 之类字段，contract test 会失败
 *    （见 web/tests/rewrite/gen2-boundary.test.js）。
 */
export function adaptGen2Shadow(data) {
  const S = 'admin:/api/admin/gen2/shadow';
  const empty = !data || typeof data !== 'object';
  const sel = empty ? null : data.selection;
  return Object.freeze({
    available: !empty && !!sel,
    /** ★ 边界声明（SPEC §3.2）：Selection / Shadow / Research */
    boundary: Object.freeze({
      mode: 'SHADOW',
      label: 'Selection / Shadow / Research',
      hasPositionAuthority: false,
      note: 'Gen-2 不是当前正式交易引擎，不拥有仓位 authority。'
    }),
    selection: Object.freeze({
      runDate: readField(sel, 'run_date', P(S, 'selection.run_date')),
      asOfTradeDate: readField(sel, 'as_of_trade_date', P(S, 'selection.as_of_trade_date')),
      mode: readField(sel, 'mode', P(S, 'selection.mode')),
      selectionConfidence: readField(sel, 'selection_confidence', P(S, 'selection.selection_confidence')),
      confidenceReason: readField(sel, 'confidence_reason', P(S, 'selection.confidence_reason')),
      eligibleCount: readField(sel, 'eligible_count', P(S, 'selection.eligible_count')),
      rankedCount: readField(sel, 'ranked_count', P(S, 'selection.ranked_count')),
      universeCoverage: readField(sel, 'universe_coverage', P(S, 'selection.universe_coverage')),
      roleClassification: readField(sel, 'role_classification', P(S, 'selection.role_classification')),
      status: readField(sel, 'status', P(S, 'selection.status'))
    }),
    rankings: adaptRankings(empty ? null : data.rankings, S)
  });
}

function adaptRankings(list, S) {
  if (!Array.isArray(list)) return missing(MISSING_REASON.FIELD_ABSENT, P(S, 'rankings'));
  return provided(Object.freeze(list.filter((r) => r && typeof r === 'object').map((r) => Object.freeze({
    rank: readField(r, 'rank', P(S, 'rankings')),
    code: readField(r, 'code', P(S, 'rankings')),
    name: readField(r, 'name', P(S, 'rankings')),
    correlationCluster: readField(r, 'correlation_cluster', P(S, 'rankings')),
    alphaScoreV2: readField(r, 'alpha_score_v2', P(S, 'rankings')),
    trendGate: readField(r, 'trend_gate', P(S, 'rankings')),
    regime: readField(r, 'regime', P(S, 'rankings')),
    persistenceDays: readField(r, 'persistence_days', P(S, 'rankings')),
    /** ⚠️ `candidate_weight` 是**候选权重**（观察口径），⛔ 不是生产目标仓位 */
    candidateWeight: readField(r, 'candidate_weight', P(S, 'rankings')),
    defenseState: readField(r, 'defense_state', P(S, 'rankings')),
    /** `CORE` / `CHALLENGER` / `SATELLITE` / `RESERVE` / `HEDGE` */
    role: readField(r, 'role', P(S, 'rankings')),
    reasonCodes: readField(r, 'reason_codes', P(S, 'rankings'))
  }))), P(S, 'rankings'));
}

/* ======================= 数据抓取 ======================= */

export function adaptFetchLog(data) {
  const S = 'admin:/api/admin/fetchlog';
  const list = data && data.list;
  if (!Array.isArray(list)) return Object.freeze({ available: false, list: missing(MISSING_REASON.FIELD_ABSENT, P(S)) });
  return Object.freeze({
    available: true,
    list: provided(Object.freeze(list.filter((l) => l && typeof l === 'object').map((l) => Object.freeze({
      fetchTime: readField(l, 'fetch_time', P(S)),
      source: readField(l, 'source', P(S)),
      status: readField(l, 'status', P(S)),
      itemCount: readField(l, 'item_count', P(S)),
      taskName: readField(l, 'task_name', P(S)),
      durationMs: readField(l, 'duration_ms', P(S)),
      error: readField(l, 'error', P(S))
    }))), P(S))
  });
}

/** 抓取日志状态 → 语义（沿用旧前端 sourceStatus / logStatusLabel 的判定，但归一此处） */
export const FETCH_STATUS = Object.freeze({
  LABELS: Object.freeze({
    success: '成功', running: '运行中', partial: '部分成功',
    fail: '失败', failed: '失败', error: '失败'
  }),
  TONES: Object.freeze({ success: 'good', running: 'warn', partial: 'warn', fail: 'risk', failed: 'risk', error: 'risk' })
});

export function fetchStatusLabel(s) {
  if (!s) return '—';
  return FETCH_STATUS.LABELS[s] || String(s);
}

export function fetchStatusTone(s) {
  return FETCH_STATUS.TONES[s] || 'muted';
}

/* ======================= 参数 ======================= */

export function adaptParams(data) {
  const S = 'admin:/api/admin/param';
  const list = data && data.list;
  if (!Array.isArray(list)) return Object.freeze({ available: false, list: missing(MISSING_REASON.FIELD_ABSENT, P(S)) });
  return Object.freeze({
    available: true,
    list: provided(Object.freeze(list.filter((p) => p && typeof p === 'object').map((p) => Object.freeze({
      key: readField(p, 'key', P(S)),
      description: readField(p, 'description', P(S)),
      category: readField(p, 'category', P(S)),
      /** ⚠️ 后端值为包裹结构 `{v: ...}`；归一在 domain/params.js（避免视图再解包） */
      valueRaw: readField(p, 'value', P(S)),
      prevValueRaw: readField(p, 'prev_value', P(S)),
      version: readField(p, 'version', P(S)),
      frozen: readField(p, 'frozen', P(S))
    }))), P(S))
  });
}

/**
 * 解包参数值。后端 `value` 形如 `{ v: <any> }`。
 * ⛔ 必须在 domain 层解，视图不得再处理 `{v:…}` 结构。
 */
export function unwrapParamValue(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'object' && Object.prototype.hasOwnProperty.call(raw, 'v')) return raw.v;
  return raw;
}

/* ======================= 操作记录 ======================= */

export function adaptTrades(data) {
  const S = 'admin:/api/admin/trade';
  const list = data && data.list;
  if (!Array.isArray(list)) return Object.freeze({ available: false, list: missing(MISSING_REASON.FIELD_ABSENT, P(S)) });
  return Object.freeze({
    available: true,
    list: provided(Object.freeze(list.filter((t) => t && typeof t === 'object').map((t) => Object.freeze({
      id: readField(t, '_id', P(S)),
      tradeDate: readField(t, 'trade_date', P(S)),
      code: readField(t, 'code', P(S)),
      /** `buy` | `sell` */
      action: readField(t, 'action', P(S)),
      shares: readField(t, 'shares', P(S)),
      price: readField(t, 'price', P(S)),
      amount: readField(t, 'amount', P(S)),
      positionAfter: readField(t, 'position_after', P(S)),
      reason: readField(t, 'reason', P(S))
    }))), P(S))
  });
}

export function adaptSnapshotResult(res) {
  const S = 'admin:/api/admin/portfolio/snapshot';
  const empty = !res || typeof res !== 'object';
  return Object.freeze({
    available: !empty,
    snapshotDate: readField(res, 'snapshot_date', P(S)),
    cashBalance: readField(res, 'cash_balance', P(S)),
    /** 由成交写入触发的自动算仓结果（同步提示用） */
    sync: adaptSync(empty ? null : res.sync, S)
  });
}

function adaptSync(sync, S) {
  if (!sync || typeof sync !== 'object') return Object.freeze({ available: false });
  return Object.freeze({
    available: true,
    ok: readField(sync, 'ok', P(S, 'sync')),
    manual: readField(sync, 'manual', P(S, 'sync')),
    position: readField(sync, 'position', P(S, 'sync')),
    shares: readField(sync, 'shares', P(S, 'sync')),
    price: readField(sync, 'price', P(S, 'sync')),
    totalAsset: readField(sync, 'total_asset', P(S, 'sync')),
    error: readField(sync, 'error', P(S, 'sync'))
  });
}

/* ======================= 基本面后台 ======================= */

export function adaptFundamentalConfig(data) {
  const S = 'admin:/api/admin/fundamental/config';
  const configs = data && data.configs;
  if (!Array.isArray(configs)) return Object.freeze({ available: false, configs: missing(MISSING_REASON.FIELD_ABSENT, P(S)) });
  return Object.freeze({
    available: true,
    configs: provided(Object.freeze(configs.filter((c) => c && typeof c === 'object').map((c) => Object.freeze({
      indicator: readField(c, 'indicator', P(S)),
      name: readField(c, 'name', P(S)),
      weight: readField(c, 'weight', P(S)),
      freq: readField(c, 'freq', P(S)),
      source: readField(c, 'source', P(S)),
      unit: readField(c, 'unit', P(S)),
      metricType: readField(c, 'metric_type', P(S))
    }))), P(S))
  });
}

export function adaptFundamentalSeries(data) {
  const S = 'admin:/api/admin/fundamental/series';
  const series = data && data.series;
  if (!Array.isArray(series)) return Object.freeze({ available: false, latest: missing(MISSING_REASON.FIELD_ABSENT, P(S)) });
  return Object.freeze({
    available: true,
    latest: series.length
      ? provided(Object.freeze({
        value: readField(series[0], 'value', P(S)),
        direction: readField(series[0], 'direction', P(S)),
        dataDate: readField(series[0], 'data_date', P(S)),
        note: readField(series[0], 'note', P(S)),
        confidence: readField(series[0], 'confidence', P(S))
      }), P(S))
      : missing(MISSING_REASON.FIELD_ABSENT, P(S)),
    /** 完整序列（供后续趋势图） */
    items: provided(Object.freeze(series.filter((x) => x && typeof x === 'object')), P(S))
  });
}

export function adaptHoldings(data) {
  const S = 'admin:/api/admin/fundamental/holdings';
  const list = data && data.holdings;
  if (!Array.isArray(list)) return Object.freeze({ available: false, holdings: missing(MISSING_REASON.FIELD_ABSENT, P(S)) });
  return Object.freeze({
    available: true,
    reportDate: readField(data, 'report_date', P(S)),
    holdings: provided(Object.freeze(list.filter((h) => h && typeof h === 'object').map((h) => Object.freeze({
      rank: readField(h, 'rank', P(S)),
      stockCode: readField(h, 'stock_code', P(S)),
      stockName: readField(h, 'stock_name', P(S)),
      weight: readField(h, 'weight', P(S)),
      market: readField(h, 'market', P(S))
    }))), P(S))
  });
}

/* ======================= 风险事件 ======================= */

export function adaptRiskEvents(data) {
  const S = 'admin:/api/admin/risk/list';
  const list = data && data.list;
  if (!Array.isArray(list)) return Object.freeze({ available: false, list: missing(MISSING_REASON.FIELD_ABSENT, P(S)) });
  return Object.freeze({
    available: true,
    list: provided(Object.freeze(list.filter((e) => e && typeof e === 'object').map((e) => Object.freeze({
      id: readField(e, '_id', P(S)),
      code: readField(e, 'code', P(S)),
      eventType: readField(e, 'event_type', P(S)),
      riskFlag: readField(e, 'risk_flag', P(S)),
      riskOverride: readField(e, 'risk_override', P(S)),
      status: readField(e, 'status', P(S)),
      reason: readField(e, 'reason', P(S)),
      note: readField(e, 'note', P(S)),
      triggerTime: readField(e, 'trigger_time', P(S))
    }))), P(S)),
    hasActiveOverride: provided(
      list.some((e) => e && e.status === 'active' && e.risk_override === true),
      P(S)
    )
  });
}

export const RISK_EVENT_TYPES = Object.freeze([
  { key: 'falsify', label: '证伪' }, { key: 'policy', label: '政策' },
  { key: 'tech', label: '技术路线' }, { key: 'demand', label: '需求' },
  { key: 'structure', label: '结构' }, { key: 'other', label: '其他' }
]);

export { FIELD_STATE, readBlock };
