# Gen-1 —— FINAL OWNER DECISION（第十二轮 · Owner 正式裁定）

> 生成时间：**2026-10-03**（GMT+8）· 轮次：`FINAL OWNER DECISION GATE`
> 上游：`docs/gen1/GEN1_LOCK_AUTHORITY_GATE_20261003.md`（carrier commit `6d71385`）· `docs/gen1/GEN1_OWNER_DECISION_GATE_20261003.md`（`8e9a159`）· `docs/gen1/GEN1_C3_C2_ARCHITECTURE_DECISION_20261003.md` / `docs/gen1/GEN1_DEPLOYMENT_GOVERNANCE_DECISION_20261003.md`（`6d7ef89`）
> 性质：**Owner 裁定的登记件 + planning 授权件**。⛔ 本件**不修改**任何 production 代码 / DB / lock / manifest / authority / 配置；⛔ **不构成** production implementation 授权。
> ⛔ **核心边界**：`GOVERNANCE_RECORD = YES` ∧ `DEPLOYMENT_AUTHORIZATION = NO` —— 治理记录与部署授权**必须在两条轴上分别登记**，⛔ 不得互推。

---

## §0 方法与证据分级

| 等级 | 含义 | 本件用途 |
|---|---|---|
| `git-object` | `show <ref>:<path>` · `ls-tree` · `log --oneline <base>..HEAD -- <path>`（上述子命令均以 `git` 前缀执行） | 前件冻结事实复核 |
| `worktree-read` | 工作区实读（`ml/manifests/**` · `scripts/**` · `cloudfunctions/**` · `src/common/schema.js`） | 双层锁 / A+B 事实面 |
| `governance-artifact` | 前件裁定文本（`6d71385` / `8e9a159` / `6d7ef89`）+ 仓库内既有治理范式 | 裁定上游 |
| `runtime-static` | 只读静态校验器实跑（无写、无部署） | G1-B 项数 |
| `self-authored` | 本仓 20261003 自建件 | ⛔ **不得**作为独立权威源 |

**★ 纪律声明（逐字沿用 + 本轮新增）**

1. ⛔ 本件是 **Owner 裁定的登记**，⛔ 不是裁定本身；裁定的作出者是 Owner。
2. ⛔ **登记 ≠ 执行**：本件所有「最小变更面 / 实施计划 / work item」均为**文本**。
3. ⛔ **`LC-C` 不改变 R2 的授权状态**：R2 planning 已授权，R2 implementation 仍未授权。
4. ⛔ **`A+B` 的选定 ≠ `B` 已实现**：本件不新增路由、不新增 handler。
5. ⛔ **`P1…P5` 采纳 ≠ 执行**：逐项 `P*_EXECUTED = NO` 继续成立。

---

## §1 `LC-R2-1` —— Owner 裁定 = `LC-C`（双层锁模型）

### §1.1 上游冻结事实（⛔ 不重新论证，仅引用 + 本轮复核）

| 事实 | 值 | 上游位置 |
|---|---|---|
| `LC_R2_1_DECISION`（上游） | `PENDING`（三候选 `LC-A` / `LC-B` / `LC-C`，⛔ 未选边） | `GEN1_LOCK_AUTHORITY_GATE_20261003.md` §1.5 |
| `LOCK_AUTHORITY`（上游描述性结论） | `TWO_TIER__NO_FORMAL_TIEBREAKER` | 同件 §1.9 |
| `LOCK_AUTHORITY_INTERNAL_INCONSISTENCY` | `PRESENT`（头注释 **7 域** vs `rule` **9 域** vs `files[]` **4 文件**） | 同件 §1.9 |
| 最强新证据（结构耦合） | `cloudfunctions/runGen1ShadowEod/index.js`（**已绑定**）`require` 了 `gen1-data-health` 与 `gen1-domain-permission`（**均未绑定**）⇒ **绑定集在传递语义上不封闭** | 同件 `N-7` |
| 实证先例 | `4e1d370`（2026-09-10 13:58:51）改 `gen1-data-health.js` 而**未更新锁**，无门禁转红 | 同件 `N-9` |

### §1.2 Owner 裁定原文

```text
LC_R2_1_DECISION   = LC-C
LOCK_MODEL         = TWO_LAYER
RULE_LAYER         = BEHAVIOR_DOMAIN_AUTHORITY
FILES_LAYER        = BYTE_BINDING_AUTHORITY
DEPENDENCY_CLOSURE = REQUIRED
```

**裁定链（逐步形式）**：

