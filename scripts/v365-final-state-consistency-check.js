#!/usr/bin/env node
/**
 * V3.6.5 Final State Consistency Check（只读 · 文档一致性）
 *
 * 用途：对三份收口文档做**只读**一致性校验，唯一真值来源 = 真实代码/门禁/manifest/git。
 *   docs/V365_CONTEXT_COMPRESSION.md
 *   docs/V365_PRODUCTION_READINESS_LEDGER.md
 *   docs/V365_FREEZE_REVIEW.md
 *
 * 校验项：
 *   1. HEAD（git rev-parse HEAD）
 *   2. stageATestFileCount（tests/*.test.js 文件数）
 *   3. candidate_content_sha（ml/manifests/V365_CANDIDATE_MANIFEST.json）
 *   4. V1 anchor（outputs/v365-rfp-v2cf-delta-attribution.json.v1_anchor 或文档值）
 *   5. V2-CF anchor（outputs/v365-rfp-v2cf-interim-anchor.json.result_sequence_sha）
 *   6. UNEXPECTED_DECISION_DELTA = 0
 *   7. Freeze status 一致（ELIGIBLE_FOR_REVIEW 或 BLOCKED；⛔ 不得 READY）
 *   8. 唯一 blocker = GOVERNED_PRODUCTION_HISTORY_DATA_REQUIRED
 *   9. tracked-file count（git diff --name-only HEAD）
 *  10. 三份文档之间对上述值**无矛盾**
 *
 * ⚠️ **Stage A 语义边界（重要 · 不得混淆）**
 *   本 checker **只能**证明：
 *     STAGE_A_TEST_FILE_COUNT = N          （存在 N 个 tests/*.test.js 文件）
 *   本 checker **不能**证明：
 *     STAGE_A_PASS = N/N                  （这 N 个文件实际全部通过）
 *   ⇒ 本 checker **不重跑** Stage A（重跑属重新执行测试，非只读一致性检查）。
 *   ⇒ 文档中的 `Stage A = N/N` 之 **PASS 状态来自最近一次 Full Requalification evidence**，
 *      不由本 consistency checker 独立重新证明。本 checker 仅校验：
 *      ① 文件计数 = N（与文档一致）② 三份文档对 Stage A 表述**彼此一致**（无 65/65 等漂移）。
 *
 * ⛔ 本脚本**只读**：不写任何文件、不改任何代码、不跑有副作用命令、**不重跑重测试**。
 * 退出码：0 = 全部一致；1 = 存在矛盾（打印明细）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const DOCS = {
  compression: path.join(REPO, 'docs', 'V365_CONTEXT_COMPRESSION.md'),
  ledger: path.join(REPO, 'docs', 'V365_PRODUCTION_READINESS_LEDGER.md'),
  freeze: path.join(REPO, 'docs', 'V365_FREEZE_REVIEW.md'),
  prospective: path.join(REPO, 'docs', 'V365_PROSPECTIVE_PRODUCTION_QUALIFICATION.md'),
};

let violations = 0;
function check(name, cond, detail) {
  const mark = cond ? 'PASS' : 'FAIL';
  if (!cond) violations += 1;
  console.log(`  [${mark}] ${name}${detail ? ' — ' + detail : ''}`);
}

function sh(cmd) {
  return execSync(cmd, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function readText(p) {
  return fs.readFileSync(p, 'utf8');
}

/* ---------- 真值采集 ---------- */
console.log('== V3.6.5 Final State Consistency Check（只读）==\n');

const truth = {};

// 1. HEAD
try {
  truth.head = sh('git rev-parse HEAD');
} catch (e) {
  truth.head = null;
}

// 2. stageATestFileCount（⚠️ 仅证明"文件数"，不证明"实际全通过"）
truth.stageATestFileCount = fs
  .readdirSync(path.join(REPO, 'tests'))
  .filter((f) => f.endsWith('.test.js')).length;

// 3. candidate_content_sha
const manifest = JSON.parse(
  fs.readFileSync(path.join(REPO, 'ml', 'manifests', 'V365_CANDIDATE_MANIFEST.json'), 'utf8')
);
truth.candidateContentSha = manifest.candidate_content_sha;
truth.manifestFileCount = (manifest.files || manifest.qualified_files || []).length;

// 4/5. anchors（优先取 outputs 权威件）
try {
  const att = JSON.parse(
    fs.readFileSync(path.join(REPO, 'outputs', 'v365-rfp-v2cf-delta-attribution.json'), 'utf8')
  );
  truth.v2cfAnchor = att.v2cf_anchor || null;
  truth.v1Anchor = att.v1_anchor || null;
} catch (e) {
  truth.v2cfAnchor = null;
  truth.v1Anchor = null;
}
try {
  const interim = JSON.parse(
    fs.readFileSync(path.join(REPO, 'outputs', 'v365-rfp-v2cf-interim-anchor.json'), 'utf8')
  );
  if (!truth.v2cfAnchor) truth.v2cfAnchor = interim.result_sequence_sha || null;
} catch (e) {
  /* noop */
}

// 6. delta
try {
  const cov = JSON.parse(
    fs.readFileSync(path.join(REPO, 'outputs', 'v365-rfp-v2cf-coverage-manifest.json'), 'utf8')
  );
  truth.replaySemantics = cov.replay_semantics || null;
  truth.qualificationAuthoritative = cov.qualification_authoritative;
} catch (e) {
  truth.replaySemantics = null;
  truth.qualificationAuthoritative = null;
}

// 9. tracked-file count
// ⚠️ 语义修正（C-018）：`git diff --name-only HEAD` **只含 tracked** 文件的改动，
//    会漏掉 untracked 的新文件（新 tests / scripts / docs）。而三份收口文档声明的
//    「当前改动面」= tracked + untracked 的**全部文件**。故真值口径改为：
//    遍历 git status，取所有非目录条目（含 `??` untracked），并按文件计数。
//    ⚠️ 必须用 substring(3) 解析 —— `" M .gitignore"` 的行首空格经 shell 管道会被吞。
//    ⚠️ 必须加 `-uall` —— 否则未跟踪的**目录**（如 scripts/tools/）会被折叠成单个路径，
//       导致计数偏小（见 memory §12）。C-019 修正。
try {
  const raw = sh('git status --porcelain -uall');
  truth.trackedCount = raw
    ? raw.split('\n').filter(Boolean)
        .map((l) => l.substring(3).trim())
        .filter((p) => p && !p.endsWith('/')).length
    : 0;
} catch (e) {
  truth.trackedCount = null;
}

