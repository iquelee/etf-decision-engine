# V3.6.5 Production Integrity — Readiness Report (第一轮，只读审计)

> **轮次性质**：READ-ONLY AUDIT。本轮**未修改任何产品代码**、**未部署**、**未改参数**、**未创建 PR**、**未 merge**。
> ｜ 作者：阿衡 ⚖️ ｜ 日期：2026-09-23 ｜ 基线：`V3.6.4 = FROZEN / MERGED / DEPLOYED / PRODUCTION`

## 0. 执行摘要

**本版本的两块核心地基比预期好得多**：`src/common/utils/v361-run-context.js` 与
`src/common/utils/v361-run-finality.js` **都已完整写就**（含 `FRESHNESS_POLICY`、`input_hash`、
`RUN_STATUS`、`classifyRunFinality`、`planTwoStagePublish` 全状态机），
**但在 `cloudfunctions/` 下的 `require` 数都是 0** —— 即「设计完成、从未接线」。

⇒ 工作量不是「从零实现」，而是「**补数据源 + 接线 + 验证**」。但接线前有 **4 个前置阻断项**
（3 处输入日期缺失 / 字段名不匹配、`as_of_trade_date` 权威源未定、无事务 NoSQL 上的原子切换未验证、
OBS-001 可观测性与「不改 materializeIndicators」的冲突）。

**判定见 §13：`V365_READINESS = BLOCKED_ON_EVIDENCE`。**

## 1. 本轮边界（不可越）

- ⛔ 不改产品代码、不部署、不改 `param_config`、不建 PR、不 merge。
- ⛔ 不改 `V361_IMMUTABLE_LOCK`、`V364_IMMUTABLE_LOCK` / tag、Gen-1 frozen pipeline files。
- ⛔ 不恢复 `breakout_nd`；`materializeIndicators` 的 indicator contract **按当前真实 31 字段**工作。
- ⛔ Gen-1 不得获得新的生产决策权（可继续 CANARY / SHADOW / read-only qualification）。

---

## 2. A. RunContext 审计

### 2.1 CURRENT_RUN_CONTEXT_BEHAVIOR

| # | 问题 | 结论 | 证据 |
|---|---|---|---|
| A1 | 是否被 `runDecisionEngine` 实际调用 | **否** | `cloudfunctions/` 下 `require('…v361-run-context')` **零命中**；仅 `tests/v361-run-envelope-finality.test.js:21-28` 引用 |
| A2 | 是否只是 diagnostic / design | **是** | 文件自述 `v361-run-context.js:14`：「本轮只**构建与诊断**，不改任何生产写入路径（不落库、不阻断、不改 target/action）」 |
| A3 | 5 只 ETF 是否仍各自独立读 latest snapshot | **是** | `for (const etf of etfs) { db.getLatestSnapshot(etf.code) }`（`runDecisionEngine/index.js:517-519`）；`getLatestSnapshot` 按 `calc_date desc` 取该 code **最新一条、无日期约束**（`db.js:251-256`） |
| A4 | 是否存在不同 `calc_date` 被放入同一次 run 的可能 | **存在，且当前无任何机制阻止** | 逐票独立取「各自最新」⇒ 任一票缺 T 日数据即**静默回落 T-1**；`runDecisionEngine` 全文 `calc_date` **无任何比较**（仅 `:521` 赋值、`:723`/`:753` 传参） |
| A5 | `as_of_trade_date` 当前有无唯一真相 | **无（生产侧不存在该概念）** | 全生产链无该字段；设计态定义为「已到快照 `calc_date` 的**最大值**」（`v361-run-context.js:116-117`）——是「**观察到的最大值**」而非「**权威应到日**」 |
| A6 | required / optional freshness policy 是否足够明确 | **是（设计态已到代码级）** | `FRESHNESS_POLICY`（`v361-run-context.js:32-53`）：5 类来源 × 3 种模式（`strict_same_trade_date` / `max_staleness_trade_days` / `max_staleness_days`） |
| A7 | 哪些应 BLOCK、哪些只能 DEGRADED | 见下表 | `v361-run-context.js:218-239` |

**A7 明细**

| 来源 | 模式 | level | 判定 |
|---|---|---|---|
| `etf_snapshot` | `strict_same_trade_date` | **required** | 缺失/不同日 ⇒ **BLOCKED** |
| `indicator_snapshot` | `strict_same_trade_date` | **required** | 同上 ⇒ **BLOCKED** |
| `market_env` | `max_staleness_trade_days`（≤5 交易日） | optional | 超限 ⇒ **DEGRADED** |
| `global_signal` | `max_staleness_days`（≤3 自然日） | optional | 超限 ⇒ **DEGRADED** |
| `fundamental` | `max_staleness_days`（≤120 自然日） | optional | 超限 ⇒ **DEGRADED** |
| （`expected_codes` 为空） | — | — | ⇒ **BLOCKED**（`no_expected_codes`） |

`input_health` 三态：`OK` / `DEGRADED`（仅 optional 有问题）/ `BLOCKED`（required 缺失或过期）。
`input_hash` **已有实现**（`stableStringify` 键递归排序 + sha256，`v361-run-context.js:72-82`）。
`validateSameTradeDate` **已有实现**（`:275-284`）。

### 2.2 V365_RUN_CONTEXT_GAP

| # | Gap | 严重度 | 说明 |
|---|---|---|---|
| **G-1** | **从未接线** | 阻断 | 设计完整但 `require` 数为 0 ⇒ 生产上「混合日期 run」**仍然完全可能** |
| **G-2** | ⚠️ **3 处输入日期「字段名不匹配 / 字段缺失」** | **阻断** | 直接接线会**恒判 BLOCKED（假阳性）**，必须先补数据源：<br>① `global_signals[].as_of_date` ← 生产实际字段是 **`data_date`**（`runDecisionEngine:229`）<br>② `fundamentals[].as_of_date` ← 生产 `fundamental_state` 只写 `{code, f_state, f_score, detail, updated_at}`（`:954-957`），**无数据日期**（`updated_at` 是写入时刻，非数据日）<br>③ `market_env_date` ← 生产**不产出**：`deriveMarketEnvironmentForPortfolio` 只读 `row.weekly_bars`（`market-env-v3.js:22-28`），返回体无日期 |
| **G-3** | `as_of_trade_date` 缺**权威源** | 阻断 | 现设计取「已到快照最大值」⇒ 若 5 票最新日各不相同，as_of 会随数据漂移；判定语义依赖「其余不齐即 BLOCKED」兜底，而非有一个外部权威的「应到交易日」 |
| **G-4** | `etf_snapshot` 与 `indicator_snapshot` 实为**同一张表** | 中 | policy 定义了两个来源，但生产只有 `indicator_snapshot`（行情+指标合一）⇒ 需澄清命名，避免重复计数 |

---

## 3. B. Run Finality 审计

### 3.1 CURRENT_FINALITY_BEHAVIOR

| # | 问题 | 结论 | 证据 |
|---|---|---|---|
| B1 | 是否被生产路径实际调用 | **否** | `cloudfunctions/` 零 `require`；文件自述 `v361-run-finality.js:14`：「本轮**不改变**生产写入路径（仍按 legacy 单阶段写库）」 |
| B2 | 一票或多票失败时 run 是否仍可能返回整体成功 | **是（确定会）** | 单票失败仅 `results.push({ ok: false, error })` 后 `continue`（`:1003-1005`）；函数末尾**无条件** `return { ok: true, … }`（`:1353`）⇒ **PARTIAL 与 COMPLETE 在返回层不可区分** |
| B3 | `decision_result` | 逐票 upsert（`:951`；WAIT 分支 `:686`）⇒ **部分成功的票已落库** |
| B4 | `portfolio_position` | 逐票 upsert（`:967`）⇒ 同上 |
| B5 | `portfolio_snapshot` | 循环**结束后单次写**（`:1124`），但**只要 ≥1 票成功就会写**，且**无「是否基于完整 run」的判据** |

**⇒ 是否可能形成 partial publication：** ✅ **可能**。
例：第 4 票写失败 ⇒ 前 3 票的 `decision_result` + `portfolio_position` **已落库**，`portfolio_snapshot` **仍会写**
⇒ 前台看到的是「**3 只新 + 2 只旧**」的混合组合，且**无任何字段标记它是 PARTIAL**。

**COMPLETE / PARTIAL / FAILED 在当前生产路径中的真实状态**

| 概念 | 设计态 | 生产态 |
|---|---|---|
| `COMPLETE` | 已定义（`RUN_STATUS.COMPLETE`） | **完全不存在**；只要不抛到最外层就只有 `ok:true` |
| `PARTIAL` | 已定义（+ `health_semantics='DEGRADED'`） | **完全不存在**；与 COMPLETE 无区分 |
| `FAILED` | 已定义（`no_expected_codes` / `no_successful_etf`） | 仅当异常抛到最外层才可能体现为整体失败 |
| `publishable` | 已定义（`= status === COMPLETE`） | **不存在** |

### 3.2 V365_FINALITY_GAP

| # | Gap | 严重度 |
|---|---|---|
| **F-1** | 从未接线 | 阻断 |
| **F-2** | 返回体缺 `expected_count` / `success_count` / `failed_count` / `failed_codes`（`:1353-1373` 实为 `ok/version/decision_date/duration_ms/production_engine/shadow_engine/config_version/v3_6_1_enabled/v3_6_1_shadow/ml_shadow/ml_effective/results/shadow_log`） | 高 |
| **F-3** | `portfolio_snapshot` 无「本 run 是否完整」判据 ⇒ 部分 run 也发布 | 阻断 |
| **F-4** | 无 `publishable` / fail-closed 语义 | 阻断 |
| **F-5** | ⚠️ **两套日期语义并存**：`portfolio_snapshot.snapshot_date` = **「今天」北京时间**（`:1048`，`Date.now()+8h`），而 `decision_result.decision_date` = **数据最新日** ⇒ 跨函数读取时必须以哪个为准**未成文**（代码注释承认这是有意分离） | 中 |

---

## 4. C. Publish Atomicity 与 Two-Stage 设计

### 4.1 当前真实写入流（实测）

```
── READ ─────────────────────────────────────────────
getParamConfig()                         :494
getEtfList()                             :498
query(PORTFOLIO_POSITION)                :499
computeGlobalSignals()                   :500   （字段：data_date，非 as_of_date）
deriveMarketRegime(globalSignals)        :501   （读 market_env.weekly_bars，无日期）
getPortfolioSummary()                    :502
for (const etf of etfs)                  :517-519   ← 逐票独立 getLatestSnapshot(code)，无日期约束
deriveMarketEnvironmentForPortfolio()    :555
── CALCULATE + WRITE（逐票，无事务）──────────────────
for (const p of ordered)                 :665
  ├─ upsert DECISION_RESULT              :951   （WAIT 分支 :686）
  ├─ upsert FUNDAMENTAL_STATE            :954
  └─ upsert PORTFOLIO_POSITION           :967
  └─ 单票失败 ⇒ catch ⇒ results.push({ok:false}) ⇒ continue   :1003-1005
── AFTER LOOP ───────────────────────────────────────
upsert PORTFOLIO_SNAPSHOT                :1124  ← 循环结束后单次写
upsert SHADOW_V3_LOG（条件）             :1202
upsert RUNTIME_STATUS (key='runtime-status')  :1351
return { ok: true, … }                   :1353
```

### 4.2 四项确认

| 问题 | 结论 | 依据 |
|---|---|---|
| 中途失败后**已写入的结果会保留**吗 | **会保留** | 逐票 `db.upsert` 无回滚；`db.upsert` 本身是「先查 → update/add」两步（`db.js:89-105`），全仓**无** `runTransaction` / `startTransaction` |
| 前台/后续函数**可能读到半个新 run** 吗 | **可能** | `apiGateway` **分别独立读 4 个集合**：`RUNTIME_STATUS`(`:133,950`)、`PORTFOLIO_POSITION`(`:142,342,517`)、`PORTFOLIO_SNAPSHOT`(`:161,518,617`)、`DECISION_RESULT`(`:507,609`) ⇒ **无 run 级原子视图** |
| 是否存在 **active run** 概念 | **无** | 全仓无 `is_active` / `active_run` / `published_at` / `run_status`（生产决策链） |
| 是否存在 **run_id** | **无（生产链）** | `run_id` 仅存在于 Shadow / Gen-1 / Gen-2 侧集合（`constants.js:38,40`；`schema.js:350,678,696,707`） |
| 能否**原子切换整组结果** | **不能** | CloudBase NoSQL 无跨集合事务；代码无事务 API 调用 |

### 4.3 TWO_STAGE_PUBLISH_DESIGN（最小可行）

**好消息：状态机已存在** —— `PUBLISH_PHASE = {CALCULATING, CANDIDATE_READY, VALIDATED, COMPLETED, ACTIVE}`
与 `planTwoStagePublish(finality, validation)`（`v361-run-finality.js:126-153`）。
**最小可行 = 把它接到真实写入路径**：

```
① CALCULATING
   逐票计算，结果只进内存；**不写** decision_result / portfolio_position 的 active 版本；
   写 run_candidate 集合（每票一条，带 run_id / input_hash / as_of_trade_date / ok / error）

② CANDIDATE_READY
   全部 expected_codes 都有候选（含显式失败标记）

③ VALIDATED
   整体校验：集合完整 ∧ 日期同源（validateSameTradeDate）∧ finality.status === COMPLETE

④ COMPLETED
   候选标记 COMPLETED —— 仍**不是** active

⑤ ACTIVE
   **唯一一次「指针切换」**：写入单一文档 active_run_pointer { run_id, activated_at }
   ⇒ 这是整个流程里唯一需要"原子"的动作，而单文档写入在 NoSQL 上天然原子
```

**任何失败** ⇒ 候选停在 `CANDIDATE_READY`（或直接丢弃）⇒ **上一笔 ACTIVE 保持不变**（fail-closed）。

**前台读取的改造**：先读 `active_run_pointer` 取 `active_run_id`，再按 `run_id` 取该 run 的记录；
或给每条记录打 `run_id` + `is_active`，前台用 `is_active = true` 过滤。
（⛔ 本轮仅设计，不实现。）

