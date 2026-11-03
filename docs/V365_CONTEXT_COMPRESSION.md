# V365 Context Compression（会话状态压缩 / 续跑用）

> **用途**：把长会话压缩为**可续跑的最小充分上下文**。
> **详细过程**见 `docs/V365_PRODUCTION_READINESS_LEDGER.md`（阶段日志 C-001~C-011）。
> **终局评审**见 `docs/V365_FREEZE_REVIEW.md`。
> **基线**：HEAD `c6bd006fd76ffc5358cddd07347df8ed23d9e61d`（**全程未变**）

---

## 1. 总目标

把 V3.6.5 从 `QUALIFIED_CANDIDATE` 收口到 `READY_FOR_PRODUCTION_PROMOTION`。
⛔ 最终不 deploy / push / PR / merge / 生产建表 / 生产 DB 写入。

## 2. 当前状态（一行版）

```
已完成：HD12-0/1/1.1/2/3 · RPG-F1 · RPG-F2-A · WP-RH1 · WP-RH2 · WP-RH3 · WP-RH4 · Full Requalification
只读连接：CloudBase READ-ONLY Connector ✅ 已建并**连通**（CONNECTOR=READY · CONNECTION=VERIFIED）
          ⇒ CREDENTIAL=VALID · READ_PERMISSION=SUFFICIENT · 见 C-013
已导出：trade_log 13 行 · portfolio_snapshot 40 行（Gov. Data Gate 8/8 PASS · HASH 独立复核 MATCH）
阻塞  ：✅ `GOVERNED_PRODUCTION_HISTORY_DATA_REQUIRED` **已 CLOSED**（数据**已取得**）
        ⛔ 但**覆盖型** blocker 取代了能力型 blocker（C-014/C-015 精化）：
           · RPG-F2-B = PARTIAL / BLOCKED_ON_EXECUTION_COVERAGE（`NO_PREVIOUS_EXECUTION_RECORDS_EXIST_IN_SOURCE`）
           · RPG-F2-C = BLOCKED_ON_ACTUAL_BOOK_COVERAGE（required 25 / available 16 / missing 9）
           · RFP-V2-PH_FULL_WINDOW_AVAILABLE = false
        ⚠️ RPG-002（cooldown KNOWN_GAP）仍在 —— **NOT YET CLOSED**
终局  ：Freeze Review = 🔶 ELIGIBLE_FOR_REVIEW（⛔ 仍**未**输出 READY_FOR_PRODUCTION_PROMOTION）
HD-10 ：✅ **COMPLETE**（2026-09-29 owner APPROVED；5/5 集合 + 7/7 索引；CREATE EMPTY STRUCTURE ONLY；
        `documents_written = 0` · `production_run_triggered = false` · `pointer_initialized = false`）
F2-C  ：✅ 已裁定 `OWNER_F2C_PATH = A`（保留原窗口 + 不补造 + 允许诊断 + full-window 继续 fail-closed）
        ⛔ 但 blocker **不解**：取证确认生产最早仅 `2026-08-14`（`count == returned`，分页完整）
待做  ：(A)/(C) 已由 owner 裁定为 A → RFP-V2-PH diagnostic ✅ → Full Requalification → Freeze Review
        · RUN_HISTORY_INDEX：⛔ **PENDING**（属 POST-ACTIVATION / FIRST-NATURAL-RUN ACCEPTANCE）——
          **契约/结构（5 集合已建）/读者 RH1~RH4 ✅ 已完成**；
          **唯一缺口 = 数据侧**（生产提升未发生 + `V365_ENFORCE_SWITCH_DATE = null` ⇒ `run_axis_available = false`）
        ⛔ **「数据可读」≠「数据充分」**；**「代码就绪」/「结构就绪」≠「数据就绪」**（见 C-014 ~ C-018）
HD-9  ：✅ **CLOSED** —— `RETAIN_INDEFINITELY_FOR_V365`（⛔ 不自动删/归档/TTL/压缩）
HD-15 ：✅ **POLICY CLOSED** —— 只冻结**时点规则**，`V365_ENFORCE_SWITCH_DATE` 当前仍 **`null`**
PROD-A：⛔ `PRODUCTION_ACTIVATION_AUTHORIZATION = NOT_GRANTED`
         · `READY_FOR_PRODUCTION_PROMOTION = NOT_ISSUED`
前瞻轨：✅ **PROSPECTIVE_DESIGN_FINAL = READY_FOR_OWNER_ACTIVATION_DECISION**
        （`docs/V365_PROSPECTIVE_PRODUCTION_QUALIFICATION.md`）
        · `HISTORICAL_FULL_WINDOW_STATUS = INCOMPLETE_BY_SOURCE_HISTORY`（⛔ 非实现缺陷，是源系统事实）
        · `RFP-V2-PH-PROSPECTIVE`（`qualification_authoritative = false` · 独立 anchor）
        · `PROSPECTIVE_QUALIFICATION_STATUS = NOT_STARTED`
        · `READY_FOR_CONTROLLED_PRODUCTION_ACTIVATION = PENDING_OWNER_APPROVAL`
        · `READY_FOR_GENERAL_PRODUCTION = false`
        · ⛔ **不伪造历史**：⛔ 不求回补 9 天 · ⛔ 不改旧窗口 · ⛔ 不扩大 taxonomy
        ★ C-020 设计修正：
        · `actual_position_book_authority = portfolio_snapshot.positions[].position`（execution authority = `trade_log`）
        · `run_candidate_portfolio` = candidate_intended_portfolio_provenance（⛔ 不得作 actual book）
        · 两层 anchor：`result_sequence_sha`（⛔ 不得单独使用）+ `PROSPECTIVE_QUALIFICATION_ANCHOR`
        · CAS/history 恢复：`CAS_REJECTED` · `PROMOTED_HISTORY_INCOMPLETE`
        · `OD-P-1 = APPROVED`（MIN=120 / MAX=250 trading days；⛔ 不得自动降标）
```

