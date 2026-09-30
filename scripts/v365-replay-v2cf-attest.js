#!/usr/bin/env node
/**
 * RPG-F2-A —— RFP-V2-CF 认证（coverage manifest + V1/V2-CF 归因 + interim anchor）
 *
 * 职责（三合一，只读）：
 *   ① 复现 **RFP-V1** 的 `result_sequence_sha`，并断言 == `25ccbfc7…1723`（V1 immutability）
 *   ② 运行 **RFP-V2-CF**，逐 date × code 归因 V1→V2 差异
 *   ③ 输出机器可读 **coverage manifest** 与 **interim anchor**（7 项绑定）
 *
 * ⛔ 不修改 harness / 生产代码 / 门禁；⛔ 不写 V1 anchor。
 * ⛔ 本轮的 V2-CF anchor 为 **INTERIM**：`qualification_authoritative = false`。
 *
 * 用法：
 *   node scripts/v365-replay-v2cf-attest.js [--from D] [--to D] [--out-dir outputs]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..');
const harness = require(path.join(REPO, 'scripts', 'lib', 'v364-replay-harness.js'));
const correlation = require(path.join(REPO, 'src', 'common', 'utils', 'correlation.js'));
const constants = require(path.join(REPO, 'src', 'common', 'constants.js'));

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) continue;
    const v = argv[i + 1];
    if (v == null || v.startsWith('--')) { a[k.slice(2)] = true; continue; }
    a[k.slice(2)] = v; i += 1;
  }
  return a;
}
const a = parseArgs(process.argv);
const FROM = a.from || '2026-08-01';
const TO = a.to || '2026-09-22';
const OUT_DIR = path.resolve(String(a['out-dir'] || path.join(REPO, 'outputs')));

const V1_ANCHOR_EXPECTED = '25ccbfc7e1b73a9a173ec36c17512c6228a2fe42685dcd291bc055ea4ed11723';

/* ------------------------------------------------------------------ *
 * 与 parity 门禁**同一**的 anchor 度量（逐字段复制，用于自证复现一致）
 * ------------------------------------------------------------------ */
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}
function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function summarize(result) {
  return {
    meta: {
      slowBreakMode: result.meta.slowBreakMode,
      runsPerDay: result.meta.runsPerDay,
      from: result.meta.from,
      to: result.meta.to,
      days: result.meta.days,
      universe: result.meta.universe
    },
    axis: result.axis,
    days: result.days.map((d) => ({
      trade_date: d.trade_date,
      market_regime: d.market_regime,
      index_w_states: d.index_w_states,
      byCode: d.byCode
    })),
    runDiffs: result.runDiffs,
    finalBook: result.finalBook
  };
}

/* ------------------------------------------------------------------ *
 * 运行两个协议
 * ------------------------------------------------------------------ */
