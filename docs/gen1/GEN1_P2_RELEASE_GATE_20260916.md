# P2 Release Gate against current master —— `P2_RELEASE_DECISION_PACKET`

**文档编号**：`GEN1-P2RG-1.0`
**性质**：放行前门禁留痕（current-master compatibility gate）—— 全部证据**只读**取得；**放行 → 合并 → Attestation → D1 结案**四段均已留痕于本文件；本文件自身**不构成任何权限或部署授权**
**as-of**：2026-09-16T14:23:28+0800（⑧ 门禁**实跑**时刻）
**最近更新**：2026-09-16T16:48:24+0800+0800（**第九轮**：**D1 裁定结案**（等价替换 / `CLOSED`）；`master` **再次**被外部推进为 `44b59b8`（PR #45，**零 Gen-1 文件**，已在新树复跑门禁）；新增 **§9.4 P2 Closure docs-only PR 放行** 与 **§18 第九轮写入范围**）
**上一轮更新**：2026-09-16T16:21:06+0800（**第八轮**：**合并已由项目所有人于 16:06:26 以 `Create a merge commit` 完成** ⇒ `master = c9af16b1`；§11 Attestation **已实跑**，结果见 §0.c 与 §11.1）
**更早更新**：2026-09-16T15:2x+0800（**第七轮**：用户**废止「方案 A」并授权 agent 代合**；agent 已实际尝试 ⇒ **被令牌 403 阻却**）
**放行对象**：`feat/wp-g1-ge-02-dormant` = `b7247f9dcec116b5d12daf17a1320683a7dbc5ed`（= PR #43）
**放行时目标基线**：`master` = `2e8cb7da752aaab37deea4cfa27f937e1839f92c`（**as-of 值，非当前值**；当前实读见 §0.d）
**上一轮审计基线**：`6793d7f29ba161cf18166233d844f284696f7417`（⑦ PR #43 只读审计所用）

---

## 0. 决策包（唯一结论区）

**0.a ⑧ 门禁实跑输出**

```text
CURRENT_MASTER_COMPATIBILITY   PASS
GE-02 ACCEPTANCE              PASS
KNOWN NON-BLOCKERS            C1（→E22, ERRATA DEFERRED）、C2（→E23）、N1（GE-04 prerequisite）、N2、N3、N4
RELEASE RECOMMENDATION        READY_FOR_OWNER_DECISION
```

**0.b 放行后状态（as-of 2026-09-16T14:56:37+0800 实读复核）**

```text
CURRENT_MASTER_COMPATIBILITY   PASS
GE-02 ACCEPTANCE               PASS
TECHNICAL MERGE BLOCKER        NONE FOUND
MERGE AUTHORIZATION            GRANTED              （一次性 owner release；原话见 §9.2）
FROZEN_PARAM_KEYS 6 → 7        ONE-TIME EXCEPTION GRANTED（仅限本 PR；其他 lock/immutable_set 边界保持）
P2 RELEASE STATUS              P2_PENDING_PR_RELEASE（截至本记录 as-of；§11 Attestation 全 PASS 后改判 P2_COMPLETE_DORMANT）
```

**0.c 合并后状态（as-of 2026-09-16T16:21:06+0800 实读；详见 `GEN1_P2_POST_MERGE_ATTESTATION_20260916.md`）**

```text
MERGE                          DONE      master = c9af16b1e56d299394ae9cdba457b8eef05da943
MERGE_COMMIT 双亲              2e8cb7da752aaab37deea4cfa27f937e1839f92c + 6a771a1829ccf9f03c933be6f9d100c8b5ddfe4a
PR #43                         merged = true；merged_at = 2026-09-16T08:06:27Z；by iquelee
required checks（合并前 head）  8 / 8 success（4 × test 矩阵 + Analyze ×3 + CodeQL）
P2_POST_MERGE_ATTESTATION      PASS（A1 记「等价替换」；A2–A8 全 PASS）
D1（已登记偏差）               head 由 b7247f9 前进为 6a771a1（Update branch 合并提交）⇒ 与 §9.2 ④ 字面不符；
                               内容等价（19/19 blob 同 + patch-id 同 + 全树 523 文件差异 0 + merge-tree 预测 9/9 命中）
P2 RELEASE STATUS              P2_COMPLETE_DORMANT
selector                       BASELINE only（GE_02_BASELINE_AUTHORITATIVE = true）
Freeze / Evidence Seal         PENDING / PENDING（approved_at=null；independent_events=0）
production_write / auto_exec  false / false（全档；PRODUCTION 永久锁定）
线上 runtime_status            gen1_authority = CANARY、ml_effective = false
                               （updated_at = 2026-09-16T00:00:26.690Z，早于合并时刻 ⇒ 合并未触发线上写入）
D1 归档口径                    ✅ 已裁定 = 等价替换（第九轮，2026-09-16）
```

> ✅ **D1 已结案**（第九轮，2026-09-16）：`PROCESS DEVIATION / CONTENT-PRESERVING / RE-ATTESTED / NON-SAFETY / CLOSED`。
> 不重开 ⑧、不回滚 #43、不改变 `P2_COMPLETE_DORMANT`。
> 见 `GEN1_P2_POST_MERGE_ATTESTATION_20260916.md` §2.4 与 §6 R1。

**0.d 第九轮状态（as-of `2026-09-16T16:48:24+0800+0800`）**

```text
D1                             CLOSED（等价替换；PROCESS DEVIATION / CONTENT-PRESERVING / RE-ATTESTED / NON-SAFETY）
P2_RELEASE                     COMPLETE
P2_POST_MERGE_ATTESTATION      PASS
P2_STATE                       P2_COMPLETE_DORMANT
master（当前实读）              44b59b8be06f041e32e410add03a9f5b1afcb40d（PR #45，双亲 c9af16b1 + 86f9a086）
master 本日推进轨迹             6793d7f → 2e8cb7d → c9af16b1 → 44b59b8
PR #45 对 Gen-1 的影响          零（变更面恰好 2 个 Gen-2 文件；Gen-1 文件 blob 差异 NONE）
新树复跑                        verify-immutable 23/23；gen1-production-gates 25/25；CANARY 平价 38/38；关键单测 5/5 PASS
P2 Closure docs-only PR        AUTHORIZED TO CREATE；MERGE NOT GRANTED
GE-03                          设计方向 APPROVED / Q1–Q6 DECIDED；IMPLEMENTATION AUTHORIZATION NOT GRANTED
selector                       BASELINE only
Freeze / Evidence Seal         PENDING / PENDING
production_write / auto_exec   false / false
```

> ⚠️ **本文件里任何 `master` SHA 都是 as-of 值，不是永久值** —— 本日已推进 **3 次**，其中 **2 次**发生在 ⑧ 之后。
> 引用时**必须**带 as-of 时点，或直接写「以远端实读为准」。

> ⚠️ **`MERGE AUTHORIZATION = GRANTED` 表示「放行条件已满足」，不等于「合并已完成」。**
> 合并是否发生、合并后的 merge commit SHA，一律以远端实读为准（§11 A1/A2）——本文件**不预写**其结果。
> 放行**不授权**推进线上状态：合并后线上仍须为 `gen1_authority = CANARY`、`ml_effective = false`。

