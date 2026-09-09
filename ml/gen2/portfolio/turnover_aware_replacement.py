"""Gen-2.1 M3 — Turnover-aware Replacement 硬门（晋升/替换准入，Validation 层草案）。

设计（PLAN_GEN2_1 §7 / DRAFT turnover_aware_replacement）：
  挑战者（challenger）替换现任 CORE（incumbent）须**同时满足 5 个硬条件**，
  不做可调权重的万能 Replacement Score（减少自由参数纪律）：

    gate1 cluster_qualified        challenger 所在簇是当日 top_cluster
    gate2 consolidation_pass       challenger consolidation_quality >= min_quality（Gate OFF 时恒 True）
    gate3 leadership_superior      challenger 当日 alpha 严格高于 incumbent（同一簇内才可比）
    gate4 edge_gt_cost_hurdle      (challenger_alpha - incumbent_alpha) 折算的期望收益 > 交易成本
    gate5 no_persistence_protection incumbent 不在 min-hold 保护期（新任 CORE 在位 < min_hold_days 不可替换）

  Expected Turnover Cost = weight_delta * cost_bps（计算值，非可调权重）——
  weight_delta 为两标的单只权重上限差（0~max_single_weight），成本以 bps 计。
  edge 折算：把 alpha 边际按 `alpha_to_excess_bps` 常数映射到期望日超额(bps)，再对比成本。

本模块纯函数、零 DB、零 IO。
"""
from __future__ import annotations

import numpy as np
import pandas as pd

# 默认硬门常数（草案；Validation 只收敛 min_hold_days 与 cost_buffer，不放开其它自由度）
DEFAULT_V21_REPLACEMENT = {
    "min_hold_days": 5,            # = demotion_persistence_days 初值（DRAFT persistence_protection）
    "cost_bps": 10.0,              # 单边成本基准（与回测 cost_bps 一致）
    "alpha_to_excess_bps": 5.0,    # alpha_score 1 分 ≈ 5 bps/日 期望超额（量纲桥，草案常数）
    "hold_days_for_breakeven": 20,  # 成本回本周期（默认 20D，与 future_20d 口径一致）
    "max_single_weight": 0.25,     # weight_delta 上界（与 V2 单只权重 cap 对齐）
}


def expected_turnover_cost(weight_delta: float, cost_bps: float) -> float:
    """交易成本期望（bps）：换仓两腿成本 ≈ weight_delta(单腿) × cost_bps × 2(买卖) 的保守上界。

    与 DRAFT 公式一致：weight_delta * cost_bps（计算值，非可调权重）。
    """
    return float(weight_delta) * float(cost_bps) * 2.0


def alpha_edge_to_bps(alpha_delta: float, alpha_to_excess_bps: float = 5.0) -> float:
    """把 alpha 边际换算为持有期内期望超额（bps）。"""
    return float(alpha_delta) * float(alpha_to_excess_bps)


def replacement_gate(
    challenger_alpha: float,
    incumbent_alpha: float,
    challenger_cluster_top: bool,
    challenger_quality: float | None,
    min_quality: float | None,
    incumbent_tenure_days: int,
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
    cfg : 覆盖常数（min_hold_days / cost_bps / alpha_to_excess_bps / hold_days_for_breakeven）。
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

    # gate4：edge > cost hurdle（期望超额回本周期内覆盖两腿成本）
    #   注：仅当挑战者 alpha 不高于现任时 gate3 已失败，gate4 无需再算；
    #   其余情形按两腿成本上界（max_single_weight × cost_bps × 2）判断。
    if "leadership_superior" not in failed:
        alpha_delta = max(0.0, challenger_alpha - incumbent_alpha)
        edge_bps_per_day = alpha_edge_to_bps(alpha_delta, c["alpha_to_excess_bps"])
        edge_over_horizon = edge_bps_per_day * float(c["hold_days_for_breakeven"])
        cost = expected_turnover_cost(float(c["max_single_weight"]), c["cost_bps"])
        if edge_over_horizon <= cost:
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
        # 统计最近连续段长度（按交易日 1 步长近似；精确由调用方保证）
        n = 1
        for a, b in zip(dates, dates[1:]):
            delta = (b - a).days
            if delta <= 4:  # 常规交易日间隔 <=3-4 天视为连续
                n += 1
            else:
                n = 1
        out[code] = n
    return out
