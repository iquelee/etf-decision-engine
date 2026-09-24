/**
 * V3.6.5 P-3 —— Atomic Publish PoC 测试
 *
 * 覆盖任务书 §6–§14：当前失败模式（只读）· F1–F8 failure injection ·
 * 并发/TOCTOU · Atomic 严格定义 · 消费者契约 · PoC Gate。
 *
 * 运行：node tests/v365-p3-atomic-publish-poc.test.js
 *
 * ⛔ 全程使用内存 adapter：不连数据库、不建生产 collection、不部署、不接线 runDecisionEngine。
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const U = (f) => require(path.join(REPO, 'src/common/utils', f));
const L = (f) => require(path.join(REPO, 'scripts/lib', f));

const {
  POC_COLLECTIONS, POINTER_ACTION, HOLD_REASON,
  classifyCandidateSet, validateCandidateSet, planPointerPromotion,
  executePointerPromotion, readActive, runPublishFlow
} = U('v365-atomic-publish.js');

const { RUN_STATUS } = U('v361-run-finality.js');
const { createMemoryAdapter } = L('v365-p3-memory-adapter.js');

let passed = 0;
let failed = 0;
const failures = [];
const asyncCases = [];

function testAsync(name, fn) { asyncCases.push({ name, fn }); }
function section(t) { console.log(`\n== ${t} ==`); }

const CODES = ['513310', '515880', '159582', '518880', '159570'];
const TD = '2026-09-23';
const SCOPE = 'production';

function mkManifest(o) {
  return {
    run_id: o.run_id,
    revision: o.revision,
    expected_trade_date: o.trade_date || TD,
    expected_codes: CODES,
    input_hash: `hash-${o.run_id}`,
    status: 'CALCULATING',
    created_at: o.created_at || '2026-09-23T22:00:00Z'
  };
}

/** 生成 5 只候选；failCodes 中的 code 标记 ok:false；dateOverride 可制造 mixed-date */
function mkDecisions(date, failCodes, dateOverride) {
  const fails = new Set(failCodes || []);
  return CODES.map((c) => ({
    code: c,
    calc_date: (dateOverride && dateOverride[c]) || date,
    ok: !fails.has(c),
    payload: { final_target: 10, final_action: 'HOLD' }
  }));
}

function mkPortfolio(date) {
  return { calc_date: date, payload: { total_asset: 100000, tech_position: 30 } };
}

/** 完整走一次「写候选 → 分类 → 校验 → 决定 → 提升」 */
async function publish(adapter, opts) {
  const o = opts || {};
  const manifest = mkManifest({ run_id: o.run_id, revision: o.revision, trade_date: o.trade_date });
  const decisions = o.decisions || mkDecisions(o.trade_date || TD);
  const portfolio = o.portfolio === undefined ? mkPortfolio(o.trade_date || TD) : o.portfolio;
  return runPublishFlow({ adapter, scope: SCOPE, manifest, decisions, portfolio });
}

/* ================================================================== *
 * §A 当前生产失败模式（只读证据）
 * ================================================================== */
section('§A 当前生产写入时序（只读证据）');