## 3. 关键不变量（⛔ 续跑时必须保持）

| 项 | 值 |
|---|---|
| HEAD | `c6bd006fd76ffc5358cddd07347df8ed23d9e61d` |
| **RFP-V1 anchor** | `25ccbfc7e1b73a9a173ec36c17512c6228a2fe42685dcd291bc055ea4ed11723` |
| **RFP-V2-CF anchor** | `b87654ab81935731a4173b5f566231f6db62c3d2e2b43f74cd6c8fb93ea78832` |
| `candidate_content_sha` | `2f4b05193ff09d27bc990254e91e545dcad0d2926cf26835119b846c7cd2cade` |
| `qualification_authoritative` | **false** |
| `replay_semantics` | `COUNTERFACTUAL_ASSUMED_EXECUTION` |
| **RFP-V2-CF-COOLDOWN** | ✅ 语义 = 生产 cooldown 纯函数 `as-of-date` 复用（⛔ **不再**是 `cooldownDays: 0` 硬编码）；anchor `0db3193b297d2900aa1b32e359bbe80b80bfbf7a5b10ce0bba17a32f41dbe4f5` |
| **RFP-V2-AE** | ✅ 语义 = 显式 actual execution ledger（**Model B**：actual book 必须来自真实执行账本，⛔ 不由 `suggested_position` 推断）；anchor `5c8fb4ae7223abdc4edb9ba8267c2043d4dd22d6688e000415e1a4f1339b661d` |
| **★ `P12_PARITY_UNEXPECTED_DECISION_DELTA`** | **0**（p12 decision parity 门禁口径：逐位比对两轮 replay 的决策序列；anchor 未变） |
| **★ `RPG_F3_HISTORICAL_UNEXPECTED_DECISION_DELTA`** | **6**（= `V2-CF-COOLDOWN` 1 + `V2-AE` 5；RPG-F3 attribution 口径，⛔ FAIL fail-closed，⛔ 不扩大冻结 taxonomy） |
| **★ 二者不得混用** | ⛔ 这是**两个完全不同的 gate**，⛔ 不得共用一个笼统的 `UNEXPECTED_DECISION_DELTA`（见 prospective design §13） |
| `RPG_F3_PROSPECTIVE_UNEXPECTED_DECISION_DELTA` | `NOT_STARTED`（前瞻轨；目标 = 0，由真实 production history 达成） |
| 合格面 | **20 文件** |
| 不可改文件（零改动） | `src/common/constants.js`（CALC）· `src/common/utils/cooldown.js`（CALC）· `cloudfunctions/runGen1ShadowEod/index.js`（Gen-1 Lock 字节级冻结） |
| Stage A | **72/72**（含 `v365-hd10-authorization-boundary.test.js`） |
| Stage A~G | **80/80 · 0 失败**（PRE_PROMOTION_INTEGRITY_CLOSURE 实测） |
| **★ `CURRENT_PRODUCTION_DEPLOYMENT_IDENTITY`** | **V3.6.4**（`aa634e264270f26207c59c19ef3e1c31dde01e64` · 零漂移实测 · `PRODUCTION_DEPLOYMENT_DRIFT = NO`） |
| **★ `DEPLOYMENT_IDENTITY_VERIFIED`** | **false**（⛔ 部署前必须 false —— 线上 = V3.6.4，**并非**本轮 V3.6.5 candidate） |
| **★ `CANDIDATE_FREEZE_DESIGN`** | **COMPLETE** |
| **★ `candidate_manifest_sha`** | `8c53f93fa66bbc2768f23843530f3997e2c9d38030e58b65c2bc0d7497c501c1`（两次重算逐位一致 ⇒ deterministic） |
| **★ `V365_DEPLOYMENT_SCOPE`** | **EXACT**（`V365_DEPLOYMENT_REQUIRED_FILES` = 91 · 排除 = 69 · `changed_in_closure` = 7 · ⛔ 非 76 全量） |
| **★ rollback artifact** | `independently_verified = true`（线上包下载 → 本地复算 `index.js` 双 SHA == 台账 D-006） |

