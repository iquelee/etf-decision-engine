# ONLINE_DEPLOYMENT_PROVENANCE_20261003 — 线上部署溯源 / 来源权威澄清

> 生成时间：**2026-10-03**（GMT+8）· Gate：`Owner Decision D-1…D-5` 收口轮
> 性质：**只读审计件**。⛔ 本件**不构成实施授权**，⛔ 不代表任何部署计划、⛔ 未修改任何 production 对象。
> 上游件：`GEN1_C3_C2_PREFLIGHT_20261003.md`（carrier commit `16f90c2`）§16 `B-1`
> 本件把 `B-1` 由「待进入下一阶段的普通 Gap」**提升为** `Deployment Provenance / Source-of-Truth clarification`。

---

## §0 方法与证据分级

| 等级 | 含义 | 本件用途 |
|---|---|---|
| `online-codeinfo` | 2026-10-03 **实时只读** `tcb fn detail <fn> -e <env> --json` 的 `CodeInfo`（= 线上 `index.js` 全文） | 线上内容与指纹 |
| `online-meta` | 同一 `fn detail` 的元数据字段（`FunctionId` / `ModTime` / `CodeSize` / `Runtime` / `Handler` / `Triggers`） | 部署时点与身份 |
| `git-object` | `git log --all --find-object=<blob>` + 逐 commit `show` 对拍（内容 sha256 归 LF） | 把线上内容锚定到 commit |
| `repo-ref` | `git show <ref>:<path>` 逐 ref 对拍 | 漂移方向 |
| `governance-artifact` | `docs/production-deployment-ledger.md` · `deliverables/v365-production-history/c021/**` · `docs/主链冻结契约.md` · `refs/tags/**` | 期望值与授权 |
| `NOT RE-READ` | 明确声明未在本轮重读 | 残留 |

**指纹口径（★ 必须声明）**：本件所有「内容 sha256」= **LF 归一化后**（`CRLF→LF`）的 `sha256`，与本地 `.gitattributes`/`core.autocrlf` 无关；行数 = `\n` 计数。⛔ 与台账中的 `raw`（含 CRLF）口径**不同**，不可混比。

**线上函数总数（实时只读实测）= 10**；本件**覆盖 10/10**。

### §0.1 owner 9 项要求 → 本文位置（可机器断言）

| # | owner 要求 | 本文位置 |
|---|---|---|
| 1 | 每个线上函数的实际来源 | §2.1 表 `online source` 列 |
| 2 | SHA256 / fingerprint | §2.1 表 + §2.1 完整 sha256 代码块 |
| 3 | 对应本地 artifact | §2.2 |
| 4 | 对应 Git commit（如能建立） | §2.1 `online source` 列 + §3 |
| 5 | 是否属于 frozen baseline | §2.1 `@tag` 列 + §4.2 |
| 6 | 是否属于 audit snapshot | §2.3（`ref-0908` 定性） |
| 7 | 是否存在无法追溯来源的部分 | §3 |
| 8 | 哪些差异是预期的 | §5.1 |
| 9 | 哪些差异属于治理缺口 | §5.2 |

---

## §1 结论摘要

