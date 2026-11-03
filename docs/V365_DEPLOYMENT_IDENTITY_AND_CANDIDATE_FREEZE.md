# V3.6.5 · C-021 —— DEPLOYMENT IDENTITY & CANDIDATE FREEZE GATE（设计 · 只读）

> 状态：**设计完成 · 未执行**
> `CANDIDATE_FREEZE_DESIGN = COMPLETE`
> `READY_FOR_V365_CONTROLLED_DEPLOYMENT = PENDING_OWNER_DEPLOYMENT_APPROVAL`
> `DEPLOYMENT_IDENTITY_VERIFIED = false`
> `READY_FOR_V365_FIRST_CONTROLLED_RUN = BLOCKED_ON_DEPLOYMENT_IDENTITY`
> `PRODUCTION_ACTIVATION_AUTHORIZATION = NOT_GRANTED`

⛔ 本轮（C-021）**不 deploy**、**不执行 production run**、**不初始化 pointer**、**不写业务数据**、
**不设置 switch date**、**不 commit / push / PR / merge / tag**。
本文件只是**设计 + 只读取证 + dry-run**。

---

## 1. 缺口承认（owner §1）

### 1.1 旧语义已废除

C-020 之前的门禁语义为：

```text
owner_authorization = true  ⇒  READY_FOR_CONTROLLED_PRODUCTION_ACTIVATION = GRANTED
```

**该语义在 C-021 正式废除。** 理由：

> 它把「owner 同意启动受控激活」当成了**充分条件**，但实际上还缺一层——
> **生产环境实际运行的代码** 是否等于 **本轮完成 qualification 的 V3.6.5 candidate**。

在没有证明「部署身份同一」之前，`owner_authorization = true` 只意味着
「owner 愿意运行」，**不意味着运行的就是被 qualification 的那份代码**。
因此：

```text
⛔ owner_authorization = true  ⇏  GRANTED
✅ deployment_identity_verified = true  AND  owner_run_authorization = true  ⇒  GRANTED
```

### 1.2 缺口的结构

```text
READY_FOR_CONTROLLED_PRODUCTION_ACTIVATION
  = owner_run_authorization
  ∧ deployment_identity_verified        ← ★ 本轮新增的独立必需条件
  ∧ (G-01 ~ G-24 全部 PASS)
```

`deployment_identity_verified` 在**部署前必须为 `false`**，因为：

- 线上跑的是 **V3.6.4**（冻结 `aa634e2`），不是 V3.6.5；
- V3.6.5 尚未部署，因此**不存在**「线上 = candidate」的事实。

⇒ 当前状态应为 **`BLOCKED_ON_DEPLOYMENT_IDENTITY`**（比 `PENDING_OWNER_APPROVAL` 更精确、更 fail-closed）。

---

## 2. Production Deployment Baseline Audit（§2 · 只读取证）

**脚本**：`scripts/v365-deployment-identity-audit.js`
**产出**：`deliverables/v365-production-history/c021/deployment-identity-audit.json`

### 2.1 实测结论

| 字段 | 实测值 | 台账 D-006 | 一致 |
|---|---|---|---|
| `FunctionId` | `lam-eiye285p` | — | — |
| `FunctionName` | `runDecisionEngine` | — | — |
| `Runtime` | `Nodejs16.13` | `Nodejs16.13` | ✅ |
| `Handler` | `index.main` | `index.main` | ✅ |
| `ModTime` | `2026-09-22 16:29:48` | `2026-09-22 16:29:48` | ✅ |
| `CodeSize` | `4013498` | `4013498` | ✅ |
| `index_sha256_raw` | `072b40089c7bc260a888bda913e68b1afb546b49a3d19ef88d4eec7fe9ae477b` | 同 | ✅ |
| `index_sha256_lf` | `77f7d50042cee0a9a7e5f84c7769dd95de92f8091b7547307b6f325f8fe01529` | 同 | ✅ |
| `CodeSha256` | **N/A（CLI 不返回）** | `aa576c20…` | ⚠️ 字段不可用 |

### 2.2 逐文件 parity（在线包 vs 冻结 V3.6.4 源）

```text
ONLINE_SOURCE_PARITY = EXACT_MATCH
frozen_commit        = aa634e264270f26207c59c19ef3e1c31dde01e64
online_files         = 76
match (LF 归一化)     = 74
diff_count           = 0
only_online          = [GEN1_GUARDED_EFFECTIVE_EVIDENCE.json, GEN1_GUARDED_EFFECTIVE_FREEZE.json]
```

> `only_online` 的 2 件为 build 阶段从 `ml/manifests/**` 注入的 frozen artifact，
> 在 repo 中不在同一路径 ⇒ **属预期**，非漂移。

### 2.3 结论

```text
CURRENT_PRODUCTION_DEPLOYMENT_IDENTITY = V3.6.4（FROZEN / DEPLOYED）
production_baseline_verified           = true
deployment_identity_verified           = false   ← ★ 正是本轮缺口
STOP                                   = null    ← 无 PRODUCTION_DEPLOYMENT_DRIFT
```

> ⛔ **硬证据推翻「线上可能已是 V3.6.5」的假设。**
> 三重独立一致：① `ModTime`/`CodeSize` 匹配 DB-006；② `index.js` 双 SHA 匹配；③ 逐文件 parity `diff=0`。

### 2.4 踩坑记录（避免误报 DRIFT）

| 坑 | 现象 | 修复 |
|---|---|---|
| **`{data:{...}}` 信封** | `fn detail` 返回嵌套 `data` ⇒ 平铺取值全 `null` ⇒ **误报** `PRODUCTION_DEPLOYMENT_DRIFT` | `const d = parsed.data ?? parsed` |
| **字段缺失 ≠ 漂移** | CLI 不返回 `CodeSha256` | `shaAvailable` 守卫；`drift` 仅在「有可比字段且不一致」时成立 |
| **CRLF vs LF** | 线上包 CRLF、`git show` LF ⇒ 全量假阳性 | LF 归一化后再 sha256（本仓 `hash_basis`） |

---

## 3. V3.6.5 真正 Deployment Scope（§3 · 依赖闭包）

