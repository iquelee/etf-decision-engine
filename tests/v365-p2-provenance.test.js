/**
 * V3.6.5 Production Integrity —— P-2 专项测试
 *
 * 覆盖：
 *   §A  global_signals 日期 provenance（provider 时间戳 → source_market_date）
 *   §B  fundamental 日期 provenance（贡献行 = 评分器实际选中的行）
 *   §C  market_env 日期 provenance（weekly bar → as_of + partial 标记 + 交易日 lag）
 *
 * 运行：node tests/v365-p2-provenance.test.js
 *
 * ⚠️ 本测试只读：不联网、不部署、不写库、不改生产参数。
 *    §A.6 会临时替换 `ds.http.get` 以注入**合成的**腾讯响应报文，结束后立即还原。
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const U = (f) => require(path.join(REPO, 'src/common/utils', f));

const {
  DATE_ORIGIN, SOURCE_TIMEZONE,
  parseProviderTimestamp, buildGlobalQuoteProvenance,
  resolveGlobalSignalFreshnessDate, mapGlobalSignalsToAsOf
} = U('global-signal-provenance.js');

const {
  FRESHNESS,
  selectFundamentalContributions, buildFundamentalProvenance, fundamentalProvenanceFrom
} = U('fundamental-provenance.js');

const { pickLatestSeries } = U('fundamental.js');

const {
  resolveMarketEnvProvenance, extractBarDates
} = U('market-env-provenance.js');

const { loadCalendar } = U('cn-trading-calendar.js');

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } catch (e) {
    failed += 1;
    failures.push({ name, err: e });
    console.log(`  \u2717 ${name}`);
    console.log(`      ${e && e.message}`);
  }
}
function section(t) { console.log(`\n== ${t} ==`); }

const asyncCases = [];
function testAsync(name, fn) { asyncCases.push({ name, fn }); }

const FIXTURE = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures', 'cn-trading-calendar.fixture.json'), 'utf8'
));
const CAL = loadCalendar(FIXTURE);

/* ================================================================== *
 * §A global_signals provenance
 * ================================================================== */
section('§A global_signals 日期 provenance');

test('A.1 provider 时间戳多形态可解析', () => {
  assert.deepStrictEqual(
    parseProviderTimestamp(['200', 'usMU', '2026-09-22 16:00:00']),
    { source_timestamp: '2026-09-22 16:00:00', source_market_date: '2026-09-22' }
  );
  assert.deepStrictEqual(
    parseProviderTimestamp(['2026-09-22 16:00']),
    { source_timestamp: '2026-09-22 16:00', source_market_date: '2026-09-22' }
  );
  assert.deepStrictEqual(
    parseProviderTimestamp(['2026/09/22 16:00:00']),
    { source_timestamp: '2026-09-22 16:00:00', source_market_date: '2026-09-22' }
  );
  assert.deepStrictEqual(
    parseProviderTimestamp(['20260922160000']),
    { source_timestamp: '2026-09-22 16:00:00', source_market_date: '2026-09-22' }
  );
});

test('A.2 非法 / 缺失时间戳不得被解析（不编造）', () => {
  assert.strictEqual(parseProviderTimestamp(['2026-02-31 10:00:00']), null, '非法日历日必须拒绝');
  assert.strictEqual(parseProviderTimestamp(['2026-13-01 10:00:00']), null);
  assert.strictEqual(parseProviderTimestamp(['100.5', '99.2', 'usMU']), null, '纯数字价格不得被当成时间戳');
  assert.strictEqual(parseProviderTimestamp([]), null);
  assert.strictEqual(parseProviderTimestamp(null), null);
});

test('A.3 buildGlobalQuoteProvenance：有/无 timestamp 的两种明确结果', () => {
  const ok = buildGlobalQuoteProvenance({
    fields: ['200', 'usMU', '2026-09-22 16:00:00'],
    legacy_trade_date: '2026-09-23'          // legacy = 抓取日（北京）
  });
  assert.strictEqual(ok.source_timestamp, '2026-09-22 16:00:00');
  assert.strictEqual(ok.source_market_date, '2026-09-22');
  assert.strictEqual(ok.date_origin, DATE_ORIGIN.PROVIDER_TIMESTAMP);
  assert.strictEqual(ok.provenance_status, 'RESOLVED');
  assert.strictEqual(ok.source_timezone, SOURCE_TIMEZONE);
  assert.strictEqual(ok.legacy_trade_date, '2026-09-23', 'legacy 字段原样回显、不被改写');

  const unknown = buildGlobalQuoteProvenance({ fields: ['200', 'usMU'], legacy_trade_date: '2026-09-23' });
  assert.strictEqual(unknown.source_timestamp, null);
  assert.strictEqual(unknown.source_market_date, null, '⛔ 不得 fallback 为北京今天');
  assert.strictEqual(unknown.date_origin, DATE_ORIGIN.UNKNOWN);
  assert.strictEqual(unknown.provenance_status, 'UNKNOWN');
});