**未验证点**：指针切换与前台读之间仍存在**极短窗口**（前台读到老指针 + 新数据，或反之）。
⇒ 需 PoC 确认「读指针 → 按 run_id 查询」两跳在 CloudBase 上的实际一致性表现。**这是 §13 的阻断项 P-3。**

---

## 5. D. Input / Artifact Contract

### 5.1 每笔生产结果当前能回答哪些（实测）

| 目标字段 | 当前状态 | 证据 |
|---|---|---|
| `engine_version` | ⚠️ **有值但语义错**（硬编码 `v3.6.1`，V3.6.4 上线后仍报 v3.6.1） | `v3-shadow.js:74-81`（硬编码字面量）；台账 D-005 附注已登记 |
| `source commit SHA` | ❌ **无** | 结果载荷无 git 相关字段 |
| `deployed package SHA` | ❌ **无** | `deploy.sh` 不记录任何 SHA；仅人工台账手填 `package_sha256` |
| `input_contract_version` | ❌ **无** | 全仓（除两个未接线模块）零命中 |
| `run_id` | ❌ **无（生产链）** | 仅 Shadow/Gen-1/Gen-2 侧有 |
| `input_hash` | ❌ **无（实现已有但未接）** | `v361-run-context.js:80-82` |
| `as_of_trade_date` | ❌ **无** | 生产有 `calc_date` / `decision_date` / `snapshot_date` **三个不同语义**的日期 |
| `snapshot schema/version` | ❌ **无** | `computeSnapshot.version` 是**引擎/参数版本**（来自 `opts.version`），非 schema 版本 |

**⇒ 8 项中 0 项完整可用；1 项有值但语义错。**

**附带事实**：`computeSnapshot` 返回 **32 键**（实跑 `Object.keys`），线上 `indicator_snapshot` 实为 **31 字段**；
全仓唯一声明字段集的是**重放工具**的 `LIVE_SNAPSHOT_FIELDS`（`Set`，31 项，且**主动丢弃 `breakout_nd`**）
⇒ **三处「字段集真相」并存，零断言。**

### 5.2 V365_INPUT_CONTRACT（v1 草案）

**硬前提**：**按当前真实 31 字段契约工作**，⛔ **不恢复 `breakout_nd`**，⛔ 不改 `materializeIndicators` 的 indicator contract。

```
INPUT_CONTRACT_VERSION = 'live-31-v1'
contract_scope         = indicator_snapshot（31 个业务字段）+ 三个日期语义
```

**三个日期语义必须分别命名、不得混用**（当前混在一起是 gap）：

| 名称 | 含义 | 当前载体 |
|---|---|---|
| `as_of_trade_date` | 本次 run 断言「应到的交易日」（**需引入权威源**，见 G-3） | 无（设计中） |
| `calc_date` | 指标快照所基于的数据日 | `indicator_snapshot.calc_date` ✓ |
| `decision_date` | 决策落库日 | `decision_result.decision_date` ✓ |
| `snapshot_date` | 组合快照时刻（=「今天」北京时间） | `portfolio_snapshot.snapshot_date` ✓ |

**契约元数据的落点（两种方案，需裁定）**

| 方案 | 做法 | 风险 |
|---|---|---|
| **①（保守，推荐）** | 契约版本 **不落在** `indicator_snapshot` 上，改落在 **`runtime_status`** + 新集合 **`run_manifest`** | 与 31 字段文档完全隔离 ⇒ **不触碰 indicator contract**，不违反本轮禁令 |
| ②（激进） | 在 `indicator_snapshot` 上加 `_contract_version` / `_field_count` / `_produced_by_sha` 三个**元数据**字段 | 业务字段集不变，但**文档对象被改动** ⇒ 是否算「修改 indicator contract」**需你明确裁定** |

**我倾向 ①**：它同时满足「可追溯」与「不碰 indicator contract」，而且 `run_manifest` 正好承载
`run_id` / `input_hash` / `as_of_trade_date` / `engine_build` / `source_sha` / `package_sha`。

**⛔ 本契约明确不做的**：不补 `breakout_nd`、不补 `ma60_slope` / `high_point_falling` / `lower_high`、不改任何阈值。

---

## 6. E. OBS-001 只读复核

**当前处理语义**（`materializeIndicators/index.js:124-132`）：

```js
let chained = null;
try {
  chained = await app.callFunction({ name: 'runDecisionEngine', data: { from: 'materializeIndicators' } });
} catch (e) {
  chained = { error: String(e.message || e) };
}
```

⇒ **只有一个 `error` 字符串**，**无法区分**「调用方等待超时」/「下游真失败」/「下游成功但上游没等到」。

**已查明的机制**（详见 `_v364-gh-probe/OBS-001_INVESTIGATION.md`）：
错误出在**上游容器内 SDK（`@cloudbase/node-sdk ^2.9.0`）的 HTTP/socket 等待阶段**，非业务异常；
**调用已送达并被下游完整执行**（下游有完整 `Init → START → END`）；**冷启动假设已排除**；
唯一显著差异是上游触发源（`TRIGGER_TIMER` vs `TCB_API`）；**触发条件未坐实** ⇒ `ROOT_CAUSE_NOT_PROVEN` 保持。

**V3.6.5 允许**：request correlation、`run_id`、downstream completion status、
timeout-vs-execution distinction、observability。
**⛔ 不得**：改 timeout 参数、retry、`callFunction` 行为、`materializeIndicators` 生产实现。

⚠️ **约束冲突（必须裁定）**：要「区分 timeout 与 execution、加 request correlation」，
**最自然的落点就是 `materializeIndicators`**（它是发起方），但本轮**禁止改它**。
**我的建议**：改为在**下游** `runDecisionEngine` 侧写一条**带 `run_id` 的完成记录**
（进 `run_manifest`）⇒ 「下游是否真的跑了」变成**下游自证的事实**，上游"是否等到"不再是唯一事实源。
这样既拿到可观测性，又**完全不碰 `materializeIndicators`**。

---

## 7. 修改分类：MUST / SHOULD / NOT V3.6.5

### MUST（Gen-1 获得生产权之前必须完成）

| # | 项 | 依赖 |
|---|---|---|
| M-1 | **RunContext required-input gate**（接线 + 补 G-2 的 3 处日期来源） | 需先解除 P-1 / P-2 |
| M-2 | **Run Finality classification**（接线 `classifyRunFinality`） | 低门槛，可直接做 |
| M-3 | **fail-closed publication**（两阶段 + 单指针切换） | 需先解除 P-3（PoC 证据） |
| M-4 | `run_id` / `input_hash` / `as_of_trade_date` 落库 | 依赖 M-1 |
| M-5 | production contract version（31-field 显式记录，方案 ①） | 低门槛 |

### SHOULD（可随 V3.6.5，非阻断）

- S-1 `engine version` metadata 修正（`v3.6.1` → 可追踪 engine build/version；**仅 metadata**）
- S-2 source / package provenance（部署自动留 `source SHA` / `package SHA` / `common SHA`）
- S-3 OBS-001 observability enhancement（按 §6 的「下游自证」路径）
- S-4 ⚠️ **顺带修一个已发现的隐患**：三处云函数清单不一致 ——
  `deploy.sh:20` **10 个**（缺 `runIntegratedShadowEod`）、`prepare-deploy.py:19-24` **11**、`build-cloudfunctions.js:26-31` **11**

### NOT V3.6.5（OUT_OF_SCOPE —— 任何一项做了就是策略变更，必须另立项目）

- ⛔ 恢复 / 部署 `breakout_nd`
- ⛔ 补 `ma60_slope` / `high_point_falling` / `lower_high`
- ⛔ 任何阈值变更：`SlowBreak` / `W5 majority` / `correlation thresholds` / `single ETF cap` / `tech cap`
  / `StageFactor` / `MarketFactor` / `step size`
- ⛔ 启用 Portfolio Mode / 设 `v3_5_portfolio_enabled`
- ⛔ 启用 V3.6.2 / V3.6.3
- ⛔ 提升 Gen-1 Authority / 让 Gen-1 影响 authoritative result / `GUARDED_EFFECTIVE` / authoritative adoption
- ⛔ 改 Gen-2 authority
- ⛔ 自动交易
- ⛔ 修改 `V361 immutable lock` / `V364 frozen lock`·tag / Gen-1 frozen pipeline files

---

## 8. Qualification 设计（先设计，不动生产）

**总闸**：`UNEXPECTED_DECISION_DELTA = 0` —— 正常合法输入下，V3.6.4 CONTROL 与 V3.6.5 candidate 的
`trend_stage` / `final_target` / `final_action` / `binding_constraint` / portfolio result **逐位一致**。

| # | 测试 | 构造方式 | 期望 | 可复用现成地基 |
|---|---|---|---|---|
| **Q1** | Normal-path Parity | 历史真实数据全序列重放，CONTROL vs CANDIDATE | `UNEXPECTED_DECISION_DELTA = 0` | `scripts/lib/v364-replay-harness.js` 的 `replay()` / `loadBars()` / `commonAxis()`（导出 12 符号） |
| **Q2** | Mixed-Date Injection | 人为 4 只 = T 日、1 只 = T-1 日 | **BLOCKED**，不得生成新 ACTIVE | 同上 + `buildV361RunContext` / `validateSameTradeDate` |
| **Q3** | Missing ETF Injection | 人为缺 1 只生产 ETF | **PARTIAL** 且 `publishable = false`；上一笔 ACTIVE 不变 | `classifyRunFinality` |
| **Q4** | Calculation Failure Injection | 单 ETF calculation `throw` | 整 run **不得冒充 COMPLETE** | 需新建注入钩子 |
| **Q5** | Write Failure Injection | 写库在第 N 个对象失败 | **不得出现新的半成品 ACTIVE portfolio** | 参考 `tests/gen2-gate.test.js:39` 的注入写法 |
| **Q6** | Same-Day / Same-Run Retry | 同日重复运行 / 同 run 重试 | trade-date state 不重复推进；不生成重复 active；结果 deterministic | `trade-date-idempotence.js` + `tests/v361-safety-hardening.test.js:121-127` |
| **Q7** | Artifact / Contract Parity | 部署候选对账 | `candidate source == qualified source`；`online package == candidate package`；`input contract version` 明确；**生产 31-field contract 被显式记录** | 部分已有：`build-cloudfunctions.js:127-141` 的跨函数 parity 校验 |

**缺口**：⚠️ 全仓**无 failure-injection 框架**（仅零散注入点）；⚠️ **无独立 idempotence 测试文件**。
⇒ Q4/Q5 需要先建最小注入设施。

---

## 9. Hard Gate（V3.6.5 进入 QUALIFICATION CANDIDATE 的准入）

全部必须 **PASS**，任一不过即 **STOP**：

```
NORMAL_PATH_DECISION_DELTA = 0
MIXED_DATE_BLOCK                = PASS
PARTIAL_RUN_NO_PUBLISH          = PASS
WRITE_FAILURE_NO_PARTIAL_ACTIVE = PASS
SAME_DAY_IDEMPOTENCE            = PASS
RUN_RETRY_IDEMPOTENCE           = PASS
INPUT_CONTRACT_VERSIONED        = PASS
SOURCE_PARITY                   = PASS
```

任何**正常路径** `target` / `action` 出现**无法解释**的差异 ⇒ **STOP**（不得"先过了再说"）。

---

## 10. 与 Gen-1 的关系（确认）

本版本完成前，Gen-1 **可以**：CANARY / SHADOW / read-only qualification。
Gen-1 **不得**：`GUARDED_EFFECTIVE` / authoritative adoption / 改写 production `final_target`·`final_action`。

⇒ V3.6.5 Production Integrity **PASS 并进入生产以后**，才启动
**`WP-G1-PROD` — Gen-1 Production Decision Qualification / Authority Transition**。

（现状支撑：`runDecisionEngine:922-948` 的 Gen-1 overlay 路径已硬断言 `gen1_adopted=false`、
`guardedEffectiveInvocations` **结构性恒为 0** —— 与上述边界一致。）

---

## 11. 风险排序

| 序 | 风险 | 影响 | 现状 |
|---|---|---|---|
| **R-1** | **混合日期 run 无闸门**（G-1/G-2） | 决策基于不同交易日的输入却产出单一结论 | 设计已备，**未接线** |
| **R-2** | **partial publication**（F-3/F-4） | 前台可见「3 新 2 旧」的混合组合且无任何标记 | 设计已备，**未接线** |
| **R-3** | **无原子切换**（C） | 崩溃/超时窗口内可读到半个 run | **无设计落地验证**（P-3） |
| **R-4** | **输入契约无版本**（D） | 32 vs 31 漂移只能人工审计发现 | 三处真相并存、零断言 |
| **R-5** | **OBS-001 观测语义不足**（E） | 无法区分"上游没等到"与"下游真失败" | 机制已查明，观测未改 |
| **R-6** | **部署 provenance 缺失**（D） | 已部署包 SHA 只在人工台账 | `deploy.sh` 零记录 |
| **R-7** | 三处云函数清单不一致（S-4） | 可能漏部署某个函数 | 新发现 |
| **R-8** | `engine_version` 语义错 | 载荷报 `v3.6.1` 而实际是 V3.6.4 | 已登记为预期行为 |

---

## 12. 推荐实施批次

| 批次 | 内容 | 是否碰冻结件 | 前置 |
|---|---|---|---|
| **B0（证据批）** | 解除 P-1~P-4（见 §13）；建 failure-injection 最小设施 | 否 | — |
| **B1** | M-5 契约版本（方案 ①）+ S-1 engine metadata + S-2 provenance + S-4 清单一致 | 否（全在锁外） | B0 |
| **B2** | M-2 finality 接线 + M-4 的 `run_manifest` 落库 | ⚠️ 需解冻 `runDecisionEngine/index.js` | B1 |
| **B3** | M-1 RunContext gate 接线（含 G-2 三处日期来源） | ⚠️ 同上 + 可能需动 `fetchDailyData` / `materializeIndicators` | B2 + 裁定 |
| **B4** | M-3 两阶段发布 + 指针切换 | ⚠️ 同上 | B3 + P-3 证据 |
| **B5** | Q1–Q7 全套 qualification + Hard Gate | — | B4 |

