# Gen-2 资格判定报告 v3 — WP9.2 措辞修正 + WP9.3A Stateful Economic Replay

> ⚠️ **旧角色语义审计基线 —— 不可与新结果逐位比较**
>
> 本报告产生于 PR #24 之前：角色语义来自旧实现（缺 NO_CORE 硬门槛与 Selection Permission），
> 回测账本为旧口径（现金腿被计入换手，持有现金缓冲的策略费用最多高估 2 倍）。
> 仅作**审计基线**留存；**不得**用于继续宣称 Rule V2 的经济表现。
> 新基线见 `ml/gen2/reports/gen2_b1_ledger_baseline_20260911.md`（WP-G2-02 / B1，唯一权威角色语义 + 唯一权威账本）。


日期：2026-09-09。v3 变更：
- **WP9.2 措辞修正**（审查 §2-4）：Promotion-Actionable Alpha 命名、RISK_OFF 语义精确化、top_quintile 切片口径更正、撤销「Case C alpha 整体失效」。
- **新增 WP9.3A Stateful Economic Replay**（审查 §8）：回答「+0.10 的 Promotion Alpha 经 persistence/demotion/replacement/cap/turnover 后还剩多少」。
- **Economic Gate 判定 = FAIL（§31 Case B）→ Gen-2.1 立项建议**；9.3B/C（V3.6.1 / Gen-1 Node replay harness）**不启动**（E 组 proxy 已证无净增量，造 D 组对照 ROI 负）。

## 一、WP9.2 措辞修正（v3 采用）

1. **命名**：`Actionable Selection Alpha` → **`Promotion-Actionable Alpha`**；Gate 名称 `Permission PASS` → **`Promotion Gate PASS`**。因为它证明的仅是：ACTIVE+REDUCED（允许晋升）环境下系统寻找新领导 ETF 时 alpha 有正信息含量。
2. **RISK_OFF 语义精确化**：`DISABLED` = **禁新晋升 ≠ 停止使用 alpha**。现任 CORE 仍经 alpha rank → proposed role → below_satellite_days → demotion persistence → cluster cap → replacement/final constraint 全链。即 RISK_OFF 的 incumbent retention/demotion 仍受 alpha 影响。
3. **切片口径更正**：原 `oos_promotion_candidate_days`（1226 日）只检查 alpha top 20% & px_ma60>0，**未检查** current_role≠CORE / perm≠DISABLED / above_core_days≥5 / replacement edge / cluster cap → 改名为 **`oos_top_quintile_trend_eligible_days`**。真实 Promotion Event（PROMOTION_CONFIRMED / REPLACEMENT_ACCEPTED / REVOKED / DEMOTION_CONFIRMED / NO_CORE_TREND_GATE 等）从 `build_v2_roles()` 的 reason_codes 提取，已作为 WP9.3A event attribution 的归因对象。
4. **「alpha 整体失效」撤销**：原 Case C 判定（保持 Shadow + 直接转 Gen-2.1）作废；资格改判 = Promotion Gate **CONDITIONAL PASS**，完整 Stateful Selection Engine 待 Economic Replay 判定。

## 二、WP9.3A Stateful Gen-2 Economic Replay（冻结规则，规则零改动）

运行：`PYTHONPATH=ml python -m gen2.evaluation.economic_replay`。Stateful：DISABLED 日**不删除**，状态机照跑 retention/demotion/NO_CORE/cluster cap/replacement。T+1 ledger，cost 10bps（cash 腿不计费），eval_calendar 2046 日。

### 经济总表（cost 10；market = 毛收益参照）

| 策略 | cumulative | CAGR | Sharpe | MDD | Calmar | 换手(年化等效累计) |
|---|---|---|---|---|---|---|
| main5_pit | +181.0% | 13.6% | 0.650 | −45.8% | 0.296 | 12.5 |
| universe_ew | +81.2% | 7.6% | 0.410 | −50.0% | 0.152 | 24.1 |
| gen2_v2_undefended | +50.7% | 5.2% | 0.373 | −29.0% | 0.179 | 115.6 |
| gen2_v2_defended | +62.1% | 6.1% | 0.482 | −23.4% | 0.262 | 147.2 |
| market_510300 | +41.1% | 4.3% | 0.304 | −44.7% | 0.097 | — |

### Block Bootstrap CI（defended − ref 日超额，block=20，2000 次）

| 对照 | mean/日 | 95% CI | 判定 |
|---|---|---|---|
| defended − main5_pit | −0.00034 | [−0.00088, +0.00017] | **净增量 ≤ 0（FAIL）** |
| defended − universe_ew | −0.00015 | [−0.00076, +0.00039] | 净增量 ≈ 0（FAIL） |

### Event Attribution（真实状态机事件 → 后 20D vs-market 超额）

