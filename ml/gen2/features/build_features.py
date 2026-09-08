from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from gen2.data.loader import GEN2_ROOT, load_daily_bars, load_gen2_config, load_universe_records, point_in_time_eligible

DATA_VERSION = "daily-qfq-v1"
FEATURE_VERSION = "feature_v1"


def _consecutive_true(s: pd.Series) -> pd.Series:
    count = 0
    out = []
    for v in s.fillna(False).astype(bool):
        count = count + 1 if v else 0
        out.append(count)
    return pd.Series(out, index=s.index, dtype="int64")


def _max_drawdown(window: pd.Series) -> float:
    if window.empty:
        return np.nan
    peak = window.cummax()
    dd = window / peak - 1.0
    return float(dd.min())


def compute_time_series_features(g: pd.DataFrame) -> pd.DataFrame:
    g = g.sort_values("trade_date").copy()
    close = g["close"]
    high = g["high"]
    low = g["low"]
    volume = g["volume"]
    amount = g["amount"]

    g["history_days"] = np.arange(1, len(g) + 1)
    g["ret_1d"] = close.pct_change()
    g["ret_5d"] = close.pct_change(5)
    g["ret_20d"] = close.pct_change(20)
    g["ret_60d"] = close.pct_change(60)

    ma20 = close.rolling(20).mean()
    ma60 = close.rolling(60).mean()
    g["px_ma20"] = close / ma20 - 1.0
    g["px_ma60"] = close / ma60 - 1.0
    g["ma20_slope_5d"] = ma20 / ma20.shift(5) - 1.0
    g["ma60_slope_10d"] = ma60 / ma60.shift(10) - 1.0
    g["momentum_accel_5_20"] = g["ret_5d"] - g["ret_20d"]

    hh20 = high.rolling(20).max()
    ll20 = low.rolling(20).min()
    g["sideway_range"] = hh20 / ll20 - 1.0
    g["sideway_days"] = _consecutive_true(g["sideway_range"] <= 0.15)
    vol20 = volume.rolling(20).mean()
    g["volume_ratio_5_20"] = volume.rolling(5).mean() / vol20
    g["volume_compression_slope"] = g["volume_ratio_5_20"] - g["volume_ratio_5_20"].shift(5)

    prev_high60 = high.shift(1).rolling(60).max()
    g["breakout_distance"] = close / prev_high60 - 1.0
    g["recent_breakout_flag"] = (close > prev_high60).rolling(5).max().fillna(0).astype(int)

    prev_close = close.shift(1)
    tr = pd.concat([
        high - low,
        (high - prev_close).abs(),
        (low - prev_close).abs(),
    ], axis=1).max(axis=1)
    g["atr20_pct"] = tr.rolling(20).mean() / close
    g["realized_vol20"] = g["ret_1d"].rolling(20).std() * np.sqrt(252)
    g["volatility_compression"] = g["realized_vol20"] / g["realized_vol20"].shift(20) - 1.0
    g["max_drawdown_20d"] = close.rolling(20).apply(_max_drawdown, raw=False)

    g["avg_amount_20d"] = amount.rolling(20).mean()
    g["avg_amount_60d"] = amount.rolling(60).mean()
    return g


def add_relative_strength_and_regime(df: pd.DataFrame, benchmark_code: str = "510300") -> pd.DataFrame:
    out = df.copy()
    bench = out[out["code"] == benchmark_code][["trade_date", "ret_20d", "ret_60d", "px_ma20", "px_ma60"]].rename(columns={
        "ret_20d": "benchmark_ret_20d",
        "ret_60d": "benchmark_ret_60d",
        "px_ma20": "benchmark_px_ma20",
        "px_ma60": "benchmark_px_ma60",
    })
    out = out.merge(bench, on="trade_date", how="left")
    out["rs20_vs_benchmark"] = out["ret_20d"] - out["benchmark_ret_20d"]
    out["rs60_vs_benchmark"] = out["ret_60d"] - out["benchmark_ret_60d"]
    out = out.sort_values(["code", "trade_date"])
    out["rs_accel_5d"] = out.groupby("code")["rs20_vs_benchmark"].diff(5)
    from gen2.portfolio.regime import classify_regime, market_score

    out["market_score"] = market_score(out["benchmark_px_ma20"], out["benchmark_px_ma60"])
    out["breadth_proxy"] = out.groupby("trade_date")["px_ma20"].transform(lambda s: float((s > 0).mean()))
    # 统一 regime 契约（RISK_ON >=55 / RISK_OFF <=45），不再本地硬编码 60/40。
    out["risk_state"] = classify_regime(out["market_score"])
    return out


