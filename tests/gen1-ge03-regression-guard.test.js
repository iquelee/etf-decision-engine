'use strict';

/**
 * WP-G1-GE-03 G3-08：回归守卫（门禁身份 / 静态 allowlist / 登记集合 / V3 不可变 / 证据通道）。
 *
 * 覆盖设计 Gate §5 的 D5 / D6 / D8 / D9 / D11 / D12 与 §3.2 的 R1 / R4 / R6 / R8。
 *
 * ⚠️ **D12 的口径（本测试的判定依据；⛔ 不得读成「全库 registered === actual write」）**
 *
 *   D12 的**命名域是 `N4`**，其实测值「schema 登记 14 项 vs 真实写入 16 项」来源于
 *   `src/common/utils/gen1-overlay.js` 的**新增审计字段**写入路径（GE-03-02 已收口）。
 *   ⇒ 机器判据 = 「**新增 / 变化字段必须同步注册**」，即本测试的 C1 / C2：
 *       ① overlay 的**全部** `out.X =` 写入必须已登记（差集为空）；
 *       ② `OVERLAY_NEW_KEYS`（N4 新增字段集）⊆ 登记集，且逐字段赋值点恰 1（无幽灵项）；
 *       ③ 此后任何新增字段若未同步注册 ⇒ 本测试**立即打红**（C3 的前向 fail-closed）。
 *
 *   ⛔ 本测试**不**断言「全库集合相等」：`SCHEMAS[].fields` 是**精选登记**（其自述用途见
 *      `src/common/schema.js` 的 G1.3-10 注释块 —— 集合创建 + 索引；集合级 parity 由
 *      `tests/schema-collections-parity.test.js` 守卫）。实测：
 *        · `decision_result` 的真实写入并集 **133** 项，其中 **43** 项未登记 —— 且这 43 项
 *          几乎全部是 **immutable V3 引擎自身**的输出键（`trend_stage*` / `defense_*` /
 *          `engine_path` / `v32_breakdown` …）；V3 字节由 `ml/manifests/V361_IMMUTABLE_LOCK.json`
 *          锁死 ⇒ 其键集**传递性锁定**，本测试不重复枚举。
 *        · `runtime_status` 实测写入 **61** 项，其中 **34** 项未登记 —— 全部为 GE-03 **之前**
 *          的既有字段（0 项属 GE-03 新增）。
 *      凡未经 owner 裁定的历史登记缺口，一律**只登记不判红**（见下方 `LEGACY_UNREG_*`），
 *      但**新增**缺口会被立即打红。
 *
 *   **枚举域（as-of 本文件落笔）**：
 *       ① `gen1-overlay.js` 的 `out.X =` 写入
 *       ② `runDecisionEngine/index.js` 的 `result.X =` 写入
 *       ③ `decision.js#buildWaitResult` 的返回键
 *       ④ `runDecisionEngine/index.js` 的 `runtimeStatus` 字面量键
 *       ⑤ immutable V3（`decision-v3.js#runDecisionV3` 返回键）—— 由 SHA lock 覆盖，不枚举
 *       ⑥ 其余 11 个集合 —— **未测量**，不在本测试判定域内。
 *
 *   ⚠️ GE-03 自身新增的 3 个字段（`gen1_guarded_shadow_eligible_count` /
 *      `gen1_guarded_shadow_invocations` / `gen1_guarded_shadow_source`）**全部已同步注册**，
 *      且不得出现在任何 `LEGACY_UNREG_*` 清单里（C3 显式断言）。
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const NODE = process.execPath;

const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
/** LF 归一化读（本仓工作区是 CRLF；`^…$` 多行断言必须用 LF 文本）。 */
const readLF = (rel) => read(rel).replace(/\r\n/g, '\n');
const exists = (rel) => fs.existsSync(path.join(REPO, rel));
/** 去块注释 / 行注释（保留字符串字面量），用于源码级断言。 */
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
/** 与 scripts/verify-immutable.js 同口径：\r\n → \n 归一化后 sha256。 */
const sha256lf = (rel) => crypto.createHash('sha256')
  .update(read(rel).replace(/\r\n/g, '\n')).digest('hex');

/** 取 `const <name> = [ … ];` 内的字符串字面量清单（剔除注释）。 */
function literalList(src, name) {
  const head = `const ${name} = [`;
  const i = src.indexOf(head);
  assert.ok(i > 0, `★ 必须存在 ${head}`);
  const j = src.indexOf('];', i);
  assert.ok(j > i, `★ ${name} 数组必须闭合`);
  const body = src.slice(i + head.length, j).replace(/\/\/.*$/gm, '');
  return {
    body,
    keys: (body.match(/'([A-Za-z_][A-Za-z0-9_]*)'/g) || []).map((s) => s.slice(1, -1))
  };
}