**脚本**：`scripts/v365-deployment-scope.js`
**产出**：`deliverables/v365-production-history/c021/deployment-scope.json`

### 3.1 部署模型

```text
cloudbaserc.json  →  functionRoot = ./dist-functions
deploy 源          =  dist-functions/**（gitignored 构建产物）
构建               =  scripts/build-cloudfunctions.js
                      ← cloudfunctions/<fn> + src/common/** + EXTRA_FILES
node_modules/config.json ← prepare-deploy.py 从快照恢复
```

### 3.2 闭包分解（`runDecisionEngine` production package）

| 段 | 数量 | 内容 |
|---|---|---|
| ① function own source | **2** | `cloudfunctions/runDecisionEngine/index.js` + `package.json` |
| ② canonical common | **87** | `src/common/**`（含 46 个 CALC 保护文件，**零改动**） |
| ③ extra frozen artifacts | **2** | `ml/manifests/GEN1_GUARDED_EFFECTIVE_{FREEZE,EVIDENCE}.json` |
| **合计** | **91** | `V365_DEPLOYMENT_REQUIRED_FILES` |

```text
dependency_closure_sha = e80ea8c20785f3c8c4da70e8316d84321cfe944cb7ba25f85df2dba04ff79016
V365_DEPLOYMENT_EXCLUDED_FILES = 69（docs 24 / scripts 26 / tests 15 / 其它 4）
```

### 3.3 改动 vs 进包（★ 关键对照）

```text
worktree 变更总数（-uall）      = 76
真正进包的**改动**文件           = 7     ← ★ 只有这 7 个进包
不进包的改动文件                 = 69
```

进包的 7 个改动文件：

1. `cloudfunctions/runDecisionEngine/index.js`
2. `src/common/schema.js`
3. `src/common/utils/v365-active-read.js`
4. `src/common/utils/v365-atomic-publish.js`
5. `src/common/utils/v365-contracts.js`
6. `src/common/utils/v365-publish-store.js`
7. `src/common/utils/v365-run-integrity.js`

### 3.4 红线断言（全部通过）

```text
materializeIndicators_touched          = false   ✅
materializeIndicators_in_closure       = false   ✅
calibration_files_touched_in_closure   = []      ✅（⛔ CALC 冻结文件零改动）
V365_DEPLOYMENT_SCOPE                  = EXACT
deploy_all_74_changed_files            = false   ✅
```

> ⛔ **不得**因 worktree 有 76 个变更就全量部署；⛔ **不得**修改/部署 `materializeIndicators`；
> ⛔ **不得**改动闭包内任何 CALC 文件（`cooldown.js` / `constants.js` 等）。

---

## 4. Candidate Source Freeze（§4）

**脚本**：`scripts/v365-deployment-candidate-manifest.js`
**产出**：`deliverables/v365-production-history/c021/deployment-candidate-manifest.json`

### 4.1 问题：`HEAD SHA` 不足以代表待部署 V3.6.5 源码

```text
HEAD = c6bd006fd76ffc5358cddd07347df8ed23d9e61d
```

但 V3.6.5 的核心改动**大量位于 working-tree / untracked**。
⇒ **同一个 HEAD 可以对应多份不同的源码字节** ⇒ `HEAD SHA` **不能**单独作为部署候选标识。

### 4.2 解决方案：`V365_DEPLOYMENT_CANDIDATE_MANIFEST`

| 字段 | 值 |
|---|---|
| `base_head_sha` | `c6bd006fd76ffc5358cddd07347df8ed23d9e61d` |
| `candidate_content_sha` | `e80ea8c20785f3c8c4da70e8316d84321cfe944cb7ba25f85df2dba04ff79016` |
| `dependency_closure_sha` | 同上（同源） |
| `production_code_sha` | `3395a36a…` |
| `common_closure_sha` | `ac9dafcd…` |
| `extra_artifacts_sha` | `d352c4ca…` |
| `deployment_required_files[]` | **91** 条逐文件 `{path, sha256, bytes}` |
| `expected_runtime` | `Nodejs16.13` |
| `expected_handler` | `index.main` |
| `build_method` | `scripts/build-cloudfunctions.js` |
| `build_tool_versions` | `node v22.22.2` / `tcb_cli CloudBase CLI 3.8.1` |
| **`candidate_manifest_sha`** | **`8c53f93fa66bbc2768f23843530f3997e2c9d38030e58b65c2bc0d7497c501c1`** |

### 4.3 不变量

```text
same deployment_candidate_manifest_sha  ⇒  same production source bytes
```

> ★ 已实测：两次重算 `candidate_manifest_sha` **逐位一致** ⇒ **deterministic**。
> `dist-functions` 与 candidate 源逐文件比对：0 missing / 0 mismatch。

### 4.4 硬约束

```text
mutable_working_tree_deploy_forbidden = true
```

⛔ **禁止**直接从 mutable working tree 部署。部署必须基于**冻结后**的候选（见 §5）。

---

## 5. Freeze Mechanism 设计（§5 · 只设计不执行）

⛔ 本节**不 commit、不 tag**。只给 owner 两个方案与推荐。

### 5.1 方案 A —— Immutable Freeze Commit / Tag

**做法**：把 91 个进包文件（+ 必要的 evidence）提交为一个 **freeze commit**，并打 **annotated tag**。

| 维度 | 评价 |
|---|---|
| **可复现性** | ★★★★★ `git checkout <tag>` 即得精确字节 |
| **可审计性** | ★★★★★ commit SHA + tag 天然不可变；与 `HEAD SHA` 语义一致 |
| **rollback** | ★★★★★ 回滚 = checkout 前一 tag |
| **部署工具兼容** | ★★★★ build 脚本按 commit 构建；需保证 `dist-functions` 可重建 |
| **是否需 commit/tag 授权** | ⚠️ **需要**（本仓所有 commit/push/tag 均需 owner 单独授权） |
| **风险** | 会把 69 个**不进包**的改动（docs/scripts/tests）一并带入历史 —— 需按路径分离，或接受同 commit |

### 5.2 方案 B —— Canonical Bundle + Manifest + Per-file SHA + Bundle SHA

