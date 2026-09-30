# V3.6.5 Prospective Production Qualification Design

> **文档类型**：owner 裁定阶段设计件（`PROSPECTIVE_PRODUCTION_QUALIFICATION_DESIGN`）
> **生成时刻**：2026-09-29
> **HEAD**：`c6bd006fd76ffc5358cddd07347df8ed23d9e61d`（**全程未变**）
> **结论**：`PROSPECTIVE_DESIGN = COMPLETE` —— ⛔ **仅设计，不执行 production activation**
> **关联**：`docs/V365_PRODUCTION_READINESS_LEDGER.md`（阶段日志 C-019）· `docs/V365_CONTEXT_COMPRESSION.md` · `docs/V365_FREEZE_REVIEW.md` · `docs/V365_RUN_LIFECYCLE_IMPLEMENTATION_ROADMAP.md`

---

## 0. 一句话

**历史窗口的永久性数据缺失，不是实现缺陷，而是源系统事实；因此引入一条与旧历史 replay 完全独立的「前瞻资格化」路径 —— 用未来的真实生产历史完成资格化，而不是伪造过去。**

---

## 1. Deadlock Statement（治理死锁陈述）

### 1.1 死锁构造

```
aim:  READY_FOR_PRODUCTION_PROMOTION
needs: RFP-V2-PH full-window（2026-08-01 → 2026-09-22）production-historical qualification PASS
needs: 生产库中该窗口的 required actual execution/actual book 记录
fact:  生产库 earliest = 2026-08-14（trade_log 13 行 · portfolio_snapshot 40 行，count == returned 分页完整）
fact:  required = 25 个 replay 交易日；available = 16；missing = 9（2026-08-03 → 2026-08-13）
fact:  t_minus_1_candidate = null
⇒ missing 数据 HISTORICAL_SOURCE_DATA_DOES_NOT_EXIST（**永远**不会出现）
⇒ 旧路径 **永久** 无法收口
```

### 1.2 为什么不能"补"

| 禁止手段 | 为什么禁止 |
|---|---|
| synthetic execution 当 production-historical | 混淆 **Model A**（decision implies execution，**REJECTED**）与 **Model B**（explicit actual execution ledger，**ADOPTED**） |
| `suggested_position` 当 actual position | 语义不同：suggested 是**建议**，actual 是**已执行** |
| 插值 / 回填 / 假设 `position = 0` | 伪造 provenance；会把 6 处 UNEXPECTED 静默吞掉 |
| 缩短 / 重解释旧窗口 | 违反 owner 冻结裁定（§1） |
| 扩大 attribution taxonomy | 冻结仅两条：`effective_tech_cap_fidelity` / `cooldown_gate_exercised`；其余一律 `UNEXPECTED`（fail-closed） |

### 1.3 死锁的正确解法

⛔ **不是**「想办法让旧窗口 PASS」，而是：

```
承认旧窗口永久 INCOMPLETE_BY_SOURCE_HISTORY（保留 provenance）
        +
另建一条**前瞻**路径：用**未来**真实生产 run 累积真实历史
        +
两条路径的结论**各自独立、命名分离、互不篡改**
```

---

## 2. Historical vs Prospective Split（历史 / 前瞻 彻底分离）

### 2.1 双轨定义

| 维度 | **HISTORICAL（旧轨）** | **PROSPECTIVE（新轨）** |
|---|---|---|
| 窗口 | `2026-08-01 → 2026-09-22`（**冻结**） | 从 `PROSPECTIVE_EPOCH` 起（见 §4） |
| 数据来源 | 生产库既有历史（**已穷尽**） | 未来真实生产 run |
| 协议 | `RFP-V1` · `RFP-V2-CF` · `RFP-V2-CF-COOLDOWN` · `RFP-V2-AE` · `RFP-V2-PH`（diagnostic） | `RFP-V2-PH-PROSPECTIVE` |
| 状态 | ⛔ `INCOMPLETE_BY_SOURCE_HISTORY`（**永久**） | `NOT_STARTED` |
| 可否改结论 | ⛔ **永不** | 随真实数据演进而更新 |
| Δ 口径 | `RPG_F3_HISTORICAL_UNEXPECTED_DECISION_DELTA = 6` | `RPG_F3_PROSPECTIVE_UNEXPECTED_DECISION_DELTA`（目标 0） |

### 2.2 旧轨永久保留的 provenance（⛔ 不得改写为 PASS）

```text
RFP-V2-PH-HISTORICAL
FULL_WINDOW_STATUS = HISTORICAL_FULL_WINDOW_INCOMPLETE
CAUSE              = required actual production history did not exist in source system
CLASSIFICATION     = UNAVAILABLE_BY_HISTORICAL_FACT
                     ⛔ 不是 FAIL_DUE_TO_IMPLEMENTATION
```

**继续保持（⛔ 不得篡改）：**

```text
RPG-F2-B                       = PARTIAL / BLOCKED_ON_EXECUTION_COVERAGE
RPG-F2-C                       = BLOCKED_ON_ACTUAL_BOOK_COVERAGE
RFP-V2-PH_FULL_WINDOW_AVAILABLE = false
RPG_F3_HISTORICAL_UNEXPECTED_DECISION_DELTA = 6
  = V2-CF-COOLDOWN 1 + V2-AE 5
```

### 2.3 ⛔ 特别禁止（对旧轨）

```text
把 6 个 UNEXPECTED 改名为 EXPECTED
扩大 attribution taxonomy
用 synthetic execution 解释
用 suggested_position 补 actual
假设 position = 0
backfill
插值
缩短 / 重解释旧窗口
```

---

## 3. RFP-V2-PH-PROSPECTIVE 协议

### 3.1 协议登记

```text
protocol_version      = RFP-V2-PH-PROSPECTIVE
replay_semantics      = PRODUCTION_HISTORICAL_PROSPECTIVE
qualification_authoritative = false          ← 初始强制
```

**升格条件**：仅当 **完整 prospective qualification gate 全部满足**（§9 窗口 + §8 关闭规则 + §12 Δ=0）后，方可由 owner 裁定升格。⛔ agent 不得自行升格。

### 3.2 Anchor 独立性（⛔ 不得复用）

新协议必须有 **独立 anchor**，⛔ **绝不复用**：

```text
RFP-V1              anchor = 25ccbfc7…1723  （禁用）
RFP-V2-CF           anchor = b87654ab…8832  （禁用）
RFP-V2-CF-COOLDOWN  anchor = 0db3193b…be4f5  （禁用）
RFP-V2-AE           anchor = 5c8fb4ae…b661d  （禁用）
```

**⛔ 理由**：anchor 是「该协议下决策序列的指纹」。若复用旧 anchor，等于宣称新协议与旧协议决策序列逐位相同 —— 那是**伪造等价性**。

### 3.2.1 ★★ 两层 anchor（C-020 §2 / OD-P-2 = APPROVED_WITH_CORRECTION）

> ⛔ **关键更正**：`RESULT_SEQUENCE_SHA` **不得单独**作为 production-historical qualification anchor。
> 它只是 **result sequence 的标识**，可命名为 **`result_sequence_sha`**；
> 真正的资格锚由 **`PROSPECTIVE_QUALIFICATION_ANCHOR`** 承载。

