# Gen-2 Rule Ranking 回测：30 只 universe_v1

> ⚠️ **旧角色语义审计基线 —— 不可与新结果逐位比较**
>
> 本报告产生于 PR #24 之前：角色语义来自旧实现（缺 NO_CORE 硬门槛与 Selection Permission），
> 回测账本为旧口径（现金腿被计入换手，持有现金缓冲的策略费用最多高估 2 倍）。
> 仅作**审计基线**留存；**不得**用于继续宣称 Rule V2 的经济表现。
> 新基线见 `ml/gen2/reports/gen2_b1_ledger_baseline_20260911.md`（WP-G2-02 / B1，唯一权威角色语义 + 唯一权威账本）。


**Experiment ID**：`gen2-exp-0002-rule-baseline-universe-v1`
**Universe**：`universe_v1`（正式 30 只 + benchmark 510300）
**Feature**：`feature_v1`　**Label**：`label_v1_excess_rank_20d`
**日期范围**：2018-04-03 至 2026-09-04（2045 交易日）
**结论**：**Economic Gate = FAIL / UNPROVEN**

---

## 一句话结论

**扩到 30 只没有解决「选池信号无 alpha」的根本问题，经济表现反而比 15 只更差。** Rank IC 从 -0.013 勉强转正到 +0.002，但绝对值≈0 仍无预测力；Top-Bottom spread 仍为负；Rule+防守 10bps 累计收益从 +145.5% 掉到 +47.2%、Sharpe 0.64→0.37。

**根因不在池子大小，而在 Leadership Score 规则本身 Rank IC≈0，以及 RISK_OFF 段（894 天 / 44% 时间）深亏 -94.6% 无有效防守闸门。**

---

## 1. 核心排名指标：15 只 vs 30 只

| 指标 | 15 只 (dev_v0) | 30 只 (universe_v1) | 变化 |
|---|---:|---:|---|
| Rank IC mean | -0.0130 | **+0.0023** | 转正但≈0 |
| Rank IC >0 占比 | 47.81% | **50.83%** | +3pp |
| Rank IC 中位数 | -0.0286 | **+0.0123** | 转正 |
| Top-Bottom 20D spread | -0.0018 | **-0.0029** | 仍为负，略恶化 |

**解读**：Rank IC 由负转正是唯一「变好」的指标，但 +0.0023 本质上还是零（IC 标准差 0.43，t 值 ≈ 0.2，远不显著）。Top-Bottom spread 仍为负，说明**选出的 Top 20% 未来 20 日超额反而略低于 Bottom 20%**——这是「选池信号无预测力」的直接证据。

## 2. 分年度 Rank IC（30 只）

| 年 | 样本天数 | Rank IC mean | IC>0 占比 |
|---|---:|---:|---:|
| 2019 | 20 | -0.290 | 20% |
| 2020 | 243 | +0.055 | 57% |
| 2021 | 243 | -0.109 | 36% |
| 2022 | 242 | -0.079 | 43% |
| 2023 | 242 | **+0.138** | **71%** |
| 2024 | 242 | +0.068 | 57% |
| 2025 | 243 | -0.080 | 40% |
| 2026 | 144 | +0.078 | 57% |

**年度间正负交替、无稳定性**，唯一较好的是 2023 年（+0.138），无法构成可复现的选池优势。

## 3. 经济对照（10bps 成本、T+1 生效）

| 策略 | 15 只累计 | 30 只累计 | 30 只 Sharpe | 30 只 MDD |
|---|---:|---:|---:|---:|
| Main5 等权（对照） | +235.6% | +235.6% | 1.00 | -20.6% |
| Expanded Universe 等权 | +151.4% | +83.5% | 0.42 | -49.8% |
| Rule Rotation（无防守） | +151.0% | +9.1% | 0.17 | -55.6% |
| **Rule + 防守闸门** | +145.5% | **+47.2%** | **0.37** | -28.9% |

**Rule Rotation 在 30 只下全面恶化**：无防守版从 +151% 崩到 +9%；加防守版从 +145.5% 掉到 +47.2%。

三个恶化来源：
1. **换手率上升**（总换手 155.9 → 188.6 次），10bps 成本侵蚀加剧；
2. **扩展池整体弱**：30 只等权只有 +83.5%，远低于 Main5 的 +235.6%——16 只新增标的（尤其 2024 年才纳入的医药/酒/消费/红利/银行/券商/有色/煤炭/纳指/标普）在样本期整体跑输科技主线；
3. **选出的「相对强者」绝对收益不足**——在大弱池子里排名靠前，不等于绝对赚得多。

