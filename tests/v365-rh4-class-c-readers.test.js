#!/usr/bin/env node
/**
 * WP-RH4 —— Historical Reader Migration / CLASS C 双源 provenance 专项测试（H-01 ~ H-12）
 *
 * RH4 范围（冻结依据 `V365_RUN_LIFECYCLE_IMPLEMENTATION_ROADMAP.md` §WP-RH4 +
 *          `V365_RUN_LIFECYCLE_ARCHITECTURE_DECISION.md` OD-4 §4.5）：
 *   CLASS C 5 个读点迁移 + 双源 provenance
 *   修改文件：`apiGateway/index.js`（getDecisions:667 · getReview:776/784）·
 *             `cooldown.js`（:25）· `runIntegratedShadowEod`（:220/222）·
 *             `runGen1ShadowEod`（:81-83）· `v365-active-read.js`（ALLOWED_LATEST_READS 重登记）
 *
 * ⚠️ 关键约束（OD-4 §4.5）：CLASS C 进入**双源读取**；
 *    ⛔ **不得**把两段静默拼成一条序列 ⇒ 必须携带**分段 provenance**。
 *
 * 本测试**不改**任何生产文件，只做静态 + 行为断言。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

const API_GW = 'cloudfunctions/apiGateway/index.js';
const COOLDOWN = 'src/common/utils/cooldown.js';
const SHADOW_INT = 'cloudfunctions/runIntegratedShadowEod/index.js';
const SHADOW_GEN1 = 'cloudfunctions/runGen1ShadowEod/index.js';
const ACTIVE_READ = 'src/common/utils/v365-active-read.js';

const AR = require(path.join(REPO, ACTIVE_READ));
const ALLOW_RE = /v365-reader-allow:(mutable-axis|input-data|history-deferred|non-authoritative-diagnostic)/;

let pass = 0;
const ok = (n, d) => { pass++; console.log(`[PASS] ${n}${d ? ' — ' + d : ''}`); };

/* ================= H-01 CLASS C 读点全部显式登记（机器可判定）================= */
{
  const pts = AR.CLASS_C_READ_POINTS;
  assert.ok(Array.isArray(pts) && pts.length >= 5,
    `CLASS_C_READ_POINTS 必须至少 5 项（冻结范围「5 个读点」）；实测 ${pts ? pts.length : 0}`);
  const unmigrated = pts.filter((p) => p.migrated !== true);
  assert.deepStrictEqual(unmigrated.map((p) => p.id), [],
    `⛔ 所有 CLASS C 读点必须显式登记为 migrated：${unmigrated.map((p) => p.id).join(', ')}`);
  ok('H-01 CLASS C 读点全部显式登记', `${pts.length} 项：` + pts.map((p) => p.id).join(' · '));
}

/* ================= H-02 5 个冻结读点一一对应（防漏登记）================= */
{
  const ids = AR.CLASS_C_READ_POINTS.map((p) => p.id);
  // 冻结清单（roadmap §WP-RH4「修改文件」列的 5 处）
  const REQUIRED = [
    'apiGateway.getDecisions',
    'apiGateway.getReview.decisions',
    'apiGateway.getReview.snapshots',
    'cooldown.resolveLastBuyAddMode',
    'runIntegratedShadowEod.baselineLatest',
    'runGen1ShadowEod.latestMarketRegime'
  ];
  for (const r of REQUIRED) {
    assert.ok(ids.includes(r), `冻结读点必须登记：${r}`);
  }
  // 每个登记项必须给出 run 轴目标（⛔ 不能空泛写"待迁移"）
  for (const p of AR.CLASS_C_READ_POINTS) {
    assert.ok(p.run_axis_target && String(p.run_axis_target).length > 0,
      `${p.id} 必须声明 run_axis_target（迁移目标）`);
  }
  ok('H-02 冻结读点一一对应', `${REQUIRED.length} 个冻结读点全部登记 · 每项含 run_axis_target`);
}