**做法**：把 91 个文件打包为 **canonical bundle**（确定性 tar/zip：固定排序、固定 mtime、固定权限），
随附 per-file sha256 与 bundle sha256；bundle 本身可归档到 `_v365-deploy/`。

| 维度 | 评价 |
|---|---|
| **可复现性** | ★★★★★ bundle SHA 即字节标识；无需 git |
| **可审计性** | ★★★★ 需要额外工具/dry-run 来验证（但本仓已有 per-file sha 基础设施） |
| **rollback** | ★★★★ 归档 bundle 即回滚源；但缺 git 的天然历史链 |
| **部署工具兼容** | ★★★★★ 可直接喂给 `tcb fn deploy`，绕过 `dist-functions` 重建 |
| **是否需 commit/tag 授权** | ✅ **不需要**（bundle 可在 git 之外归档） |
| **风险** | bundle 生成必须**确定性**（否则 sha 不稳定）；需把 bundle 纳入 provenance 管理 |

### 5.3 推荐

> **★ 推荐：方案 B 为主，方案 A 为辅（双绑定）。**
>
> 理由：
> 1. 本仓**所有 commit/tag 均需 owner 单独授权** ⇒ 方案 B 让「冻结候选」这一步**不依赖** git 写权限，
>    与「deploy 授权 ≠ run 授权」的分离原则一致；
> 2. `candidate_manifest_sha`（逐文件 SHA）已实现且**已证 deterministic** ⇒ 方案 B 立即可用，零额外基础设施；
> 3. 方案 A 的 `tag` 在**部署完成后**再补打（作为**审计锚**），此时它记录的是「已部署的那份」，
>    而不是「打算部署的那份」—— 语义更准确；
> 4. 两者叠加后：`bundle_sha256`（部署用） + `freeze_tag`（审计用） 互为交叉验证，
>    任一被篡改都能被发现。
>
> ⛔ **无论选哪个，都必须满足**：部署前后 `candidate_manifest_sha` 不变，且 §9 post-deploy 逐文件核验通过。

### 5.4 冻结候选的三重锁定（设计）

```text
① candidate_manifest_sha = 8c53f93f…      （逐文件 91 SHA 的聚合）
② dependency_closure_sha = e80ea8c2…      （闭包字节）
③ expected_runtime / handler = Nodejs16.13 / index.main   （运行契约）
```

三者在**部署前冻结**，在**部署后（§9）逐项复核**。

---

## 6. Rollback Artifact Gate（§6 · dry-run 已通过）

**脚本**：`scripts/v365-rollback-artifact.js`
**产出**：`deliverables/v365-production-history/c021/rollback-artifact.json`

### 6.1 要求

部署授权前，必须存在 `CURRENT_PRODUCTION_ROLLBACK_ARTIFACT`，绑定当前线上件的：

- `package_sha256`
- `function metadata`
- `downloaded package sha`

并要求 **`rollback artifact independently verified`**。
⛔ **不能只保存一个下载链接。**

### 6.2 验证方法（双源独立）

```text
① tcb fn detail            → function metadata（FunctionId / Runtime / Handler / ModTime / CodeSize）
② tcb fn code download     → 落盘到 <workDir>/functions/runDecisionEngine
③ 本地复算 index.js 双 SHA → 与台账 D-006 记录值逐位比对
```

### 6.3 实测结果

```text
ledger baseline (D-006):
  package_sha256      = aa576c20599528a66737f154b31b8cca87f25c1cf50068093bc243ed7084caea
  mod_time            = 2026-09-22 16:29:48
  index_sha256_lf     = 77f7d50042cee0a9a7e5f84c7769dd95de92f8091b7547307b6f325f8fe01529

observed online:
  ModTime             = 2026-09-22 16:29:48          ✅
  CodeSize            = 4013498                       ✅
  recomputed idx raw  = 072b40089c7bc260a888bda913e68b1afb546b49a3d19ef88d4eec7fe9ae477b  ✅
  recomputed idx lf   = 77f7d50042cee0a9a7e5f84c7769dd95de92f8091b7547307b6f325f8fe01529  ✅

independently_verified = true
```

> ✅ 线上包下载 → **本地复算** → == 台账记录值（**独立双源一致**）。
> ⛔ 这**不是**「保存了一个下载链接」，而是**可复现的字节级验证**。

### 6.4 fail-closed 行为

凭证不可用时：

```text
deployment_blocked_on_credential = true
independently_verified           = false
⇒ G-23 rollback_artifact_verified = false ⇒ 部署门禁不通过（正确行为）
```

---

## 7. 两个独立 owner Gate（§7~§9）

### 7.1 GATE-D —— 部署门禁

```text
GATE-D = READY_FOR_V365_CONTROLLED_DEPLOYMENT
判据 D-01 ~ D-08：
  D-01  candidate_source_frozen
  D-02  deployment_manifest_frozen
  D-03  deployment_scope_exact
  D-04  current_production_baseline_verified
  D-05  rollback_artifact_verified
  D-06  all_qualification_gates_pass
  D-07  protected_domain_clean
  D-08  owner_deployment_authorization          ← owner 门控项（唯一）
输出：PENDING_OWNER_DEPLOYMENT_APPROVAL  (may_deploy = false)
     / GRANTED                          (may_deploy = true)
     / BLOCKED_DEPLOYMENT_GATE_INCOMPLETE
```

★ **`implies_first_controlled_run: false`（恒为 false）** —— ⛔ 部署授权**绝不**蕴含运行授权。

### 7.2 GATE-R —— 首次受控运行门禁

```text
GATE-R = READY_FOR_V365_FIRST_CONTROLLED_RUN
判据：G-01 ~ G-25 全部 PASS，其中
  G-16 = owner_run_authorization          ← owner 运行授权
  G-25 = deployment_identity_verified     ← 部署身份已验证（部署后）
输出：GRANTED
     / PENDING_OWNER_RUN_APPROVAL
     / BLOCKED_ON_DEPLOYMENT_IDENTITY     ← ★ 当前状态
```

### 7.3 Post-Deploy Identity Gate（§9）

owner 授权 deploy 后**立即**只读核验，逐项比较：

