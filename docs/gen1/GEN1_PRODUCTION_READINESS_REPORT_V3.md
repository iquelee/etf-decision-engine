# Gen-1 Production Readiness Report V3（WP-G1.2 Runtime Single-Truth Remediation）

**日期**：2026-09-10
**基线**：V2 = `feat/wp-g1-1` @ `aaeb5cb`（PR #15）；本版 = `feat/wp-g1-2`（PR #16，stacked on #15）
**范围声明**：本 PR **只做 4 件事**，不加任何新功能；不改 frozen model、不改 0.65、不重训、不开生产写权限、不改 `gen1_authority`。
**一句话结论**：**第二轮复审的 3 个 runtime「单一真相」P0 + 1 个事件计数口径问题全部修复；`COUNTERFACTUAL_CANARY` 的工程前置条件已闭合，待最终 review 后可由配置开启；经济证据仍不足 → LIMITED/FULL PRODUCTION 保持 BLOCKED。**

---

## 一、复审 3 + 1 项处理结果

| # | 复审问题 | 结论 | 处理与证据 |
|---|---|---|---|
| P0-1 | **Persistent Health 已读但 Safety 链没用它**：每只 ETF 仍用 `ml_shadow_signal.gen1_health_status` 重新推 `circuitGate` → 昨天的 OK 快照可盖过今天的 ML_OFF latch，形成双重真相 | **成立，已修** | 权限链**只**使用 `gen1GlobalGate`（= `healthStateToGate(持久化 latch)`）：`const gen1Gate = gen1GlobalGate`。signal 侧 health 降级为 **审计快照**（`gen1_signal_health_snapshot`），不再拥有任何权限。视图层 `health_status` 改为优先取运行时 latch（`decision.gen1_health_status`），快照单列。**G1-N（7 组）+ G1-P（静态守卫）** |
| P0-2 | **Health DB 读取失败仍 Fail Open**：`catch → defaultHealthState()`（= OK），外层 catch 永远收不到异常 | **成立，已修** | `readHealthState` 改为**三态**：`FOUND` / `NOT_INITIALIZED` / `READ_ERROR`。`READ_ERROR → ML_OFF（全链 fail-closed，manual_review_required，且 upsert 被跳过）`。**绝不**把异常当 OK。**G1-O（6 组，含「读异常时 upsert 必须为 0 次」）**。<br>⚠️ **`NOT_INITIALIZED` 的精确语义（2026-09-10 修正表述）**：`runDecisionEngine` 读到 `NOT_INITIALIZED` → `PENDING`（ADVISORY 可继续、**CANARY 关闭**）；`persist_allowed=false` 只表示**该次读取产生的状态对象不得被写回**。**下一次成功的 `runGen1ShadowEod` health evaluation 允许 bootstrap**：`NOT_INITIALIZED → computeLatchedState() → FOUND → writeHealthState()` 正常创建正式 latch（G1-O 用例 5 明确验证该路径）。即：**不落库的约束只作用于「读异常」，不禁用正常 bootstrap** |
| P0-3a | **Canary Tech Cap 单位错误**：`canaryTechUsed` 从 0 起算、把 `effectiveTechMax` 当「新增额度」，**未计入真实科技持仓** | **成立，已修** | 占用算法收敛为**唯一** `sectorOccupation(current, suggested, target)`，生产与 Canary 共用；`canarySectorUsed` 种子 = `portfolio.tech_position`，逐只累加；`sectorRemainingLimit = max(0, cap − (sectorUsed − current))` 与生产**同式**。旧 `techUsed/effectiveTechMax` 语义删除（测试同步重写）。**G1-M（8 组，含复审给出的 60%/65% 反例）** |
| P0-3b | **Canary 上下文不一致**：`recentSlowBreakScores: []`，且用被覆写后的 `p.position.trend_stage_state / shock_state` | **成立，已修** | 在生产调用那一刻**冻结**完整上下文 `canaryCtx = { portfolio, bars, trendStageState, shockState, slowBreakScores, sectorRemainingLimit }`，canary 重算逐字段复用；**唯一变量 = `advisoryStageOverride`**。**G1-P 静态守卫（禁止 `recentSlowBreakScores: []` 回归）** |
| P0-4' | **Economic 独立事件计数用「事件日期自排 index」** 而非真实交易日 | **成立，已修** | `countIndependentEvents` 重写：① `event_cluster_id` 去重（= 能力审计口径，不再发明第三套）；② 真实交易日历判 40D；③ 无日历时退化为 **1.5× 自然日保守阈值**并显式标注（保证 `noCal ≤ withCal`，fail-closed）。replay 已改用同一函数并附口径元信息。**G1-Q（4 组，含 fail-closed 不变量）** |

