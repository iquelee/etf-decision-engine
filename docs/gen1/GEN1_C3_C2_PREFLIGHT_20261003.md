# GEN1_C3_C2_PREFLIGHT_20261003 — C-3 / C-2 前置侦察与实施方案

> **Gate 类型**：只读 preflight（OWNER-AUTHORIZED PREFLIGHT ONLY）
> **授权边界**：只读源码/配置/DB/schema/authority 路径检查 · 定位实施断点 · 形成最小修改方案 / 验证方案 / rollback 方案 / production-write boundary / 审计·evidence 方案
> **⛔ 本 Gate 不做**：修改 production code / production config / DB write / authority 升档 / release selection / active pointer 写入 / production read path 修改 / deploy / push / merge / tag / canary / Evidence Execution / GE-04
> **⛔ 本件不构成实施授权**：文中所有"最小方案"均为**设计**，⛔ 不代表已获授权。实现须 owner 明示 `AGENT IMPLEMENTATION AUTHORIZED`。

---

## §0 方法与证据分级

| 级别 | 含义 | 本件用法 |
|---|---|---|
| `online-codeinfo` | 线上云函数 `index.js` 全文（`cb-connect-20260921/codeinfo_20261002/`） | **权威**（判线上行为） |
| `online-db` | CloudBase 只读实读（`cb_query.py`，2026-10-03） | **权威**（判线上状态） |
| `repo-src:<worktree>` | 指定 worktree 的工作区源码 | 用于**对拍**；⛔ 单独不作线上判据 |
| `manifest-frozen` | `ml/manifests/*.json` 冻结清单 | 判"是否触碰冻结对象" |
| `NOT RE-READ` | 未在本轮复读的历史结论 | ⛔ 不作本轮判据 |

**★ 本轮新增硬约束（部署源身份，实测得出）**：

| 云函数 | 线上 sha256(LF) | 匹配源 | 载体树是否匹配 |
|---|---|---|---|
| `runDecisionEngine` | `7e339fb2a9…`（1738 行） | **`_v365-frozen-baseline`** | ✗（载体树 = V3.6.1，1378 行） |
| `runGen1ShadowEod` | `485244e4f7…`（274 行） | **`_v365-frozen-baseline`** | ✓（相等） |
| `adminGateway` | `ea8cac727b…`（998 行） | **`_v365-audit-20260930/ref-0908`** | ✗（载体树 1134 行） |
| `apiGateway` | `8b2103455d…`（968 行） | **`_v365-audit-20260930/ref-0908`** | ✗ |
| `materializeIndicators` | `3f9b3e69c3…`（137 行） | **`ref-0908`**（多 worktree 同） | ✓ |

⇒ **结论 D-0（本件最重要的前置事实）**：线上 = **混合部署**，**不存在**单一 worktree 能完整复原线上。
⇒ **任何涉及代码变更的实施，必须逐函数选定与线上一致的基线**；⛔ **载体树 `_g1-contract-v5-20261002` 的源码（V3.6.1）不得作为任何函数的部署源**。

---

## §1 Executive Summary

1. **C-3 的旧描述被证伪一半**：pre-launch inventory §12 称 `missing_features`「产出但未落库」——**实测已落库**（`ml_shadow_signal.missing_features`，线上可只读读出）。C-3 的**真实缺口**是「特征级明细**不进入权威健康载体**」+「`REQUIRED_FEATURES` 把语义可空字段列为必需」。
2. **C-3 的根因已定位**：`515880`（及 `159582`）缺失特征 = **`sideway_range`**，根因 = **`sideway_days = 0`** ⇒ `calcSidewayRange()` 返回 `null`。这是**语义性空值**（当日非横盘），**不是**数据管线故障、也**不是**统计异常。
3. **C-3 触发的连锁**：`sideway_range` 属 `REQUIRED_FEATURES`（15 项）⇒ 被判 `STATISTICAL_MISSING` ⇒ `DATA_DEGRADED` ⇒ `worstData='DEGRADED'` ⇒ latch `DEGRADED`。**这是 C-1 的可能根因之一**。
4. **冻结面判定**：`gen1-data-health.js` **不在** `GEN1_FEATURE_PIPELINE_LOCK.json` 的 4 个绑定文件内 ⇒ 修改 `REQUIRED_FEATURES` **不触碰 FROZEN**（属 **R2**）。但 `indicators.js` **在**锁内 ⇒ 修 `calcSidewayRange/calcSidewayDays` **触碰 FROZEN**（属 **R3/R4**）。
5. **C-2 确证**：latch 载体 = 集合 `gen1_health_state` 单文档；线上实测 `latched_health=DEGRADED`、`degraded_at=2026-09-21T14:20:27.241Z`、`reviewed_at=null`、`reviewed_by=null`、`recovery_allowed=false` ⇒ **自 2026-09-21 起持续降级且从未人工复核**。`manualReviewConfirmed` 生产调用方 = **0**。
6. **C-2 的合法 release 路径确实不存在**（逐项排除：latch writer / reader / authority / admin gateway / CLI·admin scripts / DB mutation / env·config override / startup·recovery / test-only / emergency / historical / archived production）。
7. **本件给出 C-2 的最小 release contract 设计**（WHO/WHEN/WHAT/WHERE/HOW×5），并标出其所属授权等级（**R2 设计，R3 实施**）。
8. **⛔ 本 Gate 零生产动作**；⛔ 不改任何既有闸门（含 `v6_negative_scan.py`，F-5/F-6 保留为后续独立 harness work item）。