def add_correlations(df: pd.DataFrame, records: dict, benchmark_code: str = "510300") -> pd.DataFrame:
    ret = df.pivot(index="trade_date", columns="code", values="ret_1d").sort_index()
    incumbent = [c for c, r in records.items() if r.incumbent and c in ret.columns]
    incumbent_ret = ret[incumbent].mean(axis=1) if incumbent else pd.Series(index=ret.index, dtype=float)

    corr_port = pd.DataFrame(index=ret.index)
    for code in ret.columns:
        corr_port[code] = ret[code].rolling(60).corr(incumbent_ret)

    cluster_map = {c: r.correlation_cluster for c, r in records.items()}
    corr_cluster = pd.DataFrame(index=ret.index)
    for code in ret.columns:
        peers = [c for c, cl in cluster_map.items() if cl == cluster_map.get(code) and c != code and c in ret.columns]
        if peers:
            peer_ret = ret[peers].mean(axis=1)
            corr_cluster[code] = ret[code].rolling(60).corr(peer_ret)
        else:
            corr_cluster[code] = np.nan

    port_long = corr_port.stack().rename("corr_to_portfolio_60d").reset_index().rename(columns={"level_1": "code"})
    cl_long = corr_cluster.stack().rename("corr_to_cluster_60d").reset_index().rename(columns={"level_1": "code"})
    out = df.merge(port_long, on=["trade_date", "code"], how="left").merge(cl_long, on=["trade_date", "code"], how="left")
    out["diversification_raw"] = 1.0 - out["corr_to_portfolio_60d"].clip(lower=0, upper=1)
    return out


def add_cross_sectional(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    out["rs20_percentile_universe"] = out.groupby("trade_date")["rs20_vs_benchmark"].rank(pct=True)
    out["liquidity_percentile"] = out.groupby("trade_date")["avg_amount_20d"].rank(pct=True)
    out["diversification_score"] = out.groupby("trade_date")["diversification_raw"].rank(pct=True) * 100.0
    return out


def add_eligibility(df: pd.DataFrame, records: dict, min_history_days: int = 120) -> pd.DataFrame:
    reasons = []
    required_features = [
        "px_ma20", "px_ma60", "ma20_slope_5d", "ma60_slope_10d",
        "rs20_vs_benchmark", "rs60_vs_benchmark", "rs_accel_5d",
        "momentum_accel_5_20", "sideway_range", "volume_ratio_5_20",
        "breakout_distance", "atr20_pct", "realized_vol20", "max_drawdown_20d",
        "avg_amount_20d", "avg_amount_60d", "liquidity_percentile",
    ]
    for row in df.itertuples(index=False):
        rec = records.get(row.code)
        if rec is None:
            reasons.append("NOT_IN_UNIVERSE")
            continue
        ok, reason = point_in_time_eligible(rec, row.trade_date, int(row.history_days), min_history_days)
        if ok and any(pd.isna(getattr(row, col)) for col in required_features):
            reason = "DATA_INCOMPLETE"
        reasons.append(reason)
    out = df.copy()
    out["eligibility"] = reasons
    return out


def build_feature_matrix(
    bars: pd.DataFrame | None = None,
    records: dict | None = None,
    config: dict | None = None,
) -> pd.DataFrame:
    cfg = config or load_gen2_config()
    records = records or load_universe_records()
    bars = bars if bars is not None else load_daily_bars()
    benchmark_code = cfg["data"].get("benchmark_code", "510300")
    min_history_days = int(cfg["universe"].get("min_history_days", 120))

    df = pd.concat(
        [compute_time_series_features(g) for _, g in bars.groupby("code", sort=True)],
        ignore_index=True,
    )
    df = add_relative_strength_and_regime(df, benchmark_code=benchmark_code)
    df = add_correlations(df, records, benchmark_code=benchmark_code)
    df = add_cross_sectional(df)
    df = add_eligibility(df, records, min_history_days=min_history_days)
    df["feature_version"] = FEATURE_VERSION
    df["data_version"] = DATA_VERSION
    df["universe_version"] = cfg["universe"].get("version", "dev_universe_v0")
    return df.sort_values(["trade_date", "code"]).reset_index(drop=True)


def write_feature_matrix(output_path: str | Path | None = None) -> Path:
    df = build_feature_matrix()
    out = Path(output_path) if output_path else GEN2_ROOT / "outputs" / "feature_matrix_v1.csv"
    out.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(out, index=False)
    return out


if __name__ == "__main__":
    path = write_feature_matrix()
    print(f"OK: {path}")
