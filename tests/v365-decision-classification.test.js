#!/usr/bin/env node
/**
 * HD12-1 —— 决策分类**单一来源**专项测试（C-01 ~ C-11）
 *
 * 目的：把「分类真相源唯一」与「分类归属正确」机器化，防止 HD12-0 实测到的
 *       「两份硬编码 CORE 清单互相漂移」再次发生。
 *
 * 判据来源：`scripts/lib/v365-decision-classification.js`（唯一来源）。
 * ⛔ 本测试**不**修改任何生产文件；C-10 / C-11 通过子进程调用门禁脚本取证。
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const C = require(path.join(REPO, 'scripts', 'lib', 'v365-decision-classification.js'));

const PARITY = path.join(REPO, 'scripts', 'v365-p12-decision-parity.js');
const GATE = path.join(REPO, 'scripts', 'v365-qualification-gate.js');
const CLASSIFICATION_REL = 'scripts/lib/v365-decision-classification.js';

const ok = (n, d) => console.log(`[PASS] ${n}${d ? ' — ' + d : ''}`);

/* ---------------- 工具 ---------------- */
function listJsFiles(dir, acc) {
  const out = acc || [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') listJsFiles(p, out); }
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}
function runParity(changedListPath) {
  const args = [PARITY];
  if (changedListPath) args.push('--changed-file', changedListPath);
  return spawnSync(process.execPath, args, { cwd: REPO, encoding: 'utf8' });
}
function writeTmp(name, lines) {
  const p = path.join(os.tmpdir(), name);
  fs.writeFileSync(p, lines.join('\n') + '\n', 'utf8');
  return p;
}

/* ================= C-01 两个 gate 读取同一分类源 ================= */
{
  const paritySrc = fs.readFileSync(PARITY, 'utf8');
  const gateSrc = fs.readFileSync(GATE, 'utf8');
  assert.ok(/require\(\s*'\.\/lib\/v365-decision-classification\.js'\s*\)/.test(paritySrc),
    'parity gate 必须从 scripts/lib/v365-decision-classification.js 读取分类');
  assert.ok(/v365-decision-classification\.js/.test(gateSrc),
    'qualification gate 必须从同一分类源读取分类');
  // 两处 require 必须解析到**同一个**文件
  const resolved = path.resolve(REPO, CLASSIFICATION_REL);
  assert.ok(fs.existsSync(resolved), `分类源文件必须存在：${resolved}`);
  assert.ok(/^v365-decision-classification-v\d+$/.test(C.CLASSIFICATION_VERSION),
    `分类源版本号必须符合 v365-decision-classification-v<N>，实际 ${C.CLASSIFICATION_VERSION}`);
  ok('C-01 两个 gate 读取同一分类源', C.CLASSIFICATION_VERSION);
}

/* ================= C-02 不存在第二份 CORE 硬编码数组 ================= */
{
  // ⚠️ 探针设计说明（为什么不用「含 ≥N 个 CALC 字面量」这种粗判据）：
  //    `scripts/` 下确有若干**合法的**多字面量脚本 —— `v364-candidate-manifest.js`(11) ·
  //    `v365-p4-correlation-gate.js`(8) · `v364-freeze-manifest.js`(3) 等，
  //    它们是 **manifest 生成器 / 其他门禁的文件清单**，不是「决策核心清单」。
  //    ⇒ 粗判据会误报。故本测试改为三条**精确**判据：
  //      (a) 两个 gate 内不得再声明 CORE 数组
  //      (b) 两个 gate 内不得出现任何 CALC 字面量路径（必须经唯一来源）
  //      (c) 分类**词汇**（三个类别名）在 scripts/ 下只出现在唯一来源
  const TAXONOMY = ['DECISION_CALCULATION_CORE', 'DECISION_ORCHESTRATION', 'REPLAY_INFRASTRUCTURE'];

  // (a)
  for (const [name, p] of [['parity', PARITY], ['gate', GATE]]) {
    const src = fs.readFileSync(p, 'utf8');
    assert.ok(!/const\s+(DECISION_CORE|CORE)\s*=\s*\[/.test(src),
      `${name} 不得再硬编码 CORE 数组`);
  }

  // (b)
  // ⚠️ 必须**先剥离注释**再扫字面量（项目既有纪律：静态断言前先 strip 注释，
  //    否则解释性注释里的路径会误命中）。本测试首版就因此误报过一次。
  const stripComments = (s) => String(s)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  for (const [name, p] of [['parity', PARITY], ['gate', GATE]]) {
    const code = stripComments(fs.readFileSync(p, 'utf8'));
    const leaked = C.calcFiles().filter((f) => code.includes(f));
    assert.deepStrictEqual(leaked, [],
      `${name} 的**代码**（已剥离注释）内不得出现 CALC 字面量；实际泄漏 = ${JSON.stringify(leaked)}`);
  }

  // (c)
  const vocabFiles = listJsFiles(path.join(REPO, 'scripts'))
    .filter((p) => TAXONOMY.every((t) => fs.readFileSync(p, 'utf8').includes(t)))
    .map((p) => path.relative(REPO, p).split(path.sep).join('/'));
  assert.deepStrictEqual(vocabFiles, [CLASSIFICATION_REL],
    `分类词汇必须只存在于唯一来源；实际 = ${JSON.stringify(vocabFiles)}`);

  assert.ok(C.calcFiles().length >= 20, 'CALC 清单不得被掏空');
  ok('C-02 不存在第二份 CORE 硬编码数组',
    `词汇唯一=${CLASSIFICATION_REL} · 门禁内 CALC 字面量=0 · CALC=${C.calcFiles().length} 项`);
}

/* ================= C-03 ~ C-09 分类归属 ================= */
const CASES = [
  ['C-03', 'src/common/constants.js', 'CALC'],
  ['C-04', 'src/common/utils/v3-shadow.js', 'CALC'],
  ['C-05', 'src/common/utils/correlation.js', 'CALC'],
  ['C-06', 'src/common/utils/trade-date-idempotence.js', 'CALC'],
  ['C-07', 'src/common/utils/trade-date-progress.js', 'CALC'],
  ['C-08', 'src/common/utils/gen1-authority.js', 'CALC'],
  ['C-09', 'scripts/lib/v364-replay-harness.js', 'REPLAY_INFRA']
];
for (const [id, file, expect] of CASES) {
  const got = C.classify(file);
  assert.strictEqual(got, expect, `${id}: ${file} 应为 ${expect}，实际 ${got}`);
  ok(`${id} ${file} = ${expect}`);
}

/* ---- C-05 附加：correlation 必须带 replay 覆盖缺口元数据（不得因不可测而降级）---- */
{
  const m = C.meta('src/common/utils/correlation.js');
  assert.ok(m, 'correlation.js 必须有元数据');
  assert.strictEqual(m.replay_coverage, 'UNVERIFIED_PRODUCTION_BRANCH',
    'correlation.js 必须标注 replay_coverage = UNVERIFIED_PRODUCTION_BRANCH');
  assert.ok(/effective_tech_cap/.test(String(m.reason)),
    'correlation.js 的 reason 必须点明 effective_tech_cap 路径未被 replay 表达');
  const g = C.coverageGap('src/common/utils/correlation.js');
  assert.ok(g, 'correlation.js 必须登记在 REPLAY_COVERAGE_GAPS');
  assert.strictEqual(g.id, 'RPG-001');
  assert.strictEqual(g.replay_status, 'NOT_REPRESENTED');
  assert.strictEqual(g.severity, 'QUALIFICATION_SCOPE_LIMITATION');
  ok('C-05b correlation.js 携带 RPG-001 覆盖缺口元数据（未降级为 ORCH）',
    `${g.id} / ${g.replay_status} / ${g.severity}`);
}

/* ================= C-10 RDE 仍 fail-closed（无授权清单时）================= */
{
  const listPath = writeTmp('hd12-c10-changed.txt', ['cloudfunctions/runDecisionEngine/index.js']);
  const r = runParity(listPath);
  assert.ok(r.error == null, `parity 子进程必须可运行（error=${r.error && r.error.code}）`);
  assert.notStrictEqual(r.status, 0,
    'RDE 改动且**未提供授权清单**时必须 FAIL（HD12-2 的 fail-closed 默认）');
  // ⚠️ HD12-2 已把判据从「受保护文件零改动」升级为「变更已授权」；
  //    RDE（MIXED）在**无授权清单**时仍必须 FAIL。
  assert.ok(/受保护文件变更已授权/.test(String(r.stdout)),
    'parity 输出必须命中「受保护文件变更已授权」判据');
  assert.ok(/APPROVAL_MISSING/.test(String(r.stdout)),
    '无授权清单时应以 APPROVAL_MISSING 拒绝');
  assert.strictEqual(C.classify('cloudfunctions/runDecisionEngine/index.js'), 'MIXED',
    'RDE 必须表示为 MIXED（不得整体归 ORCH）');
  assert.ok(C.allProtected().includes('cloudfunctions/runDecisionEngine/index.js'),
    'RDE 必须在受保护集合内');
  fs.unlinkSync(listPath);
  ok('C-10 RDE 无授权 ⇒ fail-closed（MIXED + 受保护）', `exit=${r.status}`);
}

/* ================= C-11 仓外 shim 不进入 repo dependency set ================= */
{
  const r = runParity(null);
  assert.ok(r.error == null, 'parity 子进程必须可运行');
  const out = String(r.stdout);
  const m = out.match(/回放依赖集大小\s*=\s*(\d+)/);
  assert.ok(m, 'parity 必须打印回放依赖集大小');
  const reported = Number(m[1]);

  // ⚠️ 必须在**独立子进程**里复算 —— 测试进程自身的 require.cache 已被本测试污染
  //    （顶部 require 了分类模块），与门禁进程的 cache 不可比。
  //    复算脚本**只** require harness（与门禁在计算 loadedDeps 时的状态一致）。
  const probeSrc = [
    "'use strict';",
    `const path = require('path');`,
    `const REPO = ${JSON.stringify(REPO)};`,
    `const rel = (p) => path.relative(REPO, p).split(path.sep).join('/');`,
    `require(path.join(REPO, 'scripts', 'lib', 'v364-replay-harness.js'));`,
    `const A = path.resolve(REPO);`,
    `const inside = (p) => { const q = path.resolve(p); return q === A || q.startsWith(A + path.sep); };`,
    `const keys = Object.keys(require.cache);`,
    `const raw = new Set(keys.map(rel).filter((p) => p && !p.startsWith('..'))).size;`,
    `const repo = new Set(keys.filter(inside).map(rel).filter((p) => p && !p.startsWith('..'))).size;`,
    `console.log(JSON.stringify({ raw, repo, outOfRepo: raw - repo }));`
  ].join('\n');
  const probePath = writeTmp('hd12-c11-probe.js', probeSrc.split('\n'));
  const pr = spawnSync(process.execPath, [probePath], { cwd: REPO, encoding: 'utf8' });
  fs.unlinkSync(probePath);
  assert.ok(pr.error == null && pr.status === 0,
    `复算子进程必须成功（status=${pr.status}）: ${pr.stderr}`);
  const { raw, repo, outOfRepo } = JSON.parse(String(pr.stdout).trim().split('\n').pop());

  // ① 确实存在仓外条目（否则本判据无意义）
  assert.ok(outOfRepo > 0, `本机应能观察到仓外条目（raw=${raw} repo=${repo}）`);
  // ② 门禁的计数 == 只计仓内的计数
  assert.strictEqual(reported, repo,
    `门禁计数必须等于「只计仓内」计数：门禁=${reported} 复算=${repo}（未过滤时=${raw}）`);
  // ③ 输出中不得出现宿主 shim 痕迹
  assert.ok(!/shim/i.test(out), '门禁输出不得出现宿主 shim 痕迹');
  ok('C-11 仓外 shim 已排除（repo-only dependency set）',
    `门禁=${reported} · 复算 repo=${repo} · 未过滤=${raw}（剔除 ${outOfRepo} 条仓外）`);
}

/* ================= C-12 protected-domain + UNCLASSIFIED ⇒ FAIL ================= */
{
  // 受保护域内、且**未登记**的路径（模拟"新增了一个未定性的 utils 文件"）
  const FAKE = 'src/common/utils/__hd12_1_1_unregistered__.js';
  assert.ok(C.isInProtectedDomain(FAKE), '该路径必须落在受保护域内');
  assert.strictEqual(C.classify(FAKE), 'UNCLASSIFIED', '该路径必须未登记');
  assert.deepStrictEqual(C.protectedDomainViolations([FAKE]), [FAKE], '纯函数必须判定为违规');

  const listPath = writeTmp('hd12-c12-changed.txt', [FAKE]);
  const r = runParity(listPath);
  fs.unlinkSync(listPath);
  assert.ok(r.error == null, 'parity 子进程必须可运行');
  assert.notStrictEqual(r.status, 0, '受保护域内未登记文件必须 FAIL');
  assert.ok(/受保护域内无未登记文件/.test(String(r.stdout)),
    'parity 输出必须命中「受保护域内无未登记文件」判据');
  ok('C-12 protected-domain + UNCLASSIFIED ⇒ FAIL', `exit=${r.status}`);
}

/* ================= C-13 / C-14 / C-15 域外 UNCLASSIFIED 不因分类失败 ================= */
{
  const OUTSIDE = [
    'docs/__hd12_1_1_probe__.md',        // C-13
    'tests/__hd12_1_1_probe__.test.js',  // C-14
    'scripts/__hd12_1_1_probe__.js'      // C-15
  ];
  // 纯函数层：域外一律不违规
  assert.deepStrictEqual(C.protectedDomainViolations(OUTSIDE), [],
    '域外文件不得被 protected-domain 判据命中');
  for (const f of OUTSIDE) {
    assert.strictEqual(C.isInProtectedDomain(f), false, `${f} 不应属受保护域`);
    assert.strictEqual(C.classify(f), 'UNCLASSIFIED', `${f} 应未登记（用于验证"未登记≠失败"）`);
  }
  // 门禁行为层：一份只含域外未登记文件的清单必须整体 PASS
  const listPath = writeTmp('hd12-c13-15-changed.txt', OUTSIDE);
  const r = runParity(listPath);
  fs.unlinkSync(listPath);
  assert.ok(r.error == null, 'parity 子进程必须可运行');
  assert.strictEqual(r.status, 0, '域外未登记文件不得导致 FAIL');
  assert.ok(/受保护域内无未登记文件/.test(String(r.stdout))
    && /PASS\] 受保护域内无未登记文件/.test(String(r.stdout)),
    '域内判据必须 PASS');
  ok('C-13 docs/** UNCLASSIFIED ⇒ 不因分类失败', 'protectedDomainViolations=[]');
  ok('C-14 tests/** UNCLASSIFIED ⇒ 不因分类失败', 'protectedDomainViolations=[]');
  ok('C-15 普通 scripts/** UNCLASSIFIED ⇒ 不因分类失败', 'protectedDomainViolations=[] · 门禁 exit=0');
}

/* ================= C-16 cooldown.js 分类与实际数据流一致 ================= */
{
  // ① 分类
  assert.strictEqual(C.classify('src/common/utils/cooldown.js'), 'CALC',
    'cooldown.js 必须为 CALC（它可阻止 ADD 动作生效）');

  // ② 数据流证据：cooldown 闸门确实进入 eligibility，并影响 finalAction
  const dec = fs.readFileSync(path.join(REPO, 'src/common/utils/decision.js'), 'utf8');
  const v3 = fs.readFileSync(path.join(REPO, 'src/common/utils/decision-v3.js'), 'utf8');
  assert.ok(/cooldownDays\s*>\s*0\s*\?\s*'pause'\s*:\s*'ok'/.test(dec),
    'decision.js 必须存在 cooldown>0 ⇒ pause 的闸门判定');
  assert.ok(/items\s*=\s*\{[^}]*cooldown:\s*cooldownCheck/.test(dec),
    'decision.js 必须把 cooldown 闸门并入 items');
  assert.ok(/'cooldown'/.test(v3) && /eligibilityOverall/.test(v3),
    'decision-v3.js 必须把 cooldown 纳入闸门清单并汇入 eligibilityOverall');
  assert.ok(/eligibilityOverall === 'allow'\) return current <= 0 \? 'BUILD' : 'ADD'/.test(v3),
    'decision-v3.js 的 finalAction 必须受 eligibilityOverall 约束');

  // ③ 覆盖缺口必须登记（机器可读，非仅 markdown）
  const g = C.coverageGap('src/common/utils/cooldown.js');
  assert.ok(g, 'cooldown.js 必须登记在 REPLAY_COVERAGE_GAPS');
  assert.strictEqual(g.id, 'RPG-002');
  assert.strictEqual(g.severity, 'QUALIFICATION_SCOPE_LIMITATION');
  assert.ok(C.REPLAY_COVERAGE_GAPS.some((x) => x.id === 'RPG-001'), 'RPG-001 必须仍在册');

  // ④ replay 侧证据 —— ★ RPG-F2-B 实施后的**语义纠正**（owner 裁定，见
  //    `docs/V365_RPG_F2B_REPLAY_INFRA_CHANGE_RECORD.md`）：
  //    ⛔ 旧断言要求 harness **必须**硬编码 `cooldownDays: 0`（因为那曾是 RPG-002 的成因，
  //       断言它'存在'等于断言缺口存在 —— 这在缺口已修复后成为**反向锁死**）。
  //    ✅ 正确断言：harness 的**默认 V1 路径**仍不注入 cooldown（保持 V1 anchor 逐位不变），
  //       但 harness **已具备**注入 cooldown 的协议（V2 / V2-CF-COOLDOWN / V2-AE），
  //       且**复用生产** `computeCooldownDays()`（⛔ 不得自行实现天数分档）。
  const h = fs.readFileSync(path.join(REPO, 'scripts/lib/v364-replay-harness.js'), 'utf8');
  // V1/V2-CF 路径：cooldownDays 初值必须为 0，且仅在 useCooldown 时被改写
  // ⇒ 未启用 cooldown 的协议行为逐位不变（V1 anchor 因此不动）。
  assert.ok(/cooldownDays\s*=\s*0/.test(h),
    'harness 的默认（V1/V2-CF）路径必须保持 cooldownDays = 0 ⇒ V1 anchor 逐位不变');
  assert.ok(/if\s*\(useCooldown\)/.test(h),
    'cooldown 注入必须由 useCooldown 协议开关守护（⛔ 不得无条件注入）');
  assert.ok(/computeCooldownDays/.test(h),
    'harness 必须复用生产 computeCooldownDays()（⛔ 不得自实现天数分档）');
  assert.ok(/'V2-CF-COOLDOWN'/.test(h) && /'V2-AE'/.test(h),
    'harness 必须支持 V2-CF-COOLDOWN（synthetic）与 V2-AE（actual execution）两条协议');
  assert.ok(/GOVERNED_ACTUAL_EXECUTION/.test(h) && /SYNTHETIC_COUNTERFACTUAL_DECISION_IMPLIED/.test(h),
    'harness 必须显式区分两种 ledger_source（⛔ 不得混用）');

  // ⑤ 覆盖缺口仍须登记（缺口 = RPG-002，但**状态**随修复推进；
  //    ⛔ owner 裁定：产出正确 actual-execution replay 后方可重裁，
  //       此处只断言"在册"，不断言 replay_status 的具体字面值）。
  assert.strictEqual(g.id, 'RPG-002');

  ok('C-16 cooldown.js 分类与实际数据流一致',
    'CALC · 闸门证据齐 · RPG-002 在册 · harness 已具备 cooldown 注入协议');
}

