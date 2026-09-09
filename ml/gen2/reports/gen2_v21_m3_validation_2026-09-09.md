# Gen-2.1 M3 报告 v3（M3-r3）— Turnover-aware Replacement + Stateful 三臂 Validation（2026-09-09）

状态：M3 研究交付（Validation 2024 层）。**v3 = 按 M3-r2 复审修复 5 技术缺口 + 1 协议级问题后重跑**：
①weight_delta → **projected trade weight**（真实 cap 后目标权重）；②**cluster Replacement Payoff + bootstrap CI** 补齐预注册指标；③**pairing 窗口确定性 bug** 修复；④**参数 provenance 统一**（去 selected/design-fixed 自相矛盾）；⑤**2025+ 降级 contaminated** 标注。
**核心结论不变且证据链完整：三臂成本后仍跑输 Main5（bootstrap CI 上界 ≈0）；Replacement Payoff vs incumbent 为负、vs cluster 无优势 → 换仓不创造价值 → Gate 允许关闭、min_quality 不冻结；Freeze 走 B′ 但 2025+ M4/M5 降级为 post-hoc diagnostics。**

## 〇、协议裁决记录（r3 修正）

- **A（先 M4 再 Freeze）不合法**：违反 v0.4 固定顺序（M3 → Freeze Point → M4 → M5）。
- **B′**：Freeze Gate-OFF v2.1.0 → M4 → M5。**修正（r3）**：M3 早期查看过全样本（含 2025+）→ 2025+ **已 contaminated**，M4/M5 在其上的结果只能称 **contaminated/post-hoc historical diagnostics**，不得宣称 Frozen Evaluation；**真正资格由未来 Live Shadow 提供**。恢复 untouched 地位须单独修改研究协议并经审批。
- 2024 Validation 内结论不受影响（那是 Freeze 前合法选择段）。

## 一、M3-r3 修复明细（对应复审 BLOCK）

| # | 阻断项 | 修复 |
|---|---|---|
| 1 | **weight_delta ≠ 真实目标权重**（1/CORE 数未过 25/40/65 cap） | 权重构建抽纯函数 `portfolio/weights.py::compute_core_weights`（单一实现，状态机尾部与 Replacement 共用）；Replacement Gate 用 **`projected_trade_weight`** = 替换后 tentative CORE 集（去 incumbent 加 challenger）经完整 cap 的 challenger 实际目标权重；单测 8 项（含 2 CORE→cluster cap 0.20、5 CORE 异簇→0.25 语义） |
| 2 | **预注册指标未兑现**（vs_cluster、bootstrap CI 缺） | diagnostics 补 `vs_cluster` 20/40D（challenger − 簇等权 close 收益）；经济 runner 补 `cost_net_increment vs Main5` **block bootstrap 95% CI**（block=20, n=2000, seed 42）落 `gen2_v21_m3_bootstrap.csv` |
| 3 | **pairing 窗口 bug**（signal 只限 ≥start 未限 ≤end → 2025+ pairing 混入；pair_signal=45 vs accepted=14 异常根因） | `_replacement_payoff` signal 严格限定 `[window_start, window_end]`；purged 拆 `purged_20d / purged_40d` 分列；修复后 **pair_signal 45→14 = 与 accepted 对齐** |
| 4 | **provenance 自相矛盾**（cost_buffer_bps design-fixed/validation-selected 双标；无 2024 比较证据的标 selected） | 统一：cost_buffer_bps = design-fixed（未做校准实验）；top_cluster_count/cluster_min_members/breadth_min_pos = **validation-retained**（M1 Development 草案保留，未经 2024 选择，非 selected）；consolidation_enabled = validation-selected（M3 真做了 2024 三臂对比）；公式字段同步 `cost = projected_weight_delta × cost_bps × 2 + cost_buffer_bps` |
| 5（协议） | **2025+ 不是 untouched**（M3 早期查看全样本） | 全文档 + DRAFT `freeze_point_status` / `m3_result.evaluation_status_2025plus` 标注 contaminated/post-hoc；不恢复 untouched 宣称 |

## 二、Validation 2024 三臂经济矩阵（M3-r3 重跑，stateful）

| strategy | cost10 累计 | Sharpe | MDD | Turnover | vs Main5 日超额 mean | bootstrap 95% CI |
|---|---:|---:|---:|---:|---:|---:|
| main5_pit | +30.5% | 1.29 | −11.0% | 3.2 | — | — |
| universe_ew | +10.6% | 0.51 | −22.2% | 3.0 | — | — |
| **v21_gate_off** | **+0.7%** | 0.12 | −11.7% | 16.7 | **−0.00114/日** | **[−0.00280, −0.00001]** |
| v21_gate_40 | −3.1% | −0.21 | −10.9% | 12.6 | −0.00131/日 | [−0.00322, −0.00009] |
| v21_gate_60 | −1.3% | −0.22 | −4.4% | 7.8 | −0.00126/日 | [−0.00355, +0.00013] |

