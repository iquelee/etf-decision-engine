"""Gen-2.1 M1 — Hierarchical Cluster Leadership（Development 层草案）。

设计（PLAN_GEN2_1 §5，透明规则、不拟合权重）：
    cluster_score(day, cluster) = 簇内 alpha 前 50% 的等权 mean（trend+rs+breakout 聚合）
        + 簇 px_ma60 广度（breadth）条件
    cluster_rank(day)           = 当日跨簇按 cluster_score 降序
    top_cluster(day)            = cluster_rank <= top_cluster_count 且 size >= cluster_min_members
    cluster_leader(day, c)      = 簇内 alpha 最高的前 2（size==1 时 1 只）进入 ETF 层候选

弱簇（非 top_cluster）整簇不进入 ETF 层候选（由调用方降 SATELLITE/RESERVE），
从源头消灭「跨资产无意义轮动」。

本模块为纯函数（零 DB/网络），输入为已含当日评分/价格的宽表 panel：
    panel 列：trade_date, code, correlation_cluster, alpha_score_v2, px_ma60
无未来泄漏：只用当日横截面；时间切分由调用方（协议 §2 Development/Validation/Frozen）执行。

运行 Development 层审计：
    PYTHONPATH=ml python -m gen2.portfolio.cluster_leadership --audit
"""
from __future__ import annotations

import numpy as np
import pandas as pd

MIN_LEADERS_PER_CLUSTER = 1
MAX_LEADERS_PER_CLUSTER = 2  # 核心簇可 top2，与 cluster cap(max_core_per_cluster=2) 一致


