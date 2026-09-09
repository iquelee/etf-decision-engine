"""Gen-2.1 M3-r3 — 组合权重构建纯函数（单一真相源，供状态机/回测/诊断复用）。

原 rule_v2_ab / rule_v21_ab 内联权重逻辑（25% 单只 → 40% cluster → 65% tech 按比例缩）
抽取为可复用纯函数。V2.1 Replacement Gate 用它计算替换后的 projected trade weight
（真实目标权重口径，非 1/N 近似）。

输入契约：core_rows 含 [trade_date, code, correlation_cluster]；同一交易日多行时按
trade_date 分组执行。返回 DataFrame[code, relative_share, target_weight, trade_date]。
本模块零 DB、零 IO、无状态。
"""
from __future__ import annotations

import pandas as pd


def _apply_caps_single_day(day: pd.DataFrame, pcfg: dict) -> pd.DataFrame:
    """对单日 CORE 行施加 25% 单只 / 40% cluster / 65% tech 上限（按比例缩）。"""
    max_single = float(pcfg.get("max_single_weight", 0.25))
    max_cluster = float(pcfg.get("max_cluster_weight", 0.40))
    max_tech = float(pcfg.get("max_tech_weight", 0.65))
    tech_clusters = set(pcfg.get("tech_clusters", ["tech_hardware", "software_ai"]))

    out = day.copy()
    n = len(out)
    out["relative_share"] = 1.0 / n
    out["target_weight"] = out["relative_share"].clip(upper=max_single)
    # cluster cap（同簇 CORE 权重和 <= max_cluster）
    pieces = []
    for _cl, g in out.groupby("correlation_cluster"):
        total = g["target_weight"].sum()
        if total > max_cluster:
            g = g.copy()
            g["target_weight"] = g["target_weight"] * (max_cluster / total)
        pieces.append(g)
    out = pd.concat(pieces, ignore_index=True)
    # tech 跨 cluster 敞口（只缩 tech，不动非 tech）
    tech_total = float(out.loc[out["correlation_cluster"].isin(tech_clusters), "target_weight"].sum())
    if tech_total > max_tech:
        k = max_tech / tech_total
        out.loc[out["correlation_cluster"].isin(tech_clusters), "target_weight"] *= k
    return out


def compute_core_weights(core_rows: pd.DataFrame, pcfg: dict) -> pd.DataFrame:
    """对多日 CORE 行施加权重 cap，返回完整行（非 CORE 目标权重 0 由调用方回填）。

    Parameters
    ----------
    core_rows : 仅 CORE 行，含 [trade_date, code, correlation_cluster]。
    pcfg : config["portfolio"] 段（max_single_weight/max_cluster_weight/max_tech_weight/tech_clusters）。
    """
    cols = [c for c in ("trade_date", "code", "correlation_cluster") if c in core_rows.columns]
    df = core_rows[cols].copy()
    if df.empty:
        return df.assign(relative_share=0.0, target_weight=0.0)
    out = []
    for _, day in df.groupby("trade_date", sort=True):
        out.append(_apply_caps_single_day(day, pcfg))
    res = pd.concat(out, ignore_index=True)
    return res[["trade_date", "code", "relative_share", "target_weight"]]


def projected_trade_weight(tentative_core_rows: pd.DataFrame, pcfg: dict,
                           challenger_code: str, incumbent_code: str) -> float:
    """替换后 projected trade weight：tentative CORE 集（incumbent 已移除、challenger 已加入）
    经完整 cap 后 challenger 的实际目标权重（= 新仓单只权重，两腿换仓以此估算）。

    返回 weight_delta = challenger 目标权重（替换带来的净增仓幅度上界）；
    交易成本 = weight_delta × cost_bps × 2 + cost_buffer_bps 由调用方按该值计算。
    """
    df = compute_core_weights(tentative_core_rows, pcfg)
    row = df[df["code"] == challenger_code]
    return float(row["target_weight"].iloc[0]) if len(row) else 0.0