| 项 | online | manifest |
|---|---|---|
| `Runtime` | `Nodejs16.13` | `expected_runtime` |
| `Handler` | `index.main` | `expected_handler` |
| `deployment_candidate_manifest_sha` | 实测 | `candidate_manifest_sha` |
| **逐文件** `file_hashes` | 91 条 | `deployment_required_files[]` |
| `UNEXPECTED_PACKAGE_DIFF` | — | 必须 `0` |

**只有** `ONLINE_SOURCE_PARITY = EXACT_MATCH` **且** `UNEXPECTED_PACKAGE_DIFF = 0`

⇒ `DEPLOYMENT_IDENTITY_VERIFIED = true`；否则 **`STOP`**，⛔ 不得进入 first run。

★ fail-closed：若 `online.file_hashes` 缺失 ⇒ **verified 保持 false**（不得因「没法比」而放行）。

---

## 8. Gate 修改汇总（§10~§12）

### 8.1 Controlled Activation Gate（G-16 改名 + G-21~G-25 新增）

| ID | key | 说明 |
|---|---|---|
| G-16 | ~~`owner_authorization`~~ → **`owner_run_authorization`** | **运行**授权（⛔ 非部署授权） |
| **G-21** | `candidate_source_frozen` | candidate source frozen（`candidate_manifest_sha` 存在） |
| **G-22** | `deployment_scope_exact` | required/excluded 精确（⛔ 非 76 全量） |
| **G-23** | `rollback_artifact_verified` | `CURRENT_PRODUCTION_ROLLBACK_ARTIFACT` 独立验证 |
| **G-24** | `production_baseline_verified` | 当前生产基线 vs deployment ledger 已核验 |
| **G-25** | `deployment_identity_verified` | ⛔ 部署前**必须** `false` |

### 8.2 状态判定（`evaluateControlledActivationGate`）

```text
① 历史 Δ 被静默豁免            ⇒ BLOCKED_HISTORICAL_DELTA_SILENTLY_WAIVED
② 核心项失败 且 G-25=false     ⇒ BLOCKED_ON_DEPLOYMENT_IDENTITY   ← ★ 更精确
③ 核心项失败 且 G-25=true      ⇒ BLOCKED_GATE_INCOMPLETE
④ G-25=false（核心全绿）       ⇒ BLOCKED_ON_DEPLOYMENT_IDENTITY   ← ★ §11 关键
⑤ G-25=true 且 G-16=false      ⇒ PENDING_OWNER_APPROVAL
⑥ G-25=true 且 G-16=true       ⇒ GRANTED（may_activate = true）
```

> ★ §11 核心：**④** 保证「即使 owner 已给运行授权，若部署身份未验证 ⇒ 仍不得激活」。

### 8.3 P-05 修正（§11）

**旧**（已删）：

```js
owner_authorization: true  ⇒  assert.strictEqual(g.gate_status, 'GRANTED')   // ⛔ vacuous 语义已废除
```

**新**：

```js
// ① owner_run_authorization=true + deployment_identity_verified=false ⇒ may_activate === false
// ② 仅当 deployment_identity_verified=true + owner_run_authorization=true + 其余全 PASS ⇒ GRANTED
// ③ deployment_identity_verified=true 但缺 owner 运行授权 ⇒ PENDING_OWNER_APPROVAL
```

### 8.4 P-13 假绿灯修正（§12）

**旧**（已删）：

```js
assert.ok(designDoc.includes(n) || true, `P-13：设计文档可引用 ${n}`);   // ⛔ 永远 PASS
```

**新**：

```js
assert.ok(designDoc.includes(n), `P-13：设计文档必须真实登记生产集合 "${n}"`);
assert.ok(contractSrc.includes(n), `P-13：集合名 "${n}" 必须仍存在于 v365-contracts.js（唯一来源）`);
```

### 8.5 全部假绿灯扫描（§12）

扫描 `tests/**` 的 `|| true` / `assert(true)` / `assert.ok(true)` / 恒真 placeholder：

| 文件 | 行 | 原状 | 处置 |
|---|---|---|---|
| `tests/v365-prospective-qualification.test.js` | 267 | `assert.ok(designDoc.includes(n) \|\| true, …)` | ✅ 已改为真实断言 |
| `tests/v365-rpg-f2b.test.js` | 189 | `… ).forEach((m) => assert.ok(… \|\| true, ''))` | ✅ 已改为逐 mutation 名真实断言 |

★ 并新增 **P-34**：prospective 测试自身**不得**残留永真断言（模式由碎片拼装，避免自指陷阱）。

---

## 9. 两次 owner 授权严格分离（§13）

```text
C-021 完成（本轮）
   ↓
【owner 授权 #1】DEPLOY AUTHORIZATION
   ↓
单次部署（GATE-D = GRANTED 后）
   ↓
Post-Deploy Identity Gate（§9）逐项 EXACT_MATCH
   ↓
DEPLOYMENT_IDENTITY_VERIFIED = true
   ↓
STOP（⛔ 不得自动进入运行）
   ↓
【owner 授权 #2】FIRST CONTROLLED RUN AUTHORIZATION
   ↓
单自然日 single run
   ↓
First Natural Run Acceptance A-01 ~ A-10
```

> ⛔ **Deploy 授权 ≠ Run 授权。**
> 两个授权分别对应 `GATE-D` 与 `GATE-R`，任一不得推导另一个。

---

## 10. 证据件清单

| 文件 | 内容 |
|---|---|
| `deliverables/v365-production-history/c021/deployment-identity-audit.json` | §2 生产基线审计 + §9 parity |
| `deliverables/v365-production-history/c021/deployment-scope.json` | §3 部署范围闭包（91 / 69 / 7） |
| `deliverables/v365-production-history/c021/deployment-candidate-manifest.json` | §4 候选冻结 manifest |
| `deliverables/v365-production-history/c021/rollback-artifact.json` | §6 回滚件（独立验证） |
| `deliverables/v365-production-history/prospective/prospective-state.json` | 综合状态（含 GATE-D / GATE-R） |

---

## 11. 边界声明

