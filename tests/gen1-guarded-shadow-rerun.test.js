'use strict';

/**
 * WP-G1-GE-03 G3-04：Guarded Shadow rerun —— 与既有 Canary S4 **共享同一次重跑** + 两层阻断。
 *
 * 设计 Gate §2.1（N3 裁定）与 §5 D1 / D2 的**机器可判定**形式：
 *
 *   ① 真实链路：shadow 结果必须**认领**既有 Canary `V361_RERUN_S4` 的那一次结果 ——
 *      ⛔ 不得重复计算两次、⛔ 不得复制 / 改写 V3 逻辑（`claimGuardedShadowResult` 只认领，不重算）。
 *   ② 采用被阻断（**两层都要过**）：
 *      ① Selector 边界 —— 即使 guarded 结果存在、且强制 `effectiveGuarded=true`，
 *        `selected_result === baseline_result`（**引用相等**）；
 *      ② 落库 / 序列化边界 —— authoritative `final_target` / `final_action` / `suggested_position`
 *        与 baseline deep-equal，**且** `gen1_adopted === false`、`gen1_guarded_selector_source === 'BASELINE'`。
 *
 * 覆盖：
 *   A. `claimGuardedShadowResult()` 双向 fail-closed（含 §0.2.1「eligible 增、rerun 未执行」合法态）
 *   B. Selector / audit 映射：shadow 产出 ⇒ `gen1_guarded_*` 填值；未产出 ⇒ 恒 null（D1 正反两面）
 *   C. D2①：真实 evaluator 下 synthetic 封印 PASS **仍不足以** 开启采纳；Selector 强制态仍 BASELINE
 *   D. D2②：overlay 落库边界 deep-equal（含 JSON 往返）+ 运行期 No-op 断言不退化
 *   E. §2.1 共享守卫（静态）：`decisionV3.runDecision(` 恰 2 处、canary 回调内恰 1 处、结果来自认领
 *   F. D9②：新 shadow audit 字段必须**逐字段**进入静态 allowlist（⛔ 禁 wildcard / 禁动态拼接）
 *   G. D12：持久化字段必须已登记（登记集合 ⊇ 真实写入集合）
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const el = require(path.join(REPO, 'src/common/utils/gen1-shadow-eligibility.js'));
const sel = require(path.join(REPO, 'src/common/utils/gen1-guarded-selector.js'));
const ov = require(path.join(REPO, 'src/common/utils/gen1-overlay.js'));
const { evaluateGen1Permission } = require(path.join(REPO, 'src/common/utils/gen1-safety-permission.js'));
const { getSchema } = require(path.join(REPO, 'src/common/schema.js'));

const { claimGuardedShadowResult, deriveGuardedShadowEligibility, SHADOW_COMPONENT_KEYS } = el;
const { selectGuardedResult, buildGuardedAudit, SELECTOR_SOURCE, GE_02_BASELINE_AUTHORITATIVE } = sel;
const { applyGen1Overlay, verifyProductionNoop } = ov;

const SHADOW_SOURCE_TAG = 'V361_RERUN_S4_GUARDED_SHADOW';

/** 只保留代码行（剔除整行注释与行尾注释），用于静态计数（避免注释里的同名调用被计入）。 */
function codeOnly(src) {
  return src.split('\n')
    .filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l))
    .map((l) => l.replace(/(^|\s)\/\/.*$/, '$1'))
    .join('\n');
}

const OK_CHECKS = {
  health_allows_guarded: true, data_ok: true, domain_strict_in_domain: true,
  safety_pass: true, model_candidate: true
};
const env = (over) => {
  const o = over || {};
  return {
    authority: Object.assign({ gen1_authority: 'CANARY' }, o.authority || {}),
    guarded: { checks: Object.assign({}, OK_CHECKS, o.checks || {}) }
  };
};

