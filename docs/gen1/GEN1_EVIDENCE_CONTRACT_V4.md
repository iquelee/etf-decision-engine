# Gen-1 Evidence Contract v4.0（证据契约 · 正式草案）

**文档编号**：`WP-G1-EVIDENCE-CH-4.0`
**版本**：v4.0 **DRAFT**
**状态**：⛔ **DRAFT — NOT FROZEN — NOT AUTHORIZED FOR EXECUTION**
**取代关系（拟）**：**v4.0 拟取代 v3.0**；v3.0 既有样本**显式作废**（实测 = **0 行** ⇒ 成本为零）。
⛔ 本文件当前为 **DRAFT**：**取代仅在 STEP 4 FREEZE 授权后生效**。
**as-of**：2026-09-23（北京时间）
**授权依据**：owner 2026-09-23 裁定 —— **STEP 3 生成已授权**（本 PR）；**STEP 4 冻结 NOT YET AUTHORIZED**。
「生成」与「冻结」是两个分开的授权步骤，⛔ 不得合并。
**生成自**：`outputs/evidence-watch-20260921/V2_PREREGISTRATION_PROPOSAL_20260921.md`（v0.3，`ede8bdfd…042d`）+ `V2_FREEZE_READINESS_ADDENDUM_v0.4_20260921.md`（v0.4 FINAL，`e6570e6f…a294`）
**生成源**：`bb720ff32aa814833db81e8e322ede788ffa8561`（v4.0 生成轮基线 `origin/master`）
**前序冻结源**：v2.0 = `24677422`；v3.0 = `650db586`（git blob id `574112f433b9a9691aa8d728e45a3f2aeb931699`）

```text
V4.0 CONTRACT GENERATION      ✅ DONE（本文件，DRAFT）
V4.0 CONTRACT FREEZE          ⛔ NOT YET（STEP 4 未授权）
EVIDENCE EXECUTION            ⛔ NOT YET
HISTORICAL BACKFILL           ⛔ PROHIBITED
GE-04                         ⛔ NOT AUTHORIZED
```

> ⛔ **本文件当前为 DRAFT，不得被当作执行契约使用**。在 STEP 4 单独授权冻结之前，
> 本文件仅为文本草案。⛔ 不得据此启动样本累计、不得据此改 Seal、不得据此改 Authority。
> 冻结指纹将记于 **PR body 与独立 attestation 工件**，⛔ **不写入本文件**（避免自指矛盾）。

---

## 0. 本文件做什么，以及**不**做什么

**做**：定义「Gen-1 反事实建议是否具有经济价值」这一问句的**可复核、可证伪、不可事后修改**的度量口径 v4.0。

**不做**：
- ❌ 不修改 `GEN1_EVIDENCE_CONTRACT.md`（v1.0）**任何一个字节**。
- ❌ 不授权 `PRODUCTION` 档位（该档位继续永久不可达）。
- ❌ 不授权 `GUARDED_EFFECTIVE`（三钥匙与运行时叠加门另行约束）。
- ❌ 不改变「人工执行」与「自动交易关闭」。
- ❌ 不触碰 `ml/gen2/**` 与其冻结证据。
- ❌ **不解除** `Gen-1 → final_target` 的禁令：Gen-1 只提 Timing 提案，最终仓位**始终**由 V3.6.1 Safety Core 计算。

---

## 1. 与 v1.0 的关系

### 1.1 v1.0 的状态变更

| 项 | 处置 |
|---|---|
| `GEN1_EVIDENCE_CONTRACT.md`（v1.0） | **暂停作为正式采样执行契约**；⛔ **不删除、不修改、不否定其历史价值** |
| v1.0 既有样本 | **显式作废**。实测 v1.0 样本数 = **0** ⇒ 作废成本为零，但**声明必须保留** |
| **本文件 v4.0（拟）** | 自**冻结后首个交易日**起取代 v1.0 作为正式执行契约。
（v2.0 / v3.0 为**中间版本**，均**未采样** ⇒ 无样本作废成本；见 §11 变更日志） |

### 1.2 `CD-01` —— v1.0 的实质性缺陷（本文件的 remedy）

**缺陷**：v1.0 §1 把主比较列绑定到 `decision_result.gen1_canary_suggested_position`，
但 v1.0 §3 又强制要求「非 Candidate 也入样，`delta_position = 0`，作为对照组」。
而该字段在非 Candidate 日**构造性为 `null`** ⇒ **主列在对照组行上无定义**，v1.0 不可执行。

**代码级证明**（`src/common/utils/gen1-canary.js`）：
- L80 `let canarySuggested = null;` / L84 `if (canaryAllowed) {` / L92 `canarySuggested = pct(out.suggested_position);` / L116 `gen1_canary_suggested_position: canarySuggested`
  ⇒ 非 Candidate ⇒ `null`（构造性）。实读 **0 / 130**。
- L255–L256 `intendedTarget = canaryEffective ? canaryTarget : baselineTarget`；`suggested = canaryEffective ? canarySuggested : baselineSuggested`
  ⇒ 非 Candidate 日**回落 baseline**，天然产出 `delta = 0` 对照组。实读 **35 行**。

