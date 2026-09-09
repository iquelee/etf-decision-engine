"""Gen-2.1 M2 — consolidation_gate 单元测试。

验证：分档映射边界（含 sideway_range 小数单位、sideway_days 无整数空洞）、
px_ma60<=0/缺失 → 0（硬前置）、NaN 处理、quality 0-100 clip、
gate_pass 边界、权重默认与传入。

单位契约（build_features.py 对齐）：sideway_range = hh20/ll20-1.0 → 小数（6%=0.06）。
"""
from __future__ import annotations

import unittest

import pandas as pd

from gen2.portfolio.consolidation_gate import compute_consolidation_quality, gate_pass


def _panel(rows):
    return pd.DataFrame(rows)


class TestConsolidationGate(unittest.TestCase):
    def test_px_ma60_le_zero_zeroes_quality(self):
        p = _panel([{"trade_date": "2024-01-02", "code": "513310", "px_ma60": -0.02,
                     "sideway_days": 20, "sideway_range": 0.05, "volume_ratio_5_20": 0.6,
                     "volume_compression_slope": -0.1, "volatility_compression": -0.2}])
        q = compute_consolidation_quality(p)
        self.assertEqual(q["quality"].iloc[0], 0.0, "px_ma60<=0 硬前置 → 0")

    def test_px_ma60_nan_zeroes_quality(self):
        p = _panel([{"trade_date": "2024-01-02", "code": "513310", "px_ma60": float("nan"),
                     "sideway_days": 20, "sideway_range": 0.05, "volume_ratio_5_20": 0.6,
                     "volume_compression_slope": -0.1, "volatility_compression": -0.2}])
        q = compute_consolidation_quality(p)
        self.assertEqual(q["quality"].iloc[0], 0.0)

    def test_all_best_gives_100(self):
        p = _panel([{"trade_date": "2024-01-02", "code": "513310", "px_ma60": 0.05,
                     "sideway_days": 30, "sideway_range": 0.03, "volume_ratio_5_20": 0.5,
                     "volume_compression_slope": -0.2, "volatility_compression": -0.3}])
        q = compute_consolidation_quality(p)
        self.assertAlmostEqual(q["quality"].iloc[0], 100.0, places=2)

    def test_tier_boundary_and_weights(self):
        # 各组件落入档位：days15→60([15,20)), range0.09→60([0.09,0.12)), vol_ratio0.9→60, slope0.05→50, volcomp0.1→50
        # 0.25*60 + 0.25*60 + 0.20*60 + 0.15*50 + 0.15*50 = 15+15+12+7.5+7.5 = 57
        p = _panel([{"trade_date": "2024-01-02", "code": "513310", "px_ma60": 0.02,
                     "sideway_days": 15, "sideway_range": 0.09, "volume_ratio_5_20": 0.9,
                     "volume_compression_slope": 0.05, "volatility_compression": 0.1}])
        q = compute_consolidation_quality(p)
        self.assertAlmostEqual(q["quality"].iloc[0], 57.0, places=2)

    def test_sideway_range_unit_is_decimal(self):
        # 单位契约：真实值 0.06=6%。旧实现把 6.0 当 6% 档位 → 真实 0.06 全部落入 <6.0 满分，25% 权重退化。
        # 回归：<0.06→100；0.06 边界→80；0.09→60；0.12→40；0.15→20。
        cases = [(0.0599, 100.0), (0.06, 80.0), (0.09, 60.0), (0.12, 40.0), (0.15, 20.0), (0.20, 20.0)]
        for r, want in cases:
            p = _panel([{"trade_date": "2024-01-02", "code": "513310", "px_ma60": 0.02,
                         "sideway_days": 30, "sideway_range": r, "volume_ratio_5_20": 0.5,
                         "volume_compression_slope": -0.2, "volatility_compression": -0.3}])
            q = compute_consolidation_quality(p)
            # 其余四组件全满分：days12→40? 非满分，故只断言 range 贡献 = (want - 其余组件加权)
            self.assertAlmostEqual(q["quality"].iloc[0], 0.25 * want + 0.75 * 100.0, places=2,
                                   msg=f"sideway_range={r} 应映射 {want} 分档")

    def test_sideway_days_no_integer_gap(self):
        # 旧档 (0,4)(5,9)... 用 lo<=v<hi，4/9/14/19/24 掉出全部分档 → 0 分。
        # 半开连续 [0,5)[5,10)[10,15)[15,20)[20,25)[25,∞)：5 分档级差 20，无空洞。
        cases = [(4, 0.0), (5, 20.0), (9, 20.0), (10, 40.0), (14, 40.0), (15, 60.0), (19, 60.0),
                 (20, 80.0), (24, 80.0), (25, 100.0), (30, 100.0)]
        for d, want in cases:
            p = _panel([{"trade_date": "2024-01-02", "code": "513310", "px_ma60": 0.02,
                         "sideway_days": d, "sideway_range": 0.03, "volume_ratio_5_20": 0.5,
                         "volume_compression_slope": -0.2, "volatility_compression": -0.3}])
            q = compute_consolidation_quality(p)
            self.assertAlmostEqual(q["quality"].iloc[0], 0.25 * want + 0.75 * 100.0, places=2,
                                   msg=f"sideway_days={d} 应映射 {want} 分档（不得落空洞）")

    def test_below_ma60_is_zero_even_with_good_shape(self):
        p = _panel([{"trade_date": "2024-01-02", "code": "513310", "px_ma60": -0.01,
                     "sideway_days": 30, "sideway_range": 0.03, "volume_ratio_5_20": 0.5,
                     "volume_compression_slope": -0.2, "volatility_compression": -0.3}])
        q = compute_consolidation_quality(p)
        self.assertEqual(q["quality"].iloc[0], 0.0)

    def test_nan_components_scored_zero(self):
        p = _panel([{"trade_date": "2024-01-02", "code": "513310", "px_ma60": 0.02,
                     "sideway_days": float("nan"), "sideway_range": float("nan"),
                     "volume_ratio_5_20": float("nan"), "volume_compression_slope": float("nan"),
                     "volatility_compression": float("nan")}])
        q = compute_consolidation_quality(p)
        self.assertAlmostEqual(q["quality"].iloc[0], 0.0, places=2)

    def test_gate_pass_boundary(self):
        self.assertTrue(bool(gate_pass([80.0], 80.0)[0]))
        self.assertFalse(bool(gate_pass([79.99], 80.0)[0]))
        self.assertTrue(bool(gate_pass([50.0], 0.0)[0]))


if __name__ == "__main__":
    unittest.main(verbosity=2)
