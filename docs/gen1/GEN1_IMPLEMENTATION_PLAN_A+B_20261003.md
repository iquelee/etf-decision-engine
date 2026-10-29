# Gen-1 —— IMPLEMENTATION PLAN（`C3-R2` + `C-2` `A+B` · ★ planning only · ⛔ 零实施）

> 生成时间：**2026-10-03**（GMT+8）· 轮次：`FINAL OWNER DECISION GATE`（planning 授权件）
> 上游：`docs/gen1/GEN1_FINAL_OWNER_DECISION_20261003.md`（本批同轮）· `docs/gen1/GEN1_LOCK_AUTHORITY_GATE_20261003.md`（`6d71385`）· `docs/gen1/GEN1_OWNER_DECISION_GATE_20261003.md`（`8e9a159`）
> 性质：**实施计划文本**。⛔ 本件**不修改**任何 production 代码 / DB / lock / manifest / authority / 配置。
> ⛔ **核心声明**：`PLAN ≠ AUTHORIZATION`。本件每一节都以「★ 设计 · ⛔ 未实施」标注，⛔ 不得作为 implementation 依据。

---

## §0 方法与边界

| 项 | 内容 |
|---|---|
| 输入授权 | `C3_R2_IMPLEMENTATION_PLANNING = AUTHORIZED` · `C2_OWNER_SELECTION = A+B` |
| 未获授权 | `C3_R2_IMPLEMENTATION = NOT_YET_AUTHORIZED` · `IMPLEMENTATION_AUTHORIZED = NO` |
| 证据等级 | `worktree-read`（源码实读）· `runtime-static`（G1-B 实跑）· `governance-artifact`（锁 / 台账 / 前件裁定） |
| ⛔ 纪律 | 所有「行号」均为**落笔时快照**；⛔ 不得作为变更后的行号期望；实施时必须重新定位（AST / 锚点） |

**★ 前置依赖（逐项 · ⛔ 任一未完成即不得进入实现）**

| # | 前置 | 状态 |
|---|---|---|
| `PRE-1` | `LC-C` 双层语义 + closure 规则**成文** | ⛔ 未落盘（本批仅 planning 文本） |
| `PRE-2` | `gen1-data-health.js` 纳入 binding / approval 闭环（三步） | ⛔ 未执行 |
| `PRE-3` | `GOV-GAP-LOCK-APPROVAL` 裁定（锁是否补审批载体） | ⛔ 未裁定 |
| `PRE-4` | `P5` 二元前置（master 5 个 commit 裁定）+ 包级 parity | ⛔ 未完成 |
| `PRE-5` | 旧文档 `RETRACTED` 指针落地 | ⛔ 未执行 |

---

## §1 `C3-R2` 精确 implementation plan

> ★ 设计 · ⛔ 未实施。**唯一生产写入面 = `src/common/utils/gen1-data-health.js`**。

### §1.1 文件清单

| # | 文件 | 角色 | 是否属「唯一生产写入面」 |
|---|---|---|---|
| 1 | `src/common/utils/gen1-data-health.js` | 分类口径修正的**唯一**落点 | ✅ **是** |
| 2 | `docs/gen1/GEN1_C3_C2_ARCHITECTURE_DECISION_20261003.md` | 范围细化（⛔ **追加**，⛔ 不回改） | ⛔ 否（文档） |
| 3 | `docs/gen1/GEN1_PRE_LAUNCH_INVENTORY_ERRATA_20261003.md` | 追加 `ERRATA-2`（勘误指针） | ⛔ 否（文档） |
| 4 | `docs/production-deployment-ledger.md` | 若 R2 触发新部署 ⇒ 按 `P3` 追加 `D-xxx` | ⛔ 否（文档） |

**⛔ 明确不动的文件（10 类 · 沿用上游 §1.4）**：`indicators.js` · `trend-stage.js` · `cloudfunctions/runGen1ShadowEod/index.js` · `runGen1ShadowEod/frozen-manifest.json` · `gen1-circuit-breaker.js` · `gen1-health-state.js` · `gen1-safety-permission.js` · `cloudfunctions/adminGateway/index.js`（R2 不碰） · `ml/manifests/**`（除 `LC-C` 落地时的锁文件，且属独立轨） · `src/common/constants.js` / 任何 lock / authority / DB schema。

### §1.2 行级 owner（落笔快照 · ⛔ 非变更后期望）

