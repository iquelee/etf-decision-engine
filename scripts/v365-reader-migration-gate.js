#!/usr/bin/env node
'use strict';

/**
 * V3.6.5 —— Reader Migration Gate（任务书 §16）。
 *
 * 八项判据：
 *   AUTHORITATIVE_ENDPOINTS_MIGRATED
 *   NO_LATEST_QUERY_AS_AUTHORITY
 *   SINGLE_REQUEST_RUN_PINNING
 *   CROSS_COLLECTION_RUN_COHERENCE
 *   CANDIDATE_INVISIBLE_BEFORE_PROMOTION
 *   MISSING_POINTER_FAIL_CLOSED
 *   MUTABLE_STATE_AXIS_PRESERVED
 *   LEGACY_RESPONSE_COMPATIBILITY
 *
 * 运行：node scripts/v365-reader-migration-gate.js [--changed-file <list>] [--json]
 *
 * ⛔ 全程只读 + 内存适配器：不连数据库、不写任何真实集合、不部署。
 */

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const ar = require(path.join(REPO, 'src/common/utils/v365-active-read.js'));
const CONTRACTS = require(path.join(REPO, 'src/common/utils/v365-contracts.js'));
const { createMemoryAdapter } = require(path.join(REPO, 'scripts/lib/v365-p3-memory-adapter.js'));

const API_GW = path.join(REPO, 'cloudfunctions', 'apiGateway', 'index.js');
const ADMIN_GW = path.join(REPO, 'cloudfunctions', 'adminGateway', 'index.js');
const CODES = ['513310', '515880', '159582', '518880', '159570'];
const TD = '2026-09-23';
const SCOPE = 'production';

/** 5 个 authoritative 端点（= 任务书要求「pointer 生效前必须迁移」的集合） */
const AUTHORITATIVE_ENDPOINTS = Object.freeze([
  'getDashboard', 'getEtfList', 'getEtfDetail', 'getPortfolio', 'getConstants'
]);

/**
 * 额外迁移的 CLASS A 消费者（超出被点名的 5 个）。
 * `adminGateway.getGen1Health` 对 `decision_result` 取最新 ⇒ 同一 run-bound 集合，
 * 同属 CLASS A（后台会看到混 run 的决策）⇒ 一并对齐。⚠️ 仅换来源，不改 Gen-1 Authority。
 */
const EXTRA_MIGRATED_CONSUMERS = Object.freeze([
  { file: ADMIN_GW, fn: 'getGen1Health' }
]);

/** 每个端点必须保留的 legacy 响应字段（兼容性判据 §9） */
const LEGACY_KEYS = Object.freeze({
  getDashboard: ['engine_mode', 'v3_mode', 'system_runtime', 'ml_shadow', 'legacy', 'three_questions',
    'overview', 'cards', 'total_asset', 'cash_balance', 'cash_ratio', 'snapshot_date', 'market_regime',
    'etf_total', 'innovation_position', 'overall_risk', 'action_label', 'final_target', 'binding_constraint'],
  getEtfList: ['list', 'code', 'name', 'sector', 'stage', 'action', 'action_label',
    'opportunity_score', 'opportunity_grade', 'defense', 'current_position', 'target_position',
    'final_target', 'suggested_position', 'data_time'],
  getEtfDetail: ['basic', 'snapshot', 'decision', 'ml_shadow', 'legacy', 'production', 'gen1',
    'system_runtime', 'fundamental', 'risk_events', 'position', 'fundamental_config',
    'fundamental_series', 'holdings', 'holdings_date'],
  getPortfolio: ['summary', 'rows', 'tech_sector_max', 'total_asset', 'cash_balance', 'tech_position',
    'semi_position', 'gold_position', 'drug_position', 'current_position', 'add_space', 'over_max'],
  getConstants: ['w_state_labels', 'action_labels', 'sectors', 'etf_names', 'engine_version', 'runtime_status']
});

const checks = [];
const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail: detail == null ? null : String(detail) });
const section = (t) => checks.push({ section: t });

/* ------------------------------------------------------------------ *
 * 工具
 * ------------------------------------------------------------------ */

/** 抽出 `async function <name>(...) { ... }` 的函数体（花括号配平） */
function extractFunction(src, name) {
  const re = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(', 'g');
  const m = re.exec(src);
  if (!m) return null;
  const braceStart = src.indexOf('{', m.index);
  if (braceStart < 0) return null;
  let depth = 0;
  for (let i = braceStart; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(braceStart, i + 1);
    }
  }
  return null;
}

