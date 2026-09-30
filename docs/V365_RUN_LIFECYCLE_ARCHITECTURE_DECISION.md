# Decision Review

> **主题**：V3.6.5 Run Lifecycle Architecture —— 架构决策评审
> **性质**：架构评审（review-only）。⛔ 本轮**未改代码 / schema / collection / RDE**，未 deploy，未 commit。
> **生成**：2026-09-24（GMT+8）｜接手方 = 本机 WorkBuddy 国际版
> **评审对象**：`docs/V365_RUN_LIFECYCLE_ARCHITECTURE.md` 的 Open Decisions
> **基线**：HEAD `c6bd006fd76ffc5358cddd07347df8ed23d9e61d`（分支 `feat/v365-production-integrity-impl`，未 push）
>
> **证据规则**：凡标 `[AS-IS]` 者为**实测事实**（含 `file:line`）；凡标 `[REC]` 者为**本评审的推荐**；
> 凡标 `[HUMAN]` 者为**必须人工确认**、本评审不代拍。

---

## 前置：编号映射（⚠️ 两文档 OD 编号不同，勿混）

| 本评审 | 主题 | 架构文档编号 |
|---|---|---|
| OD-1 | `run_history` 数据模型 | OD-1 |
| OD-2 | promotion 是否独立 event | OD-2 |
| OD-3 | RDE lifecycle writer | OD-3 |
| OD-4 | legacy `decision_result` 生命周期 | OD-4 |
| OD-5 | V365 collection contract 收敛 | OD-7（+ OD-6） |
| OD-6 | `runtime_status` 字段修正 | OD-9（+ §5.3.1） |
| OD-7 | Gen-1 History 是否独立 | OD-10 |

> 架构文档的 OD-5（manifest 与 run_history 是否同表）/ OD-8（保留窗口）**未列入本次评审范围**，
> 见 §5 HD-8 / HD-9。

---

## OD-1 `run_history` 数据模型

### 1.0 覆盖结论（先给答案）

**RH-1 / RH-2 / RH-3 是否覆盖：三个方案**全部覆盖**（逐条见 1.1 表的前三行）。
⇒ 差异**不在**"是否覆盖"，而在 **查询复杂度 / append-only 强度 / 跨文档一致性风险 / 未来扩展面**。
其中 RH-3（历史读仍 fail-closed）三方案等价；**RH-1 的 supersede 链**是唯一有实质设计差异的点。

### 1.1 三方案 × 六维评估

| 维度 | **A 单表 `run_history`** | **B `run_history` + `promotion_event`** | **C 复用 Gen-2 run model** |
|---|---|---|---|
| **RH-1 覆盖**（run 目录 + supersede 链） | ✅ 单查询枚举区间；链靠自引用字段 | ✅ 但需 join 两表 | ✅ 形态可行 |
| **RH-2 覆盖**（run → 数据集反向索引） | ✅ `decision_count` + `expected_codes` + `portfolio_present` | ✅ | ✅ |
| **RH-3 覆盖**（历史读 fail-closed） | ✅ 缺行 ⇒ UNKNOWN | ✅ | ✅ |
| **查询复杂度** | **O(1)** —— 单表、单索引、无 join | O(1)+join（或 2 次读） | O(1)（若明细另存则 +1 读） |
| **append-only 能力** | ⚠️ **取决于字段设计**（见 1.3 自我修正） | ✅ 事件表天然只追加 | ⚠️ 同 A |
| **审计完整性** | ✅（修正后）—— 一次写入、永不更新 | ✅✅ 最强（事件不可变 + 可分类） | ⚠️ 且**明细重复** |
| **集合数增量** | **+1** | +2 | +1（若存明细 +2） |
| **跨文档一致性风险** | **无**（单文档写） | ⚠️ **有** —— 平台**无跨文档事务**（`CAS_EVIDENCE.transaction_command_available = false`，`v365-contracts.js:90`） | 无 |
| **与 Gen-2 同构** | ✗ | ✗ | ✅ |
| **authority 域** | V365 authoritative（正确） | 同 | ⚠️ **Gen-2 = 影子观察域**，语义不同（§7.1） |

### 1.2 未来需求映射（不只看当前需求）

| 未来场景 | 需要什么 | A | B | C |
|---|---|---|---|---|
| **自动交易** | "当前 active run 的决策 + 它何时被提升" | ✅ | ✅ | ✅ |
| **回测复盘** | "按区间枚举 run + 每 run 的输入哈希 + 终局" | ✅ `input_hash` + `expected_trade_date` 索引 | ✅ | ✅ |
| **决策解释**（AI/人） | "这条决策属于哪个 run；该 run 为何被替代" | ✅ `supersedes_run_id` | ✅✅ 事件可解释"为何 HOLD" | ⚠️ 需跨域 join |
| **风控审计** | **不可变事件流** + "谁在何时把什么提升为权威" | ⚠️ **原设计有一个可变字段**（见 1.3） | ✅✅ | ⚠️ |

### 1.3 ★ 自我修正：架构文档 §4.4 的字段设计有一处**违反严格 append-only**

架构文档 §4.4 原设计同时包含：
```
supersedes_run_id     string|null   ← 由「新 run」写自己的行
superseded_by_run_id  string|null   ← 需由「旧 run」的行**事后更新**   ⛔
```
`superseded_by_run_id` 要求**更新既有行** ⇒ **不是严格 append-only** ⇒ 审计完整性从"强"降为"约定"。

