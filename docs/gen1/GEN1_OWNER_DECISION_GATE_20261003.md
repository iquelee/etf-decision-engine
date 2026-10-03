# GEN1_OWNER_DECISION_GATE_20261003 —— Owner Decision 落地前的决策准备与影响面核对

> 生成时间：**2026-10-03**（GMT+8）· 轮次：`OWNER DECISION GATE`（**只读 briefing 轮 · ⛔ 不进入 implementation**）
> 上游：`GEN1_C3_C2_ARCHITECTURE_DECISION_20261003.md` + `GEN1_DEPLOYMENT_GOVERNANCE_DECISION_20261003.md`（carrier commit `6d7ef89`）
> 性质：⛔ **本件不构成实施授权**、⛔ **不代表已获授权**、⛔ 未修改任何 production 对象、⛔ 未进入 coding。
> ★ 「能实现」 ≠ 「已授权实现」；★ **本件只做决策准备，不替 owner 做决定。**

---

## §0 方法与证据分级

| 等级 | 含义 |
|---|---|
| `repo-src` | 工作区源码（`src/common/utils/**`、`cloudfunctions/**`、`scripts/**`、`src/common/schema.js`） |
| `git-tracked-check` | `git ls-tree -r --name-only <ref>` + `git check-ignore` ⇒ 判定「是否确在版本控制内」 |
| `git-object` | `git show <ref>:<path>` · `merge-base --is-ancestor` · `log -1` · `ls-remote`（均以 `git` 前缀执行） |
| `governance-artifact` | `ml/manifests/**` · `docs/production-deployment-ledger.md` · `src/common/constants.js` 的治理注释 · `refs/tags/**` |
| `online-meta` | 2026-10-03 实时只读 `tcb fn detail --json` 的元数据（`Triggers` 等） |
| `NOT RE-READ` | 明确未在本轮重读 |

**本轮不重新证明旧问题**（owner 明令）。本件只做**换算**：把已冻结的架构裁定换算成 `Owner Decision` 的影响面。

**★ 本轮新增的三项直接实测（构成本件结论的依据）**：

| # | 实测 | 证据等级 | 影响 |
|---|---|---|---|
| `N-9` | `ml/manifests/GEN1_FEATURE_PIPELINE_LOCK.json` 的 `rule` 文本**逐字列明**「指标/阶段/PARAMS/特征构建/RS20/schema/sector 映射/**数据健康**/域策略」为受管变更域 | `governance-artifact` | §1.3 ★ 新发现歧义 |
| `N-10` | 同一锁文件的 `files[]` 仅 **4 个 sha256 绑定**：`indicators.js` / `trend-stage.js` / `runGen1ShadowEod/index.js` / `runGen1ShadowEod/frozen-manifest.json` —— ⛔ **不含 `gen1-data-health.js`** | `governance-artifact` | §1.3 ★ |
| `N-11` | `adminGateway` 路由面实读：`/api/admin/gen1/health` **仅 GET**；`/api/admin/*` 统一先过 `verifyToken(getAdminToken(event))` | `repo-src` | §2.1 |

---

## §1 C-3 · Owner Decision 影响（冻结事实 → 影响面换算）

### §1.1 冻结事实（⛔ 本件不重新证明，仅引用）

```text
C3_DECISION           = RECLASSIFY
C3_CONTRACT_DECISION  = C3-A（coarse health state）
missing_features      = ML_SHADOW_SIGNAL diagnostic
旧「missing_features 未落库」声明 = RETRACTED
```

由上述冻结事实导出的**唯一待裁事项** = `C3-γ → R2`（Data Health 分类口径修正）。⛔ `C3-α`（旧声明）与 `C3-β`（契约问题）均**不是工作项**。

### §1.2 C3-γ → R2 的最小实施范围

**问题（当前口径）**：`evaluateDataHealth()` 把**语义可空**字段与**硬必填**统计量混入**同一集合**判定，导致合法空值被误判为降级。

