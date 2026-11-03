# Gen-1 Evidence Contract v5.0 — 冻结与封存记录（FREEZE & SEAL RECORD）

**文档编号**：`WP-G1-EVIDENCE-CH-5.0-FSR`
**性质**：**冻结 / 封存记录（Freeze & Seal Record）** —— 对 `docs/gen1/GEN1_EVIDENCE_CONTRACT_V5.md`
的冻结行为做**可复核、可独立重算**的留痕。
**闸门**：**G-2（FREEZE + SEAL）** —— owner 2026-10-02 单独授权（**OWNER-AUTHORIZED AUTONOMOUS GOVERNANCE**）
**as-of**：2026-10-02（北京时间）
**输出模式**：**OUTPUT-ONLY / NO PRODUCTION EFFECT** —— 本记录不改变任何生产行为。

---

## 0. ★ 同名辨析（**must-read，⛔ 不得混用**）

本仓存在**三组**名的「FROZEN / SEAL」。它们**对象不同、判据不同、授权不同**，⛔ **互不替代、不得互相推断**：

| # | 名称 | 对象 | 判据 | 本记录的关系 |
|---|---|---|---|---|
| A | **本记录所称「冻结 / 封存」** | **本契约的载体文件**（文档层） | 冻结 = 状态翻为 FROZEN + 锚定 commit / blob / sha256；封存 = 本记录 | ✅ **即本记录** |
| B | **Key 2 Freeze Seal**（`GEN1_GUARDED_EFFECTIVE_CHARTER` §3.1） | 生产制品 `GUARDED_EFFECTIVE_FREEZE` | 制品状态 == `APPROVED` 且绑定 source SHA + model SHA + threshold 版本 + contract version 四项与运行期实读逐项一致 | ⛔ **完全不同的对象**；本记录⛔ **未触碰**该制品 |
| C | **Key 3 Evidence Seal** | 统计证据资格 | == `EVIDENCE_POSITIVE`（契约 §4.2）⇒ 须 **≥30 独立事件** | ⛔ **完全不同**；今日 `independent_events = 0` |

```text
CANARY PASS  ≠  EVIDENCE PASS  ≠  GE-04
契约载体冻结 ≠  GUARDED_EFFECTIVE_FREEZE（Key 2） ≠  Evidence Seal（Key 3）
本记录       ≠  生产授权       ≠  部署许可
```

> ⛔ **本记录⛔ 不主张任何生产侧状态变更**；`gen1_authority` 保持 `CANARY`，
> `ml_effective = false`，`gen1_production_write = false`，`gen1_auto_execution = false`。

---

## 1. 冻结对象（精确定义）

| 项 | 值 |
|---|---|
| **冻结对象** | `docs/gen1/GEN1_EVIDENCE_CONTRACT_V5.md`（Gen-1 Evidence Contract **v5.0**） |
| 冻结态 | `🔒 FROZEN（2026-10-02）` |
| 冻结字节数 | **64580 B**（LF，`crlf = 0`） |
| 冻结行数 | **1072** |
| **carrier commit（冻结提交）** | `05da0efa73e948921bc7b9b60c0d500cc98e3e9b` |
| **git blob id（sha1）** | `7f86d12aaed99a877c170c25c5a481f21a661256` |
| **content sha256** | `4fb9463f4a437e310cb52b04498a1d4cc0f23fbc64eb3c1d846d90a460a9f55b` |
| 载体分支 | `docs/gen1-evidence-contract-v5-20261002` |
| 载体 PR | **#66**（open；base `master @ e015aaaf2860c808180e5bd1fbfc24d4fdef3303`） |
| 冻结日期 | 2026-10-02（北京时间） |

⚠️ **三种指纹不可混用**：`git blob id` 是 **sha1**（git 对象哈希）；`content sha256` 是**文件内容**哈希；
`carrier commit` 是**提交**哈希。⛔ 不得互相替代、⛔ 不得把其中任一称作另一项。

⚠️ **本记录⛔ 不写入自身 sha256**（自指悖论）；其指纹记于载体 PR body。

---

## 2. carrier 提交链（可逐条复核）