> **放行条件三条**（须**同时**满足，任一不满足即**不得合并**；②③ 的措辞已于第九轮按 **E25** 改为**带判据的条件式**）：
> **①** 项目所有人发布**一次性 owner override**，明确批准本 PR 把 `gen1_authority` 纳入 `FROZEN_PARAM_KEYS`（见 §9）
> —— **已满足**（2026-09-16 owner release，五要点全覆盖，见 §9.2）；
> **②** 合并时**已审计对**（`master = 2e8cb7d` **且** `#43 head = b7247f9`）保持**等价** ——
> **条件式**：允许 head 以**可证等价**的方式前进（如 `Update branch`），**仅当**同时满足 §10 的四条判据 (a)–(d)
> 才视为**等价替换**、不重开门禁；**任一条不满足 ⇒ 本 Gate 失效，须重跑 ⑧**。
> ⛔ **前向规则**：**下一次**遇到 head 变化，**必须重新冻结新 head 并对新 head 重新验收后才能 merge**，
> 不得再走「先合、后证等价」的路径（详见 §10 与勘误 **E25** 的处置升级块）。
> —— 放行时点（`2026-09-16T14:56:37+0800`）实读**仍逐位一致**；合并时 head 已前进为 `6a771a1`，已按 §10 判为**等价替换**（偏差 **D1**，第九轮结案）；
> **③** 以 **merge commit** 合并（⛔ 不 squash、⛔ 不 rebase）。
>
> **历史留痕（为何曾为 `NOT YET GRANTED`）**：本 PR 含 `FROZEN_PARAM_KEYS` **6 → 7**（新增 `gen1_authority`），
> 与最初下达给本任务的硬边界「不得修改 `gen1_authority` / `FROZEN_PARAM_KEYS` / `lock` / `immutable_set`」正面相遇。
> 该变更已证明**正是冻结章程 §3.4 要求的 GE-02 P0 安全措施**，但**不以「后续讨论似乎默认接受」反推边界失效**，
> 故一直停留在待授权 —— 直至 §9.2 的一次性例外到位。
> ⚠️ **执行通道结论已三次变动（末次为实证）**：① 上一轮「本机令牌只读」的**依据不成立**（该结论后被证实为真，但依据仍错 —— 结论对 ≠ 推理对）；
> ② 本轮初稿「令牌具备写权限」**亦超出证据**；③ **末次实证：写已证否**（授权写动作返回 `403`）。
> 执行者另有变更：用户 **2026-09-16T15:21 废止「方案 A」并授权 agent 代合** —— 但受该 `403` 阻却。见 §9.1 / §9.3。

---

## 1. 为什么需要这一轮：基线已漂移

| 时刻 | 事件 | 影响 |
|---|---|---|
| ⑦ 审计时 | `master` = `6793d7f`，#43 的 `merge-base` 也是 `6793d7f` | 称 #43「可干净合入」 |
| ⑦ 归档后（同日 13:50） | **PR #44**（`docs/gen2-m1b-gap-audit`）合入 ⇒ `master` → `2e8cb7d` | #43 的 base **不再是** master ⇒ 需重新证明兼容性 |

**PR #44 的构成（实读）**：`2e8cb7d` 是 merge commit，父 = `6793d7f` + `ce56af7`；`6793d7f..2e8cb7d` 含 2 个对象（1 个功能提交 + 1 个 merge），
**3 files changed / +901 −1**，全部为 `ml/gen2/reports/*`（**纯 Gen-2 文档、零代码、零联网**）。

---

## 2. CURRENT_MASTER_COMPATIBILITY = **PASS**（三重独立证据）

| # | 检查 | 命令（全程只读） | 结果 |
|---|---|---|---|
| A1 | **变更面交叠** | `git diff --name-only 6793d7f..2e8cb7d` ∩ `…6793d7f..b7247f9` | **交叠 = ∅**。#44 仅 3 个 `ml/gen2/reports/*`；#43 的 `ml/` 文件在 `ml/manifests/*`（不同目录） |
| A2 | **无写入三路合并** | `git merge-tree $(git merge-base 2e8cb7d b7247f9) 2e8cb7d b7247f9` | 退出 0；首行 `merged`；**冲突标记 0**；9 个 `result`（双方均可自动合并）+ **10 个 `added in remote`**（#43 新增文件）；**无 `added in both`** |
| A3 | **补丁可应用 + 结果逐字节等价** | `git archive 2e8cb7d` → `git apply <#43 diff>` | `git apply --check` **干净通过**、实际应用 `APPLY_OK`（523 文件）；**候选树 9 个合并文件的 blob 与 A2 预测 blob 逐位 `MATCH` 9/9** |

> **A3 的等价性证明细节**：A2 的 `result <sha> <path>` 给出「若真做合并，结果 blob 应是什么」。
> 我们把 master 展开后应用 #43 补丁，再对 9 个文件逐一 `git hash-object` 比对 ⇒ **9/9 MATCH**，
> 即 **「master + #43 diff」 ≡ 「git merge master #43」**，逐字节相同。
> 前置校验：以 `README.md` 为探针确认 `git archive` **不做行尾转换**（`2e8cb7d:README.md` blob 与展开树 hash 相等），故 blob 可比。

**只读手法**：**未 `git worktree add`**（那会写 `.git/worktrees/` 元数据）、**未 checkout**、**未写远端**；
候选树由 `git archive` + `git apply` 在 `%TEMP%` 内构造。

---

## 3. GE-02 ACCEPTANCE = **PASS**（在「current master + #43」候选树上重跑）

| # | Release evidence | 命令 | 结果 | 与 ⑦ 轮（base=6793d7f）对比 |
|---|---|---|---|---|
| E1 | Immutable 真 SHA 锁 | `node scripts/verify-immutable.js` | **23/23 PASS** | **完全相同** |
| E2 | Gen-1 生产门禁 G1-A~Y | `node scripts/gen1-production-gates.js` | **25/25 PASS**（含 G1-V/W/X/Y） | **完全相同** |
| E3 | CANARY before/after 逐字段平价 | `GE02_BASE_TREE=<base> node scripts/gen1-guarded-parity-local.js` | **38/38 场景 PASS**；overlay 新增 16 字段全部 dormant 取值 | **完全相同** |
| E4 | 完整链路 | `node scripts/test-all.js` | **47/49**；失败 2 项 | **逐项相同**（见 §4） |

---

## 4. 重点确认：PR #44 的 Gen-2 文档变化**没有**改变任何结果

三方对照（同一脚本、同一本机环境）：

| 树 | Stage A（Node 单测） | 汇总 | 失败项集合 |
|---|---|---|---|
| base `6793d7f` | 37/37 | **43/45** | `unittest discover ml/gen2/tests`；`parity`(Python↔Node) |
| #43 head `b7247f9` | 41/41 | **47/49** | **同上两项** |
| **master `2e8cb7d` + #43** | 41/41 | **47/49** | **同上两项** |

