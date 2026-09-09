"""Gen-2.1 M3 — Turnover-aware Replacement 硬门（晋升/替换准入，Validation 层草案）。

设计（PLAN_GEN2_1 §7 / DRAFT turnover_aware_replacement）：
  挑战者（challenger）替换现任 CORE（incumbent）须**同时满足 5 个硬条件**，
  不做可调权重的万能 Replacement Score（减少自由参数纪律）：

    gate1 cluster_qualified        challenger 所在簇是当日 top_cluster
    gate2 consolidation_pass       challenger consolidation_quality >= min_quality（Gate OFF 时恒 True）
    gate3 leadership_superior      challenger 当日 alpha 严格高于 incumbent（同簇内才可比）
    gate4 edge_gt_cost_hurdle      期望经济边际 > 本次实际换仓成本 + buffer
    gate5 no_persistence_protection incumbent 不在 min-hold 保护期（在位 < min_hold_days 不可替换）

  Gate #4 口径（M3-r2 审批修正，无隐藏参数）：
    - 成本侧：本次换仓实际成本 = weight_delta × cost_bps × 2（两腿买卖）。
      weight_delta = 1 / 当日 CORE 池上限（调用方按实际组合状态传入，非固定常数）。
    - 收益侧：edge_bps = alpha_delta × alpha_to_excess_bps（Design-fixed 常数，见 DRAFT
      `replacement.design_fixed`；alpha 1 分 ≈ 该 bps/日），回本周期 hold_days_for_breakeven。
    - 判定：edge_bps × hold_days_for_breakeven > 实际成本 + cost_buffer_bps。
    - 防退化：gate3 用**严格大于**且 gate4 独立用实际成本，二者不会自然合并。

本模块纯函数、零 DB、零 IO。所有映射常数默认值仅兜底，运行时须从 DRAFT 显式传入。
"""
from __future__ import annotations

import numpy as np
import pandas as pd

# 兜底默认（非真相源）：运行时参数从 DRAFT turnover_aware_replacement.replacement 读取。
DEFAULT_V21_REPLACEMENT = {
    "min_hold_days": 5,             # Design-fixed：= demotion_persistence_days 初值
    "cost_bps": 10.0,               # Design-fixed：与回测 cost_bps 一致（单边）
    "alpha_to_excess_bps": 5.0,     # Design-fixed：alpha 1 分 ≈ 5 bps/日 期望超额（量纲桥）
    "hold_days_for_breakeven": 20,  # Design-fixed：成本回本周期（= future_20d 口径）
    "cost_buffer_bps": 5.0,         # Design-fixed：成本缓冲（换手冲击/滑点），Validation 校准后冻结
}


def expected_turnover_cost(weight_delta: float, cost_bps: float) -> float:
    """本次换仓交易成本期望（bps）：两腿（卖出 incumbent + 买入 challenger）。

    weight_delta 由调用方按实际组合状态传入（= 1/当日 CORE 池上限），非固定常数。
    """
    return float(weight_delta) * float(cost_bps) * 2.0


def alpha_edge_to_bps(alpha_delta: float, alpha_to_excess_bps: float = 5.0) -> float:
    """把 alpha 边际换算为期望日超额（bps/日）。"""
    return float(alpha_delta) * float(alpha_to_excess_bps)


def replacement_gate(
    challenger_alpha: float,
    incumbent_alpha: float,
    challenger_cluster_top: bool,
    challenger_quality: float | None,
    min_quality: float | None,
    incumbent_tenure_days: int,
    weight_delta: float = 0.20,
    cfg: dict | None = None,
) -> tuple[bool, list[str]]:
    """5 硬门同时满足才允许替换。返回 (allow, failed_gates)。

    Parameters
    ----------
    challenger_alpha / incumbent_alpha : 当日 alpha_score_v2（同簇比较）。
    challenger_cluster_top : 挑战者所在簇当日是否为 top_cluster（M1 输出）。
    challenger_quality : 挑战者 consolidation_quality（M2 输出）；缺列传 None。
    min_quality : Gate 门槛；None 表示 Gate OFF（gate2 恒过）。
    incumbent_tenure_days : 现任 CORE 已连续在位交易日数（>=min_hold_days 才可替换）。
    weight_delta : 本次换仓实际权重差（= 1/当日 CORE 池上限；调用方传入，非固定常数）。
    cfg : 覆盖常数（min_hold_days / cost_bps / alpha_to_excess_bps / hold_days_for_breakeven /
          cost_buffer_bps）。默认仅兜底；运行时从 DRAFT replacement 段读取后传入。
    """
    c = {**DEFAULT_V21_REPLACEMENT, **(cfg or {})}
    failed: list[str] = []

    # gate1：cluster qualified
    if not challenger_cluster_top:
        failed.append("cluster_qualified")

    # gate2：consolidation pass（Gate OFF → 恒过）
    if min_quality is not None:
        if challenger_quality is None or np.isnan(challenger_quality) or challenger_quality < float(min_quality):
            failed.append("consolidation_pass")

    # gate3：leadership superior（严格高于现任才构成"强者换弱者"）
    if not (challenger_alpha > incumbent_alpha):
        failed.append("leadership_superior")

    # gate4：edge > actual cost + buffer（本次换仓经济边际是否值本次换仓成本）
    #   收益侧映射常数来自 DRAFT design_fixed；成本侧 weight_delta 为实际值。
    if "leadership_superior" not in failed:
        alpha_delta = challenger_alpha - incumbent_alpha  # >0（gate3 保证）
        edge_bps_per_day = alpha_edge_to_bps(alpha_delta, float(c["alpha_to_excess_bps"]))
        edge_over_horizon = edge_bps_per_day * float(c["hold_days_for_breakeven"])
        cost = expected_turnover_cost(float(weight_delta), float(c["cost_bps"]))
        hurdle = cost + float(c.get("cost_buffer_bps", 0.0))
        if edge_over_horizon <= hurdle:
            failed.append("edge_gt_cost_hurdle")

    # gate5：no persistence protection（现任不在 min-hold 保护期）
    if incumbent_tenure_days < int(c["min_hold_days"]):
        failed.append("no_persistence_protection")

    return (len(failed) == 0), failed


def tenure_days_by_code(roles_by_day_core: pd.DataFrame) -> dict[str, int]:
    """从历史 CORE 角色日序列统计每代码连续在位天数（供替换门 tenure 输入）。

    roles_by_day_core 需含 [code, trade_date]，按日期升序；当日含在内。
    仅作便捷工具，状态机内部用逐日 current_roles 推进更精确（见 rule_v21_ab）。
    """
    out: dict[str, int] = {}
    if roles_by_day_core.empty:
        return out
    df = roles_by_day_core.sort_values("trade_date")
    for code, g in df.groupby("code"):
        dates = sorted(pd.to_datetime(g["trade_date"]).dt.date)
        n = 1
        for a, b in zip(dates, dates[1:]):
            delta = (b - a).days
            if delta <= 4:
                n += 1
            else:
                n = 1
        out[code] = n
    return out
