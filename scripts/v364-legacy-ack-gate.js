#!/usr/bin/env node
'use strict';

/**
 * scripts/v364-legacy-ack-gate.js
 *
 * F-10 · Gate V364 (legacy) — Attested Divergence Acknowledgement
 *
 * 决策依据 : I-5-D（ATTESTED_ONLY）· V2 Package §1.1 F-10 / §3.4 / §11.1 / §11.2 / §12
 * 执行卡   : EC-01（时点分层，Owner ACCEPT OPTION A）
 *            · 运行时判据 = 「emitted ⊆ acknowledged_allowlist ∧ violations == 0」
 *            · 静态判据   = 白名单基数断言（3 / 58 / 61 = 3 + 58 ∧ NEVER_7 == 7）
 *            · 严格等值「emitted == 61」归属 §9.6 终验门 G-V364（三文件落位后成立）
 *
 * 目的：把「V364 与 V365 canonical 的分歧」由**静默通过**改为**显式可执行承认**。
 *
 *   acknowledged = 命中本文件内嵌 deterministic 白名单的条目（3 hash + 58 surface = 61）
 *   violation    = 白名单外条目，或命中 NEVER_ALLOWLISTABLE_7（装置结构完整性被破坏）
 *
 * 不变量：
 *   · 本文件**不修改** lock / baseline / 任何受管文件；只读消费
 *     scripts/verify-v364-immutable.js 的判定输出（子进程 + --json）。
 *   · 白名单为**逐项枚举**（⛔ 不以通配替代，防止吞掉未来新增文件）。
 *   · 基数双向设闸：白名单变宽（吞漏网 error）与变窄（未来删除后静默通过）均被静态断言拦下。
 *   · 7 码永久禁入与白名单无关 —— 命中即计 violation。
 *   · RED_PROOF（RP-1…RP-4）只使用合成 / 空集输入，⛔ 不触碰真实受管文件。
 *
 * 用法：
 *   node scripts/v364-legacy-ack-gate.js              # 承认门（exit 0 = 通过）
 *   node scripts/v364-legacy-ack-gate.js --json       # 机器可读输出
 *   node scripts/v364-legacy-ack-gate.js --selftest   # RP-1…RP-4 反向重建（合成输入）
 */

const { spawnSync } = require('child_process');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const VERIFIER_REL = 'scripts/verify-v364-immutable.js';

/* =====================================================================
 * 常量① —— ⛔ 永久禁止进入 allowlist 的 7 个结构完整性错误码
 * （描述 V364 装置自身身份根 / 面自洽；与「V365 取代 V364」无因果关系）
 * ===================================================================== */
const NEVER_ALLOWLISTABLE_7 = [
  'V364_LOCK_MISSING',
  'V364_LOCK_SCHEMA_INVALID',
  'V364_LOCK_ANCHOR_MISMATCH',
  'V364_GENERATION_MISMATCH',
  'V364_BASELINE_SELF_HASH_MISMATCH',
  'V364_BASELINE_REGISTRY_MISMATCH',
  'V364_DECLARED_FILE_MISSING'
];

/* =====================================================================
 * 常量② —— ACKNOWLEDGED_DIVERGENCE_V364（deterministic 逐项枚举 = 3 + 58 = 61）
 * ===================================================================== */