**bootstrap 读数**：gate_off/gate_40 的 CI 上界 ≤ −0.00001（显著为负）；gate_60 CI 含 0（换手极低、MDD 最优但收益无增量）。**成本后净增量 ≤ 0 成立。**

## 三、事件诊断 + Replacement Payoff（M3-r3，2024，purge=40D 分列）

| arm | promos | repl_acc | repl_rev | pair_sig | purged20 | vs_inc20 n | vs_inc20 mean | vs_inc20 pos | vs_clu20 n | vs_clu20 mean | vs_inc40 mean | vs_clu40 mean |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| gate_off | 56 | 14 | 111 | **14** | 3 | 11 | **−1.81%** | 27% | 11 | **+0.82%** | −2.62% | −0.18% |
| gate_40 | 28 | 4 | 88 | 4 | 1 | 3 | −4.68% | 0% | 3 | −0.04% | −1.32% | +0.71% |
| gate_60 | 12 | 0 | 0 | 0 | 0 | 0 | — | — | 0 | — | — | — |

**修复后读数（pair_signal 与 accepted 精确对齐）**：
- **vs incumbent 为负**：gate_off 替换 20D −1.81%（pos 27%）、40D −2.62% → 被换现任更强。
- **vs cluster 无优势**：gate_off 20D **+0.82%**（challenger 略强于簇平均）但 40D 回落 −0.18% → 换仓带来的相对簇增量小且不持久，被两腿成本（cost10）吞噬 → **净值为负**。
- 机制定性：替换门选出的 challenger 仅"比差的现任略好"，相对簇等权无持续优势——**换仓本身不创造价值**（与 WP9.3A 全池 rotation cost 结论一致）。

## 四、Gate 判定（预注册纪律）

| 预注册指标 | 结果（cost10，2024） | 判定 |
|---|---|---|
| 成本后净增量 > 0（vs Main5） | −0.00114/日 [−0.00280, −0.00001] | ❌ FAIL |
| Turnover 明显下降 | 16.7→12.6→7.8（gate_60 ↓54%） | ✅ PASS |
| Replacement Payoff（vs incumbent）> 0 | 20D −1.81% / 40D −2.62% | ❌ FAIL |
| Replacement Payoff（vs cluster）> 0 | 20D +0.82% 但 40D −0.18%（不持久） | ⚠️ 边际/不通过 |
| MDD 不恶化 | −11.7% → −4.4%（改善） | ✅ PASS |

```text
Consolidation Gate 启用判定 = NOT SUPPORTED
min_quality                    = NULL / NOT SELECTED
v2.1.0 默认配置                = Gate OFF（cluster 层 + 5 硬门保留）
Freeze 路线                    = B′：Freeze Gate-OFF v2.1.0 → M4 → M5
2025+ 评价地位                 = contaminated / post-hoc diagnostics（非 Frozen Evaluation）
最终资格                       = 未来 Live Shadow
```

## 五、文件与验证

| 文件 | 内容 |
|---|---|
| `portfolio/weights.py`（新） | `compute_core_weights` / `projected_trade_weight` 单一权重实现（25/40/65 cap） |
| `portfolio/turnover_aware_replacement.py` | 5 硬门（weight_delta 由 projected 提供） |
| `baseline/rule_v21_ab.py` | 状态机（projected weight 接入 + bootstrap CI 输出；V2 零改动） |
| `evaluation/v21_diagnostics.py` | vs_inc + vs_cluster payoff、窗口上限修复、purged 分列 |
| `tests/` | weights 8 + replacement 14 + rule_v21 8 = **30 项**全绿 |
| DRAFT | replacement/params_status/freeze_point_status/m3_result 全量 r3 同步 |

npm test 18/18 全绿；V2 零改动；2025+ 未再触碰（本次仅 2024 窗口）。

## 六、口径记录（M3 报告强制字段）

`max_forward_horizon=40`；2024 窗口 `effective_signal_start=2024-01-01`、`effective_signal_end≈2024-11-05`（M2 报告）；pairing 明细 `outputs/gen2_v21_m3_replacement_pairs.csv`；bootstrap `outputs/gen2_v21_m3_bootstrap.csv`。DRAFT 未含 immutable LOCK（Freeze 待用户批准 B′）。