**[REC] 修正**：**删除反向字段**，只保留**前向** `supersedes_run_id`（由新 run 在自己的行里写一次）。
查询"X 被谁替代" = `WHERE supersedes_run_id = X`（靠 `idx_supersedes` 索引）。
⇒ 每行**只写一次、永不更新** ⇒ 严格 append-only，且审计强度**追平方案 B 的核心优点**。

### 1.4 推荐 `[REC]`

**方案 A（单表），并按 1.3 修正为「只存前向 `supersedes_run_id`」。**

理由：
1. **覆盖**：RH-1/RH-2/RH-3 全部满足（1.1 表）。
2. **审计**：修正后为"一次写入、永不更新"，与 B 的核心优势等价；B 的额外能力（事件分类）**当前无需求兑现**。
3. **风险**：B 依赖跨文档一致性，而平台**明确无跨文档事务** ⇒ B 的不一致面是**立刻兑现**的，A 的是**零**。
4. **未来**：自动交易 / 回测 / 解释 / 风控四项在 A 下均可承载（1.2 表）。
5. **不选 C**：跨 authority 域 + 明细重复，无收益。

⛔ **[HUMAN] HD-1**：`run_history` 是否确认为单表？（本评审推荐 A）

---

## OD-2 promotion 是否独立 event

### 2.1 边界声明（先定名，再选型）`[AS-IS]`

| | `active_run_pointer` | `run_history` |
|---|---|---|
| **定性** | **current state**（当前状态） | **history index**（历史目录） |
| **不是** | ⛔ **不是 promotion history** | ⛔ 不是 current state |
| 回答 | **"现在读哪个 run"** | **"历史上有哪些 run"** |
| 基数 | **1 行 / scope**（`pointerDocId` 确定性 `_id`，`v365-publish-store.js:61-63`） | N 行 |
| 可写 | CAS **条件更新**（覆盖） | 只追加 |
| 现有字段 | `scope` / `run_id` / `revision` / `expected_trade_date` / `promoted_from_run_id`（`v365-atomic-publish.js:196-206`） | — |

**明确**：`promoted_from_run_id` **不构成** promotion history —— 它只记录"**当前值**是从谁那里接过来的"，
**只有 1 个**，第三次提升即丢失第一次（架构文档 §3.2 禁令 B）。

### 2.2 关键前置事实：revision 单调 ⇒ run 最多被提升**一次** `[AS-IS]`

`classifyPointerPromotion`（`v365-publish-store.js:89-130`）的拒因含 **`NON_MONOTONIC_REVISION`**
（`CAS_REASON`，`:38-47`）⇒ **回退到更旧 revision 会被拒**。
⇒ 在当前设计下，**同一 run 至多被提升一次**（幂等重试走 `ALREADY_ACTIVE`）。

**推论**：若"每个 run 最多提升一次"，则**内嵌字段已足够** —— 不存在"同一 run 的多个 promotion 事件"。

### 2.3 两方案

| | **A：内嵌进 `run_history`** | **B：独立 `promotion_event`** |
|---|---|---|
| 字段 | `promoted_at` / `promoted_from_run_id` / `cas_reason` | 独立行：`{run_id, event, at, from_run_id, cas_reason}` |
| 写入次数 | **1 次**（见 2.4 时序） | 2 次（目录 + 事件） |
| append-only | ✅（若按 2.4 时序） | ✅ |
| 支持"多次提升/回滚" | ❌ | ✅ |
| 支持"提升被拒"的记录 | ✅（内嵌 `cas_reason`） | ✅ |
| 跨文档一致性 | **无风险** | ⚠️ 有风险（无事务） |
| 集合数 | +1 | +2 |

### 2.4 [REC] 推荐方案 A，**且明确写入时序**（这是关键）

**推荐 A**，前提是历史行按下列**单次写入**时序：

```
S4  candidate 写齐（RDE:542/553）
S4.5 manifest 写入（putManifest，v365-run-integrity.js:185-190）
S5  尝试提升（compareAndSetPointer）
S5.5 ★ run_history **一次写入**：
       { run_id, expected_trade_date, revision, status,
         decision_count, portfolio_present, supersedes_run_id,
         promoted: <bool>, promoted_at, promoted_from_run_id, cas_reason }
S6  若提升成功 ⇒ 指针已切（S5 已发生）
```

⇒ **一行一 run、一次写入、永不更新** ⇒ 严格 append-only；且**同时覆盖 promoted 与 rejected 两种结局**
（rejected 也留痕，满足风控审计）。`promoted_at` = 该行写入时刻（≈ 提升时刻）。

理由：
1. revision 单调 ⇒ **不存在多次提升**（2.2）⇒ B 的核心能力**无法兑现**。
2. B 需两次写 + 跨文档一致性，而平台**无跨文档事务** ⇒ 引入新的不一致面（同 OD-1 理由 3）。
3. A 在 2.4 时序下**严格 append-only**，审计强度足够。
4. ⛔ **未来若引入"回滚/再提升"** ⇒ 届时**再升为 B**（届时 revision 单调性也会被打破，两件事同批处理）。

⛔ **[HUMAN] HD-2**：确认 promotion 内嵌（本评审推荐 A + 2.4 时序）？

---

## OD-3 RDE lifecycle writer ★ 最高优先级

### 3.1 三方案 × 五维评估

