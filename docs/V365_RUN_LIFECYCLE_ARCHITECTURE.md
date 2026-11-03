# V365 Run Lifecycle Architecture

> **性质**：架构设计文档（design-only）。⛔ 本轮**未改任何代码 / schema / collection**，未 deploy，未 commit。
> **生成**：2026-09-24（GMT+8）｜接手方 = 本机 WorkBuddy 国际版
> **前置**：`WP-V365-RH1 Discovery`（只读审计）已完成；本文是其架构级收口。
> **基线**：HEAD `c6bd006fd76ffc5358cddd07347df8ed23d9e61d`（分支 `feat/v365-production-integrity-impl`，未 push）
>
> **证据规则**：本文每条论断均标注 `file:line`。凡属**设计提议**（尚未存在于代码）者，一律标 `[DESIGN]`；
> 凡属**当前实测事实**者，标 `[AS-IS]`。⛔ 不得把 `[DESIGN]` 读成已实现。

---

## 0. 结论摘要（先读这段）

V3.6.5 已完成的部分是**真实且可验证的**：Writer CAS 机制 `QUALIFIED`、Reader Migration `COMPLETE`
（`v365-reader-migration-gate` 8/8）、Finality `COMPLETE`、Qualification Gate `PASS 38/38`、Parity `Δ=0`。

**但 RH1 Discovery 揭示：缺口不是"少一张 run_history 表"，而是缺一套 Run Lifecycle Model。**
具体地 —— 当前系统**只实现了 lifecycle 的"读侧一半"**：

| 环节 | 机制 | 生产是否接线 |
|---|---|---|
| candidate 写入 | `putCandidate` | ✅ 已接线（`runDecisionEngine/index.js:542/553`） |
| **manifest 写入** | `putManifest` | ❌ **未接线**（`cloudfunctions/` 零调用） |
| **pointer 提升** | `compareAndSetPointer` | ❌ **未接线**（`cloudfunctions/` 零调用） |
| authoritative 读取 | `readAuthoritativeDataset` | ✅ 已接线（5 端点 + admin health） |
| 历史读取 | 仍扫 `decision_result` | ⚠️ 且该集合在 ENFORCE 下**停写** |

⇒ **ENFORCE（缺省值）一旦上线**：authoritative 读全部 `NO_ACTIVE_POINTER` fail-closed；
CLASS C 历史读**静默冻结在切换日**。这不是索引缺失，是**生命周期未闭环**。

**根因（可复现）**：`cloudfunctions/runDecisionEngine/index.js` 中**仍有 5 处**按"CAS 未实证"的**旧裁定**书写
（`:1317` / `:1526` 注释；`:1511` / `:1552` / `:1557` 运行时字段）——
该 blocker 在 Q7 重裁后已于 `docs/V365_PRODUCTION_INTEGRITY_READINESS.md:1522` 标为 **CLOSED**，
`publishPromotionAllowed()` 探针实测返回 **`true`**，但**提升接线从未补上**。
⇒ 属**失效 blocker 描述遗留**，与 `docs/V365_PLATFORM_CAS_EVIDENCE.md` 的结论冲突。

⚠️ 其中 `:1555-1557` 已产出**自相矛盾的响应**：同一响应对象内
`promotion_allowed: true` 与 `promotion_skipped_reason: 'ATOMIC_PROMOTION_BLOCKED:platform_cas_unverified'` **并存**
（前者实算、后者硬编码）。详见 §5.3.1。

---

## 1. Current State Model

### 1.1 三层结构 `[AS-IS]`

```
┌─ candidate layer ──────────────────────────────────────────────┐
│  run_candidate_decision     逐票候选（run 隔离，带 run_id）      │
│  run_candidate_portfolio    组合候选（run 隔离，带 run_id）      │
│  run_manifest               run 目录（设计存在，⛔ 生产无写入方） │
│  —— 集合名：v365-contracts.js:49-54                             │
└────────────────────────────────────────────────────────────────┘
                              │  必须经单指针 CAS 才可见
                              ▼
┌─ promotion layer ──────────────────────────────────────────────┐
│  active_run_pointer   { scope, run_id, revision,                │
│                         expected_trade_date,                    │
│                         promoted_from_run_id }                  │
│  —— 确定性 _id = `active_run_pointer::production`                │
│     （v365-publish-store.js:61-63）                             │
│  —— 条件更新原语：where({_id, scope, run_id: expected,          │
│     revision: expected}).update()  ⇒ 单文档 CAS                  │
│     （v365-publish-store.js:273-330）                           │
│  —— ⛔ 生产无提升调用（GAP-3）                                    │
└────────────────────────────────────────────────────────────────┘
                              │  pin 一次 run_id，全程不变
                              ▼
┌─ reader layer ─────────────────────────────────────────────────┐
│  readAuthoritativeDataset(store, { expected_codes })            │
│    （src/common/utils/v365-active-read.js:240-331）             │
│  1) resolveActivePointer → 2) listCandidates(run_id)            │
│  3) run 存在性 → 4) coherence guard → 5) 完整性                 │
│  ⇒ 返回 { active_run_id, active_revision, decisions,            │
│           portfolio, coherence, latest_fallback_used:false,     │
│           authority_selector:'active_run_pointer.run_id',       │
│           pinned_once:true }                                    │
│  —— 消费侧分类：v365-active-read.js:88-92（CLASS A/B/C）         │
└────────────────────────────────────────────────────────────────┘
```

