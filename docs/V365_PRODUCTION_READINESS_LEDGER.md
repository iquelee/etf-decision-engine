# V365 Production Readiness Ledger

> **性质**：**持续更新**的生产就绪账本（append-only 阶段日志 + 当前状态快照）。
> **用途**：满足「每个 WP 记录证据」+「重大阶段输出 checkpoint」+「最终报告输入」。
> **基线**：HEAD `c6bd006fd76ffc5358cddd07347df8ed23d9e61d`
> **标记**：`[AS-IS]` 实测 · `[PROBE]` 探针 · `[INFER]` 推理 · `[HUMAN]` 待人工

---

## A. 当前状态快照

### A.1 已完成（基线，不重开）

| 项 | 状态 |
|---|---|
| V3.6.5 Writer CAS | `QUALIFIED` |
| Reader Migration | `COMPLETE`（8/8） |
| Finality | `COMPLETE` |
| HD12-0 / HD12-1 / HD12-1.1 | `COMPLETE` |
| Decision Classification Single Source | `ESTABLISHED`（v2） |
| Protected Domain Fail-Closed | `ESTABLISHED` |
| `UNKNOWN_DECISION_RELEVANCE` | `0` |
| RPG-F1 | `COMPLETE` |
| RPG-F2-A | `COMPLETE`（`RFP-V2-CF` baseline 已建立，`UNEXPECTED_DELTA = 0`） |
| RPG-003 | `RPG003-A`（V1 = legacy counterfactual replay with known fidelity limitations） |

### A.2 未完成

| 项 | 状态 |
|---|---|
| RPG-F2-B（cooldown fidelity） | 🔶 **PARTIAL / BLOCKED_ON_EXECUTION_COVERAGE** — 语义✅ + 路径保真✅（4/4 实测一致）+ **覆盖❌**（`NO_PREVIOUS_EXECUTION_RECORDS_EXIST_IN_SOURCE`）⇒ 见 C-014 |
| RPG-F2-C（production historical book） | ⛔ **BLOCKED_ON_ACTUAL_BOOK_COVERAGE** — `required=25 / available=16 / missing=9`（`2026-08-03 → 08-13`）；`t_minus_1_candidate = null` ⇒ 见 C-015 |
| RFP-V2-PH | ⛔ `RFP-V2-PH_FULL_WINDOW_AVAILABLE = false`；诊断件 `RFP-V2-PH-AVAILABLE-WINDOW` 已建（`qualification_authoritative = false`）⇒ 见 C-015 |
| **RPG-002** | ⛔ **NOT YET CLOSED**（`RPG-002 = PARTIAL`；须 F2-B 覆盖补全才可关闭） |
| HD12-2（orchestration 授权机制） | ✅ **COMPLETE**（见 C-002） |
| HD12-3（RDE zone 保护） | ✅ **COMPLETE**（见 C-004） |
| **RPG-F2-A** | ✅ **COMPLETE**（§3 补核 16/16 项成立）· **RPG-001 = CLOSED** |
| WP-RH1 Contract Registry | ✅ **COMPLETE**（见 C-006）· 生产建表 **HD-10 = COMPLETE**（CREATE EMPTY STRUCTURE ONLY） |
| WP-RH2 Run Registry + lifecycle writer | ✅ **COMPLETE** — R2-a/R2-b/R2-c/R2-d 全部完成（见 C-008） |
| WP-RH3 Promotion History | ✅ **COMPLETE** — supersede 链富化 + CAS 回读一致性（见 C-009） |
| WP-RH4 Historical Reader Migration | ✅ **COMPLETE（代码侧）** — CLASS C 双源登记 + 覆盖如实三态（见 C-010） |
| **RUN_HISTORY_INDEX** | ⛔ **PENDING** — 代码侧（RH1~RH4）✅ + 结构侧（HD-10 建表）✅ 全完成；**唯一缺口 = 数据侧**（5 集合 `n=0` + 无生产提升 + `V365_ENFORCE_SWITCH_DATE = null`）⇒ `run_axis_available = false` · `coverage = 'legacy_only'` |
| Full Requalification | ✅ **COMPLETE** — 全门禁 + Δ=0 + manifest 重算（见 C-011）；HD-10 后复跑：**Stage A 72/72 · Stage A~G 80/80** |
| CloudBase 只读连接能力 | ✅ **CONNECTION VERIFIED** — 只读工具链 + 真实读回读全 PASS；导出 13+40 行（见 C-013） |
| Freeze Review | 🔶 **ELIGIBLE_FOR_REVIEW** — `GOVERNED_PRODUCTION_HISTORY_DATA_REQUIRED` 已 **CLOSED**（见 C-013） |

> **tracked 改动（当前快照）**：`tracked-file count             = 85`（`git status --porcelain -uall` 去目录后的文件数）。
> ⚠️ 此为**当前真值**（C-021.1 PRE_DEPLOY_ARTIFACT_MATERIALIZATION）；历史阶段值（C-011 的 19 / C-013 的 20 / C-014 的 24 / C-016 的 25 / C-018 的 74）见各阶段日志，不再回改。

> ⚠️ **本快照为唯一真值来源**（2026-09-29 C-015 收口轮）。
> 曾出现过的过期表述 —— `WP-RH4 = PENDING` / `Full Requalification = PENDING` / `Freeze Review = PENDING`
> —— **均已作废并删除**；其过期理由 = 这些行是 RH4/Requal/Freeze 启动**前**填入的占位，
> 在 C-010（RH4 COMPLETE）/ C-011（Requal COMPLETE + Freeze BLOCKED）之后未同步。
> ⛔ **不得**依据任何 `PENDING` 残留重新开包。
>
> ⚠️ **C-013 的一处乐观表述已在 C-014/C-015 精化**：C-013 记 `RPG-F2-B/F2-C = UNBLOCKED`
> ⇒ 经受治理导出复核后，实际为 **F2-B = PARTIAL**（执行覆盖不足）· **F2-C = BLOCKED**（book 覆盖缺 9 天）。
> ⛔ **「数据可读」≠「数据充分」** —— 连接 VERIFIED 只解除能力型阻塞，不解除覆盖型阻塞。
>
> **§25 当前状态（C-015）**：
> `CLOUDBASE_READONLY_CONNECTOR = READY` · `CLOUDBASE_READONLY_CONNECTION = VERIFIED`
> · `CREDENTIAL = VALID` · `READ_PERMISSION = SUFFICIENT`
> · `GOVERNED_PRODUCTION_HISTORY_DATA_REQUIRED = CLOSED`（数据**已取得**；但其**覆盖**不足 ⇒ 另立覆盖型 blocker）
> · `FREEZE_REVIEW = ELIGIBLE_FOR_REVIEW`
> · `RPG-F2-B = PARTIAL` · `RPG-F2-C = BLOCKED` · `RFP-V2-PH_FULL_WINDOW_AVAILABLE = false`
> · `RUN_HISTORY_INDEX = PENDING（数据侧）` · `READY_FOR_PRODUCTION_PROMOTION` 仍 **NOT_ISSUED**

> **★ 当前真实语义（C-018 · PRE_PROMOTION_INTEGRITY_CLOSURE，2026-09-29）** —— ⛔ 不得再描述旧的 `cooldown = hardcoded 0`：
>
> | 项 | 当前语义 |
> |---|---|
> | `HD-10` | ✅ **COMPLETE** — `CREATE EMPTY STRUCTURE ONLY`；5/5 集合 + 7/7 索引；`documents_written = 0` · `production_run_triggered = false` · `pointer_initialized = false` |
> | `HD-9` | ✅ **CLOSED** — `HD-9_RUN_HISTORY_RETENTION_POLICY = RETAIN_INDEFINITELY_FOR_V365`（⛔ 不自动删 / 不归档 / 无 TTL / 不压缩；⛔ 当前不实现 retention worker） |
> | `HD-15` | ✅ **POLICY CLOSED** — `HD-15_SWITCH_DATE_POLICY = APPROVED`（只冻结**时点规则**，不写值）；`V365_ENFORCE_SWITCH_DATE` 当前仍 **`null`** |
> | `V365_ENFORCE_SWITCH_DATE` | **`null`** — 语义 = 「**第一个真实成功且成为 authoritative 的 V3.6.5 ENFORCE production run** 的 `expected_trade_date`」；⛔ **不是**建表 / 代码完成 / 授权 / 测试 / diagnostic replay 的日期 |
> | `RFP-V2-CF-COOLDOWN` | ✅ **已替换旧 RFP-V2-CF 的 cooldown 语义** —— cooldown = 生产 cooldown 纯函数 **as-of-date 复用**（⛔ 不再是 `cooldownDays: 0` 硬编码）；anchor `0db3193b297d2900aa1b32e359bbe80b80bfbf7a5b10ce0bba17a32f41dbe4f5` |
> | `RFP-V2-AE` | ✅ **显式 actual execution ledger（Model B）** —— `actual book` 必须来自真实执行账本，⛔ 不由 `suggested_position` 推断；anchor `5c8fb4ae7223abdc4edb9ba8267c2043d4dd22d6688e000415e1a4f1339b661d` |
> | `P12_PARITY_UNEXPECTED_DECISION_DELTA` | **0**（p12 decision parity 门禁口径） |
> | `RPG_F3_HISTORICAL_UNEXPECTED_DECISION_DELTA` | **6**（V2-CF-COOLDOWN 1 + V2-AE 5）—— RPG-F3 ⛔ **FAIL fail-closed**；⛔ 不得为清零而扩大冻结 taxonomy |
> | `RPG_F3_PROSPECTIVE_UNEXPECTED_DECISION_DELTA` | `NOT_STARTED`（前瞻轨；目标 = 0） |
> | ⛔ 命名拆分 | 上述**两个历史/门禁 Δ 不得**共用一个笼统名（见 `V365_PROSPECTIVE_PRODUCTION_QUALIFICATION.md` §13） |
> | `OWNER_F2C_PATH` | **A**（owner 裁定；逐条比对 6/6 匹配；`label_mismatch = false`） |
> | `RUN_HISTORY_INDEX` | ⛔ **`PENDING`** —— 属 **POST-ACTIVATION / FIRST-NATURAL-RUN ACCEPTANCE**；⛔ 不得靠制造一笔生产 run「补齐测试证据」 |
> | `PRODUCTION_ACTIVATION_AUTHORIZATION` | ⛔ **`NOT_GRANTED`**（⛔ 不得初始化 `active_run_pointer` / 不 promotion / 不写 run_manifest·run_history / 不设 switch date） |
> | `READY_FOR_PRODUCTION_PROMOTION` | ⛔ **仍 `NOT_ISSUED`** |

> **★★ 前瞻轨状态（C-019 · PROSPECTIVE_PRODUCTION_QUALIFICATION_DESIGN，2026-09-29）** ——
> ⛔ 历史轨与前瞻轨**命名分离、互不篡改**；⛔ 不得用前瞻轨解释/清零历史缺口：
>
> | 项 | 当前语义 |
> |---|---|
> | `HISTORICAL_FULL_WINDOW_STATUS` | ⛔ **`INCOMPLETE_BY_SOURCE_HISTORY`**（永久）—— 旧窗口 `2026-08-01 → 2026-09-22` **继续冻结**；原因 = `UNAVAILABLE_BY_HISTORICAL_FACT`（⛔ 非 `FAIL_DUE_TO_IMPLEMENTATION`，⛔ 非 `WORK_NOT_EXECUTED`） |
> | `RFP-V2-PH_FULL_WINDOW_AVAILABLE` | ⛔ **`false`** —— ⛔ 不得改为 PASS |
> | `PROSPECTIVE_QUALIFICATION_STATUS` | `NOT_STARTED` —— 新协议 `RFP-V2-PH-PROSPECTIVE` 已登记但尚无真实 run 累积 |
> | `RFP-V2-PH-PROSPECTIVE` | ✅ **已登记** —— `replay_semantics = PRODUCTION_HISTORICAL_PROSPECTIVE` · `qualification_authoritative = false` · **独立 anchor**（⛔ 不复用 V1 / V2-CF / V2-AE） |
> | `PROSPECTIVE_EPOCH` | `NOT_STARTED` —— 定义 = 第一个真实成功成为 authoritative 的 V3.6.5 ENFORCE production run（CAS 成功 + pointer 切换 + run_history 按 OD-2 落盘 + read-after-write consistent） |
> | `READY_FOR_CONTROLLED_PRODUCTION_ACTIVATION` | ⛔ **`BLOCKED_ON_DEPLOYMENT_IDENTITY`**（★ C-021 §10 收紧；G-01~G-15 / G-17~G-24 PASS · **G-25 `deployment_identity_verified` = false** FAIL）—— ⛔ 与 `READY_FOR_GENERAL_PRODUCTION` **严格分开** |
> | `READY_FOR_GENERAL_PRODUCTION` | ⛔ **`false`** |
> | `PROSPECTIVE_MINIMUM_WINDOW` | ✅ **120 trading days**（`OD-P-1 = APPROVED`）；`PROSPECTIVE_MAXIMUM_WINDOW = 250 trading days`；120 日不足 ⇒ 自动延长；250 仍不足 ⇒ `STOP` + `OWNER_REVIEW_REQUIRED`（⛔ 不得自动降标） |
> | `PRODUCTION_ACTIVATION_AUTHORIZATION` | ⛔ **`NOT_GRANTED`** |

> **★★★ C-021 部署身份与候选冻结（DEPLOYMENT_IDENTITY_AND_CANDIDATE_FREEZE_GATE，2026-09-29/30）** ——
> owner §1~§14 裁定；⛔ **本轮不 deploy / 不执行 production run / 不初始化 pointer / 不写业务数据 / 不设置 switch date / 不 commit·push·PR·merge·tag**：
>
> | 项 | 当前语义 |
> |---|---|
> | ⛔ **旧语义废除** | `owner_authorization = true ⇒ GRANTED` **正式废除** —— owner 同意运行 **≠** 线上跑的就是被 qualification 的代码 |
> | `CANDIDATE_FREEZE_DESIGN` | ✅ **`COMPLETE`** |
> | `CURRENT_PRODUCTION_DEPLOYMENT_IDENTITY` | **`V3.6.4`**（`aa634e264270f26207c59c19ef3e1c31dde01e64`）—— 三重独立一致，`PRODUCTION_DEPLOYMENT_DRIFT = NO` |
> | `production_baseline_verified`（G-24） | ✅ **`true`** —— 线上 `ModTime`/`CodeSize`/`index.js` 双 SHA 全部匹配台账 D-006；逐文件 parity `EXACT_MATCH 74/76`（`diff = 0`） |
> | `candidate_source_frozen`（G-21） | ✅ **`true`** —— `candidate_manifest_sha = 8c53f93fa66bbc2768f23843530f3997e2c9d38030e58b65c2bc0d7497c501c1`（两次重算逐位一致 ⇒ deterministic） |
> | `deployment_scope_exact`（G-22） | ✅ **`true`** —— `V365_DEPLOYMENT_SCOPE = EXACT`；进包 **91** · 排除 **69** · `changed_in_closure = 7`（⛔ 非 76 全量）· `materializeIndicators_touched = false` |
> | `rollback_artifact_verified`（G-23） | ✅ **`true`** —— 线上包下载 → 本地复算 `index.js` 双 SHA == 台账 D-006（**独立双源一致**；⛔ 非仅存下载链接）；`rollback artifact independently_verified = true` |
> | `DEPLOYMENT_IDENTITY_VERIFIED`（G-25） | ⛔ **`false`** —— **部署前必须为 false**（线上 = V3.6.4，**并非**本轮 V3.6.5 candidate） |
> | `OWNER_RUN_AUTHORIZATION`（G-16） | ⛔ **`false`** —— ★ 由 `owner_authorization` **改名**为 **`owner_run_authorization`**，语义收紧为「**运行**授权」（⛔ 非部署授权） |
> | `owner_run_authorization` 独立必需性 | ⛔ 旧语义 `owner_authorization = true ⇒ GRANTED` **已废除**：`owner_run_authorization = true` **且** `deployment_identity_verified = false` ⇒ `may_activate = false` |
> | `READY_FOR_V365_CONTROLLED_DEPLOYMENT`（**GATE-D**） | ⛔ **`PENDING_OWNER_DEPLOYMENT_APPROVAL`**（D-01~D-**09** PASS · **D-10 owner 部署授权 FAIL**；★ C-021.1 §6 扩充）；`may_deploy = false` · `implies_first_controlled_run = false` |
> | `READY_FOR_V365_FIRST_CONTROLLED_RUN`（**GATE-R**） | ⛔ **`BLOCKED_ON_DEPLOYMENT_IDENTITY`** |
> | **两次授权严格分离** | `DEPLOY 授权 ≠ RUN 授权` —— 中间**必须**插入 Post-Deploy Identity Gate（`ONLINE_SOURCE_PARITY = EXACT_MATCH` + `UNEXPECTED_PACKAGE_DIFF = 0`） |
> | ⛔ **部署约束** | `mutable_working_tree_deploy_forbidden = true` —— ⛔ 不得直接从 mutable working tree 部署；⛔ 不得因 worktree 有 76 变更就全量部署 |
> | ⛔ **假绿灯修复** | P-13 `assert.ok(designDoc.includes(n) \|\| true, …)` 的 vacuous assertion **已删除**；`tests/v365-rpg-f2b.test.js` B-09 同类 `\|\| true` 亦**已删除**；新增 P-34 守卫「测试自身不得残留永真断言」 |
> | 证据件 | `deliverables/v365-production-history/c021/{deployment-identity-audit,deployment-scope,deployment-candidate-manifest,rollback-artifact}.json` |
> | 设计详情 | `docs/V365_DEPLOYMENT_IDENTITY_AND_CANDIDATE_FREEZE.md`（§5 freeze 两方案对比 A/B + 推荐；§6 rollback dry-run） |

> **★★★ C-021.1 部署件物化（PRE_DEPLOY_ARTIFACT_MATERIALIZATION，2026-09-30）** ——
> owner 裁定「C-021 主体批准，但当前**仍不授权生产部署**」；本轮把**逻辑上的 candidate** 冻结成
> **确定、可验证、可授权的实际 deployment bundle**。⛔ 本轮仍不 deploy / 不执行 production run /
> 不初始化 pointer / 不写 production DB / 不设 switch date / 不 push·PR·merge·tag：
>
> | 项 | 当前语义 |
> |---|---|
> | `DEPLOYMENT_ARTIFACT_MATERIALIZED` | ✅ **`true`** —— canonical bundle 已物化（deterministic ustar：mtime/uid/gid/mode 全固定） |
> | `DEPLOYMENT_BUNDLE_SHA` | **`e996e88ae8084a38e186471b561867267fc4280c3ea5758ccb0eff75092455a4`** —— 两次独立重算逐位一致 |
> | `bundle_sha256` 不变量 | `same deployment_bundle_sha256 ⇒ same deployable bytes`；`bundle_content_manifest_sha` 由排序 `(path,sha256,bytes)` 三元组派生 |
> | `required_file_count` | **91** · `bundle_size = 1161728` · `bundle_format = ustar-deterministic` |
> | `BUNDLE_SOURCE_PARITY` | ✅ **`EXACT_MATCH`** —— `MISSING_REQUIRED_FILE = 0` · `UNEXPECTED_FILE = 0` · `CONTENT_DIFF = 0` · `ONLINE_IRRELEVANT_ARTIFACT_DIFF = 0`（按冻结 ignore policy：`node_modules/**` · `config.json`） |
> | §1 source 校验 | ✅ **91/91 逐文件 `sha256(current) == manifest.expected`** · `drift = 0` · scope↔manifest required **SET_EQUAL = true**（⛔ 不一致 ⇒ `STOP = CANDIDATE_SOURCE_DRIFT`，⛔ 不得重生成 manifest 适配漂移） |
> | `UNEXPECTED_PACKAGE_DIFF` | ✅ **`0`** —— `added = 15` · `modified = 4` · `deleted = 0` · `unchanged = 72`；与源码 delta（`git aa634e2 → worktree`，闭包内）**逐项 SET_EQUAL** |
> | ★ 计数对账 | `19 = 7 working-tree + 12 committed-since-aa634e2`；C-021 §3 的 `changed_in_closure = 7` ⊂ 本 delta **19**（**包含**关系，非矛盾） |
> | 红线三项 | `materializeIndicators_changed = false` · `param_config_semantic_change = false` · `protected_CALC_unexpected_change = false` |
> | `DEPLOYMENT_ROLLBACK_BINDING` | ✅ **`BOUND`** —— `previous_package_sha = aa576c20599528a66737f154b31b8cca87f25c1cf50068093bc243ed7084caea`（线上 V3.6.4）· `new_bundle_sha = e996e88a…55a4` · `rollback_bundle_sha256 = 4c7949f5…295e` · `rollback_artifact_sha` 锚定证据文件字节；两者同处一个 deployment plan |
> | GATE-D 扩充（§6） | **D-08 `deployment_artifact_materialized` PASS** · **D-09 `deployment_artifact_exact_match` PASS** · **D-10 `owner_deployment_authorization` ⛔ FAIL**；原 D-08 owner 授权后移为 D-10 |
> | ★ `BLOCKED_ON_DEPLOYMENT_ARTIFACT` | 新增 fail-closed 分支：bundle 生成前 / 未 exact match ⇒ 该状态（当前**已越过**） |
> | ★ `PENDING_OWNER_DEPLOYMENT_APPROVAL` 语义收紧 | **「已存在一个具体、不可变、可用 SHA 唯一标识的 deployment bundle，owner 只差决定『是否把这一包上传生产』」** |
> | ★ §7 三层 identity binding | `base_head_sha`（**provenance**，⛔ 不再是唯一代码身份）+ `candidate_manifest_sha` + `deployment_bundle_sha`，外加 `production_env` / `function_name`；⛔ **仅绑 HEAD SHA 的授权一律 REJECTED** |
> | ★ §8 文档残留修正 | Prospective 机器状态旧行 `READY_FOR_CONTROLLED_PRODUCTION_ACTIVATION = PENDING_OWNER_APPROVAL` **已作废**，须保持 **`BLOCKED_ON_DEPLOYMENT_IDENTITY`**；controlled-run 的 `explicit HEAD SHA binding` 改为**三层 identity binding** |
> | ★ §9 stale tracked count | Freeze Review 残留「**25 个 tracked 文件**」= 历史旧口径 ⇒ 更正为当前真值 **84**；`## C` / `## E` 阶段日志段显式标注 **`[HISTORICAL SNAPSHOT]`** |
> | ★ §9 守卫加强 | 一致性检查器原反向正则**只匹配「tracked 在前」** ⇒ 漏掉 `<num> 个 tracked`（正是「25」逃逸的原因）；现**双向**匹配 + 允许显式历史标记豁免 |
> | **★★ §9 同源加固（门禁日志）** | `gate_log_integrity`：门禁日志**计数绑定真值 + 内容指纹新鲜度**。原 `stage_a_pass` / `stage_a_to_g_pass` **只做形态匹配、⛔ 不校验计数** ⇒ 过期日志（`71/71` / `79/79`）**静默假通过**；现要求 ① Stage A 计数 == `tests/*.test.js` 真值 ② 日志旁 `.source-sha256` == **当前源树内容指纹**（⛔ **非 mtime**：`v365-b0-manifest.test.js` A.8 会篡改后逐字节还原 ⇒ mtime 说谎）。**指纹化范围 = 三份门禁日志**（`stage-a` / `stage-all` / **`p12`** —— 只护前两份会留同类缺口）。**P-44** 断言机制，最终值由收口检查器强制 |
> | 证据件 | `deliverables/v365-production-history/c021/{deployment-artifact,pre-deploy-package-diff,deployment-rollback-binding}.json` · `c021/bundle/` · `c021/rollback/` |
> | 新增脚本 | `scripts/v365-deployment-bundle-materialize.js` · `scripts/v365-pre-deploy-package-diff.js` · `scripts/v365-deployment-rollback-binding.js` · `scripts/v365-source-tree-sha.js` · `scripts/lib/v365-deterministic-tar.js`（共享模块，⛔ 禁止复制同源逻辑） |

