# GEN1_ENGINE_IDENTITY_RECONCILIATION — 引擎身份对账（只读 Gate）

> **Gate 名**：`GEN1_ENGINE_IDENTITY_RECONCILIATION`
> **落笔时刻**：`2026-10-02T13:15:49Z`（北京 `2026-10-02 21:15:49`）
> **性质**：**纯只读**。本件不修改生产代码 / 配置 / DB / Authority / lock / 冻结对象，不发任何写命令。
> **唯一目标**：彻底解释 `resolveShadowEngineVersion() → 'v3.6.1'` 与 V3.6.5 实际运行证据之间的关系，
> 并判定它究竟是 **Shadow-only legacy 标签**，还是 **实际 Production routing selector**。
>
> ⛔ 本件**不再讨论**「V3.6.5 有没有部署」—— 该问题已由
> `docs/V365_PRODUCTION_READINESS_LEDGER.md` L157–L170、提交 `d669298` 自述、
> 2026-10-02 线上逐字节 parity（`FINAL PARITY = PASS (EXACT_MATCH)`）三方锁定为 `COMPLETE / VERIFIED`。

---

## 0. 边界声明

**本 Gate 允许**：read-only investigation · call-graph construction · state reconciliation ·
source analysis · existing runtime evidence inspection · read-only production inspection ·
documentation · executable checks。

**本 Gate 禁止**（owner 2026-10-02 明文，⛔ 逐条未触碰）：

```text
v3_6_1_enabled = false          ⛔ 未改
selector switch                 ⛔ 未执行
ml_effective switch             ⛔ 未执行
production DB write             ⛔ 零写入
manualReviewConfirmed           ⛔ 未调用
health latch clear              ⛔ 未执行
deploy / rollback / canary      ⛔ 未执行
push / merge / tag              ⛔ 未执行
GE-04                           ⛔ NOT AUTHORIZED
```

**禁止以「改变生产状态」的方式做实验** ⇒ 本 Gate 全部判据来自四类只读输入：
① 源码（工作区）② 线上包归档（逐字节 parity 已验证）③ 只读探针归档（CloudBase 只读通道）
④ git 对象。

---

## 1. 结论速览

| # | 项 | 定值 | 判据位置 |
|---|---|---|---|
| 1 | `CASE` | **A** | §4 |
| 2 | `DEPLOYMENT_IDENTITY` | `V3.6.5` | §3 |
| 3 | `RUNTIME_IDENTITY` | `V3.6.5` | §3 |
| 4 | `EFFECTIVE_ROUTING_IDENTITY` | `V3.6.5`（其 V3 代码路径） | §3 / §4 |
| 5 | `v3.6.1` 的性质 | **legacy 参数包标签（label-only）** | §4 |
| 6 | `PRODUCTION_VERSION_CONFLICT` | **NO** | §4.3 |
| 7 | `REAL_PRODUCTION_ROUTING_GAP` | **NO** | §4.3 |
| 8 | 待清理 | `LEGACY_SHADOW_VERSION_NAMING / STATE_MODEL CLEANUP REQUIRED` | §7 |

**一句话**：`resolveShadowEngineVersion()` 是**版本标签派生器**，不参与任何路由分支；
真正决定「production decision 由 V3 路径还是 V3.8 路径产生」的开关是 **`trend_stage_enabled`**（线上实读 `true`）。

---

## 2. 完整 Call Graph（只读构造）

### 2.1 入口与两支根源

```text
CONFIG 集合 / DEFAULT_PARAMS（src/common/constants.js:212）
  ├─ trend_stage_enabled = true      ← ★ 真正的 routing switch（代码默认 true）
  └─ v3_6_1_enabled      = true      ← 仅参与「参数包」与「标签」派生

cloudfunctions/runDecisionEngine/index.js
  L503  const trendStageEnabled = merged.trend_stage_enabled === true;      ← routing 变量
  L508  const runV3Path        = trendStageEnabled || shadowEnabled;        ← 是否并行算 V3
  L509  const shadowEngineVer  = resolveShadowEngineVersion(merged);        ← ★ label 变量
```

### 2.2 `trendStageEnabled` 的全部消费点（**条件位 15 处**）

