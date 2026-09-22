/**
 * V3.6.4 Safety Hardening —— Gate C：Swing Parity 扫描器
 *
 * 背景：受 Gen-1 pipeline lock 保护，`trend-stage.js` 里的 `swingHighLow`（旧实现）
 * **不能删除**；`swing-structure.js`（新实现）又必须存在（R1 的 SlowBreak 修复依赖它）。
 * ⇒ 允许两份实现并存，但必须建立**永久 parity gate**：共享字段不得漂移。
 *
 * 共享字段（必须 100% 一致）：
 *   - `higherLow`
 *   - `lowerHigh`
 *
 * 非共享字段（新实现额外提供，旧实现没有，**不参与** parity）：
 *   - `higherHigh` / `lowerLow` / `computable` / `priorHigh` / `priorLow` / `recentHigh` / `recentLow` / `sample` / `window`
 *
 * 扫描口径：对每一条 K 线序列，取**每一个长度为 12 的 rolling window**（`bars.slice(i, i+12)`），
 * 分别喂给两份实现并比对。
 *
 * 数据源：
 *   1. 真实历史：`deliverables/etf_daily_ml_pool/<code>_qfq.csv`（5 只生产 ETF）
 *      ⚠️ `deliverables/` 已 gitignore ⇒ CI 上不存在，此时该源记为 unavailable（不伪造）
 *   2. 确定性合成语料：始终存在，保证 CI 也是一个真实门禁（含边界/退化/随机长序列）
 *
 * ⚠️ 本模块**只读**，不改任何生产参数、不修改受锁文件。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const OLD = require(path.join(REPO, 'src/common/utils/trend-stage.js'));
const NEW = require(path.join(REPO, 'src/common/utils/swing-structure.js'));

const UNIVERSE = ['513310', '515880', '159582', '518880', '159570'];
const CSV_DIR = path.join(REPO, 'deliverables/etf_daily_ml_pool');
const WINDOW = 12;                 // 两份实现都要求 bars.length >= 12
const SHARED_FIELDS = ['higherLow', 'lowerHigh'];

/* ---------------- 确定性 PRNG（可复现，不用 Math.random） ---------------- */
function mulberry32(a) {
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function loadRealSeries() {
  const out = {};
  const unavailable = [];
  UNIVERSE.forEach((code) => {
    const f = path.join(CSV_DIR, `${code}_qfq.csv`);
    if (!fs.existsSync(f)) { unavailable.push(code); return; }
    const bars = fs.readFileSync(f, 'utf8').trim().split(/\r?\n/).map((line) => {
      const p = line.split(',');
      return {
        trade_date: p[0], open: Number(p[1]), high: Number(p[2]),
        low: Number(p[3]), close: Number(p[4]), volume: Number(p[5])
      };
    }).filter((b) => b.trade_date && Number.isFinite(b.high) && Number.isFinite(b.low));
    if (bars.length >= WINDOW) out[code] = bars;
    else unavailable.push(code);
  });
  return { series: out, unavailable };
}

/**
 * 确定性合成语料。覆盖：
 *   - 单调上涨（应 HH+HL，无 LH/LL）
 *   - 单调下跌（应 LH+LL，无 HH/HL）
 *   - 水平（三项比较全 false）
 *   - 严格相等的高/低（tie → 两项皆 false）
 *   - 随机游走（多种长度）
 *   - 含 null 的残缺序列
 *   - 长度 < 12 的退化序列（不应崩溃）
 */
function buildSyntheticSeries() {
  const out = [];
  const push = (name, bars) => out.push({ name, bars });

  [13, 20, 37, 61, 120].forEach((n) => {
    push(`up_${n}`, Array.from({ length: n }, (_, i) => ({ high: 100 + i * 2, low: 90 + i * 2, close: 95 + i * 2 })));
    push(`down_${n}`, Array.from({ length: n }, (_, i) => ({ high: 200 - i * 2, low: 190 - i * 2, close: 195 - i * 2 })));
    push(`flat_${n}`, Array.from({ length: n }, () => ({ high: 100, low: 90, close: 95 })));
  });

  // tie：近 5 根与前 5 根完全相等 → higherHigh/higherLow/lowerHigh/lowerLow 全 false
  push('tie_last10_equal', Array.from({ length: 14 }, (_, i) => (
    i < 4 ? { high: 1, low: 1, close: 1 } : { high: 100, low: 90, close: 95 }
  )));
  // 高点相等、低点下降 → lowerLow=true，其余 false
  push('tie_high_lower_low', [
    ...Array.from({ length: 5 }, () => ({ high: 50, low: 50, close: 50 })),
    ...Array.from({ length: 2 }, () => ({ high: 1, low: 1, close: 1 })),
    ...Array.from({ length: 5 }, () => ({ high: 100, low: 88, close: 90 })),
    ...Array.from({ length: 2 }, () => ({ high: 1, low: 1, close: 1 }))
  ].slice(0, 14));
  // 刚好 12 根（最小可计算长度）
  push('exactly_12', Array.from({ length: 12 }, (_, i) => ({ high: 100 + i, low: 90 - i, close: 95 })));
  // 退化：< 12 根 / 空 / null high-low
  push('len_11', Array.from({ length: 11 }, (_, i) => ({ high: 100 + i, low: 90 - i, close: 95 })));
  push('empty', []);
  push('null_highs', Array.from({ length: 14 }, (_, i) => ({ high: i % 3 === 0 ? null : 100 + i, low: 90 - i, close: 95 })));
  push('null_lows', Array.from({ length: 14 }, (_, i) => ({ high: 100 + i, low: i % 4 === 0 ? null : 90 - i, close: 95 })));

  // 随机游走（确定性种子）
  [12, 13, 25, 40, 80, 150].forEach((n, si) => {
    const rnd = mulberry32(0x9E3779B9 + si * 7919);
    let level = 100;
    const bars = [];
    for (let i = 0; i < n; i += 1) {
      const g = (rnd() - 0.48) * 4;
      level = Math.max(1, level * (1 + g / 100));
      const h = level * (1 + rnd() * 0.02);
      const l = level * (1 - rnd() * 0.02);
      bars.push({ high: Math.round(h * 1000) / 1000, low: Math.round(l * 1000) / 1000, close: Math.round(level * 1000) / 1000 });
    }
    push(`random_${n}_${si}`, bars);
  });

  // 离散量（大量 tie，专门压 tie 语义）
  const rnd2 = mulberry32(20260922);
  [24, 60].forEach((n) => {
    push(`discrete_${n}`, Array.from({ length: n }, () => {
      const v = 90 + Math.floor(rnd2() * 5) * 2;
      return { high: v + 2, low: v - 2, close: v };
    }));
  });

  return out;
}

/** 对一条序列枚举所有长度 12 的窗口 */
function windowsOf(bars) {
  const out = [];
  if (!Array.isArray(bars)) return out;
  for (let i = 0; i + WINDOW <= bars.length; i += 1) out.push(bars.slice(i, i + WINDOW));
  return out;
}

function compareOne(win) {
  const o = OLD.swingHighLow(win);
  const n = NEW.swingHighLow(win);
  const diffs = [];
  SHARED_FIELDS.forEach((f) => {
    const ov = o ? o[f] : undefined;
    const nv = n ? n[f] : undefined;
    if (ov !== nv) diffs.push({ field: f, old: ov, new: nv });
  });
  return { old: o, neu: n, diffs };
}

/**
 * @param {object} [opts] { includeReal: boolean }
 * @returns {{total_windows:number, mismatch_count:number, mismatch_examples:Array,
 *            sources:object, shared_fields:string[], non_shared_fields:string[]}}
 */
function scanParity(opts) {
  const includeReal = !opts || opts.includeReal !== false;
  let totalWindows = 0;
  const mismatches = [];
  const sources = {};

  function scanSeries(tag, bars) {
    const wins = windowsOf(bars);
    let local = 0;
    wins.forEach((w, idx) => {
      totalWindows += 1;
      const { diffs } = compareOne(w);
      if (diffs.length) {
        local += 1;
        if (mismatches.length < 20) {
          mismatches.push({ source: tag, window_index: idx, bars: w, diffs });
        }
      }
    });
    return { windows: wins.length, mismatches: local };
  }

  /* 1) 真实历史 */
  const real = includeReal ? loadRealSeries() : { series: {}, unavailable: UNIVERSE };
  const realStats = {};
  Object.keys(real.series).forEach((code) => {
    realStats[code] = scanSeries(`real:${code}`, real.series[code]);
  });
  sources.real_history = {
    available: Object.keys(real.series).length > 0,
    unavailable_codes: real.unavailable,
    note: real.unavailable.length
      ? 'deliverables/ 已 gitignore ⇒ 在 CI 上不可用；该源此时记为 unavailable（不伪造）'
      : null,
    per_code: realStats,
    windows: Object.values(realStats).reduce((s, v) => s + v.windows, 0)
  };

  /* 2) 确定性合成语料（CI 上始终可用） */
  const synth = buildSyntheticSeries();
  const synthStats = {};
  synth.forEach((s) => {
    synthStats[s.name] = scanSeries(`synthetic:${s.name}`, s.bars);
  });
  sources.synthetic_corpus = {
    available: true,
    series_count: synth.length,
    windows: Object.values(synthStats).reduce((s, v) => s + v.windows, 0),
    per_series: synthStats
  };

  /* 3) 退化输入不崩溃 + 非共享字段确实存在（说明两份实现确实不是同一个） */
  const degenerate = [];
  [[], null, undefined, [{ high: 1, low: 1 }], Array.from({ length: 11 }, (_, i) => ({ high: i, low: i }))]
    .forEach((bad, i) => {
      let ok = true;
      let err = null;
      try { OLD.swingHighLow(bad); NEW.swingHighLow(bad); } catch (e) { ok = false; err = String(e.message || e); }
      degenerate.push({ case_index: i, no_throw: ok, error: err });
    });
  sources.degenerate_inputs = degenerate;

  const nonShared = [...new Set(Object.keys(NEW.swingHighLow(
    Array.from({ length: 12 }, (_, i) => ({ high: 100 + i, low: 90 - i }))
  ) || {}))].filter((k) => SHARED_FIELDS.indexOf(k) < 0);

  return {
    generated_at: new Date().toISOString(),
    shared_fields: SHARED_FIELDS,
    non_shared_fields: nonShared,
    total_windows: totalWindows,
    mismatch_count: mismatches.length,
    mismatch_examples: mismatches,
    sources
  };
}

module.exports = {
  WINDOW,
  SHARED_FIELDS,
  UNIVERSE,
  windowsOf,
  compareOne,
  buildSyntheticSeries,
  loadRealSeries,
  scanParity
};
