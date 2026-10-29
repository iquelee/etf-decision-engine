# V365 Run Lifecycle Implementation Roadmap

> **性质**：架构冻结 + 实施路线（freeze / planning）。⛔ 本轮**未改代码 / schema / collection / RDE**，未 deploy，未 commit。
> **生成**：2026-09-24（GMT+8）｜接手方 = 本机 WorkBuddy 国际版
> **前置**：`docs/V365_RUN_LIFECYCLE_ARCHITECTURE.md` · `docs/V365_RUN_LIFECYCLE_ARCHITECTURE_DECISION.md`
>
> ⚠️ **冻结 ≠ 实施授权**。本文件冻结的是**架构决策**；每一 WP 的**动手**仍需 owner 当轮逐项授权
> （沿用项目 §0 纪律：授权逐位绑定 SHA，HEAD 一变即失效）。

---

## 冻结锚点 `[AS-IS]`

| 项 | 值 |
|---|---|
| 仓库 HEAD | `c6bd006fd76ffc5358cddd07347df8ed23d9e61d` |
| 分支 | `feat/v365-production-integrity-impl`（ahead 14 / behind 0，**未 push**） |
| `V365_RUN_LIFECYCLE_ARCHITECTURE.md` | `a6d01e05ecaaa3cfe51ed4a414e56ef3d5afa44cba2a5bf5d53ac6acc0bb9869` |
| `V365_RUN_LIFECYCLE_ARCHITECTURE_DECISION.md` | `7c84dbfa4d432af5d5b506d5e95c51dd6f49c80c85a784f3787aa9aa88d39c85` |
| `V365_READER_MIGRATION.md` | `c78736c81b848d8d02e89a1b75012d180b8e726eae74291126845ccafaf32774` |
| `candidate_content_sha` | `485c0977952983253d9ed1fac62e1bb44e2e8f0cf8cce414c3ab4333b5a62254`（20 文件） |
| parity anchor | `25ccbfc7e1b73a9a173ec36c17512c6228a2fe42685dcd291bc055ea4ed11723` |

> ⚠️ 上列文档哈希与 `candidate_content_sha` 均为**冻结时的实测值**。任何一项变化 ⇒ 本冻结**须显式复核**。

---

## 1. Frozen Architecture Decisions

> **冻结日**：2026-09-24 ｜ **冻结依据**：`..._DECISION.md` 的 `[REC]` 推荐，经 owner 于本阶段确认。
> 每项含 **Decision / Reason / Rejected alternatives**。标 `[FROZEN]` 者为**不可在本路线内单方面变更**。

## OD-1 `run_history` 模型 `[FROZEN]`

| 项 | 内容 |
|---|---|
| **Decision** | **方案 A′：单表 `run_history`，一行一 run，严格 append-only；只存前向 `supersedes_run_id`（⛔ 不存 `superseded_by_run_id`）** |
| **Reason** | ① RH-1/RH-2/RH-3 三方案全覆盖，差异不在覆盖而在风险面；② 平台**无跨文档事务**（`CAS_EVIDENCE.transaction_command_available = false`，`v365-contracts.js:90`）⇒ 多表方案的一致性风险**立刻兑现**；③ 前向单指针 ⇒ **每行只写一次、永不更新** ⇒ 审计强度追平方案 B 的核心优点；④ 未来四项需求（自动交易 / 回测复盘 / 决策解释 / 风控审计）在单表下均可承载 |
| **Rejected** | **B（目录 + 独立 `promotion_event`）**：多集合 + 跨文档一致性风险，且 revision 单调（`NON_MONOTONIC_REVISION`）⇒ 多事件能力**无法兑现** ⇒ 代价兑现、收益不兑现。<br>**C（复用 Gen-2 run model）**：Gen-2 是**影子观察域**、V365 是 **authoritative 域** ⇒ ⛔ 不得合并；且明细与 `run_candidate_*` **重复存储**，零收益。<br>**架构文档 §4.4 原设计的反向字段 `superseded_by_run_id`**：需**更新既有行** ⇒ 违反严格 append-only ⇒ 删除。 |

## OD-2 promotion 模型 `[FROZEN]`

| 项 | 内容 |
|---|---|
| **Decision** | **方案 A：promotion 信息内嵌 `run_history`**，并按**单次写入时序**落盘：<br>`S4 candidate 写齐 → S4.5 manifest 写 → S5 尝试提升 → S5.5 run_history 一次写入（含 promoted / cas_reason）→ S6 指针已切` |
| **Reason** | ① `classifyPointerPromotion` 含 `NON_MONOTONIC_REVISION` 拒因（`v365-publish-store.js:38-47`）⇒ **回退更旧 revision 被拒** ⇒ 同一 run **至多提升一次** ⇒ 独立事件表**无内容可装**；② 单次写入 ⇒ 一行一 run、永不更新 ⇒ 严格 append-only；③ **同时覆盖 promoted 与 rejected 两种结局**（rejected 也留痕，满足风控审计） |
| **Rejected** | **B（独立 `promotion_event`）**：同 OD-1 理由 ②；且 §2.2 已证"每 run 最多提升一次" ⇒ 内嵌字段已完备。<br>⚠️ **保留演进路径**：未来若引入"回滚 / 再提升"，届时**同时**升为 B（revision 单调性也会被打破，两件事同批处理）。 |

## OD-3 lifecycle writer 模型 `[FROZEN]`

| 项 | 内容 |
|---|---|
| **Decision** | **方案 A：RDE 内同步 lifecycle writer** —— 复用**已存在且已被测试覆盖**的 `publishCandidateFirst()`（`v365-run-integrity.js:131`，导出 `:378`），接线即用 |
| **Reason** | ① **成本最低** —— 编排序列（candidate → manifest → 回读 → 分类 → 校验 → 提升）**已实现**，RH2 只需接线；② 语义已对齐（candidate 先写、pointer 后切、读者 fail-closed ⇒ **看不到半成品**）；③ **无新组件** ⇒ 运维面不扩大；④ **幂等内建**（`ALREADY_ACTIVE` / 重跑生成新 `run_id`）；⑤ 重新资格化**不可避免**（RH2 无论如何都要动 RDE）⇒ 非本方案的额外代价 |
| **Rejected** | **B（异步 lifecycle worker）**：需新增 timer/MQ，与「`runDecisionEngine` **无 timer**」的既有约束冲突；引入**长双写窗口 + 静默失败**；当前**无此需求**。⚠️ 保留为**未来演进**（A→A+B 同步提升 + 异步补偿），⛔ 不作为起点。<br>**C（保持现状 / 手工补数据）**：RH2 交付**空表**（无数据源）；ENFORCE 上线后权威读全 fail-closed ⇒ **系统不可发布**。等同不做事。 |

## OD-4 legacy `decision_result` 生命周期 `[FROZEN]`

