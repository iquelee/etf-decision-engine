# Gen-2.1 M2 Validation 报告 v2 — Consolidation Quality Gate 敏感度矩阵（2026-09-09）

状态：M2 研究交付（Development + Validation 层）。**v2 = 按审批 REQUEST CHANGES 修复 3 个阻断项后重算**：
①sideway_range 单位修正（build_features 真实口径为小数，6%=0.06）；②sideway_days 分档改连续半开区间消除整数空洞；③sensitivity 从 GEN2_RULE_V21_DRAFT.json 读 cluster 参数（消 shadow config）；另加 ④purge 口径拆分 purged_trade_dates / purged_candidate_rows。

**修复后结论不变（干净证据）**：Consolidation「高分 → 20D 超额改善」假设在 2024 Validation 段仍**未获支持**（甚至反向），2023 描述段单调改善 → 跨窗口冲突成立。提交审批裁决方向（见 §五）。

## 一、实现（M2 交付物）

- `ml/gen2/portfolio/consolidation_gate.py`：
  - `compute_consolidation_quality()`：0-100 透明评分（分档映射，权重固定草案：sideway_days 0.25 / sideway_range 0.25 / volume_ratio_5_20 0.20 / volume_compression_slope 0.15 / volatility_compression 0.15）；**硬前置 px_ma60>0，否则 quality=0**。
  - `gate_pass(quality, min_quality)`；`--sensitivity`：晋升候选 proxy = top_cluster 的 cluster_leader 且 alpha ≥ 当日 P90；fwd20 = 相对 510300 未来 20D 超额（labels_vs_market）；窗口按协议 purge（MAX_FORWARD_HORIZON=40，label 不触下一层）；**proxy 参数一律读 DRAFT（cluster_leadership 段），无硬编码 shadow config**。
- 单测 **9 项**通过（含 2 个新增回归：`sideway_range_unit_is_decimal`、`sideway_days_no_integer_gap`）。

## 二、v2 修复明细（对应审批 BLOCK 项）

| # | 阻断项 | 修复 |
|---|---|---|
| 1 | `sideway_range` 单位错（源码 = hh20/ll20−1.0 小数，旧档 6.0/9.0 当 6%/9%）| 档位改 `0.06/0.09/0.12/0.15`：<0.06→100、0.06-0.09→80、0.09-0.12→60、0.12-0.15→40、≥0.15→20 |
| 2 | `sideway_days` 整数空洞（旧 `(0,4)(5,9)...`，4/9/14/19/24 掉档=0）| 连续半开 `[0,5)[5,10)[10,15)[15,20)[20,25)[25,∞)` → 0/20/40/60/80/100 |
| 3 | sensitivity 硬编码 cluster 参数（shadow config 回归）| main 从 `GEN2_RULE_V21_DRAFT.json` 的 `cluster_leadership` 段读取 4 参数，缺失即 FATAL 拒绝运行 |
| 4（建议） | purge 只报交易日数，混口径 | 拆分 `purged_trade_dates`（交易日）与 `purged_candidate_rows`（候选行，窗口内先限定再切分） |

## 三、Validation(2024) 敏感度矩阵 v2（阈值选择用）

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

## 四、Development(2023) 描述对照 v2（非选择依据）

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

## 五、修复后核心结论（干净矩阵上仍成立）

**Gate 方向跨窗口不一致，2024 Validation 段假设未获支持**（v2 数值下同样单调反向）：
- 2023（描述）：quality ↑ → fwd20 均值单调改善（+0.007 → +0.044，mq 50-60 平台后略回落）→ 符合「横盘缩量=高质量晋升窗口」。
- 2024（选择段）：quality ↑ → fwd20 单调恶化（0 门槛 −0.0068 → 80 门槛 −0.0320）；该段高分 leader 普遍 20D 跑输市场 —— consolidation 高分（横盘久）在 2024 风格下更像「涨后滞涨→回调」。

> 注：v1 矩阵（被 bug 污染）与 v2（修复后）的方向结论一致 —— 说明两个确定性 bug 改变 quality 分布与通过集合，但**未制造**跨窗口冲突。当前冲突由数据本身呈现。

**协议三层切分的意义兑现**：若只看 2023 调 min_quality=60-70，2024 会系统性受损。不能据此硬选阈值，也不能悄悄换更"顺眼"的 metric（违反研究纪律）。

## 六、请审批裁决（方向决策，非我单方可定）

A. **换 Gate 定位**：Consolidation 不预测「未来 20D 超额」，而是「候选是否值得现在占用 promotion/replacement 名额」的少换/质量门 → 评估 metric 改为「通过者 20D 相对未通过者/簇内非候选的增量」或直接进 M3 状态机用真实 PROMOTION 事件做 event-OOS（M4 口径），M2 不单独定阈值。
B. **保留 Gate 但降级为防御**：min_quality 取保守低值（如 40-50），主要拦「完全不整理即追」的极端情形，把经济判断交 M3/M5（成本效率目标）。
C. **调整评分方向再评**：对 Consolidation 语义做修正（如只奖励「已充分整理后重启」而非「长时间横盘」）→ 属设计变更，重走 Validation。
D. **M2 冻结 min_quality=60（基于 2023 的 Development/描述窗口）**：不推荐——违反三层协议。

**推荐 A + B 组合**：M2 阶段不单独给短期超额下结论；Gate 参数进入 M3 状态机联调（真实 promotion/replacement 事件），用 M4 event-OOS 与 M5 经济 Gate 判定价值——与 V2.1「成本效率」目标一致（Consolidation 的意义在持得住/换得值，不在 20D 择时）。

## 七、口径记录（M2 报告强制字段）

两窗口均记录 `max_forward_horizon / purged_trade_dates / purged_candidate_rows / effective_signal_start / effective_signal_end`（见上）。DRAFT `consolidation_gate.min_quality` 保持 null 待裁决。v1 被污染矩阵已废弃（本文件 §三/§四 为唯一有效版本）。