testAsync('A.1【B1 后更新】runDecisionEngine 已接线：决策写入改经发布路由器 + 存在 active/pointer 契约', async () => {
  const src = fs.readFileSync(path.join(REPO, 'cloudfunctions', 'runDecisionEngine', 'index.js'), 'utf8');
  // ⚠️ 本条原为「记录修复前缺口」的断言（逐票直写 authoritative、无 pointer 概念）。
  //    B1 接线后该缺口已被关闭 ⇒ 断言改为证明**新事实**（更强，不是放宽）。
  assert.ok(src.includes('async function v365WriteDecision'),
    'B1：必须存在决策发布写入路由器');
  assert.ok(src.includes('CANDIDATE_DECISION'),
    'B1：ENFORCE 路径必须写 candidate 集合（不再无条件直写 authoritative）');
  assert.ok(src.includes('publishStore.createCloudbaseStore'),
    'B1：必须构造发布存储适配器（CAS 能力由它 fail-closed 兜底）');
  assert.ok(src.includes('v365Finality'),
    'B1：必须有 Run Finality 分类参与发布门');
  // LEGACY 分支必须保留旧写入语义（对照回放用），且 portfolio_position 仍由生产路径维护
  assert.ok(src.includes('db.upsert(COLLECTIONS.DECISION_RESULT'),
    'LEGACY 分支保留旧 decision_result 写入语义');
  assert.ok(src.includes('await db.upsert(COLLECTIONS.PORTFOLIO_POSITION'),
    'portfolio_position 属「可变当前状态」轴，仍由生产路径维护');
  // active / manifest / pointer 契约必须存在
  const v365 = U('v365-run-integrity.js');
  assert.ok(v365.V365_COLLECTIONS.ACTIVE_POINTER, 'B1：必须存在 active pointer 契约');
  assert.ok(v365.V365_COLLECTIONS.RUN_MANIFEST, 'B1：必须存在 run manifest 契约');
  // CAS 必须走平台事务；缺能力时 fail-closed（不得降级成先读后写）
  const storeSrc = fs.readFileSync(path.join(REPO, 'src/common/utils', 'v365-publish-store.js'), 'utf8');
  assert.ok(storeSrc.includes('runTransaction'), 'CAS 必须走平台事务 API');
  assert.ok(storeSrc.includes('CAS_UNAVAILABLE'), '缺事务能力必须返回 CAS_UNAVAILABLE（fail-closed）');
});

/* ================================================================== *
 * §B Failure Injection F1–F8
 * ================================================================== */
section('§B Failure Injection F1–F8');

testAsync('P3-F1 5/5 成功 → COMPLETE 且 pointer 切到新 run', async () => {
  const a = createMemoryAdapter();
  const r = await publish(a, { run_id: 'run-A', revision: 1 });
  assert.strictEqual(r.finality.status, RUN_STATUS.COMPLETE);
  assert.strictEqual(r.validation.passed, true);
  assert.strictEqual(r.plan.action, POINTER_ACTION.PROMOTE);
  assert.strictEqual(r.exec.promoted, true);
  const p = await a.getPointer(SCOPE);
  assert.strictEqual(p.run_id, 'run-A');
  assert.strictEqual(p.revision, 1);
});

testAsync('P3-F2 4/5 成功，1 只失败 → PARTIAL，pointer unchanged', async () => {
  const a = createMemoryAdapter();
  await publish(a, { run_id: 'run-OK', revision: 1 });
  const before = await a.getPointer(SCOPE);

  const r = await publish(a, { run_id: 'run-B', revision: 2, decisions: mkDecisions(TD, ['159570']) });
  assert.strictEqual(r.finality.status, RUN_STATUS.PARTIAL, '必须识别为 PARTIAL');
  assert.strictEqual(r.plan.action, POINTER_ACTION.HOLD);
  assert.ok(r.plan.reason.startsWith(HOLD_REASON.RUN_NOT_COMPLETE));
  assert.strictEqual(r.exec.promoted, false);
  assert.deepStrictEqual(await a.getPointer(SCOPE), before, 'pointer 必须不变');
});

testAsync('P3-F3 5/5 成功但 RunContext mixed-date → validation fail，pointer unchanged', async () => {
  const a = createMemoryAdapter();
  await publish(a, { run_id: 'run-OK', revision: 1 });
  const before = await a.getPointer(SCOPE);

  const r = await publish(a, {
    run_id: 'run-C', revision: 2,
    decisions: mkDecisions(TD, [], { '159570': '2026-09-22' })   // 一只掉到 T-1
  });
  assert.strictEqual(r.finality.status, RUN_STATUS.COMPLETE, '单看 finality 是 COMPLETE');
  assert.strictEqual(r.validation.passed, false);
  assert.strictEqual(r.validation.reason, 'mixed_date_detected');
  assert.strictEqual(r.plan.action, POINTER_ACTION.HOLD);
  assert.ok(r.plan.reason.includes(HOLD_REASON.VALIDATION_FAILED));
  assert.deepStrictEqual(await a.getPointer(SCOPE), before, 'pointer 必须不变');
});

