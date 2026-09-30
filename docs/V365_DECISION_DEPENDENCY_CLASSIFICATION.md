# V365 Decision Dependency Classification

> **性质**：只读审计（audit-only）。⛔ **未改脚本 / 未改测试 / 未改代码**。
> **生成**：2026-09-24（GMT+8）｜接手方 = 本机 WorkBuddy 国际版
> **前置**：`docs/V365_PARITY_GATE_REFACTOR_DESIGN.md`（HD-12）→ 本文是其 **HD12-0** 前置步骤
> **基线**：HEAD `c6bd006fd76ffc5358cddd07347df8ed23d9e61d`
>
> **证据规则**：`[AS-IS]` = 实测；`[INFER]` = 由实测**推出**的结论（标注推理链）；`[HUMAN]` = 须人工确认。
> ⛔ 本审计**不修改任何脚本**；§3 的分类是**提议**，落地属 HD12-1。

---

## 0. 摘要（先读这段）

| # | 发现 | 性质 |
|---|---|---|
| **F1** | replay 依赖集 = **33 项**，其中 **4 项是宿主环境噪声**（WorkBuddy shim），**29 项是仓库文件** | 实测 |
| **F2** | `DECISION_CORE`（parity，12 项）与 `CORE`（qualification gate，11 项）**互相漂移 3 项** | 实测 |
| **F3** | ★ **依赖集里没有任何编排层文件** —— RDE 与全部 `v365-*.js` 都在集外 | 实测 |
| **F4** | ★★ `correlation.js` / `portfolio-cash.js` / `portfolio-mode.js` **只被 RDE require** ⇒ 因 RDE 不在依赖集，它们**永远不被 replay 加载** | 实测 |
| **F5** | ★★ `decision-v3.js:539-540` **读取** `portfolio.effective_tech_cap`；生产由 `correlation.js`（经 RDE:686）供给，而 **harness 不设该字段** ⇒ replay 走**回退分支** | 实测 + 推理 |
| **F6** | `src/common/constants.js` 携带 `DEFAULT_PARAMS` / 评分权重 ⇒ 属**计算类**，但**两个 CORE 清单都不含它** | 实测 |

⇒ **F5 是本审计最重要的发现**：它意味着 Δ=0 的**证明范围**比它看起来**窄** —— 至少 `correlation.js` 的改动**不可能**被 anchor 反映。

---

## 1. Dependency Inventory

### 1.1 采集方法 `[AS-IS]`

复刻 `scripts/v365-p12-decision-parity.js:76-84` 的采集逻辑：

```js
const SELF = rel(require.main.filename);          // 排除门禁脚本自身
require(REPO + '/scripts/lib/v364-replay-harness.js');   // 使 require.cache 充满真实依赖
const loadedDeps = new Set(Object.keys(require.cache).map(rel).filter(p => p && !p.startsWith('..') && p !== SELF));
```

⇒ 得到 **33 项**，与门禁实跑打印的 `回放依赖集大小 = 33` **一致**。

### 1.2 依赖集全量（33 项）

#### (a) 仓库文件（29 项）

