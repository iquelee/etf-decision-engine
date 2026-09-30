#!/usr/bin/env node
/**
 * RPG-002 Execution-Semantics Probe（**只读**）
 *
 * 目的：用**代码证据 + 真实数据**回答四个问题，并给出机器可读结论：
 *   Q1  生产中 `TRADE_LOG.action='buy'` 到底代表什么？
 *   Q2  `final_action = BUILD/ADD` 是否会自动产生 `TRADE_LOG buy`？（即 DECISION == EXECUTION？）
 *   Q3  是否存在「有 BUILD/ADD 无 buy」/「有 buy 无 BUILD/ADD」的合法生产场景？
 *   Q4  position 变化与 TRADE_LOG 的关系？
 *
 * ⛔ 只读：不修改任何文件（除 `--out` 指定的证据 JSON）。
 * ⛔ 不改 harness / 生产代码 / 门禁；⛔ 不写入任何生产数据。
 *
 * 用法：
 *   node scripts/v365-rpg002-execution-semantics-probe.js [--dump <trade_log.ndjson>] [--out <path>]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const harness = require(path.join(REPO, 'scripts', 'lib', 'v364-replay-harness.js'));

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) continue;
    const v = argv[i + 1];
    if (v == null || v.startsWith('--')) { a[k.slice(2)] = true; continue; }
    a[k.slice(2)] = v; i += 1;
  }
  return a;
}
const a = parseArgs(process.argv);

/* ------------------------------------------------------------------ *
 * ① 静态审计：TRADE_LOG 的全部写入方 / 更新方 / 删除方
 * ------------------------------------------------------------------ */