testAsync('P3-F4 candidate 全完成，但 portfolio write failure → pointer unchanged', async () => {
  const a = createMemoryAdapter();
  await publish(a, { run_id: 'run-OK', revision: 1 });
  const before = await a.getPointer(SCOPE);

  // 手工流程：5 个 decision 写成功后，portfolio 写入抛错
  const manifest = mkManifest({ run_id: 'run-D', revision: 2 });
  await a.putManifest(manifest);
  for (const d of mkDecisions(TD)) {
    await a.putCandidate(POC_COLLECTIONS.RUN_CANDIDATE_DECISION, 'run-D', String(d.code), d);
  }
  a.injectFailure('putCandidate', `${POC_COLLECTIONS.RUN_CANDIDATE_PORTFOLIO}:portfolio`, 1);
  let threw = false;
  try {
    await a.putCandidate(POC_COLLECTIONS.RUN_CANDIDATE_PORTFOLIO, 'run-D', 'portfolio', mkPortfolio(TD));
  } catch (e) { threw = true; assert.strictEqual(e.code, 'INJECTED_FAILURE'); }
  assert.strictEqual(threw, true, 'portfolio 写必须失败');

  // 回读 → portfolio 缺失 ⇒ validation fail ⇒ HOLD
  const decisions = await a.listCandidates(POC_COLLECTIONS.RUN_CANDIDATE_DECISION, 'run-D');
  const portfolio = await a.getCandidate(POC_CANDIDATE_PORTFOLIO_FALLBACK(), 'run-D', 'portfolio');
  const finality = classifyCandidateSet(manifest, decisions);
  const validation = validateCandidateSet({ manifest, decisions, portfolio });
  assert.strictEqual(validation.passed, false);
  assert.strictEqual(validation.reason, 'missing_portfolio_candidate');
  const plan = planPointerPromotion({
    finality, validation, manifest, current_pointer: await a.getPointer(SCOPE)
  });
  assert.strictEqual(plan.action, POINTER_ACTION.HOLD);
  assert.deepStrictEqual(await a.getPointer(SCOPE), before, 'pointer 必须不变');
});

testAsync('P3-F5 pointer promotion 前 crash → 旧 active 保留', async () => {
  const a = createMemoryAdapter();
  await publish(a, { run_id: 'run-OK', revision: 1 });
  const before = await a.getPointer(SCOPE);

  a.injectFailure('compareAndSetPointer', SCOPE, 1);
  let crashed = false;
  try {
    await publish(a, { run_id: 'run-E', revision: 2 });
  } catch (e) { crashed = true; assert.strictEqual(e.code, 'INJECTED_FAILURE'); }
  assert.strictEqual(crashed, true, '提升前必须发生崩溃');

  assert.deepStrictEqual(await a.getPointer(SCOPE), before, '旧 active 必须保留');
  const active = await readActive(a, SCOPE);
  assert.strictEqual(active.pointer.run_id, 'run-OK', '消费者仍读到旧 active');
});

testAsync('P3-F6 promotion 后 client retry 同一 run_id → 幂等，不产生新 revision', async () => {
  const a = createMemoryAdapter();
  const first = await publish(a, { run_id: 'run-F', revision: 1 });
  assert.strictEqual(first.exec.promoted, true);
  const p1 = await a.getPointer(SCOPE);

  const retry = await publish(a, { run_id: 'run-F', revision: 1 });
  assert.strictEqual(retry.plan.action, POINTER_ACTION.ALREADY_ACTIVE);
  assert.strictEqual(retry.exec.promoted, false);
  const p2 = await a.getPointer(SCOPE);
  assert.deepStrictEqual(p2, p1, 'retry 不得改变 pointer');
  assert.strictEqual(p2.revision, 1, '不得产生新 revision');
});

