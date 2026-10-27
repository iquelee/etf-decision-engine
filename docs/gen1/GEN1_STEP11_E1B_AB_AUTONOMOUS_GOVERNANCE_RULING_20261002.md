# GEN-1 · PHASE 1 — **OWNER-AUTHORIZED AUTONOMOUS GOVERNANCE** 治理裁定（E-1b-AB / Layer-1 收口）

> 报告编号：`WP-G1-EVIDENCE / AUTONOMOUS-RULING / 20261002`
> 性质：**自主治理裁定 + CONTRACT GENERATION**（⛔ 不含 FREEZE / SEAL / 生产变更 / 仓库写）
> 授权来源：owner **2026-10-02** 指令 —— `OWNER-AUTHORIZED AUTONOMOUS GOVERNANCE`
> （治理裁定 / 子选项 / 分析判断**下放**；生产侧与 Git 正式集成**仍为独立高风险闸门**）
> 生成时刻：`2026-10-02T04:0x:xxZ`（北京 `2026-10-02 12:0x:xx +0800`）—— 精确值见 §13.2
> as-of（云端实读）：**`2026-10-02 11:51:34 +08`**
> 客体外参照：v4.0 DRAFT（`_v4-contract-20260923` @ `8d1f1cd`，CRLF sha256 `80da4d99…f7c5`，38137 B / 709 行）

---

## 0. 本步边界

### 0.1 授权范围内（本步**已做**）

- A-1 / B-1° / B-2° / B-3° / C-1° / C-2° 的**裁定**（FACT → DECISION → RATIONALE → CONSEQUENCE → EVIDENCE）
- selector / run identity / sample identity / date semantics / source binding 的**推导**
- **CONTRACT GENERATION**：v5.0 草案全文（⛔ 落于 `outputs/`，不入库、不冻结）
- E-2 / E-3(指纹部分) / E-4 / E-5 的**只读核验与裁定**
- 新发现登记 `F-30` ~ `F-35`、缺陷登记 `CD-02`(重绑) / `CD-03` / `CD-04` / `CD-05`

### 0.2 授权范围外（本步 ⛔ **未做**，且**必须 STOP**）

- ⛔ deploy / rollback / 改生产代码 / 改生产配置 / 改 Authority / 改 `FROZEN_PARAM_KEYS` / 改 lock / immutable_set / 改生产 DB
- ⛔ 触发会产生生产写入的云函数 / 改 `production_write` / `auto_execution` / `canary_active` / `ml_effective`
- ⛔ 改正式 selector / 改生产 promotion 行为 / reader migration 上生产
- ⛔ merge / push 生产分支 / 建 release·freeze / 改 frozen tag / 删·重写历史 / 改 PR #60 既有历史 / 对 master 不可逆集成
- ⛔ **FREEZE / SEAL**（独立闸门 G-2）/ **契约载体仓库写入**（G-1）
- ⛔ 修改 `c1_capture.py`（§11 规则 5：工具迁移与冻结同批次）

**本步 DB 写命令数 = 0**（全部经构造期只读白名单 `assert_readonly`：`QUERY/find` 与 `COMMAND/count` 之外一律 `raise`）。

---

## 1. 当前阶段与状态

```text
当前阶段：PHASE 1 / Step 1.1 — Evidence Contract 读源正解（E-1 → E-1b → E-1b-AB → Layer-1 → 【本步：自主裁定 + 契约生成】）
状态：     GOVERNANCE RULED + CONTRACT GENERATED（DRAFT）
           ⛔ CONTRACT NOT FROZEN ｜ ⛔ NOT IN REPO ｜ ⛔ PRODUCTION UNTOUCHED
```

路线位置：

```text
V3.6.5 FROZEN              ✅（已部署 · v3.6.5 / ModTime 2026-09-30 13:38:07 +08）
PRODUCTION_ATTESTED        ✅
EVIDENCE_CONTRACT_FROZEN   ⛔ 未达成 —— 本步完成其**最后一块拼图**：治理裁定 + v5.0 草案
HEALTH_READY               ⛔ 未达成 —— 阻塞：gen1_counterfactual_canary_active = false / gen1_health_status = DEGRADED（PHASE 2，闸门 G-5）
V3.6.6_IMPLEMENTED         ⛔ 未达成 —— 阻塞：CD-04（08:00 管线结构性不可提升）+ 健康语义（PHASE 2/3）
```

---

## 2. 内部 CHECKPOINT

```text
CHECKPOINT
├── objective
│     ▸ 依既定路线自主完成 A/B/C 治理裁定，形成可审计、可验证的最小方案；
│       判定是否需 Contract Generation，若需则自主生成草案。
├── evidence acquired
│     ▸ 云端实时只读（as-of 2026-10-02 11:51:34 +08）：9 集合全量
│     ▸ CLS 调用日志（2026-09-30 21:50–22:15 窗口）
│     ▸ 云端 trigger metadata（tcb fn detail × 5 函数）
│     ▸ 线上 V3.6.5 包（bundle-src）代码实读
│     ▸ origin/master 写入点 grep（E-2）
│     ▸ 既有分析件：E-1 / E-1b(sample identity) / E-1b-AB / Layer-1 / v4.0 DRAFT 全文
├── decision made
│     ▸ ①b 读源正解 = 改绑 candidate/promotion 链
│     ▸ A-1 = 决定（DECISION）⇒ selector = S-PROMOTED
│     ▸ B-3° = CALENDAR TRADE DATE 保持 host-local；组 A 改 run 内自洽（B-2°）
│     ▸ C-1° = 新增 3 源 + 改绑 2 源 = 八源；pointer_revision 进 provenance 不进 sample_key
│     ▸ E-4 = checkpoint 由 09:00 重锚为 [22:30, 23:30)（工作日夜）
│     ▸ E-5 = §3.5 重写（拆同名两义，CD-03）
│     ▸ E-2 = UNV-23 闭合（portfolio_snapshot ENFORCE 后无引擎写入方）
│     ▸ E-3 = 指纹可复算（已完成）；PR #60 body 更正属闸门 → STOP 待授权
├── files changed
│     ▸ 新增（outputs/，.gitignore 覆盖，⛔ 不入库）：
│        · outputs/evidence-watch-20260921/GEN1_STEP11_E1B_AB_AUTONOMOUS_GOVERNANCE_RULING_20261002.md（本文件）
│        · outputs/evidence-watch-20260921/GEN1_EVIDENCE_CONTRACT_V5_0_DRAFT_20261002.md（v5.0 草案）
│     ▸ 仓库跟踪文件：**零修改**（详见 §13）
│     ▸ ⛔ 未改 PR #60 / ⛔ 未改 production / ⛔ 未改 DB / ⛔ 未改 c1_capture.py
├── tests
│     ▸ v5.0 草案全文自洽性断言（POS/NEG）—— 见 §14
│     ▸ v4.0 指纹复算：与 E-1 记录逐位一致（80da4d99…f7c5）
│     ▸ 组 A / 组 B 对 promoted run 的**实测通过性**（§6.3）
│     ▸ E-2 写入点穷举（origin/master，§8.1）
├── risks
│     ▸ R-1 生产 CD-04 未修 ⇒ 只有 22:00 管线可产出 promoted run（Evidence 供给受限于此）
│     ▸ R-2 健康闸未开（canary_active=false）⇒ 即使读源就绪仍 0 样本（正交阻塞）
│     ▸ R-3 前台读链未迁移 ⇒ Evidence 对象与前台实际所见**暂时不同轴**（已由 §5.9 边界声明隔离）
│     ▸ R-4 v5.0 未冻结 ⇒ 工具不得改绑（已由 §11 规则 5 锁住）
└── authorization required?
      ▸ G-1 契约载体仓库写入（新分支 / commit / PR）…… YES
      ▸ G-2 v5.0 FREEZE / SEAL ……………………………… YES
      ▸ G-3 PR #60 body 更正（E-3）………………………… YES
      ▸ G-4 生产 CD-04 修复（V3.6.6 需求）……………… YES
      ▸ G-5 健康语义上产（PHASE 2）…………………… YES
      ▸ 本步其余动作 ………………………………………… NO ⇒ 已完成
```

---

## 3. 基线复确认（实时只读）

| 项 | 值 | 与上一份报告一致？ |
|---|---|---|
| `-gen1` worktree HEAD | `2e24ecd6ba5fa1d21b2c6337e24f6aa09c2a1781`（`gen1-worktree-20260916`） | ✅ |
| `-gen1` tracked diff | 仅既有披露 `M docs/gen1/GEN1_DOC_ERRATA_20260916.md`（+35） | ✅ |
| `_v4-contract-20260923` HEAD | `8d1f1cde5effa8bf6eb3d88b780f84e3873337ef`（detached，tracked status **空**） | ✅ |
| v4.0 契约 sha256（CRLF） | `80da4d99f9fdb5c9f54856210b5dc0fc06edcc8d8b2371a699f0bd5c5fa8f7c5` | ✅ 逐位一致 |
| v4.0 契约体量 | 38137 B / 709 行 / crlf = 709 | ✅ |
| PR #60 | `open` / `merged=false` / head `8d1f1cd` / base `e93f396` | ✅（E-3 未闭合，body 指纹仍绑第 1 提交） |
| 上一份 Layer-1 报告 | 49241 B / 641 行 / LF / sha256 `1ae10350…247e` | ✅ |
| **本步开始时 Git tracked diff** | **仅既有披露项**，无本步引入 | ✅ |
| **生产代码 / 配置 / DB** | **零修改** | ✅ |

