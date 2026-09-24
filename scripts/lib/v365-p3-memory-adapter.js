/**
 * V3.6.5 P-3 —— 内存 adapter（**PoC / 测试专用**）
 *
 * ⛔ 不创建任何生产 collection、不连接 CloudBase、不被 cloudfunctions/ 引用。
 * 用途：在没有真实数据库的前提下，验证「单指针 CAS 提升」的语义与失败模式。
 *
 * 提供的能力（刻意只给最小集，便于对照真实平台能力）：
 *   - getPointer / compareAndSetPointer （**CAS**：expected 与 current 完全一致才写）
 *   - putManifest / getManifest
 *   - putCandidate / getCandidate / listCandidates
 *   - injectFailure(op, key?, times?) （故障注入）
 *
 * 设计要点：
 *   - 所有写入**深拷贝**，防止调用方持有引用造成「假通过」。
 *   - compareAndSetPointer 在**一个同步临界区**内完成「读→比→写」，
 *     模拟真实平台的**单文档原子更新**语义（2026-09-24 平台实证：
 *     `findAndModify + expected-current filter + revision guard` 即为该语义）。
 *   - ⚠️ 判定逻辑**复用** `src/common/utils/v365-publish-store.js::classifyPointerPromotion`
 *     ⇒ 内存适配器与 CloudBase 适配器**共享同一套 reason 语义**，测试结论可迁移。
 *   - 不做任何基于 wall-clock 的排序或覆盖。
 */
'use strict';

const { classifyPointerPromotion } = require('../../src/common/utils/v365-publish-store.js');

function deepCopy(v) {
  return v == null ? v : JSON.parse(JSON.stringify(v));
}

function pointerKey(p) {
  return p == null ? '∅' : `${p.run_id}@${p.revision}`;
}

function createMemoryAdapter(opts) {
  const o = opts || {};
  const pointers = new Map();     // scope -> pointer
  const manifests = new Map();    // run_id -> manifest
  const candidates = new Map();   // `${col}::${run_id}` -> Map(key -> payload)
  const calls = [];
  const injections = [];

  function record(op, detail) {
    calls.push({ op, detail: detail == null ? null : String(detail) });
  }

  function maybeFail(op, detail) {
    for (const f of injections) {
      if (f.op !== op) continue;
      if (f.key != null && f.key !== (detail == null ? null : String(detail))) continue;
      if (f.remaining <= 0) continue;
      f.remaining -= 1;
      const e = new Error(`injected_failure:${op}${detail == null ? '' : ':' + detail}`);
      e.code = 'INJECTED_FAILURE';
      e.injected_op = op;
      throw e;
    }
  }

  return {
    /** 故障注入：在 op（可选限定 key）上抛错，times 次 */
    injectFailure(op, key, times) {
      injections.push({
        op,
        key: key == null ? null : String(key),
        remaining: times == null ? 1 : Number(times)
      });
      return this;
    },

    getCalls() { return calls.slice(); },
    clearCalls() { calls.length = 0; },

    async getPointer(scope) {
      record('getPointer', scope);
      maybeFail('getPointer', scope);
      return deepCopy(pointers.get(scope) || null);
    },

    /**
     * CAS：仅当 `expected` 与当前 pointer 完全一致时才写入 `next`。
     *
     * ⚠️ 与 CloudBase 适配器**同构**：判定走共享的 `classifyPointerPromotion`，
     *    并在同一同步临界区内完成「读→判→写」⇒ 读与写之间不存在可插入的窗口。
     *
     * @returns {{ok:boolean, promoted:boolean, reason:string, idempotent:boolean,
     *            previous_run_id:string|null, previous_revision:number|null,
     *            requested_run_id:string|null, requested_revision:number|null,
     *            current:object|null}}
     */
    async compareAndSetPointer(scope, expected, next) {
      record('compareAndSetPointer', `${scope}|expected=${pointerKey(expected)}|next=${pointerKey(next)}`);
      maybeFail('compareAndSetPointer', scope);
      // ---- 同步临界区：读 → 判 → 写 ----
      const current = pointers.get(scope) || null;
      const verdict = classifyPointerPromotion({ expected, current, next });
      if (verdict.promoted !== true) {
        return Object.assign({ ok: false, current: deepCopy(current) }, verdict);
      }
      pointers.set(scope, deepCopy(next));
      return Object.assign({
        ok: true,
        promoted: true,
        current: deepCopy(next),
        pointer: deepCopy(next),
        read_after_write_consistent: true
      }, verdict);
    },

    async putManifest(doc) {
      record('putManifest', doc && doc.run_id);
      maybeFail('putManifest', doc && doc.run_id);
      const prev = manifests.get(doc.run_id);
      manifests.set(doc.run_id, deepCopy(doc));
      return { replaced: prev != null };
    },

    async getManifest(runId) {
      record('getManifest', runId);
      maybeFail('getManifest', runId);
      return deepCopy(manifests.get(runId) || null);
    },

    async putCandidate(col, runId, key, payload) {
      const k = `${col}::${runId}`;
      record('putCandidate', `${col}:${key}`);
      maybeFail('putCandidate', `${col}:${key}`);
      if (!candidates.has(k)) candidates.set(k, new Map());
      candidates.get(k).set(String(key), deepCopy(payload));
      return { ok: true };
    },

    async getCandidate(col, runId, key) {
      const k = `${col}::${runId}`;
      record('getCandidate', `${col}:${key}`);
      maybeFail('getCandidate', `${col}:${key}`);
      const m = candidates.get(k);
      return m ? deepCopy(m.get(String(key)) || null) : null;
    },

    async listCandidates(col, runId) {
      const k = `${col}::${runId}`;
      record('listCandidates', col);
      maybeFail('listCandidates', col);
      const m = candidates.get(k);
      if (!m) return [];
      return Array.from(m.values()).map(deepCopy);
    },

    /** 只读快照（测试断言用） */
    snapshot() {
      const out = { pointers: {}, manifests: {}, candidate_counts: {} };
      pointers.forEach((v, k) => { out.pointers[k] = deepCopy(v); });
      manifests.forEach((v, k) => { out.manifests[k] = deepCopy(v); });
      candidates.forEach((v, k) => { out.candidate_counts[k] = v.size; });
      return out;
    }
  };
}

module.exports = { createMemoryAdapter, pointerKey };