⇒ **候选树与 #43 HEAD 的运行结果逐项相同**；净增 4 项全 PASS、新增失败 0。

2 个失败项**均为 Gen-2 Python 阶段缺 `pandas`**（`ModuleNotFoundError: No module named 'pandas'`），
base 树同样失败 ⇒ **本机环境所致，与 #43 无关，也与 #44 无关**（两者都不是 Python 依赖变更）。

---

## 5. KNOWN NON-BLOCKERS（放行时已知、不阻断）

| 项 | 内容 | 状态 |
|---|---|---|
| **C1** | `ml_effective` 释义过强（快照 §0.2 vs FROZEN 章程 §6.3） | **ERRATA DEFERRED** —— 已登记为 **E22**，归入批次 7；⛔ 不改章程、⛔ 不 amend `a8bf76d`、⛔ 不改 #43 |
| **C2** | `GEN1_CURRENT_STATE_20260910.md:83` 冻结清单仍 6 项（#43 未同步） | 由本 PR 引入的**文档漂移**，随下一 docs 批次同步 |
| **N1** | 冻结绑定观测源缺失 + `build-cloudfunctions.js` 注释措辞过强 | **GE-04 prerequisite / NON-BLOCKING**；不在 #43 源码内修 |
| **N2** | `gen1_guarded_effective_invocations` 「累计」vs「本轮」口径 | 已自登记为 GE-03 锚点 |
| **N3** | domain 门字面多一合取项 | 已实证 `IN_DOMAIN ⇒ ALLOW` 一对一 ⇒ **语义等价** |
| **N4** | schema 16 写 / 14 登记 | 已实证 `validateDoc` 不拒未知字段 ⇒ 不影响运行；建议随 GE-03 补 |

> 上述均**无技术性 merge blocker**。唯一阻断项始终是**治理级 per-PR 放行本身**。

---

## 6. 本门禁**不做**什么

```text
❌ 不合并 #43、不评论、不 approve、不 push
❌ 不改 #43 任何字节（含 N1 那行注释）
❌ 不改 master、不改远端任何 ref
❌ 不 amend a8bf76d、不改 FROZEN 章程
❌ 不部署、不写参数、不动 Authority / FROZEN_PARAM_KEYS / lock / immutable_set
❌ 不进入 GE-03 / GE-04
⚠️ 「READY_FOR_OWNER_DECISION」是**待裁定**标记，不是放行
```

## 7. ⑧ 轮实际写入范围（四块式）

> 本节描述的是 **⑧ 门禁实跑那一轮**的写入面；**第五轮（⑧ 裁定回填）**的写入面见 §12。

```text
ETF 仓库：
- Git 跟踪文件：零修改（git diff --stat HEAD 空）
- Git 历史/分支/远端：零修改（gen1 worktree 仍 6793d7f；monstatus 仍 a8bf76d；
    远端 master=2e8cb7d / #43=b7247f9 / clarify 分支=82debe8 逐位未变）
- 未跟踪本地草稿：GEN1_P2_RELEASE_GATE_20260916.md 新增（仅本地，不入库）；
    GEN1_DOC_ERRATA_20260916.md 有修改（新增 E22）；GEN1_PR43_READONLY_AUDIT_20260916.md 有修改（回填裁定）
其他本机文件：
- WorkBuddy 技能文档有修改（gen1-doc-errata-dedup、gen1-pr-readonly-audit）
- 本地记忆文件有修改（.workbuddy/memory/2026-09-16.md）
- %TEMP% 展开树：g1-p2-gate-tree（候选树）、g1-ge02-audit-tree、g1-ge02-base-tree（均不含 .git，可删）
生产侧：
- 代码 / 配置 / Authority / FROZEN_PARAM_KEYS / lock / immutable_set：零修改
```

> ⚠️ **工具副作用说明（仅发生在临时树内）**：候选树跑 `gen1-production-gates.js` 时，Gate `G1-J` 会把审计结果写回
> **该树内**的 `ml/manifests/GEN1_SECTOR_CONTRACT_AUDIT.json`。因候选树位于 `%TEMP%` 且**不含 `.git`**，
> **仓库被跟踪文件未被触碰**（上轮发生在仓库内的同类副作用，本轮不重现）。

---

## 8. ⑧ 裁定回填（第五轮，2026-09-16）

### 8.1 非阻塞项最终裁定

| 项 | 裁定 | 后续归属 |
|---|---|---|
| **C1 / E22**（`ml_effective` 释义过强） | **非 P2 blocker** | 下一 docs 勘误批次（**批次 7**） |
| **C2 / E23**（`CURRENT_STATE_20260910.md:83` 冻结清单仍 6 项） | **非 blocker** | 文档状态同步处理；**不改历史快照**（该行在 #43 合入前**仍正确**） |
| **N1**（冻结绑定观测源缺失 + 注释措辞过强） | **非 blocker** | **GE-04 硬前置**（⛔ 不在 #43 源码内修、⛔ 不为一句注释重跑 acceptance） |
| **N2**（`invocations`「累计」vs「本轮」口径） | **非 blocker** | **GE-03 前 / 期间**统一 |
| **N3**（domain 门字面多一合取项） | **接受** | 已证明 `IN_DOMAIN ⇒ ALLOW` 一对一 ⇒ **语义等价**，仅记录 |
| **N4**（schema 16 写 / 14 登记） | **非 blocker** | **GE-03 审计字段完善时**处理 |
| 两个 Python / `pandas` failure | **非 blocker** | base 树同样失败 ⇒ **与 #43 无关**（本机环境缺依赖） |

### 8.2 归档口径

```text
⑧ P2 RELEASE GATE              PASS
Technical merge blocker         NONE FOUND
C1                              ERRATA DEFERRED（→ E22，批次 7）
C2                              DOC-SYNC DEFERRED（→ E23，批次 7；不改历史快照）
N1                              GE-04 PREREQUISITE / NON-BLOCKING
MERGE AUTHORIZATION             NOT YET GRANTED（**⑧ 轮归档时点**；其后已由 §9.2 owner release 覆盖 → GRANTED）
P2 release                      STILL P2_PENDING_PR_RELEASE（改判条件见 §11）
```

---

## 9. Owner Release Gate（放行前置 —— **未满足即不得合并**）

**性质**：**一次性授权请求 + 实际放行记录**。§9 定义「放行语句必须覆盖什么」；
**§9.2 为实际放行记录（已到位）**；§9.1 为执行通道事实（**已三处更正，末次含「写被证否」实证**）；
§9.3 为执行者（**用户 2026-09-16T15:21 授权 agent 代合；受令牌无写权限阻却**）。

**须被显式解锁的边界项**：`FROZEN_PARAM_KEYS` 由 **6 项**扩为 **7 项**（新增 `gen1_authority`）。

**放行语句须覆盖的 5 要点**（缺一即视为放行不成立）：

