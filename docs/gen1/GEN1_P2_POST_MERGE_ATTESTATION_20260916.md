# P2 Post-Merge Attestation —— `P2_POST_MERGE_ATTESTATION`（全部只读）

**文档编号**：`GEN1-P2PM-1.0`
**性质**：合并**已发生**之后的事后核验记录（post-merge attestation）—— 所有证据**只读取得**；本文件本身**未部署、未写线上**
**as-of**：2026-09-16T16:21:06+0800（实跑取证时刻）
**最近更新**：2026-09-16T16:49:17+0800+0800（**第九轮**：**D1 已由 owner 裁定并结案**；新增 **§7** —— `master` 二次漂移（`c9af16b1 → 44b59b8`，PR #45）的 Gen-1 零影响复核）
**上游文件**：同目录 `GEN1_P2_RELEASE_GATE_20260916.md`（`GEN1-P2RG-1.0`）§11 定义先行 → 本文件为其实跑结果
**核验对象**：`master` = `c9af16b1e56d299394ae9cdba457b8eef05da943`（PR #43 合并提交）—— **as-of 值**，当前 master 见 §7
**审计基线（放行时冻结）**：`master = 2e8cb7da752aaab37deea4cfa27f937e1839f92c` + `#43 head = b7247f9dcec116b5d12daf17a1320683a7dbc5ed`
**合并实际输入 head（`Update branch` 后，即合并提交的第二父）**：`6a771a1829ccf9f03c933be6f9d100c8b5ddfe4a`（偏差 **D1** 的载体）

---

## 0. 结论区

```text
P2_RELEASE                    COMPLETE
P2_POST_MERGE_ATTESTATION     PASS（含 1 项已登记的偏差 D1，判定为「等价替换」，不构成门禁失效）
P2_STATE                      P2_COMPLETE_DORMANT
master                        c9af16b1
selector                      BASELINE only
Freeze Seal                   PENDING
Evidence Seal                 PENDING
production_write              false
auto_execution                false
D1                            CLOSED（等价替换；PROCESS DEVIATION / CONTENT-PRESERVING / RE-ATTESTED / NON-SAFETY）
```

**本轮明确未做**：❌ 未部署、❌ 未改线上 `gen1_authority`、❌ 未写生产配置、❌ 未进入 GE-03。

> ✅ **D1 必须随结论一起读，且已于第九轮结案**：合并实际使用的 head 已由 `b7247f9` 前进为 `6a771a1`
> （GitHub `Update branch` 产生合并提交），与放行语句 §9.2 第 ④ 要点的「不得 Update branch」**字面不符**。
> 本轮已就「内容是否等价」做**独立证明**（见 §2），结论为**内容等价、审计覆盖完整、无未经审核内容进入**。
> **owner 裁定（第九轮，2026-09-16）**：`PROCESS DEVIATION / CONTENT-PRESERVING / RE-ATTESTED / NON-SAFETY / **CLOSED**`；
> 不重开 ⑧、不回滚 #43、不改变 `P2_COMPLETE_DORMANT`。见 §2.4 与 §6 R1。

---

## 1. 合并事实（远端实读，非引用用户口述）

