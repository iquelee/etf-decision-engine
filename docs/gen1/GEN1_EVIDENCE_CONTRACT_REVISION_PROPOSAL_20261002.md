# GEN1 EVIDENCE CONTRACT —— **REVISION PROPOSAL**（2026-10-02）

> ⛔ 本文件是**修订提案（REVISION PROPOSAL / DRAFT）**，⛔ **不是**契约本体，⛔ **未冻结、未生效、
> 不得据其采样**。
> 冻结契约本体 = `docs/gen1/GEN1_EVIDENCE_CONTRACT_V5.md`（**FROZEN**，carrier commit `05da0ef`，PR #66）
> —— 本批次对其**零字节改动**（§1 实时复核）。
> 任何新契约只能以 **DRAFT / PROPOSAL** 存在；本批次**不执行** Freeze（owner 边界）。

| 项 | 值 |
|---|---|
| 提案日期 | 2026-10-02 |
| 取证时刻（+08） | `2026-10-02T15:53:39+0800`（云只读 trigger 实测 as-of；其余指纹 as-of §1） |
| env | `tradingview-etf-d0fa42yy57cbc11b` |
| 上游输入 | `docs/gen1/GEN1_EVIDENCE_CONTRACT_REEVALUATION_R1R2R3_20261002.md`（`727da1f3…cfaf` / 42731 B / 581 行） |
| 覆盖范围 | **R1** Event Independence 固化 / **R2** Trigger Registry + §5.6 + §5.8 重评 / **R3** `input_hash` |
| ⛔ 本批次未做 | 生产代码修改 / merge / master integration / deploy / rollback / 生产 DB 写入 / canary / auto_execution / GE-04 / V3.6.6 Freeze / Evidence Seal / git tag creation |

**方法学约束（全程遵守）**
1. 所有结论必须由**当前仓库、生产代码路径、云只读实测、可复现测试**证明；⛔ 不以文字声明代替可执行判据。
2. ⛔ 不得为满足 Evidence 数量 / Freeze 条件 / GE-04 前置条件而调整判据。
3. 反向证明与正向证明**同等强制**：必须证明「旧假设会失败」，而不仅是「新契约能通过」。
4. ⛔ 冻结对象（契约本体 / freeze commit / blob / SHA256 / seal record / PR #66）**零改写**。

---

## 1. Frozen V5.0 baseline

### 1.1 冻结对象指纹（as-of 本批次实时复核）

| 维度 | 值 | 复现命令 |
|---|---|---|
| 载体路径 | `docs/gen1/GEN1_EVIDENCE_CONTRACT_V5.md` | — |
| carrier commit | `05da0efa73e948921bc7b9b60c0d500cc98e3e9b` | `git show -s --format=%H 05da0ef` |
| 封存记录 commit（= 分支 HEAD） | `7d2f39bddd681cce9d714558d518b06631451d01` | `git rev-parse HEAD` |
| 载体分支 | `docs/gen1-evidence-contract-v5-20261002` | `git rev-parse --abbrev-ref HEAD` |
| **git blob id（sha1）** | `7f86d12aaed99a877c170c25c5a481f21a661256` | `git hash-object docs/gen1/GEN1_EVIDENCE_CONTRACT_V5.md` |
| **content sha256（LF 归一）** | `4fb9463f4a437e310cb52b04498a1d4cc0f23fbc64eb3c1d846d90a460a9f55b` | `git show HEAD:… \| sha256sum` |
| 字节 / 行数 | `64580 B` / `1072` | `git show HEAD:… \| wc -c` / `wc -l` |
| PR | **#66** | — |

⚠️ 三种指纹（git blob id / content sha256 / commit SHA）**不可混用**。

### 1.2 冻结不变量（本批次**未触碰**）

- 冻结契约本体：**tracked diff 为空**（`git diff --stat HEAD` 无输出）；blob 实时复核仍为 `7f86d12a…`。
- 契约 §11「契约不可变性（元规则）」全文有效；本提案**不构成**任何版本的发布。
- ⛔ 未被覆盖/重写的对象：契约本体、freeze commit、blob、sha256、seal record、PR #66。

### 1.3 本提案触及的冻结条款（须按 §11 元规则处理）

| 条款 | v5.0 内容（摘） | 本提案动作 | §11 保护对象？ |
|---|---|---|---|
| §3.4 | `event_cluster_id` / `independent_event` 计算规则（C-B） | **不改**（仅新增 §3.4A 规范性澄清） | 判定阈值 —— **不触及** |
| §5.6 | `NATURAL_RUN_PROVENANCE` + CHAIN PROOF + `trigger 实读` 表 | 表**补全** + 两链同等适用声明 | 清单（非判据）—— **不触及判据** |
| §5.8 | `CANONICAL_CAPTURE_CHECKPOINT` = 工作日 `[22:30, 23:30)` | **重锚**（W1 ∪ W2，first-window-wins） | **`checkpoint` ∈ §11 ① 保护对象** ⇒ 须升版 |
| §3.0.2 | SELECTOR = S-PROMOTED | **不改** | selector —— **不触及** |
| §3.0.3 / §5.4 / §5.5 / §7.1 | promotion proof / gate / 单调采纳 / 计数单位 | **不改** | 判据/阈值 —— **不触及** |
| §5.3 | 八源清单 | **不改**（⛔ 不新增 `input_hash` 等字段） | 纳入规则 —— **不触及** |

⇒ **§1 结论：`FROZEN BASELINE = VERIFIED / ZERO DRIFT`；本提案的**唯一**受保护参数改动 = §5.8 `checkpoint`。**

---

## 2. Why revision is triggered

### 2.1 触发条件（§5.8 **自述**的复核机制已成立）

v5.0 §5.8 明文自述：

> 「本时点是**迁就现存生产事实**（只有 22:00 管线能提升）的裁定。**若 `CD-04` 被修复**（`validateCandidateSet`
> 改用正确的日期对），则 08:00 管线亦可能产出 promoted run ⇒ **届时 checkpoint 须按 §11 元规则重新评估**
> （本时点不作为永久假设）。」

- **`CD-04` 已由 V3.6.6 修复**：生产修复 commit `0342abd`（门 2 由 (III) RUN DATE 改绑 (IV) CALENDAR TRADE DATE）；
  承载树 = `_v366-cd04-20261002` @ `4d4a67e`。
- ⇒ §5.8 的**前提**（「只有 22:00 管线能提升」）已失效 ⇒ **重评触发条件成立**。

### 2.2 另外两类缺口（本批次量化证实）

对**冻结契约本体**做词频取证（可复现）：

| token | 契约内出现次数 | 含义 |
|---|---|---|
| `dailyFetch-2200` | **7** | ✅ §5.6 已登记 22:00 入口 |
| `dailyPipeline-0800` | **2** | ✅ §5.6 已登记 08:00 入口 |
| `extractFundamental` | **0** | ⛔ 真实 trigger，**未登记** |
| `fetchRealtimeData` | **0** | ⛔ 真实 trigger，**未登记** |
| `intelExtract` | **0** | ⛔ 真实 trigger（22:35 落在窗口**内**），**未登记** |
| `runGen2ShadowEod` | **0** | ⛔ 真实 trigger（22:30 落在窗口**内**），**未登记** |
| `dailyFetch-1530` | **0** | （仓库示例配置列了、云端**不存在**） |

⇒ **结论**：`§5.6 trigger 清单 = INCOMPLETE`；`§5.8 静默窗口的枚举域 = INCOMPLETE`
（结论未被推翻，但**举证方式**不满足「可穷举校验」）。

