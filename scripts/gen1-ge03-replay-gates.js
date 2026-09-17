#!/usr/bin/env node
/**
 * GE-03 离线 replay harness + **7 类反例矩阵**（设计 Gate §0.2.1 / §4 / §5 D3 / D4 / D7）。
 *
 * 定位（§2 双层工程形态的**第二层**）：
 *   ① 真实链路（`runDecisionEngine` 内）→ 证明「真实接线没问题」（由 tests/ + G1-X 等静态断言覆盖）
 *   ② 本 harness（离线）             → 证明「反例真的能挡住」+「同一批次重放输出逐字段一致」
 *   ⛔ 二者不可互相替代。
 *
 * 本脚本**只读**、**不写 DB**、**不改任何制品**；所有输入都是合成夹具。
 * 它**不**代表生产写权限，也不产生任何 Evidence 事件（R8 / D11）。
 *
 * 覆盖：
 *   · §4 的 **7 类反例矩阵**（⛔ 类别数固定为 7，不得自行扩成第 8 个「治理类别」）
 *     health / data / domain / safety / candidate / seal / authority
 *     —— §4(a)：每类 ≥1 负例（必须被拒）+ ≥1 正控（必须通过），**含 seal**
 *   · §0.2.1 计数不变量：`eligible_count >= shadow_invocations >= 0` 且 `effective_invocations = 0`
 *     —— 含「eligible 增而 invocations 不增」的**审计信号**场景（§0.2.1 明示允许）
 *   · D2 两层阻断：selector 恒 BASELINE（引用相等）+ 落库 deep-equal + `gen1_adopted === false`
 *   · D4 确定性 replay：同一批次两次运行**逐字段一致**，并产出可回指的 `replay_ref`
 *
 * 用法：node scripts/gen1-ge03-replay-gates.js [--emit <path>]
 * 退出码：0 = 全部通过；1 = 存在失败（**本脚本必须能被打红**，见 §4(b) / D7）。
 *
 * ⚠️ 供 `tests/gen1-ge03-replay-determinism.test.js` 复用的纯函数已导出；
 *    仅在 `require.main === module` 时执行 CLI。
 */
'use strict';

const path = require('path');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..');
const U = (f) => require(path.join(REPO, 'src', 'common', 'utils', f));

const { evaluateGen1Permission } = U('gen1-safety-permission');
const { deriveGuardedShadowEligibility, claimGuardedShadowResult } = U('gen1-shadow-eligibility');
const {
  selectGuardedResult, buildGuardedAudit, SELECTOR_SOURCE, GE_02_BASELINE_AUTHORITATIVE
} = U('gen1-guarded-selector');
const { applyGen1Overlay, verifyProductionNoop } = U('gen1-overlay');
const { evaluateGuardedSeal, FREEZE_STATUS, EVIDENCE_STATUS } = U('gen1-guarded-seal');

const REPLAY_HARNESS_ID = 'GEN1_GE03_REPLAY_V1';
const TO = '2026-09-10';
const CODE = '513310';
const BASELINE = Object.freeze({ target: 15, action: 'WAIT', stage: 'S2' });
const SHADOW_RERUN = Object.freeze({ target: 25, action: 'BUILD', stage: 'S4' });
const DECISION = Object.freeze({
  code: CODE, decision_date: TO, final_target: 15, final_action: 'WAIT', suggested_position: 15,
  opportunity_score: 72, core_position: 10, trade_position: 5, version: 3
});
const CANARY = Object.freeze({
  gen1_effective_stage: 'S4', gen1_canary_target: 25, gen1_canary_action: 'BUILD'
});

/**
 * 健康闸夹具 —— 形态与 `healthStateToGate()` 的产出**同形**。
 * ⚠️ 生产唯一产出方 = `runDecisionEngine/index.js:617` `healthStateToGate(gen1HealthState)`；
 *    其内部 `circuitGate()`（`gen1-circuit-breaker.js:102-103`）**恒**产出 `health`，
 *    且 `gen1-health-state.js:199/214` **恒**产出 `latched_health` ⇒ 生产下两字段恒同时存在。
 */
const HEALTH_OK = Object.freeze({
  health: 'OK', latched_health: 'OK', gate_status: 'ACTIVE',
  allow_advisory: true, allow_canary: true, allow_gen1_timing: true,
  source: 'GEN1_HEALTH_STATE_LATCH', economic_health: 'PENDING'
});

/** `evaluateGuardedSeal()` 的四项绑定（章程 §3.1 Key 2）夹具。 */
const BIND = Object.freeze({
  source_sha256: 's'.repeat(64), model_sha256: 'm'.repeat(64),
  threshold_version: 'shadow-threshold-v1', contract_version: 'WP-G1-GE-CH-1.0'
});