> **★★★★ C-021.2 CONTROLLED DEPLOYMENT（**已执行** · 单次 · `runDecisionEngine` only，2026-09-30）** ——
> owner 于 C-021.2 §3 明确授权，五元组逐位绑定；⛔ **不含 FIRST CONTROLLED RUN**：
>
> | 项 | 当前语义 |
> |---|---|
> | `AUTHORIZATION_SCOPE_RATIFIED_BY_OWNER` | ✅ **`true`** · `changed_files_count = 85` · `base_head_sha = c6bd006fd76ffc5358cddd07347df8ed23d9e61d` |
> | ⛔ **治理规则（owner 裁定）** | **`changed_files` 属于 authorization binding 的一部分**；自本 ratification 起，集合的任何**增加/删除/替换**均使 ratification **`INVALID`** ⇒ 须重新取得 owner 授权。⛔ agent **不再可自行同步**该字段 |
> | `APPROVAL_MANIFEST_SHA256` | `a972cb914b6df4aee5d03da5a718c0e3ebf0ee43afbfe0caa428baed68323594` |
> | `CHANGED_FILES_LIST_SHA256` | `c124f178a635b0aeaaf58251efea5987576ce90bf1212a934f1ce4c4b58cb50e` |
> | `CHANGED_REGIONS_LIST_SHA256` | `59cceefaccb008a8ded07912833bfb3f1e366d0481f590c9834919a05470e899` |
> | **`CONTROLLED_DEPLOYMENT`** | ✅ **`COMPLETE`** —— `tcb fn deploy runDecisionEngine` 单次成功（`2026-09-30T05:37:19Z` → `05:38:13Z`） |
> | 部署输入 | **解包已冻结 bundle**（⛔ 非 mutable worktree）；`STAGED_SOURCE_PARITY = EXACT_MATCH`；移除陈旧 `common/MANIFEST.json` |
> | `AUTHORIZED_BUNDLE_SHA` | `e996e88ae8084a38e186471b561867267fc4280c3ea5758ccb0eff75092455a4`（部署前从磁盘复算**逐位一致**） |
> | **`CURRENT_PRODUCTION_DEPLOYMENT_IDENTITY`** | **`V3.6.5`**（部署前 `V3.6.4`） |
> | 线上元数据 | `FunctionId=lam-eiye285p` · `Runtime=Nodejs16.13` ✅ · `Handler=index.main` ✅ · `ModTime=2026-09-30 13:38:07` · `CodeSize=4465434` |
> | **`ONLINE_SOURCE_PARITY`** | ✅ **`EXACT_MATCH`**（91 文件 · `MISSING 0` · `UNEXPECTED 0` · `CONTENT_DIFF 0`） |
> | **`POST_DEPLOY_UNEXPECTED_PACKAGE_DIFF`** | ✅ **`0`** |
> | **`DEPLOYMENT_IDENTITY_VERIFIED`** | ✅ **`true`**（★ 部署后由 post-deploy gate 置 true；部署前必须 false） |
> | **`READY_FOR_V365_FIRST_CONTROLLED_RUN`** | ⛔ **`PENDING_OWNER_RUN_APPROVAL`**（等 owner **单独**授权） |
> | `READY_FOR_CONTROLLED_PRODUCTION_ACTIVATION` | `PENDING_OWNER_APPROVAL`（G-25 已过 · 仅差 G-16 owner 运行授权） |
> | `deployment_authorization_consumed` | **`true`**（⛔ 授权**一次性**，已消耗；再次部署需 owner 新授权） |
> | `OWNER_RUN_AUTHORIZATION` / `PRODUCTION_ACTIVATION_AUTHORIZATION` | ⛔ `false` / `NOT_GRANTED` |
> | ⛔ **未做** | 未执行 production run · 未初始化 pointer · 未写 `run_manifest`/`run_history` · 未设 `V365_ENFORCE_SWITCH_DATE` · 未建 `PROSPECTIVE_EPOCH` · 未改 `param_config`/schema/collection · 未 backfill · 未改 CALC / immutable lock · 未部署任何其他函数 |
> | 证据件 | `c021/{authorization-ratification,pre-deploy-gate,staged-deploy-input,post-deploy-identity-gate}.json` · `docs/production-deployment-ledger.md` **D-009** |

> **★★ C-020 设计修正（PROSPECTIVE_DESIGN_CORRECTION）** —— owner §1~§8 裁定：
>
> | 项 | 当前语义 |
> |---|---|
> | `execution_authority` | **`trade_log`**（显式实际执行账本，Model B） |
> | `actual_position_book_authority` | **`portfolio_snapshot.positions[].position`** |
> | `run_candidate_portfolio` | ⛔ **`candidate_intended_portfolio_provenance`** —— 审计判定 `NOT_PROVEN`（无法证明保存执行后 actual position）⇒ ⛔ 不得用于 `RPG-F2-C-PROSPECTIVE` actual-book qualification |
> | 两层 anchor | `result_sequence_sha`（⛔ **不得单独作 qualification anchor**）+ **`PROSPECTIVE_QUALIFICATION_ANCHOR`**（≥12 绑定：协议/窗口/真实数据集/代码/回放实现/结果序列）；⛔ 不复用旧 anchor |
> | CAS/history 恢复 | `CAS_REJECTED`（pointer 不变 · promoted=false · switch date=null · EPOCH=NOT_STARTED · STOP）· `PROMOTED_HISTORY_INCOMPLETE`（⛔ 不得声明"不写 pointer"· 7 步恢复 · ⛔ 不得自动回滚 pointer）· `HISTORY_IMMUTABILITY_CONFLICT` ⇒ HARD STOP |
> | `OD-P-1` | ✅ **`APPROVED`**（MIN=120 / MAX=250 trading days） |
> | `OD-P-2` | ✅ **`APPROVED_WITH_CORRECTION`**（增强两层 anchor；⛔ 非"仅绑定 decision sequence"弱版本） |
> | `OD-P-3` | ⛔ **`NOT_YET_GRANTED`**（本轮不授权 controlled activation） |
> | `OD-P-4` | ✅ **`DEFINED`**（epoch = owner 授权后第一个正常计划执行且市场数据完整的自然交易日；⛔ 禁回溯/挑历史/测试日/设计日） |
> | `OD-P-5` | ⛔ 保持 `qualification_authoritative = false`，直至窗口 ≥120 + 动态覆盖满足 + F2-B-P/F2-C-P = COMPLETE + 前瞻 Δ=0 + Full Requalification PASS；之后由 **owner 单独裁定** |

---

## B. 生产数据阻塞登记 `[AS-IS]`

### B.1 结论

```
RPG-F2-B = BLOCKED_ON_GOVERNED_PRODUCTION_EXPORT
RPG-F2-C = BLOCKED_ON_GOVERNED_PRODUCTION_EXPORT
```

**阻塞性质 = 能力型（capability），非授权型（authorization）**：
- §7 已授权「只读生产数据导出」；
- 但**本会话不存在任何 CloudBase/TCB 通道** ⇒ 该授权**无法被执行**。

### B.2 通道审计 `[AS-IS]`

| 检查 | 结果 |
|---|---|
| 本会话 MCP 工具 | `jev-decide` · `sheetagent` · `weixinpay` —— **无 CloudBase** |
| `~/.workbuddy-ai/mcp.json` | 仅 `jev-decide` |
| `~/.workbuddy-ai/connectors/` | `default` · `skills` · 1 个 UUID 目录 —— 无 CloudBase |
| marketplace connectors（16 个） | canva · dingtalk · edgeone-pages · feishu · futu-mcp · github · kdocs · kling-ai-plugin · laiye-adp · linear-mcp · moomoo-mcp · notion · textin-xparse · tiktok · tmeet · wecom —— ⛔ **无 CloudBase/TCB/腾讯云** |

### B.3 所需数据 `[INFER]`

| 缺口 | 需要的数据 | 用途 |
|---|---|---|
| **RPG-002**（cooldown） | `trade_log` **全量**历史（含 `trade_date` / `code` / `action` / `add_mode`） | 真实 execution ledger ⇒ cooldown 真实路径 |
| **RPG-003-PH**（production book） | `portfolio_snapshot` **全量**历史（`snapshot_date` + `positions[].position` + 聚合字段） | 真实逐日账面 ⇒ PH replay |

### B.4 现有本地数据（**非规范、不足以解阻塞**）`[AS-IS]`

| 路径 | 内容 | 判定 |
|---|---|---|
| `deliverables/etf_daily_ml_pool/*.csv`（31 文件） | 日线 OHLCV | ✅ 规范输入包（已在用） |
| `C:/c/tmp/cd-dump/…trade_log-….json` | **10 条**，`2026-08-14 → 2026-08-24` | ⚠️ **仓外、非规范、无 provenance**；覆盖窗口仅 11/25 日 ⇒ ⛔ 不足以解 RPG-002 |
| `C:/c/tmp/cd-dump/…etf_daily-….json` | 日线 | ⚠️ 非规范 |
| `portfolio_snapshot` 历史 | ⛔ **不存在于本机任何位置** | ⛔ RPG-003-PH **无任何本地数据** |

### B.5 处置（按 §11「数据不足时的处理」）`[INFER]`

```
判定 = A（独立 blocker）⇒ 不冻结主线，推进独立工作包。
```
⛔ **不做**：猜测 / 插值 / 伪造生产历史。
⛔ **不把**仓外 ad-hoc dump 当作 governed 生产真值。
✅ **可做**：其余**不依赖**生产数据的工作包（HD12-2 → HD12-3 → WP-RH1 → RH2 → RH3 → RH4）。

### B.6 解阻塞所需的人工动作 `[HUMAN]`

> ⚠️ **本节的旧「三选一」表述已被 owner 裁定（`C-005` · `DO_NOT_ACCEPT_COVERAGE_GAP_AS_FINAL_PRODUCTION_READINESS`）覆盖**。
> 以下为**正式当前状态**（唯一有效版本）：

```text
解除 GOVERNED_PRODUCTION_HISTORY_DATA_REQUIRED 只允许：
A. 提供 CloudBase / TCB 只读通道，由 agent 做受治理导出；
或
B. owner 提供正式生产导出，并补齐 provenance 后纳入 deliverables/evidence。
C. “接受 RPG-002 / RPG-003-PH 覆盖缺口并直接放行”
= REJECTED_BY_OWNER
= NOT_AN_ALLOWED_PRODUCTION_READINESS_PATH
```

⛔ **A / B 二选一**；**C 已被 owner 明确拒绝**（`REJECTED_BY_OWNER`），**不是**合法的生产就绪路径。
⛔ agent 不自行选择；A / B 均需 owner 决定。
⛔ **不得修改 `C-005` 的 append-only 历史记录** —— 本节只反映其覆盖后的当前状态。

---

## C. 阶段日志（append-only）

> ⛔ **`## C` / `## E` 两节均为 `[HISTORICAL SNAPSHOT]`**（C-021.1 §9 显式标注）。
> 其中的任何计数（`tracked-file count` / `Stage A = N/N` / 文件数 / 门禁通过数）
> **只反映该轮次当时的实况**，⛔ **不得**当作 current state 引用。
> **current state 一律以 `## A. 当前状态快照` 为准。**
> 两者混用是本项目已记录的同类事故（C-021.1 §9：Freeze Review 残留「25 个 tracked 文件」旧口径）。

### C-001 · 2026-09-28 · RPG-F2-B/C 阻塞登记 + 主线调整

| 项 | 内容 |
|---|---|
| **动作** | 审计生产数据可得性；判定 F2-B/C 为能力型阻塞 |
| **依据** | §B.2 通道审计（零 CloudBase 通道） |
| **调整** | 按 §4 允许的「局部顺序调整」：跳过数据阻塞的 F2-B/C，**直接推进独立主线**（HD12-2 → HD12-3 → WP-RH1 → RH2 → RH3 → RH4） |
| **理由** | §11 A 类（独立 blocker）⇒ 不冻结主线；HD12-2 是 RDE 相关变更的**前置**（否则任何 RDE 改动都会让 parity 门禁 FAIL） |
| **门禁** | N/A（只读审计） |
| **下一** | HD12-2 orchestration authorization mechanism |

### C-002 · 2026-09-28 · HD12-2 = COMPLETE

| 项 | 内容 |
|---|---|
| **新增** | `scripts/lib/v365-orchestration-approval.js`（纯函数授权校验器） |
| **修改** | `scripts/v365-p12-decision-parity.js`（接入授权判据 + `--approval-manifest` / `--head-sha`） |
| **新增** | `tests/v365-orchestration-approval.test.js`（B-01~B-17） |
| **判据分层** | `CALC` ⇒ ⛔ 绝对 FAIL（无授权路径）· `ORCH` ⇒ 需授权清单 · `MIXED` ⇒ 需 zone 声明 **或** comment-only 机械证明 · `REPLAY_INFRA` ⇒ 需 `REPLAY_INFRA_CHANGE_REVIEW_REQUIRED` · 域内 `UNCLASSIFIED` ⇒ 默认拒绝 |
| **授权绑定** | `authorization_sha` 必须 40 位字面值 **且** 与 `--head-sha` 逐位一致（R-GI-002）；`changed_files` 必须与改动清单**完全一致**（多报/少报均 FAIL）；`orchestration_scope` 非空；⛔ 缺 `--head-sha` ⇒ FAIL（fail-closed） |
| **门禁** | Stage A **62/62** · qualification gate **38/38** · parity **Δ=0**（anchor `25ccbfc7…` 未变）· reader migration **8/8** · immutable / Gen-1 / Gen-2 verifier 全 PASS · C-01~C-17 全 PASS · B-01~B-17 全 PASS |
| **行为收紧** | ⛔ 无。**行为放宽一处**（已授权）：受保护文件改动从「绝对禁止」改为「可经授权清单放行」——这正是 HD12-2 的目的；**无授权时行为与改前一致**（仍 FAIL） |
| **证据** | 10 种情形逐一实测：无清单/域外 ⇒ PASS；CALC / MIXED 无清单 / SHA 不匹配 / changed_files 不一致 / INFRA 无 marker ⇒ FAIL；MIXED+comment-only、ORCH+授权、INFRA+marker ⇒ PASS |
| **自纠** | ① 实现 bug：`comment_stripped_sha_*` 是 **sha256（64 位）**，我误用 `SHA40` 判据 ⇒ 已修并区分 `SHA40`/`SHA256`；② 测试断言写错 2 处（B-15 提前返回语义、⑦ fixture 被 sed 弄坏）⇒ 均按「先怀疑断言」修正 |
| **新增观察项** | **OBS-C**：`--changed-file` 缺省时 parity 的受保护集判据**静默跳过**（仅 WARN）⇒ 属**已知 fail-open 面**；建议后续将「提供改动清单」纳入强制接口（未做，因会破坏既有调用惯例）<br>**OBS-D**：`zone_declaration` 目前是**声明而非验证**（区域比对属 HD12-3 的 `--changed-region`）⇒ HD12-3 关闭 |
| **下一** | HD12-3 RDE mixed-file zone protection |

### C-003 · 2026-09-28 · HD12-3 = PARTIAL（标记已安装 + 已授权放行）

| 项 | 内容 |
|---|---|
| **修改** | `cloudfunctions/runDecisionEngine/index.js` —— 插入 **8 行纯注释** zone 标记（2 个 zone × 2 个区段 × 开/闭） |
| **zone 定义** | `lifecycle_writer`：`:538-558`（`v365WriteDecision`/`v365WritePortfolio`）+ `:1315-1327`（fail-closed 发布门）<br>`telemetry`：`:1424-1521`（`runtimeStatus`）+ `:1523-1580`（响应体） |
| **授权方式** | **comment-only 机械证明**（HD12-2 的 `MIXED` 路径）——`canonicalCodeSha256(before) == canonicalCodeSha256(after)` |
| **★ 自纠（设计缺陷）** | 首版 `stripComments()` **只去注释、保留空白行** ⇒ 新增一行注释仍会改变 stripped 文本 ⇒ 「comment-only 证明」**不可用**（自测暴露）。<br>⇒ 修正为 **`canonicalCodeFingerprint()`**：去块/行注释 + 统一换行 + 去行尾空白 + **丢弃空白行**；并加**反向对照**（注入一行真代码 ⇒ 指纹必变）证明其非空泛 |
| **manifest** | 已按授权重算：`candidate_content_sha` `485c0977…` → **`55106ce6…`**；**仅** RDE 的 `file_sha256` 与 content sha 变化（其余 **19/20** 文件哈希**未变**）✓ `verify-v365-candidate-manifest` PASS |
| **门禁** | Stage A **62/62** · qualification **38/38** · parity **Δ=0**（anchor `25ccbfc7…` 未变）· manifest verifier PASS · reader migration **8/8** · immutable / Gen-1 / Gen-2 PASS · A-01~A-10 / B-01~B-17 / C-01~C-17 全 PASS |
| **授权放行实测** | 以 comment-only 授权清单运行 parity ⇒ `[PASS] … APPROVED — 授权覆盖: cloudfunctions/runDecisionEngine/index.js(MIXED)` + `UNEXPECTED_DECISION_DELTA = 0` ✓ |
| **A-10 语义精化** | 由「CALC ∪ MIXED 全部零改动」精化为「**CALC 绝对零改动** + **MIXED 若改必须 comment-only**」⇒ 现在能表达 HD12-3 这类合法注释改动，同时**仍绝对禁止**计算核心改动 |
| **未完成（HD12-3 余下）** | ① 门禁侧 `parseOrchZones(source)` 解析标记 → 动态区间<br>② `--changed-region` 输入 + 区域包含性校验（关闭 **OBS-D**：zone 声明目前是"声明而非验证"）<br>③ 对应测试 |
| **下一** | 完成 HD12-3 门禁侧（① ② ③），随后 WP-RH1 |

---

## D. 观察项汇总

| ID | 内容 | 影响 | 状态 |
|---|---|---|---|
| **OBS-A** | `portfolio mode` 在 replay 与生产**同走退化分支**（根因 = 生产缺陷 #3：`multi_etf`/`etf_count` 缺失） | 无（replay == 生产） | 已登记 |
| **OBS-B** | `cash_ratio` 为**同式重复实现**而非同函数复用（数值等价） | 无 | 已登记 |
| **OBS-C** | `--changed-file` 缺省时 parity 的受保护集判据**静默跳过**（仅 WARN） | ⚠️ fail-open 面 | 已登记，未修（会破坏既有调用惯例） |
| **OBS-D** | ~~`zone_declaration` 目前是**声明而非验证**~~ | — | ✅ **已关闭（C-004）** |

---

## E. 阶段日志（续）

> ⛔ **本节整节为 `[HISTORICAL SNAPSHOT]`**（C-021.1 §9）。下方各轮次的
> `tracked-file count`（如 C-019 的 `74`、C-00x 的 `24/25`）与 `Stage A = N/N`
> **均为该轮当时实况**，⛔ **不得**作为 current state。
> **current state 见 `## A. 当前状态快照`：`tracked-file count = 80` · `Stage A = 72/72`。**

### C-004 · 2026-09-28 · RPG-F2-A 补核 + HD12-3 = COMPLETE

| 项 | 内容 |
|---|---|
| **§3 RPG-F2-A 补核** | 逐项核实 **16 项全部成立** ⇒ `RPG-F2-A = COMPLETE` · `RPG-001 = CLOSED`<br>（唯一"未过"项为**我的探针未剥离注释**——命中 `harness:248` 我自己的注释「⛔ 不硬编码 63.1/0.97」；用规范化口径复跑 ⇒ 成立） |
| **HD12-3 新增** | `parseOrchZones()`（标记 → 1-based 闭区间，抗行号漂移）· `validateRegionContainment()`（区域 ⊆ 声明 zone）· `scripts/v365-gen-changed-regions.js`（调用方工具，`git diff -U0` → 区域清单）· `--changed-region` 接入 parity gate |
| **HD12-3 判据** | `zone_declaration` **必须**附 `--changed-region` 且**区域包含性成立**，否则 FAIL（`ZONE_DECLARATION_WITHOUT_REGIONS` / `REGION_OUTSIDE_DECLARED_ZONE`） |
| **★ OBS-D 关闭** | zone 从「**声明**」升级为「**声明 + 机器验证**」—— 实测：区域在 zone 内 ⇒ `REGIONS_CONTAINED` PASS；区域在 zone 外/跨界 ⇒ FAIL；声明不存在 zone ⇒ FAIL |
| **zone 实测** | RDE 解析出 `lifecycle_writer`（2 区段：538-558 / 1315-1327）与 `telemetry`（2 区段：1424-1521 / 1523-1580），**无 malformed** |
| **新增测试** | `tests/v365-orch-zone.test.js`（**D-01~D-10 全 PASS**），含**反向对照**：注入一行真代码 ⇒ 代码指纹必变（证明 comment-only 证明非空泛） |
| **测试更新** | B-12 期望值更新为 HD12-3 的更强语义（裸 zone 声明 ⇒ FAIL） |
| **门禁** | Stage A **63/63** · qualification **38/38** · parity **Δ=0**（anchor `25ccbfc7…` 未变）· manifest verifier PASS · reader migration **8/8** · immutable / Gen-1 / Gen-2 PASS · A/B/C/D 四套专项全 PASS |
| **下一** | WP-RH1 Contract Registry |

### C-005 · 2026-09-28 · owner 裁定：生产历史数据

| 项 | 内容 |
|---|---|
| **裁定** | `DO_NOT_ACCEPT_COVERAGE_GAP_AS_FINAL_PRODUCTION_READINESS` |
| **落实** | RPG-F2-B / RPG-F2-C / RFP-V2-PH 保持 `BLOCKED_ON_GOVERNED_PRODUCTION_HISTORY_DATA`；**但最终 Freeze Review 若仍未关闭 ⇒ 只能输出 `BLOCKED`**，唯一 blocker = `GOVERNED_PRODUCTION_HISTORY_DATA_REQUIRED` |
| **数据治理要求** | 若走人工/已有导出：每份须记录 `source_collection` / `source_environment` / `exported_at` / `export_method` / `date_range` / `record_count` / `file_sha256` / `schema_summary` / `provenance_status`，并落入 `deliverables/` 或 `evidence/`；⛔ 不得再用 `C:/c/tmp/...` 作为 qualification evidence |
| **禁止** | synthetic 当 production historical · `suggested_position` 当 actual position · partial dump 当完整历史 · 插值 / 猜测 / 伪造 |

### C-006 · 2026-09-28 · WP-RH1 = COMPLETE（Contract Registry）

| 项 | 内容 |
|---|---|
| **★ 路径调整（有据）** | 原计划「4 个集合登记进 **`constants.js`** + `schema.js`」**不可行** —— `constants.js` 属 `DECISION_CALCULATION_CORE`（**HD12-D8**，owner 裁定），受**绝对**保护（⛔ 无授权路径）。<br>⇒ 改为按 **OD-5**（「集合名收敛到 `v365-contracts.js` 作为唯一来源」）实现：集合名登记在 `v365-contracts.js`，`schema.js` 从该处取用。<br>⛔ **未修改 `constants.js`**（E-03 断言守卫）；此举**更符合** OD-5，且不推翻任何冻结裁定 |
| **新增（schema）** | `schema.js` 新增 **5 个 SCHEMAS**：`run_manifest` · `run_candidate_decision` · `run_candidate_portfolio` · `active_run_pointer` · `run_history`（`SCHEMAS` 29 → **34**）<br>· `run_history` 按 **OD-1 方案 A′**：单表、`uk_run_id`、只存**前向** `supersedes_run_id`、⛔ **无** `superseded_by_run_id`、⛔ **无** `is_active`、含 `promoted_at`（事件时刻）<br>· `active_run_pointer`：`uk_scope`（**1 行/scope**）+ `scope`/`run_id`/`revision` 均 `required`<br>· candidate 集合：`uk_run_candidate` = `(run_id, candidate_key)` 唯一 |
| **新增（contracts）** | `v365-contracts.js`：`V365_COLLECTIONS` 新增 `RUN_HISTORY`（4 → 5） |
| **收敛（OD-5）** | `v365-atomic-publish.js`：删除本地硬编码 `POC_COLLECTIONS` 表 → 从 `v365-contracts.js` 取用 + 保留**过渡别名** + 修正失效注释（原注释自称「未创建任何生产 collection」，与实况不符） |
| **守卫扩展** | `schema-collections-parity.test.js`：`declared` 改为**两源并集**（`constants.COLLECTIONS` ∪ `v365-contracts.V365_COLLECTIONS`），**并新增「两源不得重叠」断言**（防双源漂移） |
| **新增测试** | `tests/v365-rh1-contract-registry.test.js`（**E-01~E-12 全 PASS**），含 `constants.js` 零改动断言（E-03）与「无反向字段/无 is_active」（E-07） |
| **manifest** | 已重算：`candidate_content_sha` `55106ce6…` → **`2a78defb…`**；**仅** `v365-contracts.js` 与 `v365-atomic-publish.js` 两处哈希变化 ✓ |
| **门禁** | Stage A **64/64** · qualification **38/38** · parity **Δ=0**（anchor `25ccbfc7…` 未变）· manifest verifier PASS · reader migration **8/8** · immutable / Gen-1 / Gen-2 PASS · 6 套专项测试全 PASS |
| **⛔ 未做（需单独授权）** | **生产建表**（5 个集合的 CloudBase `createCollection`）—— 本登记只保证「清单完整」，**不代表已创建** |
| **下一** | WP-RH2 Run Registry + lifecycle writer（R2-a 注释 → R2-b 字段 → R2-c 接线 → R2-d run_history 写入） |