const ACKNOWLEDGED_DIVERGENCE_V364 = {
  V364_CODE_HASH_MISMATCH: [
    'cloudfunctions/runDecisionEngine/index.js',
    'src/common/schema.js',
    'src/common/utils/v361-run-context.js'
  ],
  V364_UNEXPECTED_SURFACE_FILE: [
    'scripts/gen-cn-trading-calendar.js',
    'scripts/gen-gen1-model-sha.js',
    'scripts/gen-gen1-source-sha.js',
    'scripts/gen-v365-candidate-manifest.js',
    'scripts/lib/v365-decision-classification.js',
    'scripts/lib/v365-deterministic-tar.js',
    'scripts/lib/v365-orchestration-approval.js',
    'scripts/lib/v365-p3-memory-adapter.js',
    'scripts/lib/v365-p4-candidate-patches.js',
    'scripts/lib/v365-p4-observation-store.js',
    'scripts/lib/v365-prospective-gate.js',
    'scripts/tools/cloudbase-export-decision-result-for-cooldown.js',
    'scripts/tools/cloudbase-export-governed-history.js',
    'scripts/tools/cloudbase-readonly-client.js',
    'scripts/tools/cloudbase-readonly-safety-test.js',
    'scripts/v364-legacy-ack-gate.js',
    'scripts/v365-cas-platform-probe.js',
    'scripts/v365-deployment-bundle-materialize.js',
    'scripts/v365-deployment-candidate-manifest.js',
    'scripts/v365-deployment-identity-audit.js',
    'scripts/v365-deployment-rollback-binding.js',
    'scripts/v365-deployment-scope.js',
    'scripts/v365-final-state-consistency-check.js',
    'scripts/v365-gen-changed-regions.js',
    'scripts/v365-hd10-create-collections.js',
    'scripts/v365-p12-decision-parity.js',
    'scripts/v365-p1a-calendar-gate.js',
    'scripts/v365-p3-atomic-publish-gate.js',
    'scripts/v365-p4-correlation-gate.js',
    'scripts/v365-pre-deploy-package-diff.js',
    'scripts/v365-prospective-preflight.js',
    'scripts/v365-qualification-gate.js',
    'scripts/v365-reader-migration-gate.js',
    'scripts/v365-replay-delta-attribution.js',
    'scripts/v365-replay-v2cf-attest.js',
    'scripts/v365-rfp-ph-available-window.js',
    'scripts/v365-rollback-artifact.js',
    'scripts/v365-rpg-f2b-actual-coverage-audit.js',
    'scripts/v365-rpg001-tech-cap-probe.js',
    'scripts/v365-rpg002-execution-semantics-probe.js',
    'scripts/v365-rpg003-state-evolution-probe.js',
    'scripts/v365-source-tree-sha.js',
    'scripts/verify-v365-candidate-manifest.js',
    'src/common/data/cn-trading-calendar.json',
    'src/common/data/cn-trading-calendar.manifest.json',
    'src/common/data/cn-trading-calendar.v1.json',
    'src/common/data/cn-trading-calendar.v1.manifest.json',
    'src/common/data/sources/cn-trading-calendar.source.v1.json',
    'src/common/utils/cn-trading-calendar.js',
    'src/common/utils/fundamental-provenance.js',
    'src/common/utils/global-signal-provenance.js',
    'src/common/utils/market-env-provenance.js',
    'src/common/utils/pipeline-correlation.js',
    'src/common/utils/v365-active-read.js',
    'src/common/utils/v365-atomic-publish.js',
    'src/common/utils/v365-contracts.js',
    'src/common/utils/v365-publish-store.js',
    'src/common/utils/v365-run-integrity.js'
  ]
};

/* =====================================================================
 * 常量③ —— frozen_counts（终态口径；本门静态断言其与白名单集合一致）
 * ===================================================================== */
const FROZEN_COUNTS = {
  V364_CODE_HASH_MISMATCH: 3,
  V364_UNEXPECTED_SURFACE_FILE: 58
};

const ALLOWLIST_BASE_TOTAL = 61;

const ACK_LINE_BASE = '[V364-LEGACY] divergence acknowledged: 61 item(s)'
  + ' \u2014 superseded by V365 canonical; NOT a current production invariant PASS';

/* =====================================================================
 * 纯函数区（可被 --selftest 以合成输入驱动；⛔ 不触碰真实文件）
 * ===================================================================== */

/** 从 verifier 的 error.detail 还原归属路径（两种 detail 形态见下） */
function pathOf(entry) {
  const d = String((entry && entry.detail) || '');
  const fullWidth = d.indexOf('\uFF08');   // '（'
  if (fullWidth >= 0) return d.slice(0, fullWidth).trim();
  const declaredAt = d.indexOf(' declared=');
  if (declaredAt >= 0) return d.slice(0, declaredAt).trim();
  return d.trim();
}

/**
 * 分类：白名单命中 → acknowledged；否则（含 NEVER_7）→ violation。
 * @param {Array<{code:string,detail:string}>} errors
 * @param {Object<string, Array<string>>} allowlist
 * @param {Array<string>} never7
 */
function classify(errors, allowlist, never7) {
  const never = new Set(never7 || []);
  const acknowledged = [];
  const violations = [];
  const list = Array.isArray(errors) ? errors : [];
  for (let i = 0; i < list.length; i++) {
    const e = list[i] || {};
    const code = String(e.code || '');
    const p = pathOf(e);
    const reason = never.has(code)
      ? 'NEVER_ALLOWLISTABLE'
      : null;
    if (reason) {
      violations.push({ code: code, path: p, reason: reason, detail: String(e.detail || '') });
      continue;
    }
    const set = allowlist && allowlist[code];
    if (set && set.indexOf(p) >= 0) {
      acknowledged.push({ code: code, path: p, detail: String(e.detail || '') });
      continue;
    }
    violations.push({ code: code, path: p, reason: 'NOT_IN_ALLOWLIST', detail: String(e.detail || '') });
  }
  return { acknowledged: acknowledged, violations: violations };
}

