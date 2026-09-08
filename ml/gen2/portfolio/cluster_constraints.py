from __future__ import annotations

import pandas as pd


def apply_cluster_cap(day: pd.DataFrame, max_core_count: int = 5, max_core_per_cluster: int = 2) -> pd.DataFrame:
    """Return a copy with CORE roles demoted when global/cluster caps bind."""
    out = day.copy()
    core_idx = out.index[out["role"] == "CORE"].tolist()
    if not core_idx:
        return out

    core = out.loc[core_idx].sort_values(["leadership_score", "rank"], ascending=[False, True])
    keep = []
    cluster_counts: dict[str, int] = {}
    for idx, row in core.iterrows():
        cluster = row["correlation_cluster"]
        if len(keep) >= max_core_count:
            continue
        if cluster_counts.get(cluster, 0) >= max_core_per_cluster:
            continue
        keep.append(idx)
        cluster_counts[cluster] = cluster_counts.get(cluster, 0) + 1

    demote = [idx for idx in core.index if idx not in set(keep)]
    out.loc[demote, "role"] = "SATELLITE"
    out.loc[demote, "reason_codes"] = out.loc[demote, "reason_codes"].apply(lambda x: [*x, "CLUSTER_CAP_DEMOTED"])
    out.loc[keep, "reason_codes"] = out.loc[keep, "reason_codes"].apply(lambda x: [*x, "CLUSTER_CAP_PASS"])
    return out