| # | 结论 | 证据 |
|---|---|---|
| CP-1 | ✅ **10/10 云函数的线上 `index.js` 均可追溯到「唯一一个」Git commit**（每个函数的 `exact_commit_count = 1`） | §2 表 = `git-object` |
| CP-2 | ✅ **不存在「无法追溯来源」的函数** | §3 |
| CP-3 | ★ **线上部署的身份不是「一次全量部署」**：`runDecisionEngine` 绑定 `v3.6.5-frozen`（09-30）；其余 9 个函数的线上内容**均早于**该 tag（最新 09-10），其内容**不被该 tag 覆盖** | §2 / §4 |
| CP-4 | ★ **`v3.6.5-frozen` tag 注解只声明了 1 个函数**（`function = runDecisionEngine`，`FunctionId = lam-eiye285p`）⇒ 对另外 9 个函数 **不存在「期望源」声明** ⇒ 它们**不是「漂移」，而是「未被任何声明覆盖」** | §2 / §4 / §5 |
| CP-5 | ⛔ **前件 §17 `D-4` 的建议（「采用线上对齐源 `_v365-audit-20260930/ref-0908`」）在本件中更正**：`ref-0908` 是**快照拷贝目录（不在任何 Git 仓库内）**，**不是来源**；其内容权威来源 = commit **`8fc3ba66`**（master 祖先） | §2.3 / §4.2 |
| CP-6 | ⚠️ **2 处治理缺口**（台账未记录 09-30 部署；09-08 基线部署无授权记录）+ **1 处字段级不可得**（`CodeSha256` 不可读 ⇒ 包级 parity 未复核） | §5 |
| CP-7 | ⛔ 本件**不修改部署**、⛔ 不主张任何函数「应该」被部署到任何新版本 | §7 |

---

## §2 逐函数溯源（10/10）

### §2.1 主表

> `ONLINE` 列 = 2026-10-03 实时只读内容；`EXACT` = 逐字节（LF 归一化）一致。
> `@master` = `origin/master` HEAD（`e015aaaf`）；`@tag` = `v3.6.5-frozen^{}`（`d6692983`）。

| # | component | FunctionId | online ModTime | online 行数 | online sha256(LF)（前 16） | **online source（唯一 Git 载体）** | commit 日期 | master 祖先? | @master | @tag |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `runDecisionEngine` | `lam-eiye285p` | **2026-09-30 13:38:07** | 1737 | `7e339fb2a9eeb87d` | **tag `v3.6.5-frozen` → `d6692983`** | 2026-09-30 | **NO** | differs（`77f7d500` / 1377 行） | **EXACT** |
| 2 | `runGen1ShadowEod` | `lam-9mab98b1` | 2026-09-10 16:07:20 | 273 | `485244e4f79931b5` | `aaeb5cb0` | 2026-09-10 | YES | **EXACT** | **EXACT** |
| 3 | `adminGateway` | `lam-09ya1rgt` | 2026-09-08 11:32:23 | 997 | `ea8cac727b0bc43b` | `8fc3ba66` | 2026-09-08 | YES | differs（`44c111e9` / 1134 行） | differs |
| 4 | `apiGateway` | `lam-qp5d17xj` | 2026-09-08 11:32:53 | 967 | `8b2103455d0d83c8` | `8fc3ba66` | 2026-09-08 | YES | differs（`5342e92d` / 1024 行） | differs |
| 5 | `materializeIndicators` | `lam-g2m7cvwv` | 2026-09-08 11:35:24 | 136 | `3f9b3e69c38e4676` | `8fc3ba66` | 2026-09-08 | YES | **EXACT** | differs |
| 6 | `runGen2ShadowEod` | `lam-c55pxk3r` | 2026-09-08 11:30:54 | 1263 | `6b47809d104887a4` | `8fc3ba66` | 2026-09-08 | YES | differs（`cb9a91b7` / 2402 行） | differs |
| 7 | `extractFundamental` | `lam-1lidd08z` | 2026-09-09 10:22:40 | 570 | `b944b0918f836107` | `8fc3ba66` | 2026-09-08 | YES | **EXACT** | **EXACT** |
| 8 | `fetchDailyData` | `lam-ovdh2fhd` | 2026-09-10 14:27:12 | 459 | `7c547a1380018b59` | `c0e29b06` | 2026-09-10 | YES | **EXACT** | **EXACT** |
| 9 | `fetchFundamentalNews` | `lam-2xod5ulp` | 2026-09-08 11:34:24 | 687 | `06c045a400ad943d` | `8fc3ba66` | 2026-09-08 | YES | **EXACT** | **EXACT** |
| 10 | `fetchRealtimeData` | `lam-mcjdfvnr` | 2026-09-08 11:34:52 | 81 | `c089404c0ba58f10` | `8fc3ba66` | 2026-09-08 | YES | **EXACT** | **EXACT** |

