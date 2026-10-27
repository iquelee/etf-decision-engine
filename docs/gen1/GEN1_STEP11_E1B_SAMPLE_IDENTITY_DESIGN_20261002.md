# PHASE 1 / Step 1.1-E1b — Evidence Contract v4 **读源改绑 candidate/promotion 链** 前置设计分析

> 报告编号：`WP-G1-EVIDENCE / E1b / 20261002`
> 性质：**只读设计分析**（READ-ONLY DESIGN ANALYSIS）——⛔ 不改契约、⛔ 不改仓库、⛔ 不改生产件、⛔ 不改 DB
> 授权来源：Owner 本轮明确授权（E-1b 前置设计裁定；**非**契约修改授权 / **非** CONTRACT GENERATION 授权 / **非**仓库写授权）
> 生成时刻：`2026-10-02T02:15:17Z`（北京 `2026-10-02 10:15:17 +0800`）
> 判定：**完成**（三方案未选边；承重设计点 A / B 已给足裁定信息；⛔ 未自行选择最终方案）
> ⛔ 本报告**不授权**任何修改、不授权生成新契约、不授权仓库写入、不授权生产变更、不授权冻结。

---

## 0. 本步边界与只读声明

**只读做的事**：
1. 复读 v4 契约（`_v4-contract-20260923` worktree，detached HEAD，tracked status 空）全文相关节；
2. 复读**线上 V3.6.5 已部署包**（`_cb-connect-20260921/bundle-src/`）的 promotion / candidate / pointer / reader 代码；
3. 云端**只读**实读 9 个集合（`run_manifest` / `run_history` / `active_run_pointer` / `run_candidate_decision` /
   `run_candidate_portfolio` / `decision_result` / `portfolio_snapshot` / `ml_shadow_signal` / `runtime_status`）；
4. 纯内存字段映射与一致性推导。

**本步 ⛔ 未做**：未修改 Evidence Contract（任何版本）；未修改任何仓库跟踪文件；未修改 PR #60；
未修改生产代码 / 配置 / DB / Authority / Seal / lock / immutable_set；未修改 candidate / pointer / decision_result；
未做 reader migration；未碰 CALC / ORCH / health / canary / permission / overlay；未 commit / push / PR / merge / deploy / freeze；
未处理 E-2 / E-3 / E-4 / E-5；未进入 Step 1.2 / PHASE 2 / PHASE 3。

**数据源时间戳（实时只读）**：
- `runtime_status.updated_at` = `2026-10-01T00:00:22.690Z`（北京 `2026-10-01 08:00:22`）
- `active_run_pointer.updated_at` = `2026-09-30T14:01:11.797Z`（北京 `2026-09-30 22:01:11`）
- 云端凭据：账号级登录 `READY` / env `tradingview-etf-d0fa42yy57cbc11b`（`ap-shanghai`）

---

## 1. 审查客体与现状快照

| 项 | 值 |
|---|---|
| v4 契约路径 | `docs/gen1/GEN1_EVIDENCE_CONTRACT_V4.md`（worktree `_v4-contract-20260923`） |
| v4 载体 HEAD | `8d1f1cde5effa8bf6eb3d88b780f84e3873337ef`（detached；tracked status = 空） |
| v4 指纹（worktree 实文件） | **CRLF sha256 `80da4d99f9fdb5c9f54856210b5dc0fc06edcc8d8b2371a699f0bd5c5fa8f7c5`** / 38137 B / 709 行 |
| v4 状态头 | `⛔ DRAFT — NOT FROZEN — NOT AUTHORIZED FOR EXECUTION` |
| PR #60 | `state=open` / `merged=false` / `mergeable_state=behind` / base `e93f396` / head `8d1f1cd` |
| 现行生效契约 | v3.0（载体文件名仍 `..._V2.md`，冻结于 2026-09-21；命名债已登记） |
| 本步判定（承袭 Step 1.1 / E-1） | `READY_FOR_OWNER_FREEZE = ❌ 否` / `BLOCKED = ✅ 是`；Owner 暂定方向 = **①b（改绑 candidate / promotion 链）** |

> ⚠️ 承袭记录：Step 1.1 已确认 **B-1**（CD-02 remedy 字段在 ENFORCE 下不可产生）、**B-2**（v4 §3 主读源
> `decision_result` 在 ENFORCE 下停写）、**B-3**（PR #60 body 指纹绑到第 1 提交而非 head）。本步**不重复**，
> 只就 ①b 给出设计面分析。

---

## 2. 承重设计点 **A**：Evidence 应消费哪一个 run？

### 2.1 事实基线 —— candidate / promotion 链的**实读**数据（as-of 2026-10-02 10:15 +08）

**`run_manifest`（共 2 行）**

| run_id | revision | expected_trade_date | status | validation_passed | validation_reason | created_at |
|---|---|---|---|---|---|---|
| `engine:2026-10-01:b1790812813101` | **2** | **`2026-10-01`** | COMPLETE | **false** | **`mixed_date_detected`** | `2026-10-01T00:00:21.701Z` |
| `engine:2026-09-30:b1790776862980` | 1 | `2026-09-30` | COMPLETE | **true** | `ok` | `2026-09-30T14:01:11.018Z` |

**`run_history`（共 2 行）**

| run_id | promoted | cas_reason | promoted_at | read_after_write_consistent | created_at |
|---|---|---|---|---|---|
| `engine:2026-10-01:b1790812813101` | **false** | `null` | `null` | `null` | `2026-10-01T00:00:22.529Z` |
| `engine:2026-09-30:b1790776862980` | **true** | **`PROMOTED`** | `2026-09-30T14:01:11.865Z` | **`true`** | `2026-09-30T14:01:11.865Z` |

**`active_run_pointer`（共 1 行）**（`_id = active_run_pointer::production`）

```text
run_id              = engine:2026-09-30:b1790776862980
revision            = 1
expected_trade_date = 2026-09-30
scope               = production
updated_at          = 2026-09-30T14:01:11.797Z
```