```text
rule
  ↓
受管行为域
  ↓
dependency closure
  ↓
files[]
  ↓
具体字节绑定
```

### §1.3 双层语义（`rule` 与 `files[]` 各自的权威半径）

| 层 | token | 权威半径 | 是否被机器消费 | 判断力 |
|---|---|---|---|---|
| **规则层** | `RULE_LAYER = BEHAVIOR_DOMAIN_AUTHORITY` | 决定「**哪些行为域是受管的**」（`rule` 的 9 域）⇒ 进而决定「哪些文件**必须**进入闭包计算」 | ⛔ 全仓无代码读 `.rule`（上游 `N-4`） | **范围权威**：回答「哪些算受管」，⛔ 不回答「当前是否已绑定」 |
| **绑定层** | `FILES_LAYER = BYTE_BINDING_AUTHORITY` | 决定「**当前已被字节绑定的文件集合**」（`files[]` 4 项 sha256） | ✅ 唯一被 G1-B 机器验真（10/10 PASS） | **状态权威**：回答「现在绑了哪些字节」，⛔ 不回答「应绑哪些」 |

> ★ **两层的语义分工消除了上游的「无 tiebreaker」死结**：上游把二者当作**互斥的权威候选**（故维持 `PENDING`）；`LC-C` 判定二者**不是互斥候选，而是不同问题的两个层次**。⛔ 因此「`rule` 覆盖范围 **大于** `files[]` 绑定范围」这一事实**不再**是「制品内部不一致」，而是「**闭包尚未完成**」的一个**可检出、可闭环**的信号。

### §1.4 `DEPENDENCY_CLOSURE` 规则（`REQUIRED` · 本轮唯一成文化）

```text
DEPENDENCY_CLOSURE = REQUIRED

对 rule 层点名的每一个受管行为域 D：
  S0 = { D 的实现文件 }                        （域 → 文件映射）
  S1 = require/import 闭包(S0)                  （递归传递依赖）
       ⚠️ 终止条件（⛔ 不得无限扩张）：
         a) 命中「已绑定文件」⇒ 停；
         b) 命中「非 Gen-1 域」（Node 内置 / 第三方 / 非 Gen-1 模块）⇒ 停；
         c) 命中「已在本轮闭包栈中」⇒ 停（防环）。
  Δ = S1 \ files[]                             （闭包差集）
  if Δ ≠ ∅: 锁不满足 closure
       ⇒ 第一步：rule 层登记（该域是否已在 9 域内？若在 ⇒ 无需新增；若不在 ⇒ 先补域声明）
       ⇒ 第二步：files[] 层补字节绑定（sha256）
       ⇒ 第三步：approval（走 GOV-GAP-LOCK-APPROVAL 载体的形态）
  if Δ = ∅: closure 成立
```

**实例（本轮闭环证据 · `N-7`）**：

| 步骤 | 结果 |
|---|---|
| `D` = 特征构建 / PARAMS（`rule` 第 4 项） | `S0 = { cloudfunctions/runGen1ShadowEod/index.js }`（**已绑定**） |
| `S1` | `S0` ∪ `{ gen1-data-health.js, gen1-domain-permission.js, … }` |
| `Δ` | `{ src/common/utils/gen1-data-health.js, src/common/utils/gen1-domain-permission.js, … }` |
| 结论 | ★ **`Δ` 恰对应 `rule` 的第 8 域「数据健康」与第 9 域「域策略」** ⇒ 说明 `rule` 的 9 域**本就是闭包层声明**，⛔ 不是笔误、⛔ 不是示例性描述 |
| ⇒ | ★ 这就是 `LC-C` 的**自洽性证据**：`rule` 层把闭包中「尚未绑定的域」提前登记，等待 `files[]` 层逐步收敛 |

### §1.5 R2 implementation 前**必须完成**的六项（Owner 清单 → 本件回答）