def compute_cluster_leadership(
    panel: pd.DataFrame,
    top_cluster_count: int = 4,
    cluster_min_members: int = 1,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """返回 (cluster_stat, code_flag)。

    cluster_stat：per (trade_date, correlation_cluster)
        size / score / breadth / cluster_rank / top_cluster
    code_flag：per (trade_date, code)
        leader_rank_in_cluster / is_cluster_leader / cluster_top
    """
    df = panel[["trade_date", "code", "correlation_cluster", "alpha_score_v2", "px_ma60"]].copy()
    df["code"] = df["code"].astype(str).str.zfill(6)
    df = df.dropna(subset=["alpha_score_v2"])
    if df.empty:
        empty = pd.DataFrame(columns=["trade_date", "correlation_cluster", "size", "score", "breadth", "cluster_rank", "top_cluster"])
        empty2 = pd.DataFrame(columns=["trade_date", "code", "leader_rank_in_cluster", "is_cluster_leader", "cluster_top"])
        return empty, empty2

    # ---- 簇层聚合（只用当日横截面）----
    cl = []
    for (d, cluster), g in df.groupby(["trade_date", "correlation_cluster"], sort=True):
        size = int(len(g))
        # alpha 前 50% 等权 mean（去掉 NaN 后至少 1 只）
        k = max(1, int(np.ceil(size * 0.5)))
        top_half = g.sort_values("alpha_score_v2", ascending=False).head(k)
        score = float(top_half["alpha_score_v2"].mean())
        breadth = float(g["px_ma60"].notna().mean()) if g["px_ma60"].notna().any() else 0.0
        # 广度条件 = px_ma60 > 0 占比（进入 score 的弱化项，见 PLAN：px_ma60 广度双保险）
        breadth_pos = float((g["px_ma60"] > 0).mean()) if g["px_ma60"].notna().any() else 0.0
        cl.append({"trade_date": d, "correlation_cluster": cluster, "size": size, "score": score,
                   "breadth": breadth, "breadth_pos": breadth_pos})
    cluster_stat = pd.DataFrame(cl)
    cluster_stat = cluster_stat.sort_values(["trade_date", "score"], ascending=[True, False])
    cluster_stat["cluster_rank"] = cluster_stat.groupby("trade_date").cumcount() + 1
    cluster_stat["top_cluster"] = (
        (cluster_stat["cluster_rank"] <= int(top_cluster_count))
        & (cluster_stat["size"] >= int(cluster_min_members))
    )
    cluster_stat["is_benchmark"] = cluster_stat["correlation_cluster"].isin(["broad_beta", ""])

    # ---- code 层：簇内 leader 标注 ----
    df = df.merge(
        cluster_stat[["trade_date", "correlation_cluster", "top_cluster"]],
        on=["trade_date", "correlation_cluster"], how="left",
    )
    df = df.sort_values(["trade_date", "correlation_cluster", "alpha_score_v2"], ascending=[True, True, False])
    df["leader_rank_in_cluster"] = df.groupby(["trade_date", "correlation_cluster"]).cumcount() + 1
    gsize = df.groupby(["trade_date", "correlation_cluster"])["code"].transform("size")
    max_leader = np.where(gsize >= 2, MAX_LEADERS_PER_CLUSTER, MIN_LEADERS_PER_CLUSTER)
    df["is_cluster_leader"] = (df["leader_rank_in_cluster"] <= max_leader) & (df["top_cluster"] == True)  # noqa: E712
    code_flag = df[["trade_date", "code", "correlation_cluster", "leader_rank_in_cluster",
                    "is_cluster_leader", "top_cluster"]].rename(columns={"top_cluster": "cluster_top"}).copy()
    return cluster_stat, code_flag


def audit_development(
    panel: pd.DataFrame,
    top_cluster_count: int = 4,
    cluster_min_members: int = 1,
    dev_end: str = "2023-12-31",
) -> dict:
    """Development 层审计（signal ≤ dev_end，描述性，不消费 realized return）。

    输出每簇在开发段的结构动态，供 M1 审批判断设计有效性（非 Gate）。
    """
    dev = panel[panel["trade_date"].astype(str) <= str(dev_end)]
    cs, cf = compute_cluster_leadership(dev, top_cluster_count, cluster_min_members)
    if cs.empty:
        return {"cluster_stat": cs, "leader_summary": pd.DataFrame()}
    # 每簇在开发段的分布
    leaders_all = cf[cf["is_cluster_leader"] == True].copy()  # noqa: E712
    summary = []
    for cluster, g in cs.groupby("correlation_cluster"):
        days = len(g)
        top_days = int(g["top_cluster"].sum())
        cl = leaders_all[leaders_all["correlation_cluster"] == cluster]
        distinct_leaders = int(cl["code"].nunique()) if len(cl) else 0
        # leader 稳定性：leader code 集合在相邻交易日的变化率（0=从不换 leader，1=每日都变）
        day_sets = {d: set(gg["code"]) for d, gg in cl.groupby("trade_date")}
        ds = sorted(day_sets)
        changes = sum(1 for i in range(1, len(ds)) if day_sets[ds[i]] != day_sets[ds[i - 1]])
        leader_turnover = changes / max(1, len(ds) - 1)
        summary.append({
            "cluster": cluster,
            "n_days": days,
            "median_rank": float(g["cluster_rank"].median()),
            "top_cluster_ratio": top_days / days if days else float("nan"),
            "distinct_leader_codes": distinct_leaders,
            "leader_turnover": float(leader_turnover),
            "mean_score": float(g["score"].mean()),
        })
    return {"cluster_stat": cs, "leader_summary": pd.DataFrame(summary).sort_values("mean_score", ascending=False)}


if __name__ == "__main__":
    import sys

    if "--audit" not in sys.argv:
        print(__doc__)
        sys.exit(0)
    from gen2.baseline.alpha_score import compute_alpha_score_v2
    from gen2.data.loader import load_daily_bars, load_gen2_config, load_universe_records
    from gen2.features.build_features import build_feature_matrix
    from gen2.ranking.rank_engine import run_rank_engine

    pd.set_option("display.width", 220)
    pd.set_option("display.max_rows", 200)
    cfg = load_gen2_config()
    bars = load_daily_bars()
    records = load_universe_records()
    features = build_feature_matrix(bars=bars, records=records, config=cfg)
    rankings = run_rank_engine(features)
    alpha = compute_alpha_score_v2(features, eligible_only=True)
    panel = rankings.merge(
        alpha[["trade_date", "code", "alpha_score_v2"]], on=["trade_date", "code"], how="left"
    ).merge(features[["trade_date", "code", "px_ma60"]], on=["trade_date", "code"], how="left")
    panel["code"] = panel["code"].astype(str).str.zfill(6)

    print("\n## M1 Development 层审计（signal ≤ 2023-12-31）\n")
    dev_end = "2023-12-31"
    r = audit_development(panel, dev_end=dev_end)
    print(r["leader_summary"].to_string(index=False, float_format=lambda x: f"{x:.3f}"))
    cs = r["cluster_stat"]
    print(f"\n  总 (cluster×day) 行：{len(cs)}；当日簇数范围：{[int(x) for x in [cs.groupby('trade_date').size().min(), cs.groupby('trade_date').size().max()]]}")
    print(f"  top_cluster 平均每日数：{cs[cs['top_cluster']].groupby('trade_date').size().mean():.1f}")
    cs.to_csv("outputs/gen2_v21_m1_cluster_stat.csv", index=False)
    r["leader_summary"].to_csv("outputs/gen2_v21_m1_leader_summary.csv", index=False)
    print("\n[OK] outputs/gen2_v21_m1_*.csv")