**完整 sha256（LF）**（`online-codeinfo` 实算，用于跨轮比对）：

```text
runDecisionEngine      7e339fb2a9eeb87d857d8a30205df5e1d4c67c65049f6a28c871066c7281d84c
runGen1ShadowEod       485244e4f79931b5f07c5216d83e6ce36f5ebb9112194d63a0f910e90eec33d7
adminGateway           ea8cac727b0bc43ba9b93ebed23f15b8f56f4f045a7692e1bc571eb3a0b5c374
apiGateway             8b2103455d0d83c8d3130d95631776cfdc0e79de0fbae3de8e3c986f49650322
materializeIndicators  3f9b3e69c38e4676627f8be760cfafa9887fd9d601330ed334a88e1185aafa89
runGen2ShadowEod       6b47809d104887a49efb68e747860eda0d43a9b202d59398a02816efa33bcc37
extractFundamental     b944b0918f836107e4445312d38f33a67f4bb8a0ab8a14c9d7eabebf3bfef1d8
fetchDailyData         7c547a1380018b59080137f2bb740fdb3e2679fda7afc169c790d7bf63b9a23d
fetchFundamentalNews   06c045a400ad943d70f77a65bd0c1e6db09e59a312ab69402aa3a535acc992f9
fetchRealtimeData      c089404c0ba58f10c9d69dd0498613dc20feb89b3ec1678fff2a17124c63d578
```

### §2.2 「本地 artifact」映射（`repo-src` 实算命中）

| component | 本地命中路径（示例，非穷举） |
|---|---|
| `runDecisionEngine` | `_v365-frozen-baseline/cloudfunctions/runDecisionEngine/index.js` · `_v365-frozen-baseline/dist-functions/runDecisionEngine/index.js` · `_v365-deploy/postcheck-download/functions/runDecisionEngine/index.js`（★ 部署后下载核验快照） · `etf-decision-engine/dist-functions/runDecisionEngine/index.js` · `_v365-audit-20260930/ref|ref-v365/cloudfunctions/runDecisionEngine/index.js` |
| `runGen1ShadowEod` | 21 个 worktree 内均为同一内容（`cloudfunctions/…` + `dist-functions/…`）；含 `_g1-contract-v5-20261002`（载体树）、`_v365-frozen-baseline`、`etf-decision-engine-gen1` |
| `adminGateway` | **唯一**：`_v365-audit-20260930/ref-0908/cloudfunctions/adminGateway/index.js`（⛔ 仓库外快照目录） |
| `apiGateway` | `_v365-audit-20260930/ref-0908/cloudfunctions/apiGateway/index.js` · `cloud-audit-20260907/online-source(-lean)/functions/apiGateway/index.js` |
| `materializeIndicators` | 19 个 worktree；含 `_g1-contract-v5-20261002`（= master HEAD 同内容） |
| `runGen2ShadowEod` / `extractFundamental` / `fetchDailyData` / `fetchFundamentalNews` / `fetchRealtimeData` | 各 worktree 内同名路径（`8fc3ba6` 基线内容） |

### §2.3 ★ 关于 `_v365-audit-20260930/ref-0908` 的定性（更正前件）

