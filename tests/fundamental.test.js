/**
 * 基本面：黄金反向、周评聚合、SEC 硬数字、重仓解析
 * 运行：node tests/fundamental.test.js
 */
'use strict';
const assert = require('assert');
const fund = require('../src/common/utils/fundamental.js');
const { parseHoldingRow } = require('../src/common/utils/holdings-parse.js');
const ox = require('../src/common/utils/overseas-filings.js');
const bio = require('../src/common/utils/biotech-intel.js');
const { FINANCIAL_CONDUCTION_MAP, SEC_FINANCIAL_TICKERS } = require('../src/common/constants.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ✓ ${name}`); }
  catch (e) { failed += 1; console.log(`  ✗ ${name}\n      ${e.message}`); }
}

console.log('════════ 基本面自动判定 ════════\n');

test('黄金利率升 → 信号为负', () => {
  const row = { value: 2.0, prev: 1.5, direction: 'up' };
  const cfg = { code: '518880', indicator: 'real_rate', metric_type: 'quantitative', signal_invert: true };
  const s = fund.indicatorSignal(row, cfg);
  assert.ok(s < 0, `利率升应对黄金为负，实际 ${s}`);
});

test('美元升 → 信号为负（即使没写 signal_invert，按代码清单）', () => {
  const row = { value: 104, prev: 100, direction: 'up' };
  const cfg = { code: '518880', indicator: 'dollar_index', metric_type: 'quantitative' };
  const s = fund.indicatorSignal(row, cfg);
  assert.ok(s < 0, `美元升应对黄金为负，实际 ${s}`);
});

test('DRAM 涨价仍为正', () => {
  const row = { value: 3.6, prev: 3.0, direction: 'up' };
  const cfg = { code: '513310', indicator: 'dram_price', metric_type: 'quantitative' };
  const s = fund.indicatorSignal(row, cfg);
  assert.ok(s > 0, `DRAM 涨应为正，实际 ${s}`);
});

test('周评加权：15% 持股 grade5 压过赛道 grade2', () => {
  const g = fund.aggregateQualitative([
    { grade: 5, confidence: 0.8, weight: 15, source: 'deepseek' },
    { grade: 2, confidence: 0.6, weight: 8, source: 'deepseek' }
  ]);
  assert.ok(g >= 4, `应偏向很好/较好，实际 ${g}`);
});

test('人工否决覆盖周评', () => {
  const g = fund.aggregateQualitative([
    { grade: 5, confidence: 0.9, weight: 15, source: 'deepseek' },
    { grade: 2, confidence: 0.95, weight: 1, source: 'manual_veto' }
  ]);
  assert.strictEqual(g, 2);
});

test('SEC 五家云厂 CapEx 求和（亿美元）', () => {
  const by = {
    usMSFT: { capex_ytd: 2e10 },
    usGOOGL: { capex_ytd: 1e10 },
    usAMZN: { capex_ytd: 1e10 },
    usMETA: { capex_ytd: 5e9 },
    usORCL: { capex_ytd: 5e9 }
  };
  const spec = fund.SEC_HARD_SPECS.find((s) => s.indicator === 'cloud_capex');
  const v = fund.materializeSecValue(spec, by);
  assert.strictEqual(v, 500);
});

test('硬数据保护含 capex/cloud_capex', () => {
  assert.ok(fund.isHardData('513310', 'capex'));
  assert.ok(fund.isHardData('515880', 'cloud_capex'));
  assert.ok(!fund.isHardData('515880', 'optical_800g'));
  assert.ok(fund.isQualitative('159570', 'approval_export'));
});

test('重仓解析：A 股 / 韩股 / 港股', () => {
  const a = parseHoldingRow("<td>1</td><td><a href='//quote.eastmoney.com/unify/r/0.300502'>300502</a></td><td class='tol'><a href='//quote.eastmoney.com/unify/r/0.300502'>新易盛</a></td><td class='tor'>15.60%</td>");
  assert.ok(a && a.stock_code === '300502' && a.stock_name === '新易盛' && a.weight === 15.6 && a.market === 'cn');
  const kr = parseHoldingRow("<td>1</td><td class='toc'><span data-texch=''>000660</span></td><td class='toc' style='line-height:18px'><span>SK海力士</span></td><td class='toc'>15.82%</td>");
  assert.ok(kr && kr.stock_code === '000660' && kr.stock_name === 'SK海力士' && kr.market === 'kr');
  const hk = parseHoldingRow("<td>1</td><td><a href='//quote.eastmoney.com/unify/r/116.01801'>01801</a></td><td class='tol'><a href='//quote.eastmoney.com/unify/r/116.01801'>信达生物</a></td><td class='tor'>10.38%</td>");
  assert.ok(hk && hk.stock_code === '01801' && hk.market === 'hk');
});