**登记**：`CD-01`（`CONTRACT SEMANTIC DEFECT`），**remedy = 本文件**（自 v2.0 起，v4.0 沿用）。
✅ **`CD-01` 已 CLOSED** —— 关闭条件 =「**v2.0 真正冻结**」，该条件已于 **2026-09-21 满足**（见 §11 变更日志）。
⛔ 该关闭是**历史事实**：⛔ 不得因本文件（v4.0）尚为 DRAFT 而把 `CD-01` 回退为 `OPEN`。

---

### 1.3 `CD-02` —— `regime` 源绑定缺陷（v4.0 的 remedy）

**缺陷**：v3.0 §3 字段 3 把 `regime` 绑到 `portfolio_snapshot.market_regime`，
但该字段是 **legacy 推导**（`deriveMarketRegime()`，V2.1 指数周线打分），
**不是生产决策实际消费的 regime**（V3 环境引擎 `v3MarketEnv.market_regime`）。

**生产侧源码注释自登记**（`runDecisionEngine/index.js:1097-1099`，V3.6.1 R1 只读诊断「缺陷 #7」）：

```text
事实：决策路径用 v3MarketEnv.market_regime（V3 环境引擎，runV3Path 时写回 portfolio），
     而本快照写入的是 freshPortfolio.market_regime = deriveMarketRegime()（V2.1 指数周线打分）。
两条路径来源不同 ⇒ 同一天会有两个「市场环境」。
```

**实测**（as-of 2026-09-23，18 个可比日期）：

```text
11 / 18 出现 source divergence
这 11 个 divergence 均表现为：decision regime = crisis，legacy snapshot regime = range / defensive
⇒ 在该观察窗口内存在明确的「legacy snapshot 对 crisis 的低估方向性」。
⛔ 不外推为所有市场阶段的永久系统偏差。
```

**登记**：`CD-02`（`CONTRACT SOURCE BINDING DEFECT`），**remedy = 本文件（v4.0）**，**OPEN UNTIL V4 FREEZE**。
⛔ 在 v4.0 真正冻结前，`CD-02` 保持 **OPEN**。

---

## 2. 核心对比对象（唯一主对比）

| 列 | 来源 | 含义 |
|---|---|---|
| `baseline_suggested_position` | `decision_result.suggested_position` | **V3.6.1 生产建议执行仓** |
| **`counterfactual_suggested_position`** | **`decision_result.gen1_counterfactual_suggested_position`** | **完整组合账本（组合 cap 后）的反事实建议执行仓** |

**理由（代码级）**：
1. `gen1-canary.js:274` `counterfactualSuggestedPosition: suggested`，注释 L273 明示「本轮组合约束后的**建议执行仓**（账本按它占用；与生产同口径）」。
2. 非 Candidate 日回落 baseline（L256）⇒ **天然产出对照组**，与 §4 自洽。
3. 若绑 `gen1_canary_suggested_position`，对照组行全部为 `null` ⇒ §4 不可执行。

### 2.1 `candidate_only_aux`（正式定名）

```text
gen1_canary_suggested_position  →  candidate_only_aux
```
- 语义：**仅**回答「当 Candidate 真正触发时，单只 Gen-1 S4 rerun 给出了什么建议」。
- ⛔ **不参与 Evidence 主评分**（不进 Q1/Q2/Q3、不计入 ≥30）。

### 2.2 辅助列（不用于主判定，仅供归因）

`gen1_counterfactual_target`、`gen1_counterfactual_delta`、`gen1_counterfactual_baseline_floor_breached`、`gen1_counterfactual_clamped`。

### 2.3 ⛔ 三条禁止

1. ⛔ 禁止「主列取 `candidate_only_aux`、`null` 时回退账本字段」的**隐式 fallback**（两套口径混算）。
2. ⛔ 禁止继续把 `gen1_canary_suggested_position` 标为**主列来源**。
3. ⛔ 禁止把两条列**混入 Q1/Q2/Q3**。

> ⚠️ 本条**改变了 v1.0 §1 的主列数据源** ⇒ 属 v1.0 §6 元规则下的实质性修正 ⇒ 已由 **v2.0** 发布（历史事实）。
> 本文件（v4.0）**沿用**该绑定，⛔ 不重新开启该修正。

---

## 3. 样本字段（17 列，逐日一行一码）

每个 **(date, code)** 组合产生一行。字段定义沿用 v1.0 §2（**逐字不变**），并新增**来源精确绑定**：