/** 静态完整性断言（对常量自身；每类各自断言，便于定位） */
function staticChecks() {
  const checks = [];
  const push = (name, ok, detail) => checks.push({ name: name, ok: !!ok, detail: detail || '' });

  push('NEVER_ALLOWLISTABLE_7 基数 == 7',
    NEVER_ALLOWLISTABLE_7.length === 7, 'len=' + NEVER_ALLOWLISTABLE_7.length);
  push('NEVER_ALLOWLISTABLE_7 无重复',
    new Set(NEVER_ALLOWLISTABLE_7).size === NEVER_ALLOWLISTABLE_7.length);

  const hashList = ACKNOWLEDGED_DIVERGENCE_V364.V364_CODE_HASH_MISMATCH;
  const surfList = ACKNOWLEDGED_DIVERGENCE_V364.V364_UNEXPECTED_SURFACE_FILE;

  push('ack.hash 基数 == 3', hashList.length === 3, 'len=' + hashList.length);
  push('ack.surface 基数 == 58', surfList.length === 58, 'len=' + surfList.length);
  push('ack 总分 == 61', hashList.length + surfList.length === ALLOWLIST_BASE_TOTAL,
    hashList.length + '+' + surfList.length + '=' + (hashList.length + surfList.length));
  push('ack.hash 无重复', new Set(hashList).size === hashList.length);
  push('ack.surface 无重复', new Set(surfList).size === surfList.length);
  push('ack 条目均为非空字符串',
    hashList.concat(surfList).every(function (p) { return typeof p === 'string' && p.length > 0; }));

  push('frozen_counts.hash == ack.hash 基数',
    FROZEN_COUNTS.V364_CODE_HASH_MISMATCH === hashList.length);
  push('frozen_counts.surface == ack.surface 基数',
    FROZEN_COUNTS.V364_UNEXPECTED_SURFACE_FILE === surfList.length);
  push('frozen_counts 合计 == 61',
    FROZEN_COUNTS.V364_CODE_HASH_MISMATCH + FROZEN_COUNTS.V364_UNEXPECTED_SURFACE_FILE
    === ALLOWLIST_BASE_TOTAL);

  const ackKeys = Object.keys(ACKNOWLEDGED_DIVERGENCE_V364);
  push('ack 顶层键恰为 2 类',
    ackKeys.length === 2
    && ackKeys.indexOf('V364_CODE_HASH_MISMATCH') >= 0
    && ackKeys.indexOf('V364_UNEXPECTED_SURFACE_FILE') >= 0,
    ackKeys.join(','));
  push('NEVER_7 与白名单键不相交',
    ackKeys.every(function (k) { return NEVER_ALLOWLISTABLE_7.indexOf(k) < 0; }));
  push('白名单条目均不含 NEVER_7 成员',
    hashList.concat(surfList).every(function (p) { return NEVER_ALLOWLISTABLE_7.indexOf(p) < 0; }));

  return { ok: checks.every(function (c) { return c.ok; }), checks: checks };
}

/** 冻结白名单为不可变副本（防止运行期被无意改写） */
function frozenAllowlist() {
  const out = {};
  for (const k of Object.keys(ACKNOWLEDGED_DIVERGENCE_V364)) {
    out[k] = ACKNOWLEDGED_DIVERGENCE_V364[k].slice();
  }
  return out;
}

/* =====================================================================
 * 运行区
 * ===================================================================== */

function runVerifierJson() {
  const abs = path.join(REPO_ROOT, VERIFIER_REL);
  const r = spawnSync(process.execPath, [abs, '--json'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024
  });
  const stdout = String(r.stdout || '');
  let parsed = null;
  let parseError = null;
  try {
    parsed = JSON.parse(stdout);
  } catch (e) {
    parseError = e.message;
  }
  return {
    ok: !!(parsed && Array.isArray(parsed.errors)),
    exit: r.status,
    spawnError: r.error ? String(r.error.message || r.error) : null,
    parseError: parseError,
    result: parsed
  };
}

