# Gen-1 Evidence Contract（证据契约）

**工作包**：WP-G1-EVIDENCE
**冻结版本**：v1.0
**冻结时间**：2026-09-10（北京时间）
**状态**：🔒 **FROZEN —— 冻结在先，采样在后**

---

## 0. 本契约的唯一目的

Canary 上线前的问句是：

> 「Canary **安不安全**？」

Canary 上线后的问句变成：

> 「Canary **有没有经济价值**？」

本契约把第二个问句拆成**可复核、可证伪、不可事后修改**的度量口径。
**冻结在先**：任何指标定义、样本纳入规则、判定阈值，都在看到第一个样本之前书面确定。
**不得在看到结果之后修改指标口径** —— 一旦修改，须以 v2.0 重新冻结，并**作废此前全部样本**重新累计。

> 这是一份「事先承诺（pre-registration）」。它的价值恰恰在于**约束未来**：防止「看到结果再挑口径」。

---

## 1. 核心对比对象（唯一主对比）

**每日核心对比 = 两列建议执行仓**：

| 列 | 来源 | 含义 |
|---|---|---|
| `baseline_suggested_position` | `decision_result.suggested_position` | **V3.6.1 生产建议执行仓**（当前真实建议） |
| `counterfactual_suggested_position` | `gen1_canary_suggested_position` | **Gen-1 反事实建议执行仓**（若允许 Gen-1，组合会变成什么） |

> ⚠️ **不是** `final_target` 对比。
> `final_target` 在 Canary 下**恒等于 V3.6.1 baseline**（这是硬不变量，见 `gen1-canary.js:118-120`），
> 用它做对比会永远得到「零差异」的假结论。
> 真正携带 Gen-1 信息量的是 **suggested_position**（建议执行仓），因为账本占用、组合 cap、
> S4 重跑后的真实分配，都落在这一列上。

**辅助列（不用于主判定，仅供归因）**：
- `gen1_counterfactual_suggested_position`（Gen-1 建议执行仓原始值）
- `gen1_counterfactual_delta`（目标层差值）
- `cfStep.baselineFloorBreached`（共享 cap 挤压导致的「反事实低于 baseline」）

---

## 2. 样本固定字段（17 列，逐日一行一码）

每个 **(date, code)** 组合产生一行。字段定义**逐字冻结**如下：

| # | 字段 | 类型 | 定义 / 来源 | 冻结口径 |
|---|---|---|---|---|
| 1 | `date` | date | 决策数据最新日 `decision_date`（`YYYY-MM-DD`，非 wall-clock 日） | 用 `decision_date`，**不用** `updated_at` |
| 2 | `code` | string | ETF 代码（513310 / 515880 / 159582 / 518880 / 159570） | 仅 Main5；510300 不入证据表 |
| 3 | `regime` | string | 市场态：牛市/熊市/震荡 | 复用 V3.6.1 当日 regime 判定 |
| 4 | `stage` | string | **V3.6.1 基线**趋势阶段（S1..S5），即 `trend_stage_primary` | 记**基线** stage，非 Gen-1 的 S4 |
| 5 | `domain_status` | string | Gen-1 域许可：`IN_DOMAIN` / `PARTIAL_COVERAGE` / `OUT_OF_DOMAIN` | 原样记 |
| 6 | `probability` | number | 模型校准概率 `calibrated_probability`（缺失回退 `ml_probability`） | 记 4 位小数；缺失记 `null` |
| 7 | `baseline_suggested_position` | number | V3.6.1 `suggested_position`（%） | 1 位小数 |
| 8 | `counterfactual_suggested_position` | number | Gen-1 反事实建议执行仓（%） | 1 位小数 |
| 9 | `delta_position` | number | `counterfactual − baseline`（百分点） | 1 位小数；**可为负**（cap 挤压） |
| 10 | `forward_5d` | number | 自 `date` 起第 5 个交易日**收盘价**收益率（%） | T+5 收盘 / T 收盘 − 1 |
| 11 | `forward_10d` | number | 同口径 T+10 | 同上 |
| 12 | `forward_20d` | number | 同口径 T+20 | 同上 |
| 13 | `MFE` | number | 持有窗口内**最大有利变动**（Max Favorable Excursion），窗口 = T+1..T+20（%），基于日内 或 收盘取一 —— **冻结：用收盘价** | 正数；方向按 delta 方向取有利侧 |
| 14 | `MAE` | number | 持有窗口内**最大不利变动**（Max Adverse Excursion），同窗口（%） | 负数；方向同上 |
| 15 | `false_fast_path` | boolean | `ml_fast=true` 但事后 T+5 收益为负 → `true`（假加速信号） | 依据 `forward_5d < 0` |
| 16 | `event_cluster_id` | string | 同一宏观/事件簇内的样本共享同一 ID（用于去相关） | 手工/半自动聚类；无事件记 `NONE` |
| 17 | `independent_event` | boolean | 本行是否为**独立事件**（同簇内首个为 `true`，重复为 `false`） | 独立性由 `event_cluster_id` 决定 |