| 行 | 现状 | 目标 | 变更类型 | owner |
|---|---|---|---|---|
| `L34-39` | `REQUIRED_FEATURES` = **15 项单一集合** | 拆为 `HARD_REQUIRED`（真必填） + `SEMANTICALLY_NULLABLE`（语义可空，含 `sideway_range`）；★ **保留 `REQUIRED_FEATURES` 为二者并集**（向后兼容：`tests/gen1-data-health.test.js:5` 以它构造 `full`） | 常量拆分 + 别名 | R2 |
| `L41-43` | `isNullish()` | ⛔ **不变** | — | — |
| `L60` | `const required = src.requiredFeatures \|\| REQUIRED_FEATURES;` | 增 `hardRequired` 解析（`src.hardRequiredFeatures \|\| HARD_REQUIRED`） | 新增解析 | R2 |
| `L66` | `absent = required.filter(...)` | 改按 **`hardRequired`** 取基数（★ 见 §1.11 判据 2） | 基数改域 | R2 |
| `L67` | `nullish = required.filter(... && isNullish)` | 改按 **`hardRequired`** 取基数（★ 见 §1.11 判据 1） | 基数改域 | R2 |
| `L111` | `if (nullish.includes('rs_20d'))` | ⛔ **不动**（`rs_20d` 属 `HARD_REQUIRED`，仍在环节 ⑤ 短路） | — | — |
| `L117-120` | 第 ⑥ 步 `if (nullish.length > 0) return DATA_DEGRADED / STATISTICAL_MISSING` | 改为**对 `hardRequired` 的 `nullish` 取基数**（★ 见 §1.11 判据 1） | 判据改域 | R2 |
| `L122-123` | `全部 ${required.length} 个必需特征可用` | 措辞改 `hardRequired.length`（★ 文案随口径，⛔ 不改返回值语义） | 文案 | R2 |
| `L1-20` | 模块头注释（**自述即规格**） | 同步登记两组语义 + 「语义可空 ≠ pipeline missing」 | 注释 | R2 |
| — | `src/common/schema.js`（对应字段注释） | ⛔ 可选（若口径措辞需对齐）—— ⛔ **不打** schema 结构变更 | 仅注释 | ⚠️ 需显式确认 |

### §1.3 schema effect

```text
SCHEMA_STRUCTURE_CHANGE   = NONE
SCHEMA_FIELD_CHANGE       = NONE
SCHEMA_COMMENT_CHANGE     = OPTIONAL_ONLY
```

| 项 | 说明 |
|---|---|
| 字段存在性 / 类型 | ⛔ **零变更**：`ml_shadow_signal.missing_features`（数组）与 `runtime_status.gen1_health_read_reason_code`（string）均**不动** |
| 语义 | `missing_features` 的**口径收窄**（仅硬必填），⛔ 不是字段契约变更 |
| ⛔ 禁止 | ⛔ 不新增集合、⛔ 不新增字段、⛔ 不改索引、⛔ 不改 `GEN1_HEALTH_STATE` 文档结构 |

### §1.4 lock effect（依 `LC-C`）

```text
LOCK_UPDATE_REQUIRED      = YES
LOCK_CLOSURE_DELTA        = ONE_FILE
LOCK_RULE_LAYER_CHANGE    = NO
LOCK_FILES_LAYER_CHANGE   = YES
LOCK_APPROVAL_CARRIER     = MISSING
```

（上表含义：依 `LC-C`，R2 ∈ `rule` 第 8 域「数据健康」⇒ **受管变更**；`LOCK_CLOSURE_DELTA` 恰为 `src/common/utils/gen1-data-health.js` 一个文件；`LOCK_RULE_LAYER_CHANGE = NO` 因「数据健康」已在 9 域内，⛔ 无需新增域声明；`LOCK_APPROVAL_CARRIER = MISSING` ⇒ 须立 `GOV-GAP-LOCK-APPROVAL`。）

**最小变更面 = 4 文件**（少一个即不成立）：

| # | 文件 | 变更 | 不改的后果 |
|---|---|---|---|
| 1 | `ml/manifests/GEN1_FEATURE_PIPELINE_LOCK.json` | `files[]` 追加 `{ role: "data_health", path: "src/common/utils/gen1-data-health.js", sha256: <LF-normalized> }` | 锁不覆盖该文件（closure 差集非空） |
| 2 | `scripts/gen-gen1-pipeline-lock.js` | `PIPELINE_FILES` 追加同一项；★ 头注释 **7 域 → 与 `rule` 9 域对齐**（否则上游 `N-3` 矛盾不消除） | **下次重生成会丢项** |
| 3 | `scripts/verify-gen1-pipeline.js` | `ROOT_ANCHOR_PIPELINE_LOCK` 更新为新锁 sha | G1-B ①项 FAIL |
| 4 | `ml/manifests/GEN1_RUNTIME_BUNDLE.json` | 重生成；`feature_pipeline_hash` 变为新值 | G1-B ④项 FAIL |

**G1-B 项数影响**：**10 → 11 项**（+1 = `gen1-data-health.js` 绑定）；★ ①root anchor 与 ④bundle hash **值变更**（⛔ 项数不变）。
**辅助面**：`tests/v361-safety-hardening.test.js` 仅校验 `trend_stage_implementation` 绑定 ⇒ ⛔ **无需改动**。

### §1.5 baseline effect