| # | 事实 | 实读方式 | 结果 |
|---|---|---|---|
| 1 | `master` 现指向 | `git ls-remote origin refs/heads/master` | `c9af16b1e56d299394ae9cdba457b8eef05da943` ✅ 与口述一致 |
| 2 | 合并提交的双亲 | `git rev-list --parents -n 1 c9af16b1` | 父① = `2e8cb7d`（放行时审计 master）✅；父② = `6a771a1`（**更新后的 head**）⚠️ |
| 3 | 合并提交时间 / 标题 | `git log -1 --format=%cI/%s` | `2026-09-16T16:06:26+08:00` / `Merge pull request #43 from iquelee/feat/wp-g1-ge-02-dormant` |
| 4 | PR 侧合并状态 | GitHub API `pull_request_read(get)` | `merged = true`、`merged_at = 2026-09-16T08:06:27Z`、`merged_by = iquelee`、`state = closed`、`changed_files = 19`、`+2226 −26`、`base.sha = 2e8cb7d` ✅ |
| 5 | required checks（新 head 上） | GitHub API `get_check_runs` | **8 / 8 全 `success`**：`test (16,3.11)`、`test (16,3.12)`、`test (22,3.11)`、`test (22,3.12)`、`Analyze (actions)`、`Analyze (javascript-typescript)`、`Analyze (python)`、`CodeQL` |
| 6 | 审计链完整性 | `git merge-base --is-ancestor` ×4 | `b6da0a3`、`b7247f9`、`6793d7f`、`2e8cb7d` **全部可达**（rc=0）⇒ 无 rebase、无 squash，两段式链保留 |
| 7 | head 前进方式 | `git rev-list --parents -n 1 6a771a1` + 标题 | `6a771a1` 本身是**合并提交**：父① = `b7247f9`（已审计 head）、父② = `2e8cb7d`（已审计 master）；标题 `Merge branch 'master' into feat/wp-g1-ge-02-dormant` ⇒ **`Update branch`（合并式）**，非 rebase、非 squash |

---

## 2. 偏差 D1 与「内容等价」独立证明

### 2.1 偏差内容

```text
D1：合并输入不是放行时冻结的 head（b7247f9），而是 Update branch 之后的 head（6a771a1）
    与放行语句 §9.2 第 ④ 要点「不得 rebase、不得 Update branch、不得 squash」**字面不符**
```

### 2.2 等价性证明链（五条独立证据，全部只读）

| # | 证据 | 命令 / 方法 | 结果 |
|---|---|---|---|
| P1 | 前进方式是**合并**而非重写 | `git merge-base --is-ancestor b7247f9 6a771a1` | **成立（rc=0）** ⇒ 已审计 head 是 `6a771a1` 的第一父，内容与历史完整保留 |
| P2 | 第二父**恰为已审计 master** | `git rev-list --parents -n 1 6a771a1` | 父② = `2e8cb7d` ⇒ 未引入任何**第三方/未经审计**提交 |
| P3 | 变更面与规模**逐项相同** | `git diff --name-status/--stat 6793d7f b7247f9` vs `2e8cb7d 6a771a1` | 两者均 **19 文件 / +2226 −26**，文件集相同 |
| P4 | 19 个文件**逐 blob 相同** | `git rev-parse b7247f9:<p>` vs `git rev-parse 6a771a1:<p>` | **19 / 19 相同**（blob 级，不经工作区） |
| P5 | 补丁级同一 | 自实现 patch-id（剔除 `diff --git`/`index`/`---`/`+++` 行） | 两侧均 `1bd45c90b02a280f08f711d225a18858569913bf` ⇒ **相同** |

### 2.3 合并结果闭合证明（更强一级：**真合并树**逐文件等于来源树）

| # | 证据 | 结果 |
|---|---|---|
| C1 | `tree(c9af16b1) == tree(6a771a1)` | `2ab7ac9c138569cc520a6e13febcb364a374fa3e` **两侧相同**；全树 523 文件逐 blob 比对 **差异 0** ⇒ 真合并提交**未附加任何改动**（无冲突解决残留、无手工编辑） |
| C2 | **变更闭合**：22 个变更文件在合并树中的 blob 与来源树一致 | 19 个 → 等于 `6a771a1`；3 个（PR #44 的 `ml/gen2/reports/*`）→ 等于 `2e8cb7d`；**mismatch 0** |
| C3 | 合并相对 master 的变更面 ⊆ #43 变更面 | `git diff --name-status 2e8cb7d c9af16b1` = **恰好 19 个文件**（10 A + 9 M），与 #43 变更集**完全相同** |
| C4 | 两侧变更**互不相交** | `diff(6793d7f→2e8cb7d)` = 3 个 `ml/gen2/reports/*`；∩ #43 的 19 文件 = **∅** |
| C5 | **git 自身三方合并预测 == 真合并结果** | `git merge-tree 2e8cb7d 2e8cb7d 6a771a1`：首行 `merged`、`result` blob **9 / 9 与真合并 tree 相同**、`added in remote` 10、`added in both` **0**、冲突标记 **0** |