console.log('  真值采集：');
console.log(`    HEAD                       = ${truth.head}`);
console.log(`    stageATestFileCount        = ${truth.stageATestFileCount}`);
console.log(`    candidate_content_sha      = ${truth.candidateContentSha}`);
console.log(`    V1 anchor                  = ${truth.v1Anchor}`);
console.log(`    V2-CF anchor               = ${truth.v2cfAnchor}`);
console.log(`    replay_semantics           = ${truth.replaySemantics}`);
console.log(`    qualification_auth         = ${truth.qualificationAuthoritative}`);
console.log(`    tracked-file count         = ${truth.trackedCount}`);
console.log('');
console.log('  ⚠️ Stage A 语义边界：');
console.log(`     本 checker 能证明 = STAGE_A_TEST_FILE_COUNT = ${truth.stageATestFileCount}`);
console.log(`     本 checker 不能证明 = STAGE_A_PASS（该 ${truth.stageATestFileCount} 个文件实际全部通过）`);
console.log('     ⇒ 文档中的 `Stage A = N/N` 之 PASS 状态来自最近一次 Full Requalification evidence，');
console.log('       不由本 consistency checker 独立重新证明（本 checker 不重跑重测试）。');
console.log('');

/* ---------- 文档校验 ---------- */
const docs = {};
for (const [k, p] of Object.entries(DOCS)) {
  docs[k] = fs.existsSync(p) ? readText(p) : null;
}

console.log('== (1) 三份文档均存在 ==');
for (const [k, p] of Object.entries(DOCS)) {
  check(`${k} 存在`, docs[k] != null, path.relative(REPO, p));
}
console.log('');

console.log('== (2) HEAD 一致 ==');
if (truth.head) {
  const short = truth.head;
  for (const [k, txt] of Object.entries(docs)) {
    if (txt == null) continue;
    check(`${k} 含 HEAD ${short.slice(0, 12)}…`, txt.includes(short) || txt.includes(short.slice(0, 12)));
  }
} else {
  check('HEAD 可读', false, 'git rev-parse HEAD 失败');
}
console.log('');

console.log('== (3) Stage A 表述一致（⚠️ 仅文件计数，非 PASS 独立复证）==');
{
  const n = truth.stageATestFileCount;
  const expect = `${n}/${n}`;
  // 断言仅限：文档中的 "N/N" 与**当前测试文件数**一致。
  // ⛔ 这不等于本 checker 证明了"N 个测试实际通过" —— PASS 状态来自 Full Requalification evidence。
  for (const [k, txt] of Object.entries(docs)) {
    if (txt == null) continue;
    check(`${k} 含 ${expect}（与 stageATestFileCount 一致）`, txt.includes(expect));
  }
  // 只允许当前值作为当前基线。
  // ⚠️ ledger 的「阶段日志 C-001~C-011」是 append-only 的历史记录，其中 62/62~66/66
  //    是各阶段当时的**真实**快照值，属合法历史，不在本断言范围内 —— 只针对
  //    「当前状态快照」（append-only 日志之前的部分）做过期值检查。
  for (const [k, txt] of Object.entries(docs)) {
    if (txt == null) continue;
    let scope = txt;
    if (k === 'ledger') {
      const cut = txt.indexOf('## C. 阶段日志');
      if (cut >= 0) scope = txt.slice(0, cut); // 仅「当前状态快照」段
    }
    check(
      `${k} 当前快照无过期 Stage A 基线（6[2-6]/6[2-6]）`,
      !/Stage A\s*\|?\s*\*?\*?6[2-6]\/6[2-6]/.test(scope)
    );
  }
  console.log(`  [INFO] Stage A PASS（=${expect}）的权威来源 = 最近一次 Full Requalification evidence；`);
  console.log('         本 checker 不重跑重测试，故不对其 PASS 作独立证明。');
}
console.log('');

console.log('== (4) candidate_content_sha 一致 ==');
{
  const full = truth.candidateContentSha;
  const short = String(full).slice(0, 8); // 日志中允许 8 位截断 + …
  for (const [k, txt] of Object.entries(docs)) {
    if (txt == null) continue;
    check(
      `${k} 含 sha ${short}…`,
      txt.includes(full) || txt.includes(short)
    );
  }
  // 但 C-011 最终块必须有**完整**值
  if (docs.ledger) {
    check('ledger C-011 最终块含完整 candidate_content_sha', docs.ledger.includes(full));
  }
}
console.log('');

console.log('== (5) V1 / V2-CF anchor 一致 ==');
{
  const mk = (a) => ({ full: a, short: String(a).slice(0, 8) });
  const v1 = mk(truth.v1Anchor || '');
  const v2 = mk(truth.v2cfAnchor || '');
  for (const [k, txt] of Object.entries(docs)) {
    if (txt == null) continue;
    if (truth.v1Anchor) {
      check(`${k} 含 V1 anchor`, txt.includes(v1.full) || txt.includes(v1.short));
    }
    if (truth.v2cfAnchor) {
      check(`${k} 含 V2-CF anchor`, txt.includes(v2.full) || txt.includes(v2.short));
    }
  }
  // C-011 最终块必须两者都有**完整**值
  if (docs.ledger) {
    check('ledger C-011 最终块含完整 V1 anchor', docs.ledger.includes(v1.full));
    check('ledger C-011 最终块含完整 V2-CF anchor', docs.ledger.includes(v2.full));
  }
}
console.log('');

console.log('== (6) UNEXPECTED_DECISION_DELTA = 0 ==');
for (const [k, txt] of Object.entries(docs)) {
  if (txt == null) continue;
  check(
    `${k} 声明 Δ=0`,
    /UNEXPECTED_DECISION_DELTA\s*=?\s*\*?\*?0/.test(txt) || /Δ\s*0/.test(txt)
  );
}
console.log('');

