# GE-03 设计 Gate（最终版）—— Shadow Guarded Rerun / Replay / Negative Gates

**文档编号**：`GEN1-GE03-DG-1.0`
**性质**：**设计 Gate 最终版**（design gate, final candidate）—— ⛔ **不是实施授权**、⛔ 未落任何 GE-03 代码
**as-of**：2026-09-16T16:50:21+0800（第九轮设计收口）
**修订**：2026-09-17（第十六轮）按 owner `GE03 DESIGN EDIT 裁定包`（**B1–B8 + N1–N4**）修订 —— **仅文档**；
　　　　 ⛔ 未落任何 GE-03 代码；⛔ 该轮结束时决策块为 `DESIGN_GATE FINAL = PENDING FINAL DOC REVIEW`
**修订**：2026-09-17（第十七轮）按 owner **F1/F2 极窄 EDIT 裁定收口**（Final Gate 冻结前最后一次一致性 cleanup）
　　　　 —— D12 schema **set equality** / strict health-domain predicates / §3.3 术语澄清；**仅文档，未实施代码**
**上游前置**：`P2_COMPLETE_DORMANT`（`GEN1-P2PM-1.0`，Attestation PASS）
**本文件前身**：`GEN1_GE03_DESIGN_GATE_DRAFT_20260916.md`（`GEN1-GE03-DESIGN-DRAFT-0.1`；第九轮按 Q1–Q6 裁定收为最终版并改名）

**一句话目标**：

> **GE-03 允许系统「算出」guarded result，但绝不「采用」它。**
> 本阶段存在的意义是把 guarded 路径**跑起来、测透、留证**，同时保证 `final_target` / `final_action` 的**单一真相仍是 baseline**。

---

## 0. 决策块（唯一结论区）

```text
GE03 DESIGN DIRECTION            APPROVED
Q1–Q6                            DECIDED
DESIGN_GATE FINAL                PASS
DESIGN SHA256                    704a8c219d4463a9915b062bb2cfb9e56378dcba7c994741e7cb894480242e40
IMPLEMENTATION AUTHORIZATION     GRANTED
PRODUCTION CHANGE                PROHIBITED
```

⚠️ **本块的三条禁令（本阶段恒真）**：

- ⛔ `DESIGN_GATE = PASS` **不等于** `IMPLEMENTATION_AUTHORIZATION = GRANTED`（Q6 裁定）。
- ⛔ 本文件**不放行**任何代码分支、schema 修改、门禁改动。
- ⛔ 本文件**不放行**任何生产变更。

### 0.1 Q1–Q6 裁定（owner，2026-09-16，第九轮；**已冻定**）

| # | 问题 | 裁定 | 固定口径 |
|---|---|---|---|
| **Q1** | 是否允许新增独立计数字段 | **批准** | 新开 shadow / eligibility 字段，⛔ **严禁复用** `gen1_guarded_effective_invocations`；后者继续只表示**真实采纳且正式落库成功后的累计次数**（selector 仍强制 baseline ⇒ P3 阶段应保持 **0**） |
| **Q2** | shadow 在哪里跑 | **双层，但不另造第二套 V3** | ① 本地 / CI **replay harness** 用于确定性回放与反例；② 真正的 GE-03 集成在**现有 `runDecisionEngine` 内**走**同一个 V3** 的 shadow guarded rerun —— 计算结果，但 selector 继续 `BASELINE`。⛔ 不得新建另一套独立云函数复制 V3 逻辑 |
| **Q3** | 反例类别 N | **N = 7 个一级类别** | 不再自行扩成第 8 个治理类别；每个一级类别可含多个 case；**每类至少要有「负例 + 正控」**，且必须证明测试**能真的打红**（不能是恒绿桩） |
| **Q4** | shadow / replay 是否计入「≥ 30 独立事件」 | **明确：不计入**（**硬裁定**） | replay、synthetic fixture、历史回放、GE-03 shadow rerun **都不得**增加 Evidence Contract 的 `independent_event` 数 —— 它们是**机制 / 安全证据**，不是**独立市场事件证据** |
| **Q5** | `N4` schema 16 / 14 是否顺带收口 | **GE-03 顺带收口** | 在新增 GE-03 审计字段**之前**，先把现有 schema 登记与真实写入对齐（属**数据契约卫生**，不改生产决策语义）；⛔ **不得修改** Evidence Contract v1.0 的 **17 个冻结字段** |
| **Q6** | 设计 Gate 与实施授权是否分离 | **必须分离** | `GE03_DESIGN_GATE = PASS` ≠ `IMPLEMENTATION_AUTHORIZATION = GRANTED`；设计冻结后必须**再一次由 owner 明确 GO**，才允许创建代码分支 / 改代码 |

**Q4 的展开 —— 三条通道严格分开**（本阶段最容易出事的地方）：