| 行 | 形态 | 作用 |
|---|---|---|
| L503 | 定义 | `merged.trend_stage_enabled === true` |
| L508 | `\|\|` | 是否跑 V3 路径 |
| **L561** | **`if (trendStageEnabled)`** | **写回 `portfolio.market_regime` / `market_factor` ⇒ 改变决策输入** |
| **L747** | 作为实参传入 `mergeShadowOutputs(...)` | **决定哪一路结果胜出（见 2.3）** |
| L1103 | `&&` | `decisionRegime` 取值 |
| L1109 | 三元 | `decision_source` 取值 |
| L1152 | 字段写入 | shadow log `trend_stage_enabled` |
| L1156 / L1157 | 三元 | shadow log `production_engine` / `shadow_engine` |
| L1184 | 实参 | shadow log builder |
| L1192 / L1193 | 三元 | 另一处 `production_engine` / `shadow_engine` |
| **L1209** | 三元**右侧** | `const productionEngine = trendStageEnabled ? shadowEngineVer : 'v3.8';` |
| **L1210** | 三元 | `const shadowEngine = runV3Path ? (trendStageEnabled ? 'v3.8' : shadowEngineVer) : null;` |
| L1343 | 字段写入 | `runtimeStatus.trend_stage_enabled` |

### 2.3 真正的「生产决策选择」发生在 `src/common/utils/v3-shadow.js`

```text
v3-shadow.js:123   const primary   = trendStageEnabled === true ? v3Result : v38Result;   ← ★ 生产决策主体
v3-shadow.js:124   const secondary = trendStageEnabled === true ? v38Result : v3Result;
v3-shadow.js:130   engine_path     = trendStageEnabled === true ? 'v3' : 'v38';           ← 落库字段
v3-shadow.js:131   engine_version  = trendStageEnabled === true ? shadowEngine : 'v3.8';  ← 落库字段
v3-shadow.js:96    engine_mode     = trendStageEnabled === true ? 'production' : 'shadow';
```

**判据**：`mergeShadowOutputs` 的 `primary`（即最终 `final_target` 的宿主对象）由 **`trendStageEnabled`** 决定，
**与 `resolveShadowEngineVersion()` 无关**。

### 2.4 `resolveShadowEngineVersion` 的全部消费者（**9 处，零条件位**）

```text
定义：v3-shadow.js:74-81  （纯函数；输入仅 params）
调用 A：runDecisionEngine/index.js:509    → const shadowEngineVer
调用 B：v3-shadow.js:95                   → const shadowEngine（在 mergeShadowOutputs 内）
调用 C：线上包 index.js:656（V365 BLOCKED 早退分支的返回值）  ← 见 §6.3 源差异说明
```

| 消费者 | 形态 | 是否条件位 |
|---|---|---|
| `rde:1209` `productionEngine = trendStageEnabled ? shadowEngineVer : 'v3.8'` | 赋值右侧 | ❌ 否（它**被**三元选，不**做**选择） |
| `rde:1194` / `rde:1279` `decision_engine: shadowEngineVer` | 字段写入 | ❌ 否 |
| `rde` 线上包 `:1476` `engine_version: productionEngine` | 字段写入 | ❌ 否 |
| `v3-shadow.js:101` `shadow.v3_6_1 = shadowEngine === 'v3.6.1' ? v3Target : null` | **判等 → 置 null/置值** | ❌ 否（**贴标签**：决定「v3.6.1 专属字段是否填充」） |
| `v3-shadow.js:131` / `:132` `engine_version` / `shadow_engine_version` | 字段写入 | ❌ 否 |
| `v3-shadow.js:138` / `:140` `v361_target` / `v361_action` | **判等 → 置 null/置值** | ❌ 否（同上，标签） |

**⇒ `resolveShadowEngineVersion` 的返回值从未出现在「选择哪一路结果」的条件位置。**

### 2.5 十一项下游影响逐条判定

