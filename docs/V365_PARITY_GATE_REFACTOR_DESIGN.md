# V365 Parity Gate Refactoring Design

> **性质**：只读分析 + 设计（design-only）。⛔ **未改代码**、未改 `scripts/v365-p12-decision-parity.js`、未改任何测试。
> **生成**：2026-09-24（GMT+8）｜接手方 = 本机 WorkBuddy 国际版
> **前置**：`docs/V365_RUN_LIFECYCLE_ARCHITECTURE.md` · `..._DECISION.md` · `..._IMPLEMENTATION_ROADMAP.md`（HD-12）
> **基线**：HEAD `c6bd006fd76ffc5358cddd07347df8ed23d9e61d`
>
> **证据规则**：`[AS-IS]` = 实测事实（含 `file:line`）；`[DESIGN]` = 本设计的提议；`[HUMAN]` = 须人工确认。

---

## 1. Current Problem

### 1.1 当前判据 `[AS-IS]`

`scripts/v365-p12-decision-parity.js` 共 **三道** 判据：

| # | 判据 | 机制 | 例外机制 | 行 |
|---|---|---|---|---|
| **S1** | 改动文件 ∩ 回放**实际依赖集** = ∅ | `require.cache` 实测（**真实依赖图**） | ✅ `ALLOWED_EXCEPTIONS` + **证明义务**（扫 `cloudfunctions/*/index.js` require 数须为 0） | `:80-126` |
| **S2** | `DECISION_CORE` 零改动 | **硬编码 12 项清单** | ❌ **无** | `:128-145` |
| **B1** | 两次 replay 决策序列逐位一致 | 实跑 harness，比 sha256 | — | `:150-185` |

**S2 的判定是绝对的**：
```js
const touchedCore = changed.filter((f) => DECISION_CORE.includes(f));
check('决策核心文件零改动', touchedCore.length === 0, …);   // :143-145
```

### 1.2 为什么会误判

#### (a) `DECISION_CORE` 把**编排层**与**计算层**混为一类 `[AS-IS]`

`DECISION_CORE` 的 12 项里，**11 项**是 `src/common/utils/*`（纯计算），**第 12 项是
`cloudfunctions/runDecisionEngine/index.js`** —— 一个**云函数编排器**。

⇒ 该文件里**任何**改动（含纯注释、纯遥测字段、决策**之后**的写侧接线）都被判为"决策核心被改动"。

#### (b) ★ 更关键：`Δ=0` 对 `runDecisionEngine` **结构性盲区** `[AS-IS]`

实测 replay 的**实际依赖集 = 33 项**，其中 **不含** `cloudfunctions/runDecisionEngine/index.js`：

```
[OUT] cloudfunctions/runDecisionEngine/index.js
[IN ] src/common/utils/decision.js · decision-v3.js · trend-stage.js · defense.js
      swing-structure.js · v3-6-stage-persistence.js · market-regime.js · indicators.js
[OUT] src/common/utils/correlation.js · portfolio-mode.js · portfolio-cash.js
[OUT] 全部 v365-*.js
```

⇒ **两条推论**：
1. **S1 抓不到 RDE** —— RDE 不在依赖集 ⇒ 交集恒不含它 ⇒ `unexpectedOverlap` 恒不命中。
2. **B1（Δ=0）也抓不到 RDE** —— harness `scripts/lib/v364-replay-harness.js` **自行编排**
   （`U(f) = require('src/common/utils/'+f)`，`:26`），**从不加载 RDE** ⇒ 无论 RDE 怎么改，
   replay 结果都不变 ⇒ **Δ=0 对 RDE 恒成立**。

⇒ **`DECISION_CORE`（S2）是 RDE 的**唯一**守卫。** 而它是个硬编码清单。

#### (c) `DECISION_CORE` 的**边际覆盖只有 4 个文件** `[AS-IS]`

| 分类 | 数量 | 文件 |
|---|---|---|
| **同时在** `DECISION_CORE` **与依赖集** | **8** | `decision.js` · `decision-v3.js` · `trend-stage.js` · `defense.js` · `swing-structure.js` · `v3-6-stage-persistence.js` · `market-regime.js` · `indicators.js` |
| **只在** `DECISION_CORE`（S1 抓不到） | **4** | `correlation.js` · `portfolio-mode.js` · `portfolio-cash.js` · **`cloudfunctions/runDecisionEngine/index.js`** |
| 只在依赖集（S1 已覆盖） | 25 | `etf-profile.js` · `v3-2-math-engine.js` · `position-sizing.js` · `shock-filter.js` … |