| 项 | 内容 |
|---|---|
| **Decision** | **方案 B：只读冻结**，并**显式定义** `decision_result` / `portfolio_snapshot` = **legacy archive**：<br>· authoritative ⛔ **否** ｜ · historical ✅ **是** ｜ · compatibility ⚠️ **过渡期是** |
| **Reason** | ① 方案 C 的迁移**技术不可行**（见 Rejected）；② 方案 A 产生**两份真相** ⇒ 违反单一真相源 ⇒ 长期负债；③ B 保留切换日前的历史可读性，且不再产生新数据 ⇒ 语义清晰 |
| **Rejected** | **A（永久双写）**：同一决策两处存 ⇒ 两份真相。<br>**C（迁移历史后废弃）**：⛔ **不可行** —— `decision_result`（94 字段）与 `portfolio_snapshot`（32 字段）**均无 `run_id` / `revision`**（唯一 run 类字段是 `gen1_run_id`）⇒ 无法可靠回答"某历史行属于哪个 run"；**同日多 revision 必归错**。 |
| ⚠️ **附带后果（已接受）** | CLASS C 读者进入**双源读取**：`to < 切换日` 走 legacy；`from >= 切换日` 走 run 轴；**跨切换日 ⇒ 两段拼接 + 必须携带分段 provenance**（⛔ 不得静默拼成一条序列）。 |

## OD-5 contract 收敛 `[FROZEN]`

| 项 | 内容 |
|---|---|
| **Decision** | **收敛到 `src/common/utils/v365-contracts.js` 作为集合名的唯一来源**：<br>① 删除 `v365-atomic-publish.js` 的本地 `POC_COLLECTIONS`，改为 require `V365_COLLECTIONS`<br>② **保留别名导出** `POC_COLLECTIONS: V365_COLLECTIONS`（过渡，避免破坏 `scripts/v365-p3-atomic-publish-gate.js` 与 `tests/v365-p3-atomic-publish-poc.test.js`）<br>③ 修正 `v365-atomic-publish.js:39` 的失效注释（「未创建任何生产 collection」与实况不符）<br>④ **4 个 v365 集合登记**进 `constants.js` **与** `schema.js`（⛔ 必须两侧同时） |
| **Reason** | ① `v365-contracts.js` 已是**依赖图叶子**（零内部依赖），且自述为"契约版本中央声明"（`:4-9`）⇒ 天然单一来源；② 两表**字面值实测完全一致** ⇒ 当前可工作，但**改名任一侧即静默错配**（无编译期保护）；③ 不登记 ⇒ `init-collections.js`（**由 `SCHEMAS` 驱动**，`:75-76`）**不建表** ⇒ 生产空表 |
| **Rejected** | **保留双表**：静默错配风险。<br>**不登记 4 集合**：生产空表（当前状态，GAP-4）。<br>⚠️ 登记后 `schema-collections-parity.test.js` 将开始守卫这 4 个集合 ⇒ **这是收益**（改名会被拦），非风险。 |

## OD-6 `runtime_status` 修正原则 `[FROZEN]`

| 项 | 内容 |
|---|---|
| **Decision** | **修，但分两批 + additive**：<br>**批 1**（零契约影响）：修 `runDecisionEngine/index.js:1317` / `:1526` **注释**<br>**批 2**（有契约影响）：修 3 处**运行时字段**（`:1511` / `:1552` / `:1557`）—— ⛔ **不改旧字段值**，而是**新增** `authoritative_publish_status` + `promotion_skipped_reason` 改为**派生** + 旧字段标 **deprecated**（沿用 `buildLegacyNotice()` 模式，`adminGateway/index.js:211`） |
| **Reason** | ① 矛盾**确认存在**：同一响应内 `promotion_allowed: true`（探针实测）与硬编码 `'ATOMIC_PROMOTION_BLOCKED:platform_cas_unverified'` 并存，而 `ATOMIC_PROMOTION_BLOCKED` 已于 `docs/V365_PRODUCTION_INTEGRITY_READINESS.md:1522` 标为 **CLOSED**；② 硬编码字符串**不随 `CAS_EVIDENCE` 演进** ⇒ 必然失真；③ `authoritative_published: v365Mode !== 'ENFORCE'` 按**模式**推断"已发布"，而实际取决于**指针是否提升** ⇒ 推理链错误 |
| **原则（冻结）** | ⛔ **不得**为了让矛盾"看起来消失"而**改旧字段值配平**（= 用文案掩盖真相，且 = 契约破坏）。<br>✅ **应当**让字段**反映真相**：`promotion_allowed` 继续由 `CAS_EVIDENCE` 派生（保持 `true`），`promotion_skipped_reason` 改为派生（无跳过时 `null`）⇒ 矛盾自然消解，**语义未被改写**。<br>✅ **历史语义保留**：旧字段**不删、不改名**，只加 deprecated 标注 ⇒ 旧消费者不受影响。 |
| **Rejected** | **改旧字段值以消除矛盾**：用文案掩盖真相 + 契约破坏。<br>**只改注释不改字段**：矛盾留在生产响应里。<br>**不改任何一处**：与 `READINESS.md` 持续冲突（且接线后会产生"已提升但报 BLOCKED"的**更严重**不一致）。 |
| ⚠️ **顺序约束（冻结）** | **批 2 必须先于 OD-3 接线**。否则出现「实际已提升、响应仍称 `ATOMIC_PROMOTION_BLOCKED`」。 |

## OD-7 Gen-1 history 边界 `[FROZEN]`

| 项 | 内容 |
|---|---|
| **Decision** | ① **确认**：`runtime_status` **永远只承担 current health state**；② **建立** `WP-GEN1-HISTORY`，状态 = `REGISTERED` / `NOT_STARTED`；③ 优先级**最低**，⛔ **不阻塞** WP-RH0~RH4 |
| **Reason** | ① `runtime_status` 是**单文档**（`schema.js:613` + `uk_key`）+ 每轮**覆盖写**（`runDecisionEngine/index.js:1515`）⇒ **结构上不可能**承载历史；② Gen-1 是**权限/健康域**，与 run 生命周期**不同轴** ⇒ 强行并入会污染 run 语义；③ 当前**无消费者**提出 Gen-1 历史需求 |
| **Rejected** | **并入 WP-RH2/RH3**：污染 run 语义。<br>**用定期快照 `runtime_status` 伪造历史**：产生**采样空洞**，且无法区分"没发生"与"没采样"。<br>**不立项**：需求可能在未来出现（自动交易需要 authority 变更溯源）。 |
| **最小粒度（冻结）** | **事件**（authority 变更 / latch 变更 / guarded 计数跃迁），⛔ **不是快照**。 |

---

## 2. Final Target Architecture

## 2.1 六层关系 `[FROZEN]`