**注意**：B2~B4 **必须解冻 `V364_IMMUTABLE_LOCK` 中的 `runDecisionEngine/index.js`**（以及可能的
`v361-run-context.js` / `v361-run-finality.js` / `market-regime.js`）⇒ 需**显式解冻授权** + 重新封版。

---

## 13. 判定

# `V365_READINESS = BLOCKED_ON_EVIDENCE`

**理由**：核心模块与设计**已就绪**（这是好消息），但有 **4 个必须先拿到「证据 / 裁定」才能开工**的前置项。
在这些未解除之前写代码，会产出**必然要返工**的实现。

### 解除阻塞所需的 4 项证据 / 裁定

| # | 前置 | 需要什么 |
|---|---|---|
| **P-1** | **`as_of_trade_date` 的权威源未定义** | 需裁定：权威「应到交易日」从哪来？候选：① 交易日历表 ② `etf_basic` 的应到日期 ③ `materializeIndicators` 本次实际写入的 `calc_date`（= 取"生产最近一次物化日"而非"5 票最大值"）。**无此，RunContext 的判定语义不闭合。** |
| **P-2** | **3 处输入日期缺失/字段名不匹配**（G-2） | 需提供证据或裁定：`global_signals` 用 `data_date` 是否正确替代 `as_of_date`？`fundamental_state` 的**数据日期**从哪取（`updated_at` 不可用）？`market_env` 的日期补在哪一层（`fetchRealtimeData` / `materializeIndicators` / 还是只读派生）？—— **注意：其中至少一项可能要求改动被禁止修改的 `materializeIndicators`。** |
| **P-3** | **无事务 NoSQL 上的原子切换未验证** | 需 PoC 证据：单文档指针切换 + 「读指针 → 按 `run_id` 查询」两跳，在 CloudBase 上的实际一致性窗口有多大？是否可接受？（不可接受则需换设计。） |
| **P-4** | **OBS-001 可观测性 vs 「不改 `materializeIndicators`」的冲突** | 需裁定：采用我建议的「**下游自证**」路径（在下游写带 `run_id` 的完成记录），还是**放行修改 `materializeIndicators`**？ |

### 可以立即开工的部分（不依赖 P-1~P-4）

- **S-1** engine version metadata（锁外）
- **S-2** 部署 provenance（锁外）
- **S-4** 三处函数清单一致（锁外）
- **M-5** 契约版本记录（采用方案 ①，锁外）
- **B0 的测试设施**：failure-injection 最小注入设施（锁外）

⇒ 若你希望尽快推进，**建议先批准 B0 + B1（全部锁外、零解冻、零策略影响）**，同时并行取 P-1~P-4 的证据。

---

## 附：本报告的取证方式

- **我亲自核实**：`v361-run-context.js` 全文、`v361-run-finality.js` 全文、
  `runDecisionEngine/index.js` 的关键段（`:201-240`、`:925-966`、`:1040-1055`、`:1350-1355`）、
  `computeGlobalSignals` 返回字段、`apiGateway` 的 4 处读取点、`V364`/`GEN1`/`V361` 三把锁的**文件清单**、
  `V364.explicitly_not_included` 原文、`computeSnapshot` 键数（实跑）。
- **只读盘点**（两个 Explore agent，均给出 `file:line`）：方向 1–3 与 4–6 + 测试基础设施。
- ⛔ 全程只读：未改任何 `src/**` / `cloudfunctions/**` / manifest / `param_config`；未部署；未建 PR；未 merge。
- ⚠️ 本文件为**本地未跟踪草稿**（`docs/V365_PRODUCTION_INTEGRITY_READINESS.md`），**未 commit / 未 push / 未 PR**。

---
---

# 14. P1_P2_EVIDENCE_CLOSURE（第二轮 · 只读补充，2026-09-23）

> **本节为追加，不改动上文 §0–§13 的任何历史结论。**
> 本轮范围：**仅 P-1（as_of 权威源）+ P-2（三源日期 provenance）**。⛔ 未改产品代码、未部署、未改参数、未建 PR、未 merge、未接线。

## 14.1 P-1：`AS_OF_AUTHORITY_CANDIDATES`

### 14.1.1 候选权威源全清单（逐条实测）

| # | 候选 | 数据来源 | 存在性 | 语义 | 能否作 expected | 证据 |
|---|---|---|---|---|---|---|
| ① | **A 股交易日历**（含节假日） | 无外部日历数据源、无硬编码表 | ❌ **不存在** | — | ❌ | 全仓 `**/*{calendar,holiday,trading,trade-day}*` **零文件** |
| ② | `isTradingDay()` 近似判断 | `Date.getDay()` + `process.env.HOLIDAYS` | ✅ 存在 | **只排周末** | ❌ 仅"要不要跳过"，**不产出应到日** | `src/common/utils/datasource.js:86-94` |
| ③ | `etf_basic` 应到日期字段 | — | ❌ **不存在** | — | ❌ | **线上实证**：`etf_basic` 5 行字段仅 `code/is_qdii/max_position/name/sector/sort_order/status/target_position` |
| ④ | `indicator_snapshot.calc_date`（物化层本次写入） | `etf_daily` 每票最后一根 bar 的 `trade_date` | ✅ 逐票 | **observed**（数据最新日） | ⚠️ 仅 cross-sectional | `materializeIndicators/index.js:99-107` |
| ⑤ | `etf_daily.trade_date` 最大值 | 上游行情 bar 日期 | ✅ 逐票 | **observed** | ❌ | `runDecisionEngine:517-521` + `db.js:251-256`（无日期约束） |
| ⑥ | `event.expected_trade_date`（调用方传入） | 人工/CI 传参 | ✅ 但**仅 Shadow 链** | **声明值**，非权威源 | ⚠️ 无人自动产生 | `runGen2ShadowEod/index.js:2025`；定时触发下会**降级 REPLAY** |
| ⑦ | `benchmark(510300)` 最新交易日 | `gen2_daily` | ✅ | observed | ❌ | `runGen2ShadowEod:2085-2091, 2113-2116` |
| ⑧ | `ml_shadow_signal.source_trade_date` | `runGen1ShadowEod` 写入 | ✅ | 推理所用日 | ❌ | `runGen1ShadowEod:121,217,266`；`schema.js:575` |
| ⑨ | `portfolio_snapshot.snapshot_date` | `Date.now()+8h` | ✅ | **快照时刻** | ❌ | `runDecisionEngine:1045-1048` |
| ⑩ | `fetch_log` 批次元数据 | — | ❌ **无 `trade_date` 字段** | — | ❌ | `schema.js:409-424`（字段：`source/fetch_time/status/item_count/error/task_name/duration_ms`） |
| ⑪ | **交易日历数据源（外部）** | — | ❌ 不存在 | — | ❌ | 同上 ① |

### 14.1.2 四个候选方案的评估（用户点名的 A/B/C/D）

**Candidate A — `max(snapshot.calc_date)`（当前设计）**
- ✅ 能解决：**cross-sectional consistency**（5 票是否同一天）
- ❌ **不能**解决：**freshness against expected market day**
- ⚠️ **致命盲区（本轮新发现）**：若**5 票全体一致地落后一天**，`max` 仍会得到 T-1，
  且**不齐项为 0 ⇒ `input_health = OK`** ⇒ **全体过期完全无法被发现**。见 §14.3 案例 7。
- 结论：**只能作 `observed_latest_date`，不能作 `expected_trade_date`** ✓（与用户判断一致）

**Candidate B — 交易所/交易日历**
- 仓库现状：**无任何日历数据**（无表、无外部源、无 API）。
- 唯一的 `isTradingDay`（`datasource.js:86-94`）：
  - 只排 **周六/周日**；
  - 节假日靠 `process.env.HOLIDAYS`（逗号分隔字符串）；
  - ⚠️ **线上实测：`fetchDailyData` 的环境变量只有 `DECISION_ENV` 与 `FRED_API_KEY`，`HOLIDAYS` 并未配置**
    ⇒ **节假日完全不被识别**（如国庆 10-01 周四会被当作交易日）。
- 是否需联网：若引入外部日历则**需联网**（且引入新的失败模式）。
- 15:00 / 22:00 / 次日 08:00 的定义：现有代码**没有任何一处**按 wall-clock 推导"应到日"；
  22:00 与 08:00 都只是"跑或不跑"的开关（`fetchDailyData` 有闸门，`materializeIndicators` **连闸门都没有**）。
- 结论：**当前不可用**；若采用必须新增数据源 + 明确 15:00/22:00/08:00 三套时点语义。

**Candidate C — 上游 `fetchDailyData` 成功批次的 `trade_date`**
- **线上实测**：`fetchDailyData` 内部确有 `today = beijingDateStr(beijingNow())`，但它只用于
  ① 节假日闸门 ② 幂等判定 ③ 当日 bar 的 `is_final` 标记；**不落库为批次元数据**。
- 落库的 `etf_daily.trade_date` 来自**每根 bar 自身**（`fetchDailyData:100-104`）⇒ **逐票独立**。
- **无 batch/run metadata 对象**；`fetch_log` 也无 `trade_date`。
- 单票失败时：**逐票 try/catch 跳过并继续**（`:223-229`），**整批不失败** ⇒ 该日期**不可靠**。
- 22:00 与次日 08:00 能否复用同一 expected：**不能**——22:00 抓的是当日（T）收盘，
  08:00 run 读的还是同一批数据（T），但 wall-clock 已是 T+1。
- 结论：**当前不具备**，但**最接近可改造**：只需让批次把 `today` 作为**单值**落库（如 `run_manifest`）。

**Candidate D — 数据集合里的最近完整交易日**
- 形态：`daily_quote`/`etf_daily` 中「5/5 codes 同一 trade_date」的最晚者。
- 定性：**derived observation，不是 authority**。它由数据反推，数据本身来自上游 ⇒ 循环依赖。
- ⚠️ **不要混淆**：它与 Candidate A 是同一类（都是 observed），只是聚合口径不同。
- 结论：**不能作 authority**。

### 14.1.3 `RECOMMENDED_EXPECTED_TRADE_DATE_AUTHORITY`

**结论：`P1_REMAINS_BLOCKED` —— 仓库当前不存在任何权威源。**

但给出**唯一可行的落点**（供裁定，不自行采用）：

> **建议方向：让「物化批次」成为唯一的 `expected_trade_date` 产生者**
> 即 `materializeIndicators`（或 `fetchDailyData`）在一次运行中**确定一个单值 `today`**，
> 连同 `run_id` 一起落库到 `run_manifest`；后续 `runDecisionEngine` 以该值为 `expected_trade_date`。
>
> **理由**：这是**唯一不需要引入新外部数据源**的方案（不需要联网日历、不需要 `HOLIDAYS`），
> 且它把"应到日"的定义权收拢到**上游数据生产者**手中 —— 语义上正是"这批数据的应到日"。
>
> **但它有两个必须同时解决的缺口**：
> 1. ⚠️ **`materializeIndicators` 当前**（线上实测）**没有任何交易日闸门** —— 08:00 定时在周末/节假日**照样会跑**，
>    若它成为权威源，则"应到日"在节假日会被错误地设为非交易日的 wall-clock 日期 ⇒ **必须补闸门**；
> 2. ⚠️ 该方案**要求改动 `materializeIndicators`**，而 V3.6.5 本轮**明令禁止改它**
>    ⇒ 这是一个**授权层面**的前置，不是技术层面的。
>
> **替代保守方案（不改 `materializeIndicators`）**：在 `runDecisionEngine` 内部用
> 「**最近一次 `indicator_snapshot` 物化日的众数 + 跨票齐备性**」作 expected ⇒
> 但这**仍属 observed**，无法解决案例 7（全体过期）⇒ **不推荐**。

⇒ **无论选哪条，都需要你裁定；我不自行发明交易日** ✓（遵守用户的 `P1_REMAINS_BLOCKED` 要求）

### 14.1.4 三个语义必须分开命名（建议目标语义）

| 语义 | 定义 | 当前载体 | 是否可得 |
|---|---|---|---|
| `expected_trade_date` | **外部/上游权威**决定「应该是哪一天」 | **无** | ❌ **缺失**（`P1_REMAINS_BLOCKED`） |
| `observed_latest_date` | 实际数据中最新是哪一天 | `max(indicator_snapshot.calc_date)` | ✅ 可得（逐票 `calc_date`） |
| `effective_as_of_trade_date` | **仅当** required inputs 与 `expected_trade_date` 对齐时才成立 | 无 | ❌ 依赖前两者 |

## 14.2 真实日期案例（7 例）

> 基线：今日 = **2026-09-23（周三）**；**线上实测**：`fetchDailyData` 唯一 timer = `dailyFetch-2200`
> `0 0 22 * * 1-5 *`；`materializeIndicators` 唯一 timer = `dailyPipeline-0800` `0 0 8 * * 1-5 *`。
> ⚠️ 注意 `materializeIndicators` **无交易日闸门** ⇒ 周末/节假日仍会被 timer 唤醒。

| # | 场景 | wall_clock | observed_latest_date | expected_trade_date | should_block? |
|---|---|---|---|---|---|
| 1 | 正常交易日 22:00 | 2026-09-22 22:00 | 2026-09-22 | **未定义**（无权威源） | ❓ **无法判定** |
| 2 | 次日 08:00 | 2026-09-23 08:00 | 2026-09-22（数据未更新） | **未定义**；若按 wall-clock 误推为 09-23 则**假 BLOCK** | ❓ 无法判定 |
| 3 | **周六** | 2026-09-26 08:00 | 2026-09-25（周五） | **未定义** | ❓ 但 `materializeIndicators` **仍会跑**（无闸门） |
| 4 | **周日** | 2026-09-27 08:00 | 2026-09-25 | **未定义** | ❓ 同上 |
| 5 | **法定节假日后第一天** | 2026-10-08（国庆后） | 2026-09-30 | **未定义**；且 `HOLIDAYS` **线上未配置** ⇒ 10-01~10-07 会被判为交易日 | ❓ **且闸门失效** |
| 6 | 某一只 ETF 缺数据 | 任一交易日 08:00 | 该票 T-1、其余 T | **未定义** | 应 BLOCK（设计态 `strict_same_trade_date` 可拦） |
| 7 | **5 只全部落后一天** | 任一交易日 08:00 | **全体 T-1** | **未定义** | ⚠️ **设计态也拦不住**：5 票一致 ⇒ `max` = T-1、不齐项 = 0 ⇒ **`input_health = OK`** |