### 2.4 D1 判定

```text
D1 性质判定：内容等价（content-preserving）/ 审计覆盖完整 / 无未经审核内容进入
D1 不等同于：rebase、squash、越权内容引入、未审计第三方提交混入
⇒ 归档口径（第九轮已裁定）：等价替换（equivalent substitution），**不重开门禁、不重跑 ⑧**
⇒ 同时：条款原文的**绝对措辞**（「不得 Update branch」）须改为**带等价判据的条件式**（登记为 E25）
```

**owner 裁定（第九轮，2026-09-16）**：

```text
D1 = PROCESS DEVIATION
     / CONTENT-PRESERVING
     / RE-ATTESTED
     / NON-SAFETY
     / CLOSED
```

**裁定理由（原话要点）**：原放行文字中的「不得 Update branch」字面确实被突破；但新 head 后续**重新通过了 required CI**，
且已证明最终 merge tree 与新 head **全树逐 blob 等价**、PR diff 仍**恰好是原 19 个 Gen-1 文件**。
因此这是**流程偏差，不是未经审计内容进入 master 的安全事件**。

**同时确立的前向规则（取代「父 SHA 必须永远等于原 SHA」的绝对规则）**：

```text
head 变化  ⇒  原审计对象失效
           ⇒  必须重新冻结新 head、并对新 head 重新验收（重跑 required CI + 重做等价/闭合证明）
           ⇒  之后才可以 merge
```

> ⚠️ **D1 的结案不构成「先合后证」的先例**：它承认的是「已发生事实可被回溯判定为等价」，
> 不是「可以跳过事前重冻与重验收」。⛔ 不得据此省略 §6 R7 / E25 的前向流程。

> ⚠️ **不得写成「完全按冻结方案执行」** —— 那样是篡改事实；**也不得写成「门禁已被打破」** —— 那与 C1–C5 的证据相反。
> 正确写法是：**条件字面被突破，但内容等价可证，审计结论不变**。

---

## 3. §11 Attestation 逐项结果