| # | Owner 要求 | 本件回答 | 落点 |
|---|---|---|---|
| 1 | 明确 `rule` 与 `files[]` 的双层语义 | ✅ 见 §1.3（范围权威 vs 状态权威） | 本件 §1.3 + DOC2 §1.4 |
| 2 | 明确 dependency closure 规则 | ✅ 见 §1.4（含终止条件 a/b/c 与三步处置） | 本件 §1.4 |
| 3 | 将 `gen1-data-health.js` 纳入正确的 binding / approval 闭环 | ✅ **三步路径**：① rule 层**无需新增域**（「数据健康」已在 9 域内）→ ② `files[]` 层补 1 项 sha256 绑定 → ③ approval（⛔ **现状无载体** ⇒ 项 6） | DOC2 §1.4 / §3.1 |
| 4 | 明确 lock 更新后的 baseline 身份 | ✅ **新 pipeline baseline**：`feature_pipeline_hash` 由 `8efdda6f…` 变为新值 ⇒ 产生**新一代管线基线**；⛔ 模型 / schema / 阈值三类基线**均不变** | DOC2 §1.5 |
| 5 | 明确 G1-B 从 10→11 的影响 | ✅ 项数 **10 → 11**（+1 = `gen1-data-health.js` 的字节绑定）；同时 **①root anchor** 与 **④bundle hash** 两项**值变更**（⚠️ 变更的是值，⛔ 不是项数） | DOC2 §1.4 |
| 6 | 明确是否需要新增 `GOV-GAP-LOCK-APPROVAL` | ✅ **需要**。`GEN1_FEATURE_PIPELINE_LOCK.json` **无任何审批字段**（无 `approved_by` / `approved_at` / `bindings_status`）⇒ 无法在锁内记录自然人审批 | 本件 §5.1 + DOC2 §3.1 |

### §1.6 ⛔ 禁止读法（Owner 明令 · 逐字）

```text
⛔ files[] 未列出  ⇒  文件不受管
```

**展开为三条被禁止的推论**（本件及其下游件一律不得出现）：

| # | 被禁止的推论 | 为何禁止 |
|---|---|---|
| 1 | 「`files[]` 只有 4 项 ⇒ 其余文件不受本锁管理」 | 与 `RULE_LAYER = BEHAVIOR_DOMAIN_AUTHORITY` 直接冲突；且被 §1.4 的 `Δ ≠ ∅` 证伪 |
| 2 | 「`gen1-data-health.js` 不在绑定集 ⇒ R2 不受管」 | 同上；R2 属 `rule` 第 8 域，**受管** |
| 3 | 「上游 `LOCK_AUTHORITY_INTERNAL_INCONSISTENCY = PRESENT` ⇒ 制品是坏的」 | `LC-C` 已将「不一致」重新定性为「闭包未完成」（⚠️ 是**待办**，⛔ 不是**缺陷**） |

★ **逐字禁令**：⛔ 不得以「`files[]` 没有它 ⇒ 不受管」结案 —— 该形态在 owner 令中被**逐字点名**禁止。

> ⚠️ 边界：⛔ 本件**不主张**上游 `GEN1_LOCK_AUTHORITY_GATE_20261003.md` 的 `PENDING` 是错的 —— 上游**正确地**维持了 `PENDING`（它按 owner 令不得选边）。`LC-C` 是 **Owner 在上游三选一中作出的选择**，不是对上游的更正。

---

## §2 `C-2` —— Owner 选择 = `A+B`

### §2.1 Owner 裁定原文

```text
C2_OWNER_SELECTION = A+B
```

**组合含义（逐字沿用上游定义）**：

```text
A = 现有 timer 保持自动检测 / 状态写入（runGen1ShadowEod → computeLatchedState）
B = 新增最小 admin release route
```

⇒ `A+B` = **自动健康检测 / 状态机（A） + `adminGateway` release authority（B）**。

### §2.2 Owner 指定「必须保留」的要素（14 项 · 逐项对照落点）

| # | 要素 | 落点 | 实现形态（★ 设计 · ⛔ 未实施） |
|---|---|---|---|
| 1 | **server-side authority enforcement** | DOC2 §2.Q1 | 服务端 `require` `gen1-authority.js` 并**在 handler 内**判定 |
| 2 | **natural-person actor** | DOC2 §2.Q2 | 会话身份 + **显式 operator 声明**（⚠️ 现有鉴权为**单一共享密码**，无自然人绑定 ⇒ 见 §2.2 备注） |
| 3 | **approval** | DOC2 §2.Q3 | 服务端重算四项前置（⛔ 不接受请求体透传） |
| 4 | **8-field audit** | DOC2 §2.Q4 | 落权威落点（`docs/gen1/artifacts/**` + `gen1_health_state.reviewed_at/by`） |
| 5 | **prev state** | DOC2 §2.Q4 | `previous_state`（⛔ 现状无） |
| 6 | **new state** | DOC2 §2.Q4 | `new_state`（⛔ 现状无） |
| 7 | **reason** | DOC2 §2.Q4 | **枚举** `reason_code`（⛔ 现状无） |
| 8 | **evidence** | DOC2 §2.Q4 | `evidence_reference`（⛔ 现状无） |
| 9 | **correlation ID** | DOC2 §2.Q4 | 请求级 id（⛔ 现状无） |
| 10 | **anti-bypass** | DOC2 §2.Q9 / §2.Q11 | 鉴权中间件 + 服务端重算 + 服务端置位 + 冷却期 + 审计不可关闭 |
| 11 | **snapshot** | DOC2 §2.Q8 | **释放前必须先取快照**；⛔ 无 snapshot 不得释放 |
| 12 | **replay** | DOC2 §2.Q7 | 服务端重算 + 反事实断言 |
| 13 | **rollback** | DOC2 §2.Q8 | 服务端回写释放前快照 |
| 14 | **恢复 ≠ 升档** | DOC2 §2.Q6 | `gen1_authority` **保持 `CANARY`**；⛔ 不在本 route 内升档 |