## 4. 治理机制（已建成）

| 机制 | 位置 | 要点 |
|---|---|---|
| **分类唯一来源** | `scripts/lib/v365-decision-classification.js` | CALC 46 · ORCH 34 · MIXED 1 · INFRA 1 · EXC 1 · **受保护 82**；受保护域 = `constants.js` ∪ `utils/**` ∪ `RDE/**` ∪ INFRA |
| **授权机制** | `scripts/lib/v365-orchestration-approval.js` | `CALC` ⛔绝对 · `ORCH` 需清单 · `MIXED` 需 zone 或 comment-only · `INFRA` 需 review marker · 域内 `UNCLASSIFIED` 拒 |
| **授权绑定** | 同上 | `authorization_sha` 40 位字面值 **且** == `--head-sha`；`changed_files` **精确一致**；缺 head-sha ⇒ FAIL |
| **zone 保护** | RDE 内 `// >>> v365-orch-zone: <name>` | `lifecycle_writer`(538-558/1315-1327) · `telemetry`(1424-1521/1523-1580)；`--changed-region` 做**包含性验证** |
| **comment-only 证明** | `canonicalCodeSha256()` | 去注释 + 统一换行 + 去行尾空白 + **丢空白行**（⛔ 朴素去注释会留空白 ⇒ 不可用） |
| **区域清单工具** | `scripts/v365-gen-changed-regions.js` | `git diff -U0` → `file<TAB>start<TAB>end` |

## 5. Replay 协议