| # | 下游 | 受 `resolveShadowEngineVersion` 影响？ | 机制 |
|---|---|---|---|
| 1 | `runDecisionEngine` 控制流 | **否** | 其产物仅用于**赋值**（`productionEngine` / `decision_engine` / `engine_version`）；控制流由 `trendStageEnabled` 决定 |
| 2 | Gen-1 shadow | 否 | `gen1_guarded_*` 全族由 `gen1-circuit-breaker` / `gen1-health-state` 派生，与引擎标签无关联 |
| 3 | candidate | 否 | `run_candidate_decision` 由发布链（`v365-atomic-publish` / `active_run_pointer`）产生 |
| 4 | candidate validation | 否 | `validation_passed` / `validation_reason` 由 run-manifest 校验产生 |
| 5 | promotion | 否 | `promoted` / `cas_reason` 由 `active_run_pointer` CAS 产生 |
| 6 | active pointer | 否 | `active_run_pointer::production.run_id` 与引擎标签无关联 |
| 7 | **`decision_result`** | **仅写入字段值** | `engine_version` / `shadow_engine_version` = 标签值；**`engine_path` 由 `trendStageEnabled` 决定** |
| 8 | production API read path | **仅透传** | `apiGateway/index.js:964` `engine_version: (runtime && runtime.production_engine) \|\| ENGINE_VERSION` ⇒ 原样传给前端，**无分支** |
| 9 | selector | 否 | `gen1_guarded_selector_source` 硬编码 `'BASELINE'`；`selectGuardedResult()` 的 GUARDED 分支直接 `throw` |
| 10 | `ml_effective` | 否 | 单向派生自 `gen1_guarded_effective_active`（章程 §6.3） |
| 11 | Evidence capture | 否 | V6.0 契约读源 = `run_candidate_*` + `active_run_pointer`；引擎标签不参与 |

---

## 3. 三轴版本表

> ⛔ **三轴不得合并为一个 `production_engine` 字段。** 下表逐轴给出 source / commit-bundle / runtime field / consumer / evidence。

### 轴 1 — `DEPLOYMENT_IDENTITY` = **`V3.6.5`**

| 项 | 值 |
|---|---|
| **source** | `docs/V365_PRODUCTION_READINESS_LEDGER.md` L157–L170（生产就绪台账） |
| **commit / bundle** | 实现提交 `d669298`（`feat/v365-production-integrity-impl`）／ 授权 bundle `e996e88a…55a4` |
| **runtime field** | `runtime_status.v365_run_integrity.engine_version = 'v3.6.5'` |
| **consumer** | 部署台账 · 逐字节 parity 校验 · run integrity gate |
| **evidence** | 部署窗口 `2026-09-30T05:37:19Z → 05:38:13Z` · `CONTROLLED_DEPLOYMENT = COMPLETE` · `CURRENT_PRODUCTION_DEPLOYMENT_IDENTITY = V3.6.5` · `ONLINE_SOURCE_PARITY = EXACT_MATCH`（91 文件）· `DEPLOYMENT_IDENTITY_VERIFIED = true` · 2026-10-02 实时 parity `FINAL PARITY = PASS (EXACT_MATCH)`（`MISSING 0 / EXTRA 0 / CONTENT_DIFF(LF) 0 / CONTENT_DIFF(raw) 0`） |

### 轴 2 — `RUNTIME_IDENTITY` = **`V3.6.5`**

| 项 | 值 |
|---|---|
| **source** | 线上运行记录（CloudBase 只读通道，2026-10-02 实读） |
| **commit / bundle** | 同上（部署包自报） |
| **runtime field** | `run_history.engine_version` · `run_manifest`（同 `run_id`）· `runtime_status.v365_run_integrity.engine_version` |
| **consumer** | run integrity gate · finality / promotion 链 |
| **evidence** | `run_history` 实测 **2 行全部** `engine_version = 'v3.6.5'`（`engine:2026-09-30:b1790776862980` / `engine:2026-10-01:b1790812813101`）；`v365_run_integrity.business_status = 'COMPLETE'` · `v365_mode = 'ENFORCE'` |

### 轴 3 — `EFFECTIVE_ROUTING_IDENTITY` = **`V3.6.5`（其 V3 代码路径）**