/** synthetic / test-only 封印夹具（⛔ 生产制品仍 PENDING / 不 PASS，见 R5）。 */
const SYNTH_SEAL = evaluateGuardedSeal({
  freeze: Object.assign({ status: FREEZE_STATUS.APPROVED }, BIND),
  evidence: { status: EVIDENCE_STATUS.PASS, evidence_positive: true, independent_events: 30 },
  runtime: BIND
});
const PENDING_SEAL = evaluateGuardedSeal({
  freeze: Object.assign({ status: FREEZE_STATUS.PENDING }, BIND),
  evidence: { status: EVIDENCE_STATUS.PENDING },
  runtime: BIND
});
/** 封印 status=PASS 但方向未证正 ⇒ Key 3 不得成立（GE-02 复审 P0-2）。 */
const SEAL_NOT_POSITIVE = evaluateGuardedSeal({
  freeze: Object.assign({ status: FREEZE_STATUS.APPROVED }, BIND),
  evidence: { status: EVIDENCE_STATUS.PASS, evidence_positive: false, independent_events: 30 },
  runtime: BIND
});

const omit = (obj, key) => { const o = Object.assign({}, obj); delete o[key]; return o; };

/** 稳定序列化（键排序；`undefined` → null），用于 D4 逐字段一致与 `replay_ref`。 */
function stable(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
}

/**
 * 夹具：默认全绿 + CANARY（每次变化只改**一个**维度 ⇒ 差异可归因）。
 *
 * ⚠️ 词表以**生产真实取值**为准：
 *   data —— `gen1-data-health.js:25` `STATUS = { DATA_OK, DATA_DEGRADED, DATA_BLOCKED }`，
 *           经 `gen1-safety-permission.js:212` 的 `.replace(/^DATA_/, '')` 归一化后判定 ⇒
 *           `DATA_OK` 是**生产 canonical 正控值**，⛔ 不是负例。
 *   domain —— `gen1-domain-permission.js:19-22` `ALLOW / CANARY_LIMITED / BLOCK_CANARY`。
 */
function baseInput(x) {
  const o = x || {};
  const d = (k, v) => (o[k] === undefined ? v : o[k]);
  return {
    params: Object.assign({
      ml_shadow_observe: true, ml_advisory_enabled: true, ml_fast_path_enabled: true,
      ml_challenger_model_id: 'HVT-A-ET-20260830', gen1_authority: 'CANARY'
    }, o.params || {}),
    signal: d('signal', {
      date: TO, model_id: 'HVT-A-ET-20260830', ml_model_id: 'HVT-A-ET-20260830',
      ml_fast: true, calibrated_probability: 0.82, rule_gate: 'PERMIT', stage: 'S2',
      signal_run_id: 'gen1-eod-GE03-REPLAY'
    }),
    baseline: { trend_stage_primary: 'S2', v361_baseline_target: 15 },
    today: d('today', TO),
    thresholdSignalP: d('thresholdSignalP', 0.65),
    risk: d('risk', { risk_override: false, risk_flag: 'NORMAL' }),
    fundamental: d('fundamental', { f_state: 'F3' }),
    snapshot: d('snapshot', { structural_break: false, hard_break: false }),
    dataHealth: d('dataHealth', { status: 'DATA_OK' }),
    domainPermission: d('domainPermission', { status: 'IN_DOMAIN', permission: 'ALLOW' }),
    healthGate: d('healthGate', HEALTH_OK),
    guardedSeal: d('guardedSeal', null)
  };
}

/**
 * 把「一条合成场景」跑完整条纯函数链，返回**完整中间件**（**零随机 / 零时间 / 零 DB**）。
 * ⛔ 这里**不**调用 `runDecisionEngine`（需 DB）；真实接线守卫由 tests/ 与 G1-X 静态断言承担。
 * `probe()` 由此派生 ⇒ 二者**不可能分叉**。
 */
function probeFull(x) {
  const o = x || {};
  const input = baseInput(o);
  const permission = evaluateGen1Permission(input);
  const eligibility = deriveGuardedShadowEligibility(permission);
  const rerun = o.rerunUnavailable === true ? null : SHADOW_RERUN;
  const shadow = claimGuardedShadowResult(eligibility, rerun);
  const selection = selectGuardedResult({
    baseline: BASELINE, guarded: shadow,
    effectiveGuarded: o.forceEffectiveGuarded === true || permission.effective_guarded === true
  });
  const audit = buildGuardedAudit({
    permission, signal: input.signal, code: CODE, baseline: BASELINE, selection
  });
  const out = applyGen1Overlay(DECISION, permission, o.canary === undefined ? CANARY : o.canary, audit);
  return { input, permission, eligibility, shadow, selection, audit, out };
}

