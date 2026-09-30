# V365 RPG-003 State Evolution Semantics Audit

> **性质**：只读审计 + 设计（audit + design）。⛔ **未改 `v364-replay-harness.js` / 任何 production calculation / RDE / parity gate / qualification gate / schema / collection / V1 anchor**。
> **生成**：2026-09-28（GMT+8）｜接手方 = 本机 WorkBuddy 国际版
> **前置**：`docs/V365_RPG_F1_PROBE_EVIDENCE.md`（RPG-F1 = COMPLETE）· `docs/V365_REPLAY_FIDELITY_REPAIR_DESIGN.md`
> **基线**：HEAD `c6bd006fd76ffc5358cddd07347df8ed23d9e61d`
>
> **结论标记**：`[AS-IS]` 代码/数据实测 · `[PROBE]` 探针实测 · `[INFER]` 由实测推出 · `[HUMAN]` 须人工裁定

---

## 0. 裁定接收 `[AS-IS]`

| 项 | 内容 |
|---|---|
| `RPG-F1` | **COMPLETE** |
| RPG-D5 旧结论「未发现 RPG-003」 | **`SUPERSEDED_BY_NEW_EVIDENCE`** |
| **`RPG-003 = CONFIRMED`** | 名称：`replay_state_evolution_assumes_decision_execution_equivalence` |
| 本轮范围 | 只读审计 + 设计；⛔ 不进入 RPG-F2 |

---

## 1. Define the Two Replay Semantics

### 1.1 Replay Type A — **Policy Counterfactual Replay** `[DESIGN]`

```
decision recommendation  →  assumed executed  →  next-day book
```
**回答**：「**如果每条建议都完全执行**，策略轨迹是什么？」
**用途**：同协议代码 parity · 策略规则变化 · 回测 / counterfactual
**当前 V1 的实际语义** —— 证据 `[AS-IS]`：
```js
v364-replay-harness.js:338-340
  // 账面推进：只在**最后一次运行**后生效（同日重跑不改仓位 —— 当天没有成交）
  if (run === runsPerDay - 1) {
    nextBook[u.code] = res.suggested_position != null ? res.suggested_position : (nextBook[u.code] || 0);
```

### 1.2 Replay Type B — **Production Historical Replay** `[DESIGN]`

```
actual execution ledger  +  actual historical position state  →  next-day book
```
**回答**：「**生产系统当时实际处于什么状态**，并因此算出了什么？」
**用途**：当时真实生产结果可重建 · cooldown · real position-dependent behavior · operational audit

### 1.3 ⛔ 命名禁令 `[DESIGN]`

⛔ **不得再把 A 与 B 混称为 `production-faithful replay`。**
两个语义**不可互相替代**，且**不得共用一个未标注语义的 anchor**（见 §9）。

---

## 2. Audit Every State Variable Driven by `nextBook`

### 2.1 数据流 `[AS-IS]`

```
nextBook  ──►  book（次日起点）  ──►  buildPortfolio(book, regime)   [harness:199-228]
                                          │
                                          ├─ tech_position / semi_position / gold_position / drug_position
                                          ├─ total_position → cash_ratio / cash_ratio_raw / leverage_excess / overbooked
                                          └─ market_regime / market_factor   ← 来自 regime 参数，**非** book
                                          ▼
                              sectorUsed = portfolio.tech_position            [harness:244]
                              sectorRemainingLimit = max(0, effTechMax − sectorUsed)   [harness:278]
                                          ▼
                              decisionV3.runDecision(..., { portfolio, sectorRemainingLimit, ... })  [harness:280-291]
```

### 2.2 逐项判定 `[AS-IS]`