const RDE_REL = 'cloudfunctions/runDecisionEngine/index.js';
const OVL_REL = 'src/common/utils/gen1-overlay.js';
const PARITY_REL = 'scripts/gen1-guarded-parity-local.js';
const GATES_REL = 'scripts/gen1-production-gates.js';
const VI_REL = 'scripts/verify-immutable.js';

/* ==================================================================== *
 * A. D8 —— 门禁身份（锁 ID 与 id→script 映射，不只锁「全绿」）
 * ==================================================================== */
{
  /* 既有 25 门（as-of base 5c517bc；⛔ 不得删除 / 改名 / 改绑 / 重排） */
  const LEGACY_GATES = [
    ['G1-A', 'scripts/verify-immutable.js'],
    ['G1-B', 'scripts/verify-gen1-pipeline.js'],
    ['G1-C', 'tests/gen1-parity.test.js'],
    ['G1-D', 'tests/gen1-safety-permission.test.js'],
    ['G1-E', 'tests/gen1-domain-gate.test.js'],
    ['G1-F', 'tests/gen1-circuit-breaker.test.js'],
    ['G1-G', 'tests/gen1-execution-boundary.test.js'],
    ['G1-H', 'tests/gen1-overlay-noop.test.js'],
    ['G1-I', 'tests/gen1-safety-permission.test.js'],
    ['G1-J', 'scripts/audit-gen1-sector-contract.js'],
    ['G1-K', 'tests/gen1-persistent-health.test.js'],
    ['G1-L', 'tests/gen1-economic-health.test.js'],
    ['G1-M', 'tests/gen1-canary-portfolio.test.js'],
    ['G1-N', 'tests/gen1-health-single-truth.test.js'],
    ['G1-O', 'tests/gen1-health-failclosed.test.js'],
    ['G1-P', 'tests/gen1-runtime-single-truth.test.js'],
    ['G1-Q', 'tests/gen1-economic-health.test.js'],
    ['G1-R', 'tests/gen1-counterfactual-ledger-static.test.js'],
    ['G1-S', 'tests/schema-collections-parity.test.js'],
    ['G1-T', 'tests/gen1-benchmark-pipeline.test.js'],
    ['G1-U', 'tests/gen1-daily-finality.test.js'],
    ['G1-V', 'tests/gen1-guarded-effective-authority.test.js'],
    ['G1-W', 'tests/gen1-guarded-effective-gates.test.js'],
    ['G1-X', 'tests/gen1-guarded-selector-noop.test.js'],
    ['G1-Y', 'tests/gen1-authority-frozen-param.test.js']
  ];
  /* GE-03 新增 6 门：与 GE-03 的 6 个测试文件一一对应（逐 ID 独立门控） */
  const GE03_GATES = [
    ['G1-Z', 'tests/gen1-shadow-eligibility.test.js'],
    ['G1-AA', 'tests/gen1-guarded-shadow-rerun.test.js'],
    ['G1-AB', 'tests/gen1-guarded-shadow-invocations.test.js'],
    ['G1-AC', 'tests/gen1-ge03-replay-determinism.test.js'],
    ['G1-AD', 'tests/gen1-ge03-selector-security.test.js'],
    ['G1-AE', 'tests/gen1-ge03-regression-guard.test.js']
  ];

  const GATES_SRC = read(GATES_REL);
  const pairs = [...GATES_SRC.matchAll(
    /\{ id: '(G1-[A-Z]+)', name: '([^']*)', script: '([^']*)' \}/g
  )].map((m) => [m[1], m[2], m[3]]);
  const ids = pairs.map((p) => p[0]);

  assert.strictEqual(pairs.length, LEGACY_GATES.length + GE03_GATES.length,
    '★ D8：Gate 总数必须 = 25 既有 + 6 GE-03 新增（⛔ 不得以新增门替代/顶掉旧门）');
  assert.strictEqual(new Set(ids).size, ids.length, '★ D8：Gate ID 不得重复');

  /* ① 既有 25 门必须是**原序前缀**（顺序即身份：⛔ 禁删除 / 改名 / 重排） */
  assert.deepStrictEqual(pairs.slice(0, LEGACY_GATES.length).map((p) => p[0]),
    LEGACY_GATES.map((p) => p[0]),
    '★ D8：既有 G1-A … G1-Y 必须原序存在（⛔ 禁删除 / 改名 / 重排）');
  /* ② id→script 绑定逐项不变（⛔ 禁「降级」：把旧门指到更弱的脚本） */
  assert.deepStrictEqual(pairs.slice(0, LEGACY_GATES.length).map((p) => [p[0], p[2]]),
    LEGACY_GATES, '★ D8：既有 25 个 ID 的 script 绑定不得变化（⛔ 禁降级判据）');

  /* ③ GE-03 新增门必须**追加**在尾部，且绑定到既定测试文件 */
  for (const [id, script] of GE03_GATES) {
    const row = pairs.filter((p) => p[0] === id);
    assert.strictEqual(row.length, 1, `★ D8：GE-03 新增 Gate ${id} 必须恰好出现一次`);
    assert.strictEqual(row[0][2], script, `★ D8：${id} 必须绑定 ${script}`);
    assert.ok(ids.indexOf(id) >= LEGACY_GATES.length,
      `★ D8：${id} 必须是**追加**（⛔ 不得插队顶替既有门）`);
  }

  /* ④ 每个门禁脚本必须真实存在；横幅必须同步 */
  for (const p of pairs) {
    assert.ok(exists(p[2]), `★ D8：门禁脚本必须存在：${p[2]}（${p[0]}）`);
    assert.ok(String(p[1]).length > 0, `★ D8：${p[0]} 必须有 name`);
  }
  assert.ok(/G1-A ~ G1-AE/.test(GATES_SRC),
    '★ D8：门禁横幅必须同步为 G1-A ~ G1-AE（⛔ 不得只加门不改横幅）');
  assert.ok(/GATES\.length - failed/.test(GATES_SRC),
    '★ D8：通过数必须动态取值（⛔ 禁硬编码 25，防「加门后仍报 25/25」）');
}