/* ==================================================================== *
 * A. claimGuardedShadowResult —— 认领语义（§2.1 的「共享」= 不重算）
 * ==================================================================== */
{
  const elig = deriveGuardedShadowEligibility(env());
  assert.strictEqual(elig.eligible, true, '正控：6 项全真 ⇒ eligible');

  const rerun = { target: 25, action: 'BUILD', stage: 'S4' };
  const claimed = claimGuardedShadowResult(elig, rerun);
  assert.deepStrictEqual(claimed, { target: 25, action: 'BUILD', stage: 'S4' },
    '★ eligible + rerun 已执行 ⇒ 逐字段认领该次 S4 rerun 的结果');
  assert.notStrictEqual(claimed, rerun,
    '★ 必须是**字段副本**：shadow 审计不得与原 rerun 记录共享可变对象'
    + '（「共享」的准确含义 = **不重算**，而非引用别名）');

  /* A1. eligible 成立、但该次 S4 rerun **未执行** ⇒ 不认领（§0.2.1 明确的合法态） */
  for (const nothing of [null, undefined]) {
    assert.strictEqual(claimGuardedShadowResult(elig, nothing), null,
      '★ eligible 增而 shadow 结果为空是**允许**的审计信号（⛔ 不得用 eligible 冒充 rerun 已执行）');
  }

  /* A2. rerun 存在、但 eligible 不成立 ⇒ 一律不认领（fail-closed，非布尔真值也不成立） */
  for (const bad of [null, undefined, {}, { eligible: false }, { eligible: 1 }, { eligible: 'true' }, 0, 'x', []]) {
    assert.strictEqual(claimGuardedShadowResult(bad, rerun), null,
      `★ 非严格 eligible 不得认领：${JSON.stringify(bad)}`);
  }

  /* A3. 与 §0.3 从严口径联动：authority 非 CANARY ⇒ eligible 不成立 ⇒ 不认领 */
  const eligAdv = deriveGuardedShadowEligibility(env({ authority: { gen1_authority: 'ADVISORY' } }));
  assert.strictEqual(eligAdv.eligible, false);
  assert.strictEqual(claimGuardedShadowResult(eligAdv, rerun), null);
  assert.ok(SHADOW_COMPONENT_KEYS.indexOf('authority_guarded') < 0,
    '★ 认领路径不得引入 §0.3 的排除项作为新合取项');
}

/* ==================================================================== *
 * B. Selector / audit 映射（D1 正反两面 + D9② 独立断言）
 * ==================================================================== */
const BASELINE = { target: 15, action: 'WAIT', stage: 'S2' };
const GUARDED = { target: 25, action: 'BUILD', stage: 'S4' };
const SIGNAL = {
  signal_run_id: 'gen1-eod-GE03SHADOW', code: '513310', date: '2026-09-10',
  ml_model_id: 'HVT-A-ET-20260830', model_id: 'HVT-A-ET-20260830',
  ml_fast: true, calibrated_probability: 0.82, stage: 'S2'
};
const permOf = (effectiveGuarded) => ({
  authority: { gen1_authority: 'CANARY' },
  model: { reason_code: null, threshold_signal_p: 0.65 },
  guarded: { effective_guarded: effectiveGuarded === true, reason_code: 'GUARDED_AUTHORITY_NOT_EFFECTIVE' }
});

{
  const s = selectGuardedResult({ baseline: BASELINE, guarded: GUARDED, effectiveGuarded: false });
  assert.strictEqual(s.authoritative_source, SELECTOR_SOURCE.BASELINE);
  assert.strictEqual(s.selected_result, BASELINE, 'D2① 引用相等');
  assert.strictEqual(s.guarded_available, true, 'shadow 结果必须被 selector **看见**（guarded_available）');
  assert.strictEqual(s.guarded_result, GUARDED);
  assert.strictEqual(s.frozen_baseline_only, true);
  assert.strictEqual(GE_02_BASELINE_AUTHORITATIVE, true, 'R4：冻结开关必须保持 true');

  const a = buildGuardedAudit({
    permission: permOf(false), signal: SIGNAL, code: '513310', baseline: BASELINE, selection: s
  });
  assert.strictEqual(a.gen1_adopted, false);
  assert.strictEqual(a.gen1_guarded_selector_source, 'BASELINE');
  assert.strictEqual(a.gen1_guarded_baseline_stage, 'S2');
  assert.strictEqual(a.gen1_guarded_effective_stage, 'S4', '★ shadow 重跑阶段必须可见（D1：结果能算出）');
  assert.strictEqual(a.gen1_guarded_baseline_target, 15);
  assert.strictEqual(a.gen1_guarded_result_target, 25, '★ guarded 结果 target 非空 ⇒ shadow 确实产出了结果');
  assert.strictEqual(a.gen1_guarded_delta, 10);
  /* D9② 独立断言：新 shadow audit 字段的**唯一**允许取值 */
  assert.strictEqual(a.gen1_guarded_shadow_source, SHADOW_SOURCE_TAG,
    '★ GE-03：shadow 产出时并行来源标识必须为 V361_RERUN_S4_GUARDED_SHADOW');
}