| 状态变量 | 判定 | 代码证据 |
|---|---|---|
| **`current_position`** | **DIRECT** | harness `:265` `current_position: nextBook[u.code] \|\| 0` |
| **`tech_position`** | **DIRECT** | `buildPortfolio` `:208`（`TECH_SECTORS` 求和）；消费于 `decision-v3.js:542/558`、`decision.js:243/458/552/576/815` |
| **`cash_ratio`** | **DIRECT** | `buildPortfolio` `:213` `Math.max(0, 100 − total)`；消费于 `decision-v3.js:171`（现金底） |
| **`sectorUsed`** | **DIRECT** | harness `:244`（`:256` 同日重跑重置）`sectorUsed = portfolio.tech_position` |
| **`sectorRemainingLimit`** | **DIRECT** | harness `:278` `max(0, effTechMax − sectorUsed)`；消费于 `decision-v3.js:543` ⇒ `sectorCap` |
| **portfolio concentration** | **INDIRECT** | 经 `tech_position` / `gold_position` / `drug_position` 进入 cap 链 |
| **single ETF cap** | **NONE** | `decision-v3.js:503-510`：`singleMax` 来自 `profile` / `v33Cap` / `params`；`resolveV33Cap(:392-406)` 只经 `shouldUseV35/V34` 与 `isV3PortfolioMode` 读 `multi_etf`/`etf_count`（**非** book 派生） |
| **`market_regime` / `market_factor`** | **NONE** | `buildPortfolio` `:223-224` 取自 `regime` 参数（宽基指数 bars），**非** book |
| **`final_target`** | **INDIRECT** | 经 `sectorCap`（`decision-v3.js:543`）→ `computePositionTargets` / `applyPositionConstraints`（`:574/676`） |
| **`final_action`** | **INDIRECT** | 经 `applySectorHardCap`（`:1239-1242`）+ `eligibilityOverall`（含 regime 闸门，`:908-913`） |

**⇒ 影响面**：**5 项 DIRECT**（`current_position` / `tech_position` / `cash_ratio` / `sectorUsed` / `sectorRemainingLimit`）
+ 3 项 INDIRECT（concentration / `final_target` / `final_action`）；2 项 NONE。

---

## 3. Quantify V1 Model-A Exposure

**探针**：`scripts/v365-rpg003-state-evolution-probe.js` ｜ **证据**：`outputs/v365-rpg003-probe.json`

| 统计量 | 值 |
|---|---|
| `TOTAL_DAY_CODE_STATES` | **125**（25 日 × 5 票） |
| **`STATE_TRANSITIONS_DRIVEN_BY_SUGGESTED_POSITION`** | **12** |
| `BUILD_ADD_TRANSITIONS` | 9 |
| **`REDUCE_TRANSITIONS`** | **3** |
| `HOLD_NO_CHANGE` | 113 |
| `TECH_POSITION_CHANGED_BY_MODEL_A_COUNT` | **10** |
| `CASH_RATIO_CHANGED_BY_MODEL_A_COUNT` | **10** |
| `SECTOR_USED_CHANGED_BY_MODEL_A_COUNT` | **10** |

### 3.1 读法（★ 不要只报 9）

- **12 次**状态转变由 `suggested_position` 推进，**不是 9** —— 另有 **3 次来自 `REDUCE`**
  （`TACTICAL_REDUCE` / `STRATEGIC_REDUCE` 同样推进账面 ⇒ 同属 `decision → assumed execution`）`[PROBE]`
- **25 日中有 10 日**的 `tech_position` / `cash_ratio` / `sectorUsed` 因 Model A 而改变
  ⇒ **窗口内 40% 的交易日，其 portfolio 输入由 Model A 决定** `[PROBE]`
- ⇒ RPG-003 的暴露面**不是"9 次加仓"**，而是**"10/25 日的 portfolio 输入"**

---

## 4. Actual Production State Sources

### Q1 · RDE 的 `current_position` 以哪个集合/字段为 authority `[AS-IS]`

**答：`portfolio_position.current_position`。**

