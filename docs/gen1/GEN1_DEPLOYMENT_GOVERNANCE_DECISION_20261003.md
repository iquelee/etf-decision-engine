# GEN1_DEPLOYMENT_GOVERNANCE_DECISION_20261003 —— 部署治理制度裁定（P1–P5）

> 生成时间：**2026-10-03**（GMT+8）· 轮次：`Architecture Decision`（**只读治理裁定轮 · ⛔ 不执行部署**）
> 上游：`ONLINE_DEPLOYMENT_PROVENANCE_20261003.md`（carrier commit `59a7cb1`）· 姊妹件：`GEN1_C3_C2_ARCHITECTURE_DECISION_20261003.md`
> 性质：⛔ **本件不构成实施授权**、⛔ **不代表已获授权**、⛔ **未部署任何函数**、⛔ 未修改台账历史行。
> ★ 「能实现」 ≠ 「已授权实现」。

---

## §0 方法与证据分级 + 上游

| 等级 | 含义 |
|---|---|
| `git-object` | `merge-base --is-ancestor` · `log -1` · `show <ref>:<path>` · `ls-remote`（上述子命令均以 `git` 前缀执行） |
| `git-tracked-check` | `git ls-tree -r --name-only <ref>` + `git check-ignore` ⇒ 判定「是否确在版本控制内」 |
| `online-codeinfo` | 2026-10-03 实时只读 `tcb fn detail --json` 的 `CodeInfo` |
| `online-meta` | 同一 `fn detail` 的元数据（`FunctionId` / `ModTime` / `CodeSize` / `Triggers`） |
| `governance-artifact` | `docs/production-deployment-ledger.md` · `refs/tags/**` · `src/common/constants.js` 的治理注释 |
| `NOT RE-READ` | 明确未在本轮重读 |

**上游件已确立、本件直接沿用的结论**（⛔ 不重复论证）：`CP-1`（10/10 可追溯到唯一 commit）· `CP-2`（无可追溯缺口）· `CP-4`（tag 作用域 = 1 个函数）· `CP-5`（`ref-0908` 是快照，⛔ 非来源）· `GAP-P1…P5`。

---

## §1 冻结事实（owner 指定 · 本轮逐项实测复核）

| 事实 | 值 | 本轮实测 | 证据 |
|---|---|---|---|
| `ONLINE_DEPLOYMENT` | `MIXED` | ✅ 一致（10 函数 `ModTime` 跨 09-08…09-30） | `online-meta` |
| `ADMIN_GATEWAY_BASELINE` | `8fc3ba66`（commit） | ✅ **逐字节证实**：`git show 8fc3ba66:cloudfunctions/adminGateway/index.js`（LF 归一）sha256 = `ea8cac727b0bc43ba9b93ebed23f15b8f56f4f045a7692e1bc571eb3a0b5c374` = 线上 `CodeInfo` sha256(LF) | `git-object` |
| `8fc3ba66` 与 master 关系 | — | ✅ **是 master 祖先**（`merge-base --is-ancestor` rc=0） | `git-object` |
| `d6692983`（`v3.6.5-frozen`）与 master 关系 | — | ⛔ **不是 master 祖先**（`merge-base --is-ancestor` rc=1） | `git-object` |
| `v3.6.5-frozen` 远端可见性 | — | ✅ `refs/tags/v3.6.5-frozen` = `43c0d7f9…`（tag 对象）/ `d6692983…`（commit） | `git ls-remote --tags` |
| `deliverables/**` 是否在版本控制内 | — | ⛔ **不在**：`.gitignore:23` = `deliverables/`；`git log --all --diff-filter=A -- '**/c021/**'` = 0 | `git-tracked-check` |

**★ 对上游 `GAP-P1` 表述的一处更正**（联动姊妹件 §3.3）：

| 上游写法 | 本件更正 | 依据 |
|---|---|---|
| 「09-30 部署仅存于 tag 注解 **+ `c021/**`**」 | 应更正为「**仅存于 tag 注解**」—— 因为 `c021/**` **不在任何 commit 内**（gitignored），**不构成仓库级事实源** | `git-tracked-check` |