/** 可观测面（由 `probeFull()` 投影；⛔ 不得在此重算任何判定）。 */
function probe(x) {
  const f = probeFull(x);
  const p = f.permission;
  return {
    authority: p.authority.gen1_authority,
    authorityDowngraded: p.authority.downgraded === true,
    productionWrite: p.authority.production_write === true,
    autoExecution: p.authority.auto_execution === true,
    checks: p.guarded.checks,
    // ⚠️ 展示性信封字段 —— 带**默认值**，**不是**授权判据（用于证明 §0.3.1「展示 ≠ 授权」）
    healthDisplayGateStatus: p.health ? p.health.gate_status : null,
    effectiveCanary: p.effective_canary === true,
    effectiveGuarded: p.effective_guarded === true,
    eligible: f.eligibility.eligible,
    shadowProduced: f.shadow != null,
    shadowSource: f.audit.gen1_guarded_shadow_source,
    adopted: f.audit.gen1_adopted === true,
    selectorSource: f.selection.authoritative_source,
    selectorRefEqual: f.selection.selected_result === BASELINE,
    finalTarget: f.out.final_target,
    finalAction: f.out.final_action,
    suggested: f.out.suggested_position,
    noopOk: verifyProductionNoop(DECISION, f.out).ok
  };
}

/**
 * 投毒探针：把一份**被污染**的审计对象喂给 overlay，断言生产字段纹丝不动（D2② / R1）。
 *
 * ⚠️ 机制说明（⛔ 不得夸大）：`applyGen1Overlay` 只**逐字段具名**拷贝审计键
 * （`ga.decision_source` / `ga.gen1_*` / …），**不会** `Object.assign(out, ga)`，
 * 且内部**从不写入** `final_target` / `final_action` ⇒ 该探针是一条**回归护栏**
 * （防将来有人改成整体合并），当前并非「可被污染的活路径」。
 * 硬还原（`out.final_target = prodTarget`）本身的可观测效应由打红用例覆盖：
 * 把它改成常量即令 `block` / D2② 失败。
 */
function poisonProbe() {
  const p = evaluateGen1Permission(baseInput({}));
  const out = applyGen1Overlay(DECISION, p, {}, {
    decision_source: 'V361_SAFETY_CORE_WITH_GEN1', gen1_adopted: true, final_target: 99, final_action: 'EXIT'
  });
  return {
    finalTarget: out.final_target, finalAction: out.final_action,
    suggested: out.suggested_position, noopOk: verifyProductionNoop(DECISION, out).ok
  };
}

/* ---- 三类可复用的判定（① 负例：必须被拒 ② 正控：必须通过 ③ 阻断：不得采纳） ---- */
const rej = (o) => ({
  ok: o.eligible === false && o.shadowProduced === false,
  why: '负例必须被拒：eligibility 不成立且 shadow 未被产出'
});
const acc = (o) => ({
  ok: o.eligible === true && o.shadowProduced === true
    && o.shadowSource === 'V361_RERUN_S4_GUARDED_SHADOW',
  why: '正控必须通过：eligibility 成立 + shadow 产出 + 并行来源标识正确'
});
const block = (o) => ({
  ok: o.selectorSource === SELECTOR_SOURCE.BASELINE && o.selectorRefEqual === true
    && o.adopted === false && o.noopOk === true
    && o.finalTarget === DECISION.final_target && o.finalAction === DECISION.final_action,
  why: 'D2 两层阻断：selector=BASELINE（引用相等）+ adopted=false + 生产字段 deep-equal + no-op 成立'
});
/** 缺省判定器：未显式写 `check` 的用例按 kind 取默认（`neg → rej` / `pos → acc`）。 */
const DEFAULT_CHECK = Object.freeze({ neg: rej, pos: acc });

/* ==================================================================== *
 * 7 类反例矩阵（§4；⛔ 类别数固定为 7，不得自行扩成第 8 个「治理类别」）
 *   kind: 'neg'  负例，必须被拒
 *         'pos'  正控，必须通过
 *         'diff' 口径差登记 —— ⛔ 不判 PASS/FAIL，留 owner 裁定
 * ==================================================================== */