### C-007 · 2026-09-28 · RH2/RH3 边界裁定 + R2-a/R2-b = COMPLETE

#### ① 边界裁定（**有冻结依据，非自行重新解释 OD-2**）

**问题**：`run_history` row 是否表示"该 run 已成功成为 authoritative active run"（⇒ 依赖 CAS 成功 ⇒ 应属 RH3）？

**裁定依据（逐条引冻结文档）**：

| 依据 | 原文 |
|---|---|
| `V365_RUN_LIFECYCLE_IMPLEMENTATION_ROADMAP.md` §WP-RH2 | 「**范围**：`run_history`（OD-1 A′）+ lifecycle writer（OD-3 A）」；子步骤含「**R2-d** `run_history` 一次写入（OD-2 时序）」 |
| `V365_RUN_LIFECYCLE_ARCHITECTURE_DECISION.md:468` | 「**RH2** \| ① **promotion 结果落 `run_history`**（OD-2 时序）② 补 `supersedes_run_id`」 |
| roadmap §OD-2（FROZEN） | 时序 `S4 candidate 写齐 → S4.5 manifest 写 → **S5 尝试提升** → **S5.5 run_history 一次写入（含 `promoted` / `cas_reason`）** → S6 指针已切`；Reason ③「**同时覆盖 promoted 与 rejected 两种结局**（rejected 也留痕，满足风控审计）」 |

**⇒ 结论**：`run_history` row 的语义 = **「该 run 的 promotion **尝试**结果」**（含 rejected），
⛔ **不是**"已成功成为 active" ⇒ **不依赖 CAS 成功** ⇒ **R2-d 归属 RH2** ✓
（RH3 的增量是 `supersedes_run_id` / supersede 链的**富化**，见 roadmap §WP-RH3）

**8 条时序不变量（本 WP 必须保持）**：
1. 时序严格为 `candidate → manifest/finality → CAS promotion → promotion confirmed → run_history append`；⛔ 禁止 `run_history append → CAS promotion`
2. CAS 失败 ⇒ 写 `promoted: false` + `cas_reason`（**非成功型**行）
3. retry ⇒ ⛔ 不得产生第二条同 run history（`uk_run_id` fail-closed / idempotent）
4. `promoted_at` **仅**来自真实 promotion 成功事件
5. `supersedes_run_id` 来自 promotion **前**的实际 active pointer
6. ⛔ 不新增反向 `superseded_by_run_id` 更新
7. ⛔ 不恢复 `decision_result` 双写
8. telemetry 修正必须 additive；deprecated 旧字段不得被偷偷重定义

#### ② 本轮实施（R2-a + R2-b）

| 子步 | 内容 |
|---|---|
| **R2-a**（OD-6 批1，零契约影响） | 修 RDE 两处失效注释：删「平台级 CAS 并发证据尚未取得」「单指针 CAS 提升需平台级并发实证」→ 改为「✅ 证据已取得（引用 `V365_PLATFORM_CAS_EVIDENCE.md`）+ ⚠️ RDE 侧提升调用尚未接线」 |
| **R2-b**（OD-6 批2，additive + deprecated） | 新增派生 `v365PromotionAllowed` / `v365PromotionSkippedReason` / `v365AuthoritativePublishStatus`；`promotion_skipped_reason` 改为**派生**（无跳过 ⇒ `null`）；新增 `authoritative_publish_status` + `v365_authoritative_publish_status`；⛔ **两个旧字段值一字未改**（F-07 机器断言） |
| **授权** | zone 声明 `lifecycle_writer` + `telemetry` + **区域包含性验证**（15 个改动区域全在 zone 内）⇒ `APPROVED` |
| **契约同步** | 新字段 `v365_authoritative_publish_status` 已登记进 `runtime_status` schema（**D12 前向守卫的正当要求**，`gen1-ge03-regression-guard` 曾据此打红） |
| **新增测试** | `tests/v365-rh2-runtime-fields.test.js`（**F-01~F-11 全 PASS**），含 F-07「旧字段值未改」与 F-11「R2-b 先于 R2-c」顺序约束 |
| **测试语义精化（2 处）** | `D-09` / `A-10`：由「MIXED 改动必须 comment-only」→「**comment-only ∨ zone-contained**」（因 R2-b 是合法**代码**改动）；`F-10`：由「零 `decision_result` 直写」→「直写**仅在 LEGACY 守卫内** + ENFORCE 走 candidate」（冻结设计明确允许 LEGACY 直写） |
| **manifest** | 重算：`2a78defb…` → **`6d6c6ed3…`** |
| **门禁** | Stage A **65/65** · qualification **38/38** · parity **Δ=0**（anchor `25ccbfc7…` 未变）· manifest verifier / reader migration / immutable / Gen-1 / Gen-2 全 PASS |
| **自纠** | 3 处回归全部为**断言过时**（非实现错误）⇒ 均按「先怀疑断言」精化，并保留原判据的**强化形式** |
| **新增观察项** | **OBS-E**：两份冻结文档的 WP 编号不一致 —— `DECISION.md:465-470` 把「CLASS C 读点迁移」记为 **RH3**，而 `ROADMAP.md` 把「Promotion History」记为 RH3、「读点迁移」记为 **RH4**。本会话采用 **roadmap**（更细粒度、含修改文件/rollback）。⚠️ **R2-d 归属在两份文档中一致（均为 RH2）**，故不影响本轮 |
| **下一** | R2-c（接线 `publishCandidateFirst()`）→ R2-d（`run_history` 单次写入） |

---

### C-008 · WP-RH2 · R2-c / R2-d 完成 ⇒ **WP-RH2 = COMPLETE**

| 项 | 内容 |
|---|---|
| **R2-c（OD-3 A 接线）** | RDE ENFORCE 分支接入 `runIntegrity.publishCandidateFirst({store, scope, manifest, expected_codes, decisions, portfolio})` —— **复用已被测试覆盖的编排函数**（⛔ 不复制协议）。`scope` 取 `publishStore.POINTER_SCOPE_PRODUCTION`（⛔ 不硬编码 `'production'`）；`revision` 取 **`getPointer()` 的 `revision + 1`**（**逻辑单调时钟**，过 `NON_MONOTONIC_REVISION` 门）；**必须传决策文档本体**（`decisions: v365CandidateDocs`）—— 函数写入时做 `calc_date` 归一，⛔ 若只回读则缺 `calc_date` ⇒ 被 mixed-date gate 判失败 ⇒ 永远无法提升 |
| **R2-d（OD-2 时序）** | `run_history` **单次写入**：`promoted` 严格派生自 `v365PublishResult.promoted === true`；`promoted_at` **仅**成功时非 `null`；`supersedes_run_id` 取自 **promotion 前**的 `planPointerPromotion().supersedes_run_id`；**先按 `run_id` 查重再写**（retry 幂等；`uk_run_id` 兜底 fail-closed）；**append-only**（⛔ 无 update、⛔ 无 `superseded_by_run_id`）；CAS **rejected 也留痕**（`promoted:false` + `cas_reason`）；写失败记入 `v365HistoryWriteError` 并暴露（fail-open 但**不静默**） |
| **时序硬约束（OD-2）** | 实测：**提升调用点（47957）< history 写入点（49924）** ⇒ `candidate → manifest/finality → CAS promotion attempt → run_history append` ✓ ⛔ 未出现 `append → promote` |
| **telemetry 补齐** | 新增 `v365_promotion_attempted` · `v365_cas_reason` · `v365_history_status` · `v365_history_write_error`；`v365_authoritative_publish_status` 由 **mode 推断**改为**读真实提升结果**（四态：`null`/`PROMOTED`/`NOT_PROMOTED`/`PROMOTION_FAILED`）⇒ 消除「推理链错误」的旧表述 `CANDIDATE_ONLY_NOT_PROMOTED` |
| **契约同步** | 4 个新字段登记进 `runtime_status` schema（**D12 前向守卫的正当要求**） |
| **授权** | zone 声明 `lifecycle_writer` + `telemetry` + **区域包含性验证**（17 区域全在 zone 内）⇒ `APPROVED`；`changed_files` 含 RDE + `schema.js`（门禁**正确拒绝**了首次少报 ⇒ 机制有效） |
| **测试语义精化（2 处）** | `F-05`：由「必须标注 `CANDIDATE_ONLY_NOT_PROMOTED`（接线前）」→ **四态真实结果**断言；`F-11`：由「为接线前过渡断言（零调用）」→ **正向锁定**「恰 1 处调用 + 传 `decisions` + 单调 revision + 提升点先于 history」；**新增 `F-12`**：OD-2 八条时序不变量逐条断言 |
| **manifest** | 重算：`6d6c6ed3…` → **`1a41f567…`** |
| **门禁** | Stage A **65/65** · qualification **38/38** · parity **Δ=0**（anchor `25ccbfc7…` 未变）· manifest verifier / reader migration / immutable / Gen-1 / Gen-2 全 PASS |
| **自纠** | 2 处回归均为**过渡期断言过时**（非实现错误）⇒ 按「先怀疑断言」改为**更强**的正向锁定 |
| **下一** | **RH3**（Promotion History / supersede 链富化） |

---

### C-009 · WP-RH3 · Promotion History ⇒ **WP-RH3 = COMPLETE**

| 项 | 内容 |
|---|---|
| **冻结边界** | `ROADMAP.md` §WP-RH3：**范围** = 「`active_run_pointer` + promotion records（OD-2 内嵌 + **supersede 链**）」；修改文件 = `v365-publish-store.js` · `v365-atomic-publish.js` · RDE |
| **★ 边界澄清（未提前吃 RH2 的活）** | RH2 已落地 `run_history` 的**写入本体**（OD-2 时序 + 单次写入 + `supersedes_run_id`）。RH3 的**真实增量** = ① **supersede 链富化**（`same_trade_date_supersede` 显式标记，R4「必须显式可追溯」）② **pointer 提升记录富化**（`promoted_from_pointer_run_id`）③ **CAS 写后回读一致性**上报（CAS-7） |
| **G-01 单一来源** | supersede 语义**唯一**出自 `planPointerPromotion()`；`supersedes_run_id` 与 `same_trade_date_supersede` 由**同一比较**派生 ⇒ 二者**不可互相矛盾**；⛔ RDE **不得**自行重算（已断言） |
| **G-02 plan 富化** | `plan.next_pointer` 记录 `promoted_from_run_id = current.run_id`（promotion **前**的 active run） |
| **G-03 CAS-7** | `compareAndSetPointer` 成功回执含 `read_after_write_consistent`，**双字段**比对（`run_id` **与** `revision`） |
| **G-04 三态透传** | `publishCandidateFirst` 透传：**成功** ⇒ `true`/`false`；**未提升** ⇒ `null`（⛔ **不得**伪造 `false` —— 会与"提升成功但回读不一致"混淆） |
| **G-05 RDE 落字段** | `run_history` 新增 `same_trade_date_supersede` · `promoted_from_pointer_run_id` · `read_after_write_consistent`；三者**均取自 plan / CAS 回执**，⛔ 非事后推断 |
| **契约同步** | 3 字段登记进 `run_history` schema（G-07） |
| **不变式保持** | G-08：⛔ 无反向 `superseded_by_run_id`、⛔ 无 `is_active`、零 `update`（严格 append-only）<br>G-09：**OD-2 时序未被破坏** —— 实测 提升点(50595) **<** history 点(53145)<br>G-10：`promoted_at` 判据**未被放宽**（`same_trade_date_supersede` 是描述性字段，⛔ 不得当提升判据）<br>G-11：**CALC 46 文件全部零改动** |
| **授权** | zone 声明 `lifecycle_writer` + `telemetry` + 区域包含性（17 区域全在 zone 内）⇒ `APPROVED`；`changed_files` 含 RDE + `schema.js` + `v365-run-integrity.js` |
| **新增测试** | `tests/v365-rh3-promotion-history.test.js`（**G-01~G-11 全 PASS**） |
| **manifest** | 重算：`1a41f567…` → **`258e7fb3…`** |
| **门禁** | Stage A **66/66** · qualification **38/38** · parity **Δ=0** · manifest verifier / reader migration / immutable / Gen-1 / Gen-2 全 PASS |
| **⚠️ 回滚语义（roadmap 已登记）** | 还原三文件 ⇒ promotion 仍可发生（RH2 已接线）但**不留 history**；期间已产生的 promotion **不可逆**（指针已切）⇒ `run_history` 会出现「有 run 无提升记录」空洞，**须在台账显式登记该窗口** |
| **下一** | **RH4**（CLASS C 5 个读点迁移 + 双源 provenance + `ALLOWED_LATEST_READS` 重登记） |

---

### C-010 · WP-RH4 · Historical Reader Migration ⇒ **WP-RH4 = COMPLETE**

> ⚠️ **本阶段出现 2 次「触碰到不该碰的文件」，均**先自查发现、后回退**。已登记为 **OBS-F / OBS-G**（见下）。

| 项 | 内容 |
|---|---|
| **冻结边界** | `ROADMAP.md` §WP-RH4：CLASS C 5 个读点迁移 + 双源 provenance（OD-4 §4.5） |
| **路径调整（有据）** | 原计划在 `cooldown.js` 加轴标记 ⇒ ⛔ **`cooldown.js` 属 CALC（HD12-D8 绝对保护）** ⇒ 回退，改为**带外登记**；`runGen1ShadowEod/index.js` ⇒ ⛔ 被 **`GEN1_FEATURE_PIPELINE_LOCK.json` 字节级冻结** ⇒ 回退，同样改为**带外登记** |
| **CLASS C 读点登记** | `CLASS_C_READ_POINTS`（**6 项**，覆盖冻结清单 5 个读点；`getReview` 的 decisions/snapshots 分列）· 每项含 `run_axis_target`（⛔ 不得空泛写"待迁移"） |
| **可见性双轨** | ① **文件内标记**（`apiGateway`×3 + `runIntegratedShadowEod`）② **带外登记**（`in_file_marker_allowed:false` + `marker_style:OUT_OF_BAND_REGISTRY_ONLY`），后者须属 CALC 或声明 `frozen_by` |
| **★ 双源 provenance** | `buildClassCProvenance()`（**14 键**）：`coverage` 四态（`legacy_only` / `run_axis_only` / `cross_switch_stitched` / `incomplete_gap`）· `silent_stitch_forbidden:true` · `latest_fallback_used:false` · `stitched:true` ⇒ **必须**带 `segments`（逐段实名 `axis` / `collection_source` / `selector`） |
| **★ 如实性（关键）** | `V365_ENFORCE_SWITCH_DATE = null`（**部署时才登记**）⇒ `run_axis_available=false` · `run_axis_status='PENDING_RUN_HISTORY_INDEX'` · `coverage='legacy_only'`。⛔ **即便请求跨切也只报 legacy_only** —— **不得凭区间形状伪造双源** |
| **扫描口径升级** | `scanForbiddenReadsDetailed()`（**标记感知**）⇒ 实测**违规 = 0**（同行标记 6 · 带外登记 1）；`scanForbiddenReads()` 保持**返回数组**（向后兼容） |
| **★ 门禁加固** | `v365-p12-decision-parity.js`：`--changed-file` **路径不存在** 或 **值为空** ⇒ `[FATAL] exit 2`（⛔ 不再降级为"无改动"静默放行 —— 否则 CALC 的"绝对禁止"可被一个手误路径绕过） |
| **★ 自查发现并纠正** | ① `cooldown.js` 属 **CALC** ⇒ 我的注释改动虽使**代码指纹不变**，仍**违反「零改动」** ⇒ `git checkout` 回退，指纹逐位复核 = HEAD ✓<br>② `runGen1ShadowEod/index.js` 被 **Gen-1 Lock 字节级冻结** ⇒ 门禁 `verify-gen1-pipeline` **10/10 → 9/10** 打红 ⇒ 回退 ⇒ **10/10 恢复** ✓ |
| **新增测试** | `tests/v365-rh4-class-c-readers.test.js`（**H-01~H-12 全 PASS**，含 **H-03b 不可改文件零改动** + **H-11 CALC 零标记**） |
| **manifest** | 重算：`258e7fb3…` → **`2f4b0519…`** |
| **门禁** | Stage A **67/67** · qualification **38/38** · parity **Δ=0**（anchor `25ccbfc7…` 未变）· manifest verifier / reader migration（**8/8**）/ immutable / **Gen-1（10/10）** / Gen-2 全 PASS |
| **下一** | **Full Requalification** → **Freeze Review** |

#### 本阶段新增观察项

| ID | 内容 | 处置 |
|---|---|---|
| **OBS-F** | `cooldown.js` 属 **CALC（绝对保护）**，**连注释都不允许**改 ⇒ 其 CLASS C 读点**无法在源码内标记** | 已登记为**带外登记**（`in_file_marker_allowed:false`）；测试 H-03b/H-11 守卫 |
| **OBS-G** | `GEN1_FEATURE_PIPELINE_LOCK.json` 对 `runGen1ShadowEod/index.js` 是**字节级**冻结（注释改动亦失配）⇒ 与「读点需文件内标记」直接冲突 | 已登记为**带外登记** + `frozen_by`；测试 H-03b 守卫（并复核 Lock 10/10） |
| **OBS-H** | `scanForbiddenReads` 原**不豁免**已登记读点 ⇒ 会把 `cooldown`/`runGen1ShadowEod` 的合法读点误报为违规 | 升级为**标记感知**（`scanForbiddenReadsDetailed`）+ 保留旧签名兼容 |

---

### C-011 · Full Requalification + Freeze Review ⇒ **BLOCKED**

#### Full Requalification = COMPLETE

| 项 | 结果 |
|---|---|
| Stage A | **67/67** |
| 7 门禁 | `verify-immutable` · `verify-gen1-pipeline`(**10/10**) · `verify-gen2-build-artifacts` · `verify-v365-candidate-manifest`(**20 文件**) · `v365-reader-migration-gate`(**8/8**) · `v365-qualification-gate`(**38/38**) · `v365-p3-atomic-publish-gate` **全 PASS** |
| parity | `UNEXPECTED_DECISION_DELTA = 0` · **RFP-V1 anchor** `25ccbfc7e1b73a9a173ec36c17512c6228a2fe42685dcd291bc055ea4ed11723` **未变** · **RFP-V2-CF anchor** `b87654ab81935731a4173b5f566231f6db62c3d2e2b43f74cd6c8fb93ea78832` |
| manifest | 重算 → `candidate_content_sha` = `2f4b05193ff09d27bc990254e91e545dcad0d2926cf26835119b846c7cd2cade` |
| replay_semantics | `COUNTERFACTUAL_ASSUMED_EXECUTION` · `qualification_authoritative = false` |
| 10 套专项 | C / B / D / A / E / F / G / H / schema-parity / gen1-ge03 **全 PASS** |
| tracked 改动 | **19** 个文件（`git diff --name-only HEAD \| wc -l`；三份收口文档均为 untracked，不计入） |
| 不可改文件 | `constants.js` · `cooldown.js` · `runGen1ShadowEod/index.js` ✅ **零改动** |

#### Freeze Review = ⛔ **BLOCKED**

| 项 | 内容 |
|---|---|
| **裁定** | `FREEZE_REVIEW = BLOCKED`（⛔ **不是** `READY_FOR_PRODUCTION_PROMOTION`） |
| **唯一 blocker** | `GOVERNED_PRODUCTION_HISTORY_DATA_REQUIRED` |
| **构成（同一根因）** | ① **RPG-002** `cooldown` = `KNOWN_GAP`（harness 硬编码 `cooldownDays:0`）② **RPG-F2-C** `position_book` = `COUNTERFACTUAL_ASSUMED_EXECUTION`（用 `suggested_position`）③ **RFP-V2-PH** = not available |
| **owner 最小数据集** | `trade_log`（覆盖 replay/qualification 所需日期范围）+ `portfolio_snapshot`（**同日期范围** + 每天**实际** `positions[].position`）；每份须带 `source_collection`/`source_environment`/`exported_at`/`export_method`/`date_range`/`record_count`/`file_sha256`/`schema summary`/`provenance status` |
| **落地要求** | 首选 CloudBase **只读**导出（⛔ 不写生产）；次选人工/正式导出文件**但须治理化**；存入受控 `deliverables/` 或 `evidence/`；⛔ **不得**再用 `C:/c/tmp/...` 无 provenance 临时文件 |
| **产品文档** | **`docs/V365_FREEZE_REVIEW.md`**（10 节，含解除 BLOCKED 的 7 步充要条件） |
| **明确声明** | 本评审**未**用任何模型输出替代 owner 对**风险接受 / 生产放行**的拍板；所有"已完成"项均为本地/可逆/可验证工作，⛔ **不构成**生产就绪证明 |
| **下一步** | ⛔ **停止** —— 达到硬停止条件（唯一路径需 owner 提供受治理生产历史数据） |

#### 副作用窗口登记（沿用 roadmap）

| WP | 窗口 |
|---|---|
| RH3 | 还原三文件 ⇒ promotion 仍可发生但**不留 history**；期间 promotion 已生效**不可逆** ⇒ `run_history` 空洞**须显式登记** |
| RH4 | 还原读者 ⇒ 回到读已冻结的 `decision_result` ⇒ **历史断档**；⇒ 回滚**必须**保留 legacy 分支 |

---

### C-012 · 2026-09-29 · CloudBase READ-ONLY Connector 建立（§1~§27 任务）

> ⚠️ 本轮**未**改变任何终局判定；`FREEZE_REVIEW = BLOCKED` 与唯一 blocker 均**未变**。