| 项 | 值 |
|---|---|
| **source** | `src/common/utils/v3-shadow.js`（两源逐字节相同 `863d6d53…`）+ `cloudfunctions/runDecisionEngine/index.js` |
| **commit / bundle** | 同轴 1（该模块随 V3.6.5 包发布） |
| **runtime field** | `runtime_status.trend_stage_enabled = true` · `decision_result.engine_path = 'v3'` |
| **consumer** | `runDecisionEngine` 决策输出（`final_target` 宿主 = `primary`）· `portfolio.market_regime` 写回 |
| **evidence** | §5 六重自证 |

### 附轴（**非独立 identity**）— legacy 参数包标签 = `v3.6.1`

| 项 | 值 |
|---|---|
| **source** | `resolveShadowEngineVersion()` 派生 + `applyV361ParamBundle()`（`v3_6_1_enabled = true` 强制 V3.6.1 参数包） |
| **runtime field** | `runtime_status.production_engine` · `runtime_status.decision_engine` · `shadow_v3_log.production_engine` |
| **consumer** | 前端展示（`web/src/rewrite/adapters/constants.js:63`）· apiGateway 透传（`:964`） |
| **evidence** | 无任何分支消费它（§2.4）；仓内已有两条注释自认其为「**引擎版本**」而非部署身份 |

---

## 4. `resolveShadowEngineVersion` 语义验证 → 最终裁定

### 4.1 函数本体（`src/common/utils/v3-shadow.js:74-81`）

```js
function resolveShadowEngineVersion(params) {
  if (params && (params.v3_6_1_enabled === true || params.v3_6_1_s5_downside === true)) {
    return 'v3.6.1';
  }
  if (params && params.v3_6_persistence === true) return 'v3.6';
  if (params && params.v3_5_enabled === true) return 'v3.5';
  return 'v3';
}
```

**纯函数**：输入仅 `params`，无 I/O、无副作用、无全局状态；返回**字符串标签**。

### 4.2 条件位穷举（算法判据）

对 `productionEngine` 与 `resolveShadowEngineVersion` 的全部出现行做「是否位于条件位」的穷举检查
（断言见 §9 `R-3` / `R-4`）：

```text
production_engine 标签变量在 runDecisionEngine/index.js 共 4 行：
  L1209  const productionEngine = trendStageEnabled ? shadowEngineVer : 'v3.8';   ← 赋值（被选择）
  L1229        engine_version: productionEngine,                                   ← 字段写入
  L1277        production_engine: productionEngine,                                ← 字段写入
  L1358        production_engine: productionEngine,                                ← 字段写入
条件位命中（if (...) / ? v / && v / || v / v === / v ==  / !v）：0 处
```

### 4.3 ★ 最终裁定 = **CASE A**

```text
CASE = A

V3.6.1 = SHADOW-ONLY LEGACY IDENTITY
       （更精确的定性：LABEL-ONLY LEGACY —— 它连「选 shadow engine」都不做，
         只把「当前 V3 参数包风味」派生成一个字符串标签）

V3.6.5 = PRODUCTION_DEPLOYMENT_IDENTITY
V3.6.5 = PRODUCTION_RUNTIME_IDENTITY

PRODUCTION_VERSION_CONFLICT = NO
REAL_PRODUCTION_ROUTING_GAP = NO
```

**为何不是 CASE B**：CASE B 的成立条件是「该函数实际控制 production decision path」。
判据被 §4.2 穷举证伪：其返回值 **0 处**出现在条件位 ⇒ 不存在「被它切换的生产路径」。
生产路径的选择权在 `trend_stage_enabled`，而该参数**不是**该函数的产物，也**不经过**该函数。

**必附标记**：

```text
LEGACY_SHADOW_VERSION_NAMING / STATE_MODEL CLEANUP REQUIRED
```

理由：`runtime_status.production_engine` 的**字段名**暗示「生产引擎版本」，
但其**值是 shadow 系标签**；`resolveShadowEngineVersion` 的**函数名**暗示「解析 shadow 引擎版本」，
但其返回值**同时**被写入 `production_engine`。**命名与语义已分离** ⇒ 后续 Freeze / Attestation
⛔ **不得**把 `production_engine` 当作部署身份或路由身份的绑定源（防错绑）。

---