**第一层：`result_sequence_sha`（仅标识，⛔ 不得单独作 qualification anchor）**

```text
result_sequence_sha =
  sha256(
    expected_trade_date:
    run_id:
    decision_sequence_sha256
  )
```

**第二层：`PROSPECTIVE_QUALIFICATION_ANCHOR`（★ production-historical qualification anchor）**

至少绑定下列全部字段（⛔ **不得减少**；如实际 contract 需要其它数据源，**可增加**）：

```text
PROSPECTIVE_QUALIFICATION_ANCHOR.sha256 =
  sha256( 规范化串接下列键值对（键字典序） )

  ── 协议与窗口 ──
  protocol_version
  replay_semantics
  prospective_epoch
  window_start
  window_end

  ── 真实数据集（actual datasets） ──
  trade_log_dataset_sha
  portfolio_snapshot_dataset_sha
  run_history_manifest_sha

  ── 代码与实现（production code / replay implementation） ──
  production_code_sha
  replay_harness_sha
  coverage_manifest_sha

  ── 结果序列（result sequence） ──
  result_sequence_sha
```

**★ 强制不变量**：

```text
same qualification anchor
  ⇒ same protocol
  + same actual datasets
  + same production code
  + same replay implementation
  + same result sequence
```

⇒ ⛔ **不得**用「仅绑定 decision sequence」的弱版本（那是 OD-P-2 明确拒绝的形态）。
⛔ `PROSPECTIVE_QUALIFICATION_ANCHOR` 也不得复用 §3.2 四个旧 anchor 的任一 sha。

机器守卫：`validateProspectiveAnchor()`（P-20 / P-21 / P-31 断言）。

**初始值**：`result_sequence_sha = null` / `PROSPECTIVE_QUALIFICATION_ANCHOR = null`（尚无 prospective run）；
首个成功 run 后，才由该 run 的真实数据 + 代码 sha + 序列 sha 计算得出。

### 3.3 协议状态机

```
NOT_STARTED ──(首个成功的 authoritative ENFORCE run)──▶ EPOCH_ESTABLISHED
                                                        │
                                                        ▼ 逐 run 累积
                                                    ACCUMULATING
                                                        │
                                          (窗口达 §9 OD-P-1 值 且 §8/§12 全满足)
                                                        ▼
                                                  GATE_ELIGIBLE
                                                        │
                                                        ▼ (owner 裁定)
                                                  QUALIFIED (qualification_authoritative=true)
```

⛔ 任一状态遇到 §7 失败条件 ⇒ **FAIL CLOSED**，退回上一稳定状态（`EPOCH` 已建立则保留 epoch，仅该 run 作废）。

---

## 4. PROSPECTIVE_EPOCH 定义

### 4.1 正式定义

```text
PROSPECTIVE_EPOCH =
  第一个真实成功成为 authoritative 的 V3.6.5 ENFORCE production run
```

该 run 必须**同时**满足：

```text
① CAS promotion succeeded
② active_run_pointer 已成为该 run（scope 正确 · revision 正确）
③ run_history 已按冻结 OD-2 时序落盘
④ read-after-write consistent = true
```

满足后**才**登记：

```text
V365_ENFORCE_SWITCH_DATE = 该 run.expected_trade_date
```

### 4.2 ⛔ epoch 的起点不是

| 不是 | 理由 |
|---|---|
| `2026-08-14` | 那是生产库**最早记录日**，不是"未来第一个真实 success run" |
| 当前日期（2026-09-29） | 那是**设计日**，⛔ 不是 run 日 |
| HD-10 建表日 | 结构创建 ≠ 数据产生 |
| 代码完成 / 授权 / 测试日 | 均与 run 无关 |

### 4.2.1 ★ OD-P-4 时点规则（owner 裁定）

```text
PROSPECTIVE_EPOCH 的 expected_trade_date
  =
  owner 授权 CONTROLLED_PRODUCTION_ACTIVATION 后
  第一个正常计划执行且市场数据完整的自然交易日
```

⛔ **不得**：

| 禁止 | 说明 |
|---|---|
| 回溯日期 | ⛔ 不得把 epoch 往前挪去"多攒覆盖" |
| 人为挑一个历史表现好的日期 | ⛔ 选择偏差 |
| 用测试日期 | ⛔ 测试 run ≠ 自然 run |
| 用设计日期 | ⛔ 设计日不是 run 日 |

**登记 `V365_ENFORCE_SWITCH_DATE` 仍须**（顺序不可跳过）：

```text
① 首次 run 真正 promotion success
② run_history 完整（see §5.1 PROMOTED_HISTORY_INCOMPLETE 恢复）
③ A-01~A-10 全绿
⇒ 之后才登记 switch date
```

### 4.3 失败处理

```text
首次 promotion 失败
  ⇒ PROSPECTIVE_EPOCH   = NOT_STARTED
  ⇒ V365_ENFORCE_SWITCH_DATE = null      ← 回到 null，⛔ 不得预填
  ⇒ RUN_HISTORY_INDEX   保持 PENDING
```

⚠️ **区分两类失败**（★ C-020 §3，详见 §5.1）：CAS 未成功 vs CAS 成功但 history append 失败。
后者 **promotion 已发生** ⇒ ⛔ 不得声明"不写 pointer"，须进入 `PROMOTED_HISTORY_INCOMPLETE` 恢复协议。

---

## 5. 冻结 OD-2 时序（⛔ 不得改写）

继续遵守冻结顺序：

```text
① candidate 写齐
② manifest / finality
③ CAS promotion attempt
④ promotion result confirmed
⑤ run_history 单次 append
⑥ authoritative pointer 状态可读
```

⛔ **严禁改成** `run_history → promotion`。
⛔ **严禁**为了设计 prospective protocol 而改写 lifecycle architecture。

> 依据：`docs/V365_RUN_LIFECYCLE_ARCHITECTURE_DECISION.md` OD-2 · Ledger C-008/C-009。

### 5.1 ★★ CAS-success / history-failure 恢复语义（C-020 §3）

冻结 OD-2 时序**保持不变**；在 `③ CAS promotion attempt` 与 `⑤ run_history append` 之间**必须区分两类失败**。

#### A. CAS 未成功 ⇒ `CAS_REJECTED`

```text
CAS_REJECTED
  ⇒ pointer 不变（不修改 active_run_pointer）
  ⇒ run promoted = false
  ⇒ 按冻结规则记录 rejected history
  ⇒ switch date = null
  ⇒ PROSPECTIVE_EPOCH = NOT_STARTED
  ⇒ STOP
```

#### B. CAS 已成功，但 run_history append 失败 ⇒ `PROMOTED_HISTORY_INCOMPLETE`

⛔ **不得声明"不写 pointer"** —— **pointer promotion 已经发生**。

**恢复协议**（严格按序）：