{
  /* 未产出 shadow（guarded=null）⇒ 所有 guarded_* 恒 null（D1 反面对照，防「装饰性恒空」未被察觉） */
  const s = selectGuardedResult({ baseline: BASELINE, guarded: null, effectiveGuarded: false });
  assert.strictEqual(s.guarded_available, false);
  const a = buildGuardedAudit({
    permission: permOf(false), signal: SIGNAL, code: '513310', baseline: BASELINE, selection: s
  });
  for (const k of ['gen1_guarded_effective_stage', 'gen1_guarded_result_target',
    'gen1_guarded_delta', 'gen1_guarded_shadow_source']) {
    assert.strictEqual(a[k], null, `★ 未产出 shadow 时 ${k} 必须为 null`);
  }
  assert.strictEqual(a.gen1_adopted, false);
  assert.strictEqual(a.gen1_guarded_selector_source, 'BASELINE');
}

/* ==================================================================== *
 * C. D2① —— 采纳资格即使（假设性）成立，Selector 仍恒 baseline
 * ==================================================================== */
{
  /* C1. 真实 evaluator：shadow 全绿（CANARY）+ synthetic 封印 PASS ⇒
   *     计算资格成立，但**采纳资格仍 false**（§0.3「明确排除」的结构性后果）。 */
  const input = {
    params: {
      ml_shadow_observe: true, ml_advisory_enabled: true, ml_fast_path_enabled: true,
      ml_challenger_model_id: 'HVT-A-ET-20260830', gen1_authority: 'CANARY'
    },
    signal: SIGNAL,
    baseline: { trend_stage_primary: 'S2', v361_baseline_target: 15 },
    today: '2026-09-10', thresholdSignalP: 0.65,
    risk: { risk_override: false, risk_flag: 'NORMAL' }, fundamental: { f_state: 'F3' },
    snapshot: { structural_break: false, hard_break: false },
    dataHealth: { status: 'OK' },
    domainPermission: { status: 'IN_DOMAIN', permission: 'ALLOW' },
    healthGate: {
      health: 'OK', latched_health: 'OK', gate_status: 'ACTIVE',
      allow_advisory: true, allow_canary: true, allow_gen1_timing: true,
      source: 'GEN1_HEALTH_STATE_LATCH', economic_health: 'PENDING'
    },
    /* synthetic / test-only 夹具（⛔ 生产制品仍 PENDING，见 R5） */
    guardedSeal: { freeze_seal_approved: true, evidence_seal_pass: true, evidence_positive: true, evidence_independent_events: 30 }
  };
  const p = evaluateGen1Permission(input);
  assert.strictEqual(p.guarded.checks.freeze_seal_approved, true, 'synthetic 夹具：Freeze 侧成立');
  assert.strictEqual(p.guarded.checks.evidence_seal_pass, true, 'synthetic 夹具：Evidence 侧成立');
  assert.strictEqual(p.guarded.checks.authority_guarded, false,
    '★ P3：authority 保持 CANARY ⇒ authority_guarded 结构性不成立（§0.3 排除项）');
  assert.strictEqual(p.effective_guarded, false,
    '★ synthetic 封印 PASS 仍**不足以**开启采纳资格：authority_guarded 未满足（fail-closed）');
  assert.strictEqual(deriveGuardedShadowEligibility(p).eligible, true,
    '★ 同一信封下「能不能计算」成立 —— 计算资格 ⟂ 采纳资格（§3.3 口径三分离）');

  /* C2. 即使把 effectiveGuarded **强制为 true**（假设性未来），Selector 仍必须 baseline（引用相等） */
  const sForced = selectGuardedResult({ baseline: BASELINE, guarded: GUARDED, effectiveGuarded: true });
  assert.strictEqual(sForced.authoritative_source, SELECTOR_SOURCE.BASELINE,
    '★ D2①：guarded 候选存在 + effectiveGuarded=true ⇒ 权威来源仍必须是 BASELINE');
  assert.strictEqual(sForced.selected_result, BASELINE, '★ D2①：必须**引用相等**（不是 deep-equal）');
  assert.strictEqual(sForced.guarded_considered, true);
  assert.strictEqual(sForced.guarded_available, true);

  const aForced = buildGuardedAudit({
    permission: Object.assign(permOf(true), { guarded: { effective_guarded: true, reason_code: null } }),
    signal: SIGNAL, code: '513310', baseline: BASELINE, selection: sForced
  });
  assert.strictEqual(aForced.gen1_adopted, false);
  assert.strictEqual(aForced.gen1_reject_reason_code, 'DORMANT_BASELINE_AUTHORITATIVE',
    '★ 所有守门成立、仅因选择器休眠而未采纳 ⇒ 原因码必须是 DORMANT_BASELINE_AUTHORITATIVE');
  assert.strictEqual(aForced.decision_source, 'V361_SAFETY_CORE');
  assert.strictEqual(aForced.gen1_guarded_shadow_source, SHADOW_SOURCE_TAG);
}

