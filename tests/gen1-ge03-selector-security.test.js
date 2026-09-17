'use strict';

/**
 * WP-G1-GE-03 G3-07：Guarded 选择器**不可回退**与**权威路径不可污染**的安全守卫。
 *
 * 设计 Gate §2.1（共享 rerun）、§3.3（口径四分离）、§5 D2（两层阻断）/ D11（证据通道隔离）
 * 与 R1（authoritative 唯一来源仍 baseline）/ R4（`GE_02_BASELINE_AUTHORITATIVE` 保持 true）
 * 的机器可判定形式。
 *
 * 与既有 Gate G1-X（`tests/gen1-guarded-selector-noop.test.js`）的分工：
 *   G1-X  —— 「任何输入下都选 baseline」+ overlay no-op + 主链静态守卫（**GE-02 视角**）
 *   本文件 —— **GE-03 视角**的增量：选择器与权限层的**结构隔离**、不可回退的**精确计数**、
 *            对全部矩阵观测的 **∀-量化**断言、审计面**集合收敛**（D12 口径）、证据通道隔离（D11）
 *   ⇒ 两者互补，⛔ 不得互相替代。
 *
 * 覆盖：
 *   A. 结构隔离：选择器**只** require crypto，⛔ 不得 require authority / permission / shadow-eligibility
 *   B. 不可回退：冻结常量 + `authoritativeSource` 字面量 + 两条硬不变量抛错 + `SELECTOR_SOURCE.GUARDED`
 *      出现点**枚举**（恰 3，且全为只读判据，⛔ 无一用于赋值）
 *   C. 对抗输入：陷阱 getter / 冻结对象 / 同对象 / null / undefined / 原始值 ⇒ 恒 BASELINE
 *   D. ∀-量化：harness 的**全部**矩阵观测（41 条）selector 恒 BASELINE 且 adopted 恒 false
 *   E. 主链权威路径：`final_target` **零写入点**；`suggested_position` 唯一写入点是**反事实**字段；
 *      两条 SECURITY 守卫存在；⛔ eligibility 不得冒充 guarded 结果
 *   F. 审计面收敛：`buildGuardedAudit` 键集**恰 13**（GE-03 净增 1）；overlay 键集与 audit 有无**无关**（D12）
 *   G. 证据通道隔离：GE-03 代码零写入 `independent_events`（R8 / D11）
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const U = (f) => require(path.join(REPO, 'src', 'common', 'utils', f));

const {
  selectGuardedResult, buildGuardedAudit, candidateHash,
  SELECTOR_SOURCE, DECISION_SOURCE, GE_02_BASELINE_AUTHORITATIVE
} = U('gen1-guarded-selector');
const { applyGen1Overlay, verifyProductionNoop } = U('gen1-overlay');
const { evaluateGen1Permission } = U('gen1-safety-permission');
const { deriveGuardedShadowEligibility, claimGuardedShadowResult } = U('gen1-shadow-eligibility');
const HARNESS = require(path.join(REPO, 'scripts', 'gen1-ge03-replay-gates.js'));

const RDE = fs.readFileSync(path.join(REPO, 'cloudfunctions/runDecisionEngine/index.js'), 'utf8');
const SELECTOR_SRC = fs.readFileSync(path.join(REPO, 'src/common/utils/gen1-guarded-selector.js'), 'utf8');
const OVERLAY_SRC = fs.readFileSync(path.join(REPO, 'src/common/utils/gen1-overlay.js'), 'utf8');
const ELIG_SRC = fs.readFileSync(path.join(REPO, 'src/common/utils/gen1-shadow-eligibility.js'), 'utf8');

/** 剔除注释（块 + 行），用于源码级守卫。 */
function codeOnly(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
const RDE_CODE = codeOnly(RDE);
const SEL_CODE = codeOnly(SELECTOR_SRC);

const BASELINE = { target: 15, action: 'WAIT', stage: 'S2' };
const DECISION = {
  code: '513310', final_target: 15, final_action: 'WAIT', decision_date: '2026-09-10', suggested_position: 15
};
const BIND = {
  source_sha256: 's'.repeat(64), model_sha256: 'm'.repeat(64),
  threshold_version: 'shadow-threshold-v1', contract_version: 'WP-G1-GE-CH-1.0'
};

/* ==================================================================== *
 * A. 结构隔离：选择器不得接触权限层
 * ==================================================================== */
{
  const requires = SEL_CODE.match(/require\([^)]*\)/g) || [];
  assert.deepStrictEqual(requires, ["require('crypto')"],
    '★ 选择器**只能** require crypto（纯哈希工具）；⛔ 不得 require 权限/资格/封印模块'
    + ' ⇒ 从结构上保证它**没有能力**读取 eligibility / authority 来决定权威来源');

  for (const banned of ['gen1-shadow-eligibility', 'gen1-safety-permission', 'gen1-authority',
    'gen1-guarded-seal', 'shadowEligib', 'evaluateGen1Permission', 'resolveAuthority',
    'readProductionSeals']) {
    assert.strictEqual(SEL_CODE.indexOf(banned), -1,
      `★ 选择器源码⛔不得出现 ${banned}`
      + '（否则它就有能力用「采纳资格」反推权威来源）');
  }
  /* `effectiveGuarded` 是**合法入参**（只驱动 `guarded_considered` 审计镜像），
   * 但⛔ 绝不得参与权威来源判定（否则等于「有资格就采纳」）。 */
  const egLines = SEL_CODE.split('\n').map((l) => l.trim()).filter((l) => /effectiveGuarded/.test(l));
  assert.ok(egLines.length >= 1, '★ 选择器必须显式接收 effectiveGuarded 入参（用于审计镜像）');
  for (const l of egLines) {
    assert.strictEqual(/authoritativeSource\s*=/.test(l) || /(^|[^.\w])selected\s*=/.test(l), false,
      `★ ⛔ effectiveGuarded 不得参与权威来源 / 选中结果的**赋值**：${l}`);
  }
  assert.deepStrictEqual(egLines.filter((l) => /^guarded_considered:/.test(l)),
    ['guarded_considered: effectiveGuarded,'],
    '★ effectiveGuarded 对权威结果**唯一**的作用面 = `guarded_considered` 审计镜像');
  /* ⛔ 枚举域显式声明：selector 目录内只允许这 1 个 require（上条已逐项比对） */
  assert.strictEqual(requires.length, 1, '★ 选择器 require 数必须恰 1（枚举域已在上条闭合）');
}

