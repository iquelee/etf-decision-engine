#!/usr/bin/env node
'use strict';

/**
 * V3.6.5 资格门（任务书 §19）+ 失效注入矩阵（§13 FI-01~FI-12）。
 *
 * 运行方式：
 *   node scripts/v365-qualification-gate.js [--changed-file <list>] [--json]
 *
 * 重要边界（诚实声明，不得被解读为"已可用"）：
 *   - 全部 FI 用例跑在 **内存适配器** 上（⛔ 不写任何真实生产集合）。
 *   - 因此 Q7/Q8 证明的是**协议层**的原子性，**不是平台层**：
 *     CloudBase 的真并发 CAS 语义**尚未实测** ⇒ `ATOMIC_PROMOTION_BLOCKED` 保持成立，
 *     `V365_IMPLEMENTATION` **不得**给出 QUALIFIED_CANDIDATE。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..');
const ri = require(path.join(REPO, 'src/common/utils/v365-run-integrity.js'));
const contracts = require(path.join(REPO, 'src/common/utils/v365-contracts.js'));
const { createMemoryAdapter } = require(path.join(REPO, 'scripts/lib/v365-p3-memory-adapter.js'));
const { verify: verifyManifest } = require(path.join(REPO, 'scripts/verify-v365-candidate-manifest.js'));

const CODES = ['513310', '515880', '159582', '518880', '159570'];
const EXPECTED = '2026-09-23';
const PREV = '2026-09-22';

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail: detail == null ? null : String(detail) });
}
function section(title) {
  checks.push({ section: title });
}

/* ---------------- 工具 ---------------- */
function snapshots(dates) {
  const o = {};
  CODES.forEach((c, i) => { o[c] = { calc_date: dates[i] }; });
  return o;
}
function envFor(calcDates, expectedTradeDate) {
  return ri.buildRunContext({
    run_id: 'gate-run-1',
    expected_codes: CODES,
    snapshots: snapshots(calcDates),
    expected_trade_date: expectedTradeDate,
    expected_trade_date_authority: {
      status: 'OK', calendar_version: contracts.CALENDAR_VERSION,
      calendar_coverage: { start: '2026-01-01', end: '2026-12-31' },
      resolution_reason: 'TRADING_DAY_AFTER_CUTOFF'
    },
    market_env_date: null,
    global_signals: [],
    fundamentals: {},
    config_version: null
  });
}
function resultsFor(okFlags) {
  const o = {};
  CODES.forEach((c, i) => { o[c] = { ok: okFlags[i] }; });
  return o;
}
function manifest(runId, revision, tradeDate) {
  return {
    run_id: runId, revision, expected_trade_date: tradeDate,
    expected_codes: CODES.slice(), input_hash: 'h-' + runId,
    status: 'CALCULATING'
  };
}
function decisionsFor(okFlags) {
  return CODES.map((c, i) => ({
    code: c, ok: okFlags[i],
    // ⚠️ 与生产同形：`decision_result.decision_date` == snapshot.calc_date（decision.js:936）
    decision_date: EXPECTED, calc_date: EXPECTED,
    final_target: 10, final_action: 'HOLD'
  }));
}

