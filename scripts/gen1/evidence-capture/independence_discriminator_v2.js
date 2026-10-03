/**
 * R1 —— Evidence Event Independence Discriminator **v2**（REVISION PROPOSAL 级构件）
 * ======================================================================
 * 与 v1（`independence_discriminator.js`）的关系：
 *   · ⛔ v1 文件保持**只读**（其 sha256 已被复评报告引用）—— 本文件是**新增**的 v2。
 *   · v2 在 v1 判据之上**只增不减**：C0/C1/C2/C4a/C4b/C5/C6/C7 语义**逐字未改**；
 *     新增 **C3 candidate identity**（可判否）与 **C8 trigger 记录**（⛔ 非判据）。
 *   · 由此得到单向性质：任何在 v1 下判 `NOT_INDEPENDENT` 的对，在 v2 下**不得**变为
 *     `INDEPENDENT`（fail-closed 方向）。
 *
 * ⛔ 本文件**不复制**契约参数，只**引用**冻结值并注明条款号。
 *
 * 依据：
 *   [FROZEN] Contract v5.0（carrier 05da0efa… / blob 7f86d12a… / sha256 4fb9463f…f55b，
 *            64580 B / 1072 行）—— §3.0.1 / §3.0.2 / §3.0.3 / §3.0.4 / §3.4 / §5.4 / §5.5 / §7.1 / §7.3
 *   [PROPOSAL] GEN1_EVIDENCE_CONTRACT_REVISION_PROPOSAL_20261002.md —— §3.4A（新增独立性要求）/
 *            §5.6 revised / §5.8 revised。⛔ 提案未冻结 ⇒ 本判据为 **DRAFT**。
 *
 * 用法：
 *   node independence_discriminator_v2.js --selftest
 *   node independence_discriminator_v2.js --non-interference
 *   node independence_discriminator_v2.js --red-proof
 *   node independence_discriminator_v2.js --reverse-proof      # ★ 旧规则必须被证伪
 *   node independence_discriminator_v2.js --fixtures <path>    # 覆盖夹具路径
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------- 冻结常量
/** §3.4 冻结值。⛔ 不得在本实现里另行取值。 */
const CLUSTER_GAP_DAYS = 10;

/** §3 的 17 列（Evidence 样本字段）。 */
const EVIDENCE_COLUMNS = [
  'date', 'code', 'regime', 'stage', 'domain_status', 'probability',
  'baseline_suggested_position', 'counterfactual_suggested_position', 'delta_position',
  'forward_5d', 'forward_10d', 'forward_20d', 'MFE', 'MAE',
  'false_fast_path', 'event_cluster_id', 'independent_event'
];

/** §3.0.3 五条 AND 的键名 */
const PROMOTION_PROOF_KEYS = [
  'active_run_pointer_run_id_eq_R',
  'run_history_promoted',
  'run_history_read_after_write_consistent',
  'run_manifest_validation_passed',
  'run_manifest_revision_eq_pointer_revision'
];

const VERDICT = {
  INDEPENDENT: 'INDEPENDENT',
  NOT_INDEPENDENT: 'NOT_INDEPENDENT',
  NOT_EVALUABLE: 'NOT_EVALUABLE'
};

