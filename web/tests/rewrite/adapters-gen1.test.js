/**
 * Gen-1 canonical 契约适配器测试（SPEC §6）
 *
 * 覆盖（对应 SPEC §14 的 1/2/3 类）：
 *   · canonical 优先于 legacy
 *   · canonical 整块缺失 ⇒ UNAVAILABLE（可自愈）
 *   · canonical 存在但字段为 null ⇒ MISSING（⛔ 不得静默 fallback）
 *   · authority 唯一来源（⛔ 不得由 ml_* 反推）
 *   · 安全三字段三态（true / false / null）
 *   · stages 三拆不得串位
 *   · gen1 / production 块 ⛔ 不含 legacy 语义键
 *   · counterfactual ⛔ 不得覆盖 production
 */
import { adaptGen1, legacyFallback, resolveAuthority, hasCanonicalContract, scanForbiddenKeys } from '../../src/rewrite/adapters/gen1.js';
import { FIELD_STATE, MISSING_REASON } from '../../src/rewrite/domain/enums.js';
import { FIXTURES, suite, assert, assertState } from './_fixtures.js';

const t = suite('adapters-gen1.test');
const prov = (f) => (f && f.provenance) || {};
const val = (f) => (f && f.state === FIELD_STATE.PROVIDED ? f.value : null);

/* ---------------- 1) 线上现状：无 canonical 契约 ---------------- */

t.ok('live-legacy：canonical 未下发 ⇒ UNAVAILABLE/CONTRACT_NOT_PROVIDED（可自愈）', () => {
  const live = FIXTURES.liveEtf();
  const rt = FIXTURES.liveConstants().runtime_status;
  assert.equal(hasCanonicalContract(live), false, '线上响应不应含 canonical 块');
  const vm = adaptGen1(live, rt);
  assert.equal(vm.canonicalAvailable, false);
  assert.equal(vm.unavailableReason, MISSING_REASON.CONTRACT_NOT_PROVIDED);
  assertState(vm.production.actionCode, FIELD_STATE.UNAVAILABLE, 'production.actionCode');
  assertState(vm.gen1.status, FIELD_STATE.UNAVAILABLE, 'gen1.status');
  assertState(vm.gen1.stages.effective, FIELD_STATE.UNAVAILABLE, 'gen1.stages.effective');
  assertState(vm.systemRuntime.production.engine, FIELD_STATE.UNAVAILABLE, 'system_runtime.production.engine');
});

t.ok('live-legacy：authority 兜底到 runtime_status.gen1_authority（唯一合法兜底）', () => {
  const live = FIXTURES.liveEtf();
  const rt = FIXTURES.liveConstants().runtime_status;
  const vm = adaptGen1(live, rt);
  assertState(vm.authority, FIELD_STATE.PROVIDED, 'authority');
  assert.equal(vm.authority.value, 'CANARY');
  assert.equal(prov(vm.authority).source, 'api:/api/constants#runtime_status.gen1_authority');
});

t.ok('live-legacy：允许显式 legacy fallback，且必须标注 fallbackFrom', () => {
  const live = FIXTURES.liveEtf();
  const fb = legacyFallback(live, null);
  assert.equal(fb.used, true);
  assert.equal(fb.reason, 'CANONICAL_ABSENT');
  assertState(fb.values.signalStatus, FIELD_STATE.PROVIDED, 'legacy signalStatus');
  assert.equal(prov(fb.values.signalStatus).fallbackFrom, 'legacy', '必须标注 legacy 来源');
});

/* ---------------- 2) canonical 契约（真实契约模块产出） ---------------- */