testAsync('P3-F7 同一 trade_date、不同 run_id → 显式规则（monotonic revision + supersedes 记录）', async () => {
  const a = createMemoryAdapter();
  await publish(a, { run_id: 'run-G1', revision: 1 });

  const r2 = await publish(a, { run_id: 'run-G2', revision: 2 });      // 同 TD，更新 revision
  assert.strictEqual(r2.plan.action, POINTER_ACTION.PROMOTE);
  assert.strictEqual(r2.plan.same_trade_date_supersede, true);
  assert.strictEqual(r2.plan.supersedes_run_id, 'run-G1', '必须显式记录被取代者');
  const p = await a.getPointer(SCOPE);
  assert.strictEqual(p.run_id, 'run-G2');
  assert.strictEqual(p.promoted_from_run_id, 'run-G1');

  // 反向：revision 更小的（更"早"的）run 不得覆盖
  const stale = await publish(a, { run_id: 'run-G0', revision: 0 });
  assert.strictEqual(stale.plan.action, POINTER_ACTION.HOLD);
  assert.ok(stale.plan.reason.includes(HOLD_REASON.STALE_RUN), '必须明确拒绝「较旧 run 覆盖较新」');
  assert.strictEqual((await a.getPointer(SCOPE)).run_id, 'run-G2');
});

testAsync('P3-F8 旧 active 已存在，新 candidate FAILED → 消费者永远读旧 active', async () => {
  const a = createMemoryAdapter();
  await publish(a, { run_id: 'run-OK', revision: 1 });

  // 全部失败 ⇒ FAILED
  const allFail = CODES;
  const r = await publish(a, { run_id: 'run-H', revision: 2, decisions: mkDecisions(TD, allFail) });
  assert.strictEqual(r.finality.status, RUN_STATUS.FAILED);
  assert.strictEqual(r.plan.action, POINTER_ACTION.HOLD);

  const active = await readActive(a, SCOPE);
  assert.strictEqual(active.active, true);
  assert.strictEqual(active.pointer.run_id, 'run-OK', '消费者必须仍然读到旧 active');
  assert.strictEqual(active.manifest.run_id, 'run-OK');
  assert.strictEqual(active.decisions.length, CODES.length, '旧 active 的 dataset 完整');
});

/* ================================================================== *
 * §C 并发 / TOCTOU
 * ================================================================== */
section('§C 并发与 TOCTOU');

testAsync('C.1 Run A / Run B 交错：B 先提升，较旧的 A 后到 → 被拒', async () => {
  const a = createMemoryAdapter();
  // 两个 run 都从「无 pointer」开始（revision 0 基线）
  const pA0 = await a.getPointer(SCOPE);     // null
  const pB0 = await a.getPointer(SCOPE);     // null

  // B 先完成并提升
  const rB = await publish(a, { run_id: 'run-B', revision: 2 });
  assert.strictEqual(rB.exec.promoted, true);

  // A（revision 更小，逻辑上更早）后到，且手里还是旧快照
  const rA = await publish(a, { run_id: 'run-A', revision: 1 });
  assert.strictEqual(rA.plan.action, POINTER_ACTION.HOLD);
  assert.ok(rA.plan.reason.includes(HOLD_REASON.STALE_RUN));

  assert.strictEqual((await a.getPointer(SCOPE)).run_id, 'run-B', 'B 不得被较旧的 A 覆盖');
  assert.ok(pA0 === null && pB0 === null);
});

