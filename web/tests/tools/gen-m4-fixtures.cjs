/**
 * M4 fixture 生成器（**入库**：web/tests/tools/gen-m4-fixtures.cjs）
 *
 * 产出：web/tests/fixtures/m4/*.json（17 个 fixture + _meta.json）
 *
 * ── 定位（owner 裁定 M4-D4）──────────────────────────────────────────
 *   ✅ 本文件入库：它是**可重复测试资产**的生成器。
 *   ⛔ `_v365-fe-audit-20260930/live/**`（含 recheck_kline_*.json）**不入库**：
 *      那是**本轮现场审计证据**，不是产品测试 fixture。
 *   ⇒ 规则：**fixture = 可复现资产；live recheck = 现场证据**，两者分开。
 *
 * ── 依赖（全部已入库，故本文件可独立复现）───────────────────────────
 *   web/tests/fixtures/live-legacy/etf-513310.json   线上实测响应（只读抓取的原样保存）
 *   web/tests/fixtures/live-legacy/kline-513310.json 同上（K 线）
 *   web/tests/fixtures/canonical/etf-513310.json     后端权威契约模块实跑产出
 *
 *   ⚠️ 已知的**上游复现断点**（诚实标注，⛔ 本轮不扩大范围处理）：
 *      `canonical/*.json` 由 M2 的生成器 `gen-m2-fixtures.cjs` 调用
 *      `src/common/utils/gen1-ui-view-model.js` 实跑产出；那个脚本目前**仍在工作区根未入库**
 *      ⇒ 本文件可复现「由 canonical 派生的变体」，但**不能**从零重造 canonical 本身。
 *      已登记于 docs/V365_M4_ETF_WORKBENCH_CONTRACT.md §E（M4-D4 尾注）。
 *
 * ── 原则（与 M2 一致）────────────────────────────────────────────────
 *   1. **canonical 类** 由后端权威契约实跑产出复制而来，⛔ 不手写形状；
 *   2. **normal 类** 直接复制线上实测响应，⛔ 不改一个字节；
 *   3. **变体类**（target / risk / malformed / missing）在正常文档上做**定点突变**，
 *      并写成**最小文档**（只保留 adapter 需要的块），便于人工核对突变点。
 *
 * ── 用法 ─────────────────────────────────────────────────────────────
 *   node web/tests/tools/gen-m4-fixtures.cjs           # 重新生成（覆盖写）
 *   node web/tests/tools/gen-m4-fixtures.cjs --check   # 只校验磁盘产物与本脚本一致（⛔ 不写盘）
 *                                                      # 不一致 ⇒ 退出码 1（可作回归门禁）
 */
'use strict';
const fs = require('fs');
const path = require('path');

/** web/ 根（本文件位于 web/tests/tools/） */
const WEB = path.resolve(__dirname, '..', '..');
const SRC = path.join(WEB, 'tests', 'fixtures');
const OUT = path.join(SRC, 'm4');
const CHECK_ONLY = process.argv.includes('--check');

const read = (p) => JSON.parse(fs.readFileSync(path.join(SRC, p), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));

/** 产物缓存：name → { body, bytes }；写盘与 --check 共用同一条生成路径 */
const pending = {};
let totalBytes = 0;

function emit(name, obj) {
  const body = JSON.stringify(obj, null, 2) + '\n';
  pending[name] = body;
  totalBytes += Buffer.byteLength(body, 'utf8');
  return Buffer.byteLength(body, 'utf8');
}

/* ═══════════ 输入 ═══════════ */

const LIVE = read('live-legacy/etf-513310.json');      // 线上实测（未改动）
const CANON = read('canonical/etf-513310.json');       // 后端契约实跑产出
const KLINE60 = read('live-legacy/kline-513310.json'); // 线上实测（尾部 60 根）

const meta = {};

/* ============ 1. normal（线上原样） ============ */
emit('etf-normal.json', LIVE);
meta['etf-normal.json'] = {
  scenario: 'normal',
  origin: 'live-legacy/etf-513310.json（线上 /api/etf/513310 实测，逐字节复制）',
  expect: '全部块可读；Gen-1 走 decision.gen1_* + ml_shadow（legacy 通道）'
};