⇒ **`DECISION_CORE` 相对 S1 的净增益 = 恰好 4 个文件**；其余 8 项是 S1 的**冗余复述**。

#### (d) ★★ 附带发现：**两套 CORE 清单互相漂移** `[AS-IS]`

`scripts/v365-qualification-gate.js:111-116` 有**另一份**独立的 `CORE` 清单（11 项），与
`DECISION_CORE`（12 项）**不一致**：

| 文件 | parity `DECISION_CORE` | gate `Q1.CORE` | 差异 |
|---|---|---|---|
| `decision.js` / `decision-v3.js` / `trend-stage.js` / `correlation.js` / `defense.js` / `swing-structure.js` / `market-regime.js` / `indicators.js` / `portfolio-mode.js` / `portfolio-cash.js` | ✅ | ✅ | 一致（10 项） |
| `v3-6-stage-persistence.js` | ✅ | ❌ | **仅 parity 守卫** |
| `cloudfunctions/runDecisionEngine/index.js` | ✅ | ❌ | **仅 parity 守卫** |
| `v3-shadow.js` | ❌ | ✅ | **仅 gate 守卫** |

⇒ **两份"决策核心"定义各说一套**，且**没有任何机制检测其漂移**。
这与 OD-5 已冻结的「集合名必须收敛到唯一来源」是**同一类问题**（多源真相）。

### 1.3 为什么不是放宽标准

> ⚠️ 这是本节最需要说清的一点。

**现状不是"太严"，而是"分类错误 + 覆盖面错位"**：

| 维度 | 现状 | 评价 |
|---|---|---|
| **过宽** | 把 RDE 整体当"决策核心" ⇒ 编排改动被判 FAIL | ⛔ 误报（false positive） |
| **过窄** | Δ=0 对 RDE **结构性盲区** ⇒ 真正影响决策的 RDE 改动**也检测不到** | ⛔ 漏报（false negative） |
| **多源** | 两份 CORE 清单漂移 ⇒ 同一改动在两个门禁下结论可能不同 | ⛔ 判据不确定 |

⇒ **重构的目标是"分类正确"，不是"放行更多"**：
- **CALC 侧：收紧**（新增 `v3-shadow.js` 等，消除 gate/parity 的漂移 ⇒ 覆盖**变大**）
- **ORCH 侧：从"绝对禁止"改为"授权 + 证明"** —— 这不是放宽，而是**把"无法表达"变成"可表达且可证明"**
  （现状下 RDE 改动只能**绕过门禁**或**手工豁免**，那才是真正的失控）
- **Δ=0 盲区：显式披露**（现状是**静默**盲区，比已知盲区更危险）

**判据不变**：`UNEXPECTED_DECISION_DELTA = 0` 仍是红线，且**仍必须**满足。

---

## 2. Target Model

### 2.1 二分定义 `[DESIGN]`

```
DECISION_CALCULATION_CORE（计算核心）—— 决定"算出什么"
  ├─ score       评分 / Alpha / 权重（selection_scores · market-score-components）
  ├─ signal      信号 / 域 / 趋势阶段（trend-stage · swing-structure · v3-bull-participation）
  ├─ ranking     候选排序 / 组合构建（portfolio-mode · portfolio-cash · position-sizing）
  ├─ regime      市场状态（market-regime · correlation · defense）
  ├─ allocation  目标仓位 / 敞口（v3-3-target-exposure · v3-4-stage-position-engine）
  └─ decision generation  决策生成与阶段持久化（decision · decision-v3 · v3-6-stage-persistence）
  ⇒ ⛔ **任何改动 = FAIL（绝对，无例外、无授权路径）**

DECISION_ORCHESTRATION（编排层）—— 决定"算完之后怎么落地"
  ├─ telemetry             运行时遥测（runtime_status 字段 / 响应字段）
  ├─ lifecycle writer      生命周期编排（candidate → manifest → finality → promotion）
  ├─ manifest writer       run_manifest 写入
  ├─ pointer promotion     active_run_pointer CAS 提升
  ├─ audit                 provenance / history 追加
  └─ promotion adapter     平台适配（publish-store 的 CAS 原语调用）
  ⇒ ⚠️ **允许改动，但必须：授权清单 + 改动声明 + 证明义务**
```