| # | 文件 | 加载方式 | 用途（据头部注释 / 导出） | 导出数 |
|---|---|---|---|---|
| 1 | `scripts/lib/v364-replay-harness.js` | 直载（入口） | **回放基础设施**（非产品代码） | 15 |
| 2 | `src/common/constants.js` | 直载（`:35`） | 集合名 + **`DEFAULT_PARAMS`** + 状态枚举 + **评分权重** | — |
| 3 | `src/common/utils/decision-v3.js` | **直载**（`:29`） | 生产决策路径（TrendStage + 三阶段仓位 + Defense/Shock + MarketRegime） | 1 fn |
| 4 | `src/common/utils/indicators.js` | **直载**（`:28`） | 技术指标（`calcMA` / `calcATR` / `closes` …） | 29 |
| 5 | `src/common/utils/v3-shadow.js` | **直载**（`:30`） | Shadow 三目标合并 + O3 缩放（`mergeShadowOutputs` / `buildV3Portfolio` / `applyV361ParamBundle`） | 9 |
| 6 | `src/common/utils/market-regime.js` | **直载**（`:31`） | 市场状态（`calcMarketScore` / `checkCrisisHardTrigger` / `resolveMarketEnvironment`） | 11 |
| 7 | `src/common/utils/swing-structure.js` | **直载**（`:32`） | `swingHighLow` | 3 |
| 8 | `src/common/utils/trade-date-idempotence.js` | **直载**（`:33`） | run 幂等状态机（`planRunInput` / `finalizeState` / `snapshotDayState`） | 5 |
| 9 | `src/common/utils/gen1-canary.js` | **直载**（`:34`） | 反事实账本（`buildCanaryCounterfactual` / `sectorOccupation`） | 5 |
| 10 | `src/common/utils/decision.js` | 传递 | 评分族（`scoreTrend` / `scoreVolume` / `calcOpportunityScore` …） | 27 |
| 11 | `src/common/utils/defense.js` | 传递 | 防守评分（`calcSlowBreakScore` / `scoreTrendBreak` / `scoreDownVolume`） | 15 |
| 12 | `src/common/utils/trend-stage.js` | 传递 | 阶段因子（`STAGE_FACTORS` / `marketFactor` / `getStageFactor`） | 20 |
| 13 | `src/common/utils/market-score-components.js` | 传递 | MarketScore 分项（`calcMVolumeScore` / `calcMGrowthScore` / `calcMRiskScore`） | 11 |
| 14 | `src/common/utils/market-env-diagnostics.js` | 传递 | 环境诊断（`diagnoseIndexStateGate` / `diagnoseRegimeDivergence`） | 5 |
| 15 | `src/common/utils/etf-profile.js` | 传递 | ETF 画像（`adjustStageFactor` / `profileMaxPosition` / `shouldTacticalReduce`） | 9 |
| 16 | `src/common/utils/position-sizing.js` | 传递 | 仓位约束链（`applyPositionConstraints` / `computePositionTargets` / `computeDefenseCapS7`） | 11 |
| 17 | `src/common/utils/shock-filter.js` | 传递 | Shock 识别（`calcShockScore` / `detectShockToday` / `resolveHighVolumeDeclineAction`） | 8 |
| 18 | `src/common/utils/shock-recovery.js` | 传递 | Shock 恢复（`evaluateShockRecovery` / `resolveShockAction` / `isStructuralBreak`） | 7 |
| 19 | `src/common/utils/v3-2-math-engine.js` | 传递 | 乘法数学引擎（`computeBreakoutScore` / `breakoutMultiplier` / `bpmFromMR`） | 21 |
| 20 | `src/common/utils/v3-3-target-exposure.js` | 传递 | 目标敞口（`computeV33Targets` / `stageParticipation`） | 5 |
| 21 | `src/common/utils/v3-4-stage-position-engine.js` | 传递 | 阶段仓位引擎（`computeV34Targets` / `stagePositionTarget`） | 9 |
| 22 | `src/common/utils/v3-5-structural-engine.js` | 传递 | 结构引擎（`computeV35Targets` / `stageFactor` / `resolveBreakoutStageTransition`） | 7 |
| 23 | `src/common/utils/v3-6-stage-persistence.js` | 传递 | 阶段持久化（`computeDowngradeScore` / `evaluateTrendIntegrity` / `shouldAbortPostS5Grace`） | 19 |
| 24 | `src/common/utils/v3-bull-participation.js` | 传递 | Bull 参与度（`computeBullParticipationTargets` / `computeTrendFirstCoreTrade`） | 9 |
| 25 | `src/common/utils/v3-constants.js` | 传递 | 阶段 → StageFactor 映射 | — |
| 26 | `src/common/utils/v3-premium.js` | 传递 | 溢价三级（`classifyPremiumTier` / `downgradeGrade`） | 4 |
| 27 | `src/common/utils/v3-trend-first-position.js` | 传递 | TrendFirst 仓位（`computeTrendFirstTargets` / `stageBasePct`） | 8 |
| 28 | `src/common/utils/gen1-authority.js` | 传递 | Gen-1 权限阶梯（`resolveAuthority` / `authorityAllows` / `rankOf`） | 11 |
| 29 | `src/common/utils/trade-date-progress.js` | 传递 | 交易日推进（`resolveTradeDate` / `advanceDailyCounter` / `resetAnchor`） | 4 |