### 1.2 两条轴的显式区隔 `[AS-IS]`

| 轴 | selector | 集合 | 语义 |
|---|---|---|---|
| **run 轴**（不可变产物） | `active_run_pointer.run_id` | `run_candidate_decision` / `run_candidate_portfolio` | 某次 run 算出来的结果 |
| **mutable 轴**（持续变化） | 自身 `updated_at` | `portfolio_position` / `portfolio_snapshot(资产字段)` / `indicator_snapshot` / `etf_daily` / `trade_log` | 现实状态与输入 |

来源：`v365-active-read.js:79-85`（`ALLOWED_LATEST_READS`）。
⛔ 两条轴**不得合并**（`docs/V365_AUTHORITATIVE_CONSUMER_MAP.md` §E.2 已定为**设计错误**而非实现疏漏）。

### 1.3 ★ `current state ≠ history`（本节的核心命题）

当前**全部** 7 个集合都只能回答"**现在是什么**"，**没有一个**能回答"**曾经有什么**"：

| 集合 | 基数 | 回答的问题 | 能否承载历史 |
|---|---|---|---|
| `active_run_pointer` | **1 行 / scope** | 现在读哪个 run | ❌ 覆盖写，`promoted_from_run_id` 只留**上一次** |
| `runtime_status` | **1 行**（`uk_key`） | 当前运行状态（31 字段） | ❌ 每轮覆盖 |
| `gen1_health_state` | **1 行**（`uk_key`） | 当前持久化 latch | ❌ 覆盖 |
| `decision_result` | N 行，键 = `code+decision_date` | 每票的最新决策 | ⚠️ 形似历史，但**无 run 身份**、且 ENFORCE 下**停写** |
| `portfolio_snapshot` | N 行，键 = `snapshot_date` | 每日快照 | ⚠️ 同上，**无 run 身份** |
| `run_candidate_decision` | N 行，键含 `run_id` | 某 run 的候选 | ⚠️ 有 run 身份，但**无目录**⇒ 无法按日期枚举 |
| `run_manifest` | 0 行（无写入方） | — | ❌ **空表** |

**⇒ 命题成立**：`current state ≠ history`。
- `active_run_pointer` / `runtime_status` 是 **state**（单例、覆盖）—— 结构上不可能有历史。
- `decision_result` / `portfolio_snapshot` 是 **snapshot**（按日期、无 run 身份）—— 不是 audit trail。
- `run_candidate_*` 是 **run 产物**（有 run 身份）—— 但缺目录，无法枚举。

**三个概念必须分开命名与分开存储**（详见 §3）：
`authoritative state`（指针）· `history index`（目录）· `audit trail`（事件）。

---

## 2. Run Lifecycle State Machine `[DESIGN]`

> ⚠️ 本节的**状态名与迁移**是设计提议。`[AS-IS]` 标记处为当前代码已存在的机制。

```
Run Created ──▶ Run Calculating ──▶ Run Finalized
                                        │
                        ┌───────────────┴───────────────┐
                        │ COMPLETE                      │ PARTIAL / FAILED
                        ▼                               ▼
              Run Candidate Available            Run Rejected
                        │                        （候选保留，永不提升）
                        ▼
                   Run Promoted ──▶ Run Superseded ──▶ Run Archived
                        │              （同日更高 revision）
                        └──────────────────┘
```

| # | 状态 | 谁产生 | 谁写入 | 是否可修改 | 需要历史记录？ |
|---|---|---|---|---|---|
| S1 | **Run Created** | RDE 初始化：`v365EngineRunIdBase` 生成（`runDecisionEngine/index.js:528-529`，日期 + 单调批次 `:b<startedAt>`，⛔ 不以 wall-clock 为唯一身份） | 仅内存 | — | ❌ 否（身份本身进 S4 后随目录落盘） |
| S2 | **Run Calculating** | RDE 主流程（`:597-1127`） | 仅内存 | — | ❌ 否 |
| S3 | **Run Finalized** | `computeFinality()`（`:1133`）⇒ `RUN_STATUS ∈ {COMPLETE, PARTIAL, FAILED}`（`v361-run-finality.js:20-24`）；另有 `RUN_GATE ∈ {PASS, BLOCKED}`（`v365-run-integrity.js:34-37`） | 仅内存 | ⛔ 不可（终局是判据，不是状态） | ⚠️ **是** —— 终局 + 原因码必须可事后审计 |
| S4 | **Run Candidate Available** | `putCandidate`（`:542` decision / `:553` portfolio） | `run_candidate_decision` / `run_candidate_portfolio`（写入即盖章 `run_id` + `candidate_key` + `written_at`，`v365-publish-store.js:237-242`） | ⛔ 追加后不可变（重算 ⇒ 新 run_id） | ✅ **是** —— 这是"某 run 算出了什么"的唯一真相源 |
| S5 | **Run Promoted** | `compareAndSetPointer`（`v365-publish-store.js:273-330`）成功后 | `active_run_pointer`（**覆盖写**） | ⛔ 不修改历史指针值（CAS 只推进 revision） | ✅ **是，且当前完全缺失**（GAP-7）—— 覆盖即丢 |
| S6 | **Run Superseded** | 同交易日更高 `revision` 提升时（`v365-atomic-publish.js:209-211`：`supersedes_run_id` / `same_trade_date_supersede`） | 设计上应落目录；**当前只存在于指针的当前值** | ⛔ 一旦 supersede 不可逆 | ✅ **是**（替代链是审计要求 R4） |
| S7 | **Run Archived** | `[DESIGN]` 保留窗口策略 | 无（**当前无此机制**） | ⛔ 归档只降活跃度，不删数据 | ✅ 是（归档事件本身要留痕） |

