/**
 * R1 —— Evidence Event Independence Discriminator
 * ======================================================================
 * 目的：把 Gen-1 Evidence Contract v5.0 里「两个被采纳 run 是否构成**独立** Evidence 事件」
 *       从**文字声明**变成**可执行、可打红的纯判据**。
 *
 * ⛔ 本文件**不复制**契约的参数定义，只**引用**冻结值并注明条款号；
 *    若契约变更，本文件的常量必须先于实现同步（否则判据与契约不同源）。
 *
 * 冻结依据（Contract v5.0 FROZEN，carrier 05da0efa… / blob 7f86d12a… /
 *          content sha256 4fb9463f…f55b，64580 B）：
 *   §3.0.1  三个身份量（I RUN IDENTITY / II DATA DATE / III RUN DATE）不得互换
 *   §3.0.3  PROMOTION_PROOF = 五条 AND，缺一即 fail-closed
 *   §3.0.4  sample_key = run_id::code ; bundle_key = decision_date
 *   §3.4    CLUSTER_GAP_DAYS = 10；同 code 间隔 <= 10 天 ⇒ 同簇；
 *           每簇内**首个 delta_position != 0 的行**独立；对照行恒 false
 *   §5.5    ① 同一 decision_date 至多一个正式 bundle；③ 后到者 NON-SCORING；
 *           ④ 新 bundle 的 decision_date 必须**严格大于**上一已接受 bundle
 *   §7.3    Q1 denominator = independent_event = true AND delta_position != 0
 *
 * ⛔ 判据顺序本身是语义的一部分（不可交换）：可评估性 → 身份 → bundle_key →
 *    provenance → 簇。详见 checks[]。
 *
 * 用法：
 *   node independence_discriminator.js --selftest     # 跑夹具，断言全部期望
 *   node independence_discriminator.js --red-proof    # 变异打红自证
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------- 冻结常量
/** §3.4 冻结值。⛔ 不得在本实现里另行取值。 */
const CLUSTER_GAP_DAYS = 10;

/** §3 的 17 列（Evidence 样本字段）。用于内容同一性比较与 payload 诊断。 */
const EVIDENCE_COLUMNS = [
  'date', 'code', 'regime', 'stage', 'domain_status', 'probability',
  'baseline_suggested_position', 'counterfactual_suggested_position', 'delta_position',
  'forward_5d', 'forward_10d', 'forward_20d', 'MFE', 'MAE',
  'false_fast_path', 'event_cluster_id', 'independent_event'
];

/** §3.0.3 五条 AND 的键名（与契约逐条对应） */
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

/** 自然日差（日历日）。⛔ 与 §3.4 的「天」同口径（自然日）。 */
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
  (run && run.rows || []).forEach((r) => { out[String(r.code)] = r; });
  return out;
}

function deltaOf(row) {
  if (!row) return null;
  if (row.delta_position != null) return Number(row.delta_position);
  const b = row.baseline_suggested_position, c = row.counterfactual_suggested_position;
  if (b == null || c == null) return null;
  return Number(c) - Number(b);                                   // §3 列 9 = 列8 − 列7
}