| # | 核验项（§11 原文判据） | 实读证据 | 判定 |
|---|---|---|---|
| **A1** | merge commit 只组合了已审核内容（判据：父**含** `2e8cb7d`；另一父为已审计 head `b7247f9` **或其以 `b7247f9` 为第一父、以 `2e8cb7d` 为第二父的合并提交**，且满足 P4 逐 blob 相同；diff 面 ⊆ 19 文件）—— ⚠️ **原判据的绝对措辞（「恰为……两个」）已于第九轮按 E25 改为条件式**，见 Gate §10 / §11 A1 | 父 = `2e8cb7d` + `6a771a1`（**非** `b7247f9`）；但 P1–P5 + C1–C5 证明 `6a771a1` ≡ `b7247f9 ⊕ 2e8cb7d`；`diff 2e8cb7d..c9af16b1` **恰为 19 文件**，⊆ #43 变更面 | ⚠️ **PASS（等价替换）** —— 字面父判据不满足，实质判据满足；偏差记 **D1** |
| **A2** | 无 squash / 无 rebase 痕迹（双亲；`b6da0a3`、`b7247f9` 仍可达） | 双亲 ✅；`b6da0a3` / `b7247f9` 可达 rc=0 ✅ | ✅ **PASS**（就 squash/rebase 而言）；`Update branch` 事实归入 **D1** |
| **A3** | selector 仍恒 `BASELINE` | 合并树 `src/common/utils/gen1-guarded-selector.js:31` `GE_02_BASELINE_AUTHORITATIVE = true`、`:80` `authoritativeSource = SELECTOR_SOURCE.BASELINE`；`tests/gen1-guarded-selector-noop.test.js` → **PASS(rc=0)** | ✅ **PASS** |
| **A4** | Freeze / Evidence Seal 仍 `PENDING` | 合并树 `ml/manifests/GEN1_GUARDED_EFFECTIVE_FREEZE.json` → `status=PENDING`、`approved_at=null`、`bindings_status=INCOMPLETE`；`..._EVIDENCE.json` → `status=PENDING`、`evidence_positive=false`、`independent_events=0`、`min_independent_events=30` | ✅ **PASS** |
| **A5** | `production_write=false`、`auto_execution=false`（**全档**） | `src/common/utils/gen1-authority.js:145,146` 全档表恒 `false`；`:70` `PRODUCTION_LOCKED=true`；`:178` `PRODUCTION_WRITE` 永久 `false`；`:181` 防御性拒绝直传 `PRODUCTION`；`gen1-authority` / `gen1-guarded-effective-authority` / `gen1-authority-frozen-param` 三测 **PASS** | ✅ **PASS** |
| **A6** | Immutable 锁逐位未变 | 合并树 `node scripts/verify-immutable.js` → **23 / 23 PASS**（含 `immutable_set` 10 条 id 集合校验） | ✅ **PASS** |
| **A7** | Gen-1 生产门禁 | 合并树 `node scripts/gen1-production-gates.js` → **25 / 25 PASS**（G1-A ~ G1-Y，含新增 G1-V/W/X/Y） | ✅ **PASS** |
| **A8** | **线上** authority 未被顺带改动 | CloudBase 只读实读 `runtime_status`（`key=runtime-status`，`updated_at = 2026-09-16T00:00:26.690Z`）：`gen1_authority = CANARY`、`ml_effective = false`、`gen1_production_write = false`、`gen1_auto_execution = false`、`gen1_broker_wired = false`、`gen1_production_fast_path_enabled = false` | ✅ **PASS**（**带时点**：线上记录最近写入 08:00:26+08:00 **早于**合并时刻 16:06:26+08:00 ⇒ 合并未触发任何线上写入） |
| **附** | 回归与平价（§3 E1–E3 复跑） | `gen1-guarded-parity-local.js` → **38 / 38 PASS**；`gen1-overlay-noop` / `gen1-authority` 等 5 项关键单测 **PASS** | ✅ **PASS** |

**判定汇总**：A1 ⚠️（等价替换）· A2–A8 ✅ ⇒ 整体 **PASS**，可改判 `P2_COMPLETE_DORMANT`。

---

## 4. 授权边界执行情况（放行语句 §9.2 第 ⑤ 要点的自查）

| 放行语句要求 | 实际 | 判定 |
|---|---|---|
| 不部署 | 未调用任何部署命令；`cloudfunctions/` 仅在**临时展开树**中被读取 | ✅ |
| 不修改线上 authority | 线上 `runtime_status` 实读仍 `CANARY` / `ml_effective=false`，最近写入时间早于合并 | ✅ |
| 不写生产配置 | 未写 `param_config`、未写任何集合 | ✅ |
| 不进入 GE-03 | 未落任何 GE-03 代码；本文件 §6 的 GE-03 内容为**设计草案**，⛔ 不构成实施授权 | ✅（见 §6 说明） |

---

## 5. 本轮实际写入范围（四块式，勿简写）

