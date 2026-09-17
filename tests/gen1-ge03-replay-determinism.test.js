'use strict';

/**
 * WP-G1-GE-03 G3-06：离线 replay harness 的**固有性质**守卫（设计 Gate §4 / §5 D3 / D4 / D7）。
 *
 * 被测对象 = `scripts/gen1-ge03-replay-gates.js`（**第二层**离线取证；⛔ 不代表生产写权限）。
 * 真实链路（第一层）的接线守卫由 `tests/gen1-guarded-shadow-rerun.test.js` 与
 * `tests/gen1-guarded-selector-noop.test.js`（Gate G1-X）承担 ⇒ **二者不可互相替代**。
 *
 * 覆盖：
 *   A. §4 矩阵**结构**契约：类别数固定 7（⛔ 不得扩成第 8 类）+ 每类 neg/pos 齐备（含 seal）
 *   B. §4(b) / D3：矩阵全绿，**且**该矩阵的守卫逻辑自身**能被打红**（6 条破坏性反证）
 *   C. §0.2.1：三计数口径独立 + `effective_invocations = 0` 可打红 +
 *      「eligible 增而 invocations 不增」被显式允许（审计信号，非缺陷）
 *   D. D4：同一批次重放**逐字段一致** + `replay_ref` 内容绑定且可复算 + 零时间/零随机
 *   E. D7：脚本可作 CLI 门禁（退出码可失败）+ 可 `require` 复用（不产生副作用）
 *   F. D2：两层阻断（selector 引用相等 + 落库 deep-equal + `gen1_adopted === false`）
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..');
const HARNESS_PATH = path.join(REPO, 'scripts/gen1-ge03-replay-gates.js');
const H = require(HARNESS_PATH);
const HARNESS_SRC = fs.readFileSync(HARNESS_PATH, 'utf8');

const {
  REPLAY_HARNESS_ID, MATRIX_CLASSES, SIGNAL_CASES, DECISION, BASELINE, SYNTH_SEAL,
  probe, probeFull, poisonProbe, runMatrix, runSignalScenarios,
  countBatch, runReplayBatch, computeReplayRef, stable
} = H;

/** 剔除注释（整行 + 行尾），用于源码级守卫（注释里必然会出现这些名字）。 */
function codeOnly(src) {
  return src.split('\n')
    .filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l))
    .map((l) => l.replace(/(^|\s)\/\/.*$/, '$1'))
    .join('\n');
}
const CODE = codeOnly(HARNESS_SRC);

/** 深拷贝矩阵结构（用于「破坏后再跑」的红灯自证，⛔ 不触碰真实矩阵）。 */
const cloneMatrix = (list) => list.map((c) => Object.assign({}, c, {
  cases: c.cases.map((x) => Object.assign({}, x))
}));
const idOf = (list, id) => list.find((c) => c.id === id);

/* ==================================================================== *
 * A. §4 矩阵结构契约
 * ==================================================================== */
{
  const FROZEN_IDS = ['health', 'data', 'domain', 'safety', 'candidate', 'seal', 'authority'];
  assert.strictEqual(MATRIX_CLASSES.length, 7,
    '★ §4(c)：反例矩阵的**一级类别数必须固定为 7**');
  assert.deepStrictEqual(MATRIX_CLASSES.map((c) => c.id), FROZEN_IDS,
    '★ 7 个类别必须与 §4 表格逐行一致且顺序固定（避免「换名即逃逸」）');
  assert.strictEqual(new Set(FROZEN_IDS).size, 7, '★ 类别 id 必须唯一');

  for (const cls of MATRIX_CLASSES) {
    const kinds = cls.cases.map((c) => c.kind);
    assert.ok(kinds.every((k) => k === 'neg' || k === 'pos' || k === 'diff'),
      `★ ${cls.id}：用例 kind 只允许 neg / pos / diff`);
    assert.ok(kinds.filter((k) => k === 'neg').length >= 1,
      `★ §4(a) ${cls.id}：至少 1 个**负例**（必须被拒）`);
    assert.ok(kinds.filter((k) => k === 'pos').length >= 1,
      `★ §4(a) ${cls.id}：至少 1 个**正控**（必须通过）—— 7 类一律适用，**含 seal**`);
  }

  /* §4(b) 的可打红前提：每条 neg/pos 都必须有**可执行**的判定器 */
  const DEFAULTED = { neg: true, pos: true };
  for (const cls of MATRIX_CLASSES) {
    for (const c of cls.cases) {
      if (c.kind === 'diff') continue; // 口径差登记：⛔ 不判 PASS/FAIL
      assert.ok(typeof c.check === 'function' || DEFAULTED[c.kind] === true,
        `★ ${cls.id}/${c.label}：缺少判定器（负例/正控必须有判据，⛔ 不得恒绿）`);
    }
  }
}

