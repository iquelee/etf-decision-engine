'use strict';

/**
 * WP-G1-GE-03 G3-05：shadow 独立计数（`gen1_guarded_shadow_invocations`）+ D5 口径隔离守卫。
 *
 * 设计 Gate §0.2 / §0.2.1 的机器可判定形式：
 *
 *   gen1_guarded_shadow_eligible_count = guardedShadowEligible === true 的计数
 *   gen1_guarded_shadow_invocations    = **实际完成** Guarded Shadow V3 rerun 的计数   ← GE-03 新增
 *   gen1_guarded_effective_invocations = 真实 adopted + 正式落库成功后的累计次数（GE-03 应保持 0）
 *
 *   正常态： eligible_count >= shadow_invocations >= 0，effective_invocations = 0
 *   ⛔ 三者**不得互相推导**（§3.3 口径三分离）；⛔ 新字段**不读、不写**旧计数器（D5）。
 *
 * 覆盖：
 *   A. 三个计数器各自的**增量点唯一**且条件互不相同（D5 静态守卫）
 *   B. 新计数器与旧计数器**在源码层面完全隔离**（同行/同表达式均不得混用）
 *   C. §0.2.1 不变量：既有运行期硬断言；且断言本身不引用采纳口径
 *   D. 由既有原语复算：`invocations <= eligible` 对任意合成组合恒成立（含「eligible 增、invocation 不增」）
 *   E. D12：新持久化字段必须已登记；R8/D11：不得进入 Evidence 通道
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const el = require(path.join(REPO, 'src/common/utils/gen1-shadow-eligibility.js'));
const { getSchema } = require(path.join(REPO, 'src/common/schema.js'));

const { claimGuardedShadowResult, deriveGuardedShadowEligibility } = el;

const RDE = fs.readFileSync(path.join(REPO, 'cloudfunctions/runDecisionEngine/index.js'), 'utf8');
const SEAL_SRC = fs.readFileSync(path.join(REPO, 'src/common/utils/gen1-guarded-seal.js'), 'utf8');

/** 剔除注释（整行 + 行尾），用于源码级守卫（注释里必然会出现这些名字）。 */
function codeOnly(src) {
  return src.split('\n')
    .filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l))
    .map((l) => l.replace(/(^|\s)\/\/.*$/, '$1'))
    .join('\n');
}
const CODE = codeOnly(RDE);
const LINES = CODE.split('\n');

const NEW = 'guardedShadowInvocations';
const OLD = 'guardedEffectiveInvocations';
const NEW_FIELD = 'gen1_guarded_shadow_invocations';
const OLD_FIELD = 'gen1_guarded_effective_invocations';
const ELIG = 'guardedShadowEligibleCount';

/* ==================================================================== *
 * A. 增量点唯一 + 条件互不相同（D5）
 * ==================================================================== */
{
  assert.strictEqual((CODE.match(new RegExp(NEW + ' \\+= 1', 'g')) || []).length, 1,
    `★ ${NEW} 的增量点必须恰 1 处`);
  assert.strictEqual((CODE.match(new RegExp(ELIG + ' \\+= 1', 'g')) || []).length, 1,
    `★ ${ELIG} 的增量点必须恰 1 处`);
  assert.strictEqual((CODE.match(new RegExp(OLD + ' \\+= 1', 'g')) || []).length, 1,
    `★ ${OLD}（真实采纳）的增量点必须恰 1 处`);

  /* A1. shadow invocation 的触发条件 = 「真的认领到那一次 S4 rerun 结果」 */
  assert.ok(new RegExp('if \\(guardedShadowResult != null\\) ' + NEW + ' \\+= 1;').test(CODE),
    '★ invocation 必须由「guardedShadowResult 非空」触发（= 该次 S4 rerun 确实执行并认领）');
  /* A2. eligibility 的触发条件 = 「eligibility 成立」 */
  assert.ok(new RegExp('if \\(shadowEligibility\\.eligible\\) ' + ELIG + ' \\+= 1;').test(CODE),
    '★ eligible_count 必须由「shadowEligibility.eligible」触发');
  /* A3. 两个触发条件不得互换（两计数口径不同，⛔ 不得互相顶替） */
  assert.ok(!new RegExp('if \\(shadowEligibility\\.eligible\\) ' + NEW + ' \\+= 1;').test(CODE),
    '★ ⛔ 不得把 eligibility 当作 invocation 的触发条件（「能不能算」≠「实际算了」）');
  assert.ok(!new RegExp('if \\(guardedShadowResult != null\\) ' + ELIG + ' \\+= 1;').test(CODE),
    '★ ⛔ 不得把「认领到 rerun」当作 eligibility 的触发条件');
}