⇒ ⚠️ 该更正使 `GAP-P1` 的**严重度上升**：V3.6.5 部署的**唯一**仓库级治理记录 = tag 注解本身。

---

## §2 `source-of-truth` 判定（★ owner 明令：⛔ 禁止「因为 master 是最新，所以直接选 master」）

### §2.1 反证：master 不可能是唯一权威源

| 步骤 | 内容 |
|---|---|
| 假设 | 「`origin/master` 是唯一的部署权威源」 |
| 事实 | `runDecisionEngine` 线上内容 = `d6692983`，而 **`d6692983` ∉ `origin/master` 祖先** |
| 后果 | 若假设成立 ⇒ 线上**当前正在运行的** `runDecisionEngine`（V3.6.5）**没有合法来源** ⇒ 与「它是在 `c021.2 §3` **owner 授权**下受控部署的」这一**并存事实**直接矛盾 |
| ⇒ | **假设不成立。`master` ⛔ 不是唯一部署权威源。** |

> ★ 该反证同时说明：**「最新」与「权威」是两个不同的谓词**。`master` 的 `adminGateway`（1134 行）比线上（997 行）**更新**，但它的那些变更**从未取得部署授权** ⇒ 越新越**不能**自动部署。

### §2.2 裁定：权威源的定义

```text
DEPLOYMENT_AUTHORITY_SOURCE = REMOTE-VISIBLE REF  ∧  EXPLICIT AUTHORIZATION BINDING
```

**准入四条件（全部成立才算「权威源」）**：

| # | 条件 | 判据 | 本轮对照 |
|---|---|---|---|
| **D-1** | **远端可见** | `git ls-remote <remote> <ref>` 可返回 | tag `v3.6.5-frozen` ✅；载体分支 `docs/gen1-evidence-contract-v5-20261002` 远端尖端仍 `7d2f39bd`（**本地领先 15 个提交未推送** ⇒ 其本地提交**不满足**本条件） |
| **D-2** | **显式授权绑定** | 存在可指认的 owner 授权记录，且**绑定到具体内容指纹** | `c021.2 §3` + tag 注解的 `base_head_sha` / `deployment_bundle_sha` ✅ |
| **D-3** | **不可变锚点** | 优先 **tag**；**branch ⛔ 不作为首选**（branch 会前移，同一 ref 名在不同时间指向不同内容） | tag `v3.6.5-frozen` 是**不可变**锚点 ✅ |
| **D-4** | **绑定指纹已记录** | commit + tree/blob sha（必要时 + bundle sha） | tag 注解含 `deployment_bundle_sha = e996e88a…`；`c021` 含 `APPROVAL_MANIFEST_SHA256` 等 ✅ |

### §2.3 三概念复述（⛔ 不可互换 · 沿用上游）

```text
ONLINE SOURCE     = 实测线上内容 + 其唯一可定位 Git 载体
EXPECTED SOURCE   = 由已生效治理声明推导出的「应在线上」；无声明 = UNSPECIFIED
AUTHORIZED SOURCE = 只能由 owner 给出的授权载体（= D-2 条件）
```

> ★ 本件**不新造**第四概念；`DEPLOYMENT_AUTHORITY_SOURCE` 是「`AUTHORIZED SOURCE` 的一个可判定化定义」，不是与之并列的新轴。

---

## §3 P1–P5 逐项裁定

> ⛔ 本轮**只做 governance decision，不执行部署**；下表所有「处置」均为**裁定文本**，⛔ 不代表已写入任何载体。

### §3.P1 · 是否补 `D-007` deployment record？

```text
P1_RULING = ADD_D007
```

