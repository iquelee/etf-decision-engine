'use strict';

/**
 * WP-G1-GE-03 G3-09：**S4 invocation census**（设计 Gate §2.1 的强制交付物 → Gate **G1-AF**）。
 *
 * §2.1 原文要点：
 *   「GE-03 实施 PR 必须提交一份 S4 invocation census，说明 ① baseline V3 /
 *     ② 既有 Canary rerun（V361_RERUN_S4）/ ③ Guarded Shadow rerun 各自的
 *     **触发条件 / 输入上下文 / 调用次数**。
 *     若 ② 与 ③ 的 V3 输入**逐项相同** ⇒ ⛔ 不得重复计算两次，应**共享同一 rerun result**。
 *     若输入确有差异 ⇒ 必须列出 input delta，但仍只能调用同一个 immutable V3，
 *     ⛔ 不得复制或改写 V3 逻辑。」
 *
 * 本文件的定位（⛔ 与既有门禁**不重复**，只补 §2.1 独有轴）：
 *   · `tests/gen1-guarded-shadow-rerun.test.js`（G1-AA §E）已断言：
 *     `decisionV3.runDecision(` 恰 2 处、canary 回调内恰 1 处、shadow 结果来自认领、
 *     Selector 收到的是**结果对象**而非资格、⛔ 无第二套 V3 模块。
 *   · 本文件在其之上补 **census 专有**的五条轴：
 *       G1  全量 `runDecision(` 调用点**分类**（含 2 处**非** immutable V3 的 legacy 调用）
 *       G2  ① 的输入上下文（键集 / ⛔ 不传 `advisoryStageOverride`）
 *       G3  ② 的输入上下文（键集 / 传 `advisoryStageOverride: stage`）
 *       G4  ① vs ② 的 **input delta** 逐项：Δ1 = **账本差**（两处 clamp 同形、两处种子逐字符相同）
 *           + Δ2 = 唯一语义变量；其余 9 项**逐项同源**（经 `canaryCtx` 绑定链证明）
 *       G5  ①② 触发条件各自的判据 + ③ 的调用次数 = **0**（认领，⛔ 无第三次调用）
 *
 * ⚠️ **枚举域（显式声明，⛔ 不写成无限域否定）**
 *   · 「无第三处 immutable V3 调用」的枚举域 = `cloudfunctions/runDecisionEngine/index.js`
 *     内全部 `runDecision(` 调用点，且以 `decisionV3.runDecision(` 为 V3 引擎唯一调用形态。
 *     —— 不声称其他文件 / 其他形态不存在；该风险由 R6 的 SHA lock
 *     （`ml/manifests/V361_IMMUTABLE_LOCK.json` 覆盖 `decision-v3.js`）另行封堵。
 *   · 「②③ 输入无 delta」的枚举域 = ② 回调内那一次 `runDecision` 的实参对象。
 *     —— ③ **无实参对象**，故该命题是「无语义」而非「比较后相等」——这是**更强**的形式。
 *   · 交付物文档 `docs/gen1/GEN1_GE03_S4_INVOCATION_CENSUS_20260916.md` 只做
 *     **存在性 + 关键结论标记**断言；⛔ 不断言其排版 / 行号（行号会漂移，结论不会）。
 *
 * 运行：node tests/gen1-ge03-s4-census.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const readLF = (rel) => read(rel).replace(/\r\n/g, '\n');
const exists = (rel) => fs.existsSync(path.join(REPO, rel));
/** 去块注释 / 行注释（保留字符串字面量），用于源码级断言。 */
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const RDE_REL = 'cloudfunctions/runDecisionEngine/index.js';
const CANARY_REL = 'src/common/utils/gen1-canary.js';
const GATES_REL = 'scripts/gen1-production-gates.js';
const CENSUS_REL = 'docs/gen1/GEN1_GE03_S4_INVOCATION_CENSUS_20260916.md';

