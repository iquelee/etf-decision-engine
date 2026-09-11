"""WP-G2-02 / B1 回测账本与基线验收测试。

验收标准（规划 L41 / L97）：
  T+1 时序、现金与费用、资金守恒、超配、末日处理、公共日历、最终约束 —— 全部通过；
  统一账本 + 统一角色语义产出四类同口径基线（Gen-2 / Main5 / 全池等权 / 510300）。

本文件覆盖账本层之外的部分：
  1. 公共评估窗口 = 各策略信号日 ∩ 收益日的**交集**（不是并集：并集会混入空转日）
  2. 端到端跑通 `build_unified_baselines`（裁剪窗口 + 单费用档，保证 CI 可承受）
     并逐项断言：守恒误差为 0、现金非负、5 个策略齐备、公共日历一致、报告与元数据落盘
  3. 产物中的每个账本都必须满足 `LEDGER_CONTRACT`
"""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "ml"))

from gen2.backtest.ledger import LEDGER_CONTRACT, assert_common_calendar, run_ledger  # noqa: E402
from gen2.baseline.rebuild_baselines import (  # noqa: E402
    BASELINE_ID,
    common_evaluation_calendar,
    build_unified_baselines,
)

def _b1_dataset_available() -> bool:
    """B1 端到端需要本地 Gen-2 日线池（`deliverables/etf_daily_ml_pool/`，**未入库**）。

    CI 上没有该数据 → 显式跳过（而不是伪造通过）；本地跑法：
        PYTHONPATH=ml python -m unittest gen2.tests.test_b1_baseline_contract
    """
    try:
        from gen2.data.loader import load_daily_bars
        bars = load_daily_bars(validate=False)
        return bars is not None and len(bars) > 0
    except Exception:  # noqa: BLE001 —— 缺数据 / 读失败都视为不可用
        return False


EXPECTED_STRATEGIES = {
    "gen2_v2_defended",
    "gen2_v2_undefended",
    "main5_equal_weight",
    "universe_equal_weight",
    "market_510300",
}


def _w(pairs):
    rows = []
    for d, code, wt in pairs:
        rows.append({"trade_date": d, "code": code, "target_weight": wt})
    return pd.DataFrame(rows)


class CommonWindowTest(unittest.TestCase):
    """公共窗口反例：必须取交集，排除「某策略尚未产生信号」的空转日。"""

    def test_intersection_excludes_dead_leading_days(self):
        d = list(pd.to_datetime(["2020-01-01", "2020-01-02", "2020-01-03", "2020-01-06"]).date)
        weights = {
            "early": _w([(d[0], "A", 1.0), (d[1], "A", 1.0), (d[2], "A", 1.0), (d[3], "A", 1.0)]),
            "late": _w([(d[2], "B", 1.0), (d[3], "B", 1.0)]),
        }
        returns = pd.DataFrame({"trade_date": d, "code": ["A"] * 4, "ret_1d": [0.01] * 4})
        cal, meta = common_evaluation_calendar(weights, returns)
        self.assertEqual(cal, [d[2], d[3]], "必须从两策略共同的第一个信号日开始")
        self.assertEqual(meta["common_days"], 2)
        self.assertEqual(meta["naive_union_days"], 4)
        self.assertEqual(meta["excluded_leading_days"], 2)

    def test_empty_intersection_raises(self):
        d = pd.to_datetime(["2020-01-01", "2020-01-02"]).date
        weights = {
            "a": _w([(d[0], "A", 1.0)]),
            "b": _w([(d[1], "B", 1.0)]),
        }
        returns = pd.DataFrame({"trade_date": [d[0]], "code": ["A"], "ret_1d": [0.0]})
        with self.assertRaises(ValueError):
            common_evaluation_calendar(weights, returns)