| 项 | 裁定 |
|---|---|
| **结论** | ✅ **应补**。台账 §3 规范第 1 条是**已生效的规范**（「任何一次线上部署…必须在 `## 1.` 末尾追加一行 `D-xxx`」）⇒ 不补即造成**单一事实源分裂**（授权在 tag，台账却不完整） |
| **形态** | **追加**一行 `D-007`，⛔ **不回改**任何历史行；⛔ 不使用 `supersedes`（它不取代任何既有行，而是**补登记**） |
| **字段填充（依据上游 §2/§4.2）** | `deploy/mod_time` = `2026-09-30 13:38:07`（实测）· `source_repo_sha` = `d6692983…`（**已确证**，非「推定」：由 tag 注解 + 字节级 parity 双向锁定）· `package_sha256` = `e996e88a…`（来自 tag 注解 `deployment_bundle_sha`，口径须标注）· `index_sha256_lf` = `7e339fb2a9eeb87d…`（实测）· `source_parity` = `EXACT_MATCH (91 files)` |
| **边界** | ⛔ 补录**不等于**重新授权；`D-007` 只是把**既有授权**（`c021.2 §3` + tag）**登记**进台账 |
| **授权** | ⛔ **本件不执行该写入**（属文档写操作，须单独授权） |

### §3.P2 · 是否补「baseline accepted」declaration？

```text
P2_RULING = ADD_BASELINE_ACCEPTED_NOT_AUTHORIZATION
```

| 项 | 裁定 |
|---|---|
| **结论** | ✅ **应补**，但**形态必须是「接受记录」，⛔ 不是「授权记录」** |
| **理由** | 09-08 基线部署（`adminGateway` / `apiGateway` / `materializeIndicators` 等，`ModTime = 2026-09-08 11:32–11:35`）**早于本仓治理规范**，属 **pre-governance 既成事实**（对应 commit `8fc3ba66` 的语义即「把线上现状登记入库」）。事后签一份「授权」会使**授权时间与事实时间脱节** ⇒ 构成**倒填**风险 |
| **正确形态** | `BASELINE_ACCEPTED` 声明：登记 `8fc3ba66` 为**统一基线**、附 10 函数线上内容对照、结论 = `ACCEPTED_AS_IS`，并显式写明 `AUTHORIZATION = NOT_APPLICABLE (PRE_GOVERNANCE)` |
| **载体** | ★ 因属**治理裁定**（非 production 变更），其载体可以就是本件（`§3.P2`）；⛔ 不得写成「已获授权」 |
| **收益** | 消除「无授权记录」被误读为「违规部署」的歧义 —— 把**登记缺失**与**行为违规**分开 |

### §3.P3 · 是否建立 package-level parity requirement？

```text
P3_RULING = MANDATORY_FOR_NEW_DEPLOY_DEBT_FOR_LEGACY
```

| 项 | 裁定 |
|---|---|
| **结论** | ✅ **建立为常设门槛，但区分「新部署 = 强制」与「存量 = 债务」** |
| **新部署门槛（强制）** | 任何**新增 / 变更**部署，部署前必须完成：① `tcb fn code download` 下载实际包；② 解压逐文件 sha256 与仓库源码对账；③ 记录 `CodeSha256`（包级）；④ 记录 `index_sha256_raw` **与** `index_sha256_lf`（⭐ 二者**不可互比**，见台账 §0） |
| **存量对账（债务）** | 其余 9 个函数的线上包 SHA 历史未对账（台账 `E-002` 自认）⇒ 记为 `PARITY_DEBT`，⛔ **不阻塞**当前任何事项（因其 `index.js` 级 parity 已 10/10 成立） |
| **字段不可得说明** | `fn detail --json` **不返回** `CodeSha256`（上游 §3 实测）⇒ 新门槛必须走**下载通道**，不能只看 `fn detail` |
| **授权** | ⛔ 本件**不执行**任何下载 / 复算（`PACKAGE_LEVEL_PARITY = NOT_REVERIFIED` 继续成立） |

### §3.P4 · 是否规定 `master` = 唯一 deployment authority source？

```text
P4_RULING = MASTER_IS_NOT_THE_ONLY_AUTHORITY
```