- RDE `:507` `const positions = await db.query(COLLECTIONS.PORTFOLIO_POSITION, {})` ⇒ **唯一 authority**
- RDE `:1087` 对 `PORTFOLIO_POSITION` 的 upsert **只写** `core_position` / `trade_position` / `suggested_core` / `suggested_trade` / 慢变量等级 —— ⛔ **不写 `current_position`**
- 该文件 `:1079-1082` 注释**明文**：
  > 拆分 suggested（决策建议）与 actual（实际持仓，**由成交回写维护**）：
  > · `suggested_core/suggested_trade` = 决策输出（本次建议的目标拆分，**仅作展示**）
  > · `core_position/trade_position` = 实际核心/交易仓（**成交回写**），**决策不覆盖，仅初始化兜底**
- `schema.js` 字段 desc 与之**逐字一致**：`core_position` = "实际核心仓%（**成交回写**，减仓地板）"；`suggested_core` = "决策建议核心仓%（本次输出，**仅展示**）"

### Q2 · `TRADE_LOG` 是成交审计，还是会被 RDE 用于重建仓位 `[AS-IS]`

**答：两者都是，但用途严格分离。**

| 用途 | 是否 | 证据 |
|---|---|---|
| 成交审计（人工台账） | ✅ | `v365-active-read.js:84` `{collection:'trade_log', axis:'MANUAL_LEDGER'}` |
| **重建持仓份额**（加权平均成本法） | ✅ **但只用于「浮盈展示」** | `RDE:463-467` `computeAutoPnl()`：`replayAverageCost(raw)` → 份额/成本 → 市值/浮盈 |
| **重建 `current_position`** | ⛔ **否** | `current_position` 来自 `PORTFOLIO_POSITION`（Q1），`computeAutoPnl` 的输出**不写回** `current_position` |

### Q3 · `portfolio_position` 与 `TRADE_LOG` 不一致时代码如何处理 `[AS-IS]`

**答：不"处理" —— 因为二者在**设计上分离**：**
- `portfolio_position` = **实际持仓的权威**（人工/成交回写维护）
- `TRADE_LOG` = **成交流水**（用于浮盈重建 + 冷静期 add_mode 回退）
- `portfolio_position.shares` / `avg_cost` 的 desc 明写「**操作记录自动累计**，供自动算仓」⇒ 是**派生**，不是权威
- ⇒ **不存在"冲突消解逻辑"**，因为**不设两处都权威的字段**（`suggested_*` 与 `actual` 是**不同字段**）

### Q4 · 生产是否存在可按 `trade_date` 重建的 historical position timeline `[AS-IS]`

**答：★ 存在 —— 通过 `portfolio_snapshot`。**

`portfolio_snapshot`（`schema.js:220-260`）：
- `snapshot_date`：`uk_date` **唯一** ⇒ **每日一行** ⇒ **时间线** ✅
- `positions`：**array（required）** `[{code, position, suggested_position, value, shares, avg_cost, pnl, core, trade}]`
  - **`position: p.current_position || 0`** ← **实际仓位**（`RDE:1301`）
  - `suggested_position` **并列保留**（RDE:1211-1216 的 R3-5 设计）⇒ 建议与实际**显式分离** ✅
- 聚合字段：`tech_position` / `semi_position` / `gold_position` / `drug_position` / `cash_ratio` / `cash_ratio_raw` /
  `leverage_excess` / `overbooked` / `market_regime` —— **与 replay `buildPortfolio()` 的输出键逐一对应** ✅
- 且 `RDE:1225-1226` 注释明写：快照聚合字段用「**更新后的最新 positions 重算**」⇒「**保证快照 = 实时仓位**」

⇒ **生产已存在一个按日、含逐票实际仓位的账面时间线。**

---

## 5. Historical Reconstruction Feasibility