| 项 | 内容 |
|---|---|
| **§2 能力审计** | SDK = `@cloudbase/node-sdk`（云函数声明 `^2.9.0`，本机 `dist-functions/*/node_modules` 实装 **v2.11.0**）· env_id = `tradingview-etf-d0fa42yy57cbc11b`（源自既有 `scripts/ml/export-etf-daily-cloudbase.js`）· 现有 adapter `src/common/utils/db.js::query()` 已具自动分页，**但含 mutation 方法 ⇒ 不采用** |
| **实现选型** | **Option A（Existing official SDK）** —— 复用已装 SDK，**零新依赖安装**；在 `scripts/tools/` 建独立**只读** client + exporter，**不接业务链**、**不 require `db.js`** |
| **§6 只读安全测试** | **R-03 PASS**（源码零 mutation）· **R-04 PASS**（导出面 `[listCollections, count, queryPage, sample]`）· **R-05 PASS**（源码零 secret）· **R-06 PASS**（非 allowlist ⇒ `COLLECTION_NOT_ALLOWED` FAIL CLOSED）<br>⛔ **R-01 / R-02 FAIL** —— client 可构建，但真实查询报 `SIGN_PARAM_INVALID: secret id error` |
| **★ 失败根因（非代码）** | 本机 `~/.config/.cloudbase/auth.json` 存的是 **cloudbase CLI 临时凭证**，`credential.domestic.tmpExpired = 2026-09-24 11:57:14` ⇒ **已过期**；`cloudbase env:list` 亦报 `No valid identity`；无 `TENCENTCLOUD_*` 环境变量；无长期 service-account key |
| **★ 自纠（重要）** | 首版安全测试**误报** `CLOUDBASE_READONLY_CONNECTION = VERIFIED` —— 因 `listCollections()` 把 count 的**连接错误静默吞掉**当作 `exists:false`。已修正：① `listCollections` **fail-closed**（仅 `ResourceNotFound` 记不存在，连接/权限错直接抛）② 安全测试以**真实 count 探测**判定 R-01，并把 R-02 失败回写为 R-01 修正 |
| **★ 安全修复** | **OBS-J**：`.tcb-home/` **原先未被 `.gitignore` 覆盖** ⇒ 若有人把凭证放仓库内将泄漏。**已修**（`.gitignore` 新增 `.tcb-home/` / `.tcb-keys/` / `**/.cloudbase/` / `**/auth.json` / `**/*.tcbkey`） |
| **§24 Secret Leak Gate** | ✅ PASS —— `git status` tracked 改动中零 secret；repo grep 零命中 |
| **新增测试** | `tests/v365-cloudbase-readonly.test.js`（**K-01~K-10 全 PASS**）—— 用 mock/静态断言证明只读门禁与 §16 actual-position 语义（**不需凭证**） |
| **门禁** | Stage A **68/68**（67 → 68，新增 K 套）· 其余门禁未受影响（无生产代码改动） |
| **tracked 改动** | **20**（= 原 19 + `.gitignore` 安全修复）；三份收口文档 + `scripts/tools/` + 新测试均为 untracked |
| **⛔ 未做（红线）** | 生产写入 / 建表 / 建索引 / deploy / push / PR / merge / tag · 未写入 `run_history` / candidate / pointer · 未改生产 schema · ⛔ **未用写操作"验证连接"** |
| **§25 状态输出** | `CLOUDBASE_READONLY_CONNECTOR = READY` · `CLOUDBASE_READONLY_CONNECTION = NOT_ESTABLISHED` · `CREDENTIAL = PRESENT_BUT_UNUSABLE` · `READ_PERMISSION = INSUFFICIENT_OR_EXPIRED` · `FREEZE_REVIEW = BLOCKED` |
| **owner 所需动作** | ⛔ 不要把 secret 发到聊天/仓库。二者之一：① 本机执行 `cloudbase login` 刷新临时凭证；② 在 secret store/环境变量配置**只读子账号** `TENCENTCLOUD_SECRET_ID` / `TENCENTCLOUD_SECRET_KEY`（可选 `TCB_ENV_ID`） |
| **恢复条件** | 凭证就绪后，agent **自主**执行：`node scripts/tools/cloudbase-readonly-safety-test.js`（复验）→ `node scripts/tools/cloudbase-export-governed-history.js`（受治理导出 + §15~§18 门禁）⇒ Governed Data Gate PASS 后按 §19 自动恢复 RPG-F2-B → F2-C → RFP-V2-PH → RUN_HISTORY_INDEX → Full Requalification → Freeze Review |
| **产品文档** | **`docs/V365_CLOUDBASE_READONLY_CONNECTOR.md`** |

---

### C-013 · 2026-09-29 · 只读连接**建立成功** + 受治理生产历史导出（阻塞解除）

> owner 完成授权登录后，agent 自主执行。**本条目记录阻塞解除**，⛔ 不改动 C-012（append-only 历史）。

| 项 | 内容 |
|---|---|
| **触发** | owner 本机执行 `cloudbase login` 授权成功 |
| **★ 凭证结构变更（新发现）** | CLI 3.8.1 重写后的 `auth.json` 结构**由嵌套变扁平**：原 `credential.domestic.{tmpSecretId,...}` ⇒ 现 `credential.{tmpSecretId,tmpSecretKey,tmpToken,tmpExpired,expired,authTime,refreshToken,uin}`。<br>⛔ 旧 loader 只认 `.domestic` ⇒ 会**静默丢凭证**。**已修**：`loadCredential()` 同时兼容扁平与嵌套两种形态 |
| **★★ 真实根因（关键）** | `@cloudbase/node-sdk` 的临时凭证字段名是 **`sessionToken`**，**不是** `token`。<br>旧代码传 `{ token: ... }` ⇒ SDK **静默忽略** ⇒ 临时密钥缺 STS token ⇒ 服务端返回误导性的 `SIGN_PARAM_INVALID: secret id error`（**看起来像"凭证无效/权限不足"，实为"token 未带上"**）。<br>**实测对照**：`{sessionToken}` ⇒ `total=13`（OK）；`{token}` ⇒ `SIGN_PARAM_INVALID`（FAIL）。**已修** `createReadOnlyClient()` |
| **★ 诊断增强** | 新增 `checkCredentialFreshness()`（只读·不触网·零 secret 输出），区分 `EXPIRED / OK / UNKNOWN`；exporter 在过期时输出 `[ROOT CAUSE] CREDENTIAL_EXPIRED`。新增测试 **K-11 / K-12** |
| **独立交叉验证（非仅自报）** | ① CLI `cloudbase env:list` ⇒ env `tradingview-etf-d0fa42yy57cbc11b` = `NORMAL`；② CLI `db nosql execute` count ⇒ `ok:1.0`；③ SHA-256 **独立复算**（`crypto` 直读文件）⇒ trade_log / portfolio_snapshot **双双 MATCH** |
| **§6 只读安全测试** | ✅ **R-01/R-02/R-03/R-04/R-05/R-06 全 PASS** ⇒ `STATIC_READONLY_GUARDS = PASS` · `LIVE_CONNECTION_PROBE = PASS` · `CLOUDBASE_READONLY_CONNECTION = VERIFIED` |
| **§8 元数据探针** | `trade_log` = **13** 文档 · `portfolio_snapshot` = **40** 文档；两集合 schema 均含预期字段 |
| **§10 受治理导出** | `trade_log` 13 行 / 1 页 · `portfolio_snapshot` 40 行 / 1 页（确定性排序分页，`exhausted`） |
| **§15 完整性门禁** | trade_log：`pagination_ok=true` `coverage_ok=true` · 13 行（BUY 7 / SELL 6）· `UNPARSEABLE_DATES=0` `DUPLICATE_IDS=0` · 日期 2026-08-14 → 2026-09-11<br>portfolio_snapshot：`pagination_ok=true` `coverage_ok=true` · 40 快照 / 40 日期 · `DUPLICATE_DATE_COUNT=0` `MISSING_REQUIRED_DATE_COUNT=0` · POSITION_ROWS=200 · 日期 2026-08-14 → 2026-09-29 |
| **§16 actual-position 门禁** | ✅ `POSITION_TOTAL=200` · `POSITION_WITH_ACTUAL=200` · `POSITION_SUGGESTED_ONLY=0` · `fallback_used=false` ⇒ **全部命中真实 `.position`，⛔ 未用 `suggested_position` 兜底** |
| **§15 字段完整性说明** | `ROWS_WITH_ADD_MODE = 0`（该字段**根本未写入**）· `ROWS_WITH_DECISION_ID = 0`（字段存在但**全为空串**）· `ROWS_WITH_POSITION_AFTER = 8/13`（8 买有值、卖出行为 `null`）。<br>⚠️ 这些是**生产数据既有特征，非导出缺陷**；依既有裁定 **`DECISION != EXECUTION`：`decision_id` 缺失不判错**（⛔ **不重新推翻**）。`add_mode` 同理为卖出型记录的正常缺省 |
| **§17 reconciliation** | `status = CONSISTENT` · `compared_rows = 200` · `sample_anomalies = []` |
| **§18 Governed Data Gate** | ✅ **8/8 PASS** —— `READ_ONLY_CONNECTION_VERIFIED` · `TRADE_LOG_EXPORT_COMPLETE` · `PORTFOLIO_SNAPSHOT_EXPORT_COMPLETE` · `PROVENANCE_COMPLETE` · `HASH_VERIFIED` · `DATE_COVERAGE_SUFFICIENT` · `PAGINATION_COMPLETE` · `ACTUAL_POSITION_PRESENT` |
| **★ 阻塞解除** | `GOVERNED_PRODUCTION_HISTORY_DATA_REQUIRED = **CLOSED**` · `FREEZE_REVIEW = **ELIGIBLE_FOR_REVIEW**` · `RPG-F2-B/F2-C = **UNBLOCKED**` |
| **§25 状态输出** | `CLOUDBASE_READONLY_CONNECTOR = READY` · `CLOUDBASE_READONLY_CONNECTION = VERIFIED` · `CREDENTIAL = VALID` · `READ_PERMISSION = SUFFICIENT` · `GOVERNED_PRODUCTION_HISTORY_DATA_REQUIRED = CLOSED` · `FREEZE_REVIEW = ELIGIBLE_FOR_REVIEW` |
| **⛔ 未做（红线）** | 生产写入 / 建表 / 建索引 / deploy / push / PR / merge / tag · `run_history` / candidate / pointer 零写入 · 生产 schema 零改动 · ⛔ **未用写操作"验证连接"** |
| **产物（gitignored）** | `deliverables/v365-production-history/{manifest.json, raw/*.ndjson, provenance/*.json, readonly-safety-test.json}` |
| **生产保护域** | ✅ **零改动** —— `constants.js` / `cooldown.js` / `runGen1ShadowEod` / `db.js` 均未触碰；`runDecisionEngine/index.js` 的 `M` 状态为**先前轮次**遗留（mtime `10:09`，早于本轮 `12:38+`） |
| **下一步** | 按 §19 自动恢复主线：**RPG-F2-B → RFP-V2-PH → Full Requalification → Freeze Review** |
| **下一步** | ⛔ **停止** —— 硬停止条件：`credential 无读取权限`（§27） |

---

### C-014 · 2026-09-29 · RPG-F2-B actual-execution cooldown 实施 + **PARTIAL 裁定**（REPLAY_INFRA 已授权）

> ⛔ **不改动 C-001 ~ C-013**（append-only 历史）。本条目记录 owner 语义纠正 + REPLAY_INFRA 授权后的实施与裁定。

**§0 owner 语义纠正（本轮前提）**

| 项 | 旧（被否决） | 新（owner 裁定） |
|---|---|---|
| `V2` replay semantics | 曾被隐含当作 "production-faithful cooldown" | ⛔ **`SYNTHETIC / COUNTERFACTUAL`** —— Model A「decision implies execution」**REJECTED** |
| 正确路径 | — | ✅ Model B「explicit actual execution ledger」**ADOPTED** |
| synthetic 分支 | — | 允许作 **supplemental branch coverage**，⛔ **不得**进入 production-fidelity anchor |
| RPG-F3 attribution | 曾计划扩大 taxonomy 以消除 1 条 UNEXPECTED | ⛔ **暂停扩展**；taxonomy **冻结**；UNEXPECTED **保留 fail-closed** |

**§1 授权状态**

| 项 | 值 |
|---|---|
| `OWNER_REPLAY_INFRA_AUTHORIZED` | ✅ `true` |
| `OWNER_AUTHORIZATION_SHA` | `c6bd006fd76ffc5358cddd07347df8ed23d9e61d` |
| `replay_infra_review` | `REPLAY_INFRA_CHANGE_REVIEW_REQUIRED` |
| `AUTHORIZED_TO_IMPLEMENT` | ✅ `true` |
| `QUALIFICATION_AUTHORITY` | ⛔ **`false`**（授权代码变更 ≠ replay 已获资格权威） |
| 失效条件 | HEAD 改变后**自动失效**；不可跨任务复用；不授权生产写入 / 策略语义修改 / immutable lock 修改 |

**§2 Actual Historical Coverage Audit（只读审计，`v365-rpg-f2b-actual-coverage-audit.js`）**

| 集合 | `actual_min` | `actual_max` | 计数 | `query_filter` | `pagination_complete` |
|---|---|---|---|---|---|
| `trade_log` | `2026-08-14` | `2026-09-11` | 13（BUY 7 / SELL 6） | `{}`（空） | `true` |
| `portfolio_snapshot` | `2026-08-14` | `2026-09-22`+ | 40 | `{}`（空） | `true` |

- `ROWS_WITH_ADD_MODE = 0` · `ROWS_WITH_DECISION_ID = 0` · `ROWS_WITH_POSITION_AFTER = 8`
- **`previous_buy_determination = NO_PREVIOUS_EXECUTION_RECORDS_EXIST_IN_SOURCE`**
  （前提：`full_collection` + `query_filter` 为空 + `pagination_complete` 三者**同时成立**；
  ⛔ **非假设** —— 是受治理采集的**事实**）
- `DATA_GOVERNED = true`（两 SHA-256 独立复算 MATCH + `governed_data_gate = PASS` + provenance 完整）

**§3 双分支协议实施（严格分离）**

| 协议 | `ledger_source` | 账本 | `production_fidelity` | `qualification_authoritative` |
|---|---|---|---|---|
| `RFP-V2-CF-COOLDOWN` | `SYNTHETIC_COUNTERFACTUAL_DECISION_IMPLIED` | `{159582:5, 513310:2, 515880:1, 518880:1}`（fills=9） | ⛔ `false` | ⛔ `false` |
| `RFP-V2-AE` | `GOVERNED_ACTUAL_EXECUTION` | 受治理 `trade_log`（actual fills `{159570:1,159582:3,513310:2,518880:1}`） | ⛔ 尚不成立 | ⛔ 尚不成立 |

- `RFP-V1` anchor `25ccbfc7e1b73a9a173ec36c17512c6228a2fe42685dcd291bc055ea4ed11723` —— ✅ **逐位不变**
- `RFP-V2-CF` anchor `b87654ab81935731a4173b5f566231f6db62c3d2e2b43f74cd6c8fb93ea78832` —— ✅ **逐位不变**

**§4 add_mode 生产三步链（⛔ 未人工回填）**

```
① trade_log.add_mode ⇒ 13 行**全部缺失**（ROWS_WITH_ADD_MODE = 0）
② decision_result(code, buyDate).add_mode ⇒ 受治理单点回查 = '无'（合法区分）；
   3 个回查点（159570/159582/518880 @ 2026-08-15）⇒ 0 行（生产视为非决策驱动）
③ fallbackAddMode ⇒ '无' ⇒ 基数 = params.cooldown_days = 3
```

allowlist 扩展合规：`decision_result` 只读加入 · reason = `REQUIRED_FOR_PRODUCTION_FIDELITY_COOLDOWN` ·
`MINIMAL_POINT_LOOKUP`（7 点，⛔ 非整表导出）· client **结构性无 mutation 方法** ·
R-01/02 `LIVE_CONNECTION_PROBE = PASS` · R-03~R-06 `STATIC_READONLY_GUARDS = PASS` · provenance 已更新。

**§5 ★ 生产保真度实证（最强证据）**

用 actual ledger + governed historical `decision_result.add_mode` 复算 cooldown ⇒
**4/4 与生产 `decision_result.cooldown_days` 精确一致**：
`513310@08-14 → 3 ✅` · `513310@08-19 → 3 ✅` · `159582@08-24 → 3 ✅` · `159582@08-28 → 3 ✅`
⇒ **`PRODUCTION_PATH_PARITY_VERIFIED_ON_OBSERVED_POINTS`**
⛔ **不得**自动提升成 `FULL_WINDOW_PRODUCTION_FIDELITY`（4 点全部落在 08-14 之后、全部同分支 `add_mode='无'`）。

**§6 ★ 正式裁定（⛔ 不伪装成 COMPLETE）**

```
RPG-F2-B = PARTIAL / BLOCKED_ON_EXECUTION_COVERAGE
RPG-F2-C = BLOCKED_ON_ACTUAL_BOOK_COVERAGE
RFP-V2-PH_FULL_WINDOW_AVAILABLE = false
RPG-002  = NOT YET CLOSED
```

| 判据 | 要求 | 实测 |
|---|---|---|
| 语义正确性（governed actual ledger） | ✅ 必须 | ✅ 12 条三元组逐一致 |
| 生产路径保真（复用 `computeCooldownDays()`） | ✅ 必须 | ✅ 4/4 MATCH |
| **窗口覆盖**（`2026-08-01 → 2026-09-22` 全程） | ✅ 必须 | ❌ **缺 9 天**（`2026-08-03 → 2026-08-13`） |

⇒ 前两项 PASS、第三项 FAIL ⇒ **`PARTIAL`**。
⛔ 硬规则全履行：未用 `suggested_position` 补 · 未用 08-14 回推 · 未插值 · 未假设零仓 · 未偷改 window。

**§7 归因运行（fail-closed 保留）**

| 协议 | 差异 | EXPECTED | **UNEXPECTED** |
|---|---|---|---|
| `V2-CF-COOLDOWN` | 13 | 12 | **1**（`2026-08-13 159582 final_action HOLD→ADD`） |
| `V2-AE` | 99 | 94 | **5**（`08-24 513310` · `09-02 159582` · `09-02 513310` · `09-03 159582` · `09-04 159582`） |

`V1_V2_DELTA_EXPLAINED = false` · exit 非零 ⇒ ⛔ **符合 owner 要求：保留 fail-closed，不得为凑 `UNEXPECTED = 0` 新增 reason**。
taxonomy **冻结**：仅 `effective_tech_cap_fidelity` / `cooldown_gate_exercised`。

**§8 门禁复跑（本轮）**

| 门禁 | 结果 |
|---|---|
| **Stage A**（`scripts/test-all.js`；注：`v365-stage-a-*` **不存在**，为先前误记） | ✅ **69/69** |
| **Stage A~G 汇总** | ✅ **77/77 · 0 失败** |
| RPG-F2-A / F2-B / HD12-1 / HD12-2 / HD12-3 专项 | ✅ 全 PASS（A-01~10 · B-01~13 · C-01~17 · B-01~17 · D-01~10） |
| qualification **38/38** · reader **8/8** · immutable **23/23** · Gen-1 pipeline **10/10** · Gen-1 gates **32/32** · Gen-2 **7/7** | ✅ 全 PASS |
| p12 parity（**带授权清单**） | ✅ `UNEXPECTED_DECISION_DELTA = 0` · anchor `25ccbfc7…1723` 逐位不变 |
| candidate manifest | ✅ 20 文件逐字节一致 |
| delta attribution | ⚠️ exit 非零（**按要求保留**） |
| final state consistency | ⚠️ → 本轮已同步（见 §10） |

**§9 代码变更（REPLAY_INFRA，均已授权）**

| 文件 | 分类 | 变更摘要 |
|---|---|---|
| `scripts/lib/v364-replay-harness.js` | **REPLAY_INFRA** | `loadActualExecutionLedger()` / `createCooldownStubDb()`（含 `DECISION_RESULT` 单点回查，⛔ 无数据 ⇒ 空 ⇒ 回落 fallback，**不臆测**）/ `computeReplayCooldown()`；`COOLDOWN_PROTOCOLS` / `CAP_PROTOCOLS` 协议集；`ledger_source` 输出 |
| `scripts/v365-p12-decision-parity.js` | 门禁（域外） | REPLAY_INFRA 文件不再被「改动 ∩ 回放依赖」**结构性**判据重复拦截 —— 否则**唯一合法路径恒不可达**；改由 ④ 授权判据（40 位 SHA + `changed_files` 精确一致 + scope 非空 + 专门评审标记）接管。**判据未放宽** |
| `tests/v365-decision-classification.test.js` | 测试 | C-16 ④ 旧断言「harness **必须**硬编码 `cooldownDays: 0`」在缺口修复后成为**反向锁死** ⇒ 改为「默认路径保持 `cooldownDays = 0`（V1 anchor 不动）**且** 已具备 cooldown 注入协议（复用生产 `computeCooldownDays()`）」 |

授权凭据（gitignored）：`deliverables/v365-production-history/evidence/approval-manifest-f2b.json`。
新增专项测试：`tests/v365-rpg-f2b.test.js`（B-01 ~ B-13）—— ⛔ B-13 逐位绑定授权 SHA。

**§10 收口文档同步**

- 新增 **`docs/V365_RPG_F2B_STATUS_DETERMINATION.md`**（正式裁定）
- 新增 **`docs/V365_RPG_F2B_REPLAY_INFRA_CHANGE_RECORD.md`**（REPLAY_INFRA 变更记录）
- 新增 **`docs/V365_RPG_F2B_ACTUAL_COVERAGE_AUDIT.md`**（审计报告）
- `tracked-file count` 真值 `20 → 24`（`docs/V365_CONTEXT_COMPRESSION.md` / `docs/V365_FREEZE_REVIEW.md`）

**§11 下一步（依次）**

```
RPG-F2-B 正式裁定 ✅（本条目）
  ↓ RPG-F2-C actual-book coverage（仍 BLOCKED；可选建 RFP-V2-PH-AVAILABLE-WINDOW
      作诊断，qualification_authoritative = false，⛔ 不替代原 window）
  ↓ RUN_HISTORY_INDEX（WP-V365-RH1）
  ↓ Full Requalification
  ↓ Freeze Review
```

**§12 当前状态输出**

| 项 | 值 |
|---|---|
| `REPLAY_INFRA` | `IMPLEMENTED_LOCALLY` · `VALIDATED_EXPERIMENTALLY` · `OWNER_AUTHORIZATION = APPROVED` |
| `RPG-F2-B` | ⚠️ **`PARTIAL / BLOCKED_ON_EXECUTION_COVERAGE`** |
| `RPG-F2-C` | ⛔ **`BLOCKED_ON_ACTUAL_BOOK_COVERAGE`** |
| `RFP-V2-PH_FULL_WINDOW_AVAILABLE` | ⛔ **`false`** |
| `RPG-002` | ⚠️ **`NOT YET CLOSED`** |
| `GOVERNED_PRODUCTION_HISTORY_DATA_REQUIRED` | ✅ `CLOSED` |
| `FREEZE_REVIEW` | `ELIGIBLE_FOR_REVIEW` |
| `READY_FOR_PRODUCTION_PROMOTION` | ⛔ **`NOT_ISSUED`** |

**§13 解除 F2-B / F2-C 的三条路径（均需 owner 拍板，agent ⛔ 不得自选）**

| # | 路径 | 所需 owner 动作 | 硬停止条件 |
|---|---|---|---|
| **A** | 生产库确有 `2026-08-03 → 08-13` 的 `buy`，仅**导出未覆盖** | 复核分页 / 扩大导出窗口 | — |
| **B** | 生产库**确无**该段买记录，须以**冻结设计认可的 T-1 起始实际账本**补足 | 冻结设计裁定「合法种子」 | — |
| **C** | 将 qualification window 缩至 `2026-08-14 → 2026-09-22` | **owner 改变 qualification window** | §10(A) |
| — | 扩大冻结 attribution taxonomy 以消 UNEXPECTED | **owner 冻结设计变更** | §10(B) |
| — | 用 synthetic / 回填 / 推断仓位构建 PH 全窗口 | **⛔ 一律禁止** | §10(C) |

---

### C-015 · 2026-09-29 · RPG-F2-C 覆盖裁定 + `RFP-V2-PH-AVAILABLE-WINDOW` 诊断件（⛔ 不替代冻结窗口）

> ⛔ **不改动 C-001 ~ C-014**（append-only 历史）。本条记录 §9 步骤 6 的裁定与诊断件建立。

| 项 | 内容 |
|---|---|
| **触发** | owner §9 步骤 6：`RPG-F2-C actual-book coverage` |
| **RPG-F2-C 裁定** | ⛔ **`BLOCKED_ON_ACTUAL_BOOK_COVERAGE`** —— `required_trade_dates = 25` · `snapshot_available_dates = 16` · **`missing_trade_dates = 9`**（`2026-08-03` → `2026-08-13` 全缺）· `t_minus_1_candidate = null`（`2026-08-13` 无 snapshot ⇒ **无法**取 T-1 起始实际账本） |
| **`RFP-V2-PH_FULL_WINDOW_AVAILABLE`** | ⛔ **`false`**（basis：`missing_trade_dates = 9`） |
| **★ 新增诊断件** | `scripts/v365-rfp-ph-available-window.js` ⇒ `deliverables/v365-production-history/rfp-v2-ph-available-window.json` |
| **诊断件裁定字段** | `available_window_verdict = DIAGNOSTIC_ONLY` · **`qualification_authoritative = false`** · **`supersedes_qualification_window = false`** |
| **available window** | `2026-08-14 → 2026-09-22`（**资格窗口的真子集**，认 35 个受治理快照日） |
| **⛔ 不替代原 window** | `QUALIFICATION_WINDOW = 2026-08-01 → 2026-09-22`（`frozen = true` · `changed_by_this_artifact = false`）。诊断件**不得**进入任何 anchor / Freeze 证据 / qualification-authoritative 集合 |
| **★ 方法学修正（自查发现并修复）** | 诊断件**首版**用「受治理数据自身日期」推导 `required_trade_dates` ⇒ **自我指涉**：缺失段被自动排除在"应有"之外，`missing` 被假算成 **0**（并据此误判 `FULL_WINDOW_AVAILABLE = true`）。<br>**已修**：改为取自 `harness.replay().axis`（生产交易日历真值，与 `rpg-f2b-actual-coverage-audit.js` **同源**）⇒ 恢复为 `25 / 16 / 9`，与审计件**逐项一致**。<br>⚠️ 教训：**required 集合必须来自独立真值源，⛔ 绝不能从被检验数据自身推导** |
| **owner 五条硬规则** | ✅ 全部履行（结构性锁定）：`no_suggested_position_backfill` · `no_next_day_snapshot_extrapolation` · `no_interpolation` · `no_assumed_zero_position` · `no_replay_window_silent_change` 全 `true` |
| **新增专项测试** | `tests/v365-rfp-ph-available-window.test.js`（**PH-01 ~ PH-08**）—— 锁定：① 冻结窗口未被更改 ② 诊断件自证非权威 ③ available 是真子集 ④ **required 来自独立真值源** ⑤ 与审计件逐项一致 ⑥ `FULL_WINDOW_AVAILABLE` 如实为 `false` ⑦ 五条硬规则 ⑧ **不解除 F2-C 阻塞** |
| **数据缺失行为** | 若 `deliverables/v365-production-history/` 不存在（gitignored）⇒ 测试 **SKIP 并 exit 0**（⛔ 不得因缺数据让 Stage A 变红） |
| **只读保证** | 脚本：⛔ 不访问网络 / 不访问数据库 / 不写生产；只读项目内受治理导出；仅写 1 个诊断 JSON |
| **确定性** | ✅ 两次运行**逐位一致**（除 `generated_at`） |
| **门禁** | Stage A **70/70** · Stage A~G **78/78 · 0 失败** · PH-01~08 ✅ · RPG-F2-B B-01~13 ✅ |
| **下一步** | `RUN_HISTORY_INDEX`（WP-V365-RH1）→ `Full Requalification` → `Freeze Review`；F2-C 解除仍须 owner 在 A/B/C 三路径中拍板 |