```text
① GE-03 replay / synthetic cases
       ↓ 证明代码与门禁正确
       ↓ ⛔ 不增加 independent_events

② GE-03 live shadow guarded rerun
       ↓ 证明真实链路可以安全计算 guarded result
       ↓ ⛔ 同样不自动增加 independent_events

③ GEN1_EVIDENCE_CONTRACT 合格的真实 Canary 市场观测
       ↓ event_cluster_id 去相关
       ↓ independent_event = true
       ↓ ✅ 只有这里才累计那 30 个
```

> ⛔ **不得因为 GE-03 一晚上回放了 1,000 个历史场景，就把 Evidence Gate 写成 1,000 / 30。**
> 那会直接破坏「**冻结在先、采样在后**」的 pre-registration 原则。
> Frozen Contract §6 明确规定：**修改纳入规则 ⇒ 必须升 v2.0，并作废此前全部样本。**

### 0.2 Q1 的字段命名（**按裁定收紧**）

| 字段 | 语义 | ⛔ 不得被理解为 |
|---|---|---|
| `gen1_guarded_shadow_invocations` | **本轮实际完成 guarded V3 shadow rerun 的次数** | 真实采纳次数 / Evidence independent events / 生产 authority |
| `gen1_guarded_shadow_eligible_count` | **本轮满足 GE-03 shadow eligibility 测试条件的次数** | 同上 |
| `gen1_guarded_reject_reason_code` | 复用既有枚举（`DORMANT_BASELINE_AUTHORITATIVE` 等） | —（⛔ 不新增合取项） |
| `gen1_guarded_shadow_replay_ref` | replay 批次可回指的 id / hash（取证用） | — |

**保留且语义不变的既有字段**：

| 字段 | 语义 | P3 阶段应有值 |
|---|---|---|
| `gen1_guarded_effective_invocations` | **真实采纳且正式落库成功**后的累计次数 | **0**（selector 强制 `BASELINE`） |

> ⚠️ 两个新字段**都显式带 `shadow`**，正是为了避免被读成「采纳」或「证据」。
> ⛔ 命名**不得**退回宽泛形式（如 `gen1_guarded_eligible_count`）—— 那与 `adopted` 的语义边界不清。

#### 0.2.1 三个计数器的关系（**顺手钉死**）

```text
gen1_guarded_shadow_eligible_count = guardedShadowEligible === true 的计数
gen1_guarded_shadow_invocations    = 实际完成 Guarded Shadow V3 rerun 的计数
gen1_guarded_effective_invocations = 真实 adopted + 正式落库成功后的累计次数 = GE-03 应保持 0
```

```text
正常态： eligible_count >= shadow_invocations >= 0
         effective_invocations = 0
```

> ✅ **允许** `eligible_count` 增加而 `shadow_invocations` 不增加（rerun 抛错 / fail-closed）
> —— 这**反而是有用的审计信号**，不是缺陷。
> ⛔ 但三者**不得互相推导**（口径见 §3.3）。

### 0.3 `guardedShadowEligible` —— P3-only 派生资格（**B1 + N1 + N2 裁定**）

**定性**：`guardedShadowEligible` 是 **`runDecisionEngine` 内部的 P3-only 派生资格**；
⛔ **不属于** `gen1-safety-permission.js` 的 `guardedChecks`，⛔ **不是** `effective_guarded` 的组成部分。

**三条结构禁令**（源码不变量已锁定；⛔ 任一条被破坏即 **GOVERNANCE DEVIATION**）：

```text
① ⛔ 不新增 `gen1-safety-permission.js` 的**第 9 个** `guardedChecks` 项 ——
   该文件 in-code 注释明写「原因码只作**可解释性**细化，**不新增合取项（§3.3 的 8 项表达式不得增减）**」。
② ⛔ 不改变 Frozen Charter §3.3 的 **8 项** `effective_guarded` 表达式
   （既有 8 项恰为：authority_guarded / freeze_seal_approved / evidence_seal_pass /
     health_allows_guarded / data_ok / domain_strict_in_domain / safety_pass / model_candidate）。
③ ⛔ 绝不把 `guardedShadowEligible` 传给 Guarded Selector ——
   `selectGuardedResult({ effectiveGuarded })` 的入参语义是**采纳资格**（selector 内 `guarded_considered: effectiveGuarded`）；
   一旦传入 shadow 资格，`guarded_considered` 就会被读成「**已考虑采纳**」。
```

**唯一合法落点**：在 `runDecisionEngine` 内、由 `evaluateGen1Permission()` 的**返回信封派生**
（信封已含全部组件布尔：`guarded.checks.*`、`authority`、`health`、`domain`、`data_health`、`model.model_candidate`）
⇒ **零改动 evaluator、天然同源**，不需要复制任何 threshold / safety / domain 逻辑。

```text
guardedShadowEligible =

    authority.gen1_authority === 'CANARY'
  ∧ guarded.checks.health_allows_guarded
  ∧ guarded.checks.data_ok
  ∧ guarded.checks.domain_strict_in_domain
  ∧ guarded.checks.safety_pass
  ∧ guarded.checks.model_candidate
```