test('A.4 freshness 取 source_market_date，绝不回退 legacy trade_date', () => {
  assert.strictEqual(
    resolveGlobalSignalFreshnessDate({ source_market_date: '2026-09-22', trade_date: '2026-09-23' }),
    '2026-09-22'
  );
  assert.strictEqual(
    resolveGlobalSignalFreshnessDate({ trade_date: '2026-09-23' }),
    null,
    '⛔ 没有 provider 日期时必须返回 null —— legacy trade_date 是抓取日，会系统性偏新'
  );
  assert.strictEqual(resolveGlobalSignalFreshnessDate({}), null);
});

test('A.5 mapGlobalSignalsToAsOf：调用侧 adapter（不改 producer 语义）', () => {
  const r = mapGlobalSignalsToAsOf([
    { symbol: 'usNDX', source_market_date: '2026-09-22' },
    { symbol: 'usMU', trade_date: '2026-09-23' },          // 无 provider 日期
    { symbol: 'usXBI', source_market_date: null }
  ]);
  assert.deepStrictEqual(r.mapped, [{ symbol: 'usNDX', as_of_date: '2026-09-22' }]);
  assert.strictEqual(r.unmapped.length, 2);
  assert.strictEqual(r.unmapped[0].reason, 'no_provider_market_date');
});

test('A.6【接入-静态】fetchGlobalDaily 已接入 provenance，且 legacy trade_date 语义未变', () => {
  // ⚠️ 不 require('datasource.js')：它依赖 axios，而仓库根 package.json 无 dependencies
  //（依赖在各 cloudfunctions/*/package.json），本机与 CI 的根上下文都拿不到 axios。
  // 因此这里只做**字符串定位**级断言（不用于计数/集合判定），行为断言由 §A.1–A.5 的纯函数测试承担。
  const src = fs.readFileSync(path.join(REPO, 'src/common/utils/datasource.js'), 'utf8');

  // 接入证据
  assert.ok(src.includes("require('./global-signal-provenance')"), '必须引入 provenance 模块');
  assert.ok(src.includes('buildGlobalQuoteProvenance('), 'fetchGlobalDaily 必须调用 provenance 构造函数');
  assert.ok(src.includes('legacy_trade_date: today'), 'legacy trade_date 必须原样传给 provenance（不得改写）');

  // legacy 字段保留（⛔ 暂不改写 / 不迁移）
  assert.ok(/trade_date:\s*today/.test(src), 'legacy `trade_date: today` 必须保留');

  // ⛔ 禁止把抓取日或运行时时刻伪装成市场日
  assert.ok(!/source_market_date:\s*today/.test(src), '⛔ 不得把抓取日写入 source_market_date');
  assert.ok(!/source_market_date:\s*new Date/.test(src), '⛔ 不得用运行时时刻伪造市场日');

  // provenance 字段确实被展开进返回行
  ['source_timestamp', 'source_market_date', 'date_origin', 'source_timezone', 'provenance_status']
    .forEach((k) => assert.ok(src.includes(`${k}: provenance.${k}`), `返回行必须含字段 ${k}`));
});

testAsync('A.7【可选集成】若环境具备 axios，则真实跑一次 fetchGlobalDaily 端到端', async () => {
  let ds = null;
  try { ds = U('datasource.js'); } catch (e) { ds = null; }
  if (!ds) {
    console.log('      [ENV] 本环境无 axios（根上下文无 dependencies）⇒ 跳过真实集成，静态断言见 A.6');
    return;
  }
  const origGet = ds.http.get;
  const f = new Array(40).fill('');
  f[1] = 'MU'; f[2] = 'MU'; f[3] = '120.5'; f[4] = '119.0'; f[5] = '119.5';
  f[30] = '2026-09-22 16:00:00'; f[32] = '1.26'; f[33] = '121.0'; f[34] = '118.0';
  const wire = `v_usMU="${f.join('~')}";`;
  ds.http.get = async () => ({ data: Buffer.from(wire, 'utf8') });
  let rows;
  try {
    rows = await ds.fetchGlobalDaily({ symbol: 'usMU' });
  } finally {
    ds.http.get = origGet;
  }
  const row = rows[0];
  const beijingToday = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  assert.strictEqual(row.trade_date, beijingToday, 'legacy trade_date 仍为北京抓取日');
  assert.strictEqual(row.source_timestamp, '2026-09-22 16:00:00');
  assert.strictEqual(row.source_market_date, '2026-09-22');
  assert.strictEqual(row.date_origin, DATE_ORIGIN.PROVIDER_TIMESTAMP);
  assert.strictEqual(row.close, 120.5);
  assert.strictEqual(row.pct_change, 1.26);
});

