# Gen-2 B1 研究基线（WP-G2-02）

**口径**：唯一权威角色语义 `rule_v2_ab.build_v2_roles` + 唯一权威账本 `backtest/ledger.run_ledger`。
产物目录：`ml/gen2/outputs/b1_ledger_baseline_20260911/research/`（未入库，可复现）。
历史同类报告已标注为**旧角色语义审计基线**，不可与本文件逐位比较。

## 1. 角色基线回测（rule_rotation）

- 报告：`ml/gen2/reports/gen2_b1_research_rule_rotation_20260911.md`
- Manifest：`.../research/manifest_rule_baseline_v2semantics_20260911.json`（新实验记录，**未覆盖**历史 `gen2-exp-0002`）
- 结论：Rule+防守 Sharpe 0.32 vs Main5 PIT 0.49（10bps），**Economic Gate = FAIL / UNPROVEN**。
- 含义：在统一口径下 **Rule V2 的经济价值仍未被证明**（Sharpe 低于 Main5 PIT）；只有 B3 Frozen OOS 有资格给出正式结论。

## 2. 归因基线（attribution）

按 regime（rule / defended / main5 累计收益）：

| regime | 天数 | rule 累计 | defended 累计 | main5 累计 |
|---|---|---|---|---|
| RANGE | 223 | -8.06% | -9.26% | -14.40% |
| RISK_OFF | 896 | -12.05% | +2.72% | +38.24% |
| RISK_ON | 928 | +79.10% | +85.95% | +139.79% |
| UNKNOWN | 1533 | +0.00% | +0.00% | +0.00% |

按科技敞口：

| segment | 天数 | rule 累计 | defended 累计 | main5 累计 |
|---|---|---|---|---|
| TECH_HEAVY | 514 | +68.86% | +42.38% | +82.19% |
| NON_TECH | 3066 | -14.23% | +21.74% | +55.76% |

## 3. 敏感性矩阵（sensitivity_matrix）

| 场景 | 累计收益 | Sharpe | MDD | 总换手 | RankIC 均值 |
|---|---|---|---|---|---|
| baseline | +0.448 | 0.229 | -0.542 | 225 | 0.00269 |
| rs_heavy | +0.448 | 0.229 | -0.542 | 225 | 0.01296 |
| momentum_heavy | +0.448 | 0.229 | -0.542 | 225 | 0.00231 |
| trend_heavy | +0.448 | 0.229 | -0.542 | 225 | 0.01587 |
| quality_heavy | +0.448 | 0.229 | -0.542 | 225 | -0.02162 |
| promotion3 | +0.553 | 0.252 | -0.425 | 289 | 0.00269 |
| promotion10 | +0.196 | 0.162 | -0.570 | 144 | 0.00269 |
| cluster_cap3 | +0.727 | 0.288 | -0.512 | 225 | 0.00269 |
| top_q30 | +0.448 | 0.229 | -0.542 | 225 | 0.00269 |
| top_q40 | +0.448 | 0.229 | -0.542 | 225 | 0.00269 |
| core3 | +0.338 | 0.203 | -0.527 | 225 | 0.00269 |
| core7 | +0.450 | 0.230 | -0.543 | 223 | 0.00269 |

## 4. 本轮暴露的三个问题（登记，未擅自改语义）

### F1 · 权重类敏感性场景在 V2 语义下不再影响组合（**重要**）
`rs_heavy`, `momentum_heavy`, `trend_heavy`, `quality_heavy`, `top_q30`, `top_q40` 与 `baseline` 的累计收益完全相同（0.448333），但 RankIC 各不相同 → 说明 `weights` 只影响 `rankings.leadership_score`，**不影响组合结果**。

根因：V2 权威状态机 `build_v2_roles` 内部对 `features` 重新计算 `alpha_score_v2` 作为排名依据，
`rankings` 只用于 merge（cluster / name）；而 `compute_leadership_score(weights=...)` 产出的 `leadership_score` 不再参与角色决策。
旧 legacy 状态机直接消费 `rankings.rank_percentile`，所以当时权重重配会改变结果 —— 迁移到权威语义后该通路失效。

→ 处置建议（**WP-G2-05**，不在 B1 内改）：把权重敏感性改为注入到 V2 alpha 的计算入口，
或把「权重类场景」降级为「IC 敏感性」并明确标注其不测组合。**不能**让不生效的场景继续以组合收益的名义展示。

### F2 · `top_quantile` 在 V2 中已不再影响角色
`top_q30` / `top_q40` 与 baseline 同值：`build_v2_roles` 中晋升/降级阈值已硬编码为 `core_pct=0.80` / `satellite_pct=0.60`，
配置里的 `portfolio.top_quantile` 不再被 V2 读取。→ 需裁决：把阈值改回可配置，还是在配置中删除该字段（避免误导）。

### F3 · 敏感性场景的费用档被白跑 4 倍（已修）
`evaluate_scenario` 本意只跑单档 `cost_bps`，但内层 `run_rotation_backtest` 自行重载配置，实际跑满 4 档后又被外层过滤掉。
已为 `run_rotation_backtest` 增加 `cost_levels` 显式参数并由敏感性矩阵传入单档 —— 运行时间由约 38 分钟降至约 10 分钟，**数值不受影响**。

## 5. 边界

- 以上均为**研究基线**，不构成 Rule V2 的经济结论；不冻结 bundle/lock、不重跑 OOS、不改 authority / 部署 / 正式仓位。
- 产物目录未入库（`outputs/` 已在 .gitignore）；可用 `PYTHONPATH=ml python -m gen2.baseline.rebuild_baselines` 与三个研究脚本复现。
