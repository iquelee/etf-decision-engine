from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from gen2.backtest.benchmark import build_benchmark_weights
from gen2.backtest.costs import apply_turnover_cost
from gen2.data.loader import GEN2_ROOT, load_gen2_config, load_universe_definition


def shift_weights_next_trade_date(weights: pd.DataFrame, calendar: list) -> pd.DataFrame:
    """Make T-day decision effective on T+1 trade date."""
    if weights.empty:
        return weights.copy()
    cal = list(calendar)
    nxt = {d: cal[i + 1] for i, d in enumerate(cal[:-1])}
    out = weights.copy()
    out["effective_date"] = out["trade_date"].map(nxt)
    out = out.dropna(subset=["effective_date"])
    out = out.drop(columns=["trade_date"]).rename(columns={"effective_date": "trade_date"})
    return out


def nav_from_returns(result: pd.DataFrame) -> pd.DataFrame:
    out = result.copy().sort_values("trade_date")
    out["nav"] = (1.0 + out["net_return"].fillna(0.0)).cumprod()
    return out


def summarize_nav(nav: pd.DataFrame, strategy: str, cost_bps: float) -> dict:
    r = nav["net_return"].fillna(0.0)
    if r.empty:
        return {"strategy": strategy, "cost_bps": cost_bps}
    cumulative = float((1 + r).prod() - 1)
    ann = float((1 + cumulative) ** (252 / len(r)) - 1) if len(r) else np.nan
    sharpe = float(r.mean() / r.std() * np.sqrt(252)) if r.std() > 0 else np.nan
    nav_s = (1 + r).cumprod()
    maxdd = float((nav_s / nav_s.cummax() - 1).min())
    return {
        "strategy": strategy,
        "cost_bps": cost_bps,
        "days": int(len(r)),
        "cumulative_return": cumulative,
        "annualized_return": ann,
        "sharpe": sharpe,
        "max_drawdown": maxdd,
        "avg_daily_turnover": float(nav["turnover"].mean()) if "turnover" in nav else np.nan,
        "total_turnover": float(nav["turnover"].sum()) if "turnover" in nav else np.nan,
    }


def run_rotation_backtest(
    features: pd.DataFrame,
    rankings: pd.DataFrame,
    candidates: pd.DataFrame,
    output_dir: str | Path | None = None,
    extra_weights: dict[str, pd.DataFrame] | None = None,
) -> tuple[pd.DataFrame, dict[str, pd.DataFrame]]:
    cfg = load_gen2_config()
    universe = load_universe_definition()
    main5 = universe["incumbent_main5"]
    out_dir = Path(output_dir) if output_dir else GEN2_ROOT / "outputs"
    out_dir.mkdir(parents=True, exist_ok=True)

    # T+1 收盘执行假设：T 日收盘出信号，T+1 收盘成交，收益 = close[T+1]→close[T+2]。
    # 用 ret_1d 按 code 滞后一天（ret_1d_next[T] = ret_1d[T+1]），消除 close→close 的隔夜 lookahead，
    # 且不依赖 qfq 复权后不可靠的 open 字段（原 ret_intraday 方案因 open 失真被弃用）。
    returns = features[["trade_date", "code", "ret_1d"]].copy()
    returns = returns.sort_values(["code", "trade_date"])
    returns["ret_1d_next"] = returns.groupby("code")["ret_1d"].shift(-1)
    calendar = sorted(features["trade_date"].unique())
    weights_map = build_benchmark_weights(rankings, main5)
    weights_map["rule_leadership_rotation"] = candidates[["trade_date", "code", "target_weight"]].copy()
    if extra_weights:
        for name, wdf in extra_weights.items():
            weights_map[name] = wdf[["trade_date", "code", "target_weight"]].copy()

    benchmark_names = {"fixed_main5_system_proxy", "main5_equal_weight", "expanded_universe_equal_weight"}
    navs: dict[str, pd.DataFrame] = {}
    summaries = []
    for cost_bps in cfg["evaluation"].get("include_cost_sensitivity_bps", [0, 5, 10, 20]):
        for strategy, weights in weights_map.items():
            eff = shift_weights_next_trade_date(weights, calendar)
            result = apply_turnover_cost(eff, returns, cost_bps=float(cost_bps), return_col="ret_1d_next")
            nav = nav_from_returns(result)
            nav["strategy"] = strategy
            navs[f"{strategy}__{cost_bps}bps"] = nav
            summaries.append(summarize_nav(nav, strategy, float(cost_bps)))

    all_nav = pd.concat(navs.values(), ignore_index=True)
    summary = pd.DataFrame(summaries)
    all_nav.to_csv(out_dir / "portfolio_nav.csv", index=False)
    all_nav[all_nav["strategy"].isin(benchmark_names)].to_csv(out_dir / "benchmark_nav.csv", index=False)
    summary.to_csv(out_dir / "backtest_metrics_summary.csv", index=False)
    candidates.to_csv(out_dir / "portfolio_candidates.csv", index=False)
    return summary, navs