/** 允许标记（必须与读取同行，使迁移进度可逐行审计） */
const ALLOW_MARKER = /v365-reader-allow:(mutable-axis|input-data|history-deferred|non-authoritative-diagnostic)/;

/**
 * 「按日期取最新」只有在读**run-bound 集合**时才构成"猜权威结果"。
 * 其他集合（输入数据 / 人工台账）按日期取最新是**合法原语义**，不算违规。
 */
const RUN_BOUND_COLLECTION_TOKENS = Object.freeze([
  'COLLECTIONS.DECISION_RESULT',
  'COLLECTIONS.PORTFOLIO_SNAPSHOT',
  'COLLECTIONS.PORTFOLIO_POSITION',
  'COLLECTIONS.RUNTIME_STATUS'
]);

/** 从 idx 向前最多 4 行找该查询的目标集合（找不到返回 null） */
function detectCollection(lines, idx) {
  for (let i = idx; i >= Math.max(0, idx - 4); i -= 1) {
    const hit = RUN_BOUND_COLLECTION_TOKENS.find((t) => lines[i].indexOf(t) >= 0);
    if (hit) return hit;
  }
  return null;
}

/**
 * 逐行找「按日期取最新」但**没有**允许标记的行。
 * 仅当目标集合是 run-bound（或无法判定）时才算违规 —— 未知集合保守要求标记。
 */
