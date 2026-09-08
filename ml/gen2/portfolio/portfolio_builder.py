from __future__ import annotations

import pandas as pd


def build_portfolio_candidates(roles: pd.DataFrame) -> pd.DataFrame:
    out = roles.copy()
    out["priority"] = out["rank"].astype(int)
    core_count = out.groupby("trade_date")["role"].transform(lambda s: int((s == "CORE").sum()))
    out["target_weight"] = 0.0
    out.loc[out["role"] == "CORE", "target_weight"] = out.loc[out["role"] == "CORE", "trade_date"].map(
        out[out["role"] == "CORE"].groupby("trade_date").size().rdiv(1.0)
    )
    return out.sort_values(["trade_date", "priority"]).reset_index(drop=True)


def build_cluster_exposure(candidates: pd.DataFrame) -> pd.DataFrame:
    core = candidates[candidates["role"] == "CORE"].copy()
    if core.empty:
        return pd.DataFrame(columns=["trade_date", "correlation_cluster", "core_count", "target_weight"])
    return core.groupby(["trade_date", "correlation_cluster"], as_index=False).agg(
        core_count=("code", "count"),
        target_weight=("target_weight", "sum"),
    )