### 2.3 本批次**不**由什么触发（避免误读）

- ⛔ 不是「为了凑够 Evidence 数量」；⛔ 不是「为了 GE-04 放行」；⛔ 不是「08:00 链想要提升」。
- 现行态仍为：`independent_events = 0` / `gen1_production_write = false` / `gen1_auto_execution = false` /
  `gen1_counterfactual_canary_active = false` / `gen1_health_status = DEGRADED` / `EVIDENCE EXECUTION = NOT AUTHORIZED`。
- ⇒ 本提案**不放宽**任何门槛，**不**改变任何计数单位，**不**新增任何 Evidence 字段。

---

## 3. R1 revised independence semantics（正式固化）

### 3.1 问题陈述：v5.0 的独立性**只有簇规则**，无显式「两 run 是否独立」判据

v5.0 §3.4 只定义**逐行**的 `independent_event`（簇内首个 `delta≠0` 行为 `true`）。
它**没有**一条把「两个被采纳 run」显式判为独立/不独立的条款 ⇒ 存在被误读为
「`run_id` 不同即独立」的空间。**该误读已被本批次反向证明证伪**（§12.2）。

### 3.2 提案新增条款 **§3.4A `INDEPENDENCE REQUIREMENTS`**（规范性澄清；DRAFT 文本）

```text
§3.4A  INDEPENDENCE REQUIREMENTS（两 run 是否构成两个独立 Evidence 事件）

INDEPENDENT(A, B)  ⟺  下列 I1–I6 **全部**成立：

  I1  PROMOTION_PROOF(A) ∧ PROMOTION_PROOF(B)          [§3.0.3 五条 AND，缺一 fail-closed]
  I2  run_id(A) ≠ run_id(B)                            [§3.0.1 (I)] —— ★ **必要，非充分**
  I3  decision_date(A) ≠ decision_date(B)              [§5.5 ①③④：同一 decision_date 至多一个 bundle]
  I4  输入侧 provenance 互异（逐源 raw SHA256 + expected_codes）  [§5.3 八源]
  I5  跨事件簇：同 code 间隔 > CLUSTER_GAP_DAYS        [§3.4 ①]
  I6  A、B **各自**至少一个 code 的 delta_position ≠ 0  [§3.4 ② + §7.3] —— **必要条件**

附加判据（本提案新增，可判否）：

  I7  candidate identity 互异                          [§3.0.1 / §3.0.4]
      口径：两 run **各自携带**可用 `gen1_candidate_hash` 时，其逐 code 映射**不得深等**；
      一侧缺载 ⇒ CANDIDATE_IDENTITY_INCOMPARABLE（**仅记录，⛔ 不得据此判否**）。

⛔ 明确排除（**均不得**作为独立性判据）：
    · `trigger` / `trigger_id`（两条链对 Evidence 同等有效 —— 见 §5.6 revised）
    · `candidate_content_sha`、`pointer_revision`、`run_date`(III)、`calc_date`、
      `expected_trade_date`、`event_id`、`input_hash`

⛔ 判据顺序是语义的一部分（不可交换）：可评估性 → 运行身份 → bundle_key → provenance
   → candidate identity → payload 诊断 → 簇 → 有信息量行。

失败语义（fail-closed）：
    任一 I1/I2 不成立                      → NOT_EVALUABLE（不得计入独立事件）
    任一 I3/I4/I5/I6/I7 不成立              → NOT_INDEPENDENT（不得计入独立事件）
    充分性（「分别是其所在簇内**首个** delta≠0 行」）需全表簇上下文 ⇒ 结论须携带
    sufficiency_scope = NECESSARY_CONDITIONS_ONLY
```

### 3.3 该新增条款的**方向性保证**（可机械检验）

- **只增不减**：I1–I6 逐条沿用 v5.0 既有语义（§3.0.3 / §3.0.1 / §5.5 / §5.3 / §3.4 / §7.3），
  I7 为新增。
- ⇒ 单向性质：**任何在 v5.0 判据下 `NOT_INDEPENDENT` 的一对 run，在修订判据下不得变为 `INDEPENDENT`**。
- ⇒ `independent_events` 计数**不会**因本修订而上漂。已由非干预 + 反向证明双向验证（§11 / §12）。

### 3.4 R1 可执行判据（**不是**文字声明）

| 构件 | 路径 | sha256 | 字节 |
|---|---|---|---|
| **修订判据（v2）** | `scripts/gen1/evidence-capture/independence_discriminator_v2.js` | `48467a08d5b6d326…0ae60a66a1698560` | 27400 |
| **修订夹具（v2，10 cases）** | `scripts/gen1/evidence-capture/fixtures/r1_independence_cases_v2.json` | `17229f8b798ce0ab…dd2dd3c34724a1a1` | 88683 |
| 基线判据（v1，**只读保留**） | `scripts/gen1/evidence-capture/independence_discriminator.js` | `ce34056163859d3a…5108de19ba3bdadd` | 22809 |
| 基线夹具（v1，**只读保留**） | `scripts/gen1/evidence-capture/fixtures/r1_independence_cases.json` | `18ddc6c20ccc7f11…ab1139688d71b792` | 63577 |

⚠️ v1 构件**保持只读**（其指纹已被上一轮复评报告引用）⇒ 上一轮证据链完整可复核；
v2 为**新增**文件，两者并存、指纹分列、⛔ 不串线。

判据只**引用**冻结值（⛔ 不复制契约参数）：`CLUSTER_GAP_DAYS = 10`（§3.4）·
`EVIDENCE_COLUMNS = 17`（§3）· `PROMOTION_PROOF_KEYS = 5`（§3.0.3）·
`VERDICT ∈ {INDEPENDENT, NOT_INDEPENDENT, NOT_EVALUABLE}`。

### 3.5 夹具（10 cases，云实读派生，⛔ 不手编可实读数字）

| case | 构造 | 期望判决 |
|---|---|---|
| `NEG-PROOF-1` | **LIVE**：真实 22:00 promoted vs 08:00 未 promoted | `NOT_EVALUABLE` / `PROMOTION_PROOF_FAILED` |
| `NEG-FWD-1` | **owner 指定反例**：同 `decision_date` 09-30 / 同 provenance / 不同 trigger | `NOT_INDEPENDENT` / `SAME_DECISION_DATE_BUNDLE_KEY_COLLISION` |
| `NEG-CLUSTER-1` | 间隔恰 10 天（= `CLUSTER_GAP_DAYS`） | `NOT_INDEPENDENT` / `SAME_EVENT_CLUSTER` |
| `POS-1` | 跨簇（11 天）+ 各自 proof + 各自 delta≠0 | `INDEPENDENT` |
| `POS-1-DELTA0` | 跨簇但两侧 delta 全 0 | `NOT_INDEPENDENT` / `NO_INFORMATIVE_ROW` |
| `NEG-PROV-1` | 日期不同但 provenance 全等 | `NOT_INDEPENDENT` / `SAME_INPUT_PROVENANCE` |
| `NEG-SAMERUN-1` | 同一 run | `NOT_EVALUABLE` / `SAME_RUN` |
| `NEG-NOPROV-1` | provenance 缺载 | `NOT_EVALUABLE` / `INPUT_PROVENANCE_UNAVAILABLE` |
| ★ `NEG-CANDSHA-1` | 跨簇 + 各自 proof + 各自 delta≠0，**唯一**改动 = 两侧装同一份 `gen1_candidate_hash` | `NOT_INDEPENDENT` / `SAME_CANDIDATE_IDENTITY` |
| ★ `POS-2` | 同上骨架，但两侧 candidate hash **不同** | `INDEPENDENT`（证明 I7 不**过度**拦截） |

