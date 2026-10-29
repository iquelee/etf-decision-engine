#!/usr/bin/env node
/**
 * V3.6.5 P-3 —— Atomic Publish PoC Gate（任务书 §14）
 *
 * 输出 8 项判定并给出 `P3_ATOMIC_PUBLISH_POC = PASS / FAIL`。
 *
 * ⛔ 只读 + 内存 adapter：不连库、不建生产 collection、不部署、不接线 runDecisionEngine。
 * ⛔ 不调子进程（沙箱禁止）——全部在进程内用内存 adapter 执行。
 *
 * 用法：node scripts/v365-p3-atomic-publish-gate.js
 */
'use strict';

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

const CODES = ['513310', '515880', '159582', '518880', '159570'];
const TD = '2026-09-23';
const SCOPE = 'production';

function mkManifest(o) {
  return {
    run_id: o.run_id, revision: o.revision, expected_trade_date: o.trade_date || TD,
    expected_codes: CODES, input_hash: `hash-${o.run_id}`, status: 'CALCULATING',
    created_at: o.created_at || '2026-09-23T22:00:00Z'
  };
}
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
async function publish(a, o) {
  const manifest = mkManifest({ run_id: o.run_id, revision: o.revision, trade_date: o.trade_date });
  return runPublishFlow({
    adapter: a, scope: SCOPE, manifest,
    decisions: o.decisions || mkDecisions(o.trade_date || TD),
    portfolio: o.portfolio === undefined ? mkPortfolio(o.trade_date || TD) : o.portfolio
  });
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
}

