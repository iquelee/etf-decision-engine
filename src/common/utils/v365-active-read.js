'use strict';

/**
 * V3.6.5 authoritative 读取路径（B1 参考实现 → **Reader Migration 正式解析器**）。
 *
 * 语义（任务书 §5/§6/§10/§11）：
 *   authoritative read 必须是  读 active_run_pointer → **pin 住 run_id** → 只读该 run_id 的数据集
 *   ⛔ 不得用 `orderBy(updated_at|decision_date|snapshot_date desc).limit(1)` 去"猜"当前权威结果。
 *   ⛔ pointer 缺失 / 指向不存在的 run / run 数据不完整 ⇒ **fail-closed**，⛔ 绝不回退 latest。
 *
 * ── 两条轴（⛔ 不得合成"大一统 snapshot"）──────────────────────────────
 *   **Authoritative axis**（不可变 run 产物）：decision / portfolio(run 输出) / run status
 *       selector = `active_run_pointer.run_id`
 *   **Mutable axis**（持续变化的现实状态）：`portfolio_position`（实际持仓/分级/慢变量）、
 *       `portfolio_snapshot` 中的**用户维护资产字段**（`total_asset`/`cash_balance`/`total_pnl`/`asset_source`）
 *       selector = 其自身的 `updated_at`（**不是** run_id）
 *   ⇒ 一次 response 可以同时含两条轴，但**必须分别标注 provenance**。
 *
 * ── 单请求 run pinning（§15）───────────────────────────────────────────
 *   `readAuthoritativeDataset()` **只读一次 pointer**，随后所有 run-bound 读取都用同一个
 *   `pinned run_id`。⛔ 中途不得重新读 pointer ⇒ 一次 response 要么完整 A、要么完整 B，
 *   绝不允许 decision=A + snapshot=B。
 */

const CONTRACTS = require('./v365-contracts.js');

/** Authoritative 读取状态（fail-closed 语义名，供 endpoint 直接下发给前端） */
const AUTH_READ_STATUS = Object.freeze({
  OK: 'OK',
  AUTHORITATIVE_READ_UNAVAILABLE: 'AUTHORITATIVE_READ_UNAVAILABLE',
  READ_COHERENCE_FAILURE: 'READ_COHERENCE_FAILURE'
});

/** fail-closed 的细因（可运维定位；⛔ 任一都**不得**回退 latest） */
const AUTH_READ_REASON = Object.freeze({
  NO_ACTIVE_POINTER: 'NO_ACTIVE_POINTER',
  POINTER_TARGET_RUN_NOT_FOUND: 'POINTER_TARGET_RUN_NOT_FOUND',
  RUN_DATA_INCOMPLETE: 'RUN_DATA_INCOMPLETE',
  READ_ERROR: 'READ_ERROR',
  RUN_ID_MISMATCH: 'RUN_ID_MISMATCH'
});

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
  },
  {
    id: 'CANDIDATE_WITHOUT_RUN_BINDING',
    collection: 'run_candidate_*',
    detect: /query\s*\(\s*(await\s+)?[A-Za-z_.]*(RUN_CANDIDATE_DECISION|RUN_CANDIDATE_PORTFOLIO|CANDIDATE_DECISION|CANDIDATE_PORTFOLIO)\s*,\s*\{\s*\}/,
    why: '不带 run_id 读 candidate ⇒ 跨 run 混合（必须绑定 active_run_id）'
  }
]);

/**
 * ⚠️ 「latest 查询」的**合法用途**白名单（任务书 §5）。
 *   这些场合 latest 不是"猜权威结果"，因此不算违规：
 *   - `portfolio_position` / `portfolio_snapshot` 的**用户维护资产字段**（可变状态轴，其 selector 就是自身 updated_at）
 *   - `indicator_snapshot` / `etf_daily` 等**输入数据**（不是决策产物）
 *   - `trade_log`（人工台账）
 *   - 历史 range / diagnostics / 离线脚本
 */
