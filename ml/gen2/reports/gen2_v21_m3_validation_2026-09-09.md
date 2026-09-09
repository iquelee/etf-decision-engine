# Gen-2.1 M3 报告 v2（M3-r2）— Turnover-aware Replacement + Stateful 三臂 Validation（2026-09-09）

状态：M3 研究交付（Validation 2024 层）。**v2 = 按 M3 审批 REQUEST CHANGES 修复 4 阻断项后重跑**：
①Gate #4 实际 weight_delta + 隐藏常数入 DRAFT；②replacement one-to-one + 同簇强制；③真实 Replacement Payoff（pairing 重建）；④Freeze 参数全部落定 basis。**修复后核心结论不变且证据更硬：三臂成本后仍跑输 Main5；Replacement Payoff 为负（替换门批准了错误换仓）→ Gate 允许关闭、min_quality 不冻结；Freeze 前置走 B′（冻结 Gate-OFF 配置 → M4 → M5）。**

## 〇、协议裁决记录

- **A（先 M4 再 Freeze）不合法**：与已批准 v0.4 固定顺序（M3 → Freeze Point → M4 → M5）冲突。
- **B′（批准路线）**：Freeze Gate-OFF v2.1.0 → M4（Frozen Historical Event Evaluation）→ M5（Economic Replay）。2025+ Frozen 段此前未被任何调参触碰，可作为 v2.1.0 的评价段。
- 若 M3 FAIL 判收：v2.1.0 冻结为 Gate-OFF 配置；**不偷看 2025+ 做调参**。

## 一、M3-r2 修复明细（对应审批 4 BLOCK）

| # | 阻断项 | 修复 |
|---|---|---|
| 1 | **Gate #4 不合格**（alpha→excess 映射 `alpha_to_excess_bps`/`hold_days_for_breakeven` 是隐藏参数；成本用固定 `max_single_weight=0.25` 而非实际 weight_delta；易退化 gate3） | 映射常数全量入 DRAFT `turnover_aware_replacement.replacement` 标注 **design-fixed**（改须重走协议）；成本 = **实际 weight_delta**（=1/当日 CORE 池上限，运行时按组合状态计算）× cost_bps × 2 + `cost_buffer_bps`；新单测 `test_gate4_uses_actual_weight_delta` 验证成本随实际口径变化 |
| 2 | **一对多匹配 bug**（accepted 后未从 promoted_indices 消费 → 同一 challenger 可批准多次）+ 跨簇 fallback | 严格 **1 challenger ↔ 1 incumbent**：accepted 后立即 consume；**同簇强制**：无同簇 challenger → `REPLACEMENT_REVOKED_NO_CLUSTER`（禁跨簇）；新单测 `test_replacement_pair_is_one_to_one` / `test_no_cross_cluster_replacement` |
| 3 | **Replacement Payoff 未测出**（记在 incumbent 行、无 pairing、口径错） | roles 输出 `replacement_pair="challenger\|incumbent\|cluster"`（落 challenger 行）；diagnostics 重建 challenger−incumbent 的 20/40D 收益差（close 归一化），purge=40D 后窗口，超窗计入 `purged_pairs`；若确 n=0 才可写"无法估值" |
| 4 | **Freeze 参数未落定** | DRAFT `turnover_aware_replacement.params_status` 全量标注：top_cluster_count/min_members/breadth_min_pos/cost_buffer_bps/consolidation_enabled = **validation-selected**；leaders_per_cluster/min_hold_days/cost_bps/alpha_to_excess_bps/hold_days_for_breakeven = **design-fixed**；min_quality = not-selected |

## 二、Validation 2024 三臂经济矩阵（M3-r2 重跑，stateful、全程推进、窗口统计）

口径：状态机自数据起点全程推进，账本窗口切 2024-01-01~2024-12-31（242 执行日）。V2.1 参数全部读 DRAFT。

| strategy | cost_bps | n_days | cumulative | Sharpe | MDD | Turnover |
|---|---:|---:|---:|---:|---:|---:|
| main5_pit | 10 | 242 | **+0.3048** | 1.29 | −11.0% | 3.18 |
| universe_ew | 10 | 242 | +0.1058 | 0.51 | −22.2% | 3.03 |
| v21_gate_off | 10 | 242 | **+0.0070** | 0.12 | −11.7% | 16.73 |
| v21_gate_40 | 10 | 242 | −0.0308 | −0.21 | −10.9% | 12.62 |
| v21_gate_60 | 10 | 242 | −0.0132 | −0.22 | **−4.4%** | **7.76** |