```
┌─ ① candidate layer ─────────────────────────────────────────────────┐
│  run_manifest               run 内部完整性（expected_codes / input_hash）│
│  run_candidate_decision     逐票候选（run 隔离，带 run_id）              │
│  run_candidate_portfolio    组合候选（run 隔离，带 run_id）              │
│  —— 不可变 run 产物；写入后不修改（重算 ⇒ 新 run_id）                    │
└─────────────────────────────────────────────────────────────────────┘
                              ▲ 由 ② 驱动写入
┌─ ② run lifecycle layer ─────────────────────────────────────────────┐
│  lifecycle writer（RDE 内同步，OD-3）                                │
│  S1 Created → S2 Calculating → S3 Finalized → S4 Candidate Available │
│  → S5 Promoted → S6 Superseded → S7 Archived                         │
│  —— 这是**进程层**，不是集合；它决定 ①③⑤ 三层何时被写                   │
└─────────────────────────────────────────────────────────────────────┘
                              │ 提升成功 ⇒ 同时写 ③ 与 ⑤
                              ▼
┌─ ③ promotion layer ─────────────────────────────────────────────────┐
│  active_run_pointer    ★ current state：1 行/scope，回答"现在读哪个 run" │
│  —— CAS 条件更新（单文档原子）；⛔ **不是** promotion history           │
└─────────────────────────────────────────────────────────────────────┘
                              │ 被 ④ 读取（pin 一次）
                              ▼
┌─ ④ authority layer ─────────────────────────────────────────────────┐
│  readAuthoritativeDataset（v365-active-read.js:240）                 │
│  resolveActivePointer → listCandidates(run_id) → coherence → 完整性  │
│  ⇒ provenance：authority_selector / pinned_once / latest_fallback_used│
│  —— 这是**权威边界**：唯一有权回答"什么是权威"的地方                     │
└─────────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┴─────────────────────┐
        ▼                                           ▼
┌─ ⑤ history layer ──────────────────┐   ┌─ ⑥ reader layer ─────────────┐
│  run_history（★ 新建，OD-1 A′）      │   │  CLASS A：①④（已完成）        │
│  · 一行一 run、只追加、永不更新       │   │  CLASS B：mutable 轴（另一条轴）│
│  · 只存前向 supersedes_run_id        │   │  CLASS C：⑤ → ①（WP-RH4）     │
│  · 回答"历史上有哪些 run"             │   │  —— ⛔ 不得跨轴/跨层越权读取   │
└────────────────────────────────────┘   └──────────────────────────────┘

┌─ legacy（OD-4，不在主链）────────────────────────────────────────────┐
│  decision_result / portfolio_snapshot = legacy archive（只读冻结）     │
│  ⛔ 不再 authoritative；切换日后不再新增；CLASS C 跨切换日须分段 provenance│
└─────────────────────────────────────────────────────────────────────┘
```

## 2.2 集合职责表 `[FROZEN]`

> ⚠️ 「当前状态」列 = **冻结时（2026-09-24）** 的现状。**实施后现状见 §2.3**（以 §2.3 为准）。

| 集合 | 层 | 职责 | 基数 | 可写性 | 回答的问题 | 当前状态（冻结时） | 实施后（§2.3） |
|---|---|---|---|---|---|---|---|
| `run_manifest` | ① candidate | run 内部完整性（`expected_codes` / `input_hash` / `finality`） | N | 写入后不变 | "这个 run 声明了什么" | ⛔ **无写入方** | ✅ 由 `publishCandidateFirst()` 写入 |
| `run_candidate_decision` | ① candidate | 逐票候选决策 | N | 追加后不可变 | "这个 run 算出了什么" | ✅ 已写（无目录⇒不可枚举） | ✅ 已写 + `run_history` 提供目录 |
| `run_candidate_portfolio` | ① candidate | 组合候选 | N | 追加后不可变 | 同上 | ✅ 已写 | ✅ 已写 |
| `active_run_pointer` | ③ promotion | **current state** | **1 / scope** | CAS 覆盖 | **"现在读哪个 run"** | ⛔ **无提升调用** | ✅ RDE 接线后**有**提升调用 |
| `run_history` | ⑤ history | **timeline** | N | **只追加** | **"历史上有哪些 run"** | ⛔ **不存在（待建）** | ✅ 已登记 + RDE 单次写入（⚠️ **数据侧仍待生产提升**） |
| `decision_result` | legacy | legacy archive（切换日前） | N | **冻结（只读）** | "V3.6.5 之前的决策" | ✅ 存在（ENFORCE 下停写） | 同（LEGACY 分支仍直写） |
| `portfolio_snapshot` | legacy | legacy archive（切换日前） | N | **冻结（只读）** | 同上 | ✅ 存在 | ✅ 存在（未改） |
| `runtime_status` | — | **current health state** | **1** | 每轮覆盖 | "现在什么状态" | ✅ 存在 | ✅ 存在 + OD-6 派生字段 |
| `portfolio_position` 等 | CLASS B | **mutable state 轴**（⛔ 不属 run 生命周期） | N | 可变 | "现实状态如何" | ✅ 存在 | ✅ 存在（未改） |

**三条不变式（冻结，建议写入代码注释与门禁）**：
1. `active_run_pointer` **唯一**回答"现在读哪个 run"；⛔ 不得由 `run_history` 推断。
2. `run_history` **唯一**回答"历史上有哪些 run"；⛔ 不得由 pointer 重建时间线。
3. `run_history` **一行一 run、一次写入、永不更新**（严格 append-only）。

---

## 2.3 ★ 实施进度 `[AS-IS]`（2026-09-29 更新）

> ⚠️ 本节由实施侧追加，记录**实际落地形态**。上表"当前状态"列是**冻结时的现状**，
> 已由本节取代；两者不一致时以本节为准（并在表格中保留冻结原貌以便追溯）。

| WP | 状态 | 实际落地形态 | 专项测试 |
|---|---|---|---|
| **WP-RH0** Architecture Freeze | ✅ **完成** | 三份文档（架构 / 决策 / 本文件） | — |
| **WP-RH1** Contract Registry | ✅ **完成** | ⚠️ **走了 OD-5 的替代路径**（见 2.3.1） | `tests/v365-rh1-contract-registry.test.js`（E-01~E-12） |
| **WP-RH2** Run Registry | ✅ **完成** | RDE 接线 `publishCandidateFirst()` + `run_history` 单次写入 | `tests/v365-rh2-runtime-fields.test.js`（F-01~F-12） |
| **WP-RH3** Promotion History | ✅ **完成** | supersede 链富化 + CAS 写后回读一致性上报 | `tests/v365-rh3-promotion-history.test.js`（G-01~G-11） |
| **WP-RH4** Historical Reader Migration | ✅ **完成（代码）** | CLASS C 5 读点登记 + `buildClassCProvenance`；⚠️ **数据侧仍 PENDING**（见 2.3.2） | `tests/v365-rh4-class-c-readers.test.js`（H-01~H-12） |
| **HD-10** 生产建表 | ✅ **完成（结构）** | 5/5 集合 + 7/7 索引（`CREATE EMPTY STRUCTURE ONLY`）；⚠️ **数据侧仍 PENDING**（见 2.3.2） | `tests/v365-hd10-authorization-boundary.test.js`（HD10-01~14：含完整 index signature 比对 + 零 mutation 守卫）· `scripts/v365-hd10-create-collections.js` |
| **WP-GEN1-HISTORY** | ⛔ **NOT_STARTED** | 独立立项，不阻塞 | — |

### 2.3.1 ⚠️ WP-RH1 实际形态 ≠ 本文件 §WP-RH1 的计划形态

本文件 §WP-RH1「修改文件」列原计划 **① `src/common/constants.js`（`COLLECTIONS` 29 → 33）**
**② `src/common/schema.js`（`SCHEMAS` 29 → 33）**。

**实际实施**改为 **OD-5 的本意路径**（`OD-5 Reason ①`：`v365-contracts.js` 是**唯一来源**）：