| # | commit | 角色 | 变更 |
|---|---|---|---|
| 0 | `42ebc11486ca108d10964b12761ac616c89d0bd3` | **G-1 载体入库** | 6 文件纯新增：v5.0 载体 + 5 份治理证据 |
| 1 | `21171edaf8eaf9650a88adb81b88f854fa54a219` | **v5.0-draft rev.1** | 冻结前置一致性收紧（见 §3） |
| 2 | `05da0efa73e948921bc7b9b60c0d500cc98e3e9b` | **★ 冻结提交** | 状态翻为 FROZEN（见 §3） |
| 3 | *（本记录所在提交）* | **封存记录 + 工具迁移** | 本文件 + `scripts/gen1/evidence-capture/`（见 §6） |

- 全部提交的 parent 链**线性**，均自 `origin/master`（`e015aaaf…`）开出。
- ⛔ `origin/master` 的 blob 未因本批次改变（**纯新增分支**，⛔ 不含 `M`/`D`）。

---

## 3. 冻结内容范围（冻结轮**只**改了什么）

对照 v2.0 冻结惯例（「冻结（**仅**状态头 / §12 / 变更日志）」），本冻结轮改动如下：

| # | 位置 | 改动 |
|---|---|---|
| 1 | 状态头 | `版本` 行 → `v5.0（🔒 FROZEN，2026-10-02）`；`状态` 行 → FROZEN + 新增**同名辨析**段；`取代关系` 去「拟」；`授权依据` 段写明 G-2 单独授权 |
| 2 | 状态块 | `CONTRACT FREEZE = FROZEN`；新增 `CARRIER SEAL RECORD = SEALED（同批次独立工件；⛔ 非生产 Seal）` |
| 3 | §1.1 | 表行「本文件 v5.0（拟）」→「本文件 v5.0」并标注已冻结 |
| 4 | §12 | 第 1 项 → ✅ 已执行；第 9 项 → ✅ `CONTRACT READY`；第 12 项 → ✅ 已执行（工具迁移） |
| 5 | §13 | 生成轮边界**保留**；新增「冻结轮」边界区块；显式写明**主分支可达性 = PENDING** |
| 6 | §11 变更日志 | v5.0 行标签去 `NOT FROZEN`；新增 `v5.0 FROZEN` 行 |
| 7 | 脚注 | 落点行翻为 FROZEN |

**rev.1（提交 1）单独登记**：
修正 §3.0.3 标题的键数标注「**四键**」→「**五条**」，使其与 §5.4 规则 3「`PROMOTION_PROOF(R)` **五条** AND 全真」
及该节实际列出的**五条件**一致。

> ⛔ **该修正不改任何规则语义**：五条件（`active_run_pointer.run_id == R` / `run_history.promoted` /
> `run_history.read_after_write_consistent` / `run_manifest.validation_passed` /
> `run_manifest.revision == active_run_pointer.revision`）在修正前后**完全相同**。
> 修正的动机是消除 **fail-closed 风险**：原标注会让实现者误按 4 条实现，从而漏掉一条 AND，
> 使**未被采纳**的 run 被判为 authoritative。

**⛔ 冻结轮未改**：字段名 / 字段定义 / 纳入排除规则 / 判定阈值 / selector / checkpoint。

---

## 4. ★ 承重 provenance（owner 逐项枚举）

### 4.1 sample identity

```text
(I)   RUN IDENTITY      = { run_id, revision, pointer_revision }
(II)  DATA DATE         = run_candidate_decision.decision_date   （= calc_date）
(III) RUN DATE          = run_manifest.expected_trade_date       （= candidate_portfolio.snapshot_date）
(IV)  CALENDAR TRADE DATE = runtime_status.v365_run_integrity.expected_trade_date
        ⇒ ⛔ **不进 Evidence**（§3.5）；⛔ 不得进入 §5.4 任一条判据

sample_key = <run_id> + '::' + <code>        ← 行唯一键（§3.0.4）
bundle_key = <decision_date>                 ← bundle 唯一键（§5.5）
⛔ pointer_revision 不进 sample_key（对 run_id 函数依赖）；✅ 但进 bundle provenance
```

### 4.2 selector = `S-PROMOTED`