所有 case 均携带 `trigger` 字段（记录项）与新断言：注入/改写 `trigger` **不得**改变判决（§11 非干预自证）。

### 3.6 实读结论（不变）

两条**真实** run（`engine:2026-09-30:b1790776862980` / `engine:2026-10-01:b1790812813101`）：
**(II) DATA DATE 同为 `2026-09-30`** / 17 列 Evidence payload 逐列相同 / provenance 同源 /
`ml_shadow_signal.date` 同为 09-30 / 22:00 run 的 `gen1_candidate_hash = null`（08:00 run 有 5 个）
⇒ **`NOT_INDEPENDENT`**（且 08:00 run 在 V3.6.6 部署后亦仅 `NOT_INDEPENDENT / SAME_DECISION_DATE_BUNDLE_KEY_COLLISION`）。

**⇒ §3 结论：`R1 = RESOLVED`（判据已固化、可执行、可打红、可反向证明）。**

---

## 4. R2 complete Trigger Registry

### 4.1 两构件分离（登记 vs 实测）

| 构件 | 路径 | sha256 | 说明 |
|---|---|---|---|
| **登记表** | `scripts/gen1/evidence-capture/fixtures/trigger_registry.json` | `dfde55d61ef1e40c…2d22b329255d09e8` | 契约侧枚举域（DRAFT） |
| **云实测快照** | `scripts/gen1/evidence-capture/fixtures/trigger_registry_cloud_observed.json` | `61fdec1612c810bc…857af7c57cb7f37a` | `tcb fn detail` 现场只读（as-of `2026-10-02T15:53:39+0800`） |
| **校验器** | `scripts/gen1/evidence-capture/trigger_registry.js` | `b9e747853785addc…bf877f1e952c6615` | S1–S6 检查 + 反向证明 |

⛔ 两者**分开存放**：登记表是声明，实测是观测；⛔ 不得把实测值直接抄进登记表冒充证明。

### 4.2 云只读实测（现场抓取，7 函数 / 9 triggers）

| 函数 | Triggers | trigger_id | cron（云端返回） |
|---|---|---|---|
| `fetchDailyData` | 1 | `dailyFetch-2200` | `0 0 22 * * 1-5 *` |
| `materializeIndicators` | 1 | `dailyPipeline-0800` | `0 0 8 * * 1-5 *` |
| `runDecisionEngine` | **0** | — | （无调度 ⇒ 自然调用必为 `TCB_API`） |
| `runGen1ShadowEod` | 1 | `gen1-eod-weekdays-2220` | `0 20 22 * * 1-5 *` |
| `runGen2ShadowEod` | 1 | `gen2-eod-weekdays-2230` | `0 30 22 * * 1-5 *` |
| `fetchFundamentalNews` | 2 | `newsFetch-1630` / `intelFetch-30min` | `0 30 16 * * 1-5 *` / `0 0,30 8-22 * * * *` |
| `extractFundamental` | 2 | `newsExtract-1640` / `intelExtract-30min` | `0 40 16 * * 1-5 *` / `0 5,35 8-22 * * * *` |
| `fetchRealtimeData` | 1 | `realtime-5min` | `0 */5 9-15 * * 1-5 *` |
| `runIntegratedShadowEod` | — | — | **`RESOURCE_NOT_FOUND`（云端不存在）** |
| `adminGateway` / `apiGateway` | **0** / **0** | — | 只读或手工重入 |

**双向对拍（校验器 S2）**：`registry = 9 / cloud = 9 / missing = [] / spurious = []` ⇒ **完全对齐**。

### 4.3 完整登记（每项 9 字段：candidate 能力 / 参与 checkpoint / 排除理由 / 写入集合）

| trigger_id | entry point | 写入集合 | 写八源（直接/传递） | 产 Evidence candidate | 参与 checkpoint | 独立性分类 / 排除理由 |
|---|---|---|---|---|---|---|
| `dailyFetch-2200` | `fetchDailyData` →`materializeIndicators`→`runDecisionEngine` | `etf_daily` / `fetch_log` / `fundamental_series` | ❌ / **✅** | **YES** | **YES**（W1 主来源） | PROMOTION-CAPABLE |
| `dailyPipeline-0800` | `materializeIndicators` →`runDecisionEngine` | `etf_weekly` / `indicator_snapshot` | ❌ / **✅** | **YES** | **YES**（W2 主来源） | PROMOTION-CAPABLE（CD-04 后转实际） |
| `gen1-eod-weekdays-2220` | `runGen1ShadowEod` | **`ml_shadow_signal`** | **✅ / ✅** | NO | YES | INPUT-SIDE ONLY —— 不产 candidate，但**是**八源写入者，必须留册（§5.8 窗口须晚于 22:20） |
| `gen2-eod-weekdays-2230` | `runGen2ShadowEod` | `gen2_shadow` | ❌ / ❌ | NO | NO | OUT OF SCOPE（Gen-2 lane 隔离）；**22:30 落在 W1 内**，写非八源 ⇒ 不破坏静默性 |
| `newsFetch-1630` | `fetchFundamentalNews` | `fundamental_news` / `fetch_log` | ❌ / ❌ | NO | NO | OUT OF SCOPE（基本面管线） |
| `intelFetch-30min` | `fetchFundamentalNews` | `fundamental_news` / `fetch_log` | ❌ / ❌ | NO | NO | OUT OF SCOPE；落在 W1(22:30) 与 W2(08:30/09:00) 内，写非八源 |
| `newsExtract-1640` | `extractFundamental` | `fundamental_series` / `fundamental_evidence` / `fetch_log` | ❌ / ❌ | NO | NO | OUT OF SCOPE —— ⛔ v5.0 §5.6 表**未列**，本提案补录 |
| `intelExtract-30min` | `extractFundamental` | `fundamental_series` / `fundamental_evidence` / `fetch_log` | ❌ / ❌ | NO | NO | OUT OF SCOPE —— ⛔ v5.0 §5.6**未列**、§5.8 **枚举域亦未列**；**22:35 落在 W1 内**（写非八源） |
| `realtime-5min` | `fetchRealtimeData` | `etf_daily`（realtime 行）/ `fetch_log` | ❌ / ❌ | NO | NO | OUT OF SCOPE —— ⛔ v5.0 §5.6**未列**；**09:00–09:25 落在 W2 内**（写 `etf_daily` realtime，非八源；§9.1 已排除 `source='realtime'`） |

**无调度但必须留册者**（⛔「不写八源」≠「可以从 Registry 消失」；**有调度**同样不等于可以消失）：

| 函数 | role | 写八源（直接） | 排除理由 |
|---|---|---|---|
| `runDecisionEngine` | `CHAINED_ONLY` | **✅**（`run_manifest` / `run_candidate_decision` / `run_candidate_portfolio` / `active_run_pointer` / `run_history` / `runtime_status`） | `Triggers = 0` ⇒ 不进 trigger 清单，但**是**八源直接写入者 |
| `adminGateway` | `MANUAL_REENTRY` | ❌ | §5.6 明确排除：`:547 riskResolve` / `:578 riskTrigger` / `:661 paramChange` 直接 `callFunction runDecisionEngine` ⇒ 非自然运行 |
| `apiGateway` | `READ_ONLY` | ❌ | 只读读链，不产生 run |