> **直载仅 7 个产品模块**（#3–#9）：`decision-v3` · `indicators` · `v3-shadow` · `market-regime` ·
> `swing-structure` · `trade-date-idempotence` · `gen1-canary`（`v364-replay-harness.js:28-34`）。
> 其余 20 个 `src/common/utils/*` 均为**传递依赖**。

#### (b) 宿主环境噪声（4 项）`[AS-IS]`

```
C:/Users/…/WorkBuddyAI/…/cli/vendor/shim/broker-ipc-client.cjs
C:/Users/…/WorkBuddyAI/…/cli/vendor/shim/node-brokered-fs-shim.cjs
C:/Users/…/WorkBuddyAI/…/cli/vendor/shim/node-language-shim.cjs
C:/Users/…/WorkBuddyAI/…/cli/vendor/shim/node-safe-delete-shim.cjs
```

**为什么会进来**：门禁的过滤是 `!p.startsWith('..')`（`:83`），而 `path.relative()` 在 **Windows 跨盘符**时
**无法计算相对路径**，直接返回绝对路径 ⇒ 这些仓外文件**不被过滤**。

**影响评估**：⚠️ **无害但需知晓**
- 改动清单是**仓库相对路径** ⇒ 这些绝对路径**永不可能**出现在 `changed` 中 ⇒ **不产生误报**
- 但 ⇒ `回放依赖集大小` 这个**打印值随环境变化**（本机 33，他机可能 29）⇒ ⛔ **不得把它当作跨机可比数字**

---

## 2. Current Classification

### 2.1 两份清单对照 `[AS-IS]`

| # | 文件 | parity `DECISION_CORE`（12） | gate `Q1.CORE`（11） | 一致？ |
|---|---|---|---|---|
| 1 | `src/common/utils/decision.js` | ✅ | ✅ | ✅ |
| 2 | `src/common/utils/decision-v3.js` | ✅ | ✅ | ✅ |
| 3 | `src/common/utils/trend-stage.js` | ✅ | ✅ | ✅ |
| 4 | `src/common/utils/correlation.js` | ✅ | ✅ | ✅ |
| 5 | `src/common/utils/defense.js` | ✅ | ✅ | ✅ |
| 6 | `src/common/utils/swing-structure.js` | ✅ | ✅ | ✅ |
| 7 | `src/common/utils/market-regime.js` | ✅ | ✅ | ✅ |
| 8 | `src/common/utils/indicators.js` | ✅ | ✅ | ✅ |
| 9 | `src/common/utils/portfolio-mode.js` | ✅ | ✅ | ✅ |
| 10 | `src/common/utils/portfolio-cash.js` | ✅ | ✅ | ✅ |
| **11** | `src/common/utils/v3-6-stage-persistence.js` | ✅ | ❌ | ⛔ **不一致** |
| **12** | `cloudfunctions/runDecisionEngine/index.js` | ✅ | ❌ | ⛔ **不一致** |
| **13** | `src/common/utils/v3-shadow.js` | ❌ | ✅ | ⛔ **不一致** |

**出处**：parity `:129-142` · gate `:111-116`。

### 2.2 覆盖矩阵（两清单 × 依赖集）`[AS-IS]`