```text
① 放行对象：仅 PR #43（WP-G1-GE-02），非泛化许可
② 一次性例外：明确批准 #43 中「gen1_authority 纳入 FROZEN_PARAM_KEYS」的变更
③ 边界延续：其他 lock / immutable_set 边界继续保持
④ 合并方式：以 merge commit 合并到当前 master（不 squash / 不 rebase / 不点 Update branch）
⑤ 合并后边界：不部署、不改线上 authority、不写生产配置、不进入 GE-03
```

> ✅ **2026-09-16 owner release 已覆盖上述 5 要点**（逐条比对见 §9.2）。
> ⚠️ 放行语句若**缺少 ②**，则 `FROZEN_PARAM_KEYS` 变更**未获授权** ⇒ **不得合并**（本次**不缺**）。
> ⚠️ 放行语句本身**不构成**推进线上状态的授权：合并后线上仍应为
> `gen1_authority = CANARY`、`ml_effective = false`、`P2 = P2_PENDING_PR_RELEASE`。

### 9.1 合并动作的可执行性（**事实，非授权** —— 本轮经三处更正/实证，末次为「**写被证否**」实证）

| 项 | 状态（2026-09-16T14:56 实读） |
|---|---|
| 本机 `gh_token.txt` PAT —— **读路径** | **可用**：本轮 3 次 GET 全部 `200` |
| 本机 `gh_token.txt` PAT —— **写路径（merge 动作）** | ⛔ **已实证：merge 不可用**。2026-09-16T15:2x 执行**用户已授权的目的动作** `PUT /repos/iquelee/etf-decision-engine/pulls/43/merge`（`merge_method=merge` + `sha=b7247f9…`）⇒ **`403 Resource not accessible by personal access token`**。该写请求**不是探测**（它就是用户授权的合并本身）⇒ 其 `403` 是**合法的「该动作被证否」证据** |
| 本机 `gh_token.txt` PAT —— **写路径（建 PR 动作）** | ✅ **已实证：可用**。2026-09-16T16:59 执行**用户已授权的目的动作** `POST /repos/iquelee/etf-decision-engine/pulls`（`head=docs/gen1-p2-closure`）⇒ **`201 Created`**（建成 **PR #46**）⇒ 同一 PAT 的 `Pull requests: write` **可用**；merge 的 `403` 应归因于 **`Contents` 侧不足**（merge 会在 base 分支上写提交） |
| **git / SSH 通道**（`git@github.com:iquelee/etf-decision-engine.git`） | ✅ **已实证：可写**。2026-09-16T16:59 `git push -u origin docs/gen1-p2-closure` ⇒ **成功**（远端 SHA 与本地 HEAD 逐位一致） |
| MCP GitHub App 连接器 | 写入路径返回 `403`（本轮**已复查**：`POST /pulls` ⇒ `403 Resource not accessible by integration`） |
| ⇒ **执行通道（结论，按「通道 × 动作」分层；2026-09-16T17:0x 更新）** | **分支推送（SSH）**：✅ 可用；**建 PR（fine-grained PAT）**：✅ 可用；**merge（fine-grained PAT）**：⛔ 不可用；**MCP App 写路径**：⛔ 不可用。<br>⇒ 分支推送与 **PR 创建** agent 可代做；**merge** 需 ① 给该 PAT 补 `Contents: Read and write`，或 ② 由所有人在 Web UI 执行 |

> 📌 **更正留痕（三处：前两处方向相反、均已撤回；第三处为末次实证）**
> **① 上一轮**：「本机令牌为**只读** ⇒ merge 必须在 Web UI 执行」。其**唯一依据**是「无 `X-OAuth-Scopes` 头」；
> 该依据**不成立**（细粒度令牌**从不**发送此头 ⇒ 其缺省**不构成**只读证据）⇒ 「只读」断言**撤回**。
> （该断言亦与既定边界冲突：本机既有规则本就要求只能写「读权限可用、未发现写能力证据」。）
> **② 本轮初稿**：由 `permissions.push=true` 直接推出「**具备仓库写权限**」—— 同样**超出证据**（归属未证明）⇒ 亦**撤回**。
> **③ 中途表述（2026-09-16T14:56 ～ 15:2x 之间）**：**读已证；写既未证「有」、也未证「无」** ——
> 当时须由所有人在 GitHub Settings → Fine-grained tokens **页面侧**核对。
> **④ 末次实证（2026-09-16T15:2x —— 写已证否）**：用户授权 agent 代合后，执行
> `PUT …/pulls/43/merge` ⇒ **`403 Resource not accessible by personal access token`**
> ⇒ 「**写被证否**」由**授权的写动作**合法取得。
> ⚠️ **「结论对 ≠ 推理对」**：**①** 那条「只读」的**结论现已被证实正确**，但其**依据仍属错误** —— 不得据错误依据重写历史。
> ⛔ **取得「写被证否」的唯一合法途径**就是**执行已被授权的写动作**；**不得**用「故意发写请求探测」。
> 上述更正**不改变** §9 的 5 要点与 §10 的已审计对约束。
>
> **⑤ 第八轮更正（2026-09-16T17:0x ——「写被证否」必须限定「通道 × 动作」）**：本轮执行两件**均已获授权**的写动作，结果**不一致** ——
> `git push`（SSH 通道）⇒ **成功**；`POST /repos/…/pulls`（fine-grained PAT）⇒ **`201`**；
> 而同一轮 `POST /repos/…/pulls`（MCP App 通道）⇒ **`403 by integration`**。
> ⇒ 「写被证否」只是**某一通道上某一动作**的结论，⛔ **不得**推广成「整个身份写被证否」。
> ⚠️ 这与 **④ 的「结论对 ≠ 推理对」不是同一类问题**：④ 是**依据错、结论对**；⑤ 是**结论本身过强，必须加限定**。
> 📌 已登记为勘误 **E26**。

### 9.2 放行记录（owner release，2026-09-16）

**发布人**：项目所有人（李其）
**记录时刻**：2026-09-16T14:56+0800
**性质**：**一次性例外**，仅针对本 PR；**不泛化**。

**原话（逐字）**：

```text
放行 PR #43。仅针对 WP-G1-GE-02，本次明确批准 PR #43 中将 gen1_authority 纳入
FROZEN_PARAM_KEYS 的变更；此前"不修改 gen1_authority / FROZEN_PARAM_KEYS"的限制对此 PR
作一次性例外。其他 lock / immutable_set 边界继续保持。批准基于已审计组合
master=2e8cb7d + PR #43 head=b7247f9，不得 rebase、不得 Update branch、不得 squash。
允许以 Create a merge commit 合并；合并后不部署、不修改线上 authority、不写生产配置、
不进入 GE-03。合并完成后必须先通过 P2 Post-Merge Attestation，PASS 后才可把状态改为
P2_COMPLETE_DORMANT。
```

**与 §9 五要点逐条比对**：