> ⚠️ **下表为 RFP-V1 → RFP-V2-CF 的**历史**对比。`cooldown` 行已于
> **`RFP-V2-CF-COOLDOWN`** 中修复（生产纯函数 as-of-date 复用，⛔ **不再**是
> `cooldownDays: 0` 硬编码）；`book` 行将于 **`RFP-V2-AE`** 中由显式 actual execution ledger 驱动。
> 当前真实语义见 §3「当前真实语义」块。

| | RFP-V1 | RFP-V2-CF |
|---|---|---|
| semantics | `LEGACY_COUNTERFACTUAL_REPLAY_WITH_KNOWN_FIDELITY_LIMITATIONS` | `COUNTERFACTUAL_ASSUMED_EXECUTION` |
| book | `nextBook = suggested_position` | 同 V1（未改；⇒ **`RFP-V2-AE` 修复**） |
| `effective_tech_cap` | fallback（65） | **生产纯函数 + as-of-date**（63.1） |
| cooldown | 硬编码 0 | 同 V1（⇒ **`RFP-V2-CF-COOLDOWN` 已修复**） |
| anchor | `25ccbfc7…1723` | `b87654ab…8832` |
| `qualification_authoritative` | ✅ | ⛔ **false** |

**V1→V2-CF 归因**：9 处差异，**全部** `effective_tech_cap_fidelity`，**全部**落在 `159582`（semi_equip），cap `65→63.1`（−1.9pp）；含 1 处 `binding_constraint` 翻转（`none→sector_cap`）。`unexpected = 0`。

**登记缺口**：`RPG-001`（correlation，已 CLOSED）· `RPG-002`（cooldown，OPEN）· `RPG-003-PH`（production book，PENDING_DATA_EXPORT）。

## 6. 阻塞（✅ 已 CLOSED）

```
GOVERNED_PRODUCTION_HISTORY_DATA_REQUIRED  ⇒  CLOSED（2026-09-29 · ledger C-013）
```

**解除依据**（只读通道建立 + 受治理导出，全部交叉验证）：
- 通道：`scripts/tools/cloudbase-readonly-client.js`（零新依赖，复用 `@cloudbase/node-sdk` v2.11.0）
- 安全：只读安全测试 **R-01~R-06 全 PASS** ⇒ `CONNECTION = VERIFIED`
- 数据：`trade_log` **13** 行 · `portfolio_snapshot` **40** 行（200 position 行，**全部** actual `.position`）
- 治理：`Gov. Data Gate **8/8 PASS**` · `HASH_VERIFIED` 经 `crypto` **独立复算 MATCH** · `reconciliation = CONSISTENT`
- ⛔ 红线遵守：零生产写入 · 未用写操作"验证连接" · `deliverables/` 已 gitignored

**★ 关键技术根因（易复发，务必记住）**：`@cloudbase/node-sdk` 临时凭证字段名是 **`sessionToken`**，
不是 `token`；传错会被**静默忽略**并回落为误导性的 `SIGN_PARAM_INVALID: secret id error`
（**看起来像权限不足，实为 token 未带上**）。

## 7. 待做（顺序）

| WP | 内容 | 状态 |
|---|---|---|
| ~~**RH2**~~ | R2-a 注释 · R2-b 运行时字段 · R2-c 接线 `publishCandidateFirst()` · R2-d `run_history` 单次写入 | ✅ 已完成（ledger C-008） |
| ~~**RH3**~~ | supersede 链富化（`same_trade_date_supersede` · `promoted_from_pointer_run_id` · `read_after_write_consistent`） | ✅ 已完成（ledger C-009） |
| ~~**RH4**~~ | CLASS C 6 读点登记 · 双源 provenance（4 态 coverage）· 标记感知扫描 · 门禁加固 | ✅ 已完成（ledger C-010） |
| ~~**Requal**~~ | 全门禁 + manifest 重算 + Δ=0 | ✅ 已完成（Stage A **72/72**；PRE_PROMOTION_INTEGRITY_CLOSURE 复跑 Stage A~G **80/80**） |
| **F2-B** | cooldown fidelity（RPG-002 收口） | 🔷 **UNBLOCKED — 下一步** |
| **F2-C / RFP-V2-PH** | production historical book / replay | 🔷 **UNBLOCKED** |
| ~~**Freeze**~~ | 终局评审 | 🔶 **ELIGIBLE_FOR_REVIEW**（`docs/V365_FREEZE_REVIEW.md`） |

