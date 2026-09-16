# Gen-1 文档状态勘误报告

**报告编号**：`WP-G1-DOC-ERRATA-1.0`
**日期**：2026-09-16
**工作区**：`etf-decision-engine-gen1`（worktree，分支 `gen1-worktree-20260916`）
**勘误基线**：`HEAD = 6793d7f`（Merge PR #42）
**性质**：**只读取证 + 文档勘误**。本轮未改任何既有文档、未改任何源码；本文档为新增勘误清单，供逐条审批后再生效。
**取证方式**：仓库内实测（`npm test` / `npm run` 门禁脚本 / `git log` / 源码逐行核对），全程只读；线上 `param_config` / `runtime_status` 未读取（本轮无线上取证授权）。

---

## 0. 去重声明与覆盖矩阵（2026-09-16 第二轮新增）

> 🚫 **本文件状态：本地审计草稿 —— 不入库、不单独成 PR、不再造第二份勘误。**
> 按项目所有人指示，本轮 D1/D2/D3 的**正式落地**已整合进
> `docs/gen1-monitor-status-clarify` 分支的 `GEN1_EVIDENCE_MONITOR_STATUS_ERRATUM_20260916.md`
> （**v1.1**，commit **`82debe8`**）；本文件仅作**本地取证留痕**。E1–E20 仍待你逐批批准后再议。

> **本节为第二轮唯一新增内容。** 第二轮任务 =「先检查是否已有同类勘误，避免重复创建」。
> **结论：已存在，本轮不重复创建任何勘误文件。**

### 0.1 事实：`docs/gen1-monitor-status-clarify` 已承载同类勘误

| 项 | 实测值 | 取证 |
|---|---|---|
| 分支 | `docs/gen1-monitor-status-clarify` @ `4ea83630945672c5636d3c2a0fa52be73ea90bb4` | `git branch -vv` |
| 本地 ↔ 远端 | **一致**（同 SHA） | `git rev-parse`（双端比对） |
| 基线 | 父提交 = `6793d7f`（= 本 worktree HEAD），**单 commit** | `git rev-list --parents -n 1 4ea8363` |
| 并入状态 | ❌ **未并入 `master`** | `git merge-base --is-ancestor 4ea8363 HEAD` → 非祖先 |
| 对应 PR | **不存在**（GitHub 开放 PR 列表中无该 head） | GitHub PR 列表只读查询 |
| 提交时间 / 作者 | 2026-09-16 10:44:39 +0800 / `iquelee` | `git show -s --format=%ci%n%an` |
| 新增文件 | `docs/gen1/GEN1_EVIDENCE_MONITOR_STATUS_ERRATUM_20260916.md`（+131 行）、`docs/gen1/README.md`（+59 行） | `git diff --stat <base>..4ea8363` |

### 0.2 覆盖矩阵：第二轮 4 项要求 ← 既有分支已覆盖情况

| # | 第二轮要求 | 既有分支对应位置 | 判定 |
|---|---|---|---|
| 1 | 自动化已停止 | erratum §2.1（自动化 `Gen-1 COUNTERFACTUAL_CANARY 每日只读巡检` 已于 2026-09-14 停止） | ✅ **完整覆盖** |
| 2 | 7 项仍是手工/按需巡检协议 | erratum §2.2（W1–W7 内容有效；执行方式 = 人工按需；「生效」读作「条款生效」） | ✅ **完整覆盖** |
| 3 | CANARY、invocations 等属带日期历史快照 | erratum §2.3（7 行快照表，逐条标 as-of 与出现位置） | ✅ **完整覆盖** |
| 4 | #42 的 P2/P3 仅是路线图，不构成代码授权 | erratum §3 | ⚠️ **方向正确，但法理链不完整 + 两处过度禁止**（见 §0.3） |

**⇒ 处置**：第二轮**不新建勘误文件、不新建分支、不改任何被跟踪文档正文**。这 4 条的**单一真相源** = `docs/gen1/GEN1_EVIDENCE_MONITOR_STATUS_ERRATUM_20260916.md`（分支 `docs/gen1-monitor-status-clarify`）。

**与本报告（E1–E20）的关系**：两份文件**主题不重叠**，可并存——既有分支文件 = **运行状态 / 时效**；本报告 = **引用健全性 / 计数过期 / 锚点错配**。唯一交叉点为本报告 §4 的 U1–U3（`gen1_authority` / `invocations` 需线上复读），**结论同向、不冲突**。

### 0.3 第 4 项的三处缺口（D1–D3）

> 均为**文档层面**的登记与建议。本轮**未创建任何文件、未修改任何被跟踪文件**。

#### D1 —【P0 · ✅ **已裁定 = (c)**】三方口径互相矛盾

| 出处 | 原话 |
|---|---|
| `WP-G1-GE-RULING_20260916.md:6` | 「**性质**：治理裁决 —— **批准 P1/P2/P3，禁止 P4**」 |
| 同文件 `:18` | 「P1 + P2 + P3 ｜ ✅ **APPROVE WITH GUARDS**（六条硬护栏，见章程 §8）」 |
| 同文件 `:53` | 「⇒ STOP 条件未触发，**允许继续 P1/P2/P3**。」 |
| 既有 erratum §3 | 「§5.1 的 P1/P2/P3 `✅` … **不构成编码授权、验证授权或部署授权**；在用户明确批准之前，以下事项一律不做：不创建 Gen-1 代码实现分支 …」 |
| **本轮口头要求** | 「#42 的 P2/P3 **仅是路线图，不构成代码授权**」 |
| **仓库事实** | PR **#43** `feat(gen1): WP-G1-GE-02 — Guarded Effective 休眠实现（selector 恒 baseline，dormant）` — **状态 OPEN**，创建于 2026-09-16 10:12 +0800，head `feat/wp-g1-ge-02-dormant` @ `b7247f9`，**19 个文件**（含 `cloudfunctions/runDecisionEngine/index.js`、`src/common/utils/gen1-authority.js`、`src/common/constants.js`、`src/common/schema.js`、`src/common/utils/gen1-overlay.js`） |

**问题**：`RULING-WP-G1-GE` 是项目所有人签署的裁决，`:6` 已明写「批准 P1/P2/P3」。而既有 erratum §3 **只引章程 §5.1 的 `✅` 列，未引 RULING 的批准条款** ⇒ 读者会得出「P2/P3 未获授权」的结论，与 RULING `:18`／`:53` 及**实际存在的 PR #43** 直接冲突。

**⇒ 本轮不作判定，仅登记冲突。需你三选一裁定（选定后我再按结论改文档）**：

- **(a)** 以 RULING `:18` 的 `APPROVE WITH GUARDS` 为授权凭证 ⇒ erratum §3 应**补引 RULING**，PR #43 合规；「路线图」一语仅指章程 §5.1 那张表本身。
- **(b)** 以「仅路线图、不构成代码授权」为准 ⇒ 必须**同步修订 RULING `:6`／`:18`／`:53` 的措辞**，否则同一份裁决自相矛盾；且 PR #43 的授权来源需另行补记。
- **(c)** 折中：P1/P2/P3 **已获阶段批准**，但**每个阶段的实施仍需单独放行** ⇒ 需在 erratum §3 写清「已批准 = 阶段许可 ≠ 逐 PR 放行」，并对 #43 单独记一次放行。

**✅ 裁定结果（2026-09-16，项目所有人选定 (c)）——已落地：**

| 项 | 落地内容 |
|---|---|
| 载体 | 既有 erratum 升 **v1.1**，commit **`82debe8`**，分支 `docs/gen1-monitor-status-clarify`（worktree `etf-decision-engine-monstatus`） |
| C（放行规则） | §3 改为「**阶段许可 ≠ 单个 PR 自动合并许可**」+ 逐阶段放行表（P1 已完成／P2 逐 PR 放行记录／P3 待 P2 合并+反例测试后单放／P4 禁止） |
| D2（采纳） | §3 的「不改 `FROZEN_PARAM_KEYS`」限定为「**本次文档勘误本身**不得改」；经单独放行的 GE-02 P2 PR 中纳入 `gen1_authority` 属契约要求的安全改动，须配套冻结/回退/反例测试 |
| D3（采纳） | 新增 **§7 附录（澄清记录）**：批准主体 = 项目所有人、日期 2026-09-16、编号 `RULING-WP-G1-GE`、「阶段许可 ≠ 单 PR 放行」、逐阶段要求、`#43` 状态 —— **RULING 正文一字未动** |
| `#43` | **不关闭**；挂起为 **`P2_PENDING_PR_RELEASE`**；放行前不得扩大范围／合并／部署／改线上 authority；未提交代码隔离保留 |

#### D2 —【P1】「不改 `FROZEN_PARAM_KEYS`」与章程硬要求直接冲突

| 出处 | 原话 / 实测 |
|---|---|
| 既有 erratum §3 | 「在用户明确批准之前 … **不改 `FROZEN_PARAM_KEYS`**」 |
| `GEN1_GUARDED_EFFECTIVE_CHARTER.md:180-182` | 「⇒ **WP-G1-GE-02 必须同时**：1. 将 `gen1_authority` 纳入 `FROZEN_PARAM_KEYS`（冻结/受限）；2. 保证 `GUARDED_EFFECTIVE` 不得由 `gen1_authority` 单独决定」 |
| 实测 | 当前 `FROZEN_PARAM_KEYS` = **6 项**，**不含** `gen1_authority`（`src/common/constants.js:61-69`）；PR #43 已改 `src/common/constants.js` |

**问题**：erratum §3 的**无条件**「不改 `FROZEN_PARAM_KEYS`」把章程明令 GE-02 必做的一件事**一并禁掉了**。应限定为「**在 P2 实施放行前**不改」，否则条款自相矛盾。

#### D3 —【P2】章程 §5.1 表列名仅「允许」，无批准主体 / 日期 / 范围

| 出处 | 原文 |
|---|---|
| `GEN1_GUARDED_EFFECTIVE_CHARTER.md:241` | 表头 `| 阶段 | 允许 |`；`:243-246` 为 P1/P2/P3/P4 四行 |

**问题**：列名只有「允许」二字，**没有批准方、批准日期、批准范围** ⇒ 任何人都可能把它当作授权凭证（这正是第二轮要求所警惕的风险）。

**建议补句（追加到章程 §5.1 表格下方，一句即可）**：

> 「本表的『允许』= **阶段计划（路线图）**，仅为 `RULING-WP-G1-GE` §1.4 的前置说明；**批准主体与日期以 `WP-G1-GE-RULING_20260916.md` 为准**，本表本身不构成任何授权。」

---

## 0.1 一句话结论

Gen-1 文档体系**法理链完整、金额与权限口径自洽**，但存在 **1 类结构性缺陷**（治理文档引用了仓库里根本不存在的取证来源）+ **1 类系统性过期**（门禁/测试计数停在 2026-09-10，落后现状 4~8 项）+ **若干字段名与行号锚点错配**。共 **20 条**，其中 **P0 三条**（悬空引用 / 不可复核取证），建议**优先修 P0，再分批修 P1**。

---

## 1. 勘误基线：本次实测真值

> 下文所有「建议修正值」均以此表为准。此表为**实测**，非推断。

| 项 | 实测真值 | 取证方式 |
|---|---|---|
| `npm test` 总项数 | **45/45 通过** | `node scripts/test-all.js` @ 6793d7f |
| Stage A（Node 单测） | **37/37 文件** | 同上 |
| Stage C — Immutable SHA | **23/23 项** | 同上（`scripts/verify-immutable.js`） |
| Stage C — Gen-1 Feature Pipeline Lock | **10/10 项**（未变） | 同上 |
| Stage D — Python↔Node Parity | 360 行一致 | 同上 |
| Stage F — Build Common Parity | 含 WP-G2-04 构建产物 **7/7** | 同上 |
| **Gen-1 Production Gates** | **21/21 通过，编号 `G1-A` ~ `G1-U`** | `node scripts/gen1-production-gates.js` |
| 门禁清单权威源 | `scripts/gen1-production-gates.js:45-67`（21 条） | 源码 |
| `FROZEN_PARAM_KEYS` | **6 项**（`volume_ratio_mild, tech_sector_max, ml_fast_path_enabled, ml_challenger_model_id, ml_gen1_frozen, ml_shadow_bundle_id`） | `src/common/constants.js:61-69` |
| `gen1_authority` 是否在冻结清单 | **仍不在**（与 GE 章程 §3.4 一致 ✅） | 同上 |
| frozen model SHA | `d5e667c66a5f888bb5489b8adcad9e6a141bfbcf0006a955d6ad40e269a7e712` | `ml/manifests/GEN1_IMMUTABLE_LOCK.json:3` |
| `threshold_signal_p` | `0.65` | `src/common/constants.js:222` |
| `ml_effective` 硬编码字面量位置 | `cloudfunctions/runDecisionEngine/index.js:1048`（runtime_status）、`:1108`（顶层） | 源码（与 GE 章程 §6.3 一致 ✅） |
| `runtime_status` 反事实字段实际名 | **带 `gen1_` 前缀**：`gen1_counterfactual_canary_authorized / _health_allowed / _active / _invocations` | `index.js:1072-1075` |
| 无前缀 `counterfactual_canary_*` 实际位置 | 仅存在于响应体 `ml_shadow`（mlMeta）：`index.js:1018-1021` | 源码 |
| 当前 HEAD / 上一 merge | `6793d7f`（PR #42） / `d254a7a`（PR #41） | `git log` |