**`run_candidate_decision`（共 10 行 = 2 run × 5 code）**

| run_id | code | decision_date | calc_date | suggested_position | gen1_counterfactual_suggested_position | delta | v361_baseline_stage | effective_market_regime |
|---|---|---|---|---|---|---|---|---|
| `engine:2026-10-01:…` | 513310 | **2026-09-30** | 2026-09-30 | 8.3 | 8.3 | 0 | S0 | crisis |
| `engine:2026-10-01:…` | 159582 | 2026-09-30 | 2026-09-30 | 7.1 | 7.1 | 0 | S1 | crisis |
| `engine:2026-10-01:…` | 515880 / 159570 | 2026-09-30 | 2026-09-30 | 0 | 0 | 0 | S0 | crisis |
| `engine:2026-10-01:…` | 518880 | 2026-09-30 | 2026-09-30 | 0 | 0 | 0 | S0 | （缺键） |
| `engine:2026-09-30:…` | 513310 | **2026-09-30** | 2026-09-30 | 8.3 | 8.3 | 0 | S0 | crisis |
| `engine:2026-09-30:…` | 159582 | 2026-09-30 | 2026-09-30 | 7.1 | 7.1 | 0 | S1 | crisis |
| `engine:2026-09-30:…` | 515880 / 159570 | 2026-09-30 | 2026-09-30 | 0 | 0 | 0 | S0 | crisis |
| `engine:2026-09-30:…` | 518880 | 2026-09-30 | 2026-09-30 | 0 | 0 | 0 | S0 | （缺键） |

**`run_candidate_portfolio`（共 2 行）**

| run_id | snapshot_date | decision_market_regime | market_regime | market_regime_divergent | asset_source | total_asset | written_at |
|---|---|---|---|---|---|---|---|
| `engine:2026-10-01:…` | **`2026-10-01`** | **`crisis`** | `defensive` | `true` | live | 98909.5 | `2026-10-01T00:00:22.187Z` |
| `engine:2026-09-30:…` | **`2026-09-30`** | **`crisis`** | `defensive` | `true` | live | 98909.5 | `2026-09-30T14:01:11.501Z` |

> ✅ 关键实读结论 1：`run_candidate_portfolio` **同时含** `decision_market_regime`（= `crisis`）**与** `snapshot_date`（= 该 run 的运行日）
> ⇒ v4 §3 字段 3（CD-02 remedy）所需字段**在 candidate 链里确实已产生**（Step 1.1 的 B-1 是「落点在已停写集合」，不是「字段不存在」）。
> ✅ 关键实读结论 2：`run_candidate_decision.decision_date` **= `calc_date` = 数据日（2026-09-30）**，与 run 的运行日（run_id 内含 `2026-10-01`）**不同**
> ⇒ §3.1「双日期双组」的结构在 candidate 集合内部**完整保留**（组 A 取 `candidate_portfolio.snapshot_date`；组 B 取 `candidate_decision.decision_date`）。

**对照：legacy 侧实读**

| 集合 | 行数 | 最新日期键 | 值 | 备注 |
|---|---|---|---|---|
| `decision_result` | **161** | `decision_date` = **`2026-09-29`** | — | ENFORCE 后停写；落后于数据日 09-30 |
| `portfolio_snapshot` | **41** | `snapshot_date` = **`2026-09-30`** | `decision_market_regime = crisis` | ENFORCE 后不再由引擎写；资产字段另有写方（见 §4.6） |
| `ml_shadow_signal` | **133** | `date` = **`2026-09-30`** | 5 票齐（513310/515880/159582 PARTIAL_COVERAGE；518880 OUT_OF_DOMAIN；159570 IN_DOMAIN） | 22:20 独立 lane |
| `runtime_status` | 1（单例） | `decision_date` = **`2026-10-01`** | `v365_mode=ENFORCE` / `v365_authoritative_publish_status=NOT_PROMOTED` / `v365_promotion_attempted=false` / `canary_active=false` / `independent_events=0` | `updated_at 2026-10-01T00:00:22.690Z` |

### 2.2 两个选项的**精确语义**

**选项 ①** —— 消费**任意最新** `run_candidate_*`
```text
selector = max(run_candidate_*.run_id)（或 max(written_at)）
实测 ⇒ run_id = engine:2026-10-01:b1790812813101（revision 2）
      而该 run 的 run_manifest.validation_passed = false（mixed_date_detected）
      ⇒ 消费的是一个「生产侧显式判为不合格」的 run
```

**选项 ②** —— 只消费**已 promoted 且指针有效**的 run
```text
selector = active_run_pointer::production.run_id（读一次 → pin 住）
实测 ⇒ run_id = engine:2026-09-30:b1790776862980（revision 1）
      run_history.promoted = true / cas_reason = PROMOTED / read_after_write_consistent = true
      run_manifest.validation_passed = true
      ⇒ 消费的是「生产侧 promotion 已接受」的 run
```

### 2.3 两者的事实差异（⛔ 仅列事实，不排序）