---

## §2 C-3 Definition

### §2.1 编号来源与撞名（NS-5）

| 义项 | 内容 | 状态 |
|---|---|---|
| `C-3`（**旧义**） | 「三项 AUTHORIZATION GATE 未授权」 | 已**拆入 `E-6`**（授权轴） |
| `C-3`（**现义 · 本件采用**） | 「`515880` 缺失特征未定位（`missing_features` 未持久化）」 | 本件重定义 |

> ⚠️ 跨件引用 `C-3` **必带限定**：写「C-3（`515880` 缺失特征）」或「C-3（授权轴，已并入 E-6）」。

### §2.2 修正后精确定义

> **C-3（2026-10-03 实测修正）**：`515880`（及 `159582`）的数据健康降级**特征级根因**为 `sideway_range` 的**语义性空值**（`sideway_days = 0`，即当日未被判定为横盘）；该明细**已落库于 `ml_shadow_signal`**，但**不进入权威健康载体**（`gen1_health_state` 单例 / `runtime_status` 镜像）。真正的缺口是**健康判定口径**（`REQUIRED_FEATURES` 未区分语义可空字段），**不是**数据缺失。

**旧表述「`missing_features` 未持久化」裁决**：**证伪**（见 §3.2 行 E-3、§3.3 行 D-1）。

---

## §3 C-3 Code Evidence

### §3.1 代码链（全部 `online-codeinfo` 对齐；`runGen1ShadowEod` 仓库≡线上 sha256 `485244e4f7…`）

| 节点 | 文件:行 | 内容（要点） |
|---|---|---|
| E-1 | `src/common/utils/gen1-data-health.js:35-39` | `REQUIRED_FEATURES` = **15 项**，含 `'sideway_days','sideway_range',…`；注释自称「与 frozen-manifest `features_core` 对齐」 |
| E-2 | `gen1-data-health.js:57` | `function evaluateDataHealth(input)` |
| E-3 | `gen1-data-health.js:66-68` | `absent`（key 不存在）/ `nullish`（key 存在但 null/NaN）/ `missing = absent ∪ nullish` |
| E-4 | `gen1-data-health.js:116-120` | `nullish.length > 0` ⇒ `DATA_DEGRADED` + `REASON.STATISTICAL_MISSING` |
| E-5 | `indicators.js:185-193` | `calcSidewayDays()`：`bars = dailyBars.slice(-80)`；`bars.length < 20 ⇒ 0`；`findConsolidation().days >= sideway_days_min(8) ? days : 0` |
| E-6 | `indicators.js:202-213` | `calcSidewayRange(dailyBars, sidewayDays)`：`if (!sidewayDays \|\| sidewayDays < 1) return null;` |
| E-7 | `indicators.js:722` | `const sidewayRange = calcSidewayRange(dailyBars, sidewayDays);` |
| E-8 | `indicators.js:769` | `sideway_range: sidewayRange,`（写入特征行） |
| E-9 | `runGen1ShadowEod/index.js:174-179` | `evaluateDataHealth({ features: row, mainLatestDate: day, benchmarkLatestDate, historyBars: row.history_bars, minHistoryBars: 60 })` |
| E-10 | `runGen1ShadowEod/index.js:181-190` | `worstData` = 跨标的取最差（`DATA_BLOCKED` > `DATA_DEGRADED` > `OK`） |
| E-11 | `runGen1ShadowEod/index.js:192` | `computeLatchedState(prevState, incoming, { runtimeDataHealth: worstData })` —— **只传 status 字符串，不传 `missing_features`** |
| E-12 | `runGen1ShadowEod/index.js:234` | `missing_features: dataHealth.missing_features,` ⇒ 写入 `COLLECTIONS.ML_SHADOW_SIGNAL`（`'ml_shadow_signal'`） |

### §3.2 线上只读实读（`online-db`，2026-10-03）

**D-1 · `ml_shadow_signal` 确有 `missing_features` 字段**（⇒ 旧"未落库"描述证伪）：

```text
filter {"code":"515880"}  →  date=2026-09-28/24/23, stage=S3, data_health_status=DATA_OK, missing_features=[]
filter {"data_health_reason_code":"STATISTICAL_MISSING"}
  →  row(截断)  515880  stage=S3  DATA_DEGRADED  missing_features=["sideway_range"]
  →  row 3      159582  stage=S2  DATA_DEGRADED  missing_features=["sideway_range"]
  →  row 4/5/6/7 159582 S2（08-28/24/23/22/21 区间）同上
```

**D-2 · 权威健康载体无特征明细**（`runtime_status` 单例，`key="runtime-status"`）：

```text
gen1_health_status          = "DEGRADED"
gen1_health_gate_status     = "ACTIVE"
gen1_health_manual_review_required = true
gen1_health_read_reason_code= null
gen1_health_source          = "GEN1_HEALTH_STATE_LATCH"
gen1_health_economic_status = "PENDING"
⛔ 无 missing_features / 无 data_health 分项 / 无 gen1_health_data_status
```

**D-3 · `GEN1_FEATURE_PIPELINE_LOCK.json` 绑定面（`manifest-frozen`）**：

| role | path |
|---|---|
| `indicator_implementation` | `src/common/utils/indicators.js` |
| `trend_stage_implementation` | `src/common/utils/trend-stage.js` |
| `feature_builder_and_params` | `cloudfunctions/runGen1ShadowEod/index.js` |
| `feature_schema_and_thresholds` | `cloudfunctions/runGen1ShadowEod/frozen-manifest.json` |

