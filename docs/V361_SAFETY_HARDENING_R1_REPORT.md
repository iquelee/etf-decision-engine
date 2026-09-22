# V3.6.1 Safety Hardening R1 —— 交付报告

- 报告日期：2026-09-22
- 分支：`feat/v361-safety-hardening-r1`（基于 `origin/master` = `650db58639f32232ac72a99920060dd92e743621`）
- 本地提交：见本分支 HEAD（**仅本地提交，未 push、未建 PR、未部署**）
- 范围：**第一阶段 Correctness Hardening**（不做策略优化，不升版）
- 铁律遵守：未部署 · 未改线上 param_config · 未改 chase/StageFactor/MarketFactor/Opportunity/仓位上限 · 未开启 V3.6.2 / V3.6.3 · 未让 Gen-1/Gen-2 获得 `final_target` / `final_action` 写权限

---

## 0. 一句话结论

**9 项 correctness 问题已全部处理，其中 7 项为「零决策影响的修复 + 只读诊断」，1 项是任务书明确要求的决策路径行为变化（SlowBreak 链），1 项（组合轨）经 Replay 证明不能当作 correctness 修复直接晋升。**

过程中触发**两条冻结红线**，据此调整了实现路径：所有修复均落在**未上锁**的工件上，两个受锁文件（`trend-stage.js` / `decision-v3.js` / `decision.js`）**逐位未改动**（有测试守卫）。

---

## 1. 线上 SHA 对账状态

采集时间 2026-09-22 11:06–11:10（GMT+8），只读：CloudBase `queryFunctions.getFunctionDetail` / `getFunctionDownloadUrl` + 本地 `sha256`。

| 输出项 | 值 |
|---|---|
| **ONLINE_SHA**（包，API 返回 `CodeSha256`） | `a694b7d3d6bad410ca5f0c25304ba13fcdf9801c79f86d7f99b1bb0bc3003608` |
| **ONLINE_SHA**（本地下载 zip 重算） | `a694b7d3d6bad410ca5f0c25304ba13fcdf9801c79f86d7f99b1bb0bc3003608`（与 API 一致） |
| **ONLINE_SHA**（`runDecisionEngine/index.js`） | `da4910cae28476e6…` |
| 线上 `ModTime` | **2026-09-17 14:24:41** |
| **REPO_BASE_SHA** | `650db58639f32232ac72a99920060dd92e743621`（`origin/master`） |
| 本地 `master` | `2e24ecd6ba5fa1d21b2c6337e24f6aa09c2a1781`（落后 2 个 commit，均为 docs/scripts，无 `src/` 与 `cloudfunctions/` 变更） |
| **SOURCE_PARITY** | **MATCH —— 66 / 66 文件字节级一致**（排除 `node_modules` / `config.json` / 2 个 Gen-1 封印 JSON） |
| **DIFF_STATUS** | `NO_SOURCE_DIFF`（ONLY_ONLINE 0 / ONLY_REPO 0 / CONTENT_DIFF 0） |

**线上字节级核验已真实完成**（不是用 GitHub master 冒充）：下载的 zip 经解压后逐文件比对，`index.js` / `common/constants.js` / `common/schema.js` / `trend-stage.js` / `correlation.js` / `decision-v3.js` / `v3-6-stage-persistence.js` / `defense.js` / `market-regime.js` / `v3-shadow.js` / `decision.js` / `market-env-v3.js` 全部一致。

### ⚠️ 登记冲突 E1：`docs/主链冻结契约.md` 的线上记录已过期

| 来源 | 记录 |
|---|---|
| `docs/主链冻结契约.md` | `runDecisionEngine` SHA256 = `7876610f…82e6315d`，部署时间 **2026-09-05 14:01** |
| 本次实时只读 | 包 SHA256 = `a694b7d3…`，`ModTime` = **2026-09-17 14:24:41** |

原因可从提交史复原：2026-09-17 PR #47（`ge03-shadow-guarded-rerun`）合并后于当日 14:24 重新部署，包级 SHA 随之变化。**包级 SHA 不具可比性**（含 `node_modules` / `config.json`，同一源码可产出不同 zip 字节），因此本次以**源码逐文件对账**为准。

**处理方式：登记冲突，不自行修改契约文档**（改冻结文档属另一类问题、需单独放行）。

---

## 2. 发现的问题（含过程中触发的冻结红线）

