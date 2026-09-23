#!/usr/bin/env node
/**
 * V3.6.5 P-1/P-2 —— Normal-path decision parity 验证
 *
 * 目标：证明 `UNEXPECTED_DECISION_DELTA = 0`。
 *
 * 两道独立证据：
 *
 *  (1) **结构性**：本次改动文件 ∩ 「回放/决策代码的**实际加载依赖集**」= ∅
 *      依赖集由 `require.cache` 实测得出（不是靠猜），因此「决策路径代码逐字节未变」
 *      是**可验证的事实**，而不是断言。
 *      唯一允许的例外是 `v361-run-context.js`（P-1 明确要求扩展它）；
 *      该例外必须额外证明「生产未接线」—— 扫描 `cloudfunctions/* /index.js` 的
 *      `require` 文本，要求命中数为 **0**。
 *
 *  (2) **实测 determinism**：同一 `replay()` 连跑两次，决策序列逐位一致。
 *      用于排除「回放本身不稳定」这一干扰项，并留出可复核的 SHA-256 锚点。
 *
 * 逻辑：若决策路径代码逐字节未变，(1) 成立；若回放可确定性复现，(2) 成立；
 *       两者合并 ⇒ 同一输入下 V3.6.4 与 V3.6.5 candidate 的决策输出必然逐位一致。
 *
 * ⚠️ 本脚本**不调子进程**（沙箱禁止 node→node/git 子进程）：
 *    改动文件清单由调用方（bash）先生成，通过 `--changed-file` 传入。
 *
 * 用法：
 *   node scripts/v365-p12-decision-parity.js --changed-file <path> [--from YYYY-MM-DD] [--to YYYY-MM-DD]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..');

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) continue;
    const name = k.slice(2);
    const v = argv[i + 1];
    if (v == null || v.startsWith('--')) { a[name] = true; continue; }
    a[name] = v; i += 1;
  }
  return a;
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}
function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}
function rel(p) {
  return path.relative(REPO, p).split(path.sep).join('/');
}

const failures = [];
function check(name, ok, detail) {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures.push(name);
}

/* ------------------------------------------------------------------ *
 * (1) 结构性：改动文件 ∩ 回放依赖集
 * ------------------------------------------------------------------ */
console.log('\n== (1) 结构性：改动文件 vs 回放/决策依赖集 ==');

const a = parseArgs(process.argv);

// 入口脚本自身不是「依赖」，必须从依赖集中排除 —— 否则会与「改动文件」产生**自指交集**
const SELF = rel(require.main && require.main.filename ? require.main.filename : '');
// 先加载 harness，使 require.cache 充满其真实依赖
const harnessPath = path.join(REPO, 'scripts', 'lib', 'v364-replay-harness.js');
const harness = require(harnessPath);
const loadedDeps = new Set(
  Object.keys(require.cache)
    .map(rel)
    .filter((p) => p && !p.startsWith('..') && p !== SELF)
);

let changed = [];
if (a['changed-file']) {
  changed = fs.readFileSync(a['changed-file'], 'utf8')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.split(path.sep).join('/'));
} else {
  console.log('  [WARN] 未提供 --changed-file，跳过结构性交集判定');
}
changed = Array.from(new Set(changed)).sort();

console.log(`  改动文件数 = ${changed.length}`);
console.log(`  回放依赖集大小 = ${loadedDeps.size}`);

const ALLOWED_EXCEPTIONS = new Set(['src/common/utils/v361-run-context.js']);
const overlap = changed.filter((f) => loadedDeps.has(f));
const unexpectedOverlap = overlap.filter((f) => !ALLOWED_EXCEPTIONS.has(f));
const allowedHit = overlap.filter((f) => ALLOWED_EXCEPTIONS.has(f));

console.log(`  交集 = ${JSON.stringify(overlap)}`);
check('改动文件与回放依赖集的交集仅含白名单项', unexpectedOverlap.length === 0,
  unexpectedOverlap.length ? `未预期交集: ${unexpectedOverlap.join(', ')}` : '无未预期交集');