⇒ **未触发 STOP**（基线全一致）。

### 3.1 云端实时读数汇总（as-of `2026-10-02 11:51:34 +08`）

| 集合 | total | 关键值 |
|---|---|---|
| `runtime_status` | **1**（单例） | `decision_date=2026-10-01` / `updated_at=2026-10-01T00:00:22.690Z` / `v365_mode=ENFORCE` / `v365_authoritative_publish_status=NOT_PROMOTED` / `gen1_authority=CANARY` / `ml_effective=false` / `gen1_production_write=false` / `gen1_auto_execution=false` / `gen1_counterfactual_canary_active=false` / `gen1_counterfactual_ledger_ok=true` / `gen1_health_status=DEGRADED` / `gen1_health_gate_status=ACTIVE` / `gen1_health_source=GEN1_HEALTH_STATE_LATCH` / Seal 双 `PENDING` / `gen1_guarded_selector_source=BASELINE` / `gen1_guarded_evidence_independent_events=0` |
| `run_manifest` | **2** | 09-30 run：`revision=1` / `expected_trade_date=2026-09-30` / `validation_passed=true` / `ok`；10-01 run：`revision=2` / `expected_trade_date=2026-10-01` / `validation_passed=false` / `mixed_date_detected` |
| `run_history` | **2** | 09-30 run：`promoted=true` / `cas_reason=PROMOTED` / `read_after_write_consistent=true` / `promoted_at=2026-09-30T14:01:11.865Z`；10-01 run：`promoted=false` |
| `active_run_pointer` | **1** | `_id=active_run_pointer::production` / `run_id=engine:2026-09-30:b1790776862980` / `revision=1` / `expected_trade_date=2026-09-30` / `updated_at=2026-09-30T14:01:11.797Z` |
| `run_candidate_decision` | **10**（2 run × 5 码） | 两 run 的 `decision_date` 与 `calc_date` **均为 `2026-09-30`**；`suggested_position` 8.3 / 7.1 / 0 / 0 / 0；`v361_baseline_stage` S0/S1 |
| `run_candidate_portfolio` | **2** | `decision_market_regime=crisis`（两 run 均有）/ `market_regime=defensive` / `market_regime_divergent=true` / `snapshot_date=2026-09-30` 与 `2026-10-01` |
| `decision_result` | **161** | max `decision_date=2026-09-29`（**停写**） |
| `portfolio_snapshot` | **41** | max `snapshot_date=2026-09-30`（**引擎停写**） |
| `ml_shadow_signal` | **133** | max `date=2026-09-30`（5 票齐） |

---

## 4. 裁定 **D-0**：读源正解 = **①b**

### FACT
v4.0 §3 绑定的两个集合（`decision_result` / `portfolio_snapshot`）在 ENFORCE 下被引擎**停写**；
而 v4.0 所需字段**仍在产生**，落在 `run_candidate_decision` / `run_candidate_portfolio`。

### DECISION
**①b —— 读源整体改绑 candidate / promotion 链。**

### RATIONALE（为何不选 ①a / ①c）

| 方案 | 否决理由 |
|---|---|
| **①a**（保持绑 legacy + 登记 activation precondition） | 其兑现路径**必须**变更生产写路径（回退 LEGACY 或启用兼容投影）⇒ 属**生产写**，直接触碰本步明令不可自行的闸门；且与已部署的「只读冻结」设计相冲突。⇒ **不可自主，且违背最小修改原则。** |
| **①c**（冻结契约 + 把不可执行登记为 precondition） | 其效果是**接受长期 0 样本产出**。owner 本轮明确「优化目标是用最少人为往返**完成整个路线**」「不要追求报告数量，要追求状态真正向前移动」⇒ 冻结一份结构性永不通行的契约**与目标相反**。 |
| **①b** ✅ | 纯**读侧**变更；生产风险 = 0；remedy 目标（`run_candidate_portfolio.decision_market_regime`）**已在生产中产生**；与 reader-migration 的**目标读源**同构。 |

### CONSEQUENCE
- 需 CONTRACT GENERATION（本步完成，见 §11）
- ①a / ①c 作为**已否决设计路径**留档（保留在 §4 表格中，⛔ 不再作为候选）
- `CD-02` 的 remedy **落点再次改绑**（仍未 CLOSED，等 v5.0 冻结）

### EVIDENCE
`_cb-connect-20260921/bundle-src/index.js:544-563`（`v365WriteDecision` / `v365WritePortfolio` 的 ENFORCE 短路）；
`run_candidate_portfolio` 实读（2 行，`decision_market_regime=crisis`）。

---

## 5. 裁定 **A-1**：Evidence 观察「生产的**决定**」而非「生产的**计算**」

### 5.1 FACT —— 三层门与两个 run 的可判别性

```text
门 1 · 输入对齐层（v361-run-context + v365-run-integrity）
      CASE_A_ALL_EXPECTED 放行；B/C → BLOCKED 且**不写任何 authoritative 数据**（连 candidate 都不写）
门 2 · 候选完整性层（v365-atomic-publish.js:120 validateCandidateSet）
      候选齐备 / portfolio 存在 / **同日性 gate `decision.calc_date === manifest.expected_trade_date`** / 无 ok=false
门 3 · 提升原子性层（v365-publish-store.js:75-146 classifyPointerPromotion）
      bootstrap / ALREADY_ACTIVE / CAS expected / 单调 revision
```

| run | 门 1 | 门 2 | 门 3 | 结果 |
|---|---|---|---|---|
| `engine:2026-09-30:b1790776862980` | ✅ | ✅ `validation_passed=true` | ✅ `PROMOTED` | **被采纳**（指针 rev 1） |
| `engine:2026-10-01:b1790812813101` | ✅ `CASE_A_ALL_EXPECTED` | ❌ `mixed_date_detected` | ⛔ `v365_promotion_attempted=false`（**未到 CAS**） | 未被采纳 |
| `engine:2026-10-02:…` | ❌ `CASE_B_PARTIAL_STALE` | — | — | 连 candidate 都未写 |

**★ 关键不可判别性（本裁定的核心事实）**：

```text
两个 run（09-30 与 10-01）的 candidate 行在**计算层完全同形**：
  同 code set（5 码）｜同 decision_date（2026-09-30）｜同 calc_date（2026-09-30）
  同 suggested_position（8.3 / 7.1 / 0 / 0 / 0）
  同 gen1_counterfactual_suggested_position（同上）
  同 v361_baseline_stage（S0 / S1 / S0 / S0 / S0）
⇒ **只有「提升层」可区分二者** ⇒「计算出来」与「最终被采用」在数据形态上**无天然判别式**
```

### 5.2 DECISION

> **A-1 = 「决定」（DECISION）。**
> Evidence 的观察对象 = **生产已采纳（promotion-accepted）的 authoritative decision**。
> **selector = `S-PROMOTED`**（pin `active_run_pointer[scope="production"].run_id`，读取一次即固定）。

### 5.3 RATIONALE

| # | 理由 | 依据 |
|---|---|---|
| 1 | 契约的问句是「Gen-1 反事实建议**是否具有经济价值**」；只有**被采纳**的建议才对应「若当时照它做会怎样」的**可执行**反事实 | §8 终局语义 |
| 2 | **承重墙 R7**：「生产 authoritative read path 与 candidate/promotion path 必须明确区分。**不得因为 candidate 有数据就声称 production 已经消费**」 | owner 明令 |
| 3 | `S-LATEST` 今日实测会读到 `mixed_date_detected` 的 run ⇒ 违反 §4「通路正常态」 | 10-01 run 实读 |
| 4 | `S-VALIDATED` 只证明「未被拒绝」，**不证明被采纳**；仅在「validation 通过但 CAS 未获」时与 `S-PROMOTED` 分叉，而那时它**会选中未被采纳的 run** ⇒ 同属 R7 违反 | 门 3 CAS 语义 |
| 5 | `S-PROMOTED` 与 reader-migration **目标读源同构**（`authority_selector = active_run_pointer.run_id`） | `v365-active-read.js` |
| 6 | **fail-closed 是设计意图而非缺陷**：无被采纳 run ⇒ 无样本，且 §5.2 已规定 `NO RETROACTIVE RECONSTRUCTION` | v1.0 起沿用 |
| 7 | 可审计性最强：promotion 是**显式、留痕、单调**的 CAS 事件（`run_history.promoted` / `promoted_at` / `cas_reason`） | 实读 |