const RDE_CODE = codeOnly(read(RDE_REL));
const CANARY_CODE = codeOnly(read(CANARY_REL));
const count = (src, re) => (src.match(re) || []).length;

/* ==================================================================== *
 * G0. 自注册：本文件必须作为 G1-AF 挂进 CI 门禁台账（否则再严的断言也不会跑）
 * ==================================================================== */
{
  const GATES_SRC = read(GATES_REL);
  assert.ok(
    /\{ id: 'G1-AF', name: '[^']*', script: 'tests\/gen1-ge03-s4-census\.test\.js' \}/.test(GATES_SRC),
    '★ §2.1：S4 invocation census 必须注册为 Gate G1-AF（⛔ 只写测试不挂门 = 从不执行）');
  assert.ok(/G1-A ~ G1-AF/.test(GATES_SRC),
    '★ §2.1：新增 G1-AF 后门禁横幅必须同步为 G1-A ~ G1-AF（⛔ 不得只加门不改横幅）');
  /* 既有 25 门 + GE-03 前 6 门仍是原序前缀（⛔ 不得以新门顶替旧门） */
  const ids = [...GATES_SRC.matchAll(/\{ id: '(G1-[A-Z]+)', name: '/g)].map((m) => m[1]);
  assert.strictEqual(ids.length, 32, `★ 门禁总数必须 = 25 既有 + 7 GE-03（实为 ${ids.length}）`);
  assert.strictEqual(ids[0], 'G1-A');
  assert.strictEqual(ids[24], 'G1-Y', '★ 既有 25 门必须原序保持（⛔ 不得重排 / 顶替）');
  assert.strictEqual(ids[31], 'G1-AF', '★ 新增门必须**追加在尾部**（⛔ 不得插队）');
}

/* ==================================================================== *
 * G1. 全量 `runDecision(` 调用点分类
 * ==================================================================== */
{
  /* G1a. 两个引擎的 require 来源必须可区分（census 的前提：别把 legacy 当 V3）。
   * ⚠️ 断言一律用**静态正则**逐条枚举；⛔ 不用字符串拼接构造 RegExp —— 拼接若只转义部分
   *    元字符而漏掉反斜杠，会触发 CodeQL `js/incomplete-sanitization`（此处静态枚举本就足够，
   *    拼接属无谓风险面）。绑定名一并钉死，防「悄悄换引擎」。 */
  assert.ok(/const decisionV3 = require\('\.\/common\/utils\/decision-v3\.js'\)\(\);/.test(RDE_CODE),
    '★ census：immutable V3 引擎必须由 decision-v3.js 提供并绑定到 decisionV3');
  assert.ok(/const decision = require\('\.\/common\/utils\/decision'\);/.test(RDE_CODE),
    '★ census：legacy 引擎（decision.js）必须绑定到 decision（⛔ 不得与 decisionV3 混淆）');

  /* G1b. immutable V3 调用点恒 2 处（① baseline / ② 既有 Canary S4 rerun） */
  assert.strictEqual(count(RDE_CODE, /decisionV3\.runDecision\(/g), 2,
    '★ census：immutable V3 调用点必须恰 2 处（① baseline + ② Canary S4 rerun）');

  /* G1c. 非 V3 引擎调用点恒 2 处（probe 预计算 / v38Result 基线），⛔ 不得被误算进 census */
  assert.strictEqual(count(RDE_CODE, /decision\.runDecision\(/g), 2,
    '★ census：legacy（V3.8）调用点必须恰 2 处（probe + v38Result）');

  /* G1d. 全量分类恒 4 处（2 + 2）——总数变化即 census 失效，必须重写 */
  assert.strictEqual(count(RDE_CODE, /runDecision\(/g), 4,
    '★ census：runDecision( 调用点总数必须恰 4（2 × immutable V3 + 2 × legacy）');

  /* G1e. 逐调用点归属变量名（防「悄悄换了引擎」） */
  const SITES = [
    ['const probe = decision.runDecision(', 'legacy probe（预计算机会分，不落库）'],
    ['const v38Result = decision.runDecision(', 'legacy v38 baseline（V3.6.1 基线）'],
    ['const v3Result = decisionV3.runDecision(', '① immutable V3 baseline'],
    ['const c = decisionV3.runDecision(', '② 既有 Canary S4 rerun']
  ];
  for (const [needle, label] of SITES) {
    assert.strictEqual(count(RDE_CODE, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')), 1,
      `★ census：调用点「${label}」必须恰好出现一次`);
  }

  /* G1f. ① 必须位于 `if (runV3Path) {` 块内、② 必须在 ① 之后（拓扑 ① → ② → ③） */
  const i1 = RDE_CODE.indexOf('const v3Result = decisionV3.runDecision(');
  const i2 = RDE_CODE.indexOf('const c = decisionV3.runDecision(');
  const iPath = RDE_CODE.indexOf('if (runV3Path) {');
  assert.ok(iPath >= 0 && i1 > iPath, '★ census：① baseline 必须落在 runV3Path 分支内');
  assert.ok(i2 > i1, '★ census：② Canary S4 rerun 必须晚于 ①（拓扑 ①②③ 不得倒置）');
}

/* ==================================================================== *
 * G2 / G3. ①② 的输入上下文（键集 + 唯一分叉点）
 * ==================================================================== */
const bStart = RDE_CODE.indexOf('const v3Result = decisionV3.runDecision(');
const bEnd = RDE_CODE.indexOf('});', bStart);
assert.ok(bStart > 0 && bEnd > bStart, '★ census：① 调用点切分失败');
const A_ARGS = RDE_CODE.slice(bStart, bEnd);

const cStart = RDE_CODE.indexOf('const c = decisionV3.runDecision(');
const cEnd = RDE_CODE.indexOf('});', cStart);
assert.ok(cStart > bStart && cEnd > cStart, '★ census：② 调用点切分失败');
const B_ARGS = RDE_CODE.slice(cStart, cEnd);

const normA = A_ARGS.replace(/\s+/g, ' ');
const normB = B_ARGS.replace(/\s+/g, ' ');

/** 取 `key: value` 形态的键（不含简写 `key,`）。 */
const COLON_KEYS = (s) => [...s.matchAll(/([A-Za-z_][A-Za-z0-9_]*):/g)].map((m) => m[1]);
/** 取实参对象体内**简写**传参（无 `:`）的键。 */
const SHORTHAND_KEYS = (s) => {
  const i = s.indexOf('merged, {');
  assert.ok(i >= 0, '★ census：调用点必须仍是 `(…, merged, { … })` 形态');
  return s.slice(i + 'merged, {'.length, s.lastIndexOf('}'))
    .replace(/\s+/g, '').split(',')
    .filter((p) => p.length > 0 && p.indexOf(':') < 0);
};

/* ①② 的键集（模块级声明：G2/G3 与 G4 共用同一份枚举，⛔ 不得各写一套） */
const A_COLON = COLON_KEYS(A_ARGS);
const A_SHORT = SHORTHAND_KEYS(A_ARGS);
const B_COLON = COLON_KEYS(B_ARGS);
const B_SHORT = SHORTHAND_KEYS(B_ARGS);

/* ==================================================================== *
 * G2 / G3. ①② 的输入上下文（键集 + 唯一分叉点）
 * ==================================================================== */
{
  /* G2. ① 的输入：8 个 `key: value` + 2 个简写（cooldownDays / sectorRemainingLimit）
   *     ⇒ 共 **10** 个输入；⛔ 不含 advisoryStageOverride。 */
  assert.deepStrictEqual(A_COLON, [
    'fundamental', 'risk', 'portfolio', 'trendStageState', 'shockState',
    'recentSlowBreakScores', 'riskEvents', 'bars'
  ], '★ census：① 的 `key: value` 输入键集必须稳定（新增/删除即打红，须同步更新 census）');
  assert.deepStrictEqual(A_SHORT, ['cooldownDays', 'sectorRemainingLimit'],
    '★ census：① 的简写传参必须为 cooldownDays + sectorRemainingLimit');
  assert.ok(!/advisoryStageOverride/.test(A_ARGS),
    '★ census：① **不得**传 advisoryStageOverride（它自算阶段；Δ2 的存在前提）');

  /* G3. ② 的输入：10 个 `key: value` + 1 个简写 ⇒ 共 **11** 个输入 */
  assert.deepStrictEqual(B_COLON, [
    'fundamental', 'risk', 'portfolio', 'sectorRemainingLimit', 'trendStageState',
    'shockState', 'recentSlowBreakScores', 'riskEvents', 'bars', 'advisoryStageOverride'
  ], '★ census：② 的 `key: value` 输入键集必须稳定');
  assert.deepStrictEqual(B_SHORT, ['cooldownDays'],
    '★ census：② 的简写传参必须只剩 cooldownDays（sectorRemainingLimit 必须显式取值）');

  /* 键层面差集 ⇒ 语义 delta 恰 2 项（Δ1 / Δ2），其余输入必须逐项同源（由 G4 的 SAME 表穷举） */
  const deltaKeys = B_COLON.filter((k) => A_COLON.indexOf(k) < 0);
  const missingKeys = A_COLON.filter((k) => B_COLON.indexOf(k) < 0);
  assert.deepStrictEqual(deltaKeys, ['sectorRemainingLimit', 'advisoryStageOverride'],
    '★ census：② ∖ ① 的显式键必须**恰**为 {sectorRemainingLimit, advisoryStageOverride}');
  assert.deepStrictEqual(missingKeys, [],
    '★ census：① ∖ ② 的显式键必须为空（② 不得丢输入）');
  assert.deepStrictEqual(A_SHORT.filter((k) => B_SHORT.indexOf(k) < 0), ['sectorRemainingLimit'],
    '★ census：① 的简写 sectorRemainingLimit 必须在 ② 中转为**显式取值**（Δ1 的落实形态）');
  assert.strictEqual(new Set(A_COLON.concat(A_SHORT)).size, 10,
    '★ census：① 的输入总数必须为 10');
  assert.strictEqual(new Set(B_COLON.concat(B_SHORT)).size, 11,
    '★ census：② 的输入总数必须为 11（10 + advisoryStageOverride）');

  /* G3b. Δ2 = 唯一语义变量：② 传 `advisoryStageOverride: stage`，且 stage 来自 `gen1-canary.js` */
  assert.ok(/advisoryStageOverride: stage\b/.test(normB),
    '★ census：② 必须以回调实参 `stage` 覆盖阶段（⛔ 不得写死字面量）');
  assert.ok(/effectiveStage = 'S4';/.test(CANARY_CODE),
    '★ census：② 的 S4 语义必须由 gen1-canary.js 决定（effectiveStage = S4）');
  assert.ok(/src\.recomputeCanaryTarget\('S4'\)/.test(CANARY_CODE),
    '★ census：② 的回调实参恒为字面量 S4（⇒ 不存在「shadow 跑在别的 stage」的路径）');
  assert.ok(/if \(!canaryCtx\) return \{ target: baselineTarget, action: baselineAction \};/.test(RDE_CODE),
    '★ census：② 必须有 canaryCtx 缺失时的短路守卫（触发条件的第二个合取项）');
}

/* ==================================================================== *
 * G4. Input delta：Δ1 = **账本差**（不是 clamp 差）+ 其余输入逐项同源
 * ==================================================================== */
{
  /* Δ1a. 两处 sector 剩余额度构造式**同形** ⇒ Δ1 不是「一方未 clamp」 */
  assert.ok(/sectorRemainingLimit = Math\.max\(0, effectiveTechMax - \(sectorUsed - current\)\);/.test(RDE_CODE),
    '★ census：① 侧 sector 剩余额度必须仍为 Math.max(0, cap - (used - current)) 形态');
  assert.ok(/return Math\.max\(0, cap - \(used - current\)\);/.test(CANARY_CODE),
    '★ census：② 侧 counterfactualSectorRemaining 必须与生产同形');
  assert.ok(/if \(x\.isTech !== true \|\| cap == null\) return null;/.test(CANARY_CODE),
    '★ census：② 侧非科技 ETF 必须返回 null（与生产 sectorRemainingLimit = null 一致）');
  assert.ok(/sectorRemainingLimit: canarySectorRemaining/.test(normB),
    '★ census：② 的 sectorRemainingLimit 必须取自 canary 反事实账本（Δ1 的落实点）');

  /* Δ1b. 两本账的**初值表达式**除变量名外逐字符相同（同一起点 ⇒ 差异只能来自推进方式） */
  const SEED_PROD = 'let sectorUsed = portfolio.tech_position != null ? portfolio.tech_position : 0;';
  const SEED_CANARY = 'let canarySectorUsed = portfolio.tech_position != null ? portfolio.tech_position : 0;';
  assert.ok(RDE_CODE.indexOf(SEED_PROD) >= 0, '★ census：生产账本初值表达式必须原样存在');
  assert.ok(RDE_CODE.indexOf(SEED_CANARY) >= 0, '★ census：Canary 账本初值表达式必须原样存在');
  assert.strictEqual(SEED_PROD.replace('sectorUsed', ''), SEED_CANARY.replace('canarySectorUsed', ''),
    '★ census：两本账初值必须除变量名外逐字符相同（否则 ② 的起点偏差会被误记成 GE-03 引入）');

  /* Δ2 已在 G2/G3 断言（键集差 + stage 来源）；此处复核 ② 用回调实参、⛔ 不写死 */
  assert.ok(!/advisoryStageOverride: 'S4'/.test(RDE_CODE),
    '★ census：⛔ 不得把 advisoryStageOverride 写成字面量 S4（会切断与 canary 的同一次重跑关系）');

  /* 其余输入：① 的取值 vs ② 的取值 —— 同表达式，或经 canaryCtx 绑定到同一来源 */
  const SAME = [
    ['fundamental', 'p.fundamental', 'p.fundamental'],
    ['risk', 'p.risk', 'p.risk'],
    ['cooldownDays', 'cooldownDays', 'cooldownDays'],
    ['riskEvents', 'p.risk.events || []', 'p.risk.events || []'],
    ['portfolio', 'v3Portfolio', 'canaryCtx.portfolio'],
    ['trendStageState', 'v3TrendStageState', 'canaryCtx.trendStageState'],
    ['shockState', 'v3ShockState', 'canaryCtx.shockState'],
    ['recentSlowBreakScores', 'v3SlowBreakHistory', 'canaryCtx.slowBreakScores'],
    ['bars', 'etfBars', 'canaryCtx.bars']
  ];

  /* canaryCtx 字面量的绑定表（② 复用 ① 那一刻的上下文） */
  const ctxStart = RDE_CODE.indexOf('canaryCtx = {');
  const ctxEnd = RDE_CODE.indexOf('};', ctxStart);
  assert.ok(ctxStart > 0 && ctxEnd > ctxStart, '★ census：canaryCtx 字面量必须存在且闭合');
  const CTX_SRC = RDE_CODE.slice(ctxStart, ctxEnd).replace(/\s+/g, ' ');
  const CTX = [
    ['portfolio', 'v3Portfolio'],
    ['bars', 'etfBars'],
    ['trendStageState', 'v3TrendStageState'],
    ['shockState', 'v3ShockState'],
    ['slowBreakScores', 'v3SlowBreakHistory']
  ];
  for (const [k, src] of CTX) {
    assert.ok(CTX_SRC.indexOf(`${k}: ${src}`) >= 0,
      `★ census：canaryCtx.${k} 必须绑定到 ${src}（② 的输入同源证明链）`);
  }
  /* canaryCtx 另以**简写**捕获生产的 sectorRemainingLimit（仅记录，② 并不用它 ——
   * ② 的 sectorRemainingLimit 取自 canarySectorRemaining，见下 Δ1a） */
  const ctxBody = CTX_SRC.replace(/^canaryCtx\s*=\s*\{/, '').replace(/\s+/g, ' ');
  assert.ok(ctxBody.split(',').map((p) => p.trim()).indexOf('sectorRemainingLimit') >= 0,
    '★ census：canaryCtx 必须以**简写**捕获生产 sectorRemainingLimit（供审计比对，⛔ 不得删除）');
  assert.ok(!/canaryCtx\.sectorRemainingLimit/.test(RDE_CODE),
    '★ census：⛔ ② 不得用 canaryCtx.sectorRemainingLimit 冒充反事实额度（那会静默丢掉 Δ1）');

  for (const [opt, exprA, exprB] of SAME) {
    const found = exprA === opt
      ? new RegExp(`\\b${opt}\\b`).test(normA)
      : normA.indexOf(`${opt}: ${exprA}`) >= 0;
    assert.ok(found, `★ census：① 必须以「${opt}: ${exprA}」形态传参（键或取值被改动即打红）`);
    const m = /^canaryCtx\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(exprB);
    if (!m) {
      assert.strictEqual(exprB, exprA,
        `★ census：${opt} 在 ①② 必须是同一表达式（或以 canaryCtx.* 形式同源）`);
      continue;
    }
    const bind = CTX.filter((r) => r[0] === m[1])[0];
    assert.ok(bind, `★ census：canaryCtx.${m[1]} 必须在 canaryCtx 字面量中绑定`);
    assert.strictEqual(bind[1], exprA,
      `★ census：${opt} 的 ② 取值 canaryCtx.${m[1]} 必须绑定到 ① 的同一来源 ${exprA}`
      + '（否则不是「逐项相同」，而是一个未登记的新 delta）');
  }

  /* SAME 表必须**穷举**「① 的全部输入 ∖ 2 项 delta」—— 漏项即存在未登记的 delta */
  const DELTA_OPTS = ['sectorRemainingLimit', 'advisoryStageOverride'];
  const covered = SAME.map((r) => r[0]).sort();
  const expected = [...new Set(A_COLON.concat(A_SHORT))]
    .filter((k) => DELTA_OPTS.indexOf(k) < 0).sort();
  assert.deepStrictEqual(covered, expected,
    '★ census：SAME 表必须恰好覆盖「① 的全部输入 ∖ 2 项 delta」（漏项 = 未登记的 delta）');

  /* ① 捕获慢破位序列**先于** append（否则 ② 会拿到被污染的 history） */
  const iCtx = RDE_CODE.indexOf('canaryCtx = {');
  const iAppend = RDE_CODE.indexOf('appendSlowBreakHistory(');
  assert.ok(iAppend > iCtx,
    '★ census：canaryCtx 必须在 appendSlowBreakHistory 之前捕获 slowBreakScores'
    + '（否则 ② 与 ① 的 recentSlowBreakScores 不同源）');
}

/* ==================================================================== *
 * G5. ②③ 共享：③ 调用次数 = 0（认领，⛔ 无第三次调用）
 * ==================================================================== */
{
  /* 环 1：② 的回调内把**那一次**结果留给 shadow，stage 取回调实参 */
  assert.ok(/canaryS4Rerun = \{ target: c\.final_target, action: c\.final_action, stage: stage \};/.test(RDE_CODE),
    '★ census：共享载体必须在 ② 的回调内写入，且 stage 取回调实参（⛔ 不写死字面量）');

  /* 环 2：`canaryS4Rerun` 恰 1 次赋值、声明初值恒 null、全文件引用恰 3 处 */
  assert.strictEqual(count(RDE_CODE, /canaryS4Rerun = \{/g), 1,
    '★ census：canaryS4Rerun 必须**恰 1 次**赋值（第 2 次赋值 = 第二个 rerun 来源）');
  assert.ok(/let canaryS4Rerun = null;/.test(RDE_CODE),
    '★ census：共享载体必须显式声明并初值 null（未执行 ⇒ 不可认领）');
  assert.strictEqual(count(RDE_CODE, /canaryS4Rerun/g), 3,
    '★ census：canaryS4Rerun 引用必须恰 3 处（声明 + 赋值 + 认领）；新增引用即打红');

  /* 环 3：shadow 侧只认领，⛔ 无任何由 V3 调用直接产生的形态 */
  assert.ok(/guardedShadowResult = claimGuardedShadowResult\(shadowEligibility, canaryS4Rerun\);/.test(RDE_CODE),
    '★ census：shadow 结果必须由 claimGuardedShadowResult(eligibility, 既有 rerun) 认领');
  assert.ok(!/guardedShadowResult\s*=[^;]*runDecision/.test(RDE_CODE),
    '★ census：⛔ guardedShadowResult 不得由任何 V3 调用直接产生（不得重算）');
  assert.ok(/function claimGuardedShadowResult\(eligibility, rerun\)/.test(
    read('src/common/utils/gen1-shadow-eligibility.js')),
    '★ census：认领函数必须存在（其双向 fail-closed 语义由 G1-AA/G1-AB 另行断言）');

  /* ③ 的调用次数 = 0：认领函数体**不含**任何 runDecision / require */
  const elfSrc = codeOnly(read('src/common/utils/gen1-shadow-eligibility.js'));
  assert.ok(!/runDecision/i.test(elfSrc),
    '★ census：guarded shadow 模块必须**零** V3 调用（③ 的调用次数 = 0 的源码级证明）'
    + '（大小写不敏感：`RunDecision` 之类的别名形态同样打红）');

  /* 触发条件一致性：③ 的两个合取项都在**认领那一刻**求值 */
  assert.ok(/const shadowEligibility = deriveGuardedShadowEligibility\(gen1Permission\);/.test(RDE_CODE),
    '★ census：③ 的资格必须来自 permission 信封派生（唯一来源，⛔ 不另算阈值）');
  const iElig = RDE_CODE.indexOf('const shadowEligibility = ');
  const iClaim = RDE_CODE.indexOf('guardedShadowResult = claimGuardedShadowResult(');
  assert.ok(iElig > 0 && iClaim > iElig, '★ census：资格派生必须早于认领（同一轮内同源）');
}

/* ==================================================================== *
 * G6. 计数器与 census 对齐（增量条件 + 先后序）
 * ==================================================================== */
{
  assert.strictEqual(count(RDE_CODE, /canaryInvocationCount \+= 1;/g), 1);
  assert.strictEqual(count(RDE_CODE, /guardedShadowEligibleCount \+= 1;/g), 1);
  assert.strictEqual(count(RDE_CODE, /guardedShadowInvocations \+= 1;/g), 1);

  assert.ok(/if \(canary\.gen1_canary_effective === true\) canaryInvocationCount \+= 1;/.test(RDE_CODE),
    '★ census：② 的计数条件 = canary 实际生效（与 ② 的触发条件区分开）');
  assert.ok(/if \(shadowEligibility\.eligible\) guardedShadowEligibleCount \+= 1;/.test(RDE_CODE),
    '★ census：③ 的**资格**计数条件 = eligible === true（⛔ 不等于调用次数）');
  assert.ok(/if \(guardedShadowResult != null\) guardedShadowInvocations \+= 1;/.test(RDE_CODE),
    '★ census：③ 的**实际认领**计数条件 = 认领成功（⇒ 恒 ≤ eligible_count）');

  /* 先后序：③资格 → ②生效 → ③认领。
   *   ⚠️ 资格派生**早于** ② 重跑 —— 它来自 permission 信封（不依赖任何 V3 调用），
   *      这是「③ 的资格与 ② 的执行解耦」在源码顺序上的体现（§0.2.1「eligible 增而 invocation 不增」）。*/
  const iCanaryCnt = RDE_CODE.indexOf('canaryInvocationCount += 1;');
  const iEligCnt = RDE_CODE.indexOf('guardedShadowEligibleCount += 1;');
  const iShadowCnt = RDE_CODE.indexOf('guardedShadowInvocations += 1;');
  assert.ok(iEligCnt < iCanaryCnt,
    '★ census：③ 的资格派生必须早于 ② 重跑（资格来自 permission 信封，不依赖 V3 调用）');
  assert.ok(iCanaryCnt < iShadowCnt,
    '★ census：② 生效计数必须早于 ③ 认领计数（认领依赖 ② 的结果）');
  const iDerive = RDE_CODE.indexOf('const shadowEligibility = deriveGuardedShadowEligibility(');
  assert.ok(iDerive < iEligCnt && iDerive > 0,
    '★ census：资格必须先派生再计数（⛔ 不得先计数后派生）');

  /* ④ 采纳计数与 shadow 通道**无关**（census 的三计数器口径独立性） */
  assert.ok(/if \(guardedSelection\.authoritative_source === SELECTOR_SOURCE\.GUARDED\s*\n?\s*&& guardedAudit\.gen1_adopted === true\) \{/.test(RDE_CODE)
    || /guardedAudit\.gen1_adopted === true\) \{/.test(RDE_CODE),
    '★ census：④ 采纳计数必须绑定 selector 采纳结果，⛔ 不得由 shadow 通道驱动');
  assert.ok(!/guardedShadow[\s\S]{0,200}guardedEffectiveInvocations \+= 1;/.test(RDE_CODE),
    '★ census：⛔ shadow 通道不得增加 gen1_guarded_effective_invocations');
}

/* ==================================================================== *
 * G7. 交付物文档：存在性 + LF + 关键结论标记
 * ==================================================================== */
{
  assert.ok(exists(CENSUS_REL), `★ §2.1：必须提交 S4 invocation census 文档：${CENSUS_REL}`);
  const DOC = readLF(CENSUS_REL);
  /* ⚠️ 不断言**工作区** EOL：本仓 `core.autocrlf=true`，工作区 EOL 随 checkout 平台变化，
   *    而 blob 恒为 LF（git 在提交侧归一化）⇒ 断工作区 CRLF 会在他机 checkout 上假红。
   *    只断言 LF 归一的**内容**与结尾换行。 */
  assert.ok(/\n$/.test(DOC), '★ §2.1：census 文档必须以换行结尾（LF 归一后）');

  const MARKERS = [
    '① baseline V3',
    '② 既有 Canary S4 rerun',
    '③ Guarded Shadow rerun',
    'immutable V3 的调用点总数恒为 2',
    'Δ1：账本 + 键形态',
    'Δ2：唯一语义变量',
    '计数器求值次序',
    '③ **不产生任何 V3 调用**',
    'claimGuardedShadowResult',
    'base SHA `5c517bcc45736e868921de89d4ee007142eb0602`',
    'legacy / V3.8'
  ];
  for (const mk of MARKERS) {
    assert.ok(DOC.indexOf(mk) >= 0, `★ §2.1：census 文档必须含结论标记「${mk}」`);
  }
  /* 行号必须被声明为「定位辅助」，否则 master 前进后行号漂移会被当成结论失效 */
  assert.ok(/行号口径/.test(DOC) && /定位辅助/.test(DOC),
    '★ §2.1：census 文档必须声明行号口径 = 定位辅助（权威判据 = 本测试的结构锚点）');
}

console.log('gen1-ge03-s4-census: PASS（G1-AF：调用点分类 / input delta / Δ1 账本差 / ③ 零调用 / 计数器对齐）');