const MATRIX_CLASSES = [
  {
    /* §4 第 1 行 */
    id: 'health', label: 'health 健康闸',
    cases: [
      { kind: 'neg', label: '健康闸 DEGRADED', over: { healthGate: Object.assign({}, HEALTH_OK, { health: 'DEGRADED', latched_health: 'DEGRADED' }) } },
      {
        kind: 'neg', label: 'health=DEGRADED 而 latched_health=OK（health 严格优先）',
        over: { healthGate: Object.assign({}, HEALTH_OK, { health: 'DEGRADED' }) }
      },
      { kind: 'neg', label: 'gate_status=PENDING（首次未初始化）', over: { healthGate: Object.assign({}, HEALTH_OK, { gate_status: 'PENDING' }) } },
      {
        kind: 'neg', label: 'gate_status 字段缺失（⚠️ 信封展示默认 ACTIVE，授权仍必须拒）',
        over: { healthGate: omit(HEALTH_OK, 'gate_status') },
        check: (o) => ({
          ok: o.checks.health_allows_guarded === false && o.eligible === false
            && o.shadowProduced === false && o.healthDisplayGateStatus === 'ACTIVE',
          why: '§0.3.1：gate_status 缺失 ⇒ 授权 fail-closed；同时证明信封的**展示性**默认值 '
            + 'ACTIVE **不构成**授权判据（`hg.gate_status || ACTIVE` 只属审计契约）'
        })
      },
      {
        kind: 'neg', label: 'gate_status=null（DB 兼容形态）',
        over: { healthGate: Object.assign({}, HEALTH_OK, { gate_status: null }) },
        check: (o) => ({
          ok: o.checks.health_allows_guarded === false && o.eligible === false
            && o.healthDisplayGateStatus === 'ACTIVE',
          why: '§0.3.1：null 与缺失同规则 fail-closed（显式 ACTIVE 才可放行）'
        })
      },
      { kind: 'neg', label: '健康块整体缺失（`hg === null`）', over: { healthGate: null } },
      { kind: 'neg', label: 'health 与 latched_health 双缺', over: { healthGate: omit(omit(HEALTH_OK, 'health'), 'latched_health') } },
      {
        kind: 'pos', label: '正控：health===OK 且 gate_status===ACTIVE',
        over: { healthGate: HEALTH_OK }
      },
      {
        /* 口径差登记（⛔ 不是判据）：§4 第 1 行字面写「**缺 `health` 字段** ⇒ 一律拒」，
         * 而实现（`gen1-safety-permission.js:258-260`）取 `hg.health ?? hg.latched_health`：
         * 缺 `health` 但 `latched_health === 'OK'` ⇒ **仍放行**。
         * 可达性证据（三项）：① 生产唯一产出方 = `runDecisionEngine/index.js:617`
         * `healthStateToGate(...)`；② `gen1-health-state.js:199` / `:214` 两个返回分支**恒**产出
         * `latched_health`；③ `circuitGate()`（`gen1-circuit-breaker.js:102-103`）**恒**产出 `health`。
         * ⇒ 生产下两字段恒同时存在 ⇒ 该分支**不可达**。此处只登记，不判 PASS/FAIL，留 owner 裁定。 */
        kind: 'diff', label: 'health 缺失但 latched_health=OK（实现取 fallback）',
        over: { healthGate: omit(HEALTH_OK, 'health') }
      }
    ]
  },
  {
    /* §4 第 2 行；B2b 裁定：只覆盖 runtime data gate（Evidence maturity 属 Evidence pipeline） */
    id: 'data', label: 'data 数据完整性',
    cases: [
      { kind: 'neg', label: 'DATA_DEGRADED（生产真实取值）', over: { dataHealth: { status: 'DATA_DEGRADED' } } },
      { kind: 'neg', label: 'DATA_BLOCKED（生产真实取值）', over: { dataHealth: { status: 'DATA_BLOCKED' } } },
      { kind: 'neg', label: 'UNKNOWN（未归一化词表外）', over: { dataHealth: { status: 'UNKNOWN' } } },
      { kind: 'neg', label: 'OKAY（近形拼写 ⇒ 证明确为**精确**匹配）', over: { dataHealth: { status: 'OKAY' } } },
      { kind: 'neg', label: '数据健康缺失（null ⇒ 生产 fail-closed 路径）', over: { dataHealth: null } },
      {
        kind: 'pos', label: '正控：DATA_OK（生产 canonical 取值；经 DATA_ 前缀归一化）',
        over: { dataHealth: { status: 'DATA_OK' } }
      },
      { kind: 'pos', label: '正控（别名）：OK（归一化后形式）', over: { dataHealth: { status: 'OK' } } }
    ]
  },
  {
    /* §4 第 3 行 */
    id: 'domain', label: 'domain 域许可',
    cases: [
      { kind: 'neg', label: 'OUT_OF_DOMAIN + BLOCK_CANARY', over: { domainPermission: { status: 'OUT_OF_DOMAIN', permission: 'BLOCK_CANARY' } } },
      { kind: 'neg', label: 'PARTIAL_COVERAGE + CANARY_LIMITED', over: { domainPermission: { status: 'PARTIAL_COVERAGE', permission: 'CANARY_LIMITED' } } },
      {
        /* 从宽 ⟂ 从严（§0.3.1 N2 裁定的机器可判定形式）：
         * `CANARY_ALLOWED_WITH_WARNING` 在 `effective_canary` 的 `domainOk` 词表内（从宽），
         * 但**不在** `domain_strict_in_domain` 内（从严）⇒ 同一输入下 canary 成立而 shadow 必须不成立。 */
        kind: 'neg', label: 'PARTIAL_COVERAGE + CANARY_ALLOWED_WITH_WARNING（从宽档允许、从严档必须拒）',
        over: { domainPermission: { status: 'PARTIAL_COVERAGE', permission: 'CANARY_ALLOWED_WITH_WARNING' } },
        check: (o) => ({
          ok: o.effectiveCanary === true && o.eligible === false && o.shadowProduced === false,
          why: '§0.3.1：`effective_canary`（从宽）与 `guardedShadowEligible`（从严）**不得互换**——'
            + '同一输入可以 canary 成立但 shadow 不成立'
        })
      },
      { kind: 'neg', label: '域许可缺失（null）', over: { domainPermission: null } },
      { kind: 'pos', label: '正控：permission===ALLOW 且 status===IN_DOMAIN', over: { domainPermission: { status: 'IN_DOMAIN', permission: 'ALLOW' } } }
    ]
  },
  {
    /* §4 第 4 行：任何会让 guarded 结果成为**正式结果**的路径 ⇒ 必须拒 */
    id: 'safety', label: 'safety 采纳阻断',
    cases: [
      {
        kind: 'neg', label: 'guarded 结果存在 + 强制 effectiveGuarded=true 仍不得采纳',
        over: { forceEffectiveGuarded: true }, check: block
      },
      {
        kind: 'neg', label: 'shadow 全绿但采纳资格（effective_guarded）恒 false',
        over: {},
        check: (o) => ({
          ok: o.effectiveGuarded === false && o.eligible === true && o.shadowProduced === true
            && o.selectorSource === SELECTOR_SOURCE.BASELINE && o.adopted === false && o.noopOk === true,
          why: '§3.3 口径分离：shadow **可计算**（eligible + 产出），但采纳资格恒 false，且 selector 恒 BASELINE'
        })
      },
      {
        kind: 'neg', label: '被投毒的审计对象不得改写生产字段',
        over: {}, custom: 'poison', check: (o) => ({
          ok: o.finalTarget === DECISION.final_target && o.finalAction === DECISION.final_action
            && o.suggested === DECISION.suggested_position && o.noopOk === true,
          why: 'overlay 硬还原：被投毒审计不得改写 final_target / final_action / suggested_position'
        })
      },
      {
        kind: 'pos', label: '正控：硬还原生效（反事实 target=25 与生产 target=15 不同仍被还原）',
        over: {}, check: (o) => ({
          ok: o.finalTarget === DECISION.final_target && o.finalAction === DECISION.final_action
            && o.finalTarget !== SHADOW_RERUN.target,
          why: '正控：反事实 target(25) ≠ 生产 target(15)，生产字段必须仍为 baseline'
        })
      }
    ]
  },
  {
    /* §4 第 5 行：非 Candidate 日 ⇒ 不得产生 guarded 差异 */
    id: 'candidate', label: 'candidate 模型触发',
    cases: [
      { kind: 'neg', label: '概率低于阈值（0.64 < 0.65）', over: { signal: Object.assign({}, baseInput({}).signal, { ml_fast: false, calibrated_probability: 0.64 }) } },
      { kind: 'neg', label: 'ml_fast=false 但概率很高（自相矛盾 ⇒ BLOCK）', over: { signal: Object.assign({}, baseInput({}).signal, { ml_fast: false, calibrated_probability: 0.95 }) } },
      { kind: 'neg', label: 'model_id 不符', over: { signal: Object.assign({}, baseInput({}).signal, { ml_model_id: 'HVT-A-ET-99999999' }) } },
      { kind: 'neg', label: '非 S2 阶段（stage=S3）', over: { signal: Object.assign({}, baseInput({}).signal, { stage: 'S3' }) } },
      { kind: 'neg', label: '无信号行（signal=null）', over: { signal: null } },
      { kind: 'pos', label: '正控：Candidate 日（P=0.82 / ml_fast / S2 / model_id 精确）', over: {} }
    ]
  },
  {
    /* §4 第 6 行；B2 裁定：正控**只能**用 synthetic / test-only 夹具（与 R5 不冲突） */
    id: 'seal', label: 'seal 封印（只用于夹具）',
    cases: [
      {
        kind: 'neg', label: '生产封印 PENDING ⇒ 两把 Key 均不成立',
        over: { guardedSeal: PENDING_SEAL },
        check: (o) => ({
          ok: o.effectiveGuarded === false && o.checks.freeze_seal_approved === false
            && o.checks.evidence_seal_pass === false,
          why: '负例：封印 PENDING ⇒ effective_guarded=false（生产制品不得改判）'
        })
      },
      {
        kind: 'neg', label: 'Evidence status=PASS 但 evidence_positive=false',
        over: { guardedSeal: SEAL_NOT_POSITIVE },
        check: (o) => ({
          ok: o.checks.freeze_seal_approved === true && o.checks.evidence_seal_pass === false,
          why: '负例：方向未证正 ⇒ Key 3 不得成立（GE-02 复审 P0-2）'
        })
      },
      {
        kind: 'pos', label: '正控（synthetic 夹具）：Freeze APPROVED + Evidence PASS(positive, ≥30)',
        over: { guardedSeal: SYNTH_SEAL },
        check: (o) => ({
          ok: o.checks.freeze_seal_approved === true && o.checks.evidence_seal_pass === true
            && o.selectorSource === SELECTOR_SOURCE.BASELINE && o.adopted === false && o.noopOk === true,
          why: '正控：seal gate 本身可通过，但 selector 仍 BASELINE（dormant）'
        })
      },
      {
        kind: 'pos', label: '正控：synthetic 夹具 + GUARDED_EFFECTIVE 档 ⇒ 八项齐备但 selector 仍 BASELINE',
        over: { params: { gen1_authority: 'GUARDED_EFFECTIVE' }, guardedSeal: SYNTH_SEAL },
        check: (o) => ({
          ok: o.effectiveGuarded === true && o.selectorSource === SELECTOR_SOURCE.BASELINE
            && o.adopted === false && o.noopOk === true,
          why: '正控：三钥匙齐备时 effective_guarded 成立，但**采用**仍被选择器阻断（F 护栏）'
        })
      }
    ]
  },
  {
    /* §4 第 7 行 */
    id: 'authority', label: 'authority 授权档',
    cases: [
      {
        kind: 'neg', label: 'ADVISORY（低一档：无权生成 canary，更无权 shadow）',
        over: { params: { gen1_authority: 'ADVISORY' } },
        check: (o) => ({
          ok: o.authority === 'ADVISORY' && o.effectiveCanary === false
            && o.eligible === false && o.shadowProduced === false,
          why: '负例：ADVISORY 档 ⇒ authority_canary 不成立 ⇒ shadow 不成立'
        })
      },
      { kind: 'neg', label: 'SHADOW', over: { params: { gen1_authority: 'SHADOW' } } },
      { kind: 'neg', label: 'OFF', over: { params: { gen1_authority: 'OFF' } } },
      {
        kind: 'neg', label: '未知取值 ROOT（⇒ 默认 ADVISORY，绝不因非法输入升权）',
        over: { params: { gen1_authority: 'ROOT' } },
        check: (o) => ({
          ok: o.authority === 'ADVISORY' && o.eligible === false && o.shadowProduced === false,
          why: '负例：未知 authority 回落 DEFAULT_ADVISORY（fail-closed，不得升权）'
        })
      },
      {
        kind: 'neg', label: 'PRODUCTION（永久锁定 ⇒ 降级 ADVISORY，绝不可达）',
        over: { params: { gen1_authority: 'PRODUCTION' } },
        check: (o) => ({
          ok: o.authority === 'ADVISORY' && o.authorityDowngraded === true
            && o.productionWrite === false && o.autoExecution === false
            && o.eligible === false && o.shadowProduced === false,
          why: '负例：PRODUCTION 永久锁定 ⇒ 降级 ADVISORY，且 production_write / auto_execution 恒 false'
        })
      },
      { kind: 'pos', label: '正控：CANARY', over: {} }
    ]
  }
];

