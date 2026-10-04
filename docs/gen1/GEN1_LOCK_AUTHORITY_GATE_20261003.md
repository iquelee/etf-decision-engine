# Gen-1 —— LOCK AUTHORITY GATE（第十轮后置 · Owner Decision / Lock Authority）

> **性质**：只读裁定材料。本件**不修改**任何生产代码 / 配置 / 锁 / manifest / authority / DB。
> **上游**：`docs/gen1/GEN1_OWNER_DECISION_GATE_20261003.md`（`8e9a159`）、`docs/gen1/GEN1_C3_C2_ARCHITECTURE_DECISION_20261003.md`（`6d7ef89`）、`docs/gen1/GEN1_DEPLOYMENT_GOVERNANCE_DECISION_20261003.md`（`6d7ef89`）。
> **范围**：① `LC-R2-1` 锁权威歧义的 8 问只读调查；② `C2` 最终选择材料（13 维）；③ `P1–P5` Owner Decision 候选项。
> **本件产出两个待裁定量**：`LC_R2_1_DECISION = PENDING` · `C2_OWNER_SELECTION = PENDING`。

---

## §0 方法与证据分级

| 等级 | 含义 | 本件用途 |
|---|---|---|
| `git-object` | 由 `git show <ref>:<path>` / `git log --follow` / `git show --stat` 直接取得，可逐位复核 | 历史权威关系、先例时间线 |
| `worktree-read` | 工作区实读（SHA 可按 `hash_basis` 复算） | 锁/manifest/脚本现状 |
| `runtime-static` | 只读静态校验器**实跑**（无写、无部署） | `verify-gen1-pipeline.js` G1-B |
| `governance-artifact` | 仓库内第三方治理文档（报告 / CI 门表 / 章程） | 交叉印证 |
| `self-authored` | 本仓 20261003 自建件 | ⛔ **不得**作为独立权威源 |

**本件新增关键实测（N-1…N-11）**

| ID | 实测 | 等级 |
|---|---|---|
| N-1 | `GEN1_FEATURE_PIPELINE_LOCK.json` 的 `rule` 逐字列 **9 个域**（指标/阶段/PARAMS/特征构建/RS20/schema/sector 映射/数据健康/域策略） | `worktree-read` |
| N-2 | 同一锁 `files[]` 恰 **4 个 sha256 绑定**：`indicators.js` · `trend-stage.js` · `runGen1ShadowEod/index.js` · `runGen1ShadowEod/frozen-manifest.json` | `worktree-read` |
| N-3 | ★ **生产者自述与其产出不一致**：`scripts/gen-gen1-pipeline-lock.js` 头注释写 **7 域**（指标实现/阶段实现/PARAMS/特征构建/RS20 计算/特征 schema/sector 映射）——⛔ **不含**数据健康、域策略；而其 `rule` 字符串写 **9 域** | `worktree-read` |
| N-4 | ★ **全仓无任何代码读该锁的 `.rule`**（`grep -rn "\.rule\b"` 在 pipeline lock 上零命中；仅 `scripts/v364-freeze-manifest.js:240` 做通用字段转发 `rule: candidate.rule`） | `worktree-read` |
| N-5 | G1-B **实跑 10/10 PASS**（rc=0）；锁 LF sha256 = `8efdda6fadb7da409c4d6215851495cf63dec4904a371d3bf5fff82008a2b7ad` **≡** `verify-gen1-pipeline.js::ROOT_ANCHOR_PIPELINE_LOCK` **≡** `GEN1_RUNTIME_BUNDLE.feature_pipeline_hash` | `runtime-static` |
| N-6 | `gen1-data-health.js` LF sha256 = `adc85945411438cc41fe882ee8741024…`；该文件**未出现在任何锁的绑定集** | `worktree-read` |
| N-7 | ★★ **结构耦合**：`cloudfunctions/runGen1ShadowEod/index.js`（**已绑定**）`require` 了 `./common/utils/gen1-data-health` 与 `./common/utils/gen1-domain-permission`（**均未绑定**）——绑定集在**传递语义上不封闭** | `worktree-read` |
| N-8 | `rule` 自建立（`2690085`，2026-09-10 09:52:36）起**逐字未改**；历史**唯一**一次锁变更 `aaeb5cb` = `files[]` 内 `feature_builder_and_params` 的 sha 更新，⛔ 未触碰 `rule` | `git-object` |
| N-9 | ★★ **既有先例**：`gen1-data-health.js`（点名域「数据健康」）在封存**同日** `4e1d370`（2026-09-10 13:58:51）被修改，`git show --stat` 实测**未触碰** lock / bundle | `git-object` |
| N-10 | `gen1-safety-permission.js`（`derived.permission_version` 点名）封存后 **5 提交**，其中 `cda255b`/`b6da0a3`/`b7247f9` **均不触锁**；`gen1-domain-permission.js` 被改 35+/35− 后，锁内 `derived.domain_policy_version` **仍为 `gen1-domain-policy-v1`（未 bump）** | `git-object` |
| N-11 | `GEN1_FEATURE_PIPELINE_LOCK.json` **无任何审批字段**（无 `approved_by`/`approved_at`/`updated_at`）；`ml/manifests/` 内唯一同形制品 = `GEN1_GUARDED_EFFECTIVE_FREEZE.json`（`approved_by`/`approved_at`/`bindings_status`/`change_rule`） | `worktree-read` |