| 项 | 原计划 | **实际实现** |
|---|---|---|
| 集合名来源 | `constants.js` 复制 4 个名 | **`v365-contracts.js::V365_COLLECTIONS`（5 个，含 `run_history`）** |
| `constants.js` | 需 `29 → 33` | ✅ **零改动**（CALC / HD12-D8 **绝对保护**） |
| `schema.js` | 需 `29 → 33` | ✅ `SCHEMAS` 新增 5 个（`:739-852`），名取自 `V365_COLLECTIONS` |
| `schema-collections-parity.test.js` | 双向守卫 `constants ↔ SCHEMAS` | ✅ 已改为**双源并集**口径 + **断言两源不得重叠**（防双源漂移） |
| `v365-atomic-publish.js` | 删本地 `POC_COLLECTIONS`，保留别名 | ✅ 已按此实现（`:39-54`） |

**为什么偏离计划且更正确**：
1. 原计划的 `①②必须同时，否则 parity FAIL` 是**为双源方案付出的代价**；
   OD-5 的正确解法是**消除第二源**，而不是同步两个源 —— 后者仍需人工保持同步（正是 OD-5 要消除的风险）。
2. `constants.js` 属 **`DECISION_CALCULATION_CORE`（HD12-D8）**，**无授权路径**（`classify() === 'CALC'`，
   `isInProtectedDomain() === true`）⇒ 修改它需要**再次找 owner**，而**正确解法不需要改它**。
3. 实施侧的 `schema-collections-parity.test.js` 已把该偏离**固化为判据**：
   `⛔ 两个来源不得声明同名集合（防双源漂移）`。

⇒ **裁定**：本文件 §WP-RH1 的「修改文件 ①②」描述**已被实施取代**，属**方案级修正**，
非放宽标准（守卫强度**提高**：从"两侧同步"升级为"结构性单一来源 + 重叠即 FAIL"）。

**✅ 已执行（2026-09-29，owner 正式裁定 `HD-10_PRODUCTION_COLLECTION_CREATION = APPROVED`）**：
生产建表（CloudBase `createCollection` × 5）**已完成** —— 属 **CREATE EMPTY STRUCTURE ONLY**。

| 项 | 结果 |
|---|---|
| 集合 | **5/5**（`run_manifest` / `run_candidate_decision` / `run_candidate_portfolio` / `active_run_pointer` / `run_history`） |
| 索引 | **7/7**（与冻结 `schema.js` 逐名逐键一致，含 `idx_trade_date` desc / `idx_supersedes` asc） |
| 验证 | `read-after-create` 通过 · 独立复核通过 |
| `documents_written` | **0**（5 集合全部 `n=0`） |
| `production_run_triggered` | **false** |
| `pointer_initialized` | **false** |
| 证据 | `deliverables/v365-production-history/hd10/hd10-completion-evidence.json` |

> ⚠️ **建表 ≠ 数据就绪**：`CREATE EMPTY STRUCTURE ONLY` ⇒ 生产提升**未发生** ⇒ `RUN_HISTORY_INDEX` **仍 PENDING**（见 2.3.2）。

### 2.3.2 ⚠️ WP-RH4 代码完成 ≠ `RUN_HISTORY_INDEX` 完成（HD-10 后仍成立）

| 层 | 状态 | 说明 |
|---|---|---|
| **读者代码**（CLASS C 登记 + 双源 provenance） | ✅ **完成** | `v365-active-read.js::CLASS_C_READ_POINTS` + `buildClassCProvenance`；Reader Gate **8/8** |
| **契约结构**（5 集合 + 7 索引） | ✅ **完成** | HD-10 已建（`CREATE EMPTY STRUCTURE ONLY`） |
| **数据侧**（`run_history` 有连续数据） | ⛔ **PENDING** | 生产尚无 `active_run_pointer` 提升 ⇒ `run_axis_available = false` · `coverage = 'legacy_only'` |
| **切换日** | ⛔ **未登记** | `V365_ENFORCE_SWITCH_DATE = null`（**部署时**才登记） |

⇒ 如实状态：**`RUN_HISTORY_INDEX = PENDING`**（**契约、结构、读者就绪，数据未就绪**）。
⛔ 不得因为「RH1~RH4 测试全绿」或「HD-10 结构已建」就声称 `RUN_HISTORY_INDEX = COMPLETE` ——
**结构就绪 / 代码就绪 ≠ 数据就绪**（该区分由 RG-3 / CLASS C `run_axis_available` 显式承载）。

---

## 3. Migration Work Packages

> **合格面判据**：`ml/manifests/V365_CANDIDATE_MANIFEST.json` 的 `file_sha256` 覆盖 **20 个文件**，
> **不含 `docs/` 与 `scripts/`**。触碰 ⇒ `candidate_content_sha` 变 ⇒ **必须重新资格化**。

## WP-RH0 — Architecture Freeze

| 项 | 内容 |
|---|---|
| **范围** | 冻结架构与路线（本文件 + 前两份文档） |
| **修改文件** | `docs/V365_RUN_LIFECYCLE_ARCHITECTURE.md` · `docs/V365_RUN_LIFECYCLE_ARCHITECTURE_DECISION.md` · **本文件**（均 `docs/`） |
| **触碰 qualification candidate？** | ❌ **否**（`docs/` 不在 20 文件内） |
| **触碰 parity？** | ❌ **否**（不影响 replay 依赖集） |
| **Rollback** | 删除/还原文档即可，**零系统影响**（纯文档） |
| **状态** | ✅ 本阶段完成 |

## WP-RH1 — Contract Registry

| 项 | 内容 |
|---|---|
| **范围** | `constants` · `schema` · `init collections` · `V365_COLLECTIONS` 收敛（OD-5） |
| **修改文件** | **①** `src/common/constants.js`（`COLLECTIONS` 29 → 33，加 4 个 v365 集合）<br>**②** `src/common/schema.js`（`SCHEMAS` 29 → 33 + `run_history` 定义；⛔ 必须与 ① **同时**，否则 `schema-collections-parity.test.js` 双向守卫 FAIL）<br>**③** `scripts/init-collections.js`（**无需改** —— 已由 `SCHEMAS` 驱动，`:75-76`）<br>**④** `src/common/utils/v365-atomic-publish.js`（删 `POC_COLLECTIONS` → require `V365_COLLECTIONS` + 保留别名 + 修 `:39` 注释） |
| **触碰 qualification candidate？** | ✅ **是** —— ⚠️ **本文件原判「①②③ ❌ 否」有误**：`src/common/schema.js` **在** 20 文件内（`ml/manifests/V365_CANDIDATE_MANIFEST.json`）⇒ 实际形态为 **`schema.js` ✅ 在合格面 · `constants.js` ✅ 零改动 · `init-collections.js` ❌ 否 · `v365-atomic-publish.js` ✅ 是** ⇒ `candidate_content_sha` 变 ⇒ **必须重新资格化**（见 §2.3.1） |
| **触碰 parity？** | ❌ **否**（不涉及 `runDecisionEngine/index.js`；`v365-atomic-publish.js` 不在 replay 依赖集） |
| **Rollback** | ①②③：还原文件即可（**尚未写入任何数据** ⇒ 零数据风险）。<br>④：还原 `v365-atomic-publish.js`（别名机制 ⇒ 调用方无需同步回滚）。<br>⚠️ **若已执行生产建表**：集合可 drop，但**须先确认无数据**（本阶段应为空）。 |
| **⚠️ 需单独授权** | **生产建表**（CloudBase `createCollection` × 5：`run_manifest` / `run_candidate_decision` / `run_candidate_portfolio` / `active_run_pointer` / `run_history`）—— 属 **DB 变更**，⛔ 不在代码授权范围内 |
| **依赖** | WP-RH0 |

