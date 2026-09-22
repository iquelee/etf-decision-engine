'use strict';
/**
 * V3.6.4 Safety Hardening —— 版本治理冻结生成器
 *
 * 由 `ml/manifests/V364_IMMUTABLE_LOCK.candidate.json` 生成
 *    `ml/manifests/V364_IMMUTABLE_LOCK.json`（`status = FROZEN`）。
 *
 * 只做治理冻结：**不改任何产品代码、不改任何既有锁文件、不写 self-reference**。
 *
 * ★ SHA 语义（刻意区分，禁止混用）：
 *   - `parent_repo_sha`            父版本 V3.6.1 的仓库 commit（候选的基线）
 *   - `qualification_content_sha`  被锁定的**候选内容** commit（manifest 生成前的那一个）
 *   - `qualification_ci_head_sha`  通过**最终完整 CI** 的 PR HEAD
 *   - `qualification_ci_run_number` / `qualification_ci_run_id`
 *   ⛔ 不得把 `qualification_content_sha` 简单替换成当前 HEAD：
 *      二者语义不同（前者是「被锁内容」，后者是「CI 所测 head」）。
 *   ⛔ manifest **不记录自身所在的 freeze commit**（避免自指）——
 *      该 commit 由 tag `v3.6.4-frozen` 与 `docs/production-deployment-ledger.md` 记录。
 *
 * 运行：node scripts/v364-freeze-manifest.js
 *   （无参数；若已存在 FROZEN 文件则拒绝覆盖，除非加 --force）
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..');
const CANDIDATE_REL = 'ml/manifests/V364_IMMUTABLE_LOCK.candidate.json';
const OUT_REL = 'ml/manifests/V364_IMMUTABLE_LOCK.json';
const V361_LOCK_REL = 'ml/manifests/V361_IMMUTABLE_LOCK.json';
const GEN1_LOCK_REL = 'ml/manifests/GEN1_FEATURE_PIPELINE_LOCK.json';

/* 已授权并已通过最终 CI 的资格化事实（用户 2026-09-22 人工 Review 提供） */
const QUALIFICATION = {
  content_sha: '00a8b14a0f9df83311992f176c8b73a0eda902fa',
  ci_head_sha: 'c37ec91bdbe16dca3e6bbf59a53fea96085f6954',
  ci_run_number: 145,
  ci_run_id: 35693711637,
  ci_conclusion: 'success'
};

/* 父版本基线（`git show <parent_repo_sha>:<path>` 的 LF-normalized sha256，**完整 64 位**）。
   这两个「锁文件自身逐位未改」的期望值无法从仓库内部推导，故显式固化于此，并附来源说明以便复核。
   ⛔ 不得写入任何未经实测的占位/推导值。 */
const PARENT_BASELINE = {
  'ml/manifests/V361_IMMUTABLE_LOCK.json': {
    sha256: '1c724381e533dd51e4fd0268bdc14aca0b4f444a458eab6c75c97be78a78f1bd',
    source: 'git show 650db58639f32232ac72a99920060dd92e743621:ml/manifests/V361_IMMUTABLE_LOCK.json'
      + ' | CRLF->LF | sha256'
  },
  'ml/manifests/GEN1_FEATURE_PIPELINE_LOCK.json': {
    sha256: '8efdda6fadb7da409c4d6215851495cf63dec4904a371d3bf5fff82008a2b7ad',
    source: 'git show 650db58639f32232ac72a99920060dd92e743621:ml/manifests/GEN1_FEATURE_PIPELINE_LOCK.json'
      + ' | CRLF->LF | sha256'
  }
};

const problems = [];
const ok = (cond, msg) => { if (!cond) problems.push(msg); return !!cond; };

function sha256lf(rel) {
  const content = fs.readFileSync(path.join(REPO, rel), 'utf8').replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}
function readJson(rel) { return JSON.parse(fs.readFileSync(path.join(REPO, rel), 'utf8')); }

const candidate = readJson(CANDIDATE_REL);
const v361Lock = readJson(V361_LOCK_REL);
const gen1Lock = readJson(GEN1_LOCK_REL);