/* ==================================================================== *
 * A2. R6 —— immutable 身份（23 / 23 + root-of-trust 锚点逐字节不变）
 * ==================================================================== */
{
  const VI = readLF(VI_REL);
  /* root-of-trust 锚点：⛔ 恒定不变；任何「lock + frozen 一起改」的绕过都会先在这里打红 */
  const ROOT_ANCHORS = {
    'ml/manifests/GEN1_IMMUTABLE_LOCK.json':
      '138fe886a9f50440f717eaa0739d3144fd5e6418fc8d3d2ad03d1643320501c0',
    'ml/manifests/V361_IMMUTABLE_LOCK.json':
      '1c724381e533dd51e4fd0268bdc14aca0b4f444a458eab6c75c97be78a78f1bd',
    'ml/gen2/manifests/GEN2_RULE_V2_LOCK.json':
      'd3d40f99dd3d766bd326bf11cc81dcc1168fde4d59693187f1154b2a9e7b2d9c'
  };
  for (const [lock, sha] of Object.entries(ROOT_ANCHORS)) {
    assert.ok(VI.indexOf(`{ lock: '${lock}', sha256: '${sha}' }`) >= 0,
      `★ R6：root-of-trust 锚点必须原样保留：${lock}`);
    assert.strictEqual(sha256lf(lock), sha, `★ R6：lock 文件真 SHA 不得变化：${lock}`);
  }
  /* Gen-2 冻结条目身份（少一条也会 PASS 的旧形态不得回归） */
  assert.ok(/const G2_FROZEN_EXPECT = 8;/.test(VI), '★ R6：GEN2 lock 冻结条目数必须仍为 8');
  const G2_IDS = ['bundle', 'js_implementation', 'python_rule', 'python_candidate',
    'python_defense', 'python_role_thresholds', 'python_selection_scores', 'python_regime'];
  for (const id of G2_IDS) {
    assert.ok(new RegExp(`'${id}'`).test(VI), `★ R6：immutable_set 必需 id 不得删除：${id}`);
  }

  /* 实跑：既有 23 / 23 必须保持（⛔ 不以「脚本 exit 0」代替身份断言） */
  const r = spawnSync(NODE, [path.join(REPO, VI_REL)], { cwd: REPO, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, '★ D8：scripts/verify-immutable.js 必须整体 PASS');
  assert.ok(/23\/23 项锁定/.test(r.stdout || ''),
    '★ D8：既有 immutable **23 / 23** 身份必须保持（⛔ 条目被删也 exit 0 的旧形态不得回归）');
}

/* ==================================================================== *
 * B. D9 —— 平价 AND 口径（静态 allowlist 逐字段冻结 + 门禁必须可失败）
 * ==================================================================== */
{
  const PARITY = read(PARITY_REL);
  const PCODE = codeOnly(PARITY);

  const PERM = literalList(PARITY, 'PERM_NEW_KEYS');
  const AUTH = literalList(PARITY, 'AUTH_NEW_KEYS');
  const OVK = literalList(PARITY, 'OVERLAY_NEW_KEYS');

  /* B1. 三个 allowlist 的内容逐字段冻结（⛔ 数量不锁死 → 由集合相等断言承担） */
  assert.deepStrictEqual(PERM.keys, ['effective_guarded', 'guarded'],
    '★ D9②：permission 新增字段 allowlist 必须逐字段冻结');
  assert.deepStrictEqual(AUTH.keys, ['guarded_effective_authorized'],
    '★ D9②：authority 新增字段 allowlist 必须逐字段冻结');
  const OVK_EXPECT = [
    'decision_source', 'gen1_run_id', 'gen1_candidate_hash', 'gen1_adopted',
    'gen1_reject_reason_code', 'gen1_safety_core_adjust_reason',
    'gen1_guarded_baseline_stage', 'gen1_guarded_effective_stage',
    'gen1_guarded_baseline_target', 'gen1_guarded_result_target', 'gen1_guarded_delta',
    'gen1_guarded_selector_source', 'gen1_effective_guarded', 'gen1_guarded_reason_code',
    'gen1_guarded_freeze_seal_status', 'gen1_guarded_evidence_seal_status',
    'gen1_guarded_shadow_source'
  ];
  assert.deepStrictEqual(OVK.keys.slice().sort(), OVK_EXPECT.slice().sort(),
    '★ D9②：overlay 新增字段 allowlist 必须逐字段冻结（GE-03 新增 gen1_guarded_shadow_source）');
  assert.strictEqual(new Set(OVK.keys).size, OVK.keys.length, '★ D9②：allowlist 不得有重复项');

  /* B2. ⛔ 禁 wildcard / 禁运行时动态扩大（这是 D9② 的核心禁令） */
  for (const [name, L] of [['PERM_NEW_KEYS', PERM], ['AUTH_NEW_KEYS', AUTH], ['OVERLAY_NEW_KEYS', OVK]]) {
    const stripped = L.body.replace(/'[^']*'/g, 'Q');
    assert.ok(/^[\s,Q]*$/.test(stripped),
      `★ D9②：${name} 只允许**字面量**逐字段列出（⛔ 禁变量 / 表达式 / wildcard）：${JSON.stringify(stripped.slice(0, 60))}`);
    assert.ok(!/[.*+?]/.test(L.body), `★ D9②：⛔ 禁 wildcard：${name}`);
    assert.ok(!new RegExp(`${name}\\s*\\.push\\(`).test(PCODE), `★ D9②：⛔ 禁运行时追加 ${name}`);
    assert.ok(!new RegExp(`${name}\\s*=\\s*\\[\\s*\\.\\.\\.`).test(PCODE), `★ D9②：⛔ 禁 spread 扩大 ${name}`);
    assert.ok(!new RegExp(`${name}\\s*=(?!\\s*\\[)`).test(PCODE), `★ D9②：⛔ 禁运行时重绑定 ${name}`);
  }

  /* B3. D9①：既有 38 个平价场景不得减少；⛔ 白名单不得替代 parity */
  const scCount = (PCODE.match(/\{ label: '/g) || []).length;
  assert.ok(scCount >= 38, `★ D9①：既有平价场景数不得减少（实测 ${scCount}，as-of 基线 38）`);
  assert.ok(/outExtra\.length !== OVERLAY_NEW_KEYS\.length/.test(PCODE),
    '★ D9②：新增字段数必须与 allowlist 长度**双向绑定**（只登记不落地 / 只落地不登记 都要打红）');
  assert.ok(/newPerm\.effective_guarded !== false/.test(PCODE),
    '★ D9①：未注入封印时 effective_guarded 必须为 false（parity 必须覆盖 dormant 口径）');

  /* B4. D7：平价门禁必须**可失败**，且缺基线树必须 fail-closed（⛔ 不得静默 PASS） */
  assert.ok(/if \(rows\.length\)/.test(PCODE) && /process\.exit\(1\)/.test(PCODE),
    '★ D7：平价门禁必须可失败');
  assert.ok(/process\.exit\(2\)/.test(PCODE),
    '★ 缺基线树必须 fail-closed（exit 2）—— ⛔ 不得 exit 0 静默通过');
  assert.ok(!/process\.exit\(0\)/.test(PCODE), '★ ⛔ 平价脚本不得显式 exit 0');
}

/* ==================================================================== *
 * C. D12 —— 登记集合（N4 域严格；历史缺口只登记不判红 + 前向 fail-closed）
 * ==================================================================== */
{
  const { getSchema } = require(path.join(REPO, 'src/common/schema.js'));
  const dr = getSchema('decision_result');
  const rs = getSchema('runtime_status');
  assert.ok(dr && dr.fields && rs && rs.fields, '★ 两个集合的 schema 必须存在');
  const drSet = new Set(Object.keys(dr.fields));
  const rsSet = new Set(Object.keys(rs.fields));

  /* ---- C1. N4 域严格：overlay 的**全部**写入必须已登记（14 / 16 的机器判定形式） ---- */
  const OVL = codeOnly(read(OVL_REL));
  const ovlWrites = [...new Set(
    [...OVL.matchAll(/out\.([A-Za-z_][A-Za-z0-9_]*)\s*=/g)].map((m) => m[1])
  )];
  assert.ok(ovlWrites.length > 50,
    `★ 探针有效性：overlay 写入字段数应 > 50（实测 ${ovlWrites.length}）`);
  assert.deepStrictEqual(ovlWrites.filter((k) => !drSet.has(k)).sort(), [],
    '★ D12：overlay 写入字段必须**全部**已登记（⛔ 不得出现「写了但没登记」的字段）');

  /* ---- C2. N4 新增字段集 ⊆ 登记集，且逐字段赋值点恰 1（无幽灵项） ---- */
  const OVK = literalList(read(PARITY_REL), 'OVERLAY_NEW_KEYS').keys;
  for (const k of OVK) {
    assert.ok(drSet.has(k), `★ D12：N4 新增字段 ${k} 必须已在 decision_result 登记`);
    assert.strictEqual((OVL.match(new RegExp('out\\.' + k + '\\s*=', 'g')) || []).length, 1,
      `★ D12：${k} 在 overlay 的赋值点必须恰 1 处`);
  }

  /* ---- C2b. 审计面（buildGuardedAudit 的键）必须已登记；GE-03 3 个新字段双登记 ---- */
  const sel = require(path.join(REPO, 'src/common/utils/gen1-guarded-selector.js'));
  const audit = sel.buildGuardedAudit({
    permission: {},
    signal: null,
    code: '513310',
    baseline: { target: 15, action: 'WAIT', stage: 'S2' },
    selection: sel.selectGuardedResult({ baseline: { target: 15 }, guarded: null, effectiveGuarded: false })
  });
  const auditKeys = Object.keys(audit);
  assert.strictEqual(auditKeys.length, 13, '★ 审计面必须恰 13 键');
  for (const k of auditKeys) assert.ok(drSet.has(k), `★ D12：审计字段 ${k} 必须已登记`);

  /* GE-03 3 个新字段：**按其真实写入集合**登记（⛔ 不要求「两边都登记」）——
   *   · `gen1_guarded_shadow_source` 由 overlay 写进决策记录 ⇒ 登记在 decision_result；
   *   · 两个计数器只写进 runtime_status（overlay 不写、RDE 也不写进 result）⇒ 登记在 runtime_status。
   * 该「写在哪就必须登在哪」的口径由 C1（overlay）与 C3（runtimeStatus 前向守卫）机器判定。 */
  assert.ok(drSet.has('gen1_guarded_shadow_source'),
    '★ D12：GE-03 shadow 来源字段必须登记在 decision_result（overlay 写入路径）');
  assert.strictEqual(dr.fields.gen1_guarded_shadow_source.type, 'string');
  assert.strictEqual(dr.fields.gen1_guarded_shadow_source.required, false);
  for (const k of ['gen1_guarded_shadow_eligible_count', 'gen1_guarded_shadow_invocations']) {
    assert.ok(rsSet.has(k), `★ D12：${k} 必须登记在 runtime_status（其唯一写入集合）`);
    assert.strictEqual(rs.fields[k].type, 'number', `★ D12：${k} 必须为 number`);
    assert.strictEqual(rs.fields[k].required, false, `★ D12：${k} 不得设为必填`);
    const desc = String(rs.fields[k].desc || '');
    assert.ok(/shadow/i.test(desc) && /不是采纳次数/.test(desc),
      `★ §0.2：${k} 的登记说明必须显式排除「采纳次数」语义`);
  }

  /* ---- C3. 历史登记缺口：**只登记不判红**，但**新增**缺口立即打红 ---- *
   * 说明：以下两个清单是 **GE-03 之前的既有缺口**（as-of 本文件落笔实测），
   * 全部字段均非 GE-03 新增；其修复（是否补齐登记）属独立立项，须 owner 裁定。
   * ⛔ 不得把「清单里没有的新字段」放过 —— 这正是前向 fail-closed 的意义。 */
  const LEGACY_UNREG_DECISION = [
    /* ③ buildWaitResult 返回键（6） */
    'max_position', 'defense_state', 'action', 'action_label',
    'consolidation_grade', 'wait_reason',
    /* ② RDE 对 result 的直接写入（2） */
    'stage_summary', 'gen1_canary_source'
  ];
  const LEGACY_UNREG_RUNTIME = [
    'config_version', 'decision_date', 'decision_engine', 'gen1_authority_label',
    'gen1_broker_wired', 'gen1_counterfactual_canary_authorized',
    'gen1_counterfactual_canary_health_allowed', 'gen1_counterfactual_canary_invocations',
    'gen1_counterfactual_intended_tech_position', 'gen1_counterfactual_target_sum',
    'gen1_counterfactual_tech_cap', 'gen1_counterfactual_tech_position',
    'gen1_counterfactual_tech_seed', 'gen1_execution_audit', 'gen1_execution_label',
    'gen1_guarded_contract_version', 'gen1_health_economic_status', 'gen1_health_label',
    'gen1_health_manual_review_required', 'gen1_health_read_reason_code',
    'gen1_health_source', 'gen1_production_fast_path_enabled',
    'gen1_production_tech_position', 'gen1_safety_source', 'ml_advisory_enabled',
    'ml_execution_enabled', 'ml_gen1_frozen', 'ml_model_id', 'ml_shadow_observe',
    'stage_engine', 'trend_stage_enabled', 'v3_6_1_enabled', 'v3_6_1_shadow',
    'v3_shadow_enabled'
  ];

  /* 域 ②：RDE 的 `result.X =` 直接写入 */
  const RDE = codeOnly(read(RDE_REL));
  const rdeWrites = [...new Set(
    [...RDE.matchAll(/result\.([A-Za-z_][A-Za-z0-9_]*)\s*=/g)].map((m) => m[1])
  )];
  assert.ok(rdeWrites.length > 0, '★ 探针有效性：RDE 必须存在 result.X = 写入');
  /* 域 ③：buildWaitResult 返回键 */
  const waitKeys = Object.keys(require(path.join(REPO, 'src/common/utils/decision.js'))
    .buildWaitResult({ code: '513310' }, { calc_date: '2026-09-10' }, 'probe'));
  assert.ok(waitKeys.length > 30, `★ 探针有效性：buildWaitResult 键数应 > 30（实测 ${waitKeys.length}）`);
  /* 域 ④：runtimeStatus 字面量键 */
  const rsWrite = parseRuntimeStatusKeys(read(RDE_REL));
  assert.ok(rsWrite.length > 50, `★ 探针有效性：runtimeStatus 键数应 > 50（实测 ${rsWrite.length}）`);

  const decisionUnreg = [...new Set([...rdeWrites, ...waitKeys])].filter((k) => !drSet.has(k)).sort();
  const runtimeUnreg = rsWrite.filter((k) => !rsSet.has(k)).sort();

  const surplusDecision = decisionUnreg.filter((k) => LEGACY_UNREG_DECISION.indexOf(k) < 0);
  const surplusRuntime = runtimeUnreg.filter((k) => LEGACY_UNREG_RUNTIME.indexOf(k) < 0);
  assert.deepStrictEqual(surplusDecision, [],
    `★ D12 前向：decision_record 出现**新的**未登记写入字段（必须同步注册）：${surplusDecision.join(', ')}`);
  assert.deepStrictEqual(surplusRuntime, [],
    `★ D12 前向：runtime_status 出现**新的**未登记写入字段（必须同步注册）：${surplusRuntime.join(', ')}`);

  /* 清单不得腐化：已登记字段仍应写在清单里（防止清单被「悄悄清空」当作修复） */
  for (const k of LEGACY_UNREG_DECISION) {
    assert.ok([...rdeWrites, ...waitKeys].indexOf(k) >= 0,
      `★ D12：历史清单项 ${k} 仍须存在于 decision_record 写入域（清单不得腐化）`);
    assert.ok(!drSet.has(k), `★ D12：若 ${k} 已补齐登记，请同步更新 LEGACY_UNREG_DECISION 清单`);
  }
  for (const k of LEGACY_UNREG_RUNTIME) {
    assert.ok(rsWrite.indexOf(k) >= 0, `★ D12：历史清单项 ${k} 仍须存在于 runtime_status 写入域`);
    assert.ok(!rsSet.has(k), `★ D12：若 ${k} 已补齐登记，请同步更新 LEGACY_UNREG_RUNTIME 清单`);
  }

  /* ★ 关键：GE-03 自身字段**不得**出现在任何历史缺口清单里（GE-03 新增字段已全部同步注册） */
  for (const k of ['gen1_guarded_shadow_source', 'gen1_guarded_shadow_eligible_count',
    'gen1_guarded_shadow_invocations']) {
    assert.ok(LEGACY_UNREG_DECISION.indexOf(k) < 0 && LEGACY_UNREG_RUNTIME.indexOf(k) < 0,
      `★ D12：GE-03 字段 ${k} 不得被登记为「历史缺口」—— 它必须已同步注册`);
  }
  assert.ok(runtimeUnreg.every((k) => !/^gen1_guarded_shadow_/.test(k)),
    '★ D12：runtime_status 的未登记集合中不得出现任何 GE-03 shadow 字段');
}

/** 解析 `const runtimeStatus = { … };` 的顶层键（4 空格对象、键缩进 6 空格）。 */
function parseRuntimeStatusKeys(src) {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((l) => /^ {4}const runtimeStatus = \{/.test(l));
  assert.ok(start >= 0, '★ 必须存在 runtimeStatus 字面量');
  const keys = [];
  let end = -1;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {4}\};/.test(lines[i])) { end = i; break; }
    const m = lines[i].match(/^ {6}([A-Za-z_][A-Za-z0-9_]*)\s*:/);
    if (m) keys.push(m[1]);
  }
  assert.ok(end > start, '★ runtimeStatus 字面量必须闭合');
  assert.ok(!/\.\.\./.test(lines.slice(start, end + 1).join('\n')),
    '★ runtime_status 写入集必须**静态可枚举**（⛔ 禁 spread 折叠进对象）');
  return keys;
}

/* ==================================================================== *
 * D. R6 / §2.1 —— immutable V3 只能 call：不接 Gen-1、不得起第三套调用
 * ==================================================================== */
{
  for (const f of ['src/common/utils/decision-v3.js', 'src/common/utils/decision.js']) {
    const reqs = [...codeOnly(read(f)).matchAll(/require\('([^']+)'\)/g)].map((m) => m[1]);
    assert.ok(reqs.length > 0, `★ ${f} 必须存在 require`);
    assert.ok(!reqs.some((s) => /gen1/i.test(s)), `★ R6：${f} 不得 require 任何 gen1-* 模块`);
    assert.ok(!reqs.some((s) => /authority|permission|overlay|selector|eligibilit|seal/i.test(s)),
      `★ R6：${f} 不得依赖 Gen-1 授权 / 许可 / 装饰 / 选择器 / 封印模块`);
  }

  const RDE = codeOnly(read(RDE_REL));
  assert.strictEqual((RDE.match(/decisionV3\.runDecision\(/g) || []).length, 2,
    '★ §2.1：V3 调用必须恰 2 处（① baseline ② 既有 Canary rerun）；⛔ Guarded Shadow 必须共享同一 rerun，不得重算');
  assert.ok(/claimGuardedShadowResult\(/.test(RDE),
    '★ §2.1：Guarded Shadow 必须**认领**既有 S4 rerun（⛔ 不得复制 V3 逻辑 / 新建第二套云函数）');
  assert.ok(/V361_RERUN_S4/.test(RDE),
    '★ §2.1：既有 Canary rerun 的来源标识不得被移除或改名');
  assert.ok(!/V361_RERUN_S4_GUARDED_SHADOW[\s\S]{0,400}decisionV3\.runDecision\(/.test(RDE),
    '★ §2.1：⛔ 不得为 Guarded Shadow 再起一次 V3 调用');
}

/* ==================================================================== *
 * E. R8 / D11 / Q4 —— 证据通道隔离（零写入 `independent_events`）
 * ==================================================================== */
{
  const FILES = [
    RDE_REL,
    'src/common/utils/gen1-shadow-eligibility.js',
    'src/common/utils/gen1-guarded-selector.js',
    OVL_REL,
    'scripts/gen1-ge03-replay-gates.js',
    'tests/gen1-ge03-replay-determinism.test.js'
  ];
  for (const f of FILES) {
    const t = codeOnly(read(f));
    assert.strictEqual((t.match(/independent_events\s*(=|\+=)/g) || []).length, 0,
      `★ R8 / D11：${f} 不得写入（含自增）Evidence 通道的 independent_events`);
    assert.ok(!/FUNDAMENTAL_EVIDENCE|gen1_evidence/i.test(t),
      `★ R8：${f} 不得写入 Evidence 集合`);
  }
  assert.ok(/不产生[^']{0,8}Evidence 事件/.test(read('scripts/gen1-ge03-replay-gates.js')),
    '★ Q4 / R8：replay harness 必须显式声明「不产生 Evidence 事件」');
  /* 证据计数只允许「读入并回显」——不得出现在任何自增 / 赋值左侧 */
  const RDE = codeOnly(read(RDE_REL));
  assert.ok(/gen1_guarded_evidence_independent_events:\s*guardedSeal\.evidence_independent_events/.test(RDE),
    '★ D11：Evidence 计数只允许从封印读入并回显（⛔ 不得自增）');
}

/* ==================================================================== *
 * F. D5 / D6 / R1 —— 计数口径独立 + production no-op 不退化
 * ==================================================================== */
{
  const RDE = codeOnly(read(RDE_REL));
  const RDELF = codeOnly(readLF(RDE_REL));

  /* D6：运行期 no-op 断言必须保留且**可抛错**（⛔ 不得只 log） */
  assert.ok(/verifyProductionNoop\(/.test(RDE), '★ D6：RDE 必须保留运行期 production no-op 断言');
  assert.ok(/Gen-1 overlay violated production No-op/.test(RDE),
    '★ D6：no-op 违规必须抛错（⛔ 不得降级为 log / warn）');
  /* R1：overlay 末尾硬还原必须**无条件**保留 */
  const OVLLF = readLF(OVL_REL);
  assert.ok(/^  out\.final_target = prodTarget;$/m.test(OVLLF),
    '★ R1 / D6：overlay 末尾硬还原 final_target 必须保留（无条件、不得放宽）');
  assert.ok(/^  out\.final_action = prodAction;$/m.test(OVLLF),
    '★ R1 / D6：overlay 末尾硬还原 final_action 必须保留（无条件、不得放宽）');
  assert.ok(!/if\s*\([^)]*\)[^{]*\{\s*\n\s*out\.final_target\s*=/.test(codeOnly(OVLLF)),
    '★ R1：硬还原不得被条件包裹（不得条件化）');
  assert.ok(/PRODUCTION_FIELDS = Object\.freeze\(\['final_target', 'final_action'\]\)/.test(OVLLF),
    '★ D6：PRODUCTION_FIELDS 冻结清单不得变化');

  /* D5：三个计数器口径互相独立（不得互相推导 / 不得复用采纳计数器做 shadow 计数） */
  assert.ok(/let guardedEffectiveInvocations = 0;/.test(RDE), '★ D5：采纳计数器必须独立声明');
  assert.ok(/let guardedShadowEligibleCount = 0;/.test(RDE), '★ D5：shadow eligibility 计数器必须独立声明');
  assert.ok(/let guardedShadowInvocations = 0;/.test(RDE), '★ D5：shadow invocation 计数器必须独立声明');
  assert.ok(!/guardedEffectiveInvocations\s*=\s*guardedShadow/.test(RDE),
    '★ D5：⛔ 采纳计数器不得由 shadow 计数器推导');
  assert.ok(!/guardedShadow\w*\s*=\s*guardedEffectiveInvocations/.test(RDE),
    '★ D5：⛔ shadow 计数器不得由采纳计数器推导');
  assert.strictEqual((RDE.match(/guardedEffectiveInvocations \+= 1;/g) || []).length, 1,
    '★ D5：采纳计数器的自增点必须恰 1 处（且位于 selector 采纳后的分支内）');
  assert.ok(/guardedShadowEligibleCount >= guardedShadowInvocations/.test(RDELF),
    '★ §0.2.1：eligible_count >= shadow_invocations 的运行期不变量断言必须保留');
}

console.log('gen1 ge03 regression guard tests passed'
  + '（D8 门禁身份 25+6 / D9 allowlist 逐字段冻结 / D12 N4 已收口 + 前向 fail-closed'
  + ' / R6 V3 不可变 / R8·D11 证据通道零写入 / D5·D6 口径与 no-op）');