```text
R := active_run_pointer[scope="production"].run_id
     读取一次即 pin 住（pinned_once），⛔ 全程不重读
⛔ 不采用 S-LATEST（任意最新 COMPLETE run）
⛔ 不采用 S-VALIDATED（最新 validation_passed = true 的 run）
```

**实测 pin（as-of 2026-10-02 13:36 +08）**：

```text
R                        = engine:2026-09-30:b1790776862980
active_run_pointer.revision = 1
active_run_pointer.updated_at = 2026-09-30T14:01:11.797Z
```

### 4.3 promotion proof（五条 AND，缺一即 fail-closed）

| # | 条件 | 实读 | 判定 |
|---|---|---|---|
| P1 | `active_run_pointer[production].run_id == R` | `engine:2026-09-30:b1790776862980` == R | ✅ true |
| P2 | `run_history[R].promoted == true` | `true` | ✅ true |
| P3 | `run_history[R].read_after_write_consistent == true` | `true` | ✅ true |
| P4 | `run_manifest[R].validation_passed == true` | `true` | ✅ true |
| P5 | `run_manifest[R].revision == active_run_pointer.revision` | `1 == 1` | ✅ true |

```text
PROMOTION_PROOF(R) = ✅ ALL TRUE（五条 AND）
⇒ Evidence 对象为 **生产已采纳的 authoritative decision**（§5.9）
```

对照：`engine:2026-10-01:b1790812813101`（`revision = 2`）`validation_passed = false` / `promoted = false`
⇒ ⛔ **未被采纳**，⛔ 不得成为 Evidence 对象（**R7**：候选存在 ≠ 生产已消费）。

### 4.4 pointer_revision provenance

```text
pointer.revision ≡ 被提升 run 的 run_manifest.revision（实测二者俱为 1）
⇒ 对 run_id **函数依赖**，对行身份**无区分力** ⇒ ⛔ 不进 sample_key
⇒ ✅ 进 bundle provenance，供 §5.4 规则 2（单调性）与规则 11（A2/A3）校验
```

`run_history[R].cas_reason = "PROMOTED"`；`promoted_at = 2026-09-30T14:01:11.865Z`。

### 4.5 22:00 / 08:00 trigger semantics（**两条自然管线**）

| 管线 | 入口 | cron | 结论 |
|---|---|---|---|
| **22:00** | `fetchDailyData`（`dailyFetch-2200`） | `0 0 22 * * 1-5` | ✅ **唯一**可产出 promoted run 的管线 |
| 08:00 | `materializeIndicators`（`dailyPipeline-0800`） | `0 0 8 * * 1-5` | ⛔ 结构性**永不**通过 `validateCandidateSet` |

**链式传播（可在 `origin/master` 上逐行复核）**：

```text
fetchDailyData/index.js:424        → app.callFunction({ name: 'materializeIndicators', … })
materializeIndicators/index.js:127 → app.callFunction({ name: 'runDecisionEngine', … })
```

**⛔ 必须排除管理侧重入**：`adminGateway/index.js` 的 `:547 riskResolve` / `:578 riskTrigger` /
`:661 paramChange` 会**直接** `callFunction runDecisionEngine` ⇒ 该类调用**不是**自然运行。

**⛔ 关键禁令**：⛔ **不得**要求 `runDecisionEngine` 自身 `request_source == TRIGGER_TIMER`
—— 其 `Triggers = 0`，自然调用**必然**表现为 `TCB_API`；该规则会 **100% 误杀每一次自然运行**。

**实测三跳（可复算，as-of 2026-10-02）**：

| 跳 | 函数 | `request_id` | 时刻（+08） | `request_source` |
|---|---|---|---|---|
| 1 | `fetchDailyData` | `3bc435d3-380b-4328-a39a-f07096231b75` | 2026-09-30 22:00:06 | `TRIGGER_TIMER` |
| 2 | `materializeIndicators` | `1c88d7ae-e117-4256-8549-62a9e48b13ea` | 2026-09-30 22:00:56 | `TCB_API`（链式） |
| 3 | `runDecisionEngine` | `c6ca469a-cc0c-4b24-af4f-dd00b0477134` | 2026-09-30 22:01:02 | `TCB_API`（链式） |