**⚠️ 为什么不把「S-VALIDATED 与 S-PROMOTED 今天选中同一个 run」当作选 S-VALIDATED 的理由**：
今天二者恰好同选 09-30 run，**只是因为 10-01 的 run 在门 2 就被拒**（根本没到 CAS）。
一旦出现「validation 通过但 CAS 未获」，二者即分叉，而分叉方向上 `S-VALIDATED` 会**选中未被采纳者**。
⇒ 二者**不等价**，不能以「今天结果相同」为由降级为 S-VALIDATED。

### 5.4 CONSEQUENCE

- `Evidence.date` = 被采纳 run 的 `decision_date`；`sample_key` 必须含 `run_id`
- 组 A 必须改为 run 内自洽（B-2°）；gate 规则 1/2 必须改为按 pointer revision（C-2°）
- CHAIN PROOF 必须重锚（§5.6），否则 **100% 误杀**
- checkpoint 必须重锚（§5.8）
- 新增 §5.9 `EVIDENCE OBJECT BOUNDARY`（防「Evidence 有样本 ⇒ 前台已消费」的误读）

### 5.5 EVIDENCE（promotion 证明四键 AND）

```text
PROMOTION_PROOF(R) :=
    active_run_pointer[production].run_id == R
AND run_history[R].promoted == true
AND run_history[R].read_after_write_consistent == true
AND run_manifest[R].validation_passed == true
AND run_manifest[R].revision == active_run_pointer[production].revision
```

**对 R = `engine:2026-09-30:b1790776862980` 实测**：五条**全真** ✅
（pointer.run_id 相符；`promoted=true`；`read_after_write_consistent=true`；`validation_passed=true`；`manifest.revision=1 == pointer.revision=1`）

---

## 6. 裁定 **B-3°**：CALENDAR TRADE DATE **保持 host-local**

### 6.1 FACT —— **同名不同义**的实证（`CD-03`）

| 字段 | 写入值 | 轴 | 载体 | 实测（10-01 run） |
|---|---|---|---|---|
| `run_manifest.expected_trade_date` | `snapshotDate`（`index.js:1352`） | **(III) RUN DATE** | `run_manifest` / `run_history` / `active_run_pointer` | **`2026-10-01`** |
| `active_run_pointer.expected_trade_date` | 继承被提升 run 的 manifest | **(III) RUN DATE** | pointer | `2026-09-30` |
| `run_candidate_portfolio.snapshot_date` | `snapshotDate` | **(III) RUN DATE** | candidate | `2026-10-01` |
| `runtime_status.decision_date` | `snapshotDate`（最后写入者） | **(III) RUN DATE** | runtime_status 单例 | `2026-10-01` |
| `run_candidate_decision.decision_date` = `calc_date` | 指标快照日 | **(II) DATA DATE** | candidate | **`2026-09-30`** |
| `runtime_status.v365_run_integrity.expected_trade_date` | 日历权威源 | **(IV) CALENDAR TRADE DATE** | run_integrity telemetry | **`2026-09-30`** |

⇒ **(III) ≠ (IV)**：`2026-10-01` vs `2026-09-30`（同一时刻，相差 1 天）。

### 6.2 DECISION

> **B-3° = (IV) CALENDAR TRADE DATE 保持 HOST-LOCAL，⛔ 不进 Evidence 消费集合。**
> **(III) RUN DATE 进 Evidence，但仅作 §3.1 组 A 的 run 轴护栏，⛔ 不得充当 `Evidence.date`。**
> **`Evidence.date` = (II) DATA DATE**（`run_candidate_decision.decision_date`）。

### 6.3 RATIONALE

| # | 理由 |
|---|---|
| 1 | `Evidence.date` 是 forward 收益的 **T0**，必须是**价格可得**的日期 ⇒ 只能是 (II) DATA DATE |
| 2 | (IV) 是「数据可用性**期望**」，不是价格日期；把它当 T0 会让 forward 计算基准日错位 |
| 3 | 在 `S-PROMOTED` 下，被采纳 run 已通过 `validation_passed=true`（即 `calc_date == snapshotDate` 一致性确认）⇒ (IV) 对 Evidence **已无增量判别力** |
| 4 | 把 (IV) 引入契约 = 契约**耦合 `cn-trading-calendar` 的版本与实现** ⇒ 违背 §11 不可变性意图 |
| 5 | 承重墙 **R10**：「不得把 run date / data date / calendar trade date / run identity 重新混成一个 date」 |
| 6 | 承重墙 **R6** 的同类风险：引入 (IV) 会形成**第二套「今天是哪天」的真相源** |

**⛔ 必须显式拒绝的三种写法（本次逐一排除）**：

```text
✗ 「promoted run 的 run 日期 == runtime_status.v365_run_integrity.expected_trade_date」
    ⇒ 结构性误杀：08:00 run 的 RUN DATE 必然是 D、CALENDAR 必然是 D-1（实测 10-01：10-01 vs 09-30）
✗ 「四个日期全等」
    ⇒ 误杀每一个 bundle（v4.0 §5.4 已警告；实测组 A ≠ 组 B 是正常态）
✗ 「用 (IV) 替代 (II) 作 Evidence.date」
    ⇒ 违反 R10 + 基准日错位
```

### 6.4 裁定 **B-2°**：组 A 改为 **run 内自洽**

### FACT
v4.0 组 A 右端 = `runtime_status.decision_date`（**单例、最后写入者**）。
该单例被**不可提升的 08:00 run** 无条件覆盖（`index.js:1653`）。

### DECISION
```text
组 A（RUN 轴，同 run 内）—— ⚠️ 廉价一致性护栏（近似恒真，保留）
  A1: run_candidate_portfolio[R].snapshot_date == run_manifest[R].expected_trade_date
  A2: run_manifest[R].revision == active_run_pointer[production].revision
  A3: run_manifest[R].run_id == run_history[R].run_id == active_run_pointer[production].run_id

组 B（DATA 轴，跨源）—— 有信息量
  B1: run_candidate_decision(R) 五行 decision_date 全等
  B2: == ml_shadow_signal.date（Main5 五行）
  B3: 五行 calc_date 全等且 == decision_date
  B4: decision_date <= run_manifest[R].expected_trade_date
```

### RATIONALE
1. `runtime_status` 是**单例 + 最后写入者**，被不可提升的 08:00 run 污染 ⇒ 任何跨 run 比较**不可复现**（承重墙 **R8**）。
2. 实测：`runtime_status.decision_date = 2026-10-01` 而 pointer 指向的 run 的 RUN DATE = `2026-09-30` ⇒ v4.0 组 A **恒定 FAIL = 工具性误杀**。
3. **⚠️ 诚实声明**：A1 的两端同源（都来自 `snapshotDate`）⇒ **近似恒真**，作为「廉价不变量护栏」保留，**不主张它具有独立证明力**。
4. 为补偿 A 组的信息量损失，**新增 B3 / B4**：
   - B3 检查 `calc_date == decision_date`（同一 run 内数据日自洽）
   - B4 检查 `decision_date <= RUN DATE`（**数据不得「来自未来」**）—— 这是**真正有信息量**的新增约束

### CONSEQUENCE
- 「组 A 恒定 FAIL」问题消失；对 09-30 run 实测 **A1/A2/A3 + B1/B2/B3/B4 全 ✅**
- ⛔ 换取的是：A 组不再校验「run 与当日宿主 telemetry 是否同轴」—— 该职责**移交** `CD-04`（生产侧，闸门 G-4）

### 6.5 三 run 实例化（B-3° 要求的逐 run 核对）

| run | (II) RUN DATE | (III) DATA DATE | (IV) CALENDAR | 门 1 | 门 2 | 门 3 | v4.0 组 A | **v5.0 组 A/B** |
|---|---|---|---|---|---|---|---|---|
| `engine:2026-09-30:b1790776862980`（22:01） | 09-30 | 09-30 | **09-30** | ✅ | ✅ | ✅ PROMOTED | ✅（同值） | ✅ 全通过 |
| `engine:2026-10-01:b1790812813101`（08:00） | 10-01 | 09-30 | **09-30** | ✅ | ❌ `mixed_date_detected` | ⛔ 未到 CAS | ❌（组 A 对 10-01 单例 = 09-30 vs 10-01） | ⛔ 未过 `PROMOTION_PROOF` ⇒ 排除 |
| `engine:2026-10-02:…`（08:00） | —（无 manifest） | — | **09-30** | ❌ `CASE_B_PARTIAL_STALE` | — | — | 无从计算 | ⛔ 门 1 即 BLOCKED ⇒ 排除 |

> ⚠️ **B-3-c 的结构性误杀结论（Layer-1 已证，本步确认并给出机制）**：
> 08:00 run 的 (III) RUN DATE **必然** = D、(IV) CALENDAR **必然** = D−1（当日收盘尚未抓取）
> ⇒ **任何**「(III) == (IV)」的强制相等会对**每一个** 08:00 run 判 FAIL。
> 10-01 run 的 `date_alignment_case = CASE_A_ALL_EXPECTED`（**宿主自认输入对齐正常**）却被强制相等判 FAIL —— 即证。