| 项 | 裁定 |
|---|---|
| **结论** | ⛔ **不规定**。`master` **不是**唯一部署权威源（反证见 §2.1） |
| **谁是（owner 要求的「明确谁是」）** | **`REMOTE-VISIBLE REF`（**tag 优先于 branch**）+ 显式授权绑定**（见 §2.2 的 D-1…D-4） |
| **为何不是 master** | ① master 上的 `adminGateway` / `apiGateway` / `runGen2ShadowEod` 内容**从未取得部署授权** ⇒ 若以 master 为权威，等于**默认授权未授权内容**；② master 分支**会前移** ⇒ 同一 ref 名在不同时刻指向不同内容，**不构成稳定锚点** |
| **为何不是「任意分支」** | 若放开到任意 branch，则「本地领先但未推送」的提交（如载体分支本地 `59a7cb1` vs 其远端 `7d2f39bd`）会被误认为权威 ⇒ 必须用 **D-1（远端可见）** 卡住 |
| **配套要求（★ 新增）** | 未来 Gen-1 部署一律以 **tag（不可变）为锚**；若确实需要以 branch 为源，必须**同时记录该 branch 当次的 commit sha**（⛔ 不得只写 branch 名） |
| **边界** | ⛔ 本裁定**不改变**任何函数的当前线上内容；⛔ **不主张**任何函数「应该」被升到任何新版本 |

### §3.P5 · `adminGateway` 应从哪个 commit / source lineage 分叉？

```text
P5_RULING = FORK_FROM_ONLINE_PARITY_ANCHORED_COMMIT
```

**已证明的事实（★ 先证明，再裁定）**：

| 事实 | 证据 |
|---|---|
| 线上 `adminGateway`（997 行）**与 `8fc3ba66` 版本逐字节一致** | `git show 8fc3ba66:cloudfunctions/adminGateway/index.js`（LF 归一）sha256 = `ea8cac72…c374` ≡ 线上 `CodeInfo` sha256(LF) |
| `8fc3ba66` **是 master 祖先**（本仓首个 commit） | `merge-base --is-ancestor` rc=0 |
| `master` 上 `adminGateway` 已前进：**5 个 commit**，997 → 1134 行 | `git log --oneline 8fc3ba66..origin/master -- cloudfunctions/adminGateway/index.js`（`f8c146b` / `cc52b7e` / `37b7241` / `0791459` / `19100fc`） |
| 该 5 个 commit 的变更**从未部署、从未授权** | 上游 §5.1 `E-2` + 无任何授权记录 |

| 项 | 裁定 |
|---|---|
| **结论** | ★ **分叉起点 = 「线上内容对齐提交」**，其内容锚定 **`8fc3ba66`**；⛔ **不是** `origin/master` HEAD（`44c111e9`，1134 行） |
| **为何不是 master HEAD** | 从 master HEAD 分叉 ⇒ 交付包会**顺带携带 5 个 commit / +137 行的从未授权变更** ⇒ 违反「最小变更 + 显式授权」⇒ 与 fail-closed 原则冲突 |
| **为何也不能「直接在 `8fc3ba66` 上分叉」** | `8fc3ba66` 是**首个 commit**；直接在其上开分支会把**其余全部文件**回退到 09-08 代内容 ⇒ **不可行**（会丢失 09-08 之后的全部演进） |
| **正确实现形态（⛔ 未实施）** | 以 **master 为仓库基线**，但把 **`cloudfunctions/adminGateway/index.js` 单文件还原为线上内容**（等价于 `git show 8fc3ba66:cloudfunctions/adminGateway/index.js`）作为**起点提交** ⇒ 使「交付包内 `adminGateway` 与线上**逐字节一致**（diff-to-online = 0）」⇒ 则新增的 release 路由成为**唯一差异** |
| **★ 前置（必须先裁定，属 owner）** | master 上那 5 个 commit 对 `adminGateway` 的变更必须做**二元裁定**：✅ **显式授权部署** 或 ⛔ **显式声明 `NOT AUTHORIZED / DO NOT DEPLOY`**。⛔ 在未裁定前**不得**分叉，也**不得**把 1134 行内容当作「更正确」 |
| **★ 附加前置（来自 `GAP-P3`）** | 分叉前须先完成 `adminGateway` 的**包级 parity** 复核（§3.P3），否则「逐字节一致」只能在 `index.js` 级成立 |
| **边界** | ⛔ 本裁定**不修改部署**、⛔ 不建分支、⛔ 不还原文件、⛔ 不新增路由 |