```text
1. 禁止再次 promotion
2. read active_run_pointer
3. 确认 pointer == 本 run
4. 以 uk_run_id 查询 run_history

5a. 无 history
    ⇒ 幂等补写同一 immutable history row
5b. 已有完全一致 history
    ⇒ 视为 retry / recovery success
5c. 已有不同内容
    ⇒ HISTORY_IMMUTABILITY_CONFLICT
    ⇒ HARD STOP

6. history 恢复成功
    ⇒ 再执行 First Natural Run Acceptance（A-01~A-10）

7. 在 A-01~A-10 全绿前：
   switch date 仍不得登记
   prospective qualification 不得开始累计
```

⛔ **除非存在独立冻结的 rollback CAS 协议，不得自动把 pointer 回滚。**

机器守卫：`evaluateCasHistoryRecovery()`（P-22 / P-23 / P-24 / P-30 断言）。

---

## 6. Controlled Production Activation Gate

### 6.1 与 `READY_FOR_GENERAL_PRODUCTION` 严格分开

| 状态 | 语义 | 含义 |
|---|---|---|
| `READY_FOR_CONTROLLED_PRODUCTION_ACTIVATION` | **可开始产生未来真实历史** | ⛔ **不**宣称历史资格化完成 |
| `READY_FOR_PRODUCTION_PROMOTION` | 可做生产提升 | 当前 **NOT_ISSUED** |
| `READY_FOR_GENERAL_PRODUCTION` | 全面生产放行 | 当前 **false** |

### 6.2 机器门禁（全部必须为真，否则 fail-closed）

| # | 条件 | 当前值 |
|---|---|---|
| G-01 | `HD-10 = COMPLETE` | ✅ |
| G-02 | `production schema exact-match = true` | ✅（5/5 集合 + 7/7 索引签名逐位一致） |
| G-03 | `Stage A = PASS` | ✅ 72/72 |
| G-04 | `Stage A~G = PASS` | ✅ 80/80 |
| G-05 | `qualification gate = PASS` | ✅ 38/38 |
| G-06 | `reader migration = PASS` | ✅ 8/8 |
| G-07 | `immutable = PASS` | ✅ 23/23 |
| G-08 | `Gen-1 = PASS` | ✅ 10/10 |
| G-09 | `Gen-2 = PASS` | ✅ 7/7 |
| G-10 | `P12_PARITY_UNEXPECTED_DECISION_DELTA = 0` | ✅ 0 |
| G-11 | `protected domain = clean` | ✅ 0 改动 |
| G-12 | `RPG-F2 historical limitations = explicitly registered` | ✅（§2.2 四行） |
| G-13 | `RPG_F3_HISTORICAL_UNEXPECTED_DECISION_DELTA = 6` **显式登记且未被静默豁免** | ✅ 6 |
| G-14 | `RUN_HISTORY infrastructure = READY` | ✅（契约+写侧+读者+结构全就绪） |
| G-15 | `V365_ENFORCE_SWITCH_DATE = null`（首次 activation 前） | ✅ null |
| G-16 ★ | `FIRST CONTROLLED RUN authorization = explicit owner **run** authorization`（★ C-021 由 `owner_authorization` **改名**） | ⛔ **NOT_GRANTED** |
| **G-17** ★ | `actual-book authority` 已冻结且为 `portfolio_snapshot.positions[].position`（⛔ 非 `run_candidate_portfolio`） | ✅ C-020 §1 |
| **G-18** ★ | `PROSPECTIVE_QUALIFICATION_ANCHOR` 方案已登记（两层 anchor，⛔ 非单一 `result_sequence_sha`） | ✅ C-020 §2 / OD-P-2 |
| **G-19** ★ | `CAS/history 恢复协议`已登记（`CAS_REJECTED` + `PROMOTED_HISTORY_INCOMPLETE` 7 步） | ✅ C-020 §3 |
| **G-20** ★ | `OD-P-1` 已批准（MIN=120 / MAX=250）且 **⛔ 不得自动降标** | ✅ APPROVED |
| **G-21** ★★ | `candidate_source_frozen`（`candidate_manifest_sha` 存在且 deterministic） | ✅ C-021 §4 |
| **G-22** ★★ | `deployment_scope_exact`（required/excluded 精确，⛔ 非 76 全量） | ✅ C-021 §3 |
| **G-23** ★★ | `rollback_artifact_verified`（`CURRENT_PRODUCTION_ROLLBACK_ARTIFACT` 独立验证） | ✅ C-021 §6 |
| **G-24** ★★ | `production_baseline_verified`（当前生产基线 vs deployment ledger 已核验） | ✅ C-021 §2 |
| **G-25** ★★ | `deployment_identity_verified`（**⛔ 部署前必须为 false**） | ⛔ **false** |

**⭐ 关键 G-13 语义**：历史 6 个 UNEXPECTED **必须显式登记**，且**不得**因为要放行 controlled activation 而被**静默豁免**。即：门禁要求它**被看见**，而不是要求它**变成 0**。

**⭐ 关键 G-17 语义**（C-020 §1）：`run_candidate_portfolio` 经审计**无法证明**保存执行后 actual position
（写入路径 = candidate 通道；schema 自称"组合候选"；发布层零 execution 语义）
⇒ 冻结为 **candidate / intended portfolio provenance**，⛔ **不得**用于 `RPG-F2-C-PROSPECTIVE` actual-book qualification。
证据：`deliverables/v365-production-history/prospective/actual-book-authority-audit.json`。

**⭐⭐ 关键 G-16 / G-25 语义**（C-021 §1 / §10 / §11）：

```text
⛔ 旧语义 `owner_authorization = true ⇒ GRANTED` 已【废除】。
```

理由：owner 同意运行，**不等于**线上跑的就是被 qualification 的那份代码。
在 `deployment_identity_verified = false` 时，即使 owner 给了运行授权，也**必须** `may_activate = false`。

```text
G-16 = owner_run_authorization      （**运行**授权；⛔ 非部署授权）
G-25 = deployment_identity_verified （**部署后**才可能为 true）
⇒ 两者**同时**为 true，且其余全 PASS，才允许 GRANTED
```

### 6.3 门禁输出（当前）

```text
READY_FOR_CONTROLLED_PRODUCTION_ACTIVATION = BLOCKED_ON_DEPLOYMENT_IDENTITY
  （G-01~G-15 / G-17~G-24 全绿；⛔ G-25 = false ⇒ 不得置为 GRANTED）
  ★ 比 PENDING_OWNER_APPROVAL 更精确（fail-closed）

READY_FOR_V365_FIRST_CONTROLLED_RUN        = BLOCKED_ON_DEPLOYMENT_IDENTITY
```

### 6.4 ★ GATE-D —— 部署门禁（独立 · 与运行门禁严格分离）