| 维度 | ① latest-candidate | ② promoted-only（pointer 绑定） |
|---|---|---|
| **实测会读到哪个 run** | `engine:2026-10-01:…`（rev 2，validation **失败**） | `engine:2026-09-30:…`（rev 1，validation 通过，promoted） |
| **该 run 的 promotion 状态** | `run_history.promoted = false` | `run_history.promoted = true` |
| **该 run 的 validation** | `mixed_date_detected`（= 生产**显式拒绝**它成为 authoritative） | `ok` |
| **与生产前台读源的对应** | ⛔ 不对应任何读源（前台 legacy 读 `decision_result`/`portfolio_snapshot`；迁移目标读 pointer） | ✅ 与 reader-migration **目标读源**同构（`v365-active-read.js` 的 `authority_selector = active_run_pointer.run_id`） |
| **与 `FORBIDDEN_READ_PATTERNS` 的关系** | ⚠️ 「按日期/最新取一条」**正是**被列为反模式的形态（`LATEST_BY_UPDATED_AT` / `CANDIDATE_WITHOUT_RUN_BINDING` 的警示对象）；可 pin run_id 规避跨 run 混读，但「最新选择」本身即反模式语义 | ✅ 与 `CANDIDATE_WITHOUT_RUN_BINDING` 反向（**必须**绑定 `active_run_id`） |
| **与 v4 §4「通路正常态」** | ⚠️ 读到的是 `mixed_date_detected` 的 run（= 对齐失败的 run），说明该 run **未处于通路正常态** | ✅ 读到的是通过 finality + validation + CAS 三重门的 run |
| **与 v4 §5.4 组 A 的关系** | 组 A 若取 `candidate_portfolio.snapshot_date (2026-10-01) == runtime_status.decision_date (2026-10-01)` ⇒ ✅ PASS | 组 A 若沿用 `== runtime_status.decision_date`（单例 = 10-01）⇒ **FAIL**（candidate 为 09-30）；须改判为 **run 内自洽**（见 §3.4） |
| **与 v4 §5.4 组 B 的关系** | `candidate_decision.decision_date (09-30) == ml_shadow_signal.date (09-30)` ⇒ ✅ PASS | 同 ⇒ ✅ PASS |
| **可产出性（今天）** | 有数据可读（10-01 run 完整），但**validation 失败** | 有数据可读（09-30 run 完整）；但指针自 `2026-09-30T14:01:11.797Z` 起**未再前进** |
| **长期可产出性** | 只要 runDecisionEngine 每交易日跑 ⇒ 每日可读（但可能读到不合格 run） | 依赖 **promotion 成功**；若 promotion 持续被拒（如 10-01 的 `mixed_date_detected`）⇒ **Evidence 断供** |
| **Evidence 是否引入依赖** | 无外部依赖（纯读最新） | ⚠️ 引入对「生产 promotion 结果」的依赖 —— 但**仅读取**，不触发写（符合 §5.1「Evidence ⛔ 不是生产 DB 写入」） |

**⚠️ 一个必须并列陈述的事实（新登记 F-11，见 §8）**：
`run_manifest.expected_trade_date` 的**实测取值 = `snapshotDate`（北京运行日）**（`index.js:1000/1189/1350`
`expected_trade_date: snapshotDate`），而 `validateCandidateSet` 用它去比对 `candidate.calc_date`（**数据日**）。
⇒ 10-01（非交易日/数据未更新）时 `2026-10-01 ≠ 2026-09-30` ⇒ 判 `mixed_date_detected` ⇒ 不 promotion。
**这是 F-4 双语义的直接后果，也是「② promoted-only 今天会断供」的直接原因。**（本步只登记，⛔ 不修复。）

### 2.4 对核心问题的回答

> **「Evidence 的样本对象究竟应该是『最新计算结果』，还是『已经被生产 promotion 接受的结果』？」**

本步**不给结论**（属 Owner 裁定）。但给足裁定所需的**判据结构**：

1. **契约自身的立场线索（v4 已写下的）**：
   - §4.1「合格交易日」定义含 **通过 §5 Bundle Coherence Gate**；§4.2 排除「通路非正常态」⇒ **语义上倾向「已接受/合格」**；
   - §5.1 C-1 明确 Evidence 是**外部只读快照**、⛔ 不是生产 DB 写入 ⇒ Evidence 可以**依赖生产的既有状态**（包括 promotion 结果），但不得改变它；
   - §5.4 规则 1「`runtime_status` 必须是本 checkpoint 前**最新自然运行**」⇒ 现行文本**按运行**取，而非按 promotion 取；
   - ⇒ ⚠️ **现行 v4 文本既未写「promoted-only」，也未写「latest-candidate」** —— 该 selector 在 v4 中是**空缺**（这正是 ①b 必须新增的子条款）。
2. **判据分叉点（请 Owner 就以下两问择一）**：
   - **问 A-1**：Evidence 观察的是「**生产的决定**（authoritative）」还是「**生产的计算**（candidate）」？
     ⇒ 若「决定」= ②；若「计算」= ①。
   - **问 A-2**：Evidence 的产出是否**允许被生产 promotion 的健康度阻断**？
     ⇒ ② 会引入该耦合（今天即表现断供）；① 不会，但会读到不合格 run。
3. **一条可分离的设计选项（⛔ 不作为推荐，仅列出供裁定）**：Evidence 可消费「**最新 COMPLETE 且 validation 通过的 run**」
   —— 介于 ① 与 ② 之间（不要求 promotion，但要求 validation passed）。本步**不展开**，登记为待裁定项 A-3。

### 2.5 ⛔ 本步对 A 的处置

**未选边、未排序、未推荐。** 已把「实测会读到哪个 run」「两问判据」「可分离选项」全部列出。⛔ 最终选择权在 Owner。

---

## 3. 承重设计点 **B**：Evidence 中的 date 采用什么语义？

### 3.1 字段语义矩阵（全字段，含**实测值**）