| 要点 | 放行语句对应文字 | 判定 |
|---|---|---|
| ① 仅 PR #43 | 「仅针对 WP-G1-GE-02」「放行 PR #43」 | ✅ |
| ② **一次性例外**（关键，缺则不得合并） | 「本次明确批准 PR #43 中将 `gen1_authority` 纳入 `FROZEN_PARAM_KEYS` 的变更」+「对此 PR 作一次性例外」 | ✅ |
| ③ 其他边界延续 | 「其他 lock / immutable_set 边界继续保持」 | ✅ |
| ④ 合并方式 = merge commit | 「不得 rebase、不得 Update branch、不得 squash」「允许以 Create a merge commit 合并」 | ✅ |
| ⑤ 合并后边界 | 「不部署、不修改线上 authority、不写生产配置、不进入 GE-03」 | ✅ |

**附带约束（放行语句自带）**：合并基线锁定为**已审计对** `master = 2e8cb7d` + `#43 head = b7247f9`；
合并完成后**必须先通过 §11 Post-Merge Attestation**，PASS 后方可把 `P2` 改判为 `P2_COMPLETE_DORMANT`。

### 9.3 执行者（**用户 2026-09-16T15:21 授权变更：由 agent 代合**）

| 候选 | 说明 | 判定（as-of 2026-09-16T15:2x+0800） |
|---|---|---|
| **(A) agent 以本机 PAT 调合并 API**（`PUT /repos/…/pulls/43/merge`，`merge_method=merge` + `sha=b7247f9` 锁定已审计 head） | 用户**已明确授权**（原「方案 A」废止）；`sha` 参数使 GitHub 对 head 已变的请求返回 `409` ⇒ **无法误合并非审计对象**，亦无法误用 squash | ⛔ **实测受阻 —— 令牌无写权限**：`403 Resource not accessible by personal access token`（2026-09-16T15:2x） |
| (B) 用户在 GitHub Web UI 点 *Create a merge commit* | 不需令牌写权限 | ✅ **merge 动作的唯一当前可执行路径**（除非先给该 PAT 补 `Contents: Read and write`）。⚠️ 本行**只针对 merge** —— 分支推送与 **PR 创建** agent 均可代做（实证见 §9.1 ⑤ / §19 / 勘误 **E26**） |

> **（A）解阻条件**：用户在 Settings → Fine-grained tokens 为该令牌补 `Pull requests: Read and write`
> **且** `Contents: Read and write`（merge 会写 base 分支）；之后 agent 可执行
> `PUT /repos/iquelee/etf-decision-engine/pulls/43/merge`，body `{"merge_method":"merge","sha":"b7247f9dcec116b5d12daf17a1320683a7dbc5ed"}`。
> ⛔ 无论由谁执行，均**不得**先点 `Update branch`、**不得** squash、**不得** rebase。
> ⚠️ 因 `mergeable_state=behind`，Web UI 上**会出现** `Update branch` 按钮 —— **不要点它**，直接点 **`Create a merge commit`** 即可（`behind` 不影响 merge commit 方式合并）。

---

### 9.4 第二轮 owner release：P2 Closure docs-only PR（2026-09-16，第九轮）

**发布人**：项目所有人（李其）
**记录时刻**：2026-09-16T16:40+0800
**性质**：**只授权建 PR，不授权 merge**。

**原话（要点摘录；引号内为逐字片段）**：

```text
「我现在正式授权一个 P2 Closure docs-only PR，但只授权建 PR，不自动授权 merge。」
收口范围 = 4 份历史/治理文档：
  GEN1_P2_RELEASE_GATE_20260916.md
  GEN1_P2_POST_MERGE_ATTESTATION_20260916.md
  GEN1_PR43_READONLY_AUDIT_20260916.md
  GEN1_DOC_ERRATA_20260916.md
「允许包含 D1、E22–E25 的最终状态。」
「不要把 GEN1_GE03_DESIGN_GATE_DRAFT_20260916.md 混进这个 PR。」
```

**五要点逐条比对**：

| 要点 | 内容 | 判定 |
|---|---|---|
| ① 对象 | **且仅**上述 **4 份**文档 | ✅ |
| ② 内容 | 允许包含 **D1** 与 **E22–E25** 的最终状态 | ✅ |
| ③ **排除项** | ⛔ **不得**包含 GE-03 设计文档 —— 「P2 是已经完成的历史闭环；GE-03 是下一阶段的未来授权，两者分开最干净」 | ✅ |
| ④ 授权边界 | **只授权建 PR**；⛔ **merge 未授权** | ✅ |
| ⑤ 生产边界 | 沿用 §9.2 ⑤：不部署、不改线上 authority、不写生产配置、不进 GE-03 代码阶段 | ✅ |

> ⛔ **本放行不得被读成「该 PR 可合并」** —— 合并须**另行**获得 owner 放行。
> ⛔ **不得把 GE-03 设计文档夹带进本 PR**，即使它已收为最终版。
> 📌 **名称指引**：上述被排除的文件在第九轮已按 Q1–Q6 裁定收为**最终版**并改名为
> `GEN1_GE03_DESIGN_GATE_20260916.md`（前身 `GEN1_GE03_DESIGN_GATE_DRAFT_20260916.md`，已删除）。
> **排除要求不变** —— 新旧两个文件名都**不得**进入本 PR。

---

## 10. 执行约束：已审计对**必须**保持不动

**⑧ 的全部证据仅对下列一个 SHA 对成立：**

```text
current master = 2e8cb7da752aaab37deea4cfa27f937e1839f92c
#43 head       = b7247f9dcec116b5d12daf17a1320683a7dbc5ed
merge-base     = 6793d7f29ba161cf18166233d844f284696f7417
```

**放行前实时复核（2026-09-16T14:56:37+0800）**：`git ls-remote origin refs/heads/{master,feat/wp-g1-ge-02-dormant}` 逐位比对 ⇒
**三者与上表完全一致**（`master` 未被再次推进、`#43 head` 未变）⇒ §10 约束在放行时点**仍然成立**。
PR 侧只读复核：`state=open`、`merged=false`、`merged_at=null`、`head.sha=b7247f9…`、`mergeable=true`、`mergeable_state=behind`（head 落后 master，属预期，**不构成阻断**）、`changed_files=19`、`+2226 −26`。
⚠️ **判据提醒（易误读）**：**未合并**状态下 PR 也会返回 `merge_commit_sha`（本轮为 `845bd39…`）—— 那是 GitHub 为**预演合并**生成的临时提交，**不是**「已合并」的证据，且真合并后会变。**是否已合并只看 `merged` / `merged_at`。**

| ⛔ 禁止 | 原因 |
|---|---|
| `git rebase` #43 分支 | 产生新 HEAD SHA ⇒ **已审计对象被替换**，⑧ 证据全部作废 |
| GitHub UI 的 **`Update branch`**（**放行前**） | 等价于把 master 合进分支 ⇒ 新 HEAD。⛔ **放行前**不得点；**若已发生**，须先按下方四条判据证明**等价替换**，否则本 Gate 失效、须重跑 |
| **Squash merge** | 破坏 `b6da0a3 feat` + `b7247f9 fix` 两段式链；RULING §6 要求保留「Gen-1 如何取得权限」的审计链 |
| 放行前把 `master` 推进到新 SHA | §2 的兼容性证明失效 ⇒ 须**重跑 ⑧** |

> **判据（第九轮按 E25 改为条件式，取代原「父 SHA 恒等」绝对措辞）**：

