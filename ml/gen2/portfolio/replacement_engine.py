from __future__ import annotations

import pandas as pd

from gen2.data.loader import load_gen2_config


def build_rotation_events(roles: pd.DataFrame, config: dict | None = None) -> pd.DataFrame:
    """Build daily replacement diagnostics from the role state machine output."""
    cfg = config or load_gen2_config()
    penalties = cfg.get("rotation", {}).get("penalties", {}) if "rotation" in cfg else {}
    corr_pen = float(penalties.get("correlation_penalty", 2.0))
    turn_pen = float(penalties.get("turnover_penalty", 2.0))
    crowd_pen = float(penalties.get("crowding_penalty", 1.0))
    min_edge = float(cfg["portfolio"].get("min_replacement_edge", 8.0))

    events = []
    prev_roles: dict[str, str] = {}
    for trade_date, day in roles.groupby("trade_date", sort=True):
        day = day.copy()
        cores = day[day["role"] == "CORE"].sort_values("leadership_score")
        challengers = day[day["role"].isin(["CHALLENGER", "SATELLITE"])].sort_values("leadership_score", ascending=False)

        if not cores.empty and not challengers.empty:
            incumbent = cores.iloc[0]
            challenger = challengers.iloc[0]
            raw_edge = float(challenger["leadership_score"] - incumbent["leadership_score"])
            final_edge = raw_edge - corr_pen - turn_pen - crowd_pen
            prev = prev_roles.get(str(challenger["code"]), "RESERVE")
            decision = "REPLACE_READY" if final_edge >= min_edge and int(challenger["persistence_days"]) >= 5 else "HOLD"
            events.append({
                "trade_date": trade_date,
                "incumbent": incumbent["code"],
                "challenger": challenger["code"],
                "incumbent_score": float(incumbent["leadership_score"]),
                "challenger_score": float(challenger["leadership_score"]),
                "raw_edge": raw_edge,
                "correlation_penalty": corr_pen,
                "turnover_penalty": turn_pen,
                "crowding_penalty": crowd_pen,
                "final_edge": final_edge,
                "persistence_days": int(challenger["persistence_days"]),
                "previous_challenger_role": prev,
                "decision": decision,
            })

        for row in day.itertuples(index=False):
            prev_roles[str(row.code)] = row.role
    return pd.DataFrame(events)