---

## §4 与 C-2 的交界（★ 跨件耦合，必须显式登记）

| 交界点 | 内容 |
|---|---|
| **P5 → C-2 `A+B`** | 若 owner 选择 `A+B`（新增最小 admin release route），则 **`P5` 的分叉裁定是其硬前置**（否则「从哪个提交改 `adminGateway`」无解） |
| **P5 前置 → 授权** | 且 `P5` 自身有一个**未决前置**（master 上 5 个 commit 的二元裁定）⇒ `A+B` 的**最早可行时点**受此约束 |
| **§2.2 D-3 → C-2** | 若未来 Gen-1 相关代码需部署，按 `P4` 应优先以 **tag 为锚**（而非 branch HEAD） |
| **审计落点 → C-2 `A+B`** | 姊妹件 §3.5：`A+B` 需追加**只读导出**才能满足 `AUDIT_CARRIER_LOCUS` |
| **⛔ 反向约束** | 本件**不**因此对 `A+B` / `A+C` 做排名或选型（⛔ 选型留 owner） |

---

## §5 边界与 STOP

**本 Gate 实测零动作**：`PRODUCTION_WRITE = 0` · `DB_WRITE = 0` · `DEPLOY = NO` · `AUTHORITY_CHANGE = NO` · `CANARY = OFF` · `EVIDENCE_EXECUTION = NO` · `GE04 = NO`

**⛔ 边界声明**：
- ⛔ 未部署 / 未回滚 / 未打 tag / ⛔ 未推送到远端 / ⛔ 未合并；
- ⛔ 未改任何云函数 / config / DB 行 / manifest / lock / authority；
- ⛔ **未改部署台账的任何历史行**；⛔ **未写入 `D-007`**（`P1` 裁定 ≠ 已执行）；
- ⛔ 未下载任何函数包（`PACKAGE_LEVEL_PARITY = NOT_REVERIFIED` 继续成立）；
- ⛔ 未建分支 / 未还原 `adminGateway` 文件。

```text
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
ONLINE_DEPLOYMENT           = MIXED
DEPLOYMENT_AUTHORITY_SOURCE = REMOTE_VISIBLE_REF_PLUS_AUTHORIZATION
MASTER_IS_ONLY_AUTHORITY    = NO
PACKAGE_LEVEL_PARITY        = NOT_REVERIFIED
LEDGER_HISTORY_MODIFIED     = NO
IMPLEMENTATION_AUTHORIZED   = NO
PRODUCTION_WRITE            = 0
DB_WRITE                    = 0
DEPLOY                      = NO
AUTHORITY_CHANGE            = NO
CANARY                      = OFF
EVIDENCE_EXECUTION          = NO
GE04                        = NO
STOP                        = YES
```

**说明（在代码块之外，⛔ 不并入 STOP 字段域）**：
- `P1_EXECUTED … P5_EXECUTED = NO` 强调 **裁定 ≠ 执行**：本件只产出治理决定，⛔ 未写入台账、未下载包、未建分支、未还原文件。
- `DEPLOYMENT_AUTHORITY_SOURCE = REMOTE_VISIBLE_REF_PLUS_AUTHORIZATION` 的完整定义见 §2.2（D-1…D-4 四条件）；此处用单 token 以保持机器可断言。
- `MASTER_IS_ONLY_AUTHORITY = NO` 的反证见 §2.1；⛔ 不得读作「master 不重要」—— master 仍是**仓库基线**，只是**不是授权来源**。