| # | 机制（实测锚点） | 现状 | 最小修正 |
|---|---|---|---|
| 1 | `src/common/utils/gen1-data-health.js:35-39` `REQUIRED_FEATURES`（**恰 15 项**，单一集合） | `sideway_range` 与 `atr20` **同类** | 拆为两组：`HARD_REQUIRED`（真必填） / `SEMANTICALLY_NULLABLE`（语义可空，如 `sideway_range`） |
| 2 | 同文件 `:66-68` `absent` / `nullish` 均基于 `required` 全集 | 空值集合混入可空字段 | `nullish` 逐步改为**仅对硬必填**取基数 |
| 3 | 同文件 `:116-120` 第 ⑥ 步 `if (nullish.length > 0) return DATA_DEGRADED / STATISTICAL_MISSING` | **假阳性降级** | 第 ⑥ 步判据改为对**硬必填的空值**取基数 |
| 4 | 同文件 `:110-114` 第 ⑤ 步 `nullish.includes('rs_20d')` | `rs_20d` 独立走 `BENCHMARK_MISSING` | ⛔ **不动**（`rs_20d` 不是本议题） |
| 5 | `sideway_range` 的 `null` 成因 = `calcSidewayRange()` 在 `sideway_days < 1` 时返回 `null` | 语义合法 | ⛔ **不改**阶段/指标实现（`trend-stage.js` 为锁定文件，见 §1.4） |

**★ 最小范围 = 单文件 + 三处判定**：`src/common/utils/gen1-data-health.js` 的 ①②③。⛔ 不含指标计算、⛔ 不含阶段判定、⛔ 不含 schema 变更。

> ★ **边界（逐字沿用）**：`R2 = 规格 / 口径修正` · `R2 ≠ 功能已修复` · `R2 ≠ 已授权`。

### §1.3 修改哪些契约 / 文档

| # | 载体 | 为何需要 | 形态 | 是否触碰生产 |
|---|---|---|---|---|
| 1 | `src/common/utils/gen1-data-health.js` 模块头注释 + `REQUIRED_FEATURES` 注释 | 该文件**自述即是规格**（注明「与 frozen-manifest `features_core` 对齐」）⇒ 分组后自述必须同步 | 代码内注释 | ✅ 是（**唯一**生产文件） |
| 2 | `docs/gen1/GEN1_C3_C2_ARCHITECTURE_DECISION_20261003.md` §1.8 | 记录实施范围细化 | ⛔ **追加**，⛔ 不回改 | ⛔ 否 |
| 3 | `docs/gen1/GEN1_PRE_LAUNCH_INVENTORY_ERRATA_*.md` | 旧 C-3 表述的勘误指针（沿用 `ERRATA-1` 先例） | ⛔ **追加勘误指针** | ⛔ 否 |
| 4 | ★ `ml/manifests/GEN1_FEATURE_PIPELINE_LOCK.json` 的 `rule` 文本 | ★ **见下方歧义** | ⛔ **待 owner 二元裁定后方可动** | ⚠️ 治理制品 |
| 5 | `src/common/schema.js` 的对应注释（**仅注释**） | 若 `missing_features` 语义改为「硬必填空值」口径，其注释须对齐 | ⛔ 仅注释，⛔ 不改 schema 结构 | ⚠️ 需显式确认 |

**★★ 新发现歧义 `LC-R2-1`（本件最重要的新证据 · 必须由 owner 裁定）**

| 项 | 内容 |
|---|---|
| 事实 A（`N-9`） | `GEN1_FEATURE_PIPELINE_LOCK.json` 的 `rule` 逐字：「任何 role 文件变更（指标/阶段/PARAMS/特征构建/RS20/schema/sector 映射/**数据健康**/域策略）都必须**显式更新本锁并走审批**；不得静默修改。」 |
| 事实 B（`N-10`） | 同一锁文件的 `files[]` 只绑定 **4 个 sha256**，⛔ **不含** `src/common/utils/gen1-data-health.js` |
| ⇒ 歧义 | 「数据健康」被 `rule` 文本**点名**为受管域，但**未被 sha256 绑定** ⇒ R2 是否属于「必须更新本锁并走审批」的变更，**取决于 `rule` 文本与 `files[]` 清单谁是权威** |
| 两种读法 | **(a) 文本为准** ⇒ R2 属受管变更：须**更新锁文件**（并复算 sha）+ **走审批**；**(b) 清单为准** ⇒ 4 文件是封闭枚举，`rule` 为示例性描述 ⇒ R2 仅需普通代码变更流程 |
| ⛔ 本件不选边 | 这是 owner 裁定项，登记为 `LC-R2-1`；⛔ **不得由被检方自行解释为「不适用」**（利益冲突） |

### §1.4 明确不得修改哪些生产代码