- 本轮**未** deploy；线上仍为 **V3.6.4**（`aa634e2`）。
- 本轮**未**执行任何真实 production run。
- 本轮**未**初始化 pointer、**未**写业务数据、**未**设置 switch date。
- 本轮**未** commit / push / PR / merge / tag。
- 本文件**未**做出任何 `READY_FOR_PRODUCTION_PROMOTION` / `READY_FOR_GENERAL_PRODUCTION` 判定。
- 本轮**未**使用任何模型输出替代 owner 对**部署 / 运行放行**的拍板。
- 所有「已完成」项均为**设计层 + 只读取证层 + dry-run**，⛔ **不构成**部署或生产就绪证明。

---

# 附：C-021.1 —— PRE_DEPLOY_ARTIFACT_MATERIALIZATION（§1~§10）

> owner 裁定「C-021 主体批准，但当前**仍不授权生产部署**」，进入本轮**极小的最终上线前工作包**。
> 目标：把「**逻辑上的** V3.6.5 candidate」冻结成「**一个确定、可验证、可授权的实际 deployment bundle**」。

## A.1 §1 从 manifest 构建 canonical bundle（⛔ 不得从 mutable working tree 部署）

构建前**逐文件**验证 `sha256(current file) == manifest.deployment_required_files[].sha256`：

```text
required = 91 · verified_ok = 91 · drift = 0 · scope↔manifest required SET_EQUAL = true
```

任一不一致 ⇒ **`STOP = CANDIDATE_SOURCE_DRIFT`**（写 `deployment-artifact.STOP.json`，`exit 2`）。
⛔ **不得重新生成 manifest 来「适配」漂移** —— 那会把「源码漂移」伪装成「冻结更新」。

**bundle 格式**：确定性 ustar（`mtime=0` / `uid=0` / `gid=0` / `mode=0644`，条目按 path 字典序）。
⛔ 不用 gzip（gzip 头含 mtime ⇒ 非确定性）。

## A.2 §2 Deployment Artifact Identity

| 字段 | 值 |
|---|---|
| `base_head_sha` | `c6bd006fd76ffc5358cddd07347df8ed23d9e61d` |
| `candidate_manifest_sha` | `8c53f93fa66bbc2768f23843530f3997e2c9d38030e58b65c2bc0d7497c501c1` |
| `candidate_content_sha` = `dependency_closure_sha` | `e80ea8c20785f3c8c4da70e8316d84321cfe944cb7ba25f85df2dba04ff79016` |
| `production_code_sha` | `3395a36a388a85348d2c6f6c4aa8da9634cb078ac5e24eac3b7047fb2ce9cf11` |
| `required_file_count` | **91** |
| `runtime` / `handler` | `Nodejs16.13` / `index.main` |
| `build_method` | `scripts/build-cloudfunctions.js` |
| `build_tool_versions` | `node v22.22.2` · `CloudBase CLI 3.8.1` |
| **`bundle_sha256`** | **`e996e88ae8084a38e186471b561867267fc4280c3ea5758ccb0eff75092455a4`** |
| `bundle_content_manifest_sha` | `0e544793…`（本件为 **V3.6.5** bundle；回滚件为 V3.6.4，见 §A.5） |
| `bundle_size` | `1161728` |
| `bundle_path` | `deliverables/v365-production-history/c021/bundle/runDecisionEngine.V365.e996e88ae808.tar` |

**不变量**：`same deployment_bundle_sha256 ⇒ same deployable bytes`。
实测**两次独立重算**（不同 `--out-dir`）⇒ `bundle_sha256` **逐位一致** ⇒ deterministic 成立。

## A.3 §3 Bundle 独立复核（⛔ 不复用 build 内存）

重新读盘 → **独立解析** tar → 重算全部 path / 逐文件 sha / `index.js` raw+LF sha：

```text
MISSING_REQUIRED_FILE = 0
UNEXPECTED_FILE       = 0
CONTENT_DIFF          = 0
ONLINE_IRRELEVANT_ARTIFACT_DIFF = 0（按冻结 ignore policy：node_modules/** · config.json）
⇒ BUNDLE_SOURCE_PARITY = EXACT_MATCH
```

## A.4 §4 Pre-Deploy Package Diff（vs 线上冻结 V3.6.4）

以**已独立验证**的线上件为 PREVIOUS（`CURRENT_PRODUCTION_DEPLOYMENT_IDENTITY = V3.6.4`，`aa634e2`）：

```text
added = 15 · modified = 4 · deleted = 0 · unchanged = 72
UNEXPECTED_PACKAGE_DIFF = 0
```

| 类别 | 文件 |
|---|---|
| **modified (4)** | `index.js` · `common/schema.js` · `common/utils/datasource.js` · `common/utils/v361-run-context.js` |
| **added (15)** | 5 × `common/data/cn-trading-calendar*` · `common/utils/{cn-trading-calendar,fundamental-provenance,global-signal-provenance,market-env-provenance,pipeline-correlation,v365-active-read,v365-atomic-publish,v365-contracts,v365-publish-store,v365-run-integrity}.js` |
| **deleted (0)** | ⛔ 无（不得删文件） |

**红线三项**：`materializeIndicators_changed = false` · `param_config_semantic_change = false` ·
`protected_CALC_unexpected_change = false`。

### ★ 计数对账（7 vs 19 —— **包含**关系，非矛盾）

| 口径 | 值 | 含义 |
|---|---|---|
| C-021 §3 `changed_in_closure_count` | **7** | `git status`（**working tree**）∩ 闭包 |
| C-021.1 §4 bundle delta | **19** | **已部署基线 `aa634e2`** → worktree 的闭包内 delta |

```text
19 = 7（working-tree） + 12（aa634e2→HEAD 之间【已提交】的变更）
7 ⊂ 19（子集关系，已机器断言 is_subset_of_delta = true）
```

> ⚠️ 二者**都对**，只是**基线不同**：部署看的是「服务器上会变什么」⇒ 必须与**已部署基线**比，
> 而不是与 HEAD 的 working tree 比。⛔ 不得把 19 当作「多出来的意外改动」。

**双向交叉验证**：bundle delta 与源码 delta（`git aa634e2 → worktree`，闭包内）
**逐项 `SET_EQUAL`**（added / modified / deleted 三类全部 true）⇒ bundle **忠实反映**源码。

