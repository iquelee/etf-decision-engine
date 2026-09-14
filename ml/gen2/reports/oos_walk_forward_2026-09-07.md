# Gen-2 Walk-Forward OOS 报告（工作包 4 / F10）

> ⚠️ **旧角色语义审计基线 —— 不可与新结果逐位比较**
>
> 本报告产生于 PR #24 之前：角色语义来自旧实现（缺 NO_CORE 硬门槛与 Selection Permission），
> 回测账本为旧口径（现金腿被计入换手，持有现金缓冲的策略费用最多高估 2 倍）。
> 仅作**审计基线**留存；**不得**用于继续宣称 Rule V2 的经济表现。
> 新基线见 `ml/gen2/reports/gen2_b1_ledger_baseline_20260911.md`（WP-G2-02 / B1，唯一权威角色语义 + 唯一权威账本）。


日期：2026-09-07。规则已冻结（不重新选参），本报告只在独立 test 段评价，train 段完全不进入评价。

## 结论（先给）

1. **全样本 IC 不能作为「已验证」的证据**。修复横截面污染后，全样本 V2 alpha Rank IC = 0.0402；但真正 walk-forward OOS 的 IC mean 只有 **0.0312**，且 **2022 年为负 IC（−0.1344）**，是明确失败年份。
2. **IC>0 占比仅 52.9%**，接近抛硬币。这支持验收报告的判断：信号有研究价值、有状态依赖，但**尚不能宣称「选池有真实增量」**。
3. Top-Bottom 20D spread 平均 **+0.66%**，方向正确但量级很小，且 2022/2024 为负。

## 方法与口径

- 切分：expanding train（`train_years=3`，即 2018–2020 为 in-sample 开发期）+ 单年 test（2021–2026），train 末尾剔除 `purge_days=20 + embargo_days=5` 交易日。
- 规则引擎无「训练」过程，因此「样本外」的诚实定义 = 规则开发窗口之后的年份。
- label：`future_20d_excess_vs_market`（绝对超额，跨 universe 版本稳定）。
- score：`alpha_score_v2`（Trend + RS + Breakout 等权，先固定可排名集合再算横截面）。

## 逐 fold 结果

| fold | test_year | n_days | Rank IC | IC>0 占比 | Top-Bottom spread |
|---|---:|---:|---:|---:|
| 1 | 2021 | 243 | +0.0397 | 0.564 | +0.0064 |
| 2 | **2022** | 242 | **−0.1344** | 0.335 | **−0.0160** |
| 3 | 2023 | 242 | +0.0706 | 0.583 | +0.0145 |
| 4 | 2024 | 242 | +0.0500 | 0.545 | −0.0029 |
| 5 | 2025 | 243 | +0.0732 | 0.613 | +0.0239 |
| 6 | 2026 | 164 | +0.0882 | 0.535 | +0.0138 |

汇总：**OOS Rank IC mean = 0.0312，IC>0 占比 = 0.529，平均 Top-Bottom spread = 0.0066。**

## 与 in-sample 的对比（诚实披露）

| 口径 | Rank IC |
|---|---|
| 全样本（in-sample，因子选定与报告同一批历史） | 0.0402 |
| Walk-forward OOS（2021–2026，独立） | 0.0312 |
| 2022 单年（OOS 失败年份） | −0.1344 |

OOS 弱于 in-sample，且存在负 IC 年份。**结论：当前规则值得继续研究，但收益/回撤改善中有多少来自选池、多少来自降低仓位仍未可靠分离；不得以本结果宣布「选池 Alpha 已通过样本外验证」。**

## 复现

```bash
cd <gen2-dev>
PYTHONPATH=ml python -m gen2.evaluation.walk_forward
```

依赖：`ml/gen2/evaluation/walk_forward.py`（新增），复用 `build_feature_matrix` / `run_rank_engine` / `build_labels_vs_market` / `compute_alpha_score_v2(eligible_only=True)`。

## 下一步（进入下一轮）

- 若要继续研究信号，先在**冻结规则**的前提下，按 regime（RISK_ON/RANGE/RISK_OFF）分状态看 OOS IC，确认负 IC 是否集中在 RISK_OFF（报告信号层已提示 V2 在 RISK_OFF 为 −0.059）。
- 同时把「同风险预算全池等权 / Main5 / 可复原系统基准」纳入同一账本比较（工作包 3 已统一账本与日历，可直接复用）。
