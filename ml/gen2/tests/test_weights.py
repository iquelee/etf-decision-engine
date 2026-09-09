"""Gen-2.1 M3-r3 — portfolio.weights 单元测试（单一权重实现 + projected trade weight）。

验证：25% 单只 / 40% cluster / 65% tech cap 按比例缩、多日分组、projected_trade_weight
（替换后 tentative 集经完整 cap 的真实目标权重）。
"""
from __future__ import annotations

import unittest

import pandas as pd

from gen2.portfolio.weights import compute_core_weights, projected_trade_weight


def _pcfg(**over):
    p = {"max_single_weight": 0.25, "max_cluster_weight": 0.40,
         "max_tech_weight": 0.65, "tech_clusters": ["tech_hardware", "software_ai"]}
    p.update(over)
    return p


class TestComputeCoreWeights(unittest.TestCase):
    def test_single_cap_at_25(self):
        # 3 CORE：2 tech_hardware（clip 0.25×2=0.5 → cluster 缩 0.2/只）+ 1 gold(0.25)
        # 合计 0.2+0.2+0.25 = 0.65
        df = pd.DataFrame([
            {"trade_date": "2024-01-02", "code": "513310", "correlation_cluster": "tech_hardware"},
            {"trade_date": "2024-01-02", "code": "515880", "correlation_cluster": "tech_hardware"},
            {"trade_date": "2024-01-02", "code": "518880", "correlation_cluster": "gold_commodity"},
        ])
        w = compute_core_weights(df, _pcfg())
        self.assertAlmostEqual(w["target_weight"].sum(), 0.65, places=6)
        self.assertTrue((w["target_weight"] <= 0.250001).all())
        tech = w[w["code"].isin(["513310", "515880"])]["target_weight"].sum()
        self.assertAlmostEqual(tech, 0.40, places=6, msg="同簇 2 只 → cluster cap 40%")

    def test_cluster_cap_40(self):
        # 5 只 tech → 每只 clip 0.25 → cluster 总 1.25 → 缩到 0.40（5 只均分 0.08）
        rows = [{"trade_date": "2024-01-02", "code": f"T{i}", "correlation_cluster": "tech_hardware"}
                for i in range(5)]
        w = compute_core_weights(pd.DataFrame(rows), _pcfg())
        tech_total = w[w["code"].isin(["T0", "T1", "T2", "T3", "T4"])]["target_weight"].sum()
        self.assertAlmostEqual(tech_total, 0.40, places=6)
        # cluster cap 后每只 0.08 ≤ 单只 0.25
        self.assertAlmostEqual(w["target_weight"].iloc[0], 0.08, places=4)

    def test_tech_65_across_clusters(self):
        # 4 只跨两 tech 簇（tech_hardware+software_ai 都算广义科技）：各 0.25 → tech 总 1.0 → 缩 0.65；
        # cluster 内各 2 只 → 单只 clip 后 0.5/簇 若单算也 >0.4 会先触发 cluster cap？
        # 顺序：先单只 0.25 → cluster(2只=0.5>0.4) 缩到 0.2/只 → tech 总 0.8 仍 >0.65 → 再缩到 0.65
        rows = [
            {"trade_date": "2024-01-02", "code": "513310", "correlation_cluster": "tech_hardware"},
            {"trade_date": "2024-01-02", "code": "515880", "correlation_cluster": "tech_hardware"},
            {"trade_date": "2024-01-02", "code": "588000", "correlation_cluster": "software_ai"},
            {"trade_date": "2024-01-02", "code": "512480", "correlation_cluster": "software_ai"},
        ]
        w = compute_core_weights(pd.DataFrame(rows), _pcfg())
        tech = w[w["code"].isin(["513310", "515880", "588000", "512480"])]["target_weight"].sum()
        # cluster cap 后每簇 0.2×2=0.4，两簇 tech 总 0.8 → tech cap 缩 k=0.65/0.8 → 各 0.1625
        self.assertAlmostEqual(tech, 0.65, places=6)
        self.assertAlmostEqual(w["target_weight"].iloc[0], 0.1625, places=4)

    def test_multi_day_grouping(self):
        rows = []
        for d in ("2024-01-02", "2024-01-03"):
            rows.append({"trade_date": d, "code": "513310", "correlation_cluster": "tech_hardware"})
            rows.append({"trade_date": d, "code": "518880", "correlation_cluster": "gold_commodity"})
        w = compute_core_weights(pd.DataFrame(rows), _pcfg())
        self.assertEqual(len(w), 4)
        self.assertEqual(w.groupby("trade_date")["target_weight"].sum().nunique(), 1)

    def test_empty_returns_zero(self):
        w = compute_core_weights(pd.DataFrame(columns=["trade_date", "code", "correlation_cluster"]), _pcfg())
        self.assertTrue(w.empty)


class TestProjectedTradeWeight(unittest.TestCase):
    def test_2_core_projected_at_25_cap(self):
        # 2 CORE：1/2=0.5 clip → 0.25。替换后 challenger 目标权重 0.25
        rows = pd.DataFrame([
            {"trade_date": "2024-01-02", "code": "CHAL", "correlation_cluster": "tech_hardware"},
            {"trade_date": "2024-01-02", "code": "INC", "correlation_cluster": "tech_hardware"},
        ])
        # 注意同簇 2 只 → cluster total 0.5 > 0.4 → 缩到 0.2 每只
        wd = projected_trade_weight(rows, _pcfg(), "CHAL", "INC")
        self.assertAlmostEqual(wd, 0.20, places=6, msg="2 tech 同簇 → cluster 40% cap 后各 0.20")

    def test_5_core_no_cap_dilution(self):
        # 现 CORE 集 {C0..C4}，C0 替换 C1 → tentative = {C0,C2,C3,C4}，全异簇 → 各 0.25（无 cluster cap）
        day = pd.DataFrame([
            {"trade_date": "2024-01-02", "code": f"C{i}",
             "correlation_cluster": ["cl0", "cl1", "cl2", "cl3", "cl4"][i]}
            for i in range(5)
        ])
        tentative = day[day["code"].isin({"C0", "C2", "C3", "C4"})]
        wd = projected_trade_weight(tentative, _pcfg(), "C0", "C1")
        self.assertAlmostEqual(wd, 0.25, places=6, msg="4 CORE 异簇替换后 challenger 目标权重 0.25")

    def test_tentative_set_callsite_semantics(self):
        # 复刻 rule_v21 调用方：同簇 2 CORE（tech），替换后 tentative 仍 2 只同簇
        # → cluster cap 40% 后各 0.20
        current = pd.DataFrame([
            {"trade_date": "2024-01-02", "code": "INC", "correlation_cluster": "tech_hardware"},
            {"trade_date": "2024-01-02", "code": "CHAL", "correlation_cluster": "tech_hardware"},
        ])
        wd = projected_trade_weight(current, _pcfg(), "CHAL", "INC")
        self.assertAlmostEqual(wd, 0.20, places=6)


if __name__ == "__main__":
    unittest.main(verbosity=2)