**关键观察**：
- S1–S3 **完全在内存中**，进程结束即消失（`runtime_status` 只保留**当轮**遥测）。
- S4 **有持久化**但**不可枚举**（无目录）。
- S5/S6/S7 **无持久化历史** —— 指针的当前值不构成时间线。
- ⇒ **状态机在 S4 与 S5 之间断链**：candidate 落盘了，但没有"这个 run 存在过"的登记。

---

## 3. Pointer vs Timeline Boundary

### 3.1 职责划分（不可越界）

| | `active_run_pointer` | `run_history`（`[DESIGN]`） |
|---|---|---|
| 回答 | **"现在读哪个 run"** | **"历史上有哪些 run"** |
| 基数 | **1 行 / scope** | **N 行**（append-only） |
| 可写 | CAS **条件更新**（覆盖） | **只追加**，⛔ 不更新历史行 |
| 权威性 | **权威** —— 决定读什么 | **非权威** —— 只回答"有哪些" |
| 缺失语义 | `NO_ACTIVE_POINTER` ⇒ **fail-closed** | 该日 **UNKNOWN**（RH-3） |
| 谁依赖 | 5 authoritative 端点 + `getGen1Health` | `getDecisions` / `getReview` / `cooldown` / shadow readers |
| 现有实现 | `v365-publish-store.js:61-63`（`pointerDocId`）· `:273-330`（CAS） | ❌ **不存在** |

### 3.2 两条禁令（必须写进代码注释与门禁）

**禁令 A：⛔ 不得用 history 推断 active。**
- 反例：`SELECT * FROM run_history ORDER BY created_at DESC LIMIT 1` 当作当前权威 run。
- 为什么错：`run_history` 可能**滞后写入**（异步/批量），且**同日可能有多条**（多 revision）——
  "最新创建"≠"已被提升"。这正是 Reader Migration 明令禁止的
  `orderBy(updated_at|decision_date|snapshot_date desc).limit(1)` 猜权威结果的变体
  （`docs/V365_READER_MIGRATION.md` §2；`v365-active-read.js` `FORBIDDEN_READ_PATTERNS`）。
- ⇒ **"当前是谁"必须且只能由 `active_run_pointer` 回答。**

**禁令 B：⛔ 不得用 pointer 充当 timeline。**
- 反例：靠 `active_run_pointer.promoted_from_run_id` 还原历史链。
- 为什么错：指针只有 **1 行**，`promoted_from_run_id` 只保留**上一次**；
  第三次提升即丢失第一次的信息 —— **链长被结构性地截断为 2**。
- ⇒ 这正是 `RUN_HISTORY_INDEX_REQUIREMENTS` 已明文禁止的用法
  （`docs/V365_READER_MIGRATION.md` §4.1 末行：「⛔ 本轮禁止用 `active_run_pointer` 临时替代历史索引」）。

### 3.3 唯一合法耦合（单向）

```
promotion 成功（CAS PROMOTED）
        │
        ├──▶ 更新 active_run_pointer            （state，覆盖）
        └──▶ 追加 run_history 一行 promotion 事件（timeline，只追加）   [DESIGN]
```
- 方向**单向**：写侧同时更新两者；**读侧互不依赖**（state 读者不看 history，history 读者不看 state）。
- ⛔ 不得让 pointer 的写入依赖 history 的写入成功（否则 history 故障会阻塞权威读）。

---

## 4. Run History Data Model Proposal（只设计，不实现）

> 需求来源：`docs/V365_READER_MIGRATION.md` §4.1 `RUN_HISTORY_INDEX_REQUIREMENTS`
> —— RH-1（run 目录 + supersede 链）· RH-2（run → 数据集反向索引）· RH-3（历史读仍 fail-closed）。

### 4.1 方案对比