### 2.1 方向约定（★ 极易错，冻结）

- `delta_position > 0` → Gen-1 建议**加仓**（相对 baseline）。
- `delta_position < 0` → Gen-1 建议**减仓**（共享 tech cap 挤压的必然结果，`baselineFloorBreached`）。
- **收益方向**：`forward_Nd` 与 **delta 的方向**对齐判断「对不对」——
  - Gen-1 加仓（`delta > 0`）且 `forward_Nd > 0` → ✅ Gen-1 对
  - Gen-1 加仓（`delta > 0`）且 `forward_Nd < 0` → ❌ Gen-1 错
  - Gen-1 减仓（`delta < 0`）且 `forward_Nd < 0` → ✅ Gen-1 对（躲跌）
  - Gen-1 减仓（`delta < 0`）且 `forward_Nd > 0` → ❌ Gen-1 错（踏空）

### 2.2 MFE / MAE 口径（★ 冻结）

- 窗口固定 = **T+1 .. T+20**（20 个交易日），不因 beta 结果缩短。
- 基准价 = T 日收盘价。
- `MFE = max(路径内最高收盘 / T 收盘 − 1)`，`MAE = min(路径内最低收盘 / T 收盘 − 1)`。
- 未满 20 个交易日的样本记 `null`，**不得**用现有天数凑近似值。
  （即：一个新样本满 20 个交易日后才「成熟」，成熟前 `forward_20d/MFE/MAE` 为 `null`。）

---

## 3. 样本纳入规则（冻结）

**纳入**：Canary 处于 `counterfactual_canary_active = true` 的**每个交易日**，对 Main5 的每个 code 产生一行。
无论该 code 当日是否为 Gen-1 Candidate（非 Candidate 时 `delta_position = 0`，仍如实入表——这些是**对照组**）。

**排除**（显式列出，防止事后挑样本）：
1. `counterfactual_canary_active = false` 的交易日 —— 说明当日通路未生效，不构成证据。
2. `gen1_health_gate_status != 'ACTIVE'` 的交易日 —— 健康闸未开，通路非正常态。
3. `gen1_counterfactual_ledger_ok != true` 的交易日 —— 账本异常，数据不可信。
4. `date` 缺失或 `baseline_suggested_position` 缺失的行。

> 排除规则的唯一目的是「样本必须是**通路正常态**下的观测」，**不是**为了事后剔除不利样本。
> 任何对本节的修改 = 契约版本升级 + 样本重算。

---

## 4. 判定问题（本契约要回答的三个问题，冻结）

