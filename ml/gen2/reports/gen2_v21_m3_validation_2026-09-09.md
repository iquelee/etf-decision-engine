# Gen-2.1 M3 报告 — Turnover-aware Replacement + Stateful 三臂 Validation（2026-09-09）

状态：M3 研究交付（Validation 2024 层）。**核心发现：三臂成本后均跑输 Main5 PIT；Consolidation Gate 显著降换手、改善 MDD，但未把「少换」转化为「换得值」（净收益未转正）→ 按预注册纪律 Gate 允许关闭，min_quality 不冻结**。本报告同时呈现设计正负证据，供审批裁决 M3 收口与 Freeze Point 前置决策。

## 一、M3 交付物

| 文件 | 内容 |
|---|---|
| `ml/gen2/portfolio/turnover_aware_replacement.py` | 5 硬门纯函数（cluster_qualified / consolidation_pass / leadership_superior / edge_gt_cost_hurdle / no_persistence_protection）+ Expected Turnover Cost（weight_delta×cost_bps 计算值）+ tenure 工具。权重固定，无 shadow tuning path |
| `ml/gen2/baseline/rule_v21_ab.py` | V2.1 状态机（**V2 文件零改动**）：逐段对齐 V2 主体，注入 V21-DELTA-1 cluster 准入 / V21-DELTA-2 consolidation Gate / V21-DELTA-3 5 硬门替换；`_prepare_v21_inputs` 共享预计算（多臂省时）；`run_v21_arms` 三臂经济 runner（stateful 全程推进 + 窗口统计） |
| `ml/gen2/evaluation/v21_diagnostics.py` | 事件诊断（2024 段事件计数 / avg hold / replacement fwd20） |
| 单测 | `test_turnover_aware_replacement.py`（11 项）+ `test_rule_v21_ab.py`（5 项：schema/cluster 门/consolidation 门/Gate OFF 晋升）——npm test 18/18 + 单测 25 项全绿 |
| DRAFT | `consolidation_gate.m3_result` + `turnover_aware_replacement.replacement{min_hold_days,cost_bps,max_single_weight}` |

## 二、Validation 2024 三臂经济矩阵（stateful，全程推进、窗口统计）

口径：状态机自数据起点全程推进（保持 DISABLED 日状态连续性），账本经济窗口切 2024-01-01~2024-12-31（242 个执行日）。V2.1 参数读 DRAFT（cluster: top4/min1/leaders2/breadth0.5；replacement: min_hold 5/cost 10）。

| strategy | cost_bps | n_days | cumulative | Sharpe | MDD | Turnover |
|---|---:|---:|---:|---:|---:|---:|
| main5_pit | 0 | 242 | +0.3089 | 1.31 | −11.0% | 3.18 |
| main5_pit | 10 | 242 | **+0.3048** | 1.29 | −11.0% | 3.18 |
| universe_ew | 10 | 242 | +0.1058 | 0.51 | −22.2% | 3.03 |
| v21_gate_off | 10 | 242 | **−0.0059** | 0.02 | −12.3% | 17.50 |
| v21_gate_40 | 10 | 242 | −0.0663 | −0.57 | −11.5% | 14.05 |
| v21_gate_60 | 10 | 242 | −0.0132 | −0.22 | **−4.4%** | **7.76** |

**关键读数**：
- Gate 收紧方向完全符合设计：Turnover 17.5 → 14.0 → 7.8（gate_60 较 OFF ↓56%）；MDD −12.3% → −4.4%（显著改善）。
- 但**成本后净收益三臂全负 / 贴近 0**，Main5 PIT 同期 +30.5% —— V2.1 全池选股在 2024 结构性跑输 Main5 简单等权（与 WP9.3A「全池 rotation cost 主导、vs Main5 无净增量」结论一脉相承）。
- gate_60 虽把 Turnover 压到 Main5 的 ~2.4 倍，MDD 最优，但收益 −1.3% 仍无增量 → **Consolidation「少换」未变成「换得值」**。

## 三、事件诊断（2024 段，机制归因）

| arm | promotions | demotions | repl_accepted | repl_revoked | cluster_gate_blocked | consol_blocked | avg_core_hold(d) |
|---|---:|---:|---:|---:|---:|---:|---:|
| gate_off | 57 | 4 | 15 | 19 | 166 | 0 | 11.3 |
| gate_40 | 32 | 2 | 8 | 4 | 166 | 224 | 11.3 |
| gate_60 | 12 | 3 | **0** | 0 | 192 | 390 | 11.3 |