| | **方案 A：单表 `run_history`** | **方案 B：`run_history` + `promotion_event`** | **方案 C：复用 Gen-2 run model** |
|---|---|---|---|
| 形态 | 一行一 run；supersede 用自引用字段 | 目录表 + 独立事件表（append-only） | 对齐 `gen2_shadow` / `integrated_shadow_*` 形态 |
| RH-1 覆盖 | ✅ 单查询枚举区间 | ✅ 但需 join | ✅ |
| RH-2 覆盖 | ✅ `decision_count` + `expected_codes` + `portfolio_present` | ✅ | ✅ |
| supersede 链 | ⚠️ 自引用字段需**应用层**维护双向一致 | ✅ 事件天然不可变、天然保序 | ⚠️ 同 A |
| 写入次数 / promotion | 1 次 upsert（含幂等） | 2 次（目录 + 事件） | 1–2 次 |
| 集合数增量 | **+1** | +2 | +1（+ 明细集合则 +2） |
| 与 `run_candidate_*` 重复 | 无（只存摘要） | 无 | ⚠️ 方案 C 若存明细 ⇒ **与 candidate 重复存储** |
| 全仓一致性 | 与 Gen-2 不同构 | 与 Gen-2 不同构 | ✅ 与 Gen-2 **同构**（`uk_run_id` 形态） |
| 主要风险 | 自引用链的一致性靠约定 | 事件与目录可能不一致（需同事务/顺序保证） | 明细重复；且 Gen-2 的 run 语义与 V365 **不同域**（§7） |

### 4.2 取舍分析

- **方案 A**：最少的移动部件。supersede 链是**低频**操作（同日多 revision），用两个自引用字段
  （`supersedes_run_id` / `superseded_by_run_id`）即可满足 RH-1 的"枚举 + 链"要求。
  代价是链一致性需要写侧保证（同一行内更新 ⇒ 单文档原子，天然满足）。
- **方案 B**：审计语义最干净（事件不可变、可追加 `PROMOTE` / `SUPERSEDE` / `ARCHIVE` 多种类型），
  且天然支持"同一 run 多次提升"（例如回滚后再提升）。代价是**两个集合 + 两次写**，
  而 V3.6.5 的平台事实是**无跨文档事务**（`docs/V365_AUTHORITATIVE_CONSUMER_MAP.md` §D 前提事实；
  `CAS_EVIDENCE.transaction_command_available = false`）⇒ 目录与事件**无法原子同写**，
  必须设计成"事件为准、目录为投影"，否则会引入新的不一致面。
- **方案 C**：唯一优点是**与 Gen-2 同构**。但 Gen-2 的 run 是**影子观察 run**，
  与 V365 的 **authoritative run** 属**不同 authority 域**（§7 明令不得合并）；
  且其明细形态会与 `run_candidate_*` **重复存储**。⛔ **不建议**。

### 4.3 倾向（技术判断，非裁定）

**倾向方案 A**，理由三条：
1. RH-2 只要求"**是否存在/数量**"（布尔 + 计数），**不需要明细** —— 明细已在 `run_candidate_*`；
   方案 C 的重复存储无收益。
2. 单表 + 自引用 = **单文档原子**，与 V3.6.5 已实证的平台能力（单文档条件 CAS，
   `CAS_EVIDENCE.platform_single_document_cas_verified = true`）**同构**，不引入跨文档一致性面。
3. 方案 B 的审计优点在**当前需求下不兑现**（RH-1/RH-2 都不要求事件分类），
   而它的跨文档风险是**立刻兑现**的。

⛔ 但**这是技术参数，最终裁定权在 owner**（见 §9 OD-1 / OD-2）。

### 4.4 候选字段（方案 A）`[DESIGN]`

```
run_history（一行一 run，append-only）
  run_id               string   ← engine_run_id（candidate 身份，S1 生成）
  scope                string   ← 'production'（与 pointer 同 scope 语义）
  expected_trade_date  string   ← ★ 时间轴主键（RH-1 的检索键）
  revision             number   ← 单调（NON_MONOTONIC_REVISION 拒因见 CAS_REASON）
  status               string   ← COMPLETE / PARTIAL / FAILED（S3 终局）
  engine_version       string   ← CONTRACTS.ENGINE_VERSION
  input_hash           string   ← 输入契约哈希（可复算性锚点）
  expected_codes       array    ← 声明的 5 只（⛔ 不是"实际写成功条数"）
  decision_count       number   ← RH-2：该 run 实际写入的候选数
  portfolio_present    boolean  ← RH-2
  supersedes_run_id    string|null   ← 同日替代（R4）
  superseded_by_run_id string|null   ← 反向指针
  promoted_at          string|null   ← ★ 提升**事件**时刻（⛔ 不是 is_active 布尔）
  promoted_from_run_id string|null
  created_at           string

索引：uk_run_id(run_id, unique) · idx_trade_date(expected_trade_date desc) · idx_supersedes(supersedes_run_id)
```

⚠️ **`promoted_at` 是事件时间，不是状态** —— "当前是否 active"**只能**由 pointer 回答（§3 禁令 A）。

---

## 5. Writer Lifecycle Integration

### 5.1 当前实际接线 `[AS-IS]`

`cloudfunctions/runDecisionEngine/index.js`：