## A.5 §5 DEPLOYMENT_ROLLBACK_BINDING

把 `PREVIOUS_PRODUCTION_PACKAGE_SHA` 与 `NEW_V365_BUNDLE_SHA` 放进**同一个 deployment plan**：

```text
previous_package_sha        = aa576c20599528a66737f154b31b8cca87f25c1cf50068093bc243ed7084caea   （线上 V3.6.4 · 台账 D-006）
previous_runtime / handler  = Nodejs16.13 / index.main
previous_rollback_bundle    = 4c7949f5dcf3da99b1cbbc20e159fee8a86f8279c2b5f89c9a57982563d0295e   （76 文件 · parity EXACT_MATCH）
new_bundle_sha              = e996e88ae8084a38e186471b561867267fc4280c3ea5758ccb0eff75092455a4
new_candidate_manifest_sha  = 8c53f93fa66bbc2768f23843530f3997e2c9d38030e58b65c2bc0d7497c501c1
rollback_artifact_sha       = 锚定 rollback-artifact.json 的**文件字节** sha
⇒ DEPLOYMENT_ROLLBACK_BINDING = BOUND
```

**关键校验**：回滚 bundle 的 `index.js` **raw + LF 双 sha 均匹配台账 D-006**
⇒ 回滚件与「线上实际运行的代码」**同一身份**（⛔ 不是「一个下载链接」）。

> ⚠️ 注意区分：`_v364-deploy/rollback/runDecisionEngine.PREVIOUS.a694b7d3.zip` 是
> **V3.6.4 部署前**保存的历史快照（用于回滚那次部署）——⛔ **不是**本次 V3.6.5 部署的回滚件。
> 本次回滚件 = **当前线上 V3.6.4**（`aa576c20…`）。

## A.6 §6 GATE-D 修正（D-08 / D-09 / D-10）

```text
D-01 candidate_source_frozen                 ✅
D-02 deployment_manifest_frozen              ✅
D-03 deployment_scope_exact                  ✅
D-04 current_production_baseline_verified    ✅
D-05 rollback_artifact_verified              ✅
D-06 all_qualification_gates_pass            ✅
D-07 protected_domain_clean                  ✅
D-08 deployment_artifact_materialized        ✅   ← ★ 新增
D-09 deployment_artifact_exact_match         ✅   ← ★ 新增
D-10 owner_deployment_authorization          ⛔ NOT_GRANTED   （原 D-08 后移）
```

**fail-closed 优先级**：

```text
① D-08/D-09 FAIL  ⇒ BLOCKED_ON_DEPLOYMENT_ARTIFACT      ← ★ 新增状态
② 其它核心 FAIL   ⇒ BLOCKED_DEPLOYMENT_GATE_INCOMPLETE
③ 核心全绿 + owner 未授权 ⇒ PENDING_OWNER_DEPLOYMENT_APPROVAL
④ 核心全绿 + owner 已授权 ⇒ GRANTED（may_deploy = true）
```

> ★ **`PENDING_OWNER_DEPLOYMENT_APPROVAL` 语义收紧**：
> 「**已经存在一个具体、不可变、可用 SHA 唯一标识的 deployment bundle，owner 只差决定『是否把这一包上传生产』**」。
> ⇒ 该状态**只有在** `DEPLOYMENT_ARTIFACT_MATERIALIZED = true` **且**
> `BUNDLE_SOURCE_PARITY = EXACT_MATCH` **且** `UNEXPECTED_PACKAGE_DIFF = 0` 之后才可能出现。
> ⛔ owner 授权**不能**越过 artifact fail-closed（P-40 已机器断言）。

## A.7 §7 owner 部署授权必须绑定 bundle（三层 identity）

```text
base_head_sha          = c6bd006fd76ffc5358cddd07347df8ed23d9e61d   ← provenance（⛔ 不再是唯一代码身份）
candidate_manifest_sha = 8c53f93fa66bbc2768f23843530f3997e2c9d38030e58b65c2bc0d7497c501c1
deployment_bundle_sha  = e996e88ae8084a38e186471b561867267fc4280c3ea5758ccb0eff75092455a4
production_env         = tradingview-etf-d0fa42yy57cbc11b
function_name          = runDecisionEngine
```

`evaluateDeploymentAuthorizationBinding(auth, expected)` 校验：
缺字段 ⇒ `missing`；值不符 ⇒ `mismatches`；
⛔ **仅绑 HEAD SHA ⇒ `head_only_authorization_rejected = true` ⇒ `bound = false`（REJECTED）**。

## A.8 §8 文档残留修正

| 位置 | 旧（作废） | 新 |
|---|---|---|
| Prospective 机器状态 | `READY_FOR_CONTROLLED_PRODUCTION_ACTIVATION = PENDING_OWNER_APPROVAL` | **`= BLOCKED_ON_DEPLOYMENT_IDENTITY`**（直到 post-deploy identity PASS） |
| controlled-run 绑定 | `explicit HEAD SHA binding` | **三层 identity binding**（base HEAD + candidate_manifest_sha + deployed bundle sha） |

## A.9 §9 Freeze Review stale tracked count

- Freeze Review §6 原写「**25 个 tracked 文件**」= **历史旧口径**，与当前真值冲突 ⇒ 更正为 **84**。
- ledger 的 `## C` / `## E` 阶段日志段**整段**显式标注 **`[HISTORICAL SNAPSHOT]`**，⛔ 不得作 current state 引用。
- ★ **一致性检查器守卫加强**：原反向正则 `/tracked[^\n]*?(\d+)/` **只匹配「tracked 在前」**
  ⇒ **漏掉 `<num> 个 tracked`** —— 这正是「25」得以逃逸的原因。
  现**双向**匹配 + 允许**显式历史标记**豁免（`[HISTORICAL SNAPSHOT]` / `旧口径` / `更正为` …）。

### ★★ A.9.1 §9 同源加固 —— 门禁日志完整性（`gate_log_integrity`）

排查中发现**同类盲区的第二个分身**：

```text
stage-a-current.log  = 71/71   ← 过期（真值 72/72）
stage-all-current.log = 79/79  ← 过期（真值 80/80）
```