**案例 7 是本轮最重要的发现**：`max(calc_date)` 方案**对"全体一致过期"完全无感**。
只有引入独立的 `expected_trade_date` 才能发现它 —— 这正是 P-1 不能关闭的根本原因。

## 14.3 P-2：三源 provenance 结论

### 14.3.1 `global_signals` → **`P2_GLOBAL_SIGNAL = OPEN`**

| 项 | 事实 | 证据 |
|---|---|---|
| 写入者 | 唯一 = `fetchDailyData`（**线上实测**其 5g 段） | `fetchDailyData/index.js` 5g 段 |
| `trade_date` 来源 | ⚠️ **`fetchGlobalDaily` 硬编码为「抓取时刻的北京时间当天」** | `datasource.js:343-345`（**我亲自核实**） |
| 数据本质 | 抓的是腾讯 `qt.gtimg.cn` **实时快照**（单条），**不是日线** | `datasource.js:325-353` |
| `data_date` 消费 | `runDecisionEngine:204-230` 逐 symbol 取 `last.trade_date` | 同上 |
| 各 symbol 是否可能不同日 | **可以**（逐 symbol 独立取最后一条；且 `GLOBAL_TICKERS` 循环**无 per-ticker try/catch**） | `fetchDailyData` 5g 段 |
| 线上实证 | 4 个 symbol（usMU/usEWY/usNDX/usXBI）**当前 trade_date 完全一致**（每个日期各 4 条），最近为 `2026-09-23` | 只读查 `global_quote`（128 行） |
| 跨时区 | ⚠️ **无任何处理**；把北京当天当作美股交易日 | `datasource.js:86-94` 只认中国周末 |
| 是否落库 / 进返回体 | ⚠️ **两者都没有**（`portfolio_snapshot` 未拷 `global_signals`；run 返回体也无） | `runDecisionEngine:1124-1178`、`:1353-1373` |
| **Adapter 能否解** | ❌ **只能改名**（`data_date → as_of_date`），**改不了语义** | — |
| **Producer 是否要改** | ✅ **必须**：应写入该 symbol 的真实市场交易日（腾讯快照自带时间戳 `f[30]/f[31]` 未被使用） | `datasource.js:334-353` |

### 14.3.2 `fundamental_state` → **`P2_FUNDAMENTAL = OPEN`**

| 项 | 事实 | 证据 |
|---|---|---|
| 写入者 | 唯一 = `runDecisionEngine`，字段 `{code, f_state, f_score, detail, updated_at}` | `:954-957` |
| `detail` 有无日期 | ❌ **完全没有**（`final_signal/total_layer_weight/positive/negative/layer_breakdown`） | `:175-184` |
| **数据日期实际在** | ✅ `fundamental_series.data_date`（**线上实证**：`leading_revenue` / `dram_price` / `nand_price` / `approval_export`，最新 `2026-09-23`） | 只读查 `fundamental_series`（326 行）；`schema.js:138-156` |
| ⚠️ 上游日期**语义混合** | SEC 硬数据用 `period_end`，**无则回退北京今天**；周度定性用 `week`；存储价**直接北京今天**；美元指数/GLD 用外部 `date` **否则回退北京今天** | `extractFundamental:203-208`；`fetchDailyData` 5/5b/5c/5d 段 |
| `updated_at` 可用否 | ❌ **不可用**（是写入/计算时刻） | `:956` |
| `max` vs `oldest critical` | 两者语义不同：`max` = 「最新证据够不够新」；`oldest critical` = 「驱动该状态的最旧关键输入」⇒ **需裁定**；policy 现为单值 `max_staleness_days: 120` | `v361-run-context.js:49-52` |
| Adapter | ⚠️ **半个**：调用侧需**重放 `pickLatestSeries`** 才能取到 `data_date`（复制了 pipeline 逻辑） | `fundamental.js:246-255` |
| Producer 是否要改 | ✅ **建议**：在 `:954-957` 补 `fundamental_as_of` | — |

### 14.3.3 `market_env` → **`P2_MARKET_ENV = CLOSED`**

| 项 | 事实 | 证据 |
|---|---|---|
| 写入者 | 唯一 = `fetchDailyData` 5e 段 | `:371-388` |
| 日期字段 | ✅ **行级 `trade_date`** + ✅ **`weekly_bars[].date`**（**我亲自核实**） | `:380`；`datasource.js:316` |
| ⚠️ 编造回退 | **存在**：`trade_date: latest.date \|\| beijingDateStr(beijingNow())` | `:380` |
| 消费端 | `deriveMarketEnvironmentForPortfolio` **只读 `weekly_bars`，从不读 `trade_date`** | `market-env-v3.js:22-28` |
| `detectWState` 依赖日期吗 | ❌ **完全不依赖**（只用 `close/high/low`） | `indicators.js:416-474` |
| 线上实证 | 沪深300：`trade_date = 2026-09-23`，`weekly_bars` 最后一根 `date = 2026-09-23`（**当周未走完的 partial bar**），上一根 `2026-09-18` | 只读查 `market_env`（3 行） |
| 能否推出 as_of | ✅ **能**：`weekly_bars[last].date`（优先）或行级 `trade_date` | — |
| 「latest weekly bar」vs「underlying daily」 | 语义差最多 ~4 个交易日；`market_env` 是**周线源** ⇒ 正确取 **latest weekly bar date** | `v361-run-context.js:41-44` |
| `max_staleness_trade_days=5` 可算否 | ✅ **可算**；⚠️ 但 `v361-run-context.js:64-70` 的 `daysBetween` 是**自然日**却当 `trade_days` 用（**单位不符**） | `:151-153` |
| Adapter 能否解 | ✅ **能**，纯调用侧，**无需改 producer** | — |
| Producer 是否要改 | ❌ **非必须**（建议清掉 `:380` 的编造回退并排序 `bars`） | — |

### 14.3.4 汇总矩阵

| Source | 当前真实日期字段 | 日期语义 | 可直接用？ | Adapter 可解？ | Producer 要改？ |
|---|---|---|---|---|---|
| **etf snapshot** | `indicator_snapshot.calc_date` | indicator trade date | ✅ 可得 | — | — |
| **global signal** | `global_quote.trade_date` → `data_date` | ⚠️ **抓取运行的北京自然日**（artifact 日，**非市场交易日**） | ❌ **语义错** | ⚠️ 仅能改名 | ✅ **必须** |
| **fundamental** | 源头在 `fundamental_series.data_date`（**多源混合语义**） | 财报期末 / 周 / 外部日 / **北京今天** 混用 | ❌ 字段缺失 | ⚠️ 需重放 pipeline | ✅ 建议 |
| **market_env** | `market_env.trade_date` / `weekly_bars[].date` | ✅ 周线「该周最后交易日」 | ✅ 可取 | ✅ **可解** | ❌ 非必须 |

### 14.3.5 逐源判定

```
P2_GLOBAL_SIGNAL = OPEN     （日期语义错位，属 producer 问题；adapter 仅能改名）
P2_FUNDAMENTAL    = OPEN     （字段缺失 + max/oldest-critical 需裁定 + adapter 需重放 pipeline）
P2_MARKET_ENV     = CLOSED   （日期确实存在且可取；纯调用侧 adapter；无需改 producer）
```

⇒ **`P2 = PARTIAL`（1/3 CLOSED）**

## 14.4 本轮新增的线上实测事实（此前未确证）

| 事实 | 值 | 备注 |
|---|---|---|
| **`fetchDailyData` 线上 timer** | **仅 1 个**：`dailyFetch-2200` = `0 0 22 * * 1-5 *` | ⚠️ **示例配置里的 `dailyFetch-1530`（15:30）线上并不存在** |
| `materializeIndicators` 线上 timer | `dailyPipeline-0800` = `0 0 8 * * 1-5 *` | ✓ |
| `fetchDailyData` 线上环境变量 | 只有 `DECISION_ENV` + `FRED_API_KEY` | ⚠️ **`HOLIDAYS` 未配置 ⇒ 节假日闸门失效** |
| `market_env` 线上行数 | **3**（000300 / 000688 / 399006） | ✓ 与既有记录一致 |
| `global_quote` 线上行数 | **128**，4 个 symbol | trade_date 各日期齐整（每日期 4 条） |
| `fundamental_series` 线上行数 | **326**，含 `data_date` 字段 | ✓ 数据日期确实存在 |
| `etf_basic` 线上字段 | `code/is_qdii/max_position/name/sector/sort_order/status/target_position` | ⚠️ **无任何日期字段** |

## 14.5 更新后的 Readiness 判定

| 项 | 本轮前 | 本轮后 | 依据 |
|---|---|---|---|
| **P-1** | OPEN | **`OPEN`（`P1_REMAINS_BLOCKED`）** | 仓库确无权威源；且发现 `max` 方案对"全体过期"无感（案例 7） |
| **P-2** | OPEN | **`PARTIAL`** | 1/3 CLOSED（market_env）；2/3 OPEN（global_signal 需改 producer；fundamental 字段缺失） |
| **P-3** | OPEN | **`OPEN`**（本轮未涉及） | — |
| **P-4** | OPEN | **`OPEN`**（本轮未涉及） | — |

# `V365_READINESS = BLOCKED_ON_EVIDENCE`（维持）

**判定理由**：P-1 **未关闭**，且它的阻塞性质**不是"再搜一搜就能解决"**，而是
**"仓库里确实不存在，必须由人裁定引入什么"**；P-2 仅 1/3 关闭，另外两源**都需要改 producer**（其中 global_signal 是硬性）。

## 14.6 下一步推荐

> 用户的规则是「若 P-1/P-2 都关闭 ⇒ 下一步变 P-3 Atomic Publish PoC」。
> **由于 P-1 未关闭，下一步不是 P-3。**

**建议的下一步（按优先级）**：

1. **P-1-a（需你裁定，零成本）**：从 §14.1.3 的两个方案中选一个
   - **方案甲**：让物化批次成为权威（**需授权改 `materializeIndicators`** + 给它补交易日闸门）
   - **方案乙**：维持 observed 方案（**不推荐**，案例 7 盲区无法解决）
   - （可另加方案丙：**引入外部交易日历** —— 需联网 + 新增失败模式，我不推荐）
2. **P-2-a（需你裁定，低成本）**：
   - `global_signals`：是否**授权改 `datasource.fetchGlobalDaily`**，用腾讯快照自带时间戳写真市场交易日？
   - `fundamental`：`fundamental_as_of` 取 **`max(源数据日期)`** 还是 **`oldest critical source date`**？
3. **P-2-b（无需裁定，可做）**：`market_env` 的 adapter 方案已明确（读 `weekly_bars[last].date`），
   但**接线本身属于 B3 范畴**，本轮不碰。
4. ⛔ **不建议**在 P-1 关闭前进入 P-3。

## 14.7 本轮边界履行

⛔ 未改生产代码、未部署、未改参数、未建 PR、未 merge、未接线 RunContext/RunFinality；
⛔ 未用 `new Date()` 伪造输入日期、未把 `updated_at` 当市场数据日、未改 freshness 阈值、未恢复 `breakout_nd`。
✅ 唯一写入：本节追加到 `docs/V365_PRODUCTION_INTEGRITY_READINESS.md`（**未跟踪草稿**）。

---

# 15. WP-V365-P12 — P-1 / P-2 Implementation Closure

> 本节为**追加**，不改动上文 §0–§14 的任何历史结论。
> 上文 §14 的判定 `V365_READINESS = BLOCKED_ON_EVIDENCE` 在其结论时点仍然正确；
> 本节记录的是**在该判定之后**进行的 P-1/P-2 实现轮（用户授权在独立开发分支改代码与测试）。

## 15.0 本轮定位

把 P-1 / P-2 从 **evidence problem** 变成 **可验证的 implementation candidate**。
本轮**不接线生产**、不部署、不改参数、不建 PR、不 merge、不动任何冻结锁与 tag。

改动位于独立开发分支 `feat/v365-p12-provenance`（基于 `origin/master e93f3968`）。

## 15.1 P-1 实现（Expected Trade Date Authority）

| 交付物 | 作用 |
|---|---|
| `src/common/utils/cn-trading-calendar.js` | 纯函数权威源：`resolveExpectedTradeDate(now, calendar, cutoff)`、`isTradingDay`、`prevTradingDay`、`nextTradingDay`、`countTradeDays`、`loadCalendar` |
| `src/common/data/cn-trading-calendar.json` | **repo-versioned** 日历 artifact（V3.6.5 未播种状态，`coverage.seeded=false`） |
| `src/common/data/cn-trading-calendar.manifest.json` | 记录 `source / method / calendar_version / coverage / artifact_sha256` |
| `scripts/gen-cn-trading-calendar.js` | 生成器：**必须**由权威来源文件（`--source-file`）生成；artifact 内**不写**生成时刻（保证可复现）；`--check` 可逐字节复核 |
| `tests/v365-p1-trade-date-authority.test.js` | 22 项测试（含任务书 §七 的 8 项 failure test） |

**三日期语义分离**（`v361-run-context.js`，**additive** 扩展）：

| 字段 | 语义 | 来源 |
|---|---|---|
| `expected_trade_date` | 权威应到交易日 | CN 交易日历 + 北京 cutoff（**由调用方传入，本文件不自行推断**） |
| `observed_latest_date` | required 快照 calc_date 实际最大值 | 旧 `max(calc_date)` 行为**逐字保留**（`as_of_trade_date` 仍为该值，向后兼容） |
| `effective_as_of_trade_date` | 仅当 required 全部 == expected 时成立 | 对齐判定结果，否则 `null` |