/* ---------- 1) 前置断言：candidate 处于可冻结状态 ---------- */
ok(candidate.status === 'CANDIDATE_NOT_FROZEN',
  `candidate.status 应为 CANDIDATE_NOT_FROZEN，实为 ${candidate.status}`);
ok(candidate.parent_unchanged_all_pass === true, 'candidate.parent_unchanged_all_pass 应为 true');
ok(candidate.freeze_condition && candidate.freeze_condition.satisfied === true,
  'candidate.freeze_condition.satisfied 应为 true');
['gate_a', 'gate_b', 'gate_c'].forEach((g) => ok(
  /PASS/.test(String(candidate.freeze_condition[g])), `candidate.freeze_condition.${g} 应含 PASS`
));
ok(candidate.freeze_condition.gate_d_status === 'PASS', 'candidate gate_d_status 应为 PASS');

/* ---------- 2) 逐位复算：17 个实现文件 ---------- */
const implRecalc = {};
Object.keys(candidate.sha256).forEach((k) => {
  const rel = candidate.files[k];
  const actual = sha256lf(rel);
  implRecalc[k] = { path: rel, expected: candidate.sha256[k], actual, pass: actual === candidate.sha256[k] };
  ok(actual === candidate.sha256[k], `实现文件漂移：${rel} expected=${candidate.sha256[k]} actual=${actual}`);
});

/* ---------- 3) 逐位复算：6 份资格化报告 ---------- */
const reportRecalc = {};
Object.keys(candidate.qualification_reports).forEach((rel) => {
  const actual = sha256lf(rel);
  const exp = candidate.qualification_reports[rel];
  reportRecalc[rel] = { expected: exp, actual, pass: actual === exp };
  ok(actual === exp, `报告漂移：${rel} expected=${exp} actual=${actual}`);
});

/* ---------- 4) 「父版本逐位未改」不变量（期望值取自权威锁，而非 candidate 自述） ---------- */
const v361DecisionV3 = v361Lock.decision_v3_sha256;
const v361Decision = v361Lock.decision_sha256;
const gen1TrendEntry = (gen1Lock.files || []).find((f) => f.role === 'trend_stage_implementation');
ok(!!v361DecisionV3 && !!v361Decision, 'V361 锁缺少 decision_v3_sha256 / decision_sha256');
ok(!!gen1TrendEntry, 'GEN1 锁缺少 role=trend_stage_implementation 条目');

const frozenInvariants = [
  {
    name: 'V361_IMMUTABLE_LOCK.json 逐位未改（相对 parent_repo_sha）',
    expected: PARENT_BASELINE[V361_LOCK_REL].sha256,
    actual: sha256lf(V361_LOCK_REL),
    pass: sha256lf(V361_LOCK_REL) === PARENT_BASELINE[V361_LOCK_REL].sha256,
    baseline_source: PARENT_BASELINE[V361_LOCK_REL].source
  },
  {
    name: 'GEN1_FEATURE_PIPELINE_LOCK.json 逐位未改（相对 parent_repo_sha）',
    expected: PARENT_BASELINE[GEN1_LOCK_REL].sha256,
    actual: sha256lf(GEN1_LOCK_REL),
    pass: sha256lf(GEN1_LOCK_REL) === PARENT_BASELINE[GEN1_LOCK_REL].sha256,
    baseline_source: PARENT_BASELINE[GEN1_LOCK_REL].source
  },
  {
    name: 'decision-v3.js 逐位未改（期望值取自 V361_IMMUTABLE_LOCK.json）',
    expected: v361DecisionV3,
    actual: sha256lf('src/common/utils/decision-v3.js'),
    pass: sha256lf('src/common/utils/decision-v3.js') === v361DecisionV3,
    baseline_source: `${V361_LOCK_REL} :: decision_v3_sha256`
  },
  {
    name: 'decision.js 逐位未改（期望值取自 V361_IMMUTABLE_LOCK.json）',
    expected: v361Decision,
    actual: sha256lf('src/common/utils/decision.js'),
    pass: sha256lf('src/common/utils/decision.js') === v361Decision,
    baseline_source: `${V361_LOCK_REL} :: decision_sha256`
  },
  {
    name: 'trend-stage.js 逐位未改（期望值取自 GEN1_FEATURE_PIPELINE_LOCK.json）',
    expected: gen1TrendEntry ? gen1TrendEntry.sha256 : null,
    actual: sha256lf('src/common/utils/trend-stage.js'),
    pass: !!gen1TrendEntry && sha256lf('src/common/utils/trend-stage.js') === gen1TrendEntry.sha256,
    baseline_source: `${GEN1_LOCK_REL} :: files[role=trend_stage_implementation].sha256`
  }
];
frozenInvariants.forEach((inv) => ok(inv.pass, `冻结不变量失败：${inv.name}`));
const frozenAllPass = frozenInvariants.every((i) => i.pass);

