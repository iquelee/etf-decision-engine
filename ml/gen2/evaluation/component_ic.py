from __future__ import annotations

import pandas as pd

FACTOR_COLS = [
    "trend_score",
    "rs_score",
    "stage_quality",
    "momentum_accel_score",
    "consolidation_score_v1",
    "breakout_approach_score",
    "volatility_quality_score",
    "liquidity_score",
    "diversification_score_v1",
    "leadership_score",
]


def component_rank_ic(rankings: pd.DataFrame, labels: pd.DataFrame, factor_cols: list[str] | None = None) -> pd.DataFrame:
    """Per-factor 20D Rank IC (Spearman of factor vs y_rank_20d), cross-sectional by date."""
    df = rankings.merge(labels, on=["trade_date", "code"], how="inner")
    df = df.dropna(subset=["y_rank_20d"])
    cols = factor_cols or FACTOR_COLS
    rows = []
    for col in cols:
        sub = df.dropna(subset=[col])
        ic_by_date = []
        for d, g in sub.groupby("trade_date"):
            if len(g) < 3 or g[col].nunique() < 2 or g["y_rank_20d"].nunique() < 2:
                continue
            x = g[col].rank(method="average")
            y = g["y_rank_20d"].rank(method="average")
            ic_by_date.append(x.corr(y, method="pearson"))
        if not ic_by_date:
            rows.append({"factor": col, "rank_ic_mean": float("nan"), "ic_pos_pct": float("nan"), "n_days": 0})
            continue
        s = pd.Series(ic_by_date)
        rows.append({
            "factor": col,
            "rank_ic_mean": float(s.mean()),
            "ic_pos_pct": float((s > 0).mean()),
            "ic_median": float(s.median()),
            "n_days": int(len(s)),
        })
    return pd.DataFrame(rows)


def run(output_dir=None):
    from gen2.data.loader import GEN2_ROOT
    out_dir = GEN2_ROOT / "outputs"
    rankings = pd.read_csv(out_dir / "daily_rankings.csv")
    labels = pd.read_csv(out_dir / "labels_v1.csv")
    ic = component_rank_ic(rankings, labels)
    ic = ic.sort_values("rank_ic_mean", ascending=False)
    ic.to_csv(out_dir / "component_rank_ic.csv", index=False)
    return ic


if __name__ == "__main__":
    pd.set_option("display.width", 120)
    pd.set_option("display.float_format", lambda x: f"{x:.4f}")
    print(run().to_string(index=False))