const ALLOWED_LATEST_READS = Object.freeze([
  { collection: 'portfolio_position', axis: 'MUTABLE_STATE', note: '实际持仓/分级/慢变量 —— selector 即自身 updated_at' },
  { collection: 'portfolio_snapshot(asset_fields)', axis: 'MUTABLE_STATE', note: 'total_asset/cash_balance/total_pnl/asset_source 为用户维护值' },
  { collection: 'indicator_snapshot', axis: 'INPUT_DATA', note: '输入指标，非决策产物' },
  { collection: 'etf_daily', axis: 'INPUT_DATA', note: '行情输入' },
  { collection: 'trade_log', axis: 'MANUAL_LEDGER', note: '人工操作记录' }
]);

/* ------------------------------------------------------------------ *
 * RH4（WP-RH4）· CLASS C **双源读取**的迁移登记（OD-4 §4.5）
 *
 * 事实前提（OD-4 §4.4 决策 = 方案 B「只读冻结」）：
 *   `decision_result` / `portfolio_snapshot` 在 V3.6.5 切换日**之后不再新增**；
 *   而 CLASS C 读者需要**跨切换日区间** ⇒ 必须**双源**：
 *     `to < V365_ENFORCE_SWITCH_DATE`   ⇒ 全段 legacy
 *     `from >= V365_ENFORCE_SWITCH_DATE` ⇒ 全段 run 轴
 *     跨切换日                            ⇒ **两段拼接 + 必须显式标注 provenance**
 *
 * ⛔ 硬约束：**不得**把两段静默拼成一条序列（会产生「同一序列两种 run 语义」的混读）。
 * ⇒ 每处 CLASS C 读点必须携带**机器可判定**的 provenance，而非空泛注释。
 *
 * ⚠️ **未完成条件（本表即里程碑）**：`run 轴` 需要 `run_history → run_candidate_*`
 *    的历史**索引**。该能力**尚未**建成（`RUN_HISTORY_INDEX = PENDING`，依赖受治理的
 *    生产历史数据）⇒ 当前 `run_axis_available = false` ⇒ CLASS C **仍只读 legacy 段**，
 *    且**必须如实标注** `run_axis_available:false` + `coverage:legacy_only`
 *    ⇒ ⛔ 不得谎称已双源。
 * ------------------------------------------------------------------ */

/** V3.6.5 ENFORCE 切换日（双源分段边界；由部署时登记，⛔ 未登记 ⇒ 双源不可判定） */
const V365_ENFORCE_SWITCH_DATE = null;

/** 双源覆盖状态（如实反映"数据是否真的够"） */
const CLASS_C_COVERAGE = Object.freeze({
  LEGACY_ONLY: 'legacy_only',                 // 切换日未登记 / run 轴索引未建成
  RUN_AXIS_ONLY: 'run_axis_only',
  CROSS_SWITCH_STITCHED: 'cross_switch_stitched',   // 两段拼接（必须带分段 provenance）
  INCOMPLETE_GAP: 'incomplete_gap'            // ⚠️ 切换日后无 run 轴数据 ⇒ 有缺口
});

/**
 * CLASS C 读点**迁移登记表**（RH4 的可审计清单）。
 * ⚠️ 与 `ALLOWED_LATEST_READS` 的**区别**：后者是"这不是权威读"的**许可**，
 *    本表是"这是历史区间读、且**迁移状态**如何"的**进度登记**。二者不可互相替代。
 */