- `ref-0908` 是 **2026-09-30 审计期间从线上下载/导出的离线快照目录**，位于仓库根 `D:\AI-Projects\Codex\etf-decision-engine\_v365-audit-20260930\`，**在项目 Git 仓库之外**（项目仓库根 = `…/etf-decision-engine/etf-decision-engine/`，common dir = `…/etf-decision-engine/etf-decision-engine/.git`）。
- ⇒ 它是 **artifact 副本**，**不是 authority**。把 `ref-0908` 当「基线」会导致**用拷贝冒充来源**（违反「证据必须对准权威源」）。
- ✅ 权威来源 = commit **`8fc3ba66da6cb99b9da22b8933d59d582ddb8982`**（2026-09-08 10:59:17 `chore: 建立线上系统统一基线（V3.6.1 + Gen-1 + Gen-2）`，= **本仓首个 commit**，master 祖先）。
- 同族目录 `ref/` `ref-v365/` `ref-v364/` 与 `_v365-deploy/postcheck-download/` 亦为快照性质。

---

## §3 是否存在「无法追溯来源」的部分

| 问题 | 结论 | 依据 |
|---|---|---|
| 10 个函数的 `index.js` 能否定位到 Git commit | ✅ **10/10 可**，且每个**恰有 1 个**「最近逐字节一致」的 commit | `--find-object` + 逐 commit `show` 对拍 |
| 是否存在既不在任何 ref 当前态、又不在任何 commit 历史中的内容 | ⛔ **不存在** | 10/10 的 `latest_exact_commit` 均非空，且均为 master 祖先或已推送 tag 的对象 |
| `runDecisionEngine` 的线上内容是否 remote-visible | ✅ 是：`git ls-remote --tags origin` → `refs/tags/v3.6.5-frozen` = `43c0d7f9…`（tag 对象）/ `d6692983…`（commit），**已在远端** | `git ls-remote` |
| **包级（zip）sha 是否已复核** | ⚠️ **未复核**：`fn detail --json` **不返回** `CodeSha256`（本轮实测：该字段不在返回键集中）⇒ 需 `tcb fn code download` 才能复算（C-021 先例已用过该通道，`package_download.ok=true`）。**本件未执行**（避免超出本轮动作面） | §5 `GAP-P3` |
| 非常驻部分（hosting 前端 / 数据库索引 / 环境变量） | ⚠️ **本轮 out-of-scope, NOT RE-READ**（本件只覆盖「云函数代码身份」这一轴） | — |

---

## §4 三概念分离：ONLINE / EXPECTED / AUTHORIZED SOURCE

### §4.1 定义（⛔ 三者不可互换）

| 概念 | 定义 | 判定依据 |
|---|---|---|
| **ONLINE SOURCE** | **实测**线上内容，及其唯一可定位的 Git 载体（commit / tag） | `online-codeinfo` + `git-object` |
| **REPOSITORY SOURCE** | 各 ref（`origin/master` / 载体分支 / tag）**当前**持有内容 | `repo-ref` |
| **EXPECTED SOURCE** | 由**已生效的治理声明**推导出的「应当在线上的内容」。声明来源只有两类：① 冻结 tag 注解中的**显式绑定**；② 台账中**已授权的部署记录** | `governance-artifact` |
| **AUTHORIZATION** | 该线上内容背后是否存在**可指认的 owner 授权记录** | `governance-artifact` |

> ★ **关键判据**：**「与 master 不一致」不自动等于「漂移」**。只有当存在 EXPECTED SOURCE 声明时才构成漂移。否则应记为 **`UNSPECIFIED`（未被任何声明覆盖）**——这是**登记事项**，不是**缺陷**。

### §4.2 `v3.6.5-frozen` tag 注解 = 唯一的「期望源」声明（且作用域 = 1 个函数）

tag `v3.6.5-frozen` 注解（`git tag -l v3.6.5-frozen -n99` 实读）逐字包含：

```text
CloudBase production binding
  env                     = tradingview-etf-d0fa42yy57cbc11b
  function                = runDecisionEngine
  FunctionId              = lam-eiye285p
  Runtime / Handler       = Nodejs16.13 / index.main
  deployment_bundle_sha   = e996e88ae8084a38e186471b561867267fc4280c3ea5758ccb0eff75092455a4
  deployed_at             = 2026-09-30T05:38:13Z
  ModTime                 = 2026-09-30 13:38:07
  CodeSize                = 4465434
  ONLINE_SOURCE_PARITY    = EXACT_MATCH   (91 files, 0 missing / 0 unexpected / 0 content-diff)
  DEPLOYMENT_IDENTITY_VERIFIED = true