### 2.2 现有清单的归类 `[DESIGN]`

| 文件 | 现属 | 新分类 | 说明 |
|---|---|---|---|
| `src/common/utils/decision.js` | CORE | **CALC** | 决策生成 |
| `src/common/utils/decision-v3.js` | CORE | **CALC** | 决策生成 |
| `src/common/utils/trend-stage.js` | CORE | **CALC** | signal |
| `src/common/utils/swing-structure.js` | CORE | **CALC** | signal |
| `src/common/utils/indicators.js` | CORE | **CALC** | signal |
| `src/common/utils/v3-6-stage-persistence.js` | CORE（仅 parity） | **CALC** | decision generation |
| `src/common/utils/market-regime.js` | CORE | **CALC** | regime |
| `src/common/utils/correlation.js` | CORE | **CALC** | regime |
| `src/common/utils/defense.js` | CORE | **CALC** | regime |
| `src/common/utils/portfolio-mode.js` | CORE | **CALC** | ranking |
| `src/common/utils/portfolio-cash.js` | CORE | **CALC** | ranking |
| `src/common/utils/v3-shadow.js` | CORE（仅 gate） | **CALC** | signal（shadow 对照） |
| **`cloudfunctions/runDecisionEngine/index.js`** | CORE | ⚠️ **MIXED** | **见 2.3** |

### 2.3 ⚠️ `runDecisionEngine/index.js` 是**混合文件**（本设计的核心约束）`[AS-IS]`

该文件**同时包含**计算与编排：
- 计算相关：市场状态推导、参数合并、决策装配（`final_target` / `final_action` / `trend_stage`）
- 编排相关：遥测字段（`:1494-1511`）· 发布门（`:1313-1355`）· candidate 写入（`:540/551`）· 返回体（`:1517+`）

⇒ **按文件分类是不够的**。若把 RDE **整体**划入 ORCHESTRATION，等于**取消**对它的唯一守卫
⇒ **那就是真正的放宽标准**（本设计明确拒绝）。

⇒ **[DESIGN] 二级分类（区域级）**：RDE 内部按 **orchestration zone** 划分，改动**必须落在声明的 zone 内**。
区域边界用**标记注释**锚定（不依赖行号，抗漂移）：

```js
// >>> v365-orch-zone: telemetry
      v365_mode: v365Mode,
      v365_run_integrity: runIntegrity.buildRunTelemetry({ … }),
// <<< v365-orch-zone: telemetry
```

⇒ 门禁按标记对**动态求出行区间**，再与"改动区域清单"比对。

### 2.4 目标判据总表 `[DESIGN]`

| # | 判据 | 变化 |
|---|---|---|
| S1 | 改动文件 ∩ 依赖集 = ∅（+ 例外证明义务） | **不变** |
| **S2′** | `DECISION_CALCULATION_CORE` 零改动 | **拆分**（原 `DECISION_CORE` 的 11 个 src 文件 + `v3-shadow.js`） |
| **S2″** | `DECISION_ORCHESTRATION` 改动 ⇒ 授权 + 证明 | **新增** |
| **S3** | 未分类文件 ⇒ 默认拒绝 | **新增**（防"漏登记即放行"） |
| B1 | Δ=0 determinism | **不变**，但**新增显式盲区披露**（RDE ∉ 依赖集） |

---

## 3. Change Classification

### 3.1 禁止变化：`DECISION_CALCULATION_CORE` `[DESIGN]`

| 项 | 规则 |
|---|---|
| 成员 | §2.2 的 12 个 `src/common/utils/*.js`（含新增 `v3-shadow.js`） |
| 判定 | 改动清单 ∩ CALC ≠ ∅ ⇒ **FAIL** |
| 例外 | ⛔ **无例外、无授权路径、无白名单** |
| 理由 | 这 12 个文件是决策输出的**唯一来源**；改动它们 ⇒ 决策可能变 ⇒ 必须走**升版**而非"授权例外" |

