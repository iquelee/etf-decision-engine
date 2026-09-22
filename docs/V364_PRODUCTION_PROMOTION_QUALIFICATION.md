# V3.6.4 Production Promotion Qualification

> **只读资格调查。** 未部署、未改线上 `param_config`、未改任何生产数据、未启用 Portfolio Mode、
> 未启用 V3.6.2 / V3.6.3、未补 SlowBreak 字段、未改 `breakout_nd`、未改 Market Regime、未改任何策略阈值。
> 审计分支：`audit/v364-production-promotion`（基于 master `519c3559…`，**不 merge**）
> 采集时间：2026-09-22 15:45 – 16:05 (GMT+8)

---

## ★ 机器可判定结论

```text
PROMOTION_GATE = PASS
UNEXPECTED_CHANGE = 0
```

**但 `PASS` ≠ 可部署。** 本报告 §8 给出一个必须先由人工裁定的**排序问题**（见「必读警示」）。

---

## 0. 必读警示（PASS 之外的三个事实）

1. **生产契约是退化的，且原因已确定**：产快照的云函数 `materializeIndicators`
   （部署 2026-09-08 11:35:24）内嵌的 `indicators.js` **不含** `breakout_nd`，
   而仓库与 2026-09-17 部署的 `runDecisionEngine` 包都含 ⇒ **`DEPLOYMENT_DRIFT`（唯一根因，已证）**。
2. **「修 drift」本身是行为变更**：反事实显示，把 `breakout_nd` 补回输入会让
   **19/600 个 target 单元变化、4/600 个 action 翻转、最大 Δtarget 18.5pp**（§7）。
   ⇒ **修 drift 不能当作「对齐」顺手做**，它需要独立的策略级授权。
3. **V3.6.4 在真实生产契约上与现行 V3.6.1 决策数值逐位相同**（§4），
   其**可观测收益是把「同一天重复运行」的漂移降到 0**（§5）—— 这是它相对 V3.6.1 的真实增量。

---

## 1. 事实基线

| 项 | 值 |
|---|---|
| master | `519c3559c9840fa954e3357d665635fd1f97648c` |
| NEW 基准 | **冻结 `aa634e264270f26207c59c19ef3e1c31dde01e64`**（tag `v3.6.4-frozen^{}`） |
| 现行生产 | V3.6.1；`runDecisionEngine` 线上包部署于 `2026-09-17 14:24:41` |
| 冻结前状态 | `V3.6.4 = FROZEN / MERGED / NOT_DEPLOYED` |
| CloudBase 写入 | **零**（本轮全部为只读调用） |

---

## 2. Gate P-A 摘要（完整见 `docs/V364_INDICATOR_PIPELINE_PROVENANCE.md`）

```text
ONLINE_PACKAGE_SHA = 9642cae255536f5ed1ac040d2891c6152ffba7c7f02fc3a859703ab2d7d44302
ONLINE_ENTRY_SHA   = 3f9b3e69c38e4676627f8be760cfafa9887fd9d601330ed334a88e1185aafa89
ONLINE_MODTIME     = 2026-09-08 11:35:24   (materializeIndicators)
REPO_REFERENCE_SHA = 519c3559c9840fa954e3357d665635fd1f97648c
MATCH_COUNT        = 2    (index.js, package.json)
ONLY_ONLINE        = 0
ONLY_REPO          = 63   (函数不打包的仓库文件，非 drift)
CONTENT_DIFF       = 9    (common/** 全部 9 个文件)
```

**字段集合四路闭合（实跑，非正则推断）**：`S_old=32`、`S_new=32`、`S_mi=31`、`S_db=31`、`S_harness=31`；
`S_old − S_mi = ['breakout_nd']`（唯一差异），`S_db == S_mi == S_harness`。

**根因分类**：

| 字段 | ROOT_CAUSE_CLASS |
|---|---|
| `breakout_nd` | **`DEPLOYMENT_DRIFT`** |
| `ma60_slope` / `high_point_falling` / `lower_high` / `higher_low` | **`NOT_COMPUTED`**（各 135/135 missing） |
| `ma20_slope` / `d_state` / `h_state` / `w_state` / `volume_ratio` | `PRESENT`（各 135/135） |

### Gateway A 语义（**保留，不得改写**）

```text
Gate A = PASS_SAFETY_ONLY
```
> lowerLow plumbing 修复在当前生产 indicator contract 下为零副作用；
> 由于 `ma60_slope` / `high_point_falling`(或 `lower_high`) 缺失，`SB>=75` 当前生产不可达；
> 因此 Gate A **不构成 SlowBreak 触发时机正确性的验证**。