## 4. 分组归因（Risk-on / Risk-off / Range）

| Regime | 天数 | Rule 累计 | Main5 累计 | Rule Sharpe | Main5 Sharpe |
|---|---:|---:|---:|---:|---:|
| RANGE | 223 | +49.1% | +19.2% | 2.29 | 1.27 |
| **RISK_OFF** | **894** | **-94.6%** | **-57.1%** | -3.18 | -1.44 |
| RISK_ON | 928 | +1253% | +556% | 2.95 | 3.23 |

**这是最关键的发现**（与 15 只结论完全一致，且更极端）：

- **RISK_ON 段（928 天）Rule 大幅跑赢**：+1253% vs Main5 +556%——追强势的进攻性确实有效；
- **RISK_OFF 段（894 天）Rule 深亏**：-94.6% vs Main5 -57.1%——防守闸门（MA60 + 波动率目标）只把核心降到 50%+黄金 15%，**挡不住这 44% 时间里的深亏**；
- **-94.6% 的亏损需要 +1750% 才能回本**，这是数学上致命的：RISK_OFF 段把净值打到 0.05，后面 RISK_ON 涨 13 倍也只能回到 0.68。

**病根结论：不是 Leadership 权重/选池的问题，而是缺一个真正有效的 regime 防守闸门。** RISK_ON 段的进攻性 alpha 被 RISK_OFF 段的深亏整体吞噬。

## 5. 科技暴露归因

| 段 | 天数 | Rule 累计 | Main5 累计 |
|---|---:|---:|---:|
| TECH_HEAVY（科技权重≥50%） | 415 | -16.7% | +11.7% |
| NON_TECH | 1630 | +30.9% | +200.5% |

**科技重仓时 Rule 反而亏钱**（-16.7%），且 NON_TECH 段 Rule（+30.9%）也远跑输 Main5（+200.5%）——Main5 本身就是科技+黄金+创新药的高质量组合，Rule 在 30 只里「轮动」反而轮丢了主线的长期复利。

---

## 6. 下一步优先级（Phase 2 步骤 ⑥ 之后）

按「先修实现一致性 → 再谈模型能力」的协议，30 只下实现一致性已达成（本回测与线上 Node 版算法一致，parity 14/14 通过），但**模型能力未过 Economic Gate**。方向排序：

1. **补长历史数据**：10 只老 ETF 只有 640 根（约 2.5 年），回测 2018-2023 段 universe 仅 2~18 只，早期结论不可靠。用东财源补到全历史，让 RISK_OFF 段（2018、2022、2025）有完整样本。

2. **重做 regime 防守闸门**（比调选池更优先）：当前 MA60 单一阈值 + 50% 降仓，挡不住 -94.6% 的深亏。方向：RISK_OFF 时核心降得更狠（甚至空仓/全黄金）、或引入「RISK_OFF 禁止追科技」的硬约束、或多周期 regime 确认。

3. **提升选池信号本身**：Rank IC≈0 是 Sharpe 封顶的根因。可尝试：引入基本面/周期因子（当前纯技术面）、或把「相对强弱」从横截面改为「相对 Main5 的绝对 alpha」。

4. **Selection Alpha / Defense Alpha 拆分归因**：确认到底是「选得不好」还是「防守太弱」，避免误判。

**在 1-4 完成且 Economic Gate 通过前，Gen-2 保持 Shadow-only，不进入 Qlib/ML，不接生产。**

---

## 附：关键数字速查（本次运行）

- Rank IC mean = +0.0023（15 只 -0.0130）
- Top-Bottom spread = -0.0029
- Rule+防守 10bps：cum +47.2%、Sharpe 0.37、MDD -28.9%、总换手 188.6
- Main5 等权 10bps：cum +235.6%、Sharpe 1.00、MDD -20.6%
- RISK_OFF 段：Rule -94.6% vs Main5 -57.1%（894 天）
- RISK_ON 段：Rule +1253% vs Main5 +556%（928 天）

## 输出文件

- `outputs/feature_matrix_v1.csv`、`daily_rankings.csv`、`daily_roles.csv`
- `outputs/rank_ic_by_date.csv`、`top_bottom_spread.csv`、`quantile_forward_returns.csv`
- `outputs/portfolio_candidates.csv`、`portfolio_candidates_defended.csv`
- `outputs/backtest_metrics_summary.csv`、`benchmark_nav.csv`
- `outputs/attribution_by_regime.csv`、`attribution_by_tech.csv`
- `manifests/gen2-exp-0002-rule-baseline-universe-v1.json`