### 3.2 允许变化：`DECISION_ORCHESTRATION` `[DESIGN]`

改动 ORCH 时，**三项必须同时满足**：

| # | 要求 | 机器可判？ |
|---|---|---|
| **① approval manifest** | 提供 `--approval-manifest <path>`，内容含：<br>· `authorized_by`（owner 标识）<br>· `authorization_sha`（**40 位 HEAD SHA 字面值**，绑定当轮授权）<br>· `authorized_at`<br>· `changed_files`（必须与 `--changed-file` **完全一致**）<br>· `orchestration_scope`（声明的 zone 名列表）<br>· `proof`（见 ③） | ✅ 全可判 |
| **② changed file declaration** | `--changed-file` 清单必须**逐项**出现在 manifest 的 `changed_files` 中，且**不得多、不得少** | ✅ |
| **③ proof requirement** | 必须同时提供：<br>· `Δ=0`（replay anchor **逐位不变**）<br>· 12 个 CALC 文件**零改动**<br>· 改动**区域**全部落在声明的 orch zone 内<br>· ⚠️ **显式声明**"Δ=0 不覆盖 RDE"（见 §7 R-3） | ✅（前三）· ⚠️ 第四项为**人工确认项** |

### 3.3 未分类 ⇒ 默认拒绝 `[DESIGN]`

| 情况 | 判定 |
|---|---|
| 改动文件 ∈ CALC | ⛔ FAIL |
| 改动文件 ∈ ORCH 且三项齐备 | ✅ PASS（记入审计日志） |
| 改动文件 ∈ ORCH 但三项缺任一 | ⛔ FAIL |
| 改动文件 ∉ CALC ∪ ORCH，**且 ∈ 依赖集** | ⛔ FAIL（现有 S1 已覆盖） |
| 改动文件 ∉ CALC ∪ ORCH，且 ∉ 依赖集 | ✅ 不触发（如 `docs/`、`scripts/`、`tests/`） |

> ⛔ **默认拒绝**原则：新出现的、未被显式分类的"决策相关"文件 **不得静默放行**。

---

## 4. New Gate Logic

### 4.1 旧逻辑

```
changed = read(--changed-file)
if any(f in changed) in DECISION_CORE:  FAIL        # 绝对，含 RDE
overlap = changed ∩ loadedDeps
if any(f in overlap) not in ALLOWED_EXCEPTIONS:  FAIL
Δ=0 replay twice  →  PASS / FAIL
```

### 4.2 新逻辑 `[DESIGN]`

```
changed        = read(--changed-file)                    # 不变
changedRegions = read(--changed-region)   (可选)          # NEW：file \t start \t end 逐行
approval       = read(--approval-manifest) (条件必需)      # NEW

# ---- A. CALC：绝对禁止 ----
if changed ∩ DECISION_CALCULATION_CORE ≠ ∅:
        FAIL("决策计算核心被改动（无例外路径）")

# ---- B. ORCH：授权 + 证明 ----
orchTouched = changed ∩ DECISION_ORCHESTRATION
if orchTouched ≠ ∅:
        if approval == null:
                FAIL("编排层被改动但未提供授权清单")
        if approval.authorization_sha != HEAD_SHA_40:      # 由调用方以 --head-sha 传入
                FAIL("授权 SHA 与当前 HEAD 不匹配（授权失效）")
        if sorted(approval.changed_files) != sorted(changed):
                FAIL("授权清单与改动清单不一致（多报或少报）")
        if changed ∩ DECISION_CALCULATION_CORE ≠ ∅:
                FAIL("授权不得覆盖计算核心")               # 与 A 冗余，显式重申
        for each f in orchTouched:
                zones = parseOrchZones(f)                  # 由 >>> / <<< 标记动态求出
                for each r in changedRegions[f]:
                        if r not inside any zone(zones):
                                FAIL(`改动区域 ${f}:${r} 不在声明的编排区内`)

# ---- C. 未分类默认拒绝 ----
if changed ∩ loadedDeps ≠ ∅:
        unexpected = (changed ∩ loadedDeps) − ALLOWED_EXCEPTIONS
        if unexpected ≠ ∅:  FAIL("未预期交集")              # 现有 S1，不变

# ---- D. Δ=0（不变）----
s1 = replay(); s2 = replay()
if s1 != s2:  FAIL
if s1 != PARITY_ANCHOR_EXPECTED:  FAIL("anchor 漂移")      # NEW：显式锚点比对

# ---- E. 盲区披露（NEW）----
if orchTouched ≠ ∅:
        WARN("⚠️ Δ=0 不覆盖编排层：RDE ∉ replay 依赖集 ⇒ 本次 Δ=0 对该文件无证明力")
        WARN("   唯一守卫 = 区域声明 + CALC 零改动 + 人工确认（见 R-3）")
```