### 6.6 EVIDENCE（`CD-04`：08:00 管线**结构性**不可通过 validation）

**★ 本步最重的机械性发现。** 门 2 的同日性 gate 是：

```text
decision.calc_date === manifest.expected_trade_date
    左端 = (II) DATA DATE（数据最新日）
    右端 = (III) RUN DATE（snapshotDate）
```

⇒ **在「运行日 ≠ 数据日」的每一步必然判 `mixed_date_detected`**：

```text
08:00 管线（dailyPipeline-0800）：运行日 D 的 08:00，当日收盘尚未抓取
    ⇒ calc_date = D−1（上一交易日）而 snapshotDate = D ⇒ **D−1 ≠ D ⇒ 必 FAIL**
22:00 管线（dailyFetch-2200）：运行日 D 的 22:00，fetchDailyData 已抓当日收盘
    ⇒ calc_date = D == snapshotDate ⇒ **PASS**
```

**实读印证**：

```text
09-30 22:01 run：snapshotDate 09-30 / calc_date 09-30 / validation_passed=true  / promoted=true
10-01 08:00 run：snapshotDate 10-01 / calc_date 09-30 / validation_passed=false / mixed_date_detected
10-02 08:00 run：门 1 即 BLOCKED（CASE_B_PARTIAL_STALE expected=2026-09-30 observed=2026-10-01）
```

⇒ **结论：只有 22:00 管线能产出 promoted run。** 这是 `CD-04`（**生产侧字段误用**），
**⛔ 本契约不修**，归属 **V3.6.6 需求项**，闸门 **G-4**。

---

## 7. 裁定 **C-1° / C-2°**：源集合 5 → **8**

### 7.1 现行五源逐条（v4.0 §5.3）

| # | 源 | v4.0 角色 | 是否携带 **authoritative identity** | v5.0 处置 |
|---|---|---|---|---|
| 1 | `runtime_status` | eligibility **唯一**来源 + 组 A 右端 | ⚠️ **否**（单例，非 run 身份） | ✅ **保留**（**降为 eligibility-only**；⛔ 撤出组 A / 撤出 gate 规则 1·2） |
| 2 | `decision_result` | 字段 1/4/7/8 + 组 B 左端 | ⛔ **否** | 🔁 **改绑** → `run_candidate_decision` |
| 3 | `ml_shadow_signal` | 字段 5/6 + 组 B 右端 | —（lane-local） | ✅ **保留** |
| 4 | `portfolio_snapshot` | 字段 3（`regime`） | ⛔ **否**（**混合轴**，见 §8.2） | 🔁 **改绑** → `run_candidate_portfolio` |
| 5 | `invocation log`（CLS） | §5.6 provenance | —（外部） | ✅ **保留** |

**★ 结构性结论（C-1° 之所以承重的原因）**：
**现行五源中没有任何一源携带 promotion / authoritative 身份。**
唯一载体 `active_run_pointer.run_id` 与 `run_history.promoted` **均在五源之外**。

### 7.2 DECISION —— C-1a（manifest）/ C-1b（pointer）

> **C-1a = 新增 `run_manifest`。**
> **C-1b = 新增 `active_run_pointer` + `run_history`。**
> **总计：保留 3 + 改绑 2 + 新增 3 = 8 源。**

| 新增源 | 证明什么 | 解决哪个问题 |
|---|---|---|
| `run_manifest` | (I) `run_id` / `revision`；`validation_passed`；(III) RUN DATE | 提供 **run 身份** 与 **validation 事实**；是 `PROMOTION_PROOF` 的必要分量 |
| `active_run_pointer` | **selector 的 pin 对象** + `revision`（单调） | 提供 **唯一 per-run 排序装置**（替代被污染的 `runtime_status`） |
| `run_history` | `promoted` / `read_after_write_consistent` / `cas_reason` / `promoted_at` | 提供 **«是否被采纳» 的唯一显式真值** —— R7 的机械实现 |

### 7.3 **C-1a 特别检查（owner 指派）**：manifest 会不会把 run-date 与 data-date 混在一起？

**答案：会 —— 如果把它当 `Evidence.date` 用。** 本裁定的**防护**：

```text
§3.5 表把 run_manifest.expected_trade_date 显式标为 **(III) RUN DATE**
§3.1 表把 Evidence.date 显式标为 **(II) DATA DATE**（来源 run_candidate_decision.decision_date）
§5.4 规则 9 只用 (III) 做 组 A1 的 run 轴一致性比较
⛔ §5.4 规则 14 明令：**(IV) CALENDAR TRADE DATE 不得出现在任一 gate 判据中**
```

⇒ **`run_manifest` 进入源集合，但其 `expected_trade_date` 与 `Evidence.date` 分属不同轴，且被 §3.5 / §3.1 / §5.4-r14 三重隔离。**

**是否与 candidate 重复？** 不重复：candidate 提供 **行级** 数据（5 码 × 字段），
manifest 提供 **run 级** 身份与 validation（1 行/run）。两者是 **1 : N** 关系，⛔ 不可互推。

**是否会把 run-date 与 data-date 混在一起？** 只在**读取方**若不区分轴时才会。
故本裁定**同时**给出 §3.5 的重写（`CD-03`）作为**强制配套**，⛔ 不允许只加源不改 §3.5。

### 7.4 **C-1b 特别检查（owner 指派）**：`pointer_revision` 的证明位置

**★ 实测结论：`pointer_revision` 对 `run_id` 是函数依赖 ⇒ 对行身份无区分力。**

```text
证据：active_run_pointer.revision = 1
      run_manifest["engine:2026-09-30:b1790776862980"].revision = 1   （被提升 run）
      run_manifest["engine:2026-10-01:b1790812813101"].revision = 2   （未被提升）
⇒ pointer.revision ≡ 被提升 run 的 manifest.revision
⇒ 给定 run_id 即可推出 pointer.revision ⇒ **不进 sample_key**
```

**但 `pointer_revision` 必须进 bundle 的 provenance**，因为它承担一项 `run_id` **不能**承担的校验：

```text
§5.4 规则 A2：run_manifest[R].revision == active_run_pointer.revision
⇒ 该式证明「pin 到的 run 与 pointer 记录的是**同一个 revision**」⇒ 排除「指针已前进但读到了旧 run 产物」
```

**证明关系链（⛔ 不简化）**：

| 关系 | 含义 | 方向性 |
|---|---|---|
| `run_id` → `manifest.revision` | run 身份 → 该 run 的单调序号 | 函数依赖（确定性） |
| `manifest.revision` == `pointer.revision` | **pin 一致性**（指针与 manifest 同 revision） | 双向等式（校验） |
| `run_history.promoted == true` | **采纳事实** | 单向事实（不可由 revision 推出） |
| `run_history.read_after_write_consistent == true` | 提升后**回读验证**通过（CAS 后一致性） | 单向事实 |
| `pointer.run_id == R` | **pin 有效** | 双向等式 |
| `pointer.updated_at` | 提升的墙钟时刻 | ⛔ **不得作 run 身份**（`LATEST_BY_UPDATED_AT` 反模式） |

⇒ **`pointer_revision` 与 `run_id` 是「冗余但可审计」的关系**：冗余 ⇒ 可交叉校验；不可替代 ⇒ 缺它则「revision 漂移」不可检。

### 7.5 **C-1c 四组合矩阵**（owner 指派：不新增 / +manifest / +pointer / +两者）

| 维度 | **不新增**（仅改绑 2 源） | **+manifest** | **+pointer** | **+两者** ✅ **采纳** |
|---|---|---|---|---|
| **新增证明能力** | ⛔ 无法证明「被采纳」；selector 无落点 | run 身份 + validation | pin 对象 + 单调 revision | ✅ promotion 四键可判 ⇒ **R7 可机械实现** |
| **新增复杂度** | 低 | 中（1 行/run，schema 固定） | 中（单例） | 中高（3 源，但语义正交、无重叠） |
| **潜在重复** | — | ⚠️ `revision` 与 pointer 重复 | ⚠️ `run_id` 与 manifest 重复 | ⚠️ 存在**刻意的交叉冗余**（用于一致性校验，非混算） |
| **历史可复现性** | ⛔ 无 run 维 ⇒ 同 `decision_date` 多 run 不可分辨 | 部分 | 部分 | ✅ `(run_id, code)` 唯一 ⇒ 可复现 |
| **与 selector 耦合** | ⛔ selector 无处安放 | 弱 | ⛔ 强（selector = pointer） | ✅ 耦合**显式化**（§3.0.2/§3.0.3） |
| **与 run identity 耦合** | ⛔ 无 run identity | 强 | 强 | ✅ 三量并列（§3.0.1） |
| 结论 | **否决**：无法满足 R7 | 不足 | 不足 | **采纳** |