```text
ETF 仓库：
- Git 跟踪文件：零修改（git diff --stat HEAD 空）
- Git 历史/分支/远端：远端 master 已由【所有人于 16:06:26 执行合并】推进为 c9af16b1
    —— 该变更**不是本轮**产生，本轮仅【只读】观测；gen1 worktree 仍 6793d7f、
    monstatus 仍 a8bf76d 干净；本轮未 push、未建 PR、未改任何 ref
- 未跟踪本地草稿：GEN1_P2_POST_MERGE_ATTESTATION_20260916.md 新增（仅本地，不入库）；
    GEN1_P2_RELEASE_GATE_20260916.md 有修改（§0.b / §11 实跑结果 / §16）；
    GEN1_DOC_ERRATA_20260916.md 有修改（E23 过期结案 + 新增 E24/E25 + 批次 7 + §6.6）；
    GEN1_GE03_DESIGN_GATE_DRAFT_20260916.md 新增（设计草案，未获批）
- 本机只读 API 调用：GitHub 2 次 GET（PR #43 get / check_runs）、CloudBase 1 次只读集合查询
    ⇒ 均未产生远端或线上变更
其他本机文件：
- WorkBuddy 技能文档有修改（候选：gen1-pr-readonly-audit「合并后核验」段、gen1-doc-errata-dedup 条件式过期）
- 本地记忆文件有修改（.workbuddy/memory/2026-09-16.md）
- %TEMP% 展开树：g1-p2-postmerge-tree（合并树，523 文件，不含 .git，可删）
生产侧：
- 代码 / 配置 / Authority / FROZEN_PARAM_KEYS / lock / immutable_set：零修改
- 线上 `runtime_status`：零写入（只读 1 次）
```

> ⚠️ 工具副作用（仅发生在临时树内）：A7 跑 `gen1-production-gates.js` 时 Gate `G1-J` 会把审计结果写回**该临时树内**的
> `ml/manifests/GEN1_SECTOR_CONTRACT_AUDIT.json`。该树位于 `%TEMP%` 且**不含 `.git`** ⇒ 仓库被跟踪文件未被触碰。

---

## 6. 待裁定 / 移交项

| # | 事项 | 说明 | 建议 |
|---|---|---|---|
| **R1** | **D1 归档口径** | `Update branch` 字面违约，但内容等价可证 | ✅ **已裁定（第九轮）**：按「**等价替换**」归档 = `PROCESS DEVIATION / CONTENT-PRESERVING / RE-ATTESTED / NON-SAFETY / **CLOSED**`；不重开门禁、不重跑 ⑧、不回滚 #43、不改变 `P2_COMPLETE_DORMANT`。条款措辞改为**条件式 + 前向规则**（→ E25） |
| R2 | 本文件与上游 Gate 文件曾长期仅为未跟踪本地草稿 | 二者是 P2 的决策留痕，未进仓库 ⇒ 治理链在仓库侧存在缺口 | ✅ **已放行（第九轮）**：owner 授权 **P2 Closure docs-only PR** 收口「本文件 + Gate + ⑦ 只读审计 + 勘误表」四份文档（**只授权建 PR**，⛔ merge 未授权，见 Gate §9.4）；⛔ GE-03 设计文档**不得**混入该 PR |
| R3 | **GE-03 设计**:见 `GEN1_GE03_DESIGN_GATE_DRAFT_20260916.md` | 仅为**设计草案**（设计边界 + 验收标准），⛔ 不是实施授权 | 须先经设计 Gate 裁定，才谈代码 |
| R4 | 承自 PR #43 的锚点 A/B/C（`guardedEffectiveInvocations` 累计口径、运行期无 source/model SHA 观测源、shadow rerun + 反例矩阵） | 分别归 GE-03 / GE-04 | 写入 GE-03 设计边界 |
| R5 | `GEN1_CURRENT_STATE_20260910.md:83` 冻结清单 6 项**自 16:06:26 起已过期**（实为 7 项） | E23 由「条件性过期」转为**现实过期** | 归入批次 7 的 docs 同步；⛔ 不改 2026-09-10 历史快照正文。✅ 第九轮 owner 已确认「E23 从 conditional 转为现实过期，我同意」 |
| R6 | `master` 已**二次漂移**（`c9af16b1 → 44b59b8`，PR #45） | 属**纯 Gen-2** 变更；`c9af16b1` 仍是新 master 的祖先（线性前进） | ✅ 第九轮已复核（见 §7）：对本 Attestation 结论**无影响**；⛔ 但新 PR 仍须以**当时实读**的 master 为 base |
| R7 | GE-03 设计文档已收为**最终版** | `GE03_DESIGN_GATE = PENDING FINAL DOC REVIEW`；`IMPLEMENTATION_AUTHORIZATION = NOT GRANTED` | 待 owner 终验；⛔ **设计 PASS ≠ 实施授权**（Q6 裁定） |