### 4.3 新增输入参数 `[DESIGN]`

| 参数 | 必需性 | 格式 | 生成方 |
|---|---|---|---|
| `--changed-file <path>` | 现状已有 | 每行一个仓库相对路径 | 调用方（bash） |
| `--changed-region <path>` | 触达 ORCH 时**必需** | 每行 `file<TAB>startLine<TAB>endLine` | 调用方（bash，`git diff -U0` 解析） |
| `--approval-manifest <path>` | 触达 ORCH 时**必需** | JSON（见 3.2 ①） | owner |
| `--head-sha <40hex>` | 触达 ORCH 时**必需** | 40 位十六进制 | 调用方（`git rev-parse HEAD`） |

> ⚠️ 保持脚本**不调子进程**的既有约束（`:22-23`）：所有输入仍由调用方生成并传入。

### 4.4 与既有例外机制的一致性 `[DESIGN]`

`ALLOWED_EXCEPTIONS` 的既有模式（**白名单 + 证明义务**）被**继承**为 ORCH 的设计范式：

| 既有（S1 例外） | 新（ORCH 授权） |
|---|---|
| 白名单文件 `v361-run-context.js` | 白名单类别 `DECISION_ORCHESTRATION` |
| 证明义务：扫 `cloudfunctions/*/index.js` require 数 = 0 | 证明义务：区域落在 zone 内 + CALC 零改动 + Δ=0 + SHA 绑定 |
| 例外**一次性**、随 HEAD 变化失效 | 授权**逐位绑 SHA**、随 HEAD 变化失效 |

⇒ 重构**不是**新发明机制，而是把既有模式**从"文件级"推广到"类别级 + 区域级"**。

---

## 5. Qualification Impact

### 5.1 三项红线如何保持 `[DESIGN]`

| 红线 | 如何保持 |
|---|---|
| **anchor unchanged** | ★ **anchor 由 replay 结果决定，与门禁逻辑无关** —— `s1 = sha256(stableStringify(summarize(replay())))`（`:177-179`）。本重构**不触碰** `harness.replay(...)` 的调用与 `summarize` 的实现 ⇒ anchor **在数学上不可能变**。<br>⚠️ 但 **HD12-3 若给 RDE 加 zone 标记** ⇒ RDE 字节变 ⇒ **需重新资格化**（见 5.3） |
| **Δ=0** | 判据**不变**（B1 段保留）。新增的是 `s1 != PARITY_ANCHOR_EXPECTED` 的**显式比对**（现状只比 `s1 == s2`，**不比 anchor**）⇒ **收紧** |
| **no unexpected decision delta** | S1（依赖集交集）**原样保留**；S2′ 的 CALC 覆盖**扩大**（新增 `v3-shadow.js`）⇒ 更严 |

### 5.2 门禁脚本自身改动的合格面影响 `[AS-IS]`

| 项 | 事实 |
|---|---|
| `scripts/v365-p12-decision-parity.js` 是否在 20 文件合格面 | ❌ **不在**（`file_sha256` 20 项中无 `scripts/`） |
| 改动它是否改变 `candidate_content_sha` | ❌ **不改变** |
| 是否需重新资格化 | ❌ **不需要**（就脚本本身而言） |
| qualification gate 是否引用 parity 脚本 | ❌ **无耦合**（实测 `grep` 零命中）⇒ 改 parity **不影响** 38/38 |

⇒ **HD12-1 / HD12-2 本身零资格化影响**（纯 `scripts/` 改动）。

### 5.3 ⚠️ 唯一的资格化触发点：HD12-3 的 zone 标记 `[DESIGN]`