**★ 纪律声明**：本件⛔ **不得**以「`files[]` 没有它 ⇒ 不受管」结案（owner 令）；⛔ 不得自行选择 A+B / A+C；⛔ 不得把「已在本件被描述」当作 implementation authorization。

---

## §1 `LC-R2-1` 八问逐项调查

### §1.1 Q1 —— 本仓库关于 lock authority 的正式定义来源

**结论：不存在统一的正式定义源。**

| 检索 | 结果 |
|---|---|
| `grep -rln "lock authority\|受管域\|受管变更\|managed domain\|authority source"` | 仅命中本仓 20261003 自建件（`GEN1_DEPLOYMENT_GOVERNANCE_DECISION_20261003.md`、`GEN1_OWNER_DECISION_GATE_20261003.md`）⇒ **`self-authored`，⛔ 不构成独立定义源** |
| `docs/` 下是否有「锁权威」专章 | ⛔ 无 |
| `ml/` 下是否有锁规范 | `ml/FREEZE_CHARTER.md`（四条硬纪律）· `ml/gen1/README.md`（"Do not edit model / features / thresholds here."）——**均未定义 `rule` 与 `files[]` 的关系** |

**现存 5 处「近似定义源」，全为局部声明：**

| # | 来源 | 声明内容 | 等级 |
|---|---|---|---|
| a | 各锁自带的 `rule` / `freeze_rule` 文本 | 变更纪律正本（散文式） | `worktree-read` |
| b | `scripts/gen-gen1-pipeline-lock.js` 头注释 | **生产者自述范围 = 7 域** | `worktree-read` |
| c | `scripts/verify-gen1-pipeline.js`（`ROOT_ANCHOR_PIPELINE_LOCK` + 头注释「两级校验（防止『文件 + 锁一起改』绕过）」） | **执行权威** | `worktree-read` |
| d | `docs/Test-And-CI-Gates.md` §G1-B | 门描述：域 = 指标/阶段/PARAMS/特征构建/schema（**5 域**）+"9 项" | `governance-artifact` |
| e | `ml/FREEZE_CHARTER.md`（2026-08-30 生效） | 硬纪律 1：禁改「模型、特征、标签、校准、阈值」；硬纪律 4：Gen-2 无资格改 Gen-1 manifest/工件（校验器 `scripts/ml/assert-gen1-immutable.py`）——**范围⛔ 不含「数据健康」** | `governance-artifact` |

⇒ **这正是 `LC-R2-1` 成为「制度级问题」的根因**：冲突时**无成文 tiebreaker**。

### §1.2 Q2 —— `rule` 与 `files[]` 在历史审批/冻结流程中的实际权威关系

| 事实 | 证据 |
|---|---|
| 历史**唯一**一次锁变更 = `aaeb5cb`（wp-g1.1，2026-09-10） | 该提交对锁的 diff **只改 `files[feature_builder_and_params].sha256`**（`db1b741c…` → `485244e4…`），`rule` 行零变化 |
| `rule` 自 `2690085`（2026-09-10 09:52:36，锁建立）起**逐字未改** | `git log -p --follow` 仅 2 个 commit，`rule` 仅在建立时新增一次 |
| **无代码消费 `.rule`** | N-4 |
| **无审批记录机制** | N-11：本锁无 `approved_by`/`approved_at`/`updated_at` |
| 本仓对「审批动作」的成文范式 | `GEN1_GUARDED_EFFECTIVE_FREEZE.json.change_rule` 逐字：「升级/回退只能通过 **PR 显式修改**本文件（**等同显式审批动作**），不得运行时改写。」 |

⇒ **实际权威关系 = `files[]` 触发变更、`rule` 从未作为触发依据**；但**没有任何成文规范**声明「`rule` 不是依据」。⇒ 「实际如此」≠「规范如此」，二者本件分开记录。

### §1.3 Q3 —— 各制品的语义分工

| 制品 | 语义 | 关键字段 |
|---|---|---|
| `GEN1_FEATURE_PIPELINE_LOCK.json` | 特征管线冻结清单 = **字节级绑定** + **声明性纪律** | `files[]`(4×sha256) · `derived`(8 项) · `rule`(9 域散文) · `hash_basis` · `sealed_at` |
| `GEN1_IMMUTABLE_LOCK.json` | Gen-1 **frozen 模型工件**（3 键） | `model_sha256` · `freeze_manifest_sha256` · `inference_sha256` · `rule`（"Gen-2 must not modify these hashes. Challenge via new model_id only."）· `updated_at: 2026-09-09` |
| `V361_IMMUTABLE_LOCK.json` | V3.6.1 决策核心 2 文件 | `decision_v3_sha256` · `decision_sha256` |
| `V364_IMMUTABLE_LOCK.json` | **最高形态**（本仓现有最佳范式） | `files`(17) · `sha256`(17) · `explicitly_not_included`(9 条) · `freeze_scope`（逐字含「**不包含**：PR 合并授权、CloudBase 部署授权、线上 `param_config` 修改授权…」）· `gate_a_must_not_be_read_as` · `self_reference_policy` · `next_authorizations_required` |
| **approval record** | ⛔ 本锁**无**；唯一同形制品 = `GEN1_GUARDED_EFFECTIVE_FREEZE.json`（`status: PENDING` · `approved_at: null` · `approved_by: null` · `bindings_status: INCOMPLETE`） | ⇒ 「审批」在本仓的**唯一成文载体形态** |
| **binding files** | 被 `files[]` 绑定的 4 个文件；★ `runGen1ShadowEod/frozen-manifest.json` **被两把锁双重绑定**（`GEN1_IMMUTABLE_LOCK.freeze_manifest_sha256` ∧ `FEATURE_PIPELINE_LOCK.files[feature_schema_and_thresholds]`） | — |
| `derived` 版本标签 | 8 项中**仅 2 项有消费者**：`feature_schema_sha256`（G1-B 校验）· `threshold_signal_p`（G1-B ⑤ 阈值一致性）；`threshold_version` 被 `gen1-guarded-seal.js:56` 以常量注释引用；其余 **5 项（`calibration_version`/`domain_policy_version`/`permission_version`/`authority_version`/`circuit_breaker_version`）全仓零消费者** | — |

