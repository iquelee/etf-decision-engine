# Gen-2 B1 研究基线（WP-G2-02）

**口径**：唯一权威角色语义 `rule_v2_ab.build_v2_roles` + 唯一权威账本 `backtest/ledger.run_ledger`。
产物目录：`ml/gen2/outputs/b1_ledger_baseline_20260911/research/`（未入库，可复现）。
历史同类报告已标注为**旧角色语义审计基线**，不可与本文件逐位比较。

> **组合有效性守卫（本报告自动执行）**：声明了旋钮、但组合指标与 `baseline` 逐位相同的场景
> 一律判为 `portfolio_effective=false`，**不得作为组合敏感性结论引用**；
> 信号层仍有差异的标 `signal_only=true`（只展示 Rank IC 类指标），两层都无差异的单列「完全无效」。
> 场景声明指纹：`8fcdf96dda876db2`；登记表：`sensitivity_matrix.REGISTERED_INEFFECTIVE`。

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
| baseline | +0.448 | 0.229 | -0.542 | 225 | 0.04017 | — |
| rs_heavy | -0.064 | 0.075 | -0.496 | 218 | 0.01733 | 选择评分=trend:0.15|rs:0.35|stage:0.1|momentum:0.1|consolidation:0.1|breakout:0.05|volatility:0.05|liquidity:0.05|diversification:0.05 |
| momentum_heavy | +0.031 | 0.102 | -0.365 | 220 | 0.00656 | 选择评分=trend:0.2|rs:0.25|stage:0.1|momentum:0.2|consolidation:0.05|breakout:0.05|volatility:0.05|liquidity:0.05|diversification:0.05 |
| trend_heavy | +0.142 | 0.146 | -0.553 | 206 | 0.01853 | 选择评分=trend:0.3|rs:0.2|stage:0.1|momentum:0.1|consolidation:0.1|breakout:0.05|volatility:0.05|liquidity:0.05|diversification:0.05 |
| quality_heavy | +0.287 | 0.191 | -0.366 | 206 | -0.01594 | 选择评分=trend:0.15|rs:0.2|stage:0.15|momentum:0.1|consolidation:0.1|breakout:0.05|volatility:0.1|liquidity:0.05|diversification:0.1 |
| promotion3 | +0.553 | 0.252 | -0.425 | 289 | 0.04017 | promotion_persistence_days=3；demotion_persistence_days=3 |
| promotion10 | +0.196 | 0.162 | -0.570 | 144 | 0.04017 | promotion_persistence_days=10；demotion_persistence_days=10 |
| cluster_cap3 | +0.727 | 0.288 | -0.512 | 225 | 0.04017 | max_core_per_cluster=3 |
| core_top30 | +0.580 | 0.259 | -0.545 | 257 | 0.04017 | role_thresholds={'core_top_fraction': 0.3, 'challenger_top_fraction': 0.3, 'satellite_top_fraction': 0.4} |
| core_top40 | +0.308 | 0.195 | -0.568 | 283 | 0.04017 | role_thresholds={'core_top_fraction': 0.4, 'challenger_top_fraction': 0.4, 'satellite_top_fraction': 0.4} |
| core3 | +0.338 | 0.203 | -0.527 | 225 | 0.04017 | max_core_count=3 |
| core7 | +0.450 | 0.230 | -0.543 | 223 | 0.04017 | max_core_count=7 |

## 3.1 信号层敏感性（`signal_only = true`，`portfolio_effective = false`）

> 这些场景的旋钮**没有改变 V2 状态机消费的 Alpha**，其组合指标与 baseline 逐位相同，
> 因此**只展示信号层指标**；组合净值 / Sharpe / MDD **不得引用**。
> 修复工作项：WP-G2-05（`selection_scores` 显式注入链）。
> **本版为空** = 没有场景被判为「组合无效应」（F1/F2 修复后，替代 Alpha 与角色阈值均已真正生效）。

| 场景 | RankIC 均值 | IC>0 占比 | signal_only | portfolio_effective | 登记 |
|---|---|---|---|---|---|
| — | — | — | — | — | 无 |

## 3.2 完全无效（旋钮未被任何一层读取，`signal_only=false`）

> 这些场景既没有改变组合、也没有改变信号：声明的旋钮当前**没有任何代码读取**。
> 不得作为任何结论展示；需按登记工作项改为显式角色阈值配置（`role_thresholds`）。
> **本版为空** = 不存在「旋钮完全没被读取」的场景。