t.ok('canonical：契约下发 ⇒ 四块均可读，且 production 字段齐全（真实 9 字段）', () => {
  const c = FIXTURES.canonicalEtf();
  const vm = adaptGen1(c, null);
  assert.equal(vm.canonicalAvailable, true);
  assertState(vm.production.actionCode, FIELD_STATE.PROVIDED, 'action_code');
  assert.equal(vm.production.actionCode.value, 'STRATEGIC_REDUCE');
  assert.equal(val(vm.production.finalTargetPct), 0.5);
  assert.equal(val(vm.production.engine), 'v3.6.1');
  assert.equal(val(vm.production.engineSource), 'DECISION_RESULT_ENGINE_VERSION');
  assert.equal(val(vm.production.actionLabel), '战略减仓');
  assert.equal(val(vm.production.riskFlag), 'NORMAL');
  assert.equal(val(vm.production.bindingConstraint), 'none');
});

t.ok('canonical：gen1.status 是**字符串**（⛔ 不是 {label} 对象）', () => {
  const vm = adaptGen1(FIXTURES.canonicalEtf(), null);
  assertState(vm.gen1.status, FIELD_STATE.PROVIDED, 'gen1.status');
  assert.equal(typeof vm.gen1.status.value, 'string');
  assert.equal(vm.gen1.status.value, 'NO_OPPORTUNITY');
});

t.ok('canonical：gen1 无 authority_label（真实位置在 system_runtime.gen1）', () => {
  const vm = adaptGen1(FIXTURES.canonicalEtf(), null);
  assertState(vm.gen1.authorityLabel, FIELD_STATE.MISSING, 'gen1.authorityLabel 应为 MISSING');
  assert.equal(vm.gen1.authorityLabel.missingReason, MISSING_REASON.FIELD_ABSENT);
  assertState(vm.systemRuntime.gen1.authorityLabel, FIELD_STATE.PROVIDED, 'system_runtime.gen1.authorityLabel');
  assert.equal(vm.systemRuntime.gen1.authorityLabel.value, '灰度反事实');
});

t.ok('canonical：gen1.signal 有 threshold，**无** calibrated_probability', () => {
  const vm = adaptGen1(FIXTURES.canonicalEtf(), null);
  assert.equal(val(vm.gen1.signal.threshold), 0.65);
  assert.equal(vm.gen1.signal.calibratedProbability, undefined, '⛔ 不得臆造 calibrated_probability');
});

t.ok('canonical：stages 三拆，值互不覆盖（signal=S1 / baseline=S0 / effective=S0）', () => {
  const vm = adaptGen1(FIXTURES.canonicalEtf(), null);
  assert.equal(val(vm.gen1.stages.signal), 'S1');
  assert.equal(val(vm.gen1.stages.baseline), 'S0');
  assert.equal(val(vm.gen1.stages.effective), 'S0');
  assert.notEqual(val(vm.gen1.stages.signal), val(vm.gen1.stages.effective));
});

t.ok('canonical：safety.binding_stage 来源可归因（EOD_STAGE_PRECHECK）', () => {
  const vm = adaptGen1(FIXTURES.canonicalEtf(), null);
  assert.equal(val(vm.gen1.safety.permission), 'BLOCK');
  assert.equal(val(vm.gen1.safety.bindingStage), 'S1');
  assert.equal(val(vm.gen1.safety.bindingStageSource), 'EOD_STAGE_PRECHECK');
});

/* ---------------- 3) counterfactual ⛔ 不得覆盖 production（UI-G1-03） ---------------- */