/* ================= H-03 读点可见性：文件内标记 **或** 带外登记 ================= */
{
  const problems = [];
  // ⛔ 关键规则：**CALC 绝对保护**文件不得有任何改动 ⇒ 其读点只能**带外登记**
  //    （由 `in_file_marker_allowed:false` + `marker_style:OUT_OF_BAND_REGISTRY_ONLY` 声明）
  const pts = AR.CLASS_C_READ_POINTS;
  const needsInFile = pts.filter((p) => p.in_file_marker_allowed !== false);
  const outOfBand = pts.filter((p) => p.in_file_marker_allowed === false);

  // (a) 需要文件内标记的读点 ⇒ 必须真的能找到标记
  const gw = read(API_GW);
  const gwLines = gw.split(/\r?\n/);
  const gwTargets = [
    { line: 667, what: 'getDecisions' },
    { line: 776, what: 'getReview.decisions' },
    { line: 784, what: 'getReview.snapshots' }
  ];
  for (const t of gwTargets) {
    const ln = gwLines[t.line - 1] || '';
    if (!ALLOW_RE.test(ln)) problems.push(`${API_GW}:${t.line}(${t.what}) 缺轴标记`);
  }
  const others = [
    { file: SHADOW_INT, re: /v365-reader-allow:history-deferred/, what: 'runIntegratedShadowEod' }
  ];
  for (const o of others) {
    if (!o.re.test(read(o.file))) problems.push(`${o.file}(${o.what}) 缺轴标记`);
  }
  assert.deepStrictEqual(problems, [], `⛔ 需文件内标记的读点必须带轴标记：\n  ${problems.join('\n  ')}`);

  // (b) 带外登记的读点 ⇒ 必须给出**正当的不可改理由**（CALC 或字节级冻结）
  const CLASSIFICATION = require(path.join(REPO, 'scripts/lib/v365-decision-classification.js'));
  for (const p of outOfBand) {
    const isCalc = CLASSIFICATION.classify(p.file) === 'CALC';
    const isFrozen = !!p.frozen_by;
    assert.ok(isCalc || isFrozen,
      `⛔ ${p.id} 声明带外登记 ⇒ 必须属 CALC（实际 ${CLASSIFICATION.classify(p.file)}）`
      + ` 或声明 frozen_by（字节级冻结）；否则应在文件内加标记`);
    assert.strictEqual(p.marker_style, 'OUT_OF_BAND_REGISTRY_ONLY',
      `${p.id} 必须声明 marker_style=OUT_OF_BAND_REGISTRY_ONLY`);
    if (isFrozen) {
      assert.ok(/GEN1_FEATURE_PIPELINE_LOCK|LOCK/.test(p.frozen_by),
        `${p.id}.frozen_by 必须指向真实的冻结锁文件`);
    }
  }
  assert.strictEqual(outOfBand.length, 2,
    `带外登记读点应恰为 2 个（cooldown=CALC · runGen1ShadowEod=Gen-1 Lock）；实测 ${outOfBand.length}`);
  ok('H-03 读点可见性（文件内标记 ∨ 带外登记）',
    `文件内标记 ${needsInFile.length} 项 · 带外登记 ${outOfBand.length} 项（CALC / Gen-1 Lock）`);
}

/* ================= H-03b ⛔ 不可改文件零改动（RH4 硬边界）================= */
{
  const { spawnSync } = require('child_process');
  const outOfBand = AR.CLASS_C_READ_POINTS.filter((p) => p.in_file_marker_allowed === false);
  for (const p of outOfBand) {
    const r = spawnSync('git', ['diff', '--name-only', 'HEAD', '--', p.file],
      { cwd: REPO, encoding: 'utf8' });
    assert.strictEqual(String(r.stdout).trim(), '',
      `⛔⛔ ${p.file} 不可改（${p.frozen_by ? '字节级冻结：' + p.frozen_by : 'CALC 绝对保护'}）`
      + ` ⇒ 必须**零改动**（连注释都不行）；实测有改动`);
  }
  // Gen-1 冻结文件的锁校验必须通过（证明回退彻底）
  // ⚠️ F-22（2026-10-05 · OWNER DECISION: A — ACCEPT）原判据硬编码固定计数「10/10 项通过」；
  //    C3-R2（b2af60e）已批准地把 Feature Pipeline Lock 由 4 roles 扩为 5 roles，
  //    故 verifier 自洽输出为 11/11；本守卫的本意是「锁自洽」（分子 == 分母），
  //    与历史条目数无关 ⇒ 改为计数无关的自洽校验。
  //    ⛔ 未放宽为「存在数字」；⛔ 未绕过 verifier；⛔ 未改 verifier 输出；⛔ 未改 production semantics。
  const g = spawnSync('node', ['scripts/verify-gen1-pipeline.js'], { cwd: REPO, encoding: 'utf8' });
  const mPip = /(\d+)\/(\d+) 项通过/.exec(String(g.stdout));
  assert.ok(mPip !== null && mPip[1] === mPip[2],
    '⛔ 冲突：Gen-1 Feature Pipeline Lock 必须 N/N 全通过（verifier 输出须自洽）'
    + ` ⇒ 实测 ${mPip ? mPip[1] + '/' + mPip[2] : '无 N/N 项通过 输出'}`);
  ok('H-03b 不可改文件零改动（cooldown + runGen1ShadowEod）',
    outOfBand.map((p) => p.file).join(', ') + ` · Gen-1 Lock ${mPip[1]}/${mPip[2]}`);
}