testAsync('C.2 CAS：持过期 pointer 快照提升 → 被 compare-and-set 拒绝', async () => {
  const a = createMemoryAdapter();
  await publish(a, { run_id: 'run-BASE', revision: 1 });

  // A 读到 pointer 快照
  const staleSnapshot = await a.getPointer(SCOPE);

  // 并发者 B 抢先提升（revision 2）
  await publish(a, { run_id: 'run-B2', revision: 2 });

  // A 用**旧快照**做 CAS 提升（revision 3 更大，但期望的 pointer 已过期）
  const manifest = mkManifest({ run_id: 'run-A3', revision: 3 });
  const decisions = mkDecisions(TD);
  const portfolio = mkPortfolio(TD);
  await a.putManifest(manifest);
  for (const d of decisions) {
    await a.putCandidate(POC_COLLECTIONS.RUN_CANDIDATE_DECISION, 'run-A3', String(d.code), d);
  }
  await a.putCandidate(POC_COLLECTIONS.RUN_CANDIDATE_PORTFOLIO, 'run-A3', 'portfolio', portfolio);
  const finality = classifyCandidateSet(manifest, decisions);
  const validation = validateCandidateSet({ manifest, decisions, portfolio });
  // 用「A 看到时的 pointer」做期望，而不是当前真实 pointer
  const plan = planPointerPromotion({ finality, validation, manifest, current_pointer: staleSnapshot });
  assert.strictEqual(plan.action, POINTER_ACTION.PROMOTE);

  const exec = await executePointerPromotion({
    adapter: a, scope: SCOPE, plan, expected_pointer: staleSnapshot
  });
  assert.strictEqual(exec.promoted, false, 'CAS 必须拒绝');
  assert.strictEqual(exec.reason, HOLD_REASON.CAS_REJECTED);
  assert.strictEqual((await a.getPointer(SCOPE)).run_id, 'run-B2', '并发者 B 的结果必须保留');
});

testAsync('C.3 不以 wall-clock 决定胜负：created_at 更晚但 revision 更小 → 拒绝', async () => {
  const a = createMemoryAdapter();
  await publish(a, { run_id: 'run-NEWER-REV', revision: 5, created_at: '2026-09-23T22:00:00Z' });

  // 这个 run 的 created_at 更晚（wall-clock 更"新"），但 revision 更小
  const r = await publish(a, { run_id: 'run-LATER-CLOCK', revision: 3, created_at: '2026-09-23T23:59:00Z' });
  assert.strictEqual(r.plan.action, POINTER_ACTION.HOLD);
  assert.ok(r.plan.reason.includes(HOLD_REASON.STALE_RUN), '⛔ 不得靠 wall-clock 覆盖');
  assert.strictEqual((await a.getPointer(SCOPE)).run_id, 'run-NEWER-REV');
});

/* ================================================================== *
 * §D Atomic 严格定义与消费者契约
 * ================================================================== */
section('§D Atomic 定义与消费者契约');

testAsync('D.1 partial candidate 永不成为 authoritative（逐条写过程中读取仍是旧 run）', async () => {
  const a = createMemoryAdapter();
  await publish(a, { run_id: 'run-OK', revision: 1 });

  // 新 run 逐条写，中途读取
  const m = mkManifest({ run_id: 'run-PART', revision: 2 });
  await a.putManifest(m);
  const ds = mkDecisions(TD);
  for (let i = 0; i < 3; i++) {
    await a.putCandidate(POC_COLLECTIONS.RUN_CANDIDATE_DECISION, 'run-PART', String(ds[i].code), ds[i]);
    const active = await readActive(a, SCOPE);
    assert.strictEqual(active.pointer.run_id, 'run-OK',
      `写入第 ${i + 1} 条后，消费者仍必须读到旧完整 run`);
    assert.strictEqual(active.decisions.length, CODES.length);
  }
  // 候选库里确实有半个新 run（说明"逐条写"发生），但 authoritative 未变
  const half = await a.listCandidates(POC_COLLECTIONS.RUN_CANDIDATE_DECISION, 'run-PART');
  assert.strictEqual(half.length, 3, 'partial candidate 确实存在');
});