| 数据源 | 状态 | 依据 |
|---|---|---|
| `portfolio_position` **current snapshot** | **AVAILABLE**（但**仅当前**，`uk_code` ⇒ 无历史） | `schema.js:189-218` |
| **`portfolio_snapshot` history**（逐日 + `positions[].position` 实际仓位 + 全部聚合字段） | ★ **模型支持（AVAILABLE in model）**，但**规范 replay 输入包内 `ABSENT`** | `schema.js:220-260`；`deliverables/` 仅日线 CSV |
| `trade_log` history | **PARTIAL** —— 仅一份**仓外、非规范**临时 dump（10 条，`08-14→08-24`） | RPG-F1 §4 |
| `position_after` history | **PARTIAL** —— 真实 10 条中仅 **5 条**含该字段（4 条 sell 全缺） | RPG-F1 §4 |
| cash history | **AVAILABLE in model**（`portfolio_snapshot.cash_balance` / `cash_ratio`）· **ABSENT in package** | `schema.js:224/229` |
| manual adjustments | **PARTIAL**（`trade_log.reason` 为自由文本；无结构化"人工调整"事件） | RPG-F1 §4 |

### 5.1 结论 `[INFER]`

```
PRODUCTION_HISTORICAL_REPLAY_NOT_CURRENTLY_RECONSTRUCTABLE
```
**字面成立**（规范输入包内无 `portfolio_snapshot` 历史），**但**：
- ⛔ **不是 schema/设计缺陷** —— `portfolio_snapshot` **已具备**重建 `actual_book(date, code)` 的**全部字段**
- ✅ 唯一阻塞 = **受治理的数据导出**（与 RPG-002 的执行账本同类，但**数据源更干净**：
  `portfolio_snapshot` 是**受治理集合**，而 `trade_log` 的 dump 是仓外临时文件）
- ⛔ **不使用插值或猜测补洞**（本审计未做任何插值）

⇒ 建议登记为 **`PH_REPLAY_RECONSTRUCTABLE_PENDING_SNAPSHOT_EXPORT`**（区分于"不可重建"）`[HUMAN]`

---

## 6. Replay Protocol Architecture

### 6.1 建议：**明确拆为两个协议** `[DESIGN]`

| | **RFP-V2-CF**（Counterfactual Policy Replay） | **RFP-V2-PH**（Production Historical Replay） |
|---|---|---|
| book 语义 | `nextBook = suggested_position`（**assumed execution**） | `book(date) = portfolio_snapshot.positions[].position`（**actual**） |
| cooldown | 若测，须用 **counterfactual assumed-execution timeline**，并显式标注 | 用 **actual execution ledger**（`trade_log`） |
| 适合证明 | 同协议代码 parity · 策略规则变化 · 回测 / counterfactual | 当时真实生产结果可重建 · cooldown · real position-dependent behavior · operational audit |
| 数据需求 | 日线 bars（**已有**） | 日线 bars + `portfolio_snapshot` 历史 + `trade_log` 历史（**均待导出**） |
| anchor 语义标记 | `COUNTERFACTUAL_FULL_EXECUTION` | `PRODUCTION_HISTORICAL` |

⛔ **不得强行要求一个 replay 同时承担两种责任** —— 二者的 book 语义**互斥**。

### 6.2 与现状的对应 `[AS-IS]`

- **V1 = RFP-V1 = Type A**（语义等价于 CF，但**从未被如此命名**）⇒ 这正是 RPG-003 的**命名层面**成因
- V1 anchor `25ccbfc7…1723` 应被**追溯标注**为 `COUNTERFACTUAL_FULL_EXECUTION`（⛔ 不重算、不改值）

---

## 7. RPG-001 Relationship

### 7.1 判定 `[AS-IS]`

**答：`both`（CF 与 PH 都需要）。**

**代码事实**：`effectiveTechCap(baseCap, barsMap)`（`correlation.js:338-346`）的输入**只有**：
- `baseCap` ← `merged.tech_sector_max`（参数）
- `barsMap` ← `ETF_DAILY` 日线