/**
 * 执行矩阵。
 * @param {Array} [classes] 缺省用 `MATRIX_CLASSES`（测试可传入**被破坏**的矩阵以自证可失败）
 * @returns {{ok: boolean, designOk: boolean, classes: number, rows: object[], observations: object[]}}
 */
function runMatrix(classes) {
  const list = classes || MATRIX_CLASSES;
  const rows = [];
  const observations = [];
  let ok = true;
  for (const cls of list) {
    const negs = cls.cases.filter((c) => c.kind === 'neg');
    const poss = cls.cases.filter((c) => c.kind === 'pos');
    const diffs = cls.cases.filter((c) => c.kind === 'diff');
    const clsRow = {
      id: cls.id, label: cls.label, neg: negs.length, pos: poss.length, diff: diffs.length,
      failures: [], findings: []
    };
    for (const c of cls.cases) {
      const obs = c.custom === 'poison' ? poisonProbe() : probe(c.over);
      /* ⛔ 未知 kind 一律 fail-closed（不得静默通过） */
      const judge = typeof c.check === 'function' ? c.check : DEFAULT_CHECK[c.kind];
      const res = c.kind === 'diff'
        ? { ok: true, why: '（口径差登记，⛔ 不判 PASS/FAIL）' }
        : (typeof judge === 'function'
          ? judge(obs)
          : { ok: false, why: `未知用例类型 kind=${c.kind}（§4 只允许 neg / pos / diff）` });
      if (!res.ok) clsRow.failures.push(`${c.kind}/${c.label}: ${res.why}`);
      if (c.kind === 'diff') {
        clsRow.findings.push(`${c.label} ⇒ health_allows_guarded=${obs.checks.health_allows_guarded}`
          + ` / eligible=${obs.eligible}（与 §4 字面口径的差异见源码注释）`);
      }
      observations.push({ cls: cls.id, kind: c.kind, label: c.label, obs });
    }
    /* §4(a)：每一类都必须同时具备 负例 与 正控（**含 seal**，缺一不可） */
    if (negs.length < 1) clsRow.failures.push('§4(a) 缺少负例');
    if (poss.length < 1) clsRow.failures.push('§4(a) 缺少正控');
    if (clsRow.failures.length) ok = false;
    rows.push(clsRow);
  }
  /* §4(c)：类别数固定为 7 */
  const designOk = list.length === 7;
  if (!designOk) ok = false;
  return { ok, designOk, classes: list.length, rows, observations };
}