/* ==================================================================== *
 * D. D2② —— 落库 / 序列化边界 deep-equal（overlay 层）
 * ==================================================================== */
{
  const decision = {
    code: '513310', decision_date: '2026-09-10', final_target: 15, final_action: 'WAIT',
    suggested_position: 15, opportunity_score: 72, core_position: 10, trade_position: 5, version: 3
  };
  const s = selectGuardedResult({ baseline: BASELINE, guarded: GUARDED, effectiveGuarded: false });
  const audit = buildGuardedAudit({
    permission: permOf(false), signal: SIGNAL, code: decision.code, baseline: BASELINE, selection: s
  });
  const canary = { gen1_effective_stage: 'S4', gen1_canary_target: 25, gen1_canary_action: 'BUILD' };

  const out = applyGen1Overlay(decision, permOf(false), canary, audit);

  /* ② 落库边界：authoritative 三字段与 baseline snapshot deep-equal */
  for (const k of ['final_target', 'final_action', 'suggested_position']) {
    assert.deepStrictEqual(out[k], decision[k], `★ D2②：${k} 必须与 baseline deep-equal`);
  }
  assert.strictEqual(out.gen1_adopted, false);
  assert.strictEqual(out.gen1_guarded_selector_source, 'BASELINE');
  assert.strictEqual(out.gen1_guarded_shadow_source, SHADOW_SOURCE_TAG,
    '★ GE-03 并行来源标识必须落地到 decision_result');

  /* D6：运行期 No-op 断言不得退化 */
  const noop = verifyProductionNoop(
    { final_target: decision.final_target, final_action: decision.final_action }, out);
  assert.strictEqual(noop.ok, true, `★ D6：No-op 断言必须仍成立（diffs=${noop.diffs.join(',')}）`);

  /* ② 序列化边界：clone / JSON 往返**改变对象身份**时不得误报（且取值逐字段不变） */
  const rt = JSON.parse(JSON.stringify(out));
  assert.notStrictEqual(rt, out, '★ JSON 往返后对象身份已不同 —— 这正是 D2 需要「第二层」的动机');
  for (const k of ['final_target', 'final_action', 'suggested_position']) {
    assert.deepStrictEqual(rt[k], decision[k], `★ D2②：JSON 往返后 ${k} 仍须 deep-equal`);
  }
  assert.strictEqual(rt.gen1_adopted, false);
  assert.strictEqual(rt.gen1_guarded_selector_source, 'BASELINE');
  assert.strictEqual(rt.gen1_guarded_shadow_source, SHADOW_SOURCE_TAG);

  /* 生产字段即使 canary / guarded 值不同也不得被带走（硬还原不得条件化） */
  assert.notStrictEqual(out.final_target, canary.gen1_canary_target,
    '★ 反事实 target 与生产 target 不同，恰好证明硬还原确实生效（而非碰巧相等）');
}

/* ==================================================================== *
 * E. §2.1 共享守卫（静态）—— shadow 只「认领」，绝不「重算」
 * ==================================================================== */
const RDE = fs.readFileSync(path.join(REPO, 'cloudfunctions/runDecisionEngine/index.js'), 'utf8');
const RDE_CODE = codeOnly(RDE);