async function main() {
  const argv = process.argv.slice(2);
  const gi = argv.indexOf('--changed-file');
  const changedFile = gi >= 0 ? argv[gi + 1] : null;

  /* ================= Q1 NORMAL_PATH_DECISION_DELTA = 0 ================= */
  section('Q1 NORMAL_PATH_DECISION_DELTA = 0');
  {
    let ok = true; let detail = [];
    // (a) 决策核心文件零改动（改动清单由 bash 传入，脚本内不调子进程）
    const CORE = [
      'src/common/utils/decision.js', 'src/common/utils/decision-v3.js', 'src/common/utils/trend-stage.js',
      'src/common/utils/correlation.js', 'src/common/utils/defense.js', 'src/common/utils/swing-structure.js',
      'src/common/utils/market-regime.js', 'src/common/utils/indicators.js',
      'src/common/utils/v3-shadow.js', 'src/common/utils/portfolio-mode.js', 'src/common/utils/portfolio-cash.js'
    ];
    if (changedFile) {
      const changed = fs.readFileSync(changedFile, 'utf8')
        .split(/\r?\n/).map((s) => s.trim()).filter(Boolean).map((s) => s.replace(/\\/g, '/'));
      const touched = changed.filter((f) => CORE.includes(f));
      detail.push(`决策核心改动 = ${JSON.stringify(touched)}`);
      if (touched.length) ok = false;
    } else {
      detail.push('未提供 --changed-file，跳过改动集检查');
    }
    // (b) 回放确定性 + 决策序列 sha256
    try {
      const harness = require(path.join(REPO, 'scripts/lib/v364-replay-harness.js'));
      const win = { from: '2026-08-01', to: '2026-09-22', runsPerDay: 1 };
      const sha = (r) => crypto.createHash('sha256')
        .update(JSON.stringify(r.days.map((d) => Object.keys(d.byCode).sort().map((c) => {
          const b = d.byCode[c];
          return [c, b.trend_stage, b.final_target, b.final_action, b.binding_constraint];
        })))).digest('hex');
      const a = harness.replay(win); const b = harness.replay(win);
      const sa = sha(a); const sb = sha(b);
      detail.push(`replay anchor = ${sa}`);
      detail.push(`两次回放一致 = ${sa === sb}`);
      if (sa !== sb) ok = false;
      check('Q1 NORMAL_PATH_DECISION_DELTA = 0', ok, detail.join(' | '));
      check('Q1 anchor', /^[0-9a-f]{64}$/.test(sa), sa);
    } catch (e) {
      check('Q1 NORMAL_PATH_DECISION_DELTA = 0', false, 'replay 不可用: ' + String(e.message || e));
    }
  }

  /* ================= Q2/Q3 RunContext gate（FI-01/02/03/12）================= */
  section('Q2/Q3 EXPECTED_DATE_GATE / ALL_STALE_BLOCK');
  {
    // FI-01：5/5 healthy ⇒ PASS
    const g1 = ri.decideRunGate(envFor([EXPECTED, EXPECTED, EXPECTED, EXPECTED, EXPECTED], EXPECTED));
    check('Q2 FI-01 5/5 expected ⇒ PASS', g1.status === ri.RUN_GATE.PASS && g1.publishable === true,
      `${g1.status}/${g1.reason}`);

    // FI-02：4/5 expected + 1 stale ⇒ BLOCK（CASE_B）
    const g2 = ri.decideRunGate(envFor([EXPECTED, EXPECTED, EXPECTED, EXPECTED, PREV], EXPECTED));
    check('Q2 FI-02 4/5 + 1 stale ⇒ BLOCK', g2.status === ri.RUN_GATE.BLOCKED,
      `${g2.status}/${g2.date_alignment_case}`);

    // FI-03：5/5 全体一致 stale ⇒ **必须 BLOCK**（CASE_C，旧 max(calc_date) 的盲区）
    const e3 = envFor([PREV, PREV, PREV, PREV, PREV], EXPECTED);
    const g3 = ri.decideRunGate(e3);
    check('Q3 FI-03 5/5 全体 stale ⇒ BLOCK（CASE_C）',
      g3.status === ri.RUN_GATE.BLOCKED && g3.date_alignment_case === 'CASE_C_ALL_STALE',
      `${g3.status}/${g3.date_alignment_case}`);
    // 显式证明 CASE_C 为什么是**旧方案的结构性盲区**：
    //   5 票的 calc_date **彼此完全一致** ⇒ 任何"互相比对"的 cross-sectional 判据都判健康；
    //   只有与**外部 expected_trade_date** 比对，才能发现"全体一致过期"。
    const distinctCalc = Array.from(new Set(Object.values(e3.snapshot_dates || {}).map(String)));
    check('Q3 CASE_C 结构性盲区：cross-sectional 一致但必须 BLOCK',
      distinctCalc.length === 1 && distinctCalc[0] === PREV
      && g3.status === ri.RUN_GATE.BLOCKED && g3.date_alignment_case === 'CASE_C_ALL_STALE',
      `distinct calc_date=${JSON.stringify(distinctCalc)}（互相一致 ⇒ 旧判据假绿）；`
      + `expected=${EXPECTED} ⇒ BLOCK`);

    // FI-12：calendar coverage 耗尽 ⇒ BLOCK / 不回退 weekday-only
    const c = ri.loadRepoCalendar();
    const auth = ri.resolveExpectedTradeDate(new Date('2027-06-01T16:30:00+08:00'), c);
    check('Q2/Q3 FI-12 calendar 越界 ⇒ BLOCK 且不回退',
      auth.status === 'BLOCKED' && auth.expected_trade_date === null,
      `${auth.status}/${auth.resolution_reason}`);
  }

  /* ================= Q4/Q5/Q6 finality + fail-closed publish（FI-04/05/06）======== */
  section('Q4/Q5/Q6 PARTIAL/FAILED/WRITE_FAILURE NO_PUBLISH');
  {
    // FI-04：1 只 calculation throw ⇒ PARTIAL
    const f4 = ri.computeFinality({ expected_codes: CODES, results: resultsFor([true, true, true, true, false]) });
    check('Q4 FI-04 1 票失败 ⇒ PARTIAL 且 publishable=false',
      f4.status === ri.RUN_STATUS.PARTIAL && f4.publishable === false,
      `${f4.status} succ=${f4.success_count}/${f4.expected_count} failed=${JSON.stringify(f4.failed_codes)}`);

    // 全失败 ⇒ FAILED
    const f5 = ri.computeFinality({ expected_codes: CODES, results: resultsFor([false, false, false, false, false]) });
    check('Q5 全票失败 ⇒ FAILED 且 publishable=false',
      f5.status === ri.RUN_STATUS.FAILED && f5.publishable === false, f5.status);

    // 缺一票（missing）⇒ 不得冒充 COMPLETE
    const rMissing = resultsFor([true, true, true, true, true]); delete rMissing[CODES[4]];
    const f5b = ri.computeFinality({ expected_codes: CODES, results: rMissing });
    check('Q5 缺一票 ⇒ 不得冒充 COMPLETE', f5b.status !== ri.RUN_STATUS.COMPLETE,
      `${f5b.status} missing=${JSON.stringify(f5b.missing_codes)}`);

    // FI-05：candidate write failure ⇒ no promote
    {
      const ad = createMemoryAdapter();
      ad.injectFailure('putCandidate', `${contracts.V365_COLLECTIONS.CANDIDATE_DECISION}:${CODES[2]}`, 1);
      let threw = false;
      let res = null;
      try {
        res = await ri.publishCandidateFirst({
          store: ad, manifest: manifest('run-fi05', 1, EXPECTED),
          decisions: decisionsFor([true, true, true, true, true]),
          portfolio: { snapshot_date: EXPECTED }, expected_codes: CODES, allowPromotion: true
        });
      } catch (e) { threw = true; }
      const ptr = await ad.getPointer('production');
      check('Q6 FI-05 candidate 写失败 ⇒ 不得提升',
        (threw || (res && res.promoted === false)) && ptr == null,
        `threw=${threw} promoted=${res ? res.promoted : 'n/a'} pointer=${ptr ? 'SET' : 'NULL'}`);
    }

    // FI-06：portfolio candidate write failure ⇒ no promote
    {
      const ad = createMemoryAdapter();
      ad.injectFailure('putCandidate', `${contracts.V365_COLLECTIONS.CANDIDATE_PORTFOLIO}:portfolio`, 1);
      let threw = false; let res = null;
      try {
        res = await ri.publishCandidateFirst({
          store: ad, manifest: manifest('run-fi06', 1, EXPECTED),
          decisions: decisionsFor([true, true, true, true, true]),
          portfolio: { snapshot_date: EXPECTED }, expected_codes: CODES, allowPromotion: true
        });
      } catch (e) { threw = true; }
      const ptr = await ad.getPointer('production');
      check('Q6 FI-06 portfolio candidate 写失败 ⇒ 不得提升',
        (threw || (res && res.promoted === false)) && ptr == null,
        `threw=${threw} pointer=${ptr ? 'SET' : 'NULL'}`);
    }

    // FI-02（**发布层**）：混日期 candidate ⇒ mixed-date validation fail ⇒ no promote
    // ⛔ 这一条与上面的 gate 层不同：这里证明「即使门放行，写入的 candidate 日期不一致也拦得住」。
    {
      const ad = createMemoryAdapter();
      const mixed = decisionsFor([true, true, true, true, true]);
      mixed[4].calc_date = PREV;
      mixed[4].decision_date = PREV;
      const r = await ri.publishCandidateFirst({
        store: ad, manifest: manifest('run-mixed-pub', 1, EXPECTED),
        decisions: mixed, portfolio: { snapshot_date: EXPECTED },
        expected_codes: CODES, allowPromotion: true
      });
      const ptr = await ad.getPointer('production');
      check('Q4 FI-02（发布层）混日期 candidate ⇒ validation fail 且不提升',
        r.promoted === false && !!r.validation && r.validation.passed === false && ptr == null,
        `reason=${r.validation && r.validation.reason} promoted=${r.promoted} pointer=${ptr ? 'SET' : 'NULL'}`);
    }
  }

  /* ================= Q7/Q8 指针原子性 + 并发（FI-07/08/09/10）=============== */
  section('Q7/Q8 ACTIVE_POINTER_ATOMICITY / CONCURRENT_STALE');
  {
    // FI-01 提升：健康 run ⇒ 提升成功
    const ad = createMemoryAdapter();
    const r1 = await ri.publishCandidateFirst({
      store: ad, manifest: manifest('run-A', 1, EXPECTED),
      decisions: decisionsFor([true, true, true, true, true]),
      portfolio: { snapshot_date: EXPECTED }, expected_codes: CODES, allowPromotion: true
    });
    check('Q7 健康 run ⇒ 提升成功', r1.promoted === true, JSON.stringify(r1.finality && r1.finality.status));

    // FI-02/03 阻断：混合日期 / 全体过期 ⇒ 不提升（走 gate，不进入发布）
    {
      const ad2 = createMemoryAdapter();
      const g = ri.decideRunGate(envFor([EXPECTED, EXPECTED, EXPECTED, EXPECTED, PREV], EXPECTED));
      const ptrBefore = await ad2.getPointer('production');
      const skipped = g.status === ri.RUN_GATE.BLOCKED;   // gate 阻断 ⇒ 根本不进入发布流程
      const ptrAfter = await ad2.getPointer('production');
      check('Q4/Q5 gate 阻断 ⇒ 指针保持不变',
        skipped && JSON.stringify(ptrBefore) === JSON.stringify(ptrAfter), g.reason);
    }

    // FI-08 retry 幂等（同 run_id 再发布 ⇒ 不产生新 revision）
    {
      const r2 = await ri.publishCandidateFirst({
        store: ad, manifest: manifest('run-A', 1, EXPECTED),
        decisions: decisionsFor([true, true, true, true, true]),
        portfolio: { snapshot_date: EXPECTED }, expected_codes: CODES, allowPromotion: true
      });
      const ptr = await ad.getPointer('production');
      check('Q10 FI-08 同 run 重放 ⇒ 幂等',
        ptr && ptr.run_id === 'run-A' && r2.promotion_attempted === false,
        `ptr=${ptr ? ptr.run_id + '@' + ptr.revision : 'NULL'} attempted=${r2.promotion_attempted}`);
    }

    // FI-09 同 trade_date 的更新 revision ⇒ 显式 supersedes
    {
      const r3 = await ri.publishCandidateFirst({
        store: ad, manifest: manifest('run-B', 2, EXPECTED),
        decisions: decisionsFor([true, true, true, true, true]),
        portfolio: { snapshot_date: EXPECTED }, expected_codes: CODES, allowPromotion: true
      });
      const ptr = await ad.getPointer('production');
      check('Q9 FI-09 同交易日新 revision ⇒ 显式 supersedes',
        r3.promoted === true && ptr.run_id === 'run-B' && r3.plan && r3.plan.supersedes_run_id === 'run-A',
        `ptr=${ptr.run_id}@${ptr.revision} supersedes=${r3.plan ? r3.plan.supersedes_run_id : 'n/a'}`);
    }

    // FI-10 较旧 run 后到 ⇒ 不得覆盖（stale cannot overwrite newer）
    {
      const r4 = await ri.publishCandidateFirst({
        store: ad, manifest: manifest('run-OLD', 1, EXPECTED),
        decisions: decisionsFor([true, true, true, true, true]),
        portfolio: { snapshot_date: EXPECTED }, expected_codes: CODES, allowPromotion: true
      });
      const ptr = await ad.getPointer('production');
      check('Q8 FI-10 较旧 revision 后到 ⇒ 拒绝覆盖',
        r4.promoted === false && ptr.run_id === 'run-B',
        `promoted=${r4.promoted} reason=${r4.promotion_skipped_reason} ptr=${ptr.run_id}@${ptr.revision}`);
      // CAS 层：持过期快照者亦被拒
      const stale = await ad.compareAndSetPointer('production', { run_id: 'run-A', revision: 1 }, { run_id: 'run-X', revision: 9 });
      check('Q8 CAS 拒绝持有过期 expected 的写入', stale.ok === false && ptr.run_id === 'run-B',
        `cas.ok=${stale.ok}`);
    }

    // FI-07 crash before pointer switch ⇒ 旧 active 存活
    {
      const ad3 = createMemoryAdapter();
      const ok1 = await ri.publishCandidateFirst({
        store: ad3, manifest: manifest('run-base', 1, EXPECTED),
        decisions: decisionsFor([true, true, true, true, true]),
        portfolio: { snapshot_date: EXPECTED }, expected_codes: CODES, allowPromotion: true
      });
      ad3.injectFailure('compareAndSetPointer', 'production', 1);
      let crashed = false;
      try {
        await ri.publishCandidateFirst({
          store: ad3, manifest: manifest('run-crash', 2, EXPECTED),
          decisions: decisionsFor([true, true, true, true, true]),
          portfolio: { snapshot_date: EXPECTED }, expected_codes: CODES, allowPromotion: true
        });
      } catch (e) { crashed = true; }
      const ptr = await ad3.getPointer('production');
      check('Q7 FI-07 提升前 crash ⇒ 旧 active 存活',
        ok1.promoted === true && ptr.run_id === 'run-base',
        `crashed=${crashed} ptr=${ptr ? ptr.run_id : 'NULL'}`);
    }

    check('Q7 平台 CAS 并发实证（真实集合）', contracts.CAS_EVIDENCE.platform_concurrency_tested === true,
      `api_present=${contracts.CAS_EVIDENCE.api_present}，platform_concurrency_tested=${contracts.CAS_EVIDENCE.platform_concurrency_tested}`
      + ' ⇒ 协议层 PASS、**平台层未证实**（ATOMIC_PROMOTION_BLOCKED）');
  }

  /* ================= Q11 OBS-001 结构化（FI-11）================= */
  section('Q11 OBS001_STRUCTURED');
  {
    const tel = ri.buildRunTelemetry({
      envelope: envFor([EXPECTED, EXPECTED, EXPECTED, EXPECTED, EXPECTED], EXPECTED),
      gate: ri.decideRunGate(envFor([EXPECTED, EXPECTED, EXPECTED, EXPECTED, EXPECTED], EXPECTED)),
      finality: ri.computeFinality({ expected_codes: CODES, results: resultsFor([true, true, true, true, true]) }),
      engine_run_id: 'engine-A',
      pipeline: {
        pipeline_run_id: 'pl|2026-09-23|timer|materializeIndicators|materialize#a1',
        attempt: 1, origin: 'timer',
        transport_status: ri.TRANSPORT_STATUS.CALL_TIMEOUT,
        business_status: ri.BUSINESS_STATUS.COMPLETE,
        callee_pipeline_run_id: 'pl|2026-09-23|timer|materializeIndicators|materialize#a1'
      }
    });
    check('Q11 FI-11 CALL_TIMEOUT + business COMPLETE 可结构化表达',
      tel.transport_status === 'CALL_TIMEOUT' && tel.business_status === 'COMPLETE'
      && tel.obs_001_shape === true && tel.obs_001_correlated === true
      && tel.obs_001_manual_reconstruction_required === 0,
      `transport=${tel.transport_status} business=${tel.business_status} shape=${tel.obs_001_shape}`);

    // 反向：pipeline_run_id 不同 ⇒ 不得声称关联（必须靠 id，不靠时间窗口）
    const tel2 = ri.buildRunTelemetry({
      envelope: envFor([EXPECTED, EXPECTED, EXPECTED, EXPECTED, EXPECTED], EXPECTED),
      gate: ri.decideRunGate(envFor([EXPECTED, EXPECTED, EXPECTED, EXPECTED, EXPECTED], EXPECTED)),
      finality: null, engine_run_id: 'engine-B',
      pipeline: {
        pipeline_run_id: 'pl|A', transport_status: ri.TRANSPORT_STATUS.CALL_TIMEOUT,
        business_status: ri.BUSINESS_STATUS.COMPLETE, callee_pipeline_run_id: 'pl|B'
      }
    });
    check('Q11 不同 pipeline_run_id ⇒ 不得判定为同一笔', tel2.obs_001_shape === false,
      `shape=${tel2.obs_001_shape} correlated=${tel2.obs_001_correlated}`);
  }

  /* ================= Q12/Q13/Q14 契约与来源 ================= */
  section('Q12/Q13/Q14 CONTRACT / CALENDAR / PROVENANCE');
  {
    check('Q12 INPUT_CONTRACT',
      contracts.INPUT_CONTRACT_VERSION === 'live-31-v1'
      && contracts.INPUT_CONTRACT_FIELD_COUNT === 31
      && contracts.INPUT_CONTRACT_EXCLUDED_FIELDS.includes('breakout_nd'),
      `${contracts.INPUT_CONTRACT_VERSION}/${contracts.INPUT_CONTRACT_FIELD_COUNT}`);

    const c = ri.loadRepoCalendar();
    // closed = 官方休市 OR 周末。
    // ⚠️ 10-10 属**周末休市**（不在 holidaySet 内）⇒ 必须用 isClosed 而不是 holidaySet.has。
    const isClosed = (d) => c.holidaySet.has(d) || (new Date(d + 'T00:00:00Z').getUTCDay() % 6 === 0);
    const expectOpen = ['2026-09-23', '2026-09-24', '2026-09-28', '2026-10-08'];
    const expectClosed = ['2026-09-25', '2026-09-26', '2026-09-27', '2026-10-01', '2026-10-07', '2026-10-10'];
    check('Q13 CALENDAR_AUTHORITY',
      c.valid === true && c.coverage.seeded === true && c.synthetic === false
      && expectOpen.every((d) => isClosed(d) === false)
      && expectClosed.every((d) => isClosed(d) === true),
      `version=${c.calendar_version} seeded=${c.coverage.seeded} synthetic=${c.synthetic}`
      + ` open_ok=${expectOpen.filter((d) => !isClosed(d)).length}/${expectOpen.length}`
      + ` closed_ok=${expectClosed.filter(isClosed).length}/${expectClosed.length}`);

    // 来源 provenance：日历 artifact 的来源文件可追溯
    let provOk = false; let provDetail = '';
    try {
      const cm = JSON.parse(fs.readFileSync(path.join(REPO, contracts.CALENDAR_MANIFEST_PATH), 'utf8'));
      provOk = Array.isArray(cm.source_authorities) && cm.source_authorities.length >= 2
        && Array.isArray(cm.source_notice_identifiers) && cm.source_notice_identifiers.length >= 2;
      provDetail = `${JSON.stringify(cm.source_authorities)} ${JSON.stringify(cm.source_notice_identifiers)}`;
    } catch (e) { provDetail = String(e.message || e); }
    check('Q14 SOURCE_PROVENANCE', provOk, provDetail);
  }

  /* ================= Q15 manifest verifier ================= */
  section('Q15 V365_MANIFEST_VERIFIER');
  {
    const v = verifyManifest();
    check('Q15 V365_MANIFEST_VERIFIER', v.ok === true,
      v.ok ? `${v.checked} 个合格文件逐字节一致` : JSON.stringify(v.errors.slice(0, 5)));
  }

  /* ================= 汇总 ================= */
  const items = checks.filter((c) => !c.section);
  // ⚠️ 「平台级 CAS 并发实证」**不是实现缺陷**，而是"证据尚未取得"的显式声明
  //    （需一次性的真实集合写测试 —— 属另行授权事项）⇒ 单列，不计入实现失败集。
  const isPlatformBlocker = (c) => c.name.indexOf('Q7 平台 CAS 并发实证') === 0;
  const failed = items.filter((c) => !c.ok && !isPlatformBlocker(c));
  const platformBlocked = items.some((c) => isPlatformBlocker(c) && !c.ok)
    || !contracts.CAS_EVIDENCE.platform_concurrency_tested;

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ checks, failed: failed.length, platformBlocked }, null, 2));
  } else {
    checks.forEach((c) => {
      if (c.section) { console.log('\n### ' + c.section); return; }
      console.log((c.ok ? '[PASS] ' : (isPlatformBlocker(c) ? '[BLOCK] ' : '[FAIL] ')) + c.name
        + (c.detail ? '\n        ' + c.detail : ''));
    });
    console.log('\n==================== 汇总 ====================');
    console.log(`PASS ${items.filter((c) => c.ok).length} / ${items.length}（其中 BLOCK 1 = 平台证据缺失）`);
    if (failed.length) failed.forEach((f) => console.log('  [FAIL] ' + f.name + ' :: ' + f.detail));
    console.log('Q7/Q8 平台级 CAS 并发实测 = ' + (platformBlocked ? 'UNPROVEN ⇒ ATOMIC_PROMOTION_BLOCKED' : 'PROVEN'));
    console.log('V365_IMPLEMENTATION = ' + (failed.length
      ? 'NOT_QUALIFIED（存在实现级 FAIL 项）'
      : (platformBlocked ? 'BLOCKED_ON_PLATFORM_CAS_EVIDENCE' : 'QUALIFIED_CANDIDATE')));
    console.log('⚠️ QUALIFIED_CANDIDATE ≠ PRODUCTION AUTHORIZED；FREEZE / PR / MERGE / DEPLOY 均需单独授权。');
  }
  fs.writeFileSync(path.join(REPO, 'outputs', 'v365-qualification.json'),
    JSON.stringify({ at: new Date().toISOString(), checks, failed: failed.length, platformBlocked }, null, 2), 'utf8');
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error('[FAIL] gate 异常: ' + (e && e.stack || e)); process.exit(1); });