/* ==================================================================== *
 * §0.2.1 计数口径：eligible_count >= shadow_invocations >= 0，effective_invocations = 0
 *   ⚠️ 明示允许的**不对称**：eligible 成立而 rerun 未执行 ⇒ eligible 增、invocations 不增
 *      —— §0.2.1 定性为「有用的审计信号」，⛔ 不是缺陷。
 * ==================================================================== */
const SIGNAL_CASES = [
  { id: 'eligible_and_rerun', label: '有资格 + rerun 已执行', over: {}, expect: { eligible: true, shadowProduced: true } },
  {
    id: 'eligible_no_rerun', label: '有资格 + rerun 未执行（§0.2.1 审计信号）',
    over: { rerunUnavailable: true }, expect: { eligible: true, shadowProduced: false }
  },
  {
    id: 'ineligible_with_rerun', label: '无资格 + rerun 对象存在（⛔ 不得认领）',
    over: { healthGate: omit(HEALTH_OK, 'gate_status') }, expect: { eligible: false, shadowProduced: false }
  }
];

/** 计数（§0.2.1）：由**同一批次**的观测逐条累计，口径与 `runDecisionEngine` 同构。 */
function countBatch(observations) {
  let eligible = 0; let invocations = 0; let effective = 0;
  for (const r of observations) {
    const o = r && r.obs ? r.obs : {};
    if (o.eligible === true) eligible += 1;
    if (o.eligible === true && o.shadowProduced === true) invocations += 1;
    if (o.adopted === true) effective += 1;
  }
  return {
    eligible_count: eligible, shadow_invocations: invocations, effective_invocations: effective,
    invariant_ok: eligible >= invocations && invocations >= 0 && effective === 0
  };
}