## WP-RH2 — Run Registry

| 项 | 内容 |
|---|---|
| **范围** | `run_history`（OD-1 A′）+ lifecycle writer（OD-3 A） |
| **子步骤（⛔ 顺序不可换）** | **R2-a** `runDecisionEngine/index.js:1317` / `:1526` **注释修正**（OD-6 批 1，零契约影响）<br>**R2-b** 3 处运行时字段修正（OD-6 批 2，additive + deprecated）—— **必须先于 R2-c**<br>**R2-c** 接线 `publishCandidateFirst()`（OD-3 A）<br>**R2-d** `run_history` 一次写入（OD-2 时序） |
| **修改文件** | `cloudfunctions/runDecisionEngine/index.js`（R2-a/b/c/d）· `src/common/utils/v365-run-integrity.js`（若需扩展 `publishCandidateFirst` 的 history 写入） |
| **触碰 qualification candidate？** | ✅ **是** —— 两者**均在** 20 文件内 ⇒ `candidate_content_sha` 变 |
| **触碰 parity？** | ✅ **是** —— `runDecisionEngine/index.js` **在 `DECISION_CORE` 内**（`v365-p12-decision-parity.js:141`）⇒ **结构性判据必然 FAIL**（见 §4.4） |
| **Rollback** | 还原 `runDecisionEngine/index.js` 至冻结 SHA ⇒ 回到"candidate 写、pointer 不切"状态。<br>⚠️ **已写入的 `run_history` 行成为孤儿** —— **无害**（本阶段无读者依赖）⇒ 可不回滚数据。<br>⚠️ **已提升的 pointer 不得回滚**（会让读者 fail-closed）⇒ rollback 只回代码，不回状态。 |
| **依赖** | WP-RH1（`run_history` 须先登记并建表） |
| **⚠️ 需单独授权** | 代码写入授权（RDE 在合格面内） |

## WP-RH3 — Promotion History

| 项 | 内容 |
|---|---|
| **范围** | `active_run_pointer` + promotion records（OD-2 内嵌 + supersede 链） |
| **修改文件** | `src/common/utils/v365-publish-store.js`（`compareAndSetPointer` 成功后触发 history 追加）· `src/common/utils/v365-atomic-publish.js`（`supersedes_run_id` / `same_trade_date_supersede` 落 `run_history`）· `cloudfunctions/runDecisionEngine/index.js`（传递 manifest 的 supersede 上下文） |
| **触碰 qualification candidate？** | ✅ **是** —— 三者**均在** 20 文件内 |
| **触碰 parity？** | ✅ **是**（含 RDE） |
| **Rollback** | 还原三个文件 ⇒ promotion 仍可发生（WP-RH2 已接线）但**不留 history**。<br>⚠️ 期间产生的 promotion **已生效且不可逆**（指针已切）；`run_history` 会出现"有 run 无提升记录"的空洞 ⇒ **须在台账显式登记该窗口**。 |
| **依赖** | WP-RH2（lifecycle writer 须先接线） |

## WP-RH4 — Historical Reader Migration

| 项 | 内容 |
|---|---|
| **范围** | CLASS C 5 个读点迁移 + 双源 provenance（OD-4 §附带后果） |
| **修改文件** | `cloudfunctions/apiGateway/index.js`（`getDecisions:667` · `getReview:776/784`）· `src/common/utils/cooldown.js`（`:25`）· `cloudfunctions/runIntegratedShadowEod/index.js`（`:220/222`）· `cloudfunctions/runGen1ShadowEod/index.js`（`:81-83`）· `src/common/utils/v365-active-read.js`（`ALLOWED_LATEST_READS` 重新登记） |
| **触碰 qualification candidate？** | ⚠️ **分步**：`apiGateway/index.js` ✅ **是** · `v365-active-read.js` ✅ **是** · 其余三个 ❌ **否** |
| **触碰 parity？** | ❌ **否**（`apiGateway` / `cooldown` / shadow readers 均**不在** `DECISION_CORE`，也不在 replay 依赖集） |
| **Rollback** | ⚠️ **本路线中风险最高** —— 还原读者 ⇒ 回到读 `decision_result`，而该集合**自切换日起已冻结**（OD-4 B）⇒ **历史断档**。<br>⇒ **缓解**：回滚**必须**保留双源读取中的 legacy 分支（即"只回滚新轴分支，不回滚 legacy 分支"）。<br>⇒ **前置**：迁移前须先确认 `run_history` 已有**足够连续**的数据。 |
| **依赖** | WP-RH3（须先有 history 数据） |

## WP-GEN1-HISTORY

| 项 | 内容 |
|---|---|
| **范围** | Gen-1 anchor **事件化**（authority 变更 / latch 变更 / guarded 计数跃迁），⛔ 不是快照 |
| **修改文件** | 待定（`cloudfunctions/runDecisionEngine/index.js` + 可能新增集合） |
| **触碰 qualification candidate？** | ⚠️ **是**（RDE 在 20 文件内；新增集合本身不在） |
| **触碰 parity？** | ⚠️ **是**（含 RDE） |
| **Rollback** | 还原 RDE + drop 新集合（独立于 run 生命周期 ⇒ 无跨 WP 影响） |
| **依赖** | **无**（独立立项；⛔ **不阻塞** WP-RH0~RH4） |
| **状态** | `REGISTERED` / `NOT_STARTED` |

## 依赖图

```
WP-RH0 ─▶ WP-RH1 ─▶ WP-RH2 ─▶ WP-RH3 ─▶ WP-RH4
                            ⛔ 跳级禁止

WP-GEN1-HISTORY  （独立，可并行，不阻塞任何 WP）
```

---

## 4. Qualification Strategy

## 4.1 三步（每 WP 完成后必须全做）

| 步骤 | 内容 | 判据 |
|---|---|---|
| **① requalification** | 重跑 `v365-qualification-gate.js` | **PASS 38 / 38** + `v365-reader-migration-gate.js` **PASS 8 / 8** |
| **② parity replay** | 重跑 `v365-p12-decision-parity.js` | **`UNEXPECTED_DECISION_DELTA = 0`** + anchor `25ccbfc7…1723` **逐位不变** |
| **③ manifest update** | 重算 `V365_CANDIDATE_MANIFEST.json`（20 文件的 `file_sha256` + `candidate_content_sha`） | `verify-v365-candidate-manifest.js` **PASS（20 文件逐字节一致）** |

**完整门禁清单（每 WP 后统一）**：
`verify-immutable` 23/23 · `verify-gen1-pipeline` 10/10 · `verify-gen2-build-artifacts` 7/7 ·
`v365-qualification-gate` 38/38 · `v365-reader-migration-gate` 8/8 ·
`verify-v365-candidate-manifest` 20 文件 · `Stage A` 59/59 · `v365-p12-decision-parity` **Δ=0**

