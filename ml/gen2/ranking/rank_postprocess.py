from __future__ import annotations

import pandas as pd


def validate_rankings(rankings: pd.DataFrame) -> None:
    assert not rankings.empty, "rankings are empty"
    counts = rankings.groupby("trade_date")["rank"].nunique()
    sizes = rankings.groupby("trade_date")["code"].size()
    assert counts.equals(sizes), "rank must be unique per date"
    assert rankings["rank"].min() >= 1, "rank must start at 1"
    assert ((rankings["rank_percentile"] > 0) & (rankings["rank_percentile"] <= 1)).all(), "rank_percentile must be in (0,1]"
    by_date = rankings.sort_values(["trade_date", "rank"]).groupby("trade_date")["leadership_score"]
    assert by_date.apply(lambda s: s.is_monotonic_decreasing).all(), "score must be monotonic by rank"


def top_k_by_date(rankings: pd.DataFrame, k: int = 5) -> pd.DataFrame:
    return rankings[rankings["rank"] <= k].sort_values(["trade_date", "rank"]).reset_index(drop=True)