// ---------------------------------------------------------------- 工具
function isoDay(v) {
  const s = v == null ? '' : String(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function dayGap(a, b) {
  const da = isoDay(a), db = isoDay(b);
  if (!da || !db) return null;
  const ta = Date.parse(da + 'T00:00:00Z');
  const tb = Date.parse(db + 'T00:00:00Z');
  if (Number.isNaN(ta) || Number.isNaN(tb)) return null;
  return Math.round(Math.abs(tb - ta) / 86400000);
}

function sortedKey(o) {
  if (o === null || typeof o !== 'object') return JSON.stringify(o);
  if (Array.isArray(o)) return '[' + o.map(sortedKey).join(',') + ']';
  const ks = Object.keys(o).sort();
  return '{' + ks.map((k) => JSON.stringify(k) + ':' + sortedKey(o[k])).join(',') + '}';
}

function rowByCode(run) {
  const out = {};
  ((run && run.rows) || []).forEach((r) => { out[String(r.code)] = r; });
  return out;
}

function deltaOf(row) {
  if (!row) return null;
  if (row.delta_position != null) return Number(row.delta_position);
  const b = row.baseline_suggested_position, c = row.counterfactual_suggested_position;
  if (b == null || c == null) return null;
  return Number(c) - Number(b);                                   // §3 列 9 = 列8 − 列7
}

/** 一个「可用」的 candidate hash 映射：非空、且全部取值为非空字符串 */
function hasHashMap(m) {
  if (!m || typeof m !== 'object') return false;
  const ks = Object.keys(m);
  if (!ks.length) return false;
  return ks.every((k) => typeof m[k] === 'string' && m[k].length > 0);
}

// ---------------------------------------------------------------- 核心判据（v2）
/**
 * 两个**被采纳** run 是否构成独立 Evidence 事件。
 * ⛔ 判据顺序本身是语义的一部分（不可交换）。
 */
function decideIndependence(A, B) {
  const checks = [];
  const fail = (id, name, detail) => { checks.push({ id, name, pass: false, detail }); };
  const pass = (id, name, detail) => { checks.push({ id, name, pass: true, detail }); };

  // ---- C0 可评估性：§3.0.3 五条 AND ----
  const proofOk = (r) => {
    const p = (r && r.promotion_proof) || {};
    return PROMOTION_PROOF_KEYS.every((k) => p[k] === true);
  };
  const badProof = [A, B].filter((r) => !proofOk(r)).map((r) => r && r.run_id);
  if (badProof.length) {
    fail('C0', '§3.0.3 PROMOTION_PROOF 五条 AND 全真（两 run 均须满足）',
      '未通过者: ' + JSON.stringify(badProof));
    return { verdict: VERDICT.NOT_EVALUABLE, independent: false,
      reasons: ['PROMOTION_PROOF_FAILED'], checks, per_code: {} };
  }
  pass('C0', '§3.0.3 PROMOTION_PROOF 五条 AND 全真（两 run 均须满足）', 'A/B 各自五条全真');

  // ---- C1 运行身份：(I) RUN IDENTITY 必须不同 ----
  //      ★ 显式声明：`run_id` 互异是**必要**条件，⛔ **不充分** —— 这正是「旧规则」的错误所在。
  if (A.run_id === B.run_id) {
    fail('C1', '§3.0.1 (I) run_id 互异（**必要非充分**）', A.run_id);
    return { verdict: VERDICT.NOT_EVALUABLE, independent: false,
      reasons: ['SAME_RUN'], checks, per_code: {} };
  }
  pass('C1', '§3.0.1 (I) run_id 互异（**必要非充分** —— ⛔ 不得据此单独判独立）',
    A.run_id + ' ≠ ' + B.run_id);

  // ---- C2 bundle_key：(II) DATA DATE 互异（§5.5 ①③④）----
  const dA = isoDay(A.decision_date), dB = isoDay(B.decision_date);
  if (!dA || !dB) {
    fail('C2', '§5.5 ① bundle_key(=decision_date) 可得', 'A=' + dA + ' / B=' + dB);
    return { verdict: VERDICT.NOT_EVALUABLE, independent: false,
      reasons: ['DECISION_DATE_UNAVAILABLE'], checks, per_code: {} };
  }
  if (dA === dB) {
    fail('C2', '§5.5 ①③④ 两个 run 的 decision_date 互异（同一数据日至多一个 bundle）',
      'A=' + dA + ' / B=' + dB + ' ⇒ 同一 decision_date 的第二个 promoted run '
      + '既不可能成为第二个 bundle，也不构成独立事件');
    return { verdict: VERDICT.NOT_INDEPENDENT, independent: false,
      reasons: ['SAME_DECISION_DATE_BUNDLE_KEY_COLLISION'], checks, per_code: {} };
  }
  pass('C2', '§5.5 ①③④ 两个 run 的 decision_date 互异（同一数据日至多一个 bundle）',
    'A=' + dA + ' / B=' + dB);

  // ---- C4 输入侧 provenance ----
  const provA = A.source_raw_sha256, provB = B.source_raw_sha256;
  const hasProv = (p) => p && typeof p === 'object' && Object.keys(p).length > 0;
  if (!hasProv(provA) || !hasProv(provB)) {
    fail('C4a', '输入侧逐源 raw SHA256 可得（两 run 均须非空）',
      'A keys=' + JSON.stringify(provA ? Object.keys(provA) : null)
      + ' / B keys=' + JSON.stringify(provB ? Object.keys(provB) : null)
      + ' ⇒ 无输入侧证据 ⇒ ⛔ 不得据 run 轴差异反推「独立输入」');
    return { verdict: VERDICT.NOT_EVALUABLE, independent: false,
      reasons: ['INPUT_PROVENANCE_UNAVAILABLE'], checks, per_code: {} };
  }
  pass('C4a', '输入侧逐源 raw SHA256 可得（两 run 均须非空）',
    'A keys=' + JSON.stringify(Object.keys(provA))
    + ' / B keys=' + JSON.stringify(Object.keys(provB)));
  const provOf = (r) => ({
    expected_codes: (r.expected_codes || []).slice().sort(),
    source_raw_sha256: r.source_raw_sha256 || null
  });
  const pA = provOf(A), pB = provOf(B);
  if (sortedKey(pA) === sortedKey(pB)) {
    fail('C4b', '输入侧逐源 raw SHA256 + expected_codes 互异（防御性；实践中由 C2 蕴含）',
      'provenance 全等 ⇒ 同一次输入状态');
    return { verdict: VERDICT.NOT_INDEPENDENT, independent: false,
      reasons: ['SAME_INPUT_PROVENANCE'], checks, per_code: {} };
  }
  pass('C4b', '输入侧逐源 raw SHA256 + expected_codes 互异（防御性；实践中由 C2 蕴含）',
    'A keys=' + JSON.stringify(Object.keys(provA))
    + ' / B keys=' + JSON.stringify(Object.keys(provB)));

  // ---- C3（★ v2 新增）candidate identity ----
  //  条款依据：§3.0.1（身份量互不替代）+ §3.0.4（行键含 run_id）+ §3.4A（revised，联合判据）
  //  判据：两 run 若**各自携带**可用的逐 code `gen1_candidate_hash`
  //        且两份映射**深等** ⇒ 同一 candidate content ⇒ ⛔ 不构成两个独立事件。
  //  ⚠️ 诚实声明：一侧缺载 ⇒ **不可比** ⇒ 记录为 incomparable，⛔ **不得**据此判否
  //    （真实态即如此：22:00 run 的 hash = null）。
  const hashA = A.candidate_hashes_by_code, hashB = B.candidate_hashes_by_code;
  if (hasHashMap(hashA) && hasHashMap(hashB)) {
    if (sortedKey(hashA) === sortedKey(hashB)) {
      fail('C3', '§3.4A candidate identity 互异（逐 code `gen1_candidate_hash` 不得全等）',
        '两侧 candidate hash 映射深等（' + Object.keys(hashA).length + ' codes）'
        + ' ⇒ 同一 candidate content 的两个 run ⇒ 同一次输入状态的重述');
      return { verdict: VERDICT.NOT_INDEPENDENT, independent: false,
        reasons: ['SAME_CANDIDATE_IDENTITY'], checks, per_code: {} };
    }
    pass('C3', '§3.4A candidate identity 互异（逐 code `gen1_candidate_hash` 不得全等）',
      '两侧 hash 映射可比且不同');
  } else {
    pass('C3', '§3.4A candidate identity（不可比时仅记录，⛔ 不得判否）',
      'CANDIDATE_IDENTITY_INCOMPARABLE：A=' + (hasHashMap(hashA) ? 'present' : 'absent')
      + ' / B=' + (hasHashMap(hashB) ? 'present' : 'absent'));
  }

  // ---- C5 payload 诊断（⛔ 不否决）----
  const ra = rowByCode(A), rb = rowByCode(B);
  const commonCodes = Object.keys(ra).filter((c) => rb[c]).sort();
  const payloadOnly = (row) => {
    const o = {};
    EVIDENCE_COLUMNS.filter((k) => k !== 'date').forEach((k) => { o[k] = row[k]; });
    o.code = row.code;
    return sortedKey(o);
  };
  const payloadIdentical = commonCodes.length > 0
    && commonCodes.every((c) => payloadOnly(ra[c]) === payloadOnly(rb[c]));
  pass('C5', '（诊断，非否决）跨数据日的 decision payload 是否逐字相同',
    'common_codes=' + commonCodes.length + ' / payload_identical=' + payloadIdentical);

  // ---- C6 §3.4 事件簇 ----
  const gap = dayGap(dA, dB);
  if (!(commonCodes.length > 0)) {
    fail('C6', '§3.4 两 run 存在共同 code（聚类按 code 进行）', 'common_codes=0');
    return { verdict: VERDICT.NOT_EVALUABLE, independent: false,
      reasons: ['NO_COMMON_CODE'], checks, per_code: {} };
  }
  if (gap == null) {
    fail('C6', '§3.4 跨簇（同 code 间隔 > ' + CLUSTER_GAP_DAYS + ' 天）', 'gap 不可计算');
    return { verdict: VERDICT.NOT_EVALUABLE, independent: false,
      reasons: ['GAP_UNAVAILABLE'], checks, per_code: {} };
  }
  if (gap <= CLUSTER_GAP_DAYS) {
    fail('C6', '§3.4 跨簇（同 code 间隔 > ' + CLUSTER_GAP_DAYS + ' 天）',
      '间隔 ' + gap + ' 天 <= ' + CLUSTER_GAP_DAYS + ' ⇒ 同簇 ⇒ 簇内仅首个 delta≠0 行可独立 '
      + '⇒ 两者**不可能**同时为独立事件');
    return { verdict: VERDICT.NOT_INDEPENDENT, independent: false,
      reasons: ['SAME_EVENT_CLUSTER'], checks, per_code: {} };
  }
  pass('C6', '§3.4 跨簇（同 code 间隔 > ' + CLUSTER_GAP_DAYS + ' 天）',
    '间隔 ' + gap + ' 天 > ' + CLUSTER_GAP_DAYS + ' ⇒ 不同簇');

  // ---- C7 §3.4/§7.3：两 run **各自**至少一码 delta_position != 0（必要条件）----
  const perCode = {};
  const infA = [], infB = [];
  commonCodes.forEach((c) => {
    const da = deltaOf(ra[c]), db = deltaOf(rb[c]);
    const ia = da !== 0 && da != null;
    const ib = db !== 0 && db != null;
    if (ia) infA.push(c);
    if (ib) infB.push(c);
    perCode[c] = { gap_days: gap, A_delta_position: da, B_delta_position: db,
      A_informative: ia, B_informative: ib };
  });
  if (!infA.length || !infB.length) {
    fail('C7', '§3.4/§7.3 两 run 各自至少一个 code 的 delta_position != 0（必要条件）',
      'A 有信息量 code=' + JSON.stringify(infA) + ' / B=' + JSON.stringify(infB)
      + ' ⇒ 该 run 的**任何**行都不可能带 independent_event=true');
    return { verdict: VERDICT.NOT_INDEPENDENT, independent: false,
      reasons: ['NO_INFORMATIVE_ROW'], checks, per_code: perCode };
  }
  pass('C7', '§3.4/§7.3 两 run 各自至少一个 code 的 delta_position != 0（必要条件）',
    'A=' + JSON.stringify(infA) + ' / B=' + JSON.stringify(infB));

  // ---- C8（★ v2 新增）trigger —— **记录项，⛔ 非判据** ----
  const trig = { A: A.trigger == null ? null : String(A.trigger),
    B: B.trigger == null ? null : String(B.trigger) };
  pass('C8', '§5.6 revised：记录两 run 的 trigger（⛔ **不得**作为独立性判据）',
    'A=' + JSON.stringify(trig.A) + ' / B=' + JSON.stringify(trig.B)
    + ' ⇒ trigger 差异**不**使结论翻为 INDEPENDENT（--non-interference 自证）');

  return { verdict: VERDICT.INDEPENDENT, independent: true,
    reasons: ['CROSS_CLUSTER_AND_BOTH_INFORMATIVE'],
    sufficiency_scope: 'NECESSARY_CONDITIONS_ONLY',
    sufficiency_note: '充分性还要求两者分别是其所在簇内**首个** delta≠0 行，'
      + '该性质需全表簇上下文（§3.4 ②），⛔ 不可由一对 run 判定',
    trigger_record: trig,
    checks, per_code: perCode };
}

// ---------------------------------------------------------------- ★ 旧规则（用于反向证明）
/**
 * 「旧规则」= 把 `run_id` 不同当作独立的**充分**条件。
 * ⛔ 本函数**仅供反向证明**（证明该规则会被现实反例证伪）；⛔ 任何生产/契约路径不得调用。
 */
function legacyDecideIndependence(A, B) {
  const proofOk = (r) => {
    const p = (r && r.promotion_proof) || {};
    return PROMOTION_PROOF_KEYS.every((k) => p[k] === true);
  };
  if (!proofOk(A) || !proofOk(B)) {
    return { verdict: VERDICT.NOT_EVALUABLE, reasons: ['LEGACY_PROMOTION_PROOF_FAILED'] };
  }
  if (A.run_id !== B.run_id) {
    return { verdict: VERDICT.INDEPENDENT, reasons: ['LEGACY_RUN_ID_DIFFERS'] };
  }
  return { verdict: VERDICT.NOT_INDEPENDENT, reasons: ['LEGACY_SAME_RUN'] };
}

// ---------------------------------------------------------------- 自证
const HERE = __dirname;
const DEFAULT_FIXTURE = path.join(HERE, 'fixtures', 'r1_independence_cases_v2.json');
let FIXTURE = DEFAULT_FIXTURE;

function loadCases() {
  return JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
}

function pad(s, n) {
  const t = String(s);
  return t.length >= n ? t : t + ' '.repeat(n - t.length);
}

function selftest() {
  const fx = loadCases();
  let ok = 0, bad = 0;
  console.log('== R1-v2 独立性判据 自证（fixtures: %s）==', path.basename(FIXTURE));
  console.log('   契约冻结值: CLUSTER_GAP_DAYS=%d / Evidence 列数=%d / PROMOTION_PROOF 条数=%d',
    CLUSTER_GAP_DAYS, EVIDENCE_COLUMNS.length, PROMOTION_PROOF_KEYS.length);
  console.log('   提案绑定: %s（%s）',
    fx.contract_binding.proposal.path, fx.contract_binding.proposal.status);
  fx.cases.forEach((c) => {
    const got = decideIndependence(c.A, c.B);
    const hit = got.verdict === c.expect.verdict
      && c.expect.reasons.every((r) => got.reasons.indexOf(r) >= 0);
    if (hit) ok += 1; else bad += 1;
    console.log('  [%s] %s expect=%s got=%s %s',
      hit ? 'PASS' : 'FAIL', pad(c.id, 16), pad(c.expect.verdict, 15),
      pad(got.verdict, 15), JSON.stringify(got.reasons));
    if (!hit) console.log('        expect reasons=%s / got=%s',
      JSON.stringify(c.expect.reasons), JSON.stringify(got.reasons));
  });
  console.log('  ---------- %d passed / %d failed ----------', ok, bad);
  return bad === 0;
}

/**
 * 非干预自证：注入**非判据**字段 ⇒ 结论必须**逐字不变**。
 * ★ 本次新增断言：`trigger` 注入后结论不变 ⇒ 证明 C8 是记录项、⛔ 非判据。
 */
function nonInterference() {
  const fx = loadCases();
  const FORBIDDEN = ['trigger', 'candidate_content_sha', 'pointer_revision',
    'input_hash', 'event_id', 'promotion_attempt', 'engine_version'];
  console.log('== R1-v2 判据 非干预自证（非判据字段注入 ⇒ 结论必须不变）==');
  console.log('   注入字段: %s', JSON.stringify(FORBIDDEN));
  let ok = 0, bad = 0;
  fx.cases.forEach((c) => {
    const base = decideIndependence(c.A, c.B);
    const A2 = JSON.parse(JSON.stringify(c.A));
    const B2 = JSON.parse(JSON.stringify(c.B));
    [A2, B2].forEach((r, idx) => {
      FORBIDDEN.forEach((k, i) => { r[k] = 'INJECTED-' + k + '-' + i + '-' + idx; });
    });
    const got = decideIndependence(A2, B2);
    const same = got.verdict === base.verdict
      && JSON.stringify(got.reasons) === JSON.stringify(base.reasons);
    if (same) ok += 1; else bad += 1;
    console.log('  [%s] %s base=%s injected=%s',
      same ? 'PASS' : 'FAIL', pad(c.id, 16), pad(base.verdict, 15), pad(got.verdict, 15));
  });
  console.log('  ---------- %d passed / %d failed ----------', ok, bad);
  return bad === 0;
}

function evalModule(src) {
  const m = { exports: {} };
  const fn = new Function('module', 'exports', 'require', '__dirname', '__filename', src);
  fn(m, m.exports, require, HERE, __filename);
  return m.exports;
}

/** 打红自证：变异 ⇒ 目标判据必须翻转；逐条还原 ⇒ 复原 */
function redProof() {
  const fx = loadCases();
  const byId = {};
  fx.cases.forEach((c) => { byId[c.id] = c; });
  const out = [];
  const src0 = fs.readFileSync(__filename, 'utf8');

  {
    const mutated = evalModule(src0.replace(
      'if (dA === dB) {',
      'if (false && dA === dB) {   /* RED-PROOF MUTANT: C2 disabled */'));
    const r = mutated.decideIndependence(byId['NEG-FWD-1'].A, byId['NEG-FWD-1'].B);
    out.push({ id: 'RP1a', name: '只屏蔽 C2（bundle_key 同一性）⇒ 结论仍不独立，理由换手到 C6',
      target_case: 'NEG-FWD-1',
      before_verdict: 'NOT_INDEPENDENT / SAME_DECISION_DATE_BUNDLE_KEY_COLLISION',
      after_verdict: r.verdict + ' / ' + JSON.stringify(r.reasons),
      flipped: r.verdict === 'NOT_INDEPENDENT' && r.reasons.indexOf('SAME_EVENT_CLUSTER') >= 0 });
  }
  {
    const mutated = evalModule(src0
      .replace('if (dA === dB) {',
        'if (false && dA === dB) {   /* RED-PROOF MUTANT: C2 disabled */')
      .replace('if (gap <= CLUSTER_GAP_DAYS) {',
        'if (false && gap <= CLUSTER_GAP_DAYS) {   /* RED-PROOF MUTANT: C6 disabled */'));
    const r = mutated.decideIndependence(byId['NEG-FWD-1'].A, byId['NEG-FWD-1'].B);
    out.push({ id: 'RP1b', name: '同时屏蔽 C2 + C6 ⇒ 残差换手到 C7（第三条独立护栏）',
      target_case: 'NEG-FWD-1',
      before_verdict: 'NOT_INDEPENDENT / [SAME_DECISION_DATE_BUNDLE_KEY_COLLISION]',
      after_verdict: r.verdict + ' / ' + JSON.stringify(r.reasons),
      flipped: r.verdict === 'NOT_INDEPENDENT' && r.reasons.indexOf('NO_INFORMATIVE_ROW') >= 0 });
  }
  {
    const mutated = evalModule(src0
      .replace('if (dA === dB) {',
        'if (false && dA === dB) {   /* RED-PROOF MUTANT: C2 disabled */')
      .replace('if (gap <= CLUSTER_GAP_DAYS) {',
        'if (false && gap <= CLUSTER_GAP_DAYS) {   /* RED-PROOF MUTANT: C6 disabled */'));
    const A = JSON.parse(JSON.stringify(byId['POS-1'].A));
    const B = JSON.parse(JSON.stringify(byId['POS-1'].A));
    B.run_id = 'engine:2026-09-30:INFORMATIVE-TWIN';
    B.source_raw_sha256 = { 'runtime_status@capture': 'TWIN-DIFFERENT' };
    const r = mutated.decideIndependence(A, B);
    out.push({ id: 'RP1c', name: '屏蔽 C2 + C6 且两侧 delta 非零 ⇒ 同数据日一对 run 翻为 INDEPENDENT',
      target_case: 'POS-1.A 的同数据日孪生（run_id 改写）',
      before_verdict: '（基线判据下为 NOT_INDEPENDENT）',
      after_verdict: r.verdict + ' / ' + JSON.stringify(r.reasons),
      flipped: r.verdict === 'INDEPENDENT' });
  }
  {
    const mutated = evalModule(src0.replace('const CLUSTER_GAP_DAYS = 10;',
      'const CLUSTER_GAP_DAYS = 0;   /* RED-PROOF MUTANT */'));
    const r = mutated.decideIndependence(byId['NEG-CLUSTER-1'].A, byId['NEG-CLUSTER-1'].B);
    out.push({ id: 'RP2', name: 'CLUSTER_GAP_DAYS := 0', target_case: 'NEG-CLUSTER-1',
      before_verdict: 'NOT_INDEPENDENT', after_verdict: r.verdict,
      flipped: r.verdict === 'INDEPENDENT' });
  }
  {
    const c = byId['NEG-PROOF-1'];
    const B2 = JSON.parse(JSON.stringify(c.B));
    PROMOTION_PROOF_KEYS.forEach((k) => { B2.promotion_proof[k] = true; });
    const raw = decideIndependence(c.A, c.B);
    const unmasked = decideIndependence(c.A, B2);
    out.push({ id: 'RP3', name: '解除真实 08:00 run 的 promotion 失败（= V3.6.6 部署后的状态）',
      target_case: 'NEG-PROOF-1（两条**实读** run）',
      before_verdict: raw.verdict, after_verdict: unmasked.verdict,
      flipped: raw.verdict === 'NOT_EVALUABLE' && unmasked.verdict === 'NOT_INDEPENDENT'
        && unmasked.reasons.indexOf('SAME_DECISION_DATE_BUNDLE_KEY_COLLISION') >= 0 });
  }
  {
    const A = JSON.parse(JSON.stringify(byId['POS-1'].A));
    A.source_raw_sha256 = {};
    const r = decideIndependence(A, byId['POS-1'].B);
    out.push({ id: 'RP5', name: '输入侧 provenance 缺载 ⇒ C4a（可得性）必须否决',
      target_case: 'POS-1.A（provenance 清空）',
      before_verdict: 'INDEPENDENT',
      after_verdict: r.verdict + ' / ' + JSON.stringify(r.reasons),
      flipped: r.verdict === 'NOT_EVALUABLE'
        && r.reasons.indexOf('INPUT_PROVENANCE_UNAVAILABLE') >= 0 });
  }
  // ★ RP6（v2 新增）—— C3 candidate identity 必须承重
  {
    const baseline = decideIndependence(byId['NEG-CANDSHA-1'].A, byId['NEG-CANDSHA-1'].B);
    const mutated = evalModule(src0.replace(
      '  if (hasHashMap(hashA) && hasHashMap(hashB)) {',
      '  if (false) {   /* RED-PROOF MUTANT: C3 disabled */'));
    const r = mutated.decideIndependence(byId['NEG-CANDSHA-1'].A, byId['NEG-CANDSHA-1'].B);
    out.push({ id: 'RP6', name: '屏蔽 C3（candidate identity）⇒ 同 candidate 的跨日一对翻为 INDEPENDENT',
      target_case: 'NEG-CANDSHA-1',
      before_verdict: baseline.verdict + ' / ' + JSON.stringify(baseline.reasons),
      after_verdict: r.verdict + ' / ' + JSON.stringify(r.reasons),
      flipped: baseline.verdict === 'NOT_INDEPENDENT'
        && r.verdict === 'INDEPENDENT' });
  }
  // ★ RP7（v2 新增）—— trigger 记录项不得影响结论
  {
    const a = JSON.parse(JSON.stringify(byId['POS-1'].A));
    const b = JSON.parse(JSON.stringify(byId['POS-1'].B));
    a.trigger = 'SOME-UNREGISTERED-TRIGGER'; b.trigger = null;
    const r = decideIndependence(a, b);
    const base = decideIndependence(byId['POS-1'].A, byId['POS-1'].B);
    out.push({ id: 'RP7', name: '把 trigger 改成未登记值 / 置空 ⇒ 结论必须逐字不变（证明 C8 非判据）',
      target_case: 'POS-1',
      before_verdict: base.verdict + ' / ' + JSON.stringify(base.reasons),
      after_verdict: r.verdict + ' / ' + JSON.stringify(r.reasons),
      flipped: r.verdict === base.verdict
        && JSON.stringify(r.reasons) === JSON.stringify(base.reasons) });
  }
  // RP4 逐字节还原
  {
    const restored = evalModule(src0);
    const r4 = restored.decideIndependence(byId['NEG-FWD-1'].A, byId['NEG-FWD-1'].B);
    out.push({ id: 'RP4', name: '逐字节还原后 判据复原', target_case: 'NEG-FWD-1',
      before_verdict: 'NOT_INDEPENDENT', after_verdict: r4.verdict,
      flipped: r4.verdict === 'NOT_INDEPENDENT' });
  }

  console.log('== R1-v2 判据 打红自证（变异 ⇒ 必翻转 ⇒ 还原 ⇒ 必复原）==');
  let all = true;
  out.forEach((o) => {
    if (!o.flipped) all = false;
    console.log('  [%s] %s · %s', o.flipped ? 'PASS' : 'FAIL', o.id, o.name);
    console.log('         case=%s  %s → %s', o.target_case, o.before_verdict, o.after_verdict);
  });
  console.log('  ---------- RED_PROOF = %s ----------', all ? 'PASS' : 'FAIL');
  return all;
}

/**
 * ★ 反向证明（owner §9）：证明**旧假设会失败**，即修订不是为了「改规则让测试变绿」。
 *  旧规则 = `run_id` 不同 ⇒ independent。
 *  对每一个「标准判据判 NOT_INDEPENDENT」的对施加旧规则：
 *    若旧规则给出 INDEPENDENT ⇒ 旧规则**被证伪**（falsified）。
 */
function reverseProof() {
  const fx = loadCases();
  const targets = ['NEG-FWD-1', 'NEG-CANDSHA-1', 'NEG-PROOF-1-POST-V366'];
  const byId = {};
  fx.cases.forEach((c) => { byId[c.id] = c; });

  // 额外构造：真实 08:00 run 解除 promotion 失败（= V3.6.6 部署后）
  const live = byId['NEG-PROOF-1'];
  const liveB = JSON.parse(JSON.stringify(live.B));
  PROMOTION_PROOF_KEYS.forEach((k) => { liveB.promotion_proof[k] = true; });
  const post = { A: live.A, B: liveB };

  const rows = [];
  targets.forEach((id) => {
    let pair, label;
    if (id === 'NEG-PROOF-1-POST-V366') {
      pair = post; label = 'NEG-PROOF-1 解除 B 的 promotion 失败（V3.6.6 部署后）';
    } else {
      pair = byId[id]; label = id;
    }
    if (!pair) return;
    const correct = decideIndependence(pair.A, pair.B);
    const legacy = legacyDecideIndependence(pair.A, pair.B);
    rows.push({
      case: label,
      run_ids: pair.A.run_id + '  vs  ' + pair.B.run_id,
      revised_verdict: correct.verdict + ' / ' + JSON.stringify(correct.reasons),
      legacy_verdict: legacy.verdict + ' / ' + JSON.stringify(legacy.reasons),
      legacy_falsified: legacy.verdict === 'INDEPENDENT'
        && correct.verdict === 'NOT_INDEPENDENT'
    });
  });

  console.log('== R1-v2 反向证明：旧规则（run_id 不同 ⇒ independent）必须被反例证伪 ==');
  let all = true;
  rows.forEach((r) => {
    if (!r.legacy_falsified) all = false;
    console.log('  [%s] %s', r.legacy_falsified ? 'PASS' : 'FAIL', r.case);
    console.log('         run_ids = %s', r.run_ids);
    console.log('         标准判据  = %s', r.revised_verdict);
    console.log('         旧规则    = %s   ⇒ %s', r.legacy_verdict,
      r.legacy_falsified ? 'FALSIFIED（旧规则错）' : '未被证伪（!!）');
  });
  console.log('  ---------- LEGACY_RULE_FALSIFIED = %s ----------', all ? 'PASS' : 'FAIL');
  return all;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const fi = args.indexOf('--fixtures');
  if (fi >= 0 && args[fi + 1]) FIXTURE = path.resolve(args[fi + 1]);
  let ok = true;
  const want = (f) => args.indexOf(f) >= 0;
  if (args.length === 0 || want('--selftest')) ok = selftest() && ok;
  if (want('--non-interference')) ok = nonInterference() && ok;
  if (want('--red-proof')) ok = redProof() && ok;
  if (want('--reverse-proof')) ok = reverseProof() && ok;
  process.exit(ok ? 0 : 1);
}

module.exports = {
  CLUSTER_GAP_DAYS,
  EVIDENCE_COLUMNS,
  PROMOTION_PROOF_KEYS,
  VERDICT,
  dayGap,
  hasHashMap,
  decideIndependence,
  legacyDecideIndependence
};