⇒ `any('data-health' in path) == False` ⇒ **`gen1-data-health.js` 不在冻结锁内**。
⇒ `indicators.js` **在**锁内（`hash_basis = "LF-normalized content (CRLF->LF before sha256)"`）。

### §3.3 C-3 的 12 问逐项回答

| # | 问题 | 回答 |
|---|---|---|
| 1 | C-3 精确定义 | §2.2（特征级根因已可读出；缺口=口径与权威载体） |
| 2 | 当前阻塞点 | 阻塞点**不在工程**，在**判定口径**：`REQUIRED_FEATURES ⊇ {sideway_range}` 且该字段语义可空 |
| 3 | 12 问逐项 | 本表 |
| 4 | 真实源码调用链 | §3.1（E-1…E-12） |
| 5 | 配置/DB/schema/authority 依赖 | 集合 `ml_shadow_signal`/`gen1_health_state`/`runtime_status`；`src/common/schema.js:324-325` 声明 `gen1_health_status`/`gen1_health_source`；**不依赖** `gen1-authority.js` |
| 6 | 最小实施变更面 | **方案 A（口径修正）**：`gen1-data-health.js` 的 `REQUIRED_FEATURES` 拆为 `REQUIRED_HARD` + `OPTIONAL_SEMANTIC_NULLABLE`（含 `sideway_range`）⇒ **单文件、单函数**。**方案 B（根因修正）**：`indicators.js` 的 `calcSidewayRange` 改为在 `sidewayDays=0` 时返回 `0` 而非 `null` ⇒ **触碰 FROZEN** |
| 7 | 不应修改的文件/路径 | `indicators.js` / `trend-stage.js` / `runGen1ShadowEod/index.js` / `frozen-manifest.json`（**四者均 FROZEN**）；`ml/manifests/GEN1_*`；`gen1_authority` 相关；`selector` |
| 8 | 验证矩阵 | §12（V-C3-01…V-C3-06） |
| 9 | rollback 方案 | §13（C-3 为纯只读/口径改动，rollback = 恢复到改动前 sha256，无数据回滚需求） |
| 10 | production write boundary | §14（C-3 本身 **0 写**；方案 A 仅改 `src/`，**不产生任何 DB 写**） |
| 11 | evidence 需要捕获什么 | §15（E-C3-01…E-C3-04） |
| 12 | **若 C-3 不做，关键路径在哪一节点阻塞** | **在 `C-1`**：`sideway_range` 假阳性会持续把 latch 钉在 `DEGRADED` ⇒ `C-1` 目标「`OK` + `gate_status=ACTIVE`」**不可达**（即使数据完全正常）⇒ `C-4`（`allow_canary`）随之不成立 ⇒ `A-1`（guarded candidate）恒 null。⚠️ 且 `C-2` 的恢复端点**只能治标**：恢复后下一次运行若再遇 `sideway_days=0` 会**再次降级**（latch 反复） |

---

## §4 C-3 Dependency Graph

```text
[数据源: materializeIndicators → ETF 特征行]
        │
        ├─ indicators.js::calcSidewayDays ──► sideway_days ∈ {0, 8..40}
        │        │                                    │
        │        └─ indicators.js::calcSidewayRange ◄─┘
        │                 └──► sideway_range ∈ {null, 0..hardCap}
        │                              │
        ▼                              ▼
[runGen1ShadowEod]  evaluateDataHealth(features=row)
        │                    │
        │                    ├─ absent  ⇒ PIPELINE_MISSING ⇒ DATA_BLOCKED
        │                    └─ nullish ⇒ STATISTICAL_MISSING ⇒ DATA_DEGRADED   ← ★ C-3 命中点
        │
        ├─ worstData (跨标的)  ──►  computeLatchedState(..., {runtimeDataHealth})
        │                                   │
        │                                   ▼
        │                          [gen1_health_state] latch  ← ★ C-2 写点
        │                                   │
        │                                   ├─► rde:769-778 readHealthState → healthStateToGate
        │                                   └─► rde:1653 upsert [runtime_status] 镜像
        │
        └─ ml_shadow_signal.upsert（含 missing_features）← ★ C-3 明细落点
                        │
                        └─► 仅审计/诊断可读；⛔ 不参与授权（gen1-health-state.js:23 明文）

依赖方向：C-3 ⇢ C-1 ⇢ C-4 ⇢ A-1   （C-3 为 C-1 的前置）
并列 ROOT：C-3 ∥ C-2              （⛔ 非串行）
```

---

## §5 C-3 Minimal Change Surface

### §5.1 方案 A（推荐设计 · 口径修正 · **不触碰 FROZEN**）

| 项 | 内容 |
|---|---|
| 变更文件 | `src/common/utils/gen1-data-health.js`（**1 个**） |
| 变更函数 | `evaluateDataHealth`（**1 个**）+ 常量 |
| 变更要点 | ① `REQUIRED_FEATURES` 拆两级：`REQUIRED_HARD`（14 项，剔除 `sideway_range`）+ `SEMANTIC_NULLABLE`（`sideway_range`；null 时**不计入** `nullish`，或计入但不触发 `DEGRADED`）；② 保留 `missing_features` 输出（供审计）；③ 新增 `nullable_absent` 字段以**不丢失可见性** |
| 触冻判定 | `gen1-data-health.js` ∉ FEATURE_PIPELINE_LOCK ⇒ **不触碰 FROZEN** |
| 授权等级 | **R2**（Implementation 需 Owner 明确授权），⛔ 非 R3（无 DB 写、无部署语义变化） |
| ⚠️ 副作用 | 该函数同时被 `runGen1ShadowEod:270`（只取 `.status`）复用 ⇒ 变更会影响该处 status；须在验证矩阵覆盖 |