**明确排除**（P3 期间结构性未满足，⛔ **不得**被纳入）：

```text
authority_guarded       ← 要求 GUARDED_EFFECTIVE 档 authority；P3 保持 CANARY
freeze_seal_approved    ← 要求 Freeze Seal APPROVED；P3 保持 PENDING
evidence_seal_pass      ← 要求 Evidence Seal PASS；P3 保持 PENDING
```

> **原因**：P3 只验证 **Guarded runtime path 能否安全计算**；
> 生产 adoption 的 **Key1 / Key2 / Key3 仍保持未满足**。

**权限边界（逐条恒真）**：

```text
✅ 只能触发 Guarded Shadow V3 rerun
✅ 只能驱动 shadow / eligibility audit counters
⛔ 不得传入 Guarded Selector
⛔ 不得推导 gen1_adopted
⛔ 不得增加 gen1_guarded_effective_invocations
⛔ 不得增加 Evidence independent_events
```

#### 0.3.1 N2 裁定：**不直接复用 `effective_canary`**（取**从严** Guarded runtime 口径）

`effective_canary` **可作对照诊断**，但 ⛔ **不得等同**于 Guarded Shadow eligibility。

**代码依据（两套口径逐项不同，`src/common/utils/gen1-safety-permission.js`）**：

| 维度 | `effective_canary`（**从宽**） | `guardedShadowEligible`（**从严**） |
|---|---|---|
| domain | `domainOk` = `ALLOW` ∨ `CANARY_LIMITED` ∨ `CANARY_ALLOWED_WITH_WARNING` | `domain_strict_in_domain` = `permission==='ALLOW'` **且** `status==='IN_DOMAIN'` |
| health | `healthAllowsCanary` = `!hg \|\| hg.allow_canary !== false`（**缺失即视为允许**） | `health_allows_guarded` = `!!hg` **且** 观测 health 显式 `OK` **且** `gate_status` 显式 `ACTIVE`（**缺字段 fail-closed**） |
| data | `dataOk`（`status === 'OK'`） | `data_ok`（同） |
| safety | `safetyPass`（`permission === 'PERMIT'`） | `safety_pass`（同） |
| model | `candidate` | `model_candidate`（同） |
| authority | `CANARY_OVERRIDE` | P3 要求 `gen1_authority === 'CANARY'` |
| 封印（Freeze / Evidence） | **不要求** | **不要求**（P3 有意排除，见上） |

> ⇒ GE-03 是对**未来 Guarded runtime path 的预演**，故取 **从严 Guarded runtime 口径**。
> ⛔ 两人写出的 `guardedShadowEligible` **必须逐项一致**（上面 6 项即唯一定义），不得各自发挥。

### 0.4 owner 终验与实施授权留痕（2026-09-17）

**① 设计 Gate 终验 —— PASS**

```text
GE03 DESIGN DIRECTION          APPROVED
Q1–Q6                          DECIDED
GE03_DESIGN_GATE FINAL         PASS
DESIGN SHA256                  704a8c219d4463a9915b062bb2cfb9e56378dcba7c994741e7cb894480242e40
PRODUCTION CHANGE              PROHIBITED
```

- **终验对象** = 上述 `DESIGN SHA256` 所标识的那一版设计文本（owner 对文件本体字节独立复算：`30202 B / 454 行`，与交付指纹逐位一致）。
- **终验结论要点**：第十七轮 revision 与 §8 留痕已存在；§3.1 / §6 ③ 已统一为「整改前 14/16 mismatch → 最终 field-set equality」；
  **F1**（D12 集合相等、⛔ 不锁死数量）、**F2**（health / domain 与 strict Guarded predicate 同构）、
  **§3.3**（`effective_guarded` 采纳资格 ⟂ `guardedShadowEligible` 计算资格）均已落地；
  `Q1–Q6` 完整、`R1–R9` 安全边界未变、`guardedShadowEligible` 仍为 P3-only 计算资格。
- ⚠️ **`DESIGN SHA256` ⛔ 不等于本文件当前字节 SHA**：任何状态 / 批准留痕都会使**当前字节 SHA 前进**；
  `DESIGN SHA256` 恒指向**被 owner 批准的那一版设计文本**。两者不同是**预期**，⛔ 不得读作「设计正文被改」。

**② 实施授权 —— 独立裁定（Q6 分离点）**

```text
GE03 IMPLEMENTATION AUTHORIZATION    GRANTED
AUTHORIZED BASE                      5c517bcc45736e868921de89d4ee007142eb0602
FROZEN DESIGN SHA256                 704a8c219d4463a9915b062bb2cfb9e56378dcba7c994741e7cb894480242e40

BRANCH CREATION                      AUTHORIZED
CODE MODIFICATION                    AUTHORIZED — GE-03 SCOPE ONLY
TEST / REPLAY / NEGATIVE GATES       AUTHORIZED
COMMIT                               AUTHORIZED
PUSH                                 AUTHORIZED
CREATE PR                            AUTHORIZED

MERGE                                NOT AUTHORIZED
DEPLOY                               NOT AUTHORIZED
PRODUCTION AUTHORITY CHANGE          NOT AUTHORIZED
GE-04 PROMOTION                      NOT AUTHORIZED
```

