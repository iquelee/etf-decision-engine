/**
 * 生命周期状态机测试（SPEC §1.2 / §1.3 / §7）
 *
 * ★ 三条硬约束的机器验证：
 *   1. 8 个维度**分开**建模（⛔ 不得合成一个总状态）
 *   2. 无 API 数据 ⇒ **NOT_PROVIDED**（⛔ 前端不得写死当前状态）
 *   3. 三个轴**永远可区分**：代码上线 ≠ 生产运行 ≠ 资格演进
 */
import {
  readLifecycle, readBoundaryFields, validateAxisSeparation,
  LIFECYCLE_SPEC, LIFECYCLE_AXES, DIM_TO_AXIS, BOUNDARY_FIELDS,
  FORBIDDEN_LIFECYCLE_PHRASES, STATIC_REGISTER
} from '../../src/rewrite/domain/lifecycle.js';
import { LIFECYCLE_DIMS, FIELD_STATE, MISSING_REASON } from '../../src/rewrite/domain/enums.js';
import { FIXTURES, suite, assert, assertState } from './_fixtures.js';
import fs from 'node:fs';
import path from 'node:path';

const t = suite('lifecycle.test');
const val = (f) => (f && f.state === FIELD_STATE.PROVIDED ? f.value : null);

/* ---------------- 1) 八个维度 ---------------- */

t.ok('恰好 8 个维度，且与枚举逐个对应（⛔ 不多不少）', () => {
  assert.equal(LIFECYCLE_SPEC.length, 8);
  assert.equal(LIFECYCLE_DIMS.length, 8);
  assert.deepEqual(LIFECYCLE_SPEC.map((d) => d.dim).sort(), LIFECYCLE_DIMS.slice().sort());
});

t.ok('每个维度都有 label 与 question（UI 可直接消费，不需自行解释）', () => {
  for (const d of LIFECYCLE_SPEC) {
    assert.ok(d.label && d.label.length > 0, d.dim + ' 缺 label');
    assert.ok(d.question && d.question.length > 0, d.dim + ' 缺 question');
  }
});

/* ---------------- 2) 无数据 ⇒ NOT_PROVIDED（⛔ 不写死） ---------------- */

t.ok('无 runtime_status ⇒ 全 8 维 ABSENT，且原因为 RUNTIME_STATUS_UNAVAILABLE', () => {
  const lc = readLifecycle(null, null);
  assert.equal(lc.runtimeStatusAvailable, false);
  for (const dim of LIFECYCLE_DIMS) {
    assertState(lc.dims[dim], FIELD_STATE.UNAVAILABLE, dim);
    assert.equal(lc.dims[dim].missingReason, MISSING_REASON.RUNTIME_STATUS_UNAVAILABLE, dim);
    assert.equal(val(lc.dims[dim]), null, dim + ' ⛔ 不得给出猜测量');
  }
});

t.ok('有 runtime_status（含真实 gen1_engine）⇒ 仅 deployment_identity 有值，其余仍 ABSENT', () => {
  const rt = FIXTURES.liveConstants().runtime_status;
  const lc = readLifecycle(rt, null);
  assert.equal(lc.runtimeStatusAvailable, true);
  assertState(lc.dims.deployment_identity, FIELD_STATE.PROVIDED, 'deployment_identity');
  // ⚠️ 该值是「引擎版本」（线上 v3.6.1），**不是**台账的 V3.6.5 部署身份
  assert.equal(val(lc.dims.deployment_identity), 'v3.6.1');
  assert.match(lc.dims.deployment_identity.provenance.source, /runtime_status/);
  // 其余 7 维必须仍是 ABSENT（⛔ 不得由引擎版本外推部署状态）
  for (const dim of LIFECYCLE_DIMS) {
    if (dim === 'deployment_identity') continue;
    assertState(lc.dims[dim], FIELD_STATE.UNAVAILABLE, dim);
  }
});

t.ok('★ 静态登记默认关闭（STATIC_REGISTER = null），⛔ 前端不硬编码当前状态', () => {
  assert.equal(STATIC_REGISTER, null, 'D-2 方案 B 未授权前必须为 null');
});

t.ok('注入静态登记后 8 维全部可表达（D-2 方案 B 的接入点可用）', () => {
  const reg = {
    asOf: '2026-09-30',
    anchor: 'ledger C-021.2',
    values: {
      deployment: 'COMPLETE',
      deployment_identity: 'V3.6.5',
      source_parity: 'EXACT_MATCH',
      activation_authorization: 'NOT_GRANTED',
      first_controlled_run: 'NOT_EXECUTED',
      prospective_epoch: 'NOT_STARTED',
      run_history: 'PENDING',
      general_production: false
    }
  };
  const lc = readLifecycle(null, null, reg);
  assert.equal(lc.staticRegisterUsed, true);
  assert.equal(val(lc.dims.deployment), 'COMPLETE');
  assert.equal(val(lc.dims.deployment_identity), 'V3.6.5');
  assert.equal(val(lc.dims.activation_authorization), 'NOT_GRANTED');
  assert.equal(val(lc.dims.first_controlled_run), 'NOT_EXECUTED');
  assert.equal(val(lc.dims.prospective_epoch), 'NOT_STARTED');
  assert.equal(val(lc.dims.general_production), false);
  // 使用静态登记时必须带 asOf（UI 要标注「最后同步日期」）
  assert.equal(lc.dims.deployment.provenance.asOf, '2026-09-30');
  assert.equal(lc.dims.deployment.provenance.derived, true, '静态登记属推导来源，必须标注');
});