### §5.2 方案 B（根因修正 · **触碰 FROZEN**）

| 项 | 内容 |
|---|---|
| 变更文件 | `src/common/utils/indicators.js` |
| 变更要点 | `calcSidewayRange` 在 `sidewayDays = 0` 时返回 **`0`**（而非 `null`），并把"非横盘"语义编码为显式值 |
| 触冻判定 | ⚠️ **`indicators.js` ∈ FEATURE_PIPELINE_LOCK**（`role=indicator_implementation`，`sha256=5ff862d1…`）⇒ 变更将使 `feature_pipeline_hash` 失效 |
| 连带 | 必须重签 `GEN1_FEATURE_PIPELINE_LOCK.json` + `GEN1_RUNTIME_BUNDLE.json`（`feature_pipeline_hash=8efdda6f…`）⇒ 触及 **FROZEN/SEAL 轴** |
| 授权等级 | **R3/R4**（冻结对象重签） |
| 判定 | ⛔ **不建议作为 C-3 的首选**（成本/风险远高于方案 A，且语义上"非横盘"本就应可空） |

### §5.3 方案 C（不改代码 · 仅登记可见性）

| 项 | 内容 |
|---|---|
| 变更 | **无代码变更**；将 `sideway_range` 语义性空值登记为 **KNOWN-DEGRADED-SOURCE**，并在诊断文档中显式记录 |
| 影响 | ⛔ latch 仍在 `DEGRADED`（假阳性持续）⇒ **不解除 C-1 阻塞** |
| 定位 | 仅作"不做变更时的如实登记"，**不构成推进** |

**推荐顺序**：A（首选）> C（登记）≫ B（触碰冻结，须独立 Gate）。

---

## §6 C-2 Definition

> **C-2**：线上**不存在**「受控 latch 恢复端点」——`manualReviewConfirmed` 的正确传参通道在生产代码中缺失（CALLER COUNT = 0），导致 `DEGRADED/ML_OFF` 一旦 latch **无法合法释放**。

**目标态**：存在一个**受控、可审计、可回滚、不可绕过**的恢复通道。

**当前态（`online-db`，2026-10-03 实测）**：

```text
gen1_health_state / key="gen1-health-state"
  current_health            = "DEGRADED"
  latched_health            = "DEGRADED"
  degraded_at               = "2026-09-21T14:20:27.241Z"   ← 首次降级
  manual_review_required    = true
  recovery_allowed          = false
  reviewed_at               = null                          ← ★ 从未复核
  reviewed_by               = null                          ← ★ 从未复核
  runtime_data_health       = "DEGRADED"
  economic_health           = "PENDING"
  updated_at                = "2026-10-02T14:20:23.258Z"
```

---

## §7 C-2 State Machine

```text
                    ┌──────────────────────────────────────────────┐
                    │  读取：readHealthState(db, COLLECTIONS)      │
                    │  gen1-health-state.js:228-256                │
                    └───────────────┬──────────────────────────────┘
                                    │ read_status ∈
             ┌──────────────────────┼──────────────────────┐
             ▼                      ▼                      ▼
        FOUND               NOT_INITIALIZED           READ_ERROR
   （读文档，gate ACTIVE）  （gate PENDING；        （gate READ_ERROR；
                            allow_canary=false；     latched=ML_OFF；
                            persist_allowed=false）  persist_allowed=false）
             │
             ▼
   ┌─────────────────────────────────────────────────────────┐
   │ computeLatchedState(prev, incoming, opts)               │
   │   gen1-health-state.js:96-181                           │
   │   wasDown = isDown(prev.latched_health)                 │
   │   nowUp   = !isDown(incoming)                           │
   └───────┬──────────────────────────┬──────────────────────┘
           │ wasDown && nowUp         │ wasDown && !nowUp        │ !wasDown
           ▼                          ▼                          ▼
  ┌────────────────────────┐  ┌──────────────────┐   ┌──────────────────┐
  │ ★ 唯一 release 分支     │  │ 仍下行：取更差者  │   │ 正常：跟随 incoming│
  │ :137-153               │  │ :154-158          │   │ :159-163          │
  │ if (manualReviewConfirmed│ │ latched=worse()   │   │ latched=incoming  │
  │      === true)         │  │ recovery_allowed  │   │ recovery_allowed  │
  │   → latched=incoming   │  │   = false         │   │   = false         │
  │     reviewed_at/by 置位│  └──────────────────┘   └──────────────────┘
  │     recovery_applied   │
  │ else                   │
  │   → latched=prevLatched│   ★★ 当前线上：本分支永不进入
  │     manual_review_    │      因为 manualReviewConfirmed 无生产传参方
  │       required=true    │
  │     recovery_rejected  │
  │     recovery_allowed   │
  │       = false          │
  └───────────┬────────────┘
              ▼
   ┌──────────────────────────────────────────────┐
   │ writeHealthState(db, state, COLLECTIONS)     │
   │   :262-281  （persist_allowed=false ⇒ 跳过） │
   │   ⇒ upsert [gen1_health_state]               │
   └───────────┬──────────────────────────────────┘
               ▼
   ┌──────────────────────────────────────────────┐
   │ healthStateToGate(state)  :191-220           │
   │   gate_status ∈ {ACTIVE,PENDING,READ_ERROR}  │
   │   allow_canary / allow_advisory              │
   └───────────┬──────────────────────────────────┘
               ├─► rde:769-778  gen1GlobalGate  （权重判据）
               ├─► rde:1653     upsert [runtime_status]（镜像）
               └─► gen1-safety-permission.js:220-284
                        healthAllowsCanary / healthAllowsGuarded
                                │
                                ▼
                   shadow eligibility → canary / downstream gate
```