```
:522   const v365Mode = merged.v365_integrity_mode === 'LEGACY' ? 'LEGACY' : 'ENFORCE';
       // ⚠️ 注释原文：'LEGACY' 仅用于对照回放，不作为生产取值 ⇒ 缺省即 ENFORCE

:526   v365EngineRunIdBase = <pipeline_run_id>::engine:<北京日期>:b<startedAt>     ← S1
:597   RunContext required-input gate                                             ← S2
:637   if (ENFORCE && gate === BLOCKED) → 提前返回（fail-closed）
:1133  v365Finality = computeFinality({...})                                      ← S3
:1318  v365PortfolioPublish = COMPLETE ? await v365WritePortfolio(...) : skipped
:540   v365WriteDecision:  LEGACY → db.upsert(COLLECTIONS.DECISION_RESULT, …)
                           ENFORCE → v365Store.putCandidate(CANDIDATE_DECISION, …)  ← S4
:551   v365WritePortfolio: LEGACY → db.upsert(COLLECTIONS.PORTFOLIO_SNAPSHOT, …)
                           ENFORCE → v365Store.putCandidate(CANDIDATE_PORTFOLIO, …) ← S4
:1494  runtime_status 遥测（含 4 个 v365_* 只读字段）
:1517  return {…}
```

### 5.2 缺失的三件事 `[AS-IS]`

| 缺失项 | 应调用的既有原语 | 证据 |
|---|---|---|
| **manifest 写入** | `store.putManifest(manifest)`（`v365-publish-store.js:227-233`，**已存在**） | `cloudfunctions/` 零调用 |
| **pointer 提升** | `store.compareAndSetPointer(scope, expected, next)`（`:273-330`，**已存在**） | `cloudfunctions/` 零调用 |
| **history 追加** | `[DESIGN]` 尚不存在 | — |

> 完整编排函数**已写好但未接线**：`publishCandidateFirst()`（`src/common/utils/v365-run-integrity.js:131-…`，
> 内部依次 `putManifest` → `putCandidate` ×N → 回读 → 分类 → 校验 → CAS 提升），
> 且 `v365-run-integrity.js:378` 已导出。**它只被测试驱动，未被任何云函数调用。**

### 5.3 根因：失效的 blocker 描述（**5 处**，含运行时响应）`[AS-IS]`

`cloudfunctions/runDecisionEngine/index.js` 中仍按「CAS 未实证」的**旧裁定**书写的**全部 5 处**：

| # | 行 | 形态 | 内容 |
|---|---|---|---|
| 1 | `:1317` | 注释 | `平台级 CAS 并发证据尚未取得（§10）⇒ 本轮结构性 ATOMIC_PROMOTION_BLOCKED` |
| 2 | `:1511` | **运行时字段** | `v365_authoritative_published: v365Mode !== 'ENFORCE'`（按**模式**声明已发布，⛔ 未查指针是否真的提升） |
| 3 | `:1526` | 注释 | `单指针 CAS 提升需平台级并发实证（§10），当前 ATOMIC_PROMOTION_BLOCKED` |
| 4 | `:1552` | **运行时字段** | `authoritative_published: v365Mode !== 'ENFORCE'`（同上） |
| 5 | `:1555-1557` | **运行时字段** | `promotion_allowed: runIntegrity.promotionAllowed()`<br>`promotion_skipped_reason: v365Mode === 'ENFORCE' ? 'ATOMIC_PROMOTION_BLOCKED:platform_cas_unverified' : null` |

**对照事实（实测）**：

| 项 | 值 | 出处 |
|---|---|---|
| `ATOMIC_PROMOTION_BLOCKED` 处置 | **CLOSED** | `docs/V365_PRODUCTION_INTEGRITY_READINESS.md:1522` |
| §21.7 的 `Q7_PLATFORM_CAS = BLOCKED` | 已被追加节取代 | 同上 `:1420` |
| `CAS_EVIDENCE.platform_single_document_cas_verified` | **`true`** | `v365-contracts.js:86`（探针实测） |
| `CAS_EVIDENCE.implementation_uses_single_document_cas` | **`true`** | `v365-contracts.js:94`（探针实测） |
| `publishPromotionAllowed()` | **`true`** | `v365-contracts.js:105-108`（探针实测） |
| `publishStore.promotionAllowed()` | **`true`** | `v365-publish-store.js:188-191`（探针实测） |

⇒ **blocker 已关闭，接线未补**。这是「失效 blocker 描述遗留」的直接后果，**不是**设计取舍。

#### ★ 5.3.1 由 #5 产生的**自相矛盾响应**（需优先处置）

同一响应对象内同时存在：

```js
promotion_allowed:          true                                    // ← 由 CAS_EVIDENCE 实算
promotion_skipped_reason:  'ATOMIC_PROMOTION_BLOCKED:platform_cas_unverified'  // ← 硬编码字符串
```

即**响应同时声称"允许提升"与"因平台 CAS 未实证而跳过"**。该字符串是**硬编码字面量**，
**不随 `CAS_EVIDENCE` 变化** ⇒ Q7 重裁后必然失真。

⚠️ 附带的**语义风险**：`authoritative_published: v365Mode !== 'ENFORCE'`（#2 / #4）
按**模式**推断"已发布"，而**实际是否发布取决于指针是否被提升**（当前从不提升）。
⇒ ENFORCE 下该字段恒为 `false`（正确），但**推理链是错的** ——
一旦接线补上，该字段会**在指针提升失败时仍可能报错值**。正确写法应查询指针实况。

> ⛔ 本轮**不修改**以上任何一处（设计文档阶段）。处置建议见 §8 RH2 ③ 与 §9 OD-9。

### 5.4 未来接线位置（提议，⛔ 本轮不修改）