| # | 字段 | 类型 | 定义 / 来源 | 冻结口径 |
|---|---|---|---|---|
| 1 | `date` | date | `decision_result.decision_date`（**数据最新日**，非运行日） | ⛔ 不用 `updated_at` |
| 2 | `code` | string | Main5：513310 / 515880 / 159582 / 518880 / 159570 | 仅 Main5；510300 不入表 |
| 3 | `regime` | string | **`portfolio_snapshot.decision_market_regime`**（见 §3.1，v4.0 改绑） | ⛔ 不得由 Gen-1 signal lane 推导 |
| 4 | `stage` | string | **V3.6.1 baseline stage**，优先绑 `decision_result.v361_baseline_stage` | ⛔ **不是** Gen-1 signal stage |
| 5 | `domain_status` | string | 同 `(date, code)` 的 `ml_shadow_signal.domain_status` | **仅作模型适用域描述** |
| 6 | `probability` | number | 同 `(date, code)` 的 `ml_shadow_signal.calibrated_probability`；缺失按冻结规则取 `ml_probability` | 4 位小数；缺失记 `null` |
| 7 | `baseline_suggested_position` | number | `decision_result.suggested_position`（%） | 1 位小数 |
| 8 | `counterfactual_suggested_position` | number | `decision_result.gen1_counterfactual_suggested_position`（%） | 1 位小数 |
| 9 | `delta_position` | number | `counterfactual − baseline`（百分点） | 1 位小数；**可为负** |
| 10 | `forward_5d` | number | 自 `date` 起第 5 个交易日**收盘价**收益率（%） | T+5 收盘 / T 收盘 − 1 |
| 11 | `forward_10d` | number | 同口径 T+10 | 同上 |
| 12 | `forward_20d` | number | 同口径 T+20 | 同上 |
| 13 | `MFE` | number | 窗口 T+1..T+20 最大有利变动（%），**用收盘价** | 正数；方向按 delta 方向取有利侧 |
| 14 | `MAE` | number | 同窗口最大不利变动（%） | 负数；方向同上 |
| 15 | `false_fast_path` | boolean | `ml_fast = true` 但事后 T+5 收益为负 | 依据 `forward_5d < 0` |
| 16 | `event_cluster_id` | string | 同一事件簇共享 ID（**计算规则见 §3.4**） | 无事件记 `NONE` |
| 17 | `independent_event` | boolean | **同簇内首个 Candidate 行**为 `true`（**计算规则见 §3.4**） | 对照行**恒 false** |

### 3.1 ★ `regime` 精确绑定 + **双日期双组**（v4.0 改绑为 `decision_market_regime`）

```text
Evidence.date
= decision_result.decision_date            （数据最新正式交易日）

Evidence.regime
= portfolio_snapshot.decision_market_regime
  where portfolio_snapshot.snapshot_date
        == runtime_status.decision_date
  from the same accepted C-1 capture bundle

★ v4.0 改绑理由：decision_market_regime 的语义即
  「R1 决策路径实际使用的 regime」（schema.js 正式登记），
  且其生成代码已封装好条件分支，Evidence 层⛔ 不得复制生产 regime 选择逻辑。
```

**代码依据**：
- `runDecisionEngine/index.js:1000` `const snapshotDate = new Date(Date.now() + 8*3600*1000).toISOString().slice(0,10);`
- `index.js:997-998` 注释：「`snapshot_date` 统一用「今天」（北京时间，组合快照时刻），**与 `decision_result.decision_date`（数据最新日）语义分离**，避免快照日期分裂。」
- `index.js:1264` / `:1272` `decision_date: snapshotDate`（`runtime_status`）；`index.js:1050` `snapshot_date: snapshotDate`；`index.js:1064` `market_regime: freshPortfolio.market_regime`
- `schema.js:235` `market_regime`（`aggressive/structural/range/defensive/crisis`）
- `index.js:1103-1105`（v4.0 新增依据）`const decisionRegime = (trendStageEnabled && v3MarketEnv && v3MarketEnv.market_regime) ? v3MarketEnv.market_regime : (portfolio ? portfolio.market_regime : null);`
- `schema.js:240` `decision_market_regime`：「R1 决策路径实际使用的 regime（与 market_regime 并列对照）」
- `index.js:1116` `decision_market_regime: diff.decision_regime`；`:1117` `market_regime_divergent`；`:1118` `market_regime_sources`

**双日期双组（必须显式建模）**：

```text
组 A —— 运行日 (RUN DATE)
    runtime_status.decision_date
    portfolio_snapshot.snapshot_date
    → 二者必须相等

组 B —— 数据日 (DATA DATE)
    decision_result.decision_date
    ml_shadow_signal.date
    → 二者必须相等

⛔ 组 A ≠ 组 B 是正常态，不得断言四者全等。
```

**实测印证**（as-of 2026-09-21）：组 A = `2026-09-21` / `2026-09-21`；组 B = `2026-09-18` / `2026-09-18`；组 A ≠ 组 B。

**★ 来源层级（v4.0 定，⛔ 不得替代）**：

| 字段 | 定位 |
|---|---|
| `portfolio_snapshot.decision_market_regime` | ✅ **AUTHORITATIVE EVIDENCE REGIME（唯一主来源）** |
| `portfolio_snapshot.market_regime` | ⚠️ **legacy_snapshot_regime / DIAGNOSTIC ONLY** —— ⛔ 不得用于分层、分域、判定 |
| `decision_result.effective_market_regime` | ⚠️ **downstream sizing diagnostic** —— ⛔ 不作来源 |
| `ml_shadow_signal.market_regime` | ⛔ 不作来源（lane-local，见 §9.3） |

**⛔ 不要求 `effective_market_regime` 与 `decision_market_regime` 相等**（v4.0 明确）：

```text
v3-bull-participation.js:115-128  resolveEffectiveRegime(baseRegime, bullScore, portfolio)
  if (base === 'crisis' || base === 'defensive') {
    if (bullScore >= BULL_TIER.recovery) return 'recovery';   ← 合法分歧
    return base;
  }
⇒ base = crisis/defensive 时，sizing 层可合法产出 effective = 'recovery'
⇒ 二者合法情况下就可能不同
```

⚠️ **故 ⛔ 不得把「二者相等」写成硬 Gate** —— 那会在走到相应 engine path 时
把**正常 bundle 误杀**为 `REGIME_PROVENANCE_MISMATCH`（与「四日期全等」同类错误）。
`market_regime_divergent` 继续作为 `decision_market_regime` vs `legacy market_regime` 的**诊断指标**，
⛔ 不据此另造第二套硬 Gate。