### 2.0 ★ 红线 A：`decision-v3.js` 不可修改，且**不得静默改旧版**

`ml/manifests/V361_IMMUTABLE_LOCK.json` 钉死 `decision-v3.js` / `decision.js` 的 SHA256，规则原文：

> V3.6.1 生产决策核心（decision-v3.js / decision.js）不可修改；**任何挑战须升版（V3.6.2+），不得静默改旧版。**

### 2.1 ★ 红线 B：`trend-stage.js` 是 Gen-1 冻结工件

`ml/manifests/GEN1_FEATURE_PIPELINE_LOCK.json` 把 `src/common/utils/trend-stage.js` 列为 `role = trend_stage_implementation`，规则原文：

> Gen-1 特征管线冻结：任何 role 文件变更（指标/阶段/PARAMS/特征构建/RS20/schema/sector 映射/数据健康/域策略）都必须**显式更新本锁并走审批**；不得静默修改。

**首次实现时我直接改了这两个文件，两条门禁当场转红并被我复现：**

```
verify-immutable  → FAIL src/common/utils/decision-v3.js vs V361_IMMUTABLE_LOCK.json.decision_v3_sha256   (exit=1)
verify-gen1-pipeline → FAIL gen1-pipeline/trend_stage_implementation
                              expected 3eba412a950cc278…  got e0123ebf39d864f5…                          (exit=1)
```

**处置：立即 `git checkout --` 回退这两个文件，改走未上锁接缝重做，并加入守卫测试（`#2.4` / `#2.5`）确保以后不会再被改动。** 修复后两条锁恢复 **23/23** 与 **10/10 全绿**。

> 这同时说明一件事：**任务书里「改 trend-stage 的 pendingDays 计数」与「禁止升版 / 禁止改冻结件」在仓库自定契约下是互斥的**。本轮按「不碰冻结件」优先，用等价机制达成语义（见 §3 问题 1）。

### 问题清单

| # | 位置 | 问题（本期核实） | 本期处置 |
|---|---|---|---|
| 1 | `trend-stage.applyHysteresis` + `v3-6-stage-persistence` | `pendingDays` / `days_in_stage` / `soft_down_days` / `s5_risk_days` 均按**函数调用次数**推进；同一 `calc_date` 重跑即被算作新交易日 | ✅ 语义已修复（落点改为未上锁侧，见 §3） |
| 2 | `trend-stage.swingHighLow` / `v3-6-stage-persistence.swingHighLow` | **两份副本**，且都只返回 `higherLow` / `lowerHigh`；`v3-shadow.appendSlowBreakHistory()` 读 `swing.lowerLow`（恒 `undefined`）⇒ `defense.isSlowBreakHigh()` **永远 false** ⇒ DefenseScore 的 +20 SlowBreak bonus **永不触发** | ✅ 建立唯一实现 `swing-structure.js`（4 字段）；生产 SlowBreak 链改从唯一实现取数；`v3-6-stage-persistence` 的副本已删；`trend-stage` 的副本因红线 B 保留（见 §7 风险 R1） |
| 3 | `decision-v3.isV3PortfolioMode` ← `runDecisionEngine.getPortfolioSummary` | `getPortfolioSummary()` **从不返回** `multi_etf` / `etf_count` ⇒ 5 只 ETF 的组合实际一直跑**单票轨** | ✅ 只读诊断 3 字段 + Replay；**未**改生产行为（见 §3 问题 3 与 §6 Replay 结论） |
| 4 | `correlation.js` | `returnsFromBars()` 丢弃 `trade_date`，`calcCorrelation()` 按**数组下标尾部配对** ⇒ 任一 ETF 缺一个交易日即整体错位 | ✅ 改为 `{trade_date → return}` + **INNER JOIN** + **跨度一致**校验；诊断字段齐备、样本不足显式暴露 |
| 5 | `runDecisionEngine` 主循环 | 每只 ETF 各自取 `getLatestSnapshot()`，**无任何机制**保证 5 张快照属于同一应到交易日 | ✅ 新增 `V361RunContext`（含 `input_hash` 与 freshness policy 代码化）；本轮只构建与诊断 |
| 6 | `runDecisionEngine` 终局 | 部分 ETF 落库、部分失败后函数**仍可能返回 `ok:true`**，`PARTIAL` 与 `COMPLETE` 在返回值上无区别 | ✅ 新增 `classifyRunFinality`（COMPLETE/PARTIAL/FAILED + 计数 + `failed_codes` + **不同健康语义**）+ 两阶段发布方案（纯函数，未接生产写入） |
| 7 | `runDecisionEngine` 行 526–529 / 1047 / 1064 | 决策用 `v3MarketEnv.market_regime`，而 `portfolio_snapshot.market_regime` 写的是另一套算法 `deriveMarketRegime()`（V2.1 指数周线打分）⇒ **决策 Regime ≠ 快照 Regime**；且 `market-regime.js` 的 `indexStates.length >= 5` 在线上 `market_env` 只有 **3** 行（000300 / 000688 / 399006，已只读核实）时 **恒不可达** | ✅ 只读诊断 + 单一 `MarketEnvironment` 改造方案；**未**改阈值、**未**改写入值 |
| 8 | `getPortfolioSummary` | `cash_ratio = max(0, 100 - total_position)` 把负现金夹成 0，Safety Core 看不到 `book > 100%` | ✅ 新增 `cash_ratio_raw` / `leverage_excess` / `overbooked`；`cash_ratio` 保持 clamp 值不变 |
| 9 | 负向约束 | 需回归守卫，防止本轮或后续把 6.2/6.3 打开或改冻结参数 | ✅ 6 条负向守卫测试 |