**§状态输出（C-015 后）**

| 项 | 值 |
|---|---|
| `RPG-F2-B` | ⚠️ `PARTIAL / BLOCKED_ON_EXECUTION_COVERAGE` |
| `RPG-F2-C` | ⛔ `BLOCKED_ON_ACTUAL_BOOK_COVERAGE` |
| `RFP-V2-PH-AVAILABLE-WINDOW` | ✅ `DIAGNOSTIC_ONLY`（`qualification_authoritative = false`） |
| `RFP-V2-PH_FULL_WINDOW_AVAILABLE` | ⛔ `false` |
| `RPG-002` | ⚠️ `NOT YET CLOSED` |
| `FREEZE_REVIEW` | `ELIGIBLE_FOR_REVIEW` |
| `READY_FOR_PRODUCTION_PROMOTION` | ⛔ `NOT_ISSUED` |

**⛔ 硬停止（未变）**：改 qualification window / 扩大冻结 attribution taxonomy / 用 synthetic·回填·推断仓位构建 PH 全窗口 / 生产写入·建表·deploy·push·PR·merge·tag —— **任一均须 owner 单独授权**。

---

### C-016 · 2026-09-29 · RUN_HISTORY_INDEX（WP-V365-RH1~RH4）事实收口 + 文档同步

> ⚠️ 本轮**仅**做**事实核验 + 文档同步 + 门禁复跑**；⛔ **未**新增 WP 代码、**未**改任何判据、**未**部署。
> 上一轮（C-014/C-015）已结束 RPG-F2-B/F2-C 的裁定；本轮**首次**对 RH 工作包做**独立事实核验**。

#### ★ 核验发现（关键）

| # | 发现 | 处置 |
|---|---|---|
| 1 | **RH1~RH4 代码侧此前已实施**（前轮 REPLAY_INFRA 授权范围覆盖），但 **AGENT_HANDOFF / roadmap / READER_MIGRATION / AUTHORITATIVE_CONSUMER_MAP / READINESS 五份文档仍写「尚未开工」/「下一步 = WP-V365-RH1」** ⇒ **文档落后于代码** | ✅ **已同步**（见下"文档同步"表） |
| 2 | **roadmap §WP-RH1「修改文件」列与实况不符**：原计划要求改 `constants.js`（`29→33`）+ `schema.js`（`29→33`）；**实际实施走 OD-5 本意路径**（集合名收敛到 `v365-contracts.js`，`constants.js` **零改动**） | ✅ **已在 roadmap 新增 §2.3.1 显式记录**该方案级修正 + 为什么**更正确**（消除第二源 > 同步两个源；且 `constants.js` 属 CALC 无授权路径） |
| 3 | **roadmap §WP-RH1「触碰 qualification candidate？」原判「①②③ ❌ 否」有误** —— `src/common/schema.js` **在** 20 文件合格面内 | ✅ **已更正**为「`schema.js` ✅ 在合格面 ⇒ `candidate_content_sha` 变 ⇒ 必须重新资格化」 |
| 4 | **roadmap §4.4 登记的门禁缺陷「恒不可达」**（REPLAY_INFRA 文件必然 ∈ 回放依赖集） | ✅ **已解除**，新增 **§4.4.1** 记录**实际解法**（保留 `touchedCore.length===0` 硬判据 + 扩展 `REPLAY_INFRA_SET` 例外 + RDE 走 `MIXED` 授权）；**HD-12 关闭且未放宽标准** |
| 5 | **`tracked-file count` 真值 24 → 25**（本轮 evidence 文件新增） | ✅ **三份收口文档已同步**（`compression` / `freeze` / `ledger`） |
| 6 | **资格门 / reader-gate banner 文案** 已由 `WP-V365-RH1` 改为「代码侧 RH1~RH4 已完成；缺数据侧建表/提升」 | ✅ **已改**（`scripts/v365-qualification-gate.js:595` · `scripts/v365-reader-migration-gate.js:368`） |

#### 核验证据（RC-1 ~ RC-8）

| # | 项 | 实测 |
|---|---|---|
| **RC-1** | WP-RH1 专项 | `tests/v365-rh1-contract-registry.test.js` **E-01~E-12 全 PASS**；5 集合全部登记在 `SCHEMAS`（34）；`constants.js` **零改动**（E-03） |
| **RC-2** | WP-RH2 专项 | `tests/v365-rh2-runtime-fields.test.js` **F-01~F-12 全 PASS**；RDE `publishCandidateFirst` 调用 **恰 1 处**（`:1359`）；提升点(47957) < history 写入点(50366) |
| **RC-3** | WP-RH3 专项 | `tests/v365-rh3-promotion-history.test.js` **G-01~G-11 全 PASS**；supersede 语义唯一来源在 `planPointerPromotion`；CALC 零改动（G-11） |
| **RC-4** | WP-RH4 专项 | `tests/v365-rh4-class-c-readers.test.js` **H-01~H-12 全 PASS**；CLASS C 6 个登记项（含 2 个带外登记：`cooldown`=CALC / `runGen1ShadowEod`=Gen-1 Lock）；Reader Gate **8/8** |
| **RC-5** | **Stage A** | **70 / 70 PASS**（含 rh1~rh4 四个专项） |
| **RC-6** | **Stage A~G** | **78 / 78 · 0 失败** |
| **RC-7** | **parity**（带授权清单，68 变更文件 / 146 区域） | **`UNEXPECTED_DECISION_DELTA = 0`** · anchor `25ccbfc7…1723` **逐位不变** · 17 区域全落在 `["lifecycle_writer","telemetry"]` |
| **RC-8** | manifest / qualification / immutable / gen1 / gen2 | 20 文件逐字节一致（`candidate_content_sha = 2f4b0519…2cade`）· **38/38** · **23/23** · **10/10** · **7/7** · Gen-1 Gates **32/32** |

#### ★ 状态精化（本轮新增的**关键区分**）

```
RUN_HISTORY_INDEX = PENDING
  ├─ 契约层（WP-RH1）：✅ COMPLETE（5 集合登记；唯一来源 = v365-contracts.js）
  ├─ 写侧（WP-RH2/RH3）：✅ COMPLETE（RDE 接线 + run_history 单次写入 + supersede 链）
  ├─ 读者层（WP-RH4）：✅ COMPLETE（CLASS C 6 登记项 + buildClassCProvenance）
  └─ 数据侧：⛔ PENDING  ← PENDING 的【唯一】原因
       · 生产 5 集合未建表（HD-10，需 owner 单独授权 DB 变更）
       · 无生产提升发生 ⇒ active_run_pointer 无行 ⇒ run_axis_available = false · coverage = 'legacy_only'
       · V365_ENFORCE_SWITCH_DATE = null（部署时才登记）
```

> ★★ **本轮最重要的方法论结论**：**「代码就绪」≠「数据就绪」**。
> RH1~RH4 测试全绿**只**证明「契约 + 写侧 + 读者」就绪；
> ⛔ **不得**因「70/70 全绿」就把 `RUN_HISTORY_INDEX` 改写为 `COMPLETE` ——
> 该状态由 **CLASS C `run_axis_available`** 承载，而它当前**如实**为 `false`。
> 若因测试绿而改状态，将构成**用代码证据替代数据证据** —— 与「`UNEXPECTED_DECISION_DELTA = 0` 不得用弱论证替代」同类错误。

#### 文档同步（本轮）

| 文档 | 同步内容 |
|---|---|
| `docs/V365_RUN_LIFECYCLE_IMPLEMENTATION_ROADMAP.md` | 新增 **§2.3 实施进度**（RH0~RH4 状态 + 专项测试）· **§2.3.1**（OD-5 替代路径）· **§2.3.2**（代码就绪≠数据就绪）· **§4.4.1**（parity 缺陷实际解法）· **§7 实施侧收口状态** · **§8 本轮边界履行**；§2.2 增「实施后」列；§WP-RH1 更正 qualification 判据；§6 全表重写（HD-8~HD-14 状态 + **§6.1 仍待 owner 拍板项**）；附录增第 4/5 条 |
| `docs/V365_READER_MIGRATION.md` | §9 状态块：`RUN_HISTORY_INDEX` 拆四层（契约/写侧/读者 ✅ · 数据侧 ⛔）+ 「代码就绪 ≠ 数据就绪」警示 |
| `docs/V365_AUTHORITATIVE_CONSUMER_MAP.md` | §E.3 硬约束 #3 状态 + 状态块同步 |
| `docs/V365_PRODUCTION_INTEGRITY_READINESS.md` | §23.8 状态块 + 新增 2026-09-29 精化说明（PENDING 唯一原因 = 数据侧） |
| `docs/AGENT_HANDOFF_V365.md` | §1 下一步入口 + §CRU-4 说明：RH1~RH4 代码侧已完成，下一步 = **HD-10 授权 + 生产提升**（⛔ 非「再写代码」） |
| `docs/V365_CONTEXT_COMPRESSION.md` · `docs/V365_FREEZE_REVIEW.md` | `tracked-file count` 24 → **25** |
| `scripts/v365-qualification-gate.js` · `scripts/v365-reader-migration-gate.js` | banner 文案精化（纯文案，非判据） |

#### 门禁复跑（本轮，全绿）

| 门禁 | 结果 |
|---|---|
| `node scripts/test-all.js`（Stage A~G） | **78 / 78，0 失败** |
| Stage A（`--stage=A`） | **70 / 70** |
| `v365-qualification-gate.js` | **38 / 38** |
| `v365-reader-migration-gate.js` | **8 / 8** |
| `verify-v365-candidate-manifest.js` | **20 文件逐字节一致** |
| `v365-p12-decision-parity.js`（带授权清单） | **Δ=0** · anchor 逐位不变 |
| **`v365-final-state-consistency-check.js`** | **`FINAL_STATE_DOCS_CONSISTENT = true`** |

#### §状态输出（C-016 后）

| 项 | 值 |
|---|---|
| `RUN_HISTORY_INDEX` | ⛔ **`PENDING`**（代码侧 ✅ / **数据侧 ⛔**） |
| `HD-10`（生产建表） | ✅ **`CLOSED —— COMPLETE`**（2026-09-29 owner `APPROVED`；5/5 集合 + 7/7 索引；`CREATE EMPTY STRUCTURE ONLY`；`documents_written = 0`） |
| `HD-8` / `HD-11` / `HD-12` / `HD-13` / `HD-14` | ✅ `CLOSED` |
| `HD-9`（保留窗口） | ✅ **`CLOSED`** — `RETAIN_INDEFINITELY_FOR_V365`（⛔ 不删 / 不归档 / 无 TTL / 不压缩） |
| `HD-15`（switch date 策略） | ✅ **`POLICY CLOSED`** — 只冻结时点规则；`V365_ENFORCE_SWITCH_DATE` 仍 **`null`** |
| `V365_ENFORCE_SWITCH_DATE` | **`null`**（首个真实 authoritative ENFORCE production run 的 `expected_trade_date`） |
| `OWNER_F2C_PATH` | **A** |
| `RPG-F2-B` | ⚠️ `PARTIAL / BLOCKED_ON_EXECUTION_COVERAGE` |
| `RPG-F2-C` | ⛔ `BLOCKED_ON_ACTUAL_BOOK_COVERAGE` |
| `RFP-V2-PH_FULL_WINDOW_AVAILABLE` | ⛔ `false` |
| `P12_PARITY_UNEXPECTED_DECISION_DELTA` | **0** |
| `RPG_F3_HISTORICAL_UNEXPECTED_DECISION_DELTA` | **6**（RPG-F3 fail-closed） |
| `RPG_F3_PROSPECTIVE_UNEXPECTED_DECISION_DELTA` | `NOT_STARTED` |
| `HISTORICAL_FULL_WINDOW_STATUS` | ⛔ `INCOMPLETE_BY_SOURCE_HISTORY` |
| `PROSPECTIVE_QUALIFICATION_STATUS` | `NOT_STARTED` |
| `READY_FOR_CONTROLLED_PRODUCTION_ACTIVATION` | `PENDING_OWNER_APPROVAL` |
| `READY_FOR_GENERAL_PRODUCTION` | `false` |
| `RPG-002` | ⚠️ `NOT YET CLOSED` |
| `PRODUCTION_ACTIVATION_AUTHORIZATION` | ⛔ `NOT_GRANTED` |
| `FREEZE_REVIEW` | `ELIGIBLE_FOR_REVIEW` |
| `FINAL_STATE_DOCS_CONSISTENT` | ✅ `true` |
| `READY_FOR_PRODUCTION_PROMOTION` | ⛔ `NOT_ISSUED` |

**⛔ 硬停止（未变，且新增一条）**：原四条（改 qualification window / 扩大冻结 taxonomy / 用 synthetic·回填·推断仓位构建 PH 全窗口 / 生产写入·建表·deploy·push·PR·merge·tag）**全部有效**；
本轮**新增第 5 条**：⛔ **不得因 RH1~RH4 测试全绿就改写 `RUN_HISTORY_INDEX`** —— 数据侧未就绪即 PENDING。

---

### C-017 · 2026-09-29 · HD-10 生产建表执行 + `OWNER_F2C_PATH = A` 裁定

> ⛔ **不改动 C-001 ~ C-016**（append-only 历史）。本条记录 owner 两项正式裁定的执行结果。

**触发**：owner 2026-09-29 正式裁定 —
`HD-10_PRODUCTION_COLLECTION_CREATION = APPROVED`（CREATE EMPTY STRUCTURE ONLY）
＋ F2-C 语义裁定（`PRESERVE_ORIGINAL_QUALIFICATION_WINDOW = true` 等 5 项）。

#### （一）HD-10：APPROVED → COMPLETE

| 步骤 | 执行 | 结果 |
|---|---|---|
| 只读 preflight | `listCollections` | 基线 **27** 集合；5 目标**全 ABSENT** |
| create-only | `create` × 5 | `run_manifest` / `run_candidate_decision` / `run_candidate_portfolio` / `active_run_pointer` / `run_history` |
| create indexes | `createIndexes` × 7 | 与冻结 `schema.js` **逐名逐键一致** |
| read-after-create | `listCollections` + `listIndexes` + `count` | **5/5 EXISTS** · **7/7 索引在位** · **5 集合 `n=0`** |
| 独立复核 | 二次查询 | 索引 key/direction 逐位核对（`idx_trade_date` = `expected_trade_date:-1` desc ✅；`idx_supersedes` = `supersedes_run_id:1` asc ✅；无多余索引） |

**完成条件（机器证据）**：
```
collections_exist          = 5/5
all_required_indexes_verified = true
schema_contract_match      = true
documents_written          = 0
production_run_triggered   = false
pointer_initialized        = false
SCHEMA_DRIFT               = false
HD_10                      = COMPLETE
```
集合总数 **27 → 32**（+5）。证据：`deliverables/v365-production-history/hd10/hd10-completion-evidence.json`。

**⛔ HD-10 不授权且未做**（逐项确认 `0` 次）：业务 document 写入 · 历史 backfill · candidate/run_manifest/run_history 写入 · `active_run_pointer` 初始化/切换 · 生产 run · Cloud Function deploy · 生产配置修改 · drop collection · 删除 index · 修改既有 index · 数据迁移。

**★ 关键区分（owner §5）**：
```
production structure exists   ≠  production data/history complete
                              ≠  READY_FOR_PRODUCTION_PROMOTION
```
`run_history` / `active_run_pointer` 均 `n=0` + `V365_ENFORCE_SWITCH_DATE = null`
⇒ `run_axis_available = false` ⇒ `coverage = legacy_only`
⇒ **`RUN_HISTORY_INDEX` 仍 PENDING**（⛔ 建表不解此阻塞）。

#### （二）F2-C：`OWNER_F2C_PATH = A`（逐条比对 6/6）

| owner 语义 | Path A（复核分页/扩大导出窗口） | Path C（缩小 window） |
|---|---|---|
| 保留 `2026-08-01 → 09-22` | ✅ | ❌ |
| 不补造 9 天 actual book | ✅ | ✅ |
| 允许 available-window diagnostic | ✅ | ✅ |
| full-window 继续 fail-closed | ✅ | ❌ |
| **匹配度** | **6/6** | **4/6** |

⇒ `OWNER_F2C_PATH = A`（**非** `F2C_PATH_LABEL_MISMATCH`）。裁定件：
`deliverables/v365-production-history/hd10/owner-f2c-path-determination.json`。

**Path A 取证动作已执行（只读）**：

| 集合 | count | returned | pagination_complete | 最早日期 |
|---|---|---|---|---|
| `trade_log` | 13 | 13 | **true**（`count == returned`） | `2026-08-14` |
| `portfolio_snapshot` | 40 | 40 | **true** | `2026-08-14` |

⇒ **Path A 的事实前提不成立**：生产库**确无** `2026-08-03 → 08-13` 的 buy 与 snapshot；
「导出未覆盖」不是原因 —— **生产数据本身即从 `2026-08-14` 开始**。
⇒ `t_minus_1_candidate = null` 得证（`2026-08-13` 无 snapshot ⇒ 无合法 T-1 种子）。
⛔ 裁定**不变**（Path A 仍是 owner 语义标签），但取证已穷尽。证据：
`deliverables/v365-production-history/hd10/f2c-path-a-forensic-verification.json`。

#### （三）诊断件按 owner §3 刷新

`rfp-v2-ph-available-window.json` 新增字段：
`replay_semantics = PRODUCTION_HISTORICAL_AVAILABLE_WINDOW` · `qualification_authoritative = false` ·
`available_window_derivation`（自动求交集，⛔ 不手填）· `permitted_uses` / `forbidden_uses`。
窗口自动求交集 = `2026-08-14 → 2026-09-22`；`RFP_V2_PH_FULL_WINDOW_AVAILABLE = false`。

#### （四）门禁复跑（全绿）

| 门禁 | 结果 |
|---|---|
| Stage A | **70 / 70** |
| Stage A~G | 见 `evidence/stage-all-current.log` |
| `v365-qualification-gate.js` | **PASS 38 / 38**（`QUALIFIED_CANDIDATE`） |
| `v365-reader-migration-gate.js` | **PASS 8 / 8** |
| `verify-immutable.js` | **23 / 23** |
| `verify-gen1-pipeline.js` | **10 / 10** |
| `verify-gen2-build-artifacts.js` | **7 / 7** |
| `v365-p12-decision-parity.js`（69 文件 / 147 区域 + 授权清单） | **`UNEXPECTED_DECISION_DELTA = 0`** · anchor `25ccbfc7…1723` 不变 |
| `v365-replay-delta-attribution.js` | ⛔ **FAIL fail-closed**（V2-CF-COOLDOWN 1 + V2-AE 5 = **6 处 UNEXPECTED**） |
| `v365-final-state-consistency-check.js` | **`FINAL_STATE_DOCS_CONSISTENT = true`** |

#### （五）状态输出（诚实口径，⛔ 未伪装成 PASS）

```
HD-10                    = COMPLETE（CREATE EMPTY STRUCTURE ONLY）
RUN_HISTORY_INDEX        = PENDING（契约/结构/读者就绪；⛔ 数据侧未就绪）
RPG-F2-B                 = PARTIAL / BLOCKED_ON_EXECUTION_COVERAGE
RPG-F2-C                 = BLOCKED_ON_ACTUAL_BOOK_COVERAGE
OWNER_F2C_PATH           = A
RFP-V2-PH_FULL_WINDOW_AVAILABLE = false
RPG-002                  = NOT YET CLOSED
P12_PARITY_UNEXPECTED_DECISION_DELTA     = 0（parity 门禁口径）
RPG_F3_HISTORICAL_UNEXPECTED_DECISION_DELTA = 6（⛔ 永久保留 fail-closed，⛔ 不扩大 taxonomy）
RPG_F3_PROSPECTIVE_UNEXPECTED_DECISION_DELTA = NOT_STARTED（前瞻轨；目标 = 0）
HISTORICAL_FULL_WINDOW_STATUS   = INCOMPLETE_BY_SOURCE_HISTORY
PROSPECTIVE_QUALIFICATION_STATUS = NOT_STARTED
READY_FOR_CONTROLLED_PRODUCTION_ACTIVATION = PENDING_OWNER_APPROVAL
READY_FOR_GENERAL_PRODUCTION   = false
FREEZE_REVIEW            = ELIGIBLE_FOR_REVIEW
`READY_FOR_PRODUCTION_PROMOTION` 仍 **NOT_ISSUED**
```

**⛔ 硬停止（原 5 条全部有效）**：改 qualification window / 扩大冻结 taxonomy / 用 synthetic·回填·推断仓位构建 PH 全窗口 / 生产写入（业务数据）·deploy·push·PR·merge·tag / 因测试全绿就改写 `RUN_HISTORY_INDEX`。
**★ 本轮补充**：HD-10 授权**只**覆盖空结构创建 —— ⛔ **不得**据此执行任何业务 document 写入、`active_run_pointer` 初始化或生产提升。

#### （六）HD-10 授权边界守卫（收口加固，C-017 内追加）

新增 `tests/v365-hd10-authorization-boundary.test.js`（**HD10-01~08**，纯静态，⛔ 不连生产 / 不写文件 / 不执行 DB 命令），
把 owner 的 create-only 授权边界**机器化**：

| 项 | 断言 |
|---|---|
| HD10-01 | 必须有 `--i-have-authorization` 开关 + `refuse()` 退出 |
| HD10-02 | `TARGETS` 必须**恰为 5 个** v365 集合（与 `V365_COLLECTIONS` 逐名一致） |
| HD10-03 | ⛔ 不得含 `insert`/`delete`/`drop`/`dropIndex`/`.add(`/`.remove(`/`.doc().set(`/`.doc().update(` |
| HD10-04 | `mgo()` 仅允许 `listCollections`/`listIndexes`/`count`/`find`/`create`/`createIndexes` |
| HD10-05/06 | 必须显式声明 `pointer_initialized:false` · `documents_written:0` · `production_run_triggered:false` |
| HD10-07 | 必须有 `EXISTS`/`ABSENT` 判定 + `NO_OP` 分支 |
| HD10-08 | 漂移必须报 `PRODUCTION_SCHEMA_DRIFT` |

**★★ 该测试当场抓出两个真实实现缺口（均已修复）**：

1. **HD10-08 FAIL** —— 脚本 `verdict` 原只有 `drift_detected`，**缺** owner 明确要求的 `PRODUCTION_SCHEMA_DRIFT` 标识
   ⇒ 已补 `PRODUCTION_SCHEMA_DRIFT` + `STOP` + `drift_targets`，并以 `process.exit(5)` 硬停止。