### 4.6 `F-30 / CD-05`

> **`fetchDailyData`（`dailyFetch-2200`，cron `0 0 22 * * 1-5`）此前完全未被登记** ——
> v4.0 §5.8 的 checkpoint 定值依据表**漏列 22:00 管线**（只列 08:00 与 22:20 两条）。

**后果**：v4.0 的 09:00 checkpoint 建立在**不完整的触发器清单**上。
**remedy**：契约 §5.8 checkpoint 重锚为**工作日 `[22:30:00, 23:30:00)`（北京）**。

### 4.7 `F-31 / CD-04`

> **08:00 管线在 `validateCandidateSet` 上结构性永不可通过** ——
> 该门取 RUN DATE（`snapshotDate` = D）比 DATA DATE（`calc_date` = D−1）⇒ 每个 08:00 run **必然** `mixed_date_detected`。

**归属**：契约**不修**（§12 第 10 项）⇒ 属 **V3.6.6 生产需求**，闸门 **G-4**。
**本记录⛔ 未改任何生产代码 / 配置**。

### 4.8 reader migration boundary（`EVIDENCE OBJECT BOUNDARY`，§5.9）

| 字段 | 语义 | 实读（as-of 2026-10-02） |
|---|---|---|
| `authoritative_run_promoted` | 权威 run 是否已被 promotion 采纳 | ✅ `true` |
| `authoritative_read_path_migrated` | **前台**读链是否已迁移到 run 轴 | ⛔ **false**（`apiGateway` / `adminGateway` 仍 `orderBy(...desc).limit(1)`） |
| `reader_migration_status` | reader migration 工程状态 | `PENDING` |
| `legacy_engine_write_stopped` | 引擎是否已停写 legacy 集合 | ✅ `true`（ENFORCE 起） |

> ⛔ **反例必须写明**：`authoritative_run_promoted = true` **时**，
> `authoritative_read_path_migrated` **仍可为 false** —— 今天就正是这一组合。
> ⛔ 不得据前者推断后者（**R7**）。

### 4.9 `CANARY ≠ EVIDENCE ≠ GE-04`

```text
gen1_authority                     = CANARY        （⛔ 非 GUARDED_EFFECTIVE，⛔ 非 PRODUCTION）
gen1_counterfactual_canary_active  = false
gen1_production_write              = false
gen1_auto_execution                = false
ml_effective                       = false
independent_events                 = 0             （门槛 30）
```

⇒ 现处「**会计算、不能采纳**」态。⛔ §3.0.2 的 `S-PROMOTED` 只决定「观察哪一个 run」，
⛔ **不**构成生产授权；⛔ **不得**把本记录读成 `GE-04` 前置条件已完成。

### 4.10 源锚点 ref 绑定（§9.4，**必须与 ref 同时引用**）

⛔ V3.6.5 的 run / decision 完整性模块**不在 `origin/master` 上**；
以下锚点权威 ref = **`feat/v365-production-integrity-impl` @ `d6692983a27a283c61774d6a3bd14fba4ef47e49`**：

| 模块 | 符号 | 行 |
|---|---|---|
| `src/common/utils/v361-run-context.js` | `CASE_A_ALL_EXPECTED` / `CASE_B_PARTIAL_STALE` | `:108` / `:162` / `:447` |
| `src/common/utils/v365-run-integrity.js` | `expected_trade_date`（日历权威源） | `:48-49` / `:337` |
| `src/common/utils/v365-atomic-publish.js` | `validateCandidateSet`（`mixed_date_detected`） | `:120` / `:145` |
| `src/common/utils/v365-publish-store.js` | `classifyPointerPromotion` | `:89`（注释块 `:75-88`） |

`origin/master` 上的锚点：`fetchDailyData/index.js:424`、`materializeIndicators/index.js:127`、
`adminGateway/index.js:547/:578/:661`（管理侧重入）、`adminGateway/index.js:829/:1027`（`PORTFOLIO_SNAPSHOT` upsert，仅资产轴）。

