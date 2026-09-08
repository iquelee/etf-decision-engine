from __future__ import annotations

import pandas as pd


def rank_ic_by_date(rankings: pd.DataFrame, labels: pd.DataFrame) -> pd.DataFrame:
    df = rankings.merge(labels, on=["trade_date", "code"], how="inner")
    df = df.dropna(subset=["leadership_score", "y_rank_20d"])
    rows = []
    for d, g in df.groupby("trade_date"):
        if len(g) < 3 or g["leadership_score"].nunique() < 2 or g["y_rank_20d"].nunique() < 2:
            continue
        # Spearman = Pearson correlation of ranks; avoid scipy dependency.
        x = g["leadership_score"].rank(method="average")
        y = g["y_rank_20d"].rank(method="average")
        rows.append({"trade_date": d, "rank_ic": x.corr(y, method="pearson"), "n": len(g)})
    return pd.DataFrame(rows)


def quantile_forward_returns(rankings: pd.DataFrame, labels: pd.DataFrame, quantiles: int = 5) -> pd.DataFrame:
    df = rankings.merge(labels, on=["trade_date", "code"], how="inner").dropna(subset=["y_excess_20d"])
    if df.empty:
        return pd.DataFrame(columns=["trade_date", "quantile", "mean_y_excess_20d", "n"])
    pct = df.groupby("trade_date")["leadership_score"].rank(method="first", pct=True)
    df = df.assign(quantile=(pct * quantiles).astype(int).clip(upper=quantiles - 1))
    return df.groupby(["trade_date", "quantile"], as_index=False).agg(
        mean_y_excess_20d=("y_excess_20d", "mean"),
        n=("code", "size"),
    )


def top_bottom_spread(rankings: pd.DataFrame, labels: pd.DataFrame, top_pct: float = 0.2) -> pd.DataFrame:
    df = rankings.merge(labels, on=["trade_date", "code"], how="inner").dropna(subset=["y_excess_20d"])
    if df.empty:
        return pd.DataFrame(columns=["trade_date", "top_bottom_spread", "top_mean", "bottom_mean", "k"])
    g = df.groupby("trade_date")
    n = g["code"].transform("size")
    k = (n * top_pct).astype(int).clip(lower=1)
    rank_asc = g["leadership_score"].rank(method="first", ascending=True)
    df = df.assign(_n=n, _k=k, _rank=rank_asc)
    top = df[df["_rank"] > df["_n"] - df["_k"]].groupby("trade_date")["y_excess_20d"].mean().rename("top_mean")
    bottom = df[df["_rank"] <= df["_k"]].groupby("trade_date")["y_excess_20d"].mean().rename("bottom_mean")
    out = pd.concat([top, bottom, df.groupby("trade_date")["_k"].first()], axis=1).dropna().reset_index()
    out["top_bottom_spread"] = out["top_mean"] - out["bottom_mean"]
    out = out.rename(columns={"_k": "k"})
    return out[["trade_date", "top_bottom_spread", "top_mean", "bottom_mean", "k"]]