/* ================= H-04 runGen1ShadowEod 不得被误标为 history-deferred ================= */
{
  const s = read(SHADOW_GEN1);
  assert.ok(!/v365-reader-allow:history-deferred/.test(s),
    '⛔ runGen1ShadowEod 是**影子观察域诊断值** ⇒ 必须标 non-authoritative-diagnostic，'
    + '⛔ 不得借用 history-deferred（会掩盖"它不参与历史区间读取"的事实）');
  ok('H-04 runGen1ShadowEod 轴标注正确', 'non-authoritative-diagnostic');
}

/* ================= H-05 双源 provenance 构造器存在且 additive ================= */
{
  assert.strictEqual(typeof AR.buildClassCProvenance, 'function',
    '必须提供 buildClassCProvenance（CLASS C 分段 provenance 构造器）');
  const p = AR.buildClassCProvenance({ from: '2026-01-01', to: '2026-09-22' });
  // additive：新增键，不改动既有响应字段
  for (const k of ['reader_class', 'axis', 'coverage', 'switch_date', 'from', 'to',
    'crosses_switch_date', 'stitched', 'segments', 'run_axis_available',
    'run_axis_status', 'silent_stitch_forbidden', 'latest_fallback_used']) {
    assert.ok(Object.prototype.hasOwnProperty.call(p, k), `provenance 必须含键 ${k}`);
  }
  assert.strictEqual(p.reader_class, AR.READER_CLASS.HISTORICAL_RANGE,
    'reader_class 必须是 CLASS_C_HISTORICAL_RANGE');
  assert.strictEqual(p.latest_fallback_used, false, '⛔ 不得使用 latest fallback');
  ok('H-05 buildClassCProvenance 存在且字段完备', Object.keys(p).length + ' 键');
}

/* ================= H-06 ⛔ 静默拼接被禁止（机器可判定）================= */
{
  const p = AR.buildClassCProvenance({ from: '2026-01-01', to: '2026-09-22' });
  assert.strictEqual(p.silent_stitch_forbidden, true,
    '⛔ provenance 必须含 silent_stitch_forbidden=true（OD-4 §4.5：不得静默拼成一条序列）');
  // stitched=true ⇒ 必须带 segments（⛔ 不能只给个布尔就完事）
  if (p.stitched === true) {
    assert.ok(Array.isArray(p.segments) && p.segments.length >= 2,
      '⛔ stitched=true 时必须携带分段清单：segments（至少 2 段）');
    for (const s of p.segments) {
      for (const k of ['axis', 'collection_source', 'from', 'to', 'selector']) {
        assert.ok(s[k] != null, `段必须含 ${k}`);
      }
    }
  }
  ok('H-06 静默拼接被禁止', `stitched=${p.stitched} · segments=${(p.segments || []).length} · silent_stitch_forbidden=true`);
}

/* ================= H-07 coverage 三态如实（⛔ 不得谎称已双源）================= */
{
  const legacyOnly = AR.buildClassCProvenance({ from: '2026-08-01', to: '2026-09-22' });
  // 切换日未登记 ⇒ 必须如实说 legacy_only（⛔ 不得说已双源）
  assert.strictEqual(AR.V365_ENFORCE_SWITCH_DATE, null,
    '⚠️ 本测试锁定当前事实：ENFORCE 切换日**尚未登记**（部署时登记）');
  assert.strictEqual(legacyOnly.coverage, AR.CLASS_C_COVERAGE.LEGACY_ONLY,
    '切换日未登记 ⇒ coverage 必须是 legacy_only');
  assert.strictEqual(legacyOnly.run_axis_available, false,
    '⛔ run 轴索引未建成（RUN_HISTORY_INDEX=PENDING）⇒ run_axis_available 必须为 false');
  assert.strictEqual(legacyOnly.run_axis_status, 'PENDING_RUN_HISTORY_INDEX',
    'run_axis_status 必须如实标为 PENDING_RUN_HISTORY_INDEX');
  assert.ok(!/\bAVAILABLE\b/.test(legacyOnly.run_axis_status),
    '⛔ 不得在索引未建成时声称 run 轴 AVAILABLE');
  // 跨切换日：即便请求跨切，索引未建成 ⇒ INCOMPLETE_GAP（⛔ 不得谎称已拼接）
  const cross = AR.buildClassCProvenance({ from: '2026-01-01', to: '2026-09-22' });
  assert.strictEqual(cross.coverage, AR.CLASS_C_COVERAGE.LEGACY_ONLY,
    '⚠️ 切换日未登记 ⇒ 即便请求跨切也**只能** legacy_only（⛔ 不得凭区间形状伪造双源）');
  ok('H-07 coverage 如实三态', `legacy_only · run_axis_available=false · status=PENDING_RUN_HISTORY_INDEX`);
}