### §1.4 Q4 —— 历史上是否存在「`rule` 覆盖 > `files[]` 绑定」的合法案例

**结论：是，且是制品出厂即有的状态（非事后漂移）。**

**域 → 文件映射实测（9 域 vs 4 绑定）**

| `rule` 点名域 | 落点 | 是否绑定 |
|---|---|---|
| 指标 | `src/common/utils/indicators.js` | ✅ |
| 阶段 | `src/common/utils/trend-stage.js` | ✅ |
| PARAMS | `cloudfunctions/runGen1ShadowEod/index.js` | ✅ |
| 特征构建 | `runGen1ShadowEod/index.js` | ✅ |
| RS20 | `runGen1ShadowEod/index.js:131`（`rs_20d: clean(rs20)`） | ✅ |
| schema | `runGen1ShadowEod/frozen-manifest.json` | ✅ |
| sector 映射 | `frozen-manifest.json`（`features_cat` 含 `sector`） | ✅ |
| **数据健康** | `src/common/utils/gen1-data-health.js` | ⛔ **无绑定** |
| **域策略** | `src/common/utils/gen1-domain-permission.js` | ⛔ **无绑定**（仅 `derived.domain_policy_version` 版本标签） |

⇒ **7/9 可映射到 4 绑定文件；2/9 零绑定。** 且 **N-3 显示生产者头注释只写 7 域** ⇒ 同一制品内**三处口径**（头注释 7 域 / `rule` 9 域 / `files[]` 4 文件）。

**时间线先例（`git-object`，均可逐位复核）**

| 时间 | 事件 | 是否更新锁 | 门禁状态 |
|---|---|---|---|
| 2026-09-10 09:52:36 | `2690085` 建立锁（`rule` 已含 9 域，`files[]` 已为 4 项） | — | — |
| 2026-09-10 10:44:07 | `aaeb5cb` wp-g1.1 | ✅（仅 `files[]` 内一个 sha） | — |
| **2026-09-10 13:58:51** | **`4e1d370` 改 `gen1-data-health.js`（点名域「数据健康」）** | ⛔ **未更新** | 无转红记录 |
| — | `cda255b` / `b6da0a3` / `b7247f9` 改 `gen1-safety-permission.js` | ⛔ 均未更新 | 无转红记录 |
| — | `aaeb5cb` 改 `gen1-domain-permission.js`（35+/35−） | 锁虽同批变更，但改的是**另一文件**的 sha；`domain_policy_version` **未 bump** | 无转红记录 |
| 现在 | 只读实跑 | — | **G1-B 10/10 PASS** |

⇒ 就**事实层面**：「`rule` 覆盖 > `files[]` 绑定」是本仓**既有、被接受、未被门禁拦截**的合法状态。
⚠️ 边界：这不证明该状态**规范上正确**——它同时可解释为「既有治理债」。⛔ 本件**不判定**哪种解释成立。

### §1.5 Q5 —— 二者冲突时，哪个字段能合法决定「某文件是否属受管域」

**两方证据齐备、互斥，且无 tiebreaker。**

**支持 §清单（`files[]`）为准**

1. **执行权威只在绑定集**：`verify-gen1-pipeline.js` 逐项遍历 `lock.files`；`rule` 无代码消费（N-4）。G1-B 项数 = ①root anchor 1 + ②4 文件 4 + ③schema 1 + ④bundle 3 + ⑤阈值 1 = **10**（`docs/Test-And-CI-Gates.md` 记「9 项」为 G1.1 前口径）⇒ **`rule` 对门禁贡献 0 项**。
2. **生产者自述 = 7 域**（N-3），恰等于 4 绑定文件。
3. **CI 门描述只列 5 域**（③/④ 与 4 文件一一对应）。
4. **独立治理报告把锁表述为「4 文件」**：`GEN1_PRODUCTION_READINESS_REPORT_20260910.md:118`（"`GEN1_FEATURE_PIPELINE_LOCK.json`（4 文件）+ root anchor + derived schema hash"）· `GEN1_PRODUCTION_READINESS_REPORT_V2.md:56`（"G1-B Feature Pipeline Lock | **4 文件** + root-of-trust + schema + bundle 指向 + 部署侧阈值 == frozen 阈值 | **10/10 PASS**"）。
5. **既有先例**（N-9/N-10）：点名域已发生过未更新锁的变更。

**支持 §文本（`rule`）为准**

