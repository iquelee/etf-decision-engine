# Gen-2 B1 研究基线（WP-G2-02）

**口径**：唯一权威角色语义 `rule_v2_ab.build_v2_roles` + 唯一权威账本 `backtest/ledger.run_ledger`。
产物目录：`ml/gen2/outputs/b1_ledger_baseline_20260911/research/`（未入库，可复现）。
历史同类报告已标注为**旧角色语义审计基线**，不可与本文件逐位比较。

> **组合有效性守卫（本报告自动执行）**：声明了旋钮、但组合指标与 `baseline` 逐位相同的场景
> 一律判为 `portfolio_effective=false`，**不得作为组合敏感性结论引用**；
> 信号层仍有差异的标 `signal_only=true`（只展示 Rank IC 类指标），两层都无差异的单列「完全无效」。
> 场景声明指纹：`766aa6be5444db04`；登记表：`sensitivity_matrix.REGISTERED_INEFFECTIVE`。

> ⚠️ **本版有 6 个场景不可作为组合结论**：`rs_heavy`(F1)、`momentum_heavy`(F1)、`trend_heavy`(F1)、`quality_heavy`(F1)、`top_q30`(F2)、`top_q40`(F2)
> 组合敏感性结论**只能**引用下面的「组合敏感性」表。

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

## 3. 组合敏感性（`portfolio_effective = true`）

| 场景 | 累计收益 | Sharpe | MDD | 总换手 | RankIC 均值 | 声明差异 |
|---|---|---|---|---|---|---|
| baseline | +0.448 | 0.229 | -0.542 | 225 | 0.00269 | — |
| promotion3 | +0.553 | 0.252 | -0.425 | 289 | 0.00269 | promotion_persistence_days=3；demotion_persistence_days=3 |
| promotion10 | +0.196 | 0.162 | -0.570 | 144 | 0.00269 | promotion_persistence_days=10；demotion_persistence_days=10 |
| cluster_cap3 | +0.727 | 0.288 | -0.512 | 225 | 0.00269 | max_core_per_cluster=3 |
| core3 | +0.338 | 0.203 | -0.527 | 225 | 0.00269 | max_core_count=3 |
| core7 | +0.450 | 0.230 | -0.543 | 223 | 0.00269 | max_core_count=7 |

## 3.1 信号层敏感性（`signal_only = true`，`portfolio_effective = false`）

> 这些场景的旋钮**没有改变 V2 状态机消费的 Alpha**，其组合指标与 baseline 逐位相同，
> 因此**只展示信号层指标**；组合净值 / Sharpe / MDD **不得引用**。
> 修复工作项：WP-G2-05（`selection_scores` 显式注入链）。

| 场景 | RankIC 均值 | IC>0 占比 | signal_only | portfolio_effective | 登记 |
|---|---|---|---|---|---|
| rs_heavy | 0.01296 | 0.516 | true | false | F1 |
| momentum_heavy | 0.00231 | 0.496 | true | false | F1 |
| trend_heavy | 0.01587 | 0.520 | true | false | F1 |
| quality_heavy | -0.02162 | 0.484 | true | false | F1 |

## 3.2 完全无效（旋钮未被任何一层读取，`signal_only=false`）

> 这些场景既没有改变组合、也没有改变信号：声明的旋钮当前**没有任何代码读取**。
> 不得作为任何结论展示；需按登记工作项改为显式角色阈值配置（`role_thresholds`）。

| 场景 | 声明差异 | RankIC 均值 | signal_only | portfolio_effective | 登记 |
|---|---|---|---|---|---|
| top_q30 | top_quantile=0.3 | 0.00269 | false | false | F2 |
| top_q40 | top_quantile=0.4 | 0.00269 | false | false | F2 |

## 4. 问题登记与裁决（2026-09-11）

### F1 · 权重类场景未进入 V2 状态机消费的 Alpha —— **必须修，进入 WP-G2-05**
根因：`build_v2_roles` 内部对 `features` 静默重算 `alpha_score_v2` 并作为排名依据，
外部传入的 `weights` 只作用于 `rankings.leadership_score`，**不影响角色决策**。
裁决（用户）：
1. 禁止 `build_v2_roles` 内部静默重算并覆盖外部已提供的 Alpha；
2. 新增显式、可校验的 `selection_scores` 输入（键 `trade_date + code`；必须覆盖当日全部 eligible ETF；
   分数必须有限；记录 `score_version` / `score_source` / 内容哈希；缺失、重复、覆盖不完整即失败，
   **不得 fallback 到另一套分数**）；
3. 正式 Rule V2 入口传 canonical Alpha，敏感性实验传替代 Alpha；
4. **在本包合并前**，权重类场景必须从组合敏感性报告中移除或标记为 `signal_only = true` / `portfolio_effective = false`
   （本报告已按此执行），只能保留为 Rank IC 的信号层分析。

### F2 · `top_quantile` 语义含混且不生效 —— 改为显式角色分层配置
裁决（用户）：**不删除配置，也不保留 `top_quantile`**，改为：

```json
{ "role_thresholds": { "core_top_fraction": 0.20, "challenger_top_fraction": 0.30, "satellite_top_fraction": 0.40 } }
```

含义为「位于前多少比例」（不需要 `1 - top_quantile` 反向推导）；校验规则：
`0 < core_top_fraction <= challenger_top_fraction <= satellite_top_fraction < 1`；
默认值必须与当前行为一致（避免把配置清理混成策略调参）；旧 `top_quantile` 仅作迁移审计字段保留，
退出运行路径，新 bundle 生效后禁止再读取。

### F3 · 敏感性费用档白跑 4 倍 —— **保留在 WP-G2-02（本包）**
`evaluate_scenario` 只关心单档 `cost_bps`，但内层 `run_rotation_backtest` 自行重载配置跑满 4 档。
已加 `cost_levels` 显式参数：运行时间约 38min → 10min，**数值不变**，不影响策略解释。

## 5. 边界

- 以上均为**研究基线**，不构成 Rule V2 的经济结论；不冻结 bundle/lock、不重跑 OOS、
  不改 authority / 部署 / 正式仓位。
- 复现：`PYTHONPATH=ml python -m gen2.baseline.rebuild_baselines`（B1 账本基线）、
  三个研究脚本（角色基线 / 归因 / 敏感性，输出隔离到 `research/`）、
  本报告：`PYTHONPATH=ml python -m gen2.baseline.rebuild_research_baselines`。