/** 跑 §0.2.1 的审计信号场景，并复算该批次的计数不变量。 */
function runSignalScenarios() {
  const rows = SIGNAL_CASES.map((c) => {
    const obs = probe(c.over);
    return {
      id: c.id, label: c.label, obs,
      ok: obs.eligible === c.expect.eligible && obs.shadowProduced === c.expect.shadowProduced
    };
  });
  const counts = countBatch(rows);
  return { ok: rows.every((r) => r.ok), rows, counts };
}

/** D4：确定性 replay —— 一批**逐字段稳定**的行（顺序 = 声明顺序，无时间 / 无随机）。 */
function runReplayBatch() {
  const m = runMatrix(MATRIX_CLASSES);
  const s = runSignalScenarios();
  const rows = m.observations.map((r) => `matrix/${r.cls}/${r.kind}/${r.label}~${stable(r.obs)}`);
  for (const r of s.rows) rows.push(`signal/${r.id}/${r.label}~${stable(r.obs)}`);
  return rows;
}

/** `replay_ref`：批次可回指标识（sha256(harness_id + 全部稳定行)）。 */
function computeReplayRef() {
  const rows = runReplayBatch();
  return crypto.createHash('sha256')
    .update(REPLAY_HARNESS_ID + '\n' + rows.join('\n'), 'utf8').digest('hex');
}