> **未处理（复审判定为后续前置条件）**：Economic Health 的 Shadow Ledger → 自动 Aggregate → 写 `gen1_health_state` → `runDecisionEngine` 消费的**自动闭环**。复审明确「不影响 ADVISORY，在 LIMITED_PRODUCTION 前必须完成」→ 列入第五节。

---

## 二、Health 只有一条真相（数据流）

```text
【写入侧】runGen1ShadowEod（每日 EOD）
   readHealthState ──(READ_ERROR)──▶ 不写库，本轮门 = ML_OFF
        │(FOUND / NOT_INITIALIZED)
        ▼
   computeHealthStatus(dataHealth, economicHealth)  →  computeLatchedState(latch, manual review)  →  writeHealthState
        ▼
   集合 gen1_health_state（单文档 key='gen1-health-state'）

【消费侧】runDecisionEngine（唯一权限真相）
   readHealthState ──▶ healthStateToGate ──▶ gen1GlobalGate ──▶ gen1Gate（每只 ETF 直接引用）
                                                        │
        ml_shadow_signal.gen1_health_status ──▶ 仅 gen1_signal_health_snapshot（审计，无权）

gate_status：ACTIVE（正常） / PENDING（未初始化：advisory 可续、canary 关） / READ_ERROR（= ML_OFF）
```

**端到端一致性**：`runtime_status.gen1_health_*`、`decision_result.gen1_health_*`、后台视图 `system.health_*` 全部来自同一 latch；signal 快照只在 `signal_health_snapshot` 字段出现。

---

## 三、Canary 组合平价（复审反例已复现并修复）

复审判定：真实科技仓位 60%、cap 65% 时，「Canary 想新增 +10%」实际只有 **5%** 空间，而旧实现认为 +10% 完全没问题。修复后：

| 场景 | sectorUsed / current | cap | 旧实现 | **修复后** |
|---|---|---|---|---|
| 持仓 60%、cap 65% | 60 / 10 | 65 | `room=65` → 放行 +10 ❌ | `limit = 65−(60−10) = 15` → clamp 回 15，净增量 **0** ✅ |
| 持仓很低 | 15 / 5 | 65 | `room=65` → 放行 | `limit = 55` → 放行 25 ✅ |

四只科技候选顺序累计的结果：`A → 25`、`B → clamp 20`、`C/D → 回落 baseline 10`，**组合科技总仓最终恰好 65，不越界**（G1-M 用例 3）。

> 单位口径现已统一：`effectiveTechMax` = **科技总仓上限**，`sectorUsed` = **组合总仓**，新增额度只作为派生量（`limit`），不再被当成输入。

---

## 四、Canary Replay 复跑（事件口径已修正）

新口径：事件簇去重（`event_cluster_id`）+ **真实交易日历**（Main5 并集 1696 日）40D 间隔 + 只统计 canary 生效事件。

| 指标 | V2（旧近似口径） | **V3（G1.2-04 口径）** |
|---|---|---|
| 基线 S2 日数 | 698 | 698 |
| 候选（P≥0.65 且 ml_fast） | 3 | 3 |
| canary 生效事件 | 3 | 3 |
| 事件簇数 | — | **3** |
| **独立事件** | 2 | **2** |
| 计数口径 | `INDEPENDENT_BY_EVENT_DATE_INDEX`（不成立） | **`TRADING_DAYS`（1696 日真实日历）** |
| Timing gain（阶段权重和） | 0.705 | 0.705 |
| 增量 20D 超额均值 | +16.4% | **+16.4%（n=3）** |
| 假启动率 | 0 | 0 |
| by_regime | BULL 0 / RANGE 2 / RISK_OFF 1 | 同 |
| by_code | 515880×1 / 159582×2 | 同 |

**诚实结论（未变）**：数字**没有变大也没有变小**，但从「不可采信」变成了「可采信」——`2` 现在是交易日历口径下的真值。
即便口径修正，**样本仍然只有 3 个簇 / 2 个独立事件**，且 **Domain 覆盖缺失**（0 个 biotech `IN_DOMAIN` 事件，全部来自 PARTIAL_COVERAGE）、**Regime 覆盖缺失**（BULL = 0）。因此 **+16.4% 只能表述为「3 个正面案例」**，Economic Gate 保持 **FAIL / INSUFFICIENT**。

---

## 五、Residual（本版仍未闭合）