## 4.2 逐 WP 的 qualification 需求

| WP | requalification | parity replay | manifest update |
|---|---|---|---|
| WP-RH0 | ❌ 不需要（docs） | ❌ | ❌ |
| WP-RH1 | ⚠️ **仅 ④ 需要**（①②③ 不在合格面） | ❌ | ⚠️ 仅 ④ |
| WP-RH2 | ✅ **必须** | ✅ **必须** | ✅ **必须** |
| WP-RH3 | ✅ **必须** | ✅ **必须** | ✅ **必须** |
| WP-RH4 | ✅ **必须**（部分文件） | ✅ **必须** | ✅ **必须** |
| WP-GEN1-HISTORY | ✅ **必须** | ✅ **必须** | ✅ **必须** |

## 4.3 ★ 为什么 `runDecisionEngine` 修改**不是**业务决策变化

**这是本路线最需要论证的一点**，因为 `runDecisionEngine/index.js` **在 `DECISION_CORE` 内**
（`v365-p12-decision-parity.js:129-142`），而该判据是**绝对**的（`touchedCore.length === 0`）。

### 论证（三条，均为可核验证据）

**① 行为判据（权威）**：`UNEXPECTED_DECISION_DELTA = 0`
- 判据来源：`v365-p12-decision-parity.js` 第 (2) 段 —— **replay 两次**，比较决策序列 sha256。
- 当前实测：两次均为 `25ccbfc7e1b73a9a173ec36c17512c6228a2fe42685dcd291bc055ea4ed11723` ⇒ **逐位一致**。
- 这是 MEMORY.md 记录的**最强证明形式**（"跨树同度量对照"）；⛔ 弱于它的任何论证不足以替代。

**② 改动性质（范围受限）**：WP-RH2/RH3 的 RDE 改动**全部落在决策计算之外**
| 改动 | 位置 | 与决策计算的关系 |
|---|---|---|
| 注释修正 | `:1317` / `:1526` | 零（注释） |
| 运行时字段修正 | `:1511` / `:1552` / `:1557` | **只读字段**，`runtime_status` 与响应体；不参与任何判据 |
| lifecycle writer 接线 | 决策**之后**（`:1318` 之后） | 写侧：manifest / promotion / history —— ⛔ **不触碰** `final_target` / `final_action` / `trend_stage` |
| promotion history | 同上 | 同上 |

**③ 计算核心零改动（可核验）**：`DECISION_CORE` 的**其余 11 个文件**（`decision.js` · `decision-v3.js` ·
`trend-stage.js` · `correlation.js` · `defense.js` · `swing-structure.js` · `v3-6-stage-persistence.js` ·
`market-regime.js` · `indicators.js` · `portfolio-mode.js` · `portfolio-cash.js`）在本路线中**全程零改动**。

### 结论

⇒ **`runDecisionEngine/index.js` 是"编排层"，被 `DECISION_CORE` 收录是保守过近似。**
它对决策的影响**只能**通过其调用的计算模块传导，而后者零改动 + replay anchor 逐位不变 ⇒ **不是业务决策变化**。

## 4.4 ⚠️ 由此暴露的一个**门禁缺陷**（**已解除**）

`v365-p12-decision-parity.js` 对**依赖集交集**有例外机制，但对 `DECISION_CORE` **没有**：

| 判据 | 例外机制 | 证据 |
|---|---|---|
| 改动文件 vs 回放依赖集交集 | ✅ **有** —— `ALLOWED_EXCEPTIONS = new Set(['src/common/utils/v361-run-context.js'])`，且**附证明义务**（扫描 `cloudfunctions/*/index.js` 的 require 数必须为 0） | `v365-p12-decision-parity.js:101-125` |
| **`DECISION_CORE` 零改动** | ❌ **无** —— 硬编码 `touchedCore.length === 0`，无白名单 | 同上 `:128-145` |

⇒ **后果**：传 `--changed-file` 清单时，该脚本**必然 exit 1**（已实测：
`[FAIL] 决策核心文件零改动 — 被改动: cloudfunctions/runDecisionEngine/index.js`）。
这不是回归，而是**判据无法表达"授权修改"**。

**[REC] 建议在 WP-RH2 之前先做一次门禁加固**（可作为 WP-RH1 的第 ⑤ 项）：
把 `DECISION_CORE` 拆为 **`DECISION_CALC`（11 个计算模块，仍绝对零改动）** 与
**`DECISION_ORCHESTRATION`（`runDecisionEngine/index.js`，允许带**显式授权 + 证明义务**的改动）**；
证明义务参照既有 `ALLOWED_EXCEPTIONS` 模式（例如：必须同时提供 `Δ=0` 的 replay 结果）。

### 4.4.1 ★ 实际解法（已实施，2026-09-29）—— 比 HD-12 的建议更严格

**未**采用「拆 `DECISION_CORE` + 白名单」的建议（那会**放宽** `touchedCore.length === 0`），
而是**保留该硬判据不动**，改为**扩展 REPLAY_INFRA 授权域**：

| 判据 | 修改前 | **修改后** |
|---|---|---|
| 改动 ∩ 回放依赖集 | 例外只有 `ALLOWED_EXCEPTIONS`（1 文件） | 排除 `REPLAY_INFRA_SET`（`CLASSIFICATION.infraFiles()`） |
| `DECISION_CORE` 零改动 | 硬编码 `touchedCore.length === 0` | ✅ **保持不变**（仍为绝对判据） |
| RDE 改动如何放行 | ❌ **无路径** | ✅ 走 **`MIXED` 授权**：`--approval-manifest` 的 `zone_declaration` + **区域包含性**证明 |

**为什么原计划「恒不可达」**：REPLAY_INFRA 文件（`v364-replay-harness.js`）**必然 ∈ 回放依赖集**
⇒ 「改动 ∩ 回放依赖集」**结构性**命中 ⇒ 即使授权合法也必 FAIL。
⇒ 这是**判据的结构性缺陷**，不是安全设定；排除 `REPLAY_INFRA_SET` 后仍由**授权判据**接管（未被绕过）。

**实测结果**（`--changed-file` 67 项 / `--changed-region` 144 区域 / `--approval-manifest` 带 `zone_declaration`）：

```
交集 = ["scripts/lib/v364-replay-harness.js"]
[PASS] 改动文件与回放依赖集的交集仅含白名单项 — 无未预期交集
[PASS] 受保护文件变更已授权 — APPROVED
[INFO] 全部 17 个改动区域均落在声明的 zone 内：["lifecycle_writer","telemetry"]
[PASS] 受保护域内无未登记文件（protected-domain fail-closed）
第 1 次 / 第 2 次决策序列 sha256 = 25ccbfc7…1723（逐位一致）
结论：UNEXPECTED_DECISION_DELTA = 0
      parity_anchor_sha256 = 25ccbfc7e1b73a9a173ec36c17512c6228a2fe42685dcd291bc055ea4ed11723
```