/* ==================================================================== *
 * B. 新/旧计数器源码层面完全隔离（D5：不读、不写）
 * ==================================================================== */
{
  /* B1. 不得有任何一行同时出现两个标识符（变量名或字段名） */
  const mixed = LINES.filter((l) =>
    (l.indexOf(NEW) >= 0 && l.indexOf(OLD) >= 0)
    || (l.indexOf(NEW_FIELD) >= 0 && l.indexOf(OLD_FIELD) >= 0)
    || (l.indexOf(NEW) >= 0 && l.indexOf(OLD_FIELD) >= 0)
    || (l.indexOf(NEW_FIELD) >= 0 && l.indexOf(OLD) >= 0));
  assert.deepStrictEqual(mixed, [], `★ 新/旧计数器不得在同一行混用：\n${mixed.join('\n')}`);

  /* B2. 新计数器的增量表达式不得引用采纳资格 / 采纳计数 */
  const idx = CODE.indexOf(`if (guardedShadowResult != null) ${NEW} += 1;`);
  assert.ok(idx > 0);
  const stmt = CODE.slice(idx, idx + 60);
  assert.ok(stmt.indexOf('effective_guarded') < 0, '★ ⛔ 不得用 effective_guarded（采纳资格）触发 shadow 计数');
  assert.ok(stmt.indexOf(OLD) < 0, '★ ⛔ 不得读写采纳计数');
  assert.ok(stmt.indexOf('adopted') < 0, '★ ⛔ shadow 计数不得挂到 adopted 语义上');

  /* B3. 旧计数器的增量分支不得引用 shadow（防「拿 shadow 结果刷采纳次数」） */
  const gIdx = CODE.indexOf("if (guardedSelection.authoritative_source === SELECTOR_SOURCE.GUARDED");
  assert.ok(gIdx > 0, '★ 采纳计数分支必须存在（既有 P1 判据不得删除）');
  const branch = CODE.slice(gIdx, CODE.indexOf(`${OLD} += 1;`, gIdx) + `${OLD} += 1;`.length);
  assert.ok(!/shadow/i.test(branch), `★ ⛔ 采纳计数分支内不得出现 shadow：${branch.replace(/\s+/g, ' ')}`);
  assert.ok(/gen1_adopted === true/.test(branch), '★ 采纳计数必须仍由 gen1_adopted === true 把关');

  /* B4. 三个计数器各自独立声明（不得用一个变量顶两个名字） */
  assert.ok(new RegExp(`let ${ELIG} = 0;`).test(CODE));
  assert.ok(new RegExp(`let ${NEW} = 0;`).test(CODE));
  assert.ok(new RegExp(`let ${OLD} = 0;`).test(CODE));
}

/* ==================================================================== *
 * C. §0.2.1 不变量：运行期硬断言存在且不涉采纳口径
 * ==================================================================== */
{
  assert.ok(new RegExp(`${ELIG} >= ${NEW}`).test(CODE),
    '★ 必须存在「eligible_count >= shadow_invocations」的运行期判据');
  assert.ok(new RegExp(`${NEW} >= 0`).test(CODE), '★ 必须存在「shadow_invocations >= 0」');
  assert.ok(/\[GEN1-SHADOW\]/.test(CODE), '★ 不变量被破坏时必须显式抛错（fail-closed）');
  const i = CODE.indexOf('[GEN1-SHADOW]');
  const guard = CODE.slice(Math.max(0, i - 400), i + 200);
  assert.ok(guard.indexOf(OLD) < 0,
    '★ ⛔ 不变量断言不得涉及 gen1_guarded_effective_invocations（采纳口径与 shadow 计数分离）');
}