- ⛔ **本条不自动由 ① 导出**：Q6 要求「设计 Gate」与「实施授权」分离，owner 于 ① 完成后**另行单独**发放 ⇒
  上文「三条禁令」中的「⛔ 本文件不放行代码分支」**仍然成立** —— 放行来源是 **owner 的独立裁定**，⛔ 不是本文件。
- 实施阶段仍须遵守 §3.2 红线 `R1–R9` 与 §0.1 Q4（replay / synthetic / shadow **不增加** `independent_event`）。
- ⛔ 实施不得合并 PR、不得部署、不得改生产 authority、不得进入 GE-04 promotion。

---

## 1. 现状基线（Final Doc Review 时点重读；历史 as-of 另列）

| 项 | 值 | 说明 |
|---|---|---|
| `master`（**Final Doc Review 当前 baseline**） | **`5c517bcc45736e868921de89d4ee007142eb0602`** | PR #46 的 **merge commit**，父 = `44b59b8` + `506cb6f`；**纯 docs-only**（4 个 `docs/gen1/*.md`，零运行时代码） |
| `master`（历史 as-of） | `44b59b8be06f041e32e410add03a9f5b1afcb40d` | **本设计初稿时的历史 as-of**；此后 master 前进两次：PR #45（纯 Gen-2）、PR #46（P2 Closure docs-only） |
| P2 状态 | `P2_COMPLETE_DORMANT` | Attestation 已 PASS（含偏差 D1，已结案） |
| selector | `GE_02_BASELINE_AUTHORITATIVE = true`，恒 `BASELINE` | 唯一权威来源 |
| Freeze Seal | `PENDING` / `approved_at = null` / `bindings INCOMPLETE` | ⛔ GE-03 内**不得**置 `APPROVED` |
| Evidence Seal | `PENDING` / `evidence_positive = false` / `independent_events = 0` | ⛔ GE-03 内**不得**置 `PASS` |
| 采纳计数 | `gen1_guarded_effective_invocations` 结构性恒 `0` | ⛔ 不得复用做 shadow / eligibility 计数 |
| 运行期观测源 | **无** source / model SHA 权威观测源 | 承自 #43 锚点 B ⇒ 归 **GE-04 前置** |

### 1.1 从 PR #43 继承的显式锚点（逐条承接）

| # | 锚点 | 归属 | GE-03 内的处置 |
|---|---|---|---|
| A | `guardedEffectiveInvocations` 为进程级计数、语义 = **真实采纳次数** | GE-03 | 统一口径；shadow / eligibility **另开**字段（§0.2） |
| B | 运行期**无** source / model SHA 权威观测源 ⇒ `freeze_seal_approved` 恒 not-approved | **GE-04** | GE-03 **不修**，仅记录为 GE-04 硬前置 |
| C | shadow guarded rerun + 反例 / replay 门 | **GE-03** | 本阶段主体 |
| D | 显式、可审计的 promotion 路径 | GE-04 | GE-03 不得新建提权路径 |
| E | Evidence Gate：独立事件 ≥ 30 + `EVIDENCE_POSITIVE` | GE-04 | GE-03 只提供**计数口径**，不判定通过 |
| F | 章程 v2.0 + 新 runbook | GE-04 | — |

---

## 2. 工程形态（双层，但**同一个 V3**）

**② 真实链路 —— GE-03 集成的主体**：

```text
生产链 baseline V3
      ↓
Gen-1 / gates
      ↓
P3 shadow trigger
      ↓
同一个 V3 再跑一次 S4
      ↓
guarded_result
      ↓
记录 baseline / guarded / delta
      ↓
Guarded Selector
      ↓
仍然强制 BASELINE
      ↓
正式 decision_result 完全不变
```

> ✅ 与 Frozen Charter 的 **P3 护栏 F** 完全一致：
> 「**可以计算 guarded result，但 authoritative selector 永远选 baseline**」。

**① 本地 / CI replay harness —— 机制与反例证据**：负责大量历史场景、mutation tests、fail-closed 负例。

```text
① 真实链路  → 证明「真实接线没问题」
② replay harness → 证明「反例真的能挡住」
```

⛔ 二者**不能互相替代**：只做 ① 只证明算法，**不足以证明真实集成拓扑**；
只做 ② 只证明离线算法，**不足以证明接线正确**。

### 2.1 V3 本体的调用约束与「既有 Canary S4」同形关系（**N3 裁定**）