**⚠️ 关于「潜在重复」的裁定**：`run_id` 同时出现在 manifest / pointer / history / candidate，
`revision` 同时出现在 manifest / pointer / history。**这不是混算，而是刻意的交叉校验冗余** ——
v5.0 以 §5.4 规则 A2/A3 把冗余**转化为可判定的等式**。⛔ 不得因「字段重复」而删源。

### 7.6 裁定 **C-2°**：gate 规则 1/2 改按 **pointer revision**

| v4.0 规则 | v4.0 形态 | **v5.0 形态** | 理由 |
|---|---|---|---|
| 1 | `runtime_status` 必须是本 checkpoint 前最新自然运行 | **pin 的 `pointer.run_id` 必须是本 checkpoint 前最近一次被 promoted 的 run** | `runtime_status` 被不可提升的 08:00 run 覆盖 ⇒ 排序信息被污染（R8） |
| 2 | `runtime_status.updated_at` 必须前进 | **`pointer.revision` 必须严格大于上一有效 bundle 的 `pointer_revision`** | `pointer.revision` 单调且 promotion-bound ⇒ 可复现 |

**实测印证（规则 1 的必要性）**：

```text
runtime_status.updated_at = 2026-10-01T00:00:22.690Z  ⇒ 最后写入者 = **10-01 08:00 的不可提升 run**
active_run_pointer.updated_at = 2026-09-30T14:01:11.797Z ⇒ 最近一次**被采纳**的 run = 09-30
⇒ 二者指向**不同**的 run；v4.0 规则 1 会把「本 checkpoint 前最新自然运行」判为 10-01 run ⇒ 与 pin 冲突
```

---

## 8. 派生裁定（selector / identity / date / source binding / checkpoint）

### 8.1 派生结论汇总（DECISION）

```text
D-0  读源正解        = ①b（改绑 candidate / promotion 链）
A-1  观察对象        = 生产**已采纳**的 authoritative decision
     selector        = **S-PROMOTED**（pin active_run_pointer::production，一次即固定）
B-3° (IV) CALENDAR   = **HOST-LOCAL**，⛔ 不进 Evidence 消费集合
B-2° 组 A            = **run 内自洽**（取代对 runtime_status 单例的比较）
B-1° promotion 证明  = **四键 AND**（pointer.run_id / promoted / read_after_write_consistent / validation_passed）+ revision 一致
C-1° 源集合          = **8 源**（保留 3 + 改绑 2 + 新增 3）
C-1b pointer_revision= 进 **bundle provenance**，⛔ 不进 sample_key
C-2° gate 规则 1/2   = 改按 **pointer revision**
E-4  checkpoint      = **工作日 [22:30:00, 23:30:00)（北京）**（取代 09:00）
E-5  §3.5            = **重写**（拆同名两义，`CD-03` 就地闭合）
E-2  UNV-23          = **闭合**（portfolio_snapshot ENFORCE 后无引擎写入方）
```

### 8.2 派生：**run identity / sample identity**

```text
(I)  RUN IDENTITY = { run_id, revision, pointer_revision }
        run_id           = run_candidate_decision.run_id（内含北京运行日；⛔ 不作统计量）
        revision         = run_manifest.revision
        pointer_revision = 读取时 pin 住的 active_run_pointer.revision（provenance）

sample_key = <run_id> + '::' + <code>      ← 行唯一键（防同 decision_date 多 run 碰撞）
bundle_key = <decision_date>               ← bundle 唯一键（§5.5）
```

**为何 `run_id` 必要（不可用 `(decision_date, code)` 替代）**：

```text
实读：run_candidate_decision 10 行 = 2 run × 5 码，两 run 的 decision_date **均为 2026-09-30**
⇒ 按 (decision_date, code) 折叠 ⇒ 10 行压成 **5 键** ⇒ **键碰撞**
⇒ 承重墙 **R9**：「不得把 decision_date + code 作为已经证明唯一的 sample identity」
```

### 8.3 派生：**date semantics**（四概念、两名入契约）

| 轴 | 载体 | 入契约？ | 用途 |
|---|---|---|---|
| **(I) RUN IDENTITY** | `run_id` / `revision` / `pointer_revision` | ✅ | provenance / 行键分量 |
| **(II) DATA DATE** | `run_candidate_decision.decision_date` = `calc_date` | ✅ | **`Evidence.date`（T0）** |
| **(III) RUN DATE** | `run_manifest.expected_trade_date` = `run_candidate_portfolio.snapshot_date` | ✅ | **仅**组 A 护栏 |
| **(IV) CALENDAR TRADE DATE** | `runtime_status.v365_run_integrity.expected_trade_date` | ⛔ | HOST-LOCAL 对齐诊断 |

### 8.4 派生：**source binding**（八源）

```text
保留 3：runtime_status（eligibility-only）｜ml_shadow_signal｜invocation log
改绑 2：decision_result → run_candidate_decision ｜ portfolio_snapshot → run_candidate_portfolio
新增 3：run_manifest ｜ active_run_pointer ｜ run_history
```

### 8.5 派生：**checkpoint 重锚（E-4）**

### FACT
v4.0 §5.8 的定值依据表**只列**了 `materializeIndicators`（08:00）与 `runGen1ShadowEod`（22:20），
**漏列 `fetchDailyData`（`dailyFetch-2200`，cron `0 0 22 * * 1-5`）** ⇒ `CD-05`。

### DECISION
```text
CANONICAL_CAPTURE_CHECKPOINT = 工作日 [22:30:00, 23:30:00)（北京时间）的**预登记有界窗口**
checkpoint_ok = (weekday < 5) AND 22:30:00 <= capture_local < 23:30:00
```

### RATIONALE
1. **唯一可产生 promoted run 的管线是 22:00**（`CD-04`）⇒ checkpoint 必须**在它之后**。
2. 组 B 右端 `ml_shadow_signal` 由 `runGen1ShadowEod` 于 **22:20** 写入 ⇒ checkpoint 必须**晚于 22:20**。
3. `[22:30, 次日 08:00)` 内**无**四源写入者 ⇒ 满足 v4.0 §5.8 所主张的「post-run / data static」**原意**。
4. **预登记**的有界窗口 ≠ 「事后放宽」：窗口边界在冻结前**一次性**写入契约，⛔ 不得事后调整。
5. 采用**窗口**而非「点」的理由：§12#4 明确**当前不授权 automation** ⇒ 要求人类/半自动在**分秒级**取点不可执行；
   有界预登记窗口在保留可审计性（记录精确 `capture_timestamp`）的同时可操作。

### CONSEQUENCE
- `c1_capture.py` 的 `CHECKPOINT_TOLERANCE_MIN = 30` 与 09:00 锚点**须随 v5.0 冻结同批次迁移**（§11 规则 5）——
  ⛔ **本步不改**（否则构成「按未冻结契约采样」的预登记违规）。
- §12#4 的「先跑通 ≥3 个交易日」要求 ⇒ **需夜间执行**。

### EVIDENCE
`tcb fn detail` 实测 trigger metadata（§12.1 表）；
`origin/master` 链式调用代码（`fetchDailyData/index.js:424` / `materializeIndicators/index.js:127`）；
CLS 实读 `2026-09-30 22:00:06 / 22:00:56 / 22:01:02` 三跳。

---

## 9. **E-2 / E-3 / E-4 / E-5** 处置

### 9.1 ✅ **E-2 — UNV-23 闭合**（`portfolio_snapshot` 逐日写入方身份）

**DEFINITION**（沿用 Step 1.1）：闭合 UNV-23 —— `portfolio_snapshot` 的逐日写入方身份。

**FACT（`origin/master` 穷举）**：

```text
COLLECTIONS.PORTFOLIO_SNAPSHOT 的 **upsert（写）** 仅两处：
  adminGateway/index.js:829  persistLiveSnapshot   ← 写 total_asset/cash_balance/holdings_mv/asset_source/
                                                        total_pnl/auto_pnl/tech_position/cash_ratio/
                                                        market_regime/positions …（**全为资产轴**）
  adminGateway/index.js:1027 资产编辑               ← 同上类型
引擎侧 upsert：runDecisionEngine/index.js:1124
  → 线上包 index.js:554-563 `v365WritePortfolio` 在 `v365Mode === 'ENFORCE'` 时**短路**
    （改写 run_candidate_portfolio 并 return {created:true, deferred:true}）
只读点（非写）：apiGateway :161/:518/:617；adminGateway :802/:806/:888/:1003；runDecisionEngine :1049；runGen1ShadowEod :81
```

**DECISION / 结论**：

> **ENFORCE 生效（2026-09-30 22:01）之后，`portfolio_snapshot` 没有引擎写入方。**
> 该集合此后仅由 **`adminGateway` 的用户资产编辑**写入，且写入字段**不含** `decision_market_regime`。
> ⇒ 该集合是**混合轴**（run 产物 + MUTABLE_STATE）⇒ **不可作为 run 产物源**。