/**
 * 核心判据：两个**被采纳** run 是否构成独立 Evidence 事件。
 *
 * @param {object} A 运行描述符（见 fixtures 结构）
 * @param {object} B 运行描述符
 * @returns {{verdict:string, independent:boolean, reasons:string[], checks:object[], per_code:object}}
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
  pass('C0', '§3.0.3 PROMOTION_PROOF 五条 AND 全真（两 run 均须满足）',
    'A/B 各自五条全真');

  // ---- C1 运行身份：(I) RUN IDENTITY 必须不同 ----
  if (A.run_id === B.run_id) {
    fail('C1', '§3.0.1 (I) run_id 互异（同一 run 不构成两个事件）', A.run_id);
    return { verdict: VERDICT.NOT_EVALUABLE, independent: false,
      reasons: ['SAME_RUN'], checks, per_code: {} };
  }
  pass('C1', '§3.0.1 (I) run_id 互异（同一 run 不构成两个事件）',
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

  // ---- C4 输入侧 provenance：**可得性**（有判别力）+ **同一性**（防御性）----
  //      ⚠️ 口径：只比输入侧（逐源 raw SHA256 + expected_codes）。
  //      ⛔ 不含 `data_date` —— 那是 C2 的职责（§5.4 规则 7 强制 data_date == decision_date）。
  //      ⚠️ 诚实声明：因 bundle 的八源中 6 源是 run 轴（逐 run 必不同），
  //         「同一性」分支在合规 bundle 上**不可能独立触发** ⇒ 其真实判别力在**可得性**分支。
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

  // ---- C5 payload 诊断（⛔ 不否决；见报告 §3 说明：全 17 列含 date ⇒ 被 C2 蕴含）----
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

  // ---- C6 §3.4 事件簇：同 code 间隔 <= CLUSTER_GAP_DAYS ⇒ 同簇 ⇒ 至多一个独立事件 ----
  //      ⛔ 这是**唯一决定性**的否决（同簇内**必然**不可能两者同时 independent_event=true）
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

  // ---- C7 §3.4/§7.3：两 run **各自**至少一个 code 的 delta_position != 0 ----
  //      ⚠️ 这是**必要**条件，⛔ **非**充分条件：某 run 要真正成为其簇的独立行，
  //         还须是**该簇内首个** delta≠0 行 —— 该性质需**全表簇上下文**，
  //         无法由「一对 run」判定 ⇒ 本判据在结论里显式声明 `sufficiency_scope`。
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

  return { verdict: VERDICT.INDEPENDENT, independent: true,
    reasons: ['CROSS_CLUSTER_AND_BOTH_INFORMATIVE'],
    sufficiency_scope: 'NECESSARY_CONDITIONS_ONLY',
    sufficiency_note: '充分性还要求两者分别是其所在簇内**首个** delta≠0 行，'
      + '该性质需全表簇上下文（§3.4 ②），⛔ 不可由一对 run 判定',
    checks, per_code: perCode };
}

// ---------------------------------------------------------------- 自证
const HERE = __dirname;
const FIXTURE = path.join(HERE, 'fixtures', 'r1_independence_cases.json');

function loadCases() {
  return JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
}

/** ⚠️ Node 的 console.log **不支持** `%-14s` 宽度说明符 ⇒ 自行补齐（否则原样打印） */
function pad(s, n) {
  const t = String(s);
  return t.length >= n ? t : t + ' '.repeat(n - t.length);
}