**★ 备注（本轮新登记的诚实缺口 · ⛔ 不阻塞 A+B 选型，但必须在计划中显式标注）**：

| 项 | 内容 |
|---|---|
| 事实 | `adminGateway` 的鉴权 = 单一共享口令 `param_config.admin_password` ⇒ `verifyToken()` 只校验 token 值（`index.js:400-411`），**无用户名 / 无角色 / 无自然人字段** |
| ⇒ 后果 | 要素 2「natural-person actor」在**现有鉴权面**上只能做到「**声明的** operator 标识」，⛔ **不能**做到「**强身份验证的**自然人」 |
| ⇒ 处置 | 本件**如实登记**为 `GOV-GAP-ACTOR`（⚠️ 独立缺口，⛔ 不得与 `A+B` 实施混批、⛔ 不得作为不选 `A+B` 的理由） |

### §2.3 `P5` 是 `A+B` 的硬前置（Owner 明令 · 保持不变）

```text
P5 → A+B
```

| 依赖链 | 内容 |
|---|---|
| `A+B` 需要改 `cloudfunctions/adminGateway/index.js` | ⇒ 必须先回答「**从哪个 commit / source lineage 分叉**」 |
| 该答案 = `P5`（`ADMIN_GATEWAY_ALIGNMENT_ANCHOR = 8fc3ba66`） | 内容锚与线上逐字节一致（LF 归一 sha256 = `ea8cac72…c374`） |
| `P5` 自身前置 | master 上 `adminGateway` 的 **5 个 commit**（`f8c146b` / `cc52b7e` / `37b7241` / `0791459` / `19100fc`，997 → 1134 行）必须二元裁定 |
| 附加前置 | 包级 parity 复核（`P3` 门槛） |
| ⇒ | ⛔ `A+B` **不得**在任何上述前置完成前开始实现 |

### §2.4 `promote-*.js` 定性（Owner 明令 · 保持）

```text
C2_PROMOTE_SCRIPTS_CLASS = PRODUCTION_MUTATION_UTILITY
```

⛔ **不得**重新定义为 governance channel。上游六项证据（§2.2 of `GEN1_C3_C2_ARCHITECTURE_DECISION_20261003.md`）继续成立：无自然人 actor · 无 reason 枚举 · 无 evidence reference · 无 `prev_value` 且两脚本硬编码 `version: 1` · 不 require authority / 不查 `FROZEN_PARAM_KEYS` · 无 correlation id。

---

## §3 `P1–P5` —— Owner 采纳（治理执行准备）

### §3.0 两条轴必须分离（Owner 明令 · 本件第一硬约束）

```text
GOVERNANCE_RECORD        = YES
DEPLOYMENT_AUTHORIZATION = NO
```

⇒ 本条同时适用于 `P1` / `P2` / `P3` / `P5`：**采纳治理记录 ≠ 取得部署授权**。

### §3.1 逐项裁定

