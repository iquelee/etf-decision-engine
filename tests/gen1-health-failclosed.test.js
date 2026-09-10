'use strict';

/**
 * WP-G1.2 G1.2-02：Health State 读取 Fail-Closed（复审 P0）。
 *
 * 复审问题：`readHealthState` 曾把任何异常吞成 `defaultHealthState()`（latched = OK）
 * → 「DB 异常 = Gen-1 健康 OK」，与 WP-G1 的 Fail-Closed 原则冲突，
 * 且外层 catch 永远收不到异常（错误被吃掉）。
 *
 * 本测试锁定三态契约：
 *   FOUND           → ACTIVE
 *   NOT_INITIALIZED → PENDING（advisory 可继续 / canary OFF），且不落库
 *   READ_ERROR      → ML_OFF（fail-closed），且**绝不落库**（不得伪造新真相）
 */
const assert = require('assert');
const {
  readHealthState, writeHealthState, healthStateToGate, computeLatchedState, defaultHealthState
} = require('../src/common/utils/gen1-health-state');
const { HEALTH } = require('../src/common/utils/gen1-circuit-breaker');

function fakeDb(rows, shouldThrow) {
  const calls = { query: 0, upsert: 0 };
  return {
    calls,
    lastDoc: null,
    async query() {
      calls.query += 1;
      if (shouldThrow) throw new Error('network unreachable');
      return rows;
    },
    async upsert(col, doc) { calls.upsert += 1; this.lastDoc = doc; return { ok: true }; }
  };
}

(async () => {
  /* ---- 1) FOUND ---- */
  {
    const db = fakeDb([{ key: 'gen1-health-state', latched_health: HEALTH.DEGRADED, manual_review_required: true }]);
    const s = await readHealthState(db, {});
    assert.strictEqual(s.read_status, 'FOUND');
    assert.strictEqual(s.latched_health, HEALTH.DEGRADED);
    assert.strictEqual(s.persist_allowed, true);
    const gate = healthStateToGate(s);
    assert.strictEqual(gate.gate_status, 'ACTIVE');
    assert.strictEqual(gate.allow_canary, false);
  }

  /* ---- 2) NOT_INITIALIZED → PENDING（不是 OK 通行证）---- */
  {
    const db = fakeDb([]);
    const s = await readHealthState(db, {});
    assert.strictEqual(s.read_status, 'NOT_INITIALIZED');
    assert.strictEqual(s.persist_allowed, false, '未初始化不得被任何调用方当成可写真相');
    const gate = healthStateToGate(s);
    assert.strictEqual(gate.gate_status, 'PENDING');
    assert.strictEqual(gate.allow_advisory, true, 'PENDING 不阻断 ADVISORY');
    assert.strictEqual(gate.allow_canary, false, 'PENDING 必须关闭 CANARY');
    assert.strictEqual(gate.read_reason_code, 'HEALTH_STATE_NOT_INITIALIZED');
  }

  /* ---- 3) ★ 核心：READ_ERROR → ML_OFF，绝不 default OK ---- */
  {
    const db = fakeDb(null, true);
    const s = await readHealthState(db, {});
    assert.strictEqual(s.read_status, 'READ_ERROR');
    assert.strictEqual(s.latched_health, HEALTH.ML_OFF, '读取异常不得回落 OK');
    assert.strictEqual(s.persist_allowed, false);
    assert.strictEqual(s.read_reason_code, 'HEALTH_STATE_READ_ERROR');
    assert.ok(/network/.test(s.read_error), '保留原始错误信息供排障');

    const gate = healthStateToGate(s);
    assert.strictEqual(gate.gate_status, 'READ_ERROR');
    assert.strictEqual(gate.allow_advisory, false);
    assert.strictEqual(gate.allow_canary, false);
    assert.strictEqual(gate.immediate_fallback_v361, true);
  }

  /* ---- 4) ★ 核心：READ_ERROR 时 computeLatchedState + writeHealthState 不得落库 ---- */
  {
    const db = fakeDb(null, true);
    const read = await readHealthState(db, {});
    const latch = computeLatchedState(read, HEALTH.OK, { now: 'T10' });
    assert.strictEqual(latch.persisted, false);
    assert.strictEqual(latch.state.latched_health, HEALTH.ML_OFF, '读异常 → 不因 incoming OK 而升级');
    assert.strictEqual(latch.state.persist_allowed, false);

    const written = await writeHealthState(db, latch.state, {});
    assert.strictEqual(db.calls.upsert, 0, '★ 读异常时 upsert 必须被跳过（不得伪造 OK 覆盖 latch）');
    assert.strictEqual(written.read_status, 'READ_ERROR');
    assert.strictEqual(written.latched_health, HEALTH.ML_OFF);
  }

  /* ---- 5) 正常路径仍可落库（bootstrap 不被误伤）---- */
  {
    const db = fakeDb([]);
    const read = await readHealthState(db, {});
    assert.strictEqual(read.read_status, 'NOT_INITIALIZED');
    const latch = computeLatchedState(read, HEALTH.DEGRADED, { now: 'T11' });
    assert.strictEqual(latch.persisted, true, '正常计算路径允许落库');
    const written = await writeHealthState(db, latch.state, {});
    assert.strictEqual(db.calls.upsert, 1, 'bootstrap/正常路径必须能写入');
    assert.strictEqual(written.read_status, 'FOUND');
    assert.strictEqual(written.latched_health, HEALTH.DEGRADED);
  }

  /* ---- 6) 落库文档不残留内部控制字段 ---- */
  {
    const db = fakeDb([]);
    const latch = computeLatchedState(defaultHealthState(), HEALTH.OK, { now: 'T12' });
    const written = await writeHealthState(db, latch.state, {});
    assert.ok(db.lastDoc, '正常路径必须调用 upsert');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(db.lastDoc, 'persist_allowed'), false,
      'persist_allowed 是内部控制字段，不得落库');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(db.lastDoc, 'read_status'), false,
      'read_status 是读取态，不得落库');
    assert.strictEqual(db.lastDoc.latched_health, HEALTH.OK);
    assert.strictEqual(written.read_status, 'FOUND');
  }

  console.log('gen1 health fail-closed tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