## 5. 六重独立自证：生产决策确实走 V3 路径

| # | 证据 | 实测值 | 反推 |
|---|---|---|---|
| 1 | `runtime_status.trend_stage_enabled` | `true` | 直接字段 |
| 2 | `runtime_status.production_engine` | `'v3.6.1'` | 公式 `trendStageEnabled ? shadowEngineVer : 'v3.8'` ⇒ 必须 `true` |
| 3 | `runtime_status.shadow_engine` | `'v3.8'` | 公式 `runV3Path ? (trendStageEnabled ? 'v3.8' : shadowEngineVer) : null` ⇒ 必须 `true`（否则应为 `'v3.6.1'`） |
| 4 | `shadow_v3_log.engine_mode` | `'cutover'` | `trendStage ? 'cutover' : (shadowOn ? 'shadow' : 'off')` ⇒ 必须 `true` |
| 5 | `decision_result.engine_path` | `'v3'` | `trendStageEnabled === true ? 'v3' : 'v38'` ⇒ 必须 `true` |
| 6 | `run_candidate_decision.engine_path` | `'v3'` | 同上（候选链同源） |

> **六条证据互为独立来源**（3 个不同集合 + 代码默认值），且**代入公式后唯一解**为 `trendStageEnabled === true`。

### 5.1 owner 第 4 节指定核对的五个数据源

| 数据源 | 实测 | 与引擎身份的关系 |
|---|---|---|
| `runtime_status.v365_run_integrity` | `engine_version = 'v3.6.5'` · `business_status = 'COMPLETE'` · `v365_mode = 'ENFORCE'` | 轴 1 / 轴 2（部署与运行身份） |
| `run_history` | 2 行，均 `engine_version = 'v3.6.5'` | 轴 2 |
| `run_candidate_decision` | `engine_path = 'v3'` · `engine_version = 'v3.6.1'` · `run_id = engine:2026-10-01:b1790812813101` | 轴 3 + 标签 |
| `active_run_pointer` | `_id = active_run_pointer::production` · `run_id = engine:2026-09-30:b1790776862980` · `revision = 1` | 与引擎标签**无关联** |
| `decision_result` / `apiGateway` / `adminGateway` / frontend | `engine_path='v3'`；网关**透传** `production_engine`；前端 `readField` **仅展示** | 轴 3 的下游 |

### 5.2 ★ 对 owner 核心提问的直接回答

> **「实际产生 production decision 的结果，究竟由哪个 engine identity 产生？」**

**由 `V3.6.5` 部署包的代码产生**，具体为其 **V3 代码路径**（`engine_path = 'v3'`）。
该路径因 `v3_6_1_enabled = true` 而加载 **V3.6.1 参数包**，因而在若干**标签字段**上自报 `v3.6.1`。
**「自报 v3.6.1 的标签字段」与「产生决策的代码身份 V3.6.5」是两个不同的量。**

---

## 6. 取证源纪律（本 Gate 新增，⛔ 必须遵守）

### 6.1 载体树 ≠ 部署源

| 对象 | 行数 | `v365` 命中 | sha256（raw，前 24） | 是否部署源 |
|---|---|---|---|---|
| 载体树 `cloudfunctions/runDecisionEngine/index.js` | 1377 | **0** | `072b40089c7bc260a888bda9` | ⛔ **否** |
| 主仓库（当前 checkout 分支）同一路径 | 1377 | **0** | `072b40089c7bc260a888bda9` | ⛔ 否 |
| 主仓库 `dist-functions/runDecisionEngine/index.js` | 1737 | 有 | `eb1868cb0f386bee4b894528` | ✅ **是（= 线上包）** |
| 线上包归档 `_cb-connect-20260921/bundle-src/index.js` | 1737 | 有 | `eb1868cb0f386bee4b894528` | ✅ 是 |

**判据**：`dist-functions` 与线上包**逐字节相同**（`eb1868cb…` / 100944 B），且 2026-10-02 parity 为 `EXACT_MATCH`。

⇒ ⛔ **不得**用载体树（或任意非部署分支）的 `cloudfunctions/*` 作为「当前生产代码」证据。
本件 §2 的 Call Graph 因此**分两源标注**：结构逻辑取自 `v3-shadow.js`（两源逐字节相同 `863d6d53…`），
行号取自载体树；线上包行号单列。