| event | count | fwd20_mean_excess | fwd20_pos_ratio | 解读 |
|---|---|---|---|---|
| PROMOTION_BLOCKED_BY_PERMISSION | 2526 | −0.0012 | 0.463 | RISK_OFF 禁晋升：被禁标的略跑输 → 禁得对（帮） |
| PROMOTION_HYSTERESIS | 1851 | **+0.0185** | 0.559 | 5 日 persistence 挡下的候选后 20D +1.85% → 晋升滞后**踏空代价** |
| DEMOTION_HYSTERESIS | 1163 | +0.0089 | 0.472 | 降级滞后保留的现任略跑赢 |
| **RISK_OFF_CORE_HOLD** | **609** | **−0.0051** | 0.425 | RISK_OFF 保留现任 CORE 后 20D 跑输 → **现任保留有伤害** |
| PROMOTION_CONFIRMED | 414 | +0.0089 | 0.530 | 晋升兑现弱正（信息含量存在但弱） |
| REPLACEMENT_ACCEPTED | 91 | +0.0203 | 0.517 | 替换接受：被替换对象确实强 → 替换门有价值 |
| REPLACEMENT_REVOKED / BLOCKED | 104×2 | ≈0 / +0.001 | — | 撤销边界 ≈ 中性 |
| NO_CORE_TREND_GATE | 73 | +0.0161 | 0.556 | 破 MA60 拦截正确 |
| **DEMOTION_CONFIRMED** | **27** | **−0.0257** | 0.333 | 被降级标的后 20D 继续跑输 2.6% → **demotion 决策正确（帮）** |

RISK_OFF demotion 检验：DISABLED 下 DEMOTION_CONFIRMED 仅 6 次，被降级标的后 20D −0.0048（继续走弱，demotion 正确，样本小）。

## 三、Economic Gate 判定（v3）

| 判据（审查 §15） | 结果 |
|---|---|
| 成本后净增量 > 0（vs Main5 PIT / Universe EW proxy） | ❌ FAIL（bootstrap CI 均值负 / ≈0） |
| Sharpe ≥ 对照 | ❌ FAIL（0.48 < main5 0.65） |
| MDD 不恶化 | ✅ 优（−23% vs −45%） |
| Selection contribution > rotation cost | ❌ FAIL（换手 147 vs main5 12.5；PROMOTION_HYSTERESIS 踏空 + 高频调仓成本主导） |
| 灾难年 | ✅ 2022 −2.3%（优于 main5 −26.7%） |
| **Economic Gate（9.3A）** | ❌ **FAIL → §31 Case B** |

## 四、结论与分叉（按审查 §15）

```
Promotion-Actionable Alpha = CONDITIONAL PASS（+0.10/62%，WP9.2）
        ↓
Stateful Economic Replay（9.3A）：IC 的预测力经 persistence/replacement/cap/turnover
        后未转化为净经济增量 —— 30 只全池选池净收益 ≤ Main5 PIT / Universe EW
        ↓
Economic Gate = FAIL → 任务书 §31 Case B
        ↓
WP9.3B/C（V3.6.1 Node Replay + Gen-1 Frozen Replay harness）不启动
        （E 组 proxy 已证无增量，再造 D 组对照的 ROI 为负）
        ↓
进入 Gen-2.1 = Hierarchical Cluster Leadership + Consolidation Quality Gate
        （先判赛道强、再判赛道内 ETF；横盘缩量作晋升质量门而非塞因子权重）
```

**保留价值发现（供 Gen-2.1 设计吸收）**：①defended vs market 显著改善（Sharpe 0.48 vs 0.30、MDD −23% vs −45%）→ 防守层（tech cap/risk-off scale）有价值；②DEMOTION_CONFIRMED / NO_CORE_TREND_GATE / REPLACEMENT_ACCEPTED 事件均被验证正确 → 状态机风控方向对；③PROMOTION_HYSTERESIS +1.85% 后 20D → persistence 5 日偏长，Gen-2.1 可用 Consolidation 质量门替代纯天数滞后；④RISK_OFF_CORE_HOLD −0.51% → RISK_OFF 现任保留确有代价，需研究条件保留。

**Production 红线不变**：Gen-2 Rule V2 不进 Production Advisory / 不写 decision_result。Integrated Shadow 维持 Main5 FULL + Extended Universe SELECTION_ONLY。

## 五、复现命令

```bash
npm test                                                              # 18/18
PYTHONPATH=ml python -m gen2.evaluation.walk_forward                  # WP9.1 raw OOS
PYTHONPATH=ml python -m gen2.evaluation.permission_oos                # WP9.2 regime 归因（v3 命名）
PYTHONPATH=ml python -m gen2.evaluation.economic_replay               # WP9.3A 经济回测 + 事件归因
python scripts/verify-gen2-dataset.py                                 # 数据身份 31/31
```
