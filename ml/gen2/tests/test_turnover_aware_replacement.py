"""Gen-2.1 M3 — turnover_aware_replacement 单元测试。

验证 5 硬门语义：每门单独可失败、全过才 allow、Gate OFF 跳过 consolidation、
min-hold 保护、edge/cost 阈值、tenure 工具。
"""
from __future__ import annotations

import unittest

import pandas as pd

from gen2.portfolio.turnover_aware_replacement import (
    DEFAULT_V21_REPLACEMENT,
    expected_turnover_cost,
    replacement_gate,
    tenure_days_by_code,
)


def _all_pass(over: dict | None = None) -> dict:
    """构造全过基线：挑战者 cluster top、quality 高分、alpha 领先、现任超 min-hold。"""
    base = {
        "challenger_alpha": 95.0,
        "incumbent_alpha": 50.0,   # delta=45 → 225 bps/日 → 20D=4500bps >> cost
        "challenger_cluster_top": True,
        "challenger_quality": 80.0,
        "min_quality": 60.0,
        "incumbent_tenure_days": 20,
    }
    base.update(over or {})
    return base


class TestReplacementGate(unittest.TestCase):
    def test_all_pass_allows(self):
        allow, failed = replacement_gate(**_all_pass())
        self.assertTrue(allow, f"5 门全过应允许替换，failed={failed}")

    def test_gate1_cluster_not_top(self):
        allow, failed = replacement_gate(**_all_pass({"challenger_cluster_top": False}))
        self.assertFalse(allow)
        self.assertIn("cluster_qualified", failed)

    def test_gate2_consolidation_below_threshold(self):
        allow, failed = replacement_gate(**_all_pass({"challenger_quality": 40.0, "min_quality": 60.0}))
        self.assertFalse(allow)
        self.assertIn("consolidation_pass", failed)

    def test_gate2_off_passes_any_quality(self):
        allow, failed = replacement_gate(**_all_pass({"challenger_quality": 10.0, "min_quality": None}))
        self.assertTrue(allow, f"Gate OFF 时 consolidation 恒过，failed={failed}")

    def test_gate3_alpha_not_superior(self):
        allow, failed = replacement_gate(**_all_pass({"challenger_alpha": 50.0, "incumbent_alpha": 95.0}))
        self.assertFalse(allow)
        self.assertIn("leadership_superior", failed)
        self.assertNotIn("edge_gt_cost_hurdle", failed)  # 短路：不重复算 gate4

    def test_gate4_edge_below_cost(self):
        # alpha delta 足够大时 edge 必然超成本 → allow（量纲桥验证）
        allow, failed = replacement_gate(**_all_pass())
        self.assertTrue(allow, f"delta=45 默认量纲 edge 远超成本，failed={failed}")

    def test_gate4_edge_below_cost_strict(self):
        # 收紧量纲桥使 20D edge(1bps) <= 两腿成本(10bps) → FAIL edge_gt_cost_hurdle
        allow, failed = replacement_gate(**_all_pass({
            "challenger_alpha": 50.5, "incumbent_alpha": 50.0,
        }), cfg={"alpha_to_excess_bps": 0.1, "max_single_weight": 0.5, "cost_bps": 10.0})
        self.assertFalse(allow)
        self.assertIn("edge_gt_cost_hurdle", failed)

    def test_gate5_min_hold_protection(self):
        allow, failed = replacement_gate(**_all_pass({"incumbent_tenure_days": 3}))
        self.assertFalse(allow)
        self.assertIn("no_persistence_protection", failed)

    def test_multi_failures_collected(self):
        allow, failed = replacement_gate(**_all_pass({
            "challenger_cluster_top": False,
            "challenger_quality": 10.0,
            "incumbent_tenure_days": 1,
        }))
        self.assertFalse(allow)
        for g in ("cluster_qualified", "consolidation_pass", "no_persistence_protection"):
            self.assertIn(g, failed)

    def test_cost_formula(self):
        self.assertEqual(expected_turnover_cost(0.25, 10.0), 5.0)
        self.assertEqual(expected_turnover_cost(0.0, 10.0), 0.0)


class TestTenure(unittest.TestCase):
    def test_consecutive_and_reset(self):
        df = pd.DataFrame({
            "code": ["513310"] * 4 + ["515880"] * 2,
            "trade_date": ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05",
                           "2024-01-02", "2024-01-03"],
        })
        t = tenure_days_by_code(df)
        self.assertEqual(t["513310"], 4)
        self.assertEqual(t["515880"], 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