**对齐分类** `DATE_ALIGNMENT_CASE`：

| CASE | 条件 | 结果 |
|---|---|---|
| `CASE_A_ALL_EXPECTED` | 5/5 == expected | 健康 |
| `CASE_B_PARTIAL_STALE` | 部分 == expected、部分更旧 | **BLOCKED** |
| `CASE_C_ALL_STALE` | 全部**一致地**更旧 | **BLOCKED**（旧 `max` 方案完全看不见的一类） |
| `CASE_UNKNOWN_NO_EXPECTED` | 未传 expected | 不做判定（保持旧行为） |

**cutoff 语义**（默认 `16:00` 北京时间，可配置）：

| 场景 | expected_trade_date | resolution_reason |
|---|---|---|
| 交易日 + 已过 cutoff（22:00 场景） | **当日** | `TRADING_DAY_AFTER_CUTOFF` |
| 交易日 + 未过 cutoff（08:00 场景） | **上一完成交易日** | `TRADING_DAY_BEFORE_CUTOFF` |
| 周末 / 节假日 | **上一完成交易日** | `NON_TRADING_DAY` |
| coverage 缺失 / 越界 / 回溯耗尽 | **`null` + BLOCKED** | `CALENDAR_COVERAGE_MISSING` / `_OUT_OF_RANGE` / `_EXHAUSTED` |

## 15.2 P-2 实现（三源日期 provenance）

| 源 | 交付物 | 关键设计 |
|---|---|---|
| `global_signals` | `src/common/utils/global-signal-provenance.js` + `datasource.js::fetchGlobalDaily` **additive** 增补 | 按**形态**扫描 provider 分片解析时间戳（不依赖固定下标）→ `source_timestamp` / `source_market_date` / `date_origin`；⛔ 解析不到即 `null` + `UNKNOWN`，**绝不**回退北京今天；`source_timezone = PROVIDER_LOCAL_UNVERIFIED`（不凭常识假设时区） |
| `fundamental` | `src/common/utils/fundamental-provenance.js` | **复用** `fundamental.js::pickLatestSeries`（与评分器同一条选择逻辑）⇒ 贡献行与评分器选中行逐位一致；`data_date` 严格来自 `fundamental_series.data_date`；`fundamental_as_of_date = oldest_contributing_date`；按频率逐指标判 freshness；optional 源，`blocks_run=false` |
| `market_env` | `src/common/utils/market-env-provenance.js` | 由 `weekly_bars[].date`（或行级 `trade_date` 兜底）推导 `market_env_as_of_date`；显式标记 `market_env_partial_week`；`trade_day_lag` **必须**走 calendar，无 calendar 时 `null` + `lag_basis=UNAVAILABLE`；自然日差仅作 `natural_day_lag_diagnostic` 并标注 `usable_for_policy=false` |

**legacy 口径保持**：`fetchGlobalDaily` 的 `trade_date`（= 抓取时刻北京自然日）**逐字不变**；本模块只做 additive provenance，⛔ 不改写、不迁移、不批量改历史数据。

## 15.3 P-1 / P-2 Test Matrix

**P-1（`tests/v365-p1-trade-date-authority.test.js`，22/22 PASS）**

| # | 测试 | 结果 |
|---|---|---|
| A.1–A.8 | 日历自洽 / 交易日导航 / 交易日差≠自然日差 / cutoff / 北京墙钟 / special 优先 / 非法 calendar / 非法 now | PASS |
| B.1–B.4 | 三日期并存且互不顶替 / 未传 expected 保持旧行为 / authority 元数据回显 / 独立校验入口 | PASS |
| **C.1** | **5/5 expected → PASS** | PASS |
| **C.2** | **4/5 expected + 1 stale → BLOCKED** | PASS |
| **C.3** | **5/5 全体一致 stale → BLOCKED**（并断言 cross-sectional 判据此时 `stale_sources=0`） | PASS |
| **C.4** | **周六 08:00 → expected = 周五** | PASS |
| **C.5** | **法定节假日 → expected = 节前最后交易日** | PASS |
| **C.6** | **节后第一交易日 08:00 → expected = 节前最后交易日** | PASS |
| **C.7** | **节后第一交易日收盘后 → expected = 当日**（并覆盖 15:00 边界 = 仍 before cutoff） | PASS |
| **C.8** | **coverage 缺失 → BLOCKED**（+越界 +回溯耗尽三种） | PASS |
| C.9–C.10 | 端到端 authority→RunContext 全链 / input_hash 纳入 expected | PASS |

**P-2（`tests/v365-p2-provenance.test.js`，22/22 PASS）**

| 组 | 覆盖 |
|---|---|
| §A global（7） | 多形态时间戳解析 / 非法日期拒绝 / 有-无 timestamp 两态 / **freshness 不回退 legacy trade_date** / adapter 映射 / 静态接入断言 / 可选真实集成 |
| §B fundamental（9） | **贡献行与评分器逐位一致** / 硬格取评分器选中行而非 max(data_date) / 日期来自 `row.data_date` 非 `updated_at` / oldest-latest / 零副作用 / 返回体不含决策字段 / 频率化 freshness / optional 不 BLOCK / zero-weight 口径一致 |
| §C market_env（6） | weekly bar 推导 / partial week 显式标记 / **trade-day lag ≠ 自然日差** / 无 calendar ⇒ null / 行级兜底 / optional 不 BLOCK |

## 15.4 Normal-path Parity（`UNEXPECTED_DECISION_DELTA = 0`）

脚本：`scripts/v365-p12-decision-parity.js`（改动清单由调用方以文件传入 —— 沙箱禁止 Node 子进程）

| 证据 | 结果 |
|---|---|
| 改动文件 ∩ 回放依赖集（`require.cache` 实测） | **交集 = `[]`** |
| `v361-run-context.js` 在生产 `cloudfunctions/` 的 require 数 | **0**（未接线 ⇒ 生产决策路径不经过它） |
| 决策核心 12 文件零改动 | **PASS** |
| `replay()` 同区间连跑两次决策序列 | sha256 **两次一致** |
| **parity 锚点** | `25ccbfc7e1b73a9a173ec36c17512c6228a2fe42685dcd291bc055ea4ed11723` |

**逻辑**：决策路径代码逐字节未变（结构性） + 回放可确定性复现（实测）⇒ 同一输入下 V3.6.4 与 V3.6.5 candidate 决策输出必然逐位一致。

## 15.5 完成条件对照（任务书 §十）

| 条件 | 结果 |
|---|---|
| `P1_EXPECTED_DATE_AUTHORITY` | **PASS** |
| `ALL_STALE_CASE_BLOCKED` | **PASS** |
| `P2_GLOBAL_PROVENANCE` | **PASS** |
| `P2_FUNDAMENTAL_PROVENANCE` | **PASS** |
| `P2_MARKET_ENV_PROVENANCE` | **PASS** |
| `NORMAL_PATH_DECISION_DELTA` | **0** |
| P-1 / P-2 状态 | **CLOSED**（附 15.7 的 data 前置） |

## 15.6 回归与门禁状态

| 门禁 | 结果 |
|---|---|
| Node 单测（本分支） | **50 passed / 3 failed** |
| Node 单测（`origin/master` 对照，worktree 实测） | **48 passed / 3 failed** |
| 失败集合 | **两侧完全相同**（`gen1-parity` / `gen1-ge03-regression-guard` / `gen2-scenario-parity`）⇒ **零新增失败** |
| 3 项既有失败根因 | 环境相关：`gen1-parity` 需 python `gen1_frozen_inference`；另两项断言 `actual:null expected:0`（依赖前置生成物） |
| `verify-immutable.js` | **23/23 PASS** |
| `verify-gen1-pipeline.js` | **10/10 PASS** |
| `verify-gen2-build-artifacts.js` | **7/7 PASS** |

⇒ 改动 `v361-run-context.js`（V364 锁内文件）**未触发任何现有不可变校验失败**
（`V364_IMMUTABLE_LOCK.json` 只被其**生成器**引用，仓库内没有校验器消费其 `files` 哈希）。

## 15.7 ⚠️ 必须显式披露的前置：生产日历是**未播种**状态

生产 artifact `src/common/data/cn-trading-calendar.json` 当前 `coverage.seeded = false`
⇒ `resolveExpectedTradeDate()` 在生产上会返回 **`BLOCKED / CALENDAR_COVERAGE_MISSING`**。

这**不是缺陷，是设计**（fail-closed）：⛔ 未注入权威节假日来源时**宁可 BLOCK 也不猜**。
但它构成一个**必须先解决的 data 前置**：

> **`P1_PRODUCTION_CALENDAR_SEEDING = BLOCKED_ON_DATA`**
> 必须由人提供权威来源（交易所/国务院公布的休市安排）→ 用
> `scripts/gen-cn-trading-calendar.js --source-file <权威来源> --calendar-version <ver>
>  --coverage-start <d> --coverage-end <d>` 生成并记录新 artifact SHA。
> ⛔ 我**不会**代猜节假日；测试中使用的 `tests/fixtures/cn-trading-calendar.fixture.json`
> 已标记 `synthetic: true`，**不得**用于生产。

推论：**在 calendar 完成播种之前，不得把 `expected_trade_date` 接入生产阻断链**，
否则会因 coverage 缺失而恒判 BLOCKED（假阳性）。

## 15.8 Readiness 新判定

| 项 | 状态 |
|---|---|
| **P-1** | **`CLOSED`**（机制 + 测试就绪；生产播种另见 15.7） |
| **P-2** | **`CLOSED`**（三源全部 PASS） |
| **P-3** | `OPEN`（本轮未进入） |
| **P-4** | `OPEN`（本轮未进入） |
| `P1_PRODUCTION_CALENDAR_SEEDING` | **`BLOCKED_ON_DATA`**（需注入权威节假日来源） |

# `V365_READINESS = BLOCKED_ON_POC`

**下一步**：`P-3 Atomic Publish PoC`（按任务书 §十，P-1/P-2 关闭后转入 P-3，而非直接实施生产代码）。

## 15.9 本轮边界履行

⛔ 未部署、未改生产参数、未建 PR、未 merge、未动 `v3.6.4-frozen` tag、未改任何 immutable lock 文件；
⛔ 未恢复 `breakout_nd`、未改 `materializeIndicators` 的 indicator contract、未补 `ma60_slope` /
`high_point_falling` / `lower_high`、未改 SlowBreak 阈值、未启用 Portfolio Mode、未改 Market Regime 口径、
未改 W5 / correlation / cap / StageFactor / MarketFactor / step size、未启用 V3.6.2/6.3、未提升 Gen-1 Authority；
⛔ 未接入 Two-stage Publish、未实施 P-3、未改动 `cloudfunctions/runDecisionEngine/index.js`；
⛔ 未用 `new Date()` 兜底市场日期、未把 `updated_at` 当数据日期、未把自然日差当交易日差。

---

# 16. WP-V365-P1A — Trading Calendar Authority Seal

> 本节为追加，不改动上文 §0–§15 的任何历史结论。
> 承接 §15.7 的 `P1_PRODUCTION_CALENDAR_SEEDING = BLOCKED_ON_DATA`：本节即该 data 前置的**闭合**。

## 16.1 Authority（任务书 §1）

| 项 | 值 |
|---|---|
| 权威来源 | 上证所《关于上海证券交易所2026年部分节假日休市安排的通知》**上证公告〔2025〕45号**（2025-12-22）<br>深交所《关于2026年部分节假日休市安排的通知》**深证会〔2025〕481号**（2025-12-22） |
| 来源 URL | `https://www.sse.com.cn/disclosure/announcement/general/c/c_20251222_10802507.shtml`<br>`https://www.szse.cn/www/disclosure/notice/general/t20251222_618087.html` |
| 复核公告 | 上证公告〔2026〕22号（2026-09-17，中秋/国庆复述确认）、深交所同名通知（2026-09-17） |
| 判定规则 | `CN trading day = Monday–Friday AND NOT official exchange closure` |
| 冲突策略 | SSE / SZSE 不一致 ⇒ `CALENDAR_CONFLICT` ⇒ **BLOCKED**（生成器拒绝产出，不选边） |

⛔ 未使用：普通日历网站 / 第三方财经网站 / 政府调休工作日推导 / `HOLIDAYS` 环境变量 / runtime 网络 API / max(snapshot date)。

## 16.2 Production artifact（任务书 §2）

| 文件 | 说明 |
|---|---|
| `src/common/data/sources/cn-trading-calendar.source.v1.json` | 官方来源文件（逐条记录两个 authority 的休市区间 + 公告标识/日期/URL + `authority_policy`） |
| `src/common/data/cn-trading-calendar.v1.json` | **封版 artifact**，`seeded=true` / `synthetic=false` / `market=CN_A_SHARE` |
| `src/common/data/cn-trading-calendar.v1.manifest.json` | manifest（含任务书 §2 要求的全部字段） |

- `calendar_version = cn-a-share-2026.1`，`coverage = 2026-01-01 … 2026-12-31`
- **artifact SHA256** = `5edb6d4a0a9d7361d2794399a64f5882a7970a14ce4581aae05addb3c6eef786`
- **deterministic**：artifact 与 manifest **均不含生成时间戳**；`--check` 实测两者 **BYTE-IDENTICAL**
- `holidays`（**工作日**休市）= 19 天；`weekend_closures`（公告点明的周末休市）= 20 天；`special_trading_days` = 0

## 16.3 P-1A Test Matrix（`tests/v365-p1a-calendar-authority.test.js`，25/25 PASS）