/* ---------------- 3) 三个轴必须可区分（§1.3 核心） ---------------- */

t.ok('三个轴定义存在，且 8 维全部被某个轴覆盖（⛔ 无归属遗漏）', () => {
  assert.equal(LIFECYCLE_AXES.length, 3);
  assert.deepEqual(LIFECYCLE_AXES.map((a) => a.axis), ['code_on_line', 'production_run', 'qualification']);
  for (const dim of LIFECYCLE_DIMS) {
    assert.ok(DIM_TO_AXIS[dim], dim + ' 未归入任何轴');
  }
});

t.ok('「部署完成」与「生产运行」在**不同轴**（⛔ 不得合并）', () => {
  assert.equal(DIM_TO_AXIS.deployment, 'code_on_line');
  assert.equal(DIM_TO_AXIS.first_controlled_run, 'production_run');
  assert.equal(DIM_TO_AXIS.general_production, 'qualification');
  assert.notEqual(DIM_TO_AXIS.deployment, DIM_TO_AXIS.first_controlled_run);
});

t.ok('轴分离校验器：合法 VM 无违规（自检防永真：违规对象必须被抓出）', () => {
  const lc = readLifecycle(null, null);
  assert.deepEqual(validateAxisSeparation(lc), [], '正常 VM 不应有违规');
  // 反例：任何「合并成单一状态」的对象都必须被识别
  assert.ok(validateAxisSeparation({ overall_status: 'COMPLETE' }).length === 1);
  assert.ok(validateAxisSeparation({ a: { production_status: 'X' } }).length === 1);
  assert.ok(validateAxisSeparation({ lifecycle_status: 'OK', is_production_ready: true }).length === 2);
  assert.ok(validateAxisSeparation({ production_running: true }).length === 1);
});

t.ok('readLifecycle 的输出**不含**被禁的塌缩字段名', () => {
  for (const [key, lc] of [['null', readLifecycle(null, null)],
    ['runtime', readLifecycle(FIXTURES.liveConstants().runtime_status, null)]]) {
    assert.deepEqual(validateAxisSeparation(lc), [], key + ' 输出含塌缩字段');
  }
});

/* ---------------- 4) 边界字段组（§7.2） ---------------- */

t.ok('边界字段组共 7 项，每项都有 counter（反例说明）', () => {
  assert.equal(BOUNDARY_FIELDS.length, 7);
  for (const f of BOUNDARY_FIELDS) {
    assert.ok(f.label && f.counter, f.key + ' 缺 label/counter');
    assert.ok(/advisory|execution|独立|恒 false|恒false/.test(f.counter), f.key + ' 的 counter 应写明语义独立或恒值');
  }
});

t.ok('从线上 runtime_status 读出边界字段真实值（含反例：advisory=true 而 execution=false）', () => {
  const rt = FIXTURES.liveConstants().runtime_status;
  const fields = readBoundaryFields(rt);
  const by = Object.fromEntries(fields.map((f) => [f.key, f]));
  assert.equal(val(by.ml_advisory_enabled.field), true, '前置：advisory 为 true');
  assert.equal(val(by.ml_execution_enabled.field), false, '前置：execution 为 false');
  assert.equal(val(by.ml_effective.field), false);
  assert.equal(val(by.gen1_production_write.field), false);
  assert.equal(val(by.gen1_auto_execution.field), false);
  assert.equal(val(by.gen1_broker_wired.field), false);
  assert.equal(val(by.gen1_production_fast_path_enabled.field), false);
  // ★ 反例成立：不能因为 advisory=true 就推断 execution=true
  assert.notEqual(val(by.ml_advisory_enabled.field), val(by.ml_execution_enabled.field));
});

t.ok('runtime_status 缺失 ⇒ 边界字段全 UNKNOWN（三态，⛔ 不压成 false）', () => {
  const fields = readBoundaryFields(null);
  for (const f of fields) {
    assertState(f.field, FIELD_STATE.UNAVAILABLE, f.key);
    assert.notEqual(val(f.field), false, f.key + ' ⛔ 缺失不得当 false');
  }
});

/* ---------------- 5) 静态守卫：⛔ 模块内不得硬编码生命周期状态 ---------------- */

t.ok('domain/lifecycle.js ⛔ 不硬编码 COMPLETE / NOT_STARTED（剥离注释后断言）', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src', 'rewrite', 'domain', 'lifecycle.js'), 'utf8');
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  // `values: ['COMPLETE', ...]` 是**取值域声明**，允许；但不得出现赋值式硬编码
  assert.ok(!/=\s*'COMPLETE'/.test(stripped), '不得把 COMPLETE 赋给变量');
  assert.ok(!/deployment:\s*'COMPLETE'/.test(stripped), '不得默认 deployment=COMPLETE');
  assert.ok(!/prospective_epoch:\s*'NOT_STARTED'/.test(stripped), '不得默认 epoch=NOT_STARTED');
  assert.ok(/STATIC_REGISTER\s*=\s*null/.test(stripped), 'STATIC_REGISTER 必须默认为 null');
});

t.ok('违规文案常量齐备（供 spec-guards 复用）', () => {
  assert.ok(FORBIDDEN_LIFECYCLE_PHRASES.length >= 5);
  assert.ok(FORBIDDEN_LIFECYCLE_PHRASES.includes('正式生产运行'));
  assert.ok(FORBIDDEN_LIFECYCLE_PHRASES.includes('最近生产运行'));
});

t.done();