// 例外项必须证明「生产未接线」：扫描 cloudfunctions/*/index.js 的 require 文本
const cfDir = path.join(REPO, 'cloudfunctions');
let prodRequireHits = [];
if (fs.existsSync(cfDir)) {
  fs.readdirSync(cfDir).forEach((fn) => {
    const idx = path.join(cfDir, fn, 'index.js');
    if (!fs.existsSync(idx)) return;
    const src = fs.readFileSync(idx, 'utf8');
    if (src.includes('v361-run-context')) prodRequireHits.push(`cloudfunctions/${fn}/index.js`);
  });
}
check('v361-run-context.js 在生产 cloudfunctions/ 中 require 数 = 0（未接线）',
  prodRequireHits.length === 0,
  prodRequireHits.length ? `命中: ${prodRequireHits.join(', ')}` : '0 处命中');
if (allowedHit.length) {
  console.log(`  ℹ️ 白名单项实际出现在依赖集: ${JSON.stringify(allowedHit)}`);
}

// 决策核心文件必须在「未改动」集合内
const DECISION_CORE = [
  'src/common/utils/decision.js',
  'src/common/utils/decision-v3.js',
  'src/common/utils/trend-stage.js',
  'src/common/utils/correlation.js',
  'src/common/utils/defense.js',
  'src/common/utils/swing-structure.js',
  'src/common/utils/v3-6-stage-persistence.js',
  'src/common/utils/market-regime.js',
  'src/common/utils/indicators.js',
  'src/common/utils/portfolio-mode.js',
  'src/common/utils/portfolio-cash.js',
  'cloudfunctions/runDecisionEngine/index.js'
];
const touchedCore = changed.filter((f) => DECISION_CORE.includes(f));
check('决策核心文件零改动', touchedCore.length === 0,
  touchedCore.length ? `被改动: ${touchedCore.join(', ')}` : `检查了 ${DECISION_CORE.length} 个文件`);

/* ------------------------------------------------------------------ *
 * (2) 实测 determinism
 * ------------------------------------------------------------------ */
console.log('\n== (2) 实测：replay 两次，决策序列逐位一致 ==');

const from = a.from || '2026-08-01';
const to = a.to || '2026-09-22';

function summarize(result) {
  return {
    meta: {
      slowBreakMode: result.meta.slowBreakMode,
      runsPerDay: result.meta.runsPerDay,
      from: result.meta.from,
      to: result.meta.to,
      days: result.meta.days,
      universe: result.meta.universe
    },
    axis: result.axis,
    days: result.days.map((d) => ({
      trade_date: d.trade_date,
      market_regime: d.market_regime,
      index_w_states: d.index_w_states,
      byCode: d.byCode
    })),
    runDiffs: result.runDiffs,
    finalBook: result.finalBook
  };
}

const r1 = harness.replay({ from, to, runsPerDay: 1 });
const r2 = harness.replay({ from, to, runsPerDay: 1 });
const s1 = sha256(stableStringify(summarize(r1)));
const s2 = sha256(stableStringify(summarize(r2)));

console.log(`  replay 区间 = ${from} → ${to}（${r1.axis.length} 个交易日）`);
console.log(`  第 1 次决策序列 sha256 = ${s1}`);
console.log(`  第 2 次决策序列 sha256 = ${s2}`);
check('两次 replay 决策序列逐位一致（determinism）', s1 === s2);

// 决策字段抽样披露，便于人工复核
const lastDay = r1.days[r1.days.length - 1];
const sample = {};
Object.keys(lastDay.byCode).forEach((code) => {
  const b = lastDay.byCode[code];
  sample[code] = {
    trend_stage: b.trend_stage_primary,
    final_target: b.final_target,
    final_action: b.final_action,
    binding_constraint: b.binding_constraint
  };
});
console.log(`  末交易日(${lastDay.trade_date}) 决策抽样:`);
console.log('  ' + JSON.stringify(sample));

/* ------------------------------------------------------------------ *
 * 结论
 * ------------------------------------------------------------------ */
console.log('\n== 结论 ==');
if (failures.length === 0) {
  console.log('  UNEXPECTED_DECISION_DELTA = 0');
  console.log(`  parity_anchor_sha256 = ${s1}`);
  process.exit(0);
}
console.log(`  parity FAILED（${failures.length} 项）: ${failures.join('; ')}`);
process.exit(1);
