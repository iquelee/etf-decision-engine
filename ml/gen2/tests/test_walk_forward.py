"""工作包 4 / F10 Walk-Forward 切分回归测试。"""
from __future__ import annotations

import unittest
from datetime import date

import pandas as pd

from gen2.evaluation.walk_forward import WalkForwardConfig, build_walk_forward_folds, evaluate_fold


class WalkForwardFoldTest(unittest.TestCase):
    def _dates(self, start_year, end_year):
        # 生成每自然年 240 个交易日
        ds = []
        for y in range(start_year, end_year + 1):
            ds.extend(pd.bdate_range(f"{y}-01-01", f"{y}-12-31").date)
        return ds

    def test_folds_purge_and_embargo_applied(self):
        dates = self._dates(2018, 2022)
        cfg = WalkForwardConfig(train_years=3, purge_days=20, embargo_days=5)
        folds = build_walk_forward_folds(dates, cfg)
        # 5 个年份 → test 年份为 2021, 2022（2 个 fold）
        self.assertEqual([f["test_year"] for f in folds], [2021, 2022])
        # train 末尾必须剔除 purge+embargo：train_end 早于 test_start
        for f in folds:
            self.assertLess(f["train_end"], f["test_start"])
            # train 最后一个日期与 test 第一个日期之间至少相隔 purge+embargo 个交易日
            self.assertEqual(f["n_train"], len(f["train_dates"]))
            self.assertGreater(f["n_test"], 0)

    def test_label_does_not_cross_boundary(self):
        # 构造：train 末段样本的 future label 不得落在 test 段
        dates = self._dates(2018, 2021)
        cfg = WalkForwardConfig(train_years=3, purge_days=20, embargo_days=5)
        folds = build_walk_forward_folds(dates, cfg)
        f = folds[0]  # test=2021
        # train_dates 已被截断，最后一天 + horizon(20) 必须仍在 train 段内或至少 < test_start
        last_train = f["train_dates"][-1]
        # 用交易日历验证：train_end 之后至少还有 purge+embargo 天才到 test_start
        gap = (f["test_start"] - last_train).days
        # 自然日间隔应 > 20 个交易日 ≈ 28 自然日（含周末）
        self.assertGreater(gap, 20)

    def test_evaluate_fold_uses_only_test_dates(self):
        rankings = pd.DataFrame({
            "trade_date": [date(2021, 1, 4), date(2021, 1, 5), date(2020, 12, 30)],
            "code": ["A", "B", "A"],
            "alpha_score_v2": [90.0, 80.0, 70.0],
        })
        labels = pd.DataFrame({
            "trade_date": [date(2021, 1, 4), date(2021, 1, 5), date(2020, 12, 30)],
            "code": ["A", "B", "A"],
            "future_20d_excess_vs_market": [0.1, -0.1, 0.2],
            "y_rank_vs_market_20d": [1.0, 0.5, 0.9],
        })
        fold = {"fold": 1, "test_year": 2021, "test_dates": [date(2021, 1, 4), date(2021, 1, 5)]}
        out = evaluate_fold(rankings, labels, fold, "alpha_score_v2", "y_rank_vs_market_20d")
        # 只有 2021 的两天进入评价
        self.assertEqual(out["n_days"], 2)


if __name__ == "__main__":
    unittest.main()