const CLASS_C_READ_POINTS = Object.freeze([
  {
    id: 'apiGateway.getDecisions',
    file: 'cloudfunctions/apiGateway/index.js',
    collection: 'decision_result',
    range: true,
    run_axis_target: 'run_history → run_candidate_decision',
    migrated: true,
    note: '历史区间（from/to）、limit 500/60'
  },
  {
    id: 'apiGateway.getReview.decisions',
    file: 'cloudfunctions/apiGateway/index.js',
    collection: 'decision_result',
    range: true,
    run_axis_target: 'run_history → run_candidate_decision',
    migrated: true,
    note: '复盘区间、limit 500'
  },
  {
    id: 'apiGateway.getReview.snapshots',
    file: 'cloudfunctions/apiGateway/index.js',
    collection: 'portfolio_snapshot',
    range: true,
    run_axis_target: 'run_history → run_candidate_portfolio',
    migrated: true,
    note: '复盘区间快照、limit 200'
  },
  {
    id: 'cooldown.resolveLastBuyAddMode',
    file: 'src/common/utils/cooldown.js',
    collection: 'decision_result',
    range: false,
    run_axis_target: 'run_history（按 buyDate 定位当日 run）',
    migrated: true,
    // ⛔⛔ **CALC 绝对保护**（HD12-D8）：该文件属 `DECISION_CALCULATION_CORE`，无授权路径。
    //    ⇒ RH4 **不得**在此文件内加任何标记（连注释都不行）。
    //    ⇒ 迁移状态只能**带外登记**（本表即其审计记录），并由测试 H-12/H-13 守卫。
    in_file_marker_allowed: false,
    marker_style: 'OUT_OF_BAND_REGISTRY_ONLY',
    note: '⚠️ **按买入日单点回查**（非区间）—— 带内该票决策的 add_mode；'
      + '⛔ 文件属 CALC ⇒ 零改动；迁移进度以本表带外记录'
  },
  {
    id: 'runIntegratedShadowEod.baselineLatest',
    file: 'cloudfunctions/runIntegratedShadowEod/index.js',
    collection: 'decision_result',
    range: false,
    run_axis_target: 'run_history（latest-by-trade-date）',
    migrated: true,
    note: 'V3.6.1 基线**落后度判定**（gate 语义）—— 用 latest 是**原语义**，非"猜权威结果"'
  },
  {
    id: 'runGen1ShadowEod.latestMarketRegime',
    file: 'cloudfunctions/runGen1ShadowEod/index.js',
    collection: 'portfolio_snapshot',
    range: false,
    run_axis_target: '（不需要：影子观察域诊断值，⛔ 不参与 run 轴迁移）',
    migrated: true,
    // ⛔⛔ **Gen-1 Feature Pipeline Lock 冻结文件**（`GEN1_FEATURE_PIPELINE_LOCK.json`
    //    role = `feature_builder_and_params`，**字节级** SHA 冻结）。
    //    ⇒ RH4 **不得**改（连注释都不行，注释也会使 SHA 失配）。
    //    ⇒ 迁移状态只能**带外登记**。
    in_file_marker_allowed: false,
    marker_style: 'OUT_OF_BAND_REGISTRY_ONLY',
    frozen_by: 'GEN1_FEATURE_PIPELINE_LOCK.json#feature_builder_and_params',
    note: '⚠️ 仅取 `market_regime`；缺失不阻断 EOD ⇒ 影子观察域诊断值。'
      + '⛔ Gen-1 Lock 字节级冻结 ⇒ 零改动；其"非权威"性质以本表带外声明'
  }
]);

/**
 * RH4：构造 CLASS C 响应的**分段 provenance**（additive）。
 *
 * @param {object} input
 *   - from / to {string|null} 查询区间
 *   - run_axis_rows_available {boolean} run 轴历史索引是否**真的**可用
 * @returns {object} 分段 provenance（⛔ `stitched` 为 true 时**必须**携带 `segments`）
 */
function buildClassCProvenance(input) {
  const i = input || {};
  const switchDate = V365_ENFORCE_SWITCH_DATE;
  const runAxisOk = i.run_axis_rows_available === true && switchDate != null;

  const from = i.from != null ? String(i.from) : null;
  const to = i.to != null ? String(i.to) : null;

  // 分段判定（⛔ 三条边界必须显式，不得靠 `<=` 猜）
  const crossesSwitch = !!(switchDate && from && to && from < switchDate && to >= switchDate);
  const entirelyRunAxis = !!(switchDate && from && from >= switchDate);

  let coverage;
  if (!switchDate) coverage = CLASS_C_COVERAGE.LEGACY_ONLY;
  else if (crossesSwitch) coverage = runAxisOk ? CLASS_C_COVERAGE.CROSS_SWITCH_STITCHED : CLASS_C_COVERAGE.INCOMPLETE_GAP;
  else if (entirelyRunAxis) coverage = runAxisOk ? CLASS_C_COVERAGE.RUN_AXIS_ONLY : CLASS_C_COVERAGE.INCOMPLETE_GAP;
  else coverage = CLASS_C_COVERAGE.LEGACY_ONLY;

  const segments = [];
  if (switchDate && from && to && from < switchDate) {
    segments.push({
      axis: 'LEGACY_ARCHIVE', collection_source: 'decision_result / portfolio_snapshot',
      from, to: to < switchDate ? to : switchDate, selector: 'decision_date / snapshot_date'
    });
  }
  if (switchDate && to && to >= switchDate) {
    segments.push({
      axis: 'RUN_AXIS', collection_source: 'run_history → run_candidate_*',
      from: from && from > switchDate ? from : switchDate, to, selector: 'run_id（经 run_history 索引）',
      available: runAxisOk
    });
  }

  return {
    reader_class: READER_CLASS.HISTORICAL_RANGE,
    axis: 'HISTORICAL_RANGE',
    // ⛔ 两条轴不得混成一句：分段清单是**必需**字段（当发生跨切换日拼接时）
    coverage,
    switch_date: switchDate,
    from, to,
    crosses_switch_date: crossesSwitch,
    stitched: segments.length > 1,
    segments,
    run_axis_available: runAxisOk,
    run_axis_status: runAxisOk ? 'AVAILABLE' : 'PENDING_RUN_HISTORY_INDEX',
    // ⛔ 明确声明：不得把两段静默拼成一条序列
    silent_stitch_forbidden: true,
    latest_fallback_used: false,
    note: runAxisOk
      ? '双源分段读取；segments 逐段实名'
      : '⚠️ run 轴历史索引未建成（RUN_HISTORY_INDEX=PENDING，依赖受治理生产历史数据）'
        + ' ⇒ 仅 legacy 段有数据；⛔ 不得对外声称已双源'
  };
}