| 组 | 覆盖 |
|---|---|
| §A（7） | seeded/synthetic / 来源可追溯（公告号+日期+机构域名）/ coverage 固化 / **manifest SHA == 实测文件 SHA** / 无非确定性字段 / **SSE_SZSE_CONSISTENCY（独立展开两所区间后逐一比对）** / 每个休市区间复市日必开市 |
| §B（6） | 任务书 §3 的 2026 特别用例：**09-23 OPEN / 09-24 OPEN**、**09-25~09-27 CLOSED / 09-28 OPEN**、**10-01~10-07 逐日 CLOSED**、**10-08 OPEN / 10-10 CLOSED**，加 holidays 与 weekend_closures 不混放、全年逐日自检（工作日 261 / 休市 19） |
| §C（5） | **保留既有回归**：周六/周日、节后第一日 08:00 → 09-30、节后第一日收盘后 → 10-08、coverage missing、coverage exhausted |
| §D（5） | **到期与越界 fail-closed**：OK / WARNING（≤30 天，边界 30 与 31 都测）/ EXPIRED ⇒ `CALENDAR_OUT_OF_RANGE` / 早于 start 同样 BLOCKED / `FAIL_CLOSED_CODE` 覆盖全部原因 |
| §E（2） | 官方日历接入 RunContext：09-23 22:00 → `CASE_A_ALL_EXPECTED`；09-25 全天 `NON_TRADING_DAY` |

## 16.4 Calendar expiry（任务书 §4）

- `calendar_expiry_warning_days = 30`；`calendarExpiryStatus()` 返回 `OK / WARNING / EXPIRED / UNKNOWN`
- `auto_update` **恒为 `false`** —— ⛔ 只告警，**不自动联网更新**
- 超出 coverage ⇒ `resolveExpectedTradeDate` 返回 `fail_closed_code = CALENDAR_OUT_OF_RANGE` 且 `expected_trade_date = null`
  ⇒ **⛔ 不回退为 weekday-only**（正向越界与早于 start 都实测 BLOCKED）

## 16.5 P-1A Gate（任务书 §5）

| 判定 | 结果 |
|---|---|
| `CALENDAR_SEEDED = true` | **PASS** |
| `CALENDAR_SYNTHETIC = false` | **PASS** |
| `OFFICIAL_SOURCE_TRACEABLE = PASS` | **PASS** |
| `SSE_SZSE_CONSISTENCY = PASS` | **PASS** |
| `DETERMINISTIC_REGEN = PASS` | **PASS** |
| `ARTIFACT_SHA_STABLE = PASS` | **PASS** |
| `HOLIDAY_CASES = PASS` | **PASS** |
| `OUT_OF_RANGE_FAIL_CLOSED = PASS` | **PASS** |

⇒ **`P1_PRODUCTION_AUTHORITY_ARTIFACT = CLOSED`**（脚本 `scripts/v365-p1a-calendar-gate.js`，8/8）

---

# 17. WP-V365-P3 — Atomic Publish PoC

> **PoC only**：⛔ 未接入生产 `runDecisionEngine`、⛔ 未创建任何生产 collection、⛔ 未部署。

## 17.1 当前失败模式（任务书 §6，只读证据）

当前生产写入时序（`cloudfunctions/runDecisionEngine/index.js`）：

```
read inputs
 → ETF1 calculate → upsert decision_result / fundamental_state / portfolio_position
 → ETF2 … → ETF3 … → ETF4 … → ETF5 …        （逐票循环，单票 catch 后 continue）
 → write portfolio_snapshot                   （循环之后单次写）
 → upsert runtime_status
 → return { ok: true }
```

**可能产生 partial state 的位置**：
1. **第 N 票抛错** ⇒ 前 N-1 票已落库、后 5-N+1 票保持旧值 ⇒ 前台读到「N-1 新 + 其余旧」的混合组合；
2. **循环后 `portfolio_snapshot` 写失败** ⇒ 5 票已更新但组合快照仍是旧值；
3. 循环内单票失败被 `continue` 吞掉，**返回体仍 `{ok:true}`** ⇒ 无任何字段标记 PARTIAL（§15.8 已登记）。

静态断言（A.1）同时确认：当前实现**不含** `active_run_pointer` / `runTransaction` / `run_manifest`。

## 17.2 Target architecture（任务书 §7）

```
RunContext → run_id → candidate documents → expected 5 ETF complete
           → Run Finality → Validation → COMPLETED → atomic active pointer switch
```

- 消费者**只允许**读 `active_run_id` 指向的 **completed** dataset；
- ⛔ 不得把「最新写入时间最大的文档」视为 active。

## 17.3 逻辑模型（任务书 §8，语义而非 collection 名）

| 逻辑集合 | 字段 |
|---|---|
| `run_manifest` | `run_id` / `expected_trade_date` / `input_hash` / `expected_codes` / `status` / `revision` |
| `run_candidate_decision` | `run_id` / `code` / `payload`（+ `calc_date` 供同日性校验） |
| `run_candidate_portfolio` | `run_id` / `payload` |
| `active_run_pointer` | `scope='production'` / `run_id` / `revision` / `expected_trade_date` / `promoted_from_run_id` |

实现：`src/common/utils/v365-atomic-publish.js`（纯逻辑）+ `scripts/lib/v365-p3-memory-adapter.js`（**PoC 专用内存 adapter**）。

## 17.4 Atomic 的严格定义（任务书 §11）

> **Atomicity =** 消费者可见的 authoritative dataset，只能通过**单一 active pointer**
> 从旧完整 run 切换到新完整 run。

⇒ candidate **可以逐条写**（D.1 实测：写到第 1/2/3 条时读取仍是旧 run）；
但 **partial candidate 永远不能成为 authoritative**。

## 17.5 提升规则（任务书 §7/§13，显式定义，⛔ 不靠 wall-clock）

| 规则 | 内容 |
|---|---|
| R1 | `finality.status === COMPLETE` |
| R2 | `validation.passed === true` |
| R3 | **monotonic revision**：`candidate.revision > current_pointer.revision` |
| R4 | 同 `expected_trade_date` 允许 supersede，但**必须记录** `supersedes_run_id`（可追溯） |
| R5 | **CAS**：提升时 `expected_pointer` 必须与当前 pointer 一致，否则 HOLD |

## 17.6 NoSQL capability verification（任务书 §12）

| 能力 | 结论 | 依据 |
|---|---|---|
| multi-document **transaction** | **存在** —— 平台提供 `db.runTransaction(async transaction => { … })` | CloudBase 参考文档 `cloudbase-document-database-*/crud-operations.md` 的 "Transaction Support" 段 |
| **conditional delete** | **存在**（"Delete only if conditions are met"） | 同上 |
| 单文档原子更新 | 平台既有语义；**本仓文档未给出完整契约**（隔离级别 / 冲突重试 / 失败语义均未记载） | 文档原文注释为 "Check CloudBase documentation for transaction API" |
| 平台安全规则对照 | `security-rules.md` 明确「update … does not guarantee atomicity of this operation」——**这是规则校验层面的表述，不可误读为"单文档更新非原子"** | 同上 |

**推荐方案**：**single-pointer promotion（单指针 CAS）**，而非 multi-document transaction。
理由：最小复杂度、最可验证、且**不依赖尚未确证的事务隔离语义**；candidate 逐条写 + 单点 CAS 即可满足 §11 的 Atomic 定义。

## 17.7 Failure Injection 结果（任务书 §10，F1–F8）

| 用例 | 期望 | 实测 |
|---|---|---|
| **P3-F1** 5/5 成功 | 切换成功 | ✅ `COMPLETE` ⇒ pointer 切到新 run |
| **P3-F2** 4/5 成功 | `PARTIAL` + pointer 不变 | ✅ |
| **P3-F3** 5/5 成功但 mixed-date | validation fail + pointer 不变 | ✅ `mixed_date_detected` |
| **P3-F4** portfolio write failure | pointer 不变 | ✅ `missing_portfolio_candidate` |
| **P3-F5** promotion 前 crash | 旧 active 保留 | ✅ 注入 `compareAndSetPointer` 失败，pointer 未变 |
| **P3-F6** promotion 后 retry 同 run_id | 幂等 | ✅ `ALREADY_ACTIVE`，**不产生新 revision** |
| **P3-F7** 同 trade_date、不同 run_id | 有明确规则 | ✅ revision 更大者 supersede 且写 `supersedes_run_id`；revision 更小者被 `STALE_RUN` 拒绝 |
| **P3-F8** 旧 active + 新 FAILED | 消费者读旧 active | ✅ dataset 完整（5/5） |

## 17.8 并发 / TOCTOU 结果（任务书 §13）

| 用例 | 结果 |
|---|---|
| **C.1** Run A/B 交错，B 先提升、较旧的 A 后到 | ✅ A 被 `STALE_RUN` 拒绝，B 保留 |
| **C.2** 持**过期 pointer 快照**提升（revision 更大） | ✅ 被 **CAS** 拒绝（`compare_and_set_rejected`），并发者结果保留 |
| **C.3** `created_at` 更晚但 `revision` 更小 | ✅ 被拒 ⇒ **⛔ 不以 wall-clock 决定胜负** |

## 17.9 P-3 Gate（任务书 §14）

| 判定 | 结果 |
|---|---|
| `COMPLETE_CAN_PROMOTE` | **PASS** |
| `PARTIAL_CANNOT_PROMOTE` | **PASS** |
| `FAILED_CANNOT_PROMOTE` | **PASS** |
| `MIXED_DATE_CANNOT_PROMOTE` | **PASS** |
| `CRASH_BEFORE_PROMOTION_SAFE` | **PASS** |
| `RETRY_IDEMPOTENT` | **PASS** |
| `STALE_RUN_CANNOT_OVERWRITE_NEWER` | **PASS** |
| `OLD_ACTIVE_SURVIVES_FAILED_CANDIDATE` | **PASS** |

⇒ **`P3_ATOMIC_PUBLISH_POC = PASS`**（脚本 `scripts/v365-p3-atomic-publish-gate.js`，8/8；
测试 `tests/v365-p3-atomic-publish-poc.test.js`，17/17）

## 17.10 本轮边界履行

⛔ **生产代码零改动**（相对 `origin/master` 的已跟踪改动集与 §15 完全相同 —— 本轮只新增文件、并修改 §15 自建的 3 个文件）；
⛔ 未接线 `runDecisionEngine`、未创建生产 collection、未改 schema、未部署、未建 PR、未 merge、未改 `param_config`；
⛔ 未改 V3 策略 / `breakout_nd` / SlowBreak / Portfolio Mode / Market Regime / Gen-1 Authority / Gen-2 Authority。

---

# 18. Readiness 更新（任务书 §16）

| 项 | 状态 |
|---|---|
| **P-1**（implementation） | **`CLOSED`** |
| **P-1A**（production calendar authority） | **`CLOSED`**（`P1_PRODUCTION_AUTHORITY_ARTIFACT = CLOSED`） |
| **P-2** | **`CLOSED`** |
| **P-3** | **`CLOSED`**（`P3_ATOMIC_PUBLISH_POC = PASS`） |
| **P-4** | **`OPEN`** —— OBS-001 可观测性 vs「不改 `materializeIndicators`」冲突，**仍需单独裁定** |

# `V365_READINESS = BLOCKED_ON_P4`

> ⛔ 不写 `READY_TO_IMPLEMENT` —— P-4 未关闭，且「实现」不等于「可上线」。

**回归**：本分支 Node 单测 **52 passed / 3 failed**，`origin/master` worktree 对照 **48 passed / 3 failed**，
**失败集合完全相同**（3 项既有失败为环境相关）⇒ 零新增失败；
`verify-immutable` 23/23、`verify-gen1-pipeline` 10/10、`verify-gen2-build-artifacts` 7/7 全 PASS。

---

# 19. WP-V365-P4 — Pipeline Correlation & Observability（OBS-001 闭合）

> 本节为追加，不改动上文 §0–§18 的任何历史结论。
> **本轮裁定**：`P4_DESIGN = CORRELATION_AND_OBSERVABILITY_ONLY`
> ⛔ `RETRY = NO` · ⛔ `TIMEOUT_CHANGE = NO` · ⛔ `MATERIALIZE_CONTROL_FLOW_CHANGE = NO`
> ⛔ caller timeout **不自动重试** `runDecisionEngine`

## 19.1 `CURRENT_P4_OBSERVABILITY_GAP`

### 19.1.1 当前真实路径（只读实测）

```
[定时 22:00 dailyFetch-2200 / 15:30 示例] 或 [链式]
  fetchDailyData
    └─ app.callFunction({ name:'materializeIndicators', data:{ from:'fetchDailyData' } })
         materializeIndicators
           ├─ 逐票 computeSnapshot → upsert etf_weekly / indicator_snapshot
           └─ app.callFunction({ name:'runDecisionEngine', data:{ from:'materializeIndicators' } })
                runDecisionEngine
                  └─ 逐票 upsert decision_result / fundamental_state / portfolio_position → portfolio_snapshot
```

**全仓共 6 处 `callFunction`，其中 4 个不同入口进入 `runDecisionEngine`**：

| 入口 | `data.from` | 类型 |
|---|---|---|
| `materializeIndicators` | `materializeIndicators` | 链式 |
| `adminGateway`（风险解除） | `riskResolve` | 人工 |
| `adminGateway`（风险触发） | `riskTrigger` | 人工 |
| `adminGateway`（参数变更） | `paramChange` | 人工 |

### 19.1.2 逐条回答任务书 §3 的 8 问

| # | 问题 | 结论 | 证据 |
|---|---|---|---|
| 1 | 当前有哪些 request id | **平台侧有**（CLS 里可见）：上游 `1fcaa62f-…`、下游 `804f7202-…`／`fdda3368-…`；`request_source` 亦有（`TRIGGER_TIMER` / `TCB_API`） | OBS-001 调查报告 §2；平台文档 `select request_id, … group by request_id` |
| 2 | caller request id 是否传入下游 | **否**。payload 只有 `{ from: '<caller>' }` | `materializeIndicators:127`、`fetchDailyData:424` |
| 3 | `runDecisionEngine` 是否知道上游是谁 | **否**。`event.from` **被传入但从未读取**；`context` **零使用** | `grep -n 'context\.'` 与 `'event\.from'` 均 0 命中 |
| 4 | 是否已有 `run_id` | **生产链无**。`run_id` 仅存在于 Shadow / Gen-1 / Gen-2 侧集合 | 全仓 grep |
| 5 | 是否已有 pipeline-level correlation id | **完全没有**。全仓 `pipeline_run_id` 0 命中 | `grep -rn pipeline_run_id src cloudfunctions` 仅命中本轮的 P-4 契约模块 |
| 6 | timeout 后 caller 是否还能知道 downstream 最终状态 | **不能**。`catch` 只保留错误字符串，且**无 id 可回查** | `chained = { error: String(e.message \|\| e) }` |
| 7 | 日志/DB 中哪些字段可跨函数关联 | **只有「函数名 + 时间戳」**（人工比对）。CLS 有 `request_id`/`request_source`，但**不落 DB、不入返回体** | OBS-001 报告 §2/§3 |
| 8 | OBS-001 为何只能人工推断 | 因为 (2)(3)(5)(6) 同时成立：**无共同身份 + 传输结果与业务结果同形** ⇒ 只能靠 08:00:29.973↔08:00:30.488 这类时间窗口拼接 | 同上 |