```text
GATE-D = READY_FOR_V365_CONTROLLED_DEPLOYMENT
  D-01 candidate_source_frozen               ✅
  D-02 deployment_manifest_frozen            ✅
  D-03 deployment_scope_exact                ✅
  D-04 current_production_baseline_verified  ✅
  D-05 rollback_artifact_verified            ✅
  D-06 all_qualification_gates_pass          ✅
  D-07 protected_domain_clean                ✅
  D-08 deployment_artifact_materialized      ✅   （★ C-021.1 §6 新增）
  D-09 deployment_artifact_exact_match       ✅   （★ C-021.1 §6 新增）
  D-10 owner_deployment_authorization        ⛔ **NOT_GRANTED**
  ⇒ status = PENDING_OWNER_DEPLOYMENT_APPROVAL · may_deploy = false
  ⇒ implies_first_controlled_run = **false**（恒为 false，⛔ 部署授权不得推导运行授权）
```

> ★ **C-021.1 §6 fail-closed 优先级**：
> ① D-08/D-09 未满足 ⇒ `BLOCKED_ON_DEPLOYMENT_ARTIFACT`（bundle 尚未物化 / 未 exact match）
> ② 其它核心项未满足 ⇒ `BLOCKED_DEPLOYMENT_GATE_INCOMPLETE`
> ③ 核心全绿 + owner 未授权 ⇒ `PENDING_OWNER_DEPLOYMENT_APPROVAL`
> ④ 核心全绿 + owner 已授权 ⇒ `GRANTED`
>
> ⛔ `PENDING_OWNER_DEPLOYMENT_APPROVAL` 的语义被**收紧**为：
> **「已经存在一个具体、不可变、可用 SHA 唯一标识的 deployment bundle，owner 只差决定『是否把这一包上传生产』」**。
> 即：该状态**只有在** `DEPLOYMENT_ARTIFACT_MATERIALIZED = true` 且
> `BUNDLE_SOURCE_PARITY = EXACT_MATCH` 且 `UNEXPECTED_PACKAGE_DIFF = 0` 之后才可能出现。

> ⛔ **Deploy 授权 ≠ Run 授权**（C-021 §13）。两者是**两次独立的 owner 拍板**，
> 中间必须插入 §9 Post-Deploy Identity Gate。

详见：`docs/V365_DEPLOYMENT_IDENTITY_AND_CANDIDATE_FREEZE.md`

### 6.5 ★ C-021.1 部署 bundle 物化状态

```text
DEPLOYMENT_ARTIFACT_MATERIALIZED = true
DEPLOYMENT_BUNDLE_SHA            = e996e88ae8084a38e186471b561867267fc4280c3ea5758ccb0eff75092455a4
BUNDLE_SOURCE_PARITY             = EXACT_MATCH   （MISSING_REQUIRED_FILE=0 / UNEXPECTED_FILE=0 / CONTENT_DIFF=0）
UNEXPECTED_PACKAGE_DIFF          = 0
required_file_count              = 91  · bundle_size = 1161728 · bundle_format = ustar-deterministic
previous（线上 V3.6.4）package_sha256 = aa576c20599528a66737f154b31b8cca87f25c1cf50068093bc243ed7084caea
DEPLOYMENT_ROLLBACK_BINDING      = BOUND
```

**不变量**：`same deployment_bundle_sha256 ⇒ same deployable bytes`
（tar 内 mtime/uid/gid/mode 全部固定 ⇒ 纯内容哈希；两次独立重算逐位一致）。

---

## 7. Controlled Activation 的「小流量 / 可逆 / fail-closed」

### 7.1 首次 activation 的必要约束

```text
single-run scope            仅一个 run
single expected_trade_date  仅一个目标交易日
single production environment  仅一个 env（tradingview-etf-d0fa42yy57cbc11b）
★ three-layer identity binding（C-021.1 §7）：
    base_head_sha            provenance（⛔ **不再是**唯一代码身份）
  + candidate_manifest_sha   源码侧身份
  + deployed_bundle_sha      可部署字节身份
  外加 production_env / function_name 限定作用域
  ⛔ 仅绑 HEAD SHA 的授权一律 REJECTED（`head_only_authorization_rejected = true`）
explicit owner authorization  需 owner 单独授权（本轮 NOT_GRANTED）
```

### 7.2 失败条件（⚠️ 任一命中 ⇒ **FAIL CLOSED**）

```text
F-01 candidate incomplete
F-02 manifest mismatch
F-03 CAS rejected
F-04 read-after-write mismatch
F-05 history write failure
F-06 pointer mismatch
F-07 schema drift
F-08 unexpected runtime exception
```

**fail-closed 行为**：

```
① 立即停止本次 run（⛔ 不重试、⛔ 不扩大范围）
② 不写 active_run_pointer（⛔ 不留下半成品指针）
③ V365_ENFORCE_SWITCH_DATE 保持 null
④ PROSPECTIVE_EPOCH 保持 NOT_STARTED（若已建立则保留，该 run 作废）
⑤ 产出 failure artifact（含失败阶段 + 原始错误 + 是否留下副作用）
⑥ 需 owner 重新授权后方可再试
```

### 7.3 可逆性

| 动作 | 是否可逆 | 处理 |
|---|---|---|
| 建空集合（HD-10） | ✅ 已完成，不受影响 | — |
| 单 run 写入 | ⚠️ 半可逆 | 失败 ⇒ 该 run 标记作废（⛔ 不物理删除，保留 provenance） |
| pointer 初始化 | ✅ 可逆（CAS + revision） | 失败 ⇒ 不写指针 |
| switch date 登记 | ✅ 可逆（置回 null） | 失败 ⇒ 保持 null |

---

## 8. V365_FIRST_NATURAL_RUN_ACCEPTANCE

### 8.1 首个成功 run 后必须验证（逐项）

```text
A-01 run_manifest exists
A-02 candidate decisions complete（run_candidate_decision 覆盖全部 expected codes）
A-03 candidate portfolio complete（run_candidate_portfolio 覆盖全部 expected codes）
A-04 active_run_pointer correct（scope = 该 run · revision 正确）
A-05 run_history exists
A-06 promoted = true
A-07 promoted_at non-null
A-08 revision correct
A-09 supersedes_run_id correct
A-10 read_after_write_consistent = true
```

### 8.2 RUN_HISTORY_INDEX 升格条件

```text
仅当 A-01 ~ A-10 **全部**为 true
  ⇒ RUN_HISTORY_INDEX: PENDING ──▶ ACTIVE / AVAILABLE
```

⛔ **不得**通过"制造一笔生产 run"来补齐测试证据（owner §9）。
⛔ 不得以部分通过（如 A-01~A-05）冒充完成。

### 8.3 验收失败处理

任一 A-xx 为 false ⇒ `FIRST_NATURAL_RUN_ACCEPTANCE = FAILED`
⇒ 进入 §7.2 fail-closed 流程，⛔ `RUN_HISTORY_INDEX` 保持 `PENDING`。

---

## 9. Prospective Qualification Window 分析

> owner §9 要求：**读现有设计后给出有证据的候选方案**；若已冻结则直接引用。
> **本轮结论：⛔ 未发现已冻结的 prospective minimum window 定义** —— 现有冻结窗口是
> **历史 replay 区间**（`2026-08-01 → 2026-09-22`，25 个交易日），**不是** prospective 最小窗口规则。
> 故按 §9 提出**有证据的候选方案**。

### 9.1 证据：系统内的真实 warmup / lookback 需求（全部来自现有代码，未新造）