| 基线对象 | 是否变化 | 依据 |
|---|---|---|
| **pipeline baseline** | ✅ **是**（新 `feature_pipeline_hash`） | `GEN1_RUNTIME_BUNDLE.feature_pipeline_hash` |
| 模型冻结（`model_id` / `model_sha256`） | ⛔ 否 | 锁不含模型 |
| schema 冻结（`feature_schema_sha256`） | ⛔ 否 | `frozen-manifest.json` 不变 |
| 阈值（`threshold_signal_p` / `threshold_version`） | ⛔ 否 | 锁 `derived` 不变 |

⇒ **baseline 身份 = 「新一代 pipeline 基线」**（⛔ 不是新模型基线、⛔ 不是新阈值基线）。

### §1.6 downstream effect

| 节点 | 影响 | 性质 | 依据 |
|---|---|---|---|
| `C-1` | ✅ **直接**（R2 是 C-1 的已识别前置） | `DATA_DEGRADED` → `computeHealthStatus`（`gen1-circuit-breaker.js:62`）= `DEGRADED` → `circuitGate` 关 `allow_canary` | 上游 §1.8 |
| `C-4` | ✅ **间接**（`R2 → C-1 → C-4`） | 依赖计划：`C-4` 前置 = `C-1` | 依赖计划 `:169` |
| `X-2` | ⛔ **无交集** | X-2 落点在 `gen1-safety-permission.js`（阶段门）；R2 不触阶段计算 | 上游 §1.5 |
| `A-1` / `D-1…D-3` / `X-1` / `B-1` / `G-1…G-2` / `A-2a…A-2b` / `G17` / `E-5` | ⛔ **无直接作用**（受 Critical Path 顺序约束） | — | 本件 §6 |

⚠️ **不得过度归因（★ 逐字沿用上游禁令）**：C-1 的 latch 自 `09-21` 起 `DEGRADED`，其**历史成因未证明**（窗口归属不可判定）。R2 **只主张**消除「`sideway_range` 语义空值 ⇒ 假阳性降级」这一**已实测**贡献项，⛔ **不主张**它是唯一成因，⛔ **不主张** R2 完成即 `C-1` 可达。

### §1.7 test effect

| # | 用例 | 判据 | 目的 |
|---|---|---|---|
| `T-1` | 存量 `tests/gen1-data-health.test.js` 全部用例 | 全绿（★ 注意 `:5` 以 `REQUIRED_FEATURES` 构造 `full` ⇒ 别名必须保留） | 无回归 |
| `T-2` | **新增**：`sideway_days = 0` ⇒ `sideway_range = null` | 期望 **不是** `DATA_DEGRADED / STATISTICAL_MISSING` | 直接验证修正目标 |
| `T-3` | **反向**：`atr20 = null`（硬必填、列存在） | ⛔ **必须仍为** `DATA_DEGRADED / STATISTICAL_MISSING` | ★ 防「一刀切放宽」（缺即视为修正过宽） |
| `T-4` | 反向：`absent`（`atr20` 列未生成） | ⛔ **必须仍为** `DATA_BLOCKED / PIPELINE_MISSING` | 防误伤管线故障语义 |
| `T-5` | 反向：`rs_20d = null` | ⛔ **必须仍为** `DATA_BLOCKED / BENCHMARK_MISSING` | 环节 ⑤ 不受影响 |
| `T-6` | 反向：`SEMANTICALLY_NULLABLE` 字段值 `null` 且**列不存在** | 期望 `DATA_BLOCKED / PIPELINE_MISSING`（★ 与 T-2 的差别在于**列是否存在**，⛔ 不是值） | 明确「语义可空」只豁免**值缺失**，不豁免**列缺失** |

### §1.8 rollback

| 项 | 内容 |
|---|---|
| 变更性质 | **纯代码 / 规格**：⛔ 无 DB 写、⛔ 无配置写、⛔ 无 authority 变更、⛔ 无新集合 |
| rollback 形态 | 还原 `src/common/utils/gen1-data-health.js` 至前一 commit（**单文件还原**，无伴随状态） |
| 数据回滚 | ⛔ **不需要**（R2 ⛔ 不改历史行） |
| 若已伴随 lock 更新 | lock 4 文件同时还原（⛔ 顺序：先还原代码，再还原 lock/bundle，避免中间态被 G1-B 误判） |
| ⚠️ 边界 | 「新行与历史行**不同代**」⇒ 跨代统计必须**显式声明口径**，⛔ 不得混算 |

### §1.9 migration

```text
DATA_MIGRATION        = NONE
HISTORICAL_ROW_REWRITE = NO
```

| 项 | 内容 |
|---|---|
| 存量 `ml_shadow_signal` 行 | ⛔ **不重写**：旧行 `missing_features` 保留原口径值 |
| 新写入行 | 采用新口径（仅硬必填） |
| ⚠️ 跨代 | 任何按 `missing_features` 统计的查询必须带时间/口径切分 |

### §1.10 evidence（最小验证集 · ★ 设计）

