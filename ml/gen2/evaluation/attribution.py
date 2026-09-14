from __future__ import annotations

from pathlib import Path

import pandas as pd

from gen2.backtest.benchmark import build_benchmark_weights
from gen2.backtest.costs import apply_turnover_cost
from gen2.backtest.rotation_backtest import shift_weights_next_trade_date
from gen2.data.loader import GEN2_ROOT, load_daily_bars, load_gen2_config, load_universe_definition, load_universe_records
from gen2.features.build_features import build_feature_matrix
from gen2.portfolio.defense_gate import apply_regime_defense
from gen2.portfolio.portfolio_builder import build_portfolio_candidates
from gen2.baseline.selection_scores import canonical_selection_scores
from gen2.baseline.v2_role_view import build_v2_role_view
from gen2.ranking.rank_engine import run_rank_engine

TECH_CLUSTERS = {"tech_hardware", "software_ai"}


def _regime(market_score: float) -> str:
    from gen2.portfolio.regime import classify_regime

    if pd.isna(market_score):
        return "UNKNOWN"
    # 统一 regime 契约（RISK_ON >=55 / RISK_OFF <=45），不再本地硬编码。
    return classify_regime(market_score)


def run_attribution(output_dir: str | Path | None = None) -> dict:
    cfg = load_gen2_config()
    bars = load_daily_bars()
    records = load_universe_records()
    features = build_feature_matrix(bars=bars, records=records, config=cfg)
    rankings = run_rank_engine(features)
    # WP-G2-05：Alpha 显式注入（canonical）
    selection = canonical_selection_scores(features)
    roles = build_v2_role_view(features, rankings, cfg, selection_scores=selection)
    candidates = build_portfolio_candidates(roles)                        # undefended
    defended = apply_regime_defense(candidates, features, config=cfg)     # defended（含真实 defense_state）

    # T+1 收盘执行假设：收益 = close[T+1]→close[T+2]，用 ret_1d 滞后一天，消除隔夜 lookahead。
    returns = features[["trade_date", "code", "ret_1d"]].copy()
    returns = returns.sort_values(["code", "trade_date"])
    returns["ret_1d_next"] = returns.groupby("code")["ret_1d"].shift(-1)
    calendar = sorted(features["trade_date"].unique())
    universe = load_universe_definition()
    main5 = universe["incumbent_main5"]
    bench = build_benchmark_weights(rankings, main5)
    main5_w = shift_weights_next_trade_date(bench["main5_equal_weight"], calendar)
    rule_w = shift_weights_next_trade_date(candidates[["trade_date", "code", "target_weight"]], calendar)
    def_w = shift_weights_next_trade_date(defended[["trade_date", "code", "target_weight"]], calendar)

    rule_ret = apply_turnover_cost(rule_w, returns, cost_bps=10.0, return_col="ret_1d_next").rename(
        columns={"net_return": "rule_net", "turnover": "rule_turnover"})[["trade_date", "rule_net", "rule_turnover"]]
    def_ret = apply_turnover_cost(def_w, returns, cost_bps=10.0, return_col="ret_1d_next").rename(
        columns={"net_return": "def_net", "turnover": "def_turnover"})[["trade_date", "def_net", "def_turnover"]]
    main5_ret = apply_turnover_cost(main5_w, returns, cost_bps=10.0, return_col="ret_1d_next").rename(
        columns={"net_return": "main5_net"})[["trade_date", "main5_net"]]

    regime = features.groupby("trade_date")["market_score"].last().to_frame().reset_index()
    regime["regime"] = regime["market_score"].apply(_regime)
    # 真实 defense_state（defended 数据按 trade_date 去重）
    defense_state = defended.drop_duplicates("trade_date")[["trade_date", "defense_state"]].rename(columns={"defense_state": "defense_state"})
    tech_exp = candidates[candidates["role"] == "CORE"].copy()
    tech_exp["is_tech"] = tech_exp["correlation_cluster"].isin(TECH_CLUSTERS)
    tech_daily = tech_exp.groupby("trade_date", as_index=False).apply(
        lambda g: pd.Series({"tech_weight": float((g["target_weight"] * g["is_tech"]).sum()), "tech_count": int(g["is_tech"].sum())}),
        include_groups=False,
    ).reset_index()

    merged = (rule_ret.merge(def_ret, on="trade_date", how="left")
              .merge(main5_ret, on="trade_date", how="left")
              .merge(regime, on="trade_date", how="left")
              .merge(defense_state, on="trade_date", how="left")
              .merge(tech_daily, on="trade_date", how="left"))
    merged["tech_weight"] = merged["tech_weight"].fillna(0.0)
    merged["tech_count"] = merged["tech_count"].fillna(0).astype(int)

    out_dir = Path(output_dir) if output_dir else GEN2_ROOT / "outputs"
    out_dir.mkdir(parents=True, exist_ok=True)
    merged.to_csv(out_dir / "attribution_daily.csv", index=False)

    def _sharpe(s):
        return float(s.mean() / s.std() * (252 ** 0.5)) if s.std() > 0 else float("nan")

    # 1) 按 market regime（统一契约）：undefended vs defended vs main5
    regime_rows = []
    for r, g in merged.groupby("regime"):
        regime_rows.append({
            "regime": r,
            "days": int(len(g)),
            "rule_cum": float((1 + g["rule_net"].fillna(0)).prod() - 1),
            "defended_cum": float((1 + g["def_net"].fillna(0)).prod() - 1),
            "main5_cum": float((1 + g["main5_net"].fillna(0)).prod() - 1),
            "rule_sharpe": _sharpe(g["rule_net"]),
            "defended_sharpe": _sharpe(g["def_net"]),
            "main5_sharpe": _sharpe(g["main5_net"]),
            "def_avg_turnover": float(g["def_turnover"].mean()),
            "avg_tech_weight": float(g["tech_weight"].mean()),
        })

    # 2) 按真实 defense_state（NORMAL vs RISK_OFF）：证明 Defense 触发时是否有效
    def_rows = []
    for st, g in merged.groupby("defense_state"):
        if st not in {"NORMAL", "RISK_OFF"}:
            continue
        def_rows.append({
            "defense_state": st,
            "days": int(len(g)),
            "rule_cum": float((1 + g["rule_net"].fillna(0)).prod() - 1),
            "defended_cum": float((1 + g["def_net"].fillna(0)).prod() - 1),
            "main5_cum": float((1 + g["main5_net"].fillna(0)).prod() - 1),
            "rule_sharpe": _sharpe(g["rule_net"]),
            "defended_sharpe": _sharpe(g["def_net"]),
        })

    tech_rows = []
    for flag, label in [(True, "TECH_HEAVY"), (False, "NON_TECH")]:
        g = merged[merged["tech_weight"] >= 0.5] if flag else merged[merged["tech_weight"] < 0.5]
        tech_rows.append({
            "segment": label,
            "days": int(len(g)),
            "rule_cum": float((1 + g["rule_net"].fillna(0)).prod() - 1),
            "defended_cum": float((1 + g["def_net"].fillna(0)).prod() - 1),
            "main5_cum": float((1 + g["main5_net"].fillna(0)).prod() - 1),
        })

    regime_df = pd.DataFrame(regime_rows)
    def_df = pd.DataFrame(def_rows)
    tech_df = pd.DataFrame(tech_rows)
    regime_df.to_csv(out_dir / "attribution_by_regime.csv", index=False)
    def_df.to_csv(out_dir / "attribution_by_defense_state.csv", index=False)
    tech_df.to_csv(out_dir / "attribution_by_tech.csv", index=False)
    return {"daily": merged, "regime": regime_df, "defense_state": def_df, "tech": tech_df}


if __name__ == "__main__":
    result = run_attribution()
    print("\n## By Regime\n", result["regime"].to_string(index=False))
    print("\n## By Tech Exposure\n", result["tech"].to_string(index=False))
