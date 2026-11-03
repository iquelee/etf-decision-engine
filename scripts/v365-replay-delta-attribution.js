#!/usr/bin/env node
/**
 * V3.6.5 RPG-F3 —— Dual Replay + Delta Attribution（只读）
 *
 * 目标：跑各 RFP 协议，把每一处差异**逐条**归因，并按 §6.2 输出机器可读 JSON。
 *
 * ⚠️ 语义裁定（owner 冻结，2026-09-29）：**不得扩大归因判据来消除 UNEXPECTED**。
 *   本脚本只做**观察 + 分类**，⛔ 不新增第三类 reason。
 *   归属不明的差异一律保留 `UNEXPECTED_DECISION_DELTA`（fail-closed）。
 *
 * 协议对：
 *   · `RFP-V1 → RFP-V2-CF-COOLDOWN`     （counterfactual 分支；synthetic cooldown）
 *   · `RFP-V1 → RFP-V2-AE`              （actual execution 分支；governed trade_log 驱动）
 *
 * ⛔ 红线：
 *   - 只读（不写生产、不改 harness、不改任何 calculation）
 *   - 默认 **fail-closed**：无法归因 ⇒ `UNEXPECTED_DECISION_DELTA`
 *   - 只允许两条 EXPECTED 判据（RPG-F1 §6.3）：
 *       `effective_tech_cap_fidelity` / `cooldown_gate_exercised`
 *   - ⛔ 不得要求 V1_OUTPUT == V2_OUTPUT
 *
 * 用法：
 *   node scripts/v365-replay-delta-attribution.js [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--out <path>]
 *
 * 退出码：0 = 无 UNEXPECTED；1 = 存在 UNEXPECTED（fail-closed）
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..');
const harness = require(path.join(REPO, 'scripts', 'lib', 'v364-replay-harness.js'));
const constants = require(path.join(REPO, 'src', 'common', 'constants.js'));
const correlation = require(path.join(REPO, 'src', 'common', 'utils', 'correlation.js'));

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i += 1) {
    const k = argv[i];
    if (!k.startsWith('--')) continue;
    const v = argv[i + 1];
    if (v == null || v.startsWith('--')) { a[k.slice(2)] = true; continue; }
    a[k.slice(2)] = v; i += 1;
  }
  return a;
}
const ARGS = parseArgs(process.argv);
const FROM = ARGS.from || '2026-08-01';
const TO = ARGS.to || '2026-09-22';
const OUT = ARGS.out || 'deliverables/v365-production-history/replay-delta-attribution.json';

const V1_ANCHOR_EXPECTED = '25ccbfc7e1b73a9a173ec36c17512c6228a2fe42685dcd291bc055ea4ed11723';

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
}
function summarize(r) {
  return {
    meta: {
      slowBreakMode: r.meta.slowBreakMode, runsPerDay: r.meta.runsPerDay,
      from: r.meta.from, to: r.meta.to, days: r.meta.days, universe: r.meta.universe
    },
    axis: r.axis,
    days: r.days.map((d) => ({
      trade_date: d.trade_date, market_regime: d.market_regime,
      index_w_states: d.index_w_states, byCode: d.byCode
    })),
    runDiffs: r.runDiffs,
    finalBook: r.finalBook
  };
}

/** 参与归因比对的决策字段（⛔ 与 harness 输出同源，不臆造） */
const FIELDS = ['final_action', 'final_target', 'suggested_position', 'binding_constraint'];

/* ------------------------------------------------------------------ *
 * 核心：对一「基线 → 新协议」对做逐条归因（fail-closed）
 * ------------------------------------------------------------------ */
