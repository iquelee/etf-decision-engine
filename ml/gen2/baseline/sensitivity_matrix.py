from __future__ import annotations

from pathlib import Path

import pandas as pd

from gen2.backtest.rotation_backtest import run_rotation_backtest
from gen2.data.loader import GEN2_ROOT, load_daily_bars, load_gen2_config, load_universe_records
from gen2.evaluation.rank_metrics import rank_ic_by_date
from gen2.features.build_features import build_feature_matrix
from gen2.labels.build_labels import build_labels
from gen2.portfolio.portfolio_builder import build_portfolio_candidates
from gen2.baseline.v2_role_view import build_v2_role_view
from gen2.ranking.rank_engine import run_rank_engine


#: 场景旋钮的声明式定义（**唯一来源**）
#:
#: 报告生成器（`rebuild_research_baselines`）与 runner 共用这一份声明，
#: 这样「场景声明了什么旋钮」与「跑出什么结果」不会各说各话。
#: 注意：`weights` 当前只作用于 `rank_engine` 的 `leadership_score`；是否真正进入
#: 角色状态机消费的 Alpha 由 F1 / WP-G2-05 的 `selection_scores` 注入链决定 ——
#: 不能只看这里的声明就断言场景「改变了组合」。
BASE_WEIGHTS = {
    "trend": 0.20, "rs": 0.25, "stage": 0.15, "momentum": 0.10,
    "consolidation": 0.10, "breakout": 0.05, "volatility": 0.05,
    "liquidity": 0.05, "diversification": 0.05,
}

BASE_PORTFOLIO = {
    "promotion_persistence_days": 5,
    "demotion_persistence_days": 5,
    "max_core_count": 5,
    "max_core_per_cluster": 2,
    "min_replacement_edge": 8.0,
    "top_quantile": 0.2,
}


def scenario_specs() -> list[dict]:
    """敏感性场景声明（name / weights / portfolio）。runner 与报告生成器共用。"""
    P = BASE_PORTFOLIO
    W = BASE_WEIGHTS
    return [
        {"name": "baseline", "weights": W, "portfolio": P},
        {"name": "rs_heavy", "weights": {**W, "rs": 0.35, "trend": 0.15, "stage": 0.10}, "portfolio": P},
        {"name": "momentum_heavy", "weights": {**W, "momentum": 0.20, "consolidation": 0.05, "stage": 0.10}, "portfolio": P},
        {"name": "trend_heavy", "weights": {**W, "trend": 0.30, "rs": 0.20, "stage": 0.10}, "portfolio": P},
        {"name": "quality_heavy", "weights": {**W, "volatility": 0.10, "diversification": 0.10, "rs": 0.20, "trend": 0.15}, "portfolio": P},
        {"name": "promotion3", "weights": W, "portfolio": {**P, "promotion_persistence_days": 3, "demotion_persistence_days": 3}},
        {"name": "promotion10", "weights": W, "portfolio": {**P, "promotion_persistence_days": 10, "demotion_persistence_days": 10}},
        {"name": "cluster_cap3", "weights": W, "portfolio": {**P, "max_core_per_cluster": 3}},
        {"name": "top_q30", "weights": W, "portfolio": {**P, "top_quantile": 0.30}},
        {"name": "top_q40", "weights": W, "portfolio": {**P, "top_quantile": 0.40}},
        {"name": "core3", "weights": W, "portfolio": {**P, "max_core_count": 3}},
        {"name": "core7", "weights": W, "portfolio": {**P, "max_core_count": 7}},
    ]


#: 声明了旋钮但组合结果与 baseline 逐位相同的场景 → 只能作信号层分析（F1/F2）。
#: 报告生成器要求「检测到的无效场景必须在此登记」，否则报错（防止新出现的静默无效场景被当结论展示）。
REGISTERED_INEFFECTIVE = {
    "rs_heavy": "F1",
    "momentum_heavy": "F1",
    "trend_heavy": "F1",
    "quality_heavy": "F1",
    "top_q30": "F2",
    "top_q40": "F2",
}


def evaluate_scenario(features, labels, weights, portfolio, cost_bps=10.0, output_dir=None):
    cfg = load_gen2_config()
    cfg = dict(cfg)
    cfg["portfolio"] = {**cfg["portfolio"], **portfolio}
    cfg["evaluation"] = {"include_cost_sensitivity_bps": [cost_bps]}
    rankings = run_rank_engine(features, weights=weights)
    ic = rank_ic_by_date(rankings, labels)
    roles = build_v2_role_view(features, rankings, cfg)
    candidates = build_portfolio_candidates(roles)
    # 本场景只关心 cost_bps 这一档：显式传入，避免内层回测白跑配置的全部费用档
    summary, _ = run_rotation_backtest(features, rankings, candidates, output_dir=output_dir,
                                       cost_levels=[cost_bps])
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


def run_sensitivity_matrix(output_path: str | Path | None = None, *, output_dir=None) -> pd.DataFrame:
    """敏感性矩阵（V2 权威角色语义 + 唯一权威账本）。output_dir 用于隔离各场景回测的中间产物。"""
    cfg = load_gen2_config()
    bars = load_daily_bars()
    records = load_universe_records()
    features = build_feature_matrix(bars=bars, records=records, config=cfg)
    labels = build_labels(features)

    rows = []
    for spec in scenario_specs():
        name, weights, portfolio = spec["name"], spec["weights"], spec["portfolio"]
        row = evaluate_scenario(features, labels, weights, portfolio, cost_bps=10.0, output_dir=output_dir)
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