对比 v1（未修）：gate_off −0.6% → **+0.7%**（5 硬门修复减少无效换仓的边际改善）；gate_40/gate_60 仍负。总体：**Gate ON 无成本后增量，Gate OFF 最优但仍远逊 Main5**。

## 三、事件诊断 + Replacement Payoff（M3-r2，2024 段，purge=40D）

| arm | promos | repl_accepted | repl_revoked | cluster_block | consol_block | avg_hold(d) | pair_signal | pair_purged | payoff20_n | payoff20_mean | payoff20_pos | payoff40_n | payoff40_mean |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| gate_off | 56 | 14 | 111 | 159 | 0 | 14.3 | 45 | 71 | **11** | **−1.81%** | 27% | 8 | −2.62% |
| gate_40 | 28 | 4 | 88 | 158 | 204 | 15.4 | 8 | 10 | 3 | −4.68% | 0% | 3 | −1.32% |
| gate_60 | 12 | **0** | 0 | 192 | 390 | 11.3 | 0 | 0 | 0 | — | — | 0 | — |

**决定性发现（M3-r2 首次测出真实 Payoff）**：
- **Replacement Payoff 为负**：gate_off 的 14 次成功替换，challenger 相对 incumbent 后 20D 平均 **−1.81%**（正占比仅 27%）、40D **−2.62%** → **被替换的现任反而更优，替换门批准了错误的换仓**（这正是 V2.1 跑输 Main5 的直接机制）。
- 事件配对数 > accepted（45 vs 14）说明部分 pairing 的 REVOKED_NO_CLUSTER/REVOKED 也有记录——但 payoff 只统计 accepted（成功换仓）。
- gate_40 修得更严（4 次替换）→ 20D −4.68% 更差（仅剩高 alpha 差的替换反而错得更离谱，n=3 样本小需谨慎）；gate_60 禁换 → 消除该损失但组合无正收益来源。
- **avg_core_hold 14.3D（gate_off）**：min-hold 5D 未主导持有期，CORE 更替主要来自 cluster cap 挤压的被动换仓。

## 四、Gate 判定（预注册纪律）

| 预注册指标 | 结果（cost10，2024） | 判定 |
|---|---|---|
| 成本后净增量 > 0（vs Main5） | gate_off +0.7% vs Main5 +30.5% | ❌ FAIL |
| Turnover 明显下降 | 16.7 → 12.6 → 7.8（gate_60 ↓54%） | ✅ PASS |
| Replacement Payoff > 0 | **20D −1.81% / 40D −2.62%（负）** | ❌ FAIL |
| 成本后收益提升 | Gate ON 更差（−3.1%/−1.3% vs OFF +0.7%） | ❌ FAIL |
| MDD 不恶化 | −11.7% → −4.4%（改善） | ✅ PASS |

```text
Consolidation Gate 启用判定 = NOT SUPPORTED
min_quality                    = NULL / NOT SELECTED
v2.1.0 默认配置                = Gate OFF
Freeze 路线                    = B′：冻结 Gate-OFF v2.1.0 → M4 → M5（2025+ 未触碰，评价有效）
```

**深层机制结论**：问题不在 Consolidation Gate（OFF 已最优），而在**替换/换仓本身不创造价值（Payoff 负）**。Cluster/consolidation 选出的 challenger 相对现任无正超额 —— 与 WP9.2「Promotion-Actionable alpha 正但在经济层被成本与错误换仓吞噬」一脉相承。这为 v2.1.1（若需）指明方向：要么改进 challenger 质量信号，要么大幅减少替换触发。

## 五、文件与验证

| 文件 | 内容 |
|---|---|
| `portfolio/turnover_aware_replacement.py` | 5 硬门 + 实际 weight_delta 成本 + design-fixed 常数（r2） |
| `baseline/rule_v21_ab.py` | V2.1 状态机（one-to-one/同簇强制/pairing 输出，r2；V2 零改动） |
| `evaluation/v21_diagnostics.py` | 事件诊断 + 真实 pairing payoff（r2） |
| `tests/` | 20 项单测（replacement 14 + rule_v21 6）全绿；npm test 18/18 |
| DRAFT | `replacement` design-fixed 全量 + `params_status` 落定 + `m3_result` r2 |

## 六、口径记录（M3 报告强制字段）

`max_forward_horizon=40`（协议）；2024 窗口事件级 payoff：signal 日 + 20/40D 不跨 2024-12-31（purge），gate_off purged_pairs=71 如实标注；`effective_signal_start=2024-01-01`、`effective_signal_end≈2024-11-05`（M2 报告已述）。pairing 明细落 `outputs/gen2_v21_m3_replacement_pairs.csv`。DRAFT 未含任何 immutable LOCK（Freeze Point 在用户批准 B′ 后触发）。