/* ==================================================================== *
 * B. 矩阵全绿 + **守卫逻辑能被打红**（§4(b) / D3 / D7）
 * ==================================================================== */
{
  const m = runMatrix(MATRIX_CLASSES);
  assert.strictEqual(m.designOk, true, '★ §4(c)：designOk 必须为 true');
  assert.strictEqual(m.classes, 7, '★ 类别数必须为 7');
  assert.strictEqual(m.ok, true,
    '★ 默认矩阵必须全绿；失败明细：' + JSON.stringify(m.rows.map((r) => r.failures)));
  for (const r of m.rows) {
    assert.deepStrictEqual(r.failures, [], `★ ${r.id} 不得有失败项（D3 反例矩阵全拒）`);
  }
  assert.ok(m.observations.length >= 7 * 2,
    '★ 观测总数必须 >= 7 类 x 2（负例 + 正控）');

  /* --- 红灯自证（全部只改**数据**，⛔ 不改任何源码 / 不改真实矩阵） --- */

  // B1 摘掉正控 ⇒ 必须 FAIL
  {
    const broken = cloneMatrix(MATRIX_CLASSES);
    const cls = idOf(broken, 'health');
    cls.cases = cls.cases.filter((c) => c.kind !== 'pos');
    const r = runMatrix(broken);
    assert.strictEqual(r.ok, false, '★ §4(a)：摘掉正控后矩阵必须 FAIL（否则是恒绿桩）');
    assert.ok(r.rows.some((x) => x.failures.some((f) => /缺少正控/.test(f))),
      '★ 必须报出「§4(a) 缺少正控」');
  }

  // B2 摘掉负例 ⇒ 必须 FAIL
  {
    const broken = cloneMatrix(MATRIX_CLASSES);
    const cls = idOf(broken, 'data');
    cls.cases = cls.cases.filter((c) => c.kind !== 'neg');
    const r = runMatrix(broken);
    assert.strictEqual(r.ok, false, '★ §4(a)：摘掉负例后矩阵必须 FAIL');
    assert.ok(r.rows.some((x) => x.failures.some((f) => /缺少负例/.test(f))),
      '★ 必须报出「§4(a) 缺少负例」');
  }

  // B3 扩成第 8 个「治理类别」⇒ 必须 FAIL
  {
    const broken = cloneMatrix(MATRIX_CLASSES);
    broken.push({
      id: 'governance', label: '自造的第八类',
      cases: [{ kind: 'neg', over: {} }, { kind: 'pos', over: {} }]
    });
    const r = runMatrix(broken);
    assert.strictEqual(r.designOk, false, '★ §4(c)：类别数 != 7 ⇒ designOk 必须为 false');
    assert.strictEqual(r.ok, false, '★ §4(c)：类别数 != 7 ⇒ 整体必须 FAIL');
  }

  // B4 让一条**负例**变成「会通过」（把 over 换成全绿默认）⇒ 该负例必须被判定失败
  {
    const broken = cloneMatrix(MATRIX_CLASSES);
    const cls = idOf(broken, 'health');
    const neg = cls.cases.find((c) => c.kind === 'neg');
    neg.over = {}; // 全绿默认 ⇒ eligible 成立 ⇒ 该「负例」不再被拒
    const r = runMatrix(broken);
    assert.strictEqual(r.ok, false, '★ 负例不再被拒时矩阵必须 FAIL（证明确实在判定，而非恒绿）');
    assert.ok(r.rows.some((x) => x.failures.some((f) => /负例必须被拒/.test(f))),
      '★ 必须报出「负例必须被拒」');
  }

  // B5 让一条**正控**变成「会失败」⇒ 必须 FAIL
  {
    const broken = cloneMatrix(MATRIX_CLASSES);
    const cls = idOf(broken, 'data');
    const pos = cls.cases.find((c) => c.kind === 'pos');
    pos.over = { dataHealth: null }; // 数据闸缺失 ⇒ 必然被拒
    const r = runMatrix(broken);
    assert.strictEqual(r.ok, false, '★ 正控不再通过时矩阵必须 FAIL');
    assert.ok(r.rows.some((x) => x.failures.some((f) => /正控必须通过/.test(f))),
      '★ 必须报出「正控必须通过」');
  }

  // B6 未知 kind ⇒ fail-closed（⛔ 不得静默通过）
  {
    const broken = cloneMatrix(MATRIX_CLASSES);
    idOf(broken, 'safety').cases.push({ kind: 'bogus', label: '未知类型', over: {} });
    const r = runMatrix(broken);
    assert.strictEqual(r.ok, false, '★ 未知 kind 必须 fail-closed');
    assert.ok(r.rows.some((x) => x.failures.some((f) => /未知用例类型/.test(f))),
      '★ 必须报出「未知用例类型」');
  }
}