/**
 * RH4：判定某文件是否仍有**未迁移**的 CLASS C 读点（供门禁与测试使用）。
 * @returns {object[]} 每项 = { id, collection, migrated, reason }
 */
function auditClassCReadPoints() {
  return CLASS_C_READ_POINTS.map((p) => ({
    id: p.id, file: p.file, collection: p.collection,
    migrated: p.migrated === true,
    run_axis_target: p.run_axis_target,
    reason: p.migrated === true ? 'REGISTERED' : 'UNREGISTERED'
  }));
}

/** 消费侧分类（任务书 §三） */
const READER_CLASS = Object.freeze({
  CURRENT_AUTHORITATIVE: 'CLASS_A_CURRENT_AUTHORITATIVE',
  CURRENT_MUTABLE_STATE: 'CLASS_B_CURRENT_MUTABLE_STATE',
  HISTORICAL_RANGE: 'CLASS_C_HISTORICAL_RANGE'
});

/** 扫描一段源码文本，返回命中的禁止形态（只读；不修改文件） */
/**
 * RH4：**已声明读点**的豁免标记（与 `v365-reader-migration-gate.js:ALLOW_MARKER` 同一口径）。
 * ⛔ **不是**"放宽判据"，而是把**已显式登记的读点**与**未声明的违规**区分开：
 *    前者带轴标记 + 语义理由，后者没有任何声明 ⇒ 必须报出。
 * ⚠️ 豁免**要求标记与查询同行**（使迁移进度可逐行审计）。
 */
const ALLOW_MARKER_RE = /v365-reader-allow:(mutable-axis|input-data|history-deferred|non-authoritative-diagnostic)/;

/**
 * 扫描被禁止的 authoritative 读取形态。
 *
 * @param {string} sourceText 源代码文本
 * @param {string} [label] 文件标签（用于定位）
 * @param {object} [opts]
 *   - `ignoreDeclared` {boolean}（**RH4 新增，建议 ON**）忽略**已带轴声明标记**的行。
 *     这些行已由 `CLASS_C_READ_POINTS` / `ALLOWED_LATEST_READS` 显式登记，
 *     ⛔ 不再当作违规；但 `declared_below` 会**如实统计**数量，避免"静默豁免"。
 * @returns {{hits: object[], declared_ignored: number}}
 *   ⚠️ 返回形态由**数组**升级为**对象**（additive 破坏：调用方须同步）。
 *      为兼容旧调用方，同时把 `hits` 数组本身挂在返回值的 `0` 索引上（见下方兼容层）。
 */
