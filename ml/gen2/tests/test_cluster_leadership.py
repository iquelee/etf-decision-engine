"""Gen-2.1 M1 — cluster_leadership 单元测试（M1-r2：breadth Gate / broad_beta 隔离 / 参数化）。

验证：簇层聚合（alpha 前 50% 等权 mean）、breadth_pass 显式 Gate、跨簇 cluster_rank（benchmark
不参与不占名额）、top_cluster 门槛、簇内 leader（参数化 leaders_per_cluster）、weak cluster、
broad_beta 永不 leader/top（高分也不挤占业务簇）、NaN 处理、参数显式消费（无 shadow config）。
"""
from __future__ import annotations

import unittest

import pandas as pd

from gen2.portfolio.cluster_leadership import BENCHMARK_CLUSTERS, compute_cluster_leadership


def _panel(dates=("2023-01-03", "2023-01-04"), codes=None, alpha=None, px=None, cluster=None):
    codes = codes or ["513310", "515880", "159582", "518880"]
    cluster = cluster or {"513310": "tech_hardware", "515880": "tech_hardware",
                          "159582": "tech_hardware", "518880": "gold_commodity"}
    alpha = alpha or {"513310": 90.0, "515880": 80.0, "159582": 70.0, "518880": 50.0}
    px = px or {"513310": 0.05, "515880": 0.03, "159582": -0.02, "518880": 0.01}
    rows = []
    for d in dates:
        for c in codes:
            rows.append({"trade_date": d, "code": c, "correlation_cluster": cluster[c],
                         "alpha_score_v2": alpha[c], "px_ma60": px[c]})
    return pd.DataFrame(rows)