function attributePair(base, cand, capByDate, labelBase, labelCand) {
  const deltas = [];
  const unexpected = [];
  const cooldownSeen = new Set();
  const touchedCodes = new Set();

  for (let i = 0; i < base.days.length; i += 1) {
    const d = base.days[i].trade_date;
    for (const code of Object.keys(base.days[i].byCode)) {
      const a = base.days[i].byCode[code];
      const b = cand.days[i].byCode[code];
      const cd = b.cooldown_days;
      if (cd != null && cd > 0) cooldownSeen.add(code);

      for (const f of FIELDS) {
        if (JSON.stringify(a[f]) === JSON.stringify(b[f])) continue;
        touchedCodes.add(code);

        // ---- 判据 1（§6.3）：cooldown_gate_exercised ----
        // V2 的 cooldown_days > 0 且 V1 恒 0，且动作被降级
        const cooldownExercised = (
          f === 'final_action' && cd > 0
          && a.final_action !== b.final_action
        );

        // ---- 判据 2（§6.3）：effective_tech_cap_fidelity ----
        const cap = capByDate[d];
        const capDiffers = cap != null && cap.effective_cap !== cap.base_cap;
        const capFidelity = (
          !cooldownExercised && capDiffers
          && (f === 'final_target' || f === 'suggested_position' || f === 'binding_constraint')
        );

        let reason = null;
        if (cooldownExercised) reason = 'cooldown_gate_exercised';
        else if (capFidelity) reason = 'effective_tech_cap_fidelity';

        const entry = {
          date: d,
          code,
          field: f,
          base_protocol: labelBase,
          cand_protocol: labelCand,
          base_value: a[f],
          cand_value: b[f],
          binding_constraint_cand: b.binding_constraint,
          evidence: {
            base_cooldown_days: 0,
            cand_cooldown_days: cd != null ? cd : null,
            cand_add_mode: b.add_mode != null ? b.add_mode : null,
            cand_effective_tech_cap: cap != null ? cap.effective_cap : null,
            base_effective_tech_cap: cap != null ? cap.base_cap : null,
            cand_discount: cap != null ? cap.discount : null
          }
        };

        if (reason) {
          entry.reason = reason;
          entry.classification = 'EXPECTED_FIDELITY_DELTA';
          entry.rpg = reason === 'cooldown_gate_exercised' ? 'RPG-002' : 'RPG-001';
          deltas.push(entry);
        } else {
          entry.reason = 'unattributed';
          entry.classification = 'UNEXPECTED_DECISION_DELTA';
          unexpected.push(entry);
        }
      }
    }
  }
  return { deltas, unexpected, cooldownSeen: [...cooldownSeen].sort(), touchedCodes: [...touchedCodes].sort() };
}