| # | 文件 | 理由 |
|---|---|---|
| 1 | `src/common/utils/indicators.js` | 锁文件 sha 绑定 ①（`hash_basis = LF-normalized`） |
| 2 | `src/common/utils/trend-stage.js` | 锁文件 sha 绑定 ②；`sideway_days` / `sideway_range` 的**产生地**——R2 只改**消费侧**判定，⛔ 不改产生侧 |
| 3 | `cloudfunctions/runGen1ShadowEod/index.js` | 锁文件 sha 绑定 ③；`missing_features` 的**写入地**（`:234`） |
| 4 | `cloudfunctions/runGen1ShadowEod/frozen-manifest.json` | 锁文件 sha 绑定 ④（`features_core` 定义） |
| 5 | `src/common/utils/gen1-circuit-breaker.js` | 健康状态机 + 门控；R2 **不得**在此处「放宽门」 |
| 6 | `src/common/utils/gen1-health-state.js` | latch 写入者；属 C-1/C-2 通道，⛔ 非 R2 |
| 7 | `src/common/utils/gen1-safety-permission.js` | 阶段前置（X-2）；⛔ 与 R2 无交集（见 §1.5） |
| 8 | `cloudfunctions/adminGateway/index.js` | 属 C-2 `A+B` 实施面（见 §2.1）；⛔ 本轮与 R2 均不碰 |
| 9 | `ml/manifests/**`（除 `LC-R2-1` 裁定后的锁文件） | 冻结制品；⛔ 不得静默改 |
| 10 | `src/common/constants.js` `FROZEN_PARAM_KEYS` · 任何 `immutable_set` / lock / authority / DB schema / 集合 | 硬红线：⛔ 永久锁 |

> ★ **一句话边界**：R2 的**唯一**生产写入面 = `src/common/utils/gen1-data-health.js`；⛔ 其余 9 类**全不动**。

### §1.5 是否会影响 C-1 / C-4 / X-2

| 节点 | 是否受影响 | 性质 | 依据 |
|---|---|---|---|
| **C-1**（闩锁 `DEGRADED` → `OK` + 显式 `ACTIVE`） | ✅ **是** | **直接**（R2 是 C-1 的**已识别前置之一**） | `DATA_DEGRADED` → `computeHealthStatus`（`gen1-circuit-breaker.js:62`）= `HEALTH.DEGRADED` → `circuitGate` 关 `allow_canary` ⇒ 健康门 `OK`∧`ACTIVE` 不可达。R2 消除**一个已实测**的降级贡献项 |
| **C-4**（健康正控不成立，`allow_canary=false` → 正控成立） | ✅ **是** | **间接**（R2 → C-1 → C-4） | 依赖计划：`C-4` 的**前置 = C-1**（`GEN1_GAP_DEPENDENCY_AND_IMPLEMENTATION_PLAN_20261003.md:169`） |
| **X-2**（`STAGE_PRECONDITION`：`baselineStage ∈ {S2,S3}` ∧ `signal.stage ∈ {'S2'}`） | ⛔ **否** | **无交集** | X-2 的实现面 = `gen1-safety-permission.js`（`MODEL_STAGES=['S2']`、阶段门）；R2 只改 **data-health 分类**，⛔ 不触及 stage 计算 ⇒ 二者**无共同文件、无共同数据依赖** |

⚠️ **不得过度归因（★ 逐字沿用上游禁令）**：C-1 的 latch 自 `09-21` 起为 `DEGRADED`，其**历史成因本轮未证明**（窗口归属不可判定）。R2 **只主张**消除「`sideway_range` 语义空值 ⇒ 假阳性降级」这一**已实测**贡献项，⛔ **不主张**它是唯一成因，⛔ **不主张** R2 完成即 C-1 可达。

### §1.6 实施后的最小验证集（★ 设计 · ⛔ 未执行）