**发现标签对照（保留上游 F 编号）**：`F-30 ↔ CD-05`；`F-31 ↔ CD-04`；`F-37`（上游门 1/2/3 锚点未标 ref）。

---

## 5. 迁移后闸门的**打红自证**结果（§11 规则 5 同批次）

脚本：`scripts/gen1/evidence-capture/c1_gate_redproof.py`

```text
[1] 真实基线（只读实测）          : 14/14 PASS
[2] 归纳基线                      : 14/14 PASS（断言）
[3] 逐条变异（R1…R13）            : 13/13 目标规则必 FAIL ✅
[4] 规则 14（禁令）结构性自证      : evaluate_gate 源码**不含**任何日历量 ✅
[5] §4.2 排除规则 打红（4 项）     : 4/4 EXCLUDED ✅
[6] checkpoint 边界（22:30 窗口）  : 9/9 ✅
[7] SCORING / NON_SCORING 组合    : 4/4 ✅
[8] 契约绑定常量自证              : ✅
────────────────────────────────────────────
合计 31 项 ⇒ ✅ ALL PASS
```

**关键点**：

- 规则 14（⛔ `(IV) CALENDAR TRADE DATE` 不得进入任一判据）为**结构性禁令** ⇒
  以「`evaluate_gate` **签名与实现均不含任何日历量**」自证，⛔ **不用变异法**（无对应状态位）。
  扫描的禁用记号：`calendar_version` / `calendar_expected_trade_date` / `v365_run_integrity` /
  `runtime_status.decision_date` ⇒ **命中 = 无**。
- 变异连带 FAIL 已逐条记录（例：R4 少一只 code ⇒ 连带规则 5/7 亦 FAIL），说明规则间**存在预期耦合**，
  ⛔ 不构成独立性缺陷。

---

## 6. `c1_capture.py` 语义迁移（**与冻结同批次**）

**依据**：契约 **§11 元规则 规则 5** + **§12 第 12 项**。

```text
⛔ 规则 5（照录）：工具（c1_capture.py）的语义迁移与契约冻结**同批次**：
   在 v5.0 冻结之前，⛔ 不得把工具改绑到 v5.0 语义（保持 v3.0 语义运行）
   —— 否则会出现「工具已按未冻结契约采样」的预登记违规。
```

**本批次的处置**：契约冻结（提交 2）与工具改绑（提交 3）在**同一次推送**内完成
⇒ 不存在「工具已按未冻结契约采样」的时间窗。⛔ 冻结前该工具**保持 v3.0 语义**、未改绑。

| 文件 | 落点 | 角色 |
|---|---|---|
| `c1_capture.py` | `scripts/gen1/evidence-capture/` | v5.0 语义 capture（八源 / `S-PROMOTED` / 14 条 gate / 22:30 窗口） |
| `c1_gate_redproof.py` | 同上 | 打红自证（§5） |
| `README.md` | 同上 | 冻结绑定、变更摘要、约束、**环境依赖与已知局限**（如实声明） |

**语义变更摘要（v3.0 → v5.0）**：

1. 读源改绑 **run 轴**（`decision_result` → `run_candidate_decision`；`portfolio_snapshot` → `run_candidate_portfolio`）
2. 源集合 **5 → 8**（新增 `run_manifest` / `active_run_pointer` / `run_history`）
3. **`SELECTOR = S-PROMOTED`**（pin 一次，规则 1 校验 gate 时刻 pointer 仍 == R）
4. 行键 `(date, code)` → **`(run_id, code)`**
5. bundle 新增 `run_id` / `pointer_revision` / `run_manifest.*` / `run_history.*` / `chain_proof`
6. gate **9 → 14 条**
7. checkpoint 09:00 → **工作日 `[22:30:00, 23:30:00)`**
8. CHAIN PROOF 重锚到 **22:00 入口管线**；⛔ 不再要求落在 capture 窗口内

**⚠️ 已知局限（如实声明，⛔ 不掩盖）**：

- SCF 调用日志**不含** `engine_run_id` ⇒ CHAIN PROOF 第 ③ 条以
  「`[START, Report]` 区间包含 `run_manifest[R].created_at`」作**间接**归属证明，
  ⛔ **不主张为直接证得**（已写入 bundle 的 `chain_proof.limitation`）。