Governance
  base_head_sha           = c6bd006fd76ffc5358cddd07347df8ed23d9e61d
  authorization           = CONTROLLED DEPLOYMENT (owner-granted, C-021.2 §3, five-tuple bound)
  change scope            = AUTHORIZATION_SCOPE_RATIFIED_BY_OWNER (85 files, C-021.2 §1)
```

**逐项与本轮实测交叉验证**：

| tag 声明 | 本轮实测（2026-10-03） | 一致? |
|---|---|---|
| `function = runDecisionEngine` / `FunctionId = lam-eiye285p` | `lam-eiye285p` | ✅ |
| `ModTime = 2026-09-30 13:38:07` | `2026-09-30 13:38:07` | ✅ **逐字一致 ⇒ 自 09-30 起未再部署** |
| `CodeSize = 4465434` | `4465434` | ✅ |
| `Runtime/Handler = Nodejs16.13 / index.main` | 同 | ✅ |

⇒ **结论**：tag 只绑定 `runDecisionEngine`；**未声明**任何「所有函数应同版本」的口径。因此 §2 表 3–10 行的 `@tag = differs` **不是漂移**，而是 **tag 作用域外**。

### §4.3 授权记录（`AUTHORIZATION`）

| 通道 | 内容 | 覆盖函数 |
|---|---|---|
| ✅ `deliverables/v365-production-history/c021/`（18 件 JSON + bundle + rollback） | `authorization-ratification.json`：`phase C-021.2` · `owner_message = §1 Owner Ratification + §3 CONTROLLED DEPLOYMENT AUTHORIZATION = GRANTED` · `base_head_sha c6bd006f…` · `changed_files_count 85` · `AUTHORIZATION_SCOPE_RATIFIED_BY_OWNER = true` · `APPROVAL_MANIFEST_SHA256 a972cb91…` | **仅 `runDecisionEngine`** |
| ✅ `c021/deployment-scope.json` | `function = runDecisionEngine`；`deploy_source = dist-functions/runDecisionEngine/`；closure = 2 own + 87 `src/common` + `ml/manifests` | 仅 `runDecisionEngine` |
| ✅ `c021/post-deploy-boundary-verification.json` | `ModTime/CodeSize` 与部署时逐位一致；`deploy_count = 1`；五集合全 0；`BOUNDARY_RESPECTED = true` | 仅 `runDecisionEngine` |
| ⚠️ `docs/production-deployment-ledger.md` | 末条 = **`D-006`（2026-09-23）**；§3 规范第 1 条：「任何一次线上部署（无论谁执行）都必须在 `## 1.` 末尾追加一行 `D-xxx`」 | **无 09-30 行、无 09-08 行** ⇒ §5 `GAP-P1`/`GAP-P2` |
| ⛔ 其余 9 个函数 | **无专项授权记录**（属 09-08「统一基线」既成事实） | `UNSPECIFIED` |

---

## §5 差异分类与治理缺口

### §5.1 期望差异（EXPECTED — 无需处置）

| # | 现象 | 为何是预期的 |
|---|---|---|
| E-1 | `runDecisionEngine`：@master = `differs`（`77f7d500`，1377 行） | V3.6.5 分支**未合并 master**（`d6692983` ∉ master 祖先）；线上领先 master 属**既定事实**。★ 交叉印证：`77f7d500` **正是**台账 `E-003` 记录的 V3.6.4 `index_sha256_lf` ⇒ master 仍持 V3.6.4 代内容 |
| E-2 | `adminGateway`/`apiGateway`/`runGen2ShadowEod`：@master = `differs`（master 更新） | master 上的新内容**从未取得部署授权** ⇒ 停留在旧内容 = **符合 fail-closed**（未授权即不部署） |
| E-3 | `materializeIndicators`/`extractFundamental`/`fetchDailyData`/`fetchFundamentalNews`/`fetchRealtimeData`：@master = `EXACT` | 零漂移 |
| E-4 | `runGen1ShadowEod`：@master = @tag = `EXACT` | 内容自 09-10 未变；**来源不可区分**但**无害**（任一解释都得到同一线上内容） |
| E-5 | 9 个函数的 `ModTime ∈ [09-08, 09-10]` 全部早于 `rde` 的 09-30 | 部署**按需进行**（只部署变化项），非全量发布 ⇒ 「混合 ModTime」本身是常态 |