| ID | 裁定 | 形态（★ 计划 · ⛔ 未执行） | 逐字保持式 |
|---|---|---|---|
| **P1** | ✅ 允许**准备** `D-007` 补录 | 台账 `## 1.` 末尾**追加**一行；⛔ 不回改历史行；⛔ 不用 `supersedes` | **`D-007` 补录 ≠ 重新授权历史 deployment** |
| **P2** | ✅ 允许形成 `BASELINE_ACCEPTED` | 登记 `8fc3ba66` 为统一基线 + 10 函数线上对照；结论 `ACCEPTED_AS_IS`；显式写 `AUTHORIZATION = NOT_APPLICABLE (PRE_GOVERNANCE)` | **`BASELINE_ACCEPTED` ≠ `DEPLOYMENT_AUTHORIZATION`** |
| **P3** | ✅ 接受规则 `NEW_DEPLOYMENT = PACKAGE_LEVEL_PARITY_REQUIRED` | 新部署强制：`code download` + 逐文件 sha256 + 记 `CodeSha256` + 双记 `index_sha256_raw`/`index_sha256_lf` | ⛔ **不得**把 parity debt 自动升级成当前 deployment blocker |
| **P4** | ✅ 正式采纳 `MASTER_IS_NOT_THE_ONLY_AUTHORITY` | 权威源 = `REMOTE-VISIBLE REF ∧ EXPLICIT AUTHORIZATION BINDING`（D-1…D-4） | ⛔ `master` 仍为**仓库基线**，只是**不是授权来源** |
| **P5** | ✅ 正式采纳 `ADMIN_GATEWAY_ALIGNMENT_ANCHOR = 8fc3ba66` | 分叉起点 = 线上对齐内容锚；⛔ 不是 master HEAD | **`8fc3ba66` ≠ production deployment** · **`8fc3ba66` ≠ master HEAD** |

### §3.2 三条保持式 + 一条存量纪律

```text
PARITY_DEBT 保持为"债务"，⛔ 不阻塞当前任何事项（index.js 级 parity 已 10/10 成立）
P1_EXECUTED = NO    P2_EXECUTED = NO    P3_EXECUTED = NO
P4_EXECUTED = NO    P5_EXECUTED = NO
PACKAGE_LEVEL_PARITY = NOT_REVERIFIED（⛔ 仍成立）
LEDGER_HISTORY_MODIFIED = NO
```

---

## §4 `C3-R2` —— planning 授权 / implementation 未授权

### §4.1 授权边界（Owner 逐字）

```text
C3_R2_IMPLEMENTATION_PLANNING = AUTHORIZED
C3_R2_IMPLEMENTATION          = NOT_YET_AUTHORIZED
```

| 事项 | 状态 |
|---|---|
| 生成**精确 implementation plan**（文件 / 行级 owner / schema / lock / baseline / downstream / test / rollback / migration / evidence） | ✅ **已授权** ⇒ 落 DOC2 §1 |
| 修改 `src/common/utils/gen1-data-health.js` | ⛔ **未授权** |
| 修改 lock / manifest / authority / DB / `adminGateway` / production configuration | ⛔ **未授权** |

### §4.2 四项必须验证的判据（Owner 逐字 · 计划中必须成立）

```text
HARD_REQUIRED missing          →  DEGRADED
absent                         →  PIPELINE_MISSING
rs_20d                         →  BENCHMARK_MISSING
SEMANTICALLY_NULLABLE null     →  不得被误判为 pipeline missing
```

> ⚠️ 精确化（⛔ 不得放宽）：`HARD_REQUIRED missing` 指「**列存在、值 null/NaN**」⇒ `DATA_DEGRADED / STATISTICAL_MISSING`；`absent` 指「**列未生成（key 不存在）**」⇒ `DATA_BLOCKED / PIPELINE_MISSING`。二者是**不同判据**，⛔ 不得互相替代。

### §4.3 `LC-R2-1` 与 R2 的关系（★ 关键）

| 项 | 内容 |
|---|---|
| 上游状态 | `C3_IMPLEMENTATION = BLOCKED`（`LC-R2-1` 未解前） |
| 本轮变化 | `LC-R2-1` **已由 Owner 裁定为 `LC-C`** ⇒ 阻塞的**性质**已从「锁权威歧义」变为「**闭包与审批载体尚未落地**」 |
| ⇒ 因此 | ⛔ 本件**不**宣告该阻塞已解除（⛔ 不改 `C3_IMPLEMENTATION` 的取值）。R2 仍需：① 锁双层语义成文 ② closure 规则成文 ③ `gen1-data-health.js` 入绑定/审批闭环 ④ baseline 身份 ⑤ G1-B 影响 ⑥ `GOV-GAP-LOCK-APPROVAL` 裁定 |
| ⇒ | 上述六项**全部落在 `GOV-GAP-LOCK-APPROVAL` 与 lock governance 轨上**，属**独立 work item**（见 §5.1），⛔ 不得与 R2 代码变更混批 |

---

## §5 `GOV-GAP` —— 两个独立 work item 登记

> ⛔ Owner 明令：**不得偷偷并入 R2 或 C2**。二者各有独立 owner / dependency / surface / verification / rollback（详见 DOC2 §3）。

