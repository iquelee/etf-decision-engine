"""Gen-2.1 M1 — Hierarchical Cluster Leadership（Development 层草案，M1-r2）。

设计（PLAN_GEN2_1 §5，透明规则、不拟合权重）：
    cluster_score(day, cluster) = 簇内 alpha 前 50% 的等权 mean（alpha_score_v2）
    breadth_pass(day, cluster)  = px_ma60 > 0 的代码占比 >= breadth_min_pos  （显式 Gate，非诊断列）
    cluster_rank(day)           = 业务簇按 cluster_score 降序（broad_beta 等对照簇不参与、不占名额）
    top_cluster(day)            = rank <= top_cluster_count 且 size >= cluster_min_members 且 breadth_pass
    cluster_leader(day, code)   = 簇内 alpha 前 leaders_per_cluster（size==1 取 1）；仅限 top_cluster
                                  且非 benchmark 簇（broad_beta/空簇永不产生 leader）

broad_beta 语义（clusters_v1.json）：仅研究对照，max_core_count=0 → 不参与 rank、top_cluster=False、
is_cluster_leader=False；即使其 alpha 最高也不挤占业务簇名额。

本模块为纯函数（零 DB/网络）；panel 列：trade_date, code, correlation_cluster, alpha_score_v2, px_ma60。
所有阈值均为函数参数（消费方从 GEN2_RULE_V21_DRAFT 读取，避免 shadow config）；
无未来泄漏；时间切分由调用方按协议执行。

运行 Development 层审计：PYTHONPATH=ml python -m gen2.portfolio.cluster_leadership --audit
"""
from __future__ import annotations

import numpy as np
import pandas as pd

# 仅作函数默认值兜底（非独立真相源）。运行时参数必须显式传入（DRAFT 消费）。
BENCHMARK_CLUSTERS = {"broad_beta", ""}


