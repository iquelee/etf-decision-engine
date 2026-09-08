from __future__ import annotations

import numpy as np
import pandas as pd

ENGINE_ID = "gen2-rule-v2"


def _pct(s: pd.Series, ascending: bool = True) -> pd.Series:
    """Same-date cross-sectional percentile scaled to 0-100."""
    return s.rank(pct=True, ascending=ascending) * 100.0


def add_component_scores(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    g = out.groupby("trade_date")

    def pct(col: str, ascending: bool = True) -> pd.Series:
        return g[col].rank(pct=True, ascending=ascending) * 100.0

    out["_px_ma20_s"] = pct("px_ma20")
    out["_px_ma60_s"] = pct("px_ma60")
    out["_ma20_slope_s"] = pct("ma20_slope_5d")
    out["_ma60_slope_s"] = pct("ma60_slope_10d")
    out["trend_score"] = out[["_px_ma20_s", "_px_ma60_s", "_ma20_slope_s", "_ma60_slope_s"]].mean(axis=1)

    out["_rs20_s"] = pct("rs20_vs_benchmark")
    out["_rs60_s"] = pct("rs60_vs_benchmark")
    out["_rs_accel_s"] = pct("rs_accel_5d")
    out["rs_score"] = out[["_rs20_s", "_rs60_s", "_rs_accel_s"]].mean(axis=1)

    out["_sideway_days_s"] = pct("sideway_days")
    out["_sideway_range_s"] = pct("sideway_range", ascending=False)
    out["_volume_ratio_s"] = pct("volume_ratio_5_20", ascending=False)
    out["consolidation_score_v1"] = out[["_sideway_days_s", "_sideway_range_s", "_volume_ratio_s"]].mean(axis=1)

    out["stage_quality"] = 0.60 * out["_sideway_days_s"] + 0.40 * out["_sideway_range_s"]
    out["momentum_accel_score"] = pct("momentum_accel_5_20")
    out["breakout_approach_score"] = pct("breakout_distance")

    out["_atr_s"] = pct("atr20_pct", ascending=False)
    out["_vol_s"] = pct("realized_vol20", ascending=False)
    out["_mdd_s"] = pct("max_drawdown_20d")  # less negative is better
    out["volatility_quality_score"] = out[["_atr_s", "_vol_s", "_mdd_s"]].mean(axis=1)

    out["liquidity_score"] = out["liquidity_percentile"] * 100.0
    out["diversification_score_v1"] = out["diversification_score"].fillna(50.0)
    out["risk_penalty"] = (100.0 - out["volatility_quality_score"]).clip(0, 100) * 0.10
    out["crowding_penalty"] = out["corr_to_cluster_60d"].clip(lower=0, upper=1).fillna(0.5) * 5.0
    return out


DEFAULT_WEIGHTS = {
    "trend": 0.20,
    "rs": 0.25,
    "stage": 0.15,
    "momentum": 0.10,
    "consolidation": 0.10,
    "breakout": 0.05,
    "volatility": 0.05,
    "liquidity": 0.05,
    "diversification": 0.05,
}


def compute_leadership_score(features: pd.DataFrame, weights: dict | None = None) -> pd.DataFrame:
    w = dict(DEFAULT_WEIGHTS if weights is None else weights)
    scored = add_component_scores(features)
    scored["leadership_score"] = (
        w.get("trend", 0) * scored["trend_score"]
        + w.get("rs", 0) * scored["rs_score"]
        + w.get("stage", 0) * scored["stage_quality"]
        + w.get("momentum", 0) * scored["momentum_accel_score"]
        + w.get("consolidation", 0) * scored["consolidation_score_v1"]
        + w.get("breakout", 0) * scored["breakout_approach_score"]
        + w.get("volatility", 0) * scored["volatility_quality_score"]
        + w.get("liquidity", 0) * scored["liquidity_score"]
        + w.get("diversification", 0) * scored["diversification_score_v1"]
        - scored["risk_penalty"]
        - scored["crowding_penalty"]
    ).clip(lower=0, upper=100)
    return scored


def build_rank_results(features: pd.DataFrame, benchmark_code: str = "510300", weights: dict | None = None) -> pd.DataFrame:
    from gen2.data.loader import load_universe_records

    eligible = features[(features["eligibility"] == "ELIGIBLE") & (features["code"] != benchmark_code)].copy()
    scored = compute_leadership_score(eligible, weights=weights)
    records = load_universe_records()
    scored["name"] = scored["code"].map(lambda c: records[c].name if c in records else "")
    scored["correlation_cluster"] = scored["code"].map(lambda c: records[c].correlation_cluster if c in records else "")
    scored = scored.sort_values(["trade_date", "leadership_score", "code"], ascending=[True, False, True])
    scored["rank"] = scored.groupby("trade_date").cumcount() + 1
    n = scored.groupby("trade_date")["code"].transform("size")
    scored["rank_percentile"] = (n - scored["rank"] + 1) / n
    scored["engine_id"] = ENGINE_ID
    scored["model_id"] = ENGINE_ID
    cols = [
        "trade_date", "code", "name", "correlation_cluster", "eligibility", "leadership_score", "rank", "rank_percentile",
        "engine_id", "model_id", "universe_version", "feature_version", "data_version",
        "trend_score", "rs_score", "stage_quality", "momentum_accel_score", "consolidation_score_v1",
        "breakout_approach_score", "volatility_quality_score", "liquidity_score", "diversification_score_v1",
        "risk_penalty", "crowding_penalty", "ret_20d", "rs20_vs_benchmark", "corr_to_cluster_60d",
    ]
    for col in cols:
        if col not in scored.columns:
            scored[col] = np.nan
    return scored[cols].sort_values(["trade_date", "rank"]).reset_index(drop=True)