**CONSEQUENCE**：`Evidence.regime` ⛔ 不得取 `portfolio_snapshot`；已写入 v5.0 §3.6。
**这一结论独立地支持 ①b**（regime 必须改绑 candidate）。

**EVIDENCE**：上述行号 + `run_candidate_portfolio` 实读（2 行，`decision_market_regime = crisis`，
`portfolio_snapshot` 41 行 / 引擎停写）。

### 9.2 ⚠️ **E-3 — 部分完成；PR #60 body 更正属闸门 ⇒ STOP**

| 子项 | 状态 |
|---|---|
| 冻结指纹重算 | ✅ **已完成**（只读）：v4.0 = CRLF sha256 `80da4d99…f7c5` / 38137 B / 709 行 —— 与 E-1 记录**逐位一致** |
| 绑确切 rev | ✅ 已确认：`_v4-contract-20260923` @ `8d1f1cd`（detached / tracked status 空） |
| **更正 PR #60 body** | ⛔ **STOP** —— 属授权闸门 **B**（「修改 PR #60 的既有历史内容」）⇒ 需 **G-3** |

**⚠️ 附裁定**：若 v5.0 取代 v4.0 作为冻结对象，则 **body 更正应并入 v5.0 的载体动作**，
而非单独修补 v4.0 的 body。⇒ G-3 与 G-1 **合并提交**更为最小。

### 9.3 ✅ **E-4 — 已裁定**（见 §8.5）

```text
CANONICAL_CAPTURE_CHECKPOINT = 工作日 [22:30:00, 23:30:00)（北京时间）
取代 v4.0 §5.8 的「工作日 09:00（不设宽窗）」
工具迁移 = 与 v5.0 FREEZE **同批次**（§11 规则 5）
```

### 9.4 ✅ **E-5 — 复核条件判定为「已触发」，并已就地闭合**

**FACT**：v4.0 §3.5 的复核条件为「若 V3.6.5 首次自然运行后，`expected_trade_date` /
`observed_latest_date` **确实落入了** Evidence 消费的集合，本条须重审」。

**判定**：

```text
1. 实读：runtime_status.v365_run_integrity 含 expected_trade_date / observed_latest_date /
   effective_as_of_trade_date（V3.6.5 首次自然运行已发生：09-30 22:01）
2. 本步 C-1a 裁定把 **run_manifest 纳入源集合** ⇒ run_manifest.expected_trade_date **落入消费集合**
⇒ **复核条件成立（已触发）**
```

**DECISION（就地重审结论）**：

> ✅ **排除意图保持**：(IV) CALENDAR TRADE DATE（`cn-trading-calendar` 权威源）**继续 host-local**，
> ⛔ 不进 Evidence 统计与 eligibility；日期口径**不扩展为三日期**。
> ✅ **文本必须修正**：v4.0 §3.5 的 `expected_trade_date` 一行**混了两个同名不同义的量**（`CD-03`）
> ⇒ v5.0 §3.5 **拆为 (III)/(IV) 两行并显式标注轴线**，并增设「(III) ⛔ 不得充当 `Evidence.date`」的禁令。
> ⛔ 该闭合**不构成**「把 (IV) 引入 Evidence」。

**CONSEQUENCE**：`CD-03` 登记为 `CONTRACT AMBIGUOUS NAMING DEFECT`，remedy = v5.0 §3.5，
状态 `CLOSED-UPON-V5.0-FREEZE`。

---

## 10. 新发现（本步**真实新增**，全部实读所得）

| 编号 | 类型 | 内容 | 证据 |
|---|---|---|---|
| **F-30** | F（事实） | **`dailyFetch-2200` 管线此前完全未被登记**：`fetchDailyData` trigger `dailyFetch-2200` cron `0 0 22 * * 1-5`；链式 `fetchDailyData/index.js:424` → `materializeIndicators` → `materializeIndicators/index.js:127` → `runDecisionEngine` | `tcb fn detail` + `origin/master` 代码 + CLS 三跳时刻 |
| **F-31** | F/R（根因） | **08:00 管线结构性不可通过 `validateCandidateSet`**：08:00 时 `calc_date = D−1 ≠ snapshotDate = D` ⇒ 必判 `mixed_date_detected`；**只有 22:00 管线可产出 promoted run** | 09-30 run（PASS）vs 10-01 run（`mixed_date_detected`）实读 + `CD-04` |
| **F-32** | F（事实） | 被提升 run（`engine:2026-09-30:b1790776862980`）属于 **22:00 自然链**：`fetchDailyData` TRIGGER_TIMER `22:00:06`（`3bc435d3…`）→ `materializeIndicators` TCB_API `22:00:56`（`1c88d7ae…`）→ `runDecisionEngine` TCB_API `22:01:02`（`c6ca469a…`） | CLS `2026-09-30 21:50–22:15` 窗口 |
| **F-33** | F（事实） | `runDecisionEngine` 另有**管理侧重入**路径：`adminGateway/index.js:547 riskResolve` / `:578 riskTrigger` / `:661 paramChange` 均 `callFunction runDecisionEngine` ⇒ 该类调用**不是自然运行**，§5.6 必须排除 | `origin/master` grep |
| **F-34** | F（事实） | `run_history` 含 v4.0 未登记的字段 `promoted_from_pointer_run_id`（与 `promoted_from_run_id` 并列，二者均 `null`）；`decision_count=5` / `portfolio_present=true` / `same_trade_date_supersede=false` | `run_history` 实读全文 |
| **F-35** | F（事实） | 被提升 run 的**in-band 载荷**（`ret_msg`）是**唯一**含 `authoritative_publish_status=PROMOTED` / `promotion_attempted=true` / `cas_reason=PROMOTED` / `portfolio_publish={created:true,deferred:true}` / `promotion_skipped_reason=null` 的凭证；而 `runtime_status` 单例（最后写入者 = 10-01 run）显示 `NOT_PROMOTED` / `false` ⇒ **两个字段都不足以单独判定 promotion，必须并用 `run_history.promoted`** | `retmsg_c6ca469a-….txt` vs `runtime_status` 实读 |
| **F-36** | F（事实） | `runtime_status.gen1_health_source = "GEN1_HEALTH_STATE_LATCH"`、`gen1_health_economic_status = "PENDING"`、`gen1_health_manual_review_required = true` ⇒ 健康态来自 **latch（锁存）**，非实时推导 | `runtime_status` 实读 |

（`F-30`~`F-36` 共 7 项；⛔ 不重复登记 F-1 ~ F-29。）

---

## 11. **CONTRACT GENERATION** 与最小变更面

### 11.1 是否需要 Contract Generation？

```text
判定：**需要**。
理由：① §3 字段来源（5 处）+ §3.1 双组 + §3.5 + §5.3 源集合 + §5.4 gate + §5.5 + §5.6 + §5.8
      **全部发生实质变化** ⇒ 属 §11 元规则下的**实质性修正**，须以新版发布并显式作废既有样本。
      ② v4.0 **尚未冻结** ⇒ 但改版动作会**取代 v4.0 的冻结对象** ⇒ 按 owner 授权「自主生成草案」执行。
```

**✅ 已生成**（`CONTRACT GENERATED` ≠ `CONTRACT FROZEN`）：

```text
outputs/evidence-watch-20260921/GEN1_EVIDENCE_CONTRACT_V5_0_DRAFT_20261002.md
  57319 B / 1003 行 / LF（crlf = 0）
  sha256 = 0e50f830e9e6daad73c0551fb4717ad58a4d30d559aab67cea1c76ad04a165db
  sha256(LF 归一) = 0e50f830e9e6daad73c0551fb4717ad58a4d30d559aab67cea1c76ad04a165db   （同值，纯 LF）
  状态头：⛔ DRAFT — NOT FROZEN — NOT AUTHORIZED FOR EXECUTION
```

**落点裁定**：置于 `outputs/`（命中 `.gitignore:8`）⇒ **仓库零足迹**、**不触碰 PR #60**、
不新增任何未跟踪文件到 `docs/gen1/`。载体（分支/PR）选定 = 闸门 **G-1**。

### 11.2 v5.0 相对 v4.0 的**最小变更面**（逐节）