⇒ **HD-12 关闭**（不拆 `DECISION_CORE`；改用授权域扩展 + `MIXED` zone 声明，**强度更高**：
`DECISION_CORE` 仍是绝对判据，**没有**新增任何白名单进入决策核心）。

---

## 5. Deployment Order

```
┌─ Development ────────────────────────────────────────────────────────┐
│  分支 feat/v365-production-integrity-impl 上按 WP 顺序实施            │
│  · 每 WP 完成后：§4.1 三步（requalification / parity / manifest）     │
│  · ⛔ 不 push、不 PR、不 merge（除非 owner 当轮授权）                   │
└──────────────────────────────────────────────────────────────────────┘
                              │ 全部 WP 完成 + 全门禁绿
                              ▼
┌─ Validation ─────────────────────────────────────────────────────────┐
│  · Stage A 59/59 · 8 项门禁全绿 · Δ=0                                │
│  · 跨树同度量对照（baseline worktree，须复制 gitignored `deliverables/`）│
│  · 读者契约 backward-compat 复核（CLASS A 不受影响 / CLASS C 分段）    │
│  · ⛔ 未过 Validation ⇒ 不得进入 Frozen                              │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─ Frozen ─────────────────────────────────────────────────────────────┐
│  · 生成 tag（如 `v3.6.5-frozen`）                                    │
│  · 候选包 **必须** `git archive <frozen-sha> | tar -x` 再 build       │
│    ⛔ 不用审计分支、不用未提交工作区                                   │
│  · 部署前预检：`UNEXPECTED_PACKAGE_DIFF = 0`                          │
│  · 写 `docs/production-deployment-ledger.md`（append-only）           │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─ Production ─────────────────────────────────────────────────────────┐
│  · 部署（需 owner 逐位绑定 40 位 SHA 的显式授权）                      │
│  · 部署后**只读**核验云函数 `ModTime`（⛔ 不为验幂人为触发生产）        │
│  · 追加台账行 D-xxx（字段照抄既有格式）                                │
└──────────────────────────────────────────────────────────────────────┘
```

## ⛔ 禁止跳级（硬约束）

| 跳级 | 为什么禁止 |
|---|---|
| Development → Frozen | 未经 Validation ⇒ 门禁未跑全 ⇒ 可能带着 `Δ≠0` 封版 |
| Development → Production | 同上，且未封版 ⇒ 无 `frozen-sha` ⇒ 无法 `git archive` 取干净包 |
| Validation → Production | 未封版 ⇒ 无 tag ⇒ 部署源不可追溯（违反既有部署纪律） |
| Frozen → Production（跳过台账） | 台账是 **append-only 审计**；缺失 ⇒ 部署事实不可核 |

## 与既有部署纪律的一致性 `[AS-IS]`

| 既有纪律 | 出处 | 本路线 |
|---|---|---|
| 候选包必须 `git archive <frozen-sha> \| tar -x` 再 build | MEMORY.md · 台账 D-004 | ✅ 保留（Frozen 阶段） |
| 部署前 `UNEXPECTED_PACKAGE_DIFF = 0` | 台账 D-004 | ✅ 保留 |
| 部署后**只读**核验 `ModTime` | MEMORY.md · 台账 D-005 | ✅ 保留 |
| ⛔ 不为验幂人为触发生产 | MEMORY.md | ✅ 保留 |
| 台账 append-only + `supersedes: D-xxx` | 台账 §3 | ✅ 保留 |

---

## 6. Open Human Decisions

> 仅保留**真正需要人工确认**的问题。已由本阶段冻结的 OD-1~OD-7 不再列出。
> ⚠️ 2026-09-29 更新：已解除项标 `[CLOSED]`，并列出**实施侧已采取**的形态（便于核验）。

| # | 问题 | 状态 | 结论 / 实况 |
|---|---|---|---|
| **HD-8** | `run_manifest` 与 `run_history` 是否**同一张表**？ | ✅ `[CLOSED]` | **不同表**。`run_manifest` = ① candidate 层（run 内部完整性）；`run_history` = ⑤ history 层（timeline）。理由：职责不同层（§2.1），且 OD-2 已裁定 promotion 信息**内嵌 `run_history`** 而**非**并入 manifest ⇒ 合并会破坏「manifest 写入后不变 / history 只追加」两种不同可写性契约。**建表形态 = 5 张**。 |
| **HD-9** | `run_history` 的**保留窗口 / 归档策略**？ | ✅ **CLOSED**（`RETAIN_INDEFINITELY_FOR_V365`：⛔ 不自动删 / 不归档 / 无 TTL / 不压缩；⛔ 当前不实现 retention worker） | 存储成本与合规；当前无消费者提出需求。⛔ 不得用「定期快照」伪造历史（OD-7 已禁止同类做法）。 |
| **HD-10** | ★ **生产建表授权**：`run_history` + 4 个 v365 集合是否批准在 CloudBase 创建？ | ✅ `[CLOSED]` — **已执行 CREATE EMPTY STRUCTURE ONLY** | **owner 2026-09-29 正式裁定 `HD-10_PRODUCTION_COLLECTION_CREATION = APPROVED`**（`authorization_sha = c6bd006f…`）。已建 5/5 集合 + 7/7 冻结索引（`read-after-create` 验证通过 · `documents_written = 0` · `production_run_triggered = false` · `pointer_initialized = false`）。证据：`deliverables/v365-production-history/hd10/hd10-completion-evidence.json`。⚠️ **建表 ≠ 数据就绪** ⇒ `RUN_HISTORY_INDEX` 仍 PENDING（生产提升未发生 / `V365_ENFORCE_SWITCH_DATE = null`）。 |
| **HD-11** | 是否接受 WP 依赖顺序 `RH0 → RH1 → RH2 → RH3 → RH4`（RH2 内 `a→b→c→d` 不可换）？ | ✅ `[CLOSED]` | **已接受并遵守**（`F-11` / `G-09` 已把时序固化为判据：提升点(47957) < history 写入点(50366)）。 |
| **HD-12** | ★ 是否**先加固 parity 门禁**（拆 `DECISION_CORE`）？ | ✅ `[CLOSED]` — **采用更严方案** | **不拆 `DECISION_CORE`**（拆 = 放宽硬判据）。改为：保留 `touchedCore.length === 0` 不动 + 扩展 `REPLAY_INFRA_SET` 例外 + RDE 走 `MIXED` 授权（`zone_declaration` + 区域包含性）。见 **§4.4.1**。实测 `Δ=0`。 |
| **HD-13** | `v365-atomic-publish.js:39` 的失效注释是否随 WP-RH1 ④ 一并修正？ | ✅ `[CLOSED]` | **已修正**（`:39-46` 现为 OD-5 单一来源说明 + 「⛔ 不得在本文件重新硬编码集合名」）。`E-12` 守卫「无硬编码集合名字面量」。 |
| **HD-14** | 是否**现在**就授权开始 WP-RH1？ | ✅ `[CLOSED]` | 已由 owner 的 REPLAY_INFRA 显式授权（`authorization_sha = c6bd006f…`）覆盖；RH1~RH4 已实施并全门禁绿（§2.3）。⚠️ **`HD-10`（生产建表）已随 2026-09-29 owner 裁定 CLOSED**（5/5 集合 + 7/7 索引已建）；但 **`RUN_HISTORY_INDEX` 数据侧仍 PENDING**（生产提升未发生）。 |