| # | 验证项 | 判据 | 目的 |
|---|---|---|---|
| V-1 | `tests/gen1-data-health.test.js` 存量用例 | 全绿 | 无回归 |
| V-2 | **新增**用例：`sideway_days = 0`（⇒ `sideway_range = null`） | 期望 **不是** `DATA_DEGRADED / STATISTICAL_MISSING` | 直接验证修正目标 |
| V-3 | **反向**用例：真硬必填缺失（如 `atr20 = null`） | ⛔ **必须仍为** `DATA_DEGRADED / STATISTICAL_MISSING` | ★ 防「一刀切放宽」（**反向断言，缺即视为修正过宽**） |
| V-4 | 反向用例：`absent`（列未生成） | ⛔ **必须仍为** `DATA_BLOCKED / PIPELINE_MISSING` | 防误伤管线故障语义 |
| V-5 | 反向用例：`rs_20d` 缺失 | ⛔ **必须仍为** `DATA_BLOCKED / BENCHMARK_MISSING` | 第 ⑤ 步不受影响 |
| V-6 | `515880` 复算（用现有 fixture，⛔ 不读生产） | `missing_features` 期望不含 `sideway_range` | 端到端口径核对 |
| V-7 | 锁一致性 | 按 `LC-R2-1` 裁定结果：受管 ⇒ 复算并更新锁 sha；不受管 ⇒ 出「不适用」声明 | 治理一致性 |
| V-8 | 回归白名单 | `v6_*` 显式白名单全绿（含本件 checker） | 全局回归 |

⛔ **验证纪律**：⛔ 不得以 shadow / replay 计数作 Evidence 源（GE-03）；⛔ 不得读生产 DB 充当验证；⛔ 不得为了验证而执行 release。

### §1.7 rollback 边界（★ 设计 · ⛔ 未执行）

| 项 | 内容 |
|---|---|
| 变更性质 | **纯代码 / 规格**变更：⛔ 无 DB 写、⛔ 无配置写、⛔ 无 authority 变更、⛔ 无新集合 |
| rollback 形态 | 还原 `src/common/utils/gen1-data-health.js` 至前一 commit（单文件还原即可，无伴随状态） |
| 数据回滚 | ⛔ **不需要**：R2 **不改历史行**；仅影响其**之后**新写入行的 `status` / `missing_features` 记录 |
| ⚠️ 边界提示 | R2 上线后，新写入的 `ml_shadow_signal.missing_features` 语义会变（硬必填口径）。**历史行口径与新行不同代** ⇒ 任何跨代统计必须**显式声明口径**，⛔ 不得混算 |
| 前置约束（若部署） | 属「**新部署**」⇒ 受姊妹件 `P3`（包级 parity 强制）与 `P4 D-3`（以 **tag 为锚**）双重约束 |
| ⛔ 本件不做 | ⛔ 不实施、⛔ 不部署、⛔ 不建分支、⛔ 不回滚任何对象 |

---

## §2 C-2 · Owner Decision 对照（`A+B` vs `A+C` · ⛔ 不排名、⛔ 不自行选择）

### §2.1 A+B —— 新增最小 admin release route

| 条目 | 内容（★ 设计 · ⛔ 未实施） |
|---|---|
| **最小新增 surface** | `cloudfunctions/adminGateway/index.js` **+1 路由**（`POST /api/admin/gen1/health/release`）+ **1 个 handler**；复用既有 `db` 层与既有集合 `GEN1_HEALTH_STATE`（⛔ **零新集合**）；★ **须追加一条只读导出步骤**（DB 审计记录 → `docs/gen1/artifacts/**`），因**运行时无法写 git** |
| **authority** | ✅ **服务端强制**：复用 `gen1-authority.js` 的 `authorityAllows()` / `PRODUCTION_LOCKED`；★ **恢复 ≠ 升档**（`gen1_authority` 保持 `CANARY`） |
| **actor** | ✅ **会话身份**（`admin_password` / `admin_token` 登录态 + `admin-auth.js`）⇒ 有**可指认的自然人** |
| **approval** | ✅ 请求体必须携带**枚举** `reason_code` + `evidence_ref`，**服务端校验**；⛔ **不接受请求体透传 `manualReviewConfirmed`** |
| **audit** | ✅ **服务端强制写** 8 字段（服务端置位，**调用方不可跳过**）；落 `docs/gen1/artifacts/**` |
| **state transition** | 仅**分支①**（release）：`latched_health := incoming`；`manual_review_required := false`；`degraded_at := null`；`ml_off_at := null`；`recovery_applied = true`；`reviewed_at := now`；`reviewed_by := <会话身份>` |
| **replay** | ✅ 服务端重算 `computeLatchedState` + **反事实断言**（若未确认则应仍为 `DEGRADED`） |
| **rollback** | ✅ 服务端回写**释放前快照**；★ **无 snapshot 不得释放** |
| **anti-bypass** | ★ **最强**：鉴权中间件（`N-11`）+ 服务端强制重算 + 服务端置位 + 冷却期 + **审计不可关闭** |
| **对现有生产代码的影响** | `cloudfunctions/adminGateway/index.js`：+1 route / +1 handler / +1 审计写；⛔ **不改** `getGen1Health` 的 GET 语义；⛔ **不改** `updateParam`；⚠️ **新增一次部署**（受 `P5` 分叉裁定 + `P3` 包级 parity **硬前置**约束） |