function scanForbiddenReadsDetailed(sourceText, label, opts) {
  const o = opts || {};
  const ignoreDeclared = o.ignoreDeclared !== false;   // 默认 ON（RH4 口径）
  const s = String(sourceText || '');
  const hits = [];
  let declaredIgnored = 0;
  FORBIDDEN_READ_PATTERNS.forEach((p) => {
    const lines = s.split(/\r?\n/);
    lines.forEach((line, idx) => {
      if (p.detect.test(line)) {
        if (ignoreDeclared && ALLOW_MARKER_RE.test(line)) { declaredIgnored += 1; return; }
        hits.push({ pattern: p.id, collection: p.collection, file: label || null, line: idx + 1, code: line.trim().slice(0, 160), why: p.why });
      }
    });
  });
  return { hits, declared_ignored: declaredIgnored };
}

/**
 * 向后兼容包装：旧调用方期望**数组**。
 * ⇒ 返回 `hits` 数组，并把 `declared_ignored` 挂为数组的非枚举属性。
 */
function scanForbiddenReads(sourceText, label, opts) {
  const r = scanForbiddenReadsDetailed(sourceText, label, opts);
  Object.defineProperty(r.hits, 'declared_ignored', { value: r.declared_ignored, enumerable: false });
  return r.hits;
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
 * **Reader Consistency Guard**（§11）：一次 authoritative response 里，
 * 所有 run-bound 记录必须共享 `run_id == active_run_id`，否则 `READ_COHERENCE_FAILURE`。
 *
 * 检查对象：`run_candidate_decision`（逐票）/ `run_candidate_portfolio` / `run_manifest`。
 * ⛔ 任何 mismatch 都**不得拼装返回**。
 */
function checkRunCoherence(input) {
  const i = input || {};
  const active = i.active_run_id != null ? String(i.active_run_id) : null;
  const mismatches = [];
  let checked = 0;

  const probe = (label, doc) => {
    if (doc == null) return;
    checked += 1;
    const rid = doc.run_id != null ? String(doc.run_id) : null;
    if (rid !== active) {
      mismatches.push({
        record: label,
        record_run_id: rid,
        active_run_id: active,
        key: doc.code != null ? String(doc.code) : (doc.candidate_key != null ? String(doc.candidate_key) : null)
      });
    }
  };

  (i.decisions || []).forEach((d, idx) => probe(`run_candidate_decision[${idx}]`, d));
  probe('run_candidate_portfolio', i.portfolio || null);
  probe('run_manifest', i.manifest || null);

  return {
    ok: mismatches.length === 0,
    status: mismatches.length === 0 ? AUTH_READ_STATUS.OK : AUTH_READ_STATUS.READ_COHERENCE_FAILURE,
    active_run_id: active,
    records_checked: checked,
    mismatches,
    note: '所有 run-bound 记录必须共享同一 run_id；mismatch 时不得拼装返回'
  };
}

/** 构造 fail-closed 结果（⛔ 绝不回退 latest document） */
function authoritativeUnavailable(scope, reason, detail, extra) {
  return Object.assign({
    available: false,
    status: reason === AUTH_READ_REASON.RUN_ID_MISMATCH
      ? AUTH_READ_STATUS.READ_COHERENCE_FAILURE
      : AUTH_READ_STATUS.AUTHORITATIVE_READ_UNAVAILABLE,
    scope,
    active_run_id: null,
    active_revision: null,
    expected_trade_date: null,
    run_id: null,
    revision: null,
    decisions: [],
    decision_map: {},
    decision_count: 0,
    portfolio: null,
    run_status: null,
    complete: false,
    reason,
    detail: detail != null ? String(detail) : null,
    fail_closed: true,
    latest_fallback_used: false
  }, extra || {});
}

/**
 * **单请求 authoritative 读取**（唯一入口；endpoint 不得自行拼装）。
 *
 * 协议（§6/§10/§11/§15）：
 *   1. 读**一次** pointer ⇒ 得到 `pinned run_id`（后续全程只用它，⛔ 不重读 pointer）；
 *   2. 所有 run-bound 读取绑定该 run_id；
 *   3. pointer 缺失 ⇒ `NO_ACTIVE_POINTER` ⇒ fail-closed；
 *   4. pointer 指向的 run 不存在 ⇒ `POINTER_TARGET_RUN_NOT_FOUND` ⇒ fail-closed；
 *   5. run 数据不完整（缺 ETF / 缺 portfolio）⇒ `RUN_DATA_INCOMPLETE` ⇒ fail-closed；
 *   6. coherence 不通过 ⇒ `READ_COHERENCE_FAILURE` ⇒ fail-closed。
 *
 * @param {object} store 发布存储适配器（cloudbase 或 memory；接口一致）
 * @param {object} opts  { scope, expected_codes, require_portfolio }
 */
async function readAuthoritativeDataset(store, opts) {
  const o = opts || {};
  const scope = o.scope || CONTRACTS.POINTER_SCOPE_PRODUCTION;
  const codes = (o.expected_codes || []).map(String);
  const requirePortfolio = o.require_portfolio !== false;

  // ---- 1) 只读一次 pointer（pin）----
  let ptr;
  try {
    ptr = await resolveActivePointer(store, scope);
  } catch (e) {
    return authoritativeUnavailable(scope, AUTH_READ_REASON.READ_ERROR, 'pointer_read_failed:' + msg(e));
  }
  if (!ptr.resolved) {
    return authoritativeUnavailable(scope, AUTH_READ_REASON.NO_ACTIVE_POINTER,
      'active_run_pointer 缺失 ⇒ fail-closed（⛔ 不得回退最新文档）');
  }

  const pinnedRunId = ptr.run_id;   // ★ 单请求内全程不变

  // ---- 2) 全部读取绑定 pinned run_id ----
  let decisions = [];
  let portfolio = null;
  let manifest = null;
  try {
    decisions = await store.listCandidates(CONTRACTS.V365_COLLECTIONS.CANDIDATE_DECISION, pinnedRunId);
    portfolio = await store.getCandidate(CONTRACTS.V365_COLLECTIONS.CANDIDATE_PORTFOLIO, pinnedRunId, 'portfolio');
    manifest = await store.getManifest(pinnedRunId);
  } catch (e) {
    return authoritativeUnavailable(scope, AUTH_READ_REASON.READ_ERROR, 'run_read_failed:' + msg(e), {
      active_run_id: pinnedRunId, run_id: pinnedRunId, active_revision: ptr.revision
    });
  }

  const base = {
    active_run_id: pinnedRunId,
    run_id: pinnedRunId,
    active_revision: ptr.revision,
    revision: ptr.revision,
    expected_trade_date: ptr.expected_trade_date != null
      ? ptr.expected_trade_date
      : (manifest && manifest.expected_trade_date != null ? manifest.expected_trade_date : null)
  };

  // ---- 3) pointer 指向的 run 必须真实存在 ----
  const runExists = !!manifest || (Array.isArray(decisions) && decisions.length > 0) || !!portfolio;
  if (!runExists) {
    return authoritativeUnavailable(scope, AUTH_READ_REASON.POINTER_TARGET_RUN_NOT_FOUND,
      `pointer 指向 run_id=${pinnedRunId}，但该 run 的 manifest/candidate 均不存在`, base);
  }

  // ---- 4) coherence guard（先于"完整性"，避免把跨 run 数据当完整数据）----
  const coherence = checkRunCoherence({
    active_run_id: pinnedRunId, decisions: decisions || [], portfolio, manifest
  });
  if (!coherence.ok) {
    return authoritativeUnavailable(scope, AUTH_READ_REASON.RUN_ID_MISMATCH,
      'run-bound 记录 run_id 不一致 ⇒ 拒绝拼装', Object.assign({ coherence }, base));
  }

  // ---- 5) 完整性（声明的 expected_codes 必须齐全 + portfolio 必须有）----
  const decisionMap = {};
  (decisions || []).forEach((d) => { if (d && d.code != null) decisionMap[String(d.code)] = d; });
  const missingCodes = codes.filter((c) => !(c in decisionMap));
  const portfolioMissing = requirePortfolio && !portfolio;
  if (missingCodes.length || portfolioMissing) {
    return authoritativeUnavailable(scope, AUTH_READ_REASON.RUN_DATA_INCOMPLETE,
      `missing_codes=${JSON.stringify(missingCodes)} portfolio_present=${!!portfolio}`,
      Object.assign({ coherence, missing_codes: missingCodes, portfolio_present: !!portfolio }, base));
  }

  return Object.assign({
    available: true,
    status: AUTH_READ_STATUS.OK,
    scope,
    decisions: decisions || [],
    decision_map: decisionMap,
    decision_count: (decisions || []).length,
    portfolio,
    run_status: manifest,
    complete: true,
    reason: null,
    detail: null,
    coherence,
    fail_closed: false,
    latest_fallback_used: false,
    // ⛔ 显式声明：本次读取**没有**用任何 latest 查询决定权威结果
    authority_selector: 'active_run_pointer.run_id',
    pinned_once: true
  }, base);
}

/**
 * 只读单个 code 的 authoritative decision（薄封装；仍走同一 pinning 协议）。
 * @returns {{decision:object|null, active_run_id:string|null, available:boolean, reason:string|null}}
 */
async function readActiveDecision(store, opts) {
  const o = opts || {};
  const code = String(o.code);
  const codes = o.expected_codes ? o.expected_codes.map(String) : [code];
  const ds = await readAuthoritativeDataset(store, { scope: o.scope, expected_codes: codes, require_portfolio: false });
  return {
    decision: ds.available ? (ds.decision_map[code] || null) : null,
    active_run_id: ds.active_run_id,
    active_revision: ds.active_revision,
    expected_trade_date: ds.expected_trade_date,
    available: ds.available,
    status: ds.status,
    reason: ds.reason,
    coherence: ds.coherence || null,
    latest_fallback_used: false
  };
}

/**
 * 构造 **additive** response provenance（§8）。
 * ⛔ 不改变任何既有业务字段语义；宿主把本对象**新增**到 response 即可。
 */
function buildAuthoritativeProvenance(ds) {
  const d = ds || {};
  const manifest = d.run_status || null;
  return {
    status: d.status || AUTH_READ_STATUS.AUTHORITATIVE_READ_UNAVAILABLE,
    available: d.available === true,
    reason: d.reason || null,
    // decision 轴
    active_run_id: d.active_run_id != null ? d.active_run_id : null,
    active_revision: d.active_revision != null ? d.active_revision : null,
    expected_trade_date: d.expected_trade_date != null ? d.expected_trade_date : null,
    engine_version: manifest && manifest.engine_version != null ? manifest.engine_version : null,
    input_hash: manifest && manifest.input_hash != null ? manifest.input_hash : null,
    finality_status: manifest && manifest.status != null ? manifest.status : null,
    // 轴标注（⛔ 两条轴不得混成一句）
    decision_as_of_run_id: d.active_run_id != null ? d.active_run_id : null,
    decision_axis_selector: 'active_run_pointer.run_id',
    authority_selector: 'active_run_pointer.run_id',
    latest_fallback_used: false
  };
}

/**
 * 构造 **mutable state 轴** 的 provenance（§8/§12）。
 * `portfolio_position` 等是「持续变化的现实状态」，⛔ 不是某个 run 的不可变产物。
 */
function buildMutableStateProvenance(input) {
  const i = input || {};
  const rows = Array.isArray(i.rows) ? i.rows : [];
  let latest = null;
  rows.forEach((r) => {
    const t = r && r.updated_at != null ? String(r.updated_at) : null;
    if (t && (latest == null || t > latest)) latest = t;
  });
  return {
    position_as_of_current_state: true,
    position_updated_at: i.position_updated_at != null ? i.position_updated_at : latest,
    position_source: i.position_source || 'portfolio_position(current mutable state)',
    mutable_axis_note: '本轴由用户/成交回写维护，与 decision run 不是同一时间轴；⛔ 不得表述为"单 run 快照"'
  };
}

function msg(e) { return String((e && e.message) || e || ''); }

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
  AUTH_READ_STATUS,
  AUTH_READ_REASON,
  READER_CLASS,
  ALLOWED_LATEST_READS,
  FORBIDDEN_READ_PATTERNS,
  scanForbiddenReads,
  scanForbiddenReadsDetailed,
  ALLOW_MARKER_RE,
  resolveActivePointer,
  readActiveRunDataset,
  // ---- Reader Migration 正式 API ----
  checkRunCoherence,
  readAuthoritativeDataset,
  readActiveDecision,
  buildAuthoritativeProvenance,
  buildMutableStateProvenance,
  planCompatibilityProjection,
  // ---- RH4：CLASS C 双源读取（OD-4 §4.5）----
  CLASS_C_COVERAGE,
  CLASS_C_READ_POINTS,
  V365_ENFORCE_SWITCH_DATE,
  buildClassCProvenance,
  auditClassCReadPoints
};