**约束（immutable）**：`src/common/utils/decision-v3.js` 与 `src/common/utils/decision.js`
**在 `ml/manifests/V361_IMMUTABLE_LOCK.json` 覆盖内**（`scripts/verify-immutable.js` 逐条比对
`decision_v3_sha256` / `decision_sha256`）⇒ GE-03 **只能 orchestrate / call，不得修改**；本项由 **R6** 覆盖。

**同形关系（⛔ 不是第三套 S4 重跑）**：现有生产链**已经存在** Canary 反事实重跑 ——
`runDecisionEngine` 内 `result.gen1_canary_source = 'V361_RERUN_S4'` + `buildCanaryCounterfactual(...)`。
GE-03 的 Guarded Shadow 与它**同形**：用 permission 变体重跑**同一个 immutable V3** 的 S4，
产出一个**并行来源**（如 `V361_RERUN_S4_GUARDED_SHADOW`）。
⛔ 不得表述为新算法、⛔ 不得复制 V3 逻辑。

**机器可审计的实施约束（`S4 invocation census`）**：

```text
GE-03 实施 PR 必须提交一份 S4 invocation census，说明：
  ① baseline V3
  ② 既有 Canary rerun（V361_RERUN_S4）
  ③ Guarded Shadow rerun
各自的**触发条件 / 输入上下文 / 调用次数**。

若 ② 与 ③ 的 V3 输入**逐项相同** ⇒ ⛔ 不得重复计算两次，应**共享同一 rerun result**。
若输入确有差异 ⇒ 必须**列出 input delta**，但仍**只能调用同一个 immutable V3**，
⛔ 不得复制或改写 V3 逻辑。
```

### 2.2 「Shadow」命名边界（**N4 裁定**）

```text
① runGen1ShadowEod / runIntegratedShadowEod / runGen2ShadowEod
   = 当日 EOD observation / signal 生产；≠ GE-03
② ml_shadow_* / v3-shadow.js / ml/shadow/SHADOW_PROTOCOL.md
   = ML 观察与研究 shadow；≠ GE-03
③ GE-03 Guarded Shadow
   = runDecisionEngine 内的 audit-only V3 rerun（本文件主体）
```

> ⛔ **禁止**用 EOD shadow 的 flags 推导 `guardedShadowEligible`
> —— 历史已出现「信号行声称有效、生产链否决」的分裂（承 `GEN1_GUARDED_EFFECTIVE_CHARTER.md` 审计 R3）。
> ⛔ GE-03 **不复用、不合并、不改写** ①②两类既有 shadow；三者是**并列命名**，不是同一物。

---

## 3. 设计边界

### 3.1 允许 / 禁止清单

| ✅ GE-03 **允许** | ⛔ GE-03 **禁止** |
|---|---|
| 在 **shadow 通道**内计算 guarded result（产物只进审计字段） | 让 guarded result 成为 `final_target` / `final_action` |
| 在 `runDecisionEngine` 内挂 **P3 shadow trigger**（**同一个 V3**） | 新建第二套独立云函数复制 V3 逻辑 |
| 建 **反例矩阵**（7 类，负例必须被拒） | 把 selector 从 `BASELINE` 改开 |
| 新增**独立的** shadow 计数字段（§0.2 命名） | 复用或重定义 `gen1_guarded_effective_invocations` |
| 新增可失败的**门禁脚本 + 单测** | 把 Freeze / Evidence Seal 制品改成 `APPROVED` / `PASS` |
| 本地 / CI replay harness（确定性回放 + 反例） | 让 replay / shadow 计入「独立事件 ≥ 30」（见 §0.1 Q4） |
| **先**收口 `N4` schema registry / runtime write mismatch（整改前实测 14 / 16），**再**新增字段 | 修改 Evidence Contract v1.0 的 **17 个冻结字段** |
| 在 `runDecisionEngine` 内派生 `guardedShadowEligible`（P3-only，见 §0.3） | 把 `guardedShadowEligible` 写入 evaluator 合成层，或传给 Guarded Selector |

### 3.2 红线（GE-03 全阶段恒真，任何一条被破坏即视为 GOVERNANCE DEVIATION）

```text
R1  正式落库 / 对外的 **authoritative decision_result** 的 final_target / final_action / suggested_position
    唯一来源仍是 baseline。guarded_result **内部**允许由同一个 V3 算出不同的这些字段，
    但它们只是 **shadow audit payload**，**永不得**成为 authoritative result
    （硬还原不得条件化、不得放宽）
R2  production_write === false、auto_execution === false（全档）
R3  AUTHORITY.PRODUCTION 永久锁定；不可被授予
R4  GE_02_BASELINE_AUTHORITATIVE 在 GE-03 内保持 true
R5  Freeze Seal 与 Evidence Seal 制品在本阶段保持非 APPROVED / 非 PASS
R6  既有 immutable_set / lock 所锁对象的真 SHA 不得变化
R7  GE-03 与 GE-02 / GE-04 不混在同一 PR（沿用 #43 已确立的分包纪律）
R8  replay / synthetic / shadow 结果不得写入 independent_event 通道（Q4 硬裁定的红线形式）
R9  GE-03 PR 进入**最终审计**后冻结 (base_sha, head_sha)：任一前进 ⇒ 原审计对象失效、须重新冻结并重新验收；
    冻结后不得 Update branch / rebase / squash；最终合并仅允许 owner 明确授权的 merge commit，
    且 merge 写请求必须绑定 expected head SHA。
    ⚠️ 本条约束的是**最终审计冻结之后**，⛔ 不是「开发过程中永远不得同步 base」
```