| 维度 | **A：RDE 内同步 lifecycle writer** | **B：异步 lifecycle worker** | **C：保持现状，手工补数据** |
|---|---|---|---|
| **流程** | calculate → candidate write → manifest write → finality → promotion → history append | 同上，但由 worker 在 RDE 之后执行 | 人工脚本 |
| **实现成本** | **最低** —— 编排函数**已存在且已被测试覆盖**：`publishCandidateFirst()`（`v365-run-integrity.js:131-…`）已实现 candidate → manifest → 回读 → 分类 → 校验 → 提升全序列 | 高 —— 需新调度（timer/MQ）+ 新状态机 + 新告警 | 最低（无代码）但**人力持续** |
| **qualification impact** | ⚠️ **高** —— `runDecisionEngine/index.js` **在 20 文件合格面内** ⇒ 必须重新资格化 | 同 A（+ 新文件可能不在合格面） | **无** |
| **failure mode** | 同步失败 ⇒ 整轮失败；但**语义已正确**：candidate 已写、pointer 未切 ⇒ 读者 fail-closed（`NO_ACTIVE_POINTER`），**看不到半成品** ✅ | ⚠️ **双写窗口拉长**：candidate 已写、pointer 未切可能持续数分钟；且 worker 自身失败是**静默**的（无人看） | ⛔ **人为错误直接进生产**；且**不可持续** |
| **atomicity** | 单文档 CAS ⇒ **pointer 切换原子**；"先写后切"保证读者只见**完整 run** | 同 A（提升本身仍原子），但**跨阶段无保证** | 无保证 |
| **可恢复性** | ✅ **天然幂等** —— `ALREADY_ACTIVE`（`CAS_REASON`）+ 重跑生成新 `run_id`/`revision` ⇒ 新 run 覆盖 | ✅ 可重试，但**需新幂等键设计** | ❌ 手工重放易重复 |
| **运维复杂度** | **最低** —— 无新组件 | **最高** —— 新组件 / 新失败模式 / 新监控 | 中（但人力不可扩展） |
| **与现有约束相容** | ✅ `runDecisionEngine` **无 timer**（项目既有约束）⇒ 同步是唯一不引入新调度的路 | ⛔ 需新增 timer/MQ ⇒ **与既有约束冲突** | ✅ |

### 3.2 [REC] 推荐方案 A

理由：
1. **成本最低**：`publishCandidateFirst()` **已经写好**（`v365-run-integrity.js:131`，导出于 `:378`），
   且已被 `tests/v365-p3-atomic-publish-poc.test.js` 覆盖 —— RH1/RH2 只需**接线**，不需新写逻辑。
2. **语义已对齐**：同步 fail-closed 与 V3.6.5 既有语义一致（candidate 先写、pointer 后切、读者 fail-closed）。
3. **无新组件**：不引入 timer/MQ ⇒ 运维面不扩大（B 的代价不成比例）。
4. **幂等内建**：`ALREADY_ACTIVE` + `NON_MONOTONIC_REVISION` 已提供重试安全。
5. **重新资格化不可避免**：RH1 无论如何都要动 RDE（至少接线），⇒ 这不是 A 的额外代价。

### 3.3 ⚠️ 接线前必须先处置的一个前置 `[AS-IS]`

RDE 中 **5 处**仍按"CAS 未实证"的旧裁定书写（架构文档 §5.3）：
`:1317` / `:1526`（注释）· `:1511` / `:1552` / `:1557`（运行时字段）。
其中 `:1555-1557` 产出**自相矛盾响应**：`promotion_allowed: true` 与
`promotion_skipped_reason: 'ATOMIC_PROMOTION_BLOCKED:platform_cas_unverified'` **并存**。

⇒ **若先接线、后修字段**，会出现"实际已提升、响应仍称 BLOCKED"的**更严重**不一致。
⇒ **[REC] 顺序：先修字段语义（OD-6），再接线（OD-3）**。

### 3.4 ⛔ 不推荐 B / C

- **B**：唯一优点是"不阻塞决策"。但代价是**新组件 + 长双写窗口 + 静默失败**，
  而当前**无此需求**（RDE 单轮耗时可接受）。
  ⚠️ 但保留演进路径：**A 可后续演进为 A+B**（同步提升 + 异步补偿），⛔ 不应一开始就 B。
- **C**：⛔ 等于**不做事** —— RH1 交付**空表**（无数据源），且 ENFORCE 上线后权威读全 fail-closed
  ⇒ 系统**不可发布**。

⛔ **[HUMAN] HD-3**：是否批准 RDE 增加 lifecycle writer（本评审推荐 A）？
⚠️ 这是决定 RH1 有没有意义的那个问题 —— **不批准则 RH1 无交付价值**。

---

## OD-4 legacy `decision_result` 生命周期

### 4.1 `decision_result` 在未来系统中的角色 `[REC]`

| 角色 | 是否 | 说明 |
|---|---|---|
| **authoritative** | ⛔ **否** | 权威已迁至 `active_run_pointer` → `run_candidate_*`（RM 已完成） |
| **historical** | ✅ **是** | V3.6.5 切换日**之前**的唯一决策历史 |
| **compatibility** | ⚠️ **过渡期是** | CLASS C 的 5 个读点当前仍读它 |

⇒ **定位 = legacy archive（只读）+ 过渡期兼容源**，⛔ **不再 authoritative**。

### 4.2 三方案