| 需求项 | 证据位置 | 门槛 |
|---|---|---|
| **市场环境（regime）** | `scripts/lib/v364-replay-harness.js:192` | `bars.length < 40` ⇒ **null**（需 ≥**40 个指数日线 bar**） |
| **周线状态（W1~W5）** | `scripts/lib/v364-replay-harness.js:194` | `weekly.length < 10` ⇒ **null**（需 ≥**10 根周线** ≈ **50 个交易日**） |
| **regime 三票齐全** | `v364-replay-harness.js:196` | `indexWStates.length < 3` ⇒ 回落 `range` |
| MA20 / 20 日位置 | `runDecisionEngine/index.js:222,255` | `closes.length >= 20` |
| MA60 结构 | `indicators.js:383-384`（`calcMA(closeArr, 60)`） | 60 根 |
| Swing 结构 | `swing-structure.js:33` | `SWING_MIN_BARS = 12`（前 5 + 近 5 + 2 缓冲） |
| 冷静期（cooldown） | `src/common/utils/cooldown.js:computeCooldownDays` | 突破加仓 **5** / 其它非无 **2** / 无 ⇒ `cooldown_days = 3`（`constants.js:418` `COOLDOWN_DAYS = 3`） |
| 阶段降级确认 | `v3-constants.js:57-59` | `STAGE_UP_CONFIRM_DAYS = 2` · `STAGE_DOWN_CONFIRM_DAYS = 3` · `STAGE_HARD_BREAK_DAYS = 1` |
| 冲击恢复回溯 | `v3-constants.js:90` | `RECOVERY_LOOKBACK_DAYS = 5` |

### 9.2 ★ 决定性约束：周线 warmup = 50 个交易日

```
weekly.length < 10 ⇒ regime 退化为 range
10 根周线 ≈ 10 × 5 = 50 个交易日
且三者需同时可算（indexWStates.length >= 3）
```

⇒ **prospective 窗口若 < 50 个交易日，市场环境将恒为 `range` 兜底**，
即：**无法覆盖 `aggressive` / `structural` / `defensive` / `crisis` 等真实 regime**。
这是一条**硬证据**，不是偏好。

### 9.3 候选方案（三层）

| 方案 | 窗口 | 能满足 | ⚠️ 不足 |
|---|---|---|---|
| **A · 最小可行** | **60 个交易日**（≈ 3 个月） | 周线 warmup（50）+ 少量真实 run；regime 可脱离 `range` | regime 覆盖窄；`sector_cap` / `correlation_cap` 等**稀有**约束命中概率低 |
| **B · 推荐** ⭐ | **120 个交易日**（≈ 6 个月） | 覆盖 **2 个季度**，含至少 1 次季度级调仓；regime 有机会跨越 ≥2 档；cooldown（≤5 日）被多次触发；可观测 `BUILD / ADD / REDUCE / HOLD` 全部动作 | 需约 6 个月日历时间累积 |
| **C · 稳健** | **250 个交易日**（≈ 1 年） | 覆盖完整年度周期（含年报/中报/分红除权期），regime 全档位高概率覆盖 | 时间成本最高 |

### 9.4 ⭐ OD-P-1 = **APPROVED**（owner 裁定 · C-020 §4）

> **本轮 owner 已正式批准，不再是"待决建议"**：

```text
OD-P-1 = APPROVED

PROSPECTIVE_MINIMUM_WINDOW = 120 trading days
PROSPECTIVE_MAXIMUM_WINDOW = 250 trading days
```

**推荐理由（逐条对应 §9 要求）**：

| §9 要求分析项 | 120 日的满足方式 |
|---|---|
| cooldown 最大 lookback | 最大 5 日（突破加仓）⇒ 120 日内必被多次触发，可证 `production computeCooldownDays() ≡ replay computeReplayCooldown()` |
| MA / indicator warmup | 周线 warmup 50 已完成（120 ≫ 50）；MA20/MA60/swing(12) 均充分 |
| position transitions | 120 日 ≈ 6 个月，覆盖至少 2 次季度级 rebalance 窗口 |
| execution density | 生产 run 是每交易日 1 次 ⇒ 约 120 个真实 run 样本（对比历史轨仅 16 个可用快照） |
| 不同 regime 覆盖 | 6 个月跨越季节转换，regime 有机会覆盖 ≥2 档（vs 60 日仅勉强脱离 range） |
| sector cap binding | tech_sector_max = 65（`v364-replay-harness.js:69`）等约束在 6 个月内有实际触发机会 |
| BUILD / ADD / REDUCE / HOLD 覆盖 | 6 个月足以观测全部四种动作（3 个月可能缺 REDUCE） |

**★ 动态补足规则（120 日后仍缺维度 ⇒ 自动延长；⛔ 不得降低标准）**：

```text
PROSPECTIVE_MINIMUM_WINDOW = 120 trading days
        │
        ├─ 若 120 日后仍存在「未覆盖的必需维度」，则**自动延长**
        │    必需维度 = { regime 档位 ≥2 · 动作 {BUILD,ADD,REDUCE,HOLD} 全覆盖 ·
        │               cooldown 触发 ≥1 次 · sector_cap **或** correlation_cap 触发 ≥1 次}
        │
        └─ 达到 PROSPECTIVE_MAXIMUM_WINDOW = 250 trading days 仍不足
              ⇒ STOP
              ⇒ OWNER_REVIEW_REQUIRED
              ⇒ ⛔ **不得自动降低资格标准**
```

机器守卫：`evaluateProspectiveWindow()`（P-25 断言 119 / 120 / 200 / 250 四档）。

---

## 10. Prospective Protocol 的真实数据源

### 10.1 ★★ Actual-book authority 冻结（C-020 §1 · owner 裁定）

> ⛔ **不得默认** `run_candidate_portfolio = ACTUAL_EXECUTION_BOOK`。

```text
execution authority:
  trade_log

actual position-book authority:
  portfolio_snapshot.positions[].position

run_candidate_portfolio:
  仅作为 candidate / intended portfolio provenance
```

**审计裁定**（`deliverables/v365-production-history/prospective/actual-book-authority-audit.json`）：

| 项 | 结论 |
|---|---|
| `run_candidate_portfolio` 是否保存执行后 actual position | ⛔ **NOT_PROVEN** |
| 判定 | `CANDIDATE_INTENDED_PORTFOLIO_PROVENANCE_ONLY` |
| 取证 | 写入路径 = candidate 通道（`runDecisionEngine:561`）· schema 自称「组合候选」· 发布层零 execution 语义 · 写入时机早于 promotion/执行 |
| ⛔ 禁用范围 | `RPG-F2-C-PROSPECTIVE` actual-book qualification |

> ⛔ **除非能以 code + contract + production writer 三方证明其保存【执行后 actual position】，
> 否则不得用于 `RPG-F2-C-PROSPECTIVE` actual-book qualification。** 本轮审计未能证明 ⇒ **禁用**。

### 10.2 允许（全部来自真实生产）