test('港股代码补位 / 韩股代码补位', () => {
  assert.strictEqual(ox.padHkCode('1801'), '01801');
  assert.strictEqual(ox.padHkCode('01801'), '01801');
  assert.strictEqual(ox.padKrCode('660'), '000660');
});

test('港交所 prefix / 标题检索解析', () => {
  const meta = ox.parseHkexPrefix('callback({"more":"1","stockInfo":[{"stockId":202911,"code":"01801","name":"信達生物"}]});');
  assert.ok(meta && meta.stockId === '202911' && meta.code === '01801');
  const rows = ox.parseHkexSearch(JSON.stringify({
    result: JSON.stringify([{
      TITLE: '內幕消息公告 - 產品收入', STOCK_NAME: '信達生物', STOCK_CODE: '01801',
      DATE_TIME: '05/08/2026 08:00', FILE_LINK: '/listedco/x.pdf', LONG_TEXT: '公告及通告 - [內幕消息]'
    }])
  }));
  assert.strictEqual(rows.length, 1);
  assert.ok(rows[0].title.indexOf('產品收入') >= 0);
  assert.ok(!ox.isHkexNoise(rows[0]));
  assert.ok(ox.isHkexNoise({ title: '截至2026年7月31日止月份之股份發行人的證券變動月報表' }));
});

test('港股营运收入取最新年报同比', () => {
  const picked = ox.pickHkOperatingIncome([
    { STD_ITEM_CODE: '004001999', REPORT_DATE: '2025-12-31 00:00:00', DATE_TYPE_CODE: '001', YOY_RATIO: 38.417, AMOUNT: 13041523000, CURRENCY: '人民币' },
    { STD_ITEM_CODE: '004001999', REPORT_DATE: '2025-06-30 00:00:00', DATE_TYPE_CODE: '002', YOY_RATIO: 50.62, AMOUNT: 5953094000, CURRENCY: '人民币' }
  ]);
  assert.ok(picked && picked.period_end === '2025-12-31');
  assert.strictEqual(picked.revenue_yoy, 38.42);
});

test('159570 龙头收入按港股持仓加权', () => {
  const yoy = ox.materializeHoldingsYoy(
    [{ stock_code: '01801', weight: 10, market: 'hk' }, { stock_code: '06160', weight: 10, market: 'hk' }],
    { hk01801: { revenue_yoy: 40 }, hk06160: { revenue_yoy: 20 } }
  );
  assert.strictEqual(yoy, 30);
});

test('DART 披露与科目解析', () => {
  const list = ox.parseDartList({
    status: '000',
    list: [{ report_nm: 'Quarterly Report', corp_name: 'SK hynix', rcept_dt: '20260810', rcept_no: '1' }]
  });
  assert.strictEqual(list.length, 1);
  const fin = ox.pickDartAccounts([
    { account_nm: '매출액', thstrm_amount: '200000', frmtrm_amount: '100000', thstrm_dt: '2025-12-31' },
    { account_nm: '당기순이익', thstrm_amount: '80', frmtrm_amount: '40' }
  ]);
  assert.strictEqual(fin.revenue_yoy, 100);
  assert.strictEqual(fin.net_income_yoy, 100);
});

test('159570 持仓别名按代码/中文名匹配，不写死十大', () => {
  const a = bio.matchBiotechAlias({ stock_code: '1801', stock_name: '信达生物-B' });
  assert.ok(a && a.hk === '01801' && a.sponsors[0] === 'Innovent');
  const b = bio.matchBiotechAlias({ stock_code: '06160', stock_name: '百济神州' });
  assert.ok(b && b.sec && b.sec.symbol === 'usBGNE' && b.brands.indexOf('BRUKINSA') >= 0);
  assert.ok(!bio.matchBiotechAlias({ stock_code: '000660', stock_name: 'SK海力士' }));
});