(async () => {
  console.log('== V3.6.5 RPG-F3 Dual Replay + Delta Attribution ==');
  console.log(`  window = ${FROM} → ${TO}`);
  console.log('  ⚠️ 归因判据**未扩大**（owner 冻结）：仅 §6.3 两条，其余一律 UNEXPECTED\n');

  const v1 = await harness.replay({ from: FROM, to: TO, runsPerDay: 1, protocol: 'V1' });
  const v2cfC = await harness.replay({ from: FROM, to: TO, runsPerDay: 1, protocol: 'V2-CF-COOLDOWN' });
  const v2ae = await harness.replay({ from: FROM, to: TO, runsPerDay: 1, protocol: 'V2-AE' });

  const v1Sha = sha256(stableStringify(summarize(v1)));
  const v2cfCSha = sha256(stableStringify(summarize(v2cfC)));
  const v2aeSha = sha256(stableStringify(summarize(v2ae)));
  const v1Reproducible = v1Sha === V1_ANCHOR_EXPECTED;

  console.log(`  RFP-V1           result_sequence_sha = ${v1Sha}`);
  console.log(`  RFP-V2-CF-COOLDOWN result_sequence_sha = ${v2cfCSha}`);
  console.log(`  RFP-V2-AE        result_sequence_sha = ${v2aeSha}`);
  console.log(`  V1_REPRODUCIBLE = ${v1Reproducible}\n`);

  /* ---- 逐日 as-of effective_tech_cap（复用生产纯函数，与 harness 同输入同函数） ---- */
  const { barsByCode } = harness.loadBars();
  const BASE_CAP = harness.PROD_PARAMS.tech_sector_max != null
    ? harness.PROD_PARAMS.tech_sector_max
    : constants.DEFAULT_PARAMS.tech_sector_max;
  const capByDate = {};
  for (const d of v1.axis) {
    const asOf = {};
    harness.UNIVERSE.forEach((u) => {
      asOf[u.code] = (barsByCode[u.code] || []).filter((b) => b.trade_date <= d);
    });
    const info = correlation.effectiveTechCap(BASE_CAP, asOf);
    capByDate[d] = {
      base_cap: BASE_CAP,
      discount: info.discount,
      rho_avg: info.rho_avg != null ? info.rho_avg : null,
      rho_max: info.rho_max != null ? info.rho_max : null,
      effective_cap: info.effective_cap
    };
  }

  /* ---- 两个协议对各自归因 ---- */
  const pairCF = attributePair(v1, v2cfC, capByDate, 'RFP-V1', 'RFP-V2-CF-COOLDOWN');
  const pairAE = attributePair(v1, v2ae, capByDate, 'RFP-V1', 'RFP-V2-AE');

  /* ---- §8 anchor 六项绑定（V2-AE） ---- */
  const CLASSIFICATION = require(path.join(REPO, 'scripts', 'lib', 'v365-decision-classification.js'));
  const sha256File = (p) => sha256(fs.readFileSync(p));
  const csvDir = path.join(REPO, 'deliverables/etf_daily_ml_pool');
  const inputFiles = fs.readdirSync(csvDir).filter((f) => f.endsWith('.csv')).sort();
  const inputDatasetHash = sha256(inputFiles.map((f) => `${f}:${sha256File(path.join(csvDir, f))}`).join('\n'));
  const prodFiles = CLASSIFICATION.calcFiles().concat(CLASSIFICATION.mixedFiles()).sort();
  const productionCodeSha = sha256(prodFiles
    .filter((f) => fs.existsSync(path.join(REPO, f)))
    .map((f) => `${f}:${sha256File(path.join(REPO, f))}`).join('\n'));
  const harnessSha = sha256File(path.join(REPO, 'scripts', 'lib', 'v364-replay-harness.js'));

  const aeMeta = v2ae.execution_ledger || {};
  const coverageManifestAE = {
    protocol_version: 'RFP-V2-AE',
    replay_semantics: 'ACTUAL_EXECUTION_COOLDOWN__COUNTERFACTUAL_BOOK',
    effective_tech_cap: {
      status: 'PRODUCTION_FUNCTION_REUSED',
      function: 'src/common/utils/correlation.js::effectiveTechCap',
      as_of_date: true, lookahead: false, rpg: 'RPG-001'
    },
    cooldown: {
      status: 'PRODUCTION_FUNCTION_REUSED_WITH_GOVERNED_ACTUAL_LEDGER',
      function: 'src/common/utils/cooldown.js::computeCooldownDays',
      execution_source: 'GOVERNED_READ_ONLY_EXPORT:trade_log',
      execution_ledger_sha256: aeMeta.trade_log_sha256 || null,
      add_mode_source: 'trade_log.add_mode → decision_result(code,buyDate).add_mode → fallbackAddMode',
      add_mode_backfill: false,
      rpg: 'RPG-002'
    },
    position_book: {
      status: 'COUNTERFACTUAL_ASSUMED_EXECUTION',
      production_historical_fidelity: 'NOT_APPLICABLE',
      note: 'nextBook = suggested_position（⛔ 未改）',
      rpg: 'RPG-003'
    },
    known_gaps: ['RPG-003-PH（production historical book）—— 待 RFP-V2-PH'],
    coverage_limitation: {
      actual_execution_available_from: aeMeta.actual_date_span ? aeMeta.actual_date_span.from : null,
      window_start: v1.axis[0],
      note: '⛔ actual execution 的可见早于窗口起点 ⇒ 窗口前段为该票「无 TRADE_LOG 命中 ⇒ 返回 0」的生产路径（非保真缺口，但亦非 fidelity 覆盖）'
    }
  };
  const coverageManifestCF = {
    protocol_version: 'RFP-V2-CF-COOLDOWN',
    replay_semantics: 'COUNTERFACTUAL_ASSUMED_EXECUTION_WITH_COOLDOWN',
    production_fidelity: false,
    qualification_authoritative: false,
    purpose: '证明 production cooldown function 的分支可被行使 + recommendation→assumed-fill 情景',
    effective_tech_cap: { status: 'PRODUCTION_FUNCTION_REUSED', rpg: 'RPG-001' },
    cooldown: {
      status: 'SYNTHETIC_COUNTERFACTUAL_FILL_LEDGER',
      function: 'src/common/utils/cooldown.js::computeCooldownDays',
      fill_source: 'DECISION_IMPLIED（BUILD/ADD && 仓位上升）',
      rpg: 'RPG-002'
    },
    position_book: { status: 'COUNTERFACTUAL_ASSUMED_EXECUTION', rpg: 'RPG-003' }
  };

  const anchorAE = {
    protocol_version: 'RFP-V2-AE',
    replay_semantics: 'ACTUAL_EXECUTION_COOLDOWN__COUNTERFACTUAL_BOOK',
    input_dataset_hash: inputDatasetHash,
    production_code_sha: productionCodeSha,
    replay_harness_sha: harnessSha,
    result_sequence_sha: v2aeSha,
    coverage_manifest_sha: sha256(stableStringify(coverageManifestAE)),
    qualification_authoritative: false,
    qualification_authoritative_reason: 'RPG-003-PH（production historical book）未完成；'
      + 'REPLAY_INFRA 授权待 owner 逐位绑定；V2-AE 尚待 owner 批准替代 V1'
  };
  const anchorCF = {
    protocol_version: 'RFP-V2-CF-COOLDOWN',
    replay_semantics: 'COUNTERFACTUAL_ASSUMED_EXECUTION_WITH_COOLDOWN',
    input_dataset_hash: inputDatasetHash,
    production_code_sha: productionCodeSha,
    replay_harness_sha: harnessSha,
    result_sequence_sha: v2cfCSha,
    coverage_manifest_sha: sha256(stableStringify(coverageManifestCF)),
    qualification_authoritative: false,
    production_fidelity: false
  };

  const out = {
    artifact: 'V365_REPLAY_DELTA_ATTRIBUTION',
    generated_at: new Date().toISOString(),
    window: { from: FROM, to: TO },
    attribution_taxonomy: {
      frozen: true,
      allowed: ['effective_tech_cap_fidelity', 'cooldown_gate_exercised'],
      policy: '⛔ 不新增第三类 reason；无法归因 ⇒ UNEXPECTED_DECISION_DELTA（fail-closed）',
      note: 'owner 裁定 2026-09-29：不得通过扩大归因判据来消除 UNEXPECTED'
    },
    v1_anchor: V1_ANCHOR_EXPECTED,
    v1_anchor_observed: v1Sha,
    v1_reproducible: v1Reproducible,

    /* ---- counterfactual 分支 ---- */
    counterfactual_branch: {
      protocol: 'RFP-V2-CF-COOLDOWN',
      production_fidelity: false,
      ledger_source: v2cfC.ledger_source,
      result_sequence_sha: v2cfCSha,
      anchor: anchorCF,
      coverage_manifest: coverageManifestCF,
      cooldown_exercised_codes: pairCF.cooldownSeen,
      simulated_fills: Object.keys(v2cfC.ledgerByCode).reduce((a, c) => {
        a[c] = v2cfC.ledgerByCode[c].length; return a;
      }, {}),
      summary: {
        changed: pairCF.deltas.length + pairCF.unexpected.length,
        expected: pairCF.deltas.length,
        unexpected: pairCF.unexpected.length
      },
      deltas: pairCF.deltas,
      unexpected: pairCF.unexpected
    },

    /* ---- actual execution 分支（RPG-F2-B 正式目标） ---- */
    actual_execution_branch: {
      protocol: 'RFP-V2-AE',
      production_fidelity: 'PARTIAL（窗口前段无 actual 记录；见 coverage_limitation）',
      ledger_source: v2ae.ledger_source,
      execution_ledger: aeMeta,
      result_sequence_sha: v2aeSha,
      anchor: anchorAE,
      coverage_manifest: coverageManifestAE,
      cooldown_exercised_codes: pairAE.cooldownSeen,
      actual_fill_counts: Object.keys(v2ae.ledgerByCode).reduce((a, c) => {
        a[c] = v2ae.ledgerByCode[c].filter((r) => r.action === 'buy').length; return a;
      }, {}),
      summary: {
        changed: pairAE.deltas.length + pairAE.unexpected.length,
        expected: pairAE.deltas.length,
        unexpected: pairAE.unexpected.length
      },
      deltas: pairAE.deltas,
      unexpected: pairAE.unexpected
    },

    /* ---- 兼容：顶层摘要指向 actual execution 分支 ---- */
    v2_anchor: v2aeSha,
    v1_v2_delta_explained: pairAE.unexpected.length === 0,
    summary: {
      total_days: v1.days.length,
      changed: pairAE.deltas.length + pairAE.unexpected.length,
      expected: pairAE.deltas.length,
      unexpected: pairAE.unexpected.length
    },
    deltas: pairAE.deltas,
    unexpected: pairAE.unexpected
  };

  console.log('== 归因结果 ==');
  for (const [name, br] of [['V2-CF-COOLDOWN（counterfactual）', pairCF], ['V2-AE（actual execution）', pairAE]]) {
    const s = { changed: br.deltas.length + br.unexpected.length, expected: br.deltas.length, unexpected: br.unexpected.length };
    console.log(`  [${name}]`);
    console.log(`     V1→该协议差异 = ${s.changed}  (EXPECTED ${s.expected} / UNEXPECTED ${s.unexpected})`);
    console.log(`     cooldown 被行使的标的 = ${JSON.stringify(br.cooldownSeen)}`);
    if (br.unexpected.length) {
      br.unexpected.forEach((u) => console.log(`     ⛔ ${u.date} ${u.code} ${u.field} ${JSON.stringify(u.base_value)}→${JSON.stringify(u.cand_value)}`));
    }
  }
  console.log(`\n  V2-AE actual fill counts = ${JSON.stringify(out.actual_execution_branch.actual_fill_counts)}`);
  console.log(`  V1_V2_DELTA_EXPLAINED = ${out.v1_v2_delta_explained}`);

  const p = path.resolve(OUT);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  console.log(`\n  [written] ${p}`);

  if (!v1Reproducible) {
    console.log('\n  ⛔ FAIL（RFP-V1 不可复现 —— V1 anchor 被破坏）');
    process.exit(1);
  }
  const totalUnexpected = pairCF.unexpected.length + pairAE.unexpected.length;
  if (totalUnexpected > 0) {
    console.log(`\n  ⛔ FAIL（存在 ${totalUnexpected} 处 UNEXPECTED_DECISION_DELTA；`
      + '⛔ 按 owner 裁定**不得**通过扩大归因判据消除 —— 保留 fail-closed）');
    process.exit(1);
  }
  console.log('\n  ✅ PASS（V1 可复现 · 全部差异已归因 · UNEXPECTED_DECISION_DELTA = 0）');
})().catch((e) => {
  console.error(`  [FATAL] ${e && e.stack ? e.stack : e}`);
  process.exit(1);
});