⇒ **它完全不依赖 execution ledger，也不依赖 position book** ⇒ 与 §6 的两个协议**均无冲突**。
⇒ 因此在 **CF 与 PH 下都应当**接入同一生产纯函数（否则两个协议都会带着同一个保真缺口）。

**佐证**：RPG-F1 已证 —— 修复仅需 as-of-date bars，而 bars **已在** replay 输入包内 `[PROBE]`。

---

## 8. RPG-002 Relationship

### 8.1 判定 `[INFER]`

**答：cooldown 依赖 `actual execution` ⇒ 归属 `PH`。**

| 场景 | 归属 | 说明 |
|---|---|---|
| **PH replay** | ✅ 正解 | 读 `trade_log`（execution ledger）⇒ 与 §4 Q1-Q4 的生产语义一致 |
| **CF replay** | ⚠️ 仅可作**显式标注的** counterfactual | 若 CF 要测 cooldown，其 timeline 是「**假定全执行**产生的成交序列」⇒ 必须标注 `synthetic_timeline = COUNTERFACTUAL_ASSUMED_EXECUTION` |
| **synthetic branch test** | ✅ 允许 | 须 `synthetic = true`；⛔ **不得计入 production-fidelity anchor** |

### 8.2 ⛔ 证据合并禁令 `[DESIGN]`

```
⛔ 不得把 CF 的「假定执行」cooldown 证据 与 PH 的「真实执行」cooldown 证据合并。
   两者必须分别标注 replay_semantics，并分别落 anchor（见 §9）。
```

⚠️ **附**：CF 若要**自洽**，其 book 假设「全执行」**就必须同时**产生 cooldown
⇒ 现行 V1 的 `cooldownDays: 0` 使 CF **自身不自洽**（详见 §10 边界讨论）。

---

## 9. Anchor Governance Revision

### 9.1 新增 `replay_semantics` `[DESIGN]`

```json
{
  "protocol_version": "RFP-V2",
  "replay_semantics": "COUNTERFACTUAL_FULL_EXECUTION",
  "input_dataset_hash": "…",
  "production_code_sha": "…",
  "replay_harness_sha": "…",
  "result_sequence_sha": "…",
  "coverage_manifest_sha": "…"
}
```
或
```json
{
  "protocol_version": "RFP-V2",
  "replay_semantics": "PRODUCTION_HISTORICAL",
  "…": "同上六项"
}
```

### 9.2 硬规则 `[DESIGN]`

- ⛔ **同一个 `result_sequence_sha` 必须明确属于哪一种 `replay_semantics`** —— 不得裸存
- ⛔ 两个 semantics 的 anchor **不可比较**（数值不同**不构成**回归）
- ✅ 追溯标注 V1 anchor 为 `COUNTERFACTUAL_FULL_EXECUTION`（**只加标注，不改值**）
- `replay_semantics` 枚举（建议）：`COUNTERFACTUAL_FULL_EXECUTION` · `PRODUCTION_HISTORICAL` · `SYNTHETIC_BRANCH`

---

## 10. RPG-003 Classification

### 10.1 选择 `[INFER]`

```
RPG003-A
V1 是合法 counterfactual replay，但过去被错误描述为 production-faithful
```

### 10.2 理由

1. **state evolution 本身自洽** `[AS-IS]`：`nextBook = suggested_position` 且
   `positions.current_position = nextBook[code]`（harness `:265`）⇒ 与"每条建议都完全执行"**内部一致**；
   `sectorUsed` 的**当日**累加（`:335`）也与"同日执行"语义一致；
   `market_regime`/`single ETF cap` 等**非** book 派生项（§2.2 判 NONE）不受影响。
2. **它不是 production-faithful** `[AS-IS]`：生产**显式分离** `suggested_*`（仅展示）与
   `core_position/trade_position`（**成交回写，决策不覆盖**）（§4 Q1）⇒ 与 V1 的 book 规则**直接冲突**。