---

## 2. 勘误清单

严重度定义：**P0** = 治理链断链或不可复核；**P1** = 会被当作现状误读的数字/名称；**P2** = 表述或锚点不精确；**P3** = 体例/一致性小项。

### E1 —【P0】GE 章程两处引用**不存在**的 `CANARY_SWITCH_REPORT.md`

| 项 | 内容 |
|---|---|
| 位置 | `docs/gen1/GEN1_GUARDED_EFFECTIVE_CHARTER.md:16` 与 `:340` |
| 现状原文 | `:16`「按 `CANARY_SWITCH_REPORT.md` §5.1 的既有裁定，解除 Gen-1 的生产层护栏必须：**新工作包 + 新契约 + 重新冻结**」<br>`:340`「回退方式与 `CANARY_SWITCH_REPORT.md` 记载的既有做法保持一致」 |
| 问题 | 全仓（含未跟踪文件）**无此文件**；`git ls-files "*CANARY*"` 仅命中 `GEN1_CANARY_GO_LIVE_RUNBOOK.md`。而 §5.1 承载的是**整个 `WP-G1-GE` 工作包的立项法理**——法理来源不可核验，等于治理链断链。 |
| 建议修正 | 二选一：<br>① 若该报告确实存在（他机/线上留档）→ 补入库并在 GE 章程 §2.1 登记表登记；<br>② 若无法入库 → 把 `:16` 的法理依据改写为**可核验来源**：<br>「按 `WP-G1-GE-RULING_20260916.md` §2.1 的裁定，解除 Gen-1 生产层护栏必须：新工作包 + 新契约 + 重新冻结」<br>`:340` 改为「回退方式沿用 `GEN1_CANARY_GO_LIVE_RUNBOOK.md` §9（已实测可用）」 |

### E2 —【P0】GE 章程 / RULING 引用的**取证目录在本仓库不存在**

| 项 | 内容 |
|---|---|
| 位置 | `GEN1_GUARDED_EFFECTIVE_CHARTER.md:8`、`WP-G1-GE-RULING_20260916.md:7` |
| 现状原文 | 「取证依据：`outputs/gen1-authority-audit-20260916/GEN1_AUTHORITY_FORENSIC_REPORT.md`（只读审查，基线 `origin/master = d66cd86`）」<br>「证据基线：`origin/master = d66cd86`（只读取证报告 `outputs/gen1-authority-audit-20260916/`）」 |
| 问题 | 实测本 worktree `outputs/` 下**只有** `gen2-wp-g2-01`，无 `gen1-authority-audit-20260916/`；且 `outputs/` 被 `.gitignore:8` 排除 ⇒ **干净 clone 永久无法复核**这两份治理文档的事实基础。 |
| 缓解事实 | RULING §3.1 已把双字段实读结果**内联**成表（`_id` / `version` / `updated_at` 齐全），质量足够独立引用 ✅ |
| 建议修正 | 在 CHARTER `:8` 与 RULING `:7` 的引用后加括注：<br>「（该取证报告位于本地 `outputs/`，受 `.gitignore` 排除，未入库；结论已内联复述于本文件 §X）」<br>并把主引用改为内联表；`outputs/` 路径降为「本地原始留档」。 |

### E3 —【P1】RUNBOOK §0「上线前提」表数字全面过期

| 项 | 内容 |
|---|---|
| 位置 | `docs/gen1/GEN1_CANARY_GO_LIVE_RUNBOOK.md:114-122` |
| 逐行对照 | `:116`「本地 `npm test` → **37/37**」→ 应为 **45/45**<br>`:117`「Gen-1 Production Gates → **G1-A ~ G1-T 20/20**」→ 应为 **G1-A ~ G1-U 21/21**（漏 `G1-U Daily Data Finality & Lane Execution`）<br>`:118`「Immutable SHA → **11/11**」→ 应为 **23/23**<br>`:119`「Feature Pipeline Lock → 10/10」→ ✅ 仍准确，勿动<br>`:120` frozen model SHA `d5e667c6…` → ✅ 实测一致，勿动<br>`:121` `threshold_signal_p = 0.65` → ✅ 实测一致，勿动 |
| 建议修正 | 只改 `:116`/`:117`/`:118` 三行为上列实测值，并在表上方加一行：「（本表为 2026-09-16 实测；计数口径权威源 = `scripts/gen1-production-gates.js` 与 `scripts/test-all.js`）」 |

### E4 —【P1】CURRENT_STATE 附录 A.5 门禁计数过期

| 项 | 内容 |
|---|---|
| 位置 | `docs/gen1/GEN1_CURRENT_STATE_20260910.md:169` |
| 现状原文 | 「`npm test` → **36/36**；Gen-1 Production Gates **G1-A~R 18/18**；Immutable **11/11**；Pipeline Lock 10/10（frozen 管线文件零改动）」 |
| 问题 | 三处过期。该行紧邻「A.6 当前裁决」标题，易被当成现状。 |
| 建议修正 | 改为「`npm test` → **45/45**；Gen-1 Production Gates **G1-A~U 21/21**；Immutable **23/23**；Pipeline Lock 10/10（frozen 管线文件零改动）」，并注明「实测日 2026-09-16」 |

### E5 —【P1】CURRENT_STATE 题为「当前状态」，但缺时效标注，且 A.6 与线上现状相反

| 项 | 内容 |
|---|---|
| 位置 | `GEN1_CURRENT_STATE_20260910.md:1`（标题）、`:181`（A.6）、`:125`（A.1） |
| 现状原文 | 标题「Gen-1 当前状态基线快照（G1-00）」；`:181`「`gen1_authority = ADVISORY`（未改）」 |
| 问题 | 该文档最后一次提交为 `4130cc2`（**2026-09-10 11:39 +0800**）。线上 `param_config.gen1_authority` 于同日 **16:18 +0800**（`updated_at=2026-09-10T08:18:00Z`）切至 `CANARY`（见 RULING §3.1 实读）。<br>⇒ **写入当时 ADVISORY 正确**，但文档标题声称「当前状态」却无 as-of 声明，读者会得出「现在还是 ADVISORY」的错误结论，与 `WP-G1-EVIDENCE_CHARTER.md:58`、`GEN1_DAILY_PRODUCTION_WATCH.md:4`、`WP-G1-GE-RULING_20260916.md:50-51`、`GEN1_GUARDED_EFFECTIVE_CHARTER.md:261-262` 全部记为 `CANARY` **直接冲突**。 |
| 建议修正 | 在标题下（`:4` 之后）插入一行：<br>「⚠️ **时效声明**：本快照 as-of **2026-09-10 11:39（北京时间）**。线上 `gen1_authority` 已于同日 16:18 切至 `CANARY`；附录 A.6 的 `ADVISORY（未改）` 反映的是**切换前**状态。现状请以 `WP-G1-GE-RULING_20260916.md` §3.1 为准。」 |

### E6 —【P1】RUNBOOK 核对表用了**错误字段名**（缺 `gen1_` 前缀）

| 项 | 内容 |
|---|---|
| 位置 | `GEN1_CANARY_GO_LIVE_RUNBOOK.md:201`（§5）、`:224-227`（§7） |
| 现状原文 | §5「`runtime_status`（key=`runtime-status`）必须满足：… `counterfactual_canary_authorized = false`」<br>§7「`counterfactual_canary_authorized / counterfactual_canary_health_allowed / counterfactual_canary_active / counterfactual_canary_invocations`」 |
| 问题 | 实际 `runtime_status` 落库字段带前缀（`index.js:1072-1075`）：`gen1_counterfactual_canary_authorized / _health_allowed / _active / _invocations`。**无前缀名只存在于响应体 `ml_shadow`（mlMeta，`index.js:1018-1021`）。** 按 RUNBOOK 原文去 `runtime_status` 里查无前缀字段会得到"字段不存在"，属实操级误导。 |
| 对照 | ✅ `GEN1_DAILY_PRODUCTION_WATCH.md` §1（W1-W7）与 `GEN1_FIRST_LIVE_CANDIDATE_PROTOCOL.md` §M3 用的**都是正确的前缀名**，无需修改。 |
| 建议修正 | §5/§7 四处字段名统一加 `gen1_` 前缀；并在 §7 表下加注：「无前缀 `counterfactual_canary_*` 仅存在于响应体 `ml_shadow.ml_shadow`，**不要**用它核对 `runtime_status`。」 |

### E7 —【P1】GE 章程登记表把 RUNBOOK 的 as-of 写成 2026-09-11

| 项 | 内容 |
|---|---|
| 位置 | `GEN1_GUARDED_EFFECTIVE_CHARTER.md:100` |
| 现状原文 | 「\| `docs/gen1/GEN1_CANARY_GO_LIVE_RUNBOOK.md` \| **2026-09-11** \| 生效 \| 继续有效；…」 |
| 问题 | RUNBOOK 最后修改提交 `c0e29b0`（**2026-09-10 14:16 +0800**），文内所有日期均为 2026-09-10。**2026-09-11 是 `GEN1_DAILY_PRODUCTION_WATCH.md:3` 的生效日** —— 两文档日期被串了。 |
| 建议修正 | 把该行 as-of 改为 `2026-09-10`；若想保留两文档区分，可在备注列注明「（`GEN1_DAILY_PRODUCTION_WATCH.md` 生效日 2026-09-11）」 |

### E8 —【P1】WP-G1-EVIDENCE 章程引用的样本表**不存在**

| 项 | 内容 |
|---|---|
| 位置 | `docs/gen1/WP-G1-EVIDENCE_CHARTER.md:29` |
| 现状原文 | 「`outputs/wp-g1-evidence-20260910/gen1_evidence_samples.csv` \| 样本表（表头已冻结，当前 0 行） \| 累计中」 |
| 问题 | 本机 `outputs/` 下无该目录（只有 `gen2-wp-g2-01`）；`outputs/` 被 `.gitignore:8` 排除 ⇒ 无实物可核。同问题亦波及 `GEN1_FIRST_LIVE_CANDIDATE_PROTOCOL.md:54,60` 与 `GEN1_DAILY_PRODUCTION_WATCH.md:60` 规定的归档目录。 |
| 缓解事实 | 表头（17 列）定义**已完整内联**在 `GEN1_EVIDENCE_CONTRACT.md` §2 ✅ —— 口径本身可核，仅物理文件不可核。 |
| 建议修正 | 该行改为：「`outputs/wp-g1-evidence-20260910/gen1_evidence_samples.csv`（**本地目录，未入库**）\| 样本表（列口径冻结于 `GEN1_EVIDENCE_CONTRACT.md` §2，当前 0 行）\| 累计中」 |

### E9 —【P1】`Test-And-CI-Gates.md` 阶段表与门禁清单严重滞后，且无「已被取代」指向

| 项 | 内容 |
|---|---|
| 位置 | `docs/Test-And-CI-Gates.md:8, 16, 18, 69, 75, 97, 103, 120` |
| 逐行对照 | `:8`「6 阶段全量门禁」→ 现 **7 阶段**（已含 Stage G）<br>`:16`「Stage A … `tests/*.test.js`（**13 文件**）」→ 现 **37 文件**<br>`:18`「Stage C … **共 8 项**」→ 现 **23 项**<br>`:69`「`npm test` **18/18** 全绿」→ 现 **45/45**（此段为 2026-09-08 历史快照，应保留但需标注）<br>`:75,97`「Gate **G1-A~H** / Gen-1 Production Gates **8/8**」→ 历史<br>`:103,120`「G1-I ~ G1-M（共 **13 门**）/ **32/32** … **13/13**」→ 历史 |
| 问题 | 文档最后提交 `aaeb5cb`（2026-09-10 10:44），未覆盖当日后续新增的 `G1-N`~`G1-U`。文件同时是「CI 门禁清单」性质的**参考文档**，读者易当现状。 |
| 建议修正 | ① 在 `:3` 后加醒目提示：「⛔ **本文为 2026-09-08 ~ 09-10 历史快照**；当前门禁口径以 `GEN1_CANARY_GO_LIVE_RUNBOOK.md` §0 与 `scripts/gen1-production-gates.js` 为准（G1-A~U，21 门）。」<br>② 修正 `:8`（阶段数）、`:16`（文件数）、`:18`（Stage C 项数）三处**描述性**数字 |

### E10 —【P1】`主链冻结契约.md`：行号锚点失效 + 已修复缺陷仍列在待办