### 3.2 方向约定（沿用 v1.0，冻结）

- `delta_position > 0` → Gen-1 建议**加仓**；`< 0` → **减仓**。
- 收益方向与 **delta 方向**对齐判断「对不对」：
  - 加仓且 `forward_Nd > 0` → ✅ 对；加仓且 `< 0` → ❌ 错
  - 减仓且 `forward_Nd < 0` → ✅ 对（躲跌）；减仓且 `> 0` → ❌ 错（踏空）

### 3.3 MFE / MAE 口径（沿用 v1.0，冻结）

- 窗口固定 **T+1 .. T+20**（20 个交易日），不因 beta 结果缩短。
- 基准价 = T 日收盘价。
- `MFE = max(路径内最高收盘 / T 收盘 − 1)`；`MAE = min(路径内最低收盘 / T 收盘 − 1)`。
- 未满 20 个交易日记 `null`，⛔ **不得**用现有天数凑近似值。

### 3.4 ★ `event_cluster_id` 与 `independent_event` 的计算规则（v3.0 新增并冻结；**v4.0 沿用，⛔ 未改**）

**规则 = C-B（时间维去相关）+ 混合标记**：

```text
CLUSTER_GAP_DAYS = 10

① event_cluster_id —— 对**全表**（Candidate 行 + 对照行）计算：
   同一 code 按 date 升序；与同 code 上一条样本的间隔 ≤ CLUSTER_GAP_DAYS 天
   ⇒ 归入同一簇；否则开新簇。
   ⛔ 不对「同一交易日的不同 code」做合并（见下方「已知局限」）。

② independent_event —— 只有 **Candidate 行**可能为 true：
   每一簇内，**首个 `delta_position != 0` 的行**标记 `independent_event = true`；
   该簇内其余行一律 false。
   若某簇内**无** Candidate 行 ⇒ 全簇 `independent_event = false`。

③ 对照行取值：
   event_cluster_id  —— 正常参与聚类（用于界定簇边界）
   independent_event —— **恒 false**
```

**为何这样定（决策依据）**：

1. §7.1 规定 `independent_event` 是 Q1 p 值的**计数单位** ⇒ 计数单位必须是**有信息量的观测**；
   只有 `delta_position != 0` 的行才可能「对 / 错」。
2. §4.1 的对照组是为**比较**（Q2 / Q3）而存在，**不是**为「证明 Gen-1 有价值」提供独立证据。
3. ⛔ 若允许对照行为 `true` ⇒ `independent_events >= 30` 可在**零真实 Candidate**时达成
   ⇒ 该成熟度门槛将**不度量任何东西**（是「每行独立」失效模式的变体）。
4. ⛔ 若只用 Candidate 行聚类 ⇒ 当前 Candidate = 0 时**无法界定任何簇边界**。

**已知局限（必须随每次报告显式声明）**：本规则**未建模同一交易日跨 code 的相关性**。
同一交易日 5 只 code 受**同一市场环境**驱动，可能被计为多个独立事件 ⇒ 报告的独立性**偏乐观**。
⛔ 不得把结论表述为「已充分独立」。

**⚠️ 由此得出的重要性质（必须与结论同读）**：
本规则下 `independent_events` 的增长**完全取决于真实 Candidate 的出现频率** ——
对照行不贡献、无 Candidate 的簇不贡献。
⇒ 在真实 Candidate 出现之前，`independent_events` **恒为 0**，⛔ 不得据此推断「接近门槛」。


---

## 4. 样本纳入与排除规则（**E1 — DAILY FULL-SAMPLE**）

### 4.1 纳入

```text
Canary 处于 counterfactual_canary_active = true 的每个合格交易日，
对 Main5 的每个 code 产生一行。

Candidate 与 non-Candidate 都入样；
non-Candidate 为 control（delta_position = 0）。
```

**合格交易日** = 满足本节纳入规则 ∧ 未触发 §4.2 排除规则 ∧ **通过 §5 的 Bundle Coherence Gate**。

**Candidate 与否的判定**：⛔ **单独由冻结 Candidate 条件决定**；⛔ **不得**用 `probability` 是否 `null` 反推。

### 4.2 排除（显式列出，防事后挑样本）

1. `counterfactual_canary_active = false` 的交易日。
2. `gen1_health_gate_status != 'ACTIVE'` 的交易日。
3. `gen1_counterfactual_ledger_ok != true` 的交易日。
4. `date` 缺失或 `baseline_suggested_position` 缺失的行。
5. **§5.2 `PROVENANCE_MISSING`** 或 **§5.4 `BUNDLE_INVALID`** 的交易日。

> 排除规则的唯一目的是「样本必须是**通路正常态**下的观测」，**不是**为了事后剔除不利样本。
> 任何对本节的修改 = 契约版本升级 + 样本重算。

### 4.3 与里程碑协议的关系（澄清 v1.0 的四处表述冲突）

`GEN1_FIRST_LIVE_CANDIDATE_PROTOCOL.md` §2 M5 与 `GEN1_DAILY_PRODUCTION_WATCH.md` §3.1 M5 所称
「证据表**第一条真实样本**」，**正解为**：

> **第一条 `delta != 0` 的真实 Candidate 样本 / 首个 Candidate 里程碑样本**