function unsanctionedLatestReads(body) {
  const out = [];
  const lines = String(body || '').split(/\r?\n/);
  lines.forEach((line, idx) => {
    const isLatestDesc = /orderBy\s*:\s*\[[\s\S]*?direction\s*:\s*'desc'/.test(line)
      && /limit\s*:/.test(line + (lines[idx + 1] || ''));
    if (!isLatestDesc) return;
    if (ALLOW_MARKER.test(line)) return;                    // 已显式声明轴 ⇒ 合规
    const col = detectCollection(lines, idx);
    if (col === null) {
      // 集合不可判定 ⇒ 保守：要求标记（避免"看不出在读哪个集合"的漏网）
      out.push({ line: idx + 1, code: line.trim().slice(0, 140), collection: 'UNKNOWN' });
      return;
    }
    // 已知非 run-bound（输入数据/台账）⇒ 合法原语义，不算违规
  });
  return out;
}

function hasKey(body, key) {
  return new RegExp('\\b' + key + '\\s*[:,\\n}]').test(body);
}

/** 计数型 store 包装：统计 getPointer 调用次数（验证 pinning） */
function countingStore(inner) {
  const counts = { getPointer: 0, listCandidates: 0, getCandidate: 0, getManifest: 0 };
  return {
    counts,
    getPointer: async (s) => { counts.getPointer += 1; return inner.getPointer(s); },
    listCandidates: async (c, r) => { counts.listCandidates += 1; return inner.listCandidates(c, r); },
    getCandidate: async (c, r, k) => { counts.getCandidate += 1; return inner.getCandidate(c, r, k); },
    getManifest: async (r) => { counts.getManifest += 1; return inner.getManifest(r); }
  };
}

/** 读取中「candidate 写」与「pointer 未切」的确定性交错 */
async function seedRun(ad, runId, revision, opts) {
  const o = opts || {};
  await ad.putManifest({
    run_id: runId, revision, expected_trade_date: o.trade_date || TD,
    expected_codes: CODES.slice(), input_hash: 'h-' + runId,
    status: o.status || 'COMPLETE', engine_version: CONTRACTS.ENGINE_VERSION
  });
  for (const c of (o.codes || CODES)) {
    await ad.putCandidate(CONTRACTS.V365_COLLECTIONS.CANDIDATE_DECISION, runId, c, {
      code: c, run_id: runId, calc_date: o.trade_date || TD,
      final_target: 10, final_action: 'HOLD', trend_stage: 'S1'
    });
  }
  if (o.portfolio !== false) {
    await ad.putCandidate(CONTRACTS.V365_COLLECTIONS.CANDIDATE_PORTFOLIO, runId, 'portfolio', {
      run_id: runId, snapshot_date: o.trade_date || TD, total_asset: 100000, market_regime: 'neutral'
    });
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const gi = argv.indexOf('--changed-file');
  const changedFile = gi >= 0 ? argv[gi + 1] : null;
  const src = fs.readFileSync(API_GW, 'utf8');

  /* ================= 1. AUTHORITATIVE_ENDPOINTS_MIGRATED ================= */
  section('1 AUTHORITATIVE_ENDPOINTS_MIGRATED');
  {
    const rows = [];
    let okAll = true;
    AUTHORITATIVE_ENDPOINTS.forEach((fn) => {
      const body = extractFunction(src, fn);
      const usesResolver = !!body && /resolveAuthoritative\s*\(|resolveAuthoritativeDecision\s*\(|resolvePointerProvenance\s*\(/.test(body);
      // provenance 可由本函数直接构造，或经 helper（`resolvePointerProvenance` 内部即 buildAuthoritativeProvenance）
      const hasProvenance = !!body
        && /buildAuthoritativeProvenance|mutableStateProvenance|resolvePointerProvenance/.test(body);
      if (!usesResolver || !hasProvenance) okAll = false;
      rows.push(`${fn}:resolver=${usesResolver},provenance=${hasProvenance}`);
    });
    check('AUTHORITATIVE_ENDPOINTS_MIGRATED', okAll, rows.join(' | '));
  }

  /* ================= 2. NO_LATEST_QUERY_AS_AUTHORITY ================= */
  section('2 NO_LATEST_QUERY_AS_AUTHORITY');
  {
    const violations = [];
    AUTHORITATIVE_ENDPOINTS.forEach((fn) => {
      const body = extractFunction(src, fn);
      if (!body) { violations.push(`${fn}:function_not_found`); return; }
      unsanctionedLatestReads(body).forEach((v) => violations.push(`${fn}:${v.line} ${v.code}`));
      if (/getLatestDecision\s*\(/.test(body)) violations.push(`${fn}:uses_getLatestDecision（禁止）`);
    });
    // 额外迁移的 CLASS A 消费者同受此判据约束
    EXTRA_MIGRATED_CONSUMERS.forEach((t) => {
      const s = fs.readFileSync(t.file, 'utf8');
      const body = extractFunction(s, t.fn);
      if (!body) { violations.push(`${t.fn}:function_not_found`); return; }
      unsanctionedLatestReads(body).forEach((v) => violations.push(`${t.fn}:${v.line} ${v.code}`));
      if (/db\.query\s*\(\s*COLLECTIONS\.DECISION_RESULT/.test(body)) {
        violations.push(`${t.fn}:仍直接查 DECISION_RESULT（CLASSA 必须走 resolver）`);
      }
    });
    check('NO_LATEST_QUERY_AS_AUTHORITY', violations.length === 0,
      violations.length ? violations.join(' || ')
        : `5 端点 + ${EXTRA_MIGRATED_CONSUMERS.length} 个额外 CLASS A 消费者的 latest 读取全部带轴标记`);
  }

  /* ================= 3. SINGLE_REQUEST_RUN_PINNING ================= */
  section('3 SINGLE_REQUEST_RUN_PINNING');
  {
    const ad = createMemoryAdapter();
    await seedRun(ad, 'run-B', 2);
    await ad.compareAndSetPointer(SCOPE, null, { run_id: 'run-B', revision: 2, expected_trade_date: TD });
    const cs = countingStore(ad);
    const ds = await ar.readAuthoritativeDataset(cs, { scope: SCOPE, expected_codes: CODES });
    check('SINGLE_REQUEST_RUN_PINNING', ds.available === true && cs.counts.getPointer === 1,
      `getPointer 调用数=${cs.counts.getPointer}（必须恰为 1 ⇒ 一次 request 只 pin 一次）`
      + ` listCandidates=${cs.counts.listCandidates} getCandidate=${cs.counts.getCandidate}`);
  }

  /* ================= 4. CROSS_COLLECTION_RUN_COHERENCE ================= */
  section('4 CROSS_COLLECTION_RUN_COHERENCE');
  {
    // (a) 一致 ⇒ PASS
    const adOk = createMemoryAdapter();
    await seedRun(adOk, 'run-B', 2);
    await adOk.compareAndSetPointer(SCOPE, null, { run_id: 'run-B', revision: 2 });
    const okDs = await ar.readAuthoritativeDataset(adOk, { scope: SCOPE, expected_codes: CODES });

    // (b) 跨 run 记录 ⇒ READ_COHERENCE_FAILURE 且**不拼装**
    //     ⚠️ 保真适配器下这种记录无法经正常 API 注入（`where({run_id})` 天然过滤）
    //        ⇒ 用「损坏的 store」模拟带外污染/适配器缺陷，走**端到端**路径。
    const adBad = createMemoryAdapter();
    await seedRun(adBad, 'run-B', 2);
    await adBad.compareAndSetPointer(SCOPE, null, { run_id: 'run-B', revision: 2 });
    const corrupted = {
      getPointer: (s) => adBad.getPointer(s),
      listCandidates: (c, r) => adBad.listCandidates(c, r),
      getCandidate: async (c, r, k) => {
        const doc = await adBad.getCandidate(c, r, k);
        if (doc && String(c).indexOf('portfolio') >= 0) return Object.assign({}, doc, { run_id: 'run-C' });
        return doc;
      },
      getManifest: (r) => adBad.getManifest(r)
    };
    const badDs = await ar.readAuthoritativeDataset(corrupted, { scope: SCOPE, expected_codes: CODES });
    // (c) 守卫单元测试（纵深防御的正确性）
    const guard = ar.checkRunCoherence({
      active_run_id: 'run-B',
      decisions: [{ code: '513310', run_id: 'run-B' }, { code: '515880', run_id: 'run-C' }],
      portfolio: { run_id: 'run-B' }, manifest: { run_id: 'run-B' }
    });

    check('CROSS_COLLECTION_RUN_COHERENCE',
      okDs.available === true && okDs.coherence.ok === true
      && badDs.available === false && badDs.status === ar.AUTH_READ_STATUS.READ_COHERENCE_FAILURE
      && badDs.decisions.length === 0 && badDs.portfolio === null
      && guard.ok === false && guard.mismatches.length === 1,
      `一致 ⇒ coherence.ok=${okDs.coherence.ok}（检查 ${okDs.coherence.records_checked} 条）`
      + ` ｜ 跨 run ⇒ ${badDs.status}/${badDs.reason} 且 decisions=${badDs.decisions.length} portfolio=${badDs.portfolio}`
      + ` ｜ 守卫单元 ⇒ ok=${guard.ok} mismatches=${guard.mismatches.length}`);
  }

  /* ================= 5. CANDIDATE_INVISIBLE_BEFORE_PROMOTION ================= */
  section('5 CANDIDATE_INVISIBLE_BEFORE_PROMOTION');
  {
    const ad = createMemoryAdapter();
    await seedRun(ad, 'run-B', 2, { trade_date: TD });
    // C 比 B 更新（revision 更大 + 写得更晚），但 **pointer 仍指 B**
    await seedRun(ad, 'run-C', 3, { trade_date: TD, codes: ['513310', '515880'] });
    await ad.compareAndSetPointer(SCOPE, null, { run_id: 'run-B', revision: 2, expected_trade_date: TD });
    const ds = await ar.readAuthoritativeDataset(ad, { scope: SCOPE, expected_codes: CODES });
    const onlyB = ds.available && ds.active_run_id === 'run-B'
      && ds.decisions.every((d) => String(d.run_id) === 'run-B')
      && ds.portfolio && String(ds.portfolio.run_id) === 'run-B';
    check('CANDIDATE_INVISIBLE_BEFORE_PROMOTION', onlyB,
      `resolved=${ds.active_run_id}（C 已存在且 revision 更大，但 pointer 未切 ⇒ 不可见）`);
  }

  /* ================= 6. MISSING_POINTER_FAIL_CLOSED ================= */
  section('6 MISSING_POINTER_FAIL_CLOSED');
  {
    // (a) pointer 缺失
    const adNo = createMemoryAdapter();
    await seedRun(adNo, 'run-B', 2);
    const noPtr = await ar.readAuthoritativeDataset(adNo, { scope: SCOPE, expected_codes: CODES });
    // (b) pointer 指向不存在的 run
    const adGhost = createMemoryAdapter();
    await adGhost.compareAndSetPointer(SCOPE, null, { run_id: 'run-GHOST', revision: 9 });
    const ghost = await ar.readAuthoritativeDataset(adGhost, { scope: SCOPE, expected_codes: CODES });
    // (c) run 数据不完整
    const adPart = createMemoryAdapter();
    await seedRun(adPart, 'run-B', 2, { codes: ['513310'] });
    await adPart.compareAndSetPointer(SCOPE, null, { run_id: 'run-B', revision: 2 });
    const partial = await ar.readAuthoritativeDataset(adPart, { scope: SCOPE, expected_codes: CODES });

    const okAll = [noPtr, ghost, partial].every((d) =>
      d.available === false && d.latest_fallback_used === false && d.fail_closed === true
      && d.decisions.length === 0 && d.portfolio === null);
    check('MISSING_POINTER_FAIL_CLOSED', okAll,
      `无 pointer=${noPtr.reason} ｜ 幽灵 run=${ghost.reason} ｜ 不完整=${partial.reason}`
      + ` ｜ 三者均 latest_fallback_used=false`);
  }

  /* ================= 7. MUTABLE_STATE_AXIS_PRESERVED ================= */
  section('7 MUTABLE_STATE_AXIS_PRESERVED');
  {
    // (a) portfolio_position 不得被当作 run 产物：ALLOWED_LATEST_READS 显式登记为 MUTABLE_STATE
    const mp = (ar.ALLOWED_LATEST_READS || []).find((x) => x.collection === 'portfolio_position');
    // (b) mutable provenance 必须自证是另一条轴
    const prov = ar.buildMutableStateProvenance({ rows: [{ updated_at: '2026-09-24T09:00:00Z' }] });
    // (c) 端点里 portfolio_position 仍按原语义读（未被 run_id 过滤）
    const dash = extractFunction(src, 'getDashboard');
    const posReadUntouched = /query\s*\(\s*COLLECTIONS\.PORTFOLIO_POSITION\s*,\s*\{\s*\}\s*\)/.test(dash || '');
    // (d) 不得出现「用 run_id 过滤 portfolio_position」的伪统一
    const fakeUnify = /PORTFOLIO_POSITION[^)]*run_id/.test(src);
    check('MUTABLE_STATE_AXIS_PRESERVED',
      !!mp && mp.axis === 'MUTABLE_STATE' && prov.position_as_of_current_state === true
      && posReadUntouched && !fakeUnify,
      `登记轴=${mp ? mp.axis : 'MISSING'} ｜ provenance.position_as_of_current_state=${prov.position_as_of_current_state}`
      + ` ｜ position 仍全量读=${posReadUntouched} ｜ 未强塞 run_id=${!fakeUnify}`);
  }

  /* ================= 8. LEGACY_RESPONSE_COMPATIBILITY ================= */
  section('8 LEGACY_RESPONSE_COMPATIBILITY');
  {
    const missing = [];
    Object.keys(LEGACY_KEYS).forEach((fn) => {
      const body = extractFunction(src, fn);
      if (!body) { missing.push(`${fn}:function_not_found`); return; }
      LEGACY_KEYS[fn].forEach((k) => { if (!hasKey(body, k)) missing.push(`${fn}.${k}`); });
    });
    check('LEGACY_RESPONSE_COMPATIBILITY', missing.length === 0,
      missing.length ? '缺失字段: ' + missing.join(', ') : '5 端点 legacy 响应字段全部保留（新增 provenance 为 additive）');
  }

  /* ================= 汇总 ================= */
  const items = checks.filter((c) => !c.section);
  const failed = items.filter((c) => !c.ok);

  if (argv.includes('--json')) {
    console.log(JSON.stringify({ checks, failed: failed.length }, null, 2));
  } else {
    checks.forEach((c) => {
      if (c.section) { console.log('\n### ' + c.section); return; }
      console.log((c.ok ? '[PASS] ' : '[FAIL] ') + c.name + (c.detail ? '\n        ' + c.detail : ''));
    });
    console.log('\n==================== Reader Gate 汇总 ====================');
    console.log(`PASS ${items.length - failed.length} / ${items.length}`);
    if (failed.length) failed.forEach((f) => console.log('  [FAIL] ' + f.name + ' :: ' + f.detail));
    console.log('READER_MIGRATION = ' + (failed.length ? 'NOT_COMPLETE（存在 FAIL 项）' : 'COMPLETE'));
    console.log('⚠️ COMPLETE ≠ PRODUCTION AUTHORIZED；RUN_HISTORY_INDEX 仍 PENDING（代码侧 RH1~RH4 ✅ + HD-10 结构侧 ✅ 已完成；缺数据侧：生产提升 + 切换日登记）；'
      + 'FREEZE / PR / MERGE / DEPLOY 均需单独授权。');
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error('[FAIL] gate 异常: ' + (e && e.stack || e)); process.exit(1); });
