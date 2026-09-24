'use strict';

/**
 * V3.6.5 authoritative 读取路径（B1 reader-side 参考实现）。
 *
 * 语义（任务书 §11）：
 *   authoritative read 必须是  读 active_run_pointer → 读该 run_id 的数据集
 *   ⛔ 不得用 `orderBy(updated_at|decision_date|snapshot_date desc).limit(1)` 去"猜"当前权威结果。
 *
 * 本模块同时提供**迁移扫描器**：把仓库里仍在用「取最新一条」猜测权威的读取点机器化列出，
 * 使 reader migration 可被测试/CI 持续跟踪，而不是靠人记。
 */

const CONTRACTS = require('./v365-contracts.js');

/** 被禁止的 authoritative 读取形态（机器可判定的描述符） */
const FORBIDDEN_READ_PATTERNS = Object.freeze([
  {
    id: 'LATEST_DECISION_BY_DATE',
    collection: 'decision_result',
    detect: /orderBy\s*:\s*\[\s*\{[^}]*field\s*:\s*['"]decision_date['"][^}]*direction\s*:\s*['"]desc['"]/,
    why: '按 decision_date 取最新一条 = 跨 run 混合（partial publication 暴露面）'
  },
  {
    id: 'LATEST_SNAPSHOT_BY_DATE',
    collection: 'portfolio_snapshot',
    detect: /orderBy\s*:\s*\[\s*\{[^}]*field\s*:\s*['"]snapshot_date['"][^}]*direction\s*:\s*['"]desc['"]/,
    why: '按 snapshot_date 取最新一条 = 跨 run 混合'
  },
  {
    id: 'LATEST_BY_UPDATED_AT',
    collection: '(any)',
    detect: /orderBy\s*:\s*\[\s*\{[^}]*field\s*:\s*['"]updated_at['"][^}]*direction\s*:\s*['"]desc['"]/,
    why: '按 updated_at 取最新 = 以写入时刻代替 run 身份'
  }
]);

/** 扫描一段源码文本，返回命中的禁止形态（只读；不修改文件） */
function scanForbiddenReads(sourceText, label) {
  const s = String(sourceText || '');
  const hits = [];
  FORBIDDEN_READ_PATTERNS.forEach((p) => {
    const lines = s.split(/\r?\n/);
    lines.forEach((line, idx) => {
      if (p.detect.test(line)) {
        hits.push({ pattern: p.id, collection: p.collection, file: label || null, line: idx + 1, code: line.trim().slice(0, 160), why: p.why });
      }
    });
  });
  return hits;
}

/**
 * 解析当前 authoritative 指针。
 * @returns {{resolved:boolean, scope:string, run_id:string|null, revision:number|null, reason:string|null}}
 */
async function resolveActivePointer(store, scope) {
  const sc = scope || CONTRACTS.POINTER_SCOPE_PRODUCTION;
  const p = await store.getPointer(sc);
  if (!p || p.run_id == null) {
    return { resolved: false, scope: sc, run_id: null, revision: null, reason: 'NO_ACTIVE_POINTER' };
  }
  return {
    resolved: true,
    scope: sc,
    run_id: String(p.run_id),
    revision: p.revision != null ? p.revision : null,
    expected_trade_date: p.expected_trade_date != null ? p.expected_trade_date : null,
    reason: null
  };
}

/**
 * 只读 active run 的完整数据集。
 * ⛔ 只返回 active run 的候选文档；candidate/其他 run 的数据**绝不**混入。
 */
async function readActiveRunDataset(store, opts) {
  const o = opts || {};
  const scope = o.scope || CONTRACTS.POINTER_SCOPE_PRODUCTION;
  const ptr = await resolveActivePointer(store, scope);
  if (!ptr.resolved) {
    return { ...ptr, decisions: [], portfolio: null, decision_count: 0, complete: false };
  }
  const decisions = await store.listCandidates(
    CONTRACTS.V365_COLLECTIONS.CANDIDATE_DECISION, ptr.run_id
  );
  const portfolio = await store.getCandidate(
    CONTRACTS.V365_COLLECTIONS.CANDIDATE_PORTFOLIO, ptr.run_id, 'portfolio'
  );
  const codes = o.expected_codes || null;
  const got = decisions.map((d) => d && d.code).filter((c) => c != null).map(String);
  const complete = codes ? codes.every((c) => got.includes(String(c))) : decisions.length > 0;
  return {
    ...ptr,
    decisions,
    decision_count: decisions.length,
    portfolio,
    complete,
    completeness_basis: codes ? 'expected_codes ⊆ active_decisions' : 'non_empty'
  };
}

/**
 * 兼容投影（compatibility projection）计划。
 *
 * 用途：过渡期若必须保留 legacy collection 给未迁移的 reader，
 *       必须证明「legacy consumer 看到的仍只来自当前 ACTIVE run」。
 *
 * ⚠️ 诚实边界：**多文档投影本身不是原子的**。因此：
 *   - 仅当 reader 已迁移到 pointer 路径时，atomicity 才真正成立；
 *   - 若启用投影，必须**显式声明**存在投影窗口（`projection_window_risk: true`）。
 */
function planCompatibilityProjection(input) {
  const i = input || {};
  return {
    enabled: i.enabled === true,
    targets: ['decision_result', 'portfolio_snapshot'].slice(),
    must_stamp_run_id: true,
    required_field: 'run_id',
    projection_window_risk: true,
    projection_window_note:
      '投影为多文档写入（5 票 + 快照），窗口内未迁移的 reader 可能看到新旧混合。'
      + '⇒ 投影**不能**替代 reader migration；只有在 reader 已按 active_run_pointer 读取后，atomicity 才成立。',
    reader_migration_status: i.reader_migration_status || 'PENDING'
  };
}

module.exports = {
  FORBIDDEN_READ_PATTERNS,
  scanForbiddenReads,
  resolveActivePointer,
  readActiveRunDataset,
  planCompatibilityProjection
};