⛔ **不是**「Evidence 表从零开始的第一行」。里程碑协议只负责**捕获首次触发**，**不得**反写样本总体规则。

---

## 5. 每日 eligibility provenance 与 capture bundle

### 5.1 采用 C-1：EXTERNAL READ-ONLY DAILY SNAPSHOT

**性质**：Evidence 工作包**本地/归档**写入，⛔ **不是生产 DB 写入**；⛔ **不改生产语义**。

| 方案 | 处置 |
|---|---|
| **C-1 外部只读日快照** | ✅ **采用** |
| C-2 生产侧新增逐日行 | ⛔ `NOT AUTHORIZED` |
| C-3 代理判据 | ⛔ **REJECTED** —— 代理字段**不能**证明 `active` / `ledger_ok` |

**缺口依据（实测）**：`gen1_counterfactual_canary_active` 与 `gen1_counterfactual_ledger_ok`
**仅存于 `runtime_status` 覆盖式单例**，`decision_result` **逐日不留存** ⇒ 无法回溯。

### 5.2 硬规则一：缺当日快照 ⇒ 当日不可作为正式样本（fail-closed）

```text
PROVENANCE_MISSING
→ FAIL-CLOSED
→ NON-SCORING
→ NO RETROACTIVE RECONSTRUCTION
```
⛔ **不得**第二天用 `runtime_status` singleton 倒填。⛔ **不得**用今日状态倒推过去。

### 5.3 硬规则二：每日 capture bundle（append-only，**五源**）

```text
decision_date
capture_timestamp
runtime_status.updated_at

gen1_authority
gen1_counterfactual_canary_active
gen1_health_status
gen1_health_gate_status
gen1_counterfactual_ledger_ok
gen1_production_write
gen1_auto_execution

raw runtime_status SHA256
raw decision_result SHA256
raw ml_shadow_signal SHA256
raw portfolio_snapshot SHA256
raw invocation log record SHA256
```

> `portfolio_snapshot` 为**独立集合**（`src/common/constants.js:25`），每日一行，可独立取 SHA256。
> `invocation log` 经 `tcb logs search` 取得（见 §5.6）。

### 5.4 硬规则三：`BUNDLE COHERENCE GATE`

```text
1. runtime_status 必须是本 checkpoint 前最新自然运行
2. runtime_status.updated_at 必须较上一有效 bundle 前进（首个 bundle 见 §5.7）
3. decision_result 必须恰有 Main5 五个 code
4. 五行 decision_result.decision_date 必须完全相同          （组 B）
5. ml_shadow_signal.date 必须等于该 decision_date            （组 B）
6. ml_shadow_signal 必须覆盖同一 Main5 code set
7. portfolio_snapshot.snapshot_date
   必须等于 runtime_status.decision_date                     （组 A）
8. 任一 source 缺失 / 日期不一致 / code set 不完整
   → BUNDLE_INVALID → NON-SCORING → NO RETROACTIVE RECONSTRUCTION
9. 同一 decision_date 最多一个正式 Evidence bundle
   后续自然 rerun 不得覆盖已接受 bundle
```

⚠️ **实施注意**：规则 4/5 属**组 B**，规则 7 属**组 A**；
⛔ **不得**写成「四个日期全等」—— 那会**误杀每一个 bundle**（§3.1 实测：`09-21` vs `09-18`）。

✅ **只读 dry-run 验证（2026-09-21）**：9 条 gate 对当日实时抓取 **9 / 9 PASS，零误杀**；
双日期双组与实读一致。报告：`outputs/evidence-watch-20260921/C8_COHERENCE_GATE_DRYRUN_20260921.md`。

### 5.5 硬规则四：one-decision-date / one-official-bundle

```text
同一 decision_date  →  至多一个正式 Evidence bundle
后续自然 rerun      →  ⛔ 不得覆盖已接受 bundle
```
**理由**：一天可能存在**不止一个自然运行窗口**（历史上已有 W1/W2 归属不可判定问题）。
契约必须**提前**决定哪一次 capture 有资格成为当天唯一正式样本，⛔ **不得**事后挑选更好看的结果。

### 5.6 硬规则五：`NATURAL_RUN_PROVENANCE`（含 CHAIN PROOF）

```text
NATURAL_RUN_PROVENANCE

必须来自外部只读取证
通道 = tcb logs search（调用日志）+ tcb fn detail（trigger metadata）
不得从 runtime_status 自行推断

至少证明：
- runDecisionEngine invocation timestamp
- request_id
- request_source（本跳与上游跳分别记录）
- 与预先冻结 natural pipeline / window 的对应关系
- capture checkpoint 在该 invocation 完成之后
```

**CHAIN PROOF（必要，因 `runDecisionEngine` 无 trigger）**：

```text
1. 上游 materializeIndicators 存在 request_source == TRIGGER_TIMER 的调用
2. 上游 START 与下游 START 均落在同一个 CANONICAL_CAPTURE_CHECKPOINT 窗口内
3. 下游 runDecisionEngine 的完成时刻与 runtime_status.updated_at 匹配
4. ⛔ 不对两跳做严格先后序约束
```

**为什么禁止严格序**：SCF 日志 `timestamp` 是**日志刷写时刻**，不是**执行完成时刻**。
实测：下游 START `08:00:28.102` **早于**上游 END `08:00:30.339` 约 **2.24s**（刷写延迟）
⇒ 任何基于 END 日志时刻的序规则都是脆弱的。