---

## 3. 修改文件

### 3.1 新增（10 个，全部纯函数 / 只读）

| 文件 | 作用 |
|---|---|
| `src/common/utils/swing-structure.js` | ★ **Swing Structure 唯一实现**，返回 `higherHigh` / `higherLow` / `lowerHigh` / `lowerLow` + `computable` |
| `src/common/utils/trade-date-progress.js` | 交易日锚点工具（`advanceDailyCounter` / `resolveTradeDate`） |
| `src/common/utils/trade-date-idempotence.js` | ★ **同一交易日幂等**（`planRunInput` / `finalizeState`），缺陷 #1 的实际落点 |
| `src/common/utils/portfolio-mode.js` | 组合轨判定唯一实现 + 只读诊断 `diagnoseV3PortfolioMode` |
| `src/common/utils/portfolio-cash.js` | 真实现金 / 隐性杠杆诊断 |
| `src/common/utils/market-env-diagnostics.js` | Regime 分歧诊断 + W5 闸可达性 + 单一 `MarketEnvironment` 构造 |
| `src/common/utils/v361-run-context.js` | ★ `V361RunContext` 输入信封 + freshness policy + `input_hash` |
| `src/common/utils/v361-run-finality.js` | ★ Run Finality（COMPLETE/PARTIAL/FAILED）+ 两阶段发布方案 |
| `scripts/v361-r1-replay-portfolio-mode.js` | Portfolio Mode Replay（只读） |
| `scripts/v361-r1-replay-correlation.js` | 相关性口径 Replay（只读） |

### 3.2 修改（7 个 tracked 文件，**无一个是受锁文件**）

| 文件 | 改动 | 是否影响决策数值 |
|---|---|---|
| `src/common/utils/correlation.js` | 重写为按 `trade_date` INNER JOIN + 跨度校验；保留 `computeTechCorrelationLegacy` 供对照 | 口径已换；**真实数据上结果与旧口径零差异**（§6） |
| `src/common/utils/v3-6-stage-persistence.js` | ① 删除本地 swing 副本，改 require 唯一实现；② `days_in_stage` / `soft_down_days` / `s5_risk_days` 加交易日锚点 | 单日单次运行**逐字段不变**；仅同日重跑变化 |
| `src/common/utils/defense.js` | 改从 `swing-structure` 取 swing（不再经 `trend-stage` 转发） | 否 |
| `src/common/utils/market-regime.js` | `checkCrisisHardTrigger` 增加 `index_state_count` / `w5_majority_gate_reachable` 诊断；`resolveMarketEnvironment` 增加 `index_w_states` | 否（阈值字面量仍是 `5`，逻辑等价） |
| `src/common/schema.js` | 登记 R1 新增字段（`portfolio_snapshot` 8 项 + `trend_stage_state` 1 项），纯登记 | 否 |
| `cloudfunctions/runDecisionEngine/index.js` | ① `getPortfolioSummary` 增加现金/组合轨诊断；② 接入交易日幂等；③ SlowBreak swing 改从唯一实现取数；④ 写入 regime 诊断 | **仅 SlowBreak 一项**（见下） |
| `scripts/test-all.js` | 修复 `(r.stderr + r.stdout)` 在 spawn 失败时 `null + null === 0` 引发的 `TypeError` → 门禁从「整体崩溃」改为「逐项 FAIL + 原因」 | 否（测试入口健壮性） |

