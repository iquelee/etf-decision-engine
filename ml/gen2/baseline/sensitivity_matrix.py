from __future__ import annotations

from pathlib import Path

import pandas as pd

from gen2.backtest.rotation_backtest import run_rotation_backtest
from gen2.baseline.selection_scores import build_selection_scores, canonical_selection_scores
from gen2.baseline.v2_role_view import build_v2_role_view
from gen2.data.loader import GEN2_ROOT, load_daily_bars, load_gen2_config, load_universe_records
from gen2.evaluation.rank_metrics import rank_ic_by_date
from gen2.features.build_features import build_feature_matrix
from gen2.labels.build_labels import build_labels
from gen2.portfolio.portfolio_builder import build_portfolio_candidates
from gen2.portfolio.role_thresholds import DEFAULT_ROLE_THRESHOLDS
from gen2.ranking.rank_engine import run_rank_engine


#: 场景旋钮的声明式定义（**唯一来源**）
#:
#: 报告生成器（`rebuild_research_baselines`）与 runner 共用这一份声明，
#: 这样「场景声明了什么旋钮」与「跑出什么结果」不会各说各话。
#:
#: WP-G2-05（F1 修复）后本文件有两类旋钮，二者都会真正生效：
#:   * `selection`：**替代 Alpha 权重**（注入 `build_selection_scores`，直接决定角色排名）——
#:     这是 F1 的修复点：旧实现里被改的 `weights` 只影响已死掉的 `leadership_score`；
#:   * `portfolio`：角色/组合旋钮（含显式 `role_thresholds`）。
#: `baseline` 场景的 `selection = None` → 使用 canonical Alpha，因此它与正式 Rule V2 同口径，
#: 其它场景的差异都是相对 canonical 的「替代 Alpha」实验。
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
    "role_thresholds": dict(DEFAULT_ROLE_THRESHOLDS),
}


def scenario_specs() -> list[dict]:
    """敏感性场景声明（name / selection / weights / portfolio）。runner 与报告生成器共用。

    `selection=None` → canonical Alpha（正式口径）；否则为替代 Alpha 的组件权重。
    """
    P = BASE_PORTFOLIO
    W = BASE_WEIGHTS
    return [
        {"name": "baseline", "selection": None, "weights": W, "portfolio": P},
        {"name": "rs_heavy", "selection": {**W, "rs": 0.35, "trend": 0.15, "stage": 0.10}, "weights": W, "portfolio": P},
        {"name": "momentum_heavy", "selection": {**W, "momentum": 0.20, "consolidation": 0.05, "stage": 0.10}, "weights": W, "portfolio": P},
        {"name": "trend_heavy", "selection": {**W, "trend": 0.30, "rs": 0.20, "stage": 0.10}, "weights": W, "portfolio": P},
        {"name": "quality_heavy", "selection": {**W, "volatility": 0.10, "diversification": 0.10, "rs": 0.20, "trend": 0.15}, "weights": W, "portfolio": P},
        {"name": "promotion3", "selection": None, "weights": W, "portfolio": {**P, "promotion_persistence_days": 3, "demotion_persistence_days": 3}},
        {"name": "promotion10", "selection": None, "weights": W, "portfolio": {**P, "promotion_persistence_days": 10, "demotion_persistence_days": 10}},
        {"name": "cluster_cap3", "selection": None, "weights": W, "portfolio": {**P, "max_core_per_cluster": 3}},
        {"name": "core_top30", "selection": None, "weights": W, "portfolio": {**P, "role_thresholds": {"core_top_fraction": 0.30, "challenger_top_fraction": 0.30, "satellite_top_fraction": 0.40}}},
        {"name": "core_top40", "selection": None, "weights": W, "portfolio": {**P, "role_thresholds": {"core_top_fraction": 0.40, "challenger_top_fraction": 0.40, "satellite_top_fraction": 0.40}}},
        {"name": "core3", "selection": None, "weights": W, "portfolio": {**P, "max_core_count": 3}},
        {"name": "core7", "selection": None, "weights": W, "portfolio": {**P, "max_core_count": 7}},
    ]


#: 声明了旋钮但组合结果与 baseline 逐位相同的场景 → 只能作信号层分析。
#: 报告生成器要求「检测到的无效场景必须在此登记」，否则报错（防止新出现的静默无效场景被当结论展示）；
#: 反过来，已登记的场景若变回有效也报错（强制更新登记表）。
#:
#: WP-G2-05 后为空：F1 的六个场景已通过 `selection` 注入链真正生效（core_top30/40 亦已改用
#: 显式 `role_thresholds`）。保留空表 + 守卫，是为了让**将来**出现的静默无效场景立即暴露。
REGISTERED_INEFFECTIVE: dict[str, str] = {}


def evaluate_scenario(features, labels, weights, portfolio, cost_bps=10.0, output_dir=None, *,
                      selection=None, scenario=""):
    """评估一个敏感性场景（WP-G2-05：替代 Alpha 通过 `selection_scores` 真正进入角色排名）。

    `selection=None` → canonical Alpha（与正式 Rule V2 同口径）；否则为替代 Alpha 的组件权重。
    信号层 IC 也改用**注入的评分**计算（旧实现算的是已不参与角色决策的 `leadership_score`）。
    """
    cfg = load_gen2_config()
    cfg = dict(cfg)
    cfg["portfolio"] = {**cfg["portfolio"], **portfolio}
    cfg["evaluation"] = {"include_cost_sensitivity_bps": [cost_bps]}
    rankings = run_rank_engine(features)
    if selection is None:
        scores = canonical_selection_scores(features)
    else:
        scores = build_selection_scores(
            features, selection,
            score_version=f"scenario-{scenario}" if scenario else "scenario",
            score_source="SCENARIO_ALPHA",
            notes=(f"场景 {scenario} 的替代 Alpha 权重（相对 canonical bundle.alpha）",))
    # 信号层 IC 用**注入的原始评分列**（scores.frame 的 selection_score；merge_frame 会改名为 alpha_score_v2）
    ic = rank_ic_by_date(
        rankings.drop(columns=["leadership_score"], errors="ignore").merge(
            scores.frame, on=["trade_date", "code"], how="left"),
        labels, score_col="selection_score")
    roles = build_v2_role_view(features, rankings, cfg, selection_scores=scores)
    candidates = build_portfolio_candidates(roles)
    # 本场景只关心 cost_bps 这一档：显式传入，避免内层回测白跑配置的全部费用档
    summary, _ = run_rotation_backtest(features, rankings, candidates, output_dir=output_dir,
                                       cost_levels=[cost_bps])
    bt = summary[(summary["strategy"] == "rule_leadership_rotation") & (summary["cost_bps"] == cost_bps)]
    row = {
        "scenario": scenario,
        "score_source": scores.score_source,
        "score_hash": scores.content_hash,
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
        name, weights, portfolio, selection = spec["name"], spec["weights"], spec["portfolio"], spec.get("selection")
        row = evaluate_scenario(features, labels, weights, portfolio, cost_bps=10.0, output_dir=output_dir,
                                selection=selection, scenario=name)
        row["weights"] = "|".join(f"{k}={v}" for k, v in weights.items()
                                  if k in ("trend", "rs", "stage", "momentum", "consolidation", "volatility", "diversification"))
        row["role_thresholds"] = "|".join(f"{k}={v}" for k, v in (portfolio.get("role_thresholds") or {}).items())
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