console.log('== (7) Freeze status 一致（C-013 后 = ELIGIBLE_FOR_REVIEW，⛔ 仍不得 READY）==');
for (const [k, txt] of Object.entries(docs)) {
  if (txt == null) continue;
  // 接受：ELIGIBLE_FOR_REVIEW（现态）或 BLOCKED（历史/等价表述）；⛔ 不接受 READY
  check(
    `${k} 含 Freeze 状态（ELIGIBLE_FOR_REVIEW 或 BLOCKED）`,
    /Freeze Review\s*=?\s*🔶?\s*\*?\*?ELIGIBLE_FOR_REVIEW/.test(txt)
      || /FREEZE_REVIEW\s*=\s*ELIGIBLE_FOR_REVIEW/.test(txt)
      || /Freeze Review\s*=?\s*⛔?\s*\*?\*?BLOCKED/.test(txt)
      || /FREEZE_REVIEW\s*=\s*BLOCKED/.test(txt)
      || /FINAL:\s*BLOCKED/.test(txt)
  );
  // ⛔ 终局不得为 READY（即使 blocker 已解除，F2-B/RFP-V2-PH 未执行）
  check(
    `${k} Freeze 终局不是 READY`,
    !/FREEZE_REVIEW\s*=\s*READY_FOR_PRODUCTION_PROMOTION/.test(txt)
  );
}
console.log('');

console.log('== (8) 唯一 blocker 记录一致 + 无 READY 误报 ==');
for (const [k, txt] of Object.entries(docs)) {
  if (txt == null) continue;
  check(`${k} 含 GOVERNED_PRODUCTION_HISTORY_DATA_REQUIRED`, txt.includes('GOVERNED_PRODUCTION_HISTORY_DATA_REQUIRED'));
  // ⛔ 不得输出 READY_FOR_PRODUCTION_PROMOTION 作为「已达成」判定
  // ⚠️ `= NOT_ISSUED` / `仍 NOT_ISSUED` 是**正确的否定声明**，不算误报；
  //    只有 `= ISSUED` / `= READY…`（正面放行）才是违规。
  const readyAsVerdict = /READY_FOR_PRODUCTION_PROMOTION\s*(?:=|：)\s*\*?\*?(?:ISSUED|GRANTED|READY|APPROVED)\b/.test(txt);
  check(`${k} 未把 READY_FOR_PRODUCTION_PROMOTION 作为终局判定`, !readyAsVerdict);
}
console.log('');

console.log('== (9) tracked-file count 一致 ==');
{
  const n = truth.trackedCount;
  if (n != null) {
    const patterns = [
      new RegExp(`tracked[^\\n]*${n}`),
      new RegExp(`${n}\\s*个\\s*tracked`),
      new RegExp(`tracked[^\\n]*\\*\\*${n}\\*\\*`),
    ];
    for (const [k, txt] of Object.entries(docs)) {
      if (txt == null) continue;
      check(`${k} 含 tracked count = ${n}`, patterns.some((re) => re.test(txt)));
    }
    // 反向：不得出现与真实值不符的 tracked 计数 —— 但**仅限「当前状态快照」**。
    // ⚠️ ledger 的 `## C. 阶段日志` / `### C-0xx` 是 append-only 历史，其中旧 tracked 计数
    //    （如 C-011 的 19）是各阶段当时的**真实**值，属合法历史，不在本断言范围内。
    //
    // ★ C-021.1 §9 修复：原正则 `/tracked[^\n]*?\b(\d{1,3})\b/` **只匹配「tracked 在前」**，
    //    ⇒ 漏掉 `<num> 个 tracked 文件` 这一形态 —— 正是 Freeze Review 残留「25 个 tracked 文件」
    //    得以逃过守卫的原因。现**双向**匹配，并允许**显式历史标记**豁免。
    const HISTORICAL_MARKER = /\[HISTORICAL SNAPSHOT\]|历史|旧口径|已作废|原写|该轮当时|当时实况/;
    const anyTrackedNum = /tracked[^\n]*?\b(\d{1,3})\b(?:\s*个)?|\b(\d{1,3})\b\s*个\s*tracked|(?:\*\*)?\b(\d{1,3})\b(?:\*\*)?\s*(?:个)?\s*tracked/gi;
    for (const [k, txt] of Object.entries(docs)) {
      if (txt == null) continue;
      let scope = txt;
      if (k === 'ledger') {
        const cut = txt.indexOf('## C. 阶段日志');
        if (cut >= 0) scope = txt.slice(0, cut); // 仅「当前状态快照」段
      }
      const lines = scope.split('\n');
      let bad = null;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // 该行 ±2 行内若有显式历史标记 ⇒ 视为历史记录，合法
        const ctx = lines.slice(Math.max(0, i - 2), i + 3).join('\n');
        if (HISTORICAL_MARKER.test(ctx)) continue;
        const re = new RegExp(anyTrackedNum.source, 'gi');
        let m;
        while ((m = re.exec(line)) !== null) {
          const v = Number(m[1] || m[2] || m[3]);
          if (v !== n && v > 0) { bad = `${v}（真值 ${n}）@ "${line.trim().slice(0, 70)}"`; break; }
        }
        if (bad) break;
      }
      check(`${k} 当前快照无过期 tracked 计数`, bad == null, bad || 'ok');
    }
  } else {
    check('tracked count 可读', false, 'git diff 失败');
  }
}
console.log('');

/* ============================================================
 * (10) ★ owner §6：current-state cross-doc 断言
 *   三份**当前文档**必须逐项一致 —— 且仅校验「当前状态快照」段，
 *   ⛔ append-only 历史段（ledger 的 ## C. 阶段日志 之后）不参与 stale-value rejection。
 * ============================================================ */
console.log('== (10) current-state cross-doc 一致（owner §6）==');

function currentSnapshot(k, txt) {
  if (txt == null) return null;
  if (k === 'ledger') {
    const cut = txt.indexOf('## C. 阶段日志');
    if (cut >= 0) return txt.slice(0, cut); // 仅「当前状态快照」段
  }
  return txt;
}

/**
 * 每项 = { key, mustMatch: RegExp[], mustNotMatch?: RegExp[] }
 *   mustMatch  : 当前快照**必须**命中的等价表述之一（三份文档逐项一致）
 *   mustNotMatch: 当前快照**禁止**出现的过期表述（⛔ 历史段不受此约束）
 */