3. ⇒ 定性为 **命名/描述错误**（mis-description），而非模型内部矛盾。

### 10.3 ⚠️ 边界讨论（**明确写出，不模糊**）`[HUMAN]`

**存在一个可支持 RPG003-B 的严格读法**，须 owner 明确选择：

| 读法 | 结论 | 依据 |
|---|---|---|
| **狭义**（只看 `state evolution`） | **RPG003-A** | §10.2 三条 |
| **严格**（把「CF 自洽」理解为**整个 replay** 必须自洽） | **RPG003-B** | CF 假设「全执行」⇒ **必须**产生 cooldown；而 V1 **硬编码 `cooldownDays: 0`**（harness `:284`）⇒ **CF 自身不自洽** |

⇒ 本审计**推荐 A**（因 §10 的问项限定为 "state evolution"），
但**必须**同时登记：**CF 的 cooldown 硬编码 0 是一个独立的 CF 内部缺口**（属 RPG-002 的 CF 侧表现）。

---

## 11. RPG-F2 Readiness

```
CAN_START_RPG_F2 = PARTIAL
F2-A = YES
F2-B = NO
F2-C = NO
```

| 子项 | 判定 | 理由 |
|---|---|---|
| **F2-A**（仅实现 RPG-001 tech-cap fidelity） | ✅ **YES** | RPG-001 **只依赖 as-of market bars**（§7），bars **已在**输入包内（RPG-F1 `[PROBE]`）⇒ **与 book / execution semantics 完全无关** ⇒ 可独立实施。<br>⚠️ 唯一前置 = 走 §9（REPLAY_INFRA）的变更流程（**流程要求，非数据阻塞**） |
| **F2-B**（实现 cooldown fidelity） | ❌ **NO** | 需 execution ledger（`RPG002-B`）；规范输入包内 **ABSENT** |
| **F2-C**（重构 position book semantics） | ❌ **NO** | 需 `portfolio_snapshot` 历史（§5 结论 `…NOT_CURRENTLY_RECONSTRUCTABLE`）；且它是**最大**的语义变更，应**在 F2-A 之后**单独设计 |

⇒ **三项相互独立**，⛔ **不因 B/C 阻塞而冻结 A**。

---

## 12. 本轮输出 `[AS-IS]`

| 类型 | 路径 |
|---|---|
| 审计文档 | `docs/V365_RPG003_STATE_EVOLUTION_AUDIT.md`（本文件） |
| 只读探针 | `scripts/v365-rpg003-state-evolution-probe.js` |
| 证据 JSON | `outputs/v365-rpg003-probe.json`（gitignored） |

⛔ **未修改现有 replay harness**。

---

## 13. 停止条件 `[AS-IS]`

**本轮已停止，未进入 RPG-F2。**

---

## 14. 边界履行 `[AS-IS]`

| 项 | 实况 |
|---|---|
| `v364-replay-harness.js` | **零修改** |
| production calculation / RDE / parity gate / qualification gate | **零修改** |
| schema / collection | **零修改** |
| 现有 V1 anchor | **未改**（`25ccbfc7…1723`，本轮仅**建议**追加语义标注） |
| RPG-F2 / HD12-2 / HD12-3 / RH1 | **未进入** |
| deploy / commit / push / PR / merge | **均未发生** |
| 仓库 HEAD | 仍 `c6bd006fd76ffc5358cddd07347df8ed23d9e61d` |
| 生产侧 | CloudBase `ModTime` 仍 **UNVERIFIED** |

---

## 附：探针可复现命令

```bash
node scripts/v365-rpg003-state-evolution-probe.js --out outputs/v365-rpg003-probe.json
# 若已有 portfolio_snapshot 导出（PH 侧对照）：
node scripts/v365-rpg003-state-evolution-probe.js --snapshot-dump <portfolio_snapshot.ndjson> --out <path>
```