t.ok('反向用例：counterfactual 存在时 production 值**不得**被污染', () => {
  const c = FIXTURES.canonicalEtf();
  const vm = adaptGen1(c, null);
  const prodTarget = val(vm.production.finalTargetPct);
  const cfTarget = val(vm.gen1.counterfactual.targetPct);
  // 真实数据里二者恰好相等，因此构造一个「反事实明显不同」的载体再断言
  const tampered = JSON.parse(JSON.stringify(c));
  tampered.gen1.counterfactual = { target_pct: 99, suggested_pct: 99, delta_pct: 99, stage_changed: true, clamped: false, baseline_floor_breached: false };
  const vm2 = adaptGen1(tampered, null);
  assert.equal(prodTarget, 0.5);
  assert.equal(val(vm2.production.finalTargetPct), 0.5, '反事实不得污染 production.final_target_pct');
  assert.equal(val(vm2.production.actionCode), 'STRATEGIC_REDUCE', '反事实不得污染 production.action');
  assert.equal(val(vm2.gen1.counterfactual.targetPct), 99, '反事实应只出现在 counterfactual 块');
  assert.notEqual(val(vm2.production.finalTargetPct), val(vm2.gen1.counterfactual.targetPct));
  // cfTarget 仅用于说明原始数据
  assert.ok(cfTarget !== null);
});

/* ---------------- 4) canonical 存在但字段为 null ⇒ MISSING，⛔ 不得 fallback ---------------- */

t.ok('canonical 字段为 null ⇒ MISSING(NULL_IN_CONTRACT)，⛔ 不静默 fallback 到 legacy', () => {
  const f = FIXTURES.fieldsNull();
  const vm = adaptGen1(f, null);
  assertState(vm.production.actionCode, FIELD_STATE.MISSING, 'production.actionCode');
  assert.equal(vm.production.actionCode.missingReason, MISSING_REASON.NULL_IN_CONTRACT);
  assert.equal(vm.production.actionCode.provenance.fallbackFrom, null, '⛔ 不得标为 legacy fallback');
  assertState(vm.gen1.status, FIELD_STATE.MISSING, 'gen1.status');
  assertState(vm.gen1.stages.signal, FIELD_STATE.MISSING, 'gen1.stages.signal');
});

t.ok('canonical 字段为 null 时，legacyFallback **必须判定未使用**（防止掩盖契约错误）', () => {
  const f = FIXTURES.fieldsNull();
  const fb = legacyFallback(f, null);
  assert.equal(fb.used, false);
  assert.equal(fb.reason, 'CANONICAL_PRESENT');
});

/* ---------------- 5) canonical 优先于 legacy ---------------- */

t.ok('canonical + legacy 并存 ⇒ canonical 胜出，legacy 不参与', () => {
  const f = FIXTURES.canonicalPlusLegacy();
  // 该 fixture 的 legacy 被故意设为「诱人但错误」：effective=true / permission=ALLOW / cf=99
  assert.equal(f.ml_shadow.effective, true, '前置：fixture 的 legacy 确为诱导值');
  const vm = adaptGen1(f, null);
  assert.equal(val(vm.production.actionCode), 'STRATEGIC_REDUCE', '必须用 canonical');
  assert.equal(val(vm.gen1.status), 'NO_OPPORTUNITY');
  const fb = legacyFallback(f, null);
  assert.equal(fb.used, false, 'canonical 存在时 ⛔ 不得启用 legacy');
});

t.ok('canonical 存在时 legacy fallback 判定为 CANONICAL_PRESENT', () => {
  assert.equal(legacyFallback(FIXTURES.canonicalEtf(), null).reason, 'CANONICAL_PRESENT');
});

/* ---------------- 6) 契约违规扫描 ---------------- */

t.ok('production / gen1 块 ⛔ 不含 legacy 语义键（UI-G1-12）', () => {
  const c = FIXTURES.canonicalEtf();
  assert.deepEqual(scanForbiddenKeys(c.production), [], 'production 含 legacy 键');
  assert.deepEqual(scanForbiddenKeys(c.gen1), [], 'gen1 含 legacy 键');
  const vm = adaptGen1(c, null);
  assert.deepEqual(vm.production.contractViolations, []);
  assert.deepEqual(vm.gen1.contractViolations, []);
});

t.ok('扫描器确实能发现违规（自检，防永真断言）', () => {
  const bad = { production: { action_code: 'ADD', ml_shadow: {}, advisory_enabled: true } };
  const hits = scanForbiddenKeys(bad.production);
  assert.ok(hits.length >= 1, '扫描器应能发现 ml_shadow');
  assert.ok(hits.some((h) => h.includes('ml_shadow')));
});