function evaluate(verifierErrors) {
  const st = staticChecks();
  const allow = frozenAllowlist();
  const c = classify(verifierErrors, allow, NEVER_ALLOWLISTABLE_7);
  const emitted = Array.isArray(verifierErrors) ? verifierErrors.length : 0;
  const ackCountByCode = {};
  for (const a of c.acknowledged) {
    ackCountByCode[a.code] = (ackCountByCode[a.code] || 0) + 1;
  }
  return {
    static_ok: st.ok,
    static_checks: st.checks,
    emitted: emitted,
    acknowledged: c.acknowledged.length,
    acknowledged_by_code: ackCountByCode,
    violations: c.violations,
    violation_count: c.violations.length,
    allowlist_base: ALLOWLIST_BASE_TOTAL,
    frozen_counts: FROZEN_COUNTS,
    subset_holds: c.violations.length === 0,
    pass: st.ok && c.violations.length === 0
  };
}

/* ---------------- RP-1…RP-4 反向重建（合成输入） ---------------- */

function selftest() {
  const v = runVerifierJson();
  if (!v.ok) {
    console.log('[V364-LEGACY] [SELFTEST] verifier 输出不可解析 ⇒ 无法建立红证基线');
    process.exit(1);
    return;
  }
  const realErrors = v.result.errors;
  const allow = frozenAllowlist();
  const rows = [];

  // RP-1：移除整个白名单（同一真实输入）⇒ 全部计 violation
  const rp1 = classify(realErrors, {}, NEVER_ALLOWLISTABLE_7);
  rows.push({
    id: 'RP-1', desc: '移除整个白名单（同一集成树输入）',
    expected: 'FAIL', observed: rp1.violations.length > 0 && rp1.acknowledged.length === 0 ? 'FAIL' : 'PASS',
    detail: 'violations=' + rp1.violations.length + ' (emitted=' + realErrors.length + ')'
  });

  // RP-2：注入合成第 4 条 V364_CODE_HASH_MISMATCH（mock 输出，⛔ 不真改文件）
  const rp2errs = realErrors.concat([{
    code: 'V364_CODE_HASH_MISMATCH',
    detail: 'src/common/utils/zzz-synthetic-probe.js declared=0000000000000000\u2026 actual=1111111111111111\u2026'
  }]);
  const rp2 = classify(rp2errs, allow, NEVER_ALLOWLISTABLE_7);
  rows.push({
    id: 'RP-2', desc: '注入合成第 4 条 CODE_HASH_MISMATCH（mock）',
    expected: 'FAIL', observed: rp2.violations.length === 1 ? 'FAIL' : 'PASS',
    detail: 'violations=' + rp2.violations.length
  });

  // RP-3：注入合成新增受管面文件（mock 输出）
  const rp3errs = realErrors.concat([{
    code: 'V364_UNEXPECTED_SURFACE_FILE',
    detail: 'scripts/zzz-probe.js\uFF08\u4E0D\u5728 baseline \u222A declared \u222A EXCL \u5185\uFF09'
  }]);
  const rp3 = classify(rp3errs, allow, NEVER_ALLOWLISTABLE_7);
  rows.push({
    id: 'RP-3', desc: '注入合成新增受管面文件（mock）',
    expected: 'FAIL', observed: rp3.violations.length === 1 ? 'FAIL' : 'PASS',
    detail: 'violations=' + rp3.violations.length
  });

  // RP-4：逐字节还原 ⇒ 通过
  const rp4 = classify(realErrors, allow, NEVER_ALLOWLISTABLE_7);
  rows.push({
    id: 'RP-4', desc: '逐字节还原（真实白名单 + 真实输入）',
    expected: 'PASS', observed: rp4.violations.length === 0 ? 'PASS' : 'FAIL',
    detail: 'acknowledged=' + rp4.acknowledged.length + ' violations=' + rp4.violations.length
  });

  // RP-N（补充 · §5.4 判据）：命中 NEVER_7 ⇒ 直接 violation（与白名单无关）
  const rpnErrs = realErrors.concat([{
    code: 'V364_LOCK_MISSING', detail: 'ml/manifests/V364_IMMUTABLE_LOCK.json'
  }]);
  const rpn = classify(rpnErrs, allow, NEVER_ALLOWLISTABLE_7);
  const rpnHit = rpn.violations.some(function (x) { return x.reason === 'NEVER_ALLOWLISTABLE'; });
  rows.push({
    id: 'RP-N', desc: '命中 NEVER_ALLOWLISTABLE_7 ⇒ 直接 violation（补充 · §5.4）',
    expected: 'FAIL', observed: rpnHit ? 'FAIL' : 'PASS',
    detail: 'never_hit=' + rpnHit
  });

  const allOk = rows.every(function (r) { return r.observed === r.expected; });
  console.log('[V364-LEGACY] [SELFTEST] RED_PROOF（合成/空集输入，⛔ 未触碰真实受管文件）');
  for (const r of rows) {
    console.log('   ' + r.id + '  expected=' + r.expected + ' observed=' + r.observed
      + '  ' + (r.observed === r.expected ? 'OK' : 'MISMATCH') + '  · ' + r.desc + ' · ' + r.detail);
  }
  console.log('[V364-LEGACY] [SELFTEST] ' + (allOk ? 'ALL_RED_PROOFS_AS_EXPECTED' : 'RED_PROOF_MISMATCH'));
  process.exit(allOk ? 0 : 1);
}