| | **A：永久保留 legacy writer（双写）** | **B：只读冻结** | **C：迁移历史后废弃** |
|---|---|---|---|
| writer | 同时写 `decision_result` + `run_candidate_*` | 只写 `run_candidate_*` | 同 B + 一次性历史迁移 |
| CLASS C 读者 | 无需迁移 | ⚠️ **切换日后无数据** ⇒ 必须迁到 RH1 | 无需迁移（历史已在新表） |
| **真相源** | ⛔ **两份真相**（同一决策两处存） | ✅ 单一 | ✅ 单一 |
| 迁移可行性 | — | — | ⛔ **见 4.3：严格迁移不可行** |
| 可逆性 | 高 | 中 | 低 |

### 4.3 ⚠️ 方案 C 的**可行性缺陷**（决定性事实）`[AS-IS]`

历史迁移的前提是"把 `decision_result` 的历史行投影成 run 形态"。**但**：
- `decision_result` **无 `run_id` / `revision`**（94 字段中只有 `gen1_run_id`；架构文档 §1.3 GAP-6）
- `portfolio_snapshot` 同样无 run 身份（32 字段）
⇒ **无法可靠回答"某历史行属于哪个 run"** ⇒ 只能按日期**猜**（"当天唯一 run"），
而**同日多 revision** 时会归错 ⇒ ⛔ **严格迁移不可行**。

### 4.4 [REC] 推荐 **B（只读冻结）**，并把 `decision_result` **显式定义为 legacy archive**

理由：
1. C 的迁移**技术上不可靠**（4.3）⇒ 不可作为终态。
2. A 产生**两份真相**，违反单一真相源 ⇒ 长期负债。
3. B 保留历史可读性（切换日前），且不再产生新数据 ⇒ 语义清晰。

### 4.5 ⚠️ B 的**不可回避后果**（须明示）

CLASS C 读者将进入 **双源读取**：

```
查询区间 [from, to]
  ├─ 若 to < V365_ENFORCE_SWITCH_DATE  ⇒ 走 legacy：decision_result / portfolio_snapshot
  └─ 若 from >= 切换日                  ⇒ 走 run_history → run_candidate_*
  └─ 跨切换日                            ⇒ ⚠️ 两段拼接 + 必须显式标注 provenance
```

⇒ ⛔ **不得**把两段静默拼成一条序列（会产生"同一序列两种 run 语义"的混读）。
**[REC]** 响应中必须携带**分段 provenance**（哪段来自 legacy、哪段来自 run 轴），
沿用 RM 既有的 additive 原则（`docs/V365_READER_MIGRATION.md` §6）。

⛔ **[HUMAN] HD-4**：确认 `decision_result` = legacy archive（只读冻结）？跨切换日区间如何呈现？

---

## OD-5 V365 collection contract 收敛

### 5.1 依赖图事实 `[AS-IS]`

```
v365-contracts.js          ← 叶子（零内部依赖）
      ↑
v365-publish-store.js      → requires v365-contracts
      ↑
v365-atomic-publish.js     → requires v365-publish-store + v361-run-finality
      ↑
v365-run-integrity.js      → requires 上述全部 + v361-run-context
v365-active-read.js        → requires v365-contracts
```

**两套集合名表**：

| 表 | 定义处 | 被谁使用 |
|---|---|---|
| `POC_COLLECTIONS` | `v365-atomic-publish.js:40-45` | `v365-atomic-publish.js`（6 处）· `v365-run-integrity.js:20/152/155/159/160` · `scripts/v365-p3-atomic-publish-gate.js` · `tests/v365-p3-atomic-publish-poc.test.js` |
| `V365_COLLECTIONS` | `v365-contracts.js:49-54` | `v365-active-read.js` · `v365-publish-store.js:62/215` · `v365-run-integrity.js:358`（再导出）· `runDecisionEngine/index.js:543/554` · 门禁与测试 |

**字面值实测**：4 个名字**完全一致**（`run_manifest` / `run_candidate_decision` / `run_candidate_portfolio` / `active_run_pointer`）
⇒ **当前可工作**，但**改名任一侧即静默错配**（无编译期保护）。

⚠️ 且 `POC_COLLECTIONS` 的注释自称「**PoC 抽象；未创建任何生产 collection**」（`v365-atomic-publish.js:39`），
而它实际已被 **RDE 的写入路径**使用（经 `v365-run-integrity.js` 间接）⇒ **注释与实况不符**。

### 5.2 [REC] 收敛到 `v365-contracts.js` 作为唯一来源

| 项 | 推荐动作 |
|---|---|
| `v365-contracts.js` | **保持为唯一来源**（它已是依赖图叶子，语义上就是"契约中央声明"，`v365-contracts.js:4-9` 自述如此） |
| `v365-atomic-publish.js` | 删除本地 `POC_COLLECTIONS`，改 `const { V365_COLLECTIONS } = require('./v365-contracts.js')` |
| 过渡兼容 | **保留别名导出** `POC_COLLECTIONS: V365_COLLECTIONS`（避免破坏 `scripts/v365-p3-atomic-publish-gate.js` 与 `tests/v365-p3-atomic-publish-poc.test.js`） |
| 注释 | 修正 `v365-atomic-publish.js:39` 的「未创建任何生产 collection」为实况 |

**附带两项（架构文档 OD-6）**：

| 项 | [REC] | 理由 |
|---|---|---|
| 4 个集合是否登记进 `constants.js` + `schema.js` | ✅ **登记** | 否则 `init-collections.js`（**由 `SCHEMAS` 驱动**，`init-collections.js:75-76`）**不建表** ⇒ 生产空表；⚠️ 必须**两侧同时**加 —— `schema-collections-parity.test.js` 双向守卫（`constants.COLLECTIONS` 现 29 条、**未 frozen**，`constants.js:15`） |
| reader contract | ✅ **无需改** | `v365-active-read.js` 已用 `CONTRACTS.V365_COLLECTIONS` |