### §5.1 `GOV-GAP-LOCK-APPROVAL`

| 项 | 内容 |
|---|---|
| 缺口 | `ml/manifests/GEN1_FEATURE_PIPELINE_LOCK.json` **无任何审批字段**（无 `approved_by` / `approved_at` / `bindings_status`）⇒ 锁变更**无法在锁内留下自然人审批** |
| 同形先例 | `ml/manifests/GEN1_GUARDED_EFFECTIVE_FREEZE.json`（`approved_by` / `approved_at` / `bindings_status` / `change_rule`） |
| 为何独立 | 它是 `LC-C` 落地（closure + 绑定 + 审批三步）的第 ③ 步载体，⛔ 与 R2 的分类口径修正**无共同文件** |

### §5.2 `GOV-GAP-C`

| 项 | 内容 |
|---|---|
| 缺口 | `src/common/constants.js:61-74`（`FROZEN_PARAM_KEYS` 注释）声明 promotion 脚本「专门、**可审计**」，而三个 `promote-*.js` 实测 **0/6 审计要素** ⇒ 声明与实现落差 |
| 为何独立 | 缺口在 `constants.js` 注释 / `promote-*.js` 能力面，⛔ 与 R2 无关、⛔ 与 `A+B` 路由无关 |

### §5.3 本轮登记但 ⛔ 不处理的第三项（诚实登记）

| token | 内容 |
|---|---|
| `GOV-GAP-ACTOR` | `adminGateway` 鉴权为**单一共享口令** ⇒ `A+B` 的「natural-person actor」只能做到**声明式**（见 §2.2 备注）。⛔ 本件不裁定修法、⛔ 不改 `adminGateway` |

---

## §6 旧文档 `RETRACTED` —— documentation-only change 计划

### §6.1 目标（Owner 逐字）

把旧的「**`missing_features` 未落库**」标记为 **`RETRACTED`**，并**指向新的契约**：`C3_CONTRACT_DECISION = C3-A` + `R2`（分类口径）。

### §6.2 变更面（★ 计划 · ⛔ 本轮不执行）

| # | 文档 | 行 | 需撤回的旧表述 | 处置（沿用 `ERRATA-1` 先例） |
|---|---|---|---|---|
| 1 | `GEN1_PRE_LAUNCH_INVENTORY_20261002.md` | L448 | 「`515880` 具体缺失特征未定位（`missing_features` 未持久化）」/「`evaluateDataHealth()` 产出但未落库」 | 在勘误件追加 `ERRATA-2`，⛔ 不回改主件 |
| 2 | `GEN1_OWNER_DECISION_MATRIX_20261003.md` | L104 | C-3 行「`missing_features` 未持久化」 | 追加勘误指针 |
| 3 | `GEN1_OWNER_DECISION_MATRIX_20261003.md` | L195 | 第 1 问解答同句 | 追加勘误指针 |
| 4 | `GEN1_HEALTH_ATTESTATION_BLOCKER_DIAGNOSTIC_20261002.md` | L328 | `OBS-3`：「`missing_features` **未持久化**」 | 追加勘误；`OBS-3` 由 `OPEN` 改为 `RETRACTED（部分）` |

### §6.3 三条硬约束（`documentation-only`）

```text
DOC_CHANGE_TYPE             = DOCUMENTATION_ONLY
MAIN_DOC_BYTES_MODIFIED     = NO
APPEND_ONLY_ERRATA          = YES
RETRACT_TARGET_POINTS_TO    = C3-A_PLUS_R2
RETRACT_DOC_CHANGE_EXECUTED = NO
```

（上述 `MAIN_DOC_BYTES_MODIFIED = NO` 的含义：⛔ 不回改已 ACCEPT 主件字节；`RETRACT_DOC_CHANGE_EXECUTED = NO` 的含义：★ 计划 ≠ 执行。机制 = **append-only 追加勘误**，⛔ 不覆盖、⛔ 不重写主件。）

⛔ 本轮**只做计划**，⛔ 不落任何文档字节改动。

---

## §7 `v6_negative_scan.py` —— 保持现状 + 另立 harness maintenance item

```text
N_9A                      = EXISTING
N_10                      = EXISTING
V6_NEGATIVE_SCAN_MODIFIED = NO
HARNESS_MAINTENANCE_N9A_N10 = REGISTERED
```