### §5.2 治理缺口（GOVERNANCE GAP — 需 owner 裁定）

| # | 缺口 | 事实 | 影响 | 建议（**不实施**） |
|---|---|---|---|---|
| **GAP-P1** | **部署台账缺 09-30 V3.6.5 行** | 台账 §3.1 要求「任何部署必须追加 `D-xxx`」，但末条为 `D-006`(09-23)；09-30 部署仅存于 tag 注解 + `c021/**` | ⚠️ **单一事实源分裂**：授权在两处（tag + c021），台账却不完整 ⇒ 以台账为唯一入口的读者会得到错误结论 | 由 owner 决定：补 `D-007`（引用 `c021` 哈希，不改历史行），或显式声明「台账自 D-006 起由 `c021/**` 接续」 |
| **GAP-P2** | **09-08 基线部署无授权记录** | `adminGateway`/`apiGateway`/`materializeIndicators`(+`fetchRealtimeData` 等) `ModTime = 2026-09-08 11:32–11:35`；对应内容 = 本仓**首个 commit** `8fc3ba66`(09-08 10:59) | ⚠️ 属 **pre-governance 既成事实**（该 commit 语义即「把线上现状登记入库」）⇒ **不构成违规**，但**缺一份「基线接受」声明** | 由 owner 决定是否出具「统一基线接受记录」（只读补记，不改内容） |
| **GAP-P3** | **包级 parity 未复核** | `fn detail --json` 不返回 `CodeSha256`；台账 `E-002` 自认「其余 9 个函数线上包 SHA 未重新对账」 | ⚠️ 目前只能证明 **`index.js` 级** parity；闭包内其它文件（`src/common/**` 等）**未逐文件对账** | 单独立项：`tcb fn code download` 逐函数下载 + 重算（只读；需动作授权） |
| **GAP-P4** | **`v3.6.5-frozen` 内容不在 `origin/master` 可达** | tag 已推送（remote-visible ✅），但 `d6692983` ∉ `origin/master` 祖先 | ⚠️ 「remote-visible」满足；「master 权威」不满足 ⇒ 部署门禁中「REMOTE-VISIBLE+AUDITED+AUTHORIZED」三条件的**第 1 条成立、第 2/3 条需按 tag 路径解释** | 由 owner 裁定：master 是否为唯一部署权威源（若是，V3.6.5 需经合并；若否，须写死「tag 亦可作授权载体」） |
| **GAP-P5** | **`adminGateway` 无「线上对齐提交」** | 097-行版内容仅存在于 `8fc3ba66` 的历史中；master 已前进 155 行差异 | ⚠️ 未来若要改 `adminGateway`（如 C-2 release 端点），**起点不是 master HEAD** ⇒ 必须先裁定「从哪个提交分叉」 | 与 §6 的 `EXPECTED SOURCE` 裁定合并处理 |

---

## §6 `component × source × authorization` 表（owner 指定格式）