```text
第 1 层 · 回溯判定 —— 用于「已经发生」的 head 前进
   仅当下列四条同时成立，才判为「等价替换」，不重开门禁：
   (a) 已审计 head 是新 head 的祖先（非 rebase / 非 squash）；
   (b) 新 head 的另一父恰为已审计 base（无第三方提交）；
   (c) 变更文件集与行数规模与已审计变更集完全一致；
   (d) 每个变更文件在新旧头之间逐 blob 相同。
   任一条不满足 ⇒ 本 Gate 失效，须重跑 ⑧。

第 2 层 · 前向规则 —— 用于「尚未 merge」的 PR
   head 一变（Update branch / rebase / force-push）⇒ 原审计对象即刻失效；
   必须重新冻结新 head、并对新 head 重新验收
   （重跑 required CI + 重做等价 / 闭合证明），之后才可以 merge。
   ⛔ 不得以「内容看起来没变」为由沿用旧审计结论。
```

> ⛔ **不得把第 1 层当作第 2 层的放行依据** —— 那是把「事后可证」误读成「事前免检」。
> ⛔ **本判据不得回写为绝对式**（如「父必须恰为 X + Y」）—— 绝对式无法表达合法的等价前进，必然再生矛盾。
> 📌 第 1 层在第 ⑧ 次的适用结果 = 偏差 **D1**，已由 owner 裁定为**等价替换**并结案（§0.d）。

> **若 `master` 在某 PR 放行前被外部推送再次推进**（本日已发生 **2 次**：`6793d7f → 2e8cb7d`，
> 以及合并之后的 `c9af16b1 → 44b59b8`），则**该次放行的兼容性结论失效** ⇒ 须**重跑 ⑧**（§2 三项 + §3 四项），
> **不得沿用旧结论**。
> ⚠️ **合并已完成之后**发生的 master 前进**不回溯**推翻已完成的合并（§11 Attestation 的结论是 **as-of `c9af16b1`** 的），
> 但**新 PR（含 P2 Closure docs-only PR）必须以当时实读的 master 为 base**，并重新核对「零 Gen-1 影响」。

---

## 11. P2 Post-Merge Attestation（**合并后**执行；定义先行）

**触发条件**：merge 完成之后。**在 Attestation PASS 之前，不得进入 GE-03。**

| # | 核验项 | 方法（只读） | 判据 |
|---|---|---|---|
| A1 | merge commit **只组合了已审核内容** | `git log -1 --format=%P <merge_sha>`；`git diff --stat 2e8cb7d..<merge_sha>` | 父**含** `2e8cb7d`；另一父为已审计 head（`b7247f9`）**或其以已审计 head 为第一父、以已审计 base 为第二父的合并提交**，且满足 §10 四条判据 (a)–(d)；diff 面 ⊆ #43 的 19 文件 |
| A2 | 无 squash / 无 rebase 痕迹 | `git rev-list --parents -n 1 <merge_sha>`；`git log --oneline <merge_sha> -3` | 双亲；`b6da0a3`、`b7247f9` 仍可达 |
| A3 | **selector 仍恒 `BASELINE`** | 读 `src/common/utils/gen1-guarded-selector.js` + 跑 `tests/gen1-guarded-selector-noop.test.js` | 无条件 BASELINE；测试 PASS |
| A4 | **Freeze / Evidence Seal 仍 `PENDING`** | 读 `ml/manifests/GEN1_GUARDED_EFFECTIVE_{FREEZE,EVIDENCE}.json` | 两制品 `status = PENDING`；`independent_events = 0` |
| A5 | `production_write = false`、`auto_execution = false` | 读 `src/common/utils/gen1-authority.js` 全档表 + 跑 authority 测试 | **全档**恒 false |
| A6 | Immutable 锁逐位未变 | `node scripts/verify-immutable.js` | **23/23 PASS**（`gen1_authority` 入清单**不**改变被锁对象的真 SHA） |
| A7 | Gen-1 门禁 | `node scripts/gen1-production-gates.js` | **25/25 PASS** |
| A8 | **线上** authority 未被顺带改动 | 只读 `runtime_status` | `gen1_authority = CANARY`；`ml_effective = false` |

**判定**：

```text
全部 PASS  ⇒  P2_PENDING_PR_RELEASE  →  P2_COMPLETE_DORMANT   （此时才可开始规划 GE-03）
任一 FAIL  ⇒  停止推进；按失败项另立修复项，不得进入 GE-03
```

### 11.1 实跑结果（2026-09-16T16:21:06+0800，合并后只读核验）

| # | 结果 | 关键实测值 |
|---|---|---|
| A1 | ⚠️ **PASS（等价替换）** | 双亲 = `2e8cb7d` + `6a771a1`（非 `b7247f9`）；`diff 2e8cb7d..c9af16b1` **恰为 19 文件**；等价性由 5 条证据链证明（见后文 A1 注） |
| A2 | ✅ PASS | 双亲成立；`b6da0a3` / `b7247f9` 可达 rc=0 ⇒ **无 squash、无 rebase** |
| A3 | ✅ PASS | `GE_02_BASELINE_AUTHORITATIVE = true`；selector 恒 `BASELINE`；`gen1-guarded-selector-noop` PASS |
| A4 | ✅ PASS | FREEZE `PENDING` / `approved_at = null` / `bindings INCOMPLETE`；EVIDENCE `PENDING` / `independent_events = 0` |
| A5 | ✅ PASS | 全档 `production_write = false`、`auto_execution = false`；`PRODUCTION_LOCKED = true` |
| A6 | ✅ PASS | `verify-immutable.js` = **23 / 23** |
| A7 | ✅ PASS | `gen1-production-gates.js` = **25 / 25**（G1-A ~ G1-Y） |
| A8 | ✅ PASS | 线上 `gen1_authority = CANARY`、`ml_effective = false`（`updated_at = 2026-09-16T00:00:26.690Z`） |
| 附 | ✅ PASS | 平价 `38 / 38`；关键单测 5 项 PASS |

**A1 的等价性证据链（本轮新增，只读）**：

```text
P1  git merge-base --is-ancestor b7247f9 6a771a1  ⇒ 成立（已审计 head 是 6a771a1 第一父）
P2  git rev-list --parents -n 1 6a771a1           ⇒ 父② = 2e8cb7d（已审计 master，无第三方提交）
P3  diff(6793d7f→b7247f9) ≡ diff(2e8cb7d→6a771a1)  ⇒ 均 19 文件 / +2226 −26
P4  逐 blob rev-parse（b7247f9:x vs 6a771a1:x）    ⇒ 19 / 19 相同
P5  patch-id 两侧                                  ⇒ 同为 1bd45c90b02a280f08f711d225a18858569913bf
C1  tree(c9af16b1) == tree(6a771a1)               ⇒ 全树 523 文件逐 blob 差异 0（真合并未附加任何改动）
C2  变更闭合：22 个变更文件与来源树 blob 一致      ⇒ mismatch 0
C5  git merge-tree 2e8cb7d 2e8cb7d 6a771a1        ⇒ `merged`、result blob 9/9 命中、冲突 0
```

