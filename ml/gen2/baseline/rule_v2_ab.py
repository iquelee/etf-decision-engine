"""Gen-2 Rule V2 Structural A/B：V1 composite score vs V2 alpha/utility separated.

对比维度：
  1. 信号层 Rank IC（universe-relative label + vs-market label，全样本 + 分 regime）
  2. Top-Bottom 20D spread
  3. 组合层经济指标（V2 带 Selection Permission + NO_CORE）
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from gen2.backtest.benchmark import build_benchmark_weights
from gen2.backtest.costs import apply_turnover_cost
from gen2.backtest.rotation_backtest import shift_weights_next_trade_date
from gen2.baseline.alpha_score import compute_alpha_score_v2
from gen2.data.loader import GEN2_ROOT, load_daily_bars, load_gen2_config, load_universe_definition, load_universe_records
from gen2.features.build_features import build_feature_matrix
from gen2.labels.build_labels import build_labels, build_labels_vs_market
from gen2.portfolio.defense_gate import apply_regime_defense
from gen2.portfolio.regime import classify_regime
from gen2.portfolio.role_engine import _cap_core_roles, _consecutive_by_code
from gen2.portfolio.selection_permission import DISABLED, max_core_count, selection_mode
from gen2.ranking.rank_engine import run_rank_engine


def _spearman_ic(df: pd.DataFrame, score_col: str, label_col: str) -> pd.DataFrame:
    sub = df.dropna(subset=[score_col, label_col])
    rows = []
    for d, g in sub.groupby("trade_date"):
        if len(g) < 3 or g[score_col].nunique() < 2 or g[label_col].nunique() < 2:
            continue
        x = g[score_col].rank(method="average")
        y = g[label_col].rank(method="average")
        rows.append({"trade_date": d, "rank_ic": x.corr(y, method="pearson")})
    return pd.DataFrame(rows)


def signal_ab(features, rankings, labels_uni, labels_mkt) -> pd.DataFrame:
    """V1 composite vs V2 alpha 的信号层 IC 对比。"""
    # V2 alpha score
    alpha = compute_alpha_score_v2(features)[["trade_date", "code", "alpha_score_v2", "market_score"]]
    df = rankings.merge(labels_uni[["trade_date", "code", "y_rank_20d"]], on=["trade_date", "code"])
    df = df.merge(labels_mkt[["trade_date", "code", "y_rank_vs_market_20d"]], on=["trade_date", "code"])
    df = df.merge(alpha, on=["trade_date", "code"])
    df["regime"] = df["market_score"].map(classify_regime)

    rows = []
    for name, score_col in [("V1_composite", "leadership_score"), ("V2_alpha", "alpha_score_v2")]:
        for label_name, label_col in [("uni", "y_rank_20d"), ("mkt", "y_rank_vs_market_20d")]:
            ic = _spearman_ic(df, score_col, label_col)
            rows.append({"score": name, "label": label_name, "rank_ic_mean": ic["rank_ic"].mean(), "ic_pos": (ic["rank_ic"] > 0).mean(), "n_days": len(ic)})
    return pd.DataFrame(rows)


def signal_ab_by_regime(features, rankings, labels_mkt) -> pd.DataFrame:
    alpha = compute_alpha_score_v2(features)[["trade_date", "code", "alpha_score_v2", "market_score"]]
    df = rankings.merge(labels_mkt[["trade_date", "code", "y_rank_vs_market_20d"]], on=["trade_date", "code"])
    df = df.merge(alpha, on=["trade_date", "code"])
    df["regime"] = df["market_score"].map(classify_regime)
    rows = []
    for reg, g in df.groupby("regime"):
        for name, score_col in [("V1_composite", "leadership_score"), ("V2_alpha", "alpha_score_v2")]:
            ic = _spearman_ic(g, score_col, "y_rank_vs_market_20d")
            rows.append({"regime": reg, "score": name, "rank_ic_mean": ic["rank_ic"].mean(), "n_days": len(ic)})
    return pd.DataFrame(rows)


def _prev_role(prev_roles: dict, code) -> str:
    return prev_roles.get(code, "RESERVE")


def _prev_role_series(codes: pd.Series, prev_roles: dict) -> pd.Series:
    return pd.Series([_prev_role(prev_roles, c) for c in codes], index=codes.index)


def _replacement_edge(challenger_alpha: float, incumbent_alpha: float, min_edge: float = 8.0) -> float:
    """F09：替换边际 = alpha 差 - correlation(2) - turnover(2) - crowding(1)，与 Node computeReplacementEdge 一致。"""
    return (challenger_alpha - incumbent_alpha) - 2.0 - 2.0 - 1.0


def _should_replace(challenger_alpha: float, incumbent_alpha: float, min_edge: float = 8.0) -> bool:
    return _replacement_edge(challenger_alpha, incumbent_alpha, min_edge) >= min_edge


def _assert_final_constraints(day: pd.DataFrame, prev_roles: dict, base_max_core: int, max_core_per_cluster: int) -> None:
    """组合约束最终断言（F09，与 Node assertFinalRoleConstraints 一致）。

    CORE 总数 ≤ base_max_core、每 cluster CORE 数 ≤ max_core_per_cluster；
    异常时优先降级「非现任（晋升者）」中 alpha 最低者，绝不降级被恢复的现任 CORE。
    """
    def _pick_victim(idx_list):
        for i in idx_list:
            if _prev_role(prev_roles, day.loc[i, "code"]) != "CORE":
                return i
        return idx_list[0]

    # cluster 数量约束
    for _cl, arr in day[day["role"] == "CORE"].groupby("correlation_cluster", sort=False):
        arr = arr.sort_values("alpha_score_v2", ascending=True)
        idx_list = list(arr.index)
        excess = len(idx_list) - max_core_per_cluster
        while excess > 0:
            victim = _pick_victim(idx_list)
            day.loc[victim, "role"] = "CHALLENGER"
            day.loc[victim, "reason_codes"] = str(day.loc[victim, "reason_codes"]) + "|FINAL_CLUSTER_CAP"
            idx_list.remove(victim)
            excess -= 1

    # CORE 总数约束
    remaining = day[day["role"] == "CORE"].sort_values("alpha_score_v2", ascending=True)
    idx_list = list(remaining.index)
    total_excess = len(idx_list) - base_max_core
    while total_excess > 0:
        victim = _pick_victim(idx_list)
        day.loc[victim, "role"] = "CHALLENGER"
        day.loc[victim, "reason_codes"] = str(day.loc[victim, "reason_codes"]) + "|FINAL_CORE_CAP"
        idx_list.remove(victim)
        total_excess -= 1


def _apply_replacement_gate(day: pd.DataFrame, prev_roles: dict, base_max_core: int, max_core_per_cluster: int) -> None:
    """F09：自愿替换校验（与 Node applyReplacementGate 一致）。

    被 cap 降级的「现任 CORE」（上一日 CORE 且 cap 前仍 CORE、cap 后非 CORE）需有
    alpha 边际达标的同 cluster 新晋升者才接受替换；否则撤销（恢复现任、退回最弱晋升者）。
    硬退出（NO_CORE）已在前置状态机降为非 CORE，不经过此校验。
    """
    prev_s = _prev_role_series(day["code"], prev_roles)
    cap_demoted = day[(prev_s == "CORE") & (day["role_before_cap"] == "CORE") & (day["role"] != "CORE")]
    if cap_demoted.empty:
        _assert_final_constraints(day, prev_roles, base_max_core, max_core_per_cluster)
        return

    promoted_indices = list(day[(prev_s != "CORE") & (day["role"] == "CORE")].index)
    for dem_idx in cap_demoted.sort_values("alpha_score_v2", ascending=False).index:
        if not promoted_indices:
            break
        dem_alpha = day.loc[dem_idx, "alpha_score_v2"]
        dem_cluster = day.loc[dem_idx, "correlation_cluster"]
        same_cluster_idx = [i for i in promoted_indices if day.loc[i, "correlation_cluster"] == dem_cluster]
        replacer_indices = same_cluster_idx if same_cluster_idx else promoted_indices

        has_replacer = any(_should_replace(day.loc[i, "alpha_score_v2"], dem_alpha) for i in replacer_indices)
        if has_replacer:
            day.loc[dem_idx, "reason_codes"] = str(day.loc[dem_idx, "reason_codes"]) + "|REPLACEMENT_ACCEPTED"
            continue

        # 边际不足 → 撤销替换：恢复现任，退回同 cluster 最弱晋升者
        day.loc[dem_idx, "role"] = "CORE"
        day.loc[dem_idx, "reason_codes"] = str(day.loc[dem_idx, "reason_codes"]) + "|REPLACEMENT_REVOKED"
        weakest_idx = min(replacer_indices, key=lambda i: day.loc[i, "alpha_score_v2"])
        day.loc[weakest_idx, "role"] = "CHALLENGER"
        day.loc[weakest_idx, "reason_codes"] = str(day.loc[weakest_idx, "reason_codes"]) + "|REPLACEMENT_BLOCKED"
        promoted_indices.remove(weakest_idx)

    _assert_final_constraints(day, prev_roles, base_max_core, max_core_per_cluster)


def build_v2_roles(features, rankings, config) -> pd.DataFrame:
    """V2 完整角色状态机：alpha 排名 + persistence 滞后 + Selection Permission + NO_CORE + cluster cap。"""
    from gen2.data.loader import load_universe_records
    records = load_universe_records()
    pcfg = config["portfolio"]
    promotion_days = int(pcfg.get("promotion_persistence_days", 5))
    demotion_days = int(pcfg.get("demotion_persistence_days", 5))
    max_core_per_cluster = int(pcfg.get("max_core_per_cluster", 2))
    base_max_core = int(pcfg.get("max_core_count", 5))
    core_pct = 0.80
    satellite_pct = 0.60

    alpha = compute_alpha_score_v2(features)[["trade_date", "code", "alpha_score_v2", "market_score", "px_ma60"]]
    rk = rankings.merge(alpha, on=["trade_date", "code"], how="left")
    # alpha 排名（同日横截面）
    rk = rk.sort_values(["trade_date", "alpha_score_v2"], ascending=[True, False])
    rk["alpha_rank"] = rk.groupby("trade_date").cumcount() + 1
    n = rk.groupby("trade_date")["code"].transform("size")
    rk["alpha_pct"] = (n - rk["alpha_rank"] + 1) / n
    rk["perm_mode"] = rk["market_score"].map(selection_mode)
    # 绝对趋势闸门（NO_CORE）：价格在 60 日线上方才可 CORE
    rk["trend_gate"] = rk["px_ma60"] > 0
    rk["is_hedge"] = rk["code"].map(lambda c: records[c].strategic_role_hint if c in records else "") == "hedge"

    # persistence：连续 above_core / below_satellite 天数
    rk = rk.sort_values(["code", "trade_date"])
    # P0-Parity：above_core 累计「完整准入条件」（alpha 前 20% 且过趋势闸门），与 Node 端一致。
    # 跌破 MA60 不累计晋升天数（虽最终仍被 NO_CORE 硬门槛拦截，但 persistence_days 须一致）。
    rk["above_core_days"] = _consecutive_by_code((rk["alpha_pct"] >= core_pct) & rk["trend_gate"], rk["code"])
    rk["below_satellite_days"] = _consecutive_by_code(rk["alpha_pct"] < satellite_pct, rk["code"])

    # 初始角色
    current_roles = {}
    for code, rec in records.items():
        if not rec.core_eligible or rec.research_only:
            continue
        if rec.strategic_role_hint == "hedge":
            current_roles[code] = "HEDGE"
        elif rec.incumbent:
            current_roles[code] = "CORE"
        else:
            current_roles[code] = "RESERVE"

    data = rk.sort_values(["trade_date", "alpha_rank"])
    output = []
    for trade_date, day in data.groupby("trade_date", sort=True):
        day = day.copy()
        mode = day["perm_mode"].iloc[0]
        max_core = max_core_count(day["market_score"].iloc[0], base=base_max_core)
        proposed = np.select(
            [day["alpha_pct"] >= core_pct, day["alpha_pct"] >= 0.70, day["alpha_pct"] >= satellite_pct],
            ["CORE", "CHALLENGER", "SATELLITE"],
            default="RESERVE",
        )
        day["proposed_role"] = proposed
        day["role"] = proposed

        for row in day.itertuples():
            code = row.code
            rec = records.get(code)
            current = current_roles.get(code, "RESERVE")
            role = row.proposed_role
            reasons = []

            if rec and rec.strategic_role_hint == "hedge":
                role = "HEDGE"
            elif current == "CORE" and role in {"RESERVE", "CHALLENGER", "SATELLITE"}:
                # §6.1：现任 CORE 去留由 demotion 滞后决定，不受 DISABLED 清仓
                if int(row.below_satellite_days) < demotion_days:
                    role = "CORE"
                    reasons.append("DEMOTION_HYSTERESIS")
                else:
                    reasons.append("DEMOTION_CONFIRMED")
            elif current != "CORE" and role == "CORE":
                # §6.1：新晋升受 Selection Permission 控制，DISABLED 禁晋升但不清现任
                if mode == DISABLED:
                    role = "CHALLENGER"
                    reasons.append("PROMOTION_BLOCKED_BY_PERMISSION")
                elif int(row.above_core_days) < promotion_days:
                    role = "CHALLENGER"
                    reasons.append("PROMOTION_HYSTERESIS")
                else:
                    reasons.append("PROMOTION_CONFIRMED")

            # NO_CORE 绝对硬门槛（F04 修复）：统一校验，区分「入选」与「保留」。
            # 无论 proposed 晋升还是现任 demotion 滞后保留，跌破 MA60 即失去 CORE 资格，
            # 不能由排名分支偶然绕过硬门槛。
            if role == "CORE" and not row.trend_gate:
                role = "CHALLENGER"
                reasons.append("NO_CORE_TREND_GATE")

            day.loc[row.Index, "role"] = role
            day.loc[row.Index, "reason_codes"] = "|".join(reasons)

        # cluster cap（同时受 permission 的 max_core 限制）。
        # F03 修复：显式传 V2 的 alpha 排序，禁止读旧 leadership_score。
        day["role_before_cap"] = day["role"]
        day["role"] = _cap_core_roles(day, max_core, max_core_per_cluster, priority_col="alpha_score_v2", priority_rank_col="alpha_rank")
        # F09：自愿替换校验 + 组合约束最终断言（与 Node applyReplacementGate/assertFinalRoleConstraints 一致）
        _apply_replacement_gate(day, current_roles, base_max_core, max_core_per_cluster)

        for row in day.itertuples():
            current_roles[row.code] = row.role
            output.append({
                "trade_date": row.trade_date,
                "code": row.code,
                "name": row.name,
                "correlation_cluster": row.correlation_cluster,
                "role": row.role,
                "alpha_score_v2": row.alpha_score_v2,
                "alpha_rank": int(row.alpha_rank),
                "alpha_pct": float(row.alpha_pct),
                "perm_mode": row.perm_mode,
                "trend_gate": bool(row.trend_gate),
                "reason_codes": getattr(row, "reason_codes", ""),
            })

    roles = pd.DataFrame(output)
    # F05 修复：CORE 权重受单只/cluster/广义科技 上限约束，剩余留现金（不自动归一化到 100%）。
    max_single_weight = float(pcfg.get("max_single_weight", 0.25))
    max_cluster_weight = float(pcfg.get("max_cluster_weight", 0.40))
    # P0-6：广义科技敞口上限（tech_hardware + software_ai 合计 <= max_tech_weight），与 JS 端 65% 对齐
    max_tech_weight = float(pcfg.get("max_tech_weight", 0.65))
    tech_clusters = set(pcfg.get("tech_clusters", ["tech_hardware", "software_ai"]))
    roles["relative_share"] = 0.0
    roles["target_weight"] = 0.0
    core = roles[roles["role"] == "CORE"].copy()
    if not core.empty:
        core["relative_share"] = core.groupby("trade_date")["code"].transform(lambda s: 1.0 / len(s))
        core["target_weight"] = core["relative_share"].clip(upper=max_single_weight)
        # cluster 截断（按比例缩减，使同 cluster CORE 权重和 <= max_cluster_weight）
        pieces = []
        for (d, cl), g in core.groupby(["trade_date", "correlation_cluster"]):
            total = g["target_weight"].sum()
            if total > max_cluster_weight:
                g = g.copy()
                g["target_weight"] = g["target_weight"] * (max_cluster_weight / total)
            pieces.append(g)
        core = pd.concat(pieces, ignore_index=True)
        # P0-6：广义科技跨 cluster 敞口约束（只缩科技，不动非科技）
        tech_mask = core["correlation_cluster"].isin(tech_clusters)
        tech_pieces = []
        for d, g in core.groupby("trade_date"):
            g = g.copy()
            tech_total = float(g.loc[g["correlation_cluster"].isin(tech_clusters), "target_weight"].sum())
            if tech_total > max_tech_weight:
                k = max_tech_weight / tech_total
                g.loc[g["correlation_cluster"].isin(tech_clusters), "target_weight"] *= k
            tech_pieces.append(g)
        core = pd.concat(tech_pieces, ignore_index=True)
        roles = roles.drop(columns=["relative_share", "target_weight"]).merge(
            core[["trade_date", "code", "relative_share", "target_weight"]],
            on=["trade_date", "code"], how="left")
        roles["relative_share"] = roles["relative_share"].fillna(0.0)
        roles["target_weight"] = roles["target_weight"].fillna(0.0)
    return roles


def run_v2_backtest(features, rankings, config, output_dir=None) -> pd.DataFrame:
    from gen2.backtest.ledger import run_ledger

    roles = build_v2_roles(features, rankings, config)
    candidates = roles[["trade_date", "code", "role", "target_weight", "name", "correlation_cluster"]].copy()
    candidates["priority"] = 1
    defended = apply_regime_defense(candidates, features, config=config)

    returns = features[["trade_date", "code", "ret_1d"]].copy()
    returns = returns.sort_values(["code", "trade_date"])
    universe = load_universe_definition()
    main5 = universe["incumbent_main5"]
    bench = build_benchmark_weights(rankings, main5)

    # F06 修复：完整策略集（含 Expanded Universe EW 与 510300 市场基准）
    weights_map = {
        "main5_pit": bench["main5_equal_weight"],
        "universe_ew": bench["expanded_universe_equal_weight"],
        "rule_v2_undefended": candidates[["trade_date", "code", "target_weight"]],
        "rule_v2_defended": defended[["trade_date", "code", "target_weight"]],
    }

    # P1-1 修复：统一有效评价日历 = 候选池有 ELIGIBLE 标的的交易日（rankings 日期）。
    # 所有策略与基准进入同一账本、同一期初（全现金）、同一日历推进；
    # 早期某策略尚无信号时按「无信号→保持现金」处理，不各自截取不同窗口。
    eval_calendar = sorted(rankings["trade_date"].unique())

    # 510300 市场基准：buy & hold，毛收益参照（无换手、无成本），首日收益记 0。
    bench_code = universe.get("benchmark_code", "510300")
    bench_ret_raw = returns[returns["code"] == bench_code][["trade_date", "ret_1d"]].drop_duplicates("trade_date").set_index("trade_date")["ret_1d"]
    bench_return_series = bench_ret_raw.reindex(eval_calendar).fillna(0.0)

    net_by_strat: dict[tuple, pd.Series] = {}
    turn_by_strat: dict[tuple, pd.Series] = {}
    for cost_bps in [0, 5, 10, 20]:
        for strategy, w in weights_map.items():
            led = run_ledger(w, returns, cost_bps=float(cost_bps), calendar=eval_calendar)
            net_by_strat[(strategy, cost_bps)] = led.set_index("trade_date")["net_return"]
            turn_by_strat[(strategy, cost_bps)] = led.set_index("trade_date")["turnover"]

    def _summary(net: pd.Series, turnover: pd.Series | None = None) -> dict:
        net = net.dropna()
        nav = (1.0 + net).cumprod()
        return {
            "days": int(len(net)),
            "cumulative_return": float((1 + net).prod() - 1),
            "sharpe": float(net.mean() / net.std() * (252 ** 0.5)) if net.std() > 0 else float("nan"),
            "max_drawdown": float((nav / nav.cummax() - 1).min()),
            "total_turnover": float(turnover.sum()) if turnover is not None else 0.0,
        }

    # P1-1：所有策略与基准严格同一日历（不再各自跑完再截交集），days 必须完全一致。
    summaries = []
    for cost_bps in [0, 5, 10, 20]:
        for strategy in weights_map:
            net = net_by_strat[(strategy, cost_bps)].reindex(eval_calendar)
            turn = turn_by_strat[(strategy, cost_bps)].reindex(eval_calendar)
            s = _summary(net, turn)
            summaries.append({"strategy": strategy, "cost_bps": cost_bps, **s})
        # 市场基准（毛收益参照：同一日历，无换手，无成本）
        m = _summary(bench_return_series)
        summaries.append({"strategy": "market_510300", "cost_bps": cost_bps, **m})

    out = pd.DataFrame(summaries)
    if output_dir:
        out_dir = Path(output_dir) if output_dir else GEN2_ROOT / "outputs"
        out.to_csv(out_dir / "rule_v2_ab_backtest.csv", index=False)
        roles.to_csv(out_dir / "rule_v2_roles.csv", index=False)
    return out


def run(output_dir=None) -> dict:
    cfg = load_gen2_config()
    bars = load_daily_bars()
    records = load_universe_records()
    features = build_feature_matrix(bars=bars, records=records, config=cfg)
    rankings = run_rank_engine(features)
    labels_uni = build_labels(features)
    labels_mkt = build_labels_vs_market(features)

    sig = signal_ab(features, rankings, labels_uni, labels_mkt)
    sig_reg = signal_ab_by_regime(features, rankings, labels_mkt)
    bt = run_v2_backtest(features, rankings, cfg, output_dir=output_dir)
    return {"signal_ab": sig, "signal_regime": sig_reg, "backtest": bt}


if __name__ == "__main__":
    pd.set_option("display.width", 200)
    pd.set_option("display.float_format", lambda x: f"{x:.4f}")
    r = run()
    print("\n## 信号层 A/B（Rank IC）\n", r["signal_ab"].to_string(index=False))
    print("\n## 分 regime IC（vs market label）\n", r["signal_regime"].to_string(index=False))
    print("\n## V2 组合层经济指标\n", r["backtest"][r["backtest"].cost_bps == 10].to_string(index=False))