/* ============ 2. canonical（契约在场） ============ */
emit('etf-canonical.json', CANON);
meta['etf-canonical.json'] = {
  scenario: 'canonical',
  origin: 'canonical/etf-513310.json（由 src/common/utils/gen1-ui-view-model.js 实跑产出）',
  expect: 'production / gen1 / system_runtime / legacy 四块在场 → Gen-1 走 canonical 通道'
};

/* ============ 3. canonical 字段为 null ============ */
const canonNull = clone(CANON);
canonNull.production.final_target_pct = null;
canonNull.production.risk_flag = null;
canonNull.gen1.signal.probability = null;
canonNull.gen1.stages.effective = null;
canonNull.system_runtime.gen2.production_write = null;   // 已知三态
emit('etf-canonical-null.json', canonNull);
meta['etf-canonical-null.json'] = {
  scenario: 'null-in-contract',
  origin: 'etf-canonical.json 的定点突变',
  mutated: ['production.final_target_pct=null', 'production.risk_flag=null',
    'gen1.signal.probability=null', 'gen1.stages.effective=null', 'system_runtime.gen2.production_write=null'],
  expect: '一律 MISSING / NULL_IN_CONTRACT，⛔ 不得 fallback 掩盖、⛔ 不得当 0'
};

/* ============ 4. decision 整块缺失 ============ */
const noDecision = clone(LIVE);
delete noDecision.decision;
emit('etf-decision-missing.json', noDecision);
meta['etf-decision-missing.json'] = {
  scenario: 'decision-missing',
  origin: 'etf-normal.json 删除 decision',
  expect: 'decision.available=false；仓位/动作/评分/决策链全部显式「数据未提供」'
};

/* ============ 5. Gen-1 无任何来源 ============ */
const noGen1 = clone(LIVE);
for (const k of Object.keys(noGen1.decision || {})) {
  if (/^gen1_|^ml_rule_|^eod_precheck|^v361_baseline/.test(k)) delete noGen1.decision[k];
}
delete noGen1.ml_shadow;                 // 旧 Gen-1 的唯一载体
delete noGen1.production; delete noGen1.gen1; delete noGen1.system_runtime;   // live 本就没有，显式确保
emit('etf-gen1-missing.json', noGen1);
meta['etf-gen1-missing.json'] = {
  scenario: 'gen1-missing',
  origin: 'etf-normal.json 删除 decision.gen1_* + ml_shadow',
  expect: 'Gen-1 层**三级全空** ⇒ 显示「数据未提供」，⛔ 不得显示「正常 / 无信号 / 关闭」'
};

/* ============ 6. stale（快照与决策都很旧） ============ */
const stale = clone(LIVE);
stale.snapshot.calc_date = '2020-01-01';
stale.decision.decision_date = '2020-01-01';
emit('etf-stale.json', stale);
meta['etf-stale.json'] = {
  scenario: 'stale',
  origin: 'etf-normal.json 定点突变日期',
  mutated: ['snapshot.calc_date=2020-01-01', 'decision.decision_date=2020-01-01'],
  expect: '★ 决策 freshness=STALE；但 **K 线 freshness 独立判定**（两者⛔ 不得合并为一个「数据日期」）'
};

/* ============ 7. malformed（畸形可选字段） ============ */
const malformed = {
  basic: { code: '513310', name: null, sector: 'storage', max_position: 30 },
  snapshot: 'should-be-object',
  decision: {
    code: '513310',
    decision_date: 20260929,                 // 数字日期
    final_target: '0.5',                     // 字符串数字
    target_min: null,
    scores: 'not-an-object',
    explain_chain: 'not-an-array',
    add_eligibility: null,
    over_alloc_status: '',
    risk_flag: 'NORMAL'
  },
  position: [],                              // 数组而非对象
  risk_events: 'not-an-array',
  ml_shadow: 42,
  fundamental: null,
  holdings: null,
  holdings_date: null
};
emit('etf-malformed.json', malformed);
meta['etf-malformed.json'] = {
  scenario: 'malformed',
  origin: '手写（最小文档）',
  expect: '⛔ 不抛异常；逐字段降级为显式缺失或原值透传；页面不得出现 undefined / NaN / [object Object]'
};