| # | 证据 | 判据 | ⛔ 禁止 |
|---|---|---|---|
| `E-1` | 单测（`T-1…T-6`） | 全绿 | — |
| `E-2` | 515880 复算（用**现有 fixture**） | `missing_features` 期望不含 `sideway_range` | ⛔ 不读生产 DB |
| `E-3` | `scripts/verify-gen1-pipeline.js`（G1-B）实跑 | **11/11**（若含 lock 更新） | ⛔ 不部署 |
| `E-4` | 回归白名单（`v6_*` 显式白名单） | 全绿（含本件 checker） | ⛔ 禁通配 |
| `E-5` | 零写自证 | `changed_or_missing = NONE` | — |

⛔ **证据纪律（沿用 GE-03）**：⛔ 不得以 shadow / replay **计数**作 Evidence 源；⛔ 不得为了验证而执行 release。

### §1.11 四项必须验证的判据（Owner 逐字 → 精确化）

| # | Owner 判据 | 精确化（实现必须满足） | 对应用例 |
|---|---|---|---|
| 1 | `HARD_REQUIRED missing → DEGRADED` | 「**列存在、值 `null`/`NaN`**」⇒ `DATA_DEGRADED / STATISTICAL_MISSING` | `T-3` |
| 2 | `absent → PIPELINE_MISSING` | 「**列未生成（key 不存在）**」⇒ `DATA_BLOCKED / PIPELINE_MISSING` | `T-4` / `T-6` |
| 3 | `rs_20d → BENCHMARK_MISSING` | `rs_20d` 值缺失 ⇒ `DATA_BLOCKED / BENCHMARK_MISSING`（环节 ⑤ 短路，**先于**环节 ⑥） | `T-5` |
| 4 | `SEMANTICALLY_NULLABLE null → 不得被误判为 pipeline missing` | 语义可空字段值 `null`（列存在）⇒ **既不** `PIPELINE_MISSING` **也不** `STATISTICAL_MISSING` ⇒ `DATA_OK` | `T-2` |

> ★ **判据 1 与判据 4 的张力（本计划的核心设计点）**：二者只在「**值缺失**」维度上分离 —— 判据 1 说「硬必填的值缺失 ⇒ 降级」，判据 4 说「可空字段的值缺失 ⇒ 不降级」。⇒ 因此**必须**把 `nullish` 基数从 15 项收窄到 `HARD_REQUIRED`，⛔ 不能只改 `absent`。反过来说：`absent` 基数也必须收窄，否则 `T-6`（可空字段列缺失）会走不到 `PIPELINE_MISSING`。

---

## §2 `C-2` `A+B` 精确 implementation plan（Owner 指定 12 问）

> ★ 设计 · ⛔ 未实施。⛔ 本件不新增路由、不新增 handler、不改 `adminGateway`。

**方案定义（逐字沿用）**：

```text
A = 现有 timer 保持自动检测 / 状态写入（runGen1ShadowEod → computeLatchedState）
B = 新增最小 admin release route
A+B = A + B
```

### §2.Q1 新 route 的完整 authority boundary

| 边界层 | 内容 | 现状 |
|---|---|---|
| **入口** | `POST /api/admin/gen1/health/release`（★ 命名参照既有 `/api/admin/gen1/health` 的 GET-only 形态；⛔ **不改**其 GET 语义） | 不存在 |
| **路径级鉴权** | 现有：`if (path.startsWith('/api/admin/')) { verifyToken(getAdminToken(event)) }`（`cloudfunctions/adminGateway/index.js:1087-1090`）⇒ 新路由**自动**落入该分支 | ✅ 已存在 |
| **方法约束** | 现有 `POST_ONLY` 集合（`index.js:1055+`）⇒ 新 path 必须**加入**该集合 | 需改（1 行） |
| **服务端 authority 判定** | handler 内 `require('../../common/utils/gen1-authority')` → `resolveAuthority(params)` → 判定**当前** authority；★ 关键：**恢复 ≠ 升档** ⇒ 本 route **既不请求、也不改变** `gen1_authority` | 需新增（handler 内） |
| **冻结隔离** | ⛔ 本 route **不写** `param_config` ⇒ ⛔ 不触 `FROZEN_PARAM_KEYS`（`updateParam` 的冻结拒写链路 ⛔ 不经过） | 设计约束 |
| **集合边界** | 只读写既有 `GEN1_HEALTH_STATE`（`'gen1_health_state'`，`constants.js:33`） ⇒ ⛔ **零新集合** | ✅ |
| **⛔ 越界禁令** | ⛔ 不写 `final_target` / ⛔ 不写 `portfolio_snapshot` / ⛔ 不写 `decision_result` / ⛔ 不动 `active_run_pointer` / ⛔ 不动 `gen1_authority` | 设计约束 |

### §2.Q2 actor 来源