/* ---------------- main ---------------- */

function main() {
  const argv = process.argv.slice(2);

  if (argv.indexOf('--selftest') >= 0) {
    selftest();
    return;
  }

  const st = staticChecks();
  if (!st.ok) {
    console.log('[V364-LEGACY] static 完整性断言 FAIL');
    for (const c of st.checks) {
      if (!c.ok) console.log('   - ' + c.name + (c.detail ? '  [' + c.detail + ']' : ''));
    }
    process.exit(1);
    return;
  }

  const v = runVerifierJson();
  if (!v.ok) {
    console.log('[V364-LEGACY] verifier 输出不可解析 ⇒ FAIL');
    if (v.spawnError) console.log('   spawn_error = ' + v.spawnError);
    if (v.parseError) console.log('   parse_error = ' + v.parseError);
    console.log('   verifier_exit = ' + v.exit);
    process.exit(1);
    return;
  }

  const ev = evaluate(v.result.errors);

  if (argv.indexOf('--json') >= 0) {
    console.log(JSON.stringify({
      gate: 'V364-LEGACY',
      acknowledged_line: ACK_LINE_BASE,
      static_ok: ev.static_ok,
      static_checks: ev.static_checks,
      allowlist_base: ev.allowlist_base,
      frozen_counts: ev.frozen_counts,
      emitted: ev.emitted,
      acknowledged: ev.acknowledged,
      acknowledged_by_code: ev.acknowledged_by_code,
      subset_holds: ev.subset_holds,
      violation_count: ev.violation_count,
      violations: ev.violations,
      strict_equality_deferred_to: 'Auth Gate §9.6 / G-V364',
      verifier_exit: v.exit,
      pass: ev.pass
    }, null, 2));
    process.exit(ev.pass ? 0 : 1);
    return;
  }

  // 第 1 行：承认基数声明（字符串与执行卡一致 · 61 = 白名单静态基数）
  console.log(ACK_LINE_BASE);
  // 第 2 行：staged 运行实测（EC-01 C-01/C-02）
  console.log('[V364-LEGACY] staged run: emitted=' + ev.emitted
    + ' acknowledged=' + ev.acknowledged
    + ' violations=' + ev.violation_count
    + ' \u00b7 static allowlist base=' + ev.allowlist_base
    + ' (' + FROZEN_COUNTS.V364_CODE_HASH_MISMATCH + ' hash + '
    + FROZEN_COUNTS.V364_UNEXPECTED_SURFACE_FILE + ' surface)');
  // 第 3 行：严格等值的归属时点（EC-01 C-03）
  console.log('[V364-LEGACY] strict equality (emitted == ' + ev.allowlist_base
    + ') deferred to Auth Gate \u00a79.6 / G-V364 (PRECONDITION: F-01 \u2227 F-02 \u2227 F-10 \u843D\u4F4D)');

  if (ev.violation_count > 0) {
    console.log('[FAIL] V364-LEGACY：' + ev.violation_count + ' 项白名单外 / 禁入码条目');
    for (const x of ev.violations) {
      console.log('   - ' + x.code + ' [' + x.reason + '] ' + x.path);
    }
    process.exit(1);
    return;
  }

  console.log('[PASS] V364-LEGACY：emitted \u2286 allowlist \u2227 violations == 0'
    + ' \u00b7 \u8ba4\u53ef\u5982\u4e0b\u5408\u8ba1 ' + ev.acknowledged + ' \u9879'
    + '\uff08\u767d\u540d\u5355\u57fa\u6570 ' + ev.allowlist_base + '\uff09');
  process.exit(0);
}

if (require.main === module) main();

module.exports = {
  NEVER_ALLOWLISTABLE_7: NEVER_ALLOWLISTABLE_7,
  ACKNOWLEDGED_DIVERGENCE_V364: ACKNOWLEDGED_DIVERGENCE_V364,
  FROZEN_COUNTS: FROZEN_COUNTS,
  ALLOWLIST_BASE_TOTAL: ALLOWLIST_BASE_TOTAL,
  pathOf: pathOf,
  classify: classify,
  staticChecks: staticChecks
};
