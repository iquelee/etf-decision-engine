/**
 * WP-G1-DATA-02 测试 —— Gate G1-U：Daily Data Finality & Lane Execution。
 *
 * 复审判定：「ready lane 不得重复抓 + 盘中 bar 不得当定稿」是执行层必须硬钉的两点。
 *
 *   U1  Main5 已定稿 + Benchmark 缺失 → datasource 对 Main5 调用次数 = 0
 *   U2  Benchmark 已定稿 + Main5 缺失 → datasource 对 510300 调用次数 = 0
 *   U3  盘中数据源返回 today bar → today **不落库**（历史照常回补）
 *   U4  收盘后同一 bar → today 落库且带 `is_final: true`
 *   U5  盘中 `force` → 历史 backfill 正常、today 被排除
 *   U6  盘中误写入的 today bar（无 is_final）→ **不得视为 FINALIZED**，收盘后会被覆盖
 *
 * 另：`isStructurallyValidDailyBar` / `isFinalizedDailyBar` / `isBarWritable` 的边界单测，
 * 以及「字段完整 ≠ 已收盘定稿」这条语义断言。
 *
 * 运行：node tests/gen1-daily-finality.test.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SRC_COMMON = path.join(ROOT, 'src', 'common');
const FN_PATH = path.join(ROOT, 'cloudfunctions', 'fetchDailyData', 'index.js');

const { COLLECTIONS, GEN1_BENCHMARK_CODE } = require(path.join(SRC_COMMON, 'constants.js'));
const {
  DAILY_BAR_FINALIZATION_CUTOFF, isStructurallyValidDailyBar, isFinalizedDailyBar,
  isBarWritable, cutoffMinutes
} = require(path.join(SRC_COMMON, 'utils', 'fetch-guard.js'));
const { planDailyFetch } = require(path.join(SRC_COMMON, 'utils', 'daily-fetch-plan.js'));

const TODAY = '2026-09-10';
const YESTERDAY = '2026-09-09';
const MAIN5 = ['513310', '515880', '159582', '159570', '518880'];
const BENCH = GEN1_BENCHMARK_CODE;

/** 北京 HH:MM → 冻结的「现在」（ms，UTC = 北京 - 8h）。 */
function beijing(HHMM) {
  const [h, m] = HHMM.split(':').map(Number);
  return Date.parse(`${TODAY}T00:00:00Z`) + (h - 8) * 3600000 + m * 60000;
}

function finalizedRow(code, date) {
  return { code, trade_date: date, open: 1, high: 1, low: 1, close: 1, volume: 100, source: 'tencent', is_final: true };
}
function poisonedRow(code, date) {
  return { code, trade_date: date, open: 1, high: 1, low: 1, close: 1, volume: 999, source: 'tencent' };
}

/** n 根日线；includeToday=true 时最后一根为「今天」（盘中未定稿形态）。 */
function makeBars(code, n, includeToday) {
  const bars = [];
  const last = includeToday ? TODAY : YESTERDAY;
  const end = Date.parse(last + 'T00:00:00Z');
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(end - i * 86400000).toISOString().slice(0, 10);
    bars.push({ trade_date: d, open: 1, high: 1, low: 1, close: 1, volume: 100, amount: 1, source: 'tencent' });
  }
  return bars.map((b) => Object.assign({}, b, { code }));
}