function selftest() {
  const fx = loadCases();
  let ok = 0, bad = 0;
  console.log('== R1 独立性判据 自证（fixtures: %s）==', path.basename(FIXTURE));
  console.log('   契约冻结值: CLUSTER_GAP_DAYS=%d / Evidence 列数=%d / PROMOTION_PROOF 条数=%d',
    CLUSTER_GAP_DAYS, EVIDENCE_COLUMNS.length, PROMOTION_PROOF_KEYS.length);
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

/** 打红自证：变异 ⇒ 目标判据必须翻转；逐条还原 ⇒ 复原 */
function redProof() {
  const fx = loadCases();
  const byId = {};
  fx.cases.forEach((c) => { byId[c.id] = c; });
  const out = [];

  // RP1a —— 只屏蔽 C2 ⇒ **verdict 不变但 reasons 换手**（证明 C2/C6 互为冗余护栏）
  {
    const src = fs.readFileSync(__filename, 'utf8');
    const mutate = src.replace(
      'if (dA === dB) {',
      'if (false && dA === dB) {   /* RED-PROOF MUTANT: C2 disabled */');
    const mutated = evalModule(mutate);
    const r = mutated.decideIndependence(byId['NEG-FWD-1'].A, byId['NEG-FWD-1'].B);
    out.push({
      id: 'RP1a',
      name: '只屏蔽 C2（bundle_key 同一性）⇒ 结论仍不独立，但理由换手到 C6',
      target_case: 'NEG-FWD-1',
      before_verdict: 'NOT_INDEPENDENT / SAME_DECISION_DATE_BUNDLE_KEY_COLLISION',
      after_verdict: r.verdict + ' / ' + JSON.stringify(r.reasons),
      flipped: r.verdict === 'NOT_INDEPENDENT'
        && r.reasons.indexOf('SAME_EVENT_CLUSTER') >= 0
    });
  }

  // RP1b —— 同时屏蔽 C2 **与** C6 ⇒ 残差必须换手到 C7（证明三条护栏**逐层**拦截）
  {
    const src = fs.readFileSync(__filename, 'utf8');
    const mutated = evalModule(src
      .replace('if (dA === dB) {',
        'if (false && dA === dB) {   /* RED-PROOF MUTANT: C2 disabled */')
      .replace('if (gap <= CLUSTER_GAP_DAYS) {',
        'if (false && gap <= CLUSTER_GAP_DAYS) {   /* RED-PROOF MUTANT: C6 disabled */'));
    const r = mutated.decideIndependence(byId['NEG-FWD-1'].A, byId['NEG-FWD-1'].B);
    out.push({
      id: 'RP1b',
      name: '同时屏蔽 C2 + C6 ⇒ 残差换手到 C7（第三条独立护栏）',
      target_case: 'NEG-FWD-1',
      before_verdict: 'NOT_INDEPENDENT / [SAME_DECISION_DATE_BUNDLE_KEY_COLLISION]',
      after_verdict: r.verdict + ' / ' + JSON.stringify(r.reasons),
      flipped: r.verdict === 'NOT_INDEPENDENT'
        && r.reasons.indexOf('NO_INFORMATIVE_ROW') >= 0
    });
  }

  // RP1c —— 屏蔽 C2 + C6 **且**两侧 delta 非零 ⇒ 必须翻为 INDEPENDENT（三条护栏全承重）
  {
    const src = fs.readFileSync(__filename, 'utf8');
    const mutated = evalModule(src
      .replace('if (dA === dB) {',
        'if (false && dA === dB) {   /* RED-PROOF MUTANT: C2 disabled */')
      .replace('if (gap <= CLUSTER_GAP_DAYS) {',
        'if (false && gap <= CLUSTER_GAP_DAYS) {   /* RED-PROOF MUTANT: C6 disabled */'));
    const A = JSON.parse(JSON.stringify(byId['POS-1'].A));           // informative，date 09-30
    const B = JSON.parse(JSON.stringify(byId['POS-1'].A));
    B.run_id = 'engine:2026-09-30:INFORMATIVE-TWIN';
    B.source_raw_sha256 = { 'runtime_status@capture': 'TWIN-DIFFERENT' };
    const r = mutated.decideIndependence(A, B);
    out.push({
      id: 'RP1c',
      name: '屏蔽 C2 + C6 且两侧 delta 非零 ⇒ 同数据日一对 run 翻为 INDEPENDENT',
      target_case: 'POS-1.A 的同数据日孪生（run_id 改写）',
      before_verdict: '（基线判据下为 NOT_INDEPENDENT）',
      after_verdict: r.verdict + ' / ' + JSON.stringify(r.reasons),
      flipped: r.verdict === 'INDEPENDENT'
    });
  }

  // RP2 —— 把 CLUSTER_GAP_DAYS 置 0 ⇒ NEG-CLUSTER-1（gap 恰 10）必须翻为 INDEPENDENT
  {
    const src = fs.readFileSync(__filename, 'utf8');
    const mutate = src.replace('const CLUSTER_GAP_DAYS = 10;',
      'const CLUSTER_GAP_DAYS = 0;   /* RED-PROOF MUTANT */');
    const mutated = evalModule(mutate);
    const r = mutated.decideIndependence(byId['NEG-CLUSTER-1'].A, byId['NEG-CLUSTER-1'].B);
    out.push({
      id: 'RP2',
      name: 'CLUSTER_GAP_DAYS := 0',
      target_case: 'NEG-CLUSTER-1',
      before_verdict: 'NOT_INDEPENDENT',
      after_verdict: r.verdict,
      flipped: r.verdict === 'INDEPENDENT'
    });
  }

  // RP3 ★ —— 解除 NEG-PROOF-1 里 B 的 promotion 失败（即「V3.6.6 部署后 08:00 可提升」）
  //            ⇒ 该**真实存在**的一对 run 必须立刻暴露为 SAME_DECISION_DATE 冲突
  {
    const c = byId['NEG-PROOF-1'];
    const B2 = JSON.parse(JSON.stringify(c.B));
    PROMOTION_PROOF_KEYS.forEach((k) => { B2.promotion_proof[k] = true; });
    const raw = decideIndependence(c.A, c.B);
    const unmasked = decideIndependence(c.A, B2);
    out.push({
      id: 'RP3',
      name: '解除真实 08:00 run 的 promotion 失败（= V3.6.6 部署后的状态）',
      target_case: 'NEG-PROOF-1（两条**实读** run）',
      before_verdict: raw.verdict,
      after_verdict: unmasked.verdict,
      flipped: raw.verdict === 'NOT_EVALUABLE' && unmasked.verdict === 'NOT_INDEPENDENT'
        && unmasked.reasons.indexOf('SAME_DECISION_DATE_BUNDLE_KEY_COLLISION') >= 0
    });
  }

  // RP5 —— 输入侧 provenance 缺载 ⇒ 必须翻为 NOT_EVALUABLE / INPUT_PROVENANCE_UNAVAILABLE
  {
    const A = JSON.parse(JSON.stringify(byId['POS-1'].A));
    A.source_raw_sha256 = {};
    const r = decideIndependence(A, byId['POS-1'].B);
    out.push({
      id: 'RP5',
      name: '输入侧 provenance 缺载 ⇒ C4a（可得性）必须否决',
      target_case: 'POS-1.A（provenance 清空）',
      before_verdict: 'INDEPENDENT',
      after_verdict: r.verdict + ' / ' + JSON.stringify(r.reasons),
      flipped: r.verdict === 'NOT_EVALUABLE'
        && r.reasons.indexOf('INPUT_PROVENANCE_UNAVAILABLE') >= 0
    });
  }

  // RP4 —— 逐字节还原自证
  const src = fs.readFileSync(__filename, 'utf8');
  const restored = evalModule(src);
  const r4 = restored.decideIndependence(byId['NEG-FWD-1'].A, byId['NEG-FWD-1'].B);
  out.push({
    id: 'RP4',
    name: '逐字节还原后 判据复原',
    target_case: 'NEG-FWD-1',
    before_verdict: 'NOT_INDEPENDENT',
    after_verdict: r4.verdict,
    flipped: r4.verdict === 'NOT_INDEPENDENT'
  });

  console.log('== R1 判据 打红自证（变异 ⇒ 必翻转 ⇒ 还原 ⇒ 必复原）==');
  let all = true;
  out.forEach((o) => {
    if (!o.flipped) all = false;
    console.log('  [%s] %s', o.flipped ? 'PASS' : 'FAIL', o.id + ' · ' + o.name);
    console.log('         case=%s  %s → %s', o.target_case, o.before_verdict, o.after_verdict);
  });
  console.log('  ---------- RED_PROOF = %s ----------', all ? 'PASS' : 'FAIL');
  return all;
}

/** 在隔离作用域里求值一个 CJS 模块源码（用于变异自证） */
function evalModule(src) {
  const m = { exports: {} };
  const fn = new Function('module', 'exports', 'require', '__dirname', '__filename', src);
  fn(m, m.exports, require, HERE, __filename);
  return m.exports;
}

/**
 * 非干预自证（结构性）：把「非判据字段」注入描述符 ⇒ 结论必须**逐字不变**。
 * 理由：owner 点名的 11 个字段里，trigger / candidate_content_sha / pointer_revision /
 *       run_date(III) **不是**契约的独立性判据 ⇒ 它们出现与否不得改变结论。
 *       （§3.0.4 明确 pointer_revision 对 run_id 函数依赖；§3.5 明确 (III) 只作组 A 护栏。）
 */
function nonInterference() {
  const fx = loadCases();
  const FORBIDDEN = ['trigger', 'candidate_content_sha', 'pointer_revision',
    'input_hash', 'event_id', 'promotion_attempt', 'engine_version'];
  console.log('== R1 判据 非干预自证（非判据字段注入 ⇒ 结论必须不变）==');
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

if (require.main === module) {
  const args = process.argv.slice(2);
  let ok = true;
  if (args.indexOf('--selftest') >= 0 || args.length === 0) ok = selftest() && ok;
  if (args.indexOf('--non-interference') >= 0) ok = nonInterference() && ok;
  if (args.indexOf('--red-proof') >= 0) ok = redProof() && ok;
  process.exit(ok ? 0 : 1);
}

module.exports = {
  CLUSTER_GAP_DAYS,
  EVIDENCE_COLUMNS,
  PROMOTION_PROOF_KEYS,
  VERDICT,
  dayGap,
  decideIndependence
};