✅ **现已恢复自主可做项** —— 依 §19 顺序推进 F2-B → F2-C → RFP-V2-PH → Full Requalification → Freeze Review。

## 8. 授权边界（本会话有效）

✅ **已统一授权**：读写仓库 · 跑测试 · 新增/改本地代码与测试与 scripts 与 docs · 新增 evidence · **修改 REPLAY_INFRASTRUCTURE** · 建立 Replay Protocol V2 · 新 anchor · 重跑 replay · delta attribution · qualification · **manifest regeneration** · 本地 schema/contract · 本地 collection definition · isolated platform probe · 只读生产检查 · **只读生产数据导出**

⛔ **必须 STOP 请求授权**：生产写入/建表/配置 · deploy · push · PR · merge · tag/release · **策略语义修改** · **immutable lock 修改** · **推翻冻结架构裁定**

⛔ **绝对禁止（不可授权）**：`src/common/constants.js` · `src/common/utils/cooldown.js`（**CALC**）· `cloudfunctions/runGen1ShadowEod/index.js`（**Gen-1 Lock 字节级冻结**）—— 三者**连注释都不允许**改

## 9. 冻结裁定（⛔ 不得推翻）

| ID | 内容 |
|---|---|
| **OD-1 A′** | `run_history` 单表、只追加、只存**前向** `supersedes_run_id`、⛔ 无 `superseded_by_run_id`、⛔ 无 `is_active` |
| **OD-2** | `run_history` 每 run **单次写入** |
| **OD-3 A** | RDE 直接调用 `publishCandidateFirst()`（不复制协议） |
| **OD-5** | 集合名唯一来源 = `src/common/utils/v365-contracts.js::V365_COLLECTIONS` |
| **HD12-D8** | `src/common/constants.js` ∈ `DECISION_CALCULATION_CORE`（⛔ **绝对保护，无授权路径**） |
| **HD12-D6** | 引入 `REPLAY_INFRASTRUCTURE` 第三桶 |
| **RPG-D1/D2/D3** | 采用独立 V2 · 保留 V1/V2 双跑 · `EXPECTED_FIDELITY_DELTA` 仅两条 reason |
| **RPG-D5** | RPG-003 = `RPG003-A`（V1 = 合法 counterfactual，曾被误称为 production-faithful） |
| **架构** | `pointer ≠ timeline` · `run_history` append-only · `decision_result` = LEGACY_READ_ONLY_ARCHIVE · V365_COLLECTIONS 单一来源 · RDE 同步生命周期写入器 |

## 10. 纪律（本会话反复生效）

1. **先打印真实值，再判 FAIL** —— 已 6 次证明"失败在断言不在代码"
2. **静态断言前先剥离注释**（含注释里的路径/数字）
3. 区分 `IMPLEMENTATION_FAILURE` / `ASSERTION_FAILURE` / `TOOLING_FAILURE`
4. 改受保护文件必须附**机器可验证**的授权（SHA 绑定 / comment-only 指纹 / zone 包含性）
5. 每次改动后跑全量：Stage A · qualification · parity · reader migration · manifest · immutable · Gen-1 · Gen-2 + 专项测试

## 11. 文件清单（本会话新增）