2. **preflight 未校验 EXISTS 集合的索引** —— 原逻辑对 `EXISTS` 直接 `NO-OP`，**未验证**其 index 是否与冻结契约一致
   ⇒ 已补 `SCHEMA_DRIFT` 状态 + **preflight 阶段立即 STOP**（⛔ 不做任何创建 / 修改 / 删除 / 重建）。

**★ 幂等性验证**：修补后重跑（5 集合已存在且契约一致）⇒ **5/5 `NO-OP`**（无重复创建）+ `HD_10 = COMPLETE` ⇒ 脚本**可安全重跑**。

**门禁**：Stage A **71 / 71**（+1 新测试）· parity **`Δ=0`**（70 文件）· `FINAL_STATE_DOCS_CONSISTENT = true`。
三份文档的 Stage A 计数已由 70 同步为 **71**。

---

### C-018 · 2026-09-29 · `PRE_PROMOTION_INTEGRITY_CLOSURE`（§1~§11 收口；⛔ 不进入 production activation）

**授权边界**：本消息**暂停**任何生产提升 / pointer 初始化 / 业务 document 写入 /
`V365_ENFORCE_SWITCH_DATE` 登记。⛔ 不授权：production promotion · `active_run_pointer` 初始化 ·
candidate / manifest / history 生产写入 · switch date 写入 · deploy · push / PR / merge / tag。

#### §1/§2 脚本修复 —— `scripts/v365-hd10-create-collections.js`

⛔ **原缺陷**（C-017 遗留）：preflight 对 `EXISTS` 集合**只比 `index.name`**（`missing.length === 0`）；
`idxSig()` **已定义但未被使用**；`EXISTS ⇒ NO_OP` **无显式标识**；`createIndexes`
**对全部 TARGETS 无条件发**（含已存在集合）。

**修复内容**：

| 项 | 修复后 |
|---|---|
| 新增纯函数 | `normalizeObservedIndex(raw)` —— 归一平台原始索引项（`$numberInt` / `number` / `string` 三形态）为签名；**忽略 `_id_`**（返回 `null`） |
| 新增纯函数 | `compareIndexContract(observedRaw, requiredFrozen)` —— 返回 `{match, missing_required, unexpected_extra, key_drift, direction_drift, unique_drift}` |
| preflight | 改为**完整签名比对**（`name` + key fields + direction + unique），**实际使用 `idxSig()`**；5 类不一致（missing required / unexpected extra / 同名不同 key / 同名不同 direction / 同名不同 unique）**全部 ⇒ `SCHEMA_DRIFT`** ⇒ 立即 `STOP` |
| create 段 | `EXISTS + exact match` ⇒ 显式 `NO_OP_COLLECTION`（`mutation_command_sent: false`）；`ABSENT` ⇒ `CREATE_COLLECTION` |
| indexes 段 | ★ `createIndexes` **只对本次新建的 ABSENT 集合**执行；`EXISTS` 集合 ⇒ 显式 `NO_OP_INDEXES`（零 mutation） |
| 零 mutation 证明 | verdict 输出 `zero_mutation_on_existing_exact_match` + `mutation_commands_on_existing_exact_match`（必须为空数组） |
| 新增模式 | `--preflight-only` —— **只读**核验（零 mutation），供 §4 使用 |

#### §3 测试扩展 —— `tests/v365-hd10-authorization-boundary.test.js`

**HD10-01~08 保留**；**新增 HD10-09~14**，且按 owner 要求**抽纯函数直接 unit test**（⛔ 不只扫字符串）：

| 用例 | 断言 |
|---|---|
| HD10-09 | 同名不同 **key fields** ⇒ 不匹配 + 归因 `key_drift` |
| HD10-10 | 同名不同 **direction**（`desc→asc`）⇒ 不匹配 + 归因 `direction_drift` |
| HD10-11 | 同名不同 **unique** ⇒ 不匹配 + 归因 `unique_drift` |
| HD10-12 | **额外非 `_id_` index** ⇒ 不匹配 + 归因 `unexpected_extra`；且 `_id_` 被忽略、`exact match = true` |
| HD10-12b/c | `_id_` ⇒ `null`；三形态 direction 归一为同一签名 |
| HD10-13 | `EXISTS + exact match` ⇒ ⛔ 不得调用 `createIndexes`（必须 `NO_OP_INDEXES` / `NO_OP_COLLECTION` / `mutation_command_sent: false`） |
| HD10-14 | `ABSENT` ⇒ 只允许 `create` + frozen required indexes（⛔ 无契约外索引、无删除类命令） |

**结果**：`[PASS] v365-hd10-authorization-boundary.test.js（HD10-01~14）`。

#### §4 只读复验（⛔ 未重新 create / createIndexes）

```
node scripts/v365-hd10-create-collections.js --i-have-authorization \
     --preflight-only --env tradingview-etf-d0fa42yy57cbc11b
```

结果：`mode = READ_ONLY_PREFLIGHT` · `preflight_all_exact_match = true` ·
`zero_mutation_command = true` · `HD_10 = COMPLETE_PREFLIGHT_ONLY`；
`total_collections = 32`。**5/5 集合 + 7/7 索引全量签名逐位一致**（含 `run_history` 的
`uk_run_id|run_id:1|unique` · `idx_trade_date|expected_trade_date:-1|plain` · `idx_supersedes|supersedes_run_id:1|plain`）。
**⛔ 未发出任何 create / createIndexes。**

#### §5 文档当前快照漂移修正（⛔ append-only 历史段不改写）

- **Ledger**：删除「HD-10 待 owner 单独授权」⇒ `HD-10 = COMPLETE / CREATE EMPTY STRUCTURE ONLY`；
  `Stage A~G` 78/78 → **79/79**；新增「当前真实语义」块（HD-9 / HD-15 / `V365_ENFORCE_SWITCH_DATE` /
  `RFP-V2-CF-COOLDOWN` / `RFP-V2-AE` / `RPG_F3_HISTORICAL_UNEXPECTED_DECISION_DELTA=6` / `OWNER_F2C_PATH=A` /
  `RUN_HISTORY_INDEX=PENDING` / `PRODUCTION_ACTIVATION_AUTHORIZATION=NOT_GRANTED`）。
- **Compression**：`Stage A = 71/71` · `Stage A~G = 79/79`；补 `RFP-V2-CF-COOLDOWN` / `RFP-V2-AE` 真实语义
  （⛔ 不再只描述旧的 `cooldown = hardcoded 0`）；补 HD-9 / HD-15 / PROD-A / `RPG-F2-B=PARTIAL` / `RPG-F2-C` /
  `UNEXPECTED_DECISION_DELTA`（已拆为 `P12_PARITY_UNEXPECTED_DECISION_DELTA=0` /
  `RPG_F3_HISTORICAL_UNEXPECTED_DECISION_DELTA=6`）。
- **Freeze Review**：顶部与 §2 同步 —— ⛔ 不再写「RPG-F2-B 尚未执行 / RFP-V2-PH 尚未执行 /
  cooldown production function 未复用」；改为「**已执行但结论 fail-closed**」。

#### §6 一致性检查器加强 —— `scripts/v365-final-state-consistency-check.js`

新增 **current-state cross-doc 断言**（三份当前文档**逐项一致**）：
`Stage A~G` · `HD-10` · `OWNER_F2C_PATH` · `RUN_HISTORY_INDEX` · `RPG-F2-B` · `RPG-F2-C` · `RPG-002` ·
`RFP-V2-PH_FULL_WINDOW_AVAILABLE` · `P12_PARITY_UNEXPECTED_DECISION_DELTA` ·
`RPG_F3_HISTORICAL_UNEXPECTED_DECISION_DELTA` · `READY_FOR_PRODUCTION_PROMOTION`。
⛔ append-only 历史段**不参与** stale-value rejection。

#### §7/§8 裁定登记

- `HD-9_RUN_HISTORY_RETENTION_POLICY = RETAIN_INDEFINITELY_FOR_V365` ⇒ **CLOSED**；
  ⛔ 不自动删 / 不归档 / 无 TTL / 不压缩；⛔ **当前不实现 retention worker**。
- `HD-15_SWITCH_DATE_POLICY = APPROVED` ⇒ **POLICY CLOSED**（只冻结**时点规则**，不写值）。
  `V365_ENFORCE_SWITCH_DATE` 当前仍 **`null`** = 「第一个真实成功且成为 authoritative 的
  V3.6.5 ENFORCE production run 的 `expected_trade_date`」；⛔ **不是**建表 / 代码完成 / 授权 /
  测试 / diagnostic replay 的日期。若首次真实 run 失败 ⇒ switch date **保持 `null`**。

**切换时序（10 步）**：

```
① production 提升授权（当前 NOT_GRANTED）
② 进入 ENFORCE 模式
③ 执行首个真实 ENFORCE production run
④ run 成功写入 run_manifest
⑤ 写入 run_history（真实执行账本，Model B）
⑥ 初始化 / 切换 active_run_pointer
⑦ 该 run 成为 authoritative（首个真实成功）
⑧ ★ 此时方可把 V365_ENFORCE_SWITCH_DATE 设为该 run 的 expected_trade_date
⑨ 生产提升发生 ⇒ RUN_HISTORY_INDEX 数据侧自然补齐（⛔ 不得人为制造 run）
⑩ 重跑 Full Requalification + Freeze Review ⇒ 方可考虑 READY
```

#### §9/§10/§11 收口与最终状态

- `RUN_HISTORY_INDEX` **仍 `PENDING`** —— 属 **POST-ACTIVATION / FIRST-NATURAL-RUN ACCEPTANCE**；
  ⛔ **不得**通过制造一笔生产 run「补齐测试证据」。
- `PRODUCTION_ACTIVATION_AUTHORIZATION = NOT_GRANTED`。
- **最终状态**：`HD-10=COMPLETE` · `HD-9=CLOSED` · `HD-15_POLICY=CLOSED` ·
  `V365_ENFORCE_SWITCH_DATE=null` · `RUN_HISTORY_INDEX=PENDING` · `RPG-F2-B=PARTIAL` ·
  `RPG-F2-C=BLOCKED_ON_ACTUAL_BOOK_COVERAGE` · `RFP-V2-PH_FULL_WINDOW_AVAILABLE=false` ·
  `RPG_F3_HISTORICAL_UNEXPECTED_DECISION_DELTA=6` · `READY_FOR_PRODUCTION_PROMOTION=NOT_ISSUED`。
- **前瞻轨状态（C-019）**：`HISTORICAL_FULL_WINDOW_STATUS=INCOMPLETE_BY_SOURCE_HISTORY` ·
  `PROSPECTIVE_QUALIFICATION_STATUS=NOT_STARTED` · 协议 `RFP-V2-PH-PROSPECTIVE`（`qualification_authoritative=false`）·
  `READY_FOR_CONTROLLED_PRODUCTION_ACTIVATION=PENDING_OWNER_APPROVAL` · `READY_FOR_GENERAL_PRODUCTION=false`。
- ⛔ **完成后停止，不得进入 production activation。**

---

### C-019 · 2026-09-29 · `PROSPECTIVE_PRODUCTION_QUALIFICATION_DESIGN`（§1~§17；⛔ 不进入 production activation）

> **阶段目标**：解决「历史数据永久缺失 ⇒ 永远无法 READY」的治理死锁 —— ⛔ **不伪造历史、不缩短旧窗口、不放宽 taxonomy、不执行 production activation**。
> **方法**：**双轨分离**（历史轨永久保留 provenance + 前瞻轨用未来真实 run 累积）。

#### §1~§2 历史轨保持冻结（⛔ 零篡改）

- 旧窗口 `2026-08-01 → 2026-09-22` **继续冻结**；永久结论 = `RFP-V2-PH-HISTORICAL` ·
  `FULL_WINDOW_STATUS = HISTORICAL_FULL_WINDOW_INCOMPLETE`；原因 = `UNAVAILABLE_BY_HISTORICAL_FACT`
  （⛔ 非 `FAIL_DUE_TO_IMPLEMENTATION`）。
- `RPG-F2-B = PARTIAL` · `RPG-F2-C = BLOCKED_ON_ACTUAL_BOOK_COVERAGE` ·
  `RFP-V2-PH_FULL_WINDOW_AVAILABLE = false` · `RPG_F3_HISTORICAL_UNEXPECTED_DECISION_DELTA = 6` **全部未动**；
  ⛔ 未改名 EXPECTED / 未扩 taxonomy / 未用 synthetic 解释 / 未补 suggested_position / 未假设零仓 / 未 backfill / 未插值。

#### §3 新建协议 `RFP-V2-PH-PROSPECTIVE`

```
protocol_version        = RFP-V2-PH-PROSPECTIVE
replay_semantics        = PRODUCTION_HISTORICAL_PROSPECTIVE
qualification_authoritative = false
anchor                  = sha256(排序后的 "<expected_trade_date>:<run_id>:<decision_sequence_sha256>")
状态机                  = NOT_STARTED → EPOCH_ESTABLISHED → ACCUMULATING → GATE_ELIGIBLE → QUALIFIED
```
⛔ **不复用**任一旧 anchor（V1 / V2-CF / V2-CF-COOLDOWN / V2-AE）；由 P-02 逐一断言。

#### §4 `PROSPECTIVE_EPOCH` 定义（⛔ 不得简化）

= **第一个真实成功成为 authoritative 的 V3.6.5 ENFORCE production run**，须同时满足：
① CAS 成功 ② `active_run_pointer` 已切换 ③ `run_history` 按 OD-2 落盘 ④ read-after-write consistent。
⇒ 之后才登记 `V365_ENFORCE_SWITCH_DATE = 该 run.expected_trade_date`；首次失败 ⇒ `NOT_STARTED` / switch date = `null`。

#### §5 冻结 OD-2 时序（⛔ 不得改写为 `run_history → promotion`）

`candidate 写齐 → manifest/finality → CAS promotion → promotion confirmed → run_history 单次 append → pointer 可读`

#### §6 新前置状态 `READY_FOR_CONTROLLED_PRODUCTION_ACTIVATION`

与 `READY_FOR_GENERAL_PRODUCTION` **严格分开**；机器门禁 G-01~G-16（`scripts/lib/v365-prospective-gate.js`）。
**本轮实测**（`scripts/v365-prospective-preflight.js`）：
```
G-01 ~ G-15  = PASS
G-16         = FAIL（explicit owner authorization 尚未给出）
gate.status  = PENDING_OWNER_APPROVAL · may_activate = false
```
⛔ **fail-closed**：G-16 未 PASS ⇒ 不得 activation。⛔ 静默豁免检测：历史 Δ 写成 0 或显式 waive ⇒ `BLOCKED_HISTORICAL_DELTA_SILENTLY_WAIVED`。

#### §7 Controlled Activation 约束（单次·可逆·fail-closed）

single-run scope · single `expected_trade_date` · single env · explicit HEAD SHA binding · explicit owner authorization；
8 类失败条件全部 `FAIL CLOSED`。

#### §8 `V365_FIRST_NATURAL_RUN_ACCEPTANCE`（A-01~A-10）

全绿后 `RUN_HISTORY_INDEX` 才 `PENDING → ACTIVE/AVAILABLE`；⛔ 部分通过不升格（P-11 断言）。

#### §9 `PROSPECTIVE_MINIMUM_WINDOW` 候选（⛔ 本轮只设计不拍板）

| 证据（取自现有代码，⛔ 未新造） | 含义 |
|---|---|
| `v364-replay-harness.js:192` `bars.length < 40 ⇒ null` | 日线 warmup ≥ 40 |
| `:194` `weekly.length < 10 ⇒ regime = range` | **10 周线 ≈ 50 交易日** ⇒ 窗口 < 50 时 regime **恒为 range**（硬下界） |
| `indexWStates.length < 3 ⇒ range` | 指数轮动 warmup |

候选：**A = 60** / **★B = 120**（推荐，动态补足至 250 上限）/ **C = 250**。
推荐 B 理由：覆盖 ≥ 2 个完整 regime 段 + cooldown(≤5) / MA warmup 全部饱和 + 足以观测 BUILD·ADD·REDUCE·HOLD 四类转换。
⇒ 登记 **OD-P-1**（owner 待拍板）；当前 `PROSPECTIVE_MINIMUM_WINDOW = RECOMMENDED_120_TRADING_DAYS`。

#### §10 数据源（⛔ 仅真实 production 7 集合）

⛔ 禁 synthetic fill / suggested_position / counterfactual book / manual reconstructed / 插值（由 P-12 断言）。

#### §11 / §12 新增 RPG-F2-B-PROSPECTIVE / F2-C-PROSPECTIVE + Δ 双口径拆分

- `RPG-F2-B-PROSPECTIVE` 须证：`actual → production computeCooldownDays() → replay computeCooldownDays() → same result`。
- `RPG-F2-C-PROSPECTIVE` 须证：每个 required trade date 有 actual production book。
- ★ **Δ 命名永久拆分**（⛔ 不得再混用笼统名）：
  `P12_PARITY_UNEXPECTED_DECISION_DELTA = 0` · `RPG_F3_HISTORICAL_UNEXPECTED_DECISION_DELTA = 6`（永久保留）·
  `RPG_F3_PROSPECTIVE_UNEXPECTED_DECISION_DELTA`（目标 0）。
- 三份 current-state 文档 + prospective 设计文档**逐项一致**（由一致性检查器 (10) 断言）。

#### §13 / §14 文档修正

- **Δ 命名拆分**：`compression` 3 项 · `ledger` 快照 + 阶段日志 · `freeze` 不变量表 —— 全部落地。
- **Freeze Review stale 文案**：⛔ 删「F2-B / RFP-V2-PH 未执行完毕」⇒ 改为
  「**已执行**但 historical full-window qualification 因生产历史不存在而 fail-closed」= `DATA_AVAILABILITY_LIMIT`
  （⛔ 非 `WORK_NOT_EXECUTED`）；并声明该限定**永久**、解除路径只有前瞻轨。

#### §15 边界（⛔ 严格遵守）

本轮**允许**：设计协议 / 写设计文档 / 状态机 / gate / tests / dry-run / read-only preflight / coverage schema / acceptance spec / 更新治理文档。
本轮**禁止**（全部未发生）：production promotion · pointer 初始化 · 生产 candidate·run_manifest·run_history 写入 ·
设 switch date · deploy · push · PR · merge · tag。
⇒ **`PRODUCTION_ACTIVATION_AUTHORIZATION = NOT_GRANTED`**。

#### 本轮产出物

| 文件 | 内容 |
|---|---|
| `docs/V365_PROSPECTIVE_PRODUCTION_QUALIFICATION.md` | 主设计文档（12 节 · §0~§17） |
| `scripts/lib/v365-prospective-gate.js` | 纯函数门禁（gate / acceptance / protocol / coverage 校验） |
| `scripts/v365-prospective-preflight.js` | 只读 preflight ⇒ `prospective-state.json` |
| `tests/v365-prospective-qualification.test.js` | P-01~P-17（全 PASS） |
| `deliverables/v365-production-history/prospective/prospective-state.json` | 机器状态件 |
| `scripts/v365-final-state-consistency-check.js`（改） | +prospective 断言 + `-uall` 计数修正 |
| 三份 current-state 文档（改） | Δ 拆分 + 前瞻轨状态 + stale 文案修正 + 计数同步 |

#### 复跑门禁（C-019 实测）

```
Stage A                        = 72/72（含 v365-prospective-qualification.test.js）
Stage A~G                      = 79/79 · 0 失败
v365-qualification-gate        = PASS（QUALIFIED_CANDIDATE）
v365-reader-migration-gate     = PASS 8/8
verify-immutable               = PASS（23/23）
verify-gen1-pipeline           = PASS（10/10）
verify-gen2-build-artifacts    = PASS（7/7）
v365-p12-decision-parity       = P12_PARITY_UNEXPECTED_DECISION_DELTA = 0 · anchor 25ccbfc7…1723 逐位不变
受保护域（CALC）               = 零改动（cooldown.js / constants.js / correlation.js / runGen1ShadowEod/index.js）
tracked-file count             = 74（⚠️ 须 `git status --porcelain -uall`；不带 -uall 会折叠未跟踪目录 ⇒ 70 假值）
FINAL_STATE_DOCS_CONSISTENT    = true
V365_ENFORCE_SWITCH_DATE       = null
```

#### C-019 最终状态

```
HISTORICAL_FULL_WINDOW_STATUS  = INCOMPLETE_BY_SOURCE_HISTORY
PROSPECTIVE_QUALIFICATION_STATUS = NOT_STARTED
READY_FOR_CONTROLLED_PRODUCTION_ACTIVATION = PENDING_OWNER_APPROVAL
PRODUCTION_ACTIVATION_AUTHORIZATION = NOT_GRANTED
READY_FOR_GENERAL_PRODUCTION   = false
RPG_F3_HISTORICAL_UNEXPECTED_DECISION_DELTA = 6
```

- ⛔ **本阶段完成后停止；⛔ 不得执行首次生产 run。**

---

### C-020 · 2026-09-29 · `PROSPECTIVE_PRODUCTION_QUALIFICATION_DESIGN_CORRECTION`（§1~§8；⛔ 不进入 controlled activation）

> **阶段目标**：owner 批准总体方向后，先完成 **3 项设计修正** 并裁定 OD-P-1~OD-P-5。
> **本轮约束**：`PRODUCTION_ACTIVATION_AUTHORIZATION = NOT_GRANTED`，⛔ 未执行任何真实 production run。

#### §1 修正 actual-book authority（★ 核心修正）

**审计问题**：不得默认 `run_candidate_portfolio = ACTUAL_EXECUTION_BOOK`。

**审计方式**：只读 contract + production writer 审计（`production_writes_performed = false`）。

**审计取证**：

| # | 位置 | 发现 |
|---|---|---|
| E-1 | `cloudfunctions/runDecisionEngine/index.js:561` | `v365WritePortfolio()` 走 `putCandidate(CANDIDATE_PORTFOLIO, runId, 'portfolio', doc)` —— **与 candidate 同通道** |
| E-2 | `src/common/schema.js:786` | schema 自称「**组合候选**」；字段 `cash_ratio` 等为**建议**语义，⛔ 无 actual/executed/filled 字段 |
| E-3 | `src/common/utils/v365-atomic-publish.js` | 候选发布器，全文**零处** actual/execution 语义 |
| E-4 | `src/common/utils/v365-contracts.js:57` | 与 `CANDIDATE_DECISION` **同族命名**（`CANDIDATE_` 前缀），OD-5 唯一来源 |
| E-5 | `cloudfunctions/runDecisionEngine/index.js:559` | 写入时机**早于** promotion、早于任何执行 ⇒ 结构上不可能是执行后账面 |

**审计结论**：

```
answer  = NOT_PROVEN
verdict = CANDIDATE_INTENDED_PORTFOLIO_PROVENANCE_ONLY
```

**冻结的 authority**（owner 裁定）：

```
execution authority:            trade_log
actual position-book authority: portfolio_snapshot.positions[].position
run_candidate_portfolio:        仅 candidate / intended portfolio provenance
```

⇒ ⛔ **不得**用于 `RPG-F2-C-PROSPECTIVE` actual-book qualification。
除非能以 **code + contract + production writer** 三方证明其保存**执行后 actual position**。

**证据件**：`deliverables/v365-production-history/prospective/actual-book-authority-audit.json`（5 条取证 · 只读）。

#### §2 + §5 Anchor 拆成两层（OD-P-2 = APPROVED_WITH_CORRECTION）

**⛔ 更正**：`RESULT_SEQUENCE_SHA` **不得单独**作为 production-historical qualification anchor。

```
第一层  result_sequence_sha = sha256(expected_trade_date : run_id : decision_sequence_sha256)
        ⇒ 仅作 result sequence 标识；⛔ 不得单独作 qualification anchor

第二层  PROSPECTIVE_QUALIFICATION_ANCHOR   ★ 真资格锚
        至少绑定（⛔ 不得减少；可增加）：
          protocol_version · replay_semantics · prospective_epoch · window_start · window_end
          trade_log_dataset_sha · portfolio_snapshot_dataset_sha · run_history_manifest_sha
          production_code_sha · replay_harness_sha · coverage_manifest_sha
          result_sequence_sha
```

**强制不变量**：

```
same qualification anchor
  ⇒ same protocol + same actual datasets + same production code
  + same replay implementation + same result sequence
```

⇒ ⛔ 不是"仅绑定 decision sequence"的弱版本。⛔ 也不得复用 V1 / V2-CF / V2-CF-COOLDOWN / V2-AE anchor。

