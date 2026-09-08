"""针对 Gen-2 P0 审查（F03/F04/F05）的反例测试。"""
from __future__ import annotations

import unittest

import pandas as pd

from gen2.backtest.costs import apply_turnover_cost
from gen2.portfolio.role_engine import _cap_core_roles


def _mk_day():
    """构造同一 cluster 的两个 CORE：A 的 alpha 高但 V1 分数低，B 的 alpha 低但 V1 分数高。"""
    return pd.DataFrame([
        {"code": "A", "correlation_cluster": "tech", "role": "CORE",
         "leadership_score": 50.0, "rank": 2, "alpha_score_v2": 95.0, "alpha_rank": 1},
        {"code": "B", "correlation_cluster": "tech", "role": "CORE",
         "leadership_score": 80.0, "rank": 1, "alpha_score_v2": 70.0, "alpha_rank": 2},
    ])


class CapCorePriorityTest(unittest.TestCase):
    def test_cap_uses_v1_by_default(self):
        # 默认（V1）按 leadership_score 排序 → 保留 B（V1 分数高）
        day = _mk_day()
        roles = _cap_core_roles(day, max_core_count=1, max_core_per_cluster=1)
        self.assertEqual(roles.loc[day.code == "B"].iloc[0], "CORE")
        self.assertEqual(roles.loc[day.code == "A"].iloc[0], "SATELLITE")

    def test_cap_uses_alpha_when_passed(self):
        # F03 修复：显式传 alpha 排序 → 保留 A（alpha 高），即便 V1 分数低
        day = _mk_day()
        roles = _cap_core_roles(day, max_core_count=1, max_core_per_cluster=1,
                                priority_col="alpha_score_v2", priority_rank_col="alpha_rank")
        self.assertEqual(roles.loc[day.code == "A"].iloc[0], "CORE")
        self.assertEqual(roles.loc[day.code == "B"].iloc[0], "SATELLITE")

    def test_changing_v1_does_not_change_v2_result(self):
        # F03 验收：冻结 alpha 输入后，改变 V1 分数不得改变 V2 结果
        day = _mk_day()
        roles1 = _cap_core_roles(day, 1, 1, priority_col="alpha_score_v2", priority_rank_col="alpha_rank")
        day2 = day.copy()
        day2.loc[day2.code == "B", "leadership_score"] = 999.0  # 大幅调高 B 的 V1 分数
        roles2 = _cap_core_roles(day2, 1, 1, priority_col="alpha_score_v2", priority_rank_col="alpha_rank")
        self.assertTrue((roles1 == roles2).all())


class DriftCostTest(unittest.TestCase):
    def test_equal_weight_rebalance_costs_real_turnover(self):
        """F07 反例：A/B 各 50%，A 涨 100% 后恢复 50/50，应产生 ~33.3% 双边换手（原实现返回 0）。"""
        weights = pd.DataFrame([
            {"trade_date": "2020-01-01", "code": "A", "target_weight": 0.5},
            {"trade_date": "2020-01-01", "code": "B", "target_weight": 0.5},
            {"trade_date": "2020-01-02", "code": "A", "target_weight": 0.5},
            {"trade_date": "2020-01-02", "code": "B", "target_weight": 0.5},
        ])
        returns = pd.DataFrame([
            {"trade_date": "2020-01-01", "code": "A", "ret_1d": 0.0},
            {"trade_date": "2020-01-01", "code": "B", "ret_1d": 0.0},
            {"trade_date": "2020-01-02", "code": "A", "ret_1d": 1.0},  # A 涨 100%
            {"trade_date": "2020-01-02", "code": "B", "ret_1d": 0.0},
        ])
        out = apply_turnover_cost(weights, returns, cost_bps=0.0)
        day2 = out.iloc[1]
        # pre_trade: A=0.667, B=0.333 → 恢复 50/50 换手 = 0.167+0.167 = 0.333
        self.assertAlmostEqual(day2["turnover"], 1.0 / 3.0, places=3)


if __name__ == "__main__":
    unittest.main()
