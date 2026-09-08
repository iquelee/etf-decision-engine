from __future__ import annotations

import json
import subprocess
import sys
import unittest
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

from gen2.backtest.costs import apply_turnover_cost
from gen2.data.loader import GEN2_ROOT, PROJECT_ROOT, load_gen2_config, load_universe_records, point_in_time_eligible
from gen2.data.schema import validate_daily_bars
from gen2.features.build_features import compute_time_series_features
from gen2.portfolio.cluster_constraints import apply_cluster_cap
from gen2.portfolio.role_engine import build_daily_roles
from gen2.ranking.rank_postprocess import validate_rankings


class Gen2FoundationTest(unittest.TestCase):
    def test_universe_unique_code(self):
        master = pd.read_csv(GEN2_ROOT / "universe" / "etf_master.csv", dtype={"code": str})
        self.assertFalse(master["code"].duplicated().any())

    def test_universe_point_in_time_eligibility(self):
        rec = load_universe_records()["513310"]
        ok, reason = point_in_time_eligible(rec, date(2022, 12, 21), 300, 120)
        self.assertFalse(ok)
        self.assertEqual(reason, "NOT_LISTED")
        ok, reason = point_in_time_eligible(rec, date(2023, 1, 1), 8, 120)
        self.assertFalse(ok)
        self.assertEqual(reason, "INSUFFICIENT_HISTORY")
        ok, reason = point_in_time_eligible(rec, date(2023, 8, 1), 160, 120)
        self.assertTrue(ok)
        self.assertEqual(reason, "ELIGIBLE")

    def test_daily_data_contract(self):
        rows = 10
        df = pd.DataFrame({
            "trade_date": pd.date_range("2026-01-01", periods=rows).date,
            "code": ["TEST"] * rows,
            "open": np.linspace(1, 1.09, rows),
            "high": np.linspace(1.01, 1.10, rows),
            "low": np.linspace(0.99, 1.08, rows),
            "close": np.linspace(1, 1.09, rows),
            "volume": np.full(rows, 1000),
            "amount": np.full(rows, 100000),
            "adj_close": np.linspace(1, 1.09, rows),
            "source": ["unit"] * rows,
            "source_trade_date": pd.date_range("2026-01-01", periods=rows).date,
        })
        validate_daily_bars(df)

    def test_feature_uses_no_future_data(self):
        rows = 160
        dates = pd.bdate_range("2025-01-01", periods=rows).date
        base = pd.DataFrame({
            "trade_date": dates,
            "code": ["X"] * rows,
            "open": np.linspace(1, 2, rows),
            "high": np.linspace(1.02, 2.02, rows),
            "low": np.linspace(0.98, 1.98, rows),
            "close": np.linspace(1, 2, rows),
            "volume": np.linspace(1000, 2000, rows),
            "amount": np.linspace(100000, 200000, rows),
        })
        f1 = compute_time_series_features(base)
        changed = base.copy()
        changed.loc[changed.index[-1], "close"] = 100
        changed.loc[changed.index[-1], "high"] = 101
        f2 = compute_time_series_features(changed)
        cols = ["ret_20d", "px_ma20", "ma20_slope_5d", "volume_ratio_5_20", "breakout_distance"]
        pd.testing.assert_frame_equal(f1.iloc[:-1][cols].reset_index(drop=True), f2.iloc[:-1][cols].reset_index(drop=True))

    def test_amount_missing_is_estimated_and_flagged(self):
        from gen2.data.schema import normalize_daily_bars

        raw = pd.DataFrame({
            "date": ["2026-01-01"],
            "open": [1.0],
            "close": [1.1],
            "high": [1.2],
            "low": [0.9],
            "volume": [100],
            "amount": [np.nan],
        })
        out = normalize_daily_bars(raw, code="123456", source="unit")
        self.assertTrue(bool(out["amount_estimated"].iloc[0]))
        self.assertAlmostEqual(float(out["amount"].iloc[0]), 110.0)

    def test_label_future_only(self):
        close = pd.Series(np.arange(1, 31, dtype=float))
        future = close.shift(-20) / close - 1
        self.assertAlmostEqual(float(future.iloc[0]), 20.0)
        self.assertTrue(pd.isna(future.iloc[-1]))

    def test_training_test_label_no_overlap_config(self):
        cfg = load_gen2_config()
        self.assertGreaterEqual(cfg["purge_days"], cfg["horizon_days"])
        self.assertGreaterEqual(cfg["embargo_days"], 0)

    def test_rank_unique_per_date_and_bounds(self):
        rankings = pd.DataFrame({
            "trade_date": [date(2026, 1, 1)] * 3,
            "code": ["A", "B", "C"],
            "leadership_score": [90, 80, 70],
            "rank": [1, 2, 3],
            "rank_percentile": [1.0, 2 / 3, 1 / 3],
        })
        validate_rankings(rankings)

    def test_max_core_count_and_cluster(self):
        day = pd.DataFrame({
            "trade_date": [date(2026, 1, 1)] * 4,
            "code": ["A", "B", "C", "D"],
            "correlation_cluster": ["tech", "tech", "tech", "gold"],
            "leadership_score": [90, 80, 70, 60],
            "rank": [1, 2, 3, 4],
            "role": ["CORE"] * 4,
            "reason_codes": [[] for _ in range(4)],
        })
        out = apply_cluster_cap(day, max_core_count=3, max_core_per_cluster=2)
        self.assertEqual((out["role"] == "CORE").sum(), 3)
        self.assertLessEqual((out[(out["role"] == "CORE") & (out["correlation_cluster"] == "tech")]).shape[0], 2)

    def test_replacement_hysteresis(self):
        dates = pd.bdate_range("2026-01-01", periods=6).date
        rows = []
        for i, d in enumerate(dates):
            rows.append({"trade_date": d, "code": "NEW", "name": "NEW", "rank": 1, "rank_percentile": 1.0, "leadership_score": 90, "correlation_cluster": "new"})
            rows.append({"trade_date": d, "code": "OLD", "name": "OLD", "rank": 2, "rank_percentile": 0.5, "leadership_score": 80, "correlation_cluster": "old"})
        rankings = pd.DataFrame(rows)
        records = {
            "OLD": type("R", (), {"core_eligible": True, "research_only": False, "strategic_role_hint": "", "incumbent": True})(),
            "NEW": type("R", (), {"core_eligible": True, "research_only": False, "strategic_role_hint": "", "incumbent": False})(),
        }
        # Monkeypatch loader used inside role_engine.
        import gen2.portfolio.role_engine as role_engine
        old_loader = role_engine.load_universe_records
        role_engine.load_universe_records = lambda: records
        try:
            roles = build_daily_roles(rankings, config={"portfolio": {"promotion_persistence_days": 5, "demotion_persistence_days": 5, "max_core_count": 2, "max_core_per_cluster": 2}})
        finally:
            role_engine.load_universe_records = old_loader
        new_roles = roles[roles["code"] == "NEW"]["role"].tolist()
        self.assertEqual(new_roles[:4], ["CHALLENGER"] * 4)
        self.assertEqual(new_roles[-1], "CORE")

    def test_turnover_cost_applied(self):
        d1, d2 = date(2026, 1, 1), date(2026, 1, 2)
        weights = pd.DataFrame({"trade_date": [d1, d2], "code": ["A", "A"], "target_weight": [1.0, 0.0]})
        returns = pd.DataFrame({"trade_date": [d1, d2], "code": ["A", "A"], "ret_1d": [0.01, 0.01]})
        out = apply_turnover_cost(weights, returns, cost_bps=10)
        self.assertLess(float(out["net_return"].iloc[0]), float(out["gross_return"].iloc[0]))
        self.assertGreater(float(out["turnover"].iloc[1]), 0)

    def test_regime_defense_gate_reduces_risk_off(self):
        from gen2.portfolio.defense_gate import apply_regime_defense

        d = date(2026, 1, 1)
        cand = pd.DataFrame({
            "trade_date": [d, d],
            "code": ["A", "518880"],
            "target_weight": [1.0, 0.0],
            "role": ["CORE", "HEDGE"],
            "priority": [1, 2],
        })
        feat = pd.DataFrame({"trade_date": [d], "risk_state": ["RISK_OFF"]})
        cfg = {"portfolio": {"defense": {"enabled": True, "risk_off_exposure_scale": 0.30, "risk_off_hedge_weight": 0.10, "hedge_code": "518880", "regime_field": "risk_state"}}}
        out = apply_regime_defense(cand, feat, config=cfg)
        self.assertAlmostEqual(float(out.loc[out["code"] == "A", "target_weight"].iloc[0]), 0.20, places=6)
        self.assertAlmostEqual(float(out.loc[out["code"] == "518880", "target_weight"].iloc[0]), 0.10, places=6)

    def test_no_production_write(self):
        cfg = load_gen2_config()
        self.assertFalse(cfg["production"]["write_decision_result"])
        self.assertFalse(cfg["production"]["write_portfolio_position"])
        self.assertFalse(cfg["production"]["auto_execution"])

    def test_gen1_immutable(self):
        result = subprocess.run(
            [sys.executable, str(PROJECT_ROOT / "scripts" / "ml" / "assert-gen1-immutable.py")],
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertIn("PASS", result.stdout)

    def test_v361_untouched(self):
        manifest = json.loads((PROJECT_ROOT / "ml" / "manifests" / "ENGINE_V361_v1.json").read_text(encoding="utf-8"))
        self.assertTrue(manifest["immutable"])
        self.assertEqual(manifest["engine_version"], "v3.6.1")


if __name__ == "__main__":
    unittest.main()