### 3.3 ✅ 未改动（受冻结锁保护，逐位一致，有测试守卫）

`src/common/utils/trend-stage.js` · `src/common/utils/decision-v3.js` · `src/common/utils/decision.js` · `cloudfunctions/runGen1ShadowEod/*` · `ml/manifests/*`

---

## 4. 新增测试

两个**专门的 V3.6.1 Hardening 测试文件**（不依赖现有 `tests/decision.test.js`）：

| 文件 | 用例数 | 覆盖 |
|---|---|---|
| `tests/v361-safety-hardening.test.js` | **39** | #1（9 例）· #2（9 例）· #4（5 例）· #7（6 例）· #8（4 例）· #9（6 例） |
| `tests/v361-run-envelope-finality.test.js` | **19** | #5（11 例）· #6（8 例） |
| **合计** | **58** | 两个文件均 **0 failed** |

重点用例（对应任务书逐条要求）：

- `#1.1` 同一 `trade_date` 连续三次调用 → `pendingDays` 恒为 1；第二个 `trade_date` 才推进
- `#1.2` 三日降级必须来自三个不同 `trade_date`
- `#1.3` `days_in_stage` 只按唯一交易日增加
- `#1.4` `s5_risk_confirm_days=2`，同一天两次运行**不降级**
- `#1.7` **幂等等价**：一天跑 N 次后的按日状态 == 一天跑 1 次
- `#1.8` `day_start_state` 只落白名单字段，不嵌套膨胀
- `#2.1` 下降高点 + 下降低点 → `lowerHigh=true` 且 `lowerLow=true`
- `#2.2` `v3-6-stage-persistence` 与唯一实现是**同一个函数引用**（禁止复制）
- `#2.7` 过去 5 日中 3 日 `score>=75` + `LH` + `LL` → `isSlowBreakHigh() === true`
- `#2.8` DefenseScore 的 **+20 SlowBreak bonus 真正触发**（差分恰好 = 20）
- `#2.4` / `#2.5` ★ **冻结工件逐位未改动**（对锁文件 SHA 复算）
- `#4.1` 其中一只 ETF 缺一个交易日 → 新口径 ρ 仍为 1，**旧口径被污染**（反证）
- `#4.3` 样本不足显式 `insufficient_sample=true` 且 `rho=null`（不隐藏）
- `#4.4` 缺 `trade_date` 时**不回退按下标配对**，显式失败
- `#5.2` / `#5.3` 快照不同日 / 缺快照 → `BLOCKED` 且定位到 code
- `#5.4` Global signal 滞后 1 天不 stale（**不要求机械同日**）；基本面 365 天 → stale（optional）
- `#5.9` `input_hash` 与键顺序无关、与内容有关
- `#6.3` **PARTIAL 与 COMPLETE 健康语义必须不同**
- `#8.1` `total_position=106` → `cash_ratio_raw=-6` / `leverage_excess=6` / `overbooked=true`
- `#9.1`~`#9.6` 禁止开启 6.2/6.3 · 因子表数值冻结 · 新模块不得写 `final_target`/`final_action` · 诊断字段不得反向驱动决策

---

## 5. 行为是否变化

### 5.1 逐项判定

