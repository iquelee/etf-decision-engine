# Gen-2.1 M2 Validation 报告 v3 — Consolidation Quality Gate（2026-09-09）

状态：M2 研究交付（Development + Validation 层）。**v3 = 按第二轮审批修订**：①报告措辞改准（非「单调恶化」，见 §五）；②冻结正式结论三行（§五.2）；③**M3 预注册三臂候选**（§六，写入 DRAFT `m3_pre_registration`）；④移除 `compute_consolidation_quality` 的 `weights` override（消除 shadow tuning path，§一）。v2 的两处确定性 bug 修复（sideway_range 单位 / sideway_days 空洞）仍有效，矩阵数据与 v2 相同。

## 〇、冻结结论（M2 正式裁决输出）

```text
Standalone 20D Market-Excess Gate   = NOT SUPPORTED
min_quality                          = NULL / NOT SELECTED（不冻结任何门槛）
Consolidation Score                  = CARRY FORWARD TO M3 STATEFUL VALIDATION
```

方向（审批裁决）：A 采纳（Stateful validation 进 M3）、B 不采纳（不人为定 min_quality=40-50）。

## 一、实现（M2 交付物）

- `ml/gen2/portfolio/consolidation_gate.py`：
  - `compute_consolidation_quality()`：0-100 透明评分（分档映射；**权重固定于透明规则 `_W`，函数不接受 weights 覆盖 —— v3 移除 override，无 shadow tuning path**）；**硬前置 px_ma60>0，否则 quality=0**。
  - `gate_pass(quality, min_quality)`；`--sensitivity`：晋升候选 proxy = top_cluster 的 cluster_leader 且 alpha ≥ 当日 P90；fwd20 = 相对 510300 未来 20D 超额（labels_vs_market）；窗口按协议 purge（MAX_FORWARD_HORIZON=40，label 不触下一层）；**proxy 参数一律读 DRAFT（cluster_leadership 段），无硬编码 shadow config**。
- 单测 **9 项**通过（含 2 个新增回归：`sideway_range_unit_is_decimal`、`sideway_days_no_integer_gap`）。

## 二、v2 修复明细（对应首轮审批 BLOCK 项，v3 保留）

| # | 阻断项 | 修复 |
|---|---|---|
| 1 | `sideway_range` 单位错（源码 = hh20/ll20−1.0 小数，旧档 6.0/9.0 当 6%/9%）| 档位改 `0.06/0.09/0.12/0.15`：<0.06→100、0.06-0.09→80、0.09-0.12→60、0.12-0.15→40、≥0.15→20 |
| 2 | `sideway_days` 整数空洞（旧 `(0,4)(5,9)...`，4/9/14/19/24 掉档=0）| 连续半开 `[0,5)[5,10)[10,15)[15,20)[20,25)[25,∞)` → 0/20/40/60/80/100 |
| 3 | sensitivity 硬编码 cluster 参数（shadow config 回归）| main 从 `GEN2_RULE_V21_DRAFT.json` 的 `cluster_leadership` 段读取 4 参数，缺失即 FATAL 拒绝运行 |
| 4（建议） | purge 只报交易日数，混口径 | 拆分 `purged_trade_dates`（交易日）与 `purged_candidate_rows`（候选行，窗口内先限定再切分） |

## 三、Validation(2024) 敏感度矩阵（阈值选择用）

口径：`max_forward_horizon=40  purged_trade_dates=40  purged_candidate_rows=114  effective_signal_start=2024-01-02  effective_signal_end=2024-11-05`；窗口内候选 479，有效评价 365。