若采用 §2.3 的标记方案，需在 `cloudfunctions/runDecisionEngine/index.js` 插入标记注释：

| 项 | 影响 |
|---|---|
| 触碰合格面 | ✅ **是**（RDE 在 20 文件内） |
| `candidate_content_sha` | ⚠️ **改变** ⇒ 需重算 manifest |
| 重新资格化 | ✅ **需要**（38/38 + 8/8 + 20 文件校验） |
| Δ=0 | ⚠️ **必须复跑确认**（注释不应影响行为，但**必须实测**，⛔ 不得以"只是注释"为由跳过） |
| parity anchor | 预期不变（注释不改行为）—— ⚠️ **但必须实测**，不得推定 |

⇒ **[HUMAN] HD12-D1**：是否接受"为 zone 标记付一次重新资格化"的代价？
（替代方案：HD12-2 阶段先只用**文件级 + 授权**，区域级留待 HD12-3；代价是中间期 RDE 仍无区域约束。）

---

## 6. Migration Plan

### HD12-1 — 分类层（零行为变更）

| 项 | 内容 |
|---|---|
| **范围** | 把 `DECISION_CORE` **拆为两个常量表** `DECISION_CALCULATION_CORE` + `DECISION_ORCHESTRATION`；**判定逻辑保持不变**（两表**并集**仍全部禁止改动） |
| **修改文件** | `scripts/v365-p12-decision-parity.js` |
| **合格面影响** | ❌ 无（`scripts/` 不在 20 文件内） |
| **行为变更** | ⛔ **零** —— 判定结果与现状**逐位相同**（并集 == 旧 `DECISION_CORE` + `v3-shadow.js`） |
| **⚠️ 注意** | 并集比旧表**多 1 项**（`v3-shadow.js`，来自 gate 的漂移发现）⇒ 严格说**更严**。若不希望在本步引入收紧，可先只做拆分、`v3-shadow.js` 的收敛留到 HD12-3 |
| **验收** | 对同一 `--changed-file` 清单，新旧脚本结论**完全一致**（除 `v3-shadow.js` 一项） |
| **价值** | 先建立**分类词汇**与文档；为 HD12-2 铺路；**零风险** |

### HD12-2 — 判定层（授权 + 证明）

| 项 | 内容 |
|---|---|
| **范围** | 实现 §4.2 的 A / B / C / D 四段 + §4.3 的 4 个输入参数 |
| **修改文件** | `scripts/v365-p12-decision-parity.js`（+ 可选：`docs/` 下新增 `approval manifest` 模板） |
| **合格面影响** | ❌ 无 |
| **行为变更** | ✅ **有** —— CALC 命中 ⇒ FAIL（绝对）；ORCH 命中 ⇒ 需授权 + 证明；未分类 ⇒ 默认拒绝 |
| **前置** | ⛔ **必须先完成 HD12-1**（分类词汇） |
| **验收** | ① 构造 4 类样本（CALC 改动 / ORCH+完整授权 / ORCH+缺授权 / 未分类）逐一验证判定；② 现有分支改动（RDE 已改）在新门禁下的结论**必须**为"ORCH + 需授权"而非 PASS |
| **风险** | ⚠️ 见 §7 R-1 / R-2 |

### HD12-3 — 加固层（区域级 + 盲区披露 + 单一来源）

| 项 | 内容 |
|---|---|
| **范围** | ① 在 RDE 插入 `>>> / <<< v365-orch-zone:` 标记；② 门禁解析标记动态求 zone；③ 实现 `--changed-region` 比对；④ 实现 §4.2-E 的**盲区披露**；⑤ 收敛 gate `Q1.CORE` 与 parity 的分类为**单一来源** |
| **修改文件** | `cloudfunctions/runDecisionEngine/index.js`（**触碰合格面**）· `scripts/v365-p12-decision-parity.js` · `scripts/v365-qualification-gate.js`（收敛 `Q1.CORE`） |
| **合格面影响** | ⚠️ **有**（RDE） ⇒ 需重算 manifest + 重新资格化 |
| **行为变更** | ✅ 有 —— ORCH 改动须落在 zone 内 |
| **前置** | HD12-2 |
| **验收** | ① 标记解析对行号漂移鲁棒（插入若干空行后 zone 仍正确）；② 5 处已知失效残留（`runDecisionEngine/index.js:1317/1511/1526/1552/1557`）在新门禁下**可被正确表达**为"ORCH zone 内改动"；③ gate 与 parity 的分类**逐项一致** |
| **风险** | ⚠️ 一次重新资格化；⚠️ 见 §7 R-3 |