**云端不存在项**：`runIntegratedShadowEod`（`RESOURCE_NOT_FOUND`）；
仓库 `cloudbaserc.example.json` 列出的 `dailyFetch-1530`（**云端不存在**，`fetchDailyData` 实读仅 1 个 trigger）
⇒ ⚠️ **仓库配置证据 ≠ 云端实读证据**。

### 4.4 校验器 S1–S6（可执行）

| 检查 | 内容 | 结果 |
|---|---|---|
| **S1 SCHEMA** | 每条登记项须含全部 17 个必备字段 | **PASS** |
| **S2 COMPLETENESS** | 「登记 vs 云实测」**双向**对拍（缺失与多余都要抓） | **PASS**（9/9，missing=[]，spurious=[]） |
| **S3 EIGHT_SOURCE** | `writes_eight_source_direct` 必须与 `writes_collections ∩ 八源` 一致 | **PASS** |
| **S4 EXCLUSION_REASON** | 凡 `candidate_capable≠YES` 或 `participates_in_checkpoint=NO` 者必须有排除理由（owner §4 硬要求） | **PASS** |
| **S5 CHAIN_COVERAGE** | 每条 PROMOTION-CAPABLE 链的入口 trigger 必须已登记且 `role == ENTRY` | **PASS**（W1-2200 / W2-0800） |
| **S6 CHECKPOINT_SILENCE** | 任一候选窗口内**不得**存在「写八源」的 trigger（含 cron 真值匹配） | **PASS**（详见 §6.3） |

**⇒ §4 结论：`R2 Trigger Registry = COMPLETE`（登记与云实测双向对齐，且每项均有写入集合与排除理由）。**

---

## 5. §5.6 revision（提案文本）

### 5.1 保留不动（判据本身）

- `NATURAL_RUN_PROVENANCE`（外部只读取证通道 = `tcb logs search` + `tcb fn detail`）。
- CHAIN PROOF 五条（入口 `TRIGGER_TIMER` / 链式传播代码可证 / 下游 completion 与
  `run_history[R].created_at`·`promoted_at` 匹配 / ⛔ 不对两跳做严格先后序 / ⛔ run 的 invocation
  **不必**落在 capture checkpoint 窗口内 / ⛔ 排除管理侧重入）。
- ⛔ 关键禁令不变：**不得**要求 `runDecisionEngine` 自身 `request_source == TRIGGER_TIMER`。

### 5.2 补全：`trigger 实读` 表（补 4 项 + 2 条不存在声明）

新增行：`extractFundamental`（`newsExtract-1640` / `intelExtract-30min`）、
`fetchRealtimeData`（`realtime-5min`）、`runGen2ShadowEod`（`gen2-eod-weekdays-2230`）；
新增声明：`runIntegratedShadowEod` **云端不存在**；仓库 `dailyFetch-1530` **云端不存在**。
⇒ 并加一句口径：**本表 = 生产 trigger 的完整枚举域**（`Trigger Registry`，§4.2），
⛔ 不得只列「能产 promoted run 的链」。

### 5.3 新增：两条链**同等适用** CHAIN PROOF（★ 核心）

```text
§5.6 补充条款（DRAFT）

(a) 生产存在**两条** PROMOTION-CAPABLE 链：
      W1-2200  fetchDailyData → materializeIndicators → runDecisionEngine
      W2-0800  materializeIndicators → runDecisionEngine
    ⛔ 二者对 Evidence **同等有效**；⛔ 不得因「历史上只有 22:00 能提升」而结构性排除 08:00 链。

(b) CHAIN PROOF 对两条链**逐字同等**适用（入口 = 各自 cron 触发的 `TRIGGER_TIMER` 调用）。

(c) ★ trigger **不是**独立性判据：两 run 是否构成两个独立 Evidence 事件，
    一律由 §3.4A 判据裁决（⛔ 不由 trigger / run_id / chain 身份裁决）。

(d) ⛔ 任何「不产 candidate」的 trigger **仍须**登记，并写明其写入集合与排除理由
    （口径：「不写 Evidence 八源」≠「可以从 Trigger Registry 消失」）。
```

---

## 6. §5.8 checkpoint revision（重评正式完成）

### 6.1 两个 pipeline 在修订契约中的角色（★ owner 点名要求）

| | **W1 = 22:00 链**（`dailyFetch-2200`） | **W2 = 08:00 链**（`dailyPipeline-0800`） |
|---|---|---|
| 是否 PROMOTION-CAPABLE | **是**（实测：2026-09-30 run 已 `promoted=true`） | **是**（结构上恒真；`CD-04` 修复后由「结构」转为「实际」） |
| 是否产 Evidence candidate | **是** | **是** |
| 在修订契约中的角色 | **捕获窗口 W1 的首选链** | **捕获窗口 W2 的兜底链**（当 W1 未产出该 `decision_date` 的 promoted run 时） |
| 其 run 是否自动成为独立事件 | ⛔ **否** | ⛔ **否** |
| 独立性由何裁决 | **§3.4A 判据** | **§3.4A 判据** |

⇒ 明确否定两种误读：
- ⛔ 不因「历史上主要依赖 22:00」而继续假设「08:00 不产生有效 Evidence」；
- ⛔ 不因「V3.6.6 让 08:00 可以 promotion」而直接规定「08:00 = independent event」。

### 6.2 重锚方案（DRAFT 文本）

```text
§5.8  CANONICAL_CAPTURE_CHECKPOINT（v-next 重锚）

预登记的**有序窗口序列**（工作日，北京时间；⛔ 一经冻结不得事后新增/移动）：

  W1 = [22:30:00, 23:30:00)        —— 目标 decision_date D 的**当日夜间**
  W2 = 次日工作日 [08:30:00, 09:30:00)  —— 目标 decision_date D 的**次日晨间**

捕获规则（first-window-wins）：
  capture(D):
    取序列中**首个**满足「pinned R 的 decision_date == D」的窗口；
    该窗口内若 pointer 目标的 decision_date ≠ D ⇒ 本窗口不产出，继续下一窗口；
    若全部窗口均不满足 ⇒ PROVENANCE_MISSING → FAIL-CLOSED → NON-SCORING（§5.2）

checkpoint_ok = weekday(capture_local) < 5  AND  capture_local ∈ (W1 ∪ W2)

pinned R 定义：§3.0.2 S-PROMOTED（capture 时刻 `active_run_pointer[production].run_id`，读取一次即 pin）
⛔ pinned R 与 trigger **无关**；⛔ 不得按 chain 身份挑 run。

重锚理由（3 条，全部为可复现事实）：
  ① v5.0 定值前提「只有 22:00 管线能提升」已随 `CD-04` 修复失效（§2.1）；
  ② 只要 22:00 链**未**产出 promoted run，v5.0 的单窗口会在该窗口内一无所获，
     且 §5.2 禁止倒填 ⇒ 该 `decision_date` 结构性丢失，而丢失与 22:00 链失败**相关** ⇒ 潜在样本偏倚；
  ③ W2 窗口的存在使 §5.6(b)「两条链同等有效」在**捕获层**亦成立。
```

**⛔ 不采用的两个替代**（见 §9 差异矩阵）：
- 「保持 22:30 单窗口」：结构性丢失仅由 08:00 链成功的那类交易日，且丢失与失败相关 ⇒ 不采用。
- 「按 promoted run 完成时刻 + 固定滞后（事件驱动）」：不可预登记为**固定**边界，且会把
  「事后才知道的完成时刻」引入窗口定义 ⇒ 违反 pre-registration ⇒ 不采用。

### 6.3 静默性质（穷举，⛔ 不再使用断言式举证）