/* ============ 8/9/10. target 三档（0 / 0.5 / 28.5） ============ */
function minimalWithTarget(finalTarget, band) {
  return {
    basic: { code: '513310', name: '中韩半导体ETF(QDII)', sector: 'storage', is_qdii: true, max_position: 30, target_position: 25, status: 'enable' },
    snapshot: { code: '513310', calc_date: '2026-09-29', w_state: 'W4', d_state: 'D5', h_state: 'H4', v_state: 'V1', price_position: 0.3032, change_5d: -4.09, data_complete: true },
    decision: {
      code: '513310', decision_date: '2026-09-29',
      final_action: 'HOLD', action_label: '持有', risk_flag: 'NORMAL',
      final_target: finalTarget,
      target_min: band[0], target_std: band[1], target_max: band[2],
      position_gap: 0, over_alloc_status: 'normal', binding_constraint: 'none',
      scores: { trend: 5, volume: 25, fundamental: 20, crowding: 15, risk: 10, total: 75 },
      opportunity_score: 67, opportunity_grade: 'B',
      stage_factor: 0, market_factor: 0.25,
      explain_chain: [{ step: 1, condition: '市场环境 防守', result: '维持' }]
    },
    position: { code: '513310', current_position: 0, target_position: 25, max_position: 30, target_min: 20, target_std: 25, target_max: 30 },
    risk_events: [],
    fundamental: { code: '513310', f_state: 'F2', f_score: 20, updated_at: '2026-09-30T00:00:57.827Z' },
    holdings: [], holdings_date: null
  };
}
emit('etf-target-0.json', minimalWithTarget(0, [0, 0, 0]));
meta['etf-target-0.json'] = {
  scenario: 'target=0',
  origin: '最小文档',
  expect: '`0` 是**合法值** ⇒ 渲染 `0.0%` 且 missing=false（⛔ 不得当缺失、⛔ 不得显示「—」）'
};
emit('etf-target-0p5.json', minimalWithTarget(0.5, [0.4, 0.5, 0.5]));
meta['etf-target-0p5.json'] = {
  scenario: 'target=0.5',
  origin: '最小文档（与线上 513310 同值）',
  expect: '`0.5` ⇒ `0.5%`（⛔ 绝不是 50%）；同时校验 `market_factor=0.25` 是**系数**不得显示成 25%'
};
emit('etf-target-28p5.json', minimalWithTarget(28.5, [27, 28.5, 30]));
meta['etf-target-28p5.json'] = {
  scenario: 'target=28.5',
  origin: '最小文档（历史实测出现过的最大值）',
  expect: '`28.5` ⇒ `28.5%`（与 0.5 同一 formatter，⛔ 不得出现任何量级分支）'
};

/* ============ 11/12/13. risk 变体 ============ */
function minimalWithRisk(riskFlag, override, withEvent) {
  const d = minimalWithTarget(8, [7, 8, 9]);
  d.decision.risk_flag = riskFlag;
  d.decision.risk_override = override;
  d.decision.final_action = riskFlag === 'RED' ? 'EXIT' : 'HOLD';
  d.decision.action_label = riskFlag === 'RED' ? '清仓' : '持有';
  d.decision.position_gap = riskFlag === 'RED' ? 8 : 0;
  if (withEvent) {
    d.risk_events = [{
      _id: 'evt-1', code: '513310', event_type: 'MANUAL', risk_flag: riskFlag,
      risk_override: override, status: 'ACTIVE', reason: '手工登记：测试用风险事件',
      note: null, trigger_time: '2026-09-30T09:00:00.000Z'
    }];
  }
  return d;
}
emit('etf-risk-normal.json', minimalWithRisk('NORMAL', false, false));
meta['etf-risk-normal.json'] = { scenario: 'risk=normal', origin: '最小文档', expect: '风控绿；无风险条' };
emit('etf-risk-yellow.json', minimalWithRisk('YELLOW', false, true));
meta['etf-risk-yellow.json'] = { scenario: 'risk=yellow', origin: '最小文档 + 1 条 ACTIVE 事件', expect: '风控黄；显示事件原因' };
emit('etf-risk-red.json', minimalWithRisk('RED', true, true));
meta['etf-risk-red.json'] = { scenario: 'risk=red+override', origin: '最小文档 + 1 条 ACTIVE 事件', expect: '风控红；覆盖标记可见' };
/* ★ 中文风险值（线上 dashboard 实测为「正常」） */
const riskCn = minimalWithRisk('NORMAL', false, false);
riskCn.decision.risk_flag = '正常';
emit('etf-risk-cn.json', riskCn);
meta['etf-risk-cn.json'] = {
  scenario: 'risk=中文值',
  origin: '最小文档（risk_flag="正常"，与 /api/dashboard 线上实测同形态）',
  expect: '归一后仍为风控绿（⛔ 不得因中文而掉成 muted）'
};

