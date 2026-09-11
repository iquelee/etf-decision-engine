# Gen-2 Rule Leadership Baseline Report v1

**Experiment ID**：`gen2-exp-0002-rule-baseline-universe-v1`
**Universe**：`universe_v1`（正式 30 只 universe_v1 + benchmark 510300）
**Feature**：`feature_v1`
**Label**：`label_v1_excess_rank_20d`
**日期范围**：2018-04-03 至 2026-09-04
**Manifest**：`ml\gen2\outputs\b1_ledger_baseline_20260911\research\manifest_rule_baseline_v2semantics_20260911.json`

## 硬约束

```text
PRODUCTION WRITE = OFF
AUTO TRADING     = OFF
GEN1 MODIFIED    = NO
V361 MODIFIED    = NO
```

## 核心排名指标（v1）

- Rank IC mean：0.0027
- Rank IC > 0 日期占比：50.59%
- Top-Bottom 20D excess spread mean：-0.0025

## 最新一日 Top 10

```csv
rank,code,name,leadership_score,correlation_cluster,rank_percentile
1,512800,银行ETF,81.06977394895009,financial,1.0
2,512000,券商ETF,73.76977394895006,financial,0.9666666666666667
3,510880,红利ETF,72.15555555555557,defensive_dividend,0.9333333333333333
4,159928,消费ETF,67.96033238808104,consumer,0.9
5,159941,纳指ETF,66.43540495243575,overseas_equity,0.8666666666666667
6,513500,标普500ETF,65.46387117720343,overseas_equity,0.8333333333333334
7,159570,港股通创新药ETF,61.443403826620674,healthcare,0.8
8,512010,医药ETF,59.329914892298866,healthcare,0.7666666666666667
9,518880,黄金ETF,58.95555555555555,gold_commodity,0.7333333333333333
10,512690,酒ETF,58.67144349919213,consumer,0.7
```

## 10bps 成本下经济对照（T+1 生效）

```csv
strategy,cost_bps,days,cumulative_return,annualized_return,sharpe,max_drawdown,avg_daily_turnover,total_turnover
expanded_universe_equal_weight,10.0,3580,0.8016639427242429,0.04231058754476158,0.30807023382755555,-0.49744501565285393,0.006745037185343333,24.147233123529134
fixed_main5_system_proxy,10.0,3580,1.8376582119543685,0.0761785736929852,0.4948863964400627,-0.4581497797356828,0.003498438574146184,12.52441009544334
main5_equal_weight,10.0,3580,1.8376582119543685,0.0761785736929852,0.4948863964400627,-0.4581497797356828,0.003498438574146184,12.52441009544334
rule_leadership_rotation,10.0,3580,0.44833261325636853,0.026416656571812025,0.2290989279396288,-0.541888926629867,0.06291687613936471,225.24241657892566
rule_leadership_rotation_defended,10.0,3580,0.733334563811568,0.03947772079935774,0.32085819363494067,-0.4550563536720874,0.0724021716132615,259.1997743754762
```

## v1 结论与下一步

- Rank IC mean = 0.0027；Top-Bottom spread = -0.0025；
- Rule+防守 Sharpe 0.32 vs Main5 PIT 0.49（10bps），**Economic Gate = FAIL / UNPROVEN**。

**结论：Rank IC≈0 的根因不是池子大小，而是 Leadership Score 把「找赢家(Alpha)」和「控风险(Utility)」混成一个分，正负因子互相抵消**（component IC：RS/Breakout/Trend +0.03，Vol/Diversification/Stage/Consolidation -0.02~-0.06）。且分 regime 后 RISK_ON IC +0.075、RISK_OFF IC -0.083——「RISK_ON 会选、RISK_OFF 反着选」。详见 `reports/gen2_p0_experiment_framework_fixes.md`。

下一步优先级（P0 已修实验框架，进入 P1 重构）：

1. P1：重构 Selection Engine（Market Permission → Alpha Leadership → Cluster Ranking → Portfolio Utility → Role），禁止风险因子混入 Alpha Ranking；
2. P2：补 10 只老 ETF 长历史 + 真实 listing_date + 真实成交额；
3. P3：Rule V2（AlphaScore = Trend+RS+Breakout）walk-forward 验证；
4. P4：Economic Gate 重评（Gen2 V2 vs Main5 PIT vs Universe EW vs V3.6.1 Replay）。

> 注：component IC 运行 `python -m gen2.evaluation.component_ic`；归因（含 undefended/defended + defense_state）运行 `python -m gen2.evaluation.attribution`。

## 重要解释边界

1. `universe_v1` 为正式 30 只选池；其中 10 只老 ETF 腾讯 qfq 仅 640 根约 2.5 年历史，回测早期（2024 年前）universe 不足 30 只。
2. `fixed_main5_system_proxy` / `main5_equal_weight` 为 **Main5 PIT 等权**（只对当日已上市有历史的 Main5 重归一化），并非线上 V3.6.1 完整仓位系统，也非「幸存者偏差的固定等权」。
3. 回测采用 T+1 收盘执行假设（收益 close[T+1]→close[T+2]），消除隔夜 lookahead。
4. 数据已统一截止至最近交易日；部分标的由腾讯 qfq 兜底补齐，复权口径需复核。
5. 本报告用于验证工程链路和动态选池信号，不能作为最终经济结论或上线依据。

## 输出文件

- `ml\gen2\outputs\b1_ledger_baseline_20260911\research\rule_rotation\feature_matrix_v1.csv`
- `ml\gen2\outputs\b1_ledger_baseline_20260911\research\rule_rotation\daily_rankings.csv`
- `ml\gen2\outputs\b1_ledger_baseline_20260911\research\rule_rotation\daily_roles.csv`
- `ml\gen2\outputs\b1_ledger_baseline_20260911\research\rule_rotation\rotation_events.csv`
- `ml\gen2\outputs\b1_ledger_baseline_20260911\research\rule_rotation\portfolio_candidates.csv`
- `ml\gen2\outputs\b1_ledger_baseline_20260911\research\rule_rotation\portfolio_candidates_defended.csv`
- `ml\gen2\outputs\b1_ledger_baseline_20260911\research\rule_rotation\labels_v1.csv`
- `ml\gen2\outputs\b1_ledger_baseline_20260911\research\rule_rotation\rank_ic_by_date.csv`
- `ml\gen2\outputs\b1_ledger_baseline_20260911\research\rule_rotation\top_bottom_spread.csv`
- `ml\gen2\outputs\b1_ledger_baseline_20260911\research\rule_rotation\quantile_forward_returns.csv`
- `ml\gen2\outputs\b1_ledger_baseline_20260911\research\rule_rotation\cluster_exposure.csv`
- `ml\gen2\outputs\b1_ledger_baseline_20260911\research\rule_rotation\cluster_concentration.csv`
- `ml\gen2\outputs\b1_ledger_baseline_20260911\research\rule_rotation\core_residence_days.csv`
- `ml\gen2\outputs\b1_ledger_baseline_20260911\research\rule_rotation\universe_eligibility.csv`
- `ml\gen2\outputs\b1_ledger_baseline_20260911\research\rule_rotation\feature_coverage.csv`
- `ml\gen2\outputs\b1_ledger_baseline_20260911\research\rule_rotation\benchmark_nav.csv`