if (problems.length) {
  console.error('✗ 冻结前置断言失败，已中止（未写出任何文件）：');
  problems.forEach((p) => console.error('   - ' + p));
  process.exit(1);
}

/* ---------- 5) 写出 FROZEN manifest ---------- */
const frozen = {
  version: 'V3.6.4',
  status: 'FROZEN',
  freeze_decision: 'USER_REVIEW_AUTHORIZED',
  title: candidate.title,
  frozen_from: CANDIDATE_REL,
  generated_at: new Date().toISOString(),
  hash_basis: candidate.hash_basis,

  parent_version: candidate.parent_version,
  parent_repo_sha: candidate.parent_repo_sha,

  /* ★ 三个 SHA 语义明确区分 */
  qualification_content_sha: QUALIFICATION.content_sha,
  qualification_ci_head_sha: QUALIFICATION.ci_head_sha,
  qualification_ci_run_number: QUALIFICATION.ci_run_number,
  qualification_ci_run_id: QUALIFICATION.ci_run_id,
  qualification_ci_conclusion: QUALIFICATION.ci_conclusion,
  sha_semantics_note: 'qualification_content_sha = 被锁定的候选内容 commit（manifest 生成前的那一个）；'
    + 'qualification_ci_head_sha = 通过最终完整 CI 的 PR HEAD。'
    + '二者语义不同，禁止互相替代；也不得把任一者替换为 freeze commit 自身。',
  candidate_repo_sha_alias_note: 'candidate manifest 里的旧字段名 `candidate_repo_sha` 在本冻结文件中由 '
    + '`qualification_content_sha` 取代（同义：被锁定的候选内容 commit）。'
    + '它**既不是** CI head，**也不是** freeze commit。',
  self_reference_policy: '本 manifest **不记录其自身所在的 freeze commit SHA**（避免自指）。'
    + 'freeze commit 由 git tag `v3.6.4-frozen` 与 `docs/production-deployment-ledger.md` 记录。',

  files: candidate.files,
  sha256: candidate.sha256,
  implementation_files_recalc: implRecalc,

  qualification_reports: candidate.qualification_reports,
  qualification_reports_recalc: reportRecalc,
  qualification_reports_basis: '哈希对应 `qualification_content_sha` 的内容。'
    + '后续**独立**的文档措辞更新不属本候选内容集，不改变本冻结集。',
  explicitly_not_included: candidate.explicitly_not_included,
  freeze_scope: '本冻结**仅**完成 `CANDIDATE_NOT_FROZEN → FROZEN`。'
    + '**不包含**：PR #52 merge 授权、CloudBase 部署授权、线上 param_config 修改授权、'
    + 'fine-grained PAT 权限变更、仓库 ruleset 变更。',

  parent_unchanged_invariants: candidate.parent_unchanged_invariants,
  parent_unchanged_all_pass: candidate.parent_unchanged_all_pass,
  frozen_invariants: frozenInvariants,
  frozen_invariants_all_pass: frozenAllPass,

  /* ★ Gate A 语义红线 */
  gate_a_status: 'PASS_SAFETY_ONLY',
  gate_a_statement: 'R1 lowerLow plumbing 修复在当前生产 indicator contract 下为零副作用；'
    + '由于 ma60_slope / high_point_falling(or lower_high) 缺失，SB>=75 当前生产不可达；'
    + '因此 Gate A 不构成 SlowBreak 触发时机正确性的验证。',
  gate_a_must_not_be_read_as: 'SlowBreak 功能已经验证有效',
  finding_1: {
    id: 'FINDING-1',
    status: 'OPEN',
    summary: 'calcSlowBreakScore 的 4 项输入中，ma60_slope 全仓无产生处、'
      + 'high_point_falling/lower_high 不在线上 indicator_snapshot 字段集内 ⇒ 分数上限 50 ⇒ SB>=75 不可达。',
    not_fixed_in_this_freeze: true,
    do_not: ['补快照字段', '修改 SlowBreak 阈值']
  },

  gates: {
    A: {
      status: 'PASS_SAFETY_ONLY',
      evidence: candidate.freeze_condition.gate_a,
      statement: 'R1 lowerLow plumbing 修复在当前生产 indicator contract 下为零副作用；'
        + '由于 ma60_slope / high_point_falling(or lower_high) 缺失，SB>=75 当前生产不可达；'
        + '因此 Gate A 不构成 SlowBreak 触发时机正确性的验证。'
    },
    B: { status: 'PASS', evidence: candidate.freeze_condition.gate_b },
    C: { status: 'PASS', evidence: candidate.freeze_condition.gate_c },
    D: {
      status: 'PASS',
      evidence: candidate.freeze_condition.gate_d,
      run_url: candidate.freeze_condition.gate_d_run,
      run_number: QUALIFICATION.ci_run_number,
      run_id: QUALIFICATION.ci_run_id,
      head_sha: QUALIFICATION.ci_head_sha,
      conclusion: QUALIFICATION.ci_conclusion
    }
  },

  post_freeze_state: 'FROZEN / NOT_MERGED / NOT_DEPLOYED',
  next_authorizations_required: [
    'MERGE AUTHORIZATION（与部署授权分开）',
    'PRODUCTION PROMOTION AUTHORIZATION'
  ],
  rule: candidate.rule,
  freeze_rule: '本文件一经冻结即不得静默修改。任何对 V3.6.4 冻结集的扩展或挑战，'
    + '必须升版（V3.6.5+）并重新走完整资格化（Gate A~D）。'
    + '`V361_IMMUTABLE_LOCK.json` 永久保留 V3.6.1 历史基线，不因本冻结而变更。'
};