/* ================================================================== *
 * §B fundamental provenance
 * ================================================================== */
section('§B fundamental 日期 provenance');

const FD_CONFIGS = [
  { code: '513310', indicator: 'dram_price', weight: 20, freq: 'daily', metric_type: 'quantitative' },
  { code: '513310', indicator: 'hbm_demand', weight: 20, freq: 'weekly', metric_type: 'qualitative' },
  { code: '513310', indicator: 'retired_x', weight: 0, freq: 'weekly', metric_type: 'qualitative' }
];

const FD_SERIES = {
  // 硬数据格子：最新的那行来自 llm_week（非硬源），评分器会**跳过它**而取 chinaflashmarket 那行
  dram_price: [
    { data_date: '2026-09-22', source: 'llm_week', value: 3, updated_at: '2026-09-23T01:00:00.000Z' },
    { data_date: '2026-09-18', source: 'chinaflashmarket', value: 100, prev: 95, updated_at: '2026-09-19T00:00:00.000Z' }
  ],
  hbm_demand: [
    { data_date: '2026-09-21', source: 'llm_week', value: 4, updated_at: '2026-09-22T00:00:00.000Z' }
  ],
  retired_x: [
    { data_date: '2026-09-20', source: 'llm_week', value: 5 }
  ]
};

test('B.1 贡献行与评分器选中行**逐位一致**（复用同一条 pickLatestSeries）', () => {
  const sel = selectFundamentalContributions(FD_CONFIGS, FD_SERIES);
  assert.strictEqual(sel.contributions.length, 2, '仅 2 个有效指标（retired_x 权重 0）');

  FD_CONFIGS.forEach((cfg) => {
    // 与评分器一致：weight <= 0 的指标根本不参与（pickLatestSeries 本身不看权重，
    // 权重过滤发生在其调用方）⇒ 遍历断言时须跳过它们
    if ((Number(cfg.weight) || 0) <= 0) return;
    const expectedRow = pickLatestSeries(FD_SERIES[cfg.indicator], cfg);
    const got = sel.contributions.find((c) => c.indicator === cfg.indicator);
    if (!expectedRow) {
      assert.strictEqual(got, undefined, `${cfg.indicator} 评分器未选中，provenance 也不得记录`);
      return;
    }
    assert.ok(got, `${cfg.indicator} 必须出现在贡献行里`);
    assert.strictEqual(got.data_date, expectedRow.data_date,
      `${cfg.indicator} 的 data_date 必须等于评分器选中行的 data_date`);
    assert.strictEqual(got.source, expectedRow.source);
  });
});

test('B.2 硬格子取的是**评分器选中的行**，不是 max(data_date)', () => {
  const sel = selectFundamentalContributions(FD_CONFIGS, FD_SERIES);
  const dram = sel.contributions.find((c) => c.indicator === 'dram_price');
  assert.strictEqual(dram.data_date, '2026-09-18', '应取硬源行，而非最新的 llm_week 行(09-22)');
  assert.strictEqual(dram.source, 'chinaflashmarket');
});

test('B.3 数据日期来自 row.data_date —— 绝不使用 updated_at', () => {
  const sel = selectFundamentalContributions(FD_CONFIGS, FD_SERIES);
  sel.contributions.forEach((c) => {
    assert.strictEqual(c.data_date_origin, 'fundamental_series.data_date');
    assert.ok(!String(c.data_date).startsWith('2026-09-23'), '不得取到 updated_at 的日期');
  });
  const prov = buildFundamentalProvenance(sel.contributions, { reference_date: '2026-09-23' });
  assert.strictEqual(prov.updated_at_used_as_data_date, false);
  assert.deepStrictEqual(
    prov.contributing_inputs.map((c) => c.data_date).sort(),
    ['2026-09-18', '2026-09-21']
  );
});