| | **在依赖集内** | **不在依赖集内** |
|---|---|---|
| **在 CORE 清单内** | **8 项** —— `decision` · `decision-v3` · `trend-stage` · `defense` · `swing-structure` · `v3-6-stage-persistence` · `market-regime` · `indicators`<br>⇒ **双机制覆盖**（S1 交集 + CORE 硬编码） | **4 项** —— `correlation` · `portfolio-mode` · `portfolio-cash` · **`runDecisionEngine`**<br>⇒ ⚠️ **仅 CORE 硬编码覆盖**（S1 与 Δ=0 都抓不到） |
| **不在 CORE 清单内** | **21 项** —— `constants` · `etf-profile` · `gen1-authority` · `gen1-canary` · `market-env-diagnostics` · `market-score-components` · `position-sizing` · `shock-filter` · `shock-recovery` · `trade-date-idempotence` · `trade-date-progress` · `v3-2-math-engine` · `v3-3-target-exposure` · `v3-4-stage-position-engine` · `v3-5-structural-engine` · `v3-bull-participation` · `v3-constants` · `v3-premium` · `v3-trend-first-position` + harness<br>⇒ **仅 S1 覆盖**（且 Δ=0 实测有效） | — |

### 2.3 由矩阵得出的三条结论 `[INFER]`

1. **`DECISION_CORE` 的净增益 = 4 个文件**（右上象限）—— 其余 8 项是 S1 的冗余复述。
2. **左下象限 21 项**（含 `constants.js` 这类**携带决策参数**的文件）**只靠 S1 保护** ⇒ 一旦 S1 的例外机制被放宽，
   这批文件**没有任何第二道防线**。
3. **右上象限 4 项**：S1 与 Δ=0 **同时失效** ⇒ 唯一防线是**硬编码字符串**（无证明义务、无失效机制）。

---

## 3. Proposed Classification

### 3.1 三分法（本审计建议引入第三个桶）`[HUMAN]`

> 设计文档（HD-12）只提了 CALC / ORCH 二分。本审计发现**存在第三类**，建议显式登记：

| 桶 | 定义 | 改动后果 |
|---|---|---|
| **`DECISION_CALCULATION_CORE`** | 其改动**可能**改变 `trend_stage` / `final_target` / `final_action` | ⛔ **FAIL（绝对）** |
| **`DECISION_ORCHESTRATION`** | 其改动**不改变**决策输出，但影响生命周期 / IO / 遥测 | ⚠️ **授权 + 证明** |
| **`REPLAY_INFRASTRUCTURE`** | 回放自身的基础设施（**非产品代码**） | ⚠️ 改动需**单独评审**（它决定 Δ=0 的可信度！） |

> ⚠️ 第三桶不是凑数：`scripts/lib/v364-replay-harness.js` 是**回放证据的生产者**。
> 改它 ⇒ **anchor 会变** ⇒ 但按现行门禁它**不在** `DECISION_CORE`、也不在 `scripts/` 的合格面保护下
> ⇒ **可以静默改变 Δ=0 的含义**。这是一个**真实缺口**（见 §6 HD12-D6）。

### 3.2 提议分类表（27 个 `src/common/utils/*` + `constants.js`）