| 位置 | 提议动作 | 备注 |
|---|---|---|
| `runDecisionEngine/index.js` S4 之后、`:1517 return` 之前 | `[DESIGN]` 调用 `publishCandidateFirst({ store, scope, manifest, decisions, portfolio, expected_codes })` | ⚠️ 该文件**在 20 文件合格面内** ⇒ 需重新资格化 |
| `runDecisionEngine/index.js:1317` / `:1526` | `[DESIGN]` **修正失效注释**（blocker 已 CLOSED） | 纯注释，但同文件 ⇒ 同批资格化 |
| `runDecisionEngine/index.js:1511` / `:1552` / `:1557` | `[DESIGN]` **修正运行时字段**：`authoritative_published` 应查**指针实况**而非模式；`promotion_skipped_reason` 应由 `CAS_EVIDENCE` **派生**而非硬编码 | ⚠️ **响应契约变更** ⇒ 需 backward-compat 评审（§5.3.1） |
| `runDecisionEngine/index.js:1494-1511` | `[DESIGN]` 在 `runtime_status` 增加 `active_run_id` / `active_revision` 回显 | ⛔ 只读字段，不参与决策 |
| promotion 成功后 | `[DESIGN]` 追加 `run_history` 一行 | 与 pointer 更新同批；⛔ 失败不得回滚 pointer（§3.3 单向） |
| `runDecisionEngine/index.js:540/551` | `[DESIGN]` **待裁定**：ENFORCE 下是否**保留** `decision_result` / `portfolio_snapshot` 双写 | 见 §9 OD-4 |

---

## 6. Reader Migration Impact

### 6.1 CLASS A（CURRENT_AUTHORITATIVE）—— ✅ 已完成

| 端点 | 状态 |
|---|---|
| `apiGateway.getDashboard` / `getEtfList` / `getEtfDetail` / `getPortfolio` / `getConstants` | ✅ 已接 resolver |
| `adminGateway.getGen1Health` | ✅ 已接 resolver |
| 门禁 | `v365-reader-migration-gate` **8/8 PASS** · `v365-reader-migration.test.js` **19 passed** |

**RH1 **不**改变 CLASS A 的任何结论** —— 两域不重叠。

### 6.2 CLASS C（HISTORICAL_RANGE）—— 未来需迁移

来源：`docs/V365_READER_MIGRATION.md` §4 + `docs/V365_AUTHORITATIVE_CONSUMER_MAP.md` §E.2 第 1 类。

| # | 消费者 | 当前查询形态 | 迁移后应改为 |
|---|---|---|---|
| 1 | `apiGateway.getDecisions`（`:667`） | `decision_result` + `decision_date desc`，limit 60/500（已标 `v365-reader-allow:history-deferred`） | `run_history` 枚举区间 → 按 `run_id` 读候选 |
| 2 | `apiGateway.getReview`（`:776` / `:784`） | `decision_result` 500 + `portfolio_snapshot` 200 | 同上；快照须**按 `run_id`** 取 |
| 3 | `cooldown.resolveLastBuyAddMode`（`cooldown.js:25`） | `{ code, decision_date: buyDate }` 精确 key | 解析"该历史日属于哪个 run" |
| 4 | `runIntegratedShadowEod.loadInputs`（`:220` / `:222`） | `decision_date == anchor` 精确 + 全表最新 | `(expected_trade_date) → run_id` 反向索引 |
| 5 | `runGen1ShadowEod.latestMarketRegime`（`:81-83`） | `portfolio_snapshot` 最新 | 低优先：标注来源 run |

### 6.3 影响面判定

| 问题 | 结论 |
|---|---|
| RH1 会破坏已完成的 RM 吗？ | **不会**。CLASS A 与 CLASS C 不重叠；RM 门禁 8/8 / 38/38 不受影响 |
| RH1 会新增需要迁移的读点吗？ | **会**：上表 5 个。⇒ `ALLOWED_LATEST_READS` 与 `v365-reader-allow:` 标记需**重新登记** |
| RH1 会改变 `latest_fallback_used` 语义吗？ | **不会**。RH-3 要求历史索引缺失时**显式 UNKNOWN**，⛔ 不得回退"当天任意最新文档" |
| ⚠️ 若选择"ENFORCE 双写 `decision_result`"（§9 OD-4） | **会改变 writer 路径** ⇒ `runDecisionEngine/index.js` 在合格面内 ⇒ **必须重新资格化** |

---

## 7. Gen1 / Gen2 Boundary

### 7.1 Gen-2 run history ≠ V365 authoritative history `[AS-IS]`

| | Gen-2 | V365 |
|---|---|---|
| run 集合 | `gen2_shadow`（`uk_type_run: type+run_id`）· `integrated_shadow_run`（`uk_run_id`）· `integrated_shadow_result`（`uk_run_code: run_id+code`） | `run_candidate_*` + `active_run_pointer` |
| run 语义 | **影子观察 run**（Gen-2 仅有 `selection_share` / `candidate_weight` 观察权限） | **authoritative run**（决定前台读到什么） |
| authority 域 | 观察 / 诊断 | 生产权威 |
| 消费端点 | `adminGateway.getGen2SelectionShadow`（`:224`） | 5 authoritative 端点 + `getGen1Health` |

