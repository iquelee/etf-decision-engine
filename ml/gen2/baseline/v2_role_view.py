"""V2 权威角色结果的研究消费视图（研究 / 回测 / 敏感性 / 归因脚本专用）。

角色语义 **100%** 来自 `rule_v2_ab.build_v2_roles`（V2 唯一权威实现，用户裁决 2026-09-11）。
本模块**不做任何角色决策**，只做两件事：

1. 把 `rankings` 的展示 / 排序列（`rank` / `rank_percentile` / `leadership_score`）接到权威结果上，
   供 `portfolio_builder` / `cluster_constraints` 等下游使用；
2. 按权威状态机同口径补 `persistence_days`（`above_core = alpha 前 20% 且过趋势闸门`、
   `below_satellite = alpha < 60%`，与 `build_v2_roles` 内部阈值一致）。

⚠️ 为什么不再用 legacy `role_engine.build_daily_roles`：
   它是**另一套独立状态机**（缺 NO_CORE 硬门槛与 Selection Permission），两套并存会再次语义分叉。
   该实现现已 fail-fast（调用即抛错），需要 legacy 展示列的研究脚本统一改走本视图。

⚠️ 语义变更提示（必须周知）：
   改用本视图后，`rule_rotation` / `sensitivity_matrix` / `attribution` 的产物（换手、归因、敏感性数字）
   反映的是 **V2 语义**（含 NO_CORE 与权限门），与历史报告不再逐位可比；需要重算的产物属
   **WP-G2-02（B1 账本重算）**，本模块只保证「下游列齐备 + 语义来自权威实现」。

WP-G2-05（F1 修复）：**Alpha 必须由调用方显式传入**（`selection_scores`），本视图不重算、不兜底。
   正式入口传 `canonical_selection_scores(features)`；敏感性实验传 `build_selection_scores(...)`。
   角色阈值同样来自显式 `role_thresholds`（本模块不再硬编码 0.80 / 0.60）。
"""
from __future__ import annotations

import pandas as pd

from gen2.baseline.rule_v2_ab import build_v2_roles
from gen2.baseline.selection_scores import SelectionScores, canonical_selection_scores
from gen2.portfolio.role_engine import _consecutive_by_code
from gen2.portfolio.role_thresholds import load_role_thresholds

#: 从 rankings 透传到视图的展示列（视图已有则跳过）
_PASSTHROUGH_COLUMNS = ("rank", "rank_percentile", "leadership_score")


def build_v2_role_view(features: pd.DataFrame, rankings: pd.DataFrame, config: dict,
                       *, selection_scores: SelectionScores | None = None) -> pd.DataFrame:
    """权威 V2 角色结果 + 下游所需的展示/派生列（角色语义零改写）。

    `selection_scores=None` → **显式**使用 canonical Alpha（正式入口口径 `bundle.alpha` =
    Trend/RS/Breakout 等权）；调用方若做替代 Alpha 实验，必须显式传入自己的评分。
    """
    if selection_scores is None:
        selection_scores = canonical_selection_scores(features)
    thresholds = load_role_thresholds(config)
    view = build_v2_roles(features, rankings, config, selection_scores=selection_scores).copy()

    missing = [c for c in _PASSTHROUGH_COLUMNS if c in rankings.columns and c not in view.columns]
    if missing:
        base = rankings[["trade_date", "code", *missing]].drop_duplicates(["trade_date", "code"])
        view = view.merge(base, on=["trade_date", "code"], how="left")

    # persistence_days：与权威状态机同口径（依赖权威输出的 alpha_pct / trend_gate，
    # 阈值同样来自显式 role_thresholds，不再硬编码 —— F2 的一类根因就是阈值双写）
    ordered = view.sort_values(["code", "trade_date"]).copy()
    above = (ordered["alpha_pct"] >= thresholds.core_pct) & ordered["trend_gate"].astype(bool)
    below = ordered["alpha_pct"] < thresholds.satellite_pct
    ordered["persistence_days"] = pd.concat(
        [_consecutive_by_code(above, ordered["code"]), _consecutive_by_code(below, ordered["code"])],
        axis=1,
    ).max(axis=1).astype(int)

    return ordered.sort_values(["trade_date", "code"]).reset_index(drop=True)