> ✅ **A1 的判据措辞已改**：原判据写「父**恰为** `2e8cb7d` + `b7247f9`」——绝对措辞无法覆盖
> 「head 因 `Update branch` 前进但其内容可证等价」这一情形。**第九轮已按 E25 落定为条件式**（见 §11 A1 判据行与 §10）：
> 「父含 `2e8cb7d`；另一父为已审计 head **或其以已审计 head 为第一父、以已审计 base 为第二父的合并提交**，
> 且满足 §10 四条判据 (a)–(d) ⇒ 视为等价替换，不重开门禁。」
> ⛔ **同时生效的前向规则**：此后 head 一变即**原审计对象失效**，须**重冻 + 重验收**才能 merge —— 本次的「事后可证」路径**不构成先例**。

**结论**：`P2_PENDING_PR_RELEASE` → **`P2_COMPLETE_DORMANT`**（A1 的偏差 D1 已登记，归档口径待裁定，见 §0.c）。

> ⚠️ Attestation **本身不放行 GE-03**；它只把 P2 改判为 `P2_COMPLETE_DORMANT`。
> 进入 GE-03（Shadow / Replay / Negative Gates）仍须**另行授权**。

---

## 12. 第五轮（⑧ 裁定回填）实际写入范围（四块式）

```text
ETF 仓库：
- Git 跟踪文件：零修改（git diff --stat HEAD 空）
- Git 历史/分支/远端：零修改（gen1 worktree 仍 6793d7f；monstatus 仍 a8bf76d clean；
    远端 master=2e8cb7d / #43=b7247f9 / clarify 分支=82debe8 逐位未变）
- 未跟踪本地草稿：本文件有修改（§0 裁定后状态 + §8–§12）；
    GEN1_DOC_ERRATA_20260916.md 有修改（新增 E23 + 批次 7 + 归属表 + §6.5）；
    GEN1_PR43_READONLY_AUDIT_20260916.md 有修改（§9 C2 裁定 + §10 回填）
其他本机文件：
- WorkBuddy 技能文档：gen1-pr-readonly-audit 补「post-merge attestation」步骤；
    gen1-doc-errata-dedup 补「owner override 待授权项」登记规范
- 本地记忆文件有修改（.workbuddy/memory/2026-09-16.md）
- %TEMP% 展开树：g1-p2-gate-tree、g1-ge02-audit-tree、g1-ge02-base-tree（不含 .git，可删）
生产侧：
- 代码 / 配置 / Authority / FROZEN_PARAM_KEYS / lock / immutable_set：零修改
```

---

## 13. 第六轮（owner release 回填）实际写入范围（四块式）

```text
ETF 仓库：
- Git 跟踪文件：零修改（git diff --stat HEAD 空）
- Git 历史/分支/远端：零修改（gen1 worktree 仍 6793d7f；monstatus 仍 a8bf76d clean；
    远端 master=2e8cb7d / #43=b7247f9 / clarify 分支=82debe8 逐位未变）
- 未跟踪本地草稿：本文件有修改（§0.b 放行后状态 + §8.2 时点限定 + §9.1 更正 +
    §9.2 放行记录 + §9.3 执行者 + §10 放行前复核 + §13/§14（**按第六轮落笔时的节号**；§14 后已顺延为 §15））；
    GEN1_PR43_READONLY_AUDIT_20260916.md 有修改（放行回填）
- 本机只读 API 调用：3 次 GitHub GET（仓库元信息 1 次 + PR #43 2 次），均未产生远端变更
其他本机文件：
- WorkBuddy 技能文档有修改（gen1-pr-readonly-audit「执行通道」更正；github-pr-ops-windows「只读判定」更正）
- 本地记忆文件有修改（.workbuddy/memory/2026-09-16.md）
生产侧：
- 代码 / 配置 / Authority / FROZEN_PARAM_KEYS / lock / immutable_set：零修改
- 线上 `runtime_status`：零写入（本轮**未复读**线上，故不新增线上时点读数）
```

---

## 14. 第七轮（代合授权变更回填）实际写入范围（四块式）

```text
ETF 仓库：
- Git 跟踪文件：零修改（git diff --stat HEAD 空）
- Git 历史/分支/远端：零修改（gen1 worktree 仍 6793d7f；monstatus 仍 a8bf76d clean；
    远端 master=2e8cb7d / #43=b7247f9 / clarify=82debe8 逐位未变）
- 未跟踪本地草稿：本文件有修改（头信息 + §0 + §9.1/§9.3 + §14）；
    GEN1_PR43_READONLY_AUDIT_20260916.md 有修改（§11 更正与实证回填）
- 本机 GitHub API 调用：1 次 GET（对照探针）+ 1 次**写**（`PUT …/pulls/43/merge`）
    ⇒ **写被 `403` 拒绝，远端零变更**（`merged=false` 实测确认）
其他本机文件：
- WorkBuddy 技能文档有修改（github-pr-ops-windows「策略」段；gen1-pr-readonly-audit「执行通道」段 + 坑表 3 行）
- 用户级 `~/.workbuddy/MEMORY.md` 有修改；本记忆文件有修改
生产侧：
- 代码 / 配置 / Authority / FROZEN_PARAM_KEYS / lock / immutable_set：零修改
- 线上 `runtime_status`：零写入（本轮未复读）
```

---

## 15. 放行之后的下一步（**不由本文件授权**）

```text
1) 执行 merge（执行者见 §9.3）—— ⛔ 不点 Update branch、⛔ 不 squash、⛔ 不 rebase
2) 合并完成后，以远端实读取得 merge commit SHA（本文件不预写其结果）
3) 跑 §11 Post-Merge Attestation（A1–A8，全只读）
4) 全 PASS ⇒ 可把 P2 改判为 P2_COMPLETE_DORMANT（改判前仍为 P2_PENDING_PR_RELEASE）
5) 进入 GE-03（Shadow / Replay / Negative Gates）仍须**另行授权**
```

---

## 16. 第八轮（合并后 Attestation）实际写入范围（四块式）

```text
ETF 仓库：
- Git 跟踪文件：零修改（git diff --stat HEAD 空）
- Git 历史/分支/远端：远端 master 已由所有人于 2026-09-16T16:06:26+08:00 推进为 c9af16b1
    —— 该变更**不是本轮**产生；本轮仅只读观测（fetch + ls-remote + merge-tree + archive 导出）。
    gen1 worktree 仍 6793d7f；monstatus 仍 a8bf76d 干净；本轮未 push、未建 PR、未改任何 ref
- 未跟踪本地草稿：本文件有修改（头信息 + §0.c + §11.1 + §16）；
    GEN1_P2_POST_MERGE_ATTESTATION_20260916.md 新增；
    GEN1_DOC_ERRATA_20260916.md 有修改（E23 过期结案 + 新增 E24/E25 + 批次 7 + §6.6）；
    GEN1_GE03_DESIGN_GATE_DRAFT_20260916.md 新增（设计草案，未获批）
- 本机只读 API 调用：GitHub 2 次 GET（PR #43 get / check_runs）+ CloudBase 1 次只读集合查询
其他本机文件：
- WorkBuddy 技能文档有修改（gen1-pr-readonly-audit、gen1-doc-errata-dedup）
- 本地记忆文件有修改（.workbuddy/memory/2026-09-16.md）
- %TEMP% 展开树：g1-p2-postmerge-tree（合并树 523 文件）、g1-ge02-base-tree（基线树），均不含 .git，可删
生产侧：
- 代码 / 配置 / Authority / FROZEN_PARAM_KEYS / lock / immutable_set：零修改
- 线上 `runtime_status`：零写入（只读 1 次）
```