/* ================= C-17 受保护域中无未审计的 UNCLASSIFIED 决策相关文件 ================= */
{
  // 逐文件枚举 src/common/utils/**，要求全部已定性
  const utilsDir = path.join(REPO, 'src/common/utils');
  const files = fs.readdirSync(utilsDir).filter((f) => f.endsWith('.js'))
    .map((f) => `src/common/utils/${f}`);
  const unclassified = files.filter((f) => C.classify(f) === 'UNCLASSIFIED');
  assert.deepStrictEqual(unclassified, [],
    `src/common/utils/** 不得存在未定性文件；实际 = ${JSON.stringify(unclassified)}`);

  // 受保护域整体（含 constants / RDE / INFRA）亦不得有未定性文件
  const domainProbe = [
    'src/common/constants.js',
    'cloudfunctions/runDecisionEngine/index.js',
    ...files
  ];
  assert.deepStrictEqual(C.protectedDomainViolations(domainProbe), [],
    '受保护域内不得存在未登记文件');

  // 审计表自述
  const audit = C.CLASSIFICATION_AUDIT[0];
  assert.strictEqual(audit.scope, 'src/common/utils/**');
  assert.strictEqual(audit.total, files.length, '审计总数必须等于实际文件数');
  assert.strictEqual(audit.audited, files.length, '审计覆盖数必须等于实际文件数');
  assert.strictEqual(audit.unknown_decision_relevance, 0,
    'UNKNOWN_DECISION_RELEVANCE 必须为 0');

  // 分类计数一致性（避免"登记了但计数不对"）
  const calcUtils = files.filter((f) => C.classify(f) === 'CALC').length;
  const orchUtils = files.filter((f) => C.classify(f) === 'ORCH').length;
  const excUtils = files.filter((f) => C.classify(f) === 'EXCEPTION').length;
  assert.strictEqual(calcUtils + orchUtils + excUtils, files.length,
    `CALC(${calcUtils}) + ORCH(${orchUtils}) + EXCEPTION(${excUtils}) 必须等于 ${files.length}`);

  ok('C-17 受保护域中无未审计的 UNCLASSIFIED 文件',
    `${files.length} 文件全定性 · CALC=${calcUtils} ORCH=${orchUtils} EXC=${excUtils} · UNKNOWN=0`);
}

console.log('\nHD12-1 分类专项测试：C-01 ~ C-17 全部 PASS');