test('东财 JSONP 解析并过滤非事件稿', () => {
  const rows = bio.parseEastmoneySearchJsonp('cb({"result":{"cmsArticleWebOld":[{"title":"<em>信达生物</em>CDE 受理新适应症","date":"2026-08-21 14:26:00","url":"http://x","code":"1","content":"获批进展","mediaName":"证券时报"}]}});');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].title, '信达生物CDE 受理新适应症');
  assert.ok(bio.isBiotechEvent(rows[0]));
  assert.ok(!bio.isBiotechEvent({ title: '信达生物成立创投合伙企业', summary: '苏州国资' }));
  assert.ok(bio.inDateWindow(rows[0].time, '2026-08-20', '2026-08-23'));
});

test('ClinicalTrials / openFDA 解析与标题', () => {
  const trials = bio.parseClinicalTrials({
    studies: [{
      protocolSection: {
        identificationModule: { nctId: 'NCT07100938', briefTitle: 'BGB-45035 vs Placebo' },
        statusModule: { overallStatus: 'TERMINATED', lastUpdatePostDateStruct: { date: '2026-05-28' } },
        sponsorCollaboratorsModule: { leadSponsor: { name: 'BeiGene' } },
        designModule: { phases: ['PHASE2'] },
        conditionsModule: { conditions: ['Rheumatoid Arthritis'] }
      }
    }]
  });
  assert.strictEqual(trials.length, 1);
  assert.ok(bio.formatTrialTitle(trials[0]).indexOf('[临床]') === 0);
  const fda = bio.parseOpenFda({
    results: [{
      sponsor_name: 'BEONE MEDICINES USA',
      application_number: 'NDA213217',
      openfda: { brand_name: ['BRUKINSA'] },
      submissions: [{
        submission_type: 'SUPPL',
        submission_status: 'AP',
        submission_status_date: '20260801',
        application_docs: [{ url: 'https://fda.example/letter.pdf', type: 'Letter' }]
      }]
    }]
  });
  assert.strictEqual(fda[0].brand, 'BRUKINSA');
  assert.ok(bio.inYmdWindow(fda[0].statusDate, '2026-08-01', '2026-08-23'));
  assert.ok(bio.formatFdaTitle(fda[0]).indexOf('[FDA]') === 0);
  assert.deepStrictEqual(bio.parseOpenFda({ error: { code: 'NOT_FOUND' } }), []);
});

test('双上市 SEC 只传导 159570 定性，不进龙头收入硬格子', () => {
  ['usBGNE', 'usZLAB', 'usHCM'].forEach((sym) => {
    assert.deepStrictEqual(FINANCIAL_CONDUCTION_MAP[sym]['159570'], ['core_sales', 'bd_licensing', 'approval_export']);
    assert.ok(SEC_FINANCIAL_TICKERS.some((t) => t.symbol === sym));
  });
  assert.ok(fund.isHardData('159570', 'leading_revenue'));
  assert.ok(fund.isQualitative('159570', 'approval_export'));
});

test('硬格子优先抓取源，不被更新的 LLM 分盖住', () => {
  const row = fund.pickLatestSeries([
    { value: 80, source: 'sec', data_date: '2026-08-23' },
    { value: 38.4, source: 'hk_income', data_date: '2025-12-31' }
  ], { code: '159570', indicator: 'leading_revenue', metric_type: 'quantitative' });
  assert.ok(row && row.value === 38.4);
});

test('159570 硬格子没有港股源时不回退礼来', () => {
  const row = fund.pickLatestSeries([
    { value: 80, source: 'sec', data_date: '2026-08-23', note: 'LLY:礼来营收高增长' }
  ], { code: '159570', indicator: 'leading_revenue', metric_type: 'quantitative' });
  assert.strictEqual(row, null);
});