---

## 7. 后续 master 漂移复核（第九轮新增，全部只读）

**背景**：本 Attestation 的结论是 **as-of `c9af16b1`** 的。此后 `master` 又被推进了一次，须复核「是否影响本结论」。

| # | 项 | 实读方式 | 结果 |
|---|---|---|---|
| 1 | 当前 `master` | `git ls-remote origin refs/heads/master`（连测 3 次一致）+ GitHub API `get_commit` | `44b59b8be06f041e32e410add03a9f5b1afcb40d` —— PR **#45** `chore/gen2-screen-o2-hardening`，`2026-09-16T16:32:50+08:00` |
| 2 | 双亲 | `git rev-list --parents -n 1 44b59b8` | `c9af16b1`（= 本 Attestation 的对象）+ `86f9a086` ⇒ **线性前进**，本 Attestation 的对象仍是新 master 的**祖先** |
| 3 | 变更面 | `git diff --name-status c9af16b1 44b59b8` | **恰好 2 个文件**：`ml/gen2/tests/test_screen_o2_hardening.py`（新增）、`scripts/ml/screen-o2-candidates.py`（修改）；`+1572 −138` |
| 4 | **零 Gen-1 影响** | 524 个 blob 逐条比对（`ls-tree -r` + `rev-parse <sha>:<path>`） | 差异**恰好 2 条**，均为 Gen-2 文件；`src/`、`cloudfunctions/`、`web/`、`tests/`、`docs/gen1/`、`scripts/*.js` 差异 **NONE** |
| 5 | 变更闭合 | 2 文件在合并树 vs PR head（`86f9a086`）逐 blob | **2 / 2 相同**，mismatch 0 |
| 6 | 不变量未退化 | 在 `44b59b8` 树上复跑 | `verify-immutable` **23 / 23**；`gen1-production-gates` **25 / 25**；CANARY 平价 **38 / 38**；关键单测 **5 / 5 PASS** |
| 7 | 被改文件是否受锁保护 | `git grep screen-o2-candidates 44b59b8 -- scripts/verify-immutable.js ml/manifests` | **零命中** ⇒ 该文件不在 `immutable_set` / lock 覆盖范围内 |

**结论**：

```text
本 Attestation 的 A1–A8 结论**不因 PR #45 而改变** —— 它是 as-of c9af16b1 的记录，
且 c9af16b1 仍是当前 master 的祖先（线性前进、无重写）。
PR #45 对 Gen-1 的影响：零（2 个 Gen-2 文件；Gen-1 面 blob 差异 NONE；锁 / 生产门禁 / 平价全绿）。
⛔ 但新 PR（含 P2 Closure docs-only PR）必须以其自身放行时实读的 master 为 base，
   并重新核对「零 Gen-1 影响」—— 不得把本节的结论当作未来 PR 的免检凭证。
```

> ⚠️ **可复用的教训**：本日 `master` 已前进 **3 次**（`6793d7f → 2e8cb7d → c9af16b1 → 44b59b8`）。
> **任何写进治理文档的 `master` SHA 都必须是 as-of 值**；写成「当前 master 永久值」的句子必然很快过期。

---

*本文件为**事后**核验留痕。`P2_COMPLETE_DORMANT` 表示「P2 阶段已收口且系统仍处休眠」，
**不表示**已获准部署、提权或进入 GE-03。`gen1_authority` 仍为 `CANARY`；`ml_effective` 仍为 `false`。
偏差 **D1** 已于第九轮裁定为**等价替换**并 **CLOSED**；⚠️ 文中 `master` SHA 均为 **as-of 值**。*