class TestClusterLeadership(unittest.TestCase):
    def test_cluster_score_is_top_half_mean(self):
        panel = _panel()
        cs, _ = compute_cluster_leadership(panel, top_cluster_count=1, breadth_min_pos=0.0)
        tech = cs[cs["correlation_cluster"] == "tech_hardware"].iloc[0]
        self.assertAlmostEqual(tech["score"], 85.0, places=6)  # mean(90,80)=85
        gold = cs[cs["correlation_cluster"] == "gold_commodity"].iloc[0]
        self.assertAlmostEqual(gold["score"], 50.0, places=6)

    def test_breadth_pass_is_explicit_gate(self):
        # tech：px_ma60>0 = 2/3 ≈ 0.67 → breadth_min_pos=0.8 时不 pass → 即使 alpha 高也不 top
        panel = _panel()
        cs, cf = compute_cluster_leadership(panel, top_cluster_count=5, cluster_min_members=1,
                                            breadth_min_pos=0.8)
        tech = cs[cs["correlation_cluster"] == "tech_hardware"].iloc[0]
        self.assertFalse(bool(tech["breadth_pass"]))
        self.assertFalse(bool(tech["top_cluster"]), "breadth 不过 Gate 不得 top_cluster")
        gold = cs[cs["correlation_cluster"] == "gold_commodity"].iloc[0]
        self.assertTrue(bool(gold["breadth_pass"]))
        self.assertTrue(bool(gold["top_cluster"]))
        # 参数放宽容则通过（阈值被显式消费）
        cs2, _ = compute_cluster_leadership(panel, top_cluster_count=5, cluster_min_members=1,
                                            breadth_min_pos=0.5)
        self.assertTrue(bool(cs2[cs2["correlation_cluster"] == "tech_hardware"].iloc[0]["top_cluster"]))

    def test_broad_beta_never_participates(self):
        # 510300 alpha 最高也：top_cluster=False / 非 leader / 不占业务簇 rank 名额
        panel = _panel(codes=["510300", "513310", "518880"],
                       cluster={"510300": "broad_beta", "513310": "tech_hardware", "518880": "gold_commodity"},
                       alpha={"510300": 99.0, "513310": 40.0, "518880": 30.0},
                       px={"510300": 0.1, "513310": 0.0, "518880": 0.0})
        cs, cf = compute_cluster_leadership(panel, top_cluster_count=1, cluster_min_members=1, breadth_min_pos=0.0)
        bb = cs[cs["correlation_cluster"] == "broad_beta"].iloc[0]
        self.assertTrue(bool(bb["is_benchmark"]))
        self.assertFalse(bool(bb["top_cluster"]))
        self.assertTrue(pd.isna(bb["cluster_rank"]), "broad_beta 不参与 rank")
        # tech(40) 虽低于 broad_beta(99) 仍是业务簇 rank1 → 未被挤占
        tech = cs[cs["correlation_cluster"] == "tech_hardware"].iloc[0]
        self.assertEqual(tech["cluster_rank"], 1)
        self.assertTrue(bool(tech["top_cluster"]))
        # broad_beta 的 code 永不 leader
        day = "2023-01-03"
        bb_codes = cf[(cf["trade_date"] == day) & (cf["correlation_cluster"] == "broad_beta")]
        self.assertFalse(bool(bb_codes["is_cluster_leader"].any()))

    def test_benchmark_clusters_constant(self):
        self.assertIn("broad_beta", BENCHMARK_CLUSTERS)
        self.assertIn("", BENCHMARK_CLUSTERS)

    def test_cluster_rank_and_top_threshold(self):
        panel = _panel()
        cs, _ = compute_cluster_leadership(panel, top_cluster_count=1, cluster_min_members=1, breadth_min_pos=0.0)
        d = cs[(cs["trade_date"] == "2023-01-03") & (~cs["is_benchmark"])]
        tech = d[d["correlation_cluster"] == "tech_hardware"].iloc[0]
        gold = d[d["correlation_cluster"] == "gold_commodity"].iloc[0]
        self.assertEqual(tech["cluster_rank"], 1)
        self.assertTrue(bool(tech["top_cluster"]))
        self.assertEqual(gold["cluster_rank"], 2)
        self.assertFalse(bool(gold["top_cluster"]))

    def test_min_members_and_single_size_leader(self):
        panel = _panel()
        cs, cf = compute_cluster_leadership(panel, top_cluster_count=5, cluster_min_members=2, breadth_min_pos=0.0)
        gold = cs[cs["correlation_cluster"] == "gold_commodity"].iloc[0]
        self.assertFalse(bool(gold["top_cluster"]), "size=1 < min_members=2")
        # leaders_per_cluster 显式消费：tech 3 只 + leaders=2 → 取 alpha 前 2
        cs2, cf2 = compute_cluster_leadership(panel, top_cluster_count=5, cluster_min_members=1,
                                              leaders_per_cluster=2, breadth_min_pos=0.0)
        day = "2023-01-03"
        tech = cf2[(cf2["trade_date"] == day) & (cf2["correlation_cluster"] == "tech_hardware")]
        self.assertEqual(set(tech[tech["is_cluster_leader"] == True]["code"]), {"513310", "515880"})  # noqa: E712

    def test_leaders_per_cluster_parametrized(self):
        # 4 只同簇 + leaders=3 → 取前 3
        codes = ["513310", "515880", "159582", "159995"]
        panel = _panel(codes=codes,
                       cluster={c: "tech_hardware" for c in codes},
                       alpha={"513310": 90, "515880": 80, "159582": 70, "159995": 60},
                       px={c: 0.01 for c in codes})
        _, cf = compute_cluster_leadership(panel, top_cluster_count=5, cluster_min_members=1,
                                           leaders_per_cluster=3, breadth_min_pos=0.0)
        day = "2023-01-03"
        tech = cf[(cf["trade_date"] == day) & (cf["correlation_cluster"] == "tech_hardware")]
        self.assertEqual(len(tech[tech["is_cluster_leader"] == True]), 3)  # noqa: E712

    def test_weak_cluster_not_top_no_leaders(self):
        panel = _panel()
        _, cf = compute_cluster_leadership(panel, top_cluster_count=1, cluster_min_members=1, breadth_min_pos=0.0)
        gold = cf[(cf["trade_date"] == "2023-01-03") & (cf["correlation_cluster"] == "gold_commodity")]
        self.assertFalse(bool(gold["is_cluster_leader"].any()))

    def test_nan_alpha_dropped(self):
        panel = _panel(dates=("2023-01-03",))
        panel.loc[panel["code"] == "159582", "alpha_score_v2"] = float("nan")
        cs, _ = compute_cluster_leadership(panel, top_cluster_count=5, cluster_min_members=1, breadth_min_pos=0.0)
        tech = cs[cs["correlation_cluster"] == "tech_hardware"].iloc[0]
        self.assertAlmostEqual(tech["score"], 90.0, places=6)
        self.assertTrue((cs["size"] >= 1).all())


if __name__ == "__main__":
    unittest.main(verbosity=2)