1. `rule` 使用**无条件式**：「**任何** role 文件变更（…数据健康…）都**必须**显式更新本锁并走审批；不得静默修改。」
2. `rule` **从未被撤下** ⇒ 仍在册、仍是唯一的成文变更纪律。
3. 同仓**更高形态锁**（`V364_IMMUTABLE_LOCK.json`）把 `rule` / `freeze_rule` 当作**纪律正本**：「本文件一经冻结即不得静默修改。任何对 V3.6.4 冻结集的扩展或挑战，必须升版…」⇒ 本仓确有「以 rule 文本为准」的先例形态。
4. ★★ **结构耦合（N-7）**：`runGen1ShadowEod/index.js`（**已绑定**）`require` 了 `gen1-data-health` 与 `gen1-domain-permission`（**均未绑定**）⇒ **绑定集在传递语义上不封闭**：改未绑定模块会改变**已绑定文件的行为**，而绑定文件**字节不变** ⇒ **锁检测不到**。而 `rule` 的 9 域，**恰是把这些「行为依赖的域外模块」写入纪律** ⇒ `rule` 可能是**刻意的语义层覆盖**，而非笔误。

**裁定**

```text
LC_R2_1_DECISION = PENDING
```

**登记三个候选读法（owner 三选一，⛔ 本件不选边）**

| 代号 | 读法 | 若成立，R2 的处置 |
|---|---|---|
| `LC-A` | **文本为准**：`rule` 的 9 域为受管域权威枚举 | R2 = 受管变更：须更新锁 + 走审批 |
| `LC-B` | **清单为准**：`files[]` 为封闭枚举，`rule` 为示例性描述 | R2 = 普通代码变更流程（但仍属 `OWNER_DECISION_MATRIX` 的 **R2 风险等级**） |
| `LC-C` | **双层分工**：`files[]` = 字节绑定层；`rule` = 行为依赖层（覆盖绑定文件的传递依赖） | R2 = 受管变更，但落点不是「加绑定」而是「登记行为依赖域」，锁形态需先升级 |

⚠️ **`LC-C` 的支持证据是本件新增的最强结构性证据（N-7）**；但 `LC-B` 的支持证据更**多**且**有实证先例**。**证据强度 ≠ 裁定**，故维持 `PENDING`。

**⛔ 明确禁止**：不得以「`files[]` 没有它 ⇒ 不受管」为由结案；亦不得以「生产者头注释没写它 ⇒ 不受管」为由结案。

### §1.6 Q6 —— R2 若改 `gen1-data-health.js`，是否**必须**更新该锁

**结论：不可判定，取决于 §1.5 的三选一。**

| 分支 | 触发条件 | R2 流程 |
|---|---|---|
| **必须更新** | 裁定 `LC-A` 或 `LC-C` | 受管变更：锁更新 + 审批（见 §1.7） |
| **不必更新** | 裁定 `LC-B` | 普通代码变更流程（见 §1.8） |

★ **两分支共同点**：R2 仍受 **`OWNER_DECISION_MATRIX` 的 `R2` 风险等级 = `IMPLEMENTATION REQUIRES EXPLICIT OWNER AUTHORIZATION`** 门控 ⇒ **无论哪支，`C3_IMPLEMENTATION = BLOCKED`**。

### §1.7 Q7 —— 若「必须更新」：最小变更面 / 审批 / freeze / 对 C-1 的影响

> **本小节为假设式分析，⛔ 未执行、⛔ 未授权。**

**最小变更面 = 4 文件**（少一个即不成立）

| # | 文件 | 变更 | 若不改的后果 |
|---|---|---|---|
| 1 | `ml/manifests/GEN1_FEATURE_PIPELINE_LOCK.json` | `files[]` 追加 `{"role": "…", "path": "src/common/utils/gen1-data-health.js", "sha256": "adc85945411438cc41fe882ee8741024…"}` | 锁不覆盖该文件 |
| 2 | `scripts/gen-gen1-pipeline-lock.js` | `PIPELINE_FILES` 常量追加同一项；★ 头注释 7 域须同步对齐（否则**生产者自述仍与产出矛盾**，即 N-3 不消除） | **下次重生成会丢项**（生成器会覆盖锁文件） |
| 3 | `scripts/verify-gen1-pipeline.js` | `ROOT_ANCHOR_PIPELINE_LOCK` 更新为新锁 sha | G1-B ①项 FAIL |
| 4 | `ml/manifests/GEN1_RUNTIME_BUNDLE.json` | 重生成；`feature_pipeline_hash` 由 `8efdda6f…` 变为新值 | G1-B ④项 FAIL |

**项数变化**：G1-B **10 → 11 项**。
**辅助面**：`tests/v361-safety-hardening.test.js` 仅校验 `trend_stage_implementation` 绑定 ⇒ **无需改动**。

**所需审批 —— 现状：⛔ 该锁无审批载体**

| 事实 | 含义 |
|---|---|
| 本锁**无** `approved_by` / `approved_at` / `bindings_status` | ⛔ 结构与 `GEN1_GUARDED_EFFECTIVE_FREEZE.json` 不同 ⇒ **无法在锁内记录审批** |
| 本仓成文范式（`GEN1_GUARDED_EFFECTIVE_FREEZE.change_rule`） | 「只能通过 **PR 显式修改**本文件（等同显式审批动作）」 ⇒ **「PR 显式修改」= 审批动作** |
| ★ 推论 | 若 owner 要求「可审计的自然人审批」，则**须先给本锁补 approval 字段**（形态参照 `GUARDED_EFFECTIVE_FREEZE`）⇒ 这是**独立的治理缺口**，⛔ 不得与本轮锁更新合并执行 |

**是否产生新 freeze / baseline**