- 工具**不在仓库内自带凭据**；依赖只读通道模块 `cb_connect`（经环境变量 `CB_CONNECT_DIR` 指定）。
  默认值指向**开发机绝对路径** ⇒ **已知可移植性债**；本副本的用途是「把**语义**置于版本控制之下、
  与冻结契约同批次」，⛔ 不是提供开箱即用的分发。

---

## 7. 配套证据捕获（只读实测，as-of 2026-10-02 13:36:22 +08）

**闸门链**：`cloudfunctions` 只读通道（`QUERY/find` + `COMMAND/count` + `logs search`）；
**DB 写命令数 = 0**；未调用会产生写入的云函数。

### 7.1 门判定

```text
COHERENCE GATE            : 14/14 PASS（gate_status = PASS）
§4.2 排除规则             : 4/5 未被排除 —— ⛔ 被 §4.2-1 排除
                            （gen1_counterfactual_canary_active = false）
CHECKPOINT                : FAIL（capture 时刻 13:36，⛔ 不在 22:30 窗口）
CHAIN PROOF               : verified = True
⇒ scoring = NON_SCORING
```

### 7.2 工件（仓库外，append-only）

| 项 | 值 |
|---|---|
| 路径 | `_evidence-capture-20261002/2026-09-30__attempt_20261002_133622.json` |
| 字节数 | **6435 B** |
| sha256 | `cdf827c062a962fd54a1b630d60e797c89fc0a19d421c074aa4cadec95a40254` |
| 命名含义 | `__attempt_` 前缀 ⇒ **非正式 bundle**（`scoring = NON_SCORING`）⇒ ⛔ 不作为该日正式样本 |
| 旁车 | 同名 `.sha256` |

```text
⚠️ 该工件**不是**一份正式 Evidence 样本，**不得**计入 Q1/Q2/Q3，⛔ **不得**推进 ≥30。
   其唯一作用是：证明 v5.0 语义的采集链**端到端可运行**，且 gate 在真实数据上**不误杀**。
   ⛔ **冻结 ≠ 开始采样**：本次落盘仅为**迁移验证**，不构成样本累计的启动。
```

### 7.3 CHAIN PROOF 三跳（本次 capture 实读）

| 跳 | 函数 | `request_source` | 计数 / 命中 |
|---|---|---|---|
| 1 | `fetchDailyData` | `TRIGGER_TIMER` | count = 26 |
| 2 | `materializeIndicators` | `TCB_API` | count = 5 |
| 3 | `runDecisionEngine` | `TCB_API` | invocations = 1；命中 `c6ca469a-cc0c-4b24-af4f-dd00b0477134`，区间 `[22:01:02.958, 22:01:12.092]` 包含 `run_manifest[R].created_at`（`2026-09-30T14:01:11.018Z` = 22:01:11.018 +08） |

⇒ ✅ 与 §4.5 的独立取证（先前轮次所得）**逐位一致**，互为交叉验证。

---

## 8. 复算方法（任何人可独立复现，⛔ 不依赖本记录）

```bash
# ① 冻结契约指纹
git -C <repo> rev-parse 05da0efa73e948921bc7b9b60c0d500cc98e3e9b:docs/gen1/GEN1_EVIDENCE_CONTRACT_V5.md
#   → 期望 7f86d12aaed99a877c170c25c5a481f21a661256
git -C <repo> show 05da0ef:docs/gen1/GEN1_EVIDENCE_CONTRACT_V5.md | sha256sum
#   → 期望 4fb9463f4a437e310cb52b04498a1d4cc0f23fbc64eb3c1d846d90a460a9f55b
git -C <repo> show 05da0ef:docs/gen1/GEN1_EVIDENCE_CONTRACT_V5.md | wc -c
#   → 期望 64580

# ② gate 打红自证（⛔ 只读；不落盘）
python scripts/gen1/evidence-capture/c1_gate_redproof.py
#   → 期望 "打红自证结果：✅ ALL PASS（31 项…）"

# ③ 采集（先 dry-run；确认后再落盘）
python scripts/gen1/evidence-capture/c1_capture.py --dry-run
python scripts/gen1/evidence-capture/c1_capture.py
```