test('B.4 oldest / latest 正确，单一日期取 oldest（保守）', () => {
  const prov = fundamentalProvenanceFrom(FD_CONFIGS, FD_SERIES, { reference_date: '2026-09-23' });
  assert.strictEqual(prov.oldest_contributing_date, '2026-09-18');
  assert.strictEqual(prov.latest_contributing_date, '2026-09-21');
  assert.strictEqual(prov.fundamental_as_of_date, '2026-09-18',
    '需要单一日期时取最旧（不掩盖最旧的那个源）');
});

test('B.5 零副作用：输入 configs / series 未被修改', () => {
  const cfgBefore = JSON.stringify(FD_CONFIGS);
  const serBefore = JSON.stringify(FD_SERIES);
  const sel = selectFundamentalContributions(FD_CONFIGS, FD_SERIES);
  buildFundamentalProvenance(sel.contributions, { reference_date: '2026-09-23' });
  assert.strictEqual(JSON.stringify(FD_CONFIGS), cfgBefore, 'configs 不得被修改');
  assert.strictEqual(JSON.stringify(FD_SERIES), serBefore, 'series 不得被修改');
});

test('B.6 返回体不含任何决策字段（不改变 signal / score / f_state）', () => {
  const prov = fundamentalProvenanceFrom(FD_CONFIGS, FD_SERIES, { reference_date: '2026-09-23' });
  ['f_state', 'f_score', 'signal', 'final_signal', 'layer_breakdown'].forEach((k) => {
    assert.ok(!(k in prov), `provenance 不得包含决策字段 ${k}`);
  });
  const mod = U('fundamental-provenance.js');
  assert.deepStrictEqual(
    Object.keys(mod).sort(),
    ['FUNDAMENTAL_FREQ_STALENESS', 'FRESHNESS', 'buildFundamentalProvenance', 'daysBetween',
      'fundamentalProvenanceFrom', 'profileFor', 'selectFundamentalContributions'].sort(),
    '模块导出面必须只有 provenance 相关符号'
  );
});

test('B.7 freshness 按频率判定；未给 reference_date 时为 UNKNOWN（不得用 new Date()）', () => {
  const prov = fundamentalProvenanceFrom(FD_CONFIGS, FD_SERIES, { reference_date: '2026-09-23' });
  const dram = prov.per_indicator_staleness.find((p) => p.indicator === 'dram_price');
  assert.strictEqual(dram.max_staleness_days, 5, 'daily 频率 → 5 自然日');
  assert.strictEqual(dram.lag_days, 5);
  assert.strictEqual(dram.status, FRESHNESS.OK);

  const noRef = fundamentalProvenanceFrom(FD_CONFIGS, FD_SERIES, {});
  assert.strictEqual(noRef.reference_date, null);
  assert.strictEqual(noRef.freshness_status, FRESHNESS.UNKNOWN, '无参照日不得猜');
});

test('B.8 fundamental 是 optional 源：过期只 DEGRADED，绝不 BLOCK', () => {
  const stale = fundamentalProvenanceFrom(FD_CONFIGS, FD_SERIES, { reference_date: '2027-06-01' });
  assert.strictEqual(stale.freshness_status, FRESHNESS.DEGRADED);
  assert.strictEqual(stale.optional_source, true);
  assert.strictEqual(stale.blocks_run, false);
});

test('B.9 zero-weight 指标被跳过，且与评分器口径一致', () => {
  const sel = selectFundamentalContributions(FD_CONFIGS, FD_SERIES);
  assert.ok(sel.skipped.some((s) => s.indicator === 'retired_x' && s.reason === 'zero_or_missing_weight'));
  assert.ok(sel.skipped.some((s) => s.indicator === 'nonexistent_x') === false);
  const sel2 = selectFundamentalContributions(
    [{ code: '513310', indicator: 'ghost', weight: 10, freq: 'weekly', metric_type: 'qualitative' }], {}
  );
  assert.strictEqual(sel2.contributions.length, 0);
  assert.strictEqual(sel2.skipped[0].reason, 'no_row');
});

/* ================================================================== *
 * §C market_env provenance
 * ================================================================== */
section('§C market_env 日期 provenance');

function envRow(indexCode, dates) {
  return {
    index_code: indexCode,
    weekly_bars: dates.map((d) => ({ date: d, close: 1000 }))
  };
}

test('C.1 用 weekly_bars[].date 推导 market_env_as_of_date', () => {
  const rows = [
    envRow('000300', ['2026-09-11', '2026-09-18', '2026-09-25']),
    envRow('000688', ['2026-09-11', '2026-09-18', '2026-09-25'])
  ];
  const p = resolveMarketEnvProvenance(rows, { reference_date: '2026-09-30', calendar: CAL });
  assert.strictEqual(p.market_env_as_of_date, '2026-09-25');
  assert.strictEqual(p.oldest_index_as_of_date, '2026-09-25');
  assert.strictEqual(p.index_count, 2);
  assert.strictEqual(p.per_index[0].bar_count, 3);
  assert.strictEqual(p.per_index[0].date_origin, 'weekly_bars[].date');
});