function main() {
  const argv = process.argv.slice(2);
  const emitIdx = argv.indexOf('--emit');
  const emitPath = emitIdx >= 0 ? argv[emitIdx + 1] : null;

  console.log(`\n== GE-03 离线 replay harness（${REPLAY_HARNESS_ID}）==`);
  console.log('⛔ 只读合成夹具；不代表生产写权限；⛔ 不产生 Evidence 事件（R8 / D11）');

  const m = runMatrix(MATRIX_CLASSES);
  console.log('\n【§4 的 7 类反例矩阵】');
  for (const r of m.rows) {
    const mark = r.failures.length ? 'FAIL' : 'PASS';
    console.log(`  [${mark}] ${r.id.padEnd(10)} ${r.label}  负例 ${r.neg} / 正控 ${r.pos}`
      + (r.diff ? ` / 口径差登记 ${r.diff}` : ''));
    for (const f of r.failures) console.log(`         x ${f}`);
  }
  if (!m.designOk) console.log('  [FAIL] §4(c) 类别数必须固定为 7');
  console.log(`  —— 类别数 ${m.classes}（必须 = 7）；D2 护栏：selector 恒 BASELINE`
    + ` / GE_02_BASELINE_AUTHORITATIVE=${GE_02_BASELINE_AUTHORITATIVE}`);

  console.log('\n【§0.2.1 计数不变量（含审计信号场景）】');
  const sig = runSignalScenarios();
  for (const r of sig.rows) {
    console.log(`  [${r.ok ? 'PASS' : 'FAIL'}] ${r.id.padEnd(22)} eligible=${r.obs.eligible}`
      + ` shadow_produced=${r.obs.shadowProduced}  ${r.label}`);
  }
  const c = sig.counts;
  console.log(`  eligible_count=${c.eligible_count}  shadow_invocations=${c.shadow_invocations}`
    + `  effective_invocations=${c.effective_invocations}`);
  console.log(`  [${c.invariant_ok ? 'PASS' : 'FAIL'}] eligible_count >= shadow_invocations >= 0`
    + ' 且 effective_invocations = 0（✅ eligible 增而 invocations 不增是审计信号，非缺陷）');

  console.log('\n【D4 确定性 replay】');
  const r1 = runReplayBatch();
  const r2 = runReplayBatch();
  const det = r1.length === r2.length && r1.every((v, i) => v === r2[i]);
  console.log(`  批次行数=${r1.length}（矩阵 ${m.observations.length} + 审计信号 ${sig.rows.length}）`);
  console.log(`  [${det ? 'PASS' : 'FAIL'}] 同一批次两次运行逐字段一致（diff 为空）`);
  const ref = computeReplayRef();
  console.log(`  gen1_guarded_shadow_replay_ref=${ref}`);
  console.log('  ⚠️ 该 ref 仅作离线取证回指；**生产 runtime_status 恒 null**（线上不 replay）');

  const findings = m.rows.filter((r) => r.findings.length);
  if (findings.length) {
    console.log('\n【口径差登记（留 owner 裁定；⛔ 不改任何判据）】');
    for (const r of findings) for (const f of r.findings) console.log(`  [FINDING] ${r.id}: ${f}`);
  }

  if (emitPath) {
    require('fs').writeFileSync(emitPath, JSON.stringify({
      harness: REPLAY_HARNESS_ID,
      replay_ref: ref,
      counts: c,
      classes: m.rows.map((r) => ({
        id: r.id, neg: r.neg, pos: r.pos, diff: r.diff, failures: r.failures, findings: r.findings
      })),
      signal: sig.rows.map((r) => ({ id: r.id, ok: r.ok, eligible: r.obs.eligible, shadow_produced: r.obs.shadowProduced })),
      deterministic: det
    }, null, 2) + '\n', 'utf8');
    console.log(`\n  [emit] ${emitPath}`);
  }

  const allOk = m.ok && m.designOk && sig.ok && c.invariant_ok && det;
  console.log(`\n=== GE-03 replay harness：${allOk ? '全部通过' : '存在失败'}`
    + `（7 类 / ${m.observations.length} 条矩阵场景 + ${sig.rows.length} 条审计信号场景）===`);
  process.exitCode = allOk ? 0 : 1;
}

module.exports = {
  REPLAY_HARNESS_ID,
  MATRIX_CLASSES,
  SIGNAL_CASES,
  SYNTH_SEAL,
  PENDING_SEAL,
  SEAL_NOT_POSITIVE,
  BASELINE,
  DECISION,
  probe,
  probeFull,
  poisonProbe,
  runMatrix,
  runSignalScenarios,
  countBatch,
  runReplayBatch,
  computeReplayRef,
  stable
};

if (require.main === module) main();