### 19.1.3 三条结构性缺口

| 缺口 | 说明 |
|---|---|
| **GAP-1 无共享身份** | 跨函数没有任何稳定 id；4 个入口也无法区分来源 |
| **GAP-2 传输与业务同形** | `{error:"ESOCKETTIMEDOUT"}` 与 `{result:{ok:true,…}}` 都在 `chained` 这一层，**没有两个正交维度** |
| **GAP-3 caller 放弃后无处回查** | 下游的成功事实只存在于 CLS，**不作为结构化数据留存** |

## 19.2 Pipeline Correlation Contract（任务书 §4）

`pipeline_run_id` 由**上游生成、向下游透传**，身份成分**不含 wall-clock**：

```
pipeline_key    = pl|<expected_trade_date>|<origin>|<entry_function>|<source_detail>
pipeline_run_id = <pipeline_key>#a<attempt>
```

| 设计点 | 做法 |
|---|---|
| 一次完整 pipeline 唯一 | `key` 内含 trade date + 来源 + 入口 |
| 上游生成 / 下游透传 | `buildForwardPayload()` 产出透传字段；callee 用 `readInboundCorrelation(event)` **只读**读取 |
| ⛔ 不依赖 wall-clock 作为身份 | 身份**只用** date/origin/entry/detail/attempt；`started_at`/`completed_at` 仅作诊断 |
| retry 同一 pipeline 可识别 | 同 `pipeline_key`、`attempt` 递增（`store.nextAttempt` 单调，**不用时钟**） |
| 手动调用有明确来源 | `origin='manual'` + `entry_function='adminGateway'` + `source_detail∈{riskResolve,riskTrigger,paramChange}` |

**记录字段**（语义保留，名称可调）：`pipeline_run_id` / `pipeline_key` / `attempt` / `origin` /
`entry_function` / `caller_function` / `caller_request_id` / `callee_function` / `callee_request_id` /
`expected_trade_date` / `input_hash` / `engine_run_id` / `transport_status` / `business_status` /
`started_at` / `completed_at` / `error_code`。

## 19.3 状态模型（任务书 §5）—— 两个正交维度

| Transport | 含义 |
|---|---|
| `CALL_STARTED` | 已发起，未结算 |
| `CALL_RETURNED` | 拿到了调用返回 |
| `CALL_TIMEOUT` | 传输层超时（如 `ESOCKETTIMEDOUT`） |
| `CALL_ERROR` | 传输层其它错误 |

| Business | 含义 |
|---|---|
| `NOT_OBSERVED` | **没有下游自证**（⛔ 不等于 FAILED） |
| `RUNNING` | 下游已开始、未结束 |
| `COMPLETE` / `PARTIAL` / `FAILED` | 下游自证的最终业务结论 |

**两条禁令被写成可执行守卫**（不是注释）：

- `deriveBusinessFromTransport()` ⇒ **恒抛** `FORBIDDEN_INFERENCE`
- `deriveTransportFromBusiness()` ⇒ **恒抛** `FORBIDDEN_INFERENCE`
- `settleTransport(record, { …, business_status })` ⇒ **抛错**：传输结算不得携带业务状态

## 19.4 OBS-001 如何被结构化表达（任务书 §6）

目标形态：

```
transport_status = CALL_TIMEOUT
business_status  = COMPLETE
```

**机制 = 下游自证（callee-side observation）**：下游把「自己跑完了、结果如何」写成一条带
**同一个 `pipeline_run_id`** 的记录；caller 即使已放弃等待，事后仍可按 id 回查。

`reconcile()` 的关联依据**只有 `pipeline_run_id` 相等**：

| 字段 | 值 |
|---|---|
| `correlated` | `true`（= 两侧 id 相等） |
| `correlation_basis` | `pipeline_run_id_equality` |
| `is_obs_001_shape` | `true` |
| `manual_reconstruction_required` | **0**（⛔ 不再依赖时间窗口 / 函数名+时间拼接） |

## 19.5 `MATERIALIZE_CHANGE_REQUIRED = YES`

**结论：YES。** 理由：不能让 `pipeline_run_id` 端到端透传，就只能在「上游生成但下游看不到」之间断裂 ——
λ 上游必须做三件事：**生成**、**放进 `callFunction` payload**、**把 transport 结果结构化**。

**最小 additive patch（只新增，不改业务控制流）**——完整描述见
`scripts/lib/v365-p4-candidate-patches.js`（**只描述、未落盘**）：

| 补丁 | 文件 | 内容 |
|---|---|---|
| `P4-PATCH-MI` | `cloudfunctions/materializeIndicators/index.js`（drift 件，本轮⛔不改） | ① 顶部 `require` 契约模块；② 链式调用**前**生成身份 + 落 caller 记录；③ `callFunction` 的 `data` 改用 `buildForwardPayload(...)`（**`from` 语义不变**）；④ `catch` 改为 `chained = { error: <原样保留>, transport: classifyTransportError(e) }`；⑤ 正常返回前结算 `CALL_RETURNED` |
| `P4-PATCH-RDE` | `cloudfunctions/runDecisionEngine/index.js`（**V364 冻结件**） | ① `require` 契约模块；② `main()` 开头 `readInboundCorrelation(event)`（**只读**）；③ 在**已有** `runtime_status` upsert 上新增 `pipeline_*` / `callee_request_id` 字段（**零新增业务写入**）；④ `return` 体新增只读 `pipeline` 字段 |

**边界**：`retry_added=false` / `timeout_changed=false` / `business_control_flow_changed=false`；
`PATCH_APPLICATION_REQUIRES_AUTHORIZATION = true`（含冻结件）。本轮 **两处云函数均未改动**（实测零污染）。

## 19.6 P4-T1 ~ T8 测试结果

| 用例 | 期望 | 实测 |
|---|---|---|
| **T1** Normal success | `CALL_RETURNED` + `COMPLETE` | ✅ 关联依据 = `pipeline_run_id_equality`；caller/callee request id 都记到 |
| **T2** Caller timeout / downstream success | `CALL_TIMEOUT` + `COMPLETE` **可结构化** | ✅ `is_obs_001_shape=true`，`manual_reconstruction_required=0` |
| **T3** Caller timeout / still running | `CALL_TIMEOUT` + `RUNNING` | ✅ |
| **T4** Caller timeout / failed | `CALL_TIMEOUT` + `FAILED` | ✅ |
| **T5** Call error before start | `CALL_ERROR` + `NOT_OBSERVED` | ✅ 明确「未观测」，不是 FAILED |
| **T6** Same pipeline retry | 同 key、attempt 递增、非两次独立决策 | ✅ `attempt 1→2`、run_id 不同、`listAttempts` 2 条 |
| **T7** Different runs, same trade date | 可区分 | ✅ 同日不同源 ⇒ 不同 key；同日同源不同 attempt 亦可区分 |
| **T8** Manual run | `manual` + 明确来源 | ✅ `origin=manual`、`source_detail=riskChange` 可反解 |

测试文件 `tests/v365-p4-pipeline-correlation.test.js` —— **29/29 PASS**（含 §C 守卫 5 项、§E 三 ID 3 项、§F 补丁边界 4 项）。

## 19.7 Parity（任务书 §11）

| 证据 | 结果 |
|---|---|
| 改动文件 ∩ 回放依赖集（harness 传递闭包） | **`[]`** |
| 决策核心 12 文件改动 | **`[]`** |
| `cloudfunctions/` 改动 | **0 个文件** |
| `replay()` 两次决策序列 sha256 | **一致** |
| **anchor** | `25ccbfc7e1b73a9a173ec36c17512c6228a2fe42685dcd291bc055ea4ed11723`（**与 §15/§17 完全相同 ⇒ 决策行为未变**） |

⇒ **`UNEXPECTED_DECISION_DELTA = 0`**

## 19.8 P-4 Gate（任务书 §12）

| 判定 | 结果 |
|---|---|
| `PIPELINE_CORRELATION_ID` | **PASS** |
| `TRANSPORT_BUSINESS_STATUS_SEPARATED` | **PASS** |
| `TIMEOUT_SUCCESS_CASE_EXPRESSIBLE` | **PASS** |
| `RETRY_NOT_ENABLED` | **PASS**（cloudfunctions 零改动 + 补丁 `retry_added=false` + 契约模块无重试逻辑） |
| `TIMEOUT_NOT_CHANGED` | **PASS**（cloudfunctions 零改动 ⇒ 任何 timeout 参数都不可能被改） |
| `CONTROL_FLOW_UNCHANGED` | **PASS**（同上 ⇒ 链式控制流逐字未变） |
| `SAME_PIPELINE_RETRY_DISTINGUISHABLE` | **PASS** |
| `NORMAL_PATH_DECISION_DELTA` | **0** |

⇒ **`P4_PIPELINE_OBSERVABILITY = PASS`**（脚本 `scripts/v365-p4-correlation-gate.js`，8/8）

## 19.9 与 P-3 的关系（任务书 §10）

三组 ID **语义独立**，且有可执行守卫 `assertDistinctIdentities()`：

| ID | 语义 |
|---|---|
| `pipeline_run_id` | 整条任务链身份 |
| `engine_run_id` | 一次 decision-engine candidate 身份（P-3 的 `run_id`） |
| `active_run_id` | 当前 authoritative dataset（P-3 的 pointer） |

⚠️ **重要修正**：`engine_run_id == active_run_id` **是合法的** —— active pointer 本来就「指向某个 run_id」。
守卫只拒绝 `pipeline_run_id` 被复用为 engine/active 身份，并把前者标为 `pointer_targets_run = true`。

## 19.10 本轮边界履行

⛔ **两处云函数逐字未改**（实测 `cloudfunctions/` 改动 0 个文件）⇒ 无 retry、无 timeout 变更、无控制流变更；
⛔ 未接线 RunContext / RunFinality / active pointer 到生产；未部署、未建 PR、未 merge、未改 `param_config`；
⛔ 未进入 B0/B1；未改 V3 策略 / `breakout_nd` / SlowBreak / Portfolio Mode / Market Regime；
⛔ 未提升 Gen-1 / Gen-2 Authority；未动 `v3.6.4-frozen` tag 与任何 immutable lock。

---

# 20. Readiness 终态（任务书 §12）

| 项 | 状态 |
|---|---|
| **P-1** | **`CLOSED`** |
| **P-1A** | **`CLOSED`**（`P1_PRODUCTION_AUTHORITY_ARTIFACT = CLOSED`） |
| **P-2** | **`CLOSED`** |
| **P-3** | **`CLOSED`**（`P3_ATOMIC_PUBLISH_POC = PASS`） |
| **P-4** | **`CLOSED`**（`P4_PIPELINE_OBSERVABILITY = PASS`） |

# `V365_READINESS = READY_TO_IMPLEMENT`

⚠️ **该判定的语义边界（必须与「可上线」区分）**：
`READY_TO_IMPLEMENT` 表示 **V3.6.5 的五个工作包（P-1/P-1A/P-2/P-3/P-4）均已达实现就绪**，
**不等于**「已授权实施 / 已授权部署」。以下均需**单独授权**：

1. **B0/B1 批次开工**（本轮明确禁止进入）；
2. 把 RunContext / RunFinality / active pointer 接入生产；
3. 执行 `P4-PATCH-MI` / `P4-PATCH-RDE`（后者含 **V364 冻结件**）；
4. V3.6.5 的封版、部署与生产晋升。

**回归收尾**：本分支 Node 单测 **53 passed / 3 failed**，`origin/master` worktree 对照 **48 passed / 3 failed**，
**失败集合完全相同**（3 项既有失败为环境相关）⇒ 零新增失败；
`verify-immutable` 23/23、`verify-gen1-pipeline` 10/10、`verify-gen2-build-artifacts` 7/7 全 PASS。

---

# 21. WP-V365-B0/B1 — Production Integrity Implementation Candidate

> 本轮性质：**实施轮**（新分支 `feat/v365-production-integrity-impl`，由 `94b7728` 分出）。
> ⛔ 未部署 / 未 push / 未建 PR / 未 merge；V3.6.4 保持 `FROZEN / MERGED / DEPLOYED / PRODUCTION`，
> tag `v3.6.4-frozen^{}` 未移动，V361/V364 lock **未被回写**。

## 21.1 分支与提交（按工作包拆分）

| # | commit | 工作包 | 内容 |
|---|---|---|---|
| 1 | `7e6d1df` | **B0** | `v365-contracts.js` / `V365_CANDIDATE_MANIFEST.json` + 生成器 + 校验器 / `docs/V365_AUTHORITATIVE_CONSUMER_MAP.md` / CI Gate V365 / `tests/v365-b0-manifest.test.js` |
| 2 | `bd9634d` | **B1-correlation** | `materializeIndicators` 生成+透传 `pipeline_run_id`、transport 结构化 |
| 3 | `86d4b58` | **B1-run-integrity** | RunContext gate + Run Finality + candidate-first 发布接线（`runDecisionEngine`）+ 3 个新运行时模块 + 2 处真实缺陷修正 |
| 4 | 见 `git log` | **qualification** | `scripts/v365-qualification-gate.js` / `scripts/v365-cas-platform-probe.js` / 本节 |

## 21.2 B0：V3.6.5 自有身份与合格面

- `engine_version = v3.6.5`，`parent_production_version = v3.6.4`，`release_kind = PRODUCTION_INTEGRITY`
- 契约：`input_contract_version = live-31-v1`（**31 字段**，⛔ 不恢复 `breakout_nd`）·
  `calendar_version = cn-a-share-2026.1` · `pipeline_correlation-v1` · `v361-run-context-v2` ·
  `v361-run-finality-v1` · `v365-two-stage-v1`
