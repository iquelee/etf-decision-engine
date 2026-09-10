/**
 * WP-G1-DATA-01（方案 B+）Benchmark Pipeline 测试 —— Gate G1-T。
 *
 * 覆盖任务书点名的 6 个场景：
 *   T1  510300 不在 etf_basic → 仍会被 fetchDailyData 抓取
 *   T2  ★ Main5 今日已定稿 + 510300 缺失 → **不得 already_fetched 跳过**
 *   T3  Main5 + 510300 今日全定稿 → 幂等 skip
 *   T4  ★ 基准失败 → 生产 Lane **一次都不抓**（故不可能被拖累）、标 PARTIAL、不抛错
 *   T5  510300 不进入 getEtfList / runDecisionEngine universe（只写 etf_daily）
 *   T6  Benchmark latest date == Main5 latest date → DATA_OK
 *
 * 另加守卫：
 *   - 冻结管线文件 runGen1ShadowEod 里的基准字面量必须 === GEN1_BENCHMARK_CODE（防三方漂移）
 *   - 源码级防回归：必须消费 plan.*.to_fetch；不得回归 `await isAlreadyFetched`
 *
 * 用 vm 注入内存 DB + mock datasource 加载真实云函数源码，不连云端。
 * 运行：node tests/gen1-benchmark-pipeline.test.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SRC_COMMON = path.join(ROOT, 'src', 'common');
const FN_PATH = path.join(ROOT, 'cloudfunctions', 'fetchDailyData', 'index.js');
const FROZEN_EOD = path.join(ROOT, 'cloudfunctions', 'runGen1ShadowEod', 'index.js');

const {
  GEN1_BENCHMARK_CODE, GEN1_BENCHMARK_CODES, COLLECTIONS
} = require(path.join(SRC_COMMON, 'constants.js'));
const {
  ROLE, STATE, OVERALL, planDailyFetch, summarizeDailyFetchResults
} = require(path.join(SRC_COMMON, 'utils', 'daily-fetch-plan.js'));
const { STATUS, REASON, REQUIRED_FEATURES, evaluateDataHealth } = require(path.join(SRC_COMMON, 'utils', 'gen1-data-health.js'));

const TODAY = '2026-09-10';          // 冻结的「今天」（北京时间）
const LATEST_BAR = '2026-09-09';     // mock 数据源返回的最新历史 bar
// 默认「现在」= 北京 16:00（已过 15:30 定稿时点），使「今日已定稿」fixture 语义自洽
const NOW_16 = Date.parse('2026-09-10T08:00:00Z');
const MAIN5 = ['513310', '515880', '159582', '159570', '518880'];

/* ------------------------------------------------------------------ *
 * 测试脚手架：vm 加载真实云函数源码 + 内存 DB + mock datasource
 * ------------------------------------------------------------------ */

/** 生成 n 根历史日线（到 LATEST_BAR 为止），volume>0 && close>0。 */
function makeBars(code, n) {
  const bars = [];
  const end = Date.parse(LATEST_BAR + 'T00:00:00Z');
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(end - i * 86400000).toISOString().slice(0, 10);
    bars.push({ trade_date: d, open: 1, high: 1, low: 1, close: 1, volume: 100, amount: 1, source: 'tencent' });
  }
  return bars.map((b) => Object.assign({}, b, { code }));
}

/** 当日「已定稿」行（带 is_final 标记，只有过了定稿时点才会被写入）。 */
function finalizedRow(code, date) {
  return {
    code, trade_date: date, open: 1, high: 1, low: 1, close: 1, volume: 100,
    source: 'tencent', is_final: true
  };
}

/**
 * @param {object} opt
 * @param {object[]} opt.rows        etf_daily 已有行
 * @param {string[]} [opt.failCodes] fetchDaily 对这些 code 抛错
 * @param {string[]} [opt.etfs]      getEtfList 返回的 code
 * @param {number}   [opt.now]       冻结的「现在」（ms UTC）
 */