**风险**：登记后 parity 守卫会开始覆盖这 4 个集合 ⇒ 以后改名会被拦（**这是收益，不是风险**）。

⛔ **[HUMAN] HD-5**：确认收敛到 `v365-contracts.js` + 4 集合登记？

---

## OD-6 `runtime_status` 字段修正

### 6.1 契约矛盾**确认存在** `[AS-IS]`

同一响应对象（`runDecisionEngine/index.js:1555-1557`）内并存：

```js
promotion_allowed:         runIntegrity.promotionAllowed(),                        // 探针实测 = true
promotion_skipped_reason:  v365Mode === 'ENFORCE'
  ? 'ATOMIC_PROMOTION_BLOCKED:platform_cas_unverified' : null                      // 硬编码字面量
```

**对照事实（探针实测）**：
`CAS_EVIDENCE.platform_single_document_cas_verified = true`（`v365-contracts.js:86`）·
`implementation_uses_single_document_cas = true`（`:94`）·
`publishPromotionAllowed() = true`（`:105-108`）· `publishStore.promotionAllowed() = true`（`v365-publish-store.js:188-191`）。
而 `ATOMIC_PROMOTION_BLOCKED` 已于 `docs/V365_PRODUCTION_INTEGRITY_READINESS.md:1522` 标为 **CLOSED**。

⇒ **矛盾成立**，且成因是**硬编码字符串未随 `CAS_EVIDENCE` 演进**。

### 6.2 三字段逐个评估

| 字段 | 位置 | 当前写法 | 语义应为 | 判定 |
|---|---|---|---|---|
| `v365_authoritative_published` | `:1511`（`runtime_status`） | `v365Mode !== 'ENFORCE'` | "本轮是否**真的**发布了权威结果" | ⛔ **推理链错误** —— 按**模式**推断，而实际取决于**指针是否提升**。当前 ENFORCE 下恒 `false`（值恰好对），但接线后会在**提升失败时报错值** |
| `authoritative_published` | `:1552`（响应） | 同上 | 同上 | 同上 |
| `promotion_skipped_reason` | `:1557`（响应） | 硬编码 `'ATOMIC_PROMOTION_BLOCKED:platform_cas_unverified'` | 应由**提升结果 / `CAS_EVIDENCE` 派生** | ⛔ **硬编码** ⇒ 必然失真 |

### 6.3 [REC] 推荐**修**，但分两批 + 采用 additive 原则

| 批 | 内容 | 契约影响 | 说明 |
|---|---|---|---|
| **批 1** | 修 `:1317` / `:1526` **注释** | **无** | 纯文案，零风险 |
| **批 2** | 修 3 处**运行时字段** | ⚠️ **有** | ⛔ 建议**不改旧字段值**，而是：<br>① 新增 `authoritative_publish_status`（如实反映提升结果）<br>② 新增 `promotion_skipped_reason` 的**派生**实现（读 `CAS_EVIDENCE` + 提升结果）<br>③ 旧字段标注 **deprecated**，沿用项目既有的 `buildLegacyNotice()` 模式（`adminGateway/index.js:211`） |

### 6.4 关于原则「不要因为修文案改变历史语义」的解读 `[REC]`

本评审的理解与执行方式：
- ⛔ **不得**为了让矛盾"看起来消失"而**把字段值改成配平值**（例如把 `promotion_allowed` 硬改为 `false`）——
  那是**用文案掩盖真相**，会制造更深的失真。
- ✅ **应当**让字段**反映真相**：`promotion_allowed` 继续由 `CAS_EVIDENCE` 派生（保持 `true`），
  而 `promotion_skipped_reason` 改为**派生**（无跳过时返回 `null`）—— 矛盾自然消解，**且语义未被改写**。
- ✅ **历史语义**（旧字段的既有含义）**保留**：旧字段不删、不改名，只加 deprecated 标注 ⇒ 旧消费者不受影响。

⇒ **[REC]** 批 2 必须**先做 backward-compat 评审**再动手；且**应在 OD-3 接线之前完成**（§3.3）。

⛔ **[HUMAN] HD-6**：批 2 是否采用"新增字段 + 旧字段 deprecated"而非"改旧字段值"？

---

## OD-7 Gen-1 History 是否独立

### 7.1 确认：`runtime_status` 永远只承担 current health state `[AS-IS]`

| 事实 | 证据 |
|---|---|
| 单文档 | `schema.js:613` + `uk_key(key, unique)` |
| 每轮**覆盖写** | `runDecisionEngine/index.js:1515` `db.upsert(RUNTIME_STATUS, runtimeStatus, { key: 'runtime-status' })` |
| Gen-1 anchor 全在其中 | `gen1_authority` / `gen1_health_*` / `gen1_guarded_*`（`schema.js:619-641`；登记 27 → 31 字段） |
| 计数器只反映当轮 | `gen1_guarded_effective_invocations` / `gen1_guarded_shadow_invocations` / `gen1_guarded_evidence_independent_events` |

⇒ **确认**：结构上**不可能**承载历史。⛔ **不得**用"定期快照 `runtime_status`"伪造 ——
那会产生**采样间隔内的空洞**，且无法区分"没发生"与"没采样"。

### 7.2 [REC] 建议**立项，但优先级最低、且不阻塞 RH1–RH3**