### 6.2 `v3-shadow.js` 两源一致（可共用行号）

```text
载体树 src/common/utils/v3-shadow.js     863d6d5366a8ffa7f814dc80…  8157 B
线上包 common/utils/v3-shadow.js         863d6d5366a8ffa7f814dc80…  8157 B
⇒ 逐字节相同
```

### 6.3 源差异（本件唯一一处，已定性）

线上包 `index.js:656` 含 `production_engine: resolveShadowEngineVersion(merged)`，
位于 **V365 `RUN_GATE.BLOCKED` fail-closed 早退分支的返回值**中（载体树无此行）。
**定性**：该处仅在「run 被 gate 阻断、不写任何 authoritative 数据」的路径上执行，
**不参与正常决策路由**；列为源差异登记，⛔ 不构成 CASE B 证据。

---

## 7. 命名 / 状态模型清理项（登记，⛔ 本 Gate 不执行）

| ID | 问题 | 建议方向（须独立授权） |
|---|---|---|
| `N-1` | `runtime_status.production_engine` 值 = shadow 系标签，与 `v365_run_integrity.engine_version` 语义冲突 | 引入 `effective_routing_identity` 显式字段；`production_engine` 降级为 legacy alias（**类同 `ml_effective` 的既有降级范式**） |
| `N-2` | `resolveShadowEngineVersion` 函数名与「被写入 `production_engine`」的用途不符 | 改名或拆分为 `resolveV3ParamBundleLabel` + `resolveDeployedEngineVersion` |
| `N-3` | `ml-shadow.js:77` 硬编码 `engine_version: 'v3.6.1'` | 与 `N-1` 同批收敛 |
| `N-4` | `input_hash` 出现 `engine:engine:…` 双前缀 | 归 R3 `input_hash` 观察项（前轮已登记） |

---

## 8. 与 Health 严格分离（owner 第 7 节）

本 Gate 的引擎身份裁定**不改变** Health 任何一项：

```text
runtime_data_health        = DEGRADED
HEALTH_ROOT_CAUSE          = 515880 / STATISTICAL_MISSING
HEALTH_REVIEWED            = NO
MANUAL_REVIEW              = REQUIRED
AUTO_REOPEN                = FORBIDDEN
PRODUCTION_WRITE_REQUIRED_FOR_RECOVERY = YES
RECOVERY_AUTHORIZATION     = NOT GRANTED
HEALTH_READY               = NOT READY
```

⇒ **引擎身份 = CASE A（无冲突）** 与 **Health = DEGRADED（阻断）** 是**两条独立轴**，⛔ 不得互相解释。

---

## 9. Executable check（只读自检）

**脚本**：`scripts/gen1/evidence-capture/v6_engine_identity_reconciliation_check.py`
**性质**：纯只读 · fail-closed（任一输入缺失 ⇒ `exit 2`，⛔ 无 WARN / SKIP）。

### 9.1 断言清单（`R` 系列 · 实跑 **25 PASS / 0 FAIL**，exit 0）