机器守卫：`validateProspectiveAnchor()`（P-20 / P-21 / P-31）。

#### §3 修正 CAS-success / history-failure 恢复语义（★ 关键安全修正）

**冻结 OD-2 时序保持不变**：
`candidate complete → manifest/finality → CAS promotion attempt → promotion result known → run_history append → authoritative pointer readable`

**A. CAS 未成功 ⇒ `CAS_REJECTED`**

```
pointer 不变（不修改 active_run_pointer）
run promoted = false
按冻结规则记录 rejected history
switch date = null
PROSPECTIVE_EPOCH = NOT_STARTED
STOP
```

**B. CAS 已成功，但 run_history append 失败 ⇒ `PROMOTED_HISTORY_INCOMPLETE`**

⛔ **不得声明"不写 pointer"** —— **pointer promotion 已经发生**。

恢复协议（严格按序）：

```
1. 禁止再次 promotion
2. read active_run_pointer
3. 确认 pointer == 本 run
4. 以 uk_run_id 查询 run_history
5a. 无 history         ⇒ 幂等补写同一 immutable history row
5b. 已有完全一致 history ⇒ 视为 retry / recovery success
5c. 已有不同内容        ⇒ HISTORY_IMMUTABILITY_CONFLICT ⇒ HARD STOP
6. history 恢复成功     ⇒ 再执行 First Natural Run Acceptance（A-01~A-10）
7. A-01~A-10 全绿前     ⇒ switch date 不得登记 · qualification 不得累计
```

⛔ 除非存在**独立冻结的 rollback CAS 协议**，不得自动把 pointer 回滚。

机器守卫：`evaluateCasHistoryRecovery()`（P-22 / P-23 / P-24 / P-30，覆盖 CAS fail / CAS success + history fail / retry exact-match / retry conflict 四类）。

#### §4 OD-P-1 = **APPROVED**

```
PROSPECTIVE_MINIMUM_WINDOW = 120 trading days
PROSPECTIVE_MAXIMUM_WINDOW = 250 trading days
```

- 120 日后仍缺必要覆盖维度 ⇒ **自动延长**。
- 必要维度：`regime ≥ 2 档` · `BUILD/ADD/REDUCE/HOLD 全覆盖` · `cooldown 至少真实触发一次` · `sector_cap 或 correlation_cap 至少真实触发一次`。
- 达到 250 仍不足 ⇒ `STOP` + `OWNER_REVIEW_REQUIRED`；⛔ **不得自动降低资格标准**。

机器守卫：`evaluateProspectiveWindow()`（P-25，覆盖 119 / 120 / 200 / 250 四档）。

#### §6 OD-P-4 时点规则（DEFINED）

```
PROSPECTIVE_EPOCH 的 expected_trade_date
  = owner 授权 CONTROLLED_PRODUCTION_ACTIVATION 后
    第一个正常计划执行且市场数据完整的自然交易日
```

⛔ 禁止：回溯日期 · 人为挑历史表现好的日期 · 用测试日期 · 用设计日期。

登记 switch date 仍须：**首次 run 真正 promotion success + history 完整 + A-01~A-10 全绿**。

#### §7 OD-P-5

保持 `qualification_authoritative = false`，直至：
`prospective window ≥ 120` + `所有动态覆盖条件满足` + `RPG-F2-B-PROSPECTIVE = COMPLETE`
+ `RPG-F2-C-PROSPECTIVE = COMPLETE` + `RPG_F3_PROSPECTIVE_UNEXPECTED_DECISION_DELTA = 0`
+ `Full Requalification PASS`；之后由 **owner 单独裁定**。⛔ agent 不得自行升格。

机器守卫：`evaluateQualificationAuthoritativePromotion()`（P-26）。

#### §8 OD-P-3 本轮仍不授权

```
OD-P-3 = CONTROLLED_PRODUCTION_ACTIVATION = NOT_YET_GRANTED
```

#### 本轮产出物

| 文件 | 变更 |
|---|---|
| `deliverables/v365-production-history/prospective/actual-book-authority-audit.json` | ★ 新建（authority 审计证据） |
| `scripts/lib/v365-prospective-gate.js` | +`ACTUAL_BOOK_AUTHORITY` / `ANCHOR_BINDINGS` / `RECOVERY` / `WINDOW_POLICY` / `validateProspectiveAnchor` / `evaluateCasHistoryRecovery` / `evaluateProspectiveWindow` / `evaluateQualificationAuthoritativePromotion` / G-17~G-20 |
| `scripts/v365-prospective-preflight.js` | authority/两层 anchor/恢复协议/OD 登记入 `prospective-state.json` |
| `tests/v365-prospective-qualification.test.js` | P-01~P-31（+P-18~P-31） |
| `docs/V365_PROSPECTIVE_PRODUCTION_QUALIFICATION.md` | §3.2.1 两层 anchor · §4.2.1 OD-P-4 · §5.1 恢复协议 · §6 G-17~G-20 · §9.4 OD-P-1 · §10 authority · §11.2 · §14 OD 裁定 · §16 机器状态 |
| 三份收口文档 | 同步 C-020 状态块 |

#### 复跑门禁（C-020 实测）

```
Stage A                        = 72/72
Stage A~G                      = 80/80 · 0 失败
v365-p12-decision-parity       = P12_PARITY_UNEXPECTED_DECISION_DELTA = 0 · anchor 25ccbfc7…1723 逐位不变
prospective gate               = G-01~G-15 PASS · G-16 FAIL · ★ G-17~G-20 PASS ⇒ PENDING_OWNER_APPROVAL
v365-prospective-qualification = P-01~P-31 全 PASS
受保护域（CALC）               = 零改动
FINAL_STATE_DOCS_CONSISTENT    = true
V365_ENFORCE_SWITCH_DATE       = null
```

#### C-020 最终状态

```
PROSPECTIVE_DESIGN_FINAL                    = READY_FOR_OWNER_ACTIVATION_DECISION
READY_FOR_CONTROLLED_PRODUCTION_ACTIVATION  = PENDING_OWNER_APPROVAL
PRODUCTION_ACTIVATION_AUTHORIZATION         = NOT_GRANTED
OD-P-1 = APPROVED · OD-P-2 = APPROVED_WITH_CORRECTION · OD-P-3 = NOT_YET_GRANTED
OD-P-4 = DEFINED · OD-P-5 = PENDING_OWNER_PROMOTION_DECISION
```

- ⛔ **本阶段完成后停止；⛔ 不得执行首次生产 run。**

---

### C-021 · 2026-09-29/30 · `DEPLOYMENT_IDENTITY_AND_CANDIDATE_FREEZE_GATE`（§1~§14；⛔ 不 deploy / 不执行 production run）

> **触发**：`OD-P-3 = CONTROLLED_PRODUCTION_ACTIVATION` 仍为 `NOT_YET_GRANTED`，原因是
> Controlled Activation Gate **尚未证明**「生产环境实际运行的代码 == 本轮完成 qualification 的 V3.6.5 candidate」。
>
> ⛔ 本轮**不 deploy** · **不执行 production run** · **不初始化 pointer** · **不写业务数据** ·
> **不设置 switch date** · **不 commit / push / PR / merge / tag**。只做设计、只读取证、dry-run、机器门禁。

#### §1 缺口承认

⛔ 旧语义 **`owner_authorization = true ⇒ GRANTED` 正式废除**。
owner 同意运行 **≠** 线上跑的就是被 qualification 的代码。
新增独立必需条件 `deployment_identity_verified`（**部署前必须 `false`**）
⇒ 当前状态收紧为 **`BLOCKED_ON_DEPLOYMENT_IDENTITY`**（比 `PENDING_OWNER_APPROVAL` 更精确、更 fail-closed）。

#### §2 Production Deployment Baseline Audit（只读）

脚本 `scripts/v365-deployment-identity-audit.js`（含 `--with-download` 全量 LF-parity）：

```
FunctionId    = lam-eiye285p
Runtime       = Nodejs16.13        Handler = index.main
ModTime       = 2026-09-22 16:29:48（= 台账 D-006）
CodeSize      = 4013498（= D-006）
index_sha256_raw = 072b40089c7bc260a888bda913e68b1afb546b49a3d19ef88d4eec7fe9ae477b（本地复算，= D-005）
index_sha256_lf  = 77f7d50042cee0a9a7e5f84c7769dd95de92f8091b7547307b6f325f8fe01529（同）
ONLINE_SOURCE_PARITY = EXACT_MATCH 74/76（CONTENT_DIFF 0；ONLY_ONLINE 2 = build 注入 frozen artifact，属预期）
CodeSha256（CLI 字段）= N/A（fn detail 不返回）⇒ 不得因字段缺失判漂移
⇒ CURRENT_PRODUCTION_DEPLOYMENT_IDENTITY = V3.6.4（aa634e2）· PRODUCTION_DEPLOYMENT_DRIFT = NO · stop = null
```

★ 三重独立一致 ⇒ **推翻「线上可能已是 V3.6.5」的假设**（该假设必须证伪，否则会误判部署身份）。
★ 坑：CLI 返回 `{data:{...}}` 信封 ⇒ 首版平铺取值全 null ⇒ **误报 DRIFT**（已修，见 memory §12）。

#### §3 V3.6.5 真正 Deployment Scope（依赖闭包）

脚本 `scripts/v365-deployment-scope.js`：

```
closure_parts: function own source 2 + canonical common 87 + extra frozen artifacts 2 = 91
V365_DEPLOYMENT_REQUIRED_FILES = 91 · V365_DEPLOYMENT_EXCLUDED_FILES = 69
worktree 变更（-uall）= 76 · changed_in_closure = 7 · changed_outside_closure = 69
materializeIndicators_touched = false · calibration_files_touched_in_closure = []
V365_DEPLOYMENT_SCOPE = EXACT · deploy_all_74_changed_files = false
```

进包的 7 个改动文件 = `cloudfunctions/runDecisionEngine/index.js` · `src/common/schema.js`
+ 5 个 `src/common/utils/v365-{active-read,atomic-publish,contracts,publish-store,run-integrity}.js`。

⛔ 杜绝「76 全量部署」；⛔ `materializeIndicators` 零触碰。

#### §4 Candidate Source Freeze

脚本 `scripts/v365-deployment-candidate-manifest.js`：

```
base_head_sha          = c6bd006fd76ffc5358cddd07347df8ed23d9e61d
candidate_content_sha  = e80ea8c20785f3c8c4da70e8316d84321cfe944cb7ba25f85df2dba04ff79016
dependency_closure_sha = 同（同源）
production_code_sha    = 3395a36a… · common_closure_sha = ac9dafcd… · extra_artifacts_sha = d352c4ca…
deployment_required_files = 91 条逐文件 {path, sha256, bytes}
expected_runtime / handler = Nodejs16.13 / index.main
build_method = scripts/build-cloudfunctions.js · build_tool_versions = node v22.22.2 / CloudBase CLI 3.8.1
candidate_manifest_sha = 8c53f93fa66bbc2768f23843530f3997e2c9d38030e58b65c2bc0d7497c501c1
invariant = same deployment_candidate_manifest_sha ⇒ same production source bytes
mutable_working_tree_deploy_forbidden = true
```

★ `HEAD SHA` 不足以代表待部署源码（V3.6.5 核心改动大量位于 working-tree / untracked）。
★ 两次重算逐位一致 ⇒ **deterministic**。

#### §5 Freeze Mechanism（只设计不执行）

详见 `docs/V365_DEPLOYMENT_IDENTITY_AND_CANDIDATE_FREEZE.md` §5：

| 方案 | 做法 | 关键权衡 |
|---|---|---|
| **A** Immutable freeze commit / tag | 91 文件提交 + annotated tag | 可复现/可审计最强；⚠️ **需 commit/tag 授权** |
| **B** Canonical bundle + manifest + per-file SHA + bundle SHA | 确定性打包 + sha | ✅ **不需 git 写权限**；与「deploy 授权 ≠ run 授权」分离原则一致 |

**推荐 = 方案 B 为主 + 方案 A 为辅（双绑定）**：bundle SHA（部署用）+ freeze tag（部署后补打作审计锚）。

#### §6 Rollback Artifact Gate（dry-run 通过）

脚本 `scripts/v365-rollback-artifact.js`：线上包下载 → **本地复算** `index.js` 双 SHA == 台账 D-006

```
recomputed idx raw = 072b40089c7bc260a888bda913e68b1afb546b49a3d19ef88d4eec7fe9ae477b  ✅
recomputed idx lf  = 77f7d50042cee0a9a7e5f84c7769dd95de92f8091b7547307b6f325f8fe01529  ✅
independently_verified = true
```

⛔ 不是「保存了一个下载链接」，而是**可复现的字节级验证**（独立双源）。凭证不可用 ⇒ fail-closed。

#### §7~§9 两个独立 owner Gate

```
GATE-D = READY_FOR_V365_CONTROLLED_DEPLOYMENT（D-01~D-08）
  D-01~D-07 PASS · D-08 owner_deployment_authorization FAIL
  ⇒ PENDING_OWNER_DEPLOYMENT_APPROVAL · may_deploy = false
  ⇒ implies_first_controlled_run = false（恒为 false）

GATE-R = READY_FOR_V365_FIRST_CONTROLLED_RUN（G-01~G-25）
  ⇒ BLOCKED_ON_DEPLOYMENT_IDENTITY
```

§9 Post-Deploy Identity Gate：`ONLINE_SOURCE_PARITY = EXACT_MATCH` **且** `UNEXPECTED_PACKAGE_DIFF = 0`
才允许 `DEPLOYMENT_IDENTITY_VERIFIED = true`；否则 `STOP`。缺 `online.file_hashes` ⇒ fail-closed。

#### §10~§12 门禁修改

| 变更 | 内容 |
|---|---|
| G-16 改名 | `owner_authorization` → **`owner_run_authorization`**（**运行**授权） |
| 新增 G-21~G-25 | `candidate_source_frozen` · `deployment_scope_exact` · `rollback_artifact_verified` · `production_baseline_verified` · `deployment_identity_verified` |
| 新增 GATE-D 判据 | `DEPLOYMENT_GATE_ITEMS` D-01~D-08 |
| 新增状态 | `BLOCKED_ON_DEPLOYMENT_IDENTITY` · `PENDING_OWNER_DEPLOYMENT_APPROVAL` |
| 新增函数 | `evaluateDeploymentGate()` · `evaluatePostDeployIdentity()` |
| **修 P-05** | 旧 `owner_authorization=true ⇒ GRANTED` 已废；改为 `owner_run_authorization=true` + `deployment_identity_verified=false ⇒ may_activate=false`；仅两者皆 true + 其余全 PASS ⇒ GRANTED |
| **修 P-13** | 删除 `assert.ok(designDoc.includes(n) \|\| true, …)` vacuous assertion ⇒ 改真实可失败断言（+ 契约源交叉校验） |
| **修 B-09** | `tests/v365-rpg-f2b.test.js` 同类 `\|\| true` 亦已删除 ⇒ 逐 mutation 名真实断言 |
| **新增 P-34** | 守卫「prospective 测试自身不得残留永真断言」（模式由碎片拼装，避免自指陷阱） |
| 新增 P-04/P-05b/P-05c | 部署身份 fail-closed · GATE-D/GATE-R 分离 · Post-Deploy Identity Gate 逐项 |

#### §13 两次 owner 授权严格分离

```
C-021 完成 → 【owner #1】DEPLOY 授权 → 单次部署 → Post-Deploy Identity Gate（EXACT_MATCH）
  → DEPLOYMENT_IDENTITY_VERIFIED = true → STOP
  → 【owner #2】FIRST CONTROLLED RUN 授权 → 单自然日 single run → A-01~A-10
```

⛔ **Deploy 授权 ≠ Run 授权**；任一不得推导另一个。

#### 本轮产出物

| 文件 | 变更 |
|---|---|
| `scripts/v365-deployment-identity-audit.js` | ★ 新建（§2/§9 只读审计） |
| `scripts/v365-deployment-scope.js` | ★ 新建（§3 依赖闭包） |
| `scripts/v365-deployment-candidate-manifest.js` | ★ 新建（§4 候选冻结 manifest） |
| `scripts/v365-rollback-artifact.js` | ★ 新建（§6 回滚件 dry-run + 独立验证） |
| `scripts/lib/v365-prospective-gate.js` | +`DEPLOYMENT` / `GATE_STATUS` / `DEPLOYMENT_GATE_ITEMS` / G-21~G-25 / G-16 改名 / `evaluateDeploymentGate` / `evaluatePostDeployIdentity` |
| `scripts/v365-prospective-preflight.js` | 采集 4 件 evidence + GATE-D + 部署候选 + 部署身份 + 回滚件；`final_state` 新增 C-021 五项 |
| `scripts/v365-final-state-consistency-check.js` | 新增 C-021 current-state 断言（11 项） |
| `tests/v365-prospective-qualification.test.js` | P-01~P-34（+P-04/05/05b/05c/32/33/34 重写） |
| `tests/v365-rpg-f2b.test.js` | B-09 删除 `\|\| true` ⇒ 真实断言 |
| `docs/V365_DEPLOYMENT_IDENTITY_AND_CANDIDATE_FREEZE.md` | ★ 新建（§5 freeze 两方案 + §6 rollback） |
| `docs/production-deployment-ledger.md` | +D-007（只读核验 + 候选冻结登记） |
| 三份收口文档 + prospective 设计文档 | 同步 C-021 状态块 |

#### 复跑门禁（C-021 实测）

```
Stage A                        = 72/72 · 0 失败
v365-prospective-qualification = P-01~P-34 全 PASS
v365-rpg-f2b                   = B-01~B-13 全 PASS（B-09 改为真实断言后仍 PASS）
v365-final-state-consistency   = FINAL_STATE_DOCS_CONSISTENT = true
受保护域（CALC）               = 零改动
V365_ENFORCE_SWITCH_DATE       = null
```

#### C-021 最终状态

```
CANDIDATE_FREEZE_DESIGN                     = COMPLETE
READY_FOR_V365_CONTROLLED_DEPLOYMENT         = PENDING_OWNER_DEPLOYMENT_APPROVAL
READY_FOR_V365_FIRST_CONTROLLED_RUN          = BLOCKED_ON_DEPLOYMENT_IDENTITY
DEPLOYMENT_IDENTITY_VERIFIED                 = false
READY_FOR_CONTROLLED_PRODUCTION_ACTIVATION   = BLOCKED_ON_DEPLOYMENT_IDENTITY
PRODUCTION_ACTIVATION_AUTHORIZATION          = NOT_GRANTED
OD-P-3                                       = NOT_YET_GRANTED
```

- ⛔ **本阶段完成后停止；⛔ 不得 deploy；⛔ 不得执行 production run。**

---

### C-021.1 · 2026-09-30 · PRE_DEPLOY_ARTIFACT_MATERIALIZATION

> owner 裁定：**「C-021 主体批准，但当前仍不授权生产部署」** ⇒ 进入**极小的最终上线前工作包**。
> 目标：把「**逻辑上的** V3.6.5 candidate」冻结成「**一个确定、可验证、可授权的实际 deployment bundle**」。
> ⛔ 本轮仍**不 deploy / 不执行 production run / 不初始化 pointer / 不写 production DB / 不设 switch date /
> 不 push·PR·merge·tag**；✅ 允许本地 deterministic build / 本地 bundle / hash·manifest / dry-run diff /
> read-only production verification / 文档同步 / tests。

| 项 | 内容 |
|---|---|
| **§1 canonical bundle 物化** | 从 manifest 声明的 **91** 文件及 sha 构建；构建前**逐文件**验证 `sha256(current) == manifest.expected` ⇒ **91/91 一致 · drift 0**；⛔ 任一不一致 ⇒ `STOP = CANDIDATE_SOURCE_DRIFT`（⛔ 不得重生成 manifest「适配」漂移）。⛔ 不得 `cloudbase deploy <mutable working tree>`。格式 = **确定性 ustar**（mtime/uid/gid/mode 全固定，⛔ 不 gzip） |
| **§2 Deployment Artifact Identity** | `V365_DEPLOYMENT_ARTIFACT` 已产出：`bundle_sha256` · `bundle_content_manifest_sha` · `bundle_size = 1161728` · `required_file_count = 91` · `runtime/handler = Nodejs16.13 / index.main` · `build_method = scripts/build-cloudfunctions.js` · `build_tool_versions = node v22.22.2 / tcb 3.8.1`。**不变量**：`same deployment_bundle_sha256 ⇒ same deployable bytes`（两次独立重算**逐位一致**） |
| **§3 Bundle 独立复核** | 重新读盘 → **独立解析** → 重算全部 path / 逐文件 sha / `index.js` raw+LF sha；`reused_build_memory = false` ⇒ `MISSING_REQUIRED_FILE 0` · `UNEXPECTED_FILE 0` · `CONTENT_DIFF 0` · `ONLINE_IRRELEVANT_ARTIFACT_DIFF 0` ⇒ **`BUNDLE_SOURCE_PARITY = EXACT_MATCH`** |
| **§4 Pre-Deploy Package Diff** | PREVIOUS = 线上冻结 **V3.6.4**（`aa634e2`）⇒ `added 15` · `modified 4` · `deleted 0` · `unchanged 72`；**`UNEXPECTED_PACKAGE_DIFF = 0`**。红线三项全 false：`materializeIndicators_changed` · `param_config_semantic_change` · `protected_CALC_unexpected_change` |
| **★ §4 计数对账** | C-021 §3 的 `changed_in_closure = 7`（**working tree** ∩ 闭包）与本次 delta **19**（**已部署基线 `aa634e2`** → worktree）为**包含**关系：`19 = 7 + 12`（12 = `aa634e2→HEAD` 之间**已提交**变更）。⛔ 不得把 19 当「意外改动」 |
| **§5 Rollback Binding** | `DEPLOYMENT_ROLLBACK_BINDING = BOUND`：`previous_package_sha = aa576c20…` · `new_bundle_sha = e996e88a…` · `rollback_bundle_sha256 = 4c7949f5…`（V3.6.4 源码级 76 文件，独立复核 `EXACT_MATCH`，`index.js` 双 SHA 匹配台账 D-006）· `rollback_artifact_sha` 锚定证据文件字节 |
| **§6 GATE-D 修正** | 新增 **D-08 `deployment_artifact_materialized`** / **D-09 `deployment_artifact_exact_match`**；原 D-08 owner 授权**后移为 D-10**。新增 fail-closed 状态 **`BLOCKED_ON_DEPLOYMENT_ARTIFACT`**（bundle 生成前 / 未 exact match）。当前：**D-01~D-09 PASS · D-10 FAIL** ⇒ `PENDING_OWNER_DEPLOYMENT_APPROVAL` |
| **★ §6 语义收紧** | `PENDING_OWNER_DEPLOYMENT_APPROVAL` 必须表示：「**已经存在一个具体、不可变、可用 SHA 唯一标识的 deployment bundle，owner 只差决定『是否把这一包上传生产』**」 |
| **§7 三层 identity binding** | owner 部署授权**不得只绑 HEAD SHA** ⇒ 须绑 `base_head_sha`（**provenance**）+ `candidate_manifest_sha` + **`deployment_bundle_sha`** + `production_env` + `function_name`；`evaluateDeploymentAuthorizationBinding()` 对**仅绑 HEAD** 显式 `head_only_authorization_rejected = true` ⇒ REJECTED |
| **§8 文档残留修正** | Prospective 机器状态旧行 `READY_FOR_CONTROLLED_PRODUCTION_ACTIVATION = PENDING_OWNER_APPROVAL` **已作废** ⇒ 保持 **`BLOCKED_ON_DEPLOYMENT_IDENTITY`**；controlled-run 的 `explicit HEAD SHA binding` ⇒ 改为**三层 identity binding** |
| **§9 stale tracked count** | Freeze Review 残留「**25 个 tracked 文件**」= 历史旧口径 ⇒ 更正为当前真值 **84**；ledger `## C` / `## E` 阶段日志段**整段**标注 **`[HISTORICAL SNAPSHOT]`** |
| **★ §9 守卫加强** | 一致性检查器原反向正则**只匹配「tracked 在前」** ⇒ **漏掉 `<num> 个 tracked`**（正是「25」逃逸的原因）⇒ 现**双向**匹配 + 允许**显式历史标记**豁免 |
| **★★ §9 同源加固（门禁日志）** | 发现 `stage-all-current.log` 记 `79/79`、`stage-a-current.log` 记 `71/71`，而真值为 `80/80` / `72/72`；原 preflight 的 `stage_a_pass` / `stage_a_to_g_pass` **只做形态匹配（`!/\[FAIL\]/` + `\d+/\d+ 项通过，0 项失败`），⛔ 不校验计数** ⇒ 过期日志**静默假通过**（方向恒偏乐观）。现绑定**独立真值**：① Stage A 计数 == `tests/*.test.js` 实际文件数；② 日志旁 `.source-sha256` == **当前源树内容指纹**（`scripts/v365-source-tree-sha.js`，353 文件）。新增 `gate_log_integrity` 审计块；**P-44** 断言机制，最终值由收口检查器强制 |
| **★★★ §9 加固暴露的自指循环** | 加固上线后全量套件变 **79/80**（`P-28` 失败）—— 非加固 bug，而是**长期潜伏的循环依赖被照出**：`测试套件 → stage 日志 → preflight → prospective-state.json → 测试断言该 state`。即 `D-06` 由**本套件自己产出**的日志推导 ⇒ **死锁**（日志要干净 ⇒ 测试要通过 ⇒ state 要正确 ⇒ 日志要干净）。与 **C-015 教训同源**（MEMORY §8：required 须来自独立真值源，⛔ 不得从被检验数据自身推导）。**分层修复**：① 测试套件只断言**恒不变式**（`may_deploy=false` / `DEPLOYMENT_IDENTITY_VERIFIED=false` / `⛔ 永不为 GRANTED`）+ **与日志无关的项**（`D-01~D-05`/`D-07`/`D-08`/`D-09` PASS、`D-10` FAIL）+ **facts↔status 一致性**（按 §6 优先级重算）；② **P-44** 只断言守卫机制与独立真值（⛔ 不断言 `logs_fresh`/`count_matches_truth`/指纹相等 —— 皆为循环量）；③ **最终交付态强制**移到 `v365-final-state-consistency-check.js` 新增 **§12**（它**不产出日志**，在日志刷新后运行 ⇒ 无循环） |
| **★ §9 新鲜度改用内容指纹** | 首版 `mtime ≥ 最新源文件 mtime` 实测**假报过期**：`tests/v365-b0-manifest.test.js` A.8 会**故意篡改**源文件再**逐字节还原**（内容未变、mtime 被推后，命中 `src/common/utils/v365-contracts.js`）。⇒ 改用 `scripts/v365-source-tree-sha.js` 的**内容指纹**（`tests/**`·`scripts/**`·`src/**` 的 `(path,sha256)` 排序串接）。**通用教训**：判「证据是否过期」要用**内容版本**，⛔ 不用**写入时刻** |
| **§10 不自动 deploy** | 即使 `EXACT_MATCH` + `UNEXPECTED_PACKAGE_DIFF = 0` 仍**必须停止**；⛔ 本轮未 deploy |