| 项 | 内容 |
|---|---|
| 位置 | `docs/主链冻结契约.md:32`、`:122` |
| 现状原文 | `:32`「证据（`runDecisionEngine/index.js` **801–855 行**）」解释 mlMeta<br>`:122`「P1-3 \| `runGen1ShadowEod/index.js` **48–56** \| 日线 `limit:1000` 升序取最早 1000 行，EOD 可能停在旧日期 \| **工作包 2**」 |
| 问题 | ① 该文档最后提交 `8fc3ba6`（**2026-09-08**），此后 `index.js` 大幅增长：现在 801-855 行是 `portfolio_position` 回写区，**mlMeta 实际位于 `:1002-1040`**。<br>② P1-3 **已在代码修复**：`cloudfunctions/runGen1ShadowEod/index.js:58` 明写「P1-3 修复：去掉 `limit:1000`（…）」，全仓已无 `limit:1000`。 |
| 建议修正 | ① `:32` 行号改 `1002–1040`；<br>② `:122` 该行标注为 **FIXED**，位置列改为 `runGen1ShadowEod/index.js:57-60（已移除 limit:1000）`，归属列改为「✅ 已修复」；<br>③ 建议对 §6 剩余条目（P0-1 / P0-5 / P1-2）**单列一次状态盘点**（本轮未逐一验证，不在此断言）。 |

### E11 —【P2】`legacy_test_triage.md` 处置状态未回填，且与自身原则冲突

| 项 | 内容 |
|---|---|
| 位置 | `docs/legacy_test_triage.md:7, 48, 77, 83, 106-116` |
| 现状原文 | `:48`「**暂不删除测试**…当前在 test-all 汇总中记为「**已知失败**」」<br>`:77`「`[ ]` 2~5 ㉚㉛㉜㉝ V3.9/V4.2 → DEPRECATE（**待用户确认**实验层是否废弃）」<br>`:83`「`[ ]` 11 security-hotfix allowlist 检查点（18-20）…**待安全审查确认后执行**」 |
| 问题 | ① 实测 `npm test` **45/45 全绿**（含 `phase1.test.js`、`security-hotfix.test.js` 均 PASS），无「已知失败」项 ⇒ `:48` 表述已不成立；<br>② ㉚㉛㉜㉝ **已落地为 `test.skip()`**：`tests/phase1.test.js:596, 645, 700, 719`（文件内 `:20-25` 定义了 `test.skip` 标记与理由）⇒ `:77` 的「待确认」已完成；<br>③ 允许列表检查点 18-20 **已从 `tests/security-hotfix.test.js` 移除**（该文件现仅剩 1 条 `heldTrades` 断言）⇒ `:83` 的「待确认后执行」已完成；<br>④ **口径冲突**：`:7` 原则明写「不得通过 `skip()`/注释/删除测试「修绿」」，而实际操作正是 `test.skip()` 与移除断言。 |
| 建议修正 | 回填 `:77`/`:83` 为 `[x]` 并注明落地方式与文件行号；`:48` 改为「已落地为 `test.skip()`，`npm test` 全绿（45/45）」；<br>**并新增一节显式裁定**：「DEPRECATE 类项使用 `test.skip()` 是否属于 `:7` 原则的例外」——否则该行原则日后会被引用为「本仓允许 skip」。 |

### E12 —【P2】`VERSION.txt` 的 `FROZEN_PARAM_KEYS` 数量表述过期

| 项 | 内容 |
|---|---|
| 位置 | `VERSION.txt:27` |
| 现状原文 | 「volume_ratio_mild / tech_sector_max 后台已冻结（FROZEN_PARAM_KEYS，**仅 2 key**）。」 |
| 问题 | 实测 `src/common/constants.js:61-69` 为 **6 key**（V4.0 ML Gen-1 Shadow 追加了 `ml_fast_path_enabled / ml_challenger_model_id / ml_gen1_frozen / ml_shadow_bundle_id`）。 |
| 建议修正 | 改为：「`volume_ratio_mild` / `tech_sector_max` 为**策略旋钮**；`FROZEN_PARAM_KEYS` 共 **6 key**（另 4 个为 ML 闸门：`ml_fast_path_enabled / ml_challenger_model_id / ml_gen1_frozen / ml_shadow_bundle_id`）。`gen1_authority` 仍**不在**冻结清单（见 `GEN1_GUARDED_EFFECTIVE_CHARTER.md` §3.4）。」 |

### E13 —【P2】GE 章程 §1.2 状态机措辞含混（`DISABLED` 并非既有词汇）

| 项 | 内容 |
|---|---|
| 位置 | `GEN1_GUARDED_EFFECTIVE_CHARTER.md:45` |
| 现状原文 | 「⚠️ **不引入** `DISABLED` / `PRODUCTION` 之外的第二套词汇。」 |
| 问题 | 既有状态机（`gen1-authority.js:24-30`）为 `OFF/SHADOW/ADVISORY/CANARY/PRODUCTION`，**不含 `DISABLED`**。按字面读会得出「`DISABLED` 是既有词汇」的错误结论。对照 `WP-G1-GE-RULING_20260916.md:29`（「不要推翻重做另一套 `DISABLED/CANARY/ADVISORY/...`」）可知原意是"不引入第二套外来词汇"。 |
| 建议修正 | 改为：「⚠️ **不引入第二套词汇**（如 `DISABLED` 一类外来命名，或对 `PRODUCTION` 重新定义）。既有状态机（`gen1-authority.js:24-30`）是唯一真相源，本次只做**插入**与**重排 rank**。」 |

### E14 —【P2】GE 章程 §1.1 代码锚点范围过宽

| 项 | 内容 |
|---|---|
| 位置 | `GEN1_GUARDED_EFFECTIVE_CHARTER.md:46` |
| 现状原文 | 「既有状态机（`src/common/utils/gen1-authority.js:24-51`：`OFF\|SHADOW\|ADVISORY\|CANARY\|PRODUCTION`）」 |
| 问题 | 实测：`:24-30` = `AUTHORITY` 枚举；`:33-39` = `AUTHORITY_RANK`；`:41-42` = 默认值 + `PRODUCTION_LOCKED`；`:45-51` = 中文文案。范围偏宽。**关键影响**：§1.1 要求"插入 `GUARDED_EFFECTIVE`"，实际需**同改两处**（`:24-30` 枚举 + `:33-39` rank），当前锚点未点明。 |
| 建议修正 | 改为「`gen1-authority.js:24-30`（枚举）与 `:33-39`（rank）；插入 `GUARDED_EFFECTIVE` 须**同改此两处**，并同步 `:45-51` 中文文案。」 |

### E15 —【P2】GE 章程不变量 I1 的代码锚点错配

| 项 | 内容 |
|---|---|
| 位置 | `GEN1_GUARDED_EFFECTIVE_CHARTER.md:76`（I1 行） |
| 现状原文 | 「I1 \| Gen-1 不得产出 `final_target` / `final_action` / `suggested_position` \| `gen1-authority.js:115-116`、`gen1-overlay.js:93-94`」 |
| 问题 | `gen1-authority.js:115-116` 实测为 `production_write: false` / `auto_execution: false`，属 **I2** 的内容，不是 I1 的锚点。 |
| 建议修正 | I1 锚点只保留 `gen1-overlay.js:93-94`（实测确为 `out.final_target = prodTarget; out.final_action = prodAction;` ✅）；I2 保留 `gen1-authority.js:115-116`（+ `:151` `authorityForApi` 处亦为 `production_write: false`，可一并列出）。 |

### E16 —【P2】GE 章程 §6.3 的「全仓 0 命中」自指不成立

| 项 | 内容 |
|---|---|
| 位置 | `GEN1_GUARDED_EFFECTIVE_CHARTER.md:323` |
| 现状原文 | 「⚠️ 字段名保持 `ml_effective`（**不是** `m1_effective` —— 全仓 0 命中，且 `M1` 是 Gen-2 的数据边界里程碑…）」 |
| 问题 | 实测（大小写不敏感）`m1_effective` 在全仓**唯一命中即本行自身** ⇒ 本章程入库后，「全仓 0 命中」不再成立。 |
| 建议修正 | 改为「除本注之外全仓 0 命中」 |

### E17 —【P2】GE 章程 §8 的 `WP-G1-GE-01` 交付物缺件未标注

| 项 | 内容 |
|---|---|
| 位置 | `GEN1_GUARDED_EFFECTIVE_CHARTER.md:349`（§8 工作包表） |
| 现状原文 | 「`WP-G1-GE-01  Guarded Effective Contract  ← 本文件 + 冻结制品规格`」 |
| 问题 | PR #42 标题已宣称「WP-G1-GE-01 冻结 Guarded Effective 契约」并已 merge 至 `6793d7f`。但 §8 声明的第二项交付物「**冻结制品规格**」**在仓库中不存在**：全仓无 `GUARDED_EFFECTIVE_FREEZE` 制品、无对应规格文件（该串仅出现在本章程 `:137/:141/:182/:221/:246/:365` 的叙述里）。同时 §3.1 Key 2 把 Freeze Seal 的产出挂在「WP-G1-GE-01/02」名下。 |
| 建议修正 | 该行改为：「`WP-G1-GE-01  Guarded Effective Contract  ← 契约 ✅ 已入库（PR #42, 6793d7f）；冻结制品规格 ⏳ 未产出（待 WP-G1-GE-02 前补齐）`」，避免把 WP-G1-GE-01 读为整体完成。 |

### E18 —【P3】RUNBOOK 未回填执行状态，易被读成「切换尚未发生」

| 项 | 内容 |
|---|---|
| 位置 | `GEN1_CANARY_GO_LIVE_RUNBOOK.md:1-7`、`:182`（第 4 步）、`:193`（第 5 步）、`:211`（第 6 步）、`:221`（第 7 步）、`:236`（第 8 步） |
| 现状原文 | 标题与适用范围仍为待执行语气（`:3`「把 `gen1_authority` 从 `ADVISORY` 升到 `CANARY`」）；第 1 步 `:126` 与第 3 步 `:158` 标 ✅，第 4~8 步无任何状态标记。 |
| 问题 | 第 6 步（切 `CANARY`）**实际已完成**（`WP-G1-GE-RULING_20260916.md:50` 实读 `CANARY`）。未回填会让读者以为"还没切"。 |
| 建议修正 | 在 `:7` 后插入一行：「✅ **本清单已于 2026-09-10 执行完毕**；当前 `gen1_authority = CANARY`（见 `WP-G1-GE-RULING_20260916.md` §3.1）。」，并给第 4/5/6/7/8 步补 ✅。 |

### E19 —【P3】20260910 报告的证据链路径未写全

| 项 | 内容 |
|---|---|
| 位置 | `docs/gen1/GEN1_PRODUCTION_READINESS_REPORT_20260910.md:171` |
| 现状原文 | 「本文档与 `docs/gen1/GEN1_CURRENT_STATE_20260910.md`、`gen1_canary_replay_20260910.json` 为 WP-G1 的完整交付证据链。」 |
| 问题 | 第三个文件名缺路径前缀，实际位于 `docs/gen1/gen1_canary_replay_20260910.json`（**已入库 ✅**，与另两份同级）。 |
| 建议修正 | 补为 `docs/gen1/gen1_canary_replay_20260910.json` |

### E20 —【P3】V4 报告 §六 与 §十 的门禁计数口径不一致

| 项 | 内容 |
|---|---|
| 位置 | `docs/gen1/GEN1_PRODUCTION_READINESS_REPORT_V4.md:159` 与 `:228` |
| 现状原文 | `:159`「Stage G **Gen-1 Production Gates G1-A ~ G1-R 18/18**（新增 **G1-R**）」<br>`:228`「**新增 Gate G1-S**（`tests/schema-collections-parity.test.js`）…」 |
| 问题 | 两节同属 PR #18 范围，`:159` 未把同 PR 新增的 `G1-S` 计入（应 ≥19 门）。属历史快照内部不自洽。 |
| 建议修正 | `:159` 补注：「（本 PR 另新增 `G1-S`，Stage G 该点实际 **19 门**；后续 `G1-T`/`G1-U` 见 RUNBOOK §0）」 |

### E21 —【P2】线上 `config_version` 版本串滞后于真实 authority（第三轮新增）

| 项 | 内容 |
|---|---|
| 位置 | 线上 `runtime_status.config_version`（实测值：`2026-09-01-gen1-advisory-active`） |
| 现状原文 | 版本串自称 `gen1-advisory-active`，而同一份 `runtime_status` 中 `gen1_authority` 实测为 **`CANARY`** |
| 实测时点 | `runtime_status.updated_at = 2026-09-16T00:00:26.690Z`；`decision_date = 2026-09-16`（**实时只读查询所得，非文档快照**） |
| 问题 | 该串在上线时正确，但 authority 已于 **2026-09-10 16:18** 切至 `CANARY`（`WP-G1-GE-RULING_20260916.md` §3.1 实读），版本串**未随之更新** ⇒ 与 `GEN1_CURRENT_STATE_20260910.md` A.6 属**同一类「自称状态落后于真实状态」**缺陷，且因它出现在线上运行时字段里，比文档更易被误引为 authority 依据。 |
| 与 E5 的关系 | **同源、不同载体**：E5 是文档文本，E21 是线上字段。修 E5 不修 E21，漂移仍在；反之亦然。 |
| 建议修正 | ① **不得把 `config_version` 当作 authority 依据**（快照与巡检模板均应改引 `gen1_authority` 字段本身）；② 若需重写该串，属**线上写操作**，须**单独放行**并说明回退方式 —— 本轮**明令禁止**，故仅登记。 |
| 处置载体 | ⚠️ **不是 docs-only**：其修正载体是线上数据，**不能混进 ⑤ 状态快照**，也不宜并入任一批次的 docs PR；建议单独立项（与本轮 §4 U4 同批处理）。 |
| 用户裁定 | ✅ 2026-09-16 用户明确：「适合作为 E21 单独登记，不要混进状态快照。快照负责回答『现在是什么』，勘误表负责回答『哪些历史文字已经落后』。」 |