```text
R-1  resolveShadowEngineVersion 定义在场（纯函数 · 三分支 · 返回字符串标签）
R-2  线上包 v3-shadow.js == 载体树 v3-shadow.js（863d6d53… 逐字节）
R-3  ★ productionEngine 仅 4 处（1 赋值 + 3 字段写入）；条件位命中 = 0；无其它形态
R-4  ★ resolveShadowEngineVersion 在 rde 仅 2 处（import + 单次调用）；调用结果零条件位
R-5  trendStageEnabled 出现 15 处 · 条件位形态齐备（if / 三元 / || / 实参传递）
R-6  ★ primary 由 trendStageEnabled 决定（生产决策主体）
R-7  ★ engine_path 由 trendStageEnabled 决定（落库字段）
R-8  constants.js:212 trend_stage_enabled 代码级默认 = true
R-9  ⚠️ 载体树 rde 不含 v365 / runIntegrity ⇒ 载体树 ≠ 部署源（取证源纪律）
R-10 dist-functions/runDecisionEngine/index.js == 线上包 index.js（eb1868cb… 逐字节）
R-11 线上 runtime_status：production_engine / decision_engine / shadow_engine / stage_engine / trend_stage_enabled / v3_6_1_* / v3_shadow_enabled
R-12 线上 v365_run_integrity.engine_version = v3.6.5（同一 runtime_status 内两轴共存）
R-13 线上 shadow_v3_log[0]：engine_mode='cutover' + trend_stage_enabled=true（第 4 重自证）
R-14 线上 run_history：全部 engine_version = v3.6.5（2 行 ⇒ 轴 2 运行身份）
R-15 线上 decision_result 归档：engine_path='v3' 且 engine_version='v3.6.1'（第 5 重自证）
R-16 线上 run_candidate_decision 归档：engine_path='v3'（第 6 重自证 · 候选链同源）
R-17 线上 active_run_pointer::production 在场（非 Engine Identity 消费者）
R-18 ★ 六重自证公式自洽（用部署代码常量重算 production_engine / shadow_engine，与实读逐项相符）
R-19 2026-10-02 parity 归档：FINAL PARITY = PASS (EXACT_MATCH) 且四项差异全 0
R-20 本件在场性（CASE A · 三轴 · 无冲突 · 清理项 · Health 分离 · STOP 块）
R-21 ⛔ 三件同扫零放行式（Deploy=YES / Canary=ON / GE-04=AUTHORIZED / FREEZE=AUTHORIZED / HEALTH_READY=READY / ATTESTATION=PASS / CONFLICT=YES）
R-22 ⛔ 本脚本零写操作门（AST 结构化：shell 写 · FS 写 · DB 写 · open 写模式 · 授权绕过 · shutil 导入）
R-23 ★ SELF_REFERENCE_RED_PROOF
R-24 ★ REAL_EXECUTABLE_VIOLATION_RED_PROOF
R-25 ★ FAIL_CLOSED_RED_PROOF
```

**实跑原文（关键行）**：

```text
[PASS] R-3  ★ productionEngine 仅 4 处 …；条件位命中 = 0；无其它形态
           · n=4 cond=[] weird=[]
[PASS] R-4  ★ resolveShadowEngineVersion 在 rde 仅 2 处（import + 单次调用）；调用结果零条件位
           · n=2 cond=[]
[PASS] R-18 ★ 六重自证公式自洽
           · calc=('v3.6.1','v3.8') actual=('v3.6.1','v3.8')
[PASS] R-10 dist-functions == 线上包（逐字节 ⇒ 部署源身份）
           · dist=eb1868cb0f38 online=eb1868cb0f38
[PASS] R-2  线上包 v3-shadow.js == 载体树 v3-shadow.js（逐字节 ⇒ 路由模块无源歧义）
           · carrier=863d6d5366a8 online=863d6d5366a8
```

### 9.2 打红自证（变异仅在系统临时目录副本；⛔ 原件从始至终未被写）

| RP | 变异 | 结果 | 归因 |
|---|---|---|---|
| **RP-0** | 无（干净对照） | `25 PASS / 0 FAIL` · rc=0 | 基线 |
| **RP-A** | `v3-shadow.js:123` 的 `primary` 改由 `shadowEngine === 'v3.6.1'` 决定 | rc=1 · `R-6` + `R-2` FAIL | R-6 = 目标门；R-2 = **合理连带**（载体树与线上包不再逐字节同） |
| **RP-B** | 归档 `decision_result.engine_path: 'v3' → 'v38'` | rc=1 · **`R-15` 单独** FAIL | 单门归因 ✓ |
| **RP-C** | 注入 `def _redproof_never_called(): subprocess.run(["tcb","fn","deploy","--force"])` | rc=1 · **`R-22` 单独** FAIL | 单门归因 ✓ |
| **RP-D** | `GEN1_PROBE_DIR` 指向不存在目录 | **exit 2** · `FAIL-CLOSED` · 零 PASS 输出 | fail-closed ✓ |
| **RP-E** | `constants.js:212` 默认值 `true → false` | rc=1 · **`R-8` 单独** FAIL | 单门归因 ✓ |
| — | 事后原件复核 | `25 PASS / 0 FAIL` | 原件未被写 ✓ |

