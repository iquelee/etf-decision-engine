/**
 * 组合环境适配器（web/src/rewrite/adapters/marketRegime.js）
 * 规范依据：owner 裁定 M5-P1 第五阶段（D-M5-3，2026-10-01）
 *
 * ══════════════════════════════════════════════════════════════════════
 * ★★ 本模块存在的**唯一前提**：契约已证实（2026-10-01 只读核对）
 *   · `src/common/schema.js:240`
 *       market_regime: { desc: '组合环境 aggressive/structural/range/defensive/crisis' }
 *   · `cloudfunctions/apiGateway/index.js:465`
 *       dashboard 的 `overview.market_regime` ← 组合快照（run_candidate_portfolio）
 *   ⇒ 字段名、枚举域、数据来源三者一致 ⇒ 属**可证明的正式 contract**。
 *
 * ⛔ 明文禁止（owner D-M5-3）：
 *   · ⛔ **不得**发现别的 endpoint 有"像市场环境"的字段（如 `snapshot.trend_context` /
 *     `decision.effective_market_regime`）就猜它就是 market_regime —— 
 *     本模块**只读** `data.overview.market_regime` 一个路径；
 *   · ⛔ 不得推导、不得本地映射成自定义档位（文案复用 `labels.regimeLabel`，全站唯一来源）；
 *   · 取不到 ⇒ **NOT_PROVIDED**，⛔ 不得显示成"正常"或留空。
 *
 * ★ 三个输入状态**语义不同**（与 kline / decisions 同构，⛔ 不合并）：
 *   `undefined` ⇒ 未请求（UNAVAILABLE）
 *   `null`      ⇒ 请求失败（ERROR）
 *   `{}`/无字段 ⇒ 契约字段缺失（MISSING）
 */
import { unavailable, readField, provenance, hasValue } from '../domain/provenance.js';
import { FIELD_STATE, MISSING_REASON, AUTHORITY } from '../domain/enums.js';
import { assess, describe } from '../domain/freshness.js';
import { dateText } from '../domain/display.js';
import {
  regimeLabel, toneForRegime,
  MARKET_REGIME_TITLE, MARKET_REGIME_SOURCE_NOTE,
  MARKET_REGIME_UNAVAILABLE, MARKET_REGIME_UNAVAILABLE_NOTE
} from '../domain/labels.js';

const SRC = 'api:/api/dashboard#overview.market_regime';
const P0 = provenance({ source: SRC, authority: AUTHORITY.OPERATOR });

/**
 * 空壳（三个状态共用同一形状，⛔ 不返回 `undefined`，避免下游读到 undefined）
 * @param {string} state `FIELD_STATE.*`
 * @param {string} reason `MISSING_REASON.*`
 * @param {string} note 面向用户的说明
 */
function shell(state, reason, note) {
  return Object.freeze({
    title: MARKET_REGIME_TITLE,
    available: false,
    state,
    missingReason: reason,
    regime: unavailable(reason, P0),
    regimeText: MARKET_REGIME_UNAVAILABLE,
    regimeTone: 'muted',
    /** 原始枚举（供审计/测试；⛔ UI 不直接渲染英文枚举） */
    regimeRaw: null,
    asOfText: '—',
    freshness: Object.freeze({ level: 'MISSING', text: '无时间戳', ageHours: null }),
    sourceNote: MARKET_REGIME_SOURCE_NOTE,
    unavailableNote: note || MARKET_REGIME_UNAVAILABLE_NOTE,
    provenance: P0
  });
}

/**
 * @param {object|undefined|null} dashboardRaw `/api/dashboard` 的 `data`
 * @returns {object} 组合环境展示对象
 */
export function adaptMarketRegime(dashboardRaw) {
  if (dashboardRaw === undefined) {
    return shell(FIELD_STATE.UNAVAILABLE, MISSING_REASON.CONTRACT_NOT_PROVIDED);
  }
  if (dashboardRaw === null || typeof dashboardRaw !== 'object' || Array.isArray(dashboardRaw)) {
    return shell(FIELD_STATE.ERROR, MISSING_REASON.CONTRACT_NOT_PROVIDED,
      '组合环境读取失败（请求未成功）⇒ 本页不猜测市场状态。');
  }

  const overview = dashboardRaw.overview && typeof dashboardRaw.overview === 'object'
    ? dashboardRaw.overview
    : null;

  if (!overview) {
    return shell(FIELD_STATE.MISSING, MISSING_REASON.FIELD_ABSENT,
      '后端响应中没有 `overview` 块 ⇒ 组合环境字段缺失（NOT_PROVIDED）。');
  }

  const regime = readField(overview, 'market_regime', P0);
  const asOf = readField(overview, 'snapshot_date', provenance({
    source: 'api:/api/dashboard#overview.snapshot_date', authority: AUTHORITY.OPERATOR
  }));
  const fresh = assess(hasValue(asOf) ? asOf.value : null, 'snapshot');

  if (!hasValue(regime)) {
    return Object.freeze({
      ...shell(
        regime.state === FIELD_STATE.UNAVAILABLE ? FIELD_STATE.UNAVAILABLE : FIELD_STATE.MISSING,
        regime.missingReason || MISSING_REASON.FIELD_ABSENT
      ),
      asOfText: dateText(asOf).text,
      freshness: Object.freeze({ ...fresh, text: describe(fresh) })
    });
  }

  return Object.freeze({
    title: MARKET_REGIME_TITLE,
    available: true,
    state: FIELD_STATE.PROVIDED,
    missingReason: null,
    regime,
    /** ★ 文案复用全站唯一来源 `labels.regimeLabel()`（⛔ 不在此处另建映射） */
    regimeText: regimeLabel(regime.value),
    regimeTone: toneForRegime(regime.value),
    regimeRaw: String(regime.value),
    asOfText: dateText(asOf).text,
    freshness: Object.freeze({ ...fresh, text: describe(fresh) }),
    sourceNote: MARKET_REGIME_SOURCE_NOTE,
    unavailableNote: '',
    provenance: regime.provenance
  });
}