(async () => {
  console.log('== P-3 Atomic Publish PoC Gate ==\n');

  /* 1. COMPLETE_CAN_PROMOTE */
  {
    const a = createMemoryAdapter();
    const r = await publish(a, { run_id: 'r1', revision: 1 });
    const p = await a.getPointer(SCOPE);
    check('COMPLETE_CAN_PROMOTE', r.finality.status === RUN_STATUS.COMPLETE
      && r.exec.promoted === true && p && p.run_id === 'r1', `pointer=${p && p.run_id}`);
  }

  /* 2. PARTIAL_CANNOT_PROMOTE */
  {
    const a = createMemoryAdapter();
    await publish(a, { run_id: 'base', revision: 1 });
    const before = await a.getPointer(SCOPE);
    const r = await publish(a, { run_id: 'p', revision: 2, decisions: mkDecisions(TD, ['159570']) });
    const after = await a.getPointer(SCOPE);
    check('PARTIAL_CANNOT_PROMOTE', r.finality.status === RUN_STATUS.PARTIAL
      && r.exec.promoted === false && JSON.stringify(before) === JSON.stringify(after),
      `finality=${r.finality.status} promoted=${r.exec.promoted}`);
  }

  /* 3. FAILED_CANNOT_PROMOTE */
  {
    const a = createMemoryAdapter();
    await publish(a, { run_id: 'base', revision: 1 });
    const before = await a.getPointer(SCOPE);
    const r = await publish(a, { run_id: 'f', revision: 2, decisions: mkDecisions(TD, CODES) });
    const after = await a.getPointer(SCOPE);
    check('FAILED_CANNOT_PROMOTE', r.finality.status === RUN_STATUS.FAILED
      && r.exec.promoted === false && JSON.stringify(before) === JSON.stringify(after),
      `finality=${r.finality.status} promoted=${r.exec.promoted}`);
  }

  /* 4. MIXED_DATE_CANNOT_PROMOTE */
  {
    const a = createMemoryAdapter();
    await publish(a, { run_id: 'base', revision: 1 });
    const before = await a.getPointer(SCOPE);
    const r = await publish(a, {
      run_id: 'm', revision: 2, decisions: mkDecisions(TD, [], { '159570': '2026-09-22' })
    });
    const after = await a.getPointer(SCOPE);
    check('MIXED_DATE_CANNOT_PROMOTE', r.validation.passed === false
      && r.validation.reason === 'mixed_date_detected' && r.exec.promoted === false
      && JSON.stringify(before) === JSON.stringify(after),
      `validation=${r.validation.reason}`);
  }

  /* 5. CRASH_BEFORE_PROMOTION_SAFE */
  {
    const a = createMemoryAdapter();
    await publish(a, { run_id: 'base', revision: 1 });
    const before = await a.getPointer(SCOPE);
    a.injectFailure('compareAndSetPointer', SCOPE, 1);
    let crashed = false;
    try { await publish(a, { run_id: 'crash', revision: 2 }); } catch (e) { crashed = e.code === 'INJECTED_FAILURE'; }
    const after = await a.getPointer(SCOPE);
    const active = await readActive(a, SCOPE);
    check('CRASH_BEFORE_PROMOTION_SAFE', crashed
      && JSON.stringify(before) === JSON.stringify(after) && active.pointer.run_id === 'base',
      `crashed=${crashed} 旧 active=${active.pointer && active.pointer.run_id}`);
  }

  /* 6. RETRY_IDEMPOTENT */
  {
    const a = createMemoryAdapter();
    await publish(a, { run_id: 'idem', revision: 1 });
    const p1 = await a.getPointer(SCOPE);
    const retry = await publish(a, { run_id: 'idem', revision: 1 });
    const p2 = await a.getPointer(SCOPE);
    check('RETRY_IDEMPOTENT', retry.plan.action === POINTER_ACTION.ALREADY_ACTIVE
      && JSON.stringify(p1) === JSON.stringify(p2) && p2.revision === 1,
      `action=${retry.plan.action} revision=${p2.revision}`);
  }

  /* 7. STALE_RUN_CANNOT_OVERWRITE_NEWER */
  {
    const a = createMemoryAdapter();
    const staleSnapshot = await a.getPointer(SCOPE);            // null
    await publish(a, { run_id: 'newer', revision: 5, created_at: '2026-09-23T22:00:00Z' });
    // (a) revision 更小的较旧 run
    const rStale = await publish(a, { run_id: 'older', revision: 3, created_at: '2026-09-23T23:59:00Z' });
    // (b) 持过期快照做 CAS 的提升
    const manifest = mkManifest({ run_id: 'cas', revision: 9 });
    const decisions = mkDecisions(TD);
    const portfolio = mkPortfolio(TD);
    await a.putManifest(manifest);
    for (const d of decisions) await a.putCandidate(POC_COLLECTIONS.RUN_CANDIDATE_DECISION, 'cas', String(d.code), d);
    await a.putCandidate(POC_COLLECTIONS.RUN_CANDIDATE_PORTFOLIO, 'cas', 'portfolio', portfolio);
    const plan = planPointerPromotion({
      finality: classifyCandidateSet(manifest, decisions),
      validation: validateCandidateSet({ manifest, decisions, portfolio }),
      manifest, current_pointer: staleSnapshot
    });
    const exec = await executePointerPromotion({ adapter: a, scope: SCOPE, plan, expected_pointer: staleSnapshot });
    const finalP = await a.getPointer(SCOPE);
    check('STALE_RUN_CANNOT_OVERWRITE_NEWER',
      rStale.plan.action === POINTER_ACTION.HOLD
      && rStale.plan.reason.includes(HOLD_REASON.STALE_RUN)
      && exec.promoted === false && exec.reason === HOLD_REASON.CAS_REJECTED
      && finalP.run_id === 'newer',
      `stale=${rStale.plan.reason.slice(0, 40)} cas=${exec.reason} pointer=${finalP.run_id}`);
  }

  /* 8. OLD_ACTIVE_SURVIVES_FAILED_CANDIDATE */
  {
    const a = createMemoryAdapter();
    await publish(a, { run_id: 'good', revision: 1 });
    await publish(a, { run_id: 'bad', revision: 2, decisions: mkDecisions(TD, CODES) });
    const active = await readActive(a, SCOPE);
    check('OLD_ACTIVE_SURVIVES_FAILED_CANDIDATE',
      active.active === true && active.pointer.run_id === 'good'
      && active.decisions.length === CODES.length
      && active.decisions.every((d) => d.ok !== false),
      `active=${active.pointer && active.pointer.run_id} decisions=${active.decisions.length}`);
  }

  const bad = results.filter((r) => !r.ok);
  console.log('\n== 结论 ==');
  if (bad.length === 0) {
    console.log('  P3_ATOMIC_PUBLISH_POC = PASS');
    process.exit(0);
  }
  console.log(`  P3_ATOMIC_PUBLISH_POC = FAIL（${bad.map((b) => b.name).join('; ')}）`);
  process.exit(1);
})();