| 编号 | 问题 | 判定指标 | 冻结阈值（**先于采样确定**） |
|---|---|---|---|
| **Q1** | Gen-1 建议是否**方向正确**？ | `hit_rate = 方向正确样本数 / (delta ≠ 0 的样本数)` | ≥ **55%** 且二项检验 p < 0.10 |
| **Q2** | Gen-1 是否**提升风险调整收益**？ | 按 delta 方向构造的组合，其 T+5/T+10/T+20 平均收益 vs baseline 的**增量** | 至少 T+10 或 T+20 显著 > 0 |
| **Q3** | Gen-1 是否**引入更多假信号**？ | `false_fast_path` 比例：Gen-1 侧 vs baseline 侧 | Gen-1 侧不得显著高于 baseline 侧 |

### 4.1 统计口径（冻结）

- **样本独立性**：Q1 的 p 值用 **独立事件** 计数（`independent_event = true` 的行），
  不用原始行数 —— 防止同一事件簇刷样本量。
- **最小样本量**：在 `independent_event = true` 的行数达到 **≥ 30** 之前，**不下任何结论**。
- **分域报告**：`domain_status` 分层报告（`IN_DOMAIN` / `PARTIAL_COVERAGE` / `OUT_OF_DOMAIN` 分开），不得混算。

### 4.2 三种终局（冻结）

| 终局 | 条件 | 动作 |
|---|---|---|
| **EVIDENCE_POSITIVE** | Q1 ∧ Q2 成立，Q3 不成立 | 可提案进入下一权限档评估（**仍需独立工作包**，本契约不授权直接上生产） |
| **EVIDENCE_NEGATIVE** | Q2 在 ≥ 30 独立事件后仍不成立 | Gen-1 归因为「无经济价值」，Canary 保持观察或回退 ADVISORY |
| **EVIDENCE_INCONCLUSIVE** | 样本不足 / 分域冲突 / 测量噪声过大 | 延长观察，**不得**以「还不够差」为由推进 |

> ★ **特别声明**：`EVIDENCE_POSITIVE` **不等于**可以直接上 `PRODUCTION`。
> 本契约只负责回答「有没有经济价值」；上生产的决策需要**另一份独立契约**，
> 且受 `gen1-authority.js` 的 `PRODUCTION_LOCKED` 硬边界约束。

---

## 5. 数据来源与采集路径（冻结）

| 数据 | 来源 | 采集方式 |
|---|---|---|
| 建议仓 / stage / probability / domain | `decision_result`（runDecisionEngine 产出） | 每日 EOD 跑完后读取 |
| 反事实建议仓 | `decision_result.gen1_canary_suggested_position` | 同上 |
| Canary 健康态 | `runtime_status`（`gen1_*` 字段） | 同上（用于样本纳入判定） |
| forward 收益 | `etf_daily`（official bars，`source != 'realtime'` 且 `volume > 0`） | 样本成熟后回填 |

**回填原则**：`forward_5d/10d/20d/MFE/MAE` 在样本成熟后**才**回填；
未成熟的行保持 `null`，**不得**用实时价或估算值填充。

---

## 6. 契约不可变性（★ 本契约的元规则）

1. 本文件 **v1.0 冻结后，字段名、字段定义、纳入/排除规则、判定阈值**不得修改。
2. 发现错误 → 发布 **v2.0**，并**显式作废 v1.0 的全部样本**，从 v2.0 生效日起重新累计。
3. 每次修改必须在下方「变更日志」留痕，写明**修改动机**与**是否作废既有样本**。
4. 采样进程与契约修改**不得由同一次决策同时触发** —— 防止「边看边改」。

### 变更日志

| 版本 | 日期 | 修改内容 | 是否作废既有样本 |
|---|---|---|---|
| v1.0 | 2026-09-10 | 首次冻结（WP-G1-EVIDENCE 启动） | —（尚无样本） |

---

## 7. 当前状态

- **样本累计**：0 行（`counterfactual_canary_invocations = 0`，尚无 S2 Candidate）
- **契约状态**：🔒 FROZEN
- **下一步**：等待第一个真实 Candidate 触发（见 `docs/gen1/GEN1_FIRST_LIVE_CANDIDATE_PROTOCOL.md`）

---

*本契约由 WP-G1-EVIDENCE 工作包冻结。任何修改须遵循第 6 节元规则。*