/* ============ 14/15/16. kline 变体 ============ */
emit('kline-empty.json', []);
meta['kline-empty.json'] = { scenario: 'kline-empty', origin: '空数组', expect: '合法值（0 根）⇒ 显示「无行情数据」，⛔ 不得当缺失/错误' };
emit('kline-error.json', { not: 'an array' });
meta['kline-error.json'] = { scenario: 'kline-error', origin: '对象而非数组', expect: '显式 MISSING，不抛异常' };
emit('kline-live60.json', KLINE60);
meta['kline-live60.json'] = {
  scenario: 'kline-live',
  origin: 'live-legacy/kline-513310.json（线上实测尾部 60 根）',
  expect: '★ 线上 K 线末端为 2024-08-27（见 KLINE-DATA-001）⇒ 渲染时必须显著标注 K 线自身时点；'
        + '⛔ 不得与 decision freshness 合并，⛔ 不得因 stale 而隐藏历史数据'
};

/* ============ _meta.json ============ */
const metaBody = JSON.stringify({
  generated_by: 'web/tests/tools/gen-m4-fixtures.cjs（✅ 入库，可复现；--check 可校验）',
  supersedes: '_v365-fe-audit-20260930/tools/gen-m4-fixtures.cjs（M4-P0 现场副本，⛔ 不入库）',
  generated_at: '2026-09-30',
  base_sha: '8c6f78e',
  note: 'fixture 均为**响应 data**（不含 {code,data,message} 信封），与 M2 约定一致',
  files: meta
}, null, 2) + '\n';
pending['_meta.json'] = metaBody;

/* ═══════════ 落盘 / 校验 ═══════════ */

const names = Object.keys(pending).sort();

if (CHECK_ONLY) {
  const drift = [];
  for (const n of names) {
    const p = path.join(OUT, n);
    if (!fs.existsSync(p)) { drift.push(n + '（缺失）'); continue; }
    if (fs.readFileSync(p, 'utf8') !== pending[n]) drift.push(n + '（内容不一致）');
  }
  const onDisk = fs.existsSync(OUT) ? fs.readdirSync(OUT).filter((f) => f.endsWith('.json')).sort() : [];
  for (const f of onDisk) if (!pending[f]) drift.push(f + '（磁盘多余）');
  if (drift.length) {
    console.error('✗ --check 失败：' + drift.length + ' 项与生成器不一致');
    for (const d of drift) console.error('    - ' + d);
    process.exit(1);
  }
  console.log('✓ --check 通过：' + names.length + ' 个产物与生成器逐字节一致（未写盘）');
  process.exit(0);
}

fs.mkdirSync(OUT, { recursive: true });
let bytes = 0;
for (const n of names) {
  fs.writeFileSync(path.join(OUT, n), pending[n]);
  bytes += Buffer.byteLength(pending[n], 'utf8');
}
console.log('生成 ' + names.length + ' 个产物（' + bytes + ' B）:');
for (const n of names) {
  console.log('  ' + String(Buffer.byteLength(pending[n], 'utf8')).padStart(7) + ' B  ' + n);
}