| 对象 | 是否变化 |
|---|---|
| **pipeline baseline** | ✅ **是** —— `feature_pipeline_hash` 变更 ⇒ 新管线基线 |
| 模型冻结 | ⛔ **否** —— `model_id` / `model_sha256` 不变 |
| schema | ⛔ **否** —— `frozen-manifest.json` 不变 ⇒ `feature_schema_sha256` 不变 |
| 阈值 | ⛔ **否** —— `threshold_signal_p` / `threshold_version` 不变 |

**对 C-1 的影响：✅ 是（加重）**
C-1 现由 `C-3`（含 `C3-γ → R2`）与 `C-2` 前置。若「必须更新锁」成立，C-1 **再增一道前置**：管线基线重签 + G1-B 项数变化 + 新 `feature_pipeline_hash` 的登记。⛔ **不改变** C-1 的性质（仍是 `DEGRADED → OK + 显式 ACTIVE` 的 latch 写入）。

### §1.8 Q8 —— 若「不必更新」：仓库内既有、可验证的规范依据

> ⛔ 本小节列出的是**支撑候选读法 `LC-B` 的证据**，**不是裁定**。

| # | 依据 | 逐字/实测 |
|---|---|---|
| E-1 | `scripts/gen-gen1-pipeline-lock.js` 头注释 | 「冻结「模型之外」的输入语义：指标实现、阶段实现、Gen-1 PARAMS、特征构建、RS20 计算、特征 schema、sector 映射。」= **7 域**，⛔ 不含数据健康/域策略 |
| E-2 | `docs/Test-And-CI-Gates.md` §G1-B | 「`scripts/verify-gen1-pipeline.js`（指标/阶段/PARAMS/特征构建/schema + root-of-trust，9 项）」= **5 域** |
| E-3 | `docs/gen1/GEN1_PRODUCTION_READINESS_REPORT_20260910.md:118` | 「`GEN1_FEATURE_PIPELINE_LOCK.json`（**4 文件**）+ root anchor + derived schema hash」 |
| E-4 | `docs/gen1/GEN1_PRODUCTION_READINESS_REPORT_V2.md:56` | 「**G1-B** Feature Pipeline Lock \| **4 文件** + root-of-trust + schema + bundle 指向 + 部署侧阈值 == frozen 阈值 \| **10/10 PASS**」 |
| E-5 | **实证先例** | `4e1d370`（2026-09-10 13:58:51）改 `gen1-data-health.js` 而**未更新锁**，且无门禁转红 |

⚠️ **证据冲突未消解**：E-1/E-2 与 `rule` 的 9 域**同源互斥**（同一制品的生产者注释 vs 生产者产出的字符串）⇒ 这正是 §1.5 维持 `PENDING` 的理由。

### §1.9 `LOCK_AUTHORITY` —— 证据支持的结论（描述性，非裁定）

```text
LOCK_AUTHORITY            = TWO_TIER__NO_FORMAL_TIEBREAKER
LOCK_AUTHORITY_ENFORCEMENT= FILES_BINDING_PLUS_DERIVED_PLUS_ROOT_ANCHOR
LOCK_AUTHORITY_SCOPE_TEXT = RULE_PROSE_9_DOMAINS_UNENFORCED
LOCK_AUTHORITY_TIEBREAKER = ABSENT
LOCK_AUTHORITY_INTERNAL_INCONSISTENCY = PRESENT
```

⇒ `LOCK_AUTHORITY_INTERNAL_INCONSISTENCY = PRESENT` 的含义（逐字）：同一制品内**三处范围声明互不一致** —— 生产者头注释 **7 域** vs `rule` **9 域** vs `files[]` **4 文件**。

**逐字陈述**：本仓的锁权威是**两层结构**——**执行权威**唯一落在 `files[]`（4 个 sha256 绑定）+ `derived`（8 项，其中 2 项被 G1-B 消费）+ `verify-gen1-pipeline.js::ROOT_ANCHOR_PIPELINE_LOCK`，是唯一可被机器验真的集合（G1-B 实跑 10/10）；**声明性范围文本**落在 `rule`（9 域），全仓无代码消费、自建立以来逐字未改。**二者范围不等**（9 域 vs 4 文件），且**同一制品的生产者自述（7 域）与 `rule`（9 域）互相矛盾**。仓库内**不存在**任何定义「冲突时谁合法」的成文规范。就**事实层面**，「`rule` 覆盖 > `files[]` 绑定」已有**被接受、未被门禁拦截**的先例（`4e1d370`）。因此：

- 证据**不足以**判定「`rule` 文本即受管判定依据」；
- 证据**亦不足以**判定「未绑定 ⇒ 不受管」（且此路径被 owner 明令禁止、且无规范依据）；
- ⇒ `LC_R2_1_DECISION = PENDING`，需 owner 在 `LC-A` / `LC-B` / `LC-C` 中**显式三选一**。

---

## §2 `C2` 最终选择材料（13 维 · ⛔ 不排名 · ⛔ 不选边）

### §2.1 `promote-*.js` 定性复核（owner 特别指出的检查项）

**结论：`C` = `production mutation utility`，⛔ **不是** governance channel。**
（⛔ 不因「能写 DB」而自动认定为 governance channel。）

| # | 证据 | 实测 |
|---|---|---|
| 1 | **actor** | 机器凭据（SDK `secretId`/`secretKey`），三个脚本**无 operator / reviewer 字段** ⇒ ⛔ 无自然人身份 |
| 2 | **reason** | 仅静态 `description` 文案 ⇒ ⛔ 无枚举值 |
| 3 | **evidence reference** | ⛔ 全无 |
| 4 | **state** | 三脚本**均不写 `prev_value`**；`promote-v361-cutover.js:54` 与 `promote-ml-shadow-observe.js:61` **硬编码 `version: 1`** ⇒ `version` **非单调** |
| 5 | **authority decision** | 脚本**不 `require` `gen1-authority.js`**、**不查** `FROZEN_PARAM_KEYS` ⇒ 经 SDK **绕过** `adminGateway.updateParam` 的冻结拒写 |
| 6 | **correlation id** | ⛔ 无 |

