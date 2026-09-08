from __future__ import annotations

import numpy as np
import pandas as pd

from gen2.data.loader import load_gen2_config, load_universe_records

CORE_PCT = 0.80
CHALLENGER_PCT = 0.70
SATELLITE_PCT = 0.60


def _initial_roles(records: dict) -> dict[str, str]:
    roles = {}
    for code, rec in records.items():
        if not rec.core_eligible or rec.research_only:
            continue
        if rec.strategic_role_hint == "hedge":
            roles[code] = "HEDGE"
        elif rec.incumbent:
            roles[code] = "CORE"
        else:
            roles[code] = "RESERVE"
    return roles


def _consecutive_by_code(flags: pd.Series, codes: pd.Series) -> pd.Series:
    """Consecutive True count within each code, preserving the input row index."""
    df = pd.DataFrame({"code": codes, "flag": flags.astype(bool)})
    result = pd.Series(0, index=df.index, dtype="int64")
    for _, s in df.groupby("code", sort=False)["flag"]:
        c = 0
        for idx, v in s.items():
            c = c + 1 if v else 0
            result.loc[idx] = c
    return result


def _cap_core_roles(day: pd.DataFrame, max_core_count: int, max_core_per_cluster: int, priority_col: str = "leadership_score", priority_rank_col: str = "rank") -> pd.Series:
    """Return final roles for one date after global/cluster caps.

    排序依据由 priority_col / priority_rank_col 显式传入，禁止隐藏读取旧字段。
    V1 用 leadership_score/rank；V2 必须传 alpha_score_v2 / alpha_rank。
    """
    roles = day["role"].copy()
    sort_cols = [c for c in (priority_col, priority_rank_col) if c in day.columns]
    asc = [False] + [True] * (len(sort_cols) - 1)
    core = day[day["role"] == "CORE"].sort_values(sort_cols, ascending=asc)
    if core.empty:
        return roles
    keep = []
    cluster_counts: dict[str, int] = {}
    for row in core.itertuples():
        cluster = row.correlation_cluster
        if len(keep) >= max_core_count:
            continue
        if cluster_counts.get(cluster, 0) >= max_core_per_cluster:
            continue
        keep.append(row.Index)
        cluster_counts[cluster] = cluster_counts.get(cluster, 0) + 1
    demote = set(core.index) - set(keep)
    roles.loc[list(demote)] = "SATELLITE"
    return roles


def build_daily_roles(rankings: pd.DataFrame, config: dict | None = None) -> pd.DataFrame:
    cfg = config or load_gen2_config()
    pcfg = cfg["portfolio"]
    promotion_days = int(pcfg.get("promotion_persistence_days", 5))
    demotion_days = int(pcfg.get("demotion_persistence_days", 5))
    max_core_count = int(pcfg.get("max_core_count", 5))
    max_core_per_cluster = int(pcfg.get("max_core_per_cluster", 2))
    core_pct = 1.0 - float(pcfg.get("top_quantile", 0.2))
    records = load_universe_records()

    data = rankings.sort_values(["code", "trade_date"]).copy()
    data["above_core_days"] = _consecutive_by_code(data["rank_percentile"] >= core_pct, data["code"])
    data["below_satellite_days"] = _consecutive_by_code(data["rank_percentile"] < SATELLITE_PCT, data["code"])
    data = data.sort_values(["trade_date", "rank"])

    current_roles = _initial_roles(records)
    output = []

    for trade_date, day in data.groupby("trade_date", sort=True):
        day = day.copy()
        proposed = np.select(
            [
                day["rank_percentile"] >= core_pct,
                day["rank_percentile"] >= CHALLENGER_PCT,
                day["rank_percentile"] >= SATELLITE_PCT,
            ],
            ["CORE", "CHALLENGER", "SATELLITE"],
            default="RESERVE",
        )
        day["proposed_role"] = proposed
        day["role"] = day["proposed_role"]
        day["reason_codes"] = np.select(
            [
                day["rank_percentile"] >= core_pct,
                day["rank_percentile"] >= CHALLENGER_PCT,
                day["rank_percentile"] >= SATELLITE_PCT,
            ],
            ["LEADERSHIP_TOP_QUINTILE", "LEADERSHIP_CHALLENGER_ZONE", "LEADERSHIP_SATELLITE_ZONE"],
            default="LEADERSHIP_BELOW_SATELLITE",
        )

        for row in day.itertuples():
            code = row.code
            rec = records.get(code)
            current = current_roles.get(code, "RESERVE")
            role = row.proposed_role
            reasons = [row.reason_codes]

            if rec and rec.strategic_role_hint == "hedge":
                role = "HEDGE"
                reasons.append("DEFENSIVE_HEDGE_BASELINE")
            elif current == "CORE" and role in {"RESERVE", "CHALLENGER", "SATELLITE"}:
                if int(row.below_satellite_days) < demotion_days:
                    role = "CORE"
                    reasons.append("DEMOTION_HYSTERESIS_KEEP")
                else:
                    reasons.append("DEMOTION_CONFIRMED")
            elif current != "CORE" and role == "CORE":
                if int(row.above_core_days) < promotion_days:
                    role = "CHALLENGER"
                    reasons.append("PROMOTION_HYSTERESIS_WAIT")
                else:
                    reasons.append("PROMOTION_CONFIRMED")

            day.loc[row.Index, "role"] = role
            day.loc[row.Index, "reason_codes"] = "|".join(reasons)

        day["final_role_after_cap"] = _cap_core_roles(day, max_core_count, max_core_per_cluster)
        capped = day["final_role_after_cap"] != day["role"]
        day.loc[capped, "reason_codes"] = day.loc[capped, "reason_codes"] + "|CLUSTER_CAP_DEMOTED"
        day["role"] = day["final_role_after_cap"]

        for row in day.itertuples(index=False):
            current_roles[row.code] = row.role
            output.append({
                "trade_date": row.trade_date,
                "code": row.code,
                "name": row.name,
                "rank": int(row.rank),
                "rank_percentile": float(row.rank_percentile),
                "leadership_score": float(row.leadership_score),
                "correlation_cluster": row.correlation_cluster,
                "proposed_role": row.proposed_role,
                "role": row.role,
                "persistence_days": int(max(row.above_core_days, row.below_satellite_days)),
                "reason_codes": row.reason_codes,
            })
    return pd.DataFrame(output)


def write_daily_roles(rankings: pd.DataFrame, output_path=None):
    roles = build_daily_roles(rankings)
    if output_path:
        roles.to_csv(output_path, index=False)
    return roles