### §2.2 A+C —— 复用 / 扩展既有 promotion channel

| 条目 | 内容（★ 设计 · ⛔ 未实施） |
|---|---|
| **必须具体说明需要扩展哪个既有机制** | 既有 **`scripts/promote-*.js` 骨架**（`loadCred()` 取凭据 + `param_config` 写 + `version` / `updated_at`）。★ **关键澄清**：三个既有脚本的**写目标都是 `param_config`**，而 release 的写目标是 **`gen1_health_state`** ⇒ 本形态实为「**骨架复用 + 目标集合更换**」，⛔ **不是**原样扩展 |
| **为什么该机制能够承担 release authority** | ⚠️ **现状不能**（上游已裁定 `C` = production mutation utility）。要能承担，**必须补齐四件事**：① 显式引入 `gen1-authority.js` 校验；② 引入**可指认自然人**身份；③ 引入 **8 字段审计**；④ 引入**快照前置**。⇒ 本质是**在旧骨架上重建治理能力**，⛔ 不是「已有能力即可用」 |
| **需要补哪些 authority / audit / approval 字段** | **authority**：脚本内 `require` `gen1-authority.js` + 把 `authorityAllows()` 的**判定结果本身**写入 `authority_decision`；**audit**：8 字段写入 `docs/gen1/artifacts/**`（★ 脚本本地运行 ⇒ **可原生产出 git artifact**）；**approval**：CLI 参数 `--reason-code <枚举>` / `--evidence-ref <id>` / `--operator <自然人>` / `--correlation-id <id>`，且**无默认值** |
| **是否会改变既有 promotion 语义** | ⛔ **不改**：新增独立脚本，⛔ **不修改** 3 个既有 `promote-*.js`。⚠️ 但会**暴露并纠正**既有声明落差 `GOV-GAP-C`（`FROZEN_PARAM_KEYS` 注释称 `promote-*.js` 为「专门、**可审计**」通道，而实现 0/6 审计要素）—— 该落差**在本轮登记**，⛔ 不在本轮修复 |
| **replay 如何成立** | ⚠️ **可本地重算**（脚本内调 `computeLatchedState`），但**无服务端留证强制** ⇒ 复算**依赖自律**；须由脚本强制写出复算输入快照才可复算 |
| **rollback 如何成立** | ⚠️ 须脚本**显式实现**「释放前快照落 artifact + 回写」；★ **无 snapshot 不得释放**（与 `A+B` 同约束，但由脚本自律而非服务端强制） |
| **anti-bypass 如何成立** | ⛔ **最弱**（结构性）：SDK 直写**可绕过** `FROZEN_PARAM_KEYS` 与路由鉴权（`N-5`）。缓解手段仅为：脚本内显式 authority 校验 + ⛔ 禁止 `--force` 类开关 + 审计 artifact **不可跳过**。⇒ 缓解 ≠ 结构性约束 |
| **对现有生产代码的影响** | 新增 `scripts/promote-gen1-health-release.js`（本地脚本）；✅ **零路由变更**、✅ **零部署**；⛔ 不改既有脚本、⛔ 不改云函数 |

### §2.3 条目对照（owner 指定条目 · ⛔ 不排名）

| 条目 | **A+B** | **A+C** |
|---|---|---|
| 最小新增 surface | +1 路由 + 1 handler + 1 审计写 + **只读导出步骤** | +1 本地脚本（换写目标集合） |
| authority | ✅ 服务端强制复用 `authorityAllows()` | ⚠️ 脚本内新增引用（当前 **0 处**） |
| actor | ✅ 会话身份（自然人可指认） | ⛔ 机器凭据（无自然人身份） |
| approval | ✅ 请求体枚举 + 服务端校验 | ⚠️ CLI 参数（无服务端校验） |
| audit | ✅ 服务端强制 8 字段 | ⚠️ 脚本自律 + 本地产出 artifact |
| state transition | ✅ 服务端置位（不可跳） | ⚠️ 脚本置位 |
| replay | ✅ 服务端重算 + 反事实断言 | ⚠️ 可本地重算，无留证强制 |
| rollback | ✅ 服务端回写快照 | ⚠️ 脚本显式实现 |
| anti-bypass | ★ 最强（结构性） | ⛔ 最弱（可绕过） |
| 对现有生产代码的影响 | `adminGateway/index.js` + **需部署**（受 `P5` 前置） | 新增本地脚本 + **零部署** |