| component | online source（实测 → Git 载体） | repository source（`origin/master` @ `e015aaaf`） | expected source | authorization |
|---|---|---|---|---|
| `runDecisionEngine` | `v3.6.5-frozen`（→ `d6692983`） | differs（`77f7d500`，1377 行） | **`v3.6.5-frozen`**（tag 注解显式绑定） | ✅ C-021.2 §3 CONTROLLED DEPLOYMENT（owner-granted；`c021/**` 18 件；`base_head c6bd006f`；85 files；bundle `e996e88a…`） |
| `runGen1ShadowEod` | `aaeb5cb0` | **EXACT** | **`UNSPECIFIED`** | ⚠️ 无专项记录（内容自 09-10 未变） |
| `adminGateway` | `8fc3ba66` | differs（`44c111e9`，1134 行） | **`UNSPECIFIED`** | ⚠️ 无（`GAP-P2`） |
| `apiGateway` | `8fc3ba66` | differs（`5342e92d`，1024 行） | **`UNSPECIFIED`** | ⚠️ 无（`GAP-P2`） |
| `materializeIndicators` | `8fc3ba66` | **EXACT** | **`UNSPECIFIED`** | ⚠️ 无（`GAP-P2`） |
| `runGen2ShadowEod` | `8fc3ba66` | differs（`cb9a91b7`，2402 行） | **`UNSPECIFIED`** | ⚠️ 无 |
| `extractFundamental` | `8fc3ba66` | **EXACT** | **`UNSPECIFIED`** | ⚠️ 无 |
| `fetchDailyData` | `c0e29b06` | **EXACT** | **`UNSPECIFIED`** | ⚠️ 无 |
| `fetchFundamentalNews` | `8fc3ba66` | **EXACT** | **`UNSPECIFIED`** | ⚠️ 无 |
| `fetchRealtimeData` | `8fc3ba66` | **EXACT** | **`UNSPECIFIED`** | ⚠️ 无 |

> ⛔ **本表不构成部署目标**：`expected source = UNSPECIFIED` 的行**不得**被解释为「应部署为 master HEAD」；`runDecisionEngine` 的 `expected source = v3.6.5-frozen` **不得**被解释为「其他函数也应升到 V3.6.5」。

---

## §7 边界与 STOP

**⛔ 本件未做的动作**：未 deploy · 未 rollback · 未 tag · 未 push · 未 merge · 未改任何云函数 · 未改任何 manifest / lock / config / DB 行 · 未升 authority · 未写 active pointer。

**⛔ 概念纪律（本件确立，供后续引用）**：

1. **`ONLINE SOURCE ≠ EXPECTED SOURCE`**：实测内容不因「存在」而成为「期望」。
2. **`EXPECTED SOURCE ≠ AUTHORIZED SOURCE`**：期望可由声明推导；**授权只能由 owner 给出**。
3. **快照目录（`ref-0908` 类）不是 authority**：引用必须回到 commit。
4. **「master 前进」不是漂移**：只有存在 EXPECTED 声明时，差异才升级为漂移。

```text
ONLINE_PROVENANCE_MAPPED   = YES
FUNCTIONS_TOTAL            = 10
FUNCTIONS_TRACED_TO_COMMIT = 10
UNTRACEABLE_FUNCTIONS      = 0
PACKAGE_LEVEL_PARITY       = NOT_REVERIFIED
GOVERNANCE_GAPS            = GAP_P1_P2_P3_P4_P5
ONLINE_DEPLOYMENT          = MIXED
ADMIN_GATEWAY_BASELINE     = 8fc3ba66
REF_0908_IS_SNAPSHOT       = YES
PRODUCTION_WRITE           = 0
DB_WRITE                   = 0
DEPLOY                     = NO
AUTHORITY_CHANGE           = NO
CANARY                     = OFF
EVIDENCE_EXECUTION         = NO
GE04                       = NO
IMPLEMENTATION_AUTHORIZED  = NO
STOP                       = YES
```

**说明（在代码块之外）**：`ADMIN_GATEWAY_BASELINE` 为 **commit**（非目录名）；`REF_0908_IS_SNAPSHOT = YES` 表示 `ref-0908` 是快照副本、⛔ 非来源；`PACKAGE_LEVEL_PARITY = NOT_REVERIFIED` 的原因见 §3 / §5 `GAP-P3`。