- **Gate 机械生效**：promotions 57→12、replacement_accepted 15→0（gate_60 完全禁替换）、consolidation_blocked 0→390。
- **avg_core_hold ~11.3 日三臂不变** → min-hold 5 日未拉长实际持有；CORE 更替主要由 cluster cap/排名降级驱动，非替换门。**5 硬门当前只在 cap 挤出现任时触发（被动替换语义），尚未实现「主动换仓控制」** —— 这是本版局限，记入供 v2.1.1。
- repl_fwd20_n=0：2024 内 REPLACEMENT_ACCEPTED 事件的 20D label 大多落在 2025（purge 边界），样本不足 → Replacement Payoff 无法在 2024 内单独估值，需 M4 event-OOS（Frozen 层）或放宽窗口补足。

## 四、Gate 判定（按 M3 预注册纪律，DRAFT `m3_pre_registration`）

| 预注册指标 | gate_off vs 40 vs 60（cost 10，2024） | 判定 |
|---|---|---|
| 成本后净增量 > 0（相对 Main5） | 全负（−0.6% / −6.6% / −1.3%） | ❌ FAIL |
| Turnover 明显下降 | 17.5 → 14.0 → 7.8（↓56%） | ✅ PASS |
| Replacement Payoff 改善 | 2024 样本不足（n=0） | ⚠️ 无法估值 |
| 成本后收益提升 | 无（Gate ON 更差或持平） | ❌ FAIL |
| MDD 不恶化 | −12.3% → −4.4%（改善） | ✅ PASS |

**结论（预注册纪律自动触发）**：
```text
Consolidation Gate 启用判定 = NOT SUPPORTED（2024 未带来成本后增量）
min_quality                    = NULL / NOT SELECTED（不冻结）
v2.1.0 允许 Consolidation Gate = OFF（默认关闭）
```

**注意**：Gate OFF 本身也跑输 Main5（−0.6%）——M3 的负结果不止否定 Consolidation，而是复现 WP9.3A 的根本问题：**30 只全池的 hierarchical selection（含 cluster 层）在 2024 的经济增量 ≤ 0**。Consolidation Gate 不是瓶颈，Selection 构造 + Turnover 才是。

## 五、对 Freeze Point 的影响（提交裁决）

按 PLAN：M3 末 = Freeze Point 前置。但本结果下**不建议立即 Freeze v2.1.0**，三个选项：

- **A. 收口为「V2.1 研究结论」，暂不 Freeze，转 M4 Event-OOS 复核事件级质量**（推荐）：M4 只评价不调参，从事件层确认「promotion/replacement 本身有无 alpha」——区分「选错」与「换错」，为 v2.1.1 设计提供证据。Consolidation Gate 保持 OFF，cluster/turnover-aware 骨架保留。
- **B. Freeze v2.1.0（Gate OFF 配置）进 M5 Economic Replay**：直面「冻结版 vs V2 vs Main5」最终经济表。若 M5 仍 FAIL → §31 Case B 收口，转 Gen-2.2 设计变更。
- **C. 立即转 v2.1.1 设计变更**（active replacement / cluster cap 交互 / 池收缩）：跳过 M4/M5，成本最高且绕过协议关卡。

**推荐 A**：M4 event-OOS 是廉价且协议规定的下一关，其「事件级 alpha 归因」正是决定 B/C 的数据前提。

## 六、口径记录（M3 报告强制字段）

- `max_forward_horizon=40`（协议常量）；`purged_trade_dates / purged_candidate_rows`：2024 账本经济窗口取全年（242 执行日），**事件级 label 因 2024-11 后 40D 触 2025 而 dropna（repl_fwd20_n=0 已如实标注）**；`effective_signal_start=2024-01-01`、`effective_signal_end≈2024-11-05`（由数据 purge 决定，见 M2 报告）。
- 全样本描述矩阵（作为 stateful 连续性 sanity）：gate_off cum +78.6% / gate_40 +72.1% / gate_60 +32.6%（cost10），趋势与 2024 段一致。
- DRAFT `consolidation_gate.min_quality` 保持 NULL；`m3_result` 已写入。