`S6 CHECKPOINT_SILENCE`（含 cron 真值匹配）穷举全部 9 个真实 trigger：

| 窗口 | 窗口内**全部**触发者（实算时刻） | 写八源者 |
|---|---|---|
| **W1** `[22:30,23:30)` | `gen2-eod-weekdays-2230@22:30`、`intelFetch-30min@22:30`、`intelExtract-30min@22:35` | **无** |
| **W2** `[08:30,09:30)` | `intelFetch-30min@08:30/09:00`、`intelExtract-30min@08:35/09:05`、`realtime-5min@09:00/09:05/…/09:25` | **无** |

⇒ **两窗口均满足「无八源写入者」**；且**举证方式**由「断言」升级为「穷举 Registry + 逐条排除 + cron 真值匹配」。
⚠️ W2 内含 `realtime-5min` 对 `etf_daily` 的 realtime 行写入 —— 该集合**不属于**八源，
且 §9.1 已规定 forward 收益只用 `source != 'realtime'` 的行 ⇒ **不构成污染**（此处显式登记，便于复核）。

### 6.4 对现行态的含义（⛔ 不放宽任何门槛）

- 现行 `pinned R` = `engine:2026-09-30:b1790776862980`，其 `decision_date = 2026-09-30`
  ⇒ 在 W1 内即可捕获（无需用 W2）。
- V3.6.6 部署后若 08:00 链对同一 `decision_date`（09-30）产出 promoted run：
  它在 W1 之后到达 ⇒ 依 §5.5 ③ 为 `NON_SCORING`（同一 `decision_date` 的第二个 bundle）
  ⇒ **不产生第二个独立 Evidence 事件**；且 §3.4A 判据亦独立给出 `NOT_INDEPENDENT`
  （红证 RP3 已证）⇒ 两条论证互证。

**⛔ 不采用的其余替代（与 §6.2 的两个合并计为 3 个备选，均不采用）**

**⛔ 不采用的第三替代**：**把 selector 从 S-PROMOTED 改为「decision_date == D 的首个 promoted run」** —— `selector` ∈ §11 ① 保护对象；且会引入「按 data 轴取首个」的第二选择器，与 §3.0.2 冲突 ⇒ 不采用。

---

## 7. R3 `input_hash` ruling

### 7.1 契约消费面测试（可复现）

对**冻结契约本体**逐 token 计数：

| token | 次数 | 结论 |
|---|---|---|
| `input_hash` | **0** | ⛔ 契约**不要求、不消费** |
| `candidate_content_sha` | **0** | 同上（属部署候选清单/CI 门构件，非生产字段） |
| `gen1_candidate_hash` | **0** | 契约未提；但它是**真实生产字段**（`run_candidate_decision`），本提案仅在 §3.4A I7 引用它 |
| `gen1_run_id` | **0** | 契约未提 |

### 7.2 生产真实状态（三处，同名不同义）

| # | 落点 | 值（实读） | 性质 |
|---|---|---|---|
| 1 | `run_manifest.input_hash` | `engine:engine:2026-09-30:b1790776862980` | **字符串拼接**（`'engine:' + v365EngineRunIdBase`；后者已含 `engine:` ⇒ **双前缀**） |
| 2 | `run_history.input_hash` | 同上 | 从 manifest 复制 |
| 3 | `runtime_status.v365_run_integrity.input_hash` | `a1e067cb9f9f4d2e6b04cf58c96393c5e2e56e3763cc1e7d48647e47dcfae8e5` | **真 sha256** |

### 7.3 五问逐条回答

| # | 问题 | 回答 |
|---|---|---|
| ① | 生产是否实际产生？ | **YES**（3 处） |
| ② | Contract 是否要求？ | **NO**（消费面测试 = 0 次命中） |
| ③ | 若要求但生产不产生 ⇒ 是否 Contract Gap？ | **N/A**（契约不要求） |
| ④ | 它想证明 input identity / data provenance / candidate identity？ | **语义歧义**：`run_manifest` / `run_history` 版本名义为 input identity、实为 **run identity 的拼接**；`runtime_status` 版本才是 **input provenance digest** |
| ⑤ | 已有其他字段能完整承担该语义？ | **YES**：run identity ⇒ `run_id` / `revision` / `pointer_revision`；input provenance ⇒ `runtime_status.v365_run_integrity.input_hash`（真 digest）+ §5.3 八源 raw SHA256 + `expected_codes` / `expected_trade_date`；candidate identity ⇒ `gen1_candidate_hash`（本提案 I7 引用） |

### 7.4 正式裁定

> **`R3 = OBSERVATION`（⛔ 非 `CONTRACT GAP`）。**
> 理由：① 契约不要求也不消费；② 语义已由其他字段完整承担；③ 无任何契约判据依赖它。
> **本提案不改生产代码**；登记两条非阻塞观察项：
> - (a) `run_manifest` / `run_history.input_hash` 为**双前缀字符串**，与 `runtime_status` 的同名 digest
>   **语义冲突**，且下游 `v365-active-read.js:588` 会读到它 ⇒ 建议未来版本**改名澄清**（如 `run_identity_key`）；
> - (b) ⛔ **禁止**为满足 schema 制造虚假 hash；⛔ 不得因本字段缺失/歧义而阻断 Freeze。
> ⇒ 契约侧仅做 **non-normative 附注登记**（§9 差异矩阵 CCP-R3-1），**不升版**。

---

## 8. Version recommendation

### 8.1 五维影响分析

| 维度 | 本提案的影响 | 是否触发升版 |
|---|---|---|
| **semantic change** | §5.8 `checkpoint` 重锚 ⇒ **捕获口径改变**（pre-registration 变更） | **是** |
| **governance change** | §3.4A 新增规范性澄清条款；§5.6 trigger 清单补全为完整枚举域 | **是**（文档治理面） |
| **schema change** | **无** —— 17 列 / 八源 / bundle 字段**逐字未改**；⛔ 未新增 `input_hash` 等字段 | 否 |
| **evidence compatibility** | §3.4A 为**只增不减**判据 ⇒ `independent_events` **不上漂**；现行实读判决不变（仍 `NOT_INDEPENDENT`） | 否（兼容） |
| **historical sample compatibility** | **v5.0 现存样本 = 0 行**（`run_candidate_decision` 10 行全为 `PRE-V5 DIAGNOSTIC`）；`2026-09-10 … 2026-10-02` 全部行依 §10 只能标 `PRE-V5 DIAGNOSTIC / NON-SCORING / NON-GATE` | 作废成本 = **0** |

### 8.2 版本裁定

```text
RECOMMENDED_VERSION  = v6.0
REASON               = ① `checkpoint` ∈ §11 ① 明列的「冻结后不得修改」项；
                       ② §11 ② 对该类情形的唯一处置 = 「发布 v6.0 并显式作废既有样本」；
                       ③ 本修订同时补正了两处**冻结文档缺陷**（§5.6 漏 4 项 trigger 族；
                          §5.8 枚举域漏 intelExtract-30min / runGen2ShadowEod / extractFundamental
                          / fetchRealtimeData / runGen1ShadowEod）—— 「发现错误」要件成立；
                       ④ 捕获口径变更 ⇒ 新旧样本不可混用，须显式作废（v5.0 = 0 行，成本为零）；
                       ⑤ 本契约谱系 v1.0→v2.0→v3.0→v4.0→v5.0 **每次实质变更均为整版递增**，
                          无 `vX.Y` 先例 ⇒ v5.1 将是**新造标签**。
ALTERNATIVE_VERSION  = v5.1（commit `0342abd` 亦为本版本**已实现**的修复）
WHY_NOT              = ① §5.8 的重评虽是**其自身预留**的机制，但 §5.6 的漏项属**文档缺陷**
                         ⇒ 命中 §11 ② 的「发现错误」；② `v5.1` 会**低估**「受保护参数被改动」这一事实，
                         易被读成「v5.x 样本仍有效」；③ 本谱系无 `vX.Y` 先例，新造标签本身增加审计歧义；
                         ④ v5.0 样本 = 0 ⇒ 采用更强标签**零代价**。
```