**明确**：Gen-2 的 run 轴**已经存在且形态良好**（按 `run_id` 关联，⛔ 不按 code 最新拼接
—— `adminGateway/index.js:241-244` 的注释已显式禁止）。
但它是**另一个 authority 域的 run**。⇒ **⛔ 不得合并两套 run history**；
RH1 应**沿用同一形态**（`uk_run_id` + 明细按 `run_id`）以保持全仓一致，但**独立存储**。

### 7.2 Gen-1 `runtime_status` 不适合作为历史 `[AS-IS]`

| 事实 | 证据 |
|---|---|
| `runtime_status` 是**单文档** | `schema.js:613` + `uk_key(key, unique)` |
| Gen-1 anchor 全部落在其中 | `gen1_authority` / `gen1_health_*` / `gen1_guarded_*`（`schema.js:619-641`，共 27 → 31 字段） |
| 每轮**覆盖写** | `runDecisionEngine/index.js:1515` `db.upsert(RUNTIME_STATUS, runtimeStatus, { key: 'runtime-status' })` |
| ⇒ 计数器无历史 | `gen1_guarded_effective_invocations` / `gen1_guarded_shadow_invocations` / `gen1_guarded_evidence_independent_events` 只反映**当轮** |

**明确**：`runtime_status` 是 **state**，**结构上不可能**承载历史。
⛔ 不得用"定期快照 `runtime_status`"的方式伪造 Gen-1 历史 —— 那会产生**采样间隔内的空洞**，
且无法区分"没发生"与"没采样"。Gen-1 历史若需要，必须**独立立项**（§8 RH4），
以**事件**（而非快照）为最小粒度。

---

## 8. Migration Plan（分阶段，⛔ 仅规划）

> ⚠️ "qualification impact" 指是否触碰 `ml/manifests/V365_CANDIDATE_MANIFEST.json` 的
> **20 个合格文件**（其 `file_sha256` 覆盖 20 项，`docs/` 与 `scripts/` **不在其中**）。
> 触碰 ⇒ `candidate_content_sha` 变化 ⇒ **必须重新资格化**。

### RH0 — Architecture（本文件）

| 项 | 内容 |
|---|---|
| 修改范围 | **仅新增** `docs/V365_RUN_LIFECYCLE_ARCHITECTURE.md`（`docs/` 不在合格面） |
| qualification impact | **无**（`candidate_content_sha` 不变） |
| 风险 | 无代码风险；风险在于**设计结论被误读为已实现** ⇒ 本文已用 `[AS-IS]` / `[DESIGN]` 标记强制区分 |

### RH1 — Registry（run 目录）

| 项 | 内容 |
|---|---|
| 修改范围 | ① 新增 `run_history` 集合；② 登记进 `src/common/constants.js` + `src/common/schema.js`；③ 写侧接线（`putManifest` + `run_history` 追加） |
| qualification impact | ⚠️ **有** —— `constants.js` / `schema.js` **不在** 20 文件内，但 `runDecisionEngine/index.js` **在** ⇒ 一旦接线即需重新资格化 |
| 风险 | ① `init-collections.js` 由 `SCHEMAS` 驱动（`init-collections.js:75-76`）⇒ **必须先登记才会建表**，否则又是空表；② `schema-collections-parity.test.js` 要求 `constants ↔ SCHEMAS` 一一对应 ⇒ 登记必须**两侧同时**；③ 生产建表需**单独授权**（DB 变更） |

### RH2 — Promotion History（提升事件 / supersede 链）

| 项 | 内容 |
|---|---|
| 修改范围 | ① `compareAndSetPointer` 成功后追加历史；② 补 `supersedes_run_id` / `superseded_by_run_id`；③ 修正 `runDecisionEngine/index.js` 的 **5 处**失效残留（`:1317` / `:1526` 注释 + `:1511` / `:1552` / `:1557` 运行时字段，含 §5.3.1 的自相矛盾响应） |
| qualification impact | ⚠️ **有** —— `v365-publish-store.js` / `v365-atomic-publish.js` / `runDecisionEngine/index.js` **均在** 20 文件内 |
| 风险 | ① ⛔ **无跨文档事务**（`CAS_EVIDENCE.transaction_command_available = false`）⇒ pointer 更新与 history 追加**不能原子**；必须定序（pointer 先、history 后）并接受"history 可能滞后"；② ⛔ history 写入失败**不得**回滚 pointer（否则权威读被审计面拖死）；③ 同日多 revision 的 supersede 链需**幂等**（重试不产生重复行） |

### RH3 — Historical Readers（CLASS C 迁移）

| 项 | 内容 |
|---|---|
| 修改范围 | `apiGateway`（getDecisions / getReview）· `cooldown.js` · `runIntegratedShadowEod` · `runGen1ShadowEod`；并重新登记 `ALLOWED_LATEST_READS` |
| qualification impact | ⚠️ **有** —— `apiGateway/index.js` **在** 20 文件内；其余三个不在 |
| 风险 | ① 历史读必须**保持 fail-closed**（RH-3）：索引缺该日 ⇒ 显式 UNKNOWN，⛔ 不得回退最新；② 5 个读点的**响应契约**必须保持 additive（沿用 RM 的 backward-compat 原则）；③ 若 RH1 未先落地，本阶段**无数据源** |