{
  /* E1. immutable V3 的调用点总数恒为 2：① baseline ② 既有 Canary S4 rerun。
   *     ⛔ GE-03 不得新增第 3 处（那意味着「第二套 V3」/「重复计算」）。 */
  const v3calls = RDE_CODE.match(/decisionV3\.runDecision\(/g) || [];
  assert.strictEqual(v3calls.length, 2,
    `★ immutable V3 调用点必须恰为 2 处（baseline + Canary S4 rerun），实为 ${v3calls.length}`);

  /* E2. 既有 Canary 回调内恰 1 处（shadow 没有自己的 rerun 调用） */
  const cbStart = RDE_CODE.indexOf('recomputeCanaryTarget: (stage) => {');
  const cbEnd = RDE_CODE.indexOf('canary.gen1_canary_sector_remaining');
  assert.ok(cbStart > 0 && cbEnd > cbStart, '★ 必须仍存在 canary rerun 回调（既有链路不得被改写）');
  const cb = RDE_CODE.slice(cbStart, cbEnd);
  assert.strictEqual((cb.match(/decisionV3\.runDecision\(/g) || []).length, 1,
    '★ canary 回调内恰 1 次 V3 重跑；⛔ shadow 不得在其中再插一次');

  /* E3. shadow 结果**来自认领**（传入的是已算出的那次 rerun），不是自己重算 */
  assert.ok(/claimGuardedShadowResult\(shadowEligibility, canaryS4Rerun\)/.test(RDE_CODE),
    '★ shadow 结果必须由 claimGuardedShadowResult(eligibility, 既有 rerun) 认领');
  assert.ok(!/guardedShadowResult\s*=[^;]*runDecision/.test(RDE_CODE),
    '★ ⛔ guardShadowResult 不得由任何 V3 调用直接产生（不得重算）');
  assert.ok(/let canaryS4Rerun = null;/.test(RDE_CODE), '★ 共享载体必须显式声明');
  assert.ok(/canaryS4Rerun = \{ target: c\.final_target, action: c\.final_action, stage: stage \}/.test(RDE_CODE),
    '★ stage 必须取回调实参（⛔ 不写死字面量）；否则 shadow 与 canary 可能指向不同 stage');
  assert.ok(!/canaryS4Rerun = \{[^}]*stage: 'S4'/.test(RDE_CODE),
    '★ ⛔ 不得把 stage 写死为字面量');

  /* E4. §0.3 禁令 ③：传进 Selector 的是**结果对象**，不是 shadow 资格 */
  const callIdx = RDE_CODE.indexOf('selectGuardedResult({');
  assert.ok(callIdx > 0);
  const args = RDE_CODE.slice(callIdx, RDE_CODE.indexOf('});', callIdx));
  assert.ok(/guarded:\s*guardedShadowResult/.test(args),
    '★ Selector 的 guarded 入参必须是 shadow **结果对象**');
  assert.ok(!/shadowEligib/i.test(args),
    '★ ⛔ 绝不把 guardedShadowEligible 传给 Guarded Selector（§0.3 禁令 ③）');
  assert.ok(/effectiveGuarded:\s*gen1Permission\.effective_guarded === true/.test(args),
    '★ Selector 的 effectiveGuarded 必须仍是**采纳资格** effective_guarded');

  /* E5. 同一个选择器只被调用一次（不得另建第二套选择路径） */
  assert.strictEqual((RDE_CODE.match(/selectGuardedResult\(/g) || []).length, 1,
    '★ 本文件内 selectGuardedResult 必须恰 1 次调用');

  /* E6. 不得引入第二套 V3 实现。
   * ⚠️ 枚举域**显式声明**：本文件对 `./common/utils/*` 的全部 require **集合逐项比对**
   *     （不是「某个词没出现」这类无限域否定）—— 若新增任何 decision / shadow 模块即打红。
   *     `v3-shadow.js` / `shadow-v3-log.js` 是 §2.2 的既有 ①② 类 shadow（≠ GE-03），
   *     与 `gen1-shadow-eligibility` 并列存在，**不是**第二套 V3。 */
  const UTIL_REQUIRES = [
    './common/utils/decision', './common/utils/decision-v3.js',
    './common/utils/v3-shadow.js', './common/utils/shadow-v3-log.js',
    './common/utils/gen1-shadow-eligibility'
  ];
  const got = [...RDE_CODE.matchAll(/require\(['"](\.\/common\/utils\/[^'"]+)['"]\)/g)].map((m) => m[1]);
  const relevant = got.filter((p) => /decision|shadow/.test(p)).sort();
  assert.deepStrictEqual(relevant, UTIL_REQUIRES.slice().sort(),
    '★ GE-03 不得新增第二套 V3 / shadow 重跑模块：decision|shadow 相关 require 集合必须与该清单逐项一致');
}

/* ==================================================================== *
 * F. D9② —— 新 shadow audit 字段必须逐字段进入**静态** allowlist
 * ==================================================================== */
{
  const PARITY = fs.readFileSync(path.join(REPO, 'scripts/gen1-guarded-parity-local.js'), 'utf8');
  const head = 'const OVERLAY_NEW_KEYS = [';
  const i = PARITY.indexOf(head);
  const j = PARITY.indexOf('];', i);
  assert.ok(i > 0 && j > i, '★ 平价脚本的 OVERLAY_NEW_KEYS 必须存在（D9② 的静态 allowlist 载体）');
  const block = PARITY.slice(i + head.length, j);
  const body = block.replace(/\/\/.*$/gm, '');   // 剔除注释后再做「纯字面量」判定

  /* F1. ⛔ 禁 wildcard / 禁动态拼接：去掉字符串字面量后，剩余字符只允许空白与逗号 */
  const stripped = body.replace(/'[^']*'/g, 'Q');
  assert.ok(/^[\s,Q]*$/.test(stripped),
    `★ allowlist 只允许**字面量**逐字段列出（⛔ 禁 spread / 变量 / 正则 / 动态生成）：${JSON.stringify(stripped.slice(0, 80))}`);
  assert.ok(!/[.*+?]/.test(body), '★ ⛔ 禁 wildcard');

  /* F2. 新字段必须在列（逐字段显式），且不得重复 */
  const keys = (body.match(/'([A-Za-z_][A-Za-z0-9_]*)'/g) || []).map((s) => s.slice(1, -1));
  assert.ok(keys.indexOf('gen1_guarded_shadow_source') >= 0,
    '★ GE-03 的 shadow audit 字段 gen1_guarded_shadow_source 必须进入静态 allowlist');
  assert.strictEqual(new Set(keys).size, keys.length, '★ allowlist 不得有重复项');
  for (const k of keys) {
    assert.ok(/^[a-z][a-z0-9_]*$/.test(k), `★ allowlist 项必须是 snake_case 字段名：${k}`);
  }
  /* F3. allowlist 的**数量断言**由平价脚本自身承担（outExtra.length !== OVERLAY_NEW_KEYS.length ⇒ FAIL）
   *     ⇒ 若某字段只登记不落地（或只落地不登记），平价必然打红。此处只兜住「登记」这一半。 */
  assert.ok(/outExtra\.length !== OVERLAY_NEW_KEYS\.length/.test(PARITY),
    '★ 平价脚本必须保留「新增字段数 == allowlist 长度」的双向绑定断言');
}

/* ==================================================================== *
 * G. D12 —— 持久化字段必须已登记（登记集合 ⊇ 真实写入集合）
 * ==================================================================== */
{
  const dr = getSchema('decision_result');
  assert.ok(dr && dr.fields, 'decision_result schema 必须存在');
  assert.ok(dr.fields.gen1_guarded_shadow_source,
    '★ D12：decision_result.gen1_guarded_shadow_source 必须登记（新审计字段同步注册）');
  assert.strictEqual(dr.fields.gen1_guarded_shadow_source.type, 'string');
  assert.strictEqual(dr.fields.gen1_guarded_shadow_source.required, false);

  /* overlay 对该字段的**赋值点**恰 1 处（⛔ 不得顺手写进别的字段路径） */
  const OVL = fs.readFileSync(path.join(REPO, 'src/common/utils/gen1-overlay.js'), 'utf8');
  assert.strictEqual((codeOnly(OVL).match(/out\.gen1_guarded_shadow_source\s*=/g) || []).length, 1,
    '★ overlay 对 gen1_guarded_shadow_source 的赋值点必须恰 1 处');
}

console.log('gen1 guarded shadow rerun tests passed（共享 S4 rerun 认领 + D2 两层阻断 + D9② 静态 allowlist + D12 登记）');