// RPG-F2-B：replay() 已改为 async ⇒ 用 async IIFE 包裹（CJS 无顶层 await）
(async () => {
const v1 = await harness.replay({ from: FROM, to: TO, runsPerDay: 1, protocol: 'V1' });
const v2 = await harness.replay({ from: FROM, to: TO, runsPerDay: 1, protocol: 'V2-CF' });

const v1Sha = sha256(stableStringify(summarize(v1)));
const v2Sha = sha256(stableStringify(summarize(v2)));
const v1Reproducible = v1Sha === V1_ANCHOR_EXPECTED;

/* ------------------------------------------------------------------ *
 * 逐 date 的 cap 计算（复用生产纯函数；与 harness 的 V2-CF 注入同输入同函数）
 * ------------------------------------------------------------------ */
const { barsByCode } = harness.loadBars();
const TECH_SECTORS = constants.TECH_SECTORS;
const UNIVERSE = harness.UNIVERSE;
const BASE_CAP = harness.PROD_PARAMS.tech_sector_max != null
  ? harness.PROD_PARAMS.tech_sector_max
  : constants.DEFAULT_PARAMS.tech_sector_max;

const capByDate = {};
for (const d of v1.axis) {
  const asOf = {};
  UNIVERSE.forEach((u) => { asOf[u.code] = (barsByCode[u.code] || []).filter((b) => b.trade_date <= d); });
  const info = correlation.effectiveTechCap(BASE_CAP, asOf);
  capByDate[d] = {
    base_cap: BASE_CAP,
    discount: info.discount,
    rho_avg: info.rho_avg,
    rho_max: info.rho_max,
    effective_cap_v1: BASE_CAP,          // V1 = fallback
    effective_cap_v2cf: info.effective_cap
  };
}

/* ------------------------------------------------------------------ *
 * 逐 date × code 归因
 * ------------------------------------------------------------------ */
const deltas = [];
const unexpected = [];
for (let i = 0; i < v1.days.length; i++) {
  const d1 = v1.days[i];
  const d2 = v2.days[i];
  const cap = capByDate[d1.trade_date];
  const capChanged = Math.round(cap.effective_cap_v2cf * 10) !== Math.round(cap.effective_cap_v1 * 10);
  for (const code of Object.keys(d1.byCode)) {
    const A = d1.byCode[code];
    const B = d2.byCode[code];
    for (const field of ['final_target', 'final_action', 'binding_constraint']) {
      if (JSON.stringify(A[field]) === JSON.stringify(B[field])) continue;
      const isTech = TECH_SECTORS.indexOf(
        (UNIVERSE.find((u) => u.code === code) || {}).sector || ''
      ) >= 0;
      // 机器判据（RPG-D3）：V2 cap ≠ V1 fallback  ∧  差异可经 sector-cap 路径追溯
      const attributable = capChanged && isTech && (A.binding_constraint === 'sector_cap' || B.binding_constraint === 'sector_cap');
      const rec = {
        date: d1.trade_date,
        code,
        field,
        v1_value: A[field],
        v2_value: B[field],
        v1_binding_constraint: A.binding_constraint,
        v2_binding_constraint: B.binding_constraint,
        is_tech_code: isTech,
        effective_tech_cap_v1: cap.effective_cap_v1,
        effective_tech_cap_v2cf: cap.effective_cap_v2cf,
        discount_v2cf: cap.discount,
        reason: attributable ? 'effective_tech_cap_fidelity' : 'unattributed',
        classification: attributable ? 'EXPECTED_FIDELITY_DELTA' : 'UNEXPECTED_DECISION_DELTA'
      };
      deltas.push(rec);
      if (!attributable) unexpected.push(rec);
    }
  }
}

/* ------------------------------------------------------------------ *
 * coverage manifest（§5）
 * ------------------------------------------------------------------ */
const coverageManifest = {
  protocol_version: 'RFP-V2-CF',
  replay_semantics: 'COUNTERFACTUAL_ASSUMED_EXECUTION',
  generated_at_utc: new Date().toISOString(),
  qualification_authoritative: false,
  qualification_authoritative_reason: 'RPG-002 unresolved for fidelity; RFP-V2-PH not available',
  coverage: {
    effective_tech_cap: {
      status: 'PRODUCTION_FUNCTION_REUSED',
      function: 'src/common/utils/correlation.js::effectiveTechCap',
      as_of_date: true,
      lookahead: false,
      rpg: 'RPG-001'
    },
    cooldown: {
      status: 'KNOWN_GAP',
      production_fidelity: 'NOT_AVAILABLE',
      counterfactual_fidelity: 'INCOMPLETE',
      reason: 'RPG-002 —— harness 仍硬编码 cooldownDays: 0（本轮**未**修复）',
      rpg: 'RPG-002'
    },
    position_book: {
      status: 'COUNTERFACTUAL_ASSUMED_EXECUTION',
      production_historical_fidelity: 'NOT_APPLICABLE',
      note: 'nextBook = suggested_position（本轮**未**改）',
      rpg: 'RPG-003'
    }
  }
};

/* ------------------------------------------------------------------ *
 * 输入 / 代码哈希（anchor 绑定用）
 * ------------------------------------------------------------------ */
function sha256File(p) { return sha256(fs.readFileSync(p)); }
const csvDir = path.join(REPO, 'deliverables/etf_daily_ml_pool');
const inputFiles = fs.readdirSync(csvDir).filter((f) => f.endsWith('.csv')).sort();
const inputDatasetHash = sha256(inputFiles.map((f) => `${f}:${sha256File(path.join(csvDir, f))}`).join('\n'));

// production_code_sha：按分类源过滤后的「决策相关生产代码」
const CLASSIFICATION = require(path.join(REPO, 'scripts', 'lib', 'v365-decision-classification.js'));
const prodFiles = CLASSIFICATION.calcFiles().concat(CLASSIFICATION.mixedFiles()).sort();
const productionCodeSha = sha256(prodFiles
  .filter((f) => fs.existsSync(path.join(REPO, f)))
  .map((f) => `${f}:${sha256File(path.join(REPO, f))}`).join('\n'));

const harnessSha = sha256File(path.join(REPO, 'scripts', 'lib', 'v364-replay-harness.js'));
const coverageManifestSha = sha256(stableStringify(coverageManifest));

const interimAnchor = {
  protocol_version: 'RFP-V2-CF',
  replay_semantics: 'COUNTERFACTUAL_ASSUMED_EXECUTION',
  input_dataset_hash: inputDatasetHash,
  production_code_sha: productionCodeSha,
  replay_harness_sha: harnessSha,
  result_sequence_sha: v2Sha,
  coverage_manifest_sha: coverageManifestSha,
  qualification_authoritative: false
};

const v1AnchorObserved = {
  protocol_version: 'RFP-V1',
  replay_semantics: 'LEGACY_COUNTERFACTUAL_REPLAY_WITH_KNOWN_FIDELITY_LIMITATIONS',
  result_sequence_sha: v1Sha,
  expected: V1_ANCHOR_EXPECTED,
  reproducible: v1Reproducible
};

const attribution = {
  protocol: { from: 'RFP-V1', to: 'RFP-V2-CF' },
  v1_anchor: v1Sha,
  v2cf_anchor: v2Sha,
  summary: {
    total_days: v1.days.length,
    total_day_code: v1.days.length * UNIVERSE.length,
    changed: deltas.length,
    expected: deltas.length - unexpected.length,
    unexpected: unexpected.length
  },
  deltas,
  unexpected
};

/* ------------------------------------------------------------------ *
 * 输出
 * ------------------------------------------------------------------ */
fs.mkdirSync(OUT_DIR, { recursive: true });
const write = (name, obj) => {
  const p = path.join(OUT_DIR, name);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
  return p;
};
const pCov = write('v365-rfp-v2cf-coverage-manifest.json', coverageManifest);
const pAnchor = write('v365-rfp-v2cf-interim-anchor.json', interimAnchor);
const pAttr = write('v365-rfp-v2cf-delta-attribution.json', attribution);

console.log('== RPG-F2-A RFP-V2-CF 认证 ==');
console.log('');
console.log('  [V1 Immutability]');
console.log(`    V1 result_sequence_sha = ${v1Sha}`);
console.log(`    expected               = ${V1_ANCHOR_EXPECTED}`);
console.log(`    RFP-V1_REPRODUCIBLE    = ${v1Reproducible}`);
console.log('');
console.log('  [V2-CF]');
console.log(`    V2-CF result_sequence_sha = ${v2Sha}`);
console.log(`    V1 != V2 (protocol change) = ${v1Sha !== v2Sha}`);
console.log('');
console.log('  [Delta Attribution]');
console.log(`    changed    = ${attribution.summary.changed}`);
console.log(`    expected   = ${attribution.summary.expected}`);
console.log(`    unexpected = ${attribution.summary.unexpected}`);
console.log('');
console.log(`  [written] ${pCov}`);
console.log(`  [written] ${pAnchor}`);
console.log(`  [written] ${pAttr}`);

if (!v1Reproducible || unexpected.length > 0) {
  console.log('\n  ⛔ FAIL（V1 不可复现 或 存在 UNEXPECTED_DECISION_DELTA）');
  process.exit(1);
}
console.log('\n  ✅ PASS（V1 可复现 · UNEXPECTED_DECISION_DELTA = 0）');
})().catch((e) => { console.error(`  [FATAL] ${e && e.stack ? e.stack : e}`); process.exit(1); });