★ **反直觉反向对照**：同一 `param_config` 若走 `adminGateway.updateParam`（`cloudfunctions/adminGateway/index.js:607+`）**反而有** `prev_value: old.value` + `version = (old.version \|\| 0) + 1`（单调）⇒ **管理后台路径的留痕强于 promote 脚本路径**。

★ **治理指定落差 `GOV-GAP-C`（独立登记，⛔ 不在本轮修）**：`src/common/constants.js:61-74`（`FROZEN_PARAM_KEYS`）注释逐字称「提权 / 回退一律走**专门、可审计**的 promotion 脚本（`scripts/promote-*.js` 一类，直连写库且留痕）」⇒「**可审计**」是**已被治理文档声明、但未被实现兑现的承诺**。

**⇒ 若选 `A+C`，其形态是「骨架复用 + 目标集合更换 + 治理能力从零重建」，⛔ 不是「原样扩展现有能力」。**

### §2.2 13 维对照表

| # | 维度 | **A+B**（timer 保持自动检测/写入 + 新增最小 admin release route） | **A+C**（timer 保持 + 复用/扩展既有 promotion / governance channel） |
|---|---|---|---|
| 1 | **implementation surface** | `cloudfunctions/adminGateway/index.js` +1 路由 `POST /api/admin/gen1/health/release` +1 handler（⛔ 零新集合）★ **须追加只读导出步骤**（运行时不能写 git artifact） | `scripts/promote-*.js` **骨架复用**，但目标集合由 `param_config` **换为** `gen1_health_state` ⇒ 实为**新脚本 + 旧骨架**；无 `adminGateway` 改动 |
| 2 | **authority** | ✅ **服务端强制**：复用 `gen1-authority.js` 的 `AUTHORITY` 六档 + `AUTHORITY_RANK` + `PRODUCTION_LOCKED` ★ **恢复 ≠ 升档**（`gen1_authority` 保持 `CANARY`） | ⛔ **现状不具备**（脚本不 require authority 模块、不查预冻结键）⇒ 须**新建** authority 前置校验 |
| 3 | **natural-person actor** | ✅ 会话身份（`adminGateway` 登录态）⇒ 自然人可识别 | ⛔ 现状 = **机器凭据**（`secretId`/`secretKey`）⇒ 须**新建** operator 身份字段 |
| 4 | **approval** | R1：请求内确认**不由客户端透传**（⛔ 不接受请求体透传 `manualReviewConfirmed`）；R2：**服务端重算**四项前置后才允许 | 现状无 ⇒ 须新建；可复用本仓成文范式（`change_rule`「PR 显式修改 = 审批动作」）作为最低形态 |
| 5 | **audit 8 fields** | ✅ **服务端强制**写权威落点 `docs/gen1/artifacts/**`（git-tracked）→ **须追加只读导出**（运行时写不了 git）+ `gen1_health_state.reviewed_at/by` | ⚠️ 脚本**本地运行可原生产出 git artifact**（✅ 优于 A+B 的导出步骤）；但 8 字段**现状全缺**（见 §2.1）⇒ 须逐项新建 |
| 6 | **state transition** | 唯一迁移 = 分支①（`latched ∈ {DEGRADED, ML_OFF}` → 目标 `incoming ∈ {OK, WARNING}`）★ 状态机枚举为 `HEALTH = {OK, WARNING, DEGRADED, ML_OFF}`（`gen1-circuit-breaker.js:19`）· `HEALTH_RANK`（`:21`）⇒ ⛔ **不引入不存在的 `HEALTHY`** | 同上（同一迁移语义），但**须在脚本内自行实现** |
| 7 | **snapshot** | R7：**释放前必须先取快照**，★ **无 snapshot 不得释放** | ⛔ 脚本现状无前置快照 ⇒ 须新建 |
| 8 | **replay** | ✅ 服务端重算（同一输入可重演）+ 审计 artifact 带 sha256 绑定 + `as_of` | ✅ **脚本本地运行 ⇒ replay 天然可复现**（无部署依赖） |
| 9 | **rollback** | 状态可回退（须写 `previous_state`）；代码回滚 = 单路由移除（**须一次部署**） | 脚本可写回，但**现状无 `prev_value`** ⇒ 回退须**人工重建旧值** |
| 10 | **anti-bypass** | ✅ **最强**：服务端鉴权 + 服务端重算 + 冻结拒写链路完整（`adminGateway.updateParam` 已有 `FROZEN_PARAM_KEYS` 拒写） | ⛔ **最弱**：SDK 直写可**绕过**冻结拒写与路由鉴权（§2.1 证据 5） |
| 11 | **deployment dependency** | ⚠️ **需一次部署**（`adminGateway`）⇒ 受 `P5` 硬前置 | ✅ **零部署** |
| 12 | **P5 dependency** | ★ **硬前置**：`P5`（`adminGateway` 分叉起点）必须先裁定 | 无（不触 `adminGateway`） |
| 13 | **migration impact** | 零 DB schema 变更（零新集合）；`gen1_health_state` 需**新增字段** `previous_state` / `new_state`（向后兼容） | 零 DB schema 变更；但须给脚本补 `prev_value` + 单调 `version`（= 改 `param_config` 写入语义 ⚠️ **须评估是否改变既有 promotion 语义**） |