### 6.1 ⛔ 仍待 owner 拍板的项（收口前必须回答）

| # | 问题 | 为什么 agent 不能自决 |
|---|---|---|
| ~~**HD-10**~~ | ~~生产建表（5 个 v365 集合）~~ | ✅ **已裁定并执行**（2026-09-29 `APPROVED`，`CREATE EMPTY STRUCTURE ONLY`） |
| ~~**HD-9**~~ | ~~`run_history` 保留窗口 / 归档策略~~ | ✅ **CLOSED**（owner 裁定 `RETAIN_INDEFINITELY_FOR_V365`） |
| ~~**HD-15**~~（新） | ~~**`V365_ENFORCE_SWITCH_DATE`** 登记时点~~ | ✅ **POLICY CLOSED**（`APPROVED`：只冻结时点规则；值仍 `null`，= 首个真实 authoritative ENFORCE production run 的 `expected_trade_date`）。⛔ agent 不得预填（会**伪造双源**） |
| ~~**F2-C / RFP-V2-PH**~~ | ~~路径 A / C~~ | ✅ **已裁定 `OWNER_F2C_PATH = A`**（逐条比对 6/6）：保留原窗口 + 不补造 + 允许诊断 + full-window 继续 fail-closed。⛔ 仍**不得**关闭 F2-C / PH blocker |

---

## 7. 实施侧收口状态 `[AS-IS]`（2026-09-29）

| 门禁 | 结果 |
|---|---|
| **Stage A**（`tests/*.test.js`） | **71 / 71 PASS** |
| **Stage A~G**（`node scripts/test-all.js`） | **79 / 79，0 失败** |
| `v365-qualification-gate.js` | **PASS 38 / 38** |
| `v365-reader-migration-gate.js` | **PASS 8 / 8** |
| `verify-v365-candidate-manifest.js` | **20 文件逐字节一致**（`candidate_content_sha = 2f4b0519…2cade`） |
| `v365-p12-decision-parity.js`（带授权清单） | **`UNEXPECTED_DECISION_DELTA = 0`** · anchor `25ccbfc7…1723` 逐位不变 |
| `verify-immutable.js` | **23 / 23** |
| `verify-gen1-pipeline.js` | **10 / 10** |
| `verify-gen2-build-artifacts.js` | **7 / 7** |
| Gen-1 Production Gates | **32 / 32** |
| RH1 / RH2 / RH3 / RH4 专项 | **E-01~12 / F-01~12 / G-01~11 / H-01~12 全 PASS** |

```
HD-10                    = COMPLETE（2026-09-29 owner APPROVED；5/5 集合 + 7/7 索引；CREATE EMPTY STRUCTURE ONLY）
HD-10 不授权且未做       = 业务写入 / backfill / pointer init / deploy / drop / index 修改 / 迁移
HD-9                     = CLOSED（RETAIN_INDEFINITELY_FOR_V365；⛔ 不删 / 不归档 / 无 TTL / 不压缩）
HD-15                    = POLICY CLOSED（只冻结时点规则；V365_ENFORCE_SWITCH_DATE 仍 null）
RUN_HISTORY_INDEX        = PENDING（契约 + 读者就绪 + 5 集合已建；⛔ 数据侧仍未就绪：生产提升未发生 / switch_date=null）
                           属 POST-ACTIVATION / FIRST-NATURAL-RUN ACCEPTANCE
V365_ENFORCE_SWITCH_DATE = null（首个真实 authoritative ENFORCE production run 的 expected_trade_date；⛔ 非建表/代码/授权/测试日期）
REPLAY_INFRA             = OWNER_AUTHORIZATION=APPROVED @ c6bd006f…（HEAD 绑定）
RPG-002                  = NOT YET CLOSED
RPG-F2-B                 = PARTIAL / BLOCKED_ON_EXECUTION_COVERAGE
RPG-F2-C                 = BLOCKED_ON_ACTUAL_BOOK_COVERAGE
OWNER_F2C_PATH           = A（保留原窗口 + 不补造 + 允许诊断 + full-window 继续 fail-closed）
RFP-V2-PH_FULL_WINDOW_AVAILABLE = false
UNEXPECTED_DECISION_DELTA       = 0（parity anchor 25ccbfc7…1723 未变）
PRODUCTION_ACTIVATION_AUTHORIZATION = NOT_GRANTED
READY_FOR_PRODUCTION_PROMOTION  = NOT_ISSUED
```

---

## 8. 本轮边界履行 `[AS-IS]`

| 项 | 实况 |
|---|---|
| 代码（RH1~RH4）/ schema / RDE 接线 | ✅ **已实施**（属 owner 授权范围） |
| `constants.js`（CALC） | ✅ **零修改**（OD-5 替代路径 + `E-03` / `G-11` 守卫） |
| **HD-10 生产建表（5 集合 + 7 索引）** | ✅ **已执行**（2026-09-29 owner `APPROVED`；`CREATE EMPTY STRUCTURE ONLY`；`documents_written = 0`） |
| **生产业务写入 / backfill / pointer init / deploy** | ⛔ **均未发生** |
| **F2-C 取证（分页复核 / 全量拉取）** | ✅ **只读**完成（`count == returned` ⇒ `pagination_complete = true`；结论：生产库最早 = `2026-08-14`） |
| 仓库 HEAD | 仍 `c6bd006fd76ffc5358cddd07347df8ed23d9e61d`（全程未变 ⇒ 授权仍有效） |
| 生产侧 | ✅ **已连接**（`tcb` CLI 3.8.1 已登录，env `tradingview-etf-d0fa42yy57cbc11b`，状态 `Normal`）；集合总数 27 → **32** |

---

## 附：本路线对前两份文档的**承接与修正**

| # | 前文 | 本路线 |
|---|---|---|
| 1 | 架构文档 §8 的 RH1 含"写侧接线"；决策文档 §3 建议前插 OD-6 | 本路线按**任务给定的 WP 划分**重排为 `WP-RH1（纯契约登记）→ WP-RH2（run_history + lifecycle writer，内含 OD-6 批1/批2 子步骤）` |
| 2 | 决策文档 §4 未覆盖"parity 门禁的 `DECISION_CORE` 无例外机制" | 本路线 **§4.4** 登记为门禁缺陷；**§4.4.1** 记录实际解法（保留硬判据 + 扩展 REPLAY_INFRA 授权域），**HD-12 关闭且未放宽标准** |
| 3 | 决策文档 HD-8 / HD-9 标注"未评" | **HD-8 已定案（不同表 / 5 张）**；**HD-9 已 CLOSED**（`RETAIN_INDEFINITELY_FOR_V365`） |
| 4 | §WP-RH1「修改文件」列要求改 `constants.js` / `schema.js` | **实施侧走 OD-5 本意路径**：集合名收敛到 `v365-contracts.js`，`constants.js` 零改动。见 **§2.3.1**（方案级修正，守卫强度提高） |
| 5 | 本文件冻结时 §2.2「当前状态」列 | 已由 **§2.3 实施进度** 取代（冻结原貌保留以便追溯） |