def compute_cluster_leadership(
    panel: pd.DataFrame,
    top_cluster_count: int = 4,
    cluster_min_members: int = 1,
    leaders_per_cluster: int = 2,
    breadth_min_pos: float = 0.5,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """返回 (cluster_stat, code_flag)。

    cluster_stat：per (trade_date, correlation_cluster)
        size / score / breadth_pos / breadth_pass / cluster_rank / top_cluster / is_benchmark
    code_flag：per (trade_date, code)
        leader_rank_in_cluster / is_cluster_leader / cluster_top
    """
    df = panel[["trade_date", "code", "correlation_cluster", "alpha_score_v2", "px_ma60"]].copy()
    df["code"] = df["code"].astype(str).str.zfill(6)
    df = df.dropna(subset=["alpha_score_v2"])
    if df.empty:
        empty = pd.DataFrame(columns=["trade_date", "correlation_cluster", "size", "score", "breadth_pos",
                                      "breadth_pass", "cluster_rank", "top_cluster", "is_benchmark"])
        empty2 = pd.DataFrame(columns=["trade_date", "code", "leader_rank_in_cluster", "is_cluster_leader", "cluster_top"])
        return empty, empty2

    # ---- 簇层聚合（只用当日横截面）----
    rows = []
    for (d, cluster), g in df.groupby(["trade_date", "correlation_cluster"], sort=True):
        size = int(len(g))
        k = max(1, int(np.ceil(size * 0.5)))
        top_half = g.sort_values("alpha_score_v2", ascending=False).head(k)
        score = float(top_half["alpha_score_v2"].mean())
        breadth_pos = float((g["px_ma60"] > 0).mean()) if g["px_ma60"].notna().any() else 0.0
        rows.append({"trade_date": d, "correlation_cluster": cluster, "size": size,
                     "score": score, "breadth_pos": breadth_pos})
    cluster_stat = pd.DataFrame(rows)
    cluster_stat["is_benchmark"] = cluster_stat["correlation_cluster"].isin(BENCHMARK_CLUSTERS)
    cluster_stat["breadth_pass"] = cluster_stat["breadth_pos"] >= float(breadth_min_pos)

    # ---- 业务簇 rank（benchmark 不参与、不占名额）----
    biz = cluster_stat[~cluster_stat["is_benchmark"]].sort_values(["trade_date", "score"], ascending=[True, False])
    biz["cluster_rank"] = biz.groupby("trade_date").cumcount() + 1
    biz["top_cluster"] = (
        (biz["cluster_rank"] <= int(top_cluster_count))
        & (biz["size"] >= int(cluster_min_members))
        & biz["breadth_pass"]
    )
    bench = cluster_stat[cluster_stat["is_benchmark"]].copy()
    bench["cluster_rank"] = np.nan
    bench["top_cluster"] = False
    cluster_stat = pd.concat([biz, bench], ignore_index=True).sort_values(["trade_date", "correlation_cluster"]).reset_index(drop=True)

    # ---- code 层：簇内 leader（仅 top_cluster 且非 benchmark 簇；leader 名额由 leaders_per_cluster 控制）----
    df = df.merge(cluster_stat[["trade_date", "correlation_cluster", "top_cluster", "is_benchmark"]],
                  on=["trade_date", "correlation_cluster"], how="left")
    df = df.sort_values(["trade_date", "correlation_cluster", "alpha_score_v2"], ascending=[True, True, False])
    df["leader_rank_in_cluster"] = df.groupby(["trade_date", "correlation_cluster"]).cumcount() + 1
    gsize = df.groupby(["trade_date", "correlation_cluster"])["code"].transform("size")
    max_leader = np.where(gsize >= 2, int(leaders_per_cluster), 1)
    df["is_cluster_leader"] = (
        (df["leader_rank_in_cluster"] <= max_leader)
        & (df["top_cluster"] == True)  # noqa: E712
        & (~df["is_benchmark"])
    )
    code_flag = df[["trade_date", "code", "correlation_cluster", "leader_rank_in_cluster",
                    "is_cluster_leader", "top_cluster"]].rename(columns={"top_cluster": "cluster_top"}).copy()
    return cluster_stat, code_flag


def audit_development(
    panel: pd.DataFrame,
    top_cluster_count: int = 4,
    cluster_min_members: int = 1,
    leaders_per_cluster: int = 2,
    breadth_min_pos: float = 0.5,
    dev_end: str = "2023-12-31",
) -> dict:
    """Development 层审计（signal ≤ dev_end，描述性，不消费 realized return）。"""
    dev = panel[panel["trade_date"].astype(str) <= str(dev_end)]
    cs, cf = compute_cluster_leadership(dev, top_cluster_count, cluster_min_members,
                                        leaders_per_cluster, breadth_min_pos)
    if cs.empty:
        return {"cluster_stat": cs, "leader_summary": pd.DataFrame()}
    leaders_all = cf[cf["is_cluster_leader"] == True].copy()  # noqa: E712
    summary = []
    for cluster, g in cs[~cs["is_benchmark"]].groupby("correlation_cluster"):
        days = len(g)
        top_days = int(g["top_cluster"].sum())
        cl = leaders_all[leaders_all["correlation_cluster"] == cluster]
        distinct_leaders = int(cl["code"].nunique()) if len(cl) else 0
        day_sets = {d: set(gg["code"]) for d, gg in cl.groupby("trade_date")}
        ds = sorted(day_sets)
        changes = sum(1 for i in range(1, len(ds)) if day_sets[ds[i]] != day_sets[ds[i - 1]])
        leader_turnover = changes / max(1, len(ds) - 1)
        summary.append({
            "cluster": cluster,
            "n_days": days,
            "median_rank": float(g["cluster_rank"].median()),
            "top_cluster_ratio": top_days / days if days else float("nan"),
            "breadth_pass_ratio": float(g["breadth_pass"].mean()) if days else float("nan"),
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

    # 参数从 DRAFT 读（消除 shadow config）：cluster_leadership 段
    draft = __import__("json").load(open("ml/gen2/manifests/GEN2_RULE_V21_DRAFT.json", encoding="utf-8"))
    cl = draft.get("cluster_leadership", {})
    tpc = int(cl.get("top_cluster_count", 4))
    cmm = int(cl.get("cluster_min_members", 1))
    lpc = int(cl.get("leaders_per_cluster", 2))
    bmp = float(cl.get("breadth_min_pos", 0.5))

    print(f"\n## M1 Development 层审计（signal ≤ 2023-12-31；参数来自 DRAFT：count={tpc} min={cmm} leaders={lpc} breadth≥{bmp}）\n")
    r = audit_development(panel, top_cluster_count=tpc, cluster_min_members=cmm,
                          leaders_per_cluster=lpc, breadth_min_pos=bmp)
    print(r["leader_summary"].to_string(index=False, float_format=lambda x: f"{x:.3f}"))
    cs = r["cluster_stat"]
    print(f"\n  总 (cluster×day) 行：{len(cs)}（业务簇 {len(cs[~cs['is_benchmark']])} + 对照 {len(cs[cs['is_benchmark']])}）")
    print(f"  top_cluster 平均每日数：{cs[cs['top_cluster']].groupby('trade_date').size().mean():.2f}")
    cs.to_csv("outputs/gen2_v21_m1_cluster_stat.csv", index=False)
    r["leader_summary"].to_csv("outputs/gen2_v21_m1_leader_summary.csv", index=False)
    print("\n[OK] outputs/gen2_v21_m1_*.csv")