### E22 —【P1】`ml_effective` 释义过强：与 GE 章程 §6.3（**FROZEN**）定义不等价（第四轮新增）

| 项 | 内容 |
|---|---|
| 位置 | ① **正确一侧（对照物）**：`docs/gen1/GEN1_GUARDED_EFFECTIVE_CHARTER.md` §6.3 —— **已冻结**；② **待改一侧**：`docs/gen1/GEN1_EVIDENCE_MONITOR_STATUS_ERRATUM_20260916.md` §0.2（快照措辞，`a8bf76d` 已提交） |
| 冲突原文 | 快照 §0.2 把 `ml_effective` 释义为「Gen-1 **对正式生产决策是否生效**」；章程 §6.3 冻结定义为 `ml_effective = gen1_guarded_effective_active`，即「**Guarded Effective 运行门是否成立**」 |
| 问题 | 二者**不等价**：「运行门成立」**并不蕴含**「结果被采纳」。GE-02/GE-03 阶段确实可能存在下列**四者同时成立**的中间态 —— `gen1_guarded_effective_active = true`、`ml_effective = true`、`gen1_guarded_selector_source = BASELINE`、`gen1_adopted = false` ⇒ 此时 `ml_effective = true`，但正式决策结果**仍未被 Gen-1 改变**。故「对正式生产决策生效」这一释义**过强**。 |
| 字段实存性 | 上述字段均**实存**（第四轮实测核对，非杜撰）：`src/common/schema.js:291`（`decision_source`）、`src/common/schema.js:294`（`gen1_adopted`，注「GE-02 恒 false」）、`src/common/schema.js:302`（`gen1_guarded_selector_source`，注「GE-02 恒 BASELINE」）；实现见 `src/common/utils/gen1-guarded-selector.js:106,130,161,173` 与 `src/common/utils/gen1-overlay.js:106,109,122`；硬断言见 `tests/gen1-guarded-selector-noop.test.js:128`。 |
| 与 #43 的关系 | ❌ **不是 #43 的缺陷**。#43 是**忠实实现已冻结的章程**；冲突发生在**我们快照的措辞**一侧。 |
| 建议修正 | 下一次 docs 勘误批次把 §0.2 释义**收紧**为：`ml_effective` = Gen-1 Guarded Effective **运行门是否 active 的 legacy / summary alias**；**是否真正进入正式决策结果**，应看 `gen1_adopted` / `gen1_guarded_selector_source` / `decision_source`，**不能只看 `ml_effective`**。 |
| 处置载体 | ✅ **docs-only**，但载体在 `docs/gen1-monitor-status-clarify` 分支的 §0.2 ⇒ 修正须**新开一个 commit**；⛔ **不得 amend `a8bf76d`**（已按 ⑥ 裁定冻结）；⛔ **不得修改 FROZEN 章程**（章程是正确一侧）；⛔ 不得改 #43。 |
| 现实风险 | **当前为零**：线上两侧实测均为 `false`（`runtime_status.updated_at = 2026-09-16T00:00:26.690Z`），且 GE-02 下 `gen1_adopted` 恒 `false`、selector 恒 `BASELINE` ⇒ 该张力属**潜在而非现实**。 |
| 用户裁定 | ✅ 2026-09-16：「C1 选 (a)：登记为 E 系列 errata，现在登记，但不要改冻结 Charter，也不要把它当成 #43 的技术缺陷。」 |

> ⚠️ **不得把 E22 读成「章程有错」**：章程 §6.3 是**已冻结的权威定义**。本项只主张**快照措辞**应收紧到与章程同义，**不反向改章程**。
> ⚠️ **E22 的来源**：由 ⑦ PR #43 只读审计的分类三「C1」转化而来（`GEN1_PR43_READONLY_AUDIT_20260916.md`）。登记即关闭 C1 的「待裁定」状态；**不构成对 #43 的阻断**。

---

### E23 —【P2】`GEN1_CURRENT_STATE_20260910.md` 的冻结清单枚举落后（**#43 合入后**立即过期）（第五轮新增）

| 项 | 内容 |
|---|---|
| 位置 | `docs/gen1/GEN1_CURRENT_STATE_20260910.md:83`（该文档题为「当前状态」，落笔日 2026-09-10） |
| 记录原文 | `FROZEN_PARAM_KEYS（后台禁改）：volume_ratio_mild, tech_sector_max, ml_fast_path_enabled, ml_challenger_model_id, ml_gen1_frozen, ml_shadow_bundle_id` —— **列 6 项** |
| 事实 | PR #43（`b7247f9`）把 `gen1_authority` 纳入 `FROZEN_PARAM_KEYS` ⇒ 实为 **7 项**。2026-09-10 落笔时 6 项**是对的**；**一旦 #43 合入，该行立即过期**。 |
| 定性 | 属 **#43 引入的文档漂移**（**非** #43 的实现缺陷 —— #43 只改代码常量，未同步该枚举行）。 |
| 现实风险 | ~~**当前为零**：#43 **尚未合并** ⇒ 该行**今天仍然正确**。过期是**条件性**的（`#43 merged` 之后才成立）。~~ **第六轮更新（2026-09-16T16:06:26+0800）：条件已触发** —— PR #43 已由所有人以 merge commit 合并（`master = c9af16b1`）⇒ 本项**由「条件性过期」转为「现实过期」**。实测：合并树 `src/common/constants.js:61-74` 为 **7 项**（既有 6 项 + `gen1_authority`），与 `:83` 所记 6 项**不符**。 |
| 处置载体 | docs-only；⛔ **不得修改该 2026-09-10 历史快照正文**（属历史记录），只允许**加 forward-pointer / 勘误指向**，或由后续新版 `CURRENT_STATE` 承接 —— **具体形式待 §5 批次批准时定**。 |
| 附注 | `VERSION.txt:27` 写「仅 2 key」是**既存**过期（早于 #43），与本项**不同源**，已另立 **E12**。 |
| 用户裁定 | ✅ 2026-09-16：「C2 非 blocker，**文档状态同步处理，不改历史快照**。」<br>✅ 2026-09-16（第九轮）：「**E23 从 conditional 转为现实过期，我同意。**」 |

> ⚠️ **E23 与 E22 同批次（批次 7）**：二者均由 ⑦ PR #43 只读审计的分类三转化而来（E22 ← C1、E23 ← C2），
> 且**都需以新 commit 落地** —— ⛔ 不 amend `a8bf76d`、⛔ 不改 #43、⛔ 不改 FROZEN 章程。

---

### E24 —【P1】P2 Release Gate §2 A3 的**等价性探针前提为假**（`git archive` 在本机会做行尾转换）（第六轮新增）

| 项 | 内容 |
|---|---|
| 位置 | `docs/gen1/GEN1_P2_RELEASE_GATE_20260916.md` §2 A3 的注：「以 `README.md` 为探针确认 `git archive` **不做行尾转换**……故 blob 可比」 |
| 事实 | **本机实测该前提不成立**：仓库**无 `.gitattributes`**，且 `core.autocrlf = true` ⇒ `git archive` 导出时会做 **LF → CRLF** 转换。实测 `README.md`：blob **3087 B / 0 个 CRLF**（`sha1 = 0333870c…`）→ 导出文件 **3147 B / 60 个 CRLF**（`sha1 = f302536f…`）；**去掉 `\r` 后逐字节相同**。 |
| 影响 | **结论不变，措辞与方法须改**。原结论「候选树 9 个合并文件 blob 与 merge-tree 预测逐位 MATCH 9/9」若真按**字节**比对则不应成立；该结论的**正确表述**是「**归一化行尾后**逐字节相同」，或改用**不经过工作区**的比对方式。 |
| 本轮采用的更强方法 | 一律改用 **blob 级** `git rev-parse <commit>:<path>`（不经工作区、不过滤器）复核：PR #43 的 19 文件在 `b7247f9` 与 `6a771a1` **19/19 相同**；PR #44 的 3 文件与 `2e8cb7d` **3/3 相同**；全树 523 文件差异 **0**；`git merge-tree` 预测 result blob 与**真合并树** **9/9 命中**。⇒ 结论被**独立复核并加固**。 |
| 处置载体 | docs-only（批次 7）：修正 §2 A3 的探针措辞，并**追加**「本机 `core.autocrlf=true` ⇒ 任何跨工作区的字节比对都必须先归一化行尾，或改用 blob 级比对」的固定提示。 |
| 附注 | 本项属**方法学勘误**，不影响任何治理判定、门禁结论或已冻结内容。 |
| 用户裁定 | ✅ 2026-09-16（第九轮）：**E24 保留** ——「`git archive` 在你当前 CRLF 环境下不能作为 blob 等价性的证明工具，这条方法学修正值得永久留下。」 |

---

### E25 —【P1】P2 Release Gate §10 / §9.2 ④ 的**绝对措辞**无法覆盖「head 以等价方式前进」这一合法情形（第六轮新增）

| 项 | 内容 |
|---|---|
| 位置 | `docs/gen1/GEN1_P2_RELEASE_GATE_20260916.md` §0 放行条件②、§9.2 放行语句比对表第 ④ 行、§10 禁止表（`Update branch` 一栏）、§11 A1 判据（「父**恰为** ……两个」） |
| 事实 | 合并**实际使用的 head 不是** `b7247f9`，而是 `Update branch` 之后的 `6a771a1`（本身是合并提交：父① = `b7247f9`、父② = `2e8cb7d`）。⇒ §9.2 ④「不得 `Update branch`」**字面被突破**。 |
| 同时成立的事实 | 该前进**内容等价、可证明**：19/19 文件逐 blob 相同、patch-id 相同、master 侧 3 文件与 #43 的 19 文件**互不相交**、`tree(c9af16b1) == tree(6a771a1)`（全树差异 0）、`merge-tree` 预测 9/9 命中 ⇒ **审计覆盖完整、无未经审核内容进入**。 |
| 定性 | 属**条款措辞缺陷**（无法表达"合法等价前进"），**不是**「门禁被打破」的事件。⛔ 不得写成「完全按冻结方案执行」（与事实不符）；⛔ 也不得写成「门禁失效」（与证据相反）。 |
| 建议修正 | 把绝对禁止改为**条件式**：<br>「当 head 由已审计 head 前进时，**仅当**同时成立下列各条才视为**等价替换**、不重开门禁：(a) 已审计 head 是新 head 的**祖先**（非 rebase / 非 squash）；(b) 新 head 的另一父**恰为已审计 master**（无第三方提交）；(c) 变更文件集与行数规模与已审计变更集**完全一致**；(d) 每个变更文件在新旧头之间**逐 blob 相同**。任一条不满足 ⇒ **本 Gate 失效，须重跑 ⑧**。」 |
| 处置载体 | docs-only（批次 7）：修正 §0 条件②、§9.2 ④、§10 禁止表与 §11 A1 判据的措辞。 |
| 相关偏差登记 | 该事实已在 `GEN1_P2_POST_MERGE_ATTESTATION_20260916.md` 登记为 **D1**；**归档口径已于第九轮裁定为「等价替换」，D1 状态 = CLOSED**（不重开 ⑧、不回滚 #43、不改变 `P2_COMPLETE_DORMANT`）。 |
| 用户裁定 | ✅ 2026-09-16（第九轮）：**E25 保留**，并给出**前向规则**（见下表后的处置升级块）。 |

**E25 的处置升级 —— 用户 2026-09-16（第九轮）裁定的「前向规则」**：

> 「以后不能再用『父 SHA 必须永远等于原 SHA』这种**绝对规则**，而应要求
> **『head 变化 ⇒ 原审计对象失效，必须重新冻结新 head 并重新验收后才能 merge』**。」

⇒ 本项（E25）的修正因此分两层，**两层都要落**：

```text
第 1 层（回溯判定 —— 用于「已经发生」的 head 前进）：
   仅当下列四条同时成立，才可判为「等价替换」，不重开门禁：
   (a) 已审计 head 是新 head 的祖先（非 rebase / 非 squash）；
   (b) 新 head 的另一父恰为已审计 base（无第三方提交）；
   (c) 变更文件集与行数规模与已审计变更集完全一致；
   (d) 每个变更文件在新旧头之间逐 blob 相同。
   任一条不满足 ⇒ 原 Gate 失效，须重跑。

第 2 层（前向规则 —— 用于「尚未 merge」的 PR）：
   head 一变（含 Update branch / rebase / force-push）⇒
   原审计对象即刻失效；
   必须重新冻结新 head、并对新 head 重新验收
   （重跑 required CI + 重做等价 / 闭合证明），之后才可以 merge。
   ⛔ 不得以「内容看起来没变」为由直接沿用旧审计结论。
```