| # | 项 | 阻断对象 | 说明 |
|---|---|---|---|
| R1 | Economic Health **自动闭环**未建立（现为离线计算器：JSON → stdout/本地文件） | LIMITED_PRODUCTION | 需：Shadow Ledger → 自动 Aggregate → 写 `gen1_health_state` → `runDecisionEngine` 消费。**不影响 ADVISORY / COUNTERFACTUAL_CANARY** |
| R2 | 经济样本不足（3 簇 / 2 独立事件；BULL=0；无 IN_DOMAIN 事件） | LIMITED / FULL PRODUCTION | 建议另立 `WP-G1-EVIDENCE`（只扩样本，**不调 0.65、不改 frozen model**） |
| R3 | Replay Fidelity = PARTIAL_FIDELITY（risk/fundamental/组合约束为代理） | 经济结论强度 | 需 Live 数据复核 |
| R4 | sector 3 个科技类各有 1/3 fold 编码 -1 | 无（已如实标注，审计 CONSISTENT） | 若要显式映射须另立任务书 |
| R5 | GitHub CI 需在 PR #16 head 跑绿 | 合并 | 本地 `npm test` **35/35**、Gen-1 Gates **17/17** |

---

## 六、裁决

| Gate | V2 | **V3** | 依据 |
|---|---|---|---|
| Gen-1 Model / Immutability | PASS | **PASS** | Immutable 11/11 |
| Feature Pipeline Lock | PASS | **PASS** | 10/10（**未触碰 frozen 管线文件**） |
| Model Candidate Contract | PASS | **PASS** | G1-I |
| Sector Contract | PASS | **PASS** | G1-J（CONSISTENT，drift=0） |
| Python ↔ Node Parity | PASS | **PASS** | G1-C（420 行，1.54e-14） |
| Data / Domain Fail-Closed | PASS | **PASS** | G1-D/E |
| Production No-op | PASS | **PASS** | G1-H + 运行期 `verifyProductionNoop` |
| **Health Single Truth** | ❌（双重真相） | ✅ **PASS** | **G1-N + G1-P** |
| **Health Read Fail-Closed** | ❌（异常→OK） | ✅ **PASS** | **G1-O** |
| **Canary Portfolio Parity** | ⚠️（单位错误） | ✅ **PASS** | **G1-M（重写）** |
| **Canary Context Parity** | ❌（空 slowBreak / 被覆写状态） | ✅ **PASS** | **G1-P** |
| **Economic Event Contract** | ❌（非法口径） | ✅ **PASS** | **G1-Q + replay 复跑** |
| **ADVISORY_PRODUCTION** | PASS | ✅ **PASS** | — |
| **COUNTERFACTUAL_CANARY（工程）** | CONDITIONAL / 3 P0 | ✅ **PASS** | 3 个 runtime 单一真相 P0 + 口径问题全修 |
| **CANARY_ECONOMIC_GATE** | FAIL | ❌ **FAIL / INSUFFICIENT** | 3 簇 / 2 独立事件 |
| **LIMITED_PRODUCTION** | BLOCKED | ⛔ **BLOCKED** | R1（无自动闭环）+ R2 |
| **FULL_PRODUCTION** | BLOCKED | ⛔ **BLOCKED** | 同上 + authority 未升 |
| **AUTO TRADING** | OFF | **OFF** | 恒 false |

**本 PR 未改动 `gen1_authority`**（仍为 ADVISORY）。若要开启 COUNTERFACTUAL_CANARY，仅需在 `param_config` 将 `gen1_authority` 置为 `CANARY`（单字段、可逆、无代码变更、`production_write`/`auto_execution` 仍恒 false、`final_target` 仍为 V3.6.1）。建议在最终 review 通过后单独执行并记录。

---

## 七、命名体系（采纳复审建议）

```text
OFF → SHADOW → ADVISORY → COUNTERFACTUAL_CANARY → LIMITED_PRODUCTION → PRODUCTION
                              ↑ 工程安全 PASS 即可        ↑ 必须 Economic Gate PASS
```

- **COUNTERFACTUAL_CANARY**：每日真实计算「若允许 Gen-1 会得到什么 target」，`final_target` 不变、无写入、无自动执行 → **不需要** Economic Gate PASS。
- **LIMITED_PRODUCTION**：才开始要求 Economic Gate PASS（含 R1 自动闭环）。

---

## 八、工程门禁

`npm test` → **35/35 通过**：

- Stage A Node 单测 **28/28**（新增 3 个：Health Single Truth / Health Fail-Closed / Runtime Single-Truth 静态守卫）
- Stage B Gen-2 Python 单测 PASS
- Stage C Immutable SHA **11/11** + Gen-1 Feature Pipeline Lock **10/10**（**frozen 管线文件零改动**）
- Stage D Python ↔ Node Parity PASS
- Stage E Secret scan PASS（0 命中）
- Stage F Build Common Parity PASS（11 函数 common SHA 一致）
- Stage G Gen-1 Production Gates **G1-A~Q 17/17**

---

## 九、合并顺序（保持审计历史，不 squash）

```text
#11 → master
#12 retarget master → CI → merge
#13 retarget master → CI → merge
#14 retarget master → CI → merge
#15 retarget master → CI → merge
#16 retarget master → CI → merge（本版）
```

这些 PR 记录了「Gen-1 如何一步步取得权限」，对后续审计有价值，不建议压缩。