| 节 | 变更 | 类型 |
|---|---|---|
| §1.3 / §1.4 / §1.5 | 新增 `CD-03`（同名两义）/ `CD-05`（触发器清单缺失）；`CD-02` 落点再改绑；新增 `CD-04`（生产字段误用）登记 | 登记 |
| §3 字段表 | #1 `date` / #3 `regime` / #4 `stage` / #7 / #8 来源列 → candidate | 改绑 |
| **§3.0** | **新增**：三身份量 / `SELECTOR = S-PROMOTED` + 否决理由 / `PROMOTION_PROOF` 四键 / `sample_key`·`bundle_key` | **新增** |
| §3.1 | 组 A 改 run 内自洽（A1/A2/A3）；组 B 左端改 candidate，新增 B3/B4；来源层级增列 `run_candidate_*` 与 `portfolio_snapshot`（⛔ 不作来源） | 重定义 |
| §3.4 | ⛔ **零改动**（沿用 v3.0 冻结规则） | — |
| §3.5 | **重写**：拆 (III)/(IV)、四概念表、复核条件已触发并闭合 | 重写 |
| **§3.6** | **新增**：`portfolio_snapshot` 与 `run_candidate_portfolio` 语义分界（E-2/UNV-23 闭合） | **新增** |
| §4.2 | 新增排除项 6（未过 `PROMOTION_PROOF`）/ 7（§5.9 不成立） | 新增 |
| §5.3 | 五源 → **八源**（保留 3 / 改绑 2 / 新增 3） | 改绑 + 新增 |
| §5.4 | **重写** 14 条 gate（规则 1/2 按 pointer revision；组 A/B 分离；新增 r14 禁令） | 重写 |
| §5.5 | 新增单调采纳（③④） | 补充 |
| §5.6 | **CHAIN PROOF 重锚**到 22:00 入口管线；新增管理侧重入排除 | 重锚 |
| §5.7 | 前进性比较对象由 `updated_at` 改为 `pointer.revision` | 改绑 |
| §5.8 | checkpoint 09:00 → **22:30 窗口** | 重锚 |
| **§5.9** | **新增**：`EVIDENCE OBJECT BOUNDARY` + 边界字段组 | **新增** |
| §9.1 | 来源表全列改 run 轴 | 改绑 |
| §10 | 生效日改为「冻结后**首个被 PROMOTION_PROOF 采纳**的自然 run」 | 改绑 |
| §11 | 变更日志新增 v5.0 行；新增元规则第 5 条（工具迁移与冻结同批次） | 留痕 |
| §12 | 新增第 10/11/12 项（`CD-04` 归属 / 健康闸 / 工具迁移） | 补充 |

**变更面性质**：**docs-only / contract-only**。
⛔ **不触及**生产代码、生产配置、DB schema、Authority、Seal、lock、immutable_set、PR #60。

### 11.3 外部工具（非契约，**本步不改**）

```text
_evidence-capture-tool/c1_capture.py 需同步项（随 v5.0 FREEZE 同批次）：
  :47  CHECKPOINT_TOLERANCE_MIN = 30   → 22:30 窗口语义
  :41-44 NOW/STAMP/TODAY               → checkpoint 时点为 22:30
  :155-204 collect() 读点               → run_candidate_decision / run_candidate_portfolio /
                                          run_manifest / active_run_pointer / run_history
  :251-256 契约绑定点                    → contract_version / path / 双指纹
  evaluate_gate() 九条                  → 与 §5.4 十四条对齐
  evaluate_eligibility()                → 与 §4.2 七条对齐
  bundle 落盘串                          → 「工作日 22:30–23:30（北京）」
⛔ 本步**不改** —— 依据 v5.0 §11 规则 5（工具迁移与契约冻结同批次），
   否则构成「按未冻结契约采样」的**预登记违规**。
```

---

## 12. 依赖闭合矩阵 与 未闭合项

### 12.1 依赖链（本裁定集是否自洽闭合）

```text
D-0 (①b)
  └─→ A-1 (决定) ─┬─→ selector = S-PROMOTED ─┬─→ C-1b (pointer + history 必须进源)
                  │                          ├─→ sample_key 须含 run_id
                  │                          ├─→ C-2° (gate 规则 1/2 按 pointer revision)
                  │                          ├─→ §5.9 EVIDENCE OBJECT BOUNDARY（防误读）
                  │                          └─→ §5.6 CHAIN PROOF 重锚（否则 100% 误杀）
                  ├─→ B-1° PROMOTION_PROOF 四键
                  ├─→ B-2° 组 A 改 run 内自洽（否则对 promoted run 恒定 FAIL）
                  └─→ C-1a manifest 进源 ──→ §3.5 必须重写（CD-03）──→ E-5 复核条件已触发
B-3° ((IV) host-local) ─┬─→ R10 保持（四概念不合并）
                        └─→ §5.4 r14 禁令（(IV) 不进任何 gate）
CD-04 (生产字段误用) ───→ 只有 22:00 管线可提升 ──→ E-4 checkpoint 重锚为 22:30
E-2 (UNV-23) ──────────→ §3.6 分界（portfolio_snapshot 不可作 run 产物源）──→ 独立支持 ①b
```

**闭合性判定**：✅ **闭合** —— A-1 / B-* / C-* / E-2 / E-4 / E-5 **互相不冲突**，且**无循环依赖**。
唯一的**外部依赖**（不由本裁定集闭合）是 `CD-04`（生产侧）与健康闸（PHASE 2）。

### 12.2 可独立裁定 vs 必须等 selector

| 事项 | 可独立裁定？ | 说明 |
|---|---|---|
| D-0（①b） | ✅ 可 | 由 E-1 事实决定 |
| B-3°（(IV) host-local） | ✅ 可 | 由 R10 + forward T0 语义决定 |
| A-1（决定 vs 计算） | ✅ 可（**但为其余裁定的前置**） | 由 R7 决定 |
| E-4（checkpoint） | ✅ 可（依赖 `CD-04` 事实，不依赖 selector） | 由管线事实决定 |
| E-5（§3.5） | ⚠️ 依赖 C-1a | C-1a 一旦成立即触发重审 |
| C-1a / C-1b | ⛔ **必须**等 selector | selector 决定 pointer 是否成为 pin 对象 |
| B-1° / B-2° | ⛔ **必须**等 A-1 | A-1 决定「promotion 是否入判据」⇒ 组 A 右端 |
| C-2° | ⛔ **必须**等 A-1 | 排序装置由 selector 决定 |

### 12.3 ⛔ 未闭合项（**不由本步闭合**）

| # | 未闭合项 | 阻塞原因 | 需要的闸门 |
|---|---|---|---|
| U-1 | v5.0 **载体仓库写入** | Git 正式集成动作 | **G-1** |
| U-2 | v5.0 **FREEZE / SEAL** | 独立高风险治理动作 | **G-2** |
| U-3 | **PR #60 body 更正** | 修改既有 PR 历史 | **G-3** |
| U-4 | **`CD-04` 生产修复**（08:00 管线无法提升） | 改生产代码 | **G-4**（V3.6.6 需求） |
| U-5 | **健康闸开启**（`canary_active=false` / `health=DEGRADED`） | PHASE 2 健康语义 | **G-5** |
| U-6 | `c1_capture.py` 迁移 | 与 FREEZE 同批次 | 随 **G-2** |
| U-7 | Evidence **实际产出样本** | U-1~U-6 未闭合 ⇒ 正式样本数恒 0（**预期态，非缺陷**） | — |

**⚠️ 关于 U-7 的诚实声明**：本裁定集完成后，**Evidence 仍不能产出任何正式样本**。
两个**独立**原因：① 读源/契约链未冻结（U-1/U-2）；② `gen1_counterfactual_canary_active = false`（候选资格，U-5）。
⛔ 不得把「契约已生成」误读为「Evidence 已可执行」。

---

## 13. 授权闸门（STOP 点）与零修改断言

### 13.1 ⛔ 需 owner 明确授权的 5 个闸门

| 闸门 | 动作 | 为何是闸门 |
|---|---|---|
| **G-1** | 把 v5.0 草案写入仓库载体（自 `origin/master` 开新分支 + commit + PR） | 属「Git 不可逆/正式集成动作」 |
| **G-2** | v5.0 **FREEZE / SEAL** | 属「正式 freeze」——owner 明令独立闸门 |
| **G-3** | **PR #60 body 更正** | 属「修改 PR #60 的既有历史内容」 |
| **G-4** | **`CD-04` 生产修复**（`validateCandidateSet` 日期对修正 / 或 08:00 管线策略） | 属「修改生产代码」 |
| **G-5** | **健康语义上产**（PHASE 2：`canary_active` / `health_status` 路径） | 属「修改生产代码 / 配置 / canary_active」 |

**⛔ 本步未触碰任一闸门。**

### 13.2 零修改断言（四块式）