**治理**：`scripts/lib/v365-decision-classification.js` · `scripts/lib/v365-orchestration-approval.js` · `scripts/v365-gen-changed-regions.js`
**探针/认证**：`scripts/v365-rpg001-tech-cap-probe.js` · `scripts/v365-rpg002-execution-semantics-probe.js` · `scripts/v365-rpg003-state-evolution-probe.js` · `scripts/v365-replay-v2cf-attest.js`
**测试**：`tests/v365-decision-classification.test.js`(C) · `tests/v365-orchestration-approval.test.js`(B) · `tests/v365-orch-zone.test.js`(D) · `tests/v365-rpg-f2a.test.js`(A) · `tests/v365-rh1-contract-registry.test.js`(E) · `tests/v365-rh2-runtime-fields.test.js`(F)
**文档**：`V365_DECISION_DEPENDENCY_CLASSIFICATION` · `V365_PARITY_GATE_REFACTOR_DESIGN` · `V365_REPLAY_FIDELITY_REPAIR_DESIGN` · `V365_RPG_F1_PROBE_EVIDENCE` · `V365_RPG003_STATE_EVOLUTION_AUDIT` · `V365_RPG_F2A_REPLAY_INFRA_CHANGE_RECORD` · **`V365_PRODUCTION_READINESS_LEDGER`** · 本文件

## 12. 门禁基线（续跑后须复现）

> 以下值为 **2026-09-29 实测**（Final State Consistency Cleanup 采集），与 §3 上方取值同源。