⚠️ **两层的关系**：第 1 层回答「**已经 merge 的这一次算不算安全事件**」（本案 = 否，故 D1 归档为「等价替换」）；
第 2 层回答「**下一次该怎么走**」（必须重冻 + 重验收，不能直接合）。
⛔ **不得把第 1 层的判据当成第 2 层的放行依据** —— 那是把「事后可证」误读成「事前免检」。

### E26 —【P1】写入能力结论未限定「**通道 × 凭据权限 × 时点**」，属过强表述（第八轮新增；**第十轮改写为条件式**）

> 🔁 **第十轮改写（2026-09-16T17:2x）**：本条初稿的限定轴是「**通道 × 动作**」—— 方向正确，但**仍不足以**排除
> 「**用旧证据下当前结论**」：同一条「fine-grained PAT × merge」在**同一天**先后给出 `403`（`15:2x`）与
> `200 / merged=true`（`16:32`），差别只在**令牌权限状态**。
> ⇒ 限定轴补全为 **「通道 × 凭据权限 × 时点」**；「**时点提升**」这一类缺陷另立为勘误 **E27**。

| 项 | 内容 |
|---|---|
| 位置 | `GEN1_P2_RELEASE_GATE_20260916.md` §9.1（执行通道表 + 「更正留痕 ④」）与 §9.3（(B) 行）；`GEN1_PR43_READONLY_AUDIT_20260916.md` §11「**末次实证：写已证否**」 |
| 原表述 | 由一次 `PUT /repos/…/pulls/43/merge` 返回 `403` 推得「**写被证否**」—— **既未限定通道与动作，也未限定该令牌当时的权限状态与观测时点** |

**历史事实（须连边界一起读）**：

```text
约 2026-09-16T15:2x：**当时那组权限下**，fine-grained PAT 对 PR merge 返回
                    403 Resource not accessible by personal access token
⇒ 仅证明「**该时点、该令牌权限状态下**，该通道上的该 API 写动作不可用」。
⇒ ⛔ 不构成「本机 GitHub 写能力被证否」；⛔ 不构成「API 通道永久不可写」。
```

**后续事实（同为「已授权动作」的副产物；属「后续权限状态」）**：

```text
① SSH（git）通道     git push 新分支           ⇒ 成功
② fine-grained PAT   POST /pulls（建 PR）       ⇒ 201 Created（PR #46）
③ fine-grained PAT   PUT /pulls/45/merge       ⇒ 200 / merged=true
                     （发生在 owner 为该令牌补 `Contents: Read and write` **之后**；
                       产出的 merge commit = 当时 master）
④ MCP GitHub App     POST /pulls               ⇒ 403 Resource not accessible by integration
⇒ API 通道**后来已获得**相应写能力 —— 差别只在**凭据权限状态**，
  ⛔ 不在「通道本身有没有写能力」。
```

| 项 | 内容 |
|---|---|
| 定性 | 原结论对 **SSH 通道**、**PAT 的「建 PR」动作**、以及**补权后的 merge 动作**均不成立 ⇒ 属**未限定作用域与时点的过强表述**。<br>⚠️ 这与 §9.1 已登记的「**结论对 ≠ 推理对**」**不是同一类问题**：那一条是**依据错、结论对**；这一条是**结论本身过强，必须加限定**。 |
| ✅ **正确结论** | **写能力 = 通道 × 凭据权限 × 时点**。任何一条能力结论都须能回答四问：<br>① 哪条**通道**（SSH / fine-grained PAT / GitHub App）？<br>② 用**哪份凭据**、当时具**什么权限**？<br>③ 哪个**动作 / endpoint**（`POST /pulls` 与 `PUT /pulls/{n}/merge` 是两件事）？<br>④ **什么时刻**观测（`as-of`）？<br>四问缺一 ⇒ 该结论**不得**写成能力判断。 |
| ⛔ **禁止结论** | ① 「本机 GitHub 写能力被证否」；② 「API 通道永久不可写」；③ 由某次 `GET` 响应头推断完整 token scope；④ 由**一次** `403` **或一次** `200` 外推到其他通道 / 其他动作 / **其他时点**。 |
| 建议修正 | 「写被证否」一律改写为**带「通道 + 动作 + 权限前提 + `as-of`」的条件式**：<br>• 「**merge 动作**在 fine-grained PAT 通道，**`as-of 15:2x` 且令牌未具 `Contents: RW` 时**被拒（`403`）；**补权后（`16:32`+）同一动作可用（`200` / `merged=true`）**」；<br>• 「**建 PR 动作**在同一 PAT 通道**可用**（`201`）」；<br>• 「**git push** 在 SSH 通道**可用**」；<br>• 「MCP App 通道**写路径不可用**（`403 by integration`）」。<br>「当前唯一可执行路径」相应改为：「分支推送 / PR 创建 / **PR merge** agent 均可代做；**merge 的前提**是该令牌具 `Contents: Read and write`，且每次代合仍须以 `sha` 锁定已审计 head。」 |
| 教训 | ⛔ **不得把「某条通道上某个动作写失败」写成「整个身份写被证否」**（第八轮教训）；<br>⛔ **也不得把「某时点的一次失败 / 一次成功」写成「当前能力」**（第十轮教训 —— 同一条「fine-grained PAT × merge」在**同一天内**结论相反）。<br>跨**通道** / 跨**动作** / 跨**时点**推断一律禁止（与 §9.1 的跨依据推断同属一类错误）。 |
| 附注 | 本条由第八轮的**实际建 PR 动作**暴露；第十轮的**正证据**同样来自**已授权动作**（PR #45 的合并），⛔ **不是**写探测。 |

---

### E27 —【P1+】**过期能力结论**：把「补权前的 `403`」当成「**当前**能力」写（第十轮新增）

| 项 | 内容 |
|---|---|
| severity | **P1+** |
| type | `STALE CAPABILITY CONCLUSION` |
| runtime risk | **NONE**（只涉及文档 / 治理留痕，不触及运行时代码、Authority、锁或线上字段） |
| scope | docs / governance evidence |
| status | **`FIX IN PR #46 BEFORE MERGE`** |
| 位置 | `GEN1_P2_RELEASE_GATE_20260916.md` **§9.1 结论行**（「**merge（fine-grained PAT）**：⛔ 不可用」）与 **§19 结论块**（「PR merge ⛔ agent 不可代做」）；`GEN1_PR43_READONLY_AUDIT_20260916.md` **§11**（「末次实证：写已证否」） |
| 原表述 | 用 **2026-09-16T15:2x（令牌补权**之前**）** 的 `PUT …/pulls/43/merge` ⇒ `403`，写成**在后续时点仍然成立**的当前能力结论（相关文档落笔于 `16:5x`–`17:0x`） |
| 为何是缺陷 | 该 `403` **作为历史事实是对的**；错在**时点提升** —— 把「某时刻的观测」升格为「当前能力」。<br>同一令牌在 **`16:32`** 对**同一个** merge 动作返回 **`200` / `merged=true`**，其产出的 merge commit 即当时 `master` ⇒ 该结论**在文档落笔时已经过期**。 |
| 闭合证据（全只读） | 执行该 merge 的凭证脚本落盘 **`16:32:14`**，merge commit 的 committer 时间 **`16:32:50`** ⇒ **相隔 36 秒**；脚本内 `EXPECT_SHA` 恰为该 merge commit 的**第二父**。<br>⚠️ merge commit 的 `author` / `committer` 字段**无法**区分通道（Web UI 与 API 均记为 `GitHub <noreply@github.com>`）⇒ 该闭合**不依赖** committer 字段，而由「脚本 + 时间戳 + 父子关系」三者相互印证。<br>⛔ 该合并与其中的写动作**均已获授权**，⛔ 不是写探测。 |
| 与 E26 的关系 | **互补、不重复**：<br>• **E26** 修的是**限定轴不足**（缺「通道 / 动作」）⇒ 补「**凭据权限 + 时点**」；<br>• **E27** 修的是**时点提升**（用旧证据下当前结论）⇒ 给旧 `403` 加**显式时间边界**、并补**后续正证据**；<br>两者最终收敛到同一条 SOP：「**写能力 = 通道 × 凭据权限 × 时点**」。 |
| ✅ 修正方式（**不是删历史**） | ① **不删**该 `403` 记录 —— 它仍是「当时那组权限下、该动作不可用」的合法证据；<br>② 给它加**显式时间边界**（`as-of 2026-09-16T15:2x`，并注明当时权限状态）；<br>③ 补**后续正证据**（补权后的 `201` 建 PR、`200` merge），并**标明属后续权限状态**；<br>④ 「⛔ 不可用」一律改写为**带前提的条件式**（前提 = 该令牌**尚未**具 `Contents: Read and write`）。 |
| 教训 | ⛔ **不得用某一时点的旧证据下「当前能力」结论**。<br>凡「不可用 / 不存在」类断言，须同时给出 **观测时刻 + 当时权限 / 状态 + 枚举域**；三者缺一，结论无效。 |
| 载体 | **P2 Closure docs-only PR（PR #46）** —— 于 merge **之前**修正；⛔ 不把已知的过期结论先合进 `master`、再等下一批补救。 |

---

## 3. 未发现问题的部分（可放心引用）

> 明确列出，避免"勘误＝全盘可疑"的误读。

| 文档 / 断言 | 复核结果 |
|---|---|
| `GEN1_EVIDENCE_CONTRACT.md` 全篇（17 字段、方向约定、MFE/MAE 口径、Q1/Q2/Q3 阈值、三种终局、元规则） | ✅ 自洽；与 GE 章程 §5.1「P4 前置 = Q1 ∧ Q2 成立且 Q3 不成立，且独立事件 ≥ 30」**逐条一致** |
| `GEN1_DAILY_PRODUCTION_WATCH.md` §1 W1-W7 字段名 | ✅ 与 `runtime_status`（`index.js:1058,1059,1065,1074,1075,1083`）**逐字一致** |
| `GEN1_FIRST_LIVE_CANDIDATE_PROTOCOL.md` | ✅ M3 字段名正确；`runDecisionEngine/index.js:777`（invocation 计数）**行号精确命中**；`gen1-safety-permission.js:230`（`effective_canary` 合成式）**行号精确命中**；文中给的合成式与源码六项完全一致 |
| `WP-G1-GE-RULING_20260916.md` §3.2 | ✅ PR #41 merge SHA `d254a7a67841aa84b1138c6404b31f273ed1f3fc` **实测一致**；「4 文件 / +460 / −0」**实测一致**（`c889d5d`）；merge（非 squash）**实测一致**；d66cd86 为 HEAD 祖先 **实测成立** |
| `GEN1_GUARDED_EFFECTIVE_CHARTER.md` 全部代码行锚点 | ✅ 抽查 **12/12 命中**：`index.js:553 / :655 / :695-707 / :785-788 / :790 / :1048 / :1108`、`gen1-overlay.js:48 / :93-94`、`gen1-execution-boundary.js:14 / :25-44`、`gen1-safety-permission.js:230`、`constants.js:61-69` |
| `docs/gen1/gen1_canary_replay_20260910.json` | ✅ 与 V2/V3/V4 报告数字**逐项一致**：698 S2 日 / 3 候选 / 3 簇 / 2 独立事件 / 1696 交易日 / timing 0.705 / exc20 +16.4% / false_fast_path 0 / BULL=0 / by_code 515880×1 + 159582×2 |
| GE 章程 §1.2 语义链（`GUARDED_EFFECTIVE` ≠ 生产写权限；`production_write`/`auto_execution` 恒 false；PRODUCTION 档不可达） | ✅ 与 `gen1-authority.js:42,89-95,115-116,140-142` 及 `gen1-execution-boundary.js:14,25-44` 一致 |

---

## 4. 需在别处（线上 / 他机）复核、本 worktree 无法判定的项

> **第三轮更新（2026-09-16）**：CloudBase 只读通道实测**可用**，U1–U4 的「线上字段」部分已实时实读并结案；仍余的「云函数侧」缺口见下表状态列。
> 数据源：`runtime_status` 集合，`updated_at = 2026-09-16T00:00:26.690Z`、`decision_date = 2026-09-16`。**须带此时点引用，不得当作长期结论。**

| # | 项 | 状态 | 实读结果 / 剩余缺口 |
|---|---|---|---|
| U1 | `runtime_status.gen1_authority` 现网是否仍为 `CANARY` | ✅ **部分结案** | 实测 **`CANARY`**（"灰度反事实"）。**余**：`param_config` 侧未读（本轮只读 `runtime_status`）。 |
| U2 | `gen1_counterfactual_canary_invocations` 现网值（文档记 `0`） | ✅ **结案** | 实测 **`0`**，与文档记载一致。 |
| U3 | `gen1_production_write` / `gen1_auto_execution` 现网是否仍 `false`（**安全不变量，优先级最高**） | ✅ **结案** | 实测 **`false` / `false`**；另测 `gen1_broker_wired = false`、`gen1_production_fast_path_enabled = false` ⇒ 侧写能力全关。 |
| U4 | `InstallDependency` / `config_version` 遗留项现状 | ⚠️ **部分结案** | `config_version` 实测 `2026-09-01-gen1-advisory-active` ⇒ **漂移成立，已立为 E21**。**余**：`InstallDependency`（云函数侧）未读，仍需 `queryFunctions`。 |