function load(opt) {
  const o = opt || {};
  const failCodes = o.failCodes || [];
  const etfCodes = o.etfs || MAIN5.slice();
  const includeToday = o.includeToday === true;
  const upserts = [];
  const fetchCalls = [];

  const db = {
    upserts,
    query: async (name, where, options) => {
      if (name !== COLLECTIONS.ETF_DAILY) return [];
      let list = (o.rows || []).filter((r) => Object.keys(where || {}).every((k) => r[k] === where[k]));
      if (options && options.limit) list = list.slice(0, options.limit);
      return list.map((r) => Object.assign({}, r));
    },
    upsert: async (name, doc, key) => { upserts.push({ name, doc: Object.assign({}, doc), key }); return { created: true }; },
    updateById: async () => ({}),
    getCollection: () => ({ add: async () => ({}) }),
    getEtfList: async () => etfCodes.map((code, i) => ({ code, sort_order: i }))
  };

  const datasource = {
    calls: fetchCalls,
    isTradingDay: () => true,
    fetchDaily: async (code, limit) => {
      fetchCalls.push({ code, limit });
      if (failCodes.indexOf(code) >= 0) throw new Error(`mock fetch fail ${code}`);
      return { bars: makeBars(code, limit || 260, includeToday), source: 'tencent' };
    },
    fetchPremiumIopv: async () => null,
    fetchFredSeries: async () => [],
    fetchDollarIndex: async () => null,
    fetchStoragePrice: async () => null,
    fetchGoldEtfHolding: async () => null,
    fetchIndexWeekly: async () => [],
    fetchGlobalDaily: async () => []
  };

  const FIXED = o.now != null ? o.now : beijing('16:00');
  class FakeDate extends Date {
    constructor(...args) { if (args.length === 0) super(FIXED); else super(...args); }
    static now() { return FIXED; }
  }

  const box = {
    exports: {},
    console: { log() {}, warn() {}, error() {} },
    process: { env: {} },
    Date: FakeDate,
    require: (p) => {
      if (p === './common/utils/db') return db;
      if (p === './common/utils/datasource') return datasource;
      if (p === '@cloudbase/node-sdk') {
        return {
          init: () => ({ callFunction: async () => ({ ok: true }), database: () => ({ collection: () => ({}) }) }),
          SYMBOL_CURRENT_ENV: 'test-env'
        };
      }
      if (p.startsWith('./common/')) return require(path.join(SRC_COMMON, p.replace(/^\.\/common\//, '')));
      return require(path.join(path.dirname(FN_PATH), p));
    }
  };
  vm.runInNewContext(fs.readFileSync(FN_PATH, 'utf8'), box);
  return { mod: box.exports, db, datasource, fixed: FIXED };
}

/**
 * 冻结时钟执行 main()：fetch-guard 是在**外层 realm** 被 require 的真实模块，
 * 它调用 `Date.now()`；只往 vm 里注入 FakeDate 是**罩不住它**的。
 * 这里在执行期间统一覆写全局 Date.now，两个 realm 都拿到同一个冻结时刻。
 * 同时让测试与「CI 在任意日期/任意时刻运行」解耦。
 */
async function runMain(h, event) {
  const orig = Date.now;
  Date.now = () => h.fixed;
  try { return await h.mod.main(event || {}); } finally { Date.now = orig; }
}


/** 本轮实际落库的 trade_date 集合（某个 code）。 */
function writtenDates(db, code) {
  const set = new Set();
  for (const u of db.upserts) {
    if (u.name !== COLLECTIONS.ETF_DAILY) continue;
    if (String(u.doc.code) !== String(code)) continue;
    set.add(String(u.doc.trade_date).slice(0, 10));
  }
  return set;
}

function calledCodes(ds) {
  return Array.from(new Set(ds.calls.map((c) => c.code)));
}

async function main() {
  /* ---------------- 纯函数：字段完整 ≠ 已收盘定稿 ---------------- */
  {
    const todayBar = { trade_date: TODAY, close: 4.62, volume: 3415461, source: 'tencent' };
    const histBar = { trade_date: YESTERDAY, close: 4.637, volume: 5732887, source: 'tencent' };

    assert.strictEqual(isStructurallyValidDailyBar(todayBar), true, '盘中 bar 字段是完整的');
    assert.strictEqual(isFinalizedDailyBar(todayBar, { today: TODAY }), false,
      '★ 但字段完整 ≠ 已定稿（这正是旧 isOfficialDailyBar 的语义漏洞）');
    assert.strictEqual(isFinalizedDailyBar(histBar, { today: TODAY }), true, '历史 bar 天然定稿');
    assert.strictEqual(
      isFinalizedDailyBar(Object.assign({}, todayBar, { is_final: true }), { today: TODAY }), true,
      '带 is_final 的当日 bar 才算定稿');

    assert.strictEqual(DAILY_BAR_FINALIZATION_CUTOFF, '15:30');
    assert.strictEqual(cutoffMinutes('15:30'), 930);
    assert.strictEqual(cutoffMinutes('bogus'), 930, '非法输入回退 15:30');

    // 落库闸门边界
    assert.strictEqual(isBarWritable(histBar, { today: TODAY, nowMinutes: 9 * 60 }), true,
      '历史 bar 盘中也可回补');
    assert.strictEqual(isBarWritable(todayBar, { today: TODAY, nowMinutes: 15 * 60 + 29 }), false,
      '15:29 → 当日 bar 不写');
    assert.strictEqual(isBarWritable(todayBar, { today: TODAY, nowMinutes: 15 * 60 + 30 }), true,
      '15:30 → 当日 bar 可写（含边界）');
    assert.strictEqual(isBarWritable({ trade_date: '2026-09-11' }, { today: TODAY, nowMinutes: 16 * 60 }), false,
      '未来日期不写');
  }

  /* ---------------- U1：Main5 已定稿 + Benchmark 缺失 → Main5 调用次数 = 0 ---------------- */
  {
    const rows = MAIN5.map((c) => finalizedRow(c, TODAY));
    const h = load({ rows });
    const out = await runMain(h, {});
    const called = calledCodes(h.datasource);
    assert.deepStrictEqual(called, [BENCH], `★ U1：本轮只应抓 ${BENCH}，实际 ${called.join(',')}`);
    assert.strictEqual(called.filter((c) => MAIN5.indexOf(c) >= 0).length, 0, '★ U1：Main5 调用次数必须 = 0');
    assert.strictEqual(out.overall, 'OK');
  }

  /* ---------------- U2：Benchmark 已定稿 + Main5 缺失 → 510300 调用次数 = 0 ---------------- */
  {
    const rows = [finalizedRow(BENCH, TODAY)];
    const h = load({ rows });
    await runMain(h, {});
    const called = calledCodes(h.datasource);
    assert.strictEqual(called.indexOf(BENCH) >= 0, false, '★ U2：510300 调用次数必须 = 0');
    assert.strictEqual(called.filter((c) => MAIN5.indexOf(c) >= 0).length, MAIN5.length, 'U2：只补 Main5');
  }

  /* ---------------- U3：盘中（14:03）→ today 不落库，历史照常回补 ---------------- */
  {
    const h = load({ rows: [], now: beijing('14:03'), includeToday: true });
    const out = await runMain(h, { force: true });
    assert.strictEqual(writtenDates(h.db, '513310').has(TODAY), false,
      '★ U3：盘中不得落库当日未定稿 bar');
    assert.strictEqual(writtenDates(h.db, '513310').has(YESTERDAY), true, 'U3：历史 bar 照常写');
    assert.strictEqual(writtenDates(h.db, BENCH).has(TODAY), false, '★ U3：基准的当日 bar 同样不写');
    assert.strictEqual(writtenDates(h.db, BENCH).has(YESTERDAY), true, 'U3：基准历史照常写');
    assert.strictEqual(out.production_daily.latest_date, YESTERDAY, 'U3：latest_date 停在昨日');
    assert.strictEqual(out.finalization_cutoff, '15:30', 'U3：显式暴露定稿时点');
    assert.strictEqual(h.db.upserts.length > 0, true, 'U3：历史 bar 确实落库（非空）');
    assert.strictEqual(
      out.results.filter((r) => r.skipped_unfinalized > 0).length > 0, true,
      'U3：应上报被丢弃的未定稿 bar 计数');
  }

  /* ---------------- U4：收盘后（15:45）→ today 落库且带 is_final ---------------- */
  {
    const h = load({ rows: [], now: beijing('15:45'), includeToday: true });
    await runMain(h, { force: true });
    assert.strictEqual(writtenDates(h.db, '513310').has(TODAY), true,
      '★ U4：收盘后当日 bar 必须落库');
    const todayDocs = h.db.upserts.filter((u) => String(u.doc.trade_date).slice(0, 10) === TODAY);
    assert.strictEqual(todayDocs.length > 0, true);
    assert.strictEqual(todayDocs.every((u) => u.doc.is_final === true), true,
      '★ U4：当日 bar 必须带 is_final 定稿标记');
    const histDocs = h.db.upserts.filter((u) => String(u.doc.trade_date).slice(0, 10) === YESTERDAY);
    assert.strictEqual(histDocs.every((u) => u.doc.is_final === undefined), true,
      'U4：历史 bar 不需要（也不应伪造）is_final 标记');
  }

  /* ---------------- U5：盘中 force → 历史 backfill 正常、today 排除 ---------------- */
  {
    const h = load({ rows: [], now: beijing('14:03'), includeToday: true });
    const out = await runMain(h, { force: true });
    const dates5 = writtenDates(h.db, '513310');
    assert.strictEqual(dates5.size >= 250, true, `U5：盘中 force 仍须完成历史 backfill（生产 Lane 抓 260 根，实际 ${dates5.size} 根）`);
    assert.strictEqual(dates5.has(TODAY), false, '★ U5：today 必须被排除');
    const benchDates = writtenDates(h.db, BENCH);
    assert.strictEqual(benchDates.size >= 300, true, `U5：基准历史同样补齐（${benchDates.size} 根）`);
    assert.strictEqual(benchDates.has(TODAY), false, '★ U5：基准 today 同样被排除');
    assert.strictEqual(out.lane_execution.force, true, 'U5：force 应如实上报');
  }

  /* ---------------- U6：盘中误写入的 today bar 不得被视为 FINALIZED ---------------- */
  {
    // ① 纯判定：无 is_final 的当日行 → 未就绪
    const rows = MAIN5.map((c) => poisonedRow(c, TODAY)).concat([finalizedRow(BENCH, TODAY)]);
    const planAtNoon = planDailyFetch({
      decisionCodes: MAIN5, benchmarkCodes: [BENCH], existingRows: rows, dateStr: TODAY,
      isFinalized: isFinalizedDailyBar
    });
    assert.strictEqual(planAtNoon.production.pending.join(','), MAIN5.join(','),
      '★ U6：盘中误写入的当日行不得算就绪（必须全部视为待抓）');
    assert.strictEqual(planAtNoon.production.to_fetch.length, MAIN5.length);
    assert.strictEqual(planAtNoon.benchmark.pending.length, 0, 'U6：带 is_final 的基准行确实算就绪');
    assert.strictEqual(planAtNoon.skip, false);

    // ② 端到端：收盘后跑一次 → 被污染的行被重抓并用 is_final 覆盖
    const h = load({ rows, now: beijing('15:45'), includeToday: true });
    await runMain(h, {});
    const todayProd = h.db.upserts.filter((u) => MAIN5.indexOf(String(u.doc.code)) >= 0
      && String(u.doc.trade_date).slice(0, 10) === TODAY);
    assert.strictEqual(todayProd.length, MAIN5.length,
      '★ U6：被污染的 Main5 当日行必须被重抓覆盖');
    assert.strictEqual(todayProd.every((u) => u.doc.is_final === true), true,
      '★ U6：覆盖后必须补上 is_final 标记');
    assert.strictEqual(calledCodes(h.datasource).indexOf(BENCH) >= 0, false,
      'U6：就绪的基准仍不重复抓');
  }

  /* ---------------- 静态守卫 ---------------- */
  {
    const src = fs.readFileSync(FN_PATH, 'utf8');
    assert.strictEqual(/isBarWritable\(/.test(src), true, '★ 落库前必须有定稿闸门');
    assert.strictEqual(/doc\.is_final = true/.test(src), true, '★ 当日 bar 必须打 is_final 标记');
    assert.strictEqual(/isFinalized:\s*isFinalizedDailyBar/.test(src), true,
      '★ 就绪判定必须用 isFinalizedDailyBar（不得用「有成交量」的旧口径）');
    assert.strictEqual(/isOfficialDailyBar/.test(src), false,
      '★ 不得再引用语义模糊的旧名 isOfficialDailyBar');
  }

  console.log('gen1 daily finality & lane execution tests passed');
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exitCode = 1;
});