**★ 断点定位**：状态机在「`manualReviewConfirmed` 的**输入侧**」断裂——`computeLatchedState` 的实现**完整**，但**无任何生产调用方传入 `true`**，故 `recovery_applied` 分支**死代码化**。

---

## §8 C-2 Code Evidence

| 节点 | 文件:行 | 内容 |
|---|---|---|
| F-1 | `gen1-health-state.js:38-40` | `HEALTH_STATE_KEY='gen1-health-state'`；`DOWN_STATES=[DEGRADED, ML_OFF]`；`HEALTH_SOURCE='GEN1_HEALTH_STATE_LATCH'` |
| F-2 | `gen1-health-state.js:54-73` | `defaultHealthState()`（全字段默认值；含 `reviewed_at/reviewed_by/recovery_allowed`） |
| F-3 | `gen1-health-state.js:137-153` | ★ **唯一 release 分支**（`manualReviewConfirmed === true`） |
| F-4 | `gen1-health-state.js:191-220` | `healthStateToGate()`（唯一权限真相入口） |
| F-5 | `gen1-health-state.js:228-256` | `readHealthState()` 三态（FOUND / NOT_INITIALIZED / READ_ERROR，**绝不把异常当 OK**） |
| F-6 | `gen1-health-state.js:262-281` | `writeHealthState()`；`persist_allowed === false ⇒ 不落库` |
| F-7 | `runGen1ShadowEod/index.js:187/192/193` | 唯一 latch 读写点；`:192` **未传 `manualReviewConfirmed`** |
| F-8 | `rde:60/769-778` | `readHealthState` → `healthStateToGate` → `gen1GlobalGate` |
| F-9 | `rde:1653` | `db.upsert(COLLECTIONS.RUNTIME_STATUS, runtimeStatus, { key: 'runtime-status' })` ⇒ 镜像 |
| F-10 | `gen1-circuit-breaker.js:119-133` | `applyHealthWithRecovery(health, manualReviewConfirmed)` —— 进程内 latch 版（**DEPRECATED**，注释明示不用于生产） |
| F-11 | `gen1-circuit-breaker.js:146` | 导出 `applyHealthWithRecovery` —— **全仓无调用方**（仅定义+导出） |
| F-12 | `gen1-health-state.js:23` | 明文：「`ml_shadow_signal.gen1_health_status` 只是审计快照，**不得再拥有实时权限**」 |
| F-13 | `tests/gen1-persistent-health.test.js:51` | 仅**测试**传入 `manualReviewConfirmed: true` |

---

## §9 C-2 Release-Path Inventory（存在 / 不存在，逐项给证据）

| # | 通道 | 结论 | 证据 |
|---|---|---|---|
| R-1 | **latch writer** | **存在**（唯一） | `runGen1ShadowEod:193` → `writeHealthState`；全仓 grep `writeHealthState` 仅此 1 处调用 |
| R-2 | **latch reader** | **存在**（2 处） | `runGen1ShadowEod:187`（latch 合成）；`rde:771`（权限真相） |
| R-3 | **authority layer** | **不存在 release 能力** | `gen1-authority.js` 无 health 字段；`PRODUCTION_LOCKED = true` |
| R-4 | **admin gateway** | **不存在** | `adminGateway:1138` 仅 `GET /api/admin/gen1/health`；`getGen1Health()`（:76-98+）全程 `db.query`，**无 upsert**；线上归档 `:972-973` 同（sha256 `ea8cac727b…`） |
| R-5 | **CLI / admin scripts** | **不存在** | `scripts/gen1-health-aggregator.js` 仅**产出片段**（无 upsert/写）；`gen1-production-gates.js` 仅 parity 检查；`gen1-ui-samples.js:111` **显式禁止 upsert**（`throw new Error('样例脚本为只读，禁止 upsert')`） |
| R-6 | **DB mutation（直写）** | **技术上可达 · 治理上无合法通道** | 集合 `gen1_health_state` 可被任何持写权限者 UPDATE；⛔ 无审计、无 authority 校验 ⇒ **不构成合法 release path** |
| R-7 | **environment / config override** | **不存在** | grep `process.env.GEN1` / `GEN1_HEALTH_OVERRIDE` / `HEALTH_OVERRIDE` / `FORCE_HEALTH` / `BYPASS` in `src/` + `cloudfunctions/` ⇒ **0 命中** |
| R-8 | **startup / recovery path** | **存在但单向** | 仅 `computeLatchedState` 的 `wasDown && nowUp` 分支，且**必须** `manualReviewConfirmed === true`（无传参方 ⇒ 实际不可达） |
| R-9 | **test-only bypass** | **存在但不可用于生产** | `tests/gen1-persistent-health.test.js:51` 传 `manualReviewConfirmed: true`；测试文件**不部署** |
| R-10 | **emergency path** | **不存在** | 全仓无 emergency / force / override 相关 health 入口 |
| R-11 | **historical implementation** | **存在但已废弃** | `gen1-circuit-breaker.js:119` `applyHealthWithRecovery`（进程内 `let _lastHealth` 方案，冷启动归零 ⇒ 已被 `gen1-health-state.js` 持久化 latch 取代）；**无调用方** |
| R-12 | **archived production path** | **不存在** | 线上归档 `adminGateway.index.js` 全文 grep `manualReview|recover` ⇒ **0 命中**（除 `/gen1/health` 只读） |