> 同批实读到的其它权威字段（供 ⑤ 快照引用）：`ml_effective = false`、`ml_gen1_frozen = true`、`gen1_safety_source = SAFETY_CORE`、`production_engine = v3.6.1`、`gen1_counterfactual_canary_{active,authorized,health_allowed} = true`。
> ⚠️ **两根轴，勿合成一句**：`production_engine`/`gen1_safety_source` 是 **Production decision authority**（`final_target` 唯一来源）；`gen1_authority` 是 **Gen-1 layer authority**。E5 的错误正是把两者混读。
| U5 | `主链冻结契约.md` §1 的 10 个云函数线上 SHA256 | 线上事实 | `queryFunctions.getFunctionDownloadUrl` 逐一校验 |
| U6 | `CANARY_SWITCH_REPORT.md` 是否曾在别机/别处存在 | 本机全盘无 | 用户确认或他机检索（见 E1） |
| U7 | 4 份 Gen-1 证据文档 PR #41 的「CI 8/8 全绿」 | 需 GitHub API | `gh` / Web UI 查 run 记录 |

---

## 5. 建议的修改批次（不得一次性全改）

| 批次 | 内容 | 理由 |
|---|---|---|
| **批次 1（先做）** | E1、E2、E8 —— 悬空引用与不可复核取证 | 治理链完整性优先；改动纯注释/括注，不触任何数字口径 |
| **批次 2** | E3、E4、E9 —— 门禁/测试计数过期 | 一处口径一次改完，附实测值，避免留下半新半旧 |
| **批次 3** | E5、E7、E18 —— 时效与 as-of 标注 | 防"历史快照被当现状"，属可读性关键项 |
| **批次 4** | E6 —— RUNBOOK 字段名前缀 | 实操性纠错，需与 runner 侧字段命名一并确认 |
| **批次 5** | E10、E11 —— 缺陷/测试状态回填 | 需先对剩余条目做一次状态盘点（E10 涉 Gen-2 条目，建议另立） |
| **批次 6** | E12 ~ E17、E19、E20 —— 表述与锚点精修 | 低风险，可合并为一个 docs-only PR |
| **批次 7（下次 docs 批次）** | E22 —— `ml_effective` 术语口径收紧；E23 —— `CURRENT_STATE_20260910.md` 冻结清单枚举落后（**已于 2026-09-16T16:06:26 合并后转为现实过期**）；**E24** —— P2 Gate §2 A3 的行尾探针前提修正；**E25** —— P2 Gate 放行条款由绝对措辞改为**等价替换条件式** | E22 载体在 `docs/gen1-monitor-status-clarify` 的 §0.2（`a8bf76d`）⇒ 须**新 commit**、⛔ 不 amend、⛔ 不改 FROZEN 章程；E23 ⛔ **不改 2026-09-10 历史快照正文**，只允许加 forward-pointer 或由新版 `CURRENT_STATE` 承接；E24/E25 载体为 P2 Gate 文档 ⇒ 已获 owner 放行进入 **P2 Closure docs-only PR**（该放行只覆盖**建 PR**，⛔ 不授权 merge，见 `GEN1_P2_RELEASE_GATE_20260916.md` §9.4）；**E26** —— 写入能力结论须按「**通道 × 凭据权限 × 时点**」限定（**第十轮已按 owner 裁定改写为条件式**）；**E27** —— **过期能力结论**（补权前的 `403` 被当成当前能力）须**加时间边界 + 补后续正证据**，`P1+` / runtime risk `NONE` / `FIX IN PR #46 BEFORE MERGE` |

**纪律建议**：每批次一个 docs-only PR；不做 squash（沿用本仓既有惯例，保留「Gen-1 如何取得权限」的审计链）。

> ⚠️ **E21 不进任何 docs 批次**：其载体是**线上字段**（`runtime_status.config_version`），修正需线上写权限 ⇒ **单独立项、单独放行**，见 §4 U4 与 E21「处置载体」行。批次 1–6 均**不含** E21。

**第二轮去重后的归属（勿重复落地）**：

| 事项 | 承载文件 | 分支 | 本轮是否落地 |
|---|---|---|---|
| 自动化已停止 / 7 项手工按需 / 读数属历史快照 | `GEN1_EVIDENCE_MONITOR_STATUS_ERRATUM_20260916.md` §2.1–§2.3 | `docs/gen1-monitor-status-clarify`（`4ea8363`，**未合并**） | ❌ 不重复 |
| P2/P3 不构成代码授权（**法理链需按 D1 裁定后补引 RULING**） | 同上 §3 + 章程 §5.1 | 同上 | ❌ 不重复（仅登记 D1–D3） |
| E1–E20（引用健全性 / 计数过期 / 锚点错配） | 本报告 | `gen1-worktree-20260916`（未提交） | 待你逐批批准 |
| **E21（线上 `config_version` 漂移）** | 本报告 + 线上 `runtime_status` | —（**无 docs 载体**） | ❌ 只登记；修正属线上写操作，需单独放行 |
| **E22（`ml_effective` 释义过强）** | `GEN1_EVIDENCE_MONITOR_STATUS_ERRATUM_20260916.md` §0.2（`a8bf76d`） | `docs/gen1-monitor-status-clarify` | ❌ 只登记；修正属**下一个 commit**（⛔ 不 amend `a8bf76d`），归入**批次 7** |
| **E23（`CURRENT_STATE_20260910.md` 冻结清单枚举落后）** | `docs/gen1/GEN1_CURRENT_STATE_20260910.md:83`（**历史快照**） | 待定（须**新 commit**） | ❌ 只登记；**#43 合入后**才真正过期；⛔ 不得改写该快照正文，只允许 forward-pointer 或新版承接，归入**批次 7** |
| **E24（`git archive` 行尾转换 ⇒ blob 等价性证明手法须改）** | 本报告 + `GEN1_P2_RELEASE_GATE_20260916.md` §2 A3 | P2 Closure docs-only PR | 归入**批次 7**；✅ 第九轮裁定「保留」 |
| **E25（放行条款绝对措辞 → 等价替换条件式 **+ 前向重冻规则**）** | 本报告 + `GEN1_P2_RELEASE_GATE_20260916.md` §0 条件② / §9.2 ④ / §10 / §11 A1 | P2 Closure docs-only PR | 归入**批次 7**；✅ 第九轮裁定「保留」并增补前向规则 |
| **D1（`Update branch` 使已审计 head 前进）** | `GEN1_P2_POST_MERGE_ATTESTATION_20260916.md` §2.4 / §6 | P2 Closure docs-only PR | ✅ 第九轮裁定 = `PROCESS DEVIATION / CONTENT-PRESERVING / RE-ATTESTED / NON-SAFETY / **CLOSED**`；不重开 ⑧ |
| **E26（写入能力须按「通道 × 凭据权限 × 时点」限定）** | 本报告 + `GEN1_P2_RELEASE_GATE_20260916.md` §9.1 ⑤ / §9.3 / §19 + `GEN1_PR43_READONLY_AUDIT_20260916.md` §11 | P2 Closure docs-only PR | 第八轮由**实际建 PR 动作**暴露；**第十轮按 owner 裁定改写为条件式**（限定轴补全 + 加时点边界）；⛔ 不改写历史 `403` 事实，只**加限定并给出新证据** |
| **E27（过期能力结论：补权前的 `403` 被当成当前能力）** | 本报告 + `GEN1_P2_RELEASE_GATE_20260916.md` §9.1 / §19 + `GEN1_PR43_READONLY_AUDIT_20260916.md` §11 | P2 Closure docs-only PR | **第十轮新增**；severity `P1+` / type `STALE CAPABILITY CONCLUSION` / runtime risk `NONE` / **`FIX IN PR #46 BEFORE MERGE`**；⛔ 不删历史 `403`，只**加时间边界 + 补后续正证据** |

> ⚠️ **合并顺序提示**：既有分支 `4ea8363` 的父提交 = `6793d7f`，与本 worktree HEAD 相同 ⇒ 两个 worktree 各自新增文件时**不冲突**；但两份「勘误」文档若同时合并，读者需能分辨「运行状态勘误」与「引用健全性勘误」——已在各自 §0/§3 互链注明。

---

## 6. 合规声明（本轮边界）

- ✅ 未修改任何 Gen-1 **运行代码**（`src/` / `cloudfunctions/` / `web/` / `scripts/` 零改动）
- ✅ 未触碰 `gen1_authority`、`ml_effective`、`FROZEN_PARAM_KEYS`
- ✅ 未部署、未写生产库、未提 authority、未开自动交易
- ✅ 未修改任何 `ml/gen2/**` 文件
- ✅ 未合并任何 PR；未新建分支；未 commit
- ⚠️ **一次工具副作用（已还原）**：执行 `node scripts/gen1-production-gates.js` 取证时，Gate `G1-J` 的 `scripts/audit-gen1-sector-contract.js` 会把审计结果写回受跟踪文件 `ml/manifests/GEN1_SECTOR_CONTRACT_AUDIT.json`，导致行尾被规范化为 CRLF、`git status` 出现 ` M`。**内容逐字节未变**（`git diff` 为空），已用 `git checkout --` 还原，工作区已恢复干净。后续若再跑该门禁，需注意此副作用。

---

### 6.1 第二轮（2026-09-16）补充边界

- ✅ **未新建任何文件、未新建分支、未创建 PR** —— 已存在的同类勘误见 §0.1，本轮**不重复创建**。
- ✅ 本轮仅编辑**本文件自身**（未跟踪文件），未改动任何**被跟踪**文件（`git status --short` 仅本文件一条 `??`）。
- ✅ **未修改任何 `.js` / `.py` 运行代码、配置、Authority 或锁**：`src/**`、`cloudfunctions/**`、`scripts/**`、`ml/**` 零改动；未触碰 `gen1_authority` / `ml_effective` / `ml_gen1_frozen` / `FROZEN_PARAM_KEYS` / `ml_effective` / `lock_revision` / `immutable_set`。
- ✅ **未合并、未创建、未更新任何 PR**；对开放 PR 仅做**只读**元数据与文件清单查询（`#43` / `#21` / `#10` / `#4` / `#2` / `#1`）。
- ✅ **自动化状态已当场实测**：查询自动化列表返回 **0 条** ⇒ 印证「每日只读巡检自动化已停止」这一事实（只读查询，未创建 / 未修改 / 未删除任何自动化）。
- ✅ **D1 已裁定 = (c)**：项目级阶段许可已下，但**每个实施 PR 仍须单独放行**；已按 (c) / D2 / D3 落地到 `82debe8`（见 §0.3）。
- 🚫 **本文件保持为「本地审计草稿」**：不 commit、不入库、不建 PR。仅 **E1–E21** 待你逐批批准后再议（E21 另需线上写放行，见 §5）。
- ✅ 该分支已按用户放行**推送完成**：`origin/docs/gen1-monitor-status-clarify` = `82debe8`（`git rev-list --left-right --count` = `0 0`）。**未创建 PR**。

---

### 6.2 第三轮（2026-09-16）边界

- ✅ **ETF 仓库被跟踪文件零修改**：`git diff --stat HEAD` 空。（**不是**「本轮零文件修改」——见下方四块式）
- ✅ 本轮仅编辑**本文件自身**（未跟踪）：新增 **E21**、回填 §4 U1–U4 实读结果、补 §5 E21 归属、本 §6.2。
- ✅ **未提交、未推送、未创建 PR**；`docs/gen1-monitor-status-clarify` 的 monstatus worktree 保持 `git status` 干净（未落 ⑤ 快照）。
- ✅ **只做只读线上核对**：`runtime_status` 实时实读（`updated_at = 2026-09-16T00:00:26.690Z`），**未做任何写权限探测**（不以写请求试权限）。
- ✅ 未触碰 `gen1_authority` / `ml_effective` / `FROZEN_PARAM_KEYS` / `lock_revision` / `immutable_set`；未碰 Gen-2、Dependabot、PR `#43`。
- ⚠️ **本轮实际写入范围（四块式，勿简写 —— 2026-09-16 用户第二次收紧口径）**：

  ```text
  ETF 仓库：
  - Git 跟踪文件：零修改（git diff --stat HEAD 空）
  - Git 历史/分支/远端：零修改（HEAD 仍 6793d7f；远端 ref 逐位未变）
  - 未跟踪本地草稿：GEN1_DOC_ERRATA_20260916.md 有修改，仅本地，不入库
  其他本机文件：
  - WorkBuddy 技能文档有修改（~/.workbuddy/skills/gen1-doc-errata-dedup/SKILL.md、
    github-pr-ops-windows/SKILL.md、~/.workbuddy/MEMORY.md）
  - 本地记忆文件有修改（.workbuddy/memory/2026-09-16.md）
  生产侧：
  - 代码 / 配置 / Authority / FROZEN_PARAM_KEYS / lock / immutable_set：零修改
  ```

  > ⛔ **不得简写为「仅修改本机技能文档与本地记忆」** —— 那会漏掉「仓库内未跟踪草稿确实被写过」这一事实。
  > ⛔ **不得简写为「本轮零文件修改」** —— 本工作目录确实发生过本地写入。
  > 两者都要如实保留：「仓库无正式变化」与「工作目录发生过本地写入」是两件事。