| 项 | 行为变化 | 说明 |
|---|---|---|
| 决策参数（StageFactor / MarketFactor / Opportunity / chase / 步长 / single cap / tech cap / cash floor） | **零变化** | 数值未改，有守卫测试 `#9.3` / `#9.4` |
| `v3_6_1_enabled` 总闸 / 6.2 / 6.3 | **零变化** | 6.2 / 6.3 仍被强制 `false`（`#9.1`） |
| 引擎路径选择（V3.5-D / V3.2Math / V3.3 / V3.4） | **零变化** | `isV3PortfolioMode` 行为未变；组合轨仍为 `false` |
| 受锁文件（`trend-stage` / `decision-v3` / `decision`） | **零变化** | 逐位一致（`#2.4` / `#2.5`） |
| Market Regime 打分与阈值 | **零变化** | 只加诊断字段；W5 闸阈值字面量仍为 5 |
| 现金口径 `cash_ratio`（clamp 后） | **零变化** | 新增的是 `cash_ratio_raw` 等并行字段 |
| 相关性口径 | **口径已换，同日结果不变** | 见 §6.2：真实数据 120 日 + 全历史 582 日 **0 差异** |
| 交易日计数（单日单次运行） | **零变化** | 新交易日走「非重放」路径，逐字段等价；仅**同日重跑**变化（这才是修复目标） |
| 交易日计数（同日重跑） | **有意变化** | 这正是缺陷 #1 的修复语义 |
| **SlowBreak 链 / DefenseScore** | ⚠️ **变化（任务书明确要求）** | 见 §5.2 |
| 落库字段集 | **新增字段** | `trend_stage_state` 增加 `last_evaluated_trade_date` / `day_start_state` / `trade_date_anchored` / `idempotence_reason`；`portfolio_snapshot` 增加 8 个诊断字段（均已在 `schema.js` 登记） |

### 5.2 ⚠️ 唯一一项决策路径行为变化：SlowBreak +20

修复前 `swing.lowerLow` 恒为 `undefined` ⇒ `appendSlowBreakHistory()` 写入的行里 `lowerLow` 恒为 `false` ⇒ `isSlowBreakHigh()` **永远 false**。

修复后 `lowerLow` 为真实布尔值 ⇒ 当「过去 5 日中 ≥3 日同时满足 `SlowBreak >= 75` **且** `LH` **且** `LL`」时，`isSlowBreakHigh()` 变为 `true` ⇒ **DefenseScore +20** ⇒ 经 `getDefensePenalty()` 影响目标仓位。

**这是本轮唯一会改变生产决策数值的改动，且是任务书第 2 条明确要求的**（"并验证 DefenseScore 的 +20 SlowBreak bonus 真正触发"）。为避免它被静默夹带，此处单列：

- 触发条件严格（需连续 5 日窗口内 3 日同时满足三项），只在真实下跌结构中成立；
- 生效是**渐进**的：数据库里历史行的 `lowerLow` 已固化为 `false`，需新增运行逐步替换窗口（最多 5 次运行）；
- **建议**：合入后观察首个出现 `slow_break_high=true` 的交易日，人工核对一次 DefenseScore 与 target 变化，再决定是否保留。

---

## 6. 历史 Replay Diff

Replay 全部**只读**：数据源 `deliverables/etf_daily_ml_pool/<code>_qfq.csv`（真实历史日线），不联网、不写库。

### 6.1 Portfolio Mode Replay：CURRENT_PATH vs FORCED_PORTFOLIO_PATH

- 区间 **2026-03-16 ~ 2026-09-04（120 个公共交易日）** × 5 只生产标的
- `CURRENT_PATH` = 线上参数（无 force 开关）；`FORCED_PORTFOLIO_PATH` = 线上参数 + `v3_force_portfolio_track=true`

**组合轨诊断（CURRENT_PATH，即线上实况）**

```json
{
 "portfolio_detected_etf_count": 5,
 "portfolio_mode_expected": true,
 "portfolio_mode_effective": false,
 "portfolio_mode_expected_reason": "detected_etf_count",
 "portfolio_mode_effective_reason": "no_portfolio_evidence",
 "portfolio_mode_suspected_mismatch": true
}
```

**逐日差异**

| code | Δtarget≠0 天数 | max\|Δtarget\| | mean Δtarget | actionΔ 天数 | single cap Δ | cash floor Δ 天数 | binding Δ 天数 | **engine_path 切换天数** |
|---|---|---|---|---|---|---|---|---|
| 513310 | 118 | 21.8 | −5.3 | 12 | 0 | 0 | 22 | **120 / 120** |
| 515880 | 119 | 21.8 | −6.6 | 13 | 0 | 0 | 27 | **120 / 120** |
| 159582 | 118 | 44.4 | +0.6 | 18 | 0 | 0 | 20 | **120 / 120** |
| 518880 | 120 | 24.0 | −17.8 | 4 | 0 | 0 | 17 | 0 |
| 159570 | 120 | 43.9 | −5.8 | 15 | 0 | 0 | 30 | **120 / 120** |