/* ==================================================================== *
 * D. 由既有原语复算：invocations <= eligible 恒成立（含「eligible 增、invocation 不增」）
 * ==================================================================== */
{
  const OK_CHECKS = {
    health_allows_guarded: true, data_ok: true, domain_strict_in_domain: true,
    safety_pass: true, model_candidate: true
  };
  const mk = (authority, checks) => deriveGuardedShadowEligibility({
    authority: { gen1_authority: authority },
    guarded: { checks: Object.assign({}, OK_CHECKS, checks || {}) }
  });
  const eligTrue = mk('CANARY');
  const eligFalse = mk('ADVISORY');
  assert.strictEqual(eligTrue.eligible, true);
  assert.strictEqual(eligFalse.eligible, false);

  /* 与源码同构的两个增量（条件逐字取自 index.js 的断言文本） */
  const rerun = { target: 25, action: 'BUILD', stage: 'S4' };
  const countOn = (elig, rn) => {
    let eligible = 0; let invocations = 0;
    if (elig.eligible) eligible += 1;                       // ← if (shadowEligibility.eligible)
    const result = claimGuardedShadowResult(elig, rn);
    if (result != null) invocations += 1;                   // ← if (guardedShadowResult != null)
    return { eligible, invocations };
  };

  const MATRIX = [
    { label: 'eligible + rerun 已执行', elig: eligTrue, rerun, exp: { eligible: 1, invocations: 1 } },
    { label: 'eligible 但 rerun 未执行（★ 合法态）', elig: eligTrue, rerun: null, exp: { eligible: 1, invocations: 0 } },
    { label: 'not eligible + rerun 有值（不得认领）', elig: eligFalse, rerun, exp: { eligible: 0, invocations: 0 } },
    { label: 'not eligible + 无 rerun', elig: eligFalse, rerun: null, exp: { eligible: 0, invocations: 0 } }
  ];
  for (const c of MATRIX) {
    const got = countOn(c.elig, c.rerun);
    assert.deepStrictEqual(got, c.exp, `★ ${c.label}`);
    assert.ok(got.eligible >= got.invocations, `★ §0.2.1 不变量必须成立：${c.label}`);
  }

  /* 组合批次：任意混合下 Σ invocations <= Σ eligible；且存在 strict >（反向不成立） */
  let se = 0; let si = 0;
  for (let i = 0; i < 20; i += 1) {
    const e = i % 3 === 0 ? eligFalse : eligTrue;
    const r = i % 4 === 0 ? null : rerun;
    const g = countOn(e, r);
    se += g.eligible; si += g.invocations;
  }
  assert.strictEqual(se, 13, '合成批次的 eligible 合计（i%3!=0 的 13 只，仅用于固定期望值）');
  assert.strictEqual(si, 10, '合成批次的 invocations 合计（13 只 eligible 中再排除 i%4==0 的 3 只，仅用于固定期望值）');
  assert.ok(se >= si, '★ Σ eligible >= Σ invocations');

  /* 反向不可能：不存在 invocations > eligible 的输入 */
  const inputs = [];
  for (const e of [eligTrue, eligFalse]) {
    for (const r of [rerun, null, undefined, { target: null, action: null, stage: 'S4' }]) inputs.push([e, r]);
  }
  for (const [e, r] of inputs) {
    const g = countOn(e, r);
    assert.ok(g.invocations <= g.eligible,
      `★ 必须恒有 invocations <= eligible（e=${e.eligible} r=${r == null ? 'null' : 'obj'}）`);
  }
}

/* ==================================================================== *
 * E. D12 登记 + R8/D11 证据通道隔离
 * ==================================================================== */
{
  const rs = getSchema('runtime_status');
  assert.ok(rs && rs.fields, 'runtime_status schema 必须存在');
  assert.ok(rs.fields[NEW_FIELD], `★ D12：runtime_status.${NEW_FIELD} 必须登记`);
  assert.strictEqual(rs.fields[NEW_FIELD].type, 'number');
  assert.strictEqual(rs.fields[NEW_FIELD].required, false);
  /* 登记描述的语义必须显式排除「采纳 / Evidence」 */
  const desc = String(rs.fields[NEW_FIELD].desc || '');
  assert.ok(/Guarded Shadow V3 rerun/.test(desc), '★ 字段语义必须写明「实际完成 Guarded Shadow V3 rerun 的次数」');
  assert.ok(/不是采纳次数/.test(desc) && /不是 Evidence/.test(desc),
    '★ 字段描述必须显式排除「采纳次数」与「Evidence 事件」两种误读（§0.2 命名纪律）');

  /* R8 / D11：shadow 计数不得进入封印 / 证据实现 */
  assert.ok(SEAL_SRC.indexOf(NEW_FIELD) < 0 && SEAL_SRC.indexOf(NEW) < 0,
    '★ ⛔ shadow 计数不得出现在 gen1-guarded-seal.js（不得进入 Evidence 通道）');
  /* 落库对象里 Evidence 独立事件仍只来自封印对象，不得掺入 shadow 计数 */
  const evLine = LINES.find((l) => l.indexOf('gen1_guarded_evidence_independent_events:') >= 0);
  assert.ok(evLine, 'runtime_status 必须仍写 gen1_guarded_evidence_independent_events');
  assert.ok(evLine.indexOf('guardedSeal.') >= 0 && !/shadow/i.test(evLine),
    `★ ⛔ Evidence 独立事件只能来自封印对象，不得掺入 shadow 计数：${evLine.trim()}`);
}

console.log('gen1 guarded shadow invocations tests passed（独立计数 + D5 口径隔离 + §0.2.1 不变量 + D12 登记）');