class BaselineEndToEndTest(unittest.TestCase):
    """端到端：裁剪窗口 + 单费用档跑通基线生成并验收（CI 内可承受）。"""

    @classmethod
    def setUpClass(cls):
        if not _b1_dataset_available():
            raise unittest.SkipTest(
                "本地 Gen-2 日线池（deliverables/etf_daily_ml_pool，未入库）不可用 → "
                "B1 端到端基线在 CI 跳过；账本口径由 test_ledger.py / LedgerContractTest 用合成数据强制。"
            )
        cls.tmp = tempfile.TemporaryDirectory()
        out = Path(cls.tmp.name) / "out"
        rep = Path(cls.tmp.name) / "rep"
        cls.result = build_unified_baselines(output_dir=out, report_dir=rep,
                                             cost_levels=[10.0], date_from="2025-01-01")
        cls.out_dir = out
        cls.rep_dir = rep

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_expected_strategies_present(self):
        s = self.result["summary"]
        self.assertEqual(set(s["strategy"]), EXPECTED_STRATEGIES)
        self.assertEqual(set(s["cost_bps"]), {10.0})

    def test_conservation_and_cash_and_common_calendar(self):
        s = self.result["summary"]
        self.assertLessEqual(float(s["conservation_max_error"].max()), 1e-12, "资金守恒必须为 0 误差")
        self.assertGreaterEqual(float(s["cash_min"].min()), -1e-12, "现金权重不得为负")
        self.assertLessEqual(float(s["gross_exposure_max"].max()), 1.0 + 1e-9, "总敞口不得超过 1")
        v = self.result["verification"]
        self.assertGreater(v["calendar"]["days"], 100, "裁剪后窗口天数异常")
        self.assertEqual(len(v["calendar"]["strategies"]), len(EXPECTED_STRATEGIES))

    def test_ledger_daily_satisfies_contract(self):
        led = pd.read_csv(self.out_dir / "ledger_daily.csv")
        for col in ["trade_date", "gross_return", "turnover", "cost", "net_return", "equity",
                    "cash_weight", "gross_exposure", "over_allocated", "conservation_error",
                    "missing_quotes", "dropped_signal", "strategy", "cost_bps"]:
            self.assertIn(col, led.columns, f"账本缺少契约列 {col}")
        self.assertLessEqual(float(led["conservation_error"].max()), 1e-12)
        self.assertGreaterEqual(float(led["cash_weight"].min()), -1e-12)
        # net == gross - cost（逐行恒等）
        diff = (led["net_return"] - (led["gross_return"] - led["cost"])).abs().max()
        self.assertLessEqual(float(diff), 1e-12, "net_return 必须等于 gross_return - cost")
        # equity == Π(1+net) 按策略复利
        for name, g in led.groupby("strategy"):
            g = g.sort_values("trade_date")
            expected = float((1.0 + g["net_return"]).prod())
            self.assertAlmostEqual(float(g["equity"].iloc[-1]), expected, places=10,
                                   msg=f"{name} 期末净值与复利不一致")

    def test_artifacts_and_report_written(self):
        self.assertTrue((self.out_dir / "ledger_summary.csv").exists())
        self.assertTrue((self.out_dir / "calendar_meta.json").exists())
        meta = json.loads((self.out_dir / "calendar_meta.json").read_text(encoding="utf-8"))
        self.assertEqual(meta["ledger_contract"]["turnover"], LEDGER_CONTRACT["turnover"])
        self.assertEqual(meta["ledger_contract"]["initial_state"], "all_cash")
        self.assertIn("common_window", meta)
        report = self.rep_dir / f"gen2_{BASELINE_ID}.md"
        self.assertTrue(report.exists())
        # 去掉 Markdown 强调标记后再断言（报告里有 **不**用于宣称 这类写法）
        text = report.read_text(encoding="utf-8").replace("*", "")
        for key in ["资金守恒验收", "同口径比较", "公共窗口", "旧角色语义审计基线", "不用于宣称"]:
            self.assertIn(key, text, f"报告缺少必需章节/声明：{key}")



class LedgerContractTest(unittest.TestCase):
    """契约常量必须与实现一致（防止口径被悄悄改动）。"""

    def test_contract_constants(self):
        self.assertEqual(LEDGER_CONTRACT["execution_lag_default"], 1)
        self.assertEqual(LEDGER_CONTRACT["turnover"], "one_way_stock_legs")
        self.assertEqual(LEDGER_CONTRACT["initial_state"], "all_cash")
        self.assertEqual(LEDGER_CONTRACT["terminal"], "mark_to_market_no_liquidation")

    def test_default_execution_lag_is_one(self):
        d = pd.to_datetime(["2026-01-05", "2026-01-06"]).date
        sig = _w([(d[0], "A", 1.0)])
        ret = pd.DataFrame({"trade_date": list(d), "code": ["A", "A"], "ret_1d": [0.0, 0.0]})
        default = run_ledger(sig, ret, cost_bps=0.0, calendar=list(d))
        explicit = run_ledger(sig, ret, cost_bps=0.0, calendar=list(d), execution_lag=1)
        self.assertEqual(float(default.iloc[1]["turnover"]), float(explicit.iloc[1]["turnover"]))
        # 默认即 lag=1：首日不成交
        self.assertEqual(float(default.iloc[0]["turnover"]), 0.0)


class CommittedReportTest(unittest.TestCase):
    """不依赖本地数据的守卫：仓库内提交的基线与索引必须保留边界声明。"""

    def test_committed_full_report_states_boundaries(self):
        full = ROOT / "ml" / "gen2" / "reports" / f"gen2_{BASELINE_ID}.md"
        self.assertTrue(full.exists(), "B1 基线报告必须入库")
        text = full.read_text(encoding="utf-8").replace("*", "")
        for key in ["旧角色语义审计基线", "不用于宣称 Rule V2 的经济表现", "不冻结 bundle/lock",
                    "资金守恒验收", "公共窗口"]:
            self.assertIn(key, text, f"B1 报告缺少必需声明：{key}")

    def test_research_baseline_report_and_index(self):
        rep = ROOT / "ml" / "gen2" / "reports"
        research = rep / "gen2_b1_research_baselines_20260911.md"
        index = rep / "README.md"
        self.assertTrue(research.exists(), "研究基线报告必须入库")
        self.assertTrue(index.exists(), "报告索引必须入库")
        rtext = research.read_text(encoding="utf-8")
        for key in ["F1", "F2", "F3", "不构成 Rule V2 的经济结论"]:
            self.assertIn(key, rtext, f"研究基线报告缺少：{key}")
        itext = index.read_text(encoding="utf-8")
        self.assertIn("旧角色语义审计基线", itext)
        self.assertIn("当前有效（唯一权威口径）", itext)


if __name__ == "__main__":
    unittest.main(verbosity=2)