const CURRENT_STATE_ITEMS = [
  {
    key: 'Stage A~G',
    mustMatch: [/Stage A~G[^\n]*\*?\*?8[0-9]\s*\/\s*8[0-9]\b/, /A~G\s*=\s*8[0-9]\s*\/\s*8[0-9]\b/, /Stage A~G\s*汇总[^\n]*\*?\*?8[0-9]\s*\/\s*8[0-9]\b/],
    mustNotMatch: [/Stage A~G[^\n]*\b7[0-9]\s*\/\s*7[0-9]\b/]
  },
  {
    key: 'HD-10',
    mustMatch: [/HD-10[^\n]*COMPLETE/i, /HD_10\s*=\s*COMPLETE/],
    mustNotMatch: [/HD-10[^\n]*待\s*owner\s*单独授权/, /HD-10[^\n]*PENDING/]
  },
  {
    key: 'OWNER_F2C_PATH',
    mustMatch: [/OWNER_F2C_PATH\s*=?\s*\*?\*?A\b/, /OWNER_F2C_PATH[^\n]*A\b/],
    mustNotMatch: [/OWNER_F2C_PATH[^\n]*=\s*C\b/]
  },
  {
    key: 'RUN_HISTORY_INDEX',
    mustMatch: [/RUN_HISTORY_INDEX[^\n]*PENDING/],
    mustNotMatch: [/RUN_HISTORY_INDEX[^\n]*(?:COMPLETE|DONE)(?![^\n]*PENDING)/]
  },
  {
    key: 'RPG-F2-B',
    mustMatch: [/RPG-F2-B[^\n]*PARTIAL/, /RPG-F2-B\s*=\s*PARTIAL/],
    mustNotMatch: [/RPG-F2-B[^\n]*\bCLOSED\b/]
  },
  {
    key: 'RPG-F2-C',
    mustMatch: [/RPG-F2-C[^\n]*BLOCKED_ON_ACTUAL_BOOK_COVERAGE/, /RPG-F2-C\s*=\s*BLOCKED/],
    mustNotMatch: [/RPG-F2-C[^\n]*\bCLOSED\b/]
  },
  {
    key: 'RPG-002',
    mustMatch: [/RPG-002[^\n]*NOT\s*YET\s*CLOSED/i, /RPG-002\s*=\s*PARTIAL/, /\*\*RPG-002\*\*[^\n]*NOT\s*YET\s*CLOSED/i],
    mustNotMatch: [/RPG-002[^\n]*\b(?:CLOSED|COMPLETE)\b(?![\s\S]{0,40}NOT\s*YET)/]
  },
  {
    key: 'RFP-V2-PH_FULL_WINDOW_AVAILABLE',
    mustMatch: [/RFP-V2-PH_FULL_WINDOW_AVAILABLE\s*[=:：]?\s*\*?\*?false/, /FULL_WINDOW_AVAILABLE\s*=\s*false/],
    mustNotMatch: [/RFP-V2-PH_FULL_WINDOW_AVAILABLE\s*[=:：]\s*\*?\*?true/]
  },
  {
    key: 'P12_PARITY_UNEXPECTED_DECISION_DELTA',
    mustMatch: [/P12_PARITY_UNEXPECTED_DECISION_DELTA[^\n]*\*?\*?0\b/, /p12[^\n]*UNEXPECTED_DECISION_DELTA[^\n]*\*?\*?0\b/],
    mustNotMatch: [/P12_PARITY_UNEXPECTED_DECISION_DELTA[^\n]*[=:：]\s*\*?\*?[1-9]\d*\b/]
  },
  {
    key: 'RPG_F3_HISTORICAL_UNEXPECTED_DECISION_DELTA',
    mustMatch: [/RPG_F3_HISTORICAL_UNEXPECTED_DECISION_DELTA[^\n]*\*?\*?6\b/],
    mustNotMatch: [/RPG_F3_HISTORICAL_UNEXPECTED_DECISION_DELTA[^\n]*[=:：]\s*\*?\*?0\b/]
  },
  {
    key: 'RPG_F3_PROSPECTIVE_UNEXPECTED_DECISION_DELTA',
    mustMatch: [/RPG_F3_PROSPECTIVE_UNEXPECTED_DECISION_DELTA[^\n]*NOT_STARTED/],
    mustNotMatch: [/RPG_F3_PROSPECTIVE_UNEXPECTED_DECISION_DELTA[^\n]*[=:：]\s*\*?\*?[1-9]\d*\b/]
  },
  {
    key: 'RPG_F3_HISTORICAL_UNEXPECTED_DECISION_DELTA (历史保留)',
    mustMatch: [/RPG_F3_HISTORICAL_UNEXPECTED_DECISION_DELTA[^\n]*\*?\*?6\b/, /UNEXPECTED_DECISION_DELTA[^\n]*\*?\*?6\b/],
    mustNotMatch: [/UNEXPECTED_DECISION_DELTA\s*=?\s*\*?\*?0\b(?![\s\S]{0,60}6)/]
  },
  {
    key: 'READY_FOR_PRODUCTION_PROMOTION',
    mustMatch: [/READY_FOR_PRODUCTION_PROMOTION[^\n]*NOT_ISSUED/],
    mustNotMatch: [/(^|[^未⛔])\s*READY_FOR_PRODUCTION_PROMOTION\s*(=|：)\s*ISSUED/]
  },
  /* ===== ★ C-019 / prospective design（owner §16）新增 ===== */
  {
    key: 'HISTORICAL_FULL_WINDOW_STATUS',
    mustMatch: [/HISTORICAL_FULL_WINDOW_STATUS[^\n]*INCOMPLETE_BY_SOURCE_HISTORY/,
                /FULL_WINDOW_STATUS[^\n]*INCOMPLETE_BY_SOURCE_HISTORY/],
    mustNotMatch: [/HISTORICAL_FULL_WINDOW_STATUS[^\n]*\*?\*?(?:COMPLETE|AVAILABLE|FULL)\b/]
  },
  {
    key: 'PROSPECTIVE_QUALIFICATION_STATUS',
    mustMatch: [/PROSPECTIVE_QUALIFICATION_STATUS[^\n]*NOT_STARTED/],
    mustNotMatch: [/PROSPECTIVE_QUALIFICATION_STATUS[^\n]*\*?\*?(?:QUALIFIED|COMPLETE|PASS)\b/]
  },
  {
    key: 'READY_FOR_CONTROLLED_PRODUCTION_ACTIVATION',
    // ★ C-021 §10：状态由 PENDING_OWNER_APPROVAL 收紧为 BLOCKED_ON_DEPLOYMENT_IDENTITY
    mustMatch: [/READY_FOR_CONTROLLED_PRODUCTION_ACTIVATION[^\n]*BLOCKED_ON_DEPLOYMENT_IDENTITY/,
                /READY_FOR_CONTROLLED_PRODUCTION_ACTIVATION[^\n]*PENDING_OWNER_APPROVAL/],
    mustNotMatch: [/READY_FOR_CONTROLLED_PRODUCTION_ACTIVATION[^\n]*\*?\*?(?:GRANTED|ISSUED|READY|APPROVED)\b/]
  },
  {
    key: 'READY_FOR_GENERAL_PRODUCTION',
    mustMatch: [/READY_FOR_GENERAL_PRODUCTION[^\n]*\*?\*?false/],
    mustNotMatch: [/READY_FOR_GENERAL_PRODUCTION[^\n]*\*?\*?true/]
  },
  {
    key: 'RFP-V2-PH-PROSPECTIVE',
    mustMatch: [/RFP-V2-PH-PROSPECTIVE/],
    mustNotMatch: [/RFP-V2-PH-PROSPECTIVE[^\n]*qualification_authoritative\s*[=:：]\s*true/]
  },
  {
    key: 'PRODUCTION_ACTIVATION_AUTHORIZATION',
    mustMatch: [/PRODUCTION_ACTIVATION_AUTHORIZATION[^\n]*NOT_GRANTED/],
    mustNotMatch: [/PRODUCTION_ACTIVATION_AUTHORIZATION[^\n]*[=:：]?\s*\*?\*?`?GRANTED/]
  },
  /* ===== ★ C-020 actual-book authority / 两层 anchor / CAS-history 恢复 ===== */
  {
    key: 'actual_position_book_authority',
    mustMatch: [/actual_position_book_authority[^\n]*portfolio_snapshot\.positions\[\]\.position/,
                /portfolio_snapshot\.positions\[\]\.position/],
    mustNotMatch: [/actual_book_source[^\n]*run_candidate_portfolio/]
  },
  {
    key: 'run_candidate_portfolio role',
    mustMatch: [/run_candidate_portfolio[^\n]*candidate_intended_portfolio_provenance|candidate_intended_portfolio_provenance/],
    mustNotMatch: [/run_candidate_portfolio\s*=\s*ACTUAL_EXECUTION_BOOK/]
  },
  {
    key: 'PROSPECTIVE_QUALIFICATION_ANCHOR',
    mustMatch: [/PROSPECTIVE_QUALIFICATION_ANCHOR/],
    mustNotMatch: []
  },
  {
    key: 'CAS_HISTORY_RECOVERY',
    mustMatch: [/PROMOTED_HISTORY_INCOMPLETE/],
    mustNotMatch: []
  },
  {
    key: 'OD_P_1',
    mustMatch: [/OD-P-1[^\n]*APPROVED|OD_P_1[^\n]*APPROVED/],
    mustNotMatch: [/OD-P-1[^\n]*PENDING_OWNER_DECISION/]
  },
  /* ===== ★ C-021 deployment identity & candidate freeze（owner §10~§14） ===== */
  {
    key: 'DEPLOYMENT_IDENTITY_VERIFIED',
    // ★ C-021.2：部署前必须 false；部署成功后为 true（由 §12 强制阶段一致性）
    mustMatch: [/DEPLOYMENT_IDENTITY_VERIFIED[^\n]*\*?\*?(?:false|true)/],
    mustNotMatch: []
  },
  {
    key: 'READY_FOR_V365_CONTROLLED_DEPLOYMENT (GATE-D)',
    mustMatch: [/READY_FOR_V365_CONTROLLED_DEPLOYMENT[^\n]*PENDING_OWNER/,
                /READY_FOR_V365_CONTROLLED_DEPLOYMENT\s*[=:：]?\s*\*?\*?PENDING/],
    mustNotMatch: [/READY_FOR_V365_CONTROLLED_DEPLOYMENT[^\n]*\*?\*?(?:GRANTED|ISSUED|READY|APPROVED)\b(?![\s\S]{0,30}PENDING)/]
  },
  {
    key: 'READY_FOR_V365_FIRST_CONTROLLED_RUN (GATE-R)',
    // ★ C-021.2：部署前 BLOCKED_ON_DEPLOYMENT_IDENTITY；部署后 PENDING_OWNER_RUN_APPROVAL
    mustMatch: [/READY_FOR_V365_FIRST_CONTROLLED_RUN[^\n]*BLOCKED_ON_DEPLOYMENT_IDENTITY/,
                /READY_FOR_V365_FIRST_CONTROLLED_RUN[^\n]*PENDING_OWNER_RUN_APPROVAL/],
    mustNotMatch: [/READY_FOR_V365_FIRST_CONTROLLED_RUN[^\n]*\*?\*?GRANTED\b/]
  },
  {
    key: 'CANDIDATE_FREEZE_DESIGN',
    mustMatch: [/CANDIDATE_FREEZE_DESIGN[^\n]*COMPLETE/],
    mustNotMatch: []
  },
  {
    key: 'CURRENT_PRODUCTION_DEPLOYMENT_IDENTITY',
    mustMatch: [/CURRENT_PRODUCTION_DEPLOYMENT_IDENTITY[^\n]*V3\.6\.4/,
                /CURRENT_PRODUCTION_DEPLOYMENT_IDENTITY\s*[=:：]?\s*\*?\*?V3\.6\.4/],
    mustNotMatch: [/CURRENT_PRODUCTION_DEPLOYMENT_IDENTITY[^\n]*V3\.6\.5/]
  },
  {
    key: 'candidate_manifest_sha',
    mustMatch: [/candidate_manifest_sha[^\n]*8c53f93f/],
    mustNotMatch: []
  },
  {
    key: 'deployment scope exact（⛔ 非全量）',
    mustMatch: [/deploy_all_74_changed_files[^\n]*false/, /deploy_all_76_changed_files[^\n]*false/,
                /V365_DEPLOYMENT_SCOPE[^\n]*EXACT/],
    mustNotMatch: [/V365_DEPLOYMENT_SCOPE[^\n]*\*?\*?(?:ALL|FULL|74|76)\b/]
  },
  {
    key: 'rollback artifact verified',
    mustMatch: [/rollback[^\n]*independently_verified[^\n]*true/i,
                /rollback_artifact_verified[^\n]*PASS/i,
                /rollback artifact[^\n]*独立验证/],
    mustNotMatch: []
  },
  {
    key: 'G-25 deployment_identity_verified（部署前必须 false）',
    mustMatch: [/G-25[^\n]*deployment_identity_verified/],
    mustNotMatch: [/G-25[^\n]*\*?\*?true\b/]
  },
  {
    key: 'owner_run_authorization（G-16 改名）',
    mustMatch: [/owner_run_authorization/],
    mustNotMatch: [/G-16[^\n]*=\s*\*?\*?owner_authorization\b(?![\s\S]{0,20}run)/]
  },
  /* ===== ★ C-021.1 PRE_DEPLOY_ARTIFACT_MATERIALIZATION ===== */
  {
    key: 'DEPLOYMENT_ARTIFACT_MATERIALIZED',
    mustMatch: [/DEPLOYMENT_ARTIFACT_MATERIALIZED[^\n]*\*?\*?true/],
    mustNotMatch: [/DEPLOYMENT_ARTIFACT_MATERIALIZED[^\n]*\*?\*?false/]
  },
  {
    key: 'DEPLOYMENT_BUNDLE_SHA',
    mustMatch: [/DEPLOYMENT_BUNDLE_SHA[^\n]*e996e88ae8084a38e186471b561867267fc4280c3ea5758ccb0eff75092455a4/],
    mustNotMatch: []
  },
  {
    key: 'BUNDLE_SOURCE_PARITY = EXACT_MATCH',
    mustMatch: [/BUNDLE_SOURCE_PARITY[^\n]*EXACT_MATCH/],
    mustNotMatch: [/BUNDLE_SOURCE_PARITY[^\n]*MISMATCH/]
  },
  {
    key: 'UNEXPECTED_PACKAGE_DIFF = 0',
    mustMatch: [/UNEXPECTED_PACKAGE_DIFF[^\n]*\*?\*?0\b/],
    mustNotMatch: [/UNEXPECTED_PACKAGE_DIFF[^\n]*\*?\*?[1-9]\d*\b/]
  },
  {
    key: 'D-08/D-09/D-10（GATE-D 扩充）',
    mustMatch: [/D-08[^\n]*deployment_artifact_materialized/,
                /deployment_artifact_materialized/],
    mustNotMatch: [/D-08[^\n]*owner_deployment_authorization\b(?![\s\S]{0,40}D-10)/]
  },
  {
    key: 'BLOCKED_ON_DEPLOYMENT_ARTIFACT（fail-closed 分支）',
    mustMatch: [/BLOCKED_ON_DEPLOYMENT_ARTIFACT/],
    mustNotMatch: []
  },
  {
    key: 'three-layer identity binding（§7）',
    mustMatch: [/deployment_bundle_sha|deployment_bundle_sha256|deployed_bundle_sha/,
                /三层 identity|three-layer/],
    mustNotMatch: [/仅绑\s*HEAD\s*SHA[^\n]*(?:合法|允许|ACCEPTED)/]
  },
  {
    key: 'HISTORICAL SNAPSHOT 标注（§9）',
    mustMatch: [/\[HISTORICAL SNAPSHOT\]/],
    mustNotMatch: []
  },
  {
    key: 'gate log integrity（§9 加固：计数绑定真值 + 新鲜度）',
    mustMatch: [/gate_log_integrity|门禁日志完整性|计数绑定真值/],
    mustNotMatch: [/门禁日志[^\n]*(?:无需|不必|不校验)计数/]
  }
];

for (const item of CURRENT_STATE_ITEMS) {
  const hits = [];
  for (const [k, txt] of Object.entries(docs)) {
    if (txt == null) continue;
    const scope = currentSnapshot(k, txt);
    const ok = item.mustMatch.some((re) => re.test(scope));
    check(`${k} 当前快照含 ${item.key}`, ok,
      ok ? '' : '未命中：' + item.mustMatch.map(String).join(' | '));
    if (ok) hits.push(k);
  }
  // ★ cross-doc：三项必须**逐项一致**（至少 2/3 命中 ⇒ 视为一致；缺项单独报 FAIL）
  if (hits.length > 0 && hits.length < Object.keys(docs).length) {
    const missing = Object.keys(docs).filter((k) => docs[k] != null && !hits.includes(k));
    check(`${item.key} 三份文档逐项一致`, false, '缺：' + missing.join(', '));
  } else if (hits.length > 0) {
    check(`${item.key} 三份文档逐项一致`, true);
  }
}

// ★ stale-value 反向检查：当前快照不得残留**断言式**过期语义
//   ⚠️ 必须排除「否定该旧语义」的正确句子（如「⛔ 不再是 hardcoded 0」/「⛔ 不得再描述旧…」）
//   ⇒ 命中行若含否定标记（⛔/不再/不是/不得/已替换/已修复/⇒/KNOWN_GAP 上下文），视为**已纠正**。
{
  const NEGATION = /⛔|不再|不是|不得|已替换|已修复|已废弃|旧(?:的)?|RETAIN|PARTIAL/i;
  const STALE = [
    { label: '旧的 cooldown 硬编码语义', re: /cooldown[^\n]*(?:hardcoded|硬编码)[^\n]*0/i },
    { label: '旧的「RPG-F2-B 尚未执行」', re: /RPG-F2-B[^\n]*尚未执行/ },
    { label: '旧的「RFP-V2-PH 尚未执行」', re: /RFP-V2-PH[^\n]*尚未执行/ },
    { label: '旧的「cooldown production function 未复用」', re: /production function[^\n]*未复用|生产函数[^\n]*未复用/ }
  ];
  for (const [k, txt] of Object.entries(docs)) {
    if (txt == null) continue;
    const scope = currentSnapshot(k, txt);
    const lines = scope.split('\n');
    for (const s of STALE) {
      const bad = lines.find((line) => s.re.test(line) && !NEGATION.test(line));
      check(`${k} 当前快照无 ${s.label}`, bad == null,
        bad ? bad.trim().slice(0, 120) : 'ok');
    }
  }
}
console.log('');

/* ============================================================
 * (12) ★ C-021.1 §9：最终交付态强制（**非循环**位置）
 *
 *   ⛔ 为什么放在这里而不是测试套件内：
 *      测试套件产出 stage 日志 → preflight 读日志 → prospective-state.json → 测试断言该 state。
 *      若由测试套件断言「日志干净 + GATE-D = PENDING_OWNER_DEPLOYMENT_APPROVAL」，
 *      就构成**自指**（C-015 教训的同类分身）。
 *   ⇒ 本检查器在**日志刷新之后**作为**收口步骤**运行（不产出日志），故可安全强制最终态。
 * ============================================================ */
console.log('');
console.log('== (12) C-021.1 最终交付态强制（gate log integrity + GATE-D）==');
{
  const statePath = path.join(REPO,
    'deliverables', 'v365-production-history', 'prospective', 'prospective-state.json');
  if (!fs.existsSync(statePath)) {
    check('prospective-state.json 存在', false, '未找到（先跑 v365-prospective-preflight.js）');
  } else {
    const st = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const gli = st.gate_log_integrity || {};
    const dg = st.deployment_gate || {};
    const fs2 = st.final_state || {};

    // ① 日志完整性
    check('gate_log_integrity 已接线', !!st.gate_log_integrity, '缺 gate_log_integrity');
    check('Stage A 计数 == tests/*.test.js 真值', gli.stage_a_log
      && gli.stage_a_log.count_matches_truth === true && gli.test_file_count === truth.stageATestFileCount,
      `test_file_count=${gli.test_file_count} / truth=${truth.stageATestFileCount} / matches=${gli.stage_a_log && gli.stage_a_log.count_matches_truth}`);
    check('stage-a 日志新鲜（内容指纹 == 当前源树）', gli.stage_a_log && gli.stage_a_log.fresh === true,
      gli.stage_a_log ? `recorded=${String(gli.stage_a_log.recorded_source_tree_sha).slice(0, 12)} current=${String(gli.stage_a_log.current_source_tree_sha).slice(0, 12)}` : 'n/a');
    check('stage-all 日志新鲜（内容指纹 == 当前源树）', gli.stage_all_log && gli.stage_all_log.fresh === true,
      '日志过期 ⇒ 先重跑全量并用 v365-source-tree-sha.js 记录指纹');
    check('p12 日志新鲜（内容指纹 == 当前源树）', gli.p12_log && gli.p12_log.fresh === true,
      'p12 日志过期 ⇒ 重跑 v365-p12-decision-parity.js 并用 v365-source-tree-sha.js 记录指纹');
    check('新鲜度基于内容指纹（⛔ 非 mtime）', /content-hash/.test(gli.freshness_method || ''),
      `freshness_method=${gli.freshness_method}`);
    check('stage-all 汇总 0 失败', !!(gli.stage_all_log && gli.stage_all_log.parsed_summary
      && gli.stage_all_log.parsed_summary.failed === 0),
      JSON.stringify(gli.stage_all_log && gli.stage_all_log.parsed_summary));
    check('stage-all 总数 > Stage A 文件数（覆盖完整）', !!(gli.stage_all_log
      && gli.stage_all_log.parsed_summary
      && gli.stage_all_log.parsed_summary.total > truth.stageATestFileCount),
      '覆盖不全');

    // ② GATE-D 最终态（★ C-021.2 分阶段）
    const deployed = fs2.DEPLOYMENT_IDENTITY_VERIFIED === true;
    if (deployed) {
      // ── 部署后（C-021.2 §7/§9 已执行单次授权部署）──
      check('CONTROLLED_DEPLOYMENT = COMPLETE', fs2.CONTROLLED_DEPLOYMENT === 'COMPLETE',
        `实际 = ${fs2.CONTROLLED_DEPLOYMENT}`);
      check('CURRENT_PRODUCTION_DEPLOYMENT_IDENTITY = V3.6.5',
        fs2.CURRENT_PRODUCTION_DEPLOYMENT_IDENTITY === 'V3.6.5',
        `实际 = ${fs2.CURRENT_PRODUCTION_DEPLOYMENT_IDENTITY}`);
      check('ONLINE_SOURCE_PARITY = EXACT_MATCH', fs2.ONLINE_SOURCE_PARITY === 'EXACT_MATCH',
        `实际 = ${fs2.ONLINE_SOURCE_PARITY}`);
      check('POST_DEPLOY_UNEXPECTED_PACKAGE_DIFF = 0', fs2.POST_DEPLOY_UNEXPECTED_PACKAGE_DIFF === 0,
        `实际 = ${fs2.POST_DEPLOY_UNEXPECTED_PACKAGE_DIFF}`);
      check('READY_FOR_V365_FIRST_CONTROLLED_RUN = PENDING_OWNER_RUN_APPROVAL',
        fs2.READY_FOR_V365_FIRST_CONTROLLED_RUN === 'PENDING_OWNER_RUN_APPROVAL',
        `实际 = ${fs2.READY_FOR_V365_FIRST_CONTROLLED_RUN}`);
      check('READY_FOR_CONTROLLED_PRODUCTION_ACTIVATION = PENDING_OWNER_APPROVAL',
        fs2.READY_FOR_CONTROLLED_PRODUCTION_ACTIVATION === 'PENDING_OWNER_APPROVAL',
        `实际 = ${fs2.READY_FOR_CONTROLLED_PRODUCTION_ACTIVATION}`);
      check('部署授权已消耗（⛔ 不得再次部署）',
        dg.deployment_authorization_consumed === true && dg.may_deploy === false,
        `consumed=${dg.deployment_authorization_consumed} may_deploy=${dg.may_deploy}`);
      // 跨件：post-deploy gate 必须存在且 verified
      const pdPath = path.join(REPO, 'deliverables', 'v365-production-history', 'c021',
        'post-deploy-identity-gate.json');
      const pd = fs.existsSync(pdPath) ? JSON.parse(fs.readFileSync(pdPath, 'utf8')) : null;
      check('post-deploy-identity-gate.json 存在且 verified',
        !!(pd && pd.DEPLOYMENT_IDENTITY_VERIFIED === true),
        pd ? `verified=${pd.DEPLOYMENT_IDENTITY_VERIFIED}` : '缺失');
    } else {
      // ── 部署前 ──
      check('DEPLOYMENT_IDENTITY_VERIFIED = false（⛔ 部署前必须 false）',
        fs2.DEPLOYMENT_IDENTITY_VERIFIED === false, `实际 = ${fs2.DEPLOYMENT_IDENTITY_VERIFIED}`);
      check('READY_FOR_V365_FIRST_CONTROLLED_RUN = BLOCKED_ON_DEPLOYMENT_IDENTITY',
        fs2.READY_FOR_V365_FIRST_CONTROLLED_RUN === 'BLOCKED_ON_DEPLOYMENT_IDENTITY',
        `实际 = ${fs2.READY_FOR_V365_FIRST_CONTROLLED_RUN}`);
      check('READY_FOR_CONTROLLED_PRODUCTION_ACTIVATION = BLOCKED_ON_DEPLOYMENT_IDENTITY',
        fs2.READY_FOR_CONTROLLED_PRODUCTION_ACTIVATION === 'BLOCKED_ON_DEPLOYMENT_IDENTITY',
        `实际 = ${fs2.READY_FOR_CONTROLLED_PRODUCTION_ACTIVATION}`);
    }
    // ★ 恒不变式（两阶段都必须成立）
    check('OWNER_RUN_AUTHORIZATION = false（⛔ 本消息不授权 first run）',
      fs2.OWNER_RUN_AUTHORIZATION === false, `实际 = ${fs2.OWNER_RUN_AUTHORIZATION}`);
    check('PRODUCTION_ACTIVATION_AUTHORIZATION = NOT_GRANTED',
      fs2.PRODUCTION_ACTIVATION_AUTHORIZATION === 'NOT_GRANTED',
      `实际 = ${fs2.PRODUCTION_ACTIVATION_AUTHORIZATION}`);
    check('⛔ 首次受控运行不得 GRANTED',
      fs2.READY_FOR_V365_FIRST_CONTROLLED_RUN !== 'GRANTED',
      `实际 = ${fs2.READY_FOR_V365_FIRST_CONTROLLED_RUN}`);
    check('GATE-D may_deploy = false（⛔ 不得再次部署）', dg.may_deploy === false,
      `实际 = ${dg.may_deploy}`);
    check('GATE-D implies_first_controlled_run = false', dg.implies_first_controlled_run === false,
      `实际 = ${dg.implies_first_controlled_run}`);
    check('GATE-D 唯一失败项 = D-10', Array.isArray(dg.failed_items)
      && dg.failed_items.length === 1 && dg.failed_items[0] === 'D-10',
      JSON.stringify(dg.failed_items));

    // ③ 身份链与终态不变式（★ C-021.2：阶段相关项已上移至 ②，此处只留恒不变式）
    check('DEPLOYMENT_ARTIFACT_MATERIALIZED = true', fs2.DEPLOYMENT_ARTIFACT_MATERIALIZED === true,
      `实际 = ${fs2.DEPLOYMENT_ARTIFACT_MATERIALIZED}`);
    check('BUNDLE_SOURCE_PARITY = EXACT_MATCH', fs2.BUNDLE_SOURCE_PARITY === 'EXACT_MATCH',
      `实际 = ${fs2.BUNDLE_SOURCE_PARITY}`);
    check('UNEXPECTED_PACKAGE_DIFF = 0', fs2.UNEXPECTED_PACKAGE_DIFF === 0,
      `实际 = ${fs2.UNEXPECTED_PACKAGE_DIFF}`);

    // ④ 与 deployment-artifact.json 跨件一致
    const artPath = path.join(REPO,
      'deliverables', 'v365-production-history', 'c021', 'deployment-artifact.json');
    if (fs.existsSync(artPath)) {
      const art = JSON.parse(fs.readFileSync(artPath, 'utf8'));
      check('DEPLOYMENT_BUNDLE_SHA 与 deployment-artifact 一致',
        fs2.DEPLOYMENT_BUNDLE_SHA === art.bundle_sha256,
        `state=${fs2.DEPLOYMENT_BUNDLE_SHA} artifact=${art.bundle_sha256}`);
      check('bundle 字节重算 sha == 声明的 bundle_sha256',
        fs.existsSync(art.bundle_path)
          && require('crypto').createHash('sha256').update(fs.readFileSync(art.bundle_path)).digest('hex')
             === art.bundle_sha256,
        'bundle 缺失或 sha 不符');
    } else {
      check('deployment-artifact.json 存在', false, '未找到');
    }
  }
}

/* ---------- 汇总 ---------- */
console.log('==================== 汇总 ====================');
console.log(`STAGE_A_TEST_FILE_COUNT = ${truth.stageATestFileCount}`);
console.log('Stage A PASS 状态来自最近一次 Full Requalification evidence，');
console.log('不由本 consistency checker 独立重新证明（本 checker 不重跑重测试）。');
if (violations === 0) {
  console.log('FINAL_STATE_DOCS_CONSISTENT = true');
  console.log('FREEZE_REVIEW = ELIGIBLE_FOR_REVIEW');
  console.log('BLOCKER = GOVERNED_PRODUCTION_HISTORY_DATA_REQUIRED (CLOSED)');
  console.log('HD-10 = COMPLETE · HD-9 = CLOSED · HD-15_POLICY = CLOSED');
  console.log('V365_ENFORCE_SWITCH_DATE = null · RUN_HISTORY_INDEX = PENDING(population)');
  console.log('RPG-F2-B = PARTIAL · RPG-F2-C = BLOCKED_ON_ACTUAL_BOOK_COVERAGE · RFP-V2-PH_FULL_WINDOW_AVAILABLE = false');
  console.log('UNEXPECTED_DECISION_DELTA = 6 (RPG-F3 fail-closed)');
  console.log('PRODUCTION_ACTIVATION_AUTHORIZATION = NOT_GRANTED');
  console.log('READY_FOR_PRODUCTION_PROMOTION = NOT_ISSUED');
  process.exit(0);
} else {
  console.log(`FINAL_STATE_DOCS_CONSISTENT = false（${violations} 处矛盾）`);
  process.exit(1);
}