而 preflight 的判定原为：

```js
stage_a_pass:        !!(stageAll && /Stage A/.test(stageAll) && !/\[FAIL\]/.test(stageAll))
stage_a_to_g_pass:   !!(stageAll && /\d+\/\d+ 项通过，0 项失败/.test(stageAll) && !/\[FAIL\]/.test(stageAll))
```

⇒ **只做形态匹配，⛔ 不校验计数**。危险在于：**过期日志里没有 `[FAIL]`**，
所以即便测试此后变红，判定**仍然是 `true`** —— **静默假通过，且方向恒为偏乐观**
（与 §8 覆盖度审计的「自我指涉」教训同源）。

**加固**（绑定**独立真值**，⛔ 不得自证）：

| 判据 | 独立真值源 |
|---|---|
| ① Stage A 计数正确 | `tests/*.test.js` **实际文件数**（`parsed_count.total`） |
| ② 日志未过期 | 日志旁 `.source-sha256` == **当前源树内容指纹** |

新增审计块 `gate_log_integrity`：`test_file_count` · `source_tree_sha` · `freshness_method` ·
`stage_a_log.parsed_count` · `stage_a_log.count_matches_truth` · `stage_all_log.parsed_summary` ·
`p12_log` · `logs_fresh`。由 **P-44** 断言机制；最终值由收口检查器强制。

★ **指纹化范围 = 全部三份「读日志 → 出结论」的门禁日志**：
`stage-a-current.log` · `stage-all-current.log` · **`p12-parity-current.log`**。
⛔ 只护前两份 = 留一个同类缺口（`p12` 日志喂 G-10 `p12_parity_delta_zero`，过期即静默假通过）。
✅ `p12` 日志由**独立脚本**产出（非测试套件）⇒ 纳入指纹化**无自指风险**。

> ⚠️ **已知残留（未纳入指纹化）**：p12 的**输入件**（`changed-files-current.txt` /
> `changed-regions-current.txt` / `approval-manifest-f2b.json`）本身未做指纹绑定。
> 缓解：它们由 `git status --porcelain -uall` 派生，生成时刻即当前；且 `approval-manifest` 的
> `changed_files` 已被 p12 的 `APPROVAL_CHANGED_FILES_MISMATCH` 反向校验。⇒ 记录为已知限制。

#### ⚠️ 新鲜度必须用**内容指纹**，⛔ **不是 mtime**

首版用 `mtime ≥ 最新源文件 mtime`，实测**假报过期**，根因是一个**合法**的测试：

```js
// tests/v365-b0-manifest.test.js · A.8「反向证明：篡改任一合格文件必须触发 HASH_MISMATCH」
fs.writeFileSync(abs, Buffer.concat([backup, Buffer.from('\n// v365-test-tamper\n')]));  // 篡改
... assert(r.ok === false) ...
fs.writeFileSync(abs, backup);   // 必须逐字节还原
```

⇒ 它**故意篡改**一个源文件再**逐字节还原** —— **内容未变，mtime 被推后**
（实测命中 `src/common/utils/v365-contracts.js`）。
**mtime 是「写入时刻」，不是「内容版本」** ⇒ 用它判新鲜度会假阳性。

**改用内容指纹**（`scripts/v365-source-tree-sha.js`）：对 `tests/**` · `scripts/**` · `src/**`
全部文件的 `(path, sha256)` 排序串接取 sha。
```text
fresh ⇔ 日志旁 .source-sha256 == 当前源树指纹（sha256 · 353 个文件）
```
⛔ 不受 mtime 抖动影响；✅ 内容一变立刻失配。

> **通用教训**：⛔ **判「证据是否过期」要用「内容版本」，不要用「写入时刻」。**
> 凡有「写回原内容」的正常操作（格式化、还原、幂等重写），mtime 都会说谎。

**教训（通用）**：⛔ **凡「读日志 → 出结论」的判定，都必须同时校验「计数」与「新鲜度」**；
只查「有没有 FAIL 字样」等于把过期证据当现行证据。

### ★★★ A.9.2 加固暴露出的**自指循环**（本次最重要的发现）

加固上线后，全量套件立刻变成 **79/80**（`P-28` 失败）。排查发现这**不是**加固的 bug，
而是加固**把一个长期潜伏的循环依赖照了出来**：

```text
测试套件 ──产出──▶ stage-all-current.log ──被读──▶ preflight ──写出──▶ prospective-state.json
     ▲                                                                        │
     └──────────────────── 测试断言该 state json ◀────────────────────────────┘
```

即 `D-06 all_qualification_gates_pass` 由 `stage_all_current.log` 推导，
而该日志**正是这套测试自己产出的**。于是：

- 日志过期/脏 ⇒ `D-06` false ⇒ `GATE-D = BLOCKED_DEPLOYMENT_GATE_INCOMPLETE`
  ⇒ 测试断言「必须是 `PENDING_OWNER_DEPLOYMENT_APPROVAL`」⇒ **失败** ⇒ 日志更脏……
- **死锁**：日志要干净 ⇒ 测试要通过 ⇒ state 要正确 ⇒ 日志要干净。

> ★ 这与 **C-015 的教训同源**（MEMORY §8）：**「required 集合必须来自独立真值源，
> ⛔ 绝不能从被检验数据自身推导」** —— 本次是它在「门禁日志」上的**新分身**。

**修复（分层，⛔ 不是放宽断言）**：

| 层 | 断言内容 | 是否受循环影响 |
|---|---|---|
| **测试套件**（P-28 / P-43） | ① **恒不变式**（`may_deploy=false` · `implies_first_controlled_run=false` · `DEPLOYMENT_IDENTITY_VERIFIED=false` · `READY_FOR_V365_FIRST_CONTROLLED_RUN=BLOCKED_ON_DEPLOYMENT_IDENTITY` · `PRODUCTION_ACTIVATION_AUTHORIZATION=NOT_GRANTED`）<br>② **与日志无关的项** `D-01~D-05`/`D-07`/`D-08`/`D-09` **必须 PASS**、`D-10` 必须 FAIL<br>③ **facts ↔ status 一致性**：按 §6 优先级**重算** status 并与 `deployment_gate.status` 比对 | ✅ 不受影响 |
| **测试套件**（P-44） | 只断言**守卫机制存在** + `test_file_count == tests/*.test.js` 真值；⛔ **不**断言 `logs_fresh` 或日志 `failed==0` | ✅ 不受影响 |
| **收口检查器**（`v365-final-state-consistency-check.js` §12） | **强制最终交付态**：`logs_fresh=true` + `stage-all 0 失败` + `GATE-D = PENDING_OWNER_DEPLOYMENT_APPROVAL` + 唯一失败项 `D-10` + bundle 字节重算 sha 一致 | ✅ 它**不产出日志**，在日志刷新**之后**运行 ⇒ 无循环 |