- 🔒 **旧 classic PAT 仍未轮换**（`gh_token.txt`：`ghp_` 前缀 / 40 字符 / mtime `2026-09-09`）；`gh.sh` 经查**未内嵌令牌**（从该文件读取），故轮换只涉及这一个文件。
- ✅ 为改该分支新建了**独立 worktree** `C:/Users/iquel/Documents/ChatGPT/Tradingview/etf-decision-engine-monstatus`（仓库外），本 worktree 分支未变（仍 `gen1-worktree-20260916` @ `6793d7f`）。

---

### 6.3 固定 SOP：写入后必须做「内容断言」

**工具返回 `success` ≠ 文件已落盘。** 本轮实测：同一批多条编辑中，有一条报 success 但**内容静默丢失**
（基于「`**纪律建议**` 前」锚点的插入未生效，靠断言脚本才发现并换锚点重发）。

⇒ 固定流程（治理文档尤其必须）：

1. 写入 → 2. 跑 Node 断言脚本**逐项匹配关键字符串** → 3. 有 `MISS` 就换**更唯一的锚点**重发 →
4. 断言全过才算完成。

**报告与取证一律以断言输出为证据，不以工具 success 回显为证据。** 本报告 §6.2 的四块式口径即依此流程核对落盘。

---

### 6.4 第四轮（2026-09-16）边界（E22 登记 + ⑧ P2 Release Gate）

- ✅ **ETF 仓库被跟踪文件零修改**：`git diff --stat HEAD` 空。（**不是**「本轮零文件修改」—— 见下方四块式）
- ✅ 本轮仅编辑**本文件自身**（未跟踪）：新增 **E22**、补 §5「批次 7」与归属行、本 §6.4。
- ✅ **未提交、未推送、未创建 PR**；`docs/gen1-monitor-status-clarify`（`a8bf76d`）保持 `git status` 干净，**未 amend**。
- ✅ **C1 已按裁定登记为 E22**，**不构成对 #43 的阻断**；⛔ **未修改 FROZEN 章程**、⛔ **未改 #43 任何字节**、⛔ 未改 `a8bf76d`。
- ✅ **N1 延后**：`scripts/build-cloudfunctions.js` 那句「使 GE-04 晋升路径真实可用」措辞过强，但**不在本轮修**，作为 **GE-04 prerequisite / 非阻塞** 保留；**不为一句注释重跑 #43 acceptance**。
- ✅ ⑧ 全部**只读**：冲突检查用 `git merge-tree`（无写入三路合并），候选树用 `git archive` 展开后 `git apply` 补丁；**未 `worktree add`**、**未写远端**、**未 checkout 任何分支**。
- ⚠️ **一次工具副作用（仅发生在临时树内，仓库未受影响）**：在候选树跑 `scripts/gen1-production-gates.js` 时，Gate `G1-J` 会把审计结果写回**该树内**的 `ml/manifests/GEN1_SECTOR_CONTRACT_AUDIT.json`。因候选树位于 `%TEMP%` 且**不含 `.git`**，仓库被跟踪文件**未被触碰**（与 §6 记的上一轮同类副作用不同：上轮发生在仓库内，本轮不会）。
- ⚠️ **本轮实际写入范围（四块式，勿简写）**：

  ```text
  ETF 仓库：
  - Git 跟踪文件：零修改（git diff --stat HEAD 空）
  - Git 历史/分支/远端：零修改（gen1 worktree 仍 6793d7f；monstatus 仍 a8bf76d；
      远端 master=2e8cb7d / #43=b7247f9 / clarify 分支=82debe8 逐位未变）
  - 未跟踪本地草稿：GEN1_DOC_ERRATA_20260916.md 有修改（新增 E22 + 批次 7 + 归属行 + 本 §6.4）；
      GEN1_PR43_READONLY_AUDIT_20260916.md 有修改（回填 C1/N1 裁定）
  其他本机文件：
  - WorkBuddy 技能文档有修改（gen1-doc-errata-dedup、gen1-pr-readonly-audit）
  - 本地记忆文件有修改（.workbuddy/memory/2026-09-16.md）
  - %TEMP% 展开树：g1-p2-gate-tree（候选树）、g1-ge02-audit-tree、g1-ge02-base-tree
      （均不含 .git，可随时删）
  生产侧：
  - 代码 / 配置 / Authority / FROZEN_PARAM_KEYS / lock / immutable_set：零修改
  ```

  > ⛔ **不得简写为「仅修改本机技能文档与本地记忆」**（漏掉仓库内未跟踪草稿被写过）；
  > ⛔ **不得简写为「本轮零文件修改」**（本工作目录确实发生过本地写入）。
- 🔗 **⑧ 的结论不写在本文件**：P2 Release Gate 另见同目录 `GEN1_P2_RELEASE_GATE_20260916.md`（未跟踪草稿）。

---

### 6.5 第五轮（2026-09-16）边界（⑧ 裁定回填：E23 登记 + owner release gate 定义）

- ✅ **ETF 仓库被跟踪文件零修改**：`git diff --stat HEAD` 空。（**不是**「本轮零文件修改」—— 见下方四块式）
- ✅ 本轮仅编辑**三份未跟踪草稿**：本文件（新增 **E23**、补 §5 批次 7 与归属行、本 §6.5）、
  `GEN1_PR43_READONLY_AUDIT_20260916.md`（§9 C2 裁定 + §10 回填）、
  `GEN1_P2_RELEASE_GATE_20260916.md`（§0 裁定后状态 + §8–§12）。
- ✅ **未提交、未推送、未创建 PR**；`docs/gen1-monitor-status-clarify`（`a8bf76d`）保持 `git status` 干净，**未 amend**。
- ⛔ **`MERGE AUTHORIZATION` 仍为 `NOT YET GRANTED`**：本 PR 含 `FROZEN_PARAM_KEYS 6 → 7`（新增 `gen1_authority`），
  与最初下达的硬边界正面相遇 ⇒ 须**一次性 owner override**。**不以「后续讨论似乎默认接受」反推边界失效。**
  放行语句须覆盖的 5 要点见 `GEN1_P2_RELEASE_GATE_20260916.md` §9。
- ✅ **已审计对冻结**：`master = 2e8cb7d` + `#43 head = b7247f9`。⛔ **不 rebase #43**、⛔ **不点 `Update branch`**、
  ⛔ **不 squash**。若 `master` 在放行前再次被外部推进 ⇒ **本 Gate 失效，须重跑 ⑧**。
- ✅ **E23 系「条件性过期」**：该行在 **#43 合入前仍然正确**；登记的是「合入后即过期」，**不是**「今天已错」。
- ⚠️ **本轮实际写入范围（四块式，勿简写）**：

  ```text
  ETF 仓库：
  - Git 跟踪文件：零修改（git diff --stat HEAD 空）
  - Git 历史/分支/远端：零修改（gen1 worktree 仍 6793d7f；monstatus 仍 a8bf76d；
      远端 master=2e8cb7d / #43=b7247f9 / clarify 分支=82debe8 逐位未变）
  - 未跟踪本地草稿：GEN1_DOC_ERRATA_20260916.md 有修改（新增 E23 + 批次 7 + 归属行 + 本 §6.5）；
      GEN1_PR43_READONLY_AUDIT_20260916.md 有修改（§9 C2 裁定 + §10 回填）；
      GEN1_P2_RELEASE_GATE_20260916.md 有修改（§0 裁定后状态 + §8–§12）
  其他本机文件：
  - WorkBuddy 技能文档有修改（gen1-pr-readonly-audit、gen1-doc-errata-dedup）
  - 本地记忆文件有修改（.workbuddy/memory/2026-09-16.md）
  - %TEMP% 展开树：g1-p2-gate-tree、g1-ge02-audit-tree、g1-ge02-base-tree（不含 .git，可删）
  生产侧：
  - 代码 / 配置 / Authority / FROZEN_PARAM_KEYS / lock / immutable_set：零修改
  ```

  > ⛔ **不得简写为「仅修改本机技能文档与本地记忆」**（漏掉仓库内未跟踪草稿被写过）；
  > ⛔ **不得简写为「本轮零文件修改」**（本工作目录确实发生过本地写入）。

---

### 6.6 第六轮（2026-09-16 合并后 Attestation）边界

- ✅ **ETF 仓库被跟踪文件零修改**：`git diff --stat HEAD` 空。（**不是**「本轮零文件修改」—— 见下方四块式）
- ⚠️ **远端 `master` 已推进为 `c9af16b1`** —— 该变更由**项目所有人**于 `2026-09-16T16:06:26+08:00` 以
  `Create a merge commit` 执行；**本轮未 push、未建 PR、未改任何 ref**，对 `master` 的观测**全部只读**
  （`git fetch` + `ls-remote` + `merge-tree` + `archive` 导出）。
- ✅ **E23 结案性质变更**：由「**条件性过期**」→「**现实过期**」（条件已触发）。⚠️ ⛔ **仍不得修改 2026-09-10 历史快照正文**。
- ✅ **新增 E24 / E25**：均为**条款 / 方法学措辞**类勘误，⛔ 不改变任何治理判定、门禁结论或已冻结内容。
- ⚠️ **D1 已登记但未裁定**：`Update branch` 使已审计 head 前进（§9.2 ④ 字面被突破），内容等价可证。
  **归档口径待所有人裁定**（建议按「等价替换」归档）。见 `GEN1_P2_POST_MERGE_ATTESTATION_20260916.md` §2.4 / §6 R1。
- ⛔ **本轮不得做**：不改 `GEN1_CURRENT_STATE_20260910.md` 正文、不改 FROZEN 章程、不改 `a8bf76d`、
  不改 #43 任何字节、不提交/不推送任何草稿、不部署、不写线上。
- ✅ **GE-03 仅为设计草案**：`GEN1_GE03_DESIGN_GATE_DRAFT_20260916.md` **不构成实施授权**，也未落任何 GE-03 代码。
- ⚠️ **本轮实际写入范围（四块式，勿简写）**：

  ```text
  ETF 仓库：
  - Git 跟踪文件：零修改（git diff --stat HEAD 空）
  - Git 历史/分支/远端：远端 master 已由所有人于 16:06:26 推进为 c9af16b1（**非本轮**产生，本轮仅只读观测）；
      gen1 worktree 仍 6793d7f；monstatus 仍 a8bf76d clean；本轮未 push / 未建 PR / 未改 ref
  - 未跟踪本地草稿：GEN1_DOC_ERRATA_20260916.md 有修改（E23 结案 + 新增 E24/E25 + 批次 7 + 本 §6.6）；
      GEN1_P2_RELEASE_GATE_20260916.md 有修改（§0.c + §11.1 + §16/§17）；
      GEN1_P2_POST_MERGE_ATTESTATION_20260916.md 新增；
      GEN1_GE03_DESIGN_GATE_DRAFT_20260916.md 新增（设计草案，未获批）
  - 本机只读 API 调用：GitHub 2 次 GET（PR #43 get / check_runs）+ CloudBase 1 次只读集合查询
  其他本机文件：
  - WorkBuddy 技能文档有修改（gen1-pr-readonly-audit、gen1-doc-errata-dedup）
  - 本地记忆文件有修改（.workbuddy/memory/2026-09-16.md）
  - %TEMP% 展开树：g1-p2-postmerge-tree、g1-ge02-base-tree（不含 .git，可删）
  生产侧：
  - 代码 / 配置 / Authority / FROZEN_PARAM_KEYS / lock / immutable_set：零修改
  - 线上 `runtime_status`：零写入（只读 1 次，`updated_at = 2026-09-16T00:00:26.690Z`）
  ```

  > ⛔ **不得简写为「仅修改本机技能文档与本地记忆」**（漏掉仓库内未跟踪草稿被写过）；
  > ⛔ **不得简写为「本轮零文件修改」**（本工作目录确实发生过本地写入）。

---

### 6.7 第七轮（2026-09-16 P2 收口与 GE-03 设计裁定）边界