**引擎路径对照（关键）**

- 513310 / 515880 / 159582 / 159570：`v35_structural` → **`v32_bull_participation`**（**全部 120 天**）
- 518880：`v3` → `v3`（不变）

**结论（重要）**：`v3_force_portfolio_track=true` **不只是换一个仓位口径，它会关闭 V3.5-D 结构引擎**。根因在 `decision-v3.js::shouldUseV35()`：

```
isV3PortfolioMode=true 且 v3_5_auto_track!==false  →  return params.v3_5_portfolio_enabled === true  →  undefined → false
```

即组合轨下若未显式配置 `v3_5_portfolio_enabled`，V3.5-D 被静默关闭。

⇒ **「补上 `etf_count` 字段」绝不是无风险的 correctness 修复，而是策略级变更（4/5 票 120/120 天全部换引擎，target 最大差 44.4pp）。本轮严格按照任务书要求：只上只读诊断，在 Replay 报告通过并单独 PR 晋升之前，不让新 flag 驱动生产结果。**
（因此 `getPortfolioSummary` **刻意不返回** `multi_etf` / `etf_count`；诊断字段命名为 `portfolio_mode_*`，判定函数只读 legacy 两字段，`#9.6` 用例钉住这一点。）

### 6.2 TechCorrelation Replay：OLD vs NEW_DATE_ALIGNED

| 口径 | ρ_avg | discount | 有效 tech cap |
|---|---|---|---|
| OLD（按下标配对） | 0.732 | 0.97 | 63.1 |
| NEW（按 trade_date 对齐） | 0.729 | 0.97 | 63.1 |

**汇总（base tech cap = 线上 65%，未改动）**

| 指标 | 值 |
|---|---|
| 最近 120 日：有效 tech cap 变化天数 | **0 / 120** |
| 全历史共同轴 582 日（2024-04-16 ~ 2026-09-04）：变化天数 | **0 / 582** |
| 全历史：ρ_avg 变化天数 | 0 |
| 全历史：样本不足天数 | 10（159582 上市初期窗口未满，**新口径显式暴露**，旧口径静默） |
| 最小 coverage_ratio（全历史） | 0 |

**交易日历分歧扫描（真实数据）**：三票交易日并集 1696 天，其中 1114 天存在「至少一票缺日」，但**全部发生在 2024-04-16 之前**（159582 上市前）；三票齐备之后 **0 天**分歧。

**压力测试**

| 场景 | OLD ρ_avg | NEW ρ_avg | 有效 cap 差 |
|---|---|---|---|
| 真实缺日（2024-04-15，159582 缺） | 0.656 | 0.656 | 0 pp（该票当时无历史 ⇒ 两口径都排除该对） |
| 合成缺日（2026-09-04 窗口内注入 2026-06-11 缺失） | 0.732 | 0.729 | 0 pp（两者仍落在同一折扣档 0.65–0.75） |

**结论（重要）**：缺陷 **真实存在**（单测 `#4.1` 已复现：缺一日即让 ρ 被系统性污染），但在**当前三只科技 ETF 的真实数据上近 120 日 / 全历史共同轴均未触发**（三者上市后交易日历完全一致）。因此：

- 口径切换在**真实数据上零差异**，可以安全合入；
- 它是**潜伏风险消除**，而非收益/风险改善；
- 边界提醒：折扣分档阈值为 `0.65 / 0.75 / 0.85`，最近 120 日中有 **14 天** `ρ_avg` 落在 `0.65 ± 0.02` 内 —— 一旦真的出现缺日，这些天有跨档可能（跨档影响 1.9 ~ 9.75pp cap）。

---

## 7. 仍未解决风险