/* ==================================================================== *
 * C. §0.2.1 计数口径（D5）
 * ==================================================================== */
{
  const s = runSignalScenarios();
  assert.strictEqual(s.ok, true,
    '★ §0.2.1 审计信号场景必须全部符合预期：' + JSON.stringify(s.rows.map((r) => [r.id, r.ok])));
  assert.strictEqual(s.rows.length, SIGNAL_CASES.length, '★ 场景数必须与声明一致');

  /* ✅ 明示允许的不对称：eligible 成立而 rerun 未执行 ⇒ eligible 增、invocations 不增 */
  const c = s.counts;
  assert.strictEqual(c.eligible_count, 2, '★ 2 条场景 eligibility 成立');
  assert.strictEqual(c.shadow_invocations, 1, '★ 仅 1 条场景真正产出 shadow（rerun 未执行的不得计入）');
  assert.strictEqual(c.effective_invocations, 0, '★ GE-03 应保持 effective_invocations = 0');
  assert.ok(c.eligible_count > c.shadow_invocations,
    '★ §0.2.1：必须存在「eligible 增而 invocations 不增」的样本（审计信号，非缺陷）');
  assert.strictEqual(c.invariant_ok, true,
    '★ §0.2.1：eligible_count >= shadow_invocations >= 0 且 effective_invocations = 0');

  /* 口径独立：⛔ 不得读入既有计数器字段（只由**两个标志**派生） */
  const injected = countBatch([{ obs: { eligible: true, shadowProduced: false, shadow_invocations: 99 } }]);
  assert.strictEqual(injected.shadow_invocations, 0,
    '★ D5：shadow_invocations 必须由 eligible ∧ shadowProduced 派生，⛔ 不得读取既有计数器字段');
  assert.strictEqual(injected.eligible_count, 1, '★ eligible_count 由 eligible 派生');
  assert.strictEqual(injected.invariant_ok, true, '★ 该批次仍满足不变量');

  /* 可打红：被采纳 ⇒ effective_invocations > 0 ⇒ 不变量必须被打破 */
  const adopted = countBatch([{ obs: { eligible: true, shadowProduced: true, adopted: true } }]);
  assert.strictEqual(adopted.effective_invocations, 1, '★ adopted 必须计入 effective_invocations');
  assert.strictEqual(adopted.invariant_ok, false,
    '★ D3/D7：effective_invocations != 0 时 invariant_ok 必须为 false（本判据能被打红）');

  /* 结构上界：invocations <= eligible 对**全部**标志组合恒成立（由派生方式保证） */
  for (const eligible of [true, false]) {
    for (const shadowProduced of [true, false]) {
      const one = countBatch([{ obs: { eligible, shadowProduced } }]);
      assert.ok(one.shadow_invocations <= one.eligible_count,
        `★ eligible=${eligible} / shadowProduced=${shadowProduced} 时不得出现 invocations > eligible`);
    }
  }

  /* 源码级：invocations 必须同时依赖两个标志（⛔ 不得只看其中一个） */
  const cbBody = CODE.slice(CODE.indexOf('function countBatch('), CODE.indexOf('function runReplayBatch('));
  assert.ok(cbBody.length > 0 && /effective/.test(cbBody), '★ 计数函数切片定位必须成功（防断言失效）');
  assert.strictEqual((cbBody.match(/o\.eligible === true && o\.shadowProduced === true/g) || []).length, 1,
    '★ §0.2.1：shadow_invocations 的派生条件必须**恰 1 处**且同时要求两个标志');
  assert.strictEqual(/o\.shadowProduced === true[^;\n]*effective/.test(cbBody), false,
    '★ §3.3：shadow 通道⛔不得与采纳（effective）口径混写在同一表达式内');
}