### 3.3 口径三分离（承 E22 的教训）

> ⚠️ 「**有资格**」`effective_guarded` —— 准确定义为「**生产 Guarded 采纳资格**」（production Guarded adoption eligibility）
> ⟂「**被采纳**」`gen1_adopted` ⟂ 「**正式决策是否改变**」`final_target`。
> 三者**不得**合成一句、不得互相推导。
> 新增的 **shadow** 计数是**第四个**独立概念，同样不得混入上述任一。
>
> ⚠️ **术语澄清（本轮 F1 / F2 收口；⛔ 不改任何逻辑、不改任何判据）**：
> `effective_guarded` = 「**生产 Guarded 采纳资格**」；它与 **P3-only 的 `guardedShadowEligible`**（§0.3）**不是同一个东西**：
>
> - `effective_guarded` 回答「**能不能采纳**」—— P3 期间恒 `false`（`authority_guarded` / `freeze_seal_approved` / `evidence_seal_pass` 结构性未满足）；
> - `guardedShadowEligible` 回答「**能不能计算**」—— P3 期间**允许为 `true`**（只做 audit-only shadow rerun）。
>
> ⛔ 二者**不得互换、不得互相推导**；⛔ `guardedShadowEligible` **不是** `effective_guarded` 的组成项（§0.3 结构禁令 ①②）；⛔ 也不得据此推导 `gen1_adopted`。

---

## 4. 反例矩阵（Q3 裁定：N = **7 个一级类别**）

| # | 一级类别 | 要打的负例 | 正控（必须通过） |
|---|---|---|---|
| 1 | **health** | 健康闸非 `ACTIVE` ⇒ 必须拒；**缺 `health` 字段**或**缺 `gate_status` 字段** ⇒ 一律拒（fail-closed） | **正控必须同时满足 `health === 'OK'` 且 `gate_status === 'ACTIVE'`** ⇒ 才允许计算；⛔ **二者任一不满足 / 任一缺失即拒**（与 §0.3.1 的 `health_allows_guarded` 同源） |
| 2 | **data** | `data_status !== 'OK'` / required feature 缺失 / 数据或 benchmark `stale` / ledger 异常 ⇒ 必须拒 | 数据完整（`OK`）⇒ 允许 |
| 3 | **domain** | `OUT_OF_DOMAIN` ⇒ 必须拒；**`permission !== 'ALLOW'`**（含 `CANARY_LIMITED` / `CANARY_ALLOWED_WITH_WARNING`）⇒ 必须拒 | **正控必须同时满足 `permission === 'ALLOW'` 且 `status === 'IN_DOMAIN'`** ⇒ 才允许；⛔ **二者任一不满足即拒**（与 §0.3.1 的 `domain_strict_in_domain` 同源） |
| 4 | **safety** | 任何会让 guarded 结果成为正式结果的路径 ⇒ 必须拒 | 硬还原生效 ⇒ 允许 |
| 5 | **candidate** | 非 Candidate 日 ⇒ 不得产生 guarded 差异 | Candidate 日 ⇒ 产生 shadow 记录 |
| 6 | **seal** | 生产封印为 `PENDING` ⇒ `effective_guarded = false` | **synthetic / test-only fixture**：夹具 `Freeze = APPROVED` + `Evidence = PASS` + `evidence_positive = true` + `events >= 30` ⇒ **seal gate 本身**可通过（生产制品仍 `PENDING`、selector 仍 `BASELINE`） |
| 7 | **authority** | 非本档 / `PRODUCTION` ⇒ 必须拒 | `CANARY` 档 ⇒ 允许 |

**每一类的强制要求（缺一不可）**：

```text
(a) 至少 1 个**负例**（必须被拒）+ 至少 1 个**正控**（必须通过）—— **7 类一律适用，含 seal**；
(b) 必须证明该类别测试**能真的打红** —— 人为破坏被测逻辑后，该测试必须 FAIL（自证有效，非恒绿桩）；
(c) 类别数**固定为 7** —— ⛔ 不得自行扩成第 8 个「治理类别」。
```

> **`seal` 类正控的合法性（B2 裁定）**：`seal` 的正控**只能**用 **synthetic / test-only 夹具**注入
> —— `gen1-safety-permission.js` 里 `freeze_seal_approved` / `evidence_seal_pass` 均**来自入参**
> （`const guardedSeal = src.guardedSeal || null`）⇒ 夹具可注入。
> ⇒ 与 **R5**（Freeze / Evidence Seal 制品在 GE-03 内保持非 `APPROVED` / 非 `PASS`）**不冲突**。
> ⛔ **不得**为让测试变绿而把**生产制品**改成 `APPROVED` / `PASS`。