- ✅ **ETF 仓库被跟踪文件零修改**：`git diff --stat HEAD` 空。（**不是**「本轮零文件修改」—— 见下方四块式）
- ⚠️ **远端 `master` 再次前进**：`c9af16b1` → **`44b59b8`**（PR #45 `chore/gen2-screen-o2-hardening`，`2026-09-16T16:32:50+08:00`，双亲 = `c9af16b1` + `86f9a086`）。
  实测变更面**恰好 2 个文件**（`ml/gen2/tests/test_screen_o2_hardening.py` 新增、`scripts/ml/screen-o2-candidates.py` 修改；`+1572 −138`），
  **零 Gen-1 文件**（`src/`、`cloudfunctions/`、`web/`、`tests/`、`docs/gen1/`、`scripts/*.js` 的 blob 差异 = **NONE**）；
  在新树上重跑 `verify-immutable` **23/23**、`gen1-production-gates` **25/25**、CANARY 平价 **38/38**、关键单测 5 项全 PASS。
  ⛔ 该变更**不是本轮**产生；本轮对 `master` 的观测**全部只读**（`fetch` + `ls-tree` + `archive` 导出 + 门禁复跑）。
- ✅ **D1 已裁定并结案**：`PROCESS DEVIATION / CONTENT-PRESERVING / RE-ATTESTED / NON-SAFETY / CLOSED`；
  不重开 ⑧、不回滚 #43、不改变 `P2_COMPLETE_DORMANT`。
- ✅ **E22–E25 全部保留**；E23 同意由「条件性过期」转为「现实过期」；E25 增补**前向规则**（见 §2 中 E25 表后的处置升级块）。
- ✅ **本文件的入库载体已获 owner 放行**：授权一个 **P2 Closure docs-only PR**（4 份文档，**不含** GE-03 设计文档）；
  ⛔ 该放行**只覆盖建 PR**，**不授权 merge**。
- ⚠️ **§6.1 的「不 commit、不入库、不建 PR」是第二轮当时的边界**，已被本轮 owner 放行取代 ——
  ⛔ 不改写 §6.1 正文（属历史记录），仅在此处给出取代指向。
- ⛔ **本轮不得做**：不改 `GEN1_CURRENT_STATE_20260910.md` 正文、不改 FROZEN 章程、不改 `a8bf76d`、
  不改 #43 任何字节、不部署、不写线上、不进入 GE-03 代码阶段。
- ⚠️ **本轮实际写入范围（四块式，勿简写）**：

  ```text
  ETF 仓库：
  - Git 跟踪文件：零修改（git diff --stat HEAD 空）
  - Git 历史/分支/远端：远端 master 已由**外部推进**为 44b59b8（PR #45，纯 Gen-2；**非本轮**产生，
      本轮仅只读观测）；本轮另新建 P2 Closure 分支并提交 4 份文档
      ⇒ 该分支的 push / PR 属**本轮**产生的远端变化，情况见 P2 Gate §18
  - 未跟踪本地草稿：GEN1_DOC_ERRATA_20260916.md 有修改（E23 裁定 + E24/E25 裁定 + E25 前向规则 +
      批次 7 + 归属表 + 本 §6.7）；
      GEN1_P2_RELEASE_GATE_20260916.md 有修改（§0.d + §9.4 + §10 + §11 A1 判据 + §18）；
      GEN1_P2_POST_MERGE_ATTESTATION_20260916.md 有修改（D1 结案 + §7 master 漂移复核）；
      GEN1_PR43_READONLY_AUDIT_20260916.md 有修改（§12 D1 结案回填）；
      GEN1_GE03_DESIGN_GATE_DRAFT_20260916.md → 收为最终版并改名（见 §6.7 末注）
  其他本机文件：
  - WorkBuddy 技能文档有修改（gen1-pr-readonly-audit、github-pr-ops-windows、gen1-doc-errata-dedup）
  - 本地记忆文件有修改（.workbuddy/memory/2026-09-16.md、项目级 MEMORY.md）
  - %TEMP% 展开树：g1-master44-tree（44b59b8 树，不含 .git，可删）
  生产侧：
  - 代码 / 配置 / Authority / FROZEN_PARAM_KEYS / lock / immutable_set：零修改
  - 线上 `runtime_status`：零写入
  ```

  > ⛔ **不得简写为「仅修改本机技能文档与本地记忆」**（漏掉仓库内未跟踪草稿被写过）；
  > ⛔ **不得简写为「本轮零文件修改」**（本工作目录确实发生过本地写入）。

> 📌 **GE-03 文档说明**：`GEN1_GE03_DESIGN_GATE_DRAFT_20260916.md` 已按 Q1–Q6 裁定收为**最终版**并改名；
> ⛔ 该文档**不进** P2 Closure docs-only PR（P2 是已完成的历史闭环，GE-03 是下一阶段的未来授权，两者分开）。

---

### 6.8 第八轮（2026-09-16 P2 Closure PR 与 GE-03 设计终版）边界

- ✅ **ETF 仓库被跟踪文件零修改**：`git diff --stat HEAD` 空。（**不是**「本轮零文件修改」—— 见下方四块式）
- ⚠️ **本轮首次产生远端变化（均已获 owner 放行）**：
  ① 新建**仓库外**独立 worktree `etf-decision-engine-p2closure`（分支 `docs/gen1-p2-closure`，基于 `44b59b8`）；
  ② `git push` **成功**（**SSH 通道**）；③ 经项目 fine-grained PAT `POST /pulls` 建成 **PR #46**（`201`）。
  ⛔ **merge 未获授权** —— 本轮**未合并任何东西**。
- ⚠️ **新增 E26**：写入能力结论须按「**通道 × 动作**」限定（见 §2 E26）。本项由**已授权动作的合法副产物**暴露，⛔ 不是写探测。
- ✅ **§9.4 ③ 的排除项已落实**：PR #46 只含 **4 份**文档，⛔ **不含** GE-03 设计文档。
- ✅ **GE-03 设计文档已收为最终版**：`GEN1_GE03_DESIGN_GATE_20260916.md`（`GEN1-GE03-DG-1.0`，前身 DRAFT 已删除）；
  `GE03_DESIGN_GATE FINAL = PENDING FINAL DOC REVIEW`、`IMPLEMENTATION_AUTHORIZATION = NOT GRANTED`。
- ⛔ **本轮不得做**：不改 `GEN1_CURRENT_STATE_20260910.md` 正文、不改 FROZEN 章程、不改 `a8bf76d`、
  不改 #43 任何字节、**不 merge PR #46**、不部署、不写线上、不进入 GE-03 代码阶段。
- ⚠️ **本轮实际写入范围（四块式，勿简写）**：

  ```text
  ETF 仓库：
  - Git 跟踪文件：零修改（git diff --stat HEAD 空）
  - Git 历史/分支/远端：**本轮产生远端变化（已获 owner 放行）**：
      ① 新分支 docs/gen1-p2-closure（基于 44b59b8）已 push（SSH 通道）；
        ⚠️ 该分支的 head SHA 不入档 —— 随追加提交前进，属自指状态；以远端实读为准
        （对应「Base + PR 编号」才是稳定标识）；
      ② 建成 **PR #46**（open；merged = false；4 文件 +1979）
      （另：远端 master 此前被**外部**推进为 44b59b8，**非本轮**产生）
  - 未跟踪本地草稿：GEN1_DOC_ERRATA_20260916.md 有修改（新增 E26 + 批次 7 + 归属表 + 本 §6.8）；
      GEN1_P2_RELEASE_GATE_20260916.md 有修改（§9.1 ⑤ + §9.3 + §19）；
      GEN1_PR43_READONLY_AUDIT_20260916.md 有修改（§12 追加通道结论行）；
      GEN1_GE03_DESIGN_GATE_20260916.md 新增（最终版）；旧 DRAFT 文件已删除
  - 本机 GitHub API：GET 若干 + **1 次已授权的写**（`POST /pulls` ⇒ `201`）
  其他本机文件：
  - WorkBuddy 技能文档有修改（gen1-pr-readonly-audit、github-pr-ops-windows、gen1-doc-errata-dedup）
  - 本地记忆文件有修改（.workbuddy/memory/2026-09-16.md、项目级 MEMORY.md）
  - %TEMP% 展开树：g1-master44-tree（44b59b8 树 524 blob，不含 .git，可删）
  生产侧：
  - 代码 / 配置 / Authority / FROZEN_PARAM_KEYS / lock / immutable_set：零修改
  - 线上 `runtime_status`：零写入
  ```

  > ⛔ **不得简写为「仅修改本机技能文档与本地记忆」**（漏掉仓库内未跟踪草稿被写过、且本轮**确实产生了远端分支与 PR**）；
  > ⛔ **不得简写为「本轮零文件修改」**（本工作目录确实发生过本地写入）。

---

### 6.9 第十轮（2026-09-16 P2 Closure PR 内的 docs 修正：E27 新增 + E26 改写）边界

- ✅ **ETF 仓库被跟踪文件零修改**：`git diff --stat HEAD` 空。（**不是**「本轮零文件修改」—— 见下方四块式）
- ⚠️ **本轮产生远端变化（已获 owner 放行）**：载体分支 `docs/gen1-p2-closure` **追加一个 docs-only 提交** ⇒ **head 前进**。
  按勘误 **E25** 的**前向规则**，原冻结对象**即刻失效** ⇒ 须**重新冻结新 head、并对新 head 重新验收**（重跑内容断言 + 等 required CI 全绿）之后才可以 merge；
  ⛔ **不得**以「内容看起来只是文档」为由沿用旧冻结。
- ⚠️ **本次 head 前进属 E25 第 2 层（前向规则）的适用场景**，⛔ **不是**第 1 层的「等价替换」回溯判定 ——
  「事后可证」≠「事前免检」（见 §2 E25 的两层判据块）。
- ✅ **owner 授权范围逐条落实**：

  ```text
  PR #46 EDIT AUTHORIZATION     GRANTED      （仅 docs 修正 —— 本提交即在此范围内）
  PR #46 MERGE AUTHORIZATION    NOT GRANTED
  GE-03 IMPLEMENTATION          NOT GRANTED
  ```

  - **允许并已执行**：新增 **E27**；把 **E26** 改写为「通道 × 凭据权限 × 时点」条件式；修正门禁文档 §9.1 / §19 中把**补权前 `403`** 当成当前能力的表述；写入 PR #45 的后续正证据（**已标明属后续权限状态**）。
  - ⛔ **未做**：不改 D1、E22–E25 的既定结论；⛔ 不加入 GE-03 设计文档；⛔ 不改任何运行时代码。
- ✅ **E27 定位（owner 裁定，逐字照录）**：

  ```text
  severity      = P1+
  type          = STALE CAPABILITY CONCLUSION
  runtime risk  = NONE
  scope         = docs / governance evidence
  status        = FIX IN PR #46 BEFORE MERGE
  ```

- ✅ **E27 的修正对象**是「**旧 `403` 被错误地提升为后续时点的当前能力结论**」，
  ⛔ **不是**「以前发生过 `403`」这个历史事实 ⇒ **不删历史 `403`**，只**加时间边界 + 补后续正证据**。
- ⛔ **本轮不得做**：不 merge PR #46；不改 `GEN1_CURRENT_STATE_20260910.md` 正文、不改 FROZEN 章程、不改 `a8bf76d`、
  不改 #43 任何字节；不部署、不写线上、不进入 GE-03 代码阶段。
- ⚠️ **本轮实际写入范围（四块式，勿简写）**：

  ```text
  ETF 仓库：
  - Git 跟踪文件：零修改（git diff --stat HEAD 空）
  - Git 历史/分支/远端：**本轮产生远端变化（已获 owner 放行）**：
      载体分支 docs/gen1-p2-closure 追加**一个 docs-only 提交** ⇒ head 前进（依 E25 前向规则须重新冻结 + 重新验收）；
      ⛔ head SHA / 提交数 / 行数一律**不入档**（自指状态，以远端实读为准）；
      稳定标识 = base SHA + PR 编号（见门禁文档 §19）
      ⛔ 未 merge（MERGE AUTHORIZATION 仍未授予）
  - 未跟踪本地草稿：本轮**未新增、未修改**任何未跟踪草稿
      （gen1 草稿台仍保留前几轮留下的 5 份未跟踪副本：Errata / GE03 / Gate / Attestation / PR43，本轮状态未变）
  - 本机 GitHub API 调用：只读 GET 若干（PR #46 现状核对）
  其他本机文件：
  - WorkBuddy 技能文档有修改（github-pr-ops-windows）
  - 本地记忆文件有修改（.workbuddy/memory/2026-09-16.md、项目级 MEMORY.md）
  生产侧：
  - 代码 / 配置 / Authority / FROZEN_PARAM_KEYS / lock / immutable_set：零修改
  - 线上 `runtime_status`：零写入
  ```

  > ⛔ **不得简写为「仅修改本机技能文档与本地记忆」**（漏掉本轮**确实产生了远端 docs 提交**）；
  > ⛔ **不得简写为「本轮零文件修改」**（本工作目录确实发生过本地写入）。
- 🔗 **同批落点（另两份文档）**：门禁文档 §0（执行通道结论）、**§9.1**（含新增 **⑥** 更正）、**§9.3**、**§19**（改写为「通道 × 凭据权限 × 时点」）、新增 **§20**；
  PR #43 审计文档 §11 的同一过期结论同步**加时间边界**。

---

*本报告为只读取证产物（除编辑本文件自身外，未对被跟踪文件、代码、配置、Authority、锁或线上数据产生任何写入），本身不构成任何权限或部署授权。逐条批准后再按第 5 节分批落地。*