| 项 | 内容 |
|---|---|
| 两项 FAIL | `N-9a` ← `scripts/gen1/evidence-capture/v6_pre_launch_inventory_check.py` 的**合成负控源串**；`N-10` ← `docs/gen1/GEN1_ENGINE_IDENTITY_RECONCILIATION_20261002.md:377` 的**枚举域自述行** |
| 本轮动作 | ⛔ **不修**（owner 明令）；⛔ 不改闸门文件 |
| 处置 | 另立 `HARNESS-MAINTENANCE-N9A-N10`（owner / dependency / surface / verification / rollback 见 DOC2 §5） |
| ⛔ 混批禁令 | ⛔ **禁止**与 production implementation 混批；⛔ 不得在本件或任何裁决材料里「顺手修」 |

---

## §8 下一阶段 dependency（正式冻结）

**Critical Path（Owner 给定 · ★ 逐字 · ⛔ 不得改变）**：

```text
LC-C
  ↓
LOCK GOVERNANCE
  ↓
C3-R2
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

**跨件前置（旁注 · ⛔ 不构成对上面 Critical Path 的修改）**：

```text
P5 → A+B
```

**★ 与上一版依赖图的差异（逐字登记）**：

| 项 | 上一版（`8e9a159`） | 本版 | 性质 |
|---|---|---|---|
| 首段 | `C3-γ` | `LC-C` → `LOCK GOVERNANCE` → `C3-R2` | ✅ **新增两跳**（`LC-C` 裁定 + 锁治理轨道），`C3-γ` 更名为 `C3-R2` |
| 其余 | `C-1 → … → E-5` | **逐字不变** | ⛔ 未增删、⛔ 未调序 |
| 旁注 | `P5 → A+B` | **逐字不变** | ⛔ 未变 |

```text
CRITICAL_PATH_CHANGED        = YES
CRITICAL_PATH_TAIL_CHANGED   = NO
CROSS_COMPONENT_PRECONDITION = P5_TO_A_PLUS_B
```

（上表 `CRITICAL_PATH_CHANGED = YES` 的范围**仅限首段前置扩展**；`CRITICAL_PATH_TAIL_CHANGED = NO` 表示其后的 `C-1 → … → E-5` **逐字未变**。）

**命名空间提示（沿用 `NS-4` / `NS-8`，★ 本轮新增 `NS-9`）**：

| NS | 撞名 | 说明 |
|---|---|---|
| `NS-4`（已有） | `D-1 … D-5` | 本图 `D-1/D-2/D-3` = **Evidence 轴节点**；⛔ 与架构决策轴编号**不同义** |
| `NS-8`（已有） | `R2` | ① `C3-R2` = 分类口径修正（工作项）；② `OWNER_MATRIX` 的 `R2` = **授权风险等级**（`R0…R4`）。⛔ 不同义 |
| `NS-9`（★ 本轮新增） | `LC-C` vs `C2` | `LC-C` = **锁双层模型裁定**（`LC-R2-1` 的取值）；⛔ 与 `C2`（release 架构决策编号）**字形相近但不同义** |

---

## §9 边界与 STOP

### §9.1 本轮硬边界（逐项实测）

```text
PRODUCTION_WRITE          = 0
DB_WRITE                  = 0
DEPLOY                    = NO
AUTHORITY_CHANGE          = NO
CANARY                    = OFF
EVIDENCE_EXECUTION        = NO
GE04                      = NO
IMPLEMENTATION_AUTHORIZED = NO
```

**⛔ 本轮未做**：未修改 production source；未修改 DB；未修改 lock（**含未修改 `GEN1_FEATURE_PIPELINE_LOCK.json`**）；未修改 authority；未修改 manifest；未修改 `FROZEN_PARAM_KEYS`；未部署；未推送；未合并；未打 tag；未 canary；未 release；未执行 Evidence Execution；未触 GE-04；⛔ **未修改 `v6_negative_scan.py`**。

### §9.2 当前仍未授权事项（逐项）

| # | 未授权事项 | 状态 |
|---|---|---|
| 1 | `C3-R2` 的**代码实施** | ⛔ `C3_R2_IMPLEMENTATION = NOT_YET_AUTHORIZED` |
| 2 | lock 双层语义 / closure 规则 / 绑定的**落地写入** | ⛔ 未授权（`GOV-GAP-LOCK-APPROVAL` 轨） |
| 3 | `A+B` 的**路由实现** | ⛔ 未授权（受 `P5` 硬前置 + `P5` 自身未决前置约束） |
| 4 | `P1…P5` 的**执行** | ⛔ 逐项 `P*_EXECUTED = NO` |
| 5 | `RETRACTED` 文档的**落盘写入** | ⛔ `RETRACT_DOC_CHANGE_EXECUTED = NO` |
| 6 | `GOV-GAP-LOCK-APPROVAL` / `GOV-GAP-C` / `GOV-GAP-ACTOR` 的**修复** | ⛔ 未授权（已登记） |
| 7 | `HARNESS-MAINTENANCE-N9A-N10` 的**修复** | ⛔ 未授权（已登记） |

### §9.3 下一步所需 Owner authorization（★ 最小放行集）

| 若 owner 想要 | 必须显式给出 |
|---|---|
| 开始 `R2` 代码实施 | `AGENT IMPLEMENTATION AUTHORIZED` **且**明确 `R2` 范围（含 lock governance 六项的前置状态） |
| 开始 `A+B` 实施 | `AGENT IMPLEMENTATION AUTHORIZED` **且**先完成 `P5` 二元裁定 + 包级 parity |
| 执行任一 `P` 项 | 逐项显式点名授权 |
| 落地 `RETRACTED` 指针 | 文档写操作授权（⛔ 不改已 ACCEPT 主件字节） |
| 修复 harness | 独立授权（⛔ 与 production 混批禁止） |

### §9.4 STOP 代码块

```text
LC_R2_1_DECISION                 = LC-C
LOCK_MODEL                       = TWO_LAYER
RULE_LAYER                       = BEHAVIOR_DOMAIN_AUTHORITY
FILES_LAYER                      = BYTE_BINDING_AUTHORITY
DEPENDENCY_CLOSURE               = REQUIRED
C2_OWNER_SELECTION               = A+B
C2_PROMOTE_SCRIPTS_CLASS         = PRODUCTION_MUTATION_UTILITY
P1                               = ADOPTED
P2                               = ADOPTED
P3                               = ADOPTED
P4                               = ADOPTED
P5                               = ADOPTED
GOVERNANCE_RECORD                = YES
DEPLOYMENT_AUTHORIZATION         = NO
P1_EXECUTED                      = NO
P2_EXECUTED                      = NO
P3_EXECUTED                      = NO
P4_EXECUTED                      = NO
P5_EXECUTED                      = NO
PACKAGE_LEVEL_PARITY             = NOT_REVERIFIED
LEDGER_HISTORY_MODIFIED          = NO
C3_R2_IMPLEMENTATION_PLANNING    = AUTHORIZED
C3_R2_IMPLEMENTATION             = NOT_YET_AUTHORIZED
C3_IMPLEMENTATION                = BLOCKED
N_9A                             = EXISTING
N_10                             = EXISTING
V6_NEGATIVE_SCAN_MODIFIED        = NO
HARNESS_MAINTENANCE_N9A_N10      = REGISTERED
DOC_CHANGE_TYPE                  = DOCUMENTATION_ONLY
MAIN_DOC_BYTES_MODIFIED          = NO
RETRACT_DOC_CHANGE_EXECUTED      = NO
CRITICAL_PATH_CHANGED            = YES
CRITICAL_PATH_TAIL_CHANGED       = NO
CROSS_COMPONENT_PRECONDITION     = P5_TO_A_PLUS_B
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