| 项 | 内容 |
|---|---|
| 可复用 | `verifyToken()`（`index.js:400-411`）：比对 `param_config.admin_token` 值 + 24h TTL ⇒ 「**持有有效会话者**」 |
| ⚠️ **缺口（本轮实测）** | 鉴权体系为**单一共享口令**（`param_config.admin_password`）⇒ ⛔ **无用户名、无角色、无自然人身份字段** |
| ⇒ 设计 | `actor` = **会话 token 存在性** ∧ **调用方显式声明的 operator 标识**（`X-Admin-Actor`，⛔ 无默认值）；审计中**如实标注**该声明的置信等级为「**声明式（未经强身份验证）**」 |
| ⇒ 登记 | `GOV-GAP-ACTOR`（见 §3.3）—— ⛔ 独立缺口，⛔ 不阻塞 `A+B` 选型，⛔ 不得作为实施前置 |

### §2.Q3 approval 来源

| 项 | 内容 |
|---|---|
| ⛔ 禁止 | ⛔ **不接受**请求体 / 查询参数透传「人工已确认」语义（如 `manualReviewConfirmed`） |
| ✅ 形态 | 服务端**重算**四项前置后**自行**作出 approval 判定：① `latched_health ∈ {DEGRADED, ML_OFF}` ② 服务端重算 `incoming ∉ DOWN` ③ `manual_review_required === true` ④ 冷却期已过 |
| 载体 | 审批动作 = **PR 显式修改 + 服务端判定**（参照本仓成文范式 `GEN1_GUARDED_EFFECTIVE_FREEZE.change_rule`「PR 显式修改 = 等同显式审批动作」）⇒ ⛔ 本 route 本身不实现「审批 UI」，只实现「审批前置校验」 |

### §2.Q4 audit 8 字段

| # | 字段 | 来源（服务端置位） | 现状 |
|---|---|---|---|
| 1 | `actor` | 会话身份 + 声明的 operator（见 Q2） | ⚠️ 部分（`reviewed_by` 已存在，需复记） |
| 2 | `timestamp` | 服务端 `now` ISO | ✅ `reviewed_at`（★ `updated_at` ⛔ **不算**审计） |
| 3 | `previous_state` | 释放前**快照**的 `latched_health` | ⛔ 无（需新增） |
| 4 | `new_state` | 释放后的 `latched_health`（= `incoming`） | ⛔ 无 |
| 5 | `reason` | **枚举** `reason_code`（服务端校验取值域） | ⛔ 无 |
| 6 | `evidence_reference` | 引用 id（如 snapshot id / 复算输入摘要） | ⛔ 无 |
| 7 | `authority_decision` | `authorityAllows()` 的**判定结果本身** | ⛔ 无 |
| 8 | `correlation/request id` | 请求级 id（服务端生成） | ⛔ 无 |

**落点（`AUDIT_CARRIER_LOCUS`）**：`docs/gen1/artifacts/**`（git-tracked，append-only JSON + sha256 绑定）+ `gen1_health_state.reviewed_at / reviewed_by`。
⚠️ ★ **运行时不能写 git** ⇒ `A+B` **必须追加一条只读导出步骤**（DB 审计记录 → `docs/gen1/artifacts/**`），见 Q7/Q12。⛔ 该导出步骤不得由 release 运行时自动执行。

### §2.Q5 release state machine

| 项 | 内容 |
|---|---|
| 前置态 | `latched_health ∈ {DEGRADED, ML_OFF}` |
| 唯一迁移 | **分支①**（释放）：`latched_health := incoming`（`incoming ∈ {OK, WARNING}`） |
| 副作用（逐项） | `manual_review_required := false` · `degraded_at := null` · `ml_off_at := null` · `recovery_allowed = true` · `reviewed_at := now` · `reviewed_by := actor` |
| 状态机实现 | 复用既有 `computeLatchedState(prevState, incomingHealth, { manualReviewConfirmed: true, reviewedBy, now })`（`gen1-health-state.js:96-181`）—— ⚠️ 本 route **只改调用来源**（从 timer 的 `false` 改为 route 的 `true`），⛔ **不改**函数本身 |
| ⛔ 值域 | `HEALTH = { OK, WARNING, DEGRADED, ML_OFF }`（`gen1-circuit-breaker.js:19`）· `HEALTH_RANK`（`:21`）⇒ ⛔ **不引入不存在的 `HEALTHY`** |
| ⛔ 其他分支 | ⛔ 不得触「分支②（仍下行，保持 latch）」「分支③（上行，取更差）」「分支④（常规）」的语义变更 |

### §2.Q6 recovery ≠ promotion

| 项 | 内容 |
|---|---|
| 语义 | 「**恢复健康闩锁**」≠「**升 authority 档**」 |
| 具体要求 | `gen1_authority` **保持 `CANARY`**；⛔ 本 route ⛔ 不调 `resolveAuthority` 的写入路径、⛔ 不写 `param_config.gen1_authority` |
| 依据 | `gen1-authority.js` 头注释逐字：「GUARDED_EFFECTIVE 的准确语义 = Gen-1 获得『向 V3.6.1 提议受控阶段输入』的**资格** ≠ Gen-1 获得生产写权限」⇒ 档位与健康是**两条独立轴** |
| ⛔ 硬边界（不变量） | `production_write === false` 恒真 · `auto_execution === false` 恒真（`gen1-authority.js:144-146`） |