> ⛔ **本件不排名、不推荐、不选边。** 二者均为**可行形态**；选型属 owner。

### §2.4 输出

```text
C2_OWNER_SELECTION = PENDING
```

⛔ 该字段在本件落笔前**未出现任何取值**，且 ⛔ **不得由本件填值**。

---

## §3 P1–P5 · Owner Decision 表

> ⛔ **逐项按上一轮裁定生成**；⛔ 本件**不执行任何一项**（`P1…P5_EXECUTED = NO` 全部继续成立）。

| ID | 当前证据结论 | Owner 需决定什么 | 决定后影响 |
|---|---|---|---|
| **P1** | D-007 缺失 | 是否补录 | deployment governance |
| **P2** | PRE-GOVERNANCE | 是否写 BASELINE_ACCEPTED | baseline contract |
| **P3** | package parity debt | 是否接受规则 | future deployment |
| **P4** | master 非唯一 authority | 是否正式采纳 | deployment authority |
| **P5** | `8fc3ba66` 为线上 `adminGateway` 对齐锚 | 是否采纳 | C-2 / A+B |

**★ 三条强制注意（owner 逐字 · 逐条展开）**：

| 注意 | 含义 | 反面（⛔ 禁止的读法） |
|---|---|---|
| **补录 ≠ 重新授权** | `P1` 的 `D-007` 只是把**既有授权**（`c021.2 §3` + tag 注解）**登记**进台账 | ⛔ 不得读作「补录即产生新授权」 |
| **PARITY_DEBT ≠ 当前 deployment authorization** | `P3` 的存量债务是**对账缺口**，⛔ 不构成、也⛔ 不取消任何部署授权 | ⛔ 不得读作「有债务即当前部署不合法」 |
| **`8fc3ba66` ≠ master HEAD** | `P5` 的对齐锚是**内容锚**（与线上逐字节一致），⛔ **不是** `origin/master` HEAD | ⛔ 不得读作「`8fc3ba66` 就是最新正确版本」 |

**各 ID 的决定后影响（细化）**：

| ID | 决定后立即解锁什么 | 决定后 ⛔ 仍不解锁什么 |
|---|---|---|
| `P1` | 台账完整性（消除「授权在 tag、台账不完整」的分裂） | ⛔ 不解锁任何部署；⛔ 不改任何函数内容 |
| `P2` | 把「登记缺失」与「行为违规」分离 | ⛔ 不产生授权；⛔ `AUTHORIZATION = NOT_APPLICABLE (PRE_GOVERNANCE)` 不变 |
| `P3` | 新部署的强制门槛有据可依 | ⛔ 存量 9 函数不会因此自动对账（仍记 `PARITY_DEBT`） |
| `P4` | 部署权威源定义可判定 | ⛔ 不改变任何函数的当前线上内容；⛔ 不主张任何函数「应该」升版本 |
| `P5` | 解除 `A+B` 的分叉起点死结（**须先完成 master 5 个 commit 的二元裁定**） | ⛔ 不建分支、⛔ 不还原文件、⛔ 不新增路由 |

---

## §4 实施顺序预览（dependency graph · ★ 逐字复现 · ⛔ 不执行）

**Critical Path（owner 给定 · ★ 逐字 · ⛔ 不得改变）**：

```text
C3-γ
  ↓
C-1
  ↓
C-4
  ↓
X-2 PRECONDITION
  ↓
A-1
  ↓
D-1 → D-2 → D-3
  ↓
X-1
  ↓
B-1
  ↓
G-1 → G-2
  ↓
A-2a → A-2b
  ↓
G17
  ↓
E-5
```

**★ 跨件前置（旁注 · ⛔ 不构成对上面 Critical Path 的修改）**：

```text
P5 → A+B
```

