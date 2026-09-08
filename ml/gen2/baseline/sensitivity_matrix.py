from __future__ import annotations

from pathlib import Path

import pandas as pd

from gen2.backtest.rotation_backtest import run_rotation_backtest
from gen2.data.loader import GEN2_ROOT, load_daily_bars, load_gen2_config, load_universe_records
from gen2.evaluation.rank_metrics import rank_ic_by_date
from gen2.features.build_features import build_feature_matrix
from gen2.labels.build_labels import build_labels
from gen2.portfolio.portfolio_builder import build_portfolio_candidates
from gen2.portfolio.role_engine import build_daily_roles
from gen2.ranking.rank_engine import run_rank_engine


def evaluate_scenario(features, labels, weights, portfolio, cost_bps=10.0):
    cfg = load_gen2_config()
    cfg = dict(cfg)
    cfg["portfolio"] = {**cfg["portfolio"], **portfolio}
    cfg["evaluation"] = {"include_cost_sensitivity_bps": [cost_bps]}
    rankings = run_rank_engine(features, weights=weights)
    ic = rank_ic_by_date(rankings, labels)
    roles = build_daily_roles(rankings, config=cfg)
    candidates = build_portfolio_candidates(roles)
    summary, _ = run_rotation_backtest(features, rankings, candidates, output_dir=None)
    bt = summary[(summary["strategy"] == "rule_leadership_rotation") & (summary["cost_bps"] == cost_bps)]
    row = {
        "scenario": "",
        "rank_ic_mean": float(ic["rank_ic"].mean()) if not ic.empty else float("nan"),
        "rank_ic_pos_rate": float((ic["rank_ic"] > 0).mean()) if not ic.empty else float("nan"),
        "avg_turnover": float(bt["avg_daily_turnover"].iloc[0]) if not bt.empty else float("nan"),
        "total_turnover": float(bt["total_turnover"].iloc[0]) if not bt.empty else float("nan"),
        "cumulative_return": float(bt["cumulative_return"].iloc[0]) if not bt.empty else float("nan"),
        "annualized_return": float(bt["annualized_return"].iloc[0]) if not bt.empty else float("nan"),
        "sharpe": float(bt["sharpe"].iloc[0]) if not bt.empty else float("nan"),
        "max_drawdown": float(bt["max_drawdown"].iloc[0]) if not bt.empty else float("nan"),
    }
    return row


def run_sensitivity_matrix(output_path: str | Path | None = None) -> pd.DataFrame:
    cfg = load_gen2_config()
    bars = load_daily_bars()
    records = load_universe_records()
    features = build_feature_matrix(bars=bars, records=records, config=cfg)
    labels = build_labels(features)

    base_portfolio = {
        "promotion_persistence_days": 5,
        "demotion_persistence_days": 5,
        "max_core_count": 5,
        "max_core_per_cluster": 2,
        "min_replacement_edge": 8.0,
        "top_quantile": 0.2,
    }
    base_weights = {
        "trend": 0.20, "rs": 0.25, "stage": 0.15, "momentum": 0.10,
        "consolidation": 0.10, "breakout": 0.05, "volatility": 0.05,
        "liquidity": 0.05, "diversification": 0.05,
    }

    rows = []
    scenarios = []

    scenarios.append(("baseline", base_weights, base_portfolio))
    scenarios.append(("rs_heavy", {**base_weights, "rs": 0.35, "trend": 0.15, "stage": 0.10}, base_portfolio))
    scenarios.append(("momentum_heavy", {**base_weights, "momentum": 0.20, "consolidation": 0.05, "stage": 0.10}, base_portfolio))
    scenarios.append(("trend_heavy", {**base_weights, "trend": 0.30, "rs": 0.20, "stage": 0.10}, base_portfolio))
    scenarios.append(("quality_heavy", {**base_weights, "volatility": 0.10, "diversification": 0.10, "rs": 0.20, "trend": 0.15}, base_portfolio))
    scenarios.append(("promotion3", base_weights, {**base_portfolio, "promotion_persistence_days": 3, "demotion_persistence_days": 3}))
    scenarios.append(("promotion10", base_weights, {**base_portfolio, "promotion_persistence_days": 10, "demotion_persistence_days": 10}))
    scenarios.append(("cluster_cap3", base_weights, {**base_portfolio, "max_core_per_cluster": 3}))
    scenarios.append(("top_q30", base_weights, {**base_portfolio, "top_quantile": 0.30}))
    scenarios.append(("top_q40", base_weights, {**base_portfolio, "top_quantile": 0.40}))
    scenarios.append(("core3", base_weights, {**base_portfolio, "max_core_count": 3}))
    scenarios.append(("core7", base_weights, {**base_portfolio, "max_core_count": 7}))

    for name, weights, portfolio in scenarios:
        row = evaluate_scenario(features, labels, weights, portfolio, cost_bps=10.0)
        row["scenario"] = name
        row["weights"] = "|".join(f"{k}={v}" for k, v in weights.items() if k in ("trend", "rs", "stage", "momentum", "consolidation", "volatility", "diversification"))
        rows.append(row)
        print(f"  {name}: ret={row['cumulative_return']:.3f} mdd={row['max_drawdown']:.3f} sharpe={row['sharpe']:.2f} ic={row['rank_ic_mean']:.4f} turnover={row['total_turnover']:.0f}")

    df = pd.DataFrame(rows)
    out = Path(output_path) if output_path else GEN2_ROOT / "outputs" / "sensitivity_matrix.csv"
    out.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(out, index=False)
    return df


if __name__ == "__main__":
    df = run_sensitivity_matrix()
    print("\n" + df.to_string(index=False))