| 项 | 推荐 |
|---|---|
| 是否建立 `WP-GEN1-HISTORY` | ✅ **建立**（登记状态 = `REGISTERED` / `NOT_STARTED`） |
| 优先级 | **最低** —— 当前**无消费者**提出 Gen-1 历史需求 |
| 为何不并入 RH1 | Gen-1 是**权限/健康**域，与 run 生命周期**不同轴** ⇒ 强行并入会污染 run 语义 |
| 最小粒度 | **事件**（authority 变更 / latch 变更 / guarded 计数跃迁），⛔ **不是快照** |
| 与 RH4 的关系 | RH4 = 本项 |

⛔ **[HUMAN] HD-7**：是否正式立项 `WP-GEN1-HISTORY`（本评审推荐"立项但不启动"）？

---

## 1. Recommended Architecture `[REC]`

```
┌─ 单一契约来源 ─────────────────────────────────────────────────┐
│  v365-contracts.js  —— 集合名 / CAS 证据 / 版本常量的唯一来源     │
│  （OD-5：删除 POC_COLLECTIONS，保留别名过渡）                    │
└───────────────────────────────────────────────────────────────┘
                              │
┌─ 写侧（RDE 同步，OD-3 方案 A）──────────────────────────────────┐
│  calculate → candidate write → manifest write → finality        │
│           → promotion（单文档 CAS）→ history append（一次写入）   │
│  复用已存在的 publishCandidateFirst()（v365-run-integrity.js:131）│
└───────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┴─────────────────────┐
        ▼                                           ▼
┌─ current state ─────────────┐      ┌─ history index（OD-1 A'）────┐
│  active_run_pointer          │      │  run_history（单表）          │
│  · 1 行 / scope              │      │  · 一行一 run、只追加          │
│  · 回答"现在读哪个 run"       │      │  · 只存前向 supersedes_run_id  │
│  · ⛔ 不是 promotion history  │      │  · 回答"历史上有哪些 run"      │
└──────────────────────────────┘      └──────────────────────────────┘
        │                                           │
        ▼                                           ▼
┌─ CLASS A 读者（已完成）──────┐      ┌─ CLASS C 读者（RH3）──────────┐
│  readAuthoritativeDataset    │      │  run_history → run_candidate_* │
│  5 端点 + admin health        │      │  ⚠️ 双源：切换日前走 legacy    │
└──────────────────────────────┘      └──────────────────────────────┘

┌─ legacy（OD-4 方案 B）──────────────────────────────────────────┐
│  decision_result / portfolio_snapshot = legacy archive（只读冻结）│
│  ⛔ 不再 authoritative；切换日后不再新增                          │
└───────────────────────────────────────────────────────────────┘

┌─ 独立立项（OD-7）───────────────────────────────────────────────┐
│  WP-GEN1-HISTORY（REGISTERED / NOT_STARTED；事件粒度；不阻塞 RH1–3）│
└───────────────────────────────────────────────────────────────┘
```

**核心不变式（三条，建议写入代码注释与门禁）**：
1. `active_run_pointer` **唯一**回答"现在读哪个 run"；⛔ 不得由 `run_history` 推断。
2. `run_history` **唯一**回答"历史上有哪些 run"；⛔ 不得由 pointer 重建时间线。
3. `run_history` **一行一 run、一次写入、永不更新**（严格 append-only）。

---

## 2. Rejected Alternatives

| # | 拒绝的方案 | 拒绝理由（决定性事实） |
|---|---|---|
| R-1 | **OD-1 方案 B**（目录 + 独立 promotion_event） | 平台**无跨文档事务**（`CAS_EVIDENCE.transaction_command_available = false`）⇒ 目录与事件**无法原子同写**；而 revision 单调（`NON_MONOTONIC_REVISION`）⇒ 每 run 最多提升一次 ⇒ B 的多事件能力**无法兑现**。**代价立刻兑现、收益不兑现。** |
| R-2 | **OD-1 方案 C**（复用 Gen-2 run model） | Gen-2 是**影子观察域**，V365 是 **authoritative 域**（不同 authority）⇒ ⛔ 不得合并；且其明细形态与 `run_candidate_*` **重复存储**，零收益。 |
| R-3 | **OD-2 方案 B**（独立 promotion_event） | 同 R-1；且 §2.2 证明"每 run 最多提升一次" ⇒ 内嵌字段已完备。 |
| R-4 | **OD-3 方案 B**（异步 lifecycle worker） | 需新增 timer/MQ，与「`runDecisionEngine` **无 timer**」的既有约束冲突；引入**长双写窗口 + 静默失败**；而当前**无此需求**。⚠️ 保留为**未来演进路径**（A→A+B），⛔ 不作为起点。 |
| R-5 | **OD-3 方案 C**（保持现状 / 手工补数据） | RH1 交付**空表**（无数据源）；ENFORCE 上线后权威读全 fail-closed ⇒ **系统不可发布**。等同不做事。 |
| R-6 | **OD-4 方案 A**（永久双写 legacy） | 产生**两份真相**（同一决策两处存），违反单一真相源 ⇒ 长期负债，且掩盖"哪份是权威"的问题。 |
| R-7 | **OD-4 方案 C**（迁移历史后废弃） | ⛔ **技术不可行**：`decision_result`（94 字段）与 `portfolio_snapshot`（32 字段）**均无 `run_id` / `revision`** ⇒ 无法可靠回答"某历史行属于哪个 run"；同日多 revision 必归错。 |
| R-8 | **OD-1 的 `superseded_by_run_id` 反向字段**（架构文档 §4.4 原设计） | 要求**更新既有行** ⇒ 违反严格 append-only，审计强度下降。**改为只存前向 `supersedes_run_id`**（§1.3）。 |
| R-9 | **OD-6 的"改旧字段值以消除矛盾"** | 属于**用文案掩盖真相**；且改旧字段值 = **契约破坏**。改为"新增字段 + 旧字段 deprecated"（§6.3/§6.4）。 |
| R-10 | **OD-7 把 Gen-1 历史并入 RH1** | Gen-1 是权限/健康域，与 run 生命周期**不同轴** ⇒ 污染 run 语义。 |
| R-11 | **用快照方式伪造 Gen-1 历史** | 产生采样空洞，且无法区分"没发生"与"没采样"（§7.1）。 |