**★ 跨维关键洞察**：**审计落点的选择与执行面强耦合** —— `A+C` **原生**产出 git artifact，`A+B` **必须追加只读导出**（运行时不能写 git）。

**★ `C2_MINIMAL_CONTRACT` R1–R8（A+B 与 A+C 都必须满足）**

| # | 内容 |
|---|---|
| R1 | 发起面受控（⛔ 不接受请求体/参数透传 `manualReviewConfirmed`） |
| R2 | 前置四条件：`latched ∈ {DEGRADED, ML_OFF}` ∧ 服务端重算 `incoming ∉ DOWN` ∧ `manual_review_required === true` ∧ 冷却期已过 |
| R3 | 唯一迁移 = 分支①（release），目标态 = `incoming ∈ {OK, WARNING}`；⛔ 不引入不存在的 `HEALTHY` |
| R4 | 「已恢复」判据 = `!isDown(latched_health)`；⛔ **不得**用 `recovery_allowed === true`（瞬时值、分支④恒 `false`） |
| R5 | authority 必须**显式校验**；★ 恢复 ≠ 升档（`gen1_authority` 保持 `CANARY`） |
| R6 | 审计 8 字段必须落**权威落点**（`docs/gen1/artifacts/**` 等 git-tracked 面）；⛔ `updated_at` 不算审计 |
| R7 | 释放前**必须先取快照**；★ 无 snapshot 不得释放 |
| R8 | ⛔ 禁自动恢复 / 定时释放 / env-config 覆写 / DB 直写绕过 |

**审计 8 字段现状缺口（逐项）**

| 字段 | 现状 |
|---|---|
| `actor` | ✅ `gen1_health_state.reviewed_by`（需复记） |
| `timestamp` | ✅ `gen1_health_state.reviewed_at`（★ `updated_at` ⛔ 不算审计） |
| `previous_state` | ⛔ 无 |
| `new_state` | ⛔ 无（`latched_health` 是当前值，非变更记录） |
| `reason` | ⛔ 无枚举 |
| `evidence_reference` | ⛔ 无 |
| `authority_decision` | ⛔ 无（`authorityAllows()` 的结果不被记录） |
| `correlation/request id` | ⛔ 无 |

```text
C2_OWNER_SELECTION        = PENDING
C2_ARCHITECTURE_OPTIONS_COMPLETE = YES
C2_MINIMAL_CONTRACT       = R1..R8
C2_REQUIRED_AUTHORITY     = EXPLICIT
C2_REQUIRED_AUDIT         = 8_FIELDS_AT_AUTHORITATIVE_LOCUS
C2_REQUIRED_STATE_TRANSITION = BRANCH_1_ONLY
C2_IMPLEMENTATION_SURFACE = A+B__ADMINGATEWAY_ROUTE  OR  A+C__PROMOTE_SKELETON_NEW_TARGET
```

---

## §3 `P1–P5` Owner Decision 候选项（⛔ 全部未执行）

> `P1..P5_EXECUTED = NO`（逐项）。本表仅列**候选项**与**决定后影响**，⛔ 不含执行。

| ID | 当前证据结论 | Owner 需决定什么 | 决定后影响 | 候选项（⛔ 未选） |
|---|---|---|---|---|
| **P1** | D-007 部署记录缺失（V3.6.5 部署的**唯一仓库级治理记录 = tag 注解本身**） | 是否补录 | deployment governance | `ADD_D007` / `DEFER` |
| **P2** | 09-08 基线属 **pre-governance 既成事实** | 是否写 `BASELINE_ACCEPTED` | baseline contract | `ADD_BASELINE_ACCEPTED_NOT_AUTHORIZATION` / `DEFER` |
| **P3** | 存量 **package parity debt**（`index.js` 级 parity 已 10/10） | 是否接受该规则 | future deployment | `MANDATORY_FOR_NEW_DEPLOY_DEBT_FOR_LEGACY` / `DEFER` |
| **P4** | `master` 非唯一 authority（反证成立） | 是否正式采纳 | deployment authority | `MASTER_IS_NOT_THE_ONLY_AUTHORITY` / `DEFER` |
| **P5** | `8fc3ba66` 为线上 `adminGateway` 对齐锚 | 是否采纳 | C-2 / A+B | `FORK_FROM_ONLINE_PARITY_ANCHORED_COMMIT` / `DEFER` |

**三条强制注意（逐字）**

- **治理记录补录 ≠ deployment authorization**
- **baseline acceptance ≠ deployment authorization**
- **parity debt acceptance ≠ deployment authorization**
- **P5 source anchor ≠ production deployment**

**★ 跨件耦合（未变）**：`P5 → A+B` 是**硬前置**；`P4` 的 `D-3` 准入条件（不可变锚点、tag 优先于 branch）⇒ 未来部署优先以 tag 为锚；`AUDIT_CARRIER_LOCUS` ⇒ `A+B` 需追加只读导出。

**★ `GAP-P1` 严重度（维持上轮更正）**：「09-30 部署仅存于 tag 注解」（因 `deliverables/**` 被 `.gitignore:23` 忽略、从未进入任何 commit）。

---

## §4 边界与 STOP

**本轮硬边界（逐项）**

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