| # | 字段（集合） | 实测值（10-01 run / 当前态） | **语义轴** | 说明 |
|---|---|---|---|---|
| 1 | `run_manifest.run_id` / `engine_run_id` | `engine:2026-10-01:b1790812813101` | **RUN IDENTITY** | 构造式 `'engine:' + 北京运行日 + ':' + hash`（`index.js:528-529`）；内含**北京运行日** |
| 2 | `run_manifest.revision` | `2` | **RUN IDENTITY** | 单调时钟；promotion 前 pointer.revision + 1 |
| 3 | `run_manifest.expected_trade_date` | **`2026-10-01`** | **RUN DATE**（⚠️ 名实不符） | 写入值 = `snapshotDate`（北京运行日），**非**日历口径的交易日 |
| 4 | `active_run_pointer.expected_trade_date` | `2026-09-30` | **RUN DATE**（⚠️ 同 3） | = 被提升 run 的 manifest 值（同源） |
| 5 | `run_candidate_portfolio.snapshot_date` | **`2026-10-01`** | **RUN DATE** | = `snapshotDate`；10-01 run 为 10-01，09-30 run 为 09-30 |
| 6 | `runtime_status.decision_date` | **`2026-10-01`** | **RUN DATE** | 单例；最后写入者 |
| 7 | `portfolio_snapshot.snapshot_date`（legacy） | `2026-09-30` | **RUN DATE** | 停写于 ENFORCE 切换 |
| 8 | `run_candidate_decision.decision_date` | **`2026-09-30`** | **DATA DATE** | 逐票；= `calc_date` |
| 9 | `run_candidate_decision.calc_date` | **`2026-09-30`** | **DATA DATE** | 指标快照日 |
| 10 | `decision_result.decision_date`（legacy） | `2026-09-29` | **DATA DATE** | 停写 ⇒ 落后于真实数据日（B-2 根因） |
| 11 | `ml_shadow_signal.date` / `source_trade_date` | `2026-09-30` | **DATA DATE** | 22:20 lane |
| 12 | `v365_run_integrity.expected_trade_date` | **`2026-09-30`** | **CALENDAR TRADE DATE** | 日历权威源（`cn-a-share-2026.1`）；⛔ 不得用 max(calc_date) 代替 |
| 13 | `v365_run_integrity.observed_latest_date` | `2026-09-30` | **DATA DATE（观测值）** | required 快照 calc_date 最大值 |
| 14 | `v365_run_integrity.effective_as_of_trade_date` | `2026-09-30` | **DATA DATE（有效值）** | 仅当 required 全部 == expected 时 = expected |
| 15 | `v365_run_integrity.date_alignment_case` | `CASE_A_ALL_EXPECTED` | **DIAGNOSTIC** | 对齐分类 |
| 16 | `run_history.created_at` / `written_at` / `updated_at` | `2026-10-01T00:00:22.529Z` … | **WALL CLOCK** | ⛔ 不得用作 run 身份（`LATEST_BY_UPDATED_AT` 禁止） |

### 3.2 「双语义冲突」的**根因**

Owner 指出的冲突：`run_manifest.expected_trade_date = 2026-10-01`，而 `v365_run_integrity` 的 calendar/trade date = `2026-09-30`。

**根因（实读 + 代码）**：**同名不同义** —— 两个 `expected_trade_date` 在**不同轴**上：

```text
① run_manifest.expected_trade_date
   ← index.js:1350 写入 `expected_trade_date: snapshotDate`
   ← snapshotDate（:1000/:1189）= new Date(Date.now()+8h).toISOString().slice(0,10) = 北京"今天"
   ⇒ 语义 = RUN DATE（运行日）

② runtime_status.v365_run_integrity.expected_trade_date
   ← v365-run-integrity.js buildRunTelemetry()（:337）取自 RunContext 的 env.expected_trade_date
   ← 由 cn-trading-calendar 权威源解析（v361-run-context.js:226「本文件不自行推断」）
   ⇒ 语义 = CALENDAR TRADE DATE（日历交易日）
```

⇒ **两者同名、不同轴、在当前态实测相差 1 天**（10-01 vs 09-30）。
⚠️ 附带后果（F-11）：`validateCandidateSet`（`v365-atomic-publish.js:141-145`）拿 ①（RUN DATE）去比 `candidate.calc_date`（DATA DATE）
⇒ 在「运行日 ≠ 数据日」的交易日必然判 `mixed_date_detected`。**这是生产链内部的口径错配，本步只登记、⛔ 不修复。**

### 3.3 是否应成为**三个不同概念**？

**设计分析结论**：概念上**确实是三个不同的量**；但**只有两个应进入 Evidence 契约**，第三个按 v4 §3.5 应留在宿主侧。

| 概念 | 定义 | 载体（实读） | 是否进 Evidence | 理由 |
|---|---|---|---|---|
| **(I) run identity** | 「这是哪一次运行」 | `run_id` + `revision`（+ 读取时 pin 住的 `pointer.revision`） | ✅ **进**（作为**行键的分量 / provenance**，不是统计量） | 防跨 run 混读；使 (ii) 可在同一 run 内自洽；对应 `authority_selector` |
| **(II) decision date** | 「这条样本的**决策数据日**」 | `run_candidate_decision.decision_date`（= `calc_date`） | ✅ **进**（= v4 §3 字段 1 `date`；forward 收益的 T0） | 保 v4 §3 字段 1 的「数据最新日」语义；保 §5.4 组 B（对 `ml_shadow_signal.date`） |
| **(III) market / trade date** | 「日历口径的**目标交易日**」 | `v365_run_integrity.expected_trade_date` | ⛔ **不进**（按 v4 §3.5 = HOST-LOCAL DIAGNOSTIC） | §3.5 已裁定日期口径**不扩展为三日期**；若 Owner 要它进 Evidence，= 触发 §3.5 **重审** ⇒ 须走 §11 元规则发新版本 |

⇒ **结论**：(I)(II)(III) **应作为三个相互独立的概念被建模与命名**（当前生产链的**病根**正是把 (I)/(III) 混用同一个名字 `expected_trade_date`）。
但在 **Evidence 契约层**，只有 **(I) run identity** 与 **(II) decision date** 入契约；**(III)** 明确留在宿主、并**如实标注为 host-local**。

> ⚠️ 若 Owner 选择让 (III) 也进 Evidence（例如把 Evidence.date 改为 calendar trade date），则这不是 ①b 的「读源改绑」，
> 而是 **§3.1 日期模型变更**（双日期 → 三日期），属 §11 元规则下的**实质性修正** ⇒ 需独立授权。

### 3.4 与 v4 §3.1 / §5.4 的关系（组 A / 组 B 的**重定义**）