/* ================= H-08 切换日登记后：跨切必须拼接且分段落实名 ================= */
{
  // 临时把切换日视为已登记（⛔ 不修改模块，用注入式验证逻辑正确性）
  AR.V365_ENFORCE_SWITCH_DATE;   // 只读引用（Object.freeze 场景下为 null）
  // 直接构造：借 buildClassCProvenance 的区间分支语义验证（run_axis_rows_available=true）
  // ⇒ 当 switch_date 为 null 时，任何区间都 legacy_only（已在 H-07 锁定）
  // 这里锁定**规则本身**存在于源码（结构可判）
  const src = read(ACTIVE_READ);
  assert.ok(/coverage = runAxisOk \? CLASS_C_COVERAGE\.CROSS_SWITCH_STITCHED : CLASS_C_COVERAGE\.INCOMPLETE_GAP/.test(src),
    '切换日已登记 + run 轴可用 ⇒ 跨切必须为 CROSS_SWITCH_STITCHED');
  assert.ok(/CLASS_C_COVERAGE\.INCOMPLETE_GAP/.test(src),
    '必须能表达 INCOMPLETE_GAP（切换日后无 run 轴数据 ⇒ 有缺口）');
  assert.ok(/segments\.push\(\{[\s\S]{0,200}?axis: 'LEGACY_ARCHIVE'/.test(src),
    '分段必须包含 LEGACY_ARCHIVE 段');
  assert.ok(/segments\.push\(\{[\s\S]{0,220}?axis: 'RUN_AXIS'/.test(src),
    '分段必须包含 RUN_AXIS 段');
  ok('H-08 拼接规则可判定', 'CROSS_SWITCH_STITCHED / INCOMPLETE_GAP / 两段实名');
}

/* ================= H-09 标记感知扫描：零未声明违规（RH4 口径升级）================= */
{
  assert.strictEqual(typeof AR.scanForbiddenReadsDetailed, 'function',
    '必须提供 scanForbiddenReadsDetailed（标记感知扫描）');
  const files = [API_GW, COOLDOWN, SHADOW_INT, SHADOW_GEN1];

  // 「带外登记」的文件：其读点已由 CLASS_C_READ_POINTS 显式登记，
  // ⛔ 但这些文件**不可改**（CALC / Gen-1 Lock）⇒ 无法在源码内标记
  // ⇒ 违规 = 既无同行标记、**也不**在任何登记表中
  const registryFiles = new Set(AR.CLASS_C_READ_POINTS.map((p) => p.file));
  const outOfBandFiles = new Set(
    AR.CLASS_C_READ_POINTS.filter((p) => p.in_file_marker_allowed === false).map((p) => p.file)
  );

  let violations = 0; let declared = 0; let outOfBandCovered = 0;
  for (const f of files) {
    const r = AR.scanForbiddenReadsDetailed(read(f), f);
    declared += r.declared_ignored;
    const real = r.hits.filter((h) => !(outOfBandFiles.has(f) && registryFiles.has(f)));
    outOfBandCovered += r.hits.length - real.length;
    violations += real.length;
    assert.deepStrictEqual(real, [],
      `⛔ ${f} 必须零**未声明**违规（同行标记 ∨ 带外登记）：`
      + real.map((h) => `L${h.line} ${h.pattern}`).join(', '));
  }
  assert.ok(declared + outOfBandCovered >= 5,
    `⚠️ 豁免数必须如实统计（⛔ 防"静默豁免"）；实测 同行标记=${declared} 带外登记=${outOfBandCovered}`);
  ok('H-09 标记感知扫描零未声明违规',
    `违规=0 · 同行标记=${declared} · 带外登记=${outOfBandCovered}`);
}

/* ================= H-10 向后兼容：scanForbiddenReads 仍返回数组 ================= */
{
  const r = AR.scanForbiddenReads(read(COOLDOWN), COOLDOWN);
  assert.ok(Array.isArray(r), '⛔ scanForbiddenReads 必须仍返回**数组**（既有调用方兼容）');
  assert.strictEqual(r.declared_ignored, 0, 'cooldown 的读点是**带外声明**（上方注释）⇒ 该文件自身无同行标记');
  ok('H-10 向后兼容（返回数组）');
}

/* ================= H-11 cooldown 读点语义未被改写（⛔ CALC 绝对保护）================= */
{
  const s = read(COOLDOWN);
  // 必须仍是**按买入日单点回查**
  assert.ok(/db\.query\(COLLECTIONS\.DECISION_RESULT,\s*\{\s*code,\s*decision_date:\s*buyDate\s*\}/.test(s),
    '⛔ cooldown 读点必须保持「按 code + buyDate 单点回查」语义（⛔ 不得改为区间/最新读）');
  assert.ok(!/orderBy.*decision_date.*desc/.test(s),
    '⛔ cooldown 不得引入"按日期取最新"（会把它从单点回查变成猜权威结果）');
  // ⛔⛔ CALC 绝对保护：**不得**要求该文件带任何标记（连注释都不行）
  assert.ok(!ALLOW_RE.test(s),
    '⛔⛔ cooldown.js 属 CALC（绝对保护）⇒ **不得**有 v365 标记（连注释都算改动）');
  // 但必须有**带外登记**（本表的登记项）
  const p = AR.CLASS_C_READ_POINTS.find((x) => x.file === COOLDOWN);
  assert.ok(p, '⛔ cooldown 读点必须有带外登记（文件不能改 ⇒ 审计只能靠登记表）');
  assert.strictEqual(p.in_file_marker_allowed, false, 'cooldown 必须声明不允许文件内标记');
  ok('H-11 cooldown 语义未改写 + CALC 零标记', '仍为 code + buyDate 单点回查 · 带外登记');
}

/* ================= H-12 ⛔ 未触碰不可改文件 · 合格面归属正确 ================= */
{
  const { spawnSync } = require('child_process');
  const CLASSIFICATION = require(path.join(REPO, 'scripts/lib/v365-decision-classification.js'));
  assert.strictEqual(CLASSIFICATION.classify('src/common/constants.js'), 'CALC',
    'constants.js 必须仍是 CALC');

  // RH4 **实际触碰**的文件（⛔ cooldown / runGen1ShadowEod 已回退 ⇒ 不在列）
  const TOUCHED = [API_GW, SHADOW_INT, ACTIVE_READ];
  for (const f of TOUCHED) {
    assert.notStrictEqual(CLASSIFICATION.classify(f), 'CALC',
      `⛔ ${f} 不得属 CALC（RH4 触碰了它）`);
  }

  // ⛔ 两个不可改文件必须零改动
  for (const f of [COOLDOWN, SHADOW_GEN1]) {
    const r = spawnSync('git', ['diff', '--name-only', 'HEAD', '--', f], { cwd: REPO, encoding: 'utf8' });
    assert.strictEqual(String(r.stdout).trim(), '',
      `⛔ ${f} 必须零改动（CALC 绝对保护 / Gen-1 Lock 字节级冻结）`);
  }

  // apiGateway / active-read 在 20 文件合格面内 ⇒ 必须重算 manifest（由 gate 保证）
  const manifest = JSON.parse(read('ml/manifests/V365_CANDIDATE_MANIFEST.json'));
  const members = Object.keys(manifest.file_sha256 || {});
  const inGate = [API_GW, ACTIVE_READ].filter((f) => members.includes(f));
  assert.strictEqual(inGate.length, 2,
    `apiGateway 与 v365-active-read 必须在 20 文件合格面内（实测命中 ${inGate.length}）`);
  // 其余不在合格面（冻结文档 §4 已列）
  for (const f of [COOLDOWN, SHADOW_INT, SHADOW_GEN1]) {
    assert.ok(!members.includes(f), `${f} 不应在合格面内（冻结文档 §4）`);
  }
  ok('H-12 未触碰不可改文件 · 合格面归属正确',
    `合格面内 2 个 · 面外 3 个 · cooldown+runGen1ShadowEod 零改动`);
}

console.log(`\nWP-RH4 Historical Reader Migration 专项测试：H-01 ~ H-12 全部 PASS`);