### §2.Q7 replay

| 项 | 内容 |
|---|---|
| 机制 | 服务端**重算** `computeLatchedState(prevSnapshot, incoming)` ⇒ 与写入值逐字段比对 |
| **反事实断言** | 若把 `manualReviewConfirmed` 置回 `false` ⇒ 结果**必须仍为** `DEGRADED`（证明「release 确由该确认触发」） |
| 输入固化 | 必须同时落盘**复算输入快照**（`prev` 关键字段 + `incoming` + `now`）⇒ 否则 replay 依赖自律 |
| ⛔ 禁止 | ⛔ 不得用 shadow / replay 计数当 replay 证据（GE-03） |

### §2.Q8 rollback

| 项 | 内容 |
|---|---|
| ★ 前置 | **释放前必须先取快照**（`latched_health` / `manual_review_required` / `degraded_at` / `ml_off_at` / `current_health` / `reviewed_at` / `reviewed_by`） |
| ⛔ 硬约束 | ★ **无 snapshot 不得释放**（服务端强制：快照写失败 ⇒ 直接拒绝 release） |
| rollback 形态 | 用快照**回写** `GEN1_HEALTH_STATE`（服务端置位） + 审计一条 `action = ROLLBACK` |
| ⛔ 边界 | ⛔ rollback **不**改变 authority、⛔ 不写 `final_target` |

### §2.Q9 anti-bypass

| 层 | 手段 | 强度 |
|---|---|---|
| 路由层 | 路径级 `verifyToken` + `POST_ONLY` + 服务端重算 + 服务端置位 + 冷却期 + **审计不可关闭**（⛔ 无「跳过审计」开关、⛔ 无 `--force` 类语义） | ★ **最强** |
| 服务端不变量 | `gen1-authority.js` 的 `PRODUCTION_LOCKED = true` + `authorityAllows('PRODUCTION_WRITE')` 恒 `false` | ✅ 结构性 |
| ⚠️ 环境层 | ⛔ **不设防**：任何持有同一 CloudBase 凭据者可用 SDK **直写** `gen1_health_state`（绕过路由与鉴权） | ⛔ **不可达**（见 Q11） |

### §2.Q10 `P5` 如何成为 hard precondition

| 步骤 | 内容 |
|---|---|
| 依赖 | `A+B` 需改 `cloudfunctions/adminGateway/index.js` ⇒ 必须回答「从哪个 lineage 分叉」 |
| 裁定 | `ADMIN_GATEWAY_ALIGNMENT_ANCHOR = 8fc3ba66`（内容锚；LF 归一 sha256 = `ea8cac72…c374` ≡ 线上） |
| 实现形态 | 以 master 为仓库基线 + 把 `adminGateway/index.js` **单文件还原**为线上内容作**起点提交** ⇒ 使「交付包内 `adminGateway` 与线上 diff = 0」，新增 release 路由成为**唯一差异** |
| ★ 前置 A | master 上 5 个 commit（`f8c146b` / `cc52b7e` / `37b7241` / `0791459` / `19100fc`；997 → 1134 行）必须二元裁定 |
| ★ 前置 B | 包级 parity 复核（`P3` 门槛） |
| ⇒ 硬性 | ⛔ 前置未完成 ⇒ ⛔ 不得建分支、⛔ 不得还原文件、⛔ 不得新增路由 |

### §2.Q11 如何避免 SDK / 脚本绕过

> ★ **诚实结论（⛔ 不夸大能力）**：在**当前架构**下，`A+B` 只能做到**路由层最强**，⛔ **无法**在环境层结构性阻止 SDK 直写（同一 CloudBase 凭据即同一信任域）。

| 手段 | 是否可做到 | 说明 |
|---|---|---|
| 路由层强制 | ✅ | 见 Q9 |
| 冻结拒写链路 | ✅（但不适用） | `updateParam` 的 `FROZEN_PARAM_KEYS` 拒写只覆盖 `param_config`；release 写 `gen1_health_state` ⇒ ⛔ 无对应冻结机制 |
| 环境层拦截 SDK 直写 | ⛔ **做不到** | 需 CloudBase 侧权限分离 / 独立服务身份，属**架构变更**，⛔ 不在本计划范围 |
| **检测式缓解（✅ 可行）** | ✅ | ① 审计不可关闭；② **对账**：定时/人工将 `gen1_health_state` 现状与 `docs/gen1/artifacts/**` 审计链比对，发现**无审计来源的变更** ⇒ 报异常；③ 治理纪律（⛔ 禁止脚本直写） |
| ⇒ 定性 | ⚠️ | **缓解 ≠ 结构性约束**；⛔ 不得在文档中声称 `A+B` 「杜绝绕过」 |

### §2.Q12 如何验证线上与 repo source parity