FINDING-1 = **OPEN**（不得补字段、不得改 SlowBreak 阈值）。本报告**未**补任何字段。

---

## 3. Gate P-B 方法

### 3.1 OLD（现行生产 V3.6.1 语义）如何确定

**不用泛泛的旧 repo commit**，而是用**线上真实部署件**：

- 只读下载线上 `runDecisionEngine` 包（部署 `2026-09-17 14:24:41`，`CodeSha256 = a694b7d3…c3003608`），
  取其 `common/**` 作为 OLD 源码根。
- 该包与仓库 `master@650db58`（合并前基线）**66/66 文件字节一致**（R1 基线已核）⇒ 即生产语义。

**⚠️ 两处已声明的垫片（必须披露，否则「OLD 树」不可复现）**：

| 垫片文件 | 为什么需要 | 语义，以及为何与生产逐位一致 |
|---|---|---|
| `src/common/utils/swing-structure.js` | R1 期 harness `require` 它，而 **V3.6.1 生产树没有该文件** | 委托给**该树自己的** `trend-stage.swingHighLow` ⇒ 只返回 `{higherLow,lowerHigh}`，**无 `lowerLow` 属性** ⇒ 与历史生产（`lowerLow` 恒假）逐位一致 |
| `src/common/utils/trade-date-idempotence.js` | 同上；该文件是 R1 的**调用侧接缝**，生产当时不存在 | `planRunInput(state) → {engine_state: state, replaying:false}`（**直通**）、`finalizeState(x) → x`（**恒等**）⇒ 与生产 `p.position.trend_stage_state` 原样进出逐位一致 |

**垫片保真性已断言**（实测）：
`old swing 返回键 = ["higherLow","lowerHigh"]`、`lowerLow === undefined` ✓；
`planRunInput(st).engine_state === st` ✓；`finalizeState(rs) === rs` ✓。

### 3.2 NEW

冻结 `aa634e2`（`git archive` 取出 `src/common/**`，**未打任何补丁**）。

### 3.3 输入契约（Gate P-A 的成果，强制）

两个根**都**按线上 `indicator_snapshot` 的**真实 31 字段**裁剪快照再喂决策链。
实测两边 `dropped_example = ["breakout_nd"]`、`live_snapshot_fields = 31`
⇒ **没有偷偷使用仓库里线上并不存在的字段**。

### 3.4 规模与口径

- 共同交易日 **582** 天（`2024-04-16` ~ `2026-09-04`），**主 Gate 取最近 120 天** × **5 只 ETF**。
- **主 replay**：每日 1 次。**Same-Day Stress**：每日 3 次。
- 比较字段（14）：`trend_stage_primary` / `trend_stage_overlay` / `pendingStage` / `pendingDays` /
  `days_in_stage` / `soft_down_days` / `s5_risk_days` / `slow_break_score` / `slow_break_high` /
  `defense_score` / `defense_penalty` / `final_target` / `final_action` / `binding_constraint`。
  （`rho_avg` / `tech_cap` 见 §6。）

### 3.5 分类规则（**执行前声明**，见 `_v364-pb/pb-diff.js` 头注释）

- `INTENDED_CORRECTNESS_CHANGE`
  - **I1** 同日重复运行漂移（缺陷 #1）——仅体现在 `runsPerDay=3` 的**日内**比较，涉及
    `pendingDays`/`days_in_stage`/`soft_down_days`/`s5_risk_days`/`pendingStage`/`trend_stage_primary`/`trend_stage_overlay`/`final_target`/`final_action`。
  - **I2** SlowBreak 链 swing 修复（缺陷 #2）——`slow_break_score`/`slow_break_high`，
    以及**仅当同票同日 slow_break_* 同时变化时**的 `defense_score`/`defense_penalty`。
- `DIAGNOSTIC_ONLY` —— 只读诊断字段（本比较集内无）。
- `UNEXPECTED_CHANGE` —— 其余一切。

⛔ 规则已在执行前写入脚本并**未在事后修改**。

---

## 4. 主 replay 结果（120 日 × 5 票 × 14 字段）

```text
单元数        = 600  (120 日 × 5 票)
字段比对次数  = 600 × 14 = 8400
字段差异总数  = 0
按字段分布    = {}          ← 空
按分类        = {}          ← 空
Δtarget       : n=600  max_abs=0  mean=0  非零=0
action flip   = 0
```

