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
        # 实际换仓口径：delta=0.5 → 0.5×0.1×20=1bps edge；cost=weight_delta(0.2)×10×2=4bps + buffer5=9 → FAIL
        allow, failed = replacement_gate(**_all_pass({
            "challenger_alpha": 50.5, "incumbent_alpha": 50.0,
        }), cfg={"alpha_to_excess_bps": 0.1, "cost_bps": 10.0})
        self.assertFalse(allow)
        self.assertIn("edge_gt_cost_hurdle", failed)

    def test_gate4_uses_actual_weight_delta(self):
        # weight_delta 越小（CORE 池越大）→ 成本越低 → 同一边际可通过
        # delta=1.0 → 5bps/日 × 20 = 100bps edge（默认映射）
        # weight_delta=0.05 → cost=0.05×10×2=1bps + buffer5 → 100>6 → allow
        # weight_delta=0.5  → cost=0.5×10×2=10bps + buffer5 → 100>15 → 仍 allow
        # 关键：实际成本随 weight_delta 变化，非固定 0.25（用苛刻映射暴露差异）
        args = _all_pass({"challenger_alpha": 51.0, "incumbent_alpha": 50.0})
        allow_small, _ = replacement_gate(**args, cfg={"alpha_to_excess_bps": 0.2, "cost_bps": 10.0})
        # delta=1×0.2×20=4bps；cost(wd=0.05)=1 + buffer5=6 → 4<=6 → FAIL（wd 小也拦）
        args2 = _all_pass({"challenger_alpha": 51.0, "incumbent_alpha": 50.0})
        allow_small2, _ = replacement_gate(**args2, cfg={"alpha_to_excess_bps": 0.2, "cost_bps": 10.0})
        # 用显式 weight_delta 测试成本随实际组合口径变化
        allow_big, _ = replacement_gate(**_all_pass({"challenger_alpha": 51.0, "incumbent_alpha": 50.0}),
                                        weight_delta=0.02, cfg={"alpha_to_excess_bps": 0.2, "cost_bps": 10.0})
        # wd=0.02: cost=0.4+buffer5=5.4 vs edge 4 → 4<=5.4 FAIL
        allow_huge, _ = replacement_gate(**_all_pass({"challenger_alpha": 52.0, "incumbent_alpha": 50.0}),
                                         weight_delta=0.02, cfg={"alpha_to_excess_bps": 0.2, "cost_bps": 10.0})
        # delta=2×0.2×20=8bps > 5.4 → allow（实际组合口径下边际足够才放行）
        self.assertFalse(allow_small, "wd 默认 0.2: edge 4 <= cost4+buffer5 → 拦")
        self.assertFalse(allow_small2)
        self.assertFalse(allow_big, "wd=0.02: edge 4 <= cost0.4+buffer5 → 拦")
        self.assertTrue(allow_huge, "wd=0.02 且 delta 足够 → 放行（真实成本口径）")

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
        self.assertEqual(expected_turnover_cost(0.05, 10.0), 1.0)


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