| 步骤 | 命令形态（★ 计划 · ⛔ 未执行） | 判据 |
|---|---|---|
| 1 | `tcb fn code download <fn> -e <envId>` | 取得实际包 |
| 2 | 解压 → 排除 `node_modules` / `config.json` / Gen-1 封印 JSON → 逐文件 sha256 | 与仓库源码对账 ⇒ `source_parity = EXACT_MATCH` |
| 3 | 记录 **包级** `CodeSha256` | ⚠️ `fn detail --json` **不返回** `CodeSha256`（`P3`）⇒ 只能走下载通道 |
| 4 | 记录 `index_sha256_raw` **与** `index_sha256_lf` | ⭐ 二者**不可互比**（台账 §0） |
| 5 | 台账追加 `D-xxx` | 依 `P3` 新部署门槛 |

**⛔ 本轮不执行**（`PACKAGE_LEVEL_PARITY = NOT_REVERIFIED` 继续成立）。

### §2.Q13 A+B 实施面对现有生产代码的影响（Owner 要素 10 的展开）

| 项 | 内容 |
|---|---|
| 改动量 | `cloudfunctions/adminGateway/index.js`：**+1 路由**（1 行分发）· **+1 handler**（新函数）· **+1 审计写** · **+1 只读导出步骤（dev/CI 层，非运行时）** |
| ⛔ 不改 | `getGen1Health` 的 GET 语义 · `updateParam` · `verifyToken` / `login` / `logout` / `changePassword` · 既有路由表其他项 |
| 部署依赖 | ⚠️ **需一次部署**（⇒ 受 `P5` 硬前置 + `P3` 包级 parity 双重约束） |
| 回滚 | 单路由移除 + 重新部署（⚠️ 又一次部署）；或保留路由但服务端开关关闭（⚠️ 需评估是否引入开关面） |

---

## §3 `GOV-GAP` work items（★ 独立 · ⛔ 不得并入 R2 或 C2）

### §3.1 `GOV-GAP-LOCK-APPROVAL`

| 项 | 内容 |
|---|---|
| **owner** | lock governance owner（冻结/审批域）—— ⛔ 不是 R2 实施者 |
| **dependency** | `LC-C` 双层语义成文（`PRE-1`）；⛔ 不依赖 R2 代码 |
| **implementation surface** | ① `ml/manifests/GEN1_FEATURE_PIPELINE_LOCK.json`（补 approval 字段，形态参照 `GEN1_GUARDED_EFFECTIVE_FREEZE.json`：`approved_by` / `approved_at` / `bindings_status` / `change_rule`）；② 若采纳 `change_rule` 范式 ⇒ 文档化「PR 显式修改 = 审批动作」 |
| **verification** | ① 锁文件可被 `verify-gen1-pipeline.js` 正常读取（⛔ 新字段不得破坏 G1-B）；② 审批字段存在性 + 取值域检查；③ 回归白名单全绿 |
| **rollback** | 单文件还原（锁）。⚠️ 若 G1-B 已按新锁 sha 通过，则回滚需同时还原 `ROOT_ANCHOR` + `RUNTIME_BUNDLE` |
| ⛔ 混批禁令 | ⛔ 不得与 `C3-R2` 代码变更、⛔ 不得与 `R2` 的 lock 4 文件更新**同一批**执行（前者是**能力**，后者是**状态**） |

### §3.2 `GOV-GAP-C`

| 项 | 内容 |
|---|---|
| **owner** | constants / AI governance owner |
| **dependency** | ⛔ 无（独立于 `LC-C` 与 `R2`） |
| **implementation surface** | 二择一（⛔ 本件不选边）：**（a）补齐实现** —— 给 `scripts/promote-*.js` 补 6 项审计要素（`prev_value` + 单调 `version` + operator + reason 枚举 + evidence ref + correlation id）；**（b）修正声明** —— 修正 `src/common/constants.js:61-74` 注释中「可审计」的措辞，使其与实现一致 |
| **verification** | 6 项审计要素逐项检查（现状 **0/6**）⇒ 目标 `6/6`（选 a）或「声明与实现一致」（选 b） |
| **rollback** | 注释 / 脚本单文件还原 |

### §3.3 `GOV-GAP-ACTOR`（★ 本轮新登记 · ⛔ 未裁定）

| 项 | 内容 |
|---|---|
| **owner** | admin auth owner |
| **dependency** | ⛔ 无（独立） |
| **implementation surface** | `cloudfunctions/adminGateway/index.js` 鉴权面（引入 operator 标识 / 多账号 / 角色）—— ⚠️ 属**较大变更**，⛔ 本件不设计 |
| **verification** | 审计 `actor` 字段可达「**强身份验证**」而非「声明式」 |
| **rollback** | 鉴权面还原 |
| ⛔ 边界 | ⛔ 不阻塞 `A+B` 选型；⛔ 不作为 `A+C` 的论证材料 |

---

## §4 `RETRACTED` documentation-only change 计划