现行 v4 的双组（§3.1）：

```text
组 A（RUN DATE）  : runtime_status.decision_date  ==  portfolio_snapshot.snapshot_date
组 B（DATA DATE） : decision_result.decision_date ==  ml_shadow_signal.date
```

①b 下的**最小重定义**（⛔ 仅给设计方案，不改契约）：

```text
组 A（RUN DATE，改为 **run 内自洽**）：
    run_candidate_portfolio.snapshot_date  ==  run_manifest.expected_trade_date（同 run）
    ⛔ 不再对 runtime_status.decision_date（单例、最后写入者）做跨源比较

组 B（DATA DATE，左端改绑 candidate）：
    run_candidate_decision.decision_date   ==  ml_shadow_signal.date
```

**重定义的必要性（实读证据）**：
- 若组 A 仍沿用「对 `runtime_status.decision_date`」：② promoted-only 时 `candidate_portfolio.snapshot_date = 09-30`
  而 `runtime_status.decision_date = 10-01`（单例已被 10-01 run 覆盖）⇒ **必 FAIL**（工具性误杀）。
- 改为 **run 内自洽**后，两个 run 各自 ✅ PASS（10-01 run：10-01==10-01；09-30 run：09-30==09-30）。
- 组 B **①b 下两个 run 均 ✅ PASS**（candidate `decision_date 09-30` == `ml_shadow_signal.date 09-30`）；
  而 legacy（①a/①c）下 **FAIL**（`decision_result.decision_date 09-29` ≠ `09-30`）⇒ **①b 实质修复 B-2 的组 B 分支**。

---

## 4. C：E-1b 对 **B-1 / B-2 / §3 / §5 / §12** 的最小影响

### 4.1 必须从 legacy **迁移到** candidate / promotion 的字段

| Evidence 字段（v4 #） | 现行绑定（legacy） | ①b 目标绑定（candidate） | 实读可满足？ |
|---|---|---|---|
| #1 `date` | `decision_result.decision_date` | **`run_candidate_decision.decision_date`** | ✅ `2026-09-30` 已产生 |
| #3 `regime` | `portfolio_snapshot.decision_market_regime` | **`run_candidate_portfolio.decision_market_regime`** | ✅ `crisis` 已产生 |
| #4 `stage` | `decision_result.v361_baseline_stage` | **`run_candidate_decision.v361_baseline_stage`** | ✅ S0/S1 已产生 |
| #7 `baseline_suggested_position` | `decision_result.suggested_position` | **`run_candidate_decision.suggested_position`** | ✅ 已产生 |
| #8 `counterfactual_suggested_position` | `decision_result.gen1_counterfactual_suggested_position` | **`run_candidate_decision.gen1_counterfactual_suggested_position`** | ✅ 已产生 |
| （组 A 右端） | `runtime_status.decision_date` | **`run_manifest.expected_trade_date`（同 run）** | ✅ 已产生 |

> 说明：上述字段在 candidate 集合中**全部实读在位**（§2.1）。⇒ ①b **不是**要求生产新产生字段，而是**改绑读取位置**。

### 4.2 仍**可继续来自现有集合**的字段

| Evidence 字段（v4 #） | 来源 | 是否受 ENFORCE 影响 |
|---|---|---|
| #2 `code` | Main5 常量 | 否 |
| #5 `domain_status` | `ml_shadow_signal.domain_status` | 否（22:20 独立 lane，仍在写） |
| #6 `probability` | `ml_shadow_signal.calibrated_probability` / `ml_probability` | 否 |
| #9 `delta_position` | #8 − #7（派生） | 否 |
| #10–#14 `forward_*` / `MFE` / `MAE` | `etf_daily`（official bars） | 否（样本成熟后回填） |
| #15 `false_fast_path` | 派生自 `forward_5d` | 否 |
| #16/#17 `event_cluster_id` / `independent_event` | 契约内计算规则（§3.4） | 否 |
| eligibility（§4.2 四条 + §5.3） | `runtime_status` 主字段 + `tcl logs`（C-1 外部快照） | 否（C-1 设计已把「逐日留存」问题外置解决） |

⇒ **不变的部分占多数**：ml_shadow / eligibility / forward / 聚类 全部**不受 ①b 影响**。

### 4.3 是否需要建立**统一的 Evidence sample identity**？

**需要**（设计结论）。理由（实读支撑）：
1. 现行 v4 的行键仅为 `(date, code)`；而 candidate 链的**权威身份是 `run_id`**（同一 `decision_date` 可对应**多个 run**——实测 10-01 run 与 09-30 run **共享** `decision_date = 2026-09-30`）
   ⇒ 仅用 `(date, code)` **会产生键碰撞**（两个 run 的 5 票都算 `2026-09-30`）。
2. `active_run_pointer` 是**单指针**、`run_history` 已有 `supersedes_run_id` / `same_trade_date_supersede` ⇒ **同一交易日 supersede 是已建模的现实**（`v365-atomic-publish.js:217-220`）。
⇒ **必须**把 `run_id` 引入 identity，否则违反 §5.5「one-decision-date / one-official-bundle」的可判定性。

### 4.4 如何**避免 candidate 尚未 promoted 时被 Evidence 捕获**？

（⛔ 仅列**可用机制事实**，由 Owner 决定是否采用）
- `v365-active-read.js::readAuthoritativeDataset`（:458）已实现「**只读一次 pointer → pin run_id → 全部 run-bound 读取绑定该 run_id**」
  + `checkRunCoherence`（:384，所有记录 `run_id == active_run_id`）+ `authoritativeUnavailable`（:419，**fail-closed，不回退 latest**）
  ⇒ 采用 **② promoted-only** 时，该函数**天然**满足「未 promoted 不被捕获」。