- `LC_R2_1_DECISION = LC-C` 的含义见 §1.2–§1.4；⛔ 不得读作「`files[]` 无关紧要」。
- `C2_OWNER_SELECTION = A+B` 是 Owner 的**显式选择**；⛔ 不得读作「`A+C` 不可行」。
- `GOVERNANCE_RECORD = YES` ∧ `DEPLOYMENT_AUTHORIZATION = NO` 是**两条轴**；⛔ 不得互推。
- `C3_R2_IMPLEMENTATION = NOT_YET_AUTHORIZED` 的完整含义 = 「plan 已授权，代码未授权」。
- `C3_IMPLEMENTATION = BLOCKED` **继续成立**（阻塞性质已由 §4.3 说明）。
- ★ **实施授权声明**：本件为 **Owner 裁定的登记 + planning 授权件**，**不构成实施授权**，也**不代表**已获授权。任何 implementation（含 lock 更新、`gen1-data-health.js` 修改、`adminGateway` 路由新增、`promote-*` 脚本、authority 变更、部署、release、Evidence Execution、GE-04）**必须先取得 owner 逐字放行口令**：

```text
AGENT IMPLEMENTATION AUTHORIZED
```

- ⛔ **收尾条件（逐字）**：除非 Owner 明确给出 `AGENT IMPLEMENTATION AUTHORIZED`，否则**绝对不得**进入 implementation。