| 文件 | 提议分类 | 依据 |
|---|---|---|
| `decision.js` | **CALC** | 评分族（opportunity score） |
| `decision-v3.js` | **CALC** | 生产决策路径本体 |
| `trend-stage.js` | **CALC** | 阶段因子 → 阶段 |
| `defense.js` | **CALC** | 防守评分 |
| `swing-structure.js` | **CALC** | 摆动结构 → 阶段 |
| `market-regime.js` | **CALC** | 市场状态 → regime |
| `market-score-components.js` | **CALC** | MarketScore 分项 |
| `market-env-diagnostics.js` | **CALC** | 环境诊断**参与** regime 判定 |
| `indicators.js` | **CALC** | 决策输入计算 |
| `etf-profile.js` | **CALC** | `adjustStageFactor` / `profileMaxPosition` |
| `position-sizing.js` | **CALC** | `computePositionTargets`（目标仓位） |
| `shock-filter.js` | **CALC** | Shock 动作重分类 |
| `shock-recovery.js` | **CALC** | Shock 恢复动作 |
| `v3-2-math-engine.js` | **CALC** | 乘法引擎 → Target |
| `v3-3-target-exposure.js` | **CALC** | `computeV33Targets` |
| `v3-4-stage-position-engine.js` | **CALC** | `computeV34Targets` |
| `v3-5-structural-engine.js` | **CALC** | `computeV35Targets` |
| `v3-6-stage-persistence.js` | **CALC** | 阶段持久化 / 降级 |
| `v3-bull-participation.js` | **CALC** | `computeBullParticipationTargets` |
| `v3-constants.js` | **CALC** | 阶段 → StageFactor 映射 |
| `v3-premium.js` | **CALC** | 溢价降级 |
| `v3-shadow.js` | **CALC** | `mergeShadowOutputs` / `buildV3Portfolio`（影子目标） |
| `v3-trend-first-position.js` | **CALC** | `computeTrendFirstTargets` |
| **`src/common/constants.js`** | ★ **CALC** | 携带 `DEFAULT_PARAMS` / `CONSOLIDATION_SCORE_WEIGHTS` / `DEFAULT_OPPORTUNITY_WEIGHTS` / `SCORE_MAX` ⇒ **改它可改决策** |
| `correlation.js` | **CALC**（★ 但**不可测**） | `effectiveTechCap` → `portfolio.effective_tech_cap` → `decision-v3.js:539` |
| `portfolio-cash.js` | **CALC**（★ 但**不可测**） | `computeCashDiagnostics` → `cash_ratio` → `cashRange` |
| `portfolio-mode.js` | ⚠️ **ORCH（诊断）** `[HUMAN]` | `diagnoseV3PortfolioMode` 自称诊断（RDE:342-343 注释：「诊断把它显式暴露，而不是偷偷补字段让生产行为发生变化」）⇒ 建议归 ORCH，但**需人工确认其输出是否回流决策** |
| `gen1-authority.js` | ⚠️ **ORCH（权限门控）** `[HUMAN]` | 权限阶梯；**不产出 target/action**，但决定 Gen-1 覆盖是否生效 ⇒ **边界项** |
| `gen1-canary.js` | **ORCH（反事实/审计）** | 并行账本；⛔ 不参与生产决策（`assertProductionUntouched`） |
| `trade-date-idempotence.js` | ⚠️ **ORCH（run 状态机）** `[HUMAN]` | `planRunInput` / `finalizeState` 决定 run 输入形态 ⇒ **可能间接影响决策** ⇒ 边界项 |
| `trade-date-progress.js` | ⚠️ **ORCH（交易日推进）** `[HUMAN]` | 决定"用哪一天的数据" ⇒ 边界项 |
| `scripts/lib/v364-replay-harness.js` | **REPLAY_INFRA** | 非产品代码；**但决定 Δ=0 的可信度** |

**ORCH 侧（不在依赖集内，需另列）**：
`cloudfunctions/runDecisionEngine/index.js` · `src/common/utils/v365-active-read.js` ·
`v365-publish-store.js` · `v365-atomic-publish.js` · `v365-run-integrity.js` · `v365-contracts.js` ·
（待建）`v365-run-history.js`

---

## 4. Ambiguous Items

### 4.1 指定的 5 项