test('C.2 partial week 必须显式标记（当周未走完 vs 已走完）', () => {
  const rows = [envRow('000300', ['2026-09-18', '2026-09-25'])];

  // 参照日在最后一根 bar 当周之内（2026-09-25 是周五；参照 09-23 更早 ⇒ 该周未走完）
  const inWeek = resolveMarketEnvProvenance(rows, { reference_date: '2026-09-23', calendar: CAL });
  assert.strictEqual(inWeek.market_env_partial_week, true, '当周未走完 ⇒ partial');

  // 参照日已在下一周 ⇒ 该 bar 所在周已走完
  const after = resolveMarketEnvProvenance(rows, { reference_date: '2026-09-30', calendar: CAL });
  assert.strictEqual(after.market_env_partial_week, false, '该周已走完 ⇒ 非 partial');
});

test('C.3 trade_day_lag 用 calendar 计算，与自然日差**不同**', () => {
  const rows = [envRow('000300', ['2026-09-25'])];
  const p = resolveMarketEnvProvenance(rows, { reference_date: '2026-10-12', calendar: CAL });
  // 2026-09-25 → 2026-10-12：自然日 17 天；交易日 = 09-28,29,30 + 10-08,09,12 = 6 天
  assert.strictEqual(p.natural_day_lag_diagnostic, 17, '自然日差仍作为**诊断**字段存在');
  assert.strictEqual(p.trade_day_lag, 6, 'policy 用的 lag 必须是交易日');
  assert.strictEqual(p.lag_basis, 'calendar_trade_days');
  assert.strictEqual(p.natural_day_lag_usable_for_policy, false, '自然日差不得用于 policy');
});

test('C.4 无 calendar ⇒ trade_day_lag = null（⛔ 绝不用自然日冒充）', () => {
  const rows = [envRow('000300', ['2026-09-25'])];
  const p = resolveMarketEnvProvenance(rows, { reference_date: '2026-10-12' });
  assert.strictEqual(p.trade_day_lag, null);
  assert.strictEqual(p.lag_basis, 'UNAVAILABLE');
  assert.strictEqual(p.natural_day_lag_diagnostic, 17);
  const biz = new Error('自然日差不得被当作交易日 lag');
  if (p.lag_basis !== 'UNAVAILABLE') throw biz;
});

test('C.5 行级 trade_date 兜底；完全无日期 ⇒ null（不编造）', () => {
  const viaRow = resolveMarketEnvProvenance(
    [{ index_code: '399006', trade_date: '2026-09-25', weekly_bars: [] }],
    { reference_date: '2026-09-30', calendar: CAL }
  );
  assert.strictEqual(viaRow.market_env_as_of_date, '2026-09-25');
  assert.strictEqual(viaRow.per_index[0].date_origin, 'row.trade_date');

  const none = resolveMarketEnvProvenance(
    [{ index_code: '399006', weekly_bars: [{ close: 1 }, { close: 2 }] }],
    { reference_date: '2026-09-30', calendar: CAL }
  );
  assert.strictEqual(none.market_env_as_of_date, null);
  assert.strictEqual(none.per_index[0].bar_count, 0);
  assert.strictEqual(extractBarDates({}).origin, null);
});

test('C.6 market_env 是 optional 源 ⇒ 不因它 BLOCK 完整 run', () => {
  const p = resolveMarketEnvProvenance([], { reference_date: '2026-09-30', calendar: CAL });
  assert.strictEqual(p.optional_source, true);
  assert.strictEqual(p.blocks_run, false);
  assert.strictEqual(p.market_env_as_of_date, null);
});

/* ------------------------------------------------------------------ *
 * 异步用例 + 汇总
 * ------------------------------------------------------------------ */
(async () => {
  for (const c of asyncCases) {
    try {
      await c.fn();
      passed += 1;
      console.log(`  \u2713 ${c.name}`);
    } catch (e) {
      failed += 1;
      failures.push({ name: c.name, err: e });
      console.log(`  \u2717 ${c.name}`);
      console.log(`      ${e && e.message}`);
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) {
    failures.forEach((f) => console.log(`  \u2717 ${f.name}: ${f.err && f.err.message}`));
    process.exit(1);
  }
})();