```text
run_manifest
run_candidate_decision
run_candidate_portfolio      ← ⚠️ 仅作 candidate/intended provenance（⛔ 非 actual book）
active_run_pointer
run_history
trade_log                    ← ★ execution authority
portfolio_snapshot           ← ★ actual position-book authority（positions[].position）
```

按实际需要取用；⛔ **actual book 只能来自 `portfolio_snapshot.positions[].position`**。

### 10.3 ⛔ 严禁替代

```text
synthetic fill
suggested_position（当 actual）
counterfactual book（当 actual）
manual reconstructed position
interpolation
zero-position assumption
backfill
run_candidate_portfolio（当 actual book）
```

**依据**：冻结裁定 **Model B** —— `actual execution` 必须来自**显式实际执行账本**。

---

## 11. Prospective RPG-F2-B / F2-C 关闭规则

> owner §11：⛔ **不再**尝试关闭旧历史窗口的 F2-B / F2-C。新增两个 **prospective** 状态。

### 11.1 RPG-F2-B-PROSPECTIVE

```text
RPG-F2-B-PROSPECTIVE = COMPLETE
```

**必须证明的等价链**：

```text
actual trade execution
  → production computeCooldownDays()     （src/common/utils/cooldown.js）
  → replay computeReplayCooldown()        （scripts/lib/v364-replay-harness.js 导出）
  → same result                           （逐 code 逐 trade_date 比对，零差异）
```

覆盖要求：窗口内**每一次** `buy` 记录都要走完上述链条。

### 11.2 RPG-F2-C-PROSPECTIVE

```text
RPG-F2-C-PROSPECTIVE = COMPLETE
```

**必须证明**（★ C-020 §1 修正后的 authority）：

```text
每个 required trade date 都有 actual production book

actual production book 的权威来源（冻结）：
  portfolio_snapshot.positions[].position

⛔ 不得以 run_candidate_portfolio 充当 actual book
   （审计判定：CANDIDATE_INTENDED_PORTFOLIO_PROVENANCE_ONLY）
⛔ 不得以 suggested_position 充当 actual position
```

覆盖要求：`required_dates ⊆ available_dates`，**missing = 0**；且每个日期须能追溯到
`portfolio_snapshot` 的**真实记录**（⛔ 非推断 / 非插值 / 非候选）。

### 11.3 与历史状态的关系

```text
RPG-F2-B  （历史）  保持 PARTIAL / BLOCKED_ON_EXECUTION_COVERAGE   ⛔ 不改
RPG-F2-C  （历史）  保持 BLOCKED_ON_ACTUAL_BOOK_COVERAGE           ⛔ 不改
RPG-F2-B-PROSPECTIVE  初始 NOT_STARTED
RPG-F2-C-PROSPECTIVE  初始 NOT_STARTED
```

**⛔ 四者独立命名、独立结论、互不覆盖。**

---

## 12. Prospective RPG-F3 Attribution Rule

### 12.1 拆分

```text
RPG_F3_HISTORICAL_UNEXPECTED_DECISION_DELTA    = 6        （永久保留）
  = V2-CF-COOLDOWN 1 + V2-AE 5

RPG_F3_PROSPECTIVE_UNEXPECTED_DECISION_DELTA   = NOT_STARTED
  未来目标 = 0
```

### 12.2 ⛔ 不得混为同一个 `UNEXPECTED_DECISION_DELTA`

历史 `UNEXPECTED_DECISION_DELTA` 与 prospective 的**是两个完全不同的 gate**，
⛔ 不得共用一个名字（本设计同步落实 §13 的命名拆分）。

### 12.3 归因规则（prospective）

```
归因仍**仅**两条（冻结）：
  effective_tech_cap_fidelity
  cooldown_gate_exercised
其余一律 UNEXPECTED（fail-closed）

⛔ 不得为了把 prospective Δ 降为 0 而扩大 taxonomy
```

**prospective Δ 的来源必须是真实修复**，例如：prospective 轨**本就复用**生产 cooldown 纯函数
（`V2-CF-COOLDOWN` 语义），故 **cooldown 类 UNEXPECTED 在 prospective 轨天然应 = 0**；
若不为 0 ⇒ 说明真实实现仍有缺口 ⇒ **如实报告**，⛔ 不得豁免。

---

## 13. Rollback / Fail-Closed Rules

| 层 | 触发 | 动作 | 可逆性 |
|---|---|---|---|
| Gate | 任一 G-01~G-16 不满足 | ⛔ 不允许 activation | — |
| Run | 任一 F-01~F-08 | 立即停止；不写指针；switch date 保持 null | ✅ 高 |
| Acceptance | 任一 A-01~A-10 false | `FIRST_NATURAL_RUN_ACCEPTANCE = FAILED`；`RUN_HISTORY_INDEX` 保持 PENDING | ✅ 高 |
| Protocol | 任何伪造检出 | ⛔ 立即作废该 prospective 结论，回退 `NOT_STARTED` | ✅ |
| 历史轨 | 任何改写尝试 | ⛔ **绝对禁止**（违反 owner 冻结裁定） | ❌ 不可接受 |

**统一 fail-closed 原则**：

```
不确定 ⇒ 不放行
缺数据 ⇒ 报 PARTIAL / BLOCKED_*（⛔ 不得报 COMPLETE）
异常   ⇒ 停止，⛔ 不扩大范围
```

---

## 14. Owner Decisions（C-020 已裁定 4 / 5）

| ID | 事项 | 裁定 | 影响 |
|---|---|---|---|
| **OD-P-1** | `PROSPECTIVE_MINIMUM_WINDOW` 最终值 | ✅ **APPROVED** — MIN = **120 交易日** / MAX = **250 交易日**；120 日不足则自动延长；250 仍不足 ⇒ `STOP` + `OWNER_REVIEW_REQUIRED`，⛔ 不得自动降低资格标准 | prospective 资格化所需时间 |
| **OD-P-2** | prospective anchor 生成口径 | ✅ **APPROVED_WITH_CORRECTION** — 采纳 §3.2.1 **增强后的两层 anchor**（`result_sequence_sha` 仅标识；`PROSPECTIVE_QUALIFICATION_ANCHOR` 为真资格锚）。⛔ 不是"仅绑定 decision sequence"的弱版本 | 新协议指纹算法 |
| **OD-P-3** | 是否授权 `CONTROLLED_PRODUCTION_ACTIVATION` | ⛔ **NOT_YET_GRANTED**（本轮仍不授权） | 决定能否开始产生真实历史 |
| **OD-P-4** | `PROSPECTIVE_EPOCH` 的 `expected_trade_date` 选取规则 | ✅ **DEFINED** — owner 授权后**第一个正常计划执行且市场数据完整的自然交易日**；⛔ 禁止回溯日期 / 人为选历史表现好的日期 / 测试日期 / 设计日期（§4.2.1） | 决定 switch date |
| **OD-P-5** | 升格 `qualification_authoritative = true` 的裁定主体 | ✅ **PENDING_OWNER_PROMOTION_DECISION** — `qualification_authoritative` 保持 **false** 直至窗口 ≥120 + 动态覆盖满足 + F2-B-P/F2-C-P = COMPLETE + 前瞻 Δ=0 + Full Requalification PASS；之后由 **owner 单独裁定**，⛔ agent 不得自行升格 | prospective 轨权威性 |