- 采用 **① latest-candidate** 时，须**自行**增加「`validation_passed == true`」等门 —— 而该门**当前不存在**于 v4 文本，须新增子条款。
- `run_history.promoted` 是**唯一**给出「是否已被 promotion 接受」的**显式**布尔（`index.js:1396`；实测 09-30 `true` / 10-01 `false`）。

### 4.5 如何**避免 promotion 后 Evidence 读到不同 revision**？（同 run，不同读取时刻）

- **单指针 pinning**：`readAuthoritativeDataset` 一次读 pointer、全程不重读（`:476 pinnedRunId`；`pinned_once: true`）。
- **run 产物不可变**：candidate 文档按 `(run_id, code)` 键写入（`putCandidate`，`index.js:549/560`），append-only；promotion **不修改** candidate 内容，只切 pointer。
- **revision 记录**：`run_history.read_after_write_consistent = true`（实测 09-30）；bundle 应记录**读取时的 `pointer.revision`**（当前 1）。
- ⚠️ 待 Owner 裁定（B-1 细化）：Evidence 是否要求 **`promoted == true` 且 `read_after_write_consistent == true`** 双条件？（实测 09-30 两者皆真；10-01 皆假/空）

### 4.6 `portfolio_snapshot` 与 `run_candidate_portfolio` 的**语义差异**

| 维度 | `portfolio_snapshot`（legacy） | `run_candidate_portfolio`（candidate） |
|---|---|---|
| 写入方 | ① 引擎（仅 LEGACY 模式，`index.js:558`）；② **`adminGateway.persistLiveSnapshot`（:829）**；③ 资产编辑（:1027） | 仅引擎（ENFORCE 模式，`putCandidate`，`index.js:560`） |
| 语义轴 | **混合**：run 产物 + **MUTABLE_STATE**（用户维护资产字段） | **纯 run 产物**（immutable per run） |
| 是否仍被写 | ✅ 资产字段**仍被 adminGateway 写**（MUTABLE 轴，按自身日期键 upsert） | ✅ 每次 ENFORCE run 写一次 |
| `decision_market_regime` | 有（legacy 遗留，实测 09-30 = crisis） | 有（run 产物，实测 crisis） |
| `snapshot_date` | = 运行日（≈）；但资产字段可**独立于 run** 更新 | = 该 run 的运行日（**与 run 强绑定**） |
| 行数 / 最新 | 41 / `2026-09-30` | 2 / 两个 run |
| `v365-active-read` 定位 | 属 `ALLOWED_LATEST_READS`（MUTABLE_STATE 轴），**不是** authoritative run 产物 | 属 authoritative run dataset（pointer-bound） |

⇒ **关键差异**：`portfolio_snapshot` 的**资产字段**是「持续变化的现实状态」（另一轴），**不能**当 run 产物用；
而 `run_candidate_portfolio` 是**与 run 强绑定、不可变**的产物。
⇒ ①b 下 `Evidence.regime` 应取 **candidate**（run 产物），⛔ 不得取 `portfolio_snapshot`（混合/legacy）。
⚠️ 注意事项：`run_candidate_portfolio` 里**同时**含资产字段（`total_asset` 等），Evidence **只应取 `decision_market_regime`**，
⛔ 不得把 candidate 组合快照整体当作「资产现状」（那是 MUTABLE 轴的事）。

### 4.7 B-1 / B-2 在 ①b 下的状态（⛔ 未选边，仅事实）

| 阻塞 | ①b 下的**事实**状态 | 备注 |
|---|---|---|
| **B-1**（regime remedy 字段不可产生） | **实质可解** —— 字段在 `run_candidate_portfolio` **已产生**（`crisis`）；须把 §3 字段 3 / §3.1 的**集合**由 `portfolio_snapshot` 改为 `run_candidate_portfolio` | 以**契约改版**为条件 |
| **B-2**（§3 主读源停写 / 组 B 发散） | **实质可解（组 B）** —— `candidate_decision.decision_date (09-30) == ml_shadow_signal.date (09-30)` ✅；**组 A 须改判为 run 内自洽**（§3.4） | 以**契约改版** + 组 A 重定义为条件 |

> ⚠️ 但「**B-1/B-2 可解** ≠ **Evidence 今天就能出样本**」：另有**独立**原因 `gen1_counterfactual_canary_active = false`（§4.2-1 排除），**E-1b 不解决此层**（与 E-1 结论一致）。

---

## 5. **最小契约改动面**（逐节，⛔ 仅列待改点，不改任何字节）

| 节 | 待改内容 | 类型 |
|---|---|---|
| **§3.1** | `Evidence.regime` 关联集合：`portfolio_snapshot` → **`run_candidate_portfolio`**；`Evidence.date`：`decision_result` → **`run_candidate_decision`** | 改绑 |
| **§3 字段表** | #1 `date`、#3 `regime`、#4 `stage`、#7/#8 `suggested_position` 的**来源列**改绑 candidate | 改绑 |
| **§3.1 双日期双组** | 组 A 定义改为 **run 内自洽**（`candidate_portfolio.snapshot_date == run_manifest.expected_trade_date`）；组 B 左端改 `candidate_decision.decision_date` | 重定义 |
| **§3（新增）** | **Evidence sample identity** 定义（`run_id` + `revision` + `decision_date` + `code`）与 **selector**（promoted-only / latest-validation-passed，**待 Owner 裁定**） | 新增 |
| **§3.5** | 维持「宿主内部量排除」——但须**显式声明** `run_manifest.expected_trade_date` 的**名实不符**（= RUN DATE，非日历交易日），避免读者误当 (III) | 澄清 |
| **§5.3 五源** | 五源中 2 源改绑：`raw decision_result` → `raw run_candidate_decision`；`raw portfolio_snapshot` → `raw run_candidate_portfolio`；建议**新增** `raw run_manifest` + `raw active_run_pointer`（绑定 run identity） | 改绑 + 新增 |
| **§5.4 规则 4/5/7** | 规则 5（组 B）左端改 candidate；规则 7（组 A）改 run 内自洽；规则 1/2（`runtime_status` 前进性）须重审（单例 vs pointer revision） | 重定义 |
| **§5.5** | 「one-decision-date / one-official-bundle」须叠加 **run identity**（同 `decision_date` 多 run 时的取舍） | 补充 |
| **§9.1 来源表** | 「建议仓 / stage / 反事实 / regime」来源列全部改 candidate | 改绑 |
| **§11 变更日志** | 新增 v4.x/v5.0 行，写明**是否作废既有样本**（实测 = **0 行**） | 留痕 |
| **外部工具（非契约）** | `_evidence-capture-tool/c1_capture.py`：现硬编码 `contract_version="v3.0"` / `..._V2.md` / v3.0 双指纹 / 五源 legacy 集合 ⇒ 须同步（Step 1.1 已登记为 N-5） | 工具同步 |