**环境变量**（见 `scripts/gen1/evidence-capture/README.md` §6）：
`CB_CONNECT_DIR` / `GEN1_EVIDENCE_ROOT` / `CB_NODE` / `CB_CLI`。

---

## 9. ⛔ 本记录**不**授权的事（逐项显式）

| # | 动作 | 状态 |
|---|---|---|
| 1 | 合并入 `master`（或任何 master 集成） | ⛔ **未授权** —— 属**独立闸门**，须 owner 单独授权 |
| 2 | 生产代码 / 生产配置修改 | ⛔ 未授权（`CD-04` 属 **G-4**） |
| 3 | DB 写入 | ⛔ 未授权（本批次写命令数 = 0） |
| 4 | Authority / `FROZEN_PARAM_KEYS` / lock / `immutable_set` / 生产 Seal 修改 | ⛔ 未授权 |
| 5 | deploy / rollback / `auto_execution` | ⛔ 未授权 |
| 6 | GE-04 晋升 | ⛔ 未授权 |
| 7 | 启动样本累计 / 创建 C-1 自动化任务 | ⛔ 未授权（§12 第 5 项：先手工/半自动跑通 ≥3 个交易日） |
| 8 | 把本工件计入 Q1/Q2/Q3 或 ≥30 | ⛔ **禁止**（§7.2） |
| 9 | 历史回填（`HISTORICAL BACKFILL`） | ⛔ **永久禁止** |

### 9.1 主分支可达性 = **PENDING**（⚠️ 必须显式陈述）

```text
冻结锚定的**对象**（git blob + content sha256）自提交 2 起**已不可变**，且**已推送至 origin**（远程可见）。
但本契约当前只存在于**载体分支** `docs/gen1-evidence-contract-v5-20261002` 上，⛔ **尚未进入 `master`**。
⇒ 本冻结为 **BRANCH-SCOPED FREEZE**：
   · ✅ 冻结事实成立（状态已翻、字节已锚定、可重算）
   · ⚠️ **主分支可达性未达成**；契约在主线上的**可发现性 / 传统性**待合并后方成立
   · ⛔ 合并**不在 G-2 授权内** ⇒ 本记录**不得**被读成「契约已完成 master 集成」
```

> **为什么不先合并再冻结**：合并属**不可逆 Git 闸门**（owner 明确列于禁止清单）。
> 若先合并，则冻结必须在合并之后 —— 那等于**以合并为前置**，会打破「冻结是独立高风险闸门」的设定。
> ⇒ 采**分支域冻结**，并**显式登记**主分支可达性为 `PENDING`，⛔ 不假装已达成。

---

## 10. 交付元数据与断言



---

## 11. 术语与缩写

| 缩写 | 全称 | 含义 |
|---|---|---|
| `CD-03` | — | 同名不同义（v4.0 §3.5 把日历权威源与 `run_manifest.expected_trade_date` 混在同一格） |
| `CD-04` ↔ `F-31` | — | 08:00 管线 `validateCandidateSet` 字段误用（RUN DATE vs DATA DATE） |
| `CD-05` ↔ `F-30` | — | v4.0 checkpoint 定值依据表漏列 `dailyFetch-2200`（22:00 管线） |
| `F-37` | — | 上游门 1/2/3 锚点未标 ref ⇒ 由契约 §9.4 修正 |
| `R7` | 承重墙 7 | 生产 authoritative read path 与 candidate/promotion path 必须明确区分 |
| `S-PROMOTED` | selector | 只观察 `active_run_pointer[production]` 所指向的已采纳 run |

---

*本记录由 `WP-G1-EVIDENCE` 工作包 v5.0 的 **G-2（FREEZE + SEAL）** 轮产出（OWNER-AUTHORIZED AUTONOMOUS GOVERNANCE）。*
*落点：`docs/gen1/GEN1_EVIDENCE_CONTRACT_V5_FREEZE_SEAL_RECORD_20261002.md`*
*⛔ 本记录不授权任何生产变更；⛔ 不构成 `GE-04`；⛔ 不表示生产已消费 Gen-1 决策。*