---

## 3. Migration Order

```
RH0 ──▶ OD-6 批1（注释）──▶ RH1 ──▶ OD-6 批2（字段）──▶ OD-3（接线）──▶ RH2 ──▶ RH3 ──▶ RH4
```

> ⚠️ **与架构文档 §8 的差异（本评审修正）**：架构文档的 RH1 把"目录 + 写侧接线"合并；
> 本评审**拆开**并**前插 OD-6**，理由是 §3.3 —— 若先接线后修字段，会产生
> "实际已提升、响应仍称 `ATOMIC_PROMOTION_BLOCKED`"的**更严重**不一致。

| 阶段 | 内容 | 前置 | 阻塞关系 |
|---|---|---|---|
| **RH0** | 架构文档 + 本评审文档 | — | — |
| **OD-6 批1** | 修 `:1317` / `:1526` 注释 | RH0 | **无契约影响** |
| **RH1** | ① 新增 `run_history` 集合（按 OD-1 A'）② 登记 `constants.js` + `schema.js`（OD-5）③ 收敛集合名表（OD-5）④ 生产建表 | OD-6 批1 | ④ 需**DB 变更授权** |
| **OD-6 批2** | 修 3 处运行时字段（additive + deprecated） | RH1 | ⚠️ 需 backward-compat 评审 |
| **OD-3** | RDE 接线 lifecycle writer（`publishCandidateFirst`） | OD-6 批2 | ★ **最高优先级**；决定 RH1 是否有价值 |
| **RH2** | ① promotion 结果落 `run_history`（OD-2 时序）② 补 `supersedes_run_id` | OD-3 | 依赖 OD-3 |
| **RH3** | CLASS C 5 个读点迁移 + 双源 provenance（OD-4 §4.5） | RH2 | 依赖 RH2 有数据 |
| **RH4** | `WP-GEN1-HISTORY`（事件粒度） | 独立 | **不阻塞** RH1–RH3 |

**关键路径**：`RH0 → OD-6批1 → RH1 → OD-6批2 → OD-3 → RH2 → RH3`
（RH4 可并行，但不阻塞任何人）

---

## 4. Qualification Impact

> **合格面事实**：`ml/manifests/V365_CANDIDATE_MANIFEST.json` 的 `file_sha256` 覆盖 **20 个文件**，
> **不含 `docs/` 与 `scripts/`**。触碰任一 ⇒ `candidate_content_sha` 变化 ⇒ **必须重新资格化**。
> 实测成员：`v365-contracts.js` ✅ · `v365-atomic-publish.js` ✅ · `v365-publish-store.js` ✅ ·
> `v365-run-integrity.js` ✅ · `v365-active-read.js` ✅ · `runDecisionEngine/index.js` ✅ ·
> `apiGateway/index.js` ✅ · `adminGateway/index.js` ✅；
> `constants.js` ✗ · `schema.js` ✗ · `cooldown.js` ✗ · `runIntegratedShadowEod` ✗ · `runGen1ShadowEod` ✗ ·
> `init-collections.js` ✗。

| 阶段 | 触碰合格面？ | 触碰的文件 | 需重新 gate？ | 影响 parity？ |
|---|---|---|---|---|
| **RH0** | ❌ **否** | 仅 `docs/`（不在合格面） | ❌ 否 | ❌ 否 |
| **OD-6 批1**（注释） | ✅ **是** | `runDecisionEngine/index.js` | ✅ **是**（manifest 重算 + 38/38 + 8/8） | ⚠️ 需复跑确认 Δ=0（注释不应影响行为，但**必须实测**） |
| **RH1** | ✅ **是**（部分） | `runDecisionEngine/index.js`（写侧接线）· `v365-atomic-publish.js`（OD-5 收敛）· `v365-contracts.js`（若改） | ✅ **是** | ⚠️ 需复跑 Δ=0 |
| | ❌ 否（部分） | `constants.js` · `schema.js` · `init-collections.js`（均不在合格面） | — | — |
| **OD-6 批2**（字段） | ✅ **是** | `runDecisionEngine/index.js` | ✅ **是** | ⚠️ 需复跑 Δ=0 |
| **OD-3**（接线） | ✅ **是** | `runDecisionEngine/index.js` | ✅ **是**（**最关键**：新增调用 `publishCandidateFirst`） | ⚠️ **必须**复跑 Δ=0 —— 接线若误改决策路径即破坏硬目标 |
| **RH2** | ✅ **是** | `v365-publish-store.js` · `v365-atomic-publish.js` · `runDecisionEngine/index.js` | ✅ **是** | ⚠️ 需复跑 Δ=0 |
| **RH3** | ✅ **是**（部分） | `apiGateway/index.js` | ✅ **是** | ⚠️ 需复跑 Δ=0 |
| | ❌ 否（部分） | `cooldown.js` · `runIntegratedShadowEod` · `runGen1ShadowEod` | — | — |
| **RH4** | ✅ **是**（部分） | `runDecisionEngine/index.js` | ✅ **是** | ⚠️ 需复跑 Δ=0 |
| | ❌ 否（部分） | `runGen1ShadowEod` | — | — |