| # | 风险 | 影响 | 建议 |
|---|---|---|---|
| **R1** | ★ **Swing 唯一实现未完全收敛**：`trend-stage.js` 内仍保留一份只返回 2 字段的副本（受 Gen-1 pipeline lock 保护）。它现在**不再被 SlowBreak 链使用**（该链已改读 `swing-structure`），但仍是源码层面的第二份算法 | 低（当前无消费点），但违反「禁止两份 swing 算法」的形式要求 | 见 R1 选项（§8） |
| **R2** | `docs/主链冻结契约.md` 的 `runDecisionEngine` SHA / 部署时间已过期（`7876610f…` / 09-05 vs 线上 `a694b7d3…` / 09-17） | 文档可信度；后续对账会反复踩坑 | 单独立勘误课题（本轮未改冻结文档） |
| **R3** | 数据库历史 `slow_break_history` 行的 `lowerLow` 已固化为 `false`，SlowBreak bonus 生效存在最多 5 次运行的过渡期 | 短期内 bonus 可能"该给不给" | 合入后观察首个 `slow_break_high=true` 日并人工核对 |
| **R4** | 组合轨：Replay 证明强制组合轨会**关闭 V3.5-D** | 若被当成 correctness 修复直接上线 ⇒ 策略级回退（target 最大差 44.4pp） | 必须走独立策略变更 + 回测，且先明确 `v3_5_portfolio_enabled` 语义 |
| **R5** | Market Regime 仍是**两个真相**（决策用 V3 环境引擎、快照写 V2.1 打分）；本轮只并列诊断，未统一 | 前台展示的 `market_regime` 与驱动决策的 regime 可能不同 | 需先裁定 authority，再做单一对象改造 |
| **R6** | W5 多数闸在线上恒不可达（`market_env` 只有 3 行，闸门要求 ≥5） | 一条 crisis 通路实际是死代码 | 本轮只诊断；是否把闸门改成"按实际指数数"需单独评估（**不动阈值**） |
| **R7** | `V361RunContext` / Run Finality 目前**只构建与诊断**，尚未接入主循环 | 数据日期不一致、部分 ETF 失败这两类问题在生产上仍只靠人看 | 下一阶段接线（建议先做只写日志、不改写库判断） |
| **R8** | 本沙箱**禁止 Node 子进程**（`spawnSync` → `EBUSY`），`npm test` / `gen1-production-gates.js` 无法在本机完整执行 | 无法给出「一键全绿」的 `npm test` 记录 | 见 §7.1，已用 bash 等价门禁替代并如实记录 |
| **R9** | 本机无 Node 16（线上运行时为 `Nodejs16.13`），仅 Node 22.22.2 / 24.20.0 | Node16 特有行为未覆盖 | 若要严格对齐，需装 Node 16 复跑 |

### 7.1 门禁执行实况（如实记录）

`npm test` → `node scripts/test-all.js` 使用 `spawnSync` 拉起子进程，在本沙箱**全部返回 `error=EBUSY / status=null`**。修复前该路径还会因 `(null + null) === 0` 抛 `TypeError` 直接崩溃（**已修**，现在会逐项打印 `[FAIL] … [spawn_error=EBUSY]`，不再吞掉结论）。

改用 **bash 直调等价门禁**（每个脚本直接执行，不经 Node 子进程）：

| Stage | 门禁 | 结果 |
|---|---|---|
| A | `tests/*.test.js`（50 个文件，含新增 2 个） | **47 passed / 3 failed** |
| B | `python -m unittest discover ml/gen2/tests`（venv，含 numpy/pandas） | **exit 0 · Ran 386 tests · OK (skipped=1) · 0 ERROR / 0 FAIL** |
| C | `scripts/verify-immutable.js` | **exit 0 · 23 PASS / 0 FAIL** |
| C | `scripts/verify-gen1-pipeline.js` | **exit 0 · 10 PASS / 0 FAIL** |
| E | `scripts/scan-secrets.js` | **exit 0**（无明文密钥） |
| F | `scripts/build-cloudfunctions.js` | **exit 0 · 公 common parity PASS** |
| F | `scripts/verify-gen2-build-artifacts.js` | **exit 0 · 7/7 逐位一致** |
| G | `scripts/gen1-production-gates.js` | `0/32`（全部 `[spawn_error=EBUSY]`，**环境所致**；其 32 个底层脚本已分别由 Stage A/C 覆盖并通过） |
| D | `scripts/parity/compare.py` | **未执行**（需要 Python 拉起 Node 子进程，同受沙箱限制） |

**Stage A 的 3 个失败全部是沙箱限制，改动前基线完全相同（已复现对比）：**

| 测试 | 失败原因 | 改动前 |
|---|---|---|
| `gen1-parity.test.js` | `spawnSync(python)` → EBUSY | 同样失败 |
| `gen2-scenario-parity.test.js` | `spawnSync(node/python runner)` → EBUSY | 同样失败 |
| `gen1-ge03-regression-guard.test.js` | D8 `spawnSync(scripts/verify-immutable.js)` → status=null；该脚本**直接运行 exit=0 / 23 PASS** | 同样失败 |