| # | 项 | 在依赖集 | parity CORE | gate CORE | **歧义点** | 提议 |
|---|---|---|---|---|---|---|
| **A1** | `v3-shadow.js` | ✅ **IN** | ❌ | ✅ | **两门禁不一致**：gate 守卫、parity 不守卫。但它**在依赖集内** ⇒ 改它 ⇒ S1 命中 ⇒ **实际仍被拦住** ⇒ 差异**不影响结果**，只影响**判据自述** | **CALC**（收敛到两门禁一致） |
| **A2** | `cloudfunctions/runDecisionEngine/index.js` | ❌ **OUT** | ✅ | ❌ | **混合文件**：既有计算又有编排；S1 与 Δ=0 **都抓不到**；唯一防线是 parity 硬编码 | **MIXED** ⇒ 需**区域级**二级分类（HD-12 §2.3） |
| **A3** | `correlation.js` | ❌ **OUT** | ✅ | ✅ | ★ **计算模块但不可测**：只被 RDE require ⇒ replay 永不加载 ⇒ Δ=0 对它**恒成立**；S1 也抓不到 ⇒ 唯一防线是两个 CORE 清单 | **CALC**（但必须标注"不可测"） |
| **A4** | `portfolio-mode.js` | ❌ **OUT** | ✅ | ✅ | 同 A3 的**不可测**；但用途是**诊断**（非计算）⇒ 分类本身有争议 | ⚠️ **ORCH（诊断）** `[HUMAN]` |
| **A5** | `portfolio-cash.js` | ❌ **OUT** | ✅ | ✅ | 同 A3 的**不可测**；`cash_ratio` **确实**喂进决策（`cashRange`）⇒ 应留 CALC | **CALC**（但必须标注"不可测"） |

### 4.2 ★★ 新发现的第 6 项：replay 保真度缺口 `[AS-IS]` + `[INFER]`

| 项 | 事实 |
|---|---|
| **生产侧** | `cloudfunctions/runDecisionEngine/index.js:685-688`：`portfolio.effective_tech_cap = techCapInfo.effective_cap`（来自 `correlation.js`）<br>`:707`：`effectiveTechMax = portfolio.effective_tech_cap != null ? … : techMax` |
| **决策侧** | `src/common/utils/decision-v3.js:539-540`：`const techMax = portfolio.effective_tech_cap != null ? portfolio.effective_tech_cap : …` ⇒ **确实读取该字段** |
| **回放侧** | `scripts/lib/v364-replay-harness.js` 的 `buildPortfolio()` 返回对象**不含** `effective_tech_cap`；全文件对 `correlation` / `effective_tech_cap` / `discount` **零命中** |
| **⇒ 推论** `[INFER]` | replay 中 `portfolio.effective_tech_cap === undefined` ⇒ `decision-v3.js:539` 走**回退分支** ⇒ **replay 与生产的决策输入在这一点上不同** |

**⇒ 后果（三层）**：
1. **Δ=0 的证明范围**只覆盖**回退分支**；生产的 `effective_tech_cap` 路径**未被 replay 覆盖**。
2. `correlation.js` 的改动**不可能**被 anchor 反映（与它不在依赖集一致，互为印证）。
3. ⚠️ 但这**未必是缺陷** —— 若这是**已知的范围限定**（replay 只跑 baseline 配置），则属正常；
   若是**未登记的覆盖缺口**，则 Δ=0 的结论被**高估**。

⛔ **[HUMAN] HD12-D7**：F5 属**已知范围限定**还是**未登记覆盖缺口**？（本审计**不自行判定**）

### 4.3 其他新增边界项

| # | 项 | 为什么是边界项 | 提议 |
|---|---|---|---|
| **A6** | `src/common/constants.js` | 携带 `DEFAULT_PARAMS`（`:175`）/ 评分权重（`:353/369/374`）⇒ **可改决策**，但**两个 CORE 清单都不含它** ⇒ 仅靠 S1 | **CALC**（★ 建议补入清单） |
| **A7** | `trade-date-idempotence.js` | `planRunInput` 决定 run 输入形态 ⇒ 可能间接影响决策；同时是**编排状态机** | ⚠️ `[HUMAN]` |
| **A8** | `trade-date-progress.js` | 决定"用哪一天数据" ⇒ 边界 | ⚠️ `[HUMAN]` |
| **A9** | `gen1-authority.js` | 权限门控 ⇒ 决定 Gen-1 覆盖是否生效 | ⚠️ `[HUMAN]` |
| **A10** | `scripts/lib/v364-replay-harness.js` | **Δ=0 证据的生产者**；改它 anchor 会变，但**不在任何 CORE 清单**、也**不在 `scripts/` 合格面** | ⚠️ **`REPLAY_INFRA`（需单独评审）** |
| **A11** | 4 个宿主 shim | 环境噪声，永不进 `changed` ⇒ 无害；但污染 `依赖集大小` 打印值 | 建议：**排除仓外绝对路径**（HD12-3） |