⇒ **`UNEXPECTED_CHANGE = 0`，`VERDICT_MAIN = PASS`。**

**判读**：在**真实生产 input contract** 下，V3.6.4 与现行 V3.6.1 的**决策数值逐位相同**。
这与 Gate A 的 `PASS_SAFETY_ONLY`、以及 P-A 的「SlowBreak 四项输入只得其二」互相印证：
I2 类变化在本数据上**不可观测**（因为 `SB>=75` 不可达）。

---

## 5. Same-Day Stress（每日 3 次，逐日「第 1 次 vs 第 3 次」）

| | OLD（V3.6.1 生产语义） | NEW（冻结 V3.6.4） |
|---|---|---|
| 有日内漂移的天数 | **120 / 120**（**全部**） | **0 / 120** |
| 日内漂移条数 | **959** | **0** |
| `final_book`（3次/日 vs 1次/日） | **不相等**（重复运行真的改了仓位） | **相等** |
| `final_state`（3次/日 vs 1次/日） | 不等 | 不等 —— **但唯一差异键 = `idempotence_reason`**（`new_trade_date` → `same_trade_date_replay`，**纯审计字段**） |

OLD 的 959 条漂移分布（前几项）：

```text
days_in_stage 591 | trend_stage_primary 65 | pendingStage 58 | pendingDays 58
trend_stage_display 58 | final_target 23 | breakout_level 19 | trend_stage_overlay 13
soft_down_days 13 | s5_risk_days 13 | suggested_position 13 | final_action 12
opportunity_grade 11 | binding_constraint 10 | defense_score 2
```

**逐条结论**：

1. **缺陷 #1 在生产上是真实的且每天都发生**：`days_in_stage` 在 600 个单元里有 **591** 个会因同日多跑而增长
   （即「运行次数冒充交易日」），并连带影响 `final_target`(23) 与 `final_action`(12)。
2. **V3.6.4 的修复完全生效**：NEW 在 120/120 天上**日内零漂移**，且 `final_book` 与「一日一次」相等。
3. **无未解释 delta**：NEW 的 state 差异经逐键审计，全部落在 `idempotence_reason` 这一个审计字段上；
   9 个决策相关状态字段 × 5 票 = **45 项全部逐位一致**。
4. ⇒ 本项分类 = **`INTENDED_CORRECTNESS_CHANGE`（I1）**，且**证明修复真的产生了预期效果**，
   而不仅是「一日一次 replay 零差异」。

---

## 6. Correlation 口径变更（单独报告）

R1 把相关性从「按 returns 数组**下标配对**」改为「按 `trade_date` **INNER JOIN**」。
真实历史 582 日 + 最近 120 日对照：

| 指标 | 最近 120 日 | 全历史 582 日 |
|---|---|---|
| `rho_avg` 发生变化的天数 | **0** | **0** |
| `rho_avg` 最大绝对差 | 0 | 0 |
| 有效 `tech_cap` 发生变化的天数 | **0** | **0** |
| 有效 `tech_cap` 最大绝对差 | 0 | 0 |
| 判为样本不足的天数 | 0 | 10 |
| 存在「跨度不一致被丢弃」的天数 | 0 | 0 |
| 最小 `coverage_ratio` | 1 | 1 |

**日历分歧扫描**：三只科技 ETF 的并集共 **1696** 个交易日，
分歧日 **1114** 个 —— 但**全部发生在 159582 上市之前**（`diverging_after_all_present = 0`）；
自 `2024-04-16`（三者齐备）起，**日历从未分歧**。

**档位边界邻近度（风险面）**：最近 120 日中，`rho_avg` 落在
`0.65 ± 0.02` **14 天**、`0.75 ± 0.02` **2 天**、`0.85 ± 0.02` 0 天
⇒ 一旦真的出现缺日/错位，这些日期**有跨档可能**。

**合成缺日压力**（向 159582 注入 `2026-06-11` 缺失）：`rho_avg` 0.732 → **0.729**（Δ0.003），
`discount` 0.97 → 0.97，`tech_cap` 63.1 → 63.1（**Δcap = 0**）。
**真实缺日压力**（2024-04-15 159582 真实缺失）：`rho_avg` 0.656 → 0.656（Δ0），`tech_cap` 63.1 → 63.1。