---

## 17. §15 的执行结果

```text
1) 执行 merge                       ✅ 已由所有人于 16:06:26 完成（Create a merge commit）
2) 以远端实读取得 merge commit SHA   ✅ c9af16b1e56d299394ae9cdba457b8eef05da943
3) 跑 §11 Post-Merge Attestation     ✅ 已实跑，A1 记「等价替换」，A2–A8 全 PASS（§11.1）
4) 改判 P2                          ✅ P2_PENDING_PR_RELEASE → P2_COMPLETE_DORMANT
5) 进入 GE-03                       ⛔ 仍未授权 —— 设计文档已收为**最终版**，但
                                    `GE03_DESIGN_GATE = PENDING FINAL DOC REVIEW`、
                                    `IMPLEMENTATION_AUTHORIZATION = NOT GRANTED`
6) D1 归档口径裁定                   ✅ 第九轮裁定 = 等价替换（PROCESS DEVIATION / NON-SAFETY / CLOSED）
7) P2 Closure docs-only PR           ✅ 已获放行**建 PR**（§9.4）；⛔ merge 未授权
```

---

## 18. 第九轮（D1 结案 + 二次漂移复核 + P2 Closure PR）实际写入范围（四块式）

```text
ETF 仓库：
- Git 跟踪文件：零修改（git diff --stat HEAD 空）
- Git 历史/分支/远端：① 远端 master 被**外部**推进为 44b59b8（PR #45，纯 Gen-2；**非本轮**产生，
      本轮仅只读观测：fetch / ls-tree / archive 导出 / 门禁复跑）；
    ② 本轮**新建** P2 Closure 载体分支并提交 4 份文档，并按 §9.4 的放行**建 PR**（⛔ 不 merge）
      ⇒ 该分支的 push 与 PR 创建是**本轮**产生的远端变化
- 未跟踪本地草稿：本文件有修改（头信息 + §0.b/§0.c/§0.d + §9.4 + §10 + §11 + §17 + 本 §18）；
    GEN1_DOC_ERRATA_20260916.md 有修改（E23 裁定 + E24/E25 裁定 + E25 前向规则 + 批次 7 + 归属表 + §6.7）；
    GEN1_P2_POST_MERGE_ATTESTATION_20260916.md 有修改（D1 结案 + §7 master 漂移复核）；
    GEN1_PR43_READONLY_AUDIT_20260916.md 有修改（§12 D1 结案回填）；
    GE-03 设计文档：由 `..._DRAFT_20260916.md` 收为**最终版**（另名，不进本 PR）
- 本机只读 API 调用：GitHub 3 次 GET（get_commit / list_commits ×2）；CloudBase 本轮未调用
其他本机文件：
- WorkBuddy 技能文档有修改（gen1-pr-readonly-audit、github-pr-ops-windows、gen1-doc-errata-dedup）
- 本地记忆文件有修改（.workbuddy/memory/2026-09-16.md、项目级 MEMORY.md）
- %TEMP% 展开树：g1-master44-tree（44b59b8 树 524 blob，不含 .git，可删）
生产侧：
- 代码 / 配置 / Authority / FROZEN_PARAM_KEYS / lock / immutable_set：零修改
- 线上 `runtime_status`：零写入
```

---

## 19. 第九轮追加：写入能力的「通道 × 动作」结论（含 PR #46 建单实证）

| 通道 | 动作 | 结果 | 证据（均为**已获授权动作**的副产物） |
|---|---|---|---|
| **git / SSH**（`git@github.com:iquelee/etf-decision-engine.git`） | `git push` 新分支 | ✅ **可用** | `docs/gen1-p2-closure` 推送成功；远端 SHA 与本地 HEAD 逐位一致（`9b401c1…`） |
| **fine-grained PAT**（`~/.workbuddy/gh_token.txt`，经 `gh.sh`） | `POST /repos/…/pulls`（建 PR） | ✅ **可用** | `201 Created` ⇒ **PR #46** |
| 同上 | `PUT /repos/…/pulls/43/merge` | ⛔ **不可用** | `403 Resource not accessible by personal access token` |
| **MCP GitHub App 连接器** | `POST /repos/…/pulls` | ⛔ **不可用** | `403 Resource not accessible by integration` |

**可执行分工（结论）**：

```text
分支推送            agent 可代做（SSH）
PR 创建             agent 可代做（fine-grained PAT）
PR merge            ⛔ agent 不可代做 —— 需 ① 给该 PAT 补 Contents: Read and write，或 ② 所有人 Web UI
```

⚠️ 本节**修正了 §9.1 ④ 的表述口径**：原「写被证否」未限定通道与动作 ⇒ 已登记为勘误 **E26**。
⛔ 本节结论**仅覆盖上表 4 条「通道 × 动作」组合**，⛔ **不得外推**到其他通道或动作。

**P2 Closure docs-only PR 的落地情况（本轮）**：

```text
载体分支     docs/gen1-p2-closure（基于 44b59b8 创建）
PR           #46  https://github.com/iquelee/etf-decision-engine/pull/46
             （open；merged = false；changed_files = 4；+1979 −0）
⚠️ head SHA  本文件**不记录该分支的 head SHA** —— 它会随追加提交不断前进，属**自指状态**，
             写下的那一刻即过期；一律以远端实读为准。"Base + PR 编号" 才是稳定标识。
含           4 份文档（Gate / Attestation / ⑦ 只读审计 / 勘误表）
⛔ 不含      GE-03 设计文档（§9.4 ③ 排除项）
merge        ⛔ NOT AUTHORIZED（owner 放行原文：「只授权建 PR，不自动授权 merge」）
```

> ⚠️ **本节记录的是「放行 → 落地」的事实**，⛔ **不构成 merge 授权**。

---

*本文件为放行前门禁留痕：`MERGE AUTHORIZATION = GRANTED` 表示**放行条件已满足**，**不表示合并已完成**，也不授权任何生产变更。
`gen1_authority` 保持 `CANARY`；`ml_effective` 保持 `false`。合并已于 2026-09-16T16:06:26+08:00 完成（`master = c9af16b1`）；
`P2` 已由 §11.1 的实跑结果改判为 **`P2_COMPLETE_DORMANT`**；偏差 **D1** 已于第九轮裁定为**等价替换**并 **CLOSED**。
⚠️ 上述 `master` SHA 均为 **as-of 值**，当前 master 见 §0.d（以远端实读为准）。*
