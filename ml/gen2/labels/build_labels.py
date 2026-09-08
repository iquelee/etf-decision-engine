from __future__ import annotations

from pathlib import Path

import pandas as pd

from gen2.data.loader import GEN2_ROOT, load_gen2_config
from gen2.features.build_features import build_feature_matrix

LABEL_VERSION = "label_v1_excess_rank_20d"
LABEL_VERSION_VS_MARKET = "label_v2_excess_vs_market_20d"


def build_labels(features: pd.DataFrame | None = None, horizon_days: int = 20) -> pd.DataFrame:
    cfg = load_gen2_config()
    benchmark_code = cfg["data"].get("benchmark_code", "510300")
    features = features if features is not None else build_feature_matrix()

    # P1-4 修复：先在「完整价格日历」上定义未来区间（每只 code 的完整 close 序列，不过滤 eligible），
    # 再用 T 日 eligibility 选择样本。否则资格中断时 shift(-20) 会退化为「未来第 20 条合格记录」，
    # 而不是「未来 20 个交易日」。
    full = features[["trade_date", "code", "close"]].copy()
    full = full.sort_values(["code", "trade_date"])
    full["future_ret_20d"] = full.groupby("code")["close"].shift(-horizon_days) / full["close"] - 1.0

    active = features[(features["eligibility"] == "ELIGIBLE") & (features["code"] != benchmark_code)][["trade_date", "code"]].copy()
    active = active.merge(full[["trade_date", "code", "future_ret_20d"]], on=["trade_date", "code"], how="left")
    active["universe_future_ret_20d"] = active.groupby("trade_date")["future_ret_20d"].transform("mean")
    active["y_excess_20d"] = active["future_ret_20d"] - active["universe_future_ret_20d"]
    active["y_rank_20d"] = active.groupby("trade_date")["y_excess_20d"].rank(pct=True)
    active["y_leader_20d"] = (active["y_rank_20d"] >= 0.80).astype("Int64")
    active.loc[active["future_ret_20d"].isna(), ["y_excess_20d", "y_rank_20d", "y_leader_20d"]] = pd.NA
    active["label_version"] = LABEL_VERSION
    return active[["trade_date", "code", "future_ret_20d", "universe_future_ret_20d", "y_excess_20d", "y_rank_20d", "y_leader_20d", "label_version"]]


def build_labels_vs_market(features: pd.DataFrame | None = None, horizon_days: int = 20) -> pd.DataFrame:
    """V2 主 label：ETF 未来 20D 收益 - benchmark(510300) 未来 20D 收益。

    相对 universe-relative label 的优点：Universe 换了（15→30），基础 Alpha 定义不变。
    y_leader 用「绝对超额为正」而非「横截面 rank 前 20%」（符合「找值得成为主仓的人」而非「相对最不差」）。
    """
    cfg = load_gen2_config()
    benchmark_code = cfg["data"].get("benchmark_code", "510300")
    features = features if features is not None else build_feature_matrix()

    # P1-4 修复：先在完整价格日历上算未来 20 个交易日收益（含 benchmark），
    # 再用 T 日 eligibility 选样本。
    all_close = features[["trade_date", "code", "close"]].sort_values(["code", "trade_date"])
    all_close["_fret"] = all_close.groupby("code")["close"].shift(-horizon_days) / all_close["close"] - 1.0
    bench = all_close[all_close["code"] == benchmark_code][["trade_date", "_fret"]].rename(
        columns={"_fret": "bench_future_ret_20d"})

    active = features[features["eligibility"] == "ELIGIBLE"][["trade_date", "code"]].copy()
    active = active[active["code"] != benchmark_code]
    active = active.merge(all_close[["trade_date", "code", "_fret"]], on=["trade_date", "code"], how="left")
    active = active.rename(columns={"_fret": "future_ret_20d"})

    active = active.merge(bench, on="trade_date", how="left")
    active["future_20d_excess_vs_market"] = active["future_ret_20d"] - active["bench_future_ret_20d"]
    active["y_rank_vs_market_20d"] = active.groupby("trade_date")["future_20d_excess_vs_market"].rank(pct=True)
    active["y_leader_vs_market_20d"] = (active["future_20d_excess_vs_market"] > 0).astype("Int64")
    active.loc[active["future_ret_20d"].isna(), ["future_20d_excess_vs_market", "y_rank_vs_market_20d", "y_leader_vs_market_20d"]] = pd.NA
    active["label_version"] = LABEL_VERSION_VS_MARKET
    return active[["trade_date", "code", "future_ret_20d", "bench_future_ret_20d", "future_20d_excess_vs_market", "y_rank_vs_market_20d", "y_leader_vs_market_20d", "label_version"]]


def purged_walk_forward_splits(dates: list, train_years: int = 3, purge_days: int = 20, embargo_days: int = 5) -> list[dict]:
    """Create simple expanding yearly folds; exact windows depend on available dates."""
    ds = pd.Series(pd.to_datetime(sorted(dates)))
    years = sorted(ds.dt.year.unique())
    folds = []
    for i in range(train_years, len(years)):
        test_year = years[i]
        train_start = ds[ds.dt.year == years[0]].min()
        train_end_idx = ds[ds.dt.year < test_year].index.max()
        if pd.isna(train_end_idx):
            continue
        # Drop the last purge+embargo train rows so labels cannot cross into test.
        cutoff_idx = max(0, int(train_end_idx) - purge_days - embargo_days)
        folds.append({
            "fold": len(folds) + 1,
            "train_start": ds.iloc[0].date(),
            "train_end": ds.iloc[cutoff_idx].date(),
            "test_start": ds[ds.dt.year == test_year].min().date(),
            "test_end": ds[ds.dt.year == test_year].max().date(),
            "purge_days": purge_days,
            "embargo_days": embargo_days,
        })
    return folds


def write_labels(output_path: str | Path | None = None) -> Path:
    labels = build_labels()
    out = Path(output_path) if output_path else GEN2_ROOT / "outputs" / "labels_v1.csv"
    out.parent.mkdir(parents=True, exist_ok=True)
    labels.to_csv(out, index=False)
    return out


if __name__ == "__main__":
    path = write_labels()
    print(f"OK: {path}")