**版本标签与「显式作废 v5.0 全部样本」声明 = 本批次登记的 owner 裁定项**（§13 / §14）。

---

## 9. V5.0 → proposed revision diff matrix

> ⛔ 全部为 **DRAFT**；右列「样本影响」按 §11 ③ 要求逐条写明**是否作废既有样本**。

| # | 条款 | v5.0（FROZEN） | 提案（DRAFT） | 类型 | 受 §11 ① 保护？ | 是否作废样本 |
|---|---|---|---|---|---|---|
| D1 | **§3.4A**（新增） | 无「两 run 是否独立」的显式条款 | 新增 `INDEPENDENCE REQUIREMENTS` I1–I7，含 ⛔ 排除项清单与 fail-closed 语义 | 契约修订（规范性澄清） | 否（阈值未改） | 否（**只增不减** ⇒ 计数不上漂） |
| D2 | **§5.6 表** | 列 5 函数；漏 `extractFundamental` / `fetchRealtimeData` / `runGen2ShadowEod` / `intelExtract-30min`；未声明 `runIntegratedShadowEod`、`dailyFetch-1530` 云端不存在 | 补全为**完整枚举域**（= Trigger Registry），加 2 条不存在声明 | 契约修订（文档完整性） | 否 | 否 |
| D3 | **§5.6 补充 (a)–(d)** | 只锚 22:00 入口为主叙述 | 明示两链同等适用 + ⛔ trigger 非独立性判据 + ⛔ 不产 candidate 的 trigger 仍须登记 | 契约修订（规范性澄清） | 否 | 否 |
| D4 | **§5.8 checkpoint** | 工作日 `[22:30:00, 23:30:00)` 单窗口 | 预登记序列 `W1 ∪ W2`，first-window-wins | 契约修订（**受保护参数**） | **是** | **是**（作废 v5.0 样本 = 0 行） |
| D5 | **§5.8 举证方式** | 断言「窗口内无八源写入者」 | 穷举 Registry + cron 真值匹配 + 显式登记 `realtime-5min` 的 `etf_daily` 写入 | 契约修订（举证方式） | 否 | 否 |
| D6 | **§5.9 / 附录** | 未登记 `input_hash` | 登记为 `OBSERVATION` + 命名澄清建议（`run_identity_key`） | 契约附注（non-normative） | 否 | 否 |
| D7 | **§11 变更日志** | — | 追加一行：版本 / 日期 / 修改内容 / **作废既有样本 = 是（0 行）** | 契约元数据 | 否 | 否 |
| D8 | **§12 未决项** | 第 10 项 `CD-04` = V3.6.6 需求项（未修） | 追加：`CD-04` 修复已由 `0342abd` 完成 ⇒ 本修订的**触发依据**；checkpoint 重评已执行 | 契约元数据 | 否 | 否 |
| D9 | **§10 生效日** | 自 v5.0 冻结后首个被采纳的自然 run 起算 | **改锚**：自 **v-next 冻结后**首个被 `PROMOTION_PROOF` 采纳的自然 run 起算 | 契约修订（生效口径） | 否（但随 D4 同批） | **是**（同 D4） |

**工具同批次迁移（§11 规则 5，⛔ 本批次不施加）**：
`scripts/gen1/evidence-capture/c1_capture.py` 的 `evaluate_checkpoint()`（实读行 `186–188`）与
常量 `CHAIN_WINDOW_END`（行 `98`）当前为 v5.0 单窗口语义 ⇒ 须在**冻结同批次**改为双窗口判定
（返回 `{ok, window_id}`），并同步 `:418 / :451 / :473 / :520` 的措辞。
⛔ **在 v-next 冻结之前不得施加**（否则构成「工具已按未冻结契约采样」的预登记违规）。

---

## 10. Evidence compatibility

| 项 | 评估 |
|---|---|
| v5.0 现存正式样本 | **0 行**（§4.1 E1 纳入规则下，`run_candidate_decision` 10 行全部为 `PRE-V5 DIAGNOSTIC`） |
| 修订是否使 `independent_events` 上漂 | **否** —— §3.4A 只增不减；且不改变 §7.1 计数单位 |
| 修订是否改变 17 列字段 | **否**（逐字未改） |
| 修订是否改变八源 / bundle 字段 | **否**（⛔ 未新增 `input_hash` / `candidate_content_sha`） |
| 修订是否改变 selector / 阈值 / 纳入排除规则 | **否** —— 仅 `checkpoint` 一项（D4） |
| 现行实读判决是否变化 | **否** —— 两条真实 run 仍为 `NOT_INDEPENDENT`（v1 判据与 v2 判据同判决） |
| `2026-09-10 … 2026-10-02` 历史行 | 继续只能标 `PRE-V5 DIAGNOSTIC / NON-SCORING / NON-GATE`；⛔ `HISTORICAL BACKFILL = PROHIBITED` |
| 作废成本 | **零**（0 行）—— 但**声明**仍必须显式写入变更日志（§11 ③） |

---

## 11. Test matrix

### 11.1 受修订影响的门（本批次**重跑**）

| # | 门 | 命令 | 结果 |
|---|---|---|---|
| T1 | R1-v2 selftest（10 夹具） | `node …/independence_discriminator_v2.js --selftest` | **10 passed / 0 failed** |
| T2 | R1-v2 非干预（非判据字段注入） | `… --non-interference` | **10 passed / 0 failed** |
| T3 | R1-v2 打红（9 变异 + 还原） | `… --red-proof` | **RED_PROOF = PASS** |
| T4 | R1-v2 **反向证明**（旧规则必须被证伪） | `… --reverse-proof` | **LEGACY_RULE_FALSIFIED = PASS**（3 反例） |
| T5 | R1-v1 回归（证明 v1 判决未被「顺手改宽」） | `node …/independence_discriminator.js --selftest / --red-proof` | **8 passed / 0 failed**；**RED_PROOF = PASS** |
| T6 | R2 Registry 校验 S1–S6 | `node …/trigger_registry.js --validate` | **VALIDATE = PASS** |
| T7 | §5.8 窗口静默（穷举 + cron 真值） | `… --silence` | **CHECKPOINT_SILENCE = PASS** |
| T8 | R2 反向证明（错误 Registry / 错误窗口必须被检出） | `… --reverse-proof` | **REGISTRY_REVERSE_PROOF = PASS**（7/7） |
| T9 | R3 契约消费面测试 | `grep`/计数 `input_hash` 于冻结契约 | **0 次命中** ⇒ `OBSERVATION` 成立 |
| T10 | 冻结基线零漂移 | `git hash-object` / `sha256sum` / `wc` | blob `7f86d12a…` / `4fb9463f…f55b` / 64580 B / 1072 行 |

### 11.2 未受修订影响的门（**复用**已有证据，并说明为什么仍然有效）