/* ==================================================================== *
 * D. D4 确定性 replay
 * ==================================================================== */
{
  const m = runMatrix(MATRIX_CLASSES);
  const rows1 = runReplayBatch();
  const rows2 = runReplayBatch();
  const rows3 = runReplayBatch();

  assert.strictEqual(rows1.length, m.observations.length + SIGNAL_CASES.length,
    '★ replay 批次行数必须 = 矩阵观测数 + 审计信号场景数');
  assert.deepStrictEqual(rows1, rows2, '★ D4：同一批次两次运行必须**逐字段一致**（diff 为空）');
  assert.deepStrictEqual(rows2, rows3, '★ D4：第三次运行仍必须逐字段一致');
  assert.ok(rows1.every((r) => typeof r === 'string' && r.length > 0), '★ 每行必须是非空稳定串');

  const joined = rows1.join('\n');
  assert.strictEqual(/undefined/.test(joined), false,
    '★ D4：稳定行中⛔不得出现 undefined（`stable()` 必须把 undefined 归一为 null）');
  assert.strictEqual(/NaN/.test(joined), false, '★ D4：稳定行中⛔不得出现 NaN');

  /* 键序无关（否则 JSON 键序变化会伪造出「不一致」） */
  assert.strictEqual(stable({ a: 1, b: [2, { c: 3 }] }), stable({ b: [2, { c: 3 }], a: 1 }),
    '★ `stable()` 必须与键序无关');

  /* replay_ref：可复算 + 内容绑定 + 稳定 */
  const ref = computeReplayRef();
  assert.match(ref, /^[0-9a-f]{64}$/, '★ replay_ref 必须是 64 位小写 hex（sha256）');
  assert.strictEqual(computeReplayRef(), ref, '★ D4：replay_ref 必须可复算（三次运行同值）');
  const manual = crypto.createHash('sha256')
    .update(REPLAY_HARNESS_ID + '\n' + rows1.join('\n'), 'utf8').digest('hex');
  assert.strictEqual(manual, ref,
    '★ replay_ref 必须**内容绑定**（= sha256(harness_id + 全部稳定行)），⛔ 不得是常量 / 时间戳');

  /* 零时间 / 零随机（否则 D4 不可复现） */
  assert.strictEqual(/Date\.now|new Date\(|Math\.random/.test(CODE), false,
    '★ D4：harness 内⛔不得出现 Date.now / new Date / Math.random（那会破坏可复现性）');
  assert.strictEqual(/process\.hrtime/.test(CODE), false, '★ D4：⛔不得使用高精度时钟');
}

/* ==================================================================== *
 * E. D7 门禁形态（CLI 可失败 + 可 require 复用）
 * ==================================================================== */
{
  assert.strictEqual(REPLAY_HARNESS_ID, 'GEN1_GE03_REPLAY_V1',
    '★ harness 标识必须稳定（replay_ref 的前缀输入）');

  assert.ok(/process\.exitCode = allOk \? 0 : 1/.test(CODE),
    '★ D7：脚本必须以 allOk 决定退出码 0 / 1（**必须能失败**，⛔ 不得恒 0）');
  assert.ok(/require\.main === module/.test(CODE),
    '★ 必须以 require.main 守卫 CLI，保证被 require 时不产生副作用');
  assert.ok(/--emit/.test(CODE), '★ 必须支持 `--emit <path>` 产出可回指的报告');
  assert.ok(/GE_02_BASELINE_AUTHORITATIVE/.test(CODE),
    '★ 必须显式打印 GE-02 选择器硬开关（证明 selector 仍 baseline-authoritative）');
  assert.ok(/不产生[^']{0,8}Evidence 事件/.test(HARNESS_SRC),
    '★ R8 / D11：脚本必须**显式声明**不产生 Evidence 事件（独立事件恒不增加）');

  const exported = Object.keys(H);
  for (const k of ['REPLAY_HARNESS_ID', 'MATRIX_CLASSES', 'SIGNAL_CASES', 'SYNTH_SEAL',
    'probe', 'probeFull', 'poisonProbe', 'runMatrix', 'runSignalScenarios',
    'countBatch', 'runReplayBatch', 'computeReplayRef', 'stable', 'BASELINE', 'DECISION']) {
    assert.ok(exported.indexOf(k) >= 0, `★ 必须导出 ${k}（供本测试与后续 Gate 复用）`);
  }
}

/* ==================================================================== *
 * F. D2 两层阻断（复用 harness 链路，独立于矩阵）
 * ==================================================================== */
{
  const f = probeFull({});
  assert.strictEqual(f.eligibility.eligible, true, '★ 全绿输入下 shadow eligibility 必须成立');
  assert.ok(f.shadow != null, '★ D1：shadow 必须**产出非空结果对象**（区别于结构性恒 false）');

  // ① Selector 边界：权威结果必须**就是** baseline 对象本身
  assert.strictEqual(f.selection.selected_result, BASELINE,
    '★ D2①：`selected_result` 必须与 baseline **引用相等**（保住最强断言）');
  assert.strictEqual(f.selection.authoritative_source, 'BASELINE', '★ D2①：权威来源必须仍是 BASELINE');
  assert.strictEqual(f.audit.gen1_adopted, false, '★ D2②：gen1_adopted 必须为 false');
  assert.strictEqual(f.audit.gen1_guarded_selector_source, 'BASELINE',
    '★ D2②：gen1_guarded_selector_source 必须为 BASELINE');
  assert.strictEqual(f.audit.gen1_guarded_shadow_source, 'V361_RERUN_S4_GUARDED_SHADOW',
    '★ §2.1：shadow 产出时并行来源标识必须显式（⛔ 不改变任何既有字段）');

  // ② 落库 / 序列化边界：deep-equal + JSON 往返
  const rt = JSON.parse(JSON.stringify(f.out));
  assert.strictEqual(rt.final_target, DECISION.final_target, '★ D2②：JSON 往返后 final_target 必须不变');
  assert.strictEqual(rt.final_action, DECISION.final_action, '★ D2②：JSON 往返后 final_action 必须不变');
  assert.strictEqual(rt.suggested_position, DECISION.suggested_position,
    '★ D2②：JSON 往返后 suggested_position 必须不变');
  assert.strictEqual(rt.gen1_adopted, false, '★ D2②：JSON 往返后 gen1_adopted 必须仍为 false');

  // 强制「已考虑采纳」仍不得翻转
  const forced = probeFull({ forceEffectiveGuarded: true });
  assert.strictEqual(forced.selection.selected_result, BASELINE,
    '★ D2①：即使强制 effectiveGuarded=true，权威结果仍必须引用相等地等于 baseline');
  assert.strictEqual(forced.audit.gen1_adopted, false, '★ D2②：强制档也不得产生采纳');

  // 投毒审计不得改写生产字段
  const poison = poisonProbe();
  assert.strictEqual(poison.finalTarget, DECISION.final_target, '★ R1：被投毒审计不得改写 final_target');
  assert.strictEqual(poison.finalAction, DECISION.final_action, '★ R1：被投毒审计不得改写 final_action');
  assert.strictEqual(poison.suggested, DECISION.suggested_position,
    '★ R1：被投毒审计不得改写 suggested_position');
  assert.strictEqual(poison.noopOk, true, '★ D6：生产 no-op 不变量必须成立');

  // synthetic 封印夹具：seal gate 可过，但 selector 仍 BASELINE（B2 裁定 + R5 不冲突）
  const sealed = probe({ guardedSeal: SYNTH_SEAL });
  assert.strictEqual(sealed.checks.freeze_seal_approved, true, '★ seal 正控：synthetic Freeze 夹具可过');
  assert.strictEqual(sealed.checks.evidence_seal_pass, true, '★ seal 正控：synthetic Evidence 夹具可过');
  assert.strictEqual(sealed.selectorSource, 'BASELINE', '★ 即使 seal 全过，selector 仍必须 BASELINE');
  assert.strictEqual(sealed.adopted, false, '★ 即使 seal 全过，也不得产生采纳');
}