**实测锚点（可复算，as-of 2026-09-21）**：

| 跳 | 函数 | `request_id` | 时刻（+08） | `request_source` |
|---|---|---|---|---|
| 1 | `materializeIndicators` | `9ef2cab0-493d-4f7e-9944-8588fc9ddc99` | START 08:00:09.877 → END 08:00:30.339 | `TRIGGER_TIMER` |
| 2 | `runDecisionEngine` | `e3ff52a1-911a-4cba-a11c-89f8b5d9fabd` | START 08:00:28.102 → Report 08:00:36.871 | `TCB_API` |

`runtime_status.updated_at = 2026-09-21T00:00:36.719Z` = `08:00:36.719` ⇒ 与第 2 跳同一次调用。

**⛔ 关键禁令**：⛔ **不得**要求 `runDecisionEngine` 自身 `request_source == TRIGGER_TIMER`
—— 其 `Triggers = 0`，自然调用**必然**表现为 `TCB_API`；该规则会 **100% 误杀每一次自然运行**。

**trigger 实读**：`materializeIndicators` = `dailyPipeline-0800`（timer，Enable=1）；`runGen1ShadowEod` = `gen1-eod-weekdays-2220`（timer）；`runDecisionEngine` = 无。

**`request_source` 观测取值域**（7d，10,797 条；⛔ 不主张为全域）：
`TRIGGER_TIMER` 7,325 / `TCB_GW` 1,520 / `""` 877 / `TCB_API` 75。

**失败路径**：

```text
无法证明来源
  → RUN_PROVENANCE_UNVERIFIED
  → BUNDLE_INVALID
  → NON-SCORING
```

### 5.7 硬规则六：FIRST BUNDLE 例外

```text
FIRST OFFICIAL BUNDLE:
previous_valid_bundle = NONE
→ updated_at advancement comparison = NOT_APPLICABLE
→ 其余 coherence gates 仍须全部 PASS

SECOND AND LATER:
runtime_status.updated_at
> previous_valid_bundle.runtime_status.updated_at
```

### 5.8 `CANONICAL_CAPTURE_CHECKPOINT`

```text
CANONICAL_CAPTURE_CHECKPOINT
= 工作日 09:00（北京时间）
= 固定的 post-natural-run checkpoint
```

**定值依据（2026-09-21 云端只读实测）**：

| 函数 | cron（实读 `TriggerDesc`） | 含义 |
|---|---|---|
| `materializeIndicators` | `0 0 8 * * 1-5 *` | **08:00，周一–周五** |
| `runGen1ShadowEod` | `0 20 22 * * 1-5 *` | 22:20，周一–周五 |

- 自然运行完成时刻观测为 **08:00:36**（`runDecisionEngine` 写 `runtime_status`）⇒ `09:00` 留约 **24 分钟**余量。
- `09:00` 在 **09:30 开盘前** ⇒ 四源数据态静止（无盘中写）。
- `runtime_status` 的**唯一写入方** = `runDecisionEngine`（`index.js:1267`）；`runGen1ShadowEod` **不写** `runtime_status`
  ⇒ 08:00–09:00 窗口内无其他写入者。
- ⛔ 窗口内允许的跨度**不得**事后放宽（取点即当次 checkpoint，**不设宽窗**）。
- ⚠️ 本时点为**草案级裁定**（owner 可覆盖）；**一经冻结即成为永久统计口径**。

---

## 6. 判定问题（Q1 / Q2 / Q3，沿用 v1.0，冻结）

| 编号 | 问题 | 判定指标 | 冻结阈值 |
|---|---|---|---|
| **Q1** | Gen-1 建议是否**方向正确**？ | `hit_rate = 方向正确样本数 / (delta ≠ 0 的样本数)` | ≥ **55%** 且二项检验 p < 0.10 |
| **Q2** | 是否**提升风险调整收益**？ | 按 delta 方向构造组合，其 T+5/T+10/T+20 平均收益 vs baseline 的**增量** | 至少 T+10 或 T+20 显著 > 0 |
| **Q3** | 是否**引入更多假信号**？ | `false_fast_path` 比例：Gen-1 侧 vs baseline 侧 | Gen-1 侧不得显著高于 baseline 侧 |

---

## 7. 统计口径（冻结）

### 7.1 样本独立性与最小样本量

- Q1 的 p 值用 **独立事件**计数（`independent_event = true`），⛔ 不用原始行数。
  （独立性判定规则见 **§3.4**，v3.0 冻结。）
- 在 `independent_event = true` 的行数达到 **≥ 30** 之前，**不下任何结论**。
- 分域报告：`domain_status` 分层（`IN_DOMAIN` / `PARTIAL_COVERAGE` / `OUT_OF_DOMAIN`）**不得混算**。

### 7.2 ★ 三层分母（⛔ 不混线）

| 层级 | 说明 |
|---|---|
| 原始 observation 行 | 每个合格交易日 × 5 |
| `independent_event = true` 行 | 须经 `event_cluster_id` 去相关；**必然 ≤ 原始行数** |
| **Q1 有信息量的样本** | `delta_position != 0` 的样本 |

### 7.3 ★ 防误读条款

```text
≥30 independent events
= Evidence Gate 的必要成熟条件
≠ Q1 自动可判定

Q1 denominator
= independent_event = true AND delta_position != 0
```