---

## 5. Single Source Proposal

### 5.1 问题 `[AS-IS]`

现状有**三份**互相独立的"决策相关"定义：
1. `scripts/v365-p12-decision-parity.js:129-142` → `DECISION_CORE`（12）
2. `scripts/v365-qualification-gate.js:111-116` → `CORE`（11）
3. `scripts/lib/v364-replay-harness.js:28-34` → 直载的 7 个模块（**隐式**的第三份）

⇒ 三者**无机制保证一致**；已实测出 3 项漂移（§2.1）。
这与 OD-5 已冻结的「集合名必须收敛到唯一来源」是**同一类问题**。

### 5.2 提议：单一分类源 `[DESIGN]`

**新建 `scripts/lib/v365-decision-classification.js`**（纯数据 + 纯函数，无副作用），作为**唯一来源**：

```js
module.exports = {
  CLASSIFICATION_VERSION: 'v365-decision-classification-v1',

  // ⛔ 绝对禁止改动
  DECISION_CALCULATION_CORE: [ /* 24–26 项，含 constants.js / correlation.js / portfolio-cash.js */ ],

  // ⚠️ 允许授权改动（含区域级约束）
  DECISION_ORCHESTRATION: [
    { file: 'cloudfunctions/runDecisionEngine/index.js', zones: ['telemetry', 'lifecycle_writer', '…'] },
    /* … */
  ],

  // ⚠️ 回放基础设施（改动需单独评审）
  REPLAY_INFRASTRUCTURE: [ 'scripts/lib/v364-replay-harness.js' ],

  // 已声明的例外（沿用既有 ALLOWED_EXCEPTIONS 模式 + 证明义务）
  ALLOWED_EXCEPTIONS: [ { file: 'src/common/utils/v361-run-context.js', proof: 'not_wired_in_production' } ],

  // 派生：供门禁直接消费
  allProtected() { /* CALC ∪ ORCH ∪ INFRA */ },
  classify(file) { /* → 'CALC' | 'ORCH' | 'INFRA' | 'EXCEPTION' | 'UNCLASSIFIED' */ }
};
```

**两个门禁改为 `require` 同一份** ⇒ 漂移**结构上不可能**。

### 5.3 迁移顺序 `[DESIGN]`

| 步 | 内容 | 风险 |
|---|---|---|
| 1 | 新建分类源（**纯新增，不改任何门禁**） | 零 |
| 2 | parity 改为从分类源读取（行为**逐位不变** ⇒ 同 HD12-1） | 零 |
| 3 | gate `Q1.CORE` 改为从分类源读取（⚠️ 会**引入 3 项收敛**：`v3-6-stage-persistence` / RDE / `v3-shadow` 的归属变化 ⇒ 覆盖**变严**） | 低 |
| 4 | 与 HD12-2/HD12-3 合流（授权 + 区域级） | 中 |

---

## 6. HD12 Impact

