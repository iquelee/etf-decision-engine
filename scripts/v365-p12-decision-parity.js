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
 *  (3) **受保护文件零改动**（HD12-1）：受保护集合来自**唯一来源**
 *      `scripts/lib/v365-decision-classification.js`（CALC ∪ ORCH ∪ MIXED ∪ INFRA）。
 *      ⛔ 本文件**不再**维护本地 CORE 数组 —— HD12-0 实测本文件与 qualification gate
 *      的两份清单曾漂移 3 项。分类真相源必须唯一。
 *      ⚠️ 已登记的 replay 覆盖缺口见同一来源的 `REPLAY_COVERAGE_GAPS`（如 RPG-001）。
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

/** HD12-2：读取授权清单（⛔ 不做校验，校验交给纯函数模块） */
function loadApprovalManifest(p) {
  if (!p) return null;
  const abs = path.resolve(String(p));
  if (!fs.existsSync(abs)) {
    console.log(`  [WARN] --approval-manifest 指向的文件不存在：${abs}`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (e) {
    console.log(`  [WARN] --approval-manifest 解析失败：${String(e.message || e)}`);
    return null;
  }
}

/**
 * HD12-3：读取改动**区域**清单。
 * 格式：每行 `file<TAB>startLine<TAB>endLine`（1-based 闭区间）；`#` 开头为注释。
 * ⛔ 由调用方生成（脚本内不调子进程）：`git diff -U0 -- <file>` 解析。
 */
function loadChangedRegions(p) {
  if (!p) return [];
  const abs = path.resolve(String(p));
  if (!fs.existsSync(abs)) {
    console.log(`  [WARN] --changed-region 指向的文件不存在：${abs}`);
    return [];
  }
  const out = [];
  fs.readFileSync(abs, 'utf8').split(/\r?\n/).forEach((ln) => {
    const s = ln.trim();
    if (!s || s.startsWith('#')) return;
    const parts = s.split('\t');
    if (parts.length < 3) return;
    const start = Number(parts[1]); const end = Number(parts[2]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return;
    out.push({ file: parts[0].split(path.sep).join('/'), start, end });
  });
  return out;
}

/** HD12-3：为给定文件解析其 orchestration zone 区间（1-based 闭区间） */
function loadZonesByFile(files) {
  const map = {};
  (files || []).forEach((f) => {
    const abs = path.join(REPO, f);
    if (!fs.existsSync(abs)) return;
    map[f] = APPROVAL.parseOrchZones(fs.readFileSync(abs, 'utf8')).zones;
  });
  return map;
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

// ---- HD12-1 §十：依赖集只计**仓内**文件 ----
// ⛔ 旧判据 `!p.startsWith('..')` 在 Windows **跨盘符**时失效：
//    `path.relative()` 无法计算跨盘相对路径 ⇒ 直接返回绝对路径 ⇒ 仓外文件（宿主 shim）漏进来，
//    使「回放依赖集大小」随环境变化、失去跨机可比性。
// ⇒ 改为显式判断 resolved path 是否位于 repo root 内。
const REPO_ABS = path.resolve(REPO);
function isInsideRepo(p) {
  const r = path.resolve(p);
  return r === REPO_ABS || r.startsWith(REPO_ABS + path.sep);
}
const loadedDeps = new Set(
  Object.keys(require.cache)
    .filter(isInsideRepo)
    .map(rel)
    .filter((p) => p && !p.startsWith('..') && p !== SELF)
);

// ---- HD12-1 §六：分类真相源改为**唯一来源** ----
// ⛔ 本文件**不再**维护本地 CORE 数组。
//    （HD12-0 实测：本文件的 `DECISION_CORE`(12) 与 qualification gate 的 `CORE`(11) 曾漂移 3 项。）
// ⚠️ 必须在 `loadedDeps` 计算**之后** require —— 否则分类模块会混入回放依赖集，
//    污染「回放依赖集大小」这一跨机可比数字。
const CLASSIFICATION = require('./lib/v365-decision-classification.js');
// HD12-2：编排层变更的授权 + 证明机制（纯函数）
const APPROVAL = require('./lib/v365-orchestration-approval.js');

let changed = [];
if (a['changed-file']) {
  const cfPath = path.resolve(String(a['changed-file']));
  if (!fs.existsSync(cfPath)) {
    // ⛔ 硬规则：显式传了 `--changed-file` 但文件不存在 ⇒ **不得**当作"无改动"静默放行
    //    （否则 CALC 的"绝对禁止"会被一个手误路径绕过）
    console.error(`  [FATAL] --changed-file 指向的文件不存在：${cfPath}`);
    process.exit(2);
  }
  changed = fs.readFileSync(cfPath, 'utf8')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.split(path.sep).join('/'));
} else {
  const gi = process.argv.findIndex((x) => x === '--changed-file' || x.startsWith('--changed-file='));
  if (gi >= 0) {
    // 参数写了但值为空 ⇒ 同样是手误，⛔ 不得降级为"无改动"
    console.error(`  [FATAL] --changed-file 未提供有效路径（值缺失）`);
    process.exit(2);
  }
  console.log('  [WARN] 未提供 --changed-file，跳过结构性交集判定');
}
changed = Array.from(new Set(changed)).sort();

console.log(`  改动文件数 = ${changed.length}`);
console.log(`  回放依赖集大小 = ${loadedDeps.size}`);

// 例外白名单同样来自唯一来源（HD12-1 §六）
const ALLOWED_EXCEPTIONS = new Set(CLASSIFICATION.exceptionFiles());
// HD12-4 —— REPLAY_INFRASTRUCTURE 文件的特殊性：它们**本来就是回放依赖**。
// ⛔ 旧判据把「改动文件 ∩ 回放依赖集」一律视为异常 ⇒ 对 REPLAY_INFRA 文件恒 FAIL
//    （而这恰恰是唯一可能出现的合法交集：harness 是决策回放链的必需一环）。
// ✅ 修正：REPLAY_INFRA 文件被改动时**不走**「未预期交集」判据，
//    改由 ④ 授权判据（40 位 SHA 绑定 + changed_files 精确一致 + scope 非空
//    + `replay_infra_review = REPLAY_INFRA_CHANGE_REVIEW_REQUIRED`）接管。
// ⚠️ 判据**未被放宽**：REPLAY_INFRA 仍须显式 owner 授权 + 专门评审标记，
//    只是不再被「交集」这一**结构性**判据重复拦截（双重拦截会让唯一合法路径恒不可达）。
const REPLAY_INFRA_SET = new Set(CLASSIFICATION.infraFiles());
const overlap = changed.filter((f) => loadedDeps.has(f));
const unexpectedOverlap = overlap.filter((f) => !ALLOWED_EXCEPTIONS.has(f) && !REPLAY_INFRA_SET.has(f));
const allowedHit = overlap.filter((f) => ALLOWED_EXCEPTIONS.has(f) || REPLAY_INFRA_SET.has(f));

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

// ---- 受保护文件必须在「未改动」集合内（HD12-1 §六/§七）----
// 分类来自**唯一来源** `scripts/lib/v365-decision-classification.js`（本文件不再硬编码任何 CORE 数组）。
// ⚠️ HD12-1 取 `allProtected()` = CALC ∪ ORCH ∪ MIXED ∪ INFRA：
//    · 与旧 `DECISION_CORE`(12 项) 的判定行为**逐位保持**（旧 12 项全部落在新集合内）
//    · 新增的是 HD12-0 审计确认的**真实 CALC 覆盖**（constants / v3-shadow / trade-date-* / gen1-authority / …）
// ⚠️ 本轮**不打开** orchestration 授权（HD12-2 未做）⇒ ORCH / MIXED / INFRA 一律同样 FAIL。
// ---- HD12-2：受保护文件变更的**授权 + 证明**判据 ----
// CALC          ⇒ ⛔ 绝对 FAIL（无授权路径）
// ORCH / MIXED / REPLAY_INFRA ⇒ ⚠️ 需授权清单（40 位 SHA 绑定 + changed_files 精确一致 + scope 非空）
//                · MIXED 另需 zone 声明 或 comment-only 机械证明
//                · REPLAY_INFRA 另需 `REPLAY_INFRA_CHANGE_REVIEW_REQUIRED`
// ⛔ 改动了受保护文件却未提供授权清单 ⇒ FAIL（默认拒绝）。
const PROTECTED = CLASSIFICATION.allProtected();
const touchedCore = changed.filter((f) => PROTECTED.includes(f));
const approvalManifest = loadApprovalManifest(a['approval-manifest']);
const changedRegions = loadChangedRegions(a['changed-region']);
const zonesByFile = loadZonesByFile(changed.filter((f) => CLASSIFICATION.classify(f) === 'MIXED'));
const verdict = APPROVAL.validate(approvalManifest, {
  changed,
  headSha: a['head-sha'] != null ? String(a['head-sha']) : null,
  changedRegions,
  zonesByFile,
  classification: CLASSIFICATION
});
check('受保护文件变更已授权（CALC 绝对禁止 / ORCH·MIXED·INFRA 需授权 + 证明）', verdict.ok,
  verdict.ok
    ? `${verdict.code}${touchedCore.length
      ? ' — 授权覆盖: ' + touchedCore.map((f) => `${f}(${CLASSIFICATION.classify(f)})`).join(', ')
      : ` — 检查了 ${PROTECTED.length} 个文件（来源 ${CLASSIFICATION.CLASSIFICATION_VERSION}）`}`
    : `${verdict.code} — ${verdict.errors.join(' | ')}`);
verdict.notes.forEach((n) => console.log(`  [INFO] ${n}`));

// ---- HD12-1.1 §1：protected-domain fail-closed ----
// 受保护域 = `src/common/constants.js` ∪ `src/common/utils/**` ∪ `cloudfunctions/runDecisionEngine/**`
//            ∪ REPLAY_INFRASTRUCTURE 显式登记的文件。
// 规则：域内文件若 `classify() === UNCLASSIFIED` ⇒ **FAIL**。
// 目的：⛔ 不得把「replay 是否加载该文件」当作「该文件是否可能影响生产决策」的判据。
// ⚠️ 本判据的价值主要在**新增文件**：域内新出现的、尚未定性的文件必须显式登记，不得静默放行。
const domainViolations = CLASSIFICATION.protectedDomainViolations(changed);
check('受保护域内无未登记文件（protected-domain fail-closed）', domainViolations.length === 0,
  domainViolations.length
    ? `域内未登记: ${domainViolations.join(', ')}（⇒ 必须显式登记进 ${CLASSIFICATION.CLASSIFICATION_VERSION}）`
    : '域内全部已定性');

// ---- 未登记文件：显式披露（HD12-1 §二：classify 未登记 ⇒ UNCLASSIFIED，⛔ 不默认归入宽松类别）----
// ⚠️ 本轮 fail-closed 由两道判据共同承担：
//    ① 受保护域内未登记 ⇒ 上面的 FAIL；
//    ② 落在回放依赖集内的未登记文件 ⇒ `unexpectedOverlap` ⇒ FAIL（见上）。
//    docs/** · tests/** · 非 infra 的普通 scripts/** **不因分类而失败**（已由 ①② 排除）。
const unclassified = changed.filter((f) => CLASSIFICATION.classify(f) === CLASSIFICATION.UNCLASSIFIED);
if (unclassified.length) {
  console.log(`  [INFO] 改动清单中的未登记文件（${unclassified.length}）: ${JSON.stringify(unclassified)}`);
  console.log('         ⇒ 域外未登记文件不因分类失败（docs/** · tests/** · 普通 scripts/** 属正常改动面）');
}
if (CLASSIFICATION.REPLAY_COVERAGE_GAPS.length) {
  console.log(`  [INFO] 已登记的 replay 覆盖缺口（${CLASSIFICATION.REPLAY_COVERAGE_GAPS.length}）: `
    + CLASSIFICATION.REPLAY_COVERAGE_GAPS.map((g) => `${g.id}(${g.module} → ${g.production_input}, ${g.replay_status})`).join('; '));
}

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

// RPG-F2-B：`harness.replay()` 自本轮起为 **async**（内部 await cooldown 桩 db）
// ⇒ CJS 无顶层 await，故用 async IIFE 包裹后半段。
// ⚠️ 此处**不传 protocol** ⇒ 默认 `'V1'` ⇒ anchor 判据与改前**完全一致**。
(async () => {
const r1 = await harness.replay({ from, to, runsPerDay: 1 });
const r2 = await harness.replay({ from, to, runsPerDay: 1 });
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
})().catch((e) => {
  console.error(`  [FATAL] parity 脚本异常: ${e && e.stack ? e.stack : e}`);
  process.exit(1);
});