/* ==================================================================== *
 * B. 不可回退：常量 + 字面量 + 硬不变量 + 出现点枚举
 * ==================================================================== */
{
  assert.strictEqual(GE_02_BASELINE_AUTHORITATIVE, true,
    '★ R4：GE_02_BASELINE_AUTHORITATIVE 运行期必须为 true');
  assert.strictEqual((SEL_CODE.match(/const GE_02_BASELINE_AUTHORITATIVE = true;/g) || []).length, 1,
    '★ R4：冻结开关必须**恰 1 处**且为字面量 true（⛔ 不得改为表达式 / 入参）');

  /* 权威来源必须是**字面量** BASELINE，⛔ 不得由任何入参派生 */
  const srcAssign = SEL_CODE.match(/const authoritativeSource = [^;]*;/g) || [];
  assert.deepStrictEqual(srcAssign, ['const authoritativeSource = SELECTOR_SOURCE.BASELINE;'],
    '★ 权威来源必须**恰 1 处**且为字面量 BASELINE；⛔ 不得读取 src.* / effectiveGuarded / guarded');
  assert.strictEqual(/const selected = baseline;/.test(SEL_CODE), true,
    '★ 选中结果必须**就是** baseline（字面量赋值，⛔ 不得 conditional）');
  assert.strictEqual((SEL_CODE.match(/const selected = [^;]*;/g) || []).length, 1,
    '★ `selected` 赋值必须恰 1 处');

  /* 两条硬不变量抛错必须都在（防「静默回退成 GUARDED」） */
  assert.strictEqual(
    /if \(authoritativeSource === SELECTOR_SOURCE\.GUARDED\) \{\s*throw new Error\(/.test(SEL_CODE), true,
    '★ 必须保留「不得选 GUARDED」的抛错硬不变量');
  assert.strictEqual(/if \(selected !== baseline\) \{\s*throw new Error\(/.test(SEL_CODE), true,
    '★ 必须保留「不得替换 baseline 对象」的抛错硬不变量');

  /* `SELECTOR_SOURCE.GUARDED` 出现点**枚举**：恰 3，且全为只读判据 */
  const guardedRefs = SEL_CODE.split('\n')
    .map((l, i) => ({ i: i + 1, l: l.trim() }))
    .filter((x) => x.l.indexOf('SELECTOR_SOURCE.GUARDED') >= 0);
  assert.strictEqual(guardedRefs.length, 3,
    '★ `SELECTOR_SOURCE.GUARDED` 在 selector 内必须恰 3 处（枚举域显式闭合）：'
    + JSON.stringify(guardedRefs.map((x) => x.l)));
  for (const r of guardedRefs) {
    assert.ok(/=== SELECTOR_SOURCE\.GUARDED/.test(r.l),
      `★ L${r.i} 必须只作**比较**（=== 判据）；⛔ 不得用于赋值：${r.l}`);
    assert.ok(!/^\s*(const|let|var)\s+authoritativeSource\s*=/.test(r.l) && !/selected\s*=/.test(r.l),
      `★ L${r.i} 不得出现在 authoritativeSource / selected 的赋值右侧：${r.l}`);
  }
}

/* ==================================================================== *
 * C. 对抗输入：恒 BASELINE
 * ==================================================================== */
{
  const frozen = Object.freeze({ target: 15, action: 'WAIT', stage: 'S2' });

  /* 陷阱 getter：选择器 ⛔ 不得解引用 guarded 的字段（否则等于「解读」候选） */
  let deref = 0;
  const trap = {};
  for (const k of ['target', 'action', 'stage', 'final_target', 'final_action']) {
    Object.defineProperty(trap, k, { enumerable: true, get() { deref += 1; return 99; } });
  }

  const guardedForms = [
    ['正常对象', { target: 99, action: 'BUILD', stage: 'S4' }],
    ['NaN / Infinity', { target: NaN, action: Infinity, stage: -Infinity }],
    ['原始值 0', 0],
    ['空串', ''],
    ['数组', [99, 'BUILD']],
    ['陷阱 getter', trap],
    ['与 baseline 同一对象', BASELINE]
  ];
  const baselineForms = [
    ['普通对象', BASELINE],
    ['冻结对象', frozen],
    ['null', null],
    ['undefined', undefined],
    ['原始值 0', 0],
    ['空串', '']
  ];

  let combos = 0;
  for (const [bLabel, b] of baselineForms) {
    for (const [gLabel, g] of guardedForms) {
      for (const eg of [true, false]) {
        const expected = b == null ? null : b;
        const sel = selectGuardedResult({ baseline: b, guarded: g, effectiveGuarded: eg });
        combos += 1;
        assert.strictEqual(sel.authoritative_source, SELECTOR_SOURCE.BASELINE,
          `★ baseline=${bLabel} / guarded=${gLabel} / effectiveGuarded=${eg}：权威来源必须恒 BASELINE`);
        assert.strictEqual(sel.selected_result, expected,
          `★ baseline=${bLabel} / guarded=${gLabel}：选中结果必须**引用相等**地等于 baseline`);
        assert.strictEqual(sel.frozen_baseline_only, true, '★ frozen_baseline_only 必须恒 true');
        assert.strictEqual(sel.reason_code, 'DORMANT_BASELINE_AUTHORITATIVE', '★ 原因码必须恒为休眠态');
        assert.strictEqual(sel.delta, null, '★ GE-02/03 不得产出 delta');
        assert.strictEqual(sel.guarded_considered, eg === true, '★ guarded_considered 只镜像入参');
        assert.strictEqual(sel.guarded_available, g != null, '★ guarded_available 只镜像是否传入');
        if (gLabel === '与 baseline 同一对象' && expected === g && g != null) {
          assert.strictEqual(sel.selected_result === sel.guarded_result, true,
            '★ 即便 guarded 与 baseline 是同一对象，也必须经 BASELINE 判据得出，⛔ 不得被读成「已采纳」');
        }
      }
    }
  }
  assert.strictEqual(combos, baselineForms.length * guardedForms.length * 2,
    '★ 组合必须穷举（无遗漏）');
  assert.strictEqual(deref, 0,
    '★ 选择器调用期间⛔ 一次都不得解引用 guarded 的字段'
    + `（实际解引用 ${deref} 次）⇒ guarded 只作**不透明镜像**`);

  /* 纯函数：不得改动入参 */
  const b0 = { target: 15, action: 'WAIT', stage: 'S2' };
  const g0 = { target: 99, action: 'BUILD', stage: 'S4' };
  const snapB = JSON.stringify(b0); const snapG = JSON.stringify(g0);
  selectGuardedResult({ baseline: b0, guarded: g0, effectiveGuarded: true });
  assert.strictEqual(JSON.stringify(b0), snapB, '★ 选择器不得改动 baseline 入参');
  assert.strictEqual(JSON.stringify(g0), snapG, '★ 选择器不得改动 guarded 入参');
}

/* ==================================================================== *
 * D. ∀-量化：全部矩阵观测恒 BASELINE（无例外）
 * ==================================================================== */
{
  const m = HARNESS.runMatrix(HARNESS.MATRIX_CLASSES);
  assert.strictEqual(m.ok, true, '★ 矩阵必须先全绿（否则本节断言无意义）');
  const withSel = m.observations.filter((r) => r.obs.selectorSource !== undefined);
  assert.ok(withSel.length >= 40,
    `★ 可观测 selector 的矩阵场景必须 >= 40（实际 ${withSel.length}）`);
  const bad = withSel.filter((r) => r.obs.selectorSource !== SELECTOR_SOURCE.BASELINE);
  assert.deepStrictEqual(bad.map((r) => `${r.cls}/${r.kind}/${r.label}`), [],
    '★ ∀-量化：**任何**矩阵场景（含 synthetic 封印全过 / 强制 effectiveGuarded / GUARDED_EFFECTIVE 档）'
    + '下 selector 都必须恒 BASELINE');
  const adopted = withSel.filter((r) => r.obs.adopted !== false);
  assert.deepStrictEqual(adopted.map((r) => `${r.cls}/${r.label}`), [],
    '★ ∀-量化：任何场景下 `gen1_adopted` 都必须恒 false（GE-03 不得产生采纳）');
  const refOk = withSel.filter((r) => r.obs.selectorRefEqual !== true);
  assert.deepStrictEqual(refOk.map((r) => `${r.cls}/${r.label}`), [],
    '★ ∀-量化：selector 的引用相等断言必须对每一场景成立');
}

/* ==================================================================== *
 * E. 主链权威路径不可污染
 * ==================================================================== */
{
  /* E1：`final_target` 在 runDecisionEngine 内**零写入点**（唯一产出方是 V3.6.1 Safety Core） */
  const ftWrites = RDE_CODE.split('\n').filter((l) => /final_target\s*=[^=]/.test(l));
  assert.deepStrictEqual(ftWrites.map((s) => s.trim()), [],
    '★ R1：runDecisionEngine ⛔ 不得写入 `final_target`（含不存在 shadow/guarded 写入路径）；'
    + '实际：' + JSON.stringify(ftWrites.map((s) => s.trim())));

  /* E2：`suggested_position` 的唯一写入点是**反事实**字段，⛔ 不得覆盖生产字段 */
  const spWrites = [];
  const spRe = /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*=\s*[^=]/g;
  for (const l of RDE_CODE.split('\n')) {
    let mm;
    while ((mm = spRe.exec(l)) !== null) {
      if (/suggested_position$/.test(mm[1])) spWrites.push(mm[1]);
    }
  }
  assert.deepStrictEqual(spWrites, ['canary.gen1_counterfactual_suggested_position'],
    '★ 主链对 suggested_position 的唯一写入必须是**反事实**字段（生产字段由 V3.6.1 产出）；'
    + '实际：' + JSON.stringify(spWrites));

  /* E3：两条 SECURITY 运行期守卫必须都在 */
  assert.ok(/\[SECURITY\] GE-02 selector 必须 baseline-authoritative/.test(RDE_CODE),
    '★ 必须保留「selector 恒 baseline-authoritative」运行期守卫');
  assert.ok(/\[SECURITY\] GE-02 不得采纳 Gen-1 候选/.test(RDE_CODE),
    '★ 必须保留「不得采纳」运行期守卫');

  /* E4：主链对选择器的调用恰 1 处，且传入的是**shadow 结果**而非 eligibility */
  assert.strictEqual((RDE_CODE.match(/selectGuardedResult\(/g) || []).length, 1,
    '★ `selectGuardedResult(` 在主链必须恰 1 处调用点（⛔ 不得出现第二套选择逻辑）');
  assert.ok(/guarded:\s*guardedShadowResult,/.test(RDE_CODE),
    '★ 必须把 shadow 结果对象交给选择器（§2.1 拓扑 ④）');
  assert.strictEqual(/guarded:\s*[^,\n]*shadowEligib/i.test(RDE_CODE), false,
    '★ §0.3 禁令 ③：⛔ 绝不把 guardedShadowEligible（计算资格）当作 guarded 结果传给选择器');
  assert.ok(/guardedShadowResult = claimGuardedShadowResult\(/.test(RDE_CODE),
    '★ shadow 结果必须由**认领**产生（§2.1：共享同一 rerun，⛔ 不得重算）');

  /* E5：口径四分离 —— 资格不得直接流向采纳 */
  assert.strictEqual(
    /effectiveGuarded:\s*[^,\n]*(shadowEligib|guardedShadowEligible)/i.test(RDE_CODE), false,
    '★ §3.3：选择器的 effectiveGuarded 入参⛔ 不得来自 shadow 资格（采纳资格 ⟂ 计算资格）');
  const egArgs = RDE_CODE.split('\n')
    .map((l) => l.trim()).filter((l) => /^effectiveGuarded:/.test(l));
  assert.deepStrictEqual(egArgs, ['effectiveGuarded: gen1Permission.effective_guarded === true'],
    '★ 选择器的 effectiveGuarded 入参必须**恰 1 处**且显式取自 `gen1Permission.effective_guarded`'
    + '（采纳资格的唯一来源），⛔ 不得取自 shadow 资格');
}

/* ==================================================================== *
 * F. 审计面收敛（D12 集合口径）
 * ==================================================================== */
{
  const FROZEN_AUDIT_KEYS = [
    'decision_source',
    'gen1_adopted',
    'gen1_candidate_hash',
    'gen1_guarded_baseline_stage',
    'gen1_guarded_baseline_target',
    'gen1_guarded_delta',
    'gen1_guarded_effective_stage',
    'gen1_guarded_result_target',
    'gen1_guarded_selector_source',
    'gen1_guarded_shadow_source',
    'gen1_reject_reason_code',
    'gen1_run_id',
    'gen1_safety_core_adjust_reason'
  ].sort();

  const SIGNAL = {
    date: '2026-09-10', ml_model_id: 'HVT-A-ET-20260830', ml_fast: true, calibrated_probability: 0.82,
    rule_gate: 'PERMIT', stage: 'S2', signal_run_id: 'gen1-eod-G3-07'
  };

  const p = evaluateGen1Permission({
    params: {
      ml_shadow_observe: true, ml_advisory_enabled: true, ml_fast_path_enabled: true,
      ml_challenger_model_id: 'HVT-A-ET-20260830', gen1_authority: 'CANARY'
    },
    signal: SIGNAL,
    baseline: { trend_stage_primary: 'S2', v361_baseline_target: 15 }, today: '2026-09-10',
    thresholdSignalP: 0.65, dataHealth: { status: 'DATA_OK' },
    domainPermission: { status: 'IN_DOMAIN', permission: 'ALLOW' },
    healthGate: {
      health: 'OK', latched_health: 'OK', gate_status: 'ACTIVE',
      allow_advisory: true, allow_canary: true, allow_gen1_timing: true, source: 'GEN1_HEALTH_STATE_LATCH'
    },
    guardedSeal: null
  });
  const elig = deriveGuardedShadowEligibility(p);
  const shadow = claimGuardedShadowResult(elig, { target: 25, action: 'BUILD', stage: 'S4' });
  const audit = buildGuardedAudit({
    permission: p, signal: SIGNAL, code: '513310', baseline: BASELINE,
    selection: selectGuardedResult({ baseline: BASELINE, guarded: shadow, effectiveGuarded: false })
  });

  assert.deepStrictEqual(Object.keys(audit).sort(), FROZEN_AUDIT_KEYS,
    '★ `buildGuardedAudit` 的键集必须**恰 13 个**（GE-02 的 12 + GE-03 净增 1 = `gen1_guarded_shadow_source`）；'
    + '新增/删除字段即视为 GOVERNANCE DEVIATION（D12）');
  assert.strictEqual(elig.eligible, true, '★ 夹具资格必须成立（否则 shadow 审计字段恒 null，断言无意义）');
  assert.strictEqual(audit.gen1_guarded_shadow_source, 'V361_RERUN_S4_GUARDED_SHADOW',
    '★ GE-03 净增字段必须标注并行来源');
  assert.strictEqual(audit.gen1_adopted, false, '★ 即便 shadow 产出，也必须 adopted=false');
  assert.strictEqual(typeof audit.gen1_candidate_hash, 'string', '候选哈希必须是字符串');
  assert.strictEqual(audit.gen1_candidate_hash, candidateHash({
    code: '513310', date: '2026-09-10', model_id: 'HVT-A-ET-20260830', stage: 'S2',
    ml_fast: true, calibrated_probability: 0.82, threshold_signal_p: 0.65, authority: 'CANARY'
  }), '★ 候选哈希配方不得漂移');

  /* overlay 的键集必须与「是否传入 audit」**无关**（D12：登记集合 === 真实写入集合） */
  const noAudit = applyGen1Overlay(DECISION, p, {}, undefined);
  const withAudit = applyGen1Overlay(DECISION, p, {}, audit);
  assert.deepStrictEqual(Object.keys(withAudit).sort(), Object.keys(noAudit).sort(),
    '★ D12：`decision_result` 的真实写入集合⛔ 不得随 audit 入参有无而变化'
    + '（否则 registered field set === actual write field set 会被破坏）');
  assert.strictEqual(noAudit.gen1_guarded_shadow_source, null,
    '★ audit 缺失时 shadow 来源必须为 null（骨架字段仍在，证明是「恒写入」而非「条件写入」）');
  assert.strictEqual(noAudit.gen1_adopted, false, '★ audit 缺失时 adopted 必须为 false（fail-closed）');
  assert.strictEqual(noAudit.gen1_guarded_selector_source, 'BASELINE',
    '★ audit 缺失时 selector 来源必须回落 BASELINE');

  /* D2② deep-equal + JSON 往返 */
  assert.strictEqual(verifyProductionNoop(DECISION, withAudit).ok, true, '★ D6：生产 no-op 必须成立');
  const rt = JSON.parse(JSON.stringify(withAudit));
  for (const k of ['final_target', 'final_action', 'suggested_position']) {
    assert.deepStrictEqual(rt[k], DECISION[k],
      `★ D2②：JSON 往返后 ${k} 必须与 baseline snapshot deep-equal`);
  }
  assert.strictEqual(rt.gen1_adopted, false, '★ D2②：JSON 往返后 gen1_adopted 必须仍为 false');
  assert.strictEqual(rt.gen1_guarded_selector_source, 'BASELINE',
    '★ D2②：JSON 往返后 selector 来源必须仍为 BASELINE');
  assert.strictEqual(rt.decision_source, DECISION_SOURCE.V361_ONLY,
    '★ D2②：decision_source 必须是纯 V3.6.1（⛔ 不得为 WITH_GEN1）');
}

/* ==================================================================== *
 * G. 证据通道隔离（R8 / D11）
 * ==================================================================== */
{
  for (const [name, src] of [
    ['runDecisionEngine/index.js', RDE_CODE],
    ['gen1-shadow-eligibility.js', codeOnly(ELIG_SRC)],
    ['gen1-guarded-selector.js', SEL_CODE],
    ['gen1-overlay.js', codeOnly(OVERLAY_SRC)]
  ]) {
    const writes = src.split('\n').filter((l) => /independent_events\s*(=|\+=)/.test(l));
    assert.deepStrictEqual(writes.map((s) => s.trim()), [],
      `★ R8 / D11：${name} ⛔ 不得写入 Evidence 的 independent_events`
      + '（replay / shadow 无论跑多少轮都不得增加独立事件）');
  }
  assert.ok(/不产生[^']{0,8}Evidence 事件/.test(
    fs.readFileSync(path.join(REPO, 'scripts/gen1-ge03-replay-gates.js'), 'utf8')),
    '★ R8 / D11：replay harness 必须显式声明不产生 Evidence 事件');
}

console.log('gen1 ge03 selector security tests passed');