---

## 15. Exact Next Execution Sequence

```text
【本轮已完成】
  ✅ 设计协议 RFP-V2-PH-PROSPECTIVE
  ✅ 机器门禁（controlled activation gate）设计 + 脚本
  ✅ First Natural Run Acceptance spec + 脚本
  ✅ prospective coverage schema
  ✅ 窗口分析（有证据推荐 120 交易日）
  ✅ Δ 命名拆分（P12 vs RPG_F3_HISTORICAL）
  ✅ Freeze Review stale 文案修正
  ⛔ 未执行任何 production activation

【等待 owner（当前）】
  ⏸ **OD-P-3**（`CONTROLLED_PRODUCTION_ACTIVATION` 授权）—— 但**前置条件已由 C-021/C-021.1 收紧**：
      ① 先需 **owner 单独授权 DEPLOY**（GATE-D：D-01~D-09 已全绿，仅差 D-10）
      ② 部署后须过 **Post-Deploy Identity Gate** ⇒ `DEPLOYMENT_IDENTITY_VERIFIED = true`
      ③ **之后**才轮到 owner 单独授权 FIRST CONTROLLED RUN
  ✅ OD-P-1 = APPROVED（120/250）
  ✅ OD-P-2 = APPROVED_WITH_CORRECTION（两层 anchor）
  ✅ OD-P-4 = DEFINED（授权后第一个正常自然交易日）
  ✅ OD-P-5 = 保持 false 直至全条件满足 + owner 单独裁定

【owner 授权 DEPLOY 后（下一步，本轮⛔不执行）】
  ⓪ owner 显式授权 DEPLOY —— 必须绑定**三层 identity**：
       base_head_sha = c6bd006fd76ffc5358cddd07347df8ed23d9e61d（provenance）
       candidate_manifest_sha = 8c53f93fa66bbc2768f23843530f3997e2c9d38030e58b65c2bc0d7497c501c1
       deployment_bundle_sha  = e996e88ae8084a38e186471b561867267fc4280c3ea5758ccb0eff75092455a4
       production_env = tradingview-etf-d0fa42yy57cbc11b · function = runDecisionEngine
       ⛔ 仅绑 HEAD SHA 的授权一律 REJECTED
  ⓪′ 执行**单次** deploy（只上传已冻结 bundle，⛔ 不得从 mutable working tree 构建）
  ⓪″ Post-Deploy Identity Gate（只读）：
       ONLINE_SOURCE_PARITY = EXACT_MATCH 且 UNEXPECTED_PACKAGE_DIFF = 0
       ⇒ DEPLOYMENT_IDENTITY_VERIFIED = true；否则 STOP
  ⓪‴ **STOP** —— ⛔ 部署授权**不**推导运行授权

【owner 单独授权 FIRST CONTROLLED RUN 后】
  ① owner 显式授权 FIRST CONTROLLED RUN（同样绑定三层 identity）
  ② 执行**单次** controlled run（single run / single trade date / single env）
  ③ 若 CAS 未成功 ⇒ CAS_REJECTED（§5.1 A）⇒ STOP
     若 CAS 成功但 history 失败 ⇒ PROMOTED_HISTORY_INCOMPLETE（§5.1 B）⇒ 走 7 步恢复
  ④ First Natural Run Acceptance（A-01~A-10 逐项）
  ⑤ 若全绿 ⇒ V365_ENFORCE_SWITCH_DATE = 该 run.expected_trade_date
               PROSPECTIVE_EPOCH = EPOCH_ESTABLISHED
               RUN_HISTORY_INDEX: PENDING → ACTIVE/AVAILABLE
  ⑥ 逐 run 累积至 PROSPECTIVE_MINIMUM_WINDOW（≥120，不足自动延长至 250）
  ⑦ 跑 prospective qualification（RFP-V2-PH-PROSPECTIVE）
  ⑧ 关闭 RPG-F2-B-PROSPECTIVE / RPG-F2-C-PROSPECTIVE / RPG_F3_PROSPECTIVE_UNEXPECTED_DECISION_DELTA
  ⑨ owner 裁定升格 qualification_authoritative = true
  ⑩ （仍须单独授权）READY_FOR_GENERAL_PRODUCTION
```

---

## 16. 机器状态（本轮产出）

> ⛔ **`## 15` 及更早的阶段叙述均为 `[HISTORICAL SNAPSHOT]`**：其中的计数与状态只反映当时实况，
> ⛔ 不得作为 current state 引用。**current state 一律以本节机器状态块为准。**

> ⛔ ** 及更早的阶段叙述均为 **：其中的计数与状态只反映当时实况，
> ⛔ 不得作为 current state 引用。**current state 一律以本节机器状态块为准。**