**为什么这样就解开了死锁**：测试套件不再依赖「日志干净」⇒ 脏日志下也能通过 ⇒
跑完全量即得**干净的 80/80** ⇒ preflight 据此写出 `D-06 = PASS` ⇒ 最终态为
`PENDING_OWNER_DEPLOYMENT_APPROVAL` ⇒ 收口检查器再把这一最终态**强制**住。

> ⛔ 同时保留 fail-closed：日志脏时测试**仍要求** status 落在
> `BLOCKED_DEPLOYMENT_GATE_INCOMPLETE` / `BLOCKED_ON_DEPLOYMENT_ARTIFACT` 之内，
> 并**显式拒绝** `GRANTED` —— ⛔ 不是「脏了就随便」。

**通用教训（新）**：⛔ **测试不得断言「由自身产物推导出的门禁状态」。**
凡「套件产出证据 → 门禁读证据 → 套件断言门禁」，必须把**最终态强制**移到
**不产出该证据的收口步骤**，套件内只断言**恒不变式 + facts↔status 一致性**。

## A.10 §10 本轮**不**自动 deploy（⛔ 强制停止）

即使 `BUNDLE_SOURCE_PARITY = EXACT_MATCH` 且 `UNEXPECTED_PACKAGE_DIFF = 0`，**仍然必须停止**：

```text
DEPLOYMENT_ARTIFACT_MATERIALIZED       = true
DEPLOYMENT_BUNDLE_SHA                  = e996e88ae8084a38e186471b561867267fc4280c3ea5758ccb0eff75092455a4
BUNDLE_SOURCE_PARITY                   = EXACT_MATCH
UNEXPECTED_PACKAGE_DIFF                = 0
READY_FOR_V365_CONTROLLED_DEPLOYMENT   = PENDING_OWNER_DEPLOYMENT_APPROVAL
DEPLOYMENT_IDENTITY_VERIFIED           = false
READY_FOR_V365_FIRST_CONTROLLED_RUN    = BLOCKED_ON_DEPLOYMENT_IDENTITY
PRODUCTION_ACTIVATION_AUTHORIZATION    = NOT_GRANTED
```

⛔ **本轮未 deploy**；线上仍为 V3.6.4。⛔ 无 `push` / `PR` / `merge` / `tag`。

## A.11 新增脚本与共享模块

| 文件 | 作用 |
|---|---|
| `scripts/lib/v365-deterministic-tar.js` | ★ **唯一来源**：确定性 tar 打包/解包 · content-manifest sha · LF 归一化 · ignore policy · 路径映射（`bundleToRepo` / `repoToBundle`） |
| `scripts/v365-deployment-bundle-materialize.js` | §1~§3 物化 + 独立复核 |
| `scripts/v365-pre-deploy-package-diff.js` | §4 与线上 V3.6.4 的 deterministic diff + 双向交叉验证 |
| `scripts/v365-deployment-rollback-binding.js` | §5 PREVIOUS/NEW 绑定 |
| `scripts/v365-source-tree-sha.js` | ★ §9 **源树内容指纹**（`tests/**`·`scripts/**`·`src/**` 的 `(path,sha256)` 排序串接）—— 供门禁日志新鲜度判定；⛔ 用内容而非 mtime |

> ★ **为什么抽共享模块**：本项目已记录「多脚本复制同源逻辑」的实际事故 ——
> C-021 的 `{data:{}}` 信封修复在 §2 脚本改好后，**独立复制的回滚件脚本又踩一次**。
> ⇒ 凡确定性打包 / 路径映射 / ignore policy，**一律引用** `v365-deterministic-tar.js`，⛔ 禁止复制。

### A.12 复跑门禁的正确顺序（⛔ 顺序错了会假红）

```bash
# 1) 冻结源码（⛔ 此后不得再改 tests/** · scripts/** · src/**）
EV=deliverables/v365-production-history/evidence
# 2) Stage A + 记录内容指纹
node scripts/test-all.js --stage=A > $EV/stage-a-current.log 2>&1
node scripts/v365-source-tree-sha.js --out $EV/stage-a-current.log.source-sha256
# 3) p12 决策 parity + 记录内容指纹
node scripts/v365-p12-decision-parity.js --changed-file $EV/changed-files-current.txt \
  --changed-region $EV/changed-regions-current.txt \
  --approval-manifest $EV/approval-manifest-f2b.json \
  --head-sha <HEAD> > $EV/p12-parity-current.log 2>&1
node scripts/v365-source-tree-sha.js --out $EV/p12-parity-current.log.source-sha256
# 4) 全量 A~G + 记录内容指纹
node scripts/test-all.js > $EV/stage-all-current.log 2>&1
node scripts/v365-source-tree-sha.js --out $EV/stage-all-current.log.source-sha256
# 5) 生成 state（此时三份日志均 fresh）
node scripts/v365-prospective-preflight.js
# 6) 收口强制最终交付态
node scripts/v365-final-state-consistency-check.js
```

⚠️ 若**先跑 preflight 再改源码**，`logs_fresh` 会变 `false` ⇒ GATE-D 落
`BLOCKED_DEPLOYMENT_GATE_INCOMPLETE` ⇒ 测试的 facts↔status 一致性仍成立（不假红），
但**收口检查器会红**（这是预期的 fail-closed）。⇒ 按上述顺序重跑即可。
⚠️ 若**改了 `tests/**` 后只重跑 Stage A 而未重跑全量**，`stage-all` 会失配 ⇒ 同样由收口检查器兜住。