**★ 结论**：**合法 release path 确认不存在**（R-3…R-12 全部排除；R-1/R-2/R-8 是「写入与状态的机械通路」，但**缺少 release 的输入端**）。

---

## §10 C-2 Minimal Release Contract（**仅设计 · 未实施**）

> ⛔ 本节为**方案文本**，不构成授权，也不意味着已修改任何文件。

### §10.1 九要素

| 要素 | 设计 |
|---|---|
| **WHO can release** | 仅**已认证管理员**（`adminGateway` 现有登录态：`admin_password`/`admin_token`，见 `:42` 注释与 `admin-auth.js`）；⛔ **不接受** API Key 直调、⛔ 不接受无会话调用 |
| **WHEN allowed** | ① 当前 `latched_health ∈ {DEGRADED, ML_OFF}` **且** ② 本轮 `incoming ∈ {OK}`（即 `wasDown && nowUp`）**且** ③ `manual_review_required === true` **且** ④ 距 `degraded_at` ≥ 冷却期（建议复用 `cooldown.js`） |
| **WHAT evidence required** | 请求体必须携带：`reason_code`（枚举）、`root_cause_confirmed`（要求指向具体 `missing_features`/数据缺口）、`evidence_ref`（诊断工件路径或 ID）、`operator`（会话身份）。缺任一 ⇒ 拒绝 |
| **WHERE state stored** | 仍为集合 **`gen1_health_state`** 单文档 `key='gen1-health-state'`（**不新增集合**）；恢复时同时置 `reviewed_at` / `reviewed_by` / `recovery_allowed=true` |
| **HOW authority checked** | 复用既有 `authorityAllows()` 与 `healthStateToGate()`；**不得**绕过 `gen1-authority.js` 的 `PRODUCTION_LOCKED`；恢复动作**不影响** `gen1_authority`（⛔ 不升档） |
| **HOW audit recorded** | 新增**审计行**（建议写入既有操作记录集合，与 TRADE_LOG 同源模式）：`{at, operator, action:'GEN1_HEALTH_RELEASE', from_latched, to_latched, reason_code, evidence_ref, request_id}`。⛔ 禁止"无审计的静默恢复" |
| **HOW replay verifies** | 由 `updated_at` + 审计行 `request_id` 双向对齐；重放应以**只读**方式重算 `computeLatchedState` 并断言"若无 release 则该次仍为 DEGRADED"（反事实不可伪造） |
| **HOW rollback works** | 恢复是**状态写**：rollback = 重新写入恢复前的 `latched_health` + `degraded_at` 快照（须在释放前**先取快照**并留证）。⛔ 无 snapshot 不得释放 |
| **HOW bypass prevented** | ① 端点必须走 `adminGateway` 的**既有鉴权中间件**；② 服务端**强制**重新计算 `wasDown/nowUp`（⛔ 不信任客户端传值）；③ `manualReviewConfirmed` 由**服务端**在通过全部门后置位（⛔ 不从请求体透传）；④ 冷却期防抖；⑤ 审计不可关闭 |

### §10.2 影响面判定（设计阶段）

| 问题 | 回答 |
|---|---|
| 是否需要新的 write route | **是**（`adminGateway` 新增 1 个 **POST** 路由，如 `/api/admin/gen1/health/release`） |
| 是否需要 DB / schema 变化 | **否**（复用 `gen1_health_state`；审计行复用既有集合）—— 若要独立审计集合，则为**新增集合**（需评估） |
| 是否需要 authority contract 变化 | **否**（⛔ 不触碰 `gen1-authority.js`；恢复 ≠ 升档） |
| 是否可以复用现有机制 | **是**（`computeLatchedState` 的 release 分支**已实现**；鉴权/审计/冷却均有既有件） |
| 哪些方案属**过度设计**（应排除） | ⛔ ① 引入独立"health admin service"；② 新增 health 专用 DB 集合（若无审计刚需）；③ 用 env/config 覆写 health；④ 自动恢复定时器（违背 `manualReviewConfirmed` 语义）；⑤ 允许多级/批量释放；⑥ 在 `runGen1ShadowEod` 内部自动置位（会使 fail-closed 失效） |

### §10.3 ⛔ 明确不做

- ⛔ 不在本 Gate 新增路由 / 修改 `adminGateway`（其基线为 `ref-0908`，见 §0）
- ⛔ 不引入自动恢复
- ⛔ 不通过 DB 直写"绕过"实现恢复

---

## §11 Alternatives / Trade-offs