| # | 门 | 复用依据（为什么仍有效） |
|---|---|---|
| T11 | V3.6.6 历史重放 | 本批次对 `_v366-cd04-20261002` 树**零改动**（`git status --short` 空）⇒ 重放环境不变；**本批次现场重跑仍 PASS**（cases=5 / checks=32 / failed=0） |
| T12 | V3.6.6 Python/JS parity | 同上；现场重跑：**fields=23 / diffs=0 / missing=0 / extra=0** ⇒ PASS |
| T13 | 安全墙审计 | 同上；现场重跑：**29/29 PASS**（含「⛔ 未创建 v3.6.6 tag」/「Authority·写执行开关未被打开」） |
| T14 | Evidence 采集工具（`c1_capture.py`）语义 | **本批次刻意不迁移**（§11 规则 5）；其 v5.0 语义仍与冻结契约一致 ⇒ 无需重测；⛔ 也不得先行迁移 |

⇒ **T11–T13 的复用前提**：本批次**未触碰生产代码路径**（见 §13 四块式取证）。若前提被破坏，须整组重跑。

---

## 12. Negative / red-proof evidence

### 12.1 正向证据（可复现）

| 项 | 结果 |
|---|---|
| R1-v2 selftest | `10 passed / 0 failed` |
| R1-v2 非干预 | `10 passed / 0 failed` |
| §5.8 静默（W1 / W2） | 窗口内全部触发者已穷举，**写八源违规者 = 0** |
| Registry 完备性 | 登记 9 == 云实测 9，`missing=[]` / `spurious=[]` |

### 12.2 ★ **反向证明（owner §9：必须证明旧错误假设会失败）**

**(A) 旧规则「`run_id` 不同 ⇒ independent」被现实反例证伪**

| 反例 | 标准判据 | 旧规则 | 判定 |
|---|---|---|---|
| `NEG-FWD-1`（同 provenance + 同 decision_date + 不同 run_id） | `NOT_INDEPENDENT / SAME_DECISION_DATE_BUNDLE_KEY_COLLISION` | `INDEPENDENT / LEGACY_RUN_ID_DIFFERS` | **FALSIFIED** ✅ |
| `NEG-CANDSHA-1`（同 candidate hash + 跨日 + 不同 provenance） | `NOT_INDEPENDENT / SAME_CANDIDATE_IDENTITY` | `INDEPENDENT / LEGACY_RUN_ID_DIFFERS` | **FALSIFIED** ✅ |
| `NEG-PROOF-1` 解除 B 的 promotion 失败（= V3.6.6 部署后） | `NOT_INDEPENDENT / SAME_DECISION_DATE_BUNDLE_KEY_COLLISION` | `INDEPENDENT / LEGACY_RUN_ID_DIFFERS` | **FALSIFIED** ✅ |

⇒ **`LEGACY_RULE_FALSIFIED = PASS`**：三条反例均证明「旧规则会给出**错误**的 `INDEPENDENT`」。
⇒ 这同时证明：**本次修订不是「改规则让测试变绿」** —— 修订只会让判决**更严**，且旧的宽松规则**当场失败**。

**(B) 错误 Trigger Registry 必须被检出**

| 变异 | 期望 | 实得 | 判定 |
|---|---|---|---|
| `RP-A` 遗漏真实 trigger `intelExtract-30min`（= v5.0 §5.6 的原始缺陷） | FAIL | `missing=["intelExtract-30min"]` | ✅ 检出 |
| `RP-B` 谎报 `realtime-5min` 写八源 | FAIL | `declared=true / expected=false` | ✅ 检出 |
| `RP-C` 塞入幽灵 trigger `ghost-0000` | FAIL | `spurious=["ghost-0000"]` | ✅ 检出 |
| `RP-D` 把窗口挪回 `[22:00,22:30)` / `[08:00,08:30)` | FAIL | 违规者 = `dailyFetch-2200` + `gen1-eod-weekdays-2220` / `dailyPipeline-0800` | ✅ 检出 |
| `RP-E` 抹掉被排除 trigger 的 `exclusion_reason` | FAIL | 报出缺失项 | ✅ 检出 |
| `RP-F` 删掉 W2-0800 链的入口 trigger 登记 | FAIL | `ENTRY_TRIGGER_NOT_REGISTERED` | ✅ 检出 |
| `RP-G` 逐字节还原 | PASS | 全部检查重新 PASS | ✅ 复原 |

⇒ **`REGISTRY_REVERSE_PROOF = PASS`（7/7）**。★ 其中 `RP-A` 与 `RP-D` 是最有分量者：
前者**精确复现了 v5.0 §5.6 的漏项缺陷**并被本校验器抓出；后者证明静默检查**不是恒真断言**
（把窗口挪到含八源写入者处，检查立刻失败）。

**(C) R1 打红（9 变异，含新增 C3 / C8）**

| # | 变异 | 期望 | 实得 |
|---|---|---|---|
| RP1a | 只屏蔽 C2 | 判决不变、理由换手到 C6 | ✅ |
| RP1b | 屏蔽 C2+C6 | 残差换手到 C7 | ✅ |
| RP1c | 屏蔽 C2+C6 且两侧 delta≠0 | 翻为 `INDEPENDENT` | ✅ |
| RP2 | `CLUSTER_GAP_DAYS := 0` | `NEG-CLUSTER-1` 翻为 `INDEPENDENT` | ✅ |
| RP3 | 解除真实 08:00 run 的 promotion 失败 | 立即暴露为同日冲突 | ✅ |
| RP5 | provenance 缺载 | `NOT_EVALUABLE` | ✅ |
| **RP6** | 屏蔽 C3（candidate identity） | `NEG-CANDSHA-1` 翻为 `INDEPENDENT` | ✅ |
| **RP7** | 把 `trigger` 改成未登记值/置空 | 判决**逐字不变** ⇒ C8 非判据 | ✅ |
| RP4 | 逐字节还原 | 判据复原 | ✅ |

⇒ **`RED_PROOF = PASS`**；`RP1a/b/c` 证明 C2/C6/C7 三条护栏**互相冗余承重**；
`RP6` 证明 C3 承重；`RP7` + 非干预证明 `trigger` 不承重。

### 12.3 本批次**未**证伪的攻击面（诚实登记）

- **充分性未可执行**：§3.4A 的结论只到必要条件（`sufficiency_scope = NECESSARY_CONDITIONS_ONLY`）；
  「簇内**首个** `delta≠0` 行」需全表簇上下文，⛔ 不可由一对 run 判定。
- **§5.8 静默性的枚举域是 as-of 快照**：若生产新增 timer，须重跑 Registry（⛔ 不主张永久完备）。
- **`realtime-5min` 与 `etf_daily`**：W2 内确有 `etf_daily` realtime 行写入；本提案以
  「该集合不属八源 + §9.1 已排除 `source='realtime'`」论证不构成污染，但**未**对其做端到端前向收益验证。

---

## 13. Freeze readiness

### 13.1 条件式判定（⛔ 不写成单步缺口断言）

| 项 | 判定 |
|---|---|
| `V3.6.6_IMPLEMENTED` | **PASS**（前序 G-4；本批次未触碰） |
| `REPLAY_PARITY_PASS` | **PASS**（本批次现场重跑仍 PASS） |
| **`CONTRACT_REVISION`** | **`PASS_WITH_REMAINING_GOVERNANCE_DECISION`** |
| **`FREEZE`** | **`NOT READY`** |

**放行语句（带判据的条件式）**：