**⇒ 零回归：新增 2 个测试文件（58 例）全绿，既有失败项一个不多、一个不少。**

### 7.2 Stage B 说明（已全绿）

- 用 PATH 上的 `python` 直接跑 → `19 errors`，**全部**是 `ModuleNotFoundError: No module named 'pandas' / 'numpy'`（该解释器缺依赖，**与本次改动无关**；本轮未触碰任何 `ml/` 文件）。
- 改用 `binaries/python/envs/default`（numpy 2.5.3 / pandas 3.0.5）复跑 → **`Ran 386 tests in 943s · OK (skipped=1) · exit 0`，0 ERROR / 0 FAIL**。
- 说明：`scripts/test-all.js` 的 Python 解析顺序本就是「`TCB_PYTHON` → 上述 venv → `python3`」，因此**在子进程可用的机器上 `npm test` 的 Stage B 会走 venv 并全绿**；本沙箱只是无法经 Node 拉起子进程。

---

## 8. 是否建议进入下一阶段

**不建议直接进入 V3.6.2 / V3.6.3。**

理由与建议顺序：

1. **R1 可以合入**：9 项中 7 项为「零决策影响 + 只读诊断」，2 项（SlowBreak、日期计数）为任务书明确要求的 correctness 修复，且全部未触碰任何冻结工件（两条锁均全绿）。
2. **必须先裁定一件事（否则后续寸步难行）**：
   仓库自定契约写着「`decision-v3.js` 任何挑战**须升版 V3.6.2+**」，而本轮任务书**禁止升版**。这两条互斥 ⇒ **本轮所有修复只能落在未上锁侧**。
   **选项（请择一，我不自行选边）**：
   - **① 维持现状（推荐）**：继续「不碰冻结件、修复落在未上锁侧」。代价：`trend-stage.js` 的 2 字段 swing 副本长期存在（R1）。
   - **② 授权重锁**：明确授权后用既有 `scripts/gen-gen1-pipeline-lock.js` 重新生成 Gen-1 pipeline lock（**注意：这是修改冻结工件，需要显式审批**），从而把 swing 唯一实现真正收敛进 `trend-stage.js`。
   - **③ 授权升版**：允许开 V3.6.2 分支，把 `day_start_state` 锚点、date-aligned correlation 直接内建进引擎核心（最干净，但要走完整升版 + 回测流程）。
3. **建议单独立项（不要合进本轮）**：
   - P1 **组合轨晋升**：先定 `v3_5_portfolio_enabled` 语义，再回测 V3.5-D→V3.2Math 的切换影响（Replay 已给出 44.4pp 量级的证据）。
   - P1 **Market Regime 单一真相**：先裁定 authority（V3 环境引擎 vs V2.1 打分），再合对象；顺带决定 W5 闸是否按实际指数数改写。
   - P2 **V361RunContext / Run Finality 接线**：建议先"只写日志/只落诊断"跑一段，再考虑让它影响写库判断。
   - P3 **两阶段发布落地**：CALCULATING → candidate → whole-run validation → COMPLETED → active run。
   - P3 **`docs/主链冻结契约.md` 勘误**（R2）。
4. **R3 的观察动作**：合入后盯第一个 `slow_break_high=true` 的交易日，人工核对 DefenseScore 与 target 变化。

---

## 附：本期不变量（可复核清单）

```
线上包 SHA256              a694b7d3d6bad410ca5f0c25304ba13fcdf9801c79f86d7f99b1bb0bc3003608
线上 index.js SHA256(16)   da4910cae28476e6
REPO_BASE_SHA              650db58639f32232ac72a99920060dd92e743621
SOURCE_PARITY              MATCH 66/66
verify-immutable           23 PASS / 0 FAIL   (exit 0)
verify-gen1-pipeline       10 PASS / 0 FAIL   (exit 0)
build-cloudfunctions       common parity PASS (exit 0)
verify-gen2-build-artifacts 7/7               (exit 0)
scan-secrets               PASS               (exit 0)
新增测试                    58 例 / 0 failed
未改动冻结工件              trend-stage.js / decision-v3.js / decision.js（逐位一致，有守卫测试）
未部署 · 未改线上参数 · 未开 V3.6.2 / V3.6.3
```