/* ---------------- 7) authority 唯一来源 ---------------- */

t.ok('authority ⛔ 不得由 ml_* 反推（无 runtime 且无契约 ⇒ UNAVAILABLE）', () => {
  const a = resolveAuthority({ ml_shadow: { ml_advisory_enabled: true, ml_fast_path_enabled: true } }, null);
  assertState(a, FIELD_STATE.UNAVAILABLE, 'authority');
  assert.equal(val(a), null, '⛔ 不得猜出 authority');
});

t.ok('authority 优先级：system_runtime > gen1 > runtime_status', () => {
  const fromSr = resolveAuthority({ system_runtime: { gen1: { authority: 'PRODUCTION' } }, gen1: { authority: 'CANARY' } }, { gen1_authority: 'ADVISORY' });
  assert.equal(val(fromSr), 'PRODUCTION');
  const fromGen1 = resolveAuthority({ gen1: { authority: 'CANARY' } }, { gen1_authority: 'ADVISORY' });
  assert.equal(val(fromGen1), 'CANARY');
  const fromRt = resolveAuthority({}, { gen1_authority: 'ADVISORY' });
  assert.equal(val(fromRt), 'ADVISORY');
});

/* ---------------- 8) 安全三字段三态 ---------------- */

t.ok('安全三字段三态：false 透传为 false（⛔ 不得压扁成 null，也不得硬编码）', () => {
  const vm = adaptGen1(FIXTURES.canonicalEtf(), null);
  assertState(vm.systemRuntime.gen1.productionWrite, FIELD_STATE.PROVIDED, 'production_write');
  assert.equal(vm.systemRuntime.gen1.productionWrite.value, false);
  assert.equal(val(vm.systemRuntime.gen1.productionFastPathEnabled), false);
  assert.equal(val(vm.systemRuntime.gen1.autoExecution), false);
  assert.equal(val(vm.systemRuntime.gen1.safetyInvariantOk), true);
});

t.ok('安全字段若为 true 必须透传 true（最该报警时不得显示绿色）', () => {
  const c = JSON.parse(JSON.stringify(FIXTURES.canonicalEtf()));
  c.system_runtime.gen1.production_write = true;
  c.system_runtime.gen1.auto_execution = true;
  c.system_runtime.gen1.safety_invariant_ok = false;
  const vm = adaptGen1(c, null);
  assert.equal(val(vm.systemRuntime.gen1.productionWrite), true);
  assert.equal(val(vm.systemRuntime.gen1.autoExecution), true);
  assert.equal(val(vm.systemRuntime.gen1.safetyInvariantOk), false);
});

t.ok('安全字段缺失 ⇒ MISSING（三态，⛔ 不得变成 false）', () => {
  const c = { system_runtime: { production: {}, gen1: { authority: 'CANARY' }, gen2: {} }, gen1: { authority: 'CANARY' }, production: {}, legacy: {} };
  const vm = adaptGen1(c, null);
  assertState(vm.systemRuntime.gen1.productionWrite, FIELD_STATE.MISSING, 'production_write');
  assert.notEqual(val(vm.systemRuntime.gen1.productionWrite), false, '⛔ 缺失不得当 false');
});

t.ok('gen2.production_write 为 null 时保留为 MISSING（三态，UI-G1-15 精神）', () => {
  const vm = adaptGen1(FIXTURES.canonicalEtf(), null);
  assert.equal(val(vm.systemRuntime.gen2.mode), 'SHADOW');
  assert.equal(val(vm.systemRuntime.gen2.source), 'STATIC_CURRENT_CONTRACT');
  assertState(vm.systemRuntime.gen2.productionWrite, FIELD_STATE.MISSING, 'gen2.production_write');
});

t.done();