⚠️ **打红脚本自身的一处缺陷（已修，如实登记）**：首版 `reset()` 只还原**工作树副本**、未还原**探针副本**，
导致 RP-B 的变异**污染** RP-C / RP-E 的 FAIL 集合（多门 FAIL 使归因失真）。
**修法**：`reset()` 同时还原两份副本 ⇒ 每个 RP 从**独立干净基线**出发。
**纪律增量**：打红自证的「干净基线」必须覆盖**全部输入源**（源码 / 归档 / 环境变量），
⛔ 不是只还原被变异的那一个文件。

---

## 10. 操作安全事故登记（OPERATION SAFETY INCIDENT — **ZERO CONSEQUENCE**，如实自报）

**事件**：本 Gate 打红自证首版（RP-C）采用「把违规 Call 注入到**模块级**」的方式构造变异，
注入内容为 `subprocess.run(["tcb", "fn", "deploy", "--force"])`。
该语句若被执行，将是一条**真实部署命令**。**这是一次方法论错误，不是一次实际影响。**

**可执行性核查（三条独立证据，全部指向「命令从未被启动」）**：

| # | 核查 | 实测 |
|---|---|---|
| 1 | `tcb` 实体类型 | `~/.workbuddy/binaries/node/cli-connector-packages/tcb` = **`#!/bin/sh` wrapper（413 B）**；同目录另有 `tcb.cmd` / `tcb.ps1` |
| 2 | Windows Python 能否 CreateProcess `tcb` | **`FileNotFoundError [WinError 2] 系统找不到指定的文件`**（无扩展名的 sh 脚本不是 PE 可执行体）⇒ **进程未被创建** |
| 3 | 即便创建，配置是否成立 | 父目录 `cloudbaserc.json` 为 `"functions": []` + `functionRoot: "./functions"`（该目录不存在）+ `envId: "{{env.ENV_ID}}"`（未解析模板）⇒ **无函数可部署** |

**线上只读确证（`tcb fn list`，2026-10-02 实读；只读命令）**：

```text
函数总数 = 10，全部 Status = "Deployment completed"
runDecisionEngine      MOD = 2026-09-30 13:38:07   ← 与台账部署时点 05:38:13Z（UTC）一致
apiGateway             MOD = 2026-09-08 11:32:53
adminGateway           MOD = 2026-09-08 11:32:23
★ 全部函数中 Modification time 落在 2026-10-02 的 = NONE
★ 最新 MOD = 2026-09-30 13:38:07
```

⇒ **`DEPLOY = 0 次`；生产函数配置零漂移；零后果。**

**纪律增量（已落 `TOOLING.md`）**：

```text
⛔ 打红自证注入可执行违规代码时，必须注入到「定义但**永不调用**的函数体」内
   （静态可被 AST 门抓到 ⇒ 门有效；运行时零执行 ⇒ 零风险）。
⛔ 绝不在模块级 / main() 内注入真实命令 —— 「即使不该生效」也不是理由。
⛔ 打红自证的变异内容一律不得是「可对生产生效」的真实命令。
```

---

## 11. 最终状态（正式）

```text
GEN1_ENGINE_IDENTITY_RECONCILIATION = COMPLETE

CASE = A

DEPLOYMENT_IDENTITY        = V3.6.5
RUNTIME_IDENTITY           = V3.6.5
EFFECTIVE_ROUTING_IDENTITY = V3.6.5

PRODUCTION_VERSION_CONFLICT = NO

LEGACY_SHADOW_VERSION_NAMING / STATE_MODEL CLEANUP REQUIRED = YES（登记，⛔ 本 Gate 不执行）

HEALTH_READY           = NOT READY
PRODUCTION_ATTESTATION = BLOCKED

PRODUCTION_WRITE = 0
DEPLOY           = NO
ROLLBACK         = NO
CANARY           = OFF
MERGE            = NO
TAG              = NO
GE-04            = NOT AUTHORIZED

STOP = YES
```

⛔ **本 Gate 完成前不得进入 V3.6.6 Freeze / Production Attestation。**