```text
HISTORICAL_FULL_WINDOW_STATUS  = INCOMPLETE_BY_SOURCE_HISTORY
PROSPECTIVE_QUALIFICATION_STATUS = NOT_STARTED
READY_FOR_CONTROLLED_PRODUCTION_ACTIVATION = BLOCKED_ON_DEPLOYMENT_IDENTITY
  ★ C-021.1 §8 修正：此行的旧值 PENDING_OWNER_APPROVAL 已作废
  ★ 只有 post-deploy identity PASS（DEPLOYMENT_IDENTITY_VERIFIED = true）后才可能变更
CANDIDATE_FREEZE_DESIGN        = COMPLETE
DEPLOYMENT_ARTIFACT_MATERIALIZED = true
DEPLOYMENT_BUNDLE_SHA          = e996e88ae8084a38e186471b561867267fc4280c3ea5758ccb0eff75092455a4
BUNDLE_SOURCE_PARITY           = EXACT_MATCH
UNEXPECTED_PACKAGE_DIFF        = 0
READY_FOR_V365_CONTROLLED_DEPLOYMENT = PENDING_OWNER_DEPLOYMENT_APPROVAL
READY_FOR_V365_FIRST_CONTROLLED_RUN  = BLOCKED_ON_DEPLOYMENT_IDENTITY
DEPLOYMENT_IDENTITY_VERIFIED   = false
READY_FOR_GENERAL_PRODUCTION   = false
PRODUCTION_ACTIVATION_AUTHORIZATION = NOT_GRANTED
RFP-V2-PH-FULL_WINDOW_AVAILABLE = false
RFP-V2-PH-PROSPECTIVE          = REGISTERED（qualification_authoritative = false）
PROSPECTIVE_EPOCH              = NOT_STARTED
P12_PARITY_UNEXPECTED_DECISION_DELTA = 0
RPG_F3_HISTORICAL_UNEXPECTED_DECISION_DELTA = 6（永久保留 · fail-closed）
gate_log_integrity             = 门禁日志计数绑定真值 + 新鲜度（★ §9 同源加固）
── ★ C-021.2 CONTROLLED DEPLOYMENT（已执行 · 单次 · runDecisionEngine only）──
CONTROLLED_DEPLOYMENT          = COMPLETE
AUTHORIZED_BUNDLE_SHA          = e996e88ae8084a38e186471b561867267fc4280c3ea5758ccb0eff75092455a4
CURRENT_PRODUCTION_DEPLOYMENT_IDENTITY = V3.6.5（deployed 2026-09-30T05:38:13Z）
ONLINE_SOURCE_PARITY           = EXACT_MATCH（91 文件 · MISSING 0 · UNEXPECTED 0 · CONTENT_DIFF 0）
POST_DEPLOY_UNEXPECTED_PACKAGE_DIFF = 0
DEPLOYMENT_IDENTITY_VERIFIED   = true（★ 部署后由 post-deploy gate 置 true；部署前必须 false）
READY_FOR_V365_FIRST_CONTROLLED_RUN = PENDING_OWNER_RUN_APPROVAL
OWNER_RUN_AUTHORIZATION        = false（⛔ 本授权不含 first run）
PRODUCTION_ACTIVATION_AUTHORIZATION = NOT_GRANTED
deployment_authorization_consumed = true（⛔ 授权一次性 · 已消耗 · 再次部署需 owner 新授权）
AUTHORIZATION_SCOPE_RATIFIED_BY_OWNER = true · changed_files_count = 85
deploy: FunctionId=lam-eiye285p · Runtime=Nodejs16.13 · Handler=index.main
        ModTime=2026-09-30 13:38:07 · CodeSize=4465434（部署前 4013498）
⛔ 未执行 production run · 未初始化 pointer · 未写 run_manifest/run_history · 未设 switch date
RPG_F3_PROSPECTIVE_UNEXPECTED_DECISION_DELTA = NOT_STARTED（目标 = 0）
OWNER_F2C_PATH                 = A
RUN_HISTORY_INDEX              = PENDING（POST-ACTIVATION）
RPG-F2-B                       = PARTIAL / BLOCKED_ON_EXECUTION_COVERAGE
RPG-F2-C                       = BLOCKED_ON_ACTUAL_BOOK_COVERAGE
RPG-002                        = NOT YET CLOSED（PARTIAL）
GOVERNED_PRODUCTION_HISTORY_DATA_REQUIRED = CLOSED
FREEZE_REVIEW                  = ELIGIBLE_FOR_REVIEW
candidate_content_sha          = 2f4b05193ff09d27bc990254e91e545dcad0d2926cf26835119b846c7cd2cade
READY_FOR_PRODUCTION_PROMOTION = NOT_ISSUED
Stage A                        = 72/72（72 个 tests/*.test.js 文件）
tracked-file count             = 85（`git status --porcelain -uall` 去目录后的文件数；C-021.1 当前真值）
── ★ C-020 新增 ──
PROSPECTIVE_DESIGN_FINAL       = READY_FOR_OWNER_ACTIVATION_DECISION
OD_P_1                         = APPROVED（MIN=120 / MAX=250 trading days）
OD_P_2                         = APPROVED_WITH_CORRECTION（两层 anchor）
OD_P_3                         = NOT_YET_GRANTED
OD_P_4                         = DEFINED
OD_P_5                         = PENDING_OWNER_PROMOTION_DECISION
execution_authority            = trade_log
actual_position_book_authority = portfolio_snapshot.positions[].position
run_candidate_portfolio        = candidate_intended_portfolio_provenance（⛔ 不得作 actual book）
PROSPECTIVE_QUALIFICATION_ANCHOR = REQUIRED（⛔ result_sequence_sha 不得单独使用）
CAS_HISTORY_RECOVERY           = REGISTERED（CAS_REJECTED + PROMOTED_HISTORY_INCOMPLETE）
```

── ★ C-021 新增（DEPLOYMENT IDENTITY & CANDIDATE FREEZE）──
CANDIDATE_FREEZE_DESIGN         = COMPLETE
READY_FOR_V365_CONTROLLED_DEPLOYMENT = PENDING_OWNER_DEPLOYMENT_APPROVAL
READY_FOR_V365_FIRST_CONTROLLED_RUN  = BLOCKED_ON_DEPLOYMENT_IDENTITY
DEPLOYMENT_IDENTITY_VERIFIED    = false（⛔ 部署前必须 false）
CURRENT_PRODUCTION_DEPLOYMENT_IDENTITY = V3.6.4（aa634e2 · 零漂移实测）
PRODUCTION_ACTIVATION_AUTHORIZATION = NOT_GRANTED
G-16                            = owner_run_authorization（★ 由 owner_authorization 改名）
G-21 candidate_source_frozen    = PASS
G-22 deployment_scope_exact     = PASS
G-23 rollback_artifact_verified = PASS（独立双源一致）
G-24 production_baseline_verified = PASS
G-25 deployment_identity_verified = false（⛔ 部署前必须 false ⇒ BLOCKED_ON_DEPLOYMENT_IDENTITY）
GATE-D (D-01~D-08)              = PENDING_OWNER_DEPLOYMENT_APPROVAL（may_deploy = false）
V365_DEPLOYMENT_REQUIRED_FILES  = 91（function 2 + common 87 + extra 2）
V365_DEPLOYMENT_EXCLUDED_FILES  = 69
V365_DEPLOYMENT_SCOPE           = EXACT（deploy_all_74_changed_files = false）
changed_in_closure              = 7（⛔ 非 76 全量部署）
candidate_manifest_sha          = 8c53f93fa66bbc2768f23843530f3997e2c9d38030e58b65c2bc0d7497c501c1
dependency_closure_sha          = e80ea8c20785f3c8c4da70e8316d84321cfe944cb7ba25f85df2dba04ff79016
rollback_artifact_verified      = PASS（independently_verified = true · 本地复算双 SHA == 台账 D-006）
materializeIndicators_touched   = false
```

> ★ C-021 详情见：`docs/V365_DEPLOYMENT_IDENTITY_AND_CANDIDATE_FREEZE.md`
> （§5 freeze 机制两方案对比 · §6 rollback artifact dry-run）

见：`deliverables/v365-production-history/prospective/prospective-state.json`
见：`deliverables/v365-production-history/c021/*.json`

---

## 17. 边界声明

- 本设计**未**做出任何 `READY_FOR_PRODUCTION_PROMOTION` / `READY_FOR_GENERAL_PRODUCTION` 判定。
- 本设计**未**使用任何模型输出替代 owner 对**风险接受 / 生产放行**的拍板。
- 本设计**未**修改历史轨的任何结论（F2-B / F2-C / PH / Δ=6 全部保持）。
- 本轮**未**执行 production promotion / pointer 初始化 / 生产写入 / switch date 登记 / deploy / push / PR / merge / tag。
- ★ 本轮（C-020）**未**执行任何真实 production run（`PRODUCTION_ACTIVATION_AUTHORIZATION = NOT_GRANTED`）。
- ★ 本轮修正均为**设计层 + 机器守卫层**：actual-book authority 冻结 / 两层 anchor / CAS-history 恢复协议 ——
  ⛔ 未触碰生产 DB、未写任何 collection。
- 所有"已完成"项均为**本地 / 可逆 / 可验证**工作，⛔ **不构成**生产就绪证明。
```