| 项 | 内容 |
|---|---|
| **类型** | `DOC_CHANGE_TYPE = DOCUMENTATION_ONLY` |
| **机制** | **append-only 勘误**（沿用 `GEN1_PRE_LAUNCH_INVENTORY_ERRATA_20261003.md` 的 `ERRATA-1` 先例） |
| **⛔ 硬约束** | ⛔ **不修改**任何已 ACCEPT 主件的字节（`MAIN_DOC_BYTES_MODIFIED = NO`） |
| **撤回目标** | 「`missing_features` 未落库 / 未持久化 / 产出但未落库」 |
| **指向** | `C3_CONTRACT_DECISION = C3-A` + `R2`（分类口径修正） |
| **落点（4 处）** | ① `GEN1_PRE_LAUNCH_INVENTORY_20261002.md` L448 ⇒ 追加 `ERRATA-2` ② `GEN1_OWNER_DECISION_MATRIX_20261003.md` L104 ⇒ 勘误指针 ③ 同件 L195 ⇒ 勘误指针 ④ `GEN1_HEALTH_ATTESTATION_BLOCKER_DIAGNOSTIC_20261002.md` L328 ⇒ `OBS-3` 由 `OPEN` 改 `RETRACTED（部分）` |
| **⛔ 本轮** | ⛔ 只做计划（`RETRACT_DOC_CHANGE_EXECUTED = NO`） |

---

## §5 `HARNESS-MAINTENANCE-N9A-N10`

| 项 | 内容 |
|---|---|
| **owner** | harness maintenance owner |
| **dependency** | ⛔ 无 |
| **implementation surface** | ① `scripts/gen1/evidence-capture/v6_pre_launch_inventory_check.py`（`N-9a` 的**合成负控源串**）；② `docs/gen1/GEN1_ENGINE_IDENTITY_RECONCILIATION_20261002.md:377`（`N-10` 的**枚举域自述行**） |
| **verification** | 闸门 `v6_negative_scan.py` 由 `11 PASS / 2 FAIL` ⇒ **13/0**；且 ⛔ 不得为通过而放宽判定 |
| **rollback** | 两文件单文件还原 |
| ⛔ 混批禁令 | ⛔ **禁止**与 production implementation 混批；⛔ 本轮**不修**（`V6_NEGATIVE_SCAN_MODIFIED = NO`） |

---

## §6 边界与 STOP

**⛔ 本件未做**：未修改 production source · 未修改 DB · 未修改 lock · 未修改 authority · 未修改 manifest · 未部署 · 未推送 · 未合并 · 未打 tag · 未 canary · 未 release · 未执行 Evidence Execution · 未触 GE-04 · ⛔ 未修改 `v6_negative_scan.py`。

```text
PLAN_STATUS                      = PRESENT
PLAN_IS_AUTHORIZATION            = NO
C3_R2_IMPLEMENTATION_PLANNING    = AUTHORIZED
C3_R2_IMPLEMENTATION             = NOT_YET_AUTHORIZED
C3_R2_PRODUCTION_WRITE_SURFACE   = ONE_FILE
C3_R2_SCHEMA_CHANGE              = NONE
C3_R2_LOCK_UPDATE_REQUIRED       = YES
C3_R2_G1B_ITEMS                  = 11
C3_R2_DATA_MIGRATION             = NONE
C2_OWNER_SELECTION               = A+B
C2_A_PLUS_B_PLAN                 = PRESENT
C2_ROUTE_ADDED                   = NO
C2_DEPLOY_REQUIRED               = YES
C2_P5_HARD_PRECONDITION          = YES
C2_SDK_BYPASS_STRUCTURALLY_CLOSED = NO
GOV_GAP_LOCK_APPROVAL            = REGISTERED
GOV_GAP_C                        = REGISTERED
GOV_GAP_ACTOR                    = REGISTERED
RETRACT_DOC_CHANGE_EXECUTED      = NO
HARNESS_MAINTENANCE_N9A_N10      = REGISTERED
PRODUCTION_WRITE                 = 0
DB_WRITE                         = 0
DEPLOY                           = NO
AUTHORITY_CHANGE                 = NO
CANARY                           = OFF
EVIDENCE_EXECUTION               = NO
GE04                             = NO
IMPLEMENTATION_AUTHORIZED        = NO
STOP                             = YES
```

**说明（在代码块之外，⛔ 不并入 STOP 字段域）**：

- `PLAN_IS_AUTHORIZATION = NO`：本件全部内容为**设计文本**，⛔ 不构成实施授权。
- `C2_SDK_BYPASS_STRUCTURALLY_CLOSED = NO` 见 §2.Q11 —— ⚠️ **如实登记**，⛔ 不得淡化。
- `C3_R2_PRODUCTION_WRITE_SURFACE = ONE_FILE` 逐字对应「唯一生产写入面 = `src/common/utils/gen1-data-health.js`」。
- ★ **实施授权声明**：任何 implementation **必须先取得 owner 逐字放行口令**：

```text
AGENT IMPLEMENTATION AUTHORIZED
```

- ⛔ **收尾条件（逐字）**：除非 Owner 明确给出 `AGENT IMPLEMENTATION AUTHORIZED`，否则**绝对不得**进入 implementation。