**节点释义（供对照，⛔ 不改顺序）**：

| 节点 | 释义 | 证据 |
|---|---|---|
| `C3-γ` | `R2` Data Health 分类口径修正（本件 §1.2） | 上游 §1.8 |
| `C-1` | 闩锁 `DEGRADED` → `OK` + 显式 `ACTIVE`（**写 latch**） | `GEN1_OWNER_DECISION_MATRIX_20261003.md:102` |
| `C-4` | 健康正控成立（`allow_canary=false` → 成立） | 同 `:169`（前置 = `C-1`） |
| `X-2 PRECONDITION` | `STAGE_PRECONDITION`（⛔ **非 Gap · 非工程 · 不可排期**） | `GEN1_GAP_DEPENDENCY_AND_IMPLEMENTATION_PLAN_20261003.md:221` |
| `A-1` | guarded candidate 恒 `null` → 非 `null`（**观察项**，非可独立开工任务） | 同 `:147` / `:242` |
| `D-1 → D-2 → D-3` | **Evidence 轴**：启动 → ≥30 独立事件 → Evidence Seal（`PENDING` → `SEALED`） | `GEN1_OWNER_DECISION_MATRIX_20261003.md:106-108` |
| `X-1` | `AUTHORITY_ELEVATION`（`gen1_authority` → `GUARDED_EFFECTIVE`） | 依赖计划 `:220` |
| `B-1` | 读侧迁移（按 `active_run_pointer` pin 读取） | `GEN1_OWNER_DECISION_MATRIX_20261003.md:96` |
| `G-1 → G-2` | 读侧 fail-closed → promotion/pointer 回滚路径 | 依赖计划 `:211-212` |
| `A-2a → A-2b` | selector cutover **代码通路** → **激活翻转**（★ `CP-2` 拆分） | `GEN1_OWNER_DECISION_MATRIX_20261003.md:94` |
| `G17` | `G17_GEN1_HAS_EFFECT_ON_DECISION`（★ 最终验收条件） | 同 `:150` |
| `E-5` | `GE-04`（★ 最高等级**独立**授权；⛔ 任何其他 PASS 不得隐式触发） | 同 `:115` |

**⚠️ 命名空间提示（沿用 NS-4 / 新增 NS-8）**：

| NS | 撞名 | 说明 |
|---|---|---|
| `NS-4`（已有） | `D-1 … D-5` | 本图 `D-1/D-2/D-3` = **Evidence 轴 DAG 节点**；⛔ 与 `D-1 · C-3` / `D-2 · C-2` / `D-3 · AUDIT_CARRIER_LOCUS`（**架构决策轴编号**）**不同义** |
| `NS-8`（★ 本轮新增） | `R2` | ① `C3-γ → R2` = **Data Health 分类口径修正**（工作项）；② `GEN1_OWNER_DECISION_MATRIX_20261003.md` 的 `R2` = **授权风险等级**（`R0…R4`）。⛔ 二者**不同义**，跨件引用必须带限定 |

**⛔ 变更声明**：`CRITICAL_PATH_CHANGED = NO` —— 本件**逐字复现** owner 给定的顺序，⛔ 未增删节点、⛔ 未调整次序、⛔ 未合并/拆分。

---

## §5 边界与 STOP

### §5.1 本轮硬边界（owner 指定 · 逐项实测）

| 字段 | 值 |
|---|---|
| `PRODUCTION_WRITE` | `0` |
| `DB_WRITE` | `0` |
| `DEPLOY` | `NO` |
| `AUTHORITY_CHANGE` | `NO` |
| `CANARY` | `OFF` |
| `EVIDENCE_EXECUTION` | `NO` |
| `GE04` | `NO` |
| `IMPLEMENTATION_AUTHORIZED` | `NO` |

**⛔ 本轮禁止（逐字）**：修改生产代码 · 修改 DB · 修改 authority · 修改 `FROZEN_PARAM_KEYS` · 修改 `immutable_set` / lock · 部署 · 推送到远端 · 合并 · 打 tag · release · Evidence Execution · GE-04 · 修改 `v6_negative_scan.py`。

### §5.2 当前仍未授权事项（逐项）