### 依赖与顺序

```
HD12-1（分类层，零行为变更，零合格面影响）
   ↓
HD12-2（判定层，零合格面影响）
   ↓
HD12-3（加固层，⚠️ 触碰合格面 ⇒ 重新资格化）
```

---

## 7. Risks

### R-1 · gate weakening risk（门禁弱化风险）

| 项 | 内容 |
|---|---|
| **风险** | `DECISION_ORCHESTRATION` 的"授权 + 证明"可能演变为**橡皮图章** —— 每次都填一份 manifest 就放行 |
| **为什么真实** | 项目已有先例：`ALLOWED_EXCEPTIONS` 若被滥用会成为"万能豁免"（现有白名单**仅 1 项**，尚未滥用） |
| **缓解** | ① **授权逐位绑定 40 位 SHA**（沿用 `R-GI-002`）⇒ HEAD 一变即失效，**无法长期复用**；② manifest **一次性**、不设"常驻授权"；③ **CALC 侧绝对无例外** ⇒ 授权**只能**覆盖编排；④ `changed_files` 必须**与清单完全一致**（多报/少报均 FAIL）⇒ 无法夹带 |
| **残余风险** | 中 —— 取决于 owner 是否严格执行"逐轮授权" |

### R-2 · unauthorized orchestration change risk（未授权编排改动）

| 项 | 内容 |
|---|---|
| **风险** | 有人把**计算改动**谎报为"编排改动"，借此绕过 CALC 的绝对禁令 |
| **为什么真实** | RDE 是**混合文件** ⇒ "编排"与"计算"在同一文件内 ⇒ 谎报在文件级**无法识别** |
| **缓解** | ① **HD12-3 的区域级 zone** —— 改动行必须落在声明区，**文件级谎报失效**；② 12 个 CALC 文件**绝对零改动** ⇒ 计算逻辑的主战场仍被死锁；③ Δ=0 仍必须（虽对 RDE 无效，但对其余 25 个依赖模块有效）；④ 人工复核 manifest 的 `orchestration_scope` |
| **残余风险** | **中高（HD12-3 之前）→ 中（HD12-3 之后）** —— 区域级是**必要**的，仅文件级不够 |

### R-3 · ★ false negative risk（漏报风险 —— **最重要，且当前已存在**）

| 项 | 内容 |
|---|---|
| **风险** | 门禁**通过**，但 RDE 的改动**确实改变了决策** |
| **根因（实测）** | `cloudfunctions/runDecisionEngine/index.js` **∉** replay 依赖集（33 项中无它）⇒ **Δ=0 对该文件恒成立，无证明力**；S1 也抓不到它 ⇒ **唯一守卫是硬编码清单** |
| **⚠️ 关键定性** | 这**不是**本重构引入的风险 —— **现状就已存在**。当前门禁之所以"看起来安全"，是因为 RDE 被**绝对禁止改动**（S2）。一旦引入 ORCH 授权，**必须**同时补上区域级约束，否则**确实会变成漏报**。 |
| **缓解** | ① **HD12-3 区域级 zone**（核心缓解）；② §4.2-E **显式打印盲区警示** ⇒ 把**静默盲区**变成**已知盲区**；③ 长期选项：**引入编排层 replay harness**（见下）；④ 保留"12 个 CALC 文件绝对零改动"作为计算侧的硬底线 |
| **残余风险** | **中** —— 区域级 zone 能约束"改动落在哪"，但**不能证明**"落在编排区内的改动不影响决策"。⇒ 最终仍需**人工确认**（§3.2 ③ 第四项） |
| **长期选项（建议登记，不在 HD12 范围）** | 新增一个 **orchestration-level harness**：用桩驱动 RDE 的编排路径（决策之后的部分），断言"给定相同 candidate 输入，编排输出逐位一致"。这能把 RDE 纳入**可证明**范围，从根本上消除盲区。⇒ **HD12-D2** |

### R-4 · 判据多源漂移风险（本设计附带解决）