```text
ETF 仓库（工作区 D:/AI-Projects/Codex/etf-decision-engine/etf-decision-engine-gen1，HEAD 2e24ecd @ gen1-worktree-20260916）：
- Git 跟踪文件：**零修改**（本步未编辑任何跟踪文件）
    ⚠️ 披露既有状态（**非本步所为**，mtime 2026-09-21）：
       ` M docs/gen1/GEN1_DOC_ERRATA_20260916.md`（`git diff --stat HEAD` = 1 file changed, 35 insertions(+)）
    ⚠️ 披露既有未跟踪（**非本步所为**）：
       `?? docs/gen1/GEN1_EVIDENCE_CONTRACT_V2.md`（mtime 2026-09-21 11:42）
       `?? .workbuddy-ai/`（mtime 2026-09-22 09:16）
- Git 历史 / 分支 / 远端：**零修改**（未 commit / push / 建 PR / merge / deploy / freeze）
- 未跟踪本地草稿（本步新增 **2 份**）：
    · outputs/evidence-watch-20260921/GEN1_STEP11_E1B_AB_AUTONOMOUS_GOVERNANCE_RULING_20261002.md（本文件）
    · outputs/evidence-watch-20260921/GEN1_EVIDENCE_CONTRACT_V5_0_DRAFT_20261002.md（v5.0 草案）
    （`outputs/` 命中 `.gitignore:8` ⇒ **不入库**、不进入 `git status`）
  ⛔ `_v4-contract-20260923` worktree 内**零改动**（tracked status 仍为空；HEAD 仍 `8d1f1cd`）
其他本机文件：
- 仓库外工具目录新增只读取证脚本与归档：`_cb-connect-20260921/autonomy_sweep.py`、
  `autonomy_sweep_20261002.json`、`cls_0930_2200.json`（均为**只读取证产物**，不改既有文件）
- `.workbuddy/memory/2026-10-02.md` 与 automation memory 追加
生产侧：
- 代码 / 配置 / Authority / Seal / `FROZEN_PARAM_KEYS` / lock / immutable_set：**零修改**
- Evidence Contract v1.0 / v2.0 / v3.0 / v4.0：**零字节修改**（v4.0 指纹复算与 E-1 记录逐位一致）
- DB 九集合（`decision_result` / `portfolio_snapshot` / `ml_shadow_signal` / `runtime_status` /
  `run_candidate_decision` / `run_candidate_portfolio` / `run_manifest` / `run_history` / `active_run_pointer`）：
  **零写入**（本步 DB 写命令数 = **0**；全部经 `assert_readonly` 白名单）
- 云函数：**未调用、未部署、未改触发器**；未触发任何 automation
- `c1_capture.py`：**零修改**（依 v5.0 §11 规则 5，与 FREEZE 同批次）
- health / canary / permission / overlay / CALC / ORCH：**零修改**
- PR #60：**零修改**（未改 body、未改 commits）
```

**独立核验命令结果**：
```text
git -C <主仓库> rev-parse --abbrev-ref HEAD   → gen1-worktree-20260916
git -C <主仓库> rev-parse HEAD                → 2e24ecd6ba5fa1d21b2c6337e24f6aa09c2a1781
git -C <主仓库> diff --stat HEAD              → docs/gen1/GEN1_DOC_ERRATA_20260916.md | 35 +（既有披露）
git -C <主仓库> status --short                → 3 行（1 M 既有披露 + 2 ?? 既有孤本）
git -C <_v4-contract-20260923> rev-parse HEAD → 8d1f1cde5effa8bf6eb3d88b780f84e3873337ef
git -C <_v4-contract-20260923> status --short → （空）
```

---

## 14. 交付元数据与断言

### 14.1 交付清单

| # | 文件 | 大小 | 行数 | 换行 | sha256 | 状态 |
|---|---|---|---|---|---|---|
| 1 | `outputs/evidence-watch-20260921/GEN1_STEP11_E1B_AB_AUTONOMOUS_GOVERNANCE_RULING_20261002.md` | 见 §14.3 | 见 §14.3 | LF | 见 §14.3 | 本文件（不入库） |
| 2 | `outputs/evidence-watch-20260921/GEN1_EVIDENCE_CONTRACT_V5_0_DRAFT_20261002.md` | **57319 B** | **1003 行** | **LF（crlf=0）** | **`0e50f830e9e6daad73c0551fb4717ad58a4d30d559aab67cea1c76ad04a165db`** | ⛔ DRAFT / NOT FROZEN / 不入库 |

### 14.2 断言（POS / NEG）

**POS（本文件关键串必须命中）+ NEG（禁语必须零命中）** —— 结果见 §14.4。

**⚠️ 断言纪律（吸取前轮教训）**：
① NEG 禁语**不逐字落盘**，仅在断言脚本中枚举（避免自含陷阱）；
② 断言串必须与实际落盘**格式一致**（不使用报告里不存在的写法）。

**NEG 枚举（类别化；⛔ 此处**不逐字落盘**，仅以语义类别描述，实际字符串只在断言脚本中枚举）**：

```text
N-1  以「零改动 / 无改动」形态自述本步的文件状态
N-2  以「缩小到只改本机文档」形态描述本步的写入范围
N-3  声称本步已完成冻结、已取得冻结授权、或已进入生产
N-4  声称本步已把 ①a 或 ①c 定为最终读源方案
N-5  声称本步已把 S-LATEST 或 S-VALIDATED 定为最终 selector
N-6  以「已解决」「已单独立项」收尾的结论式表态
N-7  声称本步改动了第五十九号拉取请求、抓取脚本、或生产代码
N-8  声称本步已部署 / 已合并 / 已推送 / 已建发布
```

> ⚠️ **纪律说明**：本清单刻意**不使用**禁语的字面形态；N-7 中的「第五十九号拉取请求」
> 即为避免与禁语字面重合而采用的**代称**。断言脚本另行按字面枚举（脚本不随报告落盘）。

### 14.3 / 14.4 写后复算与断言结果

```text
report_path      = outputs/evidence-watch-20260921/GEN1_STEP11_E1B_AB_AUTONOMOUS_GOVERNANCE_RULING_20261002.md
bytes            = 00058574
lines            = 00000938
eol              = LF（crlf = 00000000）
sha256           = ⛔ 不在文件内自引（自指悖论）—— 见同名 `.sha256` 旁车文件
generated_at_cst = 2026-10-02 11:59:22 +08
generated_at_utc = 2026-10-02T03:59:22Z
POS              = 078/078 PASS
NEG              = 022/022 零命中

```

---

## 15. STOP-AND-REPORT

**本步（OWNER-AUTHORIZED AUTONOMOUS GOVERNANCE）已完成，STOP。**

```text
自主裁定完成：
  D-0  读源正解        = ①b（改绑 candidate / promotion 链）
  A-1                  = 决定（DECISION）  ⇒ selector = S-PROMOTED
  B-3°                 = CALENDAR TRADE DATE 保持 HOST-LOCAL
  B-1°                 = PROMOTION_PROOF 四键 AND
  B-2°                 = 组 A 改 run 内自洽
  C-1°                 = 源集合 5 → 8（保留 3 / 改绑 2 / 新增 3）
  C-1b                 = pointer_revision 进 provenance、不进 sample_key
  C-2°                 = gate 规则 1/2 改按 pointer revision
  E-2                  = UNV-23 闭合
  E-3                  = 指纹可复算（✅）；PR #60 body 更正 → ⛔ 闸门 G-3
  E-4                  = checkpoint 重锚为 工作日 [22:30, 23:30)
  E-5                  = §3.5 重写（CD-03 已触发并就地闭合）
派生：
  selector = S-PROMOTED ｜ run identity = {run_id, revision, pointer_revision}
  sample_key = <run_id>::<code> ｜ bundle_key = <decision_date>
  date semantics = 四概念、两名入契约（DATA DATE = Evidence.date；RUN DATE = 组 A 护栏）
  source binding = 八源
  contract revision surface = §3.0(新)/§3.1/§3.5/§3.6(新)/§5.3/§5.4/§5.5/§5.6/§5.8/§5.9(新)/§9.1/§11/§12
CONTRACT GENERATED = ✅（v5.0 草案 57319 B / 1003 行 / sha256 0e50f830…65db，⛔ 未入库、未冻结）
新发现 = F-30 ~ F-36（7 项）；缺陷登记 = CD-02(重绑) / CD-03 / CD-04 / CD-05
```

**⛔ 本步未做（且必须 STOP 等授权）**：

```text
⛔ 未 deploy / rollback / 改生产代码 / 配置 / Authority / FROZEN_PARAM_KEYS / lock / immutable_set
⛔ 未触发任何生产写入云函数；未改 production_write / auto_execution / canary_active / ml_effective
⛔ 未改正式 selector / 未改生产 promotion 行为 / 未做 reader migration
⛔ 未 merge / push / 建 release·freeze / 改 frozen tag / 删·重写历史 / 对 master 不可逆集成
⛔ 未修改 PR #60（body / commits）
⛔ 未修改 c1_capture.py（依 v5.0 §11 规则 5）
⛔ 未 FREEZE / SEAL v5.0
⛔ 未修改任何仓库跟踪文件；未 commit / push / 建 PR
DB 写命令数 = 0
```

**需要的授权（按最小可行顺序）**：

```text
G-1  契约载体仓库写入（自 origin/master 开新分支 + commit + PR，承载 v5.0 DRAFT→FREEZE 候选）
     —— 与 G-3（PR #60 body 更正）建议**合并**为一次载体动作
G-2  v5.0 FREEZE / SEAL（须待 G-1 完成 + 审计通过）
```

**其余（G-4 `CD-04` 生产修复 / G-5 健康语义）属后续阶段（V3.6.6 / PHASE 2），本步不请求。**
