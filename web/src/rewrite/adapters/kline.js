/**
 * K 线适配器（web/src/rewrite/adapters/kline.js）
 * 规范依据：SPEC §2 / §4.2 标的（K 线 / 量价证据区）/ 附录 A
 *
 * 单位（SPEC 附录 A.2）：价格 = 元；`volume` = **份**；`amount` = **元**。
 * ⛔ 不在这里做任何补点 / 插值 / 缺失填充。
 */
import { provided, missing, provenance } from '../domain/provenance.js';
import { FIELD_STATE, MISSING_REASON, AUTHORITY } from '../domain/enums.js';

const P_BAR = provenance({ source: 'api:/api/etf/:code/kline', authority: AUTHORITY.SAFETY_CORE });

export function adaptKline(rows) {
  if (!Array.isArray(rows)) return missing(MISSING_REASON.FIELD_ABSENT, P_BAR);
  const bars = rows
    .filter((r) => r && typeof r === 'object' && r.date != null)
    .map((r) => Object.freeze({
      date: r.date,
      open: num(r.open),
      close: num(r.close),
      low: num(r.low),
      high: num(r.high),
      volume: num(r.volume),
      amount: num(r.amount)
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return provided(Object.freeze(bars), P_BAR);
}

function num(v) {
  return v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v);
}

/** 简单移动均线（纯展示用；⛔ 不参与任何决策语义） */
export function movingAverage(bars, n) {
  const out = new Array(bars.length).fill(null);
  if (!Array.isArray(bars) || n <= 0) return out;
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i].close == null ? 0 : bars[i].close;
    if (i >= n) sum -= bars[i - n].close == null ? 0 : bars[i - n].close;
    if (i >= n - 1) out[i] = +(sum / n).toFixed(3);
  }
  return out;
}

export { FIELD_STATE };