| 项 | 内容 |
|---|---|
| **风险** | `DECISION_CORE`（parity，12 项）与 `Q1.CORE`（gate，11 项）**各说一套**，无机制检测漂移 |
| **缓解** | HD12-3 ⑤ 把两者收敛到**单一来源**（与 OD-5 已冻结的"集合名唯一来源"同一原则） |
| **残余风险** | 低（收敛后为零） |

### R-5 · 脚本自指风险

| 项 | 内容 |
|---|---|
| **风险** | 门禁脚本自身被改动后，其"自证"能力下降（谁保证新门禁是可信的？） |
| **缓解** | ① 门禁脚本**不在** 20 文件合格面 ⇒ 不受 manifest 保护 ⇒ ⚠️ **这本身是个弱点**；② 缓解：HD12-2 的验收要求"构造 4 类样本逐一验证"；③ 建议把门禁脚本纳入**变更审计**（每次改动记入台账/日志） |
| **残余风险** | 低-中 |

---

## 8. 待人工确认 `[HUMAN]`

| # | 问题 | 建议 | 阻塞 |
|---|---|---|---|
| **HD12-D1** | 是否接受"为 zone 标记付一次重新资格化"（HD12-3）？ | ✅ 接受（区域级是 R-2/R-3 的必要缓解） | HD12-3 |
| **HD12-D2** | 是否登记"编排层 replay harness"为独立工作包（根治 R-3）？ | ✅ 登记，⛔ 不在 HD12 范围 | 不阻塞 |
| **HD12-D3** | HD12-1 是否**同时**收敛 `v3-shadow.js`（即本步即引入一次收紧）？ | ⚠️ 两可 —— 收紧是好事，但会让"零行为变更"这一承诺失效 | HD12-1 |
| **HD12-D4** | `DECISION_CALCULATION_CORE` 是否**冻结为 12 项**（含 `v3-shadow.js`）？是否还有未登记的计算模块（依赖集 25 个 `src/common/utils/*` 中仅 8 项在旧 CORE）？ | ⚠️ **需人工复核** —— 建议逐项过一遍依赖集 33 项，确认无遗漏 | HD12-1 |
| **HD12-D5** | 是否批准**开始 HD12-1**？ | ⚠️ 需 owner 逐项授权 | — |

---

## 本轮边界履行 `[AS-IS]`

| 项 | 实况 |
|---|---|
| 代码 / parity 脚本 / 测试 | **零修改**（本文件为唯一产物） |
| 合格面（20 文件） | 零修改 |
| deploy / commit / push / PR / merge | **均未发生** |
| 仓库 HEAD | 仍 `c6bd006fd76ffc5358cddd07347df8ed23d9e61d`（ahead 14 / behind 0） |
| 生产侧 | CloudBase `ModTime` 仍 **UNVERIFIED**（本会话无该连接器） |

---

## 附：本设计引用的实测事实索引

| 事实 | 出处 |
|---|---|
| `DECISION_CORE` = 12 项（含 RDE） | `scripts/v365-p12-decision-parity.js:129-142` |
| `touchedCore.length === 0` 绝对判定 | 同上 `:143-145` |
| `ALLOWED_EXCEPTIONS` + 证明义务模式 | 同上 `:101-126` |
| anchor 计算式 | 同上 `:177-179` |
| replay 依赖集 = 33 项，**不含 RDE** | 实测 `require.cache`（探针） |
| `DECISION_CORE` 中 **4 项不在**依赖集 | 同上 |
| gate 有**独立** `CORE`（11 项，与 parity 不一致） | `scripts/v365-qualification-gate.js:111-116` |
| gate Q1 的 Δ=0 与 anchor | 同上 `:106-146` |
| gate 与 parity **无耦合** | 实测 `grep` 零命中 |
| parity 脚本**不在** 20 文件合格面 | `ml/manifests/V365_CANDIDATE_MANIFEST.json` `file_sha256` 20 项无 `scripts/` |
| harness 自行编排、从不加载 RDE | `scripts/lib/v364-replay-harness.js:26`（`U(f) = require('src/common/utils/'+f)`） |
| 脚本不调子进程（输入由调用方生成） | `scripts/v365-p12-decision-parity.js:22-23` |