**⛔ 本轮未做**：未修改生产代码；未修改 DB；未修改 authority；未修改 `FROZEN_PARAM_KEYS`；未修改 `immutable_set` / lock（**含未修改 `GEN1_FEATURE_PIPELINE_LOCK.json`**）；未部署；未推送；未合并；未打 tag；未 release；未执行 Evidence Execution；未触 GE-04；**未修改 `v6_negative_scan.py`**。

**`v6_negative_scan.py` 闸门现状（保持）**

```text
N_9A                      = EXISTING
N_10                      = EXISTING
V6_NEGATIVE_SCAN_MODIFIED = NO
```

⇒ 两项既有 FAIL 保持原样（`N-9a` ← `v6_pre_launch_inventory_check.py` 合成负控源串；`N-10` ← `GEN1_ENGINE_IDENTITY_RECONCILIATION_20261002.md:377` 枚举域声明行）。⛔ 如需处理，另立 **harness maintenance item**，⛔ 不得在本轮或任何裁决材料里顺手修。

**`C3-R2` 阻塞（owner §四）**

```text
C3_IMPLEMENTATION         = BLOCKED
```

在 `LC-R2-1` 未解决（即 `LC-A`/`LC-B`/`LC-C` 未被 owner 显式裁定）之前，**不得修改**：`gen1-data-health.js` · lock · manifest · authority · DB · `adminGateway` · production configuration。
★ 特别声明：⛔ **不得**以「R2 已被 Owner Decision briefing 描述」作为 implementation authorization。

**STOP 代码块**

```text
LC_R2_1_DECISION          = PENDING
LOCK_AUTHORITY            = TWO_TIER__NO_FORMAL_TIEBREAKER
LOCK_AUTHORITY_ENFORCEMENT= FILES_BINDING_PLUS_DERIVED_PLUS_ROOT_ANCHOR
LOCK_AUTHORITY_SCOPE_TEXT = RULE_PROSE_9_DOMAINS_UNENFORCED
LOCK_AUTHORITY_TIEBREAKER = ABSENT
LOCK_AUTHORITY_INTERNAL_INCONSISTENCY = PRESENT
C3_IMPLEMENTATION         = BLOCKED
C2_OWNER_SELECTION        = PENDING
C2_ARCHITECTURE_OPTIONS_COMPLETE = YES
C2_A_PLUS_B               = ANALYZED
C2_A_PLUS_C               = ANALYZED
C2_PROMOTE_SCRIPTS_CLASS  = PRODUCTION_MUTATION_UTILITY
P1                        = EXPLICIT
P2                        = EXPLICIT
P3                        = EXPLICIT
P4                        = EXPLICIT
P5                        = EXPLICIT
P1_EXECUTED               = NO
P2_EXECUTED               = NO
P3_EXECUTED               = NO
P4_EXECUTED               = NO
P5_EXECUTED               = NO
N_9A                      = EXISTING
N_10                      = EXISTING
V6_NEGATIVE_SCAN_MODIFIED = NO
PRODUCTION_WRITE          = 0
DB_WRITE                  = 0
DEPLOY                    = NO
AUTHORITY_CHANGE          = NO
CANARY                    = OFF
EVIDENCE_EXECUTION        = NO
GE04                      = NO
IMPLEMENTATION_AUTHORIZED = NO
STOP                      = YES
```

---

## §5 下一步所需 Owner authorization（逐条）

| # | 待裁项 | 需要的 owner 决定 | 放行后**仍不得**自动进入 |
|---|---|---|---|
| 1 | `LC-R2-1` 锁权威歧义 | 在 `LC-A`（文本为准）/ `LC-B`（清单为准）/ `LC-C`（双层分工）中**显式三选一** | ⛔ 不得据此直接改锁 / 改 `gen1-data-health.js` |
| 2 | `C2` release 架构 | 在 `A+B` / `A+C` 中**显式二选一**（★ 本件不排名、不推荐） | ⛔ 不得据此实现路由/脚本 |
| 3 | `C3-γ → R2` 实施 | 是否授权实施（**须先解 #1**） | ⛔ 不得越界到 `indicators.js` / `trend-stage.js` |
| 4 | `P1–P5` | 逐项 `采纳` / `DEFER` | ⛔ 采纳 ≠ 部署授权 |
| 5 | 锁审批字段（`GOV-GAP-LOCK-APPROVAL`） | 是否为该锁补 approval 载体（形态参照 `GEN1_GUARDED_EFFECTIVE_FREEZE`） | ⛔ 不得与锁内容更新合并执行 |
| 6 | `GOV-GAP-C` | 是否修复 `FROZEN_PARAM_KEYS` 注释所称「可审计」落差 | ⛔ 不得改 `constants.js` |
| 7 | `N-9a` / `N-10` | 是否立 harness maintenance item | ⛔ 不得在本轮修闸门 |
| 8 | 旧文档 RETRACTED 指针 | 是否落地 | — |

**实施授权声明（逐字）**：本件为**只读裁定材料**，**不构成实施授权**，也**不代表**已获授权。任何 implementation（含锁更新、`gen1-data-health.js` 修改、`adminGateway` 路由、`promote-*` 脚本、authority 变更、部署、release、Evidence Execution、GE-04）**必须先取得 owner 逐字放行口令**：

```text
AGENT IMPLEMENTATION AUTHORIZED
```

**收尾条件（逐字）**：除非 Owner 明确给出 **`AGENT IMPLEMENTATION AUTHORIZED`**，否则**绝对不得**进入 implementation。