> 「当且仅当 ① owner 已裁定版本标签（推荐 `v6.0`）并批准「显式作废 v5.0 全部样本（= 0 行）」声明、
> ② owner 已批准 §5.8 checkpoint 重锚（`W1 ∪ W2`，first-window-wins）、
> ③ 修订版契约的 FROZEN 指纹已复核、④ `c1_capture.py` 的双窗口语义迁移与契约冻结**同批次**完成 ——
> **四项同时为真时**，方可进入 V3.6.6 Freeze 评审；否则不得进入。」

### 13.2 为什么是「有剩余治理决定」而非「全清」

- **技术面全清**：R1 / R2 / R3 三项均已解决；全部门 **PASS**；反向证明 **PASS**；⛔ 无需生产代码修改。
- **剩余项是治理行为，不是技术缺陷**：
  1. **版本标签 + 样本作废声明** —— §11 ② 把「发布新版本」定为显式治理动作；⛔ 本批次不得自行执行 Freeze（owner §2）。
  2. **checkpoint 重锚批准** —— `checkpoint` ∈ §11 ① 明列的保护对象，其变更须经版本发布机制，而非单方改动。
- ⇒ 属「**待治理裁定后可 Freeze**」，⛔ **不是** `BLOCKED`。

### 13.3 / §11 元规则的时序约束（★ 部署前必守）

| 规则 | 约束 | 本批次处置 |
|---|---|---|
| §11 规则 ① | 冻结后 protected 参数不得修改 | 提案件为 **DRAFT**，⛔ 未改冻结契约 |
| §11 规则 ② | 发布新版本须**显式作废**既有样本 | 建议采用 `v6.0` + 显式作废（0 行）声明（§8） |
| §11 规则 ③ | 每次修改留痕（动机 + 是否作废样本） | 已备 §9 差异矩阵（逐条给出「是否作废样本」列） |
| §11 规则 ④ | **采样进程与契约修改不得由同一次决策同时触发** | ⛔ 本批次未部署、未重启采样；登记为下一门前置 |
| §11 规则 ⑤ | 工具语义迁移与契约冻结**同批次** | ⛔ **刻意不先行迁移** `c1_capture.py`（§9） |

---

## 14. Remaining blockers

| # | 剩余项 | 类型 | 归属 | 未闭合的后果 |
|---|---|---|---|---|
| B1 | **版本标签裁定**（推荐 `v6.0`；备选 `v5.1`）+ 「显式作废 v5.0 全部样本（0 行）」声明 | **治理裁定** | owner | 无法发布新版本 ⇒ 无法 Freeze |
| B2 | **§5.8 checkpoint 重锚批准**（`W1 ∪ W2`，first-window-wins） | **治理裁定**（§11 ① 保护对象） | owner | 捕获口径悬置 ⇒ 无法冻结生效日 |
| B3 | `c1_capture.py` 双窗口语义迁移（`evaluate_checkpoint` / `CHAIN_WINDOW_END` 等 5 处） | 工程（**同批次约束**） | 下一门执行 | 若先于冻结施加 ⇒ 预登记违规（§11 规则 5） |
| B4 | `EVIDENCE EXECUTION` 授权（§12 第 5 项仍为 `NOT AUTHORIZED`） | 治理 | owner | 无样本累计 |
| B5 | §11 规则 4 时序（采样重启 ≠ 与契约修改同一次决策） | 治理纪律 | 下一门 | 违规风险 |

**⛔ 本批次红线（逐条声明已守）**：
⛔ 未修改生产代码；⛔ 未 deploy / rollback；⛔ 未写生产 DB；⛔ 未 merge / master integration；
⛔ 未建 git tag；⛔ 未 activate canary；⛔ 未改 `gen1_production_write` / `gen1_auto_execution` / Authority；
⛔ 未进入 GE-04；⛔ 未执行 V3.6.6 Freeze；⛔ 未执行 Evidence Seal；⛔ 未覆盖/重写冻结契约本体。

---

## 15. 四块式取证（as-of 本批次）

```text
ETF 仓库（契约载体树 _g1-contract-v5-20261002 @ 7d2f39b）：
- Git 跟踪文件：零修改（git diff --stat HEAD 空；冻结契约 blob 实时复核 = 7f86d12a…）
- Git 历史/分支/远端：零修改（docs/gen1-evidence-contract-v5-20261002 未被本批次推进）
- 未跟踪本地草稿：本批次新增 4 项 ——
    · docs/gen1/GEN1_EVIDENCE_CONTRACT_REVISION_PROPOSAL_20261002.md
    · scripts/gen1/evidence-capture/independence_discriminator_v2.js
    · scripts/gen1/evidence-capture/trigger_registry.js
    · scripts/gen1/evidence-capture/fixtures/{r1_independence_cases_v2.json,
      trigger_registry.json, trigger_registry_cloud_observed.json}
  （上一轮未跟踪草稿仍在：复评报告、independence_discriminator.js、r1_independence_cases.json）
其他本机文件：
- 仓库外 _g4-tools/：新增 gen_r1_fixtures_v2.py / gen_trigger_registry.py（⛔ 不入库）
- 工作区记忆（.workbuddy/memory/）：本批次追加当日日志
生产侧：
- 代码 / 配置 / DB / Authority / FROZEN_PARAM_KEYS / lock / immutable_set：零修改
- ⛔ 未部署 / 未 merge / 未 rollback / 未建 tag / 未 activate canary / 未改 auto_execution / 未 GE-04 / 未 Freeze
- 生产 DB writes = 0（全程只读：tcb fn detail 只读；未调用任何函数）
- V3.6.6 树 _v366-cd04-20261002 @ 4d4a67e：git status --short 空（零改动）
```

---

## 16. FINAL STATUS

```text
CONTRACT_REVISION               = PASS_WITH_REMAINING_GOVERNANCE_DECISION
FREEZE                           = NOT READY

R1 EVENT INDEPENDENCE            = RESOLVED   （§3.4A 已固化；判据 v2 可执行 / 可打红 / 可反向证明；
                                                 v1 判据保留只读；两版同判决）
R2 TRIGGER REGISTRY              = RESOLVED   （登记 9 == 云实测 9；S1–S6 全 PASS；
                                                 §5.6 补全为完整枚举域；§5.8 重评执行完毕并重锚 W1∪W2）
R3 input_hash                    = RESOLVED   （裁定 = OBSERVATION，⛔ 非 CONTRACT GAP；
                                                 契约消费面测试 = 0 次命中）

RECOMMENDED VERSION              = v6.0       （备选 v5.1；理由 / 反理由见 §8.2）
TESTS                            = T1–T10 全 PASS；T11–T13 现场重跑仍 PASS（复用依据 = 生产代码零改动）
RED-PROOF                        = PASS       （R1 9 变异 + R2 7 变异，含逐字节还原自证）
REVERSE-PROOF                    = PASS       （旧规则「run_id 不同 ⇒ independent」被 3 条反例证伪；
                                                 错误 Trigger Registry 被 6 类变异全部检出）
PRODUCTION CODE CHANGE REQUIRED  = NO
BLOCKING DEFECT                  = NONE（剩余项均为治理裁定，非技术缺陷）

NEXT GATE                        = owner 裁定 B1（版本标签 + 样本作废声明）与 B2（checkpoint 重锚）
                                   ⇒ 其后为「V3.6.6 Freeze 评审」（⛔ 需单独授权）
```

**⛔ 本批次终点 = STOP-AND-REPORT。**
⛔ 不得据此提案自行进入 V3.6.6 Freeze / merge / deploy / canary / GE-04 / Evidence Seal /
   生产 DB 写入 / 生产代码修改 / git tag。
⛔ 冻结契约本体（`GEN1_EVIDENCE_CONTRACT_V5.md`）本批次**零字节改动**。
