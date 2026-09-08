from __future__ import annotations

import pandas as pd


def cluster_concentration(candidates: pd.DataFrame) -> pd.DataFrame:
    core = candidates[candidates["role"] == "CORE"].copy()
    if core.empty:
        return pd.DataFrame(columns=["trade_date", "max_cluster_weight", "max_cluster_count", "cluster"])
    rows = []
    for d, g in core.groupby("trade_date"):
        c = g.groupby("correlation_cluster").agg(core_count=("code", "count"), weight=("target_weight", "sum")).sort_values("weight", ascending=False)
        if c.empty:
            continue
        first = c.index[0]
        rows.append({"trade_date": d, "max_cluster_weight": float(c.loc[first, "weight"]), "max_cluster_count": int(c.loc[first, "core_count"]), "cluster": first})
    return pd.DataFrame(rows)


def core_residence_days(roles: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for code, g in roles.sort_values("trade_date").groupby("code"):
        streak = 0
        streaks = []
        for role in g["role"]:
            if role == "CORE":
                streak += 1
            elif streak:
                streaks.append(streak)
                streak = 0
        if streak:
            streaks.append(streak)
        rows.append({
            "code": code,
            "core_residence_avg_days": float(pd.Series(streaks).mean()) if streaks else 0.0,
            "core_residence_max_days": int(max(streaks)) if streaks else 0,
            "core_periods": len(streaks),
        })
    return pd.DataFrame(rows)