| min_quality | n_passed | pass_ratio | fwd20_mean | fwd20_pos | false_promo |
|---|---|---|---|---|---|
| 0 | 365 | 1.000 | −0.0068 | 0.427 | 0.573 |
| 20 | 306 | 0.838 | −0.0143 | 0.412 | 0.588 |
| 40 | 220 | 0.603 | −0.0196 | 0.405 | 0.596 |
| 50 | 186 | 0.510 | −0.0186 | 0.419 | 0.581 |
| 60 | 143 | 0.392 | −0.0156 | 0.469 | 0.532 |
| 70 | 105 | 0.288 | −0.0181 | 0.495 | 0.505 |
| 80 | 68 | 0.186 | −0.0320 | 0.485 | 0.515 |

## 四、Development(2023) 描述对照（非选择依据）

口径：`purged_trade_dates=40  purged_candidate_rows=61  effective 2023-01-03 → 2023-11-03`；窗口内候选 305，有效评价 244。

| min_quality | n_passed | pass_ratio | fwd20_mean | fwd20_pos | false_promo |
|---|---|---|---|---|---|
| 0 | 244 | 1.000 | +0.0072 | 0.566 | 0.434 |
| 20 | 208 | 0.853 | +0.0089 | 0.572 | 0.428 |
| 40 | 133 | 0.545 | +0.0304 | 0.692 | 0.308 |
| 50 | 97 | 0.398 | +0.0392 | 0.742 | 0.258 |
| 60 | 67 | 0.275 | +0.0399 | 0.716 | 0.284 |
| 70 | 29 | 0.119 | +0.0384 | 0.690 | 0.310 |
| 80 | 6 | 0.025 | +0.0435 | 0.667 | 0.333 |

## 五、核心结论（措辞 v3 修正版）

### 五.1 准确描述（非「单调恶化」）

2024 Validation（选择段）上：**所有 `min_quality > 0` 的 fwd20 均值均未优于 `min_quality=0` 的基线（−0.0068）** —— 整体不支持「quality 越高 → 未来 20D 跑赢市场越多」，但**局部关系并非严格单调**（40→60 段有起伏：−0.0196 → −0.0186 → −0.0156，60 是 >0 门槛中最高点，仍低于 0 基线）。2023（描述段）方向相反（quality↑ → fwd20 改善，+0.007 → +0.044），进一步说明该用法**跨窗口不稳定**。

### 五.2 冻结结论（正式）

```text
Standalone 20D Market-Excess Gate   = NOT SUPPORTED（2024 Validation 拒绝「高分独立预测市场超额」用法）
min_quality                          = NULL / NOT SELECTED
Consolidation Score                  = CARRY FORWARD TO M3 STATEFUL VALIDATION
```

**M2 未证明 Consolidation 无价值** —— 它只证明：把高 `consolidation_quality` 当独立择时器（预测未来 20D 跑赢 510300）在 2024 Validation 不成立。Consolidation 作为「少换/换得值/持得住」质量门的价值，须在 M3 状态机内用真实 promotion/replacement 事件验证。

## 六、M3 预注册（写入 DRAFT `consolidation_gate.m3_pre_registration`）

在跑 M3 结果前预注册三臂候选（**低/中强度结构档位，非历史择优**）：

```text
Arm 1: Gate OFF（min_quality 不生效，仅作对照）
Arm 2: Gate ON,  quality >= 40
Arm 3: Gate ON,  quality >= 60
```

**判定纪律（预注册）**：若 ON 相对 OFF 未明显降低换手 / 未改善 Replacement Payoff / 未提升成本后收益，则 **v2.1.0 允许 Consolidation Gate 关闭** —— 不得为保留「横盘理念」强行选阈值。

M3 对比指标：Turnover / Promotion+Replacement 次数 / Avg Hold Days / Replacement Payoff（vs incumbent、vs cluster）/ 交易成本 / 成本后净增量（bootstrap CI）。

## 七、口径记录（M2 报告强制字段）

两窗口均记录 `max_forward_horizon / purged_trade_dates / purged_candidate_rows / effective_signal_start / effective_signal_end`（见 §三/§四）。v1 被污染矩阵已废弃；v2/v3 矩阵数据相同（v3 仅措辞与治理修订）。