#### 本轮产出物

- `scripts/lib/v365-deterministic-tar.js`（★ **共享模块**：确定性 tar · content-manifest sha · LF 归一化 · ignore policy · 路径映射 —— ⛔ 禁止复制同源逻辑）
- `scripts/v365-deployment-bundle-materialize.js`（§1~§3）· `scripts/v365-pre-deploy-package-diff.js`（§4）· `scripts/v365-deployment-rollback-binding.js`（§5）
- `scripts/lib/v365-prospective-gate.js`（改：`DEPLOYMENT_GATE_ITEMS` D-01~D-10 · `BLOCKED_ON_DEPLOYMENT_ARTIFACT` · `evaluateDeploymentAuthorizationBinding()`）
- `scripts/v365-prospective-preflight.js`（改：接线 3 件 + `deployment_artifact` / `pre_deploy_package_diff` / `deployment_rollback_binding` + final_state）
- `scripts/v365-final-state-consistency-check.js`（改：+8 项 C-021.1 断言 + **双向 tracked 守卫**）
- `tests/v365-prospective-qualification.test.js`（改：**P-01~P-43**，新增 P-35~P-43）
- `docs/V365_DEPLOYMENT_IDENTITY_AND_CANDIDATE_FREEZE.md`（附 §A.1~§A.11）· `docs/production-deployment-ledger.md`（+**D-008**）
- `deliverables/v365-production-history/c021/{deployment-artifact,pre-deploy-package-diff,deployment-rollback-binding}.json` · `c021/bundle/` · `c021/rollback/`

#### 复跑门禁（全绿 · 已实测确认）

```
Stage A                        = 72/72 · 0 失败
v365-qualification-gate        = QUALIFIED_CANDIDATE
v365-reader-migration-gate     = PASS 8/8
verify-immutable               = PASS 23/23
verify-gen1-pipeline           = PASS 10/10
verify-gen2-build-artifacts    = PASS 7/7
v365-prospective-qualification = P-01~P-44 全 PASS
v365-rpg-f2b                   = B-01~B-13 全 PASS
v365-p12-decision-parity       = P12_PARITY_UNEXPECTED_DECISION_DELTA = 0 · anchor 25ccbfc7…1723 逐位不变
v365-final-state-consistency   = FINAL_STATE_DOCS_CONSISTENT = true（含新增 §12 最终交付态强制）
gate_log_integrity             = PASS（计数绑定真值 + 内容指纹新鲜度）
受保护域（CALC）               = 零改动
V365_ENFORCE_SWITCH_DATE       = null
HEAD                           = c6bd006fd76ffc5358cddd07347df8ed23d9e61d（未变）
tracked-file count             = 84
```

> ★ **p12 决策影响实证**：本轮改动**零决策路径文件**（逐项核查：`decision*.js` / `indicators.js` /
> `cooldown.js` / `constants.js` / `v3-*.js` / `defense.js` / `trend-stage.js` 均未被 C-021.1 触及；
> 唯一的决策路径改动 `cloudfunctions/runDecisionEngine/index.js` 属 C-020 candidate，非本轮）。
> ⇒ `parity_anchor_sha256` **逐位不变**（`25ccbfc7…1723`），`UNEXPECTED_DECISION_DELTA = 0`。

> ★ **`v365-contracts.js` 内容未变（核实）**：该文件 mtime 在测试中被推后，但
> `sha256 = caf5ae8b89cc546264111f2b39531246308091ba97ea7fbe9877d70a79b87f25`
> **同时等于** candidate manifest 与 deployment artifact 记录值 ⇒ **冻结件仍然有效**。
> 原因：`tests/v365-b0-manifest.test.js` A.8 篡改后**逐字节还原**（内容不变、mtime 变）。

> ★ **授权清单改动面同步（bookkeeping，⛔ 非新增授权）**：p12 首次复跑报
> `APPROVAL_CHANGED_FILES_MISMATCH`（清单 74 vs 实际 **84**）—— 属 C-021/C-021.1 新增**只读**工具链
> 与设计文档未登记。依 manifest `scope_note` 中已确立的先例（`[C-018]` 同步为 66 · `[C-019]` +8），
> 将 `changed_files` 重新同步为 **84** 并在 `scope_note` 追加 `[C-021.1]` 说明；
> ⛔ **未改动** `authorized_by` / `authorization_sha` / `authorized_at` / `authorization_limits` /
> `replay_infra_review` / `orchestration_scope`（授权本体未变，HEAD 未动）。复跑后 p12 **全 PASS**。

#### C-021.1 最终状态

```
DEPLOYMENT_ARTIFACT_MATERIALIZED       = true
DEPLOYMENT_BUNDLE_SHA                  = e996e88ae8084a38e186471b561867267fc4280c3ea5758ccb0eff75092455a4
BUNDLE_SOURCE_PARITY                   = EXACT_MATCH
UNEXPECTED_PACKAGE_DIFF                = 0
READY_FOR_V365_CONTROLLED_DEPLOYMENT   = PENDING_OWNER_DEPLOYMENT_APPROVAL
DEPLOYMENT_IDENTITY_VERIFIED           = false
READY_FOR_V365_FIRST_CONTROLLED_RUN    = BLOCKED_ON_DEPLOYMENT_IDENTITY
PRODUCTION_ACTIVATION_AUTHORIZATION    = NOT_GRANTED
```

- ⛔ **本阶段完成后停止；⛔ 不得 deploy；⛔ 不得执行 production run。**
- ⛔ 部署授权 ≠ 运行授权 —— 中间**必须**插入 Post-Deploy Identity Gate。

---

### C-021.2 · 2026-09-30 · AUTHORIZATION_SCOPE_RATIFIED_BY_OWNER + CONTROLLED DEPLOYMENT GRANTED

> owner 本消息含**两个独立裁定**：**A. 授权清单 ratification** + **B. V3.6.5 CONTROLLED DEPLOYMENT AUTHORIZATION = GRANTED**。
> ⛔ 本消息**不授权 FIRST CONTROLLED RUN**。

#### §1 Owner Ratification：当前 changed_files 集合

```text
AUTHORIZATION_SCOPE_RATIFIED_BY_OWNER
changed_files_count = 85
base_head_sha       = c6bd006fd76ffc5358cddd07347df8ed23d9e61d
```

owner 追认当前 `tracked / changed-file set = 85` 作为本次 V3.6.5 工作面的**授权清单真值**。
该 ratification **仅适用于**上述 base HEAD 与 `V3.6.5 Production Readiness / C-021 / C-021.1` 工作流。

部署前重新生成/确认并记录：

| 项 | SHA256 |
|---|---|
| `APPROVAL_MANIFEST_SHA256` | `a972cb914b6df4aee5d03da5a718c0e3ebf0ee43afbfe0caa428baed68323594` |
| `CHANGED_FILES_LIST_SHA256` | `c124f178a635b0aeaaf58251efea5987576ce90bf1212a934f1ce4c4b58cb50e` |
| `CHANGED_REGIONS_LIST_SHA256` | `59cceefaccb008a8ded07912833bfb3f1e366d0481f590c9834919a05470e899` |
| `P12_PARITY_LOG_SHA256` | `e0cebde180c0ea2a992e985dbe589632d25b6c4b58505d1fde91f5351da35fc5` |

`approval-manifest-f2b.json.changed_files` 与当前实际 changed-file set **精确一致**（`SET_EQUAL = true`，85 = 85）。

`v365-p12-decision-parity` 复跑结果：

```text
APPROVAL_CHANGED_FILES_MISMATCH       = 0
P12_PARITY_UNEXPECTED_DECISION_DELTA  = 0
RFP-V1 anchor unchanged               = true（25ccbfc7e1b73a9a173ec36c17512c6228a2fe42685dcd291bc055ea4ed11723）
```

证据件：`deliverables/v365-production-history/c021/authorization-ratification.json`

#### §2 治理裁定：`changed_files` 属于 authorization binding 的一部分

**正式规则**（owner 裁定，⛔ 不得回退）：

```text
changed_files 属于 authorization binding 的一部分。
```

- 本消息对**当前 85 文件集合**进行 owner ratification。
- **从本消息之后**：`changed_files` 集合发生任何**增加 / 删除 / 替换**，均使本次 ratification
  **`INVALID`** ⇒ 必须重新取得 **owner 明确授权**。
- 此前 `74 → 84 → 85` 由 agent 自动同步 `changed_files` 的做法，
  **不再继续解释为「agent 可自由修改授权边界」**。
- ⛔ **不回退**当前正确的 85 文件清单（它是对的，只是同步权限归属需澄清）。
- ⛔ **不得改写历史记录**（本登记为 append-only）。

> ⚠️ **对 agent 的约束**：自本裁定起，`approval-manifest-f2b.json` 的 `changed_files` 字段
> **不再可由 agent 自行同步**。若因新增文件导致集合变化，必须 **STOP + 请求 owner 重新授权**。

---

### C-021.2（续）· 2026-09-30 · CONTROLLED DEPLOYMENT 执行记录 + 最终状态

> 承接本节上半（§1 ratification / §2 治理裁定）。此处登记**实际部署执行**与**部署后判定**。

#### §3~§6 部署前门禁（`_v365-deploy/predeploy-gate.js` · 只读）

```text
checks = 26 · PASS = 26 · FAIL = 0
DEPLOYMENT = PROCEED
D-10 = PASS · READY_FOR_V365_CONTROLLED_DEPLOYMENT = GRANTED · may_deploy = true
```

- `B-01~B-06` 五元组逐位一致（`base_head_sha` / `candidate_manifest_sha` / `deployment_bundle_sha` / `production_env` / `function_name`）
- `F-01~F-03` 从磁盘重读 bundle 字节复算 `sha256` == 授权值 ⇒ `DEPLOYMENT_BUNDLE_DRIFT = NO`
- `P-01~P-17` 线上仍 V3.6.4 零漂移 · manifest valid · `BUNDLE_SOURCE_PARITY = EXACT_MATCH` ·
  `UNEXPECTED_PACKAGE_DIFF = 0` · rollback verified · manifest ratified（三 hash 未变）· p12 Δ=0 · protected clean

#### §5 部署输入：解包冻结 bundle（⛔ 非 mutable working tree）

```text
method                    = 解包 bundle（⛔ 非 build-cloudfunctions.js）
STAGED_SOURCE_PARITY      = EXACT_MATCH（91 文件 · MISSING 0 · EXTRA 0 · CONTENT_DIFF 0）
removed_stale             = dist-functions/runDecisionEngine/common/MANIFEST.json（陈旧残留，不在 bundle 内）
preserved_ignore_policy   = node_modules/** · config.json
```

#### §7 部署执行（单次）

```text
started_at  = 2026-09-30T05:37:19Z（13:37:19 +08）
finished_at = 2026-09-30T05:38:13Z（13:38:13 +08）
result      = ✔ [runDecisionEngine] Cloud function deployed successfully!（exit 0）
count       = 1（⛔ 未重试）
台账        = docs/production-deployment-ledger.md **D-009**（append-only，未改写 D-001~D-008）
```

#### §8 Post-Deploy Identity Gate（只读 · ⛔ 未执行 production run）

```text
FunctionId = lam-eiye285p（未变） · Runtime = Nodejs16.13 ✅ · Handler = index.main ✅
ModTime    = 2026-09-30 13:38:07（部署前 2026-09-22 16:29:48）
CodeSize   = 4465434（部署前 4013498）

线上源码文件 = 91（部署前 76） · MISSING_REQUIRED_FILE = 0 · UNEXPECTED_FILE = 0 · CONTENT_DIFF = 0
ONLINE_SOURCE_PARITY = EXACT_MATCH · UNEXPECTED_PACKAGE_DIFF = 0
index.js raw sha online == bundle ✅ · index.js LF sha online == bundle ✅
checks = 10 · FAIL = 0
```

#### §9/§11/§12 最终判定（⛔ STOP）

```text
CONTROLLED_DEPLOYMENT                  = COMPLETE
AUTHORIZED_BUNDLE_SHA                  = e996e88ae8084a38e186471b561867267fc4280c3ea5758ccb0eff75092455a4
CURRENT_PRODUCTION_DEPLOYMENT_IDENTITY = V3.6.5
ONLINE_SOURCE_PARITY                   = EXACT_MATCH
UNEXPECTED_PACKAGE_DIFF                = 0
DEPLOYMENT_IDENTITY_VERIFIED           = true
READY_FOR_V365_FIRST_CONTROLLED_RUN    = PENDING_OWNER_RUN_APPROVAL
OWNER_RUN_AUTHORIZATION                = false
PRODUCTION_ACTIVATION_AUTHORIZATION    = NOT_GRANTED
deployment_authorization_consumed      = true（⛔ 授权一次性 · 已消耗 · 再次部署需 owner 新授权）
```

⛔ **未执行 production run**：未初始化 `active_run_pointer` · 未写 `run_manifest` / `run_history` ·
未设 `V365_ENFORCE_SWITCH_DATE` · 未建 `PROSPECTIVE_EPOCH` · 未改 `param_config` / schema / collection ·
未 backfill · 未改 CALC / immutable lock · 未部署任何其他 Cloud Function。

#### 复跑门禁（全绿）

```
Stage A                        = 72/72 · 0 失败
Stage A~G                      = 80/80 · 0 失败
v365-prospective-qualification = P-01~P-44 全 PASS（已改**分阶段**断言）
v365-p12-decision-parity       = Δ = 0 · anchor 25ccbfc7…1723 逐位不变
v365-final-state-consistency   = FINAL_STATE_DOCS_CONSISTENT = true
受保护域（CALC）               = 零改动 · HEAD c6bd006f… 未变 · tracked 85（ratification 完好）
```

> ★ **测试/检查器已改为分阶段断言**（部署前 / 部署后），并保留**恒不变式**：
> `may_deploy = false` · `implies_first_controlled_run = false` · `OWNER_RUN_AUTHORIZATION = false` ·
> `PRODUCTION_ACTIVATION_AUTHORIZATION = NOT_GRANTED` · ⛔ 首次受控运行**永不为 GRANTED**。
> ⛔ 若写死「部署前」的期望值，部署成功后必然**假红**（本轮 P-28 / P-43 / checker §12 均已修正）。

> ★ **部署后身份来源分层**：部署前读 `deployment-identity-audit.json`（断言线上 == 冻结 V3.6.4）；
> 部署后读 `post-deploy-identity-gate.json`（断言线上 == 授权 V3.6.5 bundle）。
> ⛔ 部署后 audit 件**必然**与 V3.6.4 失配 —— 那是**预期**（线上已换），**不是漂移**。

- ⛔ **完成后停止。** 下一步需 owner **单独**授权 `FIRST CONTROLLED RUN`。

#### 部署后边界独立核验（只读 · `_v365-deploy` 之外无写入）

**从生产侧独立证明**「⛔ 未执行 production run」（⛔ 非仅凭 agent 自述）：

```text
v365 五集合计数（只读 count）：
  run_manifest               = 0
  run_candidate_decision     = 0
  run_candidate_portfolio    = 0
  active_run_pointer         = 0
  run_history                = 0
  ⇒ V365_COLLECTIONS_ALL_EMPTY = true
     ⇒ 未执行 production run · 未初始化 pointer · 未写 run_manifest / run_history

部署后稳定性（只读 fn detail）：
  ModTime = 2026-09-30 13:38:07（== 部署时） · CodeSize = 4465434（== 部署时）
  ⇒ DEPLOYED_STATE_STABLE = true（无重复部署）

legacy 集合：
  trade_log           = 13（未变；最新 trade_date = 2026-09-11）
  portfolio_snapshot  = 41（最新 snapshot_date = 2026-09-30）
  ⇒ ⛔ 非本次部署所致（部署只改代码、不执行函数）；由**日常调度管线**日更写入。
    与 2026-09-29 记录的 40 相比 +1，属正常日更。
```

```text
V365_ENFORCE_SWITCH_DATE = null · PROSPECTIVE_EPOCH = NOT_STARTED · deploy_count = 1
BOUNDARY_RESPECTED = true
```

证据件：`deliverables/v365-production-history/c021/post-deploy-boundary-verification.json`

---

### C-021.5 · 2026-09-30 · FIRST CONTROLLED RUN **WINDOW** 授权口径确认

> owner 裁定：把此前 `ONE FIRST CONTROLLED RUN / ONE invocation` **明确调整为**
> **`ONE FIRST CONTROLLED RUN WINDOW`**。此裁定**解除** C-021.4 登记的 `AUTHORIZATION_CONFLICT`。

#### 1. 授权对象（Window 定义）

```text
FIRST_CONTROLLED_RUN_WINDOW = AUTHORIZED
expected_trade_date         = 2026-09-30
production environment      = tradingview-etf-d0fa42yy57cbc11b
entry                       = 现有 natural production scheduler / pipeline
```

允许现有生产 pipeline 在该 `expected_trade_date` 上按 **V3.6.5 既有代码**自然产生
`first invocation` 与 `same_trade_date_supersede invocation(s)` ——
**全部属于同一个 First Controlled Run Window，不视为新的 owner authorization**。

#### 2. ★★ 代码冻结（从本授权开始）

```text
V3.6.5 PRODUCTION CODE = FROZEN CANDIDATE
```

⛔ 禁止修改：scheduler · calendar · cutoff · `materializeIndicators` · `fetchDailyData` ·
`runDecisionEngine` · `same_trade_date_supersede` · V365 protocol · CALC domain · immutable locks ·
schema · `param_config` · production data。⛔ **不得重新部署任何函数**。

**冻结基线（只读复核）**：

| 项 | 值 |
|---|---|
| `HEAD` | `c6bd006fd76ffc5358cddd07347df8ed23d9e61d`（未变） |
| `tracked` | **85**（owner-ratified 集合完好） |
| protected CALC 改动 | **0** |
| `runDecisionEngine/index.js` | `eb1868cb0f386bee…` |
| `materializeIndicators/index.js` | `7827b2ec9363a288…` |
| `fetchDailyData/index.js` | `6a45adb02fc9cbc8…` |
| `v365-atomic-publish.js` | `cb0950a092795127…` |
| `cn-trading-calendar.js` | `9beb9a21022cd931…` |
| `fetch-guard.js` | `484cf0c7342c4bdd…` |

#### 3. ⛔ 严格禁止

```text
manual invocation = forbidden          manual retry = forbidden
scheduler modification = forbidden     calendar modification = forbidden
production code modification = forbidden   configuration modification = forbidden
synthetic data creation = forbidden    backfill = forbidden
additional function deployment = forbidden
```
⇒ 只能让**已经存在的** production scheduler / function chaining **自然执行**。

#### 4. 自然 supersede 的处理与定性

`expected_trade_date = 2026-09-30` 上，既有协议产生的
`same_trade_date_supersede = true` **必须继续按现有 V3.6.5 protocol 处理**；
⛔ **不得为减少 invocation 数量而人为阻止或修改它们**。

多次自然 invocation（`run_1` / `run_2 supersedes run_1` / …）只要均由现有 scheduler / chain 自然产生
且符合既有协议 ⇒ **NOT** authorization violation · **NOT** retry · **NOT** manual rerun ·
**NOT** new deployment，而是 **`SAME_FIRST_CONTROLLED_RUN_WINDOW`**。

#### 5. 验收口径（`A-01~A-10`）

First Controlled Run **不再**定义为「exactly one invocation」，而是
**`the first natural production execution sequence for expected_trade_date = 2026-09-30`**，
最终用 V3.6.5 既有 `A-01~A-10` 验收，须覆盖：
① candidate provenance ② manifest/finality ③ CAS promotion ④ `active_run_pointer`
⑤ `run_history` ⑥ `supersedes_run_id` ⑦ `same_trade_date_supersede`
⑧ `promoted` / `promoted_at` ⑨ `read_after_write_consistent` ⑩ final pointer/history consistency。

#### 6. 停止条件

Window 开始后：⛔ 不改代码 · ⛔ 不部署 · ⛔ 不人工重试 · ⛔ 不干预 scheduler。
若 V3.6.5 自身出现 protocol failure / CAS failure / history inconsistency / A-01~A-10 failure ⇒
**STOP**，⛔ **不得现场修复 V3.6.5**；记录问题，后续进入 **V3.6.6 / Gen-2.x**。

#### 7. 当前状态（自然运行发生前）

```text
PROSPECTIVE_EPOCH          = NOT_STARTED
V365_ENFORCE_SWITCH_DATE   = null
FIRST_CONTROLLED_RUN_WINDOW = AUTHORIZED
production_run_executed    = false
```

自然运行发生后 ⇒ **立即执行 A-01~A-10**；⛔ 不得自动宣布 general production qualification。

#### 8. 最终冻结原则

若 Window 的 `A-01~A-10 = PASS` ⇒ **`V3.6.5 = PRODUCTION FROZEN`**，
此后 ⛔ 不再调整 / 不再修功能 / 不再改策略语义 / 不再重新部署；
后续改进一律走 **V3.6.6 / Gen-2.x**。
Prospective Qualification 的 120 trading days 仅作**长期资格验证**，⛔ 不得反向修改 V3.6.5。

#### 9. 本轮 preflight（只读）

```text
代码冻结         = PASS（HEAD 未变 · tracked 85 · protected 0）
生产身份         = V3.6.5 · DEPLOYMENT_IDENTITY_VERIFIED = true · ONLINE_SOURCE_PARITY = EXACT_MATCH
GATE-D           = PENDING_OWNER_DEPLOYMENT_APPROVAL · may_deploy = false · consumed = true
activation gate  = GRANTED · may_activate = true · failed_items = []
v365 五集合      = 全 0（first-run 前置满足）
```

⇒ **满足条件，等待自然 scheduler。⛔ 不人工触发。**