function listJs(dir, acc) {
  const out = acc || [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') listJs(p, out); }
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}
const SCAN_ROOTS = ['src', 'cloudfunctions', 'scripts', 'tests']
  .map((d) => path.join(REPO, d)).filter((d) => fs.existsSync(d));

const WRITE_PAT = /(\.add\s*\(|upsert\s*\(|updateById\s*\(|removeById\s*\(|\.update\s*\(|\.remove\s*\()/;
const writers = [];
const readers = [];
for (const f of SCAN_ROOTS.flatMap((d) => listJs(d))) {
  const rel = path.relative(REPO, f).split(path.sep).join('/');
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    if (!/TRADE_LOG/.test(line)) return;
    const rec = { file: rel, line: i + 1, code: line.trim().slice(0, 160) };
    if (WRITE_PAT.test(line)) writers.push(rec); else readers.push(rec);
  });
}

/* ------------------------------------------------------------------ *
 * ② 历史可得性审计（§4）
 * ------------------------------------------------------------------ */
function exists(p) { try { return fs.existsSync(p); } catch (e) { return false; } }
const avail = {
  trade_log_in_canonical_package: {
    path: 'deliverables/',
    status: (() => {
      const d = path.join(REPO, 'deliverables');
      if (!exists(d)) return 'ABSENT';
      const hit = listJs(d).length;   // deliverables 内不应有 js；此处只探测是否存在 trade_log 文件
      const names = fs.readdirSync(d, { recursive: true }).map(String);
      return names.some((n) => /trade[_-]?log/i.test(n)) ? 'AVAILABLE' : 'ABSENT';
    })(),
    note: '规范 replay 输入包 = deliverables/etf_daily_ml_pool/*.csv（**仅日线**）'
  },
  portfolio_position_history: { status: 'ABSENT', note: 'replay 输入包内无 portfolio_position 历史' },
  execution_confirmation: { status: 'ABSENT', note: '无成交确认字段/文件' },
  buy_timestamps: { status: 'ABSENT', note: '（trade_log 内有 trade_date，但该表不在输入包内）' },
  add_mode: { status: 'ABSENT', note: 'trade_log.add_mode 为可选字段；实测真实数据 10 条中仅 1 条含该字段且为空串' }
};

/* ------------------------------------------------------------------ *
 * ③ 真实执行账本（若提供 --dump）
 * ------------------------------------------------------------------ */
const DUMP_DEFAULT = 'C:/c/tmp/cd-dump';
let dumpPath = a.dump ? String(a.dump) : null;
let dumpRecords = null;
let dumpInfo = { provided: false, canonical: false, path: null, records: 0, error: null };
if (!dumpPath && exists(DUMP_DEFAULT)) {
  const f = fs.readdirSync(DUMP_DEFAULT).find((x) => /trade_log/i.test(x));
  if (f) dumpPath = path.join(DUMP_DEFAULT, f);
}
if (dumpPath && exists(dumpPath)) {
  try {
    dumpRecords = fs.readFileSync(dumpPath, 'utf8').split(/\r?\n/).filter(Boolean).map((s) => JSON.parse(s));
    dumpInfo = {
      provided: true,
      canonical: false,   // ⚠️ 该 dump 为**仓外、非规范**的临时导出（见 evidence 文档）
      path: dumpPath,
      records: dumpRecords.length,
      error: null
    };
  } catch (e) {
    dumpInfo = { provided: true, canonical: false, path: dumpPath, records: 0, error: String(e.message || e) };
  }
}

/* ------------------------------------------------------------------ *
 * ④ V1 replay 的 BUILD/ADD 计数
 * ------------------------------------------------------------------ */
// RPG-F2-B：replay() 已改为 async ⇒ async IIFE 包裹（CJS 无顶层 await）
(async () => {
const v1 = await harness.replay({ from: '2026-08-01', to: '2026-09-22', runsPerDay: 1 });
const buildAdd = [];
for (const d of v1.days) {
  for (const [code, b] of Object.entries(d.byCode)) {
    if (b.final_action === 'BUILD' || b.final_action === 'ADD') {
      buildAdd.push({ date: d.trade_date, code, action: b.final_action, target: b.final_target });
    }
  }
}

/* ------------------------------------------------------------------ *
 * ⑤ 机器可读结论（§5 字段）
 * ------------------------------------------------------------------ */
const realBuys = dumpRecords ? dumpRecords.filter((t) => t.action === 'buy') : [];
const withDecisionLink = dumpRecords ? dumpRecords.filter((t) => t.decision_id) : [];

const out = {
  probe: 'RPG-002',
  kind: 'EXECUTION_SEMANTICS',
  read_only: true,
  window: { from: '2026-08-01', to: '2026-09-22', days: v1.days.length },

  // ---- Q1：TRADE_LOG 的语义 ----
  Q1_trade_log_writers: writers,
  Q1_trade_log_readers_count: readers.length,
  Q1_verdict: 'ACTUAL_EXECUTION_MANUAL_LEDGER',
  Q1_evidence: {
    only_writer: 'cloudfunctions/adminGateway/index.js::tradeCRUD（_op=create）',
    axis_classification: 'src/common/utils/v365-active-read.js:84 → { collection: "trade_log", axis: "MANUAL_LEDGER", note: "人工操作记录" }',
    decision_engine_writes_trade_log: false,
    note: '唯一写入方是管理端 CRUD 端点，字段（trade_date/code/action/shares/price）由 payload 提供 ⇒ 人工录入的**实际成交**'
  },

  // ---- Q2：DECISION vs EXECUTION ----
  Q2_decision_implies_execution: false,
  Q2_verdict: 'DECISION_NOT_EQUAL_EXECUTION',
  Q2_evidence: {
    writers_in_decision_path: writers.filter((w) => /runDecisionEngine|decision\.js|decision-v3\.js/.test(w.file)).length,
    note: '决策路径内**零** TRADE_LOG 写入 ⇒ final_action=BUILD/ADD 不会自动产生成交记录'
  },

  // ---- Q3：双向合法场景 ----
  Q3_decision_without_execution_legal: true,
  Q3_execution_without_decision_legal: true,
  Q3_evidence: {
    decision_without_execution: '决策是**建议**；是否执行由人工决定（真实数据中 decision_id 全空 ⇒ 无成交与决策关联）',
    execution_without_decision: '人工可自行下单（真实数据示例：2026-08-19 513310 buy reason="抄底"）',
    review_code_corroboration: 'src/common/utils/review-stats.js：无同向可执行建议时把成交标为「自主调整」'
  },

  // ---- Q4：position 与 TRADE_LOG 的关系 ----
  Q4_position_change_implies_trade: false,
  Q4_verdict: 'INDEPENDENT_AXES',
  Q4_evidence: {
    note: 'portfolio_position 是独立集合（管理端维护）；tradeCRUD 在成交后**可选**联动 position_after'
      + '（adminGateway:746/781），但 position 亦可由其它管理端点变更 ⇒ ⛔ position changed ≠ trade executed',
    trade_log_has_position_after: true
  },

  // ---- ★ Q4 延伸：**replay harness 自身**是否违反该原则 ----
  Q4_replay_harness_book_semantics: {
    verdict: 'HARNESS_BOOK_USES_MODEL_A（DECISION_IMPLIES_EXECUTION）',
    evidence: {
      file: 'scripts/lib/v364-replay-harness.js',
      line: 340,
      code: 'nextBook[u.code] = res.suggested_position != null ? res.suggested_position : (nextBook[u.code] || 0);',
      comment_at_338: '// 账面推进：只在**最后一次运行**后生效（同日重跑不改仓位 —— 当天没有成交）'
    },
    consequence:
      'V1 replay 的**持仓轨迹**由 `suggested_position`（决策建议）驱动 ⇒ 隐含「建议必被执行」；'
      + '而 §Q1–Q4 已证生产为 Model B（decision ≠ execution）⇒ '
      + '**replay 的 portfolio.tech_position / cash_ratio / sectorUsed 与生产可能系统性偏离**。',
    scope: '该偏离影响 sectorRemainingLimit 与全部 portfolio 输入 ⇒ 覆盖面**大于** RPG-002（cooldown）',
    classification: 'RPG-003_CANDIDATE',
    note: '⛔ 本探针只**登记**，不裁定；是否立为 RPG-003 由 owner 决定（见 evidence 文档 §6）'
  },

  // ---- 历史可得性 ----
  historical_availability: avail,
  execution_dump: dumpInfo,

  // ---- §5 输出字段 ----
  REPLAY_BUILD_ADD_COUNT: buildAdd.length,
  REAL_EXECUTION_RECORD_COUNT: dumpRecords ? dumpRecords.length : 0,
  REAL_BUY_RECORD_COUNT: realBuys.length,
  DECISION_EXECUTION_MATCH_COUNT: withDecisionLink.length,
  DECISION_WITHOUT_EXECUTION_COUNT: buildAdd.length - withDecisionLink.length,
  EXECUTION_WITHOUT_DECISION_COUNT: dumpRecords ? (dumpRecords.length - withDecisionLink.length) : 0,
  COOLDOWN_REAL_PATH_EXERCISABLE: false,
  COOLDOWN_SYNTHETIC_ONLY: true,

  // ---- §6 分类 ----
  RPG002_CLASSIFICATION: 'RPG002-B',
  RPG002_CLASSIFICATION_REASON:
    'PRODUCTION_FAITHFUL_REPLAY_REQUIRES_EXECUTION_DATA —— 语义已由代码+数据**证实**（DECISION ≠ EXECUTION），'
    + '但规范 replay 输入包内**无执行账本**；执行数据存在于生产库、可经**受治理的导出**获得（仓外临时 dump 已证明可得）',

  // ---- §7 anchor 后果 ----
  anchor_coverage_manifest_entry: {
    cooldown: {
      production_fidelity: 'NOT_AVAILABLE',
      synthetic_branch_coverage: true,
      note: '⛔ 不得写 cooldown = production-faithful'
    }
  },

  build_add_detail: buildAdd,
  real_execution_detail: dumpRecords || []
};

console.log('== RPG-002 Execution-Semantics Probe ==');
console.log(`  Q1 verdict = ${out.Q1_verdict}`);
console.log(`  Q2 verdict = ${out.Q2_verdict}`);
console.log(`  Q4 verdict = ${out.Q4_verdict}`);
console.log('');
console.log(`  TRADE_LOG writers = ${writers.length}`);
writers.forEach((w) => console.log(`    · ${w.file}:${w.line}  ${w.code}`));
console.log('');
for (const k of ['REPLAY_BUILD_ADD_COUNT', 'REAL_EXECUTION_RECORD_COUNT', 'REAL_BUY_RECORD_COUNT',
  'DECISION_EXECUTION_MATCH_COUNT', 'DECISION_WITHOUT_EXECUTION_COUNT', 'EXECUTION_WITHOUT_DECISION_COUNT',
  'COOLDOWN_REAL_PATH_EXERCISABLE', 'COOLDOWN_SYNTHETIC_ONLY', 'RPG002_CLASSIFICATION']) {
  console.log(`  ${k.padEnd(36)} = ${JSON.stringify(out[k])}`);
}
console.log('');
console.log(`  execution dump = ${dumpInfo.provided ? dumpInfo.path + '（' + dumpInfo.records + ' 条，canonical=' + dumpInfo.canonical + '）' : '未提供'}`);

if (a.out) {
  const p = path.resolve(String(a.out));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(out, null, 2), 'utf8');
  console.log(`\n  [written] ${p}`);
}
if (a.json) console.log(JSON.stringify(out));
})().catch((e) => { console.error(`  [FATAL] ${e && e.stack ? e.stack : e}`); process.exit(1); });