---

## 8. 三种终局（沿用 v1.0，冻结）

| 终局 | 条件 | 动作 |
|---|---|---|
| **EVIDENCE_POSITIVE** | Q1 ∧ Q2 成立，Q3 不成立 | 可提案进入下一权限档评估（**仍需独立工作包**，本契约不授权直接上生产） |
| **EVIDENCE_NEGATIVE** | Q2 在 ≥ 30 独立事件后仍不成立 | Gen-1 归因为「无经济价值」，Canary 保持观察或回退 ADVISORY |
| **EVIDENCE_INCONCLUSIVE** | 样本不足 / 分域冲突 / 测量噪声过大 | 延长观察，⛔ **不得**以「还不够差」为由推进 |

> ★ **特别声明**：`EVIDENCE_POSITIVE` **不等于**可以直接上 `PRODUCTION`。
> 上生产需**另一份独立契约** + owner 授权，且受 `gen1-authority.js` 的 `PRODUCTION_LOCKED` 硬边界约束。

---

## 9. 数据来源与采集路径

### 9.1 来源表

| 数据 | 来源 | 采集方式 |
|---|---|---|
| 建议仓 / stage / probability / domain | `decision_result` | 每日 EOD 后读取 |
| 反事实建议仓 | `decision_result.gen1_counterfactual_suggested_position` | 同上 |
| `regime` | **`portfolio_snapshot.decision_market_regime`**（经 §3.1 关联；v4.0 改绑） | 同上 |
| Canary 健康态 / eligibility | `runtime_status`（**当日**快照，见 §5） | 同上 |
| 调用来源 | `tcb logs search`（调用日志） | 同上 |
| forward 收益 | `etf_daily`（official bars，`source != 'realtime'` 且 `volume > 0`） | 样本成熟后回填 |

### 9.2 回填原则

`forward_5d/10d/20d/MFE/MAE` 在样本**成熟后**才回填；未成熟行保持 `null`，
⛔ **不得**用实时价或估算值填充。

### 9.3 ⛔ 禁止用作生产资格证据的字段

```text
ml_shadow_signal.gen1_authority      ⛔ 不得用于证明生产资格
ml_shadow_signal.canary_allowed      ⛔ 不得用于证明生产资格
```

**定性（已代码核实）**：`ml_shadow_signal.gen1_authority = ADVISORY` 而生产链 = `CANARY`，
原因是 shadow lane 调用 `resolveAuthority({ml_shadow_observe, ml_advisory_enabled, ml_fast_path_enabled})`
**不传** `gen1_authority`（`runGen1ShadowEod/index.js:166`），源码默认值即 `ADVISORY`
（`gen1-authority.js:69` / `:110`；`tests/gen1-authority.test.js:19-20` 断言默认必须为 `ADVISORY`）；
生产链则 `resolveAuthority(merged)`（`runDecisionEngine/index.js:560`）⇒ `CANARY`。

```text
CLASSIFICATION: LANE-LOCAL DEFAULT METADATA / BY CURRENT DESIGN
                NOT PRODUCTION AUTHORITY / NOT PRODUCTION DRIFT
STATUS:         PRE-EXISTING SEMANTIC DEBT
                NON-BLOCKING IF EXCLUDED FROM V2 ELIGIBILITY
```

> 同行的 `domain_status` / `calibrated_probability` / `ml_fast` / `stage` **仍可**作为**模型 signal 数据**使用。
> ⛔ 不要把「模型输入快照」与「生产 Authority 真相」混成一层。

---

## 10. 生效日（V2-D）

```text
v4.0 FREEZE
    ↓
冻结后的**首个交易日**
    ↓
正式 scoring sample 起算
```

`2026-09-10 … 2026-09-18` 的最多 **35 行**只能标记为：

```text
PRE-V2 DIAGNOSTIC / NON-SCORING / NON-GATE
```
⛔ 不得进入 Q1/Q2/Q3；⛔ 不得贡献 ≥30；⛔ **HISTORICAL BACKFILL = PROHIBITED**。

**理由**：09-21 时点部分历史 forward outcome **已开始可见**；在看到结果后重定义数据源再回填历史，
**会破坏「冻结在先、采样在后」的 pre-registration 原则**。

---

## 11. 契约不可变性（元规则）

1. 本文件**冻结后**，字段名、字段定义、纳入/排除规则、判定阈值**不得修改**。
2. 发现错误 → 发布 **v5.0**，并**显式作废 v4.0 全部样本**，从新版本生效日起重新累计。
3. 每次修改必须在变更日志留痕，写明**修改动机**与**是否作废既有样本**。
4. 采样进程与契约修改**不得由同一次决策同时触发**。

### 变更日志