> ⚠️ **改动面性质**：**docs-only / contract-only**（+ 一个仓库外工具脚本）。⛔ **不触及** 生产代码、生产配置、DB schema、Authority、Seal、lock。
> ⚠️ 但**样本作废**：因 §3 字段定义 / 纳入排除规则的**来源**变化，按 §11 元规则属**实质性修正** ⇒ 须以新版本发布并**显式作废既有样本**（实测 = **0 行**，无实际损失）。
> ⇒ **这不是「v4 内部小改」**：改版动作**会取代 v4.0 的冻结对象**，须由 Owner 给出**新的 CONTRACT GENERATION 授权**。

---

## 6. ★ 推荐的 **Evidence sample identity** 定义（设计建议，⛔ 待 Owner 批准）

```text
Evidence SAMPLE IDENTITY（建议形态；selector 待裁定）

sample_key  = <run_id> + '::' + <code>          ← 行唯一键（防同 decision_date 多 run 碰撞）

其中：
  (I)  run identity  = { run_id, revision, pointer_revision }
         run_id            = run_candidate_decision.run_id（内含北京运行日；⛔ 不作统计量）
         revision           = run_manifest.revision
         pointer_revision   = 读取时 pin 住的 active_run_pointer.revision（provenance）
         selector           = ⚠️ 待 Owner 裁定（① latest / ② promoted-only / ③ latest-validation-passed）

  (II) decision date = <run_candidate_decision.decision_date>   → Evidence.date
         （= calc_date = 数据最新正式交易日；forward 收益 T0）

  (III) market/trade date = <v365_run_integrity.expected_trade_date>
         ⛔ 不进 Evidence（按 §3.5 host-local）；仅作 bundle provenance 的**对齐诊断**留存
```

**推荐理由（设计自洽性，非价值排序）**：
1. `sample_key` 含 `run_id` ⇒ 满足 §5.5 可判定性（同 `decision_date` 多 run 不再碰撞）；
2. (II) 保 v4 §3 字段 1「数据最新日」语义 + §5.4 组 B 口径；
3. (III) 隔离在 host ⇒ 不触发 §3.5「不扩展为三日期」的禁令；
4. (I) 的 `pointer_revision` 使「读到不同 revision」可审计（对应 §4.5）。

> ⛔ **本报告不选 selector**（①/②/③ 见 §7 待裁定项 A-1/A-2/A-3）。

---

## 7. 仍需 **Owner 裁定** 的事项（本步不自行决定）

| # | 待裁定 | 与哪一问相关 |
|---|---|---|
| **A-1** | Evidence 观察「生产的**决定**」还是「生产的**计算**」？ | §2.4 问 A-1 |
| **A-2** | 是否接受「Evidence 产出可被生产 promotion 健康度阻断」的耦合？ | §2.4 问 A-2 |
| **A-3** | 是否采用第三个可分离选项（latest **且** validation_passed）？ | §2.4 第 3 点 |
| **B-1°** | Evidence 是否要求 `promoted == true` **且** `read_after_write_consistent == true` 双条件？ | §4.5 |
| **B-2°** | 组 A 是否采纳「**run 内自洽**」重定义（取代对 `runtime_status` 单例的比较）？ | §3.4 |
| **B-3°** | (III) market/trade date 是否保持 host-local（维持 §3.5），还是要进 Evidence（触发 §3.5 重审）？ | §3.3 |
| **C-1°** | 是否在 §5.3 五源中**新增** `run_manifest` + `active_run_pointer` 两源？ | §5 |
| **C-2°** | §5.4 规则 1/2（`runtime_status` 前进性）是否改为**按 pointer revision** 判定？ | §5.4 |
| **D-1°** | 是否为 ①b 开一条**新的 CONTRACT GENERATION 授权** + 一条**仓库写授权**？（是否走 v5.0 作废 v4.0） | §5 末 |
| **D-2°** | **F-11**（`run_manifest.expected_trade_date` 名实不符 / `validateCandidateSet` 口径错配）是否单独立项？（⛔ 属生产链，本步不碰） | §8 |

---

## 8. 本步**新登记**观察项（⛔ 非阻塞登记，均实读所得）