const outPath = path.join(REPO, OUT_REL);
if (fs.existsSync(outPath) && process.argv.indexOf('--force') < 0) {
  console.error(`✗ ${OUT_REL} 已存在。冻结文件不得被静默覆盖；如确需重生成请显式加 --force。`);
  process.exit(1);
}
fs.writeFileSync(outPath, `${JSON.stringify(frozen, null, 2)}\n`, 'utf8');

console.log(`[Freeze] ${OUT_REL}`);
console.log(`  version                        = ${frozen.version}`);
console.log(`  status                         = ${frozen.status}`);
console.log(`  freeze_decision                = ${frozen.freeze_decision}`);
console.log(`  parent_repo_sha                = ${frozen.parent_repo_sha}`);
console.log(`  qualification_content_sha      = ${frozen.qualification_content_sha}`);
console.log(`  qualification_ci_head_sha      = ${frozen.qualification_ci_head_sha}`);
console.log(`  qualification_ci_run           = #${frozen.qualification_ci_run_number} (id ${frozen.qualification_ci_run_id}) ${frozen.qualification_ci_conclusion}`);
console.log(`  gate_a_status                  = ${frozen.gate_a_status}`);
console.log(`  finding_1                      = ${frozen.finding_1.status}`);
console.log(`  实现文件逐位复算               = ${Object.values(implRecalc).filter((r) => r.pass).length}/${Object.keys(implRecalc).length} PASS`);
console.log(`  报告逐位复算                   = ${Object.values(reportRecalc).filter((r) => r.pass).length}/${Object.keys(reportRecalc).length} PASS`);
console.log(`  冻结不变量                     = ${frozenInvariants.filter((i) => i.pass).length}/${frozenInvariants.length} PASS`);