### RH4 — Gen-1 History（独立立项）

| 项 | 内容 |
|---|---|
| 修改范围 | 事件化 Gen-1 anchor（`gen1_authority` 变更 / latch 变更 / guarded 计数）；落点待定 |
| qualification impact | ⚠️ **有** —— `runDecisionEngine/index.js` / `runGen1ShadowEod`（后者不在 20 文件内） |
| 风险 | ① Gen-1 是**权限/健康**域，写入路径与 run 生命周期**不同轴** ⇒ 若强行并入 RH1 会污染 run 语义；② 必须避免与 §7.2 禁止的"快照冒充历史"重蹈覆辙；③ 优先级**最低**（当前无消费者提出 Gen-1 历史需求） |

**依赖顺序**：`RH0 → RH1 → RH2 → RH3`；`RH4` 独立、可并行但不阻塞。

---

## 9. Open Decisions（须人工确认，⛔ 本文不选边）

| # | 问题 | 选项 / 影响 |
|---|---|---|
| **OD-1** | `run_history` 是否**单表**？ | ① 单表自引用（§4.3 倾向）② 目录 + 事件分表（审计更干净，但无跨文档事务） |
| **OD-2** | promotion 是否**独立 event**？ | ① 内嵌字段（`promoted_at` / `promoted_from_run_id`）② 独立事件集合（支持多次提升 / 回滚） |
| **OD-3** | 是否允许 RDE **增加 lifecycle writer**？ | ① 允许 ⇒ 动 `runDecisionEngine/index.js`（合格面内）⇒ **重新资格化** ② 不允许 ⇒ RH1 交付**空表**（无意义） |
| **OD-4** | 是否**保留 legacy `decision_result`**？ | ① ENFORCE **双写** ⇒ 动 writer，需重新资格化，但 CLASS C 无需立即迁移 ② **停写**，CLASS C 全改走 RH1 ⇒ 切换日历史断档风险 ③ 双写**过渡期**后停写 |
| **OD-5** | `run_manifest` 与 `run_history` 是**同一张表**吗？ | ① 同一张（manifest 即目录行）② 分开（manifest = run 内部完整性；history = 跨 run 时间线） |
| **OD-6** | 4 个 v365 集合是否**补登记**进 `constants.js` / `SCHEMAS`？ | ① 登记 ⇒ 可被 `init-collections.js` 创建，但纳入 parity 守卫 ② 不登记 ⇒ 生产建表靠人工（现状态，GAP-4） |
| **OD-7** | 两套集合名表（`POC_COLLECTIONS` vs `V365_COLLECTIONS`）是否**收敛**？ | 收敛需动 `v365-atomic-publish.js`（合格面内） |
| **OD-8** | `run_history` 的**保留窗口**与归档策略？ | 影响 §2 的 S7；当前无任何机制 |
| **OD-9** | 是否**同时**修 `runDecisionEngine/index.js` 的 **5 处**失效残留？ | ① 只修 2 处注释（`:1317` / `:1526`，无契约变更）② 连 3 处运行时字段（`:1511` / `:1552` / `:1557`）一起修 ⇒ **响应契约变更**，需 backward-compat 评审 ③ 都不修 ⇒ 与 READINESS 文档持续冲突 |
| **OD-10** | RH4（Gen-1 历史）**是否立项**？ | 当前无消费者提出需求；立项会扩大权限域变更面 |

---

## 10. 本轮边界履行 `[AS-IS]`

| 项 | 实况 |
|---|---|
| 代码 / schema / collection | **零修改**（本文档为唯一产物） |
| 新增 collection | **无** |
| deploy / commit / push / PR / merge | **均未发生** |
| 仓库 HEAD | 仍 `c6bd006fd76ffc5358cddd07347df8ed23d9e61d` |
| 生产侧 | CloudBase `ModTime` 仍 **UNVERIFIED**（本会话无该连接器） |

---

## 附：本文与既有文档的关系

| 文档 | 关系 |
|---|---|
| `docs/V365_READER_MIGRATION.md` §4.1 | **需求来源**（RH-1/RH-2/RH-3）；本文是它的架构级展开 |
| `docs/V365_AUTHORITATIVE_CONSUMER_MAP.md` §E.2 / §G | CLASS C 清单与"另立工作包"约束的来源 |
| `docs/V365_PRODUCTION_INTEGRITY_READINESS.md` §22.7 / §23.8 | `ATOMIC_PROMOTION_BLOCKED = CLOSED` 的权威出处（§5.3 的对照基准） |
| `docs/V365_PLATFORM_CAS_EVIDENCE.md` | 平台能力事实（单文档 CAS 可用 / 无跨文档事务）⇒ §4.2 取舍的前提 |
| `src/common/utils/v365-contracts.js` | 集合名 + CAS 证据的**唯一来源** |
| `src/common/utils/v365-publish-store.js` | store 原语清单（§5.2 的"已存在但未接线"证据） |
| `cloudfunctions/runDecisionEngine/index.js` | 生命周期 S1–S4 的**实际**接线点 |