test('翰森/药明康德别名可匹配，鲁抗不在宇宙', () => {
  const hansoh = bio.matchBiotechAlias({ stock_code: '3692', stock_name: '翰森制药' });
  assert.ok(hansoh && hansoh.products.indexOf('阿美替尼') >= 0);
  const wuxi = bio.matchBiotechAlias({ stock_code: '02359', stock_name: '药明康德' });
  assert.ok(wuxi && wuxi.products.indexOf('CRO') >= 0);
  assert.ok(bio.isOffUniverseBiotech('鲁抗医药原料药上市批准'));
  assert.ok(!bio.isCoreSalesAllowed({ title: '鲁抗医药原料药获批', stock_name: '' }));
  assert.ok(!bio.isCoreSalesAllowed({ title: '创新药获批', stock_name: '鲁抗医药', stock_code: '600789' }));
  assert.ok(bio.isCoreSalesAllowed({ title: '泽布替尼销售额超预期', stock_name: '百济神州', stock_code: '06160' }));
});

test('159570 定性依据含鲁抗则跳过', () => {
  const row = fund.pickLatestSeries([
    { value: 5, source: 'llm_week', note: '鲁抗医药原料药上市批准' },
    { value: 3, source: 'llm_week', note: '百济神州：泽布替尼放量' }
  ], { code: '159570', indicator: 'core_sales', metric_type: 'qualitative' });
  assert.ok(row && row.value === 3);
});

test('159570 定性依据含礼来则跳过', () => {
  const row = fund.pickLatestSeries([
    { value: 4, source: 'sec', note: 'LLY:礼来业绩强劲' },
    { value: 3, source: 'llm_week', note: '信达核心产品放量' }
  ], { code: '159570', indicator: 'core_sales', metric_type: 'qualitative' });
  assert.ok(row && row.value === 3);
});

test('515880 已切 AAOI 的依据不展示', () => {
  const row = fund.pickLatestSeries([
    { value: 60, source: 'sec', unit: '分', note: 'AAOI:毛利率提升' },
    { value: 4, source: 'llm_week', note: '新易盛800G订单' }
  ], { code: '515880', indicator: 'asp', metric_type: 'qualitative' });
  assert.ok(row && row.value === 4);
});

test('硬格子只认抓取源，不把 sec 80分当 CapEx', () => {
  const row = fund.pickLatestSeries([
    { value: 80, source: 'sec', unit: '分', data_date: '2026-08-23', note: 'MU:美光CapEx' },
    { value: 19.6, source: 'sec_hard', unit: '亿美元', data_date: '2025-08-28' }
  ], { code: '513310', indicator: 'capex', metric_type: 'quantitative' });
  assert.ok(row && row.value === 19.6 && row.source === 'sec_hard');
});

test('冻结：礼来/苹果等不再进入 F，513310 硬 CapEx 仍只美光', () => {
  assert.ok(!FINANCIAL_CONDUCTION_MAP.usLLY);
  assert.ok(!FINANCIAL_CONDUCTION_MAP.usAAPL);
  assert.ok(!FINANCIAL_CONDUCTION_MAP.usTSLA);
  assert.ok(!FINANCIAL_CONDUCTION_MAP.usQCOM);
  assert.ok(!SEC_FINANCIAL_TICKERS.some((t) => t.symbol === 'usLLY'));
  const capex = fund.SEC_HARD_SPECS.find((s) => s.code === '513310' && s.indicator === 'capex');
  assert.deepStrictEqual(capex.symbols, ['usMU']);
  assert.ok(!fund.SEC_HARD_SPECS.some((s) => s.code === '159570'));
});

test('缺集合报错形态可识别（线上 etf_holdings ResourceNotFound）', () => {
  const missing = '[ResourceNotFound] Db or Table not exist: etf_holdings. Please check your reques';
  const exists = '[ResourceUnavailable.ResourceExist] Table exist. DATABASE_COLLECTION_ALREADY_EXIST';
  assert.ok(/ResourceNotFound/i.test(missing) && /Table not exist/i.test(missing));
  assert.ok(/ResourceExist|ALREADY_EXIST/i.test(exists) && !/Table not exist/i.test(exists));
});

test('每只 ETF 在用指标权重合计 100', () => {
  const codes = ['513310', '515880', '159582', '518880', '159570'];
  codes.forEach((code) => {
    const sum = fund.FUNDAMENTAL_TEMPLATES.filter((t) => t.code === code).reduce((a, t) => a + t.weight, 0);
    assert.strictEqual(sum, 100, `${code} 权重 ${sum} ≠ 100`);
  });
});

console.log(`\n通过 ${passed}  失败 ${failed}`);
if (failed) process.exit(1);