| 步 | 本审计如何支撑 |
|---|---|
| **HD12-1**（分类层） | ① §3.2 提供**提议分类表**（27+1 项逐项有依据）<br>② §1.2 提供**依赖集全量**（分类的输入面）<br>③ §2.1 提供**两份清单的 3 项漂移**（HD12-1 的收敛目标）<br>④ §5.2 提供**单一来源的接口形态**<br>⚠️ **阻塞**：HD12-D3（是否同时收敛 `v3-shadow.js`）、**HD12-D4**（是否把 `constants.js` 补入 CALC）、A6–A9 的归属 |
| **HD12-2**（判定层） | ① §2.2 的**覆盖矩阵**证明"仅 CORE 硬编码覆盖"的 4 项（右上象限）正是最需要"授权 + 证明"的对象<br>② §4.1 的 A2（RDE）证明**必须**引入区域级，否则文件级分类对混合文件无效<br>③ §3.1 的第三桶（`REPLAY_INFRA`）⇒ 判定层需新增该类别的处理（见 HD12-D6） |
| **HD12-3**（加固层） | ① §4.2 的 **F5（保真度缺口）** ⇒ 区域级 zone **不足以**覆盖它 ⇒ 需**另立**"replay 覆盖范围声明"<br>② §4.3 A10（harness）⇒ 建议纳入 `REPLAY_INFRA` 并加**变更评审**<br>③ A11 ⇒ 建议排除仓外绝对路径（让 `依赖集大小` 跨机可比）<br>④ §5.3 步骤 3 的收敛（覆盖变严）⇒ 需**一次显式声明** |

### 6.1 新增待确认项 `[HUMAN]`

| # | 问题 | 阻塞 |
|---|---|---|
| **HD12-D6** | 是否引入第三桶 **`REPLAY_INFRASTRUCTURE`**？（`v364-replay-harness.js` 决定 Δ=0 的可信度，却不在任何 CORE 清单、也不在合格面） | HD12-2 |
| **HD12-D7** | ★ **F5（`effective_tech_cap` 保真度缺口）属已知范围限定还是未登记覆盖缺口？** | HD12-3 |
| **HD12-D8** | `constants.js` 是否补入 `DECISION_CALCULATION_CORE`？（携带 `DEFAULT_PARAMS` / 评分权重，却仅靠 S1） | HD12-1 |
| **HD12-D9** | A7 / A8 / A9（`trade-date-idempotence` · `trade-date-progress` · `gen1-authority`）归 CALC 还是 ORCH？ | HD12-1 |
| **HD12-D10** | 是否采纳 §5.2 的单一来源（`scripts/lib/v365-decision-classification.js`）？ | HD12-1 |

---

## 本轮边界履行 `[AS-IS]`

| 项 | 实况 |
|---|---|
| 脚本 / 测试 / 代码 | **零修改**（本文件为唯一产物） |
| 合格面（20 文件） | 零修改 |
| deploy / commit / push / PR / merge | **均未发生** |
| 仓库 HEAD | 仍 `c6bd006fd76ffc5358cddd07347df8ed23d9e61d`（ahead 14 / behind 0） |
| 生产侧 | CloudBase `ModTime` 仍 **UNVERIFIED**（本会话无该连接器） |

---

## 附：本审计的实测命令索引（可复现）

| 事实 | 复现方式 |
|---|---|
| 依赖集 33 项 | 复刻 `v365-p12-decision-parity.js:76-84`，打印 `require.cache` |
| 直载 7 模块 | `grep -nE "U\('" scripts/lib/v364-replay-harness.js` |
| `DECISION_CORE` 12 项 | `sed -n '129,142p' scripts/v365-p12-decision-parity.js` |
| gate `CORE` 11 项 | `sed -n '111,116p' scripts/v365-qualification-gate.js` |
| 3 模块只被 RDE require | `grep -rn "correlation\.js\|portfolio-mode\.js\|portfolio-cash\.js" --include=*.js src cloudfunctions scripts tests` |
| `decision-v3` 读取 `effective_tech_cap` | `grep -rn "effective_tech_cap" src cloudfunctions` |
| harness 零处提及 correlation | `grep -c "correlation\|effective_tech_cap\|discount" scripts/lib/v364-replay-harness.js` → 0 |
| `constants.js` 携带 `DEFAULT_PARAMS` | `grep -nE "^const [A-Z_]+ = " src/common/constants.js` |