| 编号 | 内容 | 实读证据 |
|---|---|---|
| **F-11** | `run_manifest.expected_trade_date` **名实不符**：写入值 = `snapshotDate`（北京运行日），但被 `validateCandidateSet` 用于比对 `candidate.calc_date`（数据日）⇒ 在「运行日 ≠ 数据日」时必判 `mixed_date_detected` | 10-01 run：manifest `2026-10-01` vs candidate `calc_date 2026-09-30` → `validation_reason = mixed_date_detected`；09-30 run：`2026-09-30` vs `2026-09-30` → `ok` |
| **F-12** | `active_run_pointer.expected_trade_date` 继承同一名实不符（= 被提升 run 的 manifest 值） | pointer 实测 `2026-09-30`；其源 = 09-30 run manifest 的 `expected_trade_date` |
| **F-13** | **同一 `decision_date` 对应多个 run**：10-01 run 与 09-30 run 的 candidate `decision_date` **均为 `2026-09-30`** ⇒ 若 Evidence 仍用 `(date, code)` 作行键会**键碰撞** | `run_candidate_decision` 10 行：两 run 各 5 票，`decision_date` 全为 `2026-09-30` |
| **F-14** | `runtime_status.v365_promotion_attempted = false`（10-01 run）⇒ 该 run **未尝试** promotion（HOLD 于 validation 阶段），非 CAS 拒绝 | 实测 `v365_promotion_attempted=false` / `v365_cas_reason=null` / `run_history.cas_reason=null` |
| **F-15** | `run_candidate_decision` 中 `518880` **缺** `effective_market_regime`（两 run 皆然）——同 UNV-27 型（key 缺失而非 null） | 实读 518880 行无该键；其余 4 票为 `crisis` |
| **F-16** | `portfolio_snapshot` 的**资产字段**仍有独立写方（`adminGateway.persistLiveSnapshot` :829 / 资产编辑 :1027）⇒ 该集合**不能**整体视作 run 产物 | 代码实读 + 该集合 41 行、最新 `2026-09-30` |
| **F-17** | reader-migration 目标已明确指向 candidate：`CLASS_C_READ_POINTS` 的 `run_axis_target` 全为 `run_history → run_candidate_*`，而 `RUN_HISTORY_INDEX = PENDING`、`V365_ENFORCE_SWITCH_DATE = null` ⇒ **run 轴历史索引尚未建成** | `v365-active-read.js:123-192` / `:108` |

---

## 9. 断言与元数据

### 9.1 Git / Production / DB 零修改断言（四块式）

```text
ETF 仓库（-gen1 worktree @ 2e24ecd）：
- Git 跟踪文件：零修改（本步未编辑任何跟踪文件）
    既有披露（非本步所为）：` M docs/gen1/GEN1_DOC_ERRATA_20260916.md`（mtime 2026-09-21）
    既有未跟踪（非本步所为）：`?? docs/gen1/GEN1_EVIDENCE_CONTRACT_V2.md`、`?? .workbuddy-ai/`
- Git 历史 / 分支 / 远端：零修改（未 commit / push / PR / merge）
- 未跟踪本地草稿（本步新增）：outputs/evidence-watch-20260921/GEN1_STEP11_E1B_SAMPLE_IDENTITY_DESIGN_20261002.md
    （outputs/ 命中 .gitignore:8 ⇒ 不入库）
  ⛔ `_v4-contract-20260923` worktree 内**零改动**（tracked status 仍为空）
其他本机文件：
- .workbuddy/memory/2026-10-02.md 追加本节
- .workbuddy/memory/automations/21a753d4-…/memory.md 追加一节
生产侧：
- Evidence Contract v1.0 / v3.0 / v4.0：**零字节修改**
- 代码 / 配置 / Authority / Seal / FROZEN_PARAM_KEYS / lock / immutable_set：零修改
- DB 九集合（decision_result / portfolio_snapshot / ml_shadow_signal / runtime_status /
  run_candidate_decision / run_candidate_portfolio / run_manifest / run_history / active_run_pointer）
  **零写入**（本步 DB 写命令数 = 0）
- 未调用云函数、未触发 automation、未做 reader migration、未改 PR #60 body
- CALC / ORCH / health / canary / permission / overlay：零修改
```

### 9.2 交付元数据

| 项 | 值 |
|---|---|
| 报告路径 | `outputs/evidence-watch-20260921/GEN1_STEP11_E1B_SAMPLE_IDENTITY_DESIGN_20261002.md` |
| 文件大小 / 行数 / 换行 | 见 §9.3（写后复算） |
| SHA256 | 见 §9.3（写后复算；文件无法自含自身哈希，故记于本步回复与记忆） |
| 写后断言 | POS / NEG 见 §9.3 |

### 9.3 写后复算结果

| 文件大小（本文件） | **39537 B** |
| 行数（本文件） | **498 行**（LF） |
| SHA256 | 见本步交付注记（⛔ 文件无法自含自身哈希） |
| 断言 | **POS 61/61 PASS ／ NEG 14/14 零命中**（见 §9.4） |

### 9.4 写后内容断言（POS）与零命中反向断言（NEG）

**POS**（61 条关键串必须命中）：**61/61 PASS**
**NEG**（14 条禁语必须零命中）：**14/14 零命中**

> 断言脚本口径：对报告全文做子串匹配；POS 缺失项 / NEG 命中项任一非空即视为失败（失败须先分辨「断言写错」与「未落盘」）。
---

## 10. STOP-AND-REPORT

**已 STOP。**

- ⛔ 未修改 v4 契约（任何版本）；⛔ 未生成新契约；⛔ 未修改任何仓库跟踪文件；⛔ 未修改 PR #60；
- ⛔ 未修改生产代码 / 配置 / DB / Authority / Seal / lock / immutable_set；⛔ 未修改 candidate / pointer / decision_result；
- ⛔ 未做 reader migration；⛔ 未碰 CALC / ORCH / health / canary / permission / overlay；
- ⛔ 未 commit / push / PR / merge / deploy / freeze；⛔ 未处理 E-2 / E-3 / E-4 / E-5；⛔ 未进入 Step 1.2 / PHASE 2 / PHASE 3；
- ⛔ **未选择** ①a / ①b / ①c 的最终方案；⛔ **未在** promoted-only 与 latest-candidate 之间选边。

**WAIT FOR OWNER RULING.**
等待 Owner 就 (A) 承重点 A 的 selector 裁定（A-1 / A-2 / A-3）；(B) 承重点 B 的日期概念裁定（B-1° / B-2° / B-3°）；
(C) §5 影响面裁定（C-1° / C-2°）；(D) 是否为 ①b 开新的 CONTRACT GENERATION 授权 / 仓库写授权（D-1°）及 F-11 是否单独立项（D-2°）作**下一次明确授权**。