```
Stage A                        = 72/72（72 个 tests/*.test.js 文件全通过，0 FAIL）
Stage A~G 汇总                 = 80/80 · 0 失败（PRE_PROMOTION_INTEGRITY_CLOSURE 实测）
v365-qualification-gate        = PASS 38/38
v365-p12-decision-parity       = P12_PARITY_UNEXPECTED_DECISION_DELTA 0 · anchor 25ccbfc7…（未变）
verify-immutable               = PASS（23/23 项锁定）
verify-gen1-pipeline           = PASS（10/10）
verify-gen2-build-artifacts    = PASS（7/7）
verify-v365-candidate-manifest = PASS（20 文件）
v365-reader-migration-gate     = PASS（8/8）
v365-p3-atomic-publish-gate    = PASS
专项：C-01~C-17 · B-01~B-17 · D-01~D-10 · A-01~A-10 · E-01~E-12 · F-01~F-12 · G-01~G-11 · H-01~H-12 · K-01~K-10 · P-01~P-34 · schema-parity(34 集合) · gen1-ge03 = 全 PASS
tracked-file count             = 85（`git status --porcelain -uall` 去目录后的文件数；C-021.1 当前真值）
── ★ C-021 DEPLOYMENT IDENTITY & CANDIDATE FREEZE ──
CANDIDATE_FREEZE_DESIGN        = COMPLETE
CURRENT_PRODUCTION_DEPLOYMENT_IDENTITY = V3.6.4（aa634e2 · 零漂移实测）
READY_FOR_V365_CONTROLLED_DEPLOYMENT (GATE-D) = PENDING_OWNER_DEPLOYMENT_APPROVAL（may_deploy = false）
READY_FOR_V365_FIRST_CONTROLLED_RUN (GATE-R)  = BLOCKED_ON_DEPLOYMENT_IDENTITY
DEPLOYMENT_IDENTITY_VERIFIED   = false（⛔ 部署前必须 false）
candidate_manifest_sha         = 8c53f93fa66bbc2768f23843530f3997e2c9d38030e58b65c2bc0d7497c501c1
V365_DEPLOYMENT_SCOPE          = EXACT（91 进包 / 69 排除 · changed_in_closure = 7）
rollback artifact              = independently_verified = true（线上包下载 → 本地复算双 SHA == 台账 D-006）
owner_run_authorization        = false（G-16 由 owner_authorization 改名；⛔ 部署授权 ≠ 运行授权）
G-25 deployment_identity_verified = false（⛔ 部署前必须 false）
── ★ C-021.1 PRE_DEPLOY_ARTIFACT_MATERIALIZATION ──
DEPLOYMENT_ARTIFACT_MATERIALIZED = true
DEPLOYMENT_BUNDLE_SHA          = e996e88ae8084a38e186471b561867267fc4280c3ea5758ccb0eff75092455a4
BUNDLE_SOURCE_PARITY           = EXACT_MATCH（MISSING_REQUIRED_FILE=0 / UNEXPECTED_FILE=0 / CONTENT_DIFF=0）
UNEXPECTED_PACKAGE_DIFF        = 0
required_file_count            = 91 · bundle_size = 1161728 · bundle_format = ustar-deterministic
D-08 deployment_artifact_materialized = PASS · D-09 deployment_artifact_exact_match = PASS · D-10 owner_deployment_authorization = ⛔ NOT_GRANTED
BLOCKED_ON_DEPLOYMENT_ARTIFACT = （fail-closed 分支：bundle 生成前 / 未 exact match 时；当前已越过）
previous（线上 V3.6.4）package_sha256 = aa576c20599528a66737f154b31b8cca87f25c1cf50068093bc243ed7084caea
DEPLOYMENT_ROLLBACK_BINDING    = BOUND（previous_package_sha + new_bundle_sha 同 plan）
three-layer identity binding   = base_head_sha（provenance）+ candidate_manifest_sha + deployment_bundle_sha
                                 ⛔ 仅绑 HEAD SHA 的授权一律 REJECTED
[HISTORICAL SNAPSHOT]          = 阶段日志段（## C / ## E）均为历史快照，⛔ 不得作 current state 引用
gate_log_integrity             = 门禁日志**计数绑定真值 + 新鲜度**（★ §9 同源加固；⛔ 不得只做形态匹配）
── ★ C-021.2 CONTROLLED DEPLOYMENT（已执行 · 单次 · runDecisionEngine only）──
CONTROLLED_DEPLOYMENT          = COMPLETE
AUTHORIZED_BUNDLE_SHA          = e996e88ae8084a38e186471b561867267fc4280c3ea5758ccb0eff75092455a4
CURRENT_PRODUCTION_DEPLOYMENT_IDENTITY = V3.6.5（deployed 2026-09-30T05:38:13Z）
ONLINE_SOURCE_PARITY           = EXACT_MATCH（91 文件 · MISSING 0 · UNEXPECTED 0 · CONTENT_DIFF 0）
POST_DEPLOY_UNEXPECTED_PACKAGE_DIFF = 0
DEPLOYMENT_IDENTITY_VERIFIED   = true（★ 部署后由 post-deploy gate 置 true；部署前必须 false）
READY_FOR_V365_FIRST_CONTROLLED_RUN = PENDING_OWNER_RUN_APPROVAL
OWNER_RUN_AUTHORIZATION        = false（⛔ 本授权不含 first run）
PRODUCTION_ACTIVATION_AUTHORIZATION = NOT_GRANTED
deployment_authorization_consumed = true（⛔ 授权一次性 · 已消耗 · 再次部署需 owner 新授权）
AUTHORIZATION_SCOPE_RATIFIED_BY_OWNER = true · changed_files_count = 85
deploy: FunctionId=lam-eiye285p · Runtime=Nodejs16.13 · Handler=index.main
        ModTime=2026-09-30 13:38:07 · CodeSize=4465434（部署前 4013498）
⛔ 未执行 production run · 未初始化 pointer · 未写 run_manifest/run_history · 未设 switch date
```

⚠️ **历史基线注**：ledger 各阶段曾记录 62/62 → 63/63 → 64/64 → 65/65 → 66/66 → 67/67 → **68/68**
（每新增一个 `tests/*.test.js` 文件即 +1）。**65/65 是 RH2 完成时（C-008）的过期值**，非当前真值。
**68/68** 为新增 `tests/v365-cloudbase-readonly.test.js`（K-01~K-10）后的当前真值。
