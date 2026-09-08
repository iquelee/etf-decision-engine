# Gen-2 Rule Leadership Baseline Report v1

**Experiment ID**：`gen2-exp-0002-rule-baseline-universe-v1`
**Universe**：`universe_v1`（正式 30 只 universe_v1 + benchmark 510300）
**Feature**：`feature_v1`
**Label**：`label_v1_excess_rank_20d`
**日期范围**：2018-04-03 至 2026-09-04
**Manifest**：`ml/gen2/manifests/gen2-exp-0002-rule-baseline-universe-v1.json`

## 硬约束

```text
PRODUCTION WRITE = OFF
AUTO TRADING     = OFF
GEN1 MODIFIED    = NO
V361 MODIFIED    = NO
```

## 核心排名指标（v1）

- Rank IC mean：0.0023
- Rank IC > 0 日期占比：50.83%
- Top-Bottom 20D excess spread mean：-0.0029

## 最新一日 Top 10

```csv
rank,code,name,leadership_score,correlation_cluster,rank_percentile
1,512800,银行ETF,80.99450513174577,financial,1.0
2,512000,券商ETF,73.7052578199178,financial,0.9666666666666667
3,510880,红利ETF,72.10179211469534,defensive_dividend,0.9333333333333333
4,159928,消费ETF,67.94420335582296,consumer,0.9
5,159941,纳指ETF,66.45153398469381,overseas_equity,0.8666666666666667
6,513500,标普500ETF,65.49612924171956,overseas_equity,0.8333333333333334
7,159570,港股通创新药ETF,61.4971672674809,healthcare,0.8
8,512010,医药ETF,59.329914892298866,healthcare,0.7666666666666667
9,518880,黄金ETF,59.03620071684588,gold_commodity,0.7333333333333333
10,512690,酒ETF,58.628432746503954,consumer,0.7
```

## 10bps 成本下经济对照（T+1 生效）

```csv
strategy,cost_bps,days,cumulative_return,annualized_return,sharpe,max_drawdown,avg_daily_turnover,total_turnover
expanded_universe_equal_weight,10.0,2045,0.8421727316689227,0.07819165171489728,0.41808759793039224,-0.49755833556767004,0.003913330228465843,8.00276031721265
fixed_main5_system_proxy,10.0,1576,1.8350831404247958,0.1813119088626356,0.7460728017100644,-0.4581497797356836,0.0022631133671742808,3.5666666666666664
main5_equal_weight,10.0,1576,1.8350831404247958,0.1813119088626356,0.7460728017100644,-0.4581497797356836,0.0022631133671742808,3.5666666666666664
rule_leadership_rotation,10.0,2045,0.15426048048136232,0.01783536747925263,0.19545588265041142,-0.5724425303701447,0.0823960880195599,168.5
rule_leadership_rotation_defended,10.0,2045,0.45084861685361277,0.04692668242435816,0.3643355064590376,-0.3329756084016062,0.11157541773269627,228.1717292633639
```

## v1 结论与下一步

- Rank IC mean = 0.0023（15 只 dev_universe_v0 为 -0.0130），由负转正但绝对值≈0，仍无预测力；
- Top-Bottom spread = -0.0029，Top 端未跑出稳定超额；
- Rule+防守 Sharpe 0.36 vs Main5 等权 0.75（10bps），**Economic Gate = FAIL / UNPROVEN**。

**结论：扩到 30 只未改变「选池信号无 alpha」的本质，经济表现反而比 15 只更差**（换手↑ + 扩展池整体弱 + 相对强者绝对收益不足）。根因仍是 Leadership Score 规则 Rank IC≈0，非池子大小。

下一步优先级：

1. 提升选池信号本身（Rank IC 仍≈0），这是 Sharpe 上不去的根因；
2. Risk-off 下限制科技 Cluster 重复暴露；
3. 补齐 10 只老 ETF 的长历史（东财源），扩展回测窗口；
4. 重跑敏感性矩阵与分组归因（Bull/Range/Risk-off、Tech/Non-Tech）；
5. 只有正式 Universe + 选池信号 + 防守通过 Economic Gate，才进入 Gen-2.1 Qlib。

> 注：完整分组归因（Bull/Range/Risk-off、Tech/Non-Tech）与敏感性矩阵结果请运行 `python -m gen2.evaluation.attribution` 与 `python -m gen2.baseline.sensitivity_matrix`，本模板只保留结论。

## 重要解释边界

1. `universe_v1` 为正式 30 只选池；其中 10 只老 ETF（医药/酒/消费/红利/银行/券商/有色/煤炭/纳指/标普）腾讯 qfq 仅 640 根约 2.5 年历史，回测早期（2024 年前）universe 不足 30 只。
2. `fixed_main5_system_proxy` 是 Main5 等权代理，并不等同于线上 V3.6.1 完整仓位系统。
3. 数据已统一截止至最近交易日；部分标的由腾讯 qfq 兜底补齐，复权口径需复核。
4. 本报告用于验证工程链路和动态选池信号，不能作为最终经济结论或上线依据。

## 输出文件

- `outputs/feature_matrix_v1.csv`
- `outputs/daily_rankings.csv`
- `outputs/daily_roles.csv`
- `outputs/rotation_events.csv`
- `outputs/portfolio_candidates.csv`
- `outputs/portfolio_candidates_defended.csv`
- `outputs/labels_v1.csv`
- `outputs/rank_ic_by_date.csv`
- `outputs/top_bottom_spread.csv`
- `outputs/quantile_forward_returns.csv`
- `outputs/cluster_exposure.csv`
- `outputs/cluster_concentration.csv`
- `outputs/core_residence_days.csv`
- `outputs/universe_eligibility.csv`
- `outputs/feature_coverage.csv`
- `outputs/benchmark_nav.csv`