| 方案 | 优点 | 缺点 / 风险 | 授权等级 |
|---|---|---|---|
| **AL-1** 修 `REQUIRED_FEATURES`（C-3 方案 A）+ 按 §10 新增 release 端点（C-2） | 治本（消除假阳性）+ 治标（可释放） | 两处变更；C-2 需部署 `adminGateway`（基线 `ref-0908`） | C-3=R2 · C-2=**R3**（部署） |
| **AL-2** 只做 C-3 方案 A（不建 release 端点） | 只需 1 文件；若假阳性消除后 `incoming=OK` 且 `wasDown=true`，**仍需** `manualReviewConfirmed` 才能离开 latch ⇒ **不足以恢复** | 无法单独解除 latch | R2 |
| **AL-3** 只做 C-2（不修口径） | 可立即恢复 | **治标不治本**：下次遇 `sideway_days=0` 再次降级（latch 抖动）；且掩蔽真实口径缺陷 | R3 |
| **AL-4** 直写 DB 改 latch | 零部署 | ⛔ **无审计、无 authority 校验、不可回放** ⇒ 违反 fail-closed 治理；**排除** | ⛔ 不可接受 |
| **AL-5** 改 `calcSidewayRange` 返回 `0` | 语义"最干净" | ⚠️ **触碰 FROZEN 特征管线锁**，需重签 2 个 manifest | **R3/R4** |

**★ 结论**：C-3 与 C-2 **互补而非替代**；`AL-4` 属被排除方案；`AL-5` 风险最高、收益最低。

---

## §12 Verification Matrix

### C-3

| ID | 验证点 | 判据 | 期望 |
|---|---|---|---|
| V-C3-01 | `REQUIRED_FEATURES` 变更后可机验 | 新常量与实现一致 | PASS/FAIL |
| V-C3-02 | `sideway_days=0` 时 `evaluateDataHealth` 不再返回 `DEGRADED` | 单测：`features.sideway_range=null, sideway_days=0` ⇒ `DATA_OK` | PASS/FAIL |
| V-C3-03 | 真缺失仍 fail-closed | 移除 `rs_20d` ⇒ 仍 `DATA_BLOCKED/BENCHMARK_MISSING` | PASS/FAIL |
| V-C3-04 | `runGen1ShadowEod:270` 复用处不回归 | `data_health[]` 数组 status 语义不变（除目标项） | PASS/FAIL |
| V-C3-05 | **不触碰 FROZEN** | `feature_pipeline_hash` 前后相等（`8efdda6f…`） | PASS/FAIL |
| V-C3-06 | 冻结锁文件未改 | 4 个 role sha256 逐位相等 | PASS/FAIL |

### C-2

| ID | 验证点 | 判据 | 期望 |
|---|---|---|---|
| V-C2-01 | 端点需鉴权 | 无会话 ⇒ 401/403 | PASS/FAIL |
| V-C2-02 | 服务端强制重算 | 客户端伪造 `wasDown/nowUp` ⇒ 被拒 | PASS/FAIL |
| V-C2-03 | `manualReviewConfirmed` 不透传 | 请求体含该键 ⇒ 被忽略/拒绝 | PASS/FAIL |
| V-C2-04 | 冷却期生效 | 冷却期内重复请求 ⇒ 被拒 | PASS/FAIL |
| V-C2-05 | 审计行写入 | 每次成功 release ⇒ 恰 1 行含 `request_id` | PASS/FAIL |
| V-C2-06 | 快照先行 | 无 snapshot 的 release ⇒ 被拒 | PASS/FAIL |
| V-C2-07 | 不升 authority | release 前后 `gen1_authority` 相等 | PASS/FAIL |
| V-C2-08 | rollback 可执行 | 按快照回写后 `latched_health` 复原 | PASS/FAIL |
| V-C2-09 | 未初始化态不误放行 | `read_status=NOT_INITIALIZED` ⇒ 拒绝 release | PASS/FAIL |
| V-C2-10 | READ_ERROR 态不误放行 | `read_status=READ_ERROR` ⇒ 拒绝 release | PASS/FAIL |

---

## §13 Rollback Plan

| 对象 | rollback 方式 | 前置 |
|---|---|---|
| C-3（若为方案 A） | 恢复 `gen1-data-health.js` 至改动前 sha256；**无 DB 回滚需求**（纯函数） | 改动前留存 sha256 |
| C-2（若实施 release 端点） | ① **先取 `gen1_health_state` 快照**；② 回滚 `adminGateway` 至线上现版（`ea8cac727b…` @ `ref-0908`）；③ 如已 release，按快照回写 `latched_health`/`degraded_at` | 快照 + 回滚包对 `codeSha256` |

⚠️ **纪律**：任何 release 动作**必须先落快照**；⛔ **无快照不得恢复**。

---

## §14 Production Write Boundary

| 对象 | 本 Gate | 实施时（授权后） |
|---|---|---|
| production code | ⛔ 0 修改 | C-3：`gen1-data-health.js`（1 文件）；C-2：`adminGateway/index.js`（1 文件，基线 `ref-0908`） |
| production config | ⛔ 0 修改 | 无需变更 |
| production DB | ⛔ 0 写 | C-2 恢复动作 = **受控单文档写**（`gen1_health_state`）+ 1 条审计行 |
| `ml/manifests/**`（FROZEN） | ⛔ 0 修改 | C-3 方案 A 亦**不得**修改；仅方案 B（已排除）会触及 |
| authority / FROZEN_PARAM_KEYS / immutable_set | ⛔ 0 修改 | ⛔ 全程不得修改 |
| selector / active pointer / read path | ⛔ 0 修改 | ⛔ 本 Gate 无关，不得触碰 |
| deploy / push / merge / tag | ⛔ NO | 须**独立**部署授权（含逐函数基线选择，见 §0） |

**★ 首次写入口径（沿用上一 Gate 结论）**：C-3 = **0 写**；C-1 = 首次**数据写**（latch）；C-2 = 首次 **deploy**。⛔ 三者不可混淆。

---

## §15 Evidence Plan