> ### 结论必须按此措辞书写（不得简化成「没有变化」）
> ```text
> CORRECTNESS_CHANGE_PRESENT / CURRENT_REAL_DATA_DECISION_IMPACT_ZERO
> ```
> 即：**口径缺陷在代码层真实存在**（合成缺日压力已复现 `rho` 偏移），
> 但在**当前真实数据**上决策影响为 **0**（三只科技 ETF 日历自 2024-04-16 起从不分歧）。
> 残留风险：14 天落在 `0.65±0.02`、2 天落在 `0.75±0.02`。

---

## 7. `breakout_nd` 反事实（**隔离，不混入主 Gate**）

- **A = `CURRENT_PRODUCTION_CONTRACT`**（冻结 V3.6.4 代码 + 真实契约，`breakout_nd` 缺失）
- **B = `BREAKOUT_ND_RESTORED_COUNTERFACTUAL`**（**同一代码** + 把 `breakout_nd` 补回输入）

两者**仅**输入契约不同，故差异可全部归因于该字段。窗口 120 日 × 5 票。

| 指标 | A | B |
|---|---|---|
| `S4` 天数 | 16 | 16（Δ0） |
| `S3→S4` | 0 | 0 |
| `S4→S5` | 1 | 1 |
| `S4→S3` / `S5→S4` | 7 / 8 | 7 / 8 |
| `final_target` Δ：`max_abs` / `mean` / 非零单元 | — | **18.5pp** / 0.062 / **19 / 600** |
| `final_action` 翻转次数 | — | **4 / 600** |

翻转样例：

```text
2026-03-16  515880   HOLD → ADD             (target 15.9 → 17.1)
2026-03-20  515880   HOLD → TACTICAL_REDUCE (target 12.6 → 10.6)
2026-04-02  159570   WAIT → BUILD           (target 34 → 34)
2026-04-03  159570   BUILD → ADD            (target 34 → 30)
```

**判读（仅用于 FINDING-2 严重度）**：

- `breakout_nd` **不止用于 S4 判定**（`S4` 天数不变），它还参与建仓/加仓/机会分等路径
  （`decision.js` 首仓突破、`v3-2-math-engine.js`、`decision-v3.js` 共 17+ 处）。
- 当前生产**正在被抑制**掉这些路径：**3.2% 的 target 单元、0.67% 的 action 受影响**，
  单日最大 18.5pp。严重度 = **中等（可度量、非灾难性）**。
- ⛔ **不得**把本反事实当作 V3.6.4 的部署内容 —— 它是**独立的策略级变更**，
  需要自己的授权与回测（本报告不主张其「更好」）。

---

## 8. Gate 判定

### 8.1 PASS 条件逐条核对（任务书 §8）

| # | 条件 | 实测 | 判定 |
|---|---|---|---|
| 1 | P-A provenance root cause 全部确定 | `breakout_nd`=`DEPLOYMENT_DRIFT` 唯一；`ma60_slope`/`high_point_falling`/`lower_high`=NOT_COMPUTED | ✅ |
| 2 | OLD baseline 确认为当前真实生产语义 | 线上 `runDecisionEngine` 包（2026-09-17）`common/**` + 2 个已声明垫片（保真性已断言） | ✅ |
| 3 | NEW 固定为 frozen `aa634e2` | `git archive aa634e2 src/common`，**零补丁** | ✅ |
| 4 | 主 120D × 5 ETF replay `UNEXPECTED_CHANGE = 0` | 8400 次比对，差异 **0** | ✅ |
| 5 | same-day stress 变化全部属于预期 correctness fix | OLD 959 条漂移 → NEW 0；分类全为 I1 | ✅ |
| 6 | 不存在未解释 decision delta | NEW state 差异唯一键 = `idempotence_reason`（审计字段）；45/45 决策字段一致 | ✅ |
| 7 | frozen files / V361 / GEN1 locks 均未改 | 5 项哈希逐位比对全 PASS（见下） | ✅ |
| 8 | CloudBase 未发生写操作 | 本轮仅 `getFunctionDetail` / `getFunctionDownloadUrl` / `readNoSqlDatabaseContent` | ✅ |

条件 7 实测哈希：