**每一步的 gate 清单（统一）**：
`verify-immutable` 23/23 · `verify-gen1-pipeline` 10/10 · `verify-gen2-build-artifacts` 7/7 ·
`v365-qualification-gate` 38/38 · `v365-reader-migration-gate` 8/8 ·
`verify-v365-candidate-manifest` 20 文件 · `Stage A` 59/59 · `v365-p12-decision-parity` **Δ=0**

⚠️ **parity 的两个判据不可混**（架构文档 §7.4 已披露的已知冲突）：
`v365-p12-decision-parity.js` 把 `runDecisionEngine/index.js` 列为「决策核心必须零改动」，
而 V365 **按授权修改了它** ⇒ **传 `--changed-file` 清单时该脚本必然 exit 1**（默认调用无清单 ⇒ PASS + WARN）。
⇒ RH1/RH2/RH3 每次改 RDE 都会触发该冲突 ⇒ **须在每次资格化时显式声明**，⛔ 不得当作回归。

---

## 5. Human Decisions Required

| # | 问题 | 本评审推荐 | 影响面 |
|---|---|---|---|
| **HD-1** | `run_history` 是否确认为**单表**（方案 A'，只存前向 `supersedes_run_id`）？ | ✅ A' | 决定 RH1 的建表形态 |
| **HD-2** | promotion 是否**内嵌** `run_history`（含 §2.4 单次写入时序）？ | ✅ 内嵌 | 决定是否 +1 集合 |
| **HD-3** | ★ 是否批准 **RDE 增加 lifecycle writer**（方案 A）？ | ✅ A | ★ **决定 RH1 有无价值**；不批准 ⇒ 交付空表 |
| **HD-4** | `decision_result` 是否定为 **legacy archive（只读冻结）**？跨切换日区间如何呈现？ | ✅ B + 分段 provenance | 决定 CLASS C 是否需双源读取 |
| **HD-5** | 集合名是否**收敛到 `v365-contracts.js`** + 4 集合**登记**进 `constants.js`/`schema.js`？ | ✅ 收敛 + 登记 | 决定生产能否建表 |
| **HD-6** | OD-6 批2 是否采用「**新增字段 + 旧字段 deprecated**」而非改旧字段值？ | ✅ 新增 + deprecated | 决定响应契约是否破坏 |
| **HD-7** | 是否正式立项 **`WP-GEN1-HISTORY`**？ | ✅ 立项但不启动 | 不阻塞主线 |
| **HD-8** | （架构文档 OD-5）`run_manifest` 与 `run_history` 是否**同一张表**？ | ⚠️ **本评审未评** —— 需先定 RH1 建表形态 | 影响 RH1 范围 |
| **HD-9** | （架构文档 OD-8）`run_history` 的**保留窗口 / 归档策略**？ | ✅ **已定案**（2026-09-29 owner 裁定）`HD-9_RUN_HISTORY_RETENTION_POLICY = RETAIN_INDEFINITELY_FOR_V365` —— ⛔ 不自动删 / 不归档 / 无 TTL / 不压缩；⛔ 当前不实现 retention worker | 影响存储与合规 |
| **HD-10** | **生产建表授权**：`run_history` 与 4 个 v365 集合是否批准在 CloudBase 创建？ | ⚠️ 需 owner 单独授权（DB 变更） | 决定 RH1 能否落地 |
| **HD-11** | **顺序确认**：是否接受 `OD-6批1 → RH1 → OD-6批2 → OD-3 → RH2 → RH3` 这一顺序？ | ✅ 接受 | 决定是否避免"已提升但报 BLOCKED"的不一致 |

---

## 本轮边界履行 `[AS-IS]`

| 项 | 实况 |
|---|---|
| 代码 / schema / collection / RDE | **零修改**（本文件为唯一产物） |
| deploy / commit / push / PR / merge | **均未发生** |
| 仓库 HEAD | 仍 `c6bd006fd76ffc5358cddd07347df8ed23d9e61d`（ahead 14 / behind 0） |
| 生产侧 | CloudBase `ModTime` 仍 **UNVERIFIED**（本会话无该连接器） |

---

## 附：本文件对架构文档的**修正**（3 处，须回填）

| # | 架构文档原文 | 本评审修正 | 依据 |
|---|---|---|---|
| 1 | §4.4 含 `superseded_by_run_id`（反向字段） | ⛔ **删除**，只存前向 `supersedes_run_id` | §1.3：反向字段需更新既有行 ⇒ 违反严格 append-only |
| 2 | §8 的 RH1 含"写侧接线"，且 RH2 在 OD-3 之前 | 拆为 `RH1（建表）→ OD-6批2 → OD-3（接线）→ RH2` | §3.3：先接线后修字段 ⇒ "已提升但报 BLOCKED"的更严重不一致 |
| 3 | §5.3 只说"5 处失效残留"未给处置顺序 | 明确 **批1（注释，零风险）先做、批2（字段）在 OD-3 前做** | §6.3 / §3.3 |