| 场景 | 声明差异 | RankIC 均值 | signal_only | portfolio_effective | 登记 |
|---|---|---|---|---|---|
| — | — | — | — | — | 无 |

## 4. 问题登记与处置（2026-09-11）

### F1 · 权重类场景未进入 V2 状态机消费的 Alpha —— **已修（WP-G2-05）**
根因（修复前）：`build_v2_roles` 内部对 `features` 静默重算 `alpha_score_v2` 并作为排名依据，
外部传入的 `weights` 只作用于 `rankings.leadership_score`，**不影响角色决策** → 场景净值完全相同。

修复（按用户裁决）：
1. `build_v2_roles(features, rankings, config, *, selection_scores)` —— 评分**必须显式注入**，
   内部不再重算、也绝不覆盖外部评分；缺/多/重复/非有限键一律失败，**不 fallback**；
2. 评分带 provenance：`score_version` / `score_source` / 内容哈希（canonical = `bundle.alpha` 等权三因子）；
3. 正式入口传 canonical，敏感性场景传**替代 Alpha**（本报告的 `selection` 列）；
4. JS 侧对称：`computeLeadershipScore` 按同一权重合成、`applySelectionScores` 做精确覆盖校验，
   跨语言 parity 由 `G2S-08` 强制（两端 `score_digest` 必须一致）。
5. 报告守卫：任何「声明了旋钮但组合指标与 baseline 逐位相同」的场景会被自动降级为信号层分析
   （`signal_only=true` / `portfolio_effective=false`）并在生成时**报错**要求登记，除非明确登记在案。

### F2 · `top_quantile` 语义含混且不生效 —— **已改为显式角色分层（WP-G2-05）**
现行契约（`portfolio.role_thresholds`；bundle 侧为 `selection.role_thresholds`，B2 冻结时补齐）：

```json
{ "role_thresholds": { "core_top_fraction": 0.20, "challenger_top_fraction": 0.30, "satellite_top_fraction": 0.40 } }
```

含义为「位于前多少比例」（不需要 `1 - top_quantile` 反向推导）；校验
`0 < core_top_fraction <= challenger_top_fraction <= satellite_top_fraction < 1`；
默认值与旧行为等价（core 0.80 / challenger 0.70 / satellite 0.60），因此这次迁移不是策略调参；
旧 `top_quantile` 只作迁移审计字段（`top_quantile_legacy_audit`），**运行路径不再读取**
（Python 读不到 `role_thresholds` 直接报错；JS 在 bundle 尚未补齐时回落并显式标注
`role_thresholds_source=LEGACY_TOP_QUANTILE_AUDIT`）。

### F3 · 敏感性费用档白跑 4 倍 —— 已修（WP-G2-02）
`evaluate_scenario` 只关心单档 `cost_bps`，但内层 `run_rotation_backtest` 自行重载配置跑满 4 档。
已加 `cost_levels` 显式参数：运行时间约 38min → 10min，**数值不变**。

### F4 · 研究脚本的组合构建口径与权威账本不一致（**新登记，未修**）
`build_portfolio_candidates` 把 CORE 权重重置为等权 `1/n`（**丢弃** `build_v2_roles` 计算的
单只/cluster/广义科技上限），并以 legacy `rank`（leadership 排名）作为 `priority`；
`run_rotation_backtest` 亦不含防守腿。因此研究基线（归因 / 敏感性）与
`rule_v2_ab.run_v2_backtest`（含上限 + 防守）**不是同一组合口径**。
→ 建议单独立项（组合构建层统一），**不在 WP-G2-05 内擅自改动**。

## 5. 边界

- 以上均为**研究基线**，不构成 Rule V2 的经济结论；不冻结 bundle/lock、不重跑 OOS、
  不改 authority / 部署 / 正式仓位。
- WP-G2-05 完成并通过 Python/JS parity 后，仍需 **WP-G2-04 重新生成 bundle/lock**，
  并在此之后基于新实现重跑 B1 与 B3 —— 本报告的重跑早于该时点，仅用于证明 F1/F2 已生效。
- 复现：`PYTHONPATH=ml python -m gen2.baseline.rebuild_baselines`（B1 账本基线）、
  三个研究脚本（角色基线 / 归因 / 敏感性，输出隔离到 `research/`）、
  本报告：`PYTHONPATH=ml python -m gen2.baseline.rebuild_research_baselines`。