function load(opt) {
  const o = opt || {};
  const failCodes = o.failCodes || [];
  const etfCodes = o.etfs || MAIN5.slice();
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
    upsert: async (name, doc, key) => {
      upserts.push({ name, doc: Object.assign({}, doc), key });
      return { created: true };
    },
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
      return { bars: makeBars(code, limit || 260), source: 'tencent' };
    },
    fetchPremiumIopv: async () => null,
    fetchFredSeries: async () => [],
    fetchDollarIndex: async () => null,
    fetchStoragePrice: async () => null,
    fetchGoldEtfHolding: async () => null,
    fetchIndexWeekly: async () => [],
    fetchGlobalDaily: async () => []
  };

  const FIXED = o.now != null ? o.now : NOW_16;
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
      if (p.startsWith('./common/')) {
        return require(path.join(SRC_COMMON, p.replace(/^\.\/common\//, '')));
      }
      return require(path.join(path.dirname(FN_PATH), p));
    }
  };

  vm.runInNewContext(fs.readFileSync(FN_PATH, 'utf8'), box);
  return { mod: box.exports, db, datasource, today: TODAY, fixed: FIXED };
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


function upsertCodes(db) {
  return Array.from(new Set(db.upserts.filter((u) => u.name === COLLECTIONS.ETF_DAILY).map((u) => u.doc.code))).sort();
}

function calledCodes(ds) {
  return Array.from(new Set(ds.calls.map((c) => c.code))).sort();
}

async function main() {
  /* ---------------- T1：benchmark 与决策 Universe 解耦 ---------------- */
  {
    assert.strictEqual(GEN1_BENCHMARK_CODES.length >= 1, true, '必须声明至少一个 benchmark');
    const overlap = GEN1_BENCHMARK_CODES.filter((c) => MAIN5.indexOf(c) >= 0);
    assert.deepStrictEqual(overlap, [], 'benchmark 不得同时是生产 ETF');

    const plan = planDailyFetch({
      decisionCodes: MAIN5, benchmarkCodes: GEN1_BENCHMARK_CODES, existingRows: [], dateStr: TODAY
    });
    assert.strictEqual(plan.needsFetch, true);
    assert.strictEqual(plan.benchmark.to_fetch.indexOf(GEN1_BENCHMARK_CODE) >= 0, true,
      'T1：benchmark 必须在待抓列表里');
    assert.strictEqual(plan.production.to_fetch.length, MAIN5.length);
    assert.strictEqual(plan.benchmark.role, ROLE.BENCHMARK);
  }

  /* ---------------- T2：Main5 已定稿 + benchmark 缺失 → 不得 skip，且不重抓 Main5 ---------------- */
  {
    const rows = MAIN5.map((c) => finalizedRow(c, TODAY)); // 只有 Main5，无 benchmark
    const h = load({ rows });
    const out = await runMain(h, {});

    assert.notStrictEqual(out.skipped, 'already_fetched',
      '★ T2：Main5 已就绪不得掩盖 benchmark 缺失（原实现会 early return）');
    assert.strictEqual(h.datasource.calls.some((c) => c.code === GEN1_BENCHMARK_CODE), true,
      '★ T2：benchmark 必须真的被抓');
    assert.deepStrictEqual(calledCodes(h.datasource).filter((c) => MAIN5.indexOf(c) >= 0), [],
      '★ T2：已就绪的生产 Lane 不得重复抓取');
    assert.strictEqual(out.production_daily.ok, true, 'T2：生产 Lane 就绪');
    assert.strictEqual(out.production_daily.ready_existing, MAIN5.length, 'T2：全部 READY_EXISTING');
    assert.strictEqual(out.benchmark_daily.ok, true, 'T2：benchmark 抓取成功');
    assert.strictEqual(out.overall, OVERALL.OK, 'T2：两条 Lane 都就绪 → OK');
  }

  /* ---------------- T3：两条 Lane 全定稿 → 幂等 skip ---------------- */
  {
    const rows = MAIN5.concat([GEN1_BENCHMARK_CODE]).map((c) => finalizedRow(c, TODAY));
    const h = load({ rows });
    const out = await runMain(h, {});

    assert.strictEqual(out.skipped, 'already_fetched', 'T3：全部就绪 → 幂等跳过');
    assert.strictEqual(h.datasource.calls.length, 0, 'T3：不得发起任何抓取');
    assert.strictEqual(out.overall, OVERALL.OK);
    assert.strictEqual(out.benchmark_daily.ready_existing, 1);
  }

  /* ---------------- T3b：Main5 缺失但 benchmark 就绪 → 只补 Main5 ---------------- */
  {
    const rows = [finalizedRow(GEN1_BENCHMARK_CODE, TODAY)];
    const h = load({ rows });
    const out = await runMain(h, {});
    assert.notStrictEqual(out.skipped, 'already_fetched', 'T3b：反向也不得被掩盖');
    const called = calledCodes(h.datasource);
    assert.deepStrictEqual(called.filter((c) => MAIN5.indexOf(c) >= 0).length, MAIN5.length,
      'T3b：生产 Lane 必须补抓');
    assert.strictEqual(called.indexOf(GEN1_BENCHMARK_CODE) >= 0, false,
      '★ T3b：已就绪的 benchmark 不得重复抓取');
  }

  /* ---------------- T4：基准失败 → PARTIAL、生产 Lane 一次都不抓、不抛错 ---------------- */
  {
    const rows = MAIN5.map((c) => finalizedRow(c, TODAY));
    const h = load({ rows, failCodes: [GEN1_BENCHMARK_CODE] });
    const out = await runMain(h, {});

    assert.strictEqual(out.ok, true, 'T4：benchmark 失败不得让函数失败');
    assert.strictEqual(out.overall, OVERALL.PARTIAL,
      '★ T4：生产正常 + benchmark 失败 → PARTIAL（不是 FAIL）');
    assert.strictEqual(out.production_daily.ok, true, 'T4：生产 Lane 不得被 benchmark 拖死');
    assert.strictEqual(out.production_daily.fetch_failed, 0, 'T4：生产 Lane 零失败');
    assert.strictEqual(calledCodes(h.datasource).filter((c) => MAIN5.indexOf(c) >= 0).length, 0,
      '★ T4：生产 Lane 已就绪 → 一次抓取都不发起，因此不可能因瞬时失败把 overall 打成 FAIL');
    assert.strictEqual(out.benchmark_daily.ok, false, 'T4：benchmark 如实标失败');
    assert.strictEqual(out.benchmark_daily.failed_codes.join(','), GEN1_BENCHMARK_CODE,
      'T4：benchmark 如实上报失败标的');
    assert.strictEqual(h.db.upserts.some((u) => u.name === COLLECTIONS.ETF_BASIC), false,
      'T4/T5：任何情况下都不得写 etf_basic');
  }

  /* ---------------- T5：benchmark 不进入决策 Universe（且只写 etf_daily） ---------------- */
  {
    const h = load({ rows: [], now: Date.parse('2026-09-10T01:00:00Z') }); // 北京 09:00
    const out = await runMain(h, {});
    const codes = upsertCodes(h.db);
    assert.strictEqual(codes.indexOf(GEN1_BENCHMARK_CODE) >= 0, true, 'T5：benchmark 写入 etf_daily');
    assert.strictEqual(codes.length, MAIN5.length + GEN1_BENCHMARK_CODES.length,
      'T5：落库集合 = Main5 + benchmark，无第 6 只决策标的');
    assert.strictEqual(out.production_daily.codes, MAIN5.length, 'T5：生产 Lane 仍只覆盖 Main5');
    // benchmark 行不携带折溢价字段（只有生产 ETF 才抓 premium/iopv）
    const benchDocs = h.db.upserts.filter((u) => u.doc.code === GEN1_BENCHMARK_CODE);
    assert.strictEqual(benchDocs.length > 0, true);
    assert.strictEqual(benchDocs.every((u) => u.doc.premium_rate === undefined), true,
      'T5：benchmark 不该写 premium_rate');
    const prodDocs = h.db.upserts.filter((u) => MAIN5.indexOf(u.doc.code) >= 0);
    assert.strictEqual(prodDocs.every((u) => u.doc.premium_rate === null), true,
      'T5：生产 ETF 保持 premium_rate=null 的既有语义');
    // 数据来源仍是真实 provenance，不是 'benchmark'
    assert.strictEqual(h.db.upserts.every((u) => u.doc.source !== 'benchmark'), true,
      '★ T5：source 只能是 tencent/sina/eastmoney，不得用 benchmark 混淆来源与角色');
  }

  /* ---------------- T6：基准与 Main5 对齐 → DATA_OK ---------------- */
  {
    const feats = {};
    for (const k of REQUIRED_FEATURES) feats[k] = k === 'breakout' ? 0 : 1.0;
    const ok = evaluateDataHealth({
      features: feats, mainLatestDate: TODAY, benchmarkLatestDate: TODAY, historyBars: 200
    });
    assert.strictEqual(ok.status, STATUS.DATA_OK, 'T6：日期对齐 → DATA_OK');

    const bad = evaluateDataHealth({
      features: feats, mainLatestDate: TODAY, benchmarkLatestDate: '2026-09-04', historyBars: 200
    });
    assert.strictEqual(bad.status, STATUS.DATA_BLOCKED);
    assert.strictEqual(bad.reason_code, REASON.BENCHMARK_MISSING,
      'T6：落后 3 个交易日 → BENCHMARK_MISSING（本次 STOP 的真实场景）');
  }

  /* ---------------- summarize 语义（PARTIAL / FAIL 边界） ---------------- */
  {
    const okProd = MAIN5.map((c) => ({ code: c, ok: true, state: STATE.READY_EXISTING, latest_date: LATEST_BAR }));
    const okBench = [{ code: GEN1_BENCHMARK_CODE, ok: true, state: STATE.FETCHED_OK, latest_date: LATEST_BAR, source: 'tencent' }];
    const badBench = [{ code: GEN1_BENCHMARK_CODE, ok: false, state: STATE.FETCH_FAILED, latest_date: null }];
    const badProd = [{ code: MAIN5[0], ok: false, state: STATE.FETCH_FAILED, latest_date: null }];

    const s1 = summarizeDailyFetchResults({ productionResults: okProd, benchmarkResults: okBench, benchmarkCode: GEN1_BENCHMARK_CODE });
    assert.strictEqual(s1.overall, OVERALL.OK);
    assert.strictEqual(s1.benchmark_daily.source, 'tencent');
    assert.strictEqual(s1.benchmark_daily.latest_date, LATEST_BAR);
    assert.strictEqual(s1.production_daily.ready_existing, MAIN5.length);

    const s2 = summarizeDailyFetchResults({ productionResults: okProd, benchmarkResults: badBench, benchmarkCode: GEN1_BENCHMARK_CODE });
    assert.strictEqual(s2.overall, OVERALL.PARTIAL);
    assert.strictEqual(s2.production_blocked_by_benchmark, false, '★ benchmark 失败不得阻断生产');

    const s3 = summarizeDailyFetchResults({ productionResults: badProd, benchmarkResults: okBench, benchmarkCode: GEN1_BENCHMARK_CODE });
    assert.strictEqual(s3.overall, OVERALL.FAIL, '生产失败才是 FAIL');
  }

  /* ---------------- 静态守卫：源码级防止回归 ---------------- */
  {
    const src = fs.readFileSync(FN_PATH, 'utf8');
    assert.strictEqual(/const benchmarkCodes = GEN1_BENCHMARK_CODES/.test(src), true,
      '★ benchmark 清单必须来自 GEN1_BENCHMARK_CODES 单一事实源（不得读 getEtfList）');
    assert.strictEqual(/await isAlreadyFetched\(/.test(src), false,
      '★ 主流程禁止再用「只含 Main5 的 codes」做幂等判定（原 P0 的写法）');
    assert.strictEqual(/planDailyFetch\(/.test(src), true, '幂等必须走两条 Lane 的 plan');
    assert.strictEqual(/plan\.production\.to_fetch/.test(src), true,
      '★ 必须真正消费 plan.production.to_fetch（否则已就绪标的会被重复抓）');
    assert.strictEqual(/plan\.benchmark\.to_fetch/.test(src), true,
      '★ 必须真正消费 plan.benchmark.to_fetch');
    assert.strictEqual(/fetchAndPersistDaily\(/.test(src), true, '生产与 benchmark 必须共用同一抓取实现');
    assert.strictEqual(/const doc = Object\.assign\(\{ code \}, bar\)/.test(src), true,
      '抓取落库只有一处实现（禁止复制粘贴第二份）');

    // 冻结管线文件里的基准字面量必须与常量一致（不替换 frozen 文件，用守卫替代）
    const frozen = fs.readFileSync(FROZEN_EOD, 'utf8');
    const args = [];
    const re = /officialBars\(\s*([^)]+?)\s*\)/g;
    let m = re.exec(frozen);
    while (m) { args.push(m[1].trim()); m = re.exec(frozen); }
    const benchArg = args.find((a) => /GEN1_BENCHMARK_CODE|'[0-9]{6}'/.test(a));
    assert.notStrictEqual(benchArg, undefined, '冻结 EOD 里必须能找到基准调用');
    assert.strictEqual(
      benchArg === 'GEN1_BENCHMARK_CODE' || benchArg === `'${GEN1_BENCHMARK_CODE}'`, true,
      `★ 冻结 EOD 的基准参数 ${benchArg} 必须 === GEN1_BENCHMARK_CODE(${GEN1_BENCHMARK_CODE})`
    );
  }

  console.log('gen1 benchmark pipeline tests passed');
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exitCode = 1;
});