| 版本 | 日期 | 修改内容 | 是否作废既有样本 |
|---|---|---|---|
| v1.0 | 2026-09-10 | 首次冻结（WP-G1-EVIDENCE 启动） | — |
| **v2.0** | 2026-09-21 | ① 主列改绑 `gen1_counterfactual_suggested_position`（修 `CD-01`）；② 引入 E1 daily full-sample；③ 引入 C-1 provenance + 五源 bundle + coherence gate；④ `regime` 精确绑定 + 双日期双组；⑤ 引入 `NATURAL_RUN_PROVENANCE`（CHAIN PROOF）；⑥ 新增 `≥30 ≠ Q1 可判定` 防误读条款 | **是** —— 显式作废 v1.0 全部样本（实测 = **0 行**） |
| v2.0-draft rev.1 | 2026-09-21 | 闭合冻结前置：① `CANONICAL_CAPTURE_CHECKPOINT` 定为**工作日 09:00（北京）**（依 cron 实测）；② C-1 归档落点/命名与 append-only 规则定稿；③ 多 capture 冲突定为「**先到先得 + 后到 NON-SCORING**」；④ 补记 coherence gate 只读 dry-run 验证（**9/9 PASS**） | **否**（草案修订；未冻结、未采样） |
| **v2.0 FROZEN** | 2026-09-21 | 冻结（**仅**状态头 / §12 / 变更日志；⛔ 未改字段名、字段定义、纳入排除规则、判定阈值） | **否**（仍未采样） |
| **v3.0** | 2026-09-21 | **补 §3.4**：钉死 `event_cluster_id` / `independent_event` 的计算规则（C-B 时间维去相关 + 混合标记）。
动机：v2.0 §3 字段 16/17 未规定计算方法 ⇒ §7.1 的「≥30」门槛**不可机械判定**。 | **是** —— 显式作废 v2.0 全部样本（实测 = **0 行**） |
| **v4.0**（DRAFT） | 2026-09-23 | ① §3 字段 3 与 §3.1 的 `regime` **改绑** `portfolio_snapshot.decision_market_regime`（修 **`CD-02`**）；
② 定来源层级：`market_regime` 降为 legacy 诊断列、`effective_market_regime` 为 downstream 诊断（⛔ 均不得作来源）；
③ **明确 ⛔ 不要求 `effective_market_regime` 与主来源相等**（避免误杀）。
动机：v3.0 的 `regime` 绑到 legacy 字段，非决策实际所见。 | **是**（拟） —— 作废 v3.0 全部样本（实测 = **0 行**） |

---

## 12. 未决项（★ 冻结前必须闭合）

| # | 事项 | 状态 |
|---|---|---|
| 1 | **本文件（v4.0）冻结授权** | ⛔ **NOT YET** —— STEP 4 须单独授权（⛔ 不与「生成」合并） |
| 2 | `CANONICAL_CAPTURE_CHECKPOINT` 具体时点 | ✅ **已裁定 = 工作日 09:00（北京）** —— 依据见 §5.8 |
| 3 | C-1 归档的**具体落点与命名** | ✅ **已裁定**：仓库外 `_evidence-capture-YYYYMMDD/`；`<decision_date>__bundle.json` + `<decision_date>__bundle.sha256`；同名已存在 ⇒ **拒绝写入**（append-only，⛔ 不覆盖） |
| 4 | C-1 自动化 | ⛔ **当前不授权创建任务**；顺序 = 先手工/半自动跑通 **≥3 个交易日** ⇒ 验证 gate 不误杀 ⇒ 再议 automation |
| 5 | `E28` / `E29` 登记 | ✅ **已完成** —— 见 `GEN1_DOC_ERRATA_20260916.md`（随 PR #48 合入） |
| 6 | `CD-01` 关闭条件 | ✅ **已 CLOSED** —— 条件「v2.0 真正冻结」已于 **2026-09-21** 满足 |
| 7 | 同一 `decision_date` 出现多个 capture 的冲突处置 | ✅ **已裁定**：**先到先得**（首个通过 coherence gate 者为准）；后到者 `BUNDLE_INVALID / NON-SCORING`，⛔ 不得覆盖已接受 bundle |
| 8 | ⚠️ **冻结是否伴随 git commit** | ✅ **已裁定：是** —— owner 授权走 git commit + PR；载体分支自 `origin/master` 开出 |
| 9 | 本文件 activation-ready 状态 | ❌ **NOT YET** —— 第 1 项（v4.0 冻结）未闭合 |

---

## 13. 边界声明与不授权声明

**生成轮（2026-09-23，v4.0）仅做**：从 v3.0 派生 → 改绑 `regime` → 登记 `CD-02` → 清理 v2/v3 stale wording。
⛔ 未改任何**其他**字段/阈值/纳入规则；⛔ 未启动样本累计；⛔ 未改 Seal / Authority；⛔ 未冻结。

**前序轮（2026-09-21，v2.0/v3.0）未做**：

- ⛔ 未修改 `GEN1_EVIDENCE_CONTRACT.md`（v1.0）任何字节
- ⛔ 未冻结 v2.0、未启动任何样本累计
- ⛔ 未改 Seal（Freeze / Evidence 均仍 `PENDING`）
- ⛔ 未回补历史样本、未部署、未改 Authority、未建 automation
- ⛔ 未人工调用云函数、未碰 Gen-2、未进 GE-04
- ✅ **已 commit** —— 冻结轮经 git commit + PR 落盘（§12 第 8 项已闭合）

**⛔ 本文件不授权任何生产变更**；`gen1_authority` 保持 `CANARY`。
**⛔ 本文件不解除** `Gen-1 → final_target` 的禁令。

---

*本契约由 `WP-G1-EVIDENCE` 工作包 v4.0 草案生成。任何修改须遵循 §11 元规则。*
*落盘：`docs/gen1/GEN1_EVIDENCE_CONTRACT_V4.md`（**⛔ v4.0 DRAFT — NOT FROZEN**）*