| ID | 需捕获 | 来源 | 用途 |
|---|---|---|---|
| E-C3-01 | `ml_shadow_signal` 中 `missing_features` 全量（含 515880/159582） | `online-db` 只读 | 证明"已落库"与根因 |
| E-C3-02 | `indicators.js` / `gen1-data-health.js` 的 sha256 与 `FEATURE_PIPELINE_LOCK` 逐位对拍 | 源码 + manifest | 证明冻结面边界 |
| E-C3-03 | `evaluateDataHealth` 在 `sideway_range=null` 下的输入输出样本 | 本地纯函数运行（离线） | 复现假阳性 |
| E-C3-04 | 变更前后 `feature_pipeline_hash` | manifest | 证明未触冻 |
| E-C2-01 | `gen1_health_state` 单例快照（含 `degraded_at/reviewed_*`） | `online-db` 只读 | 证明 latch 状态与"从未复核" |
| E-C2-02 | `manualReviewConfirmed` 全仓调用方清单（含 file:line） | AST/文本扫描 | 证明 CALLER=0 |
| E-C2-03 | `adminGateway` 路由全表（含只读性） | 源码扫描 | 证明无恢复端点 |
| E-C2-04 | 释放前/后快照对（如实施） | `online-db` 只读 | 回滚与回放 |

⚠️ ⛔ 所有 evidence 捕获**只读**；⛔ 不得为取证而写 DB / 部署 / 触发函数。

---

## §16 Remaining Blockers

| # | 阻塞 | 说明 |
|---|---|---|
| B-1 | **部署源身份不一致（★ 新增）** | 线上 = 混合部署；`adminGateway`/`apiGateway` 基线为 `ref-0908`，`rde`/`shadowEod` 为 `_v365-frozen-baseline`；⛔ 载体树（V3.6.1）不可作部署源。**实施前必须逐函数定基线并取得部署授权** |
| B-2 | **C-3 口径修正的授权未定** | 方案 A 属 R2；⛔ 未授权 |
| B-3 | **C-2 release 端点的部署授权未定** | 属 R3（新增写路由 + 部署）；⛔ 未授权 |
| B-4 | **C-1 的"数据可恢复性"未验证** | 若 `sideway_range` 假阳性消除后 `incoming=OK`，latch 仍需人工释放（C-2）才能离开 `DEGRADED` |
| B-5 | **审计载体未定** | release 审计行写既有集合 or 独立集合，需 owner 裁定 |
| B-6 | **`F-5`/`F-6`（harness）** | 本 Gate ⛔ 不改 `v6_negative_scan.py`；保留为后续独立 harness engineering work item |
| B-7 | **`X-2` 阶段前置** | ⛔ 非工作项；不因本 Gate 而改变 |

---

## §17 Owner Decision Required

| # | 待裁事项 | 选项 |
|---|---|---|
| D-1 | C-3 方案选择 | **A**（口径修正 · R2）/ **C**（仅登记 · 不推进）/ **B**（改 `indicators.js` · 触碰 FROZEN · R3-R4） |
| D-2 | C-2 是否推进最小 release contract 设计 | 是（进入**实施授权**流程）/ 否（保持 STOP）/ 先补审计载体裁定 |
| D-3 | 审计载体 | 复用既有操作记录集合 / 新建独立集合 |
| D-4 | `adminGateway` 基线确认 | 采用线上对齐源 `_v365-audit-20260930/ref-0908`（✅ 推荐） |
| D-5 | 是否允许进入实施 | ⛔ 须 owner 明示 `AGENT IMPLEMENTATION AUTHORIZED` |

---

## §18 关键路径保持声明

本件**不调整**冻结关键路径，逐字保持：

```text
C-3 ∥ C-2
 → C-1
 → C-4
 → X-2 PRECONDITION
 → A-1
 → D-1
 → D-2
 → D-3
 → X-1
 → B-1
 → G-1
 → G-2
 → A-2a
 → A-2b
 → G17
 → E-5
```

两条已裁定事项**原样保留**：

1. `X-1` **必须在 `A-1` 之后** —— `authority_canary` 用严格相等 `==='CANARY'`（`gen1-shadow-eligibility.js:103`）⇒ 升档即 shadow qualification 清零。
2. `B-1` **必须先于 `A-2b`** —— ⛔ 不得恢复原主件 §13 与 §6.2 的矛盾顺序。

---

## §19 边界与 STOP

**本 Gate 实测零动作**：`PRODUCTION_WRITE = 0` · `DB_WRITE = 0` · `DEPLOY = NO` · `AUTHORITY_CHANGE = NO` · `CANARY = OFF` · `EVIDENCE_EXECUTION = NO` · `GE04 = NO`

**⛔ 明确声明**：
- 本件所有"最小方案"均为**设计文本**，⛔ **不构成实施授权**；
- "能实现" ≠ "已授权实现"；
- ⛔ 未修改任何 production code / config / DB / manifest / authority / selector / pointer / read path；
- ⛔ 未改既有闸门（含 `v6_negative_scan.py`）。

```text
C3_PREFLIGHT      = COMPLETE
C2_PREFLIGHT      = COMPLETE
NEW_CODE          = 0
PRODUCTION_WRITE  = 0
DB_WRITE          = 0
DEPLOY            = NO
AUTHORITY_CHANGE  = NO
CANARY            = OFF
EVIDENCE_EXECUTION= NO
GE04              = NO
IMPLEMENTATION_AUTHORIZED   = NO
PRODUCTION_WRITE_AUTHORIZED = NO
STOP              = YES
```