> **`data` 类的口径（B2b 裁定）**：只覆盖 **runtime data gate**。
> ⛔ **`样本未成熟` 不得作为 data 类负例** —— T+5 / T+10 / T+20 的 **Evidence maturity** 属
> **Evidence pipeline**（事后证据回填），若拿它当当天 live Guarded Shadow rerun 的 runtime 门，
> 今天的 shadow 会**天然永远「不成熟」**。⇒ Evidence maturity 的测试留在 Evidence pipeline 层。

---

## 5. 验收标准（DoD，全部可机器判定）

| # | 验收项 | 判据（必须可二元判定） |
|---|---|---|
| D1 | shadow 能算出结果 | 同一输入下 guarded 路径**产生**非空结果对象（不同于「结构性恒 false」的装饰） |
| D2 | **采用被阻断（两层断言）** | **① Selector 边界**：即使 shadow 全绿 + synthetic 封印 PASS，`selected_result === baseline_result`（**引用相等**）；**② 落库 / 序列化边界**：authoritative `final_target` / `final_action` / `suggested_position` 与 baseline snapshot **deep-equal**，**且** `gen1_adopted === false`、`gen1_guarded_selector_source === 'BASELINE'`。两层**都要过**：① 保住最强断言，② 使 clone / JSON 序列化**改变对象身份**时不会误报 |
| D3 | 反例矩阵全拒 | **7 类**逐类断言（含负例 + 正控）；且每类**能被打红** |
| D4 | replay 可复现 | 同一历史批次重放输出**逐字段一致**（两次运行 diff 为空） |
| D5 | 计数口径独立 | 新字段不读、不写 `gen1_guarded_effective_invocations`；有静态守卫测试 |
| D6 | 生产 no-op 不退化 | `verifyProductionNoop()` 运行期断言保留；`gen1-overlay-noop` 继续 PASS |
| D7 | 门禁可失败 | 新增门禁脚本在**被人为破坏**时确实失败（自证有效，非恒绿） |
| D8 | immutable 不退化（**锁 Gate 身份，不只锁「全绿」**） | `verify-immutable.js` 既有 **23 / 23** 保持；`gen1-production-gates.js` 既有 **`G1-A … G1-Y` 共 25 个 ID** 必须**全部存在且 PASS** —— ⛔ 禁止删除 / 改名 / 降级任何既有判据；GE-03 **新增 Gate 另行逐 ID 列出**并全部 PASS，⛔ 不得以新增 Gate 替代旧 Gate（防「少一个旧门 + 多两个新门仍全绿」蒙混） |
| D9 | 平价不退化（**AND 口径，⛔ 白名单不得替代 parity**） | **①** 既有 production / CANARY 语义字段平价 **38 / 38 必须 PASS**；**② 且**任何新增 / 变化的 **shadow-only audit 字段**必须**逐字段**进入**静态 allowlist** 并附独立断言。⛔ 禁止 wildcard；⛔ 禁止由运行时配置动态扩大 allowlist；⛔ 白名单**只解释「哪些新 audit 字段允许变化」**，**不得**豁免旧 production parity |
| D10 | 线上零变化 | 合并后线上 `gen1_authority = CANARY`、`ml_effective = false`（**带 `runtime_status.updated_at` 时点**） |
| **D11** | **证据通道隔离** | replay / shadow 无论跑多少轮，Evidence 侧 `independent_events` **恒不增加**（Q4 硬裁定的机器可判定形式） |
| **D12** | **`N4` 已收口（集合相等口径，⛔ 数量不锁死）** | **整改前实测为 mismatch**：schema 登记 **14** 项 vs 真实写入 **16** 项 —— **`14 / 16` 是「整改前」的实测值，⛔ 不是目标值**；**整改后**的验收判据是 **`registered field set === actual write field set`（集合相等）**，⛔ **数量不锁死**（16 只是整改前的实测巧合，⛔ 不得写成「必须 16」）。**此后任何新增字段 —— 含 GE-03 shadow 审计字段 —— 同样必须同步注册**；登记集合与真实写入集合再次不等即视为 **GOVERNANCE DEVIATION**。Evidence Contract v1.0 的 **17 个冻结字段零改动**（有静态守卫） |

---

## 6. 实施顺序（每步独立门控）