testAsync('D.2 消费者只读 pointer 指向的 dataset，不读「最新写入」', async () => {
  const a = createMemoryAdapter();
  await publish(a, { run_id: 'run-OLD', revision: 1 });
  // 新 run 写入但**不提升**
  await publish(a, { run_id: 'run-NEW-NOPROMOTE', revision: 2, decisions: mkDecisions(TD, ['518880']) });

  const active = await readActive(a, SCOPE);
  assert.strictEqual(active.pointer.run_id, 'run-OLD');
  assert.strictEqual(active.decisions.every((d) => d.ok !== false), true);
  const snap = a.snapshot();
  assert.ok(snap.manifests['run-NEW-NOPROMOTE'], '新 run 的 manifest 存在（写了）');
  assert.notStrictEqual(snap.pointers[SCOPE].run_id, 'run-NEW-NOPROMOTE', '但它不是 active');
});

testAsync('D.3 无 pointer 时 readActive → active:false（不编造 dataset）', async () => {
  const a = createMemoryAdapter();
  const active = await readActive(a, SCOPE);
  assert.strictEqual(active.active, false);
  assert.strictEqual(active.pointer, null);
  assert.deepStrictEqual(active.decisions, []);
});

/* ================================================================== *
 * §E Finality 语义与 Gate
 * ================================================================== */
section('§E Finality 语义');

testAsync('E.1 COMPLETE / PARTIAL / FAILED 三态与健康语义互不相同', async () => {
  const m = mkManifest({ run_id: 'r', revision: 1 });
  const c = classifyCandidateSet(m, mkDecisions(TD));
  const p = classifyCandidateSet(m, mkDecisions(TD, ['159570']));
  const f = classifyCandidateSet(m, mkDecisions(TD, CODES));
  assert.strictEqual(c.status, RUN_STATUS.COMPLETE);
  assert.strictEqual(p.status, RUN_STATUS.PARTIAL);
  assert.strictEqual(f.status, RUN_STATUS.FAILED);
  assert.notStrictEqual(c.health_semantics, p.health_semantics);
  assert.notStrictEqual(p.health_semantics, f.health_semantics);
  assert.strictEqual(c.publishable, true);
  assert.strictEqual(p.publishable, false);
  assert.strictEqual(f.publishable, false);
});

testAsync('E.2 只有 COMPLETE + validation_passed 才有资格 promote', async () => {
  const m = mkManifest({ run_id: 'r', revision: 9 });
  const complete = classifyCandidateSet(m, mkDecisions(TD));
  const partial = classifyCandidateSet(m, mkDecisions(TD, ['159570']));
  const okVal = { passed: true, reason: 'ok' };
  const badVal = { passed: false, reason: 'mixed_date_detected' };

  const p1 = planPointerPromotion({ finality: complete, validation: okVal, manifest: m, current_pointer: null });
  assert.strictEqual(p1.action, POINTER_ACTION.PROMOTE);

  const p2 = planPointerPromotion({ finality: partial, validation: okVal, manifest: m, current_pointer: null });
  assert.strictEqual(p2.action, POINTER_ACTION.HOLD);

  const p3 = planPointerPromotion({ finality: complete, validation: badVal, manifest: m, current_pointer: null });
  assert.strictEqual(p3.action, POINTER_ACTION.HOLD);

  const n = planPointerPromotion({ finality: complete, validation: okVal, manifest: m, current_pointer: null });
  assert.strictEqual(n.two_stage_action, 'promote_active', '与既有两阶段设计一致');
  assert.strictEqual(n.phase, 'VALIDATED');
  assert.strictEqual(n.next_phase, 'ACTIVE');
});

/* ------------------------------------------------------------------ *
 * 异步执行 + 汇总
 * ------------------------------------------------------------------ */
function POC_CANDIDATE_PORTFOLIO_FALLBACK() { return POC_COLLECTIONS.RUN_CANDIDATE_PORTFOLIO; }

(async () => {
  for (const c of asyncCases) {
    try {
      await c.fn();
      passed += 1;
      console.log(`  \u2713 ${c.name}`);
    } catch (e) {
      failed += 1;
      failures.push({ name: c.name, err: e });
      console.log(`  \u2717 ${c.name}`);
      console.log(`      ${e && e.message}`);
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) {
    failures.forEach((f) => console.log(`  \u2717 ${f.name}: ${f.err && f.err.message}`));
    process.exit(1);
  }
})();