| # | 未授权事项 | 状态 |
|---|---|---|
| 1 | `C3-γ → R2` 的实施（代码变更） | ⛔ 未授权 |
| 2 | `LC-R2-1`（锁文本 vs 清单谁权威）的裁定 | ⛔ 未裁定 |
| 3 | `C2_OWNER_SELECTION`（`A+B` / `A+C` 选型） | ⛔ `PENDING` |
| 4 | `P1` / `P2` / `P3` / `P4` / `P5` 的执行 | ⛔ 全部未执行 |
| 5 | 旧文档 RETRACTED 勘误指针的落地写入 | ⛔ 未授权 |
| 6 | `GOV-GAP-C`（`FROZEN_PARAM_KEYS` 注释的「可审计」承诺落差）的修复 | ⛔ 未授权 |
| 7 | 闸门 `v6_negative_scan.py` 的 2 项既有 FAIL 的修复 | ⛔ 未授权（owner 明令 ⛔ 不得修改该闸门） |

### §5.3 下一步所需 Owner authorization（★ 最小放行集）

| 若 owner 想要 | 必须显式给出 |
|---|---|
| 开始 `R2` 实施 | `AGENT IMPLEMENTATION AUTHORIZED` **且**明确 `R2` 范围（含 `LC-R2-1` 的裁定结果） |
| 选择 release 形态 | `C2_OWNER_SELECTION` **显式取** `A+B` **或** `A+C`（⛔ 二者不可同时） |
| 执行任一 `P` 项 | 逐项显式授权（`P1`…`P5` 分别点名） |
| 落地勘误指针 | 文档写操作授权（不改已 ACCEPT 主件字节） |

> ⛔ **本件不代 owner 填任何上述取值。**

```text
C3_DECISION                 = RECLASSIFY
C3_CONTRACT_DECISION        = C3-A
C3_R2_SCOPE                 = EXPLICIT
C3_R2_AUTHORIZED            = NO
C3_LOCK_AMBIGUITY           = LC_R2_1
C2_OWNER_SELECTION          = PENDING
C2_A_PLUS_B                 = EXPLICIT
C2_A_PLUS_C                 = EXPLICIT
C2_AUTHORITY                = EXPLICIT
C2_AUDIT                    = EXPLICIT
C2_STATE_TRANSITION         = EXPLICIT
P1                          = EXPLICIT
P2                          = EXPLICIT
P3                          = EXPLICIT
P4                          = EXPLICIT
P5                          = EXPLICIT
P1_EXECUTED                 = NO
P2_EXECUTED                 = NO
P3_EXECUTED                 = NO
P4_EXECUTED                 = NO
P5_EXECUTED                 = NO
CRITICAL_PATH_CHANGED       = NO
CROSS_COMPONENT_PRECONDITION = P5_TO_A_PLUS_B
PRODUCTION_WRITE            = 0
DB_WRITE                    = 0
DEPLOY                      = NO
AUTHORITY_CHANGE            = NO
CANARY                      = OFF
EVIDENCE_EXECUTION          = NO
GE04                        = NO
IMPLEMENTATION_AUTHORIZED   = NO
STOP                        = YES
```

**说明（在代码块之外，⛔ 不并入 STOP 字段域）**：

- `C3_LOCK_AMBIGUITY = LC_R2_1` 指 §1.3 的「锁 `rule` 文本点名『数据健康』 vs `files[]` 仅 4 个 sha 绑定」歧义；⛔ 本件不选边。
- `C2_OWNER_SELECTION = PENDING` 是**显式未决**，⛔ 不得读作「已默认某一项」。
- `CRITICAL_PATH_CHANGED = NO` 的依据见 §4（逐字复现 + ⛔ 未增删节点）。
- `CROSS_COMPONENT_PRECONDITION = P5_TO_A_PLUS_B` 的完整含义 = 「`P5` 的分叉裁定是 `A+B` 的硬前置」，见 §4 旁注。
- ⛔ **实施授权声明**：本件所有「最小范围 / 对照 / 表 / 依赖图」均为**文本**，⛔ **不构成实施授权**、⛔ **不代表已获授权**；设计文本 ≠ 授权文本。
- **放行口令（owner 逐字形态）**：`AGENT IMPLEMENTATION AUTHORIZED` —— ⛔ 截至本件落笔该口令**未出现**，故 `IMPLEMENTATION_AUTHORIZED = NO` 继续成立。
- ⛔ **收尾条件**：除非 Owner 明确给出 `AGENT IMPLEMENTATION AUTHORIZED`，否则**绝对不得进入 implementation**。