```text
V361_IMMUTABLE_LOCK.json          = 1c724381e533dd51e4fd0268bdc14aca0b4f444a458eab6c75c97be78a78f1bd
GEN1_FEATURE_PIPELINE_LOCK.json   = 8efdda6fadb7da409c4d6215851495cf63dec4904a371d3bf5fff82008a2b7ad
src/common/utils/decision-v3.js   = 677fd675cc48f079e551ea28200ecda5f9398c7566e2b1dcad60b8a6f4200393
src/common/utils/decision.js      = 0a05fe7f0d6cc169ffe35ba51a9e35524e2bd5d8b1c95ac270ccf53f86b4681a
src/common/utils/trend-stage.js   = 3eba412a950cc278be504ab68d7039ecfc5daf2c147d2eb2b500997560fae412
V364_IMMUTABLE_LOCK.json status   = FROZEN（frozen_invariants_all_pass = true）
```

### 8.2 判定

```text
PROMOTION_GATE = PASS
```

**理由**：八项 PASS 条件全部满足；`UNEXPECTED_CHANGE = 0`；
不存在无法确定的关键事实（P-A 四个根因全部确定，无 `BLOCKED_ON_EVIDENCE` 项）。

### 8.3 ⛔ `PASS` 不构成部署授权

```text
PRODUCTION PROMOTION AUTHORIZATION = NOT GRANTED
```

且存在一个**必须先裁定**的排序问题：

> **P-A 发现生产产生侧是漂移的。若先部署 V3.6.4 而不修 `materializeIndicators` 的漂移**，
> 得到的是「与现行 V3.6.1 决策数值完全相同 + 同日幂等修复 + 一组只读诊断」；
> **若同时或先行部署（重建）`materializeIndicators`**，则 `breakout_nd` 回归，
> **决策会按 §7 的量级改变（4 次 action 翻转 / 最大 18.5pp）** —— 那是**策略级变更**，
> 不属于 V3.6.4 的 correctness 范围。
>
> ⇒ 建议把「V3.6.4 晋升」与「`breakout_nd` 漂移修复」**拆成两个独立授权**，不得合并执行。

---

## 9. 诚实边界（不能主张的事）

1. **只核验了 2 个云函数**（`runDecisionEngine`、`materializeIndicators`）；其余 9 个函数线上包未对账。
2. `materializeIndicators` 的 `common/**` 9/11 与仓库不同，**本报告只对 `indicator_snapshot` 写入链路做了因果证明**；
   其余 8 个文件（`db.js` / `decision.js` / `constants.js` / `schema.js` / `datasource.js` / `fetch-guard.js` /
   `live-asset.js` / `pnl.js`）的差异影响**未评估**。
3. OLD 根有**两个已声明垫片**（§3.1），其行为已断言等价于生产，但「OLD 根」并非字节级纯生产制品。
4. 重放 harness 本身是 V3.6.4 期编写的**工具**；它已按生产 31 字段裁剪输入（`dropped=["breakout_nd"]`），
   但它对 `position`/`fundamental`/`risk` 使用常量（`FUNDAMENTAL_CONST = F3/15`、`RISK_CONST = NORMAL`），
   两个变体使用**同一常量** ⇒ **不影响 OLD/NEW 差异结论**，但不代表真实资金/真实基本面路径。
5. 账面从 0 自洽滚动，未注入真实持仓。
6. `premium_rate` 未注入（无历史实时数据）⇒ 溢价分档按缺失处理。
7. 反事实（§7）**不主张**「补回更好」，只量化影响量级。
8. 本报告**不构成**收益/风险改善证据。

---

## 10. 证据索引

| 路径 | 内容 |
|---|---|
| `docs/V364_INDICATOR_PIPELINE_PROVENANCE.md` | Gate P-A 完整报告（含方法学自纠） |
| `docs/governance/GOVERNANCE_INCIDENTS.md` | GI-001 治理事件登记 |
| `_v364-pa-baseline/` | 线上 mI 包 + `parity_final.json` + `field_sets.json` |
| `_v364-pb/old-r1.json` / `new-r1.json` | 主 replay 原始结果（OLD / NEW，582 日） |
| `_v364-pb/old-r3.json` / `new-r3.json` | 同日压力原始结果（3 次/日） |
| `_v364-pb/new-bnd-r1.json` | `breakout_nd` 反事实重放 |
| `_v364-pb/pb-diff.json` | 主 replay + 同日压力的分类结果（机器可判定） |
| `_v364-pb/cf-breakout-nd.json` | 反事实结果 |
| `_v364-pb/keys-{old,new,mi}.json` | 三个源码根 `computeSnapshot` 的实跑键集合 |
| `_v364-pb/pb-driver.js` / `pb-diff.js` / `cf-diff.js` / `state-audit.js` / `probe-keys.js` | 可复跑脚本 |