- `qualified_files = 18`，`candidate_content_sha = 601d313d1492623b4f32090bdc6066dcf1f729678b51d3f5551cb1ed9b2a4024`
- **V364 lock 的历史缺陷（声明了 file hash 却无校验器消费）在 V365 不得复制**：
  新校验器**逐文件实读 → 实算 LF-sha256 → 逐一比对**，失败码 `DECLARED_FILE_MISSING` /
  `HASH_MISMATCH` / `UNEXPECTED_QUALIFIED_FILE_CHANGE` / `CANDIDATE_CONTENT_SHA_MISMATCH` /
  `CALENDAR_SHA_MISMATCH`；**已接入 CI**（`Gate V365 — Candidate Manifest Qualified-File Verification`）
- **反向证明**（`tests/v365-b0-manifest.test.js` A.8）：篡改任一合格文件内容 ⇒ 校验器**必须 FAIL**
  （否则就是"声明了却无人消费"）

## 21.3 AUTHORITATIVE_CONSUMER_MAP（§3）

详见 `docs/V365_AUTHORITATIVE_CONSUMER_MAP.md`。要点：

- 4 个集合共 **30 个读取点**；`web/` 不直连集合（全经 HTTP）⇒ reader migration **全在服务端可完成**
- **跨集合组合点 9 处**（最大 = `apiGateway.getDashboard`：position + snapshot + 逐票 decision + runtime_status **无 run 绑定**）
- **回到 §3 的那个问题：会破坏 P-3 atomicity？→ `YES`**（reader 不变时切换窗口内可拼出「新 decision + 旧 snapshot」）
- **是否触发 `STOP_B1_ATOMIC_WIRING`？→ 不触发（有条件）**：不存在技术上无解的消费者。
  但附**三条硬约束**：① pointer 生效前 5 个 authoritative 端点必须先迁移；② `portfolio_position` /
  现金基线属**「当前可变状态」另一条轴**，必须显式区隔（⛔ 不得声称"单 run 快照"）；
  ③ 历史 range / Gen-2 anchor / `cooldown` 需**run 历史索引**，单指针不足 ⇒ 另立工作包。
- `portfolio_position` 这类**可变状态**轴与 run 产物（不可变）轴**不得混为一谈**。

## 21.4 实际数据 / 写入 / 读取拓扑（实施后）

```
fetchDailyData(22:00) ──(仍只带 from；**本轮未接线**)──▶ materializeIndicators(08:00/链式)
        │ 生成 pipeline_run_id（身份成分不含 wall-clock）
        │ buildForwardPayload（from 语义逐字保留）+ settleTransport
        ▼
runDecisionEngine ──▶ readInbound(event)（只读）
        ├─ RunContext：expected_trade_date ← 官方日历 artifact（⛔ 非 max(calc_date)）
        ├─ gate: BLOCKED ⇒ **不写任何 authoritative 数据**，返回结构化理由（fail-closed）
        ├─ 5 票计算（决策核心**零改动**）
        ├─ v365WriteDecision  → candidate（ENFORCE）／ decision_result（LEGACY）
        ├─ v365Finality：COMPLETE / PARTIAL / FAILED
        └─ 快照发布门：仅 COMPLETE ⇒ candidate（ENFORCE）／ portfolio_snapshot（LEGACY）
                             ▼
                  单指针 CAS 提升（active_run_pointer）
                  ⛔ 平台级证据未取得 ⇒ **本分支下不会发生**（ATOMIC_PROMOTION_BLOCKED）
```

## 21.5 本轮修正的**两处真实缺陷**（不是我造的需求）

1. **日历 artifact 路径**：`cn-trading-calendar.js` 此前按**仓库布局**（`__dirname/../../..`）解析路径；
   但 `build-cloudfunctions.js` 把 `src/common` 整体复制为 `<fn>/common`，打包后 `__dirname` = `<fn>/common/utils`
   ⇒ `../../../src/common/data` 指错 ⇒ **部署后读不到 artifact，会静默退化成"未播种"并恒判 BLOCKED**
   （典型"本地全绿、线上全红"）。已改为**多候选**（先打包布局 `../data`，后仓库布局）。
2. **发布校验字段名不匹配**：P-3 的 mixed-date 校验读 `calc_date`，而生产
   `decision_result.decision_date` **本身就等于** snapshot 的 `calc_date`（`src/common/utils/decision.js:936`）
   ⇒ 原样接线会在生产**恒报 `mixed_date_detected`**、永不发布。已做**同义归一**；
   ⛔ 日期真不同的场景仍会被拦（`Q4 FI-02（发布层）` 已证）。

## 21.6 B1 接线清单（逐项对应任务书 §4–§9）

| 任务书要求 | 实施情况 | 证据 |
|---|---|---|
| §4 pipeline correlation 接线 | ✅ `pipeline_run_id` 生成/透传；`transport_status` 结构化；`chained.error` 保留；⛔ 无 retry / 无 timeout 改动 / 未改调用顺序 | `tests/v365-p4` A.1/A.3/F.4 |
| §5 RunContext 正式接线 | ✅ 三日期 + `input_hash` + `input_contract_version` + `calendar_version` + missing/stale + `input_health`；5/5 `calc_date == expected_trade_date` | gate Q2/Q3 |
| §6 BLOCK 的生产语义 | ✅ fail-closed 早退：不写 decision/position/snapshot；`business_status=FAILED`；`publishable=false`；⛔ 不回退 `observed_latest_date` | gate Q2/Q3 + `FI-12` |
| §7 Run Finality 接线 | ✅ `COMPLETE/PARTIAL/FAILED` + `expected/success/failed/missing/publishable`；PARTIAL/FAILED 不得成为 authoritative | gate Q4/Q5 |
| §8 candidate-first write | ✅ 计算与 authoritative 发布分离；ENFORCE 下决策写 candidate | gate Q6 + `tests/v365-p3` A.1 |
| §9 active pointer | ✅ 单指针 + `run_id`/`revision`/`supersedes`/`expected_current_pointer`；⛔ 不靠 wall-clock | gate Q7/Q8/Q9 |
| §10 CAS / concurrency | ⚠️ **协议层 PASS，平台层未证** ⇒ `ATOMIC_PROMOTION_BLOCKED` | 见 21.7 |

## 21.7 ⛔ `ATOMIC_PROMOTION_BLOCKED`（§10 的诚实结论）

`@cloudbase/node-sdk@2.11.0` 的 `Db.startTransaction()` / `Db.runTransaction()`
**确实存在**（`types/index.d.ts:467-468`，`Transaction.collection()` 返回 CollectionReference，
`commit()` / `rollback()` 齐备）⇒ §10 要求①「明确实际 API」**已满足**。

但 §10 要求②③④（明确冲突失败语义 / **实测两个并发 promotion** / 证明 stale run 无法覆盖 newer run）
都需要**向真实环境写入**；而 §15 规定「任何 production write：需要另行授权」
⇒ **本轮未做**，故：

- `CAS_EVIDENCE.platform_concurrency_tested = false`
- `publishPromotionAllowed() === false`（fail-closed：**绝不降级为先读后写**）
- 适配器在缺事务能力时返回 `CAS_UNAVAILABLE`，调用方一律 HOLD

**由此得到一个必须写明的推论**：ENFORCE 语义下 candidate 会写、但 **authoritative 不会发布**
⇒ **V3.6.5 在取得该证据前不可部署**（否则线上"只算不发"）。

**关闭它只需要一件事**（一次性、极小面）：授权执行
`node scripts/v365-cas-platform-probe.js --i-have-authorization --env <envId>`
（探针**只**写 `_v365_` 前缀的独立集合，与任何生产集合/reader 无交集；默认拒绝运行）。

## 21.8 `MATERIALIZE_CHANGE_REQUIRED` 的闭合（§4 结论）

- 需要：**YES**（已在本轮按最小 additive patch 落盘）。
- ⛔ 未做：补 `breakout_nd` / 同步 repo 的其他 indicator 差异 / 改 `computeSnapshot` /
  改 contract 31→32 / 改 retry / 改 timeout。
- 生产 `materializeIndicators` 仍是**独立 drift 件**，V3.6.5 继续按**真实 31-field contract** 资格化。

## 21.9 Qualification（§19）

`scripts/v365-qualification-gate.js`（全部 FI 跑在**内存适配器**上，⛔ 不写真实集合）：

| 门 | 结果 |
|---|---|
| Q1 `NORMAL_PATH_DECISION_DELTA = 0` | **PASS**（决策核心 `src/common/utils` 数学文件零改动；replay 两次决策序列 sha256 一致 = `25ccbfc7…`，与 P-1/P-3/P-4 轮**完全相同**） |
| Q2 `EXPECTED_DATE_GATE` | **PASS**（FI-01 5/5 PASS；FI-02 4/5+1 stale BLOCK；FI-12 日历越界 BLOCK 且不回退） |
| Q3 `ALL_STALE_BLOCK` | **PASS**（FI-03 `CASE_C_ALL_STALE`；并显式证明此时 5 票 `calc_date` **互相完全一致** ⇒ 旧 cross-sectional 判据结构性假绿） |
| Q4 `PARTIAL_NO_PUBLISH` | **PASS**（FI-02 发布层 mixed-date ⇒ validation fail 且不提升） |
| Q5 `FAILED_NO_PUBLISH` | **PASS**（全失败 ⇒ FAILED；缺一票 ⇒ 不得冒充 COMPLETE） |
| Q6 `WRITE_FAILURE_NO_PUBLISH` | **PASS**（FI-05 candidate 写失败 / FI-06 portfolio 写失败 ⇒ 指针为 NULL） |
| Q7 `ACTIVE_POINTER_ATOMICITY` | **⚠️ BLOCK**（协议层 PASS：FI-01 提升、FI-07 提升前 crash 旧 active 存活；**平台层未证**） |
| Q8 `CONCURRENT_STALE_PROMOTION_REJECTED` | **PASS**（FI-10 较旧 revision 后到被拒；CAS 拒绝持过期 expected 的写入） |
| Q9 `SAME_DAY_IDEMPOTENCE` | **PASS**（FI-09 同交易日新 revision ⇒ 显式 `supersedes=run-A`） |
| Q10 `RUN_RETRY_IDEMPOTENCE` | **PASS**（FI-08 同 run 重放 ⇒ 不产生新 revision、不再触发提升） |
| Q11 `OBS001_STRUCTURED` | **PASS**（`CALL_TIMEOUT + COMPLETE` 且 `pipeline_run_id` 相等 ⇒ `obs_001_shape=true`、`manual_reconstruction_required=0`；⛔ id 不同则判**非**同一笔） |
| Q12 `INPUT_CONTRACT` | **PASS**（`live-31-v1` / 31 / 排除 `breakout_nd`） |
| Q13 `CALENDAR_AUTHORITY` | **PASS**（seeded=true / synthetic=false；open 4/4、closed 6/6——含 10-10 周末休市） |
| Q14 `SOURCE_PROVENANCE` | **PASS**（`["SSE","SZSE"]` + 两份公告号） |
| Q15 `V365_MANIFEST_VERIFIER` | **PASS**（18 个合格文件逐字节一致） |

**汇总：26 / 27**（唯一 BLOCK 项 = Q7 平台证据缺失，**非实现缺陷**）

## 21.10 最终状态

```
P-1 = CLOSED · P-1A = CLOSED · P-2 = CLOSED · P-3 = CLOSED · P-4 = CLOSED
V365_IMPLEMENTATION = BLOCKED_ON_PLATFORM_CAS_EVIDENCE      ← ⛔ 不是 QUALIFIED_CANDIDATE
ATOMIC_PROMOTION_BLOCKED = 成立（§10）
```

**为什么不给 `QUALIFIED_CANDIDATE`**：§19 明文要求 Q1–Q15 **全部**满足才可给该状态；
Q7 的平台级并发证据未取得（§10 亦明文禁止在该证据缺失时"继续部署准备"）。
⇒ 我可以诚实地说：**除平台 CAS 并发实证外的 26 项全部通过**，但**不**越级宣称合格。

**回归**：CANDIDATE **54 passed / 3 failed**，`origin/master` worktree 对照 **48 passed / 3 failed**，
**失败集合完全相同**（`gen1-parity` / `gen1-ge03-regression-guard` / `gen2-scenario-parity` 为既有环境相关失败）
⇒ **零新增失败**。三校验器 `23/23` / `10/10` / `7/7` 全 PASS；V365 manifest 校验器 PASS。

⚠️ **一处必须披露的判据冲突**：P-1/P-4 轮的 `scripts/v365-p12-decision-parity.js` 把
`cloudfunctions/runDecisionEngine/index.js` 列入"决策核心必须零改动"，本轮**按 B1 要求修改了它**
⇒ 该脚本的「决策核心零改动」判据**必然 FAIL**（属**预期**，非回归）。
B1 适用的判据在 qualification gate 的 Q1：**`src/common/utils` 决策数学文件零改动 +
replay 决策序列 sha256 与前三轮完全相同**。
⚠️ 另需明确：ENFORCE 下的变化是**发布行为**（不写 legacy authoritative），**不是决策值**变化。

## 21.11 本轮边界履行（§20 / §21）

⛔ 未 deploy · 未 push · 未建 PR · 未 merge · 未 push master · 未改 `param_config` ·
未移动 `v3.6.4-frozen` tag · 未改 V364 immutable manifest · 未提升 Gen-1 / Gen-2 Authority ·
未恢复 `breakout_nd` · 未补 SlowBreak · 未启用 Portfolio Mode · 未改 Market Regime ·
未改 tech cap / single ETF cap / StageFactor / MarketFactor / step size ·
未接线 Two-stage Publish 到**生产 collection**（只在 candidate 与内存适配器上验证）·
未修改任何生产 collection schema · 未写真实生产集合。
✅ 已本地 commit（4 个工作包）；`V365_CANDIDATE_MANIFEST.qualification_status = CANDIDATE`。