```text
①  冻结 GE-03 设计边界与验收标准（= 本文件终验 PASS）            ← 当前所处位置
②  ★ owner 另行 GO（IMPLEMENTATION_AUTHORIZATION）              ← Q6 分离点，**必须先有**
③  `N4` schema mismatch 收口：registered field set === actual write field set（整改前 14 / 16） ← Q5
④  新增「同一个 V3」的 P3 shadow trigger + shadow 独立计数字段    ← Q2 / Q1 / 锚点 C
     └ 含 `guardedShadowEligible` 派生（§0.3）与两层阻断断言（D2）
⑤  本地 / CI replay harness + 7 类反例矩阵（负例 + 正控 + 可打红） ← Q3 / D3
⑥  selector 仍强制 `BASELINE`（加静态守卫，防回退）               ← R4
⑦  产出 GE-03 PR，**单独**只读审计（不混 GE-02 / GE-04）          ← R7
⑧  GE-03 合并后才谈「证据积累」启动（口径见 §0.1 Q4）             ← 锚点 E（前置）
⑨  Evidence Gate 通过后才轮到 GE-04 promotion                     ← 锚点 B / E / F
```

---

## 7. 风险与反模式（预先登记）

| 风险 | 表现 | 预防 |
|---|---|---|
| **装饰性 dormant** | guarded 路径永远走不到、代码形同摆设，GE-04 一开就崩 | D1：必须证明「能算出结果」 |
| **影子写路径** | shadow 结果被顺手写进某个下游字段 | D2（**两层断言**）+ R1：Selector 引用相等 + 落库 deep-equal + 运行期硬还原 |
| **口径混用** | 用 adopted 计数冒充 shadow / eligible，证据被虚增 | D5 + §0.2 命名纪律 |
| **恒绿门禁** | 新增门禁无论对错都 PASS | D7 + §4(b) 打红证明 |
| **提前激活封印** | 为让测试全绿而把制品改成 `APPROVED` / `PASS` | R5：制品改动**只能**经专门裁决 |
| **阶段混合** | GE-03 顺手把 GE-04 的观测源补了 | R7 + 锚点 B 归属不动 |
| **[新增] 证据被 replay 刷量** | 回放 1,000 个场景后把 Evidence Gate 写成 1,000 / 30 | **D11 + R8 + §0.1 Q4 硬裁定** |
| **[新增] 第二套 V3** | 为省事复制一份 V3 逻辑到新云函数 ⇒ 真实拓扑从未被验证 | §2 双层形态 + §2.1 同形关系 + Q2 裁定 + `S4 invocation census` |
| **[新增] shadow 资格被当采纳资格** | `guardedShadowEligible` 被顺手传给 Selector、或据以推导 `gen1_adopted` | §0.3 三条结构禁令 + D2 + D5 |
| **[新增] 平价被白名单豁免** | 用「新字段入白名单」绕开 38/38 parity | D9 改为 **AND** 口径（§5） |

---

## 8. 本轮边界

```text
- 本文件为**设计 Gate 最终版**：⛔ 未落任何 GE-03 代码、⛔ 未改 schema / 门禁 / 制品
- 2026-09-17（第十六轮）按 owner `GE03 DESIGN EDIT 裁定包`（B1–B8 + N1–N4）修订：**仅本文件文本**
  ⛔ 未创建分支、⛔ 未 commit / push、⛔ 未建 PR、⛔ 未改任何运行时代码
- 2026-09-17（第十七轮）按 owner **F1/F2 极窄 EDIT 裁定收口**（Final Gate 冻结前最后一次一致性 cleanup）：
  D12 schema **set equality** / strict health-domain predicates / §3.3 术语澄清 —— **仅文档，未实施代码**
- ⛔ 未部署、⛔ 未写线上、⛔ 未提权、⛔ 未改 FROZEN_PARAM_KEYS / lock / immutable_set
- ⛔ 未开始任何「独立事件」计数
- ⛔ 本文件**不进** P2 Closure docs-only PR（见 `GEN1_P2_RELEASE_GATE_20260916.md` §9.4 ③）
```

> ⛔ **不得把本文件读成「GE-03 已启动」**：GE-03 的**代码**阶段须经 §6 ② 的一次独立授权。

---

## 9. 待办（终验后）

| # | 事项 | 说明 |
|---|---|---|
| T1 | owner 对本文件**终验** | ✅ **已完成（2026-09-17）** —— `DESIGN_GATE FINAL = PASS`（见 §0.4①） |
| T2 | owner **单独**发放 `IMPLEMENTATION_AUTHORIZATION` | ✅ **已完成（2026-09-17）** —— **独立**裁定（见 §0.4②）；Q6；⛔ 不得与 T1 合成一次 |
| T3 | 本文件的入库载体 | 单独 docs 承载 —— ⛔ 不与 P2 Closure docs-only PR 混合（见 Gate §9.4 ③） |
| T4 | 锚点 B（运行期 source / model SHA 观测源） | 归 GE-04 硬前置，本阶段只登记 |

---

*本文件是**设计**留痕，不授权任何代码、schema、门禁或生产变更。
`gen1_authority` 保持 `CANARY`；`ml_effective` 保持 `false`；`P2` 保持 `P2_COMPLETE_DORMANT`。
⛔ `DESIGN_GATE = PASS` **不等于** `IMPLEMENTATION_AUTHORIZATION = GRANTED`。*
